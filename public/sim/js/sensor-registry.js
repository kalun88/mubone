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
// Quaternion roles: cursor, camera, frame, custom, unmapped
// Inertial roles:   gesture, custom, unmapped
//
// "camera" — projector-aim: the sensor rotates the viewport.  Turning the
//            sensor right pans the view right, same as head-tracking VR.
//            World/grain field stays in world coords; the performer chooses
//            which part to look at.  This is what the original "frame" role
//            always did mechanically — just renamed so the semantics are clear.
// "frame"  — body-reference: the sphere is attached to this sensor's tare
//            pose.  Moving the sensor rotates the sphere *with it*, so the
//            performer sees no visual change when they turn their body.
//            Cursor is drawn at the delta direction (cursor-relative-to-frame).
//            Rotating cursor + frame together → nothing moves on screen.
//
// "custom" opens per-signal routing — individual euler axes or inertial
// signals can be sent to arbitrary destinations.
//
// Consumers read from the registry via getByRole('cursor'), etc.
// ============================================================================

import { S, DEBUG } from './state.js';

// ── Roles ────────────────────────────────────────────────────────────────────
export const QUAT_ROLES     = ['cursor', 'camera', 'frame', 'unmapped'];
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
export const CAMERA_DEFAULTS = {
  'euler pitch': 'world reference',
  'euler yaw':   'world reference',
  'euler roll':  'world reference',
};
// FRAME_DEFAULTS identical to CAMERA_DEFAULTS for now — both feed the world-
// reference quaternion.  The difference between camera and frame is how the
// renderer *applies* that quat (world rotation vs. cursor delta), not what
// signals feed it.  Kept as a separate export so UI copy can differ and so
// future work can diverge their routing if it ever needs to.
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
// The pitch and yaw signs are NOT arbitrary defaults — they are a fixed
// convention offset, and leaving them at +1 makes every freshly calibrated
// mount need the same two manual flips (Ek, 2026-08-31, across four different
// mountings). The cause is in applyAxisMapQuat: it DECOMPOSES with
// quatToEulerDeg, which is Z-up ZYX (yaw about Z), and RECOMPOSES in the
// sphere's Y-up graphics convention (yaw about (0,1,0), pitch about (1,0,0),
// roll about (0,0,1)). That relabelling is mount-independent, so its correction
// belongs here once rather than in the player's hands every time.
// Guarded by scripts/sensor-audit.js § I.
function defaultQuatAxisMap() {
  return {
    x: { viz: 'roll',  sign:  1, mute: false },
    y: { viz: 'pitch', sign: -1, mute: false },
    z: { viz: 'yaw',   sign: -1, mute: false },
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
      axisMap:     defaultQuatAxisMap(),
      _pose1:      null,   // scratch, between the two calibration poses; never persisted
      // The calibration is two rotations on OPPOSITE sides of the sensor
      // quaternion, which is what lets them be set independently:
      //   output = conj(H) · q · conj(B)
      // B (mount) is BODY-side — how the sensor sits on the hand, wrist, head
      //   or back. Arbitrary, set once per mounting.
      // H (heading) is WORLD-side and constrained to true vertical — where the
      //   stage is. Re-zeroed freely; it cannot invalidate B because it is
      //   captured relative to it, and it commutes with a turn.
      mountQuat:   null,
      headingQuat: null,
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
// Quaternion roles: 'cursor', 'camera', 'frame'
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

  // Unassign from previous holder (except 'unmapped' and 'custom' — multiple custom allowed).
  // Fire _onSensorRoleChanged for every slot that just lost the role — otherwise downstream
  // consumers (DeviceState.role, UI "active" highlight, etc.) never learn about the clear
  // and stale "this is the cursor" state accumulates across switches.
  if (role !== 'unmapped' && role !== 'custom') {
    for (const slot of _registry.values()) {
      if (slot.name !== slotName && slot.quatRole === role) {
        slot.quatRole = 'unmapped';
        S._onSensorRoleChanged?.(slot);
      }
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

  // Unassign from previous holder (except 'unmapped' and 'custom').
  // Notify on every clear so DeviceState + UI stay in sync — same fix as assignQuatRole.
  if (role !== 'unmapped' && role !== 'custom') {
    for (const slot of _registry.values()) {
      if (slot.name !== slotName && slot.inertialRole === role) {
        slot.inertialRole = 'unmapped';
        S._onSensorRoleChanged?.(slot);
      }
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
    if (slot.quatRole === 'camera') return { ...CAMERA_DEFAULTS };
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
    S._onSensorFirstQuat?.();   // a persisted sensor camera waits for this (main.js)
  }

  // Apply tare
  const tared = applyCal(slot.quat, slot.quatCal);
  const rawEuler = quatToEulerDeg(tared[0], tared[1], tared[2], tared[3]);

  // Apply axis remap → semantic roll/pitch/yaw
  slot.zeroEuler = applyAxisMapToEuler(rawEuler, slot.quatCal);

  // Custom routing dispatch — feed signals to their destinations
  if (slot.quatRole === 'custom') {
    dispatchCustomQuat(slot);
  }

  // Fire paint-ticker callback on every cursor-role quaternion arrival.
  // This drives velocity-adaptive particle deposition at IMU rate (up to 400Hz)
  // instead of the old render-loop gate (10Hz).
  if (slot.quatRole === 'cursor') {
    S._onCursorQuatArrival?.();
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


// ── Quaternion calibration IS owned by this module (2026-08-31) ─────────────
// The ownership above was reversed. It used to read "imu-setup owns
// calibration, so the registry should just pass data through", and imu-setup
// enforced that by nulling quatCal on every connect — which is why the older
// registry tare could not have worked even if something had called it.
//
// The reason it moved: an Euler-space tare CANNOT fix a heading offset. It
// decomposes, subtracts yaw, recomposes — and subtracting an angle after the
// decomposition cannot rotate the frame the decomposition was done in. A
// sensor 45° off the reference X axis therefore smears one physical tilt
// across pitch AND roll, and no sign flip or channel remap can undo it
// (measured 2026-08-31: one nod produced 64° pitch and 54° yaw). Only a
// quaternion applied BEFORE quatToEulerDeg can, and that is applyCal() here.
//
// So imu-setup no longer resets quatCal, `mubone_sensor_cal` is the one place
// quaternion calibration lives, and captureMount / captureHeading below are
// the only two entry points. Keep `mubone_sensor_cal_v` in the settings
// export — its omission silently rewrote frame-role sensors once already
// (docs/archive/EXPORT-IMPORT-AUDIT-2026-07.md, finding on schema flags).


// Swing-twist: the component of `q` that is a rotation about world +Z.
// The BNO's rotation vector is Z-up, so this IS the heading, whatever angle
// the sensor is mounted at — the vertical comes from gravity, never from a
// device axis. That is what makes a head or tuba mount behave like a hand.
//
// Degenerate at 180° about a horizontal axis, where z and w both vanish and
// the twist is undefined. Returns identity there rather than a normalised
// zero — an upside-down mount is exactly the case that hits this (2026-08-31).
// Used where the pose is LEVEL by construction (mountFromPoses: pose 1 is
// level in B's own frame; the v1 migration). Not for the heading zero — see
// headingAboutZ, and why (2026-09-10).
const _TWIST_EPS = 1e-6;
function twistAboutZ(q) {
  const z = q[2], w = q[3];
  const n = Math.hypot(z, w);
  if (n < _TWIST_EPS) return [0, 0, 0, 1];
  return [0, 0, z / n, w / n];
}

// The pure rotation about world Z that carries q's forward (body X) axis to
// azimuth 0 — quatToEulerDeg's yaw, as a quaternion. Defined at every pitch
// and roll; only a forward axis pointing straight up or down leaves it
// arbitrary, and the next zero fixes that.
function headingAboutZ(q) {
  const [x, y, z, w] = q;
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)];
}

// output = conj(H) · q · conj(B). Both no-op on null, so an uncalibrated slot
// passes its quaternion through untouched.
//
// The two sides are the whole design, and the reason is one line of algebra:
// H is constrained to be a PURE rotation about world Z, so it COMMUTES with a
// performer turning on the spot. conj(H)·Rz(φ)·H·B·conj(B) = Rz(φ) — a turn
// reads as yaw and nothing else, for EVERY mounting angle.
//
// Putting the mount on the left instead (conj(M)·q) makes the output frame the
// device's own rest frame, whose Z is the device's up rather than the world's.
// Level mounts survive that because the two coincide; a sensor worn vertically
// on a back does not, and its turn comes out as pitch (Ek, 2026-08-31 — the
// bug this shape fixes). § G of scripts/sensor-audit.js is that case.
export function applyCal(quat, cal) {
  let q = quat;
  if (cal?.mountQuat)   q = qMulQ(q, qConjugate(cal.mountQuat));
  if (cal?.headingQuat) q = qMulQ(qConjugate(cal.headingQuat), q);
  return q;
}

// ── Calibration capture ─────────────────────────────────────────────────────
// Two gestures, and only two. Mount is setup; heading is performance.

// ── Two-pose mount calibration ──────────────────────────────────────────────
// ONE pose cannot determine a mounting, and this is not a tuning problem but a
// missing degree of freedom. Splitting the rest pose by its twist about world Z
// gives `H_est = twist(H_true · B)`, which picks up whatever Z-rotation the
// STRAP itself carries — so the estimated heading is wrong by that amount and a
// performer's pitch smears into roll by the same angle. Measured 2026-08-31:
// exact for a level mount, 26° of false roll for a twisted one. A turn is immune
// (H commutes with Rz whether or not it is the right H), which is why a suite
// that only tested turns passed it.
//
// Two poses give two independent directions, which pin the frame completely:
//   pose 1  neutral, pointing forward  → gravity is the performer's UP
//   pose 2  pointing down at the earth → the rotation axis is LEFT-RIGHT
// Standard N-pose/T-pose construction, and it exists for exactly this reason.

function _v3norm(v) { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/n, v[1]/n, v[2]/n]; }
function _v3cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function _v3dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }

// Rotate a WORLD vector into the body frame: conj(q) · v · q
function _worldToBody(q, v) {
  const t = [2*(q[1]*v[2] - q[2]*v[1]), 2*(q[2]*v[0] - q[0]*v[2]), 2*(q[0]*v[1] - q[1]*v[0])];
  return [v[0] - q[3]*t[0] + (q[1]*t[2] - q[2]*t[1]),
          v[1] - q[3]*t[1] + (q[2]*t[0] - q[0]*t[2]),
          v[2] - q[3]*t[2] + (q[0]*t[1] - q[1]*t[0])];
}

// Quaternion for the rotation whose matrix has these three COLUMNS.
function _quatFromCols(cx, cy, cz) {
  const m = [[cx[0], cy[0], cz[0]], [cx[1], cy[1], cz[1]], [cx[2], cy[2], cz[2]]];
  const tr = m[0][0] + m[1][1] + m[2][2];
  let x, y, z, w, s;
  if (tr > 0) {
    s = Math.sqrt(tr + 1) * 2; w = 0.25*s;
    x = (m[2][1]-m[1][2])/s; y = (m[0][2]-m[2][0])/s; z = (m[1][0]-m[0][1])/s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; w = (m[2][1]-m[1][2])/s;
    x = 0.25*s; y = (m[0][1]+m[1][0])/s; z = (m[0][2]+m[2][0])/s;
  } else if (m[1][1] > m[2][2]) {
    s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; w = (m[0][2]-m[2][0])/s;
    x = (m[0][1]+m[1][0])/s; y = 0.25*s; z = (m[1][2]+m[2][1])/s;
  } else {
    s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; w = (m[1][0]-m[0][1])/s;
    x = (m[0][2]+m[2][0])/s; y = (m[1][2]+m[2][1])/s; z = 0.25*s;
  }
  return [x, y, z, w];
}

// How far apart the two poses must be for the axis to mean anything. Below
// this the cross product is noise and the calibration would be worse than none.
export const MOUNT_POSE_MIN_DEG = 20;

// Pure: two quaternions in, calibration out. `null` if the poses are too close
// together or too nearly colinear with gravity to define a frame.
export function mountFromPoses(q1, q2) {
  if (!q1 || !q2) return null;
  const up = _v3norm(_worldToBody(q1, [0, 0, 1]));   // performer UP, sensor coords
  const d  = qMulQ(qConjugate(q1), q2);              // pose 1 → pose 2, sensor coords
  const sgn = d[3] < 0 ? -1 : 1;                     // shortest arc
  let ax = [d[0]*sgn, d[1]*sgn, d[2]*sgn];
  const axLen = Math.hypot(ax[0], ax[1], ax[2]);
  const angDeg = 2 * Math.atan2(axLen, Math.abs(d[3])) * 180 / Math.PI;
  if (angDeg < MOUNT_POSE_MIN_DEG) return null;
  ax = _v3norm(ax);
  // Tipping DOWN is a negative pitch, so the measured axis is −Y.
  let yp = [-ax[0], -ax[1], -ax[2]];
  const along = _v3dot(yp, up);
  yp = _v3norm([yp[0] - along*up[0], yp[1] - along*up[1], yp[2] - along*up[2]]);
  if (!Number.isFinite(yp[0]) || Math.hypot(...yp) < 0.5) return null;  // tipped about vertical
  const zp = up;
  const xp = _v3cross(yp, zp);                       // right-handed: X = Y × Z
  const B = qConjugate(_quatFromCols(xp, yp, zp));   // sensor → performer
  const H = twistAboutZ(qMulQ(q1, qConjugate(B)));   // now the TRUE heading
  return { mountQuat: B, headingQuat: H };
}

// Pose 1 — neutral, pointing forward. Stashed until pose 2 arrives; nothing is
// written to the calibration yet, so an abandoned run changes nothing.
export function captureMountPose1(slot, quat = null) {
  const q = quat || slot?.quat;
  if (!q) return null;
  slot.quatCal._pose1 = q.slice();
  return slot.quatCal._pose1;
}

// Pose 2 — pointing down at the earth. Completes the calibration, or returns
// null if the two poses are too close to define a frame.
export function captureMountPose2(slot, quat = null) {
  const q = quat || slot?.quat;
  if (!q || !slot?.quatCal?._pose1) return null;
  const cal = mountFromPoses(slot.quatCal._pose1, q);
  if (!cal) return null;
  slot.quatCal.mountQuat   = cal.mountQuat;
  slot.quatCal.headingQuat = cal.headingQuat;
  slot.quatCal._pose1 = null;
  saveCalibration();
  return cal;
}

export function cancelMountCapture(slot) {
  if (slot?.quatCal) slot.quatCal._pose1 = null;
}

// Face the stage, then call this. Re-derives H ONLY — B is untouched, so the
// mounting survives. H is the yaw the app READS from q·conj(B) — the azimuth
// of the forward axis, which is what quatToEulerDeg calls yaw — as a pure
// rotation about world Z, so zeroEuler.z is 0 the instant after the press.
//
// It was twistAboutZ(q·conj(B)) until 2026-09-10. The twist is the heading
// only when the pose is LEVEL: the swing left after removing it has a yaw of
// its own whenever pitch and roll are both non-zero (0.9° at 10°/10°, 8° at
// 20°/45°), and near a 180° roll — an uncalibrated upside-down mount — the
// twist lives in two vanishing components, so 4° of pitch at zero time moved
// the residual by 72° and a zero could land at lon −69° (Ek, 2026-09-10:
// "it doesn't go back to 0 0, always a bit off, only sometimes"). The forward
// axis has a well-defined azimuth at every roll. sensor-audit.js § B2.
export function captureHeading(slot) {
  if (!slot?.quat) return null;
  const turned = slot.quatCal.mountQuat
    ? qMulQ(slot.quat, qConjugate(slot.quatCal.mountQuat))
    : slot.quat;
  slot.quatCal.headingQuat = headingAboutZ(turned);
  saveCalibration();
  return slot.quatCal.headingQuat;
}

export function clearMount(slot) {
  if (!slot) return;
  slot.quatCal.mountQuat = null;
  saveCalibration();
}

export function clearHeading(slot) {
  if (!slot) return;
  slot.quatCal.headingQuat = null;
  saveCalibration();
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
// Two paths, selected automatically:
//
// 1. Forward-vector path (roll muted/unmapped):
//    Find the unused physical axis, rotate its unit vector by the quaternion,
//    extract yaw/pitch from the result.  Bypasses Euler, avoids gimbal lock.
//    Yaw is held near the poles where atan2 becomes unstable.
//
// 2. Euler path (all three axes active):
//    Standard decompose → remap → recompose.  Nearly lossless round-trip,
//    handles poles well.  When the gravity-aligned tare leaves a static roll
//    offset in the tared quaternion, the offset is subtracted before
//    decomposition to prevent pitch↔yaw coupling from the tilted roll axis.

let _axisMapLastYaw = 0;  // held yaw when sensor points near a pole

// Find the physical axis that serves as the sensor's forward/pointing direction.
// Returns the physical axis key ('x', 'y', or 'z'), or null if all axes are
// actively driving the output (→ use Euler fallback).
function findForwardAxis(cal) {
  if (!cal?.axisMap) return null;
  const entries = Object.entries(cal.axisMap);
  // Priority 1: muted roll axis (explicit "I am the forward direction")
  for (const [phys, a] of entries) {
    if (a.viz === 'roll' && a.mute) return phys;
  }
  // Priority 2: unmapped axis (not driving anything → available as forward)
  for (const [phys, a] of entries) {
    if (a.viz === 'unmapped') return phys;
  }
  // Priority 3: any muted axis that isn't driving yaw or pitch
  for (const [phys, a] of entries) {
    if (a.mute && a.viz !== 'yaw' && a.viz !== 'pitch') return phys;
  }
  return null;
}

// Rotate the forward unit vector into the reference frame.
// Returns [fx, fy, fz] — the world-space direction of the forward axis.
function forwardVecFromQuat(q, forwardPhys) {
  const [qx, qy, qz, qw] = q;
  if (forwardPhys === 'x') {
    return [
      1 - 2*(qy*qy + qz*qz),
      2*(qx*qy + qw*qz),
      2*(qx*qz - qw*qy)
    ];
  } else if (forwardPhys === 'y') {
    return [
      2*(qx*qy - qw*qz),
      1 - 2*(qx*qx + qz*qz),
      2*(qy*qz + qw*qx)
    ];
  } else { // 'z'
    return [
      2*(qx*qz + qw*qy),
      2*(qy*qz - qw*qx),
      1 - 2*(qx*qx + qy*qy)
    ];
  }
}

function applyAxisMapQuat(q, cal) {
  const forwardPhys = findForwardAxis(cal);

  // ── Forward-vector path (roll muted or unmapped) ──────────────────────
  if (forwardPhys) {
    const yawEntry   = Object.entries(cal.axisMap).find(([,a]) => a.viz === 'yaw'   && !a.mute);
    const pitchEntry = Object.entries(cal.axisMap).find(([,a]) => a.viz === 'pitch' && !a.mute);

    if (yawEntry && pitchEntry) {
      const [fx, fy, fz] = forwardVecFromQuat(q, forwardPhys);
      let pitch = Math.asin(Math.max(-1, Math.min(1, -fz)));
      const xyLen = Math.sqrt(fx*fx + fy*fy);
      let yaw;
      if (xyLen > 0.15) {
        yaw = Math.atan2(fy, fx);
        _axisMapLastYaw = yaw;
      } else {
        yaw = _axisMapLastYaw;
      }
      yaw   *= yawEntry[1].sign;
      pitch *= pitchEntry[1].sign;
      const qY = eulerAxisToQuat(0, 1, 0, yaw);
      const qP = eulerAxisToQuat(1, 0, 0, pitch);
      return qMulQ(qY, qP);
    }
  }

  // ── Euler path (all three axes active) ────────────────────────────────
  // `tareRollOffset` used to sit here, subtracting a static X-roll captured at
  // tare time to stop a tilted mount coupling pitch into yaw. It is gone: the
  // mount rotation B is a full quaternion applied on the body side, so a
  // tilted mount is zeroed properly rather than patched one axis at a time.
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
//
// Returns null whenever a 'camera' or 'frame' role sensor is active — in both
// of those multi-IMU modes the main S.camQ is forced to identity, and the
// viewport/body compensation comes from getCameraQ() / body-frame delta math
// instead.  getSensorCursorQ() then drives the cursor.

export function getSensorCamQ() {
  // ── Camera role (projector-aim): camera sensor rotates the world via
  // getCameraQ().  S.camQ stays at identity; cursor is driven by
  // getSensorCursorQ() returning the cursor's world quat.
  const cameraSlot = getByRole('camera');
  if (cameraSlot?.quat) return null;

  // ── Frame role (body-reference): frame sensor anchors the sphere to the
  // body via body-frame delta math.  S.camQ stays at identity; cursor is
  // driven by getSensorCursorQ() returning the delta quat.
  const frameSlot = getByRole('frame');
  if (frameSlot?.quat) return null;

  let camQ = null;

  // ── Primary path: cursor-role slot (single-IMU mode only) ──
  const cursorSlot = getByRole('cursor');
  if (cursorSlot?.quat) {
    camQ = applyAxisMapQuat(
      applyCal(cursorSlot.quat, cursorSlot.quatCal),
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

// ── getSensorCursorQ — cursor quaternion for multi-IMU modes ────────────────
// Returns the cursor quaternion consumed by the main renderer in whichever
// multi-IMU mode is active.  Single-IMU returns null (cursor is locked to
// camera center; getSensorCamQ() handles everything).
//
//   camera-role active → cursor's tared+axis-mapped world quat (projector mode:
//     cursor position is in world coords; cameraTransform rotates the world
//     by conj(F_camera), so the cursor visually appears at the delta direction
//     without extra math).
//
//   frame-role active  → delta quat conj(F_frame)·C_world (body-frame mode:
//     no world rotation, so the cursor quat IS the delta — rotating both
//     sensors together leaves the cursor at a fixed screen position AND the
//     grid stays put).  Produces cursorQ = identity when cursor and frame are
//     aligned at their tare poses.
//
// Custom-role viz signals are layered on top in both modes, same as before.
export function getSensorCursorQ() {
  const cameraSlot = getByRole('camera');
  const frameSlot  = getByRole('frame');
  const inCameraMode = !!(cameraSlot?.quat);
  const inFrameMode  = !!(frameSlot?.quat);
  if (!inCameraMode && !inFrameMode) return null;   // single IMU

  let curQ = null;
  const cursorSlot = getByRole('cursor');
  if (cursorSlot?.quat) {
    const cWorld = applyAxisMapQuat(
      applyCal(cursorSlot.quat, cursorSlot.quatCal),
      cursorSlot.quatCal
    );
    if (inFrameMode && cWorld) {
      // Body-frame mode: cursor = conj(F_frame) · C_world = the delta.
      // getFrameQ() already returns conj(F_frame), so multiply directly.
      const fConj = getFrameQ();
      curQ = fConj ? qMulQ(fConj, cWorld) : cWorld;
    } else {
      // Camera mode: cursor stays in world coords, cameraTransform handles
      // the frame rotation visually.
      curQ = cWorld;
    }
  }

  // Custom path: layer custom-role viz signals on top
  for (const slot of _registry.values()) {
    if (slot.quatRole !== 'custom' || !slot._customVizEuler) continue;
    const e = slot._customVizEuler;
    const DEG = Math.PI / 180;
    const qYaw   = eulerAxisToQuat(0, 1, 0, e.z * DEG);
    const qPitch = eulerAxisToQuat(1, 0, 0, e.y * DEG);
    const qRoll  = eulerAxisToQuat(0, 0, 1, e.x * DEG);
    const customQ = qMulQ(qYaw, qMulQ(qPitch, qRoll));

    if (curQ) {
      curQ = qMulQ(curQ, customQ);
    } else {
      curQ = customQ;
    }
  }

  return curQ;
}

// ── getSensorRawCursorQ — raw tared quaternion for delta-based tracking ──────
// Returns the cursor sensor's quaternion after tare but BEFORE axis-map /
// Euler decomposition.  The renderer uses this for incremental (delta-based)
// rotation, which avoids gimbal lock entirely.
export function getSensorRawCursorQ() {
  const cursorSlot = getByRole('cursor');
  if (!cursorSlot?.quat) return null;
  return applyCal(cursorSlot.quat, cursorSlot.quatCal);
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

// ── Shared helper: calibrated conj(F_world) for a slot ──────────────────────
// Used by both getCameraQ() and getFrameQ().  Returns the tared+axis-mapped
// quaternion, conjugated for renderer convention.
//
// ⚠ CRITICAL — DO NOT REMOVE THE CONJUGATION.
// cameraTransform applies this quat directly but camQ conjugated.  Without
// this conjugation, the sensor exhibits gimbal lock (pitch→roll coupling at
// 90° yaw) while the cursor does not.  Tested and verified Mar 28.
// See cameraTransform() in sphere.js for the matching comment.
function _worldRefQuat(slot) {
  if (!slot?.quat) return null;
  const q = applyAxisMapQuat(
    applyCal(slot.quat, slot.quatCal),
    slot.quatCal
  );
  if (!q) return null;
  return [-q[0], -q[1], -q[2], q[3]];
}

// ── getCameraQ — viewport-rotating quaternion from camera-role sensor ───────
// Returns conj(C_world) for the sensor assigned the 'camera' role, or null.
// Consumed by the main renderer and stored on S.frameQ; sphere.cameraTransform
// rotates every world point by this quat, producing a projector-aim feel:
// rotating the camera sensor pans the viewport while the world stays fixed
// in world coords.
//
// This is the behaviour the role originally named 'frame' had.  It was
// renamed on 2026-04-23 to distinguish from body-reference 'frame'.
export function getCameraQ() {
  return _worldRefQuat(getByRole('camera'));
}

// ── getFrameQ — body-reference quaternion from frame-role sensor ────────────
// Returns conj(F_world) for the sensor assigned the 'frame' role, or null.
// Consumed by:
//   - the staging sphere (relational-features + ui-posture-map) for computing
//     the Δ between cursor and body, and
//   - the main renderer's body-frame path, where the cursor is drawn at the
//     delta direction and no world rotation is applied.
//
// Same math as getCameraQ() — the difference is how the renderer uses the
// result, not what the quat contains.
export function getFrameQ() {
  return _worldRefQuat(getByRole('frame'));
}

// ── getCursorWorldQ — cursor in the same world convention as getFrameQ ──────
// Same pipeline as getFrameQ (tare → axis-map) but WITHOUT the final
// conjugation.  Used by the staging engine's relational-features.js to compute
// Δ = getFrameQ() * getCursorWorldQ() = conj(F_world) * C_world, which is zero
// when both sensors rotate together.
//
// Parallel to getSensorRawCursorQ (tare only, no axis-map) — the two serve
// different callers: the delta-based renderer uses the raw-tared quat because
// it feeds sphere.cameraTransform which applies its own conventions; the
// relational/staging path needs axis-mapped world-frame matching getFrameQ.
export function getCursorWorldQ() {
  const cursorSlot = getByRole('cursor');
  if (!cursorSlot?.quat) return null;
  return applyAxisMapQuat(
    applyCal(cursorSlot.quat, cursorSlot.quatCal),
    cursorSlot.quatCal
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

const LS_KEY          = 'mubone_sensor_cal';
const LS_VERSION_KEY  = 'mubone_sensor_cal_v';   // schema version flag
const CURRENT_VERSION = '2';                     // bumped 2026-08-31: tareQuat → mountQuat + headingQuat
let _restoring = false;   // true while applying saved cal — suppresses re-saves

// Serialise just the bits we need to restore
function slotToJSON(slot) {
  return {
    quatRole:       slot.quatRole,
    inertialRole:   slot.inertialRole,
    quatRoutes:     slot.quatRoutes,
    inertialRoutes: slot.inertialRoutes,
    quatCal: {
      axisMap:     slot.quatCal.axisMap,
      mountQuat:   slot.quatCal.mountQuat,
      headingQuat: slot.quatCal.headingQuat,
    },
    inertialCal: {
      axisMap:    slot.inertialCal.axisMap,
      gravityRef: slot.inertialCal.gravityRef,
    },
  };
}

export function saveCalibration() {
  if (_restoring) return;   // don't re-save while restoring from localStorage
  // MERGE, never replace. This used to serialise the registry and overwrite
  // the stored map wholesale, so any save while a slot had not yet restored
  // erased that slot's calibration — reachable whenever the first OSC packet
  // beats initSensor(), which a websocket instrument reconnecting after a
  // reload does easily (2026-08-31). A slot the registry has never heard of
  // must keep whatever is on disk.
  loadSavedCal();
  const data = { ..._savedCal };
  for (const [name, slot] of _registry) data[name] = slotToJSON(slot);
  _savedCal = data;
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (_) {}
  DEBUG && console.log('[sensor-registry] calibration saved');
}

// Returns the saved map (or null) — used by getOrCreateSlot to prime new slots
let _savedCal = null;
let _savedCalLoaded = false;   // distinct from "loaded and empty"

function loadSavedCal() {
  if (_savedCalLoaded) return;
  _savedCalLoaded = true;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) _savedCal = JSON.parse(raw);
  } catch (_) { _savedCal = null; }
  _migrateSavedCal();
}

// One-shot schema migrations.  Runs once per localStorage bucket — gated by
// LS_VERSION_KEY so re-loading after a successful migration is a no-op.
//
// v→1 (2026-04-23): the original 'frame' role did projector-aim rendering
// (rotating the viewport with the sensor).  That semantic is now named
// 'camera' so the new 'frame' role can mean body-reference.  Any slot saved
// with quatRole='frame' before this migration is the OLD semantic → rewrite
// to 'camera' so the live-set keeps behaving identically.
function _migrateSavedCal() {
  try {
    const v = localStorage.getItem(LS_VERSION_KEY);
    if (v === CURRENT_VERSION) return;

    if (_savedCal) {
      let migrated = 0;
      for (const name of Object.keys(_savedCal)) {
        const slot = _savedCal[name];
        if (slot && slot.quatRole === 'frame') {
          slot.quatRole = 'camera';
          migrated++;
        }
      }
      if (migrated > 0) {
        console.log(`[sensor-registry] migrated ${migrated} slot(s) frame → camera`);
        try { localStorage.setItem(LS_KEY, JSON.stringify(_savedCal)); } catch (_) {}
      }
    }
    try { localStorage.setItem(LS_VERSION_KEY, CURRENT_VERSION); } catch (_) {}
  } catch (e) {
    console.warn('[sensor-registry] migration failed:', e);
  }
}

// Apply saved calibration to a slot (called when slot is first created).
// Slot must already be in _registry so assignQuatRole/assignInertialRole
// can find it and properly unassign conflicting holders.
function applySavedCal(slot) {
  // Lazily, in case a sensor's first packet arrives before initSensor(). The
  // early return on a null _savedCal used to mean the slot came up
  // uncalibrated and the next save wrote that emptiness to disk.
  loadSavedCal();
  if (!_savedCal) return;
  const saved = _savedCal[slot.name];
  if (!saved) return;

  // Restore calibration data (no conflict concerns)
  if (saved.quatCal) {
    if (saved.quatCal.axisMap)  slot.quatCal.axisMap  = saved.quatCal.axisMap;
    // A map stored before the convention offset moved into the default (2026-08-31)
    // carries whatever the player flipped by hand to compensate. Restoring it
    // verbatim would double-apply the correction, so an all-+1 map — the old
    // default, which never worked without manual flips — is replaced.
    if (saved.quatCal.axisMap &&
        Object.values(saved.quatCal.axisMap).every(a => a.sign === 1 && !a.mute)) {
      slot.quatCal.axisMap = defaultQuatAxisMap();
    }
    if (saved.quatCal.mountQuat)   slot.quatCal.mountQuat   = saved.quatCal.mountQuat;
    if (saved.quatCal.headingQuat) slot.quatCal.headingQuat = saved.quatCal.headingQuat;
    // One-shot migration: a v1 `tareQuat` was the whole orientation at tare
    // time and was left-multiplied, which is exactly what mountQuat is now.
    // Carry it across verbatim — the behaviour is identical, so a rig that was
    // calibrated before this change keeps its calibration.
    if (!saved.quatCal.mountQuat && saved.quatCal.tareQuat) {
      const H = twistAboutZ(saved.quatCal.tareQuat);
      slot.quatCal.headingQuat = H;
      slot.quatCal.mountQuat   = qMulQ(qConjugate(H), saved.quatCal.tareQuat);
    }
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

// Forget ONE slot, live and saved. The saved table is merged with the live
// slots on every save, so a slot that has stopped existing is otherwise kept
// forever — and its saved role is a claim on the next boot. This is how the
// align audit's synthetic `__rt10__` sensor came to hold the cursor role in
// Ek's storage across three sessions (2026-09-09).
export function forgetSlot(name) {
  loadSavedCal();
  const hadLive  = _registry.delete(name);
  const hadSaved = !!(_savedCal && name in _savedCal);
  if (hadSaved) {
    delete _savedCal[name];
    try { localStorage.setItem(LS_KEY, JSON.stringify(_savedCal)); } catch (_) {}
  }
  return hadLive || hadSaved;
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
