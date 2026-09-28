// ============================================================================
// reverb.js — an algorithmic reverb: diffusers into an 8-line feedback delay
// network, modulated, with frequency-dependent decay and N decorrelated outputs
//
// STANDALONE (Ek, 2026-09-27): nothing in the app imports this yet. It is
// auditioned offline first — `node scripts/reverb-render.mjs` writes WAVs to
// listen to — and measured by `js/reverb.test.mjs`. It is written so the grain
// engine's AudioWorklet can import it as is: plain ES module, no imports, no
// DOM, no allocation after construction.
//
// The intended use (docs/TODO.md): a send from the live input, WET ONLY, its
// output placed at the cursor, never recorded — a reverb tail you steer.
//
// The signal path, per sample:
//
//   in ─▶ low cut ─▶ high cut ─▶ predelay ─▶ 4 series allpass diffusers ─┐
//                                                                        ▼
//        ┌──────────── 8 delay lines, lengths mutually prime ◀── inject ─┘
//        │   each read: modulated (slow sine, cubic interpolation)
//        │   each line: decay + damping filter (one pole — the DC and
//        │              Nyquist gains set from decay and damping, so the
//        │              decay TIME is exact at both ends: Jot's absorbent filter)
//        │   each line: a short allpass (echo density builds faster)
//        └─▶ Hadamard mix (orthogonal: the loop is lossless but for the
//            filters, so the decay is the filters' and nothing else's)
//   out k = its own ± pattern of the 8 filtered lines → decorrelated outputs
//
// Why this shape: an FDN's decay is set exactly by per-line gains, its density
// by the number and spread of lines, and its colour by the damping — every knob
// maps to one mechanism. Modulating the read positions breaks up the fixed
// resonances that make cheap reverbs sound metallic (the Lexicon/Valhalla
// trick). The diffusers in front turn a click into a smear before it enters the
// network, so the tail starts dense instead of as discrete echoes.
//
// Cost is roughly constant per sample; see `js/reverb.test.mjs` for the
// measured microseconds per 128-sample block against the 2667 µs budget. An
// IDLE reverb — silent input, tail below −120 dB — skips all of it, so off is
// really off.
// ============================================================================

// ── Tuning constants ────────────────────────────────────────────────────────
// Delay lengths in milliseconds at size 1. The FDN lines are spread across a
// ratio of ~2.3 so their modes interleave; each is rounded to a prime number of
// samples so no two share a common period. The input diffusers are Dattorro's
// (1997), converted from his 29.761 kHz sample counts.
const LINE_MS      = [43.1, 47.9, 53.7, 59.3, 67.1, 73.9, 83.3, 97.1];
const LINE_AP_MS   = [3.1, 4.3, 5.9, 6.7, 7.9, 9.7, 11.3, 13.1];
const LINE_AP_G    = 0.5;
const DIFF_MS      = [4.771, 3.595, 12.735, 9.307];
const DIFF_G       = [0.75, 0.75, 0.625, 0.625];
const MOD_RATE_SPREAD = [0.83, 1.00, 1.13, 0.91, 1.07, 0.97, 1.19, 0.87];  // per-line LFO rate ratios
const N_LINES      = 8;
const MAX_SIZE     = 2;          // the size knob's ceiling; buffers are sized for it
const MAX_MOD_MS   = 3;
const MAX_PREDELAY_MS = 250;
const IDLE_IN      = 1e-6;       // −120 dB: input below this is silence
const IDLE_OUT     = 1e-6;       // and a tail below this is gone

// 8×8 Hadamard sign rows, for the output taps. Row k is output k's pattern;
// orthogonal rows give uncorrelated outputs from the same eight lines.
const H8 = [
  [ 1,  1,  1,  1,  1,  1,  1,  1],
  [ 1, -1,  1, -1,  1, -1,  1, -1],
  [ 1,  1, -1, -1,  1,  1, -1, -1],
  [ 1, -1, -1,  1,  1, -1, -1,  1],
  [ 1,  1,  1,  1, -1, -1, -1, -1],
  [ 1, -1,  1, -1, -1,  1, -1,  1],
  [ 1,  1, -1, -1, -1, -1,  1,  1],
  [ 1, -1, -1,  1, -1,  1,  1, -1],
];
// The input is injected with its own sign pattern — not row 0, which would
// feed the Hadamard's first output only.
const INJECT = [1, -1, 1, 1, -1, 1, -1, -1];

export const REVERB_DEFAULTS = Object.freeze({
  decay:     2.5,    // seconds to fall 60 dB at low frequencies (RT60)
  damping:   0.45,   // high-frequency RT60 as a fraction of `decay` (1 = no damping)
  size:      1,      // scales every delay; 0.3–2
  predelay:  12,     // ms
  diffusion: 1,      // 0–1: the input diffusers' strength
  modDepth:  0.6,    // ms of delay swing
  modRate:   0.45,   // Hz, the average of the eight LFOs
  lowCut:    90,     // Hz — keeps the tail from going to mud
  highCut:   11000,  // Hz
  freeze:    false,  // hold the tail: decay → ∞, no new input
  level:     1,      // wet output gain, linear
});

function nextPrime(n) {
  n = Math.max(2, Math.round(n));
  for (;; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (prime) return n;
  }
}
const pow2Above = n => 1 << Math.ceil(Math.log2(n + 4));

export class Reverb {
  /**
   * @param {number} sampleRate
   * @param {{ outputs?: number }} opts  output channels (1 for a mono tail to
   *        place at the cursor; 2 for headphones; N, one per speaker)
   */
  constructor(sampleRate, { outputs = 2 } = {}) {
    this.sr = sampleRate;
    this.nOut = Math.max(1, outputs | 0);
    const ms = x => x * sampleRate / 1000;

    // Rings: power-of-two lengths so an index wraps with a mask.
    this._pre  = new Float32Array(pow2Above(ms(MAX_PREDELAY_MS) + 4));
    this._preW = 0;
    this._diff = DIFF_MS.map(d => ({ buf: new Float32Array(pow2Above(ms(d))), len: Math.round(ms(d)), w: 0 }));
    this._line = [];
    for (let i = 0; i < N_LINES; i++) {
      this._line.push({
        buf: new Float32Array(pow2Above(ms(LINE_MS[i] * MAX_SIZE + 2 * MAX_MOD_MS) + 8)), w: 0,   // the read swings 0–2× depth
        len: 0, lenTarget: 0,        // current and target length in samples (size glides)
        ap: new Float32Array(pow2Above(ms(LINE_AP_MS[i] * MAX_SIZE))), apW: 0, apLen: 0,
        b: 0, p: 0, z: 0,            // decay/damping one-pole, and its state
        lfoC: Math.cos(i), lfoS: Math.sin(i), lfoCr: 1, lfoSr: 0,
      });
    }
    // Output taps: Hadamard rows, and past eight outputs a rotated pattern.
    this._taps = [];
    for (let k = 0; k < this.nOut; k++) {
      const row = H8[k % 8], rot = Math.floor(k / 8) * 3;
      this._taps.push(Float32Array.from({ length: N_LINES }, (_, i) => row[(i + rot) % 8]));
    }
    this._v = new Float64Array(N_LINES);   // per-sample scratch
    // Input filters' state and smoothed controls.
    this._lcZ = 0; this._lcX = 0; this._hcZ = 0;
    this._inGain = 1; this._inGainTarget = 1;
    this._level = 1;
    this._predelay = 0; this._predelayTarget = 0;
    this._idle = true;
    this.params = { ...REVERB_DEFAULTS };
    this.set({}, true);
  }

  /** Change any of REVERB_DEFAULTS' keys. Safe mid-tail: every control that
   *  would click glides (size, predelay, level, freeze's input gate). */
  set(p = {}, snap = false) {
    Object.assign(this.params, p);
    const P = this.params, sr = this.sr;
    const size = Math.min(MAX_SIZE, Math.max(0.3, P.size));
    const ms = x => x * sr / 1000;

    for (let i = 0; i < N_LINES; i++) {
      const L = this._line[i];
      L.lenTarget = nextPrime(ms(LINE_MS[i] * size));
      L.apLen = Math.max(1, Math.round(ms(LINE_AP_MS[i] * size)));
      if (snap) L.len = L.lenTarget;
      // Decay: the loop gain per pass for this line's total delay, at DC and
      // at Nyquist. Freeze holds the tail: unity-minus-a-hair, so the loop is
      // lossless to the ear but cannot creep upward through interpolation gain.
      const loopS = (L.lenTarget + L.apLen) / sr;
      let gDc, gNy;
      if (P.freeze) { gDc = gNy = 0.99995; }
      else {
        const tLow  = Math.max(0.05, P.decay);
        const tHigh = Math.max(0.02, tLow * Math.min(1, Math.max(0.02, P.damping)));
        gDc = Math.pow(10, -3 * loopS / tLow);
        gNy = Math.pow(10, -3 * loopS / tHigh);
      }
      // One pole with DC gain gDc and Nyquist gain gNy: H(z) = b / (1 − p z⁻¹)
      L.p = (gDc - gNy) / (gDc + gNy);
      L.b = gDc * (1 - L.p);
      // LFO: a rotating phasor, advanced one sample at a time.
      const w = 2 * Math.PI * Math.max(0.01, P.modRate) * MOD_RATE_SPREAD[i] / sr;
      L.lfoCr = Math.cos(w); L.lfoSr = Math.sin(w);
    }
    this._modDepth = ms(Math.min(MAX_MOD_MS, Math.max(0, P.modDepth)));
    this._predelayTarget = Math.min(this._pre.length - 4, ms(Math.min(MAX_PREDELAY_MS, Math.max(0, P.predelay))));
    if (snap) this._predelay = this._predelayTarget;
    this._diffG = DIFF_G.map(g => g * Math.min(1, Math.max(0, P.diffusion)));
    // One-pole coefficients for the input filters.
    this._lcA = Math.exp(-2 * Math.PI * Math.max(10, P.lowCut) / sr);
    this._hcA = Math.exp(-2 * Math.PI * Math.min(sr * 0.45, Math.max(200, P.highCut)) / sr);
    this._inGainTarget = P.freeze ? 0 : 1;
    this._levelTarget = Math.max(0, P.level);
    if (snap) { this._inGain = this._inGainTarget; this._level = this._levelTarget; }
    // Silence is only silence once nothing is still IN FLIGHT: an impulse
    // spends the predelay, the diffusers and a full line length inside the
    // network before any of it reaches an output. Quiet for longer than that
    // path, and the reverb is idle.
    let longest = 0;
    for (const L of this._line) longest = Math.max(longest, L.lenTarget + L.apLen);
    this._holdSamples = Math.ceil(this._predelayTarget + this._diff.reduce((a, D) => a + D.len, 0)
                                  + longest + 2 * this._modDepth) * 2;
    // A changed control wakes an idle reverb, so a glide lands.
    this._idle = false;
    this._quiet = 0;
  }

  /** True while the reverb is skipping its work — silent in, tail gone. */
  get idle() { return this._idle; }

  /**
   * @param {Float32Array} input   mono, `n` samples (null for silence)
   * @param {Float32Array[]} outputs  this.nOut channels, `n` samples each —
   *        OVERWRITTEN with the wet signal (the caller sums it where it goes)
   * @param {number} n
   */
  process(input, outputs, n) {
    // Idle: skip everything. The block is silent if the input is.
    let inPeak = 0;
    if (input) for (let s = 0; s < n; s++) { const a = Math.abs(input[s]); if (a > inPeak) inPeak = a; }
    // Frozen, the input is gated — so a frozen reverb that is silent stays
    // silent, and idles like any other (all n used to run while frozen).
    const frozen = !!this.params.freeze;
    if (this._idle && (frozen || inPeak < IDLE_IN)) {
      for (let k = 0; k < this.nOut; k++) outputs[k].fill(0, 0, n);
      return;
    }

    const lines = this._line, v = this._v, taps = this._taps, nOut = this.nOut;
    const pre = this._pre, preMask = pre.length - 1;
    const diff = this._diff, dg = this._diffG;
    const lcA = this._lcA, hcA = this._hcA, modDepth = this._modDepth;
    const SQ8 = 1 / Math.sqrt(8);
    const glide = 1 - Math.exp(-1 / (0.05 * this.sr));   // 50 ms for size, predelay, level, gate
    // A delay that glides is a read head changing speed — pitch. At 50 ms a
    // full space sweep ran line 7's head at −1.7× (backwards) for tens of ms
    // (review, 2026-09-27). Capped at a quarter of a sample per sample: a big
    // jump becomes a ±25 % bend over about half a second, never a reversal.
    const MAX_STEP = 0.25;
    const step = (cur, tgt) => { const d = (tgt - cur) * glide; return cur + (d > MAX_STEP ? MAX_STEP : d < -MAX_STEP ? -MAX_STEP : d); };
    let outPeak = 0;

    for (let s = 0; s < n; s++) {
      // ── input: low cut (one-pole high-pass), high cut (one-pole low-pass) ──
      this._inGain += (this._inGainTarget - this._inGain) * glide;
      let x = (input ? input[s] : 0) * this._inGain;
      const hp = x - this._lcX + lcA * this._lcZ;   // y = x − x₁ + a·y₁
      this._lcX = x; this._lcZ = hp;
      this._hcZ = hp + hcA * (this._hcZ - hp);
      x = this._hcZ;

      // ── predelay (fractional read, gliding) ──
      pre[this._preW] = x;
      this._predelay = step(this._predelay, this._predelayTarget);
      {
        const rp = this._preW - this._predelay;
        const i0 = Math.floor(rp), f = rp - i0;
        x = pre[i0 & preMask] * (1 - f) + pre[(i0 + 1) & preMask] * f;
      }
      this._preW = (this._preW + 1) & preMask;

      // ── input diffusion: four Schroeder allpasses in series ──
      for (let d = 0; d < 4; d++) {
        const D = diff[d], m = D.buf.length - 1, g = dg[d];
        const del = D.buf[(D.w - D.len) & m];
        const w = x + g * del;
        D.buf[D.w] = w;
        x = del - g * w;
        D.w = (D.w + 1) & m;
      }

      // ── the network: read, damp, diffuse ──
      for (let i = 0; i < N_LINES; i++) {
        const L = lines[i], buf = L.buf, m = buf.length - 1;
        L.len = step(L.len, L.lenTarget);
        // LFO phasor step (renormalised on the block below)
        const c = L.lfoC * L.lfoCr - L.lfoS * L.lfoSr;
        L.lfoS = L.lfoS * L.lfoCr + L.lfoC * L.lfoSr;
        L.lfoC = c;
        const rp = L.w - L.len - modDepth * (1 + L.lfoS);   // ≥ len behind the write
        const i0 = Math.floor(rp), f = rp - i0;
        // 4-point cubic Hermite: keeps the highs a linear read would dull
        const ym1 = buf[(i0 - 1) & m], y0 = buf[i0 & m], y1 = buf[(i0 + 1) & m], y2 = buf[(i0 + 2) & m];
        const c1 = 0.5 * (y1 - ym1), c2 = ym1 - 2.5 * y0 + 2 * y1 - 0.5 * y2, c3 = 0.5 * (y2 - ym1) + 1.5 * (y0 - y1);
        let y = ((c3 * f + c2) * f + c1) * f + y0;
        // decay + damping
        L.z = L.b * y + L.p * L.z;
        y = L.z;
        // the line's own allpass
        const ab = L.ap, am = ab.length - 1;
        const del = ab[(L.apW - L.apLen) & am];
        const w = y + LINE_AP_G * del;
        ab[L.apW] = w;
        v[i] = del - LINE_AP_G * w;
        L.apW = (L.apW + 1) & am;
      }

      // ── outputs: each its own ± pattern of the eight lines ──
      this._level += (this._levelTarget - this._level) * glide;
      const og = this._level * SQ8;
      for (let k = 0; k < nOut; k++) {
        const t = taps[k];
        const o = (t[0]*v[0] + t[1]*v[1] + t[2]*v[2] + t[3]*v[3] + t[4]*v[4] + t[5]*v[5] + t[6]*v[6] + t[7]*v[7]) * og;
        outputs[k][s] = o;
        const a = o < 0 ? -o : o; if (a > outPeak) outPeak = a;
      }

      // ── Hadamard mix (fast Walsh–Hadamard, three butterfly stages) ──
      let a0 = v[0] + v[1], a1 = v[0] - v[1], a2 = v[2] + v[3], a3 = v[2] - v[3];
      let a4 = v[4] + v[5], a5 = v[4] - v[5], a6 = v[6] + v[7], a7 = v[6] - v[7];
      let b0 = a0 + a2, b2 = a0 - a2, b1 = a1 + a3, b3 = a1 - a3;
      let b4 = a4 + a6, b6 = a4 - a6, b5 = a5 + a7, b7 = a5 - a7;
      v[0] = (b0 + b4) * SQ8; v[4] = (b0 - b4) * SQ8;
      v[1] = (b1 + b5) * SQ8; v[5] = (b1 - b5) * SQ8;
      v[2] = (b2 + b6) * SQ8; v[6] = (b2 - b6) * SQ8;
      v[3] = (b3 + b7) * SQ8; v[7] = (b3 - b7) * SQ8;

      // ── write back, with the input injected ──
      const xin = x * SQ8;
      for (let i = 0; i < N_LINES; i++) {
        const L = lines[i], m = L.buf.length - 1;
        L.buf[L.w] = v[i] + INJECT[i] * xin;
        L.w = (L.w + 1) & m;
      }
    }

    // Keep the LFO phasors on the unit circle (the recurrence drifts slowly).
    for (let i = 0; i < N_LINES; i++) {
      const L = lines[i], r = 1 / Math.hypot(L.lfoC, L.lfoS);
      L.lfoC *= r; L.lfoS *= r;
    }
    // Idle once nothing has come in or out for longer than a sound can hide
    // inside the network.
    this._quiet = ((frozen || inPeak < IDLE_IN) && outPeak < IDLE_OUT) ? this._quiet + n : 0;
    this._idle = this._quiet > this._holdSamples;
  }

  /** Silence the tail now (a panic, or a patch change that should not ring). */
  clear() {
    this._pre.fill(0);
    for (const D of this._diff) D.buf.fill(0);
    for (const L of this._line) { L.buf.fill(0); L.ap.fill(0); L.z = 0; }
    this._lcZ = this._lcX = this._hcZ = 0;
    this._idle = true;
    this._quiet = this._holdSamples + 1;
  }
}

// ── The three knobs (Ek, 2026-09-27: "that's a lot of settings for a reverb")
// What a player gets: SPACE, TONE, and an amount the caller applies as the
// send. Each knob moves the parameters that move together in a real space;
// the rest are fixed at the character Ek chose from the renders — the cloud
// voicing's movement, full diffusion, a low cut that keeps the tail clean.
//
//   space 0 → 1   a small clear room (0.8 s) → a cloud (12 s): decay, size and
//                 predelay together — a bigger room has a longer tail and a
//                 later onset. Decay and size sweep exponentially, so the
//                 middle of the knob is the middle of what the ear hears.
//   tone  0 → 1   dark and soft → the plate's clear front over a dark tail:
//                 the input's high cut and the damping. Damping stays strong
//                 at every setting, so even a bright front darkens as it
//                 decays — that is the plate-into-cloud Ek liked.
export const REVERB_FIXED = Object.freeze({
  modDepth: 1.3, modRate: 0.25, diffusion: 1, lowCut: 110,
});
const expSweep = (a, b, t) => a * Math.pow(b / a, t);
export function reverbFromKnobs({ space = 0.5, tone = 0.5 } = {}) {
  const t = Math.min(1, Math.max(0, space)), u = Math.min(1, Math.max(0, tone));
  return {
    ...REVERB_FIXED,
    decay:    expSweep(0.8, 12, t),
    size:     expSweep(0.6, 2, t),
    predelay: 4 + 26 * t,
    highCut:  expSweep(6500, 15000, u),
    damping:  0.22 + 0.2 * u,
  };
}

// Starting points to audition, not a preset bank the app ships.
export const REVERB_VOICINGS = Object.freeze({
  room:   { decay: 0.9, damping: 0.35, size: 0.55, predelay: 4,  modDepth: 0.3, modRate: 0.6,  diffusion: 0.9 },
  plate:  { decay: 2.2, damping: 0.6,  size: 0.8,  predelay: 8,  modDepth: 0.5, modRate: 0.7,  diffusion: 1,  highCut: 13000 },
  hall:   { decay: 3.8, damping: 0.4,  size: 1.4,  predelay: 22, modDepth: 0.7, modRate: 0.35, diffusion: 1 },
  cloud:  { decay: 12,  damping: 0.3,  size: 2,    predelay: 40, modDepth: 1.6, modRate: 0.2,  diffusion: 1,  lowCut: 150, highCut: 8000 },
});
