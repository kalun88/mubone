// ============================================================================
// imu-setup.js — x-IMU3 direct connection & full sensor calibration
//
// This module replaces the sensor panel's calibration role for x-IMU3 devices.
// It owns: device discovery, connection (WiFi UDP or serial), hardware config
// (axes alignment).  Software calibration lives in sensor-registry.js.
//
// Output: the sensor's raw quaternion → sensor-registry, which owns the
// calibration (mount, heading, axis signs) and applies it in one place.
//
// Protocol reference: x-IMU3 User Manual v1.11, sections 8–11.
// ============================================================================

import { S, DEBUG } from './state.js';
import {
  getOrCreateSlot, handleSlotQuaternion, handleSlotInertial, assignQuatRole, forgetSlot,
  saveCalibration,
  captureMountPose1 as regMountPose1,
  captureMountPose2 as regMountPose2,
  cancelMountCapture as regCancelMount,
  captureHeading as regCaptureHeading,
  clearMount as regClearMount,
} from './sensor-registry.js';
import {
  settingsFor, EXPECTED_MESSAGE_TYPES, VERIFY_TIMEOUT_MS, VERIFY_DELAY_MS,
} from './ximu-settings.js';

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
  constructor(sn, name, { transport, ip, send, receive, serialPath, kind }) {
    this.sn      = sn;
    this.name    = name;

    // Transport: 'udp', 'serial', or 'osc'
    this.transport  = transport || 'udp';

    // KIND is what the thing IS; transport is how the app reaches it. They are
    // not the same question and nothing on the wire answers the first one: an
    // 'osc' transport is any peer sending /sensor/{name}/…, which is a Max
    // patch, a proxy, or a first-party mubone instrument on its own cable.
    // Whoever owns the connection declares it — see declareSensorKind().
    //   'x-imu3' — the third-party unit; settings enforcement, LED, accessory
    //   'mubone'  — first-party instrument (js/sygaldry.js)
    //   'osc'     — anything else on the wire; we know nothing about it
    this.kind = kind || (this.transport === 'osc' ? 'osc' : 'x-imu3');

    // How it is reached, in a word, when 'osc' would be a lie — a cabled
    // instrument arrives as OSC but is not an OSC peer. Null falls back to the
    // transport's own word.
    this.via = null;

    // UDP-specific
    this.ip      = ip || null;
    this.send    = send || 0;     // port device sends data TO (we listen here)
    this.receive = receive || 0;  // port device listens ON (we send commands here)

    // Serial-specific
    this.serialPath = serialPath || null;

    // Hardware config (stored on the device)
    this.axesAlignment = 0;

    // WiFi info (queried on connect for UDP devices)
    // AP = device's own hotspot config; client = router the device joined.
    // The x-IMU3 has no wi_fi_mode setting — AP vs client is a boot state (LED colour,
    // cyan=client, magenta=AP). But we can infer mode reliably from RSSI: the manual
    // states RSSI is -1 in AP mode and a valid percentage in client mode.
    this.wifiApChannel     = null;
    this.wifiApSsid        = null;
    this.wifiClientChannel = null;
    this.wifiClientSsid    = null;
    this.wifiRegion        = null;   // 1=US, 2=EU, 3=JP

    // Software calibration lives in the REGISTRY, not here (2026-08-31).
    // `tareEuler`, `polarity` and `rollMute` were removed: all three were
    // applied in getCalibratedQuat(), i.e. UPSTREAM of the registry's own
    // calibration, so setting any of them changed the very quaternion the
    // registry's mount rotation had been captured against — the two composed
    // instead of one replacing the other. Signs and mute now live in
    // `slot.quatCal.axisMap`, which is applied downstream of the mount and
    // heading rotations and cannot disturb them.
    // Convention note: x-IMU3 outputs NWU (X=West, Y=North, Z=Up).
    // The sphere expects right-handed graphics coords (X=right, Y=up, Z=forward),
    // which the axis map's signs express.

    // Latest raw data from this device
    this.rawQuat  = { w: 1, x: 0, y: 0, z: 0 };
    this.rawEuler = { roll: 0, pitch: 0, yaw: 0 };
    this.rawInertial = { gx: 0, gy: 0, gz: 0, ax: 0, ay: 0, az: 0 };
    this.lastMsgType = null;
    this.lastTimestamp = 0;      // the DEVICE's clock — an x-imu3 stamps µs since boot
    this.lastSeenAt = 0;         // OUR clock — Date.now() of the last packet, any stream
    this.live = false;           // packets within LIVE_MS; the connection state (Ek, 2026-09-09)

    // Serial accessory (x-IMU3-SA-A8 etc).  serialMode is read back from the
    // device on connect — never written automatically.  2 = Accessory.
    // Presence of an accessory is observed from data flow, not configuration:
    // the adapter hot-plugs, so lastAccessoryAt going stale IS the unplug event.
    this.serialMode      = null;
    this.lastAccessoryAt = 0;

    // Settings enforcement result, filled in by verifySettings() after connect.
    // null = never verified (OSC devices, or a connect still in flight).
    // { ok, mismatched: [{ key, want, got }], unanswered: [key], at }
    this.settingsVerify = null;

    // Data message types seen that mubone does not consume.  A non-empty map
    // after connect means enforcement did not take — the device is still
    // streaming something the app throws away.  Keyed by type letter.
    this.unexpectedTypes = new Map();

    // Registry integration
    // OSC devices keep their original slot name (e.g. 'cursor')
    // so the Max patch's slot name flows through unchanged.
    this.slotName   = transport === 'osc' ? sn : `ximu3-${sn}`;
    this.role       = 'cursor';     // default role — user can change
    this.feeding    = false;        // whether data is being pushed to registry
  }

  // Raw Euler, straight from the quaternion. The device layer no longer
  // calibrates: the registry owns tare, signs and mute, and applies them in
  // one place where they cannot fight each other.
  getRawEuler() {
    return quatToEulerDeg(this.rawQuat.x, this.rawQuat.y, this.rawQuat.z, this.rawQuat.w);
  }

  // What gets fed to the registry: the sensor's own quaternion, untouched.
  getFeedQuat() {
    return [this.rawQuat.x, this.rawQuat.y, this.rawQuat.z, this.rawQuat.w];
  }
}


// ── Per-device preferences (persisted in localStorage) ─────────────────────
// Keyed by serial number.  Stores the ROLE only — signs, mute and tare moved
// to the registry's per-slot calibration (`mubone_sensor_cal`), which is the
// one place quaternion calibration lives now.
const _LS_DEVICE_PREFS_KEY = 'mubone-sensor-prefs';

// Data lines dropped because their source IP matched no connected device
// while >1 UDP device was connected (misrouted / foreign-instance traffic).
let _unknownSourceDrops = 0;

function _loadDevicePrefs() {
  try {
    const raw = localStorage.getItem(_LS_DEVICE_PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
}

// A serial device is keyed `serial-<path>` until it answers with its real
// serial number. An x-imu3 answers within a second; anything else never does,
// so the temp key becomes permanent — keyed on a tty path that is not even
// stable across reboots. This function has always CLAIMED to skip those and
// never did, which is how a BNO connected once through the wrong door left a
// phantom x-imu3 in the prefs forever. `osc-<name>` is NOT a temp key: that
// name is the sensor's own and is what it will be called next time.
function _isTempKey(sn) { return sn.startsWith('serial-'); }

function _saveDevicePrefs() {
  const prefs = {};
  for (const [sn, dev] of _devices) {
    if (_isTempKey(sn)) continue;
    prefs[sn] = {

      role:     dev.role,
    };
  }
  // Merge with existing prefs so disconnected devices keep their settings
  const existing = _loadDevicePrefs();
  Object.assign(existing, prefs);
  // One-shot prune of what the missing filter already wrote.
  for (const sn of Object.keys(existing)) if (_isTempKey(sn)) delete existing[sn];
  try {
    localStorage.setItem(_LS_DEVICE_PREFS_KEY, JSON.stringify(existing));
  } catch (_) {}
}

// Signs read out of the OLD prefs key, waiting for the slot to exist.
const _migratedSigns = new Map();   // slotName → { polarity, rollMute }

// Fold a migrated polarity/rollMute into the slot's axis map. Called once,
// when the slot is created; the prefs key is rewritten without them after.
function _applyMigratedSigns(slot) {
  const mig = _migratedSigns.get(slot.name);
  if (!mig) return;
  _migratedSigns.delete(slot.name);
  const map = slot.quatCal.axisMap;
  if (mig.polarity) {
    for (const a of Object.values(map)) {
      const sgn = mig.polarity[a.viz];
      if (sgn === -1) a.sign = -a.sign;
    }
  }
  // (mig.rollMute is deliberately dropped: the Mute control is gone, so a
  // migrated mute would be invisible and unremovable.)
  saveCalibration();
  _saveDevicePrefs();   // rewrites without polarity/rollMute
}

function _applyDevicePrefs(dev) {
  const all = _loadDevicePrefs();
  const p = all[dev.sn];
  if (!p) return;
  // One-shot migration: a stored polarity/rollMute from before 2026-08-31
  // becomes axis-map signs on the slot, then is dropped from prefs.
  if (p.polarity || p.rollMute !== undefined) {
    _migratedSigns.set(dev.slotName, { polarity: p.polarity, rollMute: p.rollMute });
  }
  if (p.role) dev.role = p.role;
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
let _onCommandSent      = null;   // fired when a command is sent to a device

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
export function setOnCommandSent(cb)       { _onCommandSent = cb; }

// ── Browser-mode transport (WebSerial + proxy control channel) ──────────────
// When not in Electron, we use:
//   - WebSerial API (Chrome) for USB serial connections
//   - WebSocket to proxy.js control channel (port 8081) for WiFi discovery/commands
// The proxy data channel (port 8080) is handled by osc.js, same as Max bridge.

let _proxyWs = null;
let _proxyRetryTimer = null;
const PROXY_CONTROL_URL = 'ws://localhost:8081';
const PROXY_RETRY_MS = 3000;
const PROXY_MAX_SILENT_RETRIES = 3;
let _proxyRetryCount = 0;
let _proxyEverConnected = false;

// Active WebSerial ports: portPath (identifier string) → { port, reader, writer, readLoop }
const _webSerialPorts = new Map();

function _initBrowserTransport() {
  // Connect to proxy control channel for WiFi discovery.
  // Same reasoning as osc.js: PROXY_CONTROL_URL is a localhost address, so on a
  // hosted origin (mubone.org/sim) it can only fail. Skip it there rather than
  // spraying connection errors into a demo visitor's console — WebSerial below
  // is the path that actually works from a hosted page.
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '') {
    _connectProxyControl();
  } else {
    DEBUG && console.log('[imu-setup] hosted origin — skipping local proxy control channel');
  }

  // WebSerial is available — serial scanning handled on demand via scanSerialPorts()
  if (navigator.serial) {
    DEBUG && console.log('[imu-setup] WebSerial API available');
  } else {
    DEBUG && console.log('[imu-setup] WebSerial API not available in this browser');
  }
}

function _connectProxyControl() {
  if (_proxyWs) {
    _proxyWs.onclose = null;
    try { _proxyWs.close(); } catch (_) {}
  }

  try {
    _proxyWs = new WebSocket(PROXY_CONTROL_URL);
  } catch (_) {
    _scheduleProxyRetry();
    return;
  }

  _proxyWs.onopen = () => {
    _proxyEverConnected = true;
    _proxyRetryCount = 0;
    DEBUG && console.log('[imu-setup] proxy control channel connected');
    clearTimeout(_proxyRetryTimer);
  };

  _proxyWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      _handleProxyMessage(msg);
    } catch (_) {}
  };

  _proxyWs.onclose = () => {
    _proxyWs = null;
    _scheduleProxyRetry();
  };

  _proxyWs.onerror = () => {};
}

function _scheduleProxyRetry() {
  clearTimeout(_proxyRetryTimer);
  if (!_proxyEverConnected) {
    _proxyRetryCount++;
    if (_proxyRetryCount > PROXY_MAX_SILENT_RETRIES) return;
  }
  _proxyRetryTimer = setTimeout(_connectProxyControl, PROXY_RETRY_MS);
}

function _sendProxyControl(obj) {
  if (_proxyWs && _proxyWs.readyState === WebSocket.OPEN) {
    _proxyWs.send(JSON.stringify(obj));
  }
}

function _handleProxyMessage(msg) {
  switch (msg.type) {
    case 'discovery': {
      const d = msg.data;
      if (!d.sn) break;
      const entry = {
        name: d.name, sn: d.sn, ip: d.ip, port: d.port,
        send: d.send, receive: d.receive,
        battery: d.battery, rssi: d.rssi, status: d.status,
        lastSeen: Date.now(),
      };
      _discovered.set(d.sn, entry);
      const dev = _devices.get(d.sn);
      if (dev) { dev.ip = entry.ip; dev.send = entry.send; dev.receive = entry.receive; }
      _onDeviceDiscovered?.(entry);
      break;
    }
    case 'discovery-lost':
      _discovered.delete(msg.sn);
      _onDeviceDiscovered?.(null);
      break;
    case 'data': {
      // Raw data line from proxy (for direct-connected WiFi devices in browser mode)
      // In browser mode, WiFi data also flows through osc.js via port 8080,
      // but this path feeds imu-setup device cards for calibrated readout.
      if (!msg.line || !msg.sourceIP) break;
      let dev = null;
      for (const d of _devices.values()) {
        if (d.transport === 'udp' && d.ip === msg.sourceIP) { dev = d; break; }
      }
      if (!dev) {
        for (const d of _devices.values()) {
          if (d.transport === 'udp') { dev = d; break; }
        }
      }
      if (dev) {
        parseDataLine(dev, msg.line);
        _onDataReceived?.(dev);
        if (dev.feeding && dev.rawQuat) feedToRegistry(dev);
      }
      break;
    }
    case 'command-response': {
      const json = msg.data;
      let matched = null;
      if (msg.sourceIP) {
        for (const d of _devices.values()) {
          if (d.transport === 'udp' && d.ip === msg.sourceIP) { matched = d; break; }
        }
      }
      if (!matched) {
        for (const d of _devices.values()) {
          if (d.transport === 'udp') { matched = d; break; }
        }
      }
      if (matched) {
        _applyResponseFields(matched, json);
      }
      _onCommandResponse?.(json);
      break;
    }
  }
}

// ── WebSerial helpers ────────────────────────────────────────────────────────

async function _webSerialOpen(port) {
  await port.open({ baudRate: 115200 });

  const portId = _webSerialPortId(port);

  // AbortController lets us cleanly kill the pipeTo pipes on disconnect,
  // releasing the locks on port.readable / port.writable so port.close() works.
  const abortController = new AbortController();

  const encoder = new TextEncoderStream();
  const writable = encoder.writable;
  const encoderPipe = encoder.readable.pipeTo(port.writable, { signal: abortController.signal })
    .catch(() => {});  // swallow abort error
  const writer = writable.getWriter();

  const decoder = new TextDecoderStream();
  const decoderPipe = port.readable.pipeTo(decoder.writable, { signal: abortController.signal })
    .catch(() => {});  // swallow abort error
  const reader = decoder.readable.getReader();

  let buf = '';
  let running = true;

  const readLoop = (async () => {
    try {
      while (running) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nlIdx;
        while ((nlIdx = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nlIdx).trim();
          buf = buf.slice(nlIdx + 1);
          if (!line) continue;

          const dev = _serialPathToDevice.get(portId);
          if (!dev) continue;

          if (line[0] === '{') {
            try {
              const json = JSON.parse(line);
              // Handle device info responses
              if (json.device_name !== undefined) dev.name = json.device_name;
              if (json.serial_number !== undefined) {
                const oldSn = dev.sn;
                if (oldSn !== json.serial_number && oldSn.startsWith('serial-')) {
                  _devices.delete(oldSn);
                  dev.sn = json.serial_number;
                  dev.slotName = `ximu3-${dev.sn}`;
                  _devices.set(dev.sn, dev);
                  _applyDevicePrefs(dev);  // re-apply with real SN
                  _onDeviceUpdated?.(dev);
                }
              }
              _applyResponseFields(dev, json);
              _onCommandResponse?.(json);
            } catch (_) {}
          } else {
            parseDataLine(dev, line);
            _onDataReceived?.(dev);
            if (dev.feeding && dev.rawQuat) feedToRegistry(dev);
          }
        }
      }
    } catch (e) {
      if (running) console.warn(`[imu-setup] WebSerial read error: ${e.message}`);
    }
  })();

  _webSerialPorts.set(portId, {
    port, reader, writer, readLoop, running: true,
    abortController, encoderPipe, decoderPipe,
  });
  return portId;
}

async function _webSerialClose(portId) {
  const entry = _webSerialPorts.get(portId);
  if (!entry) return;
  entry.running = false;

  // 1. Abort the pipeTo pipes — this releases the locks on port.readable / port.writable
  entry.abortController.abort();

  // 2. Wait for both pipes to settle (they resolve/reject via the .catch() above)
  await Promise.allSettled([entry.encoderPipe, entry.decoderPipe]);

  // 3. Release reader/writer locks (in case abort didn't fully propagate)
  try { entry.reader.cancel(); } catch (_) {}
  try { await entry.writer.close(); } catch (_) {}

  // 4. Now port streams are unlocked — safe to close and reopen later
  try { await entry.port.close(); } catch (e) {
    DEBUG && console.warn(`[imu-setup] WebSerial port.close() error: ${e.message}`);
  }
  _webSerialPorts.delete(portId);
}

async function _webSerialSend(portId, str) {
  const entry = _webSerialPorts.get(portId);
  if (!entry) return;
  const payload = str.endsWith('\n') ? str : str + '\n';
  try { await entry.writer.write(payload); } catch (e) {
    console.warn(`[imu-setup] WebSerial write error: ${e.message}`);
  }
}

function _webSerialPortId(port) {
  // WebSerial ports don't have a path — use object identity via a WeakMap
  if (!_webSerialPortId._map) _webSerialPortId._map = new WeakMap();
  if (!_webSerialPortId._counter) _webSerialPortId._counter = 0;
  let id = _webSerialPortId._map.get(port);
  if (!id) {
    id = 'webserial-' + (++_webSerialPortId._counter);
    _webSerialPortId._map.set(port, id);
  }
  return id;
}

// ── Init (called once from main.js) ─────────────────────────────────────────

export function initIMUSetup() {
  _installRoleChangeListener();
  // The falling edge of liveness has no event to ride; both modes tick it.
  setInterval(_liveTick, 500);

  const bridge = window.electronBridge;

  if (!bridge?.isElectron) {
    // Browser mode — use WebSerial + proxy control channel
    DEBUG && console.log('[imu-setup] browser mode — WebSerial + proxy for WiFi');
    _initBrowserTransport();
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

  // Listen for data messages — route by source IP to the correct device
  bridge.onXIMU3Data((line, sourceIP) => {
    let dev = null, udpCount = 0, firstUdp = null;
    for (const d of _devices.values()) {
      if (d.transport !== 'udp') continue;
      udpCount++;
      if (!firstUdp) firstUdp = d;
      if (sourceIP && d.ip === sourceIP) { dev = d; break; }
    }
    // Fallback only when exactly ONE UDP device is connected (its IP may not
    // be known yet).  With several devices — or several instances sharing a
    // data port — an unknown-source line must never be attributed to an
    // arbitrary device: two quaternion streams would fight over one cursor.
    if (!dev) {
      if (udpCount === 1) {
        dev = firstUdp;
      } else {
        _unknownSourceDrops++;
        if (DEBUG && (_unknownSourceDrops === 1 || _unknownSourceDrops % 400 === 0)) {
          console.warn(`[imu-setup] dropped ${_unknownSourceDrops} data lines from unknown source ${sourceIP} — is another device sending to this port?`);
        }
        return;
      }
    }
    if (!dev) return;

    parseDataLine(dev, line);
    _onDataReceived?.(dev);

    if (dev.feeding && dev.rawQuat) {
      feedToRegistry(dev);
    }
  });

  // Listen for command responses (UDP) — route by source IP
  bridge.onXIMU3CommandResponse?.((json, sourceIP) => {
    DEBUG && console.log('[imu-setup] UDP command response:', json, sourceIP);
    let matched = null;
    if (sourceIP) {
      for (const dev of _devices.values()) {
        if (dev.transport === 'udp' && dev.ip === sourceIP) { matched = dev; break; }
      }
    }
    // Fallback: first UDP device
    if (!matched) {
      for (const dev of _devices.values()) {
        if (dev.transport === 'udp') { matched = dev; break; }
      }
    }
    if (matched) {
      _applyResponseFields(matched, json);
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
        _applyDevicePrefs(dev);  // re-apply with real SN
        _onDeviceUpdated?.(dev);
      }
    }
    _applyResponseFields(dev, json);

    _onCommandResponse?.(json);
  });

  DEBUG && console.log('[imu-setup] initialized — listening for x-IMU3 discovery + serial');
}

// ── Serial port scanning ────────────────────────────────────────────────────

export async function scanSerialPorts() {
  const bridge = window.electronBridge;

  // Electron mode — use IPC
  if (bridge?.serialListPorts) {
    _serialPortList = await bridge.serialListPorts();
    _onSerialPortsChanged?.(_serialPortList);
    DEBUG && console.log(`[imu-setup] found ${_serialPortList.length} serial ports`);
    return _serialPortList;
  }

  // Browser mode — WebSerial API (Chrome only)
  // WebSerial doesn't have a "list all ports" API — we need to prompt the user.
  // getPorts() returns previously-granted ports only.
  if (navigator.serial) {
    try {
      const ports = await navigator.serial.getPorts();
      _serialPortList = ports.map((p, i) => {
        const info = p.getInfo?.() || {};
        return {
          path: _webSerialPortId(p),
          manufacturer: '',
          serialNumber: '',
          vendorId: info.usbVendorId ? '0x' + info.usbVendorId.toString(16) : '',
          productId: info.usbProductId ? '0x' + info.usbProductId.toString(16) : '',
          _webSerialPort: p,  // stash the actual port object
        };
      });
      _onSerialPortsChanged?.(_serialPortList);
      DEBUG && console.log(`[imu-setup] WebSerial: ${_serialPortList.length} previously-granted ports`);
      return _serialPortList;
    } catch (e) {
      DEBUG && console.warn(`[imu-setup] WebSerial getPorts error: ${e.message}`);
    }
  }

  return [];
}

// Browser mode: prompt user to select a serial port (WebSerial requires user gesture)
export async function requestSerialPort() {
  if (!navigator.serial) return null;
  try {
    const port = await navigator.serial.requestPort();
    // Re-scan to pick up the newly granted port
    await scanSerialPorts();
    return port;
  } catch (e) {
    DEBUG && console.log(`[imu-setup] WebSerial port request cancelled or failed: ${e.message}`);
    return null;
  }
}

// ── Connect / disconnect ────────────────────────────────────────────────────

// Connect a WiFi-discovered device (by serial number from discovery list)
export async function connectDevice(sn) {
  const info = _discovered.get(sn);
  if (!info) return false;

  const bridge = window.electronBridge;

  const dev = new DeviceState(sn, info.name, {
    transport: 'udp',
    ip:       info.ip,
    send:     info.send,
    receive:  info.receive,
  });
  _devices.set(sn, dev);
  _applyDevicePrefs(dev);  // restore role from previous session

  // Notify main page immediately — don't wait for handshake
  _syncSensorStatus();

  // Bring the UDP data listener up.  Command responses arrive on the same
  // socket as data, so nothing can be read back until this is running.
  if (bridge?.isElectron) {
    await bridge.ximu3StartData(info.send);
  } else {
    // Browser mode — the proxy owns the socket.  It starts the listener and
    // relays our commands; enforcement itself stays here so there is exactly
    // one copy of it (see ximu-settings.js).
    _sendProxyControl({ type: 'connect', sn });
  }
  await _delay(300);

  // Read current settings
  sendCommandTo(dev, { axes_alignment: null });
  sendCommandTo(dev, { wi_fi_ap_channel: null });
  sendCommandTo(dev, { wi_fi_ap_ssid: null });
  sendCommandTo(dev, { wi_fi_client_channel: null });
  sendCommandTo(dev, { wi_fi_client_ssid: null });
  sendCommandTo(dev, { wi_fi_region: null });

  // Settings enforcement — see ximu-settings.js for the table and why.
  // serial_mode is read there too, as part of the verification sweep.
  await _enforceAndVerify(dev);

  // LED handshake — 5× blink for visual confirmation on the physical device.
  // Route through blinkDevice() so it goes through the LED-feedback module
  // when enabled (firmware's white {blink:null} strobe is invisible against
  // our grey idle — the module flashes red/black instead).
  await blinkDevice(dev, 5, 200);

  _syncSensorStatus();
  DEBUG && console.log(`[imu-setup] UDP connected to ${info.name} (${sn}) at ${info.ip}`);
  return true;
}

// Connect a serial (USB) device by port path (e.g. '/dev/tty.usbmodem1234')
// In browser mode, portPath can also be a WebSerial port object or its ID string.
export async function connectSerialDevice(portPathOrObj) {
  const bridge = window.electronBridge;

  // ── Browser mode: WebSerial ──
  if (!bridge?.isElectron && navigator.serial) {
    let wsPort = portPathOrObj;
    let portId;

    // If passed a string ID, find the stashed port object from the scan list
    if (typeof portPathOrObj === 'string') {
      const found = _serialPortList.find(p => p.path === portPathOrObj);
      if (found?._webSerialPort) {
        wsPort = found._webSerialPort;
      } else {
        DEBUG && console.warn(`[imu-setup] WebSerial port not found: ${portPathOrObj}`);
        return false;
      }
    }

    try {
      portId = await _webSerialOpen(wsPort);
    } catch (e) {
      DEBUG && console.warn(`[imu-setup] WebSerial open failed: ${e.message}`);
      return false;
    }

    const tempSn = 'serial-' + portId.replace(/[^a-zA-Z0-9]/g, '');
    const dev = new DeviceState(tempSn, portId, {
      transport:  'serial',
      serialPath: portId,
    });
    _devices.set(tempSn, dev);
    _serialPathToDevice.set(portId, dev);

    // Notify main page immediately — don't wait for handshake blinks
    _syncSensorStatus();
    DEBUG && console.log(`[imu-setup] WebSerial connected on ${portId}`);

    await _delay(500);

    // Query device info + settings enforcement + blink (same as Electron)
    sendCommandTo(dev, { device_name: null });
    sendCommandTo(dev, { serial_number: null });
    sendCommandTo(dev, { axes_alignment: null });

    // Settings enforcement — see ximu-settings.js for the table and why.
    // serial_mode is read there too, as part of the verification sweep.
    await _enforceAndVerify(dev);

    // LED handshake — route through blinkDevice() so LED-feedback module handles it
    await blinkDevice(dev, 5, 200);
    return true;
  }

  // ── Electron mode: IPC serial ──
  const portPath = portPathOrObj;
  if (!bridge?.serialOpen) return false;

  const result = await bridge.serialOpen(portPath);
  if (!result?.ok) return false;

  const tempSn = 'serial-' + portPath.replace(/[^a-zA-Z0-9]/g, '');
  const dev = new DeviceState(tempSn, portPath, {
    transport:  'serial',
    serialPath: portPath,
  });
  _devices.set(tempSn, dev);
  _serialPathToDevice.set(portPath, dev);

  // Notify main page immediately — don't wait for handshake blinks
  _syncSensorStatus();
  DEBUG && console.log(`[imu-setup] serial connected on ${portPath}`);

  await _delay(500);

  // Query device info
  sendCommandTo(dev, { device_name: null });
  sendCommandTo(dev, { serial_number: null });
  sendCommandTo(dev, { axes_alignment: null });

  // Settings enforcement — see ximu-settings.js for the table and why.
  // serial_mode is read there too, as part of the verification sweep.
  await _enforceAndVerify(dev);

  // LED handshake — route through blinkDevice() so LED-feedback module handles it
  await blinkDevice(dev, 5, 200);
  return true;
}

// ── Send command to a specific device ───────────────────────────────────────

export function sendCommandTo(dev, jsonObj) {
  S._cmdLog.push({ t: Date.now(), what: Object.keys(jsonObj || {}).join(' ') });
  if (S._cmdLog.length > 200) S._cmdLog.shift();
  if (!dev) return;
  const bridge = window.electronBridge;
  const str = JSON.stringify(jsonObj);

  if (dev.transport === 'serial') {
    if (bridge?.isElectron) {
      bridge.serialSendCommand(dev.serialPath, str);
    } else {
      // Browser mode — WebSerial
      _webSerialSend(dev.serialPath, str);
    }
  } else if (dev.transport === 'udp') {
    if (bridge?.isElectron) {
      bridge.ximu3SendCommand(dev.ip, dev.receive, str);
    } else {
      // Browser mode — relay through proxy control channel
      _sendProxyControl({ type: 'command', ip: dev.ip, port: dev.receive, json: jsonObj });
    }
  }
  // OSC transport: no command sending (calibrated upstream)

  _onCommandSent?.(dev, jsonObj);
}

// ── Settings enforcement ────────────────────────────────────────────────────
// mubone does not trust the device's stored configuration.  The x-IMU3 GUI and
// the Max patches both write settings that persist in flash — max/x-imu3.maxpat
// leaves inertial messages at 400 Hz, max/x-imu3 copy.maxpat turns the
// magnetometer stream on — and a device that has been through either arrives
// streaming data mubone parses and discards.  Every connect re-asserts the
// whole table from ximu-settings.js, then reads it back.
//
// Not saved to flash: enforcement is per-connect by design, so the device stays
// usable with the x-IMU3 GUI at its own settings between mubone sessions.

export async function enforceSettings(dev) {
  if (!dev || dev.transport === 'osc') return;
  const want = settingsFor(dev.transport);
  for (const [key, value] of Object.entries(want)) {
    sendCommandTo(dev, { [key]: value });
  }
  await _delay(100);
  sendCommandTo(dev, { apply: null });
}

// ── Read-back verification ──────────────────────────────────────────────────
// Writes to the x-IMU3 are unacknowledged in any useful sense: the device
// echoes the key, but nothing in mubone ever looked at the echo, so a rejected
// or misspelled setting failed in complete silence.  After apply, re-read every
// enforced key and compare.
//
// A missing response is reported separately from a mismatch — UDP command
// responses can simply be dropped, and treating that as a failed setting would
// cry wolf before every show.

const _verifyPending = new Map();   // dev.sn → { want, got }

export async function verifySettings(dev) {
  if (!dev || dev.transport === 'osc') return null;

  const want = settingsFor(dev.transport);
  const state = { want, got: {} };
  _verifyPending.set(dev.sn, state);

  // Let the write echoes drain first, or they'd be counted as read responses.
  // (They carry the desired value, so they could only ever mask a failure.)
  await _delay(VERIFY_DELAY_MS);

  for (const key of Object.keys(want)) {
    sendCommandTo(dev, { [key]: null });
  }

  await _delay(VERIFY_TIMEOUT_MS);
  _verifyPending.delete(dev.sn);

  const mismatched = [];
  const unanswered = [];
  for (const [key, wantVal] of Object.entries(want)) {
    if (!(key in state.got)) { unanswered.push(key); continue; }
    const gotVal = state.got[key];
    // Loose compare: the device returns 4 for a divisor written as 4, but
    // numeric types can arrive as strings depending on transport.
    if (String(gotVal) !== String(wantVal)) {
      mismatched.push({ key, want: wantVal, got: gotVal });
    }
  }

  const result = { ok: mismatched.length === 0, mismatched, unanswered, at: Date.now() };
  dev.settingsVerify = result;

  if (mismatched.length) {
    console.warn(
      `[imu-setup] ${dev.name} (${dev.sn}): ${mismatched.length} setting(s) did not take —`,
      mismatched.map(m => `${m.key}: wanted ${m.want}, device reports ${m.got}`).join('; ')
    );
    // serial_mode failing is the one that bites silently.  SA-A8s get swapped on
    // and off mid-show, so a device stuck out of Accessory mode looks identical
    // to one that simply has nothing plugged in right now.
    if (mismatched.some(m => m.key === 'serial_mode')) {
      console.warn(
        `[imu-setup] ${dev.name} (${dev.sn}) is not in serial Accessory mode — it cannot receive an SA-A8, ` +
        `whether or not one is attached now.  Try:  acc.setAccessoryMode(true, '${dev.sn}')  (writes with save)`
      );
    }
  }

  if (unanswered.length) {
    DEBUG && console.warn(
      `[imu-setup] ${dev.name} (${dev.sn}): no read-back for ${unanswered.length} key(s) — ${unanswered.join(', ')}`
    );
  }
  if (result.ok && !unanswered.length) {
    DEBUG && console.log(`[imu-setup] ${dev.name} (${dev.sn}): all settings verified`);
  }

  _onDeviceUpdated?.(dev);
  return result;
}

// Called from _applyResponseFields for every command response.
function _noteVerifyResponse(dev, json) {
  const state = _verifyPending.get(dev.sn);
  if (!state) return;
  for (const key of Object.keys(json)) {
    if (key in state.want) state.got[key] = json[key];
  }
}

// Run enforcement then verification.  Awaited by the connect paths so the LED
// handshake blink lands after the device is actually configured.
async function _enforceAndVerify(dev) {
  await enforceSettings(dev);
  await verifySettings(dev);
}

// ── LED blink — visual identification / role-switch feedback ────────────────

export async function blinkDevice(dev, count = 3, intervalMs = 150) {
  if (!dev) return;
  // If LED feedback owns this device's colour, defer to it — the firmware's
  // {blink:null} white strobe would be cancelled by our next baseline write and
  // visually swamped by the idle colour. The module runs the `identify` row
  // instead, so the colour and rate follow whatever the LED mapping table says.
  // `intervalMs` is ignored on that path for the same reason: the row's pattern
  // owns the timing. It still applies to the firmware-strobe fallback below.
  try {
    const ledMod = await import('./ximu-led-feedback.js');
    if (ledMod.isXimuLedEnabled?.()) {
      window.dispatchEvent(new CustomEvent('mubone-led', {
        detail: { id: 'identify', sn: dev.sn, count }
      }));
      return;
    }
  } catch (_) {}
  for (let i = 0; i < count; i++) {
    if (i > 0) await _delay(intervalMs);
    sendCommandTo(dev, { blink: null });
  }
}

// ── Axes alignment ──────────────────────────────────────────────────────────

export function setAxesAlignment(dev, value) {
  dev.axesAlignment = value;
  // Drop the mount calibration — it was captured in the old alignment frame
  // and describes a rotation the sensor no longer reports.
  clearMountCal(dev);
  sendCommandTo(dev, { axes_alignment: value });
  setTimeout(() => sendCommandTo(dev, { apply: null }), 100);
}

// ── Axis signs and mute — thin wrappers over the slot's axis map ────────────
// These used to write DeviceState.polarity, which was applied upstream of the
// registry's mount rotation and therefore silently invalidated it. They now
// write the map itself, which is applied downstream and cannot.

function _slotFor(dev) {
  return dev?.feeding ? getOrCreateSlot(dev.slotName) : null;
}

function _entryFor(slot, viz) {
  if (!slot?.quatCal?.axisMap) return null;
  return Object.values(slot.quatCal.axisMap).find(a => a.viz === viz) || null;
}

export function togglePolarity(dev, axis) {
  const e = _entryFor(_slotFor(dev), axis);
  if (!e) return 1;
  e.sign = -e.sign;
  saveCalibration();
  return e.sign;
}

export function getPolarity(dev, axis) {
  return _entryFor(_slotFor(dev), axis)?.sign ?? 1;
}

// The calibrated euler as the sensors card displays it — the slot's
// zeroEuler (post-cal, post-axis-map), renamed into viz terms. Null while the
// sensor is not feeding; the card prints "—".
// (toggleRollMute/getRollMute lived here until 2026-09-01 — the Mute column
// left the axes table with the footer's RO button.)
export function getCalibratedEuler(dev) {
  const e = _slotFor(dev)?.zeroEuler;
  return e ? { roll: e.x, pitch: e.y, yaw: e.z } : null;
}

// ── Calibration — two gestures, both in the registry ────────────────────────
// Mount calibration is SETUP and takes TWO poses — neutral/forward, then
// pointing down — because one pose leaves the strap's own twist about vertical
// indistinguishable from the performer's heading. captureHeading is
// PERFORMANCE: face the stage, as often as you like, and it cannot disturb the
// mounting.

// Two poses, because one cannot determine a mounting — see sensor-registry.js.
// Pose 1 is neutral/forward, pose 2 is pointing down at the earth.
export function captureMountPose1(dev, quat = null) {
  const slot = _slotFor(dev);
  return slot ? regMountPose1(slot, quat) : null;
}

export function captureMountPose2(dev, quat = null) {
  const slot = _slotFor(dev);
  if (!slot) return null;
  const r = regMountPose2(slot, quat);
  DEBUG && console.log(`[imu-setup] mount ${r ? 'calibrated' : 'REJECTED (poses too close)'} for ${dev.sn}`);
  return r;
}

export function cancelMountCapture(dev) {
  const slot = _slotFor(dev);
  if (slot) regCancelMount(slot);
}

// The live quaternion, for the UI's stillness detector.
export function slotQuat(dev) {
  return _slotFor(dev)?.quat || null;
}

export function captureHeading(dev) {
  const slot = _slotFor(dev);
  if (!slot) return null;
  const r = regCaptureHeading(slot);
  DEBUG && console.log(`[imu-setup] heading zeroed for ${dev.sn}`);
  return r;
}

export function clearMountCal(dev) {
  const slot = _slotFor(dev);
  if (slot) regClearMount(slot);
}

export function hasMountCal(dev) {
  return !!_slotFor(dev)?.quatCal?.mountQuat;
}

// ── AHRS message type ───────────────────────────────────────────────────────

export function requestEulerMode(dev) {
  sendCommandTo(dev, { ahrs_message_type: 2 });
  setTimeout(() => sendCommandTo(dev, { apply: null }), 100);
}

// ── Feed to registry ────────────────────────────────────────────────────────

export function setFeeding(dev, enabled) {
  dev.feeding = enabled;
  if (enabled) {
    // The slot keeps whatever calibration it restored from localStorage.
    // This used to reset it to identity on every connect, on the old rule that
    // "imu-setup owns calibration" — which meant a mounting calibration did
    // not survive a reload, or even a feeding toggle. The registry owns it now.
    const slot = getOrCreateSlot(dev.slotName);
    _applyMigratedSigns(slot);
    assignQuatRole(dev.slotName, dev.role);
  }
  _syncSensorStatus();
}

export function setRole(dev, role) {
  dev.role = role;
  _saveDevicePrefs();
  // Ek, 2026-09-01: "when you've selected the drop down it should just work."
  // Feeding is implied by having a role — the separate toggle is gone.
  if (!dev.feeding) setFeeding(dev, true);
  else assignQuatRole(dev.slotName, role);
}

// ── Sync DeviceState.role when registry roles change externally ─────────────
// Called when assignQuatRole() is invoked directly (e.g. quick-switch buttons).
// Keeps DeviceState.role in sync with the registry slot's quatRole.
// Installed by initIMUSetup() to ensure _devices map is available.
function _installRoleChangeListener() {
  S._onSensorRoleChanged = (slot) => {
    for (const dev of _devices.values()) {
      if (dev.slotName === slot.name) {
        dev.role = slot.quatRole;
        _saveDevicePrefs();
        // Blink the device that just became cursor — 3× fast blink
        if (slot.quatRole === 'cursor') {
          blinkDevice(dev, 3, 150);
        }
        break;
      }
    }
    _syncSensorStatus();  // rebuild switch buttons via sensor-status event
  };
}

// ── ASCII data parser ───────────────────────────────────────────────────────

function parseDataLine(dev, line) {
  const parts = line.split(',');
  if (parts.length < 3) return;

  const type = parts[0];
  const timestamp = parseInt(parts[1], 10);
  dev.lastTimestamp = timestamp;
  dev.lastMsgType = type;
  _stampSeen(dev);

  switch (type) {
    case 'A': { // Euler angles: roll, pitch, yaw (degrees)
      if (parts.length >= 5) {
        const r = parseFloat(parts[2]);
        const p = parseFloat(parts[3]);
        const y = parseFloat(parts[4]);
        // Whole-object replacement, not field-by-field — see the note in
        // handleOSCSensorQuaternion. A partial write is a pose nothing measured.
        dev.rawEuler = { roll: r, pitch: p, yaw: y };
        // Cross-populate quaternion so getCalibratedEuler/Quat always works
        const q = eulerDegToQuat(r, p, y);
        dev.rawQuat = { x: q[0], y: q[1], z: q[2], w: q[3] };
      }
      break;
    }

    case 'Q': { // Quaternion: w, x, y, z
      if (parts.length >= 6) {
        const w = parseFloat(parts[2]);
        const x = parseFloat(parts[3]);
        const y = parseFloat(parts[4]);
        const z = parseFloat(parts[5]);
        dev.rawQuat  = { x, y, z, w };
        // Cross-populate Euler so raw readout always works
        dev.rawEuler = quatToEulerDeg(x, y, z, w);
      }
      break;
    }

    case 'S': {
      // Serial accessory payload — x-IMU3 manual §8.2.14.  Unlike Q/I we can't
      // check a field count: the payload is passed through verbatim and may
      // itself contain commas (the SA-A8 emits 8 CSVs).  Everything after the
      // timestamp is payload; interpreting it is the accessory type's job.
      dev.lastAccessoryAt = performance.now();
      S._onAccessoryData?.(dev, parts.slice(2), timestamp);
      break;
    }

    default:
      // Anything else — inertial ('I'), magnetometer ('M'), high-g, temperature,
      // battery, RSSI — is disabled at the device by ximu-settings.js.  Arriving
      // here means enforcement did not take, so count it rather than silently
      // dropping it: this is the cheapest signal that the handshake failed.
      _noteUnexpectedType(dev, type);
      break;
  }
}

// Warn once per message type per device, then keep counting quietly.  A device
// mid-handshake can legitimately emit a few stale messages before `apply` lands,
// so the first few are absorbed before saying anything.
const _UNEXPECTED_GRACE = 20;

function _noteUnexpectedType(dev, type) {
  if (!type || EXPECTED_MESSAGE_TYPES.includes(type)) return;
  const n = (dev.unexpectedTypes.get(type) || 0) + 1;
  dev.unexpectedTypes.set(type, n);
  if (n === _UNEXPECTED_GRACE) {
    console.warn(
      `[imu-setup] ${dev.name} (${dev.sn}) is streaming '${type}' messages that mubone does not consume — ` +
      `settings enforcement did not take.  Check the console for setting mismatches, and check whether a ` +
      `Max patch or the x-IMU3 GUI has written a message rate divisor since.`
    );
  }
}

// ── Feed pre-calibrated quaternion to sensor-registry ───────────────────────

function feedToRegistry(dev) {
  // The sensor's own quaternion, uncalibrated. Everything — mount, heading,
  // signs, mute — is applied once, inside the registry, in a fixed order.
  const q = dev.getFeedQuat();
  handleSlotQuaternion(getOrCreateSlot(dev.slotName), q);
}

// ── OSC sensor intake ───────────────────────────────────────────────────────
// Called by osc.js when a /sensor/{name}/quaternion or /sensor/{name}/inertial
// message arrives.  Auto-creates a DeviceState on first contact, runs
// calibration, and feeds to registry — same pipeline as WiFi/serial devices.

// A sensor that arrives over OSC is anonymous by construction — the address
// namespace carries a name, never a make. So the module that owns the
// connection says what it is, once, as soon as it knows: sygaldry.js calls this
// when the instrument reports its own name. Without it a first-party instrument
// is indistinguishable from a Max bridge, which is exactly how one came to be
// listed as "x-imu3 · osc" while sitting on a USB cable.
export function declareSensorKind(name, kind, via = null) {
  const dev = _devices.get('osc-' + name);
  if (!dev) return null;
  if (dev.kind === kind && dev.via === via) return dev;   // nothing to repaint
  dev.kind = kind;
  dev.via  = via;
  _onDeviceUpdated?.(dev);
  // The wire word just changed — S.rig and the pill derive from the
  // sensor-status event, and the last one was dispatched before this
  // declaration existed (the pill read "osc" for a wifi instrument, Ek).
  _syncSensorStatus();
  return dev;
}

// Forget an OSC sensor entirely: the device, its registry slot, its saved
// calibration and its saved role. An OSC sensor is auto-discovered by its
// first packet and, until this existed, could never be un-discovered — the
// prefs and the calibration table both MERGE on save, so a name seen once
// was kept for good. The align audit's `__rt10__` probe is the case that
// found it; a renamed instrument is the other.
export function forgetOscSensor(name) {
  const sn = 'osc-' + name;
  const dev = _devices.get(sn);
  if (dev) { dev.feeding = false; _devices.delete(sn); }
  forgetSlot(sn);
  const prefs = _loadDevicePrefs();
  if (sn in prefs) {
    delete prefs[sn];
    try { localStorage.setItem(_LS_DEVICE_PREFS_KEY, JSON.stringify(prefs)); } catch (_) {}
  }
  if (dev) { _onDeviceUpdated?.(dev); _syncSensorStatus(); }
  return !!dev;
}

export function handleOSCSensorQuaternion(name, values) {
  let dev = _devices.get('osc-' + name);
  if (!dev) {
    dev = new DeviceState('osc-' + name, name, { transport: 'osc' });
    _applyDevicePrefs(dev);
    dev.feeding = true;  // auto-feed — OSC sensors are always live
    _devices.set('osc-' + name, dev);
    _initOscSlot(dev);
    _onDeviceUpdated?.(dev);
    _syncSensorStatus();
    DEBUG && console.log(`[imu-setup] OSC sensor auto-discovered: ${name} (role: ${dev.role})`);
  }

  // Store raw quaternion — osc.js sends [qx, qy, qz, qw] or [w, x, y, z]
  // Registry convention from Max is [qx, qy, qz, qw] (same as sphere.js)
  //
  // Replaced whole, never field by field. Four separate assignments leave the
  // object briefly holding two packets at once, and any async reader — a rAF
  // readout, a probe — can sample the seam and see a quaternion that was never
  // measured. Observed as 1°+ spikes on a sensor sitting still (2026-08-31).
  // The engine never saw them (feedToRegistry runs synchronously below), but
  // "never" should not depend on who happens to read it.
  dev.rawQuat = { x: values[0], y: values[1], z: values[2], w: values[3] };
  dev.lastMsgType = 'Q';
  dev.lastTimestamp = Date.now();
  _stampSeen(dev);

  // Cross-populate Euler — replaced whole, for the reason above.
  dev.rawEuler = quatToEulerDeg(values[0], values[1], values[2], values[3]);

  _onDataReceived?.(dev);

  if (dev.feeding) {
    feedToRegistry(dev);
  }
}

export function handleOSCSensorInertial(name, values) {
  let dev = _devices.get('osc-' + name);
  if (!dev) {
    dev = new DeviceState('osc-' + name, name, { transport: 'osc' });
    _applyDevicePrefs(dev);
    dev.feeding = true;
    _devices.set('osc-' + name, dev);
    _initOscSlot(dev);
    _onDeviceUpdated?.(dev);
    _syncSensorStatus();
    DEBUG && console.log(`[imu-setup] OSC sensor auto-discovered (inertial): ${name}`);
  }

  dev.rawInertial = { gx: values[0], gy: values[1], gz: values[2],
                      ax: values[3], ay: values[4], az: values[5] };
  dev.lastMsgType = 'I';
  // Liveness is per DEVICE, not per stream: a peer sending only /inertial is
  // as connected as one sending only /quaternion, and the sources badge greys
  // on this field. Stamped here too or such a peer reads as silent forever.
  dev.lastTimestamp = Date.now();
  _stampSeen(dev);

  _onDataReceived?.(dev);

  // Inertial goes straight to registry (no calibration transform for gyro/accel)
  if (dev.feeding) {
    const slot = getOrCreateSlot(dev.slotName);
    handleSlotInertial(slot, values);
  }
}

function _initOscSlot(dev) {
  // getOrCreateSlot() primes a NEW slot from saved calibration, so this must
  // not overwrite it. Wiping here is what made a calibration last exactly
  // until the next reload: the first OSC packet arrives, the slot is created
  // with its saved mount and heading, and the old code nulled both on the
  // very next line (2026-08-31).
  const slot = getOrCreateSlot(dev.slotName);
  _applyMigratedSigns(slot);
  assignQuatRole(dev.slotName, dev.role);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Extract known fields from a command response and apply to the device.
// Centralised so every response path (proxy, Electron UDP, Electron serial,
// WebSerial) updates the same set of fields.
function _applyResponseFields(dev, json) {
  _noteVerifyResponse(dev, json);
  if (json.axes_alignment       !== undefined) dev.axesAlignment      = json.axes_alignment;
  if (json.wi_fi_ap_channel     !== undefined) dev.wifiApChannel      = json.wi_fi_ap_channel;
  if (json.wi_fi_ap_ssid        !== undefined) dev.wifiApSsid         = json.wi_fi_ap_ssid;
  if (json.wi_fi_client_channel !== undefined) dev.wifiClientChannel  = json.wi_fi_client_channel;
  if (json.wi_fi_client_ssid    !== undefined) dev.wifiClientSsid     = json.wi_fi_client_ssid;
  if (json.wi_fi_region         !== undefined) dev.wifiRegion         = json.wi_fi_region;
  if (json.serial_mode          !== undefined) { dev.serialMode = json.serial_mode; _onDeviceUpdated?.(dev); }
  if (json.device_name          !== undefined) { dev.name = json.device_name; _onDeviceUpdated?.(dev); }
  if (json.serial_number        !== undefined) { _onDeviceUpdated?.(dev); }
  // WiFi info triggers a card refresh so channel/SSID can display
  if (json.wi_fi_ap_channel     !== undefined || json.wi_fi_ap_ssid    !== undefined ||
      json.wi_fi_client_channel !== undefined || json.wi_fi_client_ssid !== undefined) {
    _onDeviceUpdated?.(dev);
  }
}

// ── Liveness: the connection state IS packets arriving (Ek, 2026-09-09) ────
// "when i disconnected the usb the header icon and the sensor page still
// show connected. it's clearly sending 0 hz." A device in the map is one that
// has been seen, not one that is here: an OSC device has no socket to close,
// a cable pulled mid-set closes nothing on our side, and the link object's own
// loss detection never reached the map. So a device is UP while a packet has
// arrived within LIVE_MS, on OUR clock (lastSeenAt — never lastTimestamp,
// which for an x-imu3 is its own µs-since-boot), and everything that says
// "connected" — the header readout, S.rig, the list's badge and count — reads
// that. Two seconds is well clear of the slowest stream that matters and
// short enough that a pulled cable is seen before anyone finishes looking.
// The rising edge is immediate (first packet); the falling edge is the tick.
export const LIVE_MS = 2000;
export function isLive(dev) {
  return !!dev.lastSeenAt && (Date.now() - dev.lastSeenAt) < LIVE_MS;
}
function _stampSeen(dev) {
  dev.lastSeenAt = Date.now();
  if (!dev.live) { dev.live = true; _onDeviceUpdated?.(dev); _syncSensorStatus(); }
}
function _liveTick() {
  let changed = false;
  for (const dev of _devices.values()) {
    const now = isLive(dev);
    if (now === dev.live) continue;
    dev.live = now; changed = true;
    _onDeviceUpdated?.(dev);
  }
  if (changed) _syncSensorStatus();
}

// Notify the rest of the app that sensor connection state changed.
// A device is "connected" while it is LIVE — see isLive.
function _syncSensorStatus() {
  const devs = [..._devices.values()];
  const live = devs.filter(d => d.live);
  const hasFeeding = live.some(d => d.feeding);
  const hasAny     = live.length > 0;

  // Build transport summary for the main-page indicator — live devices only
  const transports = new Set();
  let count = 0;
  for (const d of live) {
    count++;
    // A sygaldry instrument is FILED under transport 'osc' whatever the wire
    // was; `via` carries the real one ('wifi' / 'cable'). Every word shown to
    // a person derives from via first — an instrument on wifi is a wifi
    // sensor, and OSC is the rare case, not the default answer (Ek).
    const wire = d.via === 'cable' ? 'serial' : (d.via || d.transport);
    if (wire === 'serial')    transports.add('serial');
    else if (wire === 'udp' || wire === 'wifi') transports.add('wifi');
    else if (wire === 'osc')  transports.add('osc');
  }

  // Announcing but not connected — the pill's 'found' state (R9).
  let found = 0;
  for (const sn of _discovered.keys()) if (!_devices.has(sn)) found++;
  window.dispatchEvent(new CustomEvent('sensor-status', {
    detail: {
      connected: hasAny,
      feeding:   hasFeeding,
      found,
      count,
      transports: [...transports],
      devices: devs.map(d => ({
        sn: d.sn,
        name: d.name,
        slotName: d.slotName,
        role: d.role,
        feeding: d.feeding,
        live: d.live,
        transport: d.transport,
        via: d.via || null,
      })),
    },
  }));
}

function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

export function getAlignmentLabel(value) {
  const entry = AXES_ALIGNMENTS.find(a => a[0] === value);
  return entry ? entry[1] : '+X+Y+Z';
}
