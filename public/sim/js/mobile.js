// ============================================================================
// MOBILE MODE — orientation tracking, touch handlers, settings panel
// ============================================================================

import { S, LIVE_PAINT_COLORS, PRESETS } from './state.js';
import { qFromAxisAngle, qNormalize, qMul } from './sphere.js';
import { ensureAudioContext, requestMicAccess, startLiveRecording, stopLiveRecording } from './audio.js';
import { recordStrokeStart } from './ui-samples.js';
import { selectPreset } from './ui-presets.js';

// ── Orientation state (module-private) ───────────────────────────────────────
let orientationYawAxis   = 'beta';
let orientationPitchAxis = 'alpha';
let ORIENTATION_YAW_SIGN   = -1;
let ORIENTATION_PITCH_SIGN = -1;
let lastRotationRate = { alpha: 0, beta: 0, gamma: 0 };
let refreshMobileOrientationUI = null;

function applyOrientationPreset(isLandscape) {
  if (isLandscape) {
    orientationYawAxis     = 'alpha';
    ORIENTATION_YAW_SIGN   = -1;
    orientationPitchAxis   = 'beta';
    ORIENTATION_PITCH_SIGN =  1;
  } else {
    orientationYawAxis     = 'beta';
    ORIENTATION_YAW_SIGN   = -1;
    orientationPitchAxis   = 'alpha';
    ORIENTATION_PITCH_SIGN = -1;
  }
  const ySel = document.getElementById('mobYawAxis');
  const pSel = document.getElementById('mobPitchAxis');
  if (ySel) ySel.value = orientationYawAxis;
  if (pSel) pSel.value = orientationPitchAxis;
  if (refreshMobileOrientationUI) refreshMobileOrientationUI();
}

function calibrateOrientation() {
  S.camQ = [1, 0, 0, 0];
}

let _orientationTrackingStarted = false;
function startOrientationTracking() {
  if (_orientationTrackingStarted) return;
  _orientationTrackingStarted = true;
  window.addEventListener('devicemotion', e => {
    if (!e.rotationRate || e.rotationRate.beta === null) return;
    const dt = Math.min(e.interval || 16, 50) / 1000;

    lastRotationRate = {
      alpha: e.rotationRate.alpha ?? 0,
      beta:  e.rotationRate.beta  ?? 0,
      gamma: e.rotationRate.gamma ?? 0
    };

    const rawYaw   = lastRotationRate[orientationYawAxis]   ?? 0;
    const rawPitch = lastRotationRate[orientationPitchAxis] ?? 0;

    const dYaw   = rawYaw   * dt * ORIENTATION_YAW_SIGN   * (Math.PI / 180);
    const dPitch = rawPitch * dt * ORIENTATION_PITCH_SIGN * (Math.PI / 180);

    const qDY = qFromAxisAngle(0, 1, 0, dYaw);
    const qDP = qFromAxisAngle(1, 0, 0, dPitch);

    S.camQ = qNormalize(qMul(qDY, qMul(S.camQ, qDP)));
    S.orientationActive = true;
    S.mouseInCanvas = true;
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initMobileMode() {
  document.body.classList.add('mobile-mode');
  selectPreset(PRESETS.findIndex(p => p.name === 'wash') || 0);

  const wrapper = document.getElementById('canvasWrapper');
  wrapper.insertAdjacentHTML('beforeend', `
    <div id="mobileOverlay">
      <button id="mobileEnterBtn">
        <div class="enter-ring">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
        </div>
        <div class="enter-label">tap to begin</div>
      </button>
      <div id="mobileTapHint" style="display:none">hold to record</div>
    </div>
    <button id="mobileRecalibBtn">⊕ recalibrate</button>

    <div id="mobileSettingsPanel">
      <div class="mob-panel-title">live sensor  (deg / s)</div>
      <div class="mob-row">
        <span class="mob-label">alpha</span>
        <span class="mob-readout" id="mobReadAlpha">0.0</span>
      </div>
      <div class="mob-row">
        <span class="mob-label">beta</span>
        <span class="mob-readout" id="mobReadBeta">0.0</span>
      </div>
      <div class="mob-row">
        <span class="mob-label">gamma</span>
        <span class="mob-readout" id="mobReadGamma">0.0</span>
      </div>

      <hr class="mob-divider">
      <div class="mob-panel-title">axis mapping</div>

      <div class="mob-row">
        <span class="mob-label">yaw ↔</span>
        <select class="mob-sel" id="mobYawAxis">
          <option value="beta">beta</option>
          <option value="gamma">gamma</option>
          <option value="alpha">alpha</option>
        </select>
        <button class="mob-sign" id="mobYawSign">−</button>
      </div>
      <div class="mob-row">
        <span class="mob-label">pitch ↕</span>
        <select class="mob-sel" id="mobPitchAxis">
          <option value="gamma">gamma</option>
          <option value="beta">beta</option>
          <option value="alpha">alpha</option>
        </select>
        <button class="mob-sign" id="mobPitchSign">+</button>
      </div>

      <hr class="mob-divider">
      <div class="mob-panel-title">audio devices</div>
      <div class="mob-row">
        <span class="mob-label">mic in</span>
        <select class="mob-sel" id="mobMicSelect"><option value="">— default —</option></select>
      </div>
      <div class="mob-row">
        <span class="mob-label">output</span>
        <select class="mob-sel" id="mobOutSelect"><option value="">— default —</option></select>
      </div>
      <div id="mobDeviceStatus" style="font-size:0.65rem;color:#666;text-align:right;margin-top:-0.2rem;"></div>

      <hr class="mob-divider">
      <button class="mob-big-btn" id="mobZeroBtn">⊕  zero / recalibrate</button>
      <button class="mob-big-btn" id="mobCloseSettings">close</button>
    </div>
  `);

  document.body.insertAdjacentHTML('beforeend', `<button id="mobileSettingsBtn">⚙</button>`);
  document.getElementById('mobileSettingsBtn').style.display = 'block';

  document.getElementById('mobileRecalibBtn').addEventListener('click', calibrateOrientation);
  document.getElementById('mobileEnterBtn').addEventListener('click', enterMobileFullscreen);
  document.getElementById('mobileFullscreenBtn').addEventListener('click', _toggleMobileFullscreen);
  document.addEventListener('fullscreenchange',       _onMobileFullscreenChange);
  document.addEventListener('webkitfullscreenchange', _onMobileFullscreenChange);
  setupMobileSettings();
  setupMobileTouchHandlers();
}

function setupMobileSettings() {
  const panel       = document.getElementById('mobileSettingsPanel');
  const settingsBtn = document.getElementById('mobileSettingsBtn');
  const closeBtn    = document.getElementById('mobCloseSettings');
  const zeroBtn     = document.getElementById('mobZeroBtn');
  const yawSel      = document.getElementById('mobYawAxis');
  const pitchSel    = document.getElementById('mobPitchAxis');
  const yawSignBtn  = document.getElementById('mobYawSign');
  const pitchSignBtn = document.getElementById('mobPitchSign');

  yawSel.value   = orientationYawAxis;
  pitchSel.value = orientationPitchAxis;
  refreshSignBtns();

  settingsBtn.addEventListener('click', () => panel.classList.toggle('open'));
  closeBtn.addEventListener('click',    () => panel.classList.remove('open'));
  zeroBtn.addEventListener('click',     () => { calibrateOrientation(); panel.classList.remove('open'); });

  yawSel.addEventListener('change',   () => { orientationYawAxis   = yawSel.value; });
  pitchSel.addEventListener('change', () => { orientationPitchAxis = pitchSel.value; });

  yawSignBtn.addEventListener('click', () => {
    ORIENTATION_YAW_SIGN *= -1;
    refreshSignBtns();
  });
  pitchSignBtn.addEventListener('click', () => {
    ORIENTATION_PITCH_SIGN *= -1;
    refreshSignBtns();
  });

  function refreshSignBtns() {
    yawSignBtn.textContent = ORIENTATION_YAW_SIGN > 0 ? '+' : '−';
    yawSignBtn.classList.toggle('neg', ORIENTATION_YAW_SIGN < 0);
    pitchSignBtn.textContent = ORIENTATION_PITCH_SIGN > 0 ? '+' : '−';
    pitchSignBtn.classList.toggle('neg', ORIENTATION_PITCH_SIGN < 0);
  }
  refreshMobileOrientationUI = refreshSignBtns;

  // Live readout at ~10 Hz while panel is open
  setInterval(() => {
    if (!panel.classList.contains('open')) return;
    const r = lastRotationRate;
    document.getElementById('mobReadAlpha').textContent = r.alpha.toFixed(1);
    document.getElementById('mobReadBeta').textContent  = r.beta.toFixed(1);
    document.getElementById('mobReadGamma').textContent = r.gamma.toFixed(1);
  }, 100);

  // ── Audio device picker ───────────────────────────────────────────────────
  const micSel    = document.getElementById('mobMicSelect');
  const outSel    = document.getElementById('mobOutSelect');
  const devStatus = document.getElementById('mobDeviceStatus');

  async function refreshDeviceLists() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    let devices;
    try { devices = await navigator.mediaDevices.enumerateDevices(); } catch(_) { return; }

    const inputs  = devices.filter(d => d.kind === 'audioinput');
    const outputs = devices.filter(d => d.kind === 'audiooutput');

    const prevMic = micSel.value;
    const prevOut = outSel.value;

    micSel.innerHTML = '<option value="">— default —</option>' +
      inputs.map(d => `<option value="${d.deviceId}">${d.label || 'mic ' + d.deviceId.slice(0,6)}</option>`).join('');
    outSel.innerHTML = '<option value="">— default —</option>' +
      outputs.map(d => `<option value="${d.deviceId}">${d.label || 'out ' + d.deviceId.slice(0,6)}</option>`).join('');

    if ([...micSel.options].some(o => o.value === prevMic)) micSel.value = prevMic;
    if ([...outSel.options].some(o => o.value === prevOut)) outSel.value = prevOut;

    outSel.parentElement.style.display = (typeof Audio !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype) ? '' : 'none';
  }

  micSel.addEventListener('change', async () => {
    const deviceId = micSel.value;
    devStatus.textContent = 'switching mic…';
    if (S.recordingStream) { S.recordingStream.getTracks().forEach(t => t.stop()); S.recordingStream = null; }
    if (window._micMonitorSrc) { try { window._micMonitorSrc.disconnect(); } catch(_) {} window._micMonitorSrc = null; }
    S.micPermissionGranted = false;

    try {
      S.recordingStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId:         deviceId ? { exact: deviceId } : undefined,
          sampleRate:       22050,
          channelCount:     1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl:  false,
        }
      });
      S.micPermissionGranted = true;
      const actx = ensureAudioContext();
      const monSrc = actx.createMediaStreamSource(S.recordingStream);
      S.inputGainNode = S.inputGainNode || (() => { const g = actx.createGain(); g.gain.value = S.inputGainValue; return g; })();
      S.inputAnalyser = S.inputAnalyser || (() => { const a = actx.createAnalyser(); a.fftSize = 256; a.smoothingTimeConstant = 0.6; return a; })();
      monSrc.connect(S.inputGainNode);
      S.inputGainNode.connect(S.inputAnalyser);
      window._micMonitorSrc = monSrc;
      devStatus.textContent = 'mic ready ✓';
    } catch(e) {
      devStatus.textContent = 'mic error: ' + e.message;
    }
  });

  outSel.addEventListener('change', async () => {
    const deviceId = outSel.value;
    devStatus.textContent = 'switching output…';
    const audioEl = window._mobileSpeakerAudio;
    if (audioEl && 'setSinkId' in audioEl) {
      try {
        await audioEl.setSinkId(deviceId || '');
        devStatus.textContent = 'output switched ✓';
      } catch(e) {
        devStatus.textContent = 'output error: ' + e.message;
      }
    } else {
      devStatus.textContent = 'output switch not supported';
    }
  });

  settingsBtn.addEventListener('click', () => { if (panel.classList.contains('open')) refreshDeviceLists(); });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', refreshDeviceLists);
  }
  refreshDeviceLists();
}

let _fullscreenFallbackTimer = null;

async function enterMobileFullscreen() {
  ensureAudioContext();
  await requestMicAccess();

  const el  = document.documentElement;
  const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
  if (rfs) {
    _fullscreenFallbackTimer = setTimeout(() => _finishMobileSetup(), 2000);
    rfs.call(el).catch(() => {
      clearTimeout(_fullscreenFallbackTimer);
      _finishMobileSetup();
    });
  } else {
    _finishMobileSetup();
  }
}

function _onMobileFullscreenChange() {
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  const fsBtn = document.getElementById('mobileFullscreenBtn');
  if (fsBtn) fsBtn.textContent = isFs ? '✕' : '⛶';

  if (isFs) {
    clearTimeout(_fullscreenFallbackTimer);
    _finishMobileSetup();
  }
}

function _toggleMobileFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    const el = document.documentElement;
    const rfs = el.requestFullscreen || el.webkitRequestFullscreen;
    if (rfs) rfs.call(el).catch(() => {});
  }
}

async function _finishMobileSetup() {
  if (S._mobileSetupDone) return;
  S._mobileSetupDone = true;

  await new Promise(r => requestAnimationFrame(r));

  const isLandscape = window.innerWidth > window.innerHeight;
  applyOrientationPreset(isLandscape);

  if (screen.orientation && screen.orientation.lock) {
    const lockType = isLandscape ? 'landscape' : 'portrait';
    screen.orientation.lock(lockType).catch(() => {});
  }

  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    const perm = await DeviceMotionEvent.requestPermission().catch(() => 'denied');
    if (perm !== 'granted') { S._mobileSetupDone = false; return; }
  }

  startOrientationTracking();
  calibrateOrientation();

  document.getElementById('mobileEnterBtn').style.display       = 'none';
  document.getElementById('mobileTapHint').style.display        = 'block';
  document.getElementById('mobileRecalibBtn').style.display     = 'block';
  document.getElementById('mobileFullscreenBtn').style.display  = 'inline-flex';

  S.mousePixelX = S.canvas.width  / 2;
  S.mousePixelY = S.canvas.height / 2;
  S.mouseInCanvas = true;
}

function setupMobileTouchHandlers() {
  function lockCursorToCenter() {
    S.mousePixelX   = S.canvas.width  / 2;
    S.mousePixelY   = S.canvas.height / 2;
    S.mouseInCanvas = true;
  }
  lockCursorToCenter();

  S.canvas.addEventListener('touchstart', async e => {
    e.preventDefault();
    lockCursorToCenter();

    if (!S._mobileSetupDone) return;

    const hint = document.getElementById('mobileTapHint');
    if (hint) hint.style.display = 'none';

    ensureAudioContext();
    if (!S.micPermissionGranted) {
      await requestMicAccess();
      if (!S.micPermissionGranted) return;
    }

    startLiveRecording();
    recordStrokeStart('live', S.currentLiveBufferIdx);
    S.isPainting      = true;
    S.paintFrameCount = 0;
    S.updateLiveRecUI?.();
  }, { passive: false });

  S.canvas.addEventListener('touchmove', e => {
    e.preventDefault();
  }, { passive: false });

  S.canvas.addEventListener('touchend', e => {
    e.preventDefault();
    S.isPainting      = false;
    S.currentStrokeId = -1;
    S.liveColorIndex  = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
    S.updateLiveRecUI?.();
    if (S.isRecording) {
      const captureStart = S.recordingStartTime;
      setTimeout(() => {
        if (S.isRecording && S.recordingStartTime === captureStart) {
          stopLiveRecording();
        }
      }, 200);
    }
  }, { passive: false });
}
