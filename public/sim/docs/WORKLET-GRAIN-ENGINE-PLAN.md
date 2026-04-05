# AudioWorklet Grain Engine — Migration Plan

> Audit and implementation plan for moving mubone's grain engine from main-thread Web Audio node creation to a self-contained AudioWorklet with sample-accurate onset timing.
> Generated 2026-04-04 from codebase v0.17 alpha.

---

## Motivation

The current grain scheduler runs on the JS main thread via `setInterval(20ms)`. It creates AudioBufferSourceNodes and schedules them on the Web Audio timeline using `.start(t)`. This works well above 10ms grain period, but has hard limits:

- **Sub-10ms periods crash** because node-creation overhead + canvas rendering + GC pauses overwhelm the main thread
- **Onset timing is quantized** to ~20ms JS tick resolution for parameter updates (pitch, position, panning baked in at creation time)
- **Comb filtering and pitch effects** at sub-ms periods require sample-accurate grain spacing that the main thread can't provide
- **Canvas rendering directly competes** with grain scheduling for main thread time

Moving the grain engine into an AudioWorklet eliminates all of these: grains are synthesized at sample rate on the audio thread, with zero main-thread dependency during playback.

---

## Related Documentation

- [TIMING-REFERENCE.md](./TIMING-REFERENCE.md) — Full 53-entry reference table of every timing interval, rate, buffer size, and scheduling value in the system. Includes Hz/ms values, how each rate is set, dependency chains, impact types (sonic/visual/structural/perceptual), and rate band categories (audio-rate through recovery-rate).
- [TIMING-AUDIT.md](./TIMING-AUDIT.md) — Efficiency audit with 13 findings on redundant polling, unnecessary wake-ups, unthrottled rAF loops, and optimization opportunities. Several findings (grain scheduler never stops, audio meter rAF uncapped) directly motivate the worklet migration.
- [WORKLET-MIGRATION-AUDIT.md](./WORKLET-MIGRATION-AUDIT.md) — Deep technical audit of every line of `playGrain()`, node creation counts per grain, the complete `scheduleGrains()` flow, DSP reimplementation specifics, SharedArrayBuffer memory layouts with byte offsets, and per-component effort estimates.

**Key timing reference entries for this migration** (by number from TIMING-REFERENCE.md): #2 render quantum (128 samples — the worklet's `process()` block size), #8 scheduler tick (20ms — eliminated by worklet), #9 lookahead (40ms — eliminated), #10 grain period (user param, 10ms floor — floor removed by worklet), #11 onset rate (derived, max 100/sec — uncapped in worklet), #12 polyphony (duration/period, capped at 150 — raised to 256 pool), #15 max grain nodes (150 — replaced by grain pool), #18 particle deposit rate (10/sec — unchanged, stays on main thread), #24 min period floor (10ms — eliminated), #25 safety future floor (2ms — eliminated, sample-accurate onsets replace it).

---

## Current Architecture (what changes)

### Per-grain cost on main thread today

Each `playGrain()` call (grain.js:351–900):

1. Creates AudioBufferSourceNode
2. Creates GainNode (envelope)
3. Optionally creates BiquadFilterNode (LP/HP/BP)
4. Optionally creates per-speaker GainNodes (VBAP, Electron multi-channel)
5. Optionally creates StereoPannerNode (browser stereo)
6. Calls `.connect()` 3–7 times to wire the chain
7. Calls `setValueCurveAtTime()` for attack + release envelope
8. Calls `source.start(t, offset)` and `source.stop(t + dur)`
9. Registers `ended` callback for cleanup (disconnect + decrement counter)

At 100 grains/sec (10ms period), this is 200–500 API calls/sec on the main thread. Below 10ms, the overhead exceeds the period.

### What moves to the worklet

| Component | Current implementation | Worklet replacement |
|---|---|---|
| Onset timing | `setInterval(20ms)` + `audioCtx.currentTime` lookahead | Sample-counting clock inside `process()` |
| Buffer reading | `AudioBufferSourceNode.start(t, offset)` with `playbackRate` | Manual fractional-index interpolation (linear or cubic) |
| Envelope | `GainNode.gain.setValueCurveAtTime(hannCurve)` | Pre-computed Hann/tri/rect table lookup, multiply per sample |
| Pitch shift | `AudioBufferSourceNode.playbackRate` | Variable read-pointer increment (rate = pitch ratio) |
| Filtering | `BiquadFilterNode` (optional) | Manual Direct Form II IIR (6 coefficients per grain) |
| VBAP panning | Per-speaker `GainNode` array | Gain multiply per output channel from LUT |
| Stereo panning | `StereoPannerNode` | Equal-power pan law, 2-channel gain |
| Mixing | Implicit via Web Audio graph connections | Explicit sum of all active grains into output buffer |
| Soft clipping | `WaveShaperNode` with 4096-pt tanh curve | Inline tanh approximation or table lookup |
| Node cleanup | `ended` event → disconnect chain | Return slot to free pool when envelope finishes |

### What stays on main thread

- **Spatial search** (k-nearest particle lookup) — needs cursor position from DOM events, too expensive for per-block computation
- **Particle rendering** — canvas drawing, glow overlays
- **Recording capture** — mic → SharedArrayBuffer (existing worklet handles this, just needs to write to SAB instead of postMessage)
- **UI** — sliders, DOM, event handlers
- **Seed management** — trajectory computation, morph interpolation (Phase 3)

---

## Data Sharing Architecture

### SharedArrayBuffers (3)

**1. Recording ring buffer (~115 MB)**
- Pre-allocated at full recording limit (10 min × 48000 Hz × 4 bytes)
- Main thread writes during recording via atomic write pointer
- Worklet reads behind the write pointer
- Lock-free: single writer (main), single reader (worklet)
- Size: `S.recLimitSeconds × sampleRate × Float32Array.BYTES_PER_ELEMENT`

**2. Parameter block (256 bytes)**
- Fixed-layout Float64Array, 32 slots
- Main thread writes on every scheduler tick (50Hz) or slider change
- Worklet reads at process() rate (375/sec)
- No locks needed — aligned 64-bit writes are atomic on all target architectures
- Layout:
  ```
  [0]  period (seconds)
  [1]  duration (seconds)
  [2]  volume (0–1)
  [3]  pitchShift (rate ratio)
  [4]  pitchJitter (rate offset)
  [5]  durJitter (0–1 ratio)
  [6]  envelopeShape (0=hann, 1=tri, 2=rect)
  [7]  filterType (0=off, 1=LP, 2=HP, 3=BP)
  [8]  filterFreq (Hz)
  [9]  filterQ
  [10] panMode (0=VBAP, 1=stereo)
  [11] stereoPan (-1 to 1)
  [12] cursorLon (radians)
  [13] cursorLat (radians)
  [14] recordingWritePtr (samples)
  [15] recordingLength (samples)
  [16–31] reserved
  ```

**3. Active-grain feedback ring (4 KB)**
- SPSC (single-producer single-consumer) ring buffer
- Worklet writes: `{ particleIndex, onsetSample, duration }` per grain start
- Main thread reads at render rate (30fps) for glow overlay
- 256 entries × 16 bytes = 4 KB
- Lock-free with atomic read/write pointers

### AudioParams (for per-sample smoothing)

- `period` — most-scrubbed parameter, benefits from per-sample interpolation
- `duration` — same
- `volume` — same
- These give automatic linear ramp smoothing between values, preventing zipper noise

### postMessage (infrequent structured data)

- **Candidate particle list** — sent at ~50Hz from main thread after spatial search. Array of `{ particleIndex, bufferOffset, bufferLength }`. Worklet stores latest list and picks from it.
- **VBAP lookup table** — sent once at init, re-sent if speaker layout changes. 360-entry array of gain vectors.
- **Seed configurations** — sent on seed create/destroy/morph. Structured objects with per-seed parameters.
- **Sample buffer registration** — when a new sample is loaded, its Float32Array is transferred to the worklet.

---

## Grain Pool (replaces node creation)

Pre-allocated fixed-size array of grain slots. No allocation during `process()`.

```
struct GrainSlot {
  active: bool
  bufferOffset: float     // start position in recording buffer (samples)
  readPos: float          // current fractional read position
  readRate: float         // pitch ratio (1.0 = original, 2.0 = octave up)
  envelopePhase: float    // 0.0 → 1.0 over grain lifetime
  envelopeInc: float      // phase increment per sample (1.0 / durationSamples)
  envelopeShape: int      // 0=hann, 1=tri, 2=rect
  durationSamples: int    // total grain length
  samplesRemaining: int   // countdown to free
  filterState: float[4]   // biquad Direct Form II state (x1, x2, y1, y2)
  filterCoeffs: float[6]  // b0, b1, b2, a0, a1, a2
  vbapGains: float[N]     // per-channel gain from LUT
  particleIndex: int      // for feedback to renderer
  sourceId: int           // 0=cursor, 1+=seed index
}
```

Pool size: 256 slots (generous, ~50 KB total). Free list as a simple stack (array of free indices + pointer).

---

## Migration Phases

### Phase 1 — Foundation (~3 days)

**Day 1–2: Infrastructure**
- Add COOP/COEP headers:
  - `serve.py`: add `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`
  - Cloudflare Workers `_headers` or wrangler.toml: same headers
  - Electron: already has SharedArrayBuffer access (no headers needed)
- Verify SharedArrayBuffer is available in browser console
- Create `js/worklets/grain-engine.worklet.js` skeleton
- Create `js/grain-worklet-bridge.js` — main-thread interface that manages the worklet node, SharedArrayBuffers, and message passing

**Day 3: Proof of concept**
- Worklet reads from SharedArrayBuffer recording buffer
- Outputs a single repeating grain with hardcoded parameters
- Verify: audio comes out of the worklet, latency is correct, no glitches

### Phase 2 — Cursor grain engine (~4 days)

**Day 4–5: Core DSP**
- Sample-accurate onset clock in process() (count samples, fire grain when counter reaches period threshold)
- Fractional-index buffer reading with linear interpolation
- Hann envelope table (1024-point pre-computed) with phase-based lookup
- Pitch shifting via variable read-pointer increment
- Multi-grain mixing (sum active grains into output)

**Day 6–7: Integration**
- Main thread sends candidate particle list via postMessage at 50Hz
- Worklet picks randomly from candidates (replicating current k-nearest behavior)
- VBAP gain application from lookup table
- Active-grain feedback ring → renderer for glow overlay
- Parameter block updates from sliders
- Wire up A/B toggle: old scheduler vs worklet
- **MILESTONE: cursor grains work with sub-ms precision**

### Phase 3 — Seeds (~5 days)

**Day 8–9: Seed data model**
- Seed parameter blocks (one per active seed, up to 20)
- Independent onset clocks per seed
- Seed candidate lists (separate from cursor candidates)

**Day 10–11: Seed synthesis**
- Seed grains fire from worklet using seed-specific parameters
- Pan smoothing for moving seeds (15ms exponential, manual in worklet)
- Parameter override logic (seed overrides cursor on specific fields)

**Day 12: Morph**
- Seed morph interpolation inside worklet
- Dual-parameter-set blending over time

### Phase 4 — Filters and polish (~4 days)

**Day 13–14: Per-grain filtering**
- Direct Form II biquad implementation
- Coefficient computation for LP/HP/BP from frequency + Q
- Coefficients sent via parameter block, not recomputed in worklet

**Day 15: Edge cases**
- Buffer boundary wrapping for ring buffer reads
- Grain preemption when pool is full (steal oldest grain)
- Pressure throttle equivalent (skip onsets when pool > 75%)
- Soft clipper (tanh approximation or lookup table)

**Day 16: Zero-allocation audit**
- Verify no allocations in process() (use Chrome DevTools memory profiler)
- Pre-allocate all scratch arrays, candidate buffers, output accumulators
- Test with 200+ concurrent grains for 30 minutes — check for memory leaks

### Phase 5 — Integration and testing (~3 days)

**Day 17: A/B testing**
- Same preset, old vs new engine: compare spectrograms
- Test every grain parameter: period, duration, pitch, jitter, envelope, filter
- Test parameter scrubbing responsiveness
- Test sub-10ms periods: 8ms, 5ms, 2ms, 1ms, 0.5ms

**Day 18: Performance profiling**
- Measure process() execution time per 128-sample block
- Target: < 1ms per block at 150 concurrent grains (leaves 1.67ms headroom)
- Profile on target hardware (MacBook Pro, whatever the performance floor is)

**Day 19: Cleanup**
- Remove old scheduler code path (or keep behind feature flag)
- Update TIMING-REFERENCE.md with new timing values
- Update documentation

---

## Risks and Mitigations

### 1. SharedArrayBuffer requires COOP/COEP headers

**Risk**: serve.py and Cloudflare Workers currently set no security headers. Without `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, browsers block SharedArrayBuffer.

**Mitigation**: Mubone has zero cross-origin dependencies (no external scripts, no CDN assets, no iframes). Adding these headers should be safe. Test on all target browsers after adding.

**Fallback**: If headers cause issues, the worklet can use postMessage with Transferable ArrayBuffers instead of SharedArrayBuffer. This adds ~0.1ms latency per message but works without headers. The recording buffer would need a double-buffering scheme.

### 2. Safari compatibility

**Risk**: Safari supports AudioWorklet and SharedArrayBuffer but has historically had quirks with both.

**Mitigation**: Test early (Phase 1). Safari requires the COOP/COEP headers and `crossOriginIsolated` context for SharedArrayBuffer. If Safari worklet has issues, the old scheduler remains as fallback.

### 3. Live recording buffer growth

**Risk**: Currently the recording buffer can grow during live performance. SharedArrayBuffer size is fixed at creation.

**Mitigation**: Pre-allocate the full 115MB (10 min limit) as a ring buffer upfront. The main thread writes with an atomic pointer (`Atomics.store`), the worklet reads behind it. This is actually simpler than the current growth-and-copy approach. Memory cost is fixed and predictable.

### 4. Spatial search can't run in worklet

**Risk**: The k-nearest particle search needs cursor position (from DOM events) and the full particle array. It's O(k × N) and too expensive for the audio thread.

**Mitigation**: Main thread runs spatial search at 50Hz (on the existing scheduler tick) and posts a candidate list to the worklet. The worklet picks from that list. This means spatial selection is quantized to ~20ms, but grain onset timing within those candidates is sample-accurate. The quantization is identical to today — it's only the onset precision that improves.

### 5. No garbage collection in process()

**Risk**: Any allocation in process() (new Array, push, string concat, closures) triggers GC which blocks the audio thread.

**Mitigation**: Pre-allocate everything at construction. Grain pool is a typed array. Candidate list is a fixed-size buffer overwritten each postMessage. Output accumulators are pre-allocated Float32Arrays. Envelope tables are pre-computed. Zero `new` inside process(). Verify with DevTools Allocation Timeline profiler.

### 6. Grain pool sizing

**Risk**: Fixed pool size means a hard concurrent-grain limit. If a future feature needs more than 256 voices, the pool can't grow without restarting the worklet.

**Mitigation**: 256 slots at ~200 bytes each = ~50 KB. Generous for the current use case (typical max is 50–80 concurrent). Can increase to 512 (100 KB) at negligible cost. If truly exceeded, the oldest grain gets stolen — same behavior as the current node cap but smoother (fade-out the stolen grain over 128 samples instead of abrupt disconnect).

### 7. Seed complexity

**Risk**: Seeds have independent scheduling, spatial trajectories, morph interpolation, and parameter overrides. This is ~400 lines of specialized logic that must be ported correctly.

**Mitigation**: Phase 3 is dedicated entirely to seeds. Cursor grains ship first (Phase 2) as an independent milestone. Seeds can remain on the old scheduler as a hybrid during transition — different timing precision, but seeds typically use longer periods where sub-ms doesn't matter. Full seed port can be deferred if needed.

### 8. Thread safety on recording buffer

**Risk**: Main thread writes to the recording SharedArrayBuffer while the worklet reads from it. Without proper synchronization, the worklet could read partially-written data.

**Mitigation**: Single-writer single-reader with atomic write pointer. Main thread writes samples sequentially, then atomically updates the write pointer. Worklet only reads up to the last committed pointer value. Since writes are sequential Float32s and the pointer update is atomic, no partial reads are possible. This is a standard lock-free SPSC pattern.

### 9. Parameter update latency

**Risk**: Parameters written to the SharedArrayBuffer are read by the worklet on the next process() call (up to 2.67ms later). For the most-scrubbed parameters, this could feel less responsive than the current AudioParam smoothing on native nodes.

**Mitigation**: Use actual AudioParams (registered in `parameterDescriptors`) for period, duration, and volume. These give per-sample linear interpolation for free. Less-scrubbed params (filter freq, envelope shape, jitter) go in the SharedArrayBuffer and update every 2.67ms — imperceptible.

---

## Expected Outcome

After full migration:

| Metric | Current | After worklet |
|---|---|---|
| Min grain period | 10 ms (crashes below) | < 0.1 ms (sample-accurate) |
| Onset timing precision | ~2ms (JS safety floor) | 1 sample (0.021 ms @ 48kHz) |
| Parameter update latency | ~20ms (scheduler tick) | 2.67ms (process block) or per-sample (AudioParam) |
| Max concurrent grains | 150 (node cap) | 256 (pool size, adjustable) |
| Main thread audio cost | 200–500 API calls/sec | ~0 (only postMessage at 50Hz) |
| Canvas rendering impact on audio | Direct (shared main thread) | Zero (separate threads) |
| Audio graph complexity | 150× node chains | 1 worklet node → outputs |
| Works in browser + Electron | Yes | Yes (same code) |
