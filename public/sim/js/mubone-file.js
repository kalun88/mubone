// ═════════════════════════════════════════════════════════════════════════════
// MUBONE FILE — the .mubone container
// ═════════════════════════════════════════════════════════════════════════════
//
// A piece is a ZIP:
//
//   manifest.json          deflated   — everything the document holds but audio
//   audio/<id>.wav         stored     — float32 WAV, one member per distinct buffer
//
// Why a container rather than the JSON it replaced (#354). The old session file
// converted every AudioBuffer to 16-bit PCM and base64'd it into the JSON: lossy
// (undithered, and anything above ±1.0 clamped — measured, Chromium round-trips
// a peak of 1.5 through a float32 member and clips it to 1.0 through a 16-bit
// one), +33% for the base64, and duplicated, because two slots sharing one
// buffer were encoded twice. Members are float32 — exactly what the engine holds,
// so there is no quantisation and no dither question — and they are named by a
// hash of their content, so the sharing collapses to one member.
//
// The zip-ness is an implementation detail: `.mubone` is not `.zip`, so no OS
// file manager tries to expand it. Renaming a COPY to .zip is the debugging
// escape hatch — you can drag a take into a DAW and look at it.
//
// No dependency. Deflate and inflate are Chromium's own CompressionStream, CRC32
// and the zip records are the ~100 lines below, and the whole module works in the
// browser demo (through a Blob) exactly as it does in Electron (through the file
// IPC in electron-preload.js, which nothing else in the app calls).

const TEXT = new TextEncoder();

export const MANIFEST_NAME = 'manifest.json';
export const AUDIO_PREFIX  = 'audio/';

// ZIP without ZIP64 tops out at 4 GB, and every offset in the central directory
// is 32-bit. A 30-minute mono float32 take is 345 MB, so the ceiling is far away
// — but it is a real ceiling, and a silent overflow would write a file that no
// reader could open. Refuse instead.
const ZIP32_MAX = 0xFFFFFFFF;


// ── CRC32 ────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

/** Running CRC32 — `crc32(bytes, prev)` over as many chunks as you like. */
function crc32(bytes, prev = 0) {
  let c = (prev ^ 0xFFFFFFFF) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = (CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xFFFFFFFF) >>> 0;
}


// ── Deflate / inflate (Chromium's own, no library) ───────────────────────────

async function streamThrough(bytes, stream) {
  const out = [];
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(value);
    }
  })();
  await writer.write(bytes);
  await writer.close();
  await pump;
  let n = 0;
  for (const c of out) n += c.length;
  const all = new Uint8Array(n);
  let off = 0;
  for (const c of out) { all.set(c, off); off += c.length; }
  return all;
}

// 'deflate-raw' is what a zip member holds — 'deflate' would add a zlib wrapper
// that no unzipper expects.
const deflateRaw = (bytes) => streamThrough(bytes, new CompressionStream('deflate-raw'));
const inflateRaw = (bytes) => streamThrough(bytes, new DecompressionStream('deflate-raw'));


// ── ZIP records ──────────────────────────────────────────────────────────────

function dosTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const FLAG_UTF8 = 0x0800;

function localHeader(nameBytes, method, crc, compSize, rawSize, when) {
  const b  = new Uint8Array(30 + nameBytes.length);
  const dv = new DataView(b.buffer);
  dv.setUint32(0,  0x04034b50, true);
  dv.setUint16(4,  20, true);            // version needed
  dv.setUint16(6,  FLAG_UTF8, true);
  dv.setUint16(8,  method, true);
  dv.setUint16(10, when.time, true);
  dv.setUint16(12, when.date, true);
  dv.setUint32(14, crc, true);
  dv.setUint32(18, compSize, true);
  dv.setUint32(22, rawSize, true);
  dv.setUint16(26, nameBytes.length, true);
  dv.setUint16(28, 0, true);             // extra
  b.set(nameBytes, 30);
  return b;
}

function centralRecord(e) {
  const b  = new Uint8Array(46 + e.name.length);
  const dv = new DataView(b.buffer);
  dv.setUint32(0,  0x02014b50, true);
  dv.setUint16(4,  20, true);            // version made by
  dv.setUint16(6,  20, true);            // version needed
  dv.setUint16(8,  FLAG_UTF8, true);
  dv.setUint16(10, e.method, true);
  dv.setUint16(12, e.when.time, true);
  dv.setUint16(14, e.when.date, true);
  dv.setUint32(16, e.crc, true);
  dv.setUint32(20, e.compSize, true);
  dv.setUint32(24, e.rawSize, true);
  dv.setUint16(28, e.name.length, true);
  dv.setUint16(30, 0, true);             // extra
  dv.setUint16(32, 0, true);             // comment
  dv.setUint16(34, 0, true);             // disk
  dv.setUint16(36, 0, true);             // internal attrs
  dv.setUint32(38, 0, true);             // external attrs
  dv.setUint32(42, e.offset, true);
  b.set(e.name, 46);
  return b;
}

function endRecord(count, cdSize, cdOffset) {
  const b  = new Uint8Array(22);
  const dv = new DataView(b.buffer);
  dv.setUint32(0,  0x06054b50, true);
  dv.setUint16(8,  count, true);
  dv.setUint16(10, count, true);
  dv.setUint32(12, cdSize, true);
  dv.setUint32(16, cdOffset, true);
  return b;
}


// ── ZIP writer (streaming) ───────────────────────────────────────────────────
//
// A member's size and CRC are known before its header is written — the audio
// sizes come from the buffer's geometry and the manifest is deflated whole —
// so there are no data descriptors, which keeps every reader happy.

class ZipWriter {
  constructor(sink) {
    this.sink    = sink;
    this.offset  = 0;
    this.entries = [];
    this.when    = dosTime();
  }

  async _put(bytes) {
    if (this.offset + bytes.length > ZIP32_MAX) {
      throw new Error('piece exceeds the 4 GB container limit');
    }
    await this.sink.write(bytes);
    this.offset += bytes.length;
  }

  /**
   * One member. `chunks` is an iterable (sync or async) of Uint8Array; `rawSize`
   * and `crc` must already describe exactly what it will yield.
   */
  async addStored(name, chunks, rawSize, crc) {
    const nameBytes = TEXT.encode(name);
    const offset = this.offset;
    await this._put(localHeader(nameBytes, 0, crc, rawSize, rawSize, this.when));
    let written = 0;
    for await (const c of chunks) { await this._put(c); written += c.length; }
    if (written !== rawSize) throw new Error(`member ${name}: wrote ${written} of ${rawSize}`);
    this.entries.push({ name: nameBytes, method: 0, crc, compSize: rawSize, rawSize, offset, when: this.when });
  }

  async addDeflated(name, bytes) {
    const nameBytes = TEXT.encode(name);
    const packed = await deflateRaw(bytes);
    const crc = crc32(bytes);
    const offset = this.offset;
    await this._put(localHeader(nameBytes, 8, crc, packed.length, bytes.length, this.when));
    await this._put(packed);
    this.entries.push({ name: nameBytes, method: 8, crc, compSize: packed.length, rawSize: bytes.length, offset, when: this.when });
  }

  async finish() {
    const cdOffset = this.offset;
    for (const e of this.entries) await this._put(centralRecord(e));
    const cdSize = this.offset - cdOffset;
    await this._put(endRecord(this.entries.length, cdSize, cdOffset));
    return this.sink.close();
  }
}


// ── ZIP reader (by ranges) ───────────────────────────────────────────────────
//
// Reads the end record, then the central directory, then one member at a time.
// A source that reads ranges (the Electron file IPC, or a Blob) never has to
// hold the whole piece in memory.

async function readDirectory(source) {
  const size = source.size;
  if (size < 22) throw new Error('not a mubone piece (too short)');
  // The end record is last unless there is a zip comment; we write none, but
  // scan a little anyway so a file that grew one is still readable.
  const tailLen = Math.min(size, 22 + 0xFFFF);
  const tail = await source.read(size - tailLen, tailLen);
  const tdv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tdv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a mubone piece (no zip directory)');
  const count    = tdv.getUint16(eocd + 10, true);
  const cdSize   = tdv.getUint32(eocd + 12, true);
  const cdOffset = tdv.getUint32(eocd + 16, true);

  const cd  = await source.read(cdOffset, cdSize);
  const cdv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cdv.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt zip directory');
    const method   = cdv.getUint16(p + 10, true);
    const crc      = cdv.getUint32(p + 16, true);
    const compSize = cdv.getUint32(p + 20, true);
    const rawSize  = cdv.getUint32(p + 24, true);
    const nameLen  = cdv.getUint16(p + 28, true);
    const extraLen = cdv.getUint16(p + 30, true);
    const cmtLen   = cdv.getUint16(p + 32, true);
    const offset   = cdv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, crc, compSize, rawSize, offset });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return entries;
}

async function readMember(source, e, name) {
  // The local header repeats the name and carries its own extra field, whose
  // length need not match the directory's — so the data offset is read here,
  // never assumed.
  const head = await source.read(e.offset, 30);
  const hdv  = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (hdv.getUint32(0, true) !== 0x04034b50) throw new Error(`corrupt member ${name}`);
  const dataAt = e.offset + 30 + hdv.getUint16(26, true) + hdv.getUint16(28, true);
  const raw = await source.read(dataAt, e.compSize);
  const out = e.method === 8 ? await inflateRaw(raw) : raw;
  if (crc32(out) !== e.crc) throw new Error(`member ${name} failed its checksum`);
  return out;
}


// ── float32 WAV ──────────────────────────────────────────────────────────────
//
// Format 3 (IEEE float), which Chromium decodes natively — verified, including
// that it preserves samples above ±1.0 that the old 16-bit path clamped away.

const WAV_HEADER = 44;

function wavByteLength(buf) {
  return WAV_HEADER + buf.length * buf.numberOfChannels * 4;
}

function wavHeader(numCh, frames, sampleRate) {
  const dataSize = frames * numCh * 4;
  const b  = new Uint8Array(WAV_HEADER);
  const dv = new DataView(b.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');  dv.setUint32(4, 36 + dataSize, true);  str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 3, true);                        // IEEE float
  dv.setUint16(22, numCh, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * numCh * 4, true);   // byte rate
  dv.setUint16(32, numCh * 4, true);                // block align
  dv.setUint16(34, 32, true);                       // bits
  str(36, 'data'); dv.setUint32(40, dataSize, true);
  return b;
}

// Frames per emitted chunk. Bounds the interleave scratch (and the IPC chunk)
// at ~1 MB per channel rather than the whole take.
const WAV_CHUNK_FRAMES = 1 << 18;

/** Header + interleaved float32 data, a chunk at a time. */
function* wavChunks(buf) {
  const numCh  = buf.numberOfChannels;
  const frames = buf.length;
  yield wavHeader(numCh, frames, buf.sampleRate);
  const chans = [];
  for (let ch = 0; ch < numCh; ch++) chans.push(buf.getChannelData(ch));
  if (numCh === 1) {
    // The common case: the channel's own bytes, no interleave and no copy.
    const src = chans[0];
    for (let i = 0; i < frames; i += WAV_CHUNK_FRAMES) {
      const n = Math.min(WAV_CHUNK_FRAMES, frames - i);
      yield new Uint8Array(src.buffer, src.byteOffset + i * 4, n * 4);
    }
    return;
  }
  const scratch = new Float32Array(WAV_CHUNK_FRAMES * numCh);
  for (let i = 0; i < frames; i += WAV_CHUNK_FRAMES) {
    const n = Math.min(WAV_CHUNK_FRAMES, frames - i);
    for (let f = 0; f < n; f++) {
      for (let ch = 0; ch < numCh; ch++) scratch[f * numCh + ch] = chans[ch][i + f];
    }
    yield new Uint8Array(scratch.buffer, 0, n * numCh * 4);
  }
}

/** Parse a member back. Only format 3 — nothing writes anything else. */
function parseFloatWav(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('audio member is not a WAV');
  let p = 12, fmt = null, data = null;
  while (p + 8 <= bytes.length) {
    const id = tag(p);
    const size = dv.getUint32(p + 4, true);
    if (id === 'fmt ') {
      fmt = {
        format:     dv.getUint16(p + 8, true),
        numCh:      dv.getUint16(p + 10, true),
        sampleRate: dv.getUint32(p + 12, true),
        bits:       dv.getUint16(p + 22, true),
      };
    } else if (id === 'data') {
      data = { at: p + 8, size: Math.min(size, bytes.length - p - 8) };
    }
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('audio member is missing fmt or data');
  if (fmt.format !== 3 || fmt.bits !== 32) throw new Error(`audio member is not float32 (format ${fmt.format}/${fmt.bits})`);
  return { ...fmt, frames: Math.floor(data.size / (fmt.numCh * 4)), at: data.at, bytes };
}


// ── Audio ids ────────────────────────────────────────────────────────────────
//
// A member is named by a hash of its samples, so two slots holding the same
// buffer — or the same sample loaded twice — write one member (audit § E7).
// NOT sha-256, which has no streaming API here and would force a whole take
// into one ArrayBuffer to digest it. This mixes 32-bit words (a ~350 MB take is
// ~90 M of them, about a tenth of a second) and the id carries the geometry too,
// so a collision would have to match content AND frame count AND channel count.
//
// It does NOT collapse a pinned loop into its take: createSeqFromStroke copies a
// REGION and crossfades its tail, so the loop is derived material, not a slice.
// Storing that as a recipe is the follow-up #354 names.

function hashBuffer(buf) {
  let h1 = 0x811c9dc5 | 0, h2 = 0x01000193 | 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const words = new Uint32Array(buf.getChannelData(ch).buffer, buf.getChannelData(ch).byteOffset, buf.length);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      h1 = Math.imul(h1 ^ w, 0x01000193);
      h2 = Math.imul(h2 + w, 0x85ebca6b) ^ (h1 >>> 15);
    }
    h1 = Math.imul(h1 ^ ch, 0x01000193);
  }
  const hex = (n) => (n >>> 0).toString(16).padStart(8, '0');
  return `${hex(h1)}${hex(h2)}-${buf.length}-${buf.numberOfChannels}`;
}

/**
 * The audio side of a document being built. `idFor(buffer)` returns the id to
 * write into the manifest and remembers the buffer to write as a member; the
 * same AudioBuffer object, or an identical one, gives the same id.
 */
export class AudioTable {
  constructor() {
    this.byId = new Map();          // id → AudioBuffer
    this._seen = new WeakMap();     // AudioBuffer → id (identity, before hashing)
  }
  idFor(buf) {
    if (!buf) return null;
    const known = this._seen.get(buf);
    if (known) return known;
    const id = hashBuffer(buf);
    this._seen.set(buf, id);
    if (!this.byId.has(id)) this.byId.set(id, buf);
    return id;
  }
  get size() { return this.byId.size; }
}


// ── Sinks and sources ────────────────────────────────────────────────────────

/** Electron: stream into a path through the file IPC, landing via a .part file. */
export async function pathSink(path) {
  const br = window.electronBridge;
  const r = await br.docWriteBegin(path);
  if (!r?.ok) throw new Error(r?.error || 'could not open the file for writing');
  const id = r.id;
  return {
    async write(bytes) {
      const w = await br.docWriteChunk(id, bytes);
      if (!w?.ok) throw new Error(w?.error || 'write failed');
    },
    async close() {
      const w = await br.docWriteEnd(id);
      if (!w?.ok) throw new Error(w?.error || 'could not finish the file');
      return path;
    },
    async abort() { try { await br.docWriteAbort(id); } catch (_) {} },
  };
}

/** Browser demo: collect the parts and hand back a Blob to download. */
export function blobSink() {
  const parts = [];
  return {
    // The chunk may be a view onto a live AudioBuffer, so copy: a Blob built at
    // close() would otherwise read whatever that memory holds by then.
    async write(bytes) { parts.push(bytes.slice()); },
    async close() { return new Blob(parts, { type: 'application/octet-stream' }); },
    async abort() { parts.length = 0; },
  };
}

/** Electron: read ranges straight off disk. */
export async function pathSource(path) {
  const br = window.electronBridge;
  const st = await br.docStat(path);
  if (!st?.ok) throw new Error(st?.error || 'could not read the file');
  return {
    size: st.size,
    async read(offset, length) {
      const r = await br.docRead(path, offset, length);
      if (!r?.ok) throw new Error(r?.error || 'read failed');
      return r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes);
    },
  };
}

/** Browser demo: a File from an <input>, read by slices. */
export function blobSource(file) {
  return {
    size: file.size,
    async read(offset, length) {
      return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    },
  };
}


// ── The piece ────────────────────────────────────────────────────────────────

/**
 * Write a document. `manifest` is a plain object; `audio` is an AudioTable whose
 * ids the manifest refers to. Returns whatever the sink's close() returns — a
 * path in Electron, a Blob in the browser.
 */
export async function writePiece(manifest, audio, sink) {
  const zip = new ZipWriter(sink);
  try {
    // Manifest first, so a reader can know what it is holding before it has
    // walked past a few hundred MB of audio.
    await zip.addDeflated(MANIFEST_NAME, TEXT.encode(JSON.stringify(manifest)));
    for (const [id, buf] of audio.byId) {
      let crc = 0;
      for (const c of wavChunks(buf)) crc = crc32(c, crc);
      await zip.addStored(`${AUDIO_PREFIX}${id}.wav`, wavChunks(buf), wavByteLength(buf), crc);
    }
    return await zip.finish();
  } catch (e) {
    await sink.abort?.();
    throw e;
  }
}

/**
 * Read a document. Returns `{ manifest, audio }` where `audio` is a Map of id →
 * AudioBuffer, decoded against `ctx`.
 *
 * A member whose sample rate matches the context is copied in as it stands —
 * lossless, and the first time that has been true. One that does not match goes
 * through decodeAudioData, which resamples it exactly as the old JSON path
 * always did (measured: a 48 k member comes back 4410 samples in a 44.1 k
 * context), so a piece opened on the wrong device rate still plays.
 */
export async function readPiece(source, ctx) {
  const dir = await readDirectory(source);
  const manEntry = dir.get(MANIFEST_NAME);
  if (!manEntry) throw new Error('not a mubone piece (no manifest)');
  const manifest = JSON.parse(new TextDecoder().decode(await readMember(source, manEntry, MANIFEST_NAME)));

  const audio = new Map();
  for (const [name, e] of dir) {
    if (!name.startsWith(AUDIO_PREFIX)) continue;
    const id = name.slice(AUDIO_PREFIX.length).replace(/\.wav$/, '');
    const bytes = await readMember(source, e, name);
    audio.set(id, await bufferFromWav(bytes, ctx));
  }
  return { manifest, audio };
}

async function bufferFromWav(bytes, ctx) {
  const w = parseFloatWav(bytes);
  if (w.sampleRate !== ctx.sampleRate) {
    // Hand the member back verbatim — it is already a valid WAV file.
    return ctx.decodeAudioData(bytes.slice().buffer);
  }
  const buf = ctx.createBuffer(w.numCh, Math.max(1, w.frames), w.sampleRate);
  // The data need not be 4-byte aligned inside the member, so read it as a view
  // over the bytes rather than casting to Float32Array.
  const dv = new DataView(bytes.buffer, bytes.byteOffset + w.at, w.frames * w.numCh * 4);
  for (let ch = 0; ch < w.numCh; ch++) {
    const dst = buf.getChannelData(ch);
    for (let f = 0; f < w.frames; f++) dst[f] = dv.getFloat32((f * w.numCh + ch) * 4, true);
  }
  return buf;
}

// Exported for the audits only — the format's own round trip, with no app state
// in the way.
export const __testInternals = { crc32, hashBuffer, wavChunks, parseFloatWav, wavByteLength };
