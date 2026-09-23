// ============================================================================
// AUDIO-FEATURES — lightweight snapshot extraction for particle visualization
// Called ONCE per particle at paint time. Zero per-frame cost.
// ============================================================================

import { S } from './state.js';

// ── Reusable buffers (avoid GC pressure) ──────────────────────────────────────
// Sized to match inputAnalyser.fftSize (256 → 128 frequency bins).
const _timeBuf = new Float32Array(256);
const _freqBuf = new Uint8Array(128);

// ── Dedicated loudness analyser ───────────────────────────────────────────────
// S.inputAnalyser is fftSize 256 = 5.33ms of time-domain data at 48kHz, but
// tickPeakHold() runs inside the 30fps render gate — once every 33.3ms.  A read
// only ever sees the most recent fftSize samples, so 84% of the timeline was
// never observed at all and a percussive attack had roughly a 1-in-6 chance of
// being seen.  When it was missed the gate opened later on the decay instead,
// and the marker landed inside the tail rather than on the transient.
//
// This node exists purely so the window is longer than the sampling interval:
// 2048 samples = 42.7ms > 33.3ms, so consecutive reads overlap and no audio
// goes unwatched.  It is deliberately NOT a change to S.inputAnalyser, which is
// shared — handsfree.js sizes its buffer to 256 to match it, and a short array
// read against a large fftSize does not return the window you would expect.
//
// Spectral centroid and ZCR stay on the shared 256 analyser: they only feed
// particle colour, they are read when the gate is already open (so there IS
// signal), and moving them would shift every particle's colour for no gain.
const GATE_FFT_SIZE = 2048;
const _gateBuf = new Float32Array(GATE_FFT_SIZE);
let _gateAnalyser = null;
let _gateSource   = null;   // node we tapped — used to detect a graph rebuild

function _ensureGateAnalyser() {
  const src = S.inputGainNode;
  const ctx = S.audioCtx;
  if (!src || !ctx) return null;
  if (_gateAnalyser && _gateSource === src) return _gateAnalyser;
  // Device change / graph rebuild replaces inputGainNode — drop the stale tap.
  if (_gateAnalyser && _gateSource) {
    try { _gateSource.disconnect(_gateAnalyser); } catch (_) {}
  }
  let an;
  try {
    an = ctx.createAnalyser();
    an.fftSize = GATE_FFT_SIZE;
    an.smoothingTimeConstant = 0;   // time-domain reads only; no smoothing wanted
    src.connect(an);
  } catch (_) { return null; }
  _gateAnalyser = an;
  _gateSource   = src;
  return an;
}

// The gate's loudness metric. NOT plain RMS: a transient's RMS over a 43ms
// window is small while the hit itself is loud, so a percussive onset would
// slip under the threshold. Weighted peak catches it.
//
// Exported because the gate meter has to DRAW this, not RMS. Drawing RMS while
// thresholding this is what made the paint gate unreachable — above about
// −22 dBFS peak the tested value exceeded the meter's whole range, so turning
// the threshold to maximum still painted.
const PEAK_WEIGHT = 0.7;

export function gateLoudness(rms, peak) {
  return Math.max(rms, peak * PEAK_WEIGHT);
}

/** A fresh read of the metric the gate tests, for the meter to draw.
 *  Deliberately instantaneous rather than the peak-held value: the held pair is
 *  consumed by snapshotInputFeatures() at the paint rate, so drawing it would
 *  make the bar's shape depend on the drop interval. The meter has its own
 *  ballistics for hold. Returns null when there is no input graph yet. */
export function readGateLoudness() {
  const l = _readLoudness();
  return l ? gateLoudness(l.rms, l.peak) : null;
}

/** Peak + RMS over the LAST `n` samples of the gate analyser's window. */
function _readTail(an, n) {
  an.getFloatTimeDomainData(_gateBuf);
  let sumSq = 0, peak = 0;
  for (let i = GATE_FFT_SIZE - n; i < GATE_FFT_SIZE; i++) {
    const v = _gateBuf[i];
    sumSq += v * v;
    const abs = v < 0 ? -v : v;
    if (abs > peak) peak = abs;
  }
  return { peak, rms: Math.sqrt(sumSq / n) };
}

/** Peak + RMS over the gate analyser's full window. */
function _readLoudness() {
  const an = _ensureGateAnalyser();
  return an ? _readTail(an, GATE_FFT_SIZE) : null;
}

// ── Window loudness (2026-09-02) ─────────────────────────────────────────────
// A live mark is sized by the audio AFTER it — the window from its own tick to
// the next, which is what its grain plays (paint-ticker.js, "deposit one tick
// behind"). So the loudness a mark gets is "the loudest thing since the last
// mark", and measuring exactly that window is the whole job here:
//
//   - The gate analyser holds the last 43 ms. Reading all of it every frame
//     counted the same samples twice and reached 43 ms BACK past the window's
//     start, so a hit just before a mark leaked into the mark after it.
//     Each read now takes only the samples rendered since the previous read,
//     counted off the audio clock, so the union of reads is the window and
//     nothing else — at any frame rate, at any deposit rate. A frame longer
//     than 43 ms leaves a gap; that was true before too, and it is rarer than
//     a 33 ms frame overlapping.
//   - The hold is a plain max, consumed to ZERO at each mark. It used to decay
//     per frame (0.75) and reset to the live level, both of which made a
//     mark's size depend on when inside its window the sound happened.
//
// Measured before this: with 60 ms bursts at 50 ms deposit, the mark whose
// grain held the burst read 0.02 and the mark 1–1.5 later read 0.64. The
// best correlation between stored size and the take's envelope sat at −80 ms.
let _heldPeak     = 0;
let _heldRms      = 0;
let _lastReadTime = -1;     // audio-clock time of the last hold read

/** Peak + RMS of the samples rendered since the previous call (at most one
 *  analyser window). null when nothing new has rendered. */
function _readNewLoudness() {
  const an = _ensureGateAnalyser();
  const ctx = S.audioCtx;
  if (!an || !ctx) return null;
  const now = ctx.currentTime;
  let n = GATE_FFT_SIZE;
  if (_lastReadTime >= 0) {
    n = Math.round((now - _lastReadTime) * ctx.sampleRate);
    if (n > GATE_FFT_SIZE) n = GATE_FFT_SIZE;
  }
  _lastReadTime = now;
  if (n <= 0) return null;
  return _readTail(an, n);
}

function _foldIntoHold() {
  const l = _readNewLoudness();
  if (!l) return;
  if (l.peak > _heldPeak) _heldPeak = l.peak;
  if (l.rms  > _heldRms)  _heldRms  = l.rms;
}

/** Called every render frame (renderer.js) so the window is observed between
 *  marks. Deposit-rate independent: it only adds what has rendered since the
 *  previous read. */
export function tickPeakHold() { _foldIntoHold(); }

/** The window's loudness — the gate metric over everything rendered since the
 *  previous consumption — and reset, so the next window starts empty. */
export function consumeWindowLoudness() {
  _foldIntoHold();
  const rms = gateLoudness(_heldRms, _heldPeak);
  _heldPeak = 0;
  _heldRms  = 0;
  return rms;
}

// ── A window read off the TAKE ITSELF (2026-09-17) ──────────────────────────
// The analyser fold above sizes a window by WHEN the main thread got round to
// reading: each read takes "the last n samples" for the audio-clock time since
// the previous read, and under load the audio thread is a block or more ahead
// of the clock the main thread sees, so a burst's first samples leak into the
// window before it. Measured with the cursor granulating the take as it is
// painted (the normal case when you play): marks a frame clear of a burst read
// 0.10–0.15 against a 0.1 ceiling on every run, 70/70 clean at rest.
//
// A live mark's window is a span of the RECORDING, [its moment, the next
// mark's moment) — positions, not times — and the recorder delivers the take
// into S.recordingRaw by position. So the honest read is the take's own
// samples over that span, whatever any thread's clock said. The same law as
// the fold — the loudest ~32 ms inside the window (max sub-window RMS) against
// the peak — so a mark's size means what it meant.
//
// Returns null while the recorder has not yet delivered up to `toS` (its
// chunks arrive ~43 ms behind the clock), so the caller can wait a tick;
// `force` reads what has arrived — the stroke's last mark, at the seal.
const _WIN_SUB = 1536;   // ~32 ms at 48 kHz — the frame the fold read in
export function recordedWindowLoudness(fromS, toS, force = false) {
  const raw = S.recordingRaw, sr = S.recordingSampleRate;
  if (!raw || !(sr > 0)) return null;
  const a = Math.max(0, Math.floor(fromS * sr));
  let b = Math.floor(toS * sr);
  if (b > S.recordingWritePos) { if (!force) return null; b = S.recordingWritePos; }
  if (b <= a) return null;
  let peak = 0, maxRms = 0;
  for (let s = a; s < b; s += _WIN_SUB) {
    const e = Math.min(b, s + _WIN_SUB);
    let sumSq = 0;
    for (let i = s; i < e; i++) { const v = raw[i]; sumSq += v * v; const abs = v < 0 ? -v : v; if (abs > peak) peak = abs; }
    const rms = Math.sqrt(sumSq / (e - s));
    if (rms > maxRms) maxRms = rms;
  }
  return gateLoudness(maxRms, peak);
}

// ── Timbre at an instant ─────────────────────────────────────────────────────
// ── Byte → LINEAR magnitude (2026-09-13) ────────────────────────────────────
// getByteFrequencyData hands back DECIBELS mapped onto 0–255 between the
// analyser's minDecibels (−100) and maxDecibels (−30). Weighting bin indices by
// that byte computes the centroid of a LOG spectrum, which is not the spectral
// centroid and is badly compressed: a bin 40 dB below the peak still reads
// around half scale, so the skirt of any partial drags the mean toward the
// middle of the band. Measured before this fix: an 8 kHz sine, whose centroid
// must be 8000/24000 = 0.333, read 0.166 — half. A 220 Hz sine read 0.013
// against a true 0.009. Everything bunched near the centre, which is why voice
// and percussion painted nearly the same colour (Ek: "the colours weren't a
// wide range").
//
// Undoing the mapping restores a real centroid: dB = min + (b/255)(max − min),
// magnitude = 10^(dB/20). Done through a 256-entry table so the hot loop is a
// read, not a pow — this runs once per deposited mark, up to ~50/s. Byte 0 is
// "at or below the floor" and is exactly zero, so silence stays silent rather
// than contributing 10^(−5) of weight from every empty bin.
const _BYTE_MAG = (() => {
  const t = new Float32Array(256);
  const MIN_DB = -100, MAX_DB = -30;          // the analyser's own defaults
  for (let b = 1; b < 256; b++) {
    const db = MIN_DB + (b / 255) * (MAX_DB - MIN_DB);
    t[b] = Math.pow(10, db / 20);
  }
  return t;                                    // t[0] stays 0
})();
// ln of the same magnitudes, so SPECTRAL FLATNESS costs one table read and one
// add per bin inside the loop that already runs — no Math.log in the hot path.
// Byte 0 takes ln(FLAT_EPS), the floor, rather than −Infinity.
// ── NOISINESS: HOW MANY BINS ARE NEARLY AS LOUD AS THE LOUDEST ─────────────
// Ek: "i'm having a hard time accessing different colours, i just see orange,
// violet and sometimes blue." Measured, the first cause was that the two axes
// were ONE axis: centroid and zcr correlate at 0.95, so hue and saturation
// moved together and the colour space was a diagonal line rather than a plane.
// Every brightness-family feature is the same story — rolloff 1.00 with
// centroid, spread 0.98 — so swapping one for another changes nothing.
//
// Spectral flatness IS a real second axis and was the answer for a day. It
// does not survive a room. Flatness is a geometric mean over every bin, so it
// is decided by the EMPTIEST ones, and a broadband floor fills exactly those.
// Measured over eleven sounds captured from true digital silence, then again
// with room tone underneath:
//
//   quiet   tonal −2.73…−1.52   noisy −0.81…−0.29   gap 0.71
//   room    the floor moves a single sound by up to 2.21 — three times the gap
//
// In a room `ee` reads −0.48 and breath reads −0.41: the axis carries nothing.
// Gating flatness to the bins near the peak fixes the floor sensitivity and
// costs the whole gap with it (0.71 → 0.01). It is the wrong shape of measure
// for a signal that arrives with a floor under it, which is every signal.
//
// COUNTING PEAKS IS ROBUST FOR THE SAME REASON THE HUE AXIS IS. A tonal sound
// puts almost all its energy in a few bins; noise spreads it over hundreds. So
// ask how many bins sit within 12 dB of the loudest one. A floor lifts every
// bin, but it lifts the loudest one too, and the count barely moves:
//
//   quiet   tonal 5…7 bins      noisy 29…76 bins    gap 22
//   room    tonal 5…8 bins      noisy 29…77 bins    gap 21
//
// Counted on the shared 128-bin analyser, log-mapped so both ends keep some
// gradation: growl and a sung vowel land near 0.1, breath near 0.6, a hiss
// near 0.9. It is also CHEAPER than flatness was — an integer compare a bin
// against a table lookup, a log and a division per frame.
const _NOISE_DB    = 12;              // how far under the peak a bin still counts
const _NOISE_WIN   = _NOISE_DB * 255 / 70;        // ... in byte units (255 bytes span 70 dB)
const _NOISE_RATIO = Math.pow(10, -_NOISE_DB / 20);  // ... and as a linear magnitude ratio
const _NOISE_FLOOR = 4;               // bins at or under this read fully tonal
const _NOISE_OCT   = Math.log2(96 / 4);   // ... up to 96 bins, fully noisy

// ── A MARK WITH NO SOUND IN IT KEEPS THE LAST COLOUR (2026-09-13) ──────────
// Ek, reading a real take back off the sphere: "i ended that long line with the
// K click sound with the tongue but it goes thru purple to green/yellow just on
// a K." He was right and the stroke's own numbers say why. A tape take records
// CONTINUOUSLY, so most of its marks are the gaps between what you played:
//
//   the two K clicks        rms 0.69 and 0.67
//   the marks around them   rms 0.002 … 0.004
//
// At rms 0.002 there is no sound to read. The axis still answered — it compared
// whichever bins the room happened to put highest that millisecond — so every
// silent mark got an independent random hue and a stroke came back a rainbow.
// Worse, the sweep is systematic rather than noise: as a click decays into the
// floor the reading walks from the click's own colour toward the room's, which
// is what drew a K as purple through green to yellow.
//
// So a frame more than 34 dB below the loudest thing recently played HOLDS the
// last reading instead of making one up. The reference is a decaying peak hold,
// not a room estimate: no absolute threshold to get wrong at a different input
// gain, no floor tracker to get stuck at, and it says something true about the
// instrument — THE COLOUR IS THE LAST THING YOU ACTUALLY PLAYED, until you play
// something else. A decay is still its own colour for the first 34 dB of it.
// The peak reference is the loudest bin of the frame, which the tilt scan below
// already has, so the whole gate is three comparisons and costs nothing.
const _HOLD_FALL  = 0.995;   // the reference eases down ~0.9 dB a second of painting
const _HOLD_UNDER = 0.02;    // 34 dB below it, a frame has no timbre of its own
let _peakRef = 0;
let _heldTilt = 0, _heldNoise = 0;

/** Forget the reference and the held colour. Called when a take starts.
 *  Without it the reference is module-lifetime: it decays only when a mark is
 *  deposited, ~0.9 dB per second OF PAINTING and not at all between takes, so
 *  the first frames of a quiet take were measured against the previous take's
 *  peak. A take more than 34 dB under the one before it then held that take's
 *  last colour for its whole length — and settleTakeTimbre cannot undo it,
 *  since it only ever declares a mark silent, never un-holds one. */
export function resetTimbreHold() { _peakRef = 0; _heldTilt = 0; _heldNoise = 0; }

const TILT_SPLIT_HZ = 800;   // F1 above, F2 below — the vowel space's own hinge
const _tiltFreq = new Uint8Array(GATE_FFT_SIZE / 2);   // 1024 bins, 23.4 Hz each
let _tiltSplit = 0, _tiltBins = 0, _tiltNy = 0;
// WHY THE BRIGHTNESS TREND IS NOT COMING BACK. Before the count, `noise` was
// flatness with a trend subtracted: `flat − 9.4 · centroid`. That slope was
// fitted on SUNG material only, whose centroid spans 0.038 to 0.050 — a range
// so narrow that any slope fits it — and then extrapolated to a hiss at 0.374,
// where it subtracts three and a half decades nobody measured. Applied there it
// did not weaken the axis, it INVERTED it: a hiss read more tonal than a chest
// tone and was drawn at full saturation, for months. Measured, tonal against
// noisy: raw flatness gap 1.90, trend removed gap −0.01 — the two classes lying
// on top of each other. Never fit a correction on a range narrower than the one
// it will be used over.


/**
 * Decide a sealed take's colours against the WHOLE take, not against what had
 * been played by the time each mark landed.
 *
 * The live hold above is causal — it can only compare a mark to the loudest
 * thing heard SO FAR — and that is wrong at the start of a take. Measured on
 * one of Ek's: 39 of its marks sit more than 34 dB under the take's loudest
 * moment, which by the take's own scale makes them room, and the live estimator
 * caught 22. The misses are the early ones. A mark at 0.65 s read 26 dB below
 * everything before it but 44 dB below the take as a whole, because the loud
 * material did not arrive until five seconds in, so it passed a gate it should
 * have failed and took its colour from the room.
 *
 * Once the take seals, the whole of it is known, so the same rule can be
 * applied exactly. This is not a second mechanism: it is the same threshold
 * against a reference that no longer has to guess at the future. Marks with no
 * sound in them inherit from the last mark that had some, and the ones before
 * the first sounding mark inherit backwards from it — a take that opens with a
 * breath before the note should open in the note's colour, not the room's.
 *
 * Writing to the marks rather than holding at draw time is deliberate: the LED
 * reads `p.tilt` too, and the screen and the light have to agree (Ek: "led
 * should follow exactly same as what the screen shows for grains").
 */
export function settleTakeTimbre(bufIdx) {
  if (!(bufIdx >= 0)) return 0;
  const m = [];
  for (const p of S.particles) {
    if (p.source === 'live' && p.liveBufferIdx === bufIdx) m.push(p);
  }
  if (m.length < 2) return 0;
  m.sort((a, b) => (a.grainStart ?? 0) - (b.grainStart ?? 0));
  let peak = 0;
  for (const p of m) { const r = p.rms ?? 0; if (r > peak) peak = r; }
  if (!(peak > 0)) return 0;
  const floor = peak * _HOLD_UNDER;
  let fixed = 0;
  // Forward: every silent mark takes the last sounding one's colour.
  let lastT = null, lastN = null, firstSounding = -1;
  for (let i = 0; i < m.length; i++) {
    const p = m[i];
    if ((p.rms ?? 0) >= floor) {
      lastT = p.tilt; lastN = p.noise;
      if (firstSounding < 0) firstSounding = i;
      continue;
    }
    // `== null` on purpose: a mark can carry `undefined` rather than null when
    // it came from a source that never stamped the axes, and `=== null` let
    // that undefined be written over every silent mark after it.
    if (lastT == null) continue;                 // handled by the backfill
    if (p.tilt !== lastT || p.noise !== lastN) fixed++;
    p.tilt = lastT; p.noise = lastN;
  }
  // Backward: the marks before the take's first sounding one.
  if (firstSounding > 0) {
    const t0 = m[firstSounding].tilt, n0 = m[firstSounding].noise;
    for (let i = 0; i < firstSounding; i++) {
      if (m[i].tilt !== t0 || m[i].noise !== n0) fixed++;
      m[i].tilt = t0; m[i].noise = n0;
    }
  }
  if (fixed) S._particleVersion++;
  return fixed;
}

/** Spectral centroid + zero-crossing rate from S.inputAnalyser's last 256
 *  samples — the audio at THIS instant, 5 ms of it. A mark takes these at its
 *  own tick, so colour describes where its grain starts. Null without input. */
export function snapshotTimbre() {
  const an = S.inputAnalyser;
  if (!an) return null;
  an.getFloatTimeDomainData(_timeBuf);
  const len = _timeBuf.length;
  let crossings = 0;
  for (let i = 1; i < len; i++) {
    if ((_timeBuf[i] >= 0) !== (_timeBuf[i - 1] >= 0)) crossings++;
  }
  const zcr = crossings / (len - 1);
  an.getByteFrequencyData(_freqBuf);
  const bins = _freqBuf.length;
  const ny = (S.audioCtx?.sampleRate ?? 48000) / 2;
  let weightedSum = 0;
  let totalEnergy = 0;
  let peakByte = 0;
  for (let i = 0; i < bins; i++) {
    const b = _freqBuf[i];
    weightedSum += i * _BYTE_MAG[b];
    totalEnergy += _BYTE_MAG[b];
    if (b > peakByte) peakByte = b;
  }
  const centroid = totalEnergy > 0 ? (weightedSum / totalEnergy) / bins : 0;
  // ── TILT: which band holds the loudest thing. This is the hue axis ───────
  // Ek, 2026-09-13, with a full sphere: "i reset the whole app many times
  // still the same." The hue was right in every clean bench test and wrong
  // through a microphone, and the cause was two things, both here.
  //
  // RESOLUTION. The shared analyser is fftSize 256, which at 48 kHz is 187 Hz
  // per bin — so the entire first-formant range that separates one vowel from
  // another, 270 Hz for `ee` up to 730 Hz for `ah`, lived inside FOUR bins.
  // The axis could not see what it was being asked to measure. Reading the
  // gate analyser's spectrum instead gives 2048 points, 23.4 Hz per bin, and
  // 34 bins under the split. Costs one more FFT per mark and no new node: the
  // 2048 analyser already exists for the loudness gate and is already tapped.
  //
  // SUMS vs PEAKS. A share-of-total-energy ratio counts every bin, and a
  // broadband noise floor — room tone, mic self-noise, the breath under any
  // real voice — puts energy in all of them. With 124 bins above the split
  // against four below, 97% of that floor landed high and pushed everything
  // into the warm end together: measured, a vowel reading 0.206 in silence
  // read 0.358 with a floor under it. That is the peach-and-tan sphere, and
  // subtracting an estimated floor only halved it.
  //
  // Comparing the LOUDEST peaks of the two bands instead is immune to it, for
  // free: a floor lifts every bin by about the same amount, so it barely moves
  // the two maxima and not at all their ratio. Measured over thirteen sounds,
  // adding a room floor moves this by at most 0.015, against 0.187 before —
  // and a floor three times louder still only 0.022. The mean of each band's
  // top THREE bins rather than its single loudest: same immunity, and a
  // vibrato wobbles 0.029 instead of 0.036 because a moving partial hands its
  // strength to its neighbour instead of dropping out.
  //
  // What lands where, measured:
  //   ee .15 · chest .18 · ay .23 · oo .31 · growl .32 · ah .39 · oh .46
  //   click .61 · breath .60 · sh .91 · ss .98
  // Tonal and chest-placed reads cool, forward and open reads rose, breath and
  // sibilance read amber. Already 0–1, so it needs no calibration bounds —
  // which is what "not settable" asked for.
  const gate = _ensureGateAnalyser();
  let tilt = 0, framePeak = 0;
  if (gate) {
    gate.getByteFrequencyData(_tiltFreq);
    const tb = _tiltFreq.length;
    if (_tiltBins !== tb || _tiltNy !== ny) {
      _tiltBins = tb; _tiltNy = ny;
      _tiltSplit = Math.max(2, Math.min(tb - 1, Math.round(TILT_SPLIT_HZ / ny * tb)));
    }
    // Running top three per band — three compares a bin, no sort, no array.
    // Bin 0 is DC and is skipped; it carries the rumble every mic has.
    let l1 = 0, l2 = 0, l3 = 0, h1 = 0, h2 = 0, h3 = 0;
    for (let i = 1; i < _tiltSplit; i++) {
      const m = _BYTE_MAG[_tiltFreq[i]];
      if (m > l1) { l3 = l2; l2 = l1; l1 = m; }
      else if (m > l2) { l3 = l2; l2 = m; }
      else if (m > l3) { l3 = m; }
    }
    for (let i = _tiltSplit; i < tb; i++) {
      const m = _BYTE_MAG[_tiltFreq[i]];
      if (m > h1) { h3 = h2; h2 = h1; h1 = m; }
      else if (m > h2) { h3 = h2; h2 = m; }
      else if (m > h3) { h3 = m; }
    }
    const lowPeak = l1 + l2 + l3, highPeak = h1 + h2 + h3;   // the /3 cancels
    const sum = lowPeak + highPeak;
    tilt = sum > 0 ? highPeak / sum : 0;
    framePeak = l1 > h1 ? l1 : h1;
  }
  // Is there a sound here at all? See the note on _HOLD_UNDER above.
  if (framePeak > _peakRef) _peakRef = framePeak;
  else _peakRef *= _HOLD_FALL;
  const hasSound = _peakRef > 0 && framePeak >= _peakRef * _HOLD_UNDER;
  // log10(flatness) = log10(geometric mean / arithmetic mean), from the sums
  // above — one Math.log for the whole frame, none per bin, and no exp at all.
  let noise = 0;
  if (peakByte > 0) {
    const thr = peakByte - _NOISE_WIN;
    let wide = 0;
    for (let i = 0; i < bins; i++) if (_freqBuf[i] >= thr) wide++;
    noise = Math.log2(wide / _NOISE_FLOOR) / _NOISE_OCT;
    noise = noise < 0 ? 0 : noise > 1 ? 1 : noise;
  }
  // Both colour axes hold together — a mark half of one sound and half of the
  // room would be a colour that was never played.
  if (hasSound) { _heldTilt = tilt; _heldNoise = noise; }
  else          { tilt = _heldTilt; noise = _heldNoise; }
  return { centroid, zcr, noise, tilt };
}

/**
 * Timbre now plus the loudness of the window since the last consumption, as
 * one { rms, centroid, zcr }. For callers that want a mark's worth of features
 * in one read. Its one caller, the concat brush `match`, was deleted
 * 2026-09-22; it is kept because a mark's worth of features in one read is the
 * shape any future brush of that family wants. The paint ticker's live path
 * takes the two halves separately, a tick apart — see _settlePending there.
 */
export function snapshotInputFeatures() {
  const t = snapshotTimbre();
  if (!t) return null;
  return { rms: consumeWindowLoudness(), centroid: t.centroid, zcr: t.zcr, noise: t.noise, tilt: t.tilt };
}

// ── Feature extraction from a take (for sample-source particles) ─────────────

/**
 * Compute features from a take (js/take.js) at a given time offset.
 * Used when painting with loaded samples (no live analyser to snapshot).
 *
 * @param {object}      buffer  - the take
 * @param {number}      startSec - position in seconds to analyse
 * @returns {{ rms: number, centroid: number, zcr: number }}
 */
const _dftMag = new Float64Array(128);   // scratch for the DFT above

export function featuresFromBuffer(buffer, startSec) {
  const sr  = buffer.sampleRate;
  const ch  = buffer.data;
  const off = Math.max(0, Math.min(Math.floor(startSec * sr), ch.length - 256));
  const len = Math.min(256, ch.length - off);

  // ── RMS + peak + ZCR from PCM window ──
  let sumSq = 0;
  let peak  = 0;
  let crossings = 0;
  for (let i = 0; i < len; i++) {
    const s = ch[off + i];
    sumSq += s * s;
    const abs = s < 0 ? -s : s;
    if (abs > peak) peak = abs;
    if (i > 0 && ((s >= 0) !== (ch[off + i - 1] >= 0))) crossings++;
  }
  const rawRms = Math.sqrt(sumSq / len);
  const zcr = len > 1 ? crossings / (len - 1) : 0;

  // Transient-aware loudness: use peak when it reads louder than RMS
  const rms = Math.max(rawRms, peak * 0.7);

  // ── Spectral centroid via simple DFT magnitude (128 bins) ──
  const halfN = 128;
  let weightedSum = 0;
  let totalEnergy = 0;
  for (let k = 0; k < halfN; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < len; n++) {
      const angle = (2 * Math.PI * k * n) / len;
      re += ch[off + n] * Math.cos(angle);
      im -= ch[off + n] * Math.sin(angle);
    }
    const mag = Math.sqrt(re * re + im * im);
    _dftMag[k] = mag;
    weightedSum += k * mag;
    totalEnergy += mag;
  }
  const centroid = totalEnergy > 0 ? (weightedSum / totalEnergy) / halfN : 0;

  // ── THE SAME TWO COLOUR AXES THE LIVE PATH USES (2026-09-13) ──────────────
  // This used to return rms, centroid and zcr only, so a mark painted from a
  // loaded sample — or matched by the concat brush `match`, which copied these
  // — had no `tilt` and no `noise` at all. Both consumers then fell through to
  // a DIFFERENT measure: the renderer to `normaliseCentroid(centroid)` and the
  // LED to a bare 0. So a sampler stroke was hued by one rule on screen, by
  // another in the hand, and by a third once perfMode re-bucketed it. (match
  // was deleted 2026-09-22; the sampler half of this is still live.)
  // The spectrum is already computed above; these are two more passes over it.
  const splitBin = Math.max(2, Math.min(halfN - 1, Math.round(TILT_SPLIT_HZ / (sr / 2) * halfN)));
  let l1 = 0, l2 = 0, l3 = 0, h1 = 0, h2 = 0, h3 = 0, peakMag = 0;
  for (let k = 1; k < halfN; k++) {
    const m = _dftMag[k];
    if (m > peakMag) peakMag = m;
    if (k < splitBin) {
      if (m > l1) { l3 = l2; l2 = l1; l1 = m; } else if (m > l2) { l3 = l2; l2 = m; } else if (m > l3) { l3 = m; }
    } else {
      if (m > h1) { h3 = h2; h2 = h1; h1 = m; } else if (m > h2) { h3 = h2; h2 = m; } else if (m > h3) { h3 = m; }
    }
  }
  const lowPeak = l1 + l2 + l3, highPeak = h1 + h2 + h3, peakSum = lowPeak + highPeak;
  const tilt = peakSum > 0 ? highPeak / peakSum : 0;
  let noise = 0;
  if (peakMag > 0) {
    const thr = peakMag * _NOISE_RATIO;
    let wide = 0;
    for (let k = 0; k < halfN; k++) if (_dftMag[k] >= thr) wide++;
    noise = Math.log2(wide / _NOISE_FLOOR) / _NOISE_OCT;
    noise = noise < 0 ? 0 : noise > 1 ? 1 : noise;
  }

  return { rms, centroid, zcr, tilt, noise };
}

// ── Normalisation helpers (applied at render time, not extraction time) ────────

/**
 * Map a raw value into 0–1 given a min/max calibration range.
 * Clamps to [0, 1].
 */
/** CENTROID → 0–1 FOR COLOUR, LOGARITHMICALLY (2026-09-13).
 *
 *  Brightness is heard the way pitch is — in octaves — and acoustic material
 *  spans a lot of them. Measured across Ek's own range (voice, pitched to
 *  pressed, and percussion from a low thud to a cymbal) the centroid runs
 *  about 324 Hz to 8.8 kHz, which is nearly five octaves; a LINEAR map over
 *  that crushes the bottom four into almost nothing. With the old linear
 *  0.04–0.45 every voice landed between 0.00 and 0.05 — one colour for the
 *  instrument's main material — while the top of the hue arc was never
 *  reached at all. Logarithmically over 0.012–0.34 the same recordings spread
 *  0.04 · 0.29 · 0.44 · 0.48 for the voices and 0.39 · 0.66 · 0.88 · 0.98 for
 *  the drums: voice takes half the arc, percussion the other half.
 *
 *  The bounds keep their meaning — darkest and brightest expected — so the two
 *  calibration sliders and any stored value still say what they said. Only the
 *  curve between them changed.
 */
export function normaliseCentroid(value, min, max) {
  const lo = min > 0 ? min : 1e-4;
  const hi = max > lo ? max : lo * 2;
  if (!(value > lo)) return 0;
  const t = Math.log(value / lo) / Math.log(hi / lo);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function normalise(value, min, max) {
  if (max <= min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

// ── The material's colour ──────────────────────────────────────────────────
// This is the most-seen colour in the instrument: every painted particle on
// the sphere gets its colour from here. It used to be:
//
//     hue = 240 - centroid*220        // 240° → 20°, through the whole wheel
//     sat = 85  - zcr*50
//     lit = 62%                       // constant, in HSL
//
// Two things were wrong with it, and together they are why the material never
// looked like it belonged to the sphere it is painted on.
//
// ONE — HSL lightness is not lightness. At L=62% S=85%, hue 60 (yellow) is
// perceptually about twice as light as hue 240 (blue). So the visual weight of
// a grain tracked its HUE, not its level, not its density, not anything the
// performer did: bright material glared and bassy material nearly vanished,
// and no amount of alpha tuning could fix it because the error was in the
// colour space, not in the numbers.
//
// TWO — an unrestricted 220° sweep runs straight through cyan, green and
// yellow, in HSL, where they glare. The fix at the time was to go round the
// wheel the OTHER way instead — 250° climbing to 405°, through violet and rose
// and brick, with no green anywhere on it — on the reasoning that which way
// round the wheel matters more than the endpoints do.
//
// THAT HALF IS REVERSED (2026-09-13). It was the right fix for the wrong
// reason. What made the old sweep glare was cause ONE, not the hues: HSL holds
// lightness constant in name only, so its green and yellow arrive twice as
// light as its blue and burn. In OKLCh they do not — lightness is lightness
// there, and a green placed at a chosen L stays at that L. Avoiding a third of
// the wheel bought nothing once the colour space was fixed, and it cost the
// axis most of its vocabulary: Ek, painting a full sphere, "i always see orange
// blue violet." The arc runs DOWN now, 290° to 25°, through cyan and green and
// yellow, and is 265° wide instead of 170°. See the ramp's own note below.
//
// The mapping IDEA is unchanged throughout — low band dominant is cool, high
// band dominant is hot.
//
// Chroma carries noisiness: tonal material is saturated, noisy material flatter.
// Both hue and chroma also swing away from the midpoint (the gamma below),
// because the axis clusters in the middle of its range — an un-eased arc spends
// nearly all its time in the average and the ends never get used. It is a
// contrast curve on hue; it changes no ordering.

// OKLab → sRGB. Kept local: this is the only place in the app that needs it,
// and the alternative (a CSS oklch() string) can't be handed to a 2D context.
// ── OKLab → sRGB, and how far out the gamut goes here ────────────────────────
// _oklabLinear leaves its answer in a shared array: the gamut search below
// calls it a few thousand times per table build and must not allocate.
const _rgb = [0, 0, 0];
function _oklabLinear(L, C, h) {
  const hr = h * Math.PI / 180, a = C * Math.cos(hr), b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  _rgb[0] =  4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  _rgb[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  _rgb[2] = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  return _rgb;
}

function _inGamut(L, C, h) {
  const c = _oklabLinear(L, C, h);
  return c[0] >= -1e-4 && c[0] <= 1.0001 && c[1] >= -1e-4 && c[1] <= 1.0001
      && c[2] >= -1e-4 && c[2] <= 1.0001;
}

// The most chroma this lightness and hue can hold before sRGB clips it.
// Sixteen halvings resolve it far finer than a byte of colour.
function _maxChroma(L, h) {
  let lo = 0, hi = 0.45;
  for (let i = 0; i < 16; i++) {
    const m = (lo + hi) * 0.5;
    if (_inGamut(L, m, h)) lo = m; else hi = m;
  }
  return lo;
}

function _oklchHex(L, C, h) {
  const c = _oklabLinear(L, C, h);
  const f = v => {
    v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v > 0 ? v : 0, 1 / 2.4) - 0.055;
    return Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(c[0]) + f(c[1]) + f(c[2]);
}

// ── WHERE THE ARC SPENDS ITS LENGTH (2026-09-13) ─────────────────────────────
// The hue axis is not uniformly populated and never will be, because of what
// it measures. Below 800 Hz dominant means a voiced sound with a strong first
// formant; above means a fricative. So every vowel, hum, growl and chest tone
// in the instrument's vocabulary lands between 0.12 and 0.50, sibilance lands
// above 0.90, and the stretch between the two is breath and voiced fricatives
// — real, but thinly used. A LINEAR arc therefore spends its first 13% and its
// last 10% on nearly everything the performer sings, and its wide middle on
// almost nothing: paint a full sphere and it comes back three colours, which
// is what happened twice ("i always see orange blue violet").
//
// So the arc is stretched where the material is. Four straight segments, knots
// measured, not chosen: the voiced cluster 0.15…0.50 gets 54% of the wheel,
// and the sparse top third gets the rest. It changes no ordering — a monotone
// curve cannot — and it is a CONSTANT, so the same sound is the same colour on
// every machine, which is the whole point of the axis (Ek: "i see yellow
// everytime and my collaborators see yellow and they know what sound that is").
//
// Where the eleven measured sounds land after it:
//   ee violet · chest blue · ay azure · oo cyan · growl cyan · ah teal
//   oh green · breath yellow · click amber · sh red-orange · ss red
const _ARC_IN  = [0.00, 0.15, 0.50, 0.75, 1.00];
const _ARC_OUT = [0.00, 0.08, 0.62, 0.85, 1.00];

export function timbreArc(tiltNorm) {
  const c = tiltNorm < 0 ? 0 : tiltNorm > 1 ? 1 : tiltNorm;
  let i = 1;
  while (i < _ARC_IN.length - 1 && c > _ARC_IN[i]) i++;
  const t0 = _ARC_IN[i - 1], t1 = _ARC_IN[i];
  const o0 = _ARC_OUT[i - 1], o1 = _ARC_OUT[i];
  return { x: 2 * c - 1, e: o0 + (o1 - o0) * (c - t0) / (t1 - t0) };
}

// Quantised memo table. The batched draw path caches its own buckets, but the
// per-particle path calls this once per particle per frame, so the OKLab maths
// must not run there. 96×32 buckets is finer than the eye resolves across the
// arc, and after warm-up this is a single array read — cheaper than the old
// version, which allocated a template string on every call.
// Exported because the ribbon has to know how many buckets a colour step
// crosses to decide how finely to ramp between two marks. It read a hardcoded
// 64 from the day the table was 64 wide, and kept reading 64 after the table
// went to 96 — so every hue step under 3.75 buckets drew as a hard edge.
export const CQ_HUE = 96;   // hue buckets in the memo table
export const CQ_SAT = 32;   // saturation buckets
const _CQ_CENT = CQ_HUE, _CQ_ZCR = CQ_SAT;
let _cqTable = null;

// ── THE ARC GOES ROUND THE OTHER SIDE, AND RIDES THE GAMUT (2026-09-13) ─────
// Ek, on a sphere painted with the fixed hue axis: "still cant see to get
// yellow or reds or greens. i always see orange blue violet." Both halves of
// that were true and they had different causes.
//
// THE REDS AND YELLOWS WERE THERE AND DID NOT LOOK IT. Chroma was a flat
// 0.105…0.160 at every hue — about half of what sRGB can hold — because a
// fixed number is the only number that never clips, and _oklchHex clamps, so
// asking for more would have bent the hue silently. Held at L 0.79 with C
// 0.12, hue 15° is not red, it is salmon, and hue 54° is not yellow, it is
// tan. That is the peach-and-tan sphere's second half. Chroma is now set to
// the MOST that lightness and hue can hold, found by bisection — no clipping
// possible, and 0.19 average instead of 0.14.
//
// YELLOW ALSO NEEDS ITS OWN LIGHTNESS. sRGB's yellow lives at L 0.96 and its
// blue at L 0.45; any single ramp through both makes one of them mud, and the
// old ramp's 0.56…0.88 made yellow into tan. Lightness now follows each hue's
// own gamut CUSP — the lightness at which that hue is most colourful — nudged
// 12% toward 0.72 so the deep blue end is not a hole on a black sphere.
//
// AND GREEN WAS UNREACHABLE BY CONSTRUCTION. 248° climbing to 58° is the short
// way round the wheel: blue, violet, magenta, rose, red, amber. There is no
// green on that road and no true yellow at the end of it, so eleven sounds
// spanning the whole axis could only ever be three families — which is exactly
// the three Ek kept naming. Going the OTHER way from 290° down to 25° is 265°
// instead of 170°, and it passes through violet, blue, cyan, green, yellow,
// orange and red. Same direction of meaning: cool and tonal at the bottom,
// hot and noisy at the top. More of the wheel to say it with.
//
// Measured over the eleven test sounds, before → after: mean step between
// neighbours 0.048 → 0.117 in OKLab, closest pair 0.010 → 0.018 (a JND is
// about 0.02), and the arc covers 265° of hue instead of 170°.
const _HUE_FROM = 290;   // violet, where a chest tone lands
const _HUE_SPAN = 265;   // ... down through cyan, green and amber to 25°, red
const _SAT_TONAL = 0.98; // share of the available chroma a tonal sound gets
const _SAT_SWING = 0.22; // ... and how much of it noise gives back. Kept small
                         // on purpose: YELLOW is the hue desaturation ruins
                         // first — take a fifth off it and it is beige — and
                         // breath is exactly what lands there. A fifth is
                         // still plainly visible side by side, and the second
                         // axis is worth less than a hue you can name.

// The cusp lightness of each hue bucket. Hue is a function of the tilt bucket
// alone, so this is CQ_HUE numbers and they never change — built once at load
// rather than lazily, because the first caller is a mark being painted and a
// 4.7 ms hitch belongs in the boot, not in a stroke. After it, a colour is a
// table read: 0.05 µs, measured over the whole 96×32 grid.
const _cuspL = new Float32Array(_CQ_CENT);
(function _buildCusps() {
  for (let ci = 0; ci < _CQ_CENT; ci++) {
    const { e } = timbreArc(ci / (_CQ_CENT - 1));
    const h = _HUE_FROM - e * _HUE_SPAN;
    let bestL = 0.7, bestC = 0;
    for (let L = 0.06; L <= 0.98; L += 0.02) {
      const c = _maxChroma(L, h);
      if (c > bestC) { bestC = c; bestL = L; }
    }
    _cuspL[ci] = bestL;
  }
  // ── AND THEN SMOOTHED, BECAUSE THE GAMUT HAS A CLIFF (2026-09-13) ────────
  // sRGB's blue corner is a corner: the cusp lightness falls from 0.71 at
  // azure to 0.46 at blue across about 24° of hue. Followed exactly, the ramp
  // inherits that cliff — measured, one bucket at the blue end stepped 0.124 in
  // OKLab, six times a just-noticeable difference, and 36 of 63 neighbouring
  // buckets were over one. On a line drawn as a gradient that reads as banding,
  // which is what Ek was still seeing after the caps were gone.
  //
  // Six [1 2 1] passes take the cliff out. Lightness still follows the hue —
  // yellow is still light and blue still dark, which is the point — it just
  // stops turning a corner. It costs a little peak chroma near blue and
  // nothing anywhere else, because _maxChroma is exact for whatever lightness
  // it is handed, so a smoothed cusp cannot put a colour out of gamut.
  const tmp = new Float32Array(_CQ_CENT);
  for (let pass = 0; pass < 14; pass++) {
    for (let i = 0; i < _CQ_CENT; i++) {
      const p = _cuspL[i > 0 ? i - 1 : 0], n = _cuspL[i < _CQ_CENT - 1 ? i + 1 : _CQ_CENT - 1];
      tmp[i] = 0.25 * p + 0.5 * _cuspL[i] + 0.25 * n;
    }
    _cuspL.set(tmp);
  }
})();

/**
 * Convert normalised audio features to a colour, as a `#rrggbb` string.
 *
 * centroidNorm: 0 = the low band dominates → violet, through blue, cyan,
 *               green and yellow to 1 = the high band dominates → red
 * noiseNorm:    0 = tonal → saturated;        1 = noisy → flatter
 *               (snapshotTimbre's `noise`: how many bins sit within 12 dB of
 *                the loudest, which is a REAL second axis — zcr was 0.95 the
 *                same thing as centroid and the two collapsed to one)
 */
export function featuresToColor(centroidNorm, noiseNorm) {
  if (!_cqTable) _cqTable = new Array(_CQ_CENT * _CQ_ZCR);
  const c = centroidNorm < 0 ? 0 : centroidNorm > 1 ? 1 : centroidNorm;
  const z = noiseNorm    < 0 ? 0 : noiseNorm    > 1 ? 1 : noiseNorm;
  const ci = (c * (_CQ_CENT - 1) + 0.5) | 0;
  const zi = (z * (_CQ_ZCR  - 1) + 0.5) | 0;
  const k  = ci * _CQ_ZCR + zi;
  let hex = _cqTable[k];
  if (hex === undefined) {
    const cn = ci / (_CQ_CENT - 1), zn = zi / (_CQ_ZCR - 1);
    const { e } = timbreArc(cn);
    const H  = _HUE_FROM - e * _HUE_SPAN;
    const Lc = _cuspL[ci];
    // On black, sit almost on the cusp. (The light page's pull toward 0.45
    // went with the light canvas, 2026-09-18 — a cusp yellow was invisible on
    // white and had to turn olive; on the one canvas that remains it does not.)
    const L = Lc + (0.72 - Lc) * 0.12;
    // Saturation is still the tonal/noisy axis, but it now moves between two
    // shares of what the gamut allows rather than two absolute numbers, so a
    // noisy sound reads flatter WITHOUT losing the hue that names it.
    const C = _maxChroma(L, H) * (_SAT_TONAL - zn * _SAT_SWING);
    hex = _cqTable[k] = _oklchHex(L, C, H);
  }
  return hex;
}
