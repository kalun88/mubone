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

/** Peak + RMS over the gate analyser's full window. */
function _readLoudness() {
  const an = _ensureGateAnalyser();
  if (!an) return null;
  an.getFloatTimeDomainData(_gateBuf);
  let sumSq = 0, peak = 0;
  for (let i = 0; i < GATE_FFT_SIZE; i++) {
    const s = _gateBuf[i];
    sumSq += s * s;
    const abs = s < 0 ? -s : s;
    if (abs > peak) peak = abs;
  }
  return { peak, rms: Math.sqrt(sumSq / GATE_FFT_SIZE) };
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

// ── Timbre at an instant ─────────────────────────────────────────────────────
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
  let weightedSum = 0;
  let totalEnergy = 0;
  for (let i = 0; i < bins; i++) {
    weightedSum += i * _freqBuf[i];
    totalEnergy += _freqBuf[i];
  }
  const centroid = totalEnergy > 0 ? (weightedSum / totalEnergy) / bins : 0;
  return { centroid, zcr };
}

/**
 * Timbre now plus the loudness of the window since the last consumption, as
 * one { rms, centroid, zcr }. For callers that want a mark's worth of features
 * in one read (the concat brush). The paint ticker's live path takes the two
 * halves separately, a tick apart — see _settlePending there.
 */
export function snapshotInputFeatures() {
  const t = snapshotTimbre();
  if (!t) return null;
  return { rms: consumeWindowLoudness(), centroid: t.centroid, zcr: t.zcr };
}

// ── Feature extraction from an AudioBuffer (for sample-source particles) ──────

/**
 * Compute features from a decoded AudioBuffer at a given time offset.
 * Used when painting with loaded samples (no live analyser to snapshot).
 *
 * @param {AudioBuffer} buffer  - the decoded audio buffer
 * @param {number}      startSec - position in seconds to analyse
 * @returns {{ rms: number, centroid: number, zcr: number }}
 */
export function featuresFromBuffer(buffer, startSec) {
  const sr  = buffer.sampleRate;
  const ch  = buffer.getChannelData(0);
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
    weightedSum += k * mag;
    totalEnergy += mag;
  }
  const centroid = totalEnergy > 0 ? (weightedSum / totalEnergy) / halfN : 0;

  return { rms, centroid, zcr };
}

// ── Normalisation helpers (applied at render time, not extraction time) ────────

/**
 * Map a raw value into 0–1 given a min/max calibration range.
 * Clamps to [0, 1].
 */
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
// yellow: the neon middle of the wheel. That is the same problem SPHERE_PALETTE
// solved for the grid on 2026-08-29 ("very matrix neo green"), still living in
// the material.
//
// The mapping IDEA is unchanged — dark sound cool, bright sound warm — restated
// in OKLCH along the sphere's own axis: the steel blue of the north sky to the
// ember of the south earth, at near-constant perceptual lightness.
//
// The arc wraps UPWARD (250 → 405), which is the whole trick. Going down from
// 250 to 45 is the short arithmetic path and the wrong one: it runs 250 → 190 →
// 130 → 70, i.e. cyan, green, yellow-green — the same neon middle restated in a
// better colour space. Going up wraps through violet, rose and brick instead,
// and there is no green anywhere on it. Which way round the wheel matters more
// than the endpoints do.
//
// Chroma carries noisiness: tonal material is saturated, noisy material goes
// ashen. Both hue and chroma also swing away from the midpoint (the gamma
// below), because raw centroid clusters hard in the middle of its range — an
// un-eased arc spends nearly all its time in the lavender average and the ends
// never get used. It is a contrast curve on hue; it changes no ordering.

// OKLab → sRGB. Kept local: this is the only place in the app that needs it,
// and the alternative (a CSS oklch() string) can't be handed to a 2D context.
function _oklchHex(L, C, h) {
  const hr = h * Math.PI / 180, a = C * Math.cos(hr), b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  const r  =  4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g  = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const f = v => {
    v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v > 0 ? v : 0, 1 / 2.4) - 0.055;
    return Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(r) + f(g) + f(bl);
}

// The eased steel→ember arc. Exported for the LED path, which shares the
// mapping so the x-IMU3's light and the screen agree on what a sound looks
// like — see _timbreHex() in ximu-led-feedback.js.
export function timbreArc(centroidNorm) {
  const c = centroidNorm < 0 ? 0 : centroidNorm > 1 ? 1 : centroidNorm;
  const x = 2 * c - 1;
  return { x, e: 0.5 + 0.5 * Math.sign(x) * Math.pow(Math.abs(x), 0.58) };
}

// Quantised memo table. The batched draw path caches its own buckets, but the
// per-particle path calls this once per particle per frame, so the OKLab maths
// must not run there. 64×32 buckets is finer than the eye resolves across the
// arc, and after warm-up this is a single array read — cheaper than the old
// version, which allocated a template string on every call.
const _CQ_CENT = 64, _CQ_ZCR = 32;
let _cqTable = null, _cqDark = null;

/**
 * Convert normalised audio features to a colour, as a `#rrggbb` string.
 *
 * centroidNorm: 0 = dark/bassy → steel blue;  1 = bright → ember
 * zcrNorm:      0 = tonal → saturated;        1 = noisy → ashen
 */
export function featuresToColor(centroidNorm, zcrNorm) {
  const dark = S.darkMode;
  if (!_cqTable || _cqDark !== dark) {
    _cqTable = new Array(_CQ_CENT * _CQ_ZCR);
    _cqDark  = dark;
  }
  const c = centroidNorm < 0 ? 0 : centroidNorm > 1 ? 1 : centroidNorm;
  const z = zcrNorm      < 0 ? 0 : zcrNorm      > 1 ? 1 : zcrNorm;
  const ci = (c * (_CQ_CENT - 1) + 0.5) | 0;
  const zi = (z * (_CQ_ZCR  - 1) + 0.5) | 0;
  const k  = ci * _CQ_ZCR + zi;
  let hex = _cqTable[k];
  if (hex === undefined) {
    const cn = ci / (_CQ_CENT - 1), zn = zi / (_CQ_ZCR - 1);
    const { x, e } = timbreArc(cn);
    const H = (250 + e * 155) % 360;                        // steel → violet → rose → ember
    const C = (0.040 + (1 - zn) * 0.080) * (0.78 + 0.42 * Math.abs(x));
    // On a light background the same hues need to go darker, not lighter, or
    // they wash out — the arc is unchanged, only the lightness band moves.
    const L = dark ? 0.700 + e * 0.085 : 0.500 + e * 0.070;
    hex = _cqTable[k] = _oklchHex(L, C, H);
  }
  return hex;
}
