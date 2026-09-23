// ============================================================================
// erase.js — Erase brush
//
// Momentary hold-to-erase at the main cursor.  While the erase input is held
// (hold F / /erase/hold / panel button), a ~30ms ticker removes the particles
// the scanner could currently hear: touched by the brush AND passing the same
// local recency filter grain.js uses for candidate pools.  "Touched" is a
// SWEPT CAPSULE — the segment the cursor moved since the last tick, fattened
// by the search radius — and for line material it includes the drawn segment
// between path-adjacent marks, so a small radius crossing a line between two
// marks still cuts it (see Phase 0).
//
// Because recency is ranked from the in-radius subset only (local universe,
// mirroring _buildCandidatePoolRadius), erasing the newest strokes under the
// cursor reveals older strokes on the very next scheduler tick (depth counts
// STROKES since 2026-09-23 — it was buffers).  One hold is
// ONE eraser pass: strokes hidden underneath at first sighting are protected
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
import { cursorLonLatNow } from './sphere.js';
import { depthKey, stampCartesian } from './grain.js';
import { snapshotMaterial, materialAction } from './ui-sweep.js';
import * as history from './history.js';

// Tick cadence — matches the grain scheduler's spatial-search rhythm.  Each
// tick is one O(particles) pass with cached-Cartesian dot products (no acos),
// comparable to a single seed's candidate build; no measurable scheduler load.
const TICK_MS = 30;

let _intervalId   = null;
let _strokeErased = 0;    // particles removed during the current stroke
let _before = null;              // the material before the erase stroke

// Reusable per-tick structures (mirrors the _recBufRec pattern in grain.js)
const _bufRec  = new Map();   // depthKey (the stroke) → its strokeId, among touched particles
const _allowed = new Set();   // the strokes the scan could hear this tick (depth counts strokes)
const _sortBuf = [];
const _hit        = new Set();  // particles the brush touches this tick
const _prevTrig   = new Map();  // strokeId → previous trig mark (segment pairing)
const _removedSet = new Set();  // this tick's removals, for the gap stamping
const _lastKept   = new Map();  // strokeId → last surviving mark seen
const _pendingGap = new Map();  // strokeId → a removal since the last survivor
// The previous tick's cursor, as a unit-sphere point — the brush sweeps the
// segment from there to here rather than stamping a sampled circle.
let _lastCx = 0, _lastCy = 0, _lastCz = 0, _haveLast = false;
let _lastTickAt = 0;   // performance.now() of the previous tick, for the guard
// Sweep waypoints (slerped along the great circle — see the subdivision note).
const _wayX = new Float64Array(21), _wayY = new Float64Array(21), _wayZ = new Float64Array(21);

// Squared distance from point P to segment AB (3D chords; radii are small
// enough that chord ≈ arc).
function _distPointSeg2(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 > 1e-12 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return dx * dx + dy * dy + dz * dz;
}

// Squared minimum distance between segments P1Q1 and P2Q2 (Ericson §5.1.9).
// Side channel: `_segS` is the closest-approach parameter along P1→Q1, so a
// caller can tell WHICH END of the mark segment the brush crossed nearest.
let _segS = 0;
function _distSegSeg2(p1x, p1y, p1z, q1x, q1y, q1z,
                      p2x, p2y, p2z, q2x, q2y, q2z) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x,  ry = p1y - p2y,  rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const EPS = 1e-12;
  let s, t;
  if (a <= EPS && e <= EPS) { s = 0; t = 0; }
  else if (a <= EPS) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > EPS ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0)      { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  _segS = s;
  const dx = (p1x + d1x * s) - (p2x + d2x * t);
  const dy = (p1y + d1y * s) - (p2y + d2y * t);
  const dz = (p1z + d1z * s) - (p2z + d2z * t);
  return dx * dx + dy * dy + dz * dz;
}

// Per-stroke layer classification — this is what makes the reveal audible.
// A stroke's fate is decided the FIRST tick it appears in radius during a
// stroke: audible then (in the scan's local top-N) → target for the rest of
// the stroke; hidden underneath → protected.  Without this, the per-tick
// recency re-rank would dig through every layer while holding still (each
// erased layer promotes the next one into the top-N ~30ms later) and the
// whole cloud would vanish with nothing revealed.  One hold = one eraser
// pass over what was audible; release and press again to dig deeper.
const _strokeFate = new Map();  // depthKey (the stroke) → true (erase) | false (protect)

// ── Cursor position — the ONE rule (sphere.js cursorLonLatNow) ─────────────
const _cursorLonLat = cursorLonLatNow;

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
  // The brush is a SWEPT CAPSULE, not a sampled circle: the segment from the
  // previous tick's cursor to this one, fattened by the radius. At small
  // radii a fast pass left untested stretches between the 30 ms samples.
  let ax = _haveLast ? _lastCx : rx;
  let ay = _haveLast ? _lastCy : ry;
  let az = _haveLast ? _lastCz : rz;
  // Publish the sweep so the cursor can DRAW what the brush actually removes
  // (Ek, 2026-08-29: "the radius should erase what it erases and look like
  // it"). The reticle used to draw a circle at the current position while the
  // brush was clearing a capsule from the last tick to this one — at speed
  // that is a visibly different shape from the one that took the material.
  // Published rather than re-derived, so the drawing cannot drift from the
  // algorithm: this is the same ax/ay/az the hit tests below run on, after
  // the teleport guard has had its say.
  S._eraseSweep = S._eraseSweep || { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, live: false };
  // A TELEPORT is not a sweep: a jump the hand could not have made (a mode
  // flip, a recentre, an alt-tab) must stamp, not sweep — sweeping it would
  // erase a swath across the sphere the player never drew through. The
  // budget is a VELOCITY, not a fixed distance: the erase tick is a 30 ms
  // setInterval on a loaded main thread and it slips, and a fixed per-tick
  // cap (20°, then 40°) kept eating real sensor flicks — an x-imu3 wrist
  // flick peaks well past 1000°/s, and an un-swept flick misses the line it
  // crossed (the "only 10% of my passes cut" bug, 2026-08-28). 2500°/s over
  // the measured gap, clamped to [50°, 150°].
  const nowMs = performance.now();
  const dtS = _lastTickAt > 0 ? Math.min(0.25, (nowMs - _lastTickAt) / 1000) : 0.03;
  _lastTickAt = nowMs;
  const maxDeg = Math.min(150, Math.max(50, 2500 * dtS));
  const maxChord = 2 * Math.sin(maxDeg * Math.PI / 360);
  const jx = rx - ax, jy = ry - ay, jz = rz - az;
  if (jx * jx + jy * jy + jz * jz > maxChord * maxChord) { ax = rx; ay = ry; az = rz; }

  // SUBDIVIDE the sweep along the great circle. The capsule tests use 3D
  // chords, and a long chord cuts through the sphere's interior: a 60° sweep
  // sags 1−cos(30°) ≈ 7.7° below the surface at its midpoint — the brush
  // TUNNELS under the material it visibly crossed, and a small radius missed
  // fast passes almost every time (2026-08-28, the "10% of my passes cut"
  // bug's real root). Sub-segments of ≤8° sag under 0.25°, well inside any
  // usable radius. Waypoints via slerp; the tests below run per sub-segment.
  let nWay = 1;
  const dotAB = ax * rx + ay * ry + az * rz;
  const _sw = S._eraseSweep;
  _sw.ax = ax; _sw.ay = ay; _sw.az = az;
  _sw.bx = rx; _sw.by = ry; _sw.bz = rz;
  _sw.live = true;

  const sweepAng = Math.acos(Math.max(-1, Math.min(1, dotAB)));
  if (sweepAng > 0.14) {                     // > ~8°
    nWay = Math.min(20, Math.ceil(sweepAng / 0.14));
    const sinAll = Math.sin(sweepAng);
    for (let w = 0; w <= nWay; w++) {
      const t = w / nWay;
      const fA = Math.sin((1 - t) * sweepAng) / sinAll;
      const fB = Math.sin(t * sweepAng) / sinAll;
      _wayX[w] = fA * ax + fB * rx;
      _wayY[w] = fA * ay + fB * ry;
      _wayZ[w] = fA * az + fB * rz;
    }
  } else {
    _wayX[0] = ax; _wayY[0] = ay; _wayZ[0] = az;
    _wayX[1] = rx; _wayY[1] = ry; _wayZ[1] = rz;
  }
  _lastCx = rx; _lastCy = ry; _lastCz = rz; _haveLast = true;
  // Radius as a chord on the unit sphere (chord ≈ arc at these angles).
  const chordR = 2 * Math.sin(S.searchRadiusDeg * Math.PI / 360);
  const r2 = chordR * chordR;

  // Phase 0: what does the brush touch? A point test for every mark — and
  // for LINE material (trig) a segment test between path-adjacent marks of
  // the same stroke: the ribbon drawn between two marks IS the line, so a
  // small radius crossing between them must still cut it even though neither
  // mark is inside the brush (Ek, 2026-08-28: "a line should be just that —
  // if I erase any part of the line it should erase").
  //
  // The segment test fires ONLY when the brush covers NEITHER endpoint, and
  // then takes the single mark nearest the crossing. One removed mark is one
  // removed adjacency — all _clusterByRemoval needs to split the trigger in
  // two, and the split's new strokeId breaks the ribbon at the cut. The
  // first version took the bounding PAIR from every touched segment, and a
  // stationary erase sitting ON the line then bit ~double its diameter: each
  // segment clipping the circle's edge donated its far endpoint too.
  _hit.clear();
  _prevTrig.clear();
  // A pair of marks carries a segment exactly where the RIBBON draws one —
  // the same bridge threshold the renderer uses (a rest under the paint gate
  // is drawn as line, so it must erase as line; the old one-tick gate turned
  // the segment test off across every bridged rest, and a small brush
  // crossing there missed). What must NOT re-pair is an erase hole: that is
  // the `_gapAfter` stamp, which both the ribbon and this pairing honour —
  // without it, each tick after a removal re-paired the survivors across the
  // fresh hole and kept drilling outward.
  const segGapS = Math.max(0.25, 4 * ((S.paintTicker?.intervalMs ?? 50) / 1000));
  const pointHit = (px, py, pz) => {
    for (let w = 0; w < nWay; w++) {
      if (_distPointSeg2(px, py, pz, _wayX[w], _wayY[w], _wayZ[w],
                         _wayX[w + 1], _wayY[w + 1], _wayZ[w + 1]) <= r2) return true;
    }
    return false;
  };
  const segHitS = (q1x, q1y, q1z, q2x, q2y, q2z) => {
    for (let w = 0; w < nWay; w++) {
      if (_distSegSeg2(q1x, q1y, q1z, q2x, q2y, q2z,
                       _wayX[w], _wayY[w], _wayZ[w],
                       _wayX[w + 1], _wayY[w + 1], _wayZ[w + 1]) <= r2) return _segS;
    }
    return -1;
  };
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p._cx === undefined) stampCartesian(p);  // same guard as grain.js — NaN dot would misclassify
    if (pointHit(p._cx, p._cy, p._cz)) _hit.add(p);
    if (p.trig && p.strokeId != null && p.strokeId >= 0) {
      const prev = _prevTrig.get(p.strokeId);
      if (prev && !prev._gapAfter && !_hit.has(prev) && !_hit.has(p) &&
          p.grainStart - prev.grainStart <= segGapS) {
        const dx = p._cx - prev._cx, dy = p._cy - prev._cy, dz = p._cz - prev._cz;
        // Cap ≈ 35°: a longer jump within one stroke is not a drawn segment.
        if (dx * dx + dy * dy + dz * dz < 0.36) {
          const s = segHitS(prev._cx, prev._cy, prev._cz, p._cx, p._cy, p._cz);
          if (s >= 0) _hit.add(s < 0.5 ? prev : p);
        }
      }
      _prevTrig.set(p.strokeId, p);
    }
  }
  if (_hit.size === 0) return;   // nothing under the brush

  // Phase 1: rank recency from ONLY the touched particles (local universe —
  // identical semantics to _buildCandidatePoolRadius in grain.js).
  _bufRec.clear();
  for (const p of _hit) {
    const key = depthKey(p);
    if ((_bufRec.get(key) ?? -Infinity) < p.strokeId) _bufRec.set(key, p.strokeId);
  }

  // What can the scan hear right now?  Same rule as _buildCandidatePoolRadius:
  // top recencyN strokes among in-radius ones; recencyN = 0 means
  // no recency cut — every in-radius stroke is audible.
  _allowed.clear();
  if (S.recencyN > 0 && _bufRec.size > S.recencyN) {
    _sortBuf.length = 0;
    for (const entry of _bufRec) _sortBuf.push(entry);        // [key, strokeId]
    // scrape top targets the NEWEST recencyN strokes (what the scan hears);
    // scrape bottom (S.eraseOldest, set by its tile for the hold) inverts the
    // ranking and digs out the OLDEST first, leaving recent material standing.
    _sortBuf.sort((a, b) => S.eraseOldest ? a[1] - b[1] : b[1] - a[1]);
    for (let i = 0; i < S.recencyN; i++) _allowed.add(_sortBuf[i][0]);
  } else {
    for (const key of _bufRec.keys()) _allowed.add(key);
  }

  // Classify strokes on first sighting this stroke: audible → target,
  // hidden → protected.  Classification is sticky for the stroke, so layers
  // revealed by the erase stay revealed (see _strokeFate comment above).
  for (const key of _bufRec.keys()) {
    if (!_strokeFate.has(key)) _strokeFate.set(key, _allowed.has(key));
  }

  // Phase 2: remove in-radius particles belonging to target strokes.
  // `erases: stroke` (#243) widens the take AFTER the touch decides: the
  // brush's contact picks WHICH strokes (same radius, same recency fate),
  // then every mark of those strokes goes — erase a take by touching it
  // anywhere. `erases: touch` is the classic brush.
  const removedList = [];
  let next;
  if (S.eraseWholeStroke) {
    const sids = new Set();
    for (const p of _hit) {
      if (_strokeFate.get(depthKey(p))) sids.add(p.strokeId);
    }
    if (sids.size === 0) return;
    next = parts.filter(p => {
      if (!sids.has(p.strokeId)) return true;
      removedList.push(p);
      return false;
    });
  } else {
    next = parts.filter(p => {
      if (!_hit.has(p)) return true;                       // untouched — keep
      if (!_strokeFate.get(depthKey(p))) return true;  // protected — keep
      removedList.push(p);
      return false;
    });
  }
  if (removedList.length === 0) return;

  // Stamp `_gapAfter` on the survivor preceding each hole, per stroke. The
  // ribbon breaks on it (renderer.js): a time threshold alone cannot tell a
  // small erase hole from a musical rest the paint gate recorded, and for a
  // CLAIMED stroke the erase-split (whose new strokeId is the usual break)
  // is deferred — without this flag the ribbon drew a chord across the hole
  // and the end caps then extended half of that chord into space.
  _removedSet.clear();
  for (const p of removedList) _removedSet.add(p);
  _lastKept.clear();
  _pendingGap.clear();
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const sid = p.strokeId;
    if (sid == null || sid < 0) continue;
    if (_removedSet.has(p)) { _pendingGap.set(sid, true); continue; }
    if (_pendingGap.get(sid)) {
      const lk = _lastKept.get(sid);
      if (lk) lk._gapAfter = true;
      _pendingGap.set(sid, false);
    }
    _lastKept.set(sid, p);
  }

  S.particles = next;
  S._particleVersion++;
  _strokeErased += removedList.length;
  // No grain flush — the next scheduler tick (≤20ms) rebuilds candidate pools
  // without the removed particles; in-flight grains finish their envelopes.
  // Held loops own SNAPSHOTS of their material, so scratch removal alone
  // never reaches their audio — the write-through hook does (#243).
  S._onMarksErased?.(removedList);
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
  // The material before the stroke: if it erases anything, the stroke is one
  // action on the history stack, before and after (js/history.js).
  _before = snapshotMaterial();
  S.eraseHeld   = true;
  _strokeErased = 0;
  _strokeFate.clear();                // fresh layer classification per stroke
  _haveLast = false;                  // the sweep starts here, not at last stroke's end
  _lastTickAt = 0;
  _eraseTick();                       // immediate first bite — no 30ms latency
  if (!_intervalId) _intervalId = setInterval(_eraseTick, TICK_MS);
  S._syncEraseUI?.();
}

export function stopEraseStroke() {
  if (S._eraseSweep) S._eraseSweep.live = false;
  if (!S.eraseHeld) return;
  S.eraseHeld = false;
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
  if (_strokeErased > 0) {
    _pruneStrokeHistory();
    if (_before) history.push(materialAction('erase', _before, snapshotMaterial()));
    S.updateLiveRecUI?.();
  }
  _before = null;
  S._syncEraseUI?.(_strokeErased);
}

// ── UI wiring ────────────────────────────────────────────────────────────────

// Registered on S so the gesture layer can reach them without importing this
// module: brush.js is on the record path and must stay clear of UI-adjacent
// imports (the same rule brushClaimsTrace itself follows).
S._startEraseStroke = startEraseStroke;
S._stopEraseStroke  = stopEraseStroke;

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
