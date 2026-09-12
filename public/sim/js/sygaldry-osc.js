// ============================================================================
// sygaldry-osc.js — OSC and SLIP codecs for talking to sygaldry instruments
//
// Deliberately free of any browser API so it can be exercised by `node --test`.
// The firmware makes the same split for the same reason: a protocol's framing
// is portable even when the socket underneath it is not.
// ============================================================================

// ── OSC, only as much as the instrument speaks ───────────────────────────────

const encoder = new TextEncoder();
const decoder = new TextDecoder('ascii');

const pad4 = (n) => (n + 4) & ~3;

export function encodeOSC(address, args = []) {
  // args are [tag, value] pairs, e.g. [['s', 'name'], ['i', 1]]
  const tags = ',' + args.map(([t]) => t).join('');
  let size = pad4(address.length) + pad4(tags.length);
  for (const [tag, value] of args) {
    if (tag === 's') size += pad4(String(value).length);
    else size += 4;
  }
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const writeString = (s) => {
    const bytes = encoder.encode(s);
    out.set(bytes, at);
    at += pad4(bytes.length);
  };
  writeString(address);
  writeString(tags);
  for (const [tag, value] of args) {
    if (tag === 'i') { view.setInt32(at, value | 0, false); at += 4; }
    else if (tag === 'f') { view.setFloat32(at, Number(value), false); at += 4; }
    else if (tag === 's') writeString(String(value));
    else throw new Error(`unsupported OSC type tag ${tag}`);
  }
  return out;
}

export function decodeMessage(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  let end = 0;
  while (end < bytes.length && bytes[end] !== 0) end++;
  if (end >= bytes.length) return null;
  const address = decoder.decode(bytes.subarray(0, end));
  at = pad4(end);
  if (at >= bytes.length || bytes[at] !== 0x2c /* ',' */) return { address, args: [] };
  let tagEnd = at;
  while (tagEnd < bytes.length && bytes[tagEnd] !== 0) tagEnd++;
  const tags = decoder.decode(bytes.subarray(at + 1, tagEnd));
  at = pad4(tagEnd);
  const args = [];
  for (const tag of tags) {
    if (tag === 'i' && at + 4 <= bytes.length) { args.push(view.getInt32(at, false)); at += 4; }
    else if (tag === 'f' && at + 4 <= bytes.length) { args.push(view.getFloat32(at, false)); at += 4; }
    else if (tag === 's') {
      let sEnd = at;
      while (sEnd < bytes.length && bytes[sEnd] !== 0) sEnd++;
      args.push(decoder.decode(bytes.subarray(at, sEnd)));
      at = pad4(sEnd);
    } else break;
  }
  return { address, args };
}

const BUNDLE_TAG = [0x23, 0x62, 0x75, 0x6e, 0x64, 0x6c, 0x65, 0x00]; // "#bundle\0"

function isBundle(bytes) {
  if (bytes.length < 16) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== BUNDLE_TAG[i]) return false;
  return true;
}

export function decodePacket(bytes, out = []) {
  if (isBundle(bytes)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = 16;
    while (at + 4 <= bytes.length) {
      const size = view.getUint32(at, false);
      at += 4;
      if (at + size > bytes.length) break;
      decodePacket(bytes.subarray(at, at + size), out);
      at += size;
    }
  } else {
    const message = decodeMessage(bytes);
    if (message) out.push(message);
  }
  return out;
}

// ── SLIP ─────────────────────────────────────────────────────────────────────

const SLIP_END = 0xc0, SLIP_ESC = 0xdb, SLIP_ESC_END = 0xdc, SLIP_ESC_ESC = 0xdd;

export function slipEncode(payload) {
  const out = [];
  for (const b of payload) {
    if (b === SLIP_END) out.push(SLIP_ESC, SLIP_ESC_END);
    else if (b === SLIP_ESC) out.push(SLIP_ESC, SLIP_ESC_ESC);
    else out.push(b);
  }
  out.push(SLIP_END);
  return new Uint8Array(out);
}

export class SlipDecoder {
  constructor(onPacket) {
    this.onPacket = onPacket;
    this.buffer = [];
    this.escaped = false;
  }
  push(chunk) {
    for (const b of chunk) {
      if (b === SLIP_END) {
        if (this.buffer.length) this.onPacket(new Uint8Array(this.buffer));
        this.buffer = [];
        this.escaped = false;
      } else if (b === SLIP_ESC) {
        this.escaped = true;
      } else if (this.escaped) {
        this.buffer.push(b === SLIP_ESC_END ? SLIP_END : SLIP_ESC);
        this.escaped = false;
      } else {
        this.buffer.push(b);
      }
    }
  }
}

