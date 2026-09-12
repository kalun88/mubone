// ============================================================================
// paint-ticker.js — Fixed-rate particle deposit clock
//
// Drops a particle at the current cursor position every N milliseconds while
// painting.  The interval is adjustable at runtime via S.paintTicker.intervalMs
// (editable from the perf-monitor dropdown or DevTools console).
//
// A single setInterval at 200Hz polls whether enough time has elapsed since
// the last deposit.  The high poll rate ensures deposit timing stays tight
// regardless of input source (IMU at 400Hz, mouse at 30fps, etc.).
//
// All camera modes (sensor, steer, surface) share one code path — the tick
// just reads the latest cursor position and deposits if the clock says go.
// A LIVE mark lands one tick after its capture, sized by the audio in between
// — see "Deposit one tick behind" below.
// ============================================================================

import { S, SAMPLE_PAINT_COLORS, LIVE_PAINT_COLORS, gp, minGrainDurS } from './state.js';
import { getCursorLonLat, screenToLonLat } from './sphere.js';
import { rand, stampCartesian } from './grain.js';
import { getRecordingDuration } from './audio.js';
import { voicingForCurrentBrushLive } from './brush-voicing.js';
import { snapshotInputFeatures, featuresFromBuffer, readGateLoudness, snapshotTimbre, consumeWindowLoudness } from './audio-features.js';

// ── Defaults ────────────────────────────────────────────────────────────────

const _DEF_INTERVAL_MS = 50;   // 20 Hz — deposit every 50ms while painting

// Poll rate — high enough for sub-ms jitter on the deposit clock.
const TICK_HZ = 200;
const TICK_MS = 1000 / TICK_HZ;

// ── State ───────────────────────────────────────────────────────────────────

let _lastDepositMs  = 0;
let _wasPainting    = false;
let _intervalId     = null;

// ── Deposit one tick behind (Ek, 2026-09-02) ────────────────────────────────
// A live mark is SIZED BY THE AUDIO AFTER IT: the window from its own tick to
// the next, because that is what its grain plays. So a live deposit does not
// push a mark; it captures one — position, moment, brush, timbre — as
// `_pending`, and the mark is materialised at the NEXT tick with the loudness
// measured in between (audio-features.js, consumeWindowLoudness). The paint
// gate decides on that same window, so a silent stretch leaves nothing rather
// than a mark that appears and vanishes. The last mark settles when the stroke
// ends, and stopLiveRecording() settles it before sealing so a loop or trigger
// built straight after the stop has it.
//
// Before this the loudness looked BACKWARD — a peak-hold filled by the render
// loop and emptied at each deposit covered the audio between the previous
// mark and the last frame before this one — while the grain played forward
// from the mark. Measured on the rig: the mark whose grain held a hit read
// quiet and the mark one or two later read loud. Deposit rate did not matter;
// the two never overlapped at any rate. The gate lookback that backdated the
// first mark after silence is gone with it: the mark whose window holds the
// transient already starts before it.
let _pending = null;   // { particle, c } — the live mark captured at the last tick
// The sampler trigger stroke's own clock (see the takeT stamp in _deposit):
// zeroed at the first deposit of each stroke.
let _trigT0 = 0;
let _trigT0Stroke = -1;

// ── Read configured interval ────────────────────────────────────────────────

function _intervalMs() {
  return (S.paintTicker && S.paintTicker.intervalMs) ?? _DEF_INTERVAL_MS;
}

// A mark stores only its MOMENT in the take. Where the grain that plays it
// starts — early, so the moment sits at the envelope's peak — is the reader's
// arithmetic (grain-worklet-bridge.js, from brush-voicing.js grainPeakOffsetS),
// so it follows whichever engine reads the mark. The `align` numbox this
// replaced was a hand-set guess at that number.

// ── Cursor position helper ──────────────────────────────────────────────────

function _cursorLonLat() {
  if (S.cursorQ) return getCursorLonLat();
  return screenToLonLat(
    S.altLocked ? S.altFrozenMousePixelX : S.mousePixelX,
    S.altLocked ? S.altFrozenMousePixelY : S.mousePixelY
  );
}

// ── Core deposit function ───────────────────────────────────────────────────
// Creates a particle at the current cursor position with audio feature snapshot.

/**
 * The brush head (#218): scatter a mark across the head's band instead of
 * depositing exactly on the path. STATIC per brush — the paint quality is
 * predetermined, the hand only supplies the path.
 *
 * hard: uniform over the disc (sqrt(u) radial draw — even coverage, crisp rim)
 * soft: folded-gaussian radial draw, σ = width/2, clamped at 2σ — dense core,
 *       sparse skirt.
 * The longitude offset is corrected by 1/cos(lat) so the band has constant
 * angular width everywhere but the poles (clamped — a brush at the pole
 * cannot be wider than the pole is).
 */
export function headOffset(lon, lat, widthDeg, edge) {
  if (!(widthDeg > 0)) return { lon, lat };
  const W = widthDeg * Math.PI / 180;
  const theta = Math.random() * 2 * Math.PI;
  let r;
  if (edge === 'hard') {
    r = Math.sqrt(Math.random()) * W;
  } else {
    // Box–Muller, folded and clamped: |N(0, W/2)| capped at W.
    const u = Math.max(1e-9, Math.random());
    const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
    r = Math.min(W, Math.abs(g) * W * 0.5);
  }
  const dLat = r * Math.sin(theta);
  const dLon = r * Math.cos(theta) / Math.max(0.2, Math.cos(lat));
  return { lon: lon + dLon, lat: Math.max(-1.55, Math.min(1.55, lat + dLat)) };
}

// ── The splatter brush (#218 experimental) ──────────────────────────────────
// The one brush whose head is DYNAMIC — and that dynamism is its predetermined
// contract, chosen like any other brush, not a mode over the pen. Two levers,
// both from data already in hand at deposit time (no new sensor taps):
//   speed — cursor velocity between deposits. A flick throws paint: scatter
//           widens with speed AND marks are flung forward along the motion.
//   voice — the mark's own rms (the mic is the pressure a body sensor lacks):
//           playing louder loads the brush, widening the band.
// Slow quiet painting converges on a thin line; a loud flick is a splash.
// Constants below are rig-tunable; nothing here persists yet.
const SPLAT_SPEED_W   = 0.10;  // ° of width per °/s of cursor speed
const SPLAT_SPEED_MAX = 16;    // width cap from speed (°)
const SPLAT_VOICE_W   = 40;    // ° of width per unit rms
const SPLAT_VOICE_MAX = 10;    // width cap from voice (°)
const SPLAT_THROW     = 0.06;  // forward fling: ° per °/s, capped below
const SPLAT_THROW_MAX = 10;

let _dh = { lon: 0, lat: 0, t: 0, has: false };

export function resetDynamicHead() { _dh.has = false; }

/** @param nowMs injectable for tests; defaults to the wall clock. */
export function dynamicHeadOffset(lon, lat, rms, nowMs) {
  const now = nowMs ?? performance.now();
  let speedDegS = 0, dirLon = 0, dirLat = 0;
  if (_dh.has) {
    const dt = (now - _dh.t) / 1000;
    if (dt > 0.005) {
      const dLon = (lon - _dh.lon) * Math.cos(lat);
      const dLat = lat - _dh.lat;
      const dist = Math.hypot(dLon, dLat);
      speedDegS = (dist / dt) * 180 / Math.PI;
      if (dist > 1e-6) { dirLon = dLon / dist; dirLat = dLat / dist; }
    }
  }
  _dh.lon = lon; _dh.lat = lat; _dh.t = now; _dh.has = true;

  const W = 1 + Math.min(SPLAT_SPEED_MAX, speedDegS * (S.fx?.splatSpread ?? SPLAT_SPEED_W))
              + Math.min(SPLAT_VOICE_MAX, (rms || 0) * SPLAT_VOICE_W);
  const o = headOffset(lon, lat, W, 'soft');
  // Forward fling — thrown paint lands ahead of the brush, not around it.
  const throwDeg = Math.min(SPLAT_THROW_MAX, speedDegS * (S.fx?.splatThrow ?? SPLAT_THROW)) * Math.random();
  const tr = throwDeg * Math.PI / 180;
  return { lon: o.lon + dirLon * tr / Math.max(0.2, Math.cos(lat)),
           lat: Math.max(-1.55, Math.min(1.55, o.lat + dirLat * tr)) };
}

// ── The concat brush (#218 experimental, CataRT-style) ──────────────────────
// Paint with your own corpus, steered by your voice. Every mark on the sphere
// already carries a descriptor frame (rms / centroid / zcr, stamped at its own
// deposit); the concat brush matches the LIVE input's frame against that
// corpus and deposits a mark pointing at the best-matching MOMENT of material
// already played — by value, never by reference (the E9 lesson). Sing bright
// over a dark region and the brush digs your bright moments out of the whole
// sphere and lays them under the cursor. No voice → no target → no deposit
// (the paint gate already encodes that rule). Runs at the 50 ms deposit tick,
// never on the scheduler — a linear scan of the corpus is fine there.
const CONCAT_W_RMS  = 1 / 0.25;   // descriptor-space normalisation
const CONCAT_W_CENT = 1 / 6000;
const CONCAT_W_ZCR  = 1.0;

export function concatMatch(feat) {
  if (!feat) return null;
  let best = null, bd = Infinity;
  for (let i = 0; i < S.particles.length; i++) {
    const p = S.particles[i];
    if (p.trig || p.rms === undefined) continue;         // playable corpus only
    const dr = (p.rms - feat.rms) * CONCAT_W_RMS;
    const dc = (p.centroid - feat.centroid) * CONCAT_W_CENT;
    const dz = ((p.zcr ?? 0) - (feat.zcr ?? 0)) * CONCAT_W_ZCR;
    const d = dr * dr + dc * dc + dz * dz;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function _depositConcat(lon, lat) {
  const feat = S._concatTarget ?? snapshotInputFeatures();
  if (!feat) return null;
  if (S.paintGateThreshold > 0 && feat.rms < S.paintGateThreshold && !S._recordingTrigger) return null;
  const u = concatMatch(feat);
  if (!u) return null;
  // Values copied from the matched unit — its buffer, its moment, its frame.
  return {
    lon, lat,
    strokeId:       S.currentStrokeId,
    lastTriggeredAt: undefined,
    _vo:            S.currentVoicing ?? 0,
    source:         u.source,
    liveBufferIdx:  u.liveBufferIdx,
    sampleIndex:    u.sampleIndex,
    grainStart:     u.grainStart,
    grainDuration:  u.grainDuration,
    rms: u.rms, centroid: u.centroid, zcr: u.zcr,
    color:          '#81c784',
  };
}

// ── The comb brush (#218 experimental, CataRT-style layout) ─────────────────
// The path stays; the phrase redistributes. Today a stroke's layout IS its
// timeline — mark i sits where the cursor was at moment i. The comb breaks
// that: the drawn polyline is kept as pure GEOMETRY, and the stroke's marks
// are continuously re-sorted along it by an audio feature (bright at the
// front, dark at the back — the axis is the brush's contract). While both
// the hand and the voice are going, the stroke live-arranges itself; at
// release it freezes like any material. Sweeping it later scrubs the phrase
// by feature, not by time. The `keep` sieve drops non-qualifying material
// entirely — filter and layout are the two halves Ek asked for.
// Re-layout runs at the 50 ms deposit tick (sort + arc-walk over one
// stroke's marks), never on the scheduler.
const COMB_THRESH = { centroid: 2200, rms: 0.09, zcr: 0.3 };  // sieve splits, rig-tunable

const _comb = { strokeId: -1, path: [], total: 0, marks: [] };

export function resetComb() {
  _comb.strokeId = -1; _comb.path.length = 0; _comb.total = 0; _comb.marks.length = 0;
}

export function combAccept(feat) {
  if (S.combKeep === 'all' || !feat) return true;
  const v = feat[S.combAxis] ?? 0;
  const t = COMB_THRESH[S.combAxis];
  return S.combKeep === 'high' ? v >= t : v < t;
}

function _combPathAt(s) {
  const P = _comb.path;
  for (let i = 1; i < P.length; i++) {
    if (P[i].cum >= s) {
      const a = P[i - 1], b = P[i];
      const f = (s - a.cum) / Math.max(1e-9, b.cum - a.cum);
      return { lon: a.lon + (b.lon - a.lon) * f, lat: a.lat + (b.lat - a.lat) * f };
    }
  }
  return P[P.length - 1];
}

export function combLayout() {
  const ms = _comb.marks;
  if (ms.length < 2 || _comb.path.length < 2 || _comb.total <= 0) return;
  const axis = S.combAxis;
  const sorted = ms.slice().sort((a, b) => (b[axis] ?? 0) - (a[axis] ?? 0));
  for (let j = 0; j < sorted.length; j++) {
    const pt = _combPathAt(_comb.total * j / (sorted.length - 1));
    sorted[j].lon = pt.lon; sorted[j].lat = pt.lat;
    stampCartesian(sorted[j]);
  }
}

export function combDeposit(particle, c) {
  if (_comb.strokeId !== S.currentStrokeId) { resetComb(); _comb.strokeId = S.currentStrokeId; }
  const P = _comb.path;
  const last = P[P.length - 1];
  const gap = last
    ? Math.hypot((c.lon - last.lon) * Math.cos(c.lat), c.lat - last.lat) : 0;
  if (!last || gap > 0.004) {
    P.push({ lon: c.lon, lat: c.lat, cum: last ? last.cum + gap : 0 });
    _comb.total = P[P.length - 1].cum;
  }
  _comb.marks.push(particle);
  combLayout();
  S._particleVersion++;   // positions moved — spatial caches must rebuild
}

// ── staff (#218 experimental, round two) ────────────────────────────────────
// The path supplies LONGITUDE ONLY; latitude comes from the feature, so
// brightness notates itself vertically and the sphere becomes a spectrogram
// you played. Comb's sibling — comb sorts along the line, staff displaces
// perpendicular to it. Log-mapped over ~6 octaves of centroid.
//
// UNITS (fixed 2026-08-29, Ek: "staff doesn't work, I just see it deposit at
// the bottom"). staffLat's endpoints are HERTZ, but `feat.centroid` is the
// NORMALISED centroid audio-features.js publishes — mean bin over bin count,
// i.e. a fraction of Nyquist, and never more than 1. Clamping that against
// 110 Hz pinned every mark to the floor of the range, which is the bottom of
// the sphere, for every sound. The conversion is one multiply and it has to
// happen here rather than at the call site: `centroid` is normalised
// everywhere else in the app (featuresToColor, the viz hue, the patch table),
// and this is the only consumer that wants Hz.
const STAFF_LO_HZ  = 110, STAFF_HI_HZ = 7040;   // 6 octaves → lat ±0.9

export function staffLat(centroidNorm) {
  const lo = S.fx?.staffLo ?? STAFF_LO_HZ, hi = S.fx?.staffHi ?? STAFF_HI_HZ;
  const nyquist = (S.audioCtx?.sampleRate ?? 48000) / 2;
  const hz = (centroidNorm || 0) * nyquist;
  const c = Math.max(lo, Math.min(hi, hz || lo));
  const f = Math.log2(c / lo) / Math.log2(hi / lo);
  return (f * 2 - 1) * 0.9;
}

// echo, chop and pour were cut on 2026-08-29 (Ek: "remove echo, remove chop
// and pour"). git log --diff-filter=D finds them; the reasoning for each is in
// docs/EXPERIMENTAL-BRUSHES.md, which now records why they went rather than
// how they worked.

/** Materialise the live mark captured at the previous tick, sized by the
 *  window that has elapsed since. Returns true if a mark was pushed. Safe to
 *  call with nothing pending. Registered on S as _settlePaintPending so
 *  stopLiveRecording() can settle the last mark before the take seals. */
function _settlePending() {
  const pend = _pending;
  if (!pend) return false;
  _pending = null;
  const particle = pend.particle;
  const rms = consumeWindowLoudness();
  // HIT material is never gated (Ek, 2026-09-04): a line is a path you swipe
  // across to fire it, and a gap in the path is a place it cannot be fired
  // from. The marks are the drawing; the take is the material, whole. The
  // grain engine keeps the gate — there, a mark IS the material.
  if (S.paintGateThreshold > 0 && rms < S.paintGateThreshold && !S._recordingTrigger) return false;
  particle.rms = rms;
  // The take remembers the span its KEPT marks cover, so a region built from
  // the BUTTON can tell an untouched stroke from one erase has trimmed. Here,
  // at the settle, not at the deposit: a mark still pending at the release
  // is dropped, and it must not widen the span.
  const _take = particle.source === 'live' ? S.liveRecBuffers[particle.liveBufferIdx] : null;
  if (_take) { const g = particle.grainStart; if (!_take.markSpan) _take.markSpan = [g, g]; else { if (g < _take.markSpan[0]) _take.markSpan[0] = g; if (g > _take.markSpan[1]) _take.markSpan[1] = g; } }
  const feat = { rms, centroid: particle.centroid, zcr: particle.zcr };
  if (!particle.trig) {
    // The comb's sieve — non-qualifying material never lands at all.
    if ((S.brushFx === 'comb') && !combAccept(feat)) return false;
    // staff — the voice supplies the latitude, the hand only the longitude.
    if (S.brushFx === 'staff') particle.lat = staffLat(particle.centroid);
  }
  // A take sealed between this mark's tick and now is shorter than the mark
  // thinks; keep the mark inside it. (The worklet would fit the grain anyway.)
  const slot = S.liveRecBuffers[particle.liveBufferIdx];
  if (slot?.buffer && particle.grainStart > slot.buffer.duration - 0.01) {
    particle.grainStart = Math.max(0, slot.buffer.duration - 0.01);
  }
  stampCartesian(particle);
  S.particles.push(particle);
  S._particleVersion++;
  if ((S.brushFx === 'comb') && !particle.trig) combDeposit(particle, pend.c);
  return true;
}
S._settlePaintPending = _settlePending;

function _depositParticle() {
  if (!S.isPainting) return false;

  const c = _cursorLonLat();
  // A line is a PATH by contract (§ 1d — its marks are index, not onsets), so
  // the head never scatters a trigger stroke; the pen and a stamp both take it.
  // The splatter brush substitutes its dynamic head for the static one.
  let lon, lat;
  if (S._recordingTrigger) {
    ({ lon, lat } = c);
  } else if ((S.brushFx === 'spray')) {
    const feat0 = S.isRecording ? readGateLoudness() : null;
    ({ lon, lat } = dynamicHeadOffset(c.lon, c.lat, feat0 ?? 0));
  } else {
    ({ lon, lat } = headOffset(c.lon, c.lat, S.headWidthDeg, S.headEdge));
  }
  const gpr = gp();
  const durVariation = rand(-gpr.durJitter * 0.5, gpr.durJitter * 0.5);

  let particle = null;

  if ((S.brushFx === 'match') && !S._recordingTrigger) {
    // Concat takes the deposit whatever else is running — a recording may be
    // rolling underneath (it keeps growing the corpus for later), but the
    // marks this brush lays down point at MATCHED moments, not at now.
    particle = _depositConcat(lon, lat);
  } else if (S.isRecording && S.currentLiveBufferIdx >= 0) {
    // Settle the mark captured last tick — its window ends now — THEN capture
    // this one, so the next window starts empty at this instant.
    const settled = _settlePending();
    const recTime = getRecordingDuration();
    const timbre  = snapshotTimbre();
    const p = {
      lon, lat,
      strokeId:       S.currentStrokeId,
      lastTriggeredAt: undefined,
      // Which frozen brush setting plays this mark. Stamped from the stroke,
      // not resolved per particle — an int the scheduler reads directly, since
      // it is touched once per candidate per 20 ms tick.
      _vo:            S.currentVoicing ?? 0,
      grainDuration:  Math.max(minGrainDurS(), gpr.duration + durVariation),
      source:         'live',
      liveBufferIdx:  S.currentLiveBufferIdx,
      grainStart:     recTime,            // the moment; the reader offsets
      // An overdub's marks wear its MASTER's colour, so the sphere shows the family.
      color:          S._overdubTake?.seq?.color ?? LIVE_PAINT_COLORS[S.liveColorIndex % LIVE_PAINT_COLORS.length],
      // Colour is the audio at the mark's moment; size arrives at the next tick.
      centroid:       timbre?.centroid ?? 0,
      zcr:            timbre?.zcr ?? 0,
    };
    if (S._recordingTrigger) p.trig = true;
    _pending = { particle: p, c };
    return settled;
  } else if (S.sourceKind === 'sampler' && S.samples[S.samplerIndex]?.buffer) {
    const s         = S.samples[S.samplerIndex];
    const cropStart = s.cropStart * s.duration;
    const cropEnd   = s.cropEnd   * s.duration;
    const cropLen   = cropEnd - cropStart;
    let rawStart    = s.grainCursor;
    if (cropLen > 0) rawStart = cropStart + ((rawStart - cropStart) % cropLen + cropLen) % cropLen;
    let clampedStart = Math.max(cropStart, Math.min(rawStart, cropEnd - 0.01));
    let grainDur     = Math.max(minGrainDurS(), gpr.duration + durVariation);
    // A grain that doesn't fit the remaining tail starts the NEXT pass
    // instead of being squeezed against cropEnd — the old clamp shrank the
    // per-pass boundary grain toward the 10 ms floor, baking a click into
    // the material at every wrap of a long grain stroke. When the crop is shorter
    // than one grain the same rule degenerates cleanly: every grain lands
    // at the top and IS the whole crop, uniform rather than rump-sized.
    // Trigger strokes keep the clamp (one-pass rule above; region playback
    // ignores mark durations).
    if (!S._recordingTrigger && clampedStart + grainDur > cropEnd) {
      clampedStart  = cropStart;
      s.grainCursor = cropStart;
    }
    grainDur = Math.max(minGrainDurS(), Math.min(grainDur, cropEnd - clampedStart));

    particle = {
      lon, lat,
      strokeId:       S.currentStrokeId,
      lastTriggeredAt: undefined,
      // Which frozen brush setting plays this mark. Stamped from the stroke,
      // not resolved per particle — an int the scheduler reads directly, since
      // it is touched once per candidate per 20 ms tick.
      _vo:            S.currentVoicing ?? 0,
      source:         'sample',
      sampleIndex:    S.samplerIndex,
      grainStart:     clampedStart,
      grainDuration:  grainDur,
      color:          SAMPLE_PAINT_COLORS[S.samplerIndex % SAMPLE_PAINT_COLORS.length]
    };
    // Loop-engine strokes outliving the sample LOOP it (Ek, 2026-08-28):
    // grainStart wraps at the crop seam, so it cannot order the path — a
    // grainStart-sorted outline interleaved the passes and drew as a mesh of
    // chords. takeT is the stroke's own clock (elapsed hold time, the exact
    // analogue of a live stroke's grainStart), monotonic across passes;
    // trigger.js orders and segments by it and keeps grainStart for audio.
    if (S._recordingTrigger) {
      if (_trigT0Stroke !== S.currentStrokeId) {
        _trigT0Stroke = S.currentStrokeId;
        _trigT0 = performance.now();
      }
      particle.takeT = (performance.now() - _trigT0) / 1000;
    }
    const feat = featuresFromBuffer(s.buffer, clampedStart);
    if (feat) {
      particle.rms = feat.rms; particle.centroid = feat.centroid; particle.zcr = feat.zcr;
      // The fx sieves read the FILE's features where the live branch reads the
      // mic — any brush paints from the sampler (#247 step 11). No paint gate
      // and no gate lookback here: those are properties of a live signal.
      if ((S.brushFx === 'comb') && !combAccept(feat)) particle = null;
      if (particle && S.brushFx === 'staff') particle.lat = staffLat(feat.centroid);
    }

    // A loop-engine stroke hears the sample "playing in" at 1× — the cursor
    // advances one tick of sample time per tick of real time, so the marks'
    // positions and features match the take the stroke materializes on
    // release (sampler.js). Spray keeps the grain-period stride: its cursor
    // is a grain-stream read head, not a playback head.
    const stride = S._recordingTrigger
      ? (S.paintTicker?.intervalMs ?? 50) / 1000
      : gpr.period * rand(0.8, 1.2);
    s.grainCursor += stride;
    if (s.grainCursor > cropEnd) s.grainCursor = cropStart + ((s.grainCursor - cropStart) % cropLen);
  }

  if (particle) {
    // Trigger-vs-granular is decided before recording starts and is stamped
    // onto the material itself, not held in app state: whenever the cursor
    // touches this particle it does what it was recorded as. The granular
    // candidate-pool builders skip `trig` particles — never both.
    if (S._recordingTrigger) particle.trig = true;
    stampCartesian(particle);
    S.particles.push(particle);
    S._particleVersion++;
    // The comb re-arranges the stroke-so-far along the drawn path — after
    // the push, so the new mark takes part in its own layout.
    if ((S.brushFx === 'comb') && !particle.trig &&
        (particle.source === 'live' || particle.source === 'sample')) combDeposit(particle, c);
    return true;
  }
  return false;
}

// ── Tick ─────────────────────────────────────────────────────────────────────
// 200Hz poll — deposits when the fixed clock interval has elapsed.

// Only a granular stroke has a voicing; a `hit` stroke would intern a row
// nothing ever reads, and the voicing table is persisted.
function _refreshVoicing() {
  if (!(S.currentStrokeId > 0)) return;
  if (S._currentMaterial?.() !== 'grain') return;
  S.currentVoicing = voicingForCurrentBrushLive();
}

function _tick() {
  if (!S.isPainting) {
    if (_wasPainting) {
      _wasPainting = false;
      // The stroke's last mark: its window ends with the stroke.
      _settlePending();
      // A new stroke must not compute its first velocity against the end of
      // the previous one — a big reposition would read as a monster flick.
      // The comb likewise freezes: its layout is final at release.
      resetDynamicHead();
      resetComb();
    }
    return;
  }

  const nowMs = performance.now();

  // Painting just started — deposit immediately
  if (!_wasPainting) {
    _wasPainting = true;
    _lastDepositMs = nowMs;
    _refreshVoicing();
    _depositParticle();
    return;
  }

  const interval = _intervalMs();
  if (nowMs - _lastDepositMs >= interval) {
    // Re-freeze before depositing, so a param that moved since the last mark
    // is what THIS mark bakes. A stroke can carry several voicings and nothing
    // minds — the worklet buckets by particle, never by stroke — so a stroke
    // painted while a gesture sweeps the period plays back with that sweep
    // baked into it, the same way a widening head is baked into its spread.
    _refreshVoicing();
    _depositParticle();
    _lastDepositMs = nowMs;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export function startPaintTicker() {
  if (_intervalId != null) return;
  _intervalId = setInterval(_tick, TICK_MS);
}

export function stopPaintTicker() {
  if (_intervalId != null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  _wasPainting = false;
}

export function getPaintTickerState() {
  return {
    intervalMs:        _intervalMs(),
    depositRateHz:     1000 / _intervalMs(),
    timeSinceDepositMs: performance.now() - _lastDepositMs,
    tickHz:            TICK_HZ,
    running:           _intervalId != null,
  };
}
