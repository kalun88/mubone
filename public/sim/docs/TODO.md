# TODO — Current Tasks & Priorities

> Update this file at the end of every Cowork/Claude Code session.
> New sessions: read this after CLAUDE.md to pick up where we left off.

---

## Sprint — Dartmouth prep (due Mar 27 EOD)

- [ ] **#10 Zero reference indicator on sphere** — visual marker showing where "zero" is, so you can see how far the IMU has drifted over time.
- [x] **#15 K count slider minimum range** — slider floor set to 30 so k can be set before painting. Grows beyond 30 once particle count exceeds it. **Done (Mar 26)**.
- [x] **#21 Tooltip delay too fast with Learn off** — changed from 400ms to 3000ms when Learn is off. **Done (Mar 26)**.
- [ ] **#24 "Performance patch" — dead-simple workshop preset** — 3–4 patches, key params locked, 1–2 pedal controls, someone can sit down and perform without touching the UI.
- [x] **#29 Loop release mode: play-to-end option** — `S.loopReleaseMode`: 'fade' (existing ms fade-out) or 'play-to-end' (disables looping, plays through to loopEnd with 50ms fade). UI segmented button in commit section, OSC `/commit/loop_release`, MIDI mappable. Preset save/load wired. **Done (Mar 26)**.
- [ ] **#30 Sensor gain for extremity-mounted IMU** — gain/scaling param for sensor input when mounted at arm/wand tip.
- [ ] **#31 Pico projector + IMU as periscope** — IMU on projector as "frame" reference for periscope view into sphere.
- [x] **#32 Reimagine HUD display** — canvas edge HUD with 3-column top bar (A=trace, S=scan, D=commit), DOM text HUD (left/center/right layout), commit dots, patch info, HUD scale slider. **Done (Mar 26)**.
- [ ] **#38 Verify 8-channel VBAP** — test with 8-speaker layout in Electron, confirm lookup table, smooth panning, no silent channels.
- [ ] **#69 Sensor tare correction for off-axis wrist mount** — when IMU is worn on the wrist at an angle (not flat), tare captures the offset but pitch up/down movements cause the cursor to drift left/right instead of moving straight along gravity. Need to decompose the tare orientation so that post-tare pitch maps cleanly to vertical cursor movement regardless of mount angle. Likely need a gravity-aligned correction in the orienter or tare logic.
- [x] **#70 Full audit of OSC/MIDI/keyboard mapping modules** — restructured ACTIONS array in midi.js: merged seed/loop groups into unified commit group, added trace_mode/commit_mode/commit_drop/commit_draw/commit_release/commit_clear/loop_release_mode/loop_fade_time actions. Legacy actions preserved with `_legacy: true` (hidden from UI, existing maps still work). OSC handlers rewritten for `/commit/*` and `/trace/*` paths; legacy `/seed/*` and `/loop/*` fixed. Interaction types verified (hold/toggle/trigger/cc). **Done (Mar 26)**.

---

## Active — Flight Test Notes (Mar 25)

### Bugs

- [x] **#1 Nearest mode blocks playhead drop by radius** — in nearest mode, D press should drop a playhead at whatever particle is currently selected regardless of radius. Currently checks radius even in nearest mode. Only area mode should gate drops by radius. Fixed: `dropSeqFromCursor()` now bypasses radius check when `S.nearestMode` is true.
- [x] **#2 Morph patch dropdown doesn't auto-update** — creating a new patch in the same session doesn't appear in the morph dropdown until reload. Fixed: added `S._rebuildMorphDropdowns?.()` call in `saveToUserPreset()` and patch table name-edit commit.
- [x] **#3 Patch table: lock column overlaps first column** — CSS layout issue, lock column visually hovering over the preset column. Fixed: box-sizing border-box, label 110px z3, lock at left 110px z2.
- [x] **#4 Patch table: unable to clear fields** — right-click to clear already exists.
- [x] **#5 Browser: horizontal scroll closes screen** — scrolling left/right in patch table (or similar) triggers back/close navigation gesture. Fixed: added `overscroll-behavior: contain` to `.pt-table-wrap`, `.mu-dialog`, and `.as-multi-meter-wrap` to prevent scroll chaining into browser navigation gestures.
- [ ] **#6 Sample painting doesn't contribute to buffer count** — painted samples don't show in the recording meter. Confirm whether intentional or a gap.

### Stability / Crashes

- [ ] **#7 Crashes from too many loops/seeds** — happens on speech1, also general overload. Error code 5. Hard to isolate — likely AudioContext or node limit. Needs investigation.
- [x] **#8 Edge case: seed lock + sample switching mid-draw** — cross-talk between held sample keys during seed trail drawing. Record lock behaves differently. Needs edge case audit of key state machine.

### IMU / Wand / Orientation

- [ ] **#9 Surface mode yaws one direction after pole** — orientation snaps or drifts after passing through a pole.
- [ ] **#10 Zero reference indicator on sphere** — visual marker showing where "zero" is, so you can see how far the IMU has drifted over time.
- [ ] **#11 Upside-down indicator in viz** — something in the 3D view showing when wand is inverted, helps diagnose whether orienter is reversed.

### Search / Cursor Enhancements

- [x] **#12 Scan lock + more lock options** — ability to lock most scan/search params (like seed lock and loop lock).
- [x] **#13 Farthest-first pickup order** — option to pick up seeds or loops starting from farthest rather than nearest. Not about grain/particle selection. Useful musically when multiple seeds running. Closest might be better for morphing or cursor.
- [ ] **#14 Cursor fade in/out time** — smooth fade when muting/unmuting cursor playback instead of hard on/off.
- [ ] **#15 K count slider minimum range** — currently the k count max slider grows with total particle count, so you can't set k to e.g. 20 until there are 20 particles. Problem: patches and other settings depend on a defined k value before particles exist. Fix: default slider range 0–30 (covers most non-k-all use cases), so k can be set before painting. Once particle count exceeds 30, revert to current behavior of growing with slot count.

### Patch System

- [ ] **#16 Particles remember their patch/grain settings** — each painted particle stores which patch was active when painted, so playback uses original settings.
- [ ] **#17 Glide time between patches** — crossfade/interpolation when switching patches rather than hard cut.
- [x] **#18 Patch save excludes locked params** — ✎ save captures all params except locked ones. Locked params are session-wide holds. All params lockable via patch table. Main UI shows lock icon only when locked (display-only, not clickable).

### Visual / Display

- [ ] **#19 Radius display needs better contrast** — border display with colour barely visible. Needs stronger visual treatment.
- [ ] **#20 Tether seed visual** — visual connection between seed and its source or trajectory.
- [ ] **#21 Tooltip delay too fast with Learn off** — when the Learn menu item is off, tooltips still appear almost instantly on hover. Should delay ~3 seconds so they don't get in the way during performance. Check whether the tooltip delay is configurable or needs a code change.

### Audio / Playback

- [ ] **#22 Fade in/out for picked-up loops** — at minimum fade-out to eliminate clicks when loops stop. Fade-in less critical but nice.

### Architecture / Design

- [x] **#23 Unify loop mode and cloud/seed mode under commit** — three-function interaction model (trace / scan / commit) with unified pool. Commit encompasses clouds (particle-based, parked or moving trail) and loops (buffer-based). Release is the opposite of commit. See `docs/INTERACTION-MODEL.md` for full design thinking. **Done (Mar 26)**: unified `commitSlots[16]` pool with `type: 'cloud'|'loop'`, C key (tap=drop, hold=draw), Shift+C=mode cycle, ⌘C=release, S=commit lock, selection mode (closest/farthest). Legacy aliases preserve backward compat. HUD unification deferred — existing seed/loop panels still functional.
- [ ] **#24 "Performance patch" — dead-simple workshop preset** — a learning-friendly configuration for Dartmouth students. 3–4 patches max, key params locked (fade times, radius, grain settings), loop/seed simplified, designed around 1–2 pedal controls and nothing else. Goal: someone can sit down and perform a short piece without touching the UI. Design the patch set, lock list, and pedal mapping, then build as a loadable preset or startup mode.

## Active — Flight Test Notes (Mar 26, post-Vasily)

### Bugs

- [x] **#25 Release all doesn't work** — Fixed: ⌘D tap releases one commit (nearest/farthest per selectionMode). Hold-to-clear removed — clear all is GUI button only (`commitClearBtn`). **Done (Mar 26)**.
- [x] **#26 Overflow mode: drop/draw buttons still greyed out** — when overflow is set to oldest or nearest, the drop and draw buttons remain disabled when slots are full. They should only be disabled when overflow is off. Verify that overflow eviction actually fires on commit when pool is full.
- [x] **#27 D-loop + trace conflict** — Fixed: mutual exclusion via `S._cLoopActive` / `S._traceActive` flags. D-loop greys out trace indicator, trace+loop greys out D-loop buttons. Proper handoff on release — whichever key is still held resumes recording. **Done (Mar 26)**.

### Commit System

- [ ] **#28.1 Trace+cloud / D-cloud interleave edge cases** — when trace+cloud is active and D is used to drop/draw clouds simultaneously, the shelved seed recording mostly works but has edge-case glitches: releasing spacebar before D finishes can cause the trace cloud path to stutter or freeze near the D cloud's end position. Shelved seed frame recording and finalization need hardening for all release orderings (space-first, D-first) across forward/pingpong/rev loop modes.
- [x] **#28 Autocommit independent mode selector** — redesigned as trace mode cycle (`S.traceMode`: trace / trace+loop / trace+cloud). A key or button cycles mode, spacebar/mouse activates. Scan auto-mutes only on activation (not arming). D key for commit (tap=drop, hold=draw), Shift+D=mode cycle, ⌘D=release. D-loop and trace+loop mutually exclusive with visual greying. Trace+cloud allows concurrent D-cloud drops with shelved seed recording. S key for scan toggle, button polarity flipped (white=on, orange=off). Cloud buttons light blue (#7eb8e0). Legacy `commitLockEnabled` getter/setter preserved. **Done (Mar 26)**.
- [x] **#29 Loop release mode: play-to-end option** — `S.loopReleaseMode` ('fade'|'play-to-end'). Fade uses existing release time slider; play-to-end disables loop flag on AudioBufferSourceNode so it plays through to loopEnd, with 50ms fade near end, then auto-removes from slot via 'ended' event. UI: segmented button in commit section. OSC: `/commit/loop_release`. Preset export/import wired. **Done (Mar 26)**.

### IMU / Wand / Orientation

- [ ] **#30 Sensor gain for extremity-mounted IMU** — when sensor is mounted at extremity of body (e.g. arm/wand tip), raw values are much larger than torso-mounted. Need gain/scaling param for sensor input. Check Vasily jam notes for specifics.
- [ ] **#31 Pico projector + IMU as periscope** — pico projector is working. Mount an IMU on the projector to simulate a periscope view into the sphere world. That IMU would be set as the "frame" reference.

### Visual / Display

- [x] **#32 Reimagine HUD display** — canvas edge HUD with 3-column top bar (A=trace, S=scan, D=commit) drawn in renderer.js, DOM text HUD with left (fullscreen, coords, alt lock) / center (patch info) / right (commit dots, buffers) layout, HUD scale slider (0.5–2.0×) in viz settings with localStorage persistence. Old quadrant system removed. **Done (Mar 26)**.

### Housekeeping

- [x] **#33 Review TODOs post-Vasily** — reviewed and checked off completed items, reprioritized for workshop. **Done (Mar 26)**.

## Workshop Prep (Dartmouth, week of Mar 30)

### Memory & Stability

- [x] **#34 Recording time meter** — perf monitor rec bar showing total recorded time vs configurable limit.
- [ ] **#35 Verify `sweep` actually frees memory** — test that sweep releases AudioBuffer references and allows GC.
- [ ] **#36 Stress-test long sessions** — record continuously for 15–30 min in Chrome, monitor memory in DevTools.
- [x] **#37 Graceful memory guard** — warns at 80%, blocks recording at limit, configurable via audio settings slider.

### Multi-Channel / VBAP

- [ ] **#38 Verify 8-channel VBAP** — test with 8-speaker layout in Electron. Confirm VBAP lookup table generates correctly, panning is smooth, no dropped/silent channels.
- [ ] **#39 Stretch: test 42-channel VBAP** — try the full Dartmouth layout. Identify any performance cliffs (lookup table size, per-grain cost). Have a fallback plan if 42 is too heavy.
- [ ] **#40 Electron multi-channel setup docs** — write a short checklist for getting Electron + multi-channel output running on a fresh machine (students may need to set this up).

### General Reliability

- [ ] **#41 Full test pass** — run through the core workflow end-to-end (mic input → record → paint → scan → seed → sweep → repeat) on Chrome and Electron. Note and fix any rough edges.

## Deferred — Gesture & Experimental (post-workshop)

- [ ] **#42 Test gesture extraction with live wand** — load `?exp`, wave wand, verify viz panel shows meaningful features. Tune scaling constants in `gesture.js` (JERK_SCALE, EFFORT_GYRO_SCALE, ENERGY_DECAY, etc.) based on real IMU data.
- [ ] **#43** Build gesture-to-sonic mapping layer (`js/exp/gesture-map.js`) — translates gesture features into sonic quality targets with temporal smoothing and inertia.
- [ ] **#44** Gesture-influenced painting (`js/exp/gesture-paint.js`) — smoothness→brush tightness, effort→density, directness→coherence, periodicity→rhythmic deposit. See EXP-NOTES.md for full design.
- [ ] **#45** Self-organizing sphere / concatenative paint mode (`js/exp/organized-paint.js`) — auto-place particles by timbral features (centroid→lon, RMS→lat, ZCR→secondary), adaptive normalization, particle migration animation. See EXP-NOTES.md for full design.
- [ ] **#46** Resonant filter bank on master bus (`js/exp/resonant-filters.js`) — first audio processing module, controlled by gesture layer
- [ ] **#47** Convolution reverb with gesture-controlled wet/dry (`js/exp/convolver.js`)
- [ ] **#48** Feedback delay network (`js/exp/fdn.js`) — cross-coupled delays routed through VBAP

## Someday

- [ ] **#49 Custom signal routing layer** — per-signal routing from breakout streams to arbitrary destinations. Design doc: `docs/ROUTING-DESIGN.md`. Plumbing scaffolded in sensor-registry.js (role arrays, route model, dispatch functions, persistence) and ui-sensors.js (breakout table with locked/editable destinations). Needs wiring to renderer, gesture, and morph consumers before it's usable. Build when preset roles (cursor/gesture/frame) aren't flexible enough.
- [ ] **#50** Spectral freeze via AudioWorklet (`js/exp/spectral-freeze.js`)
- [ ] **#51** Phase vocoder pitch shift for spatial harmonization
- [ ] **#52** Stochastic trigger zones on sphere
- [ ] **#53** Flocking/boid-driven audio from particle behavior

## Done

- [x] **#54 0.6 — Recording memory guard** — rec time meter in perf monitor, configurable limit slider in audio settings, memory guard blocks recording at limit, sweep auto-commit timer (30s)
- [x] **#55 0.6 — Search panel rework** — renamed lock/snap/free to scope/nearest/area, two visual groups (selection + area), show/hide area params by mode, standardized k display format
- [x] **#56 UI scale slider** — viz settings → panel & text size (0.7–1.6×), persisted to localStorage, scales all UI except 3D canvas
- [x] **#57 HUD quadrant redesign** — top=scan off, left=seed lock, right=loop lock, bottom=patch number
- [x] **#58 Param panel overhaul** — flattened headings, removed dividers, morph as independent collapsible, visual polish pass
- [x] **#59 Shift+D/S flash fix** — `_plainD`/`_plainS` flag pattern prevents button flash on modified key combos
- [x] **#60 Fixed panel width** — no longer scales with viewport, responds only to UI scale slider
- [x] **#61 Bug: rapid uproot blocked by release fade** — fixed: `findNearestSeedSlot()` skipReleasing, HUD count immediate, releasing slots reusable for sowing
- [x] **#62 Unify key bindings + add seed lock mode** — ⇧D loop lock, ⇧S seed lock, ⌘D lift, ⌘S uproot, cursor panel reorg (trace → scan → undo → [lock row])
- [x] **#63** Build gesture extraction module (`js/exp/gesture.js`) — smoothness, effort, periodicity, accumulated energy, directness
- [x] **#64** Build gesture visualization overlay (`js/exp/gesture-viz.js`) — live feature bars, gyro trace, energy arc. Press G to toggle.
- [x] **#65** Hook gesture update into osc.js wand inertial path (`S._onGestureUpdate?.()`)
- [x] **#66** Set up `?exp` feature flag system (EXP in state.js, lazy loader in main.js, exp-init.js bootstrap)
- [x] **#67** Clean up repo — delete audit .md files, move reference docs to `docs/`, add CLAUDE.md
- [x] **#68** Transfer repo to kalun88/muboneapp, update README
