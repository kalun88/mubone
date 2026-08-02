// ============================================================================
// erase.js — Erase brush
//
// Momentary hold-to-erase at the main cursor.  While the erase input is held
// (hold F / /erase/hold / panel button), a ~30ms ticker removes the particles
// the scanner could currently hear: inside the cursor's search radius AND
// passing the same local recency filter grain.js uses for candidate pools.
//
// Because recency is ranked from the in-radius subset only (local universe,
// mirroring _buildCandidatePoolRadius), erasing the newest buffers under the
// cursor reveals older buffers on the very next scheduler tick.  One hold is
// ONE eraser pass: buffers hidden underneath at first sighting are protected
// for the rest of the stroke (_strokeFate), so the revealed layer stays
// audible — release and press again to dig deeper into recording history.
//
// Undo: one level via the existing sweep-snapshot machinery.  A snapshot is
// stashed at stroke start; ⌘Z within the undo window restores it (30s
// auto-commit closes the window and frees the snapshot arrays).
//
// Deliberately NOT done here:
//  - No killAllGrains/flush — in-flight grains ring out through their
//    envelopes (≤200ms), identical to the lifted-pen tail (see the undo
//    rationale in ui-samples.js).
//  - No liveRecBuffers compaction — main-thread buffer slots keep their
//    indices so particle/strokeHistory references stay valid mid-performance.
//    Consequence: the erase brush frees NO audio buffer memory — resync at
//    snapshot commit keeps everything reachable from S.liveRecBuffers, which
//    we don't touch.  Erased buffers are reclaimed by the next sweep /
//    erase-all (which do compact).  Erasing never ADDS memory, so this is
//    the status quo; a compacting pass is a possible later feature but note
//    sweep-undo's survivor-index caveat before copying its cleanup here.
//  - Recording is never touched — erasing mid-recording leaves the live
//    accumulator continuous (see the eraseAll comment in ui-sweep.js re the
//    #127 desync fix); erased material simply becomes unreachable.
// ============================================================================

import { S } from './state.js';
import { getCursorLonLat, screenToLonLat } from './sphere.js';
import { getBufferKey, stampCartesian } from './grain.js';
import { commitSweep, scheduleSweepAutoCommit } from './ui-sweep.js';

// Tick cadence — matches the grain scheduler's spatial-search rhythm.  Each
// tick is one O(particles) pass with cached-Cartesian dot products (no acos),
// comparable to a single seed's candidate build; no measurable scheduler load.
const TICK_MS = 30;

let _intervalId   = null;
let _strokeErased = 0;    // particles removed during the current stroke
let _ourSnapshot  = null; // the snapshot THIS stroke stashed — never touch others'

// Reusable per-tick structures (mirrors the _recBufRec pattern in grain.js)
const _bufRec  = new Map();   // bufferKey → max strokeId among in-radius particles
const _allowed = new Set();   // bufferKeys the scan could hear this tick
const _sortBuf = [];

// Per-stroke layer classification — this is what makes the reveal audible.
// A buffer's fate is decided the FIRST tick it appears in radius during a
// stroke: audible then (in the scan's local top-N) → target for the rest of
// the stroke; hidden underneath → protected.  Without this, the per-tick
// recency re-rank would dig through every layer while holding still (each
// erased layer promotes the next one into the top-N ~30ms later) and the
// whole cloud would vanish with nothing revealed.  One hold = one eraser
// pass over what was audible; release and press again to dig deeper.
const _strokeFate = new Map();  // bufferKey → true (erase) | false (protect)

// ── Cursor position (same resolution order as paint-ticker.js) ──────────────
function _cursorLonLat() {
  if (S.cursorQ) return getCursorLonLat();
  return screenToLonLat(
    S.altLocked ? S.altFrozenMousePixelX : S.mousePixelX,
    S.altLocked ? S.altFrozenMousePixelY : S.mousePixelY
  );
}

// ── Core tick — erase what the scan can hear ─────────────────────────────────
function _eraseTick() {
  if (!S.eraseHeld) return;
  const parts = S.particles;
  if (parts.length === 0) return;

  // Mouse mode with no active cursor (mirrors the drawCursor guard): the
  // last mouse position is stale and invisible — don't erase blind.
  if (!S.cursorQ && !S.mouseInCanvas && !S.altLocked) return;

  const { lon, lat } = _cursorLonLat();
  const cosLat = Math.cos(lat);
  const rx = cosLat * Math.sin(lon);
  const ry = Math.sin(lat);
  const rz = cosLat * Math.cos(lon);
  // Inside radius ⇔ angle < r ⇔ dot > cos(r) — avoids acos in the hot loop
  const cosR = Math.cos(S.searchRadiusDeg * Math.PI / 180);

  // Phase 1: rank recency from ONLY the in-radius particles (local universe —
  // identical semantics to _buildCandidatePoolRadius in grain.js).
  _bufRec.clear();
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p._cx === undefined) stampCartesian(p);  // same guard as grain.js — NaN dot would misclassify
    if (p._cx * rx + p._cy * ry + p._cz * rz <= cosR) continue;
    const key = getBufferKey(p);
    if ((_bufRec.get(key) ?? -Infinity) < p.strokeId) _bufRec.set(key, p.strokeId);
  }
  if (_bufRec.size === 0) return;   // nothing under the brush

  // What can the scan hear right now?  Same rule as _buildCandidatePoolRadius:
  // top recencyN buffers by strokeId among in-radius keys; recencyN = 0 means
  // no recency cut — every in-radius buffer is audible.
  _allowed.clear();
  if (S.recencyN > 0 && _bufRec.size > S.recencyN) {
    _sortBuf.length = 0;
    for (const entry of _bufRec) _sortBuf.push(entry);        // [key, strokeId]
    _sortBuf.sort((a, b) => b[1] - a[1]);
    for (let i = 0; i < S.recencyN; i++) _allowed.add(_sortBuf[i][0]);
  } else {
    for (const key of _bufRec.keys()) _allowed.add(key);
  }

  // Classify buffers on first sighting this stroke: audible → target,
  // hidden → protected.  Classification is sticky for the stroke, so layers
  // revealed by the erase stay revealed (see _strokeFate comment above).
  for (const key of _bufRec.keys()) {
    if (!_strokeFate.has(key)) _strokeFate.set(key, _allowed.has(key));
  }

  // Phase 2: remove in-radius particles belonging to target buffers.
  const before = parts.length;
  const next = parts.filter(p => {
    if (p._cx * rx + p._cy * ry + p._cz * rz <= cosR) return true;  // outside — keep
    return !_strokeFate.get(getBufferKey(p));                       // protected — keep
  });
  const removed = before - next.length;
  if (removed === 0) return;

  S.particles = next;
  S._particleVersion++;
  _strokeErased += removed;
  // No grain flush — the next scheduler tick (≤20ms) rebuilds candidate pools
  // without the removed particles; in-flight grains finish their envelopes.
  S._syncEraseUI?.();
}

// Drop strokeHistory entries whose particles are all gone, so a later undo
// doesn't target an invisible stroke (and splice its buffer out from under
// live references).  The in-progress paint stroke is always preserved.
// The erased stroke entries live on in the snapshot, so undo restores them.
function _pruneStrokeHistory() {
  const alive = new Set();
  for (let i = 0; i < S.particles.length; i++) alive.add(S.particles[i].strokeId);
  S.strokeHistory = S.strokeHistory.filter(
    e => alive.has(e.strokeId) || e.strokeId === S.currentStrokeId
  );
}

// ── Stroke lifecycle ─────────────────────────────────────────────────────────

export function startEraseStroke() {
  if (S.eraseHeld) return;
  // Any pending sweep/erase snapshot becomes permanent (same rule as
  // recordStrokeStart), then stash a fresh one for one-level undo.
  commitSweep();
  _ourSnapshot = S._sweepSnapshot = {
    particles:            [...S.particles],
    liveRecBuffers:       S.liveRecBuffers ? [...S.liveRecBuffers] : [],
    currentLiveBufferIdx: S.currentLiveBufferIdx,
    strokeHistory:        [...S.strokeHistory],
  };
  S.eraseHeld   = true;
  _strokeErased = 0;
  _strokeFate.clear();                // fresh layer classification per stroke
  _eraseTick();                       // immediate first bite — no 30ms latency
  if (!_intervalId) _intervalId = setInterval(_eraseTick, TICK_MS);
  S._syncEraseUI?.();
}

export function stopEraseStroke() {
  if (!S.eraseHeld) return;
  S.eraseHeld = false;
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
  // Only manage the snapshot if it's still OURS — sweep / erase-all / undo
  // may have replaced or consumed it mid-hold, and their undo lifecycles
  // must not be disturbed by our release.
  const snapshotIsOurs = S._sweepSnapshot === _ourSnapshot;
  if (_strokeErased === 0) {
    if (snapshotIsOurs) S._sweepSnapshot = null;   // nothing changed — no undo entry
  } else {
    _pruneStrokeHistory();
    if (snapshotIsOurs) scheduleSweepAutoCommit(); // 30s undo window, then buffers released
    S.updateLiveRecUI?.();
  }
  _ourSnapshot = null;
  S._syncEraseUI?.(_strokeErased);
}

// ── UI wiring ────────────────────────────────────────────────────────────────

export function initEraseUI() {
  // Safety: window blur eats the keyup — stop the stroke so the eraser
  // doesn't keep ticking at a frozen (or sensor-driven) cursor position.
  window.addEventListener('blur', stopEraseStroke);

  const btn = document.getElementById('eraseHoldBtn');
  if (!btn) return;
  const origHtml = btn.innerHTML;
  let _flashTimer = null;

  // Momentary: press-and-hold the button erases, release stops.
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.setPointerCapture?.(e.pointerId);
    startEraseStroke();
  });
  const _release = () => stopEraseStroke();
  btn.addEventListener('pointerup', _release);
  btn.addEventListener('pointercancel', _release);

  S._syncEraseUI = (finalCount) => {
    btn.classList.toggle('erase-active', S.eraseHeld);
    if (S.eraseHeld) {
      // Live count while scrubbing
      if (_flashTimer) { clearTimeout(_flashTimer); _flashTimer = null; }
      btn.textContent = _strokeErased > 0 ? `erasing ${_strokeErased}` : 'erasing…';
      return;
    }
    if (finalCount > 0) {
      btn.textContent = `✓ erased ${finalCount}`;
      btn.classList.add('flashing');
      _flashTimer = setTimeout(() => {
        btn.classList.remove('flashing');
        btn.innerHTML = origHtml;
        _flashTimer = null;
      }, 1200);
    } else {
      btn.innerHTML = origHtml;
    }
  };
}
