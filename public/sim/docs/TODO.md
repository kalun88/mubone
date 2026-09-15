# TODO — Current Tasks & Priorities

> **Status: CURRENT** · the OPEN list, and only that. A finished item leaves this file the day it closes, into `docs/archive/TODO-DONE-<month>.md` (`docs-audit.js` fails on any `[x]` here). Read the items that touch the task in hand, not the whole file.

> **End of session: one entry per thing done, five lines or fewer, placed in the current month's archive file, not here.** Name the #id, the files, and where the reasoning lives — the commit message or the doc that owns the area. The long narrative that used to go here goes in the commit message (`git log` keeps it forever) or the owning doc; a new rule of the codebase goes in `docs/RULINGS.md`. Open items found along the way go under today's date below.

---

## Open — by date found

### Sep 15

- [ ] **The light canvas is unreachable code** — `S.darkMode` is a constant `true` since the Canvas Theme
  option was removed (Ek, 2026-09-15). `renderer.js` still branches on it in ~25 places and
  `audio-features.js` keys a colour cache on it; every light half is now dead. Deleting them is mechanical
  but crosses modules (`renderer.js`, `audio-features.js`, `state.js`), so it wants its own sketch and a
  confirmation rather than riding along with a settings change. `SPHERE_PALETTE.light`, `TRAIL_INK_LIGHT`
  and `MUTED_PARTICLE_LIGHT` go with them.

- [ ] **Selecting stereo does not reach `S.mainInputChannel`** — found 2026-09-15 by the paint-gate work,
  NOT caused by it: `cc-mirror-audit` fails `stereo reaches S.mainInputChannel — 0` on a clean checkout of
  HEAD as well. The modal's channel select mirrors `stereo` into the panel correctly, so the UI agrees with
  itself and disagrees with the engine. Pre-existing and unrelated to the viz round; logged here rather than
  fixed inside it.

- [ ] **`colour-audit` listens to the room and cries wolf** — its two room-sensitivity checks fail on a
  different axis, a different sound and a different margin on almost every run, on a clean checkout too
  (measured four runs, 2026-09-15: hue `breath` 0.066 / hue `click` 0.082 / saturation 0.31 / hue `breath`
  0.073). It is measuring the live mic, so it reports the room rather than the code. Either give it a fixed
  signal or widen the thresholds — until then a red `colour` says nothing. `§ J`'s perfMode check is
  separately flaky: it reported `over 0 dots` once in three, because at 30° fov its test marks are off-screen.

### Sep 14

- [ ] **#357 A pinned loop still duplicates its take in the file** — left open by #354, 2026-09-14. The piece's
  audio members are content-addressed, so two slots sharing one AudioBuffer now write once — but
  `createSeqFromStroke` (ui-presets.js) copies a REGION of the take and crossfades its tail, so a pinned loop is
  derived material with a different hash and is carried in full beside the take it came from. Each overdub take
  likewise. Storing it as a recipe — `{ from: <take id>, start, end }`, re-derived on open through the same
  function — is the fix, and it is the shape the overdub format already uses for its layers ("a file cannot carry
  a layer that disagrees with its master"). The risk is that the re-derivation must reproduce the crossfade
  exactly, or a reopened loop wraps differently than the one that was saved.

- [ ] **#352 Wet (and pin-on-end) may belong to the cursor, not to each tool** — Ek, 2026-09-14, thinking aloud while
  the wet ring was fixed: "it's honestly a bit non performative and confusing. right now it's treated as a property
  or flag of a tool. which seems overkill to have each tool carry its own flag. arguably the same with pin on end
  behaviour. in reality i'm not gonna keep track of each tool's wet or not. it's kinda more a cursor behaviour or
  global one. it's more like, are the paintbrushes i use wet." **Not a decision — the per-tool flag stays for now**
  ("i think i'll stick with this wet implementation for now"), and the drop became a button on every grain tile the
  same day so the flag is at least flippable from the surface you play from. What to weigh if it is revisited: a
  global wet would be ONE switch above the tools (the shape memory says a performance control is boolean and its
  third state goes to a settings page), it would make `isWet(tile)` a cursor read and `dryVoicing` a sweep over every
  wet voicing at once, and it would cost the thing the per-tool flag buys — a wet brush and a dry brush side by side
  on the strip, which is what `docs/RULINGS.md` "wet paint" argues wet is FOR. Auto-pin has the same shape and should
  move with it or not at all. See the wet-ring fix (2026-09-14) for why the visible half kept going wrong.

### Sep 13

### Sep 12

- [ ] **#350 A stored bare-id button row is dropped, not moved** — narrowed 2026-09-13. The COLLISION half is
  closed (#351): a stored row on a gesture a palette position now holds is deleted, per Ek's ruling. The legend half
  did not reproduce — every palette tile wears its sticker on a synthetic pre-2026-09-11 profile. What is left is the
  choice not yet made: a bare-id row on a FREE gesture (`commit_drop` on button 3 tap, say) stays bound to the bare
  action rather than being MOVED onto the position that holds that tile today, so it keeps working but the position
  does not claim it. Migrate it with the collapse-stamp pattern, or leave it.

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

---

## Open — From Previous Sprints

### From Workshop Prep (Dartmouth, week of Mar 30)

- [ ] **#36 Stress-test long sessions** — record continuously for 15–30 min in Chrome, monitor memory in DevTools.
- [ ] **#39 Stretch: test 42-channel VBAP** — try the full Dartmouth layout. Identify any performance cliffs (lookup table size, per-grain cost). Have a fallback plan if 42 is too heavy.

---

## Someday

Parked in `docs/archive/TODO-SOMEDAY.md` at feature lock (2026-09-13): 24 ideas from April to August (#43–#53, #74, #91, #112, #117–#125, #134, #145, #150). Not open work; an idea that comes back reopens under today's date above.

## Completed

**Apr 12:** #113, #115, #121, #9, #19, #22, #35, #91

**Sprint Mar 30 onward:** #112 (in progress), #111, #93, #38, #41, #106, #24

**Sprint Mar 29:** #110, #109, #107, #108, #101, #103, #102, #98, #97, #96, #95, #94, #100, #28.1, #89, #99, #104, #105

**Sprint Mar 28–29 (Final Weekend):** #31, #88, #88a, #92, #90

**Dartmouth prep (Mar 27):** #10, #15, #21, #29, #30, #32, #77, #78, #79, #71, #69, #70

**Flight Test notes (Mar 25–26):** #1, #2, #3, #4, #5, #8, #12, #13, #18, #23, #25, #26, #27, #33

**Earlier:** #54, #55, #56, #57, #58, #59, #60, #61, #62, #63, #64, #65, #66, #67, #68, #80, #81

- [ ] **`mark align` is non-deterministic on its own** — measured 2026-09-13 on a clean tree with no
  changes: 17 failures, then 0, on consecutive solo runs. The checks that move are the burst-loudness
  ones ("marks that cannot contain it stay small", "the covering mark is loud"), which depend on the
  recorder and the paint tick lining up under load. Until it is fixed the suite cannot witness a
  regression in `audio-features.js` or `paint-ticker.js`, which is most of the colour and deposit work.
  Likely fix: drive the bursts off the audio clock rather than wall time, or assert a rank ordering
  instead of absolute loudness.
