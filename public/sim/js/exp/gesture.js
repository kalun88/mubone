// ============================================================================
// gesture.js — Gesture feature extraction from IMU data
//
// Derives high-level movement qualities from raw quaternion + gyro + accel
// streams.  Source-agnostic: reads from whatever IMU object is passed in
// (defaults to wand from sensor.js).
//
// Runs every frame (~60hz from rAF or every inertial OSC tick at ~100hz).
// Outputs a gesture descriptor on S.gesture that other modules can read.
//
// Features:
//   smoothness      (0–1)  jerk-based — 0 = jerky, 1 = smooth arc
//   effort          (0–1)  velocity + acceleration magnitude
//   directness      (0–1)  net displacement / total path length
//   periodicity     (0–1)  autocorrelation strength of angular velocity
//   periodicityHz   (Hz)   detected period frequency (0 if no pattern)
//   accumulatedEnergy (0–∞) leaky integrator of effort over time
//
// Only loaded when ?exp is in the URL.
// ============================================================================

import { S, DEBUG } from '../state.js';
import { wand } from '../sensor.js';

// ── Configuration ───────────────────────────────────────────────────────────

const SMOOTH_WINDOW     = 8;      // frames for jerk moving average
const DIRECT_WINDOW     = 60;     // frames (~0.6s at 100hz) for directness
const AUTOCORR_WINDOW   = 150;    // frames (~1.5s at 100hz) for periodicity
const AUTOCORR_MIN_LAG  = 10;     // min lag to search (skip DC / very short)
const AUTOCORR_MAX_LAG  = 120;    // max lag (~1.2s period at 100hz)
const ENERGY_DECAY      = 0.993;  // per-frame decay (~1s half-life at 100hz)
const EFFORT_GYRO_SCALE = 1/400;  // normalize gyro mag (deg/s) → [0,1]ish
const EFFORT_ACCEL_SCALE = 1/3;   // normalize dynamic accel (g) → [0,1]ish
const JERK_SCALE        = 1/8000; // normalize angular jerk → [0,1]ish

// ── State ───────────────────────────────────────────────────────────────────

let _prevGyro      = null;   // previous [gx, gy, gz]
let _prevTs        = 0;      // previous timestamp (seconds)

// Ring buffers
const _jerkHistory   = new Float32Array(SMOOTH_WINDOW);
let   _jerkIdx       = 0;

// Directness: store unit-quaternion displacements
const _quatHistory   = [];   // ring buffer of [x,y,z,w] quaternions
let   _quatIdx       = 0;
const _pathLengths   = new Float32Array(DIRECT_WINDOW); // angular step per frame
let   _pathIdx       = 0;

// Periodicity: gyro magnitude history for autocorrelation
const _gyroMagHistory = new Float32Array(AUTOCORR_WINDOW);
let   _gyroMagIdx     = 0;
let   _gyroMagCount   = 0;  // frames received (caps at AUTOCORR_WINDOW)

// Accumulated energy
let _accumulatedEnergy = 0;

// ── Public descriptor (written to S.gesture each frame) ─────────────────────

const descriptor = {
  smoothness:       1,
  effort:           0,
  directness:       1,
  periodicity:      0,
  periodicityHz:    0,
  accumulatedEnergy: 0,
  // Raw intermediates (useful for viz)
  jerk:             0,    // raw angular jerk magnitude (deg/s²)
  gyroMag:          0,    // raw gyro magnitude (deg/s)
  accelDynMag:      0,    // raw dynamic accel magnitude (g)
};

// ── Core update — call this every inertial tick ─────────────────────────────

export function updateGesture(source) {
  const src = source || wand;
  const inertial = src.inertial;
  const quat     = src.quat;
  if (!inertial) return;

  const nowS = performance.now() * 0.001;
  const dt   = Math.min(nowS - _prevTs, 0.1);  // cap after tab-hide
  _prevTs    = nowS;
  if (dt <= 0) return;

  const { gx, gy, gz, gyroMag, accelDynMag } = inertial;
  const gyro = [gx, gy, gz];

  descriptor.gyroMag     = gyroMag;
  descriptor.accelDynMag = accelDynMag;

  // ── Smoothness (jerk-based) ─────────────────────────────────────────────
  if (_prevGyro) {
    const jx = (gyro[0] - _prevGyro[0]) / dt;
    const jy = (gyro[1] - _prevGyro[1]) / dt;
    const jz = (gyro[2] - _prevGyro[2]) / dt;
    const jerkMag = Math.sqrt(jx*jx + jy*jy + jz*jz);

    _jerkHistory[_jerkIdx % SMOOTH_WINDOW] = jerkMag;
    _jerkIdx++;

    // Moving average of jerk
    let sum = 0;
    const n = Math.min(_jerkIdx, SMOOTH_WINDOW);
    for (let i = 0; i < n; i++) sum += _jerkHistory[i];
    const avgJerk = sum / n;

    descriptor.jerk = avgJerk;
    // Map to 0–1 with soft saturation (sigmoid-like)
    const normalizedJerk = avgJerk * JERK_SCALE;
    descriptor.smoothness = 1 - Math.min(1, normalizedJerk);
  }
  _prevGyro = gyro;

  // ── Effort / weight ─────────────────────────────────────────────────────
  const gyroNorm  = Math.min(1, gyroMag * EFFORT_GYRO_SCALE);
  const accelNorm = Math.min(1, accelDynMag * EFFORT_ACCEL_SCALE);
  descriptor.effort = Math.min(1, gyroNorm * 0.7 + accelNorm * 0.3);

  // ── Accumulated energy ──────────────────────────────────────────────────
  _accumulatedEnergy = _accumulatedEnergy * ENERGY_DECAY + descriptor.effort * dt;
  // Normalize: at constant max effort, steady state ≈ effort*dt / (1-decay)
  // At 100hz, dt≈0.01, decay=0.993 → steady ≈ 0.01/0.007 ≈ 1.4
  descriptor.accumulatedEnergy = Math.min(2, _accumulatedEnergy);

  // ── Directness ──────────────────────────────────────────────────────────
  if (quat) {
    // Store quaternion in ring buffer
    const idx = _quatIdx % DIRECT_WINDOW;
    if (!_quatHistory[idx]) _quatHistory[idx] = [0, 0, 0, 1];
    _quatHistory[idx][0] = quat[0];
    _quatHistory[idx][1] = quat[1];
    _quatHistory[idx][2] = quat[2];
    _quatHistory[idx][3] = quat[3];

    // Angular step from previous frame
    const prevIdx = (_quatIdx - 1 + DIRECT_WINDOW) % DIRECT_WINDOW;
    if (_quatHistory[prevIdx] && _quatIdx > 0) {
      const step = quatAngleBetween(_quatHistory[prevIdx], quat);
      _pathLengths[_pathIdx % DIRECT_WINDOW] = step;
      _pathIdx++;
    }

    // Net angular displacement (oldest to newest in buffer)
    const filled = Math.min(_quatIdx + 1, DIRECT_WINDOW);
    if (filled >= 2) {
      const oldestIdx = (_quatIdx - filled + 1 + DIRECT_WINDOW) % DIRECT_WINDOW;
      const netAngle = quatAngleBetween(_quatHistory[oldestIdx], quat);

      // Total path length (sum of all steps in window)
      let totalPath = 0;
      const stepCount = Math.min(_pathIdx, DIRECT_WINDOW);
      for (let i = 0; i < stepCount; i++) totalPath += _pathLengths[i];

      descriptor.directness = totalPath > 0.001
        ? Math.min(1, netAngle / totalPath)
        : 1;  // no motion = "direct" by default
    }

    _quatIdx++;
  }

  // ── Periodicity (autocorrelation of gyro magnitude) ─────────────────────
  _gyroMagHistory[_gyroMagIdx % AUTOCORR_WINDOW] = gyroMag;
  _gyroMagIdx++;
  _gyroMagCount = Math.min(_gyroMagCount + 1, AUTOCORR_WINDOW);

  if (_gyroMagCount >= AUTOCORR_MIN_LAG * 2) {
    const n = _gyroMagCount;

    // Compute mean
    let mean = 0;
    for (let i = 0; i < n; i++) mean += _gyroMagHistory[i];
    mean /= n;

    // Compute variance (for normalization)
    let variance = 0;
    for (let i = 0; i < n; i++) {
      const d = _gyroMagHistory[i] - mean;
      variance += d * d;
    }

    if (variance > 0.01) {  // skip if signal is near-constant
      // Find best autocorrelation peak
      let bestCorr = 0;
      let bestLag  = 0;
      const maxLag = Math.min(AUTOCORR_MAX_LAG, Math.floor(n / 2));

      for (let lag = AUTOCORR_MIN_LAG; lag <= maxLag; lag++) {
        let sum = 0;
        const pairs = n - lag;
        for (let i = 0; i < pairs; i++) {
          const a = _gyroMagHistory[i] - mean;
          const b = _gyroMagHistory[(i + lag) % AUTOCORR_WINDOW] - mean;
          sum += a * b;
        }
        const corr = sum / variance;  // normalized by variance → [-1, 1]

        if (corr > bestCorr) {
          bestCorr = corr;
          bestLag  = lag;
        }
      }

      descriptor.periodicity   = Math.max(0, Math.min(1, bestCorr));
      descriptor.periodicityHz = bestLag > 0 ? (1 / (bestLag * dt)) : 0;
    } else {
      descriptor.periodicity   = 0;
      descriptor.periodicityHz = 0;
    }
  }

  // ── Write to shared state ───────────────────────────────────────────────
  S.gesture = descriptor;
}

// ── Quaternion angle between two unit quaternions (radians) ────────────────
function quatAngleBetween(a, b) {
  // dot product of unit quaternions
  let dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
  dot = Math.min(1, Math.max(-1, Math.abs(dot)));  // abs handles double-cover
  return 2 * Math.acos(dot);  // angle in radians
}

// ── Init ────────────────────────────────────────────────────────────────────
// Hook: osc.js calls handleWandInertialOSC → updateWand → updateGestureMorph
// on every /space/wand/inertial tick.  We can't modify osc.js from exp, so
// we register a post-tick callback on S that osc.js can call if it exists.
// We also set up a fallback rAF loop that polls wand.inertial in case the
// callback isn't wired (e.g. no Max connected — testing with recorded data).

let _rafId = null;

function rafPoll() {
  if (wand.inertial) updateGesture(wand);
  _rafId = requestAnimationFrame(rafPoll);
}

export function initGesture() {
  S.gesture = descriptor;

  // Primary path: called from osc.js after every inertial message
  S._onGestureUpdate = () => updateGesture(wand);

  // Fallback: rAF poll for when no OSC is connected (dev/testing)
  _rafId = requestAnimationFrame(rafPoll);

  DEBUG && console.log('[exp/gesture] initialized — reading from wand inertial');
}

export function destroyGesture() {
  if (_rafId) cancelAnimationFrame(_rafId);
  S._onGestureUpdate = null;
  S.gesture = null;
}
