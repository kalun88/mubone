# TODO — done items, 2026-09

> **Status: ARCHIVED** · done items moved out of `docs/TODO.md` on 2026-09-05, verbatim, so the open list stays short enough to read every session. Record only: entries describe the code the day they closed and may use superseded terminology. `git log` and `CHANGELOG.md` are the other two records.

### Sep 6

- [x] **pins § C's crossfade floor is an audible bound** — "alone at xfade 100 %" asked the smoothstep for zero, and
  the hand is never exactly on the anchor (the scheduler reads its cursor a tick later): it read 0.031 against 0.03
  once. Now −26 dB, with the reason; the partial mix it guards is orders away. Green twice.

- [x] **#348 The caps and throttles, re-set for the engine we have now** — P1–P6 all shipped (the six entries above).
  The reasoning is one paragraph in `docs/RULINGS.md`; the measurements stay in
  `docs/CAPS-AND-THROTTLES-2026-09.md`, which is CURRENT reference now rather than a plan.

- [x] **P5 (#348): the reach fan is sampled, not cut off** — above `REACH_MAX` (128) the fan was not drawn AT ALL, so
  the lens at "all" over a dense set — where the fan says the most — showed nothing. The pool is strided above the
  ceiling instead, and the alpha ramp reads the DENSITY the fan stands for rather than the count drawn. Measured with
  a 3000-mark pool: 125 segments where there were none.

- [x] **P6 (#348): `MAX_CHANNELS` deleted from the worklet** — declared, never read; the real ceiling is
  `WEB_AUDIO_MAX_CH = 32` in `js/audio.js`. A number that looked like a rule and was not one.

- [x] **P4 (#348): the voice caps, re-measured and raised** — a slot costs whether or not it holds a voice (the onset
  loops walk every slot per sample): measured 0.22 µs per cursor slot and 0.14 µs per seed slot per block, so 8 → 16
  and 40 → 64 add 4.3 µs to a 2667 µs budget, 0.16 %. A bucket with no free voice is SILENT, so this was a musical
  limit. The candidate tables are now sized `1 + MAX_CURSOR_VOICES` — a raised cap without that writes nowhere and
  fails quietly. Proof: twelve distinct voicings under one cursor each got their own region (four would have been
  silent before); two unit tests for 16 and for the seventeenth; `npm test` 49/49, mark-align 70/70, pins 188/188.

- [x] **P2 (#348): the grain pool is a setting, and the glow ring follows it** — `maxGrains` (256 / 512 / 1024,
  default 512) on Settings → Audio with a live "N alive · L% load" readout from the feedback that already arrives;
  the worklet allocates the pool and the feedback ring from it at `init` and on change, so a mark that sounded can
  always light. Measured in the app on the dense scene: 256 → 247 alive at 25 % load, 512 → 484 at 38 %, 1024 → 863
  at 70 % — where the LOAD throttle takes over from the pool backstop, exactly as designed, 0 steals throughout.

- [x] **P3 (#348): the grain throttle reads the LOAD, not the pool** — it skipped onsets from 75 % of the pool (192
  of 256), so eight wash brushes under one cursor (~213 grains) were thinned while the audio thread sat at a fifth of
  its budget. Now the signal is the thread's own load over 32 blocks (85 ms), ramping 70 % → 95 % of the block budget,
  with a backstop over the pool's last 10 % so a full pool thins instead of stealing (a steal is a click). Bench, old
  vs new: one brush 27 = 27, four 107 = 107, **eight 201 → 213**, overload 252 → 254 with 0 steals either way.
  In the app: 0 skipped in every ordinary phase; the dense phase reached 203.6 mean active (was 197) with 0 steals,
  0 dry, and load never past 36 % — so the POOL is what binds there now, which is P2.

- [x] **P1 (#348): the loop-gap probe runs only while someone is watching** — it cost 0.97 % of a core in EACH of two
  processes, from load, whether or not anything read it. `stats(want)` arms it for ten seconds; the 1 Hz depth poll
  passes false, `wg.status()`, `transport-probe.js` (and nothing else) arm it. Period stays 4 ms — the metric is
  lateness beyond the period, so widening it would blind the over-10 ms bucket. Verified: disarmed at rest, armed on
  request, self-disarming; the app tree drew 3.3 points less of a core disarmed; trigger 121/121, engine 38/38,
  browser green, and the probe still reads gaps in every phase.

- [x] **The ± spread has a control of its own (Ek, 2026-09-06)** — ⌥ is the cursor lock, and ⌥-drag on an engine
  track set the spread, so one key did two things. A number cell now scrubs (press-drag sets, click types,
  double-click resets, shift is the quarter-speed fine drag), on the value and the spread alike; the band is always
  in the DOM so it appears from zero; `_paintRow` on a spread repaints its base row. `engine-audit` § B2, eight
  checks end to end; palette 156/156, alignment invariants hold.

- [x] **A dwelling trigger reads with the live grain block (Ek's question, 2026-09-06)** — it read with whatever grain
  voicing its hit brush froze at recording time, which nothing displayed and no setting owned. `_voiceOf(p)` in the
  bridge routes a trigger's marks to voicing 0 on both post paths; `trigger-audit` reads the tables back and proves
  region 0. The same commit moves the audit's cushion round-trip check off the old 20 ms default. 121/121.

- [x] **R7: 64-frame RtAudio buffers** — the host writes a posted block as as many device buffers as it holds
  (`onOutputBlock` → `_writeOne`), so the capture's 128-frame quantum is two writes at 64; 64 joins the buffer choices
  and the saved-value gate; `transport-probe.js` boots at `MUBONE_PROBE_FRAMES`. Proved on the laptop at 64: zero
  faults in every phase, 197 grains at 20.6 % / 32 %, the estimate 10 ms in / 12.8 out. −1.3 ms per side.

- [x] **#337 mark-align's far-mark check was marginal** — a live mark's level folds loudness in per render frame
  between its capture and the next settle, so its window's real end is quantised to ~33 ms; "far" now means a frame
  clear of the burst (40 ms), not 5 ms. Green twice in a row (70/70).

- [x] **palette-audit § I flaked in a combined boot** — the engine suite moves every choice on every tile and the tile
  keeps the edit, so § I arrived with spray's on-end on `cloud`. The section sets its own precondition now (spray on
  `scratch`, waiting for the 250 ms capture). Combined `engine palette` boot 29/29 + 151/151.

- [x] **spray is pen** — the classic grain brush draws a thin line; splatter is the spray head now (Ek). The id,
  label and glyph (a nib) in tiles.js; `_RENAMED_TILES` + `migrateTileId` migrate `mubone_tiles`, `mubone_slots`,
  `mubone_tile_order`, `mubone_cycle_off` once on load and a session file's voicings on import (`S._migrateTileId`
  in brush-voicing.js). The four audits and the current docs say pen; the archive keeps spray.

- [x] **The palette tile wears its key** — `paletteLegend` (tiles.js) reads the bindings at render through
  `S._bindingOf` / `S._keyTaken` (midi.js): the learned key, the factory digit while it still works, F on
  erase, a MIDI tag beside them; `S._bindingsChanged` on every save repaints. "Clear keys" now clears the map
  in place (a fresh `{}` left events.js and tiles.js on the old one — the digits stayed dead until a reload).
  `palette-audit` § E d7.

- [x] **The wet drop is a button on the rail** — every grain brush's row, outlined dry / filled wet (`G.wetOff`),
  a tap flips `setWet` without loading the row (capture handler beside the cycle mark's); loop and erase rows
  carry none. Same target and negative margins as the cycle mark, so the rows stay one height. `palette-audit` § J.

- [x] **Farthest is back as a selected-pin mode** — `selectedPinSlot` flips the sign of the nearest search;
  the third capsule on Settings → Pins; the import normaliser and the unpin title say so. `pins-audit` selection.

- [x] **The pinned rail's settings door is a hamburger** — three lines in `#lyrSettings`; the gear read as a sun.

- [x] **An overdub with nothing pinned seeds the loop** — `beginOverdub` raises `S._overdubSeed` instead of
  refusing; events.js reads and clears it at the stroke's end and arms with `loop: true`; `armTrigger` passes it
  to `S._onTriggerStrokeArmed`, which pins the take whatever the tile's `on end` says. The refusal hook and the
  flash are gone. `pins-audit` § M (h).

- [x] **The glow has a floor and a density face** — `markGlow` (grain.js, `GLOW_MIN_MS` 80) is the one writer for
  the bridge and the muted-scan simulation: an entry lives at least the floor and carries heat; the renderer draws
  grains under the floor as batched cores by heat, one path per alpha step, and keeps core + ring for grains the
  eye can follow. In-place update instead of an object per grain. RULINGS "The glow has a floor, and two faces".

- [x] **#338 The cushion at 10 ms as the rig default (R1)** — Ek's laptop, 58 takes at 10 ms with the host, the
  grain-major loop, no-alloc recording and the tables in: `S.transportDiag` cumulative `outDry` 0, `inDry` 0,
  `outDropped` 0, `inSkipped` 0 (the two 47.5 ms host gaps were the stream's start, no fault). `audioCushionMs` 10 in
  state.js, the host and the two fallbacks; 5 added to the choices (`cushionBlocks` floors at two blocks); RULINGS
  and the performance audit say so.

- [x] **#340, the tick half: the scheduler runs every 10 ms (R3)** — `GRAIN_SCHEDULER_INTERVAL_MS` 20 → 10; every
  dependent scales from the constant (cloud advance, muted glow, drift thresholds, the trail skip) and the comments
  that named 20 ms are corrected. Probe at the new tick: zero faults in every phase, stressed load 22.8 % / 32 %
  unchanged, lateness ≤ 1.2 ms (was 3–5). `rig-audit "mark align"` 70/70, `pins` 187/187, `engine` 29/29,
  browser-audit green. A first chain failed under contention from Ek's own instance; the rerun was clean.

- [x] **#340, the candidate half: the pool crosses to the worklet as shared tables (R3)** — one SharedArrayBuffer,
  a double-buffered region per cursor voice; the bridge writes rows and publishes a half and a count, the worklet reads
  a candidate by row at fire time, step mode walks a permutation sorted only when asked; the message path stays as the
  fallback without shared memory. Measured: stressed pass 1.11 → 0.51 ms mean, its post 0.86 → 0.28 ms; probe clean,
  load unchanged. Four unit tests; `npm test` 47/47; `rig-audit "mark align"` 70/70, `pins` 187/187.

- [x] **#343 No allocation on the audio thread while recording (R5)** — the bridge allocates spare 30 s chunks and
  transfers them (`liveSpare`, at init and whenever the feedback says `spareLow`); `process()` pops one when a take
  outgrows a chunk and allocates only as a counted fallback; a clear returns extra chunks to the spare pool; the
  feedback posts an `Int32Array` copy. Proof on a private instance: a 65.6 s take, `chunkAllocs` 0, nothing dry or
  dropped. Five unit tests; `npm test` 43/43; `rig-audit "mark align"` 70/70.

- [x] **#342 The grain loop grain-major (R4)** — `grain-engine.worklet.js` `_render`: an onset pass per sample, then each
  active grain (an index list, swap-removed) renders its block into a scratch with buffer, state, filter and envelope
  hoisted, and is mixed once. Measured: transport-probe's stressed phase 48 % mean / 63 % peak → 23 % / 32 % at
  198 grains; node bench 1206 → 439 µs per block. Null test against a seeded golden render: 2 × 10⁻⁴ at one sample
  (phase now accumulates in double within a block). `npm test` 38/38, `rig-audit "mark align"` 70/70.

- [x] **#344 One client on the microphone in Electron (R8)** — did not reproduce on a fresh profile (RtAudio input live,
  no getUserMedia stream), so the two doors it could come through are closed: `startAudio` gated on Electron itself
  rather than on the RtAudio flag that lands asynchronously after boot, and `setupRtAudioInputMeters` now calls
  `_closeBrowserMic()` (also the disconnect path's) when RtAudio input activates. Proof on a private instance:
  `S.recordingStream` and `S.inputStream` null while `_rtAudioInputListening`; `rig-audit trigger` 120/120.

- [x] **#339 Audio I/O in its own process (Ek, 2026-09-06: "go ahead")** — `audio-host.js`, a utility process with
  nothing on its loop but audify's two streams and the queue regulation; `electron-main.js` forwards the audio ports
  to it and relays device requests; device lists stay on main's own enumerator (`getDevices()` holds a loop 65 ms).
  Decided by Ek's own readout at 10 ms: the browser thread gapped over 20 ms eight times, 157 ms once, none of it ours.
  `electron-loop-probe.js` is shared, so `wg.status()` reports the host's loop, the audio thread and the browser thread.

- [x] **#341 Instrument the audio thread and the main process** — the grain worklet times `process()` (`_diag.loadPct`,
  `procMaxMs`, `chunkAllocs`), the main process measures its own event-loop gaps (`get-output-depth`
  `loopGapMaxMs` / `loopGaps10` / `loopGaps20`, mirrored as `S.transportDiag.mainGap*`), and `wg.status()` and
  `scripts/transport-probe.js` print both — so a hole is now attributable to a thread. Found on the way: the dev bridge
  appended every console line and rewrote its status file synchronously on the loop that carries the hops; async now.
  Second pass the same day: every ipcMain handler, socket and serial callback runs through `timed()` in
  `electron-main.js`, GC pauses are counted through perf_hooks, and `wg.status()` prints the loop's holders by name —
  at boot, `get-audio-devices` (RtAudio enumeration) already held it 65 ms and `set-input-device` 18 ms.

- [x] **The GUI thread is out of the audio path (Ek, 2026-09-06: "do the real fix … audio is super pro, low
  latency")** — the wet-brush crackle was measured, not the drawing: a 30 ms stall on the renderer's main thread
  dropped one output block and 60 ms dropped eleven, because every block and every input chunk went through that
  thread on its way to and from RtAudio. Both hops are MessagePorts worklet ↔ main process now
  (`electronBridge.openAudioPort`, `ipcMain 'audio-port'`); the main process regulates the output queue to the
  cushion (primed when empty, skipped back after a lead, `outDry` / `outDropped`), the input ring pre-rolls to its
  target and refills when short. Stalls of 30–500 ms: nothing dropped, skipped or dry; both hops sit at the cushion.

### Sep 5

- [x] **Undo is the last user action (Ek, 2026-09-05)** — `js/history.js`, one unbounded action stack; a stroke
  (with everything it pinned), an erase / sweep / erase-all (before + after snapshots, any depth), a pin by hand and an
  unpin (the slot object, `removePinSlot` / `restorePinSlot`) are each one action; mute/solo, knobs and settings are
  not. The 30 s erase timer and the separate redo stack are gone; the loop fade handlers carry a generation guard.
  Reasoning in `docs/RULINGS.md`; `pins-audit` § O walks it through the real paths.

- [x] **A cloud is a moving cursor — it reads a mark with the mark's voicing (Ek, 2026-09-05: "the pin is just a
  moving cursor, if I change the material under it should change")** — the seed post played everything under a
  cloud with the pin-time block, so a wet brush's knobs never reached the wash cloud's material. The bridge now
  buckets a cloud's pool by `_vo` like the cursor post and posts one worklet voice per voicing (`MAX_SEED_VOICES`
  40, allocated by slot+voicing and kept between ticks); the cloud's own block is for unvoiced marks. `pins-audit` § J2,
  172/172; `mark align` 70/70.

- [x] **The armed tile is in the cursor from the first frame (Ek, 2026-09-05: "it shows splatter on the belt … I go to
  play it and it looks like spray")** — `initTiles` resolved `sel` to the restored slot but never applied its hand;
  it calls `_applyHand` now, as a tap does. Measured on a reboot with splatter in the slot and a block spray does not
  share: `S.brushFx` splatter, live duration at splatter's position.

- [x] **A dry stroke's glow followed the live duration knob (Ek, 2026-09-05)** — the bridge's feedback handler and the
  muted-scan glow used `S.grainOverrides.duration ?? gp().duration` for every particle; both read the particle's
  voicing now (`voicingById(p._vo)`). Measured: a stroke frozen at 300 ms glows 300 ms at live 2 s and 50 ms. The
  reach fan is the lens's and was right. Stale "k is the brush's" comment in `grain.js` corrected.

- [x] **The pin compass is gone (Ek, 2026-09-05)** — the per-pin arcs on the ring outside the reach ring, opacity by
  share, are removed from `drawCursor`; the dashed hairline to the nearest pin (`S._dominantSeedSlot`) stays and
  no longer needs the loop. `pins-audit` 165/165.

- [x] **The wash's comb filter at the start of a take (Ek, 2026-09-05: "I want the honest long-term fix")** — the
  worklet clamped a jittered read to 0 / the edge, so a dense brush's first grains were copies of the same few ms
  15 ms apart. A jittered read outside the audio is dropped now (`jitterDropped` in `_diag`); unjittered marks keep
  the frontier rules. Four unit tests; `npm test` 38/38; `rig-audit "mark align"` 70/70 (one burst check failed once,
  green at HEAD and on the rerun).

- [x] **The wash drops its launch point at the press (Ek, 2026-09-05)** — measured first: through the main button
  the wash's cloud already moves exactly as the held pin's after release (same head positions at the same times); the
  difference was visual — no slot during the stroke, so nothing where it began. `_drawLiveRecordingTrail` draws the
  head dot and reach ring at the first frame of a deferred path. Nothing sounds there. `pins-audit` 165/165.

- [x] **One anchor mark, and a light path line (Ek, 2026-09-05)** — `renderer.js` `_drawAnchorMark` draws every
  pin's ring · dot · number at its anchor (a stationary cloud adds its reach; a moving cloud's reach rides its head);
  no mark while the pin gesture is held; the moving path is one stroked polyline (same single-path batching), no
  start/end blobs. Measured on a screenshot with all four cases; `pins-audit` 165/165.

- [x] **An anchor is where the gesture released (Ek, 2026-09-05)** — `pins.js` `pinAnchorInto` is the one reader of a
  pin's position; `anchorLon` / `anchorLat` are stamped on every cloud (a held path and the wash at the END of the
  path, `finalizeSeedPlant`), a brush-pinned loop at its LAST mark, a hand-dropped one where the hand was; the
  session file carries them. Under focus with tether on the stroke you just made is the one you hear. `pins-audit`
  § C drives the real seal: 162/162. **Looper follow-up (Ek: "still at the beginning")**: the slot takes the loop
  PAYLOAD's anchor, and `buildLoopPayload` said `seqParticles[0]` whatever the resolver said — last mark now, proved
  through the real `createSeqFromStroke` over a synthetic live buffer: 165/165.

- [x] **An anchor does not move; the nearest line always shows (Ek, 2026-09-05)** — the focus weight pass read a
  moving cloud's interpolated `lon` (grain.js writes it per tick) while every other reader used `frames[0]`; it
  reads the start frame now. The dominant hairline needed a share over 0.34, which four pins around the cursor
  never give the nearest — drawn whenever there is a nearest pin. `pins-audit` § C: 159/159.

- [x] **Full crossfade between pins (Ek, 2026-09-05: "I still hear a bit of the other pinned loop")** — the focus law
  is relative to the nearest pin now (`u = 2·d0/(d0+d)`, smoothstep over the last `xfade` of the span; tether off
  keeps the reach gate): on an anchor that pin is alone at any width, midway the mix is even. Was `(1 − d/r)^e`,
  which with tether on left −19 dB of a pin 40° away. The dominant pin's hairline is 1.5 px and brighter; it did
  draw for loops but vanished beside the ring. `pins-audit` § C: 157/157.

- [x] **Focus / crossfade reaches the loops (Ek, 2026-09-05: "not working for loop/overdub pins")** — the weight
  was computed for loops all along; the apply line in `grain.js` read an `actx` declared in a LATER block, and its
  bare `catch` swallowed the ReferenceError every tick, so the loop's `_pinGain` never left 1. Now `S.audioCtx`,
  the catch logs through `dlog`. Overdubs ride the master's gain so they follow. `pins-audit` § C measures a real
  loop's gain against its share (155/155).

- [x] **Mute and solo on every pin; mute is immediate; release is the unpin (Ek, 2026-09-05)** — `js/pins.js`
  derives audibility from four flags (`mute` / `solo` per pin, `muted` / `solo` per group; `isPinAudible`,
  `applyMix`); the rail's row is body-tap = mute plus M and S; a mute lands in 20 ms, never at the loop boundary,
  and "at end" is `S.loopReleaseMode` on Settings → Pins, relabelled *release*. The restore rule and `_preGroupOn`
  are gone; session file v13; `pins-audit` § C–G rewritten.

- [x] **The selected pin is marked (Ek, 2026-09-05)** — `selectedPinSlot()` (nearest / oldest, `S.selectionMode`;
  `closest` renamed, `farthest` deleted, migrated on import) is the one function `releaseCommit`, the rail's
  half-moon mark and the sphere's cloud highlight read.

- [x] **Overdubs grey with their master (Ek, 2026-09-05)** — `syncParticleMarks` claims each overdub's stroke through
  the master, since a layer rides the master's gain and is silent when it is.

- [x] **World-locked is the factory default (Ek, 2026-09-05)** — `S.spatialPanning` starts `worldlocked`; README and the
  architecture notes say so.

- [x] **#323 osc-audit's fire section hangs in today's tree — parked at Ek's request
  (2026-09-01)** — the sweep FATALs on the reload after its first few addresses ("rig.evaluate
  timed out — is the app still up?"), twice at the same point; at clean HEAD the full suite runs
  to completion, so something in the #296–#321 set interacts with an early fired address plus
  reload. Isolation so far: reload alone is fine (203 ms), localStorage.clear + reload is fine,
  and resuming with `AUDIT_FROM=/sweep` runs cleanly past a dozen addresses — so the trigger is
  one of the first four fired addresses. Ek stopped the chase ("it wastes a lot of time"); pick it
  up with `AUDIT_FROM` bisection over those four when the suite is next needed.

  **Closed 2026-09-05:** the full sweep ran end to end for the 1.14 release (fire, edges, types) with no hang; its one finding, `/palette/wet` "changed nothing", is wet living in tiles.js state the S snapshot cannot see — now in the audit's expected-quiet list, proven by palette-audit § G instead.

- [x] **browser-audit runs on this Mac again, 70/70 (Ek, 2026-09-05: the browser demo is still a product)** — playwright-core is a
  devDependency; the hosted-origin stand-ins are `*.localhost` names (127.0.0.2/.3 only Linux routes, so every run here had
  timed out); the panel and modal checks are named lists (PANELS, MODALS) instead of counts stranded at 10 and 11; the session
  version follows `EXPORT_VERSION`; the UI-scale check is a ratio of the real base font. Real findings on the way: `latency.js`
  missing from the service-worker shell, `mubone_pinned_rail` unregistered, the audit still naming `.factory-reset-confirm`.

#### The four small fixes from the triage (Ek, 2026-09-05)

- [x] **#170 Recenter is orphaned — decide** — Fallout from #167. `recenterCursor()` is intact and correct-looking but has **no caller at all**: the button is disabled pending #76 and the auto-recenter path went with `slotTare`. It stays exposed as `S._recenterCursor()` for console investigation, and `S.driftOffsetQ` stays null so every downstream read is an inert null-check. Either finish #76 and give it a button — it's the *right* mid-show drift tool, a yaw-only correction that preserves tare, where tare re-zeros pitch as well — or delete it and stop implying the feature exists. `docs/TARE-RECENTER-ZERO.md` documents the intended workflow behind a warning banner.

  **#76 merged here (2026-09-05):** the older item — recenter drift correction, `recenterCursor()` logic unclear, button
  disabled with a tooltip — is the same decision.
  **Closed 2026-09-05:** decided — deleted. `recenterCursor()`, `S.driftOffsetQ` and the three per-frame reads are gone; yaw drift is what Zero heading corrects (docs/TARE-RECENTER-ZERO.md § Recenter).

- [x] **#174 Speaker sweep ignores mute in Electron, obeys it in browser** — Found while doing #173, deliberately not fixed unasked. Same root cause: the Electron sweep bypasses `speakerBuses`, and `setMuted()` mutes by ramping *those* bus gains — so **M does nothing to the sweep in Electron**, while the browser sweep runs through `_muteGain` and is silenced. Neither is obviously right: a diagnostic that goes silent looks broken, and one that plays through a mute is worse in a venue. Pick a rule and make both paths follow it — suggestion: obey mute, and have the status line say `sweep — muted` rather than listing channels, so it can't read as a dead speaker.

  **Closed 2026-09-05:** fixed — the Electron sweep's per-burst level is 0 while `S.isMuted`, the same way it already applied master (ui-audio-settings.js `electronVol`).

- [x] **#158 Rename the `.factory-reset-*` CSS class family** — `ui-export.js` styles its export, import and session dialogs with `.factory-reset-overlay` / `-dialog` / `-title` / `-desc` / `-btn` / `-confirm` / `-cancel`, which stopped describing anything when the button became `reset`. Mechanical rename to `.mu-dialog-*` across `css/style.css`, `main.js` and `ui-export.js` (~30 sites); deliberately kept out of #157 so that diff stayed about storage. The `main.js` Escape handler and the backdrop-click handler both query the overlay class, so grep for the string rather than trusting the CSS file alone.

  **Closed 2026-09-05:** renamed `.factory-reset-*` → `.dlg-*` (`-overlay -dialog -title -desc -btns -btn -go -cancel`) across css/style.css, js/ui-export.js and js/main.js — `.dlg-`, not `.mu-dialog-`, because `.mu-dialog` is the settings shell's own class since #255.

- [x] **The pin buttons' press flash has never had a rule.** `_pinFlash()` in `js/tiles.js` adds
  `.fired` for 180 ms and the only `.fired` rule in `css/style.css` is `.tile.fired` — so the press
  feedback the code's own comment calls "the only feedback there is" has been invisible since it was
  written. Found 2026-08-30 while moving the actions onto the rail's row model; not fixed in that
  round because it is a new visible state, not a re-layout. Either give `.lyr-act.fired` a face or
  delete `_pinFlash` — the third state, a call into nothing, is the one to avoid.

  **Closed 2026-09-05:** already done — `.lyr-act.fired` has had a face since 2026-08-30 (css/style.css, the `--mu-flash-*` variables); the item outlived its fix.

#### Triage, batch 4 — the rest, ruled by Ek 2026-09-05 ("go"); ideas moved to Someday, #36 #39 #323 #336 and the flake kept

- [x] **#120 Investigate cloud drop volume spike** — Cloud drops sometimes sound noticeably louder than expected. Suspect the committed cloud isn't inheriting the current volume/gain state, or something is off with scan gain staging or headphone mix routing at the moment of drop. Audit the signal path from cloud commit through to output: check whether `S.volume`, bus sends (monitor/house), and headphone mix level are all applied correctly to newly dropped clouds. Compare RMS of a cloud drop vs. live scan at matched settings. Could also be a normalization issue if the cloud buffer has a different peak level than the live buffer.

  **Closed 2026-09-05:** old — an April report against an engine rebuilt twice since.

- [x] **#146 Layout debt** — ~~the projector half~~ and ~~the flat-mode branch of the narrow CSS~~ are both **closed by #291 (Aug 29)**: the partition is gone to `sandbox/sunset-2026-08-29/projector-partition.js`, and the flat-mode narrow rules turned out to be dead exactly as suspected — `body:not(.projector-mode) .canvas-wrapper` and its two siblings lost to the tile screen's own rules on source order, so they were deleted rather than un-scoped. **What remains:** `perfTick()` in `state.js` still writes to `#loadIndicator` and `#vmNodeBar`, which no longer exist in the DOM — the always-visible load warning silently vanished at some point. Restore or delete.

  **Closed 2026-09-05:** done — both halves closed by #291, as the item itself records.

- [x] **#171 Tare silently cleared by axes-alignment change** — Noticed while writing #167's docs. Changing the alignment dropdown auto-clears tare (correct — the reference frame moved), but the only signal is the status text flipping back to "no tare set". Adjust mounting mid-setup and you're untared without noticing. Documented for now; consider surfacing it on the sensor card, or re-taring automatically.

  **Closed 2026-09-05:** superseded — the tare model was replaced by the mount and heading gestures (#314).

- [x] **#211 Particles are the spatial index, not the grain clock** — Pre-flight item 1, resolved
  in the doc but not in code. Every stroke deposits marks whatever its brush; only spray reads them
  as grain onsets. `paintTicker`'s interval becomes a spray parameter. Verify against
  `trigger.js:400` — a trigger *is* particles, which is what makes erase double as a trimming tool.

  **Closed 2026-09-05:** done — the deposit clock shipped; every stroke deposits marks whatever its brush.

- [x] **#213 The three harnesses that assert the old model** — `trigger-audit`, `composer-audit`
  and `cc-mirror-audit` fail by design once this lands. Decide rewrite-or-retire **before** the
  first red run, so a failing suite does not quietly become normal.

  **Closed 2026-09-05:** done — composer-audit sunset into pins-audit, trigger-audit and cc-mirror-audit rewritten and green.

- [x] **#214 Retire patches and samples — must land WITH the tiles, not after** — Pre-flight item
  5. `1`–`0` are factory patches and `Q`–`P` are `paint1`–`paint10`; both collide head-on with the
  tile row and the layer keys, so there is no order in which tiles ship first. Retiring them is
  what the tile model replaces: **make a tile, keep a tile** — a stamp tile *is* a loaded sample.
  Touches `js/ui-presets.js` (3,338 lines), the patch storage category, the patch-table modal and
  the migration flag.

  **Closed 2026-09-05:** done — the patch bank was sunset 2026-09-03 (#325); stamp brushes are the samples.

- [x] **#215 Layer gain lands in two places** — Pre-flight item 4. The worklet has two outputs and
  cloud volume is a per-grain **parameter**; loops have a real `_gainNode` (`grain.js:1287`). Decide
  whether to accept the split or give the worklet per-layer outputs. Accepting it is cheap and
  correct; it just means the cloud/loop asymmetry survives at the audio graph after the model
  removes it.

  **Closed 2026-09-05:** closed as accepted — the split is cheap, as the item says, and overdub layers have since built on it.

- [x] **#216 The tile screen — v3 landed 2026-08-25; what remains is listed here** — the s-six
  screen from `docs/mockups/brush-model-ui.html` is built as `body.tile-layout` (on by default on
  this branch): chrome (`js/tile-layout.js` — scan/mute/mic as PROXIES onto the real panel
  buttons, reach pill writing through `#radiusSlider`), full-bleed sphere, the layers rail
  (`js/ui-layers.js`, rendering only — behaviour stays in `js/layers.js`/`composer.js`, repaint
  on the 6 Hz dirty-flag contract), the tile row + options bar (`js/tiles.js` — position is the
  key, drag re-numbers, options write through the real panel elements and dispatch `input`; the
  cc-mirror lesson applied by construction). The `rig` button flips to the full 1.13 panel layout
  (`◈ tiles` comes back), which stays the settings surface until a real Rig door exists.
  **Keymap retired with it (#214, keys only):** digits no longer select patches, `Q`–`P` no
  longer paints samples; the actions remain for MIDI/OSC and the banks remain clickable in rig
  view. **The hold gesture is live:** `Q W E` file into layers 1–3 through `startSeedPlant`/
  `finalizeSeedPlant` (tap = stationary, hold = drawn path) or `dropSeqFromCursor` on trigger
  material, then tag `layerId` — `ensureKeyLayers()` appends a third boot layer, and
  `pins-audit` § A now expects ≥3 with grain+loops leading. **Deliberately not in this pass,
  and ghost-labelled in the UI where visible:**
  - ~~the `1`+`Q` growing loop~~ — ✅ **wired 2026-08-25.** Pressing `Q W E` while painting a
    line preloads the stroke-so-far from `recordingRaw` into the #209 worklet (2 ms declick at
    the preload/live junction — the main buffer lags input by one capture batch), loops it
    growing per the wrap rule, and hands over to a normal loop slot on stroke end
    (`createSeqFromStroke` + layer tag, worklet fades out under the slot's own declick).
    Q released first freezes growth: `closedAt` trims the slot's `loopEnd`, whose wrap then
    misses the baked seam crossfade — small click, fixed when `buildLoopPayload` learns
    regions. A watch interval catches the stroke ending from ANY binding (space, pedal), not
    just the digit. `live-loop-audit` § I covers the preload; the handover is probed end-to-end
    on the rig (slot tagged, trimmed, playing, rail updated). **Not yet played with a real
    mic** — the phase jump at handover (worklet loop → slot's own anchor) is the thing to
    listen for;
  - the layer-fade dial (engine half first: per-layer gain from cursor distance, and it collides
    with #215's gain split);
  - scrape bottom (oldest-first needs the erase.js recency sort inverted) and redo (no redo
    stack exists);
  - the `+` tile / design sheet (tiles are the factory six until #214's full bank retirement);
  - the doc chip (needs § 4 real files — nothing honest to display yet);
  - § 3e derived audibility — the rail still drives v1's write-through mute, so `ducked` cannot
    be distinguished from `muted` in the rail until the derived rewrite lands.
  Verified: rig-audit 5/5 (layers 58/58 after the § A update), osc wiring, functional probe of
  every digit/QWE gesture on the rig, ui-shots at 1100/800px.
  **Viz pass (same day, Ek's call):** the canvas HUD (coordinates, patch name, commit dots,
  buffer count) is hidden under the tile layout — the chrome carries scratch/held and the
  alt-lock indicator moved into `tcStats`. And the brush now decides how a mark LOOKS:
  per-material rendering in `drawParticles()` — spray keeps the feature-hued dot, line material
  draws as one connected palette-colour **volume ribbon** (width follows each mark's recorded
  rms — Ek: fixed width read as arbitrary; paths break at erase gaps, never chord), stamp
  material draws as thin vertical bars whose height is the file's amplitude at that mark's
  offset, so a stamp swept through space lays the file's waveform along the path (deposit-time
  rms from `featuresFromBuffer` — no new data). All new renderer buffers preallocated; § 7
  contracts intact; rig-audit stayed 5/5.

  **Closed 2026-09-05:** old — the list from the day v3 landed; what was still wanted has shipped or resurfaced since.

- [x] **#218 The brush head — deposit geometry** — Ek's exploration, 2026-08-25; **width +
  edge built same day**, scoped by Ek to STATIC paint qualities (the control is the choice of
  brush — no gesture/IMU modulation for now). `headOffset()` in `paint-ticker.js`: head 0–30°
  half-width, edge hard (uniform disc) | soft (folded-gaussian skirt), spray + stamp only — a
  line never scatters (it is a path, § 1d). Distributions verified statistically on the rig
  (hard: mean 6.6°/W=10°, 12% inner third; soft: mean 4.0°, 48% inner third; width 0 exact
  pass-through). Still open: persistence of `headWidthDeg`/`headEdge` (with the brush when
  tiles become user-made, #214), spatial-scatter = time-scatter (a flung mark's grainStart
  smeared with its offset — the fringe as temporal halo), and the remaining gesture levers in
  § 1d-bis (roll nib, paint load, tremor) — unbuilt.
  ✅ **Two experimental brushes prototyped (same day, Ek's go — the concat came from a message
  that never reached the session; reconstructed from "CataRT-style concat"):**
  - **splatter** (tile 3, `#f26415`) — the one brush whose head IS dynamic, as its
    predetermined contract: scatter rides cursor speed with a forward fling (thrown paint lands
    ahead of the motion), width rides the live input level (the mic is the pressure a body
    sensor lacks). Uses only data already at deposit time — no new sensor taps, honouring the
    earlier scoping. `dynamicHeadOffset()` in `paint-ticker.js`, velocity reset per stroke.
    Verified: fast scatters >2× slow with ~0.6° mean forward bias; loud widens slow strokes
    >2×; tunable constants at the top of the file.
  - **concat** (tile 4, `#81c784`) — CataRT-style: paints with your own corpus, steered by
    your voice. Each deposit matches the live descriptor frame (rms/centroid/zcr — already on
    every mark) against everything painted and lays down a mark pointing at the best-matching
    MOMENT, values copied never referenced (E9). Line material excluded from the corpus. A
    recording rolling underneath keeps growing the corpus without owning the marks. No voice →
    no target → no deposit (the paint gate is the rule). `concatMatch()` +
    `_depositConcat()` in `paint-ticker.js`; weights at the top. Linear corpus scan at the
    50 ms deposit tick, never the scheduler.
  Both are brush-contract flags set on SELECTION (`S.headDynamic` / `S.matchPaint`,
  `_applyBrushCharacter()` in tiles.js — click or digit, so space/pedal painting follows the
  selected tile). Neither has been played with a real mic; match's descriptor weights and
  splatter's throw constants are rig-tuning questions.
  ✅ **The real btw idea, third brush — comb (CataRT layout; the earlier 'concat' renamed
  `match` since it was the query half, built on a guess before Ek's description arrived):**
  the path stays, the phrase redistributes. Today a stroke's layout IS its timeline; the comb
  keeps the drawn polyline as pure geometry and continuously re-sorts the stroke's marks along
  it by a chosen feature — `sort by` bright (centroid) | loud (rms) | noisy (zcr), high values
  at the stroke's START — so the line becomes a **sorted index of the phrase**, live-arranging
  itself while both hand and voice are going, frozen at release. Sweeping it later scrubs by
  feature, not time. The `keep` sieve (all | high | low, fixed thresholds in `COMB_THRESH`,
  rig-tunable) drops non-qualifying material entirely — the filter half of the same idea.
  `resetComb`/`combAccept`/`combLayout`/`combDeposit` in `paint-ticker.js`; re-layout at the
  50 ms deposit tick with `_particleVersion` bumped (positions move mid-stroke — spatial caches
  rebuild). Verified: scrambled centroids land exactly feature-descending along the path;
  sieve keeps/drops correctly. Open: whether a combed stroke should carry its axis for
  re-combing after erase; per-stroke rather than global `combAxis`/`combKeep` when tiles
  become user-made.
  ✅ **Round three (same day): staff · echo · chop, and the flags collapsed.** The six
  experimental booleans became ONE field — `S.brushFx` ('none' | splatter | match | comb |
  staff | echo | chop), set on tile selection; the contracts are mutually exclusive characters
  by definition. New brushes, all verified numerically on the rig:
  - **staff** — the hand supplies longitude only; **latitude is brightness** (log-mapped over
    6 octaves of centroid, 110 Hz at the bottom to 7 kHz at the top). The phrase notates
    itself vertically; the sphere becomes a spectrogram you played. Comb's sibling: comb sorts
    along the line, staff displaces across it.
  - **echo** — each deposit lays 3 fading ghost marks BEHIND along the drawn path (6° apart),
    same `grainStart`. Delay time is drawn distance: a delay line whose time knob is the arm.
  - **chop** — the transient sieve: a mark lands only on an rms JUMP (`chopAccept`, threshold
    `CHOP_RISE`); sustains deposit nothing. A phrase reduces to its attacks.
  All in `paint-ticker.js` (`staffLat`/`echoGhosts`/`chopAccept` exported as test seams,
  `resetFx` per stroke). Not yet mic-played; thresholds/spacings are rig constants.

  **Closed 2026-09-05:** done — width and edge were built the same day; the rest is a paint-quality idea.

- [x] **#298 The footer is broken below ~1100px, and #297 moved one edge of it** — Found by
  `ui-shots.js` while checking #297, PRE-EXISTING and deliberately not fixed unasked. The bar is a
  three-column grid `(win−268.8)/2 | 268.8 | (win−268.8)/2`, but the groups inside are fixed-width
  and simply overflow their columns: at **800px** the right group (366.4px in a 265.6px column)
  overlaps the level group by **100.8px**, with no involvement from #297 at all. At **520px**
  everything overlaps everything and the strip is unreadable — captions print on top of each other.
  #297's fourth button grew the left group 176 → 228px, which moves ITS break point from ~621px up
  to ~725px; below that both the old and new layouts were already broken. **`ui-shots.js` exits 0
  on all of this** — it flags clipping and window overflow but never compares one footer group's box
  against the next, which is why a strip this broken has been shipping. That harness gap is the
  first fix; the layout question (groups that wrap, a narrow tier that drops the level pair, or
  columns sized from content) is the second.

  **Closed 2026-09-05:** done — ui-shots at 1000 and 1100 px show the footer intact (2026-09-05).

- [x] **#299 engine-audit fails on main: `filter — page opens — tool not in the rail`** — Found
  while verifying #297; fails identically at clean HEAD, so it predates today. `rig-audit` exits 1
  because of it, which means the fast-five baseline is RED on main — and a suite that is always red
  trains every future session to shrug at failures, which is the expensive part. Either the filter
  tool genuinely left the rail (then the audit caught a real regression — find when, with
  `git log` over js/tiles.js) or the audit's way of opening the filter page went stale (then fix
  the audit). Do this one soon; it is cheap and it buys back the meaning of "rig-audit green".

  **Closed 2026-09-05:** done — engine-audit has passed on main six times on 2026-09-05.

#### Triage, batch 3 — the verification items, all closed as old (Ek, 2026-09-05: "the app is in its good place")

- [x] **#180 Trigger tool — play it on the rig** — The gate is verified as geometry; none of it has been heard. Set up the turntable with triangle at 12 and woodblock at 3 and judge, in this order: **(a) rearm + hysteresis** at performance spin speed — the numbers (1.15×, 120 ms) are guesses and chatter is the failure that ruins a set; **(b) radius** — 8° may be far too tight or too loose depending on how the sensor maps to bearing; **(c) `start: top` vs `touch`** on a sung phrase painted across an arc, which is the case the two modes exist to distinguish; **(d) one-shot ignoring the exit edge** — confirm a fast sweep really does get the whole triangle and that it feels right rather than laggy; **(e) the `dwell:'loop'` wrap** — #183 dropped the extracted crossfaded buffer so erase could trim the sample live, which means a loop point between dissimilar levels can click. Percussion should be fine (the wrap lands in near-silence); a sung phrase might not be. If it clicks, the fix is a short scheduled gain dip at the wrap rather than going back to extraction. Then decide whether reverse triggers are wanted (see the scoped-out list — `startOffset` in reverse is measured in original-buffer time while playback reads the reversed copy, a latent bug in the loop path that would have to be fixed first).

  **Closed 2026-09-05:** old — a July/August verification item for a build that no longer exists; Ek, 2026-09-05: "the app is in its good place, so those are all old".

- [x] **#152 Redeploy mubone.org/sim** — The actual fix for the headline. Deploy the current tree, then verify against the checklist at the bottom of `docs/BROWSER-AUDIT-2026-07.md` — in particular loading the redeployed demo in a browser that visited the *old* site **without clearing site data**, which is the only real-world test of the B1 service-worker fix (the old cache-first worker has to be superseded once). Worth adding a `wrangler.toml` or deploy script so publishing is repeatable rather than remembered, and adding it to the release checklist next to `sw.js`.

  **Closed 2026-09-05:** old — a July/August verification item for a build that no longer exists; Ek, 2026-09-05: "the app is in its good place, so those are all old".

- [x] **#153 Verify browser mode on real hardware** — The audit harness has no audio device or sensor, so B1–B6 are structural only. Needs: audible granulation from the laptop mic with stereo panning following the cursor; an x-imu3 connected over WebSerial from the browser (quaternion arrives, LED handshake blinks, `serial_mode` reads back); the A8 accessory over that same connection driving actions; `node proxy.js` populating the WiFi list per the new B3 copy; a browser export/import v3 round-trip.

  **Closed 2026-09-05:** old — a July/August verification item for a build that no longer exists; Ek, 2026-09-05: "the app is in its good place, so those are all old".

- [x] **#149 Verify accessory in rehearsal** — (a) unplug the adapter mid-set with a pot driving grain duration and a button holding erase: pot should freeze, erase should release; (b) confirm `serial_mode` survives a sensor power cycle without mubone rewriting it; (c) check whether USB CDC still enumerates as a serial port while `serial_mode` is 2 and no accessory is attached (Device Manager / `ls /dev/tty.*`) — decides whether the rescue toggle is ever needed in practice; (d) long-session check that 8 mapped channels at 100 Hz cause no scheduler drift (perf monitor, dense cloud); (e) confirm the AirTurn's press-only edge drives `erase_toggle` correctly once it arrives.

  **Closed 2026-09-05:** old — a July/August verification item for a build that no longer exists; Ek, 2026-09-05: "the app is in its good place, so those are all old".

- [x] **#144 Verify multi-station live** — flip MIDI off in each station, confirm the three x-imu3 send ports stay distinct after a power cycle, seed each instance profile (especially the speaker-angle layout — spatialization differs per station otherwise) via settings export/import, build the FCB-1010 → Max patch against the three ports, run the OSC wire test with the in-app monitor open, then a clipping check with all three stations playing dense material into the same speakers.

  **Closed 2026-09-05:** old — a July/August verification item for a build that no longer exists; Ek, 2026-09-05: "the app is in its good place, so those are all old".

- [x] **#138 Run export/import verification checklist** — The 6-point checklist at the bottom of `docs/archive/EXPORT-IMPORT-AUDIT-2026-07.md`: live-tweak round-trip fidelity, new-recording audibility under recency after import, undo isolation, no zombie audio importing over a playing session, `frame`-role sensor survives settings round-trip, radius-fade cloud attenuates at edges post-import. Plus one v2-file back-compat check: import a pre-Jul-15 session export and confirm it loads (strokeIdCounter recovered from particle ids).

  **Closed 2026-09-05:** old — a July/August verification item for a build that no longer exists; Ek, 2026-09-05: "the app is in its good place, so those are all old".

- [x] **#133 Verify erase brush** — (a) ear-check erase-while-scrubbing: newest layer drops out, older buffers become audible in place; (b) erase mid-recording: granulation continues seamlessly, no accumulator desync (re-run #127 scenario with brush instead of erase-all); (c) ⌘Z after an erase stroke restores particles + audio; (d) `wg.diag()` after erase→commit: `sampleBufs` unchanged (by design — no compaction), then confirm the next sweep/erase-all reclaims the erased buffers; (e) perf monitor: no scheduler drift while holding F over a dense cloud (~500 particles); (f) undo after erase-while-painting: particles painted *during* the erase hold are reverted too (snapshot is stroke-start — known one-level-undo semantics, confirm it feels acceptable); (g) F key doesn't fire while typing in form fields.

  **Closed 2026-09-05:** old — a July/August verification item for a build that no longer exists; Ek, 2026-09-05: "the app is in its good place, so those are all old".

- [x] **#135 Latent bug: sweep-undo corrupts survivor buffer indices** — Found while auditing erase-brush edge cases; pre-existing, NOT introduced by #132. `sweep()` compacts `liveRecBuffers` and remaps surviving particles' `liveBufferIdx` **in place**, but `S._sweepSnapshot.particles` is a shallow copy holding those same object refs. `undoSweep()` restores the *uncompacted* buffer array while survivors keep their *remapped* (smaller) indices → survivors point at the wrong buffer after undo. Repro sketch: record stroke B (→ idx 0), record stroke A under a cloud (→ idx 1), sweep (B removed, A survivors remapped 1→0), ⌘Z → restored array is [B, A] but A's particles say idx 0 → they now granulate B's audio. Low urgency (undo-after-sweep with mixed buffer indices is rare) but wrong-audio-after-undo is exactly the kind of thing that surfaces in a show. Fix direction: snapshot deep-enough copies (`particles.map(p => ({...p}))`) or restore indices from a saved idxMap on undo. This caveat is also why the erase brush (#132) deliberately doesn't compact.

  **Closed 2026-09-05:** old, and unfixed — the repro sketch stays here; if sweep-undo ever misbehaves this is where it was described.

- [x] **#129 Verify perf-audit fixes** — Run the 7-step verification checklist at the bottom of `docs/archive/PERFORMANCE-AUDIT-2026-07.md` (sound checks, device-switch recovery, meter guards, loop mute/unmute cycles, regression on the erase fixes).

  **Closed 2026-09-05:** old — a July/August verification item for a build that no longer exists; Ek, 2026-09-05: "the app is in its good place, so those are all old".

- [x] **#131 Test panel drag on touch/trackpad + projector popup** — Verify drag works with trackpad, touch screen, and that the mirrored projector popup (Shift+F) is unaffected. Also verify collapse-click still works after a drag ends over a label, and layout survives reload.

  **Closed 2026-09-05:** old — panel drag left with the rig view (#291); the projector popup stays as it is.

- [x] **#127 Verify noise-glitch fix** — **Buffer release confirmed (Jul 6):** Ek ran 5–10 record→full-erase cycles; `wg.diag()` showed `sampleBufs: 1` / 0.23 MB / `bufMapSize: 2` (pre-fix equivalent would be 5–10 buffers; earlier sessions hit 11–14 / 92.6 MB). Index lockstep held. **Byproduct glitch found & fixed during verification (Jul 6):** erase-mid-recording gave silent/murky granulation until record release — `eraseAll()` was resetting the worklet's live accumulator out of sync with the continuous main-thread recording. Fixed by removing the `_beginProvisionalRecording` re-init from `eraseAll()` (change #5 in the glitch doc). **Remaining:** (a) ear-check erase→undo restores sound correctly, (b) re-test erase-mid-recording — granulation should now continue seamlessly through the erase, (c) long rehearsal at 128 frames watching `sampleBufMB` stay bounded. Phase C (pole-load glitch repro) still unrun — if the glitch recurs with the fix in place, revisit doc hypotheses #5/#6 (pool stealing, IPC listener leak).

  **Closed 2026-09-05:** done — the item itself records the verification of 2026-07-06.

#### Triage, batch 2 — the Euler path and the gesture block, ruled by Ek 2026-09-05 (kept as ideas under Someday: #43–#48)

- [x] **#42 Test gesture extraction with live sensor** — wave the sensor, verify viz panel shows meaningful features. Tune scaling constants in `gesture.js` (JERK_SCALE, EFFORT_GYRO_SCALE, ENERGY_DECAY, etc.) based on real sensor data.
  **Closed 2026-09-05:** stale — gesture.js was sunset 2026-08-29; there is no extraction to test.

- [x] **#83 Add `/euler` OSC input path** — new `handleSlotEuler(slot, [roll, pitch, yaw])` handler in sensor-registry.js. Stores `slot.rawEuler`, sets `slot.inputFormat = 'euler'`. OSC address: `/sensor/{name}/euler`. Coexists with existing `/quaternion` path — both formats supported per-slot.
  **Closed 2026-09-05:** superseded — calibration is two quaternion rotations (sensor-registry quatCal), proven by sensor-audit over 200 mountings; an Euler path has no job.

- [x] **#84 Euler tare** — capture `(tareRoll, tarePitch, tareYaw)` at tare time, apply via subtraction + angle wrapping. Simpler than quaternion conjugate tare; no roll-offset special case. Needs wrapping logic for yaw (±180°), pitch (±90°), and roll (±180°).
  **Closed 2026-09-05:** superseded — an Euler-space tare cannot fix a heading offset (docs/TARE-RECENTER-ZERO.md).

- [x] **#85 Euler axis remap** — direct remap on the three Euler values using the existing axisMap table. No quat decomposition/recomposition needed. Convert final tared/remapped euler to quaternion at the end to feed into existing `getSensorCamQ()` pipeline.
  **Closed 2026-09-05:** superseded — signs live in slot.quatCal.axisMap, downstream of the quaternion path.

- [x] **#86 Configure x-IMU3 for Euler output** — set `ahrs_message_type` to 2 (Euler angles) via x-IMU3 GUI or API. Keep `axes_alignment` at default (+X+Y+Z) — all mount remapping stays in mubone software for quick changes during experimentation.
  **Closed 2026-09-05:** superseded — the x-imu3 stays on quaternion output; docs/EULER-VS-QUAT.md is the record of why.

- [x] **#87 UI: sensor panel format indicator** — show whether each slot is receiving quat or euler. Euler tare vs quat tare path selection based on `slot.inputFormat`.

  **Closed 2026-09-05:** superseded — one input format, nothing to indicate.

#### Triage, batch 1 — the ten oldest open items, ruled by Ek 2026-09-05 (kept: #36, #39)

- [x] **#7 Crashes from too many loops/seeds** — happens on speech1, also general overload. Error code 5. Hard to isolate — likely AudioContext or node limit. Needs investigation.
  **Closed 2026-09-05:** stale — the engine was rebuilt twice since (worklet grain engine, pins); not seen since.

- [x] **#11 Upside-down indicator in viz** — something in the 3D view showing when the sensor is inverted, helps diagnose whether orienter is reversed.
  **Closed 2026-09-05:** superseded — the mounting gesture (Set mounting) measures the sensor's pose instead of hinting at it.

- [x] **#16 Particles remember their patch/grain settings** — each painted particle stores which patch was active when painted, so playback uses original settings.
  **Closed 2026-09-05:** done — a stroke freezes the brush that painted it (#210, brush-voicing.js).

- [x] **#17 Glide time between patches** — crossfade/interpolation when switching patches rather than hard cut.
  **Closed 2026-09-05:** superseded — patches no longer exist; tiles carry their own block, wet paint is the live case.

- [x] **#20 Tether seed visual** — visual connection between seed and its source or trajectory.

  **Closed 2026-09-05:** done for what exists — the overdub head draws a line to its master; more viz is #336.

- [x] **#75 Roll mute/unmap pole bug** — when roll axis is muted or unmapped in the sensor axis map, the cursor can never reach the poles and yaws excessively / flips. Works fine with all 3 axes active. Root cause: forward-vector decomposition in `applyAxisMapQuat` has a coordinate-system mismatch preventing pitch from reaching ±90°. Roll mute button disabled in UI with tooltip. Downstream roll-lock approach also failed (same decomposition issue) — roll lock code removed. See `docs/EULER-VS-QUAT.md` § "Proposed fixes for 2-DOF gimbal lock" for two approaches:
  - [ ] **#75a Explore pitch clamp** — clamp pitch to ±85° (configurable) when roll is muted, preventing the gimbal lock singularity. Quick win that could re-enable the roll mute button immediately. Tradeoff: poles become unreachable (small dead zone).
  - [ ] **#75b Explore delta/incremental rotation path** — compute frame-to-frame quaternion deltas (always small angles, never hit poles), apply axis remap and roll-mute to the delta, accumulate into camera orientation. Avoids gimbal lock entirely. Would also fix #9 (surface mode yaw after pole). Tradeoff: drift from float accumulation (mitigate with periodic normalization and slow blend toward absolute orientation).
  **Closed 2026-09-05:** done — since 2026-09-01 the camera takes no roll and is pitch-clamped (cameraFromPointing), which is #75a.

- [x] **#82 Basic morph for roll override / azimuth+elevation lock (cursor lock) via gesture panel capture** — implement a basic morph mode where roll overrides or azimuth and elevation are locked (cursor lock), then use the gesture panel to capture and drive the morph.

  **Closed 2026-09-05:** superseded — the gesture panel was sunset 2026-08-29.

- [x] **#76 Recenter drift correction bug** — recenter (`recenterCursor()`) logic needs review. Button disabled in sensor panel UI with tooltip. Tare works correctly; recenter is separate and its behaviour is unclear. Re-enable once the logic is verified.

  **Closed 2026-09-05:** merged into #170.

- [x] **The dead-weight pass (Ek's rulings on the first `deadweight-audit` run, 2026-09-05)** — nine commits, one per
  family: two .bak stylesheets + shortcuts.html; gesture-window.html + `sensor3Cal`, debug-waveform.js, ui-trace.js; four
  storage keys retired; `mapping_toggle_1–4` deleted; 92 dead CSS classes (probe before/after IDENTICAL); four HISTORICAL
  docs archived with their checklists as TODO items; `sandbox/` deleted, `docs/archive/SANDBOX.md` the ledger. Along the
  way: probe-selftest had been red since #333 (live cushion text) — fixed in `scripts/lib/probe.js`. Kept: flake.nix (Ek uses
  Nix for firmware), quad-capture.worklet (live), the 15 ids (data-attrs select them), ui-improv.js (live under a stale name).

- [x] **/finish, /release, the worktree helper and the dead-weight inventory (Ek, 2026-09-05)** — `.claude/skills/finish`
  (mapped audit → five-line archive entry → commit) and `.claude/skills/release` (the five version updates → every audit → commit,
  no push); `scripts/worktree-setup.sh` links node_modules into a `claude --worktree` checkout; `scripts/deadweight-audit.js`
  (`npm run audit:deadweight`) lists unimported modules, unread storage keys, unreachable trigger actions, unreferenced ids and
  classes, stray files and archive-rule docs — read-only, exit 0, every row a question for Ek. First run: 4 · 4 · 4 · 15 · 93 · 9 · 7.

- [x] **Audit windows stay in the background (Ek, 2026-09-05: "it pops up to be the front window … I'm usually
  multitasking on another desktop")** — `scripts/lib/rig.js` sets `MUBONE_RIG_BACKGROUND=1` on every launch; `electron-main.js`
  then creates the window hidden, shows it with `showInactive()` on ready-to-show and hides the dock icon. Verified from a
  launched instance: `document.hasFocus()` false, visibility visible, screenshot 193 KB with the full UI. Trigger suite green.

- [x] **#322 + trigger_chop — osc-audit's wiring section is green (2026-09-05)** — the two dead
  `S._onGestureUpdate?.()` calls (osc.js, sensor-registry.js) deleted with the sunset gesture module;
  `trigger_chop` had an ACTIONS row since #194 and no `dispatchAction` case, so a pad or `/trigger/chop`
  did nothing — same 1 / 0 / bang shape as `trig_toggle`, writing through `S._setChopOn`. Every osc.js
  edit's per-change check (`AUDIT_ONLY=wiring`) had two standing failures; now it can fail for a reason.

- [x] **Dev time: the session reads less, runs one audit, commits every change (Ek, 2026-09-05)** —
  TODO.md split to open items only (done items → `docs/archive/TODO-DONE-<month>.md`); CLAUDE.md 72 → 32 KB, its
  narratives moved verbatim to `docs/RULINGS.md` and `docs/AUDITS.md`; seven shipped plans archived with their
  rulings condensed into RULINGS; `scripts/audit-for.js` maps the diff to the one suite to run; rig-audit takes
  several names in one boot; four docs-audit checks hold the sizes and dead script refs; `.claude/settings.json` allowlist.

- [x] **#335 Pins are the cursor dropped — three consequences (Ek, 2026-09-05)** — "The pin is
  a pinning of the cursor … material under a pin isn't granulatable by the cursor, but I can
  still add and erase under it and the cloud picks it up." Three places that rule was not yet
  true. **Wash undo**: the deferred cloud (`startSeedPath`) now carries its stroke's id
  (`_seedRecordingStrokeId`, read at the press because the stroke's end clears
  `currentStrokeId` before it finalizes), so `removeSeqByStrokeId` takes the cloud with the
  stroke. **Overdub erase**: erasing part of an overdub's stroke silenced nothing — the layer
  is a fold of the take and nothing wrote through. Now the overdub half of `onMarksErased`
  zeroes the erased marks' spans in the TAKE (the marks are the stroke, no copies to match)
  and rebuilds the layer from it, swapped in under the seam — rebuilt rather than zeroed so a
  long take's stacked passes keep the other passes' audio at that phase, and in the take so the
  session file (which carries takes, not layers) keeps the erase. The whole stroke gone calls
  `removeOverdubByStrokeId`: the overdub leaves its master and the dot leaves the row. The
  zeroing shared with the loop path is `_zeroSpans`. **The family keeps the clock** (Ek, a
  second pass): the master's whole stroke erased under a standing overdub used to stop the
  loop and orphan the layers; now the master's buffer is silenced whole and the cycle runs on
  for its overdubs, and the last overdub erased releases the pin — derived from the marks
  (no master marks left, no overdubs left), never a flag. **Overdub head**: `overdubHeads` (grain.js,
  pure) gives the take positions the master's phase is reading — one per stacked pass — and
  `_drawOverdubHeads` (renderer.js) puts the loop's square on the nearest mark at a lower alpha
  with a thin line to the master's head, the first cut of the viz Ek asked for ("a simple line
  connecting the two playheads to start"). Marks are cached per overdub on `_particleVersion`
  plus the particle count (a live take grows its stroke without bumping the version). A take
  still recording walks its FOLDED length, `ov.foldedS` stamped at each wrap and dropped at the
  seal — Ek: "as I continue to overdub 2 or 3 or 4 times longer I expect new playheads to appear
  for those portions" — so a head appears per pass as each pass is folded in and heard.
  Not done, flagged: a wash cloud whose whole stroke is erased stays pinned as a moving ghost —
  a cloud may be a ghost pin by design, so it was left. Covered by `pins-audit` § M2 (erase
  reaches the take and the layer, erase-all removes the overdub, the head maths) and § N (the
  cloud is tagged with its stroke; undo takes it).

- [x] **#334 The wash — `on end` for the grain family (Ek, 2026-09-05: "a brush that immediately
  has a pinned grain cloud … it should basically sound like a reverb")** — The gesture existed as
  the `trace+cloud` paint mode on the A key: paint start planted a cloud, paint end finalised its
  drawn path. Nobody had made it a brush, which is the move the looper made for `trace+loop`.
  Now the grain sheet carries an **`on end` row — `scratch · cloud`** — reading and writing
  `S.traceMode`, in the deposit section beside rate and width; every factory grain tile pins
  `scratch`, the new **wash** tile pins `cloud`, and a persisted flip stays with the tile.
  **`trace+loop` is deleted** (Ek, same evening: "isn't that the same as the loop engine,
  looping?") — it was grain marks under a loop pin with scan muted while it recorded, the looper
  with different marks, first offered as a third value on the row and cut an hour later; its
  scan-mute, its commit-button lock and its branch in `_commitTraceStroke` went with it, and a
  session file carrying it reads as `trace`.
  The A key, the `trace_mode` action, `/trace/mode` and the cabinet's cycle button are deleted:
  a key cycling the flag under an armed tile made the tile lie. Two changes underneath. **The
  cloud follows the hand, not the press** (Ek): the old path reserved the slot at the press, so
  a stationary cloud sounded at the start point for the whole stroke and claimed the marks near
  it away from the cursor; `startSeedPath` records frames with NO slot and `finalizeSeedPlant`
  reserves one at the release, anchored at the first frame — a full pool refuses there. The
  `=` hold keeps its press-time slot (a ghost pin must sound). And a grain tile can have a
  **factory sound**: `FACTORY_SOUND.wash` in display units (400 ms grains every 15 ms, Hann,
  taper 50%, offset ± 400 ms, per ± 10 ms, no detune, LPF 6 k, spread 90%, vol 0.5), pushed
  through each numbox's `fromDisplay` on first arming and adopted; `_adoptBlock` now overlays
  `FACTORY_PARAMS` so a persisted `scratch` can never outrank the wash's `cloud`. Known limit:
  a pinned cloud snapshots its block, so a WET wash moves its scratch strokes and not its pins.
  A harness hazard found on the way, now closed: the audit profile PERSISTS `mubone_tiles`, so a
  choice `engine-audit` drove on spray's page (`on end` → cloud) reached every suite launched
  after it — mark-align's strokes were ending as clouds re-reading their own marks.
  `engine-audit` now puts every choice back after driving it, `mark-align` states its scratch
  precondition, and `palette-audit` drops the wash's block before its reload so § I sees what a
  fresh profile is born with. **Separately, mark-align is FLAKY at HEAD**: "marks that cannot
  contain it stay small — far max 0.63" fails on one or two bursts in about two runs of three,
  on `b9c94e8` with nothing of #334 applied (3 solo runs: pass, 1 fail, 2 fails). Not chased
  here; the burst and the value are the same each time, so it is a real race, not noise. Blocks are born at init (`_birthFactoryBlocks`), not
  lazily: born on the first sheet edit, the wash's block came up from the live state with no
  factory sound and `scratch` under its identity.
  `docs/FADING-STROKES.md` is the study Ek asked for alongside. Covered by `palette-audit` § I
  (arming sets the flag, the row reads and writes it, the tile remembers, the factory sound
  lands) and `pins-audit` § N (no cloud while the path records, one moving cloud at the release,
  the stroke's end finalises it, a full pool refuses). Debt seen on the way, not touched:
  `osc-audit` wiring fails at HEAD on `trigger_chop` (no dispatch case) and `S._onGestureUpdate`
  (never assigned).

### Sep 4

- [x] **#333 The hops are bounded — the stall cushion (Ek, 2026-09-04: "the buffer size in the
  settings is at 128 already, unless it's actually something else under the hood")** — It was.
  The first loopback measurement on the rig read **in 37.1 + out 57.3 = 94.4 ms** at 128 frames,
  where the buffer accounts for 5. Two cushions, both invisible, both state-dependent: (out)
  audify's `write` only queues and the device callback drains, and the credit window was
  refunded as soon as a write returned, so it never bounded the queue — whatever lead built up
  at stream start, or during any stall the renderer recovered from, sat there for the life of
  the stream; (in) the input ring is fed in bursts through the renderer's main thread (UI, the
  grain scheduler, the 30 fps render), and its fill locked in at the worst burst since the last
  dry-out. Neither shrank with the buffer; both could change after any stall, which is why a
  measurement alone could not make the loop engine foolproof. **Now**: the main process opens
  the output stream with audify's frame output callback and refunds a credit when a block has
  PLAYED (`_outSender`, `_outWritten` − `_outPlayed` reported by `get-output-depth`; a device
  change refills the renderer, since blocks queued on the closed stream never play); the input
  ring takes a `target` and skips the oldest excess after a burst that leaves it deeper than
  the target plus a chunk, reporting fill and skips once a second; and ONE setting, the **stall
  cushion** (`S.audioCushionMs`, 10/20/30/50, default 20, Settings → Audio after Buffer size,
  `mubone_audio_cushion`), is both bounds — the credit window in blocks (`creditWindow()`) and
  the ring's target in frames — applied live, with the row showing the queue and the ring as
  they are. The trade it makes, stated on the row: a freeze longer than the cushion is a
  dropout, where before it was absorbed and paid for in latency forever. `latency.js`'s estimate
  is now device + cushion per side (+ the capture batch out), so it stops drifting, and the
  measurement key includes the cushion. **Interfaces**: everything is per device — RtAudio's
  own report per stream, the measurement per pair — and the one thing to set by hand is the OS
  default output = the interface, because the engine's clock is the default device's and
  RtAudio's is the interface's; different devices drift, and a bounded hop turns drift into an
  occasional block drop or repeat rather than creeping latency (a rate-adaptive buffer is the
  real fix, not built). `docs/RIG-RUNBOOK.md` § 4.9. `trigger-audit` 112 → 118: the window is
  the cushion in blocks; the queue sits at the cushion and the main process agrees; the ring
  holds no more than the cushion plus a chunk; an **80 ms main-thread freeze** does not lock in
  — both hops are back within the cushion 1.5 s later and the ring reports what it skipped; the
  cushion moved to 10 ms follows. Files: `electron-main.js`, `electron-preload.js`,
  `js/audio.js`, `js/worklets/input-meter.worklet.js`, `js/ui-audio-settings.js`, `js/latency.js`,
  `js/state.js`, `index.html`, `js/storage-registry.js`. **Second measurement on the rig, after
  the bounding**: in 44.7 + out 53.9 = 98.6 ms with the cushion row reading out queue 18.7 · in
  ring 17.3 — the hops held, the estimate said 44.1, so ~54 ms was outside the app. Checked
  outside the app: audify alone on the MacBook Air's built-in speakers and mic at 128 frames
  (`hw-loop.js`, scratch) measured **67.5 ms** round trip with RtAudio reporting 70 frames — the
  built-in devices run through Apple's audio DSP and RtAudio's report is wrong by ×40 for them.
  The model is complete: app 44 (40 of it the cushion choice) + devices ~55. **So the measurement
  is now kept as the DEVICES' share** (`deviceS` = measured − what the app knew it added), keyed
  on input device × output device × rate only, half to each side: measure once per interface,
  then move the cushion or the buffer and the round trip follows without measuring again
  (`trigger-audit`: the cushion 20 → 10 takes the measured round trip down by exactly 20 ms, still
  "measured"). The first day's total-keyed entries are dropped on load; Ek measures once more.
  **Harness lesson**: the rig's mute zeroes the speaker BUSES, and the calibration fan (like the
  sweep) enters the merger below them — so the audit's clicks played out of the machine running
  it and the mic fed them back through the dry monitor: a howl at +1.5 dB that gated nothing,
  overflowed the ring and broke three checks. Under test the clicks now go only to the harness's
  tap (`S._calibrationTap`), which IS the room, and the gate test uses a threshold a clipped howl
  cannot pass (119). **And the rig's real input is silenced under audit** (`S._silenceRtInput`,
  a harness seam called from `rig.mute()`, zeroing the RtAudio routing gains and holding them
  at zero through every rewire): a muted audit instance now records exactly nothing with
  nothing injected (analyser 0, take peak 0, checked). **mark-align's flake is not the room and
  not this session**: with the whole session's work stashed, the committed tree fails the same
  "marks that cannot contain it stay small" checks on this machine (far max 0.63), and the
  current tree, room silenced, fails them with smaller values (0.25) — a timing sensitivity in
  how a late tick's loudness window lands on a mark. Open, and it stays red in `rig-audit` on
  a loaded machine until someone looks at the check itself. **First loop after the bounding
  (Ek): "a lot of dropping when playing back, at every cushion"** — not stalls: the edge. With a
  credit per block PLAYED the queue sat full at the window and the balance hovered at zero, so
  each new block depended on the previous block's credit arriving inside one 2.7 ms period, and
  IPC delivery jitters by more than that; the ring likewise skipped on any burst one chunk over
  target, and ordinary bursts are two or three chunks (the 6336 skipped frames). Both hops now
  carry a **jitter margin**: the renderer may run 10 ms (or two blocks) into credit DEBT, so the
  queue can exceed the cushion by at most that and a drop means the renderer is a whole margin
  ahead — drift, not jitter — and the ring skips only past 10 ms (or four chunks) over target.
  `trigger-audit` adds a steady-state check: no dropped blocks and no skipped frames over 1.5 s
  (120). The buffer size was never the problem and stays at 128.

- [x] **#332 The loop follows the button, and the machine knows its latency (Ek, 2026-09-04:
  "the overdub always lands like 30 ms late … even a simple non-segmented loop was hard to land,
  especially on the toggle off … i want 100% certainty that all machine issues are ruled out …
  we need a foolproof system that'll work for different interfaces and latencies")** —
  Measured first: a click scheduled on the audio clock lands in a take at exactly the offset
  `startedAt` predicts (0.00 ms, four runs), so the recorder is exact for anything inside the
  graph, and everything late is outside it. Three findings, three fixes. (1) **A loop's edges
  came from the marks, not the button**: first mark to last mark plus the median spacing, on a
  50 ms tick, behind a paint gate, with the release recorded nowhere — quantised and late with
  zero-latency hardware. Now a hit take stamps `startedAt` and `releaseAt` on the clock, the
  recorder is HELD open past the release by the input latency (`stopLiveRecordingHeld`;
  `whenSealed` waits through the hold, which the first draft missed — the arm ran before the
  seal and read the marks), and the seal writes `edges = [inS, end]`; `_applyCluster` and
  `buildLoopPayload` take the edges for an UNTRIMMED stroke (its kept marks still span what
  was painted — `take.markSpan`, recorded at the settle, not the deposit, because a mark still
  pending at the release is dropped) and fall back to the marks once erase has cut it. (2) **The
  first pass started 60 ms plus a seal plus a tick after the release**, from the top: a fresh
  take's loop carries `_phaseAnchor = releaseAt` and the seq start path begins as far in as
  the release is behind, so the cycle's top is the instant the button went up. (3) **Nothing
  compensated the round trip**: a performer sings against what they HEAR (late by out) and the
  mic hears that (late by in), so an overdub landed late by the whole trip, by a constant.
  `js/latency.js`: an ESTIMATE from what the streams report — RtAudio's `getStreamLatency` per
  stream plus the buffer each was opened with (`get-stream-latency` in electron-main, the
  preload bridge), the context's figures in browser mode — and a MEASUREMENT, the loopback:
  six clicks out of the master bus, the take in, the delay found by onset and taken as the
  median (`findClickDelayS`), stored per input device × output device × rate × buffer in
  `mubone_latency_cal`, split in/out in the estimate's proportion. `S.latency.inS` moves a
  loop's edges, `S.latency.roundTripS` pulls an overdub's phase back (`attachOverdub`,
  `refreshLiveOverdub`). Settings → Audio's Latency row now states the model's numbers and
  their source, with Measure and Forget; the device pages refresh it on Apply. **Hit material
  is never gated** (Ek: "the paint gate is misleading … i don't want to see sections of my loop
  pathway empty"): a line is a path you swipe to fire, so the gate skips `_recordingTrigger`
  deposits; the grain engine keeps it. `trigger-audit` 101 → 111, a section that asserts the
  estimate's arithmetic, the click finder (27.3 ms read as 27.3, silence as null), a hit take
  painting under a gate that stops a grain take, the release stamp and the hold, edges =
  [inS, end], the region IS the edges and falls back after a trim, the looper's loop anchored
  to the release and phased to it within a tick, and a press inside the hold cutting it;
  `pins-audit` § M records its real take under a 30 ms round trip and requires the phase
  pulled back by it. **Caveat, stated on the row**: the estimate is a floor — RtAudio's report
  may not count the output write queue, whose depth the credit flow sets — so the measurement
  is what gives certainty, and it needs the output to reach the mic (speakers or a cable);
  with headphones it reports that the clicks were not heard. **First try on the rig** (Ek,
  headphones off, sweep confirmed the output): "cannot hear the clicks" — the clicks went into
  the MASTER bus, which in Electron ends at the analyser; the interface hears only the channel
  merger, which is what the sweep plays into. `calibrationOutput()` in audio.js now fans the
  clicks to every merger input (the master bus in the browser), the finder works relative to the
  take's own floor (a laptop mic hearing laptop speakers is quiet: peak ≥ 8× the 5 ms before
  the click, onset at 35 % of the peak) and returns its evidence, and the row says what was
  heard — silence, only noise at n dB, or sound but not clicks — instead of one message. The
  measurement is now proven end to end: `trigger-audit` runs it through a 27 ms software
  loopback into the recorder (`S._calibrationTap`, a harness seam) and requires 27 ms, six of
  six, stored as measured (112).

- [x] **#331 The end of a slice clicked (Ek, 2026-09-04: "a click artifact at the end of each
  segment … i usually just hear it at the end not the top … and it's not always")** — two
  causes, both in the trigger's end. (1) **A one-shot had no end fade.** The start ramps the
  gain from zero over 3 ms (`DECLICK_S`), which is why the top never clicked; the end was
  `src.start(at, pos, span)` running out with no ramp — and a trigger plays the raw take
  region, never a seam-crossfaded copy like a loop's buffer, so the cut clicked in proportion
  to the sample value it landed on ("not always"). `ONESHOT_FADE_S` = 5 ms of gain to zero in
  wall time (the span is buffer seconds, divided by the rate) scheduled at start; a loop-dwell
  trigger gets none (`_endFade` null — its seam is the loop's problem, and still open). (2) **A
  slice ended past the next onset.** `_applyCluster` ends every region at last-mark-plus-median-
  spacing, which for a slice lands on or into the next hit's attack — the loudest sample there
  is. `_sliceStroke` now records the onset that closed each run and armTrigger stamps it on the
  trigger as `endCap`; `_applyCluster` clamps the region to `endCap − SLICE_END_LEAD_S` (12 ms:
  the detector's 10 ms hop plus the fade), so the fade never bites the next attack and the
  segment never contains it. Erase-split siblings inherit the cap as an upper clamp; it rides
  the session file's trigger record and `restoreTrigger`. `trigger-audit` 96 → 101: a full-scale
  sine region fired by hand under a quiesced scheduler schedules a 5 ms fade ending exactly at
  its span, plays at 1 in the middle and reads gain 0 once the source has run out; a loop-dwell
  fire schedules none; the slice test asserts each segment carries the next onset as its cut
  and stops ≥ 12 ms short of it. Files: `js/grain.js`, `js/trigger.js`, `js/ui-export.js`,
  `scripts/trigger-audit.js`, `docs/archive/TRIGGER-TOOL-PLAN.md`. **Two harness notes from the same
  runs, neither caused by this change**: `mark-align` failed one or two "marks that cannot contain
  it stay small" thresholds in three of seven runs today and passed the others, alone and in the
  full suite — it records real audio against timing thresholds and is load-sensitive on this
  machine; and in a FULL `rig-audit` run the audit window loses focus once during
  `palette-audit`'s 8 s long-press hold (never when the suite runs alone), which cancels the long
  press by design (a blur is a release edge). The check now counts blurs and reports the skip
  rather than failing; which earlier suite steals focus is not found — `rig-audit` takes one
  filter, so pairs cannot be run from the CLI.

- [x] **#330 The overdub brush — a take inside a pinned loop's cycle (Ek, 2026-09-04)** —
  "all overdubs are owned by a main loop … that loop's length is master, and kinda their
  playhead position … on the next cycle of that main loop the 4 to 6 second will be overdubbed
  at that spot … if i leave the overdub toggled on for like 35 seconds, all of that will go in
  but as 3 and a bit loops … it's still one pinned item." `docs/archive/OVERDUB-PLAN.md` is the design
  with the rulings folded in (every loop pin is a master, nearest at the press and held for the
  take, LAYER when longer than the cycle, no repitching — the take plays at 1× on the master's
  wall-clock cycle — one pin with a dot per overdub, erase and undo stay the sphere's) and § 5
  is where the build departed from it (no ghosting: the press refuses; no ring; the marks are
  inert to the cursor; redo restores marks, not the layer). **How it lands on the engine**: a
  pinned loop is one looping source with a fixed origin (`_startedAt`), so its wall-clock phase
  is one subtraction (`masterPhaseWall`); a take records `startedAt` on the audio clock; the
  stroke's end (`_commitTraceStroke`) attaches instead of arming — `buildOverdubLayer` folds
  the take onto one buffer the length of the master's cycle from that phase, wrapping and
  summing, and `startOverdubLayer` plays it looped at 1× into the master's OWN gain node,
  started at the master's phase — so volume, the stop fades, the composer mute, the pin weight
  and play-to-end act on the family with no bookkeeping, and a rebuilt master (unmute after a
  stop, an import) brings its layers with it because they start where its source does.
  `nearestLoopPin` (loops only, no radius) is the selector; `beginOverdub` runs from
  `_toolDown` before the hit take starts and a refusal aborts the gesture, so with nothing
  pinned nothing latches. `EXPORT_VERSION` 11 → 12: a loop slot carries its takes and phases,
  never its layers. `pins-audit` 89 → 107, § M: nearest ignores a nearer cloud; the phase at 1×
  and at ½× (13 s in is phase 3 of 10, or 13 of 20); the layer maths — land at phase, wrap,
  three passes STACK, ½× keeps the take's spacing; the REAL record path through the trigger
  pair attaches one layer never armed as a trigger, phased by the recorder's clock (asserted
  independently of the function under test after the first draft compared it with itself);
  undo, the v12 round trip (take and phase on the wire, layer rebuilt), removing the master
  stops its layers, and the refusal. `palette-audit` § D walks four loop tools now. **First play
  on the rig** (Ek, same day): unpinning the master left its overdubs unplayable — the master's
  stroke was always scratch, an overdub's was a hit stroke never armed. `orphanOverdubs` now
  runs on every road out of the pin and arms each overdub's stroke PLAIN (`armTrigger(id,
  { plain: true })`: one trigger, no audition, no slice or chop from the tool in the hand, no
  looper hook, so nothing re-pins), while the layers ride out the master's fade; a self-killing
  master deletes the family's paint with its own. Two more checks in § M (109). **Second play**:
  "as i'm recording, each time it cycles back to the top that material should play back the next
  time around" — a take is now heard pass by pass: at every wrap of the master (detected in the
  seq block, `S._overdubLiveWrap`) `refreshLiveOverdub` folds the recorder's raw pool so far
  into a provisional layer and `swapOverdubLayer` crossfades it in (8 ms, each layer on its own
  gain into the master's); the seal lands the final layer in the same overdub; a master unpinned
  mid-take drops the provisional and the stroke becomes a plain line at its seal (`_commitTraceStroke`
  arms it when attach returns null). Four more checks in § M (113); the first draft of the
  master-gone check sat before the undo step, undid the wrong stroke, and pushed a real recorded
  layer through the export dump — past the bridge's 150 k cap. **Open**:
  the long press on the overdub tile (undo the last overdub, the Ditto's hold); a take started
  while the master is muted attaches normally — play it on the rig; the ring on the marks if
  the colour is not enough.

- [x] **#329 The main button is ONE thing: toggle or momentary, decided above the brush
  (Ek, 2026-09-04)** — "all performance buttons should be toggle by default, not momentary
  latch … we shouldn't have the hybrid version of tap to toggle and hold to hold. it's
  confusing … it's asking what does the main click button do — just like most MIDI
  controllers." Space, a click, the pedal, `/trace`, `F`, the instrument's buttons and the slot
  keys under *tool keys fire* all press one funnel, `gesturePress` / `gestureRelease` in
  `js/brush.js`, and it is either **toggle** (press starts the tool in the hand, the next press
  stops it, release does nothing — the default) or **momentary** (press starts, release stops):
  `S.gestureMomentary`, `mubone_gesture_momentary`, a two-way capsule under *Tool keys fire* on
  Settings → keys + MIDI. Only then does the brush say what a started gesture DEPOSITS
  (`_toolDown`: erase, hit, sampler, or a live grain stroke). **What this replaced**: the
  tap-latch existed three times (space keyup, mouseup, the `recpaint` release) with three
  different conditions, and it reached ONE tool — a grain brush on the live source in plain
  trace mode — because `brushClaimsTrace` claimed every other press before the 200 ms window
  was read; the line brushes were momentary-only by a written decision ("a latched trigger
  recording would record until you noticed"), erase and the sampler by accident. Both
  `TRACE_TAP_MS` and `TRACE_TAP_MIN_MS` are gone, and OSC-AUDIT § O1 (a Max `[t 1 0]` latching
  trace) is superseded: in toggle mode that pair is one press. **A hold means nothing else in
  toggle mode, so it is the second function**: a button still down after `GESTURE_LONG_MS`
  (8 s) fires the tool's long press — erase: erase all, the stroke ending first; other tools
  nothing yet. **A gesture remembers the mode it started in**, so the switch flipping under a
  held key or note cannot strand it (§ H proves both directions). Slot holds follow: a hold is
  no longer spring-loaded under toggle — the key-up and the wire's 0 do nothing and the SAME
  slot pressed again ends it (`slotEnd`); `_held.latched` records which; the funnel's
  `S._gestureChanged` hands the cursor back when a gesture ends from anywhere (a mode change,
  handsfree disarming, the eraser's long press), so a lit tile cannot outlive its gesture.
  `S._handKind` (the held slot, else the armed one) replaced `S._armedKind`, so F + space
  with a grain brush armed no longer paints under the scrape. `trace_trigger` and ⇧space set
  the flag and press the same funnel, so a hit recording follows the mode like everything
  else; `trace_toggle` stays as the toggle-whatever-the-setting bang for press-edge-only
  controllers. `S._traceToggled` → `S.paintLatched` (true only for a toggle-started gesture;
  handsfree's gate keys on it, as before). Dead code cut on the way: `S._cLoopActive` (written
  `false` in one place since the D keys went), `S._shelvedSeed`'s branches, the D-key release
  block in events.js, `S._setRecording` (nothing called it), and the live-paint start/stop that
  space, the mouse, touch and MIDI each carried a copy of — now `startPaintStroke` /
  `stopPaintStroke` in events.js, which also settle the mic question one way (space painted
  without one, the mouse asked and gave up). `palette-audit` 119 → 142: §§ E–G run their
  spring-loaded holds under momentary, § H is the default — every tool from space, a click,
  the wire, F, the instrument's holds and the slot keys under *tool keys fire*; the flip under
  a hold both ways; `trace_toggle` in momentary; a mode change ending a stroke; and the 8 s
  erase-all, with `S._sessionEraseAll` spied. `rig-audit`, `docs-audit` and `audit:align`
  green; the settings row measured to the kit (36 / 30 / 6, flush right, centred).
  `browser-audit` not run — playwright is not installed here. KEYBOARD-SHORTCUTS, QUICK-START,
  README, TIMING-REFERENCE (row 34 is now the long press), TRIGGER-TOOL-PLAN, OSC-AUDIT,
  CLAUDE.md and the storage registry follow. **Open**: the long press on the other tools; the
  overdub brush this was the first step toward; `commit_draw` (`=`: tap pins, hold draws) is
  the same tap/hold hybrid on another key and was left alone.

- [x] **#328 The belt is the PALETTE; keys 1–5 by position; tool keys fire; lit is visible
  (Ek, 2026-09-04)** — "let's call it the palette everywhere." Renamed across code, styles,
  markup, scripts and the CURRENT docs: `#paletteDock`, `.palette-*`, `S._paletteTap` /
  `S._paletteHold`, `palette_1`…`palette_5` and `palette_N_hold`, `/palette/N` on the wire,
  `scripts/palette-audit.js`. Stored key and MIDI maps migrate once (`_RENAMED_IDS`,
  `belt_*` → `palette_*`); the #327 map (`belt_1` → the old brush-slot hold) is dropped, because
  a stored `belt_1` now means the cap tap. History in this file and CHANGELOG keeps its words.
  **The digits are the palette's keys by position**: `1` taps the cap, `2` cycles the lens,
  `3` `4` `5` tap a slot — arm, then cycle — the factory keys of the `palette_*` actions, so
  the keys page moves them and a relearned one stands down (`_keyRelearned` in tiles.js; the
  capture-phase handler also yields while the keys page is learning, which it did not before).
  **Tool keys fire** (`S.paletteTrigger`, `mubone_palette_trigger`; one switch at the top of
  Settings → keys + MIDI, off by default): `3` `4` `5` become the trigger — press arms and plays
  the slot, release stops it; the three slot taps join `S._holdActionIds` while it is on, so a
  learned key, a note or `/palette/N 0` sends the release; no slot wears the box (the palette
  must not lie: nothing rests armed), a slot lights while it sounds, a click on a slot cycles
  it, and space still plays the last slot fired. The rail keeps its armed row — the ⋯ and the
  cycle mark live there. **Lit was invisible on the palette**: `.palette .tile.armed` (three
  classes) outranked `.tile.playing` (two) on background and box-shadow, so the class toggled
  and nothing changed — only the cursor said the tool was live. `.palette .tile.playing` now
  fills in the engine's hue, the rail row lights with it, `refreshPlayingState` keys on `sel`
  rather than `.armed` (there is no `.armed` under the switch), and it polls at 30 Hz from
  tiles.js instead of the layout's 5 Hz, where a press showed up to 200 ms late.
  **One hold at a time, and nothing moves the hand under it** (Ek's follow-up the same
  morning): while a slot is held from anywhere, the other tool keys, a slot tap on the wire and
  a slot click are dead, in both modes — the first draft let the wire's `palette_4` arm a slot
  under a keyboard hold before the hold guard ran. The cap and lens keys stay live under a hold,
  and `render()` now re-asserts the lit state so their re-render cannot go dark. A release on
  `palette_3..5` lands in either mode (tiles.js and the MIDI note-off / CC-0 path alike), so the
  switch flipping under a held key or note cannot strand the hold.
  `palette-audit` 70 → 119: § E taps the digits and proves the relearn yield; § G reads the lit
  fill from the computed style, walks the switch on and off, and drives every one of those
  conflicts. KEYBOARD-SHORTCUTS, README,
  CLAUDE.md and the storage registry follow; KEYBOARD-SHORTCUTS also lost two stale lines (the
  `␣` corner glyph, gone since #260, and the queued-Tab box, gone since #327).

### Sep 3

- [x] **#327 Four fixes on the instrument (Ek, 2026-09-03)** — (1) **Zero works in steer and
  surface**: `tare` put the camera back to the front (`camQ` identity, surface deltas dropped)
  when the mode is not sensor; the sensor heading is still captured when one is feeding; the
  footer reads "cursor zeroed". (2) **Rail rows are one height**: the armed row's cycle mark and
  ⋯ (1.4rem targets in a 17px line) made it 33.3px against 27.9, so every pick moved the list —
  negative vertical margins keep the targets and drop them out of the row's height; align-audit
  "every rail row is one height". (3) **Tab opens the last thing picked** (`_lastPick`): a tool
  row, a belt slot, a lens row or tile, the sampler; ⇧Tab stays the lens's; a key hold is not a
  pick; belt-audit § C proves a lens pick then Tab opens the lens. (4) **The ACTIONS table
  caught up with the instrument**: a `belt` group with `belt_1`…`belt_5` TAPS by position
  (cap · lens · loop · grain · erase, `/belt/N`, `S._beltTap`) and the three slot HOLDS renamed
  to positions (`belt_3_hold` / `belt_4_hold` / `belt_5_hold`, `/belt/N/hold`; the instrument's
  buttons and F land there; stored key/MIDI maps migrate once on load, `_migrateIds`);
  `erase_brush` / `erase_toggle` retired into the erase slot's hold; groups and labels speak
  the vocabulary — lens (mode · fill · order · radius · k · depth), cap, zero, paint, hits, pins
  (`=` / `−`); the D-key family (tap/hold/⇧/⌘ D) and the dead `-` sweep handler left
  events.js — `=` and `-` are the pin pair and one fact does not get two keys. README's OSC
  table gains the belt; KEYBOARD-SHORTCUTS and CLAUDE.md follow. Ids and OSC addresses other
  than the belt are unchanged: they are the wire, and the keys page shows labels.

- [x] **#326 The sampler sheet's head wrapped (Ek, 2026-09-03: "text does not look good")** — the
  head's one-line description was a sentence, and in the 352px rail the flex row folded it one word
  per line into a 46px column 255px tall beside the two action pills, which wrapped too. Measured,
  not eyeballed: `.ds-head span` 46 × 255. Fixed at both ends: the sampler's line is `source` (the
  sentence is its tooltip) and its pills are `● rec` / `test`, so the four children end 14px short of
  the rail edge; and the SHARED head rules now say what the model always meant — the name never
  breaks, the description takes the slack and ellipsizes, a pill never wraps (`.ds-head b/span`,
  `.ds-editbtn`, `.ds-wet`). Also the source row cut its take name at nine characters with no
  ellipsis ("test pluc") — the cut is gone, the row's ellipsis does the job. **Invariant left
  behind:** `align-audit` "sheet heads" opens a brush, a lens and the sampler and requires every
  head child to be one line, counting the TEXT's line boxes clustered by overlap (a pill's padding
  and a switch beside its label both fooled the first two drafts), then puts the rig back. Files:
  `js/ui-source.js`, `css/style.css`, `scripts/align-audit.js`.

- [x] **#325 The patch bank is sunset (Ek, 2026-09-03: "sunset patch bank")** — with a grain
  tile owning its whole block (#324) a flat bank of grain patches had nothing to be a bank of
  (`docs/archive/BRUSH-MODEL.md` § 1e, now BUILT). Gone to `sandbox/sunset-2026-09-03/` with a README
  table: the ten factory patches and user slots (`presets-data.js`; slot 0 `wash` lives on as
  `DEFAULT_GRAIN` in state.js), `selectPreset` and the cabinet's patch/envelope devices, the
  patch-table modal (`ui-patch-table.js`), param locks (`param-lock.js`), and — Ek's call, "kill
  /sunset cloud morph with it for now, we'll build the new tile end points feature later" — the
  cloud-morph slider, its three actions and `/morph/*`, plus the dead `X` radial-morph toggle
  (#269 took its engine). Kept: the registry half of the table as `js/param-registry.js`
  (session import still applies a sparse `patch`), and gesture morph in `seed-morph.js`.
  `EXPORT_VERSION` 11: `patch` is a `snapshotCurrentState()` of the live set, `patchIndex` gone.
  Storage: the `patches` category and seven retired keys, purged once at boot
  (`purgeRetiredKeys`). Brush keys collapse to `grain` | `hit`. The `patch` LED event had no
  sender left and went from the LED map. Verified: docs audit, OSC wiring audit, the full rig
  audit, a boot + screenshot. **Unrun:** `browser-audit.js` (no playwright here) — its bank
  assertions were rewritten: the migration test now requires the active-patch key NOT to be
  written, 5c2 (the schema-flag guard, which guarded the bank's migration) is deleted, and 5c4
  checks a v11 snapshot and no index; it had been asserting `version === 6` against a v10 build,
  so it was already stale. `sw.js` `APP_SHELL` swaps `ui-patch-table.js`/`param-lock.js` for
  `param-registry.js` now rather than at release, because a missing file fails the whole shell
  install. Files: 24 in `js/`, `index.html`, `css/style.css`, `css/settings-gui.css`, `sw.js`,
  4 scripts, 7 docs, `sandbox/README.md`.

- [x] **#324 Wet paint replaces audition (Ek, 2026-09-03)** — audition was a read-only tile that
  heard the whole sphere through one engine and refused to paint; Ek: *"it's not UX friendly,
  doesn't make sense."* Ruled through in conversation: not a mode on the hand (a scope where
  "all strokes from that paintbrush change" was rejected when it was the hand's), but a
  PROPERTY OF THE BRUSH — a switch in a grain brush's sheet head. A wet brush owns one voicing,
  every stroke it paints points at it, and its knobs move all of them in place, wherever the
  cursor is; a dry brush's strokes can never move; off dries where it sounds; a brush that
  disappears dries; only the sound moves, never placement. Two things underneath: voicings key on
  the TILE (`S._handTile`), not the patch-bank key; and every grain tile owns its whole block and
  persists it (*"if I see that slider in that position, it's set"* — factory grain tiles applied
  nothing on arm and lost their edits on reload; the other factory tiles stay session-only, since
  wide IS mode:off — belt-audit § F caught the first draft persisting every tile). Arming no
  longer loads a patch-bank slot. The
  switch is the kit's first built instance (INSTRUMENT-GUI § 3); a drop marks wet tiles on the
  belt and rail; wet marks of the armed brush wear a ring. `wet_toggle` (`/belt/wet`) in the
  ACTIONS table. Deleted: the audition tile, its stash, `AUDITION_HIDES`, `S.auditionGrain`, the
  three refusals, the filter leftovers in tiles.js (`ENGINES.filter`, `_renderFilterSheet`,
  `tc-filtering`), `patchFromParams`. Audits: `engine-audit` § D (a tile owns its block, driven
  by the pot path), `pins-audit` § H re-keyed on tiles and § L wet (9 checks). Files:
  `js/brush-voicing.js`, `js/tiles.js`, `js/brush.js`, `js/grain-worklet-bridge.js`,
  `js/renderer.js`, `js/midi.js`, `js/state.js`, `js/ui-samples.js`, `js/erase.js`,
  `js/storage-registry.js`, `css/style.css`, 5 docs, 3 audits.
  **Debt left in place:** the patch bank (`PRESETS`, `selectPreset`, `brushLibrary`'s
  `grain:N` keys) is now only reachable by OSC/MIDI/its cabinet buttons and no longer feeds
  arming — `docs/archive/BRUSH-MODEL.md` already schedules its retirement; a bank recall while a grain
  tile is armed is captured into that tile by the poll, which is the honest reading of the
  "it's set" rule but may surprise. `S._currentBrush`'s key still says `grain:N`.

### Sep 1

- [x] **#321 The instrument's three buttons ARE the belt's first three tiles (Ek, 2026-09-01)** —
  fixed semantics, no binding UI: button i is the digits key's hold gesture on belt position i.
  Built through the one table, as CLAUDE.md demands: three `hold` actions `belt_1..3`
  (`/belt/1..3` on the wire), a guarded public door in tiles.js (`S._beltHold` — one held
  position at a time, empty slot = no-op, shares the digit-key exclusivity), and edge detection
  in sygaldry.js where `/Buttons/state` lands — so a held button is a brush painting exactly as
  a held digit is, and a pedal or Max reaches the belt the same way. Verified live: belt_1 hold
  starts recpaint (S.isRecording true while held), a second hold is rejected while one is down,
  release stops, and the OSC path round-trips. Static OSC wiring check green.

- [x] **#320 Rescan is the one attach verb (Ek, 2026-09-01: "i don't need specific buttons to
  add right? just rescan is enough?")** — right in both modes, once two gaps closed. The header's
  `Add over USB` + two-choice expansion are DELETED; the head holds Rescan alone. **Electron:**
  ports enumerate on rescan and every row connects itself — the mubone tty row got a real Connect
  through `sygConnectSerial()` (sygaldry's vendor-filtered request; Electron's chooser
  auto-resolves it to the first RP2350, correct whenever one instrument is cabled — two at once
  takes the first, and unplugging the wrong one beats any dialog). **Browser:** WebSerial lists
  nothing ungranted, so Rescan IS the permission picker — one unfiltered request routed by USB
  vendor after the pick (safe there because a PERSON picks; the S1 hazard was Electron's
  auto-answer, which never sees this branch). This supersedes S1's two-item menu — the brief
  carries its fourth amendment. Bonus: the old `imuSetupSerialRescan` block was binding a
  button deleted in R1 — ghost code, removed.

- [x] **#319 The ` key gets a face in the footer (Ek, 2026-09-01)** — a ZERO button joins the
  cursor group, order ruled as **zero · ⌥ lock · az · el**. It binds `S._tareCursor` — the same
  function the ` key, MIDI and OSC land on — so it zeroes the heading of whichever sensor holds
  the cursor role, yaw only, and cannot touch the mounting. It is an ACTION (one face, no state
  dot) and flashes its outcome, because tare is silent and a silent no-op is the case you need to
  know about mid-set: sage = heading zeroed, ember = no cursor sensor (verified live: the miss
  flash reads --accent-action and clears at 900 ms). `_flashTareBtn` now reaches both the hidden
  cabinet button (which keeps the words) and the footer button (which carries the colour).
  Addendum, same hour: the glyph is a compass pointing up, and the leftover "On the instrument"
  heading finally died — it was APPENDED IN JS over the sygaldry block (ui-imu-setup:915), which
  is why deleting the template's heads missed it and why it only showed with a live instrument.

- [x] **#318 The BNO card, final polish of the day (Ek, 2026-09-01)** — five: Router's fields go
  to the kit's host width (96 → 140 each, one line kept); the password placeholder's stray font
  had a root cause — the template puts `.set-field` on the `<input>` itself and nothing set the
  field's face, so password inputs fell to the UA font; one rule now states font for input and
  placeholder both. `Reset sensor` is the LAST row on the card. The Buttons row shows its three
  held-dots again (`.syg-button-dot`, painted from `/Buttons/state`) instead of raw numbers.
  And the "Instrument diagnostics" heading is removed — the measurements flow under Device
  settings, which Ek ruled clear enough. Card order: settings → Wi-Fi → measurements → Reset.

- [x] **#317 One Wi-Fi section, and the pill learns the real wire (Ek, 2026-09-01)** — **(1)** the
  BNO card's network facts and controls are one section: Router (ssid · password · Join on one
  line — the Show checkbox and the Connection row died; the join caveat moved into the row's own
  description), Uplink (status dot · station status · address · Radio on/off · Disconnect),
  Listening, Traffic. Instrument diagnostics keeps the five sensor measurements. **(2)** the
  sensor pill said OSC for a wifi instrument, twice over: sygaldry sensors are FILED under
  transport 'osc' whatever the wire (the real word lives in `dev.via`), and `_updateSensorGroup`
  pushed 'osc' FIRST whenever the bridge was up. Now every shown word derives via-first
  (imu-setup's transports set + event payload, S.rig's cursorVia, the head summary), 'osc' is
  appended only when nothing else is up, and `declareSensorKind` re-syncs sensor-status —
  the event used to fire before the declaration and never again, so the pill kept the stale word.
  Measured: a synthesized wifi mubone reads `S.rig.cursorVia='wifi'`, pill slot `wifi`,
  summary `wifi 1 · osc none`. My template rebuild also destroyed the five diagnostics rows via
  a bad slice — caught by the data-osc count before shipping, restored.

- [x] **#316 The BNO card, ruled again on the rig (Ek, 2026-09-01)** — four more: **(1)** "Feeds
  the sphere" is DELETED as a control — `setRole()` now implies feeding ("when you've selected
  the drop down it should just work"); the toggle, its badge and `updateFeedBtn` are gone.
  **(2)** the standing wifi-join warning note is gone (a permanent warning was noise; the Join
  button can carry the caveat when it matters). **(3)** the calibration flags are three STACKED
  kit toggles (`.imu-cal-stack`; `.syg-check` retired) beside the live `device:` readback.
  **(4)** R8 reversed: the nine measurements came home to the card as an "Instrument diagnostics"
  scrolled block at the end of Device settings — ui-sygaldry's own painter covers them again, the
  diag page's stream section and 2 Hz painter are removed, and the Link row got its status
  readout back. One orphan `</div>` from the feed-row cut closed the card early and nulled every
  polarity button — caught by the render test before it shipped, same class as #307's cabinet
  bug, opposite direction. The brief carries a second amendment note.

- [x] **#315 Round ten, corrected on the rig within the hour (Ek, 2026-09-01)** — four findings
  from playing the shipped #314, all in: **(1)** the Add-over-USB menu floated over the list rows —
  the choice now expands IN PLACE in the head (button swaps for the two filtered options; nothing
  overlays anything; the kit's floating menu CSS died unused). **(2)** the card header's first line
  was flush against the strip — `.imu-card-lede` gives it 14px. **(3)** the brief's R4 is
  REVERSED and the doors are gone: two layer headings return, renamed **Software settings /
  Device settings**, and everything scrolls — Axes and Command log are flat headed blocks. The
  align-audit round-ten checks now assert 1–2 layer heads and zero doors (the three-door shape
  lasted four hours; the brief carries a same-day amendment note). **(4)** certainty on the
  device rows: the calibration row shows `device: accel+gyro+mag` live from
  `/BNO085/calibration_enabled` (a real readback — new `calbits` format), the rate row shows
  `device: N Hz` from `configured_rate`, and the magnetometer and tare rows — where the
  firmware publishes NO readback — say `sent hh:mm` instead of pretending. The Device settings
  lede states the rule: nothing here claims certainty it does not have. Follow-up for the
  firmware list in BNO085-CONTROL § next-steps: a magnetometer state readback would upgrade that
  stamp to truth.

- [x] **#314 Sensors round ten shipped (brief: docs/archive/SENSORS-ROUND-TEN.md; Ek ruled S1/S2/R11,
  2026-09-01)** — the page and the pills, per the brief's eleven rulings. Rulings taken: **S1** =
  one `Add over USB` button with a two-item menu, each item keeping its own filtered picker —
  measured first: electron-main.js:909 answers the port chooser by taking the FIRST port in the
  list, safe only because the instrument's request arrives vendor-filtered (0x2e8a); an unfiltered
  merged picker would auto-grab any tty. **S2** = the zero row is app-side only ("Where forward
  is": Set mounting · Zero heading · Clear, status + heading-zero time in the description);
  `Tare now`/`Persist` stay on-device behind the Instrument settings door — merging would
  re-orient the stream mid-gesture while the app's calibration measures it, the tare basis stays
  mag-referenced with the mag off, a GRV Z-tare cannot persist, and BNO085-CONTROL §159 lists
  persistence itself as unverified. **R11** = yes: the input pill is `input · mic/live/file`.

  Shipped: R1 (Sources → head summary + full copy as the empty state), R2 (`usb` everywhere),
  R3 (three attach controls), R4 (no layer heads), R5 (one zero row), R6 (NWU column gone, 5
  cols), R7 (one storage door, rendered only with storage), R8 (nine measurements → Diagnostics'
  "Instrument stream", painted by ui-sygaldry's exported `paintOscInto` at 2 Hz while open —
  S3: rate/accuracy stay diag-computed, nothing duplicated), R9/R10 (`S.rig` published from
  `_updateSensorGroup`; both pills fixed-width — measured constant across every state, sensor
  125 / input 112 px — and the regex-on-hidden-footer read is an audit failure by grep now).
  Five checks live in align-audit's "sensors round ten" section; all green.

  **Deviations from the brief, each for a measured reason:** the slot is **42px** not 40 (FOUND
  measures 41 at --fs-eyebrow); "Rescan all in the title bar" did not exist — nothing to drop;
  check #3's "exactly 3 doors" is 2-or-3, because R7's own only-with-storage rule gives a plain
  OSC sensor two; the **Command log** door is NEW code (the mockup shows it, the brief's §3 never
  ordered it) — `S._cmdLog`, appended by both control paths, capped 200; the empty state is
  UNREACHABLE in Electron (the tty list is never empty) so its render is a browser-mode fact; the
  Buttons row on Diagnostics reads raw `/Buttons/state` values, not the card's three dots.
  **Deferred:** hardware confirmation that the Instrument settings door and diag stream behave on
  a live sygaldry link (no instrument was attached during the round), and browser-audit's view of
  the new empty state.

- [x] **#313 Sources are doors, the list is things: the mubone instrument stops being a "source"
  (Ek, 2026-09-01)** — *"the sources are wifi, serial/usb, and OSC. mubone instrument comes in
  from wifi… the sources table with the status should just be that, information. it's the table
  below… that should have all the buttons to connect. if it's able to say connect amber-blenny
  that means it sees amber-blenny — that should be shown in the list."*

  **Sources → three rows, information only.** Wi-Fi / Serial · USB / OSC, each a status badge, no
  buttons anywhere in the table. The duplicate Rescan died (the list header already had one);
  "Add USB device" (browser-only) moved to the list header beside it.

  **The list owns every connect.** `_entries()` gains `cat:'syg'`: known mubone instruments
  with a remembered wifi address and no live link render as rows — `name · mubone · wifi ·
  address` with Connect (→ `sygConnectKnown`) and ✕ (forget) — so a seen instrument is listed
  like every other sensor and counts in "available". ui-sygaldry serves the offers as DATA
  (`sygOffers()`) instead of rendering buttons into Sources; its `renderKnown`/#sygKnown/
  #sygIdle and the `.syg-actions` CSS are gone; its render() pokes `S._refreshSensorList`.
  "Connect over USB" (the one click a browser requires) sits in the list header, and the
  mubone-vendor tty row's pointer text now names it. The attach status line (`sygStatus`/
  `sygUnsupported`, ids unchanged) lives under the list whose verbs it narrates.

  Verified live: Sources renders 0 buttons; header = Connect over USB · Rescan; a remembered
  amber-blenny appears as a list row with ✕ | Connect; the mubone tty row points at the header.
  audit:align and docs-audit green.

- [x] **#312 The Sources table's right side, seen on the rig: per-row grids make max-content a
  different width in every row (Ek, 2026-09-01)** — *"the status badges on the right are totally
  not aligned and all wonky."* #310's table had four columns with a max-content action column —
  but each `.set-table-row` is its own grid, so max-content resolved PER ROW and the 130px
  status column landed at a different x wherever a row had buttons. Fixed by the deck's own rule
  (the one audit:align holds every .set-row to): status + action are ONE right-aligned group per
  row, flush to the table's right edge. Measured after: Listening, Rescan, 1 sensor, Connect over
  USB and the Status header all end at 1265.0 px, spread 0. Lesson for the next table: a
  max-content column is only shared geometry when the rows share one grid — with per-row grids,
  every non-fixed column must be the LAST one and right-aligned.

- [x] **#311 The sensors page measured against its own contract — and a page-wide rhythm bug
  found under it (Ek, 2026-09-01)** — *"the spacing and design of the sensor page is all over the
  place, i want it to use the consistent design params we set."* Measured every box against
  SETTINGS-GUI § 2/3 rather than eyeballing. Three deviations were #310's own inventions, fixed
  to contract numbers: card margin-top 14 → 0 (the section's 30 is the rhythm), card insets
  20/16 mixed → 16 everywhere (the device list's inset), layer heads ("In mubone", the device
  layer) mt 0 → the section's 30.

  **The fourth was never designed and predates today:** sections sat 42.8px apart, not 30 — the
  borrowed `.mu-dialog` is flex with the rig view's 0.8rem gap, which stacked 12.8px onto every
  section margin. Audio, visuals and sensors all ran 42.8; pins (hosted from `.device--commit`,
  not a mu-dialog) ran the contract's 30 — so the pages disagreed with the contract AND each
  other, invisibly, since the shell was built. `.in-settings { gap: 0 }` snaps all ten pages to
  one rhythm. Measured after: 30.0 between every section, audit:align fully green (sensors'
  13 control groups end at one x, spread 0px).

- [x] **#310 The sensors page: Sources becomes a table, the sensor becomes a thing (Ek,
  2026-09-01)** — *"simplify (without loosing any info)… if it's a bunch of settings maybe it
  should be in a table form, also i was imagining the connected sensor is in a box of sorts to
  show that it's like a thing."* Both asks matched faults the page's own contract already names.

  **Sources → a kit table.** Four full `.set-row`s of static prose (three with no control —
  SETTINGS-GUI: "a note not attached to a control is documentation") became
  `source · what arrives · status · action` at a third of the height, which puts the device
  list on the FIRST screen. Every id (`imuWifiStatus` etc.) unchanged, so `renderSources()`
  did not move. The one clause cut ("the browser will not hand over a port without one") moved
  verbatim to the Connect button's tooltip.

  **The selected sensor → a boxed card.** The device list's own box geometry reused as a
  container (`.imu-setup-card` + `.set-card-head`): name, identity badge and a right-aligned
  Hz badge in a 52 px header strip, the In-mubone rows and the axes table inside. A composition
  of two kit elements, not a twelfth — recorded in SETTINGS-GUI § 7. Also: the Mounting
  description cut from seven lines to the contract's one sentence (reasoning already verbatim in
  the button tooltip), and the "osc · osc" identity badge de-duplicated (kind == transport says
  the word once).

  docs-audit's selector-depth check rejected the first CSS draft (five selectors past
  `.in-settings` + one step) — flattened with real classes instead of allowlisting, and two
  border-suppression rules turned out to match nothing and were deleted rather than shipped
  blind. Measured with fresh screenshots at both scroll positions; audit:align and docs-audit
  green.

- [x] **#309 The axes table: the "persisting polarity" was the BUTTON's face, not the data — and
  the Mute column goes (Ek, 2026-09-01)** — *"the polarity of the pitch and yaw keep persisting
  when i used to do manual changes… check that. also we can remove the mute function and column
  from the tare axis table."*

  **Measured first:** his stored signs (`mubone_sensor_cal` → osc-amber-blenny: pitch −1,
  yaw −1) are byte-identical to `defaultQuatAxisMap()` — the −1s are the device-euler → viz
  handedness conversion every sensor gets, not leftovers of his manual era. Nothing had persisted.
  What made it READ as persisted: `updatePolBtn` marked `.reversed` (amber, the "changed"
  accent) on any sign < 0, so an untouched sensor showed pitch and yaw burning amber forever. The
  button now compares against `DEFAULT_VIZ_SIGN` and highlights only a sign that DIFFERS from
  the convention default.

  **The Mute column is gone** — header, roll's button, the empty pitch/yaw cells, the 7th grid
  column in settings-gui.css, `toggleRollMute`/`getRollMute`, and the legacy button CSS in
  style.css. Its one remaining reader was `findForwardAxis`'s priority-1 (roll-muted = forward
  axis), which still honours a stale saved `mute:true` harmlessly; the prefs migration's
  rollMute half is dropped so nothing can plant a mute no control can see or unset.

  **#308 fixed on the way** — `dev.getCalibratedEuler()` stopped existing in the 2026-08-31
  calibration rewrite while the card's repaint kept calling it, so every repaint of a live card
  threw and died: the Calibrated column showed "—" forever and the rate badge froze. Now a real
  `getCalibratedEuler(dev)` in imu-setup.js returns the slot's zeroEuler in viz terms. Verified
  on a synthetic OSC card: 6-column header, pitch/yaw quiet at "−", raw 13.4/22.3/8.5 → calibrated
  13.4/−22.3/−8.5, no repaint exception.

- [x] **#307 The RO button, rollSource and _gateRoll are retired (Ek, 2026-09-01)** — *"the roll
  icon and roll lock function in the footer, we can remove that. since roll never reaches the
  sphere/viz. if we want to use roll it's still available in mapping."* With the camera taking no
  roll (#300/#306), the button's one remaining job was gating roll as a mapping INPUT — and Ek
  retired that too: mapping rows read the sensor's roll live via `getCursorEuler`, and a row you
  don't want is disabled per-row in Settings → Mapping. Gone: `#tcRollCycle` (footer),
  `#rollSourceSeg` (cabinet — the state died with it, so there was nothing to move out),
  `S.rollSource`, `_gateRoll`/`_rollHold` (sensor-mapping.js), and the rollSource rows in
  main.js / tile-layout.js. The footer's cursor group is three buttons: AZ · EL · ⌥.

  **The removal shipped a broken cabinet for twenty minutes** — the roll row's opening tag was
  deleted but its closing `</div>` survived, closing the cabinet's container early and silently
  re-nesting everything after it. Nothing threw; `getElementById` still found every control;
  rig-audit § C stayed green. `npm run audit:align` caught it — three invariants (the freeze
  wash's z-order, the tool rail state) broke for no visible reason, a `git stash` bisect proved
  it was today's tree, and the diff showed the stray closer. The audit's whole thesis ("structural
  and invisible until read as numbers") demonstrated on the day's smallest change.

- [x] **#308 `dev.getCalibratedEuler is not a function` — sensor card repaint throws — FIXED with #309**
  — Found in `.dev-bridge/console.log` while chasing the align failure (first hit 16:47, before
  the roll removal; fails at HEAD too). `ui-imu-setup.js:1067` calls `dev.getCalibratedEuler()`
  but no such method is defined anywhere in `js/` — only a comment in imu-setup.js:1323 refers
  to it. Fires whenever the sensors settings page repaints a card with a live sensor, so the
  calibrated-euler readout on the card can never have worked. Define the method (imu-setup owns
  the device object) or drop the readout; either way the card currently kills its own repaint
  mid-function.

- [x] **#306 Square one, from the real stream: the camera is UPRIGHT-ONLY, and the flip was
  dropout teleports all along (Ek, 2026-09-01)** — supersedes #304/#305's branch machinery.
  *"it's still flipped. can we go back to square one with this sensor between the raw data that
  sygaldry is sending into this app and rebuild from there?"* We did: a per-packet tap recorded
  128 s of the real sensor (`osc-amber-blenny`) at four stages — raw, post-cal, pointing, camera
  — while Ek performed the failing gesture. Recording:
  `scratchpad/rig-recording.json` (session-local). What it showed, none of which any synthetic
  test could have:

  · **The flip's real cause.** A 4.5 s wifi dropout swallowed an entire descent; on resume a burst
    of stale queued packets arrived (tiny inter-arrival times, defeating any dt-based stale check)
    and then the pointing TELEPORTED 84° in one packet. The old servo resolved that jump through
    the inverted branch and the camera stayed upside down for the remaining minutes — upness never
    exceeded −0.04 in the whole recording. Pole noise (#305's theory) was a sub-case at best.
  · **Real over-the-top gestures round the pole at 85–86°, never crossing it** — with Ek's actual
    mount (a near-180° Y rotation), "straight up and over" misses the pole by 4–5°. So the #305
    cone (>85°) never engaged, and the inverted/backbend branch had no genuine gesture to serve.
  · **The link, not the pipeline, is the jitter.** Raw sits byte-identical then steps ~1.15°
    (a change-threshold or quantization upstream — check the sygaldry report settings,
    docs/BNO085-CONTROL.md); ~100 Hz median with p99 27 ms and 14 gaps of 0.6–4.6 s in 128 s —
    RIG-RUNBOOK numbers, not code. Below the link the pointing is clean: 0.15° wander over 30 s
    at rest (raw wanders 0.95°, mostly device twist, which the pointing path strips).

  **The law now** (`cameraFromPointing`, renderer.js): the same offset servo, with pitch CLAMPED
  to ±90 — `camQ = Ry(A)·Rx(P)`, cos P ≥ 0 always, so an upside-down world is UNREPRESENTABLE
  and pitch can never reverse, by construction rather than by branch bookkeeping. Two escapes,
  both found by replaying the real recording: when pitch pins at the pole and the hand keeps
  going (> `SENSOR_CAM_OVERSHOOT_DEG`), yaw comes around toward the target's true azimuth at
  `SENSOR_CAM_SWING_DEG_S` — the deliberate over-the-top pan, which also breaks the dead spot
  where a far-side descent sits at exactly opposite azimuth with zero horizontal offset (the
  replay stuck staring at the zenith for 4 s without it); and a pointing step >
  `SENSOR_CAM_TELEPORT_DEG` between consecutive packets reacquires upright — a clean cut, which
  is what a 4.5 s dropout deserves. `SENSOR_POLE_CONE_DEG` and the inverted branch are deleted.

  **Verified against the recording itself** — the only test that ever reproduced the bug: 0 ms of
  crosshair gap > 8° below 80° elevation across all 128 s, six teleports absorbed as cuts,
  inversion impossible. In-app: rest centring 0 px at el 0/45/75/85/89.9, 6/6 noisy retraces
  upright, and the deliberate down-the-back now stays upright with the camera coming around.

  **For the rig, two link-level actions** (the jitter is here, not in code): re-run the
  RIG-RUNBOOK channel procedure — 14 gaps in 128 s is its "bad wifi" regime — and check the
  sygaldry/BNO085 report threshold behind the ~1.15° quantization steps.

- [x] **#305 The pole cone freezes yaw, so the branch is decided by pitch, not by noise (Ek,
  2026-09-01)** — **superseded by #306**: the real recording showed the rig's flips were dropout
  teleports, not pole-noise branch flips, and the cone never engaged on real gestures (they round
  the pole below 85°). The inverted branch is gone entirely, taking the cone with it. — the first rig-played bug in #304's servo. *"i pitch up to the pole then go a bit
  more, like a 100 degree pitch. when i come back down the world is upside down… the pitch up
  becomes pitch down."* Root cause: azimuth within a few degrees of the pole is ambiguous inside
  sensor noise, and the yaw servo was listening to it — so WHICH branch the camera took out of a
  crossing (upright vs the inverted backbend) was a coin flip on sub-degree wobble. A retraced arm
  could come down on the inverted branch and stay there. My #304 tests missed it because the
  synthetic paths threaded the pole with mathematically exact azimuth — the gesture was tested,
  the gesture WITH NOISE was not; that is now the fourth line of the verify-before-believing rule.

  **The fix** (`SENSOR_POLE_CONE_DEG` = 85, state.js; one guard in `cameraFromPointing`):
  inside the cone the yaw accumulator FREEZES and pitch alone carries the view through along the
  frozen meridian. Retrace unwinds; deliberate continuation inverts; sideways noise can flip
  nothing because yaw is not listening. Geometry makes it cheap — every in-cone direction is
  within 10° of view centre, so the cost is a few pixels of transient crosshair drift and a ≤10°
  one-off yaw catch-up at cone exit.

  **Measured:** offline, 40/40 noisy retraces (±0.35° az noise) come home upright with worst
  crosshair gap 0.39°; in-app, 6/6 seeded runs of the exact reported gesture end at upness +1.00
  and 0 px, while the deliberate over-and-down-the-back ends at upness −0.96 (the genuine
  backbend, preserved). Regression: pole crossing still 1.00° max frame step at 1°/step, rest
  centring 0 px at el 0/45/75/85/89.9.

- [x] **#304 The simpler route: sensor mode is surface mode with the sensor as the trackpad
  (Ek, 2026-09-01)** — supersedes the camera-derivation halves of #300–#303 in one stroke.
  *"this is getting realyl complicated… i want it to work like in steer mode. the
  cursor/crosshair doesn't move. can you find a simpler route."* There was one, and it was
  already in the codebase: steer and surface never have pole problems because their camera is
  INCREMENTAL — the world-yaw · camQ · local-pitch composition the renderer documents as "no roll
  accumulation, clean pole traversal". Sensor mode was the odd one out, SOLVING for absolute
  azimuth — and azimuth is the thing the pole breaks (~1/cos(el) per degree of hand wobble).
  Every knee, fade, τ and glide of the day was compensation for that solve.

  **The rule** (`cameraFromPointing`, renderer.js — ~25 lines, ZERO tunables): the camera is two
  accumulators, yaw A about world Y and pitch P about local X, `camQ = Ry(A)·Rx(P)`; each update
  measures the pointing's offset from view centre IN THE FULL CAMERA FRAME and nudges both — a
  servo that pins the crosshair to centre by construction. P passes ±90 over the top exactly as
  surface mode's pitch does. `cursorQ` stays the true pointing, and the servo's target IS that
  direction, so painting stays absolute. `S.grainOverrides`-style state: none. Constants: none.

  **Three bugs were found and fixed BEFORE shipping, each measured:** (1) horizontal offset taken
  in the yaw-only frame is azimuth through the back door — the disease re-imported; full camera
  frame. (2) vertical offset must be `asin(fc[1])`, not `atan2(fc[1], fc[2])` — a target behind
  the camera reads ~180° of phantom pitch and whips. (3) past the pole the yaw response
  `δA·cos(P)` flips sign, so the raw update is positive feedback on the inverted branch — it
  blew up 83° during a far-side descent in the first in-app test; sign-corrected, the same sweep
  measures 1.00° max frame step at 1°/step hand input.

  **Verified end-to-end** (gesture tests, per the #303 lesson): crosshair 0 px off centre at rest
  at el 0/45/75/85/89.9; ≤6.5 px through a 90° turn at el 85; ≤12.5 px circling the pole briskly;
  ≤1.5 px crossing the pole; 0.5 px after a 1000°/s pan. World motion is bounded by TRUE hand
  motion everywhere — ±25° az tremor at el 88 moves the frame only by the hand's real ±0.87°
  direction wobble, and circling the pole turns the world at hand rate, no pirouette. Over the
  top the world does the surface-mode backbend (inverted until you come back over); steer-faithful
  and continuous — judge on the rig whether the persistence of the inverted branch after an
  over-the-top excursion feels right for a worn instrument, and if not, the escape is a deliberate
  recenter gesture, not a filter.

- [x] **#303 Lazy pursuit: the yaw fade becomes a finite-τ follow, and the whole state machine
  collapses to one rule (Ek, 2026-09-01)** — **superseded by #304 within the hour** (the whole
  absolute-azimuth approach went, not just its dynamics); kept for the "test the gesture, not the
  pose" lesson, which is what caught both this design's hole and #304's three pre-ship bugs. — supersedes the yaw half of #301/#302. *"your fixes
  arn't landing, the cursor still moves off it's position when i'm at the poles."* They were
  landing; the DESIGN had a hole: a follow gain of exactly ZERO (fade end 85°) meant the yaw gap
  above ~75° never closed, so painting azimuthally up high parked the crosshair off centre until
  you came back down — precisely what he reported. My verification had only checked the crosshair
  at rest-ALIGNED poses, which is how a design hole passed a green suite: the test must include
  the gesture, not just the pose.

  **The rule** (`cameraFromPointing`, renderer.js): pitch is the cursor's to ±90 (unchanged from
  #302); yaw is assigned exactly below `SENSOR_YAW_LAZY_START_DEG` (60°), and above it pursued
  with a time-constant rising smoothly to `SENSOR_YAW_POLE_TAU_S` (0.8 s) at the pole — lazy,
  never stopped. A finite τ closes every gap: the crosshair leads during a deliberate turn and
  comes home to centre when the hand pauses, at EVERY elevation. What τ still buys at the pole is
  tremor rejection — azimuth there swings ~1/cos(el) per degree of hand wobble (57× at 89°), and
  following that exactly is the world-spinning-under-a-still-hand that started the redesign.
  The fade/glide/catch/feed-forward machinery of #301 is deleted; one smoothed state remains.

  **Measured:** at rest the crosshair is (0.0, 0.0) at el 0/60/75/85/89.9; a deliberate 90° turn
  at el 85 leads 34 px and settles to (−1.4, 0) with the world following to within 1.7° of the
  target; ±25° az tremor at ~5 Hz at el 87 moves the world 2.71° total; a violent pan below 60°
  has 0.00° lag. **What the pole DOES now:** a still hand = still world + centred crosshair;
  sustained turning brings the world around gently. If NO world motion at the pole is ever wanted,
  that is τ → ∞ — and then a centred crosshair is geometrically impossible (that trade is #300's
  measurement); the dial is `SENSOR_YAW_POLE_TAU_S`, and it and LAZY_START are the two numbers
  to tune on the rig.

- [x] **#302 The pitch knee dies the same day: full pitch, centred crosshair, the fade was the
  fix all along (Ek, 2026-09-01)** — **the yaw half is superseded by #303** (fade-to-zero → lazy
  pursuit); the full-pitch half stands. — *"the radius/cursor on the screen still moves off center when
  i get to the poles, i expect it to be fixed in the center in sensor mode."* And he was right for
  a reason the clamp's own measurement had been hiding: the sin(e) pole spin comes from yaw
  MOTION near vertical, and #301's yaw fade already stops yaw there — so the pitch ceiling was
  solving the wrong half. With yaw held, a camera pitched to 90 is just a fixed orientation, and
  the geometry turns friendly: a yaw error shows on screen as cos(el)·err, so at el 88 even a 180°
  azimuth gap is 4° from centre, and at the pole itself every azimuth is the same point.

  So `cameraFromPointing` now passes pitch through untouched (crosshair vertically centred at
  EVERY elevation) and keeps #301's yaw regimes exactly, with the fade decoupled onto its own
  constant (`SENSOR_YAW_FADE_START_DEG` 60; `SENSOR_PITCH_KNEE_DEG`/`_MAX_DEG` deleted).
  Measured: crosshair at (0.0, 0.0) at el 0/60/75/85/89.9; spin at el 85 during 60° body yaw still
  0.00°; after 60° of azimuthal painting at el 85 the crosshair sits 27 px off (the cos-el residual,
  the one honest transient) and returns to (0.0, 0.0) after a full over-the-top crossing, camera
  pitch riding 80→90→80 with yaw settling on the far azimuth by glide. The only cost left: while
  the world is held near a pole, sweeping azimuth drifts the crosshair a few degrees sideways —
  that drift IS the painting being done, and it vanishes at the pole and on every glide-back.

- [x] **#301 The clamp becomes a curve — nothing about the camera switches any more (Ek,
  2026-09-01)** — **the pitch half is superseded by #302 the same day** (the knee is deleted;
  pitch is now full-range) — the yaw regimes below shipped and stand. — #300's v1 was RIGHT functionally and jarring to play: *"when it gets to the clamp
  threshold the sphere freezes and the cursor is allowed to move, that breaks the continuity feel…
  when i come back out of the pole zone it snaps to the new azimuth."* Both edges are gone; all of
  it lives in `cameraFromPointing` (renderer.js) and four constants in state.js.

  **Pitch — a soft knee, not a wall.** 1:1 below `SENSOR_PITCH_KNEE_DEG` (60°), then a C¹ Hermite
  cubic (entry slope exactly 1, so there is no corner to feel) compressing to
  `SENSOR_PITCH_MAX_DEG` (74°) at the pole. The crosshair is never "released" — it DRIFTS:
  measured 0° off-centre at el 60, 2° at 70, 7.4° at 80, 16° at 90, with the largest per-degree
  step exactly 1.0 across the whole sweep.

  **Yaw — three regimes, boundaries continuous.** EXACT below the knee (assign, zero lag — a 15°
  catch window dwarfs the ~2.5° a 1000°/s pan advances per 400 Hz packet; measured lag 0.00° through
  a violent pan). EASE above it: the follow gain fades to zero by `SENSOR_YAW_FADE_END_DEG` (85°),
  so pole-zone azimuth — which swings tens of degrees per degree of hand wobble as GEOMETRY, not
  noise — cannot spin the world (60° of body yaw at el 85 → 0.00° of view motion, again). GLIDE
  when behind: an exponential pursuit (`SENSOR_YAW_GLIDE_TAU_S` 0.15) **with velocity
  feed-forward**, re-locking within 2°. The feed-forward is the part a fixed-rate slew could never
  do, and both failures were measured before it went in: a 240°/s slew chasing a 1000°/s pan fell
  28° behind and never landed, and once armed it rate-capped every ordinary fast pan; pure pursuit
  without feed-forward trails any moving hand by vel·τ. With it: a 118° gap (azimuth swung 120°
  while faded at the pole — the world correctly did not follow) closed 118 → 46 → 28 → 17 → 9 →
  4 → 0 **during a sustained pan** and stayed locked after.

  **Feel on the rig:** the knee (60) and max (74) are taste; the glide τ (0.15 ≈ a 0.7 s worst-case
  180° swing) is taste; the fade end (85) is not — below ~82° the azimuth arithmetic is fine and
  the fade exists for the geometry.

- [x] **#300 The sensor drives the CURSOR; the camera is derived — roll and the pole singularity
  leave the sphere together (Ek, 2026-09-01)** — closes **#296**, whose symptom list this finally
  explains. *"to paint with the mubone we only need az and el, it's a position vector on a 2d map…
  the roll should not make it to the actual sphere."*

  **The diagnosis #296 was waiting for, measured end-to-end** (synthetic quats through
  `handleSlotQuaternion` → `getSensorCamQ` → `applyAxisSources` on a private instance): with
  roll held at exactly 0.00 the whole way, body yaw at elevation e still became **sin(e) of pure
  view-axis spin** — 42.4° of 60° at e=45°, 59.8° at 85°, 60.0° at 89°. And pushing pitch past
  vertical made output pitch FOLD BACK (90→92 in read 88 out) with a 180° yaw snap in one step.
  **The spin was never roll**, which is why months of muting/blocking/filtering roll could not fix
  it: pinning the reticle to screen centre makes "which way is up on screen" the heading's job near
  the pole. A tripod head has the same property. No filter fixes geometry.

  **The model now** (all in `renderer.js`): `applyAxisSources` strips a sensor quat to POINTING —
  yaw and pitch through the az/el locks, roll structurally gone, no rollSource consulted. Single-IMU
  sensor mode sets `S.cursorQ` to that pointing (so every consumer — grain, paint-ticker, erase,
  audio, mapping — reads the true az/el through the existing `getCursorLonLat()` rail) and derives
  `S.camQ = cameraFromPointing(pq)`: yaw follows, pitch clamped (a hard 70° in this first build — see #301,
  chosen against `FOV_DEG` 80 so the pole sits 20° inside the view). Above the clamp the camera
  HOLDS — yaw too, because azimuth near the pole is hypersensitive as physics and unstable as
  arithmetic — and only the reticle keeps climbing. Both writers (renderer RAF and main.js's 400 Hz
  arrival path) make the same two writes.

  **Verified on a private instance:** device roll 30° constant → camera roll 0.00 at every pitch;
  60° of body yaw at el 85° → **0.00° of view motion** (was 59.8°) while cursor lon tracks; pole
  crossing 60°→120° → camera capped at 70° with yaw held, cursor goes 80→90→80 onto the far
  azimuth, no bounce, no whip — the re-acquire below the clamp is a fast 180° cut, accepted for v1
  and the first thing to soften (slew-limit camera yaw) if it grates. Reticle screen position:
  **0px off centre at el 0 and 60** (the below-clamp promise), −63px at 80, −125px at 89.9. el lock
  captures on first arrival then holds through motion (21 held while pitching to 75); cursor lock
  (#297) unchanged.

  **What died:** `_axisLockFrozenRoll`, roll's third of `applyAxisSources`, the `cursor roll`
  mapping destination (a stale saved row degrades gracefully — every lookup is `find()?.` with a
  fallback), and `S.detethered` (its one reader is fixed; the name went false the day single-IMU
  mode started setting cursorQ). **What stayed:** `rollSource` + the RO footer button, now gating
  exactly one thing — roll as a MAPPING INPUT (`_gateRoll`) — which its tooltip now says; and the
  whole two-IMU frame path, untouched. `docs/EULER-VS-QUAT.md`'s banner records that its
  roll-mute framing is history.

  **Still to feel on the rig** (sensor was not connected during any of this): the clamp value
  (70° is arithmetic, not taste), the 180° cut after an over-the-top crossing, and whether the
  centre anchor dot is missed in sensor mode (cursorQ set → the fixed centre dot no longer draws,
  renderer.js:2162).

- [x] **#297 Cursor lock IS the AZ + EL lock — the ⌥ mechanism is sunset (Ek, 2026-09-01)** —
  *"i just want the option key to basically be a shortcut to lock az and el and if it's in steer and
  surface it also frees the cursor. i kinda want to sunset this opt functionality and just use the
  built el and az lock."* Also: *"on off mapped, i think that's too complicated."* Done 2026-09-01.

  **Two mechanisms froze one sphere.** ⌥ set `S.altLocked`, which the steer block tested directly
  (`renderer.js`), and that had nothing to do with `azSource`/`elSource` — so the footer could
  read "free" while the sphere would not move, and the two could disagree in the other direction
  too. `S.altLocked` is now DERIVED: cursor lock is `axisHeld(az) && axisHeld(el)`
  (`cursorLocked()` in main.js), and what is left of the flag is the pointer half only —
  `S._applyCursorLockPointer` in events.js, driven on the edge from `setAxisSource()`, which
  every route already writes through (footer, cabinet segments, the patch table's PARAM_REGISTRY
  setter and therefore preset load, MIDI, OSC, and the mapping page's auto-arm).

  **The pointer half is steer/surface only, and that gate is load-bearing.** `S.altLocked` is what
  `grain.js:693`, `renderer.js:2154/2170` and `sensor-mapping.js:354` read to switch the cursor
  from the camera-driven `getCursorLonLat()` to a FROZEN MOUSE PIXEL. In sensor mode with a
  tethered cursor (`S.cursorQ === null`) letting it go true teleports the cursor to wherever the
  mouse was last seen. A camera-mode change re-runs the edge for the same reason — lock in surface,
  switch to sensor, and a stale `altLocked` would leave the cursor reading that dead pixel.

  **A live bug fell out.** The steer auto-rotate branch tested `!S.altLocked`, not the axes: with
  azimuth locked, moving the mouse OFF the canvas resumed the very yaw drift the lock exists to stop,
  and moving it back stopped it again. A lock you can leave by walking away from the canvas is not a
  lock. Now `!axisHeld(S.azSource)`.

  **Three copies of the alt-lock body became one.** events.js, `midi.js`'s `alt_lock` case and
  `js/osc.js`'s `/spatial/lock` case each hand-wrote it, and the two outliers had drifted: no
  `_syncSessionAltLock`, no surface overlay, and `#canvasWrapper` by name where events.js follows
  the live canvas (`_canvasHost`, the #141 trap). So a pedal and the ⌥ key left the app in
  measurably different states. Action id `alt_lock` → `cursor_lock`; the OSC address
  `/spatial/lock` is unchanged and still accurate.

  **The buttons are boolean.** Click = held ↔ free. The STATE still has three values, because
  `mapped` is real — but its door is Settings → Mapping, which arms the axis when you target it
  (`_armCursorAxis`), and clicking the footer button is the manual disarm that function
  deliberately leaves to a human. So the button keeps three faces and has two actions. A MIDI/OSC
  bang cycles held ↔ free for the same reason; the explicit string sets still reach all three.

  **⌥ has a face** — `#tcCursorLock`, a padlock captioned `⌥`, lit when both axes are held
  however you got there, so the two doors can never show different answers. Locking stashes each
  axis's previous value, so a `mapped` axis comes back mapped rather than being silently disarmed.
  A bracket roping it to AZ and EL was built and then **removed** — Ek, on sight: *"remove the
  bracket i suggested it looks bad."* The row is four plain buttons; proximity and the ⌥ caption
  carry it.

  Verified on the rig: 20 state transitions across all three camera modes (including mode changes
  while locked, a mapped axis surviving a lock cycle, and the OSC/pedal path), `audit:align` and
  `docs-audit` green. `rig-audit` exits 1 — but on the ONE failure below (#299), which fails
  identically at clean HEAD with this change stashed; every suite this change touches is green.

- [x] **#297b The sensor-mode pointer, and the bracket that lasted an hour (Ek, 2026-09-01)** —
  Two follow-ups from playing #297. *"in sensor mode (when the sensor is not connected) i don't see
  the real mouse cursor above the viz area, only in the surrounding footer/header rails"* — not a
  #297 regression (the `cursor: none` write predates it), but a real contradiction:
  `applyCameraMode`'s sensor branch said "hide cursor, mouse is free for UI" in one breath, and
  since #291 the belt and both rails float OVER the stage, so the hidden region was exactly where
  those controls live. Now the stage cursor has ONE owner — `S._syncStageCursor` in events.js:
  visible in sensor mode (the mouse never drives the sphere there), hidden in steer/surface (the
  mouse is the instrument and the app draws its own reticle), and cursor lock overrides while on.
  One owner because the two previous writers ran in an order that undid each other on a mode change.
  And the `.bb-ax-tie` bracket was removed on sight (*"it looks bad"*) — its markup, CSS, class
  toggle, three align invariants and design-system paragraph all came out the same day, per the
  label-it-the-same-day rule.


- [x] **#300 The fan flashed and the glow gave up (Ek, 2026-09-07)** —
  Two faults found on one slow patch (500 ms period, 500 ms grains, k = 99). The reach fan blinked
  at the grain rate because it sat inside `if (_glowCache.size > 0)`: the selection vanished for the
  frame or two between one grain expiring and the next onset. It now draws on the pool's freshness
  alone — *"it is the selection area, not the grain glow"*. And the glow's two faces were switched
  on duration, so 60 ms grains on a 500 ms period fell to the density face, which is a bare core
  over an already-painted mark and reads as nothing: the switch is now `dur >= GLOW_MIN_MS ||
  period >= GLOW_MIN_MS`, the period frozen with the stroke like its duration. `pins-audit` § K
  counts a frame with an empty glow map, § K2 is new. `mark align` + `pins` green; `mark align`'s
  1.95 s burst check flakes identically at clean HEAD with this stashed.

- [x] **#301 One glow face (Ek, 2026-09-07)** —
  Ek played the seam #300 had just moved: *"around above 77 ms i see the big circles, then when i go
  under 77ms those big circles disappear and i see the density glow"*. The seam was the fault, not
  either side of it — a performance surface must not change its visual language under a knob — and
  his call was for the smaller mark (*"the big white circles get crazy busy"*). So the two faces are
  one: the core, sized and lit by heat, at every duration and every rate. `entry.exact`, the
  threshold and the period plumbed through the bridge for it are all deleted; the grain's length
  still sets how long its mark stays lit, floored at `GLOW_MIN_MS`. `pins-audit` § K2 rewritten to
  count the arcs a frame issues — eight marks, not sixteen, and the same count slow or fast.
  `mark align` + `pins` green.

- [x] **#302 The glow's presence, without a seam (Ek, 2026-09-07)** —
  *"can we find a middle ground for the glow face? now i cant really pick it out for slow ones"* —
  #301 deleted the ring and gave nothing back for it. The middle ground is a knob on the same mark
  rather than a second mark: `glowSolo` ramps 0 → 1 as the mean gap between onsets goes from
  `GLOW_MIN_MS` to four floors past it, doubling the core and lifting its alpha, so a lone grain
  reads and a stream keeps exactly the weight Ek picked at 74 ms. The gap comes from a decayed
  onset load (`glowOnsetGapMs`, tau 1500 ms) counted per grain, so a k-all burst reads as the crowd
  it is. `_GLOW_BINS` 4 → 6, because at four steps the alpha ramp had a visible edge in it.
  `pins-audit` § K2 walks the ramp for monotonicity and step size. `mark align` + `pins` green.

- [x] **#303 One glow mark, no weighting at all (Ek, 2026-09-07)** —
  *"i don't want different core or alphas, i want the same. use the x2 and 0.92 alpha for all"* —
  the third and last deletion in the same thread. The onset-rate ramp from #302 and the per-mark
  heat that predated every version of this are both gone; `GLOW_CORE` (0.84) and `GLOW_ALPHA`
  (0.917) are the ramp's top end, applied to every sounding grain. `activeGrainMap` entries are down
  to `{ expiry, glowColor }`, the alpha bins to a single batched path. Depth still sizes the core —
  that is position, not weight — and alpha ignores it so the far side stays findable. `pins-audit`
  § K2 now asserts sameness: a slow lone patch and a short hammered one must issue identical arcs at
  an identical alpha. `mark align` + `pins` green.

- [x] **#304 The lens page's k, fill and the metrics under them (Ek, 2026-09-07)** —
  *"there's a bit of an issue with the lens engine's k count… i need alot of help thinking thru
  this cause it's confusing."* Two questions were wearing four rows. `fill` folded into k's row as
  the leading capsule (Ek picked the shape); the growing slider max deleted for a fixed log scale
  1–`K_MAX` (1024); `radius`, `depth` and the capsule dropped in nearest mode, where all three are
  bypassed in `grain.js` and the sheet had been drawing them live; and the scheduler's own
  `kPool` / `kCount` brought out of the perf monitor onto the rows that cause them — reach on
  `radius`, `taken / k` on `k`, hot when they meet. Five new invariants in `align-audit`
  (the track measured 40px before the columns were narrowed). `engine` + `palette` + `pins`,
  `audit:align`, `probe-selftest` and `docs-audit` green.

- [x] **#305 The cap absorbs the hits mute (Ek, 2026-09-07)** —
  *"isn't the cap just that, everything on the scratch surface including loops aren't triggered by
  the cursor if the cap is on."* It wasn't: `setScanMuted` gates the cursor bus and a hit plays
  through the loop commit engine, so the cap silenced granulation and left hits ringing. Now the cap
  is the one mute — `silenceTriggers()` on the way down, the gate reading `S.scanMuted` — and
  `trigMuted` is deleted with everything that reached it: the `triggers on|off` row on the lens
  sheet (a global on a per-tile page), `#trigMuteBtn` and its CSS, the `trig_toggle` action, and the
  `/trigger/mute` OSC address. **A pad or pedal mapped to "hits on/off" needs remapping to
  `/cursor/scan`.** `trigger-audit` reworked around the cap; `engine`, `palette`, `action ranges`,
  `cc mirrors`, `trigger`, `audit:align`, `probe-selftest`, `osc-audit` (wiring) and `docs-audit`
  green. `pins` § "unpin all is one action" fails after `action ranges` in the same run — identical
  at clean HEAD with this stashed, so it is cross-suite pollution and not this change.

- [x] **#306 The TAPE engine, and the lens decides what it reads (Ek, 2026-09-07)** —
  *"i'm not sure loop is the most accurate word"* — it wasn't: a loop is what a tape take becomes
  once pinned, so the engine was named after one outcome of half its tools (`line`, `slice` and
  `dwell: once` never loop). Renamed to **tape** through `ENGINES`, `engineOf`, `SLOT_KINDS`, the
  rail group, `--eng-tape`, the `on tape` section and the brush material, with a one-shot
  `mubone_slots` migration; `loop` now names only the pin kind. **`hit` deleted from the
  vocabulary** at Ek's call. And `S.lensReads` (both | grains | tape) puts back the freedom that
  died with `trigMuted`, as a per-tile lens param rather than a global — with the dead-row rule
  applied, so the sheet hides what the reading makes inert. `engine`, `palette`, `pins`, `trigger`
  and `docs-audit` green; `engine-audit`'s SNAP and `palette-audit`'s brush keys updated to match.

- [x] **#307 The switch shape, pen/pencil, and the factory palette (Ek, 2026-09-07)** —
  A batch. Every true boolean on an engine sheet is now the settings kit's SWITCH — `fade`, `chop`,
  `link`, and `on end` rewritten as `loop on end` because `arm` named the absence of the thing;
  `engine-audit` gained a switch pass that clicks each one twice. `wash` → `pencil`, the pen's wet
  twin (ships wet, paints scratch, adopts the live block — the wash's cloud and reverb went with
  the name); `splatter` → `spray`, and the stale `spray → pen` migration row deleted rather than
  left to send it back. The spot lens wears the cursor's diamond; the wet switch wears its droplet.
  Factory palette cycle is line · overdub · pencil · all — and the load path was reading
  `|| '[]'`, which had made any default unreachable. `engine`, `palette`, `pins`, `trigger`,
  `mark align`, `audit:align`, `probe-selftest`, `docs-audit` green.

- [x] **#308 One Q per filter (Ek, 2026-09-07)** —
  `filterQ` was shared, so a resonant low-pass dragged the same peak onto the high-pass corner.
  Split into `hpfQ` / `lpfQ` across the block builders, the worklet's two coefficient sites, the
  cabinet rows, the CC / sensor / OSC maps and the README; `/grain/filterq` deleted rather than
  aliased. The filter graph's vertical drag now sets the Q of the edge you grabbed. `EXPORT_VERSION`
  14 with a one-shot `migrateBlockKeys` and a `fq → hpq + lpq` pid migration. `engine`, `palette`,
  `pins`, `mark align`, `action ranges`, `cc mirrors`, `osc-audit` (wiring) and `docs-audit` green.

- [x] **#309 The grain `on end` is a switch too (Ek, 2026-09-07)** —
  *"like the on end in loop, on end should also be switch."* `scratch | cloud` becomes
  `cloud on end`, yes or no — the same shape and the same question as the tape engine's
  `loop on end`: does the stroke leave something behind when it ends. It also makes the wash's
  behaviour one visible switch on any grain brush. `palette-audit` § I rewritten around the switch.
  `engine` + `palette` green.

- [x] **#310 The wash comes back whole (Ek, 2026-09-07)** —
  *"actually i forgot about the wash being the one that drops a pin simultaneously (on end:
  cloud)."* Restored as its own tile: `cloud on end` baked in, its reverb factory block (400 ms
  grains every 15 ms, taper 50 %, 6k, 90 % wide), its glyph and its rail row after the pencil — and
  `wash: 'pencil'` deleted from `_RENAMED_TILES`, the same live-id-on-the-left trap that killed
  `spray: 'pen'` a commit earlier. The pencil is unchanged: the pen's wet twin, scratch, adopting
  the live block. In the factory cycle the wash sits in the rail, not the cycle. `palette-audit`
  asserts the pair — pencil wet + scratch, wash dry + cloud, neither is the other. `palette`,
  `engine`, `pins` green.

- [x] **#311 The pencil folds back in, and five smaller edits (Ek, 2026-09-07)** —
  `pencil` deleted — wet is a brush-wide property, so `FACTORY_WET` is the PEN and every brush keeps
  the switch. The grid now applies the material's own inner-face cull (`_arcProject`), which is what
  the "back side" lines were: the NEAR shell, hanging between the eye and the work whenever camPull
  left 0. A 3-way camera capsule in the chrome, built from `#cameraModeSeg` so the chrome stays a
  proxy. `F` unbound — `5` taps, `palette_5_hold` holds. The engine sheet's OFF switches lifted off
  `--surface-2` (a desk-lamp value) onto `--border-soft`. `palette`'s F-driven hold sections drive
  the hold ACTION now, which is all `F` ever stood in for. `engine`, `palette`, `pins`,
  `audit:align`, `probe-selftest`, `docs-audit` green; `mark align`'s 1.95 s burst check flaked (a
  known pre-existing one).

- [x] **#312 The grid's reach follows the zoom (Ek, 2026-09-07)** —
  The re-report of the back-side lines was right and my first fix was on the wrong path: the ZOOM is
  `S.fovDeg`, not `camPull`, and centred there is no back face to cull — the far hemisphere is a rim
  band the chart draws in full. Now the GRID stops at the horizon below 200° of field and grows to
  the antipode by 340° (`_gridBackReach`), a moving boundary rather than a threshold; the marks out
  there are untouched. Measured: 735 grid segments at 180°, 1036 at 240°, 1671 at 360°.
  `pins` + `mark align` green.

- [x] **The header goes to glyphs (Ek, 2026-09-09)** —
  The cog sits just left of the pinned handle, the last group on the right; the camera capsule is
  three glyphs (pointer, orbit, the sensor mark) with the words in the titles; the two rig pills are
  `.tc-readout` — the bar's own 32px glyph with a 6px state dot, the detail (mic / live / file, wifi
  / usb / found / lost) written into `data-title` since ui-learn.js moves every title there. `.mu-pill`
  deleted. `audit:align`, `probe-selftest`, `docs-audit`, `rig-audit engine` green.

- [x] **The align audit's `__rt10__` sensor leaves when the probe does (Ek, 2026-09-09)** —
  Ek: "how come sensor keeps showing up as __rt10__ osc · osc · 0 Hz · cursor". The round-ten probe
  injects a synthetic OSC sensor and never removed it: it stayed in the device map (header "up" on a
  rig with nothing connected) and both storage keys merge on save, so it held the CURSOR role for good.
  New `forgetSlot` (registry) + `forgetOscSensor` (imu-setup) delete device, slot, saved cal and pref;
  the probe calls it and asserts it is gone. `audit:align`, `audit:sensor`, `docs-audit` green.

- [x] **The sensor list offers only ports with a USB identity (Ek, 2026-09-09)** —
  "my bose headphones and bluetooth incoming port" were in Settings → Sensors because the list was
  every tty on the machine. A sensor on a cable is a USB CDC device and always reports a vendor id;
  Bluetooth profiles and system pseudo-ports report none — so `_hasUsbIdentity` is the filter, no
  name matching. Known vendors are named (`_USB_VENDOR_NAME`; the x-imu3's is still to be read off
  a plugged-in unit), unknown ones show as `<manufacturer> · usb`. `docs-audit` green.

- [x] **The sensor list says connected, wears the wire, and keeps its rate live (Ek, 2026-09-09)** —
  Every connected row carries a **Connected** badge and the rail's ⋯ door to its block below ("Selected"
  named the list's mechanism, not the rig's state); Blink only with ≥2 connected. The sub-line is the
  wire's glyph (wifi arcs / usb trident, `_WIRE_GLYPH`) then rate and role; kind and serial moved to the
  tooltip. "— Hz" was a stale first paint — rows now repaint their rate on the page's 1 Hz tick. The
  card head's badge wears the same mark. `audit:align`, `probe-selftest`, `docs-audit` green.

- [x] **The sensor card, tidied (Ek, 2026-09-09)** —
  "messy and has a lot of info stale." The card's lede is gone; "Where forward is" is **Mounting and
  heading** with one line each; Axes says what raw and calibrated ARE and wears a 24px dial beside
  every angle (`_dial`, needle turned by `updateAllReadouts`, calibrated in the accent, number held
  at 62px so the dial never walks); the three calibration toggles sit on one row; Uplink says which
  network the instrument was last asked for — the firmware's `ssid` is write-only, so "asked for" is
  the honest word. `audit:align`, `probe-selftest`, `docs-audit`, `rig-audit engine` green.

- [x] **Connection state is packets arriving (Ek, 2026-09-09)** —
  "when i disconnected the usb the header icon and the sensor page still show connected. it's clearly
  sending 0 hz." A device in the map had been SEEN, not proven here: no path told the map about a loss.
  Now `dev.live` = a packet within `LIVE_MS` (2 s) on OUR clock (`lastSeenAt`, never the x-imu3's
  µs-since-boot `lastTimestamp`); the rising edge is the first packet, the falling edge a 500 ms tick;
  `_syncSensorStatus` counts live devices only, so the header goes brick "lost", `S.rig.up` false, the
  row "No signal", the count and the wire tally drop. Driven synthetically: up → gone in ~2 s → back.
  `audit:sensor`, `docs-audit` green.

- [x] **The instrument's buttons bind on the keys page (Ek, 2026-09-09)** —
  "i don't see the mapping on the keys+midi page. there should be a way for me to map those buttons
  to anything." They were hard-wired in sygaldry.js to the three palette holds. Now a **Button** column
  sits between Key and MIDI — the same three-state cell: click, press the physical button, right-click
  to clear; blank on cc rows. `buttonMappings` (`mubone_button_map`, actionId → {btn}) defaults to the
  three holds; one button, one action; a hold gets both edges, a trigger the press. A button held when
  the link drops is released. `align`, `probe`, `docs`, `npm test` (49), `rig engine·palette·ranges·mirrors` green.

- [x] **Button gestures, and Settings → Instrument buttons (Ek, 2026-09-09)** —
  "short and long presses, double clicks, triple clicks … reserving the front edge for things that
  require precision … a clear indication of what long and short means … setting what those seconds
  are (a new page)." Each button is four inputs — press · long · ×2 · ×3 — in the Button column
  (`{btn, g}`). The PRESS fires on the down edge, never delayed; long at the long-press time while
  held; ×2 on the second press (waits the window only if a ×3 is bound); ×3 on the third; a hold
  action on a gesture runs until release. New page (`js/ui-buttons.js`, `#setPanelButtons`): what
  each button does, the two windows (500 / 300 ms), the last gesture live. Driven end to end.
  `align`, `probe`, `docs`, `rig engine·palette·ranges·mirrors` green; browser-audit is release-only.

- [x] **Five gestures, and the second press is the double (Ek, 2026-09-09)** —
  "two quick presses should be like two 1 quick taps … the down edge needs to be the thing that
  starts and ends a take. not the up edge." The second and third down inside the window fire ×2 / ×3
  INSTEAD of their own press (a looper's "press twice"); **tap** is added — the up edge before the
  long time, the short press that can share a button with long as a true alternative — and is
  exclusive with press on a button (⇧-click the cell to learn it). A press-only button counts no taps,
  so nothing waits and a 50 ms take is a take; on a press button with ×2 bound the window is the
  shortest take. The page carries the edge table and the take-button rule. Found and fixed: the count
  carried over on press-only buttons, so the first ×2 learned later arrived as a ×3. All seven
  combinations driven in the app. `align`, `probe`, `docs`, `rig engine·palette·ranges·mirrors` green.

- [x] **A live monitor on Instrument buttons (Ek, 2026-09-09)** —
  "show what button and action was registered." The one-line "last gesture" is a device-list log of
  the last forty: time · button · gesture as read · the action it landed on (or unbound). The
  `button-gesture` event now carries the action; the page keeps a ring and paints once per frame
  only while on screen — closed, nothing runs. Also: a button learn is cancelled on the keys page's
  close / Escape / clear paths, as key and MIDI learns already were. Real presses from the pico on the
  cable verified in the log. `docs-audit`, `rig-audit engine` green.

- [x] **One instrument, one link — no doubling (Ek, 2026-09-09)** —
  "when i connected the wifi amber blenny, the logo switched to the usb one … make sure there's no
  doubling, super important." Two links to one instrument each fed every packet into the same
  sensor, and `via` showed whichever link declared last. Now `_primary` (name → link) is resolved on
  every links change and when a link learns its name: the newest connection wins, older links to
  the name are dropped, a retrying one stopped, and the wire is re-declared from the survivor. A
  non-primary link forwards NOTHING — no sample, no button. Live on the pico: cable → wifi on top →
  cable on top, one link and one mark at each step, 100 Hz throughout. `npm test` (49), `docs` green.

- [x] **Four words for what a button does (Ek, 2026-09-09)** —
  "hold" meant the action type, the label suffix and the long-press gesture at once. Ruled: **momentary
  / toggle** are the Main button's modes, **on/off** an action taking both edges (id `hold` stays),
  **bang** one that fires once (id `trigger` stays), **long press** the gesture — and no per-button
  momentary-or-bang option, the action consumes what it needs. A copy pass only: the keys page's
  type word, the six `(hold)` labels → `(on/off)`, two `(toggle)` suffixes dropped, the buttons page
  and the shortcuts doc; ruling in RULINGS, glossary in VOCABULARY. `docs`, `rig engine·palette·ranges·mirrors` green.

- [x] **The button model, simplified to Ek's words (2026-09-09)** —
  "the hardware button always sends 1 and 0. the software deals with those depending on what it's
  bound to … if it expects momentary then long, ×2, ×3 are not options … System Mute (Toggle), System
  Mute (Momentary) — the extra stuff is all confusing." A **momentary** action (type `hold`) takes the
  whole button: learning it binds the press whatever gesture was made. Toggle and bang actions sit on
  any gesture. Paired actions carry the version in the title (mute toggle/momentary; the slots are
  `(arm)` and `(play)`); the sub-line is OSC facts only. The buttons page copy is three sentences;
  the edge table is gone. RULINGS and VOCABULARY rewritten (the on/off draft superseded the same day).
  `docs`, `rig engine·palette·ranges·mirrors` green.

- [x] **Keys + MIDI simplified: toggle/momentary and tool keys fire become rows; titles by tile (Ek, 2026-09-09)** —
  "remove camera mode, spatial panning. remove mentions of tap. the title should be based on the tile
  position. remove the main press toggle/momentary. remove the tool keys fire thing. if it's buildable
  in the table assignments i prefer that." Each slot is `tile N (kind) · arm` / `· play (toggle)`
  (`palette_N_toggle`, new; the buttons' default) / `· play (momentary)` (`palette_N_hold`); paint is
  `paint (toggle)` (space, click) / `paint (momentary)` (`/trace`). `gesturePress(momentary)` carries
  the kind; `S.gestureMomentary`, `S.paletteTrigger`, both settings rows, their storage keys, the
  camera-mode and spatial-panning actions (+ OSC) and the tap gesture are gone. Found: a toggle play
  held `_downExternal` and refused the next momentary play. palette-audit §G/§H rewritten. All green.

- [x] **No key in an action's title (Ek, 2026-09-09)** — "it's redundant since it shows in the table."
  Seven labels carried their shortcut in brackets (`cap (S)`, `zero (\`)`, `handsfree arm (H)`, `pin here
  (tap =)`, `pin a drawn path (hold =)`, `unpin nearest (−)`, `lens mode … (N)`); the Key column is the
  one place a key is said. Descriptive brackets (toggle / momentary, nearest/area) stay. `docs`,
  `rig action ranges · cc mirrors` green.

- [x] **Old actions out, one title rule (Ek, 2026-09-09)** —
  Gone with their OSC and keys: record a hit (`/trace/trigger`, ⇧space), pin kind (`/commit/mode` —
  the tile drives `commitMode`), next pin volume / speed (the sliders stay on Settings → Pins), perf
  monitor (p), high-perf render (⇧P), dark/light, projector (⇧F) — all four set on their settings
  pages. Ids retired so saved maps drop them. Titles: `(momentary)` = both edges, `(toggle)` = flips
  two states, `(cycle)` = steps through more, none = a bang — every row checked in the app. Found:
  Clear all called `prompt()`, which Electron lacks, and cleared nothing; one `confirm()` now clears
  keys and MIDI and resets the buttons. `docs`, `npm test`, `osc wiring`, `rig engine·palette·ranges·mirrors` green.

- [x] **A factory key another action has learned reads as unbound (Ek, 2026-09-09)** —
  "3 is listed twice." A factory key is a literal on the row, not a binding, so learning 3 onto
  `tile 3 · play (momentary)` left `tile 3 · arm` still showing 3 while the digit had already stood
  down at runtime. The Key cell now reads what the key DOES: dash, with the hover naming who took
  it. `docs`, `rig palette · action ranges` green.

- [x] **Keys + MIDI opens on the palette (Ek, 2026-09-09)** — "remove the palette title and text at the
  top. put the palette section first. then paint (space)." The Palette heading and lede above the
  table are gone (both settings rows under them went earlier today); the table's groups are palette,
  paint (space), then the rest; the emptied `app` group heading is gone with its four actions.
  `docs`, `rig engine · action ranges · cc mirrors` green.

- [x] **A momentary can sit on any gesture (Ek, 2026-09-09)** — "for momentary buttons, how come i
  can't do btn3 long." Every gesture has two edges (on at its edge, off at the release), and the
  recogniser already released a momentary on the up whatever started it; only the learn step forced
  it onto the press, from the same day's simplification. Lifted; the buttons page says the edges per
  gesture. Proven live: `system mute (momentary)` on `btn 3 long` — on at 500 ms, off at release.
  `docs`, `rig engine · action ranges` green.

- [x] **Tap is back: a bang on the up edge (Ek, 2026-09-09, evening)** — "it's useful to have tap,
  which is fire on the up … i don't know how the learn can diff between tap and press." It cannot from
  the button — they are one physical thing — so the CELL says: click then a short press learns the
  press, ⇧-click then a short press learns the tap; the status names the edge. Tap fires on the up of
  a short press nothing else claimed, may share a button with a press, and a momentary refuses it
  (no second edge). Proven live: press=undo at the down, tap=redo at the up; after a long press no tap.
  `docs`, `rig engine · action ranges` green (engine once transient, green on rerun).

- [x] **Each slot has a cycle bang (Ek, 2026-09-09)** — "tile 3 4 and 5 should also have a cycle
  action." `tile N (kind) · cycle` (`palette_N_cycle`, `/palette/N/cycle`) cycles the slot through its
  kind's tools in rail order, armed or not — what tapping the armed slot does, as its own row; same
  guard as the tap, nothing changes a slot under a play. Live: tape line → overdub; grain and erase
  did not move because every other brush of those kinds is cycle-off in Ek's rail, same as the armed
  tap. `docs`, `osc wiring`, `rig palette · action ranges · cc mirrors` green.

- [x] **The heading zero lands at lon 0 (Ek, 2026-09-10)** — "when i zero it doesn't go back to 0 0,
  always a bit off, only sometimes." `captureHeading` took the swing-twist, exact only at a level pose;
  at the rig's uncalibrated near-inverted mount (live roll −175.7°) 4° of pitch moved the residual 72°
  and a zero landed at lon −69°. H is now `Rz(yaw read)`: lon 0 after every press, pitch and roll
  untouched. `sensor-audit.js` § B2 (fails against the old H), `docs` green. Reload to pick it up.

- [x] **The hardware tare is off, and the instrument rows say what was learned (Ek, 2026-09-10)** —
  `Sensor zero`'s two buttons are `disabled`: the firmware tares against the mag-referenced vector
  even with the magnetometer off, so the row points at mubone's zero heading. Magnetometer and
  Calibration descriptions carry the show routine (mag off every boot, accel + gyro once, still and
  warm, zero last); the runbook's pre-show steps 2–6 rewritten to match. `docs`, `rig engine` green.

- [x] **The Axes row says + − − is the default (Ek, 2026-09-10)** — "the polarity for pitch and yaw
  start at −, roll +… is there a bug?" No: the sensor counts pitch and yaw about Z-up, the sphere
  about Y-up, and the two signs are that difference (`defaultQuatAxisMap`, `sensor-audit` § I). The
  row's description now says so, and that a button is marked only when it differs. `docs` green.

- [x] **activate, not play or paint (Ek, 2026-09-10)** — "the word play in keys+midi for actions
  that activate is the wrong word, trigger is wrong too… let's go with activate, also change paint
  to activate below." Eight labels in `ACTIONS`: the three slots' `· activate (toggle)` /
  `(momentary)` and the main button's; ids and OSC addresses unchanged; glossary row added.
  `docs`, `rig palette · action ranges · cc mirrors` green.

- [x] **Keyboard, spacebar (Ek, 2026-09-10)** — the keys table's column is `Keyboard`, not `Key`;
  the main button's group is `activate (spacebar)`, not `paint (space)`; the factory key reads
  `spacebar / click`; and a learned spacebar, which arrives as e.key ' ' and drew a blank cell, is
  named `spacebar` by `keyMappingLabel`. `docs`, `rig engine · palette · action ranges · cc
  mirrors` green.

- [x] **Extra long, dry monitor mute, what shares a button (Ek, 2026-09-10)** — a sixth gesture
  `xlong` on a second timer (1500 ms default, its own settings row, always past long; held gestures
  are a list, all released on the up; learning waits for it). `dry monitor mute (toggle)` /
  `(momentary)` (`/dry/mute`, `/dry/mute/hold`): off is the mute, unmuting returns to on or auto.
  The rule as a row: only tap, long and extra long are alternatives; everything else stacks. Live:
  tap → toggle, long → momentary on/off, 1.8 s → long at 500 + extra long at 1500, ×2 after the tap.
  `docs`, `rig engine · palette · action ranges · cc mirrors`, `osc wiring` green.

- [x] **The buttons table has seven columns (Ek, 2026-09-10)** — "×3 looks pushed to the 2nd row
  off the titles": the grid still declared six. Now `70px 2fr 1fr 1fr 1.2fr 0.8fr 0.8fr`, Press
  wide enough that `tile 3 (tape) · activate (toggle)` stays on one line. Measured on a private
  instance: seven head cells at one top, rows 34–36 px against the 56 px ceiling. `align`, `docs`,
  `rig engine` green; probe-selftest's reload check fails on `#ledActivity` (an LED-event badge,
  hidden on a fresh load) — a self-test artefact, not this change. `align-audit` gained the
  invariant (columns = heads, heads on one line, rows ≤ 56 px); it fails against the old grid.

- [x] **Keys + MIDI shows bound rows only, with Show all (Ek, 2026-09-10)** — "hide anything that
  doesn't have a binding by default, and add a show all / hide toggle at the top." A row is bound
  by a learned key, a factory key nobody else took, a button or a MIDI assignment; a row being
  learned never hides. The switch sits between the count and the hint, remembered in
  `mubone_keys_show_all`. Live: 23 of 90 on a fresh profile, 90 with the switch, the filter box
  searches whichever set is showing. `align`, `docs`, `rig engine · palette · action ranges · cc
  mirrors` green.

- [x] **Factory button set, full-width buttons page, pin · unpin on the palette (Ek, 2026-09-10)** —
  the three buttons ship Ek's map: 1 tap tape toggle / long grain momentary; 2 undo / sweep / erase
  all; 3 pin / unpin nearest / unpin all. The Instrument buttons page's descriptions read full width
  (`set-row-desc--wide`; the depth rule forbade a page-scoped selector). The pin pair is back on the
  palette after a second hairline as ACTIONS: same box, grey glyph, no armed face, the flash, the key
  in the corner; `palette-audit` asserts 5 tools + 2 actions and 2 hairlines. Rows retuned to
  0.9 · 1.5 · 1.5 · 1.5 · 0.8 · 0.8 (the long labels landed in tap/long: 68 → 51 px). `docs`,
  `rig palette · engine · action ranges · cc mirrors`, `align` green.

- [x] **The right chrome's hairline, and no sensor mode without a sensor (Ek, 2026-09-10)** — the
  rail's door is its own `.tc-grp`, so the divider the left side draws between its door and the
  next group draws on the right too (measured 1px + 11.8px both sides). The camera capsule's sensor
  segment is `disabled` while `S.rig` says nothing is up, with the `.tc-dis` face; it comes back
  with the sensor. `docs`, `rig engine`, `align` green.

- [x] **unpin, not unpin nearest (Ek, 2026-09-10)** — "nearest/oldest/farthest is an app setting;
  unpin does the version of whatever the setting is." Label and tip renamed; and the `-` key and
  the pins rail's button had their own nearest-only `releaseNearestPin()` that bypassed Settings →
  Pins while the action path honoured it — deleted, every unpin is `releaseCommit()` now. README,
  KEYBOARD-SHORTCUTS, INSTRUMENT-GUI follow. `docs`, `rig palette · action ranges · cc mirrors ·
  pins` green.

- [x] **Unpin lights up from every way in (Ek, 2026-09-10)** — "for the unpin i don't see it light
  up when i press it." The `-` key never flashed, and a button / OSC / MIDI press flashed a hidden
  cabinet element. The flash belongs to the ACTION now: `S._pinFlash` from the commit_drop /
  commit_release / commit_clear cases, lighting the palette tile and the rail row; the key path
  flashes itself. Live: action, `-`, button 3 long, palette click all light both. `docs`, `rig
  palette · action ranges · cc mirrors · pins` green.

- [x] **The input dropdown says which device is streaming (Ek, 2026-09-10)** — "my input is active,
  using the macbook's mic, but the selector still says select input device." Startup opened the
  input by NAME (`resolveAudioDevice`) but never told `ui-audio-settings` which device it opened,
  so the dropdown selected the saved ID — stale once the RtAudio list shifted (BlackHole, Zoom,
  headphones), or null after a reset. `activateSavedInputDevice(nCh, dev)` records it; both
  dropdowns fall back to the name; output gets `noteActiveOutputDevice`. Live: fresh profile and a
  stale id both select the mic. `sw.js` APP_SHELL gained `ui-buttons.js` (browser-audit caught it).
  `docs` green, `browser` green after.

- [x] **Factory button timing: long 300, extra long 3000, tap window 120 (Ek, 2026-09-10)** — the
  numbers in `BUTTON_TIMING_DEFAULT`, the Defaults row and the ruling. Button 3's tap · long ·
  extra long were already pin · unpin · unpin all (bb144f3). `docs`, `rig engine · palette · action
  ranges · cc mirrors` green.

- [x] **One press pin, two unpin, three unpin all (Ek, 2026-09-10, evening)** — "right now it always
  does drop pin, then when i try ×2 it drops then picks up." Beside a ×2 or ×3 the tap now waits
  the window (`st.tapDeferred`), and the window runs from the UP edge — the gap after a press — so
  120 ms is a gap a hand can make. Button 3 ships tap · ×2 · ×3 = pin · unpin · unpin all. Live:
  one press → pin only, 80 ms gap → unpin only, three → unpin all only, 200 ms gap → two pins;
  learning press / ×2 / long / ⇧tap still lands. `docs`, `rig engine · palette · action ranges ·
  cc mirrors` green.

- [x] **The pin action is the = key (Ek, 2026-09-10, evening)** — "the pin binding is old, it only
  pins clouds." `commit_drop` chose by `S.commitMode`; the `=` key decides by what the cursor is on.
  `commit_drop` → `S._pinTap`, `commit_draw` → `S._pinHold(on)` (sequenced), the old loop-arm
  branch and nine dead imports gone. Live: action, hold and `=` each pin a ghost cloud with nothing
  in reach; unpin all clears. `docs`, `rig palette · action ranges · cc mirrors` green.

- [x] **A press's neighbour swallows the take the press started (Ek, 2026-09-10, evening)** — tape
  toggle on button 1 press, grain momentary on its long: the long aborts the take "as if it was
  never meant to be" and holds the grain brush. `S._gestureAbort` (brush) stamps the stroke,
  `_commitTraceStroke` discards it after the seal through `history.discard()` (undone, not
  redoable, nothing armed); midi.js calls it before long / extra long / ×2 / ×3 when the press fired
  an activate. Live: the take is gone, the grain stroke runs and stays; a plain toggle take is kept.

- [x] **A learn's first press arrived as a ×2 (Ek, 2026-09-10, evening)** — "maybe there was a timer
  or counter not reset." The press count carried over from a press whose release was not counted
  (a learn cancelled while the button was down), so the next learn's first press was the second.
  A down now continues the count only while the last release's window is still open; any other
  down is the first of a new sequence. Reproduced, fixed, gesture and learn tests unchanged.

- [x] **The swallow is general (Ek, 2026-09-10, later)** — pin on button 3 press, pin a drawn path on
  its long: "i was expecting it to remove that first pin like it was never meant." The take-only
  rule was wrong. `st.pressMark` is the undo stack's height at the down; `_abortPress` runs
  `history.discardSince(mark)` — every action the press wrote, undone and gone, an in-progress
  stroke left to the seal — then the take abort as before. Live: the press's pin is gone the moment
  the long fires and the drawn path starts; the tape case unchanged. `docs`, `rig engine · palette ·
  action ranges · cc mirrors` green.

- [x] **The buttons page says how a button is read, simply (Ek, 2026-09-10, later)** — six rows, one
  per idea: press (the down, for when the moment matters), tap (the up, for when being sure
  matters), ×2 and ×3, long and extra long, take-back, momentary and toggle. No numbers in the
  prose — "i'll be actively playing with the ms timings" — the Defaults row reads the code's
  numbers; the tap window's floor is 30 ms. `docs`, `rig engine`, `align` green.

- [x] **An aborted take leaves the history at once (Ek, 2026-09-10, later)** — button 1 press = tape
  toggle, ×2 = undo: "the undo seems like it undid the little loop, i wanted that undo to act
  instead of the loop activate." The take-back discarded the take only after the seal, so the
  ×2's undo, firing first, spent itself on the take. `history.detach()` pulls the entry off the
  stack the instant the abort happens; the clean-up still waits for the seal. Live: press then ×2
  leaves no trace of the little take and undoes the real take before it.

- [x] **How a button is read, drawn (Ek, 2026-09-10, later)** — "move the description under the
  settable settings, make it a table and more graphically understandable for a visual learner."
  Timing (the three numbers + Defaults) first; then a kit table, Gesture · The button · Fires · Use
  it for, with a 200 × 40 timeline per row drawn by `ui-buttons.js` from one spec — the trace is the
  button, the dot the fire, the band the window, the dash the count, green the on-time, a struck
  dot the take-back. No number in it. Measured: nine rows at 53 px, one head line; `align-audit`
  holds it. `docs`, `rig engine`, `align` green.

- [x] **The OSC live monitor hides sensor streams (Ek, 2026-09-10, later)** — "should filter out
  the osc quaternion and sensor data." `/sensor/…` messages stay out of the log and are counted
  beside the OSC count ("· 300 sensor messages hidden"), so the sensor's arrival is still visible;
  Clear resets the count. Live: 300 stream messages hidden, three control messages listed. `docs`,
  `rig engine · palette · action ranges · cc mirrors` green.

- [x] **The rail's marks are always visible (Ek, 2026-09-10, later)** — "the palette icon and wet
  icon should always be visible, same with the 3 line drawer opener in the left rail." The cycle
  mark and the ⋯ were the armed row's (and the installed lens's) alone; now every slot-kind row
  and every lens row but the cap carries both, at rest. The ⋯ on an unarmed row loads the tool
  first, as its click would, then opens; on an uninstalled lens it installs first. The wet drop
  was already on every grain row. `docs`, `rig palette` (four new checks), `align`, `probe` green.

- [x] **A new tool is the `+` on its engine's title (Ek, 2026-09-10, later)** — "instead of a new
  tool row under NEW in the left rail, just add a + button beside each engine title (Lens +), make
  the + right justified." The `new tool` row, its NEW group and the engine chooser are gone; lens,
  tape, grain and erase each carry a `+` flush right on the title (measured: every `+` centre on
  the ⋯ column, 192.6 px; the title's height unchanged). A tap mints that engine's tool, arms it,
  opens its drawer. Source has none. `docs`, `rig palette` (§ K, six checks), `align`, `probe` green.

- [x] **Custom tools wear a spark, and the tool rail is 15.5rem (Ek, 2026-09-10, later)** — "give
  the custom ones a special logo that's distinguishable. widen the left rail a bit." `G.custom`, a
  four-point spark in the engine hue, on every custom row, palette slot and the lens tile; the rail
  13.5 → 15.5rem (248 px, the pinned rail's 246.4), narrow 10.5 → 11.5rem. Found on the way:
  `ENGINE_TILE` was still keyed `loop`, so the tape `+` minted a tile with no kind — fixed, stored
  customs migrated once; new names skip ones in use. `docs`, `rig palette` (152), `align`, `probe` green.

- [x] **An erased mark silences its window, not a grain length (Ek, 2026-09-10, later)** — erasing a
  tape line "visually takes the right bite … audio wise it seems to bite off a bit less than a
  second more on the downstream edge." The span was `grainStart + grainDuration`, and a live
  mark's `grainDuration` is the brush's GRANULAR grain length (0.589 s factory, up to seconds),
  nothing to do with a tape take. Now `_spanEndAfter`: a mark's span runs to the NEXT mark's
  moment, the last to the buffer's end — loop copies and overdub takes alike. `rig pins` § M3.

- [x] **The BNO's access point is a setting (Ek, 2026-09-10, later)** — "the firmware for the
  pico/BNO exposes AP mode … add that as a setting to the sensor settings page just for when the
  BNO sensor is connected." Two rows in the sygaldry block's Wi-Fi section (BNO-only by
  construction — the block exists only for a connected link): a switch on `enable_access_point`
  painted back from `ap_enabled`, with status, address and stations joined; name + password with
  Set. `SygaldryLink.accessPoint` / `accessPointConfig`. Measured to the kit. Not tried on the
  hardware — no instrument was attached. `npm test`, `rig engine`, `align`, `docs` green.

- [x] **Delete is a button in every tool's drawer head; the `+` sits beside the title (Ek,
  2026-09-10, later)** — "put the plus button … just to the right of the title of the engine
  type. for custom tools the del should actually be in the drawer header area as a big button.
  delete should be available for the factory defaults also … of course if we do factory reset the
  originals will come back." `deleteTile`: a factory id goes into `mubone_tiles_gone` (the `ui`
  reset category), tileDef answers null, the order restore skips it; the last tool of a kind and
  the last lens refuse (button disabled, says why). The row's hover-only `del` is gone. Measured:
  the head's five items centred on one 30 px line, the `+` 5.6 px right of each title word.
  `rig palette` (157, § K covers factory delete, the armed tool, the last of a kind, the reboot).

- [x] **The header row is one icon size (Ek, 2026-09-10, later)** — "the 3 way pill for the viz
  interaction (steer/surface/sensor) should be the same big size as the other icons on the header
  row … all the icons in the header row should be the same size." The camera pill was a 24 px
  capsule of 16 px glyphs beside 32 px objects with 20 px glyphs; its segments are 28 px with
  20 px glyphs inside the pill's 2 px, so the pill is 32. Measured: thirteen objects, every box
  32 tall, every glyph 20, one centre line at 34.4 px. `align` green.

- [x] **Delete wears the settings Clear-all face (Ek, 2026-09-10, later)** — "the delete button
  design is totally out of context. use the same design as the clear all button in the settings
  pages. the one like in the keys/midi settings page." `.ds-del` is that button's face stated in
  style.css (34 tall, 0 16, 14.5px sentence case, transparent, danger hairline, error text,
  --r-field), not the cabinet's 38 px pill. Measured: every computed property equal to
  `#keysClearAll`, no differences; the head's five items on one 28 px line. `align`, `rig palette`.

- [x] **The tool sheet's head is two rows (Ek, 2026-09-10, later)** — "the engine drawers
  titles/header are very crowded … maybe make it two rows." Row one is identity (name, engine, ✕
  flush right, on the baseline); row two is the tool's actions (wet at the left, Delete flush
  right, centred on the button's line). Five things on one 350 px line had ellipsed the engine
  name. Measured: both rows start 14.4 px from the left and end 14.4 px from the right; the sampler
  and no-engine heads stay one row. `align` ("every head child is one line" holds), `rig palette`.

- [x] **`del` is a bare red word beside esc (Ek, 2026-09-10, later)** — "the delete button is way
  too big, just a simple del red text beside the esc is fine." The head is one row again: name ·
  engine · WET · DEL · esc ✕. `.ds-del` is the WET label's size and tracking in `--status-error`,
  no box, the ✕'s own treatment; the two-row scaffolding is gone. Measured: head 43.6 px, DEL at
  12.48 px like WET. `align`, `rig palette` (157), `docs` green.

- [x] **Wet is a deposit row, not a head item (Ek, 2026-09-10, later)** — "move the wet toggle
  into the actual deposit params not as a header item." The grain brush's DEPOSIT section opens
  with a `wet` switch row (the sheet's `.prow--sw`, `[data-wet]`); the head's `.ds-wet` button
  and its CSS are gone, the head is name · engine · DEL · esc ✕. Measured: the row 25.6 px like
  its neighbours, its switch on the same column as `cloud on end`. `align`, `rig palette`, `docs`.

- [x] **Every engine-sheet row is one size (Ek, 2026-09-10, later)** — "make all the params of the
  engine sheet the same size, dur per pitch and vol are bigger, make them like the others."
  `.prow--wide` was a lead row (1.95rem, --fs-control, a 3 px track, 15 px handle, 9 px band);
  it keeps only its layout (the whole row, the ± column). Measured across every slider row: one
  height 25.6, one label and value size 12.48, one track 23.2, one handle 2, one fill 2. `align`.

- [x] **The palette's pin pair is unpin · pin (Ek, 2026-09-11)** — "flip the position of the pin
  tiles on the palette, add should be the farthest right." The `actHTML` array in `tiles.js` now
  lists `commit_release` before `commit_drop`; the strip ends on the add, `-` then `=` as on the
  keyboard. `palette-audit` asserts the new order; CLAUDE.md and INSTRUMENT-GUI.md name it.
  `docs` green, `rig palette` 157 ok.

- [x] **The cap left the palette (Ek, 2026-09-11)** — "for now remove cap from the palette." The
  palette is lens ‖ tape · grain · erase ‖ unpin · pin; the cap is the rail's row and `scan_toggle`
  (`S`). Every position moved up one: `palette_1` is the lens, `palette_2..4*` the slots, digits
  1–4, OSC `/palette/1..4`, button 1 defaults to `palette_2_toggle` / `palette_3_hold`. Stored key,
  MIDI and button maps are rewritten ONCE (`renumberPaletteOnce`, stamped) because the old and
  new ids overlap. `docs`, `osc wiring`, `npm test`, `rig palette` 156 ok, `align`, `probe` green.

- [x] **The palette is an ordered list of positions (Ek, 2026-09-11)** — "all tiles on the palette
  should be visible … no need to cycle … drag it around … position 1–9 should be kept". `tiles.js`:
  `mubone_palette`, up to nine ids, factory wide · line · pen · all · overdub · unpin · pin; the
  slots, the cycle, its skip list and rail mark, the cap tile and cap row are gone (a lens toggles;
  none on is the cap). Procreate drag from both rails, 27 `palette_N` actions by position with
  per-kind verbs (`verbsOf`, `S._paletteRow`), one-shot from `mubone_slots`. `palette` 140 ok,
  `action ranges`, `cc mirrors`, `osc wiring`, `npm test`, `docs`, `align`, `probe` green;
  `engine` fails 4 (the wet switch) at HEAD too — pre-existing, not touched.

- [x] **Every learned key and MIDI note is a button (Ek, 2026-09-11)** — "can the keyboard do that
  too? it should follow the same system/rule as the buttons." `midi.js` `dispatchGesture(src, down)`
  is the one recogniser, keyed by source (`btn:N` · `key:Code+mods` · `note:ch:num`); every binding
  carries a gesture (absent = press). events.js sends a learned key's two edges and a blur releases
  them; notes go on/off through it, CCs stay travel; learning reads the whole gesture. `palette`
  § L drives Q tap / Q long, 5 extra long, a learned "R long", a held note. `docs`, `osc wiring`,
  `npm test` green; `rig palette · action ranges · cc mirrors` in the commit message.

- [x] **Palette and keys-page polish (Ek, 2026-09-11, evening)** — the position number sits ABOVE
  each tile (`.pal-slot` / `.pal-num`), inside a tile only a learned key; a lens tile off is grey
  with no box, on a filled hue box; every palette row is always shown on the keys page; a row is
  position · glyph · name · verb in the tile's own words (`S._paletteRow` → `set-row-*`), a verb
  the kind has not is no row, an empty position one blank row. `palette` audit updated.

- [x] **Pin a path has toggle and momentary (Ek, 2026-09-11, evening)** — pin's rows are pin here ·
  pin a path (toggle) · pin a path (momentary); toggle opens the path on one press and seals it on
  the next (`_pinPathOpen`), momentary from down to up. A pin tile's TAP is pin here (it had gone
  through the toggle path and left one open — the audit caught it). `palette` 145 ok.

- [x] **No position numbers; the audit runs by section (Ek, 2026-09-11, late)** — "get rid of the
  tile positions completely … it's more about what key is bound to it" and "i need fast iteration".
  The `.pal-num` row is gone; a tile wears the key that fires it; the keys page rows carry no
  number. `palette-audit.js --only=A,D` runs the named sections (~11 s with the launch; the
  whole file is minutes, § I · K · L own most of it). `AUDITS.md` says so.

- [x] **A factory key can be removed (Ek, 2026-09-11, late)** — "i should be able to right click even
  factory defaults to remove them". Right-click on a live factory key stores `{ type: 'none' }` for
  the action; the key is dead (`_keyRelearned` sees a mapping), the tile wears nothing, the cell
  reads unbound and a right-click puts it back. `palette --only=E` 22 ok.

- [x] **Arming is sunset — keys play, clicks pick (Ek, 2026-09-11, evening)** — "there's no concept
  anymore of what the hand holds". `sel` deleted; the hand is `_held` and is null between presses;
  a tool's own position row IS its toggle (`play (toggle)` / `play (momentary)`, only pin keeps a
  third); a click on a tool — strip or rail — points the drawer at it and plays nothing, and
  places nothing. No main button: `trace_toggle`, `recpaint`, `/trace`, `/trace/toggle`, Space and
  the sphere click are gone, space is learnable onto a position, the phone tap is position 1. The
  `.armed` box is deleted everywhere; a lens/source row that is on wears `.on`.
  `palette` 150 ok · `align` green · `engine`/`pins`/`trigger`/`ranges`/`cc mirrors` unchanged.

- [x] **One tile, one verb — the palette after the hand (Ek, 2026-09-11, `docs/PALETTE-GUI.md`)** —
  `mubone_palette` is `[{id,verb}]`; a tile fires `bang` · `momentary` · `toggle`, set in its
  drawer head, so 27 palette actions and 27 OSC addresses are 9 and `palette_N`'s `type` is a
  getter over the verb. The verb is DRAWN as the tile's `border-radius`; the legend says what
  fires it, with `···` where a sibling `×2` delays that tap (measured 123.6–127.8 ms vs 0.1–0.3).
  A rail click does nothing, a strip click fires, `Tab` follows `lastFired`. Found and fixed on
  the way: `renumberPaletteOnce` shifted the FACTORY button map on every fresh profile.
  `palette` 146 ok (§§ B and G deleted, E and H rewritten, M and N new) · `engine` back to its 4
  pre-existing · `align` · `probe` · `docs` · osc wiring green.

- [x] **The palette legend moves UNDER the tile (Ek, 2026-09-11: "not squished")** — measured, the
  line inside the 53px cell overlapped the glyph by 3.4px and the round bang tile clipped both ends
  of `7 3 tap ···` (54px against a ~31px chord). Now a line in the strip's bed, 3px under the outline,
  12px tall, never clipped; the strip is 81 tall (72 at the 44px tier); the delay dots tracked to
  −1.5px. `align` gains "the palette legend" (5 checks, proved to fail when the line is put back).
  `align` green on a fresh profile · `probe` green · `docs` green · shots 520/1400 read.

- [x] **The browser build checked before the collaborators' share (Ek, 2026-09-12)** — `browser-audit` 70/70 after
  the four palette keys (`mubone_palette`, its verbs stamp, the two midi.js stamps) were registered in
  `js/storage-registry.js`; headless Chrome with a tone on a fake mic: boots cross-origin isolated, worklet up,
  `mic ready` / `mic denied` both handled, a toggle take records and plays back (master peak 0.6), a momentary
  releases on mouse-up, settings open, phone-size loads clean. Found: #349 (mobile probe latency), #350 (bare-id button maps).
  mubone.org/sim still serves 1.12 — deploying is Ek's call.

- [x] **The pin's dead band (found in the 2026-09-12 browser check)** — `pinDown` picked the kind within 1.5× the
  radius and `dropSeqFromCursor` accepted only the radius, so a press ~100–130 px out from a take pinned NOTHING —
  no loop, no ghost — against the 2026-08-28 ruling. The drop now returns whether it pinned and a declined press
  falls through to the ghost cloud (`js/tiles.js`, `js/ui-presets.js`). `pins-audit` § P walks the cursor into the
  band and fails on the old code at 10.6°. `pins` 198 · `palette` 146 · `docs` green. The library footer's
  "click a tool to arm it" copy went too (arming is deleted), and CLAUDE.md's overdub line now matches the code.

- [x] **The hand is back; the palette is quick access (Ek, 2026-09-12, `docs/PALETTE-GUI.md` § 1)** — ONE tool in hand,
  picked by a click on its rail row or strip tile, played by the spacebar and a left-click on the sphere in one global
  verb, drawn as the spacebar plate under the strip (glyph, name, the verb as its shape; right-click flips it). Both
  inputs are unlearnable. A tile fires from its own key in its own verb and never touches the hand; a key belongs to its
  tile (a drop takes the next free digit, a move carries it); each legend row is a learn cell, one row per kind switched
  on. `Tab` opens the in-hand drawer, `lastFired` is deleted. Reverses 2026-09-11 rulings 1, 2, 3 and 6 and the morning's
  "don't auto find a key" and "click opens the drawer". `palette` §§ A C D E H L M N rewritten, § O new.

- [x] **The plate heads the bed (Ek, 2026-09-12, evening: "remove the palette icon from the palette bar and put the
  spacebar icon on top of all the tiles across but still inside the box")** — the bed is a column: the plate across its
  head, 5px over the tile row, the row's exact width (measured 401 = 401, 6px inside the box), then the tiles and the
  ledger. The palette badge is deleted. `palette` § A asserts the head; `align` and `probe` rerun for the CSS.

- [x] **The legend's source is a CAP (Ek, 2026-09-12, evening: "something that denotes that it's a reference for a
  key")** — a `<kbd>` keycap under the tile, radius 2, the row's 12px, one hairline at 55 % of the source's colour, no
  fill: a keycap for a key (letters uppercase), a round cap for the instrument's button (a struck pad is round), the keycap
  in grey for a note; an empty row is an empty dashed cap, the click it invites. Measured: caps 12 × 13.7, the widest
  row (`③ tap ···`) 50px inside the 57px legend, ≥ 19px of air between neighbours. `palette` § N asserts the two shapes.

- [x] **The hand is a TILE at the head of the row (Ek, 2026-09-12, night: "make the spacebar to the left of the tile
  group, tiles wide, and of course moving the keyboard binding under it like the same design as the tiles")** — the
  plate that spanned the row is a 53px tile, first in the row, 10px (a double gap) off the quick-access group, the
  in-hand glyph in its hue, its shape the verb, lit while the hand plays; under it the spacebar in a wide keycap (21 × 12)
  and the mouse in a keycap (15 × 12), fixed. The strip tile's in-hand ring went (the hand tile says it); the rail row
  keeps its mark. Measured: hand 53 × 53 on the tiles' line, gap 10.0, bed 81 tall again. `palette` § A asserts it.

- [x] **Three tiles wide, more air, the arrows' glyphs (Ek, 2026-09-12, night)** — the hand tile is 3 × 53 + 2 gaps, at the
  row's own gap (the extra 5px went: "should be the same amount of space"), glyph and name; the strip's measures are
  tokens (tile 53 · gap 7 · inset 8 · legend 15 · gap 6, bed radius `--r-card`); every cap wears the tile's border colour,
  11px weight 400; a learned arrow or editing key draws its glyph (`KEY_GLYPH`: ↑ ↓ ← → ↩ ⌫ ⌦ ⇞ ⇟ ↖ ↘), not its word.
  No audits run (Ek: "stop running all the audits for this session"); `palette` § A's two numbers kept in step by hand.

- [x] **Tab shows and hides the tool rail, never a drawer (Ek, 2026-09-12, night)** — `toggleRail()`, shifted or not; the
  ⋯ on a row is the drawer's only door (a pin tile's sheet opens from its press). It opened the in-hand tool's drawer for
  one evening and the lens's on ⇧Tab. `palette` § C and the three sections that used Tab as the drawer's key rewritten
  by hand, unrun (no audits this session).

- [x] **The rails' helper text and the tools rail's hide button go (Ek, 2026-09-12, night)** — both `.lyr-foot` blocks
  (the tool rail's "click a tool to take it in hand …", the pinned rail's "pinned material plays off-cursor / = pins ·
  − unpins") and their CSS, and `#toolRailHide` ("there's already the rail opener icon" — the tools pill, `~`, Tab and
  Esc close it). `align` "the pinned rail's foot is two lines" inverted to "carries no foot", unrun.

- [x] **The click is spelled (Ek, 2026-09-12, night: "i can't see what that icon is under the spacebar block")** — the
  hand tile's second cap says CLICK; the 7 × 10 mouse glyph is gone. `palette` § A kept in step by hand, unrun.

- [x] **Reset lives on the settings page (Ek, 2026-09-12, night: "instead of a pop up, build it into the settings page …
  one button that will reset all plus another button reset selected")** — Session page: Reset all (danger, armed by one
  click, fired by the next, four-second arm), then one kit row per storage category with a toggle and Reset selected
  under them, live while a toggle is on. The popup and the cabinet's `#resetBtn` are gone; `browser-audit` §§ 5b/5d
  repointed by hand, unrun (release-only).

- [x] **Dots, and the pin mark (Ek, 2026-09-12, night)** — `pen` is named **dots** (the id stays: blocks, palettes, voicings
  and every audit key on it) and draws line's curve dotted; the looper draws LINE and the wash draws DOTS, and what sets
  them apart is the **pin mark** — wet's twin: a property of the tile that IS its on-end switch (`gEnd` cloud for grain,
  `onEnd` loop for tape), read off the tile's own block, a button on the row that flips it, a mark beside the wet drop on
  the palette tile and the hand tile. `isAutoPin` / `setAutoPin` in tiles.js. Ek: "conditioned on that particular
  toggle in the engine … that would be really cool and accurate."

- [x] **Loop and dub (Ek, 2026-09-12, night)** — `looper` is named **loop**, `overdub` **dub**; the ids stay, as `pen` → dots.

- [x] **The drawer's door is the panel-right glyph (Ek, 2026-09-12, night: "3 dots makes me think that it'll open a
  menu")** — a frame with its right third marked, on every tool and lens row; `.trow-more` / `[data-more]` keep their
  names. The docs still call it "the ⋯" in prose — a rename for the finish pass.

- [x] **Trail (Ek, 2026-09-12, night)** — `wash` is named **trail**; the id stays, as `pen` → dots.

- [x] **The pin group is tool rows in the pinned rail (Ek, 2026-09-12, night: "a section of the same design as the left
  rail, but on the right rail, it's for the pin and unpin tools, and unpin all … drag those tools from the right rail into
  and out of the palette bar")** — `renderPinChrome` draws a `.tbx-grp` of three `.trow`s (glyph · name · the key as a
  cap); a click fires, a drag places; **unpin all is a palette candidate** (`ACT_TILES.unpinall`, `commit_clear`, a bang,
  its own glyph, brick on approach). The `.lyr-act` chips are gone from the rail; `align`'s pinned-rail row checks still
  read `.lyr-act` — a rewrite for the finish pass, unrun.

- [x] **The palette is the whole truth for pin and unpin (Ek, 2026-09-12, night)** — the hard-wired `=` / `-` keys and
  `_downPinKey` are gone from tiles.js; the pin tiles' own keys are the only ones. Checked: = and − do nothing, ↓ pins,
  ↑ unpins.

- [x] **An empty group holds no state (Ek, 2026-09-12, night: "i muted the group. then i erase that loop … when i go to
  make a new loop it starts muted")** — the two group flags lived on the session-long GROUPS constant and outlived the
  last pin of their kind, invisibly (the rail hides an empty group's row). `pins.js pruneEmptyGroups()` clears mute and
  solo on a group with no LIVE pins — a cloud fading through its release or a loop playing to its end is leaving, not
  in — at RELEASE time (`_releaseSlotAt`; at the next pin's creation the newborn already counts) and from `applyMix` as
  the net. Checked on clouds with a 3 s release: muted group → unpin → flag off mid-fade → the next cloud is audible.

- [x] **§ 11 built: six hues, the glyph in its hue, one binding kind, the sticker (Ek, 2026-09-12, `docs/PALETTE-GUI.md`
  § 11, `docs/mockups/palette-10a.png`)** — `--eng-*` are six quadrants plus `--eng-pins` bone; every tile and row glyph
  is `var(--c)`; rest `surface-1`, hover `surface-3`, lit the hue at 20 % with a 2px border and a glow. ONE binding kind
  on the strip (first switch on until Ek's one-choice control); the ledger is gone, the bed 71px. The binding is a
  STICKER bottom-left — 18 tall, `flex:none; white-space:nowrap` on it and every span (§ 11.6's trap), a note bare, long
  and xlong a bar, a key's glyph or four characters, chords refused. Measured on a fresh rig: bed 71, sticker 18 × 18
  at −4/−4, `3` + xlong bar 35.4, `127 tap` 45.2, `127` + xlong bar 44.8 — all under 53. Steps a–c of the brief were
  already in the tree (09-11 evening); § 11.1's "still unbuilt" is corrected in place. `palette` §§ N/O rewritten and
  § P new, `align` "the palette legend" rewritten for the sticker — by hand, unrun (no audits this session).

- [x] **"Shown on the palette" (Ek, 2026-09-12, night: "now that only 1 binding type shows in the palette, fix the settings
  toggles to reflect how the ux works")** — the three "on tiles" toggles under the keys page's column heads are one
  segmented row above the table, Key · Button · MIDI (`#legendKindSeg`, `S._legendKind` / `S._setLegendKind`,
  `mubone_legend_kind`; the old three-boolean key carries its first-on kind over once and is removed).

- [x] **The factory strip, re-dealt (Ek, 2026-09-12, night)** — dots (1 long, momentary) · line (1, toggle) · loop (2, toggle)
  · dub (3, toggle) · scrape top (4, momentary) · pin (↓) · unpin (↑); the hand ships holding dots, momentary; no lens on
  the strip. Dots and line share the 1 key — press and hold, the button-1 rule on a key. A profile on the older stamp
  takes the whole strip once (`seedPaletteDigitsOnce`: the list, the hand, the palette rows of all three maps;
  BUTTON_DEFAULTS re-keyed: btn 1 tap line, btn 1 long dots, btn 3 tap pin, ×2 unpin). `palette`'s constants and
  `factory()` re-keyed by hand; its position-keyed checks still name the afternoon's positions — finish pass, unrun.

- [x] **Dub wears the pin always (Ek, 2026-09-12, night: "it technically works with pinned items only")** — `isAutoPin('overdub')`
  is true and not a switch; its row shows the mark, not the button; its tile and the hand tile wear the sticker.

- [x] **The pull keeps steering over the palette (Ek, 2026-09-12, night: "with the palette bar in the way, the pull moves
  the sphere really slowly when i want to pull down")** — the steer tracking listened on the canvas, and the bed over the
  lower stage took the pointer, freezing the offset at the strip's top edge. It listens on the document now with the
  canvas RECT as the boundary (inside steers whatever is drawn on top; outside is the old `mouseleave`). Measured: the
  offset climbs 0.75 → 0.81 → 0.99 from above the bed, onto a tile, to the canvas bottom over the bed; the footer leaves.
  **Reversed for the palette the same day** (below: the chrome is outside).

- [x] **A new build wipes the hosted demo, silently (Ek, 2026-09-12, night: "my collaborators know that this is a prototype
  they should expect nothing is kept so wipe is silent")** — `main.js _wipeOnNewBuild`: on the hosted origin only, the
  deployed `sw.js` CACHE_VERSION (the key a browser deploy already has to bump) against a `mubone_build` stamp; different
  → Reset all's wipe, the cache and the worker, the new stamp, a reload. A store with no stamp is fresh and is stamped
  without a wipe, so Reset all does not double-reload. Not exercisable from the browser audit (localhost is not hosted);
  checked by hand in a rig with the hosted test stubbed.

- [x] **Release 1.15.0-alpha (2026-09-12)** — the five version updates, CHANGELOG. Audits: `rig-audit` (action ranges,
  cc mirrors, mark align, palette, pins) green; `engine` fails 4 (the wet switch) at HEAD too — pre-existing; `osc`
  (full), `browser`, `docs`, `sensor`, `npm test`, `align`, `probe` green; `deadweight` reported (15 ids, 34 classes,
  flake.nix/lock unreferenced). Release-pass fixes: `palette-audit` re-keyed to the evening factory strip (a held-key
  check uses 2, since 1 carries line on the press and dots on the long); a synthetic drag with no `dataTransfer` no
  longer throws; the hold row wears the tool row's metrics; `mubone_settings_section` registered; `.lyr-act` CSS gone.

- [x] **The chrome is outside the stage (Ek, 2026-09-12: "anywhere i'm trying to use the GUI the sphere should automatically
  stop spinning")** — `events.js` mousemove: a pointer whose target is in a rail, the top bar, the palette dock or a modal
  sets `mouseInCanvas` false, exactly as leaving the canvas rect does, so the steer stops dead (the renderer's steer is
  gated on that flag) instead of spinning under a pointer reaching for a tile. Probed on a rig: rail, palette, top bar
  read off-stage, the canvas on. `palette` green.

- [x] **An unbound tile keeps its sticker as a dash (Ek, 2026-09-12: "it should have a hyphen thru the sticker but it just
  disappears so i have no way to bind a new key via the palette tile")** — `paletteLegend`: no binding of the shown kind
  → `.tile-bind--none` with `–` in `--text-faint`; still the learn cell. PALETTE-GUI § 11.5 says so; `palette` § E/N/O
  re-keyed (every tile wears one sticker, the count is never zero). `palette` green.

- [x] **A double no longer aborts a play its press never started (Ek, 2026-09-12: loop toggle on 2, line toggle on 2 ×2 —
  "forever stuck recording")** — `midi.js _abortPress`: the second double's first down pressed loop under the running
  line (dead, one play at a time), and the abort threw away the LINE, which the double then restarted. `pressStarted`
  is read off `S._gestureActive` around the press fire; the abort only fires when it is true. New `palette` § L check:
  2 ×2 starts line, 2 ×2 ends it, a lone 2 still toggles loop. `palette` green.

- [x] **⇧Tab is the pinned rail's; the two pills name their keys (Ek, 2026-09-12: "when i hover over the drawer opener it
  should say tab for the left. for the right, let's make it shift tab to open and close the pin")** — `tiles.js` Tab
  handler: shift → `S._togglePinnedRail` (set by `tile-layout.js`, which owns that rail), bare → the tool rail as
  before. The tools and pinned pills' tooltips say Tab / ⇧Tab. `palette` § C checks ⇧Tab flips the pinned rail and
  leaves the tool rail and the drawer alone. KEYBOARD-SHORTCUTS updated (⇧Tab was listed as a free key).

- [x] **The palette is the steer's bottom edge (Ek, 2026-09-12: "make it move faster at the top of the palette bar, that
  speed there should be the same as the top edge")** — `events.js _stageInsets` gains a bottom inset from `#paletteDock`,
  measured like the rails eat the sides; the vertical offset is against the stage above the strip. Probed on a rig:
  the canvas top −0.999, one px above the strip +0.995, the middle of the reachable stage −0.001; on the strip the
  pointer is off-stage (the chrome ruling). `palette` green.

- [x] **The factory pin is button 3's press; the pin tile has three verbs (Ek, 2026-09-12: "as i right click thru pin it
  should have 3 states avail. right now it's just toggle and bang. it should have momentary")** — `BUTTON_DEFAULTS`
  palette_6 btn 3 press (was tap: no up edge, momentary refused); one-shot in `loadButtonMappings` moves a stored
  btn 3 tap on palette_6 to press. `palette` § H cycles pin 6 bang → momentary → toggle → bang; § N reads the delay
  mark off a tap it binds itself; § O pin wears `3`. RULINGS paragraph, PALETTE-GUI § 7 and KEYBOARD-SHORTCUTS past tense.

- [x] **Release 1.15.1-alpha (2026-09-12, evening)** — the five updates (the chrome and CLAUDE.md stay on the minor, as
  `docs-audit` reads them), CHANGELOG. Audit fixes found by the full set: `osc-audit` had failed since the factory-strip
  redeal (its ACTIONS parser read `PALETTE_FACTORY_ENTRIES` rows as actions — the 1.15 release run was misread as green);
  `/palette/7` (the factory unpin) and `/mute/hold` (the rig launches muted) declared in NEEDS_STATE, both proven live on
  a rig; `palette` § D/E restore `commitSlotCount` beside the cc suites; `pins` waits up to 3 s for the fade's `ended`.

- [x] **The pinned rail boots closed (Ek, 2026-09-12: "start closed on open unless persisted open. but on factory reset it
  starts closed")** — `tile-layout.js`: the default is closed; `mubone_pinned_rail` = '1' reopens it; Reset all wipes the
  key so a fresh store boots closed. ⇧Tab and the pinned pill open it.

- [x] **The phone pass (Ek, 2026-09-12: "it doesn't work with apple phones and the tapping doesnt engage anything … a
  really dumb simple version … i dont want to develop a separate app")** — `mobile.js`: the iOS motion permission is
  asked INSIDE the tap (it was two awaits later, so Safari answered denied and the setup bailed — no gyro, no touch);
  a call that throws is not a refusal; WebKit's inverted `rotationRate` sign corrected (`PLATFORM_SIGN`); four `[mobile]`
  trace lines at the tap. `audio.js`: the speaker-routing `<audio>` looped a 0-sample WAV and ate the main thread — a page
  answered a script call in 5 s with it, 2 ms without (#349, closed); it is one second of silence now. CSS: the bar, rails
  and palette are hidden under `body.mobile-mode`. `scripts/phone-audit.js` (new, playwright, an emulated iPhone and
  Pixel) is the one phone check — `audit-for.js` maps `mobile.js` to it. Not tested on a real phone from here.

- [x] **The phone's palette is the hand tile alone (Ek, 2026-09-12: "the palette bar can be reduced to just the spacebar,
  since there's no key assignments … without making too much of a separate mobile design thing")** — two lines under
  the existing `body.mobile-mode` rule hide the strip tiles and the stickers; the dock and the hand tile stay. `tiles.js`:
  a finger on the hand tile is the hand's press (touchstart/end on the dock, preventDefault so no compat click follows).
  `phone-audit` checks the tile shows and a touch on it plays; `palette`, `align`, `probe` green.
