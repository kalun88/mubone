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

import { S, DEBUG } from '../state.js';
import { getByRole } from '../sensor-registry.js';

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

// ── Init ────────────────────────────────────────────────────────────────────

let _rafId = null;

function rafPoll() {
  const slot = getByRole('gesture');
  if (slot?.inertial) updateGesture(slot);
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

  S._onGestureUpdate = () => updateGesture(getByRole('gesture'));

  _rafId = requestAnimationFrame(rafPoll);

  DEBUG && console.log('[gesture] initialized — reading from gesture role slot');
}

export function destroyGesture() {
  if (_rafId) cancelAnimationFrame(_rafId);
  S._onGestureUpdate = null;
  S.gesture = null;
}
