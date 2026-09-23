// ============================================================================
// GRAIN WORKLET BRIDGE — Phase 2: main-thread interface to the grain engine
//
// Manages the AudioWorkletNode, the SharedArrayBuffers (the primary take, the
// candidate tables the 10 ms scheduler writes), parameter forwarding, buffer
// registration, VBAP LUT transfer and the feedback ring.
// ============================================================================

import { S, gp, FILTER_TYPE_OF } from './state.js';
import { dlog } from './diag.js';
import { markGlow, packVBAPLookup } from './grain.js';
import { voicingById } from './brush-voicing.js';
import { cameraRotateInto, spherePointInto } from './sphere.js';

// Scratch arrays for headlocked azimuth — reused per candidate, zero alloc.
const _hlW = new Float64Array(3);  // world-space xyz
const _hlC = new Float64Array(3);  // camera-space xyz

let _workletNode = null;
let _sab = null;
let _sabSampleRate = 48000;   // sample rate of the buffer in SAB
let _sabLengthSamples = 0;    // length of buffer in SAB
let _sabAudioBuffer = null;   // reference to the AudioBuffer currently in SAB
let _registered = false;
let _feedbackCallback = null;
let _workletSplitters = null;   // ChannelSplitters for multi-channel routing

// ── Spatial helpers ────────────────────────────────────────────────────────
// Compute azimuth and elevation center-bias for a particle.
// In headlocked mode, transform to camera-space first (both az and elBias
// come from camera-space coordinates).  In worldlocked mode, use world-space.
// Returns { azDeg, elBias }.  Called per candidate — must be zero-alloc.
const _spatialResult = { azDeg: 0, elBias: 0 };
function _spatialForParticle(lon, lat) {
  if (S.spatialPanning === 'headlocked') {
    spherePointInto(lon, lat, _hlW);
    cameraRotateInto(_hlW[0], _hlW[1], _hlW[2], _hlC);
    const az = Math.atan2(_hlC[0], _hlC[2]);
    _spatialResult.azDeg = ((az * 180 / Math.PI) % 360 + 360) % 360;
    // In headlocked, elevation is irrelevant for center-bias — the
    // "poles" rotate with the listener's head, so don't collapse panning.
    _spatialResult.elBias = 0;
  } else {
    _spatialResult.azDeg = ((lon * 180 / Math.PI) % 360 + 360) % 360;
    // Worldlocked: particles near the poles of the fixed sphere spread
    // to all speakers instead of hard-panning to a VBAP pair.
    const sinLat = Math.sin(lat);
    _spatialResult.elBias = sinLat * sinLat;
  }
  return _spatialResult;
}
let _lastPostedCandidates = [];  // for console debugging (the message path); the table path reads back on demand
let _postedOnce = false;

// ── The candidate TABLES (R3, 2026-09-06) — must match grain-engine.worklet.js ──
// The pool used to cross to the worklet as a message of objects every tick:
// thousands of candidates structured-cloned on the main thread, allocated
// again on the audio thread, and collected there. Now the bridge writes rows
// into one SharedArrayBuffer — a region per cursor voice, double-buffered with
// a published-half word — and posts a two-field message. The worklet reads a
// candidate by row at fire time. The message path stays for a page without
// shared memory (the browser demo when not cross-origin isolated).
// Voice slots, and the candidate tables sized from them — one region per
// cursor voice plus region 0 for the live voicing. These MUST agree with
// grain-engine.worklet.js: a voice with no region writes nowhere and is
// silent, which is how a raised cap would fail quietly (P4, 2026-09-06).
const MAX_CURSOR_VOICES = 16;
const MAX_SEED_VOICES = 64;
const CT_ROWS = 8192, CT_WORDS = 7, CT_HEADER = 4, CT_REGIONS = 1 + MAX_CURSOR_VOICES;
const CT_HALF = CT_ROWS * CT_WORDS + CT_ROWS;
const CT_REGION = CT_HEADER + 2 * CT_HALF;
let _ctSab = null, _ctI = null, _ctF = null;
const _ctCount = new Int32Array(CT_REGIONS);      // rows written this tick, per region
const _ctPerm  = new Uint32Array(CT_ROWS);        // scratch for the step-mode order
// Each row's place in time, for step: stroke first, then its own clock.
const _ctOrd   = new Float64Array(CT_REGIONS * CT_ROWS);
let _ctTruncated = 0;                             // rows beyond CT_ROWS, dropped (diag)
let _lastPostedSeeds = [];       // the seed voices of the last post, for the audits

// Multi-buffer support: maps AudioBuffer references to worklet buffer indices.
// SAB (primary) buffer → -1, provisional live buffer → -2, additional buffers → 0, 1, 2, ...
// Rebuilt on every start/restart when all live recordings are sent to the worklet.
let _bufferMap = new Map();   // AudioBuffer → worklet bufIndex
let _liveChunkSize = 0;   // the worklet's live chunk size, for spares (R5)
let _lastWorkletDiag = null;  // most recent _diag from worklet feedback (~30Hz)

// Provisional live buffer: streamed to worklet during active recording (bufIndex -2).
// Allows grains from in-progress recording to play via the worklet instead of
// so grains from in-progress recordings play immediately.
let _provisionalLiveRef = null;    // current AudioBuffer reference for liveBuffer
let _provisionalSentLen = 0;       // samples already sent (for delta appends)
let _deferredClearId = 0;          // deferred liveBufferClear timer (for cancellation)

// ── Cross-origin isolation check ────────────────────────────────────────────
export function isCrossOriginIsolated() {
  return typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
}

// ── Start the worklet grain engine ──────────────────────────────────────────
/**
 * @param {AudioContext} actx
 * @param {object} take - the primary take (js/take.js)
 * @param {object} params - initial grain parameters
 * @param {object} [options] - { numChannels, onFeedback }
 * @returns {AudioWorkletNode|null}
 */
export async function startWorkletGrain(actx, take, params = {}, options = {}) {
  if (!actx) {
    console.warn('grain-worklet-bridge: no AudioContext');
    return null;
  }

  // SharedArrayBuffer requires cross-origin isolation in browsers, but is
  // natively available in Electron (file:// protocol, no headers needed).
  // Check for actual SAB availability rather than just the crossOriginIsolated flag.
  if (typeof SharedArrayBuffer === 'undefined') {
    console.warn(
      'grain-worklet-bridge: SharedArrayBuffer not available — page is not cross-origin isolated.\n' +
      'Add COOP/COEP headers to the server. Using serve.py? Restart it after the update.'
    );
    dlog('worklet', 'SAB unavailable — not cross-origin isolated');
    return null;
  }

  // Stop any existing worklet
  stopWorkletGrain();

  // ── The primary IS the take's own SharedArrayBuffer (2026-09-17) ─────
  // A take's samples already live in shared memory (js/take.js), so the
  // engine starts on them in place. Until then the primary was copied into a
  // SAB of its own — a third copy of one take.
  if (!(take?.data?.buffer instanceof SharedArrayBuffer)) {
    console.error('grain-worklet-bridge: the primary must be a take (js/take.js)');
    return null;
  }
  _sab = take.data.buffer;
  _sabSampleRate = take.sampleRate;
  _sabLengthSamples = take.length;
  _sabAudioBuffer = take;
  dlog('worklet', 'primary take shared', { samples: take.length, bytes: take.data.byteLength });

  // ── Register the worklet processor (once per AudioContext) ──────────
  if (!_registered) {
    try {
      await actx.audioWorklet.addModule('js/worklets/grain-engine.worklet.js');
      _registered = true;
      dlog('worklet', 'grain-engine processor registered');
    } catch (e) {
      console.error('grain-worklet-bridge: failed to register worklet:', e);
      dlog('worklet', 'worklet registration failed', { error: e.message });
      return null;
    }
  }

  // ── Create the AudioWorkletNode ─────────────────────────────────────
  // Two outputs: 0 = monitor bus (cursor grains), 1 = house bus (seed grains).
  // Both have the same channel count so VBAP routing works on either.
  const numChannels = options.numChannels || 1;
  _workletNode = new AudioWorkletNode(actx, 'grain-engine', {
    numberOfInputs: 1,            // input 0 = live mic feed during recording
    numberOfOutputs: 2,
    outputChannelCount: [numChannels, numChannels],
    channelCount: numChannels,
    channelCountMode: 'explicit',
  });

  // ── Feedback handler ────────────────────────────────────────────────
  _feedbackCallback = options.onFeedback || null;
  let _lastDiagLog = 0;
  let _lastDirLog = 0;
  _workletNode.port.onmessage = ({ data }) => {
    if (data?.type === 'feedback') {
      if (_feedbackCallback) _feedbackCallback(data);
      if (data._diag) {
        _lastWorkletDiag = data._diag;
        S._lastWorkletDiag = data._diag;      // Settings → Audio's live readout (P2)
        // The audio thread's own worst process() since load, held beside the
        // transport counters: when inSkipped / outDropped jump, this says
        // whether the audio thread itself stalled (a GC pause, a bulk buffer
        // post) or the queues did (2026-09-16, two ~50 ms bursts a session).
        if (S.transportDiag && data._diag.procMaxMs > (S.transportDiag.wkProcMaxMs || 0))
          S.transportDiag.wkProcMaxMs = +data._diag.procMaxMs.toFixed(1);
        // The worklet used its spare (or never had one): allocate HERE and
        // transfer it — the audio thread must not (R5, 2026-09-06).
        if (data._diag.spareLow) _sendSpareChunk();
      }

      // Push worklet pool utilisation into the perf monitor so the node
      // meter shows active grain count (replaces stale main-thread node count).
      if (data.activeCount !== undefined) {
        S._grainSourceCount = data.activeCount;
      }

      // Drive visual glow from worklet feedback — these are the particles
      // actually sounding, not the main thread's independent random pick.
      // A particle glows for the duration of ITS grain, which is its stroke's
      // frozen voicing (brush-voicing.js) — not the live sheet's. It read the
      // live duration until 2026-09-05 (Ek: "for a brush that is not live,
      // when I change the params the particles lighting up change"): turning
      // the knob changed how long a dry stroke lit, while its sound stayed.
      // A particle with no voicing (0) is the live params, as everywhere.
      const grains = data.grains;
      if (grains && grains.length > 0) {
        const particles = S.particles;
        const now = performance.now();
        const liveMs = (S.grainOverrides.duration ?? gp().duration) * 1000;
        let lastVo = 0, lastMs = liveMs;       // voicings repeat within a message
        for (let i = 0; i < grains.length; i++) {
          const pid = grains[i];
          const p = particles[pid];
          if (!p) continue;
          const vo = p._vo | 0;
          if (vo !== lastVo) {
            const v = vo ? voicingById(vo) : null;
            lastMs = v ? (v.params.duration ?? 0.1) * 1000 : liveMs;
            lastVo = vo;
          }
          markGlow(p, lastMs, '#ffffff', now);
        }
      }

      // Log direction diagnostics at ~1Hz when direction is random (dir=2).
      // dlog (debug-gated) instead of console.log — an ungated 1Hz log
      // accumulates thousands of retained console entries over a long show
      // when DevTools is open (perf audit, Jul 2026).
      if (data._diag && (data._diag.dirFwd + data._diag.dirRev) > 0) {
        const nowDir = performance.now();
        if (nowDir - _lastDirLog > 1000) {
          _lastDirLog = nowDir;
          const d = data._diag;
          dlog('worklet', `[dir] fwd=${d.dirFwd} rev=${d.dirRev} dir=${d.dir}`);
        }
      }

      // Log diagnostics at ~1Hz when grains aren't firing (helps debug muting)
      if (data._diag && data.activeCount === 0 && data.grains.length === 0) {
        const now = performance.now();
        if (now - _lastDiagLog > 1000) {
          _lastDiagLog = now;
          const d = data._diag;
          // Debug-level diag — useful when actively troubleshooting, not noisy otherwise
          if (d.candCount === 0) {
            console.debug('[worklet] no grains — 0 candidates (cursor outside radius or buffer not mapped)');
          } else if (d.periodSmp === 0) {
            console.warn('[worklet] no grains — period=0 (params not applied)');
          } else {
            console.debug('[worklet] no grains —', d);
          }
          dlog('worklet', 'no grains firing', d);
        }
      }

    }
  };

  // ── Route worklet outputs to speaker system ─────────────────────────
  // The worklet does VBAP internally — each grain writes to the correct
  // output channel.  Output 0 = cursor grains, output 1 = seed grains.
  //
  // Multi-channel (Electron, S.speakerBuses present):
  //   Split each N-channel output via ChannelSplitter → per-speaker buses.
  //   This preserves the worklet's per-channel VBAP panning through to the
  //   merger → capture worklet → RtAudio path.
  //   Also connect output 0 → monitorBus for headphone/mixdown monitoring.
  //
  // Stereo/browser (no speaker buses):
  //   Output 0 → monitorBus → headphones, output 1 → houseBus → master.

  const speakerBuses = S.speakerBuses;  // array of { bus, angleDeg, angleRad }
  const monBus   = S.monitorBus;
  const houseBus = S.houseBus;

  if (speakerBuses && speakerBuses.length > 0 && numChannels > 2) {
    // ── Multi-channel (>2): split worklet outputs into per-speaker buses ──
    const nHouse = speakerBuses.length;

    // Seed output (output 1) → split → house speaker buses
    const seedSplitter = actx.createChannelSplitter(numChannels);
    _workletNode.connect(seedSplitter, 1);  // worklet output 1 → splitter
    for (let ch = 0; ch < nHouse; ch++) {
      seedSplitter.connect(speakerBuses[ch].bus, ch);  // channel ch → speaker bus ch
    }

    // Cursor output (output 0) → split → house speaker buses (for spatial playback)
    const cursorSplitter = actx.createChannelSplitter(numChannels);
    _workletNode.connect(cursorSplitter, 0);  // worklet output 0 → splitter
    for (let ch = 0; ch < nHouse; ch++) {
      cursorSplitter.connect(speakerBuses[ch].bus, ch);
    }

    // Also route cursor to monitorBus for headphone/mixdown monitoring.
    // This is a stereo downmix (N→2) which is fine for headphones.
    if (monBus) _workletNode.connect(monBus, 0);

    // Store splitters for cleanup on stop
    _workletSplitters = [seedSplitter, cursorSplitter];
  } else if (speakerBuses && speakerBuses.length > 0) {
    // ── Stereo Electron path (2 channels with speaker buses) ─────────
    // In Electron, masterGain doesn't connect to destination — audio must
    // reach the speaker buses → merger → capture worklet → RtAudio.
    // The worklet outputs stereo (L/R in channels 0/1) — route each
    // output's channels directly to the corresponding speaker bus.
    const nBuses = speakerBuses.length;
    // Output 0 (cursor) → speaker buses via splitter
    const cursorSplitter = actx.createChannelSplitter(numChannels);
    _workletNode.connect(cursorSplitter, 0);
    for (let ch = 0; ch < Math.min(numChannels, nBuses); ch++) {
      cursorSplitter.connect(speakerBuses[ch].bus, ch);
    }
    // Output 1 (seeds) → speaker buses via splitter
    const seedSplitter = actx.createChannelSplitter(numChannels);
    _workletNode.connect(seedSplitter, 1);
    for (let ch = 0; ch < Math.min(numChannels, nBuses); ch++) {
      seedSplitter.connect(speakerBuses[ch].bus, ch);
    }
    // Also feed monitorBus so metering and stereo mixdown still work
    if (monBus) _workletNode.connect(monBus, 0);
    _workletSplitters = [cursorSplitter, seedSplitter];
  } else if (monBus && houseBus) {
    // ── Browser stereo path (no speaker buses) ───────────────────────
    _workletNode.connect(monBus, 0);    // output 0 → monitor
    _workletNode.connect(houseBus, 1);  // output 1 → house
    _workletSplitters = null;
  } else {
    // No bus system (shouldn't happen in normal startup, but safe fallback)
    _workletNode.connect(actx.destination);
    _workletSplitters = null;
  }

  // ── Send VBAP lookup table to worklet (if multi-channel) ────────────
  // The worklet needs the VBAP LUT for per-grain speaker routing.
  // packVBAPLookup() returns the flat Float32Array if the LUT is built.
  if (numChannels > 2) {
    const lutData = packVBAPLookup();
    if (lutData) {
      _workletNode.port.postMessage({ type: 'vbapLUT', data: lutData, numChannels });
      dlog('worklet', `VBAP LUT sent (${numChannels} channels)`);
    }
  }

  // ── Register param forwarding callback on S ─────────────────────────
  // Called from ui-presets.js setGrainParam / syncGrainControlsUI whenever
  // a slider changes or a preset is selected while the worklet is active.
  S._updateWorkletParams = (params) => {
    if (!_workletNode) return;
    _workletNode.port.postMessage({ type: 'params', ...params });
  };

  // ── Speaker bus rebuild callback ────────────────────────────────────
  // Called from audio.js when speaker buses are (re)configured.
  // Reconnects the worklet's audio output to the new buses and re-sends
  // the VBAP lookup table.  Without this, initSpeakerBuses tears down
  // the old buses and the worklet output goes to dead nodes.
  S._onVBAPRebuilt = (nCh) => {
    if (!_workletNode) return;

    // If the channel count changed, the AudioWorkletNode must be recreated —
    // outputChannelCount is immutable after construction.  Defer to main.js
    // which stops, recreates, and re-sends all buffers.
    if (nCh !== numChannels) {
      dlog('worklet', `channel count changed ${numChannels} → ${nCh} — restarting worklet`);
      console.log(`worklet: channel count changed ${numChannels} → ${nCh} — restarting`);
      S._restartWorkletEngine?.();
      return;
    }

    // Re-send VBAP LUT if multi-channel
    if (nCh > 2) {
      const lutData = packVBAPLookup();
      if (lutData) {
        _workletNode.port.postMessage({ type: 'vbapLUT', data: lutData, numChannels: nCh });
        dlog('worklet', `VBAP LUT re-sent (${nCh} channels)`);
      }
    }

    // Disconnect old splitters
    if (_workletSplitters) {
      _workletSplitters.forEach(sp => { try { sp.disconnect(); } catch (_) {} });
      _workletSplitters = null;
    }

    // Reconnect worklet output to the new speaker buses
    const newBuses = S.speakerBuses;
    const newMon   = S.monitorBus;
    if (newBuses && newBuses.length > 0) {
      const nBuses = newBuses.length;
      const cursorSp = actx.createChannelSplitter(numChannels);
      _workletNode.connect(cursorSp, 0);
      for (let ch = 0; ch < Math.min(numChannels, nBuses); ch++) {
        cursorSp.connect(newBuses[ch].bus, ch);
      }
      const seedSp = actx.createChannelSplitter(numChannels);
      _workletNode.connect(seedSp, 1);
      for (let ch = 0; ch < Math.min(numChannels, nBuses); ch++) {
        seedSp.connect(newBuses[ch].bus, ch);
      }
      if (newMon) _workletNode.connect(newMon, 0);
      _workletSplitters = [cursorSp, seedSp];
      dlog('worklet', `reconnected to ${nBuses} speaker buses (${numChannels} ch)`);
    }
  };

  // ── Register candidate posting callback on S ────────────────────────
  // Called from grain.js scheduleGrains() at ~50Hz with the current
  // candidate pool (already filtered by radius/k/recency).
  // ── Cursor voice buckets (docs/archive/BRUSH-MODEL.md step 3) ──────────────────
  // A stroke freezes the brush that painted it, so one sweep of the cursor can
  // cross material wanting different grain params — different DENSITY above
  // all, which is per-voice and cannot be faked per grain. So the pool is
  // bucketed by `p._vo` and posted as one voice per distinct voicing.
  //
  // Bucketed HERE rather than in grain.js on purpose: this function already
  // walks the pool once per tick to resolve buffers and spatialisation, so
  // bucketing rides along for free and the 20 ms scheduler is untouched.
  // Buckets are module-level and truncated rather than reallocated, so the
  // per-tick allocation is unchanged from the single-list version.
  const _voBuckets = new Map();     // voicingId -> { list, maxStroke }
  const _voFree = [];               // retired bucket arrays, reused next tick

  // ── The mark is where the grain PEAKS (Ek, 2026-09-02) ───────────────
  // A mark stores its moment; the grain that plays it starts EARLY by the
  // time that voice's envelope takes to peak (brush-voicing.js,
  // grainPeakOffsetS), so the point the dot shows is the point heard when
  // the cursor rests on it. Done here, per candidate, from the voice that
  // will play it — the mark's frozen voicing, or a cloud's own block for a
  // mark with no voicing — so a different engine reading the same mark still
  // peaks on it. Dry voicings
  // never change, so their offsets are cached; voicing 0 follows the live
  // params and is recomputed once per post; a LIVE voicing's params move with
  // its brush's knobs, and brush-voicing.js says so through
  // `S._voicingChanged`, which drops that entry (0 drops them all). A session
  // import swaps the voicing set, which drops the cache.
  let _peakOffCache = new Map();
  let _peakOffFor = null;
  const _peakOffsetFor = (vo) => {
    if (S.voicings !== _peakOffFor) { _peakOffCache = new Map(); _peakOffFor = S.voicings; }
    let off = _peakOffCache.get(vo);
    if (off === undefined) {
      off = S._peakOffsetForVoicing?.(vo) ?? 0;
      if (vo) _peakOffCache.set(vo, off);
    }
    return off;
  };
  S._voicingChanged = (vo) => { if (vo) _peakOffCache.delete(vo); else _peakOffCache.clear(); };

  S._postWorkletCandidates = (pool, cursorLon, cursorLat) =>
    (_ctI ? _postCandidatesTable : _postCandidatesMsg)(pool, cursorLon, cursorLat);

  // The voicing a mark is READ with. A painted mark's own (`_vo`, frozen at
  // its stroke's start; 0 = the live params). A TRIGGER's mark has no grain
  // voicing of its own: a tape brush froze whatever grain block happened to be
  // live when the stroke was recorded, which nothing displays and no setting
  // owns. Under dwell `grain` the trigger opens to the cursor, and it reads
  // with the LIVE grain block — the grain brush in the palette, live or dry —
  // so the sound of a dwelling trigger is the brush you can see (Ek,
  // 2026-09-06: a trigger is a view onto a stroke and owns nothing).
  const _voiceOf = p => (p.trig ? 0 : (p._vo ?? 0));

  // The table path (R3). Two passes over the pool: the first counts marks and
  // the newest stroke per voicing, so the voice cap keeps the most RECENT
  // voicings (the rule the message path applied); the second writes rows.
  const _ctVoCount = new Map(), _ctVoMax = new Map(), _ctVoSlot = new Map();
  function _postCandidatesTable(pool, cursorLon, cursorLat) {
    if (!_workletNode) return;
    S._syncLiveVoicing?.();
    const ctI = _ctI, ctF = _ctF;
    _ctCount.fill(0);
    _ctVoCount.clear(); _ctVoMax.clear(); _ctVoSlot.clear();
    const n = pool ? pool.length : 0;
    // Pass 1: which voicings, how many marks each, and their newest stroke.
    for (let i = 0; i < n; i++) {
      const p = pool[i], vo = _voiceOf(p);
      _ctVoCount.set(vo, (_ctVoCount.get(vo) || 0) + 1);
      if ((p.strokeId | 0) > (_ctVoMax.get(vo) ?? -1)) _ctVoMax.set(vo, p.strokeId | 0);
    }
    // Slots: vo 0 is region 0; the others get 1..8, most recent first.
    const vos = [];
    for (const vo of _ctVoCount.keys()) if (vo) vos.push(vo);
    if (vos.length > MAX_CURSOR_VOICES) { vos.sort((a, b) => _ctVoMax.get(b) - _ctVoMax.get(a)); vos.length = MAX_CURSOR_VOICES; }
    for (let k = 0; k < vos.length; k++) _ctVoSlot.set(vos[k], k + 1);
    if (_ctVoCount.has(0)) _ctVoSlot.set(0, 0);
    // Pass 2: rows into the unpublished half of each region.
    const sr = _sabSampleRate;
    const fadeOn = S.radiusFadeEnabled && S.lensMode !== 'nearest' && S.searchRadiusDeg > 0;
    const fadeRad = S.searchRadiusDeg * Math.PI / 180;
    const fadeExp = 1 + (S.radiusFadeCurve ?? 0.5) * 3;
    const offLive = _peakOffsetFor(0);
    let skipNoBuf = 0, skipNoMap = 0;
    for (let i = 0; i < n; i++) {
      const p = pool[i];
      const vo = _voiceOf(p);
      const region = _ctVoSlot.get(vo);
      if (region === undefined) continue;                  // beyond the voice cap
      let audioBuf = null;
      if (p.source === 'live' && p.liveBufferIdx >= 0 && p.liveBufferIdx < S.liveRecBuffers.length) {
        const slot = S.liveRecBuffers[p.liveBufferIdx];
        audioBuf = slot?.buffer || slot?.liveBuffer;
      } else if (p.source === 'sample' && p.sampleIndex >= 0 && p.sampleIndex < S.samples.length) {
        audioBuf = S.samples[p.sampleIndex]?.buffer;
      }
      if (!audioBuf) { skipNoBuf++; continue; }
      const bufIndex = _bufferMap.get(audioBuf);
      if (bufIndex === undefined) { skipNoMap++; continue; }
      const c = _ctCount[region];
      if (c >= CT_ROWS) { _ctTruncated++; continue; }
      const bufLen = audioBuf.length;
      const peakOff = vo ? _peakOffsetFor(vo) : offLive;
      const offsetSamples = Math.max(0, Math.min(Math.round(((p.grainStart ?? 0) - peakOff) * sr), bufLen - 1));
      const sp = _spatialForParticle(p.lon, p.lat);
      let radiusFade = 1.0;
      if (fadeOn) { const t = Math.min(1, (p._ang ?? 0) / fadeRad); radiusFade = Math.pow(1 - t, fadeExp); }
      const hdr = region * CT_REGION;
      const half = 1 - ctI[hdr];
      const w = hdr + CT_HEADER + half * CT_HALF + c * CT_WORDS;
      ctI[w]     = bufIndex;
      ctI[w + 1] = offsetSamples;
      ctI[w + 2] = bufLen;
      ctF[w + 3] = sp.azDeg;
      ctF[w + 4] = sp.elBias;
      ctI[w + 5] = p._globalIdx ?? i;
      ctF[w + 6] = radiusFade;
      // IN THE ORDER IT WAS MADE: the stroke, then the mark's place on the
      // stroke's own clock (`takeT`, the path order a looping sample stroke
      // keeps; its grainStart rewinds at each seam). Offset alone ordered
      // marks by where they sit in the BUFFER, so a stroke painted second
      // from earlier in a file stepped before the one painted first.
      _ctOrd[region * CT_ROWS + c] = (p.strokeId | 0) * 1e6 + (p.takeT ?? p.grainStart ?? 0);
      _ctCount[region] = c + 1;
    }
    // Step mode needs the rows in the order they were made: a permutation per region,
    // sorted only when the lens asks for step (random reads the rows as is).
    const kSeq = !!S.grainKSeqMode;
    for (let r = 0; r < CT_REGIONS; r++) {
      const hdr = r * CT_REGION, half = 1 - ctI[hdr], cnt = _ctCount[r];
      const base = hdr + CT_HEADER + half * CT_HALF;
      if (kSeq && cnt > 1) {
        const perm = _ctPerm.subarray(0, cnt);
        for (let k = 0; k < cnt; k++) perm[k] = k;
        const ob = r * CT_ROWS;
        perm.sort((a, b) => _ctOrd[ob + a] - _ctOrd[ob + b]);
        ctI.set(perm, base + CT_ROWS * CT_WORDS);
      } else if (cnt > 0) {
        for (let k = 0; k < cnt; k++) ctI[base + CT_ROWS * CT_WORDS + k] = k;
      }
      // Publish: the count of the half, then the half itself, then the generation.
      Atomics.store(ctI, hdr + 1 + half, cnt);
      Atomics.store(ctI, hdr, half);
      Atomics.add(ctI, hdr + 3, 1);
    }
    const voices = [];
    for (let k = 0; k < vos.length; k++) {
      if (_ctCount[k + 1] === 0) continue;
      voices.push({ slot: k + 1, vo: vos[k], params: S._voicingById?.(vos[k])?.params || null });
    }
    if (n > 0 && _ctCount[0] === 0 && voices.length === 0 && !_postedOnce) {
      dlog('worklet', `all ${n} candidates filtered out`, { noBuf: skipNoBuf, noMap: skipNoMap, bufMapSize: _bufferMap.size });
    }
    if (!_postedOnce && (voices.length || _ctCount[0])) { _postedOnce = true; dlog('worklet', 'first candidates written to the tables', { regions: voices.length + (_ctCount[0] ? 1 : 0) }); }
    _workletNode.port.postMessage({ type: 'cursorVoicesTab', voices, liveActive: _ctCount[0] > 0, kSeqMode: kSeq });
  }

  /** The rows as objects, read back from the published halves — for the
   *  console and the audits (getWorkletDiag), never on the tick. */
  function _readBackCandidates() {
    if (!_ctI) return _lastPostedCandidates;
    const out = [];
    for (let r = 0; r < CT_REGIONS; r++) {
      const hdr = r * CT_REGION, half = _ctI[hdr], cnt = _ctI[hdr + 1 + half];
      const base = hdr + CT_HEADER + half * CT_HALF;
      for (let k = 0; k < cnt; k++) {
        const w = base + k * CT_WORDS;
        out.push({ region: r, bufIndex: _ctI[w], offset: _ctI[w + 1], length: _ctI[w + 2], azDeg: _ctF[w + 3], elBias: _ctF[w + 4], particleId: _ctI[w + 5], radiusFade: _ctF[w + 6],
                   // Where this row falls in step order (the region's permutation).
                   stepAt: Array.prototype.indexOf.call(_ctI.subarray(base + CT_ROWS * CT_WORDS, base + CT_ROWS * CT_WORDS + cnt), k) });
      }
    }
    return out;
  }
  S._readBackCandidates = _readBackCandidates;

  // The message path: the pre-R3 post, kept whole for a page without SharedArrayBuffer.
  function _postCandidatesMsg(pool, cursorLon, cursorLat) {
    if (!_workletNode) return;
    // Auditioned paint rides the tick: if what is playing is live, its voicing
    // is brought up to the live block here, before its params are posted
    // below — so a pot, an OSC value or a sheet row moves every stroke that
    // brush painted within one tick. ~22 compares when nothing has moved.
    S._syncLiveVoicing?.();
    // Always post — even an empty pool must clear stale worklet candidates
    if (!pool || pool.length === 0) {
      _workletNode.port.postMessage({ type: 'cursorVoices', list: [] });
      return;
    }
    for (const b of _voBuckets.values()) { b.list.length = 0; _voFree.push(b.list); }
    _voBuckets.clear();
    const list = [];
    const sr = _sabSampleRate;
    // Radius fade — same curve as stampSeedRadiusFade() in ui-presets.js, but
    // computed live: the cursor moves every tick, so a stamp would be stale.
    // Nearest mode has no radius to fade against, which is why the UI forces
    // the toggle off there (ui-meters.js syncUI) — mirror that here.
    const fadeOn = S.radiusFadeEnabled && S.lensMode !== 'nearest' && S.searchRadiusDeg > 0;
    const fadeRad = S.searchRadiusDeg * Math.PI / 180;
    const fadeExp = 1 + (S.radiusFadeCurve ?? 0.5) * 3;
    let _skipNoBuf = 0, _skipNoMap = 0;
    const offLive = _peakOffsetFor(0);
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];

      // Bucket by voicing. `_vo` is absent only on material that predates
      // step 3 and has not been through the import migration; 0 means
      // "follow the live params", which is the pre-step-3 behaviour. There is
      // no override any more: audition and the grain filter both forced every
      // mark onto voicing 0 here, and both are gone (2026-09-03) — a live
      // brush's strokes move because their own voicing's params move, above.
      // Resolved up here because the peak offset below is the playing
      // voice's, not the painting one's.
      const vo = _voiceOf(p);
      const peakOff = vo ? _peakOffsetFor(vo) : offLive;

      // Resolve the particle's AudioBuffer and map to worklet buffer index.
      // During active recording, slot.buffer is null — fall back to slot.liveBuffer
      // which maps to the provisional buffer (bufIndex -2) in the worklet.
      let audioBuf = null;
      if (p.source === 'live' && p.liveBufferIdx >= 0 && p.liveBufferIdx < S.liveRecBuffers.length) {
        const slot = S.liveRecBuffers[p.liveBufferIdx];
        audioBuf = slot?.buffer || slot?.liveBuffer;
      } else if (p.source === 'sample' && p.sampleIndex >= 0 && p.sampleIndex < S.samples.length) {
        audioBuf = S.samples[p.sampleIndex]?.buffer;
      }
      if (!audioBuf) { _skipNoBuf++; continue; }
      const bufIndex = _bufferMap.get(audioBuf);
      if (bufIndex === undefined) { _skipNoMap++; continue; }  // buffer not sent to worklet

      // Use audioBuf.length for offset clamping (upper safety bound).
      // For live buffers (-2), don't clamp to _provisionalSentLen — the
      // worklet tracks its own _liveBufLen (may be more current due to async
      // append delivery) and handles frontier grains at fire time, clamping
      // duration or dropping grains with <64 available samples.
      const bufLen = audioBuf.length;
      // Clamped at 0: the first peak-offset of a take cannot start early
      // enough, and its marks' peaks drift late by the shortfall.
      const offsetSamples = Math.max(0, Math.min(
        Math.round(((p.grainStart ?? 0) - peakOff) * sr),
        bufLen - 1
      ));

      const sp = _spatialForParticle(p.lon, p.lat);

      // p._ang is the angular distance to the cursor, stamped this tick by the
      // scheduler (grain.js). Reuse it rather than recomputing the great-circle.
      let radiusFade = 1.0;
      if (fadeOn) {
        const t = Math.min(1, (p._ang ?? 0) / fadeRad);
        radiusFade = Math.pow(1 - t, fadeExp);
      }

      const cand = {
        bufIndex,
        offset:      offsetSamples,
        length:      bufLen,
        azDeg:  sp.azDeg,
        elBias: sp.elBias,
        particleId:  p._globalIdx ?? i,
        radiusFade,
        ord: (p.strokeId | 0) * 1e6 + (p.takeT ?? p.grainStart ?? 0),   // step order — see _ctOrd
      };
      list.push(cand);
      let bucket = _voBuckets.get(vo);
      if (!bucket) {
        bucket = { list: _voFree.pop() || [], maxStroke: -1 };
        _voBuckets.set(vo, bucket);
      }
      bucket.list.push(cand);
      if (p.strokeId > bucket.maxStroke) bucket.maxStroke = p.strokeId;
    }
    // Sort by when each mark was made, so step walks them in that order (_ctOrd)
    list.sort((a, b) => a.ord - b.ord);
    // Log when all candidates are filtered out (common root cause of silence)
    if (list.length === 0 && pool.length > 0) {
      dlog('worklet', `all ${pool.length} candidates filtered out`, {
        noBuf: _skipNoBuf, noMap: _skipNoMap,
        bufMapSize: _bufferMap.size,
        sample0: pool[0] ? { src: pool[0].source, lbIdx: pool[0].liveBufferIdx } : null,
      });
    }
    // Log once when candidates first arrive (debugging cold-start flow)
    if (list.length > 0 && _lastPostedCandidates.length === 0) {
      dlog('worklet', `first candidates posted: ${list.length}`, {
        bufIndices: [...new Set(list.map(c => c.bufIndex))],
        sampleOffsets: list.slice(0, 3).map(c => c.offset),
      });
    }
    // Expose last posted candidates for console debugging
    _lastPostedCandidates = list;

    // Resolve each bucket to a voice. Params ride with the voice every tick,
    // which is what S._postWorkletSeeds already does for its 16 seeds — same
    // message shape, same cost profile, one fewer thing to reason about.
    let buckets = [..._voBuckets.entries()];
    if (buckets.length > MAX_CURSOR_VOICES) {
      // More distinct settings under the cursor than there are voices. Keep the
      // most RECENT, which is the rule `recencyN` already applies to buffers —
      // the newest layer is the one the player is working on.
      buckets.sort((a, b) => b[1].maxStroke - a[1].maxStroke);
      buckets.length = MAX_CURSOR_VOICES;
    }
    const voices = [];
    for (const [vo, b] of buckets) {
      if (b.list.length === 0) continue;
      b.list.sort((x, y) => x.ord - y.ord);
      voices.push({ vo, params: S._voicingById?.(vo)?.params || null, candidates: b.list });
    }
    // Order (random | step) is the lens's, live — sent once per post and
    // applied to every cursor voice worklet-side, so frozen voicings never
    // pin it (#233).
    _workletNode.port.postMessage({ type: 'cursorVoices', list: voices, kSeqMode: !!S.grainKSeqMode });
  }

  // ── Register seed posting callback on S ────────────────────────────
  // Called from grain.js at ~50Hz with active seed data (pool, params, gain).
  //
  // A cloud is a moving cursor (Ek, 2026-09-05: "the pin is just a moving
  // cursor — if I change the material under it, it should change"). So a
  // cloud reads each mark with the MARK's voicing, exactly as the cursor does
  // above: its pool is bucketed by `p._vo` and posted as one worklet voice per
  // voicing, and a live brush's knobs reach the wash cloud's material through
  // its live voicing while a dry stroke the cloud crosses keeps its frozen
  // sound. Before this the cloud played everything under it with the block it
  // was pinned with, which is what a mark with NO voicing (or a voicing this
  // session does not have) still plays with — `sd.grainParams`. The cloud's
  // morph overrides land on top of whichever block plays.
  //
  // Voices are allocated by KEY (slot, voicing) and kept between ticks, so a
  // voice's onset clock runs on while its cloud reads the same material; a
  // key not seen this tick gives its index back. Per cloud the cursor's cap
  // applies (MAX_CURSOR_VOICES, most recent strokes kept); across clouds the
  // worklet's MAX_SEED_VOICES — a bucket that finds no free voice is silent
  // this tick, never doubled onto another.
  const _sdBuckets = new Map();     // voicingId -> { list, maxStroke }, per cloud
  const _sdFree = [];               // retired bucket arrays, reused
  const _sdVoiceOf = new Map();     // "slot:vo" -> worklet seed voice index
  const _sdVoiceFree = [];          // free worklet seed voice indices
  for (let i = MAX_SEED_VOICES - 1; i >= 0; i--) _sdVoiceFree.push(i);
  const _sdSeen = new Set();        // keys posted this tick
  const DIR_MAP  = { fwd: 0, rev: 1, rand: 2, rnd: 2 };
  const CURVE_MAP = { hann: 0, tri: 1, rect: 2 };
  const _seedVoiceParams = (gp, kSeqMode) => ({
    period:           gp.period ?? 0.050,
    duration:         gp.duration ?? 0.100,
    volume:           gp.volume ?? 0.8,
    pitchShift:       gp.pitchShift ?? 0,
    pitchJitter:      gp.pitchJitter ?? 0,
    periodVar:        gp.periodVar ?? 0,
    durVar:           gp.durVar ?? 0,
    durJitter:        gp.durJitter ?? 0,
    startJitter:      gp.startJitter ?? 0,
    fadeRatio:        gp.fadeRatio ?? 0.5,
    fadeMode:         gp.fadeMode === 'ms' ? 1 : 0,
    fadeMs:           gp.fadeMs ?? 0.020,
    envShape:         CURVE_MAP[gp.curveType] ?? gp.envShape ?? 0,
    probability:      gp.probability ?? 1.0,
    direction:        DIR_MAP[gp.direction] ?? gp.direction ?? 0,
    // A frozen block carries the worklet's int; a UI-shaped one the switch
    // and the mode (the same two forms `envShape` / `curveType` take above).
    filterType:       gp.filterType ?? (gp.filterOn ? FILTER_TYPE_OF[gp.filterMode] ?? 1 : 0),
    cutoff:           gp.cutoff ?? 1000,
    res:              gp.res ?? 0,
    filterFreqJitter: gp.filterFreqJitter ?? 0,
    kSeqMode:         kSeqMode ?? false,
    panSpread:        gp.panSpread ?? 0,
  });
  S._postWorkletSeeds = (seeds) => {
    if (!_workletNode) return;
    // The cursor post syncs the hand's live voicing before posting; the seed
    // post does the same, so a wash cloud follows its live brush's knobs even
    // while the cursor posts nothing (scan muted, nothing in reach). Cheap
    // when nothing has moved.
    S._syncLiveVoicing?.();
    const sr = _sabSampleRate;
    const list = [];
    _sdSeen.clear();
    for (let i = 0; i < seeds.length; i++) {
      const sd = seeds[i];
      if (!sd) continue;
      const slot = sd.slotIndex ?? i;
      const pool = sd.pool;
      // Radius fade, computed live from the per-slot angle cache the scheduler
      // stamps each tick (grain.js). Replaces the old `_cFade{slot}` stamp,
      // which was only written at plant/import time and so went stale for
      // moving clouds and missed particles recorded after the plant.
      const sFadeOn  = !!sd.fadeOn && sd.fadeRad > 0 && !!sd.angKey;
      const sAngKey  = sd.angKey;
      const sFadeExp = 1 + (sd.fadeCurve ?? 0.5) * 3;
      // A mark with no voicing plays with the cloud's own block, so its grain
      // starts early by that block's peak offset; a voiced mark by its
      // voicing's — the same rule as the cursor, see _peakOffsetFor.
      const ownGP = sd.grainParams || {};
      const ownPeakOff = S._grainPeakOffsetS?.(ownGP) ?? 0;
      for (const b of _sdBuckets.values()) { b.list.length = 0; _sdFree.push(b.list); }
      _sdBuckets.clear();
      if (pool) {
        for (let j = 0; j < pool.length; j++) {
          const p = pool[j];
          let vo = p._vo ?? 0;
          if (vo && !S._voicingById?.(vo)) vo = 0;
          const peakOff = vo ? _peakOffsetFor(vo) : ownPeakOff;
          let audioBuf = null;
          if (p.source === 'live' && p.liveBufferIdx >= 0 && p.liveBufferIdx < S.liveRecBuffers.length) {
            const slot = S.liveRecBuffers[p.liveBufferIdx];
            audioBuf = slot?.buffer || slot?.liveBuffer;
          } else if (p.source === 'sample' && p.sampleIndex >= 0 && p.sampleIndex < S.samples.length) {
            audioBuf = S.samples[p.sampleIndex]?.buffer;
          }
          if (!audioBuf) continue;
          const bufIndex = _bufferMap.get(audioBuf);
          if (bufIndex === undefined) continue;  // buffer not sent to worklet
          const bufLen = audioBuf.length;
          const offsetSamples = Math.max(0, Math.min(
            Math.round(((p.grainStart ?? 0) - peakOff) * sr),
            bufLen - 1
          ));
          const sp = _spatialForParticle(p.lon, p.lat);
          let fade = 1.0;
          if (sFadeOn) {
            const t = Math.min(1, (p[sAngKey] ?? 0) / sd.fadeRad);
            fade = Math.pow(1 - t, sFadeExp);
          }
          let b = _sdBuckets.get(vo);
          if (!b) { b = { list: _sdFree.pop() || [], maxStroke: -1 }; _sdBuckets.set(vo, b); }
          const sid = p.strokeId ?? 0;
          if (sid > b.maxStroke) b.maxStroke = sid;
          b.list.push({
            bufIndex, offset: offsetSamples, length: bufLen,
            azDeg: sp.azDeg, elBias: sp.elBias,
            particleId: p._globalIdx ?? j, radiusFade: fade,
            ord: (sid | 0) * 1e6 + (p.takeT ?? p.grainStart ?? 0),   // step order — see _ctOrd
          });
        }
      }
      let buckets = [..._sdBuckets.entries()];
      if (buckets.length > MAX_CURSOR_VOICES) {
        buckets.sort((a, b) => b[1].maxStroke - a[1].maxStroke);
        buckets.length = MAX_CURSOR_VOICES;
      }
      for (const [vo, b] of buckets) {
        if (b.list.length === 0) continue;
        const key = slot + ':' + vo;
        let index = _sdVoiceOf.get(key);
        if (index === undefined) {
          index = _sdVoiceFree.pop();
          if (index === undefined) continue;    // no voice free — silent this tick
          _sdVoiceOf.set(key, index);
        }
        _sdSeen.add(key);
        // Sort by when each mark was made, so step walks them in that order (_ctOrd)
        b.list.sort((x, y) => x.ord - y.ord);
        let gp = vo ? S._voicingById(vo).params : ownGP;
        if (sd.overrides) gp = Object.assign(Object.create(gp), sd.overrides);
        list.push({
          index, active: true, gain: sd.gain ?? 1.0, slot, vo,
          candidates: b.list.slice(),
          params: _seedVoiceParams(gp, sd.kSeqMode),
        });
      }
    }
    for (const [key, index] of _sdVoiceOf) {
      if (!_sdSeen.has(key)) { _sdVoiceOf.delete(key); _sdVoiceFree.push(index); }
    }
    _lastPostedSeeds = list;
    _workletNode.port.postMessage({ type: 'seeds', list });
  };

  // ── Spare live chunks (R5) ──────────────────────────────────────────
  // Allocated on this thread and transferred; the worklet pops one when a take
  // outgrows a chunk. `spareLow` on the feedback is the request for the next.
  function _sendSpareChunk() {
    if (!_workletNode || !(_liveChunkSize > 0)) return;
    const buffer = new ArrayBuffer(_liveChunkSize * 4);
    try { _workletNode.port.postMessage({ type: 'liveSpare', buffer }, [buffer]); } catch (_) {}
  }

  // ── Provisional live buffer: stream in-progress recording to worklet ─
  // Called when recording starts while the worklet is already running.
  // Allocates a provisional buffer (bufIndex -2) in the worklet.
  S._beginProvisionalRecording = () => {
    if (!_workletNode) return;
    // Cancel any pending deferred liveBufferClear from a previous hotSwap —
    // otherwise it would fire AFTER our liveBufferInit and wipe the fresh buffer.
    if (_deferredClearId) { clearTimeout(_deferredClearId); _deferredClearId = 0; }
    _provisionalLiveRef = null;
    _provisionalSentLen = 0;
    const chunkSize = Math.round(_sabSampleRate * 30); // 30s chunks, grow on demand
    _workletNode.port.postMessage({ type: 'liveBufferInit', chunkSize });
    _liveChunkSize = chunkSize;
    _sendSpareChunk();   // so a take past 30 s pops instead of allocating (R5)

    // Connect mic input directly to the grain worklet so it accumulates
    // live audio at audio rate — zero latency vs the postMessage path.
    // The worklet's process() writes input[0][0] into its live chunks.
    if (S.inputAnalyser && _workletNode) {
      try {
        S.inputAnalyser.connect(_workletNode);
        _workletNode.port.postMessage({ type: 'liveRecStart' });
        dlog('worklet', 'provisional live buffer + direct mic input connected');
      } catch (e) {
        dlog('worklet', 'mic connect to grain worklet failed', { error: e.message });
      }
    } else {
      dlog('worklet', 'provisional live buffer initialised (postMessage path only)');
    }
  };

  // Called from rebuildLiveBuffer (~50ms) to keep _bufferMap current and
  // optionally stream delta samples to the worklet (fallback path).
  // When direct mic input is active (_liveRecording in the worklet), the
  // worklet ignores liveBufferAppend messages — so we skip the copy+transfer
  // entirely.  The _bufferMap update is still needed so candidate posts can
  // resolve live-buffer particles to bufIndex -2.
  S._onLiveBufferRebuilt = () => {
    if (!_workletNode || !S.isRecording) return;
    const idx = S.currentLiveBufferIdx;
    if (idx < 0 || idx >= S.liveRecBuffers.length) return;
    const slot = S.liveRecBuffers[idx];
    const liveBuf = slot?.liveBuffer;
    if (!liveBuf) return;

    // Update _bufferMap: track the current liveBuffer ref → provisional index -2
    if (liveBuf !== _provisionalLiveRef) {
      if (_provisionalLiveRef) _bufferMap.delete(_provisionalLiveRef);
      _provisionalLiveRef = liveBuf;
      _bufferMap.set(liveBuf, -2);
    }

    // Skip delta append when direct mic input is active — the worklet
    // accumulates audio at audio rate via process(inputs) and would discard
    // these messages anyway.  Only send appends as a fallback when the mic
    // isn't connected to the worklet input (e.g. if inputAnalyser is null).
    if (S.inputAnalyser && _workletNode) return;

    // Delta append fallback: only send new samples since last update.
    const validLen = S.liveBufferSampleCount;
    if (validLen <= _provisionalSentLen) return;

    const channelData = liveBuf.data;
    const delta = validLen - _provisionalSentLen;
    const chunk = new Float32Array(delta);
    chunk.set(channelData.subarray(_provisionalSentLen, validLen));

    // Transfer the chunk's underlying ArrayBuffer (zero-copy to worklet)
    _workletNode.port.postMessage(
      { type: 'liveBufferAppend', data: chunk.buffer, offset: _provisionalSentLen, totalLength: validLen },
      [chunk.buffer]
    );
    _provisionalSentLen = validLen;
  };

  // Called when recording completes. The normal restart flow will send the
  // finalized buffer; this just cleans up the provisional state.
  S._endProvisionalRecording = () => {
    if (_provisionalLiveRef) {
      _bufferMap.delete(_provisionalLiveRef);
      _provisionalLiveRef = null;
    }
    _provisionalSentLen = 0;
    // Disconnect mic from grain worklet and stop live accumulation
    if (S.inputAnalyser && _workletNode) {
      try { S.inputAnalyser.disconnect(_workletNode); } catch (_) {}
    }
    if (_workletNode) {
      _workletNode.port.postMessage({ type: 'liveRecStop' });
      _workletNode.port.postMessage({ type: 'liveBufferClear' });
    }
    dlog('worklet', 'provisional live buffer cleared + mic disconnected');
  };

  // ── The candidate tables (R3): one SAB, viewed here and in the worklet ─
  if (typeof SharedArrayBuffer !== 'undefined') {
    try {
      _ctSab = new SharedArrayBuffer(CT_REGIONS * CT_REGION * 4);
      _ctI = new Int32Array(_ctSab); _ctF = new Float32Array(_ctSab);
      _workletNode.port.postMessage({ type: 'cursorTables', sab: _ctSab });
    } catch (e) { _ctSab = null; _ctI = null; _ctF = null; dlog('worklet', 'candidate tables unavailable — message path', { error: e.message }); }
  }

  // ── Send init message ───────────────────────────────────────────────
  const sr = actx.sampleRate;
  _workletNode.port.postMessage({
    type: 'init',
    sab: _sab,
    sampleRate: sr,
    bufferLength: take.length,
    numChannels,
    maxGrains: S.maxGrains ?? 512,     // the pool and the glow ring (P2)
    params: {
      period:      params.period ?? 0.050,
      duration:    params.duration ?? 0.100,
      grainStart:  params.grainStart ?? 0,
      volume:      params.volume ?? 0.8,
      pitchShift:  params.pitchShift ?? 0,
      pitchJitter: params.pitchJitter ?? 0,
      periodVar:   params.periodVar ?? 0,
      durVar:      params.durVar ?? 0,
      envShape:    params.envShape ?? 0,
      probability: params.probability ?? 1.0,
      direction:   params.direction ?? 0,
      panSpread:   params.panSpread ?? 0,
    },
  });

  // ── Send all other live recording buffers ─────────────────────────────
  // The SAB holds the primary buffer (bufIndex -1 in the worklet).
  // All other live recordings are sent as sampleBufs (bufIndex 0, 1, 2, ...).
  _bufferMap = new Map();
  _bufferMap.set(take, -1);  // primary → SAB

  // Every other take and sample goes by reference: its data is a view over
  // shared memory, so the post shares it — nothing copied, nothing transferred.
  const otherBufs = [];
  if (S.liveRecBuffers) {
    for (let i = 0; i < S.liveRecBuffers.length; i++) {
      const rec = S.liveRecBuffers[i];
      if (!rec?.buffer || rec.buffer === take) continue;
      const idx = otherBufs.length;  // 0-based index into sampleBufs
      _bufferMap.set(rec.buffer, idx);
      otherBufs.push({ data: rec.buffer.data, length: rec.buffer.length });
    }
  }
  if (S.samples) {
    for (let i = 0; i < S.samples.length; i++) {
      const smp = S.samples[i];
      if (!smp?.buffer || _bufferMap.has(smp.buffer)) continue;
      const idx = otherBufs.length;
      _bufferMap.set(smp.buffer, idx);
      otherBufs.push({ data: smp.buffer.data, length: smp.buffer.length });
    }
  }
  if (otherBufs.length > 0) {
    _workletNode.port.postMessage({ type: 'buffers', list: otherBufs });
    dlog('worklet', `shared ${otherBufs.length} additional takes with the worklet`);
  }

  dlog('worklet', 'grain engine started', {
    period: params.period ?? 0.050,
    duration: params.duration ?? 0.100,
    bufferLen: take.length,
    totalBuffers: 1 + otherBufs.length,
    numChannels,
    sr,
  });

  return _workletNode;
}

// ── Update grain parameters ─────────────────────────────────────────────────
export function updateWorkletParams(params) {
  if (!_workletNode) return;
  _workletNode.port.postMessage({ type: 'params', ...params });
}

// ── Hot-swap a sample into the running worklet (#247) ───────────────────────
// The addBuffer half of hotSwapRecording, with none of the live-rec teardown:
// registers ANY take (a dropped file, a sampler take) with a running engine
// so painting from it is audible immediately. Before this, a sample added
// mid-session sat unmapped — candidates hit `bufIndex === undefined` and
// counted into _skipNoMap until the engine restarted. Cold start needs
// nothing from us: _startWorkletEngine rebuilds the map from S.samples.
export function hotSwapSample(take) {
  if (!_workletNode || !take) return false;
  if (_bufferMap.has(take)) return true;
  _registerBuffer(take);
  return true;
}

// ── Hot-swap a finalized recording into the running worklet ─────────────────
// Adds the buffer as a new sampleBuf without stopping/restarting the worklet.
// The provisional live buffer is left in place so active grains drain naturally.
// New candidates will resolve to the finalized buffer on the next post cycle
// because slot.buffer is now set (takes priority over slot.liveBuffer in the
// candidate resolution: `slot?.buffer || slot?.liveBuffer`).
export function hotSwapRecording(take) {
  if (!_workletNode || !take) return false;

  // The sealed take, shared with the worklet in place (see _registerBuffer).
  const newIndex = _registerBuffer(take);

  // Stop live mic accumulation in the worklet and disconnect mic input.
  if (S.inputAnalyser && _workletNode) {
    try { S.inputAnalyser.disconnect(_workletNode); } catch (_) {}
  }
  if (_workletNode) {
    _workletNode.port.postMessage({ type: 'liveRecStop' });
  }

  // Clean up provisional state — don't send liveBufferClear yet,
  // let active grains from -2 finish naturally. Just remove the
  // liveBuffer ref from the map so new candidates use the finalized buffer.
  if (_provisionalLiveRef) {
    _bufferMap.delete(_provisionalLiveRef);
    _provisionalLiveRef = null;
  }
  _provisionalSentLen = 0;

  // Deferred clear: clean up worklet provisional buffer after grains drain.
  // 500ms is generous — longest typical grain duration.
  // Use a cancellable timer so _beginProvisionalRecording can cancel if the
  // user starts a new recording before the 500ms elapses (prevents the clear
  // from wiping the freshly-initialised provisional buffer).
  if (_deferredClearId) clearTimeout(_deferredClearId);
  _deferredClearId = setTimeout(() => {
    _deferredClearId = 0;
    if (_workletNode) {
      _workletNode.port.postMessage({ type: 'liveBufferClear' });
    }
  }, 500);

  dlog('worklet', 'hot-swapped recording', { index: newIndex, duration: take.duration });
  return true;
}

/** Hand one take to the worklet as a sampleBuf and map it. The take's data
 *  is a view over a SharedArrayBuffer (js/take.js), so the post SHARES it:
 *  no copy on either thread and nothing to transfer. Until 2026-09-17 this
 *  copied the take and transferred the copy — the second copy of every live
 *  take, which is what the long-set memory fault was made of. */
function _registerBuffer(take) {
  const newIndex = _sampleBufsCount();
  _workletNode.port.postMessage({ type: 'addBuffer', data: take.data, length: take.length });
  _bufferMap.set(take, newIndex);
  return newIndex;
}

// Count current sampleBufs in the worklet (for index assignment)
function _sampleBufsCount() {
  let count = 0;
  _bufferMap.forEach((idx) => { if (idx >= 0) count = Math.max(count, idx + 1); });
  return count;
}

// ── Flush in-flight grains (erase-all / undo) ─────────────────────────────
// Kills all active grain slots in the worklet without tearing down the engine.
// The worklet's soft flush accelerates active grain envelopes so they fade out
// in ~128 samples instead of clicking.
//
// IMPORTANT: Do NOT clear _bufferMap here.  The worklet still has all its
// buffers (SAB + sampleBufs); only in-flight grains need killing.  Clearing
// the map orphans every finalized AudioBuffer ↔ worklet-index mapping, so
// all subsequent candidate posts silently skip (bufIndex === undefined).
// After undo/erase the particles may be reindexed but the AudioBuffer objects
// (and their worklet indices) remain valid.
export function flushWorkletGrains() {
  if (_workletNode) {
    _workletNode.port.postMessage({ type: 'flush' });
  }
  // Only clear provisional state — the live recording may have been removed
  // by the undo path.  Finalized buffer mappings stay intact.
  // Delete the map entry BEFORE nulling the ref: erasing mid-recording
  // abandons the in-progress liveBuffer, and nulling the handle without
  // deleting the entry orphaned it in _bufferMap forever (group-show noise
  // glitch investigation, Jul 2026). If recording continues, the next
  // _onLiveBufferRebuilt tick (~50ms) re-registers the current liveBuffer.
  if (_provisionalLiveRef) _bufferMap.delete(_provisionalLiveRef);
  _provisionalLiveRef = null;
  _provisionalSentLen = 0;
}

// ── Release dead buffers (sweep-snapshot commit) ────────────────────────────
// THE group-show noise-glitch fix (docs/archive/GROUP-SHOW-NOISE-GLITCH.md, Jul 2026).
// Erase-all / sweep keep worklet buffers alive so undo can restore them.
// Once the snapshot is committed (new stroke, or 30s auto-commit), the
// erased recordings are provably unreachable — but nothing dropped them:
// _sampleBufs in the worklet and _bufferMap here grew monotonically for the
// life of the engine (~200MB over a 50-min show → GC pauses > the 2.7ms
// audio deadline at 128-frame buffers → garbled output).
//
// This walks _bufferMap, keeps buffers still reachable from main-thread
// state (S.liveRecBuffers, S.samples), and drops the rest — posting a
// 'compactBuffers' message so the worklet compacts _sampleBufs with the
// SAME index remapping. The two sides MUST change together: positional
// indices desync otherwise and grains read from the wrong recording.
// Candidate lists carrying old indices are cleared by the worklet and
// reposted by the scheduler within ~20ms.
// Returns the number of buffers dropped.
export function resyncWorkletBuffers() {
  if (!_workletNode) return 0;

  // Buffers still reachable from main-thread state
  const live = new Set();
  if (S.liveRecBuffers) {
    for (const rec of S.liveRecBuffers) {
      if (rec?.buffer) live.add(rec.buffer);
      if (rec?.liveBuffer) live.add(rec.liveBuffer);
    }
  }
  if (S.samples) {
    for (const smp of S.samples) {
      if (smp?.buffer) live.add(smp.buffer);
    }
  }

  // Partition map entries. Negative indices (-1 SAB primary, -2 provisional
  // live) are engine-lifetime slots — never dropped here.
  const keepOld = [];
  const dropKeys = [];
  _bufferMap.forEach((idx, buf) => {
    if (idx < 0) return;
    if (live.has(buf)) keepOld.push(idx);
    else dropKeys.push(buf);
  });
  if (dropKeys.length === 0) return _reregisterMissing(live);
  keepOld.sort((a, b) => a - b);

  // Worklet first (message is queued in order — any 'candidates' post that
  // follows is built against the rebuilt map below, so indices agree).
  _workletNode.port.postMessage({ type: 'compactBuffers', keep: keepOld });

  // Rebuild _bufferMap with the same remapping
  const newIdx = new Map(keepOld.map((old, i) => [old, i]));
  for (const buf of dropKeys) _bufferMap.delete(buf);
  _bufferMap.forEach((idx, buf) => {
    if (idx >= 0) _bufferMap.set(buf, newIdx.get(idx));
  });

  dlog('worklet', `resync: dropped ${dropKeys.length} dead buffers, kept ${keepOld.length}`);
  _reregisterMissing(live);
  return dropKeys.length;
}

// The other direction: a take the main thread holds that the worklet does
// not. Undo of a sweep after its redo restores takes the redo's resync had
// dropped, and until 2026-09-16 nothing re-registered them — every mark on
// them hit `bufIndex === undefined` and was silent until an engine restart.
// AFTER the compaction above, so the new index lands past the kept ones on
// both sides (a buffer added before the `compactBuffers` post would have been
// dropped by it while the map still carried it). Returns 0 for the early
// return above.
function _reregisterMissing(live) {
  let added = 0;
  for (const buf of live) if (!_bufferMap.has(buf)) { _registerBuffer(buf); added++; }
  if (added) dlog('worklet', `resync: re-registered ${added} restored buffer(s)`);
  return 0;
}

// ── Stop the worklet grain engine ───────────────────────────────────────────
export function stopWorkletGrain() {
  if (_workletNode) {
    // Disconnect mic input if still connected
    if (S.inputAnalyser) {
      try { S.inputAnalyser.disconnect(_workletNode); } catch (_) {}
    }
    _workletNode.port.postMessage({ type: 'stop' });
    try { _workletNode.disconnect(); } catch (e) { /* already disconnected */ }
    if (_workletSplitters) {
      _workletSplitters.forEach(s => { try { s.disconnect(); } catch (_) {} });
      _workletSplitters = null;
    }
    _workletNode = null;
    _feedbackCallback = null;
    S._postWorkletCandidates = null;
    S._postWorkletSeeds = null;
    S._updateWorkletParams = null;
    S._onVBAPRebuilt = null;
    S._beginProvisionalRecording = null;
    S._onLiveBufferRebuilt = null;
    dlog('worklet', 'grain engine stopped');
  }
  _sab = null;
  _bufferMap = new Map();
  _lastWorkletDiag = null;
  _provisionalLiveRef = null;
  _provisionalSentLen = 0;
  if (_deferredClearId) { clearTimeout(_deferredClearId); _deferredClearId = 0; }
}

// ── Query state ─────────────────────────────────────────────────────────────
export function isWorkletGrainActive() {
  return _workletNode !== null;
}

/** Set the grain pool (and the glow ring with it). Everything sounding stops:
 *  it is a setting, not a performance control (P2, 2026-09-06). */
export function setMaxGrains(n) {
  S.maxGrains = n;
  _workletNode?.port.postMessage({ type: 'maxGrains', n });
}
S._setMaxGrains = setMaxGrains;

/** Console diagnostic: last posted candidate list + feedback stats. */
export function getWorkletDiag() {
  const candidates = S._readBackCandidates ? S._readBackCandidates() : _lastPostedCandidates;
  return {
    candidates,
    candidateCount: candidates.length,
    tables: !!_ctI,
    tableTruncated: _ctTruncated,
    seeds: _lastPostedSeeds,
    running: _workletNode !== null,
    // Buffer retention (group-show noise glitch): bridge-side AudioBuffer refs
    // and the worklet's own view of its _sampleBufs (via feedback _diag).
    bufMapSize: _bufferMap.size,
    workletDiag: _lastWorkletDiag,
  };
}
