// ============================================================================
// seed-morph.js — the gesture morph engine
//
// Originally extracted from the since-deleted wand.js during the Mar 28 2026
// sensor-registry refactor. Contains updateGestureMorph(): gyro-driven seed
// agitation/smoothing. The lerpPresets() family that used to sit beside it
// had one reader, the cloud-morph slider, and went with the patch bank on
// 2026-09-03 (sandbox/sunset-2026-09-03/patch-bank.js).
//
// updateGestureMorph() reads inertial data from the gesture role slot and
// drives morphT on the nearest seed(s).  morphT=0.5 = planted snapshot,
// morphT→1.0 = agitated, morphT→0.0 = smoothed.
//
// Called by osc.js after inertial sensor messages.
// ============================================================================

import { S, MAX_SEEDS } from './state.js';
import { getByRole } from './sensor-registry.js';
import { angleBetweenSphere, findNearestSeedSlot } from './grain.js';
import { getCursorLonLat, screenToLonLat } from './sphere.js';

// Agitation axis delta definitions — max delta at morphT=0 or morphT=1.
const AGITATE_DELTAS = {
  period:      -0.8,
  pitchJitter:  0.025,
  durJitter:    0.5,
  fadeRatio:   -0.15,
  duration:    -0.3,
};

const SMOOTH_DELTAS = {
  period:       0.5,
  pitchJitter: -0.01,
  durJitter:   -0.3,
  fadeRatio:    0.15,
  duration:     0.5,
};

const MORPH_VELOCITY_SCALE   = 0.0004;
const MORPH_VELOCITY_DECAY   = 0.85;
const MORPH_ACCEL_DEADZONE   = 0.05;

let _lastMorphTs = 0;

export function updateGestureMorph() {

  const gestureSlot = getByRole('gesture');
  const inertial = gestureSlot?.inertial;
  if (!inertial) return;

  const { gyroMag, accelDynMag } = inertial;
  const nowS = performance.now() * 0.001;
  const dt   = Math.min(nowS - _lastMorphTs, 0.1);
  _lastMorphTs = nowS;
  if (dt <= 0) return;

  // Get cursor position for nearest-seed lookup
  const { lon: cursorLon, lat: cursorLat } =
    S.cursorQ
      ? getCursorLonLat()                       // detethered: cursor IMU drives position
      : (S.mouseInCanvas || S.altLocked)
        ? screenToLonLat(S.altLocked ? S.altFrozenMousePixelX : S.mousePixelX,
                         S.altLocked ? S.altFrozenMousePixelY : S.mousePixelY)
        : getCursorLonLat();

  // Determine which seeds to morph and their weights.
  const morphTargets = [];

  if (S.seedMode === 'focus' && S.seedXfade > 0.001) {
    const radiusGated = !S.seedTether;
    const gateRadRad = radiusGated ? (S.searchRadiusDeg * Math.PI / 180) : Infinity;
    const seedDists = [];
    for (let i = 0; i < S.commitSlotCount; i++) {
      const seed = S.commitSlots[i];
      if (!seed || seed.type !== 'cloud') continue;
      const dist = angleBetweenSphere(seed.lon, seed.lat, cursorLon, cursorLat);
      if (radiusGated && dist > gateRadRad) continue;
      seedDists.push({ seed, dist });
    }
    if (seedDists.length === 0) return;

    const sf = S.seedXfade;
    const sharpness = 1 / Math.max(0.01, sf);
    const EPSILON = 0.001;
    let sumW = 0;
    for (const cd of seedDists) {
      cd.w = Math.pow(1 / (cd.dist + EPSILON), sharpness);
      sumW += cd.w;
    }
    for (const cd of seedDists) {
      const w = sumW > 0 ? cd.w / sumW : 0;
      if (w > 0.001) morphTargets.push({ seed: cd.seed, weight: w });
    }
  } else {
    const nearestSlot = findNearestSeedSlot(cursorLon, cursorLat);
    if (nearestSlot < 0) return;
    morphTargets.push({ seed: S.seedSlots[nearestSlot], weight: 1 });
  }

  // Compute morph velocity from gyro
  let velocityDelta = 0;
  if (gyroMag > S.agitateThreshold) {
    velocityDelta = (gyroMag - S.agitateThreshold) * MORPH_VELOCITY_SCALE;
  } else if (gyroMag < S.smoothThreshold && accelDynMag > MORPH_ACCEL_DEADZONE) {
    velocityDelta = -(S.smoothThreshold - gyroMag) * MORPH_VELOCITY_SCALE * 0.5;
  }

  // Apply morph to each target seed
  for (const { seed, weight } of morphTargets) {
    seed.morphVelocity = (seed.morphVelocity ?? 0) * MORPH_VELOCITY_DECAY
                        + velocityDelta * weight;

    seed.morphT = Math.max(0, Math.min(1,
      (seed.morphT ?? 0.5) + seed.morphVelocity * dt * 60
    ));


    // Compute agitation axis deltas and write to seed.grainOverrides
    const deviation = (seed.morphT - 0.5) * 2;
    const absDeviation = Math.abs(deviation);
    const deltas = deviation >= 0 ? AGITATE_DELTAS : SMOOTH_DELTAS;
    const snap = seed.grainParams;

    if (!seed.grainOverrides) seed.grainOverrides = {};

    for (const [param, maxDelta] of Object.entries(deltas)) {
      if (snap[param] === undefined) continue;
      const delta = maxDelta * absDeviation;
      const newVal = snap[param] + delta;
      switch (param) {
        case 'duration':
          seed.grainOverrides[param] = Math.max(0.005, newVal); break;
        case 'period':
          seed.grainOverrides[param] = Math.max(0.002, newVal); break;
        case 'pitchJitter':
          seed.grainOverrides[param] = Math.max(0, Math.min(0.05, newVal)); break;
        case 'durJitter':
          seed.grainOverrides[param] = Math.max(0, Math.min(1, newVal)); break;
        case 'fadeRatio':
          seed.grainOverrides[param] = Math.max(0, Math.min(0.5, newVal)); break;
        default:
          seed.grainOverrides[param] = Math.max(0, newVal);
      }
    }

  }
}
