// ============================================================================
// UI — AUDIO SETTINGS MODAL
// Channel selection, input gain, VU metering, output gain, latency display.
// No device dropdowns — browser follows macOS system default.
// No monitoring — graph ends at analyser (dead end), MOTU handles monitoring.
// ============================================================================

import { S, DEBUG, MASTER_DEFAULT_DB, MASTER_DEFAULT_GAIN } from './state.js';
import { dlog } from './diag.js';
import { initSpeakerBuses, recreateAudioContext, rewireChannelMerger, rewireMonitorChannels, ensureAudioContext, setMicBtnLabel, getMasterBus, playSweepChannel, warmUpAudioEngine, applyAudioCushion, outputQueueDepthMs, requestAudioPort } from './audio.js';
import { renderMeters, tickMeters, rebuildMainOutputMeters,
         renderSetMeters, setMeterSources, clearSetMeters,
         startSetMeters, stopSetMeters, initSetGateMeter } from './ui-meters.js';
import { armHandsfree, disarmHandsfree, updateHPFFreq } from './handsfree.js';
import { getCursorLonLat, screenToLonLat, spherePointInto, cameraRotateInto } from './sphere.js';

// ── RtAudio input meter worklet (Electron only) ───────────────────────────────
// In Electron, getUserMedia is capped at 2ch by the browser. Instead, we open an
// RtAudio input stream from the main process which sends raw interleaved Float32
// PCM to the renderer via IPC. This worklet receives those chunks and feeds N
// AnalyserNodes so the meter strip shows all channels.

let _inputWorkletNode = null;   // AudioWorkletNode driving input analysers
// A harness seam (scripts/lib/rig.js mute): the real interface's input is
// silenced at the routing gains, so an audit hears only what it injects and
// never the room the machine is in — mark-align's flakiness all day was the
// laptop's own microphone. Never set by the app.
let _rtInputSilenced = false;
let _rtInputLast = null;   // the last (chIndex, nCh) routed, to restore
S._silenceRtInput = (on) => {
  _rtInputSilenced = !!on;
  _rtInputRoutingGains.forEach(g => { if (_rtInputSilenced) g.gain.value = 0; });
  if (!_rtInputSilenced && _rtInputLast) rewireRtAudioRecordingChannel(_rtInputLast.ch, _rtInputLast.n);
};
// The input ring's target fill, from the stall cushion — re-sent whenever
// the ring is rebuilt or the setting moves (audio.js applyAudioCushion).
S._inputRingTarget = () => {
  if (!_inputWorkletNode) return;
  const frames = Math.round((S.audioCushionMs ?? 20) / 1000 * (S.audioCtx?.sampleRate ?? 48000));
  _inputWorkletNode.port.postMessage({ type: 'target', frames });
};
let _inputMeterSetup  = false;  // true once worklet module is registered

async function ensureInputMeterWorklet(actx) {
  if (_inputMeterSetup) return;
  await actx.audioWorklet.addModule('js/worklets/input-meter.worklet.js');
  _inputMeterSetup = true;
}

// Module-level splitter ref so rewireRtAudioRecordingChannel can access it
let _rtInputSplitter      = null;
// One GainNode per channel between splitter and S.inputGainNode.
// Routing = set chosen gain to 1, all others to 0. Avoids disconnect() pitfalls.
let _rtInputRoutingGains  = [];

/** Release the browser's microphone client, if one is open: the getUserMedia
 *  stream and its monitor chain. In Electron, RtAudio is the one client on the
 *  microphone (R8, 2026-09-06): called when RtAudio input activates, so a
 *  stream left by a browser-mode session or an early start is closed, and by
 *  the input disconnect. */
function _closeBrowserMic() {
  try { window._micMonitorSrc?.disconnect(); } catch(_) {}
  window._micMonitorSrc = null;
  for (const st of new Set([S.recordingStream, S.inputStream])) {
    if (st) { try { st.getTracks().forEach(t => t.stop()); } catch(_) {} }
  }
  S.recordingStream = null;
  S.inputStream     = null;
}

async function setupRtAudioInputMeters(rawCh) {
  // Web Audio caps splitter/merger at 32 channels; clamp the metered/output count.
  // RtAudio may still capture all hw channels — we meter the first 32, but the
  // worklet must know the REAL hw channel count for correct deinterleaving stride.
  const nCh    = Math.min(32, rawCh);   // Web Audio output channels
  const hwCh   = rawCh;                 // real interleave stride from RtAudio
  const actx = ensureAudioContext();
  await ensureInputMeterWorklet(actx);

  // Tear down old worklet node + analysers + meter gain nodes + routing gains
  if (_inputWorkletNode) {
    try { _inputWorkletNode.disconnect(); } catch(_) {}
    _inputWorkletNode = null;
  }
  as._meterGainNodes.forEach(g => { try { g.disconnect(); } catch(_) {} });
  as._meterGainNodes = [];
  as.inputAnalysers.forEach(an => { try { an.disconnect(); } catch(_) {} });
  as.inputAnalysers = [];
  _rtInputRoutingGains.forEach(g => { try { g.disconnect(); } catch(_) {} });
  _rtInputRoutingGains = [];
  _rtInputSplitter = null;

  // Create worklet node with N output channels (clamped to 32)
  _inputWorkletNode = new AudioWorkletNode(actx, 'input-meter', {
    numberOfInputs:  0,
    numberOfOutputs: 1,
    outputChannelCount: [nCh],
  });
  // Tell worklet the REAL hw channel count so it deinterleaves with the correct
  // stride.  The worklet's process() loop is capped by outputs[0].length (= nCh),
  // so channels beyond 32 are deinterleaved correctly but simply not output.
  _inputWorkletNode.port.postMessage({ type: 'init', numChannels: hwCh });
  S._inputRingTarget?.();
  // Fault counts from the ring (see S.transportDiag). A dry block during a
  // take is a hole in the recording; this is the only place it is visible.
  // Once a second the ring also reports its fill (#333).
  _inputWorkletNode.port.onmessage = ({ data }) => {
    if (data?.type !== 'faults') return;
    S.transportDiag.inDry      += data.dry      | 0;
    S.transportDiag.inOverflow += data.overflow | 0;
    S.transportDiag.inSkipped  += data.skipped  | 0;
    S.transportDiag.inFillMs    = (data.fillFrames || 0) / (S.audioCtx?.sampleRate ?? 48000) * 1000;
    if (data.dry || data.overflow || data.skipped) dlog('transport', 'input ring fault', { dry: data.dry, overflow: data.overflow, skipped: data.skipped,
      totalDry: S.transportDiag.inDry, totalOverflow: S.transportDiag.inOverflow, rec: S.isRecording });
  };

  // ChannelSplitter fans out N channels — shared by both meter analysers and
  // the recording input tap (S.inputGainNode → S.inputAnalyser)
  const splitter = actx.createChannelSplitter(nCh);
  _inputWorkletNode.connect(splitter);
  _rtInputSplitter = splitter;

  // One AnalyserNode per channel for the meter strip
  as.inputAnalysers = Array.from({ length: nCh }, (_, i) => {
    const an = actx.createAnalyser();
    an.fftSize = 256;
    an.smoothingTimeConstant = 0.8;
    splitter.connect(an, i);
    return an;
  });
  S.inputAnalysers = as.inputAnalysers;  // expose to main window meter

  // Per-channel routing gains: splitter[i] → routingGain[i] → S.inputGainNode.
  // Channel selection = set chosen gain to 1, rest to 0.
  // This avoids the fragile disconnect(node, output, input) 3-arg form entirely.
  if (!S.inputGainNode) {
    S.inputGainNode = actx.createGain();
    S.inputGainNode.gain.value = 1.0;
  }

  // Kill any getUserMedia / buildInputGraph chain that may be feeding
  // S.inputGainNode BEFORE we wire the RtAudio routing gains.
  // buildInputGraph creates: as.sourceNode → as.splitterNode → S.inputGainNode
  // and requestMicAccess creates: monitorSrc → S.inputGainNode (direct).
  // Both must be severed so RtAudio is the sole source.
  try { window._micMonitorSrc?.disconnect(); }               catch(_) {}
  try { as.splitterNode?.disconnect(S.inputGainNode); }       catch(_) {}
  try { as._sumMerger?.disconnect(S.inputGainNode); }         catch(_) {}
  const selCh = parseInt(document.getElementById('asInputChannel')?.value ?? '0', 10) || 0;
  const safeSel = Math.max(0, Math.min(selCh, nCh - 1));
  _rtInputRoutingGains = Array.from({ length: nCh }, (_, i) => {
    const g = actx.createGain();
    g.gain.value = (i === safeSel) ? 1 : 0;
    splitter.connect(g, i);
    g.connect(S.inputGainNode);
    return g;
  });

  // Ensure dry monitor chain is connected (idempotent — Web Audio ignores dupes)
  if (S.dryGainNode) S.inputGainNode.connect(S.dryGainNode);

  // Wire selected channel into the recording path (S.inputGainNode → S.inputAnalyser)
  // so spacebar records from whatever channel the dropdown shows.
  rewireRtAudioRecordingChannel(safeSel, nCh);

  // The direct port: RtAudio's input callback posts each chunk straight into
  // this worklet (electron-main.js 'audio-port'), never through this thread
  // (2026-09-06). A rebuild asks for a fresh pair; if the node was replaced
  // while the port was on its way, the port belongs to nobody and is closed.
  // `window._rtAudioInputListening` is the flag the rest of the app reads for
  // "RtAudio is the live input" (audio.js, events.js, ui-presets.js).
  if (window.electronBridge?.openAudioPort) {
    const node = _inputWorkletNode;
    try {
      const port = await requestAudioPort('in');
      if (_inputWorkletNode === node) node.port.postMessage({ type: 'port', port }, [port]);
      else { try { port.close(); } catch (_) {} }
      window._rtAudioInputListening = true;
      _closeBrowserMic();            // one client on the microphone (R8)
    } catch (e) {
      console.warn('[audio] input port:', e.message);
    }
  }
}

// Switch which RtAudio channel feeds S.inputGainNode (recording path).
// chIndex can be a number (single channel) or 'stereo' (sum ch 0 + ch 1).
// Uses per-channel routing GainNodes (0/1) instead of disconnect() to avoid
// the unreliable 3-arg disconnect(node, output, input) form.
function rewireRtAudioRecordingChannel(chIndex, nCh) {
  if (!_rtInputSplitter) return;
  _rtInputLast = { ch: chIndex, n: nCh };
  const actx = ensureAudioContext();

  // Ensure recording gain node exists
  if (!S.inputGainNode) {
    S.inputGainNode = actx.createGain();
    S.inputGainNode.gain.value = 1.0;
  }

  // Kill the ENTIRE getUserMedia / buildInputGraph chain so it no longer bleeds
  // into the recording path — RtAudio is now the sole input source.
  //
  // buildInputGraph creates: as.sourceNode → as.splitterNode → S.inputGainNode
  // The old code only did _micMonitorSrc.disconnect(S.inputGainNode), but that
  // only removes DIRECT connections. The splitter→gainNode link is indirect
  // (through as.splitterNode), so it persisted and kept piping getUserMedia ch1.
  //
  // Fix: disconnect the source from everything (kills its downstream chain),
  // AND explicitly disconnect as.splitterNode and as._sumMerger from S.inputGainNode.
  try { window._micMonitorSrc?.disconnect(); }               catch(_) {}
  try { as.splitterNode?.disconnect(S.inputGainNode); }       catch(_) {}
  try { as._sumMerger?.disconnect(S.inputGainNode); }         catch(_) {}

  // Ensure inputAnalyser exists but do NOT recreate it.
  // startLiveRecording() wires S.inputAnalyser → S.recordingNode; recreating
  // the analyser would orphan that connection and silence the recording.
  if (!S.inputAnalyser) {
    S.inputAnalyser = actx.createAnalyser();
    S.inputAnalyser.fftSize = 256;
    S.inputAnalyser.smoothingTimeConstant = 0.6;
    S.inputGainNode.connect(S.inputAnalyser);
  }

  // Flip routing gains: 1 for the chosen channel(s), 0 for all others.
  // The graph (splitter[i] → routingGain[i] → S.inputGainNode) was wired in
  // setupRtAudioInputMeters; we just change the gain values here.
  const isStereo = chIndex === 'stereo';
  if (isStereo) {
    // Stereo sum: enable channels 0 and 1, silence the rest.
    // The routing gains all feed S.inputGainNode (mono) which auto-sums.
    _rtInputRoutingGains.forEach((g, i) => { g.gain.value = _rtInputSilenced ? 0 : (i <= 1) ? 1 : 0; });
    DEBUG && console.log(`[input] recording from RtAudio stereo (ch 1+2 sum)`);
  } else {
    const n = _rtInputRoutingGains.length || (nCh ?? as.inputAnalysers.length);
    const safe = Math.max(0, Math.min(chIndex, n - 1));
    _rtInputRoutingGains.forEach((g, i) => { g.gain.value = _rtInputSilenced ? 0 : (i === safe) ? 1 : 0; });
    DEBUG && console.log(`[input] recording from RtAudio ch ${safe + 1} (index ${safe})`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function dbToLinear(db)   { return Math.pow(10, db / 20); }
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

function setStatus(id, type, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'status-strip ' + type;
  el.textContent = msg;
}

function formatDb(v) {
  const sign = v < 0 ? '−' : (v > 0 ? '+' : '');
  return sign + Math.abs(v).toFixed(1) + ' dB';
}

// ── Local audio state (separate from main S.audioCtx / S.inputStream) ────────
const as = {
  inputGains:     { '0': 0, '1': 0, 'stereo': 0 },  // per-channel input gain (dB), keyed by channel value
  _meterGainNodes: [],  // one GainNode per channel, between splitter and meter analyser
  outputGain:    MASTER_DEFAULT_DB,   // -6 dB; single source in state.js
  sampleRate:     48000,
  sourceNode:     null,
  splitterNode:   null,
  gainNodeIn:     null,
  analyserIn:     null,
  inputAnalysers: [],   // one AnalyserNode per input channel (for multi-ch meter)
  meterRAF:       null,
  started:        false,
  ownStream:      false,
  ownCtx:         false,
};

// ── Build input graph ─────────────────────────────────────────────────────────
// Taps the selected channel (or L+R sum) from the getUserMedia stream and routes
// it into S.inputGainNode → S.inputAnalyser — the exact chain startLiveRecording
// reads from. This is the granular engine's mono recording input.
//
// Also builds per-channel AnalyserNodes for the meter strip.
// No software monitoring — nothing connects to ctx.destination.
function buildInputGraph(channel) {
  const ctx    = S.audioCtx;
  const stream = S.inputStream;
  if (!ctx || !stream) return;

  // Tear down previous source/splitter
  try { if (as.sourceNode)   as.sourceNode.disconnect();   } catch(_) {}
  try { if (as.splitterNode) as.splitterNode.disconnect(); } catch(_) {}

  // Disconnect old monitor chain from inputGainNode so we can re-tap a new channel
  try { window._micMonitorSrc?.disconnect(); } catch(_) {}

  const numCh = stream.getAudioTracks()[0]?.getSettings()?.channelCount || 1;

  as.sourceNode   = ctx.createMediaStreamSource(stream);
  as.splitterNode = ctx.createChannelSplitter(Math.min(32, Math.max(numCh, 2)));
  as.sourceNode.connect(as.splitterNode);

  // Ensure S.inputGainNode exists (created by requestMicAccess; may not exist if
  // settings modal opened a stream independently)
  if (!S.inputGainNode) {
    S.inputGainNode = ctx.createGain();
  }
  // Always apply per-channel gain when (re)building the graph — this ensures the
  // gain node reflects the saved setting for this channel, not a stale value.
  S.inputGainNode.gain.value = dbToLinear(as.inputGains?.[channel] ?? 0);
  if (!S.inputAnalyser) {
    S.inputAnalyser = ctx.createAnalyser();
    S.inputAnalyser.fftSize = 256;
    S.inputAnalyser.smoothingTimeConstant = 0.6;
    S.inputGainNode.connect(S.inputAnalyser);
  }

  // Disconnect any previous splitter→inputGain connection before re-tapping
  try { as.splitterNode.disconnect(S.inputGainNode); } catch(_) {}

  // Route selected channel (or stereo sum) into S.inputGainNode → S.inputAnalyser
  // This is what startLiveRecording reads from.
  if (channel === 'stereo') {
    // Sum L+R into a ChannelMerger → inputGainNode (mono sum of two channels)
    const sumMerger = ctx.createChannelMerger(2);
    as.splitterNode.connect(sumMerger, 0, 0);
    as.splitterNode.connect(sumMerger, Math.min(1, numCh - 1), 1);
    // sumMerger output is 2-ch; inputGainNode is mono — Web Audio down-mixes automatically
    sumMerger.connect(S.inputGainNode);
    as._sumMerger = sumMerger;
  } else {
    try { as._sumMerger?.disconnect(); } catch(_) {}
    as._sumMerger = null;
    const chIndex = clamp(parseInt(channel, 10), 0, numCh - 1);
    as.splitterNode.connect(S.inputGainNode, chIndex, 0);
  }

  window._micMonitorSrc = as.sourceNode;   // update handle for cleanup in audio.js

  // Per-channel AnalyserNodes for the meter strip.
  // Each channel gets its own GainNode (set to that channel's saved gain) so every
  // meter bar reflects post-gain level — not just the active channel.
  // Chain: splitter[i] → meterGain[i] → analyser[i]
  as._meterGainNodes.forEach(g => { try { g.disconnect(); } catch(_) {} });
  as._meterGainNodes = [];
  as.inputAnalysers.forEach(an => { try { an.disconnect(); } catch(_) {} });
  as.inputAnalysers = Array.from({ length: numCh }, (_, i) => {
    const chKey = String(i);
    const gainDb = as.inputGains[chKey] ?? 0;

    const mg = ctx.createGain();
    mg.gain.value = dbToLinear(gainDb);
    as.splitterNode.connect(mg, i);
    as._meterGainNodes.push(mg);

    const an = ctx.createAnalyser();
    an.fftSize = 256;
    an.smoothingTimeConstant = 0.8;
    mg.connect(an);
    return an;
  });
  S.inputAnalysers = as.inputAnalysers;  // expose to main window meter
}

// renderMeters, tickMeters imported from ui-meters.js

// Render output meter bars using S.speakerAnalysers (set by audio.js initSpeakerBuses).
// Labels: house buses by angle, then "SML"/"SMR" for the stereo mixdown pair.
function renderOutputMeters() {
  const wrap = document.getElementById('asOutputMeters');
  if (!wrap) return;
  if (!S.speakerAnalysers?.length) { wrap.style.display = 'none'; return; }
  const n          = S.speakerAnalysers.length;
  const nHouse     = S.speakerBuses?.length ?? n;
  const hasMixdown = !!(S.monitorSpeakerBuses?.length);
  const houseLabels   = Array.from({ length: nHouse }, (_, i) => String(i + 1));
  const mixdownLabels = hasMixdown ? ['L', 'R'] : [];
  const labels = [...houseLabels, ...mixdownLabels];
  const separatorBefore = hasMixdown ? nHouse : undefined;
  wrap.style.display = '';
  renderSetMeters('asOutputMeters', labels);
  setMeterSources('asOutputMeters', S.speakerAnalysers);
  // Also rebuild the main-window output meters to reflect the new channel layout
  rebuildMainOutputMeters();
}

// Generate short input channel labels from device name + channel count.
// e.g. "UltraLite mk4" with 18ch → ["1","2",..."18"] but grouped by pairs if stereo pairs known
function makeInputLabels(numCh, deviceLabel) {
  // If user has overrides, use them
  if (S.inputChannelLabels?.length >= numCh) return S.inputChannelLabels.slice(0, numCh);
  // Auto-generate: just show channel numbers as short as possible
  return Array.from({ length: numCh }, (_, i) => String(i + 1));
}

// Render input meter bars using as.inputAnalysers (set by buildInputGraph or setupRtAudioInputMeters).
// Highlights the bar(s) corresponding to S.mainInputChannel — those feed the granular engine.
function renderInputMeters(selectedCh) {
  const numCh = as.inputAnalysers.length || 1;
  const devSel = document.getElementById('asInputDevice');
  const devLabel = devSel?.options[devSel.selectedIndex]?.text ?? '';
  // Which bar(s) to highlight: use explicit arg, or fall back to S.mainInputChannel.
  // Convert 'stereo' to [0, 1] for the highlight array.
  let sel = selectedCh !== undefined ? selectedCh : (S.mainInputChannel ?? 0);
  if (sel === 'stereo') sel = [0, 1];
  // A channel with no signal path reads `off` rather than sitting at silence —
  // "nothing is coming in" and "nothing is routed here" are different facts.
  const live = as.inputAnalysers.length;
  const off  = Array.from({ length: numCh }, (_, i) => i).filter(i => i >= live);
  renderSetMeters('asInputMeters', makeInputLabels(numCh, devLabel), { off });
  setMeterSources('asInputMeters', as.inputAnalysers);
  // Keep main window input meter in sync (same channel layout + highlight)
  S._rebuildMainInputMeters?.();
}

// ── Is this page on screen? ─────────────────────────────────────────────────
// It has two hosts and only one of them is the modal: the settings shell MOVES
// this dialog into #settingsHost and takes the overlay's `.open` back off, so
// the guard below read false exactly while the page was in front of you. The
// meters have never once run in the settings shell (#294).
function _visible() {
  const m = document.getElementById('audioSettingsModal');
  return !!m?.classList.contains('open')
      || !!document.querySelector('.settings-host .audio-dialog');
}

// ── VU metering (one loop for every meter on the page) ───────────────────────
function startMetering() {
  // The loop still has to be BOUNDED (perf audit M3 / TODO #116): this is also
  // called from device-activation paths — startup restore, device switch —
  // with the page nowhere on screen, and it used to leave a 60fps loop reading
  // analysers into a hidden dialog for the rest of the session.
  if (!_visible()) return;
  setMeterSources('asInputMeters', as.inputAnalysers);
  setMeterSources('asOutputMeters', S.speakerAnalysers);
  startSetMeters();
}

function stopMetering() {
  if (as.meterRAF) { cancelAnimationFrame(as.meterRAF); as.meterRAF = null; }
  stopSetMeters();
}

// ── Angle helpers ─────────────────────────────────────────────────────────────
function angleToName(deg) {
  const d = ((deg % 360) + 360) % 360;
  if (d < 15 || d >= 345)  return 'front';
  if (d < 75)  return 'front-R';
  if (d < 105) return 'right';
  if (d < 165) return 'rear-R';
  if (d < 195) return 'rear';
  if (d < 255) return 'rear-L';
  if (d < 285) return 'left';
  if (d < 345) return 'front-L';
  return `${d}°`;
}

// ── Input mapping table ───────────────────────────────────────────────────────
// Shows a software-path → hardware-channel table.
// Rows: "main (mono)" (always), "experimental (mono)" (future, disabled).
function renderInputMappingTable() {
  const wrap = document.getElementById('asInputMappingTable');
  if (!wrap) return;
  const nCh = as.inputAnalysers.length;
  if (!nCh) { wrap.style.display = 'none'; return; }

  // Build hardware channel options (ch 1 … ch N, plus stereo sum if ≥ 2 ch)
  let hwOpts = Array.from({ length: nCh }, (_, i) =>
    `<option value="${i}">ch ${i + 1}</option>`
  ).join('');
  if (nCh >= 2) hwOpts += `<option value="stereo">stereo (L+R)</option>`;

  wrap.style.display = '';
  wrap.innerHTML = `
    <div class="as-io-table">
      <div class="as-io-hdr">
        <span class="as-io-col-sw">software path</span>
        <span class="as-io-col-hw">hardware input</span>
      </div>
      <div class="as-io-row" title="main — feeds the granular engine (recording + live grain)">
        <span class="as-io-sw">main (mono)</span>
        <select class="as-io-sel" id="asMainInputSel">${hwOpts}</select>
      </div>
      <div class="as-io-row as-io-row--dim" title="experimental — reserved for future live-processing paths">
        <span class="as-io-sw">experimental (mono)</span>
        <select class="as-io-sel" id="asExperimentalInputSel" disabled>${hwOpts}</select>
      </div>
    </div>`;

  // Restore current main channel (may be numeric index or 'stereo')
  const mainSel = document.getElementById('asMainInputSel');
  if (mainSel) {
    mainSel.value = S.mainInputChannel === 'stereo' ? 'stereo' : String(S.mainInputChannel ?? 0);
    mainSel.addEventListener('change', () => {
      // asInputChannel owns the entire channel-change path — recording rewire,
      // per-channel input-gain restore, meters, status, and the main-UI audio
      // panel mirror. Delegate to it by dispatching a real `change` rather than
      // reimplementing a subset here: the old inline copy assigned .value with
      // no event, so the legacy handler never ran (no gain restore) and the
      // panel's channel dropdown + in-gain slider both went stale.
      const compat = document.getElementById('asInputChannel');
      if (!compat) return;
      compat.value = mainSel.value;
      compat.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
}

// ── Output mapping table ──────────────────────────────────────────────────────
// Software-centric view: each software position has a dropdown for hardware out.
// Rows: Position 1 … N (house VBAP), then Headphone L, Headphone R.
// Always shown in Electron when speaker buses are active.
// ── Custom speaker angle persistence ─────────────────────────────────────────
// Room/installation config — persisted in localStorage, not per-patch.
const _SPK_ANGLES_KEY = 'mubone_custom_speaker_angles';

function loadCustomSpeakerAngles() {
  try {
    const raw = localStorage.getItem(_SPK_ANGLES_KEY);
    if (raw) S.customSpeakerAngles = JSON.parse(raw);
  } catch (_) {}
}

function saveCustomSpeakerAngles() {
  try {
    if (S.customSpeakerAngles) {
      localStorage.setItem(_SPK_ANGLES_KEY, JSON.stringify(S.customSpeakerAngles));
    } else {
      localStorage.removeItem(_SPK_ANGLES_KEY);
    }
  } catch (_) {}
}

// Compute current cursor azimuth in degrees (0–360) from the active cursor
// source: sensor quaternion, mouse/steer/surface screen position, or fallback.
// Same tri-state logic as scheduleGrains / updateDryMonitorPanning.
const _capW = new Float32Array(3);
const _capC = new Float32Array(3);
function getCursorAzDeg() {
  const { lon, lat } = S.cursorQ
    ? getCursorLonLat()                          // sensor quaternion
    : (S.mouseInCanvas || S.altLocked)
      ? screenToLonLat(                          // mouse / steer / surface cursor
          S.altLocked ? S.altFrozenMousePixelX : S.mousePixelX,
          S.altLocked ? S.altFrozenMousePixelY : S.mousePixelY)
      : getCursorLonLat();                       // fallback (camQ forward)
  spherePointInto(lon, lat, _capW);
  const wx = _capW[0], wy = _capW[1], wz = _capW[2];
  let cx, cz;
  if (S.spatialPanning === 'worldlocked') {
    cx = wx; cz = wz;
  } else {
    cameraRotateInto(wx, wy, wz, _capC);
    cx = _capC[0]; cz = _capC[2];
  }
  const rawAz  = Math.atan2(cx, cz);
  const TWO_PI = 2 * Math.PI;
  return (((rawAz % TWO_PI) + TWO_PI) % TWO_PI) * (180 / Math.PI);
}

// Apply a single angle edit: update S.customSpeakerAngles, persist, rebuild.
async function applySpeakerAngleEdit(busIdx, angleDeg) {
  const n = S.speakerBuses?.length ?? 0;
  if (!n) return;
  // Ensure we have a full array (clone current computed angles as baseline)
  if (!S.customSpeakerAngles) {
    S.customSpeakerAngles = S.speakerBuses.map(b => b.angleDeg);
  }
  S.customSpeakerAngles[busIdx] = ((angleDeg % 360) + 360) % 360;
  saveCustomSpeakerAngles();
  // Rebuild speaker buses with new angles
  const totalCh = S.speakerBuses.numChannels;
  if (totalCh) {
    await initSpeakerBuses(totalCh);
    renderOutputMeters();
    renderRoutingTable();
  }
}

// Reset all custom angles back to computed defaults.
async function resetSpeakerAngles() {
  S.customSpeakerAngles = null;
  saveCustomSpeakerAngles();
  const totalCh = S.speakerBuses?.numChannels;
  if (totalCh) {
    await initSpeakerBuses(totalCh);
    renderOutputMeters();
    renderRoutingTable();
  }
}

function renderRoutingTable() {
  const wrap = document.getElementById('asRoutingTable');
  if (!wrap) return;
  const houseBuses = S.speakerBuses;
  const nHouse     = houseBuses?.length ?? 0;
  const nTotal     = S.speakerAnalysers?.length ?? 0;  // house + headphone

  if (!nHouse) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }

  wrap.style.display = '';

  // Physical output channel options — must span ALL hardware outputs, not just
  // active buses. S.speakerBuses.numChannels holds the true hardware channel count
  // (set in initSpeakerBuses); speakerAnalysers.length only counts active buses.
  const hwTotalCh = S.speakerBuses?.numChannels ?? nTotal;
  const hwOpts = Array.from({ length: hwTotalCh }, (_, i) =>
    `<option value="${i}">out ${i + 1}</option>`
  ).join('');

  // Current house routing (bus i → physical ch i by default)
  const houseRouting = S.channelRouting ?? houseBuses.map((_, i) => i);
  // Mixdown defaults: immediately sequential after the last house output
  const hpL = S.headphoneRouting?.[0] ?? nHouse;
  const hpR = S.headphoneRouting?.[1] ?? nHouse + 1;

  const hasCustom = !!S.customSpeakerAngles;
  const isHeadlocked = S.spatialPanning === 'headlocked';

  // Build house rows — now with editable angle + capture button
  const houseRows = houseBuses.map((b, i) => {
    const name = `Position ${i + 1}`;
    const deg  = b.angleDeg.toFixed(1);
    return `<div class="as-io-row" title="${name} — ${deg}°">
      <span class="as-io-sw">${name}</span>
      <input type="number" class="as-io-angle-input" data-bus="${i}"
             value="${deg}" min="0" max="359.9" step="0.5"
             title="azimuth in degrees (0° = front, 90° = right)">
      <span class="as-io-angle-unit">°</span>
      <button class="set-btn set-btn--sm as-io-capture-btn" data-bus="${i}"
              ${isHeadlocked ? 'disabled title="capture only works in worldlocked mode — headlocked angles are relative to the listener, not the room"' : 'title="capture current cursor azimuth"'}>⊕</button>
      <select class="as-io-sel as-io-house-sel" data-bus="${i}">${hwOpts}</select>
    </div>`;
  }).join('');

  // Build stereo mixdown rows (only when mixdown bus is enabled)
  const hpRows = S.monitorSpeakerBuses?.length ? `
    <div class="as-io-row as-io-row--hp" title="Stereo Mixdown L — cursor grain monitor mix, left channel">
      <span class="as-io-sw">Stereo Mixdown L <span class="as-io-angle">mixdown</span></span>
      <select class="as-io-sel as-io-hp-sel" data-side="L">${hwOpts}</select>
    </div>
    <div class="as-io-row as-io-row--hp" title="Stereo Mixdown R — cursor grain monitor mix, right channel">
      <span class="as-io-sw">Stereo Mixdown R <span class="as-io-angle">mixdown</span></span>
      <select class="as-io-sel as-io-hp-sel" data-side="R">${hwOpts}</select>
    </div>` : '';

  // Reset button (only shown when custom angles are active)
  const resetBtn = hasCustom
    ? `<div class="as-io-row as-io-row--reset">
         <button class="as-btn as-io-reset-btn" id="asResetSpeakerAngles"
                 title="reset all angles to computed defaults">reset angles</button>
       </div>`
    : '';

  wrap.innerHTML = `
    <div class="as-io-table">
      <div class="as-io-hdr">
        <span class="as-io-col-sw">software output</span>
        <span class="as-io-col-angle">azimuth</span>
        <span class="as-io-col-hw">hardware out</span>
      </div>
      ${houseRows}
      ${hpRows}
      ${resetBtn}
    </div>`;

  // Set initial values for house dropdowns and attach listeners
  wrap.querySelectorAll('.as-io-house-sel').forEach(sel => {
    const busIdx = parseInt(sel.dataset.bus, 10);
    sel.value = String(houseRouting[busIdx] ?? busIdx);
    sel.addEventListener('change', applyOutputMapping);
  });

  // Angle input change — apply on blur or Enter
  wrap.querySelectorAll('.as-io-angle-input').forEach(inp => {
    const busIdx = parseInt(inp.dataset.bus, 10);
    const apply = () => {
      const val = parseFloat(inp.value);
      if (!isNaN(val)) applySpeakerAngleEdit(busIdx, val);
    };
    inp.addEventListener('change', apply);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
  });

  // Capture button — snapshot cursor azimuth into angle field
  wrap.querySelectorAll('.as-io-capture-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const busIdx = parseInt(btn.dataset.bus, 10);
      const azDeg = getCursorAzDeg();
      const inp = wrap.querySelector(`.as-io-angle-input[data-bus="${busIdx}"]`);
      if (inp) inp.value = azDeg.toFixed(1);
      applySpeakerAngleEdit(busIdx, azDeg);
    });
  });

  // Reset button
  document.getElementById('asResetSpeakerAngles')?.addEventListener('click', resetSpeakerAngles);

  // Set initial values for headphone dropdowns
  const hpSelL = wrap.querySelector('.as-io-hp-sel[data-side="L"]');
  const hpSelR = wrap.querySelector('.as-io-hp-sel[data-side="R"]');
  if (hpSelL) { hpSelL.value = String(hpL); hpSelL.addEventListener('change', applyOutputMapping); }
  if (hpSelR) { hpSelR.value = String(hpR); hpSelR.addEventListener('change', applyOutputMapping); }
}

// Apply output routing from the table — updates S.channelRouting + S.headphoneRouting
// then rewires the Web Audio merger graph without rebuilding buses.
function applyOutputMapping() {
  // House routing: collect busIndex → physicalCh from each house dropdown
  const houseMapping = [];
  document.querySelectorAll('#asRoutingTable .as-io-house-sel').forEach(sel => {
    houseMapping[parseInt(sel.dataset.bus, 10)] = parseInt(sel.value, 10);
  });
  if (houseMapping.length) {
    S.channelRouting = houseMapping;
    rewireChannelMerger();
  }

  // Headphone routing: L and R dropdowns
  const hpSelL = document.querySelector('#asRoutingTable .as-io-hp-sel[data-side="L"]');
  const hpSelR = document.querySelector('#asRoutingTable .as-io-hp-sel[data-side="R"]');
  if (hpSelL && hpSelR) {
    S.headphoneRouting = [parseInt(hpSelL.value, 10), parseInt(hpSelR.value, 10)];
    rewireMonitorChannels();
  }

  setStatus('asOutputStatus', 'ok', 'routing updated');
}

// Legacy alias so any remaining renderRoutingTable() calls still work
function renderOutputMappingTable() { renderRoutingTable(); }

// ── Start audio ───────────────────────────────────────────────────────────────
async function startAudio() {
  const startBtn = document.getElementById('asStartBtn');
  if (as.started) { stopAudio(); return; }

  startBtn.textContent = 'starting…';
  startBtn.disabled = true;

  try {
    const channel = document.getElementById('asInputChannel').value;

    // Prefer the shared stream already opened by the mic button in main app.
    // S.audioCtx and S.inputStream are set by audio.js when mic is enabled.
    // In Electron, RtAudio is the ONLY input path — never getUserMedia here
    // (R8, 2026-09-06). This used to gate on `_rtAudioInputListening`, which
    // is set asynchronously after boot, so a start that ran before the RtAudio
    // input landed opened a second client on the microphone.
    // Falls back to its own getUserMedia only when running standalone in browser.
    if (!S.inputStream && !window.electronBridge?.isElectron) {
      S.inputStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount:     { ideal: 2 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl:  false,
          sampleRate:       { ideal: as.sampleRate },
        }
      });
      as.ownStream = true;
    }

    if (!S.audioCtx) {
      S.audioCtx = new AudioContext({ sampleRate: as.sampleRate });
      as.ownCtx  = true;
    }

    buildInputGraph(channel);

    // Render meter bars for the number of channels just opened
    renderInputMeters();

    as.started = true;
    startBtn.textContent = 'stop audio';
    startBtn.disabled = false;

    const lbl = channel === 'stereo' ? 'stereo' : `ch ${parseInt(channel) + 1}`;
    setStatus('asInputStatus',  'ok', `active — ${lbl} — ${S.audioCtx.sampleRate} Hz`);
    setStatus('asOutputStatus', 'ok', 'monitoring via system audio');
    startMetering();

    // Sync the main screen mic button — audio is now active regardless of how it was started
    S.micPermissionGranted = true;
    const micBtn = document.getElementById('micEnableBtn');
    if (micBtn) {
      setMicBtnLabel('mic ready');
      micBtn.classList.remove('mic-denied');
      micBtn.classList.add('mic-ready');
      micBtn.disabled = false;
    }

  } catch(e) {
    startBtn.textContent = 'start audio';
    startBtn.disabled = false;
    setStatus('asInputStatus', 'error', `error: ${e.message}`);
  }
}

function stopAudio() {
  stopMetering();
  try { if (as.sourceNode)   as.sourceNode.disconnect();   } catch(_) {}
  try { if (as.splitterNode) as.splitterNode.disconnect(); } catch(_) {}
  try { if (as.gainNodeIn)   as.gainNodeIn.disconnect();   } catch(_) {}

  // Only close what we opened — don't touch the shared S.audioCtx/S.inputStream
  if (as.ownStream && S.inputStream) {
    S.inputStream.getTracks().forEach(t => t.stop());
    S.inputStream = null;
    as.ownStream  = false;
  }
  if (as.ownCtx && S.audioCtx) {
    S.audioCtx.close();
    S.audioCtx = null;
    as.ownCtx  = false;
  }

  as.sourceNode = as.splitterNode = as.gainNodeIn = as.analyserIn = null;
  as.inputAnalysers = [];
  as._meterGainNodes.forEach(g => { try { g.disconnect(); } catch(_) {} });
  as._meterGainNodes = [];
  as.started = false;

  const startBtn = document.getElementById('asStartBtn');
  if (startBtn) startBtn.textContent = 'start audio';
  setStatus('asInputStatus',  'idle', 'no input active');
  setStatus('asOutputStatus', 'idle', 'no output active');
}

// ── Latency display ───────────────────────────────────────────────────────────
// What js/latency.js knows: in + out = the round trip, and where the figure
// came from. The estimate is the streams' own report; a MEASUREMENT is the
// loopback on the button beside it, and beats the estimate for this device
// pair. This is the number the loop engine steers by (a loop's edges, an
// overdub's phase), so it is stated as such, not as a comfort colour.
function updateLatency() {
  const lbl = document.getElementById('asLatencyLabel');
  const dot = document.getElementById('asLatencyDot');
  const btn = document.getElementById('asLatencyMeasure');
  const fgt = document.getElementById('asLatencyForget');
  const L = S.latency || { inS: 0, outS: 0, roundTripS: 0, source: 'none', detail: '' };
  const ms = x => (x * 1000).toFixed(1);
  if (L.source === 'none' || !(L.roundTripS > 0)) {
    if (lbl) lbl.textContent = L.detail ? `— (${L.detail})` : '— not known yet';
    if (dot) dot.className = 'latency-dot bad';
  } else {
    if (lbl) lbl.textContent = `in ${ms(L.inS)} + out ${ms(L.outS)} = ${ms(L.roundTripS)} ms · ${L.source === 'measured' ? L.detail : 'estimate' + (L.detail ? ` (${L.detail})` : '')}`;
    const rt = L.roundTripS * 1000;
    if (dot) dot.className = 'latency-dot ' + (rt < 15 ? 'ok' : rt < 40 ? 'warn' : 'bad');
  }
  if (btn) btn.textContent = L.source === 'measured' ? 'Re-measure' : 'Measure';
  if (fgt) fgt.hidden = L.source !== 'measured';
}
S._latencyChanged = updateLatency;

/** The stall cushion (#333): one number for both hops, applied at once —
 *  the credit window shrinks or grows on the next block, the ring's target
 *  on the next chunk — and the latency estimate follows. */
export function setAudioCushion(ms) {
  if (![5, 10, 20, 30, 50].includes(ms)) return;
  S.audioCushionMs = ms;
  try { localStorage.setItem('mubone_audio_cushion', String(ms)); } catch (_) {}
  applyAudioCushion();
  const sel = document.getElementById('asCushion');
  if (sel && sel.value !== String(ms)) sel.value = String(ms);
  S._refreshLatency?.();
}
S._setAudioCushion = setAudioCushion;

/** What the hops hold right now — the queue's depth from the credits out,
 *  the ring's fill from its last report. The cushion row shows both, so a
 *  drift or a stall's aftermath is visible without a measurement. */
/** What the pool is doing: how many grains are alive, and what the thread's
 *  own load is — so the choice above is made against the machine, not a guess
 *  (P2). Both come from the worklet's feedback, which costs nothing extra. */
function updateMaxGrainsLive() {
  const el = document.getElementById('asMaxGrainsLive');
  if (!el) return;
  // The worklet's own feedback, already arriving 30×/s — no new gauge.
  const d = S._lastWorkletDiag || {};
  const alive = S._grainSourceCount | 0;
  const load = d.loadPct != null ? `${d.loadPct}% load` : '';
  const thin = d.throttled ? ' · thinning' : '';
  el.textContent = (alive || load) ? `${alive} alive${load ? ' · ' + load : ''}${thin}` : '';
}

function updateCushionLive() {
  const el = document.getElementById('asCushionLive');
  if (!el) return;
  const d = outputQueueDepthMs();
  S.transportDiag.outDepthMs = d;
  if (!window.electronBridge) { el.textContent = ''; return; }
  const skips = S.transportDiag.inSkipped ? ` · skipped ${S.transportDiag.inSkipped}` : '';
  const drops = S.transportDiag.outDropped ? ` · dropped ${S.transportDiag.outDropped}` : '';
  const dry   = S.transportDiag.outDry ? ` · dry ${S.transportDiag.outDry}` : '';
  el.textContent = `out queue ${d.toFixed(1)} ms · in ring ${S.transportDiag.inFillMs.toFixed(1)} ms${skips}${drops}${dry}`;
}

async function handleMeasureLatency() {
  const btn = document.getElementById('asLatencyMeasure');
  const lbl = document.getElementById('asLatencyLabel');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  if (lbl) lbl.textContent = 'listening — six clicks, 2.5 s …';
  try {
    const d = await S._measureRoundTrip?.();
    if (d == null) {
      const r = S._latencyLast;
      const why = r?.error ? r.error
        : r && r.peakDb === -Infinity ? 'the take is silent — no input is reaching the recorder'
        : r && r.peakDb < -50 ? `only noise reached the mic (peak ${r.peakDb} dB) — bring the speakers up, or cable an output into the input`
        : r ? `heard sound (peak ${r.peakDb} dB, floor ${r.floorDb} dB) but found ${r.found} of ${r.of} clicks — quieten the room, or cable an output into the input`
        : 'the mic did not hear the clicks';
      if (lbl) lbl.textContent = why;
      setTimeout(updateLatency, 6000);
    }
  } catch (e) {
    if (lbl) lbl.textContent = `measurement failed: ${e.message}`;
    setTimeout(updateLatency, 4000);
  } finally { btn.disabled = false; }
}

// ── Engine settings: sample rate + buffer size ────────────────────────────────

async function applySampleRate() {
  const sel = document.getElementById('asSampleRate');
  const newRate = parseInt(sel?.value ?? 48000);
  if (newRate === S.audioCtx?.sampleRate) return; // no change

  const confirmed = window.confirm(
    `Change sample rate to ${newRate} Hz?\n\nThis will restart the audio engine. Any active recording will be lost.`
  );
  if (!confirmed) { if (sel) sel.value = String(S.audioCtx?.sampleRate ?? 48000); return; }

  setStatus('asInputStatus',  'idle', 'restarting audio engine…');
  setStatus('asOutputStatus', 'idle', 'restarting audio engine…');

  await recreateAudioContext(newRate);

  // In Electron, re-open the audify stream at the new rate with the current device.
  // Open hardware first, then rebuild Web Audio graph so worklet posts start after audify is ready.
  if (window.electronBridge?.isElectron && S.speakerBuses) {
    const devices = await window.electronBridge.getAudioDevices();
    const devId   = _outputDeviceId ?? devices.find(d => d.isDefault)?.id ?? devices[0]?.id;
    const current = devices.find(d => d.id === devId) || devices[0];
    if (current) {
      const nCh = Math.min(32, current.outputChannels);
      const bufFrames = S.preferredBufferSize ?? 1024;
      await window.electronBridge.setAudioDevice(current.id, nCh, bufFrames, S.audioCtx?.sampleRate);
      S._refreshLatency?.();
      await initSpeakerBuses(nCh);
    }
  }

  updateLatency();
  setStatus('asInputStatus',  'idle', `engine restarted at ${newRate} Hz — re-select input`);
  setStatus('asOutputStatus', 'idle', `engine restarted at ${newRate} Hz — re-apply output`);
}

async function applyBufferSize() {
  const buf = parseInt(document.getElementById('asBufferSize')?.value ?? 512);

  S.preferredBufferSize = buf;
  localStorage.setItem('mubone_bufferSize', buf);

  if (window.electronBridge?.isElectron) {
    // Don't reopen streams — CoreAudio's HAL crashes on repeated close/open
    // cycles for buffer size changes.  Show the restart button instead.
    const restartBtn = document.getElementById('asBufferRestart');
    if (restartBtn) restartBtn.style.display = 'inline-block';
    setStatus('asOutputStatus', 'idle', `buffer size → ${buf} — restart to apply`);
  }
  updateLatency();
}

// ── Speaker sweep test ────────────────────────────────────────────────────────
// Plays a short white-noise burst through each output channel in sequence so
// you can verify every speaker is working and positioned correctly.
// In Electron: steps through S.speakerBuses one at a time.
// In browser (stereo): sweeps StereoPanner left → centre → right.

let _sweepActive   = false;
let _sweepStopFlag = false;

async function runSpeakerSweep() {
  const btn = document.getElementById('asTestBtn');
  if (_sweepActive) { _sweepStopFlag = true; return; }

  const ctx = S.audioCtx;
  if (!ctx) {
    setStatus('asOutputStatus', 'error', 'no audio context — start audio first');
    return;
  }

  _sweepActive   = true;
  _sweepStopFlag = false;
  btn.classList.add('active');
  btn.textContent = 'stop sweep';

  const stepMs  = 600;   // ms per speaker
  const fadeMs  = 40;    // fade in + out each burst
  // Base level, before master. 0.06 → 0.03 → 0.015 over two rounds of Ek
  // listening on the actual rig (2026-08-01). White noise is broadband, so it
  // reads far louder through a PA than the same nominal gain of granulated
  // material — the original value had only ever been judged on a laptop.
  //
  // 0.015 ≈ −36 dBFS here, ≈ −42 dBFS at his usual −6 dB master. That is the
  // right order for "identify which box is making noise" rather than "test
  // the system", which is what the level had been behaving like.
  const vol     = 0.015;

  // Master volume applies to the sweep, but only the Electron path has to do
  // it by hand. The browser path connects through getMasterBus(), which
  // already carries master gain — scaling there would apply it twice.
  // Electron writes straight to the ChannelMerger, bypassing the speakerBuses
  // whose gain is where master lives, so the sweep was previously the one
  // sound in the app the master slider couldn't touch.
  //
  // Read per burst, not once at the top: the sweep loops until stopped, so
  // this makes the slider live while it's running — ride it down until the
  // speakers are at a comfortable identification level.
  //
  // Mute the same way, for the same reason: setMuted() ramps the speakerBuses,
  // which this path bypasses, so the sweep was the one sound M could not stop
  // in Electron while the browser path (through getMasterBus → _muteGain)
  // obeyed it (#174). Read per burst too, so a mute lands within one step.
  const electronVol = () => S.isMuted ? 0 : vol * (S.outputGainValue ?? MASTER_DEFAULT_GAIN);

  const buses = S.speakerBuses;  // may be null in browser

  if (buses?.length) {
    // ── Electron: sweep only the physically assigned output channels ──────────
    // Build list from actual routing — house channels first, then mixdown.
    // Bypasses VBAP and downmix; each channel gets noise directly.
    const houseRouting = S.channelRouting ?? buses.map((_, i) => i);
    const nHouse       = buses.length;
    const hpL = S.headphoneRouting?.[0] ?? nHouse;
    const hpR = S.headphoneRouting?.[1] ?? nHouse + 1;

    const sweepList = [
      ...buses.map((b, i) => ({
        ch:    houseRouting[i] ?? i,
        label: `out ${(houseRouting[i] ?? i) + 1} — position ${i + 1} (${b.angleDeg.toFixed(0)}°)`,
      })),
      ...(S.monitorSpeakerBuses?.length ? [
        { ch: hpL, label: `out ${hpL + 1} — stereo mixdown L` },
        { ch: hpR, label: `out ${hpR + 1} — stereo mixdown R` },
      ] : []),
    ];

    while (!_sweepStopFlag) {
      for (const entry of sweepList) {
        if (_sweepStopFlag) break;
        setStatus('asOutputStatus', 'warn', `sweep — ${entry.label}`);
        await playSweepChannel(entry.ch, stepMs, fadeMs, electronVol());
      }
    }
  } else {
    // ── Browser stereo: sweep panner left → centre → right ──────────────────
    const positions = [
      { pan: -1, label: 'left' },
      { pan:  0, label: 'centre' },
      { pan:  1, label: 'right' },
    ];
    while (!_sweepStopFlag) {
      for (const pos of positions) {
        if (_sweepStopFlag) break;
        setStatus('asOutputStatus', 'warn', `sweep — ${pos.label}`);

        const frames   = Math.floor(ctx.sampleRate * stepMs / 1000);
        const noiseBuf = ctx.createBuffer(1, frames, ctx.sampleRate);
        const data     = noiseBuf.getChannelData(0);
        for (let s = 0; s < frames; s++) data[s] = Math.random() * 2 - 1;

        const src    = ctx.createBufferSource();
        src.buffer   = noiseBuf;
        const gain   = ctx.createGain();
        const panner = ctx.createStereoPanner();
        panner.pan.value = pos.pan;
        const fadeSec = fadeMs / 1000;
        const t = ctx.currentTime;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(vol, t + fadeSec);
        gain.gain.setValueAtTime(vol, t + stepMs / 1000 - fadeSec);
        gain.gain.linearRampToValueAtTime(0, t + stepMs / 1000);

        src.connect(gain);
        gain.connect(panner);
        panner.connect(getMasterBus() ?? ctx.destination);
        src.start();

        await new Promise(r => setTimeout(r, stepMs));
        try { src.stop(); src.disconnect(); gain.disconnect(); panner.disconnect(); } catch(_) {}
      }
    }
  }

  _sweepActive = false;
  btn.classList.remove('active');
  btn.textContent = 'speaker sweep';
  setStatus('asOutputStatus', _sweepStopFlag ? 'idle' : 'ok',
    _sweepStopFlag ? 'sweep stopped' : 'sweep complete');
}

function handleTestTone() { runSpeakerSweep(); }

// ── Input device picker ───────────────────────────────────────────────────────
// Works in both browser and Electron — uses the standard Web MediaDevices API.
// enumerateDevices() only returns labels after mic permission is granted, so we
// request a minimal stream first to unlock labels, then enumerate.

let _inputDeviceId   = null;  // currently active input deviceId
let _inputDeviceName = null;  // its name — the stable key; see resolveAudioDevice()
let _inputNumCh      = 1;     // channels actually delivered by current stream

let _outputDeviceId   = null;  // currently active output deviceId (set on Apply)
let _outputDeviceName = null;  // its name — the stable key
// The latency model keys its measurements on the device PAIR by name.
S._inputDeviceKey  = () => _inputDeviceName ?? _inputDeviceId ?? 'in';
S._outputDeviceKey = () => _outputDeviceName ?? _outputDeviceId ?? 'out';

/**
 * Resolve a persisted device choice against the devices present right now.
 *
 * Device ids are RUNTIME HANDLES, not identities. On macOS they are CoreAudio
 * object ids, reassigned across reboots and whenever a virtual device (BlackHole,
 * Zoom, Loopback) registers in a different order. A saved id can therefore come
 * back pointing at a different device — which is how output silently lands on a
 * virtual device with no speakers behind it: full signal, no sound, no error.
 * The name is the only part that survives, so the name wins.
 *
 * If a name was saved and no longer matches, the device is genuinely absent, and
 * we fall to the system default rather than the id — trusting a stale id at that
 * point is exactly the bug this function exists to prevent.
 */
export function resolveAudioDevice(devices, name, id) {
  if (!Array.isArray(devices) || devices.length === 0) return null;

  if (name != null) {
    // Two identical interfaces can share a name — the id breaks that tie.
    const byName = devices.filter(d => d.name === name);
    if (byName.length) return byName.find(d => d.id === id) || byName[0];
    return devices.find(d => d.isDefault) || null;
  }

  // Entry saved before names were persisted: resolve by id this once. The next
  // save writes the name, after which this branch is unreachable.
  return (id != null && devices.find(d => d.id === id))
      || devices.find(d => d.isDefault)
      || null;
}

// Label of the currently selected <option>, for the browser path where devices
// carry a MediaDevices `label` rather than an RtAudio `name`.
function _selectedLabel(selId) {
  const t = document.getElementById(selId)?.selectedOptions?.[0]?.textContent;
  return (t && t.trim() && !t.trim().startsWith('—')) ? t.trim() : null;
}

async function populateInputDevices() {
  const sel = document.getElementById('asInputDevice');
  if (!sel) return;

  sel.innerHTML = '<option value="">— scanning… —</option>';

  try {
    if (window.electronBridge?.getInputDevices) {
      // ── Electron: use RtAudio device list (shows true channel counts) ──────
      const devices = await window.electronBridge.getInputDevices();
      sel.innerHTML = '';
      // Always show placeholder so user can deselect / go back to no input
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = '— select input device —';
      sel.appendChild(ph);
      devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        const chLabel = d.inputChannels === 1 ? 'mono' : `${d.inputChannels} ch`;
        const defTag  = d.isDefault ? ' (default)' : '';
        opt.textContent = `${d.name} (${chLabel})${defTag}`;
        if (d.id === _inputDeviceId) opt.selected = true;
        sel.appendChild(opt);
      });
      if (_inputDeviceId != null) sel.value = _inputDeviceId;
      // RtAudio ids are positions in a list that shifts as devices come and
      // go (BlackHole, Zoom, headphones), so a saved id can name the wrong
      // row or none — the NAME is the stable key (resolveAudioDevice). The
      // stream at startup is opened by name; the dropdown follows it.
      if (!sel.value && _inputDeviceName) {
        const m = devices.find(d => d.name === _inputDeviceName);
        if (m) sel.value = String(m.id);
      }

    } else {
      // ── Browser: use standard MediaDevices API ───────────────────────────
      if (!S.micPermissionGranted) {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach(t => t.stop());
      }
      const all    = await navigator.mediaDevices.enumerateDevices();
      const inputs = all.filter(d => d.kind === 'audioinput');
      sel.innerHTML = '';
      // Always show placeholder so user can deselect / go back to no input
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = '— select input device —';
      sel.appendChild(ph);
      inputs.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `Input ${d.deviceId.slice(0, 8)}`;
        if (d.deviceId === _inputDeviceId) opt.selected = true;
        sel.appendChild(opt);
      });
      if (_inputDeviceId) sel.value = _inputDeviceId;
    }
  } catch (e) {
    sel.innerHTML = `<option value="">error: ${e.message}</option>`;
  }
}

// Repopulate channel dropdown based on what the stream actually delivers
function repopulateChannelSelect(numCh) {
  const sel = document.getElementById('asInputChannel');
  if (!sel) return;
  sel.innerHTML = '';

  for (let i = 0; i < numCh; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `ch ${i + 1}`;
    sel.appendChild(opt);
  }

  if (numCh >= 2) {
    const stereo = document.createElement('option');
    stereo.value = 'stereo';
    stereo.textContent = 'stereo (L+R)';
    sel.appendChild(stereo);
  }

  sel.value = '0'; // default to ch 1

  // Mirror the new options into the main-UI audio panel's dropdown so the
  // two stay in lockstep without the panel needing device-detection logic.
  S._syncAudioPanelChannels?.();
}

async function applyInputDevice() {
  const devSel = document.getElementById('asInputDevice');
  if (!devSel) return;

  // ── Deselect: tear down input and clear saved device ──────────────────────
  if (!devSel.value) {
    stopMetering();

    // Disconnect worklet + analysers (Electron RtAudio path)
    if (_inputWorkletNode) {
      try { _inputWorkletNode.disconnect(); } catch(_) {}
      _inputWorkletNode = null;
    }
    _rtInputRoutingGains.forEach(g => { try { g.disconnect(); } catch(_) {} });
    _rtInputRoutingGains = [];
    as.inputAnalysers.forEach(an => { try { an.disconnect(); } catch(_) {} });
    as.inputAnalysers = [];
    as._meterGainNodes.forEach(g => { try { g.disconnect(); } catch(_) {} });
    as._meterGainNodes = [];
    S.inputAnalysers = [];
    _rtInputSplitter = null;

    _closeBrowserMic();

    // Clear saved state
    _inputDeviceId   = null;
    _inputDeviceName = null;
    _inputNumCh      = 0;
    S._savedInputDeviceId   = null;
    S._savedInputDeviceName = null;
    S.selectedInputDeviceId = null;
    S.micPermissionGranted  = false;
    as.started = false;
    window._rtAudioInputListening = false;

    // Reset UI
    renderSetMeters('asInputMeters', ['1']);  // minimal placeholder meter
    const mapTable = document.getElementById('asInputMappingTable');
    if (mapTable) mapTable.style.display = 'none';
    setStatus('asInputStatus', 'idle', 'no input device');

    const micBtn = document.getElementById('micEnableBtn');
    if (micBtn) {
      setMicBtnLabel('enable mic');
      micBtn.classList.remove('mic-ready', 'mic-denied');
    }
    return;
  }

  setStatus('asInputStatus', 'idle', 'opening input stream…');
  stopMetering();

  // ── Electron: use RtAudio for true multichannel input metering ─────────────
  if (window.electronBridge?.setInputDevice) {
    const deviceId  = parseInt(devSel.value, 10);
    const bufFrames = S.preferredBufferSize ?? 1024;

    // Find the device to know its channel count
    const devices = await window.electronBridge.getInputDevices();
    const device  = devices.find(d => d.id === deviceId);
    if (!device) {
      setStatus('asInputStatus', 'error', 'device not found');
      return;
    }

    const result = await window.electronBridge.setInputDevice(deviceId, device.inputChannels, bufFrames, S.audioCtx?.sampleRate);
    if (!result.ok) {
      setStatus('asInputStatus', 'error', result.error ?? 'failed to open input stream');
      return;
    }

    const nCh = result.nCh;
    _inputDeviceId   = deviceId;
    _inputDeviceName = device.name ?? null;
    _inputNumCh      = nCh;
    S._refreshLatency?.();   // a new input stream: new buffers, new figure

    // Web Audio caps at 32 channels — meter/route the first 32, but the worklet
    // deinterleaves all hw channels correctly (stride = nCh).
    const meteredCh = Math.min(32, nCh);
    await setupRtAudioInputMeters(nCh);
    repopulateChannelSelect(meteredCh);
    renderInputMeters(S.mainInputChannel ?? 0);
    renderInputMappingTable();  // show software-path → hardware-channel table

    as.started = true;
    const devLabel = devSel.options[devSel.selectedIndex]?.text || String(deviceId);
    const chLabel = nCh > 32 ? `${meteredCh} of ${nCh} ch (Web Audio limit)` : `${nCh} ch`;
    setStatus('asInputStatus', 'ok', `${devLabel} — ${chLabel} — ${result.sampleRate} Hz`);
    startMetering();

    // Sync mic button — input is now live
    const micBtn = document.getElementById('micEnableBtn');
    if (micBtn) {
      setMicBtnLabel('mic ready');
      micBtn.classList.remove('mic-denied');
      micBtn.classList.add('mic-ready');
      micBtn.disabled = false;
    }
    return;
  }

  // ── Browser: getUserMedia (capped at 2ch by browser) ─────────────────────
  const deviceId = devSel.value;

  try {
    // Stop existing stream tracks so the OS releases the device
    if (S.recordingStream) {
      S.recordingStream.getTracks().forEach(t => t.stop());
    }

    // Disconnect old monitor chain
    try { window._micMonitorSrc?.disconnect(); } catch(_) {}
    try { S.inputGainNode?.disconnect(); }       catch(_) {}

    // Open new stream — request as many channels as possible, browser delivers what it can
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId:         { exact: deviceId },
        channelCount:     { ideal: 32 },   // ask for lots; browser caps at device max
        sampleRate:       { ideal: S.audioCtx?.sampleRate ?? 48000 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl:  false,
      }
    });

    // Find out how many channels we actually got
    const settings = stream.getAudioTracks()[0]?.getSettings() ?? {};
    const numCh    = settings.channelCount || 1;

    // Store on S — this becomes the shared recording stream
    S.recordingStream          = stream;
    S.inputStream              = stream;
    S.micPermissionGranted     = true;
    S.selectedInputDeviceId    = deviceId;   // used by requestMicAccess on next open
    S.selectedInputChannels    = numCh;
    _inputDeviceId             = deviceId;
    _inputDeviceName           = _selectedLabel('asInputDevice');
    _inputNumCh                = numCh;

    // Rebuild the persistent monitor chain in audio.js
    const actx       = S.audioCtx || (await import('./audio.js').then(m => m.ensureAudioContext()));
    const monitorSrc = actx.createMediaStreamSource(stream);

    S.inputGainNode = actx.createGain();
    const _applyDevCh = document.getElementById('asInputChannel')?.value ?? '0';
    S.inputGainNode.gain.value = dbToLinear(as.inputGains?.[_applyDevCh] ?? 0);

    S.inputAnalyser = actx.createAnalyser();
    S.inputAnalyser.fftSize = 256;
    S.inputAnalyser.smoothingTimeConstant = 0.6;

    monitorSrc.connect(S.inputGainNode);
    S.inputGainNode.connect(S.inputAnalyser);
    // Reconnect dry monitor chain to the new inputGainNode
    if (S.dryGainNode) S.inputGainNode.connect(S.dryGainNode);
    window._micMonitorSrc = monitorSrc;

    // Update channel dropdown to reflect actual channel count
    repopulateChannelSelect(numCh);

    // Rebuild input graph for selected channel (also populates as.inputAnalysers)
    buildInputGraph(document.getElementById('asInputChannel')?.value || '0');

    // Render N vertical meter bars for the actual channel count
    renderInputMeters();

    as.started = true;
    const devLabel = devSel.options[devSel.selectedIndex]?.text || deviceId;
    setStatus('asInputStatus', 'ok', `${devLabel} — ${numCh} ch — ${actx.sampleRate} Hz`);
    startMetering();

    // Sync mic button — input is now live
    const micBtn = document.getElementById('micEnableBtn');
    if (micBtn) {
      setMicBtnLabel('mic ready');
      micBtn.classList.remove('mic-denied');
      micBtn.classList.add('mic-ready');
      micBtn.disabled = false;
    }

    // Pre-load recording worklet so painting works immediately
    if (!S.audioEngineWarmedUp) {
      S.audioEngineWarmedUp = true;
      warmUpAudioEngine();
    }

  } catch (e) {
    setStatus('asInputStatus', 'error', `failed: ${e.message}`);
  }
}

// ── Output device picker (Electron only) ──────────────────────────────────────

async function populateOutputDevices() {
  const row    = document.getElementById('asOutputDeviceRow');
  const sel    = document.getElementById('asOutputDevice');
  const note   = document.getElementById('asOutputNote');
  if (!row || !sel) return;

  if (!window.electronBridge?.isElectron) return; // browser — leave hidden

  row.style.display = '';
  if (note) note.style.display = 'none'; // hide the "use System Settings" note

  try {
    const devices = await window.electronBridge.getAudioDevices();
    sel.innerHTML = '';

    if (!devices.length) {
      sel.innerHTML = '<option value="">no output devices found</option>';
      return;
    }

    // Sort: system default first, then multi-channel, then stereo
    const sorted = [
      ...devices.filter(d => d.isDefault),
      ...devices.filter(d => !d.isDefault && d.quadCapable),
      ...devices.filter(d => !d.isDefault && !d.quadCapable),
    ];

    sorted.forEach(d => {
      const opt     = document.createElement('option');
      opt.value     = d.id;
      const chLabel = d.outputChannels === 2 ? 'stereo' : `${d.outputChannels} ch`;
      const defTag  = d.isDefault ? ' (system default)' : '';
      opt.textContent = `${d.name} (${chLabel})${defTag}`;
      if (!d.quadCapable) opt.style.color = '#888'; // dim stereo-only devices
      sel.appendChild(opt);
    });

    // Restore the last-applied device — by id, else by NAME (the id is a
    // position that shifts as devices come and go); fall back to system
    // default on first open.
    const byName = _outputDeviceName ? devices.find(d => d.name === _outputDeviceName) : null;
    if (_outputDeviceId != null && devices.some(d => d.id === _outputDeviceId)) {
      sel.value = _outputDeviceId;
    } else if (byName) {
      sel.value = String(byName.id);
    } else {
      const defaultDev = devices.find(d => d.isDefault) || devices[0];
      if (defaultDev) sel.value = defaultDev.id;
    }

  } catch (e) {
    sel.innerHTML = `<option value="">error: ${e.message}</option>`;
  }
}

async function applyOutputDevice() {
  const sel    = document.getElementById('asOutputDevice');
  const status = document.getElementById('asOutputStatus');
  if (!sel?.value) return;

  const deviceId = parseInt(sel.value, 10);
  if (isNaN(deviceId)) return;

  // Find channel count for this device from the option label
  const devices = await window.electronBridge.getAudioDevices();
  const device  = devices.find(d => d.id === deviceId);
  if (!device) return;

  // Web Audio caps createChannelMerger at 32; clamp here so both RtAudio and
  // the Web Audio graph agree on channel count (extra hw channels stay silent).
  const numCh = Math.min(32, device.outputChannels);

  setStatus('asOutputStatus', 'idle', `opening ${numCh}-ch stream on "${device.name}"…`);

  try {
    // Clear any stale channel routing from a previous device — it's channel-count
    // specific and would silently misroute buses on the new layout.
    S.channelRouting = null;

    // Open the hardware stream first so audify is ready for the correct channel
    // count before the Web Audio worklet starts posting buffers to it.
    const bufFrames = S.preferredBufferSize ?? 1024;
    const result = await window.electronBridge.setAudioDevice(deviceId, numCh, bufFrames, S.audioCtx?.sampleRate);

    // Now rebuild the Web Audio speaker bus graph — worklet posts start after this.
    await initSpeakerBuses(numCh);

    if (result.streaming) {
      _outputDeviceId   = deviceId;        // remember for dropdown restore on re-open
      _outputDeviceName = device.name ?? null;  // the key that survives a reboot

      const layout = numCh === 2 ? 'stereo'
                   : numCh === 4 ? 'quad'
                   : numCh === 6 ? '5.1'
                   : numCh === 8 ? 'octaphonic'
                   : `${numCh}-ch`;
      const ctxRate  = S.audioCtx?.sampleRate;
      const rateNote = result.sampleRate && result.sampleRate !== ctxRate
        ? ` ⚠ rate mismatch: AudioContext ${ctxRate} Hz vs device ${result.sampleRate} Hz`
        : ` — ${result.sampleRate ?? ctxRate} Hz`;
      setStatus('asOutputStatus', 'ok', `${layout} — "${device.name}" — ${numCh} ch${rateNote}`);

      // Show output meters + mapping table now that speaker buses are set up.
      // Also reveal the house-speaker count + stereo mixdown controls.
      renderOutputMeters();
      renderRoutingTable();
      const houseRow = document.getElementById('asHouseSpeakersRow');
      if (houseRow) houseRow.style.display = '';
      syncHouseSpeakersSeg();  // reveals mixdown row, syncs dropdown + checkbox
      // Restart metering loop so output bars also tick
      startMetering();
    } else {
      setStatus('asOutputStatus', 'error', `stream did not start — check device supports ${numCh} ch`);
    }
  } catch (e) {
    setStatus('asOutputStatus', 'error', `failed: ${e.message}`);
  }
}

// ── Save / Load audio settings defaults ───────────────────────────────────────
// Four keys, not one. `mubone_audio_defaults` used to also carry viz
// calibration, dark mode, the seed settings, the active patch index and a
// sensor calibration — so "reset audio settings" would silently have reset the
// theme and the particle sizing too. Split 2026-08-01 so the reset categories
// in js/storage-registry.js mean what they say. One-shot migration lives in
// loadAudioDefaults(); after it runs the old blob holds audio fields only.
//
// Two fields left persistence entirely in that split:
//   darkMode   — ui-viz.js already owned `mubone_darkMode`, and both wrote it.
//                Load order decided which won. ui-viz is now the sole owner.
//   sensor3Cal — nothing in the app ever assigned to it; only the separate
//                gesture-window.html read it, and both left on 2026-09-05.
//                It stays in SPLIT_DROPPED so an old blob carrying it is
//                dropped rather than moved.
const LS_AUDIO_DEFAULTS = 'mubone_audio_defaults';
const LS_SEED_SETTINGS  = 'mubone_seed_settings';
const LS_VIZ_CAL        = 'mubone_viz_calibration';

// Legacy export — kept so existing imports don't break (no-op now)
export function wireSaveDefaultBtn(_btnId) {}

// The one field list. Both saveAllDefaults() and the auto-save dirty check
// consume this — that is the whole point. They used to be two hand-written
// lists and had drifted: the nine handsfree fields and `recLimitSeconds` were
// written by the save but absent from the dirty check, so changing only a
// handsfree setting or the recording limit never marked state dirty and was
// never persisted until some unrelated setting changed. Meanwhile `fovDeg` sat
// in the dirty check but was written by ui-viz.js under `mubone_fovDeg`, so it
// was watched here for nothing. Add a field to one of these objects and both
// the save and the dirty check pick it up.
//
// No timestamp in here — the dirty check hashes the result, and a `ts` field
// would make every tick look changed.
function _buildPayloads() {
  return {
    audio: {
      // Devices — the *Name* fields are the real key; the ids are runtime
      // handles kept only for tie-breaking. See resolveAudioDevice().
      inputDeviceId:     _inputDeviceId,
      inputDeviceName:   _inputDeviceName,
      outputDeviceId:    _outputDeviceId,
      outputDeviceName:  _outputDeviceName,
      mainInputChannel:  S.mainInputChannel ?? 0,

      // Engine
      sampleRate:       S.audioCtx?.sampleRate ?? null,
      bufferSize:       S.preferredBufferSize ?? null,

      // Gains
      outputGain:       as.outputGain,
      inputGains:       { ...as.inputGains },

      // Paint gate
      paintGateThreshold:    S.paintGateThreshold,

      // Handsfree
      hfHoldMs:         S.hfHoldMs,
      hfReleaseMs:      S.hfReleaseMs,
      hfMarginDb:       S.hfMarginDb,
      hfHpfFreq:        S.hfHpfFreq,
      hfHpfEnabled:     S.hfHpfEnabled,
      hfMinBufferMs:    S.hfMinBufferMs,
      hfMaxBufferSec:   S.hfMaxBufferSec,
      hfFeedbackDetect: S.hfFeedbackDetect,
      hfCompEnabled:    S.hfCompEnabled,

      // Spatial panning
      spatialPanning:   S.spatialPanning,

      // Speaker layout + routing
      numHouseSpeakers:     S.numHouseSpeakers,
      stereoMixdownEnabled: S.stereoMixdownEnabled,
      channelRouting:       S.channelRouting ?? null,
      headphoneRouting:     S.headphoneRouting ?? null,

      // Headphone mix balance
      mixdownCursorGainValue: S.mixdownCursorGainValue ?? 1.0,
      mixdownHouseGainValue:  S.mixdownHouseGainValue ?? 1.0,

      // Recording limit
      recLimitSeconds: S.recLimitSeconds,
    },

    // Seed / loop playback setup — persisted as rig setup, not live performance
    seed: {
      seedMode:        S.seedMode ?? 'all',
      seedTether:      S.seedTether ?? false,
      seedXfade:       S.seedXfade ?? 0.5,
      seedAttack:      S.seedAttack ?? 0,
      seedRelease:     S.seedRelease ?? 0,
      seedLoopMode:    S.seedLoopMode ?? 'pingpong',
      loopReleaseMode: S.loopReleaseMode ?? 'fade',
      loopFadeTimeMs:  S.loopFadeTimeMs ?? 15,
      // Trigger playback params. Live performance state (a session carries them
      // too), persisted here only so the rig boots with the values you last
      // played rather than the factory ones — the same reason the seed envelope
      // settings above are here. The cap — the one mute hits have had since
      // 2026-09-07 — is deliberately NOT persisted: a rig should never boot
      // silently muted.
      triggerParams: { ...S.triggerParams },
    },

    // How particles are drawn — belongs with the other UI keys, not with audio
    viz: {
      vizMinSize:        S.vizMinSize,
      vizMaxSize:        S.vizMaxSize,
      vizRmsMin:         S.vizRmsMin,
      vizRmsMax:         S.vizRmsMax,
      vizCentroidMin:    S.vizCentroidMin,
      vizCentroidMax:    S.vizCentroidMax,
      radiusFadeEnabled: S.radiusFadeEnabled,
      radiusFadeCurve:   S.radiusFadeCurve,
      cameraMode:        S.cameraMode,
      camPull:           S.camPull,
      gazeTrailSec:      S.gazeTrailSec,
    },

  };
}

export function saveAllDefaults() {
  const p = _buildPayloads();
  try {
    const json = JSON.stringify({ ...p.audio, ts: Date.now() });
    localStorage.setItem(LS_AUDIO_DEFAULTS, json);
    localStorage.setItem(LS_SEED_SETTINGS, JSON.stringify(p.seed));
    localStorage.setItem(LS_VIZ_CAL,       JSON.stringify(p.viz));
    DEBUG && console.log('[defaults] auto-saved:', json.length, 'bytes');
    return true;
  } catch (e) {
    console.warn('[defaults] could not save:', e);
    return false;
  }
}

// ── Auto-persist via dirty check ────────────────────────────────────────────
// Every 2s, hash the persisted settings and compare to the last save. Only
// writes to localStorage when something actually changed, which avoids needing
// 59+ individual scheduleAutoSave() call sites.
//
// Hashes _buildPayloads() — the same object the save writes — so a field can no
// longer be saved-but-unwatched. Don't reintroduce a separate snapshot builder
// here; that split is exactly how the handsfree fields stopped persisting.
let _lastSavedJson = '';

function _checkAndSave() {
  try {
    const json = JSON.stringify(_buildPayloads());
    if (json !== _lastSavedJson) {
      _lastSavedJson = json;
      saveAllDefaults();
    }
  } catch (_) { /* ignore — quota or serialization error */ }
}

// Start the dirty-check loop after a short delay so page init settles
export function startAutoSave() {
  // Capture initial snapshot so we don't re-save on first tick
  try { _lastSavedJson = JSON.stringify(_buildPayloads()); } catch (_) {}
  setInterval(_checkAndSave, 2000);
}

// Legacy export — kept so existing imports don't break
export function scheduleAutoSave() { _checkAndSave(); }

// ── Pre-split blob normalisation (2026-08-01) ───────────────────────────────
// The old single blob carried viz calibration, seed settings and the active
// patch index; those now live in their own keys so the reset categories are
// honest. Read old → write new → strip from old.
//
// darkMode and sensor3Cal are dropped rather than moved — see the note above
// LS_AUDIO_DEFAULTS. darkMode already had a home in ui-viz.js, and the value
// here could only ever be a duplicate of it or the state.js default.
//
// This runs against an abstract store rather than localStorage directly,
// because it has TWO callers with the same problem:
//
//   1. loadAudioDefaults() — migrating this machine's own localStorage, once.
//   2. applySettingsPayload() in ui-export.js — normalising a v1–v3 setup or
//      session file on the way in. A pre-v4 file carries the grab-bag blob and
//      none of the successor keys, so it MUST be reshaped before its keys are
//      written. Doing it afterwards silently lost the imported seed settings,
//      viz calibration and active patch on any machine that had already
//      migrated: the destination key existed, so `overwrite:false` skipped the
//      write while the strip still removed the fields from the blob.
//
// `overwrite` is the difference between them. Migrating in place must never
// clobber already-split data (a second run would wipe it); an import is an
// explicit instruction to take the file's values, so it overwrites.
const SPLIT_MOVED = {
  seed: ['seedMode', 'seedTether', 'seedXfade', 'seedAttack', 'seedRelease',
         'seedLoopMode', 'loopReleaseMode', 'loopFadeTimeMs',
         // NOTE: triggerParams is deliberately absent. This list
         // is what the pre-v4 grab-bag blob held; those fields postdate the
         // split and can never appear in one, so listing them would describe
         // history that didn't happen.
         // legacy aliases _loadSeedSettings still honours
         'seedNearestAlways', 'seedSnapFade', 'seedCrossfade'],
  viz:  ['vizMinSize', 'vizMaxSize', 'vizRmsMin', 'vizRmsMax',
         'vizCentroidMin', 'vizCentroidMax',
         'radiusFadeEnabled', 'radiusFadeCurve', 'cameraMode'],
};
const SPLIT_DROPPED = ['darkMode', 'vizMode', 'sensor3Cal', 'wandCal', 'fovDeg'];

/** localStorage as a `{get,set,has}` store, for splitLegacyAudioBlob. */
const LS_STORE = {
  get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} },
  has: k => { try { return localStorage.getItem(k) !== null; } catch (_) { return false; } },
};

/** A plain `{key: rawString}` map (an import payload) as the same store. */
export function objectStore(obj) {
  return {
    get: k => (k in obj ? obj[k] : null),
    set: (k, v) => { obj[k] = v; },
    has: k => k in obj && obj[k] != null,
  };
}

/**
 * Reshape a pre-v4 `mubone_audio_defaults` blob in `store` into the four keys
 * it was split into. No-op when the blob is absent or already split.
 * Returns the number of fields moved or dropped.
 */
export function splitLegacyAudioBlob(store, { overwrite = false } = {}) {
  let d;
  try {
    const raw = store.get(LS_AUDIO_DEFAULTS);
    if (!raw) return 0;
    d = JSON.parse(raw);
  } catch (_) { return 0; }
  if (!d || typeof d !== 'object') return 0;

  const DEST = { seed: LS_SEED_SETTINGS, viz: LS_VIZ_CAL };
  let touched = 0;

  for (const [group, fields] of Object.entries(SPLIT_MOVED)) {
    const destKey = DEST[group];
    const carried = {};
    for (const f of fields) if (f in d) { carried[f] = d[f]; touched++; }
    if (!Object.keys(carried).length) continue;
    if (overwrite || !store.has(destKey)) store.set(destKey, JSON.stringify(carried));
    for (const f of fields) delete d[f];
  }

  // `activePresetIndex` pointed into the patch bank, sunset 2026-09-03: dropped.
  if ('activePresetIndex' in d) { delete d.activePresetIndex; touched++; }

  for (const f of SPLIT_DROPPED) if (f in d) { delete d[f]; touched++; }

  if (touched) {
    store.set(LS_AUDIO_DEFAULTS, JSON.stringify(d));
    console.log(`[defaults] split ${touched} field(s) out of the legacy audio blob`);
  }
  return touched;
}

export function loadAudioDefaults() {
  try {
    // Split first, then load — so the three loaders below see the successor
    // keys whether they were already there or created a moment ago. In-place
    // migration never overwrites: a second run would wipe split data.
    splitLegacyAudioBlob(LS_STORE);
    // These three keys stand alone — a reset of `audio` wipes the blob but must
    // leave viz calibration and the active patch intact, so they can't sit
    // behind an early return on the blob's absence.
    _loadSeedSettings();
    _loadVizCalibration();
    const raw = localStorage.getItem(LS_AUDIO_DEFAULTS);
    if (!raw) return;
    const d = JSON.parse(raw);

    // Devices — restore module-level vars so dropdowns pre-select on next open,
    // and expose on S so main.js can auto-open the saved devices at startup.
    if (d.inputDeviceName != null) {
      _inputDeviceName = d.inputDeviceName;
      S._savedInputDeviceName = d.inputDeviceName;
    }
    if (d.inputDeviceId != null) {
      _inputDeviceId = d.inputDeviceId;
      S._savedInputDeviceId = d.inputDeviceId;
      // Also set selectedInputDeviceId so requestMicAccess (browser path)
      // opens the saved device instead of the system default.
      S.selectedInputDeviceId = d.inputDeviceId;
    }
    if (d.outputDeviceName != null) {
      _outputDeviceName = d.outputDeviceName;
      S._savedOutputDeviceName = d.outputDeviceName;
    }
    if (d.outputDeviceId != null) {
      _outputDeviceId = d.outputDeviceId;
      S._savedOutputDeviceId = d.outputDeviceId;
    }
    if (d.mainInputChannel === 'stereo' || typeof d.mainInputChannel === 'number') S.mainInputChannel = d.mainInputChannel;

    // Engine
    if (typeof d.sampleRate === 'number') S.savedSampleRate = d.sampleRate;
    if (typeof d.bufferSize === 'number') S.preferredBufferSize = d.bufferSize;

    // Gains
    if (typeof d.outputGain === 'number') {
      as.outputGain = d.outputGain;
      S.outputGainValue = dbToLinear(d.outputGain);
    }
    if (d.inputGains && typeof d.inputGains === 'object') {
      Object.assign(as.inputGains, d.inputGains);
    }

    // Paint gate. One-shot migration: the key was `vizNoiseFloor` until the
    // rename (the name said "viz" for the threshold that decides which moments
    // become playable at all). Read the old key once, then let the next save
    // write the new one — no persistent fallback.
    if (typeof d.paintGateThreshold === 'number')   S.paintGateThreshold = d.paintGateThreshold;
    else if (typeof d.vizNoiseFloor === 'number')   S.paintGateThreshold = d.vizNoiseFloor;

    // Handsfree
    if (typeof d.hfHoldMs         === 'number')  S.hfHoldMs         = d.hfHoldMs;
    if (typeof d.hfReleaseMs      === 'number')  S.hfReleaseMs      = d.hfReleaseMs;
    if (typeof d.hfMarginDb       === 'number')  S.hfMarginDb       = d.hfMarginDb;
    if (typeof d.hfHpfFreq        === 'number')  S.hfHpfFreq        = d.hfHpfFreq;
    if (typeof d.hfHpfEnabled     === 'boolean') S.hfHpfEnabled     = d.hfHpfEnabled;
    if (typeof d.hfMinBufferMs    === 'number')  S.hfMinBufferMs    = d.hfMinBufferMs;
    if (typeof d.hfMaxBufferSec   === 'number')  S.hfMaxBufferSec   = d.hfMaxBufferSec;
    if (typeof d.hfFeedbackDetect === 'boolean') S.hfFeedbackDetect = d.hfFeedbackDetect;
    if (typeof d.hfCompEnabled    === 'boolean') S.hfCompEnabled    = d.hfCompEnabled;

    // Spatial panning. (FOV, dark mode and viz calibration used to be read
    // here — they moved to ui-viz.js / mubone_viz_calibration.)
    if (typeof d.spatialPanning === 'string' && ['headlocked', 'worldlocked'].includes(d.spatialPanning)) S.spatialPanning = d.spatialPanning;

    // Speaker layout + routing
    if (typeof d.numHouseSpeakers    === 'number')  S.numHouseSpeakers     = d.numHouseSpeakers;
    if (typeof d.stereoMixdownEnabled === 'boolean') S.stereoMixdownEnabled = d.stereoMixdownEnabled;
    if (Array.isArray(d.channelRouting))              S.channelRouting       = d.channelRouting;
    if (Array.isArray(d.headphoneRouting))             S.headphoneRouting     = d.headphoneRouting;

    // Headphone mix balance
    if (typeof d.mixdownCursorGainValue === 'number') S.mixdownCursorGainValue = d.mixdownCursorGainValue;
    if (typeof d.mixdownHouseGainValue === 'number')  S.mixdownHouseGainValue  = d.mixdownHouseGainValue;

    // Recording limit
    if (typeof d.recLimitSeconds === 'number') S.recLimitSeconds = d.recLimitSeconds;

    DEBUG && console.log('[defaults] restored saved defaults');
  } catch (e) {
    console.warn('[audio-settings] could not load defaults:', e);
  }
}

// ── mubone_seed_settings ────────────────────────────────────────────────────
// The legacy-alias reads (seedNearestAlways / seedSnapFade / seedCrossfade)
// stay because pre-split blobs carried those names and the migration moves them
// across verbatim. Once a bucket has been migrated and saved once, only the
// canonical names get written.
function _loadSeedSettings() {
  try {
    const raw = localStorage.getItem(LS_SEED_SETTINGS);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (typeof d.seedMode === 'string')    S.seedMode   = d.seedMode;
    if (typeof d.seedTether === 'boolean') S.seedTether = d.seedTether;
    else if (typeof d.seedNearestAlways === 'boolean') S.seedTether = d.seedNearestAlways;
    if (typeof d.seedXfade === 'number')         S.seedXfade = d.seedXfade;
    else if (typeof d.seedSnapFade === 'number') S.seedXfade = d.seedSnapFade;
    else if (typeof d.seedCrossfade === 'number') S.seedXfade = d.seedCrossfade;
    if (typeof d.seedAttack === 'number')  S.seedAttack  = d.seedAttack;
    if (typeof d.seedRelease === 'number') S.seedRelease = d.seedRelease;
    if (typeof d.seedLoopMode === 'string' && ['pingpong', 'forward'].includes(d.seedLoopMode))
      S.seedLoopMode = d.seedLoopMode;
    if (typeof d.loopReleaseMode === 'string' && ['fade', 'play-to-end'].includes(d.loopReleaseMode))
      S.loopReleaseMode = d.loopReleaseMode;
    if (typeof d.loopFadeTimeMs === 'number') S.loopFadeTimeMs = Math.max(0, Math.min(2000, d.loopFadeTimeMs));
    // Per-field so a defaults file written before a field existed still loads,
    // and a hand-edited one can't put a string where the gate expects a number.
    const t = d.triggerParams;
    if (t && typeof t === 'object') {
      const td = S.triggerParams;
      if (typeof t.hysteresis === 'number') td.hysteresis = Math.max(1, Math.min(3, t.hysteresis));
      if (typeof t.rearmMs    === 'number') td.rearmMs    = Math.max(0, Math.min(5000, t.rearmMs));
      if (typeof t.volume     === 'number') td.volume     = Math.max(0, Math.min(1, t.volume));
      if (typeof t.speed      === 'number') td.speed      = Math.max(0.25, Math.min(4, t.speed));
      if (['oneshot', 'loop', 'grain'].includes(t.dwell)) td.dwell  = t.dwell;
      if (['top', 'touch', 'ends'].includes(t.start))    td.start   = t.start;
      if (['cut', 'layer'].includes(t.retrig))           td.retrig  = t.retrig;
      if (typeof t.chop === 'number')       td.chop = Math.max(0, Math.min(2000, t.chop));
      if (typeof t.chopOn === 'boolean')    td.chopOn = t.chopOn;
      if (['play-to-end', 'fade'].includes(t.release))   td.release = t.release;
    }
  } catch (e) {
    console.warn('[defaults] could not load seed settings:', e);
  }
}

// ── mubone_viz_calibration ──────────────────────────────────────────────────
function _loadVizCalibration() {
  try {
    const raw = localStorage.getItem(LS_VIZ_CAL);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (typeof d.vizMinSize     === 'number') S.vizMinSize     = d.vizMinSize;
    if (typeof d.vizMaxSize     === 'number') S.vizMaxSize     = d.vizMaxSize;
    if (typeof d.vizRmsMin      === 'number') S.vizRmsMin      = d.vizRmsMin;
    if (typeof d.vizRmsMax      === 'number') S.vizRmsMax      = d.vizRmsMax;
    if (typeof d.vizCentroidMin === 'number') S.vizCentroidMin = d.vizCentroidMin;
    if (typeof d.vizCentroidMax === 'number') S.vizCentroidMax = d.vizCentroidMax;
    if (typeof d.radiusFadeEnabled === 'boolean') S.radiusFadeEnabled = d.radiusFadeEnabled;
    if (typeof d.radiusFadeCurve   === 'number')  S.radiusFadeCurve   = d.radiusFadeCurve;
    // One-shot rename migration (2026-08-24): 'pull' was the mouse-offset
    // ROTATION mode, and the word now belongs to camera distance. Anything
    // saved or exported before the rename says 'pull' and means 'steer'.
    const mode = d.cameraMode === 'pull' ? 'steer' : d.cameraMode;
    if (typeof mode === 'string' && ['steer', 'surface', 'sensor'].includes(mode))
      S.cameraMode = mode;
    // camPull deliberately NOT restored (2026-08-28): the outside view is
    // retired — one centred, azimuthal-equidistant view. Old calibrations
    // carrying a pull (this is how every rig booted at 1.2 without anyone
    // setting it) boot at 0 like everyone else. S.camPull is console-only.
    // Clamped rather than validated against the panel's three presets: the
    // console is a first-class way to set this (S.gazeTrailSec = 12), and a
    // value that round-trips through export should come back as it went out.
    if (typeof d.gazeTrailSec === 'number' && d.gazeTrailSec >= 0)
      S.gazeTrailSec = Math.min(d.gazeTrailSec, 60);
  } catch (e) {
    console.warn('[defaults] could not load viz calibration:', e);
  }
}

// ── Startup device activation (called from main.js after hardware is opened) ──
// Wires the Web Audio graph for saved devices that were auto-opened at startup.
// This must run AFTER initAudioSettings() so the DOM elements exist.

/** The output main.js opened at startup — resolved by name, the system
 *  default as fallback — so the dropdown shows the device that is streaming. */
export function noteActiveOutputDevice(dev) {
  if (!dev) return;
  _outputDeviceId   = dev.id;
  _outputDeviceName = dev.name ?? _outputDeviceName;
}

export async function activateSavedInputDevice(nCh, dev = null) {
  // Wire up the full RtAudio input metering + recording chain.
  // This is the same work applyInputDevice() does after setInputDevice(),
  // but without needing the DOM dropdown to be populated first.
  // `dev` is the device main.js actually opened — resolved by NAME, and the
  // system default when nothing was saved or the saved one is gone. Until
  // 2026-09-10 nothing recorded it here, so the dropdown kept selecting the
  // saved id (stale after the device list shifted) or nothing at all after a
  // reset, and read "select input device" over a live MacBook mic (Ek).
  if (dev) { _inputDeviceId = dev.id; _inputDeviceName = dev.name ?? _inputDeviceName; }
  _inputNumCh = nCh;
  await setupRtAudioInputMeters(nCh);
  repopulateChannelSelect(nCh);

  // Restore saved main input channel
  const selCh = S.mainInputChannel ?? 0;
  const chSel = document.getElementById('asInputChannel');
  if (chSel) chSel.value = String(selCh);
  // repopulateChannelSelect above already mirrored the panel — but it mirrored
  // the default ch 1, and the line above then moves the modal past it without
  // an event. Re-sync or the panel boots showing the wrong channel.
  S._syncAudioPanelChannels?.();
  const mainSel = document.getElementById('asMainInputSel');
  if (mainSel) mainSel.value = String(selCh);
  rewireRtAudioRecordingChannel(selCh, nCh);

  // Render meters + mapping table (may be invisible until modal opens, but DOM ready)
  renderInputMeters(selCh);
  renderInputMappingTable();

  // Mark as.started so modal-open knows input is already live
  as.started = true;

  // Pre-load the recording-capture worklet so painting works immediately.
  // In browser this happens in requestMicAccess → warmUpAudioEngine;
  // in Electron with RtAudio we need to do it here.
  if (!S.audioEngineWarmedUp) {
    S.audioEngineWarmedUp = true;
    warmUpAudioEngine();
  }

  // Update mic button to reflect that RtAudio input is active.
  // In Electron, requestMicAccess is skipped (getUserMedia always fails),
  // so the button would otherwise stay in its default/denied state.
  const micBtn = document.getElementById('micEnableBtn');
  if (micBtn) {
    setMicBtnLabel('mic ready');
    micBtn.classList.remove('mic-denied');
    micBtn.classList.add('mic-ready');
    micBtn.disabled = false;
  }

  DEBUG && console.log(`[startup] input device activated — ${nCh} ch, recording ch ${selCh + 1}`);
}

// ── Init ──────────────────────────────────────────────────────────────────────
export function initAudioSettings() {
  // Hydrate custom speaker angles from localStorage before anything uses them
  loadCustomSpeakerAngles();

  // Restore saved buffer size so the first device open uses the right value.
  // Electron default is 128 (lowest latency); browser default is 1024 (safe).
  const savedGrains = parseInt(localStorage.getItem('mubone_max_grains'));
  if ([256, 512, 1024].includes(savedGrains)) S.maxGrains = savedGrains;
  const grainsSel = document.getElementById('asMaxGrains');
  if (grainsSel) {
    grainsSel.value = String(S.maxGrains ?? 512);
    grainsSel.addEventListener('change', e => {
      const n = parseInt(e.target.value);
      if (![256, 512, 1024].includes(n)) return;
      localStorage.setItem('mubone_max_grains', String(n));
      S._setMaxGrains?.(n);
      updateMaxGrainsLive();
    });
  }
  const savedCushion = parseInt(localStorage.getItem('mubone_audio_cushion'));
  if ([5, 10, 20, 30, 50].includes(savedCushion)) S.audioCushionMs = savedCushion;
  const cushionSel = document.getElementById('asCushion');
  if (cushionSel) cushionSel.value = String(S.audioCushionMs);
  const savedBuf = parseInt(localStorage.getItem('mubone_bufferSize'));
  if (savedBuf && [64, 128, 256, 512, 1024].includes(savedBuf)) {
    S.preferredBufferSize = savedBuf;
  } else if (window.electronBridge?.isElectron) {
    S.preferredBufferSize = 128;
  }

  // Modal open/close
  const modal     = document.getElementById('audioSettingsModal');
  const openBtn   = document.getElementById('audioSettingsBtn');
  const closeBtn  = document.getElementById('audioSettingsClose');
  if (modal && openBtn) {
    openBtn.addEventListener('click',  () => {
      modal.classList.add('open');
      populateInputDevices();   // refresh input device list each time modal opens
      populateOutputDevices();  // refresh output device list each time modal opens

      // Sync output gain slider to live masterBus value
      if (S.masterBus) {
        const liveLin = S.masterBus.gain.value;
        const liveDb  = 20 * Math.log10(Math.max(liveLin, 0.00001));
        as.outputGain = liveDb;
        const ogSlider = document.getElementById('asOutputGain');
        const ogVal    = document.getElementById('asOutputGainVal');
        if (ogSlider) ogSlider.value = String(liveDb.toFixed(1));
        if (ogVal)    ogVal.textContent = formatDb(Math.round(liveDb * 2) / 2);
      }

      // Sync input gain slider to the saved gain for the currently selected channel
      {
        const ch = document.getElementById('asInputChannel')?.value ?? '0';
        const savedGain = as.inputGains[ch] ?? 0;
        const igSlider = document.getElementById('asInputGain');
        const igVal    = document.getElementById('asInputGainVal');
        if (igSlider) igSlider.value = String(savedGain);
        if (igVal)    igVal.textContent = formatDb(savedGain);
      }

      // Sync paint gate slider to S.paintGateThreshold (may have been restored from saved defaults)
      {
        const gs = document.getElementById('asPaintGateSlider');
        if (gs) gs.value = S.paintGateThreshold;
      }

      // Browser mode: speaker buses never come up (initSpeakerBuses is an
      // Electron no-op), so the branch below never ran and the house-speaker
      // and mixdown rows stayed invisible — the multichannel story just wasn't
      // in the UI at all. Show them, disabled, with the reason: an absent
      // control reads as "this app is stereo", a greyed one reads as "this is
      // the desktop feature". syncHouseSpeakersSeg already writes the disabled
      // state + explanatory note for browser mode; it just needed calling.
      if (!window.electronBridge?.isElectron) {
        const houseRow = document.getElementById('asHouseSpeakersRow');
        if (houseRow) houseRow.style.display = '';
        syncHouseSpeakersSeg();
      }

      // If speaker buses are already running (startup auto-select), show meters + routing
      if (S.speakerAnalysers?.length) {
        renderOutputMeters();
        renderRoutingTable();
        const houseRow = document.getElementById('asHouseSpeakersRow');
        if (houseRow) houseRow.style.display = '';
        // Sync house-speakers seg to S.numHouseSpeakers
        syncHouseSpeakersSeg();
        // Show active status
        const nOut = S.speakerBuses?.length ?? S.speakerAnalysers.length;
        setStatus('asOutputStatus', 'ok', `${nOut}-ch output active`);
      }
      // If input is already running, render its meters + mapping table and show active status.
      if (as.inputAnalysers.length > 0) {
        renderInputMeters();
        renderInputMappingTable();
        if (as.started && _inputDeviceId != null) {
          const nCh = as.inputAnalysers.length;
          const chDesc = S.mainInputChannel === 'stereo' ? 'stereo (L+R)' : `ch ${(S.mainInputChannel ?? 0) + 1}`;
          setStatus('asInputStatus', 'ok', `${nCh} ch input active — recording ${chDesc}`);
        }
      } else if (as.started && S.inputAnalyser) {
        // Browser path: mic granted via top-bar button — S.inputAnalyser exists
        // but as.inputAnalysers (multi-channel meter array) wasn't built.
        // Show a 1-ch meter and active status.
        renderSetMeters('asInputMeters', ['1']);
        setStatus('asInputStatus', 'ok', 'input active');
      } else {
        renderSetMeters('asInputMeters', ['1']);
      }

      // Sync rate selector to live AudioContext rate (or saved rate)
      const rateSel = document.getElementById('asSampleRate');
      if (rateSel) {
        if (S.audioCtx) rateSel.value = String(S.audioCtx.sampleRate);
        else if (S.savedSampleRate) rateSel.value = String(S.savedSampleRate);
      }
      // Sync buffer size selector to saved preference or lock to 128 in browser mode.
      // Web Audio uses a fixed 128-sample render quantum — the buffer size dropdown
      // only controls the native RtAudio/audify output buffer in Electron.
      const bufSel = document.getElementById('asBufferSize');
      if (bufSel) {
        if (window.electronBridge?.isElectron) {
          bufSel.disabled = false;
          bufSel.style.opacity = '';
          bufSel.style.cursor  = '';
          if (S.preferredBufferSize) bufSel.value = String(S.preferredBufferSize);
        } else {
          // Locked to the Web Audio render quantum. It was already `disabled`
          // but looked identical to an enabled select, so it read as a setting
          // that silently ignores you. Dim it so the state is legible; the
          // explanation is the tooltip already on the element in index.html.
          // NB: tooltips live in `data-title` — ui-learn.js runs a
          // MutationObserver that moves every `title` there and strips the
          // attribute, so read/write data-title, not title.
          bufSel.value    = '128';
          bufSel.disabled = true;
          bufSel.style.opacity = '0.35';
          bufSel.style.cursor  = 'not-allowed';
        }
      }
      updateLatency();

      // If mic was already enabled from the top-bar button, mark as started
      // so the modal reflects the active state rather than looking idle.
      if (S.micPermissionGranted && S.inputStream && !as.started) {
        as.started = true;
      }

      // Start metering loop whenever modal is open
      startMetering();
    });
    closeBtn.addEventListener('click', () => {
      modal.classList.remove('open');
      stopMetering();
    });
    modal.addEventListener('click', e => {
      if (e.target === modal) { modal.classList.remove('open'); stopMetering(); }
    });
  }

  // Device selects activate immediately on change — no Apply buttons needed
  document.getElementById('asInputDevice')?.addEventListener('change',  applyInputDevice);
  document.getElementById('asOutputDevice')?.addEventListener('change', applyOutputDevice);
  // Engine settings apply on change — DAW convention
  document.getElementById('asSampleRate')?.addEventListener('change',  applySampleRate);
  document.getElementById('asBufferSize')?.addEventListener('change', applyBufferSize);
  document.getElementById('asBufferRestart')?.addEventListener('click', () => {
    if (window.electronBridge?.restartApp) window.electronBridge.restartApp();
  });

  // Recording limit slider
  const recLimitSlider = document.getElementById('asRecLimit');
  const recLimitVal    = document.getElementById('asRecLimitVal');
  if (recLimitSlider) {
    recLimitSlider.value = String(S.recLimitSeconds);
    if (recLimitVal) recLimitVal.textContent = `${Math.round(S.recLimitSeconds / 60)} min`;
    recLimitSlider.addEventListener('input', e => {
      const sec = parseInt(e.target.value, 10);
      S.recLimitSeconds = sec;
      if (recLimitVal) recLimitVal.textContent = `${Math.round(sec / 60)} min`;
      S.updateLiveRecUI?.(); // refresh HUD warning state
    });
  }

  // Input gain — browser only (in Electron, trim at the interface hardware).
  // Writes to S.inputGainNode which sits between the mic source and S.inputAnalyser
  // (the recording path), so this actually affects what gets recorded.
  const inputGainRow = document.getElementById('asInputGain')?.closest('.set-row');
  if (window.electronBridge?.isElectron && inputGainRow) {
    inputGainRow.style.display = 'none';
  }
  document.getElementById('asInputGain')?.addEventListener('input', e => {
    const db  = parseFloat(e.target.value);
    const ch  = document.getElementById('asInputChannel')?.value ?? '0';
    as.inputGains[ch] = db;  // remember gain for this channel
    const lbl = document.getElementById('asInputGainVal');
    if (lbl) lbl.textContent = formatDb(db);
    // Write to S.inputGainNode — actual recording input gain
    if (S.inputGainNode) S.inputGainNode.gain.value = dbToLinear(db);
    // Also update the meter gain node(s) so bars respond live while dragging
    const lin = dbToLinear(db);
    if (ch === 'stereo') {
      // Stereo mode sums L+R — update both channel meter gain nodes
      if (as._meterGainNodes[0]) as._meterGainNodes[0].gain.value = lin;
      if (as._meterGainNodes[1]) as._meterGainNodes[1].gain.value = lin;
    } else {
      const idx = parseInt(ch, 10) || 0;
      if (as._meterGainNodes[idx]) as._meterGainNodes[idx].gain.value = lin;
    }
  });

  // ── Paint gate slider ──────────────────────────────────────────────────────
  const gateSlider = document.getElementById('asPaintGateSlider');
  if (gateSlider) {
    gateSlider.value = S.paintGateThreshold;
    gateSlider.addEventListener('input', () => {
      S.paintGateThreshold = parseFloat(gateSlider.value);
    });
  }

  // ── Handsfree gate tuning controls ────────────────────────────────────────
  // Arm toggle is in the main UI cursor panel — only tuning sliders here.
  {
    // Hold slider
    const holdSlider = document.getElementById('hfHoldSlider');
    const holdVal    = document.getElementById('hfHoldVal');
    if (holdSlider) {
      holdSlider.value = S.hfHoldMs;
      if (holdVal) holdVal.textContent = S.hfHoldMs + ' ms';
      holdSlider.addEventListener('input', () => {
        S.hfHoldMs = parseInt(holdSlider.value);
        if (holdVal) holdVal.textContent = S.hfHoldMs + ' ms';
      });
    }

    // Release slider
    const relSlider = document.getElementById('hfReleaseSlider');
    const relVal    = document.getElementById('hfReleaseVal');
    if (relSlider) {
      relSlider.value = S.hfReleaseMs;
      if (relVal) relVal.textContent = S.hfReleaseMs + ' ms';
      relSlider.addEventListener('input', () => {
        S.hfReleaseMs = parseInt(relSlider.value);
        if (relVal) relVal.textContent = S.hfReleaseMs + ' ms';
      });
    }

    // Margin slider (dB above output RMS)
    const marginSlider = document.getElementById('hfMarginSlider');
    const marginVal    = document.getElementById('hfMarginVal');
    if (marginSlider) {
      const _fmtMargin = v => v === 0 ? 'off' : '+' + v + ' dB';
      marginSlider.value = S.hfMarginDb;
      if (marginVal) marginVal.textContent = _fmtMargin(S.hfMarginDb);
      marginSlider.addEventListener('input', () => {
        S.hfMarginDb = parseInt(marginSlider.value);
        if (marginVal) marginVal.textContent = _fmtMargin(S.hfMarginDb);
      });
    }

    // HPF toggle + freq slider
    const hpfSeg = document.getElementById('hfHpfSeg');
    if (hpfSeg) {
      const syncHpf = () => hpfSeg.querySelectorAll('.grain-seg-btn').forEach(b =>
        b.classList.toggle('active', (b.dataset.hpf === 'on') === S.hfHpfEnabled));
      syncHpf();
      hpfSeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          S.hfHpfEnabled = btn.dataset.hpf === 'on';
          syncHpf();
        });
      });
    }
    const hpfSlider = document.getElementById('hfHpfSlider');
    const hpfVal    = document.getElementById('hfHpfVal');
    if (hpfSlider) {
      hpfSlider.value = S.hfHpfFreq;
      if (hpfVal) hpfVal.textContent = S.hfHpfFreq + ' Hz';
      hpfSlider.addEventListener('input', () => {
        S.hfHpfFreq = parseInt(hpfSlider.value);
        if (hpfVal) hpfVal.textContent = S.hfHpfFreq + ' Hz';
        updateHPFFreq();
      });
    }

    // Min buffer slider
    const minSlider = document.getElementById('hfMinBufSlider');
    const minVal    = document.getElementById('hfMinBufVal');
    if (minSlider) {
      minSlider.value = S.hfMinBufferMs;
      if (minVal) minVal.textContent = S.hfMinBufferMs + ' ms';
      minSlider.addEventListener('input', () => {
        S.hfMinBufferMs = parseInt(minSlider.value);
        if (minVal) minVal.textContent = S.hfMinBufferMs + ' ms';
      });
    }

    // Max buffer slider
    const maxSlider = document.getElementById('hfMaxBufSlider');
    const maxVal    = document.getElementById('hfMaxBufVal');
    if (maxSlider) {
      maxSlider.value = S.hfMaxBufferSec;
      if (maxVal) maxVal.textContent = S.hfMaxBufferSec + ' s';
      maxSlider.addEventListener('input', () => {
        S.hfMaxBufferSec = parseInt(maxSlider.value);
        if (maxVal) maxVal.textContent = S.hfMaxBufferSec + ' s';
      });
    }

    // Feedback detection toggle
    const fbSeg = document.getElementById('hfFeedbackSeg');
    if (fbSeg) {
      const syncFb = () => fbSeg.querySelectorAll('.grain-seg-btn').forEach(b =>
        b.classList.toggle('active', (b.dataset.fb === 'on') === S.hfFeedbackDetect));
      syncFb();
      fbSeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          S.hfFeedbackDetect = btn.dataset.fb === 'on';
          syncFb();
        });
      });
    }

    // The arm control (#290). It used to be a button in the rig view's cursor
    // device — the one place nobody could reach once the rig stopped being a
    // screen — so it lives here now, beside the gate it arms. Arming is a
    // boolean that STAYS, so it is a two-state pill that says which state it
    // is in rather than a button whose meaning you have to remember (#267).
    const hfArmSeg = document.getElementById('hfArmSeg');
    if (hfArmSeg) {
      hfArmSeg.addEventListener('click', e => {
        const btn = e.target.closest('[data-hfarm]');
        if (!btn) return;
        const want = btn.dataset.hfarm === 'on';
        if (want === !!S.hfArmed) return;          // picking the live segment does nothing
        // Only plain trace mode can be armed; disarming is always allowed.
        if (want && S.traceMode !== 'trace') return;
        if (want) armHandsfree(); else disarmHandsfree();
      });
    }

    // The tuning rows are a disclosure, not a collapsible (#293): the same
    // eight rows, revealed in place under the row that asks for them. No
    // triangle and no second kind of chrome — a settings page has one row
    // model, and a group that opens is still made of rows.
    const hfTuneBtn = document.getElementById('hfTuneBtn');
    const hfTune    = document.getElementById('hfTune');
    if (hfTuneBtn && hfTune) {
      hfTuneBtn.addEventListener('click', () => {
        const open = hfTune.hidden;
        hfTune.hidden = !open;
        hfTuneBtn.setAttribute('aria-expanded', String(open));
        hfTuneBtn.textContent = open ? 'Done' : 'Tune…';
      });
    }

    // Sync callback — updates capture count, main UI button, and HUD label
    S._syncHandsfreeUI = () => {
      const countEl = document.getElementById('hfCaptureCount');
      if (countEl) countEl.textContent = S.hfCaptureCount + (S.hfCaptureCount === 1 ? ' buffer' : ' buffers');
      // Sync the arm pill. `hf-recording` stays a class rather than a third
      // segment: recording is something the gate is DOING, not a state you can
      // pick, and a capsule means pick-one-of-N (#267).
      const armSeg = document.getElementById('hfArmSeg');
      if (armSeg) {
        armSeg.classList.toggle('hf-recording', !!S.hfRecording);
        armSeg.classList.toggle('hf-unavailable', S.traceMode !== 'trace');
        const want = S.hfArmed ? 'on' : 'off';
        armSeg.querySelectorAll('[data-hfarm]').forEach(b =>
          b.classList.toggle('active', b.dataset.hfarm === want));
      }
      // Sync trace indicator — show active state when toggled on
      const traceBtn = document.getElementById('paintIndicatorBtn');
      if (traceBtn) {
        traceBtn.classList.toggle('painting', S.paintLatched);
        traceBtn.classList.toggle('trace-toggled', S.paintLatched);
      }
      // HUD label — show "handsfree" next to coordinates when armed
      const hudLabel = document.getElementById('hfHudLabel');
      if (hudLabel) {
        hudLabel.style.display = S.hfArmed ? '' : 'none';
      }
    };
  }

  // Output gain — writes to S.masterBus (master chain) and headphone downmix node
  document.getElementById('asOutputGain')?.addEventListener('input', e => {
    as.outputGain = parseFloat(e.target.value);
    const lbl = document.getElementById('asOutputGainVal');
    if (lbl) lbl.textContent = formatDb(as.outputGain);
    const lin = dbToLinear(as.outputGain);
    // Browser stereo path: masterBus is in the signal chain
    if (S.masterBus) S.masterBus.gain.value = lin;
    // Electron multi-ch path: grains connect directly to speaker buses → merger →
    // audify.  masterBus is not in that chain, so scale each bus to match.
    // Mute state is handled separately (bus gain zeroed), so only apply when unmuted.
    if (S.speakerBuses && !S.isMuted) {
      const t = S.audioCtx?.currentTime ?? 0;
      S.speakerBuses.forEach(({ bus }) => bus.gain.setTargetAtTime(lin, t, 0.02));
    }
    // Headphone downmix node (Electron: dead-end tap; browser: actual output)
    if (window._headphoneOutNode) {
      window._headphoneOutNode.gain.value = lin * 0.7;
    }
    S.outputGainValue = lin;
  });

  // Channel change — always live, no stream restart needed
  document.getElementById('asInputChannel')?.addEventListener('change', e => {
    const val = e.target.value;
    const lbl = val === 'stereo' ? 'stereo (L+R)' : `ch ${parseInt(val) + 1}`;

    const isStereo = val === 'stereo';
    const chIndex  = isStereo ? 0 : (parseInt(val, 10) || 0);

    // Keep S.mainInputChannel in sync so main UI meters and mapping table
    // reflect the user's actual selection (was missing — caused stale highlight)
    S.mainInputChannel = isStereo ? 'stereo' : chIndex;

    // Restore the remembered gain for this channel and update the slider + gain node
    const savedGain = as.inputGains[val] ?? 0;
    const gainSlider = document.getElementById('asInputGain');
    const gainLbl    = document.getElementById('asInputGainVal');
    if (gainSlider) gainSlider.value = String(savedGain);
    if (gainLbl)    gainLbl.textContent = formatDb(savedGain);
    if (S.inputGainNode) S.inputGainNode.gain.value = dbToLinear(savedGain);

    // Both assignments above fire no `input` event, so the main-UI audio panel's
    // mirror listener never runs — push channel + gain into it explicitly.
    S._syncAudioPanelChannels?.();
    S._syncAudioPanelLevels?.();

    // The input-mapping table's own dropdown is a second view of this value;
    // keep it honest when the change came from anywhere else (panel, restore).
    const mainSel = document.getElementById('asMainInputSel');
    if (mainSel && mainSel.value !== val) mainSel.value = val;

    const highlight = isStereo ? [0, 1] : chIndex;

    if (window.electronBridge?.isElectron) {
      // Electron: RtAudio path — rewire splitter output into recording chain.
      // Pass 'stereo' through rather than chIndex — the rewire sums L+R for it,
      // and collapsing to 0 here recorded ch 1 only.
      rewireRtAudioRecordingChannel(isStereo ? 'stereo' : chIndex, as.inputAnalysers.length);
      renderInputMeters(highlight);
      setStatus('asInputStatus', 'ok', `${lbl} → granular engine`);
    } else if (S.inputStream) {
      // Browser: getUserMedia path — retap the chosen channel from splitter
      // buildInputGraph also applies the channel gain, so call it after setting
      // inputGainNode.gain above (it will overwrite with the same value, fine)
      buildInputGraph(val);
      renderInputMeters(highlight);
      setStatus('asInputStatus', 'ok', `${lbl} — ${S.audioCtx?.sampleRate} Hz`);
    }
  });

  // ── House speaker count dropdown (Electron only) ──────────────────────────
  // Changes S.numHouseSpeakers and rebuilds speaker buses with the new count.
  document.getElementById('asHouseSpeakersSel')?.addEventListener('change', async function() {
    const n = parseInt(this.value, 10);
    if (isNaN(n)) return;
    S.numHouseSpeakers = n;
    // Clear custom angles — they were for a different speaker count
    S.customSpeakerAngles = null;
    saveCustomSpeakerAngles();
    syncHouseSpeakersSeg();
    if (window.electronBridge?.isElectron && S.speakerBuses) {
      const totalCh = S.speakerBuses.numChannels;
      if (totalCh) {
        S.channelRouting   = null;
        S.headphoneRouting = null;
        await initSpeakerBuses(totalCh);
        renderOutputMeters();
        renderRoutingTable();
      }
    }
  });

  // ── Stereo Mixdown Bus checkbox (Electron only) ───────────────────────────
  // Enables/disables the dedicated stereo mixdown bus pair (for cursor grains).
  // When enabled, the last 2 physical output channels are reserved and
  // S.numHouseSpeakers is automatically clamped to the nearest valid value
  // that fits within the remaining channels (e.g. 6-ch → 4 house + 2 mixdown).
  document.getElementById('asStereoMixdownChk')?.addEventListener('change', async function() {
    S.stereoMixdownEnabled = this.checked;
    const totalCh = S.speakerBuses?.numChannels ?? 0;
    if (this.checked && totalCh >= 2) {
      // Clamp numHouseSpeakers to the largest valid dropdown option that fits
      const maxHouse   = totalCh - 2;
      const dropOpts   = [2, 4, 6, 8, 16].filter(v => v <= maxHouse);
      const bestFit    = dropOpts.length ? Math.max(...dropOpts) : 2;
      if (S.numHouseSpeakers > maxHouse) {
        S.numHouseSpeakers = bestFit;
      }
    }
    syncHouseSpeakersSeg();  // updates dropdown, checkbox note
    if (window.electronBridge?.isElectron && S.speakerBuses && totalCh) {
      S.channelRouting   = null;
      S.headphoneRouting = null;
      await initSpeakerBuses(totalCh);
      renderOutputMeters();
      renderRoutingTable();
    }
  });

  // Latency — auto-updates once AudioContext is live; also call on output device apply
  updateLatency();

  // Buttons
  document.getElementById('asTestBtn')?.addEventListener('click', handleTestTone);
  document.getElementById('asLatencyMeasure')?.addEventListener('click', handleMeasureLatency);
  document.getElementById('asCushion')?.addEventListener('change', e => setAudioCushion(parseInt(e.target.value)));
  setInterval(() => { updateCushionLive(); updateMaxGrainsLive(); }, 1000);
  document.getElementById('asLatencyForget')?.addEventListener('click', () => S._clearLatencyCal?.());

  // ── Browser mic grant sync ───────────────────────────────────────────────
  // When requestMicAccess() succeeds (browser getUserMedia), it calls this
  // callback so the audio settings module knows which device is active.
  // This makes the dropdown, meters, and internal state reflect reality
  // without the user having to open audio settings and manually pick a device.
  S._onBrowserMicGranted = (deviceId, numCh) => {
    _inputDeviceId   = deviceId;
    _inputDeviceName = _selectedLabel('asInputDevice');
    _inputNumCh      = numCh;
    as.started       = true;

    // Build the per-channel analyser array so meters work immediately.
    // requestMicAccess creates S.inputAnalyser (singular) but the meter
    // animation loop reads from as.inputAnalysers[] (per-channel array).
    const ch = document.getElementById('asInputChannel')?.value || '0';
    buildInputGraph(ch);
    repopulateChannelSelect(numCh);

    // If the modal is currently open, sync the dropdown to show the active device
    const devSel = document.getElementById('asInputDevice');
    if (devSel) {
      const match = Array.from(devSel.options).find(o => o.value === deviceId);
      if (match) devSel.value = deviceId;
    }
  };

  // ── S callback for MIDI / OSC access to master output gain ──────────────
  // Accepts dB value (-60 to +18), syncs the slider, label, and audio nodes.
  // Upper bound is +18, not the +6 this shipped with: the Electron path never
  // passes through the soft clipper (browser-only, see js/audio.js), so it has
  // no makeup gain at all and unity is as loud as it gets. Keep in step with
  // the max on asOutputGain / apMasterGainSlider and the master_vol ccFn.
  S._setOutputGainDb = (db) => {
    db = Math.max(-60, Math.min(18, db));
    as.outputGain = db;
    const ogSlider = document.getElementById('asOutputGain');
    const ogVal    = document.getElementById('asOutputGainVal');
    if (ogSlider) ogSlider.value = db;
    if (ogVal)    ogVal.textContent = formatDb(db);
    const lin = dbToLinear(db);
    if (S.masterBus) S.masterBus.gain.value = lin;
    if (S.speakerBuses && !S.isMuted) {
      const t = S.audioCtx?.currentTime ?? 0;
      S.speakerBuses.forEach(({ bus }) => bus.gain.setTargetAtTime(lin, t, 0.02));
    }
    if (window._headphoneOutNode) window._headphoneOutNode.gain.value = lin * 0.7;
    S.outputGainValue = lin;
    // Assigning ogSlider.value fires no `input` event, so the main-UI audio
    // panel's mirror listener never runs — push it explicitly.
    S._syncAudioPanelLevels?.();
  };

  // Re-render routing table when spatial mode changes so capture buttons
  // enable/disable based on headlocked vs worldlocked.
  // Direct listener on dropdown covers UI changes; wrapping S._setSpatialPanning
  // covers MIDI/OSC toggles that bypass the dropdown.
  document.getElementById('asSpatialPanningSel')?.addEventListener('change', () => {
    setTimeout(renderRoutingTable, 0);
  });
  setTimeout(() => {
    const orig = S._setSpatialPanning;
    if (orig) {
      S._setSpatialPanning = (mode) => {
        orig(mode);
        renderRoutingTable();
      };
    }
  }, 0);

}

// Sync the house-speakers dropdown + stereo mixdown checkbox to S state.
function syncHouseSpeakersSeg() {
  const n    = S.numHouseSpeakers ?? 2;
  const note = document.getElementById('asHouseSpeakersNote');
  const sel  = document.getElementById('asHouseSpeakersSel');
  const isBrowser = !window.electronBridge?.isElectron;
  if (sel) {
    sel.value = isBrowser ? '2' : String(n);
    sel.disabled = isBrowser;
    // Tooltips live in `data-title`: ui-learn.js moves every `title` there and
    // strips the attribute, so writing `.title` here would be swallowed.
    if (isBrowser) {
      sel.setAttribute('data-title',
        'multichannel output (4+) requires the desktop app — browser is limited to stereo');
    } else {
      sel.removeAttribute('data-title');
    }
    // `disabled` alone barely reads on a dark-themed select — dim it so the
    // row is legibly "unavailable here" rather than "broken".
    sel.style.opacity = isBrowser ? '0.35' : '';
    sel.style.cursor  = isBrowser ? 'not-allowed' : '';
  }
  if (isBrowser) S.numHouseSpeakers = 2;
  if (note) {
    const names = { 2: 'stereo field', 4: 'quad', 6: 'hexaphonic', 8: 'octaphonic', 16: '16-speaker field' };
    note.textContent = isBrowser
      ? 'stereo — use desktop app for multichannel'
      : (names[n] ?? `${n}-speaker field`);
  }
  // Also sync the mixdown checkbox + note
  const chk      = document.getElementById('asStereoMixdownChk');
  const mxNote   = document.getElementById('asStereoMixdownNote');
  const mxRow    = document.getElementById('asStereoMixdownRow');
  const totalCh  = S.speakerBuses?.numChannels ?? 0;
  const canMix   = totalCh >= 4;  // need at least 4 outputs (2 house + 2 mixdown)
  if (mxRow) mxRow.style.display = '';
  if (!canMix && S.stereoMixdownEnabled === true) {
    S.stereoMixdownEnabled = false;  // force off when hardware can't support it
  }
  if (chk) {
    chk.checked  = canMix && S.stereoMixdownEnabled === true;
    chk.disabled = !canMix;
    chk.style.opacity = canMix ? '' : '0.35';
    chk.style.cursor  = canMix ? '' : 'not-allowed';
  }
  // Grey out the label too when unavailable
  const mxLabel = document.querySelector('label[for="asStereoMixdownChk"]');
  if (mxLabel) mxLabel.style.opacity = canMix ? '' : '0.35';
  if (mxNote) {
    mxNote.textContent = isBrowser
      ? 'desktop app only — needs 4+ hardware outputs'
      : !canMix
      ? 'requires 4 or more output channels'
      : S.stereoMixdownEnabled
        ? 'on — last 2 outputs reserved for stereo mixdown'
        : 'off — all channels are house';
  }
}
