// ============================================================================
// SENSOR — WebSocket client for mubone BNO085 bridge
// Ported from standalone sensor.js to ES module, using S from state.js
// ============================================================================

import { S } from './state.js';

// ── Raw sensor state ─────────────────────────────────────────────────────────
export const sensor = {
  quat:  null,   // [x, y, z, w] raw from BNO085
  euler: null,   // { x, y, z } in degrees — physical board axes
};

// ── Transport: Electron IPC (direct UDP from Max) or silent no-op in browser ──
//
// In Electron, Max sends OSC UDP to 127.0.0.1:7500. The main process receives
// it with dgram, parses it, and pushes it here via electronBridge.onSensorData.
// No WebSocket, no server script needed.
//
// In the browser version the sensor is simply unavailable — sensor.quat stays
// null and getSensorCamQ() returns null, so the renderer falls back to mouse.

export function initSensor() {
  if (!window.electronBridge?.onSensorData) {
    console.log('[sensor] not in Electron — sensor disabled');
    return;
  }

  window.electronBridge.onSensorData((address, values) => {
    // Max sends quaternion as OSC address "list" with 4 floats [qx, qy, qz, qw]
    // (matching the old server.js text format: "list qx qy qz qw")
    if (address === 'list' && values.length === 4) {
      const [qx, qy, qz, qw] = values;
      sensor.quat  = [qx, qy, qz, qw];
      sensor.euler = quatToEulerDeg(qx, qy, qz, qw);
    }
  });

  console.log('[sensor] IPC bridge active — waiting for OSC from Max');
}

// ── Quaternion → physical board angles in degrees ────────────────────────────
// Observed hardware mapping:
//   raw quat X → physical board-Y rotation (correct sign)
//   raw quat Y → physical board-X rotation (inverted)
//   raw quat Z → physical board-Z rotation (inverted)
function quatToEulerDeg(x, y, z, w) {
  const sinr = 2 * (w * x + y * z);
  const cosr = 1 - 2 * (x * x + y * y);
  const rawX = Math.atan2(sinr, cosr) * (180 / Math.PI);

  const sinp = 2 * (w * y - z * x);
  const rawY = (Math.abs(sinp) >= 1
    ? Math.sign(sinp) * 90
    : Math.asin(sinp) * (180 / Math.PI));

  const siny = 2 * (w * z + x * y);
  const cosy = 1 - 2 * (y * y + z * z);
  const rawZ = Math.atan2(siny, cosy) * (180 / Math.PI);

  return {
    x:  rawY * -1,   // physical X = raw Y, inverted
    y:  rawX,        // physical Y = raw X, correct
    z:  rawZ * -1,   // physical Z = raw Z, inverted
  };
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

// ── Quaternion multiply [x,y,z,w] ─────────────────────────────────────────────
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

// ── Which raw quat component (and sign) carries each physical board axis ──────
const PHYS_TO_QUAT = {
  x: { idx: 1, factor: -1 },  // board-X rotation → -qy
  y: { idx: 0, factor:  1 },  // board-Y rotation → +qx
  z: { idx: 2, factor: -1 },  // board-Z rotation → -qz
};

// ── getSensorCamQ — called from renderer.js animate() loop ───────────────────
// Returns [w, vx, vy, vz] for camQ, or null if no data.
// Uses S.sensorCal.axisMap to route physical axes to viewer axes.
export function getSensorCamQ() {
  if (!sensor.quat) return null;

  const cal = S.sensorCal || {
    axisMap: {
      x: { viz: 'x', sign: 1, mute: false },
      y: { viz: 'y', sign: 1, mute: false },
      z: { viz: 'z', sign: 1, mute: false },
    }
  };

  const q = applyTare(sensor.quat);  // [qx, qy, qz, qw]
  const v = { x: 0, y: 0, z: 0 };

  for (const phys of ['x', 'y', 'z']) {
    const { idx, factor } = PHYS_TO_QUAT[phys];
    const { viz, sign, mute } = cal.axisMap[phys];
    if (mute) continue;
    v[viz] += factor * sign * q[idx];
  }

  return [q[3], v.x, v.y, v.z];  // [w, vx, vy, vz]
}
