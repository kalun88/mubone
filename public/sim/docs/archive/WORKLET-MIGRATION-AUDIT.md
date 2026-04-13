# Grain Engine → AudioWorklet Migration Audit

> Deep architectural analysis for moving mubone's grain scheduler and synthesis engine from the main thread into an AudioWorklet. Generated 2026-04-04 from codebase v0.17 alpha.

---

## 1. What Currently Happens on the Main Thread

### The complete grain path: scheduler tick → grain playing → grain end

**Phase 1 — Scheduler tick fires** (`scheduleGrains()`, grain.js:1034)

Every 20ms via `setInterval`, the scheduler:
1. Calls `updateFusedCamQ()` to refresh camera quaternion for headlocked panning
2. Prunes expired entries from `activeGrainMap` (performance.now()-based expiry check)
3. Guards against grain overflow — returns if `S._grainSourceCount >= MAX_GRAIN_NODES (150)`
4. Calls `ensureAudioContext()`, resumes if suspended
5. Samples `audioNow = actx.currentTime` — **once per tick, shared by all scheduling**
6. Computes `scheduleUntil = audioNow + SCHED_LOOKAHEAD (0.040s)`

**Phase 2 — Cursor grain scheduling** (grain.js:1083–1263)

1. Reads cursor position via `getCursorLonLat()` or `screenToLonLat()`
2. Reads effective k, search radius from overrides/preset
3. Stamps angular distances from cursor to all particles (cached, dirty-checked against cursor movement and particle version)
4. Builds candidate pool: either k-nearest (O(N) partial sort) or radius-filtered (O(N) scan)
5. Computes per-tick grain budget: `min(grainsNeeded, nodesBudget, pressureCap)`
6. Enters while loop: `while (_cursorNextOnsetT < scheduleUntil && iterations < budget)`
   - Snap guard: if onset < audioNow → snap to audioNow + 5ms
   - Select particle (sequential index or random from pool)
   - Probability gate: skip if `Math.random() > S.grainProbability`
   - Compute radius fade attenuation
   - Call `playGrain(particle, null, _cursorNextOnsetT)`
   - Add to `activeGrainMap` with expiry timestamp and white glow color
   - Advance onset clock: `_cursorNextOnsetT += nextPeriod`

**Phase 3 — Seed grain scheduling** (grain.js:1370–1622)

Per seed (up to 16):
1. Advance moving seed playhead, interpolate frame
2. Compute focus/collage navigation weight
3. Compute seed envelope gain (attack/sustain/release)
4. Stamp angular distances from seed center to all particles (incremental cache for stationary seeds)
5. Build candidate pool (same algorithms as cursor)
6. Enter while loop similar to cursor, but with `seed._nextOnsetT` and seed-specific budget
7. Call `playGrain(particle, seedGrainOverrides, seed._nextOnsetT)` — the non-null customParams triggers the seed path
8. Add to `activeGrainMap` with seed color

**Phase 4 — playGrain()** (grain.js:351–935)

This is where ALL Web Audio API calls happen. Per grain:

1. **Buffer resolution** (351–367): Look up AudioBuffer from sample or live recording
2. **Effective params** (369–404): Build merged params from preset + overrides. Cursor reuses module-level `_cursorEP` object (zero-alloc). Seeds use passed `customParams`.
3. **Onset anchoring** (406–430): `t = max(scheduledOnsetT, actx.currentTime + 0.002)`
4. **Envelope curves** (432–452): Use pre-built Hann Float32Array(128). Seeds cache volume-scaled curves on the params object.
5. **Pitch calculation** (481–482): `pitchRate = 2^(pitchShift/1200) × (1 + pitchJitter)^rand(-1,1)`
6. **Duration + jitter** (485–489): `dur = baseDuration × (1 ± durJitter) + rand(±durVar)`
7. **Start position clamping** (491–504): Prevent buffer overrun accounting for pitch rate
8. **NODE CREATION** — this is the expensive part:

| Node | API Call | Line | Condition |
|------|----------|------|-----------|
| BufferSource | `actx.createBufferSource()` | 562 | Always |
| GainNode (envelope) | `actx.createGain()` | 586 | Always |
| BiquadFilter (HPF) | `actx.createBiquadFilter()` | ~710 | If HPF > 22 Hz |
| BiquadFilter (LPF) | `actx.createBiquadFilter()` | ~725 | If LPF < 19500 Hz |
| GainNode (elevation) | `actx.createGain()` | ~695 | If elevation attenuation < 0.98 |
| GainNode × 2 (VBAP) | `actx.createGain()` | 832–833 | Multi-channel mode |
| StereoPannerNode | `actx.createStereoPanner()` | ~878 | Stereo mode, pan ≠ 0 |
| GainNode × 2 (mixdown) | `actx.createGain()` | ~753–754 | Cursor + mixdown enabled |

**Typical node count per grain**: 2–5 nodes (source + envelope gain + 0–3 conditional nodes)

9. **Automation scheduling**:
   - `gain.gain.setValueCurveAtTime(attackCurve, t, fadeDur)` — Hann attack
   - `gain.gain.setValueCurveAtTime(releaseCurve, t + dur - fadeDur, fadeDur)` — Hann release
   - Fallback: 3× `linearRampToValueAtTime()` if curve scheduling throws

10. **Connect chain**: `source → [HPF] → [LPF] → gain → [elevGain] → lastNode → speakerBus/panner → bus`

11. **Start/stop**: `source.start(t, bufferStartPos)` + `source.stop(t + sourceDur)`

12. **Increment**: `S._grainSourceCount++`

**Phase 5 — Grain end** (source 'ended' event callback)

```javascript
source.addEventListener('ended', () => {
  S._grainSourceCount--;
  _deferDisconnect(source);
  _deferDisconnect(gain);
  // ... disconnect all conditional nodes
}, { once: true });
```

All nodes are disconnected immediately (try/catch) in the ended callback. No batching — Chrome fixed the bulk-disconnect crash.

### Summary: main-thread operations per grain

| Operation | Count | Allocates? |
|-----------|-------|-----------|
| `create*()` calls | 2–5 | Yes (audio nodes) |
| `.connect()` calls | 3–7 | No |
| `setValueCurveAtTime()` | 2 | No (pre-built curves) |
| `.start()` / `.stop()` | 2 | No |
| `addEventListener('ended')` | 1 | Yes (closure) |
| Math (pitch, dur, position, VBAP) | ~20 ops | No (scratch buffers) |
| Spatial transform (sphere→camera) | 1 | No (into scratch array) |
| VBAP lookup | 1 | No (O(1) table read) |
| Angular distance (per candidate) | O(N) | No (stamps in-place) |

---

## 2. What Can and Can't Run Inside an AudioWorklet

### AudioWorklet process() CAN:
- Read/write Float32Array input/output buffers
- Use SharedArrayBuffer and Atomics
- Receive messages via `this.port.onmessage`
- Read AudioParam values (k-rate or a-rate)
- Do arbitrary math, including trig, table lookups, array indexing
- Maintain internal state between calls

### AudioWorklet process() CANNOT:
- Create Web Audio nodes (`createBufferSource`, `createGain`, etc.)
- Call `.connect()` or `.disconnect()`
- Access the DOM
- Use `setTimeout` / `setInterval` / `requestAnimationFrame`
- Access `AudioContext` or `audioCtx.currentTime` (but `currentTime` is available as a readonly property on `AudioWorkletGlobalScope`)
- Use `performance.now()` (but `currentTime` serves the same purpose)
- Grow SharedArrayBuffers (fixed size at creation)

### What maps cleanly to worklet-compatible operations:

| Current Operation | Worklet-Compatible? | Notes |
|-------------------|-------------------|-------|
| Onset timing / clock advance | **Yes** — use `currentFrame` counter | Sample-accurate, no jitter |
| Grain period with jitter | **Yes** — frame-level arithmetic | Better than setTimeout precision |
| Buffer reading at arbitrary offset | **Yes** — direct Float32Array indexing | Core worklet operation |
| Pitch shifting (variable-rate playback) | **Yes** — fractional-index interpolation | Must implement manually |
| Hann envelope application | **Yes** — multiply samples by curve | Trivial per-sample multiply |
| VBAP gain computation | **Yes** — table lookup + multiply | Copy LUT into worklet memory |
| Grain mixing (summing) | **Yes** — sum into output channels | Core worklet operation |
| Angular distance / k-nearest search | **Partially** — expensive, O(N) per grain | Better done on main thread |
| Filter (HPF/LPF) | **Yes** — biquad is ~6 multiplies/sample | Must implement manually |
| Random number generation | **Yes** — use xorshift or similar | No Math.random() issues |

### What MUST be reimplemented as raw DSP:

Everything currently delegated to Web Audio nodes becomes manual sample processing.

---

## 3. Specific Reimplementations Required Inside the Worklet

### 3a. Grain onset timing

**Current**: `setInterval(20ms)` → pre-schedule with `source.start(audioNow + offset)`

**Worklet**: The worklet's `process()` fires every 128 samples (2.67ms at 48kHz). Maintain a frame counter. Each `process()` call, check if any grain onsets fall within the current 128-sample block. For each onset, begin reading from the source buffer at the correct sub-block offset.

```
// Pseudocode
onsetFrame = nextOnsetTime * sampleRate
if (currentFrame <= onsetFrame < currentFrame + 128) {
  startSample = onsetFrame - currentFrame  // 0–127 offset within this block
  activateGrain(startSample, ...)
}
```

**Precision**: Exact to the sample — better than the current 2ms safety floor. No scheduler drift, no snap guards needed.

**Complexity**: Medium. The onset clock is simple arithmetic, but managing multiple concurrent grains with different start offsets within a single 128-sample block requires a grain pool with per-grain frame counters.

### 3b. Envelope application

**Current**: `setValueCurveAtTime(hannCurve, t, fadeDur)` on a GainNode

**Worklet**: Multiply each output sample by the envelope value. The Hann curve is a Float32Array(128) — interpolate into it based on the grain's current phase.

```
// Per sample within a grain:
if (grainSampleIndex < attackSamples) {
  env = hannAttack[Math.floor(grainSampleIndex / attackSamples * 128)]
} else if (grainSampleIndex > totalSamples - releaseSamples) {
  phase = (grainSampleIndex - (totalSamples - releaseSamples)) / releaseSamples
  env = hannRelease[Math.floor(phase * 128)]
} else {
  env = volume  // sustain
}
output[i] *= env
```

**Complexity**: Low. Per-sample multiply with table lookup. Support hann/tri/rect curve types.

### 3c. Pitch shifting (variable-rate playback)

**Current**: `source.playbackRate.value = pitchRate` on AudioBufferSourceNode

**Worklet**: Fractional-index buffer reading with interpolation. For each output sample, advance a read cursor by `pitchRate` samples and interpolate.

```
// Per output sample:
readPos += pitchRate
intPos = Math.floor(readPos)
frac = readPos - intPos
sample = buffer[intPos] * (1 - frac) + buffer[intPos + 1] * frac  // linear interp
```

Linear interpolation is adequate for most musical pitchRate values (0.5–2.0). For extreme pitch shifts, cubic interpolation would reduce aliasing but costs 4 multiplies vs 2.

**Complexity**: Medium. The core is simple, but reverse playback, crop boundaries, and the 10ms silent tail all need handling.

### 3d. VBAP panning

**Current**: 2 GainNodes per grain, weights from `_vbapLUT[degree]`

**Worklet**: The worklet outputs N channels (one per speaker). For each grain, multiply by wA and wB and sum into the correct output channels.

```
// Per sample of an active grain:
output[idxA][i] += sample * wA * elevScale
output[idxB][i] += sample * wB * elevScale
```

The VBAP lookup table (360 entries × 4 values each = 1440 floats) fits easily in worklet memory.

**Complexity**: Low. Table lookup is already O(1). Elevation center-bias blending is a few extra multiplies.

### 3e. Grain mixing

**Current**: Implicit — Web Audio sums all connected nodes at each bus

**Worklet**: Explicit summing. Each output channel starts at 0 each block. Each active grain adds its contribution.

```
// Per process() call:
for (ch = 0; ch < numChannels; ch++) output[ch].fill(0)
for each activeGrain:
  for (i = 0; i < 128; i++):
    sample = readGrainSample(grain, i) * envelope(grain, i)
    output[grain.speakerA][i] += sample * grain.wA
    output[grain.speakerB][i] += sample * grain.wB
```

**Complexity**: Low, but the inner loop must be tight — this is the hot path. At 50 concurrent grains × 128 samples = 6400 iterations per block.

### 3f. Buffer reading with variable start position and duration

**Current**: `source.buffer = audioBuffer; source.start(t, startPos)`

**Worklet**: Copy the raw Float32Array of each audio buffer into worklet-accessible memory (SharedArrayBuffer or transferred copy). Each grain tracks its read position as a float (for pitch shifting) and advances it each sample.

**Complexity**: Medium. The buffer data transfer is the hard part — see section 4.

### 3g. Biquad filtering (HPF/LPF)

**Current**: `createBiquadFilter()` with type, frequency, Q

**Worklet**: Standard biquad difference equation — 2 multiplies for feed-forward, 2 for feedback, per sample. Each grain with filtering needs its own 4-float state (x1, x2, y1, y2).

```
// Standard biquad: y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
```

Coefficients computed from frequency, Q, and sample rate using the Audio EQ Cookbook formulas. Compute once per grain at onset, store with grain state.

**Complexity**: Low per grain. The coefficient computation is ~20 trig ops once per grain onset.

---

## 4. Data Sharing Between Main Thread and Worklet

### 4a. Audio buffers (~115MB worst case)

**The problem**: The recorded audio buffer (`S.recordingRaw`) can reach 115MB at 10min × 48kHz. Sample buffers add more. The worklet needs read access to all of this.

**Options**:

1. **SharedArrayBuffer** — both threads see the same memory. Main thread writes new samples during recording; worklet reads from any offset. Requires COOP/COEP headers (see section 8).

2. **Transfer via postMessage** — copy the buffer on each update. At 23.4 messages/sec during recording (2048 samples each), this is ~180KB/sec — tolerable. But the worklet needs the entire buffer for random-access grain reading, not just new chunks.

3. **Hybrid**: SharedArrayBuffer for the main recording buffer (pre-allocated at max size). postMessage for sample file buffers (transferred once on load).

**Recommendation**: SharedArrayBuffer for the live recording ring. Transfer sample buffers once on load.

### 4b. Particle positions and metadata (for spatial search)

**Size**: Up to ~5000 particles × ~40 bytes each = ~200KB

**What the worklet needs per grain**: A particle's `grainStart` (buffer offset), `lon`, `lat`, and `source` (which buffer). It does NOT need to do the spatial search itself — that's O(N) per grain and involves cursor position from IMU/mouse.

**Recommendation**: Main thread does spatial search, posts candidate lists to worklet. The worklet receives a compact array of `[grainStart, lon, lat, bufferIndex]` tuples for the current candidate pool, refreshed each scheduler tick (~50Hz). This is tiny: 50 candidates × 16 bytes = 800 bytes per message.

### 4c. Current cursor/IMU position

The worklet doesn't need raw cursor position if the main thread pre-computes candidates. But for VBAP panning, the worklet needs the camera quaternion or the pre-computed camera-space coordinates of each grain's particle.

**Recommendation**: Include camera-space (cx, cy, cz) in the candidate data, or send the fused camera quaternion via SharedArrayBuffer (4 floats, updated at 50Hz by IMU).

### 4d. Grain parameters

~20 float values (period, duration, pitch, jitter, volume, etc.) that change when the user moves a slider.

**Options**:
- **AudioParam**: Clean API, supports a-rate and k-rate. Define custom AudioParams on the worklet node. Main thread sets `.value` — changes propagate lock-free. Limited to ~30 params per node (browser-dependent).
- **SharedArrayBuffer**: A single Float64Array of ~32 slots. Main thread writes, worklet reads. No locking needed for single-writer/single-reader of aligned floats.
- **postMessage**: Send on slider change. Latency of one process() block (~2.67ms) is inaudible.

**Recommendation**: AudioParam for the most-scrubbed parameters (period, duration, volume, pitch). SharedArrayBuffer Float64Array for the rest (search params, filter settings, flags). postMessage for infrequent changes (curve type, direction, probability).

### 4e. VBAP lookup table

360 entries × 4 values = 1440 floats. Changes only when speaker layout changes (rare).

**Recommendation**: Transfer once via postMessage on speaker config change. Copy into worklet-local array.

### 4f. Active grain feedback (worklet → main thread)

The renderer needs to know which particles are currently sounding (for glow overlay). Currently `activeGrainMap` is a Map on the main thread.

**Options**:
1. **SharedArrayBuffer ring**: Worklet writes `[particleIndex, expiryFrame, colorCode]` into a lock-free ring buffer. Main thread reads at 30fps.
2. **postMessage**: Worklet posts a list of active grain particle indices each block (375 messages/sec is too many) or batched every N blocks.

**Recommendation**: SharedArrayBuffer ring buffer. Worklet writes on grain onset; main thread scans at render rate (30fps). Ring size: 256 entries × 12 bytes = 3KB.

---

## 5. SharedArrayBuffer / Atomics Architecture

### Memory layout

```
SharedArrayBuffer #1: "Recording Ring" (pre-allocated at max recording size)
  ┌─────────────────────────────────────────────┐
  │ Float32Array: 48000 × 600 = 28.8M floats    │  ~115 MB
  │ Main thread: WRITES new samples continuously │
  │ Worklet: READS at arbitrary offsets          │
  └─────────────────────────────────────────────┘
  + Atomics.store/load for write cursor position (Int32Array view, 1 slot)

SharedArrayBuffer #2: "Parameters" (small, fixed)
  ┌──────────────────────────────────────────────┐
  │ Float64Array[32]: grain params               │  256 bytes
  │ Main thread: WRITES on slider change         │
  │ Worklet: READS each process() block          │
  └──────────────────────────────────────────────┘
  Slots: [0] period, [1] duration, [2] volume, [3] pitchShift,
         [4] pitchJitter, [5] durJitter, [6] durVar, [7] fadeRatio,
         [8] periodVar, [9] panSpread, [10] probability,
         [11] hpfFreq, [12] lpfFreq, [13] filterQ, [14] filterFreqJitter,
         [15] grainDirection, [16] curveType, [17] radiusFadeEnabled,
         [18] radiusFadeCurve, [19] searchRadiusDeg,
         [20-23] cameraQuaternion (w,x,y,z), [24] recordingWriteCursor,
         [25] scanMuted, [26-31] reserved

SharedArrayBuffer #3: "Active Grain Feedback Ring" (worklet → main)
  ┌──────────────────────────────────────────────┐
  │ Int32Array[1]: write cursor                  │
  │ Int32Array[1]: read cursor                   │
  │ Float32Array[256 × 3]: entries               │  3 KB
  │ Worklet: WRITES on grain onset               │
  │ Main thread: READS at 30fps for glow render  │
  └──────────────────────────────────────────────┘
  Each entry: [particleIndex, expiryFrame, colorCode]
```

### What goes via AudioParam

Best for continuously-scrubbed values where you want the Web Audio engine to handle interpolation:

- `period` — scrubbed frequently
- `duration` — scrubbed frequently
- `volume` — scrubbed frequently, benefits from a-rate smoothing
- `pitchShift` — scrubbed via slider or MIDI CC

### What goes via postMessage

Infrequent, structured data:

- Candidate particle lists (50Hz from main thread spatial search)
- VBAP lookup table (on speaker config change)
- Sample buffer transfers (on sample load — Transferable)
- Curve type / direction changes (rare)
- Seed grain parameter sets (on seed drop/update)
- Recording buffer segment notifications (on live recording start/stop)

### How the main thread sends parameter updates without blocking

For SharedArrayBuffer params: plain `Float64Array` writes are atomic on aligned 64-bit values in practice (spec guarantees atomicity for `Atomics.store` on Int32/BigInt64). For the parameter block, we use `Atomics.store` for the write cursor and plain writes for float params (single-writer, torn reads are harmless — a briefly stale param value is inaudible).

For AudioParam: `.value = x` or `.setValueAtTime(x, t)` — these are lock-free by Web Audio spec.

For postMessage: non-blocking, queued. The worklet processes messages between `process()` calls.

### How the worklet signals active grains back

Lock-free SPSC (single-producer single-consumer) ring buffer in SharedArrayBuffer #3:
- Worklet advances write cursor with `Atomics.store(cursors, 0, newWritePos)`
- Main thread reads with `Atomics.load(cursors, 0)`, processes entries up to write cursor
- No locking needed — classic SPSC ring pattern

---

## 6. What Stays on the Main Thread

| Responsibility | Why it stays | Communication to worklet |
|---------------|-------------|-------------------------|
| **Particle rendering** (drawParticles, 30fps) | Canvas API is DOM-only | Reads active grain feedback ring |
| **Spatial search** (k-nearest / radius) | O(N) per grain, needs cursor position from DOM events | Posts candidate lists at 50Hz |
| **Input handling** (mouse, touch, IMU) | DOM events | Updates cursor position → spatial search → candidates |
| **Recording capture** (mic → buffer) | getUserMedia is main-thread; existing worklet writes to SharedArrayBuffer | Atomics write cursor update |
| **UI updates** (sliders, meters, HUD) | DOM | Reads worklet feedback for voice count |
| **Seed management** (drop, move, delete) | User interaction + renderer | Posts seed configs to worklet |
| **Preset/parameter changes** | UI events | SharedArrayBuffer params + postMessage |
| **VBAP table rebuild** | Infrequent, triggered by speaker config | postMessage transfer |

### New division of labor

**Main thread** (unchanged complexity):
- 50Hz: Run spatial search, post candidate lists
- 30fps: Render particles, seeds, cursor, trails, glow overlay
- Event-driven: Parameter updates, preset recall, seed management
- Continuous: Recording capture (existing worklet)

**Audio worklet** (new):
- 375Hz (per process() block): Schedule grain onsets, read buffers, apply envelopes, pitch-shift, filter, VBAP pan, mix to output channels
- This is the ENTIRE grain synthesis engine — all DSP

---

## 7. Migration Path

### Phase 0: Proof of concept (1–2 days)

**Minimum viable worklet**: A worklet that plays a single grain from a pre-loaded buffer with a Hann envelope, at a fixed pitch, mixed to stereo output.

- Hardcoded buffer (transferred once)
- Hardcoded grain parameters
- Single grain at a time (no polyphony yet)
- No spatial search, no VBAP
- Triggered by postMessage

**Proves**: Buffer access works, envelope sounds correct, timing is sample-accurate.

### Phase 1: Polyphonic grain pool (2–3 days)

- Fixed-size grain pool (e.g. 64 grain slots, each with read position, envelope phase, pitch rate, speaker gains)
- Onset scheduling from frame counter
- Period/duration parameters via AudioParam
- Stereo panning (simple left/right, no VBAP yet)
- No pitch shifting yet (playbackRate = 1.0)

**Proves**: Concurrent grain mixing works without glitches at target polyphony.

### Phase 2: Full grain synthesis (3–5 days)

- Pitch shifting with linear interpolation
- Hann/tri/rect envelope types
- Duration jitter, period jitter
- Biquad HPF/LPF per grain
- Reverse playback
- Elevation attenuation
- VBAP multi-channel output (transfer LUT, output N channels)

### Phase 3: Main thread integration (2–3 days)

- Spatial search on main thread, candidate posting at 50Hz
- SharedArrayBuffer for recording buffer (live recording while worklet reads)
- Active grain feedback ring for renderer glow
- Parameter bridge (AudioParam + SharedArrayBuffer + postMessage)
- Seed grain scheduling (seed configs posted to worklet)

### Phase 4: A/B testing and cutover (1–2 days)

- Runtime toggle: `S.useWorkletGrainEngine = true/false`
- Old scheduler path untouched, new worklet path parallel
- Compare: scheduler drift, audio quality, CPU usage, parameter responsiveness
- Measure: max sustainable grain rate, polyphony ceiling, latency

### Phase 5: Cleanup (1–2 days)

- Remove old `playGrain()` and node-creation path
- Remove `S._grainSourceCount` (worklet manages its own pool)
- Simplify audio graph (no per-grain nodes, just worklet → speakers)
- Update TIMING-REFERENCE.md — many timing values become irrelevant (no more setInterval scheduler, no more snap guards, no more 2ms safety floor)

**Total estimated timeline: 10–16 days**

### A/B testing strategy

Keep both paths simultaneously:
```javascript
if (S.useWorkletGrainEngine) {
  // Post candidates to worklet — it handles scheduling + synthesis
  workletNode.port.postMessage({ type: 'candidates', data: candidateList });
} else {
  // Old path: scheduleGrains() → playGrain() → Web Audio nodes
  scheduleGrains();
}
```

The worklet node's outputs connect to the same speaker buses / master bus. Toggle is instantaneous — no audio graph rebuild needed.

---

## 8. Potential Issues and Risks

### 8a. SharedArrayBuffer requires COOP/COEP headers

**Current state**: `serve.py` is a bare `SimpleHTTPRequestHandler` with no custom headers. Cloudflare Workers deployment (mubone.org/sim) also has no COOP/COEP headers set.

**Required headers**:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**Impact**: These headers break cross-origin resources (fonts, CDN scripts, iframes) unless they also set `Cross-Origin-Resource-Policy: cross-origin`. Mubone has no external dependencies (no CDN, no iframes, no cross-origin fonts), so this should be safe.

**Fix for local dev**: Subclass `SimpleHTTPRequestHandler` in serve.py to add headers.

**Fix for Cloudflare Workers**: Add headers in the worker script or `_headers` file.

**Fix for Electron**: Electron supports SharedArrayBuffer by default (same-origin context).

**Risk level**: Low — straightforward header addition with no cross-origin dependencies to break.

### 8b. Safari SharedArrayBuffer support

Safari has supported SharedArrayBuffer since Safari 15.2 (Dec 2021) with COOP/COEP headers. However:

- Safari's AudioWorklet implementation has historically had bugs (fixed in recent versions)
- Safari requires the same COOP/COEP headers as Chrome
- `Atomics.waitAsync` is NOT supported in Safari (but we don't need it — polling is fine)

**Risk level**: Medium. Test on Safari early in Phase 1.

### 8c. Memory management — worklet can't grow buffers

SharedArrayBuffers are fixed-size at creation. The recording buffer can grow (currently doubles from 5min to 10min on overflow).

**Solution**: Pre-allocate the SharedArrayBuffer at the maximum recording limit (`REC_LIMIT_SECONDS_DEFAULT × sampleRate × 4 bytes`). At 600s × 48000Hz = ~115MB. This is the same memory the current system eventually uses — we just allocate it upfront.

**Alternative**: Allocate in segments (e.g. 1-minute chunks). Main thread posts new segment SABs to the worklet as recording extends. Worklet maintains a list of segments. More complex but avoids the upfront 115MB allocation on mobile.

**Risk level**: Medium. The upfront allocation may cause issues on 8GB student laptops. Segmented approach is safer but adds complexity.

### 8d. Garbage collection in the worklet

The worklet's `process()` must NEVER allocate. This means:

- No `new Float32Array()`, no `new Object()`, no array literals
- Pre-allocate all grain state slots at worklet construction
- Use fixed-size typed arrays for everything
- PRNG state as module-level variables (no closure allocations)

The existing mubone worklets (recording-capture, quad-capture, input-meter) already follow this pattern — good precedent.

**Risk level**: Low if we follow the existing zero-alloc patterns.

### 8e. Spatial search (k-nearest) — worklet or main thread?

**Analysis**: The spatial search is O(N) where N = particle count (up to ~5000). It involves:
- Computing angular distance from cursor to each particle (trig: `acos(sin×sin + cos×cos×cos(Δlon))`)
- Partial sort to find k smallest
- Radius filtering

At 100 grains/sec (10ms period), doing this per grain in the worklet would be 500K trig operations/sec. That's likely too expensive for the audio thread.

**Recommendation**: Main thread computes candidates at 50Hz (matching current scheduler tick rate). Posts a compact candidate list to the worklet. The worklet picks from the pre-computed list.

**Fallback**: If 50Hz candidate updates create audible "stepping" when the cursor moves quickly, increase to 100Hz (still cheap on main thread) or interpolate candidate weights in the worklet.

**Risk level**: Low — this is the same work the main thread already does.

### 8f. Seed scheduling

Seeds have their own scheduling logic: independent onset clocks, moving playheads with frame interpolation, navigation weights (focus/collage), envelope gains, per-seed grainOverrides.

**In the worklet**: Each seed needs its own onset clock, parameter set, and candidate list. The main thread posts seed configurations and updated candidate lists. The worklet maintains up to 16 seed slots with independent state.

**Complexity**: High. Seeds are the most complex part of the scheduler. Recommend implementing cursor-only grains first (Phases 0–2), then adding seeds in Phase 3.

### 8g. Thread safety on shared audio buffer during live recording

**Scenario**: Main thread's recording-capture worklet writes new samples to SharedArrayBuffer. Grain worklet reads from it simultaneously.

**Safety**: Single-writer (recording worklet) + single-reader (grain worklet) on a Float32Array is safe without locking IF:
- Writer updates write cursor AFTER writing samples (store-release pattern)
- Reader reads write cursor BEFORE reading samples (load-acquire pattern)
- Reader never reads past write cursor

**Implementation**: Use `Atomics.store` for the write cursor in the recording-capture worklet. Use `Atomics.load` in the grain worklet to get the safe-to-read boundary.

**Complication**: The recording-capture worklet currently runs on the main thread (it's an AudioWorkletNode but posts to the main thread via postMessage, and the main thread writes to `S.recordingRaw`). To share a SAB directly between two worklets, the recording worklet would need to write to the SAB directly instead of posting to main thread.

**Risk level**: Medium. Requires modifying the recording-capture worklet to write to SAB.

### 8h. What about looper sequences?

The current `scheduleGrains()` also manages looper playback (grain.js:1629–1858) — committed loops that play back as AudioBufferSourceNodes with dynamic VBAP panning. Loopers use `source.loop = true` and update pan positions each tick via `setTargetAtTime`.

**In the worklet**: Loopers would become another type of "grain" — a continuously-playing buffer reader with dynamic pan that doesn't re-trigger. This is architecturally different from one-shot grains.

**Recommendation**: Keep loopers on the main thread initially (they're low-count, max ~8 committed loops). Migrate in a later phase if needed.

---

## 9. Complexity Estimates

| Piece | Effort | Risk | Notes |
|-------|--------|------|-------|
| **Basic grain playback in worklet** | 2 days | Low | Buffer read + envelope + stereo out |
| **Polyphonic grain pool** | 2 days | Low | Fixed-size slot array, onset scheduling |
| **Pitch shifting (linear interp)** | 1 day | Low | Fractional index, boundary handling |
| **Hann/tri/rect envelopes** | 0.5 days | Low | Table lookup, per-sample multiply |
| **Biquad HPF/LPF** | 1 day | Low | Cookbook coefficients, per-grain state |
| **VBAP multi-channel output** | 1 day | Low | LUT transfer, N-channel process() |
| **Reverse playback** | 0.5 days | Low | Negative read cursor advance |
| **SharedArrayBuffer recording ring** | 2 days | Medium | COOP/COEP headers, recording worklet mod |
| **Parameter bridge (SAB + AudioParam)** | 1 day | Low | Fixed layout, main thread writes |
| **Candidate posting from main thread** | 1 day | Low | Compact array, 50Hz postMessage |
| **Active grain feedback ring** | 1 day | Low | SPSC ring buffer, renderer reads |
| **Seed scheduling in worklet** | 3 days | High | 16 independent clocks, moving playheads, nav weights |
| **Looper migration** | 2 days | Medium | Continuous playback, dynamic pan |
| **A/B toggle infrastructure** | 0.5 days | Low | Parallel paths, shared output buses |
| **COOP/COEP deployment** | 0.5 days | Low | serve.py + Cloudflare Workers headers |
| **Safari/cross-browser testing** | 1 day | Medium | AudioWorklet quirks |
| **Performance profiling** | 1 day | Low | Compare CPU, latency, max grain rate |

**Total: ~19 days** (with buffer for debugging and edge cases)

### What you gain

1. **Sample-accurate grain timing** — no more 2ms safety floor, no snap guards, no scheduler drift
2. **No main-thread audio jitter** — canvas rendering can't starve grain scheduling
3. **Higher grain density** — sub-10ms periods become feasible (the entire point of #114)
4. **Simpler audio graph** — one worklet node replaces 150× (2–5 node chains)
5. **Lower GC pressure** — no per-grain node allocation / closure allocation
6. **Deterministic performance** — worklet has dedicated thread, predictable budget per block

### What you lose

1. **Web Audio filter quality** — manual biquad vs Chrome's optimized native BiquadFilterNode
2. **Debugging ease** — can't inspect worklet state in DevTools the same way
3. **Browser compatibility margin** — AudioWorklet + SAB requires modern browsers + correct headers
4. **Code simplicity** — the current approach is "just create nodes and connect them"; the worklet approach requires manual DSP for everything
