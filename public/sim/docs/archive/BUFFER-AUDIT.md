# Buffer Size Audit — mubone

> **Status: ARCHIVED / HISTORICAL.** This plan or audit is complete — kept as the record of what was decided, what changed, and how to revert it. **It does not describe current behaviour** and may use superseded terminology. Do not use it to learn how the system works today; read the reference docs listed in CLAUDE.md instead.

**Date:** 2026-04-04
**Scope:** Every buffer allocation in the codebase, from mic input to speaker output, including all side-chains.

---

## Signal Chain Overview

```
MIC INPUT PATH (Browser):
  getUserMedia → inputGainNode → inputAnalyser (fft=256)
                              → recording-capture worklet (batch=16×128=2048)
                                  → postMessage → S.recordingRaw (Float32Array, 5min pre-alloc)
                                  → stopLiveRecording() → AudioBuffer (final)

MIC INPUT PATH (Electron):
  RtAudio input callback (1024 frames) → IPC 'audio-input-buffer'
    → input-meter worklet (ring=32K+, de-interleave) → per-ch AnalyserNode (fft=256)

GRAIN PLAYBACK PATH (Browser stereo):
  AudioBuffer slice → BufferSource → GainNode (envelope)
    → [optional HPF/LPF BiquadFilter]
    → StereoPanner → masterBus → softClipper (curve=4096, 2x oversample)
    → masterAnalyser (fft=256) → muteGain
    → splitter → analyserL / analyserR (fft=256 each)
    → destination (speakers)

GRAIN PLAYBACK PATH (Electron multi-ch):
  AudioBuffer slice → BufferSource → GainNode (envelope)
    → [optional HPF/LPF BiquadFilter]
    → VBAP speaker bus gains (O(1) LUT, 360 entries)
    → ChannelMerger → quad-capture worklet (batch=8×128=1024)
      → postMessage (interleaved Float32, Transferable)
      → IPC 'audio-buffer' (credit-gated, max 8 outstanding)
      → electron-main: Buffer.from() → rtAudio.write()
      → DAC → speakers

DRY MONITOR SIDE-CHAIN:
  inputGainNode → dryGain → dryAnalyser (fft=256) → dryPanner → masterBus

METERING SIDE-CHAIN:
  masterAnalyser → tickMeters (ui-meters.js, rAF ~60fps)
  inputAnalyser  → tickPeakHold (renderer.js, per rAF frame)
                 → snapshotInputFeatures (per paint event, every ~50ms)
  speakerAnalysers[] → tickMeters (ui-audio-settings.js modal, rAF ~60fps)
```

---

## Complete Buffer Inventory

### 1. AudioWorklet Process Quantum (Web Audio Spec)

| Property | Value | Notes |
|---|---|---|
| Block size | **128 samples** | Fixed by Web Audio spec, not configurable |
| Duration @ 48 kHz | 2.67 ms | |
| Duration @ 22.05 kHz | 5.81 ms | Mobile path |

All three worklets operate on this fixed quantum.

---

### 2. Recording-Capture Worklet

**File:** `js/worklets/recording-capture.worklet.js`

| Property | Line | Value | Duration @ 48 kHz | Duration @ 22.05 kHz |
|---|---|---|---|---|
| Block size | 14 | 128 samples | 2.67 ms | 5.81 ms |
| Batch size | 11 | 16 blocks | — | — |
| Ring buffer | 17 | 16 × 128 = **2,048 samples** (8 KB) | 42.67 ms | 92.88 ms |
| Message rate | — | 48000/2048 = **23.4 msg/s** | — | 22050/2048 = **10.8 msg/s** |

**Configurable:** `batchSize` via init message (audio.js:487 sends `batchSize: 16`).

**Source:** Mono mic input (inputs[0][0]).
**Destination:** postMessage → main thread → appended to `S.recordingRaw`.
**Transfer:** Zero-copy Transferable (subarray).

---

### 3. Quad-Capture Worklet (Electron Multi-Channel Output)

**File:** `js/worklets/quad-capture.worklet.js`

| Property | Line | Value (default) | Duration @ 48 kHz |
|---|---|---|---|
| Block size | 17 | 128 samples | 2.67 ms |
| Batch size | 14 | **8 blocks** (derived from `bufferFrames/128`) | — |
| Channels | 13 | 4 (configurable) | — |
| Ring buffer | 21 | 8 × 128 × 4 = **4,096 samples** (16 KB) | — |
| Per-message | — | 1,024 frames × 4 ch = 4,096 samples interleaved | 21.33 ms |
| Message rate | — | 48000/1024 = **46.9 msg/s** | — |

**Critical invariant** (audio.js:848): `batchSize = Math.max(1, Math.round(bufferFrames / 128))` — worklet output must match audify input buffer exactly.

**Configurable:** `numChannels` and `batchSize` via init message.
**Source:** N-channel Web Audio speaker buses via ChannelMerger.
**Destination:** postMessage → IPC → electron-main → `rtAudio.write()`.

**Scaling examples:**

| Config | Ring size | Per-message | Duration |
|---|---|---|---|
| 4 ch, 1024-frame audify | 4,096 samples (16 KB) | 16 KB | 21.33 ms |
| 8 ch, 1024-frame audify | 8,192 samples (32 KB) | 32 KB | 21.33 ms |
| 4 ch, 512-frame audify | 2,048 samples (8 KB) | 8 KB | 10.67 ms |
| 4 ch, 2048-frame audify | 8,192 samples (16 KB) | 32 KB | 42.67 ms |

---

### 4. Input-Meter Worklet (Electron Multi-Channel Input)

**File:** `js/worklets/input-meter.worklet.js`

| Property | Line | Value | Notes |
|---|---|---|---|
| Ring buffer (base) | 22 | **32,768 samples** (128 KB) | Minimum allocation |
| Ring sizing formula | 30-34 | `max(32768, numCh × 8192)` rounded to power-of-2 | Scales to hold ~100ms interleaved |
| Ring @ 10 ch, 48 kHz | — | 65,536 samples (256 KB) | 48000 × 0.1 × 10 = 48000, rounded up |
| Output per process | 74 | 128 samples per channel | De-interleaved from ring |

**Overflow handling** (lines 50-59): Detects overflow, snaps read cursor forward (discards oldest data, never corrupts recent).

**Source:** IPC `audio-input-buffer` from electron-main (interleaved Float32 from RtAudio).
**Destination:** Per-channel outputs → AnalyserNode inputs for metering.

---

### 5. Electron/Audify Output Buffer

**File:** `electron-main.js`

| Property | Line | Value | Duration @ 48 kHz |
|---|---|---|---|
| `DEFAULT_BUFFER_FRAMES` | 310 | **1,024 frames** | 21.33 ms |
| Format | 357 | RTAUDIO_FLOAT32 (4 bytes/sample) | — |
| Sample rate | 344-345 | 48000 Hz preferred, 44100 fallback | — |
| Bytes per write | 380 | `frames × nCh × 4` | 4 ch → 16 KB, 8 ch → 32 KB |

**User-configurable** via UI dropdown: 512, 1024, 2048, 4096 frames.

---

### 6. IPC Audio Flow Control

**File:** `electron-main.js`

| Property | Line | Value | Meaning |
|---|---|---|---|
| `_ipcAudioCredits` | 473 | **8** (initial) | Max outstanding buffers in IPC pipe |
| `IPC_AUDIO_MAX_CREDITS` | 474 | **8** | Refill ceiling |
| Max queued audio | — | 8 × 1024 frames @ 48 kHz = **170.67 ms** | Latency ceiling |

Renderer decrements credit on send; electron-main sends credit back on successful `rtAudio.write()`. If credits exhaust, renderer pauses output.

---

### 7. Electron RtAudio Input Buffer

**File:** `electron-main.js`

| Property | Line | Value | Duration @ 48 kHz |
|---|---|---|---|
| Buffer frames | 419 | **1,024** (default, user-configurable) | 21.33 ms |
| Format | 434 | RTAUDIO_FLOAT32 | — |
| Delivery | 441 | `new Float32Array(buffer, byteOffset, length/4)` — zero-copy view | — |

**Source:** RtAudio input callback (hardware mic/interface).
**Destination:** IPC → renderer → input-meter worklet ring buffer.

---

### 8. AnalyserNode FFT Buffers

All analysers use identical sizing. Each AnalyserNode internally maintains time-domain and frequency-domain buffers.

| Node | File:Line | fftSize | Smoothing | Bins | Duration @ 48 kHz | Source | Reader |
|---|---|---|---|---|---|---|---|
| `S.masterAnalyser` | audio.js:71-72 | 256 | 0.75 | 128 | 5.33 ms | softClipper output | tickMeters (ui-meters) |
| `analyserL` | audio.js:94-95 | 256 | 0.75 | 128 | 5.33 ms | muteGain L channel | tickMeters (browser stereo) |
| `analyserR` | audio.js:94-96 | 256 | 0.75 | 128 | 5.33 ms | muteGain R channel | tickMeters (browser stereo) |
| `S.dryAnalyser` | audio.js:165-166 | 256 | 0.75 | 128 | 5.33 ms | dryGain | tickMeters |
| `S.inputAnalyser` | audio.js:357-358 | 256 | 0.6 | 128 | 5.33 ms | inputGainNode | tickPeakHold, snapshotInputFeatures |
| `speakerAnalysers[n]` | audio.js:814-815 | 256 | 0.8 | 128 | 5.33 ms | per-speaker bus | tickMeters (Electron modal) |
| handsfree HPF analyser | handsfree.js:90-91 | 256 | 0.6 | 128 | 5.33 ms | HPF output | handsfree trigger |
| mobile analyser | mobile.js:266 | 256 | 0.6 | 128 | 5.33 ms | mobile mic input | mobile metering |
| settings analyser | ui-audio-settings.js:77-78 | 256 | 0.8 | 128 | 5.33 ms | calibration signal | diagnostics |

**Total analyser count:** 6 fixed + N per-speaker (typically 4–32) = **10–38 analysers**.

---

### 9. Audio Feature Extraction Buffers

**File:** `js/audio-features.js`

| Buffer | Line | Size | Type | Reuse Pattern |
|---|---|---|---|---|
| `_timeBuf` | 10 | **256 samples** (1 KB) | Float32Array | Module singleton, zero-GC, reused every call |
| `_freqBuf` | 11 | **128 bins** (128 B) | Uint8Array | Module singleton, zero-GC, reused every call |

**Readers:** `tickPeakHold()` reads `_timeBuf` every render frame. `snapshotInputFeatures()` reads both at paint time (~every 50ms).
**Constraint:** Sizes must match `inputAnalyser.fftSize = 256`.

---

### 10. WaveShaper Soft Clipper Curve

**File:** `js/audio.js`

| Property | Line | Value |
|---|---|---|
| Curve array | 19 | `new Float32Array(4096)` — **4,096 points** (16 KB) |
| Function | 19 | `tanh` soft-clip curve |
| Oversample | 67 | `'2x'` (internal Web Audio 2× oversampling) |

**Static:** Allocated once, never changes. Not a sample buffer — it's a lookup table for the waveshaper transfer function.

---

### 11. Grain Envelope Curves (Hann Windows)

**File:** `js/state.js`

| Buffer | Line | Size | Duration @ 48 kHz |
|---|---|---|---|
| `HANN_ATTACK` | 42 | **128 samples** (512 B) | 2.67 ms |
| `HANN_RELEASE` | 43 | **128 samples** (512 B) | 2.67 ms |
| `S.GRAIN_ATTACK_CURVE` | 1281 | **128 samples** (512 B) | 2.67 ms |
| `S.GRAIN_RELEASE_CURVE` | 1282 | **128 samples** (512 B) | 2.67 ms |

`HANN_ATTACK/RELEASE` are immutable templates. `S.GRAIN_*_CURVE` are volume-scaled copies rebuilt on preset change. Used by `setValueCurveAtTime()` for grain envelopes.

Per-seed cached envelopes (grain.js:440-448): **128 samples × 2 arrays = 1 KB per seed grain type**, amortized across all grains from that seed.

---

### 12. VBAP Lookup Table

**File:** `js/grain.js` lines 6-37

| Property | Value |
|---|---|
| Size | **360 entries** (one per degree of azimuth) |
| Per entry | `{ idxA, idxB, wA, wB }` (~72 bytes with object overhead) |
| Total | **~7 KB** |
| Lookup | O(1) via `_vbapLUT[Math.round(azDeg) % 360]` |

**Built once** per speaker configuration change. Survives until `initSpeakerBuses()` is called again.

---

### 13. Recording Buffers (Live Mic Recording)

**File:** `js/audio.js`

| Buffer | Line | Initial Size | Growth | Max |
|---|---|---|---|---|
| `S.recordingRaw` | 457 | `sampleRate × 300` (5 min) | 2× on overflow (line 478) | `REC_LIMIT_SECONDS_DEFAULT × sampleRate` |
| Live rebuild buffer | 1186 | `allocLen` (grows) | 2× headroom on realloc | Same as recording duration |
| Final AudioBuffer | 543 | `totalLength` (exact) | N/A | Same as recording duration |

**Memory at 48 kHz mono:**

| Duration | S.recordingRaw | Final AudioBuffer |
|---|---|---|
| 1 minute | 11.5 MB | 11.5 MB |
| 5 minutes | 57.6 MB (initial alloc) | 57.6 MB |
| 10 minutes | 115 MB (at limit) | 115 MB |

**Reversed buffer cache** (grain.js:120): WeakMap, lazy — mirrors source buffer on first reverse-grain. Size = source buffer size. Auto-GC'd when source is released.

---

### 14. Renderer Projection / Sort Buffers

**File:** `js/renderer.js`

| Buffer | Line | Size | Type | Growth |
|---|---|---|---|---|
| `_sortBuf` | ~60 | `MAX_PARTICLES × 7` (Float64Array) | 3,500 elements → 28 KB | Doubles if particle count exceeds allocation |
| `_sortIdx` | ~61 | `MAX_PARTICLES` (Int32Array) | 500 entries → 2 KB | Doubles alongside _sortBuf |
| `_TRAIL_BUDGET` | 68 | **120** projections/frame | Hard cap | Fixed |

**Trail rendering:** Moving seed trail samples share the 120-projection budget per frame. Each projection uses `spherePointInto()` + `cameraTransformInto()` into pre-allocated scratch arrays (3-element each).

---

### 15. Grain Scheduler Scratch Buffers

**File:** `js/grain.js`

| Buffer | Line | Size | Purpose |
|---|---|---|---|
| `_grainScratchW` | 100 | 3 elements | World-space coords, reused per grain |
| `_grainScratchC` | 101 | 3 elements | Camera-space coords, reused per grain |
| `_seedWeights` | 106 | MAX_SEEDS × 4 = 64 B | Per-seed playback weight, `.fill(0)` each tick |
| `_extraNodesBuf` | 114 | Dynamic (typically 0-4) | Reusable extra gain node refs |
| `_candidateBuf` | 179 | Reused array | Particle candidates within search radius |
| `_kSelectBuf` | 239 | Reused array | k-nearest selection |
| `_recBufRec` / `_recAllowed` / `_recSortBuf` | 185-187 | Reused arrays | Recency filter scratch |

**All zero-alloc in hot path.** Arrays are cleared and reused, never re-created per tick.

---

### 16. UI Meter Buffers

**File:** `js/ui-meters.js`

| Buffer | Line | Size | Purpose |
|---|---|---|---|
| `_peakBuf` | ~25 | `new Float32Array(256)` | Time-domain data for peak metering |
| `_rmsBuf` | ~26 | `new Uint8Array(128)` | Frequency-domain data for meter display |

Module-level singletons, reused every meter tick.

**File:** `js/handsfree.js`

| Buffer | Line | Size | Purpose |
|---|---|---|---|
| `RMS_BUF_SIZE` | 32 | 256 | Matches `inputAnalyser.fftSize` |
| `_rmsBuf` | 93 | `new Float32Array(256)` | Handsfree RMS calculation |

---

### 17. Grain Node Pool (Not Pre-Allocated)

**File:** `js/grain.js`

Grain audio nodes are created per-grain, **not pooled:**

| Node | Created per grain | Cleanup |
|---|---|---|
| BufferSource | Always (1) | `ended` event → disconnect (lines 783-788) |
| GainNode (envelope) | Always (1) | Disconnect chain |
| GainNode (elevation) | Conditional (elevation > 10°) | Disconnect chain |
| BiquadFilter (HPF) | Conditional (hpfFreq > 22 Hz) | Disconnect chain |
| BiquadFilter (LPF) | Conditional (lpfFreq < 19.5 kHz) | Disconnect chain |
| GainNode (L/R mixdown) | Conditional (multi-ch only, 0-2) | Disconnect chain |

**Hard cap:** `MAX_GRAIN_NODES = 150` concurrent sources (state.js:113).
**Dynamic throttle:** At > 75% pool fullness, grain creation budget is halved (grain.js:1176).
**Typical load:** 10–50 nodes (sparse) to 100–200 nodes (dense).

---

### 18. Particle Storage

**File:** `js/state.js`

| Property | Typical Count | Per-Particle | Total |
|---|---|---|---|
| `S.particles` | 100–1,000+ | ~200–300 B (plain object) | 20–300 KB |

Each particle stores: `lon, lat, grainStart, source, strokeId, _cx, _cy, _cz, _cursorAng`, plus per-seed angle/fade caches as dynamic properties.

---

### 19. Canvas Pixel Buffers (Implicit)

**File:** `js/renderer.js`

The `<canvas>` element's backing pixel buffer is managed by the browser:

| Property | Typical Value | Memory |
|---|---|---|
| Canvas size | 1920 × 1080 (desktop) | 8.3 MB (RGBA) |
| Canvas size | 390 × 844 (mobile) | 1.3 MB (RGBA) |

No explicit `getImageData()` / `createImageData()` calls found — all rendering is via Canvas 2D draw calls (`arc`, `fill`, `beginPath`, `lineTo`).

---

### 20. Experimental Module Buffers (exp/ only)

**File:** `js/exp/gesture.js`

| Buffer | Size | Purpose |
|---|---|---|
| Smoothing window | 30 floats × 4 features | ~480 B |
| Periodicity autocorrelation | 150 floats | ~600 B |
| Energy decay accumulator | 1 float per feature | Trivial |

**File:** `js/exp/gesture-viz.js`

| Buffer | Size | Purpose |
|---|---|---|
| Trail arrays | 180 entries × 4 features | ~2.9 KB |
| Canvas | 280 × 395 | 443 KB (RGBA) |

---

## Buffer Chain Summary: Mic → Speakers

### Browser Path (Stereo)

```
Mic hardware
  → getUserMedia (browser-managed buffer, ~5-10ms latency)
  → Web Audio inputGainNode (no buffer — real-time graph node)
  → inputAnalyser [256 samples, 5.33ms window]        ← METERING TAP
  → recording-capture worklet:
      128-sample blocks → accumulate 16 → 2048 samples (42.67ms)
      → postMessage (Transferable)
  → S.recordingRaw [5min pre-alloc, 57.6MB]           ← RECORDING STORAGE
  → stopRecording → AudioBuffer [exact length]         ← GRAIN SOURCE

AudioBuffer (grain source)
  → BufferSource [slice: grain duration, typically 20-200ms]
  → GainNode envelope [128-sample Hann attack/release curves]
  → [optional BiquadFilter HPF/LPF]
  → StereoPanner
  → masterBus GainNode
  → softClipper WaveShaper [4096-point curve, 2x oversample]
  → masterAnalyser [256 samples, 5.33ms]               ← OUTPUT METER TAP
  → muteGain
  → splitter → analyserL / analyserR [256 samples each]  ← STEREO METER TAP
  → AudioContext.destination
  → Browser audio output (hardware buffer ~5-20ms)
```

### Electron Path (Multi-Channel VBAP)

```
Mic hardware
  → RtAudio input [1024 frames, 21.33ms]
  → IPC 'audio-input-buffer' (Float32Array view, zero-copy)
  → input-meter worklet ring [32K+ samples, ~100ms capacity]
  → de-interleave → per-ch AnalyserNode [256 samples]  ← INPUT METER TAP

AudioBuffer (grain source)
  → BufferSource [grain slice]
  → GainNode envelope
  → [optional BiquadFilter]
  → VBAP speaker bus gains [O(1) LUT, 360 entries]
  → ChannelMerger [N channels]
  → quad-capture worklet:
      128-sample blocks → accumulate 8 → 1024 frames (21.33ms)
      interleave N channels
      → postMessage (Transferable)
  → IPC 'audio-buffer' (credit-gated, max 8 outstanding = 170.67ms)
  → electron-main: Buffer.from() → rtAudio.write()
  → RtAudio output [1024 frames, 21.33ms]
  → DAC → speakers
```

---

## End-to-End Latency Estimate (Electron, 4-ch @ 48 kHz, 1024 frames)

| Hop | Buffer | Latency |
|---|---|---|
| RtAudio input | 1024 frames | 21.33 ms |
| IPC input → worklet ring | message delivery | ~1 ms |
| Web Audio graph processing | internal | ~3-5 ms |
| Quad-capture accumulation | 8 × 128 = 1024 frames | 21.33 ms |
| IPC output + credit round-trip | message delivery | ~1-2 ms |
| RtAudio output | 1024 frames | 21.33 ms |
| **Total estimated** | | **~70-72 ms** |

Reducing `preferredBufferSize` to 512 drops this to ~48-50 ms. Increasing to 2048 raises it to ~114 ms.

---

## Memory Budget Summary

| Category | Idle | Active (typical) | Peak |
|---|---|---|---|
| Static buffers (curves, LUT, scratch) | 10 KB | 10 KB | 10 KB |
| Analyser nodes (6-38 × 256 FFT) | 6 KB | 15 KB | 38 KB |
| Feature extraction buffers | 1.1 KB | 1.1 KB | 1.1 KB |
| Renderer sort/projection buffers | 30 KB | 60 KB | 120 KB |
| Particles (500 typical) | 0 | 150 KB | 300 KB |
| Worklet rings (3 worklets) | 0 | 160 KB | 400 KB |
| Recording raw buffer | 0 | 57.6 MB | 115 MB |
| Live rebuild buffer | 0 | 9.6 MB | 19.2 MB |
| Final AudioBuffers (recordings) | 0 | 11.5 MB | 115 MB |
| Reversed buffer cache | 0 | 0–11.5 MB | 115 MB |
| Canvas backing store | 1.3 MB | 8.3 MB | 8.3 MB |
| **Total** | **~1.3 MB** | **~87 MB** | **~345 MB** |

The recording subsystem dominates memory. The `REC_LIMIT_SECONDS_DEFAULT = 600s` guard (state.js:143) caps single-recording allocation at ~115 MB.
