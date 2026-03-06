// ============================================================================
// MAIN — entry point: wire up all modules and start the app
// ============================================================================

import { S } from './state.js';
import { scheduleGrains } from './grain.js';
import { setupEvents, setupDragDrop } from './events.js';
import { rebuildSampleListUI, buildSvTabs, drawSvWaveform } from './ui-samples.js';
import {
  setupPresets, initGrainControls,
  drawPresetWaveform, updatePlaybackControls,
} from './ui-presets.js';
import { setupMappingModal, initMidi } from './midi.js';
import { initMobileMode } from './mobile.js';
import { resizeCanvas, animate } from './renderer.js';
import { initSensor, getSensorCamQ } from './sensor.js';
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

  // Sensor + audio settings
  initSensor();
  S._getSensorCamQ = getSensorCamQ;  // hook renderer without a circular import
  initSensorUI();
  initAudioSettings();

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

  // Grain scheduler — independent of render loop so slow frames don't delay grains.
  // 30ms interval = ~33 ticks/sec. Grains are 25ms–2000ms so 30ms scheduling
  // resolution is inaudible. Halves background CPU vs the old 15ms interval.
  setInterval(scheduleGrains, 30);
}

init();
