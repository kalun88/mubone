# Mubone Web — Full Codebase Audit Report
**Date:** March 9, 2026
**Scope:** Audio processing pipeline, rendering, state management, general efficiency
**Focus:** Redundancies, CPU hogs, dead code, and potential glitch sources

---

## CRITICAL — Audio Processing Issues

### 1. ScriptProcessorNode in Live Recording (audio.js:293)
**Severity: HIGH — Deprecated API, CPU hog**

`startLiveRecording()` uses `createScriptProcessor(2048, 1, 1)` for audio capture. ScriptProcessorNode is deprecated and runs on the main thread, meaning every audio buffer callback competes with rendering, DOM updates, and the grain scheduler for CPU time.

**Fix:** Replace with an AudioWorkletNode (like you already did for `quad-capture.worklet.js` and `input-meter.worklet.js`). You have the pattern — create a `recording-capture.worklet.js` that accumulates PCM and posts it back via MessagePort. This moves the recording path off the main thread entirely.

### 2. ScriptProcessorNode Connected to Destination (audio.js:311)
**Severity: MEDIUM — Unnecessary destination connection**

```js
S.recordingNode.connect(actx.destination); // ScriptProcessor must connect to keep running
```

This sends the recording signal to the output (speakers). You're connecting the input signal (mic) through the analyser chain and then into the speakers. Even if gain is controlled upstream, this is a monitoring feedback risk and an unnecessary audio graph connection. An AudioWorklet-based replacement wouldn't need this hack.

### 3. rebuildLiveBuffer Creates a New AudioBuffer Every ~200ms (audio.js:588–608)
**Severity: MEDIUM — GC pressure during recording**

Every 200ms during recording, `rebuildLiveBuffer()` calls `actx.createBuffer()` and `.set()` on a growing subarray. This allocates a new Float32Array and AudioBuffer that the GC must collect. At 44100 Hz, after 30 seconds of recording, each rebuild copies ~1.3M samples.

**Fix:** Consider ring-buffer architecture or only rebuild on-demand (when a grain actually needs to play from the live buffer). The current `LIVE_REBUILD_INTERVAL_MS = 200` throttle helps, but the allocation pattern is still wasteful during long recordings.

### 4. Reverse Grain Buffer Allocation in playGrain (grain.js:207–221)
**Severity: MEDIUM — Per-grain allocation for reverse playback**

Every single reverse grain allocates a new `AudioBuffer` and manually reverses the samples with a for-loop:

```js
const revBuf = actx.createBuffer(buffer.numberOfChannels, safeFc, sr);
for (let f = 0; f < safeFc; f++) dst[f] = src[safeFc - 1 - f];
```

At 10ms period with `direction: 'rnd'` (50% chance of reverse), that's ~50 buffer allocations/second, each potentially thousands of samples. This is a significant GC pressure source.

**Fix:** Pre-compute and cache the reversed version of each sample/live buffer once, and use the cached version for reverse grains. Store it alongside `buffer` in each sample slot and live rec slot.

### 5. Per-Grain Hann Curve Allocation for Seed Grains (grain.js:112–118)
**Severity: MEDIUM — Allocates 2x Float32Array(128) per seed grain**

```js
if (customParams) {
    attackCurve  = new Float32Array(HANN_LEN);
    releaseCurve = new Float32Array(HANN_LEN);
    for (let j = 0; j < HANN_LEN; j++) { ... }
}
```

Seed grains (those with `customParams`) allocate two fresh Float32Arrays every call and fill them with scaled Hann values. At dense seed periods this is thousands of short-lived allocations per second.

**Fix:** Cache the scaled curves per seed slot. Each seed has fixed `grainParams.volume`, so compute the curves once when a seed is dropped (or when its volume changes) and store them on the seed object.

### 6. Candidate Pool Recomputed Every Scheduler Tick (grain.js:526–539)
**Severity: MEDIUM — O(N) map + sort every 10ms**

```js
const withAng = S.particles.map(p => ({
    p, ang: angleBetweenSphere(p.lon, p.lat, cursorLon, cursorLat)
}));
```

Every 10ms scheduler tick, ALL particles are mapped with an `angleBetweenSphere` call (which does `acos`, `cos`, `sin` — 6 trig calls per particle). With 500 particles, that's 3,000 trig calls per tick × 100 ticks/sec = 300,000 trig ops/sec. The same computation is repeated for each seed (grain.js:615–617).

**Fix:** Consider spatial indexing (grid cells on the sphere surface) or at minimum, a dirty-flag system that only recomputes when cursor position or particles change. The cursor position moves with mouse/sensor, but particles only change when painting — cache the angular distances and invalidate on particle add/remove.

### 7. Duplicate ensureAudioContext() Calls in Seed Path (grain.js:630)
**Severity: LOW — Redundant**

```js
const seedAudioNow = ensureAudioContext().currentTime;
```

`ensureAudioContext()` was already called at line 474 (start of `scheduleGrains`). The seed loop calls it again for every seed. It's a cheap check (`if (!S.audioCtx)`) but it's unnecessary noise.

---

## MODERATE — Redundancies and Inefficiencies

### 8. Duplicate Quaternion Functions (renderer.js:882–890 vs sphere.js)
**Severity: LOW — Code duplication**

`renderer.js` has inline copies of `_qMul`, `_qNorm`, `_qFromAA`, `_qRotVec` with a comment saying they "avoid the overhead of an extra module indirection." ES module imports are resolved once at load time — there is zero runtime overhead from importing. This is dead weight that makes maintenance harder. If one is fixed, the other must be too.

**Fix:** Delete the inline copies and import from `sphere.js`. Module imports have no runtime cost.

### 9. S.recordingSourceNode Never Used (audio.js:336, state.js:617)
**Severity: LOW — Dead code**

```js
if (S.recordingSourceNode) { S.recordingSourceNode.disconnect(); S.recordingSourceNode = null; }
```

`S.recordingSourceNode` is declared in state.js and cleaned up in `stopLiveRecording()`, but it's **never assigned** anywhere. The recording path uses `S.inputAnalyser` directly as the source for the ScriptProcessor. This is dead cleanup code from a previous architecture.

**Fix:** Remove `S.recordingSourceNode` from state.js and the cleanup in `stopLiveRecording()`.

### 10. S.quadBuses Legacy Alias (audio.js:550)
**Severity: LOW — Dead code**

```js
S.quadBuses = null;
```

Comment says "Legacy alias — keeps any remaining S.quadBuses references from crashing." There are no references to `S.quadBuses` anywhere else in the codebase. This and its state.js declaration can be removed.

**Fix:** Remove `S.quadBuses` entirely.

### 11. initQuadBuses Wrapper (audio.js:579–581)
**Severity: LOW — Unnecessary wrapper**

```js
export async function initQuadBuses() {
    return initSpeakerBuses(2);
}
```

Only called from `main.js:124`. Just call `initSpeakerBuses(2)` directly and remove the wrapper.

### 12. recreateAudioContext Self-Import (audio.js:123)
**Severity: LOW — Unusual pattern**

```js
const { stopLiveRecording } = await import('./audio.js');
```

`recreateAudioContext` dynamically imports its own module to call `stopLiveRecording`. Since `stopLiveRecording` is defined in the same file, just call it directly.

### 13. _updateLiveRecUI Wrapper in events.js (events.js:31–33)
**Severity: LOW — Unnecessary wrapper**

```js
function _updateLiveRecUI() {
    S.updateLiveRecUI?.();
}
```

This wraps a single optional call. Every call site could just use `S.updateLiveRecUI?.()` directly.

### 14. Duplicate Fullscreen Toggle Logic
**Severity: LOW — Redundancy**

Fullscreen toggle is implemented identically in:
- `events.js:286–294` (fullscreenBtn)
- `ui-presets.js:177–185` (fullscreenBtn2)
- `mobile.js:318–326` (_toggleMobileFullscreen)

**Fix:** Extract a shared `toggleFullscreen()` helper.

---

## PERFORMANCE — Rendering Hot Path

### 15. drawFrame Calls drawOutputMeter + drawInputMeter Every Frame (renderer.js:391–392)
**Severity: MEDIUM — Excessive canvas redraws**

The meter canvases are redrawn every single render frame (up to 30fps). Each call does `getFloatTimeDomainData`, computes RMS/peak, and redraws the entire canvas including gradient fills, notch marks, and text. The multi-channel output path draws N separate canvases.

**Fix:** Decouple meter rendering from the main canvas drawFrame. Run meters at 15fps or only when the meter canvas is visible. The smoothing constants already filter the signal — 15fps meters would look identical.

### 16. drawGridLines: Trigonometry in Every Frame (renderer.js:543–562)
**Severity: LOW-MEDIUM — Could be cached**

Grid lines call `spherePoint()`, `cameraTransform()`, and `project()` for 36 × 25 + 18 × 25 = 1,350 points per frame. Each involves multiple trig operations and quaternion transforms.

**Fix:** Only redraw grid when camera orientation changes significantly (e.g., quaternion delta > threshold). Cache the projected grid points.

### 17. drawParticles Sorts Every Frame (renderer.js:640)
**Severity: LOW — Avoidable**

```js
idx.sort((a, b) => buf[b * STRIDE + 2] - buf[a * STRIDE + 2]);
```

Depth sorting every frame is correct for transparent objects, but with 500+ particles the Int32Array sort is not free. If the camera isn't moving, the sort order doesn't change.

### 18. ui-sensor.js: requestAnimationFrame Loop Running Unconditionally (ui-sensor.js:69–83)
**Severity: LOW — Wastes CPU when sensor modal is closed**

```js
function updateLive() {
    const el = document.getElementById('sensorLive');
    // ... update sensor readout
    requestAnimationFrame(updateLive);
}
updateLive();
```

This rAF loop runs forever, calling `document.getElementById` every frame, even when the sensor modal is hidden.

**Fix:** Only run the loop when the modal is open. Start on modal open, stop on modal close.

### 19. mobile.js: setInterval for Readout at 100ms (mobile.js:198)
**Severity: LOW — Minor**

A `setInterval` runs every 100ms to update readouts. It short-circuits when the panel is closed, which is fine, but the timer itself never stops. Use rAF only when open, or clear the interval.

---

## STATE & ARCHITECTURE

### 20. diag.js Not Imported Anywhere
**Severity: LOW — Dead module**

`diag.js` exports `initDiag()` but it's never imported in `main.js` or anywhere else. The diagnostic overlay, auto-save, and crash capture are never initialized.

**Fix:** Add `import { initDiag } from './diag.js';` to `main.js` and call `initDiag()` in `init()`, or remove the file if it's not needed.

### 21. diag.js References Stale State Properties (diag.js:65–72)
**Severity: LOW — Bugs if activated**

```js
const seedCount = S.activeSeeds ? ...     // S.activeSeeds doesn't exist; it's S.seedSlots
const sampleCount = S.loadedSamples ? ...   // S.loadedSamples doesn't exist; it's S.samples
```

If `initDiag()` were ever called, the report would show 0 seeds and 0 samples. These reference old property names that were renamed during refactoring.

### 22. activeGrains Array Grows Unbounded During Playback (grain.js:426–434)
**Severity: LOW-MEDIUM — Memory creep**

Every cursor grain that fires pushes to `S.activeGrains`. The cleanup in `updateWaveformPlayheads()` (ui-samples.js:722) filters expired entries, but this only runs at the render frame rate (30fps). At dense grain periods (55ms = shimmer), about 18 grains fire per second but only 30 cleanups/sec run. The array size is bounded but creates GC churn from the constant push + filter cycle.

**Fix:** Use a ring buffer or fixed-size pool instead of push + filter.

### 23. S.grainOverrides Uses null vs undefined Inconsistently
**Severity: LOW — Maintenance hazard**

`S.grainOverrides` fields are set to `null` to mean "use preset value." But `diag.js:54` checks for `undefined` instead of `null`:
```js
const activeOvKeys = Object.keys(ov).filter(k => ov[k] !== undefined);
```
This means all overrides always appear "active" in the diagnostic report. The override check in `grain.js` uses `??` which treats both null and undefined as "no override" — so the grain engine itself is fine, but diagnostic/debug code is wrong.

---

## POTENTIAL GLITCH SOURCES

### 24. try/catch Swallowing Errors in playGrain (grain.js:250–277)
**Severity: INFO — Already handled but worth noting**

The nested try/catch in the gain automation section is a thorough defensive layer, but it makes debugging difficult. If the outer `setValueCurveAtTime` fails, the fallback `linearRamp` is tried, and if that also fails, the grain is silenced. Consider logging to a counter (like `perf.envelopeFailures`) so overload diagnosis can distinguish between "grains dropped by budget" vs "grains failed by automation errors."

### 25. WebSocket Retry Loop Runs Forever (osc.js:124–127)
**Severity: LOW — Minor CPU waste in browser mode**

When there's no Max bridge running, the WebSocket reconnect fires every 3 seconds forever. Each attempt creates and immediately fails a WebSocket, triggering error + close handlers.

**Fix:** Use exponential backoff, or stop retrying after N failures. Resume on a user action (e.g., opening the MIDI mapping modal).

### 26. cloneNode Deep Copy in setupSvCropInteraction (ui-samples.js:167)
**Severity: LOW — Potential DOM leak**

```js
const fresh = display.cloneNode(true);
display.parentNode.replaceChild(fresh, display);
```

Every time `switchSvTab` is called, the entire `#svDisplay` DOM subtree is deep-cloned and replaced. This is a heavy operation that also adds new document-level `mousemove` and `mouseup` listeners each time (ui-samples.js:204, 243). These global listeners are never removed — they accumulate.

**Fix:** Use a single persistent set of event listeners and update their target reference, rather than replacing the DOM and re-registering.

---

## SUMMARY TABLE

| # | Severity | File | Issue | Category |
|---|----------|------|-------|----------|
| 1 | HIGH | audio.js | ScriptProcessorNode (deprecated, main-thread) | CPU hog |
| 2 | MED | audio.js | Recording node connected to destination | Redundancy |
| 3 | MED | audio.js | rebuildLiveBuffer allocates every 200ms | GC pressure |
| 4 | MED | grain.js | Reverse buffer allocated per-grain | GC pressure |
| 5 | MED | grain.js | Seed curves allocated per-grain | GC pressure |
| 6 | MED | grain.js | Candidate trig computed every 10ms tick | CPU hog |
| 7 | LOW | grain.js | Duplicate ensureAudioContext in seed loop | Redundancy |
| 8 | LOW | renderer.js | Duplicate quaternion functions | Dead code |
| 9 | LOW | audio.js/state.js | S.recordingSourceNode never assigned | Dead code |
| 10 | LOW | audio.js/state.js | S.quadBuses legacy alias unused | Dead code |
| 11 | LOW | audio.js | initQuadBuses unnecessary wrapper | Redundancy |
| 12 | LOW | audio.js | Self-import for stopLiveRecording | Redundancy |
| 13 | LOW | events.js | _updateLiveRecUI wrapper | Redundancy |
| 14 | LOW | events/presets/mobile | Triplicated fullscreen logic | Redundancy |
| 15 | MED | renderer.js | Meters redrawn every frame | CPU hog |
| 16 | LOW-MED | renderer.js | Grid trig every frame | CPU waste |
| 17 | LOW | renderer.js | Particle sort every frame | CPU waste |
| 18 | LOW | ui-sensor.js | rAF loop runs when modal closed | CPU waste |
| 19 | LOW | mobile.js | setInterval never cleared | CPU waste |
| 20 | LOW | diag.js | Never imported/initialized | Dead code |
| 21 | LOW | diag.js | References stale S properties | Bug |
| 22 | LOW-MED | grain.js/ui-samples | activeGrains push+filter churn | GC pressure |
| 23 | LOW | state.js/diag.js | null vs undefined override check | Bug |
| 24 | INFO | grain.js | Error swallowing in envelope | Observability |
| 25 | LOW | osc.js | Infinite WebSocket retry | CPU waste |
| 26 | LOW | ui-samples.js | DOM clone + listener accumulation | Memory leak |

---

## TOP 3 PRIORITIES (biggest bang for effort)

1. **Replace ScriptProcessorNode with AudioWorklet** (#1, #2) — Moves recording off the main thread. You already have the worklet pattern from quad-capture. This is the single biggest CPU win.

2. **Cache reverse buffers and seed grain curves** (#4, #5) — Eliminates thousands of per-grain allocations. Pre-compute reversed buffers once per sample. Cache scaled Hann curves per seed.

3. **Spatial indexing or dirty-flag for candidate computation** (#6) — The 10ms trig storm scales linearly with particle count. Even a simple "cursor hasn't moved, particles haven't changed → reuse last pool" dirty flag would eliminate most redundant computation.
