# mubone sim

Spatial granular synthesizer for live acoustic performance. Sound is recorded from a microphone, painted onto a 3D sphere as particles, and spatialized via VBAP to multi-channel speakers. An IMU wand controller (BNO085) drives the cursor and shapes the sound through orientation and gesture.

**Live:** [mubone.org/sim](https://mubone.org/sim)  
**Version:** 1.1 alpha

Runs in the browser (stereo) or as an Electron desktop app (multi-channel: quad, octaphonic, Dante, etc.).

---

## Quick start

### Browser (development / demos)

```
python3 serve.py
```

Serves at `https://localhost:4443` (HTTPS required for mic access). Accept the self-signed cert warning.

> In browser mode the sphere defaults to mouse/touch control. Use Electron for IMU sensor and OSC input.

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

See `INSTALL.md` for the full collaborator install guide (pre-built DMG, build-from-source, troubleshooting).

---

## Architecture

All grain synthesis runs in an **AudioWorklet** (`grain-engine.worklet.js`) on the audio thread — sample-accurate onset timing, 256-slot grain pool, zero main-thread node creation. The main-thread scheduler (`grain.js`, 30ms interval) performs spatial search and posts candidate lists to the worklet at ~33Hz. Communication is handled by the grain worklet bridge (`grain-worklet-bridge.js`).

Particle deposition is driven by the **paint ticker** (`paint-ticker.js`) at IMU arrival rate (up to 400Hz), decoupled from the canvas frame rate.

VBAP panning is pre-computed as a packed Float32Array lookup table and runs in the worklet — O(1) per grain for any speaker count.

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

Switch modes in Audio Settings. In world-locked mode the BNO085 sensor (Electron only) drives both the visual camera and the paint cursor. With two IMUs, the cursor detethers from the viewport center — the frame sensor controls the camera and the cursor sensor roams freely.

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
| Sample rate | yes | yes | 44100 / 48000 / 96000 Hz — applies immediately on change |
| Buffer size | yes | yes | 128 / 256 / 512 / 1024 frames |
| Speaker sweep | yes | yes | White noise through each output channel in sequence |
| Handsfree mode | yes | yes | Auto-recording via input gate with attack/hold/release envelope |

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
| `/grain/overlap` | `f` | Overlap ratio (duration / period) |
| `/grain/volume` | `f` | Grain volume (0–2) |
| `/grain/pitch` | `f` | Pitch jitter (0–1) |
| `/grain/pan` | `f` | Pan spread (0–1) |
| `/grain/radius` | `f` | Search radius in degrees (1–180) |
| `/grain/k` | `i` | Nearest-neighbor pool size |
| `/grain/prob` | `f` | Fire probability (0–1) |
| `/grain/dir` | `s` | `fwd` / `rev` / `rnd` |
| `/grain/dur_jitter` | `f` | Duration jitter (0–1) |
| `/preset` | `i` | Select preset by number (1-based) |
| `/mute` | `i` | `1` = mute, `0` = unmute |
| `/seed/plant` | *(bang)* | Plant a seed at current cursor position |
| `/seed/uproot` | *(bang)* | Remove the nearest seed |
| `/trace/toggle` | *(bang)* | Toggle trace on/off (foot pedal friendly) |
| `/handsfree` | *(bang)* | Toggle handsfree recording mode |
| `/undo` | *(bang)* | Undo last paint stroke |

---

## Performance tuning

Key constants live at the top of `js/state.js`:

| Constant | Default | What it controls |
|---|---|---|
| `GRAIN_SCHEDULER_INTERVAL_MS` | `30` | Main-thread scheduler tick rate. Only posts candidate lists to the worklet — no audio node creation on the main thread. |
| `RENDER_TARGET_FPS` | `30` | Canvas redraw rate cap. Lower to 20 on dense particle scenes. |
| `LIVE_REBUILD_INTERVAL_MS` | `50` | How often the main-thread AudioBuffer snapshot is rebuilt during live recording. The worklet has real-time audio via its `process()` input. |

> **If hitting CPU limits:** enable Performance Mode (⇧P) to reduce canvas rendering. The grain engine runs entirely in the AudioWorklet, so visual throttling directly frees the main thread for responsive UI and scheduling.

---

## Project structure

```
index.html              — single-page app entry point
serve.py                — HTTPS server for browser dev
electron-main.js        — Electron main process (audify, OSC, IPC)
electron-preload.js     — IPC bridge (window.electronBridge)
CLAUDE.md               — project context for Cowork / Claude Code sessions
INSTALL.md              — collaborator install guide (DMG + source)

docs/
  TODO.md               — current tasks and priorities
  QUICK-START.md        — getting started walkthrough
  KEYBOARD-SHORTCUTS.md — keybinding reference
  INTERACTION-MODEL.md  — trace / scan / commit interaction model
  EXP-NOTES.md          — experimental module design notes
  GESTURE-MAPPING-PLAN.md — gesture-to-synthesis mapping design
  TIMING-REFERENCE.md   — master table of all timing intervals and rates
  ROUTING-DESIGN.md     — signal routing pipeline
  EULER-VS-QUAT.md      — quaternion vs Euler input analysis
  SENSOR-MOUNTING.md    — dual-IMU setup procedure
  TARE-RECENTER-ZERO.md — sensor calibration reference
  mubone-architecture-notes.md — multi-channel audio architecture

  archive/              — completed plans and audits (historical reference)

css/
  style.css

js/
  state.js              — constants, presets, shared state object (S)
  main.js               — app entry point, wires up all modules
  audio.js              — AudioContext, mic recording, speaker buses
  grain.js              — grain scheduling, spatial search, candidate posting
  grain-worklet-bridge.js — main-thread ↔ worklet communication layer
  paint-ticker.js       — velocity-adaptive particle deposition (up to 400Hz)
  sphere.js             — 3D math, quaternion ops, projection
  renderer.js           — canvas animation loop, particle/seed/cursor drawing
  audio-features.js     — real-time audio analysis (RMS, centroid, ZCR)
  debug-waveform.js     — visual debug tool for inspecting audio buffers
  diag.js               — rolling diagnostic event log (dlog)
  events.js             — mouse, keyboard, drag-drop handlers
  handsfree.js          — auto-recording gate engine
  midi.js               — MIDI input and CC mapping
  mobile.js             — mobile gyro/touch support
  sensor.js             — IMU sensor data (BNO085 quaternion + tare)
  imu-setup.js          — direct x-IMU3 connection (WiFi/USB)
  sensor-mapping.js     — sensor → parameter mapping engine
  sensor-registry.js    — sensor slot registry (cursor, frame, wand)
  seed-morph.js         — seed agitate/smooth gesture morphing
  wand.js               — wand controller mapping
  osc.js                — OSC message dispatch
  param-lock.js         — parameter lock state
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
    exp-toggles.js      — runtime feature toggle UI

  worklets/
    grain-engine.worklet.js      — AudioWorklet grain synthesis engine (256-slot pool)
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
