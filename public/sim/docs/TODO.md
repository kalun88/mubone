# TODO — Current Tasks & Priorities

> Update this file at the end of every Cowork/Claude Code session.
> New sessions: read this after CLAUDE.md to pick up where we left off.

---

## Sprint — Mar 29 evening

- [ ] **#93 Review and simplify all patches** — audit the existing preset patches in light of the new features added this sprint (detethered cursor, unified commit model, trace modes, loop release modes, HUD redesign, FOV calibration, etc.). Simplify redundant or outdated param combinations, ensure patches take advantage of new capabilities, and trim down to a clean set ready for the Dartmouth workshop.
- [ ] **#38 Verify 8-channel VBAP** — test with 8-speaker layout in Electron. Confirm VBAP lookup table generates correctly, panning is smooth, no dropped/silent channels.
- [ ] **#41 Full test pass** — run through the core workflow end-to-end (mic input → record → paint → scan → seed → sweep → repeat) on Chrome and Electron. Note and fix any rough edges.
- [ ] **#24 "Performance patch" — dead-simple workshop preset** — a learning-friendly configuration for Dartmouth students. 3–4 patches max, key params locked (fade times, radius, grain settings), loop/seed simplified, designed around 1–2 pedal controls and nothing else. Goal: someone can sit down and perform a short piece without touching the UI. Design the patch set, lock list, and pedal mapping, then build as a loadable preset or startup mode.

---

## Sprint — Mar 29

- [x] **#101 Verify settings import/export** — **Done (Mar 29).** Verified export/import round-trip for all localStorage keys including recently added ones.
- [x] **#102 Audit MIDI/key/OSC action coverage** — **Done (Mar 29).** Full audit of ACTIONS array in `midi.js` and OSC handlers in `osc.js`. Renamed `/cursor/mute` → `/cursor/scan`, moved search params from `/grain/*` to `/search/*`, added missing actions (tare, erase_all, commit_selection, darkmode), removed 10+ legacy aliases, renamed "rec+paint" → "trace", routed all OSC trigger/bang actions through `S._dispatchAction` for consistent button flash feedback, cleaned up stale imports in osc.js.
- [x] **#98 Dark / light mode** — **Done (Mar 29).** Viz settings panel now has a dark/light toggle (persisted to localStorage). Canvas background, grid lines, equator, latitude tints, cursor reticle, crosshair, edge indicator, active-grain glow, tether trail, cursor label, and particle lightness (via `featuresToHSL`) all switch between contrast-appropriate colours. Feature viz on/off toggle removed (always on). Center reference marker toggle and `showZeroRef` state removed. Preset save/load updated (`darkMode` replaces `vizMode`, legacy compat preserved).
- [x] **#97 Electron audio engine startup reliability** — **Done (Mar 29).** Three-part fix: (1) `requestMicAccess()` skipped in Electron on startup — was always failing getUserMedia and showing "mic denied." (2) `requestMicAccess()` short-circuits in Electron — returns true if RtAudio active, false if not — so spacebar/D-key/OSC recording paths work without getUserMedia. (3) `activateSavedInputDevice()` now updates mic button to "mic ready" after RtAudio wires up. Also simplified the audio settings modal: removed Start Audio and all Apply buttons — device selection activates immediately on change (Ableton convention). Sample rate and buffer size also apply on change. Input device dropdown always shows "— select input device —" placeholder (even after a device was saved) so you can deselect to disable input.
- [x] **#96 Performance mode toggle in menu** — **Done (Mar 29).** Added on/off segmented toggle in viz settings panel with ⇧P shortcut label. Matches existing `grain-seg` button styling. UI syncs with Shift+P keyboard shortcut and `/app/perfmode` OSC via `S._syncPerfModeUI` callback.
- [x] **#95 Meridian/equator visual hierarchy on sphere** — **Done (Mar 29).** Prime meridian (0° lon) draws as a tapered great circle: thickest/brightest at the equator (3.5px, 0.9α), thinning continuously toward poles (1.0px, 0.3α). Back meridian (180°) follows the same taper at lower intensity (2.0→0.8px, 0.5→0.2α) so the pair reads as one great circle with clear front/back distinction. Equator stays distinct (2.5px, 0.9α). Regular meridians and lat lines unchanged. PerfMode simplified to equator + prime meridian only at 0.8px/0.2α. Implemented via `_drawArcSegment()` helper that draws a meridian segment between two latitudes with per-segment styling.
- [x] **#94 Performance mode: simple active-particle highlight + minimalist grid** — **Done (Mar 29).** In perfMode, particles currently played by a grain light up white (dark mode) or black (light mode) at near-full alpha — one `activeGrainMap.has()` check per particle inline, no extra draw pass. PerfMode grid: equator + prime meridian only at 0.8px/0.2α — clean minimalist wireframe.
- [x] **#100 Trace mode locked when commit slots full** — **Fixed (Mar 29).** When all commit slots were full (overflow off), `_syncSeqButtonStates()` forced `S.traceMode` back to `'trace'`, preventing A-key cycling. Removed the auto-reset — trace mode now stays armed even when full. Added "armed but full" indicators: button label shows parenthesised mode name (e.g. "trace + (cloud)"), and the edge HUD left column draws a diagonal stripe pattern (mode colour + grey) instead of solid colour. Both indicators clear automatically when a slot frees up. `_commitSlotsFull()` helper added to renderer.js (mirrors `seqSlotsFull()` to avoid circular import).
- [x] **#101 Full-slots UX: reactive label + right HUD stripes** — **Done (Mar 29).** Fixed infinite recursion between `_syncCommitUI()` and `_syncSeqButtonStates()` (mutual call loop introduced during #100). Inlined trace label update directly in `_syncSeqButtonStates()` so parenthesised mode name updates reactively when slots fill/empty — not just on A-key cycle. Added diagonal stripe pattern to the RIGHT edge HUD column (commits/D) when slots are full and overflow is off, matching the left column pattern but using the commit mode colour (blue for cloud, pink for loop).
- [x] **#28.1 Trace+cloud / D-cloud interleave edge cases** — **Fixed (Mar 29).** Shelved seed recording and finalization hardened for all release orderings (space-first, D-first) across forward/pingpong/rev loop modes.
- [x] **#89 Setup Keith McMillan SoftStep** — **Done (Mar 29).** Configured SoftStep foot controller for mubone (pad/pressure mapping, MIDI routing, preset integration).
- [x] **#99 Audit factory defaults reset** — **Done (Mar 29).** Reviewed the factory defaults button against all localStorage keys. Ensured every persisted key is cleared on reset.
- [x] **#104 Undo during active recording — buffer count desync** — **Fixed (Mar 29).** Undo while tracing/recording was splicing the live buffer out of `liveRecBuffers` while the worklet was still writing into it, desyncing `currentLiveBufferIdx` and breaking subsequent undos. Fix: `undoLastStroke()` now detects mid-recording state, calls `stopLiveRecording()` first (cleanly finalizes/discards the buffer), runs normal undo (splice + reindex), then calls `startLiveRecording()` + fresh `recordStrokeStart()` so the performer keeps painting seamlessly. Also fixed a pre-existing bug where splicing a finished buffer below the active recording slot didn't adjust `currentLiveBufferIdx`.
- [x] **#105 Alt-lock blocking painting and undo** — **Fixed (Mar 29).** Alt-lock (freeze view, free mouse) was over-blocking: (1) particle painting guard in renderer.js (`isPainting && !altLocked`) prevented spacebar/D-key/OSC recording from depositing particles while alt-locked — removed the guard since the position calculation already uses frozen coords. (2) Right-click undo on canvas was blocked by `altLocked` return — removed the guard so undo works regardless. Canvas left-click paint correctly stays blocked (mouse clicks should go to UI when alt-locked). Keyboard shortcuts (Space, D, Ctrl+Z, Backspace×3, etc.) were never blocked and continue to work.

---

## Sprint — Final Weekend Before Dartmouth (Mar 28–29)

- [x] **#31 Pico projector + detethered cursor** — Two-IMU mode: frame-role IMU provides the viewport/world anchor, cursor-role IMU drives a free-roaming cursor detethered from screen center. Activates automatically when both cursor-role and frame-role sensor slots are assigned. Single IMU = cursor locked to center as before. **Done (Mar 28).** Key details:
  - `S.cursorQ` holds the cursor orientation when detethered; `S.detethered` is a derived getter (`cursorQ !== null`).
  - `getSensorCursorQ()` added to sensor-registry.js; `getSensorCamQ()` returns null when frame-role active (camera stays at identity, frame provides the view).
  - `getFrameQ()` conjugates its output to compensate for `cameraTransform()` applying `frameQ` directly but `camQ` conjugated — this was the fix for frame gimbal lock (pitch→roll coupling at 90° yaw). **Do not remove this conjugation.**
  - Cursor naturally roll-mutes in detethered mode: `cursorQ` is only used for forward-vector projection (a point, not an orientation), so physical roll of the cursor IMU has zero effect on cursor position.
  - Edge indicator (off-screen cursor arrow) with on/off toggle and size slider in viz settings.
  - Camera modal shows dynamic subtitle: "1 sensor — cursor locked" / "2 sensors — cursor free".
  - Main tare (Z/backtick) tares both cursor and frame when both assigned. Per-slot tare still available.
  - ~10 call sites audited; 2 fixed (renderer.js paint-drop, ui-trace.js captureFrame).
  - Mounting-aware tare: `slotTare()` auto-selects gravity-aligned (flat mount, X=roll) or full-quaternion tare (non-flat mount, Y/Z=roll). Set axis map before taring. Full-quat tare zeros the entire mounting rotation so Euler decomposition works cleanly for any orientation.
- [x] **#88 Projection-to-space calibration** — method for aligning the projected sphere visualization to the physical speaker layout in the room. **Done (Mar 29).**
  - [x] **#88a FOV only affects horizontal axis — vertical drift on pitch** — **Fixed (Mar 28):** `focalLen` in `project()`, `screenToLonLat()`, and all renderer usages was computed from `canvas.width`, making the FOV slider represent horizontal FOV. The vertical FOV was implicitly derived from canvas aspect ratio, so if canvas AR didn't match the projector AR (e.g. laptop 16:10 mirroring to 16:9 projector), vertical pitch movement drifted. Changed all six `focalLen` computation sites to use `Math.min(canvas.width, canvas.height)` — the FOV slider now controls the narrower (vertical) dimension, matching the standard 3D convention and ensuring vertical alignment. The user will need to re-adjust the slider since the value now represents vertical FOV (set slightly higher than before for the same zoom level).
- [x] **#92 Grey border visible around viz canvas in fullscreen** — **Fixed (Mar 28):** In Electron fullscreen, body retained `padding: 0.5rem 0.75rem` and `background: #161616`, creating visible grey edges around the canvas-wrapper. Added `body.electron-fullscreen { padding: 0; gap: 0; }` to zero out body padding/gap in fullscreen mode.
- [x] **#90 Electron fullscreen shows viz only (like browser)** — **Done (Mar 29).** Toggles `body.electron-fullscreen` class to hide top bar, right panel, bottom panel, and expand canvas to fill the window, matching the browser `canvasWrapper:fullscreen` behavior.

---

## Sprint — Dartmouth prep (completed Mar 27)

- [x] **#10 Zero reference indicator on sphere** — visual marker showing where "zero" is, so you can see how far the IMU has drifted over time. **Done (Mar 27)**.
- [x] **#15 K count slider minimum range** — slider floor set to 30 so k can be set before painting. Grows beyond 30 once particle count exceeds it. **Done (Mar 26)**.
- [x] **#21 Tooltip delay too fast with Learn off** — changed from 400ms to 3000ms when Learn is off. **Done (Mar 26)**.
- [x] **#29 Loop release mode: play-to-end option** — `S.loopReleaseMode`: 'fade' (existing ms fade-out) or 'play-to-end' (disables looping, plays through to loopEnd with 50ms fade). UI segmented button in commit section, OSC `/commit/loop_release`, MIDI mappable. Preset save/load wired. **Done (Mar 26)**.
- [x] **#30 Sensor gain for extremity-mounted IMU** — resolved: not an issue. See full notes in Mar 26 flight test section.
- [x] **#32 Reimagine HUD display** — canvas edge HUD with 3-column top bar (A=trace, S=scan, D=commit), DOM text HUD (left/center/right layout), commit dots, patch info, HUD scale slider. **Done (Mar 26)**.
- [x] **#77 Electron: painting doesn't produce particles** — **Fixed (Mar 27):** `startLiveRecording()` guard in audio.js checked `S.recordingStream` which is only set by browser getUserMedia. Added `hasRtAudioInput` check. Also added `warmUpAudioEngine()` call in `activateSavedInputDevice()` to pre-load recording worklet in Electron.
- [x] **#78 Electron: getUserMedia conflict in audio settings** — **Fixed (Mar 27):** Added `hasRtAudioInput` guard in `startAudio()` to skip `getUserMedia` when Electron RtAudio input is already active.
- [x] **#79 Electron: fullscreen button label + canvas resize** — **Fixed (Mar 27):** Main process now emits `fullscreen-changed` IPC on `enter-full-screen` / `leave-full-screen` events. Preload exposes `onFullscreenChanged` listener. events.js hooks it to update button label and fire `resizeCanvas()`.
- [x] **#71 Zeroing cursor GUI button and function (Z)** — originally thought to be a new function separate from tare, but the tare/zero button (Z) in the main GUI is what was needed. **Done (Mar 27)**.
- [x] **#69 Sensor tare correction for off-axis wrist mount** — when IMU is worn on the wrist at an angle (not flat), tare captures the tilt and subsequent up/down movements cause diagonal cursor drift. *Fixed (Mar 27):* gravity-aligned tare extracts only the heading (yaw around Z/up) from the raw quaternion, keeping the reference frame level with gravity. Auto-recenter fires on the next render frame to snap the cursor to center. Works correctly with tilted mounting. *Limitation:* tilt-tare correction only works with default axis mapping (X=roll, Y=elevation, Z=azimuth). Non-default axis maps still work normally but won't compensate for tilted mounting — the roll offset is always captured from the X Euler component because it's the innermost rotation in the ZYX decomposition and is the only axis where pre-subtraction is mathematically clean.
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

- [ ] **#9 Surface mode yaws one direction after pole** — orientation snaps or drifts after passing through a pole. *Note (Mar 27):* the forward-vector path pole fix now covers sensor mode with roll muted OR unmapped — surface mode (trackpad) uses a separate incremental rotation path that should already handle poles. If this persists in surface mode specifically, investigate the trackpad delta path in renderer.js.
- [x] **#10 Zero reference indicator on sphere** — visual marker showing where "zero" is, so you can see how far the IMU has drifted over time. **Done (Mar 27)**.
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

## Active — Flight Test Notes (Mar 26, post-Vasily)

### Bugs

- [x] **#25 Release all doesn't work** — Fixed: ⌘D tap releases one commit (nearest/farthest per selectionMode). Hold-to-clear removed — clear all is GUI button only (`commitClearBtn`). **Done (Mar 26)**.
- [x] **#26 Overflow mode: drop/draw buttons still greyed out** — when overflow is set to oldest or nearest, the drop and draw buttons remain disabled when slots are full. They should only be disabled when overflow is off. Verify that overflow eviction actually fires on commit when pool is full.
- [x] **#27 D-loop + trace conflict** — Fixed: mutual exclusion via `S._cLoopActive` / `S._traceActive` flags. D-loop greys out trace indicator, trace+loop greys out D-loop buttons. Proper handoff on release — whichever key is still held resumes recording. **Done (Mar 26)**.

### Commit System

- [x] **#28 Autocommit independent mode selector** — redesigned as trace mode cycle (`S.traceMode`: trace / trace+loop / trace+cloud). A key or button cycles mode, spacebar/mouse activates. Scan auto-mutes only on activation (not arming). D key for commit (tap=drop, hold=draw), Shift+D=mode cycle, ⌘D=release. D-loop and trace+loop mutually exclusive with visual greying. Trace+cloud allows concurrent D-cloud drops with shelved seed recording. S key for scan toggle, button polarity flipped (white=on, orange=off). Cloud buttons light blue (#7eb8e0). Legacy `commitLockEnabled` getter/setter preserved. **Done (Mar 26)**.
- [x] **#29 Loop release mode: play-to-end option** — `S.loopReleaseMode` ('fade'|'play-to-end'). Fade uses existing release time slider; play-to-end disables loop flag on AudioBufferSourceNode so it plays through to loopEnd, with 50ms fade near end, then auto-removes from slot via 'ended' event. UI: segmented button in commit section. OSC: `/commit/loop_release`. Preset export/import wired. **Done (Mar 26)**.

### IMU / Wand / Orientation

- [x] **#30 ~~Sensor gain for extremity-mounted IMU~~** — NOT AN ISSUE. Quaternion orientation is 1:1 physical-to-virtual and should stay that way — where you point is where the cursor goes, regardless of mount position. The original concern (values too large on extremity mount) was misdiagnosed: quaternions represent absolute orientation, not relative motion, so mount position doesn't affect values. For "higher resolution" painting in a small area: turn down radius and viz dot size to pack more particles. For improv settings where full body 1:1 isn't needed: the flat map projection + definable painting area (#73) solves this by mapping a smaller physical range to the full sphere. Inertial gain (gyro/accel) is a separate issue if needed later — add per-slot gain in sensor-registry.js `inertialCal`.

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

- [ ] **#39 Stretch: test 42-channel VBAP** — try the full Dartmouth layout. Identify any performance cliffs (lookup table size, per-grain cost). Have a fallback plan if 42 is too heavy.
- [ ] **#40 Electron multi-channel setup docs** — write a short checklist for getting Electron + multi-channel output running on a fresh machine (students may need to set this up).

## Deferred — Later Features

- [ ] **#103 Handsfree recording mode** — pedal-armed auto-record: a toggle (foot pedal or UI) enters "armed" state. While armed, the existing noise gate triggers buffer recording automatically — input crosses threshold → start recording, gate closes → finalize buffer and paint particles. Each gate-closed pause acts as a buffer boundary so successive phrases become separate buffers. Design concerns: (1) gate sensitivity/threshold control and release time tuning so short pauses don't chop mid-phrase, (2) feedback from monitor bus giving false gate triggers — may need to use the pre-monitor input signal or a sidechain from the dry mic tap, (3) UI for armed state indicator + per-buffer visual feedback. Ties into #89 (SoftStep pedal mapping). **Implementation notes:** inputAnalyser already taps raw mic before any grain/monitor routing, so the feedback problem is purely acoustic (speakers → mic). Proposed approach: (a) proper gate with attack/hold/release timing (hold ~300–800ms prevents mid-phrase chopping, release ~200ms for smooth close), (b) output-referenced threshold — read masterAnalyser RMS and only open gate when input exceeds output by a configurable margin (e.g. +6dB), so ambient grain playback from speakers doesn't false-trigger, (c) optional auto-duck — reduce master output while a buffer is capturing so instrument comes forward and acoustic feedback energy drops, restore on gate close.
- [ ] **#82 Basic morph for roll override / azimuth+elevation lock (cursor lock) via gesture panel capture** — implement a basic morph mode where roll overrides or azimuth and elevation are locked (cursor lock), then use the gesture panel to capture and drive the morph.

## Deferred — Later Fixes

- [ ] **#91 Normal-mode renderer stalls with 16 moving clouds during recording** — Performance mode (Shift+P) eliminates the issue instantly, so the bottleneck is renderer-side, not scheduler. Scenario: recording live mic + painting a moving cloud trail (cloud lock on) + scanning + 16 moving seed slots active + frame IMU rotated away from clouds. Stalls get worse when clouds are off-screen (edge indicators still render). **What's been done so far (Mar 28):**
  - Depth sort removed globally (was O(N log N) per frame, unnecessary with transparent particles)
  - `rebuildLiveBuffer` changed to incremental copy (was copying entire recording buffer every 200ms)
  - Frame-skip under CPU pressure: skips `drawFrame()` when `perf.schedulerDrift > 1.5× interval`
  - Trail budget: 200 total trail projections/frame shared across all moving seeds (was 50 per seed uncapped)
  - Off-screen trail skip: trails not drawn when seed's current position is behind camera
  - Reuse `seed._currentFrame` from scheduler instead of redundant `_interpolateMovingSeed` per frame
  - Incremental angular distance stamps: new particles only stamp new distances (was recomputing ALL N×16 distances when `_particleVersion` bumped during painting)
  - `_captureSeedFrame` throttled from 50/sec to ~15/sec
  - **What still needs investigation:**
    - Edge indicator rendering for off-screen moving clouds — runs trig math (atan2, sqrt) for all 16 seeds even when off-screen. May need budgeting or simplification.
    - `drawSeeds` still does `spherePointInto + cameraTransformInto + project` per seed per frame even for off-screen seeds (to compute edge indicator position). Consider early-out for seeds behind the camera.
    - Moving seeds in scheduler: each recomputes angular distances for ALL particles every tick (position changes, can't cache). 16 seeds × 500 particles × 50 ticks = 400K acos/sec. Could replace `Math.acos(dot)` with raw dot product comparison (cos is monotonic on [0,π]) — needs `_buildCandidatePoolNearest` and `_buildCandidatePoolRadius` refactored to use cosine threshold instead of angle threshold.
    - `project()` function still allocates a return object per call (~1,800/frame) — not yet converted to zero-alloc `projectInto`.
    - The `_drawVelocityDotTrail` function still runs `project()` per sample point, each returning an object. Could use scratch buffer.
  - **Key files:** `js/renderer.js` (drawSeeds, drawFrame, _drawVelocityDotTrail, drawParticles), `js/grain.js` (scheduleGrains angular stamp loops ~line 1404, _buildCandidatePoolNearest), `js/state.js` (perf object, perfMode flag)
  - **Toggle:** Shift+P = perfMode on/off, OSC `/app/perfmode`
- [ ] **#80 Setup Joy-Con controller** — configure Nintendo Joy-Con as an input controller for mubone (button mapping, motion data, connection handling).
- [ ] **#81 Setup FCB1010 foot controller** — configure Behringer FCB1010 MIDI foot controller for mubone (pedal/switch mapping, MIDI routing, preset integration).
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
- [ ] **#74 x-IMU3 binary mode / direct UDP reception (bypass Max for lower latency)** — the x-IMU3 has a binary data mode (device setting 11.1.66) that sends data messages as raw bytes instead of ASCII text. For quaternion: ASCII is ~50 bytes (`Q,timestamp,w,x,y,z\n`), binary is ~25 bytes (0xD1 + 8-byte uint64 timestamp + 4×32-bit floats + byte stuffing + 0x0A terminator). Roughly half the bandwidth. **However, latency savings are negligible** — the real latency comes from WiFi jitter (1-5ms), the Max → OSC → WebSocket chain, and browser event loop, not from parsing 25 extra bytes. Binary mode would also require parsing binary in Max or bypassing Max entirely. **The bigger latency win** would be receiving the x-IMU3's UDP stream directly in Electron's Node.js layer (the x-IMU3 sends UDP to configurable IP/port via settings 11.1.42-44) and piping straight to the renderer, cutting Max out of the data path. Only worth pursuing if latency becomes a real performance issue, or if running multiple IMUs at high rates (400Hz+) where bandwidth matters. See x-IMU3 User Manual v1.11 §8.2 for binary format, §11.1.66 for binary mode setting.
- [ ] **#105 OSC string-addressed mode switching** — currently all multi-option OSC controls (`/camera/mode`, `/spatial/panning`, `/trace/mode`, `/commit/mode`, `/grain/dir`, `/grain/curve`, `/commit/dir`, `/commit/blend`, `/commit/selection`, `/commit/overflow`, `/commit/loop_release`) are bangs that cycle through options. Add support for sending the target value as a string (e.g. `/camera/mode sensor`, `/trace/mode trace+loop`) so an external controller or Max patch can set a specific mode directly instead of cycling. The `dispatchAction` handler should check whether `midiVal` is a string and, if so, set the mode directly rather than cycling. `fmt` labels in ACTIONS should document both bang (cycle) and string (set) usage.
- [ ] **#91 Multi-IMU router for 2+ sensors** — when running two or more x-IMU3s (e.g. cursor + frame), need a routing layer that receives multiple UDP streams and dispatches each to the correct sensor slot. Could be a lightweight Node.js UDP server in Electron (ties into #74's direct-reception approach), or a small standalone router app/script that forwards tagged OSC to the WebSocket bridge. Key questions: discovery/identification of each IMU (by IP, serial, or x-IMU3 device name), mapping to sensor-registry slots, and whether this replaces Max entirely or supplements it.

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
