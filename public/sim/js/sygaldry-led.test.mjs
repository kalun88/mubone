// Tests for the palette-to-LED conversion.
//
//     node --test js/sygaldry-led.test.mjs
//
// The interesting failures here are quiet ones: a colour that arrives brighter
// than the table says, or a channel that silently sits at full. Both look like
// a working LED until you put two of them side by side.

import test from 'node:test';
import assert from 'node:assert/strict';
import { hexToChannels, srgbToLinear, TRIM } from './sygaldry-led.js';

const close = (a, b, eps = 1e-4) =>
  assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);

test('the ends of the range are exact', () => {
  assert.deepEqual(hexToChannels('#000000'), [0, 0, 0]);
  assert.deepEqual(hexToChannels('#FFFFFF'), TRIM);
});

test('sRGB is undone, so mid grey is a fifth of full power and not a third', () => {
  const [, g] = hexToChannels('#555555');
  close(g, srgbToLinear(0x55 / 255));
  close(g, 0.0908);
  assert.ok(g < 0.333 / 2, 'a linear reading would put this near a third');
});

test('channels stay in their own lanes', () => {
  close(hexToChannels('#FF0000')[0], TRIM[0]);
  assert.deepEqual(hexToChannels('#FF0000').slice(1), [0, 0]);
  close(hexToChannels('#00FF00')[1], TRIM[1]);
  close(hexToChannels('#0000FF')[2], TRIM[2]);
});

test('red is trimmed against green, or every colour comes out red', () => {
  const [r] = hexToChannels('#FFFFFF');
  const [, g] = hexToChannels('#FFFFFF');
  assert.ok(r < g, 'red must be held below green to mix on this board');
});

test('nothing ever leaves the range the firmware accepts', () => {
  for (const hex of ['#000000', '#FFFFFF', '#CC1A1A', '#9DE38B', '#3B4FC8']) {
    for (const v of hexToChannels(hex)) {
      assert.ok(v >= 0 && v <= 1, `${hex} produced ${v}`);
      assert.ok(Number.isFinite(v), `${hex} produced ${v}`);
    }
  }
});

test('a colour nobody can parse is off, not something arbitrary', () => {
  for (const bad of [null, undefined, '', 'red', '#GGG', '#12345']) {
    assert.deepEqual(hexToChannels(bad), [0, 0, 0], String(bad));
  }
});

test('case does not change a colour', () => {
  assert.deepEqual(hexToChannels('#cc1a1a'), hexToChannels('#CC1A1A'));
});
