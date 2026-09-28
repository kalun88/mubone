#!/usr/bin/env node
// ============================================================================
// proxy.js — the x-IMU3's UDP, for a browser (which cannot open UDP sockets)
//
// Requires only Node.js + ws package:  npm install ws
//
// ONE WebSocket, port 8081: discovery, connect/disconnect, commands, and every
// data line raw — js/ximu3.js parses them exactly as it does in Electron, so a
// unit is the same Sensor, with the same settings handshake, either way.
//
// It used to ALSO convert the lines to /sensor/{name}/quaternion on port 8080,
// the browser's OSC input. With the direct connect feeding too (2026-09-27),
// one unit became two rows and two feeds, so the conversion — and the 8080
// server, which then carried nothing — went. Port 8080 is still the browser's
// OSC input for any other relay (osc.js).
//
// Launch:  node proxy.js
// ============================================================================

const dgram = require('dgram');
const { WebSocketServer, WebSocket } = require('ws');

// ── Config ───────────────────────────────────────────────────────────────────

const DISCOVERY_PORT = 10000;
const DATA_PORT_DEFAULT = 8000;
const CMD_PORT_DEFAULT  = 9000;
const WS_CONTROL_PORT = 8081;   // discovery, commands, data lines

// ── State ────────────────────────────────────────────────────────────────────

// Discovered devices: sn → { name, sn, ip, port, send, receive, battery, rssi, status, lastSeen }
const discovered = new Map();

// Connected devices: sn → { sn, name, ip, send, receive }
const connected = new Map();

// UDP sockets
let discoverySock = null;
let dataSock = null;
let dataPort = 0;
let cmdSock = null;

// Line buffers for ASCII data (LF-terminated), one per source IP: two
// instruments interleave packets, and one shared buffer spliced their frames
// (electron-main.js made the same fix for the show path).
const dataBufs = new Map();

// ── WebSocket servers ────────────────────────────────────────────────────────

const wssControl = new WebSocketServer({ port: WS_CONTROL_PORT });

console.log(`[proxy] WebSocket on ws://localhost:${WS_CONTROL_PORT} (discovery, commands, data)`);

function broadcastControl(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of wssControl.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// ── UDP discovery listener ───────────────────────────────────────────────────

discoverySock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

discoverySock.on('message', (msg, rinfo) => {
  try {
    const json = JSON.parse(msg.toString('utf8'));
    const sn = json.sn || json.serial_number;
    if (!sn) return;

    const entry = {
      name:     json.name || json.device_name || 'x-IMU3',
      sn,
      ip:       rinfo.address,
      port:     json.port,
      send:     json.send,
      receive:  json.receive,
      battery:  json.battery,
      rssi:     json.rssi,
      status:   json.status,
      lastSeen: Date.now(),
    };
    discovered.set(sn, entry);

    // Forward discovery to control channel
    broadcastControl({ type: 'discovery', data: entry });
  } catch (_) {
    // Not JSON — ignore
  }
});

discoverySock.on('error', (err) => {
  console.warn(`[proxy] discovery UDP error: ${err.message}`);
});

discoverySock.bind(DISCOVERY_PORT, '0.0.0.0', () => {
  console.log(`[proxy] discovery listening on UDP 0.0.0.0:${DISCOVERY_PORT}`);
});

// ── UDP data listener ────────────────────────────────────────────────────────

function startDataListener(port) {
  if (dataSock) {
    try { dataSock.close(); } catch (_) {}
    dataSock = null;
  }
  dataPort = port;
  dataBufs.clear();

  dataSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  dataSock.on('message', (msg, rinfo) => {
    const sourceIP = rinfo.address;
    let dataBuf = (dataBufs.get(sourceIP) || '') + msg.toString('utf8');
    if (dataBuf.length > 65536) dataBuf = '';   // a binary-mode device never sends a newline
    let nlIdx;
    while ((nlIdx = dataBuf.indexOf('\n')) !== -1) {
      const line = dataBuf.slice(0, nlIdx).trim();
      dataBuf = dataBuf.slice(nlIdx + 1);
      if (!line) continue;

      if (line[0] === '{') {
        // JSON command response
        try {
          const json = JSON.parse(line);
          broadcastControl({ type: 'command-response', data: json, sourceIP });
        } catch (_) {}
      } else {
        routeDataLine(line, sourceIP);
      }
    }
    dataBufs.set(sourceIP, dataBuf);
  });

  dataSock.on('error', (err) => {
    console.warn(`[proxy] data UDP error on port ${port}: ${err.message}`);
  });

  dataSock.bind(port, '0.0.0.0', () => {
    console.log(`[proxy] data listening on UDP 0.0.0.0:${port}`);
  });
}

function stopDataListener() {
  if (dataSock) {
    try { dataSock.close(); } catch (_) {}
    dataSock = null;
    dataPort = 0;
    dataBufs.clear();
  }
}

// ── Relay a data line ────────────────────────────────────────────────────────
// Raw, with its source IP: ximu3.js routes it to the unit and parses it.
// Battery (B) and RSSI (W) also go out as a status for the discovery list.

function routeDataLine(line, sourceIP) {
  const type = line[0];
  if (type === 'B' || type === 'W') {
    let dev = null;
    for (const d of connected.values()) if (d.ip === sourceIP) { dev = d; break; }
    if (dev) broadcastControl({ type: 'sensor-status', sn: dev.sn, line, sourceIP });
  }
  broadcastControl({ type: 'data', line, sourceIP });
}

// ── Send UDP command to device ───────────────────────────────────────────────

function sendCommand(ip, port, jsonObj) {
  if (!cmdSock) {
    cmdSock = dgram.createSocket('udp4');
    cmdSock.on('error', (err) => {
      console.warn(`[proxy] command send error: ${err.message}`);
    });
  }
  const payload = JSON.stringify(jsonObj) + '\n';
  const buf = Buffer.from(payload, 'utf8');
  cmdSock.send(buf, 0, buf.length, port, ip, (err) => {
    if (err) console.warn(`[proxy] failed to send to ${ip}:${port} — ${err.message}`);
  });
}

// ── Control channel message handling ─────────────────────────────────────────

wssControl.on('connection', (ws) => {
  console.log('[proxy] control client connected');

  // Send current discovery list on connect
  for (const entry of discovered.values()) {
    ws.send(JSON.stringify({ type: 'discovery', data: entry }));
  }

  // Send current connected devices
  for (const dev of connected.values()) {
    ws.send(JSON.stringify({ type: 'connected', data: dev }));
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString('utf8'));
      handleControlMessage(msg);
    } catch (e) {
      console.warn('[proxy] bad control message:', raw.toString());
    }
  });

  ws.on('close', () => {
    console.log('[proxy] control client disconnected');
  });
});

function handleControlMessage(msg) {
  switch (msg.type) {
    case 'connect': {
      // Connect to a discovered device by serial number
      const sn = msg.sn;
      const info = discovered.get(sn);
      if (!info) {
        broadcastControl({ type: 'error', message: `Device ${sn} not found in discovery list` });
        return;
      }

      connected.set(sn, {
        sn,
        name: info.name,
        ip: info.ip,
        send: info.send,
        receive: info.receive,
      });

      // Start data listener on device's send port (if not already listening)
      const sendPort = info.send || DATA_PORT_DEFAULT;
      if (dataPort !== sendPort) {
        startDataListener(sendPort);
      }

      // Settings enforcement and the LED handshake deliberately do NOT happen
      // here.  The proxy is a transport: it owns the sockets and relays
      // commands, nothing more.  ximu3.js runs the same enforcement pass
      // for browser mode as it does for Electron, sending through the
      // { type: 'command' } relay below, so there is exactly one copy of the
      // settings table (js/ximu-settings.js) rather than two that drift.
      //
      // They did drift: this handler used to write ahrs_message_rate_divisor 1
      // (400 Hz) while Electron wrote 4 (100 Hz), and never wrote
      // binary_mode_enabled or axes_alignment at all — so the same sensor was
      // configured differently depending on how mubone was launched.

      broadcastControl({ type: 'connected', data: connected.get(sn) });
      console.log(`[proxy] connected to ${info.name} (${sn}) at ${info.ip}`);
      break;
    }

    case 'disconnect': {
      const sn = msg.sn;
      connected.delete(sn);
      if (connected.size === 0) {
        stopDataListener();
      }
      broadcastControl({ type: 'disconnected', sn });
      console.log(`[proxy] disconnected ${sn}`);
      break;
    }

    case 'command': {
      // Send a raw command to a device
      const ip = msg.ip;
      const port = msg.port || CMD_PORT_DEFAULT;
      const json = msg.json;
      if (ip && json) {
        sendCommand(ip, port, typeof json === 'string' ? JSON.parse(json) : json);
      }
      break;
    }

    case 'list-discovered': {
      // Client requesting full discovery list
      for (const entry of discovered.values()) {
        broadcastControl({ type: 'discovery', data: entry });
      }
      break;
    }

    default:
      console.log('[proxy] unknown control message type:', msg.type);
  }
}

// ── Cleanup stale discoveries ────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  for (const [sn, entry] of discovered) {
    if (now - entry.lastSeen > 10000) {
      discovered.delete(sn);
      broadcastControl({ type: 'discovery-lost', sn });
    }
  }
}, 5000);

// ── Graceful shutdown ────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('\n[proxy] shutting down...');
  if (discoverySock) try { discoverySock.close(); } catch (_) {}
  if (dataSock)      try { dataSock.close(); } catch (_) {}
  if (cmdSock)       try { cmdSock.close(); } catch (_) {}
  wssControl.close();
  process.exit(0);
});

console.log('[proxy] ready — waiting for x-IMU3 devices...');
