// ============================================================================
// UI — VIZ SETTINGS MODAL
// Manages the particle visualisation settings:
//   - viz mode toggle (feature-driven vs original palette)
//   - Particle base / max size sliders
//   - RMS min/max (volume → particle size calibration)
//   - Spectral centroid min/max (timbre → particle colour calibration)
// ============================================================================

import { S } from './state.js';
import { wireSaveDefaultBtn } from './ui-audio-settings.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function bindSlider(sliderId, valId, getter, setter, fmt) {
  const slider = document.getElementById(sliderId);
  const valEl  = document.getElementById(valId);
  if (!slider) return;
  slider.value = getter();
  if (valEl) valEl.textContent = fmt(getter());
  slider.addEventListener('input', () => {
    setter(parseFloat(slider.value));
    if (valEl) valEl.textContent = fmt(getter());
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initVizUI() {

  // ── Modal open / close ────────────────────────────────────────────────────
  const modal    = document.getElementById('vizModal');
  const openBtn  = document.getElementById('vizSettingsBtn');
  const closeBtn = document.getElementById('vizModalClose');
  if (modal && openBtn) {
    openBtn.addEventListener('click', () => modal.classList.add('open'));
  }
  if (modal && closeBtn) {
    closeBtn.addEventListener('click', () => modal.classList.remove('open'));
  }
  // Click backdrop to close
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.classList.remove('open');
    });
  }

  // ── Mode toggle (on / off) ──────────────────────────────────────────────
  const modeSeg = document.getElementById('vizModeSeg');
  if (modeSeg) {
    modeSeg.querySelectorAll('[data-viz]').forEach(btn => {
      btn.addEventListener('click', () => {
        S.vizMode = btn.dataset.viz === 'on';
        modeSeg.querySelectorAll('[data-viz]').forEach(b =>
          b.classList.toggle('active', b === btn));
      });
    });
  }

  // ── UI scale slider ────────────────────────────────────────────────────
  const BASE_FONT_PX = 15;
  const SCALE_KEY = 'mubone_uiScale';
  function applyUiScale(scale) {
    S.uiScale = scale;
    document.documentElement.style.fontSize = (BASE_FONT_PX * scale) + 'px';
    try { localStorage.setItem(SCALE_KEY, scale); } catch {}
  }
  // Restore saved scale
  try {
    const saved = parseFloat(localStorage.getItem(SCALE_KEY));
    if (saved >= 0.7 && saved <= 1.6) S.uiScale = saved;
  } catch {}
  applyUiScale(S.uiScale);
  bindSlider('vizUiScaleSlider', 'vizUiScaleVal',
    () => S.uiScale,
    v  => { applyUiScale(v); },
    v  => v.toFixed(2));

  // ── HUD scale slider ───────────────────────────────────────────────────
  const HUD_SCALE_KEY = 'mubone-hud-scale';
  try {
    const saved = parseFloat(localStorage.getItem(HUD_SCALE_KEY));
    if (saved >= 0.5 && saved <= 2.0) S.hudScale = saved;
  } catch {}
  function applyHudScale(v) {
    S.hudScale = v;
    const wrapper = document.getElementById('canvasWrapper');
    if (wrapper) wrapper.style.setProperty('--hud-scale', v);
    try { localStorage.setItem(HUD_SCALE_KEY, String(v)); } catch {}
  }
  applyHudScale(S.hudScale);
  bindSlider('vizHudScaleSlider', 'vizHudScaleVal',
    () => S.hudScale,
    v  => { applyHudScale(v); },
    v  => v.toFixed(2));

  // ── Particle size sliders ───────────────────────────────────────────────
  bindSlider('vizMinSizeSlider', 'vizMinSizeVal',
    () => S.vizMinSize,
    v  => { S.vizMinSize = v; },
    v  => v.toFixed(1));

  bindSlider('vizMaxSizeSlider', 'vizMaxSizeVal',
    () => S.vizMaxSize,
    v  => { S.vizMaxSize = v; },
    v  => v.toFixed(0));

  // ── RMS calibration (volume → size) ─────────────────────────────────────
  bindSlider('vizRmsMinSlider', 'vizRmsMinNum',
    () => S.vizRmsMin,
    v  => { S.vizRmsMin = v; },
    v  => v.toFixed(3));

  bindSlider('vizRmsMaxSlider', 'vizRmsMaxNum',
    () => S.vizRmsMax,
    v  => { S.vizRmsMax = v; },
    v  => v.toFixed(2));

  // ── Centroid calibration (timbre → colour) ──────────────────────────────
  bindSlider('vizCentMinSlider', 'vizCentMinNum',
    () => S.vizCentroidMin,
    v  => { S.vizCentroidMin = v; },
    v  => v.toFixed(2));

  bindSlider('vizCentMaxSlider', 'vizCentMaxNum',
    () => S.vizCentroidMax,
    v  => { S.vizCentroidMax = v; },
    v  => v.toFixed(2));

}
