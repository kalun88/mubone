# Audits — which check to run, when, and what each one guards

> **Status: CURRENT.** The verification harnesses in `scripts/`, the policy for when a session runs them, and the reasoning behind each suite, moved here verbatim from CLAUDE.md on 2026-09-05. CLAUDE.md keeps the three-tier rule and points here; `scripts/audit-for.js` is the rule as code.

---

## 1. Three tiers — a change runs the fast checks, a release runs them all, the rig suites run when asked

Ek, 2026-09-05: *"each change is taking you like 5–20 minutes and I feel a lot of it comes with the checks at the end … the osc audit … I don't really use the osc pathway, that's for advanced users. Of course I should check before I ship but it seems to check this every time."* And 2026-09-18, after the per-file map had fanned a three-change diff out to six rig suites: *"we have tons of audit suites and honestly they take a ton of time and seem to run everything i do a little edit. i can't work like this."*

Measured that day: `docs-audit` + `audit:sensor` + `npm test` together, under one second; `rig-audit` on six suites (676 checks), 5 min 41 s; `cc-mirror` alone, about a minute. The rig suites are the whole cost, and the per-file map spent them on changes that were not about what they measure — a colour constant in `renderer.js` ran the 206-check pins suite.

**Tier 1 — per change, always.** The FAST rows of the map (§ 2): `node scripts/docs-audit.js`, `npm run audit:sensor`, `npm test`, `AUDIT_ONLY=wiring node scripts/osc-audit.js`. File-only, under a second together. `node scripts/audit-for.js --run` runs exactly these and nothing else. A red one is fixed before the commit. If none applies, run nothing and say so.

**Tier 2 — on Ek's word.** Every row that boots Electron or playwright or waits on real time: the rig suites, `audit:align`, `live-loop`, `browser`, `phone`. `audit-for.js` prints them under *on request only* with the exact command; `--run --slow` includes them. They run when the change is ABOUT the thing a suite measures (the paint ticker's sizing → `mark align`; a cabinet id → `engine`; the cushion → `trigger`) and Ek says "audit this" — never because a file was touched. The trade is stated and accepted: a rig regression is found at release rather than at the commit that caused it, and `git bisect` across the release's commits attributes it then.

**Tier 3 — per release** (Ek says "release", "ship", "bump", "commit & push"). Run everything: `node scripts/rig-audit.js`, `node scripts/osc-audit.js`, `node scripts/browser-audit.js`, `node scripts/docs-audit.js`, `npm run audit:sensor`, `npm test`, `npm run audit:align` against `npm run electron:dev` if CSS or markup changed since the last release, and `node scripts/deadweight-audit.js` (the inventory of what may be dead — report its rows, it is not a gate). Budget ten minutes. `/release` is these steps as one command; `/finish` is the per-change routine as one command. This is the only time the full osc sweep or browser-audit runs unasked.

**Two suites are release-only on purpose.** `osc-audit.js` reloads the renderer before every one of 99 addresses, twice, so a full run is three to five minutes; OSC is an advanced-user path Ek does not drive himself. When `js/osc.js` changes, run `AUDIT_ONLY=wiring node scripts/osc-audit.js` (static, instant) per change and the full sweep at release. `browser-audit.js` needs playwright and guards the public demo; it stays mandatory at release because it catches Electron-only assumptions leaking into shared modules, which breaks the rig too.

**The rig suites are LOAD-sensitive, and a single red run proves nothing (2026-09-13).** Measured the
same day: `mark align` on a clean tree gave 17 failures and then 0 on consecutive runs, alone;
`pins` is 200/200 alone and twice lost five reach-fan and bracket counts when it followed another
suite; `colour` is 43/43 alone and dropped two when it ran first in a batch. The checks that move
are the ones that need grains actually sounding inside a window, or an audio bus that has settled —
the first things a warm machine loses. So: **re-run a red suite alone before believing it, and
before bisecting anything.** If it is green alone and red in company, that is the harness. A real
regression is red alone, repeatably.

**`rig-audit.js` gives each timing suite its own boot (2026-09-13) — you no longer have to remember.** `trigger` and `mark align` are timing suites: one measures dropped blocks in steady state, the other records bursts and reads their loudness off the audio clock, and neither survives sharing an instance with the other. Both went red when the full rig-audit shared the machine with the OSC sweep, the browser audit and a third Electron instance (release 1.14, 2026-09-05); alone, both passed. The rule was a sentence here for eight days and still cost a false failure on 2026-09-13 — `mark align` reported seven failures with `trigger` ahead of it in the same boot and zero alone — so the tool keeps it now: each timing suite is launched in an instance of its own and everything else shares one. `--attach` cannot do this (there is one app and you chose it) and says so. Still do not run two rig-audits in parallel.

**A suite never takes the screen.** Every `launch()` sets `MUBONE_RIG_BACKGROUND=1`, so the audit window is created hidden, shown INACTIVE (`showInactive()`) and has no dock icon: it does not take focus and does not pull macOS to its Space (Ek, 2026-09-05: seven suites were seven windows landing on top of whatever he was doing on another desktop). `capturePage` renders an inactive window, so `ui-shots.js` and the probes are unaffected. `--attach` runs against the window you opened and changes nothing about it.

**Every launch is a fresh profile.** `launch()` runs the app as instance `audit-<pid>` and deletes that profile on close. It used to be one shared `audit` profile, and the sweeps wrote into it — cc-mirror left the input at `stereo` and the output gain at 9.5 — so on the day Ek's mono headphones became the default input, every recording test failed on that profile and passed on a fresh one (2026-09-05). **Two sessions at once** collide only on the OSC port: set `MUBONE_RIG_PORT` in the second (`MUBONE_RIG_PORT=7598 node scripts/audit-for.js --run`); `MUBONE_RIG_INSTANCE` names a profile that is then KEPT, for when you want one. A second session belongs in its own worktree (`claude --worktree <name>`); run `sh scripts/worktree-setup.sh` there once — it links `node_modules` from the main checkout so the suites can boot, and prints the instance/port line to use.

## 2. Which suite for which file

The map `scripts/audit-for.js` applies. A path is tested against every row, and every rig suite a change needs runs in ONE `rig-audit.js` boot (`rig-audit.js palette pins`). Keep this table and the script's `MAP` identical — `docs-audit.js` checks that every suite named here is a file. **Only four rows are tier 1** (`audit:sensor`, the osc wiring check, `docs-audit`, `npm test` — the script's `FAST` set); every other row is a tier-2 suite the script lists but does not run unasked.

| Files touched | Suite | Why that one |
|---|---|---|
| `js/tiles.js`, `js/brush.js`, `js/events.js`, `js/midi.js` (palette / key / hold paths) | `rig-audit.js palette` | the palette list, placing by drag, the drawer doors, the digits, both button modes |
| `js/pins.js`, `js/ui-pins.js`, `js/composer.js`, `js/grain.js`, `js/ui-presets.js`, `js/ui-export.js`, `js/brush-voicing.js`, `js/renderer.js` | `rig-audit.js pins` | pin groups, the restore rule, cloud claims, wet paint, reach lines, session import |
| `js/trigger.js`, `js/latency.js`, `js/audio.js`, `electron-main.js`, `electron-preload.js`, `audio-host.js`, `electron-loop-probe.js`, `js/worklets/quad-capture.worklet.js`, `js/worklets/input-meter.worklet.js` | `rig-audit.js trigger` | the proximity gate, "the button not the marks", the two audio hops and their cushion |
| `js/grain.js`, `js/grain-worklet-bridge.js`, `js/trigger.js`, `js/ui-meters.js`, `js/worklets/grain-engine.worklet.js` | `rig-audit.js lens` | the cursor reads what its tab says: radius, depth, k / all, nearest, scope, dwell grain, walk, the cap, fade, step |
| `js/paint-ticker.js`, `js/audio-features.js`, `js/grain-worklet-bridge.js`, `js/worklets/grain-engine.worklet.js` | `rig-audit.js "mark align"` | mark sizing from the audio after it, the peak offset the bridge posts |
| `js/audio-features.js`, `js/ui-viz.js` | `rig-audit.js colour` | the room cannot decide a hue or a saturation, the axis can see the vowel space, the arc reaches every family, the bounds stay constants |
| `js/param-registry.js`, `js/state.js` (`PARAM_DEFS`), `index.html` (cabinet ids), `js/ui-meters.js` | `rig-audit.js engine` | every engine row writes through a cabinet element; a deleted id kills a row silently |
| `js/midi.js`, `js/accessory-registry.js` (`ACTIONS`, `ccFn`, `range`) | `rig-audit.js "action ranges" "cc mirrors"` | half-throw readings; the modal/panel mirror pair |
| `js/osc.js` | `AUDIT_ONLY=wiring node scripts/osc-audit.js` | static cross-check, instant; the full sweep is release-only |
| `js/sensor-registry.js`, `js/imu-setup.js`, `js/sensor-mapping.js`, `js/ximu-settings.js` | `npm run audit:sensor` | pure maths, under a second |
| `css/`, **`index.html`**, `js/ui-settings.js`, `js/tile-layout.js` | `npm run audit:align` (needs `npm run electron:dev`), `node scripts/probe-selftest.mjs`, `node scripts/ui-shots.js` | measured alignment, never asserted; the probe must be green before any before/after claim. **`index.html` joined 2026-09-14**: it routed to `rig-audit engine` only, so a new GUI element — which is markup in this file — met none of the 108 measured checks |
| `js/*.test.mjs`, `js/sygaldry*.js`, `js/worklets/grain-engine.worklet.js` | `npm test` | the node unit tests, sub-second |
| `docs/`, `CLAUDE.md`, `README.md`, `INSTALL.md`, `sw.js`, `package.json`, any `js/*.js` (orphan check) | `node scripts/docs-audit.js` | banners, table rows, versions, orphans, dead script references |
| `js/live-loop.js`, `js/worklets/live-loop.worklet.js` | `node scripts/live-loop-audit.js` | real-time, ~15 s of playback; not in rig-audit |
| `js/main.js`, `sw.js` | `node scripts/browser-audit.js` | release-only unless the change is ABOUT browser mode |
| `js/mobile.js` (and the `body.mobile-mode` CSS, the hand's touch path) | `node scripts/phone-audit.js` | the phone: an emulated iPhone and Android on playwright — mobile mode on, the desktop chrome hidden, tap-to-begin fast, the motion permission asked INSIDE the tap, a gyro event turns the camera, a touch plays the hand. Nobody develops for the phone; this says whether it still works |

## 3. The scripts

`rig-audit.js` runs the sweep harnesses (`verify-action-ranges.js`, `cc-mirror-audit.js`, `trigger-audit.js`, `engine-audit.js`, `lens-audit.js`, `mark-align-audit.js`, `palette-audit.js`, `colour-audit.js`, `pins-audit.js`) against a real Electron instance it launches itself; `ui-shots.js` does layout the same way. All sit on `lib/rig.js`, need no setup, and are described in § 4. `browser-audit.js` is the one harness still on playwright, because it asserts what happens when `electronBridge` is absent. `docs-audit.js` reads files only. `osc-audit.js` and `osc-probe.js` inspect a running rig's OSC traffic; `osc-audit.js` also runs on the rig but takes minutes, so it stays out of `rig-audit.js`. `live-loop-audit.js` is wall-clock bound (a loop has to wrap) and is run by hand when the live-loop worklet changes. `composer-audit.js` **no longer exists**: it was sunset and its loop-is-muted / cloud-is-stopped checks live in `pins-audit.js`. `screen-probe.mjs` and `probe-selftest.mjs` are the before/after screen diff. `deadweight-audit.js` is the read-only inventory of what may be dead — unimported modules, unread storage keys, unreachable actions, unreferenced ids and classes, stray files, docs the archive rule covers — run at every release and whenever a sunset pass is planned; it exits 0 always, because every row is a question for Ek, not a verdict. `audit-for.js` maps the diff to the suite to run; `worktree-setup.sh` makes a fresh worktree able to run them. `dev-bridge.js` is the transport behind `.dev-bridge/`, and `lib/rig.js` is its node-side client. `build-share.command`, `launch-stations.command` and `run-stations.sh` are launch helpers Ek runs by hand.

**One command for the fast seven:** `node scripts/rig-audit.js` — one app boot, exits non-zero on any failure. It launches its own instance on a fresh `audit-<pid>` profile and OSC port 7599, so it can't touch presets, calibration or a live station, and inherits nothing from the last run; `--attach` runs against an open window instead, which every suite will disturb. Take a suite name to run just one (`rig-audit.js trigger`).

---

## 4. What each suite covers, and the trap it exists for

**For anything touching a cc action's `range` or its `ccFn`:** run `node scripts/verify-action-ranges.js` (or `rig-audit.js`, which includes it). Every cc action declares the real-unit span its `ccFn` covers and the curve it applies; the accessory table does unit maths against that declaration, so a wrong `curve` flag is silent — the UI keeps showing plausible cents and Hz while the pot's throw is skewed. The script runs the actual `ccFn` at v = 0, 63.5, 127 and checks the half-throw reading, which is the only place lin and log disagree. Exits non-zero on mismatch.

**For anything touching a setter that MIDI/OSC drives (`S._setX`, `setDryMonitorGain`, …):** run `node scripts/cc-mirror-audit.js` (or `rig-audit.js`, which includes it). Several controls exist twice — once in a settings modal, once mirrored into a main-UI device panel — and the mirror rides the modal element's `input` event. A setter that assigns `el.value` without dispatching `input` moves the modal copy and leaves the panel copy behind, which is invisible from the keyboard and only shows up when you drive the app from a controller. The script fires every cc action and diffs the whole DOM, so it catches the next one without anyone having to notice it on the rig. Extend the `MIRRORS` map when a control gets mirrored somewhere new.

**For anything touching how the cursor reads** (`lens-audit.js`, 2026-09-23): every row of the cursor tab driven through the scheduler's own geometry (`_cursorGeometry`, which the `__testCandidatePool` seam now shares instead of mirroring) and the bridge's real candidate tables — radius, local depth, the nearest k, all, nearest, scope, a `dwell: grain` take opening only once played through (nearest included), walk, the cap, the fade's gain against distance, and step's order. The trap it exists for: step ordered by BUFFER offset and nearest opened a take on arrival, both silently, and the seam had drifted from the scheduler. Depth counts STROKES for the cursor and the eraser (2026-09-23; it counted buffers, so every sampler stroke — one file — stayed at depth 1): the two sampler checks hold that.

**For anything touching the trigger tool:** run `node scripts/trigger-audit.js` (or `rig-audit.js`, which includes it). It exercises the proximity gate with injected cursor positions — enter/exit edges, the hysteresis band from both directions, the rearm window, and the bounding-cap early-out — then times the gate at 0/1/8/32 armed triggers. The hysteresis band is the case worth having a test for: the same distance must give a different answer depending on which side the cursor came from, and nothing else in the app behaves that way. The cost figure matters because the gate runs inside the 20 ms scheduler tick; treat a regression there as a real failure even though the assertion threshold is loose.

**For anything touching the engine pages, PARAM_DEFS, or a cabinet control an engine page
writes through:** run `node scripts/engine-audit.js` (or `rig-audit.js`, which includes it). 26
checks. The engine pages do NOT own their parameters — every row writes through a real cabinet
element (`dur` sets `#gcDurSlider` and dispatches `input`; ui-presets.js's handler is what reaches
the engine). That is the no-second-copy rule, and it has one invisible failure: **deleting or
renaming a cabinet element silently kills a row** — `_knobRange()` returns null, `_knobFor()`
returns null, the row stops rendering or stops doing anything, with no error. Since the cabinet is
`display: none` (#291) there is no screen on which anyone would notice, which is exactly why the
suite exists. § A drives every track and every segmented option on all eleven pages and requires
**engine state** to change, not the readout; § C names the 44 cabinet ids the pages depend on and
fails if one is missing, which is what makes moving a control family OUT of the cabinet a safe,
one-at-a-time job. Two traps it encodes, both of which produced false failures while it was
written: a track must be driven to one position and only then the other (A then B compared with
the start reports a working slider as dead when it began at B), and a segmented row must be
clicked on a NON-active option. The state snapshot must list every store a param can land in —
`S.grainCurveType` and `S.grainDirection` are not inside `S.grainParams`, and `S.trigMuted` is not
inside `S.triggerParams`.

**For anything touching composer mode, the cloud release path, or the seq audio graph:** run `node scripts/rig-audit.js pins`. `composer-audit.js` was sunset and its checks folded into `pins-audit.js`; what follows is the reasoning those checks carry. The original suite was 67 checks over two halves that behave differently on purpose: a **loop is muted** — its source keeps running so unmuting returns it mid-phrase, which the suite proves by muting across a full loop pass and checking `_startedAt`, the source identity and the phase against a second loop — and a **cloud is stopped**, held at silence with its slot intact. Section D exists because uproot on a held cloud was genuinely broken: the scheduler skipped `playing === false` slots, so `releaseCommit()`'s ramp never advanced and the commit was **unkillable while stopped**. § H guards the sphere-side cue: silent material greys — a loop claims its stroke (keyed on **strokeId**, not the particle objects the loop holds: `buildLoopPayload` rebases `grainStart` into NEW objects, so a loop owns a snapshot and marking it colours nothing you can see), a cloud claims what is in its radius, and a particle greys only when EVERY commit claiming it is silent — a stopped cloud over a playing loop must not grey material you can still hear. Section G is the one that matters most: it makes commits through the REAL `dropSeqFromCursor()` / `plantSeed()` paths and sweeps them with nothing but the cursor, because A–F build slots by hand and a hand-built slot is only ever the shape the test author imagined. The suite quiesces the scheduler before the gate section — the live gate runs off the real cursor at canvas centre and will toggle a test commit underneath the assertions, and that failure reads as a broken rearm window rather than a racing harness.

**For anything touching the pin groups, or the session file's `live` block:** run
`node scripts/pins-audit.js` (or `rig-audit.js`, which includes it). 113 checks. Two of the seven
sections carry the reasoning: § C is **derived audibility** (2026-09-05) — a pin has `mute` and
`solo`, a group has `muted` and `solo`, and whether a pin sounds is one function of the four, so
unmuting a group cannot resurrect a pin muted by hand (its flag is still set); the section also
proves a mute is IMMEDIATE (a loop's mute node lands within its 20 ms ramp with most of the pass
left, a cloud stops whatever its fade out says) and that the selected pin (nearest / farthest / oldest) is one
function. § D is solo: additive, mute wins, a pin born under a solo is silent. § O is **undo as the last user action** (`js/history.js`): through the real paths — the main button paints, a tap pins, a drop pins a loop, release unpins, the erase brush erases, clear-all unpins — it proves each is one action, that undo takes the last of any kind and redo puts the same object back, that holding undo reaches the empty show and holding redo returns, that a new action forks history, and that a stroke still recording is reached past. § B is the other, and it guards an
ABSENCE. Until 2026-08-30 a pin was filed into one of three NAMED groups by a stored `layerId`, and
§ F existed because that could go wrong on import: the rail repaints on a 6 Hz timer while the
commit loop `await`s a WAV decode per loop slot, so a repaint could land while slots carried
imported ids against the *previous* session's group set, fail to resolve them, and silently flatten
the arrangement — nothing throwing, and the next export writing the flattened version back.
**Deriving the group from the pin's KIND deleted that hazard rather than guarding it**, so § B
asserts that nothing writes membership and no pin can be moved between groups, and § F still drives
a repaint against an import because the cheapest way to keep a fixed bug fixed is to keep running
the test that caught it. It runs last in `rig-audit.js` because it is the only suite that imports a
session.

**For anything touching the OSC dispatch `switch`:** run `node scripts/osc-audit.js` (`AUDIT_ONLY=wiring` for the static half, which is instant and needs no app; `AUDIT_FROM=<address>` starts the sweep partway when you are chasing one). Four sections: `wiring` cross-checks the ACTIONS table against the dispatch statically, `fire` sends a valid payload at every advertised address and fails any that moves nothing, `edges` reports trigger addresses that also fire on an explicit 0 (a Max `[toggle]` runs those twice per press), and `types` reports value addresses that accept a bang and write NaN. Budget two to three minutes: `fire` and `edges` reload the app before every address, because handlers write shared state and sweeping all 99 in one page leaves it in a state where `/trace` never returns.

**For anything touching the timbre→colour chain — the two axes in `audio-features.js`, the ramp,
or the viz legend:** run `node scripts/colour-audit.js` (or `rig-audit.js colour`). It exists
because that chain was wrong in four independent ways at once and every bench test passed
throughout. The reason they passed is the suite's design principle: **a synthesised tone has no
noise floor, and a microphone always does.** So every sound is measured at three floor levels and
the suite reports what the floor MOVED, not only what the spread was. A suite that reported spread
alone would have been green at every stage of the bug. Two traps it already caught on its own first
run. The rig's input bus keeps a tail for up to 3.25 seconds after a source stops, so a "quiet"
reading taken straight after a floored one is a reading of the tail — every read now waits for the
bus to fall to real silence first, and without that the audit is sloppier than the instrument. And a
noise band's spectrum is random, so a single snapshot of a hiss is a coin toss; each reading is the
median of three, which is still fewer than the twenty marks a second a real stroke lays down. Its
strongest checks are § A (a floor moves no sound more than 0.06 on the hue axis; it was 0.187 before
the peak ratio), § B (`ee` against `ah`, which fails the moment the analyser's bins go coarse
again), § C (every noise band reads noisier than every sung sound — that one was INVERTED for
months) and § G (no slider, numbox or Listen button may reach the axis, because a colour is only a
shared word if nobody can quietly redefine it).

**For anything touching the paint ticker's live deposit, the loudness hold in
`audio-features.js`, or how a mark gets its size:** run `node scripts/mark-align-audit.js` (or
`rig-audit.js`, which includes it). A live mark is **sized by the audio AFTER it** — the window
from its own tick to the next, which is what its grain plays — so a live deposit captures the
mark as pending and materialises it one tick later with that window's loudness
(`_settlePending`; `stopLiveRecording` settles the last one before sealing). The hold reads only
the samples rendered since its previous read, counted off the audio clock, so the window is
exact at any frame or deposit rate. Before this (2026-09-02) the size looked backward while the
grain played forward, and the mark whose grain held a hit was drawn small while the one after it
was drawn big, at every deposit rate. And **a mark's grain starts BEFORE the mark**, by the time
the playing voice's envelope takes to peak (`grainPeakOffsetS` in `brush-voicing.js`: ½ dur for
a plain Hann, the fade length for a short attack, 0 for rect, × the pitch rate), so the point the
dot shows is the point you hear when you rest on it. **A mark stores only its moment; the offset
is the READER's** — `grain-worklet-bridge.js` subtracts it per candidate from the voice that will
play the mark (its frozen voicing, the live params under the filter, a cloud's own block), so a
different engine reading the same mark still peaks on it. Baked into the mark it was wrong the
moment the filter read it. The `align` knob this replaced was a hand-set guess at that number.
The suite records bursts at known times at two deposit rates and three brushes, asserts the
offset the bridge actually posts, and requires the mark that plays each burst to be the loudest
near it.

**For anything touching the palette, the tool rail's click, or a tile's verb:** run
`node scripts/palette-audit.js` (or `rig-audit.js palette`). Rewritten 2026-09-23 at the 5.6
release sweep for the FIXED TOOLBAR (`docs/PALETTE-GUI.md`): the suite before it (1515 lines, git
history) proved nine draggable positions, wet buttons and the `+` on engine titles, all deleted
2026-09-22, and had failed since. It checks the six tiles in the build's order (cursor · the hand's
press and hold · erase · pin · unpin) with no drag; the keys `c` `e` `↓` `↑`; every tile's radius
is its verb's (`VERB_RADIUS`); the mouse SELECTS — a tool opens its tab, the cursor opens the rail
and leaves the tab, the pin fires nothing; right-click cycles a position's verb and a hand side's,
stored one verb per position; the cursor's position caps and uncaps; `palette_N` per position and
no `_toggle` / `_hold` rows. It restores what it moves.

**Before trusting ANY before/after claim about the screen:** `node scripts/probe-selftest.mjs`
must be green — all seven, including the across-a-reload assertion, which takes BOTH its snapshots
of a fresh load (2026-09-14). It used to take the first as the session stood, and so failed after
anything had driven the app — including `npm run audit:align` immediately before it, which is the
order `audit-for.js` prints: align-audit opens Settings pages, the modal builds its pages lazily,
and the ~1100 elements it leaves behind (`bind-cell`, `set-table-row`, `set-meter-*`) are a
difference between that SESSION and a fresh one, never between two builds. `scripts/screen-probe.mjs`
snapshots the rig view (with the `display:none` cabinet revealed off-screen in place) and every
settings page, recording each visible element's box plus font-size, letter-spacing, colour,
background, radius, border and a short text fingerprint; `scripts/lib/probe.js` holds the element
walk both scripts share. Diff two snapshots and the difference IS the review of a consolidation
change.

It earns that trust the hard way: the probe read **0 on real changes twice** (it could not see the
cabinet), keyed rows by the element's first CLASS so a rename shifted every index after it, and
snapshotted a cabinet with a hole in it because the settings shell had a node on loan. Each fix
invalidated diffs already accepted. The self-test is what stops the next one doing that silently,
so a red self-test means every diff in that session is unverified. **An empty diff proves only that
nothing VISIBLE moved** — a rule for a state that is not on screen is invisible to it, so any round
that changes a state's appearance must also force each state and read the computed value back.

**For anything that adds, renames, retires or re-labels a doc or a `js/` module, and at every release:** run `node scripts/docs-audit.js`. No dependencies, no browser, under a second. It checks the things this project relies on convention for and therefore keeps losing: every doc has a status banner and a table row, the table's status matches the doc's own banner, CLAUDE.md's version claims match `package.json`/`index.html`/`sw.js`, every `js/` module is reachable from `index.html` or declared console-only in `KNOWN_ORPHANS`, nothing imports from `sandbox/`, and every `docs/` path cited in prose resolves. All six categories are failures that had actually happened by 2026-08-23 — CLAUDE.md said 1.12 through the whole 1.13 cycle, a CURRENT 335-line doc had no table row, and `ui-trace.js` sat unimported for months sharing its name with a live feature. Exits non-zero.

**For anything touching sensor calibration, `sensor-registry.js`'s `quatCal`, or the
mount/heading gestures:** run `npm run audit:sensor` (`node scripts/sensor-audit.js`). 18 checks,
pure maths, no app and no hardware, well under a second. Calibration is **two** left-multiplied
rotations on OPPOSITE sides — `output = conj(H) · q · conj(B)` — where **B** is the body-side mount
(set once per mounting by AIMING then BOWING FORWARD, counted in on a clock — one pose cannot
separate the strap's own twist about vertical from the performer's heading: measured 95% cross-axis
leak on a flat inverted mount, and § H is that test. The bow is the measurement, not two snapshots:
gravity yields only *up*, so the direction of rotation is the ONLY source of "which way is forward",
and the countdown replaced an auto-advancing stillness detector that gave the player no way to tell
whether pressing the button had done anything) and **H** is world-side, constrained to a pure twist about true vertical and
captured from `q · conj(B)` so it can never disturb B. The sides are the entire correctness argument
and are not guessable: because H is pure-Z it COMMUTES with a turn, so
`conj(H)·Rz(φ)·H·B·conj(B) = Rz(φ)` and a turn reads as yaw at EVERY mounting angle. Put the mount on
the left and the output frame silently becomes the DEVICE's rest frame — level mounts still work
because device-up and world-up coincide, and a sensor worn vertically reads a turn as pitch. That
shipped, because § A asserted `conj(q)·q = I`, which is true of any q and proved nothing. **A test
that cannot fail is worse than none**: § G now drives five named mountings plus 200 random ones and
fails loudly on the left-multiplied version, and § H does the same for a performer's PITCH and ROLL,
which is the motion a turn-only suite cannot see. § D guards the swing-twist singularity that a flat
upside-down mount lands on exactly. When modelling a performer's motion in a test, put it in the
PERFORMER's frame (between H and B) — modelling it sensor-side produced a false 88% failure that
talked this design out of the correct shape for an hour. Three things that are NOT calibration layers any more, and must
not come back: `DeviceState.tareEuler`, `.polarity` and `.rollMute` were all applied UPSTREAM of the
registry, so setting any of them changed the very quaternion the registry's calibration had been
captured against. An Euler-space tare cannot fix a heading offset at all — it decomposes, subtracts
yaw, recomposes, and subtracting an angle after a decomposition cannot rotate the frame the
decomposition used. Signs live in `slot.quatCal.axisMap`, downstream, where they are harmless.
And **imu-setup must never reset `quatCal`**: `_initOscSlot()` and `setFeeding()` used to null it
right after `getOrCreateSlot()` had restored it from localStorage, so a calibration lasted exactly
until the next reload. See `docs/TARE-RECENTER-ZERO.md`.

**For anything touching browser mode or the service worker, and at every release:** run `node scripts/browser-audit.js`. `playwright-core` is a devDependency since 2026-09-05 (the browser demo is a product, secondary to Electron — Ek); the one per-machine step is `npx playwright-core install chromium-headless-shell`. Its hosted-origin checks use `demo.localhost`, `reset.localhost` and `sw.localhost` — Chromium resolves `*.localhost` to loopback as a secure context, and `_bridgeReachable()` reads them as hosted — because the `127.0.0.2` / `127.0.0.3` it used before only Linux routes, so on this Mac the suite had timed out for weeks. It cannot move to the rig: an Electron instance always has an `electronBridge`, and the absence of one is the whole subject. It loads the app with no `electronBridge` and asserts module load, Electron-only controls degrading visibly, hosted-origin console cleanliness, that startup paints the settled layout rather than reflowing into it, and that a redeploy reaches a returning visitor while offline still works. Exits non-zero on failure. Note when writing assertions: `ui-learn.js` moves every `title` attribute to `data-title` and strips it, so reading `el.title` back always returns empty.
