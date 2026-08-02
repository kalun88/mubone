// ============================================================================
// gesture.js — Gesture feature extraction from IMU data
//
// Derives high-level movement qualities from gyro + accel streams.
// Source-agnostic: reads from whatever IMU slot has the 'gesture' role.
// No quaternion dependency — all features derive from inertial data alone.
//
// Runs every frame (~60 Hz from rAF or every inertial OSC tick at ~100 Hz).
// Outputs a gesture descriptor on S.gesture that other modules can read.
//
// Features:
//   intensity       (0–1)  how much you're moving — EMA of gyro magnitude
//   smoothness      (0–1)  how fluid the movement — low variation = smooth
//   effort          (0–1)  rotational speed + linear acceleration combined
//   periodicity     (0–1)  autocorrelation on dominant axis (hysteresis hold)
//   periodicityHz   (Hz)   detected repetition frequency (0 if none)
//   accumulatedEnergy (0–1) leaky integrator of effort — builds up, decays
//
// Verification tests (hold sensor, observe gesture panel):
//   intensity:  still → 0, gentle wave → 0.3, vigorous shake → 1.0
//   smoothness: still → 0, slow steady arc → 0.8, jerky/stuttered → 0.1
//   effort:     gentle motion → low, forceful thrust → high
//   periodicity: random movement → 0, steady back-and-forth → rises to 0.8+
//   energy:     sustained playing → builds, rest → decays over ~1–2 seconds
// ============================================================================

import { S, DEBUG, PRESETS } from './state.js';
import { getByRole } from './sensor-registry.js';
import { isLocked } from './param-lock.js';

// ── Configuration ───────────────────────────────────────────────────────────

// Intensity: EMA of gyro magnitude, normalized to 0–1.
const INTENSITY_FAST_COEFF = 0.20;   // fast EMA ~5 frame time constant
const INTENSITY_SLOW_COEFF = 0.06;   // slow EMA ~17 frame time constant
const INTENSITY_SCALE      = 1/250;  // 250 deg/s = full scale
const INTENSITY_NOISE_FLOOR = 5;     // deg/s — below this, decay toward 0

// Smoothness: coefficient of variation of gyroMag over a window.
// Low CV = steady speed = smooth.  High CV = jerky speed changes = not smooth.
const SMOOTH_WINDOW        = 30;     // frames (~0.3s at 100 Hz)

// Effort: weighted combination of gyro + accel magnitudes.
const EFFORT_GYRO_SCALE    = 1/400;  // normalize gyro (deg/s) → ~[0,1]
const EFFORT_ACCEL_SCALE   = 1/3;    // normalize accel (g) → ~[0,1]

// Accumulated energy: leaky integrator of effort.
const ENERGY_DECAY         = 0.993;  // per-frame (~1s half-life at 100 Hz)

// Periodicity: autocorrelation on dominant gyro axis with hysteresis.
// Uses signed dominant axis so back-and-forth reads as clean ±wave.
const PERIO_WINDOW         = 150;    // frames (~1.5s at 100 Hz)
const PERIO_MIN_LAG        = 10;     // min lag ~0.1s (skip very fast jitter)
const PERIO_MAX_LAG        = 80;     // max lag ~0.8s (min ~1.25 Hz)
const PERIO_PEAK_MIN       = 0.35;   // min correlation to count as periodic (raised — noise was triggering at 0.20)
const PERIO_ATTACK         = 0.10;   // how fast periodicity rises
const PERIO_RELEASE        = 0.03;   // how fast it falls
const PERIO_INTENSITY_GATE = 0.08;   // suppress periodicity when intensity below this (noise floor)
// Dominant axis hysteresis: don't switch unless new axis has 1.5× more energy
const PERIO_AXIS_SWITCH_RATIO = 1.5;

// ── State ───────────────────────────────────────────────────────────────────

let _prevTs        = 0;

// Intensity: EMA state
let _intensityFastEMA = 0;
let _intensitySlowEMA = 0;

// Jerk
let _prevGyroMag   = 0;
let _hasPrev       = false;

// Smoothness: ring buffer for coefficient of variation
const _smoothBuf   = new Float32Array(SMOOTH_WINDOW);
let   _smoothIdx   = 0;
let   _smoothCount = 0;
let   _smoothEMA   = 0;

// Accumulated energy
let _accumulatedEnergy = 0;

// Periodicity: per-axis history + dominant axis tracking
const _axisHistory = [
  new Float32Array(PERIO_WINDOW),
  new Float32Array(PERIO_WINDOW),
  new Float32Array(PERIO_WINDOW),
];
const _axisEnergy  = new Float64Array(3);  // running energy per axis
let   _perioIdx    = 0;
let   _perioCount  = 0;
let   _domAxis     = 0;                   // current dominant axis (with hysteresis)
let   _perioSmoothed   = 0;
let   _perioHzSmoothed = 0;
let   _avgDt           = 0.01;            // running average dt for Hz calc

// ── Note on calibration ─────────────────────────────────────────────────────
// Removed auto/timed calibration system.  Input range normalization is now
// handled entirely by the per-feature conditioning chain (inMin/inMax
// thresholds on the gesture panel sparklines).  This is more transparent —
// the performer can see and drag the thresholds directly.

// ── Signal conditioning ─────────────────────────────────────────────────────
// Per-feature chain: inRange → deadZone → curve → outRange → smoothing

const CONDITIONED_FEATURES = ['intensity', 'smoothness', 'periodicity', 'accumulatedEnergy'];

const _smoothedOut = {};
for (const k of CONDITIONED_FEATURES) _smoothedOut[k] = 0;

function applyDeadZone(value, dz) {
  if (dz <= 0) return value;
  if (value < dz) return 0;
  return (value - dz) / (1 - dz);
}

function applyCurve(value, curve) {
  if (curve === 1 || curve <= 0) return value;
  return Math.pow(value, curve);
}

function applyOutputSmoothing(key, rawValue) {
  const cfg = S.gestureCondition?.[key];
  const s = cfg?.smooth ?? 0;
  if (s <= 0.001) {
    _smoothedOut[key] = rawValue;
    return rawValue;
  }
  const coeff = 1 - s * s * 0.98;
  _smoothedOut[key] += (rawValue - _smoothedOut[key]) * coeff;
  return _smoothedOut[key];
}

function conditionFeature(key, value) {
  const cfg = S.gestureCondition?.[key];
  if (!cfg) return value;
  let v = Math.max(0, Math.min(1, value));

  const inMin = cfg.inMin ?? 0;
  const inMax = cfg.inMax ?? 1;
  if (inMax > inMin) v = (v - inMin) / (inMax - inMin);
  v = Math.max(0, Math.min(1, v));

  v = applyDeadZone(v, cfg.deadZone ?? 0);
  v = applyCurve(v, cfg.curve ?? 1);

  const outMin = cfg.outMin ?? 0;
  const outMax = cfg.outMax ?? 1;
  v = outMin + v * (outMax - outMin);

  return applyOutputSmoothing(key, v);
}

// ── Public descriptor (written to S.gesture each frame) ─────────────────────

const descriptor = {
  intensity:        0,    // how much movement (EMA of gyroMag)
  smoothness:       0,    // how fluid (low CV of gyroMag)
  effort:           0,    // gyro + accel combined
  periodicity:      0,    // autocorrelation (0–1)
  periodicityHz:    0,    // detected Hz
  accumulatedEnergy: 0,   // leaky integrator of effort
  // Raw (post-cal, pre-conditioning) for viz overlays
  rawIntensity:     0,
  rawSmoothness:    0,
  rawPeriodicity:   0,
  rawAccumulatedEnergy: 0,
  // Diagnostics
  jerk:             0,    // angular jerk (deg/s²)
  gyroMag:          0,    // raw gyro magnitude (deg/s)
  accelDynMag:      0,    // raw dynamic accel magnitude (g)
};

// ── Core update — call this every inertial tick ─────────────────────────────

export function updateGesture(source) {
  const src = source || getByRole('gesture');
  const inertial = src?.inertial;
  if (!inertial) return;

  const nowS = performance.now() * 0.001;
  const dt   = Math.min(nowS - _prevTs, 0.1);
  _prevTs    = nowS;
  if (dt <= 0) return;

  const { gx, gy, gz, gyroMag, accelDynMag } = inertial;

  descriptor.gyroMag     = gyroMag;
  descriptor.accelDynMag = accelDynMag;

  // ── Intensity (EMA of gyro magnitude) ───────────────────────────────────
  // How much you're moving.  Proportional, not binary.
  // Verify: still → 0, gentle wave → ~0.3, vigorous shake → ~1.0
  _intensityFastEMA += (gyroMag - _intensityFastEMA) * INTENSITY_FAST_COEFF;
  _intensitySlowEMA += (gyroMag - _intensitySlowEMA) * INTENSITY_SLOW_COEFF;

  if (gyroMag > INTENSITY_NOISE_FLOOR) {
    descriptor.intensity = Math.min(1, _intensitySlowEMA * INTENSITY_SCALE);
  } else {
    descriptor.intensity = Math.min(1, _intensitySlowEMA * INTENSITY_SCALE) * 0.95;
  }

  // ── Jerk (rate of change of gyroMag) ────────────────────────────────────
  if (_hasPrev) {
    descriptor.jerk = Math.abs(gyroMag - _prevGyroMag) / dt;
  }
  _prevGyroMag = gyroMag;
  _hasPrev     = true;

  // ── Smoothness (coefficient of variation of gyroMag) ────────────────────
  // Measures movement *quality*, independent of amount.
  // Low CV = consistent speed = fluid/smooth.  High CV = variable speed = jerky.
  // Requires movement to be meaningful; decays to 0 when still.
  //
  // Verify: still → 0, slow steady arc → ~0.8, fast steady sweep → ~0.8,
  //         jerky/stuttered → ~0.2, sudden start/stop → drops
  {
    _smoothBuf[_smoothIdx % SMOOTH_WINDOW] = gyroMag;
    _smoothIdx++;
    _smoothCount = Math.min(_smoothCount + 1, SMOOTH_WINDOW);

    if (_smoothCount >= 8 && _intensitySlowEMA > INTENSITY_NOISE_FLOOR) {
      let sum = 0, sumSq = 0;
      for (let i = 0; i < _smoothCount; i++) {
        const v = _smoothBuf[i];
        sum   += v;
        sumSq += v * v;
      }
      const mean     = sum / _smoothCount;
      const variance = sumSq / _smoothCount - mean * mean;
      const stddev   = Math.sqrt(Math.max(0, variance));
      const cv       = mean > 1 ? stddev / mean : 1;  // cv=0 is perfectly steady
      // Invert: cv=0 → smoothness=1, cv≥0.6 → smoothness=0
      const rawSmooth = Math.max(0, 1 - cv / 0.6);
      _smoothEMA += (rawSmooth - _smoothEMA) * 0.12;
      descriptor.smoothness = Math.max(0, _smoothEMA);
    } else {
      // Not enough data or below noise floor — decay toward 0
      _smoothEMA *= 0.97;
      descriptor.smoothness = Math.max(0, _smoothEMA);
    }
  }

  // ── Effort (gyro + accel combined) ──────────────────────────────────────
  // Verify: gentle wave → low, forceful thrust → high
  const gyroNorm  = Math.min(1, gyroMag * EFFORT_GYRO_SCALE);
  const accelNorm = Math.min(1, accelDynMag * EFFORT_ACCEL_SCALE);
  descriptor.effort = Math.min(1, gyroNorm * 0.7 + accelNorm * 0.3);

  // ── Accumulated energy ──────────────────────────────────────────────────
  _accumulatedEnergy = _accumulatedEnergy * ENERGY_DECAY + descriptor.effort * dt;
  descriptor.accumulatedEnergy = Math.min(2, _accumulatedEnergy);

  // ── Periodicity (autocorrelation on dominant gyro axis) ─────────────────
  // Uses signed value of dominant axis so back-and-forth oscillation reads as
  // clean ±wave with correct period.  Dominant axis has hysteresis to avoid
  // rapid switching between axes mid-gesture.
  //
  // Verify: random movement → 0, steady back-and-forth → rises to 0.8+,
  //         stops when you stop repeating (with ~1s hold from hysteresis)
  {
    _avgDt += (dt - _avgDt) * 0.02;

    const wi = _perioIdx % PERIO_WINDOW;

    // Subtract oldest sample's energy before overwriting
    if (_perioCount === PERIO_WINDOW) {
      _axisEnergy[0] -= _axisHistory[0][wi] * _axisHistory[0][wi];
      _axisEnergy[1] -= _axisHistory[1][wi] * _axisHistory[1][wi];
      _axisEnergy[2] -= _axisHistory[2][wi] * _axisHistory[2][wi];
    }

    _axisHistory[0][wi] = gx;
    _axisHistory[1][wi] = gy;
    _axisHistory[2][wi] = gz;

    _axisEnergy[0] += gx * gx;
    _axisEnergy[1] += gy * gy;
    _axisEnergy[2] += gz * gz;

    // Pick dominant axis with hysteresis — only switch if new axis has
    // substantially more energy, preventing mid-gesture axis flipping
    let candidateAxis = 0;
    if (_axisEnergy[1] > _axisEnergy[candidateAxis]) candidateAxis = 1;
    if (_axisEnergy[2] > _axisEnergy[candidateAxis]) candidateAxis = 2;
    if (candidateAxis !== _domAxis) {
      if (_axisEnergy[candidateAxis] > _axisEnergy[_domAxis] * PERIO_AXIS_SWITCH_RATIO) {
        _domAxis = candidateAxis;
      }
    }

    _perioIdx++;
    _perioCount = Math.min(_perioCount + 1, PERIO_WINDOW);
  }

  // Autocorrelation on dominant axis history
  let _rawPerio = 0;
  let _rawHz    = 0;

  if (_perioCount >= PERIO_MIN_LAG * 3) {
    const n = _perioCount;
    const oldest = _perioIdx >= PERIO_WINDOW ? (_perioIdx % PERIO_WINDOW) : 0;

    // Use dominant axis values
    const hist = _axisHistory[_domAxis];

    let mean = 0;
    for (let i = 0; i < n; i++) mean += hist[(oldest + i) % PERIO_WINDOW];
    mean /= n;

    let variance = 0;
    for (let i = 0; i < n; i++) {
      const d = hist[(oldest + i) % PERIO_WINDOW] - mean;
      variance += d * d;
    }

    if (variance > 50 && _intensitySlowEMA > INTENSITY_NOISE_FLOOR) {
      let bestCorr = 0;
      let bestLag  = 0;
      const maxLag = Math.min(PERIO_MAX_LAG, Math.floor(n / 2));

      for (let lag = PERIO_MIN_LAG; lag <= maxLag; lag++) {
        let sum = 0;
        const pairs = n - lag;
        for (let i = 0; i < pairs; i++) {
          const a = hist[(oldest + i) % PERIO_WINDOW] - mean;
          const b = hist[(oldest + i + lag) % PERIO_WINDOW] - mean;
          sum += a * b;
        }
        const corr = sum / variance;
        if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
      }

      if (bestCorr >= PERIO_PEAK_MIN) {
        _rawPerio = Math.min(1, bestCorr);
        _rawHz    = bestLag > 0 ? (1 / (bestLag * _avgDt)) : 0;
      }
    }
  }

  // Hysteresis: fast attack, slow release
  if (_rawPerio > _perioSmoothed) {
    _perioSmoothed += (_rawPerio - _perioSmoothed) * PERIO_ATTACK;
  } else {
    _perioSmoothed += (_rawPerio - _perioSmoothed) * PERIO_RELEASE;
  }
  if (_rawHz > 0) {
    _perioHzSmoothed += (_rawHz - _perioHzSmoothed) * PERIO_ATTACK;
  } else {
    _perioHzSmoothed *= (1 - PERIO_RELEASE);
  }

  // Gate on intensity — no periodicity when barely moving
  const intensityNow = _intensitySlowEMA * INTENSITY_SCALE;
  if (intensityNow < PERIO_INTENSITY_GATE) {
    _perioSmoothed   *= 0.92;  // fast decay when still
    _perioHzSmoothed *= 0.92;
  }

  descriptor.periodicity   = Math.max(0, _perioSmoothed);
  descriptor.periodicityHz = _perioHzSmoothed;

  // Normalize accumulated energy to 0–1
  const normEnergy = Math.min(1, descriptor.accumulatedEnergy / 1.5);

  // ── Store raw (post-cal, pre-conditioning) for viz ────────────────────────
  descriptor.rawIntensity        = descriptor.intensity;
  descriptor.rawSmoothness       = descriptor.smoothness;
  descriptor.rawPeriodicity      = descriptor.periodicity;
  descriptor.rawAccumulatedEnergy = normEnergy;

  // ── Apply conditioning chain ──────────────────────────────────────────────
  descriptor.intensity         = conditionFeature('intensity',         descriptor.intensity);
  descriptor.smoothness        = conditionFeature('smoothness',        descriptor.smoothness);
  descriptor.periodicity       = conditionFeature('periodicity',       descriptor.periodicity);
  descriptor.accumulatedEnergy = conditionFeature('accumulatedEnergy', normEnergy);

  // ── Write to shared state ─────────────────────────────────────────────────
  S.gesture = descriptor;
}

// ── Energy map — modulate cursor grain params from accumulated energy ────────
// Simple one-dimensional modulation: more energy → more variation, shorter
// grains, wider spatial spread.  Cursor grains only (not seeds).
// Writes to S.grainOverrides and S.searchRadiusDeg — same paths the grain
// scheduler already reads.  Respects param locks.
//
// Hardcoded deltas for now.  S.energyMapOn toggles the whole thing.
// S.energyGain scales the conditioned energy value before mapping (default 1.0).

// Energy map delta table — each entry defines how a param responds to energy.
// type 'add':   override = base + energy^curve × delta
// type 'scale': override = base × (1 - energy × amount)
const ENERGY_MAP = [
  { key: 'pitchJitter', type: 'add',   delta: 0.04,  curve: 1.5 },
  { key: 'duration',    type: 'scale', amount: 0.5,  curve: 1.0 },
  { key: 'durJitter',   type: 'add',   delta: 0.3,   curve: 1.0 },
  { key: 'period',      type: 'scale', amount: 0.35, curve: 1.0 },
  { key: 'panSpread',   type: 'add',   delta: 0.3,   curve: 1.0 },
];
// searchRadiusDeg lives on S.*, not in grainOverrides — handled separately
const ENERGY_MAP_RADIUS_DELTA = 25;  // degrees added at full energy

// Stashed base searchRadiusDeg when energy map first engages
let _energyMapBaseRadius = null;
let _energyMapWasOn = false;

function applyEnergyMap() {
  if (!S.energyMapOn) {
    // Restore base radius when turning off
    if (_energyMapWasOn) {
      if (_energyMapBaseRadius !== null) S.searchRadiusDeg = _energyMapBaseRadius;
      _energyMapBaseRadius = null;
      _energyMapWasOn = false;
      // Clear overrides that energy map wrote
      for (const entry of ENERGY_MAP) {
        if (S.grainOverrides[entry.key] != null) S.grainOverrides[entry.key] = null;
      }
    }
    return;
  }

  const g = S.gesture;
  if (!g) return;

  // Apply gain to conditioned energy (already 0–1 from conditioning chain)
  const gain = S.energyGain ?? 1.0;
  const energy = Math.min(1, g.accumulatedEnergy * gain);

  // Stash base radius on first active frame
  if (!_energyMapWasOn) {
    _energyMapBaseRadius = S.searchRadiusDeg;
    _energyMapWasOn = true;
  }

  const base = S.grainParams;

  for (const entry of ENERGY_MAP) {
    if (isLocked(entry.key)) continue;

    const baseVal = base[entry.key];
    if (baseVal === undefined) continue;

    const e = entry.curve !== 1.0 ? Math.pow(energy, entry.curve) : energy;
    let val;
    if (entry.type === 'add') {
      val = baseVal + e * entry.delta;
    } else {
      // scale: shrink toward zero as energy rises
      val = baseVal * (1 - e * entry.amount);
    }

    // Clamp to sane ranges
    if (entry.key === 'pitchJitter') val = Math.max(0, Math.min(1, val));
    else if (entry.key === 'duration') val = Math.max(0.005, val);
    else if (entry.key === 'durJitter') val = Math.max(0, Math.min(1, val));
    else if (entry.key === 'period') val = Math.max(0.003, val);
    else if (entry.key === 'panSpread') val = Math.max(0, Math.min(1, val));

    S.grainOverrides[entry.key] = val;
  }

  // searchRadiusDeg — lives on S.*, not in grainOverrides
  if (!isLocked('searchRadiusDeg')) {
    S.searchRadiusDeg = _energyMapBaseRadius + energy * ENERGY_MAP_RADIUS_DELTA;
  }
}

// ── Radial morph pin system ─────────────────────────────────────────────────
// Pins are positions on the radial joystick, each assigned to a preset.
// When the joystick moves near a pin, the grain params morph toward that
// pin's preset.  Center = current GUI params (implicit, no pin needed).
//
// S.radialPins: [{ x, y, presetIdx }]  — joystick data-space coords
// S.radialMorphOn: boolean — enable/disable the morph output
// S.radialMorphFalloff: 1–4 — sharpness of inverse-distance weighting

const RADIAL_MORPH_FALLOFF_DEFAULT = 2.0;

// Snapshot the current GUI grain params (merged with overrides).
// Returns the base GUI state WITHOUT morph overrides.
// Used as the "center" preset for radial morph interpolation.
// Must NOT read S.grainOverrides — that contains the morph's own output
// and would create a feedback loop (morph reads its own previous frame).
// Includes params that live outside grainParams (searchRadiusDeg, probability).
function currentGrainSnapshot() {
  const snap = { ...S.grainParams };
  // These params live in special S.* locations, not in grainParams.
  // When morph is off they reflect the preset/GUI state; when morph is on
  // they've been overwritten by the morph — but we want the *base* value.
  // Since these get written every morph frame, we stash the base values
  // at morph-on time (see _morphBaseSearchRadius / _morphBaseProbability).
  snap.searchRadiusDeg   = _morphBaseSearchRadius    ?? S.searchRadiusDeg;
  snap.probability       = _morphBaseProbability     ?? S.grainProbability;
  snap.recencyN          = _morphBaseRecencyN        ?? S.recencyN;
  snap.radiusFadeCurve   = _morphBaseRadiusFadeCurve ?? S.radiusFadeCurve;
  snap.nearestMode       = _morphBaseNearestMode     ?? S.nearestMode;
  snap.grainKAllMode     = _morphBaseKAllMode        ?? S.grainKAllMode;
  snap.grainKSeqMode     = _morphBaseKSeqMode        ?? S.grainKSeqMode;
  snap.radiusFadeEnabled = _morphBaseRadiusFadeOn    ?? S.radiusFadeEnabled;
  return snap;
}

// Get the full grain param object for a preset index.
function presetParams(idx) {
  if (idx < 0 || idx >= PRESETS.length) return null;
  return PRESETS[idx];
}

// Build a list of available presets for pin assignment dropdowns.
// Returns [{ idx, name }] for all user + factory presets that have a name.
export function getPresetList() {
  const list = [];
  for (let i = 0; i < PRESETS.length; i++) {
    const p = PRESETS[i];
    if (p && p.name) list.push({ idx: i, name: p.name });
  }
  return list;
}

// Add a pin at the current joystick position.
export function addRadialPin(presetIdx) {
  if (!S.radialPins) S.radialPins = [];
  const joy = S.gestureJoy;
  S.radialPins.push({
    x: joy.x,
    y: joy.y,
    presetIdx: presetIdx ?? 0,
  });
  saveRadialPins();
}

// Add a pin at a specific position (for UI placement).
export function addRadialPinAt(x, y, presetIdx) {
  if (!S.radialPins) S.radialPins = [];
  S.radialPins.push({ x, y, presetIdx: presetIdx ?? 0 });
  saveRadialPins();
}

// Remove a pin by index.
export function removeRadialPin(idx) {
  if (!S.radialPins) return;
  S.radialPins.splice(idx, 1);
  saveRadialPins();
}

// Update pin's assigned preset.
export function setRadialPinPreset(pinIdx, presetIdx) {
  if (!S.radialPins || !S.radialPins[pinIdx]) return;
  S.radialPins[pinIdx].presetIdx = presetIdx;
  saveRadialPins();
}

// Persistence
function saveRadialPins() {
  try {
    localStorage.setItem('mubone_radial_pins', JSON.stringify(S.radialPins));
  } catch (_) {}
}

function loadRadialPins() {
  try {
    const raw = localStorage.getItem('mubone_radial_pins');
    if (raw) S.radialPins = JSON.parse(raw);
  } catch (_) {}
}

// ── Radial morph apply — call every frame ───────────────────────────────────
// Reads S.gestureJoy, computes inverse-distance weights to each pin,
// blends pin presets with current GUI params, writes to S.grainOverrides.

// Reusable output object to avoid allocations
const _morphResult = {};

// Throttle UI sync to ~15fps — don't overwhelm the DOM
let _lastUISyncMs = 0;
const UI_SYNC_INTERVAL = 66;

// Base values for params that live outside grainOverrides.
// Stashed when morph first engages so the center doesn't drift.
let _morphBaseSearchRadius    = null;
let _morphBaseProbability     = null;
let _morphBaseRecencyN        = null;
let _morphBaseRadiusFadeCurve = null;
let _morphBaseNearestMode     = null;
let _morphBaseKAllMode        = null;
let _morphBaseKSeqMode        = null;
let _morphBaseRadiusFadeOn    = null;
let _morphWasOn = false;

export function applyRadialMorph() {
  if (!S.radialMorphOn) {
    // Restore base values when morph turns off
    if (_morphWasOn) {
      if (_morphBaseSearchRadius    !== null) S.searchRadiusDeg   = _morphBaseSearchRadius;
      if (_morphBaseProbability     !== null) S.grainProbability  = _morphBaseProbability;
      if (_morphBaseRecencyN        !== null) S.recencyN          = _morphBaseRecencyN;
      if (_morphBaseRadiusFadeCurve !== null) S.radiusFadeCurve   = _morphBaseRadiusFadeCurve;
      if (_morphBaseNearestMode     !== null) S.nearestMode       = _morphBaseNearestMode;
      if (_morphBaseKAllMode        !== null) S.grainKAllMode     = _morphBaseKAllMode;
      if (_morphBaseKSeqMode        !== null) S.grainKSeqMode     = _morphBaseKSeqMode;
      if (_morphBaseRadiusFadeOn    !== null) S.radiusFadeEnabled = _morphBaseRadiusFadeOn;
      _morphBaseSearchRadius    = null;
      _morphBaseProbability     = null;
      _morphBaseRecencyN        = null;
      _morphBaseRadiusFadeCurve = null;
      _morphBaseNearestMode     = null;
      _morphBaseKAllMode        = null;
      _morphBaseKSeqMode        = null;
      _morphBaseRadiusFadeOn    = null;
      _morphWasOn = false;
    }
    // Clear morph indicators when off
    if (S.radialMorphActiveParams && S.radialMorphActiveParams.size > 0) {
      S.radialMorphActiveParams.clear();
      S._syncRadialMorphUI?.();
    }
    return;
  }
  const pins = S.radialPins;
  if (!pins || pins.length === 0) return;

  // Stash base values on first active frame so center doesn't drift
  if (!_morphWasOn) {
    _morphBaseSearchRadius    = S.searchRadiusDeg;
    _morphBaseProbability     = S.grainProbability;
    _morphBaseRecencyN        = S.recencyN;
    _morphBaseRadiusFadeCurve = S.radiusFadeCurve;
    _morphBaseNearestMode     = S.nearestMode;
    _morphBaseKAllMode        = S.grainKAllMode;
    _morphBaseKSeqMode        = S.grainKSeqMode;
    _morphBaseRadiusFadeOn    = S.radiusFadeEnabled;
    _morphWasOn = true;
  }

  const joy = S.gestureJoy;
  const dist = joy.dist;   // 0–1, gated — 0 when in dead zone

  // At center (dist=0), no morph — current GUI params are the sound.
  if (dist < 0.001) {
    if (S.radialMorphActiveParams && S.radialMorphActiveParams.size > 0) {
      S.radialMorphActiveParams.clear();
      S._syncRadialMorphUI?.();
    }
    return;
  }

  const falloff = S.radialMorphFalloff ?? RADIAL_MORPH_FALLOFF_DEFAULT;
  const jx = joy.x;
  const jy = joy.y;

  // Compute inverse-distance weight for each pin
  const EPSILON = 0.01;
  let sumW = 0;
  const weights = [];
  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i];
    const dx = jx - pin.x;
    const dy = jy - pin.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const w = Math.pow(1 / (d + EPSILON), falloff);
    weights.push(w);
    sumW += w;
  }

  // Normalize pin weights, then scale by joystick distance from center.
  // dist=0 → 100% current params.  dist=1 → full pin influence.
  const centerWeight = 1 - dist;
  const pinScale = 1 - centerWeight;  // = dist

  // Get current GUI state as the "center" preset
  const center = currentGrainSnapshot();

  // Blend: accumulate weighted sum of pin presets
  // Start from center * centerWeight, add each pin's contribution
  // All numeric params that can be morphed between presets.
  // Some live in grainOverrides, some in special S.* locations.
  const NUMERIC_KEYS = [
    'duration', 'period', 'searchRadiusDeg', 'pitchJitter', 'panSpread',
    'volume', 'fadeRatio', 'k', 'probability', 'durJitter', 'durVar',
    'periodVar', 'retriggerMs', 'pitchShift', 'recencyN', 'radiusFadeCurve',
  ];

  // Params that must remain integers after blending
  const INTEGER_KEYS = new Set(['k', 'retriggerMs', 'pitchShift', 'searchRadiusDeg', 'recencyN']);

  for (const key of NUMERIC_KEYS) {
    // Locked params are untouchable — morph skips them entirely
    if (isLocked(key)) continue;

    const centerVal = center[key];
    if (centerVal === undefined) continue;

    let blended = centerVal * centerWeight;
    for (let i = 0; i < pins.length; i++) {
      const pinPreset = presetParams(pins[i].presetIdx);
      if (!pinPreset) continue;
      const pinVal = pinPreset[key];
      if (typeof pinVal !== 'number') continue;
      const normalizedW = sumW > 0 ? weights[i] / sumW : 0;
      blended += pinVal * normalizedW * pinScale;
    }

    // Round integer params after blending
    if (INTEGER_KEYS.has(key)) blended = Math.round(blended);

    // Route to correct location — most go to grainOverrides,
    // but some params live elsewhere on S
    if (key === 'searchRadiusDeg') {
      S.searchRadiusDeg = blended;
    } else if (key === 'recencyN') {
      S.recencyN = blended;
    } else if (key === 'probability') {
      S.grainProbability = blended;
    } else if (key === 'radiusFadeCurve') {
      S.radiusFadeCurve = blended;
    } else {
      S.grainOverrides[key] = blended;
    }
  }

  // Handle non-numeric params — pick from dominant pin (nearest to joystick).
  // Booleans and enums can't be interpolated, so they switch at >50% pin influence.
  if (pinScale > 0.5) {
    let maxW = 0, maxIdx = 0;
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] > maxW) { maxW = weights[i]; maxIdx = i; }
    }
    const dominant = presetParams(pins[maxIdx].presetIdx);
    if (dominant) {
      // Enums
      if (!isLocked('curveType') && dominant.curveType)  S.grainCurveType = dominant.curveType;
      if (!isLocked('direction') && dominant.direction)  S.grainDirection = dominant.direction;
      // Booleans — check both key variants (factory vs user preset naming)
      if (!isLocked('nearestMode') && typeof dominant.nearestMode === 'boolean')
        S.nearestMode = dominant.nearestMode;
      const kAll = dominant.grainKAllMode ?? dominant.kAllMode;
      if (!isLocked('grainKAllMode') && typeof kAll === 'boolean')
        S.grainKAllMode = kAll;
      // Enforce constraint: k-all not valid with nearest
      if (S.nearestMode && S.grainKAllMode) S.grainKAllMode = false;
      const kSeq = dominant.grainKSeqMode ?? dominant.kSeqMode;
      if (!isLocked('grainKSeqMode') && typeof kSeq === 'boolean')
        S.grainKSeqMode = kSeq;
      if (!isLocked('radiusFadeEnabled') && typeof dominant.radiusFadeEnabled === 'boolean')
        S.radiusFadeEnabled = dominant.radiusFadeEnabled;
    }
  }

  // All params touched by morph (for orange indicators)
  const BOOLEAN_KEYS = [
    'nearestMode', 'grainKAllMode', 'grainKSeqMode', 'radiusFadeEnabled',
    'curveType', 'direction',
  ];

  // Track which params are morphed (excluding locked ones) and sync main UI
  if (!S.radialMorphActiveParams) S.radialMorphActiveParams = new Set();
  S.radialMorphActiveParams.clear();
  for (const key of NUMERIC_KEYS) {
    if (!isLocked(key)) S.radialMorphActiveParams.add(key);
  }
  for (const key of BOOLEAN_KEYS) {
    if (!isLocked(key)) S.radialMorphActiveParams.add(key);
  }

  const now = performance.now();
  if (now - _lastUISyncMs > UI_SYNC_INTERVAL) {
    _lastUISyncMs = now;
    S.syncGrainControlsUI?.();
    S._syncRadialMorphUI?.();
  }
}

// ── Init ────────────────────────────────────────────────────────────────────

let _rafId = null;

function rafPoll() {
  const slot = getByRole('gesture');
  if (slot?.inertial) updateGesture(slot);

  // Apply radial morph every frame (lightweight when off or no pins)
  applyRadialMorph();

  // Apply energy map every frame (lightweight when off)
  applyEnergyMap();

  _rafId = requestAnimationFrame(rafPoll);
}

export function initGesture() {
  S.gesture = descriptor;

  // Per-feature signal conditioning
  S.gestureCondition = {
    intensity:        { smooth: 0.2,  deadZone: 0.05, curve: 1.0, inMin: 0, inMax: 1, outMin: 0, outMax: 1 },
    smoothness:       { smooth: 0.15, deadZone: 0.0,  curve: 1.0, inMin: 0, inMax: 1, outMin: 0, outMax: 1 },
    periodicity:      { smooth: 0.1,  deadZone: 0.10, curve: 1.0, inMin: 0, inMax: 1, outMin: 0, outMax: 1 },
    accumulatedEnergy:{ smooth: 0.0,  deadZone: 0.0,  curve: 1.0, inMin: 0, inMax: 1, outMin: 0, outMax: 1 },
  };

  // Joystick state — written by gesture-panel, readable by any module.
  S.gestureJoy = { x: 0, y: 0, dist: 0, angle: 0 };

  // Energy map — modulate cursor grains from accumulated energy
  S.energyMapOn = false;
  S.energyGain  = 1.0;    // gain applied to conditioned energy before mapping

  // Radial morph pin system
  S.radialPins = [];
  S.radialMorphOn = false;
  S.radialMorphFalloff = RADIAL_MORPH_FALLOFF_DEFAULT;
  S.radialMorphActiveParams = new Set();
  loadRadialPins();

  S._onGestureUpdate = () => updateGesture(getByRole('gesture'));

  _rafId = requestAnimationFrame(rafPoll);

  DEBUG && console.log('[gesture] initialized — reading from gesture role slot');
}

export function destroyGesture() {
  if (_rafId) cancelAnimationFrame(_rafId);
  S._onGestureUpdate = null;
  S.gesture = null;
}
