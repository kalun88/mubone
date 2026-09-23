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

import { S, SAMPLE_PAINT_COLORS, gp, minGrainDurS } from './state.js';
import { cursorLonLatNow } from './sphere.js';
import { rand, stampCartesian } from './grain.js';
import { getRecordingDuration } from './audio.js';
import { voicingForCurrentBrushLive } from './brush-voicing.js';
import { snapshotInputFeatures, featuresFromBuffer, snapshotTimbre, consumeWindowLoudness, recordedWindowLoudness, featuresToColor } from './audio-features.js';

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

// ── ONE MEANING FOR COLOUR ON THE SPHERE (Ek, 2026-09-13) ───────────────────
// "let's make the line also colour based on the same timbre setting as grains
// so colour now means the same thing across the sphere."
//
// A mark has always been DRAWN from its own features — the renderer computes
// `featuresToColor(centroid, zcr)` per particle, for tape and grain alike, and
// `p.color` is only the fallback for a mark with no features at all. What did
// NOT follow was the live recording trail and its launch ring: they wore the
// tool's engine hue, and so said "tape" where everything under them said what
// the audio sounded like.
//
// The ink is computed once per deposited mark, from that mark's own timbre,
// and published on `S._liveInk` for the renderer to draw the trail in — so the
// trail is the colour of the material it is laying down. Hue is centroid,
// saturation is zcr, everywhere, whichever tool is in the hand. Tool identity
// lives in the palette and the rail, not out here.
//
// One lookup per mark — featuresToColor is memoised on a quantised grid — so
// none of this lands on the render path.
function _liveInk(timbre) {
  const c = timbre?.tilt ?? 0;      // the band tilt IS the hue axis, already 0–1
  const ink = featuresToColor(c, timbre?.noise ?? 0);
  S._liveInk = ink;
  return ink;
}

function _intervalMs() {
  return (S.paintTicker && S.paintTicker.intervalMs) ?? _DEF_INTERVAL_MS;
}

// A mark stores only its MOMENT in the take. Where the grain that plays it
// starts — early, so the moment sits at the envelope's peak — is the reader's
// arithmetic (grain-worklet-bridge.js, from brush-voicing.js grainPeakOffsetS),
// so it follows whichever engine reads the mark. The `align` numbox this
// replaced was a hand-set guess at that number.

// ── Cursor position — the ONE rule, sphere.js cursorLonLatNow ──────────────
// This used to read the pointer wherever it was; with it resting on a rail
// the marks went to its last projection while the scan read the centre.
const _cursorLonLat = cursorLonLatNow;

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

// (SPRAY WAS HERE, and it is gone — 2026-09-22, Ek: "removing spray, sunsetting
//  it, it's too complicated to have dynamic spray, no paint apps like procreate
//  do it. i need to remember this is not an app to do visual painting.")
//
//  It was a dynamic head: one 0…1 amount that widened the scatter with cursor
//  speed and with the voice's own rms, and flung each mark forward along the
//  motion. Two of those three were the old `splatter` brush's sliders, kept
//  when the brush became a number earlier the same day.
//
//  What sank it is not that it worked badly — it is that it was answering a
//  question from the wrong instrument. A painting app has no equivalent and
//  the reason is the point: scattering paint is a LOOK, and here a mark's
//  position is where its grain SOUNDS FROM. Width is spatial, so it is
//  audible, and the question that has to come first is whether spreading the
//  material wider is musical at all — not how to make the spread respond to
//  the hand. Speed and loudness were being mapped to a quality nobody had yet
//  decided the value of.
//
//  `S.headWidthDeg` and `S.headEdge` stay, and `headOffset` above is the whole
//  head again: static, set on the sheet, the hand supplies only the path.
//  Whether they earn their keep — and how wide is musical — is the open
//  question this deletion clears the ground for.

// `centroid` IS A FRACTION OF NYQUIST, NOT HERTZ (2026-09-13). The comb's sieve
// was written against a centroid in Hz and never re-scaled, which is the same
// unit bug docs/EXPERIMENTAL-BRUSHES.md writes up for `staff` — it compared
// 0.02…0.4 against 2200, so `keep: high` accepted NOTHING and `keep: low`
// accepted everything. The sort in combLayout is scale-free, so the brush
// looked half-working, which is how it survived. (The concat brush `match` had
// the same bug and the same fix; it was deleted 2026-09-22.)
const _centHz = c => (c || 0) * ((S.audioCtx?.sampleRate ?? 48000) / 2);

// THE COMB IS GONE (Ek, 2026-09-22): "let's sunset the sort by and remove the
// index preset". It kept a stroke's drawn path as pure geometry and re-sorted
// that stroke's marks ALONG it by an audio feature, live, so the line became a
// sorted index of what you played rather than a timeline. `combLayout`,
// `combDeposit`, `resetComb` and `S.combAxis` went together — the last of the
// #218 heads to leave, and the reason `_centHz` above now has no caller but is
// kept: it is the one place the app converts a normalised centroid to hertz,
// and the unit bug it documents is the worked example the docs point at.

// echo, chop and pour were cut on 2026-08-29 (Ek: "remove echo, remove chop
// and pour"), match on 2026-09-22, and STAFF the same day ("remove staff low
// and hi, and the staff setting") — it took latitude out of the hand's control
// entirely, which is the one thing a general shape param cannot do quietly
// behind every other shape. The deleted code is in the history; the reasoning
// for each is in docs/EXPERIMENTAL-BRUSHES.md, which now records why they went
// rather than how they worked.

/** The live mark captured at the previous tick has its window's END now: it
 *  joins the settle queue with `toS`, the recording moment the next mark (or
 *  the stroke's end) starts at, and is materialised by _flushSettled once the
 *  recorder has delivered the take up to there — the take's own samples over
 *  [its moment, toS) are what size it (audio-features.js
 *  recordedWindowLoudness). Returns true if a mark was pushed NOW. Safe to
 *  call with nothing pending. Registered on S as _settlePaintPending so
 *  stopLiveRecording() can settle the last mark before the take seals — that
 *  call forces, reading what has arrived. */
function _settlePending(toS, force = false) {
  const pend = _pending;
  if (!pend) return _flushSettled(force);
  _pending = null;
  // The analyser hold is consumed — reset — at every window's end whether or
  // not its value is used, so the fallback read below is ever the window's.
  pend.fold = consumeWindowLoudness();
  pend.toS = toS;
  _settling.push(pend);
  return _flushSettled(force);
}

// Marks whose window has ended, oldest first, waiting for the recorder to
// deliver their samples (~43 ms behind the clock). Flushed in order, so a
// stroke's marks are pushed in the order they were laid.
const _settling = [];
function _flushSettled(force = false) {
  let pushed = false;
  while (_settling.length) {
    const pend = _settling[0];
    let rms = recordedWindowLoudness(pend.particle.grainStart, pend.toS, force);
    if (rms === null) {
      if (!force) break;                  // not delivered yet — next tick
      rms = pend.fold;                    // nothing of it arrived: the fold's read
    }
    _settling.shift();
    if (_materialise(pend, rms)) pushed = true;
  }
  return pushed;
}

/** Push the settled mark, sized `rms`. Returns true if it landed. */
function _materialise(pend, rms) {
  const particle = pend.particle;
  // TAPE material is never gated (Ek, 2026-09-04): a line is a path you swipe
  // across to fire it, and a gap in the path is a place it cannot be fired
  // from. The marks are the drawing; the take is the material, whole. The
  // grain engine keeps the gate — there, a mark IS the material. So a tape
  // stroke deposits on EVERY tick, silence included, which is why its marks
  // cannot read the room for a colour (audio-features.js, _HOLD_UNDER).
  if (S.paintGateThreshold > 0 && rms < S.paintGateThreshold && !S._recordingTrigger) return false;
  particle.rms = rms;
  const feat = { rms, centroid: particle.centroid, zcr: particle.zcr };
  // The take remembers the span its KEPT marks cover, so a region built from
  // the BUTTON can tell an untouched stroke from one erase has trimmed. AFTER
  // every rejection, not before: the gate's return above honoured that and the
  // comb's did not, so a sieved-out mark still widened the span and the take
  // read as erase-trimmed for ever after — it then plays the mark-derived
  // region instead of press-to-release (trigger.js, ui-presets.js both test
  // `hiMark >= markSpan[1]`).
  const _take = particle.source === 'live' ? S.liveRecBuffers[particle.liveBufferIdx] : null;
  if (_take) { const g = particle.grainStart; if (!_take.markSpan) _take.markSpan = [g, g]; else { if (g < _take.markSpan[0]) _take.markSpan[0] = g; if (g > _take.markSpan[1]) _take.markSpan[1] = g; } }
  // A take sealed between this mark's tick and now is shorter than the mark
  // thinks; keep the mark inside it. (The worklet would fit the grain anyway.)
  const slot = S.liveRecBuffers[particle.liveBufferIdx];
  if (slot?.buffer && particle.grainStart > slot.buffer.duration - 0.01) {
    particle.grainStart = Math.max(0, slot.buffer.duration - 0.01);
  }
  stampCartesian(particle);
  S.particles.push(particle);
  S._particleVersion++;
  return true;
}
/** The recording's moment NOW — the clock while it records, the delivered end
 *  once it has stopped (the seal settles the last mark after `isRecording`
 *  has dropped). */
function _recNow() {
  if (S.isRecording) return getRecordingDuration();
  return S.recordingRaw && S.recordingSampleRate > 0 ? S.recordingWritePos / S.recordingSampleRate : 0;
}
S._settlePaintPending = () => _settlePending(_recNow(), true);

function _depositParticle() {
  if (!S.isPainting) return false;

  const c = _cursorLonLat();
  // A line is a PATH by contract (§ 1d — its marks are index, not onsets), so
  // the head never scatters a trigger stroke; the pen and a stamp both take it.
  // ONE HEAD PATH for every grain mark, and since spray went it is the static
  // one: `headOffset` with the sheet's own width and edge. The per-deposit
  // `readGateLoudness()` went with it — the voice term was its only reader
  // here, and this runs on every grain mark.
  const { lon, lat } = S._recordingTrigger
    ? c : headOffset(c.lon, c.lat, S.headWidthDeg, S.headEdge);
  const gpr = gp();
  const durVariation = rand(-gpr.durJitter * 0.5, gpr.durJitter * 0.5);

  let particle = null;

  if (S.isRecording && S.currentLiveBufferIdx >= 0) {
    // Settle the mark captured last tick — its window ends now, at THIS mark's
    // moment — THEN capture this one, so the next window starts at this instant.
    const recTime = getRecordingDuration();
    const settled = _settlePending(recTime);
    const timbre  = snapshotTimbre();
    const p = {
      lon, lat,
      strokeId:       S.currentStrokeId,
        // Which frozen brush setting plays this mark. Stamped from the stroke,
      // not resolved per particle — an int the scheduler reads directly, since
      // it is touched once per candidate per 20 ms tick.
      _vo:            S.currentVoicing ?? 0,
      grainDuration:  Math.max(minGrainDurS(), gpr.duration + durVariation),
      source:         'live',
      liveBufferIdx:  S.currentLiveBufferIdx,
      grainStart:     recTime,            // the moment; the reader offsets
      // An overdub's marks wear its MASTER's colour, so the sphere shows the family.
      // _liveInk's ONE job is the side effect of publishing S._liveInk for the
      // trail, and `??` short-circuited it away for the whole of an overdub —
      // so while dubbing, the marks wore the master's family colour and the
      // line joining them wore whatever index the legacy rotating palette had
      // reached. Ink first, choose second.
      color:          (ink => S._overdubTake?.seq?.color ?? ink)(_liveInk(timbre)),
      // Colour is the audio at the mark's moment; size arrives at the next tick.
      centroid:       timbre?.centroid ?? 0,
      // The hue axis: share of energy above 800 Hz. Separates vowels ~4×
      // better than centroid, which is kept for the comb sieve.
      tilt:           timbre?.tilt ?? 0,
      zcr:            timbre?.zcr ?? 0,
      // The SECOND colour axis: flatness with the brightness trend removed.
      // zcr stays for the comb sieve, which wants it.
      noise:          timbre?.noise ?? 0,
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
    // A tape stroke outliving the sample LOOPS it (Ek, 2026-08-28):
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
      // featuresFromBuffer carries the two colour axes now, so a sampler mark
      // is hued by the same rule as a live one instead of by the legacy
      // centroid fallback (which the LED did not share).
      particle.tilt = feat.tilt; particle.noise = feat.noise;
    }

    // A tape stroke hears the sample "playing in" at 1× — the cursor
    // advances one tick of sample time per tick of real time, so the marks'
    // positions and features match the take the stroke materializes on
    // release (sampler.js). A GRAIN stroke keeps the grain-period stride: its
    // cursor is a grain-stream read head, not a playback head.
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
    return true;
  }
  return false;
}

// ── Tick ─────────────────────────────────────────────────────────────────────
// 200Hz poll — deposits when the fixed clock interval has elapsed.

// Only a granular stroke has a voicing; a tape stroke would intern a row
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
      _settlePending(_recNow(), true);
      // (`resetDynamicHead()` was here until 2026-09-22. It cleared the
      //  velocity estimate so a new stroke did not read the reposition from
      //  the last one as a monster flick. The static head has no velocity.)
    }
    return;
  }

  const nowMs = performance.now();
  // A settled mark whose samples have arrived since the last poll lands now,
  // in order, a tick or two after its window closed.
  _flushSettled(false);

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

export function getPaintTickerState() {
  return {
    intervalMs:        _intervalMs(),
    depositRateHz:     1000 / _intervalMs(),
    timeSinceDepositMs: performance.now() - _lastDepositMs,
    tickHz:            TICK_HZ,
    running:           _intervalId != null,
  };
}
