// ============================================================================
// panel-drag.js — click-and-drag rearrangement for main-UI panels
//
// Two draggables (added 2026-07-06, replacing the ▲▼ reorder arrows):
//
//   1. Device tiles — grab any .device-label and drag. A placeholder shows
//      the insertion point; drop into any of the five .projector-col slots
//      (including the two nested under the canvas, and empty columns).
//      A ~5px movement threshold keeps plain clicks working as
//      collapse/expand toggles exactly as before.
//
//   2. The canvas block — grab the .canvas-drag-handle on the mini-canvas
//      tile and drag horizontally. A translucent preview shows which two
//      column slots the canvas would span; drop calls S._moveCanvasTo(pos)
//      (events.js), which re-nests columns without moving any tiles.
//
// Persistence rides the existing paths: S._savePanelOrder (main.js) after a
// tile drop — which also re-runs the projector partition and saves the v2
// layout — and _saveProjectorLayoutFromDom inside S._moveCanvasTo for the
// canvas position.
//
// Zero coupling to audio code. Uses pointer events with capture, so it works
// for mouse and touch alike (labels/handle set touch-action: none in CSS).
// ============================================================================

import { S } from './state.js';

const DRAG_THRESHOLD_PX = 5;

let _active = null;   // current drag session or null

// ── Helpers ─────────────────────────────────────────────────────────────────

function _panel() { return document.querySelector('.right-panel'); }

function _cols() {
  const panel = _panel();
  return panel ? [...panel.querySelectorAll('.projector-col')] : [];
}

/** Capture-phase click suppressor — swallows the click that fires after a
 *  real drag so the label's collapse toggle doesn't also run. The browser
 *  emits that click synchronously after pointerup (and only if the drag
 *  ended over the label), so the suppressor self-removes on the next task —
 *  it must NOT linger, or it would eat the user's next legitimate click. */
function _suppressNextClick(el) {
  const once = (e) => { e.stopPropagation(); e.preventDefault(); };
  el.addEventListener('click', once, { capture: true });
  setTimeout(() => el.removeEventListener('click', once, { capture: true }), 0);
}

// ── Tile dragging ───────────────────────────────────────────────────────────

function _beginTileDrag(sess) {
  const { device } = sess;
  const rect = device.getBoundingClientRect();
  sess.grabDX = sess.startX - rect.left;
  sess.grabDY = sess.startY - rect.top;

  // Placeholder keeps the column's flow while the tile floats.
  const ph = document.createElement('div');
  ph.className = 'panel-drag-placeholder';
  ph.style.height = `${rect.height}px`;
  device.parentNode.insertBefore(ph, device);
  sess.placeholder = ph;

  // Float the tile: fixed position, original size, above everything,
  // transparent to hit-testing so column detection sees through it.
  device.classList.add('panel-dragging-tile');
  Object.assign(device.style, {
    position: 'fixed',
    width: `${rect.width}px`,
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    zIndex: '999',
    pointerEvents: 'none',
    margin: '0',
  });
  document.body.classList.add('panel-dragging');
  sess.started = true;
}

function _tileDragMove(sess, x, y) {
  const { device, placeholder } = sess;
  device.style.left = `${x - sess.grabDX}px`;
  device.style.top  = `${y - sess.grabDY}px`;

  // Find the column under the pointer by bounding rect (the floated tile is
  // pointer-events: none, so rects are simpler and cheaper than
  // elementFromPoint here). Columns get a min-height while dragging (CSS)
  // so empty ones are hittable.
  let target = null;
  for (const col of _cols()) {
    const r = col.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top - 8 && y <= r.bottom + 8) {
      target = col;
      break;
    }
  }
  if (!target) return;   // outside any column — placeholder stays put

  // Insertion index: before the first tile whose vertical midpoint is below
  // the pointer. Skip the placeholder itself and the dragged tile.
  let before = null;
  for (const child of target.children) {
    if (child === placeholder || child === device) continue;
    const r = child.getBoundingClientRect();
    if (y < r.top + r.height / 2) { before = child; break; }
  }
  if (before) target.insertBefore(placeholder, before);
  else target.appendChild(placeholder);
}

function _endTileDrag(sess, cancelled) {
  const { device, placeholder } = sess;
  device.classList.remove('panel-dragging-tile');
  device.style.cssText = '';
  if (placeholder?.parentNode) {
    // Land the tile where the placeholder sits (also the right thing on
    // cancel — the placeholder never left the origin if no move happened).
    placeholder.parentNode.insertBefore(device, placeholder);
    placeholder.remove();
  }
  document.body.classList.remove('panel-dragging');
  if (!cancelled) {
    _suppressNextClick(sess.label);
    // Persist: main.js's saver writes document order AND re-runs the
    // partition (which saves the v2 projector layout from the DOM).
    S._savePanelOrder?.();
  }
}

// ── Canvas-block dragging ───────────────────────────────────────────────────

function _beginCanvasDrag(sess) {
  const preview = document.createElement('div');
  preview.className = 'canvas-drop-preview';
  document.body.appendChild(preview);
  sess.preview = preview;
  document.body.classList.add('panel-dragging');
  sess.started = true;
}

function _canvasPosFromX(x) {
  const panel = _panel();
  if (!panel) return null;
  const r = panel.getBoundingClientRect();
  const slotW = r.width / 5;
  // Pointer marks the CENTER of the desired 2-slot span.
  const pos = Math.round((x - r.left) / slotW - 1);
  return Math.max(0, Math.min(3, pos));
}

function _canvasDragMove(sess, x) {
  const panel = _panel();
  if (!panel || !sess.preview) return;
  const r = panel.getBoundingClientRect();
  const slotW = r.width / 5;
  const pos = _canvasPosFromX(x);
  sess.targetPos = pos;
  Object.assign(sess.preview.style, {
    left:   `${r.left + pos * slotW}px`,
    top:    `${r.top}px`,
    width:  `${slotW * 2}px`,
    height: `${Math.min(r.height, 260)}px`,
    display: 'block',
  });
}

function _endCanvasDrag(sess, cancelled) {
  sess.preview?.remove();
  document.body.classList.remove('panel-dragging');
  if (!cancelled && sess.targetPos != null) {
    S._moveCanvasTo?.(sess.targetPos);
  }
}

// ── Pointer plumbing (shared) ───────────────────────────────────────────────

function _onPointerMove(e) {
  if (!_active || e.pointerId !== _active.pointerId) return;
  const sess = _active;
  if (!sess.started) {
    const dx = e.clientX - sess.startX;
    const dy = e.clientY - sess.startY;
    if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
    sess.kind === 'tile' ? _beginTileDrag(sess) : _beginCanvasDrag(sess);
  }
  if (sess.kind === 'tile') _tileDragMove(sess, e.clientX, e.clientY);
  else _canvasDragMove(sess, e.clientX);
}

function _onPointerEnd(e) {
  if (!_active || e.pointerId !== _active.pointerId) return;
  const sess = _active;
  _active = null;
  document.removeEventListener('pointermove', _onPointerMove);
  document.removeEventListener('pointerup', _onPointerEnd);
  document.removeEventListener('pointercancel', _onPointerEnd);
  if (sess.started) {
    const cancelled = e.type === 'pointercancel';
    sess.kind === 'tile' ? _endTileDrag(sess, cancelled) : _endCanvasDrag(sess, cancelled);
  }
  // Not started → plain click; the label's collapse handler fires normally.
}

function _onPointerDown(e) {
  if (_active || e.button !== 0) return;

  const handle = e.target.closest?.('.canvas-drag-handle');
  const label  = handle ? null : e.target.closest?.('.device-label');
  if (!handle && !label) return;
  // Don't hijack interactive controls that live inside labels.
  if (label && e.target.closest('button, input, select, textarea')) return;

  const device = label?.closest('.device');
  if (label && !device) return;
  // Tiles are only draggable inside the projector column layout.
  if (label && !device.closest('.projector-col')) return;

  _active = {
    kind: handle ? 'canvas' : 'tile',
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    label, device,
    started: false,
    placeholder: null,
    preview: null,
    targetPos: null,
  };
  document.addEventListener('pointermove', _onPointerMove);
  document.addEventListener('pointerup', _onPointerEnd);
  document.addEventListener('pointercancel', _onPointerEnd);
}

// ── Init ────────────────────────────────────────────────────────────────────

export function initPanelDrag() {
  // Delegated — survives repartitioning, tile reordering, and the mini
  // wrapper being created after init.
  document.addEventListener('pointerdown', _onPointerDown);
}
