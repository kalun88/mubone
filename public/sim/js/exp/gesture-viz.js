// ============================================================================
// gesture-viz.js — Real-time visualization of gesture descriptor
//
// Two-part display:
//   1. Phase plot — 2D trajectory of two gesture features over time, showing
//      the *shape* and *history* of movement through feature space.
//   2. Sparkline trails — compact time-series for all five features, so you
//      can see each feature's temporal contour at a glance.
//
// Press G to toggle visibility.  Press X to cycle phase plot axis pairs.
// Only loaded when ?exp is in the URL.
// ============================================================================

import { S, DEBUG } from '../state.js';

let _canvas  = null;
let _ctx     = null;
let _rafId   = null;
let _visible = true;

// ── Layout ──────────────────────────────────────────────────────────────────
const W          = 280;
const H          = 420;
const M          = 10;     // margin
const PLOT_SIZE  = 180;    // phase plot square
const PLOT_X     = (W - PLOT_SIZE) / 2;
const PLOT_Y     = 28;
const SPARK_H    = 22;     // sparkline row height
const SPARK_GAP  = 3;
const SPARK_X    = 70;     // left edge of sparkline area
const SPARK_W    = W - SPARK_X - M;

// ── Colors ──────────────────────────────────────────────────────────────────
const COL_BG       = 'rgba(0, 0, 0, 0.78)';
const COL_GRID     = 'rgba(122, 188, 188, 0.08)';
const COL_AXIS     = 'rgba(122, 188, 188, 0.25)';
const COL_DIM      = '#4a7a7a';
const COL_TEXT     = '#7abcbc';

const FEATURES = [
  { key: 'smoothness',       label: 'smooth',  color: '#7abcbc' },  // teal
  { key: 'effort',           label: 'effort',  color: '#e8a030' },  // amber
  { key: 'directness',       label: 'direct',  color: '#a0ff6b' },  // green
  { key: 'periodicity',      label: 'period',  color: '#ce93d8' },  // violet
  { key: 'accumulatedEnergy', label: 'energy', color: '#ff6b6b' },  // coral
];

// Phase plot axis pair presets — cycle with X key
const AXIS_PAIRS = [
  { x: 0, y: 1, label: 'smooth × effort' },
  { x: 1, y: 3, label: 'effort × period' },
  { x: 0, y: 2, label: 'smooth × direct' },
  { x: 2, y: 3, label: 'direct × period' },
  { x: 1, y: 4, label: 'effort × energy' },
];
let _axisPairIdx = 0;

// ── History buffers ─────────────────────────────────────────────────────────
const TRAIL_LEN  = 180;   // ~3s at 60fps
const _trails    = {};     // key → Float32Array ring buffer
let   _trailIdx  = 0;

for (const f of FEATURES) {
  _trails[f.key] = new Float32Array(TRAIL_LEN);
}

// Phase plot trail (stores x,y pairs)
const _phaseTrailX = new Float32Array(TRAIL_LEN);
const _phaseTrailY = new Float32Array(TRAIL_LEN);

// ── Smoothed display values ─────────────────────────────────────────────────
const _disp = {};
for (const f of FEATURES) _disp[f.key] = f.key === 'directness' ? 1 : 0;
const SLEW = 0.15;

function slew(key, target) {
  _disp[key] += (target - _disp[key]) * SLEW;
  return _disp[key];
}

// ── Normalize energy to 0–1 for display ─────────────────────────────────────
function normalizeFeature(key, raw) {
  if (key === 'accumulatedEnergy') return Math.min(1, raw / 1.5);
  return raw;
}

// ── Drawing ─────────────────────────────────────────────────────────────────

function draw() {
  if (!_visible || !S.gesture) {
    _rafId = requestAnimationFrame(draw);
    return;
  }

  const g   = S.gesture;
  const ctx = _ctx;

  // Update smoothed values and record trails
  for (const f of FEATURES) {
    const raw = normalizeFeature(f.key, g[f.key]);
    const smoothed = slew(f.key, raw);
    _trails[f.key][_trailIdx % TRAIL_LEN] = smoothed;
  }

  // Record phase trail
  const ap = AXIS_PAIRS[_axisPairIdx];
  _phaseTrailX[_trailIdx % TRAIL_LEN] = _disp[FEATURES[ap.x].key];
  _phaseTrailY[_trailIdx % TRAIL_LEN] = _disp[FEATURES[ap.y].key];
  _trailIdx++;

  // Clear
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.beginPath();
  roundRect(ctx, 0, 0, W, H, 8);
  ctx.fillStyle = COL_BG;
  ctx.fill();

  // ── Phase plot ────────────────────────────────────────────────────────

  // Grid
  ctx.strokeStyle = COL_GRID;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const gx = PLOT_X + t * PLOT_SIZE;
    const gy = PLOT_Y + t * PLOT_SIZE;
    ctx.beginPath(); ctx.moveTo(gx, PLOT_Y); ctx.lineTo(gx, PLOT_Y + PLOT_SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PLOT_X, gy); ctx.lineTo(PLOT_X + PLOT_SIZE, gy); ctx.stroke();
  }

  // Axis lines (center cross)
  ctx.strokeStyle = COL_AXIS;
  ctx.lineWidth = 0.5;
  const cx = PLOT_X + PLOT_SIZE / 2;
  const cy = PLOT_Y + PLOT_SIZE / 2;
  ctx.beginPath(); ctx.moveTo(cx, PLOT_Y); ctx.lineTo(cx, PLOT_Y + PLOT_SIZE); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(PLOT_X, cy); ctx.lineTo(PLOT_X + PLOT_SIZE, cy); ctx.stroke();

  // Axis labels
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = FEATURES[ap.x].color;
  ctx.fillText(FEATURES[ap.x].label, PLOT_X + PLOT_SIZE / 2, PLOT_Y + PLOT_SIZE + 12);
  ctx.save();
  ctx.translate(PLOT_X - 10, PLOT_Y + PLOT_SIZE / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = FEATURES[ap.y].color;
  ctx.fillText(FEATURES[ap.y].label, 0, 0);
  ctx.restore();
  ctx.textAlign = 'left';

  // Trail — fading line from old to new
  const filled = Math.min(_trailIdx, TRAIL_LEN);
  if (filled > 1) {
    for (let i = 1; i < filled; i++) {
      const idx0 = (_trailIdx - filled + i - 1 + TRAIL_LEN) % TRAIL_LEN;
      const idx1 = (_trailIdx - filled + i + TRAIL_LEN) % TRAIL_LEN;

      const x0 = PLOT_X + _phaseTrailX[idx0] * PLOT_SIZE;
      const y0 = PLOT_Y + (1 - _phaseTrailY[idx0]) * PLOT_SIZE;
      const x1 = PLOT_X + _phaseTrailX[idx1] * PLOT_SIZE;
      const y1 = PLOT_Y + (1 - _phaseTrailY[idx1]) * PLOT_SIZE;

      const age = i / filled;  // 0 = oldest, 1 = newest
      const alpha = age * age;  // quadratic fade — old fades fast

      ctx.strokeStyle = `rgba(122, 188, 188, ${alpha * 0.7})`;
      ctx.lineWidth = 0.5 + age * 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // Current position dot
    const curIdx = (_trailIdx - 1 + TRAIL_LEN) % TRAIL_LEN;
    const dotX = PLOT_X + _phaseTrailX[curIdx] * PLOT_SIZE;
    const dotY = PLOT_Y + (1 - _phaseTrailY[curIdx]) * PLOT_SIZE;

    // Outer glow
    ctx.beginPath();
    ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(122, 188, 188, 0.2)';
    ctx.fill();

    // Inner dot
    ctx.beginPath();
    ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
    ctx.fillStyle = COL_TEXT;
    ctx.fill();
  }

  // Phase plot title
  ctx.fillStyle = COL_DIM;
  ctx.font = '8px monospace';
  ctx.fillText(`${ap.label}  [X cycle]`, PLOT_X, PLOT_Y - 4);

  // ── Sparkline trails ──────────────────────────────────────────────────
  let sy = PLOT_Y + PLOT_SIZE + 24;

  for (const f of FEATURES) {
    const trail = _trails[f.key];
    const val = _disp[f.key];

    // Label
    ctx.fillStyle = f.color;
    ctx.font = '9px monospace';
    ctx.fillText(f.label, M, sy + SPARK_H / 2 + 3);

    // Value
    ctx.fillStyle = COL_DIM;
    ctx.font = '8px monospace';
    const valStr = (val * 100).toFixed(0);
    ctx.fillText(valStr, M + 48, sy + SPARK_H / 2 + 3);

    // Sparkline background
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(SPARK_X, sy, SPARK_W, SPARK_H);

    // Sparkline trace
    const sparkFilled = Math.min(_trailIdx, TRAIL_LEN);
    if (sparkFilled > 1) {
      ctx.beginPath();
      for (let i = 0; i < sparkFilled; i++) {
        const idx = (_trailIdx - sparkFilled + i + TRAIL_LEN) % TRAIL_LEN;
        const px = SPARK_X + (i / (TRAIL_LEN - 1)) * SPARK_W;
        const py = sy + SPARK_H - trail[idx] * SPARK_H;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Fill under curve (subtle)
      ctx.lineTo(SPARK_X + ((sparkFilled - 1) / (TRAIL_LEN - 1)) * SPARK_W, sy + SPARK_H);
      ctx.lineTo(SPARK_X, sy + SPARK_H);
      ctx.closePath();
      ctx.fillStyle = f.color.replace(')', ', 0.08)').replace('rgb', 'rgba');
      // Handle hex colors
      const rgba = hexToRGBA(f.color, 0.08);
      ctx.fillStyle = rgba;
      ctx.fill();
    }

    // Current value marker (right edge dot)
    const dotPy = sy + SPARK_H - val * SPARK_H;
    ctx.beginPath();
    ctx.arc(SPARK_X + SPARK_W, dotPy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = f.color;
    ctx.fill();

    sy += SPARK_H + SPARK_GAP;
  }

  // ── Raw data footer ───────────────────────────────────────────────────
  sy += 4;
  ctx.fillStyle = COL_DIM;
  ctx.font = '8px monospace';
  ctx.fillText(
    `gyro ${g.gyroMag.toFixed(0)}°/s  accel ${g.accelDynMag.toFixed(2)}g  jerk ${g.jerk.toFixed(0)}`,
    M, sy
  );
  if (g.periodicity > 0.2) {
    ctx.fillStyle = FEATURES[3].color;
    ctx.fillText(`  ${g.periodicityHz.toFixed(1)}Hz`, M + 188, sy);
  }

  _rafId = requestAnimationFrame(draw);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function hexToRGBA(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Init / destroy ──────────────────────────────────────────────────────────

export function initGestureViz() {
  const dpr = window.devicePixelRatio || 1;
  _canvas = document.createElement('canvas');
  _canvas.width  = W * dpr;
  _canvas.height = H * dpr;
  _canvas.style.cssText = `
    position: fixed;
    bottom: 12px;
    left: 12px;
    width: ${W}px;
    height: ${H}px;
    z-index: 9998;
    pointer-events: none;
  `;
  document.body.appendChild(_canvas);
  _ctx = _canvas.getContext('2d');
  _ctx.scale(dpr, dpr);

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

    // G — toggle visibility
    if (e.key === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      _visible = !_visible;
      _canvas.style.display = _visible ? '' : 'none';
    }

    // X — cycle phase plot axis pair
    if (e.key === 'x' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      _axisPairIdx = (_axisPairIdx + 1) % AXIS_PAIRS.length;
    }
  });

  _rafId = requestAnimationFrame(draw);

  DEBUG && console.log('[exp/gesture-viz] initialized — G toggle, X cycle axes');
}

export function destroyGestureViz() {
  if (_rafId) cancelAnimationFrame(_rafId);
  if (_canvas) _canvas.remove();
  _canvas = null;
  _ctx = null;
}
