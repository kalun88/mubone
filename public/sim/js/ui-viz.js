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

  // ── Dark / light mode toggle ─────────────────────────────────────────────
  const DARK_MODE_KEY = 'mubone_darkMode';
  try {
    const saved = localStorage.getItem(DARK_MODE_KEY);
    if (saved !== null) S.darkMode = saved === 'true';
  } catch {}
  const darkSeg = document.getElementById('vizDarkModeSeg');
  if (darkSeg) {
    const syncDarkButtons = () => {
      darkSeg.querySelectorAll('[data-theme]').forEach(b =>
        b.classList.toggle('active',
          (b.dataset.theme === 'dark') === S.darkMode));
      try { localStorage.setItem(DARK_MODE_KEY, S.darkMode); } catch {}
    };
    syncDarkButtons(); // init
    darkSeg.querySelectorAll('[data-theme]').forEach(btn => {
      btn.addEventListener('click', () => {
        S.darkMode = btn.dataset.theme === 'dark';
        syncDarkButtons();
      });
    });
    // Allow OSC / external toggle to sync UI
    S._syncDarkModeUI = syncDarkButtons;
  }

  // ── Performance mode toggle (on / off) ─────────────────────────────────
  const perfSeg = document.getElementById('vizPerfModeSeg');
  if (perfSeg) {
    const syncPerfButtons = () => {
      perfSeg.querySelectorAll('[data-perf]').forEach(b =>
        b.classList.toggle('active',
          (b.dataset.perf === 'on') === S.perfMode));
    };
    perfSeg.querySelectorAll('[data-perf]').forEach(btn => {
      btn.addEventListener('click', () => {
        S.perfMode = btn.dataset.perf === 'on';
        syncPerfButtons();
        console.log(`[perf] high-performance render mode ${S.perfMode ? 'ON' : 'OFF'}`);
      });
    });
    // Allow keyboard shortcut (Shift+P) to sync the UI buttons
    S._syncPerfModeUI = syncPerfButtons;
  }

  // ── UI scale slider ────────────────────────────────────────────────────
  // The rem base lives in tokens.css as --ui-base-px, read once here rather
  // than copied. The fallback matches that token; if it ever has to be used,
  // the stylesheet failed to load and the app has bigger problems.
  const BASE_FONT_PX =
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-base-px')) || 16;
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

  // The HUD SIZE slider was removed 2026-08-29. The canvas HUD it sized is
  // `body .hud { display: none }` — hidden since the tile screen became the
  // app (#291), so the control had nothing to size. Every `--hud-scale` in
  // the stylesheet carries a `, 1` fallback, so dropping the only setter
  // changes no measurement. See S.hudScale in state.js for the one reader
  // that is left.

  // ── Projector throw angle (rig calibration, NOT a zoom) ─────────────────
  // Kept separate from camera pull-back on purpose, and the two are not
  // interchangeable however alike they look on a laptop:
  //   • this is a number you LOOK UP (Nebula 1.2:1 ≈ 26°, Capsule 3 ≈ 45°) so
  //     the virtual sphere lands on real surfaces. It is machine-local
  //     (mubone_fovDeg) and deliberately absent from export files — it
  //     describes this room's projector, not the piece.
  //   • camPull is the view control, and it rides the exported viz calibration.
  // They also are not one axis: FOV changes DISTORTION, pull-back changes
  // VANTAGE, and narrow-FOV + pulled-back — the least distorted external view —
  // is a corner no single combined slider could reach.
  // ── Field of view slider ────────────────────────────────────────────────
  const FOV_KEY = 'mubone_fovDeg';
  try {
    // 360 = the whole sphere laid flat (azimuthal equidistant disc map) —
    // the FOV slider doubles as the zoom-out-to-world-map control.
    const saved = parseFloat(localStorage.getItem(FOV_KEY));
    if (saved >= 10 && saved <= 360) S.fovDeg = saved;
  } catch {}
  bindSlider('vizFovSlider', 'vizFovVal',
    () => S.fovDeg,
    v  => { S.fovDeg = v; try { localStorage.setItem(FOV_KEY, String(v)); } catch {} },
    v  => v.toFixed(1) + '°');
  // The canvas wheel drives the same value (events.js) — keep the slider,
  // its readout and the persisted key in step.
  S._syncZoomUI = (v) => {
    const s   = document.getElementById('vizFovSlider');
    const val = document.getElementById('vizFovVal');
    if (s)   s.value = v;
    if (val) val.textContent = v.toFixed(1) + '°';
    try { localStorage.setItem(FOV_KEY, String(v)); } catch {}
  };

  // ── Camera pull-back RETIRED (2026-08-28, Ek) ───────────────────────────
  // "One view that's accurate": the centred camera is azimuthal equidistant
  // and the FOV slider zooms out to the 360° flat map. The outside view is
  // gone from the UI; S.camPull stays console-only (the pulled render paths
  // are dormant no-ops at 0) until a cleanup pass deletes them.
  S._syncCamPullUI = () => {};

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

  // ── Gaze trail length ───────────────────────────────────────────────────
  // Three presets rather than a slider: the useful answers are "none", "just
  // enough to see the last move" and "a full phrase", and the right one
  // depends on how fast you turn, not on a value you'd dial in.
  //
  // No localStorage key of its own — gazeTrailSec rides the viz calibration
  // payload in ui-audio-settings.js, which the 2s dirty check persists. That
  // is also how the particle size sliders above persist; adding a key here
  // would give the value two homes that could disagree.
  const trailSeg = document.getElementById('vizGazeTrailSeg');
  if (trailSeg) {
    const syncTrail = () => trailSeg.querySelectorAll('[data-trail]').forEach(b =>
      b.classList.toggle('active', parseFloat(b.dataset.trail) === S.gazeTrailSec));
    syncTrail();
    trailSeg.querySelectorAll('[data-trail]').forEach(btn => {
      btn.addEventListener('click', () => {
        S.gazeTrailSec = parseFloat(btn.dataset.trail);
        // The draw pass clears the buffer itself when the value is 0, so
        // there is nothing to flush here.
        syncTrail();
      });
    });
    // An imported setup writes S.gazeTrailSec straight into state, so let the
    // import path re-light the right button rather than leaving the panel
    // showing the value that was replaced.
    S._syncGazeTrailUI = syncTrail;
  }

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
