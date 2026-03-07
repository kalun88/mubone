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
  setAudioDevice: (deviceId, numChannels, bufferFrames) =>
    ipcRenderer.invoke('set-audio-device', deviceId, numChannels, bufferFrames),

  // Renderer → Main: request available input devices (true channel counts from RtAudio)
  getInputDevices: () => ipcRenderer.invoke('get-input-devices'),

  // Renderer → Main: open RtAudio input stream for multichannel metering
  setInputDevice: (deviceId, numChannels, bufferFrames) =>
    ipcRenderer.invoke('set-input-device', deviceId, numChannels, bufferFrames),

  // Main → Renderer: raw multichannel input PCM pushed from RtAudio input callback
  // cb(interleavedFloat32: Float32Array, numChannels: number)
  onAudioInputBuffer: (cb) =>
    ipcRenderer.on('audio-input-buffer', (_e, f32, nCh) => cb(f32, nCh)),

  // Main → Renderer: OSC message received from Max over UDP
  // All OSC addresses are forwarded — cb(address: string, values: any[])
  // osc.js dispatches to sensor, grain params, preset, etc.
  onOSC: (cb) =>
    ipcRenderer.on('osc-message', (_e, address, values) => cb(address, values)),

  // Toggle native OS fullscreen (web requestFullscreen doesn't work in BrowserWindow)
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
});
