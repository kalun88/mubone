// ============================================================================
// sensor-registry.js — sensor SLOTS: calibration, roles, and what the app reads
//
// ── Read this first: the three layers of the sensor code ───────────────────
//   LINK    how packets arrive.   sygaldry.js (the mubone instrument, cable or
//           wifi), ximu3.js (an x-imu3, UDP or serial), osc.js (anything
//           sending /sensor/{name}/quaternion).
//   SENSOR  one row on the Sensors page, any kind.   sensors.js — the list,
//           liveness, roles as the page sets them, the calibration buttons.
//   SLOT    the maths, keyed by name.   THIS FILE — calibration, role, and the
//           cursor and camera quaternions the renderer reads. The formulas
//           themselves are pure, in sensor-math.js, which the audit imports.
// A sensor's slot name is `osc-<name>` (mubone instrument, OSC) or
// `ximu3-<serial>` (direct x-imu3). Calibration and role persist per slot
// name in `mubone_sensor_cal`, so a reconnect is the same sensor.
//
// ── Roles ──────────────────────────────────────────────────────────────────
//   cursor   where the hand points: the grain cursor. Alone, the camera
//            follows it (renderer.js cameraFromPointing).
//   camera   a second sensor that PANS and TILTS the view, never rolls it:
//            turn it with the hand still and the view moves while the cursor
//            stays on its spot of the sphere, and can leave the screen. With
//            head-locked panning the sound field turns with it too.
//   listen   a cursor that only HEARS (2026-10-04): it granulates the shared
//            corpus where it points, with cursor 0's lens and grain block, and
//            records, pins, erases and presses nothing. The camera never
//            follows it. Any number of slots may hold it (MULTI_ROLES); the
//            scheduler reads them through readListenerPoses, not the renderer.
//   gesture  the inertial stream (gyro + accel) — seed-morph.js. Assigned to
//            the first sensor that sends one; no menu.
//   frame    a sensor the cursor is read RELATIVE to — on the body, or a
//            lazy-susan surface: turn it with the hand fixed to it and the
//            cursor keeps its spot on the sphere, so sounds are placed and
//            found in the frame's coordinates. Its whole rotation counts
//            (sensor-math.js inFrame). Silent, it stops counting and the
//            cursor is the world one. Deleted 2026-09-27 when camera came in,
//            back 2026-10-04 BESIDE camera (Ek) — RULINGS "frame returns".
// One slot per role, at most — but listen.
// ============================================================================

import { S, DEBUG } from './state.js';
import {
  applyCal, attitude, orientation, panTilt, mountFromPoses, headingAboutZ,
  qMul, qConj, inFrame, DEFAULT_SIGNS,
} from './sensor-math.js';

export const QUAT_ROLES     = ['cursor', 'camera', 'listen', 'frame', 'unmapped'];
export const INERTIAL_ROLES = ['gesture', 'unmapped'];
// Roles any number of slots hold at once: taking one displaces nobody, and
// choosing one drops nobody else's choice.
const MULTI_ROLES = new Set(['listen']);

// ── Slots ───────────────────────────────────────────────────────────────────

function makeSensorSlot(name) {
  return {
    name,
    quatRole:     'unmapped',   // what it does NOW
    wantRole:     null,         // what the player CHOSE — 'cursor' | 'camera' | 'listen' | 'frame' | 'unmapped' (none) | null (never chose). Persisted
    inertialRole: 'unmapped',
    hasQuat:      false,   // true from the first packet of each stream
    hasInertial:  false,

    quat:     null,        // [x, y, z, w] raw, Z-up
    attitude: null,        // { roll, pitch, yaw }° — calibrated, signs applied
    inertial: null,        // { gx, gy, gz, ax, ay, az, gyroMag, accelDynMag }
    // A listener's OWN cursor settings (Ek, 2026-10-04), or null: it follows
    // the cursor's. { reads, radius, mode, depth, k, step, rfade, fadeCurve } —
    // the cursor's scope, reach and grain behaviour, nothing that is a tool's
    // or audition. Persisted with the slot, like its calibration: it is the rig.
    listenCfg: null,

    // output = conj(headingQuat) · q · conj(mountQuat), then the signs —
    // sensor-math.js has why. Mount is setup, heading is performance.
    quatCal: {
      mountQuat:   null,
      headingQuat: null,
      signs:       { ...DEFAULT_SIGNS },
      _pose1:      null,   // scratch between the two mount poses; never persisted
    },

    lastSeenQuat:     0,   // Date.now()
    lastSeenInertial: 0,
  };
}

const _registry = new Map();   // slot name → slot

export function getRegistry() { return _registry; }

export function getOrCreateSlot(name) {
  if (!_registry.has(name)) {
    const slot = makeSensorSlot(name);
    _registry.set(name, slot);   // in the registry FIRST — restoring a role displaces its holder
    applySavedCal(slot);
    DEBUG && console.log(`[sensor-registry] new slot: "${name}"`);
    S._onSensorDiscovered?.(slot);
  }
  return _registry.get(name);
}

// A slot is live while its data arrives — the same 2 s sensors.js's LIVE_MS
// uses for the page. A silent slot keeps its role on screen, but a role it
// holds may be claimed by a sensor that IS playing.
const SLOT_LIVE_MS = 2000;
export function isSlotLive(slot) {
  const t = Math.max(slot?.lastSeenQuat || 0, slot?.lastSeenInertial || 0);
  return !!t && Date.now() - t < SLOT_LIVE_MS;
}

// The slot holding a role, or null.
export function getByRole(role) {
  for (const slot of _registry.values()) {
    if (slot.quatRole === role || slot.inertialRole === role) return slot;
  }
  return null;
}

// ── Roles ───────────────────────────────────────────────────────────────────
// Two things, kept apart (2026-09-27, after two rounds of review):
//   quatRole   what a slot does NOW — runtime, never persisted
//   wantRole   what the player CHOSE on the Sensors page — persisted; 'unmapped'
//              is a choice ("none"), null is no choice
// A chosen role is honoured whenever its sensor is playing: on connect and
// whenever it wakes from silence, it takes the role back from a holder that
// only has it by default or has gone silent — never from another sensor that
// was chosen for it and is playing. A sensor with no choice takes the cursor
// only if nobody playing holds it. Keeping the two in one field is what let a
// default claim overwrite a choice on disk, and a choice steal from a live
// sensor, in the two builds before this one.
//
// Assigning takes a role from whoever held it. _onSensorRoleChanged fires for
// every slot that changed, the one that lost it included — sensors.js repaints
// and blinks from it.

export function assignQuatRole(slotName, role) {
  _assign(slotName, role, 'quatRole', QUAT_ROLES);
}

/** The player chose. The choice is persisted, and anyone else's standing
 *  choice of the same role is dropped — the latest choice is the truth, on
 *  disk too, so two sensors never boot both wanting the cursor. */
export function chooseQuatRole(slotName, role) {
  if (!QUAT_ROLES.includes(role)) return;
  const slot = _registry.get(slotName);
  if (!slot) return;
  if (role !== 'unmapped' && !MULTI_ROLES.has(role)) {
    for (const other of _registry.values()) if (other !== slot && other.wantRole === role) other.wantRole = null;
    loadSavedCal();
    for (const [name, saved] of Object.entries(_savedCal || {})) if (name !== slotName && saved?.role === role) saved.role = null;
  }
  slot.wantRole = role;
  assignQuatRole(slotName, role);   // saves
}

/** Honour a slot's choice, if it has one: see the note above. Called when a
 *  slot is created and whenever its sensor wakes from silence. */
export function settleRole(slot) {
  const want = slot?.wantRole;
  if (!want || slot.quatRole === want) return;
  if (want === 'unmapped' || MULTI_ROLES.has(want)) { assignQuatRole(slot.name, want); return; }
  const h = getByRole(want);
  if (!h || !isSlotLive(h) || h.wantRole !== want) assignQuatRole(slot.name, want);
}

function assignInertialRole(slotName, role) {
  _assign(slotName, role, 'inertialRole', INERTIAL_ROLES);
}

function _assign(slotName, role, field, allowed) {
  if (!allowed.includes(role)) return;
  if (role !== 'unmapped' && !MULTI_ROLES.has(role)) {
    for (const slot of _registry.values()) {
      if (slot.name !== slotName && slot[field] === role) {
        slot[field] = 'unmapped';
        S._onSensorRoleChanged?.(slot);
      }
    }
  }
  const slot = _registry.get(slotName);
  if (!slot) return;
  slot[field] = role;
  DEBUG && console.log(`[sensor-registry] "${slotName}" ${field} → ${role}`);
  S._onSensorRoleChanged?.(slot);
  saveCalibration();
}

// ── Incoming data ───────────────────────────────────────────────────────────

export function handleSlotQuaternion(slot, values) {
  if (values.length < 4) return;
  const waking = !isSlotLive(slot);   // first packet, or back from silence
  slot.quat = [values[0], values[1], values[2], values[3]];
  slot.lastSeenQuat = Date.now();
  if (waking) settleRole(slot);
  if (!slot.hasQuat) {
    slot.hasQuat = true;
    S._onSensorFirstQuat?.();   // a persisted sensor camera waits for this (main.js)
  }
  slot.attitude = attitude(slot.quat, slot.quatCal);
  // Drives the cursor at sensor rate (up to 400 Hz) rather than the render
  // loop's, so the paint ticker reads a fresh position (main.js).
  if (slot.quatRole === 'cursor') S._onCursorQuatArrival?.();
}

export function handleSlotInertial(slot, values) {
  if (values.length < 6) return;
  const [gx, gy, gz, ax, ay, az] = values;
  const gyroMag     = Math.sqrt(gx*gx + gy*gy + gz*gz);
  const accelDynMag = Math.max(0, Math.sqrt(ax*ax + ay*ay + az*az) - 1);   // |a| − 1 g
  slot.inertial = { gx, gy, gz, ax, ay, az, gyroMag, accelDynMag };
  slot.lastSeenInertial = Date.now();
  if (!slot.hasInertial) {
    slot.hasInertial = true;
    if (slot.inertialRole === 'unmapped' && !getByRole('gesture')) assignInertialRole(slot.name, 'gesture');
  }
}

// ── What the renderer reads ─────────────────────────────────────────────────
// The whole sensor → screen contract, in one call (renderer.js
// applySensorPose is the only reader):
//   cursorQ  the cursor sensor's orientation on the sphere, or null — read
//            in the frame sensor's coordinates while one is LIVE (inFrame);
//            a frame gone silent drops out, it does not freeze the cursor
//   framed   true when it was
//   cameraQ  conj(pan-tilt) of the camera sensor, or null. Conjugated because
//            cameraTransform applies it directly where it conjugates camQ;
//            without it the camera sensor gimbal-locks (pitch→roll at 90° yaw)
//            while the cursor does not — tested and verified Mar 28. DO NOT
//            REMOVE, or change it without sphere.js cameraTransform.
export function readSensorPose() {
  const cur = getByRole('cursor');
  const cam = getByRole('camera');
  const frm = getByRole('frame');
  const frameQ  = frm?.quat && isSlotLive(frm) ? orientation(frm.quat, frm.quatCal) : null;
  const cursorQ = cur?.quat ? inFrame(orientation(cur.quat, cur.quatCal), frameQ) : null;
  const cameraQ = cam?.quat ? qConj(panTilt(orientation(cam.quat, cam.quatCal))) : null;
  return { cursorQ, cameraQ, framed: !!(cursorQ && frameQ) };
}

// The LISTENERS, for the grain scheduler (grain.js _scheduleListeners) — read
// there at 100 Hz rather than through the renderer, so a listener granulates
// on the scheduler's clock even when frames are late. Fills `out` with
// { name, lon, lat } (reused objects) and returns how many. A listener whose
// sensor has gone silent (isSlotLive) is not read: its grains drop out, and a
// frozen pose never keeps sounding. The direction is cursor 0's formula
// (sphere.js getCursorLonLat) without cursor 0's axis locks, which are its own.
export function readListenerPoses(out, max) {
  let n = 0;
  for (const slot of _registry.values()) {
    if (n >= max) break;
    if (slot.quatRole !== 'listen' || !slot.quat || !isSlotLive(slot)) continue;
    const [x, y, z, w] = orientation(slot.quat, slot.quatCal);
    // forward = q · (0, 0, 1) · q*
    const fx = 2 * (x * z + w * y), fy = 2 * (y * z - w * x), fz = 1 - 2 * (x * x + y * y);
    const e = out[n] || (out[n] = { name: '', lon: 0, lat: 0 });
    e.name = slot.name;
    e.lon  = Math.atan2(fx, fz);
    e.lat  = Math.asin(Math.max(-1, Math.min(1, fy)));
    n++;
  }
  return n;
}

// ── A listener's own cursor settings ────────────────────────────────────────
// null is "follows the cursor". Turning own settings on COPIES the cursor's
// as they stand (Ek: "copy"), so nothing jumps; from then the listener's rows
// write here. The keys are tiles.js's lens pids (LISTEN_KEYS there).
export function listenCfgOf(slotName) { return _registry.get(slotName)?.listenCfg ?? null; }
export function setListenOwn(slotName, snapshot) {
  const slot = _registry.get(slotName);
  if (!slot) return;
  slot.listenCfg = snapshot ? { ...snapshot } : null;
  saveCalibration();
}
export function setListenParam(slotName, key, value) {
  const c = _registry.get(slotName)?.listenCfg;
  if (!c) return;
  c[key] = value;
  saveCalibration();
}

// ── Calibration gestures ────────────────────────────────────────────────────
// Two, and only two. MOUNT is setup — once per strap, two poses (neutral and
// forward, then pointing down), because one pose cannot tell the strap's own
// twist from the performer's heading. HEADING is performance — face the
// stage, as often as you like; it cannot disturb the mount.

// Pose 1 — stashed until pose 2 arrives; an abandoned run changes nothing.
export function captureMountPose1(slot, quat = null) {
  const q = quat || slot?.quat;
  if (!q) return null;
  slot.quatCal._pose1 = q.slice();
  return slot.quatCal._pose1;
}

// Pose 2 — completes the mount, or returns null if the poses cannot define one.
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

// Re-derives H only; the mount survives. The attitude's yaw reads 0 the instant after.
export function captureHeading(slot) {
  if (!slot?.quat) return null;
  const turned = slot.quatCal.mountQuat ? qMul(slot.quat, qConj(slot.quatCal.mountQuat)) : slot.quat;
  slot.quatCal.headingQuat = headingAboutZ(turned);
  saveCalibration();
  return slot.quatCal.headingQuat;
}

export function clearMount(slot) {
  if (!slot) return;
  slot.quatCal.mountQuat = null;
  saveCalibration();
}

// The polarity buttons: flip one of roll / pitch / yaw. Returns the new sign.
export function flipSign(slot, axis) {
  const s = slot.quatCal.signs;
  s[axis] = -s[axis];
  saveCalibration();
  return s[axis];
}

// ── Persistence: `mubone_sensor_cal` ────────────────────────────────────────
// { [slotName]: { quatRole, inertialRole, quatCal: { mountQuat, headingQuat,
// signs } } }. The ONE place a sensor's calibration and role live. Keep it in
// the settings export — its omission silently rewrote roles once already
// (docs/archive/EXPORT-IMPORT-AUDIT-2026-07.md).

const LS_KEY = 'mubone_sensor_cal';
let _restoring = false;          // true while applying saved cal — no re-saves
let _savedCal = null;
let _savedCalLoaded = false;     // distinct from "loaded and empty"

function slotToJSON(slot) {
  return {
    role:         slot.wantRole,
    listenCfg:    slot.listenCfg,
    inertialRole: slot.inertialRole,
    quatCal: {
      mountQuat:   slot.quatCal.mountQuat,
      headingQuat: slot.quatCal.headingQuat,
      signs:       slot.quatCal.signs,
    },
  };
}

export function saveCalibration() {
  if (_restoring) return;
  // MERGE, never replace: a slot the registry has not met this session keeps
  // what is on disk. Serialising the registry wholesale erased the calibration
  // of any sensor whose first packet beat initSensor() (2026-08-31).
  loadSavedCal();
  const data = { ..._savedCal };
  for (const [name, slot] of _registry) data[name] = slotToJSON(slot);
  _savedCal = data;
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (_) {}
}

function loadSavedCal() {
  if (_savedCalLoaded) return;
  _savedCalLoaded = true;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) _savedCal = JSON.parse(raw);
  } catch (_) { _savedCal = null; }
  _migrateAxisMaps();
}

// ONE-SHOT, 2026-09-27: the per-axis map { x: { viz, sign, mute }, … } became
// three signs, and the persisted role became the player's choice (`role`); the viz of each physical axis was fixed (x roll, y pitch,
// z yaw) and mute unsettable since 2026-09-01. Rewrites the stored table once,
// then finds nothing to do. Delete once the rig has booted on it.
function _migrateAxisMaps() {
  if (!_savedCal) return;
  let changed = false;
  for (const saved of Object.values(_savedCal)) {
    const map = saved?.quatCal?.axisMap;
    if (saved?.inertialCal) { delete saved.inertialCal; changed = true; }
    // quatRole was the persisted role until 2026-09-27; it is the choice now.
    if (saved && 'quatRole' in saved) { if (!('role' in saved)) saved.role = saved.quatRole; delete saved.quatRole; changed = true; }
    if (!map) continue;
    const signs = { ...DEFAULT_SIGNS };
    for (const a of Object.values(map)) if (a && a.viz in signs) signs[a.viz] = a.sign < 0 ? -1 : 1;
    saved.quatCal.signs = signs;
    delete saved.quatCal.axisMap;
    changed = true;
  }
  if (changed) try { localStorage.setItem(LS_KEY, JSON.stringify(_savedCal)); } catch (_) {}
}

// Prime a NEW slot from disk. Lazy, in case a first packet beats initSensor().
function applySavedCal(slot) {
  loadSavedCal();
  const saved = _savedCal?.[slot.name];
  if (!saved) return;
  const c = saved.quatCal;
  if (c?.mountQuat)   slot.quatCal.mountQuat   = c.mountQuat;
  if (c?.headingQuat) slot.quatCal.headingQuat = c.headingQuat;
  if (c?.signs)       slot.quatCal.signs       = { ...DEFAULT_SIGNS, ...c.signs };
  // The choice comes back, and is honoured by the rule in the Roles note.
  if (QUAT_ROLES.includes(saved.role)) slot.wantRole = saved.role;
  if (saved.listenCfg && typeof saved.listenCfg === 'object') slot.listenCfg = { ...saved.listenCfg };
  _restoring = true;
  settleRole(slot);
  const h = saved.inertialRole && saved.inertialRole !== 'unmapped' ? getByRole(saved.inertialRole) : null;
  if (saved.inertialRole && saved.inertialRole !== 'unmapped' && (!h || !isSlotLive(h))) assignInertialRole(slot.name, saved.inertialRole);
  _restoring = false;
}

// Forget ONE slot, live and saved. Saves merge, so a slot that stops existing
// is otherwise kept for good — and its saved role is a claim on the next boot
// (the align audit's `__rt10__` held the cursor in Ek's storage, 2026-09-09).
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

export function initSensor() {
  loadSavedCal();
}
