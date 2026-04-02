// ============================================================================
// MAIN — entry point: wire up all modules and start the app
// ============================================================================

import { S, DEBUG, EXP, GRAIN_SCHEDULER_INTERVAL_MS } from './state.js';
import { scheduleGrains } from './grain.js';
import { setupEvents, setupDragDrop } from './events.js';
import { rebuildSampleListUI, buildSvTabs, drawSvWaveform, setupSvCropInteraction, initUndoBtn } from './ui-samples.js';
import {
  setupPresets, initGrainControls, initDesktopMorph,
  drawPresetWaveform, updatePlaybackControls, selectPreset,
} from './ui-presets.js';
import { setupMappingModal, initMidi } from './midi.js';
import { initMobileMode } from './mobile.js';
import { initQuadBuses, initSpeakerBuses, requestMicAccess } from './audio.js';
import { resizeCanvas, animate } from './renderer.js';
import { startMainMetering, rebuildMainOutputMeters, initScanToggle, initMorphToggle, initRadiusFade, initSeqMode, initMixdownGains, initDryMonitorGains, setScanMuted, initGateMeter } from './ui-meters.js';
import { initSensor, getSensorCamQ, getSensorCursorQ, getFrameQ, recenterCursor } from './sensor-registry.js';
import { initOSC } from './osc.js';
import { initSensorsUI } from './ui-sensors.js';
import { initAudioSettings, loadAudioDefaults, activateSavedInputDevice, startAutoSave } from './ui-audio-settings.js';

import { initImprovUI } from './ui-improv.js';
import { initVizUI } from './ui-viz.js';
import { initSweepUI, initSessionPanel } from './ui-sweep.js';
import { initExportImport } from './ui-export.js';
import { initPatchTable } from './ui-patch-table.js';
import { initMappingUI } from './ui-sensor-mapping.js';


function init() {
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
  initSensorsUI();
  initMappingUI();
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
  } catch (_) { /* ignore corrupt data */ }

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
  const _sensorGroupEl = document.getElementById('sensorGroup');
  if (_sensorGroupEl) {
    window.addEventListener('osc-connected', () => _sensorGroupEl.classList.remove('no-sensor'));
    window.addEventListener('osc-disconnected', () => _sensorGroupEl.classList.add('no-sensor'));
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
