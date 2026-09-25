// Tests for the grain worklet's edge behaviour — where a grain meets the end
// of the audio it is reading.
//
//     node --test js/grain-engine.test.mjs
//
// The worklet is loaded here with a two-line shim for AudioWorkletProcessor
// and registerProcessor, so these run in plain node with no AudioContext.
// They drive the processor exactly as the bridge does — 'init', 'addBuffer',
// 'candidates', 'liveBufferInit' / 'liveRecStart' / 'liveRecStop' — and read
// the slot arrays back.
//
// Why these exist (2026-09-02): a 500 ms take with a 700 ms grain used to
// slide every mark back to sample 0, so ten marks in a line were one sound;
// and a grain riding the live edge was cut to zeros mid-envelope at release,
// which is the click before the "restart". The last test listens for that
// click through process() rather than reading a slot, because the cut was
// never in any one number — it was in the output.

import test from 'node:test';
import assert from 'node:assert/strict';

const registry = {};
globalThis.AudioWorkletProcessor = class {
  constructor() { this.port = { onmessage: null, postMessage() {} }; }
};
globalThis.registerProcessor = (name, cls) => { registry[name] = cls; };
await import('./worklets/grain-engine.worklet.js');
const Proc = registry['grain-engine'];

const SR    = 48000;
const BLOCK = 128;

function makeProc(params = {}) {
  const p = new Proc();
  const sab = new SharedArrayBuffer(BLOCK * 4);
  p._handleMessage({
    type: 'init', sab, sampleRate: SR, bufferLength: BLOCK, numChannels: 1,
    params: { period: 1.0, duration: 1.0, volume: 1.0, ...params },
  });
  return p;
}

function addTake(p, seconds, fill) {
  const n = Math.round(seconds * SR);
  const data = new Float32Array(n);
  if (fill) for (let i = 0; i < n; i++) data[i] = fill(i);
  p._handleMessage({ type: 'addBuffer', data, length: n });
  return n;
}

const cand = (bufIndex, offset, length) =>
  ({ bufIndex, offset, length, azDeg: 0, elBias: 0, particleId: 0, radiusFade: 1 });

/** Fire one grain from one candidate; return its slot index, or -1 if dropped. */
function fireOne(p, c) {
  p._handleMessage({ type: 'candidates', list: [c] });
  const was = Uint8Array.from(p._gActive);
  p._fireGrain();
  for (let i = 0; i < p._gActive.length; i++) if (p._gActive[i] && !was[i]) return i;
  return -1;
}

const durOf = (p, i) => Math.round(1 / p._gPhaseInc[i]);

/** Put the worklet into a live recording with `edge` samples already written. */
function goLive(p, edge) {
  p._handleMessage({ type: 'liveBufferInit', chunkSize: SR });
  p._handleMessage({ type: 'liveRecStart' });
  p._liveBufLen = edge;
}

// ── Sealed buffers ───────────────────────────────────────────────────────────

test('a mark near the end keeps its offset and the grain shortens to what exists', () => {
  const p = makeProc({ duration: 1.0 });
  const n = addTake(p, 0.5);                       // 500 ms take, 1000 ms grain
  for (const offset of [0, 12000, 19200]) {        // marks at 0, 250, 400 ms
    const i = fireOne(p, cand(0, offset, n));
    assert.ok(i >= 0, `grain at ${offset} fired`);
    assert.equal(p._gBufOffset[i], offset, 'the grain starts at its mark');
    assert.equal(durOf(p, i), n - offset, 'and plays exactly what is left');
  }
});

test('three marks in a line are three different sounds, not one', () => {
  const p = makeProc({ duration: 1.0 });
  const n = addTake(p, 0.5);
  const starts = [0, 12000, 19200].map(o => p._gBufOffset[fireOne(p, cand(0, o, n))]);
  assert.equal(new Set(starts).size, 3);
});

test('a grain in the middle of a long take is untouched', () => {
  const p = makeProc({ duration: 0.2 });
  const n = addTake(p, 4.0);
  const i = fireOne(p, cand(0, 48000, n));
  assert.equal(p._gBufOffset[i], 48000);
  assert.equal(durOf(p, i), Math.round(0.2 * SR));
});

test('under 64 samples of audio the grain is dropped rather than clicked', () => {
  const p = makeProc({ duration: 1.0 });
  const n = addTake(p, 0.5);
  assert.equal(fireOne(p, cand(0, n - 10, n)), -1);
  assert.equal(p._activeCount, 0);
});

test('a reverse grain near the end reads down from the end to its mark', () => {
  const p = makeProc({ duration: 1.0, direction: 1 });
  const n = addTake(p, 0.5);
  const i = fireOne(p, cand(0, 19200, n));
  assert.ok(i >= 0);
  assert.equal(durOf(p, i), n - 19200);
  assert.equal(Math.round(p._gReadPos[i]), n, 'starts at the last sample');
  assert.ok(p._gReadRate[i] < 0);
});

// ── The live edge ────────────────────────────────────────────────────────────

test('while recording, a forward grain keeps its full length and follows the edge', () => {
  const p = makeProc({ duration: 1.0 });
  goLive(p, 24000);
  const i = fireOne(p, cand(-2, 21600, 48000 * 4));
  assert.equal(p._gBufOffset[i], 21600);
  assert.equal(durOf(p, i), SR, 'a full second, most of it not played yet');
});

test('a mark aimed past the edge starts at the edge instead of reading zeros', () => {
  const p = makeProc({ duration: 1.0 });
  goLive(p, 24000);
  const i = fireOne(p, cand(-2, 30000, 48000 * 4));
  assert.equal(p._gBufOffset[i], 24000);
});

test('a pitched-up grain ends where it would overtake the edge', () => {
  const p = makeProc({ duration: 1.0, pitchShift: 1200 });   // rate 2
  goLive(p, 24000);
  const i = fireOne(p, cand(-2, 12000, 48000 * 4));
  // starts 12000 behind an edge that advances 1/sample while it reads 2/sample
  assert.equal(durOf(p, i), 12000);
});

test('a reverse grain during recording starts at the edge, not beyond it', () => {
  const p = makeProc({ duration: 1.0, direction: 1 });
  goLive(p, 24000);
  const i = fireOne(p, cand(-2, 12000, 48000 * 4));
  assert.equal(Math.round(p._gReadPos[i]), 24000);
  assert.equal(durOf(p, i), 12000);
});

test('at release, a grain riding the edge lands its envelope on the last audio', () => {
  const p = makeProc({ duration: 1.0 });
  goLive(p, 24000);
  const i = fireOne(p, cand(-2, 23000, 48000 * 4));
  p._gReadPos[i] = 23500;                 // 500 samples of audio left
  p._gPhase[i]   = 0.2;                   // 80 % of the envelope still to go
  p._handleMessage({ type: 'liveRecStop' });
  assert.equal(p._gBufLen[i], 24000);
  assert.ok(Math.abs(0.8 / p._gPhaseInc[i] - 500) < 1, 'ends in exactly the 500 samples that exist');
});

test('at release, a grain with more audio than envelope left is not touched', () => {
  const p = makeProc({ duration: 0.1 });   // 4800-sample grain
  goLive(p, 24000);
  const i = fireOne(p, cand(-2, 1000, 48000 * 4));
  const inc = p._gPhaseInc[i];
  p._handleMessage({ type: 'liveRecStop' });
  assert.equal(p._gPhaseInc[i], inc);
});

test('a new take fades the previous take\'s live grains within one block', () => {
  const p = makeProc({ duration: 1.0 });
  goLive(p, 24000);
  const i = fireOne(p, cand(-2, 1000, 48000 * 4));
  p._gPhase[i] = 0.5;
  p._handleMessage({ type: 'liveRecStop' });
  p._handleMessage({ type: 'liveBufferInit', chunkSize: SR });
  assert.ok(Math.abs(0.5 / p._gPhaseInc[i] - 128) < 1);
});

// ── Listening for the click ─────────────────────────────────────────────────
// A 1 kHz sine at 0.5 is recorded live; a grain with a short attack rides the
// edge at full level; the recording stops mid-grain. The largest
// sample-to-sample step in the output is what a click IS. The sine alone
// steps by 0.065; the old hard cut stepped by the whole instantaneous level,
// up to 0.5. The stop is tried at several timings so the cut cannot hide on a
// zero crossing.

function maxStepWhenStoppedAfter(blocksBeforeStop) {
  const p = makeProc({ duration: 0.5, period: 0.05, fadeRatio: 0.1 });
  p._handleMessage({ type: 'liveBufferInit', chunkSize: SR });
  p._handleMessage({ type: 'liveRecStart' });

  const inBlock  = new Float32Array(BLOCK);
  const outBlock = new Float32Array(BLOCK);
  const outputs  = [[outBlock], [new Float32Array(BLOCK)]];
  let t = 0;
  const out = [];
  const run = (blocks, silent = false) => {
    for (let b = 0; b < blocks; b++) {
      for (let s = 0; s < BLOCK; s++, t++) inBlock[s] = silent ? 0 : 0.5 * Math.sin(2 * Math.PI * 1000 * t / SR);
      p.process([[inBlock]], outputs);
      out.push(...outBlock);
    }
  };

  p._handleMessage({ type: 'candidates', list: [] });
  run(50);                                                  // 6400 samples in, nothing firing
  p._handleMessage({ type: 'candidates', list: [cand(-2, p._liveBufLen - 100, SR * 4)] });
  while (p._activeCount === 0) run(1);                      // exactly one grain fires…
  p._handleMessage({ type: 'candidates', list: [] });       // …and no more after it
  run(blocksBeforeStop);                                    // it rides the edge at full level
  assert.equal(p._activeCount, 1, 'one grain is sounding');
  p._handleMessage({ type: 'liveRecStop' });
  run(400, true);                                           // silence in, grains land and end
  assert.equal(p._activeCount, 0, 'every grain has ended');

  let maxStep = 0;
  for (let i = 1; i < out.length; i++) maxStep = Math.max(maxStep, Math.abs(out[i] - out[i - 1]));
  return maxStep;
}

test('stopping a recording under a grain produces no step in the output', () => {
  for (const blocks of [40, 41, 43, 47, 53, 61]) {
    const step = maxStepWhenStoppedAfter(blocks);
    assert.ok(step < 0.12, `stopped after ${blocks} blocks: largest step ${step.toFixed(3)} — that is a click`);
  }
});

// ── Start jitter at the edges (2026-09-05) ───────────────────────────────────
// A jittered read that lands outside the audio is DROPPED, not clamped. The
// clamp put every early grain of a dense brush on sample 0 or the frontier —
// twenty-seven copies 15 ms apart, a comb filter — for the first jitter-width
// of every take.

function fireMany(p, c, n) {
  const starts = [];
  for (let k = 0; k < n; k++) {
    const i = fireOne(p, c);
    if (i >= 0) { starts.push(p._gBufOffset[i]); p._gActive[i] = 0; p._freeList[p._freePtr++] = i; }
  }
  return starts;
}

test('a jittered read outside a sealed take is dropped, never clamped to sample 0', () => {
  const p = makeProc({ duration: 0.4, startJitter: 0.4 });   // ±400 ms around the mark
  const n = addTake(p, 0.2);                                  // a 200 ms take
  const starts = fireMany(p, cand(0, 4800, n), 400);          // mark at 100 ms
  assert.ok(starts.length > 0, 'some grains fire');
  assert.ok(starts.every(o => o > 0 && o < n), 'every fired grain reads audio that exists, off both edges');
  assert.ok(starts.length < 200, `most jittered reads fall outside a take this short and are dropped (${starts.length} of 400 fired)`);
  assert.ok(new Set(starts).size > starts.length * 0.9, 'and they do not pile up on one sample');
});

test('while recording, a jittered read past the edge is dropped rather than slid to the edge', () => {
  const p = makeProc({ duration: 0.4, startJitter: 0.4 });
  goLive(p, 24000);                                           // 500 ms written so far
  const starts = fireMany(p, cand(-2, 21600, 48000 * 4), 400); // mark 50 ms behind the edge
  assert.ok(starts.length > 0);
  assert.ok(starts.every(o => o < 24000), 'nothing starts AT the edge by being slid there');
  assert.ok(starts.every(o => o >= 0));
});

test('away from the edges, jitter drops nothing — density is what the brush says', () => {
  const p = makeProc({ duration: 0.4, startJitter: 0.4 });
  const n = addTake(p, 4.0);
  const starts = fireMany(p, cand(0, 96000, n), 200);         // mark at 2 s of 4
  assert.equal(starts.length, 200);
  assert.ok(starts.every(o => o >= 96000 - 19200 && o <= 96000 + 19200));
});

test('an unjittered mark aimed past the edge still starts at the edge', () => {
  const p = makeProc({ duration: 1.0, startJitter: 0 });
  goLive(p, 24000);
  const i = fireOne(p, cand(-2, 30000, 48000 * 4));
  assert.equal(p._gBufOffset[i], 24000);
});

// ── No allocation on the audio thread while recording (R5, 2026-09-06) ──────
// A take that outgrows a chunk pops a spare the bridge transferred in; only
// with no spare does process() allocate, and it says so. A clear hands the
// extra chunk back as a spare, and the feedback is a typed copy.

function feed(p, samples) {
  const inputs = [[new Float32Array(BLOCK).fill(0.1)]];
  const out = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
  for (let i = 0; i < samples / BLOCK; i++) p.process(inputs, out);
}

test('a take past the chunk boundary pops a spare and allocates nothing', () => {
  const p = makeProc();
  p._handleMessage({ type: 'liveBufferInit', chunkSize: 4096 });
  p._handleMessage({ type: 'liveSpare', buffer: new ArrayBuffer(4096 * 4) });
  p._handleMessage({ type: 'liveRecStart' });
  feed(p, 4096 * 2);                                   // two chunks' worth
  assert.equal(p._liveChunks.length, 2);
  assert.equal(p._liveBufLen, 4096 * 2);
  assert.equal(p._chunkAllocs, 0, 'the second chunk was the spare');
  assert.equal(p._spareLow, true, 'and it asks for the next');
});

test('with no spare in, the allocation happens and is counted', () => {
  const p = makeProc();
  p._handleMessage({ type: 'liveBufferInit', chunkSize: 4096 });
  p._handleMessage({ type: 'liveRecStart' });
  feed(p, 4096 * 2);
  assert.equal(p._liveChunks.length, 2);
  assert.equal(p._chunkAllocs, 1);
});

test('a clear returns the extra chunk as a spare, so the next long take allocates nothing', () => {
  const p = makeProc();
  p._handleMessage({ type: 'liveBufferInit', chunkSize: 4096 });
  p._handleMessage({ type: 'liveRecStart' });
  feed(p, 4096 * 2);                                   // allocates once (no spare yet)
  p._handleMessage({ type: 'liveRecStop' });
  p._handleMessage({ type: 'liveBufferClear' });
  assert.equal(p._liveChunks.length, 1);
  assert.equal(p._spareChunks.length, 1, 'the second chunk is a spare now');
  p._handleMessage({ type: 'liveBufferInit', chunkSize: 4096 });
  p._handleMessage({ type: 'liveRecStart' });
  feed(p, 4096 * 2);
  assert.equal(p._chunkAllocs, 1, 'no new allocation');
});

test('a spare of the wrong size is refused, and at most two are kept', () => {
  const p = makeProc();
  p._handleMessage({ type: 'liveBufferInit', chunkSize: 4096 });
  p._handleMessage({ type: 'liveSpare', buffer: new ArrayBuffer(100) });
  assert.equal(p._spareChunks.length, 0);
  for (let i = 0; i < 4; i++) p._handleMessage({ type: 'liveSpare', buffer: new ArrayBuffer(4096 * 4) });
  assert.equal(p._spareChunks.length, 2);
});

test('the feedback posts a typed copy of the grain ids', () => {
  const p = makeProc({ duration: 0.1 });
  const n = addTake(p, 1.0);
  const posted = [];
  p.port.postMessage = m => posted.push(m);
  fireOne(p, cand(0, 1000, n));
  const inputs = [[]], out = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
  for (let i = 0; i < 20; i++) p.process(inputs, out);   // past the 1600-sample feedback timer
  const fb = posted.find(m => m.type === 'feedback');
  assert.ok(fb, 'a feedback was posted');
  assert.ok(fb.grains instanceof Int32Array, 'grains is an Int32Array');
  // The cursor's own onset clock fires from the same candidate too, so the
  // count is at least one; every id is that candidate's particle.
  assert.ok(fb.grains.length >= 1);
  for (const id of fb.grains) assert.equal(id, 0);
});

// ── The candidate tables (R3, 2026-09-06) ───────────────────────────────────
// The bridge writes rows into a shared table; the worklet reads a candidate by
// row at fire time. These build a table by hand with the same layout.
const CT_ROWS = 8192, CT_WORDS = 8, CT_HEADER = 4, CT_HALF = CT_ROWS * CT_WORDS + CT_ROWS, CT_REGION = CT_HEADER + 2 * CT_HALF;
function makeTables() { return new SharedArrayBuffer(9 * CT_REGION * 4); }
function writeRegion(sab, region, rows, { half = 0, perm = null } = {}) {
  const I = new Int32Array(sab), F = new Float32Array(sab);
  const hdr = region * CT_REGION, base = hdr + CT_HEADER + half * CT_HALF;
  rows.forEach((r, k) => { const w = base + k * CT_WORDS; I[w] = r.bufIndex; I[w+1] = r.offset; I[w+2] = r.length; F[w+3] = r.azDeg ?? 0; F[w+4] = r.elBias ?? 0; I[w+5] = r.particleId ?? k; F[w+6] = r.radiusFade ?? 1; I[w+7] = r.ov ?? 0; });
  const p = perm || rows.map((_, k) => k);
  for (let k = 0; k < p.length; k++) I[base + CT_ROWS * CT_WORDS + k] = p[k];
  I[hdr + 1 + half] = rows.length; I[hdr] = half; I[hdr + 3]++;
}
function fireNew(p, voice) {
  const was = Uint8Array.from(p._gActive);
  p._fireGrain(voice);
  for (let i = 0; i < p._gActive.length; i++) if (p._gActive[i] && !was[i]) return i;
  return -1;
}

test('the live voice fires from region 0 of the tables', () => {
  const p = makeProc({ duration: 0.2 });
  const n = addTake(p, 2.0);
  const sab = makeTables();
  writeRegion(sab, 0, [{ bufIndex: 0, offset: 12345, length: n }]);
  p._handleMessage({ type: 'cursorTables', sab });
  p._handleMessage({ type: 'cursorVoicesTab', voices: [], liveActive: true, lensStep: false });
  const i = fireNew(p);
  assert.ok(i >= 0, 'a grain fired');
  assert.equal(p._gBufOffset[i], 12345, 'from the row, not from a message');
});

test('a voice slot fires from its region, and step mode walks the permutation', () => {
  const p = makeProc({ duration: 0.2 });
  const n = addTake(p, 2.0);
  const sab = makeTables();
  writeRegion(sab, 2, [{ bufIndex: 0, offset: 30000, length: n }, { bufIndex: 0, offset: 10000, length: n }, { bufIndex: 0, offset: 20000, length: n }], { perm: [1, 2, 0] });
  p._handleMessage({ type: 'cursorTables', sab });
  p._handleMessage({ type: 'cursorVoicesTab', voices: [{ slot: 2, vo: 7, params: { period: 0.01, duration: 0.2, volume: 1 } }], liveActive: false, lensStep: true });
  const v = p._cursorVoices[1];
  assert.equal(v.active, true); assert.equal(v.tabRegion, 2); assert.equal(v.lensStep, true);
  const offs = [0, 1, 2].map(() => p._gBufOffset[fireNew(p, v)]);
  assert.deepEqual(offs, [10000, 20000, 30000], 'ascending by offset, through the permutation');
});

test('the published half is the one read: a write to the other half is invisible until it flips', () => {
  const p = makeProc({ duration: 0.2 });
  const n = addTake(p, 2.0);
  const sab = makeTables();
  writeRegion(sab, 0, [{ bufIndex: 0, offset: 111, length: n }], { half: 0 });
  p._handleMessage({ type: 'cursorTables', sab });
  p._handleMessage({ type: 'cursorVoicesTab', voices: [], liveActive: true, lensStep: false });
  const I = new Int32Array(sab);
  const base1 = CT_HEADER + CT_HALF; I[base1] = 0; I[base1 + 1] = 222; I[base1 + 2] = n; I[2] = 1;   // half 1 written, half 0 still published
  assert.equal(p._gBufOffset[fireNew(p)], 111);
  I[0] = 1;                                              // flip
  assert.equal(p._gBufOffset[fireNew(p)], 222);
});

test('without tables, the message path still fires as before', () => {
  const p = makeProc({ duration: 0.2 });
  const n = addTake(p, 1.0);
  const i = fireOne(p, cand(0, 4321, n));
  assert.equal(p._gBufOffset[i], 4321);
});

// ── Mark overrides (2026-09-25) ─────────────────────────────────────────────
// A knob ridden while a stroke was painted rides on the marks it moved, not on
// a new voice: one voice, one clock, and each grain plays its own mark's value.

test('a mark override reaches its own grain and no other', () => {
  const p = makeProc({ duration: 0.2 });
  const n = addTake(p, 2.0);
  const sab = makeTables();
  writeRegion(sab, 1, [{ bufIndex: 0, offset: 1000, length: n }, { bufIndex: 0, offset: 2000, length: n, ov: 5 }]);
  p._handleMessage({ type: 'cursorTables', sab });
  p._handleMessage({ type: 'markOverride', id: 5, params: { pitchShift: 1200, duration: 0.05 } });
  p._handleMessage({ type: 'cursorVoicesTab', voices: [{ slot: 1, vo: 3, params: { period: 0.01, duration: 0.2, volume: 1, pitchShift: 0 } }], liveActive: false, lensStep: true });
  const v = p._cursorVoices[0];
  const a = fireNew(p, v), b = fireNew(p, v);
  assert.equal(p._gBufOffset[a], 1000); assert.equal(p._gBufOffset[b], 2000);
  assert.equal(p._gReadRate[a], 1, 'the plain mark plays the voice');
  assert.equal(p._gReadRate[b], 2, 'the overridden mark plays an octave up');
  assert.ok(Math.abs(1 / p._gPhaseInc[b] - 0.05 * SR) < 2, 'and its own duration');
  assert.ok(Math.abs(1 / p._gPhaseInc[a] - 0.2 * SR) < 2);
});

test('a mark that moved the period sets the next onset on the one clock', () => {
  const p = makeProc({ duration: 0.05 });
  const n = addTake(p, 2.0);
  const sab = makeTables();
  writeRegion(sab, 1, [{ bufIndex: 0, offset: 1000, length: n, ov: 9 }]);
  p._handleMessage({ type: 'cursorTables', sab });
  p._handleMessage({ type: 'markOverride', id: 9, params: { period: 0.002 } });
  p._handleMessage({ type: 'cursorVoicesTab', voices: [{ slot: 1, vo: 3, params: { period: 0.05, duration: 0.05, volume: 1 } }], liveActive: false, lensStep: false });
  p._firePeriod = 0;
  fireNew(p, p._cursorVoices[0]);
  assert.equal(p._firePeriod, Math.round(0.002 * SR), 'the mark\'s period, not the voice\'s');
  p._handleMessage({ type: 'markOverridesReset' });
  fireNew(p, p._cursorVoices[0]);
  assert.equal(p._firePeriod, 0, 'after a reset the id is unknown and the voice rules');
});

test('the message path carries the override on the candidate', () => {
  const p = makeProc({ duration: 0.2 });
  const n = addTake(p, 1.0);
  p._handleMessage({ type: 'markOverride', id: 2, params: { direction: 1 } });
  p._handleMessage({ type: 'cursorVoices', list: [{ vo: 4, params: { period: 0.05, duration: 0.05, volume: 1 },
    candidates: [{ bufIndex: 0, offset: 4000, length: n, azDeg: 0, elBias: 0, particleId: 0, radiusFade: 1, ov: 2 }] }], lensStep: false });
  const i = fireNew(p, p._cursorVoices[0]);
  assert.ok(p._gReadRate[i] < 0, 'reversed by its mark');
});

// ── Voice slots (P4, 2026-09-06) ────────────────────────────────────────────
// Sixteen distinct frozen brushes may sound under one cursor, not eight. A
// bucket that finds no free voice is SILENT for that tick, so the cap is a
// musical limit, not a safety one — and the tables must have a region per
// voice or a raised cap fails quietly (that check is in the bridge's own
// constant, derived from this one).

test('sixteen distinct voicings all get a voice', () => {
  const p = makeProc({ duration: 0.05 });
  const n = addTake(p, 1.0);
  const list = [];
  for (let v = 1; v <= 16; v++) list.push({ vo: v, params: { period: 0.05, duration: 0.05, volume: 0.5 },
    candidates: [{ bufIndex: 0, offset: v * 100, length: n, azDeg: 0, elBias: 0, particleId: v, radiusFade: 1 }] });
  p._handleMessage({ type: 'cursorVoices', list, lensStep: false });
  assert.equal(p._cursorVoices.filter(v => v.active).length, 16);
});

test('a seventeenth is dropped, not folded onto another voice', () => {
  const p = makeProc({ duration: 0.05 });
  const n = addTake(p, 1.0);
  const list = [];
  for (let v = 1; v <= 20; v++) list.push({ vo: v, params: { period: 0.05, duration: 0.05, volume: 0.5 },
    candidates: [{ bufIndex: 0, offset: v * 100, length: n, azDeg: 0, elBias: 0, particleId: v, radiusFade: 1 }] });
  p._handleMessage({ type: 'cursorVoices', list, lensStep: false });
  const active = p._cursorVoices.filter(v => v.active);
  assert.equal(active.length, 16);
  assert.equal(new Set(active.map(v => v.candidates[0].offset)).size, 16, 'sixteen different sources');
});

// ── The grain filter (2026-09-23) ───────────────────────────────────────────
// ONE state-variable filter per grain — a type, a cutoff, a resonance. A take
// of two tones an octave-and-more either side of the cutoff is played through
// one long grain; the power at each tone says which side the filter kept.
// Measured through process(), because the filter lives in the render loop.

function tonePower(samples, hz) {          // Goertzel, one bin
  const w = 2 * Math.PI * hz / SR, c = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  for (const x of samples) { s0 = x + c * s1 - s2; s2 = s1; s1 = s0; }
  return (s1 * s1 + s2 * s2 - c * s1 * s2) / (samples.length * samples.length);
}

function grainThrough(filter) {
  const p = makeProc({ duration: 0.6, period: 10, volume: 1.0, envShape: 2, fadeRatio: 0.02, ...filter });
  const n = addTake(p, 1.0, i => 0.4 * Math.sin(2 * Math.PI * 200 * i / SR) + 0.4 * Math.sin(2 * Math.PI * 6000 * i / SR));
  assert.ok(fireOne(p, cand(0, 0, n)) >= 0, 'the grain fired');
  const outBlock = new Float32Array(BLOCK);
  const outputs = [[outBlock], [new Float32Array(BLOCK)]];
  const inputs = [[new Float32Array(BLOCK)]];
  const out = [];
  for (let b = 0; b < Math.round(0.5 * SR / BLOCK); b++) { p.process(inputs, outputs); out.push(...outBlock); }
  const mid = out.slice(Math.round(0.1 * SR), Math.round(0.4 * SR));   // steady state, inside the envelope
  return { lo: tonePower(mid, 200), hi: tonePower(mid, 6000) };
}

test('with the filter off, both tones pass untouched', () => {
  const { lo, hi } = grainThrough({ filterType: 0, cutoff: 1000, res: 0 });
  assert.ok(lo > 0.03 && hi > 0.03, `lo ${lo.toFixed(4)} hi ${hi.toFixed(4)}`);
  assert.ok(Math.abs(lo / hi - 1) < 0.1, 'and at the same level');
});

test('a low-pass keeps the tone below the cutoff and loses the one above', () => {
  const { lo, hi } = grainThrough({ filterType: 1, cutoff: 1000, res: 0 });
  assert.ok(lo > 0.03, `low tone kept: ${lo.toFixed(4)}`);
  assert.ok(hi < lo / 100, `high tone gone: ${hi.toFixed(6)} against ${lo.toFixed(4)}`);
});

test('a high-pass does the opposite', () => {
  const { lo, hi } = grainThrough({ filterType: 3, cutoff: 1000, res: 0 });
  assert.ok(hi > 0.03, `high tone kept: ${hi.toFixed(4)}`);
  assert.ok(lo < hi / 100, `low tone gone: ${lo.toFixed(6)} against ${hi.toFixed(4)}`);
});

test('a band-pass at one tone keeps it at unity and loses the other', () => {
  const { lo, hi } = grainThrough({ filterType: 2, cutoff: 6000, res: 1 });
  const { hi: ref } = grainThrough({ filterType: 0, cutoff: 6000, res: 0 });
  assert.ok(Math.abs(hi / ref - 1) < 0.15, `the band is normalised: ${hi.toFixed(4)} against ${ref.toFixed(4)}`);
  assert.ok(lo < hi / 100, `the far tone is gone: ${lo.toFixed(6)}`);
});

test('resonance raises the cutoff, and no more than the ceiling', () => {
  const flat = grainThrough({ filterType: 1, cutoff: 6000, res: 0 });
  const ring = grainThrough({ filterType: 1, cutoff: 6000, res: 1 });
  const gainDb = 10 * Math.log10(ring.hi / flat.hi);
  assert.ok(gainDb > 18 && gainDb < 26, `+${gainDb.toFixed(1)} dB at the cutoff (Q 0.707 → 10 is +23)`);
});

test('an audio-rate grain is not filtered at all', () => {
  const p = makeProc({ duration: 0.003, filterType: 1, cutoff: 200, res: 0 });
  const n = addTake(p, 0.1);
  const i = fireOne(p, cand(0, 0, n));
  assert.ok(i >= 0);
  assert.equal(p._gFilterType[i], 0);
});
