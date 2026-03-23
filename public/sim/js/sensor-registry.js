// ============================================================================
// sensor-registry.js — Generic sensor slot registry
//
// Dynamic registry that auto-discovers sensors from OSC messages.
// New convention: /sensor/{name}/quaternion  (4 floats)
//                 /sensor/{name}/inertial    (6 floats)
//
// Roles are assigned per-stream, not per-slot.  A single sensor that sends
// both quaternion and inertial can have its quat assigned to 'cursor' and
// its inertial assigned to 'gesture' independently.
//
// Quaternion roles: cursor, frame, custom, unmapped
// Inertial roles:   gesture, custom, unmapped
//
// "custom" opens per-signal routing — individual euler axes or inertial
// signals can be sent to arbitrary destinations.
//
// Consumers read from the registry via getByRole('cursor'), etc.
// ============================================================================

import { S, DEBUG } from './state.js';

// ── Roles ────────────────────────────────────────────────────────────────────
export const QUAT_ROLES     = ['cursor', 'frame', 'unmapped'];
export const INERTIAL_ROLES = ['gesture', 'unmapped'];
// Future: add 'custom' to both arrays when custom routing is wired end-to-end.
// Scaffolding exists below (dispatch, routes, destinations) — see docs/ROUTING-DESIGN.md

// ── Destinations ─────────────────────────────────────────────────────────────
// Available routing destinations.  'unmapped' means signal goes nowhere.
// Tier 1: always available (raw calibrated signals can target these)
// Tier 2: computed gesture features — listed separately, available only when
//         at least one inertial stream feeds the gesture chain.

export const QUAT_DESTINATIONS = [
  'unmapped',
  'viz azimuth',       // camera horizontal rotation
  'viz elevation',     // camera vertical rotation
  'viz roll',          // camera roll
  'world reference',   // frame correction quaternion
  'gesture chain',     // feed into gesture computation
  'morph',             // morph parameter (future)
];

export const INERTIAL_DESTINATIONS = [
  'unmapped',
  'gesture chain',     // feeds gesture computation pipeline
  'morph',             // morph parameter (future)
  'viz azimuth',       // direct-to-viz (unusual but possible)
  'viz elevation',
  'viz roll',
];

// Breakout signal keys for each stream type
export const QUAT_SIGNALS     = ['euler pitch', 'euler yaw', 'euler roll'];
export const INERTIAL_SIGNALS = ['gyro x', 'gyro y', 'gyro z', 'accel x', 'accel y', 'accel z'];

// Default routing for each preset role — what signals go where implicitly
export const CURSOR_DEFAULTS = {
  'euler pitch': 'viz elevation',
  'euler yaw':   'viz azimuth',
  'euler roll':  'viz roll',
};
export const FRAME_DEFAULTS = {
  'euler pitch': 'world reference',
  'euler yaw':   'world reference',
  'euler roll':  'world reference',
};
export const GESTURE_DEFAULTS = {
  'gyro x':  'gesture chain',
  'gyro y':  'gesture chain',
  'gyro z':  'gesture chain',
  'accel x': 'gesture chain',
  'accel y': 'gesture chain',
  'accel z': 'gesture chain',
};

// ── Default calibration ─────────────────────────────────────────────────────
function defaultQuatAxisMap() {
  return {
    x: { viz: 'roll',  sign: 1, mute: false },
    y: { viz: 'pitch', sign: 1, mute: false },
    z: { viz: 'yaw',   sign: 1, mute: false },
  };
}

function defaultInertialAxisMap() {
  return {
    x: { viz: 'roll',  sign: 1, mute: false },
    y: { viz: 'pitch', sign: 1, mute: false },
    z: { viz: 'yaw',   sign: 1, mute: false },
  };
}

// ── Default custom routes ───────────────────────────────────────────────────
function defaultQuatRoutes() {
  return {
    'euler pitch': 'unmapped',
    'euler yaw':   'unmapped',
    'euler roll':  'unmapped',
  };
}

function defaultInertialRoutes() {
  return {
    'gyro x':  'unmapped',
    'gyro y':  'unmapped',
    'gyro z':  'unmapped',
    'accel x': 'unmapped',
    'accel y': 'unmapped',
    'accel z': 'unmapped',
  };
}

// ── Slot factory ─────────────────────────────────────────────────────────────
export function makeSensorSlot(name) {
  return {
    name,

    // Per-stream role assignment
    quatRole:     'unmapped',
    inertialRole: 'unmapped',

    // Custom routing — per-signal destination maps (only active when role === 'custom')
    quatRoutes:     defaultQuatRoutes(),
    inertialRoutes: defaultInertialRoutes(),

    // Stream presence — set to true when first data arrives
    hasQuat:     false,
    hasInertial: false,

    // Quaternion data
    quat:      null,   // [x, y, z, w] raw
    euler:     null,   // { x, y, z } degrees — raw (no tare)
    zeroEuler: null,   // { x, y, z } degrees — tare-relative, axis-remapped

    // Inertial data
    inertial:  null,   // { gx, gy, gz, ax, ay, az, gyroMag, accelDynMag }

    // Calibration
    quatCal: {
      axisMap:  defaultQuatAxisMap(),
      tareQuat: null,
    },
    inertialCal: {
      axisMap:    defaultInertialAxisMap(),
      gravityRef: null,   // captured [ax, ay, az] at rest — future use
    },

    // Activity tracking
    lastSeenQuat:     0,   // Date.now() of last quaternion message
    lastSeenInertial: 0,   // Date.now() of last inertial message
  };
}

// ── Registry ─────────────────────────────────────────────────────────────────
// Map<string, SensorSlot>  — keyed by slot name
const _registry = new Map();

export function getRegistry() { return _registry; }

// Find or create a slot by name
export function getOrCreateSlot(name) {
  if (!_registry.has(name)) {
    const slot = makeSensorSlot(name);
    _registry.set(name, slot);       // add to registry FIRST
    applySavedCal(slot);             // then restore calibration + roles (uses assign fns)
    DEBUG && console.log(`[sensor-registry] new slot: "${name}"`);

    // Notify UI
    S._onSensorDiscovered?.(slot);
  }
  return _registry.get(name);
}

// Get the slot whose quaternion or inertial stream has a given role (or null).
// Quaternion roles: 'cursor', 'frame'
// Inertial roles:   'gesture'
export function getByRole(role) {
  for (const slot of _registry.values()) {
    if (slot.quatRole === role)     return slot;
    if (slot.inertialRole === role) return slot;
  }
  return null;
}

// Assign a quaternion role to a slot's quat stream
export function assignQuatRole(slotName, role) {
  if (!QUAT_ROLES.includes(role)) return;

  // Unassign from previous holder (except 'unmapped' and 'custom' — multiple custom allowed)
  if (role !== 'unmapped' && role !== 'custom') {
    for (const slot of _registry.values()) {
      if (slot.quatRole === role) slot.quatRole = 'unmapped';
    }
  }

  const slot = _registry.get(slotName);
  if (slot) {
    slot.quatRole = role;
    DEBUG && console.log(`[sensor-registry] "${slotName}" quat → ${role}`);
    S._onSensorRoleChanged?.(slot);
    saveCalibration();
  }
}

// Assign an inertial role to a slot's inertial stream
export function assignInertialRole(slotName, role) {
  if (!INERTIAL_ROLES.includes(role)) return;

  // Unassign from previous holder (except 'unmapped' and 'custom')
  if (role !== 'unmapped' && role !== 'custom') {
    for (const slot of _registry.values()) {
      if (slot.inertialRole === role) slot.inertialRole = 'unmapped';
    }
  }

  const slot = _registry.get(slotName);
  if (slot) {
    slot.inertialRole = role;
    DEBUG && console.log(`[sensor-registry] "${slotName}" inertial → ${role}`);
    S._onSensorRoleChanged?.(slot);
    saveCalibration();
  }
}

// Convenience: assign role (auto-detects stream type from role name)
export function assignRole(slotName, role) {
  if (QUAT_ROLES.includes(role) && role !== 'unmapped') {
    assignQuatRole(slotName, role);
  } else if (INERTIAL_ROLES.includes(role) && role !== 'unmapped') {
    assignInertialRole(slotName, role);
  }
}

// Set a custom route for a specific signal on a slot
export function setCustomRoute(slotName, signal, destination) {
  const slot = _registry.get(slotName);
  if (!slot) return;
  if (QUAT_SIGNALS.includes(signal) && slot.quatRoutes) {
    slot.quatRoutes[signal] = destination;
  } else if (INERTIAL_SIGNALS.includes(signal) && slot.inertialRoutes) {
    slot.inertialRoutes[signal] = destination;
  }
  saveCalibration();
  DEBUG && console.log(`[sensor-registry] "${slotName}" custom: ${signal} → ${destination}`);
}

// Get the effective route map for a slot+stream — returns the preset defaults
// for preset roles, or the custom map for custom role.
export function getEffectiveRoutes(slot, stream) {
  if (stream === 'quat') {
    if (slot.quatRole === 'cursor') return { ...CURSOR_DEFAULTS };
    if (slot.quatRole === 'frame')  return { ...FRAME_DEFAULTS };
    if (slot.quatRole === 'custom') return { ...slot.quatRoutes };
    // unmapped
    const r = {};
    for (const s of QUAT_SIGNALS) r[s] = 'unmapped';
    return r;
  } else {
    if (slot.inertialRole === 'gesture') return { ...GESTURE_DEFAULTS };
    if (slot.inertialRole === 'custom')  return { ...slot.inertialRoutes };
    const r = {};
    for (const s of INERTIAL_SIGNALS) r[s] = 'unmapped';
    return r;
  }
}

// Check if saved calibration has a specific role reserved for another sensor.
// Prevents auto-assign from grabbing a role that belongs to a sensor that
// hasn't connected yet.
function savedCalHasRole(role, excludeName) {
  if (!_savedCal) return false;
  for (const [name, saved] of Object.entries(_savedCal)) {
    if (name === excludeName) continue;
    if (saved.quatRole === role || saved.inertialRole === role) return true;
  }
  return false;
}

// Auto-assign roles when quaternion data first arrives
function autoAssignQuatIfNeeded(slot) {
  if (slot.quatRole !== 'unmapped') return;
  if (!getByRole('cursor') && !savedCalHasRole('cursor', slot.name)) {
    slot.quatRole = 'cursor';
    DEBUG && console.log(`[sensor-registry] auto-assigned "${slot.name}" quat → cursor`);
    S._onSensorRoleChanged?.(slot);
  }
}

// Auto-assign roles when inertial data first arrives
function autoAssignInertialIfNeeded(slot) {
  if (slot.inertialRole !== 'unmapped') return;
  if (!getByRole('gesture') && !savedCalHasRole('gesture', slot.name)) {
    slot.inertialRole = 'gesture';
    DEBUG && console.log(`[sensor-registry] auto-assigned "${slot.name}" inertial → gesture`);
    S._onSensorRoleChanged?.(slot);
  }
}


// ── Quaternion processing ────────────────────────────────────────────────────
// raw → tare → euler → axis remap → zeroEuler

export function handleSlotQuaternion(slot, values) {
  if (values.length < 4) return;
  const [qx, qy, qz, qw] = values;

  slot.quat      = [qx, qy, qz, qw];
  slot.euler     = quatToEulerDeg(qx, qy, qz, qw);
  slot.lastSeenQuat = Date.now();

  if (!slot.hasQuat) {
    slot.hasQuat = true;
    autoAssignQuatIfNeeded(slot);
  }

  // Apply tare
  const tared = applyTare(slot.quat, slot.quatCal.tareQuat);
  const rawEuler = quatToEulerDeg(tared[0], tared[1], tared[2], tared[3]);

  // Apply axis remap → semantic roll/pitch/yaw
  slot.zeroEuler = applyAxisMapToEuler(rawEuler, slot.quatCal);

  // Custom routing dispatch — feed signals to their destinations
  if (slot.quatRole === 'custom') {
    dispatchCustomQuat(slot);
  }
}


// ── Inertial processing ─────────────────────────────────────────────────────

export function handleSlotInertial(slot, values) {
  if (values.length < 6) return;
  const [gx, gy, gz, ax, ay, az] = values;

  const gyroMag = Math.sqrt(gx*gx + gy*gy + gz*gz);

  // Dynamic acceleration: subtract gravity reference if captured,
  // otherwise assume gravity ≈ 1g along some axis (less accurate).
  let accelDynMag;
  const gRef = slot.inertialCal.gravityRef;
  if (gRef) {
    const dx = ax - gRef[0];
    const dy = ay - gRef[1];
    const dz = az - gRef[2];
    accelDynMag = Math.sqrt(dx*dx + dy*dy + dz*dz);
  } else {
    accelDynMag = Math.max(0, Math.sqrt(ax*ax + ay*ay + az*az) - 1);
  }

  slot.inertial = { gx, gy, gz, ax, ay, az, gyroMag, accelDynMag };
  slot.lastSeenInertial = Date.now();

  if (!slot.hasInertial) {
    slot.hasInertial = true;
    autoAssignInertialIfNeeded(slot);
  }

  // Custom routing dispatch
  if (slot.inertialRole === 'custom') {
    dispatchCustomInertial(slot);
  }
}


// ── Custom routing dispatch ──────────────────────────────────────────────────
// When a stream has role 'custom', each breakout signal is evaluated and
// data is placed where consumers can find it.  viz-targeted signals go
// onto slot._customVizEuler (read by getSensorCamQ).  gesture-chain-targeted
// inertial signals build a virtual inertial object on the slot (read by
// getCustomGestureSlots).

function dispatchCustomQuat(slot) {
  if (!slot.zeroEuler) return;
  const routes = slot.quatRoutes;

  // Collect signals that target viz — accumulate into a virtual cursor
  const vizEuler = { x: 0, y: 0, z: 0 };
  let anyViz = false;

  for (const [signal, dest] of Object.entries(routes)) {
    const val = signal === 'euler pitch' ? slot.zeroEuler.y
              : signal === 'euler yaw'   ? slot.zeroEuler.z
              : signal === 'euler roll'  ? slot.zeroEuler.x
              : 0;

    if (dest === 'viz elevation')    { vizEuler.y = val; anyViz = true; }
    else if (dest === 'viz azimuth') { vizEuler.z = val; anyViz = true; }
    else if (dest === 'viz roll')    { vizEuler.x = val; anyViz = true; }
    // 'gesture chain', 'morph', 'world reference', 'unmapped' — future / no-op
  }

  if (anyViz) {
    slot._customVizEuler = vizEuler;
  } else {
    slot._customVizEuler = null;
  }
}

function dispatchCustomInertial(slot) {
  if (!slot.inertial) return;
  const routes = slot.inertialRoutes;
  const d = slot.inertial;

  const signalValues = {
    'gyro x': d.gx, 'gyro y': d.gy, 'gyro z': d.gz,
    'accel x': d.ax, 'accel y': d.ay, 'accel z': d.az,
  };

  // Build a virtual inertial object containing only gesture-chain-routed signals.
  // Signals not routed to gesture get zeroed — the gesture module still receives
  // a well-formed object and processes whatever is nonzero.
  let feedsGesture = false;
  const gi = { gx: 0, gy: 0, gz: 0, ax: 0, ay: 0, az: 0, gyroMag: 0, accelDynMag: 0 };

  for (const [signal, dest] of Object.entries(routes)) {
    if (dest === 'gesture chain') {
      feedsGesture = true;
      const val = signalValues[signal] ?? 0;
      if (signal === 'gyro x')  gi.gx = val;
      if (signal === 'gyro y')  gi.gy = val;
      if (signal === 'gyro z')  gi.gz = val;
      if (signal === 'accel x') gi.ax = val;
      if (signal === 'accel y') gi.ay = val;
      if (signal === 'accel z') gi.az = val;
    }
  }

  if (feedsGesture) {
    gi.gyroMag     = Math.sqrt(gi.gx*gi.gx + gi.gy*gi.gy + gi.gz*gi.gz);
    gi.accelDynMag = Math.sqrt(gi.ax*gi.ax + gi.ay*gi.ay + gi.az*gi.az);
    slot._customGestureInertial = gi;
    S._onGestureUpdate?.();
  } else {
    slot._customGestureInertial = null;
  }
}


// ── Custom routing queries (for consumers) ──────────────────────────────────

// Returns all custom-role slots whose inertial signals feed the gesture chain.
// Each returned slot has slot._customGestureInertial with the filtered data.
export function getCustomGestureSlots() {
  const result = [];
  for (const slot of _registry.values()) {
    if (slot.inertialRole === 'custom' && slot._customGestureInertial) {
      result.push(slot);
    }
  }
  return result;
}


// ── Tare ─────────────────────────────────────────────────────────────────────

export function slotTare(slot) {
  if (slot.quat) slot.quatCal.tareQuat = [...slot.quat];
  saveCalibration();
}

export function slotClearTare(slot) {
  slot.quatCal.tareQuat = null;
  saveCalibration();
}

function applyTare(quat, tareQuat) {
  if (!tareQuat) return quat;
  const [tx, ty, tz, tw] = tareQuat;
  return qMulQ([-tx, -ty, -tz, tw], quat);
}


// ── Axis remap (euler) ──────────────────────────────────────────────────────
// Converts physical-board euler { x, y, z } into semantic { x:roll, y:pitch, z:yaw }

export function applyAxisMapToEuler(euler, cal) {
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


// ── Axis remap (quaternion → camera space) ──────────────────────────────────
// When roll is muted (the common cursor case), the Euler decompose → recompose
// path suffers from gimbal lock at the poles: yaw and roll become entangled,
// causing the image to spin when the wand points near a pole.
//
// Pole-safe path: extract the forward vector from the quaternion (always
// well-defined), derive yaw/pitch from it (bypassing Euler), and hold yaw
// steady near the poles where the XZ projection is too small for a stable
// atan2.  Falls back to the original Euler path when all three axes are active.

let _axisMapLastYaw = 0;  // held yaw when sensor points near a pole

function applyAxisMapQuat(q, cal) {
  // Detect whether roll is muted — enables the pole-safe forward-vector path
  const rollMuted = cal?.axisMap &&
    Object.values(cal.axisMap).some(a => a.viz === 'roll' && a.mute);

  if (rollMuted) {
    // The muted axis is the sensor's "pointing direction" (forward vector).
    // Default: x→roll(muted), so forward = [1,0,0].
    // Rotating [1,0,0] by the quaternion and extracting atan2/asin gives
    // exactly euler.z (yaw) and euler.y (pitch) — same values as the Euler
    // decomposition but without the gimbal-lock singularity at the poles.
    //
    // This only works for the standard z→yaw, y→pitch layout.  Non-standard
    // axis swaps fall through to the Euler path below.
    const yawAxis  = Object.entries(cal.axisMap).find(([,a]) => a.viz === 'yaw'   && !a.mute);
    const pitchAxis= Object.entries(cal.axisMap).find(([,a]) => a.viz === 'pitch' && !a.mute);
    const isStdLayout = yawAxis?.[0] === 'z' && pitchAxis?.[0] === 'y';

    if (isStdLayout) {
      const [qx, qy, qz, qw] = q;
      // Forward vector = rotate [1,0,0] by quaternion (inline)
      const fx = 1 - 2 * (qy * qy + qz * qz);
      const fy = 2 * (qx * qy + qw * qz);
      const fz = 2 * (qx * qz - qw * qy);

      // Pitch (euler.y): always well-defined
      let pitch = Math.asin(Math.max(-1, Math.min(1, -fz)));

      // Yaw (euler.z): hold last good value near the poles where fx,fy → 0
      const xyLen = Math.sqrt(fx * fx + fy * fy);
      let yaw;
      if (xyLen > 0.15) {                         // ~81° — well clear of singularity
        yaw = Math.atan2(fy, fx);
        _axisMapLastYaw = yaw;
      } else {
        yaw = _axisMapLastYaw;
      }

      // Apply axis-map signs
      yaw   *= yawAxis[1].sign;
      pitch *= pitchAxis[1].sign;

      const qY = eulerAxisToQuat(0, 1, 0, yaw);
      const qP = eulerAxisToQuat(1, 0, 0, pitch);
      return qMulQ(qY, qP);
    }
    // Non-standard axis layout — fall through to Euler path
  }

  // ── Fallback: full Euler path (all three axes active) ──
  const euler = quatToEulerDeg(q[0], q[1], q[2], q[3]);
  const mapped = { roll: 0, pitch: 0, yaw: 0 };
  for (const phys of ['x', 'y', 'z']) {
    const { viz, sign, mute } = cal.axisMap[phys];
    if (mute) continue;
    mapped[viz] += sign * euler[phys];
  }
  const DEG = Math.PI / 180;
  const qYaw   = eulerAxisToQuat(0, 1, 0, mapped.yaw   * DEG);
  const qPitch = eulerAxisToQuat(1, 0, 0, mapped.pitch  * DEG);
  const qRoll  = eulerAxisToQuat(0, 0, 1, mapped.roll   * DEG);
  return qMulQ(qYaw, qMulQ(qPitch, qRoll));
}


// ── getSensorCamQ — called from renderer ────────────────────────────────────
// Returns [x, y, z, w] camera-space quaternion for the cursor role, or null.
// Also picks up custom-role quat slots that route signals to viz.
// Frame compensation is applied separately by the renderer via getFrameQ().

export function getSensorCamQ() {
  let camQ = null;

  // ── Primary path: cursor-role slot ──
  const cursorSlot = getByRole('cursor');
  if (cursorSlot?.quat) {
    camQ = applyAxisMapQuat(
      applyTare(cursorSlot.quat, cursorSlot.quatCal.tareQuat),
      cursorSlot.quatCal
    );
  }

  // ── Custom path: any custom-role quat slot routing signals to viz ──
  // Build euler from custom viz signals, convert to quat, layer on top.
  for (const slot of _registry.values()) {
    if (slot.quatRole !== 'custom' || !slot._customVizEuler) continue;
    const e = slot._customVizEuler;
    // Convert degrees → radians
    const DEG = Math.PI / 180;
    const qYaw   = eulerAxisToQuat(0, 1, 0, e.z * DEG);
    const qPitch = eulerAxisToQuat(1, 0, 0, e.y * DEG);
    const qRoll  = eulerAxisToQuat(0, 0, 1, e.x * DEG);
    const customQ = qMulQ(qYaw, qMulQ(qPitch, qRoll));

    if (camQ) {
      // Blend: multiply custom on top of cursor
      camQ = qMulQ(camQ, customQ);
    } else {
      camQ = customQ;
    }
  }

  return camQ;
}

// ── getSensorRawCursorQ — raw tared quaternion for delta-based tracking ──────
// Returns the cursor sensor's quaternion after tare but BEFORE axis-map /
// Euler decomposition.  The renderer uses this for incremental (delta-based)
// rotation, which avoids gimbal lock entirely.
export function getSensorRawCursorQ() {
  const cursorSlot = getByRole('cursor');
  if (!cursorSlot?.quat) return null;
  return applyTare(cursorSlot.quat, cursorSlot.quatCal.tareQuat);
}

// ── getCursorAxisSigns — yaw/pitch sign multipliers + rollMuted flag ─────────
export function getCursorAxisSigns() {
  const cursorSlot = getByRole('cursor');
  if (!cursorSlot?.quatCal?.axisMap) return { yaw: 1, pitch: 1, rollMuted: true };
  const map = cursorSlot.quatCal.axisMap;
  let yawSign = 1, pitchSign = 1, rollMuted = false;
  for (const phys of ['x', 'y', 'z']) {
    const a = map[phys];
    if (a.viz === 'roll' && a.mute) rollMuted = true;
    if (a.mute) continue;
    if (a.viz === 'yaw')   yawSign   = a.sign;
    if (a.viz === 'pitch') pitchSign = a.sign;
  }
  return { yaw: yawSign, pitch: pitchSign, rollMuted };
}

// ── getFrameQ — world rotation quaternion from frame-role sensor ───────────
// Returns the calibrated quaternion for the frame-role sensor, or null.
// Stored on S.frameQ by the renderer; sphere.js applies it per-point in
// cameraTransform / getCursorLonLat / screenToLonLat.
//
// Must return the SAME camera-convention quaternion as getSensorCamQ so that
// when a cursor and frame sensor are co-located and moved together, the two
// rotations cancel exactly:  camQ⁻¹ · frameQ · point · frameQ⁻¹ · camQ = point.
// (A conjugate here would give Q⁻² · point · Q² — a double rotation.)
//
// Works without a tare (applyTare passes through raw quat), but taring is
// recommended — without one the raw BNO085 magnetometer heading drifts
// slowly, causing a creeping spiral toward the pole.
export function getFrameQ() {
  const frameSlot = getByRole('frame');
  if (!frameSlot?.quat) return null;
  return applyAxisMapQuat(
    applyTare(frameSlot.quat, frameSlot.quatCal.tareQuat),
    frameSlot.quatCal
  );
}

// Helper: quaternion from axis-angle (used for custom euler → quat)
function eulerAxisToQuat(ax, ay, az, angle) {
  const s = Math.sin(angle * 0.5);
  const c = Math.cos(angle * 0.5);
  return [ax * s, ay * s, az * s, c];
}


// ── Quaternion math [x, y, z, w] ────────────────────────────────────────────

function quatToEulerDeg(x, y, z, w) {
  const roll  = Math.atan2(2*(w*x + y*z), 1 - 2*(x*x + y*y)) * (180 / Math.PI);
  const sinp  = 2*(w*y - z*x);
  const pitch = (Math.abs(sinp) >= 1
    ? Math.sign(sinp) * 90
    : Math.asin(sinp) * (180 / Math.PI));
  const yaw   = Math.atan2(2*(w*z + x*y), 1 - 2*(y*y + z*z)) * (180 / Math.PI);
  return { x: roll, y: pitch, z: yaw };
}

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

function qConjugate(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}

// ── Persistence ─────────────────────────────────────────────────────────────
// Save/load calibration + role assignments to localStorage so they survive
// page reloads.  Saved per slot name; applied to slots as they're discovered.

const LS_KEY = 'mubone_sensor_cal';
let _restoring = false;   // true while applying saved cal — suppresses re-saves

// Serialise just the bits we need to restore
function slotToJSON(slot) {
  return {
    quatRole:       slot.quatRole,
    inertialRole:   slot.inertialRole,
    quatRoutes:     slot.quatRoutes,
    inertialRoutes: slot.inertialRoutes,
    quatCal: {
      axisMap:  slot.quatCal.axisMap,
      tareQuat: slot.quatCal.tareQuat,
    },
    inertialCal: {
      axisMap:    slot.inertialCal.axisMap,
      gravityRef: slot.inertialCal.gravityRef,
    },
  };
}

export function saveCalibration() {
  if (_restoring) return;   // don't re-save while restoring from localStorage
  const data = {};
  for (const [name, slot] of _registry) {
    data[name] = slotToJSON(slot);
  }
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (_) {}
  DEBUG && console.log('[sensor-registry] calibration saved');
}

// Returns the saved map (or null) — used by getOrCreateSlot to prime new slots
let _savedCal = null;

function loadSavedCal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) _savedCal = JSON.parse(raw);
  } catch (_) { _savedCal = null; }
}

// Apply saved calibration to a slot (called when slot is first created).
// Slot must already be in _registry so assignQuatRole/assignInertialRole
// can find it and properly unassign conflicting holders.
function applySavedCal(slot) {
  if (!_savedCal) return;
  const saved = _savedCal[slot.name];
  if (!saved) return;

  // Restore calibration data (no conflict concerns)
  if (saved.quatCal) {
    if (saved.quatCal.axisMap)  slot.quatCal.axisMap  = saved.quatCal.axisMap;
    if (saved.quatCal.tareQuat) slot.quatCal.tareQuat = saved.quatCal.tareQuat;
  }
  if (saved.inertialCal) {
    if (saved.inertialCal.axisMap)    slot.inertialCal.axisMap    = saved.inertialCal.axisMap;
    if (saved.inertialCal.gravityRef) slot.inertialCal.gravityRef = saved.inertialCal.gravityRef;
  }

  // Restore custom routes
  if (saved.quatRoutes)     slot.quatRoutes     = saved.quatRoutes;
  if (saved.inertialRoutes) slot.inertialRoutes = saved.inertialRoutes;

  // Restore roles via assign functions — these unassign any previous holder
  // so we never end up with two cursors or two gestures.
  _restoring = true;
  if (saved.quatRole && saved.quatRole !== 'unmapped') {
    assignQuatRole(slot.name, saved.quatRole);
  }
  if (saved.inertialRole && saved.inertialRole !== 'unmapped') {
    assignInertialRole(slot.name, saved.inertialRole);
  }
  _restoring = false;

  DEBUG && console.log(`[sensor-registry] restored cal for "${slot.name}"`);
}

export function clearSavedCalibration() {
  try { localStorage.removeItem(LS_KEY); } catch (_) {}
  _savedCal = null;
  DEBUG && console.log('[sensor-registry] saved calibration cleared');
}

export function initSensor() {
  loadSavedCal();
  DEBUG && console.log('[sensor-registry] ready — waiting for OSC via osc.js');
}
