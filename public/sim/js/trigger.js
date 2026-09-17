// ── Trigger tool ────────────────────────────────────────────────────────────
// A trigger-type buffer is one the performer decided, BEFORE pressing record,
// would be fired as a sample rather than granulated. Recorded with ⇧space (or
// the bindable `trace_trigger` action); recorded with space it would have been
// granular. The type is a property of the recording and never changes:
// whenever the cursor touches it, it does what it was recorded as.
//
// The one place the two meet is `dwell: 'grain'` — sweep past a trigger and it
// fires; STOP on it and its material opens up to the granular cursor. That is a
// live playback choice about what dwelling does, not a second type: the buffer
// is still a trigger buffer, and switching dwell back closes it again.
//
// That decision is what shapes this file. A trigger is NOT a separate object
// with its own copy of the material — it is a *view* onto a painted stroke:
//
//   • particles are the live objects in S.particles, looked up by strokeId
//   • the buffer is the stroke's source buffer, played through a region
//   • the region is derived from the surviving particles, every rebuild
//
// So erase, delete-all and undo all work on triggers with no special cases —
// they operate on the particles, and the trigger follows. Erasing part of a
// trigger stroke edits the sample (Ek's call, and a good one: the erase brush
// becomes a trimming tool). Erasing all of it removes the trigger. There is no
// "disarm", because erase already is one.
//
// Playback reuses the loop commit engine — one AudioBufferSourceNode, VBAP
// following the playhead (grain.js, "Sequential (loop) playback"). A trigger
// entry is shaped like a loop slot so that block runs it without knowing what
// it is. What this file adds is the gate: `playing` is a function of cursor
// proximity rather than being pinned true.
//
// Registers on S rather than being imported by grain.js — the house pattern for
// avoiding circular imports.

import { S, COMMIT_COLORS } from './state.js';
import { stampCartesian } from './grain.js';
import { detectOnsets } from './onsets.js';

export const MAX_TRIGGERS = 32;

const DEG2RAD = Math.PI / 180;

// Retrigger crossfade — under retrig:'cut', a refire fades the previous pass
// over this long rather than chopping it.
const RETRIGGER_FADE_S = 0.008;

// Ceiling on stacked voices per trigger under retrig:'layer'. Hard-coded rather
// than exposed: it exists to stop fast retriggering piling up nodes without
// bound, not as a musical control. The rearm window is the musical limit on how
// densely you can stack. Oldest is stolen.
const MAX_LAYER_VOICES = 8;

// ── Geometry ────────────────────────────────────────────────────────────────
// The hot path compares dot products against cosines rather than angles. acos
// is monotonic on [-1,1], so `angle < gate` is exactly `dot > cos(gate)`, which
// makes the per-particle scan pure multiply-add with no transcendentals. The
// only cos calls are two per trigger per tick, on the gate radii.

/** Bounding cap for a set of stamped particles: a centre direction and the
 *  angular radius covering all of them. Recomputed whenever the particle set
 *  changes; it is the early-out that keeps a sphere full of triggers cheap. */
function _boundingCap(particles) {
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < particles.length; i++) {
    sx += particles[i]._cx; sy += particles[i]._cy; sz += particles[i]._cz;
  }
  const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
  // Degenerate: particles spread evenly enough that the centroid cancels (a
  // full great circle). Fall back to a π cap, which never rejects — slower but
  // correct, and unreachable in practice for a hand-painted stroke.
  if (len < 1e-9) {
    const p = particles[0];
    return { cx: p._cx, cy: p._cy, cz: p._cz, rad: Math.PI };
  }
  const cx = sx / len, cy = sy / len, cz = sz / len;
  let minDot = 1;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const d = p._cx * cx + p._cy * cy + p._cz * cz;
    if (d < minDot) minDot = d;
  }
  return { cx, cy, cz, rad: Math.acos(Math.max(-1, Math.min(1, minDot))) };
}

/** Resolve the source AudioBuffer a stroke's particles were painted from. */
function _sourceBuffer(p) {
  if (!p) return null;
  if (p.source === 'live') {
    const slot = S.liveRecBuffers[p.liveBufferIdx];
    return slot?.buffer || slot?.liveBuffer || null;
  }
  if (p.source === 'sample') return S.samples[p.sampleIndex]?.buffer ?? null;
  return null;
}

// ── Rebuilding from live particles ──────────────────────────────────────────

/**
 * Median gap between consecutive particles' positions in the buffer — how much
 * material one particle stands for at the rate this stroke was painted. Used as
 * the region's tail allowance. Median rather than mean so a long pause in the
 * take can't inflate it.
 */
// Path order for a trigger stroke. A live stroke's grainStart is recording
// time, monotonic along the path. A sampler stroke held past its sample LOOPS
// the crop (#247), so its grainStart rewinds each pass and cannot order the
// path — those marks carry `takeT`, the stroke's own elapsed clock, instead.
// Every sort and adjacency test in this file goes through this; grainStart
// stays the AUDIO position (region bounds, playhead, slice boundaries).
function _ordT(p) { return p.takeT !== undefined ? p.takeT : p.grainStart; }

function _medianSpacing(ps) {
  if (ps.length < 2) return 0.02;
  const gaps = [];
  // abs: in takeT path order a looping sample stroke's grainStart rewinds at
  // each pass seam — a raw negative gap would drag the median down.
  for (let i = 1; i < ps.length; i++) gaps.push(Math.abs(ps[i].grainStart - ps[i - 1].grainStart));
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1] || 0.02;
}

/**
 * Split a trigger's particles into runs wherever the erase brush actually took
 * something out — so erasing the middle of a trigger yields two triggers.
 *
 * It compares against the PREVIOUS particle list rather than looking at how big
 * the time gaps are. That distinction is the whole point: a gap in a stroke can
 * mean two completely different things, and gap size cannot tell them apart.
 *
 *   • never painted — the performer paused, or the paint ticker's paint gate
 *     stopped depositing while the sound sat under `paintGateThreshold` (a decaying
 *     triangle, a breath, a rest). These gaps exist from the moment the take is
 *     recorded and are part of the material.
 *   • erased — particles that WERE there are gone.
 *
 * The first version of this thresholded on gap size, and a 20-second take with
 * ordinary musical phrasing arrived as ~8 separate triggers. Removal is the
 * thing being asked about, so removal is what it tests: two survivors that were
 * not adjacent before have something missing between them. Exact, and with no
 * threshold there is nothing to tune or to misfire.
 *
 * `prev` empty (a fresh recording, or a session import) means no baseline, so
 * nothing splits — a take is always one trigger however it was phrased.
 */
function _clusterByRemoval(ps, prev) {
  if (!prev || prev.length === 0 || ps.length < 2) return [ps];
  const pos = new Map();
  for (let i = 0; i < prev.length; i++) pos.set(prev[i], i);

  const out = [];
  let run = [ps[0]];
  for (let i = 1; i < ps.length; i++) {
    const a = pos.get(ps[i - 1]);
    const b = pos.get(ps[i]);
    // Unknown on either side means a particle arrived rather than left (undo
    // restoring a sweep) — no removal to infer, so no split.
    if (a !== undefined && b !== undefined && b - a > 1) { out.push(run); run = []; }
    run.push(ps[i]);
  }
  out.push(run);
  // A run of one particle has no span worth playing; drop it rather than
  // producing a trigger that fires a click.
  return out.filter(r => r.length > 1);
}

/**
 * Write the derived fields onto a trigger from one run of particles.
 *
 * The region runs from the first particle's `grainStart` to the last one's,
 * plus **one median spacing** as the tail.
 *
 * It deliberately does NOT use `grainStart + grainDuration` the way
 * buildLoopPayload does for loops. `grainDuration` is the *granular grain
 * length* — on a wash-type patch that's seconds — and a trigger's particle
 * marks a position in the recording, not a length of one. Adding it overshot
 * the region end by up to the whole buffer, which is why erasing the tail of a
 * trigger stroke did nothing audible while erasing the head worked: `lo` is a
 * pure grainStart, `hi` was swamped by the grain length. Particles sample the
 * buffer at the paint rate, so one spacing is exactly the material the last
 * particle stands for.
 */
function _applyCluster(t, ps, buffer) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p._cx === undefined) stampCartesian(p);
    if (p.grainStart < lo) lo = p.grainStart;
    if (p.grainStart > hi) hi = p.grainStart;
  }
  const hiMark = hi;
  hi += _medianSpacing(ps);
  hi = Math.min(hi, buffer.duration);
  // A slice: stop short of the next onset, with room for the end fade.
  if (t.endCap != null) hi = Math.min(hi, t.endCap - SLICE_END_LEAD_S);
  // THE BUTTON, NOT THE MARKS (Ek, 2026-09-04: "the loop playback should
  // follow my human spacebar or click or button; the paint marks are just a
  // visual helper"). Marks sit on a 50 ms tick, so a region read off them is
  // late at the head and quantised at the tail whatever the hand did. A take
  // recorded from a press carries `edges` — press to release, shifted by the
  // input latency (audio.js) — and an UNTRIMMED stroke (its marks still span
  // what was painted; erase has not cut it) takes them. A slice keeps its
  // onsets; an erased stroke keeps the marks, which is what erase edits.
  const take = ps[0].source === 'live' ? S.liveRecBuffers[ps[0].liveBufferIdx] : null;
  if (t.endCap == null && take?.edges && take.markSpan &&
      lo <= take.markSpan[0] + 1e-6 && hiMark >= take.markSpan[1] - 1e-6) {
    lo = take.edges.startS; hi = take.edges.endS;
  }
  if (!(hi > lo)) return false;

  const cap = _boundingCap(ps);
  // grain.js builds the reversed copy from loopStart..loopEnd and caches it, so
  // it goes stale the moment the region moves. Without this, erasing the tail of
  // a trigger being played backwards would keep playing the pre-erase audio.
  const oldLo = t.loopStart, oldHi = t.loopEnd;
  if (oldLo !== lo || oldHi !== hi) t._regionBuf = null;
  t.particles = ps;
  t.buffer    = buffer;
  t.loopStart = lo;
  t.loopEnd   = hi;
  // A PLAYING looping source keeps the bounds it was STARTED with — loop
  // points are plain properties on the node, not derived from `t` — so an
  // erase during playback re-bounded the marker maths but left the audio
  // looping the old region: paint gone, visual playhead looping the new
  // shorter line, audio still playing the long one (2026-08-28). The node's
  // loop points are mutable mid-flight: move them and re-seat `_startedAt`
  // so the marker stays phase-locked to the audio. If the position being
  // played was itself erased (or lies past the new end), or playback is
  // reversed (the node's bounds live in reversed-buffer coordinates),
  // restart at the top of the new region instead — the scheduler rebuilds a
  // source for a playing trigger that has none.
  const src = t._sourceNode;
  if (src && !src._stopped && src.loop && t.playing && S.audioCtx &&
      (oldLo !== lo || oldHi !== hi)) {
    const now = S.audioCtx.currentTime;
    const spd = Math.abs(t.speed || 1);
    const oldLen = Math.max(1e-6, oldHi - oldLo);
    const posIn = ((now - (t._startedAt || now)) * spd) % oldLen;
    const pos = (t.direction === -1) ? oldHi - posIn : oldLo + posIn;
    if (t.direction !== -1 && pos >= lo && pos < hi) {
      src.loopStart = lo;
      src.loopEnd   = hi;
      t._startedAt  = now - (pos - lo) / spd;
      t._wrapIdx    = undefined;
    } else {
      stopTriggerAudio(t, 'immediate', 0.02);
      t.playing     = true;   // the stop cleared it; the scheduler rebuilds
      t.startOffset = 0;      // at the top of the NEW region
    }
  }
  t.trigger._capX = cap.cx; t.trigger._capY = cap.cy;
  t.trigger._capZ = cap.cz; t.trigger._capRad = cap.rad;
  t._builtAt = S._particleVersion;
  // The playhead index is into the old list; clamp rather than carry a stale
  // index into a shorter array.
  if (t.playheadIndex >= ps.length) t.playheadIndex = 0;
  return true;
}

/**
 * Re-derive a trigger's particle list, bounding cap and playback region from
 * whatever survives in S.particles. Returns false if nothing playable is left,
 * in which case the caller drops the trigger.
 *
 * The playback region is [earliest, latest] of one contiguous run of surviving
 * particles. Erasing the tail shortens the sample; erasing the head trims it;
 * erasing the middle **splits it in two**. Pauses that were never painted — a
 * rest, a decay under the paint gate — are part of the material and do not
 * split anything; see _clusterByRemoval.
 *
 * A split gives the new segment its own strokeId and its own trigger, rather
 * than teaching a trigger to hold a list of segments. That keeps the invariant
 * that a trigger is a view onto exactly one stroke — so the next rebuild, undo,
 * sweep and export all keep working unchanged, and the split is genuinely two
 * sounds rather than one sound with a hole in it.
 */
function rebuildTrigger(t) {
  const ps = [];
  const all = S.particles;
  for (let i = 0; i < all.length; i++) {
    if (all[i].strokeId === t.strokeId) ps.push(all[i]);
  }
  if (ps.length === 0) return false;

  const buffer = _sourceBuffer(ps[0]);
  if (!buffer) return false;

  // Paint order is path order, but sort rather than assume it — erase filters
  // in place and a later reordering elsewhere would corrupt the gap search
  // silently. _ordT, not grainStart: a looping sample stroke rewinds its
  // grainStart every pass.
  ps.sort((a, b) => _ordT(a) - _ordT(b));

  // Compare against the list from the previous rebuild — see _clusterByRemoval.
  const runs = _clusterByRemoval(ps, t.particles);
  if (runs.length === 0) return false;

  // Everything after the first run becomes its own stroke and its own trigger.
  // Primed inside and silent — an erase-split is an edit, not a placement, so
  // the half you just cut free must not announce itself.
  if (runs.length > 1) {
    const ids = _assignSegmentIds(t.strokeId, runs);
    for (let r = 1; r < runs.length; r++) {
      const sib = _newTriggerShell(ids[r], /* audition */ false);
      sib.endCap = t.endCap;   // an upper clamp only: harmless below the cut, right at it
      if (_applyCluster(sib, runs[r], buffer)) S.triggers.push(sib);
    }
    S._syncTriggerUI?.();
  }

  return _applyCluster(t, runs[0], buffer);
}

/** The strokeIds currently claimed by live loop slots (#241) — such a stroke
 *  is off-cursor and its trigger cannot fire. Null when nothing is claimed.
 *  Exported for the renderer: a claimed stroke's armed outline must not draw
 *  (it would promise a fire that cannot come, and while the rebuild is
 *  deferred its particle list is stale anyway). */
export function claimedStrokeIds() { return _claimedStrokeIds(); }
function _claimedStrokeIds() {
  let claimed = null;
  for (let ci = 0; ci < S.commitSlotCount; ci++) {
    const slot = S.commitSlots[ci];
    if (slot && slot.type === 'loop' && slot.strokeId > 0) {
      (claimed || (claimed = new Set())).add(slot.strokeId);
    }
  }
  return claimed;
}

/**
 * Bring every trigger up to date with the current particle set, dropping any
 * whose material is gone. Cheap when nothing changed — one integer compare per
 * trigger — so it can be called from the scheduler tick unconditionally.
 *
 * A stroke CLAIMED by a live loop slot is DEFERRED, not rebuilt: its trigger
 * cannot fire while claimed (#241), so there is nothing to rebuild for — and
 * rebuilding would be wrong. The erase-split re-ids surviving segments, and
 * the loop's whole claim keys on strokeId (the erase write-through matching
 * AND its all-scratch-gone kill check), so a partial erase could re-id the
 * tail out from under the loop and kill it with material still painted —
 * which is exactly what happened on the rig (2026-08-28). `_builtAt` stays
 * stale, so the trim / split / drop lands the moment the claim is released
 * and the stroke is scratch again.
 */
function refreshTriggers() {
  const trigs = S.triggers;
  if (!trigs?.length) return;
  const ver = S._particleVersion;
  const claimed = _claimedStrokeIds();
  let removed = false;
  // Backwards, and rebuildTrigger only ever PUSHES siblings — so anything it
  // adds sits past the cursor and is skipped this pass, which is what we want:
  // it was built against the current version and needs no rebuild.
  for (let i = trigs.length - 1; i >= 0; i--) {
    const t = trigs[i];
    if (t._builtAt === ver) continue;
    if (claimed && claimed.has(t.strokeId)) continue;   // deferred, see above
    if (!rebuildTrigger(t)) {
      // Material erased out from under it — stop the audio and drop it.
      stopTriggerAudio(t, 'fade');
      trigs.splice(i, 1);
      removed = true;
    }
  }
  if (removed) S._syncTriggerUI?.();
}

// ── Arming ──────────────────────────────────────────────────────────────────

/**
 * Turn a finished trigger-type stroke into a trigger. Called from the stroke
 * release path when the recording was made with the trigger record action.
 */
/**
 * Give a stroke's later segments their own strokeIds and stroke-history entries.
 * Shared by chop (record time) and the erase-split (rebuild): both turn one
 * stroke into several, and both rely on each segment owning exactly one stroke
 * so it can never re-collect its neighbours' particles.
 *
 * Runs are numbered from 0; run 0 keeps the original id. Returns the ids in
 * order, including run 0's.
 */
function _assignSegmentIds(strokeId, runs) {
  const ids = [strokeId];
  const origin = S.strokeHistory.find(h => h.strokeId === strokeId);
  for (let r = 1; r < runs.length; r++) {
    const sid = ++S.strokeIdCounter;
    for (const p of runs[r]) p.strokeId = sid;
    S.strokeHistory.push({
      strokeId: sid,
      type: origin?.type ?? 'live',
      liveBufferIndex: origin?.liveBufferIndex ?? (runs[r][0].liveBufferIdx ?? -1),
    });
    ids.push(sid);
  }
  return ids;
}

/**
 * Chop a freshly recorded take at its silences — `triggerParams.chop` in ms,
 * 0 = off. Returns the strokeIds the take became.
 *
 * The paint gate has already done the analysis: the paint ticker deposits
 * nothing while the input sits under `paintGateThreshold`, so **the gaps in a trigger
 * stroke already are the silences in the phrase**. Chopping needs no transient
 * detection, just a threshold on gaps that are sitting there in the data.
 *
 * This is deliberately the same gap test that #192 removed. As an always-on
 * heuristic guessing at erasure it was wrong and chopped a 20-second take into
 * eight. As an opt-in chop it is exactly the tool — the difference is that the
 * threshold is now a musical choice the performer makes, not a guess the code
 * makes on their behalf.
 *
 * Record time only. The erase-split (_clusterByRemoval) is the other reason a
 * trigger divides, and keeping the two on separate triggers — a deliberate act
 * vs. an edit — is what stops them fighting on every rebuild.
 */
function _chopStroke(strokeId, gapS) {
  const ps = S.particles.filter(p => p.strokeId === strokeId)
                        .sort((a, b) => _ordT(a) - _ordT(b));
  if (ps.length < 2) return [strokeId];

  const runs = [];
  let run = [ps[0]];
  for (let i = 1; i < ps.length; i++) {
    if (_ordT(ps[i]) - _ordT(ps[i - 1]) > gapS) { runs.push(run); run = []; }
    run.push(ps[i]);
  }
  runs.push(run);
  if (runs.length <= 1) return [strokeId];

  // Every run gets its own id, including one-particle ones. Leaving a stray
  // singleton on the original id would put it back in run 0's trigger, and
  // since run 0 collects by strokeId that trigger's region would stretch across
  // the whole take again — undoing the chop invisibly.
  return _assignSegmentIds(strokeId, runs);
}

/**
 * The slice tool's segmentation (#219) — onset detection on the AUDIO, not
 * gaps between marks. `_chopStroke` above splits where the paint gate closed,
 * which inherits the gate threshold and dies on an unanticipated noise floor;
 * `detectOnsets` (js/onsets.js) works in the dB domain against a local median,
 * so "an attack" is always measured relative to whatever the room is doing.
 * Boundaries land at the foot of each rise; particles are split into runs by
 * their grainStart against those boundaries. Runs are what _assignSegmentIds
 * and the arm loop below already know how to handle.
 */
// A slice's END is the next onset, not its last mark plus the median spacing
// (which lands anywhere near the next hit — into its attack, often). The
// segment carries that cut on the trigger as `endCap`, and _applyCluster
// clamps the region to it, less a lead that covers the detector's 10 ms
// hop and the one-shot end fade, so the fade never bites the next attack
// and the segment never contains it. Set by _sliceStroke for armTrigger.
const SLICE_END_LEAD_S = 0.012;
let _pendingEnds = null;   // sid → the onset that closed its run, while armTrigger runs

function _sliceStroke(strokeId) {
  const ps = S.particles.filter(p => p.strokeId === strokeId)
                        .sort((a, b) => _ordT(a) - _ordT(b));
  if (ps.length < 2) return [strokeId];

  // Resolve the stroke's buffer the way buildLoopPayload does.
  const p0 = ps[0];
  let buffer = null;
  if (p0.source === 'live') {
    const slot = S.liveRecBuffers[p0.liveBufferIdx];
    buffer = slot?.buffer || slot?.liveBuffer;
  } else if (p0.source === 'sample') {
    buffer = S.samples[p0.sampleIndex]?.buffer;
  }
  if (!buffer) return [strokeId];

  const sr = buffer.sampleRate;
  const t0 = ps[0].grainStart;
  const t1 = Math.min(buffer.duration, ps[ps.length - 1].grainStart + ps[ps.length - 1].grainDuration);
  const a = Math.max(0, Math.floor(t0 * sr));
  const b = Math.min(buffer.length, Math.ceil(t1 * sr));
  if (b - a < sr * 0.05) return [strokeId];

  let onsets = detectOnsets(buffer.data.subarray(a, b), sr)
    .map(t => t + t0);
  if (onsets.length <= 1) return [strokeId];

  // Minimum segment length (S.fx.sliceMinMs, 0 = off): a ~100 ms segment is
  // a double-fired onset, not a hit of its own. Greedy forward-merge: a cut
  // is kept only if the segment it would CLOSE is at least the minimum, so
  // a spurious cut just runs on to the next real one — the cut is dropped,
  // never the audio, and every armed trigger is at least minSegS long. A
  // short FINAL segment merges backward into the one before it.
  const minSegS = (S.fx?.sliceMinMs ?? 0) / 1000;
  if (minSegS > 0) {
    const kept = [onsets[0]];
    for (let i = 1; i < onsets.length; i++) {
      if (onsets[i] - kept[kept.length - 1] >= minSegS) kept.push(onsets[i]);
    }
    if (kept.length > 1 && t1 - kept[kept.length - 1] < minSegS) kept.pop();
    onsets = kept;
    if (onsets.length <= 1) return [strokeId];
  }

  // Split the marks into runs at the onset boundaries. Empty spans (an onset
  // with no marks before the next) produce empty runs — dropped here, since a
  // trigger is a view over marks and a mark-less span is nothing to arm.
  const runs = [];
  const ends = [];   // per run: the onset that closed it (the next hit), or t1
  let oi = 0;
  let run = [];
  let prevGS = -Infinity;
  for (const p of ps) {
    // A grainStart rewind is a pass seam of a looping sample stroke (#247):
    // the new pass re-crosses every onset from the top, so close the run and
    // rewind the boundary walker — each drawn copy of an attack slices as
    // its own hit.
    if (p.grainStart < prevGS - 1e-6) {
      if (run.length) { runs.push(run); ends.push(onsets[oi + 1] ?? t1); }
      run = [];
      oi = 0;
    }
    prevGS = p.grainStart;
    while (oi + 1 < onsets.length && p.grainStart >= onsets[oi + 1]) {
      if (run.length) { runs.push(run); ends.push(onsets[oi + 1]); }
      run = [];
      oi++;
    }
    run.push(p);
  }
  if (run.length) { runs.push(run); ends.push(onsets[oi + 1] ?? t1); }
  if (runs.length <= 1) return [strokeId];
  const ids = _assignSegmentIds(strokeId, runs);
  _pendingEnds = new Map(ids.map((sid, r) => [sid, ends[r]]));

  // Pre-roll rule: the span before the FIRST onset is usually the player
  // pressing record before playing. If that leading run is ≥10 dB quieter
  // than the take as a whole, it is floor, not material — its marks stay
  // painted (erase can clean them) but no trigger arms on dead air.
  if (runs.length > 1) {
    // Peak-based, not RMS-of-the-whole: the take's RMS is diluted by decay
    // tails and inter-hit floor, which put a real floor right at the margin.
    // Peaks separate cleanly — noise peaks sit near the floor, any hit does not.
    const ch = buffer.data;
    const peakDb = (from, to) => {
      const i0 = Math.max(0, Math.floor(from * sr)), i1 = Math.min(buffer.length, Math.ceil(to * sr));
      let pk = 0;
      for (let i = i0; i < i1; i++) { const v = Math.abs(ch[i]); if (v > pk) pk = v; }
      return 20 * Math.log10(pk + 1e-6);
    };
    const leadEnd = runs[1][0].grainStart;
    if (peakDb(runs[0][0].grainStart, leadEnd) < peakDb(t0, t1) - 12) return ids.slice(1);
  }
  return ids;
}

/**
 * Turn a finished trigger-type stroke into one or more triggers. Called from the
 * stroke release path when the recording was made with the trigger record
 * action. Returns the first trigger created, or null.
 */
// `loop` is an overdub take with no master (events.js): the looper hook pins
// it as the main loop whatever the tile's `on end` says.
export function armTrigger(strokeId, { plain = false, loop = false } = {}) {
  if (!(strokeId > 0)) return null;
  if (!S.triggers) S.triggers = [];
  if (S.triggers.some(t => t.strokeId === strokeId)) return null;   // already armed

  const tp = S.triggerParams;
  const chopS = (tp.chopOn && tp.chop > 0) ? tp.chop / 1000 : 0;
  // The slice tool segments by onsets whatever the chop setting — that is its
  // whole contract; the old ms-gap chop stays for the plain line tool.
  // `plain` is an ORPHANED overdub becoming an ordinary line (Ek, 2026-09-04:
  // "all overdubs should become normal loops once unpinned"): one trigger,
  // whatever tool is in the hand, no audition, and the looper hook stays out
  // of it — the stroke is being handed back, not recorded.
  const ids = plain                  ? [strokeId]
            : S.brushFx === 'slice' ? _sliceStroke(strokeId)
            : chopS > 0             ? _chopStroke(strokeId, chopS)
            : [strokeId];

  let first = null, full = false;
  for (const sid of ids) {
    if (S.triggers.length >= MAX_TRIGGERS) { full = true; break; }
    const t = _newTriggerShell(sid, /* audition */ !plain);
    const end = _pendingEnds?.get(sid);
    if (end != null) t.endCap = end;   // a slice ends at the next onset
    // A one-particle segment has no span worth playing; skip rather than make a
    // trigger that fires a click.
    if (!rebuildTrigger(t)) continue;
    S.triggers.push(t);
    if (!first) first = t;
  }
  _pendingEnds = null;

  if (full) window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'full' } }));
  if (first) {
    S._syncTriggerUI?.();
    window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'commit' } }));
    // The looper tile listens here (#237) — a stroke that just armed can also
    // become a loop slot at once. Fired on the arm edge, whatever gesture
    // ended the stroke.
    if (!plain) S._onTriggerStrokeArmed?.(strokeId, { loop });
  }
  return first;
}

/**
 * A trigger entry. How it is TOUCHED (radius, dwell, start, release, rearm)
 * lives on S.triggerParams and is read live — moving those moves every
 * trigger. Speed, volume and passes are SNAPSHOTS taken here at arm time:
 * playback reads them from the trigger object, the panel sliders set future
 * arms, and nothing rewrites an armed one — the grain filter is granular-only
 * and writes to no material (the lens's live voice, #292).
 *
 * `audition` is the difference between a placement and an edit. A freshly
 * recorded trigger starts OUTSIDE, so the first gate tick is an enter edge and
 * it plays once where the cursor already is — you hear what you captured. An
 * erase-split segment or a session import starts primed INSIDE and silent,
 * because neither is a placement and neither should make noise on its own.
 *
 * The audition always plays from the top whatever `start` says: under
 * `start: 'touch'` it would otherwise begin where the cursor is, and on release
 * that is the END of the stroke just painted — one median spacing of audio,
 * which reads as not playing at all. Consumed on first fire.
 */
function _newTriggerShell(strokeId, audition) {
  const d = S.triggerParams;
  return {
    // ── loop-slot shape: consumed by the seq playback block in grain.js ──
    type:          'loop',
    slotIndex:     -1,              // not in the commit bank
    strokeId,
    particles:     [],              // filled by rebuildTrigger
    buffer:        null,
    loopStart:     0,
    loopEnd:       0,
    playheadIndex: 0,
    startOffset:   0,
    direction:     1,
    speed:         d.speed ?? 1.0,
    passes:        d.passes ?? 0,
    playing:       false,           // the gate owns this
    color:         COMMIT_COLORS[S.triggers.length % COMMIT_COLORS.length],
    _sourceNode:   null,
    _gainNode:     null,
    _regionBuf:    null,
    _createdAt:    performance.now() / 1000,
    _startedAt:    0,
    _builtAt:      -1,
    grainParams:   { volume: d.volume ?? 1.0 },
    trigger: {
      _inside:     !audition,
      // -Infinity, not 0: the audition must never be suppressed by the rearm
      // window. Zero only worked because the rearm guard at _onEnter compares
      // against the wall clock, which is always larger than rearmMs by the time
      // anything is armed — an accident of timing standing in for the intent.
      _lastFireAt: audition ? -Infinity : performance.now(),
      _audition:   !!audition,
      _capX: 0, _capY: 0, _capZ: 1, _capRad: 0,
    },
    _nearestIdx: 0,
    _nearestDot: -1,
  };
}

/**
 * Rebuild a trigger from a session file. The payload carries a strokeId and the
 * settings that trigger was given — no particles and no audio, because it never
 * owned any. The material was restored with the rest of the session, so this
 * just re-derives the view over it.
 *
 * Returns null if the stroke didn't survive (a hand-edited file, or one whose
 * particles were dropped), which is the honest outcome: a trigger with no
 * material is not a thing.
 */
export function restoreTrigger(c) {
  if (!S.triggers) S.triggers = [];
  const d = S.triggerParams;
  // The same shell a fresh stroke gets (no audition: primed inside, so an
  // import never makes noise before the performer has moved), then the
  // arm-time snapshots — the file's own values when it carries them (the edit
  // filter can set them per stroke), the live params for older files.
  const t = _newTriggerShell(c.strokeId ?? -1, false);
  t.speed  = c.speed ?? d.speed ?? 1;
  t.passes = c.passes ?? d.passes ?? 0;
  if (typeof c.endCap === 'number') t.endCap = c.endCap;   // a slice's cut
  if (c.color) t.color = c.color;
  t.grainParams.volume = c.volume ?? d.volume ?? 1;
  if (!rebuildTrigger(t)) return null;
  S.triggers.push(t);
  return t;
}

/** Drop every trigger. Used by erase-all, which clears the particles the
 *  triggers are views onto. */
export function clearAllTriggers() {
  if (!S.triggers?.length) return;
  for (const t of S.triggers) stopTriggerAudio(t, 'fade');
  S.triggers.length = 0;
  S._syncTriggerUI?.();
}

// ── Stopping ────────────────────────────────────────────────────────────────

/**
 * Stop a trigger's audio without removing the trigger. This is why
 * _stopSeqAudio() can't be reused: both of its paths end by nulling the commit
 * slot, and a trigger has to survive being stopped.
 *
 * Node references are detached up front so the seq block builds a fresh source
 * on its next tick; the old subgraph disconnects itself on 'ended'.
 */
export function stopTriggerAudio(t, mode = 'fade', fadeSec = null) {
  // Stacked voices go with it — muting, erasing or clearing a trigger that has
  // layers ringing must silence all of them, not just the newest.
  _stopAllVoices(t, fadeSec);
  const src    = t._sourceNode;
  const gain   = t._gainNode;
  const extras = t._extraNodes;
  const startedAt = t._startedAt;   // captured before detaching

  t._sourceNode = null;
  t._gainNode   = null;
  t._extraNodes = null;
  t.playing     = false;
  t._startedAt  = 0;
  t._tail       = null;

  if (!src || src._stopped) { _disconnectAll(gain, extras); return; }

  const actx = S.audioCtx;
  if (!actx) {
    try { src.stop(); } catch (_) {}
    src._stopped = true;
    _disconnectAll(gain, extras);
    return;
  }

  const now = actx.currentTime;
  const cleanup = () => { src._stopped = true; _disconnectAll(gain, extras); };

  if (mode === 'play-to-end' && src.loop) {
    const elapsed   = (now - (startedAt || now)) * Math.abs(t.speed || 1);
    const loopLen   = (src.loopEnd || src.buffer?.duration || 1) - (src.loopStart || 0);
    const posInLoop = loopLen > 0 ? elapsed % loopLen : 0;
    const remainSec = (loopLen - posInLoop) / Math.abs(t.speed || 1);
    src.loop = false;
    if (gain) {
      const fade = Math.min(0.05, remainSec * 0.5);
      const fadeStart = now + Math.max(0, remainSec - fade);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, fadeStart);
      gain.gain.linearRampToValueAtTime(0, fadeStart + fade);
    }
    // `playing` is already false — rightly, so the seq block never rebuilds a
    // source for a pass that is ending — but the sound continues to the end
    // of the pass, and the playhead marker must continue WITH it (Ek: it
    // vanished the moment the cursor left). The tail record is everything the
    // renderer needs to keep computing the marker position on its own; the
    // 'ended' cleanup retires it.
    //
    // The stop must be SCHEDULED, not left to the buffer running out: with
    // loop=false the source ignores loopEnd and plays on to the end of the
    // whole underlying recording — silent (the fade landed at 0) but alive,
    // so 'ended' came late, the tail record outlived the pass, and the
    // marker kept wrapping from the start of a trimmed region for the length
    // of the ORIGINAL take (2026-08-28, visible after an erase-split).
    t._tail = { startedAt: startedAt || now, speed: Math.abs(t.speed || 1),
                loopStart: t.loopStart, loopEnd: t.loopEnd,
                direction: t.direction || 1 };
    try { src.stop(now + Math.max(0, remainSec) + 0.02); } catch (_) {}
    src.addEventListener('ended', () => { t._tail = null; cleanup(); }, { once: true });
    return;
  }

  const fade = fadeSec ?? ((S.loopFadeTimeMs || 15) / 1000);
  if (gain) {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + fade);
  }
  try { src.stop(now + fade + 0.01); } catch (_) {}
  src.addEventListener('ended', cleanup, { once: true });
}

function _disconnectAll(gain, extras) {
  if (extras) for (const n of extras) { try { n.disconnect(); } catch (_) {} }
  if (gain) { try { gain.disconnect(); } catch (_) {} }
}

/**
 * Cut the current pass loose and let it ring — retrig:'layer'. The trigger is
 * left with no source, so the seq block builds a fresh one on its next tick and
 * the two sound together.
 *
 * This is nearly the whole of polyphony, because the engine never needed to
 * know about voices: a one-shot source already carries its own scheduled end
 * (the duration argument) and its own 'ended' cleanup. Detaching without
 * stopping is the only difference from a cut.
 *
 * What a detached voice loses is **spatial tracking** — the per-tick VBAP
 * update follows `_sourceNode`, so an older voice holds the position it was
 * fired at. On a spatial instrument that reads as a feature: hit the same
 * buffer at different bearings and the stack spreads across the speakers.
 */
function _detachVoice(t) {
  const src    = t._sourceNode;
  const gain   = t._gainNode;
  const extras = t._extraNodes;
  t._sourceNode = null;
  t._gainNode   = null;
  t._extraNodes = null;
  t._startedAt  = 0;

  if (!src || src._stopped) { _disconnectAll(gain, extras); return; }

  const voice = { src, gain, extras };
  if (!t._voices) t._voices = [];
  t._voices.push(voice);
  src.addEventListener('ended', () => {
    src._stopped = true;
    _disconnectAll(gain, extras);
    const i = t._voices.indexOf(voice);
    if (i >= 0) t._voices.splice(i, 1);
  }, { once: true });

  // Steal the oldest past the ceiling.
  while (t._voices.length > MAX_LAYER_VOICES) _fadeVoice(t._voices.shift());
}

/** Ramp a detached voice out and stop it. Its own 'ended' handler disconnects. */
function _fadeVoice(v, fadeSec = null) {
  if (!v?.src || v.src._stopped) return;
  const actx = S.audioCtx;
  if (!actx) { try { v.src.stop(); } catch (_) {} return; }
  const now  = actx.currentTime;
  const fade = fadeSec ?? ((S.loopFadeTimeMs || 15) / 1000);
  if (v.gain) {
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.linearRampToValueAtTime(0, now + fade);
  }
  try { v.src.stop(now + fade + 0.01); } catch (_) {}
}

/** Stop every stacked voice. Anything that silences a trigger has to reach
 *  these too, or muting would leave the layers ringing. */
function _stopAllVoices(t, fadeSec = null) {
  if (!t._voices?.length) return;
  for (const v of t._voices.splice(0)) _fadeVoice(v, fadeSec);
}

/**
 * THE CAP IS THE ONE MUTE (Ek, 2026-09-07: "isn't the cap just that —
 * everything on the scratch surface including loops aren't triggered by the
 * cursor if the cap is on"). There used to be a second global flag,
 * `trigMuted`, sitting on the lens sheet as `triggers on|off`: the cap stopped
 * the cursor granulating and triggers went on firing, because a trigger plays
 * through the TAPE engine, not the cursor bus that `setScanMuted` gates. So
 * capping the lens silenced half of what the cursor does and nothing said
 * which half. The cap's own footnote had promised this since it was written —
 * "triggers still fire; their own mute is in the trigger panel until lenses
 * absorb it". They have absorbed it.
 *
 * `setScanMuted` (ui-meters.js) is the one writer now and calls
 * `silenceTriggers()` on the way down. Muting stops what is sounding through
 * each trigger's own release rule, so a `play-to-end` one-shot finishes rather
 * than being chopped, and the gate keeps running while capped (see
 * updateTriggerGates) so `_inside` stays true for whatever the cursor is on —
 * otherwise uncapping would fire it immediately.
 */

// Minimum gap between trigger LED stabs. A loop shorter than this would
// otherwise strobe the LED at its wrap rate — and because the trigger row is
// `priority`, every one of those stabs cancels whatever else was showing, so an
// unlimited fast loop would make commit/undo/tare feedback invisible for as
// long as it ran. 120ms is comfortably longer than the 45ms strike itself.
const LED_MIN_GAP_MS = 120;
let _lastLedAt = 0;

/**
 * Flash the LED for a trigger onset — the launch AND every loop wrap, since
 * both are the same musical event: a sample starting. One helper so the two
 * call sites share the rate limit rather than each growing their own.
 */
export function ledTriggerFire() {
  const now = performance.now();
  if (now - _lastLedAt < LED_MIN_GAP_MS) return;
  _lastLedAt = now;
  window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'trigger' } }));
}

/**
 * Chop on/off — bindable as `trigger_chop`. Kept separate from the ms threshold
 * so flipping it never loses the value, and so the binding is a plain switch
 * with nothing to remember. Takes effect on the NEXT take recorded; chop is a
 * record-time act and does not retroactively divide what is already on the
 * sphere.
 */
export function setChopOn(on) {
  const next = !!on;
  if (next === S.triggerParams.chopOn) return;
  S.triggerParams.chopOn = next;
  S._syncTriggerUI?.();
}

/** Stop everything that is sounding, without removing anything. */
export function silenceTriggers() {
  if (!S.triggers?.length) return;
  for (const t of S.triggers) {
    if (t.playing || t._sourceNode) stopTriggerAudio(t, t.trigger?.release ?? 'fade');
  }
}

// ── The gate ────────────────────────────────────────────────────────────────

/**
 * Called once per scheduler tick from grain.js, before the seq playback block.
 * Flips `playing` on each trigger according to cursor proximity.
 *
 * Cost per trigger per tick: two Math.cos and one dot product for the bounding
 * cap. Only triggers the cursor is near pay for the per-particle scan.
 */
// ── Swept-gate state — fast crossings (2026-08-28) ──────────────────────────
// The gate samples the cursor once per 20 ms scheduler tick, so a fast pass
// across a stroke can be entirely BETWEEN samples — inside the band for less
// time than a tick — and whether it fired tracked gesture speed ("really fast
// up and down across the line — sometimes it works, sometimes it doesn't").
// When the cursor moved further than the enter radius in one tick, the arc it
// swept is tested too. Slerped sub-segments ≤ 8°: a straight chord between
// distant samples sags below the sphere's surface and tunnels under the
// stroke — the same geometry bug the eraser had.
let _gwX = 0, _gwY = 0, _gwZ = 0, _gwAt = 0;
const _gSubX = new Float64Array(21), _gSubY = new Float64Array(21), _gSubZ = new Float64Array(21);
let _gSubN = 0;

// Squared minimum distance between segments (Ericson §5.1.9) — for the swept
// crossing against the stroke's drawn segments. Chords on the unit sphere.
function _segSeg2(p1x, p1y, p1z, q1x, q1y, q1z, p2x, p2y, p2z, q2x, q2y, q2z) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx0 = p1x - p2x, ry0 = p1y - p2y, rz0 = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx0 + d2y * ry0 + d2z * rz0;
  const EPS = 1e-12;
  let s, t;
  if (a <= EPS && e <= EPS) { s = 0; t = 0; }
  else if (a <= EPS) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
  else {
    const c = d1x * rx0 + d1y * ry0 + d1z * rz0;
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
  _segSegS = s;
  const dx = (p1x + d1x * s) - (p2x + d2x * t);
  const dy = (p1y + d1y * s) - (p2y + d2y * t);
  const dz = (p1z + d1z * s) - (p2z + d2z * t);
  return dx * dx + dy * dy + dz * dz;
}
let _segSegS = 0;

// Squared distance from point P to segment AB (3D chords, unit sphere).
function _pSeg2(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 > 1e-12 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return dx * dx + dy * dy + dz * dz;
}

export function updateTriggerGates(cursorLon, cursorLat, nowMs) {
  const trigs = S.triggers;
  if (!trigs || trigs.length === 0) return;

  // Pick up erases, undos and new particles before testing against them.
  refreshTriggers();
  if (trigs.length === 0) return;

  // The CAP is the on/off, for hits exactly as for granulation. The geometry
  // still runs so `_inside` stays accurate — otherwise uncapping would fire
  // whatever the cursor happened to be resting on. Only the edge *actions* are
  // suppressed. It costs ~0.002 ms/tick at 32 triggers, which is not worth
  // trading correctness for.
  // Capped, or on a lens that reads grains only: no edge actions. The
  // geometry still runs either way so `_inside` stays accurate — otherwise
  // uncapping, or switching back to a lens that reads tape, would fire
  // whatever the cursor happened to be resting on.
  const live = !S.scanMuted && S.lensReads !== 'grains';

  // ── Off-cursor rule (#241, Ek): a stroke CLAIMED by a live loop slot is in
  // a layer — it plays on its own, off cursor — and scratch is what the lens
  // reads. So the cursor must not fire it: no accidental re-trigger of a
  // looping stroke by touching it. Claimed follows the CLAIM, not audibility
  // (a composer-muted loop still holds its stroke). Geometry still runs so
  // `_inside` stays accurate, exactly like the cap — release the slot and
  // the leave-and-come-back rule applies, nothing fires on the spot.
  const _claimed = _claimedStrokeIds();

  // Playback params are global and read here, every tick — not copied into the
  // trigger when it was recorded. Two cos calls for the whole set rather than
  // two per trigger, which is a small bonus of them no longer varying.
  // The reach is the cursor's search radius, not a trigger-owned one: it is the
  // same cursor and the same gesture, and erase already follows it. Riding the
  // radius slider therefore widens the trigger zones too, which is the point.
  const tp = S.triggerParams;
  const enterRad = S.searchRadiusDeg * DEG2RAD;
  const exitRad  = enterRad * (tp.hysteresis || 1);
  const chordEnter2 = Math.pow(2 * Math.sin(enterRad / 2), 2);
  const chordExit2  = Math.pow(2 * Math.sin(exitRad / 2), 2);
  // Segment pairing — the ribbon's own bridge threshold, same as the eraser.
  const segGapS = Math.max(0.25, 4 * ((S.paintTicker?.intervalMs ?? 50) / 1000));

  const cosLat = Math.cos(cursorLat);
  const rx = cosLat * Math.sin(cursorLon);
  const ry = Math.sin(cursorLat);
  const rz = cosLat * Math.cos(cursorLon);

  // Build this tick's swept arc (see the state block above). Engages only
  // when point sampling could miss (moved further than the enter radius) and
  // never on a teleport — the same 2500°/s velocity budget as the eraser.
  _gSubN = 0;
  if (_gwAt > 0) {
    const dotAB = _gwX * rx + _gwY * ry + _gwZ * rz;
    const sweepAng = Math.acos(Math.max(-1, Math.min(1, dotAB)));
    // dt clamped: a flick FROM REST is the common case (hover, then strike),
    // so the budget must not starve on a long-idle cursor — nor grow without
    // bound and let a genuine teleport sweep the whole sphere.
    const dtS = Math.min(0.1, (nowMs - _gwAt) / 1000);
    const maxAng = Math.min(2.6, Math.max(0.87, 43.6 * dtS));   // 2500°/s, 50–150°
    if (sweepAng > enterRad && sweepAng < maxAng) {
      _gSubN = Math.min(20, Math.ceil(sweepAng / 0.14));
      const sinAll = Math.sin(sweepAng);
      for (let wpt = 0; wpt <= _gSubN; wpt++) {
        const tt = wpt / _gSubN;
        const fA = Math.sin((1 - tt) * sweepAng) / sinAll;
        const fB = Math.sin(tt * sweepAng) / sinAll;
        _gSubX[wpt] = fA * _gwX + fB * rx;
        _gSubY[wpt] = fA * _gwY + fB * ry;
        _gSubZ[wpt] = fA * _gwZ + fB * rz;
      }
    }
  }
  // Keep the previous DISTINCT position. The cursor quaternion steps at the
  // render rate (~33 ms) while this gate ticks at 20 ms, so consecutive
  // samples often repeat; measuring the velocity budget against the tick
  // spacing made a real flick look like a teleport (60° "in 20 ms" that was
  // actually 60° in 40). dt runs from the last time the cursor MOVED.
  if (_gwAt === 0 || _gwX * rx + _gwY * ry + _gwZ * rz < 0.99996) {
    _gwX = rx; _gwY = ry; _gwZ = rz; _gwAt = nowMs;
  }
  for (let i = 0; i < trigs.length; i++) {
    const t  = trigs[i];
    const tg = t.trigger;
    if (!tg || !t.particles.length) continue;

    _applyLiveParams(t, tp);

    // A claim landing on a SOUNDING trigger stops it (2026-08-28): the loop
    // is now that stroke's voice, and with enter/exit actions suppressed
    // while claimed, the cursor-fired playback had no stop edge left — it
    // kept sounding "as if the cursor was still on it" after pinning. Same
    // short fade as the looper's audition kill. Runs before the cap reject
    // so it fires however far away the cursor is; `_inside` keeps tracking
    // geometry, so nothing fires on the spot when the claim is released.
    if (_claimed && _claimed.has(t.strokeId) && t.playing) {
      stopTriggerAudio(t, 'immediate', 0.02);
    }

    // 1. Bounding-cap reject — outside the stroke's cap plus the exit radius,
    //    no particle can be in range.
    const capDot  = tg._capX * rx + tg._capY * ry + tg._capZ * rz;
    const capGate = Math.cos(Math.min(Math.PI, tg._capRad + exitRad));
    if (capDot < capGate) {
      if (tg._inside) {
        tg._inside = false;
        if (live && !(_claimed && _claimed.has(t.strokeId))) _onExit(t);
      }
      continue;
    }

    // 2. Stroke scan — distance to the LINE, not to its marks. The drawn
    //    segment between path-adjacent marks IS the material (the same rule
    //    the eraser and the ribbon settled on): with a radius smaller than
    //    half the mark spacing, a cursor sitting ON the ribbon between two
    //    marks read as outside and the line "sometimes didn't fire". A pair
    //    carries a segment under the ribbon's own bridge threshold, never
    //    across an erase hole (`_gapAfter`).
    let bestD2 = Infinity, bestIdx = 0;
    const ps = t.particles;
    let segPrev = null, prevPd2 = Infinity;
    for (let pi = 0; pi < ps.length; pi++) {
      const p = ps[pi];
      const dxp = p._cx - rx, dyp = p._cy - ry, dzp = p._cz - rz;
      const pd2 = dxp * dxp + dyp * dyp + dzp * dzp;
      if (pd2 < bestD2) { bestD2 = pd2; bestIdx = pi; }
      if (segPrev && !segPrev._gapAfter &&
          _ordT(p) - _ordT(segPrev) <= segGapS) {
        const sdx = p._cx - segPrev._cx, sdy = p._cy - segPrev._cy, sdz = p._cz - segPrev._cz;
        if (sdx * sdx + sdy * sdy + sdz * sdz < 0.36) {   // cap ≈ 35°
          const d2 = _pSeg2(rx, ry, rz, segPrev._cx, segPrev._cy, segPrev._cz,
                            p._cx, p._cy, p._cz);
          if (d2 < bestD2) { bestD2 = d2; bestIdx = pd2 <= prevPd2 ? pi : pi - 1; }
        }
      }
      segPrev = p; prevPd2 = pd2;
    }
    t._nearestIdx = bestIdx;
    t._nearestDot = 1 - bestD2 / 2;   // chord² → dot, for anything reading it

    // 3. Hysteresis. Entering takes the tight radius, leaving the wide one.
    //    Without it a sensor parked on the boundary machine-guns the sample —
    //    exactly what a turntable held near a bearing does.
    const insideNow = bestD2 < (tg._inside ? chordExit2 : chordEnter2);
    const readable = live && !(_claimed && _claimed.has(t.strokeId));

    if (insideNow && !tg._inside) {
      tg._inside = true;
      if (readable) _onEnter(t, bestIdx, nowMs);
    } else if (!insideNow && tg._inside) {
      tg._inside = false;
      if (readable) _onExit(t);
    } else if (_gSubN > 0 && !insideNow && !tg._inside && readable) {
      // Swept crossing — the level gate saw nothing on either sample, but
      // the arc between them may have passed through the stroke. A crossing
      // fires the enter edge at the nearest swept mark and then the exit
      // edge: a strum through the string. Rearm windows and the release
      // semantics ride the same handlers; `_inside` stays false, so
      // hysteresis is untouched.
      let capNear = false;
      const capR2 = Math.pow(2 * Math.sin(Math.min(Math.PI, tg._capRad + enterRad) / 2), 2);
      for (let wpt = 0; wpt < _gSubN && !capNear; wpt++) {
        if (_pSeg2(tg._capX, tg._capY, tg._capZ,
                   _gSubX[wpt], _gSubY[wpt], _gSubZ[wpt],
                   _gSubX[wpt + 1], _gSubY[wpt + 1], _gSubZ[wpt + 1]) <= capR2) capNear = true;
      }
      if (capNear) {
        // Marks AND the drawn segments between them — the crossing usually
        // lands between marks, and the segment is the line.
        let bd = Infinity, bi = -1;
        let xPrev = null;
        for (let pi = 0; pi < ps.length; pi++) {
          const p = ps[pi];
          for (let wpt = 0; wpt < _gSubN; wpt++) {
            const d2 = _pSeg2(p._cx, p._cy, p._cz,
                              _gSubX[wpt], _gSubY[wpt], _gSubZ[wpt],
                              _gSubX[wpt + 1], _gSubY[wpt + 1], _gSubZ[wpt + 1]);
            if (d2 < bd) { bd = d2; bi = pi; }
          }
          if (xPrev && !xPrev._gapAfter &&
              _ordT(p) - _ordT(xPrev) <= segGapS) {
            const sdx = p._cx - xPrev._cx, sdy = p._cy - xPrev._cy, sdz = p._cz - xPrev._cz;
            if (sdx * sdx + sdy * sdy + sdz * sdz < 0.36) {
              for (let wpt = 0; wpt < _gSubN; wpt++) {
                const d2 = _segSeg2(xPrev._cx, xPrev._cy, xPrev._cz,
                                    p._cx, p._cy, p._cz,
                                    _gSubX[wpt], _gSubY[wpt], _gSubZ[wpt],
                                    _gSubX[wpt + 1], _gSubY[wpt + 1], _gSubZ[wpt + 1]);
                if (d2 < bd) { bd = d2; bi = _segSegS < 0.5 ? pi - 1 : pi; }
              }
            }
          }
          xPrev = p;
        }
        if (bi >= 0 && bd <= chordEnter2) {
          _onEnter(t, bi, nowMs);
          _onExit(t);
        }
      }
    }
  }
}

/**
 * Push live READ-TIME changes into a trigger — including one that is sounding
 * right now. The #236/#240 split runs through here: dwell (and the rest of
 * the lens's "on loops" family) is how the CURSOR reads material, so flipping
 * it to loop while a one-shot rings makes it loop. Speed and volume are the
 * BAKED half — _newTriggerShell stamped them from the loop tile's dials when
 * the stroke was drawn, and this function no longer touches them: moving the
 * speed dial changes the next recording, never what is already on the sphere.
 * (The same rule as a stroke freezing its voicing, #210.)
 */
function _applyLiveParams(t, tp) {
  const src = t._sourceNode;
  if (!src || src._stopped) return;

  const wantLoop = tp.dwell === 'loop';   // 'grain' fires once and opens up
  if (src.loop !== wantLoop) src.loop = wantLoop;
}

function _onEnter(t, nearestIdx, nowMs) {
  const tg = t.trigger;
  const tp = S.triggerParams;
  // Rearm window — suppress a refire that lands too soon after the last.
  if (nowMs - tp.rearmMs < tg._lastFireAt) return;
  tg._lastFireAt = nowMs;

  // What a refire does to the pass already sounding.
  if (t._sourceNode && !t._sourceNode._stopped) {
    if (tp.retrig === 'layer') _detachVoice(t);      // let it ring, stack on top
    else stopTriggerAudio(t, 'immediate', RETRIGGER_FADE_S);   // fade and restart
  }

  if (tg._audition) {
    // The one playback you get on releasing the record button: always the whole
    // thing from the top, so you hear what you captured. See _audition in
    // armTrigger for why `start: 'touch'` must not apply here.
    tg._audition    = false;
    t.direction     = 1;
    t.startOffset   = 0;
    t.playheadIndex = 0;
  } else if (tp.start === 'ends') {
    // Direction follows the end you arrived at, and it always plays IN FULL —
    // never from the point of contact.
    //
    // This exists because `touch` degenerates on a turntable. Free movement can
    // land anywhere in a stroke, but a turntable only ever arrives at one end or
    // the other, and arriving at the tail under `touch` leaves almost nothing to
    // play. Here the far end becomes the start instead: enter at the front and
    // it runs forward from the top, enter at the back and it runs backward from
    // the very end. On a turntable that makes playback direction follow spin
    // direction, which is the musical point.
    //
    // Measured in buffer time rather than particle index, so an unevenly painted
    // stroke still splits at its actual midpoint.
    const p    = t.particles[nearestIdx];
    const span = t.loopEnd - t.loopStart;
    const frac = span > 0 ? ((p?.grainStart ?? t.loopStart) - t.loopStart) / span : 0;
    if (frac >= 0.5) {
      t.direction     = -1;                     // arrived at the tail — run it backwards
      t.playheadIndex = t.particles.length - 1;
    } else {
      t.direction     = 1;
      t.playheadIndex = 0;
    }
    // Zero either way: forward that is the region start, reversed it is the
    // start of the reversed copy, which is the region's end.
    t.startOffset = 0;
  } else if (tp.start === 'touch') {
    // Start from where the cursor actually made contact. Offsets are relative
    // to the region start, since playback reads the source buffer directly.
    //
    // Note this is directional by design: approach a stroke from its tail and
    // there is little left to play. That is what 'touch' means — if it reads as
    // "quiet from one side" on the rig, 'top' is the setting that ignores
    // approach direction.
    const p = t.particles[nearestIdx];
    t.direction     = 1;
    t.startOffset   = Math.max(0, (p?.grainStart ?? t.loopStart) - t.loopStart);
    t.playheadIndex = nearestIdx;
  } else {
    t.direction     = 1;
    t.startOffset   = 0;
    t.playheadIndex = 0;
  }

  t.playing = true;   // the seq block builds the source node on its next pass

  // LED, on the gate edge rather than where the source node is built — it marks
  // the moment you crossed the zone, not the tick when the audio graph caught up.
  ledTriggerFire();
}

function _onExit(t) {
  // One-shot deliberately does nothing on exit. A cursor sweeping past a
  // triangle at performance speed should still get the whole triangle;
  // truncating it would make the sample's length a function of how fast the
  // turntable was moving, which is not what "trigger a sample" means.
  //
  // 'grain' is the same on this edge: its sample already played once, and the
  // granulation it opened stops on its own — the particles simply fall out of
  // the cursor's radius, which is the same thing that ended the dwell.
  if (S.triggerParams.dwell !== 'loop') return;
  stopTriggerAudio(t, S.triggerParams.release);
}

/** Called from the seq block's 'ended' handler when a one-shot finishes, so the
 *  block's needsNewSource check doesn't restart it. Without this a one-shot
 *  becomes a runaway loop.
 *
 *  Keyed on the source having actually ended rather than on the current dwell
 *  setting: flip to 'loop' mid-ring and `_applyLiveParams` sets `src.loop`, so
 *  a source that reaches 'ended' anyway was genuinely a one-shot. */
export function onTriggerSourceEnded(t, src) {
  // Only the CURRENT source ending means the trigger stopped. Under
  // retrig:'layer' the detached voices finish on their own schedule, and one of
  // those ending must not clear `playing` on the voice that replaced it.
  if (src && src !== t._sourceNode) return;
  t.playing    = false;
  t._startedAt = 0;
}

// Hooks for grain.js and the UI (avoids circular imports — house pattern).
S._updateTriggerGates   = updateTriggerGates;
S._onTriggerSourceEnded = onTriggerSourceEnded;
S._armTrigger           = armTrigger;
S._refreshTriggers      = refreshTriggers;   // the scheduler's rebuild, callable by a harness under a quiesced scheduler
S._clearAllTriggers     = clearAllTriggers;
S._silenceTriggers      = silenceTriggers;
S._setChopOn            = setChopOn;
S._ledTriggerFire       = ledTriggerFire;
S._stopTriggerAudio     = stopTriggerAudio;
