// reverb.test.mjs — what the ear would catch in a bad reverb, measured
//
// The reverb (js/reverb.js) is tuned by ear, Ek's. These are the faults that
// can be measured before anyone listens: a decay that is not the one set,
// highs that do not die faster when damped, a tail that stays grainy, fixed
// resonances (the "metallic" sound), outputs that are copies of each other,
// a freeze that creeps, clicks when a knob moves, a cost the audio thread
// cannot afford, and an "off" that still costs.
//
// Run: node --test js/reverb.test.mjs   (part of `npm test`)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Reverb, REVERB_DEFAULTS, reverbFromKnobs } from './reverb.js';

const SR = 48000, BLOCK = 128;

// Render `seconds` of output for an input function (sample index → value).
function render(params, seconds, { outputs = 1, input = i => (i === 0 ? 1 : 0), onBlock } = {}) {
  const r = new Reverb(SR, { outputs });
  r.set(params, true);
  const n = Math.ceil(seconds * SR / BLOCK) * BLOCK;
  const out = Array.from({ length: outputs }, () => new Float32Array(n));
  const inBuf = new Float32Array(BLOCK), o = Array.from({ length: outputs }, () => new Float32Array(BLOCK));
  for (let b = 0; b < n; b += BLOCK) {
    onBlock?.(r, b);
    for (let s = 0; s < BLOCK; s++) inBuf[s] = input(b + s);
    r.process(inBuf, o, BLOCK);
    for (let k = 0; k < outputs; k++) out[k].set(o[k], b);
  }
  return { out, r };
}

// RT60 from an impulse response: Schroeder backward integration, a straight
// line fitted from −5 to −35 dB, extrapolated to 60 (T30).
function rt60(ir) {
  const e = new Float64Array(ir.length);
  let acc = 0;
  for (let i = ir.length - 1; i >= 0; i--) { acc += ir[i] * ir[i]; e[i] = acc; }
  const db = i => 10 * Math.log10(e[i] / e[0] + 1e-30);
  let i5 = 0; while (i5 < ir.length && db(i5) > -5) i5++;
  let i35 = i5; while (i35 < ir.length && db(i35) > -35) i35++;
  if (i35 >= ir.length - 1) return NaN;
  // least-squares slope over the window
  let sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0;
  for (let i = i5; i <= i35; i += 16) { const x = i / SR, y = db(i); sx += x; sy += y; sxx += x * x; sxy += x * y; m++; }
  const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx);   // dB per second
  return -60 / slope;
}

// One-pole band splits, run forward and backward (zero phase).
function onePole(x, fc, high) {
  const a = Math.exp(-2 * Math.PI * fc / SR), y = new Float32Array(x.length);
  let z = 0;
  for (let i = 0; i < x.length; i++) { z = x[i] + a * (z - x[i]); y[i] = z; }
  z = 0;
  for (let i = x.length - 1; i >= 0; i--) { z = y[i] + a * (z - y[i]); y[i] = z; }
  if (high) for (let i = 0; i < x.length; i++) y[i] = x[i] - y[i];
  return y;
}
const band = (x, lo, hi) => { let y = x; if (hi) y = onePole(onePole(y, hi, false), hi, false); if (lo) y = onePole(onePole(y, lo, true), lo, true); return y; };

function fftMag(x) {
  const n = x.length, re = Float64Array.from(x), im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar; im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar; im[i + k] += ai;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

// FIXED RESONANCES: the fine structure of the spectrum (dB above its own
// 1/3-octave smoothing) in two successive tail windows, correlated, and its
// 99th-percentile peak. A diffuse, modulated tail re-rolls its fine structure
// and peaks like noise (~10 dB); a ringing one keeps the same peaks, taller —
// which is what "metallic" is. The window must be long (1.4 s, 0.7 Hz bins):
// an FDN's modes sit ~2 Hz apart, and a short window blurs them into noise and
// cannot tell the two apart (measured: 0.28 against 0.04 at 16k points, 0.90
// against 0.02 at 64k).
function ringing(ir, t0, t1) {
  const N = 65536;
  const win = (a) => {
    const seg = new Float64Array(N);
    for (let i = 0; i < N; i++) seg[i] = (ir[a + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    const m = fftMag(seg), db = Array.from(m, v => 20 * Math.log10(v + 1e-12));
    const lo = Math.round(200 * N / SR), hi = Math.round(8000 * N / SR), fine = [];
    for (let k = lo; k < hi; k++) {
      const w = Math.max(1, Math.round(k * 0.115));   // ±1/6 octave
      let s = 0, c = 0;
      for (let j = k - w; j <= k + w; j++) { s += db[j]; c++; }
      fine.push(db[k] - s / c);
    }
    return fine;
  };
  const a = win(Math.round(t0 * SR)), b = win(Math.round(t1 * SR));
  const p99 = [...b].sort((x, y) => x - y)[Math.floor(0.99 * b.length)];
  const mean = v => v.reduce((x, y) => x + y, 0) / v.length;
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, dbb = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; dbb += (b[i] - mb) ** 2; }
  return { r: num / Math.sqrt(da * dbb), p99 };
}

function kurtosis(x) {
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  let v = 0, k = 0;
  for (const s of x) { const d = s - m; v += d * d; k += d * d * d * d; }
  v /= x.length; k /= x.length;
  return k / (v * v);
}

function corr(a, b, from, to) {
  let ab = 0, aa = 0, bb = 0;
  for (let i = from; i < to; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return ab / Math.sqrt(aa * bb);
}

test('the decay is the one set (T30, damping off)', () => {
  for (const decay of [0.8, 2.5, 6]) {
    const { out } = render({ decay, damping: 1, predelay: 0 }, decay * 1.6 + 0.5);
    const t = rt60(out[0]);
    assert.ok(Math.abs(t - decay) / decay < 0.15, `set ${decay} s, measured ${t.toFixed(2)} s`);
  }
});

test('damping makes the highs die first, and only when asked', () => {
  const lowHigh = (damping) => {
    const { out } = render({ decay: 3, damping, predelay: 0, highCut: 20000, lowCut: 20 }, 5);
    return [rt60(band(out[0], 0, 400)), rt60(band(out[0], 6000, 0))];
  };
  const [l1, h1] = lowHigh(1), [l4, h4] = lowHigh(0.4);
  assert.ok(Math.abs(h1 - l1) / l1 < 0.25, `undamped: low ${l1.toFixed(2)} s, high ${h1.toFixed(2)} s`);
  assert.ok(h4 < l4 * 0.75, `damping 0.4: low ${l4.toFixed(2)} s, high ${h4.toFixed(2)} s`);
});

test('the tail is dense — noise-like, not a flutter of echoes', () => {
  const { out } = render({ decay: 2.5, predelay: 0 }, 1);
  const ks = [];
  for (let t = 0.15; t < 0.45; t += 0.02) {
    const a = Math.round(t * SR);
    ks.push(kurtosis(out[0].subarray(a, a + Math.round(0.02 * SR))));
  }
  const worst = Math.max(...ks);
  assert.ok(worst < 4.5, `kurtosis per 20 ms window from 150 ms (Gaussian noise is 3): worst ${worst.toFixed(2)}`);
});

test('no fixed resonances: the modulation re-rolls the fine spectrum', () => {
  const still = render({ decay: 4, predelay: 0, modDepth: 0 }, 3.2).out[0];
  const moving = render({ decay: 4, predelay: 0 }, 3.2).out[0];
  const s = ringing(still, 0.3, 1.6), m = ringing(moving, 0.3, 1.6);
  // Unmodulated, the same peaks persist from one window to the next: the test
  // has to see ringing where it exists, or it proves nothing.
  assert.ok(s.r > 0.5, `unmodulated: fine-spectrum correlation ${s.r.toFixed(2)}`);
  assert.ok(m.r < 0.2, `modulated: fine-spectrum correlation ${m.r.toFixed(2)} (unmodulated ${s.r.toFixed(2)})`);
  assert.ok(m.p99 < 12, `modulated: 99th-percentile peak ${m.p99.toFixed(1)} dB over its smoothing (unmodulated ${s.p99.toFixed(1)})`);
});

test('every output is its own tail — decorrelated, 2 and 8 outputs', () => {
  for (const outputs of [2, 8]) {
    const { out } = render({ decay: 2.5, predelay: 0 }, 1.2, { outputs });
    let worst = 0;
    for (let a = 0; a < outputs; a++) for (let b = a + 1; b < outputs; b++)
      worst = Math.max(worst, Math.abs(corr(out[a], out[b], Math.round(0.1 * SR), Math.round(1.1 * SR))));
    assert.ok(worst < 0.2, `${outputs} outputs, worst pair |r| ${worst.toFixed(3)}`);
  }
});

test('freeze holds the tail without creeping up', () => {
  const noise = i => (i < SR * 0.5 ? (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.3 : 0);
  const { out } = render({ decay: 2 }, 12, {
    input: noise,
    onBlock: (r, b) => { if (b === SR * 0.7 - (SR * 0.7) % BLOCK) r.set({ freeze: true }); },
  });
  const rms = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += out[0][i] ** 2; return Math.sqrt(s / (b - a)); };
  const first = rms(SR * 2, SR * 3), last = rms(SR * 11, SR * 12);
  const db = 20 * Math.log10(last / first);
  assert.ok(out[0].every(Number.isFinite), 'finite');
  assert.ok(db > -3 && db < 1, `9 s into the freeze: ${db.toFixed(2)} dB`);
});

test('knobs move mid-tail without clicking', () => {
  const noise = i => (i < SR * 0.4 ? (Math.sin(i * 78.233) * 12345.678 % 1) * 0.3 : 0);
  const changes = { [SR * 0.8]: { decay: 6 }, [SR * 1.0]: { size: 1.7 }, [SR * 1.2]: { predelay: 120 },
                    [SR * 1.4]: { level: 0.3 }, [SR * 1.6]: { damping: 0.2 }, [SR * 1.8]: { freeze: true } };
  const { out } = render({ decay: 3 }, 2.2, {
    input: noise,
    onBlock: (r, b) => { for (const [at, p] of Object.entries(changes)) if (b === Number(at) - Number(at) % BLOCK) r.set(p); },
  });
  const x = out[0];
  const jump = (a, b) => { let m = 0; for (let i = a + 1; i < b; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
  const typical = jump(SR * 0.5, SR * 0.8);
  for (const at of Object.keys(changes).map(Number)) {
    const j = jump(at - 64, at + 2048);
    assert.ok(j < typical * 2, `change at ${(at / SR).toFixed(1)} s: largest step ${j.toFixed(4)} vs ${typical.toFixed(4)} before`);
  }
});

test('a frozen reverb with nothing in it idles — freeze costs nothing where it holds nothing', () => {
  const { r } = render({ decay: 2, freeze: true }, 1.5, { input: () => 0 });
  assert.ok(r.idle, 'frozen and silent is idle');
  const { r: r2 } = render({ decay: 2 }, 3, { input: i => (i < 4800 ? Math.sin(i) * 0.3 : 0),
    onBlock: (rv, b) => { if (b === 9600) rv.set({ freeze: true }); } });
  assert.ok(!r2.idle, 'frozen with a tail in it keeps running');
});

test('off is off: idle once the tail has gone, and nearly free', () => {
  const { r } = render({ decay: 1 }, 3);
  assert.ok(r.idle, 'idle after the tail');
  const o = [new Float32Array(BLOCK)], z = new Float32Array(BLOCK);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20000; i++) r.process(z, o, BLOCK);
  const us = Number(process.hrtime.bigint() - t0) / 1000 / 20000;
  assert.ok(us < 5, `idle block ${us.toFixed(2)} µs`);
});

test('cost per 128-sample block, against the 2667 µs budget', () => {
  const lines = [];
  for (const outputs of [1, 2, 8]) {
    const r = new Reverb(SR, { outputs });
    const inp = new Float32Array(BLOCK), o = Array.from({ length: outputs }, () => new Float32Array(BLOCK));
    for (let s = 0; s < BLOCK; s++) inp[s] = Math.sin(s * 0.37) * 0.2;
    for (let i = 0; i < 2000; i++) r.process(inp, o, BLOCK);          // warm the JIT
    const N = 8000, t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) r.process(inp, o, BLOCK);
    const us = Number(process.hrtime.bigint() - t0) / 1000 / N;
    lines.push(`${outputs} out: ${us.toFixed(1)} µs (${(100 * us / 2667).toFixed(2)} %)`);
    assert.ok(us < 2667 * 0.1, `${outputs} outputs: ${us.toFixed(1)} µs per block`);
  }
  console.log(`    reverb cost — ${lines.join(' · ')}`);
});

test('the two knobs sweep the way they say, and the ends decay as stated', () => {
  const at = v => reverbFromKnobs({ space: v });
  for (let v = 0; v < 1; v += 0.25) {
    assert.ok(at(v + 0.25).decay > at(v).decay && at(v + 0.25).size > at(v).size, `space rises at ${v}`);
    assert.ok(reverbFromKnobs({ tone: v + 0.25 }).highCut > reverbFromKnobs({ tone: v }).highCut, `tone brightens at ${v}`);
  }
  for (const space of [0, 1]) {
    const p = { ...reverbFromKnobs({ space }), damping: 1 };   // broadband decay, not the damped one
    const t = rt60(render(p, p.decay * 1.6 + 0.6).out[0]);
    assert.ok(Math.abs(t - p.decay) / p.decay < 0.15, `space ${space}: set ${p.decay.toFixed(1)} s, measured ${t.toFixed(2)} s`);
  }
});

test('defaults are sane', () => {
  assert.ok(REVERB_DEFAULTS.decay > 0 && REVERB_DEFAULTS.damping <= 1);
});
