// Tests for the .mubone container.
//
//     node --test js/mubone-file.test.mjs
//
// No browser: a take is four properties (js/take.js), and the
// container's own answers — the bytes of a zip record, a CRC, whether two slots
// sharing a buffer write one member — are all knowable in advance. What a
// browser would add is decodeAudioData, which only the sample-rate-mismatch path
// uses; that one is exercised by the rig.
//
// The last test is the one that matters most: a real `unzip` has to accept the
// file. A container that only this module can read would pass every round trip
// here and still be broken.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  AudioTable, writePiece, readPiece, blobSink, blobSource,
  MANIFEST_NAME, AUDIO_PREFIX, __testInternals,
} from './mubone-file.js';
import { makeTake } from './take.js';

// ── A take, and the context readPiece resamples against ─────────────────────

function makeBuffer(frames, sampleRate = 48000, fill = null) {
  const d = new Float32Array(frames);
  if (fill) for (let i = 0; i < frames; i++) d[i] = fill(i);
  return makeTake(d, sampleRate);
}

const ctx = { sampleRate: 48000 };

const roundTrip = async (manifest, audio) => {
  const blob = await writePiece(manifest, audio, blobSink());
  return { blob, ...(await readPiece(blobSource(blob), ctx)) };
};

// ── The audio ───────────────────────────────────────────────────────────────

test('a mono take comes back bit for bit, including samples past ±1', async () => {
  // The old JSON path wrote 16-bit and clamped: this sine reached 1.5 and came
  // back at 1.0. That silent clip is the reason the members are float32.
  const src = makeBuffer(4800, 48000, (i) => Math.sin(i * 0.05) * 1.5);
  const audio = new AudioTable();
  const id = audio.idFor(src);
  const { audio: back } = await roundTrip({ id }, audio);
  const a = src.data, b = back.get(id).data;
  assert.equal(b.length, a.length);
  for (let i = 0; i < a.length; i++) assert.equal(b[i], a[i], `sample ${i}`);
  assert.equal(Math.max(...b.map(Math.abs)), 1.5);
  assert.ok(b.buffer instanceof SharedArrayBuffer, 'a loaded take is shared memory');
});

test('a stereo member from an older file comes back as its first channel', async () => {
  // Nothing writes stereo any more; the reader still meets it.
  const frames = 1000;
  const { wavChunks } = __testInternals;
  const mono = makeBuffer(frames, 48000, (i) => i / frames);
  const [header] = [...wavChunks(mono)];
  const dv = new DataView(header.buffer, header.byteOffset);
  dv.setUint16(22, 2, true); dv.setUint32(28, 48000 * 2 * 4, true); dv.setUint16(32, 8, true); dv.setUint32(40, frames * 8, true);
  dv.setUint32(4, 36 + frames * 8, true);
  const inter = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) { inter[2 * i] = i / frames; inter[2 * i + 1] = -(i / frames); }
  const bytes = new Uint8Array(44 + frames * 8);
  bytes.set(header, 0); bytes.set(new Uint8Array(inter.buffer), 44);
  const got = await __testInternals.bufferFromWav(bytes, ctx);
  assert.equal(got.length, frames);
  for (let i = 0; i < frames; i++) assert.equal(got.data[i], mono.data[i], `sample ${i}`);
});

test('a take longer than one write chunk crosses the boundary intact', async () => {
  // WAV_CHUNK_FRAMES is 262144; this take spans three chunks including a partial.
  const frames = 600000;
  const src = makeBuffer(frames, 48000, (i) => ((i % 977) / 977) * 2 - 1);
  const audio = new AudioTable();
  const id = audio.idFor(src);
  const { audio: back } = await roundTrip({ id }, audio);
  const a = src.data, b = back.get(id).data;
  assert.equal(b.length, frames);
  for (const i of [0, 262143, 262144, 524287, 524288, frames - 1]) assert.equal(b[i], a[i], `sample ${i}`);
});

test('the sample rate rides in the member, not the context', async () => {
  const src = makeBuffer(100, 48000, () => 0.25);
  const audio = new AudioTable();
  const id = audio.idFor(src);
  const { audio: back } = await roundTrip({ id }, audio);
  assert.equal(back.get(id).sampleRate, 48000);
});

// ── One member per distinct buffer (audit § E7) ─────────────────────────────

test('two slots sharing one buffer write one member', async () => {
  const shared = makeBuffer(500, 48000, (i) => i / 500);
  const audio = new AudioTable();
  const a = audio.idFor(shared);
  const b = audio.idFor(shared);
  assert.equal(a, b);
  assert.equal(audio.size, 1);
});

test('two distinct buffers holding the same audio also collapse', async () => {
  const one = makeBuffer(500, 48000, (i) => i / 500);
  const two = makeBuffer(500, 48000, (i) => i / 500);
  const audio = new AudioTable();
  assert.equal(audio.idFor(one), audio.idFor(two));
  assert.equal(audio.size, 1);
});

test('different audio and different geometry separate', async () => {
  const audio = new AudioTable();
  const id = (b) => audio.idFor(b);
  const base  = id(makeBuffer(500, 48000, (i) => i / 500));
  const other = id(makeBuffer(500, 48000, (i) => 1 - i / 500));
  const short = id(makeBuffer(499, 48000, (i) => i / 500));
  assert.equal(new Set([base, other, short]).size, 3);
  // The geometry is in the id, so a hash collision alone cannot merge two
  // members of different shape.
  assert.match(base, /^[0-9a-f]{16}-500-1$/);
});

test('a pinned loop\'s region (an AudioBuffer) writes the same member as the take', async () => {
  const take = makeBuffer(500, 48000, (i) => i / 500);
  const region = { length: 500, sampleRate: 48000, duration: 500 / 48000, getChannelData: () => new Float32Array(take.data) };
  const audio = new AudioTable();
  assert.equal(audio.idFor(region), audio.idFor(take));
  const { audio: back } = await roundTrip({ id: audio.idFor(region) }, audio);
  const b = back.get(audio.idFor(take)).data;
  for (let i = 0; i < 500; i++) assert.equal(b[i], take.data[i]);
});

test('a null buffer has no id and writes nothing', async () => {
  const audio = new AudioTable();
  assert.equal(audio.idFor(null), null);
  assert.equal(audio.size, 0);
});

// ── The manifest ────────────────────────────────────────────────────────────

test('the manifest comes back exactly as it went in', async () => {
  const manifest = {
    _magic: 'mubone-piece', _version: 1,
    nested: { list: [1, 2, { deep: true }], nul: null, empty: '' },
    unicode: 'a piece — with an em dash',
  };
  const { manifest: back } = await roundTrip(manifest, new AudioTable());
  assert.deepEqual(back, manifest);
});

test('a piece with no audio at all is still a valid piece', async () => {
  const { manifest, audio } = await roundTrip({ _version: 1 }, new AudioTable());
  assert.equal(manifest._version, 1);
  assert.equal(audio.size, 0);
});

// ── The container ───────────────────────────────────────────────────────────

test('the members are the manifest and one wav per id', async () => {
  const audio = new AudioTable();
  const id = audio.idFor(makeBuffer(128, 48000, (i) => i / 128));
  const blob = await writePiece({ id }, audio, blobSink());
  const text = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  assert.ok(text.includes(MANIFEST_NAME));
  assert.ok(text.includes(`${AUDIO_PREFIX}${id}.wav`));
});

test('a damaged member is refused, not loaded quietly', async () => {
  const audio = new AudioTable();
  const id = audio.idFor(makeBuffer(4096, 48000, (i) => Math.sin(i * 0.01)));
  const blob = await writePiece({ id }, audio, blobSink());
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Flip a bit deep in the audio data — past every header, so only the CRC can
  // catch it.
  bytes[Math.floor(bytes.length / 2)] ^= 0xFF;
  const bad = new Blob([bytes]);
  await assert.rejects(() => readPiece(blobSource(bad), ctx), /checksum/);
});

test('a file that is not a piece says so', async () => {
  await assert.rejects(() => readPiece(blobSource(new Blob(['not a zip at all'])), ctx), /not a mubone piece/);
});

test('real unzip accepts the container, and reads the member as float WAV', async (t) => {
  let unzip = true;
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch (_) { unzip = false; }
  if (!unzip) return t.skip('no unzip(1) on this machine');

  const audio = new AudioTable();
  const id = audio.idFor(makeBuffer(4800, 48000, (i) => Math.sin(i * 0.05) * 1.5));
  const blob = await writePiece({ _magic: 'mubone-piece', id }, audio, blobSink());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mubone-file-'));
  const zip = path.join(dir, 'piece.zip');
  fs.writeFileSync(zip, Buffer.from(await blob.arrayBuffer()));
  try {
    // -t walks every member, inflates it and checks its CRC against the record.
    const out = execFileSync('unzip', ['-t', zip]).toString();
    assert.match(out, /No errors detected/);
    execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
    const wav = path.join(dir, AUDIO_PREFIX, `${id}.wav`);
    const head = fs.readFileSync(wav);
    assert.equal(head.subarray(0, 4).toString(), 'RIFF');
    assert.equal(head.subarray(8, 12).toString(), 'WAVE');
    assert.equal(head.readUInt16LE(20), 3);    // IEEE float, what a DAW needs to see
    assert.equal(head.readUInt16LE(34), 32);   // bits
    assert.equal(head.readUInt32LE(24), 48000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── The pieces underneath ───────────────────────────────────────────────────

test('CRC32 matches the known value for "123456789"', () => {
  assert.equal(__testInternals.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('CRC32 over chunks equals CRC32 over the whole', () => {
  const { crc32 } = __testInternals;
  const all = new Uint8Array(1000).map((_, i) => (i * 37) & 0xFF);
  assert.equal(crc32(all.subarray(400), crc32(all.subarray(0, 400))), crc32(all));
});

test('a wav member is exactly as long as the geometry says', () => {
  const buf = makeBuffer(1234, 48000, () => 0);
  let n = 0;
  for (const c of __testInternals.wavChunks(buf)) n += c.length;
  assert.equal(n, __testInternals.wavByteLength(buf));
  assert.equal(n, 44 + 1234 * 4);
});
