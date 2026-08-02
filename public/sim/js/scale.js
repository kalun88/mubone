// ============================================================================
// scale.js — control shaping for continuous controllers
//
// Two independent jobs, deliberately kept in one small module because the
// accessory table needs both and they share the `range` vocabulary:
//
//   1. SHAPING   — scaleControl() takes a normalised 0–1 controller reading and
//                  applies a response curve plus an output window, so a pot can
//                  be given a non-linear feel and confined to part of a param's
//                  travel.  Domain and codomain are both 0–1, so this composes
//                  with any destination and knows nothing about what it drives.
//
//   2. UNIT MATH — toNorm/fromNorm convert between a param's real units (cents,
//                  Hz, ms) and the 0–1 domain, using the `range` descriptor that
//                  each cc action in midi.js now carries.  This is what lets the
//                  UI say "−600¢ to +600¢" instead of "37%–63%".
//
// The `range` descriptor (see ACTIONS in midi.js):
//
//   { min, max, unit?, int?, curve?, maxFn? }
//
//   min/max  real-unit bounds the action's ccFn spans across MIDI 0–127
//   unit     display suffix ('¢', 'Hz', 'ms', …), '' for bare numbers
//   int      true if the ccFn rounds — display without decimals
//   curve    'lin' (default) or 'log', describing the mapping the ccFn ALREADY
//            implements internally.  Getting this wrong is silent: the UI will
//            still show plausible numbers but the pot's throw will be skewed.
//            scripts/verify-action-ranges.js checks every entry against its
//            real ccFn output rather than trusting the annotation.
//   maxFn    for ranges whose ceiling is only known at runtime (k is bounded by
//            the particle count).  Takes precedence over max when present.
//
// 'log' requires min > 0 — it is a ratio mapping (min · (max/min)^x), which is
// what every log-scaled ccFn here actually does.
// ============================================================================

// ── Range accessors ─────────────────────────────────────────────────────────
// Always go through these: maxFn ranges change under you between calls, and
// reading `.max` directly on one silently gives you the static fallback.

export function rangeMin(range) {
  return Number(range?.min ?? 0);
}

export function rangeMax(range) {
  if (typeof range?.maxFn === 'function') {
    const v = Number(range.maxFn());
    if (Number.isFinite(v)) return v;
  }
  return Number(range?.max ?? 1);
}

export function isDynamic(range) {
  return typeof range?.maxFn === 'function';
}

// ── Unit conversion ─────────────────────────────────────────────────────────

/** Real units → 0–1. Inverse of fromNorm. Clamped. */
export function toNorm(range, real) {
  const lo = rangeMin(range);
  const hi = rangeMax(range);
  const v  = Number(real);
  if (!Number.isFinite(v) || hi === lo) return 0;
  let x;
  if (range?.curve === 'log' && lo > 0 && hi > 0) {
    x = Math.log(Math.max(v, Number.MIN_VALUE) / lo) / Math.log(hi / lo);
  } else {
    x = (v - lo) / (hi - lo);
  }
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** 0–1 → real units. Inverse of toNorm. */
export function fromNorm(range, x01) {
  const lo = rangeMin(range);
  const hi = rangeMax(range);
  let x = Number(x01);
  if (!Number.isFinite(x)) x = 0;
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  let v;
  if (range?.curve === 'log' && lo > 0 && hi > 0) {
    v = lo * Math.pow(hi / lo, x);
  } else {
    v = lo + x * (hi - lo);
  }
  return range?.int ? Math.round(v) : v;
}

/** Clamp a real-unit value into its range. */
export function clampReal(range, real) {
  const lo = rangeMin(range);
  const hi = rangeMax(range);
  const v  = Number(real);
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

// ── Shaping ─────────────────────────────────────────────────────────────────

/**
 * Apply a response curve to a normalised 0–1 reading.
 *
 * gamma = 1  linear
 * gamma > 1  slow start — travel is compressed at the bottom of the throw, so
 *            more of the pot's rotation is spent on small values
 * gamma < 1  fast start — the mirror image, fine control at the top
 *
 * Plain exponentiation rather than a symmetric S-curve: it is the same shape
 * Max's scale exponent argument produces, so the number means what Ek expects
 * it to mean coming from a Max patch.
 */
export function applyCurve(x, gamma = 1) {
  let v = Number(x);
  if (!Number.isFinite(v)) return 0;
  v = v < 0 ? 0 : v > 1 ? 1 : v;
  const g = Number(gamma);
  if (!Number.isFinite(g) || g === 1 || g <= 0) return v;
  return Math.pow(v, g);
}

/**
 * Full shaping stage: curve, then remap into the [lo, hi] output window.
 *
 * lo > hi is legal and reverses the throw. That overlaps with the accessory's
 * `invert` flag by design — invert describes how the hardware is wired, this
 * describes the musical intent, and conflating them makes one of the two
 * impossible to reason about when both are set.
 *
 * Returns 0–1 (or the [lo,hi] sub-interval of it), ready to be multiplied by
 * 127 for dispatch.
 */
export function scaleControl(x01, opts = {}) {
  const { curve = 1, lo = 0, hi = 1 } = opts;
  const shaped = applyCurve(x01, curve);
  const l = Number.isFinite(Number(lo)) ? Number(lo) : 0;
  const h = Number.isFinite(Number(hi)) ? Number(hi) : 1;
  return l + shaped * (h - l);
}

// ── Display ─────────────────────────────────────────────────────────────────

/** Compact number for UI — drops trailing zeros, keeps small values readable. */
export function fmtNumber(v, int = false) {
  if (!Number.isFinite(v)) return '—';
  if (int) return String(Math.round(v));
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 100) return v.toFixed(0);
  if (a >= 1)   return String(Number(v.toFixed(2)));
  if (a >= 0.01) return String(Number(v.toFixed(3)));
  return String(Number(v.toPrecision(2)));
}

/** A single value with its unit — "−600 ¢". */
export function fmtValue(range, real) {
  const s = fmtNumber(real, !!range?.int);
  return range?.unit ? `${s} ${range.unit}` : s;
}

/**
 * The action's fmt string, derived rather than hand-written — this is the text
 * shown in the keys/midi/osc modal's format column. Previously each action
 * carried its own literal, which is how preset_select ended up advertising
 * 1–40 for a 20-slot list.
 */
export function fmtRange(range) {
  if (!range) return '';
  const kind = range.int ? 'int' : 'float';
  const lo   = fmtNumber(rangeMin(range), !!range.int);
  const hi   = isDynamic(range) ? 'N' : fmtNumber(rangeMax(range), !!range.int);
  const unit = range.unit ? ` ${range.unit}` : '';
  return `${kind} ${lo}–${hi}${unit}`;
}
