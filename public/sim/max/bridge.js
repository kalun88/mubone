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
// Multi-station (electron mode) — each mubone instance listens on its own
// port (a=7500, b=7510, c=7520, … matching scripts/run-stations.sh):
//
//   [setstations a b c]   → define the roster "all" refers to (default a b c)
//   [setstation b]        → subsequent messages go to station b (default: a)
//   [setstation all]      → subsequent messages go to every roster station
//   [to b /trace 1]       → one-shot: send to station b, ignore current station
//   [to all /sweep]       → one-shot broadcast to the roster
//
// Defaults (station a, port 7500) are identical to the old single-instance
// behaviour — solo patches need no changes.
//
// Max patch inlet format — same regardless of mode:
//   [list 0.1 -0.2 0.3 0.9]        → { address: "list",           values: [0.1, -0.2, 0.3, 0.9] }
//   [/grain/dur 380]                → { address: "/grain/dur",      values: [380]  }
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

// Station name → port, matching scripts/run-stations.sh: a=7500, b=7510, …
const STATION_NAMES = 'abcdefghi';
function stationPort(name) {
  const i = STATION_NAMES.indexOf(name);
  return i === -1 ? null : 7500 + i * 10;
}

let mode     = 'browser';         // 'browser' | 'electron'
let station  = 'a';               // current target: 'a'…'i' | 'all'
let roster   = ['a', 'b', 'c'];   // what 'all' expands to

// ── WebSocket server (browser mode) ───────────────────────────────────────────

const clients = new Set();

const wss = new WebSocket.Server({ port: WS_PORT }, () => {
  Max.post(`[bridge] WebSocket listening on ws://localhost:${WS_PORT}`);
});

wss.on('connection', (ws) => {
  clients.add(ws);
  Max.post(`[bridge] browser connected — ${clients.size} client(s)`);

  ws.on('message', (data) => {
    try {
      const { address, values } = JSON.parse(data);
      Max.outlet(address, ...values);
    } catch (e) {
      Max.post(`[bridge] bad message from browser: ${e.message}`);
    }
  });

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

function sendUDPToPort(address, values, port) {
  const packet = encodeOSC(address, values);
  udpSocket.send(packet, 0, packet.length, port, UDP_HOST, (err) => {
    if (err) Max.post(`[bridge] UDP send error: ${err.message}`);
  });
}

// Send to a station name or 'all' (roster fan-out)
function sendUDP(address, values, target = station) {
  if (target === 'all') {
    for (const name of roster) sendUDPToPort(address, values, stationPort(name));
    return;
  }
  const port = stationPort(target);
  if (port === null) {
    Max.post(`[bridge] unknown station "${target}" — use a–i or all`);
    return;
  }
  sendUDPToPort(address, values, port);
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

  // Station select — consumed here, not forwarded (electron mode only concept;
  // harmless to set in browser mode)
  if (address === 'setstation') {
    const name = String(values[0]);
    if (name === 'all' || stationPort(name) !== null) {
      station = name;
      Max.post(`[bridge] station → ${station}${station === 'all' ? ` (${roster.join(' ')})` : ` (port ${stationPort(station)})`}`);
    } else {
      Max.post(`[bridge] unknown station "${name}" — use a–i or all`);
    }
    return;
  }

  // Roster definition for 'all' — [setstations a b c]
  if (address === 'setstations') {
    const names = values.map(String).filter(n => stationPort(n) !== null);
    if (names.length) {
      roster = names;
      Max.post(`[bridge] roster → ${roster.join(' ')}`);
    } else {
      Max.post('[bridge] setstations needs station names a–i');
    }
    return;
  }

  // One-shot target — [to b /trace 1] or [to all /sweep]
  if (address === 'to') {
    const [target, realAddress, ...realValues] = values;
    if (typeof realAddress !== 'string') {
      Max.post('[bridge] usage: to <station|all> </address> [args…]');
      return;
    }
    if (mode === 'electron') sendUDP(realAddress, realValues, String(target));
    else broadcastWS(realAddress, realValues);   // browser mode has no stations
    return;
  }

  if (mode === 'electron') {
    sendUDP(address, values);
  } else {
    broadcastWS(address, values);
  }
});
