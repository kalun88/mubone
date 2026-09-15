// ============================================================================
// ELECTRON PRELOAD — exposes a safe IPC bridge to the renderer
// Runs in an isolated context with access to both Node and the DOM window.
// ============================================================================

const { contextBridge, ipcRenderer } = require('electron');

// Instance name + OSC listen port (multi-station setups) — passed via
// additionalArguments in electron-main.js createWindow().
const _instArg = process.argv.find(a => a.startsWith('--mubone-instance='));
const _oscPortArg = process.argv.find(a => a.startsWith('--mubone-osc-port='));

contextBridge.exposeInMainWorld('electronBridge', {
  isElectron: true,

  // Multi-station: this process's instance name ('a'|'b'|'c'|…) or null (solo)
  instanceName: _instArg ? _instArg.slice('--mubone-instance='.length) : null,

  // This process's OSC listen port (7500 solo; 7500/7510/7520 per station)
  oscPort: _oscPortArg ? parseInt(_oscPortArg.slice('--mubone-osc-port='.length), 10) : 7500,

  // Renderer → Main: restart the app (used after buffer-size change)
  restartApp: () => ipcRenderer.send('app-restart'),

  // Renderer → Main: open a direct audio channel of one kind ('out' | 'in').
  // One end goes to the main process, the other to the page's main world over
  // window.postMessage — the one way a MessagePort crosses contextIsolation —
  // where audio.js transfers it INTO the worklet. From then on the blocks and
  // the credits travel worklet ↔ main process and never touch the renderer's
  // main thread (2026-09-06: a stall there longer than the cushion was a hole
  // in the output). Each call replaces the previous port of that kind.
  openAudioPort: (kind) => {
    const { port1, port2 } = new MessageChannel();
    ipcRenderer.postMessage('audio-port', { kind }, [port1]);
    window.postMessage({ type: 'mubone-audio-port', kind }, '*', [port2]);
  },

  // Renderer → Main: request available output devices
  getAudioDevices: () => ipcRenderer.invoke('get-audio-devices'),

  // Renderer → Main: select a specific output device by ID and channel count
  setAudioDevice: (deviceId, numChannels, bufferFrames, sampleRate) =>
    ipcRenderer.invoke('set-audio-device', deviceId, numChannels, bufferFrames, sampleRate),

  // Renderer → Main: the streams' latency (frames), for js/latency.js
  getStreamLatency: () => ipcRenderer.invoke('get-stream-latency'),
  // Renderer → Main: the output queue's depth (frames written, not yet played),
  // its prime depth and how often it has run dry
  getOutputDepth: (gaps) => ipcRenderer.invoke('get-output-depth', !!gaps),
  // Renderer → Main: the stall cushion in ms — the depth the output queue is
  // primed to (electron-main.js primeOutput)
  setAudioCushion: (ms) => ipcRenderer.send('set-audio-cushion', ms),

  // Renderer → Main: request available input devices (true channel counts from RtAudio)
  getInputDevices: () => ipcRenderer.invoke('get-input-devices'),

  // Renderer → Main: open RtAudio input stream for multichannel metering
  setInputDevice: (deviceId, numChannels, bufferFrames, sampleRate) =>
    ipcRenderer.invoke('set-input-device', deviceId, numChannels, bufferFrames, sampleRate),

  // Main → Renderer: OSC message received from Max over UDP
  // All OSC addresses are forwarded — cb(address: string, values: any[])
  // osc.js dispatches to sensor, grain params, preset, etc.
  onOSC: (cb) =>
    ipcRenderer.on('osc-message', (_e, address, values) => cb(address, values)),

  // Renderer → Main: send an outbound OSC-style message via the UDP uplink
  // (udp://127.0.0.1:7501). Relay.js listens on that port and rebroadcasts to
  // its WS peers. Used by js/status-publisher.js to push /status/* messages
  // back to the joycon GUI for LED/rumble feedback.
  sendOSC: (address, values = []) =>
    ipcRenderer.send('osc-send', address, values),

  // Renderer → Main: send outbound real OSC binary to an arbitrary host:port.
  // Used by the staging module (js/osc-out.js) to drive external apps like
  // oVox / VocalSynth / Ableton / hardware via OSC. Distinct from sendOSC above
  // which targets the local relay in JSON format.
  sendOSCExternal: (host, port, address, values = []) =>
    ipcRenderer.send('osc-send-external', host, port, address, values),

  // Toggle fullscreen (uses simpleFullScreen to avoid macOS Spaces blackout).
  // Returns the new fullscreen state so the renderer can update immediately
  // (simpleFullScreen doesn't fire enter/leave-full-screen events on all platforms).
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),

  // Main → Renderer: native fullscreen state changed (enter/leave)
  // cb(isFullscreen: boolean)
  onFullscreenChanged: (cb) =>
    ipcRenderer.on('fullscreen-changed', (_e, isFullscreen) => cb(isFullscreen)),

  // Main → Renderer: forwarded main-process log for DevTools visibility
  onMainLog: (cb) =>
    ipcRenderer.on('main-log', (_e, level, msg) => cb(level, msg)),

  // ── x-IMU3 direct UDP bridge ──────────────────────────────────────────────
  // Discovery announcements arrive at 1 Hz on UDP 10000 (auto-started).
  // Data messages arrive on the device's configured "send" port.
  // Commands are sent as JSON+LF to the device's "receive" port.

  // Main → Renderer: network announcement JSON from x-IMU3
  // cb(json: { sync, name, sn, ip, port, send, receive, rssi, battery, status, _sourceIP })
  onXIMU3Discovery: (cb) =>
    ipcRenderer.on('ximu3-discovery', (_e, json) => cb(json)),

  // Main → Renderer: raw ASCII data line from x-IMU3 (e.g. "A,1000000,0.0000,0.0000,0.0000")
  // sourceIP: originating device IP (for multi-device routing)
  onXIMU3Data: (cb) =>
    ipcRenderer.on('ximu3-data', (_e, line, sourceIP) => cb(line, sourceIP)),

  // Main → Renderer: JSON command response from x-IMU3
  // sourceIP: originating device IP
  onXIMU3CommandResponse: (cb) =>
    ipcRenderer.on('ximu3-command-response', (_e, json, sourceIP) => cb(json, sourceIP)),

  // Renderer → Main: start listening for data on the device's send port
  ximu3StartData: (port) => ipcRenderer.invoke('ximu3-start-data', port),

  // Renderer → Main: stop the data listener on a specific port (ref-counted).
  // If called with no port, every listener is closed.
  ximu3StopData: (port) => ipcRenderer.invoke('ximu3-stop-data', port),

  // Renderer → Main: send a JSON command string to the device
  // ip: device IP, port: device receive port, jsonStr: e.g. '{"axes_alignment":16}'
  ximu3SendCommand: (ip, port, jsonStr) =>
    ipcRenderer.invoke('ximu3-send-command', ip, port, jsonStr),

  // ── Document files (.mubone) ────────────────────────────────────────────────
  // The renderer's only filesystem access, and it is deliberately this narrow:
  // two native dialogs, a ranged read, and a streamed write that lands through
  // a .part file. `js/mubone-file.js` is the only module that calls any of it.

  // Renderer → Main: native Save-as / Open dialogs. → { canceled, path }
  docSaveDialog: (opts) => ipcRenderer.invoke('doc-save-dialog', opts || {}),
  docOpenDialog: (opts) => ipcRenderer.invoke('doc-open-dialog', opts || {}),

  // Renderer → Main: size + mtime, for the recent list and the open check
  docStat: (path) => ipcRenderer.invoke('doc-stat', path),

  // Renderer → Main: whole file, or a byte range (the zip reader takes ranges
  // so a 300 MB piece is never one copy in the renderer). → { ok, bytes }
  docRead: (path, offset, length) => ipcRenderer.invoke('doc-read', path, offset, length),

  // Renderer → Main: what is open and whether it is dirty. macOS draws it —
  // window title, proxy icon, the dot in the close button.
  docSetState: (state) => ipcRenderer.send('doc-set-state', state),

  // Renderer → Main: the Open Recent list, whenever it changes.
  docSetRecent: (list) => ipcRenderer.send('doc-set-recent', list),

  // Renderer → Main: streamed write. begin → chunk… → end (renames into place),
  // or abort (drops the .part and leaves the old document alone).
  docWriteBegin: (path)      => ipcRenderer.invoke('doc-write-begin', path),
  docWriteChunk: (id, bytes) => ipcRenderer.invoke('doc-write-chunk', id, bytes),
  docWriteEnd:   (id)        => ipcRenderer.invoke('doc-write-end', id),
  docWriteAbort: (id)        => ipcRenderer.invoke('doc-write-abort', id),

  // ── x-IMU3 serial (USB CDC) bridge ──────────────────────────────────────────
  // Same ASCII protocol as UDP, just over a serial port.

  // Renderer → Main: list available serial ports
  // Returns [{ path, manufacturer, serialNumber, vendorId, productId }]
  // One-shot WiFi survey for the diagnostics page. Never polled.
  wifiScan: () => ipcRenderer.invoke('wifi-scan'),

  serialListPorts: () => ipcRenderer.invoke('serial-list-ports'),

  // Renderer → Main: open a serial port by path
  serialOpen: (portPath) => ipcRenderer.invoke('serial-open', portPath),

  // Renderer → Main: close a serial port
  serialClose: (portPath) => ipcRenderer.invoke('serial-close', portPath),

  // Renderer → Main: send a JSON command string over serial
  serialSendCommand: (portPath, jsonStr) =>
    ipcRenderer.invoke('serial-send-command', portPath, jsonStr),

  // Main → Renderer: data line from a serial port
  // cb(portPath: string, line: string)
  onSerialData: (cb) =>
    ipcRenderer.on('ximu3-serial-data', (_e, portPath, line) => cb(portPath, line)),

  // Main → Renderer: JSON command response from a serial port
  // cb(portPath: string, json: object)
  onSerialResponse: (cb) =>
    ipcRenderer.on('ximu3-serial-response', (_e, portPath, json) => cb(portPath, json)),
});
