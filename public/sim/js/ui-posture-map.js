// ============================================================================
// ui-posture-map.js — Staging-modal posture map (equirectangular world-map)
//
// The whole posture space is visible at once: daz (horizontal, ±180°) maps to
// screen X, dpitch (vertical, ±90°) maps to screen Y, droll becomes the
// rotation of a small "up-stem" through each dot.  Grid lines are horizontal
// parallels + vertical meridians, just like a plate-carrée world map.  No
// camera, no FOV — you always see everything.
//
// The staging sphere is deliberately insulated from the main granulator viz:
// it reads S.staging.relational (daz/dpitch/droll in degrees) and each
// snapshot's stored identity triple, and never touches S.camQ / S.frameQ /
// S.cursorQ.  The quat → identity translation lives entirely in
// relational-features.tickRelational() / recomputeStagingTelemetry(), so this
// file only has to plot the resulting angles.
//
// Interactions (camera is fixed — there's no orbit):
//   click empty space on the map → captureSnapshot() at current live identity
//   click a dot                  → select + host callback (scrolls the table)
//   right-click a dot            → deleteSnapshot()
//
// Wrap-around: a snapshot at daz=+175° and a cursor at daz=-175° are 10° apart
// on the sphere but sit on opposite edges of the flat map.  That's a known
// equirectangular artifact; for posture staging it's acceptable because the
// typical working range is ±60° and you rarely live near the daz wrap.
// ============================================================================

import { S } from './state.js';
import {
  captureSnapshot,
  deleteSnapshot,
  evaluateLock,
  recomputeStagingTelemetry,
} from './snapshot-engine.js';
import {
  IDENTITY_AXES,
  tickRelational,
  identityVectorFromRelational,
} from './relational-features.js';

// ── Constants ───────────────────────────────────────────────────────────────

const DEG       = Math.PI / 180;
const GRID_STEP = 30;   // degrees between grid lines

const COLOR = {
  gridMinor:   'rgba(160,170,200,0.14)',
  gridMajor:   'rgba(200,210,240,0.26)',
  axisLabel:   'rgba(200,210,230,0.75)',
  frame:       'rgba(180,190,220,0.35)',   // outer border of the map
  snapshot:    '#e2b464',
  snapshotSel: '#ffd98a',
  snapshotTxt: 'rgba(230,230,240,0.9)',
  cursor:      '#66d0ff',
  cursorRing:  'rgba(102,208,255,0.35)',
  weightLine:  '#66d0ff',
  hud:         'rgba(180,180,200,0.6)',
  lockRing:    '#6fe09a',
  lockText:    '#9eecb8',
  rollTickSnap:   'rgba(40,28,14,0.85)',
  rollTickCursor: 'rgba(240,248,255,0.95)',
};

// ── Module state ────────────────────────────────────────────────────────────

let _canvas    = null;
let _ctx       = null;
let _container = null;
let _resizeObs = null;

let _width       = 0;
let _height      = 0;
let _rafId       = null;
let _lastFrameAt = 0;

let _hoverId    = null;
let _selectedId = null;
let _selectCb   = null;
let _changedCb  = null;

let _lastHits = [];   // [{id, sx, sy, r}] per-frame hit-test cache

// ── Public API ──────────────────────────────────────────────────────────────

export function initPostureMap(container, opts = {}) {
  if (_canvas || !container) return;
  _container = container;
  _selectCb  = opts.onSelect  || null;
  _changedCb = opts.onChanged || null;

  _canvas = document.createElement('canvas');
  _canvas.className = 'posture-map-canvas';
  _canvas.style.width   = '100%';
  _canvas.style.height  = '100%';
  _canvas.style.display = 'block';
  _canvas.style.cursor  = 'crosshair';
  container.appendChild(_canvas);
  _ctx = _canvas.getContext('2d');

  _attachPointerHandlers();
  _resize();

  if (typeof ResizeObserver === 'function') {
    _resizeObs = new ResizeObserver(_resize);
    _resizeObs.observe(container);
  } else {
    window.addEventListener('resize', _resize);
  }

  _loop();
}

export function destroyPostureMap() {
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  if (_resizeObs) { _resizeObs.disconnect(); _resizeObs = null; }
  else window.removeEventListener('resize', _resize);
  if (_canvas && _canvas.parentNode) _canvas.parentNode.removeChild(_canvas);
  _canvas = null;
  _ctx = null;
  _container = null;
}

export function pokePostureMap() { _lastFrameAt = 0; }
export function clearPostureSelection() { _selectedId = null; }

// ── Canvas sizing ───────────────────────────────────────────────────────────

function _resize() {
  if (!_canvas || !_container) return;
  const r = _container.getBoundingClientRect();
  const w = Math.max(160, Math.floor(r.width));
  const h = Math.max(140, Math.floor(r.height));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  _canvas.width  = w * dpr;
  _canvas.height = h * dpr;
  _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  _width  = w;
  _height = h;
}

// ── Projection ──────────────────────────────────────────────────────────────
// Plate-carrée: daz → X (±180° spans the full width), dpitch → Y (±90° spans
// the full height, inverted because canvas Y grows downward).  Invert for
// hit-testing (screen → identity) so clicks on empty space drop snapshots at
// the point the user pointed to.

function _project(dazDeg, dpitchDeg) {
  const sx = _width  * 0.5 + (dazDeg    / 180) * (_width  * 0.5);
  const sy = _height * 0.5 - (dpitchDeg / 90)  * (_height * 0.5);
  return { sx, sy };
}

function _unproject(sx, sy) {
  const dazDeg    = (sx - _width  * 0.5) / (_width  * 0.5) * 180;
  const dpitchDeg = (_height * 0.5 - sy) / (_height * 0.5) * 90;
  return { dazDeg, dpitchDeg };
}

// ── Pointer handling ────────────────────────────────────────────────────────

function _localPos(e) {
  const r = _canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function _hitTest(x, y) {
  // Front-most dot (drawn last) wins — scan back to front.
  for (let i = _lastHits.length - 1; i >= 0; i--) {
    const h = _lastHits[i];
    const dx = x - h.sx, dy = y - h.sy;
    if (dx * dx + dy * dy <= h.r * h.r) return h;
  }
  return null;
}

function _fireChanged() {
  try { _changedCb?.(); } catch (err) { console.warn('[posture-map] onChanged:', err); }
}

function _attachPointerHandlers() {
  _canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    _canvas.setPointerCapture?.(e.pointerId);
  });

  _canvas.addEventListener('pointermove', (e) => {
    const p = _localPos(e);
    const h = _hitTest(p.x, p.y);
    _hoverId = h ? h.id : null;
    _canvas.style.cursor = h ? 'pointer' : 'crosshair';
  });

  _canvas.addEventListener('pointerleave', () => {
    _hoverId = null;
    _canvas.style.cursor = 'crosshair';
  });

  _canvas.addEventListener('pointerup', (e) => {
    _canvas.releasePointerCapture?.(e.pointerId);
    const p = _localPos(e);
    const h = _hitTest(p.x, p.y);
    const rightBtn = e.button === 2;

    if (rightBtn) {
      if (h) {
        deleteSnapshot(h.id);
        if (_selectedId === h.id) _selectedId = null;
        _fireChanged();
      }
      return;
    }

    if (h) {
      _selectedId = h.id;
      try { _selectCb?.(h.id); } catch (err) { console.warn('[posture-map] onSelect:', err); }
    } else {
      // Drop a snapshot at the current LIVE identity (not at the click
      // location).  Dropping where the cursor currently is is the natural
      // "capture this posture" action — clicking an arbitrary point on the
      // map to create a sensor-less snapshot isn't meaningful for staging.
      const snap = captureSnapshot();
      if (snap) _selectedId = snap.id;
      _fireChanged();
    }
  });

  _canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ── Grid + frame ────────────────────────────────────────────────────────────

function _drawGrid() {
  // Outer border — subtle rectangle outlining the map.
  _ctx.strokeStyle = COLOR.frame;
  _ctx.lineWidth = 1;
  _ctx.strokeRect(0.5, 0.5, _width - 1, _height - 1);

  // Meridians (vertical lines of constant daz).
  for (let lonDeg = -180; lonDeg <= 180; lonDeg += GRID_STEP) {
    const { sx } = _project(lonDeg, 0);
    const isMajor = lonDeg === 0;
    _ctx.strokeStyle = isMajor ? COLOR.gridMajor : COLOR.gridMinor;
    _ctx.lineWidth = isMajor ? 1.2 : 0.8;
    _ctx.beginPath();
    _ctx.moveTo(sx, 0);
    _ctx.lineTo(sx, _height);
    _ctx.stroke();
  }

  // Parallels (horizontal lines of constant dpitch).
  for (let latDeg = -90; latDeg <= 90; latDeg += GRID_STEP) {
    const { sy } = _project(0, latDeg);
    const isMajor = latDeg === 0;
    _ctx.strokeStyle = isMajor ? COLOR.gridMajor : COLOR.gridMinor;
    _ctx.lineWidth = isMajor ? 1.2 : 0.8;
    _ctx.beginPath();
    _ctx.moveTo(0, sy);
    _ctx.lineTo(_width, sy);
    _ctx.stroke();
  }

  // Axis tick labels — every 60° on the equator / prime meridian.
  _ctx.font = '9px Inter, sans-serif';
  _ctx.fillStyle = COLOR.axisLabel;
  _ctx.textBaseline = 'middle';
  _ctx.textAlign = 'center';
  for (const lonDeg of [-180, -120, -60, 60, 120, 180]) {
    const { sx } = _project(lonDeg, 0);
    _ctx.fillText(`${lonDeg > 0 ? '+' : ''}${lonDeg}°`, sx, _height - 7);
  }
  _ctx.textAlign = 'left';
  for (const latDeg of [-60, -30, 30, 60]) {
    const { sy } = _project(0, latDeg);
    _ctx.fillText(`${latDeg > 0 ? '+' : ''}${latDeg}°`, 4, sy);
  }
  _ctx.textAlign = 'start';
}

// ── Roll stem ───────────────────────────────────────────────────────────────
// Short arrow-less stem through the dot in the sensor's local up direction.
// 0° roll → points up on screen; positive roll rotates CW (matching the
// performer's physical CW-roll intuition, per the sign convention set in
// relational-features._writeIdentity).  One-sided geometry disambiguates
// 90° from 270° without needing an arrowhead — the small filled tip-dot
// just punctuates the "up end".
function _drawRollTick(sx, sy, rollDeg, length, color) {
  if (!Number.isFinite(rollDeg)) return;
  // Canvas angle 0 = +X (right); 0° roll should point up → offset by -π/2.
  const a = rollDeg * DEG - Math.PI / 2;
  const cx = Math.cos(a), cy = Math.sin(a);
  const tipX = sx + length * cx;
  const tipY = sy + length * cy;

  _ctx.strokeStyle = color;
  _ctx.lineWidth = 1.8;
  _ctx.lineCap = 'round';
  _ctx.beginPath();
  _ctx.moveTo(sx, sy);
  _ctx.lineTo(tipX, tipY);
  _ctx.stroke();

  _ctx.fillStyle = color;
  _ctx.beginPath();
  _ctx.arc(tipX, tipY, 1.8, 0, Math.PI * 2);
  _ctx.fill();

  _ctx.lineCap = 'butt';
  _ctx.lineWidth = 1;
}

// ── Main loop ───────────────────────────────────────────────────────────────

function _loop() {
  _rafId = requestAnimationFrame(_loop);
  const now = performance.now();
  if (now - _lastFrameAt < 33) return;
  _lastFrameAt = now;
  _draw(now);
}

function _draw(now) {
  if (!_ctx) return;
  _ctx.clearRect(0, 0, _width, _height);

  const staging = S.staging || {};
  const snaps   = staging.snapshots || [];

  // Drive telemetry + live relational vector every frame whenever the engine
  // isn't running — so weight arcs, per-channel readouts, and the identity
  // vector all stay live while the performer is exploring.  When running,
  // skip the recompute to avoid clobbering the emitted perChannel state.
  if (staging.running) {
    tickRelational();
  } else {
    recomputeStagingTelemetry();
  }

  const tel     = staging.telemetry || {};
  const weights = tel.weights || [];
  const rel     = staging.relational || { daz: 0, dpitch: 0, droll: 0, hasCursor: false };
  const liveIdentity = identityVectorFromRelational(rel);

  _drawGrid();

  const lock = evaluateLock();

  // Cursor screen position (or null if no sensor in view).
  const cursorVisible = !!rel.hasCursor;
  const cursorScreen = cursorVisible
    ? _project(rel.daz || 0, rel.dpitch || 0)
    : null;

  // Project every snapshot.  Snapshot identity is stored in degrees.
  const items = [];
  for (let i = 0; i < snaps.length; i++) {
    const s = snaps[i];
    const [daz, dpitch, droll] = s.identity || [0, 0, 0];
    const { sx, sy } = _project(daz, dpitch);
    items.push({
      id:     s.id,
      label:  s.label,
      sx, sy,
      weight: weights[i] ?? 0,
      roll:   droll,
      isLock: lock && lock.locked && lock.id === s.id,
    });
  }

  // Weight lines cursor → snapshot (behind the dots).
  if (cursorScreen) {
    for (const it of items) {
      if (it.weight < 0.01) continue;
      _ctx.beginPath();
      _ctx.moveTo(cursorScreen.sx, cursorScreen.sy);
      _ctx.lineTo(it.sx, it.sy);
      _ctx.strokeStyle = COLOR.weightLine;
      _ctx.globalAlpha = Math.min(0.8, 0.15 + it.weight * 0.75);
      _ctx.lineWidth = 0.6 + it.weight * 2.4;
      _ctx.stroke();
    }
    _ctx.globalAlpha = 1;
    _ctx.lineWidth = 1;
  }

  // Refresh hit-test cache in sync with this frame's layout.
  _lastHits.length = 0;

  for (const it of items) {
    const r = 7;
    const isSel = it.id === _selectedId;
    const isHov = it.id === _hoverId;

    if (isSel || isHov) {
      _ctx.beginPath();
      _ctx.arc(it.sx, it.sy, r + 4, 0, Math.PI * 2);
      _ctx.fillStyle = isSel ? 'rgba(255,217,138,0.22)' : 'rgba(255,255,255,0.14)';
      _ctx.fill();
    }

    _ctx.beginPath();
    _ctx.arc(it.sx, it.sy, r, 0, Math.PI * 2);
    _ctx.fillStyle = isSel ? COLOR.snapshotSel : COLOR.snapshot;
    _ctx.fill();
    _ctx.strokeStyle = 'rgba(10,10,14,0.7)';
    _ctx.lineWidth = 1;
    _ctx.stroke();

    _drawRollTick(it.sx, it.sy, it.roll, r * 1.6, COLOR.rollTickSnap);

    if (it.weight > 0.01) {
      _ctx.beginPath();
      _ctx.arc(it.sx, it.sy, r + 2.5,
        -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * it.weight);
      _ctx.strokeStyle = COLOR.weightLine;
      _ctx.lineWidth = 1.8;
      _ctx.globalAlpha = 0.85;
      _ctx.stroke();
      _ctx.globalAlpha = 1;
    }

    if (it.isLock) {
      _ctx.beginPath();
      _ctx.arc(it.sx, it.sy, r + 4, 0, Math.PI * 2);
      _ctx.strokeStyle = COLOR.lockRing;
      _ctx.lineWidth = 2.2;
      _ctx.stroke();
    }

    _ctx.font = '10px Inter, sans-serif';
    _ctx.textBaseline = 'middle';
    _ctx.fillStyle = it.isLock ? COLOR.lockText : COLOR.snapshotTxt;
    _ctx.fillText((it.isLock ? '✓ ' : '') + (it.label || ''), it.sx + r + 5, it.sy);

    _lastHits.push({ id: it.id, sx: it.sx, sy: it.sy, r: r + 3 });
  }

  // Live cursor on top.
  if (cursorScreen) {
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
    _ctx.beginPath();
    _ctx.arc(cursorScreen.sx, cursorScreen.sy, 8 + 4 * pulse, 0, Math.PI * 2);
    _ctx.fillStyle = COLOR.cursorRing;
    _ctx.fill();
    _ctx.beginPath();
    _ctx.arc(cursorScreen.sx, cursorScreen.sy, 4, 0, Math.PI * 2);
    _ctx.fillStyle = COLOR.cursor;
    _ctx.fill();
    _ctx.strokeStyle = 'rgba(10,12,20,0.8)';
    _ctx.lineWidth = 1;
    _ctx.stroke();
    _drawRollTick(cursorScreen.sx, cursorScreen.sy, rel.droll || 0, 16, COLOR.rollTickCursor);
  } else {
    _ctx.font = '10px Inter, sans-serif';
    _ctx.textAlign = 'center';
    _ctx.fillStyle = 'rgba(160,160,180,0.5)';
    _ctx.fillText('(no cursor/frame sensor assigned)', _width / 2, _height / 2 + 2);
    _ctx.textAlign = 'start';
  }

  _drawHUD(liveIdentity, lock);
}

function _drawHUD(live, lock) {
  const lines = [
    `${IDENTITY_AXES[0]} ${_fmt(live[0])}°`,
    `${IDENTITY_AXES[1]} ${_fmt(live[1])}°`,
    `${IDENTITY_AXES[2]} ${_fmt(live[2])}°`,
    `snaps ${(S.staging?.snapshots?.length ?? 0)}`,
  ];
  _ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
  _ctx.textBaseline = 'top';
  let y = _height - 4 - (lines.length + (lock ? 1 : 0)) * 12;

  if (lock) {
    const snap = (S.staging?.snapshots || [])[lock.idx];
    const lbl = snap?.label || '—';
    _ctx.fillStyle = lock.locked ? COLOR.lockText : COLOR.hud;
    _ctx.fillText(
      (lock.locked ? `LOCK ✓  ${lbl}` : `near "${lbl}"`) +
      `   d=${lock.distance.toFixed(3)} / ${lock.threshold.toFixed(3)}`,
      6, y);
    y += 12;
  }

  _ctx.fillStyle = COLOR.hud;
  for (const ln of lines) { _ctx.fillText(ln, 6, y); y += 12; }

  _ctx.textBaseline = 'top';
  _ctx.textAlign = 'right';
  _ctx.fillStyle = 'rgba(160,160,180,0.45)';
  _ctx.fillText('click empty: drop snapshot  ·  click dot: select  ·  right-click: delete', _width - 6, 4);
  _ctx.textAlign = 'start';
}

function _fmt(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  const s = v >= 0 ? '+' : '−';
  return s + Math.abs(v).toFixed(1);
}
