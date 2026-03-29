# Changelog

All notable changes to mubone are documented here.
Format: newest version first. Entries written at the end of each working session.

---

## 0.11 alpha — 2026-03-29

### Fixed
- **Undo during active recording** (#104) — undo while tracing/recording was splicing the live buffer out of `liveRecBuffers` while the worklet was still writing into it, desyncing `currentLiveBufferIdx` and breaking subsequent undos. Undo now cleanly stops the recording, runs normal undo (splice + reindex), then restarts recording with a fresh stroke so the performer keeps painting seamlessly. Also fixed a pre-existing bug where splicing a finished buffer below the active recording slot didn't adjust `currentLiveBufferIdx`.
- **Alt-lock blocking painting and undo** (#105) — alt-lock (freeze view, free mouse) was over-blocking: particle painting guard in renderer.js prevented spacebar/D-key/OSC recording from depositing particles while alt-locked. Removed the guard since the position calculation already uses frozen coords. Right-click undo on canvas also unblocked.
- **OSC trigger/bang actions missing button flash** — OSC-triggered actions (trace, sweep, commit drop/draw/release/clear, trace mode cycle) now produce the same visual button feedback as keyboard shortcuts by routing through `dispatchAction`. Added `_flash()` helper for consistent 180ms flash pattern.
- **Trace indicator not lighting from OSC** — `/trace 1` via OSC started recording but didn't toggle the `painting` class on `#paintIndicatorBtn`. The dispatch `recpaint` case now syncs the button. Sample paint (QWERTYUIOP via MIDI) also syncs.
- **Sweep via dispatch had no UI feedback** — `sweep` dispatch case was calling raw `sweep()` instead of `S._sessionSweep()` which wraps it with the button flash.

### Added
- **Performance mode toggle in viz settings** (#96) — on/off segmented toggle with ⇧P shortcut label. Syncs with keyboard shortcut and `/app/perfmode` OSC via `S._syncPerfModeUI` callback.
- **Factory reset expanded** — added 7 missing localStorage keys to factory reset: `mubone_darkMode`, `mubone_uiScale`, `mubone-hud-scale`, `mubone_fovDeg`, `mubone_edgeIndicator`, `mubone_edgeIndicatorSize`, `mubone_param_locks`, `grainDiagSnapshot`.

### Changed
- **OSC namespace redesign** (#102) — `/cursor/mute` → `/cursor/scan`, search params moved from `/grain/*` to `/search/*` (`/search/scope`, `/search/fill`, `/search/order`, `/search/radius`, `/search/k`, `/search/recency`). New paths: `/cursor/tare`, `/session/erase`, `/commit/selection`, `/app/darkmode`. Removed standalone `/record` (always paint into space — use `/trace`). Removed 10+ legacy aliases. All trigger/bang OSC handlers now route through `S._dispatchAction` for consistent UI feedback.
- **"rec + paint" renamed to "trace"** — GUI label, ACTIONS array, and OSC path all use "trace" terminology. Standalone "record" action removed — recording always paints into space.
- **Unused imports cleaned from osc.js** — removed 8 stale imports (`toggleNearestMode`, `dropSeqFromCursor`, `releaseCommit`, `clearAllCommits`, `clearAllSeqs`, `clearAllSeeds`, `setScanMuted`, `sweep`) after routing everything through dispatch.

---

## 0.10 alpha — 2026-03-28

### Fixed
- **Fullscreen grey border** (#92) — Electron fullscreen left body padding (`0.5rem 0.75rem`) and dark-grey background visible around the canvas. Added `body.electron-fullscreen { padding: 0; gap: 0 }` to eliminate the border. Browser fullscreen `::backdrop` also set to `#000`.
- **FOV vertical drift on pitch** (#88a) — FOV slider only controlled horizontal field of view (`focalLen` derived from `canvas.width`). When the canvas aspect ratio didn't match the projector (e.g. laptop 16:10 mirroring to 16:9 projector), vertical pitch caused the equator to drift from its physical position. Changed all six `focalLen` computation sites (`project()`, `screenToLonLat()`, and four renderer functions) to use `Math.min(canvas.width, canvas.height)`. The slider now controls vertical FOV, matching the standard 3D convention.
- **Worldlocked panning ignored frameQ** — headlocked spatial panning now correctly uses `cameraTransformInto()` (fused quaternion), and worldlocked mode no longer applies `frameQ` (was causing drift in two-IMU setups).
- **Cursor position in detethered mode** — grain scheduler, OSC loop-mode handler, seed plant/uproot/release, and sequence drop all now check `S.cursorQ` first (detethered cursor IMU) before falling back to mouse/camQ. Added `getCursorPos()` helper to centralize the pattern.
- **`stopLiveRecording()` didn't reset `_liveCopiedUpTo`** — incremental copy offset persisted across recordings, causing stale data in subsequent live buffers.

### Added
- **High-performance render mode** (Shift+P) — skips non-essential rendering when CPU pressure is high. Separate from perf monitor (p). OSC: `/app/perfmode`, MIDI mappable.
- **Max bridge indicator in top bar** (#92) — moved from floating `position: fixed` overlay (was obscuring the Learn button) to inline `<span>` in the sensor group, left of "sensor (connected)". Automatically hidden in fullscreen (inside top bar which is `display: none`).
- **HUD scale goes to zero** — HUD size slider now ranges 0–2.0×. At 0 the canvas edge bars and DOM HUD overlay are both hidden (label shows "off").
- **Editable numbox on viz sliders** — click any value label in viz settings to type a precise number. Clamps to slider min/max, Enter to confirm, Escape to cancel. Keyboard events stopped so typing doesn't trigger app shortcuts.
- **FOV slider refinements** — label updated to "vertical FOV", range narrowed to 10°–90°, step increased to 0.5° for easier targeting. Tooltip shows Nebula Capsule 3 Laser reference (~26° at 1.2:1 throw). FOV now persisted in audio settings snapshot.
- **Fullscreen button deduplication** — top-bar `fullscreenBtn2` now delegates to the HUD `fullscreenBtn` click handler (single source of truth). Unified `applyFullscreenState()` function updates both button labels, toggles `electron-fullscreen` class, and fires `resizeCanvas()`.
- **Electron fullscreen body padding fix** — `body.electron-fullscreen` zeroes padding and gap so the canvas-wrapper fills the viewport edge-to-edge.

### Changed
- **Incremental live buffer copy** — `rebuildLiveBuffer()` now only copies new samples since the last rebuild (~9,600 samples at 48kHz/200ms interval) instead of the entire recording buffer. Eliminates the linear-growth copy cost that caused stalls during long recordings.
- **O(N) k-selection in grain scheduler** — nearest-mode particle selection replaced O(N log N) `sort()` + `slice()` with a single-pass k-selection (`_buildCandidatePoolNearest`). At 16 seeds × 500 particles × 50 ticks/sec, this eliminates ~72K comparisons/tick.
- **Incremental angular distance stamps** — when painting adds new particles, only the new particles are stamped with cursor distance (was re-stamping all N particles on every `_particleVersion` bump). Cursor movement still re-stamps all.
- **Seed frame capture throttled** — `tickSeedRecording()` reduced from 50/sec to ~15/sec (66ms interval). Sufficient for gesture path resolution, eliminates 35 wasted `{...spread}` + `Object.entries` allocations per second.
- **Zero-allocation grain spatial math** — `playGrain()` now uses `spherePointInto()` / `cameraTransformInto()` with scratch buffers instead of allocating arrays per grain. Seed weight buffer reused via `.fill(0)` instead of `new Float32Array` per tick.
- **Fused camera quaternion in scheduler** — `updateFusedCamQ()` called at scheduler entry so headlocked panning uses the latest camQ/frameQ even when the scheduler fires between render frames.

---

## 0.9 alpha — 2026-03-28

### Added
- **Detethered cursor / two-IMU mode** (#31) — when both cursor-role and frame-role sensors are assigned, the cursor detethers from the viewport center and roams freely on the sphere. Frame IMU anchors the viewport (projector-mounted, floor-locked, or body-mounted — same code, different physical placement); cursor IMU controls where you paint and play. Activates automatically, no manual toggle.
- **`S.cursorQ`** — separate cursor orientation quaternion for detethered mode. `S.detethered` derived getter (`cursorQ !== null`).
- **`getSensorCursorQ()`** in sensor-registry.js — returns cursor-role quaternion only when frame-role is also active. Same processing pipeline as `getSensorCamQ()` (tare, axis map, custom layers).
- **Edge indicator** — off-screen cursor arrow drawn on canvas when detethered cursor is outside the viewport. On/off toggle and size slider (0.5–2.0×) in viz settings, persisted to localStorage.
- **Camera modal dynamic subtitle** — shows "1 sensor — cursor locked" or "2 sensors — cursor free" under the sensor option.
- **Role tooltips in sensor panel** — dropdown options now have descriptive tooltips (cursor: "Controls where you paint and play", frame: "Sets the world orientation", etc.).
- **Dual tare** — main tare button (Z/backtick) now tares both cursor and frame when both sensors are assigned.

### Fixed
- **Frame sensor gimbal lock** — frame exhibited pitch→roll coupling at 90° yaw because `cameraTransform()` applies `frameQ` directly but conjugates `camQ`. Fixed by conjugating `getFrameQ()` output to compensate for the asymmetry. Both sensors now use the exact same processing pipeline with identical visual behavior.
- **Paint-drop in detethered mode** — renderer.js paint-drop code now uses `getCursorLonLat()` when `S.cursorQ` is set, instead of always using `screenToLonLat()`.
- **Trace capture in detethered mode** — `ui-trace.js` `captureFrame()` now uses `getCursorLonLat()` when detethered, instead of always using mouse pixel coords.

### Changed
- **`getCursorLonLat()`** reads `S.cursorQ || S.camQ` — one-line change that propagates detethered cursor position to all downstream consumers (grain scheduler, seed morph, OSC broadcast, etc.).
- **Natural roll-muting in detethered mode** — physically rolling the cursor IMU has no effect on cursor position because `cursorQ` is only used for forward-vector projection (a point, not an orientation). This is a mathematical property of the architecture, not explicit muting code.
- **`cameraTransform()`** now has protective comments documenting the conjugation asymmetry between `camQ` and `frameQ`, with cross-references to `getFrameQ()`.
- **Mounting-aware tare** — `slotTare()` now selects tare strategy based on axis map configuration. Default flat mount (X = roll/forward) uses gravity-aligned tare (heading-only, preserves horizon). Non-flat mount (Y or Z = roll/forward) uses full-quaternion tare — captures the entire raw orientation and divides it out, so any physical mounting angle works cleanly with the Euler decomposition. Set axis map *before* taring. In detethered mode, roll is naturally muted on the cursor anyway, so the gravity tare's roll handling is irrelevant.

---

## 0.8 alpha — 2026-03-27

### Fixed
- **Electron: painting doesn't produce particles** (#77) — `startLiveRecording()` guard checked only `S.recordingStream` which is never set in Electron's RtAudio path. Added `hasRtAudioInput` alternative check. Also pre-loads recording-capture worklet via `warmUpAudioEngine()` in Electron startup.
- **Electron: getUserMedia conflict** (#78) — `startAudio()` in audio settings now skips `getUserMedia` when Electron RtAudio input is already active, preventing a conflicting second input stream.
- **Electron: fullscreen button label + canvas resize** (#79) — native `BrowserWindow.setFullScreen()` didn't fire the web `fullscreenchange` event. Main process now emits `fullscreen-changed` IPC; preload exposes `onFullscreenChanged` listener; events.js hooks it to update button label and fire `resizeCanvas()`.
- **Sensor tare correction for off-axis wrist mount** (#69) — gravity-aligned tare extracts only heading (yaw around Z/up), keeping the reference frame level. Auto-recenters on next render frame. Tilt-tare correction works with default axis mapping (X=roll).
- **Sensor mode pole/gimbal-lock fix** — replaced delta-based yaw/pitch tracking in renderer.js with a single absolute path via `applyAxisMapQuat()`. Forward-vector path now auto-selects the correct forward axis based on axis map configuration, avoiding gimbal lock when roll is muted.

### Added
- **Zero reference indicator on sphere** (#10) — visual meridian + equator marker showing where sensor zero is, so drift is visible over time. Toggleable via viz settings.
- **Recenter / drift correction** — `recenterCursor()` computes a shortest-arc rotation offset mapping current camera forward to front-center. Applied every frame. Composed with existing drift offset. (Button currently disabled pending further testing.)
- **Backtick (`) keyboard shortcut for tare** — quick tare from keyboard without opening sensor panel.
- **Sensor panel UI improvements** — tooltips on all axis map controls, caution notes for mounting orientation and roll axis requirements. Axis mute buttons disabled with explanation (known pole/yaw bug).
- **HUD scale and UI scale** — `S.hudScale` (canvas HUD) and `S.uiScale` (DOM) sliders with persistence.

### Changed
- **Sensor axis map refactored** — `applyAxisMapQuat()` rewritten with two clear paths: forward-vector (roll muted/unmapped) and Euler (all axes active). New `findForwardAxis()` helper auto-detects which physical axis is the pointing direction. `forwardVecFromQuat()` supports x/y/z forward axes, not just x.
- **Renderer sensor mode simplified** — removed 80+ lines of delta-based tracking code. Sensor mode now uses the same absolute `getSensorCamQ()` path for all cases, with axis lock applied on top.
- **Max controller patch updated** — expanded `mubone-controller.maxpat` with additional routing.

---

## 0.7 alpha — 2026-03-26

### Fixed
- **Loop fade-out mode broken** — fade path in `_stopSeqAudio` disconnected VBAP/panner nodes and nulled source/gain references immediately after scheduling the gain ramp, cutting audio before the fade could complete. Now defers all cleanup to the `ended` event (same pattern as play-to-end). Slot removal also deferred so grain scheduler doesn't interfere during fade.
- **`/seed/trail` OSC handler used undefined `val`** — was referencing MIDI handler variable instead of `values[0]`. Fixed.
- **`/seed/lock` OSC handler set wrong state** — was directly setting `S.seedLockEnabled` instead of cycling trace mode. Fixed.
- **`/seed/loopmode` referenced removed `S.seedSlots`** — updated to use `S.commitSlots` with `S.seedSlots` fallback.
- **`/seed/clear` and `/seed/uproot` called removed functions** — updated to call `clearAllCommits()` and `releaseCommit()`.
- **`/loop/mode` set wrong state** — was setting `S.seqModeEnabled` (removed). Now sets `S.commitMode`.
- **Overflow: drop/draw buttons stayed greyed when slots full** (#26) — buttons now only disable when overflow is off.
- **D-loop + trace conflict** (#27) — mutual exclusion via `_cLoopActive`/`_traceActive` flags with proper handoff on release.
- **Release-all didn't work** (#25) — ⌘D tap now releases one commit (nearest/farthest per `selectionMode`). Hold-to-clear removed; clear-all is GUI button only.
- **K count slider minimum range** (#15) — slider floor set to 30 so k can be set before painting.
- **Tooltip delay too fast with Learn off** (#21) — increased from 400ms to 3000ms.
- **`scan_toggle` key was 'X'** — corrected to 'S'.

### Added
- **Unified commit system** (#23) — clouds (particle-based) and loops (buffer-based) share a single `commitSlots[16]` pool. D key: tap=drop, hold=draw. Shift+D=cycle mode (cloud↔loop). ⌘D=release nearest/farthest. Three-function model: trace (spacebar) / scan (S) / commit (D). Selection mode (closest/farthest) for morph and release targeting. Legacy aliases preserve backward compatibility.
- **Trace mode cycle** (#28) — `S.traceMode` cycles through trace / trace+loop / trace+cloud. A key or button cycles mode. Trace+loop and D-loop are mutually exclusive with visual greying. Trace+cloud allows concurrent D-cloud drops with shelved seed recording.
- **Loop release mode: play-to-end** (#29) — `S.loopReleaseMode` ('fade'|'play-to-end'). Play-to-end disables loop flag on AudioBufferSourceNode, plays through to loopEnd with 50ms fade, auto-removes from slot via 'ended' event.
- **Configurable loop fade time** — `S.loopFadeTimeMs` (0–2000ms, default 15ms). New slider in loop subsettings. MIDI CC mappable, OSC `/commit/loop_fade_time`, preset save/load wired.
- **Canvas edge HUD** (#32) — 3-column top bar (A=trace, S=scan, D=commit) drawn in renderer.js, DOM text HUD with left/center/right layout, commit dots, patch info, HUD scale slider (0.5–2.0×) with localStorage persistence.
- **OSC commit handlers** — new `/commit/drop`, `/commit/draw`, `/commit/release`, `/commit/clear`, `/commit/mode`, `/commit/blend`, `/commit/tether`, `/commit/xfade`, `/commit/dir`, `/commit/attack`, `/commit/release_time`, `/commit/volume`, `/commit/speed`, `/commit/loop_release`, `/commit/loop_fade_time`, `/trace/mode`.
- **MIDI commit actions** — `trace_mode`, `commit_mode`, `commit_drop`, `commit_draw`, `commit_release`, `commit_clear`, `commit_slots`, `commit_overflow`, `commit_dir`, `commit_volume`, `commit_speed`, `commit_attack`, `commit_release_time`, `loop_release_mode`, `loop_fade_time`, `commit_blend`, `commit_tether`, `commit_xfade`. Legacy actions hidden from UI with `_legacy: true`.

### Changed
- **Cloud "attack"/"release" → "fade in"/"fade out"** — renamed across UI labels, state comments, patch table, grain.js, and improv panel. Consistent terminology with loop fade controls.
- **MIDI/OSC modules restructured** (#70) — ACTIONS array merged seed+loop groups into unified commit group. OSC dispatch rewritten for `/commit/*` and `/trace/*` paths. Legacy `/seed/*` and `/loop/*` handlers fixed for backward compatibility. Dead code removed (`seq_pause`/`seq_resume`, duplicate `seed_slots`/`seq_slots`).
- **Loop fade controls moved to loop subsettings** — fade out mode (fade/play→end) and fade ms slider relocated from cloud section to loop section in index.html.
- **Commit slot pool expanded** — MAX_COMMITS raised from 12 to 16, shared between clouds and loops.

---

## 0.6 alpha — 2026-03-24

### Added
- **Recording time meter** — HUD now shows total recorded audio duration next to the buffer count (`buffers: 3 · 2m14s`). Computed from live buffer durations, no expensive byte-counting.
- **Recording memory guard** — configurable limit (default 10 min) warns at 80% (amber) and 95% (red), blocks new recordings at 100% with "rec limit — sweep!" flash. Prevents silent tab crashes during long performances.
- **Rec limit slider** — new slider in audio settings → engine section. Range 2–30 minutes, persisted to localStorage.
- **Perf monitor rec bar** — new `rec` row in the performance monitor (P key) showing recorded time vs limit with amber/red thresholds.
- **Sweep auto-commit** — undo snapshot now auto-expires after 30s, freeing buffer memory even if the performer never paints again. Manual undo still works within the 30s window.

### Changed
- **Search panel restructured** — scope (area/nearest) is now the top-level decision, displayed first. Panel organized into two labeled sections: "selection" (k, order — always visible) and "area" (radius, recency, fill — hidden when scope is nearest). Area-only params disappear entirely in nearest mode instead of being greyed out.
- **Search terminology renamed** — "lock/snap/free" → scope: nearest/area. "k-all" → fill: all/k. "k-seq" → order: step/random. Updated across UI, MIDI table, OSC, patch table, and renderer.
- **Default button positions** — area, random, and k are now on the left of their toggle rows (default = left convention).
- **Area param order** — radius first, then recency, then fill (was fill, radius, recency).
- **Perf monitor k display standardized** — format is now `X / k (R) [W]` where X=firing, k=k-limit, (R)=in-radius pool (area mode only), [W]=world particle count (always shown). Nearest mode: `X / k [W]`. Area+all: `X all [W]`.
- **World particle count format** — k slider and perf monitor both use `[n]` square brackets for world particle count.
- **Canvas cursor label** — "snap" → "nearest" (violet text under cursor brush).

---

## 0.5 alpha — 2026-03-23

### Fixed
- **Surface mode: trackpad stuck at poles** — removed the `[-1,+1]` clamp on `_surfaceNY` that prevented the cursor from passing through the poles.
- **Surface mode: gimbal-lock bowing and roll** — replaced absolute yaw/pitch angle reconstruction with incremental world-yaw × local-pitch rotation (`camQ = qYaw * camQ * qPitch`). Straight trackpad lines now trace great circles at any orientation; no roll accumulation, no pole bowing.
- **Sensor mode: image spin at poles** — `applyAxisMapQuat` Euler decomposition entangled yaw and roll near pitch ±90°. Added a pole-safe forward-vector path (when roll is muted) that bypasses Euler entirely.
- **Sensor mode: bounce/snap at poles** — absolute orientation decomposition clamps pitch via `asin`, causing bounce-back and yaw snap at the poles. Replaced with delta-based tracking: each frame computes the small rotation since the last frame and applies it incrementally — same pattern as the trackpad fix. Continuous rotation through the poles now works in both modes.
- **Sensor mode: wrong axis mapping with roll muted** — forward-vector path used `[0,0,1]` but default axis map has X as forward. Fixed to `[1,0,0]`, producing correct yaw/pitch.
- **Sensor mode: roll mute toggle had no effect** — delta-based path always stripped roll. Now checks `rollMuted` flag: muted uses delta path, unmuted falls through to absolute 3DOF quaternion.
- **Shift+D / Shift+S button flash** — pressing Shift+D/S no longer causes the underlying bare-key buttons to visually flash.
- **k-all / k-nearest conflict** — k-all mode is now mutually exclusive with nearest lock. Toggling nearest forces k-all off; k-all toggle is disabled (greyed out) when nearest is active. Enforced everywhere: UI, MIDI, OSC, preset load, patch table.
- **k slider max capped at 20** — k slider now dynamically tracks total particle count, allowing selection up to the full particle pool. MIDI CC for k also scales to particle count.
- **Scroll hijacked radius** — default mouse wheel no longer adjusts search radius (was too easy to trigger accidentally). Radius is now keyboard-only ([ ] keys) or custom-bound scroll.

### Added
- **Sensor registry** (`sensor-registry.js`) — new generic sensor slot system. Sensors auto-discover from OSC messages (`/sensor/{name}/quaternion`, `/sensor/{name}/inertial`). Roles assigned per-stream (quaternion→cursor/frame, inertial→gesture). Replaces the old hardcoded cursor/wand/frame trio in `sensor.js`. Legacy `/space/*` addresses still work via aliases.
- **Sensor registry UI** (`ui-sensors.js`) — new modal panel (⊕ sensors button) showing all connected sensors, per-stream role assignment, axis map with sign/mute, tare controls, and live raw readouts. Replaces the old two-column sensor calibration modal.
- **Seed morph extraction** (`seed-morph.js`) — preset interpolation (`lerpPresets`) and gesture-driven morph (`updateGestureMorph`) extracted from the deleted `wand.js` into a standalone module.
- **Gesture extraction promoted to core** — `gesture.js` now loads for all users (not just `?exp`). Completely rewritten with new feature set: intensity (EMA of gyroMag), smoothness (coefficient of variation), periodicity (dominant-axis autocorrelation with hysteresis), accumulated energy (leaky integrator). Removed directness (required quaternion). Added signal conditioning chain (inRange, deadZone, curve, outRange, smoothing) controllable from the gesture panel.
- **Gesture panel** (`gesture-panel.js`) — new in-page modal for live gesture visualization. Shows sparkline trails with draggable inMin/inMax thresholds, per-feature conditioning controls, and a joystick morpher. Opened via ◎ gesture button or Shift+G. Replaces the old `?exp`-only canvas overlay.
- **Session panel** — new top-level panel in the right column with mute (M), undo (⌃Z), sweep (−), lock cursor (Alt), and erase all (⌫×3) buttons. Consolidates session-level actions that were previously scattered or keyboard-only.
- **Erase all** — triple-press Delete/Backspace clears all particles, buffers, strokes, seeds, and loops. Shows progress indicator (Del 1/3, 2/3) and supports one-level undo. Erase-all button also available in the session panel.
- **Sweep keyboard shortcut** — minus key (−) triggers sweep. When no seeds/loops are active, sweep now acts as erase-all (clears everything).
- **Sweep undo for erase-all** — sweep snapshot now captures seed and loop state, allowing full undo after erase-all.
- **Frame sensor rotation** — sensors assigned the "frame" role rotate the virtual sphere independently of the camera. `sphere.js` applies `S.frameQ` in `cameraTransform`, `getCursorLonLat`, and `screenToLonLat`. VBAP spatial panning in `grain.js` also applies frame rotation to world positions.
- **k performance meter** — new "k" row in the perf monitor showing actual particles selected per tick, k setting, and pool size. Helps diagnose selection behavior at a glance.
- **World particle count on k slider** — `/n` indicator next to the k numbox shows total particles in the world.
- **Radius/recency greyed out in nearest mode** — radius slider, recency slider, and k-all toggle are visually disabled when nearest lock is active (since they have no effect).
- **Sensor connected/not-connected labels** — top-bar sensor group now shows "(connected)" / "(not connected)" status text.
- **Camera rotation design note** — prominent comment block in `renderer.js` documenting the gimbal-lock-free rotation pattern and why absolute Euler reconstruction must not be reintroduced.
- **Architecture docs** — new "Camera Rotation (gimbal-lock-free)" section in `mubone-architecture-notes.md`.
- **Routing design doc** (`docs/ROUTING-DESIGN.md`) — design document for future custom signal routing layer.
- **TODO reorganized** — tasks grouped by workshop prep priorities (memory, multi-channel, reliability) with experimental features deferred.

### Changed
- **Sensor system rewrite** — `sensor.js` gutted to a stub; all sensor logic, calibration, and state moved to `sensor-registry.js`. `ui-sensor.js` deleted and replaced by `ui-sensors.js`. `wand.js` and `ui-wand.js` deleted entirely; morph engine moved to `seed-morph.js`.
- **OSC dispatch refactored** — `osc.js` now routes through the sensor registry's generic `/sensor/{name}/{type}` convention. Legacy `/space/cursor`, `/space/frame`, `/space/wand` addresses auto-create named slots with correct roles.
- **Gesture features overhauled** — removed directness (quaternion-dependent), added intensity. Smoothness changed from jerk-based to coefficient-of-variation. Periodicity uses dominant-axis autocorrelation with hysteresis instead of gyroMag autocorrelation. All features now have raw (pre-conditioning) and conditioned (post-chain) outputs.
- **Morph settings simplified** — removed `morphHoldMode` (momentum/elastic), `morphElasticRate`, and `morphEnabled` from state and patch table. Morph behavior is now always momentum-based.
- **exp-init.js slimmed** — gesture and gesture-viz modules removed from experimental loader (they're now core). `?exp` flag only sets `S.exp = true` and shows the badge.
- **Search tooltips rewritten** — all search parameter tooltips (lock, k-all, k-seq, radius, k, recency) rewritten with clearer descriptions of behavior and interaction constraints.
- **Max patches updated** — `mubone-controller.maxpat` and `x-imu3.maxpat` updated with new OSC routing for the sensor registry convention.
- **Export includes sensor cal** — `mubone_sensor_cal` added to the static keys list in `ui-export.js`, and cleared on factory reset.
- **Sweep button moved** — sweep removed from top-bar system row; now lives in the session panel.
- **Undo button moved** — undo removed from the seeder panel inline; now in the session panel with consistent styling.
- **Wand config removed from save/load** — `wandConfig` references removed from `ui-audio-settings.js` save/load defaults and settings snapshot.

### Removed
- **wand.js** — wand controller mapping engine (531 lines). Morph/interpolation extracted to `seed-morph.js`; axis mapping replaced by sensor registry roles.
- **ui-wand.js** — wand control panel (700 lines). Live XY scatter, roll strip, inertial meters, and morph bar. Functionality replaced by gesture panel and sensor registry UI.
- **ui-sensor.js** — old two-column sensor calibration modal (173 lines). Replaced by `ui-sensors.js`.
- **Morph UI in improv panel** — morph enable (on/off) and morph hold mode (momentum/elastic) toggles removed from the improv settings panel.
- **Morph entries in patch table** — `morphEnabled` and `morphHoldMode` removed from `PARAM_REGISTRY`.

---

## 0.3 alpha — 2026-03-20

### Fixed
- **Seeder panel spacing** — `.improv-body` inherited `gap: 0.25rem` from `.device-body`, causing inconsistent spacing vs the looper panel. Added `gap: 0 !important` to match `.seq-body`.
- **Canvas arc negative radius** — `updateSeqBanksUI` and `updateSeedBanksUI` passed negative radius to `ctx.arc()` when many slots in a small canvas, producing 1000+ errors per page load. Clamped with `Math.max(0.5, ...)`.
- **Tooltip style on newer elements** — dynamically-set `title` attributes (e.g. on axis lock buttons) bypassed the custom tooltip system. Enhanced `MutationObserver` to also catch `attributes` mutations with `attributeFilter: ['title']`.
- **"remove nearest loop" terminology** — renamed to "lift" across all UI labels, tooltips, MIDI/OSC table, events.js comments, and index.html.

### Added
- **Sow trail action** — hold S to record a moving seed path; seed loops along the trail. New `sow_trail` entry in MIDI/OSC table, OSC handler (`/seed/trail`), and dedicated indicator button with teal-green active styling.
- **Independent axis locks** — azimuth and elevation can now be locked independently and simultaneously. Two new booleans (`axisLockAz`, `axisLockEl`) replace the single enum. Separate UI rows, patch table entries, MIDI/OSC toggle actions, and renderer logic.
- **Drop loop button** — dedicated big button for tap-D (drop loop), with pink flash on activation. Separate from draw loop (hold D).
- **Sow seed indicator button** — visual feedback for tap-S sow, matching the existing paint-indicator style.

### Changed
- **Axis lock type changed from hold to toggle** — press once to lock, press again to unlock. Updated MIDI dispatch to only act on press (ignores release).
- **Morph sticky mode** — instead of hiding the time parameter row, it's now greyed out with reduced opacity and disabled pointer events. Return mode keeps time fully visible and interactive.
- **Panel layout reorder** — slot config (slots + overflow) moved below the action buttons and transport row in both looper and seeder panels, placing it before the parameter sections.
- **D key dual-action** — tap D drops a loop, hold D draws a loop. S key follows same pattern: tap sows seed, hold sows trail.
- Updated CSS comment corrections (`A key` → `D key`, `sow` → `sow seed`).

---

## 0.2 alpha — 2026-03-19

### Fixed
- **MIDI noteOff never released hold actions** — hold actions (recpaint, paint1–10, alt_lock, lock_az, lock_el) got permanently stuck "on" when mapped to MIDI notes. Now handles both status-type-8 noteOff and velocity-0 noteOn.
- **seed_xfade CC blocked by toggle case** — the `dispatchAction` switch had a hardcoded toggle that ran instead of the ccFn. MIDI CC now smoothly controls 0–1 as intended.
- **Custom keyup released wrong action** — when two hold actions shared a key code with different modifiers (e.g. `E` vs `Shift+E`), keyup could release the wrong one. Now tracks active holds via a Map populated on keydown.
- **Scroll could be mapped to hold actions** — scroll events have no release, so hold actions would get stuck "on". Scroll learn mode now rejects hold actions with a status message.

### Added
- **Arm loop action (`seq_arm`)** — added to ACTIONS table as type `hold`, key `A`, OSC `/loop/arm`. Full press/release lifecycle in `dispatchAction`: press forces seq mode + starts recording, release creates loop + restores prior mode. Wired in osc.js.
- **Gesture extraction** (experimental, `?exp`) — `js/exp/gesture.js` extracts smoothness, effort, periodicity, accumulated energy, and directness from wand IMU data. `js/exp/gesture-viz.js` provides live feature bars, gyro trace, and energy arc overlay (press G to toggle).
- **CHANGELOG.md** — this file, for version tracking going forward.

### Changed
- `seq_remove` key label updated from `—` to `Shift+A` in ACTIONS table.
- `uproot_seed` key label updated from `↑` to `Shift+S` in ACTIONS table.
- Removed stale ArrowUp → uproot binding from events.js.
- Updated README with current project description and architecture.

---

## 0.1 alpha — 2026-03-17

Initial alpha release. Core granular engine, VBAP spatialization, preset system, looper, seeder, wand IMU input, MIDI/keyboard/OSC mapping system.
