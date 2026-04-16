# TODO — Current Tasks & Priorities

> Update this file at the end of every Cowork/Claude Code session.
> New sessions: read this after CLAUDE.md to pick up where we left off.

---

## Backlog

### Apr 15

- [ ] **#123 Multi-cursor / live-seed — multiple sensors granulating simultaneously** — Allow 2–3 sensor cursors to scan/granulate the sphere at the same time, each spatialized independently in the octophonic array. One cursor still controls the camera; additional cursors are "live seeds" — seed slots whose position is driven by a sensor's quaternion in real-time instead of pre-recorded keyframes. The existing seed architecture (grain.js:637–831) already supports up to 16 independent granulating points with per-seed onset clocks, candidate pools, and VBAP spatialization, so the main work is wiring sensor input to seed position rather than building a new scheduling path.
  - **New sensor role:** Add `'scan'` to `QUAT_ROLES` (sensor-registry.js:24) allowing multiple simultaneous assignments (same exclusivity skip as `'custom'`/`'unmapped'` at line 193). Each `'scan'`-role slot drives one live seed.
  - **Live seed slot:** New seed type in grain.js that reads position from a sensor slot's quaternion (via `getByRole()` → `getCursorLonLat()`-equivalent) instead of interpolating `seed.frames[]` keyframes. Update position every scheduler tick (~20ms). The seed scheduling loop (grain.js:637–831) iterates it identically to committed clouds — angular distance search, candidate posting, worklet onset clock, VBAP.
  - **Worklet impact:** None expected. The worklet already handles cursor + 16 seeds. Live seeds post candidates the same way committed seeds do (grain-worklet-bridge.js:434–506). The 256-grain pool has headroom for 3 cursors at typical rates (~30–50 grains/sec each = 90–150 out of 256).
  - **State changes:** No change to `S.camQ`/`S.cursorQ` (camera remains single-cursor). Live seeds track their own lon/lat derived from their bound sensor slot. Add `S.liveSeeds[]` or flag on existing seed slots.
  - **UI:** Minimal — the 3D viz already renders seed positions. Optionally add colored dot per live seed. The main need is the role dropdown in the IMU setup card gaining a `'scan'` option alongside `'cursor'`/`'frame'`.
  - **Interaction model:** Performer A paints (trace) and scans from one position. Performer B enters the same material from a different angle — different grains, different spatial direction in the octophonic array. Audience hears two (or three) performers navigating the same spatial score simultaneously. Camera follows one cursor; all cursors granulate independently.
  - **Estimated effort:** ~2–3 days. (1) live-seed concept + sensor binding ~0.5d, (2) new role + role wiring ~0.5d, (3) UI indicator ~0.5d, (4) multi-sensor testing ~1d.

### Apr 6

- [ ] **#122 OSC values out — sensor/parameter thru to external apps** — Add an OSC output path so mubone can forward live sensor values (quaternion, Euler, gyro, accel, gesture features) and mapped parameter values out to Max, SuperCollider, or any OSC-capable app. Essentially a thru/mirror: incoming sensor data and derived values (cursor position, gesture energy, mapped param outputs) get re-sent as OSC messages on a configurable host/port. Useful for parallel processing, visualization in another tool, or hybrid setups where mubone handles spatial audio but another app handles effects/synthesis. Needs: configurable destination (IP + port) in audio/sensor settings, toggle on/off, selectable streams (raw sensor, derived cursor, mapped params), OSC address namespace (e.g. `/out/sensor/{name}/quat`, `/out/cursor/lonlat`, `/out/param/{key}`). WebSocket or UDP output from Electron; browser mode could use WebSocket relay.

### Apr 5

- [ ] **#117 Mapping module: macro groups** — Add a grouping layer to the mapping module. Each mapping can be assigned to a named macro group; groups can be toggled on/off as a unit. Use case: switch between "calm" and "aggressive" mapping sets with a single action instead of toggling individual mappings. Groups should be creatable/renamable in the mapping UI, assignable per mapping row, and switchable via MIDI/OSC (e.g. `/mapping/group/<name>/toggle`). Persist group assignments and on/off state to localStorage with presets.
- [ ] **#118 Expose gesture energy as a mappable source** — The gesture module already tracks movement energy internally. Surface this as a first-class mapping source in the mapping module so it can drive any target parameter. Energy should appear in the mapping source dropdown alongside IMU axes, envelope, etc. Normalize to 0–1 range with configurable smoothing/decay so it's usable for both slow swells and sharp transient response.
- [ ] **#119 Spatialization chaos modes** — Inspired by Bethany's feedback at the Dartmouth workshop. Add options for mapping gesture energy (or other sources) to speaker position randomization — e.g. energy → VBAP azimuth/elevation jitter, so calm playing stays spatially stable and intense playing scatters grains across the speaker array. Could also include a standalone "spatial chaos" parameter (0 = deterministic VBAP, 1 = fully random speaker assignment) exposed in PARAM_REGISTRY with MIDI/OSC path `/spatial/chaos`. Consider additional modes: energy → spin rate, energy → spatial spread width.
- [ ] **#120 Investigate cloud drop volume spike** — Cloud drops sometimes sound noticeably louder than expected. Suspect the committed cloud isn't inheriting the current volume/gain state, or something is off with scan gain staging or headphone mix routing at the moment of drop. Audit the signal path from cloud commit through to output: check whether `S.volume`, bus sends (monitor/house), and headphone mix level are all applied correctly to newly dropped clouds. Compare RMS of a cloud drop vs. live scan at matched settings. Could also be a normalization issue if the cloud buffer has a different peak level than the live buffer.
- [x] **#121 Highlight actively mapped parameters in main UI** — **Done (Apr 12).**

### Apr 4

- [x] **#113 Add overlap ratio parameter** — **Done (Apr 12).**
- [x] **#115 Expose durJitter in main UI** — **Done (Apr 12).**
- [ ] **#116 Skip meter computation when panels are collapsed** — Collapsing UI panels (levels, cursor, etc.) is CSS-only — the JS meter loops keep running at full rate. `tickMainMeters()` (ui-meters.js:771) still calls `analyser.getFloatTimeDomainData()` and draws to hidden canvases every other frame (~30fps). The audio-settings modal meter loop (`startMetering()`, ui-audio-settings.js:352) runs its own rAF at ~60fps whenever the modal has been opened once. Fix: add early-return guards that check `panel.classList.contains('collapsed')` (or a visibility flag) before reading analyser data and drawing. The AnalyserNodes stay connected (disconnect/reconnect churn isn't worth it), but skipping `getFloatTimeDomainData()` + canvas draws saves meaningful main-thread time — especially relevant for #114's goal of reducing main-thread load during performance. Apply to: main input/output meters, dry monitor meter, noise gate meter canvas, and the audio-settings modal meters.

---

## Open — From Previous Sprints

### From Sprint Mar 30

- [ ] **#112 Radial morph — gesture-driven patch interpolation** — Pin presets at arbitrary positions on the radial joystick (gesture panel). Joystick position blends between pinned presets via inverse-distance weighting; center = current GUI params (implicit). Spring return means morph is always transient — push into a sound, release to come back. On/off toggle, pin list with preset dropdown, pins persist to localStorage, pins scale dynamically with the limit ring. Files: `js/exp/gesture.js` (pin state, `applyRadialMorph()` engine, persistence), `js/exp/gesture-panel.js` (pin viz on radial, pin list UI, scrollable preset dropdown, morph toggle). **In progress.**

### From Flight Test Notes (Mar 25–26)

- [ ] **#6 Sample painting doesn't contribute to buffer count** — painted samples don't show in the recording meter. Confirm whether intentional or a gap.
- [ ] **#7 Crashes from too many loops/seeds** — happens on speech1, also general overload. Error code 5. Hard to isolate — likely AudioContext or node limit. Needs investigation.
- [x] **#9 Surface mode yaws one direction after pole** — **Fixed (Apr 12).**
- [ ] **#11 Upside-down indicator in viz** — something in the 3D view showing when wand is inverted, helps diagnose whether orienter is reversed.
- [ ] **#14 Cursor fade in/out time** — smooth fade when muting/unmuting cursor playback instead of hard on/off.
- [ ] **#16 Particles remember their patch/grain settings** — each painted particle stores which patch was active when painted, so playback uses original settings.
- [ ] **#17 Glide time between patches** — crossfade/interpolation when switching patches rather than hard cut.
- [x] **#19 Radius display needs better contrast** — **Fixed (Apr 12).**
- [ ] **#20 Tether seed visual** — visual connection between seed and its source or trajectory.
- [x] **#22 Fade in/out for picked-up loops** — **Done (Apr 12).**

### From Workshop Prep (Dartmouth, week of Mar 30)

- [x] **#35 Verify `sweep` actually frees memory** — **Verified (Apr 12).**
- [ ] **#36 Stress-test long sessions** — record continuously for 15–30 min in Chrome, monitor memory in DevTools.
- [ ] **#39 Stretch: test 42-channel VBAP** — try the full Dartmouth layout. Identify any performance cliffs (lookup table size, per-grain cost). Have a fallback plan if 42 is too heavy.
- [ ] **#40 Electron multi-channel setup docs** — write a short checklist for getting Electron + multi-channel output running on a fresh machine (students may need to set this up).

---

## Deferred — Later Features

- [ ] **#82 Basic morph for roll override / azimuth+elevation lock (cursor lock) via gesture panel capture** — implement a basic morph mode where roll overrides or azimuth and elevation are locked (cursor lock), then use the gesture panel to capture and drive the morph.

## Deferred — Later Fixes

- [x] **#91 Normal-mode renderer stalls with 16 moving clouds during recording** — **Fixed (Apr 12).**
- [ ] **#75 Roll mute/unmap pole bug** — when roll axis is muted or unmapped in the sensor axis map, the cursor can never reach the poles and yaws excessively / flips. Works fine with all 3 axes active. Root cause: forward-vector decomposition in `applyAxisMapQuat` has a coordinate-system mismatch preventing pitch from reaching ±90°. Roll mute button disabled in UI with tooltip. Downstream roll-lock approach also failed (same decomposition issue) — roll lock code removed. See `docs/EULER-VS-QUAT.md` § "Proposed fixes for 2-DOF gimbal lock" for two approaches:
  - [ ] **#75a Explore pitch clamp** — clamp pitch to ±85° (configurable) when roll is muted, preventing the gimbal lock singularity. Quick win that could re-enable the roll mute button immediately. Tradeoff: poles become unreachable (small dead zone).
  - [ ] **#75b Explore delta/incremental rotation path** — compute frame-to-frame quaternion deltas (always small angles, never hit poles), apply axis remap and roll-mute to the delta, accumulate into camera orientation. Avoids gimbal lock entirely. Would also fix #9 (surface mode yaw after pole). Tradeoff: drift from float accumulation (mitigate with periodic normalization and slow blend toward absolute orientation).
- [ ] **#76 Recenter drift correction bug** — recenter (`recenterCursor()`) logic needs review. Button disabled in sensor panel UI with tooltip. Tare works correctly; recenter is separate and its behaviour is unclear. Re-enable once the logic is verified.

## Upcoming — Euler Input & Sensor Format

> See `docs/EULER-VS-QUAT.md` for full analysis and architecture.

- [ ] **#83 Add `/euler` OSC input path** — new `handleSlotEuler(slot, [roll, pitch, yaw])` handler in sensor-registry.js. Stores `slot.rawEuler`, sets `slot.inputFormat = 'euler'`. OSC address: `/sensor/{name}/euler`. Coexists with existing `/quaternion` path — both formats supported per-slot.
- [ ] **#84 Euler tare** — capture `(tareRoll, tarePitch, tareYaw)` at tare time, apply via subtraction + angle wrapping. Simpler than quaternion conjugate tare; no roll-offset special case. Needs wrapping logic for yaw (±180°), pitch (±90°), and roll (±180°).
- [ ] **#85 Euler axis remap** — direct remap on the three Euler values using the existing axisMap table. No quat decomposition/recomposition needed. Convert final tared/remapped euler to quaternion at the end to feed into existing `getSensorCamQ()` pipeline.
- [ ] **#86 Configure x-IMU3 for Euler output** — set `ahrs_message_type` to 2 (Euler angles) via x-IMU3 GUI or API. Keep `axes_alignment` at default (+X+Y+Z) — all mount remapping stays in mubone software for quick changes during experimentation.
- [ ] **#87 UI: sensor panel format indicator** — show whether each slot is receiving quat or euler. Euler tare vs quat tare path selection based on `slot.inputFormat`.

## Deferred — Gesture & Experimental (post-workshop)

- [ ] **#42 Test gesture extraction with live wand** — load `?exp`, wave wand, verify viz panel shows meaningful features. Tune scaling constants in `gesture.js` (JERK_SCALE, EFFORT_GYRO_SCALE, ENERGY_DECAY, etc.) based on real IMU data.
- [ ] **#43 Gesture-to-sonic mapping layer** — build `js/exp/gesture-map.js`. Translates gesture features into sonic quality targets with temporal smoothing and inertia.
- [ ] **#44 Gesture-influenced painting** — build `js/exp/gesture-paint.js`. Smoothness→brush tightness, effort→density, directness→coherence, periodicity→rhythmic deposit. See EXP-NOTES.md for full design.
- [ ] **#45 Self-organizing sphere / concatenative paint mode** — build `js/exp/organized-paint.js`. Auto-place particles by timbral features (centroid→lon, RMS→lat, ZCR→secondary), adaptive normalization, particle migration animation. See EXP-NOTES.md for full design.
- [ ] **#46 Resonant filter bank on master bus** — build `js/exp/resonant-filters.js`. First audio processing module, controlled by gesture layer.
- [ ] **#47 Convolution reverb with gesture-controlled wet/dry** — build `js/exp/convolver.js`.
- [ ] **#48 Feedback delay network** — build `js/exp/fdn.js`. Cross-coupled delays routed through VBAP.

## Someday

- [ ] **#49 Custom signal routing layer** — per-signal routing from breakout streams to arbitrary destinations. Design doc: `docs/ROUTING-DESIGN.md`. Plumbing scaffolded in sensor-registry.js (role arrays, route model, dispatch functions, persistence) and ui-sensors.js (breakout table with locked/editable destinations). Needs wiring to renderer, gesture, and morph consumers before it's usable. Build when preset roles (cursor/gesture/frame) aren't flexible enough.
- [ ] **#50 Spectral freeze** — via AudioWorklet (`js/exp/spectral-freeze.js`).
- [ ] **#51 Phase vocoder pitch shift** — for spatial harmonization.
- [ ] **#52 Stochastic trigger zones on sphere** — TBD.
- [ ] **#53 Flocking/boid-driven audio** — from particle behavior.
- [ ] **#74 x-IMU3 binary mode / direct UDP reception (bypass Max for lower latency)** — the x-IMU3 has a binary data mode (device setting 11.1.66) that sends data messages as raw bytes instead of ASCII text. For quaternion: ASCII is ~50 bytes (`Q,timestamp,w,x,y,z\n`), binary is ~25 bytes (0xD1 + 8-byte uint64 timestamp + 4×32-bit floats + byte stuffing + 0x0A terminator). Roughly half the bandwidth. **However, latency savings are negligible** — the real latency comes from WiFi jitter (1-5ms), the Max → OSC → WebSocket chain, and browser event loop, not from parsing 25 extra bytes. Binary mode would also require parsing binary in Max or bypassing Max entirely. **The bigger latency win** would be receiving the x-IMU3's UDP stream directly in Electron's Node.js layer (the x-IMU3 sends UDP to configurable IP/port via settings 11.1.42-44) and piping straight to the renderer, cutting Max out of the data path. Only worth pursuing if latency becomes a real performance issue, or if running multiple IMUs at high rates (400Hz+) where bandwidth matters. See x-IMU3 User Manual v1.11 §8.2 for binary format, §11.1.66 for binary mode setting.
- [ ] **#105 OSC string-addressed mode switching** — currently all multi-option OSC controls (`/camera/mode`, `/spatial/panning`, `/trace/mode`, `/commit/mode`, `/grain/dir`, `/grain/curve`, `/commit/dir`, `/commit/blend`, `/commit/selection`, `/commit/overflow`, `/commit/loop_release`) are bangs that cycle through options. Add support for sending the target value as a string (e.g. `/camera/mode sensor`, `/trace/mode trace+loop`) so an external controller or Max patch can set a specific mode directly instead of cycling. The `dispatchAction` handler should check whether `midiVal` is a string and, if so, set the mode directly rather than cycling. `fmt` labels in ACTIONS should document both bang (cycle) and string (set) usage.
- [ ] **#91 Multi-IMU router for 2+ sensors** — when running two or more x-IMU3s (e.g. cursor + frame), need a routing layer that receives multiple UDP streams and dispatches each to the correct sensor slot. Could be a lightweight Node.js UDP server in Electron (ties into #74's direct-reception approach), or a small standalone router app/script that forwards tagged OSC to the WebSocket bridge. Key questions: discovery/identification of each IMU (by IP, serial, or x-IMU3 device name), mapping to sensor-registry slots, and whether this replaces Max entirely or supplements it.

## Completed

**Apr 12:** #113, #115, #121, #9, #19, #22, #35, #91

**Sprint Mar 30 onward:** #112 (in progress), #111, #93, #38, #41, #106, #24

**Sprint Mar 29:** #110, #109, #107, #108, #101, #103, #102, #98, #97, #96, #95, #94, #100, #28.1, #89, #99, #104, #105

**Sprint Mar 28–29 (Final Weekend):** #31, #88, #88a, #92, #90

**Dartmouth prep (Mar 27):** #10, #15, #21, #29, #30, #32, #77, #78, #79, #71, #69, #70

**Flight Test notes (Mar 25–26):** #1, #2, #3, #4, #5, #8, #12, #13, #18, #23, #25, #26, #27, #33

**Earlier:** #54, #55, #56, #57, #58, #59, #60, #61, #62, #63, #64, #65, #66, #67, #68, #80, #81
