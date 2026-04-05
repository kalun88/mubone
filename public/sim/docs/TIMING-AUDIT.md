# Timing & Scheduling Audit — mubone

**Date:** 2026-04-04
**Scope:** Every timing interval, polling rate, and scheduling value in the codebase, audited for inefficiency, wasted work, and optimization opportunities.

---

## Finding 1 — Unthrottled rAF Meter Loop (60fps → should be 30fps)

**Files:** `js/ui-audio-settings.js` lines 352–366
**Impact:** Medium
**Category:** Excessive polling

The audio settings meter loop runs an unconstrained `requestAnimationFrame` at ~60fps. Each tick calls `tickMeters()` which, for every channel (2–32), reads 256 samples via `getFloatTimeDomainData()`, computes peak RMS, and performs canvas draw operations. At 8 channels this is ~2,048 float reads + 8 canvas repaints per frame — twice as often as the eye can distinguish.

The loop does stop properly when the audio settings modal closes (via `stopMetering()` / `cancelAnimationFrame`), so it's not a leak. But while open, it's doing double the necessary work.

**Recommendation:** Add a 30fps time-gate identical to the one in `renderer.js`:
```javascript
const elapsed = now - lastMeterTime;
if (elapsed < 33.33) { as.meterRAF = requestAnimationFrame(tick); return; }
```
Saves ~50% CPU on meter rendering with zero perceptual difference.

---

## Finding 2 — Unthrottled rAF IMU Readout Loop (60fps → should be 20fps)

**Files:** `js/ui-imu-setup.js` lines 139–153
**Impact:** Medium
**Category:** Rate mismatch (producer vs consumer)

The IMU readout loop calls `updateAllReadouts()` at 60fps to display Euler angles in the IMU setup panel. But the x-IMU3 sensor data arrives at ~50–100 Hz (set by the Max `metro 20` or the device's native rate). Displaying at 60fps means ~30% of frames show stale data, doing DOM writes for no reason.

The loop stops properly when the panel closes.

**Recommendation:** Throttle to 20fps (50ms gate). Sensor readout text can't usefully update faster than the data source. This saves ~67% of the DOM writes.

---

## Finding 3 — Unthrottled Gate Meter Drag

**Files:** `js/ui-meters.js` ~line 576
**Impact:** Medium
**Category:** Throttling gap

The noise-gate threshold drag handler fires a `mousemove` listener at 60Hz+ with no rAF gating. Each event immediately updates `S.vizNoiseFloor` and triggers a canvas redraw. During a drag, this generates ~60 canvas repaints per second outside of any frame budget.

**Recommendation:** Wrap in the same `requestAnimationFrame` coalescing pattern used by the main canvas mousemove handler in `events.js` (the `_inputRAFPending` pattern).

---

## Finding 4 — Unthrottled Waveform Crop Drag

**Files:** `js/ui-samples.js` ~line 267
**Impact:** Medium
**Category:** Throttling gap

The sample waveform crop-drag handler binds `document.onmousemove` with no throttling. Each 60Hz+ mouse event triggers a full canvas clear plus multiple `fillRect()` calls. This runs outside the render loop's frame budget and competes for main-thread time.

**Recommendation:** rAF-gate the drag handler, coalescing to one canvas update per frame.

---

## Finding 5 — Unthrottled Wheel Events

**Files:** `js/events.js` ~line 764
**Impact:** Low–Medium
**Category:** Throttling gap

Scroll wheel events (which fire 10–50 times/sec on a trackpad) are dispatched immediately through `_dispatchAction()` with no rAF gating or debounce. Each event can write to grain parameters. If mapped to density or speed, this creates redundant state mutations that the 30fps render and 20ms scheduler can't keep up with.

**Recommendation:** rAF-gate wheel events, processing only the most recent delta per frame.

---

## Finding 6 — Unthrottled Window Resize

**Files:** `js/events.js` ~line 761
**Impact:** Low
**Category:** Throttling gap

The `resize` event handler calls both `resizeCanvas()` (WebGL viewport setup) and `drawPresetWaveform()` on every pixel change during a window drag — potentially 60+ times per second. These are moderately expensive operations (canvas dimension recalculation + waveform SVG redraw).

**Recommendation:** Debounce with `setTimeout(..., 100)` or rAF-gate. Resize events during window drag don't need per-pixel response.

---

## Finding 7 — OSC/IMU Message Processing at 50Hz Without Batching

**Files:** `js/osc.js` lines 84–91, `js/imu-setup.js` ~line 1037
**Impact:** Low–Medium
**Category:** Rate mismatch

Each quaternion message from the IMU (arriving at ~50 Hz from the Max `metro 20`) is processed synchronously: quaternion → Euler conversion (6+ trig calls), axis remapping, custom routing dispatch. At 50 Hz, that's ~300 trig calls/sec plus state mutations, all on the main thread.

The UI sync for grain controls is already rAF-debounced (good), but the trig-heavy conversion work itself is not batched. If two IMU messages arrive within the same 20ms scheduler tick, both are processed fully even though only the latest matters.

**Recommendation:** Consider a "latest wins" pattern: store incoming quaternion data and process only the most recent value once per rAF tick. This halves trig work when messages bunch up. Low urgency — current 50Hz rate is manageable, but would matter if a second IMU is added (doubling the rate).

---

## Finding 8 — MIDI CC Messages Not Coalesced

**Files:** `js/midi.js` ~line 345
**Impact:** Low
**Category:** Throttling gap

Every MIDI CC message fires immediately through `handleMidiMessage()` → `dispatchAction()`. Fast MIDI controllers (e.g., continuous ribbon controllers, high-res encoders) can send 60+ CC messages/sec. Each triggers immediate state writes and potentially grain parameter updates.

**Recommendation:** For CC messages mapped to continuous parameters, coalesce to one update per rAF frame (store latest CC value, flush on animation frame). Note: note-on/off and transport messages should remain immediate.

---

## Finding 9 — Grain Scheduler Never Stops

**Files:** `js/main.js` line 497
**Impact:** Medium
**Category:** Unnecessary wake-ups

The grain scheduler (`setInterval(scheduleGrains, 20)`) starts on page load and runs every 20ms for the entire page lifetime. There is no `clearInterval` call anywhere in the codebase for `S._grainSchedulerId`. Even when audio is stopped, muted, or the AudioContext is suspended, the scheduler ticks 50 times per second, walking the particle array and computing grain onsets that are immediately discarded.

**Recommendation:** Add early-exit or pause logic. Options:
1. Check `S.audioCtx.state === 'suspended'` at the top of `scheduleGrains()` and return immediately.
2. Clear the interval when audio stops; restart when it resumes.
3. At minimum, add an `unload` handler to clear the interval on page teardown.

Option 1 is simplest and safest (no risk of failing to restart).

---

## Finding 10 — Auto-Save Interval Never Stops, No Handle Stored

**Files:** `js/ui-audio-settings.js` line 1510
**Impact:** Low
**Category:** Unnecessary wake-ups

`startAutoSave()` calls `setInterval(_checkAndSave, 2000)` but never stores the returned ID, so it can never be cleared. The check serializes the full audio settings snapshot to JSON every 2 seconds and compares strings. This is a permanent 0.5 Hz serialization cost for the page lifetime.

**Recommendation:** Store the interval ID. Provide a `stopAutoSave()` or, better, switch to a change-event pattern: trigger saves from setter hooks on settings rather than polling.

---

## Finding 11 — Canvas `arc()/fill()` Is the Primary Scheduler Threat

**Files:** `js/renderer.js` lines 631–664
**Impact:** High (on lower-end hardware)
**Category:** Critical path threat

The particle rendering loop calls `ctx.arc()` + `ctx.fill()` per particle (potentially 500+ times per frame with glow pass). `arc()` involves internal trig; `fill()` is synchronous and blocks until GPU rasterization is submitted. On modern desktop hardware this completes in 5–10ms. On mobile or integrated GPUs, frame time can reach 20–25ms — which **exceeds the 20ms grain scheduler interval**, causing scheduler drift.

The 30fps throttle (33ms frame budget) gives the scheduler room on desktop, but on slower hardware the margin evaporates.

This is already documented in `CLAUDE.md` as a known risk (the Mar 29 optimization pass addressed the worst case with trail budgets and zero-alloc projection).

**Recommendation:** No immediate action needed — the existing mitigations (`_TRAIL_BUDGET`, `perfMode`, `projectInto()`) are effective. But be vigilant: any new per-frame canvas work must be profiled against scheduler drift. Consider adding an adaptive FPS reduction if `perf.schedulerDrift` exceeds a threshold (e.g., drop from 30fps to 20fps automatically).

---

## Finding 12 — Experimental Gesture Viz at 60fps

**Files:** `js/exp/gesture-viz.js` ~line 272
**Impact:** Low
**Category:** Excessive polling

The gesture visualization canvas runs an unconstrained rAF loop at 60fps. Each tick smooths 4 feature values and draws a phase plot, sparklines, and trails (~50 canvas operations). The underlying gesture data updates at IMU rate (~100 Hz), but the visual display doesn't benefit from >30fps.

Only active behind the `?exp` flag, so no impact on production. But when enabled, it adds to main-thread contention.

**Recommendation:** Throttle to 30fps (same time-gate as the main renderer). Easy win if experimental mode is ever promoted.

---

## Finding 13 — Recording Worklet Batch Size High on Mobile

**Files:** `js/worklets/recording-capture.worklet.js` lines 11–17
**Impact:** Low
**Category:** Buffer sizing

The recording capture worklet batches 16 × 128 = 2,048 frames before posting to the main thread. At 48 kHz this is a message every ~43ms (fine). At the mobile sample rate of 22,050 Hz, this becomes a message every ~93ms — meaning if the main thread stalls for >93ms, the worklet's ring buffer could overflow (safely handled by discarding old data, but recording fidelity suffers).

**Recommendation:** Consider a mobile-specific batch size of 8 (yielding ~46ms at 22 kHz), or make it configurable via the worklet's `init` message.

---

## Things That Are Well-Designed (No Action Needed)

**Analyser nodes (6 total):** Each taps a different point in the signal chain (input, master, dry, stereo L/R, per-speaker). No consolidation opportunity — they serve distinct purposes and are read at appropriate rates.

**Main canvas mousemove/touchmove:** Properly rAF-gated via the `_inputRAFPending` flag in `events.js`. This was clearly designed to protect the scheduler.

**Sensor mapping evaluation:** Called once per render frame at 30fps in `renderer.js`, not per-message. Good rate discipline.

**Mobile gyro readout (100ms interval):** Properly lifecycle-managed via MutationObserver on the settings panel's `.open` class. Starts on open, stops on close. 10 Hz is appropriate for a text readout.

**Quad-capture worklet (batch=8, 1024 frames):** Message rate of ~21ms at 48 kHz aligns well with the grain scheduler's 20ms interval. Well-tuned.

**Input-meter worklet ring buffer (32,768 samples):** ~100ms capacity per channel with robust overflow handling (snaps read cursor forward). Sound defensive design.

**Trail budget (`_TRAIL_BUDGET = 120`):** Effectively caps the projection cost of moving seed trails per frame. Reduced from 200 after the Mar 29 optimization pass.

---

## Priority Summary

| # | Finding | Impact | Effort | Priority |
|---|---------|--------|--------|----------|
| 11 | Canvas arc/fill scheduler threat | High | Design-level | Monitor (mitigations exist) |
| 9 | Grain scheduler never stops | Medium | 3 lines | **Do first** |
| 1 | Meter loop at 60fps | Medium | 4 lines | **Do second** |
| 2 | IMU readout at 60fps | Medium | 4 lines | **Do second** |
| 3 | Gate meter drag unthrottled | Medium | 8 lines | **Do second** |
| 4 | Waveform crop drag unthrottled | Medium | 8 lines | **Do second** |
| 7 | OSC messages not batched | Low–Med | 15 lines | Nice to have |
| 5 | Wheel events unthrottled | Low–Med | 6 lines | Nice to have |
| 10 | Auto-save never stops | Low | 4 lines | Nice to have |
| 8 | MIDI CC not coalesced | Low | 12 lines | Nice to have |
| 6 | Resize unthrottled | Low | 4 lines | Nice to have |
| 12 | Gesture viz at 60fps | Low | 4 lines | Exp-only |
| 13 | Recording batch size on mobile | Low | 6 lines | Nice to have |
