// ============================================================================
// UI — SENSOR CALIBRATION MODAL
// Axis mapping (physical board → viewer), tare, live readout.
// ============================================================================

import { S } from './state.js';
import { sensor, sensorTare, sensorClearTare } from './sensor.js';

// ── Init ──────────────────────────────────────────────────────────────────────
export function initSensorUI() {
  const modal = document.getElementById('sensorModal');
  const btn   = document.getElementById('sensorBtn');
  const close = document.getElementById('sensorClose');

  if (!modal || !btn) return;

  btn.addEventListener('click',   () => modal.classList.add('open'));
  close?.addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

  // ── Axis mapping buttons ────────────────────────────────────────────────
  // .smap-axis  data-phys="x|y|z"  data-viz="x|y|z"
  // .smap-sign  data-phys="x|y|z"  data-sign="+|−"
  // .smap-mute  data-phys="x|y|z"
  modal.querySelectorAll('.smap-axis').forEach(b => {
    b.addEventListener('click', () => {
      const phys = b.dataset.phys;
      // deactivate siblings for this row
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

  // ── Tare buttons ────────────────────────────────────────────────────────
  document.getElementById('sensorZeroBtn')?.addEventListener('click', () => {
    sensorTare();
    document.getElementById('sensorZeroBtn')?.classList.add('active');
    document.getElementById('sensorClearZeroBtn')?.classList.remove('active');
  });

  document.getElementById('sensorClearZeroBtn')?.addEventListener('click', () => {
    sensorClearTare();
    document.getElementById('sensorClearZeroBtn')?.classList.add('active');
    document.getElementById('sensorZeroBtn')?.classList.remove('active');
  });

  // ── Live readout loop ───────────────────────────────────────────────────
  function updateLive() {
    const el = document.getElementById('sensorLive');
    if (el) {
      if (sensor.euler) {
        const { x, y, z } = sensor.euler;
        el.innerHTML =
          `x <span>${x.toFixed(1)}°</span>  ` +
          `y <span>${y.toFixed(1)}°</span>  ` +
          `z <span>${z.toFixed(1)}°</span>`;
      } else {
        el.textContent = 'waiting for data…';
      }
    }
    requestAnimationFrame(updateLive);
  }
  updateLive();
}
