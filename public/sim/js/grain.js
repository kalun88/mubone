import { S, HANN_LEN, HANN_ATTACK, HANN_RELEASE, MAX_SEEDS, MAX_SEQS, MAX_GRAIN_NODES, GRAIN_SCHEDULER_INTERVAL_MS, SCHED_SAFE_PERIOD_S, SPHERE_RADIUS, perf, gp, minGrainDurS, minGrainPeriodS, buildEnvelopeCurves } from './state.js';
import { ensureAudioContext, getMasterBus } from './audio.js';
import { spherePoint, qRotateVec, qConjugate, cameraTransform, getCursorLonLat, screenToLonLat, cameraTransformInto, spherePointInto, updateFusedCamQ } from './sphere.js';
import { tickSeedRecording } from './ui-presets.js';

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
// path alone, plus ~33 000 × numSeeds for seeds.
//
// Cursor: angles only change when the cursor moves or particles are added/
// removed.  On a cache miss we compute angleBetweenSphere for every particle
// and store the result directly on the particle as p._cursorAng so the correct
// angle survives in-place array sorts (a positional Float32Array was wrong
// because nearest-mode sorts S.particles in-place, making _cursorAngBuf[pi]
// refer to a different particle on every cache hit).  On a cache hit we copy
// p._cursorAng → p._ang to undo any overwrite by the seed pass.
//
// Seeds: a seed's position is fixed after placement, so angles only need
// recomputing when S._particleVersion changes.  Stored as p[_cAng${slot}]
// on each particle — same reason as above: a positional Float32Array would
// break after any sort.  The per-seed dirty version is kept on the seed
// object itself so it is GC'd when the seed is dropped.
let _cursorAngCacheLon     = null;
let _cursorAngCacheLat     = null;
let _cursorAngCachePartVer = -1;
let _cursorAngStampLen     = 0;

// ── Reusable cursor effective-params object ──────────────────────────────────
// Avoids the spread-operator allocation ({...p, duration: ...}) on every cursor
// grain. Mutated in-place once per scheduleGrains tick; all cursor grains in
// the same tick share the same reference (safe because playGrain reads ep
// synchronously before returning).
const _cursorEP = {};
// Radius fade: per-grain distance attenuation set by scheduleGrains, read by playGrain.
// 1.0 = no attenuation (centre), 0.0 = silent (edge). Reset after each playGrain call.
let _radiusFadeAtten = 1.0;

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

// ── Zero-allocation scratch buffers for per-grain spatial math ────────────
// Avoids creating ~15 temporary arrays per playGrain call.  Updated in-place
// by spherePointInto / cameraTransformInto; never leaked to closures.
const _grainScratchW = [0, 0, 0];   // world-space particle position
const _grainScratchC = [0, 0, 0];   // camera-space panning position

// ── Seed focus-mode weight buffer ────────────────────────────────────────
// Allocated once; .fill(0) each scheduler tick instead of `new Float32Array`
// every 10ms (was 100 allocs/sec → needless GC pressure).
const _seedWeights = new Float32Array(MAX_SEEDS);

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
// At 4 seeds × 100 ticks/sec this eliminates ~400 Map+Set allocations/sec.
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

// ── O(N) k-selection for nearest mode ──────────────────────────────────────
// Replaces the O(N log N) sort-then-take-k pattern that was being called per
// seed per tick (16 seeds × sort(500) = 72,000 comparisons/tick).  This does
// a single linear pass collecting the k smallest-_ang particles, applying
// recency filtering inline.  Result is written into _candidateBuf (unsorted,
// but that's fine — grain selection picks randomly from the pool anyway).
//
// _kSelectBuf: fixed-size max-heap of {p, ang} with size ≤ k.  We maintain
// the max at index 0 so each particle only compares against the largest
// element in the heap — O(N log k) total, but for small k (≤16) the log k
// is negligible and the constant factor is tiny.
const _kSelectBuf = [];

function _buildCandidatePoolNearest(particles, k, applyRecency, radiusRad) {
  // Phase 0: build recency allow-set from in-radius particles (same as before)
  let useAllowed = false;
  if (applyRecency && S.recencyN > 0) {
    _recBufRec.clear();
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (radiusRad !== undefined && p._ang >= radiusRad) continue;
      const key = getBufferKey(p);
      if ((_recBufRec.get(key) ?? -Infinity) < p.strokeId) _recBufRec.set(key, p.strokeId);
    }
    useAllowed = _buildAllowedFromBufRec();
  }

  // Phase 1: single-pass k-selection — keep the k smallest _ang particles
  _kSelectBuf.length = 0;
  let maxIdx = 0;  // index of current max in _kSelectBuf
  let maxAng = 0;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const ang = p._ang;
    if (useAllowed && !_recAllowed.has(getBufferKey(p))) continue;
    if (_kSelectBuf.length < k) {
      _kSelectBuf.push(p);
      if (ang > maxAng || _kSelectBuf.length === 1) {
        maxAng = ang; maxIdx = _kSelectBuf.length - 1;
      }
    } else if (ang < maxAng) {
      // Replace the current max with this closer particle
      _kSelectBuf[maxIdx] = p;
      // Rescan for new max (k is small, ≤16, so this is cheap)
      maxAng = 0; maxIdx = 0;
      for (let j = 0; j < _kSelectBuf.length; j++) {
        if (_kSelectBuf[j]._ang > maxAng) { maxAng = _kSelectBuf[j]._ang; maxIdx = j; }
      }
    }
  }

  // Copy to _candidateBuf
  _candidateBuf.length = _kSelectBuf.length;
  for (let i = 0; i < _kSelectBuf.length; i++) _candidateBuf[i] = _kSelectBuf[i];
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
  const x1 = Math.cos(lat1)*Math.sin(lon1), y1 = Math.sin(lat1), z1 = Math.cos(lat1)*Math.cos(lon1);
  const x2 = Math.cos(lat2)*Math.sin(lon2), y2 = Math.sin(lat2), z2 = Math.cos(lat2)*Math.cos(lon2);
  return Math.acos(Math.max(-1, Math.min(1, x1*x2 + y1*y2 + z1*z2)));
}

// ── Cached Cartesian coordinates on particles ─────────────────────────────
// Pre-compute unit-sphere Cartesian [_cx, _cy, _cz] when a particle is
// created so that the hot-loop angular distance becomes acos(dot) — 1 trig
// call instead of 7 (4 cos + 2 sin + 1 acos).
// Call this once per particle at creation time.
export function stampCartesian(p) {
  const cosLat = Math.cos(p.lat);
  p._cx = cosLat * Math.sin(p.lon);
  p._cy = Math.sin(p.lat);
  p._cz = cosLat * Math.cos(p.lon);
}

// Fast angular distance using pre-cached Cartesian coords on the particle
// and a reference point's Cartesian coords passed as arguments.
function _angleFromCached(p, rx, ry, rz) {
  return Math.acos(Math.max(-1, Math.min(1, p._cx * rx + p._cy * ry + p._cz * rz)));
}

export function findNearestSeedSlot(refLon, refLat, { skipReleasing = false } = {}) {
  let nearestSlot = -1, nearestAng = Infinity;
  for (let i = 0; i < S.commitSlotCount; i++) {
    const seed = S.commitSlots[i];
    if (!seed || seed.type !== 'cloud') continue;
    if (skipReleasing && seed._releasingAt > 0) continue;
    // Moving seeds: measure distance from the start position (frames[0]),
    // not the current animated position — avoids disorienting results as
    // the cursor moves along the path.
    const sLon = (seed.frames && seed.frames.length) ? seed.frames[0].lon : seed.lon;
    const sLat = (seed.frames && seed.frames.length) ? seed.frames[0].lat : seed.lat;
    const ang = angleBetweenSphere(sLon, sLat, refLon, refLat);
    if (ang < nearestAng) { nearestAng = ang; nearestSlot = i; }
  }
  return nearestSlot;
}

export function playGrain(particle, customParams, scheduledOnsetT) {
  const actx   = ensureAudioContext();
  // Defensive: don't schedule grains while context is suspended/closed.
  // The caller (scheduleGrains) already guards, but external callers or
  // future refactors could bypass it.
  if (actx.state !== 'running') return;
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

  // For seed grains, use customParams directly.
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
    if (ov.pitchShift  != null) ce.pitchShift  = ov.pitchShift;
    if (ov.panSpread   != null) ce.panSpread   = ov.panSpread;
    if (ov.volume      != null) ce.volume      = ov.volume;
    if (ov.retriggerMs != null) ce.retriggerMs = ov.retriggerMs;
    // Apply radius fade distance attenuation (set by scheduleGrains)
    if (_radiusFadeAtten < 1.0) ce.volume *= _radiusFadeAtten;
    ep = ce;
  }

  const audioNow = actx.currentTime;
  if (customParams) {
    const retriggerSec = ep.retriggerMs / 1000;
    if (particle.seedTriggeredAt !== undefined && audioNow - particle.seedTriggeredAt < retriggerSec) return;
    particle.seedTriggeredAt = audioNow;
  }

  const sampleDur    = buffer.duration;
  const cropStartSec = particle.source === 'sample'
    ? (S.samples[particle.sampleIndex].cropStart * sampleDur) : 0;
  const cropEndSec   = particle.source === 'sample'
    ? (S.samples[particle.sampleIndex].cropEnd   * sampleDur) : sampleDur;
  // If a pre-scheduled onset time is provided (lookahead scheduler), use it directly.
  // Otherwise fall back to a small immediate lookahead (seed / one-shot calls).
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
    // Seed grains: cache volume-scaled curves on the params object.
    // Rebuilt only when volume or curveType changes — eliminates 2 × Float32Array(128)
    // allocation per seed grain (was the #2 OOM contributor).
    // Uses buildEnvelopeCurves so tri/rect curve types are respected (seeds snapshot
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
    // Base pitch shift (cents → rate multiplier): 2^(cents/1200).
    // pitchShift=0 → 1.0 (no change), ±1200 → octave up/down.
    const shiftRate = (ep.pitchShift ?? 0) !== 0 ? Math.pow(2, ep.pitchShift / 1200) : 1;
    const pitchRate = Math.max(1e-6, shiftRate * Math.pow(1 + ep.pitchJitter, rand(-1, 1)));

    let startPos = particle.grainStart;
    const durVarSec = customParams ? 0 : (ep.durVar ?? 0);
    const dur = Math.max(MIN_GRAIN_DUR,
      ep.duration * (1 + rand(-ep.durJitter, ep.durJitter))
      + rand(-durVarSec, durVarSec)
    );

    // How much buffer the source will read at this pitch (output seconds × rate).
    // Include a 10ms silent tail — the source plays for (dur + tail) real-time
    // seconds, consuming (dur + tail) * pitchRate buffer-seconds. Without this,
    // pitched-up grains (pitchRate > 1) exhaust the crop boundary during the
    // tail, causing the source to stop while the gain envelope is still non-zero
    // → audible click. The tail ensures the gain reaches zero first.
    const TAIL_BUDGET_S = 0.010;
    const bufferNeeded = (dur + TAIL_BUDGET_S) * Math.max(pitchRate, 1);
    const cropLen = cropEndSec - cropStartSec;
    if (cropLen < bufferNeeded) {
      startPos = cropStartSec;
    } else {
      startPos = Math.max(cropStartSec, Math.min(startPos, cropEndSec - bufferNeeded));
    }

    // actualDur: real-time envelope span. For pitchRate > 1, `cropEndSec - startPos`
    // buffer-seconds only cover `(cropEndSec - startPos) / pitchRate` real-time
    // seconds before the source exhausts — use that as the ceiling.
    // Subtract the tail budget so the envelope fits entirely before the tail.
    const availableRealTime = (cropEndSec - startPos) / Math.max(pitchRate, 1);
    const actualDur = Math.min(dur, availableRealTime - TAIL_BUDGET_S);
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
    // sourceDur: how long the source should produce output in REAL-TIME seconds.
    // The gain envelope spans actualDur; GRAIN_TAIL_S adds silent padding after.
    const sourceDur = Math.max(MIN_FADE, actualDur + GRAIN_TAIL_S);
    // sourceBufferDur: how many buffer-seconds the source will consume at this
    // pitchRate.  Used for reverse-path offset calculation and startPos clamping.
    const sourceBufferDur = sourceDur * Math.max(pitchRate, 1);
    const source = actx.createBufferSource();

    if (goReverse) {
      // Use cached full-buffer reverse — zero per-grain allocation.
      // The reversed buffer mirrors the original: sample at time t in the
      // original is at time (bufferDuration - t) in the reversed copy.
      // To play what was at [startPos, startPos+sourceBufferDur] in reverse,
      // we play the reversed buffer starting from (bufferDuration - startPos - sourceBufferDur).
      const revBuf = getReversedBuffer(actx, buffer);
      source.buffer = revBuf;
    } else {
      source.buffer = buffer;
    }

    source.playbackRate.value = pitchRate; // pitchRate computed above, before startPos
    // For reverse: map the original startPos into the reversed buffer.
    // Original region [startPos, startPos+sourceBufferDur] maps to reversed region
    // [bufDur - startPos - sourceBufferDur, bufDur - startPos]. We start at the
    // beginning of that region and the source plays forward through the
    // already-reversed samples, producing the original audio in reverse.
    const bufferStartPos = goReverse
      ? Math.max(0, buffer.duration - startPos - sourceBufferDur)
      : startPos;

    const gain = actx.createGain();
    // When radius fade attenuation is active, force linear (triangle) envelope
    // so ep.volume (already scaled by _radiusFadeAtten) controls the peak directly.
    // Pre-built Hann curves are shared/pre-scaled to full volume and can't be
    // per-grain attenuated without allocation. Triangle is inaudibly different
    // on quieter grains and avoids an extra GainNode.
    // Force linear envelope when per-grain volume varies to avoid Float32Array
    // allocation per grain.  Cursor fade uses _radiusFadeAtten; seed fade uses
    // per-particle _cFade{slot} which changes ep.volume each grain.
    const useLinearFade = fadeMode === 'linear'
      || (!customParams && _radiusFadeAtten < 1.0)
      || (customParams && customParams._hasPerParticleFade);
    if (useLinearFade) {
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

    // Zero-alloc scratch for spatial panning (reused across grains)
    const _gW = _grainScratchW, _gC = _grainScratchC;
    spherePointInto(particle.lon, particle.lat, _gW);
    const wx = _gW[0], wy = _gW[1], wz = _gW[2];

    // Worldlocked:  particle's sphere-local position drives panning directly.
    //               Speakers are fixed in the room — neither cursor nor frame
    //               movement should change what you hear.
    // Headlocked:   transform into the viewer's visual space — panning matches what
    //               you see (left on screen = left in audio).  Uses cameraTransformInto
    //               (fused quaternion, single rotation, zero allocs).  In 1-IMU mode
    //               (no frameQ) this reduces to qRotateVec(conj(camQ), …).  In 2-IMU
    //               mode the cursor determines WHAT plays but the FRAME (projector)
    //               determines WHERE it's heard: cursor off-screen-left → audio left.
    //
    // frameQ is a VISUAL transform that MUST NOT enter worldlocked (it caused drift)
    // but MUST enter headlocked — that's the whole point of view-relative panning.
    let cx, cy, cz;
    if (S.spatialPanning === 'worldlocked') {
      cx = wx; cy = wy; cz = wz;
    } else {
      cameraTransformInto(wx, wy, wz, _gC);
      cx = _gC[0]; cy = _gC[1]; cz = _gC[2];
    }

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
      // Camera space: cx = right, cz = into screen (forward).
      // Azimuth: atan2(cx, cz) → 0° = front, 90° = right, 180° = rear, 270° = left.

      const isCursorGrain = !customParams;

      // ── Cursor → mixdown direct feed (always, independent of house mute) ──
      // When mixdownCursorInputs exist, cursor grains always get a dedicated
      // L/R send so the mixdown cursor-gain slider works regardless of whether
      // the cursor is muted in the house or not.
      _extraNodesBuf.length = 0;  // reuse module-level array; snapshot below
      const cursorDestL = isCursorGrain ? (S.mixdownCursorInputs?.[0] ?? null) : null;
      const cursorDestR = isCursorGrain ? (S.mixdownCursorInputs?.[1] ?? null) : null;
      if (cursorDestL && cursorDestR) {
        const mxRawPan = cz !== 0 ? Math.max(-1, Math.min(1, cx / Math.abs(cz))) : 0;
        // Elevation center-bias only in worldlocked — headlocked cy is view-relative
        const mxElF = S.spatialPanning === 'worldlocked' ? Math.abs(cy) * (1 / SPHERE_RADIUS) : 0;
        const azimuthPan = mxRawPan * (1 - mxElF * mxElF);
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

      // ── Scan off: skip house VBAP when scan is muted ──────────────────────
      // When scan is off AND no mixdown exists → grain is simply not played
      // (pared-down demo mode: only planted seeds are heard).
      if (isCursorGrain && S.scanMuted) {
        if (cursorDestL && cursorDestR) {
          // Cursor already routed to mixdown above — just start & clean up
          source.start(t, bufferStartPos);
          source.stop(t + sourceDur);
          S._grainSourceCount++;
          source.addEventListener('ended', () => {
            S._grainSourceCount = Math.max(0, S._grainSourceCount - 1);
            _deferDisconnect(source); _deferDisconnect(gain);
            if (elevGainNode) _deferDisconnect(elevGainNode);
            if (_extraNodes) for (const n of _extraNodes) _deferDisconnect(n);
          }, { once: true });
        }
        // else: no mixdown, scan off → grain not played

      } else {
      // ── Normal VBAP routing (cursor unmuted, or seed grains always) ───────
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
      let wA = lut ? lut.wA : 0.707;
      let wB = lut ? lut.wB : 0.707;
      const idxA = lut ? lut.idxA : 0;
      const idxB = lut ? lut.idxB : Math.min(1, n - 1);

      // ── Elevation-dependent center bias ──────────────────────────────────
      // With a single horizontal speaker ring, sources near the poles have
      // ambiguous azimuth. Blend VBAP gains toward equal-power distribution
      // as |elevation| increases.  Uses sin²(el) for a gentle onset — full
      // VBAP below ~30°, gradual collapse above, fully centered at poles.
      // |cy| / SPHERE_RADIUS = |sin(elevation)| — no extra trig needed.
      const elevFrac = Math.abs(cy) * (1 / SPHERE_RADIUS);  // 0 at equator, 1 at pole
      const elevBias = elevFrac * elevFrac;                  // sin²(el)
      if (elevBias > 0.01) {
        const eqGain = 1 / Math.sqrt(n);  // equal-power per speaker
        wA = wA + (eqGain - wA) * elevBias;
        wB = wB + (eqGain - wB) * elevBias;
      }

      // Create per-grain gain nodes only for the two active speakers
      const gA = actx.createGain(); gA.gain.value = wA;
      const gB = actx.createGain(); gB.gain.value = wB;

      lastNode.connect(gA); gA.connect(speakers[idxA].bus);
      lastNode.connect(gB); gB.connect(speakers[idxB].bus);

      source.start(t, bufferStartPos);
      source.stop(t + sourceDur);
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
      const rawAzPan = cz !== 0 ? Math.max(-1, Math.min(1, cx / Math.abs(cz))) : 0;
      // Elevation center-bias: collapse stereo pan toward center at poles.
      // Only in worldlocked — headlocked cy is view-relative, not world elevation.
      const stElF = S.spatialPanning === 'worldlocked' ? Math.abs(cy) * (1 / SPHERE_RADIUS) : 0;
      const stElB = stElF * stElF;
      const azimuthPan = rawAzPan * (1 - stElB);
      const finalPan   = audioRate ? 0 : Math.max(-1, Math.min(1,
        azimuthPan * (1 - ep.panSpread) + rand(-1, 1) * ep.panSpread
      ));
      // Skip the StereoPanner node at audio rate, or when pan is effectively zero.
      const needsPanner = !audioRate && (Math.abs(finalPan) > 0.01 || ep.panSpread > 0.01);

      // Phase 1 bus routing: cursor grains → monitorBus, seed grains → houseBus.
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

        source.start(t, bufferStartPos);
        source.stop(t + sourceDur);
        S._grainSourceCount++;
        source.addEventListener('ended', () => {
          S._grainSourceCount = Math.max(0, S._grainSourceCount - 1);
          _deferDisconnect(source); _deferDisconnect(gain);
          if (elevGainNode) _deferDisconnect(elevGainNode);
          _deferDisconnect(panner);
        }, { once: true });
      } else {
        lastNode.connect(destBus);

        source.start(t, bufferStartPos);
        source.stop(t + sourceDur);
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
let _cursorSeqIdx      = 0;      // sequential K mode: index into sorted candidate pool
let _cursorSeqPool     = [];     // sequential K mode: last sorted pool (for stable stepping)

// How far ahead we schedule grain onsets (seconds). Must be > scheduler interval
// to guarantee grains are always scheduled before they need to play.
// 40ms = 4× the 10ms scheduler interval — tight for low latency but enough
// headroom for normal JS thread jitter. Grains are never more than 40ms stale
// when parameters change, so slider scrubbing feels immediate.
// (Was 120ms — caused sluggish parameter response during scrubbing because
// grains were committed far ahead with stale values.)
const SCHED_LOOKAHEAD = 0.040;   // 40ms lookahead window

// Hard limit on grains created per scheduler call.  Each grain allocates 2–5
// Web Audio nodes synchronously on the main thread.
//
// With SCHED_SAFE_PERIOD_S = 10ms and SCHED_LOOKAHEAD = 40ms, the window holds
// 4 onsets.  12 per tick × 100 ticks/sec = 1 200 grain-creations/sec max.
// Smooth delivery requires MAX_GRAINS_PER_TICK ≥ interval/period = 10ms/10ms = 1.
// 12 gives generous headroom for catch-up after jitter.
//
// The old burst-on-reset crash (slider drag → 20 clock nulls/sec × 12-grain
// bursts = 240 burst grains/sec → OOM) is no longer possible because
// resetCursorPeriod now clamps the clock forward instead of nulling it.
const MAX_GRAINS_PER_TICK = 12;

// SCHED_SAFE_PERIOD_S (2ms) is imported from state.js so both the grain
// scheduler and the UI slider share the same floor.  See state.js for docs.

// ── Moving seed helpers ────────────────────────────────────────────────────
// Interpolate a moving seed's frame data at its current playhead position.
export function _interpolateMovingSeed(seed) {
  const { frames, duration, loopMode, _playheadMs } = seed;
  if (!frames.length) return null;
  let effectiveT;
  if (loopMode === 'pingpong') {
    const cycle = duration * 2;
    const pos = _playheadMs % cycle;
    effectiveT = pos <= duration ? pos : cycle - pos;
  } else if (loopMode === 'rev') {
    // Reverse: traverse path end→start, looping. As playhead advances,
    // effectiveT counts down from duration to 0, then wraps back to duration.
    const pos = _playheadMs % duration;
    effectiveT = duration - pos;
  } else {
    // 'forward' (default): traverse path start→end, looping.
    effectiveT = _playheadMs % duration;
  }
  // Binary search for bounding frames
  let lo = 0, hi = frames.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= effectiveT) lo = mid;
    else hi = mid;
  }
  const a = frames[lo], b = frames[hi];
  if (lo === hi || a.t === b.t) return a;
  const frac = (effectiveT - a.t) / (b.t - a.t);
  return {
    lon:               a.lon + (b.lon - a.lon) * frac,
    lat:               a.lat + (b.lat - a.lat) * frac,
    grainParams:       frac < 0.5 ? a.grainParams : b.grainParams,
    searchRadiusDeg:   a.searchRadiusDeg + (b.searchRadiusDeg - a.searchRadiusDeg) * frac,
    nearestMode:       frac < 0.5 ? a.nearestMode : b.nearestMode,
    kAllMode:          frac < 0.5 ? a.kAllMode : b.kAllMode,
    kSeqMode:          frac < 0.5 ? a.kSeqMode : b.kSeqMode,
    grainDirection:    frac < 0.5 ? a.grainDirection : b.grainDirection,
    grainCurveType:    frac < 0.5 ? a.grainCurveType : b.grainCurveType,
    grainProbability:  a.grainProbability + (b.grainProbability - a.grainProbability) * frac,
    radiusFadeEnabled: frac < 0.5 ? a.radiusFadeEnabled : b.radiusFadeEnabled,
    radiusFadeCurve:   a.radiusFadeCurve + (b.radiusFadeCurve - a.radiusFadeCurve) * frac,
  };
}

// Advance a moving seed's playhead.
function _advanceMovingSeed(seed, deltaMs) {
  seed._playheadMs += deltaMs;
}

export function scheduleGrains() {
  // Refresh the fused camera quaternion so headlocked panning in playGrain
  // uses the latest camQ/frameQ even if the scheduler fires between frames.
  updateFusedCamQ();

  // Prune stale glow-map entries BEFORE the AudioContext guard so entries
  // added just before suspension still get cleaned up.  Without this, the
  // map would hold stale references until the context resumes.
  const now = performance.now();
  for (const [particle, entry] of activeGrainMap) {
    if (now > entry.expiry) activeGrainMap.delete(particle);
  }

  // Guard: don't burn CPU scheduling grains while the context is suspended
  if (!S.audioCtx || S.audioCtx.state !== 'running') return;

  if (_schedLastAt > 0) perf.schedulerDrift = Math.max(0, (now - _schedLastAt) - GRAIN_SCHEDULER_INTERVAL_MS);
  _schedLastAt = now;

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
    S.cursorQ
      ? getCursorLonLat()                       // detethered: cursor IMU drives position
      : (S.mouseInCanvas || S.altLocked)
        ? screenToLonLat(S.altLocked ? S.altFrozenMousePixelX : S.mousePixelX,
                         S.altLocked ? S.altFrozenMousePixelY : S.mousePixelY)
        : getCursorLonLat();
  const k = S.grainOverrides.k ?? gp().k;
  const searchRadiusRad = S.searchRadiusDeg * Math.PI / 180;

  S.liveGranulatingThisFrame = false;
  perf.grainsFired = 0;

  if (S.particles.length && !(S.seqModeEnabled && S.isPainting)) {
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
    // because the seed loop may have overwritten it in the previous tick.
    const particles = S.particles;
    const pLen = particles.length;
    const cursorMoved = cursorLon !== _cursorAngCacheLon
                      || cursorLat !== _cursorAngCacheLat;
    const cursorAngDirty = cursorMoved
                        || S._particleVersion !== _cursorAngCachePartVer;
    if (cursorAngDirty) {
      const cosLat = Math.cos(cursorLat);
      const crx = cosLat * Math.sin(cursorLon);
      const cry = Math.sin(cursorLat);
      const crz = cosLat * Math.cos(cursorLon);
      // If cursor moved, all particles need re-stamping.
      // If only particles changed (painting), incrementally stamp new ones.
      const stampFrom = cursorMoved ? 0 : (_cursorAngStampLen ?? 0);
      // Copy cached values for already-stamped particles
      for (let pi = 0; pi < Math.min(stampFrom, pLen); pi++) {
        particles[pi]._ang = particles[pi]._cursorAng ?? 0;
      }
      // Stamp new / invalidated particles
      for (let pi = stampFrom; pi < pLen; pi++) {
        const p = particles[pi];
        if (p._cx === undefined) stampCartesian(p);
        const ang = _angleFromCached(p, crx, cry, crz);
        p._cursorAng = ang;
        p._ang       = ang;
      }
      _cursorAngCacheLon     = cursorLon;
      _cursorAngCacheLat     = cursorLat;
      _cursorAngCachePartVer = S._particleVersion;
      _cursorAngStampLen     = pLen;
    } else {
      // Restore from per-particle cache — correct regardless of sort order.
      for (let pi = 0; pi < pLen; pi++) particles[pi]._ang = particles[pi]._cursorAng ?? 0;
    }

    // Pre-sort / filter candidate pool once for all onsets in this tick window.
    // Build candidatePool in-place reusing _angSortBuf to avoid .map()/.filter() allocations.
    let candidatePool;
    // k-all is incompatible with k-nearest — guard here in case state leaks through
    const effectiveKAll = S.grainKAllMode && !S.nearestMode;
    if (S.nearestMode) {
      // O(N) k-selection — no sort of the global particles array.
      candidatePool = _buildCandidatePoolNearest(particles, k, false, undefined);
    } else {
      candidatePool = _buildCandidatePoolRadius(particles, searchRadiusRad);
    }
    // In nearest mode the whole sphere is available — pool = total particles
    perf.kPool = S.nearestMode ? particles.length : candidatePool.length;
    // Effective k count: how many candidates will actually be selected per onset.
    // Computed once per tick (same result for every onset in the while loop).
    perf.kCount = S.nearestMode || effectiveKAll || candidatePool.length <= k
      ? candidatePool.length
      : k;

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

      let toGranulate;
      if (S.nearestMode || effectiveKAll || candidatePool.length <= k) {
        toGranulate = candidatePool;
      } else {
        // Radius mode with k cap: k-selection (O(N)) instead of sort+slice.
        // Runs inside the onset while-loop, so must be cheap.
        toGranulate = _buildCandidatePoolNearest(candidatePool, k, false, undefined);
      }

      if (toGranulate.length > 0) {
        if (!(S.grainProbability < 1.0 && Math.random() > S.grainProbability)) {
          let p;
          if (S.grainKSeqMode && toGranulate.length > 1) {
            // Sequential mode: sort candidates by grainStart (recording order)
            // and step through them one by one. Rebuild the sorted pool when
            // the candidate set changes (pool identity or length shift).
            if (_cursorSeqPool !== toGranulate || _cursorSeqPool.length !== toGranulate.length) {
              _cursorSeqPool = toGranulate.slice().sort((a, b) => a.grainStart - b.grainStart);
              // Reset index unless the old particle is still in the new pool
              const oldP = _cursorSeqPool[_cursorSeqIdx];
              if (!oldP || toGranulate.indexOf(oldP) === -1) _cursorSeqIdx = 0;
            }
            _cursorSeqIdx = _cursorSeqIdx % _cursorSeqPool.length;
            p = _cursorSeqPool[_cursorSeqIdx];
            _cursorSeqIdx = (_cursorSeqIdx + 1) % _cursorSeqPool.length;
          } else {
            p = toGranulate[Math.floor(Math.random() * toGranulate.length)];
          }
          const liveDurMs = (S.grainOverrides.duration ?? gp().duration) * 1000;
          activeGrainMap.set(p, { expiry: now + liveDurMs, glowColor: '#ffffff' });
          S._lastCursorGrainParticle = p;

          // ── Radius fade: distance-based volume attenuation ──────────────
          // Set _radiusFadeAtten for playGrain to read when building ep.volume.
          // p._ang = angular distance (rad) from cursor; searchRadiusRad = max.
          // t=0 at centre → full volume; t=1 at edge → near-silent.
          // Curve exponent: 1 + curve*3 (0→linear, 0.5→quadratic, 1→quartic).
          if (S.radiusFadeEnabled && !S.nearestMode && searchRadiusRad > 0) {
            const t = Math.min(1, (p._ang ?? 0) / searchRadiusRad);
            const exp = 1 + S.radiusFadeCurve * 3;
            _radiusFadeAtten = Math.pow(1 - t, exp);  // 1 at centre, 0 at edge
          } else {
            _radiusFadeAtten = 1.0;
          }

          // Wrap playGrain so any unexpected throw never stalls the onset clock.
          // Without this guard, an exception here exits the while loop before
          // _cursorNextOnsetT advances; on the next tick the same onset is
          // retried, throws again, and the clock is stuck permanently.
          try {
            playGrain(p, null, _cursorNextOnsetT);
            perf.grainsFired++;
            if (p.source === 'live') S.liveGranulatingThisFrame = true;
          } catch (_) { /* clock still advances unconditionally below */ }
          _radiusFadeAtten = 1.0;  // reset for safety
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
  } else {
    perf.kCount = 0;
    perf.kPool  = 0;
  }

  // ── Pre-advance moving seed playheads ──────────────────────────────────
  // Moving seeds must advance their playhead every tick regardless of weight,
  // so the position used for distance/weight calculation below is current.
  // Also updates seed.lon/lat to the interpolated position so that weight
  // calculation, angular distance cache, and grain scheduling all use the
  // correct moving position.
  for (let i = 0; i < MAX_SEEDS; i++) {
    const seed = S.commitSlots[i];
    if (!seed || seed.type !== 'cloud' || !seed.frames || i >= S.commitSlotCount) continue;
    _advanceMovingSeed(seed, GRAIN_SCHEDULER_INTERVAL_MS);
    const frame = _interpolateMovingSeed(seed);
    if (frame) {
      seed._currentFrame = frame;
      seed.lon = frame.lon;
      seed.lat = frame.lat;
      // Invalidate angular distance cache for this seed since position changed
      seed._crx = undefined;
      seed._angBufPartVer = -1;
    }
  }

  // ── Phase 3: Seed navigation — compute per-seed weights ────────────────
  // all: every seed has weight 1 (all play equally).
  // focus: distance-weighted blend toward closest seed(s).
  //   seedTether=true  → always plays something (closest seed never silent)
  //   seedTether=false → gated by cursor radius; seeds outside fade to silence
  // seedXfade controls blending: 0 = hard snap (focus only), 1 = full crossfade.
  _seedWeights.fill(0);  // clear module-level buffer (no allocation)
  if (S.commitPlayback === 'focus') {
    const radiusGated = !S.commitTether;
    // Radius gate when not "always" (reuse the cursor search radius)
    const gateRadRad = radiusGated ? (S.searchRadiusDeg * Math.PI / 180) : Infinity;

    // Gather distances from cursor to each active seed
    const seedDists = [];
    for (let i = 0; i < MAX_SEEDS; i++) {
      const seed = S.commitSlots[i];
      if (!seed || seed.type !== 'cloud' || i >= S.commitSlotCount) { _seedWeights[i] = 0; continue; }
      const dist = angleBetweenSphere(seed.lon, seed.lat, cursorLon, cursorLat);
      // When radius-gated, skip seeds outside the search radius
      if (radiusGated && dist > gateRadRad) { _seedWeights[i] = 0; continue; }
      seedDists.push({ i, dist });
    }

    if (seedDists.length > 0) {
      // Sort to find nearest
      seedDists.sort((a, b) => a.dist - b.dist);
      const nearestIdx = seedDists[0].i;
      const sf = S.commitXfade; // 0 = snap, 1 = crossfade

      if (sf < 0.001) {
        // Pure snap: only nearest (in-range) seed plays
        for (const { i } of seedDists) _seedWeights[i] = i === nearestIdx ? 1 : 0;
      } else {
        // Distance-weighted crossfade with softmax-style blending.
        // At sf=1: pure inverse-distance weighting.
        // At 0<sf<1: sharpen the distribution toward nearest.
        // Sharpness exponent: 1/sf gives higher exponent at low sf (sharper focus).
        const sharpness = 1 / Math.max(0.01, sf);
        let sumW = 0;
        const EPSILON = 0.001; // prevent division by zero for coincident positions
        for (const { i, dist } of seedDists) {
          const w = Math.pow(1 / (dist + EPSILON), sharpness);
          _seedWeights[i] = w;
          sumW += w;
        }
        // Normalise to [0, 1]
        if (sumW > 0) {
          for (const { i } of seedDists) _seedWeights[i] /= sumW;
        }
      }

      // Store dominant seed index for UI highlighting
      S._dominantSeedSlot = nearestIdx;
    } else {
      // Radius-gated: no seeds in range → all silent
      S._dominantSeedSlot = -1;
    }
  } else {
    // Collage mode: all active clouds within slot count play at full weight
    for (let i = 0; i < MAX_SEEDS; i++) {
      const slot = S.commitSlots[i];
      _seedWeights[i] = (slot && slot.type === 'cloud' && i < S.commitSlotCount) ? 1 : 0;
    }
    S._dominantSeedSlot = -1;
  }

  for (let i = 0; i < MAX_SEEDS; i++) {
    const seed = S.commitSlots[i];
    if (!seed || seed.type !== 'cloud' || i >= S.commitSlotCount) continue;

    // ── Cloud envelope (fade in / fade out) ─────────────────────────────
    // Always advance the envelope regardless of whether particles exist,
    // so seeds stay visually active (renderer + bank UI read _envGainCurrent).
    // Exponential curves for perceptually even loudness changes:
    //   Attack:  t^3  — slow swell-in, accelerating (like a bowed string)
    //   Release: (1-t)^3 — quick initial drop, long natural tail (like reverb decay)
    const _nowS = performance.now() / 1000;
    let seedEnvGain = 1;
    // Attack ramp: 0→1 over _envAttack seconds from _plantedAt
    if (seed._envAttack > 0 && seed._plantedAt > 0) {
      const elapsed = _nowS - seed._plantedAt;
      if (elapsed < seed._envAttack) {
        const t = elapsed / seed._envAttack;   // linear 0→1
        seedEnvGain = t * t * t;                // exponential curve
      }
    }
    // Release ramp: 1→0 over _envRelease seconds from _releasingAt
    if (seed._releasingAt > 0) {
      const relElapsed = _nowS - seed._releasingAt;
      if (relElapsed >= seed._envRelease) {
        // Release finished — remove the cloud
        S.commitSlots[i] = null;
        if (S.updateSeedBanksUI) S.updateSeedBanksUI();
        continue;
      }
      const rt = 1 - (relElapsed / seed._envRelease);  // linear 1→0
      seedEnvGain *= rt * rt * rt;                       // exponential decay
    }
    // Store envelope gain on seed so renderer + bank UI can visualise it
    seed._envGainCurrent = seedEnvGain;
    // Skip grain scheduling if envelope is silent or no particles to play
    if (seedEnvGain < 0.001 || !S.particles.length) continue;

    // Reusable effective params object — avoids per-grain allocation
    if (!seed._effectiveParams) seed._effectiveParams = {};

    // ── Moving seed: use pre-computed frame from playhead advance ────
    // Playhead was already advanced before weight calculation (above).
    const isMoving = seed.frames !== null && seed.frames !== undefined;
    const frame = isMoving ? seed._currentFrame : null;
    if (isMoving && !frame) continue;

    // Phase 3: skip seeds with negligible weight in nearest mode
    const seedWeight = _seedWeights[i];
    if (seedWeight < 0.001) {
      // Still advance the onset clock so it doesn't burst when weight returns
      if (seed._nextOnsetT !== undefined) {
        const cgpSkip = seed.grainParams;
        const skipPeriod = Math.max(SCHED_SAFE_PERIOD_S, cgpSkip.period);
        const skipUntil = (ensureAudioContext().currentTime) + SCHED_LOOKAHEAD;
        while (seed._nextOnsetT < skipUntil) {
          seed._nextOnsetT += skipPeriod;
        }
      }
      continue;
    }

    // Phase 4: merge seed.grainOverrides (written by gesture/desktop morph)
    // on top of the base params. Overrides with non-null values take precedence.
    // For moving seeds, the base is the interpolated frame's grainParams;
    // for stationary seeds, the base is the planted snapshot.
    let cgp;
    {
      const baseGP = isMoving ? frame.grainParams : seed.grainParams;
      const cgo    = seed.grainOverrides;
      if (cgo && Object.keys(cgo).length > 0) {
        cgp = Object.assign(Object.create(baseGP), cgo);
      } else {
        cgp = baseGP;
      }
    }
    const basePeriodS  = cgp.period;
    const periodVarS   = cgp.periodVar ?? 0;

    // For moving seeds, use frame's modes; for stationary, use seed's snapshot.
    const cNearestMode = isMoving ? frame.nearestMode : seed.nearestMode;
    const cKAllMode    = isMoving ? frame.kAllMode    : seed.kAllMode;
    const cKSeqMode    = isMoving ? frame.kSeqMode    : seed.kSeqMode;
    const cSearchDeg   = isMoving ? frame.searchRadiusDeg : seed.searchRadiusDeg;

    // Initialise seed onset clock on first use — same 5ms forward margin as
    // the cursor init so the first seed grain is never at exactly currentTime.
    if (seed._nextOnsetT === undefined) {
      seed._nextOnsetT = ensureAudioContext().currentTime + 0.005;
    }

    // ── Stamp angular distances on particles ────────────────────────────
    const cParts  = S.particles;
    const cLen    = cParts.length;

    if (isMoving) {
      // Moving seed: recompute position from interpolated frame each tick
      const mCosLat = Math.cos(frame.lat);
      const mRx = mCosLat * Math.sin(frame.lon);
      const mRy = Math.sin(frame.lat);
      const mRz = mCosLat * Math.cos(frame.lon);
      for (let pi = 0; pi < cLen; pi++) {
        const p = cParts[pi];
        if (p._cx === undefined) stampCartesian(p);
        p._ang = _angleFromCached(p, mRx, mRy, mRz);
      }
    } else {
      // Stationary seed: incremental caching — only stamp NEW particles.
      // During recording, particles are appended at ~10/sec.  The old approach
      // recomputed ALL N distances on every version bump, making the cache
      // effectively useless during recording (16 seeds × 500 particles × 50
      // ticks = 400K acos/sec).  Now we only compute distances for particles
      // added since the last stamp and copy the rest from per-particle cache.
      const cAngKey = `_cAng${seed.slotIndex}`;
      if (seed._crx === undefined) {
        const cosLat = Math.cos(seed.lat);
        seed._crx = cosLat * Math.sin(seed.lon);
        seed._cry = Math.sin(seed.lat);
        seed._crz = cosLat * Math.cos(seed.lon);
      }
      // _angBufStampLen tracks how many particles have valid cached distances.
      // Particles beyond this index are new and need stamping.
      const stampedUpTo = (seed._angBufPartVer === S._particleVersion)
        ? cLen  // fully up-to-date — just copy
        : (seed._angBufStampLen ?? 0);
      // Copy cached distances for already-stamped particles
      for (let pi = 0; pi < Math.min(stampedUpTo, cLen); pi++) {
        cParts[pi]._ang = cParts[pi][cAngKey] ?? 0;
      }
      // Stamp only new particles (appended beyond previous stamp length)
      for (let pi = stampedUpTo; pi < cLen; pi++) {
        const p = cParts[pi];
        if (p._cx === undefined) stampCartesian(p);
        const ang = _angleFromCached(p, seed._crx, seed._cry, seed._crz);
        p[cAngKey] = ang;
        p._ang     = ang;
      }
      seed._angBufPartVer  = S._particleVersion;
      seed._angBufStampLen = cLen;
    }

    // Hoist seedRadiusRad so both branches (nearest + radius) can use it for
    // local recency ranking — same fix as cursor path.
    const seedRadiusRad = cSearchDeg * Math.PI / 180;
    let pool;
    if (cNearestMode) {
      // O(N) k-selection instead of O(N log N) sort of the global array.
      // The old code sorted S.particles for EACH seed — 16 seeds × sort(500)
      // = 72,000 comparisons/tick.  k-selection does a single linear pass.
      pool = cKAllMode
        ? _buildCandidatePoolNearest(cParts, cParts.length, true, seedRadiusRad)
        : _buildCandidatePoolNearest(cParts, cgp.k, true, seedRadiusRad);
    } else {
      pool = _buildCandidatePoolRadius(cParts, seedRadiusRad);
      if (!cKAllMode && pool.length > cgp.k) {
        // Radius mode with k cap: use k-selection instead of sort+truncate
        // Stamp _ang is already done above, so _buildCandidatePoolNearest works
        pool = _buildCandidatePoolNearest(pool, cgp.k, false, undefined);
      }
    }

    const seedAudioNow   = ensureAudioContext().currentTime;
    // Same fix as cursor path: use SCHED_LOOKAHEAD (120ms) for budget/window,
    // not minAheadS (≈15ms), so seed grains are scheduled far enough ahead
    // to survive JS timer jitter without rhythmic crackle.
    const seedSchedUntil   = seedAudioNow + SCHED_LOOKAHEAD;
    // Floor period for budget calc only — same OOM guard as cursor path.
    const seedSchedPeriodS = Math.max(SCHED_SAFE_PERIOD_S, basePeriodS);
    const seedGrainsNeeded = Math.ceil(SCHED_LOOKAHEAD / Math.max(seedSchedPeriodS, minGrainPeriodS()));
    const seedNodesBudget  = Math.max(0, MAX_GRAIN_NODES - S._grainSourceCount);
    const seedBudget = Math.min(seedGrainsNeeded, seedNodesBudget, MAX_GRAINS_PER_TICK);

    if (!pool.length) {
      // Still advance the clock even if no particles in range.
      // Floor at SCHED_SAFE_PERIOD_S to match the OOM guard on the firing path.
      while (seed._nextOnsetT < seedSchedUntil) {
        const p = Math.max(SCHED_SAFE_PERIOD_S, basePeriodS + rand(-periodVarS, periodVarS));
        seed._nextOnsetT += p;
      }
      continue;
    }

    // Reset per-seed seq pool each tick (pool is rebuilt fresh each tick)
    if (cKSeqMode) seed._seqPool = null;

    let seedIter = 0;
    while (seed._nextOnsetT < seedSchedUntil && seedIter < seedBudget) {
      if (seed._nextOnsetT < seedAudioNow) {
        seed._nextOnsetT = seedAudioNow + 0.005; // 5ms forward margin (same race-guard as cursor)
      }

      // Select grain: sequential (kSeqMode) or random
      let p;
      if (cKSeqMode && pool.length > 1) {
        // Per-seed sequential state — rebuild sorted pool when candidate set changes
        if (!seed._seqPool || seed._seqPoolLen !== pool.length) {
          seed._seqPool = pool.slice().sort((a, b) => a.grainStart - b.grainStart);
          seed._seqPoolLen = pool.length;
          seed._seqIdx = seed._seqIdx || 0;
          if (seed._seqIdx >= pool.length) seed._seqIdx = 0;
        }
        seed._seqIdx = seed._seqIdx % seed._seqPool.length;
        p = seed._seqPool[seed._seqIdx];
        seed._seqIdx = (seed._seqIdx + 1) % seed._seqPool.length;
      } else {
        p = pool[Math.floor(Math.random() * pool.length)];
      }
      try {
        // Phase 3: scale seed volume by navigation weight.
        // When seedWeight < 1 (nearest-seed mode), attenuate the grain volume.
        // Also apply per-particle radius fade attenuation captured at drop time.
        // Reuse cgp directly when weight is 1 AND no fade to avoid allocation.
        // Moving seeds don't use per-particle fade (position changes each tick)
        const cFadeEnabled = isMoving ? false : seed.radiusFadeEnabled;
        const fadeKey  = cFadeEnabled ? `_cFade${seed.slotIndex}` : null;
        const fadeAtt  = fadeKey ? (p[fadeKey] ?? 1.0) : 1.0;
        const needsCopy = seedWeight < 0.999 || fadeAtt < 0.999 || seedEnvGain < 0.999;
        let effectiveParams;
        if (needsCopy) {
          const ep = seed._effectiveParams;
          // Copy all properties from cgp (shallow, avoids prototype chain)
          const keys = Object.keys(cgp);
          for (let ki = 0; ki < keys.length; ki++) ep[keys[ki]] = cgp[keys[ki]];
          // Also copy prototype properties (from baseGP through Object.create chain)
          // Skip for moving seeds since cgp is already a flat object from the frame.
          if (!isMoving) {
            const baseKeys = Object.keys(seed.grainParams);
            for (let ki = 0; ki < baseKeys.length; ki++) {
              if (!(baseKeys[ki] in ep)) ep[baseKeys[ki]] = seed.grainParams[baseKeys[ki]];
            }
          }
          ep.volume = cgp.volume * seedWeight * fadeAtt * seedEnvGain;
          // Flag per-particle fade so playGrain uses zero-alloc linear envelope
          ep._hasPerParticleFade = fadeAtt < 0.999;
          // Invalidate envelope cache when volume actually changed
          const volKey = seedWeight * 1000 + fadeAtt;  // cheap composite key
          if (ep._lastVolKey !== volKey) {
            ep._cachedAtk = null;
            ep._lastVolKey = volKey;
          }
          effectiveParams = ep;
        } else {
          effectiveParams = cgp;
        }
        playGrain(p, effectiveParams, seed._nextOnsetT);
        activeGrainMap.set(p, { expiry: now + cgp.duration * 1000, glowColor: seed.color });
        perf.grainsFired++;
        if (p.source === 'live') S.liveGranulatingThisFrame = true;
      } catch (_) { /* clock still advances below */ }

      const nextPeriod = Math.max(SCHED_SAFE_PERIOD_S, basePeriodS + rand(-periodVarS, periodVarS));
      seed._nextOnsetT += nextPeriod;
      seedIter++;
    }
  }

  // ── Moving seed recording tick ───────────────────────────────────────────
  // Capture cursor frame if ↓ key is held (recording a moving seed path)
  if (S._seedRecordingFrames || S._shelvedSeed) tickSeedRecording();

  // ── Sequential (loop) playback ──────────────────────────────────────────────────
  // Each sequence uses a single looping AudioBufferSourceNode — no per-grain
  // scheduling, no envelopes, no crossfade.  One continuous buffer read,
  // exactly like a hardware looper.  The scheduler tick only manages the
  // source node lifecycle and updates the visual playhead index.
  for (let si = 0; si < MAX_SEEDS; si++) {
    const seq = S.commitSlots[si];
    if (!seq || seq.type !== 'loop' || !seq.playing || !seq.particles.length) continue;
    // Mute loops beyond active slot count (data preserved, audio paused)
    if (si >= S.commitSlotCount) {
      if (seq._sourceNode && !seq._sourceNode._stopped) {
        try { seq._sourceNode.stop(); } catch (e) {}
        seq._sourceNode._stopped = true;
      }
      continue;
    }

    // Create the looping source node on first tick (or after context recreate)
    if (!seq._sourceNode || seq._sourceNode._stopped) {
      const actx = ensureAudioContext();
      const buffer = seq.buffer;
      if (!buffer) continue;

      // For reverse playback, create a reversed copy of the loop region.
      // Cache it on the seq object so we don't re-reverse every tick.
      let playBuffer = buffer;
      let playLoopStart = seq.loopStart;
      let playLoopEnd   = seq.loopEnd;
      if (seq.direction === -1) {
        if (!seq._revBuffer) {
          const loopLen = seq.loopEnd - seq.loopStart;
          const startSamp = Math.floor(seq.loopStart * buffer.sampleRate);
          const endSamp   = Math.min(buffer.length, Math.ceil(seq.loopEnd * buffer.sampleRate));
          const regionLen = endSamp - startSamp;
          const revBuf = actx.createBuffer(buffer.numberOfChannels, regionLen, buffer.sampleRate);
          for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            const src = buffer.getChannelData(ch);
            const dst = revBuf.getChannelData(ch);
            for (let i = 0; i < regionLen; i++) {
              dst[i] = src[endSamp - 1 - i];
            }
          }
          seq._revBuffer = revBuf;
        }
        playBuffer    = seq._revBuffer;
        playLoopStart = 0;
        playLoopEnd   = playBuffer.duration;
      }

      const src  = actx.createBufferSource();
      const gain = actx.createGain();
      src.buffer       = playBuffer;
      src.loop         = true;
      src.loopStart    = playLoopStart;
      src.loopEnd      = playLoopEnd;
      src.playbackRate.value = Math.abs(seq.speed);
      gain.gain.value  = seq.grainParams.volume ?? 1.0;

      src.connect(gain);

      // ── Spatialize looper — dynamic pan follows playhead ────────────────
      // Create persistent panning nodes that get updated each tick as the
      // playhead moves through particles with different lon/lat positions.
      seq._extraNodes = [];

      if (S.speakerBuses?.length && _vbapLUT) {
        // Multi-channel VBAP: one gain node per speaker, all start at 0.
        // Each tick we zero all and set the two active speakers' weights.
        const spkGains = [];
        for (let si = 0; si < S.speakerBuses.length; si++) {
          const g = actx.createGain();
          g.gain.value = 0;
          gain.connect(g);
          g.connect(S.speakerBuses[si].bus);
          spkGains.push(g);
        }
        seq._vbapGains = spkGains;       // per-speaker gain nodes
        seq._vbapLastIdxA = -1;           // last active pair — skip update if unchanged
        seq._vbapLastIdxB = -1;
        seq._extraNodes = spkGains;
        seq._panner = null;
      } else {
        // Stereo browser path: always create a StereoPanner, update each tick
        const panner = actx.createStereoPanner();
        panner.pan.value = 0;
        gain.connect(panner);
        panner.connect(S.houseBus || getMasterBus());
        seq._panner = panner;
        seq._vbapGains = null;
        seq._extraNodes.push(panner);
      }

      // Set initial pan from the start particle before audio begins.
      // Use direct .value here (before src.start) — no audio is flowing yet
      // so there's no discontinuity risk. This seeds the correct starting
      // position so the first tick's setTargetAtTime ramp starts from it.
      const initP = seq.particles[seq.playheadIndex] || seq.particles[0];
      if (initP) {
        spherePointInto(initP.lon, initP.lat, _grainScratchW);
        const iWx = _grainScratchW[0], iWy = _grainScratchW[1], iWz = _grainScratchW[2];
        let iCx, iCy, iCz;
        if (S.spatialPanning === 'worldlocked') {
          iCx = iWx; iCy = iWy; iCz = iWz;
        } else {
          cameraTransformInto(iWx, iWy, iWz, _grainScratchC);
          iCx = _grainScratchC[0]; iCy = _grainScratchC[1]; iCz = _grainScratchC[2];
        }
        if (seq._vbapGains && _vbapLUT) {
          const iAz = Math.atan2(iCx, iCz);
          const TWO_PI = 2 * Math.PI;
          const iAzDeg = Math.round(((iAz % TWO_PI + TWO_PI) % TWO_PI) * 180 / Math.PI) % 360;
          const iLut = _vbapLUT[iAzDeg];
          if (iLut) {
            const n = S.speakerBuses.length;
            const iElF = Math.abs(iCy) * (1 / SPHERE_RADIUS);
            const iElB = iElF * iElF;
            const iEq  = 1 / Math.sqrt(n);
            seq._vbapGains[iLut.idxA].gain.value = iElB > 0.01 ? iLut.wA + (iEq - iLut.wA) * iElB : iLut.wA;
            seq._vbapGains[iLut.idxB].gain.value = iElB > 0.01 ? iLut.wB + (iEq - iLut.wB) * iElB : iLut.wB;
            seq._vbapLastIdxA = iLut.idxA;
            seq._vbapLastIdxB = iLut.idxB;
          }
        } else if (seq._panner) {
          const iRawPan = Math.abs(iCz) > 1e-6
            ? Math.max(-1, Math.min(1, iCx / Math.abs(iCz))) : 0;
          const iElF2 = S.spatialPanning === 'worldlocked' ? Math.abs(iCy) * (1 / SPHERE_RADIUS) : 0;
          seq._panner.pan.value = iRawPan * (1 - iElF2 * iElF2);
        }
      }

      const startAt = actx.currentTime;
      // Resume from where we left off (startOffset is set on pause,
      // or from initial anchor particle on first creation).
      const offset = seq.startOffset || 0;

      // Fade-in on start to prevent click from silence→signal
      const targetVol = seq.grainParams.volume ?? 1.0;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(targetVol, startAt + 0.035);

      src.start(startAt, playLoopStart + offset);

      seq._sourceNode = src;
      seq._gainNode   = gain;
      seq._startedAt  = startAt - offset;  // adjust so playhead tracking stays correct

      // Clean up ref when source ends (shouldn't normally — it loops)
      src.addEventListener('ended', () => { src._stopped = true; }, { once: true });
    }

    // Update visual playhead — map current buffer position to the nearest
    // particle by comparing grainStart times rather than using a linear fraction.
    // This ensures the playhead tracks accurately even with non-uniform painting.
    const actx = ensureAudioContext();
    const elapsed = (actx.currentTime - seq._startedAt) * Math.abs(seq.speed);
    const loopLen = seq.loopEnd - seq.loopStart;
    if (loopLen > 0 && seq.particles.length > 0) {
      const posInLoop = elapsed % loopLen;           // seconds into loop
      // Absolute buffer time the playhead is at right now
      let bufTime = seq.loopStart + posInLoop;
      if (seq.direction === -1) bufTime = seq.loopEnd - posInLoop;

      // Binary-ish search: find the particle whose grainStart is closest
      let bestIdx = 0, bestDist = Infinity;
      for (let pi = 0; pi < seq.particles.length; pi++) {
        const d = Math.abs(seq.particles[pi].grainStart - bufTime);
        if (d < bestDist) { bestDist = d; bestIdx = pi; }
      }
      seq.playheadIndex = bestIdx;

      // Mark current playhead particle in activeGrainMap with a short expiry
      // so the glow refreshes each scheduler tick (~10ms).
      const p = seq.particles[bestIdx];
      if (p) {
        activeGrainMap.set(p, { expiry: now + 50, glowColor: seq.color });

        // ── Dynamic spatial pan — follow playhead particle position ──────
        // Use setTargetAtTime with a short time constant for smooth
        // interpolation, avoiding click/flutter from step changes.
        spherePointInto(p.lon, p.lat, _grainScratchW);
        const spWx = _grainScratchW[0], spWy = _grainScratchW[1], spWz = _grainScratchW[2];
        let spCx, spCy, spCz;
        if (S.spatialPanning === 'worldlocked') {
          spCx = spWx; spCy = spWy; spCz = spWz;
        } else {
          cameraTransformInto(spWx, spWy, spWz, _grainScratchC);
          spCx = _grainScratchC[0]; spCy = _grainScratchC[1]; spCz = _grainScratchC[2];
        }
        const _panRampTau = 0.015; // ~15ms smoothing time constant
        const _panNow = actx.currentTime;

        if (seq._vbapGains && _vbapLUT) {
          // Multi-channel: update per-speaker VBAP weights with smooth ramps
          const spAz = Math.atan2(spCx, spCz);
          const TWO_PI = 2 * Math.PI;
          const spAzNorm = ((spAz % TWO_PI) + TWO_PI) % TWO_PI;
          const spAzDeg = Math.round(spAzNorm * 180 / Math.PI) % 360;
          const spLut = _vbapLUT[spAzDeg];
          if (spLut) {
            const idxA = spLut.idxA, idxB = spLut.idxB;
            if (idxA !== seq._vbapLastIdxA || idxB !== seq._vbapLastIdxB) {
              // Smoothly fade out old pair
              if (seq._vbapLastIdxA >= 0)
                seq._vbapGains[seq._vbapLastIdxA].gain.setTargetAtTime(0, _panNow, _panRampTau);
              if (seq._vbapLastIdxB >= 0)
                seq._vbapGains[seq._vbapLastIdxB].gain.setTargetAtTime(0, _panNow, _panRampTau);
              seq._vbapLastIdxA = idxA;
              seq._vbapLastIdxB = idxB;
            }
            // Elevation center-bias: collapse toward equal-power at poles
            const spElF = Math.abs(spCy) * (1 / SPHERE_RADIUS);
            const spElB = spElF * spElF;
            const spN   = S.speakerBuses.length;
            const spEq  = 1 / Math.sqrt(spN);
            const spWA  = spElB > 0.01 ? spLut.wA + (spEq - spLut.wA) * spElB : spLut.wA;
            const spWB  = spElB > 0.01 ? spLut.wB + (spEq - spLut.wB) * spElB : spLut.wB;
            seq._vbapGains[idxA].gain.setTargetAtTime(spWA, _panNow, _panRampTau);
            seq._vbapGains[idxB].gain.setTargetAtTime(spWB, _panNow, _panRampTau);
          }
        } else if (seq._panner) {
          // Stereo: smoothly ramp pan position with elevation center-bias
          const spRawPan = Math.abs(spCz) > 1e-6
            ? Math.max(-1, Math.min(1, spCx / Math.abs(spCz))) : 0;
          const spStElF = S.spatialPanning === 'worldlocked' ? Math.abs(spCy) * (1 / SPHERE_RADIUS) : 0;
          const spPan = spRawPan * (1 - spStElF * spStElF);
          seq._panner.pan.setTargetAtTime(spPan, _panNow, _panRampTau);
        }
      }
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
// Always snap the next onset to audioNow + newPeriod so the new spacing takes
// effect immediately — no stale grains, no gap.
//
// History: the original approach nulled the clock, causing a 12-grain burst on
// reinit → OOM during slider dragging.  The second approach only reset when the
// clock was beyond the lookahead horizon, but that missed medium→short period
// changes (e.g. 100ms→10ms) causing 50-100ms silence gaps.
//
// Current approach: unconditionally snap forward to one period ahead.  The
// scheduler sees exactly one grain due on the next tick.  With the tighter 40ms
// lookahead, this gives immediate response without burst risk.
export function resetCursorPeriod() {
  const audioNow = S.audioCtx?.currentTime ?? 0;
  if (_cursorNextOnsetT === null) return;
  const newPeriod = Math.max(SCHED_SAFE_PERIOD_S, S.grainOverrides.period ?? gp().period);
  _cursorNextOnsetT  = audioNow + newPeriod;
  _cursorNextPeriodS = newPeriod;
}

// Register the global onset-clock reset callback so audio.js can invoke it
// when the AudioContext transitions from 'suspended' → 'running'.  Resetting
// here prevents the scheduler from trying to schedule grains at the frozen
// pre-suspension audioNow, which would be in the past by call-time and cause
// setValueCurveAtTime to throw (→ persistent snapping / "stuck on triangle").
S._resetOnsetClocks = () => {
  _cursorNextOnsetT  = null;
  _cursorNextPeriodS = null;
  // Also reset seed onset clocks so they reinitialise cleanly from resumed time
  if (S.seedSlots) {
    for (let i = 0; i < S.seedSlots.length; i++) {
      const seed = S.seedSlots[i];
      if (seed) delete seed._nextOnsetT;
    }
  }
};
