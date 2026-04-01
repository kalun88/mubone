// ============================================================================
// ELECTRON MAIN PROCESS — mubone desktop wrapper
// ============================================================================

const { app, BrowserWindow, session, ipcMain } = require('electron');
const path  = require('path');
const dgram = require('dgram');

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
  // Close any existing stream first
  if (rtAudio) {
    try {
      if (rtAudio.isStreamRunning()) rtAudio.stop();
    } catch (_) {}
    try {
      if (rtAudio.isStreamOpen()) rtAudio.closeStream();
    } catch (_) {}
    rtAudio = null;
  }
  _expectedAudioBytes = 0;  // reset until new stream confirms its expected size

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

  // Reuse a single RtAudio instance across retry attempts — creating multiple
  // instances in rapid succession can leave CoreAudio in a bad state on macOS.
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
  // Close previous input stream if any
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

  // Reuse a single instance across retry attempts (same reason as output)
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
    const buf = Buffer.from(interleavedFloat32.buffer);
    if (_expectedAudioBytes > 0 && buf.length !== _expectedAudioBytes) {
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

  // Switch output device at runtime — accepts (deviceId, numChannels, bufferFrames)
  ipcMain.handle('set-audio-device', (event, deviceId, numChannels, bufferFrames, sampleRate) => {
    audioDeviceId = deviceId;
    createOutputStream(deviceId, numChannels, bufferFrames, sampleRate);
    const streaming  = !!(rtAudio && rtAudio.isStreamRunning());
    const actualRate = streaming ? (rtAudio.getStreamSampleRate?.() ?? null) : null;
    return { ok: true, streaming, sampleRate: actualRate };
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

app.whenReady().then(() => {
  setupIPC();
  const win = createWindow();
  _oscWin = win;
  startOSCReceiver();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      _oscWin = createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Stop streams before closing — closing while the CoreAudio IO thread is
  // still running can SIGBUS on macOS.
  if (rtAudio) {
    try { if (rtAudio.isStreamRunning()) rtAudio.stop(); } catch (_) {}
    try { if (rtAudio.isStreamOpen()) rtAudio.closeStream(); } catch (_) {}
    rtAudio = null;
  }
  if (rtAudioIn) {
    try { if (rtAudioIn.isStreamRunning()) rtAudioIn.stop(); } catch (_) {}
    try { if (rtAudioIn.isStreamOpen()) rtAudioIn.closeStream(); } catch (_) {}
    rtAudioIn = null;
  }
  if (process.platform !== 'darwin') app.quit();
});
