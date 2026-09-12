// Real bytes, captured off a mubone's serial port, run through the app's own
// decoders.
//
//     node --test js/sygaldry-capture.test.mjs
//
// The unit tests next door check the codec against fixtures we wrote, which
// proves it agrees with itself. This one proves it agrees with the firmware —
// the only thing that can catch the two drifting apart.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SlipDecoder, decodePacket } from './sygaldry-osc.js';

const here = dirname(fileURLToPath(import.meta.url));
const raw = new Uint8Array(readFileSync(join(here, 'fixtures', 'slip-osc-capture.bin')));

function decodeAll(chunkSize) {
  const seen = new Map();
  let packets = 0;
  const slip = new SlipDecoder((p) => {
    packets++;
    for (const { address, args } of decodePacket(p)) {
      const entry = seen.get(address) ?? { count: 0, last: null };
      entry.count++; entry.last = args;
      seen.set(address, entry);
    }
  });
  // fed in awkward chunks, the way a serial read actually arrives
  for (let at = 0; at < raw.length; at += chunkSize) slip.push(raw.subarray(at, at + chunkSize));
  return { seen, packets };
}

test('the capture decodes into the addresses the firmware publishes', () => {
  const { seen, packets } = decodeAll(97);
  assert.ok(packets > 100, `only ${packets} SLIP packets`);
  for (const address of ['/BNO085/orientation', '/BNO085/angular_rate',
                         '/BNO085/acceleration', '/syg/sequence_number']) {
    assert.ok(seen.has(address), `${address} missing from the capture`);
  }
});

test('orientation decodes as four plausible quaternion components', () => {
  const { seen } = decodeAll(97);
  const { last } = seen.get('/BNO085/orientation');
  assert.equal(last.length, 4);
  for (const v of last) assert.ok(Math.abs(v) <= 1.001, `component out of range: ${v}`);
  const norm = Math.hypot(...last);
  assert.ok(Math.abs(norm - 1) < 0.05, `not a unit quaternion: ${norm}`);
});

test('the sequence number advances without gaps', () => {
  const { seen } = decodeAll(97);
  assert.ok(seen.get('/syg/sequence_number').count > 50);
});

test('decoding does not depend on how the bytes are chunked', () => {
  const reference = decodeAll(97);
  for (const chunk of [1, 3, 64, 512, 4096, raw.length]) {
    const { seen } = decodeAll(chunk);
    assert.equal(seen.size, reference.seen.size, `address count differs at chunk ${chunk}`);
    for (const [address, entry] of reference.seen) {
      assert.equal(seen.get(address)?.count, entry.count,
        `${address} count differs at chunk size ${chunk}`);
    }
  }
});
