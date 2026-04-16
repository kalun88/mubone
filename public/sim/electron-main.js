// ============================================================================
// ELECTRON MAIN PROCESS — mubone desktop wrapper
// ============================================================================

const { app, BrowserWindow, session, ipcMain } = require('electron');
const path  = require('path');
const dgram = require('dgram');

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

// ── OSC UDP receiver (BNO085 from Max) ────────────────────────────────────────
// Max sends OSC to 127.0.0.1:7500. We parse it here and push to the renderer
// via webContents.send('osc-sensor') — no WebSocket, no server script needed.

const OSC_PORT = 7500;
let   _oscWin  = null;   // set once the BrowserWindow is ready

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

  sock.on('message', (msg) => {
    if (!_oscWin || _oscWin.isDestroyed()) return;
    const parsed = parseOSC(msg);
    if (!parsed) return;
    // Broadcast all OSC to renderer — osc.js dispatches to sensor, grain params, etc.
    _oscWin.webContents.send('osc-message', parsed.address, parsed.values);
  });

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
let _ximu3DataSock      = null;   // listener for data messages
let _ximu3DataPort      = 0;      // currently bound data port
let _ximu3CmdSock       = null;   // socket for sending commands

function startXIMU3Discovery() {
  _ximu3DiscoverySock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  _ximu3DiscoverySock.on('message', (msg, rinfo) => {
    if (!_oscWin || _oscWin.isDestroyed()) return;
    try {
      const json = JSON.parse(msg.toString('utf8'));
      // Attach the source IP so renderer knows where to send commands
      json._sourceIP = rinfo.address;
      _oscWin.webContents.send('ximu3-discovery', json);
    } catch (_) {
      // Not JSON — ignore (might be data on wrong port)
    }
  });

  _ximu3DiscoverySock.on('error', (err) => {
    console.warn(`[x-IMU3] discovery UDP error: ${err.message}`);
  });

  _ximu3DiscoverySock.bind(XIMU3_DISCOVERY_PORT, '0.0.0.0', () => {
    console.log(`[x-IMU3] discovery listening on UDP 0.0.0.0:${XIMU3_DISCOVERY_PORT}`);
  });
}

function startXIMU3DataListener(port) {
  // Close existing data listener if port changed
  if (_ximu3DataSock) {
    try { _ximu3DataSock.close(); } catch (_) {}
    _ximu3DataSock = null;
  }
  _ximu3DataPort = port;

  _ximu3DataSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  // Buffer for accumulating partial ASCII messages (LF-terminated)
  let _buf = '';

  _ximu3DataSock.on('message', (msg, rinfo) => {
    if (!_oscWin || _oscWin.isDestroyed()) return;
    // x-IMU3 data can be ASCII (LF-delimited) or binary.
    // We handle ASCII mode here — multiple messages may arrive per packet.
    _buf += msg.toString('utf8');
    const sourceIP = rinfo.address;
    let nlIdx;
    while ((nlIdx = _buf.indexOf('\n')) !== -1) {
      const line = _buf.slice(0, nlIdx);
      _buf = _buf.slice(nlIdx + 1);
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
  });

  _ximu3DataSock.on('error', (err) => {
    console.warn(`[x-IMU3] data UDP error on port ${port}: ${err.message}`);
  });

  _ximu3DataSock.bind(port, '0.0.0.0', () => {
    console.log(`[x-IMU3] data listening on UDP 0.0.0.0:${port}`);
  });
}

function stopXIMU3DataListener() {
  if (_ximu3DataSock) {
    try { _ximu3DataSock.close(); } catch (_) {}
    _ximu3DataSock = null;
    _ximu3DataPort = 0;
  }
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

    parser.on('data', (line) => {
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
    });

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
  _serialPorts.delete(portPath);
}

function sendSerialCommandFn(portPath, jsonStr) {
  const entry = _serialPorts.get(portPath);
  if (!entry || !entry.port.isOpen) return;
  const payload = jsonStr.endsWith('\n') ? jsonStr : jsonStr + '\n';
  entry.port.write(payload, 'utf8', (err) => {
    if (err) console.warn(`[serial] write error on ${portPath}: ${err.message}`);
  });
}

// ── audify (RtAudio) ──────────────────────────────────────────────────────────
const { RtAudio, RtAudioFormat } = require('audify');

let rtAudio    = null;
let rtAudioIn  = null;   // separate RtAudio instance for input capture
let audioDeviceId = -1;  // -1 = default device

// Single RtAudio instance used only for device enumeration.
// Creating throwaway instances while a stream is active can destabilise
// CoreAudio on macOS (SIGBUS in the IO thread).
let _rtEnum = null;
function getEnumerator() {
  if (!_rtEnum) _rtEnum = new RtAudio();
  return _rtEnum;
}

// ── Audio output stream ───────────────────────────────────────────────────────

const DEFAULT_BUFFER_FRAMES = 1024;  // safe default for 48 kHz on macOS

function createOutputStream(deviceId, numChannels, bufferFrames, preferredRate) {
  // Immediately block IPC writes — the stream is about to be torn down.
  // The audio-buffer handler checks this and drops all incoming buffers,
  // preventing writes to a half-closed or mismatched stream (which SIGBUS).
  _expectedAudioBytes = 0;

  // Close and destroy the old instance.  Safe now because the write guard
  // above prevents any rtAudio.write() calls while _expectedAudioBytes === 0.
  if (rtAudio) {
    try { if (rtAudio.isStreamRunning()) rtAudio.stop(); } catch (_) {}
    try { if (rtAudio.isStreamOpen()) rtAudio.closeStream(); } catch (_) {}
    rtAudio = null;
  }

  const devices = getEnumerator().getDevices();
  const device  = devices.find(d => d.id === deviceId);

  if (!device) {
    console.warn(`audify: device ${deviceId} not found — stream not opened`);
    return;
  }

  // Use requested channel count, clamped to what the device actually supports
  const nCh = Math.min(numChannels || device.outputChannels, device.outputChannels);
  if (nCh < 1) {
    console.warn(`audify: device "${device.name}" has no output channels`);
    return;
  }

  const frames = bufferFrames || DEFAULT_BUFFER_FRAMES;

  // Try sample rates in preference order. Match the AudioContext rate first
  // to avoid resampling between Web Audio and RtAudio (causes crunchiness/delay).
  const preferred = preferredRate || 48000;
  const ratesToTry = [...new Set([preferred, 48000, 44100])];
  let openedRate = null;

  // Fresh instance for each device — channel count and config differ between
  // devices and RtAudio's internal ring buffers are sized at openStream time.
  rtAudio = new RtAudio();

  for (const rate of ratesToTry) {
    try {
      rtAudio.openStream(
        { deviceId, nChannels: nCh },
        null,
        RtAudioFormat.RTAUDIO_FLOAT32,
        rate,
        frames,
        'mubone-spatial',
        null,
        null
      );
      openedRate = rate;
      break; // success — stop trying
    } catch (e) {
      console.warn(`audify: ${rate} Hz failed on "${device.name}" — ${e.message}`);
      try { if (rtAudio.isStreamOpen()) rtAudio.closeStream(); } catch(_) {}
    }
  }

  if (!openedRate) {
    console.error(`audify: could not open stream on "${device.name}" at any sample rate`);
    rtAudio = null;
    return;
  }

  rtAudio.start();
  // Float32 = 4 bytes/sample. audify expects exactly frames × nCh × 4 per write().
  _expectedAudioBytes = frames * nCh * 4;
  _ipcAudioCredits = IPC_AUDIO_MAX_CREDITS;
  _ipcDropCount = 0;
  console.log(`audify stream started — "${device.name}", ${nCh} ch @ ${openedRate} Hz, buffer ${frames} frames (${_expectedAudioBytes} bytes/write)`);
}

// ── Audio input stream (RtAudio) ──────────────────────────────────────────────
// Opens a separate RtAudio input-only stream, sends raw interleaved Float32 PCM
// to the renderer via webContents.send('audio-input-buffer') so the input-meter
// worklet can feed AnalyserNodes for the multichannel meter strip.

function createInputStream(deviceId, numChannels, bufferFrames, win, preferredRate) {
  // Close and destroy the old input instance.
  if (rtAudioIn) {
    try { if (rtAudioIn.isStreamRunning()) rtAudioIn.stop(); } catch(_) {}
    try { if (rtAudioIn.isStreamOpen()) rtAudioIn.closeStream(); } catch(_) {}
    rtAudioIn = null;
  }
  if (!win || win.isDestroyed()) return;

  const devices = getEnumerator().getDevices();
  const device  = devices.find(d => d.id === deviceId);

  if (!device) {
    console.warn(`audify input: device ${deviceId} not found`);
    return;
  }

  // Warn about potential clock drift when I/O share the same device
  if (rtAudio && audioDeviceId === deviceId) {
    console.warn('[audify] Input and output share the same device — separate RtAudio instances may drift over long sessions. Consider duplex mode for sessions > 30min.');
  }

  const nCh = Math.min(numChannels || device.inputChannels, device.inputChannels);
  if (nCh < 1) {
    console.warn(`audify input: device "${device.name}" has no input channels`);
    return;
  }

  const frames = bufferFrames || DEFAULT_BUFFER_FRAMES;

  // Match AudioContext sample rate first to avoid resampling
  const preferred = preferredRate || 48000;
  const ratesToTry = [...new Set([preferred, 48000, 44100])];
  let openedRate = null;

  // Fresh instance — channel count and config differ between devices.
  rtAudioIn = new RtAudio();

  for (const rate of ratesToTry) {
    try {
      rtAudioIn.openStream(
        null,                         // no output
        { deviceId, nChannels: nCh }, // input parameters
        RtAudioFormat.RTAUDIO_FLOAT32,
        rate,
        frames,
        'mubone-input',
        (inputData) => {
          // inputData is a Node Buffer of interleaved Float32 samples
          if (win.isDestroyed()) return;
          const f32 = new Float32Array(inputData.buffer, inputData.byteOffset, inputData.length / 4);
          win.webContents.send('audio-input-buffer', f32, nCh);
        },
        null
      );
      openedRate = rate;
      break;
    } catch (e) {
      console.warn(`audify input: ${rate} Hz failed — ${e.message}`);
      try { if (rtAudioIn.isStreamOpen()) rtAudioIn.closeStream(); } catch(_) {}
    }
  }

  if (!openedRate) {
    console.error(`audify input: could not open stream on "${device.name}"`);
    rtAudioIn = null;
    return;
  }

  rtAudioIn.start();
  console.log(`audify input stream started — "${device.name}", ${nCh} ch @ ${openedRate} Hz`);
  return { nCh, rate: openedRate, name: device.name };
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

// Expected byte count for one audify write call.
// Recomputed whenever the output stream is (re)opened.
let _expectedAudioBytes = 0;

// Credit-based flow control for IPC audio path.
// Main process sends credits back to renderer; worklet pauses when exhausted.
let _ipcAudioCredits = 8;         // start with 8 buffer credits
const IPC_AUDIO_MAX_CREDITS = 8;  // max outstanding buffers
let _ipcDropCount = 0;            // consecutive drops — throttled warning

function setupIPC() {
  // Receive N-channel interleaved Float32Array from renderer and push to RtAudio.
  // Guard against size mismatches — these happen transiently when the output device
  // is switched (worklet and audify briefly disagree on channel count or buffer size).
  // Drop the buffer silently rather than crashing audify.
  ipcMain.on('audio-buffer', (event, interleavedFloat32) => {
    if (!rtAudio || !rtAudio.isStreamRunning()) return;
    // _expectedAudioBytes === 0 means the stream is being torn down / reopened —
    // drop everything until the new stream sets the expected size.
    if (_expectedAudioBytes === 0) return;
    const buf = Buffer.from(interleavedFloat32.buffer);
    if (buf.length !== _expectedAudioBytes) {
      // Throttled mismatch warning (max 1 per second)
      _ipcDropCount++;
      if (_ipcDropCount === 1 || _ipcDropCount % 100 === 0) {
        console.warn(`[audio-buffer] size mismatch: got ${buf.length}, expected ${_expectedAudioBytes} — dropped ${_ipcDropCount} buffers`);
      }
      return;
    }
    _ipcDropCount = 0;
    try {
      rtAudio.write(buf);
    } catch (e) {
      console.error(`[audio-buffer] write error: ${e.message}`);
      return;
    }
    // Send credit back to renderer so worklet can pace itself
    if (!event.sender.isDestroyed()) {
      event.sender.send('audio-credit', 1);
    }
  });

  // List all output devices with channel counts, flagging the system default
  ipcMain.handle('get-audio-devices', () => {
    const rt        = getEnumerator();
    const defaultId = rt.getDefaultOutputDevice();
    return rt.getDevices()
      .filter(d => d.outputChannels > 0)
      .map(d => ({
        ...d,
        isDefault:   d.id === defaultId,
        quadCapable: d.outputChannels >= 4,
      }));
  });

  // List all input devices with true channel counts (via RtAudio, not WebRTC)
  ipcMain.handle('get-input-devices', () => {
    const rt        = getEnumerator();
    const defaultId = rt.getDefaultInputDevice();
    return rt.getDevices()
      .filter(d => d.inputChannels > 0)
      .map(d => ({
        ...d,
        isDefault: d.id === defaultId,
      }));
  });

  // Open RtAudio input stream for multichannel metering
  // Returns { ok, nCh, sampleRate, name } or { ok: false, error }
  ipcMain.handle('set-input-device', (event, deviceId, numChannels, bufferFrames, sampleRate) => {
    const win    = BrowserWindow.fromWebContents(event.sender);
    const result = createInputStream(deviceId, numChannels, bufferFrames, win, sampleRate);
    if (result) {
      return { ok: true, nCh: result.nCh, sampleRate: result.rate, name: result.name };
    }
    return { ok: false, error: 'could not open input stream' };
  });

  // Restart the app (used by buffer-size change which can't safely reopen streams)
  ipcMain.on('app-restart', () => {
    app.relaunch();
    app.exit(0);
  });

  // Switch output device at runtime — accepts (deviceId, numChannels, bufferFrames)
  ipcMain.handle('set-audio-device', (event, deviceId, numChannels, bufferFrames, sampleRate) => {
    audioDeviceId = deviceId;
    createOutputStream(deviceId, numChannels, bufferFrames, sampleRate);
    const streaming  = !!(rtAudio && rtAudio.isStreamRunning());
    const actualRate = streaming ? (rtAudio.getStreamSampleRate?.() ?? null) : null;
    return { ok: true, streaming, sampleRate: actualRate };
  });

  // ── x-IMU3 IPC ──────────────────────────────────────────────────────────────
  // Start/stop data listener, send commands to device

  ipcMain.handle('ximu3-start-data', (_event, port) => {
    startXIMU3DataListener(port);
    return { ok: true, port };
  });

  ipcMain.handle('ximu3-stop-data', () => {
    stopXIMU3DataListener();
    return { ok: true };
  });

  ipcMain.handle('ximu3-send-command', (_event, ip, port, jsonStr) => {
    sendXIMU3Command(ip, port, jsonStr);
    return { ok: true };
  });

  // ── x-IMU3 serial IPC ────────────────────────────────────────────────────────

  ipcMain.handle('serial-list-ports', async () => {
    return await listSerialPortsFn();
  });

  ipcMain.handle('serial-open', async (_event, portPath) => {
    const ok = await openSerialPortFn(portPath);
    return { ok, path: portPath };
  });

  ipcMain.handle('serial-close', (_event, portPath) => {
    closeSerialPortFn(portPath);
    return { ok: true };
  });

  ipcMain.handle('serial-send-command', (_event, portPath, jsonStr) => {
    sendSerialCommandFn(portPath, jsonStr);
    return { ok: true };
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
  const win = new BrowserWindow({
    width:     1440,
    height:    900,
    minWidth:  800,
    minHeight: 600,
    title:     'mubone',
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron-preload.js'),
    },
  });

  // Grant mic + MIDI permissions without browser prompt
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(['media', 'midi', 'midiSysex', 'pointerLock'].includes(permission));
  });

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
  // Block further IPC audio writes immediately
  _expectedAudioBytes = 0;

  // Stop and destroy RtAudio output
  if (rtAudio) {
    try { if (rtAudio.isStreamRunning()) rtAudio.stop(); } catch (_) {}
    try { if (rtAudio.isStreamOpen()) rtAudio.closeStream(); } catch (_) {}
    rtAudio = null;
  }
  // Stop and destroy RtAudio input — this is the main crash culprit.
  // Its native callback uses a ThreadSafeFunction that must be released
  // before node::FreeEnvironment() runs its final uv_run().
  if (rtAudioIn) {
    try { if (rtAudioIn.isStreamRunning()) rtAudioIn.stop(); } catch (_) {}
    try { if (rtAudioIn.isStreamOpen()) rtAudioIn.closeStream(); } catch (_) {}
    rtAudioIn = null;
  }
  // Destroy the enumerator instance — it holds a live RtAudio C++ object
  if (_rtEnum) {
    try { if (_rtEnum.isStreamOpen()) _rtEnum.closeStream(); } catch (_) {}
    _rtEnum = null;
  }

  // Close x-IMU3 sockets
  if (_ximu3DiscoverySock) { try { _ximu3DiscoverySock.close(); } catch(_) {} _ximu3DiscoverySock = null; }
  if (_ximu3DataSock)      { try { _ximu3DataSock.close(); } catch(_) {} _ximu3DataSock = null; }
  if (_ximu3CmdSock)       { try { _ximu3CmdSock.close(); } catch(_) {} _ximu3CmdSock = null; }
  // Close serial ports
  for (const [, entry] of _serialPorts) {
    try { entry.port.close(); } catch(_) {}
  }
  _serialPorts.clear();
}

app.whenReady().then(() => {
  setupIPC();
  const win = createWindow();
  _oscWin = win;
  startOSCReceiver();
  startXIMU3Discovery();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      _oscWin = createWindow();
    }
  });
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
