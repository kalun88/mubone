# Mubone — Audio Architecture Notes

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

## Spatial Modes: Sim vs Physical

`S.spatialMode` is `'sim'` (default) or `'physical'`. The switch lives in `grain.js` at the point where the grain's world-space position is resolved to a panning coordinate:

```js
// Sim:      rotate grain into camera space — panning is view-relative
// Physical: use world-space position directly — speakers are room-fixed
const [cx, cy, cz] = S.spatialMode === 'physical'
  ? [wx, wy, wz]
  : qRotateVec(qConjugate(S.camQ), [wx, wy, wz]);
```

**Sim mode** (`'sim'`)
- Audio is panned relative to the current camera orientation.
- Rotating the view (mouse or sensor) rotates the sound world with you — like a first-person video game. A grain painted at the front of the sphere always sounds in front of wherever you're looking.
- Intended for headphone listening, browser demos, and stereo monitoring.
- Always produces stereo output (or N-channel with the same view-relative behaviour).

**Physical mode** (`'physical'`)
- Grain positions are in world space. The VBAP azimuth is computed from the grain's fixed position relative to the room, ignoring camera orientation.
- Rotating your body (sensor) turns the visual sphere but does not pan the audio — the sounds stay anchored to physical speaker positions.
- Intended for real installations and performances where speakers are fixed in the room and the performer moves within the space.
- Requires at least 2 physical output channels; works up to any N.
- In Electron: the BNO085 sensor drives camera rotation AND the paint cursor position.
- In browser: physical mode can be selected but without the sensor the camera is mouse-driven; the panning behaviour is the same (world-space) but the performer can't "turn" into it.

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
| Electron | Live performance, installation | N-channel via audify / RtAudio | BNO085 via Max OSC → UDP → IPC |

The granular engine (`grain.js`) checks `S.speakerBuses` at render time. If present, it routes via VBAP to the speaker buses. If null, it falls through to the stereo panner path. No other code changes between contexts.

---

## OSC / Max Integration

All OSC messages — sensor data, grain parameters, preset selection, transport and cloud controls — are dispatched through a single `handleOSC(address, values)` function in `js/osc.js`. Two transports feed it:

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

**Sensor path:** `handleOSC` routes `/orientation` with 4 floats to `handleSensorOSC(values)` in `sensor.js`, which populates `sensor.quat`. This works identically in both contexts.

**Grain params:** Written directly to `S.grainOverrides`, which `grain.js` reads on each scheduler tick. OSC changes also call `scheduleUISync()` to flush updated values back to the panel sliders and controls in the next animation frame.

**Preset / mode changes:** `S._selectPreset` and `S._setSpatialMode` are registered by the relevant UI modules and called directly — no CustomEvent needed.

**Cloud / undo controls:** Bang-style messages. `/cloud/drop` and `/cloud/pickup` call `S._dropCloud` and `S._pickupCloud` registered by `events.js`. `/undo` calls `S._undo`. Any incoming value (or no value) triggers the action.

### Full OSC namespace

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
| `/preset` | `i` | Select preset (1-based: 1=wash … 11=wobble) |
| `/spatial/mode` | `s` | `sim` / `physical` |
| `/record` | `i` | `1` = start, `0` = stop |
| `/mute` | `i` | `1` = mute, `0` = unmute |
| `/cloud/drop` | *(bang)* | Drop a cloud at current cursor position |
| `/cloud/pickup` | *(bang)* | Pick up (remove) the nearest cloud |
| `/undo` | *(bang)* | Undo the last particle paint action |

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
| `electron-main.js` | Electron main process. Manages audify output stream (device selection, channel count, buffer size, sample rate negotiation) and a separate RtAudio input stream. Receives BNO085 OSC over UDP and pushes to renderer via IPC. |
| `electron-preload.js` | IPC bridge. Exposes `window.electronBridge` to renderer (see API table below). |
| `js/audio.js` | `ensureAudioContext` (44100 Hz default), `initSpeakerBuses(N)` (builds N-channel Web Audio graph + headphone downmix + meter tap), `recreateAudioContext` (sample rate change), `rewireChannelMerger` (apply `S.channelRouting` without full rebuild). |
| `js/grain.js` | `playGrain` — VBAP routing when `S.speakerBuses` is set, stereo panner fallback otherwise. |
| `js/osc.js` | `initOSC()` selects transport (Electron IPC or browser WebSocket). `handleOSC(address, values)` dispatches all incoming OSC to sensor, grain params, preset, etc. |
| `js/sensor.js` | `handleSensorOSC(values)` — called by `osc.js` for `address === 'list'`. Populates `sensor.quat` and `sensor.euler`. |
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

**Sample rate negotiation** — audify tries rates in order `[44100, 48000]`. If a device rejects a rate, the error is caught and the next rate is tried silently. The negotiated rate is returned to the renderer and shown in the output status strip. A ⚠ warning appears if the audify rate differs from the AudioContext rate.

**Speaker sweep** — fires a 600ms white noise burst through each speaker bus in sequence with 40ms fades, logging the angle of each speaker in the status strip. In browser stereo mode, sweeps left → centre → right. Clicking the button again during a sweep stops it.

**Channel routing** — per-bus dropdowns map spatial bus index (angle) to physical output channel. The mapping is stored in `S.channelRouting` and applied by `rewireChannelMerger()` without tearing down the whole graph.

---

## Sample Rate History

The AudioContext was originally created at 22050 Hz to halve CPU load. This caused hardware negotiation failures (Core Audio rejects 22050 on MacBook built-in) and pitch/timing mismatches with audify. The default is now 44100 Hz in all contexts. 22050 Hz is still selectable in Audio Settings for CPU-constrained use.

---

## What Max Does Now

Max is no longer in the audio chain. It is a controller: sensor data, grain parameters, presets, transport, cloud placement, and undo — all via OSC. The same namespace works in both contexts; `bridge.js` handles the transport switch (UDP in Electron, WebSocket in browser). Max patches live in `max/`.

The mubone-controller patch (`max/mubone-controller.maxpat`) exposes the full control surface: all 11 presets by name, grain parameter sliders, direction segmented control, transport buttons (record, mute), spatial mode toggle, and cloud/undo bangs. The BNO085 sensor path runs through a separate `bno085.maxpat` abstraction and feeds `/orientation` quaternion data upstream.
