// ============================================================================
// bridge.js — mubone Max ↔ browser/Electron relay
//
// Run via [node.script bridge.js] inside the mubone Max patch.
//
// Two modes (toggle with setmode message):
//
//   browser  (default) — broadcasts to all connected browser tabs via WebSocket
//                        on ws://localhost:8080
//
//   electron            — encodes messages as OSC binary and sends UDP to
//                        127.0.0.1:7500, where Electron main process receives
//                        them natively (no WebSocket needed)
//
// Send "setmode browser" or "setmode electron" to node.script to switch.
// The mode is logged to the Max console on change.
//
// Max patch inlet format — same regardless of mode:
//   [list 0.1 -0.2 0.3 0.9]        → { address: "list",           values: [0.1, -0.2, 0.3, 0.9] }
//   [/grain/duration 0.38]          → { address: "/grain/duration", values: [0.38] }
//   [/preset 2]                     → { address: "/preset",         values: [2] }
//
// Setup (one time, in this folder):
//   npm install
// ============================================================================

const Max       = require('max-api');
const WebSocket = require('ws');
const dgram     = require('dgram');

// ── Config ────────────────────────────────────────────────────────────────────

const WS_PORT   = 8080;
const UDP_HOST  = '127.0.0.1';
const UDP_PORT  = 7500;

let mode = 'browser';   // 'browser' | 'electron'

// ── WebSocket server (browser mode) ───────────────────────────────────────────

const clients = new Set();

const wss = new WebSocket.Server({ port: WS_PORT }, () => {
  Max.post(`[bridge] WebSocket listening on ws://localhost:${WS_PORT}`);
});

wss.on('connection', (ws) => {
  clients.add(ws);
  Max.post(`[bridge] browser connected — ${clients.size} client(s)`);

  ws.on('close', () => {
    clients.delete(ws);
    Max.post(`[bridge] browser disconnected — ${clients.size} client(s)`);
  });

  ws.on('error', (err) => {
    Max.post(`[bridge] client error: ${err.message}`);
    clients.delete(ws);
  });
});

wss.on('error', (err) => {
  Max.post(`[bridge] WebSocket server error: ${err.message}`);
});

function broadcastWS(address, values) {
  if (clients.size === 0) return;
  const msg = JSON.stringify({ address, values });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// ── UDP socket (Electron mode) ────────────────────────────────────────────────

const udpSocket = dgram.createSocket('udp4');

udpSocket.on('error', (err) => {
  Max.post(`[bridge] UDP socket error: ${err.message}`);
});

// Encode a message as OSC binary.
// Supports float (f), integer (i), and string (s) argument types.
// Type is inferred from the JavaScript type of each value.
function encodeOSC(address, values) {
  // Null-pad a string to the next 4-byte boundary
  function padStr(str) {
    const raw    = Buffer.from(str + '\0', 'utf8');
    const padded = Math.ceil(raw.length / 4) * 4;
    const buf    = Buffer.alloc(padded, 0);
    raw.copy(buf);
    return buf;
  }

  // Build type tag string
  const types = values.map(v => {
    if (typeof v === 'string')  return 's';
    if (Number.isInteger(v))    return 'i';
    return 'f';
  }).join('');

  // Encode each argument
  const argBufs = values.map((v, idx) => {
    const t = types[idx];
    if (t === 's') return padStr(v);
    const b = Buffer.alloc(4);
    if (t === 'i') b.writeInt32BE(v,    0);
    else           b.writeFloatBE(v,    0);
    return b;
  });

  return Buffer.concat([padStr(address), padStr(',' + types), ...argBufs]);
}

function sendUDP(address, values) {
  const packet = encodeOSC(address, values);
  udpSocket.send(packet, 0, packet.length, UDP_PORT, UDP_HOST, (err) => {
    if (err) Max.post(`[bridge] UDP send error: ${err.message}`);
  });
}

// ── Receive from Max patch ────────────────────────────────────────────────────
// MESSAGE_TYPES.ALL: first arg is the handler key itself (false), real
// message arrives flat as [...args] where args[0] is address/selector.

Max.addHandler(Max.MESSAGE_TYPES.ALL, (_key, ...args) => {
  const [address, ...values] = args;

  // Internal mode switch — consumed here, not forwarded
  if (address === 'setmode') {
    const newMode = String(values[0]);
    if (newMode === 'browser' || newMode === 'electron') {
      mode = newMode;
      Max.post(`[bridge] mode → ${mode}`);
    } else {
      Max.post(`[bridge] unknown mode "${newMode}" — use browser or electron`);
    }
    return;
  }

  if (mode === 'electron') {
    sendUDP(address, values);
  } else {
    broadcastWS(address, values);
  }
});
