// ============================================================================
// MAIN — entry point: wire up all modules and start the app
// ============================================================================

import { S, DEBUG, GRAIN_SCHEDULER_INTERVAL_MS } from './state.js';
import { scheduleGrains } from './grain.js';
import { setupEvents, setupDragDrop } from './events.js';
import { rebuildSampleListUI, buildSvTabs, drawSvWaveform, setupSvCropInteraction } from './ui-samples.js';
import {
  setupPresets, initGrainControls,
  drawPresetWaveform, updatePlaybackControls,
} from './ui-presets.js';
import { setupMappingModal, initMidi } from './midi.js';
import { initMobileMode } from './mobile.js';
import { initQuadBuses, initSpeakerBuses, requestMicAccess } from './audio.js';
import { resizeCanvas, animate } from './renderer.js';
import { startMainMetering, rebuildMainOutputMeters, initCursorHouseMute, initMixdownGains } from './ui-meters.js';
import { initSensor, getSensorCamQ } from './sensor.js';
import { initOSC } from './osc.js';
import { initSensorUI } from './ui-sensor.js';
import { initAudioSettings, loadAudioDefaults, activateSavedInputDevice } from './ui-audio-settings.js';
import { initWandUI } from './ui-wand.js';
import { initImprovUI } from './ui-improv.js';
import { initVizUI } from './ui-viz.js';


function init() {
  S.canvas = document.getElementById('sphereCanvas');
  S.ctx    = S.canvas.getContext('2d');

  resizeCanvas();
  setupEvents();
  setupDragDrop();
  rebuildSampleListUI();
  S.updateLiveRecUI?.();
  setupPresets();
  initGrainControls();
  setupMappingModal();
  initMidi();
  requestMicAccess();  // prompt for mic permission on load, same pattern as MIDI
  if (S.isMobile) initMobileMode();

  // Sensor + OSC + audio settings
  initSensor();
  initOSC();   // connects Electron IPC or browser WebSocket transport
  S._getSensorCamQ = getSensorCamQ;  // hook renderer without a circular import
  initSensorUI();
  initWandUI();
  loadAudioDefaults();   // restore saved audio settings before UI init
  initAudioSettings();
  initImprovUI();
  initVizUI();

  // ── Reset all saved defaults ──────────────────────────────────────────────
  document.getElementById('resetDefaultsBtn')?.addEventListener('click', () => {
    if (!confirm('Reset all saved settings to factory defaults?\n\nThis clears saved audio, viz, sensor, and wand settings. The page will reload.')) return;
    localStorage.removeItem('mubone_audio_defaults');
    location.reload();
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

  // ── Spatial mode toggle ─────────────────────────────────────────────────────
  // sim:      headphones / mouse. View-relative stereo panning. Sensor ignored.
  // physical: real speakers. Sensor drives camera + paint cursor. World-space VBAP.
  const spatialModeBtn = document.getElementById('spatialModeBtn');
  if (spatialModeBtn) {
    function updateSpatialModeBtn() {
      const isPhysical = S.spatialMode === 'physical';
      const label = spatialModeBtn.querySelector('.spatial-mode-label');
      const iconSim = spatialModeBtn.querySelector('.spatial-icon-sim');
      const iconPhys = spatialModeBtn.querySelector('.spatial-icon-physical');
      if (label) label.textContent = isPhysical ? 'physical' : 'sim';
      if (iconSim)  iconSim.style.display  = isPhysical ? 'none' : '';
      if (iconPhys) iconPhys.style.display = isPhysical ? '' : 'none';
      spatialModeBtn.classList.toggle('active', isPhysical);
      spatialModeBtn.title = isPhysical
        ? 'physical mode — sensor drives cursor, world-space VBAP, speakers fixed in room\nclick to switch to sim'
        : 'sim mode — mouse/MIDI only, view-relative stereo panning, headphones\nclick to switch to physical';
    }
    function applySpatialMode(mode) {
      S.spatialMode = mode;
      updateSpatialModeBtn();
      if (S.canvas) S.canvas.style.cursor = mode === 'physical' ? 'none' : '';
      DEBUG && console.log(`[spatial] mode: ${S.spatialMode}`);
    }
    spatialModeBtn.addEventListener('click', () => {
      applySpatialMode(S.spatialMode === 'sim' ? 'physical' : 'sim');
    });
    // Expose for osc.js (/spatial/mode sim|physical)
    S._setSpatialMode = applySpatialMode;
    updateSpatialModeBtn();
  }

  // Re-size after first layout pass in case dimensions weren't settled yet
  requestAnimationFrame(() => {
    resizeCanvas();
    drawPresetWaveform();
    updatePlaybackControls();
    buildSvTabs();
    drawSvWaveform();
    animate();
    startMainMetering();  // start DOM-based VU meter loop for main window
    initCursorHouseMute(); // wire cursor-in-house mute toggle
    initMixdownGains();    // wire mixdown source gain sliders
  });

  // Redraw waveforms when their containers resize (e.g. window resize or flex relayout)
  const svDisplayEl = document.getElementById('svDisplay');
  if (svDisplayEl) new ResizeObserver(() => drawSvWaveform()).observe(svDisplayEl);

  const presetWaveformWrap = document.querySelector('.preset-waveform-wrap');
  if (presetWaveformWrap) new ResizeObserver(() => drawPresetWaveform()).observe(presetWaveformWrap);

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
          const nCh = best.outputChannels;
          await initSpeakerBuses(nCh);
          const result = await window.electronBridge.setAudioDevice(best.id, nCh);
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
            const bufFrames = S.preferredBufferSize ?? 512;
            const result = await window.electronBridge.setInputDevice(inDev.id, inDev.inputChannels, bufFrames);
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

  // Grain scheduler — independent of render loop so slow frames don't delay grains.
  // Interval set by GRAIN_SCHEDULER_INTERVAL_MS in state.js (default 30ms ≈ 33 ticks/sec).
  setInterval(scheduleGrains, GRAIN_SCHEDULER_INTERVAL_MS);
}

init();
