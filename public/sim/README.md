# mubone sim

Spatial granular synthesizer for live acoustic performance. Sound is recorded from a microphone, painted onto a 3D sphere as particles, and spatialized via VBAP to multi-channel speakers. An IMU wand controller (BNO085) drives the cursor and shapes the sound through orientation and gesture.

**Live:** [mubone.org/sim](https://mubone.org/sim)

Runs in the browser (stereo) or as an Electron desktop app (multi-channel: quad, octaphonic, Dante, etc.).

---

## Quick start

### Browser (development / demos)

```
python3 serve.py
```

Serves at `https://localhost:4443` (HTTPS required for mic access). Accept the self-signed cert warning.

> The BNO085 sensor is not available in browser mode. The sphere defaults to mouse/touch control. Use Electron for sensor and OSC input.

### Electron (multi-channel performance)

```
npm install
npm run electron
```

On launch, Electron auto-selects the system default output device. Open **Audio Settings** to switch to a multi-channel interface (MOTU, Dante, etc.).

audify (RtAudio bindings) must be rebuilt against Electron's Node:

```
npm install audify
./node_modules/.bin/electron-rebuild
```

---

## Experimental mode

Add `?exp` to the URL to enable experimental modules:

```
https://localhost:4443?exp
```

A small orange "exp" badge appears at the top of the viewport. Experimental features are invisible without this flag — collaborators on the published build never see them.

Experimental code lives in `js/exp/`. See `docs/EXP-NOTES.md` for design notes.

---

## Spatial modes

| Mode | When to use | How panning works | Output |
|---|---|---|---|
| **Head-locked** (default) | Headphones, browser, demos | View-relative — panning is computed in camera space. Rotating your view rotates the sound world with you. | Stereo |
| **World-locked** | Live performance, installation | World-space — grain positions are absolute. Speakers are fixed in the room; rotating the camera does not move the audio. | 2 – N channels |

Switch modes in Audio Settings. In world-locked mode the BNO085 sensor (Electron only) drives both the visual camera and the paint cursor.

---

## Audio settings

Open the **audio settings** modal to configure:

| Setting | Browser | Electron | What it does |
|---|---|---|---|
| Input device | yes | yes | Select any system audio input; channel dropdown auto-populates |
| Input channel | yes | yes | Single channel or stereo (L+R) mix |
| Input gain | yes | yes | Pre-recording gain trim |
| Output device | — | yes | Pick any output interface by name and channel count |
| Master vol | yes | yes | Post-grain output level |
| Sample rate | yes | yes | 44100 / 48000 / 96000 Hz — Apply restarts the audio engine |
| Buffer size | yes | yes | 128 / 256 / 512 / 1024 frames |
| Speaker sweep | yes | yes | White noise through each output channel in sequence |

---

## Max integration

`bridge.js` runs via `[node.script bridge.js]` inside the Max patch. It handles both transport paths:

| Context | Transport | How it works |
|---|---|---|
| Electron | UDP | OSC binary to `127.0.0.1:7500`; Electron receives via `dgram` |
| Browser | WebSocket | WebSocket server on `ws://localhost:8080`; browser auto-connects |

Send `setmode electron` or `setmode browser` to switch transport.

### Setup (one time)

In the `max/` folder:
```
npm install
```

### OSC namespace

| Address | Args | Description |
|---|---|---|
| `/space/cursor` | `f f f f` | BNO085 quaternion `[qx, qy, qz, qw]` |
| `/space/frame` | `f f f f` | Second sensor (world reference) quaternion |
| `/space/wand` | `f f f f` | Wand controller quaternion |
| `/space/wand/inertial` | `f f f f f f` | Wand gyro + accel `[gx, gy, gz, ax, ay, az]` |
| `/grain/duration` | `f` | Grain duration in seconds |
| `/grain/period` | `f` | Onset period in seconds |
| `/grain/volume` | `f` | Grain volume (0–2) |
| `/grain/pitch` | `f` | Pitch jitter (0–1) |
| `/grain/pan` | `f` | Pan spread (0–1) |
| `/grain/radius` | `f` | Search radius in degrees (1–180) |
| `/grain/k` | `i` | Nearest-neighbor pool size |
| `/grain/prob` | `f` | Fire probability (0–1) |
| `/grain/dir` | `s` | `fwd` / `rev` / `rnd` |
| `/preset` | `i` | Select preset by number (1-based) |
| `/mute` | `i` | `1` = mute, `0` = unmute |
| `/seed/plant` | *(bang)* | Plant a seed at current cursor position |
| `/seed/uproot` | *(bang)* | Remove the nearest seed |
| `/undo` | *(bang)* | Undo last paint stroke |

---

## Performance tuning

All constants live at the top of `js/state.js`:

| Constant | Default | What it controls |
|---|---|---|
| `MAX_GRAIN_NODES` | `150` | Hard cap on concurrent AudioBufferSourceNodes. Each grain holds 2–3 nodes. Chrome audio thread crashes above ~400–600 total nodes. |
| `GRAIN_SCHEDULER_INTERVAL_MS` | `10` | Scheduler tick rate in ms (100 ticks/sec). Grains can be scheduled down to ~1ms periods at this rate. |
| `RENDER_TARGET_FPS` | `30` | Canvas redraw rate cap. Lower to 20 on dense particle scenes. |
| `LIVE_REBUILD_INTERVAL_MS` | `200` | How often the live recording buffer is rebuilt during active mic recording. |

> **If hitting CPU limits:** lower `MAX_GRAIN_NODES` to 100 first, then raise `GRAIN_SCHEDULER_INTERVAL_MS` to 30. Those two changes have the biggest impact.

---

## Project structure

```
index.html              — single-page app entry point
serve.py                — HTTPS server for browser dev
electron-main.js        — Electron main process (audify, OSC, IPC)
electron-preload.js     — IPC bridge (window.electronBridge)
CLAUDE.md               — project context for Cowork / Claude Code sessions

docs/
  TODO.md               — current tasks and priorities
  EXP-NOTES.md          — experimental module design notes
  IMPROV-FEATURE-PLAN.md — improv mode feature plan
  mubone-architecture-notes.md — audio architecture decisions

css/
  style.css

js/
  state.js              — constants, presets, shared state object (S)
  main.js               — app entry point, wires up all modules
  audio.js              — AudioContext, mic recording, speaker buses
  grain.js              — granular engine, grain scheduling, VBAP routing
  sphere.js             — 3D math, quaternion ops, projection
  renderer.js           — canvas animation loop, particle/seed/cursor drawing
  audio-features.js     — real-time audio analysis (RMS, centroid, ZCR)
  events.js             — mouse, keyboard, drag-drop handlers
  midi.js               — MIDI input and CC mapping
  mobile.js             — mobile gyro/touch support
  sensor.js             — IMU sensor data (BNO085 quaternion + tare)
  wand.js               — wand controller mapping (axis slots, morph, 2D blend)
  osc.js                — OSC message dispatch
  param-lock.js         — parameter lock state
  diag.js               — diagnostics overlay
  ui-presets.js         — preset panel, save/load, desktop morph
  ui-samples.js         — sample loading, waveform display, crop
  ui-audio-settings.js  — audio device/gain/routing settings
  ui-meters.js          — VU metering, mixdown controls
  ui-wand.js            — wand mapping UI
  ui-sensor.js          — sensor calibration UI
  ui-improv.js          — improv mode UI
  ui-viz.js             — visualization settings
  ui-sweep.js           — particle sweep tool
  ui-learn.js           — learning mode tooltips
  ui-export.js          — settings export/import
  ui-patch-table.js     — patch table editor
  ui-trace.js           — trace display

  exp/                  — experimental modules (loaded only with ?exp)
    exp-init.js         — bootstrap, module registry

  worklets/
    quad-capture.worklet.js      — N-channel capture → IPC → audify
    input-meter.worklet.js       — input level metering
    recording-capture.worklet.js — mic recording capture

max/                    — Max/MSP patches and bridge.js
```

---

## SSL certs

`serve.py` expects `localhost.pem` and `localhost-key.pem` in the project root:
```
mkcert localhost
```
