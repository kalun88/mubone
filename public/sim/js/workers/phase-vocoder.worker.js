// ============================================================================
// phase-vocoder.worker.js — time-stretch a mono region, offline, in a Worker.
//
// The tape engine's `pitch` (docs/TAPE-STUDY-2026-09.md § 3): a baked value
// never needs real time, so the loop region is stretched ONCE here by the
// pitch ratio and then played at that ratio as varispeed — the length comes
// back to where it was and the pitch lands where it was set. Blooper's
// Pitcher, Tensor's hold-mode PITCH; the algorithm Travis recommends.
//
// Phase vocoder, 2048-point frames at 75 % overlap, Hann in and out, with
// IDENTITY PHASE LOCKING (Laroche & Dolson 1999): every bin's phase follows
// the nearest spectral peak, which is what keeps a sustained acoustic tone
// from turning to phasey mush. The analysis hop is fractional (HS / ratio) and
// the output is trimmed to exactly round(n × ratio) samples, so a loop's
// length is exact and its seam stays where the wall cycle expects it.
// `circular` reads the input as a loop (a pinned loop's region is one) so the
// seam is continuous; a trigger's region is zero-padded instead.
//
// A module Worker: `stretch` is exported so a node test can import it, and the
// message loop below only runs where `self.postMessage` exists.
// ============================================================================

const N  = 2048;             // frame
const HS = 512;              // synthesis hop (75 % overlap)
const TWO_PI = Math.PI * 2;

// ── Radix-2 complex FFT, in place, on Float64Arrays ─────────────────────────
const _cosT = new Float64Array(N / 2), _sinT = new Float64Array(N / 2);
for (let i = 0; i < N / 2; i++) { _cosT[i] = Math.cos(TWO_PI * i / N); _sinT[i] = Math.sin(TWO_PI * i / N); }
const _rev = new Uint16Array(N);
{ const bits = Math.log2(N); for (let i = 0; i < N; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } _rev[i] = r; } }

function fft(re, im, inverse) {
  for (let i = 0; i < N; i++) { const j = _rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let start = 0; start < N; start += size) {
      for (let k = 0; k < half; k++) {
        const c = _cosT[k * step], s = inverse ? _sinT[k * step] : -_sinT[k * step];
        const i = start + k, j = i + half;
        const tr = re[j] * c - im[j] * s, ti = re[j] * s + im[j] * c;
        re[j] = re[i] - tr; im[j] = im[i] - ti;
        re[i] += tr;        im[i] += ti;
      }
    }
  }
  if (inverse) for (let i = 0; i < N; i++) { re[i] /= N; im[i] /= N; }
}

const _win = new Float64Array(N);
for (let i = 0; i < N; i++) _win[i] = 0.5 - 0.5 * Math.cos(TWO_PI * i / N);

function wrapPhase(p) { return p - TWO_PI * Math.round(p / TWO_PI); }

/**
 * Stretch `x` (Float32Array, mono) to round(x.length × ratio) samples,
 * pitch unchanged. ratio > 1 lengthens. `circular` treats x as a loop.
 */
export function stretch(x, ratio, circular = false) {
  const n = x.length;
  const outLen = Math.max(1, Math.round(n * ratio));
  if (n < N || !(ratio > 0) || Math.abs(ratio - 1) < 1e-6) {
    // Too short for a frame, or no stretch asked: copy (resampled linearly if
    // the length differs, which only a sub-frame region ever reaches).
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) { const p = i * n / outLen; const k = Math.floor(p); const f = p - k; const a = x[k % n] ?? 0, b = x[(k + 1) % n] ?? 0; out[i] = a + (b - a) * f; }
    return out;
  }
  const HA = HS / ratio;
  const bins = N / 2 + 1;
  const out  = new Float64Array(outLen + N);
  const norm = new Float64Array(outLen + N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const mag = new Float64Array(bins), ph = new Float64Array(bins);
  const lastPh = new Float64Array(bins), sumPh = new Float64Array(bins);
  const peakOf = new Int32Array(bins);
  const read = circular
    ? i => x[((i % n) + n) % n]
    : i => (i >= 0 && i < n ? x[i] : 0);
  const nFrames = Math.ceil(outLen / HS) + 1;
  let lastPos = 0;
  for (let k = 0; k < nFrames; k++) {
    const pos = Math.round(k * HA);
    const hop = k === 0 ? HS : Math.max(1, pos - lastPos);   // the hop actually taken
    lastPos = pos;
    for (let i = 0; i < N; i++) { re[i] = read(pos + i) * _win[i]; im[i] = 0; }
    fft(re, im, false);
    for (let b = 0; b < bins; b++) { mag[b] = Math.hypot(re[b], im[b]); ph[b] = Math.atan2(im[b], re[b]); }
    if (k === 0) {
      for (let b = 0; b < bins; b++) { lastPh[b] = ph[b]; sumPh[b] = ph[b]; }
    } else {
      // Peaks: a bin above both neighbours, and each bin's nearest peak.
      let p = 0;
      for (let b = 0; b < bins; b++) {
        const isPeak = mag[b] > (b > 0 ? mag[b - 1] : -1) && mag[b] >= (b + 1 < bins ? mag[b + 1] : -1);
        if (isPeak) p = b;
        peakOf[b] = p;
      }
      // Walk the regions between peaks so each bin gets the CLOSER peak.
      for (let b = 0; b + 1 < bins; b++) {
        const pa = peakOf[b], pb = peakOf[b + 1];
        if (pb !== pa && pb > pa) { const mid = (pa + pb) >> 1; for (let c = mid + 1; c <= pb; c++) peakOf[c] = pb; for (let c = pa; c <= mid; c++) peakOf[c] = pa; }
      }
      // Advance every PEAK by its true instantaneous frequency over the
      // synthesis hop; lock the bins around it to the peak's advance.
      for (let b = 0; b < bins; b++) {
        if (peakOf[b] !== b) continue;
        const omega = TWO_PI * b / N;
        const delta = wrapPhase(ph[b] - lastPh[b] - omega * hop);
        const inst  = omega + delta / hop;
        sumPh[b] += inst * HS;
      }
      for (let b = 0; b < bins; b++) {
        const p2 = peakOf[b];
        if (p2 === b) continue;
        sumPh[b] = sumPh[p2] + (ph[b] - ph[p2]);
      }
      for (let b = 0; b < bins; b++) lastPh[b] = ph[b];
    }
    for (let b = 0; b < bins; b++) { re[b] = mag[b] * Math.cos(sumPh[b]); im[b] = mag[b] * Math.sin(sumPh[b]); }
    for (let b = 1; b < N / 2; b++) { re[N - b] = re[b]; im[N - b] = -im[b]; }
    fft(re, im, true);
    const at = k * HS;
    for (let i = 0; i < N; i++) { const j = at + i; if (j >= out.length) break; out[j] += re[i] * _win[i]; norm[j] += _win[i] * _win[i]; }
  }
  const res = new Float32Array(outLen);
  if (circular) {
    // Fold the overhang back onto the head so the loop's seam is one window.
    for (let j = outLen; j < out.length; j++) { out[j - outLen] += out[j]; norm[j - outLen] += norm[j]; }
  }
  for (let i = 0; i < outLen; i++) res[i] = norm[i] > 1e-6 ? out[i] / norm[i] : 0;
  return res;
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = e => {
    const { id, samples, ratio, circular } = e.data;
    const out = stretch(samples, ratio, !!circular);
    self.postMessage({ id, out }, [out.buffer]);
  };
}
