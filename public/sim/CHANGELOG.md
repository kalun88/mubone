# Changelog

All notable changes to mubone are documented here.
Format: newest version first. Entries written at the end of each working session.

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
