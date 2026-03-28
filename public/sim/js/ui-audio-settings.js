// ============================================================================
// UI — AUDIO SETTINGS MODAL
// Channel selection, input gain, VU metering, output gain, latency display.
// No device dropdowns — browser follows macOS system default.
// No monitoring — graph ends at analyser (dead end), MOTU handles monitoring.
// ============================================================================

import { S, DEBUG, FACTORY_PRESET_START } from './state.js';
import { initSpeakerBuses, recreateAudioContext, rewireChannelMerger, rewireMonitorChannels, ensureAudioContext, setMicBtnLabel, getMasterBus, playSweepChannel, warmUpAudioEngine } from './audio.js';
import { renderMeters, tickMeters, rebuildMainOutputMeters } from './ui-meters.js';

// ── RtAudio input meter worklet (Electron only) ───────────────────────────────
// In Electron, getUserMedia is capped at 2ch by the browser. Instead, we open an
// RtAudio input stream from the main process which sends raw interleaved Float32
// PCM to the renderer via IPC. This worklet receives those chunks and feeds N
// AnalyserNodes so the meter strip shows all channels.

let _inputWorkletNode = null;   // AudioWorkletNode driving input analysers
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

async function setupRtAudioInputMeters(nCh) {
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

  // Create worklet node with N output channels
  _inputWorkletNode = new AudioWorkletNode(actx, 'input-meter', {
    numberOfInputs:  0,
    numberOfOutputs: 1,
    outputChannelCount: [nCh],
  });
  _inputWorkletNode.port.postMessage({ type: 'init', numChannels: nCh });

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

  // Wire selected channel into the recording path (S.inputGainNode → S.inputAnalyser)
  // so spacebar records from whatever channel the dropdown shows.
  rewireRtAudioRecordingChannel(safeSel, nCh);

  // Hook up the IPC push — Electron main sends chunks via 'audio-input-buffer'
  // Guard with a flag — listeners accumulate on the ipcRenderer channel.
  if (window.electronBridge?.onAudioInputBuffer) {
    if (!window._rtAudioInputListening) {
      window._rtAudioInputListening = true;
      window.electronBridge.onAudioInputBuffer((f32, numCh) => {
        if (_inputWorkletNode) {
          _inputWorkletNode.port.postMessage({ type: 'pcm', interleaved: f32 }, [f32.buffer]);
        }
      });
    }
  }
}

// Switch which RtAudio channel feeds S.inputGainNode (recording path).
// Uses per-channel routing GainNodes (0/1) instead of disconnect() to avoid
// the unreliable 3-arg disconnect(node, output, input) form.
function rewireRtAudioRecordingChannel(chIndex, nCh) {
  if (!_rtInputSplitter) return;
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

  // Flip routing gains: 1 for the chosen channel, 0 for all others.
  // The graph (splitter[i] → routingGain[i] → S.inputGainNode) was wired in
  // setupRtAudioInputMeters; we just change the gain values here.
  const n = _rtInputRoutingGains.length || (nCh ?? as.inputAnalysers.length);
  const safe = Math.max(0, Math.min(chIndex, n - 1));
  _rtInputRoutingGains.forEach((g, i) => { g.gain.value = (i === safe) ? 1 : 0; });
  DEBUG && console.log(`[input] recording from RtAudio ch ${safe + 1} (index ${safe})`);
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
  outputGain:    -6,
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
  as.splitterNode = ctx.createChannelSplitter(Math.max(numCh, 2));
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
  renderMeters('asOutputMeters', n, labels, undefined, separatorBefore);
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
  // Which bar(s) to highlight: use explicit arg, or fall back to S.mainInputChannel
  const sel = selectedCh !== undefined ? selectedCh : (S.mainInputChannel ?? 0);
  renderMeters('asInputMeters', numCh, makeInputLabels(numCh, devLabel), sel);
  // Keep main window input meter in sync (same channel layout + highlight)
  S._rebuildMainInputMeters?.();
}

// ── VU metering (unified RAF loop) ────────────────────────────────────────────
function startMetering() {
  if (as.meterRAF) cancelAnimationFrame(as.meterRAF);
  function tick() {
    // Input meters
    if (as.inputAnalysers.length > 0) {
      tickMeters(as.inputAnalysers, 'asInputMeters');
    }
    // Output meters (Electron only — S.speakerAnalysers set by initSpeakerBuses)
    if (S.speakerAnalysers?.length) {
      tickMeters(S.speakerAnalysers, 'asOutputMeters');
    }
    as.meterRAF = requestAnimationFrame(tick);
  }
  tick();
}

function stopMetering() {
  if (as.meterRAF) { cancelAnimationFrame(as.meterRAF); as.meterRAF = null; }
  // Clear canvases
  ['asInputMeters', 'asOutputMeters'].forEach(id => {
    const wrap = document.getElementById(id);
    if (!wrap) return;
    wrap.querySelectorAll('canvas').forEach(cv => {
      const c2 = cv.getContext('2d');
      c2.clearRect(0, 0, cv.width, cv.height);
      c2.fillStyle = '#1a1a1a';
      c2.fillRect(0, 0, cv.width, cv.height);
    });
    wrap.querySelectorAll('.as-vchan-clip').forEach(d => d.classList.remove('clipping'));
  });
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

  // Build hardware channel options (ch 1 … ch N)
  const hwOpts = Array.from({ length: nCh }, (_, i) =>
    `<option value="${i}">ch ${i + 1}</option>`
  ).join('');

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

  // Restore current main channel
  const mainSel = document.getElementById('asMainInputSel');
  if (mainSel) {
    mainSel.value = String(S.mainInputChannel ?? 0);
    mainSel.addEventListener('change', () => {
      const chIndex = parseInt(mainSel.value, 10);
      S.mainInputChannel = chIndex;
      // Rewire recording path to new channel
      if (window.electronBridge?.isElectron) {
        rewireRtAudioRecordingChannel(chIndex, nCh);
      } else if (S.inputStream) {
        buildInputGraph(String(chIndex));
      }
      // Update hidden compat dropdown so legacy channel-change handler still works
      const compat = document.getElementById('asInputChannel');
      if (compat) compat.value = String(chIndex);
      renderInputMeters(chIndex);
      setStatus('asInputStatus', 'ok', `main → ch ${chIndex + 1}`);
    });
  }
}

// ── Output mapping table ──────────────────────────────────────────────────────
// Software-centric view: each software position has a dropdown for hardware out.
// Rows: Position 1 … N (house VBAP), then Headphone L, Headphone R.
// Always shown in Electron when speaker buses are active.
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

  // Build house rows
  const houseRows = houseBuses.map((b, i) => {
    const name = `Position ${i + 1}`;
    const deg  = b.angleDeg.toFixed(0);
    return `<div class="as-io-row" title="${name} — ${deg}°">
      <span class="as-io-sw">${name} <span class="as-io-angle">${deg}°</span></span>
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

  wrap.innerHTML = `
    <div class="as-io-table">
      <div class="as-io-hdr">
        <span class="as-io-col-sw">software output</span>
        <span class="as-io-col-hw">hardware out</span>
      </div>
      ${houseRows}
      ${hpRows}
    </div>`;

  // Set initial values for house dropdowns and attach listeners
  wrap.querySelectorAll('.as-io-house-sel').forEach(sel => {
    const busIdx = parseInt(sel.dataset.bus, 10);
    sel.value = String(houseRouting[busIdx] ?? busIdx);
    sel.addEventListener('change', applyOutputMapping);
  });

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
    // In Electron, RtAudio handles input — skip getUserMedia entirely.
    // Falls back to its own getUserMedia only when running standalone in browser.
    const hasRtAudioInput = window.electronBridge?.isElectron && window._rtAudioInputListening;
    if (!S.inputStream && !hasRtAudioInput) {
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
function updateLatency() {
  const buf = parseInt(document.getElementById('asBufferSize')?.value ?? 512);
  const sr  = S.audioCtx?.sampleRate ?? parseInt(document.getElementById('asSampleRate')?.value ?? 44100);
  const ms  = (buf / sr * 1000).toFixed(1);
  const lbl = document.getElementById('asLatencyLabel');
  const dot = document.getElementById('asLatencyDot');
  if (lbl) lbl.textContent = `≈ ${ms} ms  (${buf} frames / ${sr} Hz)`;
  if (dot) dot.className = 'latency-dot ' + (ms < 8 ? 'ok' : ms < 20 ? 'warn' : 'bad');
}

// ── Engine settings: sample rate + buffer size ────────────────────────────────

async function applySampleRate() {
  const sel = document.getElementById('asSampleRate');
  const newRate = parseInt(sel?.value ?? 44100);
  if (newRate === S.audioCtx?.sampleRate) return; // no change

  const confirmed = window.confirm(
    `Change sample rate to ${newRate} Hz?\n\nThis will restart the audio engine. Any active recording will be lost.`
  );
  if (!confirmed) { if (sel) sel.value = String(S.audioCtx?.sampleRate ?? 44100); return; }

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
      const nCh = current.outputChannels;
      await window.electronBridge.setAudioDevice(current.id, nCh);
      await initSpeakerBuses(nCh);
    }
  }

  updateLatency();
  setStatus('asInputStatus',  'idle', `engine restarted at ${newRate} Hz — re-select input`);
  setStatus('asOutputStatus', 'idle', `engine restarted at ${newRate} Hz — re-apply output`);
}

async function applyBufferSize() {
  const buf = parseInt(document.getElementById('asBufferSize')?.value ?? 512);

  // Store so initSpeakerBuses can compute the correct worklet batchSize
  S.preferredBufferSize = buf;

  if (window.electronBridge?.isElectron) {
    // Re-open the audify stream with the new buffer size
    const devices = await window.electronBridge.getAudioDevices();
    const current = devices.find(d => d.isDefault) || devices[0];
    if (current) {
      const nCh = S.speakerBuses?.length ?? current.outputChannels;
      const result = await window.electronBridge.setAudioDevice(current.id, nCh, buf);
      const ok = result.streaming;
      setStatus('asOutputStatus', ok ? 'ok' : 'error',
        ok ? `buffer: ${buf} frames @ ${S.audioCtx?.sampleRate} Hz` : 'failed to reopen stream');

      if (ok) {
        // Rebuild speaker buses so the worklet batchSize matches the new audify buffer
        await initSpeakerBuses(nCh);
      }
    }
  }
  // Browser: Web Audio manages its own buffer — just update the latency display
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
  const vol     = 0.06;  // fixed low level — just audible for speaker identification

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
        await playSweepChannel(entry.ch, stepMs, fadeMs, vol);
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

let _inputDeviceId  = null;  // currently active input deviceId
let _inputNumCh     = 1;     // channels actually delivered by current stream

let _outputDeviceId = null;  // currently active output deviceId (set on Apply)

async function populateInputDevices() {
  const sel = document.getElementById('asInputDevice');
  if (!sel) return;

  sel.innerHTML = '<option value="">— scanning… —</option>';

  try {
    if (window.electronBridge?.getInputDevices) {
      // ── Electron: use RtAudio device list (shows true channel counts) ──────
      const devices = await window.electronBridge.getInputDevices();
      sel.innerHTML = '';
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
      else if (devices.length) sel.value = devices[0].id;

    } else {
      // ── Browser: use standard MediaDevices API ───────────────────────────
      if (!S.micPermissionGranted) {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach(t => t.stop());
      }
      const all    = await navigator.mediaDevices.enumerateDevices();
      const inputs = all.filter(d => d.kind === 'audioinput');
      sel.innerHTML = '';
      inputs.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `Input ${d.deviceId.slice(0, 8)}`;
        if (d.deviceId === _inputDeviceId) opt.selected = true;
        sel.appendChild(opt);
      });
      if (_inputDeviceId) sel.value = _inputDeviceId;
      else if (inputs.length) sel.value = inputs[0].deviceId;
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
}

async function applyInputDevice() {
  const devSel = document.getElementById('asInputDevice');
  if (!devSel?.value) return;

  setStatus('asInputStatus', 'idle', 'opening input stream…');
  stopMetering();

  // ── Electron: use RtAudio for true multichannel input metering ─────────────
  if (window.electronBridge?.setInputDevice) {
    const deviceId  = parseInt(devSel.value, 10);
    const bufFrames = S.preferredBufferSize ?? 512;

    // Find the device to know its channel count
    const devices = await window.electronBridge.getInputDevices();
    const device  = devices.find(d => d.id === deviceId);
    if (!device) {
      setStatus('asInputStatus', 'error', 'device not found');
      return;
    }

    const result = await window.electronBridge.setInputDevice(deviceId, device.inputChannels, bufFrames);
    if (!result.ok) {
      setStatus('asInputStatus', 'error', result.error ?? 'failed to open input stream');
      return;
    }

    const nCh = result.nCh;
    _inputDeviceId = deviceId;
    _inputNumCh    = nCh;

    await setupRtAudioInputMeters(nCh);
    repopulateChannelSelect(nCh);
    renderInputMeters(S.mainInputChannel ?? 0);
    renderInputMappingTable();  // show software-path → hardware-channel table

    const devLabel = devSel.options[devSel.selectedIndex]?.text || String(deviceId);
    setStatus('asInputStatus', 'ok', `${devLabel} — ${nCh} ch — ${result.sampleRate} Hz`);
    startMetering();
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
        sampleRate:       { ideal: S.audioCtx?.sampleRate ?? 44100 },
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
    window._micMonitorSrc = monitorSrc;

    // Update channel dropdown to reflect actual channel count
    repopulateChannelSelect(numCh);

    // Rebuild input graph for selected channel (also populates as.inputAnalysers)
    buildInputGraph(document.getElementById('asInputChannel')?.value || '0');

    // Render N vertical meter bars for the actual channel count
    renderInputMeters();

    const devLabel = devSel.options[devSel.selectedIndex]?.text || deviceId;
    setStatus('asInputStatus', 'ok', `${devLabel} — ${numCh} ch — ${actx.sampleRate} Hz`);
    startMetering();

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

    // Restore the last-applied device; fall back to system default on first open
    if (_outputDeviceId != null && devices.some(d => d.id === _outputDeviceId)) {
      sel.value = _outputDeviceId;
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

  const numCh = device.outputChannels;

  setStatus('asOutputStatus', 'idle', `opening ${numCh}-ch stream on "${device.name}"…`);

  try {
    // Clear any stale channel routing from a previous device — it's channel-count
    // specific and would silently misroute buses on the new layout.
    S.channelRouting = null;

    // Open the hardware stream first so audify is ready for the correct channel
    // count before the Web Audio worklet starts posting buffers to it.
    const bufFrames = S.preferredBufferSize ?? 512;
    const result = await window.electronBridge.setAudioDevice(deviceId, numCh, bufFrames);

    // Now rebuild the Web Audio speaker bus graph — worklet posts start after this.
    await initSpeakerBuses(numCh);

    if (result.streaming) {
      _outputDeviceId = deviceId;   // remember for dropdown restore on re-open

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
const LS_AUDIO_DEFAULTS = 'mubone_audio_defaults';

// Legacy export — kept so existing imports don't break (no-op now)
export function wireSaveDefaultBtn(_btnId) {}

export function saveAllDefaults() {
  const defaults = {
    // Devices
    inputDeviceId:   _inputDeviceId,
    outputDeviceId:  _outputDeviceId,
    mainInputChannel: S.mainInputChannel ?? 0,

    // Engine
    sampleRate:       S.audioCtx?.sampleRate ?? null,
    bufferSize:       S.preferredBufferSize ?? null,

    // Gains
    outputGain:       as.outputGain,
    inputGains:       { ...as.inputGains },

    // Noise gate
    vizNoiseFloor:    S.vizNoiseFloor,

    // Viz calibration
    vizMode:          S.vizMode,
    vizMinSize:       S.vizMinSize,
    vizMaxSize:       S.vizMaxSize,
    vizRmsMin:        S.vizRmsMin,
    vizRmsMax:        S.vizRmsMax,
    vizCentroidMin:   S.vizCentroidMin,
    vizCentroidMax:   S.vizCentroidMax,

    // Radius fade
    radiusFadeEnabled: S.radiusFadeEnabled,
    radiusFadeCurve:   S.radiusFadeCurve,

    // Camera + spatial panning
    cameraMode:       S.cameraMode,
    spatialPanning:   S.spatialPanning,

    // Speaker layout + routing
    numHouseSpeakers:     S.numHouseSpeakers,
    stereoMixdownEnabled: S.stereoMixdownEnabled,
    channelRouting:       S.channelRouting ?? null,
    headphoneRouting:     S.headphoneRouting ?? null,

    // Sensor calibration
    sensorCal:   JSON.parse(JSON.stringify(S.sensorCal)),
    sensor2Cal:  JSON.parse(JSON.stringify(S.sensor2Cal)),
    wandCal:     JSON.parse(JSON.stringify(S.wandCal)),

    // Seed settings (persist as setup, not live performance)
    seedMode:           S.seedMode ?? 'all',
    seedTether:         S.seedTether ?? false,
    seedXfade:      S.seedXfade ?? 0.5,
    seedAttack:         S.seedAttack ?? 0,
    seedRelease:        S.seedRelease ?? 0,
    seedLoopMode:       S.seedLoopMode ?? 'pingpong',
    loopReleaseMode:    S.loopReleaseMode ?? 'fade',
    loopFadeTimeMs:     S.loopFadeTimeMs ?? 15,

    // Headphone mix balance
    mixdownCursorGainValue: S.mixdownCursorGainValue ?? 1.0,
    mixdownHouseGainValue:  S.mixdownHouseGainValue ?? 1.0,

    // Recording limit
    recLimitSeconds: S.recLimitSeconds,

    // Last active preset
    activePresetIndex: S.activePresetIndex ?? FACTORY_PRESET_START,

    ts: Date.now(),
  };

  try {
    const json = JSON.stringify(defaults);
    localStorage.setItem(LS_AUDIO_DEFAULTS, json);
    DEBUG && console.log('[defaults] auto-saved:', json.length, 'bytes');
    return true;
  } catch (e) {
    console.warn('[defaults] could not save:', e);
    return false;
  }
}

// ── Auto-persist via dirty check ────────────────────────────────────────────
// Every 2s, snapshot the persisted settings and compare to last save.
// Only writes to localStorage when something actually changed.
// This avoids needing 59+ individual scheduleAutoSave() call sites.
let _lastSavedJson = '';

function _buildSettingsSnapshot() {
  const snap = {
    inputDeviceId: _inputDeviceId, outputDeviceId: _outputDeviceId,
    mainInputChannel: S.mainInputChannel ?? 0,
    sampleRate: S.audioCtx?.sampleRate ?? null, bufferSize: S.preferredBufferSize ?? null,
    outputGain: as.outputGain, inputGains: { ...as.inputGains },
    vizNoiseFloor: S.vizNoiseFloor, vizMode: S.vizMode,
    vizMinSize: S.vizMinSize, vizMaxSize: S.vizMaxSize,
    vizRmsMin: S.vizRmsMin, vizRmsMax: S.vizRmsMax,
    vizCentroidMin: S.vizCentroidMin, vizCentroidMax: S.vizCentroidMax,
    radiusFadeEnabled: S.radiusFadeEnabled, radiusFadeCurve: S.radiusFadeCurve,
    cameraMode: S.cameraMode, spatialPanning: S.spatialPanning,
    numHouseSpeakers: S.numHouseSpeakers, stereoMixdownEnabled: S.stereoMixdownEnabled,
    channelRouting: S.channelRouting ?? null, headphoneRouting: S.headphoneRouting ?? null,
    seedMode: S.seedMode ?? 'all', seedTether: S.seedTether ?? false,
    seedXfade: S.seedXfade ?? 0.5, seedAttack: S.seedAttack ?? 0, seedRelease: S.seedRelease ?? 0,
    seedLoopMode: S.seedLoopMode ?? 'pingpong', loopReleaseMode: S.loopReleaseMode ?? 'fade', loopFadeTimeMs: S.loopFadeTimeMs ?? 15,
    mixdownCursorGainValue: S.mixdownCursorGainValue ?? 1.0,
    mixdownHouseGainValue: S.mixdownHouseGainValue ?? 1.0,
    activePresetIndex: S.activePresetIndex ?? FACTORY_PRESET_START,
  };
  if (S.sensorCal)   snap.sensorCal  = S.sensorCal;
  if (S.sensor2Cal)  snap.sensor2Cal = S.sensor2Cal;
  if (S.wandCal)     snap.wandCal    = S.wandCal;
  return snap;
}

function _checkAndSave() {
  try {
    const json = JSON.stringify(_buildSettingsSnapshot());
    if (json !== _lastSavedJson) {
      _lastSavedJson = json;
      saveAllDefaults();
    }
  } catch (_) { /* ignore — quota or serialization error */ }
}

// Start the dirty-check loop after a short delay so page init settles
export function startAutoSave() {
  // Capture initial snapshot so we don't re-save on first tick
  try { _lastSavedJson = JSON.stringify(_buildSettingsSnapshot()); } catch (_) {}
  setInterval(_checkAndSave, 2000);
}

// Legacy export — kept so existing imports don't break
export function scheduleAutoSave() { _checkAndSave(); }

export function loadAudioDefaults() {
  try {
    const raw = localStorage.getItem(LS_AUDIO_DEFAULTS);
    if (!raw) return;
    const d = JSON.parse(raw);

    // Devices — restore module-level vars so dropdowns pre-select on next open,
    // and expose on S so main.js can auto-open the saved devices at startup.
    if (d.inputDeviceId != null) {
      _inputDeviceId = d.inputDeviceId;
      S._savedInputDeviceId = d.inputDeviceId;
      // Also set selectedInputDeviceId so requestMicAccess (browser path)
      // opens the saved device instead of the system default.
      S.selectedInputDeviceId = d.inputDeviceId;
    }
    if (d.outputDeviceId != null) {
      _outputDeviceId = d.outputDeviceId;
      S._savedOutputDeviceId = d.outputDeviceId;
    }
    if (typeof d.mainInputChannel === 'number') S.mainInputChannel = d.mainInputChannel;

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

    // Noise gate
    if (typeof d.vizNoiseFloor  === 'number') S.vizNoiseFloor  = d.vizNoiseFloor;

    // Viz calibration
    if (typeof d.vizMode        === 'boolean') S.vizMode         = d.vizMode;
    if (typeof d.vizMinSize    === 'number')  S.vizMinSize     = d.vizMinSize;
    if (typeof d.vizMaxSize     === 'number')  S.vizMaxSize      = d.vizMaxSize;
    if (typeof d.vizRmsMin      === 'number')  S.vizRmsMin       = d.vizRmsMin;
    if (typeof d.vizRmsMax      === 'number')  S.vizRmsMax       = d.vizRmsMax;
    if (typeof d.vizCentroidMin === 'number')  S.vizCentroidMin  = d.vizCentroidMin;
    if (typeof d.vizCentroidMax === 'number')  S.vizCentroidMax  = d.vizCentroidMax;

    // Radius fade
    if (typeof d.radiusFadeEnabled === 'boolean') S.radiusFadeEnabled = d.radiusFadeEnabled;
    if (typeof d.radiusFadeCurve   === 'number')  S.radiusFadeCurve   = d.radiusFadeCurve;

    // Camera + spatial panning
    if (typeof d.cameraMode === 'string' && ['pull', 'surface', 'sensor'].includes(d.cameraMode)) S.cameraMode = d.cameraMode;
    if (typeof d.spatialPanning === 'string' && ['headlocked', 'worldlocked'].includes(d.spatialPanning)) S.spatialPanning = d.spatialPanning;

    // Speaker layout + routing
    if (typeof d.numHouseSpeakers    === 'number')  S.numHouseSpeakers     = d.numHouseSpeakers;
    if (typeof d.stereoMixdownEnabled === 'boolean') S.stereoMixdownEnabled = d.stereoMixdownEnabled;
    if (Array.isArray(d.channelRouting))              S.channelRouting       = d.channelRouting;
    if (Array.isArray(d.headphoneRouting))             S.headphoneRouting     = d.headphoneRouting;

    // Sensor calibration
    if (d.sensorCal?.axisMap)  Object.assign(S.sensorCal.axisMap,  d.sensorCal.axisMap);
    if (d.sensor2Cal?.axisMap) Object.assign(S.sensor2Cal.axisMap, d.sensor2Cal.axisMap);
    if (d.wandCal?.axisMap)    Object.assign(S.wandCal.axisMap,    d.wandCal.axisMap);

    // Seed settings (with backward compat for old names)
    if (typeof d.seedMode === 'string')        S.seedMode        = d.seedMode;
    if (typeof d.seedTether === 'boolean')     S.seedTether      = d.seedTether;
    else if (typeof d.seedNearestAlways === 'boolean') S.seedTether = d.seedNearestAlways;  // backward compat
    if (typeof d.seedXfade === 'number')   S.seedXfade   = d.seedXfade;
    else if (typeof d.seedSnapFade === 'number') S.seedXfade = d.seedSnapFade;  // backward compat
    else if (typeof d.seedCrossfade === 'number') S.seedXfade = d.seedCrossfade;  // backward compat
    if (typeof d.seedAttack === 'number')          S.seedAttack         = d.seedAttack;
    if (typeof d.seedRelease === 'number')         S.seedRelease        = d.seedRelease;
    if (typeof d.seedLoopMode === 'string' && ['pingpong', 'forward'].includes(d.seedLoopMode))
      S.seedLoopMode = d.seedLoopMode;
    if (typeof d.loopReleaseMode === 'string' && ['fade', 'play-to-end'].includes(d.loopReleaseMode))
      S.loopReleaseMode = d.loopReleaseMode;
    if (typeof d.loopFadeTimeMs === 'number') S.loopFadeTimeMs = Math.max(0, Math.min(2000, d.loopFadeTimeMs));

    // Headphone mix balance
    if (typeof d.mixdownCursorGainValue === 'number') S.mixdownCursorGainValue = d.mixdownCursorGainValue;
    if (typeof d.mixdownHouseGainValue === 'number')  S.mixdownHouseGainValue  = d.mixdownHouseGainValue;

    // Recording limit
    if (typeof d.recLimitSeconds === 'number') S.recLimitSeconds = d.recLimitSeconds;

    // Last active preset
    if (typeof d.activePresetIndex === 'number') S.activePresetIndex = d.activePresetIndex;

    DEBUG && console.log('[defaults] restored saved defaults');
  } catch (e) {
    console.warn('[audio-settings] could not load defaults:', e);
  }
}

// ── Startup device activation (called from main.js after hardware is opened) ──
// Wires the Web Audio graph for saved devices that were auto-opened at startup.
// This must run AFTER initAudioSettings() so the DOM elements exist.

export async function activateSavedInputDevice(nCh) {
  // Wire up the full RtAudio input metering + recording chain.
  // This is the same work applyInputDevice() does after setInputDevice(),
  // but without needing the DOM dropdown to be populated first.
  _inputNumCh = nCh;
  await setupRtAudioInputMeters(nCh);
  repopulateChannelSelect(nCh);

  // Restore saved main input channel
  const selCh = S.mainInputChannel ?? 0;
  const chSel = document.getElementById('asInputChannel');
  if (chSel) chSel.value = String(selCh);
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

  DEBUG && console.log(`[startup] input device activated — ${nCh} ch, recording ch ${selCh + 1}`);
}

// ── Init ──────────────────────────────────────────────────────────────────────
export function initAudioSettings() {
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

      // Sync noise gate slider to S.vizNoiseFloor (may have been restored from saved defaults)
      {
        const gs = document.getElementById('asNoiseGateSlider');
        const gv = document.getElementById('asNoiseGateVal');
        if (gs) gs.value = S.vizNoiseFloor;
        if (gv) gv.textContent = S.vizNoiseFloor.toFixed(4);
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
      // If input is already running (e.g. Electron auto-activation at startup),
      // render its meters + mapping table and show active status.
      if (as.inputAnalysers.length > 0) {
        renderInputMeters();
        renderInputMappingTable();
        // Show active status if not already displayed
        if (as.started && _inputDeviceId != null) {
          const nCh = as.inputAnalysers.length;
          setStatus('asInputStatus', 'ok', `${nCh} ch input active — recording ch ${(S.mainInputChannel ?? 0) + 1}`);
        }
      } else {
        // Render a minimal 1-ch input meter placeholder
        renderMeters('asInputMeters', 1);
      }

      // Sync rate selector to live AudioContext rate (or saved rate)
      const rateSel = document.getElementById('asSampleRate');
      if (rateSel) {
        if (S.audioCtx) rateSel.value = String(S.audioCtx.sampleRate);
        else if (S.savedSampleRate) rateSel.value = String(S.savedSampleRate);
      }
      // Sync buffer size selector to saved preference
      const bufSel = document.getElementById('asBufferSize');
      if (bufSel && S.preferredBufferSize) bufSel.value = String(S.preferredBufferSize);
      updateLatency();

      // If mic was already enabled from the top-bar button, auto-start the
      // audio settings view so it reflects the active state rather than looking
      // idle. startAudio() reuses S.inputStream / S.audioCtx without re-prompting.
      if (S.micPermissionGranted && S.inputStream && !as.started) {
        startAudio();
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

  document.getElementById('asInputDevice')?.addEventListener('change',  applyInputDevice);
  document.getElementById('asInputDeviceApply')?.addEventListener('click', applyInputDevice);
  document.getElementById('asOutputDevice')?.addEventListener('change', applyOutputDevice);
  document.getElementById('asRateApply')?.addEventListener('click',   applySampleRate);
  document.getElementById('asBufferApply')?.addEventListener('click', applyBufferSize);

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
  const inputGainRow = document.getElementById('asInputGain')?.closest('.as-row');
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

  // ── Noise gate slider ──────────────────────────────────────────────────────
  const gateSlider = document.getElementById('asNoiseGateSlider');
  const gateVal    = document.getElementById('asNoiseGateVal');
  if (gateSlider) {
    gateSlider.value = S.vizNoiseFloor;
    if (gateVal) gateVal.textContent = S.vizNoiseFloor.toFixed(4);
    gateSlider.addEventListener('input', () => {
      S.vizNoiseFloor = parseFloat(gateSlider.value);
      if (gateVal) gateVal.textContent = S.vizNoiseFloor.toFixed(4);
    });
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
    const highlight = isStereo ? [0, 1] : (parseInt(val, 10) || 0);

    // Restore the remembered gain for this channel and update the slider + gain node
    const savedGain = as.inputGains[val] ?? 0;
    const gainSlider = document.getElementById('asInputGain');
    const gainLbl    = document.getElementById('asInputGainVal');
    if (gainSlider) gainSlider.value = String(savedGain);
    if (gainLbl)    gainLbl.textContent = formatDb(savedGain);
    if (S.inputGainNode) S.inputGainNode.gain.value = dbToLinear(savedGain);

    if (window.electronBridge?.isElectron) {
      // Electron: RtAudio path — rewire splitter output into recording chain
      const chIndex = isStereo ? 0 : (parseInt(val, 10) || 0);
      rewireRtAudioRecordingChannel(chIndex, as.inputAnalysers.length);
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
  document.getElementById('asStartBtn')?.addEventListener('click', startAudio);

}

// Sync the house-speakers dropdown + stereo mixdown checkbox to S state.
function syncHouseSpeakersSeg() {
  const n    = S.numHouseSpeakers ?? 2;
  const note = document.getElementById('asHouseSpeakersNote');
  const sel  = document.getElementById('asHouseSpeakersSel');
  if (sel) sel.value = String(n);
  if (note) {
    const names = { 2: 'stereo field', 4: 'quad', 6: 'hexaphonic', 8: 'octaphonic', 16: '16-speaker field' };
    note.textContent = names[n] ?? `${n}-speaker field`;
  }
  // Also sync the mixdown checkbox + note
  const chk      = document.getElementById('asStereoMixdownChk');
  const mxNote   = document.getElementById('asStereoMixdownNote');
  const mxRow    = document.getElementById('asStereoMixdownRow');
  const totalCh  = S.speakerBuses?.numChannels ?? 0;
  const canMix   = totalCh >= 4;  // need at least 4 outputs (2 house + 2 mixdown)
  if (mxRow) mxRow.style.display = '';
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
    mxNote.textContent = !canMix
      ? 'requires 4 or more output channels'
      : S.stereoMixdownEnabled
        ? 'on — last 2 outputs reserved for stereo mixdown'
        : 'off — all channels are house';
  }
}
