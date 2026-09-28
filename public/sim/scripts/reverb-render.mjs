#!/usr/bin/env node
// ============================================================================
// reverb-render.mjs — hear js/reverb.js before it goes anywhere near the app
//
// Renders test sounds through each voicing and writes stereo WAVs:
//
//   node scripts/reverb-render.mjs                      # the built-in sounds
//   node scripts/reverb-render.mjs --in take.wav        # yours too (any WAV)
//   node scripts/reverb-render.mjs --set decay=5,damping=0.3   # one voicing, any knobs
//   node scripts/reverb-render.mjs --knobs space=0.6,tone=0.7    # the app's two knobs
//   node scripts/reverb-render.mjs --sweep space            # five positions, the other knob at 0.5
//   node scripts/reverb-render.mjs --out ~/Desktop/verbs
//
// Two folders under the output (default ./reverb-renders, gitignored):
//   wet/  the tail alone — how it will be used live: the instrument is the dry
//         sound in the room, the speakers carry only the reverb
//   mix/  dry + wet, for headphones
// Every file is peak-normalised to −1 dBFS, so compare tails, not levels.
// The voicings are REVERB_VOICINGS in js/reverb.js; index.txt lists the knobs.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { Reverb, REVERB_DEFAULTS, REVERB_VOICINGS, reverbFromKnobs } from '../js/reverb.js';

const SR = 48000, BLOCK = 128;
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const outDir = path.resolve(opt('--out') || 'reverb-renders');

// ── test sounds ─────────────────────────────────────────────────────────────
let seed = 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
const secs = s => new Float32Array(Math.round(s * SR));

function clap() {                       // a hand clap: three noise bursts
  const x = secs(0.5);
  for (const t0 of [0, 0.011, 0.023]) {
    const a = Math.round(t0 * SR);
    for (let i = 0; i < 0.03 * SR; i++) x[a + i] += rnd() * Math.exp(-i / (0.006 * SR)) * 0.6;
  }
  return x;
}
function pluck(freqs = [196, 247, 294, 392], gap = 0.45) {   // Karplus–Strong, a little phrase
  const x = secs(gap * freqs.length + 0.8);
  freqs.forEach((f, n) => {
    const L = Math.round(SR / f), d = new Float32Array(L).map(() => rnd() * 0.5);
    const a = Math.round(n * gap * SR);
    for (let i = 0, j = 0; i < 1.2 * SR; i++, j = (j + 1) % L) {
      const next = (j + 1) % L;
      d[j] = 0.996 * 0.5 * (d[j] + d[next]);
      x[a + i] += d[j];
    }
  });
  return x;
}
function sung() {                        // a held vowel-ish note with vibrato, then a short second one
  const x = secs(3.2);
  const note = (t0, dur, f0) => {
    let ph = 0, lp = 0;
    for (let i = 0; i < dur * SR; i++) {
      const t = i / SR, env = Math.min(1, t / 0.08) * Math.min(1, (dur - t) / 0.15);
      ph += 2 * Math.PI * f0 * (1 + 0.012 * Math.sin(2 * Math.PI * 5.2 * t)) / SR;
      let s = 0; for (let h = 1; h <= 12; h++) s += Math.sin(h * ph) / h * (h === 3 || h === 4 ? 1.8 : 1);
      lp += (s - lp) * 0.25;
      x[Math.round(t0 * SR) + i] += lp * env * 0.25;
    }
  };
  note(0, 1.4, 220); note(1.6, 0.5, 330);
  return x;
}
function readWav(file) {                 // PCM 16/24/32 or float 32, any channels → mono at 48 kHz (nearest)
  const b = fs.readFileSync(file);
  let p = 12, fmt, data;
  while (p < b.length) {
    const id = b.toString('ascii', p, p + 4), len = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { tag: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') data = b.subarray(p + 8, p + 8 + len);
    p += 8 + len + (len & 1);
  }
  if (!fmt || !data) throw new Error(`${file}: not a WAV this reads`);
  const bps = fmt.bits / 8, frames = Math.floor(data.length / (bps * fmt.ch));
  const read = (o) => fmt.tag === 3 ? data.readFloatLE(o)
    : fmt.bits === 16 ? data.readInt16LE(o) / 32768
    : fmt.bits === 24 ? ((data.readIntLE(o, 3)) / 8388608)
    : data.readInt32LE(o) / 2147483648;
  const n = Math.floor(frames * SR / fmt.sr), x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = Math.min(frames - 1, Math.floor(i * fmt.sr / SR));
    let s = 0; for (let c = 0; c < fmt.ch; c++) s += read((f * fmt.ch + c) * bps);
    x[i] = s / fmt.ch;
  }
  return x;
}
function writeWav(file, L, R) {           // 24-bit stereo
  const n = L.length, b = Buffer.alloc(44 + n * 6);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 6, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 6, 28); b.writeUInt16LE(6, 32); b.writeUInt16LE(24, 34);
  b.write('data', 36); b.writeUInt32LE(n * 6, 40);
  let peak = 1e-9; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.891 / peak;   // −1 dBFS
  for (let i = 0; i < n; i++) {
    b.writeIntLE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 8388607), 44 + i * 6, 3);
    b.writeIntLE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 8388607), 47 + i * 6, 3);
  }
  fs.writeFileSync(file, b);
}

// ── render ──────────────────────────────────────────────────────────────────
const sources = { clap: clap(), pluck: pluck(), sung: sung() };
const inFile = opt('--in');
if (inFile) sources[path.basename(inFile).replace(/\.[^.]+$/, '')] = readWav(inFile);

let voicings = { ...REVERB_VOICINGS };
const custom = opt('--set'), knobs = opt('--knobs'), sweep = opt('--sweep');
const pct = v => String(Math.round(v * 100)).padStart(3, '0');
if (knobs) {
  const k = Object.fromEntries(knobs.split(',').map(kv => { const [a, b] = kv.split('='); return [a, Number(b)]; }));
  voicings = { [`space${pct(k.space ?? 0.5)}-tone${pct(k.tone ?? 0.5)}`]: reverbFromKnobs(k) };
} else if (sweep) {
  voicings = {};
  for (const v of [0, 0.25, 0.5, 0.75, 1]) voicings[`${sweep}${pct(v)}`] = reverbFromKnobs({ [sweep]: v });
} else if (custom) {
  const p = Object.fromEntries(custom.split(',').map(kv => { const [k, v] = kv.split('='); return [k, v === 'true' ? true : v === 'false' ? false : Number(v)]; }));
  voicings = { custom: p };
}

fs.mkdirSync(path.join(outDir, 'wet'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'mix'), { recursive: true });
const index = [];
for (const [vn, vp] of Object.entries(voicings)) {
  const params = { ...REVERB_DEFAULTS, ...vp };
  index.push(`${vn}: ${Object.entries(vp).map(([k, v]) => `${k} ${typeof v === 'number' ? +v.toFixed(v < 10 ? 2 : 0) : v}`).join(', ')}`);
  for (const [sn, dry] of Object.entries(sources)) {
    const tail = Math.min(30, (params.freeze ? 4 : params.decay * 1.4) + 0.5);
    const n = Math.ceil((dry.length + tail * SR) / BLOCK) * BLOCK;
    const r = new Reverb(SR, { outputs: 2 });
    r.set(params, true);
    const wL = new Float32Array(n), wR = new Float32Array(n), inp = new Float32Array(BLOCK);
    const o = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    for (let b = 0; b < n; b += BLOCK) {
      for (let s = 0; s < BLOCK; s++) inp[s] = dry[b + s] || 0;
      r.process(inp, o, BLOCK);
      wL.set(o[0], b); wR.set(o[1], b);
    }
    writeWav(path.join(outDir, 'wet', `${sn}-${vn}.wav`), wL, wR);
    const mL = new Float32Array(n), mR = new Float32Array(n);
    for (let i = 0; i < n; i++) { const d = dry[i] || 0; mL[i] = d + 0.5 * wL[i]; mR[i] = d + 0.5 * wR[i]; }
    writeWav(path.join(outDir, 'mix', `${sn}-${vn}.wav`), mL, mR);
  }
}
for (const [sn, dry] of Object.entries(sources)) writeWav(path.join(outDir, `${sn}-dry.wav`), dry, dry);
fs.writeFileSync(path.join(outDir, 'index.txt'),
  `js/reverb.js, rendered ${new Date().toISOString().slice(0, 16)}\n\ndefaults: ` +
  Object.entries(REVERB_DEFAULTS).map(([k, v]) => `${k} ${v}`).join(', ') + '\n\n' + index.join('\n') + '\n');
console.log(`wrote ${Object.keys(voicings).length * Object.keys(sources).length * 2 + Object.keys(sources).length} files to ${outDir}`);
