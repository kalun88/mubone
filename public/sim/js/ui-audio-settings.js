// ============================================================================
// UI — AUDIO SETTINGS MODAL
// Channel selection, input gain, VU metering, output gain, latency display.
// No device dropdowns — browser follows macOS system default.
// No monitoring — graph ends at analyser (dead end), MOTU handles monitoring.
// ============================================================================

import { S } from './state.js';

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
  inputGain:    0,
  outputGain:  -6,
  sampleRate:   48000,
  sourceNode:   null,
  splitterNode: null,
  gainNodeIn:   null,
  analyserIn:   null,
  meterRAF:     null,
  started:      false,
  ownStream:    false,
  ownCtx:       false,
};

// ── Build input graph ─────────────────────────────────────────────────────────
// source → [splitter →] gainIn → analyserIn → (dead end, no destination)
// No browser monitoring — MOTU handles that in hardware.
function buildInputGraph(channel) {
  const ctx    = S.audioCtx;
  const stream = S.inputStream;
  if (!ctx || !stream) return;

  try { if (as.sourceNode)   as.sourceNode.disconnect();   } catch(_) {}
  try { if (as.splitterNode) as.splitterNode.disconnect(); } catch(_) {}
  try { if (as.gainNodeIn)   as.gainNodeIn.disconnect();   } catch(_) {}

  as.gainNodeIn = ctx.createGain();
  as.gainNodeIn.gain.value = dbToLinear(as.inputGain);
  as.analyserIn = ctx.createAnalyser();
  as.analyserIn.fftSize = 1024;

  as.sourceNode = ctx.createMediaStreamSource(stream);

  if (channel === 'stereo') {
    as.splitterNode = null;
    as.sourceNode.connect(as.gainNodeIn);
  } else {
    const chIndex = parseInt(channel, 10);
    const numCh   = stream.getAudioTracks()[0]?.getSettings()?.channelCount || 2;
    as.splitterNode = ctx.createChannelSplitter(Math.max(numCh, chIndex + 1));
    as.sourceNode.connect(as.splitterNode);
    as.splitterNode.connect(as.gainNodeIn, chIndex, 0);
  }

  // Intentionally NOT connecting to ctx.destination — no software monitoring
  as.gainNodeIn.connect(as.analyserIn);
}

// ── VU metering ───────────────────────────────────────────────────────────────
function startMetering() {
  if (as.meterRAF) cancelAnimationFrame(as.meterRAF);
  const buf = new Float32Array(1024);
  function tick() {
    if (as.analyserIn) {
      as.analyserIn.getFloatTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
      const db  = peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
      const pct = clamp((db + 60) / 72 * 100, 0, 100);
      const meterEl = document.getElementById('asInputMeter');
      const labelEl = document.getElementById('asInputMeterLabel');
      if (meterEl) meterEl.style.width = pct + '%';
      if (labelEl) labelEl.textContent =
        db <= -60 ? '−∞ dBFS' : (db < 0 ? '−' : '+') + Math.abs(db).toFixed(1) + ' dBFS';
    }
    as.meterRAF = requestAnimationFrame(tick);
  }
  tick();
}

function stopMetering() {
  if (as.meterRAF) { cancelAnimationFrame(as.meterRAF); as.meterRAF = null; }
  const meterEl = document.getElementById('asInputMeter');
  const labelEl = document.getElementById('asInputMeterLabel');
  if (meterEl) meterEl.style.width = '0%';
  if (labelEl) labelEl.textContent = '— dBFS';
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

    as.started = true;
    startBtn.textContent = 'stop audio';
    startBtn.disabled = false;

    const lbl = channel === 'stereo' ? 'stereo' : `ch ${parseInt(channel) + 1}`;
    setStatus('asInputStatus',  'ok', `active — ${lbl} — ${S.audioCtx.sampleRate} Hz`);
    setStatus('asOutputStatus', 'ok', 'monitoring via MOTU (not browser)');
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
  as.started = false;

  const startBtn = document.getElementById('asStartBtn');
  if (startBtn) startBtn.textContent = 'start audio';
  setStatus('asInputStatus',  'idle', 'no input active');
  setStatus('asOutputStatus', 'idle', 'no output active');
}

// ── Latency display ───────────────────────────────────────────────────────────
function updateLatency() {
  const buf = parseInt(document.getElementById('asBufferSize')?.value || 256);
  const sr  = parseInt(document.getElementById('asSampleRate')?.value || 48000);
  const ms  = (buf / sr * 1000).toFixed(1);
  const lbl = document.getElementById('asLatencyLabel');
  const dot = document.getElementById('asLatencyDot');
  if (lbl) lbl.textContent = `latency: ≈ ${ms} ms  (${buf} / ${sr} Hz)`;
  if (dot) dot.className = 'latency-dot ' + (ms < 8 ? 'ok' : ms < 20 ? 'warn' : 'bad');
}

// ── Test tone ─────────────────────────────────────────────────────────────────
let _testOsc = null;
function handleTestTone() {
  const btn = document.getElementById('asTestBtn');
  if (_testOsc) {
    _testOsc.stop(); _testOsc = null;
    btn.classList.remove('active'); btn.textContent = 'test tone';
    setStatus('asOutputStatus', 'idle', 'no output active');
    return;
  }
  try {
    const ctx = S.audioCtx || new AudioContext();
    if (!S.audioCtx) S.audioCtx = ctx;
    _testOsc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = dbToLinear(as.outputGain) * 0.3;
    _testOsc.frequency.value = 1000;
    _testOsc.connect(g);
    g.connect(ctx.destination); // test tone intentionally goes to output
    _testOsc.start();
    btn.classList.add('active'); btn.textContent = 'stop test';
    setStatus('asOutputStatus', 'warn', '1 kHz test tone playing…');
    setTimeout(() => {
      if (_testOsc) {
        _testOsc.stop(); _testOsc = null;
        btn.classList.remove('active'); btn.textContent = 'test tone';
        setStatus('asOutputStatus', 'idle', 'no output active');
      }
    }, 3000);
  } catch(e) {
    setStatus('asOutputStatus', 'error', `test tone failed: ${e.message}`);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
export function initAudioSettings() {
  // Modal open/close
  const modal     = document.getElementById('audioSettingsModal');
  const openBtn   = document.getElementById('audioSettingsBtn');
  const closeBtn  = document.getElementById('audioSettingsClose');
  if (modal && openBtn) {
    openBtn.addEventListener('click',  () => modal.classList.add('open'));
    closeBtn.addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
  }

  // Input gain
  document.getElementById('asInputGain')?.addEventListener('input', e => {
    as.inputGain = parseFloat(e.target.value);
    const lbl = document.getElementById('asInputGainVal');
    if (lbl) lbl.textContent = formatDb(as.inputGain);
    if (as.gainNodeIn) as.gainNodeIn.gain.value = dbToLinear(as.inputGain);
  });

  // Output gain
  document.getElementById('asOutputGain')?.addEventListener('input', e => {
    as.outputGain = parseFloat(e.target.value);
    const lbl = document.getElementById('asOutputGainVal');
    if (lbl) lbl.textContent = formatDb(as.outputGain);
  });

  // Channel change while running
  document.getElementById('asInputChannel')?.addEventListener('change', e => {
    if (as.started) {
      buildInputGraph(e.target.value);
      const lbl = e.target.value === 'stereo' ? 'stereo' : `ch ${parseInt(e.target.value) + 1}`;
      setStatus('asInputStatus', 'ok', `active — ${lbl} — ${S.audioCtx?.sampleRate} Hz`);
    }
  });

  // Latency
  document.getElementById('asBufferSize')?.addEventListener('change', updateLatency);
  document.getElementById('asSampleRate')?.addEventListener('change', updateLatency);
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
    const bs = document.getElementById('asBufferSize');
    const sr = document.getElementById('asSampleRate');
    if (ig) ig.value = 0;
    if (og) og.value = -6;
    if (iv) iv.textContent = '0.0 dB';
    if (ov) ov.textContent = '−6.0 dB';
    if (ch) ch.value = '0';
    if (bs) bs.value = 256;
    if (sr) sr.value = 48000;
    updateLatency();
  });
}
