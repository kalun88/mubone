// ============================================================================
// wand.js — wand controller mapping engine
//
// Reads wand.zeroEuler (tare-relative orientation) and wand.inertial
// (gyro/accel from x-IMU) from sensor.js, applies user-configured mappings,
// and writes results into S.grainOverrides / S.searchRadiusDeg etc.
//
// Called by osc.js after every /space/wand and /space/wand/inertial message.
// ============================================================================

import { S, PRESETS, MAX_CLOUDS, rebuildGrainCurves } from './state.js';
import { wand } from './sensor.js';
import { angleBetweenSphere, findNearestCloudSlot } from './grain.js';
import { getCursorLonLat, screenToLonLat } from './sphere.js';

// ── Mappable source axes ──────────────────────────────────────────────────────
export const AXIS_SRCS = ['pitch', 'roll', 'yaw'];

// ── Mappable parameter definitions ───────────────────────────────────────────
// All min/max values are in the same internal units as S.grainOverrides /
// S.grainParams (seconds, not ms; linear, not cents).
// `label` and `unit` are for the UI only.
export const PARAM_DEFS = {
  duration:        { label: 'duration',      unit: 's',  min: 0.010, max: 2.0   },
  period:          { label: 'period',        unit: 's',  min: 0.010, max: 2.0   },
  searchRadiusDeg: { label: 'radius',        unit: '°',  min: 1,     max: 180   },
  pitchJitter:     { label: 'pitch jitter',  unit: '',   min: 0,     max: 0.029 },
  panSpread:       { label: 'pan spread',    unit: '',   min: 0,     max: 1     },
  volume:          { label: 'volume',        unit: '',   min: 0,     max: 0.20  },
  fadeRatio:       { label: 'fade',          unit: '',   min: 0,     max: 0.5   },
  k:               { label: 'k pool',        unit: '',   min: 1,     max: 20    },
  probability:     { label: 'probability',   unit: '',   min: 0,     max: 1     },
  durJitter:       { label: 'dur jitter',    unit: '',   min: 0,     max: 1     },
  durVar:          { label: 'dur var',       unit: 's',  min: 0,     max: 0.5   },
  periodVar:       { label: 'period var',    unit: 's',  min: 0,     max: 0.5   },
};

// ── Wand mapping configuration ────────────────────────────────────────────────
// Mutated directly by the UI panel.  Everything defaults to 'none' / disabled
// so the wand has no effect until the user assigns axes.
export const wandConfig = {
  enabled: false,

  // ── Orientation axis slots ─────────────────────────────────────────────────
  // src:     'pitch' | 'roll' | 'yaw'
  // param:   key of PARAM_DEFS, or 'none'
  // inMin / inMax:  tare-relative degree range → maps to [0, 1]
  // outMin / outMax: null = use PARAM_DEFS[param].min / .max
  // invert:  flip t before mapping (so tilt-up decreases rather than increases)
  axisA: { src: 'pitch', param: 'none', inMin: -45, inMax: 45, outMin: null, outMax: null, invert: false },
  axisB: { src: 'roll',  param: 'none', inMin: -45, inMax: 45, outMin: null, outMax: null, invert: false },
  axisC: { src: 'yaw',   param: 'none', inMin: -90, inMax: 90, outMin: null, outMax: null, invert: false },

  // ── Gyro agitation ─────────────────────────────────────────────────────────
  // Adds a speed-proportional positive delta on top of the base param value.
  // threshold: gyroMag (deg/s) below which there is no effect
  // maxMag:    gyroMag at which full strength is reached
  // strength:  max additive delta as a fraction of the param's full range
  gyro: { param: 'none', threshold: 30, maxMag: 300, strength: 0.5 },

  // ── Preset morph slots (A / B / C) ────────────────────────────────────────
  // Each slot independently lerps all grain params between two presets along
  // one orientation axis.  Multiple enabled slots stack: each overwrites the
  // previous, so the last active morph provides the coarsest baseline while
  // axis slots (which run after all morphs) always win their specific params.
  morphA: { enabled: false, axis: 'pitch', inMin: -45, inMax:  45, presetA: 0, presetB: 2, presetC: -1 },
  morphB: { enabled: false, axis: 'roll',  inMin: -45, inMax:  45, presetA: 0, presetB: 2, presetC: -1 },
  morphC: { enabled: false, axis: 'yaw',   inMin: -90, inMax:  90, presetA: 0, presetB: 2, presetC: -1 },

  // ── 2D bilinear morph ──────────────────────────────────────────────────────
  // Four presets at corners of a square.  XY position bilinearly interpolates
  // between all four simultaneously.  axisX/Y drive position from wand euler;
  // set to 'manual' for mouse/touch-only control (no wand required).
  // Runs before 1D morphs and axis slots, so those can layer on top.
  xy2d: {
    enabled:  false,
    axisX:    'yaw',   // 'yaw' | 'pitch' | 'roll' | 'manual'
    axisY:    'pitch',
    xMin: -45, xMax: 45,
    yMin: -45, yMax: 45,
    presetTL: 0, presetTR: 1,   // top-left / top-right
    presetBL: 2, presetBR: 3,   // bottom-left / bottom-right
    presetC:  4,                 // center — blends in near (0.5, 0.5)
    manualX:  0.5,               // [0,1] cursor used in manual mode
    manualY:  0.5,
  },
};

// ── Pitch soft-clamp ──────────────────────────────────────────────────────────
// ZYX Euler pitch is geometrically capped at ±90°, but near those poles
// gimbal lock causes yaw/roll to become undefined and pitch to jitter.
// We apply a smoothstep saturator: linear below PITCH_KNEE, then eases to
// PITCH_LIMIT so the value "locks" rather than flipping or going noisy.
export const PITCH_KNEE  = 70;   // degrees — fully linear below this
export const PITCH_LIMIT = 82;   // degrees — asymptotic cap

function softClampPitch(deg) {
  const abs = Math.abs(deg);
  if (abs <= PITCH_KNEE) return deg;
  const t = Math.min((abs - PITCH_KNEE) / (PITCH_LIMIT - PITCH_KNEE), 1);
  const smooth = t * t * (3 - 2 * t);  // smoothstep 0→1
  return Math.sign(deg) * (PITCH_KNEE + (PITCH_LIMIT - PITCH_KNEE) * smooth);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function getEulerAxis(euler, axis) {
  if (axis === 'pitch') return softClampPitch(euler.y);
  if (axis === 'roll')  return euler.x;
  if (axis === 'yaw')   return euler.z;
  return 0;
}

// Map value from [a, b] → [0, 1], clamped.
function inverseLerp(a, b, v) {
  return b === a ? 0 : Math.max(0, Math.min(1, (v - a) / (b - a)));
}

// Write one param value (internal units) to the right slot in S.
function applyParam(param, val) {
  const def = PARAM_DEFS[param];
  if (!def) return;
  const clamped = param === 'k'
    ? Math.round(Math.max(def.min, Math.min(def.max, val)))
    : Math.max(def.min, Math.min(def.max, val));

  switch (param) {
    case 'searchRadiusDeg': S.searchRadiusDeg  = clamped; break;
    case 'probability':     S.grainProbability = clamped; break;
    case 'volume':
      S.grainOverrides.volume = clamped;
      rebuildGrainCurves();
      break;
    default:
      if (param in S.grainOverrides) S.grainOverrides[param] = clamped;
  }
}

// Read the currently active value for a param (override > grainParams > def.min).
function getParamCurrent(param) {
  if (param === 'searchRadiusDeg') return S.searchRadiusDeg;
  if (param === 'probability')     return S.grainProbability;
  return S.grainOverrides[param] ?? S.grainParams[param] ?? PARAM_DEFS[param]?.min ?? 0;
}

// ── Preset interpolation ──────────────────────────────────────────────────────

// Returns a new plain-object with all numeric fields lerped between a and b.
// Strings / booleans threshold at t = 0.5.
export function lerpPresets(a, b, t) {
  const out  = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k], bv = b[k];
    out[k] = (typeof av === 'number' && typeof bv === 'number')
      ? av + (bv - av) * t
      : (t < 0.5 ? av : bv);
  }
  return out;
}

// 3-point piecewise lerp: A → C (center) → B.
// t=0→A, t=0.5→C, t=1→B; each half is a separate linear segment.
// presetC may be null/undefined — callers should guard with m.presetC >= 0.
export function lerpPresets3(a, center, b, t) {
  if (t <= 0.5) return lerpPresets(a, center, t * 2);
  return lerpPresets(center, b, (t - 0.5) * 2);
}

// Bilinear interpolation between four corner presets.
// tx=0→left, tx=1→right; ty=0→bottom, ty=1→top.
// Numeric fields are weighted-summed; strings/booleans go to nearest corner.
export function lerpPresets4(tl, tr, bl, br, tx, ty) {
  const wTL = (1 - tx) * ty;
  const wTR = tx * ty;
  const wBL = (1 - tx) * (1 - ty);
  const wBR = tx * (1 - ty);
  const out  = {};
  const keys = new Set([...Object.keys(tl), ...Object.keys(tr), ...Object.keys(bl), ...Object.keys(br)]);
  for (const k of keys) {
    const a = tl[k], b = tr[k], c = bl[k], d = br[k];
    if (typeof a === 'number' && typeof b === 'number' && typeof c === 'number' && typeof d === 'number') {
      out[k] = wTL * a + wTR * b + wBL * c + wBR * d;
    } else {
      const mx = Math.max(wTL, wTR, wBL, wBR);
      out[k] = mx === wTL ? a : mx === wTR ? b : mx === wBL ? c : d;
    }
  }
  return out;
}

// 5-point interpolation: 4 corners + center.
// Center weight is a tent function: 1 at (0.5,0.5), 0 at all edges/corners.
// Remaining weight distributes to corners bilinearly so the math is smooth
// and continuous everywhere — dragging to any corner gives that preset purely.
export function lerpPresets5(tl, tr, bl, br, center, tx, ty) {
  const wC  = (1 - Math.abs(2 * tx - 1)) * (1 - Math.abs(2 * ty - 1));
  const s   = 1 - wC;  // remaining weight for corners
  const wTL = (1 - tx) * ty       * s;
  const wTR = tx * ty              * s;
  const wBL = (1 - tx) * (1 - ty) * s;
  const wBR = tx * (1 - ty)       * s;
  const out  = {};
  const keys = new Set([
    ...Object.keys(tl), ...Object.keys(tr),
    ...Object.keys(bl), ...Object.keys(br), ...Object.keys(center),
  ]);
  for (const k of keys) {
    const a = tl[k], b = tr[k], c = bl[k], d = br[k], e = center[k];
    if (typeof a === 'number' && typeof b === 'number' && typeof c === 'number' &&
        typeof d === 'number' && typeof e === 'number') {
      out[k] = wTL * a + wTR * b + wBL * c + wBR * d + wC * e;
    } else {
      // Nearest point wins
      const weights = [wTL, wTR, wBL, wBR, wC];
      const vals    = [a,   b,   c,   d,   e];
      const mx = Math.max(...weights);
      out[k] = vals[weights.indexOf(mx)];
    }
  }
  return out;
}

// Apply a 2D morph at position (tx, ty) immediately.
// Called both from updateWand (wand-driven) and from the UI pad (manual drag).
export function applyXY2D(tx, ty) {
  const c = wandConfig.xy2d;
  const clamp = v => Math.max(0, Math.min(1, v));
  const cx = clamp(tx), cy = clamp(ty);
  const last  = PRESETS.length - 1;
  const bound = i => Math.max(0, Math.min(last, i));
  const pTL = PRESETS[bound(c.presetTL)];
  const pTR = PRESETS[bound(c.presetTR)];
  const pBL = PRESETS[bound(c.presetBL)];
  const pBR = PRESETS[bound(c.presetBR)];
  const pC  = PRESETS[bound(c.presetC)];
  applyLerpedPreset(lerpPresets5(pTL, pTR, pBL, pBR, pC, cx, cy));
  throttledUISync();
}

// Apply a lerped preset object to S via grainOverrides + direct state.
function applyLerpedPreset(p) {
  const overrideKeys = [
    'duration', 'durJitter', 'durVar', 'fadeRatio', 'k',
    'period', 'periodVar', 'pitchJitter', 'panSpread', 'retriggerMs',
  ];
  let volumeChanged = false;
  for (const k of overrideKeys) {
    if (typeof p[k] === 'number') {
      S.grainOverrides[k] = k === 'k' ? Math.round(p[k]) : p[k];
    }
  }
  if (typeof p.volume === 'number') {
    S.grainOverrides.volume = p.volume;
    volumeChanged = true;
  }
  if (volumeChanged) rebuildGrainCurves();

  if (typeof p.searchRadiusDeg === 'number') S.searchRadiusDeg  = p.searchRadiusDeg;
  if (typeof p.probability     === 'number') S.grainProbability = p.probability;
  if (typeof p.nearestMode     === 'boolean') S.nearestMode     = p.nearestMode;
  if (typeof p.direction       === 'string')  S.grainDirection  = p.direction;
  if (typeof p.curveType       === 'string' && p.curveType !== S.grainCurveType) {
    S.grainCurveType = p.curveType;
    rebuildGrainCurves();
  }
}

// ── UI sync throttle ──────────────────────────────────────────────────────────
// Throttled to ~30 Hz — fast enough to look smooth, cheap enough to not churn DOM.
let _lastUISyncAt = 0;

function throttledUISync() {
  const now = performance.now();
  if (now - _lastUISyncAt < 33) return;
  _lastUISyncAt = now;
  requestAnimationFrame(() => S.syncGrainControlsUI?.());
}

// ── t-value smoother ──────────────────────────────────────────────────────────
// Each morph and axis slot gets its own smoothed t value so parameter output
// glides between sensor ticks rather than jumping.  Uses a time-based one-pole
// lowpass: alpha = 1 - exp(-dt / TAU).  At 50 Hz sensor rate (~20ms ticks)
// TAU=60ms gives alpha≈0.28 per tick — noticeably smooth without lag.
// Gyro agitation is intentionally NOT smoothed — instantaneous response there
// is the point.
export const SMOOTH_TAU_S = 0.06;   // seconds — exposed so UI can display it later

export const smoothedT = {};   // key → last smoothed t (read by ui-wand for cursor display)
let   _lastWandTs = 0;    // performance.now() / 1000 at last updateWand call

function smoothT(key, raw, alpha) {
  const prev = smoothedT[key] ?? raw;  // seed with raw on first call
  const val  = prev + (raw - prev) * alpha;
  smoothedT[key] = val;
  return val;
}

// ── Clear overrides set by the wand ──────────────────────────────────────────
// Called when wand is disabled.  Nulls out all grainOverrides so presets
// regain control.  Note: S.searchRadiusDeg / grainProbability / nearestMode
// keep their last wand values — re-select a preset to fully reset them.
export function clearWandOverrides() {
  Object.keys(S.grainOverrides).forEach(k => { S.grainOverrides[k] = null; });
  throttledUISync();
}

// ── Main update ───────────────────────────────────────────────────────────────
// Called by osc.js after every /space/wand and /space/wand/inertial message.
export function updateWand() {
  if (!wandConfig.enabled) return;
  const euler    = wand.zeroEuler;
  const inertial = wand.inertial;
  if (!euler) return;

  // Compute smoothing alpha from real elapsed time so it's rate-independent.
  const nowS  = performance.now() * 0.001;
  const dt    = Math.min(nowS - _lastWandTs, 0.1);  // cap at 100ms (e.g. after tab hide)
  _lastWandTs = nowS;
  const alpha = dt > 0 ? 1 - Math.exp(-dt / SMOOTH_TAU_S) : 1;

  // ── 2D bilinear morph — runs first as coarsest baseline ─────────────────
  const c2d = wandConfig.xy2d;
  if (c2d.enabled) {
    const rawX = c2d.axisX !== 'manual'
      ? inverseLerp(c2d.xMin, c2d.xMax, getEulerAxis(euler, c2d.axisX))
      : c2d.manualX;
    const rawY = c2d.axisY !== 'manual'
      ? inverseLerp(c2d.yMin, c2d.yMax, getEulerAxis(euler, c2d.axisY))
      : c2d.manualY;
    const tx = smoothT('xy2d_x', rawX, alpha);
    const ty = smoothT('xy2d_y', rawY, alpha);
    applyXY2D(tx, ty);
  }

  // ── Preset morph slots (A, B, C) — layer on top of 2D baseline ──────────
  // Multiple enabled morphs stack in order; each one writes all params so the
  // last active slot provides the outermost baseline.  Axis slots run after
  // and always override their specific params on top of whatever morph set.
  for (const [key, m] of [['morphA', wandConfig.morphA], ['morphB', wandConfig.morphB], ['morphC', wandConfig.morphC]]) {
    if (!m.enabled) continue;
    const rawT = inverseLerp(m.inMin, m.inMax, getEulerAxis(euler, m.axis));
    const t    = smoothT(key, rawT, alpha);
    const pA   = PRESETS[Math.max(0, Math.min(PRESETS.length - 1, m.presetA))];
    const pB   = PRESETS[Math.max(0, Math.min(PRESETS.length - 1, m.presetB))];
    if (m.presetC >= 0) {
      const pC = PRESETS[Math.max(0, Math.min(PRESETS.length - 1, m.presetC))];
      applyLerpedPreset(lerpPresets3(pA, pC, pB, t));
    } else {
      applyLerpedPreset(lerpPresets(pA, pB, t));
    }
  }

  // ── Orientation axis slots (A, B, C) — run after morph, always win ──────
  for (const [key, slot] of [['axisA', wandConfig.axisA], ['axisB', wandConfig.axisB], ['axisC', wandConfig.axisC]]) {
    if (slot.param === 'none') continue;
    const def = PARAM_DEFS[slot.param];
    if (!def) continue;
    let rawT = inverseLerp(slot.inMin, slot.inMax, getEulerAxis(euler, slot.src));
    if (slot.invert) rawT = 1 - rawT;
    const t      = smoothT(key, rawT, alpha);
    const outMin = slot.outMin ?? def.min;
    const outMax = slot.outMax ?? def.max;
    applyParam(slot.param, outMin + t * (outMax - outMin));
  }

  // ── Gyro agitation ──────────────────────────────────────────────────────
  // Additive: on top of whatever the orientation slots or morph just set.
  if (inertial && wandConfig.gyro.param !== 'none') {
    const { param, threshold, maxMag, strength } = wandConfig.gyro;
    const def = PARAM_DEFS[param];
    if (def) {
      const t     = inverseLerp(threshold, maxMag, inertial.gyroMag);
      const base  = getParamCurrent(param);
      const delta = t * strength * (def.max - def.min);
      applyParam(param, base + delta);
    }
  }

  throttledUISync();
}

// ── Phase 4: Gesture Morph System ──────────────────────────────────────────
// Called by osc.js after every /space/wand/inertial message (independent of
// wandConfig.enabled — gesture morphing is a core improv feature).
//
// Reads wand.inertial.gyroMag and drives the morphT position on the nearest
// cloud(s) along a smooth↔agitated axis. morphT=0.5 = planted snapshot,
// morphT=1.0 = max agitated, morphT=0.0 = max smooth.
//
// The agitation axis applies additive deltas to cloud.grainOverrides:
//   Agitated (+): period ↓, pitchJitter ↑, durJitter ↑, fadeRatio ↓
//   Smooth   (−): duration ↑, period ↑, pitchJitter ↓, durJitter ↓, fadeRatio ↑

// Agitation axis delta definitions — max delta at morphT=0 or morphT=1.
// Positive values = increase, negative = decrease. Applied as additive offsets
// from the planted snapshot values. Scaled by |morphT - 0.5| * 2.
const AGITATE_DELTAS = {
  period:      -0.8,      // shorten period (faster grain rate), in seconds
  pitchJitter:  0.025,    // more pitch randomness
  durJitter:    0.5,      // more duration randomness
  fadeRatio:   -0.15,     // sharper attack (less fade)
  duration:    -0.3,      // shorter grains
};

const SMOOTH_DELTAS = {
  period:       0.5,      // lengthen period (slower grain rate)
  pitchJitter: -0.01,     // less pitch randomness
  durJitter:   -0.3,      // less duration randomness
  fadeRatio:    0.15,     // softer attack (more fade)
  duration:     0.5,      // longer grains
};

const MORPH_VELOCITY_SCALE   = 0.0004;  // per deg/s of gyroMag above threshold
const MORPH_VELOCITY_DECAY   = 0.85;    // friction per tick (momentum mode)
const MORPH_ACCEL_DEADZONE   = 0.05;    // g — below this, "stationary" (don't smooth)

let _lastMorphTs = 0;

export function updateGestureMorph() {
  if (!S.morphEnabled) return;

  const inertial = wand.inertial;
  if (!inertial) return;

  const { gyroMag, accelDynMag } = inertial;
  const nowS = performance.now() * 0.001;
  const dt   = Math.min(nowS - _lastMorphTs, 0.1);
  _lastMorphTs = nowS;
  if (dt <= 0) return;

  // Get cursor position for nearest-cloud lookup
  const { lon: cursorLon, lat: cursorLat } =
    (S.mouseInCanvas || S.altLocked)
      ? screenToLonLat(S.altLocked ? S.altFrozenMousePixelX : S.mousePixelX,
                       S.altLocked ? S.altFrozenMousePixelY : S.mousePixelY)
      : getCursorLonLat();

  // Determine which clouds to morph and their weights.
  // In nearest-cloud mode with crossfade: distribute morph by distance weights.
  // Otherwise: morph the single nearest cloud.
  const morphTargets = []; // [{ cloud, weight }]

  if (S.cloudMode === 'nearest' && S.cloudSnapFade > 0.001) {
    const radiusGated = !S.cloudNearestAlways;
    const gateRadRad = radiusGated ? (S.searchRadiusDeg * Math.PI / 180) : Infinity;
    const cloudDists = [];
    for (let i = 0; i < MAX_CLOUDS; i++) {
      const cloud = S.cloudSlots[i];
      if (!cloud) continue;
      const dist = angleBetweenSphere(cloud.lon, cloud.lat, cursorLon, cursorLat);
      if (radiusGated && dist > gateRadRad) continue;
      cloudDists.push({ cloud, dist });
    }
    if (cloudDists.length === 0) return;

    const sf = S.cloudSnapFade;
    const sharpness = 1 / Math.max(0.01, sf);
    const EPSILON = 0.001;
    let sumW = 0;
    for (const cd of cloudDists) {
      cd.w = Math.pow(1 / (cd.dist + EPSILON), sharpness);
      sumW += cd.w;
    }
    for (const cd of cloudDists) {
      const w = sumW > 0 ? cd.w / sumW : 0;
      if (w > 0.001) morphTargets.push({ cloud: cd.cloud, weight: w });
    }
  } else {
    const nearestSlot = findNearestCloudSlot(cursorLon, cursorLat);
    if (nearestSlot < 0) return;
    morphTargets.push({ cloud: S.cloudSlots[nearestSlot], weight: 1 });
  }

  // Compute morph velocity from gyro
  let velocityDelta = 0;
  if (gyroMag > S.agitateThreshold) {
    velocityDelta = (gyroMag - S.agitateThreshold) * MORPH_VELOCITY_SCALE;
  } else if (gyroMag < S.smoothThreshold && accelDynMag > MORPH_ACCEL_DEADZONE) {
    velocityDelta = -(S.smoothThreshold - gyroMag) * MORPH_VELOCITY_SCALE * 0.5;
  }

  // Apply morph to each target cloud
  for (const { cloud, weight } of morphTargets) {
    cloud.morphVelocity = (cloud.morphVelocity ?? 0) * MORPH_VELOCITY_DECAY
                        + velocityDelta * weight;

    cloud.morphT = Math.max(0, Math.min(1,
      (cloud.morphT ?? 0.5) + cloud.morphVelocity * dt * 60
    ));

    // Elastic recovery: drift morphT toward 0.5 when idle
    if (S.morphHoldMode === 'elastic' && Math.abs(velocityDelta) < 0.0001) {
      const recoveryRate = S.morphElasticRate * dt * 60;
      cloud.morphT += (0.5 - cloud.morphT) * recoveryRate;
    }

    // Compute agitation axis deltas and write to cloud.grainOverrides
    const deviation = (cloud.morphT - 0.5) * 2; // -1 to +1
    const absDeviation = Math.abs(deviation);
    const deltas = deviation >= 0 ? AGITATE_DELTAS : SMOOTH_DELTAS;
    const snap = cloud.grainParams;

    if (!cloud.grainOverrides) cloud.grainOverrides = {};

    for (const [param, maxDelta] of Object.entries(deltas)) {
      if (snap[param] === undefined) continue;
      const delta = maxDelta * absDeviation;
      const newVal = snap[param] + delta;
      switch (param) {
        case 'duration':
          cloud.grainOverrides[param] = Math.max(0.005, newVal); break;
        case 'period':
          cloud.grainOverrides[param] = Math.max(0.002, newVal); break;
        case 'pitchJitter':
          cloud.grainOverrides[param] = Math.max(0, Math.min(0.05, newVal)); break;
        case 'durJitter':
          cloud.grainOverrides[param] = Math.max(0, Math.min(1, newVal)); break;
        case 'fadeRatio':
          cloud.grainOverrides[param] = Math.max(0, Math.min(0.5, newVal)); break;
        default:
          cloud.grainOverrides[param] = Math.max(0, newVal);
      }
    }

    // Invalidate envelope curve cache so playGrain rebuilds with new fade
    if (cloud.grainParams._cachedAtk) cloud.grainParams._cachedAtk = null;
  }
}
