// server.js — UDP (OSC) → WebSocket bridge for mubone BNO085
// Run with: node server.js

const dgram = require('dgram');
const { WebSocketServer } = require('ws');

const UDP_PORT = 7500;
const WS_PORT  = 8080;

// --- Minimal OSC parser ---
function parseOSC(buf) {
  try {
    // Read address string (null-terminated, padded to 4 bytes)
    let i = 0;
    let address = '';
    while (i < buf.length && buf[i] !== 0) address += String.fromCharCode(buf[i++]);
    i = Math.ceil((i + 1) / 4) * 4; // pad to 4-byte boundary

    // Read type tag string (starts with ',')
    let types = '';
    if (buf[i] === 0x2C) { // ','
      i++;
      while (i < buf.length && buf[i] !== 0) types += String.fromCharCode(buf[i++]);
      i = Math.ceil((i + 1) / 4) * 4;
    }

    // Read values
    const values = [];
    for (const t of types) {
      if (t === 'f') {
        values.push(buf.readFloatBE(i));
        i += 4;
      } else if (t === 'i') {
        values.push(buf.readInt32BE(i));
        i += 4;
      } else if (t === 'd') {
        values.push(buf.readDoubleBE(i));
        i += 8;
      }
    }

    // Strip leading slash if present, use as message type
    const type = address.replace(/^\//, '');
    return `${type} ${values.join(' ')}`.trim();

  } catch (e) {
    return null;
  }
}

// --- UDP server ---
const udp = dgram.createSocket('udp4');

udp.on('message', (msg) => {
  const text = parseOSC(msg);
  if (text) {
    console.log('parsed:', text);
    broadcast(text);
  } else {
    console.warn('could not parse:', msg);
  }
});

udp.bind(UDP_PORT, () => {
  console.log(`UDP listening on port ${UDP_PORT}`);
});

// --- WebSocket server ---
const wss = new WebSocketServer({ port: WS_PORT });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Browser connected');
  ws.on('close', () => clients.delete(ws));
});

console.log(`WebSocket server on ws://localhost:${WS_PORT}`);

// --- Broadcast to all connected browsers ---
function broadcast(text) {
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(text);
    }
  }
}
