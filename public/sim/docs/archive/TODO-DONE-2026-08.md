# TODO — done items, 2026-08

> **Status: ARCHIVED** · done items moved out of `docs/TODO.md` on 2026-09-05, verbatim, so the open list stays short enough to read every session. Record only: entries describe the code the day they closed and may use superseded terminology. `git log` and `CHANGELOG.md` are the other two records.

### Aug 31

- [x] **#296 Roll LOCK still skews off-centre — CLOSED by #300 (2026-09-01)** — the remaining
  cause was not a writer of camQ at all: with roll pinned at exactly zero, body yaw at elevation e
  still becomes sin(e) of view-axis spin, because a centre-pinned reticle hands "up on screen" to
  the heading near the pole. Geometry, not a leak — see #300 for the measurements and the fix (the
  sensor now drives the cursor; the camera is derived and pitch-clamped). Original notes kept
  below: the two fixed bugs (render path ignoring rollSource; two writers of camQ) remain real and
  fixed, and the "find every writer" method they record is what eventually produced the
  measurement. —
  *"roll lock still skews or gets mixed."* Two real bugs were found and fixed underneath it and the
  symptom survives both, so the remaining cause is still unknown. **Do not assume the fixes below
  are the problem; they are verified.** Read this before touching it again.

  **What the symptom is.** Mute roll from the footer icon, then pitch while off-centre in azimuth:
  pitch leaks into roll. At azimuth 0 it is clean. Reported as never having worked "for months, in
  different iterations", which is consistent with the cause not being in the roll code at all.

  **Fixed and verified (synthetically), symptom persists:**
  1. The render path never consulted `S.rollSource`. `_gateRoll` in `sensor-mapping.js` held roll
     for the mapping rows — so the SOUND froze correctly — but nothing held it for the camera,
     which is what rolls the horizon. `applyAxisSources` in `renderer.js` now resolves roll like
     the other two, with `_axisLockFrozenRoll` beside the existing snapshots.
  2. **Two writers of `S.camQ`.** The renderer's 30 fps path gated it; `main.js`'s 400 Hz
     quaternion-arrival path wrote it directly, checked only `azSource`/`elSource`, and its `else`
     branch wrote the RAW quaternion. Every sensor packet overwrote the gated value. `main.js` now
     imports `applyAxisSources` — one owner. This one is objectively a bug regardless of the
     symptom and should not be reverted.
  3. Roll was extracted as a body-side twist `normalize([0,0,z,w])`, exact only when yaw and pitch
     are both zero. Now decomposed in the same `Ry·Rx·Rz` order `applyAxisMapQuat` composes camQ in.

  **Measured, after the fixes** — `S.camQ` `[roll, pitch, yaw]`, roll locked while level:

  | | before | after |
  |---|---|---|
  | az 0, pitch 30 | roll 0 | roll 0 |
  | az 45, pitch 30 | roll 12.7 | roll 0 |
  | az 90, pitch 30 | roll 30.0 | roll 0 |

  So the synthetic case is clean and the rig case is not. **That gap is the lead.** The synthetic
  driver sets `slot.quat` and calls `handleSlotQuaternion` directly; the rig also runs
  `tickMappings`, the post-mapping re-apply at `renderer.js` (`S._rawCamQ` / `S._rawCursorQ`), the
  detethered-cursor path, and `getSensorCursorQ`. Any of those may write camQ or cursorQ after the
  gate. **Start by finding every writer of `S.camQ` and `S.cursorQ` on a LIVE rig** rather than
  reasoning about the gate again — that is how #2 was found, and looking for it directly would have
  found it hours earlier.

  **Two traps that cost real time here.** Measuring without reloading the app, so two consecutive
  "the fix changed nothing" readings were against stale modules. And trusting a decomposition
  formula before checking it returns its own inputs — do that check first, it is three lines.

- [x] **#295 The crosshair no longer twists with roll (Ek, 2026-08-31)** — it rotated with the
  sensor, worst at the poles, because `_reticleShape` maps the reticle through the projection's
  Jacobian and the tangent basis is projected THROUGH the rolled camera. The cursor is fixed and
  the sphere is what rolls under it, so the crosshair must not turn. Fixed by taking one known
  screen rotation back out: `m = R(−camRoll) · J`, leaving every other property of the map intact.
  **Do not symmetrise the Jacobian instead** — `k2` is ±1 and encodes a mirror, so
  `R(phi)·diag·R(phi)ᵀ` is a REFLECTION about a `phi` that spins freely wherever the SVD is
  degenerate, and the crosshair windmills. That was tried and reverted; the comment in the code
  says so. Verified in pixels at 0/15/45/75/130/200°, not by eye.

  Still unverified: the reticle OFF-axis, near the rim, where it should still open into the reach
  ring's ellipse. Every screenshot was on-axis.

### Aug 30

- [x] **#293 Pins group by KIND; the named groups and the two pin lenses are sunset (Ek,
  2026-08-30)** — *"I still want pinned material but they should automatically group by if it's a
  loop or cloud, then I can mute or solo them as a group. But not group in the sense that we've been
  using it — all pinned material will just go into the pinned material, there's no group
  differentiator. And no weird filters to have to wrap our heads around."* Two implementations out,
  one much smaller thing in. Done 2026-08-30.

  **The groups.** `js/layers.js` → **`js/pins.js`**, `js/ui-layers.js` → **`js/ui-pins.js`**, and
  the module halved. A group is `slot.type` — `groupOf(c)` returns one of two fixed objects and
  writes nothing — so the rail derives a **clouds** row and a **loops** row, each with M and S, each
  present only when it holds something. Out with the named model: `DEFAULT_GROUPS` (q/w/e),
  `layerForKey`, `addLayer`, `removeLayer`, `moveHoldToLayer`, `S.layers`, `S.layerSeq`, the
  per-slot `layerId`, and `live.layers` in the session file. What survived is the part that was
  never about grouping — the **restore rule** (`_preLayerOn` → `_preGroupOn`) and the blunt
  one-at-a-time solo.

  **The keys.** `Q`, `W`, `E`, `⇧Q/W/E` and `⇧Tab` only ever addressed groups, so all five are
  **free**. Pinning is `=` and unpinning is `-`, unchanged and now unaimed; the looper gesture is
  `1 + =`. The trigger sheet's `group` row and `S.triggerParams.layerGroup` went the same way — a
  loop joins the loops by being a loop.

  **The lenses.** `pincloud` and `pinloop` deleted, with `S.pinLensClouds` / `S.pinLensLoops`, the
  `/lens/pins/*` actions, and the dock's second "filters" group (every lens is a radio row again).
  The lens reads the **scratch layer** and does not touch the pins, so `xfade` / `tether` came off
  the lens sheet too — **every pin parameter is on Settings → Pins**, reached from a gear in the
  rail's own header. The thing worth recording: the pin lenses had quietly taken over
  `S.commitPlayback` (Blend: all / focus) while leaving it on screen in that same panel, so the
  crossfade law in `grain.js` did not need a new switch — it needed the old one back. `all` plays
  every pin flat, `focus` weights by cursor distance.

  **What this deletes rather than guards.** The v7 import-ordering hazard (export audit § E10): a
  rail repaint landing mid-import could resolve a stored `layerId` against the previous session's
  group set and silently flatten the arrangement. There is no id to resolve now.
  `EXPORT_VERSION` 9 → **10**; a v7–v9 file imports with its named groups discarded and its
  `_preLayerOn` migrated. `layers-audit.js` → **`pins-audit.js`**, sections A–G rewritten, **66/66**,
  and § F still runs the repaint race on principle. `audit:align` gained two invariants for the
  rail's header buttons — an icon button sized by its own contents came out 13px against `all on`'s
  22 and nothing on screen said so.

  **Found while here, not fixed:** `engine-audit.js` has been failing `filter — page opens` on this
  branch since before this change, because **`js/grain-filter.js` (#292) is not in the repo** — it
  appears in no commit on any branch, though CLAUDE.md and #292 both describe it as shipped. Either
  the module was never committed or it lives outside git. Worth resolving before the next release.

- [x] **#294 The "get started" overlay is deleted, the mark is in the chrome, and a pinned cloud
  owns its material (Ek, 2026-08-30)** — three small things in one pass. Done 2026-08-30.

  **The overlay.** #257 retired it with an `if (false)` around its wiring, but the markup stayed in
  `index.html` and was only hidden from `main.js` — which is a module, so it runs after first paint.
  On a cold start it painted for a frame or two, which is why it *"still comes up sometimes"*.
  Hiding a thing at runtime is not the same as not having it. Markup, CSS (two blocks) and
  `S._dismissFirstRun` with its two callers are all gone; the Esc handler in `tiles.js` loses a
  guard that was only ever deferring to it.

  **The mark.** `logo/mark-light.svg` — the brushed 木 with three ember axis arrows — beside the
  wordmark in the chrome. It rides as an `<img>` rather than inline SVG because the light variant is
  authored at `#e4ddd0`, which IS `--text-light`, so it sits on the wordmark's own colour without
  9KB of path data in `index.html`. The brand row aligns on the BASELINE, which is right for type
  and wrong for a square glyph: a first attempt nudged it with `margin-bottom: -0.18em` and measured
  **1.44px low**. `align-self: center` against the brand box — which is exactly the wordmark's box —
  makes the two optical centres identical by construction. `audit:align` gained three brand
  invariants, including one that fails if the file 404s.

  **A pinned cloud owns its material.** Ek: *"when I pin a cloud I shouldn't hear double — that
  exact cloud, or the particles, are unavailable for cursor-granulation until I unpin them."* A
  cloud is a place that re-reads the live pool every tick, so what it claims is whatever is inside
  its radius now — the same set `syncParticleMarks()` uses for the sphere-side grey, computed the
  same way (`cosR` and a dot product, no transcendentals). Both cursor pool builders skip a claimed
  particle, in the recency pass as well as the collection pass, exactly where they already skip
  `p.trig`. **Nearest mode needed its own skip**: it hands the whole sphere to `_selectPerVoicing`
  and never sees `_buildCandidatePoolRadius`. The claim is by PINNING, not by sounding — muting a
  cloud leaves its material the cloud's rather than jumping it back into the cursor, which is what
  "until I unpin them" asks for. **Pinned loops already behaved this way** and not because of
  pinning: a loop's stroke is trigger material (`p.trig`), which every builder has always skipped.

  **Shipped broken once, in this same pass** — Ek on the rig: *"when I pin the cloud it's not
  playing."* `_buildCandidatePoolRadius` is shared with the CLOUD's own playback (the seed block
  calls it on the cloud's particles), so the claim applied inside it made every pinned cloud skip
  exactly the material it exists to play. It is now behind an explicit `forCursor` argument. The
  real lesson is the test: § J read the cursor's pool and nothing else, so it passed green on a
  build where every pin was silent. It now asserts **both sides** through a second seam,
  `__testSeedPool`, which goes through the builders the seed block really uses — verified by
  reintroducing the bug and watching that one check, and only that one, fail.
  **And the picture lied for one more revision** — Ek: *"visually the cursor will still draw a line
  to the particles that are claimed by a pinned cloud when they are in radius, it shouldn't."* The
  worklet's feedback tags EVERY firing grain white (`grain-worklet-bridge.js`), cloud grains
  included, so the renderer's "white = cursor grain" test could not tell the two apart and kept
  drawing the reach fan to material the cursor was provably not touching. The line is now gated on
  the same claim (`isCloudClaimed`); the dot+ring is not, because that grain really is sounding and
  only the line back to the reticle was false. § K counts the line segments a real `drawFrame()`
  issues rather than testing the predicate — the predicate was never the part that broke.
  `pins-audit` § J + § K, 12 checks, 78/78.

  **Also fixed, because it was the same list:** `sw.js` `APP_SHELL` was missing `css/tokens.css` and
  `css/settings-gui.css`. The offline demo came back with no design tokens at all — invisible while
  the network is up, because the fetch handler is network-first for code and only falls back to the
  cache.

### Aug 29

- [x] **#292 The grain filter — a lens is not an editor (Ek, 2026-08-29)** — "You put it on top of
  a lens … previously we had the edit filter actually edit the underlying stroke. That's the wrong
  approach. We should not have any way to edit the underlying stroke for now … it's like a blue
  filter for a camera, everything we see is filtered by blue … then I take the lens off and the
  cursor plays those strokes as they were originally baked." Done 2026-08-29.

  **What was wrong.** v2 (#284) *browsed and banked*: install, aim at whatever grain strokes the
  cursor reached, repoint their particles at `LIVE_VOICING`, and on release re-intern the edited
  params under each stroke's original brush key. It worked, and it was the wrong instrument. A
  stroke freezes the brush that painted it (#210) — that is the composing contract, and an editor
  bolted onto the lens dock quietly repealed it. Every restriction around the old filter existed to
  protect that write-back: Tab and the digits released it (#288), `captureTileParams` refused, the
  tools pill closed it, the properties rail grew a second sheet.

  **What it is now.** A filter is a **granular engine screwed on in front of the glass**. It never
  writes to material. Install stashes the live grain patch and lets the filter's own params take the
  live controls; uninstall puts the stash back; every stroke sounds exactly as it was baked, because
  nothing about it was ever touched. `js/edit-lens.js` → **`js/grain-filter.js`**, `S.editHold` →
  `S.grainFilter`, tile `edit` → `filter` — which also clears a real clash, since `kind: 'edit'`
  already meant *the three scrapers*.

  **The override is one line**, in `grain-worklet-bridge.js`: with a filter installed the cursor
  pool stops being bucketed by each particle's frozen `_vo` and every candidate is forced onto
  voicing **0**. The worklet already reserves 0 for "follow the global block", so the filtered path
  IS the pre-existing cursor path rather than a second engine beside it — and one voice costs less
  than eight. Measured on the rig: filter off → 2 voices, `vo` 1 and 2, frozen params each; filter
  on → 1 voice, `vo` 0, all six candidates, no params; off again → the two frozen voices back, and
  no particle's `_vo` moved at any point.

  **The sheet is THE sheet.** `_renderEditSheetBody` and its `_EDIT_EXCLUDE` are deleted. A filter
  is a tile of a `filter` engine — granular minus the deposit-time params (`flow`, `headW`, and the
  four experimental constants), which describe how material is laid DOWN and have no business being
  written by something that only reads. Everything else is identical, so the filter renders down the
  ordinary `renderProps` path and gets what the hand-rolled copy never had: the sound window, the
  drawn filter graph, the link pill, the octave capsule, the folded experimental section, typed
  values, double-click resets. Its head carries `+ brush` and `take off`.

  **You paint through it, and the stroke keeps the filter** (Ek, same day, second pass: "what if I
  wanted to paint with the filter on … that way I can quickly test a param, paint with that filter
  on, but when I remove the filter I have my trusty paintbrushes"). The first build blocked
  painting, on the reasoning that a stroke resolves its voicing from the live params and would
  therefore bake the filter. That is exactly right and exactly the wrong conclusion: reaching
  BACKWARDS into finished material is what breaks the frozen-brush contract; freezing what you can
  currently hear into a NEW stroke *is* that contract. Nothing had to be built — the block was the
  only thing in the way.

  **What did have to be built is the split between the glass and the hand.** Arming a tool used to
  take the filter off, because it would write that tool's preset over the live grain block the
  filter *is*. There are **two** doors into that block and both needed the rule: `applyTileParams`
  now skips the pids in `ENGINES.filter`, and `setBrush` skips its `selectPreset` — the second one
  is the non-obvious half, since arming runs through `_applyBrushCharacter` → `setBrush` *before*
  `applyTileParams`, so fixing only the latter left Tab loading the next brush's patch straight over
  the glass. With both, Tab and the digits change the brush's key, flow, head and experimental
  contract underneath the same filter: comb still sorts, staff still displaces, and the sound stays
  the filter's. The engine split written for the sheet turned out to be exactly the ownership split
  — `filter` is granular's sound half, and everything left over is the deposit half.

  On uninstall the stash goes back, unless a *different* granular tool was picked up meanwhile — in
  which case that tool is re-armed through the full path, because both halves of arming held back
  while the filter was on and this is where they get to run.

  **Mid-stroke, the glass re-freezes what is left of the stroke** (Ek, third pass: "I want to paint
  a 5 second stroke and temporarily throw a filter on in the middle — it should change what's
  banked so that the middle part bakes in the filter's properties"). A stroke froze ONCE, at
  `recordStrokeStart`, so toggling mid-gesture changed nothing in the material. The fix is one
  function: re-resolve `S.currentVoicing`, which paint-ticker.js already reads **per deposit**, on
  install, on uninstall, and on a capture landing from the filter's own sheet. The stroke keeps one
  `strokeId` and ends up carrying two or three voicings — nothing minds, because the worklet has
  always bucketed by particle rather than by stroke, so one later sweep plays the head with the
  brush, the middle with the filter and the tail with the brush again. Interning means going out
  and coming back lands on the voicing it started from rather than minting a third.

  Three details it needed. It re-bakes **twice** on a toggle — immediately and after 120 ms —
  because the params settle synchronously on the way out (`applyPresetObject` writes the stash
  straight in) but not on the way in, where the filter tile's remembered params arrive through the
  cabinet's ~50 ms coalescing. It rides `captureTileParams`'s existing 250 ms debounce for knob
  moves, so a drag re-freezes a few times rather than per frame — and without that half a filter
  feels dead while you are painting through it, which is the same complaint one level down. And it
  refuses outside a live stroke and on non-grain material, or a `hit` stroke would intern a row
  nothing reads into a table that gets persisted.

  **Consequences.** The properties rail pins to the filter while installed (`openProps` as well as
  `renderProps`, or the rail's `open` mark points at a row the sheet is not showing) — one grain
  block, one sound sheet. Esc and the tools pill now HIDE rather than take the filter off, because
  the sheet covers the stage and getting at the sphere to paint must not cost you the glass; the
  filter comes off by its own row, its `take off` button, or the lens dock. That would let a filter
  run invisibly, so `refreshLensStates` marks the chrome's tools pill (`tc-filtering`, granular hue
  plus a dot) whenever one is on. `+ brush` survives as the way to keep a filter as a *tool* rather
  than as material.

  **`engine-audit.js` gained the filter page and lost a race.** The suite held its row lists from a
  single query, but driving a control re-renders the sheet ~90 ms later and detaches them. The
  handlers keep working (they write to the cabinet, not to the node), so a stale row is not visibly
  dead — it LIES about state: a stale octave capsule shows the octave it had at render time, the
  suite clicks the first option not marked active, and when that is the octave pitch has since moved
  to, the click is a legitimate no-op and a working row reports inert. It surfaced as
  `filter.octave` only because the filter page runs last; the race was live on every page. Rows are
  now re-queried by index each iteration. 28 checks, green.

  Also corrected: `tiles.js` and `trigger.js` both still claimed the filter rewrote a trigger's
  baked speed/volume/passes per stroke. It has not since v2 dropped the loop branch, and it never
  will again.

- [x] **#291 The rig view is sunset; the cabinet is what's left (Ek, 2026-08-29)** — "We had noted
  sunsetting the rig view completely and using the tile view. Check if there's anything we need to
  port over that I already didn't say not to, do the sunsetting, porting, and test... then remove
  the whole tile/rig pill and idea. Also we built a lot of stuff for the rig view, like dragging
  the sphere viz, dragging the panel — just need to make sure that doesn't become dead weight."
  Done 2026-08-29.

  **The one decision that shapes everything else: the view goes, the CONTROLS stay.** `.top-bar`
  and `.right-panel` are still in `index.html`, permanently `display: none`, and they are now
  called the **rig cabinet** — named in a block comment at the top of the file so the next session
  cannot mistake them for a screen. They are not decoration. They hold the **44 elements the
  engine pages drive by id**, every settings modal's OPENER button, and four nodes borrowed out
  and hosted elsewhere (the audio device and the two cursor pickers in the footer, the commits
  device in Settings → pins, the camera picker in Settings → view). Deleting one because "nothing
  shows it" silently kills an engine row with no error — which is what `engine-audit` § C is for,
  and § C is also what makes moving a family OUT of the cabinet a safe one-at-a-time job. #268's
  open question ("those 44 elements need somewhere to live") is therefore **not** answered here,
  deliberately: it is a separate job, and it is now guarded rather than blocking.

  **The migration audit, closed.** #263 listed six controls the tile screen could not reach; #279
  closed the octave steps. Of the remaining five, exactly ONE was a live feature with no other way
  in, and it is ported:
  · **handsfree arm** — the button was orphaned in the cabinet's cursor device while all seven of
    its gate parameters already lived in Settings → audio. **Moved**, not copied, and reshaped on
    the way: `#hfArmBtn` is now `#hfArmSeg`, a two-state pill (`off | armed`) because arming is a
    boolean that stays (#267). `hf-recording` and `hf-unavailable` remain classes rather than a
    third segment — recording is something the gate is DOING, not a state you can pick.
    `_syncHandsfreeUI` was already the single sync point, so nothing can desync.
  And one gap the audit had missed entirely: **`trig_toggle` (triggers on/off)** had an OSC
  address, a MIDI slot, no key, and its only screen was the cabinet's trigger device. It is now
  the `triggers` row on the **lens** sheet, beside dwell/start/release/retrig — which is where the
  other four GLOBAL `S.triggerParams` rows already live, so it is consistent rather than a new
  idea. Added to `GLOBAL_PIDS` so a tile can never capture it, and to `engine-audit`'s state
  snapshot (a param that lands in a store the snapshot doesn't watch reports as dead — the trap
  #268 already recorded, hit again immediately).

  **Not ported, each for a reason:** `cursorTareBtn` (Settings → sensors has tare, and `` ` ``
  works) · `sessionAltLockBtn` (it is `disabled` markup — a readout; alt-lock is in `tcStats`) ·
  `commitLockBtn` (it is `trace_mode`, the pre-tile model — the armed tile decides now) ·
  `morphBtn` (radial morph's engine, `gesture.js`, was sunset in #269, so the toggle has nothing
  to toggle — see #112) · `octUp/Down/Reset` (superseded by #280's octave pill) ·
  `composerAllOnBtn` (already `display:none`; the pinned rail's `ALL ON` is it) · the **patch
  bank and patch table** (Ek: sunsetting — its opener is in the cabinet, so the table is
  console-only now; retiring it properly is still #214).

  **The dead weight, removed rather than left looking current.** Both of the things Ek named were
  rig-only and are now in `sandbox/sunset-2026-08-29/` with revival notes:
  · **`panel-drag.js`** (292 lines) — dragging `.device` tiles between column slots, and
    dragging/resizing the canvas block.
  · **`projector-partition.js`** (371 lines) — lifted verbatim out of `setupEvents()`. It moved
    `#sphereCanvas` into a mini tile inside `.right-panel` and dealt the tiles into five
    positional columns, with a `mubone_projector_layout_v2` schema and a v1 migration behind it.
    **The popup MIRROR (⇧F) is a different feature and stays** — it only ever shared the word.
  Deleted outright: `setTileLayout()` / `S._setTileLayout`, the `rig` and `◈ tiles` pills, the
  `.proj-divider`, the `.device-label` collapse toggle, the saved panel order, and the narrow-tier
  panel-column CSS — which settles half of **#146**: the flat-mode branch of the narrow CSS *was*
  dead, losing to the tile rules on source order, and it is gone.

  **`body.tile-layout` is gone as a class, not just as a toggle.** ~74 CSS rules carried the
  prefix; keeping it would have left the next session asking what the other layout was.
  `body.tile-layout` → `body` and `body:not(.projector-mode)` → `body` were substituted BEFORE
  anything was judged dead, so the two former branches keep their relative source order and the
  tile rules still win. **Verified by pixel diff**, not by eye: `ui-shots` at all four widths
  before and after, decoded and compared per pixel. 0.74% differing, confined to 66 rows in the
  chrome — the buttons shifting left where the `rig` pill was. *(The first baseline looked like a
  24% regression. It was not: `rig.launch()` always uses the `audit` instance, so localStorage
  PERSISTS between harness runs and the two runs had different `pinned_rail` state. Re-baseline
  from a stashed tree before believing a screenshot diff.)*

  **Stale layout state is cleared once at boot**, not left to rot: `mubone_panel_order`,
  `mubone_panel_*`, `mubone_projector_layout*`, `mubone_tile_layout`. One of them could actually
  bite — a `.device.collapsed` class hides `.device-body`, and Settings → pins borrows the commits
  device whole, so a device someone collapsed in the rig view a week ago would have opened as an
  empty settings page with nothing to explain it. `LEGACY_PREFIXES` is new beside `LEGACY_KEYS`
  so the drift detector doesn't start reporting them as unregistered.

  **Two harnesses were lying and now aren't.** `browser-audit`'s `panels + modals present`
  asserted `modals >= 11` and had been red since #269 sunset four of them — the same failure its
  own comment complains about from #169, two passes in a row. The eight remaining modals are now
  NAMED rather than counted, so a deletion says which one. And `ui-shots` dumped projector-column
  geometry, which is now always `[]`; it reports the chrome/stage/rail/footer boxes instead and
  flags anything clipped or overflowing — the regression worth catching on this screen is a rail
  that RESIZES the sphere instead of floating over it.

  **Tested.** `rig-audit` 6/6 (263 checks, one boot) · `docs-audit` 28 docs · `ui-shots` at
  1400/1100/800/520 with no clipping and no overflow at any width · `browser-audit` shell +
  127.0.0.1 clean (the `127.0.0.2` stage times out, pre-existing and environmental — that address
  is not aliased on this machine). Plus a **45-check functional probe** written for this change:
  the cabinet is hidden and intact, all 44 engine ids resolve, the footer's three borrows arrived,
  **every one of the ten settings sections renders a populated body and gives its node back on
  close**, both ported controls move real state, the chrome proxies still reach the cabinet, and a
  reload with `mubone_tile_layout=0` and a collapsed device seeded into storage comes up as the
  normal screen with nothing collapsed. Zero renderer errors throughout.

  **Still open, and worth saying out loud:** the cabinet is a holding pen, not an answer (#268's
  question stands); the patch bank and patch table now have no UI at all and #214 should finish
  the job; and `morphBtn`/`commitLockBtn` are two controls with no home and no feature behind
  them — they should go with the flags they drive, not get a screen.

### Aug 25

> **START HERE.** Branch **`brush-model`**. Read `docs/archive/BRUSH-MODEL.md` (status DESIGN INTENT — the
> model, v3) then `docs/VOCABULARY.md`. **Nothing is on `main`** — the branch tip is `651f9c7`,
> one wip commit carrying both sessions' work. The working tree also carries a
> **v1 code build that the model has since superseded twice** — see #208 before writing anything.
>
> The model in one paragraph: **brushes add** to a **scratch** layer (line · spray · stamp);
> **edit tools take away** (scrape top · bottom · all); both live as **numbered tiles in one row
> whose order is the keymap**. **`Q W E` hold into layers** — held together with a brush number,
> so `1`+`Q` records a line and loops it as it is drawn. **A hold is the cursor, dropped.**
> Layers mute and solo, and a **layer-fade dial** crossfades them by cursor distance. There is no
> arranger mode and no arrange room: options above the sphere, layers permanently on the right,
> tiles below. Interactive mockup: <https://claude.ai/code/artifact/ccb28e5a-d0c6-4bea-bdfd-5547a8a3a598>
>
> **Do #209 before any UI work.** If live-loop recording turns out to be hard, the `1`+`Q` gesture
> needs rethinking, and you would rather know that before an interface is built around it.
> **⚠️ #207, #210 and #212 below were reconstructed from the code on 2026-08-25** after a Cowork
> session overwrote this section wholesale instead of appending to it. The originals are gone —
> no commit, no stash, no backup. These three are rebuilt from the module headers, the § E10/E11
> write-ups in `docs/EXPORT-IMPORT-AUDIT-2026-08.md` and `scripts/pins-audit.js`, so they are
> accurate about *what was done* and thin about *what was considered and rejected*, which is the
> half this file normally carries. **Whoever wrote them: please restate anything missing.** The
> numbering was also reconciled — #210 and #212 are yours, and the two items of mine that had
> claimed those numbers are now #214 and #215.

- [x] **#207 Arrangement layers survive the session file** — `EXPORT_VERSION` 6 → 7. Layers
  (`js/layers.js`) were memory-only, so named layers, membership and mute state died on export.
  `live.layers` carries the set and its id counter; each commit slot gains `layerId` and
  `_preLayerOn`. **The finding is where the read happens, not what the fields are.** Every other
  `live` field is consumed by `applyLiveState()`, which runs *after* `applySessionPayload()`
  returns — layers cannot be, because `layerOf()` assigns lazily on first ask, and two things ask
  mid-import: the rail repaints on its own 6 Hz timer, and the commit loop **awaits**
  `base64WavToAudioBuffer()` per loop slot. Restore late and a repaint lands mid-import, fails to
  resolve an imported `layerId` against the *previous* session's `S.layers`, and silently flattens
  the arrangement into two groups. Written up as § E10. Guarded by the new
  `scripts/pins-audit.js` (§ E asserts the round trip, § F asserts it survives a repaint racing
  the import).

- [x] **#210 Frozen brushes — a stroke remembers the brush that painted it** — `EXPORT_VERSION`
  7 → 8. Reported by Ek from playing: painting with `wash` then selecting `shimmer` **re-voiced
  everything already on the sphere**, because the brush was a global mode rather than a property
  of the material — nothing recorded which brush painted a mark, and the cursor had exactly one
  voice in the worklet with one global param block. New `js/brush-voicing.js`: a **voicing** is one
  resolved grain param block plus its brush, **interned** so five strokes painted without touching
  a knob produce *one* voicing rather than five (turning a knob and turning it back lands on the
  same voicing again). Strokes point at an int id; `vo` is stamped per particle in
  `paint-ticker.js` and written to the file only when non-zero, the same reasoning as `trig`.
  **Frozen, not live** (Ek's call, and the composing answer): editing a brush changes only what you
  paint next, so a finished passage stops moving under you. **Cost:** the grain panel now shows the
  *selected* brush rather than what the cursor is hearing. **Voicing 0 is reserved** and means
  "follow the live params"; `restoreVoicings()` refuses to load a stored voicing with that id,
  since a stroke pointing at it would silently follow the global knobs. The v7 migration does not
  guess — a pre-v8 session already embeds the resolved `patch` it was played on (§ E4), so imported
  material gets a voicing built from that. `resolveGrainParams()` is **the** one place the field
  list exists; `ui-presets.js` `_syncWorkletParams()` calls it rather than keeping a second copy.
  Written up as § E11. Files: `js/brush-voicing.js` (new), `js/grain.js`, `js/grain-worklet-bridge.js`,
  `js/paint-ticker.js`, `js/ui-export.js`, `js/ui-presets.js`, `js/worklets/grain-engine.worklet.js`.

- [x] **#212 A brush owns the sound; the cursor owns where it points** — and the answer to
  `docs/archive/BRUSH-MODEL.md` § 8 Q4: **reach is fully global.** `searchRadiusDeg`, `nearestMode`,
  `recencyN` and the radius-fade pair used to be patch params, so picking a brush moved your reach
  (glitch yanked the radius to 80°, stutter to 6°) and could flip your scope mid-set. Removed from
  `PARAM_REGISTRY` in `js/ui-patch-table.js`, which **is** the migration: `loadUserPresets()` strips
  any key the registry does not know and re-saves, so an old user patch loses its radius on next
  load rather than keeping a dead key nothing reads. **`k` and `grainKAllMode` stay with the brush**
  — how many marks sound at once is character, not geometry (wash at k=99 and vinyl at k=1 are
  different instruments), which forced **per-voicing k selection** in `grain.js` (`_voGroups`,
  `_voGroupFree`, `_voSelBuf`): the cap is applied per voicing in one sweep, because calling
  `_buildCandidatePoolNearest()` per group would clobber the shared `_kSelectBuf`. Groups are
  module-level and truncated rather than reallocated, so it costs no per-tick allocation once the
  live voicing set has settled. **Not a format problem but recorded in § E11:** this could not be
  done per-grain, because the onset period belongs to the clock and one clock cannot produce two
  densities — each distinct voicing under the cursor needs its own voice. Guarded by
  `pins-audit.js` § H.

- [x] **#208 Decide what happens to the v1 build in the working tree** — `js/tool.js`,
  `js/tool-layout.js`, `js/layers.js`, `js/ui-layers.js` plus edits across ten modules. **Three of
  its core ideas are superseded:** `S.tool` as four peers (Paint/Hold/Erase/Arrange — § 0 says why
  that is a list of non-peers), the floating dock (brushes are not states to toggle between), and
  destructive layer mute (§ 3e — audibility must be *derived*, not written). **What survives:** the
  four-tools CSS and layout scaffolding, the canvas-reclaim fix (#205), and the general shape of
  `toolClaimsTrace()`. **Recommendation: keep `651f9c7` as the labelled checkpoint, then reset and
  start clean from the docs** — building on it means carrying three dead concepts. ✅ **Committed
  2026-08-25 as `651f9c7`** together with #207/#210/#212, so it is now recoverable; it was
  uncommitted for most of a day while two sessions worked the same tree.
  ✅ **Decided and executed 2026-08-25.** A full `git reset` was off the table — `651f9c7` also
  carries #207/#210/#212, which are engine keepers guarded by `pins-audit.js` — so the removal
  was surgical, per module against § 0 / § 3e. Tagged **`v1-tool-build`** at `651f9c7` first.
  - **Deleted:** `js/tool.js` (the four-peer selector — § 0's error, whole), `js/tool-layout.js`
    (the dock presentation), `js/ui-layers.js` (the v1 arrange rail), the `.tool-strip` +
    four-tools CSS and markup, `S.tool` + `TOOLS`, the five `tool_*` actions, the `/tool/*` OSC
    addresses (ACTIONS is now 101), the `mubone_tool_layout` storage row.
  - **Extracted, not deleted:** the brush core was *inside* `tool-layout.js` but was never
    presentation — `pins-audit.js` §§ H–I drive #210/#212 through `setBrush()`, and
    `brush-voicing.js` names voicings from `S._currentBrush`. It now lives in **`js/brush.js`**
    (brushLibrary / currentBrush / setBrush / currentMaterial), together with
    **`brushClaimsTrace()`** — the keeper half of `toolClaimsTrace()`: the paint-case material
    routing (grain traces, `hit` records a trigger, a stamp paints its sample). The four-peer
    arbitration went with tool.js; space/click/`recpaint` now ask the brush directly.
  - **Kept in place:** `js/layers.js` — the persistence substrate of #207 and not deletable
    without reverting it. Its `setLayerMuted()` write-through is the § 3e-superseded part and is
    to be REPLACED by derived audibility when the v3 layers rail is built, not before: deriving
    needs a read-time audibility check in the playback paths, which is v3 engine work, and the
    restore-rule behaviour it implements is exactly what § 3e says to preserve until then. Also
    kept: the #205 canvas-ownership branch in `events.js` (correct with no layout mode present —
    the partition simply always applies) and `S.arrangeScope` + `_toggleLayerOf` in the gate.
  - **Known transitional wart, accepted:** selecting a patch through the old bank (keys `1`–`0`)
    does not move `S.brushKey`, so the *material* can lag the *sound* until #214 retires the
    banks. v1 had the same desync; the tiles are the fix, not a sync shim.
  - Verified: `rig-audit.js` 5/5 suites green, `osc-audit` wiring green at 101 addresses,
    `docs-audit.js` green. Docs updated: BRUSH-MODEL § 0 (removal note), VOCABULARY banner,
    KEYBOARD-SHORTCUTS, README OSC table.

- [x] **#209 Prototype live-loop recording — the `1`+`Q` gesture** — Pre-flight item 3, and **the
  only genuinely new DSP in the whole redesign**. Today `buildLoopPayload` runs on stroke
  *release*; this needs a buffer that plays while it is still being written — wrap handling, a loop
  end that advances, a declick at the seam, and a decision about what happens if the key is held
  for 30 seconds. Build it standalone against the dev bridge before any UI depends on it.
  ✅ **Built 2026-08-25. Verdict: not hard — the gesture stands.** `js/live-loop.js` (console-only,
  in `KNOWN_ORPHANS`) + `js/worklets/live-loop.worklet.js`, 28/28 green in
  `scripts/live-loop-audit.js` (standalone, not in `rig-audit.js` — real-time audio, ~15 s
  wall-clock). What was decided, and why:
  - **The wrap rule is the design.** A loop whose end tracks the write frontier *continuously*
    never wraps at 1× — the read head starts a constant gap behind the frontier and cannot close
    it, so "loop the growing buffer" degenerates into a delay line. The end therefore advances
    **at the wrap**: each pass plays the material that existed when the pass began, so the loop
    grows pass over pass (~doubling at 1×). You keep hearing the stroke's opening every pass while
    newer material joins one wrap later — that IS "recording into a loop that is already looping".
  - **Close extends immediately, and that is free.** The only discontinuity anywhere is the wrap
    seam (end → start); material past the old end is contiguous in the buffer, so on key-release
    the end jumps to the full stroke seamlessly mid-pass (unless mid-crossfade, then next wrap).
  - **The seam is a real-time equal-power crossfade, not a baked one.** `buildLoopPayload` bakes
    30 ms destructively into an extracted copy; here every pass has a NEW seam, so the tail blends
    against the head [0, xfade) live and playback continues from `xfade` after the wrap. Measured:
    max per-sample step at every seam ≈ the test sine's natural delta (0.014–0.018), no clicks.
  - **The worklet records its own copy** — write frontier and read head must share a thread. The
    main-thread live buffer lags input by up to ~93 ms (capture batch + `LIVE_REBUILD_INTERVAL_MS`);
    in-thread the frontier is sample-exact with no safety margin. Cost: one duplicate mono buffer
    for the duration of the gesture; at close, ownership can hand over to the finalized stroke
    buffer through the normal loop path.
  - **Held for 30 s: nothing special happens.** Amortised-doubling growth (§ H exercises it), the
    loop just gets long; the ceiling at integration is the existing `recLimitSeconds` guard.
  - **Simultaneous `1`+`Q` waits for a minimum** (default 0.5 s) before the first pass — the
    boundary is arbitrary by design and is a rig-tuning question, not an architecture one.
  - **Trap for any future worklet:** a node whose output does not reach a rendering sink is never
    pulled — `S.houseBus` dangles until an output device is selected, so the node carries a
    zero-gain keep-alive tap to `actx.destination`. Found as silent `writePos 0` on the audit rig.
  - **Not prototyped, known integration work:** reverse (`direction: -1` — head/tail semantics on
    a growing region need a decision), routing into the per-slot VBAP fan-out (the node is mono
    and can sit where `_sourceNode` sits today), and the close-time handover to the finalized
    buffer.

- [x] **#217 The scope — the cursor's lens as a tile set** — Ek's design, 2026-08-25, built the
  same day (postdates and supersedes the mockup here; `docs/archive/BRUSH-MODEL.md` § 3e v4 carries the
  full reasoning, `docs/VOCABULARY.md` the terms: **scope, zoom, cap**). The tile row says what
  the hand does; the scope says what the eye does, and they compose. Scope tiles render after a
  divider in the row — `wide` (area scan: zoom + depth), `spot` (nearest mode), `arrange`
  (composer at the cursor; its `flips` seg writes `arrangeScope`), and `cap`, the toggle that
  mutes reading (scan off; the lens keeps its settings). **Selection is derived from
  `composerMode`/`nearestMode`/`scanMuted`, never stored** — ⇧K, N and S keep working and the
  tiles follow within one 5 Hz tick (`refreshScopeStates`). Installing writes through the real
  controls (`setComposerMode`, `toggleNearestMode`, `#scanBtn`). **Retired:** the toggle-7 tile
  (an eye behaviour wearing a hand costume — the source of the confusion that started this),
  the chrome scan pill (cap owns it), and *reach* as a word on new surfaces (**zoom**; the
  chrome pill relabelled). Old saved tile orders fall back cleanly (permutation check).
  **Open:** per-scope zoom memory; whether cap should silence hits too (`trigMuted` is still
  separate); layer fade as the arrange scope's falloff (engine first, #215); user-made scopes
  (the forScore direction — with brushes/erasers/scopes all being addable tile sets, the `+`
  design sheet is now one mechanism serving three families). Verified: rig-audit 5/5, a probe of
  every scope tap + external N-key sync + the flips seg, screenshot.
  ✅ **Aperture + the search panel absorbed (same day):** everything in the old search panel
  except ORDER is now scope options — wide carries zoom · depth · aperture · edge · curve, spot
  carries zoom · aperture. **Aperture** is the resolution of "k belongs in the scope" vs #212:
  the brush's k stays the material's frozen character; the scope's aperture is how many marks
  the lens admits LIVE, and effective density is min of the two — the lens stops down, never
  widens (vinyl stays vinyl). `S.scopeAperture` (0 = open), applied in `_selectPerVoicing`,
  guarded by `pins-audit` § I (60/60). Aperture is scope-native state with no panel mirror
  and no persistence yet — decide where it saves when per-scope memory is decided.

- [x] **#219 The slice tool — floor-adaptive auto-segmentation (unsupervised block, Ek away)** —
  the replacement for the old auto-segmentation that "only worked around 100 ms": that was
  `_chopStroke`, which splits on gaps between deposited marks and therefore inherits the paint
  gate's threshold — exactly the noise-floor blindness Ek reported. **Slice** (a new line tool
  at tile 2; the plain line is untouched) segments the AUDIO instead: `js/onsets.js`
  `detectOnsets()` — framed RMS in the dB domain, half-wave rectified rise over the recent two
  frames, thresholded against a **local median** (±500 ms) scaled + 4 dB, 90 ms refractory,
  onset reported at the foot of the rise minus 5 ms. dB-vs-local-median makes it floor-immune
  by construction ("an attack is whatever rises out of the room"), which was Ek's transient
  instinct made adaptive. Tuned against a 24-scenario matrix (4 noise floors × hits at
  400–800 ms / 150 ms / 8 Hz tremolo spacing, loud+quiet mixes, slow swells, hits riding a
  pad) — all pass; notable judgement calls: a swell's START may register (sound beginning is a
  real boundary) but its body never splits, and a hit buried under the floor is correctly
  missed. **Pre-roll rule:** the run before the first onset arms nothing when its peak is
  ≥12 dB under the take's (the player pressing record before playing must not produce a
  room-noise trigger); its marks stay painted for erase. Split runs ride the existing
  `_assignSegmentIds` + arm loop. Permanently guarded: `trigger-audit` § slice (92/92).
  **Also in this block:** scrape bottom built (`S.eraseOldest` inverts the erase recency
  ranking; depth from the wide scope; at depth "all" it equals scrape all); the tile row now
  reads as SETS (core brushes · edits · experimental · `+` · scopes, dividers at each kind
  change, tightened widths so the whole row fits at 1280); undo/redo moved to chrome pills
  (⌘Z unchanged, redo still honest about not existing); `Digit0` is the tenth key.
  **Open:** onset constants are synthetic-tuned — a mic session should confirm `deltaDb`/
  `minGapMs` against real playing; the "picky line" criteria variant is benched in
  `docs/EXPERIMENTAL-BRUSHES.md`.

- [x] **#220 Flow — the deposit clock surfaced (Ek's question, 2026-08-26)** — no experimental
  brush touched the tick; it was still the hidden global `S.paintTicker.intervalMs` (50 ms,
  console/perf-dropdown only). Now a **flow** row on the granular brushes (spray, splatter,
  comb, staff, echo), 15–200 ms, left = sparse — the first surface for #211's ruling that the
  tick is a brush property. Still ONE value under the hood until tiles own their settings
  (#214). Note for slice: mark rate bounds slice granularity (a segment needs ≥2 marks), so
  flow is also the fineness control for slicing. Dynamic variants benched in
  EXPERIMENTAL-BRUSHES: **even-flow** (deposit per distance — uniform lines whatever the
  speed, vs time-based dwell-equals-thickness; two valid contracts) and **voice-flow**
  (level → rate).

- [x] **#220b pour — dynamic flow, built (2026-08-26)** — Ek: dwell should feel like the ink
  dumping out. Spray-based experimental brush whose deposit interval rides EMA-smoothed cursor
  speed: full sweep = 25 ms spray, stationary = 360 ms drips, glide tau 0.25 s
  (`POUR_SLOW/FAST/REF/TAU` in paint-ticker.js; `pourIntervalFor`/`pourTick` exported seams).
  Hovering no longer piles marks into a blot — dwell becomes sparse punctuation. The static
  head composes. Also: the global flow floor dropped 15 → 10 ms (the 200 Hz poll is
  comfortable well below 50). Verified: mapping bounds + monotonicity, EMA convergence both
  directions, tile wiring, floor. voice-flow (level → rate) stays benched as the other half.

- [x] **#221 Contract cleanup: zoom left the hand tiles (Ek's catch, 2026-08-26)** — the
  options bar had grown a `zoom` row on every brush and edit tile, which is the brush owning
  reach again — the exact thing #212 removed and #217 gave to the scope. Zoom now appears in
  exactly two places: the scope tiles' options (wide/spot) and the chrome pill. Edit tiles got
  honest notes instead ("newest/oldest first, to the lens's depth — zoom and depth are the
  scope's"). Remaining transitional impurities, recorded not hidden: line/slice's dwell/start/
  speed rows, flow, and the head all write through GLOBAL state while presenting as per-tile
  contract — one value under the hood until #214 gives tiles their own settings.

- [x] **#222 zoom → field (Ek, 2026-08-26)** — the chrome pill and scope rows now say
  **field**: Ek asked for the honest camera term, suspecting aperture — but aperture is the
  iris (already density's word, correctly), zoom is magnification, and the width of what a
  lens sees is its **field of view**. The value IS an angle in degrees, so the word is
  literal. Surfaces + VOCABULARY updated; older TODO entries keep the word they were written
  with.

- [x] **#223 The design view — engines, and the eye (Ek's design, 2026-08-26)** — the
  Procreate model: every tile runs on an ENGINE (granular = spray + all experimentals;
  loop/sample = line, slice; scope = the lens), and the perform options were only ever a
  sampling. Now: a `design` chrome toggle flips the big window from the viz to the selected
  tile's WHOLE engine — `PARAM_DEFS`/`ENGINES` in `js/tiles.js`, one registry both views
  render from, ~25 granular / 9 loop / 6 scope rows, every row writing through the real
  rig-view element and reading its paired numbox (the sheet cannot disagree with the rig).
  Each row carries a ◉/○ eye choosing whether it shows in perform, persisted per tile
  (`mubone_perform_vis`, defaults = the previous curated sets so nothing changed until
  toggled). Switching tiles in design walks each tile's full surface; scope tiles show the
  scope engine. Verified on the rig: full sheets per engine, eye-toggle → perform updates +
  persists, design-slider drag moves the real panel control, clean flip back; rig-audit 5/5.
  **This registry is the seam #214 builds on**: a new tile = pick an engine, set its rows,
  save them per tile — the registry already knows every row.

- [x] **#223b The erase engine, and where the old search panel went (Ek, 2026-08-26)** — the
  edits are an engine too: one real parameter, **depth**, and it is deliberately the SAME
  `recencySlider` the scope shows (old search panel AREA → recency) — one knob, two engines,
  because both the lens and the scrapes read through it. Top-vs-bottom is the tile's identity,
  not a param. The full old-search-panel disposition, for the record: **scope** (radius →
  field, recency → depth, fade pair → edge/curve, scope seg → wide/spot) · **brush** (k →
  voices, fill k|all — frozen per voicing, #212) · **aperture → NOTHING**: it is new state
  (`S.scopeAperture`) with no rig-panel ancestor, the scope-side live cap min(brush k,
  aperture), default open = inert · **order (random|step) → still unhomed**, per Ek not the
  scope's; likely spray's (it sequences the admitted marks) — undecided.

- [x] **#223c One scrape, exhaustive (Ek, 2026-08-26)** — scrape-top and scrape-bottom were
  two tiles whose only difference was a parameter, so they collapsed into ONE **scrape** tile
  whose erase engine is fully explicit: **depth** (the recency — same `recencySlider` as the
  scope's) + **from** (top | bottom, a persisted seg writing `S.eraseOldest`). Direction is a
  setting now, not a stash — it survives across holds. `scrape all` stays as the fast preset
  (depth forced off for the hold). Verified: options read depth+from, the toggle drives the
  flag both ways, and a live digit-hold erase with from=bottom removed exactly the oldest
  buffer. Keymap: 5 scrape · 6 all · 7–0 experimentals.

- [x] **#224 Tiles are presets of engines (Ek's architecture, 2026-08-26 — the #214 core)** —
  the full statement landed: engines define the parameter vocabulary; tiles are saved
  configurations; factory tiles are starter presets; `+` asks which engine first. Built:
  selecting any tile (scopes included) APPLIES its stored params via the same write-through
  rows; any edit while selected CAPTURES the whole engine back into the tile (debounced,
  Procreate's the-brush-remembers rule); `mubone_tiles` stores per-tile params + custom tile
  defs. Factory identity params in `FACTORY_PARAMS` — scrape-all is literally the
  `depth: all` preset now, its stash-restore code deleted. The `+` tile shows an engine
  chooser (granular · loop · erase), snapshots the current dials into `custom N`, inserts it
  before `+` (keyed by position like everything), and opens the design view. Saved order
  handling now merges customs and survives factory-row changes. Verified clean-slate on the
  rig: all↔scrape depth round-trips (0↔3), captured `from: bottom` survives leave-and-return,
  + flow creates/selects/opens design (25 granular rows), a dialled flow captures and
  re-applies on selection; rig-audit 5/5. **Still open toward full #214:** the banks
  themselves (patch/sample panels in rig view), custom rename/delete/glyph, scope customs,
  and true per-tile state copies (between captures the values remain global).

- [x] **#225 fx params graduated; the design sheet speaks audio (Ek, 2026-08-26)** — the
  experimental tunables were module constants, invisible to the design view by construction.
  Now state (`S.fx.*`: splatSpread/Throw, pourDrip/Spray, echoRepeats/Spacing, chopRise,
  staffLo/Hi — engines read state with the old constants as defaults), registered in
  `PARAM_DEFS` with ranges/formatters, capturing per tile like everything else. **The
  uniformity statement is now enforced by construction:** one sheet per engine, identical
  across its tiles (granular = 34 cells incl. the EXPERIMENTAL section), only the eyes
  differ. And the sheet was redesigned in audio design language — Ableton-style device
  sections (DEPOSIT · VOICES · GRAIN · PITCH · FILTER · OUTPUT · EXPERIMENTAL), SVG rotary
  knobs (270°, value arc in the tile's colour, vertical drag, display read from the paired
  numbox so the knob cannot disagree with the rig) for continuous params, flat chips for
  switches. Perform keeps slim tracks (a thin bar wants horizontal drag). Verified: identical
  sheet signature across granular tiles, chopRise knob → `chopAccept` threshold honoured,
  el-backed knobs move the real panel sliders, rig-audit 5/5.
  **Session lesson, worth keeping:** `node --check` parses CommonJS, where top-level `return`
  is LEGAL — it approved a broken ESM file and the app failed to boot silently until a rig
  probe read the console. Syntax-check ESM with a real import, not --check.

- [x] **#226 The row says what things are; lit means sounding (Ek, 2026-08-26)** — two fixes.
  **Engine grouping:** the row is grouped by engine with micro-captions (LOOP · ERASE ·
  GRANULAR · SCOPE) in engine hues and an engine-coloured underline per tile; engines stay
  CONTIGUOUS as an invariant — a stable bucket sort runs on load and after every drop, so
  drags reorder freely within an engine and a cross-engine drop lands at that engine's edge
  (visual order always equals keymap order). Old saved orders migrate by the same sort.
  **Selection ≠ playing:** a selected hand tile shows a quiet accent underline (ARMED — it is
  what space/pedal will paint, and what the options show); the bright fill is `.playing`,
  applied only while the gesture is down (digit held, or `S.isPainting`/`S.eraseHeld` via the
  5 Hz tick — so the tile-agnostic spacebar lights the selection too). Scopes keep the filled
  active state (a lens is genuinely always on); design view restores the strong highlight
  (there it means "editing this"). **Two session lessons:** a python-splice anchored on a
  non-unique string gutted three functions (probe found `render is not defined` — anchor on
  unique strings, verify with grep after); and this Chromium computes a flex container's
  INTRINSIC width from item content, ignoring flex-basis — tiles need explicit `width`, or
  groups collapse to their label widths (minimal repro: two `flex: 0 0 69px` buttons in an
  inline-flex measured 24px).

- [x] **#227 The flat row: engine identity is one signal (Ek, 2026-08-26)** — supersedes the
  grouping half of #226 the day after it landed. Ek: *"the small text on top for category is
  too cramped… i want minimalist design… it shouldn't be organized by category since i want
  the freedom of lining them along the keyboard 1 to 0. find another way to differentiate
  between engine type."* So: `bucketOrder` and the contiguity invariant are GONE — the row is
  one flat strip, any tile on any digit, drop = plain splice. Group wrappers, micro-captions
  and dividers are gone with it. Engine identity now lives in exactly ONE signal: the glyph's
  hue (`--eng` per tile; `color-mix(var(--eng) 62%, var(--text-dim))` on the SVG — loop pink
  · granular amber · erase red · scope teal), verified by computed-style probe on the rig.
  Scopes stay at the right end separated by empty space (`margin-left: auto` on the first),
  which reads as "different family" without drawing a line. The #226 selected-vs-playing
  split survives unchanged. Tiles keep the explicit `width` from the Chromium intrinsic-size
  lesson. KEYBOARD-SHORTCUTS + BRUSH-MODEL divider passages updated.

- [x] **#228 The lens engine sheet is exhaustive, and the family is renamed lens (Ek,
  2026-08-26)** — audit of the scope sheet found it half-empty, and the family name changed
  in the same pass ("i don't like the rifle scope connotation" — camera analogy stays, the
  crosshair word goes). **Params added:** `mode` (area | nearest, seg through the old search
  panel's `snapToggleSeg`) — the wide/spot identity, marked `nocap`: flipping it doesn't
  edit the selected lens, it SWITCHES lenses (the derivation rule moves the highlight, and
  a rig probe confirms wide's sheet lights spot); and arrange's whole gate surface —
  `cstart`/`crelease`/`chyst`/`crearm` writing through the composer panel
  (composerStartSeg/ReleaseSeg/HystSlider/RearmSlider). That also answers the "arrange is
  nearest + a crossfade?" question: arrange is the composer LATCH — proximity toggle over
  the field, 20 ms mute ramp, and `start: continue` is the crossfade feel (the loop was
  only muted, returns mid-phrase). `flips` + `start` are arrange's perform defaults.
  **Rename:** ENGINES.lens, `S.lensAperture` (grain.js, pins-audit), `.tile--lens`,
  `data-lens`, `lensTap`/`installedLens`/`refreshLensStates`, index.html search-panel row
  label. `S.arrangeScope` deliberately keeps its name — "scope of the flip", the ordinary
  programming sense. VOCABULARY records the rename; BRUSH-MODEL gains the v4c note; old
  dated quotes keep saying scope because they are records.

- [x] **#229 radius, fade, and the falloff diagram (Ek, 2026-08-26)** — three naming fixes
  and one widget, from playing the lens sheet. *field* → **radius** ("it's clear. it's the
  radius") — pid, label, chrome pill, and a one-shot stored-pid migration (`_PID_RENAMES` in
  tiles.js remaps mubone_perform_vis + mubone_tiles on load). *edge* → **fade** (sec + label;
  pids sedge/scurve → fade/fadeCurve in the same migration). **depth STAYS** — mid-pass Ek:
  "depth makes sense... it's just I see the number and I don't know what it means" — so the
  fix is the READOUT: a `read` override on the def routes display through READS, and depth
  shows "last 3 strokes" everywhere (the raw numbox "3" was the actual complaint; the derived
  numbox id `recencyNum` never even existed, so the row fell back to the bare slider value).
  **falloff diagram**: the curve % is now a drawn x/y plot (kind `fadecurve`) of the true
  gain formula (1 − d/r)^(1 + c×3) — cursor centre at the left, radius edge at the right,
  dragged vertically, writing through radiusFadeCurveSlider; dims when fade is off. Verified
  on the rig: drag moved 0.87 → 1.0 with the path steepening, and the migrated 87% proves
  the pid remap carried an old capture over. Aperture keeps its name (no old term exists —
  it is new state, the live voice cap min(brush k, aperture)).

- [x] **#230 The sheet edits its own tile; factory edits are session-only (Ek, 2026-08-26)**
  — supersedes #228's mode/derivation rule the same day. Ek: "when i switch from area to
  nearest in the wide lens it switches the lens. that shouldn't happen. everything on the
  engine sheet is for that tile... the factory default ones, if i move anything on that
  tile's engine sheet it's temporary [per session]. we'll reconcile how to save those
  later." Implemented: installed-lens selection is STORED (`_lensSel`; only lensTap moves
  it; refreshLensStates follows composerMode alone so ⇧K still works — N now flips the flag
  without moving the highlight, the installed lens just carries it); `mode` is an ordinary
  captured param with FACTORY_PARAMS identity (wide mode:'off'/area, spot mode:'on'/nearest);
  and captureTileParams forks — custom tiles persist to mubone_tiles, factory tiles overlay
  `_sessionCfg` in memory only. Old factory captures already in mubone_tiles are ignored on
  read, left on disk for the later reconciliation. Rig-verified: flip mode in wide's sheet →
  nearestMode true, wide stays lit; switch to spot and back → session edit returns;
  localStorage untouched.

- [x] **#231 min slice — segments under a floor merge instead of arming (Ek, 2026-08-26)** —
  the slice tool sometimes armed ~100 ms artifact segments (double-fired onsets past the 90 ms
  refractory). New `S.fx.sliceMinMs` (default 100, range 0–500, 0 = keep every cut) on the
  loop engine sheet as `min slice`, in slice's perform defaults. Mechanism is a greedy
  forward-merge in `_sliceStroke`: a cut is kept only if the segment it closes is ≥ the
  minimum, so a spurious cut runs on to the next real one — the CUT is dropped, never the
  audio, and every armed trigger is at least the minimum long; a short final segment merges
  backward. trigger-audit § slice grew two checks (94 total): minMs 250 merges a 150 ms
  double-fire to 2 triggers, minMs 0 keeps all 3.

- [x] **#232 The playhead survives the cursor standing on it; the ribbon swells harder (Ek,
  2026-08-26)** — two viz fixes. **Playhead:** rig probe showed state was never wrong — with
  the cursor held on a firing line, `playing` stays true and `playheadIndex` advances the
  whole pass — the ring was DRAWN and invisible: it was the stroke's own colour, and cursor
  proximity brightens the stroke outline to 0.5 and lands the glow dot on the same spot.
  Both playheads (trigger + commit loop) are now halo + colour ring + white core, readable
  against a bright stroke in any palette. **Ribbon:** the line's volume-width was
  `0.7 + (base·0.4 + max·0.9)·rms`; now `0.6 + (base·0.5 + max·1.8)·rms^1.35` — quiet
  playing stays thin, loud swells roughly twice as wide. Ek allowed for a viz-settings dial
  instead; the default got the push for now — if it still isn't enough, `vizRmsMin/Max`
  (the normalise window) is the dial to expose, alongside the deferred list in
  `docs/archive/viz-changes-for-cli.md`. NOT yet eyeballed with real mic material — check on the rig.

- [x] **#233 k, fill and order come home to the lens; aperture retired (Ek, 2026-08-27)** —
  reverses the k half of #212, on Ek's argument that flow dissolved it: density is painted
  into the material now, so how many marks the cursor READS — and in what order — is the
  lens's job. Done: `_selectPerVoicing()` collapsed to a single global keep-k-smallest pass
  (per-voicing group machinery deleted); k/kAllMode/kSeqMode removed from
  `resolveGrainParams()` (voicings freeze only the sound); order reaches every cursor voice
  live via message-level `kSeqMode` on the cursorVoices post (worklet applies it over the
  frozen block); `S.lensAperture` deleted end to end (state, sheet row, knob kind, wiring);
  k / k-all / k-seq rows removed from `PARAM_REGISTRY`, which strips them from old patches
  on load — factory patch defs keep dead k fields, harmless. Lens sheet is now the whole
  old search panel: mode · radius · depth · k · fill · order · fade · falloff · arrange.
  pins-audit § I rewritten to assert the new contract (59 checks; voicings carry no k,
  one k caps the pool across voicings, fill 'all' lifts the cap, registry clean). CLAUDE.md
  #212 paragraph rewritten to record the reversal. The mono-vinyl idiom is now a lens
  preset: spot, k=1.

- [x] **#234 The playhead rides the play-to-end tail (Ek, 2026-08-27)** — the #232 fix
  covered the cursor STANDING on a firing stroke; this is the other half: leave a looping
  stroke and release 'play-to-end' finishes the pass, but `stopTriggerAudio` clears
  `t.playing` and detaches the source immediately (rightly — the seq block must never
  rebuild a source for a pass that is ending), so the marker vanished the moment the cursor
  left while the sound carried on for seconds. Now the play-to-end branch leaves a
  `t._tail` record ({startedAt, speed, loopStart/End, direction}) and the renderer computes
  the marker from it with the seq block's own maths — the scheduler is untouched; the
  'ended' cleanup retires the tail, and every hard-stop path nulls it. Rig-verified:
  looping under the cursor (playing, idx 6) → exit (playing false, tail idx 10 → 15,
  advancing) → pass end (tail gone). Detached retrig:'layer' voices still have no marker —
  that remains the documented tradeoff.

- [x] **#235 The loop playhead is a TICK across the path — and the real reason indicators
  vanished (Ek, 2026-08-27)** — two things, one pass. **Shape:** both loop playheads
  (trigger strokes and held loop slots) are now a perpendicular tick — a tape head crossing
  the track — via shared `_drawPlayheadTick()` (tangent from the neighbouring mark,
  dark-halo + colour line); circle+dot stays the granulation's sign. **The bug found under
  it:** chasing why the tick never rendered on the rig exposed that BOTH playhead blocks and
  the anchor markers still carried the pre-pull-back depth treatment — a hard
  `depth > SPHERE_RADIUS*2` cull plus a bare `·df` alpha. With the camera pulled back, the
  cursor's material sits at the sphere's FAR surface (depth ≈ offZ + R), so the cull killed
  everything and, once removed, df ≈ 0 multiplied alpha to 0.001. This — not colour
  salience — is likely what #232 and #234's reports were mostly seeing at a pulled camera.
  All three blocks now use `depthFactor()` + the particle pass's floored fade
  (0.35 + 0.65·df): depth dims, never erases. Diagnosed by wrapping `S.ctx.stroke` on the
  live rig (the intercepted draw showed alpha 0.001); verified by screenshot — the tick
  rides the stroke at the playback position. Session lesson: screenshots of this feature
  were blind for three fixes because the audit rig runs a pulled-back camera and every
  marker was culled — pixel-level intercepts found in minutes what eyeballing could not.

- [x] **#236 The lens reads loops too; the loop engine keeps what bakes in (Ek, 2026-08-27)**
  — the organising question made explicit: what gets baked in when the line is drawn, and
  why? Read-time loop params (`dwell`, `tstart`, `release`, `retrig`, `rearm`) moved to the
  LENS as an "on loops" section, mirror of "on grains" (k/fill/order); the loop engine keeps
  the baked-in half — "baked in" (speed, vol) and "slicing" (chop, chop ms, min slice).
  Perform defaults: line ['tspeed'], slice ['tspeed','sliceMin'], wide gains dwell + start.
  **Honest caveat (also in the code comment):** all of these still write S.triggerParams
  live — the split is which tile OWNS and applies each param; freezing the baked-in half
  per stroke (a line remembers the speed it was drawn at) is future work, same family as
  #210's voicing freeze. Rig-verified sheet sections on both engines.

- [x] **#237 A dedicated looper tile — loops that start immediately and lay themselves into
  a layer** (Ek, 2026-08-27, thinking out loud) — the one loop param that earns brush
  placement is *what happens immediately after recording*. A tile whose contract is the
  traditional looper: record the loop, it repeats at once, and in our terms that means it
  puts a layer down by itself. Must square with the layer principles before building.
  **Done (2026-08-27):** built as the `looper` tile (loop engine, after slice) —
  `armTrigger` fires `S._onTriggerStrokeArmed` on every trigger-stroke release, and with
  looper selected the stroke also becomes a loop slot at once via the real
  `createSeqFromStroke`, stamped with the baked dials (speed, vol, passes) and filed into
  its layer lazily by `layerOf()`. Squares with the layer principles by construction: the
  slot is an ordinary hold, the stroke stays scratch (touch it and it fires — the 1+Q
  rule), and the rail just shows it.

- [x] **#238 Layer pickup — ⇧Q/⇧W/⇧E picks the nearest hold of that layer back up** (Ek,
  2026-08-27) — the inverse of the hold gesture, never yet designed. "The function we
  haven't even talked about." **Done (2026-08-27):** ⇧Q/⇧W/⇧E in the tile keymap →
  `releaseNearestInLayer(layerId)` — nearest slot of that layer, always closest, through
  the same `_releaseSlotAt` tail as ⌘D (extracted in this pass), so every rule about
  destroying a commit holds (composer-hold cleared, LED blink, rail dirty).

- [x] **#239 Self-killing loops — play N passes, fade each, then delete** (Ek, 2026-08-27)
  — decided at record time, a baked-in param by the #236 rule. "I record the loop and it
  repeats N times, fading out each pass — when it's done it deletes." **Done
  (2026-08-27):** `passes` (0 = ∞, 1–8) on the loop engine's baked-in section
  (`S.triggerParams.passes`, new `tp` param kind sharing the fx machinery), stamped onto
  the slot by the looper hook. The scheduler's wrap edge steps the gain down each pass
  (1 − wrap/N) and pass N calls `selfKillSlot`: a SHORT 120 ms idempotent fade (never
  S.loopFadeTimeMs, which belongs to manual releases and was 1.7 s on the audit profile —
  the first version borrowed it and the slot looked immortal), then the stroke's paint and
  trigger view are deleted. Rig-verified: slot → 2 passes → slot, marks, trigger all gone.

- [x] **#240 The baked half actually freezes (Ek, 2026-08-27)** — the #236 caveat closed.
  `_applyLiveParams` no longer pushes speed/volume into triggers: a trigger keeps what
  `_newTriggerShell` stamped from the dials at arm time, so moving speed changes the NEXT
  recording, never what is already on the sphere (the #210 rule, applied to loops). Dwell
  still reaches sounding material live — it is the lens's. Dead `_appliedVol/_appliedSpeed`
  trackers deleted; trigger-audit's live-params section rewritten as "read-time vs baked"
  (speed/vol deaf to the panel, dwell live, stamps asserted); the triggerParams field list
  grew `passes` (11 fields). 94/94.

- [x] **#241 Off-cursor: a loop-claimed stroke leaves the lens's reach (Ek, 2026-08-27)** —
  the mental model named: scratch is what the lens reads; the rail is everything playing
  OFF-CURSOR, grouped ("it's not actually a layer panel"). The boundary is the CLAIM, not a
  copy — nothing is cloned. Implemented: `updateTriggerGates` builds a claimed-stroke set
  per tick (one 16-slot scan) and a claimed trigger tracks `_inside` but never fires —
  touching a looping stroke does nothing, the accidental-trigger fix that motivated the
  model; release the slot and the leave-and-come-back rule applies. The claim follows the
  slot, not audibility (a composer-muted loop still holds its stroke). The looper's
  record-release audition removed (the loop starting IS the playback); the rail's empty
  state and foot now speak off-cursor. trigger-audit +2 checks (96). **Tail SETTLED (Ek,
  2026-08-27):** cloud-held granular material stays lens-readable — confirmed, not an open
  question. A cloud claims a region, not a stroke; the cursor granulating material a cloud
  also plays is the instrument working, and § 3e audibility/greying stays untouched. The
  off-cursor claim rule is a LOOP rule, by design.

- [x] **#242 The looper chooses its group; the inbox is a real group (Ek, 2026-08-27)** —
  new baked param `group` on the loop engine (`S.triggerParams.layerGroup`:
  inbox | Q | W | E, in looper's perform defaults). 'inbox' leaves layerId unset so
  `layerOf()` files the loop into the default loops layer lazily — which already mutes and
  solos like any other layer, so "technically it is a group" holds with no new machinery;
  Q/W/E target the key-addressable three via `S._layerForKey`. Rig-verified: inbox →
  "loops", e → "layer 3". triggerParams grew to 12 fields (audit updated).

- [x] **#243 Scrape reaches held loops; 'erases: stroke' (Ek, 2026-08-27)** — the bug: a
  held loop owns a SNAPSHOT (buildLoopPayload copies marks + extracts a buffer), so erasing
  scratch removed the paint while the loop kept singing. Now erase write-through
  (`S._onMarksErased` → ui-presets): erasing part of a held loop's stroke silences those
  time-spans IN PLACE in the slot's AudioBuffer (the playing source shares the object —
  heard next pass through the region, 3 ms ramps, copies matched by lon/lat, `_revBuffer`
  invalidated) while the loop keeps rolling — erase edits the material, never the time;
  erasing the whole stroke takes the loop with it (short fade). Trigger strokes keep the
  line-brush behaviour untouched (refreshTriggers trims/splits). Plus a new erase-engine
  param **`erases`: touch | stroke** (`S.eraseWholeStroke`) — contact picks WHICH strokes,
  same radius and recency fate, then the whole take goes. Rig-verified all three: partial
  (loop playing, region silenced to <0.001, copies shrank), full (loop dies), whole-stroke
  (one touch, take + loop gone). Known limit: undo restores erased paint but not the zeroed
  loop audio — the slot's buffer is destructive, like the loop itself.

- [x] **#244 The looper contract is a param — 'on end: arm | loop' (Ek, 2026-08-27)** —
  "i should be able to make another tool that can loop and add to held layer X... a key can
  go into a specific layer with intention." The loops-immediately behaviour moves off the
  looper's tile id onto a baked loop-engine param (`S.triggerParams.loopOnEnd`), pinned by
  FACTORY_PARAMS identity: line/slice `arm`, looper `loop`. So `+` → loop engine →
  on end: loop + group: W is a key that always records straight into W — verified on the
  rig end to end (custom tile keeps its contract across tile switches, its strokes loop
  immediately into the chosen group). triggerParams is 13 fields (audit updated).

- [x] **#260 The row indicator goes (Ek, 2026-08-28)** — "There's a little inbox bracket
  indicator on the right of each tool item when it's selected, no need for that now." Removed:
  the armed row is already said by its coloured left edge, and the bracket was saying it twice.
  `.trow-key` deleted with it.

- [x] **#280 Link and octave become their own rows, as state pills (Ek, 2026-08-28)** —
  "Octave buttons should follow pill form and have their own row. The link deserves its own row and
  a pill version interaction."
  **The link is a two-state pill** — `free | linked` — because that is literally what it is, and it
  is now the same control as mute's `live | muted`. A quiet note beside it says the state in
  numbers: *free to move*, or *9.66× held*. Verified both.
  **Octave stopped being three steppers and became a state, which is a real behaviour change and
  the point of the exercise.** Three buttons in a capsule would have lied about the shape — a
  capsule says *pick one of N* (#267), and `−1 / 0 / +1` were relative steppers: press +1 twice
  and you are two octaves up, with nothing lit to tell you. So the row is now **one of N**:
  `−2 −1 0 +1 +2`, read back FROM the pitch, covering the slider's full ±2400¢. Picking one moves
  to that octave and **keeps the cents you had inside it**, so the fine pitch control below stays
  true — the note says *on the octave* or *+37¢ off*. Verified: +1 → pitch `+12st`, pill follows.
  This also retires the proxy onto the rig's `octUp/octDown/octReset` buttons — the row computes
  the target directly, because "which octave am I in" is not a question a stepper can answer.
  **And the audit caught the link straight away**, which is the suite doing its job: `_grainLink`
  started as a module-private object, so nothing in the state snapshot moved when it toggled and
  §A reported it inert on all three granular pages. It lives on `S.grainLink` now — which is where
  it belonged anyway, being app state a pedal or an OSC address will want later. A control the
  audit cannot see is a control it will keep calling dead.

- [x] **#279 The grain/period LINK; octave steps back; overlap and dur-jit retired (Ek,
  2026-08-28)** — six things from one message, and the overlap idea is Ek's.
  **`overlap` is gone as a slider, and came back as a LINK.** Ek: "it's more diagnostic, we see it
  in the viz… or maybe it's like Photoshop's link icon — press it and moving grain or period keeps
  the overlap you had at the time of pressing." Exactly right, and it is the difference between a
  number and a relationship: overlap is grain ÷ period, so as a slider it could only fight the two
  controls that define it. The link captures the ratio when pressed and holds it — move duration
  and period follows. Verified: ratio 9.66 before, 9.67 after dragging duration 589 → 26 ms, with
  period carried 61 → 2.7 ms.
  **`dur jit` retired.** Ek: "not needed, it's already covered by the alt slider." Agreed — it was
  proportional duration jitter while `dur ±` is the same idea in absolute ms, and `dur ±` is the
  one now folded into the duration band.
  **The octave steps exist on this screen for the first time.** `−1 / 0 / +1` ride the pitch row
  as proxies onto the rig's own `octDown/octReset/octUp` buttons, which own the maths. They were
  on the #263 list of six controls the tile screen could not reach; this is one of them closed.
  Verified: 0¢ → +12st.
  **Pitch takes a full row** — its ± and the octave steps had no room in a half-width column,
  which is why Ek could not see them. (The ± was rendering the whole time, in a 2.5rem column.)
  **Alt-double-click clears the spread**, matching alt-drag setting it — the modifier means the
  same thing in both gestures. Verified 40 ms → 0.
  **`head` → `width`**: it is the width of the deposit head, `line` at 0° and N degrees above it.
  `engine-audit` and `docs-audit` pass.

- [x] **#278 The grain section, reorganised — and two naming answers (Ek, 2026-08-28)** —
  "Make grain and period bigger, those are the most important... taper should be the same row as
  curve... you labelled it grain, shouldn't it be duration? Not sure what dur jit is."
  **`grain` → `duration`.** The section is already called GRAIN, so the row was saying it twice
  and saying nothing.
  **`start ±` → `offset ±`.** It has nothing to do with a start time: it is per-grain READ-OFFSET
  randomness. Markers land on a fixed clock, so without it a grain can only begin exactly on one;
  it widens each grain's reach into the audio between markers. (Guide from its own tooltip: half
  the drop rate covers the gaps evenly — 25 ms at the default 50 ms rate.)
  **What `dur jit` is, and the problem with it.** `dur ±` is duration randomness in ABSOLUTE ms
  (0–500); `dur jit` is duration jitter as a PROPORTION of the base (0–100%). They are two
  controls for one idea, reaching the engine by different routes (`durVar` vs `durJitter`). Left
  alone here because collapsing them is an engine decision, not a layout one — but it is the kind
  of duplication that makes a panel feel arbitrary, and it should be settled.
  **Layout.** `duration` and `period` take a FULL ROW each with a taller track, larger type and a
  9px band — they are the two parameters that decide what granular sounds like, and at half width
  their ± band was there but unreadable, which is what Ek was seeing. `taper` and `curve` share a
  line: one is the shape of the window, the other is how much of the grain that shape occupies.
  Two bugs in that duo row, both from `_rowFor` bringing its own furniture: it emits its own label
  inside `.opt > i`, which appeared as a truncated second caption, and its chips starved the
  track until it got a `minmax()` floor.
  `engine-audit` (26 checks) and `docs-audit` pass.

- [x] **#277 Variation folds into its parameter; `fade` becomes `taper` (Ek, 2026-08-28)** —
  "Any clearer, more graphical but minimalist way to show the information?" and "I'm not sure fade
  is the correct word for the curve's steepness."
  **Half the grain section was the SPREAD of the row above it.** `dur ±`, `per ±` and `pitch ±`
  are not parameters of their own, and as separate tracks they made you hold two numbers in your
  head to know what one thing does. Each pair is one row now: the handle is the value, a band
  around it is the range it varies over, the ± number sits beside the value and is typeable, and
  **alt-drag on the track sets the spread** — the gesture the band's shape already suggests.
  Granular goes 24 tracks → 21, the grain section 10 rows → 8.
  **The band is proportional, not absolute, and that is deliberate.** Its half-width is the
  variation's own position in its range scaled to the track, because the grain and period sliders
  are LOG-mapped — ±40 ms is not a fixed fraction of the track, and drawing it as though it were
  would be a lie with a straight face. What it says truthfully is *how much this varies*, and it
  orders correctly, which is the row's job.
  **Rows that do nothing recede**: a param sitting at a default that means "no effect"
  (`start ±` 0, `dur jit` 0, jitters at zero) dims its fill and handle, so the eye goes to what is
  actually set.
  **`fade` → `taper`.** The parameter is the fraction of the grain spent ramping — the Tukey
  window's α — and *taper* is the standard term for a window's shaped edges. "Fade" was wrong here
  for a second reason: it is spoken for by the LEVEL fades elsewhere (the lens's radius fade, loop
  fades), and the lens keeps `fade` because that one genuinely is one. The pid stays `fade`, so
  every binding, OSC address and stored patch is untouched — the same treatment `flow` → `rate`
  got in #262. The scope caption reads `grain 589 ms · taper 294 ms`.

- [x] **#276 The segmented control, flattened and unified (Ek, 2026-08-28)** — "All the param
  options are square — the pill might be too intense, it has a 3D vibe. Maybe the selector in the
  params should be pills too, or not?" / "I prefer all pills to be flat, not have the bevel."
  **Both halves answered, and they pull in opposite directions on purpose.** The SHAPE stays a
  capsule and the engine params adopt it, because a divided capsule is what says "pick one of N"
  (#267) — params going square while the chrome stayed round would leave shape meaning nothing.
  The WEIGHT goes: the 3D read came from stacking three depth cues — an outer border, a recessed
  track, and a raised chip for the active segment. Any two of those read as a bevel. Now: no
  border, and an active segment that is a FLAT tinted fill rather than a lighter surface sitting
  on top. On an engine page the fill is tinted from `--c`, so the choice is in the engine's own
  hue; elsewhere it is neutral.
  One definition covers the chrome, the footer, the settings pages and the engine params, so the
  four cannot drift. The rig view's `.opt .seg` keeps its old square chip — that surface is not
  the one being designed.

- [x] **#275 The edit filter, and the sampler sheet's width (Ek, 2026-08-28)** — "Can you fix the
  edit lens, it doesn't work. Also the sample instrument engine sheet is crushed." Both were real;
  both were ORDER bugs in `renderProps()`.
  **Edit was being returned past.** The source guard (`if (_optSel.kind === 'source') return;`)
  sat above the `S.editHold` branch, so with the sampler as the last-tapped thing — which it is
  the moment you look at your samples — the guard returned before the edit sheet could draw.
  `editHold` went true, the filter froze the cursor, and the rail showed nothing: edit looked
  dead while actually being on. Edit is a STATE that overrides whatever is selected, so it is
  tested first now.
  **Its refusal was silent, which is what made it read as broken.** Declining when there is no
  stroke under the cursor is correct, but `_editHoldNote` wrote into a `.ds-head span` that only
  exists when an engine sheet happens to be open — so the common case said nothing at all. A
  refusal now opens the rail and states it: *edit — nothing under the cursor*, with what to do.
  Verified: with a stroke under the cursor, edit opens **19 rows** with `+ tile` and `done`.
  **The sampler sheet gets the same width as an engine page** (233 → 555px). It is a library of
  waveform rows and it was rendering into the narrow rail because the `engine-page` class was set
  from `engineOf(id)`, which is null for a source. It is a page of the same kind whatever draws
  it, so the class is set before the source guard returns.

- [x] **#274 The engine sliders had invisible handles (Ek, 2026-08-28)** — "I still don't see the
  sliders move. When I move them I see the number move and other stuff, but not the actual tick on
  the line." Exactly right, and the precise wording is what found it.
  **The handle and the fill were transparent.** They paint from `var(--c)`, which used to arrive
  as an inline style on each knob (`_knobFor(pid, accent)`). When knobs became rows (#261) that
  inline style went with them and **nothing replaced it**, so `--c` was unset on every row and
  `background: var(--c)` resolved to `rgba(0,0,0,0)`. Measured: handle `rgba(0,0,0,0)`, fill
  `rgba(0,0,0,0)`, while the DEFAULT tick — which uses `--text-faint` — stayed visible at
  `rgb(85,85,85)`. So the one mark you could see was the one that never moves, and the two that
  were tracking your finger perfectly (inline `left: 77.2%`, updating every frame) were painted in
  nothing. The accent belongs on the panel ROOT, once, where every row inherits it; set in
  `renderProps()` and in the edit sheet.
  **Why three earlier audits missed it.** #268 asked "does the control change engine state" and
  #272 asked "is the track long enough" — both yes, both irrelevant. Nothing asked "can you SEE
  the value". A control audit that never reads a computed colour cannot catch a control painted in
  transparent, and this is the third time in this file that the measurement, not the code, was the
  thing that was wrong.

- [x] **#273 The grain window, rebuilt from the old one (Ek, 2026-08-28)** — "The window grain
  vis doesn't really work — the fade doesn't change the curve. Study the old one, I really like
  it." Done 2026-08-28 by porting the model out of `drawPresetWaveform()` in `ui-presets.js`,
  which is the version that was right.
  **The fade bug was reading a key nothing writes.** The first version took
  `S.grainParams.fade`. Fade is not a number — it is a RATIO of the grain, expressed either as a
  percentage (`fadeRatio`) or in absolute ms (`fadeMs`) depending on `fadeMode`, with a 2 ms floor
  (unless exactly zero) and a hard 0.5 cap. Drawing it from `fadeRatio` alone would show a pct
  envelope while ms mode was sounding — the inverse of the bug where the preview moves and the
  audio doesn't. That resolution is now copied exactly, and the caption says the resolved value:
  `grain 589 ms · fade 294 ms`.
  **The envelope has the right shape.** Attack → sustain → release, with `atk`/`rel` per curve
  type (hann = raised cosine, tri = linear, rect = instant), where before it was one normalised
  ramp. And it draws the whole overlap TRAIN — up to 50 grains at `stride = period`, lead grain
  bright and the rest at low alpha — so the overlap is the picture rather than a number you have
  to imagine. Same 50-shape cap as the original, for the same reason: at low period and high
  duration the raw count passes 100 and starves the grain scheduler.
  **One real bug behind it, worth remembering.** The panel handlers coalesce their S writes
  (30–50 ms), so redrawing immediately draws the value from *before* the click — which is why
  `period` never moved the caption. Every control in the panel now repaints the scope on a 90 ms
  beat, tracks and segments alike.
  **And a testing trap that cost three rounds:** `renderProps()` replaces the panel's DOM, so a
  held `#engScope` reference goes stale and reads an orphaned canvas. Two "bugs" (curve doing
  nothing, ink not changing) were that. Re-query the canvas after any interaction. Verified per
  curve type by sampling the envelope height a quarter into the fade: hann 104, tri 95, rect 20.

- [x] **#271 The settings pages could not scroll (Ek, 2026-08-28)** — "Now I see it but I can't
  scroll down the keys/MIDI page." `.mu-dialog` sets `overflow-y: auto` with
  **`overscroll-behavior: contain`** so a modal never scrolls the page behind it. Borrowed into
  the settings host its `max-height` is removed, so it has nothing left to scroll — and `contain`
  then SWALLOWS the wheel instead of letting it chain to the host. 4061px of keys table inside a
  711px host, and no way to reach any of it. The borrowed dialog is `overflow: visible;
  overscroll-behavior: auto` now, so the host is the one scroller. Verified on every page:
  keys 4061/711, OSC 2943/711, audio 1382/711, visuals 1277/711 all scroll and reach bottom;
  sensors and pins fit.

- [x] **#272 The engine sliders felt stuck — 78px of travel (Ek, 2026-08-28)** — "Sure, I think
  they do make a change to the underlying number, but all the sliders seem stuck." Both halves of
  that are right, and the audit in #268 measured the wrong thing: it proved every track WRITES,
  which was never the complaint. At 30rem across two columns each track was **78px** — the entire
  range of a parameter in 78 pixels, which reads as stuck however correctly it writes. The rail is
  **37rem** and the label/value columns are tighter, so a track is **143px**; and **shift makes
  the drag fine** — it anchors where the shift began and moves at a quarter speed, which is the
  standard answer for a short track and matters most on the wide-span params (pitch ±2400¢,
  grain 10–2000ms). A lesson for the audit: "does it change state" and "can a person set the value
  they want" are different questions, and only the first was being asked.

- [x] **#270 Settings sections run their OWN open path; the pins page is params (Ek, 2026-08-28)**
  — "For keys/MIDI I don't see the table of all the stuff we can map and the MIDI/key learn." /
  "For the pins page we no longer need cloud or loop mode since the type is baked into the stroke…
  it's only the params that are staying."
  **The bug behind "a lot of them didn't transfer over".** Several of these modals do real work
  when their button is pressed — `renderMappingTable()` fills the keys/MIDI table,
  `imuSetupBtn`'s `onOpen()` rescans sensors, the audio modal repopulates its device lists. The
  settings shell only MOVED the dialog node, so all of it was bypassed and the keys page arrived
  with an empty table and no learn buttons at all. Fixed generally rather than per module: a
  section can name its `opener` and `closer`, and the shell **presses the module's real button**
  and takes the overlay back down before it paints. The module runs exactly the code it always
  ran — no second copy to drift — and the shell still decides where the dialog ends up. The
  closer matters too: leaving the keys page has to cancel an armed MIDI/key learn, or it stays
  armed invisibly and eats the next thing you press. Verified: **128 rows, 196 learn buttons**,
  filter present.
  **The pins page is params only.** The bank + count, the D / hold-D / ⌘D buttons, `clear all`,
  the cloud and loop param blocks, commit MODE and cloud MORPH are all off it — every one of them
  is either already in the tile screen (the pinned rail lists the slots by name; the pin buttons
  and chrome own the actions) or, in the case of mode, asking twice: **the type is baked into the
  stroke** — a line/slice/looper tile pins a loop, a grain tile pins a cloud. One `params` section
  remains, and it now follows the settings grammar: label · control · value on one line, choices
  as pills, no device header repeating the page title.
  **Deliberately hidden, not unpicked.** `S.commitMode` and the morph engine are still wired.
  Removing them from the ENGINE is a separate job with real reach — `seqModeEnabled` is a getter
  over `commitMode`, and `_commitTraceStroke`, the sampler and the looper contract all read it —
  so it needs its own pass with `pins-audit` and `composer-audit` green after. This change is
  the page, not the feature; the feature sunset is still open.
  `rig-audit` (6 suites) and `docs-audit` pass.

- [x] **#269 Sunset pass — four modals, staging, gesture, the edge HUD; an OSC reference; one
  settings look (Ek, 2026-08-28)** — "A lot of them didn't transfer over... sunset, not delete,
  just don't have it wired and make sure Claude doesn't waste time reading it." Done 2026-08-28.
  **How a thing is sunset here:** it moves to `sandbox/sunset-2026-08-28/` with a row in
  `sandbox/README.md`. That folder is already the project's answer — excluded from the build, and
  CLAUDE.md tells every session not to read it or cite it. So the work survives, weighs nothing,
  and cannot be mistaken for live code.
  **Gone from the app:** the **sample-instrument modal** (the sampler is the tool rail's source
  group, its library the properties-rail sheet — verified after removal that select, preview and
  delete all still work), **gesture** (`gesture.js`, `gesture-panel.js`, `gesture-viz.js` —
  nothing consumed the features; the panel was their only reader), **staging**
  (`snapshot-engine`, `osc-stream`, `ui-staging`, `ui-posture-map`, and `interp-kernels` +
  `relational-features` which were orphaned by their leaving), the **accessory table**
  (`ui-accessory.js`), and the **edge HUD** — the three-column A/S/D colour bar across the top of
  the canvas, which predated the tile screen and said in colour what the screen now says in
  words. Their markup left `index.html` into `sandbox/sunset-2026-08-28/modals.html`.
  **What deliberately stayed wired:** `accessory-registry.js`, because the setup file carries its
  config — only the table went. And a setup file that still holds a `staging` block round-trips
  untouched (`ui-export` reads it into nothing and writes it back), so staging can be revived from
  an old file.
  **New: the OSC reference page.** All **116** advertised addresses in one searchable page,
  generated at open from the SAME `ACTIONS` table that `midi.js` dispatches from and `osc.js`
  switches on — so it cannot drift from what the app answers to. Read-only on purpose: it is
  documentation you can search, not a second mapping editor. Columns: address · type · payload ·
  what it does · key. Filter narrows live (typing "grain" → 23 of 116).
  **One look for every settings page.** The pages are borrowed panels and modals that each had
  their own frame, so the shell had boxes inside boxes. Now a section is a caption and some rows
  with air around them — no card, no outline, a rule only where two sections meet, nothing
  nested; one row rhythm (label left, control right); eyebrow captions; pills for choices,
  rectangles for actions. The pins page in particular is reconfigured rather than pasted.
  **Two bugs in `docs-audit.js` this shook out**, both now fixed: its sandbox-isolation check
  matched any quoted mention of `sandbox/`, so every sunset comment read as a violation — it looks
  for an actual `import` now; and `gesture-viz.js` had to leave `KNOWN_ORPHANS`.
  `rig-audit` (6 suites), `ui-shots` (4 tiers) and `docs-audit` pass; APP_SHELL re-checked.
  **Not done, and the honest state of it:** the **keys/MIDI mapping modal is still the `keys +
  MIDI` page**. Retiring it needs a replacement mapping UI for the handful of functions worth
  exposing, and that is a design decision I did not want to make blind — the OSC half of the split
  Ek described is built, the key/MIDI half is not.

- [x] **#268 Engine-sheet audit — and the harness that keeps it honest (Ek, 2026-08-28)** —
  "You need to audit the whole engine sheets, you made them look pretty but none of the sliders
  work. If it's a matter of moving off the old rig view, start moving stuff over." Audited
  2026-08-28.
  **Result: every control works.** 107 track drives and 58 segmented choices across all eleven
  pages (spray · splatter · comb · line · slice · looper · scrape · scrape all · wide · spot ·
  arrange) each change ENGINE STATE, not just the readout. A realistic press-move-release drag was
  checked end to end too: down at 20% → 4.88 ms, drag to 80% → 747 ms, `S.grainOverrides.duration`
  and the rig slider and its numbox all following.
  **Three things looked dead and were not**, and two of them were my own test being wrong — worth
  recording because the next person will make the same mistakes:
  · Driving a track to A then B and comparing with the START reports a WORKING slider as dead
    whenever it began at B. Drive to one position, and only then the other.
  · `S.grainCurveType` and `S.grainDirection` are **not** inside `S.grainParams`; a snapshot that
    watches the wrong key reports a working control as dead. `curve` and `dir` are fine.
  · Under **spot**, the radius-fade row genuinely does nothing — `initRadiusFade` forces it off
    when `nearestMode` is on ("no radius to fade") and dims the row to say so. Correct, and now an
    explicit exemption in the suite rather than a mystery.
  **The real fragility Ek was pointing at is confirmed and now guarded.** The engine pages don't
  own their parameters: every row writes through a rig-view element. Delete or rename one and the
  row silently stops working — `_knobRange()` returns null, no error. `scripts/engine-audit.js`
  § C names all **44** ids the pages depend on and fails if any is missing, so retiring the rig
  view can be done a piece at a time with the suite saying when something has been left behind.
  Registered in `rig-audit.js` (now six suites, 60 checks in one boot) and written into CLAUDE.md's
  debugging section.
  **Still to establish before the rig view can go:** those 44 elements need somewhere to live.
  Nothing about that is decided yet — the honest next step is moving them into the modules that
  own their state, one control family at a time, with this suite green after each.
  ↳ **#291 (2026-08-29) retired the VIEW without answering this.** The 44 stayed exactly where
  they are, in a `display: none` **rig cabinet**, so the question is unchanged and is now guarded
  rather than blocking: § C is green, and it stays green through each family that moves out.

- [x] **#267 Shape encodes affordance — button vs toggle vs state (Ek, 2026-08-28)** —
  "The pills are cool for settings, but now we also see pills as buttons — how do professional apps
  reconcile this? The pill with options is nice to show state; mute should be that, on or off.
  Unpin Q / pin Q / unpin all are not options, they're buttons, and those should move to the
  pinned rail." Done 2026-08-28.
  **The rule, which is what real design systems do:** one shape, one meaning, so you never read a
  label to know what a control will do.
  · **`.tc-btn` — rounded RECTANGLE = an action.** Press it, it happens, it returns to rest. No
    dot, no lit state. undo · redo · sweep · erase all · settings · rig · the three pin buttons.
  · **`.tc-toggle` — the same rectangle plus a state dot = a boolean that STAYS.** mic · tools ·
    pinned.
  · **`.seg-pill` — a divided CAPSULE = pick one of N, exactly one true now.** Read it to know
    state, never to act. mute · dry monitor · azimuth · elevation.
  Before this the capsule was all three, so shape carried no information at all.
  **Mute is a state, so it says which state it is in** — `live | muted`, the muted segment amber —
  rather than being a button whose meaning you have to remember. Picking the already-active
  segment does nothing, which is what a segmented control means (a button would toggle); verified.
  **The pin actions moved to the pinned rail**, under its header and above the material they act
  on: `pin Q · unpin Q · unpin all`, three equal buttons on one row. The full name is kept for the
  destructive one — beside two pin buttons, "all" could be read as *pin* all, and ambiguity in a
  destructive control is the one place it actually costs something. ⇧Tab still cycles the group and
  the labels follow; `-` / `=` unchanged. Verified: pin → 1 slot, unpin all → 0, group cycles
  Q→W→E.
  Chrome is now four groups of one kind each, and the footer needed no change — it had only state
  controls already. `rig-audit` (5 suites), `ui-shots` (4 tiers) and `docs-audit` pass.

- [x] **#266 The footer follows the tools' rules; segmented pills (Ek, 2026-08-28)** —
  "I don't see the gate slider anymore, it should be there. Also you didn't follow the principles
  from the tools — sliders should be double clickable to reset, numboxes should be editable. For
  the dry mon can you make it a 3-way pill like they do in apps, matching the pill design in the
  header?" Done 2026-08-28. All four were fair: #265 cut the gate row, and the footer had none of
  the params' interaction rules.
  **The gate**: put back into the audio group, then removed again the same day on Ek's word —
  "I just need to be able to monitor it in the levels." The LEVELS rail already draws the gate
  meter with its threshold marked, so a second copy in AUDIO was the same fact twice; setting the
  threshold lives in Settings → audio. The audio group is now **master and the dry-monitor mode**:
  one level and one state, both worth a glance mid-piece.
  **Double-click resets, numbers are typeable** — the two rules the tool params already follow,
  added to the footer rather than duplicated: one pass over whatever the footer is holding,
  idempotent, reading `data-default` for the reset and writing a typed value through the PAIRED
  SLIDER, which already owns the clamp, the step and the formatting.
  **The units trap again, one level down.** A footer box can DISPLAY different units from the
  slider it drives — dry gain reads "50%" for a slider value of 0.5 — so typing 120 landed as
  200%. Rather than hard-code the mapping (the mistake the engine page taught), the scale is read
  back off the app's own formatter: what it last printed for the current value gives the factor.
  **And a double-commit:** Enter commits then blurs, and blur commits too — the second commit ran
  against a scale the first had just invalidated. A dirty flag fixes it. Verified: 120 → 120%,
  double-click → 50%.
  **Segmented pills** (`.seg-pill`) — rounded capsule, hairline, filled active segment, the same
  reading as a chrome pill. A three-way choice is ONE control, so it gets one outline rather than
  three boxes side by side. Applied to dry monitor and both cursor source pickers.
  **What had to give.** Four audio rows at ~160px each did not fit a 1400px strip beside the
  meters and two cursor pickers, and the row being clipped was MASTER — the value you most want at
  a glance. Dry gain left for a moment on the input-channel rule, then came back once the gate row
  freed the budget — a dry level is ridden mid-piece, not set once. The audio group needs 659px of
  the 659px it has: nothing scrolls, nothing is clipped, at 1400px.
  `rig-audit` (5 suites), `ui-shots` (4 tiers) and `docs-audit` pass.

- [x] **#265 The footer, designed (Ek, 2026-08-28)** — "Clean up the footer, it's all over the
  place. Use the design principles from the tools and its params. Footer should have a light grey
  border same style as the header. It's a footer to be an at-a-glance monitor for my systems and
  state." Done 2026-08-28.
  It had accumulated four label styles, no grouping and no frame. It is now built from the SAME
  vocabulary as a params section: **one eyebrow caption per group, a hairline rule between groups,
  mono tabular values, one line, everything on one baseline** — and a top border matching the
  header's bottom border exactly. Four groups, in the order you read them:
  **LEVELS** (the thin meters, names beneath the bars so the rail reads as one instrument rather
  than five labelled boxes) · **AUDIO** (dry monitor, dry gain, master) · **CURSOR** (azimuth and
  elevation source) · **SENSOR** (OSC + connection state). 65px tall, nothing scrolls, nothing
  clipped at 1400px.
  **Three things were cut, each because the footer already said it elsewhere** — which is the
  whole job of a monitor strip:
  · the duplicate `sensor-group-label`, since the group caption says it;
  · the **input channel** select, chosen when you plug in, not during a piece;
  · the **paint-gate threshold number**, because the LEVELS rail draws the gate meter with its
    threshold marked, which is the glanceable form of the same fact.
  Both cut controls keep their home in Settings → audio. Cutting them is also what made MASTER and
  both cursor pickers fit without scrolling.
  **Audio and cursor are separate groups**, not one wide one: as a single group the row scrolled
  inside itself and clipped elevation. Audio is the group that gives when the window narrows — it
  has the most in it and its controls are the least glanceable; cursor and sensor hold their size,
  because a picker you cannot see is a picker you cannot read.
  `rig-audit` (5 suites), `ui-shots` (4 tiers) and `docs-audit` pass.

- [x] **#264 The meters get Ableton's ramp, thin (Ek, 2026-08-28)** — "The levels monitor was
  thin, it looked really good... design a meter pretty much exactly like Ableton's — light green,
  to dark green to yellow to orange to red. That's for all audio meters in that area." Done
  2026-08-28.
  **The ramp is fixed to the SCALE, not to the level** — that is the part that makes a meter
  readable at a glance: a colour always means the same dB, and rising level reveals more of the
  ramp. (A gradient keyed to the current level just changes hue as it moves and tells you
  nothing.) Stops are placed in dB, since the canvas maps −60…0 dBFS over its height:
  **−60 light green `#a8e063` · −30 green `#2e9e4f` · −12 yellow `#e8d44d` · −6 orange `#ef8c3a`
  · −3 → 0 red `#e0483c`.** The last 3 dB are flat red so clipping is unambiguous rather than a
  gradient you have to judge. Verified by reading pixels back off the canvas at each level.
  **Thin**: 6px bars with 2px gaps in the footer rail, 2px clip dots, no rounding. The gate meter
  was 12px beside 6px level bars and read as a different KIND of control, so it matches width now
  — it is still a different reading (level against a threshold, not against clip), which is what
  its own drawing says.
  Three ticks across a 5px bar was noise rather than scale, so there is **one mark, at −12 dB**,
  drawn only where the fill is not already covering it.
  `rig-audit` (5 suites) and `docs-audit` pass.

- [x] **#263 The footer becomes audio + sensor; `unpin all` to the chrome (Ek, 2026-08-28)** —
  "The audio panel I plan to use the footer. The footer will be audio and sensor settings — that's
  where we can move the azimuth and elevation 3-way choice. One button, clear all in commits, I
  want exposed in the chrome with the pin and unpin, but say unpin all instead. Then remove that
  from the pin settings page." Done 2026-08-28.
  **The tiles footer is now audio + sensor**: the levels rail, then the rig view's **audio device
  borrowed whole** (gate, dry mon, dry gain, master), then the cursor's **azimuth / elevation**
  three-way pickers borrowed out of the cursor device, then the sensor/OSC status. All borrowed,
  never copied — `tile-layout.js` takes them on entering the layout and gives them back on
  leaving, the same obligation as the settings modal and the camera picker.
  **`unpin all`** joins the pin pair in the chrome (after them, so the paired verbs stay adjacent),
  proxying `#commitClearBtn`; the button is hidden on the pins settings page, because it is a
  performance action you reach for between pieces rather than a setting.
  **Two things this cost, both worth knowing.** `.device` and `.device-body` set
  `flex-direction: column` for the panel column, and declaring only `display: flex` in the footer
  left that in place — the bar grew to **208px** before the direction was said out loud. And with
  everything in it the row was 54px wider than a 1400px window, pushing ELEVATION off-screen; the
  **input channel select** is dropped from the footer to make room, on the grounds that it is
  chosen when you plug in rather than during a piece, and it stays in Settings → audio.
  The footer now scrolls inside itself rather than widening the bar.

  **The migration audit Ek asked for.** Everything in the rig view was checked against what the
  tiles view can reach. Covered: the whole **grain** device (the granular engine page drives every
  `gc*` element through PARAM_DEFS), **trigger** and **composer** params (loop and lens pages),
  **search**/radius/recency/k (lens page), **commits** (pins settings page), **grain envelope**
  (the engine page's sound window), **erase** (the scrape tool), **audio** (footer + Settings),
  **session**'s undo/sweep/erase-all (chrome pills). **Patches** is sunsetting, as agreed.
  **Genuinely not yet reachable from the tiles view — six controls:**
  `cursorTareBtn` (tare — the ` key works, no button), `sessionAltLockBtn` (alt lock — Alt works),
  `hfArmBtn` (handsfree arm), `morphBtn` (morph), `commitLockBtn` (commit lock), and the
  `octUp/octDown/octReset` buttons beside pitch (the pitch slider itself is covered). None have a
  home yet; four of the six have a key or a gesture, two (handsfree, commit lock) have neither.
  ↳ **All six resolved.** #279 gave octave a row; #291 moved **handsfree arm** into Settings →
  audio as a pill and ruled on the other four (tare is in Settings → sensors, alt lock is a
  disabled readout, `commitLockBtn` is the pre-tile `trace_mode`, and morph's engine left with
  `gesture.js` in #269). #291 also found a seventh the audit had missed — `trig_toggle`, which now
  rides the lens sheet.
  `rig-audit` (5 suites), `ui-shots` (4 tiers) and `docs-audit` pass.

- [x] **#262 Pins get a settings page; `flow` becomes `rate` (Ek, 2026-08-28)** — "Rename flow to
  be rate in deposit. Moving over to pins — previously that was the commit panel in the rig view.
  I want a new nav item in settings for all of the pin settings, take them all from the commit
  panel and make sure they're wired up." Done 2026-08-28.
  **`flow` → `rate`** in the granular engine's deposit section (label only — the pid stays `flow`,
  so every binding, OSC address and stored patch is untouched).
  **Pins is a settings page.** The rig view's `.device--commit` gets an id and is **borrowed
  whole** by the settings shell — a third body type beside `modal` and `panel`. Nothing was
  rebuilt and nothing was copied, so all 39 controls keep their ids, listeners and wiring.
  Verified live from inside the settings page: the slot-count slider moves `S.commitSlotCount`,
  the mode segment moves `S.commitMode` cloud → loop, and the slot canvas draws; on close the node
  goes home to the rig view's `right-panel`. Nine sliders, 17 inputs, 20 buttons, 2 selects.
  Its collapsible sections are **forced open** in the settings host: a settings page that hides
  half of itself behind disclosure triangles is the thing this page exists to replace.
  **Also, from the same message and the one after it:** the ␣ glyph came off the belt tiles
  (#260 finished the job — the armed tile is already said by its box and its key legend, and that
  was a third telling), and **all experimental params stay visible on every granular tile** for
  now, which closes the last open question from #261's proposal.
  `rig-audit` (5 suites) and `docs-audit` pass.

- [x] **#261 The engine page — rows, a sound window, and a drawn filter (Ek, 2026-08-28)** —
  "The dials are actually not very helpful, the old sliders were fine... I want the old waveform
  window at the top so at a glance I know what it will sound like... all the numbers should be
  editable, all the sliders double-clickable to reset." Proposed as an interactive mock, approved,
  built 2026-08-28.
  **Knobs → one-line rows.** `name · track · number`. A knob on screen is bigger than a track for
  the same precision, has nowhere to put its value, and cannot be compared with the knob beside it
  — two arcs at 40% look identical whether that is 40% of 10 ms or of two seconds. Rows line up,
  so a section reads as a shape. The whole granular engine (24 tracks + 4 segmented choices) now
  fits in two columns at 30rem with the sound window above it. `_knobArc` and the `.ds-knob` CSS
  are gone; `_knobRange`/`_knobVal`/`_knobSet` are untouched — only the paint changed.
  **Every number is typeable, every track double-clicks to its default.** The tick under each
  track shows where that default is *before* you commit; all 24 have one (`el.defaultValue` is the
  HTML `value` attribute, which no interaction changes, so `slider` params get it for free; the
  store-backed ones carry an explicit `def`).
  **The units trap, and how it is handled.** A `slider` param's raw units are the ELEMENT's
  position, not what it displays — the grain sliders are log-mapped, so typing "250" into a 0–1000
  position slider first gave **7 ms**. The app already owns that inversion in the paired numbox
  (`fromDisplay`, ui-presets.js), so a typed value is handed to the numbox and Enter is pressed on
  it. Re-deriving the log curve here would have been a second copy of it, drifting silently. The
  same applies to the filter, which works in real Hz.
  **The sound window** (`#engScope`) draws one grain at its real duration and envelope PLUS the
  next grain's onset — the question the four numbers make you compute: am I overlapping, and by
  how much. Caption reads "one grain · 250 ms / 61 ms apart · 4.1× overlap". Granular only; the
  slot is there for loop (take + slice points) and lens (falloff), which are the obvious next two.
  **The filter is drawn and IS the control** (`#engFilter`): drag the left edge for hpf, the right
  for lpf, vertically for Q; jitter is a band around the curve, not a fourth row. The two edges
  cannot cross — an hpf above the lpf is a silent filter and reads as a broken control. This is
  the one place the horizontal-track default is broken, because here the curve is the parameter.
  Verified on the rig: 0 knobs, 24 tracks, 24 numbers, 24 ticks, two columns; typing 250 → 250 ms
  with the scope following; drag → 40%; double-click → back to 100%. `rig-audit` (5 suites),
  `ui-shots` and `docs-audit` pass.
  **Still open, from the proposal's decision list:** all 32 granular params show on every granular
  tile (the experimental block is most of the length) — whether splat/drip/echo/staff/chop should
  appear only on their own brush is undecided.

- [x] **#259 Every rail overlays; pinned gets a pill (Ek, 2026-08-28)** — "Rename the properties
  to be tools. We should add a pill to hide the pinned as well, which means the pinned will act
  the same way — it's on top of the viz not pushing over." Done 2026-08-28.
  **The pinned rail was the last thing taking a grid column**, so the stage was `1fr 246px` and
  the sphere lost 246px whether or not you were looking at the arrangement. It overlays now, like
  the left pair, and `body.tile-layout.pinned-open` gates it from a **pinned** chrome pill
  (persisted in `mubone_pinned_rail`, on by default). The stage grid is a **single cell**: one
  column, one row, and no rail can resize the sphere any more.
  Measured: the canvas went full-window at every tier — **1400px: 1152 → 1398 wide**, 800px:
  798, 520px: 518 — and stays identical with the pinned rail shown, hidden and shown again.
  **`properties` → `tools`** (`#tcDesign` → `#tcTools`): the pill opens the tool rail, and the
  properties rail follows what you open in it, so naming it after the panel named the wrong half.
  The narrow tier lost its stale re-placement rules — there is nothing to re-place when the stage
  is one cell — and instead just narrows the rails, with the properties rail giving way first
  since the tool list is what you navigate with.
  `rig-audit` (5 suites), `ui-shots` (4 tiers) and `docs-audit` pass.

- [x] **#258 Two left rails — the browser and the device view (Ek, 2026-08-28)** — "The long
  tile thing is no longer useful, this is just a list of tools. I like the pinned rail design on
  the right — do one on the left with the list of all the tools. Then when you click on it it
  should open up another rail with all the properties... it's literally like Ableton's left side
  nav." Done 2026-08-28, with Ableton 12 as the reference.
  **The horizontal strip and the footer panel are both gone.** `#toolRail` is the catalogue as a
  LIST — every tool the app has, grouped source · lens · loop · grain · erase · new, one row each
  (22 rows). `#propRail` opens beside it with that tool's whole engine. Both mirror the pinned
  rail's frame, header bar and type, so the screen reads as one idea from either edge.
  **They OVERLAY the stage rather than taking grid columns**, which is the #251 lesson carried
  forward: opening either never resizes the sphere. Verified — canvas height is identical with
  both rails closed, the tool rail open, and both open (751px throughout). The stage grid is back
  to a single row.
  **Two independent marks on a row, because they are two facts.** ARMED (a left edge in the
  engine's hue + the belt key) is what space fires; OPEN (a raised ground) is what the properties
  rail is showing. They are usually the same row and must be able to disagree — clicking a lens
  opens its properties without arming anything, which is exactly what happens.
  Clicking a tool row arms it AND opens its properties: the list and the device view are one
  gesture apart, which is the whole point of the shape. `Esc` closes innermost-first — properties
  rail, then tool rail; closing the list closes both, since a device view with no list beside it
  is orphaned.
  **Two things caught on the rig.** The rail's inner containers (`#srcBar`, `#lensBar`,
  `#tileBar`) still carried the strip's `display:flex` and scrolled horizontally inside a vertical
  list — undone in the rail's own scope, since the rig view still renders the strip shape. And an
  earlier edit to the Esc ordering was silently lost when its script aborted on a later assertion,
  so Esc closed the list and left the panel orphaned; re-applied and re-verified. Worth
  remembering: a failed multi-edit script writes nothing, so the *earlier* edits in it are gone
  too.
  `rig-audit` (5 suites), `ui-shots` (4 tiers) and `docs-audit` pass; dead strip/footer CSS
  removed and brace balance checked.

- [x] **#257 One hue per engine; nothing dimmed; flat (Ek, 2026-08-28)** — "Let's work on engine
  palette. None of it should be greyed out. You still have the indicator dot to add to perform
  view but we don't have perform view anymore... generally for glass panel and elsewhere, I prefer
  flat." Done 2026-08-28.
  **Palette.** There were fifteen tile colours — a hue picked per brush — which on one dark strip
  read as confetti rather than a system. Colour now answers exactly one question, *which engine is
  this*, so **five hues cover the app**: source slate-blue · lens teal · loop rose · grain sand ·
  erase clay, at matched chroma and lightness so no group shouts louder than another. A tile's own
  identity is its glyph and its name, which is what you read anyway. Layer colours (Q/W/E) moved
  into the same family. Verified: exactly six `--c` values across the whole strip, five engines
  plus "no engine", where there were fifteen.
  Tokens live on **`:root`**, not `body.tile-layout` — the tile row renders before that class is
  set, so a class-scoped palette silently resolved to the fallback on first paint. That cost one
  debugging round; worth remembering for any token the row reads at render time.
  Two hues were per-*item* and are gone: the sampler tile took the CURRENT SAMPLE's paint colour
  (the one tile whose hue moved under you — the sample's colour stays on its waveform rows, where
  it means something), and lens tiles had one colour each.
  **Nothing is dimmed.** Toolbox/source/lens tiles were at 0.78 opacity, ghost tiles at 0.45, and
  the properties panel dimmed unchosen cells to 0.42 — and a half-opacity control reads as
  **muted**, which is what dimming means in a DAW. A tile that is not current is simply not boxed;
  a not-built tile says so in its tooltip; `redo` when there is nothing to redo loses its outline
  rather than being drawn at half strength.
  **The ◉/○ eyes are deleted, with their whole machinery** (`DEFAULT_VIS`, `visList`, `setVis`,
  `mubone_perform_vis`, `.ds-hidden`, `.ds-eye`). They chose what appeared in the perform quick
  view — deleted in #251 — so they were choosing what shows in a place that does not exist. The
  panel now shows the engine, all of it, every cell drawn the same.
  **Flat.** The belt's `backdrop-filter` blur was the one material on screen that existed nowhere
  else, and a drop shadow under a panel on a black stage buys nothing: opaque ground, one hairline,
  radius 10 → 4px to match everything else. Armed backgrounds composite on `--bg-app` instead of
  `transparent`.
  **The GET STARTED popup is retired** (same message): it opened over the sphere on every cold
  start and had to be dismissed before anything could be played. Its three steps live in the
  tooltips of the controls they describe and in `docs/QUICK-START.md`. `S._dismissFirstRun` stays
  defined-then-null so `sampler.js` / `ui-samples.js` callers need no change.
  Caught in test: removing the `_vis` store took `_migratePids` with it (shared with `_tileCfg`) —
  restored. `rig-audit` (5 suites) and `docs-audit` pass.
  **Left alone deliberately:** `TILE_DEFS[].c` still carries the old per-tile colours. Nothing
  reads them for the strip any more; they are one grep from removal but also harmless, and they
  are the record of what each brush used to be.

- [x] **#256 The pin pair leaves the belt; a consistency pass (Ek, 2026-08-28)** —
  "Remove the pin and unpin from the belt. What I really wanted was just a button for it... it's
  starting to look really inconsistent." Done 2026-08-28.
  **#252's belt tiles are reverted.** At belt size they were two buttons pretending to be
  instruments; the belt holds TOOLS — things space fires. `pin`/`unpin` are ordinary chrome pills
  now (`#tcPins`, `renderPinChrome`), sitting with undo/redo because that is what they are: they
  act on what already exists rather than painting. Keys `-` / `=` and ⇧Tab group cycling are
  unchanged, and the group is still said in the label and a coloured dot.
  **What was actually inconsistent, and what was done:**
  - **Two navigation languages.** The rig footer's six chips (sensors · feedback · gesture ·
    mapping · staging · accessory) are every one of them a nav item in Settings since #255, so on
    this screen they competed with the chrome. Hidden under `body.tile-layout`; the bottom bar
    keeps only live STATE — meters and sensor/OSC status.
  - **Mute existed twice** — a chrome pill and a red box bottom-left, which was the most
    eye-catching object on a screen whose subject is the sphere. The bottom copy is hidden.
  - **Six micro-label sizes** (0.52 → 0.63rem) at four letter-spacings, because every surface had
    invented its own. Three tokens on `body.tile-layout` — `--fs-eyebrow` / `--fs-control` /
    `--fs-meta` — and the chrome, strip, rail and panel all read from them. Verified: the six
    eyebrow selectors now resolve to ONE computed style where there were six.
  - **Ten chrome buttons in an undifferentiated row.** Grouped with hairlines into four ideas —
    pins · history+destructive · monitoring · doors — and decorative glyphs dropped from labels
    (`↶ undo` → `undo`): a dot now means "this control has an ON state", and its absence means
    "this is an action".
  - **Destructive styling was permanent.** `erase all` is neutral at rest and red on hover/focus:
    a warning you look at all day is one you stop seeing.
  - **The rail was the wordiest thing on screen** — a four-line paragraph and a two-line empty
    state, in a panel that is empty most of the time. Two short lines and `nothing pinned`; the
    rules live in `KEYBOARD-SHORTCUTS.md` and the pin buttons' tooltips.
  `rig-audit` (5 suites), `ui-shots` (4 tiers) and `docs-audit` pass.

- [x] **#254 The toolbox strip collapses with properties (Ek, 2026-08-28)** — "Include the whole
  tile bar collapsed with properties. So the properties pill opens up the tile row and the
  properties." Done 2026-08-28. Both footer rows are 0 in performance: the playing screen is
  sphere + floating belt + chrome and nothing else, and the canvas is 749px where it was 690.
  Pressing **properties** opens the strip and the panel together — they are one prep surface —
  and clicking any tile in the strip arms it *and* retargets the panel, which already fell out of
  the #251 wiring (`armTile` → `renderOptions` → `renderProps`). A lens retargets the panel
  without arming, since a lens is not armable. Verified both directions on the rig.

- [x] **#255 One settings door; the rig view starts sunsetting (Ek, 2026-08-28)** — "Move all
  those to a master settings module with each item as a nav item in this new menu window."
  Done 2026-08-28. `js/ui-settings.js` + `#settingsModal`: a left nav in four groups —
  **sound** (audio · sampler) · **sensors** (sensors · mapping · gesture · staging · accessory ·
  led feedback) · **view** (visuals · camera + display) · **control** (keys·MIDI·OSC ·
  export·import·reset) — and a `⚙ settings` pill in the tile chrome beside `rig`.
  **How a section is shown is the load-bearing decision.** Nine sections already exist as modals,
  each wired by its own module through `getElementById`. The shell does not rebuild or copy any
  of them: it **moves that modal's `.mu-dialog` node into `#settingsHost` and moves it back on
  close**. Listeners survive reparenting and ids do not change, so every module keeps working
  with no knowledge of this one, and there is never a second copy of a control to desync — the
  cc-mirror lesson applied by construction rather than by vigilance. The rig view's own buttons
  still open the same modals, verified after a settings visit.
  The two sections with no modal (view, session) live in `#settingsPanels` and are hosted the
  same way; their controls are `data-proxy` clicks onto the real buttons. The camera picker is
  **borrowed and returned** like a dialog — held permanently it vanished from the rig top bar
  entirely, because the panel it sits in is `hidden`. That was caught in test.
  **Coverage check against Ek's list.** Missing from it and now included: **learn mode**,
  **fullscreen**, **sampler**, **perf monitor**. Not included and why: **patch table** — Ek is
  removing it, so it keeps its rig button rather than a nav item; it is *not* deleted, which is a
  separate call that would take the PARAM_REGISTRY editor with it. **mic** and **mute** already
  live in the tile chrome. **"Advanced settings" does not exist** as a panel anywhere in the app —
  no modal, no section — so nothing was moved for it; if it meant something specific, say what and
  it gets a nav item. The footer's meters and sensor-status readouts are live state, not settings,
  so they stay in the bottom bar.
  `ui-settings.js` added to `sw.js` APP_SHELL. `rig-audit` (5 suites), `ui-shots` and
  `docs-audit` pass.

- [x] **#253 One toolbox strip; the belt is a copy, not a move (Ek, 2026-08-28)** —
  "When you drag it to the belt I shouldn't remove that tile from the toolbox... all the tiles in
  the toolbox should be the same design... don't clamp the lens tiles with the right rail. Just
  one long edge-to-edge footer with all the tiles separated by a vertical divider. Order: source,
  lens, paint, erase. The monitoring actually should not be a tile." Done 2026-08-28.
  **The toolbox is the CATALOGUE.** `boxIds()` returns every tile, always; putting a tool on the
  belt is a copy. One consequence worth knowing: a tile is now on screen TWICE, so `tileEl()`
  became `tileEls()` and every class write (`playing`, `fired`, `armed`) hits both copies — a
  class set on one and not the other is a tile that lights up in one place and not the other.
  Drag learned the zone it STARTED in (`_dragFromZone`): box→belt adds, belt→box removes from the
  belt, box→box re-ranks the catalogue.
  **One edge-to-edge strip** (`grid-column: 1 / -1`), groups told apart by a caption and a
  vertical rule: **source · lens · loop · grain · erase · new**. The lens left the right column —
  penned beside the pinned rail it read as a different kind of surface rather than a different
  kind of tool. Every tile in the strip is now literally the same element and the same size
  (verified: one distinct size across all 22).
  **The source tiles lost their meters.** A live canvas among static glyphs was the main reason
  that group read as another species of control, and it was a second read of analysers the bottom
  bar already draws — so `#mainInputGroup` is visible under this layout again and `tickMainMeters`
  ticks one set unconditionally. Source glyphs moved into the shared `<svg>` vocabulary.
  **The dry-monitor tile is gone** (it was #245's): monitoring is rig, set before a show, and it
  was the one tile whose subject was not a tool. The three-mode picker keeps both its homes — the
  audio panel seg and the audio-settings select — and `renderLiveSheet`/`_syncLiveSheet` went with
  the tile.
  **One mark for "current in its group"**: armed tool, selected source and installed lens all draw
  the same box. Three different treatments for one answer shape was itself part of what read as
  three kinds of control.
  Caught in test: lens clicks were bound to `#lensDock`, which this pass deletes — rebound to
  `#lensBar`. `rig-audit` (5 suites), `ui-shots` (4 tiers) and `docs-audit` pass. `browser-audit`
  fails at its `127.0.0.2` stage, but **identically on a clean tree** — pre-existing and
  environmental, not from this work.

- [x] **#252 The belt's second section — PIN and UNPIN on `-` and `=` (Ek, 2026-08-28)** —
  "In performance it's gonna be a pin and unpin button. By default group Q, but then I can shift
  tab to change what pin and unpin will go into... that way Q W E and shift Q W E still work, just
  via the keyboard and is not part of the belt." Done 2026-08-28. Two more big tiles on the belt's
  shelf, a gap right of the tools: **`-` unpins, `=` pins**, into the group the pair is showing.
  **⇧Tab cycles the group** (Q → W → E, wrapping), and the tiles say which twice — in the label
  (`pin W`) and in the colour, both read **live from `layers.js`** rather than copied, so the pair
  can never disagree with the rail. Group persists in `mubone_pin_group`.
  **They are not tools, and the UI says so**: own bed, no armed state, never in the Tab cycle,
  never armable by click, not draggable — space has nothing to do with them. `=` is a HOLD with
  the same semantics as `Q` (tap = where you stand, hold = a drawn path) and shares the
  `_downLayerKey` guard, so holding `Q` and `=` together cannot start two plants and finalize one.
  A click is the tap form, since a click cannot hold. `Q W E` / `⇧Q W E` are untouched and still
  address a group directly.
  **⇧Tab no longer means "previous tool"** — a belt of two or three makes forward-only cycling
  cheap, which is the point of keeping it small, and the group is the other thing worth a bare key.
  **`-` DISPLACES SWEEP on this screen** (`events.js:734`). Deliberate, and the reason the handler
  calls `stopPropagation`: sweep clears the whole scratch layer, so the outcome that must not
  happen is one press both unpinning and sweeping. Verified — in tile layout `-` unpins with zero
  sweeps; in rig view, where this handler stands down, `-` still sweeps. Sweep keeps its chrome
  pill on both screens. `rig-audit` (5 suites) and `docs-audit` pass.

- [x] **#251 Properties is a footer section; the perform quick view is gone (Ek, 2026-08-28)** —
  "Add it under the tiles where the current quick view tiles are... instead of a drawer method
  it's more that there's a new section at the bottom like a large footer, then I can just hide
  that section. No need to call it design. It's just like a properties drawer. I don't want it to
  change size constantly, I can just scroll down." Done 2026-08-28, and it settles three
  questions at once.
  **The perform quick view is deleted** — `.optbar`, `.lensopts` and `.tile-foot`, with
  `renderLensOpts()` and the body of `renderOptions()`. It was three strips under the row (armed
  tile's visible params, installed lens's, a foot note) that the properties surface then repeated
  at full size: the same number showed twice on one screen. **One parameter, one place.** The ◉
  eyes survive, now choosing what shows on the tile itself. `renderOptions()` is kept as a name —
  every option handler calls it after an edit — and just repaints the panel when the panel is up.
  **Third form for the sheet, and the one that holds still.** Page flip (#223) hid the sphere;
  drawer over the stage (#249) moved and resized under you. It is now a plain **footer section in
  its own grid row**: `grid-column: 1 / -1`, **fixed 17rem whenever shown** regardless of engine
  depth, scrolling inside. Verified: 255px for spray, scrape, line AND the wide lens, with the
  canvas identical across all four. Sections still column-pack, and at full width that is four
  columns.
  **Renamed to what it is** — `design-view` → `props-open`, `setDesignView` → `setPropsOpen`,
  `renderDesign` → `renderProps`, `#designSheet` → `#propsPanel`, and the chrome pill reads
  **properties**. The engine chooser and the edit note moved into the panel with it (the foot
  strip that used to hold the note is gone).
  **The bug this shook out:** showing or hiding the panel changes the STAGE ROW's height, and a
  grid row resize fires no resize event — the canvas kept its old backing store and the sphere
  rendered as an **ellipse**, reach ring and all. `setPropsOpen` now dispatches `resize`. This is
  the same failure the 2026-08-27 note on the grid describes, one layer up; worth remembering that
  any change to a footer row's height needs the event said out loud.
  The belt lost its `--ds-h` dodge — properties has its own row, so there is nothing over the
  stage to clear. `rig-audit` (5 suites), `ui-shots` (4 tiers) and `docs-audit` pass; every tier
  gained canvas height with the strips gone (1400px: 690 → 738).

- [x] **#250 The belt floats over the stage, big (Ek, 2026-08-28)** — "Can the tool belt be
  floating center lower in the viz area and much bigger." Done 2026-08-28. The belt left the tile
  row for its own dock (`#beltDock`, `index.html`) that shares the stage's grid cell,
  `align-self: end; justify-self: center` — centred low over the sphere, glass-backed
  (`backdrop-filter`), tiles at **8rem wide with 3rem glyphs** (was 4.6rem / 1.3rem). The row
  keeps the toolbox and gave back the height the belt's bed had cost (4.1 → 3.9rem).
  **The dock is `pointer-events: none` and the belt inside it `auto`**, so the gaps around the
  tiles are still sphere and still paint; a tile swallows its own `mousedown` so clicking one
  never lays a mark under it (verified: `isPainting` false after a belt click). It sits ABOVE the
  design drawer (z 4 vs 3) and **lifts clear of it** — `setDesignView`/`renderDesign` publish the
  drawer's measured height as `--ds-h` on a rAF and the belt's `margin-bottom` reads it, with a
  170ms transition; engines differ in sheet depth, so re-targeting the drawer re-measures.
  Verified: belt bottom 227 vs drawer top 243 with the drawer open, back to rest on close.
  **Two consequences in code:** the belt and the box are no longer siblings, so the drag state is
  module-level (`_dragFrom`) and both containers get the same handlers — that is what makes a
  drop in the *other* container work; and no single container holds every tile any more, so
  `tileEl(id)` queries both (the `.playing` class and `flash()` went through it). Narrow tier:
  the belt wraps rather than overflowing and its tiles shrink to 5.4rem. `rig-audit` (5 suites),
  `ui-shots` (3 tiers) and `docs-audit` pass.

- [x] **#249 The design sheet becomes a DRAWER (Ek, 2026-08-28)** — "For the design pages let's
  move to a drawer instead of switching the page." Done 2026-08-28. The sheet used to take the
  stage's grid cell and send the canvas to `visibility: hidden`, which broke the one promise the
  design view makes — *tune a brush while the cursor is on the sound it is making*
  (`docs/archive/BRUSH-MODEL.md` § 3c, the reason settings were never banished to a separate page). It
  still shares the stage cell but pins to the bottom of it (`align-self: end`), capped at
  `min(62%, 28rem)` and sized to its content below that, so the sphere keeps rendering above and
  the drawer rises out of the row you pressed (170ms, skipped under `prefers-reduced-motion`).
  **Sections column-pack** (`.ds-body { column-width: 21rem }`, `break-inside: avoid` per
  section): a drawer is wide and short where the page was tall, and stacked sections put granular
  at 692px of scroll inside a 332px drawer — worse than the page it replaced. Column-packed it is
  425px, and erase went 230 → 156px, i.e. no scroll at all. The head is `position: sticky` so the
  title and close stay reachable in a long sheet. Close: the `design` chrome pill (unchanged), a
  new `esc ✕` in the head, or **Esc** — which stops propagating so it closes exactly one thing,
  and defers to the first-run hint while that is up (the hint advertises Esc itself, and without
  the guard one press closed both). The drawer intercepts its own clicks because the trace
  listener is on `S.canvas` itself, so the sphere left exposed above stays paintable while the
  drawer is open — verified, `isPainting` stays false on a drawer click. `rig-audit` (5 suites)
  and `docs-audit` pass.

- [x] **#248 The belt and the toolbox — the instrument is two buttons (Ek, 2026-08-28)** —
  "Realistically it's 3 buttons. 2 even... it's more like the artist's belt that has a few
  limited ones that I tab thru." Done 2026-08-28. The tile row splits in two. The **belt** is the
  small ordered set `space` reaches and **Tab** cycles (`line · spray · scrape` by default, any
  length allowed, persisted in `mubone_belt`); its position is the keymap, so only belt tiles
  carry digits. The **toolbox** is everything else, grouped by engine (loop / grain / erase),
  unkeyed and off the cycle — nothing was deleted, and a toolbox tile still arms on click, so the
  whole set stays one click away in prep. Drag between the two to change what the piece can reach;
  dropping *on* a tile inserts before it, so one gesture both re-ranks and re-keys the belt.
  **`sel` is now a tile ID, not a row index** — a tile keeps its identity across the two areas,
  and two areas cannot both hold "index 3"; every assignment goes through `armTile()`.
  **Tab mid-stroke queues** (`_pendingArm`, drained in `refreshPlayingState` — the one function
  already watching the gesture end) because swapping the brush mid-line would cut the line; the
  queued tile shows a quieter box with `⇥`. **Armed** is a box + `␣`, identical on the belt and in
  the toolbox, since the question it answers is the same. The row grew 3.6rem → 4.1rem: the belt's
  bed adds 6px of chrome the old fixed height had no room for, and tile names clipped.
  **The test for what may enter the belt: if space cannot fire it, it is not a tool** — so lens,
  cap, edit and source keep their own docks and are not belt candidates. Engine paths, ACTIONS,
  OSC, the layers rail and the parameter registry are untouched; `rig-audit` (5 suites) and
  `docs-audit` pass. **Not done, deliberately:** no `brush_next` action yet, so Tab is
  keyboard-only — a pedal cannot cycle the belt until it lands on the shared ACTIONS table with
  `/brush/next` beside it (then re-run `osc-audit`). That is the next piece if the two-button
  instrument is going to be played with feet.

- [x] **#245 Auto-monitor — dry monitoring gets a third mode (Ek, 2026-08-28)** — "monitoring
  is turning out to be quite important... we need to be smart with it." Done 2026-08-28.
  Dry monitor is **off | on | auto** (`S.dryMonitorMode`, the setting; `S.dryMonitorEnabled`
  is now the *effective* state the gain follows). **auto** rests ON and ducks itself for the
  length of a **granular-engine** live recording (hear the granulation forming, not the
  instrument doubled); a **loop-engine** take keeps it ON (the take is the instrument).
  `startLiveRecording` asks `S._tileEngine()` (= `engineOf(selectedTile)`, tiles.js), falling
  back to the stroke's own flags (`_recordingTrigger` / `commitMode === 'loop'` → loop) when a
  lens or edit tile is selected; `stopLiveRecording` restores. An explicit off/on set
  mid-recording wins at once. Four surfaces, one setter: the **`mon` tile** in the tile row's
  source group (`ui-source.js` — label is the mode, glyph lit = the sound is in the house, dimmed
  = ducked; click cycles off → on → auto, allowed mid-stroke), the **live source's design
  sheet** (click an input tile or the mon tile in design view — pills, dry gain, the auto rule
  spelled out, live "● ducked — granular take" readout), the rig audio panel (three pills, active
  one dims while ducked) and the audio-settings modal (select); `S._setDryMonitorMode` for
  dispatch. Still
  starts OFF every launch — the mode is deliberately a session setting so a rig cannot boot
  into feedback. Same day, the sampler got its own half of the rule: a loop-engine stroke from
  the sampler plays the crop audibly while held (`sampler.js` monitor voice), granular strokes
  don't. **The open question is still open**: a loop take still turns the cursor scan off
  (`events.js`, `sampler.js`) — whether that stays automatic or becomes the cap's job was left
  as-is; no OSC/MIDI action for the mode yet.

- [x] **#246 Session 2026-08-28 — commit `e122069`** — four pieces in one day, each written up
  in the commit body: the **radius ring stays visible under nearest/spot** (it still gates
  loops, triggers and cloud focus — only the grain pick ignores it); the **lens dock** (lens
  tiles + always-on quick view own the footer's right column; radius is lens-global via
  GLOBAL_PIDS; footer rows fixed so the sphere stops stretching); **loop silence fixed**
  (buildLoopPayload assumed paint order = time order — non-monotonic strokes rebased marks
  negative, one poisoned pin's src.start() throw killed every loop and the trigger gate;
  bounds are min/max now and a failing slot dies alone); the **EDIT filter** (`js/edit-lens.js`
  — toggle beside cap, freezes the cursor, opens the one stroke's banked settings; grain =
  copy-on-write re-intern, loops = per-trigger speed/vol/passes now in the session file; `+`
  mints a tile; found and fixed: PARAM_DEFS `fade` duplicate-key shadowing → lens `rfade`);
  and **redo** (⇧⌘Z / `/redo` / chrome pill — undo captures what it destroys, redo reinstates
  incl. silent trigger re-arm; any new action forks history; stack capped at 20).

- [x] **#247 The sampler is an input, not a brush (Ek, 2026-08-28)** — "samples are more like
  selecting the input… with multiple performers i found it very necessary to have clear which
  input is being used." BRUSH-MODEL **§ 1g** (new) carries the model: the chain is **source →
  brush → lens**; the sampler is ONE input channel that is also a store (disk files + recorded
  takes, current-sample picker inside — the old modal demoted to the sampler's surface);
  recording into it is **gesture-free** — prep-time or a MIDI-mapped press, never the sensor,
  because the body is the instrument. The stamp brush dissolves: spray/line *from* the sampler,
  and hit + sampler source is the old stamp. Honest sizing: never played live in years — it is
  a **testing / piece-building tool** (Simpler with an audio-in), so build the plain version
  first. Touches when built: `js/brush.js` (stamp branch out of `brushClaimsTrace`, stamp
  entries out of the library), `S.activeSampleIndex` → sampler-internal, `paint1`–`paint10` →
  source-select/sample-select successors, stroke colour keyed on **source**, and the meter
  strip lifted from `ui-audio-settings.js` (`renderInputMeters`, `S.mainInputChannel`) onto the
  performance screen as the source switch. **Bookmarked, deliberately unbuilt: the post tap** —
  the sampler fed by a ring buffer on the system's output, a *capture* action freezing the last
  N seconds into a take. Generational resampling, not literal feedback (strokes snapshot on
  paint, #210) — explore live once the plain sampler exists.
  **BUILT same day (this session), all twelve steps of the plan.** The shape it took:
  `S.sourceKind` + `S.samplerIndex` (persistent, never −1) replace the transient
  `activeSampleIndex`; the four actions (`source_live`, `source_sampler`, `sampler_sample`,
  `sampler_record`) replace `paint1`–`10` and `/paint/N`; `js/sampler.js` owns the source half
  (the ported paint body incl. seq-mode release, verbatim odd mute line and all — see flag
  below); **source tiles** per Ek's ruling — a grouped section left of the tile row
  (`#srcBar`, `js/ui-source.js`), one tile per live input that IS its level meter (ticked in
  `tickMainMeters`' own pass; the bottom bar's input column hides under tile layout so no
  analyser is read twice) plus the sampler tile, click = switch, sampler tile in design view
  opens a compact library sheet (select / delete / record toggle — crop and waveforms stay in
  the rig-view modal, deliberately not factored); `captureInput` cores factored out of
  start/stopLiveRecording with `startSamplerCapture`/`stopSamplerCapture` beside them
  (refusals both ways across the families, 80 ms floor, takes named "take N — X.Xs");
  `hotSwapSample()` in the bridge — which also fixed the standing bug where a file dropped
  mid-session was inaudible until engine restart; **hit + sampler works** (trigger-stamped
  sample stroke, armed on release — the old stamp's fires-on-touch, rig-verified);
  comb/chop/staff sieves read the file's features so the experimental brushes paint from the
  sampler too; **a loop-engine stroke held past the sample LOOPS it, and the take IS the
  looped audio** (Ek's rulings, same day, in two steps — "the sampler should just be like
  audio playing in but it loops as long as i'm activating the paintbrush"): on release a
  sampler line MATERIALIZES its take (`_materializeSamplerTake`, sampler.js) — a real buffer
  of the crop repeated for the held duration, the stroke converted to an ordinary live-style
  stroke (source 'live', own liveRecBuffers slot, grainStart = the stroke's clock, undo
  entry repointed, rec-limit budget honoured). One playhead travels the whole line, the
  audio is the loop repeating for the drawn length, and slice/erase/undo/export need no
  special cases because from release on it IS a recording. While held, marks carry `p.takeT`
  (the stroke's elapsed clock; the deposit cursor advances at 1× for trig strokes) so the
  in-progress ribbon and the trigger machinery (`_ordT()` ordering) stay clean across
  passes; conversion deletes it. Spray keeps the reference model — marks are onsets into
  the shared sample, inaudibly different — and its wrap also stopped squeezing click-length
  boundary grains at the crop seam; export v9 with one-shot
  import migration; the hidden `#sampleViewer` + ~250
  lines of sv* code, `sampleColorIndex`, QWERTYUIOP badges and the `>= 9` off-by-one all
  deleted. rig-audit 5/5, osc-audit wiring, docs-audit green; browser-audit green on
  127.0.0.1 (the 127.0.0.2 origin can't bind on this Mac without `ifconfig lo0 alias` —
  environmental, predates this work).
  **Still open under this number:** (a) the ported `S._setMuted?.(false) || setScanMuted?.(true)`
  line (sampler.js) looks like a mangled "unmute master, mute scan" — kept verbatim, decide
  what it should DO; (b) stroke colour by source (multi-performer legibility) deferred by
  Ek's call; (c) `js/undo.js` split out of ui-samples.js remains recorded debt. Full
  osc-audit ran green after adding precondition notes for `/source/live` (boot default),
  `/redo` (#246 gap, pre-existing) and `/composer/allon` (pre-existing).

### Aug 24

- [x] **#193 Composer mode — latch-toggling commits by cursor proximity** — An arrangement layer over the commits that already exist. Latched mode (⇧K or the panel chip); while on, **scan auto-mutes** and the cursor toggles any commit it reaches. Commits only — triggers are deliberately untouched, since a trigger owns nothing and latching one would fight that. Full reasoning in `docs/archive/COMPOSER-MODE-PLAN.md`; the harness is `scripts/composer-audit.js` (39 checks, folded into `rig-audit`).
  **The two commit types are different verbs on different machinery, and that IS the feature.** A **loop is MUTED** — the source never stops, so unmuting drops you where the loop would have been rather than at the top, like a DJ mute (Ek's call). That ruled out `_stopSeqAudio()` entirely: it stops the source, which is exactly what loses the place. Instead a dedicated `_muteGain` sits in series after the existing gain (`src → gain → mute → VBAP`), because `gain` already carries `grainParams.volume` **and** is what `_stopSeqAudio` ramps for fades — riding it would have had a stop fade and a mute fighting inside the same 50 ms. `seq.playing` stays true throughout, so the scheduler keeps updating the VBAP playhead and the spatial position is correct on return too. `release` then means *when the mute lands*: `play-to-end` (default) ramps at the next loop boundary using the remaining-time maths lifted out of `_stopSeqAudio`; `cut` is a 20 ms ramp now. Unmute is instant and deliberately unquantised — the loop never left the groove.
  A **cloud is STOPPED**, held at silence by its own fade in/out (`commitAttack` / `commitRelease`, 0 = instant) with the slot intact. That state did not exist: the only release path a cloud had **ended in deleting the slot**, because releasing a cloud *was* uprooting it. The ramp now forks on `_composerHold` — uproot deletes, composer holds.
  **The bug that fork created, and the reason section D of the audit exists:** the scheduler skipped `playing === false` slots outright, so `releaseCommit()` stamped `_releasingAt` on a held cloud and the deleting branch was never reached. **⌘D on a stopped cloud did nothing — the commit was unkillable.** Fixed by letting a release in flight through the skip, and by having all three destroy paths (`releaseCommit`, `uprootNearestSeed`, `clearAllSeeds`) clear `_composerHold` first.
  **Entry seeding is not a detail.** The gate seeds its inside-flags from the cursor when the mode is entered, so entering while standing on a commit does not toggle it — a random silence at the worst possible moment, and a bug that only appears when you enter the mode over something. Hysteresis (1.15×) and rearm (120 ms) come straight from the trigger tool and matter *more* here: with a momentary gate boundary chatter is a glitch you forget, with a latch it toggles twice and the error persists.
  **Cost:** 0.0011 ms/tick at 16 dropped commits, 0.016 ms at 16 drawn strokes of 200 — under 0.1% of the 20 ms tick. The bounding cap earns its place: without it the drawn path is linear in stroke length (0.075 ms), with it 4.7× cheaper and bounded.
  Session export round-trips both states, and `playing === undefined` still means playing so every commit made before this existed is unaffected. **Not yet played on the rig** — `hysteresis` and `rearmMs` are still guesses, and a latch is where they bite.

### Aug 10

- [x] **#177 Trigger tool — samples fired by cursor proximity** — From the percussion-ensemble workshop: with the x-imu3 on a turntable, Ek wants to paint percussion gestures at bearings (triangle at 12 o'clock, woodblock at 3) and have them **fire as whole samples** when the direction vector reaches them. Granulation can't play a recording verbatim and no amount of grain-param tweaking gets there — it's the wrong primitive.
  **The finding that made this small: the playback engine already existed.** The `loop` commit type is not granular at all — one `AudioBufferSourceNode` reading a buffer straight through, with VBAP panning following the playhead along the painted particles. Verbatim playback, click-free 35 ms fade-in, reverse via a cached `_revBuffer`, play-to-end release, start-anywhere `startOffset` — all shipped and all reusable. The genuinely new part is **a gate**: `playing` stops being pinned true at creation and becomes a function of cursor proximity. "Start from the top vs from where the cursor touched" is `startOffset`; "stay on it and it loops" is `src.loop`. One-line differences in code that already worked.
  **Decisions (Ek):** hit test is **any particle in the stroke**, not an anchor hotspot — a stroke sung from 12 to 4 o'clock is live along its whole arc. **Global tool mode** (`granular | trigger`, ⇧T) rather than per-stroke: trigger mode mutes the granular scan wholesale, one tool at a time. **One-shot by default with a loop-while-held toggle.** **No slot bank** — triggers live in `S.triggers`, not `commitSlots`, so a dozen of them don't compete with clouds and loops for the 16 slots; the sphere is the readout.
  **A trigger entry is shaped exactly like a loop slot**, so the seq block in `grain.js` runs it without knowing what it is — the block iterates both arrays and needs only two changes (`src.loop = seq.trigger?.dwell !== 'oneshot'`, and skip the bank limit for triggers). No new audio path, no second panner, no parallel envelope. `js/trigger.js` registers on `S._updateTriggerGates` rather than being imported by `grain.js`, per the house circular-import rule.
  **The hot path has no transcendentals.** `acos` is monotonic, so `angle < gate` is `dot > cos(gate)` — the per-particle scan is pure multiply-add, and the only `cos` calls are two per trigger per tick on the gate radii. A bounding cap computed once at arm time rejects everything the cursor isn't near. **32 armed triggers × 200 particles = 0.0018 ms/tick** against the 20 ms scheduler interval; 32 costs 2.8× one, not 32×.
  **Hysteresis and a rearm window are in v1, not deferred** — a turntable parked near a bearing sits exactly on the radius boundary, which without them machine-guns the sample. Exit radius is 1.15× the enter radius; refires inside 120 ms are suppressed. **A one-shot deliberately ignores the exit edge**: a cursor sweeping past a triangle at speed should still get the whole triangle, or the sample's length becomes a function of how fast the turntable was moving.
  `_stopSeqAudio()` could not be reused — *both* its paths end by nulling the commit slot, and a trigger must survive being stopped. `stopTriggerAudio()` detaches the node refs up front so the old subgraph fades itself out while the trigger stays armed.
  Also: `buildLoopPayload()` extracted from `createSeqFromStroke()` (pure refactor, step 1); trigger particles drawn as decimated polylines under a shared 240-projection budget with the halo at the stroke's **nearest** point, not its anchor (an anchor circle would show a catchment area that isn't the real one); `tool_mode` / `trigger_disarm` / `trigger_disarm_all` through the shared `ACTIONS` table so keys/MIDI/OSC/accessory all reach them; `toolMode` + `triggerDefaults` persisted in `mubone_seed_settings` (no new storage key); undo of a stroke disarms triggers armed from it, or the sample would keep firing at a bearing whose stroke is gone.
  **Verified headless — new `scripts/trigger-audit.js`, 25/25**: boot + hook registration, enter/exit edges, the hysteresis band **from both directions** (same distance, opposite answer — nothing else in the app has that property), the rearm window suppressing and then releasing, `start:'touch'` landing mid-buffer on the particle actually reached, the bounding cap rejecting before the scan, and the cost table. `browser-audit.js` 68/68 and `verify-action-ranges.js` 34 ok · 0 mismatched · 2 skipped. **Not yet played on the rig** — radius 8°, hysteresis 1.15, rearm 120 ms are starting guesses that only a turntable can settle. Files: `js/trigger.js` (new), `scripts/trigger-audit.js` (new), `docs/archive/TRIGGER-TOOL-PLAN.md` (new), `state.js`, `grain.js`, `events.js`, `renderer.js`, `ui-presets.js`, `ui-improv.js`, `ui-meters.js`, `ui-audio-settings.js`, `ui-export.js`, `midi.js`, `osc.js`, `main.js`, `index.html`, `sw.js`.

- [x] **#178 Export bug: loop particles serialised as indices into an array they were never in** — Found while building #177, which needed the same serialisation and would have inherited it. `ui-export.js` wrote `particleIndices: slot.particles.map(p => S.particles.indexOf(p))`, but `buildLoopPayload` **replaces its particles with detached copies** so `grainStart` can be rebased onto the extracted buffer — so `indexOf` returned −1 for every one, import filtered them all out, and the scheduler's `!seq.particles.length` guard then skipped the slot. **Every imported loop came back silent, with no playhead and no marker, buffer intact.** Playhead slots from `addPlayheadFromExisting` were affected identically. Fixed by storing values (`[lon, lat, grainStart, grainDuration]`, also several times smaller than an object each); `EXPORT_VERSION` 5 → 6, pre-v6 files keep the old read path so they still import their buffer. **Two export audits missed it because both were looking for fields that were absent or stale** — the `STATIC_KEYS` drift failure mode. This one was present, plausibly named and structurally valid; only its meaning was wrong, and only because of a fact that lives in another file. Written up as § E9 in `docs/EXPORT-IMPORT-AUDIT-2026-08.md` with the general rule: an index is a reference into one specific array, so only serialise one if the objects are actually in it.

- [x] **#179 `browser-audit.js` had four checks failing on every run** — Found by running the control against a clean `HEAD` mirror before trusting my own results. The modal-count assertion (`modals >= 12`) went stale when **#169 deleted `cameraModal`**, and it appears in three places, producing four failures. Corrected to 11. Worth noting as a process point: a harness that is always red hides the next real regression, which is most of the reason it exists — and the only thing that told the two pre-existing failures apart from my own was the control run.

- [x] **#181 Trigger gets its own panel** — Ek's call, and the right one: a trigger isn't a kind of commit, it's a different instrument — selecting it mutes the granular scan — so it had no business as a collapsible section under commits. New `device--trigger` panel (the 11th), added to `DEFAULT_PROJECTOR_LAYOUT` slot 4 under `commit`. **The tool picker moved out of the top bar and into the panel**, also Ek's call, so the switch and the things it governs are in one place.
  **The panel stays visible in granular mode and dims its rows instead of hiding them** — it holds the picker that gets you back into the tool, so hiding it would hide its own switch. Armed count + disarm are dimmed only when nothing is armed, not by mode: **armed triggers keep firing in granular mode** (they're material, not a mode) and the hint line says so, since a control that silently stops working is worse than one that explains itself.
  Wiring split into **`js/ui-trigger.js`** rather than growing `ui-improv.js`, which is the commit panel's module.
  **Two things the screenshots caught that the assertions didn't.** (a) **The release row was landing at 0.122 effective opacity** — `_dim()` on a row inside an already-dimmed section multiplies, and 0.35 × 0.35 reads as a rendering fault rather than an inactive control. It's now only dimmed *within* a live section; when the section is dimmed the row rides along with its siblings at 0.35. Verified numerically across all three states (granular 0.35/0.35, trigger+once 1/0.35, trigger+loop 1/1). (b) **The hint line was the loudest text in the panel** — it had borrowed `.erase-status`, which is 12.3px and centred because in the erase panel it's the only caption; above seven labelled rows it read as a heading. New `.trigger-hint` at 9px, left-aligned to the label column. Left alone deliberately: the `⇧T` badge floats to the panel's right edge, which looks detached — but `.seq-record-key` is `position:absolute; right:0.7rem` and `⇧D` in the commit panel does exactly the same, so matching it beats fixing it here.
  Verified: `trigger-audit.js` **28/28** (five new — own panel, picker inside it, nothing stranded in the commit panel, visible-but-dimmed in granular, non-zero layout box), `browser-audit.js` 68/68 now reporting **11 panels**, `verify-action-ranges.js` 34 ok · 0 mismatched, `APP_SHELL` complete. Files: `js/ui-trigger.js` (new), `index.html`, `css/style.css`, `js/events.js`, `js/ui-improv.js`, `js/main.js`, `sw.js`, `scripts/trigger-audit.js`.

- [x] **#182 The tool switch is the trigger on/off — parking vs disarming** — Ek, reading the first build back: *there's no way to turn a trigger off except the disarm thing, which destroys it.* Correct, and the fix was that a switch already existed. **Gates now only act on edges while `toolMode === 'trigger'`**, so ⇧T parks the armed set — positions, settings, buffers all survive, anything sounding is released through its own rule (a `play-to-end` one-shot finishes rather than being cut), nothing fires. Disarming stays separate and destructive.
  **Also corrected a misunderstanding worth recording: arming never consumed the stroke.** `buildLoopPayload` hands back detached copies and the originals stay in `S.particles`, so an armed stroke was always still granulatable — disarming doesn't "turn it back into" a normal buffer, it just removes the trigger layer. Ek's rule (every painted sound stays granulatable) holds with no exceptions; the tool decides which way you play it. Confirmed by reading the code rather than asserting from design intent, which is how the *actual* surprise surfaced: before this change, switching back to granular with a trigger armed gave you **both at once** — granulation of the stroke and the trigger still firing.
  **Two details that were easy to get wrong.** (a) **The geometry keeps running while parked** and only the edge *actions* are suppressed — that is what stops re-selecting the tool from banging every trigger the cursor is resting on, because `_inside` is already accurate and there's no spurious enter edge. Priming the state on the transition instead would be a second code path and a second thing to forget; the cost of just running it is ~0.002 ms/tick at 32 triggers, which isn't a number worth trading correctness for. (b) **Leaving trigger mode has to silence explicitly** — with the gate no longer acting on exits, a `dwell:'loop'` would loop forever with nothing left to end it.
  Renderer draws parked triggers at 0.45 alpha and never shows proximity or firing states — the gate still tracks `_inside`, and drawing it would promise a shot that isn't coming. Panel hint reads `N parked · select trigger to play them`, since a non-zero count with no sound would otherwise look broken.
  **Considered and rejected for now:** a per-trigger park toggle and a separate global "triggers active" switch — both add a second concept to hold while playing, and the tool switch already carries the meaning. Noted in the plan doc's scoped-out list with what it would take. Verified: `trigger-audit.js` **34/34** — six new checks including *parked doesn't fire*, *parking doesn't disarm*, *re-selecting on top of a trigger doesn't bang it*, and *deselecting silences without disarming*. `browser-audit.js` 68/68, ranges 34 ok · 0 mismatched. Files: `js/trigger.js`, `js/renderer.js`, `js/ui-trigger.js`, `scripts/trigger-audit.js`, 3 docs.

- [x] **#183 Trigger type belongs to the buffer, not to a mode — the model, third time** — Ek's mental model, and it is the right one: *the player knows before pressing record whether a sound will be triggered or granulated.* Space records granular material, **⇧space records a trigger**, and whenever the cursor touches a buffer it does what that buffer was recorded as. **Never both.** No global tool mode, no arm, no disarm.
  **Everything that was annoying about the previous two builds had one cause: the trigger owned a copy of the material.** It held detached particles and its own extracted buffer, which is why erase couldn't reach it (erase works on `S.particles`; the copies weren't there), why `eraseAll()` missed it (it clears particles, buffers, strokes, commits — it had never heard of `S.triggers`), why disarm had to exist at all, and why "does it also granulate?" was even a question. **A trigger is now a *view* onto a painted stroke**: particles are the live objects in `S.particles` found by `strokeId`, the buffer is the stroke's source buffer, the region is `[earliest, latest]` of the surviving particles. `rebuildTrigger()` re-derives all of it (plus the bounding cap) whenever `S._particleVersion` moves, and drops the trigger when its material is gone. Erase, erase-all, undo, sweep and session import then work **with no special cases** — they operate on the particles and the trigger follows. `toolMode`, parking, `silenceTriggers` on mode change, the tool picker, disarm and its two actions were all **deleted**, not adapted.
  **Erase doubles as a sample editor** (Ek's correction to my proposal — I had suggested keeping playback whole on partial erase; he was right that trimming is the musical behaviour). Erasing the tail of a trigger stroke shortens the sample, erasing the head trims it, erasing all of it removes the trigger. A hole in the middle leaves the region spanning it: a contiguous region can't express a gap, and a segment list is machinery for a case a spatial brush makes hard to hit on purpose. Keeping the source buffer rather than an extracted crossfaded copy is what makes this instant — no re-extraction per erase tick. **The tradeoff to judge on the rig: `dwell:'loop'` now wraps on raw audio, so a loop point between dissimilar levels may click.** On a percussion hit the wrap is near-silence and it should be inaudible; on the sung do-re-mi-fa-so it might not be.
  **`trigMuted` is the counterpart of SCAN** — silences firing without touching a recording, with the same 0|1 value convention on the action so a controller means the same thing on both. The gate keeps running while muted so `_inside` stays accurate; otherwise unmuting bangs whatever the cursor is resting on. Same priming is why **a freshly recorded trigger doesn't fire itself** — you are by definition sitting on the stroke you just painted, and starting "outside" would bang on every placement. That one would have made placing triggers mid-performance unusable.
  **Recording a trigger deliberately does not mute scan** (Ek): you may be granulating a section and want to drop a trigger point into it. `trace+loop` still mutes — unchanged. **Sweep now keeps trigger strokes** for the same reason it keeps loop strokes: it discards material nothing is using, and a percussion map is in use.
  New bindable `trace_trigger` (hold, `/trace/trigger`) and `trig_toggle` (`/trigger/mute`) through the shared `ACTIONS` table, so ⇧space, a pad, a pedal and Max all reach the same code. Momentary only, and not folded into `recpaint`: latching a trigger recording would record until you noticed. Export: a trigger now serialises as **a strokeId plus its settings — no audio, no particles**, since both are already in the payload once; `p.trig` rides on the particle so the type travels with the material.
  **Verified — `trigger-audit.js` rewritten, 40/40.** New: both pool builders exclude trigger particles and include granular ones (radius *and* nearest mode — nearest ignores the radius, so the rule has to hold there separately); the trigger shares live particles rather than copying; a fresh trigger doesn't fire itself; mute silences, doesn't fire, keeps tracking, and doesn't bang on unmute; erase trims the region, partial erase keeps the trigger, full erase removes it. The typing checks run the **real** builders through a new `__testCandidatePool` seam in `grain.js` — `scheduleGrains()` returns early without a running AudioContext, which headless can't produce, and testing a reimplementation would have proved nothing. `browser-audit.js` 70/70 (three trigger payload assertions rewritten), `verify-action-ranges.js` 34 ok · 0 mismatched. Cost unchanged: **32 triggers × 200 particles = 0.0028 ms/tick**. Files: `js/trigger.js` (rewritten), `js/ui-trigger.js`, `state.js`, `grain.js`, `events.js`, `midi.js`, `osc.js`, `paint-ticker.js`, `renderer.js`, `ui-sweep.js`, `ui-presets.js`, `ui-export.js`, `ui-audio-settings.js`, `index.html`, `scripts/trigger-audit.js`, `scripts/browser-audit.js`, 4 docs.

- [x] **#184 Trigger playback params are live and global, not baked into the recording** — Ek: *dwell is a playback option after recording, not baked into the buffer — I should be able to switch mid-session, same with speed and volume.* Right, and the same argument applies to all of them, so `triggerDefaults` (copied into each trigger at creation) became **`S.triggerParams` — global, read at fire time**. Radius, hysteresis, rearm, dwell, start, release, speed and volume are all live: move a slider and every trigger changes at once. The recording supplies material and position; that is all it decides. A trigger entry now holds **only runtime state** (`_inside`, `_lastFireAt`, the bounding cap, what was last applied to the node), which is also why its session payload collapsed to a `strokeId` and a colour — the params ride once in the session's `live` block instead of being duplicated per entry.
  **`_applyLiveParams()` reaches a trigger that is already sounding** — `src.loop` for dwell, `playbackRate` for speed, the gain node for volume — so flipping dwell to `loop` while a one-shot rings makes it loop rather than waiting for the next hit. It compares against `_appliedVol`/`_appliedSpeed`, **not** the node's current values: the gain is mid-ramp for the first 35 ms of every fire (the click-free fade-in), so comparing against `gain.value` would see the ramp in progress and fight it every tick. Assertion added for exactly that — the params apply once, not repeatedly.
  Small bonus from the params no longer varying per trigger: the gate's two `Math.cos` calls moved out of the per-trigger loop and now run once for the whole set. `onTriggerSourceEnded` also stopped checking dwell — a source that reaches `ended` was genuinely a one-shot, since flipping to loop mid-ring sets `src.loop` on it.
  Verified: `trigger-audit.js` **48/48** (seven new — nothing baked in, radius live, speed/volume/dwell reaching a sounding trigger, applied-once), `browser-audit.js` 71/71 with the payload assertions rewritten (`trigger` entries carry no settings; params found in `live.triggerParams`), `verify-action-ranges.js` 34 ok · 0 mismatched. Files: `js/trigger.js`, `state.js`, `grain.js`, `renderer.js`, `ui-trigger.js`, `ui-export.js`, `ui-audio-settings.js`, `index.html`, both harnesses, 3 docs.

- [x] **#185 A trigger's reach is the cursor's search radius** — Ek: *why does trigger have its own radius? it should follow the search radius.* Right, and it was an inconsistency I introduced: **erase already follows `S.searchRadiusDeg`**, and so does loop-drop. It is the same cursor and the same physical gesture, so it has one reach — a second radius meant that gesture had two different sizes depending on what it happened to touch. `triggerParams.radiusDeg` deleted; the gate reads `S.searchRadiusDeg` and hysteresis multiplies *that*. **Consequence worth knowing on the rig:** riding the radius slider during a granular passage now widens every trigger zone at the same time. That is the honest behaviour of one cursor with one reach, but it does mean "how precisely must I hit the triangle" is no longer separable from "how wide is my granular scan".
  **The per-trigger halo came out with it.** The cursor already draws a brush ring at the search radius, so a same-size ring at each stroke said the same thing twice and implied a per-trigger zone that no longer exists. What remains is the decimated stroke outline (which stroke is a trigger, brightening on proximity) and a playhead ring on whatever is sounding — the outline is the part that was actually carrying information. Panel loses the radius slider and gains a `reach → search radius` row pointing at where it lives. Files: `state.js`, `js/trigger.js`, `renderer.js`, `ui-trigger.js`, `ui-export.js`, `ui-audio-settings.js`, `index.html`, both harnesses, 2 docs.

- [x] **#186 Erase only trimmed the head of a trigger; middle erases now split it in two** — Ek, playing it: *erase only works when I erase the beginning of the buffer, not the end or middle.* Real bug with a one-line cause. **A non-looping `AudioBufferSourceNode` ignores `loopEnd` and plays to the end of the buffer** — so a one-shot trigger played its whole source buffer from the offset onward. Trimming the head worked because the head *is* the `offset`; nothing was bounding the other end, so trimming the tail was audibly a no-op even though `loopEnd` moved correctly and the region test passed. Fixed by passing the third argument to `src.start(when, offset, duration)` for one-shots, in buffer seconds so it stays right as speed is ridden. Worth remembering: **`loopStart`/`loopEnd` do nothing unless `loop` is true**, which is exactly the case a region-bounded one-shot looks like it should use.
  **Erasing the middle now splits the trigger into two** (Ek's call, and the logical one — it *is* two sounds, and a region spanning the hole plays back silence you deliberately removed). The new segment gets **its own strokeId and its own trigger** rather than a trigger learning to hold a segment list: that keeps the invariant that a trigger is a view onto exactly one stroke, so rebuild/undo/sweep/export all keep working untouched, and it makes re-splitting structurally impossible since each half then collects only its own particles. A `strokeHistory` entry is pushed for the new id so undo and buffer cleanup still see a real stroke. Gap threshold is `max(50 ms, 4 × that stroke's median particle spacing)` — the relative half is the one doing the work, since paint rate follows the grain period and a fixed threshold would split a slowly painted stroke that was never cut. Single-particle runs are dropped rather than becoming triggers that fire a click.
  Five new assertions in `trigger-audit.js` (splits one into two, halves are distinct strokes, regions disjoint, stable under a further rebuild, neither half fires itself). **Not run** — Ek asked me to stop running the harnesses; syntax-checked only. Files: `js/grain.js`, `js/trigger.js`, `scripts/trigger-audit.js`, `docs/archive/TRIGGER-TOOL-PLAN.md`.

- [x] **#187 The real reason erase didn't bound playback: `grainDuration` is not a region length** — #186's `start(when, offset, duration)` fix was necessary but not sufficient; Ek retested and the first segment still played through the erased hole and past it. The duration was being applied correctly — **the region itself was wrong**. `_applyCluster` computed the region end as `max(grainStart + grainDuration)`, inherited from `buildLoopPayload`. That is right for a loop and wrong twice over for a trigger: `grainDuration` is the **granular grain length** (on a wash-type patch, seconds), and a trigger particle marks a **position in the recording**, not a length of one. So the end overshot by up to a whole grain — frequently past the end of the buffer, where the clamp made it exactly "plays everything".
  It explains all three symptoms precisely: `lo` is a pure `grainStart` so **head**-trimming always worked; `hi` was swamped by the grain length so **tail**-trimming did nothing; and after a split the first segment's end reached across the hole into the second half. Region end is now the last particle's position plus **one median spacing** — the material that particle actually stands for at the rate the stroke was painted. Median (not mean) so one erased hole can't inflate it, and the same helper feeds the split threshold, so the two agree by construction.
  **Why the tests didn't catch it:** the fixture used `grainStart: i * 0.05, grainDuration: 0.05` — spacing and grain length identical, so the two formulas produced the same number. Fixture now uses `grainDuration: 2.0` (realistic for a wash patch) with an assertion that the region end tracks the last particle, which fails loudly on the old maths. A reminder that a fixture where two different quantities happen to be equal tests neither.
  Syntax-checked only, per Ek. Files: `js/trigger.js`, `scripts/trigger-audit.js`, `docs/archive/TRIGGER-TOOL-PLAN.md`.

- [x] **#188 A new trigger plays once on release** — Ek: *the trigger-buffer should play the first time I record it, right? unless you took that off for a reason.* I had taken it off, and the reason was weak. `armTrigger` primed `_inside = true` so the trigger couldn't fire until you left and came back — I'd described the alternative as "a bang every time you place one", which is pejorative framing for exactly the confirmation playback he's asking for. It is **one** playback, not a runaway: the cursor is on the stroke it just painted, the first gate tick is an enter edge, and after that the normal enter/exit rules apply. Now `_inside: false, _lastFireAt: 0` at arm time.
  **The distinction that matters is placement vs edit.** `restoreTrigger()` (session import) and `_cloneTriggerShell()` (erase-split) both still start primed **inside** — those are edits, not placements, and neither should make noise on its own. Loading a session that immediately plays a dozen samples, or hearing the second half fire because you cut the first, would both be wrong. Same priming is what stops unmuting from banging whatever the cursor is resting on.
  Test flipped: was asserting the old behaviour (`a freshly recorded trigger does not fire itself`), now asserts it starts outside, plays once on the next tick with the cursor where it already is, and does **not** repeat while the cursor stays put. Syntax-checked only. Files: `js/trigger.js`, `scripts/trigger-audit.js`, 2 docs.

- [x] **#189 The release audition ignores `start: 'touch'`** — Ek: *when start is on "touch" this doesn't work, but it works when start is on top.* It was firing correctly — and playing about 20 ms. `start: 'touch'` begins wherever the cursor is, and **on release the cursor is at the END of the stroke you just painted**, so the offset landed on the last particle and the remaining region was one median spacing. Audible as nothing, which reads as "it doesn't play".
  Fixed by treating that first playback as what it is: an **audition**, not a performance hit. `_audition: true` at arm time forces top-of-region and is consumed on first fire; every hit after obeys `start` normally. The distinction is the point — `start` describes how a trigger answers the cursor *during play*, and the release audition isn't that, it's "here's what you just captured".
  **Related property worth judging on the rig:** `start: 'touch'` is inherently directional. Approach a stroke from its tail and there is little left to play. That is what 'touch' means, but on a turntable spinning one way you always approach from the same side — so if it reads as "quiet from one direction", `top` is the setting that ignores approach direction. Noted in a comment at the site.
  **Why the test missed it:** the audition check only ever ran with `start: 'top'`, where both code paths produce offset 0 and agree. Now the whole arm→fire sequence is repeated under `'touch'`, asserting the audition still starts at the top **and** that the next hit goes back to obeying 'touch' — the second half matters, or "fix the audition" could quietly become "break touch". Same shape of gap as #187's fixture, where two different quantities happened to be equal. Syntax-checked only. Files: `js/trigger.js`, `scripts/trigger-audit.js`.

- [x] **#190 `start: 'ends'` — playback direction follows the end you arrive at** — Ek's design, from playing it: `touch` is right for free movement, where the cursor can land anywhere in a stroke, but **a turntable only ever arrives at one end or the other** — and arriving at the tail under `touch` leaves nothing to play (that's #189's sliver, working as designed rather than broken). The new third mode always plays **in full, never from the contact point**, and lets the approach pick the direction: reach the front half and it runs forwards from the top; reach the back half and it runs **backwards from the very end**. On a turntable that makes playback direction follow spin direction, which is the musical point of it.
  Reuses the loop path's existing reverse machinery — `direction: -1` plus the cached `_revBuffer`, which grain.js already builds from `loopStart..loopEnd`. `startOffset` is 0 either way, because offset 0 in the reversed copy *is* the region's end. Front/back is measured in **buffer time**, not particle index, so an unevenly painted stroke splits at its true midpoint. The audition (#189) still forces top-and-forwards, since it isn't a performance hit.
  **One thing this exposed:** `_revBuffer` is cached and built from the region, so it goes stale the moment erase moves `loopStart`/`loopEnd` — a trimmed trigger played backwards would have kept playing the pre-erase audio. `_applyCluster` now drops the cache whenever the region changes. That bug was latent the whole time; it only became reachable once triggers could go into reverse. **The same staleness applies to loop commits** (`createSeqFromStroke` slots keep a `_revBuffer` too) — not reachable there today because a loop's region is fixed at commit, but worth knowing if loops ever become editable.
  Five new assertions (arriving front fires forwards from top; arriving at the tail fires reversed from the end with the playhead on the last particle). Syntax-checked only. Files: `js/trigger.js`, `index.html`, `ui-audio-settings.js`, `ui-export.js`, `scripts/trigger-audit.js`, 2 docs. **For the rig (#180): the open question is whether the front/back split is forgiving enough** — at 50/50 a sweep that stalls near the midpoint could pick either direction on successive passes. If that reads as unpredictable, a dead band around the middle (keep the previous direction) is the obvious next move.

- [x] **#191 `dwell: 'grain'` — stop on a trigger and it opens into a cloud** — Ek, wanting to granulate part of a trigger buffer mid-set, floated two mechanisms: press both record buttons together to type a buffer as both, or a third state on the triggers chip (`on | off | granular override`). I argued against the first and offered a third framing, which he took. **Pressing both at record is the weakest option**: the decision would be made *before* recording, but "sometimes I wanna stop on a part of a trigger buffer" is an in-the-moment want you can't predict at record time — plus it costs the never-both rule and needs a press-timing window, which is a flaky gesture on hardware.
  **The word doing the work was "stop".** Sweeping past fires it; stopping on it should open it up — and that distinction is exactly what the `dwell` row already owns. So it became a third dwell option rather than a new control: **`once | loop | grain`**, and the whole mental model is one sentence — *sweep past and it fires; stop on it and it does whatever dwell says.* No new surface, nothing to decide at record time, switchable mid-phrase like every other trigger param.
  **It needed almost no machinery, for a reason worth recording:** a trigger's zone IS the cursor radius (#185), so **any `trig` particle inside the radius necessarily belongs to a trigger the cursor is already inside**. The mode flag alone is therefore exact — no set of "currently dwelled" strokeIds, no per-particle lookup in the hot loop, just one hoisted boolean in the candidate-pool builders. **Nearest mode is the exception**, and the one place I had to be careful: it ignores the radius entirely, so a `trig` particle can be nowhere near the cursor and it checks proximity explicitly before letting one through.
  Consistency pass while there: only `'loop'` loops now. `'grain'` is a one-shot for the sample part (fires on entry, granulation is what dwelling adds), so `src.loop`, the one-shot duration bound, `_applyLiveParams` and `_onExit` all switched from `!== 'oneshot'` to `=== 'loop'`. The `release` row dims for `grain` too, since only a looping trigger has a stop to shape. **Interaction to know: grain dwell needs SCAN on to be heard** — it opens the material to the granular cursor, and the cursor is what scan gates. Said so in the tooltip and the docs.
  Five new assertions (both pools open under grain dwell, nearest still requires proximity, both close again on leaving). Syntax-checked only. Files: `js/grain.js`, `js/trigger.js`, `js/state.js`, `ui-trigger.js`, `ui-export.js`, `ui-audio-settings.js`, `index.html`, `scripts/trigger-audit.js`, 2 docs.

- [x] **#192 A 20-second take arrived as ~8 triggers — split by removal, not by gap size** — Ek recording a long trigger buffer got it chopped into about eight — **at record time, with no erase involved**. `armTrigger` runs the same `rebuildTrigger`, so #186's splitter fired on the very first pass. It thresholded on how big a time gap was, and the flaw is now obvious: **a gap in a stroke means two completely different things and its size cannot tell them apart.** *Never painted* — a rest, a breath, a decay sitting under `vizNoiseFloor`, all of which stop the paint ticker depositing — versus *erased*. Twenty seconds of ordinary phrasing is full of the first kind, and every one read as a hole.
  Rewritten to test the thing actually being asked about: `_clusterByRemoval` compares against the **previous particle list** and splits only where two survivors were *not adjacent before*, i.e. where something was genuinely removed. Exact, **threshold-free** — both magic numbers deleted, nothing left to tune or misfire — and an empty baseline (fresh recording, session import) never splits, so a take is always one trigger however it was played. Particles are the same live objects across rebuilds, so identity is available here; this is one of the few places in the codebase where it is (cf. [[mubone-loop-particles-are-copies]] for where it isn't).
  **The general lesson, which is the same one as #187:** I inferred a cause (a hole) from a symptom (a gap) when the cause itself was observable. Both bugs came from reaching for a heuristic over a fact that was right there.
  Three new assertions: a take with four bursts separated by 1 s pauses arms as **one** trigger, stays one across rebuilds, and spans the pauses. The erase-split assertions still hold — that test removes particles, which is exactly what now triggers a split. Syntax-checked only. Files: `js/trigger.js`, `scripts/trigger-audit.js`, 2 docs.

- [x] **#193 `retrig: cut | layer` — polyphony on a single trigger** — Ek: retriggering a 5-second buffer mid-playback restarts it from the top; there should be an option to stack instead. **`layer` needed no voice engine**, which is the whole story. A one-shot source already carries its own scheduled end (the `duration` argument from #186) and its own `'ended'` cleanup, so `_detachVoice()` just drops the node references *without stopping* — the trigger is left sourceless, the seq block builds a fresh one on the next tick, and the two sound together. The only bookkeeping is a small `_voices` array, and it exists purely so the oldest can be stolen at the ceiling (8, hard-coded — it's a memory guard, not a musical control; `rearm` is the musical limit on stacking rate) and so muting can reach them.
  **Two traps it created, both handled.** (a) **A detached voice ending would clear `playing` on its replacement** — the seq block's `'ended'` handler now passes the source and `onTriggerSourceEnded` ignores any node that is no longer current. Without it, an old voice finishing silences the new one, which would have looked like random dropouts under fast retriggering. (b) **Everything that silences a trigger has to reach the stack** — mute, erase-removal and clear-all all route through `stopTriggerAudio`, which now stops `_voices` first, or muting would leave layers ringing.
  **A stacked voice freezes its spatial position** — the per-tick VBAP update follows `_sourceNode`, so an older voice holds the bearing it was fired at. Flagged to Ek before building, and he took it as a feature rather than a limitation: hit the same buffer at different bearings and the stack spreads across the speakers. Live *volume* still reaches every voice, since a ride that moved only the newest of five would read as broken.
  Offered and declined: `hold` and `toggle` retrigger modes, per-hit direction alternation, per-voice speed drift, and a visible voice cap — all noted in the plan doc's scoped-out list rather than built. Eight new assertions (cut stops the old and stacks nothing; layer leaves it ringing, stacks a voice, clears the current source; a stale end is ignored while a current end clears; silencing takes the stack). Syntax-checked only. Files: `js/trigger.js`, `js/grain.js`, `js/state.js`, `ui-trigger.js`, `ui-export.js`, `ui-audio-settings.js`, `index.html`, `scripts/trigger-audit.js`, 2 docs.

- [x] **#194 `chop` — segment a traced gesture into a sequence of triggers** — Ek: trace a physical gesture while playing a phrase, have it auto-chop at the pauses, then retracing the path fires them in sequence and reproduces the phrase instead of one long buffer. He asked whether that's handsfree or a trigger-specific setting. **Neither, and the distinction matters:** handsfree is about *recording* — it stops and starts the mic capture on a gate, which is why it needs latched trace and why it doesn't meet momentary trigger recording. What he described is about *segmenting a take already made*, which needs no mode and no change to the gesture.
  **And the analysis was already done.** The paint ticker deposits nothing while the input sits under `vizNoiseFloor`, so **the gaps in a trigger stroke already are the silences in the phrase**. No transient detection needed — just a threshold on gaps sitting in the data. New `chop` param, ms of silence, 0 = off (default).
  **This is the same gap test #192 removed, and that's the point.** As an always-on heuristic guessing at erasure it was wrong and chopped a 20-second take into eight; as an opt-in chop it's exactly the tool. The code barely changed — what changed is **who decides**: a threshold the performer sets rather than a guess the code makes on their behalf. The audit asserts both halves against *identical material* — chop off → one trigger, chop 300 ms → four — which is the pair that makes the distinction real rather than asserted.
  **Two rules keep it from fighting the erase-split.** (a) **Record time only** — `_clusterByRemoval` runs on every rebuild, chop runs once at arm; a deliberate act and an edit stay separate. (b) **Every run gets its own strokeId, including one-particle runs that don't become triggers** — leaving a stray singleton on the original id would put it back in run 0's trigger, and since a trigger collects by strokeId that region would stretch across the whole take again, undoing the chop invisibly. That one would have been very hard to see.
  Refactor while there: `_assignSegmentIds()` and `_newTriggerShell(strokeId, audition)` are now shared by chop and the erase-split, replacing `_cloneTriggerShell`. The `audition` argument is where placement-vs-edit lives — a chopped segment auditions (it's a placement, and only the segments under the cursor actually fire), an erase-split segment doesn't. Four new assertions. Syntax-checked only. Files: `js/trigger.js`, `js/state.js`, `ui-trigger.js`, `ui-export.js`, `ui-audio-settings.js`, `index.html`, `scripts/trigger-audit.js`, 2 docs.

- [x] **#195 Chop gets a bindable hard switch** — Ek wanted chop on a physical control, in keys/midi/osc. Split into **`chopOn` (the switch) + `chop` (the ms threshold)** rather than overloading `chop: 0` as off: the value you dialled in survives being toggled, and the binding is a plain switch with nothing to remember. Default flipped from `chop: 0` to `chopOn: false, chop: 300`, so turning it on does something sensible immediately. New `trigger_chop` action (OSC `/trigger/chop`), same 1/0/bang convention as `scan_toggle` and `trig_toggle`. Panel: `chop` off|on chips plus a `gap` slider that dims when off.
  **Caught a real trap in `osc.js` on the way in.** It has a `_VALUED_TRIGGERS` set for addresses whose case reads `values[0] ?? 127` — for those a `0` is a *command*, not a release edge, and the § O2 release-edge guard has to be told so. `/trigger/chop` reads its value, so without adding it, **`/trigger/chop 0` (chop off) would have been silently swallowed** as a release edge while `1` worked fine. Exactly the asymmetric-bug shape that audit was written about; the set exists because `fmt` isn't a reliable discriminator. Anything added later that decodes its OSC payload needs the same entry.
  Two new assertions (the switch turns chop off without losing the gap value; the same material then arms as one trigger). Syntax-checked only. Files: `js/trigger.js`, `js/state.js`, `js/midi.js`, `js/osc.js`, `ui-trigger.js`, `ui-export.js`, `ui-audio-settings.js`, `index.html`, `scripts/trigger-audit.js`, 3 docs.

- [x] **#196 A real record button in the trigger panel** — Ek wanted the ⇧space recording to have a proper button like trace / scan / erase, not an info row saying which key to hold. `#trigRecordBtn` reuses the `play-mute-btn paint-indicator-btn` shape the trace indicator uses — icon, centred label, right-side key badge — and comes out 278×36 against trace's 275×36. Momentary via pointer-capture, the same shape `eraseHoldBtn` uses so dragging off the button mid-take still releases cleanly instead of leaving it recording.
  **The point of the change was to avoid a third implementation.** `startTriggerRecord()` / `stopTriggerRecord()` are now one pair in `events.js`, reached by the button and by the bindable `trace_trigger` action — the MIDI case had been a hand-rolled copy of the recording sequence and is now four lines. The #166 rule: a pad, a pedal and the mouse must not drift apart. **⇧space deliberately keeps its own flow**, because it is woven into trace's tap-toggle, D-loop hand-off and handsfree handling and pulling it out would mean reimplementing all of that — but both routes converge on the same two facts (`_recordingTrigger` set while painting, `armTrigger` on release via `_commitTraceStroke`), which is the part that has to agree. `armTrigger` is no longer imported by `midi.js` at all.
  Two details found by looking rather than assuming: the `.painting` red-record styling is **id-scoped** to `#paintIndicatorBtn` (each button using the class carries its own accent — trace red, commit blue/pink), so the new button needed its own rule and a `cursor: pointer` since unlike the trace indicator it is actually pressable. And the panel hint was repeating the button — "hold ⇧space to record one" above a button that says exactly that — so it now carries the count only. Verified headless: renders at trace's dimensions, lights red from a forced recording state, zero page errors. Files: `index.html`, `css/style.css`, `js/events.js`, `js/midi.js`, `js/ui-trigger.js`.

- [x] **#197 LED feedback for a trigger firing** — Ek wanted something on the x-imu3 LED that's unmistakably "a trigger launched", distinct from the scan timbre. Three findings shaped it. **(a) Every transient row is `flash`** (90/120ms), so colour and count were the only axes — not enough to make a trigger unlike everything else. **(b) Message cost is a real constraint**: a flash runs ~9.5 msg/s and on WiFi shares the radio with inbound frames, which the module header records as having dropped samples once already; triggers fire far more often than commits. **(c) There is a mutex that DROPS events** — `_runEvent` refuses to start while a sequence runs, so sweeping past three triggers would show only the first.
  So: new **`strike`** pattern — one 45ms full-brightness stab, then straight back to baseline. At count 1 (the default) that is exactly **two messages**, the cheapest thing available, and it reads percussively rather than as a blink. New `trigger` event row in **electric cyan `#00E5FF`**, the one hue no existing row uses (the palette already has green, red, pink, blue, purple, gold, teal, indigo, white). Fired from `_onEnter` on the gate edge rather than where the source node is built, so the LED marks the moment you crossed the zone, not the tick when the audio graph caught up.
  **Rows can now be `priority: true`**, and `trigger` is the first: it cancels an in-flight sequence instead of being dropped as busy. A trigger firing is the performer's primary action feedback — "the commit flash is still running so you don't get to see your trigger" is backwards. `_cancelSequence` bumps the epoch, so the displaced sequence bails at its next await and can't clear the mutex out from under the new one (that guard already existed).
  Defaulted **on**, against the "new rows default off" convention — that convention protects users who'd be surprised by a strobe after an update, and Ek asked for this one. **Corrected my own comment mid-build:** I'd written that the modal's msg/s figure was a special case for strike, then realised the number it prints is the same while-running figure every pattern quotes. Gave strike a 105ms off so a count>1 strike is a fast double-tap rather than a 44/s strobe, and rewrote the comment to say what's true. Verified headless: pattern registered, row present and `event` kind, offered to event rows and not to states, default map correct, `LED_ROW_PRIORITY` = `['trigger']`, 13.3 vs flash's 9.5 msg/s, zero page errors. **Not built, worth deciding on the rig:** whether a `dwell: loop`/`grain` trigger should hold a LED *state* while sounding, rather than only stabbing on launch — it would need a priority rule against the scan/trace states for the single baseline slot. Files: `js/ximu-led-feedback.js`, `js/trigger.js`.

- [x] **#198 LED stabs on every loop wrap, not just the launch** — Ek: a looping trigger should flash each time it comes round. It is the same musical event as the launch (a sample starting), so it uses the same `trigger` row rather than a second one. **The wrap index falls straight out of the playhead maths already in the seq block** — `Math.floor(elapsed / loopLen)` next to the `elapsed % loopLen` that was already being computed — so nothing extra is calculated in the 20 ms tick. Detection is at worst one tick late, which is under the threshold for noticing a light is late.
  **Three things that had to be right.** (a) **Scoped to `dwell === 'loop'`**: a one-shot's `elapsed` keeps growing past `loopLen` after the audio stops, so unscoped it would report phantom wraps in the window before `'ended'` clears `playing`. (b) **`_wrapIdx` resets whenever a new source starts** — `elapsed` restarts at zero, and a stale high index would mean the comparison never fired again for the rest of that trigger's life. (c) **Rate limit.** Both call sites now go through one `ledTriggerFire()` with a 120 ms floor: the trigger row is `priority`, so an unlimited fast loop would cancel whatever else was showing on every wrap and make commit/undo/tare feedback invisible for as long as it ran. Consequence worth knowing — **a loop shorter than 120 ms won't flash every wrap.**
  Verified by transcribing the block into a plain Node script and fuzzing it (the CLAUDE.md approach for scheduler-side logic that can't be driven headless): a 1 s loop fires at 1/2/3/4 s; at 2× speed every 0.5 s, so playback rate is honoured; a one-shot never fires; and a restart mid-flight resumes wraps against the new start instead of losing them. Files: `js/trigger.js`, `js/grain.js`.

- [x] **#199 Two fades were eating trigger attacks — one of them destructively** — Ek recording clean loops with a loud first beat couldn't hear the top of the loop. There were **two** fades stacked, and the worse one is not in the trigger code at all.
  **(a) Playback, `grain.js`: a 35 ms linear fade-in on every source node start.** Inherited from the loop path, where it prevents a click. A woodblock or triangle attack lives entirely inside 35 ms, so the beat arrived soft and late. Triggers now get **3 ms** (~144 samples at 48k) — enough to stop a click when playback starts mid-waveform, which `start: touch` and `ends` both do, short enough to leave a transient alone. Loops keep 35 ms: nothing about a loop start is an attack.
  **(b) Recording, `audio.js`: a 50 ms SQUARED fade written into the samples.** This is the real culprit and it is **destructive** — baked into the buffer at seal time, so whatever it removed was gone for every later use of that take. Squared means 25 ms in you are still 12 dB down. Hit record, play a loud first beat, and the attack was permanently buried before any playback fade touched it. Now **5 ms**, which is what a declick actually needs.
  Measured, combined gain on a transient N ms into a take — **1 ms: −98.8 → −37.5 dB · 5 ms: −56.9 → 0 dB · 10 ms: −38.8 → 0 dB · 20 ms: −20.8 → 0 dB**. Everything from 5 ms on is now untouched.
  **(b) changes shared behaviour, not just triggers** — every live recording is sealed through that path. It should be an improvement everywhere (grains carry their own envelopes and mostly read the middle of a buffer; `buildLoopPayload` bakes its own 30 ms crossfade for loops), but it is the one edit here that isn't scoped to the trigger tool, and it is a one-number revert if a click turns up somewhere unexpected. **Not changed: the one-shot END.** A trigger stops dead at its scheduled duration with no ramp — the region normally ends in gated silence so it should be clean, but a region trimmed mid-waveform by erase could click. Left alone because scheduling a ramp against an end time that moves when `speed` is ridden is fragile; worth listening for. Files: `js/grain.js`, `js/audio.js`.

- [x] **#200 The start declick now applies to loops too** — Ek, asking why loops have a crossfade and worrying it would eat a woodblock on beat one. **It doesn't** — `buildLoopPayload`'s 30 ms crossfade blends only the *tail* toward the value of the first sample, so the wrap has no step discontinuity; the head is explicitly untouched. That part was already fine and stays.
  What *was* softening beat one is the 35 ms playback fade-in, and #199 had left it in place for loops out of conservatism. Two arguments say it shouldn't be: 35 ms is a fade, not a declick, by the same reasoning that made the 50 ms recording fade wrong; and for a loop **it applied to the first pass only** — the native wrap changes no gain — so a loop opening on a hit gave one soft beat and correct ones from the second time round. Inconsistent between passes is harder to play against than either behaviour alone. Unified on the 3 ms declick, constant renamed `TRIGGER_DECLICK_S` → `DECLICK_S` since it is no longer trigger-specific.
  **Deliberately NOT built: a wrap crossfade for trigger loops.** Loop commits get `buildLoopPayload`'s baked 30 ms tail blend; trigger loops play the raw source region and so have **no wrap treatment at all**. In practice both ends of a trigger region tend to sit near zero — `loopStart` is the first particle, i.e. where the noise gate opened, and `loopEnd` is one median spacing past the last, i.e. back in gated silence — so a click is unlikely, which is why this was left. If it does click on the rig, the fix is a short scheduled gain dip at each wrap (the wrap times are already known — the LED wrap detector in #198 computes them) on a **dedicated gain node in series**, not the volume node: `cancelScheduledValues` from a live volume ride would otherwise wipe the dips. Files: `js/grain.js`.

### Aug 2

- [x] **#176 1.12 alpha release prep** — Version bumped in `index.html`, `package.json`, `sw.js` `CACHE_VERSION` and the CLAUDE.md header + versioning section (all four release-checklist items). CHANGELOG entry covers **#147–#175** — four sessions, Jul 29 → Aug 1 — grouped by theme rather than by session, with a **Not yet verified** section carrying the unrun checklists forward. `APP_SHELL` completed (#172), the stale `.git/index.lock` cleared, and `js/.fuse_hidden*` added to `.gitignore` — those are FUSE tombstones left by in-place edits on the mounted repo, not source files, and they can't be deleted from inside the sandbox. **One gap found while writing the entry: the x-imu3 settings enforcement work had no TODO item at all** — it's now **#175**, written from the code and `docs/XIMU3-SETTINGS.md`. Committed but **not pushed**; `git push` is Ek's call. Untracked scratch left out of the commit deliberately: `max/radius.js`, `max/radius-panel.maxpat`, `max/radius-probe.maxpat`, `max/plate-analysis.js`, `max/x-imu3pia.maxpat` and `max/x-imu3 copy.maxpat` — decide whether the radius/plate probes are keepers before they accumulate, and note that `docs/XIMU3-SETTINGS.md` § "Known conflict" refers to the two untracked x-imu3 patch variants, so that section reads as dangling to anyone with a clean checkout.

### Aug 1

> Three separate sessions landed on Aug 1: the UI/UX pass (#162–#174), the reset/export work (#157–#161), and the x-imu3 settings enforcement (#175). No overlapping files except `main.js` and `index.html`; the combined tree was re-verified headless after all three landed.

- [x] **#162 Default layout + default collapse state** — `DEFAULT_PROJECTOR_LAYOUT` in `events.js` now matches Ek's arrangement: `canvasPos: 0` with `audio/session` and `play/erase` nested under the canvas, then `envelope/preset/search`, `grain`, `commit`. (`erase` wasn't in the old default at all — it was reaching col 4 via the unlisted-tile fallback.) Cloud morph ships collapsed. **The enabling fix is in `main.js`:** the section-collapse restore only ever *added* `collapsed`, so a markup-collapsed section could never be persistently expanded — open it, reload, and it snapped shut. A stored value now overrides the markup in **both** directions, which also un-sticks `hfGate` in the audio modal (same latent bug). Verified headless with empty localStorage. Files: `events.js`, `index.html`, `main.js`. Shipped in 1.12 alpha.

- [x] **#163 Backdrop click closes every modal** — LED and accessory could only be dismissed from ✕ or Escape. Rather than patch each module, one delegated handler in `main.js` covers all 12 `.mu-overlay`s and any future one. It routes through the ✕ (as the Escape handler already did) so per-modal cleanup — metering, live-tick timers, row highlights — still runs, then drops `.open` as a fallback: the patch table wires its ✕ lazily on first open, so a click can land on a button with no listener yet. Modals with their own backdrop handler no-op through it (theirs runs first; the `.open` re-check sees it already closed). Verified all 12 close on backdrop and none closes on a click inside the dialog. File: `main.js`. Shipped in 1.12 alpha.

- [x] **#164 LED → "feedback", auto-on with sensor** — Footer button relabelled `○ feedback` / `● feedback` (tooltip said "click to enable", untrue since it became a modal opener). **Feedback arms itself when a cursor-role sensor connects**, on the null → sn *transition* only so repeated `sensor-status` events don't fight the toggle: off lasts until the sensor drops and returns (Ek's call — "off sticks until next connect"). A frame-role sensor doesn't arm it. Files: `ximu-led-feedback.js`, `ui-led-map.js`, `index.html`. Shipped in 1.12 alpha.

- [x] **#165 Accessory button shows data flow** — The A8 is passive, so the button reports presence instead of offering a toggle: `○ accessory` dim when nothing arrives, `● accessory` white when it does, matching the feedback button beside it. Presence rides the registry's **existing 250 ms watchdog** as an edge-triggered callback (`onAccessoryPresenceChange`) rather than a second always-on timer near the grain scheduler — idle cost is one boolean compare per tick. Verified: grey at boot, white within ~250 ms of data, hollow after the 500 ms stale window, re-arms on replug. Files: `accessory-registry.js`, `ui-accessory.js`, `index.html`. Shipped in 1.12 alpha.

- [x] **#166 New bindable actions — octave shortcuts + momentary mute** — Four rows in keys/midi/osc, all available to accessory `button` pads. **`pitch_oct_down` / `pitch_oct_reset` / `pitch_oct_up`** (`/grain/oct/down|reset|up`) are *triggers*, not a cc — a pot sweeping pitch is already `grain_pitchshift`; a pad wants the discrete jump. The button logic moved into one `S._pitchOctave(dir)` in `ui-presets.js` that both the panel buttons and the dispatcher call, so a pad lands on the same clamped value instead of the dispatcher faking a click. **`mute_hold`** (`/mute/hold`, type `hold`) is a cough-button mute: release restores the state **at press time**, so tapping it while already muted by **M** doesn't open the output mid-set. Press state lives on `S` because press and release can arrive from different transports — the accessory watchdog synthesises a release for every held action on unplug, which lands here as a 0; a stray release with no press is a no-op. `_holdActionIds` and the accessory dropdown filter both derive from `ACTIONS`, so no extra registration. Doc fix found on the way: the README OSC table still called `/grain/pitchshift` semitones (#154 made it cents). Files: `midi.js`, `osc.js`, `ui-presets.js`, `README.md`, `docs/KEYBOARD-SHORTCUTS.md`. Shipped in 1.12 alpha.

- [x] **#167 Tare naming unified + registry's dead tare removed** — Ek couldn't tell `tare cursor` (session panel) from `zero heading` (sensor modal). They're unrelated: the panel button is `captureTare()` aimed at the cursor-role device — **the same operation as the modal's "capture tare"** — while zero heading is a firmware AHRS yaw reset that deliberately *clears* tare (both live = a −45° double-correction, see the comment in `imu-setup.js`). Modal button relabelled **`tare sensor`** so both read as one verb differing only in target; `cursorZeroTopBtn` → **`cursorTareBtn`** so "zero" only ever means the hardware reset. **Removed `slotTare()` / `slotClearTare()` / `_isFlatMount()` from `sensor-registry.js`:** no caller, *and* they could not have worked — `setFeeding()` in `imu-setup.js` nulls `quatCal.tareQuat` + `tareRollOffset` on every connect, because imu-setup owns calibration and the registry passes data through. With them went the `_pendingRecenter` branch in `renderer.js` (per-frame work in the render loop that could never fire) and `S._onTare` in `main.js`. **`applyTare()` and the `tareQuat` reads STAY** — inert on null, and `tareQuat` is still in the persisted calibration schema; don't drop it from there (`mubone_sensor_cal_v` is the key whose omission from the settings export silently rewrote frame-role sensors, #136). Verified the sensor camera path still tracks injected quaternions with no page errors. Docs corrected: `TARE-RECENTER-ZERO.md` (new zero-heading section, the two entry points, tare auto-cleared on axes-alignment change), `mubone-architecture-notes.md` (tare-strategy section banner-flagged HISTORICAL), `EULER-VS-QUAT.md` (its "with Euler input" column now describes shipped behaviour). Files: `sensor-registry.js`, `renderer.js`, `main.js`, `ui-imu-setup.js`, `index.html`, 3 docs. Shipped in 1.12 alpha.

- [x] **#168 Tare button feedback** — Tare is silent and instantaneous, so `` ` `` was indistinguishable from an unbound key. The session button now flashes `✓ tared` (green, `sweep-flash`) on success and **`no cursor sensor` (orange) when there was nothing to tare** — the miss is the case worth knowing about mid-set, the same honest-signal rule the LED dispatch follows. Placed at the end of `tareCursorFn`, which every entry point (click, `` ` ``, MIDI, OSC) binds directly. Guards a re-entrancy trap: mashing the key would otherwise snapshot `"✓ tared"` as the label and restore *that* permanently. File: `ui-imu-setup.js`. Shipped in 1.12 alpha.

- [x] **#169 Camera mode → segmented picker, modal deleted** — The top bar showed the current mode as a word (`◉ pull`), which read as a status readout rather than a selector. Now a `.grain-seg` three-chip picker (`pull | surface | sensor`) reusing the panel vocabulary, teal active chip. **`cameraModal` is deleted** — nothing would have opened it; its per-mode descriptions became the chip tooltips, and the sensor chip's tooltip picks up the live 1-vs-2-sensor state the modal's subtitle used to carry (written to `data-title`, not `title` — `ui-learn.js` relocates any `title` it sees, so reading one back never works). Chip click is still the user gesture surface mode's pointer-lock request needs. **The chips inherit the panel styling with exactly one override** (`.grain-seg`'s `margin-left: auto`, which would otherwise shove them to the far edge away from their label) — verified computed font-size / padding / height / radius / min-width and the active colour + background all match `#gcDirSeg` byte for byte. The `camera` label is styled as a `.grain-label`, not a button, and lost its icon: as a chip with an icon it looked pressable and wasn't. **New: entering surface mode raises a transient banner** (`#surfaceEntryHint`) naming the key that gets you out — `⌥ option` to free the cursor, `Esc` to release the lock. The pre-existing `#surfaceLockOverlay` is the opposite case (lock already lost, "click to re-enter"); nothing told you how to *leave*. A banner, not a dialog: something you must dismiss is the wrong thing to put in front of a performer who just changed camera mode. `pointer-events: none` so it can't swallow a canvas click, auto-fades at 4s, and is torn down early if the mode changes first. Holds **12 s** (4 s was long enough to notice, not to absorb) and Alt dismisses it early — using the key is proof the message landed. Verified: shows on entry, re-shows on re-entry, removed on leaving, Alt retires it, no top-bar overflow at 1600/1100/800/520/430.
  **Canvas overlays now travel with the canvas (#141, third occurrence).** Both surface overlays were appended to `#canvasWrapper`, which `setProjectorLayout()` empties and collapses to `height: 0; overflow: hidden` — the default layout. They were in the DOM with every computed style reading "visible" and zero pixels on screen. Two distinct paths: the entry banner resolved its host at call time (fixed with `_canvasHost()`, which follows `S.canvas.parentElement`), while the **boot** overlay had an ordering bug — `main.js`'s persisted-surface check runs synchronously after `setupEvents()`, but `setProjectorLayout(true)` runs in a rAF *after* it, so the overlay was created in the right place and then orphaned when the canvas moved. `setProjectorLayout` now carries `perfMonitor`, `surfaceLockOverlay` and `surfaceEntryHint` into the mini tile. Listed by id, not "move every child" — the HUD, drop overlay and first-run hint are positioned against the wrapper and must stay. **This means the "click to re-enter surface mode" recovery screen had been invisible since projector became the default layout**, so losing pointer lock left no way back in. Lesson for the harness: asserting presence + `opacity` passes for a clipped element; assert the painted box against the host's box instead.
  **Persisted surface mode keeps its selection at boot** (Ek's call, once the overlay was visible again): the chip stays on `surface` and the overlay explains the un-armed state, rather than silently falling back to pull. A user gesture is required for pointer lock either way, so the click is unavoidable — this way it also tells you where you are.
  **Alt-lock now raises the full-canvas overlay too.** The `pointerlockchange` handler explicitly skipped the alt-locked case, so pressing Alt in surface mode left a free cursor, a frozen camera and nothing on screen saying how to resume — the most common way to leave the lock was the one case with no affordance. Now one rule: *in surface mode, no pointer lock ⇒ show the way back in.* The overlay carries **two copies** — "click to re-enter surface mode" for a dropped lock, "cursor freed — the UI is yours / click here or press ⌥ option again" when it came from Alt, since telling someone who just pressed Alt to use Alt describes what they did. Clicking it routes through the new shared **`_releaseAltLock()`** rather than `_requestSurfaceLock()` alone: recapturing the pointer while `S.altLocked` stayed true would leave the indicator lit and the camera frozen. Raised directly from the Alt branch rather than relying on the `pointerlockchange` that `exitPointerLock()` triggers — that event only fires if the lock was actually held, and alt-lock is reachable from states where it wasn't; the event path still runs and no-ops on the early return. Verified: Alt → overlay + alt copy + indicator lit, click → all three clear together, Alt/Alt round trip, and pull mode never raises it. Files: `index.html`, `main.js`, `events.js`, `style.css`. Shipped in 1.12 alpha.

- [x] **#173 Speaker sweep follows master volume** — The sweep was fixed at `vol = 0.06` and was **the one sound in the app the master slider couldn't touch** — in Electron. Cause: `playSweepChannel()` connects straight to the ChannelMerger, bypassing `S.speakerBuses`, whose gain is where master lives (deliberately — the sweep must bypass VBAP and downmix to prove a *physical* channel). The browser path was already correct: it connects through `getMasterBus()`, so master applied there all along. Fixed by scaling the Electron call by `S.outputGainValue`, and **only** that call — scaling the browser path too would apply master twice. Read per burst rather than hoisted, so the slider is live while the sweep loops and Ek can ride it down to a comfortable identification level. **Base level cut 0.06 → 0.03 → 0.015** over two rounds of Ek listening on the actual rig. White noise is broadband, so it reads far louder through a PA than the same nominal gain of granulated material; the original value had only ever been judged on a laptop. Net at his usual −6 dB master: **−42.5 dBFS, 8× quieter than this morning's fixed −24.4 dBFS**, and the slider now takes it further either way. That is the right order for "identify which box is making noise" rather than "test the system", which is how the level had been behaving. **Button moved directly above the master vol row** (it was two rows below, past the status strip) — the control you reach for while the sweep loops should be the next thing down. Tooltip added; it had none. Files: `ui-audio-settings.js`, `index.html`. Shipped in 1.12 alpha.

- [x] **#172 Release chores + a stale git lock** — Both done as part of the 1.12 release (#176). All three modules `browser-audit.js` reported missing are in `sw.js` `APP_SHELL` now — `js/scale.js` (flagged in #155), `js/storage-registry.js` (#157) and `js/ximu-settings.js` (#175) — and the checklist command reports the shell complete. The zero-byte **`.git/index.lock` dated Jul 31 10:55** was a crashed or interrupted git process, not a live one: no `git` was running and the file was empty, so it was removed. If one appears again while a git command *is* in flight, leave it.

- [x] **#157 Reset — per-category, backed by a storage registry** — Started as "add more *keep my ___* checkboxes to factory reset", became an audit of what reset actually did. **It was `localStorage.clear()` plus one restore of `mubone_user_presets`** — deliberately list-free, because an enumerated key list rots (`main.js` even said so, citing the export's `STATIC_KEYS`). There is **no "defaults" mechanism and shouldn't be**: defaults are whatever the modules initialise to on a cold boot, so per-category reset is just *delete those keys and reload*. Don't add an apply-defaults-live path; the reload IS the mechanism. **The dialog is now framed as "reset these", not "keep these"** — all boxes unchecked, confirm disabled until one is ticked, and a `select all + clear offline cache` row that is the old factory reset (only that path tears down Cache Storage + the service worker, and only that path uses `clear()` so unregistered keys go too). Button renamed `factory reset` → `reset`, id `factoryResetBtn` → `resetBtn`.
  **New `js/storage-registry.js`** is the single authoritative key→category table (35 keys, 8 categories, plus prefix entries for `mubone_panel_*` / `mubone_sec_*` and a `LEGACY_KEYS` list for keys a migration deletes). Three consumers read it: the reset dialog, the settings export, and `browser-audit.js`. It exports `unregisteredKeys()`, which is the whole reason a list is safe to own this time — **the audit boots the app and fails if any live key isn't registered**, and the dialog itself warns about orphans rather than silently making them un-keepable. Add a key to a module and the registry in the same commit.
  **Three real bugs surfaced.** (a) **`mubone_audio_defaults` was a grab-bag** — it carried viz calibration, `darkMode`, the seed settings, `activePresetIndex` and `sensor3Cal` alongside audio, so no honest "audio settings" category could exist. Split into `mubone_audio_defaults` + **`mubone_seed_settings`** + **`mubone_viz_calibration`** (category `ui`) + **`mubone_active_patch`** (category `patches`), with a one-shot migration (read old → write new → strip, guarded on a moved field being present rather than a version counter, so a second run is a no-op). (b) **`darkMode` had two writers** — `ui-viz.js` (`mubone_darkMode`) and the blob; load order decided which won. Dropped from the blob, ui-viz is now sole owner, and the audit asserts it still writes the key. (c) **the audio auto-save dirty check had drifted from the save** — `_buildSettingsSnapshot()` omitted all nine handsfree fields, `recLimitSeconds` and `sensor3Cal`, so **changing only a handsfree setting or the recording limit never marked state dirty and was never persisted** until something unrelated changed; inversely it watched `fovDeg`, which `ui-viz.js` owns. Both paths now consume one `_buildPayloads()`, so a field can't be saved-but-unwatched again — don't reintroduce a second builder here.
  **`sensor3Cal` dropped from persistence entirely** — nothing in the app ever assigned to it (`gesture-window.html` only reads it off live `S`), so it could only ever be the `state.js` default. If a UI for it lands, add persistence back deliberately, under `sensor`.
  **Export: `STATIC_KEYS` deleted**, derived from the registry instead — closes the refactor #137 deferred. The hand-written list had drifted *again* since the July audit: **`mubone-accessory-a8`, `mubone-ximu-led-map`, `mubone_midi_input` and `mubone_preset_layout_v` were all missing**, so a setup export carried none of the A8 accessory config or the LED map, and omitting the `mubone_preset_layout_v` schema flag meant an import would re-run the #156 preset-index migration against already-migrated pins. `debug` is the one excluded category (a shared setup shouldn't carry someone else's diag snapshot). `EXPORT_VERSION` 3 → 4: generated-name keys moved from separate `_panels`/`_sections` objects into one `_prefixed` bucket, and `applySettingsPayload` reads all three so v1–v3 files still import.
  **Schema flags now carry a `guards` list**, found by asking what a *partial* reset breaks. `mubone_preset_layout_v` gates `migratePresetIndices()`, but its three data keys span `patches`, `mapping` **and** `ui` — so resetting patches alone would have deleted the flag while the radial pins and desktop morph survived, re-running the #156 old→new index remap over already-remapped indices. Silent corruption dressed up as a reset. `keysFor()` now withholds any flag whose guarded data isn't all going with it (a stale flag is harmless — the migration just stays skipped; a dropped one is not). `mubone_sensor_cal_v` gets the same treatment even though its data key shares its category.
  **Verified headless** — `browser-audit.js` § reset rewritten from 5 checks to 20, all passing: registry drift, darkMode ownership, the full blob migration (values reach `S`, land in the new keys, and are stripped from the old blob, with untouched audio fields proven untouched), dialog shape, confirm gating, a **partial reset clearing exactly its category and leaving the other four alone**, both directions of the schema-flag guard, and select-all still reaching the cache + service worker. `verify-action-ranges.js` 33 ok · 0 mismatched · 2 skipped — one fewer than #155 recorded because #156 removed the `preset_select` cc row; not a regression. Files: `js/storage-registry.js` (new), `ui-audio-settings.js`, `ui-export.js`, `main.js`, `index.html`, `css/style.css`, `scripts/browser-audit.js`. Shipped in 1.12 alpha. **Release follow-up: `js/storage-registry.js` must go into `APP_SHELL` in `sw.js`** — the audit reports it missing alongside `js/scale.js` and `js/ximu-settings.js`.

- [x] **#159 Export/import audit #2 — the pre-v4 payload normaliser** — Second audit of `ui-export.js` after #151/#155/#156/#157: **`docs/EXPORT-IMPORT-AUDIT-2026-08.md`** (CURRENT; the July doc's *format* section and its § D reasoning are now superseded, banner added). Three fixes, `EXPORT_VERSION` 3 → 4.
  **E1 was data loss that #157 introduced the day before, found by asking what happens to an old file.** The blob-split migration was written for "migrate my own storage, once" and carried a don't-clobber-existing-destination guard — correct there, wrong for import. `applySettingsPayload` wrote the payload's keys first (a v1–v3 file has the old blob and **none** of the four successor keys), then `loadAudioDefaults()` ran the split over localStorage, where the successor keys already existed → **the guard skipped the write while the strip still deleted the fields from the blob**, so importing any pre-v4 setup or session file silently discarded its seed settings, viz calibration and active patch. Fixed by making the migration store-agnostic — `splitLegacyAudioBlob(store, {overwrite})` + `objectStore()` in `ui-audio-settings.js` — and normalising the **payload** before any key is written, with `overwrite: true` because an import is an explicit instruction to take the file's values. In-place migration keeps `overwrite: false`. Lesson recorded in the doc: **a migration for "my storage, once" is not automatically right for "a file from elsewhere"** — they differ in who wins a conflict; normalise on the way in. Also: per-field fallbacks handle *added* fields and cannot handle a key being *split or renamed*, so the version gate is not what protects you there.
  **E2: session import was applying about 4 of ~30 settings.** A session import deliberately never reloads (that would discard the material it just restored), so only settings with a runtime re-apply path take effect — you'd get the imported audio with your *own* key map, sensor calibration, mappings and UI scale, then a surprise personality change on the next restart, with the dialog saying an unqualified `session loaded`. Now calls every loader that exists (`loadMappings`, accessory `loadConfig` + `renderAll()` so an open table notices, `loadStaging`) and reports the remainder: new `RESTART_ONLY` table + `pendingRestart()`, surfaced in the summary dialog as "Applied on next restart: …". `RESTART_ONLY` is **hand-derived from module read sites, not from `storage-registry.js`** — the registry knows a key's category, not whether a re-apply path exists. `mubone_gesture_panel` and `mubone_radial_pins` were in neither list, which is how the gap was found.
  **E3:** `applySettingsPayload` wrote values unvalidated — a hand-edited file with an object stringified to `"[object Object]"`, poisoning the key so every later `JSON.parse` threw and the module fell back to defaults (reads as "import did nothing"). Non-strings now skipped with a warning; write failures logged rather than swallowed.
  **Left open, with recommendations in the doc: E4** settings-in-session is a design tension not a bug (recommend *decoupling* — a session carries material + performance state, settings are always a separate file; the "one file installs a rig" promise is what a setup file already is, and the two-phase-handoff alternative needs a storage tier that contradicts the localStorage-only invariant). **E5** settings import is a merge not a replace, so importing a setup onto a configured machine yields a hybrid — recommend offering both modes in the dialog now that the registry can enumerate what a setup governs. **E6** the "no migration needed for old files" reasoning is now false (see E1). **E7/E8** shared-buffer dedup and the base64 container, both carried over from July. Verified: `browser-audit.js` § reset now 21 checks, all passing, including both directions of the E1 regression. Files: `js/ui-audio-settings.js`, `js/ui-export.js`, `scripts/browser-audit.js`, `docs/EXPORT-IMPORT-AUDIT-2026-08.md` (new), `CLAUDE.md`, `docs/archive/EXPORT-IMPORT-AUDIT-2026-07.md` (banner). Shipped in 1.12 alpha.

- [x] **#161 Setup vs session — E4 + E5 done, `EXPORT_VERSION` 5** — Ek took both recommendations from #159. The two file types are now genuinely disjoint: **setup is the rig, session is the music.** Export dialog relabelled to say exactly that instead of "settings only" / "full session".
  **E4 was bigger than the recommendation implied, for an interesting reason: a session wasn't just bundling settings, it depended on them.** Import called `selectPreset(S.activePresetIndex)`, so restoring the sound meant resolving an index against the bank — which is *why* the bank had to ship inside the session. Consequence nobody had noticed: **a session imported on another rig was applying whatever patch happened to sit in slot N there**, silently, because the bank travelled along and hid it. Decoupling therefore required making a session self-contained about its patch: **`applyPresetObject(preset)` extracted from `selectPreset(index)`** in `ui-presets.js` (selectPreset keeps the bank-facing work — index, button highlight, HUD label, LED flash — and delegates parameter application, so there's one sparse-application code path, not two), and the payload now carries `patch` as a **detached deep copy** of the resolved patch plus `patchIndex` for the HUD label only. Nothing resolves through the index any more, which also **deleted the "index past the end of this build's bank" fallback** #156 needed — there is no index left to be out of range. `settings` is gone from the session payload; v1–v4 sessions still import (block applied with a console warning, missing `patch` falls back to `patchIndex`).
  **`RESTART_ONLY` / `pendingRestart()` from #159 were deleted, not kept** — they described a condition that decoupling removed, and keeping them would have been a monument to the old problem. The extra loader calls survive on the pre-v5 path, which is the only one that still applies settings. Inventory worth knowing, now recorded in the doc: of the eight persisted categories only `patches`, `mapping`, `audio` and part of `sensor` have a runtime re-apply path at all.
  **E5:** the import dialog asks before writing anything — **merge** (default, non-destructive, the usual reason to import is borrowing part of a setup) or **replace** (`clearGovernedKeys()` wipes every registered category except `debug` first, so you get exactly the file's rig). The dialog shows how many groups the file carries and how many of yours a merge would leave alone, since that difference *is* the decision and it depends on the file. Enumerating what to clear is only safe because `browser-audit.js` asserts the registry is complete — the same property that made per-category reset safe in #157.
  Verified: `browser-audit.js` § reset **24 checks**, all passing — three new ones on the v5 payload (no settings block, patch resolved at export, patch detached not a live reference) driven through the real `buildSessionPayload` via a `__testBuildSessionPayload` seam, so they assert what the file contains rather than what the comments claim. The `selectPreset` split verified separately: patches 1/5/10 each apply the right `grainParams.duration`, set exactly one active button at the right index, write the right HUD label; and a bank-free patch object applies without moving `S.activePresetIndex` — the property session import relies on. Origins + boot sections still clean. Files: `js/ui-presets.js`, `js/ui-export.js`, `css/style.css`, `scripts/browser-audit.js`, `docs/EXPORT-IMPORT-AUDIT-2026-08.md`. Shipped in 1.12 alpha. **Remaining open in that doc: E6** (per-field fallbacks can't handle a key being split or renamed — the version gate is not what protects you), **E7** shared-buffer dedup, **E8** the base64 container.

- [x] **#175 x-imu3 settings enforcement — one table, four copies deleted, read-back added** — The connect handshake asserted about half the settings that matter, and the half it did assert was **copy-pasted into four places** (UDP connect, WebSerial connect, Electron serial connect, `proxy.js`). They had drifted exactly as you'd expect: `proxy.js` wrote `ahrs_message_rate_divisor: 1` (400 Hz) where `imu-setup.js` wrote `4` (100 Hz), and never wrote `binary_mode_enabled` or `axes_alignment` at all — so **the same physical sensor was configured differently depending on whether you launched Electron or browser mode**. Meanwhile the Max patches set `inertial_message_rate_divisor: 1`, which mubone never wrote, so it stuck: on a three-sensor rig that's 1200 unwanted messages/second of WiFi and main-thread parse work, every one of them discarded at the bottom of `parseDataLine`.
  **New `js/ximu-settings.js` is the single table** — 16 enforced keys plus a UDP-only overlay, each annotated with its manual section and the reason. **The file must not import anything**: it is loaded as a browser ES module by `imu-setup.js` *and* as a Node CommonJS dynamic import, so even `./state.js` would break the Node side. The fix was structural rather than a re-sync: **`proxy.js` no longer enforces anything and is a transport again** — it owns the sockets and relays commands. `imu-setup.js` runs one enforcement pass for every transport, routing browser-mode UDP commands through the proxy's `{ type: 'command' }` relay; the LED handshake blink moved with it, so it goes through `ximu-led-feedback.js` in browser mode too.
  **Everything mubone doesn't consume is now switched off at the device** (`inertial`, `magnetometer`, `high-g`, `temperature`, `battery`, `rssi` divisors → 0). Only `Q` (cursor) and `S` (SA-A8) reach live code. Battery and RSSI still display — they arrive on the discovery announcement, a separate channel. Note for anyone wiring up direct-connect gesture: inertial is off because `feedToRegistry()` only ever forwarded the quaternion, so gesture never saw it on a direct connection anyway — it runs off the Max/OSC path. Set the divisor to 8 and call `handleSlotInertial()` if that changes.
  **Two value changes worth knowing.** `udp_low_latency` **true → false**: low latency sends each message as its own packet, which the manual says "will significantly limit the maximum throughput and number of devices able to stream on the same network" — mubone runs 3+ sensors on one network, so aggregation is worth more than the few ms. `ahrs_message_rate_divisor` stays 4 (100 Hz), and §9.3 means each message is the *average* of the 4 most recent samples rather than a decimated one, so the divisor is free anti-aliasing rather than a loss. **`serial_mode: 2` is now enforced unconditionally**, attached accessory or not: SA-A8s get swapped between hosts mid-show, so silence on the `S` stream proves nothing about configuration and every sensor has to stand ready. It governs the expansion-connector UART, **not** the USB CDC port a `serial`-transport device connects through (the manual keeps those separate), so enforcing it can never threaten mubone's own connection.
  **Read-back verification** — writes to the x-IMU3 are effectively unacknowledged, so a rejected or misspelled setting used to fail in complete silence. `verifySettings(dev)` now re-reads every enforced key 400 ms after `apply` (long enough for the write echoes to drain) and warns per key, with `serial_mode` getting an extra line in accessory terms because a device stuck out of Accessory mode is indistinguishable from one with nothing plugged in. **No response is reported separately from a mismatch, and only under `?debug`** — UDP command responses can simply be dropped, and treating that as a failure would cry wolf before every show. Result lands on `dev.settingsVerify` for a future device-card indicator. Second line of defence: `parseDataLine`'s `default` case counts unexpected message types and warns once per type per device after 20, which catches the case a read-back can't (reads back correct, isn't in effect).
  **Known conflict left alone on purpose:** the three Max patches contain message boxes that write the opposite divisors. None are on a loadbang. In the Max workflow inertial *is* consumed, so the patch is right for the patch — but whichever ran last wins and mubone only re-asserts on connect, so reconnect in mubone after a Max session rather than assuming. Full rationale, the enforced table with manual sections, and the `apply`-vs-`save` note (the device saves to EEPROM on shutdown regardless — there is no session-scoped tier) in **`docs/XIMU3-SETTINGS.md`**. Files: `js/ximu-settings.js` (new), `imu-setup.js`, `proxy.js`, `accessory-registry.js` (`setAccessoryMode()` now defaults to all connected devices, not `_lastDev` — the device needing the fix is by definition the one *not* sending), `docs/XIMU3-SETTINGS.md` (new), `CLAUDE.md`.

## Rounds #281–#289

### #281 — the scope stops rescaling, and curve gets its title back

Two fixes to the grain window, both about a control lying by moving.

**Curve is a half row again with its own heading.** #278 folded it onto taper's
line as a trailing option group, which made the window's SHAPE read as a
footnote to how much of the grain it occupies. It is a first-class choice, so
it is a first-class row. `PAIRED_WITH` is now empty; taper and curve sit side by
side in the two-column grid, each with its own title.

**The scope's time base is driven by DURATION alone, and it snaps.** It used to
be `period × 4.5 + duration`, so the axis rescaled continuously — and because
period dominates that expression, sliding *period* made the drawn grain grow or
shrink. Ek read that, correctly, as the duration appearing to change when it had
not. Period is out of the axis entirely now: the grain is the subject, so only
the grain's own length sets the scale, and period slides the copies within a
still frame.

Snapped rather than continuous, because the axis has two opposite jobs. Tracking
duration smoothly would keep the grain at a constant fraction of the width
forever, so duration would look frozen as well. Stepping is how a scope solves
it — inside a step the grain visibly grows, and the axis jumps only at a
threshold. The caption states the window (`window 250 ms`) so a jump reads as a
range change, not a glitch.

**One fixed number was considered and rejected**, which was Ek's own suggestion
(1 s, occasionally 2–3 s). It fails at the ends: on a 1.5 s axis a 10 ms grain
is a seven-pixel sliver and its envelope — the thing the window exists to show —
is unreadable. `SCOPE_STEPS` is a 1-2-5 ladder from 10 ms to 5 s at
`duration × 2.5`, which keeps the grain between roughly a sixth and half the
width across the whole range.

Verified on the rig: sweeping period from 7 ms to 4.00 s leaves the window at
`250 ms` and the drawn grain at a steady 82 px, with the duration readout
unchanged; sweeping duration steps the axis 10 ms → 5 s and grows the grain at
every step. The scope caption now says `duration` rather than `grain`, matching
the row it reports.

### #282 — the link crossed the 1 s boundary and broke; the rows never agreed on a grid

**The link was doing arithmetic on display strings.** `_dispNum()` strips the
unit, so a period reading `1.14s` parsed as `1.14` and was written into duration
as the bare string `"1.14"` — which the numbox's `_parseMs` reads as
*milliseconds*. Push period past 1 s, the point where the formatter switches
from ms to s, and duration folded from 1.14 s to 1.14 ms, i.e. a sample count,
and the scope's axis collapsed with it. A ratio between two times can never be
computed from strings whose units change underneath it. `_grainSec()` now reads
real seconds off engine state — the same source the scope draws from — and
writes back with an explicit `ms` suffix.

Fixing that exposed two more, neither visible by eye:

· **Typing a value moved nothing.** The typed-input path calls `_paramTypeSet`
  directly and never goes through `apply()`, where the link lived. So the link
  worked on drag and silently did nothing on a typed number.
· **Dragging moved the partner to the PREVIOUS value.** `apply()` read engine
  state in the same tick as the write, and the panel handlers coalesce their S
  writes over 30–50 ms — so the link was one move behind, for ever.

Both now go through one `_syncLink()`, deferred on the same 80 ms beat the row
readback already waits on, and called from both edit paths. Verified: starting
at 500/500 and crossing 1 s by typing and by dragging, in both directions, holds
the ratio at 1.000.

**The rows never agreed on a grid.** Every variant repeated its column widths as
literals, and `.prow--wide` carried its own 4.6rem label — so duration and
period, the two most important tracks on the page, were the two that broke the
left edge. The label, value and ± columns are tokens now (`--prow-lab` /
`--prow-val` / `--prow-var` on `.tc-prail`), so a full-width row differs from a
half-width one only in how long its TRACK is. Measured on the rig: one control
start position per column, 84 px and 354 px, no exceptions.

Air, in the places it was missing: a real row gap (the cells grid had none), a
taller minimum for chip rows, and chip padding raised in the properties rail
only — the footer's pills were compacted on purpose to fit the strip. Two traps
worth recording: widening the *label* gap on pill rows pushed those pills 5 px
right of every track above them, the same broken left edge in miniature, so the
extra air went between the pill and its note instead; and with real padding the
five octave segments no longer fit a half column, where `overflow: hidden` on
the capsule clipped it to `−2 −1 0` **silently**. Octave spans the row now.

Also: the scope caption reads `duration`, matching the row it reports.

### #283 — the engine pages get their sliders back, and a tile becomes yours

A batch of edits to the tile screen, mostly small, three with reasoning worth
keeping.

**The filter keeps its graph AND gets its four sliders**, two per row. The
drawing answers *what shape is this* and is the fastest way to grab an edge; it
is the worst way to set 4.2 kHz. Both, not either. The text caption under the
canvas said the same four numbers the rows now say, so it is gone — and
`_drawFilter()` repaints the rows, because dragging an edge has to move the
controls you can type into or the two halves disagree.

**Probability moved to OUTPUT.** It gates whether a scheduled grain sounds at
all, which is a property of what comes out, not of the grain's shape. Output is
now `vol` on its own row with `spread` and `prob` sharing the next.

**Experimental starts folded.** It is a long tail of tuning constants nobody
opens mid-session, and it was pushing output below the fold. Session-scoped, not
persisted: a disclosure, not a preference. The header carries a chevron and a
count so a shut section still says how much is behind it.

**A tile can be yours.** The new-tile chooser offers `lens` alongside granular,
loop and erase — `lensTap()` already called `applyTileParams()`, so a lens was
always a preset; what a custom one is NOT is a tool, so it never joins the belt
or the toolbox and lives in the lens group instead. Custom tiles gained a name
field and a delete button; factory tiles get neither, because their names are
what the docs, the keymap and every other tile refer to them by.

**Factory order is fixed.** Only a custom tile can be re-ranked inside the
toolbox. Dragging a factory tile onto the BELT is untouched — that is
membership, not catalogue order — and the drag-over caret no longer appears
over a factory tile, since it would have been a promise the drop refuses.

Smaller: `dir` reads `direction`; the octave row lost its note (the pill already
says which octave, and the cents remainder is on the pitch row above it).

**Three things this pass got wrong first, all found by driving the app:**

· `renderProps()` looked a lens up in the factory `LENSES` array only, so a
  custom lens rendered against `meta === undefined` and threw before drawing —
  the rail silently kept showing the previous sheet.
· Rewriting the octave row dropped its `.opt` wrapper. The capsule's styling
  hangs off `.tc-prail .opt .seg`, so the wrapper is load-bearing, not
  decoration, and the row rendered as the bare text `-2-10+1+2`.
· `engine-audit` correctly went red with nine "zero width" tracks the moment
  experimental folded. A collapsed row cannot be landed on, so it cannot be
  proved to work — the suite now OPENS every fold before walking the rows, or
  adding a disclosure would read as breaking nine controls.

Alignment re-checked across all eleven engine pages after the changes: one
control start position per column on every page, nothing clipped, no page
scrolling sideways.

### #284 — the axis break, tools instead of tiles, and grain edit becomes a lens

**The scope draws a broken axis** when the next onset falls past the window
(duration 42 ms, period 334 ms — you see one grain and no pattern, which reads
as "the second one is missing"). Rescaling to fit it is the obvious fix and the
wrong one: it puts period back in the axis and the grain starts changing size
again, which is what #281 removed. So the axis stays and the GAP is drawn
broken — grain one at true scale on the left, grain two at true scale on the
right, the two "not to scale" slashes between, and the real distance in the
caption, which gains `gap not to scale`. Verified: both grains draw at an
identical 79 px.

**`vol` was hanging a column short of the edge** — a full-width row without a ±
still reserved the ± column. `.prow--wide:not(:has(.prow-s))` drops it.

**They are TOOLS, not tiles**, in the copy: `new tool`, `+ tool`, "Your tool".
The `add` row's label was `+` beside a `+` glyph, which drew the same character
twice and read as two rows; it says `new tool` now.

**Naming and retiring a tool moved from the sheet to the rail row** (they only
arrived in the sheet last change): double-click the name to rename, and `del`
appears on the right on hover. `del` rather than `\u2715` — the sheet's close
control is already an `\u2715`, and one glyph meaning both "close this" and
"destroy this" is the confusion worth spending three letters on. Both are bound
in CAPTURE on the rail, or the row's own click handler would select the tool
`del` is about to delete. Only `.trow--own` rows have either.

**Grain edit became a real lens (v2).** Three changes, each replacing something
v1 did:

· **It never refuses.** v1 declined unless the cursor sat on exactly one stroke,
  so you could not even select it from a blank patch of sphere. Installing is
  unconditional now; with no target the sheet says `nothing in reach yet`.
· **More than one stroke is fine — they ALL change.** v1 refused a crowd as "too
  complicated to mean anything". Overriding everything in reach is what a lens
  does everywhere else in the app. Release interns once per distinct ORIGINAL
  brushKey, so a spray stroke and a comb stroke stay different brushes that now
  sound the same.
· **The cursor is no longer frozen.** You browse with it. What replaced the
  freeze is a **latch**: the lens re-aims whenever the cursor reaches a
  different, non-empty set, and never re-aims at nothing — without that the
  target would be dropped the instant the mouse left the canvas for the panel
  (`mouseInCanvas` goes false and the cursor falls back to the sensor), which
  is the whole reason v1 froze the cursor in the first place.

**Loops are out of it.** A trigger's speed/volume/passes are plain fields on the
trigger object, and editing them was a second state machine living in
`edit-lens.js` for a case Ek does not play. Removed, with the freeze branches in
`renderer.js` and `grain.js` — `git log -- js/edit-lens.js` has the loop path if
it is ever wanted.

Verified on the rig: installs on an empty sphere; two co-located strokes both
adopt the live voicing and both bank on release; the latch holds the target when
the cursor moves to blank sphere; a loop-only stroke leaves the lens with no
target.

### #285 — rename never opened, and the test that said it did

Double-clicking a custom tool's name in the rail did nothing. The cause is
worth recording because it is a class of bug, not a typo:

**The first click arms the tool, which re-renders the rail and REPLACES the
row's DOM node — and Chromium only synthesises `dblclick` when both clicks land
on the same node.** So the second press was always a first press on a fresh
element, and the native event never fired at all.

**The test passed anyway**, which is the part to remember. It dispatched a
synthetic `dblclick` directly at the row, and a dispatched event does not have
to satisfy the browser's same-target rule — so it exercised the handler while
skipping the only condition that mattered. A synthetic event can prove a
handler works; it cannot prove the browser will ever deliver it.

The fix pairs the clicks by **tool id** rather than by node, in capture on the
rail, and opens the editor on the next tick so the click's own re-render has
already happened — building the input first meant watching the render wipe it.
`renameCustomTile()` now reports whether it changed anything, because it bails
out on an unchanged name and the row was being left holding a live text input.

Re-verified against the real sequence: node replacement on the first click
confirmed, two plain clicks open a focused field, letters and space reach it
rather than being eaten as tool keys, Enter commits, an unchanged blur restores
the label, a slow pair of clicks is not a rename, and a factory tool never
renames.

### #286 — the filters group, and the panel that never opened

**Grain edit installed and nothing appeared.** `S._renderEditSheet` called
`setPropsOpen(true)`, which opens the tool LIST — but the sheet lives in the
properties rail, which needs `prail-open` as well. The lens was working the
whole time; it just had nowhere to draw, which reads as a dead button. It now
sets both classes, and turning the filter OFF no longer closes the rail: it
falls back to whatever tool is armed, so the panel never blinks out from under
you.

**Lens and filters are two groups now** (Ek): a camera takes exactly ONE lens,
and a filter screws on in front of whatever is mounted — there may be none, or
several. `wide` · `spot` · `arrange` (plus your own) answer "which lens";
`cap` · `grain edit` answer "which filters". Same hue, since they are one
engine; separate groups, because they are different questions. Nothing about
the behaviour changed — cap and grain edit were already toggles that composed
over the mounted lens — but the rail was presenting a one-of-N choice and two
independent booleans as one undifferentiated list.

**Two layout bugs in the edit sheet**, both from it building rows by hand
instead of using the engine pages' row variants:

· A row carrying a ± rendered its spread value into a column the grid did not
  have, so duration, period and pitch each **wrapped onto a second line**.
· `dur ±`, `per ±` and `pitch ±` were drawn **twice** — once as the ± on their
  parent row and again as standalone rows. The engine pages already drop them;
  the edit sheet did not.

Both fixed by using the same `prow--var` / `prow--wide` classes and the same
`IS_VAR` filter. Re-measured: one control start position per column, 84 px and
354 px, nothing wrapping, 17 rows down to 14.

Verified: installs from fully closed rails and paints a 14-row sheet; the
mounted lens stays armed underneath; switching wide → spot keeps the filter on;
cap and grain edit hold at the same time.

### #287 — three erasers, and the footer reads left to right

**Three factory erasers** (Ek), each one question: `scrape top` takes ONE layer
off the newest, `scrape bottom` one off the oldest, `scrape all` everything in
reach with no recency filter. They differ only in `depth` and `efrom`, so they
are three presets of one engine, not three modes — the engine page still
exposes both and a deeper scrape is a custom tool. `scrape` was depth 3 and is
now depth 1; the header comment listing "scrape bottom" as unbuildable was
stale, since `S.eraseOldest` and the `from` control landed in #243.

**A new factory tile now lands beside its family.** The old rule appended
anything missing from a saved order just before `+`, so for anyone who had
played once `scrape bottom` would have appeared after the granular brushes,
detached from the two erasers it belongs with. It inserts after its nearest
preceding DEFAULT_ORDER neighbour instead.

**The footer reads left to right**: cursor and sensor (what you check before
you play), then audio (set and forget), then the meters on the far right,
where a mixer puts them. Done with `order`, not by moving markup — the rig
view shares this footer and keeps its own arrangement, and every module still
finds these controls by id.

Three things that took a second pass:

· `order` only moves DIRECT flex children, and the levels rail was nested
  inside `.bottom-bar-left`. It is a sibling now, which is also why it needed
  to become its own group.
· `+ *` follows DOM order, not visual order, so the group separator could not
  stay a sibling rule. Every group carries its own left border and the first
  one visually drops it.
· `.bottom-bar-left` holds only mute, which is `display: none` in the strip —
  so it was an empty 28 px box with a border, and it was squeezing the audio
  group into scrolling inside itself (652 px available, 661 px needed). Hidden.

**And a stale caption the erasers exposed.** The panel handlers coalesce their
S writes over 30–50 ms while the caller renders immediately, so a row whose
caption comes from S rather than from its element drew the PREVIOUS tile's
value: selecting scrape top read `last 3 strokes`, then `all strokes`, one
selection behind for ever. `applyTileParams()` repaints on the same 90 ms beat
the engine rows already use.

### #288 — Tab was disabled by a lens, and the settings pages get the design

**Tab stopped cycling the belt whenever the grain edit filter was on.** The
guard `if (S.editHold && e.code === 'Tab') return;` was written when edit was a
momentary state that "owned the screen". Since #284 it is a LENS that stays
installed all session — so the guard silently handed Tab back to the browser,
which walked the tool rail's focus order. Removed. Tab (and a digit) now
release the filter first, banking the edit: reaching for the next tool means
the edit is over, and swallowing the key read as a dead keyboard. The release
matters — the filter holds the live params hostage, every targeted stroke is
following them, so arming a tool underneath it would repaint those strokes with
the new tool's sound and bank that on release.

**The sampler sheet had its own head markup and therefore its own font** — its
two buttons set no `font-family` at all and fell back to the browser's default.
It uses the standard `.ds-head` now (name, one line of what it is, actions on
the right) and the rest of the sheet is on the app's type scale. Rows are a
grid rather than a flex run, so name / wave / duration / play line up down the
column. Double-click a take's name to rename it. Its per-row delete is `del` on
hover, matching a custom tool's (#284), instead of a `\u00d7` that also means
close.

**The settings pages got the engine sheets' design.** The #269 pass had
flattened the sections but never touched the controls, so every slider in there
was still the browser's own: a fat rounded track and a circular thumb, on a
screen where every other slider is a 2px line with a 2px tick. They are the
same geometry as `.prow-t` now.

The fill is the interesting part. `appearance: none` is what lets a native
range wear a custom track, and it also removes the one thing a native range
gives you free — the coloured portion left of the thumb. There is no CSS-only
way back, so `ui-settings.js` writes `--fill` (0–100) on the element and the
track's gradient reads it, on input and once per page show. One delegated
listener on the host: the pages are borrowed from modules that know nothing
about this shell, so nothing can be asked of them. It degrades to a plain
unfilled track if the JS never runs, never to nothing.

Also: a range now fills its column so its value lands beside it (a select does
not — a stretched dropdown is just a wide box); hints are a quiet line under
their control instead of an orange italic paragraph that was the loudest thing
on the audio page and the least important; the tables and framed sub-boxes
inside the flattened sections lost their own cards; selects and number fields
use the app's field rather than the browser's.

### #289 — a lens page only opened once something else had opened the rail

Tapping `wide`, `spot` or `arrange` did nothing visible. `lensTap()` set the
selection and called `render()`, which repaints a rail that is ALREADY up but
never opens one — so a lens page appeared only after a tool had opened the rail
first, and then only because the tap repainted into it. Exactly the miss from
#286, in the other half of the same rail: `props-open` is the tool LIST,
`prail-open` is the page, and a click that sets neither looks dead.

**The cap has no page** (Ek): it is not an engine, it has no parameters, and it
was claiming `_optSel` like a lens — which left the rail showing a headed sheet
with nothing under it. Capping now CLOSES the properties rail instead, which is
the honest reading: you have just stopped the cursor reading, so there is
nothing to look at.

Verified from fully closed rails: `wide` opens both classes and paints its
18-row page; `spot` and `arrange` each open their own directly with no tool in
between; `cap` closes the rail and installs nothing; a lens opens again after
the cap closed it.

