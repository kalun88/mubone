// ============================================================================
// ELECTRON MAIN PROCESS — mubone desktop wrapper
// ============================================================================

const { app, BrowserWindow, session, ipcMain, screen, nativeImage, dialog, Menu, shell } = require('electron');

// Who held the loop (2026-09-06, R6): every ipcMain handler, socket and
// serial callback is timed, and the loop's own gaps and GC pauses counted —
// electron-loop-probe.js, shared with the audio host. This is the browser
// thread; the hops live on the host's loop now.
const probe = require('./electron-loop-probe.js');
const timed = probe.timed;
probe.wrapIpcMain(ipcMain);
const path  = require('path');
const { pathToFileURL } = require('url');
const dgram = require('dgram');
const fs    = require('fs');

// ── Timer throttling — off, unconditionally ──────────────────────────────────
// Chromium throttles setTimeout/setInterval to ~1 Hz in any renderer it thinks
// nobody is looking at, and on macOS "occluded" means *fully covered by another
// window* — one visible pixel of mubone and the throttle lifts. That is a
// desktop-browser power optimisation and it is actively wrong for a performance
// instrument: the machine is doing exactly as much work either way, and the
// window being covered says nothing about whether a show is running.
//
// It bites anything on a JS timer. `paint-ticker.js` polls at 200 Hz to keep
// the particle deposit clock tight — throttled, that becomes 1 Hz and painting
// deposits stop tracking the cursor. The speaker sweep's per-channel step is a
// setTimeout, which is how this was first noticed (sweep crawls when covered).
// Web Audio and the grain worklet run on the audio thread and are NOT affected,
// so the symptom is timing drift in the control layer, not dropouts — which
// makes it easy to misread as a performance problem.
//
// Three switches plus the per-window flag below, because they cover different
// paths: timer throttling, renderer backgrounding, and macOS occlusion.
// Revert only if idle power draw ever matters more than timing does.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// ── Serial (x-IMU3 USB CDC) ────────────────────────────────────────────────
// Lazy-loaded — serialport is optional (WiFi-only setups don't need it).
let SerialPort   = null;
let ReadlineParser = null;
let _serialReady = false;

function requireSerial() {
  if (SerialPort) return true;
  try {
    ({ SerialPort }     = require('serialport'));
    ({ ReadlineParser }  = require('@serialport/parser-readline'));
    _serialReady = true;
    return true;
  } catch (e) {
    console.warn('[serial] serialport not installed — USB serial unavailable. Run: npm i serialport');
    return false;
  }
}

// Open serial ports, keyed by path (e.g. '/dev/tty.usbmodem1234')
const _serialPorts = new Map();  // path → { port, parser }

// ── Instance identity (multi-station setups) ─────────────────────────────────
// `electron . --instance=a --osc-port=7510` gives this process its own
// userData profile (isolated localStorage: presets, sensor calibration, audio
// defaults) and its own OSC listen port, so several stations can run on one
// machine without sharing state. No flags → identical to solo use: default
// profile, OSC port 7500. See docs/MULTI-INSTANCE-PLAN.md.

function argValue(name) {
  const pre = `--${name}=`;
  const hit = process.argv.find(a => a.startsWith(pre));
  return hit ? hit.slice(pre.length) : null;
}

const INSTANCE = (argValue('instance') || '').replace(/[^A-Za-z0-9_-]/g, '') || null;

// Audit instances stay out of the way. scripts/lib/rig.js sets this for every
// launch(): the window is created hidden and shown INACTIVE — it never takes
// focus and never pulls macOS to its Space — and the dock icon is hidden so the
// app cannot bounce or activate. Ek runs the suites while working on another
// desktop; seven suites = seven windows stealing the screen (2026-09-05).
// capturePage still renders an inactive window, so screenshots and the layout
// audits are unaffected. Never set for the app you play.
const BACKGROUND = process.env.MUBONE_RIG_BACKGROUND === '1';

// Multi-station tiling: when the launcher passes --station-count=N, each
// instance sizes itself to 1/N of the display and parks in its own column
// (a leftmost). At 3-across on a laptop each column lands under the 700px
// breakpoint, so windows come up already in narrow mode. Ignored for solo use.
const STATION_NAMES = 'abcdefghi';
const STATION_COUNT = parseInt(argValue('station-count') || '', 10) || 0;
const STATION_INDEX = INSTANCE ? STATION_NAMES.indexOf(INSTANCE) : -1;

function stationBounds() {
  if (STATION_COUNT < 2 || STATION_INDEX < 0 || STATION_INDEX >= STATION_COUNT) return null;
  // workArea excludes the menu bar and Dock, so nothing is hidden under them.
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  const colW = Math.floor(width / STATION_COUNT);
  return {
    x: x + STATION_INDEX * colW,
    y,
    width: colW,
    height,
  };
}
if (INSTANCE) {
  app.setPath('userData', path.join(app.getPath('userData'), 'instances', INSTANCE));
  console.log(`[instance] "${INSTANCE}" — userData: ${app.getPath('userData')}`);
}

// ── OSC UDP receiver ──────────────────────────────────────────────────────────
// Any OSC sender on 127.0.0.1:7500 (the show path, CLAUDE.md "Control
// surface"). Parsed here and pushed to the renderer via
// webContents.send('osc-message') — no WebSocket, no server script needed.
// Multi-station: each instance listens on its own port (--osc-port); the port
// is the instance address — OSC address strings are identical across stations.

const OSC_PORT = parseInt(argValue('osc-port') || '', 10) || 7500;
let   _oscWin  = null;   // set once the BrowserWindow is ready

// ── OSC UDP uplink (renderer → main → UDP → relay) ──────────────────────────
// Outbound hop used by the status publisher (js/status-publisher.js) to send
// /status/* messages to the joycon GUI. The relay listens on this port and
// rebroadcasts over its WS hub. JSON on the wire — both ends are our own
// Node processes, so no OSC encoder/decoder needed.
const OSC_OUT_PORT = 7501;
let _oscOutSock = null;

function initOSCUplink() {
  _oscOutSock = dgram.createSocket('udp4');
  _oscOutSock.on('error', (err) => {
    console.warn(`[OSC-out] UDP error: ${err.message}`);
  });
  console.log(`[OSC-out] uplink to udp://127.0.0.1:${OSC_OUT_PORT}`);
}

function sendOSCUplink(address, values) {
  if (!_oscOutSock) return;
  if (typeof address !== 'string') return;
  const frame = Buffer.from(JSON.stringify({
    address, values: Array.isArray(values) ? values : [],
  }));
  _oscOutSock.send(frame, 0, frame.length, OSC_OUT_PORT, '127.0.0.1');
}

// ── OSC UDP external (renderer → main → UDP → arbitrary peer) ────────────────
// Separate from the uplink above: real OSC 1.0 binary sent to a user-configured
// host:port. Driven by the sensor mapping rows (js/sensor-mapping.js through
// js/osc-out.js). Each unique host:port destination gets its own dgram socket, reused
// across messages.
//
// Encoding: OSC 1.0 binary — null-terminated address string, null-terminated
// type tag string (starts with ','), then big-endian args. All three sections
// padded to 4-byte boundaries. Numbers are sent as 32-bit floats (f), strings
// as OSC strings (s). Int support can be added later if needed.

const _oscExtSocks = new Map();   // 'host:port' → dgram socket

function _padTo4(n) { return (n + 3) & ~3; }

function _encodeOSCString(s) {
  const raw = Buffer.from(s + '\0', 'utf8');
  const padLen = _padTo4(raw.length);
  if (padLen === raw.length) return raw;
  const padded = Buffer.alloc(padLen);
  raw.copy(padded);
  return padded;
}

function _encodeOSC(address, values) {
  const addrBuf = _encodeOSCString(address);
  let tags = ',';
  const argBufs = [];
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      tags += 'f';
      const b = Buffer.alloc(4);
      b.writeFloatBE(v, 0);
      argBufs.push(b);
    } else if (typeof v === 'string') {
      tags += 's';
      argBufs.push(_encodeOSCString(v));
    }
    // other types silently skipped
  }
  const tagsBuf = _encodeOSCString(tags);
  return Buffer.concat([addrBuf, tagsBuf, ...argBufs]);
}

function _getOrCreateExtSock(host, port) {
  const key = `${host}:${port}`;
  let sock = _oscExtSocks.get(key);
  if (sock) return sock;
  sock = dgram.createSocket('udp4');
  sock.on('error', (err) => {
    console.warn(`[OSC-ext ${key}] UDP error: ${err.message}`);
  });
  _oscExtSocks.set(key, sock);
  return sock;
}

function sendOSCExternal(host, port, address, values) {
  if (typeof host !== 'string' || !host) return;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return;
  if (typeof address !== 'string' || !address.startsWith('/')) return;
  try {
    const sock = _getOrCreateExtSock(host, port);
    const frame = _encodeOSC(address, Array.isArray(values) ? values : []);
    sock.send(frame, 0, frame.length, port, host);
  } catch (e) {
    console.warn('[OSC-ext] send failed:', e);
  }
}

function parseOSC(buf) {
  try {
    let i = 0;
    let address = '';
    while (i < buf.length && buf[i] !== 0) address += String.fromCharCode(buf[i++]);
    i = Math.ceil((i + 1) / 4) * 4;

    let types = '';
    if (buf[i] === 0x2C) {
      i++;
      while (i < buf.length && buf[i] !== 0) types += String.fromCharCode(buf[i++]);
      i = Math.ceil((i + 1) / 4) * 4;
    }

    const values = [];
    for (const t of types) {
      if      (t === 'f') { values.push(buf.readFloatBE(i));  i += 4; }
      else if (t === 'i') { values.push(buf.readInt32BE(i));  i += 4; }
      else if (t === 'd') { values.push(buf.readDoubleBE(i)); i += 8; }
      else if (t === 's') {
        let s = '';
        while (i < buf.length && buf[i] !== 0) s += String.fromCharCode(buf[i++]);
        i = Math.ceil((i + 1) / 4) * 4;
        values.push(s);
      }
    }

    return { address: address.replace(/^\//, ''), values };
  } catch (_) {
    return null;
  }
}

function startOSCReceiver() {
  const sock = dgram.createSocket('udp4');

  sock.on('message', timed('udp:osc', (msg) => {
    if (!_oscWin || _oscWin.isDestroyed()) return;
    const parsed = parseOSC(msg);
    if (!parsed) return;
    // Broadcast all OSC to renderer — osc.js dispatches to sensor, grain params, etc.
    _oscWin.webContents.send('osc-message', parsed.address, parsed.values);
  }));

  sock.on('error', (err) => {
    console.warn(`[OSC] UDP error: ${err.message}`);
    sock.close();
  });

  sock.bind(OSC_PORT, '127.0.0.1', () => {
    console.log(`[OSC] listening on UDP 127.0.0.1:${OSC_PORT}`);
  });
}

// ── x-IMU3 direct UDP (discovery + data + commands) ──────────────────────────
// x-IMU3 broadcasts a JSON network announcement on UDP port 10000 at 1 Hz.
// Data messages (Euler, quaternion, inertial) arrive on the device's configured
// "send" port (default 8000).  Commands are sent to the device's "receive" port
// (default 9000) as JSON terminated by LF.

const XIMU3_DISCOVERY_PORT = 10000;
let _ximu3DiscoverySock = null;
// Map of port → { sock, refs, bufs: Map<sourceIP, string> }.
// Multiple x-IMU3 devices can share a data port (e.g. factory default 9000),
// so we reference-count and only close when the last caller releases the port.
// This is the fix for "connecting 3rd device freezes first two" — the old code
// held a single socket and closed/rebound it on every connect, orphaning any
// devices whose data port differed from the newest connect.
const _ximu3DataSocks  = new Map();
let _ximu3CmdSock       = null;   // socket for sending commands

function startXIMU3Discovery() {
  _ximu3DiscoverySock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  _ximu3DiscoverySock.on('message', timed('udp:ximu3-discovery', (msg, rinfo) => {
    if (!_oscWin || _oscWin.isDestroyed()) return;
    try {
      const json = JSON.parse(msg.toString('utf8'));
      // Attach the source IP so renderer knows where to send commands
      json._sourceIP = rinfo.address;
      _oscWin.webContents.send('ximu3-discovery', json);
    } catch (_) {
      // Not JSON — ignore (might be data on wrong port)
    }
  }));

  _ximu3DiscoverySock.on('error', (err) => {
    console.warn(`[x-IMU3] discovery UDP error: ${err.message}`);
  });

  _ximu3DiscoverySock.bind(XIMU3_DISCOVERY_PORT, '0.0.0.0', () => {
    console.log(`[x-IMU3] discovery listening on UDP 0.0.0.0:${XIMU3_DISCOVERY_PORT}`);
  });
}

function startXIMU3DataListener(port) {
  // Ref-counted: if a socket is already bound to this port, just bump the
  // count and return.  This lets multiple devices share one data port.
  let entry = _ximu3DataSocks.get(port);
  if (entry) {
    entry.refs++;
    return;
  }

  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  // Per-source buffers — we can't share one buffer across devices, because
  // their LF-terminated frames would interleave on a partial-packet boundary
  // and produce garbage lines.  Each source IP accumulates into its own buf.
  entry = { sock, refs: 1, bufs: new Map() };
  _ximu3DataSocks.set(port, entry);

  sock.on('message', timed('udp:ximu3-data', (msg, rinfo) => {
    if (!_oscWin || _oscWin.isDestroyed()) return;
    const sourceIP = rinfo.address;
    let buf = entry.bufs.get(sourceIP) || '';
    // x-IMU3 data can be ASCII (LF-delimited) or binary.
    // We handle ASCII mode here — multiple messages may arrive per packet.
    buf += msg.toString('utf8');
    // A device still in binary mode (the factory default) sends no newline, so
    // the line would grow for the rest of the set. Past 64 KB it is not a line.
    if (buf.length > 65536) buf = '';
    let nlIdx;
    while ((nlIdx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nlIdx);
      buf = buf.slice(nlIdx + 1);
      if (line.length > 0) {
        // Check if it looks like a JSON command response (starts with '{')
        if (line[0] === '{') {
          try {
            const json = JSON.parse(line);
            _oscWin.webContents.send('ximu3-command-response', json, sourceIP);
          } catch (_) {}
        } else {
          // Data message — send raw line + source IP to renderer for routing
          _oscWin.webContents.send('ximu3-data', line, sourceIP);
        }
      }
    }
    entry.bufs.set(sourceIP, buf);
  }));

  sock.on('error', (err) => {
    console.warn(`[x-IMU3] data UDP error on port ${port}: ${err.message}`);
  });

  sock.bind(port, '0.0.0.0', () => {
    console.log(`[x-IMU3] data listening on UDP 0.0.0.0:${port}`);
  });
}

// The mirror of start, ref-counted the same way: the socket closes when the
// last device on that port lets go. Back on 2026-09-18 with the Disconnect
// button (it went 2026-09-16 with nothing calling it).
function stopXIMU3DataListener(port) {
  const entry = _ximu3DataSocks.get(port);
  if (!entry) return;
  if (--entry.refs > 0) return;
  try { entry.sock.close(); } catch (_) {}
  _ximu3DataSocks.delete(port);
}

function sendXIMU3Command(ip, port, jsonStr) {
  if (!_ximu3CmdSock) {
    _ximu3CmdSock = dgram.createSocket('udp4');
    _ximu3CmdSock.on('error', (err) => {
      console.warn(`[x-IMU3] command send error: ${err.message}`);
    });
  }
  // Ensure LF termination
  const payload = jsonStr.endsWith('\n') ? jsonStr : jsonStr + '\n';
  const buf = Buffer.from(payload, 'utf8');
  _ximu3CmdSock.send(buf, 0, buf.length, port, ip, (err) => {
    if (err) console.warn(`[x-IMU3] failed to send command to ${ip}:${port} — ${err.message}`);
  });
}

// ── x-IMU3 serial (USB CDC) ──────────────────────────────────────────────────
// x-IMU3 appears as a USB CDC virtual COM port.  Same ASCII protocol as UDP:
// data lines are TYPE,TIMESTAMP,args...\n, commands are JSON+LF.
// Default baud rate: 115200.

const XIMU3_SERIAL_BAUD = 115200;

async function listSerialPortsFn() {
  if (!requireSerial()) return [];
  try {
    const ports = await SerialPort.list();
    return ports.map(p => ({
      path:         p.path,
      manufacturer: p.manufacturer || '',
      serialNumber: p.serialNumber || '',
      vendorId:     p.vendorId || '',
      productId:    p.productId || '',
    }));
  } catch (e) {
    console.warn(`[serial] list error: ${e.message}`);
    return [];
  }
}

function openSerialPortFn(portPath) {
  if (!requireSerial()) return Promise.resolve(false);
  if (_serialPorts.has(portPath)) return Promise.resolve(true);  // already open

  return new Promise((resolve) => {
    const port = new SerialPort({
      path:     portPath,
      baudRate: XIMU3_SERIAL_BAUD,
      autoOpen: false,
    });

    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

    parser.on('data', timed('serial:data', (line) => {
      if (!_oscWin || _oscWin.isDestroyed()) return;
      line = line.trim();
      if (!line) return;

      if (line[0] === '{') {
        // JSON command response
        try {
          const json = JSON.parse(line);
          _oscWin.webContents.send('ximu3-serial-response', portPath, json);
        } catch (_) {}
      } else {
        // Data message — same format as UDP
        _oscWin.webContents.send('ximu3-serial-data', portPath, line);
      }
    }));

    port.on('error', (err) => {
      console.warn(`[serial] ${portPath} error: ${err.message}`);
    });

    port.on('close', () => {
      console.log(`[serial] ${portPath} closed`);
      _serialPorts.delete(portPath);
    });

    port.open((err) => {
      if (err) {
        console.warn(`[serial] failed to open ${portPath}: ${err.message}`);
        _serialPorts.delete(portPath);
        resolve(false);
      } else {
        console.log(`[serial] opened ${portPath} @ ${XIMU3_SERIAL_BAUD}`);
        resolve(true);
      }
    });

    _serialPorts.set(portPath, { port, parser });
  });
}

function closeSerialPortFn(portPath) {
  const entry = _serialPorts.get(portPath);
  if (!entry) return;
  try { entry.port.close(); } catch (_) {}
  _serialPorts.delete(portPath);   // the 'close' handler does this too; a failed close must not leave a ghost
}

function sendSerialCommandFn(portPath, jsonStr) {
  const entry = _serialPorts.get(portPath);
  if (!entry || !entry.port.isOpen) return;
  const payload = jsonStr.endsWith('\n') ? jsonStr : jsonStr + '\n';
  entry.port.write(payload, 'utf8', (err) => {
    if (err) console.warn(`[serial] write error on ${portPath}: ${err.message}`);
  });
}

// ── The audio host ────────────────────────────────────────────────────────────
// audify and both audio streams live in audio-host.js, a utility process
// with nothing else on its loop (2026-09-06, R2 of
// docs/PERFORMANCE-AUDIT-2026-09.md). This process only forwards: the audio
// ports the preload makes go straight to the host, and the device requests
// from the renderer are relayed as request/response. If the host dies it is
// respawned; the renderer's next device pick reattaches the ports.
const { utilityProcess } = require('electron');
let _host = null, _hostSeq = 0, _quitting = false;
// Device ENUMERATION stays here, on its own RtAudio instance: getDevices()
// holds a loop for 65 ms, which is nothing on this thread and a hole on the
// host's. CoreAudio ids are global, so the host opens by the same id.
const { RtAudio } = require('audify');
let _rtEnum = null;
function getEnumerator() {
  if (!_rtEnum) _rtEnum = new RtAudio();
  return _rtEnum;
}
const _hostPending = new Map();   // id → resolve

function startAudioHost() {
  _host = utilityProcess.fork(path.join(__dirname, 'audio-host.js'), [], { serviceName: 'mubone audio host', stdio: 'pipe' });
  // Through console so the dev bridge's capture sees the host's lines too.
  _host.stdout?.on('data', (d) => console.log(String(d).trimEnd()));
  _host.stderr?.on('data', (d) => console.error(String(d).trimEnd()));
  _host.on('message', (m) => {
    const resolve = m && _hostPending.get(m.id);
    if (resolve) { _hostPending.delete(m.id); resolve(m.result); }
  });
  _host.on('exit', (code) => {
    console.warn(`[audio-host] exited (${code})`);
    for (const resolve of _hostPending.values()) resolve({ error: 'audio host exited' });
    _hostPending.clear();
    _host = null;
    if (!_quitting) setTimeout(startAudioHost, 500);
  });
}
function hostCall(type, args = {}) {
  return new Promise((resolve) => {
    if (!_host) return resolve({ error: 'no audio host' });
    const id = ++_hostSeq;
    _hostPending.set(id, resolve);
    _host.postMessage({ id, type, ...args });
  });
}

// ── Document files (.mubone) ─────────────────────────────────────────────────
// The renderer has no filesystem. This is the whole of what it can reach: the
// two native dialogs, a ranged read, and a streamed write. Nothing else in the
// app opens a file by path.
//
// A write goes to `<path>.part` and is renamed on close, so a crash or a pulled
// plug mid-save leaves the previous document intact rather than a truncated
// one — a piece can be hundreds of MB of float32 audio and the write is not
// instant. Chunks stream because holding the whole document as one Uint8Array
// in the renderer AND again as a structured-clone copy here would double a
// large piece's peak memory for no reason.

const DOC_EXT = '.mubone';
const _docWrites = new Map();   // id → { fd, tmp, dest }
let _docWriteSeq = 0;

function _isDocPath(p) {
  return typeof p === 'string' && p.length > 0 && p.endsWith(DOC_EXT);
}

function _docWindow() {
  const live = w => (w && !w.isDestroyed() ? w : null);
  return live(BrowserWindow.getFocusedWindow()) || live(_oscWin) || live(BrowserWindow.getAllWindows()[0]) || null;
}

function docWriteBegin(dest) {
  if (!_isDocPath(dest)) return { ok: false, error: 'not a ' + DOC_EXT + ' path' };
  // ONE WRITER PER DOCUMENT. Two saves of the same piece used to share one
  // `<dest>.part`: the second `openSync(…, 'w')` truncated the first's file
  // while it was still streaming audio into it, and then both renamed the
  // wreck over the document. Two ⌘S in a row on a long take was all it took.
  // Refused rather than queued — the caller has a piece in hand and should be
  // told, not left waiting (js/ui-export.js shows it).
  for (const w of _docWrites.values()) {
    if (w.dest === dest) return { ok: false, error: 'this piece is already being written' };
  }
  const id = ++_docWriteSeq;
  // The temp name carries the write's id too, so an abandoned `.part` from a
  // crash can never be adopted by the next save of the same document.
  const tmp = `${dest}.${id}.part`;
  let fd;
  try { fd = fs.openSync(tmp, 'w'); }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
  _docWrites.set(id, { fd, tmp, dest });
  return { ok: true, id };
}

function docWriteChunk(id, bytes) {
  const w = _docWrites.get(id);
  if (!w) return { ok: false, error: 'no such write' };
  // View, not copy — the chunk already crossed the IPC boundary once.
  const buf = ArrayBuffer.isView(bytes)
    ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : Buffer.from(bytes);
  try { fs.writeSync(w.fd, buf); }
  catch (e) { docWriteAbort(id); return { ok: false, error: String(e.message || e) }; }
  return { ok: true };
}

function docWriteEnd(id) {
  const w = _docWrites.get(id);
  if (!w) return { ok: false, error: 'no such write' };
  _docWrites.delete(id);
  try {
    fs.closeSync(w.fd);
    fs.renameSync(w.tmp, w.dest);          // atomic on the same volume
  } catch (e) { try { fs.unlinkSync(w.tmp); } catch (_) {} return { ok: false, error: String(e.message || e) }; }
  return { ok: true, path: w.dest };
}

function docWriteAbort(id) {
  const w = _docWrites.get(id);
  if (!w) return { ok: true };
  _docWrites.delete(id);
  try { fs.closeSync(w.fd); } catch (_) {}
  try { fs.unlinkSync(w.tmp); } catch (_) {}
  return { ok: true };
}

// ── The document: menu, quit guard, double-click ─────────────────────────────
//
// The File menu is the only menu mubone defines; the rest are Electron's own
// roles, which is what keeps ⌘Q, the services menu and the window list working.
// Its items do nothing here — they ask the renderer, which owns the document
// (js/piece.js `window.__mubonePiece`). The main process cannot reach the module
// graph, so the renderer answers on `window` and this file asks.

let _recentPieces = [];
let _closing = false;     // the guard has had its answer; let the close through

function askRenderer(expr) {
  const win = _docWindow();
  if (!win) return Promise.resolve(null);
  return win.webContents.executeJavaScript(expr, true).catch(() => null);
}

function sendDocCommand(cmd, arg) {
  askRenderer(`window.__mubonePiece?.run(${JSON.stringify(cmd)}, ${JSON.stringify(arg ?? null)})`);
}

const MANUAL_URL = pathToFileURL(path.join(__dirname, 'manual', 'index.html')).href;

function buildMenu() {
  const recent = _recentPieces.length
    ? _recentPieces.map(p => ({
        label: path.basename(p, DOC_EXT),
        click: () => sendDocCommand('open-at', p),
      }))
    : [{ label: 'Nothing yet', enabled: false }];

  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New',      accelerator: 'CmdOrCtrl+N',       click: () => sendDocCommand('new') },
        { label: 'Open…',    accelerator: 'CmdOrCtrl+O',       click: () => sendDocCommand('open') },
        { label: 'Open Recent', submenu: recent },
        { type: 'separator' },
        { label: 'Save',     accelerator: 'CmdOrCtrl+S',       click: () => sendDocCommand('save') },
        { label: 'Save As…', accelerator: 'Shift+CmdOrCtrl+S', click: () => sendDocCommand('save-as') },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    // Help > Cheat Sheet is the native idiom — every Mac app has it, and it
    // costs no chrome. Same page the settings nav links to, opened in the
    // system browser so the instrument's window is never navigated.
    {
      role: 'help',
      submenu: [
        { label: 'mubone Cheat Sheet', click: () => shell.openExternal(MANUAL_URL) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * THE ONE QUESTION, wherever a piece is about to be let go of: the quit, and —
 * through `doc-confirm-discard` — a New, an Open, a recent item and a
 * double-clicked file, which used to discard an unsaved session in silence
 * while this dialog's own words were "your recording, marks and pins are lost
 * if you don't" (2026-09-15). One wording, one set of buttons, one meaning.
 */
async function askAboutUnsaved(win, name) {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: `Save changes to ${name || 'this piece'}?`,
    detail: 'Your recording, marks and pins are lost if you don\'t.',
  });
  return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel';
}

/**
 * The quit guard. Ek asked for exactly this and nothing more (2026-09-14: "if
 * the app closes, then a warning to save or not can come up") — there is no
 * autosave and nothing on a timer, so this is the only thing standing between a
 * session and the bin.
 *
 * The renderer is asked at the moment of the close rather than pushing a flag
 * as it goes, so the answer can never be one edit stale.
 */
function guardClose(win) {
  win.on('close', async (e) => {
    if (_closing) return;
    e.preventDefault();
    const state = await askRenderer('window.__mubonePiece?.state()');
    if (!state?.dirty) { _closing = true; win.close(); return; }

    const answer = await askAboutUnsaved(win, state.name);
    if (answer === 'cancel') return;                              // stay open
    if (answer === 'discard') { _closing = true; win.close(); return; }

    // Save may put its own dialog up (a piece with no path yet), and may be
    // cancelled there — in which case the quit is cancelled too.
    const saved = await askRenderer('window.__mubonePiece?.save()');
    if (saved) { _closing = true; win.close(); }
  });
}

// A double-clicked .mubone, or one dropped on the dock icon. macOS delivers it
// here, and before the window exists on a cold start — so hold it until there
// is something to open it in.
let _pendingOpen = null;
app.on('open-file', (e, filePath) => {
  e.preventDefault();
  const win = _docWindow();
  if (win && !win.webContents.isLoading()) sendDocCommand('open-at', filePath);
  else _pendingOpen = filePath;
});

// ── IPC handlers ──────────────────────────────────────────────────────────────

function setupIPC() {
  // Renderer → main: outbound OSC (status uplink to relay/joycon GUI).
  // Fire-and-forget (.on, not .handle) — called from grain-adjacent hot paths,
  // renderer should never await a confirmation.
  ipcMain.on('osc-send', (_e, address, values) => {
    sendOSCUplink(address, values);
  });

  // Renderer → main: outbound real OSC binary to an arbitrary external peer
  // (the sensor mapping rows, js/osc-out.js). Distinct from 'osc-send' above,
  // which targets the internal relay in JSON format for joycon-GUI feedback.
  ipcMain.on('osc-send-external', (_e, host, port, address, values) => {
    sendOSCExternal(host, port, address, values);
  });

  // The two audio ports (2026-09-06). The preload makes a MessageChannel per
  // hop and posts one end here; it goes straight on to the audio host, whose
  // loop the hops live on. The other end is transferred into the worklet
  // (audio.js requestAudioPort).
  ipcMain.on('audio-port', (event, msg) => {
    const port = event.ports && event.ports[0];
    if (!port) return;
    if (!_host) { try { port.close(); } catch (_) {} return; }
    _host.postMessage({ type: 'audio-port', kind: msg && msg.kind }, [port]);
  });

  // The queue's depth and faults, and the host loop's own gaps and holders
  // (the loop the hops live on), plus this loop's under `main` — the browser
  // thread, kept for the record.
  // `gaps` arms both loop probes for ten seconds (P1): the 1 Hz depth poll
  // passes false, so a show pays nothing for a gauge nobody is reading.
  ipcMain.handle('get-output-depth', async (_e, gaps) =>
    ({ ...(await hostCall('get-output-depth', { gaps: !!gaps })), main: probe.stats(!!gaps) }));

  // The stall cushion, for the prime depth (audio.js applyAudioCushion).
  ipcMain.on('set-audio-cushion', (_event, ms) => { if (ms > 0 && _host) _host.postMessage({ type: 'set-audio-cushion', ms }); });

  ipcMain.handle('get-stream-latency', () => hostCall('get-stream-latency'));
  // List all output devices with channel counts, flagging the system default
  ipcMain.handle('get-audio-devices', () => {
    const rt        = getEnumerator();
    const defaultId = rt.getDefaultOutputDevice();
    return rt.getDevices()
      .filter(d => d.outputChannels > 0)
      .map(d => ({ ...d, isDefault: d.id === defaultId, quadCapable: d.outputChannels >= 4 }));
  });
  // List all input devices with true channel counts (via RtAudio, not WebRTC)
  ipcMain.handle('get-input-devices', () => {
    const rt        = getEnumerator();
    const defaultId = rt.getDefaultInputDevice();
    return rt.getDevices()
      .filter(d => d.inputChannels > 0)
      .map(d => ({ ...d, isDefault: d.id === defaultId }));
  });
  ipcMain.handle('set-input-device', (_event, deviceId, numChannels, bufferFrames, sampleRate) =>
    hostCall('set-input-device', { deviceId, numChannels, bufferFrames, sampleRate }));

  // Restart the app (used by buffer-size change which can't safely reopen streams)
  ipcMain.on('app-restart', () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle('set-audio-device', (_event, deviceId, numChannels, bufferFrames, sampleRate) =>
    hostCall('set-audio-device', { deviceId, numChannels, bufferFrames, sampleRate }));

  // ── x-IMU3 IPC ──────────────────────────────────────────────────────────────
  // Start/stop data listener, send commands to device

  ipcMain.handle('ximu3-start-data', (_event, port) => {
    startXIMU3DataListener(port);
    return { ok: true, port };
  });

  ipcMain.handle('ximu3-stop-data', (_event, port) => {
    stopXIMU3DataListener(port);
    return { ok: true, port };
  });

  ipcMain.handle('ximu3-send-command', (_event, ip, port, jsonStr) => {
    sendXIMU3Command(ip, port, jsonStr);
    return { ok: true };
  });

  // ── x-IMU3 serial IPC ────────────────────────────────────────────────────────

  // ── WiFi survey ──────────────────────────────────────────────────────────
  // The instrument cannot scan — sygbr-wifi.hpp still says `TODO: wifi rssi,
  // bssid` — so the only vantage point available is this machine. One shot, on
  // a button, never polled: docs/RIG-RUNBOOK.md § 3 is the procedure this
  // serves, and a venue is where it is needed.
  ipcMain.handle('wifi-scan', async () => {
    const { execFile } = require('child_process');
    const text = await new Promise((resolve) => {
      execFile('system_profiler', ['SPAirPortDataType'], { timeout: 15000 },
        (err, stdout) => resolve(err ? '' : stdout));
    });
    if (!text) return { ok: false, reason: 'system_profiler did not run.' };

    const at = text.indexOf('Other Local Wi-Fi Networks');
    if (at < 0) {
      // macOS hides neighbouring networks from apps without Location Services.
      // A terminal usually has it and this app usually does not, so the same
      // command gives a full survey in one and nothing in the other. Say which
      // it is, because "no networks found" sends you to look at the radio.
      const radioOff = /Status:\s*Off/.test(text);
      return { ok: false, reason: radioOff
        ? 'This machine’s Wi-Fi is switched off, so it cannot survey the band. Turn it on — being on ethernet is fine, the scan only needs the radio listening.'
        : 'macOS only shows neighbouring networks to apps granted Location Services. '
          + 'System Settings → Privacy & Security → Location Services → enable it for mubone, '
          + 'then scan again.' };
    }
    const tail = text.slice(at);

    // Each network is a name line, then indented fields. Channel and signal are
    // the only two that matter here.
    const nets = [];
    let cur = null;
    for (const line of tail.split('\n')) {
      const name = line.match(/^\s{12}([^\s:][^:]*):\s*$/);
      if (name) { cur = { name: name[1], ch: null, band: null, rssi: null }; nets.push(cur); continue; }
      if (!cur) continue;
      const ch = line.match(/Channel:\s*(\d+)\s*\((\d+)GHz/);
      if (ch) { cur.ch = +ch[1]; cur.band = +ch[2]; continue; }
      const sig = line.match(/Signal \/ Noise:\s*(-?\d+)\s*dBm/);
      if (sig) cur.rssi = +sig[1];
    }

    // The raw 2.4 GHz list goes back as well as the summary. A network on an
    // in-between channel — 4, say — is a real neighbour that a 1/6/11 table can
    // only show as an anonymous contribution, and if it is loud it is the most
    // important thing on the page.
    const two = nets.filter((n) => n.band === 2 && n.ch !== null && n.rssi !== null)
                    .sort((a, b) => b.rssi - a.rssi);
    return { ok: true, nets: two.map((n) => ({ name: n.name, ch: n.ch, rssi: n.rssi })) };
  });

  ipcMain.handle('serial-list-ports', async () => {
    return await listSerialPortsFn();
  });

  ipcMain.handle('serial-open', async (_event, portPath) => {
    const ok = await openSerialPortFn(portPath);
    return { ok, path: portPath };
  });

  ipcMain.handle('serial-close', (_event, portPath) => {
    closeSerialPortFn(portPath);
    return { ok: true, path: portPath };
  });

  ipcMain.handle('serial-send-command', (_event, portPath, jsonStr) => {
    sendSerialCommandFn(portPath, jsonStr);
    return { ok: true };
  });

  // ── Document files ──────────────────────────────────────────────────────
  ipcMain.handle('doc-save-dialog', async (_e, opts = {}) => {
    const win = _docWindow();
    const r = await dialog.showSaveDialog(win, {
      title: 'Save piece',
      defaultPath: opts.defaultPath || undefined,
      filters: [{ name: 'mubone piece', extensions: ['mubone'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    const p = r.filePath.endsWith(DOC_EXT) ? r.filePath : r.filePath + DOC_EXT;
    return { canceled: false, path: p };
  });

  ipcMain.handle('doc-open-dialog', async (_e, opts = {}) => {
    const win = _docWindow();
    const r = await dialog.showOpenDialog(win, {
      title: 'Open piece',
      defaultPath: opts.defaultPath || undefined,
      filters: [{ name: 'mubone piece', extensions: ['mubone'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths?.length) return { canceled: true };
    return { canceled: false, path: r.filePaths[0] };
  });

  ipcMain.handle('doc-stat', (_e, p) => {
    if (typeof p !== 'string') return { ok: false, error: 'bad path' };
    try {
      const st = fs.statSync(p);
      return { ok: true, size: st.size, mtimeMs: st.mtimeMs };
    } catch (e) { return { ok: false, error: String(e.code || e.message || e) }; }
  });

  // Whole file when offset/length are omitted; a range otherwise, which is how
  // the zip reader pulls the directory and then one member at a time.
  ipcMain.handle('doc-read', (_e, p, offset, length) => {
    if (typeof p !== 'string') return { ok: false, error: 'bad path' };
    try {
      if (offset == null) return { ok: true, bytes: fs.readFileSync(p) };
      const fd = fs.openSync(p, 'r');
      try {
        const buf = Buffer.allocUnsafe(Math.max(0, length | 0));
        const n = fs.readSync(fd, buf, 0, buf.length, offset);
        return { ok: true, bytes: n === buf.length ? buf : buf.subarray(0, n) };
      } finally { fs.closeSync(fd); }
    } catch (e) { return { ok: false, error: String(e.code || e.message || e) }; }
  });

  // The unsaved-changes ask, for the renderer's own New / Open paths. The quit
  // guard runs the same function; this is the only other caller.
  ipcMain.handle('doc-confirm-discard', async (_e, name) => {
    const win = _docWindow();
    if (!win) return 'discard';
    return askAboutUnsaved(win, typeof name === 'string' ? name : null);
  });

  ipcMain.handle('doc-write-begin', (_e, p)        => docWriteBegin(p));
  ipcMain.handle('doc-write-chunk', (_e, id, b)    => docWriteChunk(id, b));
  ipcMain.handle('doc-write-end',   (_e, id)       => docWriteEnd(id));
  ipcMain.handle('doc-write-abort', (_e, id)       => docWriteAbort(id));

  // The renderer's document state. macOS draws it: the title, the proxy icon for
  // the file itself, and the dot in the close button — the conventions a
  // document window already has, so the instrument's chrome stays uncluttered.
  ipcMain.on('doc-set-state', (_e, state) => {
    const win = _docWindow();
    if (!win || !state) return;
    const base = INSTANCE ? `mubone [${INSTANCE}]` : 'mubone';
    win.setTitle(state.name ? `${state.name} — ${base}` : base);
    win.setDocumentEdited(!!state.dirty);
    if (process.platform === 'darwin') win.setRepresentedFilename(state.path || '');
  });

  ipcMain.on('doc-set-recent', (_e, list) => {
    _recentPieces = Array.isArray(list) ? list.filter(p => typeof p === 'string').slice(0, 10) : [];
    for (const p of _recentPieces) app.addRecentDocument(p);
    buildMenu();
  });

  // Fullscreen toggle — native OS fullscreen on the current display.
  // Note: on macOS this creates a Space, which dims the other display.
  // This is a macOS limitation; simpleFullScreen avoids it but has sizing
  // issues on modern macOS. The tradeoff is acceptable for now.
  ipcMain.handle('toggle-fullscreen', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.setFullScreen(!win.isFullScreen());
    return win?.isFullScreen() ?? false;
  });
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  const tile = stationBounds();   // null unless --station-count says to tile
  const win = new BrowserWindow({
    ...(tile || {}),
    width:     tile ? tile.width  : 1440,
    height:    tile ? tile.height : 900,
    // Narrow enough for the multi-station side-by-side layout (CSS flips to
    // a stacked column below 700px — see NARROW-WINDOW MODE in style.css)
    minWidth:  380,
    minHeight: 500,
    title:     INSTANCE ? `mubone [${INSTANCE}]` : 'mubone',
    icon:      path.join(__dirname, 'logo', 'icon-512.png'),
    show:      !BACKGROUND,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      // Per-window half of the throttling fix — see the commandLine switches
      // at the top of this file for why.
      backgroundThrottling: false,
      preload: path.join(__dirname, 'electron-preload.js'),
      // Instance name + OSC listen port ride into the preload's process.argv —
      // no IPC round-trip. Port is always passed so the UI can display it.
      additionalArguments: [
        `--mubone-osc-port=${OSC_PORT}`,
        ...(INSTANCE ? [`--mubone-instance=${INSTANCE}`] : []),
      ],
    },
  });

  if (BACKGROUND) win.once('ready-to-show', () => win.showInactive());

  // Grant mic + MIDI permissions without browser prompt
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(['media', 'midi', 'midiSysex', 'pointerLock'].includes(permission));
  });

  // Web Serial has no port chooser here. In a tab the browser puts up a list
  // and waits for a click; in Electron that list is ours to answer, and until
  // we do, requestPort() never settles — the panel sits on "choose the
  // instrument…" forever. This is the one place the desktop app can differ
  // from a tab while every other part of the link behaves identically.
  session.defaultSession.on('select-serial-port', (event, ports, webContents, callback) => {
    event.preventDefault();
    // The renderer already filtered to first-party instruments by USB vendor,
    // so anything still in this list is a legitimate answer. Take the first:
    // unplugging the one you don't mean is faster than any dialog we'd build.
    callback(ports.length > 0 ? ports[0].portId : '');
  });

  // Chromium asks twice — may this page request a port at all, and may it keep
  // the one it was given. Both have to say yes or the port opens and then dies.
  session.defaultSession.setPermissionCheckHandler((webContents, permission) =>
    permission === 'serial' || ['media', 'midi', 'midiSysex', 'pointerLock'].includes(permission));
  session.defaultSession.setDevicePermissionHandler((details) => details.deviceType === 'serial');

  // Enable SharedArrayBuffer in the renderer — required by Chromium 92+
  // (Electron 34 / Chromium 132).  The grain-engine worklet uses SAB to
  // share audio buffers between the main thread and the audio thread.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy':   ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
      },
    });
  });

  // Keep the instance suffix — index.html's <title> would otherwise
  // overwrite the window title on load, making the 3 stations look identical.
  if (INSTANCE) {
    win.on('page-title-updated', (e, pageTitle) => {
      e.preventDefault();
      win.setTitle(`${pageTitle} [${INSTANCE}]`);
    });
  }

  // A LINK NEVER NAVIGATES THE INSTRUMENT (2026-09-16). Anything that asks
  // for a new window — the cheat sheet's target="_blank", anything a future
  // page links to — goes to the system browser and the ask is denied here.
  // The same for an in-window navigation to anything but the app itself:
  // `location.href = location.pathname + '?debug'` (CLAUDE.md) must still
  // work, so index.html on its own path is let through and nothing else is.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  const APP_PATH = pathToFileURL(path.join(__dirname, 'index.html')).pathname;
  win.webContents.on('will-navigate', (e, url) => {
    let p = null;
    try { p = new URL(url).pathname; } catch (_) {}
    if (p === APP_PATH) return;
    e.preventDefault();
    shell.openExternal(url);
  });

  win.loadFile('index.html');

  // Forward native fullscreen state changes to the renderer so the
  // fullscreen button label and canvas resize stay in sync.
  win.on('enter-full-screen', () => win.webContents.send('fullscreen-changed', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen-changed', false));

  // Uncomment to open DevTools on launch during development:
  // win.webContents.openDevTools();

  return win;
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

// Centralised cleanup — called from both window-all-closed and before-quit.
// Must be safe to call more than once.
function cleanupBeforeQuit() {
  // The streams live in the audio host: tell it to stop and exit, and do
  // not respawn it.
  _quitting = true;
  if (_host) { try { _host.postMessage({ type: 'shutdown' }); } catch (_) {} }
  // The enumerator holds a live RtAudio C++ object — destroy it here.
  if (_rtEnum) {
    try { if (_rtEnum.isStreamOpen()) _rtEnum.closeStream(); } catch (_) {}
    _rtEnum = null;
  }

  // Close x-IMU3 sockets
  if (_ximu3DiscoverySock) { try { _ximu3DiscoverySock.close(); } catch(_) {} _ximu3DiscoverySock = null; }
  for (const entry of _ximu3DataSocks.values()) { try { entry.sock.close(); } catch(_) {} }
  _ximu3DataSocks.clear();
  if (_ximu3CmdSock)       { try { _ximu3CmdSock.close(); } catch(_) {} _ximu3CmdSock = null; }
  // Any half-written document goes with its .part file — never a truncated .mubone
  for (const id of [..._docWrites.keys()]) docWriteAbort(id);

  // Close serial ports
  for (const [, entry] of _serialPorts) {
    try { entry.port.close(); } catch(_) {}
  }
  _serialPorts.clear();
}

// The grain engine shares its audio buffers with the worklet through a
// SharedArrayBuffer. In a browser that requires cross-origin isolation, which
// is why the dev server sends COOP and COEP — but this window loads from
// file://, where injecting those headers stopped taking effect after Electron
// 34. Ask for the capability directly instead of arranging the conditions that
// used to imply it.
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');

app.whenReady().then(() => {
  startAudioHost();
  // macOS ignores BrowserWindow's `icon` in development — the dock takes its
  // image from the bundle, which in dev is Electron's own. Set it explicitly.
  if (process.platform === 'darwin' && app.dock) {
    if (BACKGROUND) app.dock.hide();
    else app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, 'logo', 'icon-512.png')));
  }
  setupIPC();
  buildMenu();
  const win = createWindow();
  _oscWin = win;
  guardClose(win);
  win.webContents.once('did-finish-load', () => {
    if (_pendingOpen) { sendDocCommand('open-at', _pendingOpen); _pendingOpen = null; }
  });

  // Opt-in diagnosis channel (npm run electron:dev). Never loaded otherwise.
  if (process.env.MUBONE_DEV_BRIDGE === '1') {
    require('./scripts/dev-bridge.js').attachDevBridge(win, __dirname);
  }
  startOSCReceiver();
  initOSCUplink();
  startXIMU3Discovery();
  // No `activate` handler: window-all-closed quits, so there is never a dock
  // click with no window to answer it.
});

app.on('window-all-closed', () => {
  cleanupBeforeQuit();
  // mubone is a single-window app — quit immediately on all platforms.
  // Lingering on macOS left stale RtAudio ThreadSafeFunction refs that
  // crashed during node::FreeEnvironment() (SIGABRT in audify.node).
  app.quit();
});

// Safety net: runs once right before the app exits, in case window-all-closed
// was skipped (e.g. app.quit() called directly, or Cmd+Q before window close).
app.on('before-quit', () => {
  cleanupBeforeQuit();
});
