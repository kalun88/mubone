# TODO — done items, 2026-10

> **Status: ARCHIVED** · done items moved out of `docs/TODO.md`, verbatim, so the open list stays short enough to read every session. Record only: entries describe the code the day they closed and may use superseded terminology. `git log` and `CHANGELOG.md` are the other two records.

### Oct 4
- [x] ~~**Listen cursors: more than one sensor, one records**~~ — REVERTED the same day for Travis's PR #5 (`listen-cursor`), which is the one kept (2026-10-04) — role `listen` (any number of sensors can hold it;
  Settings › Sensors dropdown + a Listen button on each row). Reads like the cursor's lens, stays out of pinned clouds, records
  and controls nothing; drawn as a solid accent reach ring with its reach lines. Private instance: two listeners + a cursor,
  marks at one listener's spot → that one posted 6 candidates on slot 2000, the other 0; unmapping drops it. Claim
  exclusion not driven live; rig suites not run; not heard.
- [x] **The stations run; the narrow window gives way** (2026-10-04) — `npm run stations`: three profiles, OSC 7500/7510/7520,
  a sensor sent to each port lands only in its own window. At 570 each bar overlapped itself (brand × left group, meters ×
  sliders); now in tiers (RULINGS "A narrow window gives way in tiers"). New align invariant, red on HEAD, green after;
  measured 1440 → 420 on a private instance. Pre-existing align FAIL (rail header bars) also on HEAD, untouched.
- [x] ~~**A listen cursor skips the acos outside its radius**~~ — REVERTED with the listen cursor above; PR #5 has its own in-radius pass (2026-10-04) — pre-rehearsal sweep. Three listeners at 10 000
  marks cost 2.5 ms a 10 ms tick (one acos and a dynamic-key write per mark per listener); a dot-product test first, the
  angle only inside: 0.52 ms. Probe unchanged (6 candidates on 2000, 0 on the other). The rest of the sweep measured clean:
  drawFrame 1.2 ms at 2500 marks, scheduler 0.07–0.34 ms, handleOSC 3.3 µs a packet.
- [x] **Two dead per-frame costs out, found by profiling a rehearsal-shaped run** (2026-10-04) — CDP CPU profile of a
  private instance (sensor cursor + listener, 10 takes, 8 pins, both rails, synthetic input): main thread 83 % idle.
  The signal-path diagram's centring retried forever while Settings was shut, one rAF chain per redraw, stacking
  (540 rAF/s → 122 after five redraws; centring on open unchanged, 0.04 px). The cabinet's pin-bank canvas redrew every
  frame into display:none (0.6 %); now checked once a second, kept live for the projector popup's dots.
- [x] **The LED timbre reads the cursor's own distance** (2026-10-04) — `_sampleCursorTimbre` weighted by `p._ang`, which
  every cloud, walker and listener overwrites after the cursor; it runs on its own 10 Hz timer, after all of them. Now
  `p._cursorAng`. Private instance, 20 marks in reach + a listener aimed away: `_ang` off by up to 178.85°, `_cursorAng` 0.
  The full LED path (an x-imu3 holding the cursor) was not driven.
- [x] **A listen sensor: a second cursor that only hears** (Ek, 2026-10-04, two-instrument QA; Travis, PR #5 — the
  one kept) — sensor role `listen` (any number, up to 4): granulates the shared corpus where it points with cursor 0's
  lens, grain block and cloud claims, skips tape, records/pins/erases nothing. Posted as a moving cloud on cursor 0's
  bus; fades out when its sensor falls silent; drawn in `--accent-sensor`. Private instance: two sensors through the OSC
  dispatch, listener grains in the worklet over marks and none over empty sphere, cursor 0 records beside it.
- [x] **A listener works like the cursor** (Ek, 2026-10-04: "the listen cursor should just work like the regular
  cursor — for now") — tape lines and walk strokes fire on ANY cursor (`updateTriggerGates`: union, one playback,
  released by the last to leave); a listener's pool is cursor 0's geometry (opened takes, wet paint, walk / tape scope).
  sensor-rig-audit: a line under a listener fires (red without the gate change), an opened take is in its reach, the
  line releases. Not heard on hardware.
- [x] **Frame returns, beside camera (Ek, 2026-10-04, two-instrument QA)** — `frame` back in `QUAT_ROLES` and the
  role menu; the cursor is `inFrame(C, F) = conj(F)·C` while the frame is live, the world cursor otherwise; the
  camera chip's tooltip names it. `sensor-math.js`, `sensor-registry.js`, `renderer.js`, `state.js`, `main.js`,
  `ui-sensors.js`; `sensor-audit` § L, a frame section in `sensor-rig-audit`. RULINGS "Frame returns, beside camera".
- [x] **More cursors on a stroke, more voices** (Ek, 2026-10-04: "if there's more cursors on it it should be louder") —
  each listener has its own gate per stroke (`tg._inL`) and its own voice; arriving over another cursor's voice stacks
  (`_detachVoice`, owner-tagged) instead of cutting it, and a leave releases only that cursor's voices
  (`_releaseVoicesOf`, `stopTriggerAudio(…, keepVoices)`); walkers are per cursor too. Replaces the same day's one-voice
  union. sensor-rig-audit: two listeners on one line = two voices; one leaving = one. Grain material already stacked.
- [x] **A take laid under a resting listener plays at once** (Ek, 2026-10-04: "like if it was a pinned empty
  cloud/loop … make sure to fix all those edge cases") — the cause: the cursor releasing the take and the listener
  arrived on one tick and merged into ONE voice (the cursor's), so the listener was silent until it re-touched. The
  later arrival now waits a tick for the first source and stacks. Plus the empty-pin rules: listeners born primed on an
  edit/import, claims tracked not doubled, unpin = arrival, eye/dwell edges, audition cursor 0's. 4 new rig checks.
- [x] **Listeners' own cursor settings; a numbered chip per sensor** (Ek, 2026-10-04) — the CURSOR card's `for`
  row (cursor · 2 · 3…), `own settings` (copy of the cursor's), scope/radius/grain behaviour per listener in its slot;
  engine, gates and ring read `l.v`. Chrome: one device-glyph chip per sensor, numbered as the Sensors page, opening
  it on that sensor. sensor-rig-audit own-radius check; align green with 0 and 3 sensors (`.tc-sens` --gk 0.887).
  Align with sensors connected also shows 3 pre-existing Sensors-page fails (on main too).
- [x] **align-audit green with a sensor connected** (2026-10-04) — the three Sensors-page fails were two descriptions
  over 92 / two sentences (Mounting and heading: the tare status is a `.set-row-status` now; Axes: the long version
  is the description's tooltip) and an AUDIT artifact: the instrument-template stand-in was appended outside the
  selected sensor's card, 17px off the card's inset. It goes where ui-sygaldry.js lends it, into the card.
