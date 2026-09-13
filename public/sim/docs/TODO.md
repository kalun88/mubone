# TODO — Current Tasks & Priorities

> **Status: CURRENT** · the OPEN list, and only that. A finished item leaves this file the day it closes, into `docs/archive/TODO-DONE-<month>.md` (`docs-audit.js` fails on any `[x]` here). Read the items that touch the task in hand, not the whole file.

> **End of session: one entry per thing done, five lines or fewer, placed in the current month's archive file, not here.** Name the #id, the files, and where the reasoning lives — the commit message or the doc that owns the area. The long narrative that used to go here goes in the commit message (`git log` keeps it forever) or the owning doc; a new rule of the codebase goes in `docs/RULINGS.md`. Open items found along the way go under today's date below.

---

## Open — by date found

### Sep 12

- [ ] **#350 A button map from before 2026-09-11 is not migrated onto positions** — Ek's own profile has
  `mubone_button_map` on the bare ids (`commit_drop` on button 3 tap, `commit_release` on ×2), while `BUTTON_DEFAULTS`
  now binds `palette_7` / `palette_6`. The actions still fire, but `bindingsOf('palette_N')` cannot attribute them, so
  the pin tile wears no legend and the keys page shows the bare rows. Needs a ruling: migrate stored bare-id button
  rows onto the position that holds that tile today (the collapse stamp pattern), or leave stored maps alone.

### Sep 6

- [ ] **#346 An intermittent host-side stall after the flood** — twice on 2026-09-06, in a probe phase with NO grains
  (audio-thread load ~1 %): `inSkipped` 544 then 4480, `outDropped` 7 then 28, a few holes, the HOST loop gapping
  31 ms — once before the candidate tables existed, once after. **Not seen again in five probe runs since**, three of
  them with the holders reported per phase (the probe prints them now, and the host names its parent messages by
  type): the only host holder in every clean run is the two stream opens at boot, `parent:set-audio-device` ~53 ms
  and `parent:set-input-device` ~43 ms — which are also the two 47–55 ms gaps Ek's `wg.status()` shows, and are not
  mid-play. When it recurs the probe's `hostGaps.holders` for that phase will say who held the loop.
- [ ] **#345 The scheduler off the GUI thread (R10)** — a GUI stall no longer costs a hole but still freezes the hand's
  candidates for its length. **The plan (2026-09-06, after R3):** the scheduler (`grain.js scheduleGrains`, the angle
  cache, the two pool builders, `_selectPerVoicing`, the cloud claims) moves to a Worker. It needs three things the
  main thread owns today: the PARTICLE TABLE (lon, lat, cartesian, strokeId, `_vo`, source/buffer index, grainStart,
  `trig`, claim flags) as a SharedArrayBuffer the main thread writes at deposit and erase and the Worker reads by
  index — the same shape as the candidate tables of R3, which the Worker then writes directly; the CURSOR (lon/lat
  per tick, from the sensor or the mouse) and the lens/brush params, posted to the Worker as they change; and a
  MessagePort transferred from the Worker INTO the worklet for the `cursorVoicesTab` message, the pattern the audio
  host set on 2026-09-06, so a GUI stall cannot delay the post. What stays on the main thread: painting and deposit
  (they own the mic and the analyser), the renderer, and the pinned clouds' scheduling until it is moved the same
  way. The renderer reads `S._cursorPool` for the reach fan and the glow: it becomes a read of the Worker's published
  region 0–8 rows (particle ids), one tick stale at most. Risks: the particle array is sorted in place by nearest
  mode (`_ang` on the objects) — the Worker keeps its own order and index map; voicings (`S.voicings`) and wet
  updates must be mirrored to the Worker on change; the overdub/trigger gates that run from the tick
  (`_updateTriggerGates`, `tickSeedRecording`) stay on the main thread on their own 10 ms timer. Prove with
  `trigger-audit.js` "the hops are bounded" extended to a frozen GUI: the candidates keep moving with the sensor
  through a 250 ms stall. Large; a working week; only after the particle table exists.

- [ ] **#347 The cushion and the clocks on the RIG's interface** — every transport number of 2026-09-06 (R1 at 10 ms,
  R4, R3, R7 at 64 frames) was measured on the laptop's built-in device. Two runs on the rig, with the sensor
  connected, before the next show: (a) `MUBONE_RIG_INSTANCE=rig MUBONE_RIG_PORT=7597 node scripts/transport-probe.js`
  on the interface at 10 ms and again at 5 ms — 0 dry, 0 dropped over the run, or the default goes back to 10/20;
  (b) R9, the two clocks: the engine on the built-in output and RtAudio on the interface for ten minutes, reading
  `outDropped` / `inSkipped` / dry per minute (`S.transportDiag`). If they skip once a minute or more, a resampling
  ring in `input-meter.worklet.js` and a rate trim in the host's `onOutputBlock` (drop or duplicate one sample per N)
  replace the skips; if they never skip, `docs/RIG-RUNBOOK.md` § 4.9 stays as it is and R9 closes.
- [ ] **#336 Viz settings that should follow** — the deferred list at the end of `docs/archive/viz-changes-for-cli.md`
  (§ *Settings that should follow*): the render-path additions of 2026-08-24 (dot+ring grains, reach lines, size
  ceiling, gaze trail) shipped without their settings. The doc moved to the archive 2026-09-05; this item is its door.

### Jul 27–28

---

## Open — From Previous Sprints

### From Workshop Prep (Dartmouth, week of Mar 30)

- [ ] **#36 Stress-test long sessions** — record continuously for 15–30 min in Chrome, monitor memory in DevTools.
- [ ] **#39 Stretch: test 42-channel VBAP** — try the full Dartmouth layout. Identify any performance cliffs (lookup table size, per-grain cost). Have a fallback plan if 42 is too heavy.

---

## Someday

- **Ideas kept from April–August (moved here 2026-09-05).** Sensor and mapping ideas (#122–#125), the accessory and erase
  wish-lists (#150, #134), multi-instance unattended robustness (#145), radial morph (#112).
- [ ] **#124 Sensing motion when no orientation is changed** — Detect movement from the x-imu3 even when its orientation isn't changing (pure translation, vibration, or sub-threshold rotation). Quaternion-only input misses these — need to incorporate raw gyro/accel streams (or derived energy/jerk) so the system can respond to gestures like shaking, tapping, or holding still under tension. Surface as a mappable source alongside the existing gesture energy (#118).

- [ ] **#125 Using the sensor as a turntable** — Treat the x-imu3 like a turntable: continuous rotation around one axis scrubs through a buffer, sets playback rate, or drives a positional parameter. Direction = forward/reverse, angular velocity = scrub speed. Needs decisions on which axis (yaw most natural for a hand-held turntable gesture), wrap-around handling (no pole singularities since it's single-axis), and whether the scrub target is the live recording buffer, a committed cloud, or a parameter sweep.

- [ ] **#123 Multi-cursor / live-seed — multiple sensors granulating simultaneously** — Allow 2–3 sensor cursors to scan/granulate the sphere at the same time, each spatialized independently in the octophonic array. One cursor still controls the camera; additional cursors are "live seeds" — seed slots whose position is driven by a sensor's quaternion in real-time instead of pre-recorded keyframes. The existing seed architecture (grain.js:637–831) already supports up to 16 independent granulating points with per-seed onset clocks, candidate pools, and VBAP spatialization, so the main work is wiring sensor input to seed position rather than building a new scheduling path.
  - **New sensor role:** Add `'scan'` to `QUAT_ROLES` (sensor-registry.js:24) allowing multiple simultaneous assignments (same exclusivity skip as `'custom'`/`'unmapped'` at line 193). Each `'scan'`-role slot drives one live seed.
  - **Live seed slot:** New seed type in grain.js that reads position from a sensor slot's quaternion (via `getByRole()` → `getCursorLonLat()`-equivalent) instead of interpolating `seed.frames[]` keyframes. Update position every scheduler tick (~20ms). The seed scheduling loop (grain.js:637–831) iterates it identically to committed clouds — angular distance search, candidate posting, worklet onset clock, VBAP.
  - **Worklet impact:** None expected. The worklet already handles cursor + 16 seeds. Live seeds post candidates the same way committed seeds do (grain-worklet-bridge.js:434–506). The 256-grain pool has headroom for 3 cursors at typical rates (~30–50 grains/sec each = 90–150 out of 256).
  - **State changes:** No change to `S.camQ`/`S.cursorQ` (camera remains single-cursor). Live seeds track their own lon/lat derived from their bound sensor slot. Add `S.liveSeeds[]` or flag on existing seed slots.
  - **UI:** Minimal — the 3D viz already renders seed positions. Optionally add colored dot per live seed. The main need is the role dropdown in the IMU setup card gaining a `'scan'` option alongside `'cursor'`/`'frame'`.
  - **Interaction model:** Performer A paints (trace) and scans from one position. Performer B enters the same material from a different angle — different grains, different spatial direction in the octophonic array. Audience hears two (or three) performers navigating the same spatial score simultaneously. Camera follows one cursor; all cursors granulate independently.
  - **Estimated effort:** ~2–3 days. (1) live-seed concept + sensor binding ~0.5d, (2) new role + role wiring ~0.5d, (3) UI indicator ~0.5d, (4) multi-sensor testing ~1d.

- [ ] **#122 OSC values out — sensor/parameter thru to external apps** — Add an OSC output path so mubone can forward live sensor values (quaternion, Euler, gyro, accel, gesture features) and mapped parameter values out to Max, SuperCollider, or any OSC-capable app. Essentially a thru/mirror: incoming sensor data and derived values (cursor position, gesture energy, mapped param outputs) get re-sent as OSC messages on a configurable host/port. Useful for parallel processing, visualization in another tool, or hybrid setups where mubone handles spatial audio but another app handles effects/synthesis. Needs: configurable destination (IP + port) in audio/sensor settings, toggle on/off, selectable streams (raw sensor, derived cursor, mapped params), OSC address namespace (e.g. `/out/sensor/{name}/quat`, `/out/cursor/lonlat`, `/out/param/{key}`). WebSocket or UDP output from Electron; browser mode could use WebSocket relay.

- [ ] **#117 Mapping module: macro groups** — Add a grouping layer to the mapping module. Each mapping can be assigned to a named macro group; groups can be toggled on/off as a unit. Use case: switch between "calm" and "aggressive" mapping sets with a single action instead of toggling individual mappings. Groups should be creatable/renamable in the mapping UI, assignable per mapping row, and switchable via MIDI/OSC (e.g. `/mapping/group/<name>/toggle`). Persist group assignments and on/off state to localStorage with presets.

- [ ] **#118 Expose gesture energy as a mappable source** — The gesture module already tracks movement energy internally. Surface this as a first-class mapping source in the mapping module so it can drive any target parameter. Energy should appear in the mapping source dropdown alongside IMU axes, envelope, etc. Normalize to 0–1 range with configurable smoothing/decay so it's usable for both slow swells and sharp transient response.

- [ ] **#119 Spatialization chaos modes** — Inspired by Bethany's feedback at the Dartmouth workshop. Add options for mapping gesture energy (or other sources) to speaker position randomization — e.g. energy → VBAP azimuth/elevation jitter, so calm playing stays spatially stable and intense playing scatters grains across the speaker array. Could also include a standalone "spatial chaos" parameter (0 = deterministic VBAP, 1 = fully random speaker assignment) exposed in PARAM_REGISTRY with MIDI/OSC path `/spatial/chaos`. Consider additional modes: energy → spin rate, energy → spatial spread width.

- [ ] **#112 Radial morph — gesture-driven patch interpolation** — Anchor presets at arbitrary positions on the radial joystick (gesture panel). Joystick position blends between anchored presets via inverse-distance weighting; center = current GUI params (implicit). Spring return means morph is always transient — push into a sound, release to come back. On/off toggle, anchor list with preset dropdown, anchors persist to localStorage (`mubone_radial_anchors`), anchors scale dynamically with the limit ring. Files: `js/gesture.js` (anchor state, `applyRadialMorph()` engine, persistence), `js/gesture-panel.js` (anchor viz on radial, anchor list UI, scrollable preset dropdown, morph toggle). *(These were "pins" until 2026-08-27, renamed when pin became the word for the off-cursor rail — see `docs/VOCABULARY.md` § Pin.)* **In progress.**

- [ ] **#150 Accessory — deferred ideas** — ~~Per-channel response curves~~ (**done, #155**); a second accessory type (the type abstraction is deliberately not built — `A8-ONLY` markers show every place that assumes 8 CSVs of volts); `pot` and `slider` are currently the same code path and the distinction is cosmetic; a Trill/I²C bridge would need an intermediate MCU emitting CSV over UART (the A8 is analogue-only, so no direct path); `acc.resetConfig()` from the console doesn't refresh an open modal.

- [ ] **#134 Erase brush — later ideas (deferred)** — own erase-recency depth (erase only most recent X buffers regardless of scan recency), exact-K "erase what's playing" mode, budgeted scrub strength (N particles/tick, real-eraser feel), erase radius decoupled from search radius, SPEAR-style spectral/feature filters (erase by centroid/RMS/zcr — particles already carry these). All console-loadable experiments first, per the no-URL-flag rule.

- [ ] **#145 Multi-instance Phase 4 (unattended robustness)** — pin each instance to a sensor serial with auto-connect on launch (also makes double-connecting one sensor impossible), sensor dropout watchdog (500 ms, stale flag in the top bar — carried over from MULTI-IMU-PLAN #1), battery in the top bar (#2), summed-headroom guard across instances.

- **Ideas kept from the post-workshop gesture block (moved here 2026-09-05; Ek: "hold on to the ideas").** #43 and #44
  presume gesture features (`gesture.js`, sunset 2026-08-29, git history) — a return starts by rebuilding that source.
- [ ] **#43 Gesture-to-sonic mapping layer** — build `js/gesture-map.js`. Translates gesture features into sonic quality targets with temporal smoothing and inertia.
- [ ] **#44 Gesture-influenced painting** — build `js/gesture-paint.js`. Smoothness→brush tightness, effort→density, directness→coherence, periodicity→rhythmic deposit. See EXP-NOTES.md for full design.
- [ ] **#45 Self-organizing sphere / concatenative paint mode** — build `js/organized-paint.js`. Auto-place particles by timbral features (centroid→lon, RMS→lat, ZCR→secondary), adaptive normalization, particle migration animation. See EXP-NOTES.md for full design.
- [ ] **#46 Resonant filter bank on master bus** — build `js/resonant-filters.js`. First audio processing module, controlled by gesture layer.
- [ ] **#47 Convolution reverb with gesture-controlled wet/dry** — build `js/convolver.js`.
- [ ] **#48 Feedback delay network** — build `js/fdn.js`. Cross-coupled delays routed through VBAP.

- [ ] **#49 Custom signal routing layer** — per-signal routing from breakout streams to arbitrary destinations. Design doc: `docs/ROUTING-DESIGN.md`. Plumbing scaffolded in sensor-registry.js (role arrays, route model, dispatch functions, persistence). The earlier `ui-sensors.js` companion was deleted in the Mar 28 refactor; a replacement UI needs to be built (breakout table with locked/editable destinations). Also needs wiring to renderer, gesture, and morph consumers before it's usable. Build when preset roles (cursor/gesture/frame) aren't flexible enough.
- [ ] **#50 Spectral freeze** — via AudioWorklet (`js/spectral-freeze.js`).
- [ ] **#51 Phase vocoder pitch shift** — for spatial harmonization.
- [ ] **#52 Stochastic trigger zones on sphere** — TBD.
- [ ] **#53 Flocking/boid-driven audio** — from particle behavior.
- [ ] **#74 x-IMU3 binary mode / direct UDP reception (bypass Max for lower latency)** — the x-IMU3 has a binary data mode (device setting 11.1.66) that sends data messages as raw bytes instead of ASCII text. For quaternion: ASCII is ~50 bytes (`Q,timestamp,w,x,y,z\n`), binary is ~25 bytes (0xD1 + 8-byte uint64 timestamp + 4×32-bit floats + byte stuffing + 0x0A terminator). Roughly half the bandwidth. **However, latency savings are negligible** — the real latency comes from WiFi jitter (1-5ms), the Max → OSC → WebSocket chain, and browser event loop, not from parsing 25 extra bytes. Binary mode would also require parsing binary in Max or bypassing Max entirely. **The bigger latency win** would be receiving the x-IMU3's UDP stream directly in Electron's Node.js layer (the x-IMU3 sends UDP to configurable IP/port via settings 11.1.42-44) and piping straight to the renderer, cutting Max out of the data path. Only worth pursuing if latency becomes a real performance issue, or if running multiple IMUs at high rates (400Hz+) where bandwidth matters. See x-IMU3 User Manual v1.11 §8.2 for binary format, §11.1.66 for binary mode setting.
- [ ] **#91 Multi-IMU router for 2+ sensors** — when running two or more x-IMU3s (e.g. cursor + frame), need a routing layer that receives multiple UDP streams and dispatches each to the correct sensor slot. Could be a lightweight Node.js UDP server in Electron (ties into #74's direct-reception approach), or a small standalone router app/script that forwards tagged OSC to the WebSocket bridge. Key questions: discovery/identification of each IMU (by IP, serial, or x-IMU3 device name), mapping to sensor-registry slots, and whether this replaces Max entirely or supplements it.

## Completed

**Apr 12:** #113, #115, #121, #9, #19, #22, #35, #91

**Sprint Mar 30 onward:** #112 (in progress), #111, #93, #38, #41, #106, #24

**Sprint Mar 29:** #110, #109, #107, #108, #101, #103, #102, #98, #97, #96, #95, #94, #100, #28.1, #89, #99, #104, #105

**Sprint Mar 28–29 (Final Weekend):** #31, #88, #88a, #92, #90

**Dartmouth prep (Mar 27):** #10, #15, #21, #29, #30, #32, #77, #78, #79, #71, #69, #70

**Flight Test notes (Mar 25–26):** #1, #2, #3, #4, #5, #8, #12, #13, #18, #23, #25, #26, #27, #33

**Earlier:** #54, #55, #56, #57, #58, #59, #60, #61, #62, #63, #64, #65, #66, #67, #68, #80, #81
