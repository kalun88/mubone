import { S, MAX_SEEDS, GRAIN_SCHEDULER_INTERVAL_MS, SPHERE_RADIUS, perf, gp } from './state.js';
import { ensureAudioContext, getMasterBus } from './audio.js';
import { cursorLonLatNow, cameraRotateInto, spherePointInto, updateFusedCamQ } from './sphere.js';
import { tickSeedRecording } from './ui-presets.js';
import { dlog } from './diag.js';
import { pinAnchorInto, isPinLeaving } from './pins.js';
import { isCommitOn } from './composer.js';
import { voicingById } from './brush-voicing.js';
import { pitchRatio, stretchedRegion } from './tape-pitch.js';
import { tickWalkers } from './walker.js';
const _anchor = [0, 0];   // scratch for pinAnchorInto on the tick

// A PIN'S FADER IS ITS OWN NUMBER (Ek, 2026-09-16): `level`, 1 at pin time,
// the rail's track writes it. The block's `volume` — the tape tool's or the
// brush's slider, copied in when the pin was made — rides underneath as a
// second stage, so a fresh pin sounds exactly as the cursor did and its
// track reads 0 dB. Before this the track wrote `grainParams.volume`, and a
// grain tool at 0.85 pinned a cloud whose fader read −1.4 dB. Every loop
// gain write goes through here; a cloud's fader rides its seed gain.
const _loopGain = seq => (seq.grainParams?.volume ?? 1) * (seq.level ?? 1);

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

// Declick ramp for buffer playback (loops and triggers alike) — long enough to
// kill a click when playback starts mid-waveform, short enough to leave a
// transient alone. See the fade-in comment in the seq block for why this is 3 ms
// rather than the 35 ms it used to be.
const DECLICK_S = 0.003;
// The END of a one-shot (Ek, 2026-09-04: "a click artifact at the end of
// each segment … not the top"). A trigger plays the raw take region — no
// seam crossfade is baked into it, unlike a loop's buffer — and stopped at
// its scheduled duration with no ramp, so the cut clicked in proportion to
// the sample value it landed on: seldom on a plain line (the end is where
// you stopped playing), often on a slice (the end is a computed point near
// the next hit). 5 ms of gain to zero, in wall time, before the source
// runs out. Short enough to leave a hit's tail alone.
const ONESHOT_FADE_S = 0.005;

export function rand(min, max) { return min + Math.random() * (max - min); }

// activeGrainMap: particle → { expiry, glowColor, ghost } — shared with renderer
//
// `ghost` is a mark that is LIT BUT NOT SOUNDING: the muted-scan simulation
// below draws what the cursor would be reading with the cap on. It has to be
// its own bit rather than a mood the renderer infers from `S.scanMuted`,
// because a PINNED CLOUD goes on sounding with the lens off — and the renderer,
// asking the cap instead of the mark, dimmed the cloud's live marks along with
// the simulation (Ek, 2026-09-15: "the pinned clouds still are audible as i
// expect but they are greyed out in the viz").
export let activeGrainMap = new Map();

// ── The glow map's FLOOR (Ek, 2026-09-06) ──────────────────────────────────
// An entry lived exactly its grain's duration, so a 5 ms grain on a 5 ms
// period was on the map for a sixth of a frame: each frame caught a random
// handful and the glow flickered. Below GLOW_MIN_MS the eye cannot see a
// grain anyway, so the entry lives that long instead. Above it the entry
// lives the grain — how long a mark stays lit is the ONLY thing about the
// glow that varies, and it is the honest one. Everything else about the mark
// is a constant now (Ek, 2026-09-07: "i don't want different core or alphas,
// i want the same"); renderer.js, the glow pass, has that reasoning. A hit on
// a live entry updates it in place — the old set() allocated per grain.
export const GLOW_MIN_MS = 80;
export function markGlow(p, durMs, glowColor = '#ffffff', now = performance.now(), ghost = false) {
  const life = Math.max(durMs, GLOW_MIN_MS);
  const e = activeGrainMap.get(p);
  // The LATEST event decides, on a refresh as on a fresh entry — a mark that
  // sounded a moment ago and is now only being previewed is being previewed.
  // The two cannot collide on one mark anyway: a pinned cloud CLAIMS its
  // material and the cursor's pool skips it (_refreshCloudClaims), and the
  // preview is drawn from that same pool.
  if (e && e.glowColor === glowColor) { e.expiry = now + life; e.ghost = ghost; }
  else activeGrainMap.set(p, { expiry: now + life, glowColor, ghost });
}

/** Disconnect and release a loop (seq) playback subgraph — source, gain, and
 *  the per-speaker VBAP fan-out / stereo panner. Idempotent and safe on
 *  partially-built slots.
 *  (Perf audit M2, Jul 2026.) Mute/unmute cycles and erase-all previously
 *  only called `.stop()` on the source — the N-per-speaker GainNodes stayed
 *  connected to the buses until GC decided the island was dead. At 8 channels
 *  that's 8 orphaned gains per loop cycle; at the 42-channel Dartmouth layout
 *  (#39) it's 42, and repeated cycles are a plausible contributor to crash
 *  #7. Explicit disconnect makes teardown deterministic. */
export function releaseSeqNodes(seq) {
  if (!seq) return;
  stopOverdubLayers(seq);
  if (seq._sourceNode) {
    if (!seq._sourceNode._stopped) {
      try { seq._sourceNode.stop(); } catch (_) {}
      seq._sourceNode._stopped = true;
    }
    try { seq._sourceNode.disconnect(); } catch (_) {}
    seq._sourceNode = null;
  }
  if (seq._gainNode) {
    try { seq._gainNode.disconnect(); } catch (_) {}
    seq._gainNode = null;
  }
  if (seq._ownGain) {
    try { seq._ownGain.disconnect(); } catch (_) {}
    seq._ownGain = null;
  }
  if (seq._muteGain) {
    try { seq._muteGain.disconnect(); } catch (_) {}
    seq._muteGain = null;
  }
  if (seq._extraNodes) {
    for (const n of seq._extraNodes) { try { n.disconnect(); } catch (_) {} }
    seq._extraNodes = null;
  }
  seq._vbapGains = null;
  seq._panner = null;
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
const _seedDist    = new Float32Array(MAX_SEEDS);   // scratch for the pass: −1 = not a candidate
// The cursor draws the pin mix, so the weights have to leave this module. Same
// buffer, published once — no copy per frame, and the renderer sees exactly
// what the scheduler is about to send to the worklet rather than a re-derivation
// that could disagree with it. This is also the seam the pin-crossfade lens
// will read (Ek, 2026-08-29).
S._pinWeights = _seedWeights;


/** What DEPTH counts: the stroke (Ek, 2026-09-23: "depth should actually
 *  count strokes — same as erase strokes"). It counted the BUFFER a mark inked
 *  from, which agreed for live takes (one take, one buffer) and not for the
 *  sampler, where every stroke inks from one file — so `last 1 stroke` kept all
 *  of them. The cursor and the eraser both read this; the readout says strokes. */
export function depthKey(p) { return p.strokeId ?? 0; }

// Reusable candidate output buffer — avoids allocating a new array every tick.
let _candidateBuf = [];

// ── Pre-allocated recency filter structures ─────────────────────────────────
// Reused across all _buildCandidatePool / _buildCandidatePoolRadius calls to
// avoid creating new Map, Set, and sort-intermediate arrays on every tick.
// At 4 seeds × 100 ticks/sec this eliminates ~400 Map+Set allocations/sec.
const _recBufRec  = new Map();   // depthKey (the stroke) → its strokeId, the recency rank
const _recAllowed = new Set();   // the strokes depth lets through
const _recSortBuf = [];          // reusable array for sorting entries by strokeId

// Shared helper: build the _recAllowed set from _recBufRec.
// Picks the recencyN most-recent strokes (depthKey).
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
      const key = depthKey(p);
      if ((_recBufRec.get(key) ?? -Infinity) < p.strokeId) _recBufRec.set(key, p.strokeId);
    }
    useAllowed = _buildAllowedFromBufRec();
  }
  _candidateBuf.length = 0;
  for (let i = 0; i < sortedParticles.length && _candidateBuf.length < k; i++) {
    const p = sortedParticles[i];
    if (useAllowed && !_recAllowed.has(depthKey(p))) continue;
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

// ── A pinned cloud OWNS its material (Ek, 2026-08-30) ───────────────────────
// "When I pin a cloud I shouldn't hear double — that exact cloud, or the
// particles, are unavailable for cursor-granulation until I unpin them."
//
// A cloud is a PLACE that re-reads the live particle pool every tick, so what
// it claims is whatever is inside its radius right now — the same set
// composer.js's syncParticleMarks() uses for the sphere-side grey, computed the
// same way. While a cloud claims a particle, the cursor does not granulate it,
// and the cloud is the only thing playing it.
//
// The claim is by PINNING, not by sounding. Mute a cloud and its material stays
// the cloud's: it goes quiet rather than jumping back into the cursor, which is
// what "until I unpin them" asks for and the only version that does not make a
// group mute change the mix in two directions at once.
//
// **This is the CURSOR's rule and only the cursor's.** The cloud itself reads
// through the same `_buildCandidatePoolRadius`, on its own particles, so a claim
// applied blindly there makes every pinned cloud skip exactly the material it
// exists to play — it plays nothing at all. That is not a hypothetical: it is
// what shipped for one revision on 2026-08-30, and it is why the builder takes
// an explicit `forCursor` rather than reading the claim table unconditionally.
// pins-audit § J asserts the cloud still sounds, not just that the cursor stops.
//
// Loops need nothing here. A loop's stroke is TRIGGER material — the `line`
// brush records it as `p.trig` — and every builder below already skips trig,
// which is why pinned loops behaved this way from the start.
//
// Rebuilt once per scheduler tick, never per particle: the position is the
// cloud's CURRENT one (a moving cloud's `_currentFrame`), so the claim travels
// with a drawn cloud. `cosR` instead of an angle keeps the test a dot product —
// the same trick the greying pass uses, and it has to be, because this runs
// over every particle inside the 10 ms tick.
const _cloudClaims = [];
let   _cloudClaimN = 0;

function _refreshCloudClaims() {
  _cloudClaimN = 0;
  const slots = S.commitSlots;
  if (!slots) return;
  const lim = Math.min(slots.length, S.commitSlotCount ?? slots.length);
  for (let i = 0; i < lim; i++) {
    const c = slots[i];
    if (!c || c.type !== 'cloud') continue;
    const f = c._currentFrame;
    const lon = f ? f.lon : c.lon, lat = f ? f.lat : c.lat;
    if (lon == null || lat == null) continue;
    const degs = (f ? f.searchRadiusDeg : c.searchRadiusDeg) ?? S.searchRadiusDeg ?? 10;
    const cl = Math.cos(lat);
    let e = _cloudClaims[_cloudClaimN];
    if (!e) e = _cloudClaims[_cloudClaimN] = { x: 0, y: 0, z: 0, cosR: 0 };
    e.x = cl * Math.sin(lon);
    e.y = Math.sin(lat);
    e.z = cl * Math.cos(lon);
    e.cosR = Math.cos(degs * Math.PI / 180);
    _cloudClaimN++;
  }
}

/** Is this particle inside a pinned cloud? Hoist `_cloudClaimN` at the call
 *  site so the common case (no cloud pinned) costs one integer test. */
function _claimedByCloud(p) {
  if (p._cx === undefined) stampCartesian(p);
  for (let i = 0; i < _cloudClaimN; i++) {
    const c = _cloudClaims[i];
    if (p._cx * c.x + p._cy * c.y + p._cz * c.z >= c.cosR) return true;
  }
  return false;
}

/**
 * The claim, for the RENDERER. A reach line asserts "the cursor reaches this
 * NOW", so a particle a pinned cloud owns must not draw one — the cursor is
 * provably not granulating it. The renderer cannot infer this from the glow
 * map: the worklet's feedback tags every firing grain white, cloud grains
 * included (grain-worklet-bridge.js), so "white" means *sounding*, not *the
 * cursor's*. The dot+ring is still right to draw — the grain really is
 * sounding — it is only the line back to the reticle that would be a lie.
 *
 * Call refreshCloudClaims() once per frame before the loop; it is a walk of
 * ≤16 slots and idempotent, so the render loop and the 10 ms scheduler can both
 * drive it without coordinating.
 */
export function refreshCloudClaims() { _refreshCloudClaims(); }
export function isCloudClaimed(p) { return _cloudClaimN > 0 && _claimedByCloud(p); }

/** Test seam for scripts/pins-audit.js § J — the scheduler is the only other
 *  caller, and it refreshes on its own tick. Not used by the app. */
export function __testCloudClaims() {
  _refreshCloudClaims();
  return { n: _cloudClaimN, claimed: S.particles.filter(p => _claimedByCloud(p)).length };
}

/**
 * What a CLOUD would granulate, through the builders the seed block really
 * uses. The counterpart of __testCandidatePool, and the reason it exists: the
 * cursor's exclusion is applied inside a builder the cloud shares, so a test
 * that only reads the cursor's pool passes while every pinned cloud plays
 * silence. Assert both sides or neither. Not used by the app.
 */
export function __testSeedPool(slotIndex = 0) {
  const seed = S.commitSlots?.[slotIndex];
  if (!seed || seed.type !== 'cloud') return null;
  _refreshCloudClaims();                       // as the scheduler's tick would
  const f = seed._currentFrame;
  const lon = f ? f.lon : seed.lon, lat = f ? f.lat : seed.lat;
  const degs = (f ? f.searchRadiusDeg : seed.searchRadiusDeg) ?? S.searchRadiusDeg ?? 10;
  const cosLat = Math.cos(lat);
  const rx = cosLat * Math.sin(lon), ry = Math.sin(lat), rz = cosLat * Math.cos(lon);
  for (const p of S.particles) {
    if (p._cx === undefined) stampCartesian(p);
    p._ang = _angleFromCached(p, rx, ry, rz);
  }
  const rad = degs * Math.PI / 180;
  const pool = seed.nearestMode
    ? _buildCandidatePoolNearest(S.particles, S.particles.length, true, rad)
    : _buildCandidatePoolRadius(S.particles, rad);   // NO forCursor — the seed path
  return pool.slice();
}

function _buildCandidatePoolNearest(particles, k, applyRecency, radiusRad) {
  // Phase 0: build recency allow-set from in-radius particles (same as before)
  let useAllowed = false;
  if (applyRecency && S.recencyN > 0) {
    _recBufRec.clear();
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      // Tape material never — not even a take dwell opened: this builder feeds
      // pinned clouds and walkers, never the cursor, and a cloud is grain
      // material (2026-09-23; the take's pin is its loop).
      if (p.trig) continue;
      if (radiusRad !== undefined && p._ang >= radiusRad) continue;
      const key = depthKey(p);
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
    // Tape material never — see phase 0. (The cursor's nearest read, which
    // does let an opened take through, is _selectPerVoicing.)
    if (p.trig) continue;
    if (useAllowed && !_recAllowed.has(depthKey(p))) continue;
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

// ── Cursor candidate selection ──────────────────────────────────────────────
// k, fill and order belong to the LENS now (#233 — Ek, 2026-08-27, reversing
// #212's k half): flow made density a painted, visible property of the
// material, so "how many marks the cursor READS at once" is a lens question,
// like radius and depth. One live k for the whole pool — the per-voicing
// selection machinery collapsed back to a single keep-k-smallest pass.
// Voicings still freeze the SOUND (period, duration, pitch, filters …); they
// no longer carry selection. Aperture is deleted with it: it existed only to
// give the lens a density control without touching frozen k, and with k on
// the lens it had no job left.
const _voSelBuf = [];            // the survivors — reused, no per-tick alloc

/**
 * @param {Array}  pool          particles with `_ang` already stamped
 * @param {number} k             the lens's k — live global
 * @param {boolean} trigFilter   nearest mode admits a trig particle only under
 *                               dwell:'grain' AND inside the radius — with no
 *                               radius to bound it, a trigger stroke would
 *                               otherwise granulate whenever it was closest.
 */
let _voEligible = 0;
function _selectPerVoicing(pool, k, trigFilter) {
  const trigRad = trigFilter ? S.searchRadiusDeg * Math.PI / 180 : 0;
  // `trigFilter` IS "reading nearest": `all` is a radius answer, off there.
  const all = S.grainKAllMode && !trigFilter;
  // Nearest mode hands the WHOLE sphere to this pass, so the pinned-cloud skip
  // has to happen here too — _buildCandidatePoolRadius never sees those
  // particles. In radius mode the pool arrives already filtered and this costs
  // one integer test per candidate. No `forCursor` flag needed: unlike the
  // radius builder, this pass has exactly one caller and it is the cursor.
  const pinned = _cloudClaimN > 0;

  _voSelBuf.length = 0;
  _voEligible = 0;
  let maxAng = 0, maxIdx = 0;
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i];
    // A take's material reads only once dwell has OPENED it — played through
    // with the cursor still on it — and, nearest having no radius, only inside
    // the radius. (Was `dwell === 'grain'` alone: nearest granulated a take the
    // moment the cursor arrived, over its own first pass.)
    if (trigFilter && p.trig && (!_isOpen(p) || p._ang >= trigRad)) continue;
    if (pinned && _claimedByCloud(p)) continue;
    _voEligible++;

    // fill:'all' means no cap — take everything the geometry gave us.
    if (all || _voSelBuf.length < k) {
      _voSelBuf.push(p);
      if (!all && (p._ang > maxAng || _voSelBuf.length === 1)) {
        maxAng = p._ang; maxIdx = _voSelBuf.length - 1;
      }
    } else if (p._ang < maxAng) {
      _voSelBuf[maxIdx] = p;
      // Rescan for the new max. k is small, so this stays cheaper than a heap.
      maxAng = 0; maxIdx = 0;
      for (let j = 0; j < _voSelBuf.length; j++) {
        if (_voSelBuf[j]._ang > maxAng) { maxAng = _voSelBuf[j]._ang; maxIdx = j; }
      }
    }
  }
  return _voSelBuf;
}

// Build candidate pool for radius mode: filter by _ang < radiusRad.
// Recency is ranked from the in-radius particles only (local universe),
// so buffers recorded elsewhere do not affect which local buffers are audible.
function _buildCandidatePoolRadius(particles, radiusRad, forCursor = false, onlyOpen = false) {
  // Phase 1: build per-stroke recency from ONLY in-radius particles.
  // `p.trig` particles are normally excluded everywhere in this function: a
  // trigger-type buffer is not granular material. The performer chose which it
  // was before pressing record, and it does that one thing whenever the cursor
  // touches it. They're skipped in the recency pass too, not just the
  // collection pass, or a trigger stroke could push a granular buffer out of
  // the top-N and silence material that IS granulatable.
  //
  // The one exception is an OPENED stroke (state.js `_openStrokes`): under
  // `dwell: 'grain'` a take that has PLAYED THROUGH opens into a cloud, and
  // stays open until the cursor leaves it. This used to be the bare flag
  // `dwell === 'grain'`, which opened on arrival — so the grains were heard
  // over the take's own first pass rather than after it (Ek, 2026-09-18). The
  // set is empty in every other case, so the hot loop costs one `.size` read.
  //
  // A particle inside a pinned cloud is skipped in BOTH passes for the same
  // reason trig material is: the cloud owns it, and letting its buffer win the
  // recency top-N would silence material that IS the cursor's.
  // `onlyOpen` is the CURSOR under `mode: stroke`: it reads nothing of its own
  // there, only strokes a finished walk (or take) has opened — "after the
  // walker is done the cursor should granulate as per mode: area, until i move
  // away from it" (Ek).
  // An opened take is open to the CURSOR, never to a pinned cloud: a cloud is
  // grain material, and the take's own pin is its loop (Ek, 2026-09-23).
  const _open = forCursor && _openAny();
  // Default false: the seed path shares this builder, and a cloud must read the
  // material it claims. Only the cursor's call passes true.
  const pinned = forCursor && _cloudClaimN > 0;
  _recBufRec.clear();
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const open = _open && S._openStrokes.has(p.strokeId);
    if (p.trig && !open) continue;
    if (onlyOpen && !open) continue;
    if (p._ang >= radiusRad) continue;
    if (pinned && _claimedByCloud(p)) continue;
    // An opened stroke is the one the cursor is ON: depth never hides it, so
    // it does not count toward depth either (phase 2 lets it through).
    if (open) continue;
    const key = depthKey(p);
    if ((_recBufRec.get(key) ?? -Infinity) < p.strokeId) _recBufRec.set(key, p.strokeId);
  }
  const useAllowed = S.recencyN > 0 ? _buildAllowedFromBufRec() : false;
  // Phase 2: collect in-radius particles that pass local recency.
  _candidateBuf.length = 0;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const open = _open && S._openStrokes.has(p.strokeId);
    if (p.trig && !open) continue;
    if (onlyOpen && !open) continue;
    if (p._ang >= radiusRad) continue;
    if (pinned && _claimedByCloud(p)) continue;
    if (useAllowed && !open && !_recAllowed.has(depthKey(p))) continue;
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
/** Is ANY stroke open right now? The set is only ever consulted under `grain`
 *  dwell, so leaving that dwell closes every stroke at once — no gate tick
 *  needed, and no stale entry can leak into another dwell. */
function _openAny() {
  return S.triggerParams.dwell === 'grain' && S._openStrokes.size > 0;
}
/** Has this particle's stroke been opened by a finished playthrough under
 *  `dwell: grain` (state.js `_openStrokes`)? */
function _isOpen(p) {
  return _openAny() && S._openStrokes.has(p.strokeId);
}

function _angleFromCached(p, rx, ry, rz) {
  return Math.acos(Math.max(-1, Math.min(1, p._cx * rx + p._cy * ry + p._cz * rz)));
}

export function findNearestSeedSlot(refLon, refLat, { skipReleasing = false } = {}) {
  let nearestSlot = -1, nearestAng = Infinity;
  for (let i = 0; i < S.commitSlotCount; i++) {
    const seed = S.commitSlots[i];
    if (!seed || seed.type !== 'cloud') continue;
    if (skipReleasing && seed._releasingAt > 0) continue;
    // Its anchor (pins.js pinAnchorInto), never the animated position.
    if (!pinAnchorInto(seed, _anchor)) continue;
    const ang = angleBetweenSphere(_anchor[0], _anchor[1], refLon, refLat);
    if (ang < nearestAng) { nearestAng = ang; nearestSlot = i; }
  }
  return nearestSlot;
}


/** The nearest pinned LOOP to a point — the overdub brush's master
 *  (docs/archive/OVERDUB-PLAN.md § 2: every loop pin is a master, nearest at the
 *  press, no radius). Skips a loop already on its way out. */
export function nearestLoopPin(refLon, refLat) {
  let best = -1, bestAng = Infinity;
  for (let i = 0; i < S.commitSlots.length; i++) {
    const c = S.commitSlots[i];
    if (!c || c.type !== 'loop' || isPinLeaving(c)) continue;
    const ang = angleBetweenSphere(c.anchorLon ?? 0, c.anchorLat ?? 0, refLon, refLat);
    if (ang < bestAng) { bestAng = ang; best = i; }
  }
  return best;
}
// Read by the pins rail, which marks the master so you can see which loop a dub
// would join before you press (Ek, 2026-09-15: "when there's both a cloud and a
// loop pinned ... i don't know which one is the closest loop"). Through S rather
// than an import: ui-pins.js already reaches the engine only this way.
S._nearestLoopPin = nearestLoopPin;

// ── Overdub layers ──────────────────────────────────────────────────────────
// An overdub is a take folded onto its master's cycle (ui-presets.js
// buildOverdubLayer) and played as a LAYER: a second looping source over a
// buffer exactly one wall-clock cycle long, at 1×, started so that its phase
// is the master's, into the master's own gain — so volume, the stop fades,
// the composer mute and the pin weight act on the family with no bookkeeping.
// The master's clock is `_startedAt` (fixed for the life of its source) and
// its position is `elapsed = (now − _startedAt)·|speed| mod loopLen` in
// BUFFER seconds; the layer lives in WALL seconds, so its phase is that
// position divided by |speed| (docs/archive/OVERDUB-PLAN.md § 4).

/** The master's phase in wall seconds of its cycle at audio-clock time t. */
export function masterPhaseWall(seq, t) {
  const spd = Math.abs(seq.speed || 1);
  const loopLen = (seq.loopEnd - seq.loopStart);
  // `_startedAt` can legitimately sit at or below zero (a source started in
  // the context's first seconds with an offset), so only its absence is a
  // reason to answer 0.
  if (!(loopLen > 0) || typeof seq._startedAt !== 'number') return 0;
  const elapsed = (t - seq._startedAt) * spd;
  return (((elapsed % loopLen) + loopLen) % loopLen) / spd;
}

/** Where an overdub's take is being READ right now, in take seconds — one
 *  position per pass when the take is longer than the cycle, because the
 *  passes stack and every one of them is sounding (Ek, 2026-09-05: "I
 *  should see a playhead on the overdub as well"). `phaseWall` is the
 *  master's (masterPhaseWall); `takeDur` bounds the walk. Pure, for the
 *  renderer and for pins-audit. */
export function overdubHeads(ov, phaseWall, takeDur, out = []) {
  out.length = 0;
  const cyc = ov?.layer?.duration;
  if (!(cyc > 0) || !(takeDur > 0)) return out;
  let t = (((phaseWall - (ov.phase0 || 0)) % cyc) + cyc) % cyc;
  for (; t < takeDur && out.length < 8; t += cyc) out.push(t);
  return out;
}

/** The [loopStart, loopEnd) of `buffer` as an AudioBuffer of its own, reversed
 *  or not — see the tape playback block. `buffer` is a loop payload (an
 *  AudioBuffer) or a take (`.data` over shared memory). One copy per slot,
 *  re-cut when the region, the direction or the take's length changes;
 *  `_regionBuf = null` drops it after an in-place edit of the source. */
function _regionCopy(seq, buffer, reverse, actx) {
  const sr = buffer.sampleRate;
  const lo = Math.max(0, Math.floor(seq.loopStart * sr));
  const hi = Math.min(buffer.length, Math.ceil(seq.loopEnd * sr));
  const n  = hi - lo;
  if (n <= 0) return null;
  const c = seq._regionBuf;
  if (c && c.from === buffer && c.lo === lo && c.hi === hi && c.reverse === reverse && c.len === buffer.length) return c.buf;
  const src = buffer.data ?? buffer.getChannelData(0);
  const buf = actx.createBuffer(1, n, sr);
  const dst = buf.getChannelData(0);
  if (reverse) for (let i = 0; i < n; i++) dst[i] = src[hi - 1 - i];
  else dst.set(src.subarray(lo, hi));
  seq._regionBuf = { buf, from: buffer, lo, hi, reverse, len: buffer.length };
  return buf;
}

/** Start the offline stretch for a slot's baked pitch as soon as its region
 *  exists (armTrigger's rebuild, the pin), so the first fire does not wait a
 *  tick on the worker. The seq block asks again on its own if this is late. */
S._prepareTapePitch = seq => {
  const pr = pitchRatio(seq?.pitch);
  if (pr === 1 || !seq?.buffer || !S.audioCtx) return;
  const region = _regionCopy(seq, seq.buffer, seq.direction === -1, S.audioCtx);
  if (region) stretchedRegion(seq, region, pr, !seq.trigger);
};

/** Is a LIVE take playing a region that no longer matches its own numbers, and
 *  is the replacement ready to cut? Reverse and pitch are BAKED INTO the region
 *  (a reversed copy, or one stretched by the ratio), so the only way to follow
 *  them is to cut it again — and the stretch runs on a WORKER, so releasing the
 *  moment the knob moves would leave the loop seam silent until it landed.
 *  This starts the stretch and answers false until it is in hand; the caller
 *  asks once per wrap, so the recut takes the first seam it is ready for.
 *  Exported because it is the whole of the rule and the only way to check it
 *  without a recorded take: the rig asks it directly. */
export function _liveRecutReady(seq) {
  const src = seq._sourceNode;
  if (!seq._live || !src || src._stopped) return false;
  const rev = seq.direction === -1;
  const pr  = pitchRatio(seq.pitch);
  if (src._rev === rev && src._pr === pr) return false;      // nothing moved
  if (pr === 1) return true;                                  // a plain cut, no worker
  S._prepareTapePitch?.(seq);                                 // start it if it has not
  const c = seq._pitchBuf;
  return !!(c && c.ratio === pr && !c.pending && c.buf);
}

const _LAYER_XFADE_S = 0.008;   // the swap seam while a take is still recording

/** Start one overdub's layer against a master whose source is running. Each
 *  layer has its own gain into the master's, so a LIVE take's layer can be
 *  swapped for a fresher one under a crossfade (swapOverdubLayer). */
export function startOverdubLayer(seq, ov, actx, { fadeIn = 0 } = {}) {
  if (!ov?.layer || !seq._gainNode) return;
  if (ov._src && !ov._src._stopped) return;
  const src  = actx.createBufferSource();
  const gain = actx.createGain();
  src.buffer   = ov.layer;
  src.loop     = true;
  src.loopStart = 0;
  src.loopEnd  = ov.layer.duration;
  src.connect(gain);
  gain.connect(seq._gainNode);
  const now = actx.currentTime;
  const wear = ov.wear ?? 1;   // what later dubs' decay has left of this layer
  if (fadeIn > 0) { gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(wear, now + fadeIn); }
  else gain.gain.value = wear;
  const phase = masterPhaseWall(seq, now) % ov.layer.duration;
  try { src.start(now, Math.max(0, phase)); } catch (e) { console.warn('[overdub] layer start failed:', e.message); return; }
  src.addEventListener('ended', () => { src._stopped = true; try { src.disconnect(); gain.disconnect(); } catch (_) {} }, { once: true });
  ov._src = src; ov._gain = gain;
}

/** Replace a running layer with a fresher buffer, in phase, under a short
 *  crossfade — how a take still recording is heard pass by pass (Ek,
 *  2026-09-04: "each time it cycles back to the top that material should
 *  play back the next time around"). Also the seal's final layer landing. */
export function swapOverdubLayer(seq, ov, layer, actx) {
  const old = ov._src, oldG = ov._gain;
  ov.layer = layer;
  if (!seq._gainNode || !seq._sourceNode || seq._sourceNode._stopped) { ov._src = null; ov._gain = null; return; }
  const now = actx.currentTime;
  if (old && !old._stopped) {
    try {
      if (oldG) { oldG.gain.setValueAtTime(oldG.gain.value, now); oldG.gain.linearRampToValueAtTime(0, now + _LAYER_XFADE_S); }
      old.stop(now + _LAYER_XFADE_S + 0.002);
    } catch (_) {}
    old._stopped = true;
  }
  ov._src = null; ov._gain = null;
  startOverdubLayer(seq, ov, actx, { fadeIn: _LAYER_XFADE_S });
  ov._swaps = (ov._swaps | 0) + 1;
}

/** Start every layer the master carries — called once its own source is up. */
export function startOverdubLayers(seq, actx) {
  if (!seq.overdubs?.length) return;
  for (const ov of seq.overdubs) startOverdubLayer(seq, ov, actx);
}

/** Stop the layers with the master: at `when` (a fade's end), or now.
 *  `playToEnd` lets them run out their current pass instead — the family
 *  ends on the same wrap because every layer shares the master's origin. */
export function stopOverdubLayers(seq, { when = null, playToEnd = false } = {}) {
  if (!seq?.overdubs?.length) return;
  for (const ov of seq.overdubs) {
    const src = ov._src;
    if (!src || src._stopped) continue;
    try {
      if (playToEnd) src.loop = false;
      else { src.stop(when ?? undefined); src._stopped = true; }
    } catch (_) {}
    if (!playToEnd) { ov._src = null; ov._gain = null; }
  }
}

let _schedLastAt = 0;
let _schedTickCount = 0;  // for periodic dlog snapshot

// ── Scheduler overview ──────────────────────────────────────────────────────
// The grain scheduler runs at 100 Hz (GRAIN_SCHEDULER_INTERVAL_MS, 10 ms) on the main
// thread.  It performs spatial search (cursor + seed candidate pools) and posts
// candidate lists to the AudioWorklet grain engine via postMessage.  The worklet
// handles all grain synthesis at sample rate.
// Every onset clock — the cursor's and each seed's — is the worklet's
// (grain-engine.worklet.js `nextOnset`); the main thread posts candidates and
// nothing else. The seed clocks it used to keep beside them (`_nextOnsetT`)
// were advanced every tick and read by nothing (deleted 2026-09-16).

// ── The walkers ─────────────────────────────────────────────────────────────
// A walker reads like a moving cloud whose centre is the stroke's path and
// whose lens is the LIVE one: the cursor's radius, k, order and fade as they
// stand this tick, the marks' own voicings underneath (the bridge buckets
// the pool by `p._vo`, so an auditioned mark's knobs reach it). Area only — a walker
// is never `nearest`, that would read the whole sphere from a moving point.
//
// WHICH IS THE ONE COMBINATION TO KNOW ABOUT, now that walking is the grain
// shape's and the aperture is still the lens's (2026-09-22): a walk under the
// `spot` lens reads as AREA while it walks. Nothing is refused and nothing is
// silently wrong — `nearest` has no meaning for a point that is moving along a
// path, so the walk takes the only reading it can.
function _scheduleWalkers(out) {
  const ws = S._walkers;
  if (!ws || !ws.length) return;
  tickWalkers(GRAIN_SCHEDULER_INTERVAL_MS);
  if (!ws.length) return;
  const cParts = S.particles, cLen = cParts.length;
  if (!cLen) return;
  const base = gp(), ov = S.grainOverrides;
  let hasOv = false;
  for (const key in ov) if (ov[key] !== null && ov[key] !== undefined) { hasOv = true; break; }
  const cgp = hasOv ? Object.assign(Object.create(base), Object.fromEntries(Object.entries(ov).filter(([, v]) => v !== null && v !== undefined))) : base;
  const k = cgp.k ?? 8, all = !!S.grainKAllMode;
  const radDeg = S.searchRadiusDeg, rad = radDeg * Math.PI / 180;
  for (const w of ws) {
    if (!(w.level > 0)) continue;
    const angKey = `_cAng${w.slotIndex}`;
    const cosLat = Math.cos(w.lat);
    const rx = cosLat * Math.sin(w.lon), ry = Math.sin(w.lat), rz = cosLat * Math.cos(w.lon);
    for (let pi = 0; pi < cLen; pi++) {
      const p = cParts[pi];
      if (p._cx === undefined) stampCartesian(p);
      const ang = _angleFromCached(p, rx, ry, rz);
      p[angKey] = ang;
      p._ang    = ang;
    }
    let pool = _buildCandidatePoolRadius(cParts, rad);
    if (!all && pool.length > k) pool = _buildCandidatePoolNearest(pool, k, false, undefined);
    if (!pool.length) continue;
    out.push({
      slotIndex: w.slotIndex,
      pool: pool.slice(),
      gain: w.level,
      grainParams: cgp,
      overrides: hasOv ? ov : null,
      kSeqMode: !!S.grainKSeqMode,
      fadeOn:    !!S.radiusFadeEnabled && radDeg > 0,
      fadeRad:   rad,
      fadeCurve: S.radiusFadeCurve ?? 0.5,
      angKey,
    });
    perf.seedsPosted++;
    if (pool.some(p => p.source === 'live')) S.liveGranulatingThisFrame = true;
  }
}

// ── Moving seed helpers ────────────────────────────────────────────────────
// Interpolate a moving seed's frame data at its current playhead position.
// Interpolate a moving seed's current frame.  Reuses seed._currentFrame
// when available to avoid allocating a 12-property object every tick
// per moving seed (at 16 seeds × 50 ticks/sec = 800 objects/sec of GC
// pressure).  When the effective time lands exactly on a keyframe,
// returns that keyframe directly (no allocation either way).
function _interpolateMovingSeed(seed) {
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

// Test seam for scripts/trigger-audit.js § typing. Runs the REAL candidate-pool
// builders against the current S.particles, so the "never both" rule is
// asserted on the functions the scheduler actually uses rather than on a copy
// of them in the test. scheduleGrains() can't be driven headless — it returns
// early unless an AudioContext is genuinely running, and headless has no user
// gesture to start one. Not used by the app.
export function __testCandidatePool(cursorLon, cursorLat, { nearest = false, k = 8 } = {}) {
  const cosLat = Math.cos(cursorLat);
  const crx = cosLat * Math.sin(cursorLon);
  const cry = Math.sin(cursorLat);
  const crz = cosLat * Math.cos(cursorLon);
  for (const p of S.particles) {
    if (p._cx === undefined) stampCartesian(p);
    p._ang = _angleFromCached(p, crx, cry, crz);
  }
  // Mirrors scheduleGrains() exactly, and has to: geometry first, then the
  // per-voicing cap. If this kept calling _buildCandidatePoolNearest() directly
  // it would still pass while guarding a path the cursor no longer takes —
  // nearest mode's trig filter now lives in _selectPerVoicing (#212).
  _refreshCloudClaims();   // the scheduler does this per tick; mirror it here
  const nearestRead = nearest && !S.grainWalk && S.lensReads !== 'tape';
  const geom = _cursorGeometry(S.particles, S.searchRadiusDeg * Math.PI / 180, nearest);
  const pool = _selectPerVoicing(geom, k, nearestRead);
  return pool.slice();   // the builders reuse one buffer; hand back a snapshot
}
/** Would the cursor's pool SOUND this tick — the scheduler's own test. */
export function __testCursorSounds() { return _cursorSounds(); }
/** How many marks passed every filter but k last pass (the counter's left). */
export function __testEligible() { return _voEligible; }

// THE CURSOR'S GEOMETRY — one function for the scheduler and its test seam, so
// the seam cannot drift from the path the cursor takes (it had: walk's
// `onlyOpen` never reached it).
//
// SCOPE TAPE still hears an OPENED take (Ek, 2026-09-23: "the dwell on grain
// should override any cursor setting"). `dwell: grain` is a tape answer — play
// the take, then granulate it — so a cursor scoped to tape reads exactly the
// strokes that dwell opened, and nothing else, as a radius cursor would: mode
// is a grain question, greyed there.
function _cursorGeometry(particles, radiusRad, nearest) {
  // WALKING: the cursor reads only a stroke a finished walk has opened, and
  // reads it exactly as `area` would — radius, k, order, fade. In nearest too:
  // nearest used to hand walk the whole sphere, so a walking cursor granulated
  // on its own there.
  const onlyOpen = S.grainWalk || S.lensReads === 'tape';
  if (nearest && !onlyOpen) return particles;
  return _buildCandidatePoolRadius(particles, radiusRad, true, onlyOpen);
}
/** Capped, or scoped to tape with nothing opened: the pool is drawn, not heard. */
function _cursorSounds() {
  return !S.scanMuted && !(S.lensReads === 'tape' && !_openAny());
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

  // The grain edit lens no longer freezes the cursor (#284) — it is browsed
  // with, so the scan auditions wherever you actually are.
  const { lon: cursorLon, lat: cursorLat } = cursorLonLatNow();
  const k = S.grainOverrides.k ?? gp().k;
  const searchRadiusRad = S.searchRadiusDeg * Math.PI / 180;

  S.liveGranulatingThisFrame = false;
  perf.seedsPosted = 0;

  if (S.particles.length && !((S.commitMode === 'loop') && S.isPainting)) {

    // What the pinned clouds own, once per tick — read by both pool builders
    // below. Cheap enough to do unconditionally (a walk of ≤16 slots) and it
    // must not be skipped by the angle cache, because a cloud can move or be
    // unpinned while the cursor sits perfectly still.
    _refreshCloudClaims();

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
    // GEOMETRY ONLY. Scope and reach are the cursor's (#212), so this decides
    // WHERE the cursor can hear; `k` is the LENS's too (2026-09-03: the lens
    // owns how the cursor reads — k, order, fill, radius, nearest, recency —
    // and the brush owns the sound), so HOW MANY is applied afterwards with
    // the one live k. A lens change moves the fan for every stroke, dry or
    // live, and that is right; a brush knob never does. Nearest mode passes
    // the whole sphere rather than pre-capping, since nearest ignores the
    // radius entirely.
    const nearestRead = S.lensMode === 'nearest' && !S.grainWalk && S.lensReads !== 'tape';
    candidatePool = _cursorGeometry(particles, searchRadiusRad, S.lensMode === 'nearest');

    // The cap, per brush. Both former call sites collapse into this one pass —
    // radius mode's pre-select and nearest mode's k-selection were the same
    // keep-k-smallest loop with different inputs.
    const _preSelectedPool = _selectPerVoicing(candidatePool, k, nearestRead);
    // `in reach → taken`: what passed every filter but k, then what k kept.
    // Not the geometry's length — in nearest that is the whole sphere, trig
    // and cloud-owned marks included.
    perf.kPool  = _voEligible;
    perf.kCount = _preSelectedPool.length;

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
      // Publish the pool for read-only consumers (the x-IMU3 LED timbre
      // readout). Two assignments per tick, no copy: the buffer is reused next
      // tick by design, and every consumer wants the *current* pool anyway.
      // The timestamp is what lets them tell a live pool from a stale one after
      // the scheduler stops. Do not mutate S._cursorPool.
      S._cursorPool   = pool;
      S._cursorPoolAt = now;
      // The lens reads grains, tape, or both (state.js `lensReads`). A lens
      // that reads only tape takes the cursor's granulation out exactly as
      // the cap does — the SAME path, so the muted-scan glow simulation still
      // draws what the candidates would be and nothing downstream needs a
      // second test. Unless a stroke is OPEN: then the pool above is only
      // what dwell opened, and it sounds (`_cursorSounds`).
      // With the shape on `walk` the cursor reads nothing on its own either —
      // a touch launches a walker (below), and that is the whole of its
      // reading.
      if (!_cursorSounds()) {
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
            // The glow lasts the mark's OWN grain (its stroke's frozen
            // voicing), as the live glow does; the simulated onset clock is
            // the brush's, which is what a muted scan would fire at.
            const v = p._vo ? voicingById(p._vo) : null;
            // GHOST: lit, not sounding. The renderer draws these faint and
            // everything else at full weight, so a pinned cloud playing under
            // a capped lens stays bright.
            markGlow(p, v ? (v.params.duration ?? 0.1) * 1000 : durMs, '#ffffff', now, true);
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
    // When particles drop to 0 (e.g. undoing the last buffer while the cursor
    // is over those particles), the worklet still has the previous tick's
    // candidate list and keeps firing cursor grains from it — visual particles
    // are gone but audio continues until something repopulates S.particles.
    // Post an empty list so the worklet stops cursor grains immediately.
    // Mirror of the unconditional _postWorkletSeeds post below (same fix
    // pattern that was already applied to seeds — see the comment there).
    // Deliberately scoped to particles===0 so the seq-mode-painting skip case
    // (the other reason this else branch fires) keeps its existing behaviour.
    if (S.particles.length === 0 && S._postWorkletCandidates) {
      S._postWorkletCandidates([], cursorLon, cursorLat);
    }
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

  // ── Phase 3: the pin mix ───────────────────────────────────────────────
  // ONE control decides how the pins share the mix, and it is a pin parameter,
  // not a lens one: Settings → Pins → Blend. `all` plays every pin flat, `focus`
  // leans toward whichever is closest to the cursor. It applies to clouds and
  // loops alike, because a pin's kind is what GROUPS it (js/pins.js), never
  // what decides whether it is heard.
  //
  // The pair of composing pin LENSES that used to gate this were sunset on
  // 2026-08-30 (Ek: "no weird filters to have to wrap our heads around"). They
  // had quietly taken over `commitPlayback`'s job while leaving it on screen, so
  // the fix was to give it back rather than to invent a third switch — the
  // crossfade row under it is its shape, and the lens is purely the scratch
  // layer's. FOLLOW is the rail's word for `focus` since 2026-09-22 night.
  //
  // The law is RELATIVE TO THE NEAREST PIN (Ek, 2026-09-05: "when I'm
  // completely on top of the anchor I still hear a bit of the other pinned
  // loop … it should be a full crossfade"). The version this replaces was
  // `(1 − d/r)^e` normalised; with tether on r is the whole sphere, so a pin
  // 40° away still had raw weight 0.78^e — at xfade 50 % a −19 dB residual
  // ON the other pin's anchor, and no xfade could remove it because the law
  // never asked where the cursor was BETWEEN the pins. This one does:
  //
  //     d0    = distance to the nearest pin
  //     u_i   = 2·d0 / (d0 + d_i)        0 on the nearest, 1 when tied
  //     t_i   = clamp((u_i − (1 − k)) / k, 0, 1)      k = xfade (≥ 0.02)
  //     s_i   = t_i²·(3 − 2·t_i)                       smoothstep: flat at both ends
  //     w_i   = s_i / Σ
  //
  // On a pin's anchor d0 = 0, so every other u is 0 and the nearest is alone,
  // at any xfade. Midway between two pins u = 1 and the mix is even. xfade is
  // the WIDTH of the handover: 100 % blends the whole way from one anchor to
  // the next, 0 % snaps at the midpoint. The smoothstep is what keeps "on the
  // anchor" honest at 100 %: a hand is never exactly on a point, and a linear
  // handover a degree off a pin 30° from the next would leak −24 dB of it;
  // flat at t = 0 that is −38 dB, and the midpoint is still even.
  // NO REACH GATE (Ek, 2026-09-22 night: "if cursor-mixer is on there's really
  // no radius so tether becomes confusing … act as if tether is on"). `tether`
  // was a switch that, off, silenced a pin outside the LENS radius and shaped
  // the ones inside by `(1 − d/r)`; the radius is the scratch layer's, and a
  // pin is never gated by it now — what tether-on always did, with no switch.
  // Normalising is what makes it a CROSSFADE rather than a fade: the mix
  // always sums to one.
  _seedWeights.fill(0);
  const _pinFocus = S.commitPlayback === 'focus';
  if (_pinFocus) {
    const k = Math.max(0.02, Math.min(1, S.commitXfade ?? 0.5));
    let nearest = -1, d0 = Infinity;
    for (let i = 0; i < MAX_SEEDS; i++) {
      const slot = S.commitSlots[i];
      _seedDist[i] = -1;
      if (!slot || i >= S.commitSlotCount) continue;
      if (slot.type !== 'cloud' && slot.type !== 'loop') continue;
      // A pin you cannot hear is not a crossfade partner: a muted loop, a cloud
      // under a mute hold, or a pin on its way out (2026-09-16) used to become
      // `nearest`, and with d0 = 0 every audible pin's weight went to zero
      // while the cursor sat on the silent one.
      if (!isCommitOn(slot) || isPinLeaving(slot)) continue;
      // A pin's ANCHOR — where its gesture released (pins.js pinAnchorInto),
      // never the position the scheduler writes into a moving cloud's `lon`
      // every tick (Ek, 2026-09-05: "an anchor is an anchor, it should not
      // move"). This pass was the one reader that followed the cloud.
      if (!pinAnchorInto(slot, _anchor)) continue;
      const dist = angleBetweenSphere(_anchor[0], _anchor[1], cursorLon, cursorLat);
      _seedDist[i] = dist;
      if (dist < d0) { d0 = dist; nearest = i; }
    }
    let sum = 0;
    if (nearest >= 0) {
      for (let i = 0; i < MAX_SEEDS; i++) {
        const d = _seedDist[i];
        if (d < 0) continue;
        const u = (d0 + d) > 0 ? 2 * d0 / (d0 + d) : 1;
        const t  = Math.min(1, Math.max(0, (u - (1 - k)) / k));
        const w = t * t * (3 - 2 * t);
        _seedWeights[i] = w;
        sum += w;
      }
      if (sum > 0) { for (let i = 0; i < MAX_SEEDS; i++) if (_seedWeights[i]) _seedWeights[i] /= sum; }
    }
    S._dominantSeedSlot = sum > 0 ? nearest : -1;
  } else {
    // Flat: every active cloud plays at full weight, as before. Loops are not
    // weighted here — their gain is the mute they already had.
    for (let i = 0; i < MAX_SEEDS; i++) {
      const slot = S.commitSlots[i];
      _seedWeights[i] = (slot && slot.type === 'cloud' && i < S.commitSlotCount
                         && slot.playing !== false) ? 1 : 0;
    }
    S._dominantSeedSlot = -1;
  }

  // Collect active seed data for worklet posting
  const _workletSeedData = [];

  for (let i = 0; i < MAX_SEEDS; i++) {
    const seed = S.commitSlots[i];
    if (!seed || seed.type !== 'cloud' || i >= S.commitSlotCount) continue;
    // Composer mode can hold a cloud at silence with its slot intact. `playing`
    // is undefined on every cloud made before composer mode existed and on
    // every one made normally since, so only an explicit false stops it — the
    // gate has to be opt-in or it would silence the entire existing bank.
    //
    // A release in flight is the exception and MUST run. Skipping a held cloud
    // outright meant ⌘D on one did nothing at all: releaseCommit() stamps
    // _releasingAt and leaves the deletion to the branch below, which this
    // `continue` never let it reach. The commit was unkillable while stopped.
    if (seed.playing === false && !(seed._releasingAt > 0)) continue;

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
        // The fork that makes composer mode possible. The same ramp serves two
        // different intents and only the flag tells them apart:
        //   uproot (⌘D)          — ramp, then the slot is gone
        //   composer toggle off  — ramp, then HOLD at silence, slot survives
        // Without this a composer-stopped cloud would simply vanish, and there
        // would be nothing left to toggle back on.
        if (seed._composerHold) {
          seed.playing         = false;
          seed._releasingAt    = 0;
          seed._envGainCurrent = 0;
          if (S.updateSeedBanksUI) S.updateSeedBanksUI();
          continue;
        }
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
    if (seedWeight < 0.001) continue;

    // Phase 4: merge seed.grainOverrides (written by gesture/desktop morph)
    // on top of the base params. Overrides with non-null values take precedence.
    // For moving seeds, the base is the interpolated frame's grainParams;
    // for stationary seeds, the base is the planted snapshot.
    // The bridge gets the overrides on their own as well: a cloud reads a
    // mark with the MARK's voicing (2026-09-05, below at _workletSeedData),
    // and the morph has to land on top of that block too, not only on the
    // cloud's own.
    let cgp;
    const cgo = seed.grainOverrides;
    const hasOverrides = !!cgo && Object.keys(cgo).length > 0;
    {
      const baseGP = isMoving ? frame.grainParams : seed.grainParams;
      cgp = hasOverrides ? Object.assign(Object.create(baseGP), cgo) : baseGP;
    }
    // For moving seeds, use frame's modes; for stationary, use seed's snapshot.
    const cNearestMode = isMoving ? frame.nearestMode : seed.nearestMode;
    const cKAllMode    = isMoving ? frame.kAllMode    : seed.kAllMode;
    const cKSeqMode    = isMoving ? frame.kSeqMode    : seed.kSeqMode;
    const cSearchDeg   = isMoving ? frame.searchRadiusDeg : seed.searchRadiusDeg;
    const cFadeOn      = isMoving ? frame.radiusFadeEnabled : seed.radiusFadeEnabled;
    const cFadeCurve   = isMoving ? frame.radiusFadeCurve   : seed.radiusFadeCurve;

    // ── Stamp angular distances on particles ────────────────────────────
    const cParts  = S.particles;
    const cLen    = cParts.length;

    // Per-slot angle cache key. `p._ang` is scratch — the next seed's stamping
    // pass overwrites it, and _postWorkletSeeds only runs after the whole seed
    // loop, so anything the bridge needs must live under this per-slot key.
    // (Same hazard the pool.slice() below guards against, one level down.)
    const cAngKey = `_cAng${seed.slotIndex}`;

    if (isMoving) {
      // Moving seed: recompute position from interpolated frame each tick
      const mCosLat = Math.cos(frame.lat);
      const mRx = mCosLat * Math.sin(frame.lon);
      const mRy = Math.sin(frame.lat);
      const mRz = mCosLat * Math.cos(frame.lon);
      for (let pi = 0; pi < cLen; pi++) {
        const p = cParts[pi];
        if (p._cx === undefined) stampCartesian(p);
        const ang = _angleFromCached(p, mRx, mRy, mRz);
        p[cAngKey] = ang;   // no caching across ticks — the seed moves
        p._ang     = ang;
      }
    } else {
      // Stationary seed: incremental caching — only stamp NEW particles.
      // (cAngKey is the cache; see the hoisted declaration above.)
      // During recording, particles are appended at ~10/sec.  The old approach
      // recomputed ALL N distances on every version bump, making the cache
      // effectively useless during recording (16 seeds × 500 particles × 50
      // ticks = 400K acos/sec).  Now we only compute distances for particles
      // added since the last stamp and copy the rest from per-particle cache.
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

    if (!pool.length) continue;

    // ── Collect seed data for worklet ────────────────────────────────────
    // Worklet handles all grain synthesis; main thread just posts candidates.
    // pool.slice() — _buildCandidatePoolRadius / _buildCandidatePoolNearest
    // return a shared module-level _candidateBuf.  Without cloning, the next
    // seed's iteration overwrites this seed's pool before _postWorkletSeeds
    // can iterate it (all seeds would share the last seed's particles).
    // A cloud is a moving cursor (Ek, 2026-09-05): it reads each mark with
    // the mark's own voicing — an auditioned mark's knobs reach the wash cloud's
    // material, a dry stroke it crosses keeps its frozen sound. The bridge
    // buckets the pool by `p._vo` exactly as it does for the cursor and posts
    // one worklet voice per voicing. `grainParams` is what a mark with NO
    // voicing plays with — the block the cloud was pinned with, as before.
    _workletSeedData.push({
      slotIndex: i,
      pool: pool.slice(),
      gain: _seedWeights[i] * seedEnvGain * (seed.level ?? 1),   // × the pin's fader
      grainParams: cgp,
      overrides: hasOverrides ? cgo : null,
      kSeqMode: cKSeqMode,
      // Radius fade is resolved live in the bridge from the per-slot angle
      // cache, so a moving cloud fades against where it is now rather than
      // where it was planted.
      fadeOn:      !!cFadeOn && !cNearestMode && cSearchDeg > 0,
      fadeRad:     cSearchDeg * Math.PI / 180,
      fadeCurve:   cFadeCurve ?? 0.5,
      angKey:      cAngKey,   // pass the key, don't re-derive it in the bridge
    });
    perf.seedsPosted++;   // count for diagnostics
    if (pool.some(p => p.source === 'live')) S.liveGranulatingThisFrame = true;
  }

  // The walkers (js/walker.js): the cursor's own readers under `mode:
  // stroke`, packed as seed voices beside the pinned clouds.
  _scheduleWalkers(_workletSeedData);

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
  if (S._commitRecordingFrames || S._shelvedSeed) tickSeedRecording();

  // ── Trigger gates ───────────────────────────────────────────────────────
  // Flip `playing` on armed triggers according to cursor proximity, before the
  // playback block below reads it. Registered by js/trigger.js on S rather than
  // imported, to keep grain.js free of a circular import.
  S._updateTriggerGates?.(cursorLon, cursorLat, now);


  // ── Sequential (loop) playback ──────────────────────────────────────────────────
  // Each sequence uses a single looping AudioBufferSourceNode — no per-grain
  // scheduling, no envelopes, no crossfade.  One continuous buffer read,
  // exactly like a hardware looper.  The scheduler tick only manages the
  // source node lifecycle and updates the visual playhead index.
  //
  // Runs over commit slots AND armed triggers. A trigger entry is shaped like a
  // loop slot on purpose (see js/trigger.js) so this block needs to know almost
  // nothing about it — only that triggers aren't in the commit bank, and that a
  // one-shot must not loop.
  const _trigs = S.triggers;
  const _seqTotal = MAX_SEEDS + (_trigs ? _trigs.length : 0);
  for (let si = 0; si < _seqTotal; si++) {
    const isTrigger = si >= MAX_SEEDS;
    const seq = isTrigger ? _trigs[si - MAX_SEEDS] : S.commitSlots[si];
    if (!seq || seq.type !== 'loop' || !seq.playing || !seq.particles.length) continue;

    // ── The loop's share of the pin mix ─────────────────────────────────
    // Ramped, not assigned: this moves with the cursor, so a per-tick step on
    // a gain is a click every 20 ms. The same 15 ms constant the panner uses,
    // for the same reason. Triggers are not pins and keep a flat 1.
    //
    // `S.audioCtx`, not `actx`: the `actx` below is declared inside the
    // source-build block further down, so reading it here threw a
    // ReferenceError every tick that the bare catch swallowed — the weight
    // was computed and the loop's gain never left 1 (Ek, 2026-09-05:
    // "not working for loop/overdub pins"). The catch stays for a node
    // mid-teardown, but it no longer hides a missing binding.
    if (seq._pinGain && S.audioCtx) {
      const pinW = (!isTrigger && S.commitPlayback === 'focus') ? (S._pinWeights[si] || 0) : 1;
      // Only when it moved: in `all` mode this is a constant 1, and a timeline
      // event per loop per 10 ms tick is work the audio thread does for nothing.
      if (seq._lastPinW !== pinW) {
        seq._lastPinW = pinW;
        try { seq._pinGain.gain.setTargetAtTime(pinW, S.audioCtx.currentTime, 0.015); }
        catch (e) { dlog('pinweight', e.message); }
      }
    }
    // ── The loop's LEVEL follows its fader (2026-09-16) ──────────────────
    // `grainParams.volume` was read once, when the source was built; the rail's
    // track is a fader on it now, so the gain node follows it — only when it
    // moved, because the same node carries the per-pass decay (below) and the
    // stop fades, and a write every tick would fight both.
    if (seq._gainNode && S.audioCtx && !isTrigger && !seq._playingToEnd && !seq._fadingOut && !seq._selfKilled) {
      let vol = _loopGain(seq);
      // A self-killing loop steps down per pass (below); a fader move mid-life
      // must land on the stepped value, not reset the decay.
      if (seq.passes > 0 && seq._wrapIdx > 0) vol *= 1 - seq._wrapIdx / seq.passes;
      if (seq._lastVol !== vol) {
        seq._lastVol = vol;
        try { seq._gainNode.gain.setTargetAtTime(vol, S.audioCtx.currentTime, 0.015); } catch (_) {}
      }
    }
    // Mute loops beyond active slot count (data preserved, audio paused).
    // Full node release, not just stop (perf audit M2) — idempotent, cheap
    // after the first call (all refs nulled).
    // Triggers have no slot index, so the bank limit doesn't apply to them.
    if (!isTrigger && si >= S.commitSlotCount) {
      releaseSeqNodes(seq);
      continue;
    }

    // Create the looping source node on first tick (or after context recreate).
    // Also recreate if the AudioContext changed (sample rate switch) — the old
    // source node belongs to the previous context and is unusable.
    const needsNewSource = !seq._sourceNode
      || seq._sourceNode._stopped
      || (seq._sourceCtx && seq._sourceCtx !== S.audioCtx);
    if (needsNewSource) {
      // Release the previous subgraph before building a new one (perf audit
      // M2) — recreation after mute/unmute or a context switch used to
      // orphan the old per-speaker gain fan-out, still connected to buses.
      releaseSeqNodes(seq);
      const actx = ensureAudioContext();
      const buffer = seq.buffer;
      if (!buffer) continue;

      // For reverse playback, create a reversed copy of the loop region.
      // Cache it on the seq object so we don't re-reverse every tick.
      // A pinned loop's `buffer` is its own crossfaded region (buildLoopPayload);
      // a trigger's is the TAKE it stands on (trigger.js rebuildTrigger) — shared
      // memory (js/take.js), which a source node cannot play. Either way the
      // source plays a REGION copy when one is needed: reversed, or forward out
      // of a take. Cached on the slot, keyed on what it was cut from, so a
      // trigger whose region moved is re-cut and a loop pin never copies.
      let playBuffer = buffer;
      let playLoopStart = seq.loopStart;
      let playLoopEnd   = seq.loopEnd;
      const reverse = seq.direction === -1;
      // The baked pitch (js/tape-pitch.js): the region stretched ONCE by the
      // ratio and played at speed × ratio, so the length is unchanged and
      // the pitch moves. The stretch and the rate cancel in time, which is
      // why everything below that reads `seq.speed` against the ORIGINAL
      // region — the playhead, the overdub fold, the tail — needs no change.
      const pr = pitchRatio(seq.pitch);
      if (reverse || buffer.data || pr !== 1) {
        let region = _regionCopy(seq, buffer, reverse, actx);
        if (!region) continue;
        if (pr !== 1) {
          region = stretchedRegion(seq, region, pr, !seq.trigger);
          if (!region) continue;   // the worker is on it — next tick
        }
        playBuffer    = region;
        playLoopStart = 0;
        playLoopEnd   = region.duration;
      }
      const rate = Math.abs(seq.speed || 1) * pr;   // buffer seconds per wall second

      const src  = actx.createBufferSource();
      const gain = actx.createGain();
      src.buffer       = playBuffer;
      // A one-shot trigger plays through once and stops; everything else loops.
      // Dwell is a live global, so this is only the value at fire time —
      // _applyLiveParams() flips `src.loop` on a sounding source if it changes.
      src.loop         = !seq.trigger || S.triggerParams.dwell === 'loop';
      src.loopStart    = playLoopStart;
      src.loopEnd      = playLoopEnd;
      src.playbackRate.value = rate;
      // THE PITCH THIS REGION WAS CUT AT. An auditioned take follows `speed`
      // on a SOUNDING pass (trigger.js `_applyLiveParams`), and the rate is
      // speed × ratio — so the live update needs the ratio the region already
      // carries, not whatever the sheet says now. Reading the sheet instead
      // would move the length as well as the rate, and a loop's seam with it.
      src._pr = pr;
      // …and WHICH WAY it was cut, for the same reason: a live take whose
      // reverse or pitch moves needs its region cut again, and these two stamps
      // are how the tick knows the one it is playing has gone stale.
      src._rev = reverse;
      gain.gain.value  = _loopGain(seq);

      // The master's OWN gain, in front of the family node the layers share
      // (startOverdubLayer connects into `gain`): the dub's decay wears the
      // master without wearing its layers, each of which carries its own.
      const own = actx.createGain();
      own.gain.value = seq.wear ?? 1;
      src.connect(own);
      own.connect(gain);
      seq._ownGain = own;

      // ── Composer mute — DJ mute, in series after gain ───────────────────
      // Its own node on purpose. `gain` already carries grainParams.volume AND
      // is what _stopSeqAudio ramps for fades, so composer riding it would
      // fight both — a stop fade and a mute landing inside the same 50 ms.
      // With the split, `gain` keeps volume + stops and this keeps the mute.
      //
      // The source NEVER stops for a composer mute; that is the whole point.
      // See docs/archive/COMPOSER-MODE-PLAN.md § 0.
      const mute = actx.createGain();
      // Recreated slots inherit the mute, or unmuting a rebuilt loop would be
      // impossible — it would come back sounding with composerMuted still set.
      mute.gain.value = seq.composerMuted ? 0 : 1;
      gain.connect(mute);
      seq._muteGain = mute;

      // ── Pin weight — the loop's share of the crossfade ──────────────────
      // A THIRD node, for the same reason the mute is its own: `gain` carries
      // volume and stop-fades, `mute` carries the binary pin/group mute, and
      // this carries a continuous 0–1 that the cursor moves every tick. Riding
      // any of them on one another means a mute landing inside a crossfade, or
      // a stop fade fighting a distance ramp.
      //
      // This is the gap that made "crossfade the loops too" real work rather
      // than a parameter: before it, a loop pin had exactly two gains, on and
      // off, so it could be in the mix or out of it and nothing in between.
      // Starts at 1 so a loop with no pin lens installed is untouched.
      const pinG = actx.createGain();
      pinG.gain.value = 1;
      mute.connect(pinG);
      seq._pinGain = pinG;

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
          pinG.connect(g);
          g.connect(S.speakerBuses[si].bus);
          spkGains.push(g);
        }
        seq._vbapGains = spkGains;       // per-speaker gain nodes
        seq._vbapLast = null;             // the last pair + weights written, so the tick can skip
        seq._extraNodes = spkGains;
        seq._panner = null;
      } else {
        // Stereo browser path: always create a StereoPanner, update each tick
        const panner = actx.createStereoPanner();
        panner.pan.value = 0;
        pinG.connect(panner);
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
          cameraRotateInto(iWx, iWy, iWz, _grainScratchC);
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
      // Clamped ≥ 0 unconditionally: a negative offset makes src.start()
      // THROW, and an uncaught throw here aborts the whole scheduler pass —
      // one poisoned slot silenced every loop and the trigger gate with it
      // (2026-08-28). The writers clamp too; this is the last line of defence.
      let offset = Math.max(0, (seq.startOffset || 0) * pr);   // region seconds → the buffer played
      // A loop made from a fresh take starts its FIRST pass as far in as the
      // release is behind — the cycle's top is the instant the button went
      // up, not the tick the source was built (ui-presets.js _phaseAnchor).
      if (seq._phaseAnchor != null && !seq._phaseApplied) {
        seq._phaseApplied = true;
        const ll = playLoopEnd - playLoopStart;
        if (ll > 0) offset = ((((startAt - seq._phaseAnchor) * rate) % ll) + ll) % ll;
      }

      // Declick on start — enough to stop a click from silence→signal, and no
      // more. Was 35 ms, which is a fade rather than a declick: a woodblock or
      // triangle attack lives entirely inside that window, so a loop or trigger
      // that opens on a hit arrived soft.
      //
      // Worse for a loop, it applied to the FIRST PASS ONLY — the native loop
      // wrap changes no gain — so a loop starting on a beat gave you one soft
      // hit and correct ones from the second time round. Inconsistent between
      // passes is harder to play against than either behaviour on its own.
      //
      // 3 ms is ~144 samples at 48k: enough to stop the click when playback
      // starts mid-waveform (which `start: touch` and `ends` both do, and which
      // is the case this ramp actually exists for), short enough to leave a
      // transient intact.
      const targetVol = _loopGain(seq);
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(targetVol, startAt + DECLICK_S);

      // A non-looping source IGNORES loopEnd and plays to the end of the
      // buffer, so a one-shot trigger has to be given an explicit duration or
      // it plays past its region. This is what made erasing the tail of a
      // trigger stroke do nothing audible while erasing the head worked: the
      // head is the `offset`, but nothing was bounding the other end.
      // Duration is in buffer seconds (playbackRate scales the wall-clock), so
      // it stays correct as speed is ridden.
      // 'grain' is a one-shot too — the sample fires once and the dwelling
      // opens the material to the granular cursor. Only 'loop' loops.
      const oneShot = seq.trigger && S.triggerParams.dwell !== 'loop';
      const startPos = Math.max(0, playLoopStart + offset);
      try {
        if (oneShot) {
          const span = Math.max(0.001, playLoopEnd - startPos);
          src.start(startAt, startPos, span);
          // The end fade (ONESHOT_FADE_S): the span is buffer seconds, the
          // ramp is wall time, so divide by the rate. A segment shorter than
          // two fades gets half of itself.
          const wallSpan = span / Math.max(1e-6, rate);
          const fade = Math.min(ONESHOT_FADE_S, wallSpan / 2);
          gain.gain.setValueAtTime(targetVol, startAt + wallSpan - fade);
          gain.gain.linearRampToValueAtTime(0, startAt + wallSpan);
          seq._endFade = { at: startAt + wallSpan - fade, to: startAt + wallSpan };
        } else {
          src.start(startAt, startPos);
          seq._endFade = null;   // a loop has no end; its seam is baked (buildLoopPayload)
        }
      } catch (err) {
        // A slot that cannot start must not take the scheduler pass down with
        // it: rebuilt and re-thrown every tick, one poisoned slot silenced
        // every loop AND the trigger gate behind it. Kill this slot, keep the
        // instrument.
        console.warn('[seq] source start failed — slot stopped:', err.message);
        releaseSeqNodes(seq);
        seq.playing = false;
        continue;
      }

      seq._sourceNode = src;
      seq._sourceCtx  = actx;  // track which context owns this node
      seq._gainNode   = gain;
      seq._startedAt  = startAt - offset;  // adjust so playhead tracking stays correct
      // The overdub layers ride this source's clock and gain: built here,
      // every time the master's source is, so a rebuilt master (unmute after
      // a stop, a context switch, an import) brings its family with it.
      startOverdubLayers(seq, actx);
      // A new source restarts `elapsed` at zero, so the wrap counter has to go
      // with it — left stale and high, the comparison below would never fire
      // again for the rest of that trigger's life.
      seq._wrapIdx    = undefined;

      // Clean up ref when source ends (shouldn't normally — it loops).
      // A one-shot trigger DOES end here, and must also clear `playing`: the
      // needsNewSource check above fires on a stopped source, so without this
      // the one-shot restarts itself every tick — a runaway loop.
      // `src` is passed so the handler can tell whether the node that just
      // ended is still the CURRENT one. Under retrig:'layer' older voices are
      // detached and left ringing; one of those finishing must not clear
      // `playing` on the voice that replaced it.
      src.addEventListener('ended', () => {
        src._stopped = true;
        if (seq.trigger) S._onTriggerSourceEnded?.(seq, src);
      }, { once: true });
    }

    // Update visual playhead — map current buffer position to the nearest
    // particle by comparing grainStart times rather than using a linear fraction.
    // This ensures the playhead tracks accurately even with non-uniform painting.
    const actx = ensureAudioContext();
    const elapsed = (actx.currentTime - seq._startedAt) * Math.abs(seq.speed);
    const loopLen = seq.loopEnd - seq.loopStart;
    if (loopLen > 0 && seq.particles.length > 0) {
      // ── Loop-wrap LED ────────────────────────────────────────────────
      // A looping trigger restarting is the same musical event as it
      // launching — a sample starting — so it gets the same stab. The wrap
      // index falls straight out of the playhead maths below; nothing extra
      // is computed for it. Detection is one scheduler tick late at worst
      // (20 ms), which is under the threshold for seeing a light late.
      //
      // Scoped to triggers whose dwell is actually 'loop': a one-shot's
      // `elapsed` keeps growing past loopLen after the audio has stopped, so
      // without this it would report phantom wraps in the window before the
      // 'ended' event clears `playing`.
      // Slots with a baked pass count (#239) need the same wrap edge; their
      // source always loops, so elapsed % loopLen is real and the one-shot
      // phantom-wrap caveat above doesn't apply to them.
      const selfKilling = !seq.trigger && (seq.passes | 0) > 0;
      if ((seq.trigger && S.triggerParams.dwell === 'loop') || selfKilling) {
        const wrapIdx = Math.floor(elapsed / loopLen);
        if (seq._wrapIdx === undefined) seq._wrapIdx = wrapIdx;
        else if (wrapIdx > seq._wrapIdx) {
          seq._wrapIdx = wrapIdx;
          if (seq.trigger) {
            S._ledTriggerFire?.();
            // THE SEAM IS WHERE A LIVE TAKE IS RE-CUT (Ek, 2026-09-22: "i
            // expect as much as possible to work (in audition mode) immediately
            // or on the next loop … i leave my cursor on the stroke and option
            // lock the screen. so it never retriggers").
            //
            // Speed and level ride the running node (trigger.js
            // `_applyLiveParams`). Reverse and pitch cannot: both are BAKED
            // INTO the region the source plays — a reversed copy, or one
            // stretched by the pitch ratio — so the only way to follow them is
            // to cut it again. Dropping the nodes here lets the block above
            // rebuild on the next tick, which puts the change at the loop seam
            // rather than under the playhead. Under `dwell: loop` that was the
            // difference between "at the next loop" and never, because a loop
            // has no next fire to pick anything up at.
            if (_liveRecutReady(seq)) releaseSeqNodes(seq);
          }
          else {
            // Self-killing loop: each pass steps the gain down, and the pass
            // after the last releases the slot AND deletes its paint — the
            // loop was recorded promising to clean up after itself.
            const n = seq.passes | 0;
            if (wrapIdx >= n) {
              S._selfKillSlot?.(seq);
            } else if (seq._gainNode) {
              const g = _loopGain(seq) * (1 - wrapIdx / n);
              seq._lastVol = g;
              try { seq._gainNode.gain.setTargetAtTime(g, actx.currentTime, 0.05); } catch (_) {}
            }
          }
        }
      }
      const posInLoop = elapsed % loopLen;           // seconds into loop
      // An overdub take in flight on this master: at every wrap, what was
      // played so far comes back as a provisional layer (ui-presets.js
      // refreshLiveOverdub). The first tick after the press only sets the
      // origin — nothing has been played yet.
      if (S._overdubTake?.seq === seq) {
        const w = Math.floor(elapsed / loopLen);
        if (seq._ovdWrap === undefined) seq._ovdWrap = w;
        else if (w !== seq._ovdWrap) { seq._ovdWrap = w; S._overdubLiveWrap?.(); }
      }
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
          cameraRotateInto(spWx, spWy, spWz, _grainScratchC);
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
            // Update all speakers — bracketing pair + spread to others — but
            // only when the pair or a weight moved: a pinned loop's anchor
            // does not, so this was N timeline events per loop per tick.
            const L = seq._vbapLast || (seq._vbapLast = { a: -1, b: -1, wa: -1, wb: -1, sp: -1 });
            if (L.a !== idxA || L.b !== idxB || Math.abs(L.wa - spWA) > 1e-4 || Math.abs(L.wb - spWB) > 1e-4 || Math.abs(L.sp - spSpread) > 1e-4) {
              L.a = idxA; L.b = idxB; L.wa = spWA; L.wb = spWB; L.sp = spSpread;
              for (let si = 0; si < spN; si++) {
                let target;
                if (si === idxA)       target = spWA;
                else if (si === idxB)  target = spWB;
                else                   target = spSpread;
                seq._vbapGains[si].gain.setTargetAtTime(target, _panNow, _panRampTau);
              }
            }
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

