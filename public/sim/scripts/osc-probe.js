// ============================================================================
// scripts/osc-probe.js — diagnostic OSC sender
//
// Sends a handful of OSC messages directly to 127.0.0.1:7500 using node's
// built-in dgram module.  Bypasses the Joy-Con relay entirely, so you can
// tell whether the problem is in mubone's listener or in the relay.
//
// Usage:
//   node scripts/osc-probe.js            # sends /trace 1, /trace 0, /mute bang
//   node scripts/osc-probe.js --spam     # sends 100 messages at 50Hz
//
// Expected in mubone's DevTools console (with localStorage.muboneOscTrace='1'):
//   [osc:in] /trace [1]
//   [osc:in] /trace [0]
//   [osc:in] /mute []
//
// If those lines DON'T appear, the electron-main.js UDP bind is the suspect.
// Check the terminal where `npm run electron` was launched — you should see
// "[OSC] listening on UDP 127.0.0.1:7500".  If that line is missing, or if
// lsof -iUDP:7500 shows a different PID, that's your problem.
// ============================================================================

const dgram = require('dgram');

const HOST = '127.0.0.1';
const PORT = 7500;

// --- minimal OSC binary encoder (same format as relay.js) ---
function padTo4(buf) {
  const pad = (4 - (buf.length % 4)) % 4;
  return pad ? Buffer.concat([buf, Buffer.alloc(pad)]) : buf;
}
function oscString(s) {
  return padTo4(Buffer.concat([Buffer.from(s, 'ascii'), Buffer.from([0])]));
}
function encodeOSC(address, values) {
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
    }
  }
  return Buffer.concat([oscString(address), oscString(tags), ...argBufs]);
}

const sock = dgram.createSocket('udp4');

function send(address, values, done) {
  const pkt = encodeOSC(address, values);
  sock.send(pkt, 0, pkt.length, PORT, HOST, (err) => {
    if (err) console.error(`  FAIL ${address}:`, err.message);
    else     console.log(`  sent ${address} ${JSON.stringify(values)}  (${pkt.length} bytes)`);
    if (done) done();
  });
}

const spam = process.argv.includes('--spam');

if (spam) {
  console.log(`spamming 100 messages to ${HOST}:${PORT} at 50Hz…`);
  let i = 0;
  const h = setInterval(() => {
    send('/joycon/R/stick', [Math.sin(i / 10), Math.cos(i / 10)]);
    if (++i >= 100) { clearInterval(h); setTimeout(() => sock.close(), 500); }
  }, 20);
} else {
  console.log(`probing ${HOST}:${PORT}…`);
  send('/trace', [1], () => {
    setTimeout(() => send('/trace', [0], () => {
      setTimeout(() => send('/mute', [], () => {
        setTimeout(() => {
          sock.close();
          console.log('\ndone. check mubone DevTools console for matching [osc:in] lines.');
          console.log('if none appear, the electron main-process UDP listener is the problem.');
        }, 200);
      }), 200);
    }), 200);
  });
}
