// Tests for the sygaldry OSC and SLIP codecs.
//
//     node --test js/sygaldry-osc.test.mjs
//
// These run without a browser on purpose: the codec is the part with answers
// that can be known in advance, and it is where a wrong byte turns into a
// silent mystery rather than an error.

import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeOSC, decodeMessage, decodePacket, slipEncode, SlipDecoder } from './sygaldry-osc.js';

const bytes = (...v) => new Uint8Array(v);

test('an encoded message is padded to four byte boundaries', () => {
  const out = encodeOSC('/syg/refresh');
  // "/syg/refresh" is 12 characters, so it needs a whole pad word of its own
  assert.equal(out.length % 4, 0);
  assert.equal(out.length, 16 + 4);          // address + terminator word, then ","
  assert.equal(out[11], 0x68);               // 'h'
  assert.equal(out[12], 0);                  // terminated
});

test('encode and decode round trip every type the instrument uses', () => {
  const encoded = encodeOSC('/WiFi/ssid', [['s', 'a-network'], ['i', 42], ['f', 0.5]]);
  const decoded = decodeMessage(encoded);
  assert.equal(decoded.address, '/WiFi/ssid');
  assert.deepEqual(decoded.args, ['a-network', 42, 0.5]);
});

test('a message with no arguments decodes to an empty list', () => {
  const decoded = decodeMessage(encodeOSC('/syg/describe'));
  assert.equal(decoded.address, '/syg/describe');
  assert.deepEqual(decoded.args, []);
});

test('floats survive the trip as 32 bit values', () => {
  const quaternion = [0.1, -0.25, 0.5, 0.8414709848];
  const decoded = decodeMessage(encodeOSC('/BNO085/orientation',
    quaternion.map((v) => ['f', v])));
  assert.equal(decoded.args.length, 4);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(decoded.args[i] - quaternion[i]) < 1e-6,
      `component ${i}: ${decoded.args[i]} vs ${quaternion[i]}`);
  }
});

test('a bundle decodes into the messages it carries', () => {
  const inner = [
    encodeOSC('/syg/sequence_number', [['i', 7]]),
    encodeOSC('/BNO085/orientation', [['f', 0], ['f', 0], ['f', 0], ['f', 1]]),
  ];
  let size = 16;
  for (const m of inner) size += 4 + m.length;
  const bundle = new Uint8Array(size);
  const view = new DataView(bundle.buffer);
  bundle.set(new TextEncoder().encode('#bundle\0'), 0);
  view.setUint32(8, 0, false);
  view.setUint32(12, 1, false);              // immediately
  let at = 16;
  for (const m of inner) {
    view.setUint32(at, m.length, false);
    at += 4;
    bundle.set(m, at);
    at += m.length;
  }

  const out = decodePacket(bundle);
  assert.equal(out.length, 2);
  assert.equal(out[0].address, '/syg/sequence_number');
  assert.deepEqual(out[0].args, [7]);
  assert.equal(out[1].address, '/BNO085/orientation');
  assert.equal(out[1].args.length, 4);
});

test('a truncated bundle yields what it can rather than throwing', () => {
  const message = encodeOSC('/a', [['i', 1]]);
  const bundle = new Uint8Array(16 + 4 + message.length);
  bundle.set(new TextEncoder().encode('#bundle\0'), 0);
  new DataView(bundle.buffer).setUint32(16, message.length + 40, false);   // lies
  bundle.set(message, 20);
  assert.deepEqual(decodePacket(bundle), []);
});

test('SLIP escapes the two bytes that need it', () => {
  const encoded = slipEncode(bytes(0x01, 0xc0, 0xdb, 0x02));
  assert.deepEqual(Array.from(encoded),
    [0x01, 0xdb, 0xdc, 0xdb, 0xdd, 0x02, 0xc0]);
});

test('SLIP decoding reverses encoding, including across chunk boundaries', () => {
  const payload = bytes(0xc0, 0x00, 0xdb, 0xff, 0xc0, 0xdb);
  const encoded = slipEncode(payload);
  for (const split of [1, 2, 3, 5, encoded.length - 1]) {
    const seen = [];
    const decoder = new SlipDecoder((p) => seen.push(Array.from(p)));
    decoder.push(encoded.subarray(0, split));
    decoder.push(encoded.subarray(split));
    assert.equal(seen.length, 1, `split at ${split}`);
    assert.deepEqual(seen[0], Array.from(payload), `split at ${split}`);
  }
});

test('SLIP yields several packets from one chunk and ignores empty frames', () => {
  const a = encodeOSC('/one', [['i', 1]]);
  const b = encodeOSC('/two', [['i', 2]]);
  const stream = new Uint8Array([
    0xc0,                                   // a stray delimiter, as a device may send
    ...slipEncode(a),
    ...slipEncode(b),
  ]);
  const seen = [];
  new SlipDecoder((p) => seen.push(decodeMessage(p))).push(stream);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].address, '/one');
  assert.equal(seen[1].address, '/two');
});

test('a real bundle survives SLIP framing intact', () => {
  // The whole path a serial byte takes: OSC in a bundle, SLIP framed, decoded.
  const message = encodeOSC('/WiFi/station_ip', [['s', '192.168.0.17']]);
  const bundle = new Uint8Array(16 + 4 + message.length);
  bundle.set(new TextEncoder().encode('#bundle\0'), 0);
  const view = new DataView(bundle.buffer);
  view.setUint32(12, 1, false);
  view.setUint32(16, message.length, false);
  bundle.set(message, 20);

  const seen = [];
  new SlipDecoder((p) => decodePacket(p, seen)).push(slipEncode(bundle));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].address, '/WiFi/station_ip');
  assert.deepEqual(seen[0].args, ['192.168.0.17']);
});
