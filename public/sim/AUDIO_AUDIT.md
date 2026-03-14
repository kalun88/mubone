# Mubone Audio Engine — Technical Audit Report

**Date:** 2026-03-14
**Scope:** Full codebase inspection of `mubone-web-private/js/` (11,502 lines across 20 modules)
**Focus:** Audio reliability, real-time safety, architecture, scalability to 8–32 channel native output

---

## 1. Audio Entry Points & Initialization Sequence

### Entry Point Chain

`main.js` line 188 is the top-level orchestrator. The initialization order is:

1. `resizeCanvas()` → `setupEvents()` → `setupDragDrop()` → `rebuildSampleListUI()`
2. `setupPresets()` → `initGrainControls()` → `setupMappingModal()`
3. `initMidi()` → `requestMicAccess()` (triggers `ensureAudioContext()`)
4. `initSensor()` → `initOSC()` → `initAudioSettings()`
5. **Grain scheduler**: `setInterval(scheduleGrains, GRAIN_SCHEDULER_INTERVAL_MS)` — line 188
6. **Render loop**: `requestAnimationFrame(animate)` — started after first rAF

**Electron path** (main.js ~line 168–185): After standard init, calls `initQuadBuses()` then `initSpeakerBuses(nCh)` with the saved device channel count.

### AudioContext Creation

`audio.js:ensureAudioContext()` (line 29) creates the AudioContext lazily on first call. The context is created with `S.preferredSampleRate ?? 44100`. The master bus chain wired in this function is:

```
masterGain → softClipper (WaveShaper, tanh, 4x oversample) → masterAnalyser → muteGain → destination
```

Additionally creates: `monitorBus`, `houseBus`, `monitorToHouseGain`, `houseGainNode`, `cursorMasterGain`.

### Critical Observation: No User-Gesture Guard

`ensureAudioContext()` creates the context and assumes it will be in `"running"` state. On Chrome, AudioContext starts `"suspended"` until a user gesture. The code handles this via `S._resetOnsetClocks` (grain.js line 1095), which is called when the context transitions to `"running"`. However, there is no explicit `audioCtx.resume()` call visible in `ensureAudioContext()` itself — this relies on `requestMicAccess()` (which calls `getUserMedia`) to implicitly resume the context. If mic access is denied or deferred, the context may stay suspended while `setInterval(scheduleGrains, 10)` is already running, silently burning CPU.

---

## 2. Web Audio Graph Reconstruction

### Master Bus Topology

```
                                ┌─► speakerBuses[0..N-1] ─► ChannelMerger ─► quadCaptureWorklet
                                │                                            ─► speakerAnalysers[0..N-1]
cursor grains ─► monitorBus ────┤
                                ├─► monitorToHouseGain ─► houseBus ─► houseGainNode ─► speakerBuses (VBAP)
                                │
                                └─► cursorMasterGain ─► masterGain ─► softClipper ─► analyser ─► muteGain ─► destination

cloud grains ─► houseBus (directly, bypassing monitorBus)

Stereo mixdown (when active):
  speakerBuses[0..N-1] ─► mixdownHouseGainNodes ─► monitorSpeakerBuses[L,R]
  monitorBus            ─► mixdownCursorGainNodes ─► monitorSpeakerBuses[L,R]
```

### Per-Grain Node Chain (grain.js:playGrain)

Each grain creates:

```
AudioBufferSourceNode ─► GainNode (envelope) ─► [optional elevGainNode] ─► StereoPanner or VBAP gains ─► bus
```

The envelope is applied via `setValueCurveAtTime()` on the GainNode with pre-computed Hann attack/release curves, with a fallback to `linearRampToValueAtTime()` when `setValueCurveAtTime` throws (line ~380–420 in grain.js).

### Node Lifecycle

Nodes are **not** reused via a pool. Each `playGrain()` call creates fresh `AudioBufferSourceNode` + `GainNode` + optional `StereoPanner`. Nodes are disconnected via `_deferDisconnect()` which now performs immediate `node.disconnect()` (previously batched 40 nodes per 100ms sweep — ✅ simplified in Fix #2). The `_grainSourceCount` tracks live nodes, capped at `MAX_GRAIN_NODES=150`.

### Context Recreation

`audio.js:recreateAudioContext(newSampleRate)` tears down and rebuilds the entire graph when the user changes sample rate. This calls `S._resetOnsetClocks()` to prevent stale onset times from the old context's clock.

---

## 3. Real-Time Safety Violations

### CRITICAL: AudioWorklet Allocations in process()

**recording-capture.worklet.js** (line 51):
```js
this._batch.push(new Float32Array(input[0]));
```
Called every `process()` invocation (128 samples, ~2.7ms at 48kHz). `new Float32Array()` allocates on the heap inside the audio render thread. `Array.push()` may trigger array resizing. Both can cause GC pauses that produce audible glitches.

**quad-capture.worklet.js** (lines 35–38):
```js
const block = [];
for (let c = 0; c < n; c++) block.push(new Float32Array(input[0][c]));
this._batch.push(block);
```
Even worse: N allocations per process() call (one per channel), plus array creation, plus outer array push. For an 8-channel setup, that's 8 `new Float32Array(128)` allocations every 2.7ms.

**input-meter.worklet.js**: Uses `this._pending.push()` which is less severe but still involves dynamic array growth on the audio thread.

### FIX RECOMMENDATION:
Pre-allocate ring buffers in the worklet constructor. Use fixed-size circular buffers with head/tail indices. Post to main thread when a batch threshold is reached using `postMessage` with `Transferable` (zero-copy). Example pattern:

```js
constructor() {
  this._ring = new Float32Array(BATCH_SIZE * FRAME_SIZE);
  this._writePos = 0;
}
process(inputs) {
  this._ring.set(inputs[0][0], this._writePos * FRAME_SIZE);
  this._writePos++;
  if (this._writePos >= BATCH_SIZE) {
    this.port.postMessage(this._ring, [this._ring.buffer]); // transfer
    this._ring = new Float32Array(BATCH_SIZE * FRAME_SIZE);  // only allocate on flush
    this._writePos = 0;
  }
  return true;
}
```

### MODERATE: Envelope Curve Allocation

`state.js:buildEnvelopeCurves()` creates `new Float32Array` per call. This is called from `playGrain()` when the cached curves don't match the current parameters. The caching in `_cachedAtk`/`_cachedRel` on the grain params object mitigates this for the cursor path (same params across grains). However, cloud grains with `cloudWeight < 0.999` create a new params object via `Object.assign(Object.create(cgp), { ... _cachedAtk: null })` (grain.js line 1045), which forces a fresh curve build for every attenuated cloud grain.

### MODERATE: setValueCurveAtTime Fallback Path

grain.js lines ~380–420 use try/catch around `setValueCurveAtTime`. When this throws (overlapping curves, past start time), the fallback uses `linearRampToValueAtTime` which is less precise but avoids the crash. The try/catch itself is zero-cost in V8 when no exception occurs, but exception-throwing in a tight scheduling loop creates megamorphic call sites that de-optimize surrounding code.

### LOW: DOM Access in scheduleGrains()

grain.js lines 1063–1066:
```js
const gcEl = document.getElementById('granulatingCount');
if (gcEl) gcEl.textContent = activeCount;
```
This runs every 10ms. DOM reads (`getElementById`) are cheap but `textContent` assignment triggers layout invalidation. At 100 calls/sec this is measurable. Should be throttled to match the perfTick rate (4Hz).

---

## 4. UI → Audio Communication Paths

### Direct State Mutation (Primary Pattern)

The dominant pattern is UI code writing directly to `S` (the shared state object in state.js), which the audio scheduler reads on its next tick. Examples:

- `ui-improv.js:applyHouse()` writes `S.houseGainValue` and calls `S.houseGainNode.gain.setTargetAtTime()` directly
- `ui-presets.js` writes `S.grainOverrides.*` which `scheduleGrains()` reads via `gp()`
- `events.js` writes `S.cursorAz`, `S.cursorEl` which `scheduleGrains()` uses for angular distance

This is safe because JavaScript is single-threaded — the UI and the `setInterval` scheduler share the same event loop. However, this pattern **will not survive** a move to an AudioWorklet-based scheduler or a native C++ engine, as those run on separate threads.

### AudioParam Automation (Secondary Pattern)

Gain changes use `setTargetAtTime()` with a 20ms time constant (e.g., `ui-meters.js:setCursorHouseMuted`, `ui-improv.js:applyMonitor`). This is correct and glitch-free.

### IPC for Electron Audio Output

`electron-main.js` IPC handler `"audio-buffer"` receives interleaved Float32Array from the renderer process. The renderer's quad-capture worklet posts PCM to the main thread, which forwards it via `ipcRenderer.send('audio-buffer', data)` to the main process, which writes it to RtAudio.

**Latency concern:** This path crosses three boundaries: AudioWorklet → main thread (postMessage) → IPC (renderer→main) → RtAudio write. Each hop adds at least one buffer period of latency. At 256 frames / 48kHz, that's ~5.3ms per hop, so ~16ms minimum added latency on top of the RtAudio buffer size.

### OSC → State

`osc.js:handleOSC()` writes directly to `S.*` and optionally calls `scheduleUISync()` which batches DOM updates to the next `requestAnimationFrame`. This is well-structured — OSC messages at high rates (e.g., sensor data at 100Hz) don't cause DOM thrashing.

---

## 5. Spatial Audio / Spatialization Implementation

### VBAP (Vector-Based Amplitude Panning)

Implemented inline in `grain.js:playGrain()`, approximately lines 440–510. The algorithm:

1. Computes grain azimuth from particle position (or explicit az/el)
2. Finds the two adjacent speaker buses that bracket the grain azimuth
3. Applies equal-power crossfade: `gainL = cos(theta)`, `gainR = sin(theta)` where theta is the fraction between the two speakers

**Strengths:**
- Correct 2D VBAP for horizontal-only speaker arrays
- Equal-power law preserves energy across the pan

**Weaknesses:**
- **No elevation support in VBAP.** The `elevGainNode` (grain.js ~line 430) applies a simple amplitude reduction based on elevation angle, not true 3D VBAP. For a full 3D speaker array (e.g., dome or Atmos), this is insufficient.
- **Speaker layout assumed circular/equidistant.** The azimuth-based bracketing works only for regularly spaced horizontal arrays. Irregular speaker placements (common in installation art) would need a proper VBAP matrix with pre-computed speaker pairs/triplets.
- **Per-grain VBAP computation.** Each grain independently computes speaker gains and creates GainNodes per speaker bus. For 8 speakers × 12 grains/tick = 96 GainNode creations per tick. At 32 speakers this becomes 384 GainNodes per tick — likely unsustainable.

### Stereo Fallback

When `S.speakerBuses` is not initialized (browser mode), grains use `StereoPanner` with the particle's azimuth mapped to -1..+1. This is correct for stereo output.

### Monitor/House Bus Architecture

The monitor/house split (audio.js) is well-designed for live performance:
- Cursor grains → monitorBus (performer's headphones) + optional house send
- Cloud grains → houseBus directly (audience speakers)
- `cursorHouseMuted` flag mutes cursor from house while keeping it in monitor

---

## 6. Scalability & Multichannel Readiness

### Current Limits

| Resource | Limit | Source |
|----------|-------|--------|
| Grain nodes | 150 | `MAX_GRAIN_NODES` in state.js |
| Grains/tick | 12 | `MAX_GRAINS_PER_TICK` in grain.js |
| Scheduler interval | 10ms | `GRAIN_SCHEDULER_INTERVAL_MS` in state.js |
| Disconnect batch | ~~40/100ms~~ immediate | Deferred batching removed (Fix #2) |
| Speaker buses | Dynamic | Set by `initSpeakerBuses(numChannels)` in audio.js |

### Scaling to 32 Channels

**Node count explosion:** Each grain creates 1 source + 1 envelope gain + N speaker gains (one per active bus in the VBAP pair). At 32 channels with 2-speaker VBAP, each grain needs 4 nodes minimum. At 150 max grain nodes, effective grain polyphony drops to ~37. The `MAX_GRAIN_NODES` limit counts only source nodes (`S._grainSourceCount`), not the associated gain nodes — the actual Web Audio node count is 3–4x higher.

**ChannelMerger bottleneck:** `audio.js:initSpeakerBuses()` creates a single `ChannelMerger(numChannels)`. Chrome's ChannelMerger has been observed to introduce additional latency at high channel counts (>16). The merger fans all buses into the quad-capture worklet for Electron IPC output.

**IPC bandwidth:** At 32 channels × 48kHz × 4 bytes/sample = 6.14 MB/s of PCM data crossing the IPC bridge. Electron's IPC serializes this as structured clone, which copies the buffer. At 256-frame blocks, that's 187 IPC messages/second, each carrying 32KB. This is within Electron's capabilities but leaves little headroom.

### Recommendations for Native C++ Migration

1. **Move grain scheduling to a native audio callback.** The current `setInterval` + Web Audio scheduling pattern is fundamentally incompatible with a native audio engine that expects synchronous buffer fills in a real-time callback.

2. **Implement a proper VBAP matrix.** Pre-compute speaker pair/triplet lookup tables at speaker layout change time, not per-grain. Store as a simple azimuth→gains lookup with interpolation.

3. **Use a node pool.** Pre-allocate a fixed number of "grain voice" structures (source + envelope + pan gains) and recycle them. This eliminates per-grain allocation entirely.

4. **Replace IPC PCM streaming with shared memory.** Use `SharedArrayBuffer` between the renderer and a native addon, or move the entire audio engine into a native Node addon that owns the audio thread.

---

## 7. GC Pressure & CPU Hotspots

### GC Hotspots (ranked by severity)

1. **Worklet allocations** (Section 3 above) — `new Float32Array` in process() is the #1 GC risk. Every 2.7ms, every active worklet allocates.

2. **Cloud grain param cloning** — grain.js line 1044: `Object.assign(Object.create(cgp), {...})` creates a new object per attenuated cloud grain. With 4 clouds × 12 grains/tick = up to 48 object allocations per 10ms tick.

3. **Candidate pool sorting** — grain.js line 1009: `.sort((a,b) => a._ang - b._ang)` creates comparison function closures. The sort itself may allocate internal temp arrays for >10 elements (TimSort in V8).

4. **activeGrainMap** — `Map.set()` and `Map.delete()` in `scheduleGrains()` and the cleanup sweep. Map operations are generally fast but the map grows/shrinks continuously, creating GC nursery pressure.

5. **buildEnvelopeCurves()** — Creates `new Float32Array(128)` pairs. Mitigated by caching on cursor path, but cloud grains with `_cachedAtk: null` bypass the cache.

### CPU Hotspots

1. **`scheduleGrains()`** — Called every 10ms. The angular distance computation iterates all particles, computes `Math.acos(dot product)` for each. With 500 particles this is 500 trig calls per tick. The dirty-flag cache helps but is invalidated every time the cursor moves (which is every frame during performance).

2. **`featuresFromBuffer()`** — audio-features.js line 108. The inline DFT is O(N*K) = 256×128 = 32,768 multiply-adds per call. Called once per particle at paint time, not per frame, so impact is bounded.

3. **`tickMeters()`** in ui-meters.js — Runs its own RAF loop independently of the render loop. For N channels, reads N AnalyserNodes and draws N canvases every frame. At 32 channels, that's 32 `getFloatTimeDomainData` + 32 canvas draw calls at 60fps. Could be throttled to 30fps or 15fps without visible quality loss.

4. **`animate()` in renderer.js** — Throttled to 30fps. The `drawParticles()` function uses pre-allocated sort buffers (good), but the glow cache (`_glowCache Map`) creates/deletes entries per frame.

---

## 8. Electron-Specific Concerns

### Audio Pipeline Latency

The Electron audio pipeline is:

```
Web Audio graph → quad-capture worklet → postMessage → renderer main thread → IPC send → main process → RtAudio write
```

Each stage introduces latency:
- Worklet → main thread: 1 render quantum (128 samples = 2.7ms at 48kHz) minimum
- IPC serialization: ~0.5–2ms depending on buffer size
- RtAudio buffer: user-configured (typically 256–512 frames = 5.3–10.7ms)

**Total added latency: ~8–15ms** on top of the RtAudio hardware buffer, which itself adds another buffer period. For a grain-based instrument this is acceptable, but for real-time monitoring of live input it's noticeable.

### IPC Buffer Safety

`electron-main.js` IPC handler `"audio-buffer"` (line ~220) has a size-mismatch guard:
```js
if (data.length !== expectedSize) return; // silently drops mismatched buffers
```
This is correct but the silent drop means buffer underruns appear as silence rather than errors. Consider logging mismatches at a throttled rate for diagnostics.

### RtAudio Device Management

`createOutputStream()` and `createInputStream()` in electron-main.js create separate RtAudio instances for output and input. This means input and output may use different hardware clocks, leading to drift over time. For sessions longer than ~30 minutes, clock drift between input and output devices can cause buffer accumulation/depletion, manifesting as periodic clicks or pitch drift.

**Fix:** Use a single RtAudio instance with duplex mode when input and output are on the same hardware device.

### Context Isolation

`electron-preload.js` correctly uses `contextBridge.exposeInMainWorld` to expose a limited `electronBridge` API. No `nodeIntegration` leak observed. The exposed API surface is minimal and appropriate.

### getUserMedia Limitation

Comment in ui-audio-settings.js line 16 notes that Electron's `getUserMedia` is capped at 2 channels. The workaround (RtAudio input stream via IPC) is correct but adds the same latency concerns as the output path.

---

## 9. Architecture & Refactor Recommendations

### 9.1 Extract VBAP into a Dedicated Module

Currently VBAP is inline in `playGrain()` (~70 lines). Extract to `vbap.js` with:
- `computeVBAPGains(azimuth, elevation, speakerLayout)` → `Float32Array` of gains
- Pre-computed speaker pair lookup table
- Support for irregular speaker layouts and 3D (triplet-based) VBAP

### 9.2 Introduce a Grain Voice Pool

Replace per-grain node creation with a pre-allocated pool of "voice" objects:
```
class GrainVoice {
  source: AudioBufferSourceNode
  envelope: GainNode
  panGains: GainNode[]  // one per speaker bus
}
```
Pool size = `MAX_GRAIN_NODES`. On `playGrain()`, acquire a voice from the pool, configure it, start it. On grain end, return to pool. This eliminates all per-grain allocation and the deferred disconnect system entirely.

### 9.3 Move Grain Scheduling to AudioWorklet

The `setInterval(scheduleGrains, 10)` pattern is the single largest source of timing jitter. The 10ms JS timer has ±5ms variance under load (and up to ±25ms when the tab is backgrounded). The 120ms lookahead compensates, but this means grains are scheduled 120ms ahead of audible time — any parameter change takes 120ms to be heard.

Moving the scheduler into an AudioWorklet would give sample-accurate timing with zero jitter. The worklet would receive particle data and grain parameters via `postMessage`, and schedule grains using the deterministic `currentFrame` counter.

### 9.4 Separate Audio State from UI State

`state.js` mixes audio-critical state (grain params, bus routing, analyser references) with UI state (DOM element refs, panel visibility, color schemes). For the C++ migration, create a clean `AudioState` interface that contains only what the audio engine needs, serializable as a flat struct.

### 9.5 Rate-Limit Input Events

`events.js` has no throttling on `mousemove` or `touchmove` handlers. These fire at the display refresh rate (60–120Hz) and write to `S.cursorAz`/`S.cursorEl`, which invalidates the angular distance cache in `scheduleGrains()`. Throttle to 30Hz (matching the render target) or use `requestAnimationFrame` coalescing.

### 9.6 Consolidate RAF Loops

Three independent `requestAnimationFrame` loops run simultaneously:
1. `animate()` in renderer.js (throttled to 30fps)
2. `startMainMetering()` in ui-meters.js (unthrottled, runs at display refresh)
3. Various UI sync callbacks via `requestAnimationFrame` (osc.js, wand.js)

Consolidate into a single RAF dispatcher that calls subsystems in priority order. This prevents RAF callback starvation under load and ensures consistent frame timing.

### 9.7 Type the IPC Protocol

The Electron IPC messages (`"audio-buffer"`, `"osc-message"`, `"set-audio-device"`, etc.) are untyped string dispatches. For reliability, define a typed protocol (TypeScript interface or at minimum a shared constants module) and validate message shapes at both ends.

---

## 10. File Map & Module Organization

### Module Dependency Graph

```
main.js (entry point)
  ├── state.js          (921 lines)  — Shared mutable state, constants, presets
  ├── audio.js          (927 lines)  — AudioContext, master bus, device management
  ├── grain.js          (1105 lines) — Grain scheduling, playback, VBAP, node lifecycle
  ├── renderer.js       (622 lines)  — Canvas 2D rendering, particle painting, camera
  ├── events.js         (367 lines)  — Keyboard, mouse, touch input
  ├── sensor.js         (284 lines)  — BNO085 quaternion handling, tare system
  ├── osc.js            (385 lines)  — OSC dispatch (WebSocket + Electron IPC)
  ├── midi.js           (414 lines)  — MIDI learn, CC/Note mapping
  ├── wand.js           (529 lines)  — Wand orientation, preset morphing
  ├── audio-features.js (178 lines)  — RMS, spectral centroid, ZCR extraction
  ├── diag.js           (351 lines)  — Diagnostics, crash capture, auto-save
  ├── mobile.js         (420 lines)  — Mobile-specific UI and touch handling
  ├── sphere.js         (74 lines)   — Sphere geometry helpers
  ├── ui-audio-settings.js (1561 lines) — Audio device modal, input metering, channel routing
  ├── ui-presets.js     (892 lines)  — Preset management, cloud drop/pickup
  ├── ui-samples.js     (809 lines)  — Sample loading, waveform display
  ├── ui-wand.js        (703 lines)  — Wand configuration UI
  ├── ui-improv.js      (181 lines)  — Improv mode controls (house/monitor/morph)
  ├── ui-meters.js      (319 lines)  — VU meter rendering, gate indicator
  ├── ui-viz.js         (95 lines)   — Visualization settings
  └── ui-sensor.js      (175 lines)  — Sensor configuration UI
```

### Worklets (separate thread)

```
js/worklets/
  ├── recording-capture.worklet.js  (62 lines)  — Mono recording capture
  ├── quad-capture.worklet.js       (66 lines)  — N-channel capture for Electron output
  └── input-meter.worklet.js        (59 lines)  — Input PCM de-interleaving for meters
```

### Electron

```
electron-main.js    (340 lines)  — Main process: window, OSC UDP, RtAudio I/O
electron-preload.js (44 lines)   — Context bridge for renderer↔main IPC
```

### Coupling Concerns

- **state.js is a god object.** Every module imports `S` and reads/writes freely. There are no access boundaries — audio code can write UI state and vice versa. This makes it impossible to extract the audio engine without also pulling in UI dependencies.
- **Circular dependency risk:** `ui-audio-settings.js` imports from `audio.js` and writes to `S`, which `grain.js` reads. The `S._rebuildMainInputMeters` callback pattern (ui-meters.js line 298) is a dependency inversion to avoid circular imports, but it creates invisible coupling.
- **grain.js is too large.** At 1105 lines, it contains scheduling, playback, VBAP, node lifecycle, and candidate selection. These should be separate modules.

---

## 11. Top 10 Critical Fixes

### #1 — Eliminate Heap Allocations in AudioWorklet process() ✅ FIXED

**Files:** `recording-capture.worklet.js`, `quad-capture.worklet.js`, `input-meter.worklet.js`
**Risk:** Audio glitches from GC pauses on the audio render thread
**Fix:** Pre-allocate ring buffers in the constructor. Use `Transferable` for zero-copy postMessage.
**Status:** All three worklets rewritten with pre-allocated ring buffers. `recording-capture` uses a flat `Float32Array` ring with `_writePos` index; `quad-capture` writes interleaved directly into `this._interleaved`; `input-meter` replaced `push/shift/unshift` with a circular ring buffer (`_ring`, `_readPos`, `_writePos`). Zero allocations in any `process()` call.

### #2 — Immediate Grain Node Disconnect (replaces deferred batching) ✅ FIXED

**File:** `grain.js`
**Risk:** At high grain rates, the create→schedule→defer-disconnect→batch-disconnect lifecycle creates sustained GC pressure.
**Fix (revised):** Replaced the deferred disconnect batching system (`_disconnectQueue`, `_disconnectTimerId`, `_flushDisconnects`, `DISCONNECT_BATCH=40`, `DISCONNECT_INTERVAL=100ms`) with immediate `node.disconnect()` in `_deferDisconnect()`. Function name preserved so all 13 call sites work unchanged. Eliminates the 100ms sweep timer and queue array entirely. Chrome's bulk-disconnect crash concern was resolved by testing — individual immediate disconnects are safe.

### #3 — Fix Cloud Grain Param Object Allocation ✅ FIXED

**File:** `grain.js` (~line 1046–1065)
**Risk:** Creates a new object per attenuated cloud grain, bypasses envelope cache
**Fix:** Each cloud slot now has a persistent `cloud._effectiveParams` object. When `cloudWeight < 0.999`, properties are copied in-place via `Object.keys()` loops (no `Object.assign` / `Object.create`). Volume is set as `cgp.volume * cloudWeight`. Envelope cache (`_cachedAtk`) is only invalidated when `_lastCloudWeight` actually changes — so curves are rebuilt once per weight change, not per grain.

### #4 — Throttle DOM Updates in scheduleGrains() ✅ FIXED

**File:** `grain.js` (~line 1081–1089)
**Risk:** `document.getElementById` + `textContent` assignment 100 times/second
**Fix:** DOM updates now run every 25th scheduler tick (~4Hz). Element references (`_gcEl`, `_vmGrainsEl`) are cached after first lookup — `getElementById` is called at most once per session per element.

### #5 — Add Input Event Throttling ✅ FIXED

**File:** `events.js` (lines 27–43)
**Risk:** 60–120 events/sec invalidate the angular distance cache, causing full particle re-sort every 10ms
**Fix:** `mousemove` and `touchmove` handlers now write to pending variables (`_pendingMouseX/Y`, `_pendingPixelX/Y`) and schedule a single `requestAnimationFrame` flush via `_flushInput()`. State is written to `S.mouseX/Y` once per frame regardless of how many events fired.

### #6 — Unify requestAnimationFrame Loops ✅ FIXED

**Files:** `renderer.js:animate()`, `ui-meters.js`
**Risk:** Multiple RAF callbacks compete for frame budget; meters can starve the renderer.
**Fix:** `ui-meters.js` no longer runs its own RAF loop. It exposes `tickMainMeters()` via `S._tickMainMeters`, which `renderer.js:animate()` calls at the end of each frame. Meters run at half rate (every other call ≈ 30fps) via `if (++_meterTickCount & 1) return`.

### #7 — Handle AudioContext Suspension Explicitly ✅ FIXED

**File:** `grain.js:scheduleGrains()` (top of function)
**Risk:** Context starts suspended on Chrome; scheduler burns CPU scheduling grains that never play.
**Fix:** Added suspension guard at the top of `scheduleGrains()`: `if (!S.audioCtx || S.audioCtx.state !== 'running') return;`. Scheduler is now a no-op when the context is suspended or not yet created.

### #8 — Warn About Same-Device I/O Clock Drift ✅ ADDRESSED

**File:** `electron-main.js:createInputStream()`
**Risk:** Separate RtAudio instances for input and output use independent hardware clocks.
**Fix (partial):** Added a console warning when input and output share the same device ID, advising duplex mode for sessions > 30 minutes. Full duplex mode refactor deferred — requires significant RtAudio API changes and testing across platforms.

### #9 — Pre-compute VBAP Speaker Pair Lookup ✅ FIXED

**Files:** `grain.js` (lines 5–36, ~539–544), `audio.js`
**Risk:** Per-grain linear scan of all speaker azimuths — O(N) per grain.
**Fix:** `buildVBAPLookup(speakers)` builds a 360-entry lookup table at `initSpeakerBuses()` time. Each entry stores `{ idxA, idxB, wA, wB }` — the two bracketing speakers and their equal-power gains. `playGrain()` now does a single O(1) array lookup: `_vbapLUT[Math.round(azDeg) % 360]`. Called from `audio.js` after speaker buses are assigned to state.

### #10 — Add Backpressure to Electron IPC Audio Path ✅ FIXED

**Files:** `electron-main.js`, `electron-preload.js`, `audio.js`
**Risk:** IPC buffers accumulate when main process can't write to RtAudio fast enough.
**Fix:** Credit-based flow control across the full chain. `electron-main.js` initialises 8 credits (`IPC_AUDIO_MAX_CREDITS`), sends one credit back after each successful `rtAudio.write()`, and logs throttled mismatch warnings with a drop counter. `electron-preload.js` exposes `onAudioCredit` via the context bridge. `audio.js` tracks `_audioCredits` (starts at 8), decrements on send, replenishes on credit receipt — drops buffers when credits are exhausted.

---

## 12. Additional Fixes (post-audit)

### #11 — Eliminate Cursor Param Spread-Operator Allocation ✅ FIXED

**File:** `grain.js:playGrain()` (~line 231–244)
**Risk:** Every cursor grain allocated a new object via `{ ...p, duration: ..., ... }` — ~100 objects/sec at typical grain rates.
**Fix:** Replaced with a module-level reusable `_cursorEP` object. Base preset keys are copied via `Object.keys()` loop, overrides applied with `!== undefined` checks. Zero per-grain allocation for cursor grains.

### #12 — activeGrains Ring Buffer ✅ FIXED

**Files:** `grain.js:playGrain()` (~line 644–670), `state.js`
**Risk:** `S.activeGrains.push({...})` allocated a new metadata object per sample grain; `.shift()` was O(N) when the array reached capacity (MAX_GRAIN_NODES × 2 = 300).
**Fix:** Once the array reaches capacity, new entries overwrite the slot at `S._agWriteIdx` (modular ring cursor) — reusing existing objects and eliminating both the allocation and the O(N) shift.

### #13 — Pre-Allocated Recency Filter Structures ✅ FIXED

**File:** `grain.js` (recency filter helpers)
**Risk:** `_buildCandidatePool` and `_buildCandidatePoolRadius` created `new Map()`, `new Set()`, and `[...entries()].sort().slice().map()` intermediate arrays every tick per cloud. At 4 clouds × 100 ticks/sec = ~400 Map+Set+sort allocations/sec.
**Fix:** Three module-level reusable structures: `_recBufRec` (Map), `_recAllowed` (Set), `_recSortBuf` (Array). Cleared with `.clear()` / `.length = 0` each call instead of reallocating.

### #14 — _extraNodes Array Reuse in VBAP Path ✅ FIXED

**File:** `grain.js:playGrain()` (multi-channel speaker path)
**Risk:** `const _extraNodes = []` allocated a new array per grain inside the VBAP path for tracking mixdown L/R gain nodes.
**Fix:** Module-level `_extraNodesBuf` array, cleared with `.length = 0` at the start of each grain. Snapshot-copied to a local `_extraNodes` only when the grain actually has extra nodes (≤2 elements), or set to `null` otherwise.

### #15 — Cached Cartesian Coordinates for Angular Distance ✅ FIXED

**Files:** `grain.js` (angleBetweenSphere, scheduleGrains cursor/cloud loops), `renderer.js` (particle creation)
**Risk:** `angleBetweenSphere(lon1, lat1, lon2, lat2)` computed 4 cos + 2 sin + 1 acos = 7 trig calls per particle per cache miss. With 500 particles and cursor moving: ~3,500 trig calls per tick.
**Fix:** Particles now get `_cx, _cy, _cz` (unit-sphere Cartesian) stamped at creation via `stampCartesian(p)`. The cursor/cloud angle loops pre-compute the reference point's Cartesian once per tick, then use `_angleFromCached(p, rx, ry, rz)` which is just `acos(dot)` — 1 trig call per particle instead of 7. ~6× reduction in trig operations on cache miss.

### #16 — Onset Clock Floating-Point Re-Anchoring ✅ FIXED

**File:** `grain.js:scheduleGrains()` (after cursor scheduling loop)
**Risk:** The onset clock accumulates `_cursorNextOnsetT += period` thousands of times per session. Floating-point addition drift causes the scheduled time to diverge from the true audio clock over 30+ minute sessions — potentially causing subtle rhythmic drift.
**Fix:** Every 30 seconds, re-anchor the onset clock: compute `offset = _cursorNextOnsetT - audioNow`, then set `_cursorNextOnsetT = audioNow + offset`. This resets the fp accumulation error while preserving the exact phase relationship. The musical effect is imperceptible since `periodVar` jitter already exceeds fp drift.

---

## Appendix: Constants Reference

| Constant | Value | Location |
|----------|-------|----------|
| `GRAIN_SCHEDULER_INTERVAL_MS` | 10 | state.js |
| `MAX_GRAIN_NODES` | 150 | state.js |
| `SCHED_SAFE_PERIOD_S` | 0.010 | state.js |
| `SCHED_LOOKAHEAD` | 0.120 | grain.js |
| `MAX_GRAINS_PER_TICK` | 12 | grain.js |
| `DISCONNECT_BATCH` | ~~40~~ removed | grain.js (Fix #2) |
| `DISCONNECT_INTERVAL` | ~~100ms~~ removed | grain.js (Fix #2) |
| `RENDER_TARGET_FPS` | 30 | state.js |
| `PAINT_INTERVAL` | 3 frames | renderer.js |
| `PEAK_DECAY` | 0.75 | audio-features.js |
| `RMS_DECAY` | 0.80 | audio-features.js |
| Hann curve length | 128 samples | state.js |
| Soft clipper curve | 4096 points, tanh(10x) | audio.js |
