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
  // ── Editable numbox — click the value label to type a precise number ──
  if (valEl) {
    valEl.style.cursor = 'text';
    valEl.addEventListener('click', () => {
      if (valEl.querySelector('input')) return; // already editing
      const cur = getter();
      const inp = document.createElement('input');
      inp.type  = 'text';
      inp.value = cur;
      inp.style.cssText = `
        width: 100%; background: #222; color: #fff; border: 1px solid #555;
        border-radius: 3px; font-size: inherit; font-family: inherit;
        text-align: right; padding: 0 0.2rem; box-sizing: border-box;
        font-variant-numeric: tabular-nums;
      `;
      valEl.textContent = '';
      valEl.appendChild(inp);
      inp.focus();
      inp.select();
      function commit() {
        const v = parseFloat(inp.value);
        if (!isNaN(v)) {
          const min = parseFloat(slider.min), max = parseFloat(slider.max);
          const clamped = Math.min(max, Math.max(min, v));
          setter(clamped);
          slider.value = clamped;
        }
        valEl.textContent = fmt(getter());
      }
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); }
        if (e.key === 'Escape') { valEl.textContent = fmt(getter()); }
        e.stopPropagation(); // don't trigger app key bindings while typing
      });
    });
  }
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
    if (saved >= 0 && saved <= 2.0) S.hudScale = saved;
  } catch {}
  function applyHudScale(v) {
    S.hudScale = v;
    const wrapper = document.getElementById('canvasWrapper');
    if (wrapper) wrapper.style.setProperty('--hud-scale', v);
    // Hide the DOM HUD overlay when scale is 0 (HUD off)
    const hud = wrapper?.querySelector('.hud');
    if (hud) hud.style.display = v === 0 ? 'none' : '';
    try { localStorage.setItem(HUD_SCALE_KEY, String(v)); } catch {}
  }
  applyHudScale(S.hudScale);
  bindSlider('vizHudScaleSlider', 'vizHudScaleVal',
    () => S.hudScale,
    v  => { applyHudScale(v); },
    v  => v === 0 ? 'off' : v.toFixed(2));

  // ── Field of view slider ────────────────────────────────────────────────
  const FOV_KEY = 'mubone_fovDeg';
  try {
    const saved = parseFloat(localStorage.getItem(FOV_KEY));
    if (saved >= 20 && saved <= 120) S.fovDeg = saved;
  } catch {}
  bindSlider('vizFovSlider', 'vizFovVal',
    () => S.fovDeg,
    v  => { S.fovDeg = v; try { localStorage.setItem(FOV_KEY, String(v)); } catch {} },
    v  => v.toFixed(1) + '°');

  // ── Center reference toggle ─────────────────────────────────────────────
  const zeroRefSeg = document.getElementById('vizZeroRefSeg');
  if (zeroRefSeg) {
    const ZERO_KEY = 'mubone_showZeroRef';
    try {
      const saved = localStorage.getItem(ZERO_KEY);
      if (saved !== null) S.showZeroRef = saved === 'true';
    } catch {}
    zeroRefSeg.querySelectorAll('[data-zero]').forEach(btn => {
      btn.classList.toggle('active',
        (btn.dataset.zero === 'on') === S.showZeroRef);
    });
    zeroRefSeg.querySelectorAll('[data-zero]').forEach(btn => {
      btn.addEventListener('click', () => {
        S.showZeroRef = btn.dataset.zero === 'on';
        zeroRefSeg.querySelectorAll('[data-zero]').forEach(b =>
          b.classList.toggle('active', b === btn));
        try { localStorage.setItem(ZERO_KEY, S.showZeroRef); } catch {}
      });
    });
  }

  // ── Edge indicator (detethered cursor) ─────────────────────────────────
  const EDGE_IND_KEY = 'mubone_edgeIndicator';
  const EDGE_IND_SIZE_KEY = 'mubone_edgeIndicatorSize';
  try {
    const saved = localStorage.getItem(EDGE_IND_KEY);
    if (saved === 'on' || saved === 'off') S.edgeIndicator = saved;
  } catch {}
  try {
    const saved = parseFloat(localStorage.getItem(EDGE_IND_SIZE_KEY));
    if (saved >= 0.5 && saved <= 2.0) S.edgeIndicatorSize = saved;
  } catch {}

  const edgeSeg = document.getElementById('vizEdgeIndicatorSeg');
  if (edgeSeg) {
    edgeSeg.querySelectorAll('[data-edge]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.edge === S.edgeIndicator);
    });
    edgeSeg.querySelectorAll('[data-edge]').forEach(btn => {
      btn.addEventListener('click', () => {
        S.edgeIndicator = btn.dataset.edge;
        edgeSeg.querySelectorAll('[data-edge]').forEach(b =>
          b.classList.toggle('active', b === btn));
        try { localStorage.setItem(EDGE_IND_KEY, S.edgeIndicator); } catch {}
      });
    });
  }
  bindSlider('vizEdgeIndicatorSizeSlider', 'vizEdgeIndicatorSizeVal',
    () => S.edgeIndicatorSize,
    v  => { S.edgeIndicatorSize = v; try { localStorage.setItem(EDGE_IND_SIZE_KEY, String(v)); } catch {} },
    v  => v.toFixed(1));

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
