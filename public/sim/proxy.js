#!/usr/bin/env node
// ============================================================================
// proxy.js — x-IMU3 UDP → WebSocket proxy for browser mode
//
// Replaces Max/MSP bridge for sensor data in browser mode (no Electron needed).
// Requires only Node.js + ws package:  npm install ws
//
// Two WebSocket interfaces:
//   Port 8080 — data channel: same { address, values } JSON as Max bridge.
//               Works with existing osc.js without changes.
//   Port 8081 — control channel: discovery list, connect/disconnect, commands.
//               Consumed by imu-setup.js browser-mode transport.
//
// Launch:  node proxy.js
// ============================================================================

const dgram = require('dgram');
const { WebSocketServer, WebSocket } = require('ws');

// ── Config ───────────────────────────────────────────────────────────────────

const DISCOVERY_PORT = 10000;
const DATA_PORT_DEFAULT = 8000;
const CMD_PORT_DEFAULT  = 9000;
const WS_DATA_PORT    = 8080;   // same as Max bridge — drop-in replacement
const WS_CONTROL_PORT = 8081;   // new control channel for discovery/commands

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

// Line buffer for ASCII data (LF-terminated)
let dataBuf = '';

// ── WebSocket servers ────────────────────────────────────────────────────────

const wssData = new WebSocketServer({ port: WS_DATA_PORT });
const wssControl = new WebSocketServer({ port: WS_CONTROL_PORT });

console.log(`[proxy] data WebSocket on ws://localhost:${WS_DATA_PORT} (osc.js compatible)`);
console.log(`[proxy] control WebSocket on ws://localhost:${WS_CONTROL_PORT} (discovery/commands)`);

// Broadcast to all connected WS clients
function broadcastData(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of wssData.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

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
  dataBuf = '';

  dataSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  dataSock.on('message', (msg, rinfo) => {
    dataBuf += msg.toString('utf8');
    const sourceIP = rinfo.address;
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
        // Data message — convert to OSC-compatible format for osc.js
        routeDataLine(line, sourceIP);
      }
    }
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
    dataBuf = '';
  }
}

// ── Route x-IMU3 ASCII data → OSC-compatible WebSocket messages ──────────────
// Converts x-IMU3 ASCII lines to /sensor/{name}/quaternion and /sensor/{name}/inertial
// messages so osc.js can consume them without changes.

function routeDataLine(line, sourceIP) {
  // Find which connected device this data belongs to
  let dev = null;
  for (const d of connected.values()) {
    if (d.ip === sourceIP) { dev = d; break; }
  }
  if (!dev) {
    // Fallback: first connected device
    dev = connected.values().next().value;
  }
  if (!dev) return;

  const sensorName = dev.name || dev.sn;
  const parts = line.split(',');
  if (parts.length < 3) return;

  const type = parts[0];

  switch (type) {
    case 'Q': { // Quaternion: timestamp, w, x, y, z
      if (parts.length >= 6) {
        const w = parseFloat(parts[2]);
        const x = parseFloat(parts[3]);
        const y = parseFloat(parts[4]);
        const z = parseFloat(parts[5]);
        // osc.js expects /sensor/{name}/quaternion with [qx, qy, qz, qw]
        broadcastData({
          address: `/sensor/${sensorName}/quaternion`,
          values: [x, y, z, w],
        });
      }
      break;
    }
    case 'I': { // Inertial: timestamp, gx, gy, gz, ax, ay, az
      if (parts.length >= 8) {
        broadcastData({
          address: `/sensor/${sensorName}/inertial`,
          values: [
            parseFloat(parts[2]), parseFloat(parts[3]), parseFloat(parts[4]),
            parseFloat(parts[5]), parseFloat(parts[6]), parseFloat(parts[7]),
          ],
        });
      }
      break;
    }
    case 'A': { // Euler: timestamp, roll, pitch, yaw
      // Also relay as quaternion for osc.js compatibility
      if (parts.length >= 5) {
        const roll  = parseFloat(parts[2]) * Math.PI / 180;
        const pitch = parseFloat(parts[3]) * Math.PI / 180;
        const yaw   = parseFloat(parts[4]) * Math.PI / 180;
        // ZYX Euler → quaternion
        const cr = Math.cos(roll/2), sr = Math.sin(roll/2);
        const cp = Math.cos(pitch/2), sp = Math.sin(pitch/2);
        const cy = Math.cos(yaw/2), sy = Math.sin(yaw/2);
        const qx = sr*cp*cy - cr*sp*sy;
        const qy = cr*sp*cy + sr*cp*sy;
        const qz = cr*cp*sy - sr*sp*cy;
        const qw = cr*cp*cy + sr*sp*sy;
        broadcastData({
          address: `/sensor/${sensorName}/quaternion`,
          values: [qx, qy, qz, qw],
        });
      }
      break;
    }
    // B (battery) and W (RSSI) are forwarded on control channel
    case 'B':
    case 'W':
      broadcastControl({ type: 'sensor-status', sn: dev.sn, line, sourceIP });
      break;
  }

  // Also forward raw line on control channel for imu-setup.js browser mode
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

      // Settings enforcement
      const rcv = info.receive || CMD_PORT_DEFAULT;
      sendCommand(info.ip, rcv, { ahrs_ignore_magnetometer: true });
      sendCommand(info.ip, rcv, { ahrs_acceleration_rejection_enabled: true });
      sendCommand(info.ip, rcv, { gyroscope_offset_correction_enabled: true });
      sendCommand(info.ip, rcv, { udp_low_latency: true });
      sendCommand(info.ip, rcv, { ahrs_message_type: 0 });  // quaternion mode
      sendCommand(info.ip, rcv, { ahrs_message_rate_divisor: 8 });  // 400Hz / 8 = 50Hz
      setTimeout(() => {
        sendCommand(info.ip, rcv, { apply: null });
        // Heading zero NOT sent on connect — user controls it via "zero heading" button
        // LED handshake — 5× blink
        let blinks = 0;
        const blinkTimer = setInterval(() => {
          sendCommand(info.ip, rcv, { blink: null });
          if (++blinks >= 5) clearInterval(blinkTimer);
        }, 200);
      }, 100);

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

// ── Data channel (port 8080) — also accept outbound OSC from browser ─────────

wssData.on('connection', (ws) => {
  console.log('[proxy] data client connected');
  ws.on('message', (raw) => {
    // Browser might send OSC messages back (e.g. sendOSC in osc.js)
    // Currently no-op — we don't relay browser→Max. Could be added later.
  });
  ws.on('close', () => {
    console.log('[proxy] data client disconnected');
  });
});

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
  wssData.close();
  wssControl.close();
  process.exit(0);
});

console.log('[proxy] ready — waiting for x-IMU3 devices...');
