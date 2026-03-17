// ============================================================================
// UI — SENSOR CALIBRATION MODAL
// Two sensors, identical controls: axis mapping (board → roll/pitch/yaw),
// sign, mute, tare.  Plus a world-frame on/off toggle for sensor 2.
// ============================================================================

import { S } from './state.js';
import { wireSaveDefaultBtn } from './ui-audio-settings.js';
import {
  sensor, sensor2,
  sensorTare, sensorClearTare,
  sensor2Tare, sensor2ClearTare,
  isWorldFrameEnabled, setWorldFrameEnabled,
} from './sensor.js';

// ── Init ──────────────────────────────────────────────────────────────────────
export function initSensorUI() {
  const modal = document.getElementById('sensorModal');
  const btn   = document.getElementById('sensorBtn');
  const close = document.getElementById('sensorClose');

  if (!modal || !btn) return;

  btn.addEventListener('click',   () => modal.classList.add('open'));
  close?.addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

  // ── Axis mapping — sensor 1 (/space/cursor) ─────────────────────────────
  // .smap-axis  data-phys="x|y|z"  data-viz="roll|pitch|yaw"
  // .smap-sign  data-phys="x|y|z"  data-sign="+|−"
  // .smap-mute  data-phys="x|y|z"
  modal.querySelectorAll('.smap-axis').forEach(b => {
    b.addEventListener('click', () => {
      const phys = b.dataset.phys;
      modal.querySelectorAll(`.smap-axis[data-phys="${phys}"]`)
        .forEach(s => s.classList.remove('active'));
      b.classList.add('active');
      S.sensorCal.axisMap[phys].viz = b.dataset.viz;
    });
  });

  modal.querySelectorAll('.smap-sign').forEach(b => {
    b.addEventListener('click', () => {
      const phys = b.dataset.phys;
      modal.querySelectorAll(`.smap-sign[data-phys="${phys}"]`)
        .forEach(s => s.classList.remove('active'));
      b.classList.add('active');
      S.sensorCal.axisMap[phys].sign = b.dataset.sign === '+' ? 1 : -1;
    });
  });

  modal.querySelectorAll('.smap-mute').forEach(b => {
    b.addEventListener('click', () => {
      const phys = b.dataset.phys;
      const muted = !S.sensorCal.axisMap[phys].mute;
      S.sensorCal.axisMap[phys].mute = muted;
      b.classList.toggle('active', muted);
    });
  });

  // ── Tare — sensor 1 ─────────────────────────────────────────────────────
  // Shared helper so modal button and top-bar button stay in sync.
  function doSensorTare() {
    sensorTare();
    document.getElementById('sensorZeroBtn')?.classList.add('active');
    document.getElementById('sensorClearZeroBtn')?.classList.remove('active');
    document.getElementById('cursorZeroTopBtn')?.classList.add('active');
  }
  function doSensorClearTare() {
    sensorClearTare();
    document.getElementById('sensorClearZeroBtn')?.classList.add('active');
    document.getElementById('sensorZeroBtn')?.classList.remove('active');
    document.getElementById('cursorZeroTopBtn')?.classList.remove('active');
  }

  document.getElementById('sensorZeroBtn')?.addEventListener('click', doSensorTare);
  document.getElementById('sensorClearZeroBtn')?.addEventListener('click', doSensorClearTare);
  document.getElementById('cursorZeroTopBtn')?.addEventListener('click', doSensorTare);

  // ── Axis mapping — sensor 2 (/space/frame) ──────────────────────────────
  // .smap2-axis  data-phys="x|y|z"  data-viz="roll|pitch|yaw"
  // .smap2-sign  data-phys="x|y|z"  data-sign="+|−"
  // .smap2-mute  data-phys="x|y|z"
  modal.querySelectorAll('.smap2-axis').forEach(b => {
    b.addEventListener('click', () => {
      const phys = b.dataset.phys;
      modal.querySelectorAll(`.smap2-axis[data-phys="${phys}"]`)
        .forEach(s => s.classList.remove('active'));
      b.classList.add('active');
      S.sensor2Cal.axisMap[phys].viz = b.dataset.viz;
    });
  });

  modal.querySelectorAll('.smap2-sign').forEach(b => {
    b.addEventListener('click', () => {
      const phys = b.dataset.phys;
      modal.querySelectorAll(`.smap2-sign[data-phys="${phys}"]`)
        .forEach(s => s.classList.remove('active'));
      b.classList.add('active');
      S.sensor2Cal.axisMap[phys].sign = b.dataset.sign === '+' ? 1 : -1;
    });
  });

  modal.querySelectorAll('.smap2-mute').forEach(b => {
    b.addEventListener('click', () => {
      const phys = b.dataset.phys;
      const muted = !S.sensor2Cal.axisMap[phys].mute;
      S.sensor2Cal.axisMap[phys].mute = muted;
      b.classList.toggle('active', muted);
    });
  });

  // ── Tare — sensor 2 ─────────────────────────────────────────────────────
  document.getElementById('sensor2ZeroBtn')?.addEventListener('click', () => {
    sensor2Tare();
    document.getElementById('sensor2ZeroBtn')?.classList.add('active');
    document.getElementById('sensor2ClearZeroBtn')?.classList.remove('active');
  });

  document.getElementById('sensor2ClearZeroBtn')?.addEventListener('click', () => {
    sensor2ClearTare();
    document.getElementById('sensor2ClearZeroBtn')?.classList.add('active');
    document.getElementById('sensor2ZeroBtn')?.classList.remove('active');
  });

  // ── World frame on/off ───────────────────────────────────────────────────
  function _syncWorldFrameBtn() {
    const on = isWorldFrameEnabled();
    document.getElementById('wfOnBtn')?.classList.toggle('active',  on);
    document.getElementById('wfOffBtn')?.classList.toggle('active', !on);
  }

  document.getElementById('wfOnBtn')?.addEventListener('click', () => {
    setWorldFrameEnabled(true);
    _syncWorldFrameBtn();
  });

  document.getElementById('wfOffBtn')?.addEventListener('click', () => {
    setWorldFrameEnabled(false);
    _syncWorldFrameBtn();
  });

  _syncWorldFrameBtn();

  // ── Live readout loop ────────────────────────────────────────────────────
  function fmtEuler(euler) {
    const { x: roll, y: pitch, z: yaw } = euler;
    return `roll <span>${roll.toFixed(1)}°</span>  ` +
           `pitch <span>${pitch.toFixed(1)}°</span>  ` +
           `yaw <span>${yaw.toFixed(1)}°</span>`;
  }

  let _sensorRafId = null;
  function updateLive() {
    const el = document.getElementById('sensorLive');
    if (el) el.innerHTML = sensor.euler ? fmtEuler(sensor.euler) : 'waiting for data…';

    const el2 = document.getElementById('sensor2Live');
    if (el2) el2.innerHTML = sensor2.euler ? fmtEuler(sensor2.euler) : 'no data';

    _sensorRafId = requestAnimationFrame(updateLive);
  }
  function startSensorRAF()  { if (!_sensorRafId) updateLive(); }
  function stopSensorRAF()   { if (_sensorRafId) { cancelAnimationFrame(_sensorRafId); _sensorRafId = null; } }

  // Start/stop RAF on modal open/close
  if (modal.classList.contains('open')) startSensorRAF();
  const _obs = new MutationObserver(() => {
    if (modal.classList.contains('open')) startSensorRAF(); else stopSensorRAF();
  });
  _obs.observe(modal, { attributes: true, attributeFilter: ['class'] });

}
