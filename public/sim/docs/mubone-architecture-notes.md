# Mubone — Audio Architecture Notes

> **Status: CURRENT** · reference · audio routing, multi-channel, VBAP, Electron bridge. Describes shipped behaviour.

> **Read this first.** Reference for the audio graph and Electron. Live and worth reading: *Implemented Architecture*, *Spatial panning: head-locked vs world-locked*, *Multi-Channel Spatial Routing*, *electronBridge API*, *Audio Settings — What Each Control Actually Does*, *Performance Tuning Constants*. *OSC integration* and *What Max is now* were rewritten 2026-09-05: two ports, any sender, Max only as Ek's prototyping patch. *Camera Rotation* predates the 2026-09-01 change where the sensor drives the cursor and the camera is derived. Read the section for your question, not the file.

## Status

The Electron multi-channel audio path is implemented and working. The browser stereo path is unchanged. Both share the same codebase with no branching in the granular engine itself.

---

## The Core Requirement

Per-grain independent spatialization is central to the instrument's paradigm. At any moment many grains may be firing simultaneously, each at a different position in space. Any architecture that collapses those grains to stereo before they reach the speakers destroys the spatial texture of the instrument.

---

## Architecture Options Evaluated

### Max jweb~
Max 9 introduced `jweb~`, which embeds Chromium inside Max with audio output. It is stereo only (L and R outlets). All per-grain spatial information is collapsed before leaving the browser. **Ruled out.**

### C++
Full native audio control but slow iteration, no browser refresh loop, heavy UI requirements. The rapid AI-assisted prototyping workflow driving this project doesn't survive a move to C++. **Not worth it.**

### Electron
Electron wraps the existing HTML/JS codebase in a native desktop shell (Chromium + Node.js). An AudioWorklet captures multi-channel buffers before stereo collapse and passes them via IPC to audify (RtAudio), which talks directly to the audio interface. Per-grain spatial positions are computed inside Web Audio where the grains live, and delivered to hardware with full channel count intact. **This is the implemented path.**

---

## Implemented Architecture

```
Mic / line input
  ├─ [Browser]  getUserMedia (N ch, device-selectable via WebRTC)
  │    └─ MediaStreamSource → inputGainNode → inputAnalyser → ScriptProcessor → recordingRaw[]
  │
  └─ [Electron] getUserMedia (WebRTC) for grain recording
       └─ MediaStreamSource → inputGainNode → inputAnalyser → ScriptProcessor → recordingRaw[]
       + RtAudio input stream (true multichannel counts, meter only)
            └─ audio host (utility process) callback → MessagePort → input-meter worklet ring (pre-rolled to the cushion)

Grain playback
  └─ BufferSource → grainGain → elevGain
       ├─ [Electron] VBAP → per-speaker GainNodes → speakerBuses[0..N-1]
       │     └─ ChannelMerger → QuadCaptureWorklet → MessagePort → audio host (queue held at the cushion) → audify → hardware
       │     └─ headphone downmix (closest L/R buses → stereo dead-end, no hardware output)
       └─ [Browser] StereoPanner → masterBus → ceiling → destination

Master chain
  masterBus → ceiling → masterAnalyser → muteGain
    → [Browser]  AudioContext.destination
    → [Electron] dead-end (audify owns hardware; Web Audio destination ignored)

Output meter (both contexts)
  speakerBuses[L] + speakerBuses[R] → meterMerger → meterTap → masterAnalyser
```

---

## Spatial panning: head-locked vs world-locked

`S.spatialPanning` is `'worldlocked'` (the factory default since 2026-09-05) or `'headlocked'`. The switch lives in `grain.js`, `audio.js`, and `grain-worklet-bridge.js` at the point where each grain's world-space position is resolved to a panning coordinate.

**Head-locked** (`'headlocked'`)
- Audio is panned relative to the current camera orientation.
- Rotating the view (mouse or sensor) rotates the sound world with you — like a first-person video game. A grain painted at the front of the sphere always sounds in front of wherever you're looking.
- Intended for headphone listening, browser demos, and stereo monitoring.
- Works for any channel count with the same view-relative behaviour.

**World-locked** (`'worldlocked'`)
- Grain positions are in world space. The VBAP azimuth is computed from the grain's fixed position relative to the room, ignoring camera orientation.
- Rotating your body (sensor) turns the visual sphere but does not pan the audio — the sounds stay anchored to physical speaker positions.
- Intended for real installations and performances where speakers are fixed in the room and the performer moves within the space.
- In Electron with the x-imu3 assigned to the cursor role, the sensor drives camera rotation AND the paint cursor position.
- In browser: world-locked mode works without a sensor (mouse-driven camera) — the panning behaviour is the same, the performer just can't "turn" into it.

**Legacy "sim / physical" shorthand.** The `/spatial/mode` OSC handler flips a compound state: "physical" = `cameraMode = 'sensor'` + `spatialPanning = 'worldlocked'`; "sim" = `cameraMode = 'steer'` (renamed from `'pull'` 2026-08-24) + `spatialPanning = 'headlocked'`. The two underlying keys (`S.cameraMode`, `S.spatialPanning`) are what code reads; `/spatial/mode` is a convenience toggle.

---

## Camera Rotation (gimbal-lock-free)

`S.camQ` is a unit quaternion `[x, y, z, w]` that orients the camera.  Three modes write it:

**Pull mode** — small absolute yaw/pitch from mouse offset.  No pole issues (small angles only).

**Surface mode** (trackpad, events.js + renderer.js) — pointer-lock deltas accumulate per frame in `S._surfaceDelta`.  The renderer consumes each frame's `{dx, dy}`, converts to small angle rotations, and applies:

    camQ = qYaw(world-Y, dx·π) × camQ × qPitch(local-X, dy·π)

Pre-multiplying yaw keeps the vertical axis world-fixed (no roll).  Post-multiplying pitch keeps it local (clean pole traversal).

**Sensor mode** (x-imu3, renderer.js + sensor-registry.js) — when roll is muted (the default for cursor sensors), the renderer computes the delta between the current and previous raw tared quaternion: `delta = prev⁻¹ × current`.  The delta's forward vector `[1,0,0]` is decomposed into `dYaw = atan2(fy, fx)` and `dPitch = asin(−fz)`, then applied with the same world-yaw × local-pitch pattern.  Frame-to-frame deltas are always small, so the decomposition is well-conditioned (no gimbal lock).  When roll is *not* muted, the full 3DOF sensor quaternion from `getSensorCamQ()` is passed through directly.

**Why not absolute Euler reconstruction?**  Decomposing a quaternion into yaw/pitch Euler angles and rebuilding from those fails at the poles: `asin` clamps pitch to ±90° (view bounces back), `atan2` for yaw becomes singular (view spins).  The incremental delta approach avoids both because it only decomposes *small* rotations.

Key files: `renderer.js` (the `animate()` camera rotation section), `events.js` (`setupEvents()` surface delta accumulation), `sensor-registry.js` (`applyAxisMapQuat`, `getSensorRawCursorQ`, `getCursorAxisSigns`).

---

## Detethered Cursor / Two-Sensor Mode

When a cursor-role and a camera-role sensor are both assigned, the cursor detethers from the viewport center. The camera sensor pans and tilts the view (like a periscope — move the projector, or turn the body wearing it, to reveal different parts of the painted sphere), while the cursor sensor controls an independent pointer that can roam anywhere, off screen included. The two are independent: turn the camera sensor with the hand still and the view moves while the cursor stays on the same spot of the sphere.

**State:** `S.cursorQ` holds the cursor orientation quaternion when detethered (null otherwise). `S.camQ` is set to identity in detethered mode — the camera sensor provides the whole view via `S.cameraSensorQ`.

**Sensor pipeline split:**

- `getSensorCamQ()` returns null when a camera-role sensor is live (nothing to write to camQ).
- `getSensorCursorQ()` returns the cursor-role world quaternion (calibration + axis map) only when a camera sensor is live.
- `getCameraQ()` returns the camera sensor's PAN and TILT — the azimuth and elevation of its forward axis, recomposed with no roll (2026-09-27: a body sensor leaning 20° sideways used to roll the view 20°).

**Critical: conjugation in `getCameraQ()`**

`cameraTransform()` in sphere.js applies an asymmetry: `camQ` is conjugated (`qRotateVec(qConjugate(camQ), p)`) but `cameraSensorQ` is applied directly. Without compensation the camera sensor exhibits gimbal lock (pitch→roll coupling at 90° yaw) while the cursor does not. `getCameraQ()` conjugates its output to cancel it. **Do not add or remove conjugation on either side without updating the other to match.**

**Natural roll-muting:** rolling the cursor sensor has no effect on cursor position — `cursorQ` is only used for its forward vector, a point on the sphere.

**Sound:** world-locked panning keeps the grains fixed in the room whatever the camera sensor does. Head-locked panning takes the camera rotation too, so turning the camera sensor turns the whole sound field — pinned clouds included — around the speakers.

**Placements** (same code): a tripod-mounted projector (a periscope onto the sphere), or the performer's body or head (the view follows where they face).

**The frame role** (removed 2026-09-27, back 2026-10-04 beside camera): a sensor the cursor is READ RELATIVE to — a body or a turntable. `readSensorPose` composes `inFrame(C, F) = conj(F)·C` of the two sphere orientations (`sensor-math.js`), the frame's whole rotation, so turning or tipping both together leaves the cursor on its spot. Everything above then applies to that relative cursor: alone, the camera follows it (`cameraFromPointing`); with a camera sensor too, the view stays the camera's. A frame silent for 2 s (`isSlotLive`) drops out and the cursor is the world one. `S.sensorFramed` says which.

Key files: `sensor-registry.js` (`getSensorCursorQ`, `getCameraQ`), `renderer.js` (camera update block, `drawCursor()`), `sphere.js` (`getCursorLonLat`, `cameraTransform`).

---

## Calibration

Mount (two poses) and heading (face the stage), applied as `conj(H) · q · conj(B)` and then three axis signs — `js/sensor-math.js` has the maths and why, `docs/TARE-RECENTER-ZERO.md` the gestures. (A section on a gravity-aligned vs full-quaternion tare lived here; it described code deleted 2026-08-01 and went 2026-09-27 — git history.)

---

## Multi-Channel Spatial Routing

Grains are routed to N output channels using 2D VBAP (Vector Base Amplitude Panning):

1. The grain's 3D camera-space position is projected to a horizontal azimuth angle (0° = front, clockwise).
2. N speakers are placed around a circle. Stereo (N=2) uses 270° left / 90° right. For N≥3 speakers are equally spaced clockwise from 0°.
3. The two adjacent speakers that bracket the grain's azimuth are found.
4. Amplitude is split between them using equal-power crossfade: `wA = cos(t × π/2)`, `wB = sin(t × π/2)`.
5. Only two GainNodes are created per grain (not N), keeping CPU cost constant regardless of channel count.

This works identically for any N: stereo (2), quad (4), octaphonic (8), Dante (48), etc.

---

## One Codebase, Two Contexts

| Context | Use | Audio output | Sensor input |
|---|---|---|---|
| Browser | Development, demos, link sharing | Stereo via Web Audio destination | Unavailable (mouse/touch fallback) |
| Electron | Live performance, installation | N-channel via audify / RtAudio | x-imu3 over WiFi (UDP announce + data), or any OSC sender → UDP 7500 → IPC |

The granular engine (`grain.js`) checks `S.speakerBuses` at render time. If present, it routes via VBAP to the speaker buses. If null, it falls through to the stereo panner path. No other code changes between contexts.

---

## OSC integration

All OSC messages — sensor data, grain parameters, transport, pins, undo — are dispatched through one `handleOSC(address, values)` in `js/osc.js`. Two transports feed it, and neither is specific to any sender (Max is Ek's prototyping patch, one sender among any):

```
Electron:  any OSC sender → UDP 127.0.0.1:7500 (binary OSC)
                └─ electron-main.js (dgram)
                     └─ IPC osc-message
                          └─ electronBridge.onOSC
                               └─ handleOSC()

Browser:   any relay → ws://localhost:8080 ({ address, values } JSON)
                          └─ browser WebSocket client (osc.js)
                               └─ handleOSC()

x-IMU3 in a browser (not OSC): UDP → proxy.js → ws://localhost:8081 raw lines
                                                   └─ ximu3.js, the same parser as Electron
```

The browser tries `ws://localhost:8080` on load and retries every 3 seconds — a no-op if no relay is running, and hosted origins never try (`_bridgeReachable()`). The `● OSC` indicator lights on the first message received on either transport.

**Sensor path:** `handleOSC` routes `/sensor/{name}/quaternion` with 4 floats through the sensor registry (`sensor-registry.js`), which auto-creates the slot on first receipt, applies tare + axis map, and dispatches to the assigned role (cursor / camera / listen / frame / gesture). This works identically in both contexts.

**Grain params:** Written directly to `S.grainOverrides`, which `grain.js` reads on each scheduler tick. OSC changes also call `scheduleUISync()` to flush updated values back to the panel sliders and controls in the next animation frame.

**Preset / mode changes:** `S._selectPreset`, `S._setCameraMode`, and `S._setSpatialPanning` are registered by the relevant UI modules and called directly from the OSC dispatcher — no CustomEvent needed.

**Commit / undo controls:** Bang-style messages on the `/commit/*` namespace (`/commit/drop`, `/commit/draw`, `/commit/release`, `/commit/clear`, etc.) route through `S._dispatchAction` in `events.js` for consistent UI feedback. `/undo` → `S._dispatchAction('undo', 127)`. Any incoming value (or no value) triggers the action.

> **Full OSC namespace:** see the expanded table in `README.md`. Source of truth is the dispatch `switch` in `js/osc.js` — any address not handled there is silently dropped, even if it appears in older docs.

---

## Audio Input: Electron vs Browser

**Both contexts** use `getUserMedia` for grain recording (ScriptProcessor → recordingRaw[]). The browser caps channel counts at whatever WebRTC negotiates with the OS.

**Electron only** additionally opens a separate RtAudio input stream (`createInputStream` in `electron-main.js`) to get true multichannel input counts. The RtAudio input callback posts each chunk of raw interleaved Float32 PCM straight to the input-meter worklet over a MessagePort (since 2026-09-06 — the renderer's main thread is not in either audio hop; `docs/RULINGS.md` "the two IPC hops are bounded"), feeding the multichannel input meter strip and the recording path. The device list in Audio Settings (input side) in Electron comes from `get-input-devices` (RtAudio) rather than `MediaDevices.enumerateDevices()`, so reported channel counts are accurate.

---

## Stereo Headphone Downmix (Electron)

When speaker buses are active, `audio.js` also wires a stereo headphone downmix: it finds the bus closest to 270° (left) and closest to 90° (right) and merges them into a stereo GainNode. In Electron this node is a dead-end (not connected to `AudioContext.destination`) because `destination` always routes to the OS default device regardless of the selected interface. The node exists so the output gain slider has something to control. In the browser the same node is connected to `destination` normally.

---

## Key Files

| File | Role |
|---|---|
| `electron-main.js` | Electron main process. Spawns and relays to the audio host, lists audio devices on its own RtAudio enumerator, receives x-imu3 OSC over UDP and pushes to renderer via IPC. |
| `audio-host.js` | The audio host — a utility process with nothing on its loop but audify: the output stream and its regulation to the cushion, the input stream, both audio ports. Since 2026-09-06 (R2). |
| `electron-loop-probe.js` | Shared by main and the host: event-loop gap counts, timed handlers, GC pauses — what `wg.status()` prints per loop. |
| `electron-preload.js` | IPC bridge. Exposes `window.electronBridge` to renderer (see API table below). |
| `js/audio.js` | `ensureAudioContext` (48000 Hz default), `initSpeakerBuses(N)` (builds N-channel Web Audio graph + headphone downmix + meter tap), `recreateAudioContext` (sample rate change), `rewireChannelMerger` (apply `S.channelRouting` without full rebuild). |
| `js/grain.js` | `playGrain` — VBAP routing when `S.speakerBuses` is set, stereo panner fallback otherwise. |
| `js/osc.js` | `initOSC()` selects transport (Electron IPC or browser WebSocket). `handleOSC(address, values)` dispatches all incoming OSC to sensor, grain params, preset, etc. |
| `js/sensor-registry.js` | Sensor SLOTS: calibration and role per slot name (persisted in `mubone_sensor_cal`), and `readSensorPose()` — the cursor and camera quaternions the renderer reads — and `readListenerPoses()`, where each `listen` sensor points, for the grain scheduler. Its header maps the three layers (link → sensor → slot). The maths is `js/sensor-math.js`, pure; the connected sensors are `js/sensors.js`; the x-imu3 link is `js/ximu3.js`. |
| `js/sphere.js` | 3D math — `getCursorLonLat()`, `screenToLonLat()`, `cameraTransform()`, `qRotateVec`, quaternion helpers. |
| `proxy.js` | The x-IMU3's UDP for a browser (`node proxy.js`): discovery, commands and raw data lines on ws 8081, parsed by `ximu3.js`. Not an OSC relay since 2026-09-27. |
| `js/worklets/quad-capture.worklet.js` | Batches N-channel audio into an interleaved Float32Array and posts it straight to the main process over the port transferred in (`{ type: 'port' }`). N and batchSize configured at runtime via `{ type: 'init', numChannels: N, batchSize: B }`. batchSize = bufferFrames / 128 so each post is exactly one audify write. |
| `js/ui-audio-settings.js` | Input device picker (WebRTC in browser; RtAudio device list in Electron). Output device picker (Electron only). Channel routing dropdowns. Speaker sweep. Sample rate and buffer size controls. |

---

## electronBridge API

`window.electronBridge` is exposed by `electron-preload.js` via `contextBridge`. It is `undefined` in the browser.

| Method | Direction | Description |
|---|---|---|
| `isElectron` | — | `true` — use this to detect Electron at runtime |
| `openAudioPort(kind)` | renderer → main | Make a MessagePort pair for one audio hop (`'out'` or `'in'`): one end to main, the other to the main world over `window.postMessage`, which audio.js transfers into the worklet |
| `setAudioCushion(ms)` | renderer → main | The stall cushion — the depth main primes the output queue to |
| `getOutputDepth()` | renderer → main | The output queue's depth, its prime depth, and its dry / dropped counts |
| `getAudioDevices()` | renderer → main | Returns list of output devices with `id`, `name`, `outputChannels`, `isDefault`, `quadCapable` |
| `setAudioDevice(id, nCh, bufFrames)` | renderer → main | Open RtAudio output stream; returns `{ ok, streaming, sampleRate }` |
| `getInputDevices()` | renderer → main | Returns list of input devices with `id`, `name`, `inputChannels`, `isDefault` (from RtAudio, not WebRTC) |
| `setInputDevice(id, nCh, bufFrames)` | renderer → main | Open RtAudio input stream; returns `{ ok, nCh, sampleRate, name }` |
| `onOSC(cb)` | main → renderer | Register callback `cb(address: string, values: any[])` for all OSC messages. Called by `osc.js` which dispatches to sensor, grain params, etc. |
| `toggleFullscreen()` | renderer → main | Toggle native OS fullscreen (web `requestFullscreen()` doesn't work in BrowserWindow) |

---

## Audio Settings — What Each Control Actually Does

**Input device** — calls `getUserMedia({ deviceId: exact, channelCount: ideal 32 })` for grain recording. In Electron also calls `set-input-device` to open a parallel RtAudio input stream for true multichannel metering. Browser caps channel count at device maximum; Electron uses RtAudio channel counts directly.

**Output device** (Electron only) — calls `initSpeakerBuses(N)` to rebuild the Web Audio N-channel graph, then `setAudioDevice(id, N, bufferFrames)` via IPC to open the audify stream. System default device is pre-selected and listed first.

**Sample rate** — stored in `S.preferredSampleRate`, read by `ensureAudioContext()`. Changing it after startup calls `recreateAudioContext(newRate)` which closes the AudioContext, tears down all dependent nodes, and recreates. In Electron also reopens the audify stream. A confirmation dialog warns that active recordings will be lost.

**Buffer size** — passed as `bufferFrames` to `createOutputStream()` in the main process and used directly in `rtAudio.openStream()`. Also controls the worklet's `batchSize` (`bufferFrames / 128`). In the browser it's informational only (Web Audio manages its own internal buffer).

**Sample rate negotiation** — audify tries rates in order `[preferred, 48000, 44100]` (deduped). If a device rejects a rate, the error is caught and the next rate is tried silently. The negotiated rate is returned to the renderer and shown in the output status strip. A ⚠ warning appears if the audify rate differs from the AudioContext rate.

**Speaker sweep** — fires a 600ms white noise burst through each speaker bus in sequence with 40ms fades, logging the angle of each speaker in the status strip. In browser stereo mode, sweeps left → centre → right. Clicking the button again during a sweep stops it.

**Channel routing** — per-bus dropdowns map spatial bus index (angle) to physical output channel. The mapping is stored in `S.channelRouting` and applied by `rewireChannelMerger()` without tearing down the whole graph.

---

## Performance Tuning Constants

All system-wide performance knobs are exported from `js/state.js`. They were set conservatively during early CPU-load testing and are designed to be the single place you touch when tuning for different machines or use contexts.

| Constant | Default | Where used | Notes |
|---|---|---|---|
| `GRAIN_SCHEDULER_INTERVAL_MS` | `20` | `main.js` `setInterval` | Tick rate for the grain scheduler. Decoupled from the render loop so dropped frames don't delay grain onsets. At 20ms the scheduling jitter is inaudible; the worklet does the sample-accurate timing. |
| `SCHED_SAFE_PERIOD_S` | `0.00005` (50 µs) | `state.js` — UI slider floor + onset-clock minimum | UI slider floor and onset-clock advancement minimum. With the AudioWorklet grain engine on the audio thread there's no main-thread crash risk at sub-ms periods. |
| `RENDER_TARGET_FPS` | `30` | `renderer.js` `animate()` | Canvas redraw cap. `requestAnimationFrame` still runs at display rate to keep painting and camera responsive; only `drawFrame()` is throttled. Lowering to 20 meaningfully reduces draw cost on scenes with many particles. |
| `LIVE_REBUILD_INTERVAL_MS` | `50` | `audio.js` | How often the main-thread `AudioBuffer` snapshot is refreshed from the recording ring for candidate offset resolution and UI. The worklet has the real-time data via its `process()` input; this only affects staleness in candidate posts. |

**CPU load profile:** The grain engine runs entirely in the AudioWorklet (`grain-engine.worklet.js`) on the audio thread. The main-thread scheduler (`grain.js`) only does spatial search and posts candidate lists via `postMessage` at ~33Hz — cheap. The canvas renderer is the main CPU consumer and scales with particle count and canvas resolution. `RENDER_TARGET_FPS` is the primary lever there.

**Previous `MAX_GRAIN_NODES` constant:** removed during the worklet migration. Concurrency is now budgeted inside the worklet's grain pool, not by a main-thread cap.

---

## Sample Rate History

The AudioContext was originally created at 22050 Hz to halve CPU load. This caused hardware negotiation failures (Core Audio rejects 22050 on MacBook built-in) and pitch/timing mismatches with audify. The default is now 48000 Hz in all contexts (matches Chrome's default and most USB interfaces). 44100 Hz and 22050 Hz are still selectable in Audio Settings.

---

## What Max is now

A prototyping tool. Ek uses a Max patch to test custom OSC mappings and to try a control before it has a real home. It is not part of the app, not a setup step, and no code assumes it (Ek, 2026-09-05). The x-imu3 reaches Electron directly over WiFi — UDP announcements on 10000, data on the device's send port — not through Max. The old `main.maxpat`, `x-imu3.maxpat` and `bridge.js` are git history (`docs/archive/SANDBOX.md`).
