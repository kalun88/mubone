// ============================================================================
// relay.js — mubone-joycon-gui
//
// One Node process that does three things:
//
//   1. Serves the GUI static files (joycon.html, js/, css/) over HTTP on :8000.
//      WebHID requires a "secure context", and Chrome treats http://localhost
//      as secure — so no TLS needed. The GUI page therefore loads at
//      http://localhost:8000/ and can talk to navigator.hid just fine.
//
//   2. Runs a WebSocket hub on :8080 that broadcasts every incoming message
//      to all OTHER connected clients. The wire format matches mubone's
//      existing Max bridge (max/bridge.js):
//          { "address": "/joycon/R/stick", "values": [0.12, -0.34] }
//
//      mubone's browser build connects to ws://localhost:8080 and receives
//      messages directly.
//
//   3. Emits each message as binary OSC over UDP to 127.0.0.1:7500. This is
//      the port mubone's Electron build (electron-main.js) listens on — the
//      same place Max used to send. So the Joy-Con GUI works with the built
//      app without needing Max at all.
//
//      Integer values → OSC 'i' (int32), anything else numeric → OSC 'f'
//      (float32), strings → OSC 's'. Messages with unsupported types are
//      dropped silently.
//
// Usage:
//   npm install
//   npm start          # or: node relay.js
//   open http://localhost:8000
// ============================================================================

const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const dgram   = require('dgram');
const WebSocket = require('ws');

const HTTP_PORT = 8000;
const WS_PORT   = 8080;
const OSC_HOST  = '127.0.0.1';
const OSC_PORT  = 7500;      // mubone Electron's UDP OSC listener
const ROOT      = __dirname;

// ── Static HTTP server ──────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.map':  'application/json; charset=utf-8',
};

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.join(root, normalized);
  if (!full.startsWith(root)) return null;
  return full;
}

const httpServer = http.createServer((req, res) => {
  let urlPath = req.url === '/' ? '/joycon.html' : req.url;
  const filePath = safeJoin(ROOT, urlPath);
  if (!filePath) {
    res.writeHead(400); res.end('Bad path'); return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${urlPath}`);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

httpServer.listen(HTTP_PORT, () => {
  console.log(`[relay] GUI on  http://localhost:${HTTP_PORT}/`);
});

// ── OSC binary encoding (UDP out) ───────────────────────────────────────────
// OSC 1.0 spec:
//   - Address: null-terminated string, zero-padded to a 4-byte boundary.
//   - Type tags: starts with ',', one char per arg, null-terminated, padded.
//   - Args: int32/float32 are 4 bytes big-endian; strings null-terminated + pad.
// Max's patch used integers for button states (1/0) and floats for continuous
// values — we follow the same rule: Number.isInteger → 'i', else → 'f'.

function padTo4(buf) {
  const pad = (4 - (buf.length % 4)) % 4;
  return pad ? Buffer.concat([buf, Buffer.alloc(pad)]) : buf;
}

function oscString(s) {
  return padTo4(Buffer.concat([Buffer.from(s, 'ascii'), Buffer.from([0])]));
}

function encodeOSC(address, values) {
  // Build type tag string and argument buffers
  let tags = ',';
  const argBufs = [];
  for (const v of values) {
    if (typeof v === 'number') {
      if (Number.isInteger(v) && v >= -2147483648 && v <= 2147483647) {
        tags += 'i';
        const b = Buffer.alloc(4); b.writeInt32BE(v | 0, 0); argBufs.push(b);
      } else {
        tags += 'f';
        const b = Buffer.alloc(4); b.writeFloatBE(v, 0); argBufs.push(b);
      }
    } else if (typeof v === 'string') {
      tags += 's';
      argBufs.push(oscString(v));
    } else {
      return null;  // unsupported type — drop the whole message
    }
  }
  return Buffer.concat([oscString(address), oscString(tags), ...argBufs]);
}

const udp = dgram.createSocket('udp4');
udp.on('error', (err) => {
  console.warn(`[relay] UDP error: ${err.message}`);
});
console.log(`[relay] UDP out  udp://${OSC_HOST}:${OSC_PORT}  (mubone Electron)`);

function sendUDP(address, values) {
  const packet = encodeOSC(address, values);
  if (!packet) return;
  udp.send(packet, 0, packet.length, OSC_PORT, OSC_HOST);
}

// ── WebSocket hub ───────────────────────────────────────────────────────────

const clients = new Set();
const wss = new WebSocket.Server({ port: WS_PORT }, () => {
  console.log(`[relay] WS on    ws://localhost:${WS_PORT}`);
});

wss.on('connection', (ws, req) => {
  ws._tag = req.headers['x-client'] || req.socket.remoteAddress;
  clients.add(ws);
  console.log(`[relay] client connected (${clients.size} total)`);

  ws.on('message', (data) => {
    // Validate payload — if it's not valid JSON with {address,values}, drop it.
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (typeof msg.address !== 'string' || !Array.isArray(msg.values)) return;

    // Fan out to other WS peers (browser mubone, other GUIs)
    const out = JSON.stringify(msg);
    for (const peer of clients) {
      if (peer !== ws && peer.readyState === WebSocket.OPEN) peer.send(out);
    }

    // Also emit as binary OSC to the Electron app's UDP listener
    sendUDP(msg.address, msg.values);
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[relay] client disconnected (${clients.size} total)`);
  });

  ws.on('error', (e) => {
    console.warn(`[relay] client error: ${e.message}`);
    clients.delete(ws);
  });
});

wss.on('error', (err) => {
  console.error(`[relay] WS server error: ${err.message}`);
});

process.on('SIGINT', () => {
  console.log('\n[relay] shutting down');
  try { udp.close(); } catch (_) {}
  wss.close();
  httpServer.close(() => process.exit(0));
});
