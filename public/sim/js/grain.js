import { S, HANN_LEN, HANN_ATTACK, HANN_RELEASE, MAX_CLOUDS, MAX_GRAIN_NODES, GRAIN_SCHEDULER_INTERVAL_MS, SCHED_SAFE_PERIOD_S, perf, gp, minGrainDurS, minGrainPeriodS, buildEnvelopeCurves } from './state.js';
import { ensureAudioContext, getMasterBus } from './audio.js';
import { spherePoint, qRotateVec, qConjugate, getCursorLonLat, screenToLonLat } from './sphere.js';

// ── Pre-computed VBAP lookup table ──────────────────────────────────────────
// Built once at initSpeakerBuses time. Maps integer degrees [0, 359] to
// { idxA, idxB, wA, wB } — the two bracketing speakers and their gains.
// playGrain uses this for O(1) VBAP instead of per-grain sort + search.
let _vbapLUT = null;

export function buildVBAPLookup(speakers) {
  if (!speakers || speakers.length < 1) { _vbapLUT = null; return; }
  const n = speakers.length;
  const sorted = speakers
    .map(({ angleDeg }, idx) => ({ angleDeg, idx }))
    .sort((a, b) => a.angleDeg - b.angleDeg);

  _vbapLUT = new Array(360);
  for (let deg = 0; deg < 360; deg++) {
    let nextPos = sorted.findIndex(s => s.angleDeg > deg);
    if (nextPos === -1) nextPos = 0;
    const prevPos = (nextPos - 1 + n) % n;
    const sA = sorted[prevPos];
    const sB = sorted[nextPos];
    let spanDeg = sB.angleDeg - sA.angleDeg;
    if (spanDeg <= 0) spanDeg += 360;
    let offsetDeg = deg - sA.angleDeg;
    if (offsetDeg < 0) offsetDeg += 360;
    const t01 = Math.max(0, Math.min(1, offsetDeg / spanDeg));
    _vbapLUT[deg] = {
      idxA: sA.idx, idxB: sB.idx,
      wA: Math.cos(t01 * Math.PI * 0.5),
      wB: Math.sin(t01 * Math.PI * 0.5),
    };
  }
}

export function rand(min, max) { return min + Math.random() * (max - min); }

// activeGrainMap: particle → { expiry, glowColor } — shared with renderer
export let activeGrainMap = new Map();

// ── Angular distance caches ────────────────────────────────────────────────
// angleBetweenSphere costs 6 transcendental ops per particle. With 500
// particles and 33 ticks/sec that's ~99 000 trig calls/sec for the cursor
// path alone, plus ~33 000 × numClouds for clouds.
//
// Cursor: angles only change when the cursor moves or particles are added/
// removed.  On a cache miss we compute angleBetweenSphere for every particle
// and store the result directly on the particle as p._cursorAng so the correct
// angle survives in-place array sorts (a positional Float32Array was wrong
// because nearest-mode sorts S.particles in-place, making _cursorAngBuf[pi]
// refer to a different particle on every cache hit).  On a cache hit we copy
// p._cursorAng → p._ang to undo any overwrite by the cloud pass.
//
// Clouds: a cloud's position is fixed after placement, so angles only need
// recomputing when S._particleVersion changes.  Stored as p[_cAng${slot}]
// on each particle — same reason as above: a positional Float32Array would
// break after any sort.  The per-cloud dirty version is kept on the cloud
// object itself so it is GC'd when the cloud is dropped.
let _cursorAngCacheLon     = null;
let _cursorAngCacheLat     = null;
let _cursorAngCachePartVer = -1;

// ── Reusable cursor effective-params object ──────────────────────────────────
// Avoids the spread-operator allocation ({...p, duration: ...}) on every cursor
// grain. Mutated in-place once per scheduleGrains tick; all cursor grains in
// the same tick share the same reference (safe because playGrain reads ep
// synchronously before returning).
const _cursorEP = {};

// ── DOM update throttling for scheduleGrains() ─────────────────────────────
// Avoid invalidating caches by throttling grain count display to ~4Hz
let _gcEl = null;
let _vmGrainsEl = null;
let _domUpdateCounter = 0;

// ── Node disconnect ───────────────────────────────────────────────────────
// Disconnects are now done immediately in the `ended` callback.
// Chrome has fixed the bulk-disconnect crash in recent versions, so we no
// longer need to batch. Immediate disconnects with error handling are safe.
function _deferDisconnect(node) {
  try { node.disconnect(); } catch (_) {}
}

// ── Reusable extra-nodes array for VBAP path ─────────────────────────────
// playGrain's multi-channel path builds a list of extra gain nodes (mixdown
// L/R) that need disconnecting on grain end.  Instead of allocating a new
// array per grain, we reuse this module-level array — cleared at the start
// of each playGrain call and snapshot-copied into the closure only when the
// grain actually has extra nodes.
const _extraNodesBuf = [];

// ── Reversed buffer cache ──────────────────────────────────────────────────
// Caches a full reversed copy of each source AudioBuffer to avoid per-grain
// allocation. WeakMap so entries are automatically GC'd when the source buffer
// (sample or live rec) is discarded.
const _reversedBufferCache = new WeakMap();

function getReversedBuffer(actx, buffer) {
  let rev = _reversedBufferCache.get(buffer);
  if (rev) return rev;

  rev = actx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = rev.getChannelData(ch);
    for (let f = 0, len = src.length; f < len; f++) {
      dst[f] = src[len - 1 - f];
    }
  }
  _reversedBufferCache.set(buffer, rev);
  return rev;
}

export function getBufferKey(p) {
  return p.source === 'live' ? `live:${p.liveBufferIdx}` : `sample:${p.sampleIndex}`;
}

export function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function applyRecencyFilter(candidates) {
  if (S.recencyN <= 0 || candidates.length === 0) return candidates;
  const bufRec = new Map();
  for (const { p } of candidates) {
    const key = getBufferKey(p);
    if ((bufRec.get(key) ?? -Infinity) < p.strokeId) bufRec.set(key, p.strokeId);
  }
  const allowed = new Set(
    [...bufRec.entries()].sort((a, b) => b[1] - a[1]).slice(0, S.recencyN).map(([k]) => k)
  );
  return candidates.filter(({ p }) => allowed.has(getBufferKey(p)));
}

// Recency filter that works directly on particle arrays (no {p} wrappers).
// Returns the allowed-set for use by _buildCandidatePool helpers.
function _recencyAllowedSet(particles, count) {
  if (S.recencyN <= 0) return null; // null = allow all
  const bufRec = new Map();
  for (let i = 0; i < count; i++) {
    const p = particles[i];
    const key = getBufferKey(p);
    if ((bufRec.get(key) ?? -Infinity) < p.strokeId) bufRec.set(key, p.strokeId);
  }
  return new Set(
    [...bufRec.entries()].sort((a, b) => b[1] - a[1]).slice(0, S.recencyN).map(([k]) => k)
  );
}

// Reusable candidate output buffer — avoids allocating a new array every tick.
let _candidateBuf = [];

// ── Pre-allocated recency filter structures ─────────────────────────────────
// Reused across all _buildCandidatePool / _buildCandidatePoolRadius calls to
// avoid creating new Map, Set, and sort-intermediate arrays on every tick.
// At 4 clouds × 100 ticks/sec this eliminates ~400 Map+Set allocations/sec.
const _recBufRec  = new Map();   // bufferKey → max strokeId
const _recAllowed = new Set();   // allowed buffer keys after recency filter
const _recSortBuf = [];          // reusable array for sorting entries by strokeId

// Shared helper: build the _recAllowed set from _recBufRec.
// Picks the recencyN most-recent buffer keys by strokeId.
function _buildAllowedFromBufRec() {
  _recAllowed.clear();
  if (_recBufRec.size === 0 || S.recencyN <= 0) return false;
  // Reuse sort buffer: copy entries, sort, pick top N
  _recSortBuf.length = 0;
  for (const entry of _recBufRec) _recSortBuf.push(entry); // [key, strokeId]
  _recSortBuf.sort((a, b) => b[1] - a[1]);
  const n = Math.min(S.recencyN, _recSortBuf.length);
  for (let i = 0; i < n; i++) _recAllowed.add(_recSortBuf[i][0]);
  return true;
}

// Build candidate pool for nearest mode: particles already sorted by _ang.
// Takes first k that pass recency filter.
// radiusRad — when provided, recency is ranked from ONLY the in-radius subset so
// that recording new buffers elsewhere never silences old buffers inside the cone.
function _buildCandidatePool(sortedParticles, k, applyRecency, radiusRad) {
  let useAllowed = false;
  if (applyRecency && S.recencyN > 0) {
    _recBufRec.clear();
    for (let i = 0; i < sortedParticles.length; i++) {
      const p = sortedParticles[i];
      if (radiusRad !== undefined && p._ang >= radiusRad) continue; // local universe
      const key = getBufferKey(p);
      if ((_recBufRec.get(key) ?? -Infinity) < p.strokeId) _recBufRec.set(key, p.strokeId);
    }
    useAllowed = _buildAllowedFromBufRec();
  }
  _candidateBuf.length = 0;
  for (let i = 0; i < sortedParticles.length && _candidateBuf.length < k; i++) {
    const p = sortedParticles[i];
    if (useAllowed && !_recAllowed.has(getBufferKey(p))) continue;
    _candidateBuf.push(p);
  }
  return _candidateBuf;
}

// Build candidate pool for radius mode: filter by _ang < radiusRad.
// Recency is ranked from the in-radius particles only (local universe),
// so buffers recorded elsewhere do not affect which local buffers are audible.
function _buildCandidatePoolRadius(particles, radiusRad) {
  // Phase 1: build per-buffer recency from ONLY in-radius particles.
  _recBufRec.clear();
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (p._ang >= radiusRad) continue;
    const key = getBufferKey(p);
    if ((_recBufRec.get(key) ?? -Infinity) < p.strokeId) _recBufRec.set(key, p.strokeId);
  }
  const useAllowed = S.recencyN > 0 ? _buildAllowedFromBufRec() : false;
  // Phase 2: collect in-radius particles that pass local recency.
  _candidateBuf.length = 0;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (p._ang >= radiusRad) continue;
    if (useAllowed && !_recAllowed.has(getBufferKey(p))) continue;
    _candidateBuf.push(p);
  }
  return _candidateBuf;
}

export function angleBetweenSphere(lon1, lat1, lon2, lat2) {
  const x1 = Math.cos(lat1)*Math.cos(lon1), y1 = Math.sin(lat1), z1 = Math.cos(lat1)*Math.sin(lon1);
  const x2 = Math.cos(lat2)*Math.cos(lon2), y2 = Math.sin(lat2), z2 = Math.cos(lat2)*Math.sin(lon2);
  return Math.acos(Math.max(-1, Math.min(1, x1*x2 + y1*y2 + z1*z2)));
}

// ── Cached Cartesian coordinates on particles ─────────────────────────────
// Pre-compute unit-sphere Cartesian [_cx, _cy, _cz] when a particle is
// created so that the hot-loop angular distance becomes acos(dot) — 1 trig
// call instead of 7 (4 cos + 2 sin + 1 acos).
// Call this once per particle at creation time.
export function stampCartesian(p) {
  const cosLat = Math.cos(p.lat);
  p._cx = cosLat * Math.cos(p.lon);
  p._cy = Math.sin(p.lat);
  p._cz = cosLat * Math.sin(p.lon);
}

// Fast angular distance using pre-cached Cartesian coords on the particle
// and a reference point's Cartesian coords passed as arguments.
function _angleFromCached(p, rx, ry, rz) {
  return Math.acos(Math.max(-1, Math.min(1, p._cx * rx + p._cy * ry + p._cz * rz)));
}

export function findNearestCloudSlot(refLon, refLat) {
  let nearestSlot = -1, nearestAng = Infinity;
  for (let i = 0; i < MAX_CLOUDS; i++) {
    if (!S.cloudSlots[i]) continue;
    const ang = angleBetweenSphere(S.cloudSlots[i].lon, S.cloudSlots[i].lat, refLon, refLat);
    if (ang < nearestAng) { nearestAng = ang; nearestSlot = i; }
  }
  return nearestSlot;
}

export function playGrain(particle, customParams, scheduledOnsetT) {
  const actx   = ensureAudioContext();
  let   buffer = null;

  if (particle.source === 'sample') {
    if (particle.sampleIndex < 0 || particle.sampleIndex >= S.samples.length) return;
    buffer = S.samples[particle.sampleIndex].buffer;
  } else if (particle.source === 'live') {
    if (particle.liveBufferIdx < 0 || particle.liveBufferIdx >= S.liveRecBuffers.length) return;
    const slot = S.liveRecBuffers[particle.liveBufferIdx];
    buffer = slot.buffer || slot.liveBuffer;
  }
  if (!buffer) return;

  const p = customParams || gp();

  // For cloud grains, use customParams directly.
  // For cursor grains, build effective params in the reusable _cursorEP object
  // to avoid per-grain object allocation from the spread operator.
  let ep;
  if (customParams) {
    ep = p;
  } else {
    const ov = S.grainOverrides;
    const ce = _cursorEP;
    // Copy all base preset keys into the reusable object
    const keys = Object.keys(p);
    for (let ki = 0; ki < keys.length; ki++) ce[keys[ki]] = p[keys[ki]];
    // Apply overrides (use != null to match the original ?? semantics —
    // grainOverrides values are null when unset, not undefined)
    if (ov.duration    != null) ce.duration    = ov.duration;
    if (ov.durJitter   != null) ce.durJitter   = ov.durJitter;
    if (ov.durVar      != null) ce.durVar      = ov.durVar;
    if (ov.fadeRatio   != null) ce.fadeRatio   = ov.fadeRatio;
    if (ov.k           != null) ce.k           = ov.k;
    if (ov.period      != null) ce.period      = ov.period;
    if (ov.periodVar   != null) ce.periodVar   = ov.periodVar;
    if (ov.pitchJitter != null) ce.pitchJitter = ov.pitchJitter;
    if (ov.panSpread   != null) ce.panSpread   = ov.panSpread;
    if (ov.volume      != null) ce.volume      = ov.volume;
    if (ov.retriggerMs != null) ce.retriggerMs = ov.retriggerMs;
    ep = ce;
  }

  const audioNow = actx.currentTime;
  if (customParams) {
    const retriggerSec = ep.retriggerMs / 1000;
    if (particle.cloudTriggeredAt !== undefined && audioNow - particle.cloudTriggeredAt < retriggerSec) return;
    particle.cloudTriggeredAt = audioNow;
  }

  const sampleDur    = buffer.duration;
  const cropStartSec = particle.source === 'sample'
    ? (S.samples[particle.sampleIndex].cropStart * sampleDur) : 0;
  const cropEndSec   = particle.source === 'sample'
    ? (S.samples[particle.sampleIndex].cropEnd   * sampleDur) : sampleDur;
  // If a pre-scheduled onset time is provided (lookahead scheduler), use it directly.
  // Otherwise fall back to a small immediate lookahead (cloud / one-shot calls).
  // Safety floor: clamp to at least 2ms in the future at call time.  The scheduler
  // samples audioNow once at the top of its tick, then does O(N log N) candidate
  // sorting before calling playGrain.  During that gap actx.currentTime advances,
  // so scheduledOnsetT can slip into the past by call-time → setValueCurveAtTime
  // throws InvalidStateError.  Math.max ensures t is always a live future value
  // regardless of how much JS ran between audioNow being read and this call.
  const LOOKAHEAD    = 0.015;
  const MIN_FUTURE_S = 0.002; // 2ms safety floor
  const baseTime  = scheduledOnsetT !== undefined
    ? Math.max(scheduledOnsetT, actx.currentTime + MIN_FUTURE_S)
    : actx.currentTime + LOOKAHEAD;

  let attackCurve, releaseCurve;
  if (customParams) {
    // Cloud grains: cache volume-scaled curves on the params object.
    // Rebuilt only when volume or curveType changes — eliminates 2 × Float32Array(128)
    // allocation per cloud grain (was the #2 OOM contributor).
    // Uses buildEnvelopeCurves so tri/rect curve types are respected (clouds snapshot
    // the active preset's curveType at drop time).
    const ctype = customParams.curveType || 'hann';
    if (!customParams._cachedAtk || customParams._cachedVol !== ep.volume || customParams._cachedCurve !== ctype) {
      const { atk, rel } = buildEnvelopeCurves(ctype, ep.volume);
      customParams._cachedAtk   = atk;
      customParams._cachedRel   = rel;
      customParams._cachedVol   = ep.volume;
      customParams._cachedCurve = ctype;
    }
    attackCurve  = customParams._cachedAtk;
    releaseCurve = customParams._cachedRel;
  } else {
    attackCurve  = S.GRAIN_ATTACK_CURVE;
    releaseCurve = S.GRAIN_RELEASE_CURVE;
  }

  const dir = customParams ? 'fwd' : S.grainDirection;

  // Minimum grain duration: 2 render quanta (≈5.8ms at 44100Hz).
  // This guarantees every grain gets a proper fade envelope — grains shorter
  // than this would be 1–2 sample impulses that sound like clicks/crackle,
  // especially when durVar pushes the raw duration negative and it clamps
  // to the old floor of 2/sampleRate (≈0.045ms = literal impulse).
  const MIN_GRAIN_DUR = (128 / actx.sampleRate) * 2;

  const t = baseTime;

    // pitchRate must be computed BEFORE startPos/actualDur because it determines
    // how much buffer the source consumes: at pitchRate > 1 the source reads
    // `dur * pitchRate` buffer-seconds in `dur` real-time seconds.  Without
    // accounting for pitch here, startPos can be positioned such that the source
    // exhausts the crop boundary early and AudioBufferSourceNode fires 'ended'
    // while the gain envelope is still non-zero → abrupt hard cut → audible click.
    // Clamping startPos so that `startPos + dur * pitchRate ≤ cropEndSec` prevents
    // premature exhaustion for any pitch; pitch < 1 uses less buffer so no change.
    // pitchJitter is stored as 2^(cents/1200) - 1, so (1 + pitchJitter) = 2^(cents/1200).
    // Raising that to a uniform random in [-1, 1] gives a symmetric musical interval:
    //   rand=+1 → maxRate    = 2^(+cents/1200)  (correct up-pitch)
    //   rand=-1 → 1/maxRate  = 2^(-cents/1200)  (correct down-pitch)
    // The old approach (1 + rand(-v, v)) made down-pitch far too extreme at high
    // values — at 700¢ it produced 0.502× (≈ -1200¢) instead of 0.668× (-700¢).
    const pitchRate = Math.max(1e-6, Math.pow(1 + ep.pitchJitter, rand(-1, 1)));

    let startPos = particle.grainStart;
    const durVarSec = customParams ? 0 : (ep.durVar ?? 0);
    const dur = Math.max(MIN_GRAIN_DUR,
      ep.duration * (1 + rand(-ep.durJitter, ep.durJitter))
      + rand(-durVarSec, durVarSec)
    );

    // How much buffer the source will read at this pitch (output seconds × rate).
    const bufferNeeded = dur * Math.max(pitchRate, 1);
    const cropLen = cropEndSec - cropStartSec;
    if (cropLen < bufferNeeded) {
      startPos = cropStartSec;
    } else {
      startPos = Math.max(cropStartSec, Math.min(startPos, cropEndSec - bufferNeeded));
    }

    // actualDur: real-time envelope span. For pitchRate > 1, `cropEndSec - startPos`
    // buffer-seconds only cover `(cropEndSec - startPos) / pitchRate` real-time
    // seconds before the source exhausts — use that as the ceiling.
    const actualDur = Math.min(dur, (cropEndSec - startPos) / Math.max(pitchRate, 1));
    if (actualDur < MIN_GRAIN_DUR) return;

    const goReverse = dir === 'rev' || (dir === 'rnd' && Math.random() < 0.5);

    const fadeRatio = ep.fadeRatio ?? 0.25;
    // One Web Audio render quantum — the minimum source.start() duration that
    // guarantees audio output (the browser rounds down to the nearest render block).
    const MIN_FADE = MIN_GRAIN_DUR / 2;  // = 128 / actx.sampleRate
    // Two tiers by grain length — 'rect' was removed because setValueAtTime(0)
    // creates a hard gain discontinuity (audible click) when sweeping duration.
    //
    //   'linear' — grain < 2 quanta (< 2×MIN_FADE): symmetric triangle ramp.
    //              Triangle covers the entire [0, 2×MIN_FADE) range smoothly,
    //              including the sub-quantum zone where 'rect' used to live.
    //              No hard step; no click anywhere in this region.
    //
    //   'curve'  — grain ≥ 2 quanta: setValueCurveAtTime Hann window.
    //              Boundary kept at 2×MIN_FADE (not 1×) because Chrome's
    //              setValueCurveAtTime requires duration ≥ 1 render quantum
    //              (128/sampleRate) per call — at 2×MIN_FADE the fade value
    //              is guaranteed ≥ MIN_FADE, satisfying that constraint.
    //              Lowering to 1×MIN_FADE causes sub-quantum fade calls that
    //              Chrome no-ops or mis-applies, producing snaps that persist
    //              even after duration is raised (scheduler loop aborts early).
    const fadeMode = actualDur < MIN_FADE * 2 ? 'linear' : 'curve';
    const fade = fadeMode === 'curve'
      ? Math.min(actualDur / 2 - 0.0001, Math.max(MIN_FADE, actualDur * Math.min(fadeRatio, 0.5)))
      : 0;
    // Silent tail: extend sourceDur past actualDur so the source outlives the
    // gain envelope.  The release automation reaches 0 at t+actualDur and the
    // GainNode holds there; GRAIN_TAIL_S extra seconds play silently through
    // the 0-gain node, so when the source finally stops there is nothing to
    // discontinue.  Without this tail, the source's stop-sample and the curve's
    // final zero-sample can land in different render quanta → the last few
    // samples run through a not-yet-zero gain → step discontinuity → click.
    // If the buffer is exhausted early (crop too short), ended fires mid-tail
    // but gain is already 0 at that point, so no click either way.
    // Adaptive silent tail: sub-quantum grains (actualDur < MIN_FADE) reach gain=0
    // within the very first render quantum, so a tail of just MIN_FADE (~3ms, 1 block)
    // is sufficient. Longer grains need 10ms (3–4 quanta) because the release curve
    // spans multiple blocks and the source must outlive the last non-zero sample.
    // Using MIN_FADE for sub-quantum grains cuts concurrent node lifetime from 10ms
    // to ~3ms, reducing live node count from ~10 to ~3 at 1ms period — lower GC load.
    const GRAIN_TAIL_S = actualDur < MIN_FADE ? MIN_FADE : 0.010;
    const sourceDur = Math.max(MIN_FADE, actualDur + GRAIN_TAIL_S);
    const source = actx.createBufferSource();

    if (goReverse) {
      // Use cached full-buffer reverse — zero per-grain allocation.
      // The reversed buffer mirrors the original: sample at time t in the
      // original is at time (bufferDuration - t) in the reversed copy.
      // To play what was at [startPos, startPos+sourceDur] in reverse,
      // we play the reversed buffer starting from (bufferDuration - startPos - sourceDur).
      const revBuf = getReversedBuffer(actx, buffer);
      source.buffer = revBuf;
    } else {
      source.buffer = buffer;
    }

    source.playbackRate.value = pitchRate; // pitchRate computed above, before startPos
    // For reverse: map the original startPos into the reversed buffer.
    // Original region [startPos, startPos+sourceDur] maps to reversed region
    // [bufDur - startPos - sourceDur, bufDur - startPos]. We start at the
    // beginning of that region and the source plays forward through the
    // already-reversed samples, producing the original audio in reverse.
    const bufferStartPos = goReverse
      ? Math.max(0, buffer.duration - startPos - sourceDur * Math.max(pitchRate, 1))
      : startPos;

    const gain = actx.createGain();
    if (fadeMode === 'linear') {
      // Sub-quantum grain: symmetric triangle (0 → peak → 0) over actualDur.
      // Source plays for sourceDur (≥ MIN_FADE) so the browser outputs audio;
      // gain reaches 0 at actualDur and stays there for the silent tail.
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(ep.volume, t + actualDur * 0.5);
      gain.gain.linearRampToValueAtTime(0,         t + actualDur);
    } else {
      // Hann window: attack ramp then release ramp, with sustain in between.
      // setValueCurveAtTime requires fade ≥ 1 render quantum; the boundary
      // above guarantees this. The try/catch is a last-resort safety net so
      // that a bad call can never throw and abort the scheduler's while loop
      // (which would stall _cursorNextOnsetT and cause persistent snapping).
      // NOTE: do NOT call setValueAtTime(0, t) here. Chrome treats a SetValue
      // event at exactly t as overlapping with setValueCurveAtTime(…, t, fade)
      // (which also starts at t) and can throw InvalidStateError or silently
      // treat the curve as a no-op — both produce a loud rectangular burst.
      // attackCurve[0] is already 0 and the gain node initialises to 0, so
      // no additional "pre-zero" event is needed.
      try {
        gain.gain.setValueCurveAtTime(attackCurve,  t,               fade);
        gain.gain.setValueCurveAtTime(releaseCurve, t + actualDur - fade, fade);
      } catch (_) {
        // Fallback: triangle ramp so the grain is never silent or unclamped.
        // IMPORTANT: setValueAtTime(0, t) goes here (NOT in the try block above).
        // The GainNode's default gain is 1.0 — without anchoring at 0 first,
        // linearRampToValueAtTime ramps from 1.0 at actx.currentTime to ep.volume,
        // so the grain starts at full volume and produces a loud burst/crackle.
        // Placing the anchor only in the catch block avoids the original conflict:
        // setValueAtTime(0, t) + setValueCurveAtTime(…, t, …) at the same time t
        // can cause Chrome to treat the curve as overlapping with the SetValue event.
        //
        // Nested try/catch: linearRamp can also throw in rare Chrome edge-cases
        // (e.g. during AudioContext resumption when event ordering is violated).
        // An uncaught throw here would propagate out of playGrain and stall the
        // onset clock in the scheduler while loop (see scheduleGrains guard).
        try {
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(ep.volume, t + actualDur * 0.5);
          gain.gain.linearRampToValueAtTime(0,         t + actualDur);
        } catch (_2) {
          // Both curve and ramp automation failed entirely — cancel all events
          // and hold gain at 0 (silent) so the scheduler can still advance.
          gain.gain.cancelScheduledValues(0);
          gain.gain.value = 0;
        }
      }
    }

    const [wx, wy, wz] = spherePoint(particle.lon, particle.lat);

    // Sim mode:      transform grain into camera space — panning is view-relative
    //                (turn your head left, a front grain moves right = pans right).
    // Physical mode: use world-space position directly — speakers are fixed in the
    //                room, turning your body doesn't move the sound. The camera
    //                (and sensor) still rotates visually but audio is absolute.
    const [cx, cy, cz] = S.spatialMode === 'physical'
      ? [wx, wy, wz]
      : qRotateVec(qConjugate(S.camQ), [wx, wy, wz]);

    // At dense grain periods (≤ 5ms, ≥ 200Hz repetition) spatial positioning is
    // acoustically inaudible — the human auditory system integrates pan position
    // over 2–5ms, so changes faster than 200Hz are heard as timbre, not movement.
    // Skip the elevation-gain and stereo-panner nodes entirely to cut per-grain
    // node creation by 1–2 Web Audio nodes per grain.
    // IMPORTANT: the period minimum is now 1ms. Without this threshold covering ≥1ms,
    // every grain at the new floor would use the full 4-node chain (source + gain +
    // elevGain + panner) → ~4000 node ops/s → Chrome audio renderer crash.
    // Threshold at 5ms keeps the lightweight path for the entire dense-granulation
    // range while restoring full spatial processing at ≥ 6ms (100Hz and below).
    const audioRate = ep.period <= 0.005;

    // Elevation attenuation — fold into main gain to avoid a separate node
    const elevNorm  = cz !== 0 ? Math.min(1, Math.abs(cy / Math.abs(cz))) : 0;
    const elevScale = 1 - elevNorm * 0.35;
    // Insert elevScale node only when meaningfully different from 1 (elevation
    // > ~10°) and we're NOT in audio-rate mode where the node cost dominates.
    const needsElevNode = !audioRate && elevScale < 0.98;
    let lastNode = gain; // track the last node in the chain for connecting
    let elevGainNode = null;
    if (needsElevNode) {
      elevGainNode = actx.createGain();
      elevGainNode.gain.value = elevScale;
      gain.connect(elevGainNode);
      lastNode = elevGainNode;
    }

    source.connect(gain);

    if (S.speakerBuses?.length) {
      // ── Multi-channel speaker path (Electron) ─────────────────────────────
      // Project grain's camera-space horizontal angle onto the speaker ring using
      // angle-aware 2-D VBAP: find the two speakers that bracket the grain's
      // azimuth by their actual angleDeg values (not by index), so any speaker
      // layout — including stereo L/R at 270°/90° — pans correctly.
      //
      // Camera space: cx = right, cz = into screen (negative = toward viewer).
      // Azimuth: atan2(cx, -cz) → 0 = front, clockwise positive.

      const isCursorGrain = !customParams;

      // ── Cursor → mixdown direct feed (always, independent of house mute) ──
      // When mixdownCursorInputs exist, cursor grains always get a dedicated
      // L/R send so the mixdown cursor-gain slider works regardless of whether
      // the cursor is muted in the house or not.
      _extraNodesBuf.length = 0;  // reuse module-level array; snapshot below
      const cursorDestL = isCursorGrain ? (S.mixdownCursorInputs?.[0] ?? null) : null;
      const cursorDestR = isCursorGrain ? (S.mixdownCursorInputs?.[1] ?? null) : null;
      if (cursorDestL && cursorDestR) {
        const azimuthPan = cz !== 0 ? Math.max(-1, Math.min(1, cx / Math.abs(cz))) : 0;
        const panJitter  = rand(-ep.panSpread * 0.5, ep.panSpread * 0.5);
        const pan        = Math.max(-1, Math.min(1, azimuthPan + panJitter));
        const lW = Math.cos((pan + 1) * Math.PI / 4);  // equal-power
        const rW = Math.sin((pan + 1) * Math.PI / 4);

        const gL = actx.createGain(); gL.gain.value = lW;
        const gR = actx.createGain(); gR.gain.value = rW;

        lastNode.connect(gL); gL.connect(cursorDestL);
        lastNode.connect(gR); gR.connect(cursorDestR);
        _extraNodesBuf.push(gL, gR);
      }
      // Snapshot: the ended callback fires asynchronously, so capture
      // a local copy only when there are extra nodes to disconnect.
      const _extraNodes = _extraNodesBuf.length > 0
        ? _extraNodesBuf.slice()  // small (≤2 elements), only when mixdown active
        : null;

      // ── Cursor house mute: skip house VBAP when cursor is muted ───────────
      // When muted AND no mixdown exists → grain is simply not played
      // (pared-down demo mode: only planted clouds are heard).
      if (isCursorGrain && S.cursorHouseMuted) {
        if (cursorDestL && cursorDestR) {
          // Cursor already routed to mixdown above — just start & clean up
          source.start(t, bufferStartPos, sourceDur);
          S._grainSourceCount++;
          source.addEventListener('ended', () => {
            S._grainSourceCount = Math.max(0, S._grainSourceCount - 1);
            _deferDisconnect(source); _deferDisconnect(gain);
            if (elevGainNode) _deferDisconnect(elevGainNode);
            if (_extraNodes) for (const n of _extraNodes) _deferDisconnect(n);
          }, { once: true });
        }
        // else: no mixdown, cursor muted → grain not played

      } else {
      // ── Normal VBAP routing (cursor unmuted, or cloud grains always) ───────
      // All grains spatialise through the house speaker field.
      // Cursor grains additionally feed the mixdown cursor inputs (above).
      const speakers = S.speakerBuses;
      const n        = speakers.length;

      // Raw azimuth in radians, with pan-spread jitter, normalised to [0, 2π).
      // Camera space: cz>0 = in front of listener, cx>0 = to listener's right.
      // atan2(cx, cz): 0°=front, 90°=right, 180°=rear, 270°=left — matches the
      // speaker bus layout (bus 0 = 0° = front for n≥3; R=90°/L=270° for n=2).
      const TWO_PI = 2 * Math.PI;
      const rawAz  = Math.atan2(cx, cz);
      const jitter = rand(-ep.panSpread * 0.5, ep.panSpread * 0.5);
      let   az     = ((rawAz + jitter) % TWO_PI + TWO_PI) % TWO_PI;
      const azDeg  = az * (180 / Math.PI);

      // O(1) VBAP via pre-computed lookup table
      const lut = _vbapLUT?.[Math.round(azDeg) % 360];
      const wA = lut ? lut.wA : 0.707;
      const wB = lut ? lut.wB : 0.707;
      const idxA = lut ? lut.idxA : 0;
      const idxB = lut ? lut.idxB : Math.min(1, n - 1);

      // Create per-grain gain nodes only for the two active speakers
      const gA = actx.createGain(); gA.gain.value = wA;
      const gB = actx.createGain(); gB.gain.value = wB;

      lastNode.connect(gA); gA.connect(speakers[idxA].bus);
      lastNode.connect(gB); gB.connect(speakers[idxB].bus);

      source.start(t, bufferStartPos, sourceDur);
      S._grainSourceCount++;
      source.addEventListener('ended', () => {
        S._grainSourceCount = Math.max(0, S._grainSourceCount - 1);
        _deferDisconnect(source); _deferDisconnect(gain);
        if (elevGainNode) _deferDisconnect(elevGainNode);
        _deferDisconnect(gA); _deferDisconnect(gB);
        for (const n of _extraNodes) _deferDisconnect(n);
      }, { once: true });
      } // end normal VBAP

    } else {
      // ── Stereo path ────────────────────────────────────────────────────────
      // Stereo placement: blend from sphere-position-based azimuth (panSpread=0)
      // to a fully independent random position per grain (panSpread=1).
      // This gives true shimmer/scatter behaviour — every grain fires at a new
      // random pan position — rather than just widening a single azimuth point.
      // At intermediate spread values, spatial positioning is gradually loosened.
      // At audio-rate periods the panner is skipped entirely (see audioRate above).
      const azimuthPan = cz !== 0 ? Math.max(-1, Math.min(1, cx / Math.abs(cz))) : 0;
      const finalPan   = audioRate ? 0 : Math.max(-1, Math.min(1,
        azimuthPan * (1 - ep.panSpread) + rand(-1, 1) * ep.panSpread
      ));
      // Skip the StereoPanner node at audio rate, or when pan is effectively zero.
      const needsPanner = !audioRate && (Math.abs(finalPan) > 0.01 || ep.panSpread > 0.01);

      // Phase 1 bus routing: cursor grains → monitorBus, cloud grains → houseBus.
      // Falls back to masterBus if the improv buses haven't been created yet.
      const isCursorGrain = !customParams;
      const destBus = isCursorGrain
        ? (S.monitorBus || getMasterBus())
        : (S.houseBus   || getMasterBus());

      if (needsPanner) {
        const panner = actx.createStereoPanner();
        panner.pan.value = finalPan;
        lastNode.connect(panner);
        panner.connect(destBus);

        source.start(t, bufferStartPos, sourceDur);
        S._grainSourceCount++;
        source.addEventListener('ended', () => {
          S._grainSourceCount = Math.max(0, S._grainSourceCount - 1);
          _deferDisconnect(source); _deferDisconnect(gain);
          if (elevGainNode) _deferDisconnect(elevGainNode);
          _deferDisconnect(panner);
        }, { once: true });
      } else {
        lastNode.connect(destBus);

        source.start(t, bufferStartPos, sourceDur);
        S._grainSourceCount++;
        source.addEventListener('ended', () => {
          S._grainSourceCount = Math.max(0, S._grainSourceCount - 1);
          _deferDisconnect(source); _deferDisconnect(gain);
          if (elevGainNode) _deferDisconnect(elevGainNode);
          // lastNode is either gain (if no elevGainNode) or elevGainNode;
          // both are already queued above, so no extra disconnect needed.
        }, { once: true });
      }
    }

  if (particle.source === 'sample') {
    // Fixed-capacity ring: overwrite the oldest slot by index instead of
    // using push+shift (shift is O(N) and push allocates a new object).
    // The ui-samples.js compaction loop reads entries up to .length and
    // skips stale ones, so overwriting old entries is safe.
    const AG_CAP = MAX_GRAIN_NODES * 2;
    const ag = S.activeGrains;
    const nowPerf = performance.now();
    if (ag.length < AG_CAP) {
      ag.push({
        sampleIndex:   particle.sampleIndex,
        grainStart:    startPos,
        grainDuration: actualDur,
        startTime:     nowPerf,
        totalDuration: actualDur
      });
    } else {
      // Reuse the slot at the write cursor — avoids object allocation
      const slot = ag[S._agWriteIdx];
      slot.sampleIndex   = particle.sampleIndex;
      slot.grainStart    = startPos;
      slot.grainDuration = actualDur;
      slot.startTime     = nowPerf;
      slot.totalDuration = actualDur;
      S._agWriteIdx = (S._agWriteIdx + 1) % AG_CAP;
    }
  }
}

let _schedLastAt = 0;
// Audio-clock time (actx.currentTime seconds) of the next cursor grain onset.
// Using the audio clock instead of performance.now() allows sub-10ms periods:
// each scheduler tick looks ahead by SCHED_LOOKAHEAD seconds and fires all
// onsets that fall within that window, so periods much shorter than the
// tick interval work correctly (comb/zipper effect into audio-rate territory).
let _cursorNextOnsetT  = null;   // null = not yet initialised
let _cursorNextPeriodS = null;   // next inter-onset interval in seconds
let _cursorReanchorAt  = 0;      // audio-clock time of next fp re-anchor

// How far ahead we schedule grain onsets (seconds). Must be > scheduler interval
// to guarantee grains are always scheduled before they need to play.
const SCHED_LOOKAHEAD = 0.120;   // 120ms lookahead window

// Hard limit on grains created per scheduler call.  Each grain allocates 2–5
// Web Audio nodes synchronously on the main thread.
//
// With SCHED_SAFE_PERIOD_S = 2ms and SCHED_LOOKAHEAD = 120ms, the window holds
// 60 onsets.  12 per tick × 100 ticks/sec = 1 200 grain-creations/sec max.
// Smooth delivery requires MAX_GRAINS_PER_TICK ≥ interval/period = 10ms/2ms = 5.
// 12 gives 2.4× headroom and keeps the scheduler comfortably ahead.
//
// The old burst-on-reset crash (slider drag → 20 clock nulls/sec × 12-grain
// bursts = 240 burst grains/sec → OOM) is no longer possible because
// resetCursorPeriod now clamps the clock forward instead of nulling it.
const MAX_GRAINS_PER_TICK = 12;

// SCHED_SAFE_PERIOD_S (2ms) is imported from state.js so both the grain
// scheduler and the UI slider share the same floor.  See state.js for docs.

export function scheduleGrains() {
  // Guard: don't burn CPU scheduling grains while the context is suspended
  if (!S.audioCtx || S.audioCtx.state !== 'running') return;

  const now = performance.now();
  if (_schedLastAt > 0) perf.schedulerDrift = Math.max(0, (now - _schedLastAt) - GRAIN_SCHEDULER_INTERVAL_MS);
  _schedLastAt = now;

  // Always prune stale glow-map entries — even when the node budget is
  // exhausted.  The old placement after the early return meant the map was
  // never cleaned when _grainSourceCount stayed at MAX_GRAIN_NODES for
  // seconds (long-duration grains), causing unbounded memory growth.
  for (const [particle, entry] of activeGrainMap) {
    if (now > entry.expiry) activeGrainMap.delete(particle);
  }

  if (S._grainSourceCount >= MAX_GRAIN_NODES) return;

  const actx = ensureAudioContext();
  // Don't attempt to schedule while the context is suspended or still resuming.
  // ensureAudioContext() calls resume() but doesn't await it, so there is a
  // window where state is still 'suspended' and currentTime is frozen.
  // Scheduling in that window produces grains at t ≈ frozen-audioNow which,
  // by the time setValueCurveAtTime() is called a few µs later, is already
  // slightly in the past → Chrome throws InvalidStateError.
  if (actx.state !== 'running') {
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return;
  }
  const audioNow = actx.currentTime;
  // Horizon: schedule all onsets up to this audio time
  const scheduleUntil = audioNow + SCHED_LOOKAHEAD;

  const { lon: cursorLon, lat: cursorLat } =
    (S.mouseInCanvas || S.altLocked)
      ? screenToLonLat(S.altLocked ? S.altFrozenMousePixelX : S.mousePixelX,
                       S.altLocked ? S.altFrozenMousePixelY : S.mousePixelY)
      : getCursorLonLat();
  const k = S.grainOverrides.k ?? gp().k;
  const searchRadiusRad = S.searchRadiusDeg * Math.PI / 180;

  S.liveGranulatingThisFrame = false;
  perf.grainsFired = 0;

  if (S.particles.length) {
    const basePeriodS = S.grainOverrides.period ?? gp().period;
    const periodVarS  = S.grainOverrides.periodVar ?? 0;

    // Stale-clock guard: if the onset clock is far ahead of audioNow the
    // AudioContext was likely recreated (currentTime reset to 0) and the old
    // clock value is meaningless.  Reset so the scheduler reinitialises.
    if (_cursorNextOnsetT !== null && (_cursorNextOnsetT - audioNow) > 30.0) {
      _cursorNextOnsetT  = null;
      _cursorNextPeriodS = null;
    }

    // Initialise next onset to just ahead of now on first call or after reset.
    // Use audioNow + 0.005 (same forward margin as the snap guard) so the very
    // first grain after a reset is never at exactly audioNow — by call-time that
    // would already be in the past and cause setValueCurveAtTime to throw.
    if (_cursorNextOnsetT === null) {
      _cursorNextOnsetT  = audioNow + 0.005;
      _cursorNextPeriodS = Math.max(SCHED_SAFE_PERIOD_S, basePeriodS + rand(-periodVarS, periodVarS));
    }

    // Pre-compute candidate pool once per scheduler tick (shared by all onsets in window).
    // Dirty-flag: skip the trig loop when the cursor position and particle set
    // are unchanged from the previous tick.  angleBetweenSphere costs 6
    // transcendental ops per particle; skipping it saves ~16 500 trig calls/sec
    // at 500 particles / 33 ticks/sec whenever the cursor is still.
    // When the cache is valid we still need to restore p._ang from the buffer
    // because the cloud loop may have overwritten it in the previous tick.
    const particles = S.particles;
    const pLen = particles.length;
    const cursorAngDirty = cursorLon !== _cursorAngCacheLon
                        || cursorLat !== _cursorAngCacheLat
                        || S._particleVersion !== _cursorAngCachePartVer;
    if (cursorAngDirty) {
      // Pre-compute cursor Cartesian once; per-particle cost is then just
      // acos(dot) = 1 trig call instead of 4 cos + 2 sin + 1 acos = 7.
      const cosLat = Math.cos(cursorLat);
      const crx = cosLat * Math.cos(cursorLon);
      const cry = Math.sin(cursorLat);
      const crz = cosLat * Math.sin(cursorLon);
      for (let pi = 0; pi < pLen; pi++) {
        const p = particles[pi];
        // Ensure particle has cached Cartesian (set at creation, but guard old particles)
        if (p._cx === undefined) stampCartesian(p);
        const ang = _angleFromCached(p, crx, cry, crz);
        p._cursorAng = ang;
        p._ang       = ang;
      }
      _cursorAngCacheLon     = cursorLon;
      _cursorAngCacheLat     = cursorLat;
      _cursorAngCachePartVer = S._particleVersion;
    } else {
      // Restore from per-particle cache — correct regardless of sort order.
      for (let pi = 0; pi < pLen; pi++) particles[pi]._ang = particles[pi]._cursorAng ?? 0;
    }

    // Pre-sort / filter candidate pool once for all onsets in this tick window.
    // Build candidatePool in-place reusing _angSortBuf to avoid .map()/.filter() allocations.
    let candidatePool;
    if (S.nearestMode) {
      particles.sort((a, b) => a._ang - b._ang);
      // kAllMode: no k cap — use all particles (still recency-filtered).
      // Pass searchRadiusRad so recency is ranked from the local cone, not globally.
      candidatePool = S.grainKAllMode
        ? _buildCandidatePool(particles, particles.length, true, searchRadiusRad)
        : _buildCandidatePool(particles, k, true, searchRadiusRad);
    } else {
      candidatePool = _buildCandidatePoolRadius(particles, searchRadiusRad);
    }

    // Budget: how many cursor grains to schedule this tick.
    // Use the full SCHED_LOOKAHEAD window (120ms) — not just minAheadS (≈15ms).
    // With minAheadS, short-period presets like shimmer (period≈55ms) only got
    // budgetPerTick=1, so dynamicUntil ended up just 55ms ahead. Any JS jitter
    // longer than one period caused audio gaps with a consistent rhythmic crackle.
    // Using SCHED_LOOKAHEAD gives budgetPerTick≈3 for shimmer and advances
    // scheduleUntil 120ms ahead, which is the intent of that constant.
    // Floor period for budget calc only — prevents 2000+ grainsNeeded at sub-ms periods.
    const schedPeriodS  = Math.max(SCHED_SAFE_PERIOD_S, basePeriodS);
    const grainsNeeded  = Math.ceil(SCHED_LOOKAHEAD / Math.max(schedPeriodS, minGrainPeriodS()));
    const nodesBudget   = Math.max(0, MAX_GRAIN_NODES - S._grainSourceCount);
    // Dynamic throttle: when the node pool is > 75% full, halve the per-tick
    // budget.  This back-pressures creation during extreme combos (long dur +
    // short period) so Chrome's audio renderer has time to process existing
    // nodes instead of being flooded with new ones.  The 75% threshold is
    // well above normal usage (~20-50 nodes) so musical presets are unaffected.
    const poolPressure  = S._grainSourceCount / MAX_GRAIN_NODES;
    const pressureCap   = poolPressure > 0.75 ? Math.max(2, MAX_GRAINS_PER_TICK >> 1) : MAX_GRAINS_PER_TICK;
    const budgetPerTick = Math.min(grainsNeeded, nodesBudget, pressureCap);
    // scheduleUntil (= audioNow + SCHED_LOOKAHEAD) was already computed above but
    // was never used as the while-loop bound — use it now.

    let iterations = 0;
    while (_cursorNextOnsetT < scheduleUntil && iterations < budgetPerTick) {
      // We're behind — snap forward by 5ms so t is safely in the future when
      // setValueCurveAtTime() is called inside playGrain.  Using exactly
      // audioNow risks a race: actx.currentTime advances a few µs between
      // sampling audioNow here and the actual Web Audio API call, making
      // Chrome consider t "in the past" and throw InvalidStateError.
      if (_cursorNextOnsetT < audioNow) {
        _cursorNextOnsetT = audioNow + 0.005;
      }

      let toGranulate = [];
      if (S.nearestMode) {
        toGranulate = candidatePool;
      } else {
        // kAllMode: use the full radius pool with no k cap.
        // Otherwise nearest K from within the radius pool — _ang already stamped.
        toGranulate = S.grainKAllMode || candidatePool.length <= k
          ? candidatePool
          : candidatePool.sort((a, b) => a._ang - b._ang).slice(0, k);
      }

      if (toGranulate.length > 0) {
        if (!(S.grainProbability < 1.0 && Math.random() > S.grainProbability)) {
          const p = toGranulate[Math.floor(Math.random() * toGranulate.length)];
          const liveDurMs = (S.grainOverrides.duration ?? gp().duration) * 1000;
          activeGrainMap.set(p, { expiry: now + liveDurMs, glowColor: '#ffffff' });
          // Wrap playGrain so any unexpected throw never stalls the onset clock.
          // Without this guard, an exception here exits the while loop before
          // _cursorNextOnsetT advances; on the next tick the same onset is
          // retried, throws again, and the clock is stuck permanently.
          try {
            playGrain(p, null, _cursorNextOnsetT);
            perf.grainsFired++;
            if (p.source === 'live') S.liveGranulatingThisFrame = true;
          } catch (_) { /* clock still advances unconditionally below */ }
        }
      }

      // Advance to next onset — always runs, even if playGrain threw above.
      // Floor at SCHED_SAFE_PERIOD_S (10ms) so the onset clock always advances.
      // Without this, sub-10ms periods with many grains per tick could stall the
      // clock, cause the snap guard to fire every tick, and spike node creation.
      _cursorNextPeriodS = Math.max(SCHED_SAFE_PERIOD_S, basePeriodS + rand(-periodVarS, periodVarS));
      _cursorNextOnsetT += _cursorNextPeriodS;
      iterations++;
    }

    // ── Onset clock re-anchoring ──────────────────────────────────────────
    // Floating-point accumulation drift: after thousands of additions the
    // onset time diverges from the true audio clock.  Every 30 seconds,
    // snap the fractional offset (onset - audioNow) onto a fresh audioNow
    // base so the accumulation error resets.  The musical effect is
    // imperceptible — the jitter from periodVar already exceeds fp drift.
    if (_cursorNextOnsetT !== null && audioNow > (_cursorReanchorAt ?? 0)) {
      const offset = _cursorNextOnsetT - audioNow;
      if (offset > 0 && offset < SCHED_LOOKAHEAD * 2) {
        _cursorNextOnsetT = audioNow + offset; // re-anchor to fresh base
      }
      _cursorReanchorAt = audioNow + 30.0; // next re-anchor in 30s
    }
  }

  // ── Phase 3: Nearest-cloud navigation — compute per-cloud weights ──────
  // collage: every cloud has weight 1 (all play equally).
  // nearest: distance-weighted blend toward closest cloud(s).
  //   cloudNearestAlways=true  → always plays something (closest cloud never silent)
  //   cloudNearestAlways=false → gated by cursor radius; clouds outside fade to silence
  // cloudSnapFade controls blending: 0 = hard snap (nearest only), 1 = full crossfade.
  const _cloudWeights = new Float32Array(MAX_CLOUDS); // reused each tick
  if (S.cloudMode === 'nearest') {
    const radiusGated = !S.cloudNearestAlways;
    // Radius gate when not "always" (reuse the cursor search radius)
    const gateRadRad = radiusGated ? (S.searchRadiusDeg * Math.PI / 180) : Infinity;

    // Gather distances from cursor to each active cloud
    const cloudDists = [];
    for (let i = 0; i < MAX_CLOUDS; i++) {
      const cloud = S.cloudSlots[i];
      if (!cloud) { _cloudWeights[i] = 0; continue; }
      const dist = angleBetweenSphere(cloud.lon, cloud.lat, cursorLon, cursorLat);
      // When radius-gated, skip clouds outside the search radius
      if (radiusGated && dist > gateRadRad) { _cloudWeights[i] = 0; continue; }
      cloudDists.push({ i, dist });
    }

    if (cloudDists.length > 0) {
      // Sort to find nearest
      cloudDists.sort((a, b) => a.dist - b.dist);
      const nearestIdx = cloudDists[0].i;
      const sf = S.cloudSnapFade; // 0 = snap, 1 = crossfade

      if (sf < 0.001) {
        // Pure snap: only nearest (in-range) cloud plays
        for (const { i } of cloudDists) _cloudWeights[i] = i === nearestIdx ? 1 : 0;
      } else {
        // Distance-weighted crossfade with softmax-style blending.
        // At sf=1: pure inverse-distance weighting.
        // At 0<sf<1: sharpen the distribution toward nearest.
        // Sharpness exponent: 1/sf gives higher exponent at low sf (sharper focus).
        const sharpness = 1 / Math.max(0.01, sf);
        let sumW = 0;
        const EPSILON = 0.001; // prevent division by zero for coincident positions
        for (const { i, dist } of cloudDists) {
          const w = Math.pow(1 / (dist + EPSILON), sharpness);
          _cloudWeights[i] = w;
          sumW += w;
        }
        // Normalise to [0, 1]
        if (sumW > 0) {
          for (const { i } of cloudDists) _cloudWeights[i] /= sumW;
        }
      }

      // Store dominant cloud index for UI highlighting
      S._dominantCloudSlot = nearestIdx;
    } else {
      // Radius-gated: no clouds in range → all silent
      S._dominantCloudSlot = -1;
    }
  } else {
    // Collage mode: all active clouds play at full weight
    for (let i = 0; i < MAX_CLOUDS; i++) {
      _cloudWeights[i] = S.cloudSlots[i] ? 1 : 0;
    }
    S._dominantCloudSlot = -1;
  }

  for (let i = 0; i < MAX_CLOUDS; i++) {
    const cloud = S.cloudSlots[i];
    if (!cloud || !S.particles.length) continue;

    // Reusable effective params object — avoids per-grain allocation
    if (!cloud._effectiveParams) cloud._effectiveParams = {};

    // Phase 3: skip clouds with negligible weight in nearest mode
    const cloudWeight = _cloudWeights[i];
    if (cloudWeight < 0.001) {
      // Still advance the onset clock so it doesn't burst when weight returns
      if (cloud._nextOnsetT !== undefined) {
        const cgpSkip = cloud.grainParams;
        const skipPeriod = Math.max(SCHED_SAFE_PERIOD_S, cgpSkip.period);
        const skipUntil = (ensureAudioContext().currentTime) + SCHED_LOOKAHEAD;
        while (cloud._nextOnsetT < skipUntil) {
          cloud._nextOnsetT += skipPeriod;
        }
      }
      continue;
    }

    // Phase 4: merge cloud.grainOverrides (written by gesture morph) on top of
    // the planted snapshot. Overrides with non-null values take precedence.
    const baseGP = cloud.grainParams;
    const cgo    = cloud.grainOverrides;
    let cgp;
    if (cgo && Object.keys(cgo).length > 0) {
      // Prototype chain avoids full object copy: reads fall through to baseGP
      // for unoverridden keys. _cachedAtk is nulled by morph on change so
      // playGrain rebuilds envelope curves with the morphed volume/fade.
      cgp = Object.assign(Object.create(baseGP), cgo);
    } else {
      cgp = baseGP;
    }
    const basePeriodS  = cgp.period;
    const periodVarS   = cgp.periodVar ?? 0;

    // Initialise cloud onset clock on first use — same 5ms forward margin as
    // the cursor init so the first cloud grain is never at exactly currentTime.
    if (cloud._nextOnsetT === undefined) {
      cloud._nextOnsetT = ensureAudioContext().currentTime + 0.005;
    }

    // Stamp cloud-relative angle on particles (reuses _ang property).
    // Dirty-flag: cloud positions are fixed after placement, so angles only
    // change when the particle set changes (S._particleVersion bumps).
    // Stored as p[cAngKey] on each particle (not a positional Float32Array)
    // so the correct angle survives after the cursor or cloud path sorts
    // S.particles in-place — same reasoning as p._cursorAng above.
    const cParts  = S.particles;
    const cLen    = cParts.length;
    const cAngKey = `_cAng${cloud.slotIndex}`;
    if (cloud._angBufPartVer !== S._particleVersion) {
      // Pre-compute cloud Cartesian once; use cached particle Cartesian for dot
      if (cloud._crx === undefined) {
        const cosLat = Math.cos(cloud.lat);
        cloud._crx = cosLat * Math.cos(cloud.lon);
        cloud._cry = Math.sin(cloud.lat);
        cloud._crz = cosLat * Math.sin(cloud.lon);
      }
      for (let pi = 0; pi < cLen; pi++) {
        const p = cParts[pi];
        if (p._cx === undefined) stampCartesian(p);
        const ang = _angleFromCached(p, cloud._crx, cloud._cry, cloud._crz);
        p[cAngKey] = ang;
        p._ang     = ang;
      }
      cloud._angBufPartVer = S._particleVersion;
    } else {
      // Restore from per-particle cache — correct regardless of sort order.
      for (let pi = 0; pi < cLen; pi++) cParts[pi]._ang = cParts[pi][cAngKey] ?? 0;
    }

    // Hoist cloudRadiusRad so both branches (nearest + radius) can use it for
    // local recency ranking — same fix as cursor path.
    const cloudRadiusRad = cloud.searchRadiusDeg * Math.PI / 180;
    let pool;
    if (cloud.nearestMode) {
      cParts.sort((a, b) => a._ang - b._ang);
      // kAllMode: no k cap — all particles (still recency-filtered).
      // Pass cloudRadiusRad so recency uses the local cone, not globally.
      pool = cloud.kAllMode
        ? _buildCandidatePool(cParts, cParts.length, true, cloudRadiusRad)
        : _buildCandidatePool(cParts, cgp.k, true, cloudRadiusRad);
    } else {
      pool = _buildCandidatePoolRadius(cParts, cloudRadiusRad);
      // Nearest K from within the radius — same logic as cursor path.
      // Skip k cap when kAllMode is on.
      if (!cloud.kAllMode && pool.length > cgp.k) pool.sort((a, b) => a._ang - b._ang).length = cgp.k;
    }

    const cloudAudioNow   = ensureAudioContext().currentTime;
    // Same fix as cursor path: use SCHED_LOOKAHEAD (120ms) for budget/window,
    // not minAheadS (≈15ms), so cloud grains are scheduled far enough ahead
    // to survive JS timer jitter without rhythmic crackle.
    const cloudSchedUntil   = cloudAudioNow + SCHED_LOOKAHEAD;
    // Floor period for budget calc only — same OOM guard as cursor path.
    const cloudSchedPeriodS = Math.max(SCHED_SAFE_PERIOD_S, basePeriodS);
    const cloudGrainsNeeded = Math.ceil(SCHED_LOOKAHEAD / Math.max(cloudSchedPeriodS, minGrainPeriodS()));
    const cloudNodesBudget  = Math.max(0, MAX_GRAIN_NODES - S._grainSourceCount);
    const cloudBudget = Math.min(cloudGrainsNeeded, cloudNodesBudget, MAX_GRAINS_PER_TICK);

    if (!pool.length) {
      // Still advance the clock even if no particles in range.
      // Floor at SCHED_SAFE_PERIOD_S to match the OOM guard on the firing path.
      while (cloud._nextOnsetT < cloudSchedUntil) {
        const p = Math.max(SCHED_SAFE_PERIOD_S, basePeriodS + rand(-periodVarS, periodVarS));
        cloud._nextOnsetT += p;
      }
      continue;
    }

    let cloudIter = 0;
    while (cloud._nextOnsetT < cloudSchedUntil && cloudIter < cloudBudget) {
      if (cloud._nextOnsetT < cloudAudioNow) {
        cloud._nextOnsetT = cloudAudioNow + 0.005; // 5ms forward margin (same race-guard as cursor)
      }

      const p = pool[Math.floor(Math.random() * pool.length)];
      try {
        // Phase 3: scale cloud volume by navigation weight.
        // When cloudWeight < 1 (nearest-cloud mode), attenuate the grain volume.
        // Reuse cgp directly when weight is 1 to avoid object allocation.
        let effectiveParams;
        if (cloudWeight < 0.999) {
          const ep = cloud._effectiveParams;
          // Copy all properties from cgp (shallow, avoids prototype chain)
          const keys = Object.keys(cgp);
          for (let ki = 0; ki < keys.length; ki++) ep[keys[ki]] = cgp[keys[ki]];
          // Also copy prototype properties (from baseGP through Object.create chain)
          const baseKeys = Object.keys(cloud.grainParams);
          for (let ki = 0; ki < baseKeys.length; ki++) {
            if (!(baseKeys[ki] in ep)) ep[baseKeys[ki]] = cloud.grainParams[baseKeys[ki]];
          }
          ep.volume = cgp.volume * cloudWeight;
          // Invalidate envelope cache only when volume actually changed
          if (ep._lastCloudWeight !== cloudWeight) {
            ep._cachedAtk = null;
            ep._lastCloudWeight = cloudWeight;
          }
          effectiveParams = ep;
        } else {
          effectiveParams = cgp;
        }
        playGrain(p, effectiveParams, cloud._nextOnsetT);
        activeGrainMap.set(p, { expiry: now + cgp.duration * 1000, glowColor: cloud.color });
        perf.grainsFired++;
        if (p.source === 'live') S.liveGranulatingThisFrame = true;
      } catch (_) { /* clock still advances below */ }

      const nextPeriod = Math.max(SCHED_SAFE_PERIOD_S, basePeriodS + rand(-periodVarS, periodVarS));
      cloud._nextOnsetT += nextPeriod;
      cloudIter++;
    }
  }

  // Feed rolling grain rate accumulator (read by perfTick in state.js).
  perf._grainAccum += perf.grainsFired;

  // Throttle DOM updates to ~4Hz (every 25th tick at 10ms interval)
  if (++_domUpdateCounter >= 25) {
    _domUpdateCounter = 0;
    const activeCount = activeGrainMap.size;
    if (!_gcEl) _gcEl = document.getElementById('granulatingCount');
    if (_gcEl) _gcEl.textContent = activeCount;
    if (!_vmGrainsEl) _vmGrainsEl = document.getElementById('vmGrains');
    if (_vmGrainsEl) _vmGrainsEl.textContent = `${activeCount} grains`;
  }
}

// Reset onset clock when period/periodVar changes (called from ui-presets.js).
// When switching from a long period (e.g. 3s) to a short one the clock can be
// far in the future — without correction the scheduler would fire no grains for
// seconds.  The old approach nulled the clock, but that caused a 12-grain burst
// on reinit (the full 120ms lookahead window filled in one tick).  During rapid
// slider dragging 20 nulls/sec × 12 grains = 240 burst grains/sec → OOM.
//
// New approach: clamp the clock to just one period ahead of audioNow.  The
// scheduler sees one grain due on the next tick instead of an empty 120ms
// window to fill.  No burst, no silence, immediate response to new period.
export function resetCursorPeriod() {
  const audioNow = S.audioCtx?.currentTime ?? 0;
  if (_cursorNextOnsetT === null) return; // nothing to reset
  if (_cursorNextOnsetT > audioNow + SCHED_LOOKAHEAD) {
    // Clock is beyond the lookahead horizon — pull it back to one period ahead.
    const newPeriod = Math.max(SCHED_SAFE_PERIOD_S, S.grainOverrides.period ?? gp().period);
    _cursorNextOnsetT  = audioNow + newPeriod;
    _cursorNextPeriodS = newPeriod;
  }
}

// Register the global onset-clock reset callback so audio.js can invoke it
// when the AudioContext transitions from 'suspended' → 'running'.  Resetting
// here prevents the scheduler from trying to schedule grains at the frozen
// pre-suspension audioNow, which would be in the past by call-time and cause
// setValueCurveAtTime to throw (→ persistent snapping / "stuck on triangle").
S._resetOnsetClocks = () => {
  _cursorNextOnsetT  = null;
  _cursorNextPeriodS = null;
  // Also reset cloud onset clocks so they reinitialise cleanly from resumed time
  if (S.cloudSlots) {
    for (let i = 0; i < S.cloudSlots.length; i++) {
      const cloud = S.cloudSlots[i];
      if (cloud) delete cloud._nextOnsetT;
    }
  }
};
