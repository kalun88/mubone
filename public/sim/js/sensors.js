// ============================================================================
// sensors.js — the SENSOR layer: every connected sensor, whatever its kind
//
// The middle of three layers (sensor-registry.js's header has the map):
//   LINK    sygaldry.js · ximu3.js · osc.js — how packets arrive
//   SENSOR  THIS FILE — one entry per row on the Sensors page
//   SLOT    sensor-registry.js — calibration, role, the maths
//
// A Sensor is keyed by `sn`: the x-imu3's serial number, or `osc-<name>` for
// anything arriving as /sensor/{name}/… (the mubone instrument, a relay, any
// OSC sender). Its slot is `slotName` — `ximu3-<sn>` or the same `osc-<name>`.
// Everything that says "connected" — the header pill, S.rig, the list's badge —
// reads `live`: a packet within LIVE_MS (Ek, 2026-09-09: a pulled cable closes
// nothing on our side, so presence IS packets arriving).
//
// What happens when a sensor appears:
//   1. its link creates the Sensor (addSensor) — an OSC one on its first packet
//   2. startFeeding → claimRole: the slot's saved role, or the cursor if nobody
//      holds it, or nothing. (Every sensor used to default to 'cursor', so the
//      LAST to connect stole it from the one playing — 2026-09-27.)
//   3. every packet: the link fills rawQuat and calls feed() → the slot.
// The ROLE lives in the slot, saved in `mubone_sensor_cal`, and `dev.role`
// reads it — one store (a second copy in `mubone-sensor-prefs` could disagree
// with it; retired 2026-09-27).
// ============================================================================

import { S, DEBUG } from './state.js';
import {
  QUAT_ROLES, getRegistry, getOrCreateSlot, getByRole, assignQuatRole, chooseQuatRole, settleRole, forgetSlot, isSlotLive,
  handleSlotQuaternion, handleSlotInertial,
  captureMountPose1 as regMountPose1, captureMountPose2 as regMountPose2,
  cancelMountCapture as regCancelMount, captureHeading as regCaptureHeading,
  clearMount as regClearMount, flipSign,
} from './sensor-registry.js';
import { quatToEulerDeg, DEFAULT_SIGNS } from './sensor-math.js';

// ── The Sensor ──────────────────────────────────────────────────────────────

export class Sensor {
  constructor(sn, name, { transport = 'osc', kind } = {}) {
    this.sn   = sn;
    this.name = name;
    // How it is reached: 'udp' | 'serial' | 'osc'. A mubone instrument is
    // filed under 'osc' whatever its wire, and `via` carries the real one.
    this.transport = transport;
    // What it IS — nothing on the wire says, so its link declares it
    // (declareSensorKind): 'x-imu3', 'mubone', or 'osc' for anything else.
    this.kind = kind || (transport === 'osc' ? 'osc' : 'x-imu3');
    this.via  = null;   // 'wifi' | 'cable' when 'osc' would be a lie

    this.slotName = transport === 'osc' ? sn : `ximu3-${sn}`;
    this.feeding  = false;   // packets reach the slot

    this.rawQuat     = { x: 0, y: 0, z: 0, w: 1 };           // set through setQuat only
    this.rawEuler    = { roll: 0, pitch: 0, yaw: 0 };        // the Sensors page's raw readout
    this.lastMsgType = null;
    this.lastSeenAt  = 0;       // OUR clock (Date.now()) — never the device's own
    this.live        = false;
  }

  // The slot's role — the one store. 'unmapped' before the first feed.
  get role() { return getRegistry().get(this.slotName)?.quatRole ?? 'unmapped'; }

  // Every link stores a quaternion through here. Replaced whole, never field
  // by field: four writes leave a seam an async reader can sample as a pose
  // nothing measured (1°+ spikes on a still sensor, 2026-08-31). rawEuler is
  // named roll/pitch/yaw because the page reads those names — it was filled
  // as {x, y, z} for a quaternion, so the raw column showed "—" for every
  // sensor not in the x-imu3's Euler debug mode (2026-09-27).
  setQuat(x, y, z, w) {
    this.rawQuat = { x, y, z, w };
    const e = quatToEulerDeg(x, y, z, w);
    this.rawEuler = { roll: e.x, pitch: e.y, yaw: e.z };
  }
}

const _sensors = new Map();   // sn → Sensor

export function getSensors()   { return _sensors; }
export function getSensor(sn)  { return _sensors.get(sn); }

// ── Callbacks (the Sensors page) ────────────────────────────────────────────

let _onUpdated = null;   // identity, liveness or role changed — repaint
let _onData    = null;   // a packet arrived — the page counts rates
export function setOnDeviceUpdated(cb) { _onUpdated = cb; }
export function setOnDataReceived(cb)  { _onData = cb; }
export function notifyUpdated(dev)     { _onUpdated?.(dev); }
export function notifyData(dev)        { _onData?.(dev); }

// Role changes, for a link that shows them on the hardware (ximu3.js blinks
// the unit that just became the cursor).
const _roleListeners = new Set();
export function onRoleChanged(fn) { _roleListeners.add(fn); }

// ── Lifecycle ───────────────────────────────────────────────────────────────

export function addSensor(dev) {
  _sensors.set(dev.sn, dev);
  syncSensorStatus();
  return dev;
}

// Drop the row. The slot — mount, heading, the player's CHOSEN role — is
// kept, so a reconnect is the same sensor; forgetOscSensor is the verb that
// erases. What it is doing NOW is let go: a disconnected cursor or camera
// sensor must not keep steering the screen with its last pose (2026-09-27).
export function removeSensor(sn) {
  const dev = _sensors.get(sn);
  if (!dev) return null;
  dev.feeding = false;
  if (getRegistry().get(dev.slotName)?.quatRole !== 'unmapped') assignQuatRole(dev.slotName, 'unmapped');
  _sensors.delete(sn);
  _onUpdated?.(dev);
  syncSensorStatus();
  return dev;
}

// A serial x-imu3 is keyed on its tty path until it answers with its serial
// number; then it becomes itself.
export function rekeySensor(dev, sn) {
  // The same unit already connected another way (wifi and a cable at once):
  // keep the one that is there. Taking its key orphaned it — its transport
  // stayed open and nothing could disconnect it.
  const other = _sensors.get(sn);
  if (other && other !== dev) {
    console.warn(`[sensors] ${sn} is already connected (${other.transport}); this ${dev.transport} link will not feed`);
    return false;
  }
  _sensors.delete(dev.sn);
  dev.sn = sn;
  dev.slotName = `ximu3-${sn}`;
  _sensors.set(sn, dev);
  _onUpdated?.(dev);
  syncSensorStatus();
  return true;
}

// Start sending this sensor's packets to its slot, and give it a role.
export function startFeeding(dev) {
  dev.feeding = true;
  if (dev._roleOnKey) { const r = dev._roleOnKey; dev._roleOnKey = null; setRole(dev, r); }
  else _claimRole(dev);
  syncSensorStatus();
}

// A sensor's CHOICE (sensor-registry.js, the Roles note) is honoured as its
// slot is made. With no choice it takes the cursor if nobody playing holds it
// — nobody, or a holder gone silent (a pulled or flat cursor sensor used to
// keep the role, and every replacement came up with none).
function _claimRole(dev) {
  const slot = getOrCreateSlot(dev.slotName);   // a NEW slot restores and settles its choice…
  settleRole(slot);                             // …an existing one (a reconnect) settles here
  if (slot.wantRole != null || slot.quatRole !== 'unmapped') return;
  const holder = getByRole('cursor');
  if (!holder || !isSlotLive(holder)) assignQuatRole(dev.slotName, 'cursor');
}

// The role menu and the list's Cursor button — the player's CHOICE. Feeding is
// implied by having a role (Ek, 2026-09-01: "when you've selected the drop
// down it should just work"). A serial x-imu3 still keyed on its tty path
// waits: a slot minted under the temporary name would keep the role after the
// unit is renamed (ximu3.js hands it over at startFeeding).
export function setRole(dev, role) {
  if (!QUAT_ROLES.includes(role)) return;
  if (dev.pendingKey) { dev._roleOnKey = role; return; }
  dev.feeding = true;
  getOrCreateSlot(dev.slotName);
  chooseQuatRole(dev.slotName, role);
}

// The link calls this for every quaternion it has stored in dev.rawQuat.
export function feed(dev) {
  // Quaternion and Euler lines only. An accessory ('S') or stray line used to
  // feed the identity pose before the first real one — a fake pose that also
  // switched a deferred sensor camera on and kept the slot "live".
  if (!dev.feeding || (dev.lastMsgType !== 'Q' && dev.lastMsgType !== 'A')) return;
  const q = dev.rawQuat;
  handleSlotQuaternion(getOrCreateSlot(dev.slotName), [q.x, q.y, q.z, q.w]);
}

// ── OSC intake: /sensor/{name}/quaternion and /inertial (osc.js) ────────────
// An OSC sensor registers itself on its first packet and always feeds.

function _oscSensor(name) {
  let dev = _sensors.get('osc-' + name);
  if (dev) return dev;
  dev = addSensor(new Sensor('osc-' + name, name, { transport: 'osc' }));
  startFeeding(dev);
  _onUpdated?.(dev);
  DEBUG && console.log(`[sensors] OSC sensor discovered: ${name} (role: ${dev.role})`);
  return dev;
}

export function handleOSCSensorQuaternion(name, values) {
  const dev = _oscSensor(name);
  dev.setQuat(values[0], values[1], values[2], values[3]);   // wire order [qx, qy, qz, qw]
  dev.lastMsgType = 'Q';
  stampSeen(dev);
  _onData?.(dev);
  feed(dev);
}

// Inertial goes to the slot as is — gyro and accel need no calibration. Its
// one reader is seed-morph.js, through the gesture role.
export function handleOSCSensorInertial(name, values) {
  const dev = _oscSensor(name);
  dev.lastMsgType = 'I';
  stampSeen(dev);   // a peer sending only /inertial is as connected as any
  _onData?.(dev);
  if (dev.feeding) handleSlotInertial(getOrCreateSlot(dev.slotName), values);
}

// The link that owns an OSC sensor says what it is, once it knows:
// sygaldry.js declares the mubone instrument and its wire. Without it a
// first-party instrument on a USB cable was listed as "x-imu3 · osc".
export function declareSensorKind(name, kind, via = null) {
  const dev = _sensors.get('osc-' + name);
  if (!dev) return null;
  if (dev.kind === kind && dev.via === via) return dev;
  dev.kind = kind;
  dev.via  = via;
  _onUpdated?.(dev);
  syncSensorStatus();   // the pill's wire word derives from it
  return dev;
}

// Forget an OSC sensor entirely: the row, its slot, its calibration and role.
// A name seen once was otherwise kept for good (the align audit's `__rt10__`).
export function forgetOscSensor(name) {
  const sn = 'osc-' + name;
  const dev = removeSensor(sn);
  forgetSlot(sn);
  return !!dev;
}

// ── Calibration, as the Sensors page asks for it ────────────────────────────
// Thin: the registry owns the maths. Each returns null while the sensor is
// not feeding (the page prints "—").

function _slotFor(dev) {
  return dev?.feeding ? getOrCreateSlot(dev.slotName) : null;
}

export function slotQuat(dev)          { return _slotFor(dev)?.quat || null; }   // the page's stillness check
export function captureMountPose1(dev, quat = null) { const s = _slotFor(dev); return s ? regMountPose1(s, quat) : null; }
export function captureMountPose2(dev, quat = null) { const s = _slotFor(dev); return s ? regMountPose2(s, quat) : null; }
export function cancelMountCapture(dev) { const s = _slotFor(dev); if (s) regCancelMount(s); }
export function captureHeading(dev)     { const s = _slotFor(dev); return s ? regCaptureHeading(s) : null; }
export function clearMountCal(dev)      { const s = _slotFor(dev); if (s) regClearMount(s); }
export function hasMountCal(dev)        { return !!_slotFor(dev)?.quatCal?.mountQuat; }
export function getCalibratedEuler(dev) { return _slotFor(dev)?.attitude ?? null; }
export function getPolarity(dev, axis)  { return _slotFor(dev)?.quatCal.signs[axis] ?? DEFAULT_SIGNS[axis]; }
export function togglePolarity(dev, axis) {
  const s = _slotFor(dev);
  return s ? flipSign(s, axis) : DEFAULT_SIGNS[axis];
}

// Zero heading for every sensor holding a role — "face the audience" is true
// of all of them, and a camera sensor drifts apart from the cursor on its own
// (the cursor sat 25° off after a cursor-only zero, 2026-09-27). Returns the
// sensors zeroed.
export function zeroAllHeadings() {
  const done = [];
  for (const dev of _sensors.values()) {
    // Live only: zeroing a silent sensor would zero it against its last,
    // stale pose. And only what actually zeroed counts toward the ✓.
    if (!dev.feeding || !dev.live || dev.role === 'unmapped') continue;
    if (captureHeading(dev)) done.push(dev);
  }
  return done;
}

// ── Liveness ────────────────────────────────────────────────────────────────
// UP while a packet arrived within LIVE_MS, on our clock. Two seconds is clear
// of the slowest stream that matters, and short enough that a pulled cable is
// seen before anyone finishes looking. Rising edge at the packet; falling
// edge on the tick.

export const LIVE_MS = 2000;
function _isLive(dev) { return !!dev.lastSeenAt && (Date.now() - dev.lastSeenAt) < LIVE_MS; }

export function stampSeen(dev) {
  dev.lastSeenAt = Date.now();
  if (!dev.live) { dev.live = true; _onUpdated?.(dev); syncSensorStatus(); }
}

function _liveTick() {
  let changed = false;
  for (const dev of _sensors.values()) {
    const now = _isLive(dev);
    if (now === dev.live) continue;
    dev.live = now; changed = true;
    _onUpdated?.(dev);
  }
  if (changed) syncSensorStatus();
}

// ── The `sensor-status` event ───────────────────────────────────────────────
// The rest of the app (main.js: the header pill, S.rig) hears about sensors
// only through this. `found` is sensors announcing but not connected — the
// x-imu3's wifi discovery, which ximu3.js counts (setFoundCounter).

let _found = () => 0;
export function setFoundCounter(fn) { _found = fn; }

export function syncSensorStatus() {
  const devs = [..._sensors.values()];
  const live = devs.filter(d => d.live);
  const transports = new Set();
  for (const d of live) {
    // `via` first: an instrument on wifi is a wifi sensor, and OSC is the rare
    // case, not the default answer (Ek).
    const wire = d.via === 'cable' ? 'serial' : (d.via || d.transport);
    if (wire === 'serial') transports.add('serial');
    else if (wire === 'udp' || wire === 'wifi') transports.add('wifi');
    else if (wire === 'osc') transports.add('osc');
  }
  window.dispatchEvent(new CustomEvent('sensor-status', {
    detail: {
      connected:  live.length > 0,
      feeding:    live.some(d => d.feeding),
      found:      _found(),
      count:      live.length,
      transports: [...transports],
      devices: devs.map(d => ({
        sn: d.sn, name: d.name, slotName: d.slotName, role: d.role,
        feeding: d.feeding, live: d.live, transport: d.transport, via: d.via || null,
      })),
    },
  }));
}

// ── Init ────────────────────────────────────────────────────────────────────

export function initSensors() {
  // Every role change, the one that lost a role included: repaint, and let
  // the links show it.
  S._onSensorRoleChanged = (slot) => {
    for (const dev of _sensors.values()) {
      if (dev.slotName !== slot.name) continue;
      for (const fn of _roleListeners) fn(dev);
      _onUpdated?.(dev);
      break;
    }
    syncSensorStatus();
  };
  setInterval(_liveTick, 500);
}
