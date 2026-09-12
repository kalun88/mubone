# Performance and latency audit — 2026-09

> **Status: PROPOSAL — NOT IMPLEMENTED** · measured 2026-09-06 on the day the audio hops left the GUI thread (commit 8549fbc). The numbers in § 1–2 are real and reproducible with the commands in § 5; the plan in § 3 is ranked; R6 (the instrumentation, #341) and R2 (the audio host, #339) are built, the rest is not. The priority throughout, Ek's: **sound first, then the lowest latency that keeps it clean.** Written for the session that implements it: every item names the files, the mechanism, the risk and how to prove it.

## Read this first

- The wet-brush crackle of 2026-09-05 was **not the rendering**. Every output block and input chunk crossed the renderer's main thread, and a stall there longer than the cushion was a hole: 30 ms dropped one block, 60 ms dropped eleven, 120 ms thirty-four. Fixed 2026-09-06 (`docs/RULINGS.md` "the two IPC hops are bounded"): both hops are MessagePorts worklet ↔ main process, and main regulates the queues to the cushion. After: nothing dropped, skipped or dry through 500 ms GUI stalls.
- What is left between the player and clean sound is **main-process jitter** and **the audio thread's own load**, and both are now countable: `S.transportDiag.outDry` / `inDry` (a hole that played), `outDropped` / `inSkipped` (a lead skipped back). `wg.status()` prints them; Settings → Audio's cushion row shows them live.
- The one big latency lever left is **the cushion**: 20 ms per side today. At 10 ms the output ran clean under every load tried; the input ring ran dry once in 24 s at idle. On Ek's laptop at 10 ms, fifteen minutes of intense recording gave 15 output holes and 19 input holes (`wg.status()`, 2026-09-06) — about one a minute, during take churn — while an idle minute showed main-process round trips under 7 ms. The plan's first two items are about making 10 ms (and lower) safe. **Done 2026-09-06:** R2, R4, R5, R3 and R8 are in, and 10 ms is the default (R1) — Ek's laptop ran 58 takes at 10 ms with zero cumulative faults; 5 ms is a choice.

## 1. What was measured

All on the MacBook Air's built-in speakers and microphone, 48 kHz, 128-frame RtAudio buffers, a private instance with 3000 wet marks under the cursor. Commands in § 5.

### 1.1 The GUI thread, before and after

| Injected main-thread stall | Before (relay through the GUI thread) | After (direct ports) |
|---|---|---|
| 15 ms | absorbed | absorbed |
| 30 ms | 1 block dropped per stall | nothing |
| 60 ms | 11 dropped | nothing |
| 120 ms | 34 dropped | nothing |
| 250 ms, 500 ms | not tried | nothing dropped, skipped or dry |

The render loop with 3000 marks: 0.8 ms mean per animation frame, never above 6 ms. Opening the sheet and rebuilding the rail: about 1 ms each. Sheet drags at 60 Hz: no main-thread gap over 6 ms. The drawing was never the problem at this scale.

### 1.2 The hops under load (`scripts/transport-probe.js`)

| Phase (24 s each) | outDry | outDropped | inDry | inSkipped | out depth ms | in fill ms |
|---|---|---|---|---|---|---|
| cushion 20, idle engine | 0 | 0 | 0 | 0 | 21–27 | 21–24 |
| cushion 10, idle engine | 0 | 0 | **1** | 0 | 11–16 | 10–15 |
| cushion 10, OSC flood ~800 msg/s through main | 0 | 0 | 0 | 0 | 11–16 | 13–15 |
| cushion 10, flood + 250 active grains + lens "all" (545 candidates/tick) | 0 | 0 | 0 | 0 | 8–16 | 13–15 |
| cushion 20, idle again | 0 | 0 | 0 | 0 | 19–24 | 18–21 |

Read: the output hop is clean at 10 ms under everything tried, including a sensor stream twice as busy as one x-imu3. The input hop is one hole per 24 s away from 10 ms at idle — a main-process hiccup of more than 10 ms between two RtAudio input callbacks (the dev bridge polls the file system every 250 ms in this process; `npm run electron` has no bridge). The audio thread at a full pool never lagged the wall clock and never starved the device.

### 1.3 The latency budget the app adds

From `js/latency.js estimateFrom` with the streams' own reports (RtAudio: output 70 frames, input 0 frames on the built-in device). The devices' share (Apple's built-in pair measured ~55 ms in the loopback calibration) is outside this table.

| Stage | ms at cushion 20 | ms at cushion 10 |
|---|---|---|
| RtAudio input buffer (128 frames) + stream | 2.7 | 2.7 |
| input ring pre-roll (the cushion) | 20 | 10 |
| grain scheduler tick (cursor → candidates, worst case) | 20 | 20 |
| Web Audio quantum + capture batch (128 frames) | 2.7 + 2.7 | 2.7 + 2.7 |
| output queue (the cushion) | 20 | 10 |
| RtAudio output buffer + stream (128 + 70 frames) | 2.7 + 1.5 | 2.7 + 1.5 |
| **monitoring round trip (mic → speakers), app share** | **≈ 47** | **≈ 27** |
| **cursor gesture → new grain, app share** | **≈ 45** | **≈ 35** |

The scheduler tick is a latency the monitor path never sees but every gesture does.

## 2. Findings, by mechanism

- **F1 — the cushion is the lever.** Two-thirds of the app's monitoring latency is the two cushions. They are there for main-process jitter now, nothing else. 10 ms is clean on the output today; the input needs either a de-jittered main process (F2) or a target with a small margin above the cushion.
- **F2 — the main process is a shared thread.** OSC receive and forward (one `webContents.send` per packet), x-imu3 discovery and data, the serial bridge, the dev bridge's 250 ms synchronous polling, every `ipcMain.handle`, and now both audio ports run on one event loop. Under the 800 msg/s flood the audio hops still held at 10 ms, so the jitter is small — but it is the thing that sets the floor, and the floor is what Ek hears as latency.
- **F3 — the audio thread allocates.** The candidate list is structured-cloned INTO the audio thread's isolate every 20 ms (545 objects in the stress run; 3000 in lens "all" on a dense set), the live-recording path allocates a chunk inside `process()` when a take crosses a chunk boundary (`grain-engine.worklet.js` "liveRecording", `this._liveChunks.push(new Float32Array(cs))`), and the 30 Hz feedback builds an `Array.from` per post. Each is a garbage-collection trigger on the thread whose deadline is 2.67 ms. Nothing dry was measured today, which says the allocations are small enough at this load — not that they are free at a show's.
- **F4 — the grain loop is sample-major.** `process()` walks all 256 pool slots per sample (`_gActive[i]` check ×128 per block even when empty), calls `_readSample` / `_readLiveChunked` and `_envelope` per active grain per sample, and branches on the buffer kind per sample. Measured with R6: 41 % mean and 58 % peak of the audio thread at 186–251 grains, stereo, with a 2 ms block in a 2.67 ms budget. On an 8-channel rig the per-sample mix loop scales with channels; on a hot laptop the clock scales down. Headroom is thinner than it looked.
- **F5 — two capture streams open on the mic.** In Electron `requestMicAccess` (`js/main.js:234`) opens getUserMedia at boot even when RtAudio input is the live path (`js/ui-audio-settings.js setupRtAudioInputMeters` severs its graph but the WebRTC capture stays open). Two clients on one interface; CPU for a stream nobody hears.
- **F6 — two clocks.** The Web Audio context is clocked by the OS default output device, RtAudio by the interface. On a rig they are the same device (`docs/RIG-RUNBOOK.md` § 4.9) and no drift was seen in 12 s here; on different devices a slow drift ends as a periodic skip or dry, now counted.
- **F7 — the scheduler shares the GUI thread.** A GUI stall no longer costs a hole, but it still freezes the cursor's candidate list for its length — the instrument stops following the hand. 20 ms tick, `GRAIN_SCHEDULER_INTERVAL_MS`.
- **F8 — the instrumentation was one-sided.** Holes were counted; the audio thread's load and the main process's event-loop gaps were not. R6 (built the same day) added both, so a hole is now attributable: `wg.status()` prints the main process's longest gap and its counts over 10 and 20 ms beside the audio thread's load, longest block and live-chunk allocations.

## 3. The plan, ranked

Impact is on sound and latency in that order; effort is a working day unit; each item says how it is proved.

### R1 — cushion 10 ms as the rig default (R6 and R2 are in; the proof is Ek's rig)
- **Gain:** −20 ms monitoring round trip, −10 ms gesture-to-grain. The single largest latency win available.
- **Where:** `js/state.js audioCushionMs`, `js/ui-audio-settings.js setAudioCushion` (the choices `[10, 20, 30, 50]`), `electron-main.js primeBlocks`, `js/worklets/input-meter.worklet.js _targetFrames`.
- **How:** either R2 first, or give the input ring's target a fixed jitter allowance above the cushion (target = cushion + 5 ms; the latency model in `js/latency.js estimateFrom` adds the same). Then add 5 ms as a choice (two blocks at 128 is the floor the formula already enforces).
- **Prove:** `scripts/transport-probe.js` at 10 ms with the flood: 0 dry and 0 dropped over 5 minutes, on the rig's interface, with the sensor connected.

### R2 — audio I/O in its own process — DONE 2026-09-06 (#339)
- **Built:** `audio-host.js`, a utility process with nothing on its loop but audify's two streams, the queue regulation and the two audio ports; `electron-main.js` spawns it, forwards each port with `utilityProcess.postMessage(msg, [port])`, relays the stream requests, and keeps device enumeration on its own RtAudio instance (`getDevices()` holds a loop 65 ms). `electron-loop-probe.js` is shared, so `wg.status()` reports three loops: the host, the audio thread, the browser thread.
- **Measured with it:** the host's loop gapped at most 1.5 ms in any phase of `transport-probe.js` — idle, the 800 msg/s sensor flood, the full pool with the lens in "all" mode — with **zero holes, drops or skips at a 10 ms cushion throughout**, where the same run on the main process gapped 7 ms quiet and over 20 ms under contention. Decided by Ek's own readout at 10 ms before the change: the browser thread gapped over 20 ms eight times in a set, 157 ms once, and none of it was our JavaScript.
- **Gain:** the audio hops stop sharing an event loop with OSC, the sensor bridges, the serial bridge, every IPC handler and the dev bridge. The cushion can then be the device's jitter alone: 5 ms is plausible.
- **Where:** new `audio-host.js` run by `utilityProcess.fork` from `electron-main.js`; audify, `createOutputStream` / `createInputStream`, `onOutputBlock` and the regulation move there whole; `ipcMain.on('audio-port')` forwards each `MessagePortMain` to the child with `child.postMessage({ kind }, [port])`; `set-audio-device`, `set-input-device`, `get-output-depth`, `get-stream-latency`, `set-audio-cushion`, `get-audio-devices`, `get-input-devices` become request/response over the child's channel.
- **Risk:** a native addon in a utility process (audify) — verify on this Electron first with a ten-line script; device enumeration then happens in the child (one RtAudio instance per process is fine).
- **Prove:** transport-probe with the flood at cushion 10 and 5: 0 dry. Then the loopback measurement in Settings → Audio drops by two cushions and the loop still lands on the release (`trigger-audit.js` "the button, not the marks").

### R3 — candidates over a SharedArrayBuffer, and a 10 ms scheduler tick
- **Gain:** no allocation on the audio thread per tick (F3), no serialization of thousands of candidates on the main thread, and with the cost gone the tick can halve: −10 ms worst-case gesture-to-grain.
- **Where:** `js/grain-worklet-bridge.js _postWorkletCandidates` (the `cursorVoices` message and `_voBuckets`), `js/worklets/grain-engine.worklet.js` 'cursorVoices' and `_fireGrain` (reads `cands[ci]`), `js/state.js GRAIN_SCHEDULER_INTERVAL_MS`. The recording buffer is already a SAB (`_sabSampleRate`, `isCrossOriginIsolated()`), so the plumbing exists.
- **How:** one SAB per cursor voice slot: a header (count, generation) and a flat Float32/Int32 table of `bufIndex, offset, length, azDeg, elBias, particleId, radiusFade`; the bridge writes, bumps the generation, posts a two-field message; the worklet reads by index. Voice params stay in the message (they are small).
- **Prove:** the worklet load metric (R6) before and after at lens "all" on a dense set; `rig-audit.js "mark align"` and `pins` stay green.

### R4 — the grain loop, grain-major
- **Gain:** two to four times the headroom in `process()`: room for 8-channel rigs, longer grains, a 512-slot pool, or the same sound on a hotter, throttled laptop.
- **Where:** `js/worklets/grain-engine.worklet.js process()` render section, `_readSample`, `_readLiveChunked`, `_envelope`.
- **How:** keep an active-index list instead of scanning 256 slots per sample; per grain, render 128 samples into a per-grain scratch (interpolation, filters, envelope inlined), then mix the scratch into the channels with the VBAP weights once per block; keep the NaN guard per block.
- **Prove:** the load metric (R6) at 250 grains before and after; `npm test` (the worklet's unit tests) and `rig-audit.js "mark align"` green; A/B the sound of a wash by ear, then by a null test on a fixed seed if `_rand01` is made seedable.

### R5 — no allocation on the audio thread while recording
- **Gain:** the moment most exposed to a glitch — a take — loses its two allocations: the chunk pushed inside `process()` and the per-tick `liveBufferAppend` clone.
- **Where:** `js/worklets/grain-engine.worklet.js` "Accumulate live mic input" and 'liveBufferAppend'; `js/grain-worklet-bridge.js _flushLiveBuffer` / `_beginProvisionalRecording`; the feedback `Array.from` at "Periodic feedback".
- **How:** the bridge transfers a pool of spare chunks in at `liveRecStart` (and tops it up on each feedback) so `process()` only pops; the feedback posts a copy of a preallocated `Int32Array` view instead of an `Array`.
- **Prove:** a 60 s take with the load metric on: no allocation in `process()` (count them in `_diag`), 0 dry, `inDry` unchanged.

### R6 — instrumentation before any of the above — DONE 2026-09-06 (#341)
- **Built:** `_diag.loadPct` / `procMaxMs` / `chunkAllocs` in the grain worklet; the event-loop gap probe in `electron-main.js` over `get-output-depth` (`loopGapMaxMs`, `loopGaps10`, `loopGaps20`), mirrored as `S.transportDiag.mainGap*`; `wg.status()` prints both sides and, on a third line, WHO held the main loop: every ipcMain handler, socket and serial callback is timed (`timed()` in `electron-main.js`, longest synchronous run and count over 10 ms per name) and GC pauses are counted through perf_hooks. First reading: `get-audio-devices` (RtAudio enumeration, run at boot and whenever the device lists refresh) held the loop 65 ms, `set-input-device` 18 ms — the shape of the 131 ms gap Ek saw is a device call, and R2 or moving enumeration off the loop fixes it. `scripts/transport-probe.js` prints the numbers per phase. Also found and fixed: `scripts/dev-bridge.js` wrote its console capture and status file synchronously on the main loop — every take logged a line, so `npm run electron:dev` sessions carried disk-timed stalls into the hops.
- **Measured with it (2026-09-06):** the audio thread runs at 4 % idle and **41 % mean / 58 % peak with 186–251 active grains and the lens in "all" mode**, longest block 2 ms of a 2.67 ms budget — closer to the edge than the zero-dry counts suggested, which moves R4 up. The main process's longest event-loop gap in a quiet run was 7 ms; in a run contended by a second instance, every fault lined up with a gap over 10 ms (3 gaps over 10 ms → 3 input holes and 6 skipped blocks; 2 gaps over 20 ms → 2 output holes and 21 skipped blocks), and none with the audio thread. `Date.now()` is the only clock a worklet has, millisecond-coarse; summed over the 375 blocks between feedbacks it is a fair load figure.
- **Gain:** the numbers that decide R1–R4 and settle the next "it crackles" in minutes.
- **Where:** `js/worklets/grain-engine.worklet.js _diag` gains `loadPct` (accumulate `Date.now()` deltas around `process()` — millisecond resolution averages out over the 375 blocks between feedbacks) and `allocs`; `electron-main.js` gains an event-loop gap probe (a 1 ms `setTimeout` chain, max gap per second) reported over `get-output-depth`; `js/diag.js` prints both; `scripts/transport-probe.js` prints both per phase.
- **Prove:** the probe shows the load rising with the pool and the gap rising under the flood.

### R7 — 64-frame RtAudio buffers — DONE 2026-09-06 (laptop; the rig's interface is #347)
- **Gain:** −1.3 ms per side. Only after R2; only if the interface is clean at 64 (CoreAudio usually is).
- **Where:** `js/ui-audio-settings.js` buffer-size choices, `electron-main.js DEFAULT_BUFFER_FRAMES`, the capture batch (`batchSize = bufferFrames / 128` — at 64 the capture must post half-quanta or the block size stays 128 on the Web Audio side and the RtAudio side alone goes to 64).
- **Prove:** transport-probe at 64 frames, 0 dry.

### R8 — one client on the microphone
- **Gain:** CPU and a driver contention removed; no sound change.
- **Where:** `js/main.js:234 requestMicAccess()` and `js/audio.js requestMicAccess`; `js/ui-audio-settings.js setupRtAudioInputMeters` (which already severs the getUserMedia graph).
- **How:** in Electron, open getUserMedia only when RtAudio input is not the live path; stop the tracks of `S.recordingStream` when RtAudio input activates.
- **Prove:** `S.recordingStream` null while `window._rtAudioInputListening`; recording, the meters and the loopback measurement unchanged; `rig-audit.js trigger` green.

### R9 — the two clocks, measured
- **Gain:** knowledge. If a rig ever must run the engine and the interface on different devices, this is the number that says how often it will skip.
- **How:** transport-probe for 10 minutes with the context on the built-in output and RtAudio on an interface; read `outDropped` / `inSkipped` / dry per minute. If it matters, a resampling ring in `input-meter.worklet.js` and a rate trim in `onOutputBlock` (drop or duplicate one sample per N) replace the skips.

### R10 — the scheduler off the GUI thread
- **Gain:** a GUI stall never freezes the hand's candidates (F7). The last thread the instrument shares with the GUI.
- **Where:** `js/grain.js scheduleGrains` and its pool builders into a Worker with the particle table in a SAB; `js/grain-worklet-bridge.js` posts from the worker (a MessagePort transferred into the worklet, the pattern of 2026-09-06).
- **When:** after R3, which builds the SAB tables it needs. Large; a plan of its own.

### Watch, not act
- The paint ticker (200 Hz `setInterval`, `featuresFromBuffer` per deposit), the projector blit, and the scope's 50-shape redraw: all measured cheap; they now cost only GUI time.
- `perf.underruns` (wall clock vs audio clock) is a weaker signal than `outDry`; retire it from the perf monitor once R6 lands.

## 4. What the fix of 2026-09-06 changed, for the record
- `electron-preload.js openAudioPort`; `electron-main.js 'audio-port'`, `onOutputBlock` (prime, skip, dry / dropped counts), `set-audio-cushion`; `js/audio.js requestAudioPort`, `cushionBlocks`, the 1 Hz depth poll; `js/worklets/quad-capture.worklet.js` posts to its port; `js/worklets/input-meter.worklet.js` takes its port, pre-rolls, refills; `js/ui-audio-settings.js` attaches the input port. The credit window, its refunds and `sendAudioBuffer` / `onAudioInputBuffer` / `onAudioCredit` are gone.
- `scripts/trigger-audit.js` "the hops are bounded" freezes the GUI thread 80 ms and 250 ms and requires nothing dropped, skipped or dry.

## 5. How to reproduce the numbers

```
# the seven load phases (about four minutes); a second instance uses its own port
MUBONE_RIG_INSTANCE=probe MUBONE_RIG_PORT=7597 node scripts/transport-probe.js

# the GUI-stall assertions, inside the mapped suite
MUBONE_RIG_INSTANCE=probe MUBONE_RIG_PORT=7597 node scripts/rig-audit.js trigger

# in a running app: the counters
wg.status()          # transport faults since load
S.transportDiag      # the same, as numbers
```
