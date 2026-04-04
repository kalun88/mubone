// ============================================================================
// imu-setup.js — x-IMU3 direct connection & full sensor calibration
//
// This module replaces the sensor panel's calibration role for x-IMU3 devices.
// It owns: device discovery, connection (WiFi UDP or serial), hardware config
// (axes alignment), and software calibration (tare, polarity).
//
// Output: pre-calibrated quaternion → sensor-registry (role assignment only).
// The sensor-registry slot is set to identity calibration so it passes through.
//
// Protocol reference: x-IMU3 User Manual v1.11, sections 8–11.
// ============================================================================

import { S, DEBUG } from './state.js';
// quaternion helpers no longer needed — tare is now Euler-space
import {
  getOrCreateSlot, handleSlotQuaternion, handleSlotInertial, assignQuatRole,
} from './sensor-registry.js';

// ── Axes alignment table ────────────────────────────────────────────────────
// From x-IMU3 User Manual Table 42.  Each entry: [value, label, description].
//
// Mental model (NWU, always):
//   Look at sensor on body.  Which hardware arrow points North? West? Up?
//   Write them down with signs → that's the alignment string.

export const AXES_ALIGNMENTS = [
  [0,  '+X+Y+Z', 'default — silkscreen matches body'],
  [1,  '+X-Z+Y', ''],
  [2,  '+X-Y-Z', ''],
  [3,  '+X+Z-Y', ''],
  [4,  '-X+Y-Z', ''],
  [5,  '-X+Z+Y', ''],
  [6,  '-X-Y+Z', ''],
  [7,  '-X-Z-Y', ''],
  [8,  '+Y-X+Z', ''],
  [9,  '+Y-Z-X', ''],
  [10, '+Y+X-Z', ''],
  [11, '+Y+Z+X', ''],
  [12, '-Y+X+Z', ''],
  [13, '-Y-Z+X', ''],
  [14, '-Y-X-Z', ''],
  [15, '-Y+Z-X', ''],
  [16, '+Z+Y-X', 'X down, Z forward'],
  [17, '+Z+X+Y', ''],
  [18, '+Z-Y+X', ''],
  [19, '+Z-X-Y', ''],
  [20, '-Z+Y+X', 'X up, -Z forward (back of head)'],
  [21, '-Z-X+Y', ''],
  [22, '-Z-Y-X', ''],
  [23, '-Z+X-Y', ''],
];

// ── Quaternion → Euler (ZYX Tait-Bryan, degrees) ────────────────────────────
// Duplicated here so imu-setup is self-contained.  [x, y, z, w] convention.

function quatToEulerDeg(qx, qy, qz, qw) {
  const roll  = Math.atan2(2 * (qw * qx + qy * qz), 1 - 2 * (qx * qx + qy * qy)) * (180 / Math.PI);
  const sinp  = 2 * (qw * qy - qz * qx);
  const pitch = (Math.abs(sinp) >= 1
    ? Math.sign(sinp) * 90
    : Math.asin(sinp) * (180 / Math.PI));
  const yaw   = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz)) * (180 / Math.PI);
  return { roll, pitch, yaw };
}

// ── Euler (degrees) → Quaternion [x, y, z, w] ──────────────────────────────
// ZYX order (yaw first, then pitch, then roll) to match the decomposition above.

function eulerDegToQuat(rollDeg, pitchDeg, yawDeg) {
  const r = rollDeg  * (Math.PI / 360);  // half-angle
  const p = pitchDeg * (Math.PI / 360);
  const y = yawDeg   * (Math.PI / 360);
  const cr = Math.cos(r), sr = Math.sin(r);
  const cp = Math.cos(p), sp = Math.sin(p);
  const cy = Math.cos(y), sy = Math.sin(y);
  return [
    sr * cp * cy - cr * sp * sy,  // x
    cr * sp * cy + sr * cp * sy,  // y
    cr * cp * sy - sr * sp * cy,  // z
    cr * cp * cy + sr * sp * sy,  // w
  ];
}


// ── Per-device state ────────────────────────────────────────────────────────
// Each connected device has its own calibration.  Keyed by serial number.

class DeviceState {
  constructor(sn, name, { transport, ip, send, receive, serialPath }) {
    this.sn      = sn;
    this.name    = name;

    // Transport: 'udp', 'serial', or 'osc'
    this.transport  = transport || 'udp';

    // UDP-specific
    this.ip      = ip || null;
    this.send    = send || 0;     // port device sends data TO (we listen here)
    this.receive = receive || 0;  // port device listens ON (we send commands here)

    // Serial-specific
    this.serialPath = serialPath || null;

    // Hardware config (stored on the device)
    this.axesAlignment = 0;

    // Software calibration (local to this session)
    // Tare stored as Euler offsets (degrees) — subtracted in Euler space to avoid
    // quaternion cross-coupling (full-quat tare causes roll drift when yawing
    // with an off-kilter mount).
    this.tareEuler = null;   // { pitch, yaw } or null = no tare
    this.polarity = { roll: 1, pitch: 1, yaw: 1 };  // 1 or -1 per axis
    this.rollMute = false;  // when true, roll is zeroed before feeding to sphere
    // Convention note: x-IMU3 outputs NWU (X=West, Y=North, Z=Up).
    // The sphere expects right-handed graphics coords (X=right, Y=up, Z=forward).
    // For default x-IMU3 orientation, flip X and Z polarity to correct the mismatch.

    // Latest raw data from this device
    this.rawQuat  = { w: 1, x: 0, y: 0, z: 0 };
    this.rawEuler = { roll: 0, pitch: 0, yaw: 0 };
    this.rawInertial = { gx: 0, gy: 0, gz: 0, ax: 0, ay: 0, az: 0 };
    this.lastMsgType = null;
    this.lastTimestamp = 0;

    // Registry integration
    // OSC devices keep their original slot name (e.g. 'wand', 'cursor')
    // so legacy Max patches continue to work
    this.slotName   = transport === 'osc' ? sn : `ximu3-${sn}`;
    this.role       = 'cursor';     // default role — user can change
    this.feeding    = false;        // whether data is being pushed to registry
  }

  // Calibrated Euler: tare + polarity applied (Euler-space tare)
  getCalibratedEuler() {
    const e = quatToEulerDeg(this.rawQuat.x, this.rawQuat.y, this.rawQuat.z, this.rawQuat.w);

    let roll  = e.roll;
    let pitch = e.pitch;
    let yaw   = e.yaw;

    // Euler-space tare: subtract pitch and yaw offsets directly.
    // Roll stays gravity-referenced — no cross-coupling when yawing off-kilter.
    if (this.tareEuler) {
      pitch -= this.tareEuler.pitch;
      yaw   -= this.tareEuler.yaw;
      // Wrap yaw to [-180, 180]
      if (yaw >  180) yaw -= 360;
      if (yaw < -180) yaw += 360;
    }

    return {
      roll:  roll  * this.polarity.roll,
      pitch: pitch * this.polarity.pitch,
      yaw:   yaw   * this.polarity.yaw,
    };
  }

  // Calibrated quaternion: tare + polarity + roll mute applied (for feeding to registry)
  getCalibratedQuat() {
    const e = quatToEulerDeg(this.rawQuat.x, this.rawQuat.y, this.rawQuat.z, this.rawQuat.w);

    let roll  = e.roll;
    let pitch = e.pitch;
    let yaw   = e.yaw;

    // Euler-space tare
    if (this.tareEuler) {
      pitch -= this.tareEuler.pitch;
      yaw   -= this.tareEuler.yaw;
      if (yaw >  180) yaw -= 360;
      if (yaw < -180) yaw += 360;
    }

    // Polarity + roll mute
    roll  = this.rollMute ? 0 : roll * this.polarity.roll;
    pitch = pitch * this.polarity.pitch;
    yaw   = yaw   * this.polarity.yaw;

    // Clamp pitch away from exact ±90° to prevent Euler singularity (gimbal lock).
    // At the pole, yaw becomes undefined and the cursor twirls. Clamping to ±89.5°
    // keeps the quaternion recomposition stable while being visually imperceptible.
    const POLE_CLAMP = 89.5;
    pitch = Math.max(-POLE_CLAMP, Math.min(POLE_CLAMP, pitch));

    return eulerDegToQuat(roll, pitch, yaw);
  }
}


// ── Global state ────────────────────────────────────────────────────────────

// Discovered x-IMU3 devices via WiFi, keyed by serial number.
// Each entry: { name, sn, ip, port, send, receive, battery, status, rssi, lastSeen }
const _discovered = new Map();

// Available serial ports (refreshed on scan).
// Each entry: { path, manufacturer, serialNumber, vendorId, productId }
let _serialPortList = [];

// Connected devices, keyed by serial number (both UDP and serial).
const _devices = new Map();

// Reverse lookup: serial port path → DeviceState  (for routing serial data)
const _serialPathToDevice = new Map();

// Callbacks for UI updates
let _onDeviceDiscovered = null;
let _onSerialPortsChanged = null;
let _onDeviceUpdated    = null;   // fired when a device's identity changes (SN re-key)
let _onDataReceived     = null;
let _onCommandResponse  = null;

// ── Public API ──────────────────────────────────────────────────────────────

export function getDiscovered()       { return _discovered; }
export function getSerialPorts()      { return _serialPortList; }
export function getDevices()          { return _devices; }
export function getDevice(sn)         { return _devices.get(sn); }

export function setOnDeviceDiscovered(cb)  { _onDeviceDiscovered = cb; }
export function setOnSerialPortsChanged(cb){ _onSerialPortsChanged = cb; }
export function setOnDeviceUpdated(cb)     { _onDeviceUpdated = cb; }
export function setOnDataReceived(cb)      { _onDataReceived = cb; }
export function setOnCommandResponse(cb)   { _onCommandResponse = cb; }

// ── Init (called once from main.js) ─────────────────────────────────────────

export function initIMUSetup() {
  const bridge = window.electronBridge;
  if (!bridge?.isElectron) {
    DEBUG && console.log('[imu-setup] not in Electron — x-IMU3 direct UDP unavailable');
    return;
  }

  // Listen for discovery broadcasts
  bridge.onXIMU3Discovery((json) => {
    const sn = json.sn;
    if (!sn) return;
    const entry = {
      name:     json.name || 'x-IMU3',
      sn,
      ip:       json._sourceIP || json.ip,
      port:     json.port,
      send:     json.send,
      receive:  json.receive,
      battery:  json.battery,
      status:   json.status,
      rssi:     json.rssi,
      lastSeen: Date.now(),
    };
    _discovered.set(sn, entry);
    // Update connection info if already connected (IP/port may change)
    const dev = _devices.get(sn);
    if (dev) {
      dev.ip = entry.ip;
      dev.send = entry.send;
      dev.receive = entry.receive;
    }
    _onDeviceDiscovered?.(entry);
  });

  // Listen for data messages
  bridge.onXIMU3Data((line) => {
    // Route to the first connected device for now.
    // TODO: when multiple devices share a port, use source IP to route.
    const dev = _devices.values().next().value;
    if (!dev) return;

    parseDataLine(dev, line);
    _onDataReceived?.(dev);

    // Feed to registry if enabled
    if (dev.feeding && dev.rawQuat) {
      feedToRegistry(dev);
    }
  });

  // Listen for command responses (UDP)
  bridge.onXIMU3CommandResponse?.((json) => {
    DEBUG && console.log('[imu-setup] UDP command response:', json);
    // Route to first connected UDP device
    for (const dev of _devices.values()) {
      if (dev.transport === 'udp') {
        if (json.axes_alignment !== undefined) dev.axesAlignment = json.axes_alignment;
        break;
      }
    }
    _onCommandResponse?.(json);
  });

  // ── Serial listeners ──────────────────────────────────────────────────────
  // Data from serial ports is tagged with the port path.

  bridge.onSerialData?.((portPath, line) => {
    const dev = _serialPathToDevice.get(portPath);
    if (!dev) return;

    parseDataLine(dev, line);
    _onDataReceived?.(dev);

    if (dev.feeding && dev.rawQuat) {
      feedToRegistry(dev);
    }
  });

  bridge.onSerialResponse?.((portPath, json) => {
    DEBUG && console.log(`[imu-setup] serial response from ${portPath}:`, json);
    const dev = _serialPathToDevice.get(portPath);
    if (!dev) return;

    // Populate device info from query responses
    if (json.device_name !== undefined) dev.name = json.device_name;
    if (json.serial_number !== undefined) {
      // Re-key device if serial number was unknown (connected before query returned)
      const oldSn = dev.sn;
      if (oldSn !== json.serial_number && oldSn.startsWith('serial-')) {
        _devices.delete(oldSn);
        dev.sn = json.serial_number;
        dev.slotName = `ximu3-${dev.sn}`;
        _devices.set(dev.sn, dev);
        _onDeviceUpdated?.(dev);
      }
    }
    // Also fire on name update so card header refreshes
    if (json.device_name !== undefined) {
      _onDeviceUpdated?.(dev);
    }
    if (json.axes_alignment !== undefined) dev.axesAlignment = json.axes_alignment;

    _onCommandResponse?.(json);
  });

  DEBUG && console.log('[imu-setup] initialized — listening for x-IMU3 discovery + serial');
}

// ── Serial port scanning ────────────────────────────────────────────────────

export async function scanSerialPorts() {
  const bridge = window.electronBridge;
  if (!bridge?.serialListPorts) return [];

  _serialPortList = await bridge.serialListPorts();
  _onSerialPortsChanged?.(_serialPortList);
  DEBUG && console.log(`[imu-setup] found ${_serialPortList.length} serial ports`);
  return _serialPortList;
}

// ── Connect / disconnect ────────────────────────────────────────────────────

// Connect a WiFi-discovered device (by serial number from discovery list)
export async function connectDevice(sn) {
  const info = _discovered.get(sn);
  if (!info) return false;

  const bridge = window.electronBridge;
  if (!bridge) return false;

  const dev = new DeviceState(sn, info.name, {
    transport: 'udp',
    ip:       info.ip,
    send:     info.send,
    receive:  info.receive,
  });
  _devices.set(sn, dev);

  // Start listening on the device's send port
  await bridge.ximu3StartData(info.send);

  // Short delay to let the socket bind complete before sending commands
  await _delay(300);

  // Read current settings and enforce quaternion output
  sendCommandTo(dev, { axes_alignment: null });
  requestQuatMode(dev);

  DEBUG && console.log(`[imu-setup] UDP connected to ${info.name} (${sn}) at ${info.ip}`);
  return true;
}

// Connect a serial (USB) device by port path (e.g. '/dev/tty.usbmodem1234')
export async function connectSerialDevice(portPath) {
  const bridge = window.electronBridge;
  if (!bridge?.serialOpen) return false;

  const result = await bridge.serialOpen(portPath);
  if (!result?.ok) return false;

  // Use a temp serial number until the device responds with its real one
  const tempSn = 'serial-' + portPath.replace(/[^a-zA-Z0-9]/g, '');
  const dev = new DeviceState(tempSn, portPath, {
    transport:  'serial',
    serialPath: portPath,
  });
  _devices.set(tempSn, dev);
  _serialPathToDevice.set(portPath, dev);

  // Short delay to let the serial port open complete
  await _delay(500);

  // Query device info and enforce quaternion output
  sendCommandTo(dev, { device_name: null });
  sendCommandTo(dev, { serial_number: null });
  sendCommandTo(dev, { axes_alignment: null });
  requestQuatMode(dev);

  DEBUG && console.log(`[imu-setup] serial connected on ${portPath}`);
  return true;
}

export async function disconnectDevice(sn) {
  const dev = _devices.get(sn);
  if (!dev) return;

  dev.feeding = false;
  _devices.delete(sn);

  const bridge = window.electronBridge;

  if (dev.transport === 'serial') {
    _serialPathToDevice.delete(dev.serialPath);
    if (bridge?.serialClose) await bridge.serialClose(dev.serialPath);
    DEBUG && console.log(`[imu-setup] serial disconnected ${dev.serialPath}`);
  } else {
    // Stop UDP data listener if no UDP devices left
    const hasUdp = [..._devices.values()].some(d => d.transport === 'udp');
    if (!hasUdp && bridge) await bridge.ximu3StopData();
    DEBUG && console.log(`[imu-setup] UDP disconnected ${sn}`);
  }
}

// ── Send command to a specific device ───────────────────────────────────────

export function sendCommandTo(dev, jsonObj) {
  const bridge = window.electronBridge;
  if (!bridge || !dev) return;
  const str = JSON.stringify(jsonObj);

  if (dev.transport === 'serial') {
    bridge.serialSendCommand(dev.serialPath, str);
  } else {
    bridge.ximu3SendCommand(dev.ip, dev.receive, str);
  }
}

// Convenience: send to first connected device
export function sendCommand(jsonObj) {
  const dev = _devices.values().next().value;
  if (dev) sendCommandTo(dev, jsonObj);
}

// ── Axes alignment ──────────────────────────────────────────────────────────

export function setAxesAlignment(dev, value) {
  dev.axesAlignment = value;
  // Clear tare — it was captured in the old alignment frame and is no longer valid
  dev.tareEuler = null;
  sendCommandTo(dev, { axes_alignment: value });
  setTimeout(() => sendCommandTo(dev, { apply: null }), 100);
}

// ── Polarity reversal ───────────────────────────────────────────────────────

export function togglePolarity(dev, axis) {
  if (dev.polarity[axis] !== undefined) {
    dev.polarity[axis] *= -1;
  }
  return dev.polarity[axis];
}

export function toggleRollMute(dev) {
  dev.rollMute = !dev.rollMute;
  // Propagate to registry slot so the forward-vector path handles pole safety
  _syncRollMuteToSlot(dev);
  return dev.rollMute;
}

function _syncRollMuteToSlot(dev) {
  if (!dev.feeding) return;
  const slot = getOrCreateSlot(dev.slotName);
  if (!slot?.quatCal?.axisMap) return;
  slot.quatCal.axisMap.x.mute = dev.rollMute;  // x = roll in identity map
}

export function setPolarity(dev, axis, sign) {
  if (dev.polarity[axis] !== undefined) {
    dev.polarity[axis] = sign >= 0 ? 1 : -1;
  }
}

// ── Tare ────────────────────────────────────────────────────────────────────

export function captureTare(dev) {
  // Euler-space tare: store current pitch and yaw as offsets.
  // Subtracted directly from Euler angles — no quaternion multiplication,
  // so roll stays gravity-referenced and can't drift when yawing off-kilter.
  const q = dev.rawQuat;
  const euler = quatToEulerDeg(q.x, q.y, q.z, q.w);
  dev.tareEuler = { pitch: euler.pitch, yaw: euler.yaw };
  DEBUG && console.log(`[imu-setup] tare captured for ${dev.sn}: pitch=${euler.pitch.toFixed(1)}° yaw=${euler.yaw.toFixed(1)}°`);
}

export function clearTare(dev) {
  dev.tareEuler = null;
  DEBUG && console.log(`[imu-setup] tare cleared for ${dev.sn}`);
}

// ── AHRS message type ───────────────────────────────────────────────────────

export function requestEulerMode(dev) {
  sendCommandTo(dev, { ahrs_message_type: 2 });
  setTimeout(() => sendCommandTo(dev, { apply: null }), 100);
}

export function requestQuatMode(dev) {
  sendCommandTo(dev, { ahrs_message_type: 0 });
  setTimeout(() => sendCommandTo(dev, { apply: null }), 100);
}

// ── Feed to registry ────────────────────────────────────────────────────────

export function setFeeding(dev, enabled) {
  dev.feeding = enabled;
  if (enabled) {
    // Create registry slot with identity calibration — imu-setup owns calibration,
    // so the registry should just pass data through.
    const slot = getOrCreateSlot(dev.slotName);
    // Reset registry calibration to identity so it doesn't interfere
    slot.quatCal.tareQuat       = null;
    slot.quatCal.tareRollOffset = 0;
    slot.quatCal.axisMap = {
      x: { viz: 'roll',  sign: 1, mute: dev.rollMute },
      y: { viz: 'pitch', sign: 1, mute: false },
      z: { viz: 'yaw',   sign: 1, mute: false },
    };
    // Assign role
    assignQuatRole(dev.slotName, dev.role);
  }
}

export function setRole(dev, role) {
  dev.role = role;
  if (dev.feeding) {
    assignQuatRole(dev.slotName, role);
  }
}

// ── ASCII data parser ───────────────────────────────────────────────────────

function parseDataLine(dev, line) {
  const parts = line.split(',');
  if (parts.length < 3) return;

  const type = parts[0];
  const timestamp = parseInt(parts[1], 10);
  dev.lastTimestamp = timestamp;
  dev.lastMsgType = type;

  switch (type) {
    case 'A': { // Euler angles: roll, pitch, yaw (degrees)
      if (parts.length >= 5) {
        const r = parseFloat(parts[2]);
        const p = parseFloat(parts[3]);
        const y = parseFloat(parts[4]);
        dev.rawEuler.roll  = r;
        dev.rawEuler.pitch = p;
        dev.rawEuler.yaw   = y;
        // Cross-populate quaternion so getCalibratedEuler/Quat always works
        const q = eulerDegToQuat(r, p, y);
        dev.rawQuat.x = q[0];
        dev.rawQuat.y = q[1];
        dev.rawQuat.z = q[2];
        dev.rawQuat.w = q[3];
      }
      break;
    }

    case 'Q': { // Quaternion: w, x, y, z
      if (parts.length >= 6) {
        const w = parseFloat(parts[2]);
        const x = parseFloat(parts[3]);
        const y = parseFloat(parts[4]);
        const z = parseFloat(parts[5]);
        dev.rawQuat.w = w;
        dev.rawQuat.x = x;
        dev.rawQuat.y = y;
        dev.rawQuat.z = z;
        // Cross-populate Euler so raw readout always works
        const e = quatToEulerDeg(x, y, z, w);
        dev.rawEuler.roll  = e.roll;
        dev.rawEuler.pitch = e.pitch;
        dev.rawEuler.yaw   = e.yaw;
      }
      break;
    }

    case 'I': // Inertial: gx, gy, gz, ax, ay, az
      if (parts.length >= 8) {
        dev.rawInertial.gx = parseFloat(parts[2]);
        dev.rawInertial.gy = parseFloat(parts[3]);
        dev.rawInertial.gz = parseFloat(parts[4]);
        dev.rawInertial.ax = parseFloat(parts[5]);
        dev.rawInertial.ay = parseFloat(parts[6]);
        dev.rawInertial.az = parseFloat(parts[7]);
      }
      break;

    default:
      break;
  }
}

// ── Feed pre-calibrated quaternion to sensor-registry ───────────────────────

function feedToRegistry(dev) {
  const q = dev.getCalibratedQuat();
  const slot = getOrCreateSlot(dev.slotName);
  // Feed pre-calibrated quaternion — registry's identity calibration passes it through
  handleSlotQuaternion(slot, [q[0], q[1], q[2], q[3]]);
}

// ── OSC sensor intake ───────────────────────────────────────────────────────
// Called by osc.js when a /sensor/{name}/quaternion or /sensor/{name}/inertial
// message arrives.  Auto-creates a DeviceState on first contact, runs
// calibration, and feeds to registry — same pipeline as WiFi/serial devices.

export function handleOSCSensorQuaternion(name, values) {
  let dev = _devices.get('osc-' + name);
  if (!dev) {
    dev = new DeviceState('osc-' + name, name, { transport: 'osc' });
    dev.feeding = true;  // auto-feed — OSC sensors are always live
    _devices.set('osc-' + name, dev);
    _initOscSlot(dev);
    _onDeviceUpdated?.(dev);
    DEBUG && console.log(`[imu-setup] OSC sensor auto-discovered: ${name} (role: ${dev.role})`);
  }

  // Store raw quaternion — osc.js sends [qx, qy, qz, qw] or [w, x, y, z]
  // Registry convention from Max is [qx, qy, qz, qw] (same as sphere.js)
  dev.rawQuat.x = values[0];
  dev.rawQuat.y = values[1];
  dev.rawQuat.z = values[2];
  dev.rawQuat.w = values[3];
  dev.lastMsgType = 'Q';
  dev.lastTimestamp = Date.now();

  // Cross-populate Euler
  const e = quatToEulerDeg(values[0], values[1], values[2], values[3]);
  dev.rawEuler.roll  = e.roll;
  dev.rawEuler.pitch = e.pitch;
  dev.rawEuler.yaw   = e.yaw;

  _onDataReceived?.(dev);

  if (dev.feeding) {
    feedToRegistry(dev);
  }
}

export function handleOSCSensorInertial(name, values) {
  let dev = _devices.get('osc-' + name);
  if (!dev) {
    dev = new DeviceState('osc-' + name, name, { transport: 'osc' });
    dev.feeding = true;
    _devices.set('osc-' + name, dev);
    _initOscSlot(dev);
    _onDeviceUpdated?.(dev);
    DEBUG && console.log(`[imu-setup] OSC sensor auto-discovered (inertial): ${name}`);
  }

  dev.rawInertial.gx = values[0];
  dev.rawInertial.gy = values[1];
  dev.rawInertial.gz = values[2];
  dev.rawInertial.ax = values[3];
  dev.rawInertial.ay = values[4];
  dev.rawInertial.az = values[5];
  dev.lastMsgType = 'I';

  _onDataReceived?.(dev);

  // Inertial goes straight to registry (no calibration transform for gyro/accel)
  if (dev.feeding) {
    const slot = getOrCreateSlot(dev.slotName);
    handleSlotInertial(slot, values);
  }
}

function _initOscSlot(dev) {
  const slot = getOrCreateSlot(dev.slotName);
  slot.quatCal.tareQuat       = null;
  slot.quatCal.tareRollOffset = 0;
  slot.quatCal.axisMap = {
    x: { viz: 'roll',  sign: 1, mute: false },
    y: { viz: 'pitch', sign: 1, mute: false },
    z: { viz: 'yaw',   sign: 1, mute: false },
  };
  assignQuatRole(dev.slotName, dev.role);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

export const AXES_ALIGNMENT_LABELS = AXES_ALIGNMENTS;

export function getAlignmentLabel(value) {
  const entry = AXES_ALIGNMENTS.find(a => a[0] === value);
  return entry ? entry[1] : '+X+Y+Z';
}
