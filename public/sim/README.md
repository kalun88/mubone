# mubone sim

> **Status: CURRENT** · user-facing overview · verified 2026-07-28 against 1.11 alpha.

Spatial granular synthesizer for live acoustic performance. Sound is recorded from a microphone, painted onto a 3D sphere as particles, and spatialized via VBAP to multi-channel speakers. An **x-imu3** sensor drives the cursor and shapes the sound through orientation and gesture.

**Live:** [mubone.org/sim](https://mubone.org/sim)  
**Version:** 1.11 alpha

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

See `INSTALL.md` for the full install guide (pre-built DMG, build-from-source, troubleshooting).

---

## Architecture

All grain synthesis runs in an **AudioWorklet** (`grain-engine.worklet.js`) on the audio thread — sample-accurate onset timing, 256-slot grain pool, zero main-thread node creation. The main-thread scheduler (`grain.js`, 30ms interval) performs spatial search and posts candidate lists to the worklet at ~33Hz. Communication is handled by the grain worklet bridge (`grain-worklet-bridge.js`).

Particle deposition is driven by the **paint ticker** (`paint-ticker.js`) at IMU arrival rate (up to 400Hz), decoupled from the canvas frame rate.

VBAP panning is pre-computed as a packed Float32Array lookup table and runs in the worklet — O(1) per grain for any speaker count.

---

## Exploring beyond the main UI

The `?exp` URL flag was removed. All modules live under `js/` and everything that used to be gated is either always-on (gesture, snapshot, staging) or invokable from the DevTools console:

```js
// from DevTools:
const m = await import('./js/<module-name>.js');
m.someExportedFn();
```

The console object `window.wg` exposes worklet-engine control (`wg.start()`, `wg.stop()`, `wg.set(params)`, `wg.status()`, `wg.diag()`). See `docs/EXP-NOTES.md` for design notes on gesture extraction, self-organizing paint, and other in-flight research directions.

---

## Spatial modes

| Mode | When to use | How panning works | Output |
|---|---|---|---|
| **Head-locked** (default) | Headphones, browser, demos | View-relative — panning is computed in camera space. Rotating your view rotates the sound world with you. | Stereo |
| **World-locked** | Live performance, installation | World-space — grain positions are absolute. Speakers are fixed in the room; rotating the camera does not move the audio. | 2 – N channels |

Switch modes in Audio Settings. In world-locked mode the x-imu3 sensor (Electron only) drives both the visual camera and the paint cursor. With two sensors, the cursor detethers from the viewport center — the frame sensor controls the camera and the cursor sensor roams freely.

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

Every case in this table is a real handler in `js/osc.js`. "bang" means the handler ignores the value and treats any message as a trigger.

**Sensor input**

| Address | Args | Description |
|---|---|---|
| `/sensor/{name}/quaternion` | `f f f f` | Sensor quaternion `[qx, qy, qz, qw]` — slot registers on first receipt, role (cursor / frame / gesture) assigned in the sensor-mapping UI |
| `/sensor/{name}/inertial` | `f f f f f f` | Sensor gyro + accel `[gx, gy, gz, ax, ay, az]` |

**Grain parameters** — all write to `S.grainOverrides`; scheduler picks up next tick

| Address | Args | Description |
|---|---|---|
| `/grain/dur` | `f` | Grain duration, ms (1–4000) |
| `/grain/per` | `f` | Onset period, ms (1–4000) |
| `/grain/overlap` | `f` | Ratio — sets duration = period × overlap (0.01–100) |
| `/grain/volume` | `f` | Grain volume (0–2) |
| `/grain/pitch` | `f` | Pitch jitter, cents (0–700) |
| `/grain/pan` | `f` | Pan spread, percent (0–100) |
| `/grain/fade` | `f` | Attack + release envelope, percent (0–50) |
| `/grain/durjitter` | `f` | Multiplicative duration jitter (0–1) |
| `/grain/durvar` | `f` | Additive duration jitter, ms (0–500) |
| `/grain/pervar` | `f` | Additive period jitter, ms (0–500) |
| `/grain/retrigger` | `f` | Retrigger window, ms (0–500) |
| `/grain/prob` | `f` | Fire probability (0–1) |
| `/grain/pitchshift` | `f` | Pitch shift, cents (-2400 to +2400) |
| `/grain/oct/down` `/oct/up` | *(bang)* | Step the pitch shift by ∓1200¢ (clamped at ±2400¢) |
| `/grain/oct/reset` | *(bang)* | Return the pitch shift to 0¢ |
| `/grain/hpf` | `f` | Per-grain HPF cutoff, Hz (20–20000) |
| `/grain/lpf` | `f` | Per-grain LPF cutoff, Hz (20–20000) |
| `/grain/filterq` | `f` | Filter Q (0.1–20) |
| `/grain/filterjitter` | `f` | Filter freq jitter fraction (0–1) |
| `/grain/dir` | *(bang)* | Cycle grain playback direction |
| `/grain/curve` | *(bang)* | Cycle grain envelope curve |

**Search**

| Address | Args | Description |
|---|---|---|
| `/search/radius` | `f` | Search radius, degrees |
| `/search/radius/inc` `/dec` | *(bang)* | Step radius up / down |
| `/search/k` | `i` | Nearest-neighbor pool size |
| `/search/recency` | `i` | Recency window, 0 = all, up to 16 |
| `/search/scope` | *(bang)* | Toggle nearest/snap scope |
| `/search/fill` | *(bang)* | Toggle k-fill mode |
| `/search/order` | *(bang)* | Toggle k ordering |

**Commit system** (unified cloud + loop — replaces the legacy `/seed/*` namespace)

| Address | Args | Description |
|---|---|---|
| `/commit/drop` | *(bang)* | Drop commit at cursor |
| `/commit/draw` | `i` | Draw commit (1 = start, 0 = stop) |
| `/commit/release` | *(bang)* | Release nearest commit |
| `/commit/clear` | *(bang)* | Clear all commits |
| `/commit/mode` | *(bang)* | Cycle commit mode (cloud ↔ loop) |
| `/commit/blend` | *(bang)* | Toggle blend mode |
| `/commit/tether` | *(bang)* | Toggle tether mode |
| `/commit/xfade` | `f` | Snap/fade crossfade time (0–1) |
| `/commit/attack` | `f` | Commit attack, s (0–10) |
| `/commit/release_time` | `f` | Commit release, s (0–10) |
| `/commit/loop_fade_time` | `f` | Loop fade time, ms (0–2000) |
| `/commit/loop_release` | *(bang)* | Cycle loop release mode |
| `/commit/volume` | `f` | Next-commit volume (0–1) |
| `/commit/speed` | `f` | Next-commit speed (0.25–4) |
| `/commit/slots` | `i` | Slot count (1–16) |
| `/commit/overflow` | *(bang)* | Cycle overflow behaviour |
| `/commit/selection` | *(bang)* | Cycle selection mode |
| `/commit/dir` | *(bang)* | Cycle commit direction |

**Camera & spatial**

| Address | Args | Description |
|---|---|---|
| `/camera/mode` | *(bang)* | Cycle camera mode (pull / surface / sensor) |
| `/spatial/panning` | *(bang)* | Toggle spatial panning (headlocked / worldlocked) |
| `/spatial/mode` | *(bang)* | Legacy compound — flips both camera + panning between "sim" and "physical" presets |
| `/spatial/lock` | `i` | Spatial lock hold (1 = lock, 0 = release) |

**Cursor & transport**

| Address | Args | Description |
|---|---|---|
| `/cursor/scan` | `i` | Toggle scan (cursor → house bus) |
| `/cursor/tare` | *(bang)* | Tare cursor sensor |
| `/cursor/lock_az` `/lock_el` | *(bang)* | Toggle azimuth / elevation lock |
| `/cursor/radiusfade` | *(bang)* | Toggle radius fade |
| `/cursor/radiusfadecurve` | `f` | Radius fade curve (0–1) |
| `/mute` | *(bang)* | Master mute toggle |
| `/mute/hold` | `i` | Momentary mute (1 = mute, 0 = restore the pre-press state) |
| `/trace` | `i` | Trace (1 = start rec + paint, 0 = stop) |
| `/trace/toggle` | *(bang)* | Toggle trace on/off |
| `/trace/mode` | *(bang)* | Cycle trace mode (trace / trace+loop / trace+cloud) |
| `/paint/1` … `/paint/10` | `i` | Momentary sample paint for slots 1–10 (1 = start, 0 = stop) |
| `/sweep` | *(bang)* | Session sweep |
| `/undo` | *(bang)* | Undo last stroke |
| `/handsfree` | *(bang)* | Toggle handsfree mode |
| `/session/erase` | *(bang)* | Erase all |
| `/preset` | `i` | Select patch by number (1–20: 1–10 factory, 11–20 user) |
| `/preset/1` … `/preset/20` | `bang` | Select that patch directly — one address per patch, for pads and pedals |
| `/app/perf` `/app/perfmode` `/app/darkmode` | *(bang)* | Toggle perf monitor / high-perf render / dark mode |

**Audio levels**

| Address | Args | Description |
|---|---|---|
| `/master/volume` | `f` | Output gain, dB (-60 to +6) |
| `/monitor/volume` | `f` | Cursor → house send level (0–1) |
| `/house/volume` | `f` | Seed bus master (0–2) |
| `/mixdown/cursor` | `f` | Headphone mixdown cursor gain (0–1) |
| `/mixdown/house` | `f` | Headphone mixdown house gain (0–1) |
| `/dry/gain` | `f` | Spatialized live-input gain in house mix (0–2) |
| `/gate/threshold` | `f` | Noise gate threshold (linear RMS, 0–0.06) |

**Mapping module — external inputs**

| Address | Args | Description |
|---|---|---|
| `/mapping/toggle/1` … `/mapping/toggle/4` | *(bang)* | Toggle the first 4 sensor-mapping rows |
| `/mapping1` `/mapping2` `/mapping3` | `f` | Generic OSC inputs that appear as axes in the mapping modal — any peer can drive these |

**Morph**

| Address | Args | Description |
|---|---|---|
| `/morph/position` | `f` | Desktop morph T (0–1) |
| `/morph/sticky` | *(bang)* | Toggle morph hold |
| `/morph/return` | `f` | Return-to-center glide, ms (50–3000) |

> Source of truth: the dispatch `switch` in `js/osc.js`. If an address isn't in there, it isn't handled — no `/seed/*`, no `/grain/duration`, no `/grain/radius`, no `/space/cursor`. A few legacy `/space/*` addresses are still emitted by the Max patch but silently dropped by the current dispatch.

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
  TIMING-REFERENCE.md   — master table of all timing intervals and rates
  ROUTING-DESIGN.md     — signal routing pipeline
  EULER-VS-QUAT.md      — quaternion vs Euler input analysis
  SENSOR-MOUNTING.md    — sensor mounting / axis alignment
  MULTI-IMU-PLAN.md     — multi-sensor plan (adding frame sensor)
  MAIN-PAGE-REDESIGN.md — in-flight UI redesign (periscope / overview)
  STAGING-PLAN.md       — staging + performance prep
  GROUP-SHOW-NOISE-GLITCH.md — known noise/glitch issues from group shows
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
  sensor-registry.js    — sensor slot registry (cursor, frame, gesture roles)
  sensor-mapping.js     — sensor → parameter mapping engine
  imu-setup.js          — direct x-imu3 connection (WiFi/USB)
  ui-imu-setup.js       — x-imu3 connection UI
  ui-sensor-mapping.js  — sensor mapping UI (axis map, calibration)
  ximu-led-feedback.js  — x-imu3 onboard LED feedback
  seed-morph.js         — seed agitate/smooth gesture morphing
  osc.js                — OSC message dispatch (inbound)
  osc-out.js            — OSC message dispatch (outbound)
  midi.js               — MIDI input and CC mapping
  midi-out.js           — MIDI output
  status-publisher.js   — status broadcast channel for secondary windows
  param-lock.js         — parameter lock state
  ui-presets.js         — preset panel, save/load, desktop morph
  ui-samples.js         — sample loading, waveform display, crop
  ui-audio-settings.js  — audio device/gain/routing settings
  ui-meters.js          — VU metering, mixdown controls
  ui-improv.js          — improv mode UI
  ui-viz.js             — visualization settings
  ui-sweep.js           — particle sweep tool
  ui-learn.js           — learning mode tooltips
  ui-export.js          — settings export/import
  ui-patch-table.js     — patch table editor
  ui-trace.js           — trace display
  gesture.js            — gesture feature extraction (smoothness, effort, periodicity)
  gesture-viz.js        — gesture feature visualization overlay
  gesture-panel.js      — gesture mapping panel UI (Shift+G)
  snapshot-engine.js    — posture-snapshot staging engine
  ui-staging.js         — staging modal UI
  relational-features.js — cross-sensor relational features (Δ-angles for staging)
  interp-kernels.js     — interpolation kernels shared by staging + radial morph

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
