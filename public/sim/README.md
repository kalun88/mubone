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

## Max integration

The same OSC namespace works in both browser and Electron — only the transport differs.

`bridge.js` runs continuously via `[node.script bridge.js]` inside the Max patch regardless of mode. It handles both transport paths internally:

| Context | Transport | How it works |
|---|---|---|
| Electron | UDP | `bridge.js` encodes messages as OSC binary and sends UDP to `127.0.0.1:7500`; Electron main process receives natively via `dgram` |
| Browser | WebSocket | `bridge.js` runs a local WebSocket server on `ws://localhost:8080`; the browser auto-connects and retries every 3 seconds |

Send `setmode electron` or `setmode browser` to `[node.script bridge.js]` to switch transport. The Max patch has a toggle that sends this message — all controller logic (sliders, presets, sensor data) is shared upstream of it.

A `● MAX` indicator appears in the top-right corner of the UI when a connection is established.

### Setup (one time)

In the `max/` folder:
```
npm install
```

This installs the `ws` WebSocket package used by `bridge.js`. After that, opening the Max patch starts the bridge automatically via `node.script`.

### OSC namespace

All messages use the same addresses regardless of transport:

| Address | Args | Description |
|---|---|---|
| `/orientation` | `f f f f` | BNO085 quaternion `[qx, qy, qz, qw]` |
| `/grain/duration` | `f` | Grain duration in seconds |
| `/grain/period` | `f` | Onset period in seconds |
| `/grain/volume` | `f` | Grain volume (0–2) |
| `/grain/pitch` | `f` | Pitch jitter (0–1) |
| `/grain/pan` | `f` | Pan spread (0–1) |
| `/grain/radius` | `f` | Search radius in degrees (1–180) |
| `/grain/k` | `i` | Pool size |
| `/grain/prob` | `f` | Fire probability (0–1) |
| `/grain/dir` | `s` | `fwd` / `rev` / `rnd` |
| `/preset` | `i` | Select preset by number (1-based: 1=wash, 2=vinyl, 3=cloud, 4=freeze, 5=pulse, 6=shimmer, 7=ghost, 8=glitch, 9=chop, 10=stutter, 11=wobble) |
| `/spatial/mode` | `s` | `sim` / `physical` |
| `/record` | `i` | `1` = start, `0` = stop |
| `/mute` | `i` | `1` = mute, `0` = unmute |
| `/cloud/drop` | *(bang)* | Drop a cloud at the current cursor position |
| `/cloud/pickup` | *(bang)* | Pick up (remove) the nearest cloud |
| `/undo` | *(bang)* | Undo the last particle paint action |

Bang-style messages (`/cloud/drop`, `/cloud/pickup`, `/undo`) trigger on any incoming value — send `1` or bang from Max.

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
