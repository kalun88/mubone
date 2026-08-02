// ============================================================================
// interp-kernels.js — Shared interpolation kernels for staging + radial morph
//
// All kernels take:
//   identity    [n] — live identity vector (numbers)
//   anchors     [{ identity: [n] }, ...] — snapshot/pin list with identity coords
//   opts        { axisWeights?: [n], sigma?, k?, falloff? }
//
// …and return an array of normalized non-negative weights, one per anchor,
// summing to ~1.0 (except `snap` which produces exactly one 1.0 and the rest
// 0, and `idw` which is pre-normalized by its kernel sum).
//
// If the identity sits exactly on an anchor, that anchor gets all the weight
// and the rest get 0 — prevents 1/(0+eps) blow-ups.  Axis weights are applied
// in identity space before distance is computed.  All kernels are pure, take
// plain arrays, and allocate one output array per call — cheap enough for
// ~30Hz dispatch.
//
// Designed so both the snapshot engine (Change B) and applyRadialMorph()
// (radial preset morph, #112) can share the same kernels.  The radial morph
// uses `idwWeights` today; snapshot engine defaults to `gaussianWeights`.
// ============================================================================

const EPSILON = 1e-6;

/**
 * Per-axis-weighted Euclidean distance between two equal-length vectors.
 * Exported for other modules (e.g. snapshot-engine's lock detection, the
 * posture-map's nearest-highlight) that need the exact same distance metric
 * the kernels use — keeps "nearness" definitions consistent across UI.
 */
export function weightedDistance(a, b, axisWeights) {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const w = axisWeights && i < axisWeights.length ? axisWeights[i] : 1;
    const d = (a[i] - b[i]) * w;
    sum += d * d;
  }
  return Math.sqrt(sum);
}
// Keep the old private name as an alias so the existing kernel code below
// doesn't need to change — the public export is the canonical name.
const _weightedDistance = weightedDistance;

function _normalize(weights) {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += weights[i];
  if (sum <= 0) return weights;
  const inv = 1 / sum;
  for (let i = 0; i < weights.length; i++) weights[i] *= inv;
  return weights;
}

/**
 * Gaussian kernel: w_i = exp(-d_i² / 2σ²)
 * Default σ=0.3 assumes identity vector is pre-normalized to roughly [-1, 1].
 */
export function gaussianWeights(identity, anchors, opts = {}) {
  const sigma = opts.sigma ?? 0.3;
  const axisWeights = opts.axisWeights;
  const out = new Array(anchors.length).fill(0);
  if (anchors.length === 0) return out;

  const twoSigmaSq = 2 * sigma * sigma;

  // Exact-hit shortcut — avoids overflow with very small sigma.
  let exactIdx = -1;
  for (let i = 0; i < anchors.length; i++) {
    const d = _weightedDistance(identity, anchors[i].identity, axisWeights);
    if (d < EPSILON) { exactIdx = i; break; }
    out[i] = Math.exp(-d * d / twoSigmaSq);
  }
  if (exactIdx >= 0) {
    for (let i = 0; i < out.length; i++) out[i] = i === exactIdx ? 1 : 0;
    return out;
  }

  return _normalize(out);
}

/**
 * k-nearest barycentric weights.  Only the k nearest anchors contribute; each
 * gets weight proportional to 1/(d+ε), then normalized.  All other anchors
 * get 0.  k is clamped to anchors.length.
 */
export function kNearestBarycentricWeights(identity, anchors, opts = {}) {
  const k = Math.max(1, Math.min(opts.k ?? 3, anchors.length));
  const axisWeights = opts.axisWeights;
  const out = new Array(anchors.length).fill(0);
  if (anchors.length === 0) return out;

  // Compute all distances once.
  const dists = new Array(anchors.length);
  let exactIdx = -1;
  for (let i = 0; i < anchors.length; i++) {
    const d = _weightedDistance(identity, anchors[i].identity, axisWeights);
    if (d < EPSILON) exactIdx = i;
    dists[i] = d;
  }
  if (exactIdx >= 0) {
    out[exactIdx] = 1;
    return out;
  }

  // Select indices of k smallest distances (partial sort by argsort).
  const idxs = dists.map((_, i) => i).sort((a, b) => dists[a] - dists[b]).slice(0, k);

  for (const i of idxs) {
    out[i] = 1 / (dists[i] + EPSILON);
  }
  return _normalize(out);
}

/**
 * Snap-to-nearest.  One anchor gets weight 1, all others 0.
 */
export function snapWeights(identity, anchors, opts = {}) {
  const axisWeights = opts.axisWeights;
  const out = new Array(anchors.length).fill(0);
  if (anchors.length === 0) return out;

  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < anchors.length; i++) {
    const d = _weightedDistance(identity, anchors[i].identity, axisWeights);
    if (d < bestD) { bestD = d; best = i; }
  }
  out[best] = 1;
  return out;
}

/**
 * Inverse-distance weights with configurable falloff exponent.
 * w_i = (1/(d+ε))^falloff, then normalized.  Reuses the math that
 * applyRadialMorph() already uses in gesture.js; lifted here so the snapshot
 * engine can share it and the radial morph can later migrate to this module
 * without changing behavior.
 */
export function idwWeights(identity, anchors, opts = {}) {
  const falloff = opts.falloff ?? 2;
  const axisWeights = opts.axisWeights;
  const out = new Array(anchors.length).fill(0);
  if (anchors.length === 0) return out;

  let exactIdx = -1;
  for (let i = 0; i < anchors.length; i++) {
    const d = _weightedDistance(identity, anchors[i].identity, axisWeights);
    if (d < EPSILON) { exactIdx = i; break; }
    out[i] = Math.pow(1 / (d + EPSILON), falloff);
  }
  if (exactIdx >= 0) {
    for (let i = 0; i < out.length; i++) out[i] = i === exactIdx ? 1 : 0;
    return out;
  }

  return _normalize(out);
}

/**
 * Single entry point with a string mode.  Used by the snapshot engine so it
 * can switch kernels with a simple `S.staging.interpolation.mode` dropdown.
 */
export function computeWeights(mode, identity, anchors, opts = {}) {
  switch (mode) {
    case 'gaussian':  return gaussianWeights(identity, anchors, opts);
    case 'knearest':  return kNearestBarycentricWeights(identity, anchors, opts);
    case 'snap':      return snapWeights(identity, anchors, opts);
    case 'idw':       return idwWeights(identity, anchors, opts);
    default:          return gaussianWeights(identity, anchors, opts);
  }
}

export const KERNEL_LABELS = {
  gaussian: 'Gaussian',
  knearest: 'k-nearest',
  snap:     'snap',
  idw:      'IDW',
};
