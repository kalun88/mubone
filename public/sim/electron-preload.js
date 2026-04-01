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
});
