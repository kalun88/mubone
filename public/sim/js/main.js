// ============================================================================
// MAIN — entry point: wire up all modules and start the app
// ============================================================================

import { S, GRAIN_SCHEDULER_INTERVAL_MS } from './state.js';
import { scheduleGrains } from './grain.js';
import { setupEvents, setupDragDrop } from './events.js';
import { rebuildSampleListUI, buildSvTabs, drawSvWaveform } from './ui-samples.js';
import {
  setupPresets, initGrainControls,
  drawPresetWaveform, updatePlaybackControls,
} from './ui-presets.js';
import { setupMappingModal, initMidi } from './midi.js';
import { initMobileMode } from './mobile.js';
import { initQuadBuses, initSpeakerBuses } from './audio.js';
import { resizeCanvas, animate, rebuildOutputMeterStrip } from './renderer.js';
import { initSensor, getSensorCamQ } from './sensor.js';
import { initOSC } from './osc.js';
import { initSensorUI } from './ui-sensor.js';
import { initAudioSettings } from './ui-audio-settings.js';

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
  if (S.isMobile) initMobileMode();

  // Sensor + OSC + audio settings
  initSensor();
  initOSC();   // connects Electron IPC or browser WebSocket transport
  S._getSensorCamQ = getSensorCamQ;  // hook renderer without a circular import
  initSensorUI();
  initAudioSettings();

  // When speaker buses are (re)initialised, rebuild the main-window output meter
  // strip to show one bar per active channel. Using a callback on S avoids a
  // circular import between audio.js and renderer.js.
  S._onSpeakerBusesReady = (n) => rebuildOutputMeterStrip(n);

  // ── Sample instrument modal ──────────────────────────────────────────────────
  const sampleModal    = document.getElementById('sampleModal');
  const sampleOpenBtn  = document.getElementById('bottomPanelToggleBtn');
  const sampleCloseBtn = document.getElementById('sampleModalClose');
  if (sampleModal && sampleOpenBtn) {
    sampleOpenBtn.addEventListener('click', () => {
      const opening = !sampleModal.classList.contains('open');
      sampleModal.classList.toggle('open', opening);
      sampleOpenBtn.classList.toggle('open', opening);
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
      spatialModeBtn.textContent = isPhysical ? '⬡ physical' : '⬡ sim';
      spatialModeBtn.classList.toggle('active', isPhysical);
      spatialModeBtn.title = isPhysical
        ? 'physical mode — sensor drives cursor, world-space VBAP, speakers fixed in room\nclick to switch to sim'
        : 'sim mode — mouse/MIDI only, view-relative stereo panning, headphones\nclick to switch to physical';
    }
    function applySpatialMode(mode) {
      S.spatialMode = mode;
      updateSpatialModeBtn();
      if (S.canvas) S.canvas.style.cursor = mode === 'physical' ? 'none' : '';
      console.log(`[spatial] mode: ${S.spatialMode}`);
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
        // Auto-select the first multi-channel device, falling back to stereo.
        // User can change device anytime via the audio settings modal.
        const devices = await window.electronBridge.getAudioDevices();
        // Always start with the system default — user can switch in Audio Settings
        const best = devices.find(d => d.isDefault) || devices[0];
        if (best) {
          const nCh = best.outputChannels;
          await initSpeakerBuses(nCh);
          const result = await window.electronBridge.setAudioDevice(best.id, nCh);
          console.log(`Output: "${best.name}" (system default) — ${nCh} ch — streaming: ${result.streaming}`);
        } else {
          console.warn('No output devices found. Open Audio Settings to select one.');
        }
      })
      .catch(e => console.warn('Quad bus init failed:', e));
  }

  // Grain scheduler — independent of render loop so slow frames don't delay grains.
  // Interval set by GRAIN_SCHEDULER_INTERVAL_MS in state.js (default 30ms ≈ 33 ticks/sec).
  setInterval(scheduleGrains, GRAIN_SCHEDULER_INTERVAL_MS);
}

init();
