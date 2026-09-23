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

The `?exp` URL flag was removed. All modules live flat under `js/`. What it used to gate is either always-on now or invokable from the DevTools console (the gesture, snapshot and staging modules were sunset in August 2026 and are git history, so there is nothing left to import):

```js
// from DevTools:
const m = await import('./js/<module-name>.js');
m.someExportedFn();
```

The console object `window.wg` exposes worklet-engine control (`wg.start()`, `wg.stop()`, `wg.set(params)`, `wg.status()`, `wg.diag()`). `docs/EXP-NOTES.md` holds unbuilt idea-space; its gesture, snapshot and staging sections describe modules that no longer exist.

---

## Spatial modes

| Mode | When to use | How panning works | Output |
|---|---|---|---|
| **Head-locked** | Headphones, browser, demos | View-relative — panning is computed in camera space. Rotating your view rotates the sound world with you. | Stereo |
| **World-locked** (default) | Live performance, installation | World-space — grain positions are absolute. Speakers are fixed in the room; rotating the camera does not move the audio. | 2 – N channels |

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

## Control surface

Two ports. Anything that speaks one of them drives the app; neither is specific to any particular
sender.

| Context | Transport | How it works |
|---|---|---|
| Electron | UDP | binary OSC to `127.0.0.1:7500`, received via `dgram`. The show path |
| Browser | WebSocket | `{ address, values }` JSON on `ws://localhost:8080` |

`proxy.js` in this repo is the WebSocket implementation mubone maintains — it bridges x-IMU3 UDP
into browser mode (`node proxy.js`, needs `npm install ws`). The hosted demo at mubone.org/sim
never opens the socket at all, so it has no OSC input by design.

**Max is a prototyping tool, not part of the app.** Ek keeps a Max patch to test custom OSC mappings and to try a control on the fly; anything that sends OSC — Max, Pd, TouchOSC, a script, a MIDI→OSC bridge — drives mubone the same way, and no code assumes any of them. The old example patches and their `bridge.js` relay are git history (`docs/archive/SANDBOX.md`). `proxy.js` above is the browser-mode relay this repo maintains.

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
| `/grain/prob` | `f` | Fire probability (0–1) |
| `/grain/pitchshift` | `f` | Pitch shift, cents (-2400 to +2400) |
| `/grain/oct/down` `/oct/up` | *(bang)* | Step the pitch shift by ∓1200¢ (clamped at ±2400¢) |
| `/grain/oct/reset` | *(bang)* | Return the pitch shift to 0¢ |
| `/grain/filter` | `i` / *(bang)* | The grain filter on (1) or off (0); a bang toggles |
| `/grain/filtertype` | `s` / *(bang)* | `lp` · `bp` · `hp`; a bang cycles |
| `/grain/cutoff` | `f` | Filter cutoff, Hz (20–20000) |
| `/grain/res` | `f` | Resonance at the cutoff (0–1; 0 = flat, 1 = about to ring) |
| `/grain/filterjitter` | `f` | Per-grain cutoff jitter (0–1 = ±1 octave) |
| `/grain/dir` | *(bang)* | Cycle grain playback direction |
| `/grain/curve` | *(bang)* | Cycle grain envelope curve |
| `/grain/link` | `i` / *(bang)* | The sheet's link — duration and period move together (1 on, 0 off, bang toggles) |

**Grain tab** — the MODE switches and the rows under walk (2026-09-24: every control on the screen has an address)

| Address | Args | Description |
|---|---|---|
| `/audition` | `i` / *(bang)* | Audition — every setting live on paint; one flag for tape and grain (1 on, 0 off, bang toggles) |
| `/grain/autopin` | `i` / *(bang)* | A grain stroke pins itself as a cloud on release |
| `/grain/walk` | `i` / *(bang)* | A touch walks the stroke instead of reading what is in reach |
| `/grain/dwell` | `s` / *(bang)* | Under walk: `oneshot` · `loop`; a bang toggles |
| `/grain/retrig` | `s` / *(bang)* | Under walk: `cut` · `layer`; a bang toggles |
| `/grain/flow` | `f` | Ms between deposited marks (10–200) |
| `/grain/head` | `f` | Deposit width, degrees (0–30) |
| `/grain/voice` | `i` / *(bang)* | Take a grain voice by its row number on the tab; 127 or a bang = next |
| `/grain/voice/next` `/prev` | *(bang)* | The next / previous grain voice, wrapping |

**Tape tab** — the MODE switches, the cursor behaviour rows, the voice sheet

| Address | Args | Description |
|---|---|---|
| `/tape/autopin` | `i` / *(bang)* | A tape stroke pins itself as a loop on release |
| `/tape/overdub` | `i` / *(bang)* | A take records into the nearest pinned loop as a layer |
| `/tape/slice` | `i` / *(bang)* | Slice — a take is cut into separate triggers at each attack; affects the next take (was `/trigger/chop`) |
| `/tape/dwell` | `s` / *(bang)* | `oneshot` · `loop` · `grain`; a bang cycles |
| `/tape/retrig` | `s` / *(bang)* | `cut` · `layer`; a bang toggles |
| `/tape/voice` | `i` / *(bang)* | Take a tape voice by its row number on the tab; 127 or a bang = next |
| `/tape/voice/next` `/prev` | *(bang)* | The next / previous tape voice, wrapping |
| `/tape/speed` | `f` | Varispeed (0.25–4); a sounding loop follows |
| `/tape/pitch` | `f` | Pitch, cents (−2400 to +2400); lands at the next fire |
| `/tape/step` | `s` / *(bang)* | `free` · `semi` · `oct5`; a bang cycles |
| `/tape/reverse` | `i` / *(bang)* | The take plays backwards; lands at the next fire |
| `/tape/volume` | `f` | The tape voice's level (0–1) |

**Erase tab**

| Address | Args | Description |
|---|---|---|
| `/erase/bystroke` | `i` / *(bang)* | The eraser takes whole strokes |
| `/erase/from` | `s` / *(bang)* | `top` · `bottom` — which layer depth reaches first; a bang toggles |

**Search**

| Address | Args | Description |
|---|---|---|
| `/search/radius` | `f` | Search radius, degrees |
| `/search/radius/inc` `/dec` | *(bang)* | Step radius up / down |
| `/search/k` | `i` | Pool size — how many marks the cursor spreads over, 0 = all, up to 100 |
| `/search/recency` | `i` | Depth: 1, 2 or 3 newest strokes, 0 = all |
| `/search/scope` | *(bang)* | Toggle the cursor's mode between area and nearest |
| `/cursor/reads` | `s` / *(bang)* | What the cursor reads — `both` · `grains` · `tape`; a bang cycles |
| | | The cap is `/palette/1`, the lens tile's own toggle (`/cursor/scan` went on 2026-09-24) |
| `/search/order` | *(bang)* | Toggle k ordering |

**Pins** (clouds and loops — `/commit/*` is the wire name of the older rows; pin and unpin are `/palette/3` and `/palette/4`, the strip's own positions)

| Address | Args | Description |
|---|---|---|
| `/commit/clear` | *(bang)* | Unpin all |
| `/pins/mute` | `i` / *(bang)* | Mute all — 1 mutes, 0 lets back, bang flips; per-pin mutes and solos survive |
| `/pins/sel/mute` `/sel/solo` | `i` / *(bang)* | The selected pin's M and S — the track the sort puts first |
| `/pins/sel/level` | `f` | The selected pin's fader position (0–1, unity at ⅔, +12 dB at 1); inert under follow |
| `/pins/clouds/mute` `/clouds/solo` `/loops/mute` `/loops/solo` | `i` / *(bang)* | The two buses' M and S |
| `/pins/follow` | *(bang)* / `s` | Follow: the faders follow the cursor. Bang toggles, `on` / `off` sets |
| `/commit/xfade` | `f` | Snap/fade crossfade time (0–1) |
| `/commit/attack` | `f` | Commit attack, s (0–10) |
| `/commit/release_time` | `f` | Commit release, s (0–10) |
| `/commit/loop_fade_time` | `f` | Loop fade time, ms (0–2000) |
| `/commit/loop_release` | *(bang)* | Cycle loop release mode |
| `/commit/slots` | `i` | Slot count (1–16) |
| `/commit/overflow` | *(bang)* | Cycle overflow behaviour |
| `/commit/selection` | *(bang)* / `s` | The rail's sort, which is the selected pin: `nearest` · `farthest` · `oldest`; a bang cycles |
| `/commit/dir` | *(bang)* | Cycle commit direction |

**Camera & spatial**

| Address | Args | Description |
|---|---|---|
| `/spatial/mode` | *(bang)* | Legacy compound — flips both camera + panning between "sim" and "physical" presets |
| `/spatial/lock` | `i` / *(bang)* | Cursor lock — holds azimuth + elevation together (1 lock, 0 release, bang toggles; ⌥ is the same toggle) |
| `/camera` | `s` / *(bang)* | The camera menu — `steer` · `surface` · `sensor`; a bang cycles (sensor is refused with none connected) |

**Palette** — the fixed strip: the lens (position 1), the hand's two tiles, then erase · pin · unpin (positions 2–4)

| Address | Args | Description |
|---|---|---|
| `/palette/1` … `/palette/4` | *(bang)* or `i` | Fire palette position N — **and how it fires is the TILE's, not the message's**. A tile carries one verb, set by right-click: a **momentary** tile takes `1` and `0` and plays between them; a **toggle** or a **bang** tile takes a bang, and an explicit `0` does nothing (it reads as a release edge). The strip is fixed: 1 lens · 2 erase · 3 pin · 4 unpin; `/palette/5` … `/9` went with the fixed strip (2026-09-24). The `/hold` and `/toggle` pair each position used to carry went with the three-verb position (2026-09-11) |
| `/palette/wet` | `i` | Wet paint for the grain brush the drawer is open on (1 = wet, 0 = dry, bang = toggle) |

**Cursor & transport**

| Address | Args | Description |
|---|---|---|
| `/rail/tools` `/rail/pins` | `i` / *(bang)* | Show or hide the tool rail / the pinned rail |
| `/settings` | `i` / *(bang)* | Open or close Settings |
| `/input/gain` | `f` | The footer's in fader, dB (−24 to +24) |
| `/scan/fade` | `f` | The cap's fade time constant, ms |
| `/cursor/tare` | *(bang)* | Zero the cursor — the sensor's heading in sensor mode; the camera back to the front in steer / surface |
| `/cursor/az_source` `/el_source` | *(bang)* = cycle, `sensor`\|`locked`\|`mapped` = set | Who drives azimuth / elevation — the sensor, frozen at the held value, or a cursor mapping row |
| `/cursor/radiusfade` | *(bang)* | Toggle radius fade |
| `/cursor/radiusfadecurve` | `f` | Radius fade curve (0–1) |
| `/mute` | *(bang)* | Master mute toggle |
| `/mute/hold` | `i` | Momentary mute (1 = mute, 0 = restore the pre-press state) |
| `/dry/mute` | *(bang)* | Dry monitor mute toggle — off is the mute; unmuting returns to the mode it left, on or auto |
| `/dry/mute/hold` | `i` | Momentary dry monitor mute (1 = off, 0 = restore the mode at the press) |
| `/source/live` | *(bang)* | The brush inks from the live input channel |
| `/source/sampler` | *(bang)* | The brush inks from the sampler's current sample — refused while the sampler is parked (Settings › Tools, off by default) |
| `/sampler/sample` | `i` | Set the sampler's current sample (1–10 = slot, anything else = next loaded) |
| `/sampler/record` | `i` | Capture live input into the next free sampler slot (1 = start, 0 = stop) |
| `/sweep` | *(bang)* | Session sweep |
| `/undo` | *(bang)* | Undo the last action — a stroke, a pin, an unpin, an erase |
| `/redo` | *(bang)* | Redo the last undone action |
| `/handsfree` | *(bang)* | Toggle handsfree mode |
| `/session/erase` | *(bang)* | Erase all |

**Audio levels**

| Address | Args | Description |
|---|---|---|
| `/master/volume` | `f` | Output gain, dB (-60 to +18) |
| `/monitor/volume` | `f` | Cursor → house send level (0–1) |
| `/house/volume` | `f` | Seed bus master (0–2) |
| `/mixdown/cursor` | `f` | Headphone mixdown cursor gain (0–1) |
| `/mixdown/house` | `f` | Headphone mixdown house gain (0–1) |
| `/dry/gain` | `f` | Spatialized live-input gain in house mix (0–2) |
| `/gate/threshold` | `f` | Paint gate threshold, 0–1. Gates whether particles are PAINTED — it does not attenuate audio. Compared against `max(rms, 0.7·peak)`, not plain RMS |

**Mapping module — external inputs**

| Address | Args | Description |
|---|---|---|
| `/mapping1` `/mapping2` `/mapping3` | `f` | Generic OSC inputs that appear as axes in the mapping modal — any peer can drive these |

> Source of truth: the dispatch `switch` in `js/osc.js`. If an address isn't in there, it isn't handled — no `/seed/*`, no `/grain/duration`, no `/grain/radius`, no `/space/cursor`, no `/space/*`.

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
  GROUP-SHOW-NOISE-GLITCH.md — known noise/glitch issues from group shows
  TARE-RECENTER-ZERO.md — sensor calibration reference
  mubone-architecture-notes.md — multi-channel audio architecture

  archive/              — completed plans and audits (historical reference)

css/
  style.css

js/
  state.js              — constants, the default grain block, shared state object (S)
  main.js               — app entry point, wires up all modules

  audio.js              — AudioContext, mic recording, speaker buses
  audio-features.js     — real-time audio analysis (RMS, centroid, ZCR)
  onsets.js             — noise-floor-adaptive onset detection, for the slice tool
  latency.js            — the time between a sound and its sample, and back
  sampler.js            — the sample instrument, an INPUT rather than a brush
  live-loop.js          — main-thread handle for the live-loop worklet

  grain.js              — grain scheduling, spatial search, candidate posting
  grain-worklet-bridge.js — main-thread ↔ worklet communication layer
  paint-ticker.js       — velocity-adaptive particle deposition (up to 400Hz)
  brush.js              — the brush decides the material
  brush-voicing.js      — a stroke freezes the brush that painted it
  erase.js              — the erase brush
  trigger.js            — the trigger tool: a view onto a stroke, gated by proximity
  tape-pitch.js         — the tape's baked pitch: an offline phase vocoder (js/workers/) and the step quantiser
  walker.js             — the stroke walker: the lens's `stroke` mode, a reading cursor that retraces a grain stroke
  seed-morph.js         — seed agitate/smooth morphing, driven by an inertial stream
  scale.js              — control shaping for continuous controllers

  pins.js               — pin groups (clouds / loops), derived from kind; mute + solo
  composer.js           — the pin mute engine (misnamed; the composer gate is gone)
  history.js            — ONE action stack: undo is the last thing the performer did
  param-registry.js     — the sparse parameter registry a session's patch applies through
  piece.js              — the document: save, save as, open; a piece is the music
  mubone-file.js        — the .mubone container: a zip of manifest + float32 audio members
  take.js               — a take: samples in ONE SharedArrayBuffer, read by both threads
  storage-registry.js   — the one authoritative map of persisted keys → category

  sphere.js             — 3D math, quaternion ops, projection
  renderer.js           — canvas animation loop, particle/pin/cursor drawing
  events.js             — mouse, keyboard, drag-drop handlers
  diag.js               — rolling diagnostic event log (dlog)
  handsfree.js          — auto-recording gate engine
  mobile.js             — the hosted demo in a phone's browser: gyro, touch, hidden chrome

  tiles.js              — the palette and the toolbox; a tile is the preset
  tile-layout.js        — the one screen: chrome, sphere, rails, palette, footer

  sensor-registry.js    — sensor slot registry (cursor, frame, gesture roles)
  sensor-mapping.js     — sensor → parameter mapping engine
  imu-setup.js          — direct x-imu3 connection (WiFi/USB)
  ximu-settings.js      — the x-imu3's own device settings
  ximu-led-feedback.js  — x-imu3 onboard LED feedback
  sygaldry.js           — talk to a first-party mubone instrument
  sygaldry-osc.js       — OSC and SLIP codecs for sygaldry instruments
  sygaldry-led.js       — a palette colour as duty on the instrument's LED
  accessory-registry.js — the x-IMU3-SA-A8's 8 analogue channels → the ACTIONS table

  osc.js                — OSC message dispatch (inbound)
  osc-out.js            — OSC message dispatch (outbound)
  midi.js               — MIDI input, CC mapping, and the ONE action table
  midi-out.js           — MIDI output
  status-publisher.js   — status broadcast channel for secondary windows

  ui-settings.js        — the one settings door (#settingsModal)
  ui-presets.js         — grain controls, pin banks, radius viz
  ui-pins.js            — the pinned rail
  ui-pin-settings.js    — Settings → Pins, and the monitor/house split
  ui-source.js          — the source tiles (live input, samples)
  ui-samples.js         — sample loading, waveform display, crop
  ui-audio-settings.js  — audio device/gain/routing settings
  ui-meters.js          — VU metering, mixdown controls
  ui-viz.js             — visualization settings
  ui-sweep.js           — particle sweep tool
  ui-trigger.js         — the trigger tool's controls
  ui-buttons.js         — Settings → Instrument buttons
  ui-learn.js           — learning mode tooltips
  ui-export.js          — the RIG as one JSON file: setup export/import
  ui-diagnostics.js     — measurements you run, and verdicts you read
  ui-imu-setup.js       — x-imu3 connection UI
  ui-sensor-mapping.js  — sensor mapping UI (axis map, calibration)
  ui-led-map.js         — the x-IMU3 LED mapping modal
  ui-sygaldry.js        — the sygaldry instrument's panel

proxy.js                — x-IMU3 UDP → WebSocket bridge for browser mode
```

---

## SSL certs

`serve.py` expects `localhost.pem` and `localhost-key.pem` in the project root:
```
mkcert localhost
```
