# mubone sim

Granular synthesis simulator mapped to a 3D sphere. Sensor input from a BNO085 via Max/MSP. Runs in the browser (stereo) or as an Electron desktop app (multi-channel: quad, octaphonic, Dante, etc.).

---

## Browser (development / demos)

```
python3 serve.py
```

Serves the app at `https://localhost:4443`. Required for microphone access (getUserMedia needs HTTPS).

Then open `https://localhost:4443` in your browser (accept the self-signed cert warning).

> **Note:** The BNO085 sensor is not available in the browser. The sphere defaults to mouse/touch control. Max/OSC is not connected in browser mode — use Electron for sensor and OSC input.

---

## Electron (multi-channel performance)

```
npm run electron
```

On launch, Electron auto-selects the system default output device. Open **Audio Settings** to switch to a multi-channel interface (MOTU, Dante, etc.).

Max sends OSC directly to UDP port `7500` on localhost; the Electron main process receives it natively and pushes it to the renderer via IPC.

### Prerequisites

```
npm install
```

audify (RtAudio bindings) must be installed and rebuilt against Electron's Node:

```
npm install audify
./node_modules/.bin/electron-rebuild
```

---

## Spatial modes

Two modes control how grain positions translate to audio panning:

| Mode | When to use | How panning works | Output |
|---|---|---|---|
| **Sim** (default) | Headphones, browser, demos | View-relative — panning is computed in camera space. Rotating your view rotates the sound world with you (video-game style). Mouse drives the camera. | Stereo |
| **Physical** | Live performance, installation | World-space — grain positions are absolute. Speakers are fixed in the room; turning your body (via sensor) rotates the visual sphere but does not move the audio. | 2 – N channels |

Switch modes in the UI. In **physical** mode the BNO085 sensor (Electron only) drives both the visual camera and the paint cursor. Stereo output works in physical mode for testing with 2 speakers (L = 270°, R = 90°).

---

## Audio settings

Open the **audio settings** modal (gear icon) to configure:

| Setting | Browser | Electron | What it does |
|---|---|---|---|
| Input device | ✓ | ✓ | Select any system audio input; channel dropdown auto-populates. In Electron, true channel counts come from RtAudio (not WebRTC). |
| Input channel | ✓ | ✓ | Single channel or stereo (L+R) mix |
| Input gain | ✓ | ✓ | Pre-recording gain trim |
| Output device | — | ✓ | Pick any output interface by name and channel count |
| Master vol | ✓ | ✓ | Post-grain output level |
| Sample rate | ✓ | ✓ | 44100 / 48000 / 96000 Hz — Apply restarts the audio engine. In Electron also reopens the audify stream. |
| Buffer size | ✓ | ✓ | 128 / 256 / 512 / 1024 frames — Apply reopens the audify stream (informational only in browser) |
| Speaker sweep | ✓ | ✓ | Fires white noise through each output channel in sequence to verify speaker positions. Browser sweeps stereo L → C → R; Electron sweeps all N speakers. |

---

## Sensor (BNO085)

| Context | Sensor input |
|---|---|
| Electron | Max sends OSC quaternion to UDP `7500`. Main process parses it with `dgram` and pushes to renderer via `electronBridge.onSensorData`. No WebSocket needed. |
| Browser | Sensor unavailable. Sphere rotation falls back to mouse/touch. Max/OSC is not connected in browser mode. |

---

## Max patch

Send OSC messages to UDP port `7500` on localhost. Supports float (`f`), int (`i`), and double (`d`) argument types.

**Quaternion format:** address `list` with 4 floats `[qx, qy, qz, qw]` (matching BNO085 output).

---

## Project structure

```
index.html              — entry point (browser and Electron)
electron-main.js        — Electron main process: audify output/input streams, OSC UDP receiver, IPC handlers
electron-preload.js     — IPC bridge: exposes window.electronBridge to renderer
serve.py                — HTTPS file server for browser dev (requires localhost.pem + localhost-key.pem)

css/
  style.css

js/
  state.js              — constants, presets, shared S object
  main.js               — app entry point, wires up modules
  audio.js              — AudioContext, mic recording, speaker bus setup, grain buses, RtAudio input path
  grain.js              — per-grain synthesis and N-channel spatial routing
  sphere.js             — sphere geometry, particle painting, projection
  renderer.js           — canvas animation loop
  events.js             — mouse, keyboard, drag-drop handlers
  midi.js               — MIDI input and mapping modal
  mobile.js             — gyro/orientation tracking, touch handlers
  sensor.js             — BNO085 sensor: Electron IPC path (browser silently disabled)
  ui-audio-settings.js  — audio settings modal (input/output device pickers, channel routing, sweep)
  ui-samples.js         — loaded samples panel
  ui-presets.js         — presets panel
  ui-sensor.js          — sensor calibration UI

  worklets/
    quad-capture.worklet.js  — N-channel AudioWorklet capture → IPC → audify (batch size configured at runtime)

max/                    — Max/MSP patches
```

---

## SSL certs

`serve.py` expects `localhost.pem` and `localhost-key.pem` in the project root. Generate with:
```
mkcert localhost
```
