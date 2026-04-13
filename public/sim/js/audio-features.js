// ============================================================================
// AUDIO-FEATURES — lightweight snapshot extraction for particle visualization
// Called ONCE per particle at paint time. Zero per-frame cost.
// ============================================================================

import { S } from './state.js';

// ── Reusable buffers (avoid GC pressure) ──────────────────────────────────────
// Sized to match inputAnalyser.fftSize (256 → 128 frequency bins).
const _timeBuf = new Float32Array(256);
const _freqBuf = new Uint8Array(128);

// ── Peak-hold tracker ────────────────────────────────────────────────────────
// The AnalyserNode only holds the last 256 samples (~5ms at 48kHz), but
// particles are painted every ~50ms. A loud click that happens between
// paints would be gone before anyone reads it.  tickPeakHold() runs
// every render frame and holds the peak with slow decay so transients
// are still "hot" when the next snapshotInputFeatures() reads them.
//
// tickPeakHold() runs every render frame (called from animate()) and
// continuously samples the analyser, holding the peak with slow decay so
// transients are still "hot" when the next snapshotInputFeatures() reads them.
let _heldPeak    = 0;
let _heldRms     = 0;
const PEAK_DECAY = 0.75;  // per-frame decay — drops to ~10% in ~8 frames (~130ms)
const RMS_DECAY  = 0.80;  // slightly slower for RMS to smooth jitter

export function tickPeakHold() {
  const an = S.inputAnalyser;
  if (!an) return;

  an.getFloatTimeDomainData(_timeBuf);
  const len = _timeBuf.length;

  let sumSq = 0;
  let peak  = 0;
  for (let i = 0; i < len; i++) {
    const s = _timeBuf[i];
    sumSq += s * s;
    const abs = s < 0 ? -s : s;
    if (abs > peak) peak = abs;
  }
  const instantRms = Math.sqrt(sumSq / len);

  // Hold: take the max of the decayed previous value and the new reading
  _heldPeak = Math.max(peak, _heldPeak * PEAK_DECAY);
  _heldRms  = Math.max(instantRms, _heldRms * RMS_DECAY);
}

// ── Feature extraction from AnalyserNode snapshot ─────────────────────────────

/**
 * Grab a single-frame snapshot of audio features from S.inputAnalyser.
 * Returns { rms, centroid, zcr } or null if no analyser available.
 *
 * rms:      Loudness metric (0–1 typical), using peak-hold for transient accuracy
 * centroid: Spectral centroid as normalised 0–1 (low bin → 0, high bin → 1)
 * zcr:      Zero-crossing rate, 0–1 (0 = pure DC, 1 = every sample crosses)
 */
export function snapshotInputFeatures() {
  const an = S.inputAnalyser;
  if (!an) return null;

  // ── Time-domain → ZCR (peak + RMS come from the peak-hold tracker) ──
  // We still read time-domain here for ZCR, but loudness uses the held values
  // which capture transients that may have occurred between paint events.
  an.getFloatTimeDomainData(_timeBuf);
  const len = _timeBuf.length;

  let crossings = 0;
  for (let i = 1; i < len; i++) {
    if ((_timeBuf[i] >= 0) !== (_timeBuf[i - 1] >= 0)) crossings++;
  }
  const zcr = crossings / (len - 1);

  // Loudness: use peak-held values so transients between paints aren't lost.
  // Take whichever is louder: held RMS or held peak scaled down.
  const rms = Math.max(_heldRms, _heldPeak * 0.7);

  // Consume the held values — reset to current instantaneous so the peak
  // doesn't linger across multiple particles in the same paint burst.
  // The next tickPeakHold() call will replenish from the analyser.
  _heldPeak *= 0.5;
  _heldRms  *= 0.5;

  // ── Frequency-domain → spectral centroid ──
  an.getByteFrequencyData(_freqBuf);
  const bins = _freqBuf.length;
  let weightedSum = 0;
  let totalEnergy = 0;
  for (let i = 0; i < bins; i++) {
    weightedSum += i * _freqBuf[i];
    totalEnergy += _freqBuf[i];
  }
  const centroid = totalEnergy > 0 ? (weightedSum / totalEnergy) / bins : 0;

  return { rms, centroid, zcr };
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
    for (let n = 0; n < cLen; n++) {
      const angle = (2 * Math.PI * k * n) / cLen;
      re += ch[cOff + n] * Math.cos(angle);
      im -= ch[cOff + n] * Math.sin(angle);
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

/**
 * Convert normalised audio features to an HSL colour string.
 *
 * hue:        spectral centroid (0 = 240° cool blue, 1 = 30° warm orange)
 * saturation: inverse ZCR (tonal → saturated, noisy → washed out)
 * lightness:  fixed middle band for good contrast on dark BG
 */
export function featuresToHSL(centroidNorm, zcrNorm) {
  // Map centroid: low (dark/bass) → blue 240°, high (bright) → orange/red 20°
  const hue = 240 - centroidNorm * 220;  // 240 → 20
  // Map ZCR: low (tonal) → 85% sat, high (noisy) → 35% sat
  const sat = 85 - zcrNorm * 50;         // 85% → 35%
  // Lightness: bright on dark BG, deeper on light BG
  const lit = S.darkMode ? 62 : 42;
  return `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${lit}%)`;
}
