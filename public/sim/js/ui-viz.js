// ============================================================================
// UI — VIZ SETTINGS MODAL
// Manages the particle visualisation settings:
//   - viz mode toggle (feature-driven vs original palette)
//   - The SIZE FIGURE: one picture carrying all four of what were Smallest,
//     Largest, Quietest Input and Loudest Input, drawn as the line they are
//   - The timbre LEGEND (the arc is fixed; there is nothing to calibrate)
// ============================================================================

import { S } from './state.js';
import { featuresToColor, readGateLoudness } from './audio-features.js';

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

  // THE CANVAS IS DARK (Ek, 2026-09-15: remove / sunset the canvas theme
  // option). There was a Dark | Light capsule here writing `mubone_darkMode`,
  // for a projector in a lit room. The row is gone and the instrument boots
  // dark and stays dark; `S.darkMode` and the light half of every palette
  // went on 2026-09-18 — there is one canvas.
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
    // Published so a RESTORED perfMode shows on the buttons at boot
    // (_loadVizCalibration calls it). ⇧P, which this line used to name, lost
    // its key on 2026-09-09 — the segment is how the mode is set now.
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

  // ── Particle size sliders ───────────────────────────────────────────────
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

  // The four size/loudness sliders are gone — `initSizeFigure()` below is the
  // control now, and it writes the same four values on the same S keys.

  // ── The timbre legend (Ek, 2026-09-13) ─────────────────────────────────
  // The two bounds are CONSTANTS now (state.js), not sliders and not a
  // ten-second listen: "it should be very predictable so that i see yellow
  // every time and my collaborators see yellow and they know what sound that
  // is." A colour is only a shared word if nobody can quietly redefine it, so
  // what used to be two calibration rows and a Listen button is a legend —
  // the ramp drawn, with the sounds that land on it named.
  const legend = document.getElementById('vizTimbreLegend');
  if (legend) {
    // Measured against real formant triples and noise bands, 2026-09-13: the
    // hue axis compares the loudest peak below 800 Hz against the loudest
    // above, so these are the sounds that land on each part of the ramp —
    // blue and cyan for placed voice, green for an open one, gold for breath,
    // red for a hiss. The tonal ones are drawn tonal and the breathy ones
    // breathy, because saturation is the second axis.
    const STOPS = [
      ['chest, growl',      0.18, 0.15],
      ['ee, ay',            0.23, 0.15],
      ['oo, ah',            0.35, 0.15],
      ['oh, open',          0.46, 0.20],
      ['breath, click',     0.60, 0.75],
      ['hiss, sss',         0.95, 0.55],
    ];
    const paint = () => {
      legend.innerHTML = STOPS.map(([word, tilt, noise]) => {
        const c = featuresToColor(tilt, noise);
        return `<span class="viz-legend-stop"><i class="viz-legend-dot" style="background:${c}"></i>${word}</span>`;
      }).join('');
    };
    paint();
  }

  initSizeFigure();
}

// ── The size figure — the law, drawn, and draggable ─────────────────────────
// `size = vizMinSize + (vizMaxSize - vizMinSize) * normalise(rms, vizRmsMin,
// vizRmsMax)` is what renderer.js runs for every mark of every frame. It is one
// straight line with two ends, so this draws that line and lets you drag the
// ends. Four sliders across two sections became one picture.
//
// WHY dB ON X. The two loudness values were raw RMS — 0.005 and 0.31 — and Ek's
// report was that nobody knows what those numbers mean. They are −46 dB and
// −10 dB, which are numbers a player can act on, and dB is already the unit
// every level on every other settings page reads in. The conversion lives here
// only; the state stays linear because renderer.js wants it linear.
//
// WHY A LIVE NEEDLE. `readGateLoudness()` is the same metric a mark's own `rms`
// is — snapshotInputFeatures takes consumeWindowLoudness, and both end at
// gateLoudness(rms, peak). So the needle is where the mark you play right now
// would land, not an approximation of it. That is the difference between the
// figure being the law and the figure being a picture of the law that can
// drift; the cost is that if that chain changes, this must change with it.
const FIG_DB_FLOOR = -60;                       // the meters' own domain
const _dbOfLin = v => 20 * Math.log10(Math.max(v, 1e-3));
const _linOfDb = db => (db <= FIG_DB_FLOOR ? 0 : Math.pow(10, db / 20));

// Colour from tokens, never a literal — docs/RULINGS.md "The canvas is part of
// the GUI". Cached because this repaints at frame rate while the page is open,
// and getComputedStyle is a layout read.
let _figTok = null;
const _tok = (name, fallback) => {
  if (!_figTok) _figTok = new Map();
  if (_figTok.has(name)) return _figTok.get(name);
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  _figTok.set(name, v);
  return v;
};

function initSizeFigure() {
  const cv = document.getElementById('vizSizeFigCanvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  let drag = null;                 // 'lo' | 'hi' | null

  // The plot box inside the canvas: room for the dB ruler under it and for the
  // largest dot's radius at the top, so a 300px ceiling cannot clip.
  const PAD = { l: 46, r: 16, t: 14, b: 22 };
  const geom = () => {
    const w = cv.clientWidth, h = cv.clientHeight;
    return { w, h, x0: PAD.l, x1: w - PAD.r, y0: PAD.t, y1: h - PAD.b };
  };
  const xOfDb  = (db, g) => g.x0 + (g.x1 - g.x0) * (db - FIG_DB_FLOOR) / (0 - FIG_DB_FLOOR);
  const dbOfX  = (x,  g) => FIG_DB_FLOOR + (0 - FIG_DB_FLOOR) * (x - g.x0) / (g.x1 - g.x0);
  // y is DIAMETER in px, and the axis tops out a little above the current
  // ceiling so the largest dot has air and the handle is never against the lid.
  const yTop   = () => Math.max(S.vizMaxSize * 2, 12) * 1.15;
  const yOfPx  = (px, g) => g.y1 - (g.y1 - g.y0) * (px / yTop());
  const pxOfY  = (y,  g) => yTop() * (g.y1 - y) / (g.y1 - g.y0);

  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

  function draw() {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const g = geom();

    const faint  = _tok('--border-faint', '#2a2a2a');
    const dim    = _tok('--text-faint', '#666');
    const muted  = _tok('--text-muted', '#999');
    const light  = _tok('--text-light', '#ddd');
    const accent = _tok('--accent-action', '#e8a030');
    ctx.font = '11.5px ' + (_tok('--font-sans', 'system-ui'));
    ctx.textBaseline = 'middle';

    // The dB ruler — the same domain and the same labels the meters carry.
    ctx.strokeStyle = faint; ctx.fillStyle = dim; ctx.lineWidth = 1;
    // A REAL MINUS, not a hyphen — the same one trimDb and _fmtDb use, so the
    // ruler reads like every other level in the app. The unit rides the TOP of
    // the scale rather than sitting in its own corner label, which is where it
    // collided with the −60 tick and read as "dB-60".
    for (const db of [-60, -48, -36, -24, -12, 0]) {
      const x = Math.round(xOfDb(db, g)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, g.y0); ctx.lineTo(x, g.y1); ctx.stroke();
      ctx.textAlign = db === 0 ? 'right' : db === -60 ? 'left' : 'center';
      const label = (db < 0 ? '\u2212' + Math.abs(db) : '0 dB');
      ctx.fillText(label, x, g.y1 + 11);
    }

    const loDb = _dbOfLin(S.vizRmsMin), hiDb = _dbOfLin(S.vizRmsMax);
    const gateDb = _dbOfLin(S.paintGateThreshold);
    const xLo = xOfDb(clamp(loDb, FIG_DB_FLOOR, 0), g), xHi = xOfDb(clamp(hiDb, FIG_DB_FLOOR, 0), g);
    const xGate = xOfDb(clamp(gateDb, FIG_DB_FLOOR, 0), g);
    const yLo = yOfPx(S.vizMinSize * 2, g), yHi = yOfPx(S.vizMaxSize * 2, g);

    // ── UNDER THE GATE, NO GRAIN LANDS ──────────────────────────────────────
    // Shaded, not merely marked: this is the one region of the plot where the
    // grain curve above it does not happen at all, and a flat minimum drawn
    // through it is what the figure got wrong before the gate was on it.
    if (xGate > g.x0) {
      ctx.fillStyle = _tok('--surface-1', '#1a1a1a');
      ctx.fillRect(g.x0, g.y0, xGate - g.x0, g.y1 - g.y0);
    }

    // ── The TAPE line, drawn through its own formula ────────────────────────
    // renderer.js: width = (0.6 + (pBase*0.5 + pMax*1.8) * rmsN^1.35) * depth,
    // at depth 1 (the front of the sphere). It runs the FULL width of the plot
    // including under the gate, because tape is never gated — and it never
    // reaches zero, because that 0.6 is the thin line that keeps a path
    // continuous through a silence you have to be able to swipe across.
    const lineW = (rms) => {
      const n = clamp((rms - S.vizRmsMin) / Math.max(1e-9, S.vizRmsMax - S.vizRmsMin), 0, 1);
      return 0.6 + (S.vizMinSize * 0.5 + S.vizMaxSize * 1.8) * Math.pow(n, 1.35);
    };
    // A RIBBON, not a curve: the quantity IS a width, so it is drawn as one.
    // The band's THICKNESS at any x is the stroke you would get there, in the
    // same screen pixels as the dots beside it, and its centre sits at the same
    // height the dot of that size would — so the two traces are read the same
    // way. (Area under a curve was the first attempt and said nothing: it made
    // a loud line look like a large REGION rather than a thick stroke.)
    // It never closes to nothing: that 0.6px floor is the thin line a path
    // keeps through a silence you have to be able to swipe across.
    ctx.fillStyle = _tok('--eng-tape', '#f2569e');
    ctx.globalAlpha = 0.34;
    ctx.beginPath();
    for (let px = g.x0; px <= g.x1; px += 2) {
      const w = lineW(_linOfDb(dbOfX(px, g)));
      const y = yOfPx(w, g) - w / 2;
      if (px === g.x0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    for (let px = g.x1; px >= g.x0; px -= 2) {
      const w = lineW(_linOfDb(dbOfX(px, g)));
      ctx.lineTo(px, yOfPx(w, g) + w / 2);
    }
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;

    // ── The GRAIN law: flat under the quiet end, the ramp, flat over the loud
    // end — drawn flat because `normalise` CLAMPS, and a clamp that is not
    // drawn is the half of this nobody could see from four sliders. It starts
    // at the GATE, because left of that there is no dot to have a size.
    ctx.strokeStyle = muted; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(Math.max(g.x0, xGate), yLo); ctx.lineTo(xLo, yLo);
    ctx.lineTo(xHi, yHi); ctx.lineTo(g.x1, yHi);
    ctx.stroke();

    // Marks at their REAL radii along the ramp. "22" says nothing; a 22px dot
    // is 22px, which is the whole reason this is a canvas and not a row.
    ctx.fillStyle = _tok('--eng-grain', '#e8a030');
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x = xLo + (xHi - xLo) * t;
      const px = S.vizMinSize + (S.vizMaxSize - S.vizMinSize) * t;
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.arc(x, yOfPx(px * 2, g), px, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // The gate's own line and label, on top of everything it governs.
    ctx.strokeStyle = _tok('--status-error', '#d48770'); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(xGate, g.y0); ctx.lineTo(xGate, g.y1); ctx.stroke();
    ctx.fillStyle = _tok('--status-error', '#d48770'); ctx.textAlign = 'left';
    ctx.fillText('gate', Math.min(xGate + 5, g.x1 - 26), g.y0 + 5);
    // A grip at the foot of the line: a thing you can drag has to look like one
    // (the memory rule — an affordance you have to discover is one you cannot
    // find from behind an instrument).
    ctx.beginPath(); ctx.arc(xGate, g.y1, 4, 0, Math.PI * 2); ctx.fill();

    // THE LIVE NEEDLE — where what you are playing right now lands.
    const live = readGateLoudness();
    if (live != null && live > 0) {
      const lDb = clamp(_dbOfLin(live), FIG_DB_FLOOR, 0);
      const lx = xOfDb(lDb, g);
      const t = (hiDb - loDb) > 0 ? clamp((lDb - loDb) / (hiDb - loDb), 0, 1) : 0;
      const px = S.vizMinSize + (S.vizMaxSize - S.vizMinSize) * t;
      ctx.strokeStyle = accent; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lx, g.y0); ctx.lineTo(lx, g.y1); ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(lx, yOfPx(px * 2, g), px, 0, Math.PI * 2); ctx.fill();
    }

    // The two handles, each labelled with the pair it carries.
    // Each handle carries the PAIR it sets, because that pairing — this loudness
    // draws this size — is the thing four sliders in two sections could not say.
    // The label flips to the inside of whichever end it is on, so neither runs
    // off the box, and it is measured rather than guessed at.
    const handle = (x, y, label, side) => {
      ctx.fillStyle = light;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = muted;
      const w = ctx.measureText(label).width;
      ctx.textAlign = 'left';
      const lx = side === 'hi' ? Math.max(g.x0 + 2, x - 9 - w) : Math.min(x + 9, g.x1 - w - 2);
      ctx.fillText(label, lx, clamp(y - 12, g.y0 + 6, g.y1 - 6));
    };
    const dbTxt = v => (v < 0 ? '\u2212' : '') + Math.abs(v).toFixed(0) + ' dB';
    handle(xLo, yLo, `${dbTxt(loDb)} \u00b7 ${S.vizMinSize.toFixed(1)}px`, 'lo');
    handle(xHi, yHi, `${dbTxt(hiDb)} \u00b7 ${S.vizMaxSize.toFixed(0)}px`, 'hi');

    // The y axis says what the height IS, or the dots are decoration.
    ctx.fillStyle = dim; ctx.textAlign = 'left';
    ctx.fillText('size', g.x0 + 2, g.y0 + 4);
  }

  // ── Dragging ──────────────────────────────────────────────────────────────
  // Whichever end is nearer the press. Both axes at once: x is the loudness
  // that end answers to, y is the size it draws — which is exactly the pairing
  // the four sliders hid by putting the two halves in different sections.
  const pick = (e) => {
    const g = geom(), r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const dLo = Math.hypot(x - xOfDb(clamp(_dbOfLin(S.vizRmsMin), FIG_DB_FLOOR, 0), g), y - yOfPx(S.vizMinSize * 2, g));
    const dHi = Math.hypot(x - xOfDb(clamp(_dbOfLin(S.vizRmsMax), FIG_DB_FLOOR, 0), g), y - yOfPx(S.vizMaxSize * 2, g));
    // The gate is a LINE, so its distance is horizontal only — otherwise it
    // could only be caught near the grip, and the line is the thing you see.
    const dGate = Math.abs(x - xOfDb(clamp(_dbOfLin(S.paintGateThreshold), FIG_DB_FLOOR, 0), g));
    if (dGate <= 10 && dGate < dLo && dGate < dHi) return 'gate';
    return dLo <= dHi ? 'lo' : 'hi';
  };
  const apply = (e) => {
    const g = geom(), r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const db = clamp(dbOfX(x, g), FIG_DB_FLOOR, 0);
    const px = clamp(pxOfY(y, g) / 2, 1, 300);
    if (drag === 'gate') {
      // X ONLY: the gate has no size of its own, it decides whether there is a
      // mark to have one.
      //
      // THROUGH `S._setPaintGateThreshold`, NOT BY WRITING S DIRECTLY. That
      // setter is the one door every other writer already uses — the Audio
      // page's canvas drag, MIDI cc, OSC /paint/gate — and it clamps to
      // GATE_METER_MAX and then calls _syncGateVal(), which pushes the value
      // into the modal's slider, the hidden main-panel carrier and the numeric
      // readouts. Writing S.paintGateThreshold raw set the threshold correctly
      // and left every one of those mirrors stale, including the cc-mirror
      // snapshot a MIDI controller reads its feedback from.
      S._setPaintGateThreshold?.(_linOfDb(db));
      return;
    }
    if (drag === 'lo') {
      // The ends may not cross: the quiet end stays quieter and smaller.
      S.vizRmsMin  = clamp(_linOfDb(db), 0, S.vizRmsMax * 0.95);
      S.vizMinSize = clamp(px, 1, S.vizMaxSize - 1);
    } else {
      S.vizRmsMax  = clamp(_linOfDb(db), S.vizRmsMin / 0.95, 1);
      S.vizMaxSize = clamp(px, S.vizMinSize + 1, 300);
    }
  };
  cv.addEventListener('pointerdown', e => {
    drag = pick(e); cv.classList.add('dragging');
    cv.setPointerCapture(e.pointerId); apply(e); e.preventDefault();
  });
  cv.addEventListener('pointermove', e => { if (drag) apply(e); });
  const end = () => { drag = null; cv.classList.remove('dragging'); };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);

  // ── The tick ──────────────────────────────────────────────────────────────
  // ONLY WHILE THE FIGURE IS ON SCREEN. The render loop and the 10 ms grain
  // scheduler share this thread (docs/RULINGS.md "Render path"), and a settings
  // canvas repainting behind a closed modal would be per-frame work for nothing.
  // An IntersectionObserver is the one reading that stays true when the page is
  // navigated away from, scrolled past, or the modal is closed.
  let raf = 0;
  const loop = () => { draw(); raf = requestAnimationFrame(loop); };
  const io = new IntersectionObserver(([en]) => {
    if (en.isIntersecting && !raf) loop();
    else if (!en.isIntersecting && raf) { cancelAnimationFrame(raf); raf = 0; }
  }, { threshold: 0.01 });
  io.observe(cv);
}
