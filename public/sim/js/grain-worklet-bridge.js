// ============================================================================
// GRAIN WORKLET BRIDGE — Phase 2: main-thread interface to the grain engine
//
// Manages the AudioWorkletNode, SharedArrayBuffers, parameter forwarding,
// candidate list posting (50Hz), VBAP LUT transfer, feedback ring reading.
//
// Usage:
//   import { startWorkletEngine, stopWorkletEngine, ... } from './grain-worklet-bridge.js';
//   await startWorkletEngine(audioCtx, recordingBuffer, params);
//   postCandidates(candidateList);   // called from scheduler at 50Hz
//   updateWorkletParams({ period: 0.020, pitchShift: 100 });
//   stopWorkletEngine();
// ============================================================================

import { S, gp } from './state.js';
import { dlog } from './diag.js';
import { activeGrainMap, packVBAPLookup } from './grain.js';
import { cameraTransformInto, spherePointInto } from './sphere.js';

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
    cameraTransformInto(_hlW[0], _hlW[1], _hlW[2], _hlC);
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
let _lastPostedCandidates = [];  // for console debugging

// Multi-buffer support: maps AudioBuffer references to worklet buffer indices.
// SAB (primary) buffer → -1, provisional live buffer → -2, additional buffers → 0, 1, 2, ...
// Rebuilt on every start/restart when all live recordings are sent to the worklet.
let _bufferMap = new Map();   // AudioBuffer → worklet bufIndex
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
 * @param {AudioBuffer} audioBuffer - recording buffer to granulate
 * @param {object} params - initial grain parameters
 * @param {object} [options] - { numChannels, onFeedback }
 * @returns {AudioWorkletNode|null}
 */
export async function startWorkletGrain(actx, audioBuffer, params = {}, options = {}) {
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

  // ── Copy AudioBuffer data into a SharedArrayBuffer ──────────────────
  const channelData = audioBuffer.getChannelData(0); // mono
  const byteLength = channelData.length * Float32Array.BYTES_PER_ELEMENT;

  try {
    _sab = new SharedArrayBuffer(byteLength);
  } catch (e) {
    console.error('grain-worklet-bridge: SharedArrayBuffer creation failed:', e);
    dlog('worklet', 'SAB creation failed', { error: e.message });
    return null;
  }

  const sabView = new Float32Array(_sab);
  sabView.set(channelData);
  _sabSampleRate = audioBuffer.sampleRate;
  _sabLengthSamples = channelData.length;
  _sabAudioBuffer = audioBuffer;
  dlog('worklet', 'SAB created', { samples: channelData.length, bytes: byteLength });

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
      if (data._diag) _lastWorkletDiag = data._diag;

      // Push worklet pool utilisation into the perf monitor so the node
      // meter shows active grain count (replaces stale main-thread node count).
      if (data.activeCount !== undefined) {
        S._grainSourceCount = data.activeCount;
      }

      // Drive visual glow from worklet feedback — these are the particles
      // actually sounding, not the main thread's independent random pick.
      const grains = data.grains;
      if (grains && grains.length > 0) {
        const particles = S.particles;
        const now = performance.now();
        const durMs = (S.grainOverrides.duration ?? gp().duration) * 1000;
        for (let i = 0; i < grains.length; i++) {
          const pid = grains[i];
          const p = particles[pid];
          if (p) activeGrainMap.set(p, { expiry: now + durMs, glowColor: '#ffffff' });
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
  S._postWorkletCandidates = (pool, cursorLon, cursorLat) => {
    if (!_workletNode) return;
    // Always post — even an empty pool must clear stale worklet candidates
    if (!pool || pool.length === 0) {
      _workletNode.port.postMessage({ type: 'candidates', list: [] });
      return;
    }
    const list = [];
    const sr = _sabSampleRate;
    let _skipNoBuf = 0, _skipNoMap = 0;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];

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
      const offsetSamples = Math.max(0, Math.min(
        Math.round((p.grainStart ?? 0) * sr),
        bufLen - 1
      ));

      const sp = _spatialForParticle(p.lon, p.lat);

      list.push({
        bufIndex,
        offset:      offsetSamples,
        length:      bufLen,
        azDeg:  sp.azDeg,
        elBias: sp.elBias,
        particleId:  p._globalIdx ?? i,
        radiusFade:  1.0,
      });
    }
    // Sort by offset (grainStart) so k-seq mode steps through in buffer order
    list.sort((a, b) => a.offset - b.offset);
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
    _workletNode.port.postMessage({ type: 'candidates', list });
  };

  // ── Register seed posting callback on S ────────────────────────────
  // Called from grain.js at ~50Hz with active seed data (pool, params, gain).
  // Each seed has its own candidate list and grain parameters; the worklet
  // runs independent onset clocks per seed.
  S._postWorkletSeeds = (seeds) => {
    if (!_workletNode) return;
    const sr = _sabSampleRate;
    const DIR_MAP  = { fwd: 0, rev: 1, rand: 2, rnd: 2 };
    const CURVE_MAP = { hann: 0, tri: 1, rect: 2 };
    const list = [];
    for (let i = 0; i < seeds.length; i++) {
      const sd = seeds[i];
      if (!sd) continue;
      // Build candidate list for this seed (same buffer mapping as cursor)
      const cands = [];
      const pool = sd.pool;
      const slotIdx = sd.slotIndex ?? i;
      // Per-particle radius fade: look up the cached fade value for this seed slot
      const fadeKey = `_cFade${slotIdx}`;
      if (pool) {
        for (let j = 0; j < pool.length; j++) {
          const p = pool[j];
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
            Math.round((p.grainStart ?? 0) * sr),
            bufLen - 1
          ));
          const sp = _spatialForParticle(p.lon, p.lat);
          const fade = p[fadeKey] ?? 1.0;
          cands.push({
            bufIndex, offset: offsetSamples, length: bufLen,
            azDeg: sp.azDeg, elBias: sp.elBias,
            particleId: p._globalIdx ?? j, radiusFade: fade,
          });
        }
      }
      // Sort by offset (grainStart) so k-seq mode steps through in buffer order
      cands.sort((a, b) => a.offset - b.offset);
      const gp = sd.grainParams || {};
      list.push({
        index: sd.slotIndex ?? i,
        active: true,
        gain: sd.gain ?? 1.0,
        candidates: cands,
        params: {
          period:           gp.period ?? 0.050,
          duration:         gp.duration ?? 0.100,
          volume:           gp.volume ?? 0.8,
          pitchShift:       gp.pitchShift ?? 0,
          pitchJitter:      gp.pitchJitter ?? 0,
          periodVar:        gp.periodVar ?? 0,
          durVar:           gp.durVar ?? 0,
          durJitter:        gp.durJitter ?? 0,
          envShape:         CURVE_MAP[gp.curveType] ?? gp.envShape ?? 0,
          probability:      gp.probability ?? 1.0,
          direction:        DIR_MAP[gp.direction] ?? gp.direction ?? 0,
          hpfFreq:          gp.hpfFreq ?? 20,
          lpfFreq:          gp.lpfFreq ?? 20000,
          filterQ:          gp.filterQ ?? 0.707,
          filterFreqJitter: gp.filterFreqJitter ?? 0,
          kSeqMode:         sd.kSeqMode ?? false,
          panSpread:        gp.panSpread ?? 0,
        },
      });
    }
    _workletNode.port.postMessage({ type: 'seeds', list });
  };

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

    const channelData = liveBuf.getChannelData(0);
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

  // ── Send init message ───────────────────────────────────────────────
  const sr = actx.sampleRate;
  _workletNode.port.postMessage({
    type: 'init',
    sab: _sab,
    sampleRate: sr,
    bufferLength: channelData.length,
    numChannels,
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
  _bufferMap.set(audioBuffer, -1);  // primary → SAB

  const otherBufs = [];
  if (S.liveRecBuffers) {
    for (let i = 0; i < S.liveRecBuffers.length; i++) {
      const rec = S.liveRecBuffers[i];
      if (!rec?.buffer || rec.buffer === audioBuffer) continue;
      const idx = otherBufs.length;  // 0-based index into sampleBufs
      _bufferMap.set(rec.buffer, idx);
      const data = rec.buffer.getChannelData(0);
      otherBufs.push({ data: new Float32Array(data), length: data.length });
    }
  }
  // Also include loaded samples
  if (S.samples) {
    for (let i = 0; i < S.samples.length; i++) {
      const smp = S.samples[i];
      if (!smp?.buffer || _bufferMap.has(smp.buffer)) continue;
      const idx = otherBufs.length;
      _bufferMap.set(smp.buffer, idx);
      const data = smp.buffer.getChannelData(0);
      otherBufs.push({ data: new Float32Array(data), length: data.length });
    }
  }
  if (otherBufs.length > 0) {
    // Transfer list (perf audit H2, Jul 2026): avoids structured-cloning
    // every retained recording on engine start. The Float32Array views
    // arrive intact on the worklet side, backed by the transferred buffers.
    _workletNode.port.postMessage(
      { type: 'buffers', list: otherBufs },
      otherBufs.map(b => b.data.buffer)
    );
    dlog('worklet', `sent ${otherBufs.length} additional buffers to worklet (transferred)`);
  }

  dlog('worklet', 'grain engine started', {
    period: params.period ?? 0.050,
    duration: params.duration ?? 0.100,
    bufferLen: channelData.length,
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

// ── Post candidate particle list (called from scheduler at ~50Hz) ───────────
/**
 * @param {Array} list - [{ bufIndex, offset, length, azDeg, particleId, radiusFade }]
 */
export function postCandidates(list) {
  if (!_workletNode) return;
  _workletNode.port.postMessage({ type: 'candidates', list });
}

// ── Send VBAP lookup table ──────────────────────────────────────────────────
/**
 * @param {Float32Array} lutData - 360×4 = 1440 floats [idxA, idxB, wA, wB] per degree
 * @param {number} numChannels - speaker count
 */
export function postVbapLUT(lutData, numChannels) {
  if (!_workletNode) return;
  _workletNode.port.postMessage({ type: 'vbapLUT', data: lutData, numChannels });
}

// ── Register sample buffers ─────────────────────────────────────────────────
/**
 * @param {Array} buffers - [{ data: Float32Array, length: number }]
 */
export function postSampleBuffers(buffers) {
  if (!_workletNode) return;
  _workletNode.port.postMessage({ type: 'buffers', list: buffers });
}

// ── Hot-swap a finalized recording into the running worklet ─────────────────
// Adds the buffer as a new sampleBuf without stopping/restarting the worklet.
// The provisional live buffer is left in place so active grains drain naturally.
// New candidates will resolve to the finalized buffer on the next post cycle
// because slot.buffer is now set (takes priority over slot.liveBuffer in the
// candidate resolution: `slot?.buffer || slot?.liveBuffer`).
export function hotSwapRecording(audioBuffer) {
  if (!_workletNode || !audioBuffer) return false;

  // Send finalized buffer data to the worklet.
  // Transfer the copy's ArrayBuffer (perf audit H2, Jul 2026): without the
  // transfer list, postMessage structured-clones the entire recording — a
  // third full copy of the take, deserialized ON THE AUDIO THREAD at the
  // exact moment provisional grains are still playing. With the transfer,
  // the worklet receives the same Float32Array view zero-copy.
  const data = audioBuffer.getChannelData(0);
  const newIndex = _sampleBufsCount();
  const copy = new Float32Array(data);
  _workletNode.port.postMessage({
    type: 'addBuffer',
    data: copy,
    length: data.length,
  }, [copy.buffer]);

  // Register in _bufferMap so candidate posting resolves it
  _bufferMap.set(audioBuffer, newIndex);

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

  dlog('worklet', 'hot-swapped recording', { index: newIndex, duration: audioBuffer.duration });
  return true;
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
// THE group-show noise-glitch fix (docs/GROUP-SHOW-NOISE-GLITCH.md, Jul 2026).
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
  if (dropKeys.length === 0) return 0;
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
  return dropKeys.length;
}

/**
 * Flush only cursor-originated grains, leaving seeds alive.
 * Used by undo to immediately silence the undone stroke's audio without
 * disrupting committed clouds/seeds that are still playing.
 */
export function flushCursorGrains() {
  if (_workletNode) {
    _workletNode.port.postMessage({ type: 'flush-cursor' });
  }
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
    S._endProvisionalRecording = null;
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

export function getWorkletNode() {
  return _workletNode;
}

/** Console diagnostic: last posted candidate list + feedback stats. */
export function getWorkletDiag() {
  return {
    candidates: _lastPostedCandidates,
    candidateCount: _lastPostedCandidates.length,
    running: _workletNode !== null,
    // Buffer retention (group-show noise glitch): bridge-side AudioBuffer refs
    // and the worklet's own view of its _sampleBufs (via feedback _diag).
    bufMapSize: _bufferMap.size,
    workletDiag: _lastWorkletDiag,
  };
}

// Reset registration flag when AudioContext is recreated
export function resetWorkletRegistration() {
  _registered = false;
  _workletNode = null;
  _sab = null;
  _feedbackCallback = null;
}
