// ============================================================================
// walker.js — the stroke WALKER: the lens's `stroke` mode.
//
// Under `mode: stroke` the cursor reads nothing on its own. Touch a grain
// stroke and a walker launches from the mark you touched: a reading cursor,
// not a pin, that retraces the stroke's path at the pace it was painted and
// plays whatever is in ITS reach with the lens's live radius, `k` and `order`,
// through the marks' own voicings (an auditioned mark's knobs still reach it, since
// the bridge reads each mark's voicing live). It plays once or loops while
// you stay on the stroke — the `cursor behaviour` rows (dwell, start,
// release, retrig, rearm) mean for a walker what they mean for a tape
// trigger — and it is gone when you lift off. Pin while it runs and it
// becomes a pinned cloud (ui-presets.js pinWalkers).
//
// The path is the stroke's marks in recording order, each mark's buffer time
// as its clock, so no new recording is needed: `t` = grainStart − first. A
// walker is a granular tape — the loop's timing and path, every instant a
// cloud of grains — and the reach ring is a time smear: tight, it approaches
// the take; wide, nearby moments blend as it passes. Ek, 2026-09-18;
// docs/TAPE-STUDY-2026-09.md § 7.
//
// Lifecycle only. The gate that launches one is trigger.js (a grain-stroke
// gate beside the tape triggers); the candidates it reads are gathered by
// grain.js _scheduleWalkers, which packs it as a seed voice for the worklet.
// ============================================================================
import { S } from './state.js';

// Slot keys past any pin slot: the bridge maps voices by `slotIndex`, and a
// walker must never collide with a pinned cloud's.
const WALK_SLOT_BASE = 1000;
let _nextSlot = WALK_SLOT_BASE;

S._walkers = [];

/** Launch a walker from a grain-stroke gate `t` (a trigger shell with
 *  `walk: true`, its particles the stroke's marks in order). `nearestIdx` is
 *  the mark touched; `tp` the live `cursor behaviour` params. */
export function startWalker(t, nearestIdx, tp) {
  const ps = t.particles;
  if (!ps || ps.length < 2) return null;
  const t0 = ps[0].grainStart ?? 0;
  const frames = new Array(ps.length);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    frames[i] = { t: Math.max(0, ((p.grainStart ?? 0) - t0) * 1000), lon: p.lon, lat: p.lat };
    if (i && frames[i].t < frames[i - 1].t) frames[i].t = frames[i - 1].t;   // never backwards
  }
  const duration = Math.max(1, frames[frames.length - 1].t);
  // A refire over a walker still running on this stroke: `cut` restarts it,
  // `layer` lets the old one finish its pass on its own.
  for (const w of S._walkers) {
    if (w.strokeId !== t.strokeId || w._detached || w._dead) continue;
    if (tp.retrig === 'layer') { w._detached = true; w._ending = true; }
    else w._dead = true;
  }
  const touchT = frames[Math.max(0, Math.min(nearestIdx | 0, frames.length - 1))].t;
  let loopMode = 'forward', pos = 0;
  if (tp.start === 'ends') { if (touchT / duration >= 0.5) loopMode = 'rev'; }   // arrived at the tail: run it backwards
  else if (tp.start === 'touch') pos = touchT;
  const w = {
    strokeId: t.strokeId, frames, duration, loopMode,
    // `grain` is play once THEN open (state.js `_openStrokes`): when this walk
    // ends, the stroke becomes the cursor's to granulate, area-style, until
    // the cursor leaves it.
    openOnEnd: tp.dwell === 'grain',
    _playheadMs: pos, lon: frames[0].lon, lat: frames[0].lat,
    slotIndex: _nextSlot++,
    level: 1,                        // the release fade rides this
    once: tp.dwell !== 'loop',       // `once` plays to the end and stops, under the cursor or not
    _ending: false, _detached: false, _dead: false, _fadeAt: 0,
  };
  _position(w);
  S._walkers.push(w);
  return w;
}

/** The cursor left the stroke: grain's `release` decides, for EVERY walker
 *  (Ek, 2026-09-22 night: "when i set release to fade-out in the settings for
 *  grains, it doesn't fade, it still plays till end"). A `once` walker used
 *  to be skipped here on a parity with tape's one-shot, which ignores the
 *  exit — so with dwell on once, the default, the release row did nothing at
 *  all. `play-to-end` IS what a once walker does anyway; `fade` now means
 *  what it says whichever dwell is on: the cursor leaves, the walk fades. */
export function exitWalker(t, tp) {
  for (const w of S._walkers) {
    if (w.strokeId !== t.strokeId || w._detached || w._dead) continue;
    if (tp.release === 'fade') { if (!w._fadeAt) w._fadeAt = performance.now(); }
    else w._ending = true;                                   // play-to-end: finish this pass
  }
}

/** Advance every walker by one scheduler tick; retire the ones that ended. */
export function tickWalkers(dtMs, now = performance.now()) {
  const ws = S._walkers;
  if (!ws.length) return;
  // Grain's own release fade (Settings → Tools › Grain › Fade), not the pins'
  // unpin fade, which is 15 ms by default and reads as a stop.
  const fadeMs = Math.max(5, S.grainTrigger?.releaseMs || 250);
  for (let i = ws.length - 1; i >= 0; i--) {
    const w = ws[i];
    if (w._dead) { ws.splice(i, 1); continue; }
    if (w._fadeAt) {
      w.level = Math.max(0, 1 - (now - w._fadeAt) / fadeMs);
      if (w.level <= 0) { ws.splice(i, 1); continue; }
    }
    w._playheadMs += dtMs;
    if (w._playheadMs >= w.duration) {
      if (w.once || w._ending) {
        ws.splice(i, 1);
        // The walk is done. Still on the stroke, the cursor takes over.
        if (w.openOnEnd && S._gateInside?.(w.strokeId)) S._openStrokes.add(w.strokeId);
        continue;
      }
      w._playheadMs %= w.duration;
    }
    _position(w);
  }
}

/** Every walker, gone — leaving `stroke` mode, or a pin taking them. */
export function clearWalkers() { S._walkers.length = 0; }

/** The walkers on ONE stroke, gone — its marks were erased out from under
 *  them (2026-09-24). A walker reads the marks near its path, so with none
 *  left it walked on in silence: under `dwell: loop` for ever, since the
 *  gate that would have sent the exit edge went with the marks, and an undo
 *  brought it back sounding beside the fresh walker the new gate launched.
 *  The same rule refreshTriggers applies to a take: material erased out
 *  from under a reader stops the reader. */
export function killWalkers(strokeId) {
  for (const w of S._walkers) if (w.strokeId === strokeId) w._dead = true;
}

/** Where the walker is now: the path interpolated at its playhead, `rev`
 *  reading the clock backwards from the end. */
function _position(w) {
  const { frames, duration, _playheadMs } = w;
  const pos = ((_playheadMs % duration) + duration) % duration;
  const et = w.loopMode === 'rev' ? duration - pos : pos;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (frames[mid].t <= et) lo = mid; else hi = mid; }
  const a = frames[lo], b = frames[hi];
  if (lo === hi || a.t === b.t) { w.lon = a.lon; w.lat = a.lat; return; }
  const f = (et - a.t) / (b.t - a.t);
  let dLon = b.lon - a.lon;
  if (dLon > Math.PI) dLon -= 2 * Math.PI; else if (dLon < -Math.PI) dLon += 2 * Math.PI;
  let lon = a.lon + dLon * f;
  if (lon > Math.PI) lon -= 2 * Math.PI; else if (lon < -Math.PI) lon += 2 * Math.PI;
  w.lon = lon;
  w.lat = a.lat + (b.lat - a.lat) * f;
}
