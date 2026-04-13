import { S, MAX_SEEDS, GRAIN_SCHEDULER_INTERVAL_MS, SPHERE_RADIUS, perf, gp } from './state.js';
import { ensureAudioContext, getMasterBus } from './audio.js';
import { getCursorLonLat, screenToLonLat, cameraTransformInto, spherePointInto, updateFusedCamQ } from './sphere.js';
import { tickSeedRecording } from './ui-presets.js';
import { dlog } from './diag.js';

// ── Pre-computed VBAP lookup table ──────────────────────────────────────────
// Built once at initSpeakerBuses time. Maps integer degrees [0, 359] to
// { idxA, idxB, wA, wB } — the two bracketing speakers and their gains.
// Worklet and sequential playback use this for O(1) VBAP speaker resolution.
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

// Query the pre-computed VBAP lookup table for a given azimuth in degrees.
// Returns { idxA, idxB, wA, wB } or null if the table isn't built yet.
export function queryVBAPLookup(azDeg) {
  return _vbapLUT?.[Math.round(azDeg) % 360] ?? null;
}

// Pack the VBAP lookup table into a flat Float32Array for the worklet.
// 360 entries × 4 floats = 1440 values: [idxA, idxB, wA, wB] per degree.
// Returns null if the LUT isn't built yet.
export function packVBAPLookup() {
  if (!_vbapLUT) return null;
  const data = new Float32Array(1440);
  for (let deg = 0; deg < 360; deg++) {
    const e = _vbapLUT[deg];
    const base = deg * 4;
    data[base]     = e.idxA;
    data[base + 1] = e.idxB;
    data[base + 2] = e.wA;
    data[base + 3] = e.wB;
  }
  return data;
}

export function rand(min, max) { return min + Math.random() * (max - min); }

// activeGrainMap: particle → { expiry, glowColor } — shared with renderer
export let activeGrainMap = new Map();

/** Stop all in-flight grain source nodes immediately (erase-all, undo).
 *  Legacy: with the worklet grain engine, main-thread source nodes are only
 *  created for sequential/loop playback. Kept for callers that expect it. */
export function killAllGrains() {
  S._grainSourceCount = 0;
}

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

// ── Muted-scan visual glow accumulator ──────────────────────────────────────
// Simulates grain onset timing for visual feedback when scan is muted.
let _mutedGlowAccum  = 0;   // ms since last simulated onset
let _mutedGlowSeqIdx = 0;   // k-seq index into candidate pool

// ── DOM update throttling for scheduleGrains() ─────────────────────────────
// Avoid invalidating caches by throttling grain count display to ~4Hz
let _gcEl = null;
let _vmGrainsEl = null;
let _domUpdateCounter = 0;

// ── Zero-allocation scratch buffers for spatial math ─────────────────────
// Used by sequential/loop panning updates. Updated in-place; never leaked.
const _grainScratchW = [0, 0, 0];   // world-space particle position
const _grainScratchC = [0, 0, 0];   // camera-space panning position

// ── Seed focus-mode weight buffer ────────────────────────────────────────
// Allocated once; .fill(0) each scheduler tick instead of `new Float32Array`
// every 10ms (was 100 allocs/sec → needless GC pressure).
const _seedWeights = new Float32Array(MAX_SEEDS);


function getBufferKey(p) {
  return p.source === 'live' ? `live:${p.liveBufferIdx}` : `sample:${p.sampleIndex}`;
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


let _schedLastAt = 0;
let _schedTickCount = 0;  // for periodic dlog snapshot

// ── Scheduler overview ──────────────────────────────────────────────────────
// The grain scheduler runs at ~33Hz (GRAIN_SCHEDULER_INTERVAL_MS) on the main
// thread.  It performs spatial search (cursor + seed candidate pools) and posts
// candidate lists to the AudioWorklet grain engine via postMessage.  The worklet
// handles all grain synthesis at sample rate.
//
// Seed onset clocks (seed._nextOnsetT) are still maintained here so seed data
// posting stays in sync and doesn't burst when weights change.
//
// SCHED_LOOKAHEAD: how far ahead seed onset clocks advance per tick.
const SCHED_LOOKAHEAD = 0.040;   // 40ms

// ── Moving seed helpers ────────────────────────────────────────────────────
// Interpolate a moving seed's frame data at its current playhead position.
// Interpolate a moving seed's current frame.  Reuses seed._currentFrame
// when available to avoid allocating a 12-property object every 20ms tick
// per moving seed (at 16 seeds × 50 ticks/sec = 800 objects/sec of GC
// pressure).  When the effective time lands exactly on a keyframe,
// returns that keyframe directly (no allocation either way).
export function _interpolateMovingSeed(seed) {
  const { frames, duration, loopMode, _playheadMs } = seed;
  if (!frames.length) return null;
  let effectiveT;
  if (loopMode === 'pingpong') {
    const cycle = duration * 2;
    const pos = _playheadMs % cycle;
    effectiveT = pos <= duration ? pos : cycle - pos;
  } else if (loopMode === 'rev') {
    const pos = _playheadMs % duration;
    effectiveT = duration - pos;
  } else {
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
  // Wrap-aware longitude interpolation
  let dLon = b.lon - a.lon;
  if (dLon > Math.PI) dLon -= 2 * Math.PI;
  else if (dLon < -Math.PI) dLon += 2 * Math.PI;
  let lon = a.lon + dLon * frac;
  if (lon > Math.PI) lon -= 2 * Math.PI;
  else if (lon < -Math.PI) lon += 2 * Math.PI;
  // Reuse existing _currentFrame object to avoid per-tick allocation
  const out = seed._currentFrame || {};
  out.lon               = lon;
  out.lat               = a.lat + (b.lat - a.lat) * frac;
  out.grainParams       = frac < 0.5 ? a.grainParams : b.grainParams;
  out.searchRadiusDeg   = a.searchRadiusDeg + (b.searchRadiusDeg - a.searchRadiusDeg) * frac;
  out.nearestMode       = frac < 0.5 ? a.nearestMode : b.nearestMode;
  out.kAllMode          = frac < 0.5 ? a.kAllMode : b.kAllMode;
  out.kSeqMode          = frac < 0.5 ? a.kSeqMode : b.kSeqMode;
  out.grainDirection    = frac < 0.5 ? a.grainDirection : b.grainDirection;
  out.grainCurveType    = frac < 0.5 ? a.grainCurveType : b.grainCurveType;
  out.grainProbability  = a.grainProbability + (b.grainProbability - a.grainProbability) * frac;
  out.radiusFadeEnabled = frac < 0.5 ? a.radiusFadeEnabled : b.radiusFadeEnabled;
  out.radiusFadeCurve   = a.radiusFadeCurve + (b.radiusFadeCurve - a.radiusFadeCurve) * frac;
  return out;
}

// Advance a moving seed's playhead.
function _advanceMovingSeed(seed, deltaMs) {
  seed._playheadMs += deltaMs;
}

export function scheduleGrains() {
  // Refresh the fused camera quaternion so headlocked panning in the worklet
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
  // Periodic state snapshot (~1/sec) so the event log always has recent context
  if (++_schedTickCount % 50 === 0) {
    dlog('sched', 'tick', { nodes: S._grainSourceCount, drift: perf.schedulerDrift.toFixed(1), particles: S.particles?.length, rec: S.isRecording, ctxState: S.audioCtx?.state });
  }

  const actx = ensureAudioContext();
  // Don't attempt to schedule while the context is suspended or still resuming.
  if (actx.state !== 'running') {
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return;
  }
  const audioNow = actx.currentTime;

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
  perf.seedsPosted = 0;

  if (S.particles.length && !(S.seqModeEnabled && S.isPainting)) {

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
        particles[pi]._globalIdx = pi;
      }
      // Stamp new / invalidated particles
      for (let pi = stampFrom; pi < pLen; pi++) {
        const p = particles[pi];
        if (p._cx === undefined) stampCartesian(p);
        const ang = _angleFromCached(p, crx, cry, crz);
        p._cursorAng = ang;
        p._ang       = ang;
        p._globalIdx = pi;
      }
      _cursorAngCacheLon     = cursorLon;
      _cursorAngCacheLat     = cursorLat;
      _cursorAngCachePartVer = S._particleVersion;
      _cursorAngStampLen     = pLen;
    } else {
      // Restore from per-particle cache — correct regardless of sort order.
      for (let pi = 0; pi < pLen; pi++) {
        particles[pi]._ang = particles[pi]._cursorAng ?? 0;
        particles[pi]._globalIdx = pi;
      }
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
    // Pre-select k candidates for radius mode with k cap — cursor position and
    // candidate pool don't change between onsets within a single tick, so the
    // k-selection result is identical for all onsets.  Previously this O(N)
    // heap-select ran inside the while loop (up to 12× per tick), burning
    // ~6000 comparisons/tick at 500 particles.
    const _preSelectedPool = (!S.nearestMode && !effectiveKAll && candidatePool.length > k)
      ? _buildCandidatePoolNearest(candidatePool, k, false, undefined)
      : null;

    // ── Post candidates to worklet grain engine ─────────────────────────
    // S._postWorkletCandidates is set by the bridge when the worklet is running.
    // Called once per tick (~50Hz) with a compact candidate list.
    // The worklet handles all grain synthesis.
    // When scan is muted, send an empty list so the worklet stops firing
    // cursor grains (zeroing the output gain node alone leaves the worklet
    // synthesising inaudible grains, wasting CPU and pool slots).
    //
    // Flush the live buffer first so the worklet has the freshest audio data
    // before it receives new candidate offsets. Without this, frontier particles
    // (deposited in the last 10-50ms) would reference offsets the worklet hasn't
    // received yet, causing dropped grains and choppy sound during recording.
    if (S.isRecording) S._flushLiveBuffer?.();
    if (S._postWorkletCandidates) {
      const pool = _preSelectedPool || candidatePool;
      if (S.scanMuted) {
        S._postWorkletCandidates([], cursorLon, cursorLat);
        // Visual-only glow: simulate grain onsets from the candidate pool
        // so the renderer shows muted-scan particles in faint grey.
        // Uses an onset accumulator driven by the real grain period so
        // the firing density, probability gate, and k-seq selection all
        // match what the worklet would do.
        if (pool.length > 0) {
          const ov = S.grainOverrides;
          const base = gp();
          const periodMs = (ov.period ?? base.period ?? 0.050) * 1000;
          const durMs    = (ov.duration ?? base.duration ?? 0.100) * 1000;
          const prob     = S.grainProbability ?? 1.0;
          const kSeq     = S.grainKSeqMode ?? false;
          _mutedGlowAccum += GRAIN_SCHEDULER_INTERVAL_MS;
          while (_mutedGlowAccum >= periodMs) {
            _mutedGlowAccum -= periodMs;
            if (prob < 1.0 && Math.random() > prob) continue;
            let p;
            if (kSeq) {
              _mutedGlowSeqIdx = _mutedGlowSeqIdx % pool.length;
              p = pool[_mutedGlowSeqIdx++];
            } else {
              p = pool[(Math.random() * pool.length) | 0];
            }
            activeGrainMap.set(p, { expiry: now + durMs, glowColor: '#ffffff' });
          }
        }
      } else {
        _mutedGlowAccum = 0;
        _mutedGlowSeqIdx = 0;
        S._postWorkletCandidates(pool, cursorLon, cursorLat);
      }
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

  // Collect active seed data for worklet posting
  const _workletSeedData = [];

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
        const skipPeriod = Math.max(S.minPeriodS, cgpSkip.period);
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

    // Advance onset clock horizon — keep it roughly current for smooth
    // transition if the seed's weight changes (avoids burst on re-entry).
    const seedSchedUntil = audioNow + SCHED_LOOKAHEAD;

    if (!pool.length) {
      // Still advance the clock even if no particles in range.
      // Floor at S.minPeriodS to match the OOM guard on the firing path.
      while (seed._nextOnsetT < seedSchedUntil) {
        const p = Math.max(S.minPeriodS, basePeriodS + rand(-periodVarS, periodVarS));
        seed._nextOnsetT += p;
      }
      continue;
    }

    // ── Collect seed data for worklet ────────────────────────────────────
    // Worklet handles all grain synthesis; main thread just posts candidates.
    // pool.slice() — _buildCandidatePoolRadius / _buildCandidatePoolNearest
    // return a shared module-level _candidateBuf.  Without cloning, the next
    // seed's iteration overwrites this seed's pool before _postWorkletSeeds
    // can iterate it (all seeds would share the last seed's particles).
    _workletSeedData.push({
      slotIndex: i,
      pool: pool.slice(),
      gain: _seedWeights[i] * seedEnvGain,
      grainParams: cgp,
      kSeqMode: cKSeqMode,
    });
    // Advance the onset clock so it stays current
    while (seed._nextOnsetT < seedSchedUntil) {
      const p = Math.max(S.minPeriodS, basePeriodS + rand(-periodVarS, periodVarS));
      seed._nextOnsetT += p;
    }
    perf.seedsPosted++;   // count for diagnostics
    if (pool.some(p => p.source === 'live')) S.liveGranulatingThisFrame = true;
  }

  // ── Post collected seed data to worklet ─────────────────────────────────
  // Always post — even an empty list must reach the worklet so it deactivates
  // all seeds (line 251 of grain-engine.worklet.js).  Without this, removing
  // the last cloud leaves a stale seed.active=true in the worklet that keeps
  // firing grains from old candidates indefinitely.
  if (S._postWorkletSeeds) {
    S._postWorkletSeeds(_workletSeedData);
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

    // Create the looping source node on first tick (or after context recreate).
    // Also recreate if the AudioContext changed (sample rate switch) — the old
    // source node belongs to the previous context and is unusable.
    const needsNewSource = !seq._sourceNode
      || seq._sourceNode._stopped
      || (seq._sourceCtx && seq._sourceCtx !== S.audioCtx);
    if (needsNewSource) {
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
            // Spread to all speakers at elevation — not just the bracketing pair
            for (let si = 0; si < n; si++) {
              if (si === iLut.idxA)       seq._vbapGains[si].gain.value = iElB > 0.01 ? iLut.wA + (iEq - iLut.wA) * iElB : iLut.wA;
              else if (si === iLut.idxB)  seq._vbapGains[si].gain.value = iElB > 0.01 ? iLut.wB + (iEq - iLut.wB) * iElB : iLut.wB;
              else                        seq._vbapGains[si].gain.value = iElB > 0.01 ? iEq * iElB : 0;
            }
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
      seq._sourceCtx  = actx;  // track which context owns this node
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
            // Elevation center-bias: spread to all speakers at poles
            const spElF = Math.abs(spCy) * (1 / SPHERE_RADIUS);
            const spElB = spElF * spElF;
            const spN   = S.speakerBuses.length;
            const spEq  = 1 / Math.sqrt(spN);
            const spWA  = spElB > 0.01 ? spLut.wA + (spEq - spLut.wA) * spElB : spLut.wA;
            const spWB  = spElB > 0.01 ? spLut.wB + (spEq - spLut.wB) * spElB : spLut.wB;
            const spSpread = spElB > 0.01 ? spEq * spElB : 0;
            // Update all speakers — bracketing pair + spread to others
            for (let si = 0; si < spN; si++) {
              let target;
              if (si === idxA)       target = spWA;
              else if (si === idxB)  target = spWB;
              else                   target = spSpread;
              seq._vbapGains[si].gain.setTargetAtTime(target, _panNow, _panRampTau);
            }
            seq._vbapLastIdxA = idxA;
            seq._vbapLastIdxB = idxB;
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
  // No-op: cursor onset timing is handled by the AudioWorklet.
  // Kept as an export so callers (ui-presets.js) don't break.
}

// Reset onset clocks when AudioContext transitions from 'suspended' → 'running'.
// Cursor onset timing is handled by the worklet; only seed onset clocks need reset.
S._resetOnsetClocks = () => {
  if (S.seedSlots) {
    for (let i = 0; i < S.seedSlots.length; i++) {
      const seed = S.seedSlots[i];
      if (seed) delete seed._nextOnsetT;
    }
  }
};
