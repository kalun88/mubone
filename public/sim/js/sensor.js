// ============================================================================
// SENSOR — WebSocket client for mubone BNO085 bridge
// Ported from standalone sensor.js to ES module, using S from state.js
// ============================================================================

import { S } from './state.js';

// ── Raw sensor state ─────────────────────────────────────────────────────────
export const sensor = {
  quat:      null,   // [x, y, z, w] raw from BNO085 — sensor 1 (instrument / cursor)
  euler:     null,   // { x, y, z } in degrees — physical board axes (raw, no tare)
  zeroEuler: null,   // { x, y, z } in degrees — tare-relative (zeroed)
};

// Sensor 2 — world reference (body frame, floor lock, etc.)
export const sensor2 = {
  quat:  null,   // [x, y, z, w] raw from BNO085 — sensor 2
  euler: null,   // { x, y, z } in degrees
};

// Wand — gesture controller (/space/wand)
// Invisible to the viz/audio world — tare-relative euler forwarded to Max,
// inertial data (gyro + accel) used for browser-side wand control.
export const wand = {
  quat:      null,   // [x, y, z, w] raw from BNO085
  euler:     null,   // { x, y, z } in degrees — raw
  zeroEuler: null,   // { x, y, z } in degrees — tare-relative
  inertial:  null,   // { gx, gy, gz, ax, ay, az, gyroMag, accelDynMag } — from x-IMU
};

// ── Transport ─────────────────────────────────────────────────────────────────
//
// Sensor data arrives via osc.js which handles both transports:
//   Electron — IPC from main process (UDP 7500 → electron-main.js → renderer)
//   Browser  — WebSocket from bridge.js running inside the Max patch
//
// osc.js calls handleSensorOSC(values) when it receives address "list".
// In browser mode with no Max bridge, sensor.quat stays null and
// getSensorCamQ() returns null, so the renderer falls back to mouse.

export function initSensor() {
  // Transport registration moved to osc.js — nothing to set up here.
  console.log('[sensor] ready — waiting for OSC via osc.js');
}

// Called by osc.js for /space/cursor (sensor 1 — instrument / cursor)
export function handleSensorOSC(values) {
  const [qx, qy, qz, qw] = values;
  sensor.quat  = [qx, qy, qz, qw];
  sensor.euler = quatToEulerDeg(qx, qy, qz, qw);
  const t = applyTare(sensor.quat);
  sensor.zeroEuler = quatToEulerDeg(t[0], t[1], t[2], t[3]);
}

// Called by osc.js for /space/wand (quaternion stream)
export function handleWandOSC(values) {
  const [qx, qy, qz, qw] = values;
  wand.quat  = [qx, qy, qz, qw];
  wand.euler = quatToEulerDeg(qx, qy, qz, qw);
  // Apply tare then axis remap so zeroEuler is in semantic roll/pitch/yaw space.
  // This is what the plotter, euler readout, and updateWand() all read from.
  const t = applyTareWand(wand.quat);
  const rawEuler = quatToEulerDeg(t[0], t[1], t[2], t[3]);
  wand.zeroEuler = applyAxisMapToEuler(rawEuler, S.wandCal);
}

// Called by osc.js for /space/wand/inertial
// Values: [gx, gy, gz, ax, ay, az]  (gyro deg/s, accel g)
export function handleWandInertialOSC(values) {
  const [gx, gy, gz, ax, ay, az] = values;
  const gyroMag = Math.sqrt(gx*gx + gy*gy + gz*gz);
  // Dynamic accel = remove gravity (approx 1g on Z when flat; magnitude sans 1g)
  const accelDynMag = Math.max(0, Math.sqrt(ax*ax + ay*ay + az*az) - 1);
  wand.inertial = { gx, gy, gz, ax, ay, az, gyroMag, accelDynMag };
}

// Called by osc.js for /space/frame (sensor 2 — world reference)
// Expected OSC format: /space/frame  qx  qy  qz  qw   (scalar W last, x y z w)
// Both sensors must arrive in the same [x, y, z, w] convention.
// Any sensor-specific axis remapping (e.g. x-IMU physical x↔y swap) must be
// resolved in the Max patch before sending — do not patch it here.
export function handleSensor2OSC(values) {
  const [qx, qy, qz, qw] = values;
  sensor2.quat  = [qx, qy, qz, qw];
  sensor2.euler = quatToEulerDeg(qx, qy, qz, qw);
}

// ── Quaternion [x, y, z, w] → Euler angles in degrees (ZYX / roll-pitch-yaw) ──
// Standard decomposition — no sensor-specific corrections.
// Both sensors must send normalised [x, y, z, w]; any board-level axis
// remapping is the sender's responsibility (Max patch).
function quatToEulerDeg(x, y, z, w) {
  // roll  — rotation around X axis
  const roll  = Math.atan2(2*(w*x + y*z), 1 - 2*(x*x + y*y)) * (180 / Math.PI);
  // pitch — rotation around Y axis  (clamped to avoid asin domain errors)
  const sinp  = 2*(w*y - z*x);
  const pitch = (Math.abs(sinp) >= 1
    ? Math.sign(sinp) * 90
    : Math.asin(sinp) * (180 / Math.PI));
  // yaw   — rotation around Z axis
  const yaw   = Math.atan2(2*(w*z + x*y), 1 - 2*(y*y + z*z)) * (180 / Math.PI);

  return { x: roll, y: pitch, z: yaw };
}

// ── Sensor 2 tare ─────────────────────────────────────────────────────────────
let _sensor2TareQuat = null;

export function sensor2Tare() {
  if (sensor2.quat) _sensor2TareQuat = [...sensor2.quat];
}

export function sensor2ClearTare() {
  _sensor2TareQuat = null;
}

function applyTare2(quat) {
  if (!_sensor2TareQuat) return quat;
  const [tx, ty, tz, tw] = _sensor2TareQuat;
  return qMulQ([-tx, -ty, -tz, tw], quat);
}

// ── Wand tare ─────────────────────────────────────────────────────────────────
let _wandTareQuat = null;

export function wandTare() {
  if (wand.quat) _wandTareQuat = [...wand.quat];
}

export function wandClearTare() {
  _wandTareQuat = null;
}

function applyTareWand(quat) {
  if (!_wandTareQuat) return quat;
  const [tx, ty, tz, tw] = _wandTareQuat;
  return qMulQ([-tx, -ty, -tz, tw], quat);
}

// ── World frame — sensor 2 as reference ───────────────────────────────────────
// When enabled, sensor 1 (cursor) is expressed relative to sensor 2 (frame).
// Both sensors go through their own tare + axis mapping before the comparison.
let _worldFrameEnabled = false;

export function isWorldFrameEnabled() { return _worldFrameEnabled; }

export function setWorldFrameEnabled(enabled) {
  _worldFrameEnabled = enabled;
  console.log(`[sensor] world frame ${enabled ? 'enabled' : 'disabled'}`);
}

// ── Semantic axis remap for euler angles ─────────────────────────────────────
// Converts physical-board euler { x, y, z } into semantic { x:roll, y:pitch, z:yaw }
// by routing each board axis through cal.axisMap (viz + sign + mute).
// Used by handleWandOSC so wand.zeroEuler reflects the current remap buttons.
function applyAxisMapToEuler(euler, cal) {
  if (!cal?.axisMap) return euler;
  const result = { x: 0, y: 0, z: 0 };
  for (const phys of ['x', 'y', 'z']) {
    const { viz, sign, mute } = cal.axisMap[phys];
    if (mute) continue;
    if (viz === 'roll')  result.x += sign * euler[phys];
    if (viz === 'pitch') result.y += sign * euler[phys];
    if (viz === 'yaw')   result.z += sign * euler[phys];
  }
  return result;
}

// ── Shared axis mapping ───────────────────────────────────────────────────────
// Takes a tared [x, y, z, w] quaternion and a cal object, returns a
// [x, y, z, w] camera-space quaternion.
// Used identically for both sensors so the semantics are the same.
function applyAxisMap(q, cal) {
  const v = { roll: 0, pitch: 0, yaw: 0 };
  for (const phys of ['x', 'y', 'z']) {
    const { idx, factor } = PHYS_TO_QUAT[phys];
    const { viz, sign, mute } = cal.axisMap[phys];
    if (mute) continue;
    v[viz] += factor * sign * q[idx];
  }
  return [v.pitch, v.yaw, v.roll, q[3]];  // [x, y, z, w]
}

// ── Tare — captures current orientation as reference zero ─────────────────────
let _tareQuat = null;

export function sensorTare() {
  if (sensor.quat) _tareQuat = [...sensor.quat];
}

export function sensorClearTare() {
  _tareQuat = null;
}

function applyTare(quat) {
  if (!_tareQuat) return quat;
  const [tx, ty, tz, tw] = _tareQuat;
  return qMulQ([-tx, -ty, -tz, tw], quat);
}

// ── Quaternion helpers [x,y,z,w] ──────────────────────────────────────────────

// Multiply: result = a * b
function qMulQ(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw*bx + ax*bw + ay*bz - az*by,
    aw*by - ax*bz + ay*bw + az*bx,
    aw*bz + ax*by - ay*bx + az*bw,
    aw*bw - ax*bx - ay*by - az*bz,
  ];
}

// Conjugate (= inverse for unit quaternions): negates the vector part
function qConjugate(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}

// ── Which raw quat component carries each physical board axis ─────────────────
// Standard +X+Y+Z sensor: board axis rotation maps directly to its own
// quaternion component. idx 0=qx, 1=qy, 2=qz.  Signs handled by axisMap.
const PHYS_TO_QUAT = {
  x: { idx: 0, factor: 1 },  // board-X rotation → qx
  y: { idx: 1, factor: 1 },  // board-Y rotation → qy
  z: { idx: 2, factor: 1 },  // board-Z rotation → qz
};

// ── getSensorCamQ — called from renderer.js animate() loop ───────────────────
// Returns [x, y, z, w] camQ, or null if no data.
//
// Both sensors go through the SAME pipeline:
//   tare → applyAxisMap → [pitch, yaw, roll, w] in camera space
//
// World frame is then computed in that shared camera space:
//   camQ = qConjugate(q2_cam) * q1_cam
//
// This means sensor 2's axis mapping has identical semantics to sensor 1's:
// "board X → pitch" means the same thing on both sensors.
export function getSensorCamQ() {
  if (!sensor.quat) return null;

  const cal1 = S.sensorCal || {
    axisMap: {
      x: { viz: 'roll',  sign: -1, mute: false },
      y: { viz: 'pitch', sign:  1, mute: false },
      z: { viz: 'yaw',   sign: -1, mute: false },
    }
  };

  // Sensor 1: tare → axis map → camera-space quaternion [x, y, z, w]
  const q1_cam = applyAxisMap(applyTare(sensor.quat), cal1);

  // World frame: express sensor 1 relative to sensor 2, both in camera space
  if (_worldFrameEnabled && sensor2.quat) {
    const cal2 = S.sensor2Cal || {
      axisMap: {
        x: { viz: 'roll',  sign: -1, mute: false },
        y: { viz: 'pitch', sign:  1, mute: false },
        z: { viz: 'yaw',   sign: -1, mute: false },
      }
    };
    const q2_cam = applyAxisMap(applyTare2(sensor2.quat), cal2);
    return qMulQ(qConjugate(q2_cam), q1_cam);
  }

  return q1_cam;
}

// ── getWandCamQ — same pipeline as sensor 1 but never touches the renderer ────
// Returns [x, y, z, w] in cal-space, or null if no data yet.
export function getWandCamQ() {
  if (!wand.quat) return null;

  const cal = S.wandCal || {
    axisMap: {
      x: { viz: 'roll',  sign: -1, mute: false },
      y: { viz: 'pitch', sign:  1, mute: false },
      z: { viz: 'yaw',   sign: -1, mute: false },
    }
  };

  return applyAxisMap(applyTareWand(wand.quat), cal);
}
