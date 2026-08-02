# Mubone — Audio Architecture Notes

> **Status: CURRENT** · reference · audio routing, multi-channel, VBAP, Electron bridge. Describes shipped behaviour.

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
            └─ main process callback → IPC audio-input-buffer → renderer input meter

Grain playback
  └─ BufferSource → grainGain → elevGain
       ├─ [Electron] VBAP → per-speaker GainNodes → speakerBuses[0..N-1]
       │     └─ ChannelMerger → QuadCaptureWorklet → IPC audio-buffer → audify → hardware
       │     └─ headphone downmix (closest L/R buses → stereo dead-end, no hardware output)
       └─ [Browser] StereoPanner → masterBus → softClipper → destination

Master chain
  masterBus → softClipper → masterAnalyser → muteGain
    → [Browser]  AudioContext.destination
    → [Electron] dead-end (audify owns hardware; Web Audio destination ignored)

Output meter (both contexts)
  speakerBuses[L] + speakerBuses[R] → meterMerger → meterTap → masterAnalyser
```

---

## Spatial panning: head-locked vs world-locked

`S.spatialPanning` is `'headlocked'` (default) or `'worldlocked'`. The switch lives in `grain.js`, `audio.js`, and `grain-worklet-bridge.js` at the point where each grain's world-space position is resolved to a panning coordinate.

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

**Legacy "sim / physical" shorthand.** The `/spatial/mode` OSC handler flips a compound state: "physical" = `cameraMode = 'sensor'` + `spatialPanning = 'worldlocked'`; "sim" = `cameraMode = 'pull'` + `spatialPanning = 'headlocked'`. The two underlying keys (`S.cameraMode`, `S.spatialPanning`) are what code reads; `/spatial/mode` is a convenience toggle.

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

## Detethered Cursor / Two-IMU Mode

When both a cursor-role and frame-role sensor are assigned, the cursor detethers from the viewport center. The frame IMU provides the viewport orientation (like a periscope — move the projector/frame to reveal different parts of the painted sphere), while the cursor IMU controls an independent pointer that can roam freely across the visible surface.

**State:** `S.cursorQ` holds the cursor orientation quaternion when detethered (null otherwise). `S.detethered` is a derived getter checking `cursorQ !== null`. `S.camQ` is set to identity in detethered mode — the frame provides all viewport orientation via `S.frameQ`.

**Sensor pipeline split:**

- `getSensorCamQ()` returns null when frame-role is active (nothing to write to camQ).
- `getSensorCursorQ()` returns the cursor-role quaternion (tare + axis map + custom layers) only when frame-role is also active.
- `getFrameQ()` returns the frame-role quaternion with the same pipeline (tare + axis map).

Both cursor and frame go through the exact same `applyAxisMapQuat()` pipeline. There is no special treatment for either sensor — they differ only in which state variable they write to.

**Critical: conjugation in `getFrameQ()`**

`cameraTransform()` in sphere.js applies an asymmetry: `camQ` is conjugated (`qRotateVec(qConjugate(camQ), p)`) but `frameQ` is applied directly (`qRotateVec(frameQ, p)`). Without compensation, this causes the frame sensor to exhibit gimbal lock (pitch→roll coupling at 90° yaw) while the cursor does not.

The fix: `getFrameQ()` conjugates its output (`return [-q[0], -q[1], -q[2], q[3]]`) before returning. This pre-conjugation cancels the asymmetry in `cameraTransform()`, making both sensors produce identical visual behavior.

**Do not add or remove conjugation on either side without updating the other to match.** See the inline comments in `getFrameQ()` and `cameraTransform()`.

**Natural roll-muting:** In detethered mode, physically rolling the cursor IMU has no effect on cursor position. This is because `cursorQ` is only used for forward-vector projection (`qRotateVec(cursorQ, [0,0,1])`) to get lon/lat — a point on the sphere. Roll rotates the forward vector around its own axis, which doesn't change its direction. This is a stable mathematical property, not an explicit mute, and it applies regardless of axis mapping or tare state.

**Three spatial anchoring modes** (same code, different physical placement of the frame IMU):

- **Room-anchored (projector):** Frame on a tripod-mounted pico projector. Moving the projector reveals different parts of the painted sphere, like a periscope.
- **Room-anchored (floor):** Frame stationary. Sphere is locked to the room.
- **Body-anchored:** Frame on the performer's body. Everything painted "in front" stays in front regardless of where the performer physically moves or faces.

Key files: `sensor-registry.js` (`getSensorCursorQ`, `getFrameQ`), `renderer.js` (camera update block, `drawCursor()`), `sphere.js` (`getCursorLonLat`, `cameraTransform`).

---

## Tare Strategy: Gravity-Aligned vs Full-Quaternion

> **⚠ HISTORICAL as of 2026-08-01 — this describes code that no longer exists.**
> `slotTare()` / `slotClearTare()` / `_isFlatMount()` were removed from
> `sensor-registry.js`. They had no caller, and could not have worked if they
> had: `setFeeding()` in `imu-setup.js` nulls `quatCal.tareQuat` and
> `tareRollOffset` on every connect, because imu-setup owns calibration and the
> registry is meant to pass data through.
>
> **The tare that actually runs is `captureTare()` in `imu-setup.js`** — an
> Euler-space tare storing `{ pitch, yaw }` on the *device*, called by the
> `tare sensor` button, the `tare cursor` button, the `` ` `` key and the `tare`
> action. See `docs/TARE-RECENTER-ZERO.md`.
>
> `applyTare()` and the `tareQuat` reads remain (inert on null, and `tareQuat`
> is still in the persisted calibration schema — don't drop it from there). The
> two strategies below are kept as the design record: if a quaternion tare is
> ever wanted again, it belongs beside `captureTare`, not in the registry.

`slotTare()` auto-selected between two tare strategies based on the axis map. The axis map is the signal — it implicitly encodes the physical mounting orientation.

**Gravity-aligned tare** (flat mount — default axis map, X = roll/forward):

Captures only the heading (yaw around world-Z / gravity axis). After tare, the quaternion retains static pitch and roll from the physical mounting angle. The `tareRollOffset` compensates for the X-roll component so the Euler decomposition doesn't couple pitch and yaw through a tilted roll axis. This preserves the gravity reference: pitch=0 always means level with the horizon.

**Full-quaternion tare** (non-flat mount — forward axis is Y or Z):

Captures the entire raw orientation. `applyTare` left-multiplies by the conjugate, zeroing out the full mounting rotation. After tare the quaternion is near-identity at rest, so the ZYX Euler decomposition produces small, clean angles that the axis remap handles correctly regardless of physical mounting angle. The gravity reference is sacrificed — "level" is wherever the IMU was at tare time — but for non-flat mounts that's what you want since the whole reference frame is being redefined.

**Detection logic:** `_isFlatMount(cal)` checks whether X is mapped to roll (the default). If so → gravity-aligned. If the user remapped Y or Z to roll (indicating a non-standard mounting) → full-quaternion. Set the axis map *before* taring.

**Detethered mode interaction:** In two-IMU mode, roll is naturally muted on the cursor (forward-vector projection ignores roll), so the gravity-aligned tare's roll handling has no effect on the cursor. Full-quat tare works fine for either sensor in detethered mode.

Key file: `imu-setup.js` (`captureTare`, `resetHeading`, `clearTare`) for the tare that runs; `sensor-registry.js` (`applyTare`) for the still-live application step.

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
| Electron | Live performance, installation | N-channel via audify / RtAudio | x-imu3 via Max OSC → UDP → IPC |

The granular engine (`grain.js`) checks `S.speakerBuses` at render time. If present, it routes via VBAP to the speaker buses. If null, it falls through to the stereo panner path. No other code changes between contexts.

---

## OSC / Max Integration

All OSC messages — sensor data, grain parameters, preset selection, transport and seed controls — are dispatched through a single `handleOSC(address, values)` function in `js/osc.js`. Two transports feed it:

```
Electron:  Max → [node.script bridge.js]  (setmode electron)
                    └─ encodeOSC() → UDP 127.0.0.1:7500
                         └─ electron-main.js (dgram)
                              └─ IPC osc-message
                                   └─ electronBridge.onOSC
                                        └─ handleOSC()

Browser:   Max → [node.script bridge.js]  (setmode browser)
                    └─ WebSocket server ws://localhost:8080
                         └─ browser WebSocket client (osc.js)
                              └─ handleOSC()
```

`bridge.js` (in `max/`) runs via `[node.script bridge.js]` inside the Max patch **in both modes** — it is never bypassed. Sending `setmode electron` or `setmode browser` to the node.script switches its output transport at runtime. In Electron mode it encodes messages as OSC binary and fires them over UDP; in browser mode it broadcasts JSON over WebSocket. The Max patch has a toggle that sends this message automatically.

The browser tries `ws://localhost:8080` on load and retries every 3 seconds — graceful no-op if Max isn't running. A `● MAX` indicator appears in the UI top-right corner on first message received (either transport).

**Sensor path:** `handleOSC` routes `/sensor/{name}/quaternion` with 4 floats through the sensor registry (`sensor-registry.js`), which auto-creates the slot on first receipt, applies tare + axis map, and dispatches to the assigned role (cursor / frame / gesture). This works identically in both contexts.

**Grain params:** Written directly to `S.grainOverrides`, which `grain.js` reads on each scheduler tick. OSC changes also call `scheduleUISync()` to flush updated values back to the panel sliders and controls in the next animation frame.

**Preset / mode changes:** `S._selectPreset`, `S._setCameraMode`, and `S._setSpatialPanning` are registered by the relevant UI modules and called directly from the OSC dispatcher — no CustomEvent needed.

**Commit / undo controls:** Bang-style messages on the `/commit/*` namespace (`/commit/drop`, `/commit/draw`, `/commit/release`, `/commit/clear`, etc.) route through `S._dispatchAction` in `events.js` for consistent UI feedback. `/undo` → `S._dispatchAction('undo', 127)`. Any incoming value (or no value) triggers the action.

> **Full OSC namespace:** see the expanded table in `README.md`. Source of truth is the dispatch `switch` in `js/osc.js` — any address not handled there is silently dropped, even if it appears in older docs.

---

## Audio Input: Electron vs Browser

**Both contexts** use `getUserMedia` for grain recording (ScriptProcessor → recordingRaw[]). The browser caps channel counts at whatever WebRTC negotiates with the OS.

**Electron only** additionally opens a separate RtAudio input stream (`createInputStream` in `electron-main.js`) to get true multichannel input counts. The RtAudio input callback sends raw interleaved Float32 PCM to the renderer via IPC (`audio-input-buffer`), feeding the multichannel input meter strip. The device list in Audio Settings (input side) in Electron comes from `get-input-devices` (RtAudio) rather than `MediaDevices.enumerateDevices()`, so reported channel counts are accurate.

---

## Stereo Headphone Downmix (Electron)

When speaker buses are active, `audio.js` also wires a stereo headphone downmix: it finds the bus closest to 270° (left) and closest to 90° (right) and merges them into a stereo GainNode. In Electron this node is a dead-end (not connected to `AudioContext.destination`) because `destination` always routes to the OS default device regardless of the selected interface. The node exists so the output gain slider has something to control. In the browser the same node is connected to `destination` normally.

---

## Key Files

| File | Role |
|---|---|
| `electron-main.js` | Electron main process. Manages audify output stream (device selection, channel count, buffer size, sample rate negotiation) and a separate RtAudio input stream. Receives x-imu3 OSC over UDP and pushes to renderer via IPC. |
| `electron-preload.js` | IPC bridge. Exposes `window.electronBridge` to renderer (see API table below). |
| `js/audio.js` | `ensureAudioContext` (48000 Hz default), `initSpeakerBuses(N)` (builds N-channel Web Audio graph + headphone downmix + meter tap), `recreateAudioContext` (sample rate change), `rewireChannelMerger` (apply `S.channelRouting` without full rebuild). |
| `js/grain.js` | `playGrain` — VBAP routing when `S.speakerBuses` is set, stereo panner fallback otherwise. |
| `js/osc.js` | `initOSC()` selects transport (Electron IPC or browser WebSocket). `handleOSC(address, values)` dispatches all incoming OSC to sensor, grain params, preset, etc. |
| `js/sensor-registry.js` | Sensor slot registry. `/sensor/{name}/{type}` OSC messages register slots on first receipt, track per-sensor calibration (tare, axis map, flat-mount detection), and dispatch to role consumers (cursor, frame, gesture). Exposes `getByRole()`, `applyAxisMapQuat()`, `getSensorCursorQ()`, `getFrameQ()`. Tare itself lives in `imu-setup.js`, not here. |
| `js/sphere.js` | 3D math — `getCursorLonLat()`, `screenToLonLat()`, `cameraTransform()`, `qRotateVec`, quaternion helpers. |
| `max/bridge.js` | Node for Max script. Runs via `[node.script bridge.js]` in both modes. In browser mode: starts a WebSocket server on `ws://localhost:8080` and broadcasts all incoming messages to connected tabs. In Electron mode: encodes messages as OSC binary and sends UDP to `127.0.0.1:7500`. Send `setmode browser` or `setmode electron` to switch transport at runtime. |
| `js/worklets/quad-capture.worklet.js` | Batches N-channel audio into interleaved Float32Array and posts to main thread. N and batchSize configured at runtime via `{ type: 'init', numChannels: N, batchSize: B }`. batchSize = bufferFrames / 128 so each post is exactly one audify write. |
| `js/ui-audio-settings.js` | Input device picker (WebRTC in browser; RtAudio device list in Electron). Output device picker (Electron only). Channel routing dropdowns. Speaker sweep. Sample rate and buffer size controls. |

---

## electronBridge API

`window.electronBridge` is exposed by `electron-preload.js` via `contextBridge`. It is `undefined` in the browser.

| Method | Direction | Description |
|---|---|---|
| `isElectron` | — | `true` — use this to detect Electron at runtime |
| `sendAudioBuffer(f32)` | renderer → main | Send interleaved Float32Array of N-channel audio to RtAudio |
| `getAudioDevices()` | renderer → main | Returns list of output devices with `id`, `name`, `outputChannels`, `isDefault`, `quadCapable` |
| `setAudioDevice(id, nCh, bufFrames)` | renderer → main | Open RtAudio output stream; returns `{ ok, streaming, sampleRate }` |
| `getInputDevices()` | renderer → main | Returns list of input devices with `id`, `name`, `inputChannels`, `isDefault` (from RtAudio, not WebRTC) |
| `setInputDevice(id, nCh, bufFrames)` | renderer → main | Open RtAudio input stream; returns `{ ok, nCh, sampleRate, name }` |
| `onAudioInputBuffer(cb)` | main → renderer | Register callback `cb(f32: Float32Array, nCh: number)` for multichannel input PCM from RtAudio |
| `onOSC(cb)` | main → renderer | Register callback `cb(address: string, values: any[])` for all OSC messages from Max. Called by `osc.js` which dispatches to sensor, grain params, etc. |
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

## What Max Does Now

Max is no longer in the audio chain. It is a controller: sensor data, grain parameters, presets, transport, seed placement, and undo — all via OSC. The same namespace works in both contexts; `bridge.js` handles the transport switch (UDP in Electron, WebSocket in browser). Max patches live in `max/`.

The consolidated Max patch (`max/main.maxpat`) is the control surface today (legacy `mubone-controller.maxpat` was deleted in the Max reorg per CHANGELOG). The x-imu3 sensor path runs through `max/x-imu3.maxpat` and feeds `/sensor/{name}/quaternion` upstream.
