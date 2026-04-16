// ============================================================================
// MAIN — entry point: wire up all modules and start the app
// ============================================================================

import { S, DEBUG, EXP, GRAIN_SCHEDULER_INTERVAL_MS } from './state.js';
import { showWaveformOverlay } from './debug-waveform.js';
import { scheduleGrains } from './grain.js';
import { setupEvents, setupDragDrop } from './events.js';
import { rebuildSampleListUI, buildSvTabs, drawSvWaveform, initUndoBtn } from './ui-samples.js';
import {
  setupPresets, initGrainControls, initDesktopMorph,
  drawPresetWaveform, updatePlaybackControls, selectPreset,
} from './ui-presets.js';
import { setupMappingModal, initMidi } from './midi.js';
import { initMobileMode } from './mobile.js';
import { initQuadBuses, initSpeakerBuses, requestMicAccess } from './audio.js';
import { resizeCanvas, animate } from './renderer.js';
import { startMainMetering, rebuildMainOutputMeters, initScanToggle, initMorphToggle, initRadiusFade, initSeqMode, initMixdownGains, initDryMonitorGains, setScanMuted, initGateMeter } from './ui-meters.js';
import { initSensor, getSensorCamQ, getSensorCursorQ, getFrameQ, recenterCursor, assignQuatRole } from './sensor-registry.js';
import { initOSC } from './osc.js';
import { initAudioSettings, loadAudioDefaults, activateSavedInputDevice, startAutoSave } from './ui-audio-settings.js';

import { initImprovUI } from './ui-improv.js';
import { initVizUI } from './ui-viz.js';
import { initSweepUI, initSessionPanel } from './ui-sweep.js';
import { initExportImport } from './ui-export.js';
import { initPatchTable } from './ui-patch-table.js';
import { initMappingUI } from './ui-sensor-mapping.js';
import { initIMUSetupUI } from './ui-imu-setup.js';
import { qMul, qNormalize, qFromAxisAngle, qRotateVec } from './sphere.js';
import { startPaintTicker, getPaintTickerState } from './paint-ticker.js';
import {
  startWorkletGrain, stopWorkletGrain, updateWorkletParams,
  isCrossOriginIsolated, hotSwapRecording, getWorkletDiag,
  isWorkletGrainActive,
} from './grain-worklet-bridge.js';


// ── Worklet grain engine — always-on startup/management ─────────────────────
// Moved from exp-init.js (Phase 5): worklet is now the only grain engine.
// Auto-starts on first recording. Sliders drive the worklet directly.

async function _startWorkletEngine(buf, opts = {}) {
  if (!S.audioCtx) {
    console.warn('worklet: no AudioContext');
    return false;
  }
  const ov = S.grainOverrides;
  const base = S.grainParams || {};
  const DIR_MAP  = { fwd: 0, rev: 1, rand: 2 };
  const CURVE_MAP = { hann: 0, tri: 1, rect: 2 };

  console.log(`worklet: starting — ${(buf.length / buf.sampleRate).toFixed(1)}s buffer, 256-slot pool`);

  const node = await startWorkletGrain(S.audioCtx, buf, {
    period:           opts.period           ?? ov.period           ?? base.period           ?? 0.050,
    duration:         opts.duration         ?? ov.duration         ?? base.duration         ?? 0.100,
    grainStart:       opts.grainStart       ?? Math.floor(buf.length * 0.25),
    volume:           opts.volume           ?? ov.volume           ?? base.volume           ?? 0.6,
    pitchShift:       opts.pitchShift       ?? ov.pitchShift       ?? base.pitchShift       ?? 0,
    pitchJitter:      opts.pitchJitter      ?? ov.pitchJitter      ?? base.pitchJitter      ?? 0,
    periodVar:        opts.periodVar        ?? ov.periodVar        ?? base.periodVar        ?? 0,
    durVar:           opts.durVar           ?? ov.durVar           ?? base.durVar           ?? 0,
    durJitter:        opts.durJitter        ?? ov.durJitter        ?? base.durJitter        ?? 0,
    envShape:         opts.envShape         ?? CURVE_MAP[S.grainCurveType] ?? 0,
    probability:      opts.probability      ?? S.grainProbability ?? 1.0,
    direction:        opts.direction        ?? DIR_MAP[S.grainDirection] ?? 0,
    hpfFreq:          opts.hpfFreq          ?? ov.hpfFreq          ?? base.hpfFreq          ?? 20,
    lpfFreq:          opts.lpfFreq          ?? ov.lpfFreq          ?? base.lpfFreq          ?? 20000,
    filterQ:          opts.filterQ          ?? ov.filterQ          ?? base.filterQ          ?? 0.707,
    filterFreqJitter: opts.filterFreqJitter ?? ov.filterFreqJitter ?? base.filterFreqJitter ?? 0,
    kSeqMode:         S.grainKSeqMode ?? false,
  }, {
    numChannels: S.speakerBuses?.numChannels || S.audioCtx.destination.channelCount || 2,
    onFeedback: (data) => {
      if (opts.verbose) {
        console.log(`worklet: ${data.activeCount} active grains, ${data.grains.length} fired`);
      }
    },
  });
  if (node) {
    console.log('worklet: engine running — sliders drive it directly');
    return true;
  }
  console.warn('worklet: failed to start — check console for errors');
  return false;
}

function _stopWorkletEngine() {
  stopWorkletGrain();
}

// Restart the worklet with the current buffers but a new channel count.
// Called via S._restartWorkletEngine when the output device changes.
async function _restartWorkletEngine() {
  if (!isWorkletGrainActive()) return;
  // Grab the most recent recording buffer to use as primary SAB
  const buffers = S.liveRecBuffers?.filter(b => b?.buffer) ?? [];
  const buf = buffers.length > 0 ? buffers[buffers.length - 1].buffer : null;
  if (!buf) return;

  console.log(`worklet: restarting for channel count change (${S.speakerBuses?.numChannels ?? 2} ch)`);
  _stopWorkletEngine();
  await _startWorkletEngine(buf);

  // Re-send all additional recording buffers (hot-swap each one)
  for (let i = 0; i < buffers.length - 1; i++) {
    hotSwapRecording(buffers[i].buffer);
  }
}

function init() {
  // Forward main-process logs to DevTools console
  if (window.electronBridge?.onMainLog) {
    window.electronBridge.onMainLog((level, msg) => {
      (console[level] || console.log)(`[main] ${msg}`);
    });
  }

  S.canvas = document.getElementById('sphereCanvas');
  S.ctx    = S.canvas.getContext('2d');

  resizeCanvas();
  setupEvents();
  setupDragDrop();
  loadAudioDefaults();   // restore saved settings before any UI init
  rebuildSampleListUI();
  S.updateLiveRecUI?.();
  setupPresets();
  initGrainControls();
  initDesktopMorph();
  setupMappingModal();
  initMidi();
  // Prompt for mic permission on load — but skip in Electron where RtAudio
  // handles input (getUserMedia always fails there → spurious "mic denied").
  // Electron input is activated asynchronously below via activateSavedInputDevice.
  if (!window.electronBridge?.isElectron) {
    requestMicAccess();
  }
  if (S.isMobile) initMobileMode();

  // Sensor + OSC + audio settings
  initSensor();
  initOSC();   // connects Electron IPC or browser WebSocket transport
  S._getSensorCamQ    = getSensorCamQ;       // hook renderer without a circular import
  S._getSensorCursorQ = getSensorCursorQ;    // detethered cursor quat (two-IMU mode)
  S._getFrameQ        = getFrameQ;           // world-frame compensation from frame-role sensor
  S._recenterCursor   = recenterCursor;      // drift correction — called from sensors UI
  S._onTare = () => {                        // reset drift correction on fresh tare
    S.driftOffsetQ = null;
  };

  // ── IMU-driven cursor freshness ──────────────────────────────────────────
  // On every cursor-role quaternion arrival (up to 400Hz), update S.cursorQ
  // so the paint ticker's 200Hz poll reads a fresh position.
  S._onCursorQuatArrival = () => {
    if (S.cameraMode !== 'sensor') return;

    // Same transforms as the render loop: drift correction + axis locks.
    // Idempotent — the render loop will overwrite at 30fps for visuals.
    const cq = getSensorCursorQ();   // non-null in detethered two-IMU mode
    const sq = getSensorCamQ();      // non-null in single-IMU mode

    if (cq) {
      let q = cq;
      if (S.driftOffsetQ) q = qNormalize(qMul(S.driftOffsetQ, q));
      if (S.axisLockAz || S.axisLockEl) {
        const fwd = qRotateVec(q, [0, 0, 1]);
        let yaw   = Math.atan2(fwd[0], fwd[2]);
        let pitch = Math.asin(Math.max(-1, Math.min(1, -fwd[1])));
        if (S.axisLockAz && S._axisLockFrozenYaw != null) yaw = S._axisLockFrozenYaw;
        if (S.axisLockEl && S._axisLockFrozenPitch != null) pitch = S._axisLockFrozenPitch;
        const qY = qFromAxisAngle(0, 1, 0, yaw);
        const qP = qFromAxisAngle(1, 0, 0, pitch);
        S.cursorQ = qNormalize(qMul(qY, qP));
      } else {
        S.cursorQ = q;
      }
    } else if (sq) {
      let q = sq;
      if (S.driftOffsetQ) q = qNormalize(qMul(S.driftOffsetQ, q));
      if (S.axisLockAz || S.axisLockEl) {
        const fwd = qRotateVec(q, [0, 0, 1]);
        let yaw   = Math.atan2(fwd[0], fwd[2]);
        let pitch = Math.asin(Math.max(-1, Math.min(1, -fwd[1])));
        if (S.axisLockAz && S._axisLockFrozenYaw != null) yaw = S._axisLockFrozenYaw;
        if (S.axisLockEl && S._axisLockFrozenPitch != null) pitch = S._axisLockFrozenPitch;
        const qY = qFromAxisAngle(0, 1, 0, yaw);
        const qP = qFromAxisAngle(1, 0, 0, pitch);
        S.camQ = qNormalize(qMul(qY, qP));
      } else {
        S.camQ = q;
      }
    }
  };

  // Paint ticker: single 200Hz timer polls cursor position and deposits
  // particles via adaptive angular spacing. Works identically for all modes.
  startPaintTicker();
  window.paintTicker = getPaintTickerState;

  initMappingUI();
  initIMUSetupUI();
  initAudioSettings();
  initImprovUI();
  initVizUI();
  initSweepUI();
  initSessionPanel();
  initUndoBtn();
  initExportImport();
  initPatchTable(updatePlaybackControls, setScanMuted, selectPreset);
  startAutoSave();       // begin 2s dirty-check auto-persist for settings

  // ── Collapsible panels ───────────────────────────────────────────────────
  // Click any device-label to collapse/expand its body. State persists in
  // localStorage so panels stay collapsed across reloads.

  // Helper: get the panel key from a device element
  function _panelKey(device) { return device?.className.match(/device--(\S+)/)?.[1]; }

  // Helper: save current panel order to localStorage
  function _savePanelOrder() {
    const panel = document.querySelector('.right-panel');
    if (!panel) return;
    const order = [...panel.querySelectorAll('.device')]
      .map(d => _panelKey(d)).filter(Boolean);
    localStorage.setItem('mubone_panel_order', JSON.stringify(order));
  }

  // Restore saved panel order on load
  try {
    const saved = JSON.parse(localStorage.getItem('mubone_panel_order'));
    if (saved && Array.isArray(saved)) {
      const panel = document.querySelector('.right-panel');
      if (panel) {
        const devices = new Map();
        panel.querySelectorAll('.device').forEach(d => {
          const k = _panelKey(d);
          if (k) devices.set(k, d);
        });
        // re-append in saved order (unsaved devices stay at end)
        for (const k of saved) {
          const d = devices.get(k);
          if (d) { panel.appendChild(d); devices.delete(k); }
        }
        for (const d of devices.values()) panel.appendChild(d);
      }
    }
  } catch (_) {
    // Corrupt panel order JSON — remove so it doesn't fail repeatedly
    try { localStorage.removeItem('mubone_panel_order'); } catch (_2) {}
  }

  for (const label of document.querySelectorAll('.device-label')) {
    const device = label.closest('.device');
    if (!device) continue;
    const key = _panelKey(device);
    if (key && localStorage.getItem(`mubone_panel_${key}`) === '1') device.classList.add('collapsed');
    label.addEventListener('click', (e) => {
      // don't collapse when clicking reorder arrows
      if (e.target.closest('.device-reorder')) return;
      device.classList.toggle('collapsed');
      if (key) localStorage.setItem(`mubone_panel_${key}`, device.classList.contains('collapsed') ? '1' : '0');
    });

    // Reorder arrows
    const wrap = document.createElement('span');
    wrap.className = 'device-reorder';
    const upBtn = document.createElement('button');
    upBtn.className = 'device-reorder-btn';
    upBtn.textContent = '▲';
    upBtn.title = 'move panel up';
    const dnBtn = document.createElement('button');
    dnBtn.className = 'device-reorder-btn';
    dnBtn.textContent = '▼';
    dnBtn.title = 'move panel down';
    upBtn.addEventListener('click', () => {
      const prev = device.previousElementSibling;
      if (prev) { device.parentNode.insertBefore(device, prev); _savePanelOrder(); }
    });
    dnBtn.addEventListener('click', () => {
      const next = device.nextElementSibling;
      if (next) { next.parentNode.insertBefore(next, device); _savePanelOrder(); }
    });
    wrap.appendChild(upBtn);
    wrap.appendChild(dnBtn);
    label.appendChild(wrap);
  }

  // ── Collapsible sections (within devices) ─────────────────────────────
  // Click section-toggle labels to collapse/expand subsections.
  for (const section of document.querySelectorAll('.seq-section--collapsible')) {
    const key = section.dataset.collapseKey;
    if (key && localStorage.getItem(`mubone_sec_${key}`) === '1') section.classList.add('collapsed');
    const toggle = section.querySelector('.seq-section-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        section.classList.toggle('collapsed');
        if (key) localStorage.setItem(`mubone_sec_${key}`, section.classList.contains('collapsed') ? '1' : '0');
      });
    }
  }

  // ── Factory reset ──────────────────────────────────────────────────────────
  function _showResetDialog(title, desc, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'factory-reset-overlay';
    overlay.innerHTML = `
      <div class="factory-reset-dialog">
        <div class="factory-reset-title">${title}</div>
        <p class="factory-reset-desc">${desc}</p>
        <div class="factory-reset-btns">
          <button class="factory-reset-btn factory-reset-cancel">cancel</button>
          <button class="factory-reset-btn factory-reset-confirm">reset</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.factory-reset-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('.factory-reset-confirm').addEventListener('click', () => {
      onConfirm();
      location.reload();
    });
  }

  // Factory reset — nuclear, clears everything (with option to keep patches)
  document.getElementById('factoryResetBtn')?.addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'factory-reset-overlay';
    overlay.innerHTML = `
      <div class="factory-reset-dialog">
        <div class="factory-reset-title">factory reset</div>
        <p class="factory-reset-desc">Clears <strong>everything</strong> — settings, mappings, calibration. Back to day one.</p>
        <label class="factory-reset-check">
          <input type="checkbox" id="keepPatchesChk" checked>
          <span>keep my patches</span>
        </label>
        <div class="factory-reset-btns">
          <button class="factory-reset-btn factory-reset-cancel">cancel</button>
          <button class="factory-reset-btn factory-reset-confirm">reset</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.factory-reset-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('.factory-reset-confirm').addEventListener('click', () => {
      const keepPatches = overlay.querySelector('#keepPatchesChk').checked;
      const savedPresets = keepPatches ? localStorage.getItem('mubone_user_presets') : null;
      localStorage.clear();
      if (savedPresets) localStorage.setItem('mubone_user_presets', savedPresets);
      location.reload();
    });
  });

  // When speaker buses are (re)initialised, rebuild the main-window output meters.
  // Using a callback on S avoids a circular import between audio.js and ui-meters.js.
  // S._rebuildMainOutputMeters is also set inside startMainMetering() for the renderer shim.
  S._onSpeakerBusesReady = () => rebuildMainOutputMeters();

  // ── Sample instrument modal ──────────────────────────────────────────────────
  const sampleModal    = document.getElementById('sampleModal');
  const sampleOpenBtn  = document.getElementById('bottomPanelToggleBtn');
  const sampleCloseBtn = document.getElementById('sampleModalClose');
  if (sampleModal && sampleOpenBtn) {
    sampleOpenBtn.addEventListener('click', () => {
      const opening = !sampleModal.classList.contains('open');
      sampleModal.classList.toggle('open', opening);
      sampleOpenBtn.classList.toggle('open', opening);
      // Rebuild all slot waveforms + sv display when the panel opens —
      // samples loaded while the panel was closed have zero-size canvases.
      // Double-rAF: first rAF triggers layout of the newly-visible modal,
      // second rAF runs after elements have real dimensions.
      if (opening) requestAnimationFrame(() => requestAnimationFrame(() => {
        rebuildSampleListUI();
      }));
    });
    sampleCloseBtn?.addEventListener('click', () => {
      sampleModal.classList.remove('open');
      sampleOpenBtn.classList.remove('open');
    });
    // Click backdrop to close
    sampleModal.addEventListener('click', e => {
      if (e.target === sampleModal) {
        sampleModal.classList.remove('open');
        sampleOpenBtn.classList.remove('open');
      }
    });
  }

  // ── Camera mode modal ──────────────────────────────────────────────────────
  // Camera mode: pull / surface / sensor (independent of audio spatialization)
  const cameraModal    = document.getElementById('cameraModal');
  const cameraModeBtn  = document.getElementById('cameraModeBtn');
  const cameraCloseBtn = document.getElementById('cameraModalClose');

  function updateCameraModeBtn() {
    const label = cameraModeBtn?.querySelector('.camera-mode-label');
    if (label) label.textContent = S.cameraMode;
    // Update active state on modal buttons
    cameraModal?.querySelectorAll('.camera-mode-option').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === S.cameraMode);
    });
    // Dynamic subtitle for sensor mode — shows 1-sensor vs 2-sensor state
    const sub = cameraModal?.querySelector('.camera-sensor-subtitle');
    if (sub) {
      if (S.cameraMode === 'sensor') {
        sub.textContent = S.detethered
          ? '2 sensors — cursor free'
          : '1 sensor — cursor locked';
        sub.style.display = '';
      } else {
        sub.style.display = 'none';
      }
    }
  }

  function applyCameraMode(mode) {
    S.cameraMode = mode;
    updateCameraModeBtn();

    // Clear alt-lock when switching modes to avoid stale state
    if (S.altLocked) {
      S.altLocked = false;
      const ind = document.getElementById('altLockIndicator');
      if (ind) ind.style.display = 'none';
    }

    if (mode === 'surface') {
      // Reset camera to canonical forward and surface position to center
      S.camQ = [0, 0, 0, 1];
      S._resetSurfacePosition?.();
      // Request pointer lock (the modal click qualifies as a user gesture)
      S._requestSurfaceLock?.();
    } else if (mode === 'sensor') {
      // Exit pointer lock + overlay if leaving surface mode
      S._exitSurfaceLock?.();
      S._hideSurfaceOverlay?.();
      // Sensor: hide cursor, mouse is free for UI
      if (S.canvas) S.canvas.style.cursor = 'none';
    } else {
      // Exit pointer lock + overlay if leaving surface mode
      S._exitSurfaceLock?.();
      S._hideSurfaceOverlay?.();
      // Pull: show cursor
      if (S.canvas) S.canvas.style.cursor = '';
    }

    DEBUG && console.log(`[camera] mode: ${S.cameraMode}`);
  }

  if (cameraModeBtn && cameraModal) {
    cameraModeBtn.addEventListener('click', () => {
      updateCameraModeBtn();  // refresh subtitle with current sensor state
      cameraModal.classList.add('open');
    });
    cameraCloseBtn?.addEventListener('click', () => {
      cameraModal.classList.remove('open');
    });
    cameraModal.addEventListener('click', e => {
      if (e.target === cameraModal) cameraModal.classList.remove('open');
    });
    // Mode option buttons
    cameraModal.querySelectorAll('.camera-mode-option').forEach(btn => {
      btn.addEventListener('click', () => {
        applyCameraMode(btn.dataset.mode);
        cameraModal.classList.remove('open');
      });
    });
  }
  S._setCameraMode = applyCameraMode;
  updateCameraModeBtn();

  // If surface mode was persisted, reset camera and show re-enter overlay
  // (pointer lock can't be requested without a user gesture on page load)
  if (S.cameraMode === 'surface') {
    S.camQ = [0, 0, 0, 1];
    S._showSurfaceOverlay?.();
  }

  // ── Spatial panning (in audio settings output section) ────────────────────
  const spatialPanningSel  = document.getElementById('asSpatialPanningSel');
  const spatialPanningNote = document.getElementById('asSpatialPanningNote');

  function updateSpatialPanningUI() {
    if (spatialPanningSel) spatialPanningSel.value = S.spatialPanning;
    if (spatialPanningNote) {
      spatialPanningNote.textContent = S.spatialPanning === 'worldlocked'
        ? 'sounds fixed in room' : 'sound rotates with camera';
    }
  }

  function applySpatialPanning(mode) {
    S.spatialPanning = mode;
    updateSpatialPanningUI();
    DEBUG && console.log(`[spatial] panning: ${S.spatialPanning}`);
  }

  if (spatialPanningSel) {
    spatialPanningSel.addEventListener('change', () => {
      applySpatialPanning(spatialPanningSel.value);
    });
  }
  S._setSpatialPanning = applySpatialPanning;
  updateSpatialPanningUI();

  // Re-size after first layout pass in case dimensions weren't settled yet
  requestAnimationFrame(() => {
    resizeCanvas();
    drawPresetWaveform();
    updatePlaybackControls();
    buildSvTabs();
    drawSvWaveform();
    animate();
    startMainMetering();  // start DOM-based VU meter loop for main window
    initGateMeter();    // wire noise gate visual meter (canvas + drag)
    initScanToggle(); // wire scan (cursor spotlight) on/off toggle
    initMorphToggle(); // wire radial morph on/off toggle (exp only)
    initRadiusFade();      // wire radius fade toggle + curve slider
    initSeqMode();         // wire sequential (loop) mode toggle
    initMixdownGains();    // wire mixdown source gain sliders
    initDryMonitorGains(); // wire dry monitor gain slider + enable checkbox
  });

  // Redraw waveforms when their containers resize (e.g. window resize or flex relayout)
  const svDisplayEl = document.getElementById('svDisplay');
  if (svDisplayEl) new ResizeObserver(() => drawSvWaveform()).observe(svDisplayEl);

  const envelopeWaveformWrap = document.querySelector('.envelope-waveform-wrap');
  if (envelopeWaveformWrap) new ResizeObserver(() => drawPresetWaveform()).observe(envelopeWaveformWrap);

  // Quad bus init — Electron only, no-op in the browser
  if (window.electronBridge?.isElectron) {
    initQuadBuses()
      .then(async () => {
        // Use saved output device if available, otherwise system default.
        const devices = await window.electronBridge.getAudioDevices();
        const savedId = S._savedOutputDeviceId;  // set by loadAudioDefaults
        const saved   = savedId != null ? devices.find(d => d.id === savedId) : null;
        const best    = saved || devices.find(d => d.isDefault) || devices[0];
        if (best) {
          const nCh = Math.min(32, best.outputChannels);  // Web Audio merger caps at 32
          await initSpeakerBuses(nCh);
          const bufFrames = S.preferredBufferSize ?? 1024;
          const result = await window.electronBridge.setAudioDevice(best.id, nCh, bufFrames, S.audioCtx?.sampleRate);
          const tag = saved ? 'saved' : 'system default';
          DEBUG && console.log(`Output: "${best.name}" (${tag}) — ${nCh} ch — streaming: ${result.streaming}`);
        } else {
          console.warn('No output devices found. Open Audio Settings to select one.');
        }

        // Auto-open saved input device and wire the full Web Audio chain
        if (window.electronBridge.setInputDevice && S._savedInputDeviceId != null) {
          const inDevices = await window.electronBridge.getInputDevices();
          const inDev     = inDevices.find(d => d.id === S._savedInputDeviceId);
          if (inDev) {
            const bufFrames = S.preferredBufferSize ?? 1024;
            const result = await window.electronBridge.setInputDevice(inDev.id, inDev.inputChannels, bufFrames, S.audioCtx?.sampleRate);
            if (result.ok) {
              DEBUG && console.log(`Input: "${inDev.name}" (saved) — ${result.nCh} ch`);
              // Wire up the worklet, analysers, and recording chain so the
              // input is fully active — not just open at the hardware level.
              await activateSavedInputDevice(result.nCh);
            }
          }
        }
      })
      .catch(e => console.warn('Quad bus init failed:', e));
  }

  // ── Sensor group — dim when no sensor connected ─────────────────────────
  // Reacts to OSC bridge status AND imu-setup device status (serial, WiFi, OSC).
  // Any connected device = "sensor connected" in the top bar.
  const _sensorGroupEl  = document.getElementById('sensorGroup');
  const _sensorStatusEl = document.getElementById('sensorGroupStatus');
  if (_sensorGroupEl) {
    let _oscBridgeUp   = false;
    let _sensorDetail  = null;   // latest sensor-status event detail

    const _updateSensorGroup = () => {
      const hasDevice = _sensorDetail?.connected || false;
      const anyUp     = _oscBridgeUp || hasDevice;
      _sensorGroupEl.classList.toggle('no-sensor', !anyUp);

      // Build status text for the label  e.g. "(serial)" or "(wifi + osc · 3)"
      if (_sensorStatusEl) {
        if (!anyUp) {
          _sensorStatusEl.textContent = '';   // CSS ::before handles "(not connected)"
        } else {
          const parts = [];
          if (_oscBridgeUp) parts.push('max');
          if (_sensorDetail?.transports) {
            for (const t of _sensorDetail.transports) {
              if (!parts.includes(t)) parts.push(t);
            }
          }
          const label = parts.join(' + ');
          const count = (_sensorDetail?.count || 0) + (_oscBridgeUp ? 1 : 0);
          _sensorStatusEl.textContent =
            count > 1 ? `(${label} · ${count})` : `(${label})`;
        }
      }
    };

    window.addEventListener('osc-connected',    () => { _oscBridgeUp = true;  _updateSensorGroup(); });
    window.addEventListener('osc-disconnected', () => { _oscBridgeUp = false; _updateSensorGroup(); });
    window.addEventListener('sensor-status', (e) => {
      _sensorDetail = e.detail;
      window._sensorConnected = e.detail?.connected;
      _updateSensorGroup();
      _rebuildSwitchBtns(e.detail);
    });

    // ── Quick-switch sensor buttons ──────────────────────────────────────
    // One button per connected+feeding sensor. Click = assign as cursor.
    const _switchBtnsEl = document.getElementById('sensorSwitchBtns');
    const _rebuildSwitchBtns = (detail) => {
      if (!_switchBtnsEl) return;
      const devices = detail?.devices;
      if (!devices || devices.length === 0) {
        _switchBtnsEl.innerHTML = '';
        return;
      }
      // Only show buttons for feeding devices (connected to sphere)
      const feedingDevs = devices.filter(d => d.feeding);
      if (feedingDevs.length < 1) {
        // No feeding sensors — nothing to show
        _switchBtnsEl.innerHTML = '';
        return;
      }
      // Build one button per feeding device
      // Use short label: device name, or number if names are identical
      const names = feedingDevs.map(d => d.name);
      const allSameName = names.every(n => n === names[0]);
      _switchBtnsEl.innerHTML = '';
      feedingDevs.forEach((d, i) => {
        const btn = document.createElement('button');
        btn.className = 'sensor-switch-btn';
        if (d.role === 'cursor') btn.classList.add('active');
        const label = allSameName
          ? `${i + 1}`
          : d.name.replace(/^x-IMU3\s*/i, '').trim() || `${i + 1}`;
        btn.textContent = label;
        btn.title = `${d.name} (${d.sn}) — click to make cursor`;
        btn.addEventListener('click', () => {
          assignQuatRole(d.slotName, 'cursor');
        });
        _switchBtnsEl.appendChild(btn);
      });
    };
  }

  // ── First-run hint ──────────────────────────────────────────────────────
  // Dismisses when the user loads a sample or enables mic input.
  const _firstRunEl = document.getElementById('firstRunHint');
  if (_firstRunEl) {
    // Skip hint if user already has samples loaded or has turned off learn mode
    const _learnOff = (() => { try { return localStorage.getItem('mubone-learn-mode') === 'off'; } catch (_) { return false; } })();
    if (S.sampleBuffers?.some(b => b) || _learnOff) {
      _firstRunEl.classList.add('hidden', 'gone');
    } else {
      S._dismissFirstRun = () => {
        if (!S._dismissFirstRun) return; // already dismissed
        _firstRunEl.classList.add('hidden');
        _firstRunEl.addEventListener('transitionend', () => _firstRunEl.classList.add('gone'), { once: true });
        window.removeEventListener('keydown', _frKeyHandler);
        S._dismissFirstRun = null;
      };
      const _frKeyHandler = (e) => {
        if ((e.key === 'Enter' || e.key === 'Escape') && S._dismissFirstRun) {
          S._dismissFirstRun();
        }
      };
      window.addEventListener('keydown', _frKeyHandler);
    }
  }

  // ── Gesture modules (always loaded) ──────────────────────────────────────
  // Gesture extraction + panel are core features, loaded for all users.
  import('./exp/gesture.js')
    .then(({ initGesture }) => initGesture())
    .catch(e => console.warn('[gesture] failed to load:', e));
  import('./exp/gesture-panel.js')
    .then(({ initGesturePanel, toggleGesturePanel }) => {
      initGesturePanel();
      // Wire the top-bar gesture button
      const gestureBtn = document.getElementById('gestureBtn');
      if (gestureBtn) gestureBtn.addEventListener('click', () => toggleGesturePanel());
      // Shift+G keyboard shortcut
      window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'G' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          toggleGesturePanel();
        }
      });
    })
    .catch(e => console.warn('[gesture-panel] failed to load:', e));

  // ── Worklet restart on output device change ────────────────────────────
  // When the user switches output devices (different channel count), the
  // AudioWorkletNode must be recreated — outputChannelCount is fixed at
  // creation time.  _onVBAPRebuilt in the bridge detects the mismatch and
  // calls this to stop + restart with the new channel count.
  S._restartWorkletEngine = _restartWorkletEngine;

  // ── Worklet grain engine: auto-start on sample paint ────────────────────
  // When the user starts painting with a sample (QWERTYUIOP keys or MIDI)
  // before any mic recording, the worklet hasn't been cold-started yet.
  // This callback bootstraps the worklet using the sample's AudioBuffer.
  S._ensureWorkletForSample = async (sampleBuffer) => {
    if (isWorkletGrainActive()) return;  // already running
    if (!S.audioCtx || !sampleBuffer) return;
    console.log('worklet: sample paint triggered — cold-starting worklet with sample buffer');
    await _startWorkletEngine(sampleBuffer);
  };

  // ── Worklet grain engine: auto-start on first recording ─────────────────
  // Cold-start on recording START (not completion) so grains from the very
  // first recording can play while painting.  Uses a tiny silent buffer as
  // the initial SAB, then immediately begins provisional live streaming.
  S._onRecordingStart = async () => {
    if (isWorkletGrainActive()) return;  // already running — provisional streaming handles it
    if (!S.audioCtx) return;
    // Create a minimal silent buffer to bootstrap the worklet.
    // The provisional live buffer will provide the actual audio.
    const silentBuf = S.audioCtx.createBuffer(1, 128, S.audioCtx.sampleRate);
    console.log('worklet: first recording started — cold-starting worklet');
    const ok = await _startWorkletEngine(silentBuf);
    if (ok) {
      // Now that the worklet is running, begin provisional streaming for
      // the recording that's already in progress.
      S._beginProvisionalRecording?.();
    }
  };

  // On recording completion: hot-swap the finished buffer into the worklet.
  S._onRecordingComplete = async (audioBuffer, _bufIdx) => {
    if (isWorkletGrainActive()) {
      console.log(`worklet: new recording (${audioBuffer.duration.toFixed(1)}s) — hot-swapping into running worklet`);
      hotSwapRecording(audioBuffer);
    } else {
      console.log(`worklet: new recording (${audioBuffer.duration.toFixed(1)}s) — starting worklet`);
      await _startWorkletEngine(audioBuffer);
    }
  };

  // Console API for manual worklet control (always available, not just exp)
  window.wg = {
    start: async (opts = {}) => {
      const buffers = S.liveRecBuffers?.filter(b => b?.buffer) ?? [];
      if (!buffers.length) {
        console.warn('wg: no recordings — record something first');
        return;
      }
      await _startWorkletEngine(buffers[buffers.length - 1].buffer, opts);
    },
    stop: () => { _stopWorkletEngine(); console.log('wg: stopped'); },
    waveform: (bufIdx) => showWaveformOverlay(bufIdx),
    set: (params) => { updateWorkletParams(params); console.log('wg: params updated', params); },
    stress: (grains = 100) => {
      const period = 0.001;
      const duration = grains * period;
      updateWorkletParams({ period, duration, volume: 0.3 });
      console.log(`wg: stress test — period=${period*1000}ms, duration=${duration*1000}ms, target overlap=${grains}`);
    },
    status: () => {
      console.log('wg: cross-origin isolated:', isCrossOriginIsolated());
      console.log('wg: SharedArrayBuffer available:', typeof SharedArrayBuffer !== 'undefined');
      console.log('wg: recordings:', S.liveRecBuffers?.filter(b => b?.buffer)?.length ?? 0);
      console.log('wg: 256-slot pool, pitch shift, jitter, VBAP, feedback ring, per-seed onset clocks');
    },
    diag: () => getWorkletDiag(),
  };

  // ── Experimental modules (?exp in URL) ─────────────────────────────────────
  // Lazy-loaded so they add zero overhead when EXP is off.  Each module
  // self-registers its hooks on S and wires its own UI (if any).
  if (EXP) {
    console.log('%c[exp] experimental mode active', 'color:#e8a030;font-weight:bold');
    import('./exp/exp-init.js')
      .then(m => m.initExp())
      .catch(e => console.warn('[exp] failed to load experimental modules:', e));
  }

  // Grain scheduler — independent of render loop so slow frames don't delay grains.
  // Interval set by GRAIN_SCHEDULER_INTERVAL_MS in state.js (default 30ms ≈ 33 ticks/sec).
  // Store interval ID so it can be cleared on teardown (e.g. page unload).
  S._grainSchedulerId = setInterval(scheduleGrains, GRAIN_SCHEDULER_INTERVAL_MS);

  // ── Global Escape key → close topmost modal ──────────────────────────────
  // All .mu-overlay modals and .factory-reset-overlay popups close on Escape.
  // ── Axis lock — independent azimuth / elevation toggles ─────────────────
  function _initAxisLockSeg(segId, stateKey, frozenKeys) {
    const seg = document.getElementById(segId);
    if (!seg) return;
    seg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const on = btn.dataset.val === 'on';
        S[stateKey] = on;
        // Clear frozen snapshots so next lock captures fresh position
        for (const k of frozenKeys) S[k] = null;
        seg.querySelectorAll('.grain-seg-btn').forEach(b =>
          b.classList.toggle('active', b === btn));
      });
    });
  }
  _initAxisLockSeg('axisLockAzSeg', 'axisLockAz',
    ['_axisLockFrozenNx', '_axisLockFrozenYaw']);
  _initAxisLockSeg('axisLockElSeg', 'axisLockEl',
    ['_axisLockFrozenNy', '_axisLockFrozenPitch']);
  // ── Commit slot config (unified cloud + loop pool) ──────────────────
  const commitSlotSelect = document.getElementById('commitSlotCountSelect')
                        || document.getElementById('seedSlotCountSelect');  // fallback to old ID
  if (commitSlotSelect) {
    commitSlotSelect.addEventListener('change', () => {
      S.commitSlotCount = parseInt(commitSlotSelect.value, 10);
      (S.updateSeedBanksUI || (() => {}))();
    });
  }
  const commitOverflowSeg = document.getElementById('commitOverflowSeg')
                          || document.getElementById('seedOverflowSeg');  // fallback to old ID
  if (commitOverflowSeg) {
    commitOverflowSeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        S.commitOverflow = btn.dataset.overflow;
        commitOverflowSeg.querySelectorAll('.grain-seg-btn').forEach(b =>
          b.classList.toggle('active', b === btn));
        S._syncSeqButtonStates?.();
      });
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    // Factory-reset / export / import overlays (dynamic, highest z-index)
    const factoryOverlay = document.querySelector('.factory-reset-overlay');
    if (factoryOverlay) { factoryOverlay.remove(); return; }

    // Static .mu-overlay modals — close the last open one
    const openModals = document.querySelectorAll('.mu-overlay.open');
    if (openModals.length > 0) {
      const top = openModals[openModals.length - 1];
      // Click close button to trigger any cleanup (e.g. audio metering stop)
      const closeBtn = top.querySelector('.close-btn');
      if (closeBtn) closeBtn.click();
      else top.classList.remove('open');
    }
  });
}

init();
