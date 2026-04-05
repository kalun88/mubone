# Mubone Timing & Rate Reference

> Every timing interval, rate, buffer size, and scheduling value in the system.
> Generated 2026-04-04 from codebase v0.17 alpha.

---

## Master Reference Table

| # | Term | Value | How it's set | Where in code | What it controls | Depends on | Feeds into | Impact type | Runtime changeable? |
|---|------|-------|-------------|---------------|-----------------|------------|------------|-------------|-------------------|
| **1** | **Audio sample rate** | 48000 Hz (default); 44100, 22050 possible | AudioContext creation; browser/OS chooses based on hardware. Mobile Safari may force 22050 or 44100. | `audio.js:37` (default), `AudioContext({ sampleRate })` | Nyquist limit, all time↔sample conversions, recording buffer sizing, worklet block duration | Hardware DAC, browser | Render quantum duration (#2), worklet block rate (#3), recording batch duration (#4), grain duration floor (#14), FFT bin resolution (#30) | Sonic + structural | No — fixed at AudioContext creation. Requires full audio graph rebuild to change. |
| **2** | **Web Audio render quantum** | 128 samples (≈2.67 ms @ 48 kHz) | W3C spec — hardcoded in every browser engine | Not in codebase (browser internal) | Minimum schedulable unit; all AudioWorklet `process()` calls receive exactly 128 frames | Audio sample rate (#1) | Worklet block rate (#3), recording batch (#4), quad capture batch (#5), grain duration floor (#14), worklet batch sizing invariant | Structural | No — W3C spec constant. Cannot be changed. |
| **3** | **Worklet block rate** | 375 blocks/sec @ 48 kHz (sampleRate ÷ 128) | Derived: sampleRate / renderQuantum | Implicit (128 in all worklets) | How often each AudioWorklet `process()` fires | Audio sample rate (#1), render quantum (#2) | Recording capture timing (#4), quad capture timing (#5), input meter fill rate (#6) | Structural | No — derived from #1 and #2. |
| **4** | **Recording capture batch** | 2048 samples (16 × 128); ≈42.7 ms @ 48 kHz | Constant in worklet: `this._batchSize = 16` | `worklets/recording-capture.worklet.js:11` | Accumulates 16 render quanta before posting to main thread. Sets message rate: ~23.4 msg/s @ 48 kHz | Render quantum (#2), audio sample rate (#1) | Recording buffer fill, main-thread message overhead | Structural | No — worklet constant. Would require worklet reload. |
| **5** | **Quad capture batch** | 1024 frames (8 × 128); ≈21.3 ms @ 48 kHz | Derived: `Math.max(1, Math.round(bufferFrames / 128))` where bufferFrames defaults to 1024 | `audio.js:847–848`, `worklets/quad-capture.worklet.js:14` | Accumulates 8 quanta of 4-channel audio before posting via Transferable. ~46.9 msg/s @ 48 kHz | Render quantum (#2), audify output buffer (#7) | IPC audio pipeline, Electron audify output | Structural | Yes — changes when buffer size dropdown changes in Electron mode (`applyBufferSize()`). |
| **6** | **Input meter ring buffer** | 32768 samples (≈683 ms @ 48 kHz stereo) | Computed: `Math.max(32768, numChannels × 8192)` | `worklets/input-meter.worklet.js:21,32` | Circular buffer for input level metering. ~100 ms headroom ensures no overflow between main-thread reads | Audio sample rate (#1), channel count | Input level display, handsfree gate (#28) | Structural | No — set at worklet construction. |
| **7** | **Audify output buffer (Electron)** | 1024 frames default (≈21.3 ms @ 48 kHz) | User parameter via audio settings dropdown. `DEFAULT_BUFFER_FRAMES = 1024` | `electron-main.js:310`, `ui-audio-settings.js:834–859` | Size of each RtAudio write in Electron native output. Directly sets output latency. | Audio sample rate (#1) | Quad capture batch (#5), IPC credit flow (#29), end-to-end latency | Sonic + perceptual | Yes — dropdown in audio settings (Electron only). Triggers audify stream rebuild. |
| **8** | **Grain scheduler tick** | 20 ms / 50 Hz | Constant: `GRAIN_SCHEDULER_INTERVAL_MS = 20` | `state.js:122`, started at `main.js:497` | How often `scheduleGrains()` fires via `setInterval`. Each tick fills the lookahead window with grain onsets. | None (fixed constant) | Grain onset precision, scheduler CPU budget, DOM update rate (#27), max grain creation rate | Sonic + structural | Not at runtime without restarting the scheduler. Changing it shifts the CPU/precision tradeoff. |
| **9** | **Scheduler lookahead** | 40 ms (0.040 s) | Constant: `SCHED_LOOKAHEAD = 0.040` | `grain.js:956` | How far ahead of `audioCtx.currentTime` the scheduler pre-commits grains. Grains within this window get sample-accurate `.start(t)`. | Grain scheduler tick (#8) | Parameter scrub latency, grain onset budget per tick, stale-parameter window | Perceptual + sonic | Not without code change. Was 120 ms, reduced for responsive scrubbing. |
| **10** | **Grain period** | User param; 10 ms floor, no hard ceiling | UI slider → `S.presets[n].period`. Floor enforced by SCHED_SAFE_PERIOD_S | `state.js:129` (floor), UI slider in `ui-presets.js` | Time between successive cursor grain onsets. Controls grain density/texture. | Min grain period floor (#24) | Grain onset rate (#11), polyphony (#12), scheduler budget calc | Sonic | Yes — slider or MIDI CC. Immediate effect on next scheduler tick. |
| **11** | **Grain onset rate** | Derived: 1 / period. Max 100/sec at 10 ms floor | Derived from grain period (#10) | Computed in `grain.js:1173–1174` | How many grains per second the cursor fires. At period=10 ms → 100 grains/sec. | Grain period (#10), min period floor (#24) | Concurrent voices (#12), scheduler iterations per tick | Sonic | Yes — indirectly via period slider. |
| **12** | **Grain polyphony / concurrent voices** | Derived: ≈ duration / period, capped at 150 | Emergent from duration, period, and MAX_GRAIN_NODES | `state.js:113` (cap), runtime `S._grainSourceCount` | How many grain AudioBufferSourceNodes are alive simultaneously. At dur=500 ms, period=10 ms → 50 concurrent. | Grain period (#10), grain duration (#13), max grain nodes (#15) | Audio thread CPU, pressure throttle (#16), Chrome renderer stability | Sonic + structural | Indirectly — via duration and period sliders. Hard cap is constant. |
| **13** | **Grain duration** | User param; floor ≈ 5.3 ms (2 × 128 / sampleRate) | UI slider → `S.presets[n].duration`. Floor: `MIN_GRAIN_DUR = (128 / actx.sampleRate) * 2` | `grain.js:461` (floor), UI slider | Length of each grain envelope. Below 2 render quanta → impulse clicks. | Audio sample rate (#1), render quantum (#2) | Concurrent voices (#12), activeGrainMap expiry, envelope shape | Sonic | Yes — slider or MIDI CC. |
| **14** | **Min grain duration floor** | ≈ 5.3 ms @ 48 kHz (256 samples = 2 render quanta) | Derived: `(128 / actx.sampleRate) * 2` | `grain.js:461` | Prevents sub-quantum grains that sound like clicks. Ensures proper fade envelope. | Audio sample rate (#1), render quantum (#2) | Grain duration (#13) clamping | Sonic | No — derived from fixed values. |
| **15** | **Max grain nodes** | 150 | Constant: `MAX_GRAIN_NODES = 150` | `state.js:113` | Hard ceiling on concurrent AudioBufferSourceNodes. Normal usage: 20–50 nodes. | None (fixed constant) | Polyphony cap (#12), pressure throttle (#16), nodes budget per tick | Structural | No — would require code change. |
| **16** | **Pressure throttle threshold** | 75% pool utilization (≈112 nodes) | Constant check: `poolPressure > 0.75` | `grain.js:1181–1182` | When node pool exceeds 75%, per-tick budget is halved (12 → 6). Back-pressures creation during extreme combos. | Max grain nodes (#15), current `S._grainSourceCount` | Per-tick grain budget, sonic density under pressure | Sonic + structural | No — hardcoded threshold. |
| **17** | **Max grains per tick** | 12 | Constant: `MAX_GRAINS_PER_TICK = 12` | `grain.js:969` | Hard limit on grains created in a single scheduler call. 12 × 50 ticks/sec = 600 max creations/sec. | None (fixed constant) | Burst grain capacity, catch-up after jitter | Structural | No — constant. |
| **18** | **Particle deposit rate** | ~10 /sec (every 3rd render frame at 30 fps) | Constant: `PAINT_INTERVAL = 3` | `state.js:24`, gate at `renderer.js:1434` | How often new particles are pushed to `S.particles` during painting. Each captures audio features (the MuBu marker equivalent). | Render rate (#19), PAINT_INTERVAL | Particle cloud density, feature snapshot rate, `S.particles` array growth | Visual + sonic | Not without code change. PAINT_INTERVAL is a constant. |
| **19** | **Render rate (canvas draw)** | 30 fps (33.3 ms frame budget) | Constant: `RENDER_TARGET_FPS = 30`, enforced by time-gate | `state.js:134`, gate at `renderer.js:1241–1248` | How often the 3D sphere, particles, seeds, cursor, and trails are redrawn. All particles drawn every frame. | None (fixed constant) | Particle deposit rate (#18), visual smoothness, scheduler starvation risk | Visual + structural | Could be changed in code. Lowering (e.g. 20) reduces canvas cost on dense scenes. |
| **20** | **Display / rAF rate** | ~60 Hz (browser/OS display refresh) | Browser's `requestAnimationFrame` cadence, tied to monitor refresh | `renderer.js:1245,1540` (rAF calls) | Raw callback rate before the 30 fps time-gate. Painting state and camera updates run at full rAF rate; heavy canvas work is throttled. | Monitor refresh rate, browser compositor | Input flushing (#23), render gate, camera responsiveness | Visual + perceptual | No — determined by display hardware and browser. |
| **21** | **IMU native sensor rate** | ~100 Hz (BNO085 default) | Sensor hardware default. Configurable on BNO085 but not changed in mubone. | Hardware (BNO085 datasheet) | Raw orientation quaternion/Euler output rate from the physical sensor | Sensor hardware | Max metro poll (#22), experimental gesture module | Perceptual | Yes — via BNO085 configuration commands, but not exposed in mubone UI. |
| **22** | **Max metro poll (IMU serial)** | 20 ms / 50 Hz | Max/MSP `metro 20` object in the sensor patch | `max/x-imu3serial.maxpat:120` | How often Max reads serial data from x-IMU3 and sends over WebSocket/OSC. Downsamples 100 Hz sensor to 50 Hz. | IMU native rate (#21), serial baud (#26) | All IMU consumers: grain scheduler (cursor position), renderer (camera), sensor-mapping, handsfree | Perceptual | Yes — change metro interval in Max patch. |
| **23** | **Mouse/touch → rAF input gate** | ~60 Hz (one flush per rAF) | rAF-gated coalescing: buffers latest position, flushes once per `requestAnimationFrame` | `events.js:53–69,190–242` | Prevents 120 Hz+ pointer events from invalidating angular-distance caches every event. Coalesces to one update per display frame. | Display rate (#20), browser event rate | Cursor position on sphere, painting input, camera rotation | Perceptual | No — architectural pattern. |
| **24** | **Min grain period floor** | 10 ms (0.010 s) = 100 grains/sec max | Constant: `SCHED_SAFE_PERIOD_S = 0.010` | `state.js:129` | UI slider floor and scheduler clock advancement minimum. Prevents Chrome renderer crashes at extreme period + duration combos. | None (fixed constant) | Grain period (#10), grain onset rate (#11), UI slider range | Sonic + structural | Not without code change. Was 2 ms, raised to 10 ms for stability. |
| **25** | **Safety future floor** | 2 ms (0.002 s) | Constant: `MIN_FUTURE_S = 0.002` inside `playGrain()` | `grain.js:427` | Ensures `source.start(t)` is always ≥ 2 ms in the future at call time. Prevents `InvalidStateError` from `setValueCurveAtTime` when `t` slips into the past during JS execution. | None (fixed constant) | Grain onset precision, minimum onset latency | Sonic | No — safety constant. |
| **26** | **IMU serial baud rate** | 115200 bps | Constant: `XIMU3_SERIAL_BAUD = 115200` | `electron-main.js:203` | x-IMU3 serial communication speed. At 115200 baud, a 50-byte quaternion packet takes ~4.3 ms — well within the 10 ms (100 Hz) sensor period. | None (fixed constant) | IMU data throughput, max achievable sensor rate | Structural | Not without code change. Must match x-IMU3 firmware setting. |
| **27** | **Grain DOM update rate** | ~4 Hz (every 25th scheduler tick) | Counter: `if (++_domUpdateCounter >= 25)` | `grain.js:1864` | Throttles grain count / voice meter DOM updates. At 20 ms tick × 25 = 500 ms between DOM writes. | Grain scheduler tick (#8) | UI voice count display, performance overlay | Visual | No — hardcoded divisor. |
| **28** | **Handsfree UI sync** | 100 ms / ~10 Hz | Constant: `UI_SYNC_INTERVAL = 100` | `handsfree.js:57–59` | Throttles DOM updates for gate state, RMS visualization, buffer count. Called from meter loop at ~30 fps but only flushes every 100 ms. | None (fixed constant) | Handsfree indicator responsiveness | Visual + perceptual | Not without code change. |
| **29** | **IPC audio credits (Electron)** | 8 max outstanding buffers | Constant: `IPC_AUDIO_MAX_CREDITS = 8` | `electron-main.js:474,381` | Credit-based flow control between renderer and Electron main process. Renderer can have at most 8 unacknowledged audio buffers in flight. | Audify output buffer (#7) | IPC backpressure, output pipeline depth, worst-case IPC latency (~170 ms at 1024 frames) | Structural + perceptual | Not without code change. |
| **30** | **FFT analyser size** | 256 samples (128 frequency bins) | Set on every AnalyserNode: `fftSize = 256` | `audio.js:72,95–96,165,357,814` | Frequency resolution and time resolution of all real-time analysers. 256 / 48000 = 5.3 ms time window, 187.5 Hz bin spacing. | Audio sample rate (#1) | Spectral centroid, ZCR, RMS for particle features; input meter; level display | Visual + sonic (feature extraction) | Yes — could change `fftSize` property at runtime, but no UI for it. |
| **31** | **Soft clipper curve resolution** | 4096 points | Constant: `new Float32Array(4096)` for WaveShaperNode | `audio.js:19` | Transfer function resolution for tanh soft clipper with 2× oversample. Higher = smoother curve but more memory. 4096 is generous. | None | Output limiting / distortion character | Sonic | No — set at graph construction. |
| **32** | **Recording limit** | 600 s (10 min) default | Constant: `REC_LIMIT_SECONDS_DEFAULT = 600`, stored on `S.recLimitSeconds` | `state.js:143` | Memory guard for recording buffer. At 48 kHz mono, 10 min ≈ 115 MB of Float32 data. | Audio sample rate (#1) | Recording buffer pre-allocation, performer warning threshold | Structural | Yes — UI slider in audio settings. Stored in `S.recLimitSeconds`. |
| **33** | **VBAP lookup table size** | 360 entries (1 per degree) | Built at import: `_vbapLUT[0..359]` | `grain.js:6–37` | Pre-computed gain vectors for every integer azimuth degree. O(1) lookup per grain — no trig at schedule time. | Speaker layout (count + positions) | Spatial panning of every grain | Sonic | Rebuilt when speaker layout changes (channel count update). |
| **34** | **Tap/hold gesture threshold** | 200 ms | Constant: `TRACE_TAP_MS = 200` | `events.js:37` | Discriminates quick tap (<200 ms = toggle) from hold (≥200 ms = momentary) for trace, commit draw, and other gesture modes. | None (fixed constant) | Trace toggle, commit draw vs drop, recording interaction | Perceptual | No — hardcoded UX constant. |
| **35** | **Settings autosave interval** | 2000 ms (2 s) | `setInterval(_checkAndSave, 2000)` | `ui-audio-settings.js:1510` | Dirty-check auto-persist: snapshots all settings every 2 s, writes localStorage only if changed. | None | Settings persistence, localStorage writes | Structural | No — hardcoded interval. |
| **36** | **WebSocket reconnect interval** | 3000 ms (3 s) | Constant: `WS_RETRY_INTERVAL = 3000` | `osc.js:24` | Delay before retrying WebSocket connection to Max/OSC bridge after disconnect. | None | IMU data availability after connection loss | Structural + perceptual | No — hardcoded constant. |
| **37** | **Live rebuild throttle** | 200 ms | Constant: `LIVE_REBUILD_INTERVAL_MS = 200` | `state.js:137` | Minimum interval between spatial-index rebuilds during live recording. Prevents rebuild-per-particle overhead. | None | Grain search accuracy during live recording, CPU budget | Structural + sonic | Not without code change. |
| **38** | **Slider input throttle (grain params)** | 30 ms (~33 fps) | `setTimeout(_flushSliderUpdates, 30)` with Map coalescing | `ui-presets.js:2223` | Batches rapid slider `input` events (200+/sec during drag) into 30 ms flushes. Numbox updates immediately for visual snap. | Browser event rate | Grain parameter update latency, DOM write rate | Perceptual | No — hardcoded timeout. |
| **39** | **Slider input throttle (search params)** | 50 ms (~20 fps) | `setTimeout(..., 50)` on recency, search-K, and radius sliders | `ui-presets.js:241–248,284–290,327–334` | Throttles spatial search parameter updates during slider drag. Slightly slower than grain param throttle because these trigger index rebuilds. | None | Spatial search recomputation rate | Perceptual | No — hardcoded timeout. |
| **40** | **Pan smoothing time constant** | 15 ms (0.015 s) | Constant: `_panRampTau = 0.015` inside seed scheduling | `grain.js:1817` | Exponential smoothing for VBAP gain ramps on moving seeds. Prevents zipper noise when spatial position changes between grains. | None | Spatial panning smoothness for moving seeds | Sonic | No — hardcoded constant. |
| **41** | **Cursor re-anchor cycle** | 30 s | `_cursorReanchorAt = audioNow + 30.0` | `grain.js:1276` | Periodic floating-point re-anchor of `_cursorNextOnsetT` to fresh `audioCtx.currentTime`. Prevents fp drift accumulation over long performances. | None | Long-session onset precision | Sonic (long-term) | No — hardcoded interval. |
| **42** | **Snap-forward margin** | 5 ms (0.005 s) | Inline: `_cursorNextOnsetT = audioNow + 0.005` | `grain.js:1195` | When cursor onset falls behind `audioNow`, snaps 5 ms into the future instead of scheduling in the past. Avoids `InvalidStateError`. | None | Onset recovery after scheduler jitter | Sonic | No — hardcoded safety margin. |
| **43** | **Seed frame throttle** | 66 ms (~15 fps) | Constant: `_SEED_FRAME_INTERVAL_MS = 66` | `ui-presets.js:607` | Throttles seed preview animation to 15 fps. Prevents excessive redraws during seed playback visualization. | None | Seed preview smoothness vs CPU | Visual | No — hardcoded constant. |
| **44** | **Handsfree tick interval** | 33 ms (~30 fps) | Constant: `TICK_INTERVAL_MS = 33` | `handsfree.js:31` | Rate at which handsfree gate analysis runs (called from meter loop). | None | Handsfree gate responsiveness | Perceptual | No — hardcoded constant. |
| **45** | **Trail projection budget** | 120 projections/frame (shared across all moving seeds, max 40/trail) | Constant: `_TRAIL_BUDGET = 120` | `renderer.js:68` | Hard cap on total 3D→2D projections for seed trails per render frame. Protects scheduler from canvas stalls. | None | Trail visual fidelity, render loop cost | Visual + structural | No — hardcoded constant. Critical performance invariant. |
| **46** | **Hann envelope length** | 128 samples | Constant: `HANN_LEN = 128` | `state.js:41` | Length of pre-computed attack and release envelope curves. At 48 kHz = 2.67 ms fade. | None | Grain fade-in/fade-out shape, minimum grain length | Sonic | No — constant, pre-computed at module load. |
| **47** | **Experimental gesture: smoothing window** | 30 frames (~0.3 s @ 100 Hz) | Constant: `SMOOTH_WINDOW = 30` | `exp/gesture.js:41` | Moving average window for gesture intensity smoothing. Tuned for 100 Hz IMU input. | IMU native rate (#21) | Gesture smoothness extraction | Perceptual | Not without code change. Would need retuning if IMU rate changes. |
| **48** | **Experimental gesture: periodicity window** | 150 frames (~1.5 s @ 100 Hz) | Constant: `PERIO_WINDOW = 150` | `exp/gesture.js:52` | Autocorrelation window for detecting periodic movement patterns. Tuned for 100 Hz. | IMU native rate (#21) | Periodicity feature extraction | Perceptual | Not without code change. |
| **49** | **Experimental gesture: energy decay** | 0.993 per frame (~1 s half-life @ 100 Hz) | Constant: `ENERGY_DECAY = 0.993` | `exp/gesture.js:48` | Exponential decay factor for accumulated gesture energy. System "remembers" energy that fades over time. | IMU native rate (#21) | Gesture energy feature | Perceptual | Not without code change. |
| **50** | **Experimental gesture: UI sync** | 66 ms (~15 fps) | Constant: `UI_SYNC_INTERVAL = 66` | `exp/gesture.js:577` | Throttles experimental gesture panel DOM updates. | None | Gesture visualization responsiveness | Visual | No — hardcoded constant. |
| **51** | **Mobile readout refresh** | 100 ms | `setInterval(..., 100)` | `mobile.js:207` | Device list / status refresh interval on mobile setup screen. | None | Mobile setup UI responsiveness | Visual | No — hardcoded interval. |
| **52** | **Waveform preview rAF gate** | Single-shot (1 per rAF) | `requestAnimationFrame` guard with ID check | `ui-presets.js:2165–2171` | Prevents concurrent waveform redraws during rapid slider input. At most one redraw per display frame. | Display rate (#20) | Waveform preview smoothness | Visual | No — architectural pattern. |
| **53** | **Spatial index rebuild rate** | 5/sec max (200 ms throttle) | Constant: `LIVE_REBUILD_INTERVAL_MS = 200` | `state.js:137` | How often the spatial search index (k-d tree or similar) is rebuilt during live recording/painting. New particles deposited between rebuilds exist visually but are not searchable by the grain scheduler. | Particle deposit rate (#18) | Grain candidate selection accuracy during live capture | Sonic — up to 200 ms window where new particles can't be found as grain candidates | No — hardcoded constant. |

---

## Key Dependency Chains

```
Hardware DAC
  └─→ Audio sample rate (48kHz)
        ├─→ Render quantum duration (2.67ms)
        │     ├─→ Worklet block rate (375/sec)
        │     │     ├─→ Recording capture batch (16×128 = 2048 samples, 42.7ms)
        │     │     ├─→ Quad capture batch (8×128 = 1024 frames, 21.3ms)
        │     │     └─→ Input meter ring buffer (32768 samples, 683ms)
        │     ├─→ Min grain duration floor (5.3ms = 2 quanta)
        │     └─→ Audify output buffer (1024 frames, 21.3ms)
        │           └─→ IPC audio credits (8 × 21.3ms = 170ms pipeline depth)
        ├─→ FFT analyser (256 samples → 5.3ms window, 187.5Hz bins)
        ├─→ Recording limit (600s × 48000 × 4 bytes ≈ 115MB)
        └─→ Hann envelope (128 samples = 2.67ms fade)

Grain scheduler tick (20ms / 50Hz)
  ├─→ Scheduler lookahead (40ms = 2× tick)
  │     └─→ Grains-needed-per-tick budget (LOOKAHEAD / period)
  ├─→ Max grains per tick (12) × 50 ticks = 600 creations/sec
  ├─→ DOM update rate (every 25th tick ≈ 4Hz)
  └─→ Grain period (user, 10ms floor)
        ├─→ Grain onset rate (1/period, max 100/sec)
        └─→ Concurrent voices (duration/period, capped at 150)
              └─→ Pressure throttle (>75% = >112 nodes → halve budget)

Monitor refresh (~60Hz)
  └─→ requestAnimationFrame (~60Hz)
        ├─→ Render gate (30fps time-gate)
        │     ├─→ Particle deposit (every 3rd frame ≈ 10/sec)
        │     │     └─→ Spatial index rebuild (200ms throttle ≈ 5/sec)
        │     │           └─→ Grain scheduler candidate search (50Hz)
        │     ├─→ Seed trails (120 projection budget/frame)
        │     └─→ All particle/seed/cursor drawing
        ├─→ Mouse/touch input coalescing (1 flush per rAF)
        └─→ Secondary rAF loops (meters, IMU setup, gesture viz)

IMU hardware (BNO085 ~100Hz)
  └─→ Max metro poll (20ms / 50Hz)
        └─→ WebSocket → osc.js → S.imuQuat/imuEuler
              ├─→ Camera orientation (consumed at render rate, 30fps)
              ├─→ Cursor position (consumed at scheduler rate, 50Hz)
              ├─→ Sensor mapping (consumed at render rate, 30fps)
              └─→ Exp gesture (tuned for 100Hz: windows 30/150 frames)
```

---

## Rate Categories at a Glance

| Category | Rates | Range |
|----------|-------|-------|
| **Audio-rate** | Sample rate, render quantum, worklet blocks | 375–48000 /sec |
| **Scheduler-rate** | Grain tick, lookahead, onset clock | 50–100 /sec |
| **Display-rate** | rAF, render gate, input flush | 30–60 /sec |
| **UI-rate** | Slider throttle, DOM updates, autosave | 0.5–33 /sec |
| **Sensor-rate** | IMU hardware, Max metro, serial | 50–100 /sec |
| **Batch-rate** | Recording capture, quad capture, IPC | 23–47 msg/sec |
| **Recovery** | WS reconnect, re-anchor, rebuild | 0.03–5 /sec |
