// ============================================================================
// ELECTRON PRELOAD — exposes a safe IPC bridge to the renderer
// Runs in an isolated context with access to both Node and the DOM window.
// ============================================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronBridge', {
  isElectron: true,

  // Renderer → Main: send a captured N-channel interleaved audio buffer to RtAudio
  sendAudioBuffer: (interleavedFloat32) => {
    ipcRenderer.send('audio-buffer', interleavedFloat32);
  },

  // Renderer → Main: request available output devices
  getAudioDevices: () => ipcRenderer.invoke('get-audio-devices'),

  // Renderer → Main: select a specific output device by ID and channel count
  setAudioDevice: (deviceId, numChannels, bufferFrames, sampleRate) =>
    ipcRenderer.invoke('set-audio-device', deviceId, numChannels, bufferFrames, sampleRate),

  // Renderer → Main: request available input devices (true channel counts from RtAudio)
  getInputDevices: () => ipcRenderer.invoke('get-input-devices'),

  // Renderer → Main: open RtAudio input stream for multichannel metering
  setInputDevice: (deviceId, numChannels, bufferFrames, sampleRate) =>
    ipcRenderer.invoke('set-input-device', deviceId, numChannels, bufferFrames, sampleRate),

  // Main → Renderer: raw multichannel input PCM pushed from RtAudio input callback
  // cb(interleavedFloat32: Float32Array, numChannels: number)
  onAudioInputBuffer: (cb) =>
    ipcRenderer.on('audio-input-buffer', (_e, f32, nCh) => cb(f32, nCh)),

  // Main → Renderer: OSC message received from Max over UDP
  // All OSC addresses are forwarded — cb(address: string, values: any[])
  // osc.js dispatches to sensor, grain params, preset, etc.
  onOSC: (cb) =>
    ipcRenderer.on('osc-message', (_e, address, values) => cb(address, values)),

  // Main → Renderer: credit-based flow control for audio buffer backpressure
  onAudioCredit: (cb) => ipcRenderer.on('audio-credit', (_, credits) => cb(credits)),

  // Toggle fullscreen (uses simpleFullScreen to avoid macOS Spaces blackout).
  // Returns the new fullscreen state so the renderer can update immediately
  // (simpleFullScreen doesn't fire enter/leave-full-screen events on all platforms).
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),

  // Main → Renderer: native fullscreen state changed (enter/leave)
  // cb(isFullscreen: boolean)
  onFullscreenChanged: (cb) =>
    ipcRenderer.on('fullscreen-changed', (_e, isFullscreen) => cb(isFullscreen)),

  // ── x-IMU3 direct UDP bridge ──────────────────────────────────────────────
  // Discovery announcements arrive at 1 Hz on UDP 10000 (auto-started).
  // Data messages arrive on the device's configured "send" port.
  // Commands are sent as JSON+LF to the device's "receive" port.

  // Main → Renderer: network announcement JSON from x-IMU3
  // cb(json: { sync, name, sn, ip, port, send, receive, rssi, battery, status, _sourceIP })
  onXIMU3Discovery: (cb) =>
    ipcRenderer.on('ximu3-discovery', (_e, json) => cb(json)),

  // Main → Renderer: raw ASCII data line from x-IMU3 (e.g. "A,1000000,0.0000,0.0000,0.0000")
  onXIMU3Data: (cb) =>
    ipcRenderer.on('ximu3-data', (_e, line) => cb(line)),

  // Main → Renderer: JSON command response from x-IMU3
  onXIMU3CommandResponse: (cb) =>
    ipcRenderer.on('ximu3-command-response', (_e, json) => cb(json)),

  // Renderer → Main: start listening for data on the device's send port
  ximu3StartData: (port) => ipcRenderer.invoke('ximu3-start-data', port),

  // Renderer → Main: stop the data listener
  ximu3StopData: () => ipcRenderer.invoke('ximu3-stop-data'),

  // Renderer → Main: send a JSON command string to the device
  // ip: device IP, port: device receive port, jsonStr: e.g. '{"axes_alignment":16}'
  ximu3SendCommand: (ip, port, jsonStr) =>
    ipcRenderer.invoke('ximu3-send-command', ip, port, jsonStr),

  // ── x-IMU3 serial (USB CDC) bridge ──────────────────────────────────────────
  // Same ASCII protocol as UDP, just over a serial port.

  // Renderer → Main: list available serial ports
  // Returns [{ path, manufacturer, serialNumber, vendorId, productId }]
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
