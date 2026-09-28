// ============================================================================
// ximu3.js — the x-imu3 LINK: finding one, connecting, talking to it
//
// A LINK in the three layers (sensor-registry.js's header has the map). Owns
// everything that is true of the x-imu3 and nothing else: wifi discovery, the
// UDP and serial transports (Electron IPC, or WebSerial + proxy.js in a
// browser), the ASCII protocol, the settings handshake (ximu-settings.js),
// the LED blink, the hardware axes alignment. A connected unit becomes a
// Sensor (sensors.js) keyed by its serial number, slot `ximu3-<sn>`; its
// quaternions go to sensors.feed(). Calibration and role are not here.
//
// Protocol reference: x-IMU3 User Manual v1.11, sections 8–11.
// ============================================================================

import { S, DEBUG } from './state.js';
import {
  Sensor, getSensors, getSensor, addSensor, removeSensor, rekeySensor, startFeeding,
  feed, stampSeen, notifyData, notifyUpdated, syncSensorStatus, initSensors,
  onRoleChanged, setFoundCounter, clearMountCal,
} from './sensors.js';
import {
  settingsFor, EXPECTED_MESSAGE_TYPES, VERIFY_TIMEOUT_MS, VERIFY_DELAY_MS,
} from './ximu-settings.js';

// A Sensor plus what only an x-imu3 has. Transport 'udp' carries ip / send
// (the port it sends data TO — we listen there) / receive (the port it
// listens on); 'serial' carries serialPath.
function _newXimu3(sn, name, transport, conn) {
  const dev = new Sensor(sn, name, { transport, kind: 'x-imu3' });
  Object.assign(dev, {
    ip: null, send: 0, receive: 0, serialPath: null, ...conn,
    axesAlignment: 0,             // hardware, stored on the device
    // Wifi, queried on connect. AP vs client is a boot state, not a setting;
    // RSSI is -1 in AP mode, so the mode is inferred from it.
    wifiApChannel: null, wifiApSsid: null, wifiClientChannel: null, wifiClientSsid: null,
    wifiRegion: null,             // 1=US, 2=EU, 3=JP
    // Serial accessory (x-IMU3-SA-A8): serialMode is read on connect, never
    // written. An accessory is observed from data, not configuration — the
    // adapter hot-plugs, so lastAccessoryAt going stale IS the unplug.
    serialMode: null, lastAccessoryAt: 0,
    settingsVerify: null,         // { ok, mismatched, unanswered, at } — verifySettings
    unexpectedTypes: new Map(),   // message letters seen that mubone does not consume
  });
  return dev;
}

// Discovery forgets: a unit not heard from in DISCOVERY_STALE_MS leaves the
// list (proxy.js prunes the same way; Electron never did, so "N more found"
// counted a powered-off sensor for the whole set — 2026-09-16).
function _forgetStaleDiscoveries() {
  const cutoff = Date.now() - DISCOVERY_STALE_MS;
  let forgot = false;
  for (const [sn, e] of _discovered) {
    if (!getSensor(sn) && e.lastSeen < cutoff) { _discovered.delete(sn); forgot = true; }
  }
  if (forgot) { _onDeviceDiscovered?.(null); syncSensorStatus(); }
}

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

// ── Euler (degrees) → Quaternion [x, y, z, w] ──────────────────────────────
// (quatToEulerDeg is sensor-registry's — one copy since 2026-09-16.)
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


// Data lines dropped because their source IP matched no connected device
// while >1 UDP device was connected (misrouted / foreign-instance traffic).
let _unknownSourceDrops = 0;

// ── Global state ────────────────────────────────────────────────────────────

// Discovered x-IMU3 devices via WiFi, keyed by serial number.
// Each entry: { name, sn, ip, port, send, receive, battery, status, rssi, lastSeen }
const _discovered = new Map();

// Available serial ports (refreshed on scan).
// Each entry: { path, manufacturer, serialNumber, vendorId, productId }
let _serialPortList = [];

// Reverse lookup: serial port path → Sensor  (for routing serial data)
const _serialPathToDevice = new Map();

// Callbacks for UI updates
let _onDeviceDiscovered = null;
let _onSerialPortsChanged = null;
let _onCommandResponse  = null;
let _onCommandSent      = null;   // fired when a command is sent to a device

// ── Public API ──────────────────────────────────────────────────────────────

export function getDiscovered()       { return _discovered; }
export function getSerialPorts()      { return _serialPortList; }

export function setOnDeviceDiscovered(cb)  { _onDeviceDiscovered = cb; }
export function setOnSerialPortsChanged(cb){ _onSerialPortsChanged = cb; }
export function setOnCommandResponse(cb)   { _onCommandResponse = cb; }
export function setOnCommandSent(cb)       { _onCommandSent = cb; }

// ── Browser-mode transport (WebSerial + proxy control channel) ──────────────
// When not in Electron, we use:
//   - WebSerial API (Chrome) for USB serial connections
//   - WebSocket to proxy.js control channel (port 8081) for WiFi discovery/commands
// The proxy data channel (port 8080) is handled by osc.js.

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
    DEBUG && console.log('[ximu3] hosted origin — skipping local proxy control channel');
  }

  // WebSerial is available — serial scanning handled on demand via scanSerialPorts()
  if (navigator.serial) {
    DEBUG && console.log('[ximu3] WebSerial API available');
  } else {
    DEBUG && console.log('[ximu3] WebSerial API not available in this browser');
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
    DEBUG && console.log('[ximu3] proxy control channel connected');
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
      const dev = getSensor(d.sn);
      if (dev) { dev.ip = entry.ip; dev.send = entry.send; dev.receive = entry.receive; }
      _onDeviceDiscovered?.(entry);
      break;
    }
    case 'discovery-lost':
      _discovered.delete(msg.sn);
      _onDeviceDiscovered?.(null);
      break;
    // The proxy tells a new page what it is ALREADY connected to — after a
    // reload, say. The page's Sensor went with the reload; the proxy's link did
    // not, so the unit is taken back as it is, and feeds. (Before 2026-09-27
    // the proxy also relayed it as /sensor/… OSC, which registered it by
    // itself; that relay was a second path for the same unit and went.)
    case 'connected': {
      const d = msg.data;
      if (!d?.sn || getSensor(d.sn)) break;
      const dev = addSensor(_newXimu3(d.sn, d.name || 'x-IMU3', 'udp', { ip: d.ip, send: d.send, receive: d.receive }));
      startFeeding(dev);
      break;
    }
    case 'data': {
      // Raw data line from the proxy, for a wifi unit in browser mode — the
      // same parser as Electron's. Routed by source IP; the fallback only when
      // exactly ONE unit is connected, as in Electron: with several, a line
      // from an unknown source must never land on an arbitrary one.
      if (!msg.line || !msg.sourceIP) break;
      let dev = null, udp = [];
      for (const d of getSensors().values()) {
        if (d.transport !== 'udp') continue;
        udp.push(d);
        if (d.ip === msg.sourceIP) { dev = d; break; }
      }
      if (!dev && udp.length === 1) dev = udp[0];
      if (dev) {
        parseDataLine(dev, msg.line);
        notifyData(dev);
        feed(dev);
      }
      break;
    }
    case 'command-response': {
      const json = msg.data;
      let matched = null;
      if (msg.sourceIP) {
        for (const d of getSensors().values()) {
          if (d.transport === 'udp' && d.ip === msg.sourceIP) { matched = d; break; }
        }
      }
      if (!matched) matched = _onlyUdp();   // with several units, an unknown source matches none
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
                if (json.serial_number !== dev.sn && _isTempKey(dev.sn)) _adoptSerialNumber(dev, json.serial_number);
              }
              _applyResponseFields(dev, json);
              _onCommandResponse?.(json);
            } catch (_) {}
          } else {
            parseDataLine(dev, line);
            notifyData(dev);
            feed(dev);
          }
        }
      }
    } catch (e) {
      if (running) console.warn(`[ximu3] WebSerial read error: ${e.message}`);
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
    DEBUG && console.warn(`[ximu3] WebSerial port.close() error: ${e.message}`);
  }
  _webSerialPorts.delete(portId);
}

async function _webSerialSend(portId, str) {
  const entry = _webSerialPorts.get(portId);
  if (!entry) return;
  const payload = str.endsWith('\n') ? str : str + '\n';
  try { await entry.writer.write(payload); } catch (e) {
    console.warn(`[ximu3] WebSerial write error: ${e.message}`);
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

export function initXimu3() {
  initSensors();
  // The unit that just became the cursor blinks three times — which one it is,
  // in your hand.
  onRoleChanged(dev => { if (dev.role === 'cursor') blinkDevice(dev, 3, 150); });
  setFoundCounter(() => { let n = 0; for (const sn of _discovered.keys()) if (!getSensor(sn)) n++; return n; });
  setInterval(_forgetStaleDiscoveries, 500);

  const bridge = window.electronBridge;

  if (!bridge?.isElectron) {
    // Browser mode — use WebSerial + proxy control channel
    DEBUG && console.log('[ximu3] browser mode — WebSerial + proxy for WiFi');
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
    const dev = getSensor(sn);
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
    for (const d of getSensors().values()) {
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
          console.warn(`[ximu3] dropped ${_unknownSourceDrops} data lines from unknown source ${sourceIP} — is another device sending to this port?`);
        }
        return;
      }
    }
    if (!dev) return;

    parseDataLine(dev, line);
    notifyData(dev);

    feed(dev);
  });

  // Listen for command responses (UDP) — route by source IP
  bridge.onXIMU3CommandResponse?.((json, sourceIP) => {
    DEBUG && console.log('[ximu3] UDP command response:', json, sourceIP);
    let matched = null;
    if (sourceIP) {
      for (const dev of getSensors().values()) {
        if (dev.transport === 'udp' && dev.ip === sourceIP) { matched = dev; break; }
      }
    }
    // An unknown source goes to the one UDP unit if there is exactly one —
    // with several, a response must not land on an arbitrary unit, where it
    // would corrupt that unit's settings read-back (as the data path, :470).
    if (!matched) matched = _onlyUdp();
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
    notifyData(dev);

    feed(dev);
  });

  bridge.onSerialResponse?.((portPath, json) => {
    DEBUG && console.log(`[ximu3] serial response from ${portPath}:`, json);
    const dev = _serialPathToDevice.get(portPath);
    if (!dev) return;

    // Populate device info from query responses
    if (json.device_name !== undefined) dev.name = json.device_name;
    if (json.serial_number !== undefined) {
      // Re-key device if serial number was unknown (connected before query returned)
      if (json.serial_number !== dev.sn && _isTempKey(dev.sn)) _adoptSerialNumber(dev, json.serial_number);
    }
    _applyResponseFields(dev, json);

    _onCommandResponse?.(json);
  });

  DEBUG && console.log('[ximu3] initialized — listening for x-IMU3 discovery + serial');
}

// ── Serial port scanning ────────────────────────────────────────────────────

export async function scanSerialPorts() {
  const bridge = window.electronBridge;

  // Electron mode — use IPC
  if (bridge?.serialListPorts) {
    _serialPortList = await bridge.serialListPorts();
    _onSerialPortsChanged?.(_serialPortList);
    DEBUG && console.log(`[ximu3] found ${_serialPortList.length} serial ports`);
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
      DEBUG && console.log(`[ximu3] WebSerial: ${_serialPortList.length} previously-granted ports`);
      return _serialPortList;
    } catch (e) {
      DEBUG && console.warn(`[ximu3] WebSerial getPorts error: ${e.message}`);
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
    DEBUG && console.log(`[ximu3] WebSerial port request cancelled or failed: ${e.message}`);
    return null;
  }
}

// ── Connect / disconnect ────────────────────────────────────────────────────

// Connect a WiFi-discovered device (by serial number from discovery list)
export async function connectDevice(sn) {
  const info = _discovered.get(sn);
  if (!info) return false;

  const bridge = window.electronBridge;

  const dev = addSensor(_newXimu3(sn, info.name, 'udp', {
    ip: info.ip, send: info.send, receive: info.receive,
  }));
  // Feeding is implied by being connected. Nothing set it on this path after
  // the "feeds the sphere" toggle went (2026-09-01), so a direct x-imu3 drove
  // nothing until its role dropdown was changed by hand (2026-09-27).
  startFeeding(dev);

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

  syncSensorStatus();
  DEBUG && console.log(`[ximu3] UDP connected to ${info.name} (${sn}) at ${info.ip}`);
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
        DEBUG && console.warn(`[ximu3] WebSerial port not found: ${portPathOrObj}`);
        return false;
      }
    }

    try {
      portId = await _webSerialOpen(wsPort);
    } catch (e) {
      DEBUG && console.warn(`[ximu3] WebSerial open failed: ${e.message}`);
      return false;
    }

    const tempSn = 'serial-' + portId.replace(/[^a-zA-Z0-9]/g, '');
    const dev = addSensor(_newXimu3(tempSn, portId, 'serial', { serialPath: portId, pendingKey: true }));
    _serialPathToDevice.set(portId, dev);
    DEBUG && console.log(`[ximu3] WebSerial connected on ${portId}`);

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
    _feedWhenKeyed(dev);
    return true;
  }

  // ── Electron mode: IPC serial ──
  const portPath = portPathOrObj;
  if (!bridge?.serialOpen) return false;

  const result = await bridge.serialOpen(portPath);
  if (!result?.ok) return false;

  const tempSn = 'serial-' + portPath.replace(/[^a-zA-Z0-9]/g, '');
  const dev = addSensor(_newXimu3(tempSn, portPath, 'serial', { serialPath: portPath, pendingKey: true }));
  _serialPathToDevice.set(portPath, dev);
  DEBUG && console.log(`[ximu3] serial connected on ${portPath}`);

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
  _feedWhenKeyed(dev);
  return true;
}

// The one UDP unit, or null when there are none or several.
function _onlyUdp() {
  let one = null;
  for (const d of getSensors().values()) {
    if (d.transport !== 'udp') continue;
    if (one) return null;
    one = d;
  }
  return one;
}

// A serial device feeds once it has its real serial number: its slot is named
// from it, and a slot minted under the tty path would keep a role and a
// calibration for a sensor that is renamed a second later. Anything that never
// answers is not an x-imu3 and never feeds.
function _feedWhenKeyed(dev) {
  if (!_isTempKey(dev.sn)) startFeeding(dev);
  else dev._feedOnKey = true;
}

// A serial device is keyed `serial-<path>` until it answers with its serial
// number; an x-imu3 answers within a second, anything else never does.
function _isTempKey(sn) { return sn.startsWith('serial-'); }

function _adoptSerialNumber(dev, sn) {
  if (!rekeySensor(dev, sn)) return;   // already connected another way — that link feeds
  dev.pendingKey = false;
  if (dev._feedOnKey) { dev._feedOnKey = false; startFeeding(dev); }
}

// Let a connected sensor go: its transport closes and the device leaves the
// list, and NOTHING ELSE — its registry slot keeps its mounting calibration,
// its role and its saved prefs, so a reconnect is the same sensor (a forget is
// forgetOscSensor). A wifi x-imu3 keeps announcing itself, so it is back in
// the list as a Connect row within a second; a cable is back on Rescan. (A
// mubone instrument's link is sygaldry's to close — ui-sygaldry sygDisconnect,
// then sensors.removeSensor for the row.)
export async function disconnectDevice(sn) {
  const dev = getSensor(sn);
  if (!dev) return false;
  const bridge = window.electronBridge;
  removeSensor(sn);
  if (dev.transport === 'udp') {
    if (bridge?.isElectron) await bridge.ximu3StopData(dev.send);
    else _sendProxyControl({ type: 'disconnect', sn });
  } else if (dev.transport === 'serial') {
    _serialPathToDevice.delete(dev.serialPath);
    if (bridge?.isElectron) await bridge.serialClose(dev.serialPath);
    else await _webSerialClose(dev.serialPath);
  }
  DEBUG && console.log(`[ximu3] disconnected ${dev.name} (${sn})`);
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
// any other host that has talked to the device write settings that persist in
// flash (the old prototyping patches left inertial messages at 400 Hz and the
// magnetometer stream on), and a device that has been through one arrives
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

const _verifyPending = new Map();   // Sensor → { want, got } — the object, not its sn: a serial unit's sn changes mid-sweep

export async function verifySettings(dev) {
  if (!dev || dev.transport === 'osc') return null;

  const want = settingsFor(dev.transport);
  const state = { want, got: {} };
  _verifyPending.set(dev, state);

  // Let the write echoes drain first, or they'd be counted as read responses.
  // (They carry the desired value, so they could only ever mask a failure.)
  await _delay(VERIFY_DELAY_MS);

  for (const key of Object.keys(want)) {
    sendCommandTo(dev, { [key]: null });
  }

  await _delay(VERIFY_TIMEOUT_MS);
  _verifyPending.delete(dev);

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
      `[ximu3] ${dev.name} (${dev.sn}): ${mismatched.length} setting(s) did not take —`,
      mismatched.map(m => `${m.key}: wanted ${m.want}, device reports ${m.got}`).join('; ')
    );
    // serial_mode failing is the one that bites silently.  SA-A8s get swapped on
    // and off mid-show, so a device stuck out of Accessory mode looks identical
    // to one that simply has nothing plugged in right now.
    if (mismatched.some(m => m.key === 'serial_mode')) {
      console.warn(
        `[ximu3] ${dev.name} (${dev.sn}) is not in serial Accessory mode — it cannot receive an SA-A8, ` +
        `whether or not one is attached now.  Try:  acc.setAccessoryMode(true, '${dev.sn}')  (writes with save)`
      );
    }
  }

  if (unanswered.length) {
    DEBUG && console.warn(
      `[ximu3] ${dev.name} (${dev.sn}): no read-back for ${unanswered.length} key(s) — ${unanswered.join(', ')}`
    );
  }
  if (result.ok && !unanswered.length) {
    DEBUG && console.log(`[ximu3] ${dev.name} (${dev.sn}): all settings verified`);
  }

  notifyUpdated(dev);
  return result;
}

// Called from _applyResponseFields for every command response.
function _noteVerifyResponse(dev, json) {
  const state = _verifyPending.get(dev);
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

// ── AHRS message type ───────────────────────────────────────────────────────

export function requestEulerMode(dev) {
  sendCommandTo(dev, { ahrs_message_type: 2 });
  setTimeout(() => sendCommandTo(dev, { apply: null }), 100);
}

// ── ASCII data parser ───────────────────────────────────────────────────────

function parseDataLine(dev, line) {
  const parts = line.split(',');
  if (parts.length < 3) return;

  const type = parts[0];
  const timestamp = parseInt(parts[1], 10);
  dev.lastMsgType = type;
  stampSeen(dev);

  switch (type) {
    case 'A': { // Euler angles: roll, pitch, yaw (degrees) — requestEulerMode only
      if (parts.length >= 5) {
        dev.setQuat(...eulerDegToQuat(parseFloat(parts[2]), parseFloat(parts[3]), parseFloat(parts[4])));
      }
      break;
    }

    case 'Q': { // Quaternion: w, x, y, z
      if (parts.length >= 6) {
        dev.setQuat(parseFloat(parts[3]), parseFloat(parts[4]), parseFloat(parts[5]), parseFloat(parts[2]));
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
      `[ximu3] ${dev.name} (${dev.sn}) is streaming '${type}' messages that mubone does not consume — ` +
      `settings enforcement did not take.  Check the console for setting mismatches, and check whether a ` +
      `the x-IMU3 GUI or another host has written a message rate divisor since.`
    );
  }
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
  if (json.serial_mode          !== undefined) { dev.serialMode = json.serial_mode; notifyUpdated(dev); }
  if (json.device_name          !== undefined) { dev.name = json.device_name; notifyUpdated(dev); }
  if (json.serial_number        !== undefined) { notifyUpdated(dev); }
  // WiFi info triggers a card refresh so channel/SSID can display
  if (json.wi_fi_ap_channel     !== undefined || json.wi_fi_ap_ssid    !== undefined ||
      json.wi_fi_client_channel !== undefined || json.wi_fi_client_ssid !== undefined) {
    notifyUpdated(dev);
  }
}

const DISCOVERY_STALE_MS = 15000;

function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

export function getAlignmentLabel(value) {
  const entry = AXES_ALIGNMENTS.find(a => a[0] === value);
  return entry ? entry[1] : '+X+Y+Z';
}
