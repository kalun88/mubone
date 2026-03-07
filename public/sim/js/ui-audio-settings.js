// ============================================================================
// UI — AUDIO SETTINGS MODAL
// Channel selection, input gain, VU metering, output gain, latency display.
// No device dropdowns — browser follows macOS system default.
// No monitoring — graph ends at analyser (dead end), MOTU handles monitoring.
// ============================================================================

import { S } from './state.js';
import { initSpeakerBuses, recreateAudioContext, rewireChannelMerger, ensureAudioContext } from './audio.js';

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
let _rtInputSplitter = null;

async function setupRtAudioInputMeters(nCh) {
  const actx = ensureAudioContext();
  await ensureInputMeterWorklet(actx);

  // Tear down old worklet node + analysers
  if (_inputWorkletNode) {
    try { _inputWorkletNode.disconnect(); } catch(_) {}
    _inputWorkletNode = null;
  }
  as.inputAnalysers.forEach(an => { try { an.disconnect(); } catch(_) {} });
  as.inputAnalysers = [];
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

  // Wire selected channel into the recording path (S.inputGainNode → S.inputAnalyser)
  // so spacebar records from whatever channel the dropdown shows.
  const selCh = parseInt(document.getElementById('asInputChannel')?.value ?? '0', 10) || 0;
  rewireRtAudioRecordingChannel(selCh, nCh);

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

// Rewire which RtAudio splitter channel feeds S.inputGainNode (recording path).
// Called on device apply and on channel dropdown change.
function rewireRtAudioRecordingChannel(chIndex, nCh) {
  if (!_rtInputSplitter) return;
  const actx = ensureAudioContext();

  // Ensure recording gain node exists
  if (!S.inputGainNode) {
    S.inputGainNode = actx.createGain();
    S.inputGainNode.gain.value = 1.0;
  }
  // Always (re)create the inputAnalyser so it's wired to RtAudio, not a stale
  // getUserMedia stream (e.g. MacBook mic) that may have been set up earlier.
  try { S.inputGainNode.disconnect(S.inputAnalyser); } catch(_) {}
  S.inputAnalyser = actx.createAnalyser();
  S.inputAnalyser.fftSize = 256;
  S.inputAnalyser.smoothingTimeConstant = 0.6;
  S.inputGainNode.connect(S.inputAnalyser);

  // Disconnect all splitter outputs from inputGainNode, then reconnect just the chosen one
  const n = nCh ?? as.inputAnalysers.length;
  for (let i = 0; i < n; i++) {
    try { _rtInputSplitter.disconnect(S.inputGainNode, i, 0); } catch(_) {}
  }
  const safe = Math.max(0, Math.min(chIndex, n - 1));
  _rtInputSplitter.connect(S.inputGainNode, safe, 0);
  console.log(`[input] recording from RtAudio ch ${safe + 1} (index ${safe})`);
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
  inputGain:      0,
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
    S.inputGainNode.gain.value = dbToLinear(as.inputGain);
  }
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

  // Per-channel AnalyserNodes for the meter strip (all channels, not just selected)
  as.inputAnalysers.forEach(an => { try { an.disconnect(); } catch(_) {} });
  as.inputAnalysers = Array.from({ length: numCh }, (_, i) => {
    const an = ctx.createAnalyser();
    an.fftSize = 256;
    an.smoothingTimeConstant = 0.8;
    as.splitterNode.connect(an, i);
    return an;
  });
}

// ── Multi-channel meter rendering ─────────────────────────────────────────────
// Creates N vertical canvas VU bars inside a container element.
// Each bar has: a clip indicator dot, a canvas bar, and a channel label.
// selectedCh: index or array of indices — those bars get a highlight outline.
// Pass [0, 1] for stereo L+R to highlight both.
function renderMeters(containerId, numCh, labels, selectedCh) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  const highlighted = Array.isArray(selectedCh) ? selectedCh : (selectedCh !== undefined ? [selectedCh] : []);
  wrap.innerHTML = '';
  for (let i = 0; i < numCh; i++) {
    const ch = document.createElement('div');
    ch.className = 'as-vchan';
    if (highlighted.includes(i)) {
      ch.style.outline = '1px solid #7abcbc';
      ch.style.borderRadius = '2px';
    }

    const clip = document.createElement('div');
    clip.className = 'as-vchan-clip';
    clip.id = `${containerId}-clip-${i}`;

    const canvas = document.createElement('canvas');
    canvas.width  = 14;
    canvas.height = 56;   // matches 72px wrap minus clip dot + label
    canvas.id = `${containerId}-cv-${i}`;

    const lbl = document.createElement('div');
    lbl.className = 'as-vchan-label';
    lbl.textContent = labels?.[i] ?? String(i + 1);

    ch.append(clip, canvas, lbl);
    wrap.appendChild(ch);
  }
}

// Draw one frame of meters for an array of AnalyserNodes into a given container.
const _meterBuf = new Float32Array(256);
function tickMeters(analysers, containerId) {
  for (let i = 0; i < analysers.length; i++) {
    const an = analysers[i];
    if (!an) continue;
    an.getFloatTimeDomainData(_meterBuf);
    let peak = 0;
    for (let s = 0; s < _meterBuf.length; s++) peak = Math.max(peak, Math.abs(_meterBuf[s]));
    const db  = peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
    const pct = clamp((db + 60) / 60, 0, 1);  // 0 = -60 dBFS, 1 = 0 dBFS

    const canvas = document.getElementById(`${containerId}-cv-${i}`);
    const clip   = document.getElementById(`${containerId}-clip-${i}`);

    if (canvas) {
      const c2 = canvas.getContext('2d');
      const w  = canvas.width;
      const h  = canvas.height;
      c2.clearRect(0, 0, w, h);
      // Draw dark background
      c2.fillStyle = '#1a1a1a';
      c2.fillRect(0, 0, w, h);
      // Draw filled bar from bottom
      const fillH = Math.round(pct * h);
      if (fillH > 0) {
        const grad = c2.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0,    '#2a7070');
        grad.addColorStop(0.6,  '#3a9090');
        grad.addColorStop(0.8,  '#7abcbc');
        grad.addColorStop(0.93, '#e8c840');
        grad.addColorStop(1.0,  '#e06060');
        c2.fillStyle = grad;
        c2.fillRect(0, h - fillH, w, fillH);
      }
      // Draw tick marks at -12, -6, -3 dBFS
      c2.fillStyle = '#111a1a';
      for (const tickDb of [-12, -6, -3]) {
        const ty = h - Math.round((tickDb + 60) / 60 * h);
        c2.fillRect(0, ty, w, 1);
      }
    }

    if (clip) {
      clip.classList.toggle('clipping', db >= -1);
    }
  }
}

// Generate short spatial label for an output bus angle (fits in ~18px column)
function shortAngleName(deg) {
  const d = ((deg % 360) + 360) % 360;
  if (d < 15 || d >= 345)  return 'F';
  if (d < 75)  return 'FR';
  if (d < 105) return 'R';
  if (d < 165) return 'RR';
  if (d < 195) return 'B';
  if (d < 255) return 'RL';
  if (d < 285) return 'L';
  if (d < 345) return 'FL';
  return `${Math.round(d)}`;
}

// Render output meter bars using S.speakerAnalysers (set by audio.js initSpeakerBuses)
function renderOutputMeters() {
  const wrap = document.getElementById('asOutputMeters');
  if (!wrap) return;
  if (!S.speakerAnalysers?.length) { wrap.style.display = 'none'; return; }
  const n = S.speakerAnalysers.length;
  // Use user overrides if set, otherwise derive from speaker bus angles
  const labels = S.outputChannelLabels
    ?? S.speakerBuses?.map(b => shortAngleName(b.angleDeg))
    ?? Array.from({ length: n }, (_, i) => String(i + 1));
  wrap.style.display = '';
  renderMeters('asOutputMeters', n, labels);
}

// Generate short input channel labels from device name + channel count.
// e.g. "UltraLite mk4" with 18ch → ["1","2",..."18"] but grouped by pairs if stereo pairs known
function makeInputLabels(numCh, deviceLabel) {
  // If user has overrides, use them
  if (S.inputChannelLabels?.length >= numCh) return S.inputChannelLabels.slice(0, numCh);
  // Auto-generate: just show channel numbers as short as possible
  return Array.from({ length: numCh }, (_, i) => String(i + 1));
}

// Render input meter bars using as.inputAnalysers (set by buildInputGraph or setupRtAudioInputMeters)
// selectedCh: index of the channel feeding the granular engine — that bar gets a highlight border
function renderInputMeters(selectedCh) {
  const numCh = as.inputAnalysers.length || 1;
  const devSel = document.getElementById('asInputDevice');
  const devLabel = devSel?.options[devSel.selectedIndex]?.text ?? '';
  // Resolve which bars to highlight — caller can pass an index, or we read the dropdown.
  // Stereo L+R highlights both ch 0 and ch 1.
  let sel;
  if (selectedCh !== undefined) {
    sel = selectedCh;
  } else {
    const val = document.getElementById('asInputChannel')?.value;
    sel = val === 'stereo' ? [0, 1] : (parseInt(val, 10) || 0);
  }
  renderMeters('asInputMeters', numCh, makeInputLabels(numCh, devLabel), sel);
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

// ── Output routing table ──────────────────────────────────────────────────────
// Shows a Physical→Spatial dropdown per output channel when > 2 ch are active.
function renderRoutingTable() {
  const wrap = document.getElementById('asRoutingTable');
  if (!wrap) return;
  const buses = S.speakerBuses;
  const n     = buses?.length ?? 0;

  if (n <= 2) {
    // Stereo or mono — no routing table needed
    wrap.style.display = 'none';
    wrap.innerHTML     = '';
    return;
  }

  wrap.style.display = '';

  // Build bus options (one per speaker bus, identified by angle)
  const busOpts = buses.map((b, i) => {
    const deg       = b.angleDeg.toFixed(0);
    const longName  = angleToName(b.angleDeg);
    const userLabel = S.outputChannelLabels?.[i];
    const display   = userLabel ? `${userLabel} — ${longName}` : longName;
    return `<option value="${i}">${i + 1} — ${display} (${deg}°)</option>`;
  }).join('');

  // Current routing (default = identity: bus i → physical ch i)
  const routing = S.channelRouting ?? buses.map((_, i) => i);

  wrap.innerHTML = `<div class="as-routing-wrap">
    <div class="as-routing-label">output routing</div>
    ${Array.from({ length: n }, (_, i) => `
      <div class="as-routing-row">
        <span class="as-routing-ch">out ${i + 1}</span>
        <select class="as-routing-sel" data-ch="${i}">
          <option value="-1">— mute —</option>
          ${busOpts}
        </select>
      </div>`).join('')}
  </div>`;

  // Set selected values and attach change handlers
  wrap.querySelectorAll('.as-routing-sel').forEach(sel => {
    const ch = parseInt(sel.dataset.ch, 10);
    sel.value = String(routing[ch] ?? ch);
    sel.addEventListener('change', applyRouting);
  });
}

// Translate an azimuth angle to a human-readable speaker name
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

function applyRouting() {
  const rows    = document.querySelectorAll('#asRoutingTable .as-routing-sel');
  const mapping = [];
  rows.forEach(sel => {
    mapping[parseInt(sel.dataset.ch, 10)] = parseInt(sel.value, 10);
  });
  S.channelRouting = mapping;
  rewireChannelMerger();
  setStatus('asOutputStatus', 'ok', `routing updated — ${mapping.map((b, i) => `out${i+1}→bus${b+1}`).join(', ')}`);
}

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
    // Falls back to its own getUserMedia only when running standalone.
    if (!S.inputStream) {
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
  const vol     = dbToLinear(as.outputGain) * 0.25;

  const buses = S.speakerBuses;  // may be null in browser

  if (buses?.length) {
    // ── Electron: step through each speaker bus ──────────────────────────────
    for (let i = 0; i < buses.length; i++) {
      if (_sweepStopFlag) break;

      const label = `speaker ${i + 1} / ${buses.length}  (${buses[i].angleDeg.toFixed(0)}°)`;
      setStatus('asOutputStatus', 'warn', `sweep — ${label}`);

      // White noise buffer (stepMs long)
      const frames    = Math.floor(ctx.sampleRate * stepMs / 1000);
      const noiseBuf  = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data      = noiseBuf.getChannelData(0);
      for (let s = 0; s < frames; s++) data[s] = Math.random() * 2 - 1;

      const src  = ctx.createBufferSource();
      src.buffer = noiseBuf;

      const gain = ctx.createGain();
      const fadeSec = fadeMs / 1000;
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + fadeSec);
      gain.gain.setValueAtTime(vol, t + stepMs / 1000 - fadeSec);
      gain.gain.linearRampToValueAtTime(0, t + stepMs / 1000);

      src.connect(gain);
      gain.connect(buses[i].bus);
      src.start();

      await new Promise(r => setTimeout(r, stepMs));

      try { src.stop(); src.disconnect(); gain.disconnect(); } catch(_) {}
    }
  } else {
    // ── Browser stereo: sweep panner left → centre → right ──────────────────
    const positions = [
      { pan: -1, label: 'left' },
      { pan:  0, label: 'centre' },
      { pan:  1, label: 'right' },
    ];
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
      panner.connect(ctx.destination);
      src.start();

      await new Promise(r => setTimeout(r, stepMs));
      try { src.stop(); src.disconnect(); gain.disconnect(); panner.disconnect(); } catch(_) {}
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
    renderInputMeters(0);  // ch 1 selected by default after device apply

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
    S.inputGainNode.gain.value = dbToLinear(as.inputGain);

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

      // Show N output meter bars and routing table now that speaker buses are set up
      renderOutputMeters();
      renderRoutingTable();
      // Restart metering loop so output bars also tick
      startMetering();
    } else {
      setStatus('asOutputStatus', 'error', `stream did not start — check device supports ${numCh} ch`);
    }
  } catch (e) {
    setStatus('asOutputStatus', 'error', `failed: ${e.message}`);
  }
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

      // If speaker buses are already running (startup auto-select), show meters + routing
      if (S.speakerAnalysers?.length) {
        renderOutputMeters();
        renderRoutingTable();
      }
      // If input is already running, render its meters
      if (as.inputAnalysers.length > 0) {
        renderInputMeters();
      } else {
        // Render a minimal 1-ch input meter placeholder
        renderMeters('asInputMeters', 1);
      }

      // Sync rate selector to live AudioContext rate
      const rateSel = document.getElementById('asSampleRate');
      if (rateSel && S.audioCtx) rateSel.value = String(S.audioCtx.sampleRate);
      updateLatency();

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

  document.getElementById('asInputApply')?.addEventListener('click',  applyInputDevice);
  document.getElementById('asOutputApply')?.addEventListener('click', applyOutputDevice);
  document.getElementById('asRateApply')?.addEventListener('click',   applySampleRate);
  document.getElementById('asBufferApply')?.addEventListener('click', applyBufferSize);

  // Input gain — browser only (in Electron, trim at the interface hardware).
  // Writes to S.inputGainNode which sits between the mic source and S.inputAnalyser
  // (the recording path), so this actually affects what gets recorded.
  const inputGainRow = document.getElementById('asInputGain')?.closest('.as-row');
  if (window.electronBridge?.isElectron && inputGainRow) {
    inputGainRow.style.display = 'none';
  }
  document.getElementById('asInputGain')?.addEventListener('input', e => {
    as.inputGain = parseFloat(e.target.value);
    const lbl = document.getElementById('asInputGainVal');
    if (lbl) lbl.textContent = formatDb(as.inputGain);
    // Write to S.inputGainNode — this is the actual recording input gain
    if (S.inputGainNode) S.inputGainNode.gain.value = dbToLinear(as.inputGain);
  });

  // Output gain — writes to S.masterBus (master chain) and headphone downmix node
  document.getElementById('asOutputGain')?.addEventListener('input', e => {
    as.outputGain = parseFloat(e.target.value);
    const lbl = document.getElementById('asOutputGainVal');
    if (lbl) lbl.textContent = formatDb(as.outputGain);
    const lin = dbToLinear(as.outputGain);
    // Master bus gain controls the granular output level for all paths
    if (S.masterBus) S.masterBus.gain.value = lin;
    // Headphone downmix node — only audible in browser (Electron uses RtAudio for output)
    if (window._headphoneOutNode && !window.electronBridge) {
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

    if (window.electronBridge?.isElectron) {
      // Electron: RtAudio path — rewire splitter output into recording chain
      const chIndex = isStereo ? 0 : (parseInt(val, 10) || 0);
      rewireRtAudioRecordingChannel(chIndex, as.inputAnalysers.length);
      renderInputMeters(highlight);
      setStatus('asInputStatus', 'ok', `${lbl} → granular engine`);
    } else if (S.inputStream) {
      // Browser: getUserMedia path — retap the chosen channel from splitter
      buildInputGraph(val);
      renderInputMeters(highlight);
      setStatus('asInputStatus', 'ok', `${lbl} — ${S.audioCtx?.sampleRate} Hz`);
    }
  });

  // Latency — auto-updates once AudioContext is live; also call on output device apply
  updateLatency();

  // Buttons
  document.getElementById('asTestBtn')?.addEventListener('click', handleTestTone);
  document.getElementById('asStartBtn')?.addEventListener('click', startAudio);
  document.getElementById('asResetBtn')?.addEventListener('click', () => {
    stopAudio();
    const ig = document.getElementById('asInputGain');
    const og = document.getElementById('asOutputGain');
    const iv = document.getElementById('asInputGainVal');
    const ov = document.getElementById('asOutputGainVal');
    const ch = document.getElementById('asInputChannel');
    if (ig) ig.value = 0;
    if (og) og.value = -6;
    if (iv) iv.textContent = '0.0 dB';
    if (ov) ov.textContent = '−6.0 dB';
    if (ch) ch.value = '0';
    updateLatency();
  });
}
