// ============================================================================
// SYGALDRY LED — turning a palette colour into duty on the instrument's LED.
//
// Its own module, and free of the browser on purpose: this is the one part of
// driving the mubone's LED with an answer that can be known in advance, so it
// is the one part worth testing without hardware. Everything else — which
// device holds the cursor, which state wins, when to blink — lives in
// ximu-led-feedback.js with the rest of that machinery.
//
// Two conversions stand between a hex in the palette table and three floats on
// the wire.
//
// The first is universal and simply correct: the palette is sRGB, which is
// gamma encoded for a screen, while PWM duty is linear in light. #555555 reads
// as mid grey and is 21% of full power, not 33%. Skip this and every dim colour
// in the table arrives bright.
//
// The second is a fact about one board, and a guess about the number. The
// mubone's ballast resistors are deliberately unequal — 120R on red against 33R
// on green and blue — because red has headroom on a 3.3 V rail and green and
// blue very nearly do not: their forward voltage almost meets it. Red therefore
// runs bright and consistent while the other two run dim, so equal numbers do
// not make the colour the hex names. Full white reads pink; red and green reads
// orange. TRIM knocks red back into the same register as the others.
//
// TRIM was set by eye on one board rather than measured, and it is the first
// thing to reach for when the palette looks wrong on a different board or a
// different LED part. Watch the bottom of the range when you do: green and blue
// are already close to their threshold at full duty, so a colour the table
// calls dim can land at no light at all. If the dark end goes dead, raise the
// colours in the table rather than bending the curve here — a lit LED that lies
// about its brightness is worse than a table that says what it means.
// ============================================================================

export const TRIM = [0.35, 1.0, 1.0];   // red, green, blue

/** sRGB transfer function, inverted: display value in, light out. */
export function srgbToLinear(u) {
  return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
}

/**
 * A `#RRGGBB` string as three duty cycles, each 0 to 1 and linear in light —
 * which is what sygaldry's `/LED/color` wants. Anything unparseable reads as
 * off, because an LED stuck on a colour nobody chose is harder to diagnose than
 * one that is dark.
 */
export function hexToChannels(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  const n = m ? parseInt(m[1], 16) : 0;
  return [16, 8, 0].map((shift, i) => srgbToLinear(((n >> shift) & 0xFF) / 255) * TRIM[i]);
}
