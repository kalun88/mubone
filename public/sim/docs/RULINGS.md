# Rulings — how the instrument is built, and why

> **Status: CURRENT.** The architecture rulings that used to live in CLAUDE.md's "Key architecture patterns" and "Debugging approach", moved here verbatim on 2026-09-05 so a session reads them when it touches the area, not on every boot. Each entry is a decision Ek made and the reasoning that has to survive the next refactor. Code wins on conflict — fix the entry. **A new ruling goes here, in one paragraph, the day it is made**; CLAUDE.md keeps one line pointing at it.

How to use this file: find the heading for the area you are about to touch and read that entry and its neighbours. Do not read it top to bottom at the start of a session.

---

## The instrument — tiles, palette, button, pins, latency

- **A tile is the preset** — every grain tile owns its whole block and persists it (2026-09-03).
  The 20-slot patch bank, its table editor, param locks and cloud morph are in
  `sandbox/sunset-2026-09-03/` (#325); `js/param-registry.js` keeps the sparse parameter
  registry a session's `patch` snapshot applies through, and `DEFAULT_GRAIN` in `state.js` is
  what the old slot 0 was.
- **The armed TILE is what the cursor is for** (`js/tiles.js`) — there is no separate tool
  selector: `js/tool.js` and its four-peer `S.tool` were deleted in #208 (`docs/archive/BRUSH-MODEL.md`
  § 0 says why paint/hold/erase/arrange were never peers). The older engine flags are still the
  truth underneath — `traceMode`, `commitMode`, `scanMuted`, `trigMuted`, `composerMode` — and the
  tile screen drives them one way and follows them the other, so every existing key, pad, pedal
  and OSC address still works. See `docs/archive/BRUSH-MODEL.md`.
- **One screen, and the rig cabinet** (`js/tile-layout.js`, #291) — the tile screen is not a
  *mode* any more, it is the app: chrome, one full-bleed sphere, the pinned rail, the palette, the
  toolbox, the footer. There is no `rig` pill, no `body.tile-layout` class and no second layout to
  flip to. **`.top-bar` and `.right-panel` are still in `index.html` and are permanently
  `display: none`** — that is the **rig cabinet**, and it is not decoration: it holds the 44
  elements the engine pages drive by id, every settings modal's opener, and four nodes borrowed
  out and hosted elsewhere (the audio device and the two cursor pickers in the footer, the commits
  device in Settings → pins, the camera picker in Settings → view). **Never delete a control there
  because nothing shows it** — retire it by moving it to whatever owns its state, with
  `engine-audit` green after. The rig VIEW itself — the panel columns, the mini canvas tile, the
  drag to rearrange them — is in `sandbox/sunset-2026-08-29/`. **The brush decides the material** —
  grain brushes are the factory patches, stamp brushes are loaded samples, `hit` types the next
  recording as a trigger.
- **The palette is FIVE TILES, the rail is the library** (`js/tiles.js`, #248, reshaped twice on
  2026-09-03) — the performer's palette: **cap · lens ‖ loop slot · grain slot · erase slot**, five
  tiles of one design. Each tool slot is locked to a KIND — loop brushes, grain brushes,
  erasers — and holds one tool of it; a fresh palette is line · pen (spray until 2026-09-06) · scrape all. **Only a slot
  can be armed** — `sel` is a tile id that is always one of `slots()`, the invariant
  `palette-audit.js` holds. **Tapping a tool arms it, and that is all a tap does** (2026-09-11; until then the
  armed slot cycled its kind — superseded by the palette-list ruling below). Clicking a tool in
  the rail ARMS it, placing it on the palette if it is not there, and that is all a click does: **the
  drawer never opens on a choosing click** — Tab is the drawer of the LAST THING PICKED — a tool row, a palette slot, a lens row or tile, the sampler (`_lastPick`, #327) — ⇧Tab is always the lens's,
  the ⋯ on a row the same with a cursor (on every row since 2026-09-10 — on an unarmed row it loads
  the tool first, as the row's click would, then opens), and an open drawer follows the hand,
  too. **No palette tap opens a drawer.** **A lens is a state, and the cap is no lens on** (Ek,
  2026-09-11: "if it's like toggling on and off, then i can just have neither of them on … that's
  like no lens is on, i.e. cap"): a lens tile or rail row tapped turns it on, tapped again turns
  it off, and with none on the cursor reads nothing. There is no cap tile and no cap row;
  `scan_toggle` (S) flips the same flag without moving the installed lens, so the same lens comes
  back; a lens held (its position's momentary) is on while down and the previous state returns on
  the up. **The main button is
  ONE thing, decided above the brush** (`js/brush.js` `gesturePress`, Ek 2026-09-04): space, a
  click, the pedal, `/trace`, `F` and the instrument's buttons all press it, and it is either
  **toggle** (press starts the tool in the hand, the next press stops it, release does nothing —
  the default) or **momentary** (press starts, release stops), one setting on Settings → keys +
  MIDI (`S.gestureMomentary`, `mubone_gesture_momentary`). No tap-versus-hold hybrid: the old
  "quick tap latches" reached one tool (a grain brush on the live source) and every other tool
  was momentary whatever you did. In toggle mode a hold means nothing else, so a button still
  down after `GESTURE_LONG_MS` (8 s) fires the tool's long press — erase: erase all. A gesture
  remembers the mode it started in, so the setting flipping under a held key cannot strand it.
  A slot hold (`slotDown`/`slotEnd`) follows the same rule: the slot's tool takes the cursor and
  the main button is pressed with it in the hand; the armed tool has the cursor back when the
  gesture ends, on release (momentary) or on the SAME slot's next press (toggle); the hand never
  moves. **The overdub brush** (`overdub`, loop kind, 2026-09-04, `docs/archive/OVERDUB-PLAN.md`) records
  a hit take that is never armed: it joins the NEAREST PINNED LOOP at the press as a LAYER — one
  buffer the length of the master's wall cycle, the take folded in from the phase it started at,
  played at 1× on the master's own gain nodes, so mute, solo and unpin act on the family and the
  pinned rail shows a dot per overdub. **Erase reaches the layer** (2026-09-05, the overdub half
  of `onMarksErased`): erased spans are zeroed in the take and the layer rebuilt and swapped in;
  the whole stroke gone removes the overdub; the MASTER's whole stroke gone under a standing
  overdub silences it and keeps the cycle for the family, and the last overdub leaving releases
  the pin. **The overdub has a head** (`overdubHeads` in
  grain.js, `_drawOverdubHeads` in renderer.js): one square per stacked pass, tethered to the
  master's by a line; a take still recording walks its FOLDED length (`ov.foldedS`, set at each
  wrap), so what you see is what is heard so far. **No loop pinned, the take SEEDS one** (Ek,
  2026-09-06; it used to refuse): the press runs as an ordinary hit take with `S._overdubSeed` up,
  events.js arms it with `loop: true`, and the looper hook pins it as the main loop whatever the
  tile's own `on end` says — the first press lays the loop, the second overdubs onto it, one
  brush for the whole gesture. Unpin the master and each overdub becomes an ordinary line (`orphanOverdubs`, armed
  plain: no audition, no slice, no looper hook). While a take records it is heard pass by
  pass: each wrap of the master folds the take so far into a provisional layer
  (`refreshLiveOverdub`, `swapOverdubLayer`) and the seal lands the final one in its place. **The digits are the palette's keys by position** (2026-09-04): `1`…`9` are the factory
  keys of `palette_1`…`palette_9`, which TAP a position (what a click on that tile does — a tool
  arms, a lens goes on or off, a pin tile fires), and `palette_N_toggle` / `palette_N_hold` are
  the two activates the instrument's buttons land on. **The cap left the palette on 2026-09-11** (Ek: "for now remove cap from the
  palette"): it is `scan_toggle` (`S`) and the rail's cap row, and every position below it moved
  up one — `midi.js` `renumberPaletteOnce` rewrote the stored key, MIDI and button maps once,
  stamped in `mubone_palette_renumber`, because the old and new ids overlap and `_RENAMED_IDS`
  runs on every load. A factory key stands down once the keys page relearns its action or gives
  the key to another (`_keyRelearned`). **The tile wears its key** (2026-09-06, Ek: "a visual or
  helper for the key bindings … it should also update if the keybinding is custom"): `paletteLegend`
  in tiles.js reads the bindings at render — the learned key, the factory digit while it still
  works, the hold key (F on erase), a MIDI assignment beside them — through `S._bindingOf` /
  `S._keyTaken`, accessors rather than the map objects because "clear" used to replace the map
  (it now clears in place, which also fixed the digits staying dead until a reload); midi.js calls
  `S._bindingsChanged` on every save, and the palette repaints. **Tool keys fire** (`S.paletteTrigger`,
  `mubone_palette_trigger`, one switch at the top of Settings → keys + MIDI, off by default) makes
  `2` `3` `4` the trigger: press ARMS and plays the slot, release stops it, the three slot taps
  become holds on every wire (they join `S._holdActionIds` while it is on, which is what makes
  events.js send the key-up; the MIDI handler and `S._paletteTap` honour a 0 on those three in
  EITHER mode, so a switch flipped under a held note cannot strand it), no slot wears the armed box (the palette must not lie: nothing rests
  armed), a click on a slot cycles it, and space still plays the last slot fired. **Lit is
  sounding**: the armed tile fills in its hue while space, the pedal, a click or a hold plays
  it, keyed on `sel` and polled at 30 Hz from tiles.js — `.palette .tile.playing` has to outrank
  `.palette .tile.armed`, which it did not until 2026-09-04. There is no Tab-cycle and no mid-stroke arm
  queue. **The palette is an ordered list of positions** (Ek, 2026-09-11, superseding the three
  kind-locked slots, the cycle, its skip list and its rail mark — all git history): up to nine
  tiles in `mubone_palette`, and the POSITION is the binding — `N`, `/palette/N` and the three
  `palette_N` rows address whatever sits at N, so the performer designs the palette first and
  maps buttons to positions after ("all tiles on the palette should be visible … no need to
  cycle … the palette should be customizable, drag it around … position 1 2 3 4 5 6 7 8 9 should
  be kept cause that's useful to map to keyboard"). Nothing is locked to a kind, nothing cycles
  under a tile, and the strip is exactly as wide as the list ("this is still a minimalist app, if
  it doesn't need to show dont show it"). It is BUILT BY DRAGGING (Procreate — Ek: "good with the
  dragging method"): a rail row onto the strip places it at the caret, a tile within the strip
  moves it, a tile dragged off is removed; the rail's palette mark went with the cycle ("we just
  drag it in"). A rail click arms a tool and puts it on the palette if it is not there, because
  the armed tool is always on the palette. **What a position can do comes from what sits in it**
  (`verbsOf`; Ek: "whether something can be armed/activate/momentary etc is based on the thing the
  tile references"): a tool arms and activates (toggle, momentary); a lens is a state with no
  toggle row of its own; pin fires on tap and its activate is the drawn path, toggle (press starts, press seals) or
  momentary; unpin fires on tap only. On the keys page a palette row is position · glyph · name · verb in the tile's own
  words (a lens: on / off, on while held; pin: pin here, pin a path (toggle) / (momentary)), a verb the kind
  has not is no row, an empty position is one blank row saying to drag a tile there, and palette
  rows are always shown, bound or not (Ek, 2026-09-11, evening). **No position number is drawn
  anywhere** (Ek, later that evening: "get rid of the tile positions completely, not the design of
  it being positioned but the mental heuristic of a position number … it's more about what key is
  bound to it"): positions stay internal — the wire and the maps address them — the tile wears the
  KEY that fires it (the factory digit while it still does, a learned key, a MIDI tag), and the
  keys page lists the palette's rows in the palette's order with no number. A lens tile OFF is a
  grey glyph and name with no box, ON a filled box in the lens hue. The last tool cannot leave the palette (space needs something to do) and the armed tool
  leaving arms the first tool left. The factory list is wide · line · pen · all · overdub · unpin
  · pin — positions 2–4 kept from the slot days so a stored key or button on them still means the
  same tile — and `mubone_slots` folds into the list once on first boot. Button 3's factory set
  is pin and unpin BY POSITION (7, 6). A palette badge still heads the strip, chrome in a tile's
  box, no face and no action.
- **ARMING IS DELETED — keys play, clicks pick** (Ek, 2026-09-11, evening: "we are now sunsetting
  the concept of arming a tool. there's no concept anymore of what the hand holds. that solves a
  lot of issues with design"). Every claim above about `sel`, the armed box, the main button and
  the last tool staying is superseded by this paragraph. There is no armed tool and **no tool in
  the hand between presses**: `sel` is deleted, `handTileId()` is `_held?.id ?? null`, and the
  cursor wears an engine hue (`S._handHue`, was `S._armedHue`) only while something plays — the
  question "what would space do right now?" has no answer, because the instrument stopped asking
  it. What used to be one act, arming, came apart into two that were always different jobs.
  **A position's KEY plays it**: a tool's own row IS its toggle, the rule a lens always followed
  (its tap is its activate), so a position carries `play (toggle)` and `play (momentary)` and
  nothing else; only PIN keeps a third row, because "pin here" and "pin a path" are genuinely two
  acts (Ek, asked whether both activates went too: "not true, a position can still have toggle and
  momentary, just not arm"). **A CLICK on a tool points the DRAWER at it** — on the strip and in
  the rail alike — playing nothing and placing nothing (Ek, choosing between the two: "click picks
  for the drawer"). That split is deliberate and is the whole design: you play with your hands on
  keys, pads and pedals, and the screen is where you set up. A rail click no longer joins the
  palette either, because the rule that put a clicked tool on the strip existed only to keep the
  armed tool visible there; placing is drag alone. Picking still APPLIES the tile's block, because
  the sheet's tile owns the live controls (`_pollLiveBlock` captures back into `sheetTileId()`) —
  that is not the hand, and the press applies the whole character again. **There is no main
  button**: `trace_toggle`, `recpaint`, `/trace`, `/trace/toggle`, the `Space` key, the click on
  the sphere and `F` are all gone — every one of them meant "fire the tool in the hand", so with
  no hand they had nothing to address. Space ships unbound and is learnable onto any position ("if
  i want to key bind spacebar i can still do that and bind it to the most used tile. now spacebar
  is just like any other key"); a phone tap is wired to position 1, since a phone has no keys. The
  consequence worth naming: **the mouse alone cannot play the browser demo** — the keyboard can
  (1…9), and that was accepted. On screen, LIT is the only face the strip has left;
  `.palette .tile.armed` and `.tile.armed` are deleted, so the specificity fight that hid LIT
  until 2026-09-04 cannot recur. `.armed` survives nowhere: a lens or source ROW that is on wears
  `.on`, and a tool row wears neither that nor `trow--radio`, because nothing selects a tool.
  **The last tool no longer stays on the palette** — a palette of nothing but lenses and pins is a
  palette, since there is no space bar that needs something to do.
- **ONE TILE, ONE VERB, and the verb is the TILE's** (Ek, 2026-09-11, evening;
  `docs/PALETTE-GUI.md` is the full spec and this is the paragraph that points
  at it). Arming came apart into two jobs earlier the same day — a key plays, a
  click points the drawer — and this is the other half: a tile fires exactly one
  way, `bang` · `momentary` · `toggle`, set in its drawer head from what its
  kind allows (`verbsOf` § 4: a brush and a lens are momentary or toggle and
  never a bang, because a state with one edge has no way back; pin has all
  three; unpin is a bang alone). `mubone_palette` is `[{id,verb}]`, so the list
  is NOT deduped and everything addresses a POSITION — the same tool may sit on
  the strip twice in two verbs, which is how pin ends up there twice. **The
  caller no longer chooses**: `S._paletteFire(i, down)` takes an edge and the
  entry says what it means, so 27 palette actions are 9, 27 OSC addresses are 9,
  and `palette_N`'s ACTIONS `type` is a GETTER over the verb — a momentary is a
  `hold` taking `int 0|1`, a bang or a toggle a `trigger` taking a bang. Five
  places read `.type`, one of them `osc.js`'s release-edge guard, and a getter
  keeps every one right with no call-site change and no parallel table.
  **The verb is DRAWN, as the tile's shape** — one closed outline and one
  property, `border-radius`: a bang is a circle (no corners to hold), a
  momentary a plate (`--r-hand`, "an object you grab with a whole hand"), a
  toggle an asymmetric plate whose two rounded and two square corners give it
  the one thing a latch has and a spring does not, a direction. Two reversals
  are recorded in PALETTE-GUI § 3 (the diamond is dead; the circle moved from
  toggle to bang), and § 5 rule 5 still says the diamond stays — the spec
  contradicting itself, resolved in favour of § 3 and `palette-6c.png`.
  **A momentary is refused while a TAP is bound to that position**, and the
  segment is inert rather than refusing after the click: a tap is a bang on the
  up edge, so it cannot drive a `hold` — it would fire 127 with no 0 and latch
  the tile on for ever. `midi.js` `_learnGesture` already refuses the pairing
  when a key is learned; this is that rule at the other door. It is also why the
  FACTORY strip is not all § 4 defaults: `BUTTON_DEFAULTS` puts button 1 **tap**
  on position 2, so position 2 ships a toggle while a brush's drop default is
  momentary. **The migration DERIVES rather than defaults** for the same reason
  — PALETTE-GUI § 1 said to use the kind's default and that would have shipped
  the trap — reading which of `palette_N` / `_toggle` / `_hold` was bound, with
  `_hold` beating `_toggle` when both were; nothing is lost, because every
  binding moves onto `palette_N` and a tile carrying two sources is legal.
- **A `×2` or `×3` bound anywhere on an input delays that input's TAP**, and the
  slowed tile says so with `···` (PALETTE-GUI § 7). The recogniser defers a tap
  it might have to re-read as the first of a pair (`dispatchGesture`:
  `if (counting) st.tapDeferred = true`), which is correct and invisible — a
  timing change to a gesture the performer did not touch. MEASURED, five presses
  each, from the up edge to the recogniser's own event: **123.6–127.8 ms** with a
  sibling `×2`, **0.1–0.3 ms** without. It ships: `palette_7` (pin) is button 3
  tap and `palette_6` (unpin) is button 3 `×2`, so pinning with your thumb has
  been ~125 ms late since the button map was written. Only a TAP is slowed — a
  press fires on the down edge — and only the slowed tile wears the mark, never
  the `×2`'s own. **Measuring it found a second trap**: `renumberPaletteOnce`
  ran on a FRESH profile, over a `BUTTON_DEFAULTS` already written in today's
  numbering, and shifted every factory button down a position — button 1 onto
  the lens, the pin pair onto 6 and 5. Invisible since it landed, because
  nothing read the factory button map back until the delay mark needed to know
  what sat on button 3. Both one-shot migrations now skip a map the profile
  never stored, which is the rule every one-shot migration should have had.
- **The wash is the looper's move for the grain family**
  (`wash`, grain kind, Ek 2026-09-05, #334): its stroke is pinned at once as a MOVING CLOUD
  looping the path you drew, reading the marks you laid on it — a granular wash that stays. The
  contract is the grain sheet's **`on end` row** (`gEnd`: `scratch · cloud`, deposit section),
  which reads and writes `S.traceMode` (`trace` / `trace+cloud`) the way the loop sheet's
  `on end` drives `loopOnEnd`; every factory grain tile pins `scratch` and the wash pins `cloud`,
  persisted edits sit over it. **`trace+loop` is deleted** (same day): grain marks under a loop
  pin, scan muted while it recorded — the looper with different marks, which nobody had asked
  for. A session file carrying it reads as `trace`. **The A key, the `trace_mode` action,
  `/trace/mode` and the cabinet's cycle button are gone** — they cycled the flag under the
  palette and made the tile lie. **The path is DEFERRED** (`startSeedPath` in ui-presets.js):
  while the stroke is painted only the cursor reads it, and the slot is reserved at the RELEASE,
  anchored at the first frame — a full pool refuses there and the stroke stays scratch. The `=`
  hold keeps `startSeedPlant`, which reserves at the press, because a pin on a place must sound
  at once. The wash's factory sound is `FACTORY_SOUND` in tiles.js, in display units, applied
  through each numbox's `fromDisplay` on the tile's first arming and then adopted like any
  block. Covered by `palette-audit.js` § I and `pins-audit.js` § N.
  The palette **floats over the lower stage** (`#paletteDock`, #250) and the rail stays in the row, so
  no single container holds every tile — use `tileEls(id)` — a slotted tool is drawn twice and
  every class write must hit both copies.
- **Shape encodes affordance** (#267) — one shape, one meaning, everywhere in the tile screen:
  a rounded **rectangle** (`.tc-btn`) is an ACTION; the same rectangle **plus a state dot**
  (`.tc-toggle`) is a boolean that stays; a divided **capsule** (`.seg-pill`) is a choice among
  states, read to know state and never to act. Don't reach for a capsule for a button.
- **One hue per engine** (`--eng-*` on `:root`, #257) — colour answers one question, *which engine
  is this*: source · lens · loop · grain · erase. Never a per-tile colour, and **never dimming to
  mean anything** — a half-opacity control reads as muted. Surfaces are flat: no blur, no shadow.
- **One settings door** (`js/ui-settings.js`, `#settingsModal`, #255) — what used to be the rig
  view's header and footer chips, behind one left nav. A section's body is the REAL modal's `.mu-dialog`, **moved
  into the host and moved back on close** — never a copy, so every module's `getElementById`
  wiring keeps working and no control can desync. Anything borrowed must be returned (the camera
  picker included). This is now the ONLY settings door — the top bar that used to hold half of
  them is in the cabinet, hidden (#291), so a setting with no nav item has no way in.
- **The engine page** (`renderProps` in `js/tiles.js`, #261) — one line per parameter
  (`name · track · number`), never knobs; every number typeable, every track double-click-resets
  to the tick shown under it. **A `slider` param's raw value is the element's POSITION, not the
  units it displays** (the grain sliders are log-mapped), so typed values go through the paired
  numbox's own `fromDisplay` — never re-derive the mapping. The sound window and the drawn filter
  are `S._drawEngineScope()`. **A number cell is a slider you can also type into** (2026-09-06):
  press and drag it to set, click without moving to put the caret in, double-click to reset, shift
  for the track's quarter-speed fine drag — the number field of Ableton, Logic and Photoshop. That
  is how the ± SPREAD is set. It used to be ⌥-drag on the track, and ⌥ is the cursor LOCK
  (`js/events.js`), so one key did two jobs; the modifier gesture was invisible besides, while the
  spread's cell is on screen at the end of its row with a resize cursor. Two things the gesture
  needed: the band is always in the DOM, hidden at zero, so a spread raised from nothing appears at
  once, and `_paintRow` on a spread repaints its BASE row — the row that draws the band and the
  cell's zero state. Covered by `engine-audit.js` § B2.
- **Two left rails** (`#toolRail` + `#propRail`, `body.props-open` / `.prail-open`, #258) —
  Ableton's browser and device view: the tool CATALOGUE as a list, and beside it the whole engine
  of whatever row is open. They **overlay** the stage, so neither ever resizes the sphere. A row
  carries two independent marks: `armed` (space fires it) and `open` (the properties rail is
  showing it) — they must be able to disagree. **The perform quick view is deleted** — one
  parameter, one place. The test for palette membership: **if space cannot
  fire it, it is not a tool** — lens, cap, edit and source are modes and keep their own docks.
- **The loop follows the button, and the machine knows its latency** (`js/latency.js`,
  2026-09-04, #332). The recorder is exact inside the graph (a scheduled click lands in a take
  at 0.00 ms error); what is late is outside it. A HIT take stamps its press and release on the
  audio clock, is held open past the release by the input latency, and its `edges` — not its
  marks, which sit on a 50 ms tick — are a line's or a loop's region while the stroke is
  untrimmed (`take.markSpan`); a fresh loop's first pass is phased to the release
  (`_phaseAnchor`); an overdub's phase is pulled back by the round trip. `S.latency` is an
  estimate from the streams' own reports (RtAudio `getStreamLatency` + the buffers, over
  `get-stream-latency`) or a loopback MEASUREMENT (Settings → Audio → Measure,
  `mubone_latency_cal`, per device pair × rate, kept as the DEVICES' share so the cushion and
  the buffer move without re-measuring; Apple's built-in mic and speakers measured ~55 ms that
  RtAudio reports as 1.5). Hit material is never paint-gated:
  a line is a path you swipe to fire. Covered by `trigger-audit.js`'s "the button, not the
  marks" section and `pins-audit.js` § M. **The two IPC hops are bounded, and the GUI thread is not in them** (#333; 2026-09-06): audify's
  `write` only queues and the device callback drains. Until 2026-09-06 every output block went
  capture worklet → renderer main thread → `ipcRenderer` → main, and every input chunk the other
  way, with a credit window on the renderer bounding the queue — so any stall on the GUI thread
  longer than the cushion was a hole in the output. Measured on 2026-09-05: a 30 ms stall dropped
  one block, a 60 ms stall dropped eleven, while nothing in the render loop itself showed above
  6 ms — the wet-brush crackle was the path, not the drawing. Now each hop is a MessagePort pair
  the preload makes (`electronBridge.openAudioPort`): one end goes to the main process
  (`ipcMain 'audio-port'`), which forwards it to **the audio host** — `audio-host.js`, a utility
  process with nothing on its loop but audify's two streams (R2, later the same day: the main
  process is also Chromium's browser thread, and on Ek's laptop it gapped over 20 ms eight times
  in a set, 157 ms once, none of it our JavaScript); the other end is posted to the main world
  over `window.postMessage` — the one way a port crosses contextIsolation — and transferred INTO
  the worklet, which posts straight to the host (a copy: a transferred ArrayBuffer arrives as
  null on Electron 41). Device LISTS stay on the main process's own RtAudio enumerator, because
  `getDevices()` holds a loop 65 ms. The host REGULATES the output queue, where the true depth
  is known (`onOutputBlock`): primed to the cushion with silence when found empty (stream start, or
  after it ran dry — `outDry`, the output's true hole count, which audify never reports), and
  skipped back to the cushion when a lead builds past it plus its 10 ms margin (`outDropped`;
  one discontinuity instead of a permanent delay — the device's own start-up leaves a lead of
  twice the cushion otherwise). The input ring does the same: a pre-roll to its target, a skip
  past target plus margin, a refill after it sat short for a second (`inDry`). One **stall
  cushion** (`S.audioCushionMs`, `mubone_audio_cushion`, Settings → Audio, default 10 ms since 2026-09-06 — R1, proved on Ek's laptop: 58 takes, zero cumulative faults; 5 is a choice) is
  the depth of both — latency against main-process jitter now, the one musical choice in it;
  `js/audio.js cushionBlocks` and the host's `primeBlocks` are the same formula, never under two
  blocks. Every loop reports its own gaps and holders (`electron-loop-probe.js`; `wg.status()`). The estimate is device + cushion per side. `trigger-audit.js` "the hops are bounded"
  freezes the GUI thread 80 ms and then 250 ms and requires nothing dropped, skipped or dry and
  both hops still at the cushion. The engine's clock is the OS default output device's and
  RtAudio's is the interface's: on a rig, make them the same device (`docs/RIG-RUNBOOK.md`
  § 4.9).
- **A cap protects the thread; the THROTTLE reads the thread** (`js/worklets/grain-engine.worklet.js`,
  #348 P2–P4, 2026-09-06). Three rules came out of auditing every cap after R4 halved what a grain
  costs. **The throttle's signal is LOAD, never occupancy**: the thread's own time in `process()`
  over a short window — 32 blocks, 85 ms, because the 1 ms clock an AudioWorklet has needs that long
  to average out and a mean over a second hides the burst that breaks the sound — ramping from
  nothing at 70 % of the 2.667 ms block budget to everything at 95 %. Occupancy was the old signal
  and it was wrong in both directions: eight wash brushes (~213 grains) were thinned at a fifth of
  budget, and a slow machine over budget at 100 expensive grains would not have thinned at all. The
  pool keeps a backstop over its last 10 % only because exhausting it makes `_allocGrain` steal a
  sounding grain, and a steal is a click; thinning first is the gentler failure and both are
  counted. **The pool is a SETTING** (`S.maxGrains`, 256 / 512 / 1024, default 512): it is
  polyphony, the right number is the machine's, and the feedback ring is always the pool's size —
  a grain that sounded must be able to light its mark (Ek: "the glow map should be accurate").
  **A voice slot costs whether or not it holds a voice** (0.22 µs a cursor slot, 0.14 µs a seed
  slot, per block), and a bucket with no free voice is SILENT, so those caps are musical limits:
  16 and 64, and the candidate tables are sized `1 + MAX_CURSOR_VOICES` or a raised cap writes
  nowhere and fails quietly. **And a gauge must not cost what it measures**: the audio thread's own
  instrumentation is below the noise floor and stays, while the 4 ms loop-gap timer cost 0.97 % of
  a core in each of two processes and is now armed only while something reads it. The measurements
  are in `docs/CAPS-AND-THROTTLES-2026-09.md`. **Nothing pinned, the first take IS the main loop**, pinned on release like the looper, so the next press has a master — the tile's foot has said so since 2026-09-04; CLAUDE.md said "the press refuses" until 2026-09-12, and the code never did (the browser check caught the drift).

- **The grain loop is grain-major** (`js/worklets/grain-engine.worklet.js` `_render`, R4, 2026-09-06).
  Onsets are still walked sample by sample — only the clocks, so a grain fires on its exact sample
  and remembers it (`_gStartS`) — and then each ACTIVE grain renders its share of the block into a
  scratch and is mixed into its bus once: the buffer resolved once per grain, read position, phase,
  the biquad state and the envelope in locals, the VBAP weights derived once. The active grains are
  an index list with swap-removal, so nothing scans 256 slots per sample and a freed slot is
  replaced in place (the walk does not advance past it). Before, the loop was sample-major and the
  audio thread ran at 48 % mean / 63 % peak in the probe's stressed phase; after, 23 % / 32 % at
  the same 198 grains — the headroom for 8-channel rigs and a hotter laptop the audit asked for.
  The rewrite was null-tested against a seeded golden render of the old loop: 2 × 10⁻⁴ at one
  sample, identical RMS, the one difference being that a grain's phase now accumulates in double
  precision within a block instead of being rounded to float32 every sample, so a grain's last
  sample can land one sample apart. The NaN guard is per grain per block (the sum), not per
  sample. Bench and golden scripts live in the session scratchpad, not the repo: the proof that
  stays is `npm test` and `rig-audit "mark align"`, and the load figure is `transport-probe.js`.

- **The audio thread does not allocate while recording** (R5, 2026-09-06). A live take is a list
  of 30-second chunks, and the one allocation that used to happen INSIDE `process()` was the next
  chunk, 5.8 MB, at the 30 s, 60 s, 90 s marks of a take — the moment most exposed to a glitch.
  Now the bridge allocates spares on the main thread and transfers them (`liveSpare`: one at
  `liveBufferInit`, another whenever the feedback carries `spareLow`), the worklet keeps at most
  two and pops one when the take grows; a clear hands extra chunks back to the pool instead of
  freeing them; and the feedback posts an `Int32Array` copy of the grain ids rather than an Array
  of boxed numbers. The fallback allocation still exists and is counted (`_diag.chunkAllocs`), so
  a probe can say whether it ever ran: a 65.6 s take on a private instance ran with none.

- **The candidate pool crosses to the worklet as shared tables** (R3, 2026-09-06; `grain-worklet-bridge.js`
  `_postCandidatesTable`, the worklet's `cursorTables` / `cursorVoicesTab`). Every tick the scheduler's pool used to
  be a message of objects — thousands of candidates structured-cloned on the main thread, allocated again on the
  audio thread and collected there — and on the probe's stressed scene that post was 0.86 ms of a 1.11 ms pass. Now
  one SharedArrayBuffer holds a region per cursor voice (0 the live voicing, 1–8 the voice slots), each
  double-buffered: the bridge writes rows into the unpublished half, then stores the count, flips the published
  half and bumps a generation with Atomics; the worklet reads the header and a row at fire time. Step mode needs
  rows in offset order, so each half carries a permutation, sorted only when the lens asks for step. The voice cap
  keeps the most RECENT voicings (a first pass counts strokes per voicing), as the message path did. The message
  path is kept whole for a page without shared memory. The audits read the rows back (`getWorkletDiag().candidates`)
  rather than a list kept for them. Measured: the stressed pass 1.11 → 0.51 ms mean, the post 0.86 → 0.28; the
  probe clean with the same load. **The tick halved the same day**: `GRAIN_SCHEDULER_INTERVAL_MS` is 10 ms
  (was 20), −10 ms of worst-case gesture-to-grain; the probe at the new tick shows zero faults, the same
  audio-thread load, and the scheduler's lateness at 1.2 ms worst against 3–5 ms before, because a
  0.5 ms pass every 10 ms is missed less often than a 1.1 ms one every 20. Every dependent scales
  from the constant; nothing else in the instrument assumes 20 ms.

- **A pinned cloud owns its material** (`js/grain.js`, `_refreshCloudClaims` / `_claimedByCloud`)
  — while a cloud is pinned, the cursor does not granulate the particles inside its radius, so
  pinning never doubles a sound (Ek, 2026-08-30). The claim is by PINNING, not by sounding: mute the
  cloud and the material stays the cloud's rather than jumping back into the cursor. Rebuilt once
  per scheduler tick from each cloud's CURRENT position, so it travels with a drawn cloud, and
  tested with `cosR` and a dot product because it runs over every particle inside the 20 ms tick.
  **Nearest mode needs its own skip** in `_selectPerVoicing` — it hands the whole sphere to that
  pass and never reaches `_buildCandidatePoolRadius`. And **`_buildCandidatePoolRadius` is shared
  with the CLOUD's own playback** (the seed block calls it on the cloud's particles), so the claim
  is behind an explicit `forCursor` argument: applied unconditionally there, every pinned cloud
  skips exactly the material it exists to play and goes silent. Loops need none of this: a loop's
  stroke is
  `p.trig` material, which every candidate builder has always skipped, which is why pinned loops
  behaved this way before anyone asked. Covered by `pins-audit.js` § J.
  **The REACH LINE is one per CANDIDATE, the ring one per GRAIN** (`renderer.js`, 2026-09-02): the
  fan is drawn from the scheduler's published pool (`S._cursorPool`, the k marks the cursor is
  choosing from this tick), not from the glow map. The glow map is grains in flight, and a grain
  outlives the tick that chose it by its whole duration, so at k = 1 with long grains five dots
  wore lines at once and the fan read as k = 5. The cloud gate (`isCloudClaimed`) stays on the
  line: a mark inside a pinned cloud is the cloud's, and a cloud pinned between two ticks would
  otherwise draw a line for one frame. `pins-audit.js` § K counts the line segments a real
  `drawFrame()` issues — k = 3 under eight sounding grains must draw three — because the
  predicate was never the part that broke; forgetting to call it is. **And the fan is drawn on the
  POOL's gate alone** (2026-09-07, Ek: "those lines show which particles are selected under k — it
  is the selection area, not the grain glow"): the block sat inside `if (_glowCache.size > 0)`, so
  the whole selection vanished in the frame or two between one grain expiring and the next onset —
  at a 500 ms period and 500 ms grains the fan blinked at the grain rate. What the cursor can reach
  does not stop being true between two onsets. § K's every check tagged the particles as sounding
  before counting, which is exactly why it never saw the blink; it now counts a frame with an empty
  glow map too.
- **A cloud is a moving cursor: it reads a mark with the MARK's voicing** (2026-09-05, Ek: "the pin
  is just a moving cursor — if I change the material under it, it should change"; `js/grain-worklet-bridge.js`
  `S._postWorkletSeeds`). Until then a cloud played everything under it with the block it was pinned
  with, so a wet brush's knobs moved its strokes under the hand and NOT under the wash cloud reading
  the same marks. Now the seed post buckets a cloud's pool by `p._vo` exactly as the cursor post does
  and posts one worklet voice per voicing — a wet voicing follows its brush, a dry stroke the cloud
  crosses keeps its frozen sound, and the cloud's own block (`grainParams`, the pin-time snapshot) is
  what a mark with NO voicing plays with. The cloud's morph overrides land on top of whichever block
  plays. Worklet seed voices are allocated by (slot, voicing) and kept between ticks so a voice's onset
  clock runs on; the worklet has `MAX_SEED_VOICES` = 40 of them against 20 clouds, the cursor's
  per-cloud cap applies (most recent strokes kept), and a bucket that finds no free voice is silent
  that tick rather than doubled onto another. The seed post syncs the hand's wet voicing too, so the
  wash follows its brush while the cursor posts nothing. The lens stays the cloud's: k, radius, nearest
  and fill are read from the cloud, only the SOUND comes from the mark. `pins-audit.js` § J2.
- **A frozen stroke LOOKS frozen too** (2026-09-05, Ek: "for a brush that is not wet, when I change
  the params the particles lighting up seem to change with the engine changes"). A particle glows for
  the duration of ITS grain — its stroke's voicing (`voicingById(p._vo)`), in the bridge's feedback
  handler and in the muted-scan glow simulation alike — never the live sheet's; the bridge had read
  the live duration, so turning the knob changed how long a dry stroke lit while its sound stayed. The
  reach fan is the lens's (`k`, radius, order are the lens's since 2026-09-03) and moves for every
  stroke when the LENS changes, which is right; a brush knob never moves it. Verified on real grains:
  a stroke frozen at 300 ms glows 300 ms with the live knob at 2 s and at 50 ms.
- **The glow has a floor, and ONE mark** (2026-09-06, floor; 2026-09-07, the mark). A glow entry
  lived exactly its grain, so a 5 ms grain on a 5 ms period was on the map for a sixth of a frame:
  each frame caught a random handful and the field flickered (Ek: "when the period is low or duration
  is super low, the glow map can't seem to handle the speed"). `GLOW_MIN_MS` (80, `grain.js`
  `markGlow`, the ONE writer for both the bridge and the muted-scan simulation) is the shortest an
  entry lives; above it the entry lives the grain. **How long a mark stays lit is the only thing
  about the glow that varies** — everything else is a constant (`GLOW_CORE` 0.84 of the marker
  layer's own size scale, `GLOW_ALPHA` 0.917, `renderer.js`), so the whole layer is one batched
  path per frame. Depth still sizes the core, because that is where the mark IS and the paint under
  it rides the same ramp; alpha does not, or depth would count twice and the far side would fade out
  of a layer whose job is to be findable.
  **Three weightings were deleted to get there, and each one was the same finding.** A core-and-ring
  "exact" face past a duration threshold: "when i drag down i see big circles then they disappear",
  and where the rings did appear "the big white circles get crazy busy". The same threshold moved
  onto the onset rate (`dur >= GLOW_MIN_MS || period >= GLOW_MIN_MS`), which fixed a slow patch that
  read fine and left the seam where it was. A continuous ramp replacing it — presence rising as the
  field thinned, no step anywhere — which was still a rule making one sounding grain look unlike
  another: "i don't want different core or alphas, i want the same". The per-mark HEAT that predated
  all three went with them. **A performance surface is read at a glance with both hands busy: a rule
  that makes the same event look different in different conditions is one more thing to decode
  first, however smooth the rule is.** `pins-audit.js` § K2 asserts the sameness rather than any
  threshold's position — two frames over identical marks, one played slowly and once each, the other
  short and hammered, must issue the same arcs at the same alpha, and eight marks must add eight
  arcs rather than sixteen.

- **k is a CEILING with a live count beside it, and `fill` is one end of it** (2026-09-07, Ek:
  "K is more of the max pool size — so we can set it at a higher number and once it hits it, then i
  know i've maxed out the pool on the cursor"). The lens page asked one question with two controls
  and answered none of them. `fill: all` IS k = infinity, so it stops being its own row and becomes
  the capsule at the head of k's row — the choice asked first, as Ek framed it, with the track and
  the number drawn only under `k`. Three things were wrong underneath it. The slider's max was
  rewritten to the particle count on every perf tick, so the same handle position meant k = 30
  before a session and k = 900 after: a ceiling on a moving scale is not a ceiling, and it broke the
  engine page's rule that a slider's raw value is its POSITION. It is now fixed and log-mapped, 1 to
  `K_MAX` (1024, `state.js`) — fine control at 1–10 where one mark more is musical, headroom to park
  k above anything you will paint. `fill: all` was a silent no-op in nearest mode
  (`grain.js` `const all = S.grainKAllMode && !S.nearestMode`), and so were `radius` and `depth`:
  the hidden cabinet knew (`#areaOnlyParams`), the sheet did not, so three of the lens page's six
  rows were dead in nearest mode and none of them said so. They are not drawn there now. And the
  numbers that make a ceiling useful — `perf.kPool`, `perf.kCount`, written by the scheduler every
  tick whether or not the gesture is down — existed only in the perf monitor, which is a debug
  overlay and not the instrument. **Each live number goes on the row that CAUSES it**: the reach
  count on `radius`, `taken / k` on `k`, going hot on the engine's own accent when they meet, which
  is the one thing a ceiling has to be able to say. `align-audit`'s "the lens page's live columns"
  holds the geometry the eye cannot check — the track keeps `.prow--duo`'s 3.5rem floor beside the
  capsule and both numbers (it measured 40px at the shared column widths, which is not a control),
  neither readout is clipped, and uncapped draws no ceiling to set.

- **The cap is the cursor's ONE mute** (2026-09-07, Ek: "isn't the cap just that — everything on the
  scratch surface including loops aren't triggered by the cursor if the cap is on, so that should
  include loop engine already"). There were two global mutes: `scanMuted` — the cap tile, the `S`
  key, `/cursor/scan` — and `trigMuted`, a `triggers on|off` row on the lens sheet with no key and
  its only other door in the hidden cabinet. The cap stopped the cursor granulating and hits went on
  firing, and the reason is mechanical rather than intended: `setScanMuted` gates the CURSOR bus
  (`cursorMasterGain`, `monitorToHouseGain`) and a hit plays through the LOOP commit engine, which
  that gain was never in the path of. So capping the lens silenced half of what the cursor does and
  nothing on screen said which half. The cap's own footnote had been promising the fix since it was
  written — "hits still fire; their own mute is in the trigger panel until lenses absorb it".
  `setScanMuted` now calls `silenceTriggers()` on the way down and the trigger gate reads
  `S.scanMuted`; `trigMuted`, `setTrigMuted`, `#trigMuteBtn`, the `tmute` row, the `trig_toggle`
  action and the `/trigger/mute` address are all deleted rather than aliased — one address per
  thing, or the table stops being a namespace and becomes two names for one action. **A global
  engine flag has no business on a per-tile sheet**, which is the shape of the bug underneath: the
  lens page's model is "the sheet edits its own tile", and `tmute` was the one row on it that
  edited the instrument. The gate still runs while capped so `_inside` stays true and uncapping
  does not bang whatever the cursor is resting on. `trigger-audit.js` § "the cap silences hits too"
  proves the silencing is really wired, which matters precisely because a gain that was never in a
  hit's path is how this survived so long, and § boot asserts there is no second flag.

- **The engines are TAPE and GRAIN, and a loop is a pinned tape** (2026-09-07, Ek: "i'm not sure
  loop is the most accurate word… it's more like a tape instrument. these brushes are presets for
  instruments. grain is the GRANULATOR, and TAPE is TAPE. it's a machine"). The engine was called
  `loop`, which named it after **one outcome of half its tools**: `line` and `slice` are strokes you
  touch to fire, `dwell: once` is a one-shot, and only `looper` loops on contact. Its own hue token
  had the honest definition all along — `--eng-loop: /* recordings that play */`. The rename is
  `ENGINES.tape`, `engineOf → 'tape'`, `SLOT_KINDS`, `DEFAULT_SLOTS`, the rail group, the `on tape`
  section, `--eng-tape`, and the brush material — with a one-shot `mubone_slots` key migration and
  no fallback. **`loop` still names the PIN KIND and only that** (`slot.type`, `commitMode`, the
  pins rail's `loops` group): a loop is what a tape take becomes once you pin it, which is exactly
  the distinction the old name blurred. **`hit` is out of the vocabulary** ("i hate hit, we should
  remove it from the vocab") — `VOCABULARY.md` had recommended it for whole-sample material and
  now names `tape` there instead. That doc's rejection of Tape stands for the WHOLE vocabulary and
  is superseded only for the engine: as one machine beside the granulator it reads as a machine,
  not as the recorder metaphor design principle 1 rules out.
- **The lens decides WHICH material the cursor reads** (2026-09-07, Ek: "it should be in a lens,
  reads grains, loops or both"). `S.lensReads` — `both` | `grains` | `tape` — is a per-tile lens
  param captured and restored like `mode`, so a lens that only fires tape is a tool you arm on `2`
  rather than a mute you have to remember you left on, which is the safer of the two on stage. It
  is the home for the freedom that died with `trigMuted`, and it belongs to the lens because the
  lens already owns HOW the cursor reads (k, order, fill, radius, nearest, depth) — WHICH material
  is the same kind of fact. Reading only tape goes through the SAME path the cap uses in
  `grain.js`, so nothing downstream needs a second test; reading only grains suppresses the trigger
  gate's edges while its geometry keeps running, so switching back does not bang whatever the
  cursor is resting on. **The cap outranks it**: capped, the cursor reads nothing whatever the lens
  says. And the page follows the same dead-row rule the rest of the lens sheet now does — reading
  tape hides `k` and `order`, reading grains hides the whole `on tape` family.

- **A boolean on an engine sheet is a SWITCH** (2026-09-07, Ek: "there's a bunch of on and off
  simple toggles… the engine sheet should use that if it is on and off"). `INSTRUMENT-GUI` § 3 had
  already assigned the shape — "do you want it? set and forget → switch" — and it had exactly one
  instance, a grain brush's `wet`. `fade`, `chop`, `link` and `on end` asked the same question
  wearing the SEGMENTED shape, which answers "which one?", so a yes/no read as a mode pick.
  `on end` was the worst: its values were `arm | loop`, and `arm` named the ABSENCE of the thing
  ("arm is confusing. it's more like loop on end? yes or no"), so the row is `loop on end` with a
  switch — and the GRAIN engine's `on end` (`scratch | cloud`) followed it the same day, as
  `cloud on end`. Both engines now ask the same question in the same shape: does the stroke leave
  something behind when it ends. Two of the four still proxy their cabinet element, so the write-through rule holds.
  `engine-audit` gained a switch pass: a switch is clicked TWICE and the state must move both
  ways, which a segment could never be asked (clicking the option already on is a no-op) and which
  is the real question for a toggle. A row that stops being audited is how a dead control survives.
- **Pen and pencil are one tool in two permanences** (2026-09-07, Ek: "pen is permanent (no wet),
  pencil starts wet"). `wet` already WAS that distinction — a wet brush's strokes keep following
  its knobs, a dry brush's freeze where they sound — and the pair now names it, which is the whole
  reason the names are worth having. The pencil ships wet (`FACTORY_WET`, and `setWet` stores
  `false` rather than deleting the key, or off would spring back to on). It briefly took the WASH's id,
  and with it the wash's two identifying marks — `on end: cloud` and its reverb factory block —
  because a pencil is neither of those. **All three went back within the hour** (Ek: "actually i
  forgot about the wash being the one that drops a pin simultaneously"): the wash is a tool of its
  own, the looper's move for the grain family, and the pencil is the pen's twin. So the pencil
  paints scratch and adopts the live block exactly as the pen does, which is what makes that pair a
  pair, and `FACTORY_SOUND` carries one entry again — the wash is the only tile whose NAME is a
  sound rather than a gesture, so it is the only one that has to arrive sounding like itself.
  `wash: 'pencil'` was deleted from `_RENAMED_TILES` on the way back, for the same reason
  `spray: 'pen'` was: a live id on the LEFT of that map sends the tile you just made somewhere
  else. `splatter` became `spray`, and the stale `spray → pen` rename row was
  DELETED rather than kept beside it — `spray` is a live id again, so the old row would have sent
  it straight back to `pen`. One-shot means one shot.
- **The factory cycle is four tools, not the whole rail** (2026-09-07, Ek: "on factory reset
  default, the paletted items should be line and overdub, for erase - erase all, for grain, just
  pencil"). The rail is the LIBRARY and keeps everything; the cycle is what a second tap on a slot
  walks through, and it starts small — you add to it from the rail rather than paring a full one
  down. Stored as the SKIP list, so the default is its inverse (`DEFAULT_CYCLE_OFF`), and a fresh
  rig WRITES it so what is stored matches what the rail shows. The load path had read
  `getItem(key) || '[]'` and assigned it unconditionally, which made any default unreachable: an
  empty array is an array. `palette-audit`'s cycling sections now open the cycle themselves
  (`cycAll`, which also puts the slots back — flipping a mark arms its row, so the walk moves the
  palette as a side effect) and one new check asserts the factory four.

- **One Q per filter** (2026-09-07, Ek: "the current Q for filter changes both the Q for the hpf
  and lpf, they should have their own right?"). It was one shared number, so a resonant low-pass
  could not be had without the same peak appearing at the high-pass corner — the two filters were
  independent in every respect but the one that shapes them. `filterQ` → `hpfQ` / `lpfQ` through
  the block builders, the worklet's two coefficient sites, the cabinet, the sensor and CC maps and
  the OSC table; `/grain/filterq` is deleted rather than aliased to both, because an address that
  moves two parameters cannot be undone to one of them, which is the whole point of the split. The
  filter GRAPH gets the better half of it: the vertical drag now sets the Q of the EDGE you
  grabbed, so pulling up on the high-pass corner raises the peak there. `EXPORT_VERSION` 14, with a
  one-shot `migrateBlockKeys` (a stored shared Q lands on both corners — the same filter it had)
  and a `fq → hpq + lpq` pid migration for tile stores. `pins-audit`'s deliberately pinned version
  check was updated after looking, not around: a pin's `grainParams` is a grain block like any
  other and goes through the same migration.

- **Wet is a property, not a tool** (2026-09-07, Ek: "wet is more of a brush wide property i dont
  think i need a dedicated brush for it, but start the pen with the wet on by factory default").
  The `pencil` lasted a few hours: a second grain tile identical to the pen but for one switch is
  one tool wearing two names, which is what a palette is meant not to have. `FACTORY_WET` is the
  PEN now — every brush has the switch in its sheet head, and the only thing decided centrally is
  which way the default one starts. `pencil: 'pen'` is safe on the left of `_RENAMED_TILES` by the
  rule that map already carries: only a DEAD id may stand there.
- **The graph paper ends at the horizon, and grows past it as you zoom out** (2026-09-07, Ek: "I
  still see horizontal lines flashing in front … I don't think I should ever see the back side
  unless I'm deliberately back enough in the zoom that I'm clearly wanting to see everything"). The
  ZOOM is `S.fovDeg` (⇧-scroll, 10–360°), not `camPull` — centred, the projection is azimuthal
  equidistant from the sphere's centre, so there is no camera behind the sphere and no back FACE to
  cull. 2026-08-29 folded the far hemisphere into a rim band so it could not take the picture over;
  it was still drawn in full, and its latitude lines are what he kept seeing. The MARKS out there
  are his material and stay. The GRID is graph paper, and graph paper past the horizon is worth
  having only when you are deliberately looking at the whole sphere, so its reach is a function of
  the zoom: nothing past the horizon at 200° of field, growing to the antipode by 340°
  (`_gridBackReach`, `renderer.js`). A moving boundary rather than a threshold — the paper extends
  as you pull back and there is no frame at which a ring of lines arrives. Squared compare, so the
  front hemisphere costs one sign test and no sqrt on the render path. **The pulled path
  (`camPull ≠ 0`) is a different fix in the same function** and was the first answer, wrongly: it
  applies the material's own inner-face test, which is right for a real eye in space but engages on
  a path the instrument does not use.
- **The grid is on the same shell as the material** when the camera is pulled (2026-09-07). They were the NEAR shell. Pulled
  back, every point of the sphere still projects, so `drawGridLines` drew BOTH and the near one hung
  between the eye and the work. The particle pass has always kept the INNER face — the instrument
  is a bowl you work from within, and `screenToLonLat`'s far root picks that same face — so the grid
  was the one layer on screen disagreeing about which side you are on. `_arcProject` now applies the
  same predicate (`n · c > 0`), which is a no-op at `camPull` 0 and costs one branch when pulled.
  The fix is a CONSISTENCY rule, not a zoom threshold: whatever the pull, the grid shows the surface
  the marks are on.
- **The camera is a capsule in the chrome** (2026-09-07, Ek: "there should be a 3 way view toggle
  pill in the header … the same setting as the steer, surface, and sensor"). It was reachable only
  from Settings → Camera + display, which is a page you open between sets for a choice you make
  during one. `.seg-pill` is the documented shape for pick-one-of-N, and the chrome's rule holds:
  the capsule is BUILT from `#cameraModeSeg`'s own buttons — labels, titles and all — and a click
  proxies the real one, so the chrome is never a second source of truth and a mode added to the
  cabinet appears here without a second edit. **`F` is unbound** the same day: it was a second key
  for the erase slot from before the palette existed, and `4` (`5` until 2026-09-11) taps that slot by position like every
  other digit while `palette_4_hold` is the hold a button or pedal sends.

- **Undo is the last thing the performer did** (`js/history.js`, 2026-09-05, Ek: "undo should undo
  the last user thing — right now it just looks like it undoes strokes"). It did: strokes had a
  stack (`strokeHistory`), an erase had ONE snapshot on a 30-second timer, a pin had nothing —
  three histories that did not know about each other. Now every undoable thing is an ACTION on one
  chronological stack, built by the module that knows its inverse: a stroke (`ui-samples.js`: its
  marks, its recording, the trigger it armed, the loop or cloud or overdub layer the gesture pinned
  — one gesture, one action), an erase / sweep / erase-all (`ui-sweep.js` `snapshotMaterial` /
  `applyMaterial`: a before and an after snapshot, arrays of references, to any depth), a pin
  placed by hand and an unpin (`ui-presets.js` `removePinSlot` / `restorePinSlot`: the slot OBJECT
  taken out or put back, playing, with its mute and solo, the scheduler rebuilding its nodes; a
  loop's fade handlers carry a generation so a restore in mid-fade is not nulled by the old
  source). **Unbounded** (Ek: "artists want to keep pressing undo till they kinda reset — back to
  the top of the show"): an entry holds references, so the whole stack costs the audio you recorded
  and later removed; a session import starts a fresh history. Redo keeps the classic rule (a new
  action forks history); a stroke still recording is IN PROGRESS and undo reaches past it. **Not
  in the stack**: mute and solo, knobs, lens and pin settings, tile arming, the camera — instrument
  state, not things made (Ek, same day; Procreate draws the same line). Covered by `pins-audit.js`
  § O through the real paths.

- **Pin groups** (`js/pins.js` + `js/ui-pins.js`) — pinned material groups by **what it is**:
  clouds in one group, loops in the other, mute or solo either. A group owns no audio; it sets a
  flag and `applyMix()` calls the engine, so loop-is-muted / cloud-is-stopped semantics are
  unchanged. **The group is
  DERIVED — `groupOf(c)` is `c.type` — and stored nowhere**, which is the whole design (2026-08-30):
  the three NAMED groups it replaced carried a `layerId` per pin, a `S.layers` set in the session
  file, `Q W E` / `⇧Q W E` / `⇧Tab` to address them, and an import-ordering hazard where a rail
  repaint could resolve imported ids against the previous session's set and silently flatten the
  arrangement. None of that has anywhere to go wrong now. **Every pin PARAMETER is on Settings →
  Pins and nowhere else** — the lens reads the scratch layer and does not touch the pins, so
  `xfade` / `tether` are off the lens sheet, and the two composing **pin lenses** (`pincloud`,
  `pinloop`) are gone: `S.commitPlayback` (Blend: all / focus) is what decides how the pins share
  the mix, which is the control they had quietly taken over.

- **Mute, solo, release, and the selected pin** (`js/pins.js`, 2026-09-05, Ek: "let's not have
  on/off indicators but use the proper one which is mute and solo, even on each loop item").
  **Audibility is DERIVED.** Every pin carries `mute` and `solo`, every group `muted` and `solo`,
  and whether a pin sounds is one function of the four — `isPinAudible()`: not muted, its group
  not muted, and (nothing soloed anywhere, or it or its group is soloed). `applyMix()` makes the
  engine agree after every flag change, when a pin is born (a pin born under a solo is silent from
  its first tick) and after an import. This replaced the write-through model whose *restore rule*
  (`_preGroupOn`: remember which pins were already silent when the group went down) existed only
  because intent and engine state were one field; now a group unmuting cannot resurrect a
  hand-muted pin because that pin's own flag is still set. **Solo is additive** as in every DAW —
  the soloed set is what you hear, a group solo is that kind, soloing both groups is everything
  — and **mute wins over solo** on the same pin. The rail's row body is the mute (the big target
  does the common thing; its M lights), M and S sit on every row as on the group header, and a
  row reads faint when it is NOT SOUNDING, whichever flag did it. **Mute is immediate**: a 20 ms
  ramp on the loop's mute node, a stop on a cloud, whatever the fade out says. Until this ruling
  the rail's mute landed at the loop boundary, borrowing `atBoundary` from the release path, and
  the word was doing two jobs (Ek: "we should not appropriate MUTE and give it other meanings").
  **Waiting for the end of the pass is RELEASE** — the unpin — and its timing is Settings → Pins:
  `S.loopReleaseMode` (fade / at end) and the fade time for a loop, the fade out for a cloud. The
  overdubs of a muted master grey with it (`syncParticleMarks` claims each overdub's stroke
  through the master), because a layer rides the master's gain and is silent when it is. **The
  selected pin** is what unpin takes and what a lot of things are based on, so the hand must know
  which it is: `selectedPinSlot()` — nearest to the cursor, farthest from it, or the oldest,
  `S.selectionMode` (`nearest` / `farthest` / `oldest`; `closest` renamed on import; `farthest`
  was deleted 2026-09-05 and came back 2026-09-06 at Ek's ask — the same search, sign flipped)
  — is the one function `releaseCommit()`, the rail's half-moon mark and the sphere's cloud
  highlight all read. World-locked panning is the factory default from the same day (the product
  is the rig). Session file v13 (`mute` / `solo` per pin, `_preGroupOn` read into `mute` from
  older files). Covered by `pins-audit.js` § C–G.

- **The focus crossfade is relative to the nearest pin** (`js/grain.js`, the weight pass;
  2026-09-05, Ek: "when I'm completely on top of the anchor I still hear a bit of the other pinned
  loop … it should be a full crossfade"). The law it replaced was `(1 − d/r)^e` normalised, and
  with tether on `r` is the whole sphere, so a pin 40° away kept a −19 dB residual ON the other
  pin's anchor at xfade 50 % — the law never asked where the cursor was *between* the pins. Now
  `d0` is the distance to the nearest pin, `u = 2·d0/(d0 + d)` is 0 on the nearest and 1 when
  tied, the handover is a smoothstep over the last `xfade` of that span, and tether off keeps the
  reach ring as the gate. On an anchor the nearest pin is alone at any width; midway the mix is
  even; xfade is the WIDTH of the handover (100 % the whole way from one anchor to the next, 0 %
  a snap at the midpoint); the smoothstep is what keeps "on the anchor" honest at 100 %, because a
  hand is never exactly on a point (a degree off a pin 30° from the next: −38 dB, not −24). Clouds
  and loops share the law; **an anchor is where the pin gesture RELEASED, and it does not move**
  (`pins.js` `pinAnchorInto`, the one reader every position goes through — the focus law, the
  nearest-slot search, the selected pin, the nearest-pin line, the markers; stamped as `anchorLon` /
  `anchorLat` on the slot and in the session file). A loop dropped by hand is anchored where the
  hand was; a stroke a brush pins at its end (looper, or any tile with loop `on end`) at its LAST
  mark; a cloud whose path was drawn under a held pin, and the wash's, at the END of the path —
  so under focus with tether on you hear just the stroke you made the moment you let go (Ek,
  2026-09-05). Never a moving cloud's interpolated position, which the scheduler writes into
  `lon` every tick and which the weight pass alone used to read. **One anchor MARK for every pin**
  (`renderer.js` `_drawAnchorMark`): a ring, a dot, the slot number, pause bars when silent, at the
  anchor; a stationary cloud adds its reach circle, a moving cloud's reach travels with its HEAD (a
  small dot, no number) and its path is one light line — the velocity-spaced dots were "too busy
  with the grains under" and the 6 px blob at the path's start read as an anchor at the beginning.
  Nothing is drawn at the anchor while the pin gesture is still held: the anchor does not exist
  until the release, so a held path shows its reach and its head and gets its mark where the hand
  lets go. The wash's deferred path (no slot until the release, by design — the cursor alone reads
  the stroke) draws the same LAUNCH POINT at its first frame, head dot and reach ring in the
  stroke's paint colour, so it does not look like it is "waiting to launch" beside the held pin's
  ghost; visual only, nothing sounds there until the release. **The dashed hairline from the
  cursor goes to the NEAREST pin whenever there is one**: it used to need a share over 0.34, which
  four pins around the cursor never give the nearest, so it hid exactly where the hand needed it;
  and it was 1 px at ≤ 0.46 alpha, which vanished beside a 2.5 px ring — 1.5 px at 0.45–0.8 now.
  It is the only pin cue on the cursor: the pin COMPASS (a short arc per pin in reach, on a ring
  outside the reach ring, opacity by share) went the same day (Ek: "now that we have the one-line
  selector we can remove those indicators") — the line says which pin, the rail's mark which is
  selected, and the mix is heard, not drawn.
  Covered by `pins-audit.js` § C.

---

**Toggle or momentary is the binding, not a setting; tool keys fire is gone (Ek, 2026-09-09).** "i need clarity in the table … if it's buildable in the table assignments i prefer that than having settings that actually change the bindings." The Main button's toggle/momentary switch (`S.gestureMomentary`, 2026-09-04) and "tool keys fire" (`S.paletteTrigger`) were two settings whose whole effect was to change what a binding did. Both are rows now: `activate (toggle)` (space, a click; `/trace/toggle`) and `activate (momentary)` (a pedal; `/trace 1|0`); each slot is `tile N (kind) · arm` (the digit; arm, then cycle), `· activate (toggle)` (`palette_N_toggle`, `/palette/N/toggle`; the instrument's buttons by default) and `· activate (momentary)` (`palette_N_hold`, `/palette/N/hold`). `gesturePress(momentary)` carries the kind; a play remembers the kind it started as. A key learned onto a play is what tool-keys-fire was. Titles are by tile POSITION — `tile 3 (tape)` — because the palette is what the player sees. The camera-mode and spatial-panning actions left the table the same day (the header capsule and the settings page set them); their OSC addresses went with them. The tap gesture went that afternoon ("remove mentions of tap") and came back that evening on testing ("it's useful to have tap, which is fire on the up"): a BANG on the up edge of a short press nothing else claimed, allowed beside a press on the same button, never for a momentary (no second edge); ⇧-click the cell to learn it. The gestures are press · tap · long press · ×2 · ×3.

**A button always sends 1 and 0; the action decides (Ek, 2026-09-09).** Every physical button and every key sends both edges, the down and the up. A **momentary** action (type id `hold`) takes the whole button — on at the down, off at the up — and has no gestures: learning it binds the button itself, whatever was done. A **toggle** action flips on each press; it and every other **bang** (type id `trigger`, the OSC word) can sit on any of the five gestures — press (the down, never delayed: "the down edge needs to be the thing that starts and ends a take"), tap (the up), **long press** (at the end of the long time, still held), ×2 and ×3 (on the second and third press inside the window, INSTEAD of the press). Where an action exists in both versions the version is in its title — `system mute (toggle)`, `system mute (momentary)` — and the keys page's sub-line carries OSC facts only, the address and the format. The three slots' `(play)` actions are momentary in shape but follow the Main button setting, toggle by default, which is the one mode setting above every tool. No per-button momentary-or-bang option: "the hardware button always sends 1 and 0. the software deals with those in special ways depending on what it's bound to." An earlier draft the same day used "on/off" for the action type and reserved toggle for the Main button; Ek ruled it more complicated than the thing it described. "Hold" is not a word of the instrument.

## Brush, lens and voicing — what freezes, what is wet

**For anything touching how the cursor voices material, or `js/brush-voicing.js`:** a stroke
**freezes** the brush that painted it — editing a brush changes what you paint next, never what is
already on the sphere (#210). Three things follow. `resolveGrainParams()` in `brush-voicing.js` is
the ONE builder of a grain param block; `ui-presets.js` calls it too, and a second copy would drift
silently and present as *"this brush sounds different after I reload"*. Voicings are **interned**,
so a set painted in one brush is one voicing, not one per stroke — never key them on strokeId.
And the worklet runs a `_cursorVoices` array beside `_seeds` because **density belongs to the
clock**: one onset clock cannot produce two densities, so per-grain params could never have done
this. A voice declares `isCursor`, and that flag is load-bearing — `_gIsSeed`/`_gIsCursor` decide
the output bus and whether undo's `flush-cursor` takes the grain, and both used to be derived from
"was a voice passed", which silently mis-routed every frozen-brush grain. Bucketing lives in
`_postWorkletCandidates`, which already walks the pool, so the 20 ms scheduler is untouched;
measured flat at 0.19–0.25 ms per post from 1 to 16 voicings at 500 particles.

**The split between brush and lens (#212, k half reversed by #233 on 2026-08-27).** A brush
owns the SOUND; the LENS owns how the cursor reads. Lens/global: `searchRadiusDeg`,
`nearestMode`, `recencyN`, the radius-fade pair, `spatialPanning`, and — since #233 — **`k`,
`grainKAllMode` (fill) and `grainKSeqMode` (order)**. None of these may go back into a patch;
their absence from `PARAM_REGISTRY` is what strips them out of old user patches on load. The
#212 argument for brush-owned k ("vinyl at k=1 is character") predated **flow**: with the
deposit clock a brush's density is painted into the material and visible, so how many marks the
cursor reads — and in what order — is a lens question; the mono-vinyl idiom is now a lens
preset (spot, k=1). Brush: everything in `resolveGrainParams()` — sound only. Consequences in
code: `_selectPerVoicing()` in `grain.js` is a single global keep-k-smallest pass (the
per-voicing group machinery is gone); **aperture is deleted** (`S.lensAperture`, its row and
knob) — it existed only to cap k without touching the frozen brush, and with k on the lens it
had no job; order reaches every cursor voice live via the message-level `kSeqMode` on the
`cursorVoices` post, overriding whatever a frozen voicing carried. Voicings still freeze the
sound — `cvActive`/`cvPeriods` in the worklet's `_diag` feedback are still how you tell whether
a voice arrived. Covered by `pins-audit.js` § I.

**Wet paint is the one exception to freezing, and it is the brush's to declare (2026-09-03,
`js/brush-voicing.js` "Wet paint", `isWet`/`setWet` in `js/tiles.js`).** A brush is DRY by
default and its strokes freeze, above. A grain brush switched WET in its sheet head owns ONE
voicing; every stroke it paints points at it; and the brush's knobs edit that voicing in place,
so every stroke it painted follows them — wherever the cursor is — for as long as it stays wet.
Only the SOUND moves: flow, head and the placement constants decide where marks land and a mark
is never re-placed. Nothing is heard *through* anything: the bridge already posts each voice's
params per tick, and `S._syncWetVoicing` (run from `_postWorkletCandidates`) brings the hand's
wet voicing up to the live block, ~22 compares when nothing moved. **Switching wet off dries**
the strokes where they sound (`dryVoicing`: the voicing becomes an ordinary frozen block);
switching it on does not re-wet them. A brush that disappears dries the same way — a custom tile
deleted, or a session opened on a rig where the tile is missing or dry (`restoreVoicings` asks
`S._tileIsWet`). A dry brush's strokes can be moved by nothing, which is what makes them
trustworthy, and a wet brush wears a drop on its palette tile and rail row (on the rail the drop
is the BUTTON, 2026-09-06: on every grain brush's row, outlined dry and filled wet, a tap flips it
without loading the row — the cycle mark's rule; no other engine's row has one, because only the
grain engine has wet paint), and its marks a ring in
the hand's hue while it is armed. **This replaced the grain filter (#292) and audition
(2026-08-29 → 2026-09-03)**, both of which forced every cursor candidate onto voicing 0 to hear
the whole sphere through one engine; audition was also read-only, which is what made it
unfriendly. Two things underneath had to change for wet to exist. **A voicing is keyed on the
TILE** (`S._handTile`: the held slot, else the armed one), not the patch-bank key it used to
record — pen and splatter on one patch were indistinguishable. And **every grain tile owns its
whole block** (Ek: *"if I see that slider in that position, it's set"*): a grain tile with no
stored block adopts the live one the first time it is applied, a grain tile's edits persist in
`mubone_tiles` whether factory or custom, and a 10 Hz poll in tiles.js captures pot/OSC edits
that never touch a sheet row. Arming no longer loads a patch-bank slot. The other factory tiles
keep session-only edits on purpose: wide IS mode:off and scrape IS depth:1, and when persistence
was briefly every tile, `palette-audit` § F found wide coming up in nearest mode after a reload.
Covered by `pins-audit.js` § H and § L and `engine-audit.js` § D.


---

## Plans that shipped — the rulings they left behind

The plans below are in `docs/archive/` (2026-09-05). Each shipped; what a session still needs from each is here. `BRUSH-MODEL.md` and `OVERDUB-PLAN.md` are covered by the palette, main-button and overdub entries above, and `TIMING-REFERENCE.md` by the constants block at the top of `js/state.js`.

**The trigger tool** (`docs/archive/TRIGGER-TOOL-PLAN.md`, #180–#194). A trigger is a VIEW onto a stroke and owns nothing. The playback engine is the loop commit's single `AudioBufferSourceNode` with VBAP following the playhead; the one new thing is a GATE — `playing` becomes a function of cursor proximity. The type is chosen before recording and belongs to the buffer (hit material), never a global tool mode: the first two builds had one and were wrong, and parking, disarming, double-sounding and "does erase reach it" all stopped needing answers once the material stopped being copied out from under its owner. Hit test is any particle in the stroke; the reach is the cursor's own search radius (one gesture, one size); no slot bank; no disarm (erase is the delete, and erasing part of a stroke edits the sample); recording a trigger does not mute scan; dwell (one-shot / loop-while-held) is a live playback control that reaches a trigger already ringing. **A dwelling trigger reads with the LIVE grain block** (2026-09-06): under dwell `grain` the trigger opens to the cursor, and its marks are read with voicing 0 — the grain brush in the palette, wet or dry — never with the grain voicing its hit brush happened to freeze at recording time, which nothing displayed and no setting owned (`grain-worklet-bridge.js` `_voiceOf`; `trigger-audit.js` reads the tables back to prove it). The hot path compares dot products against cosines — 32 triggers × 200 particles cost 0.0018 ms of the 20 ms tick, and the bounding cap makes 32 cost 2.8× one. `_stopSeqAudio()` cannot be reused because both its paths null the slot on `ended`; `stopTriggerAudio()` detaches the nodes up front so the trigger stays armed while the old pass fades. Guarded by `scripts/trigger-audit.js`. Never played on the rig as of 2026-09-05 (TODO #180).

**Composer mode** (`docs/archive/COMPOSER-MODE-PLAN.md`). A LOOP is muted, never stopped: a dedicated `mute` gain node sits after `gain` in the seq graph (`src → gain → mute → VBAP`), `seq.playing` stays true, the source keeps looping and the scheduler keeps panning it, so unmuting returns mid-phrase where it would have been, DJ-style. `release: play-to-end` defers the mute to the loop boundary, `cut` ramps it over 20 ms; the price is that sixteen muted loops cost what sixteen sounding ones do. A CLOUD is stopped with the commit fade in/out and held at silence with its slot intact. Touch toggles, no qualifier; the mode is latched, not held; scan auto-mutes inside it; triggers are excluded because they own nothing. Uproot on a stopped cloud was unkillable — the scheduler skipped `playing === false` slots so the release ramp never advanced — so a release in flight is let through and every destroy path (`releaseCommit`, `uprootNearestSeed`, `clearAllSeeds`) clears `_composerHold` first. Leaving the mode does NOT restore the commits: the arrangement is the product; `all on` (`composer_all_on`, `/composer/allon`) is the one-gesture undo. Silent material greys on the sphere, and a particle greys only when every commit claiming it is silent. The checks live in `scripts/pins-audit.js`.

**The release glitch, and the three rules it left** (`docs/archive/AUDIO-ENGINE.md` part two, 2026-09-02). Ek's report: a 500 ms burst under a 700 ms grain gave a reset sound, silence, then the audio "catching up"; three causes, all found by reading. (1) **The tail rule**: a grain keeps its mark and SHORTENS when the take is sealed shorter than its duration — it never collapses to sample 0 and never restarts. (2) **Frontier grains are landed, not cut**: while recording, a live grain follows the growing buffer at full length; on stop it is given its final length and finishes, no hard cut, no click, no gap. (3) **A take is sealed after the recorder's LAST bundle**: the final partial 2048-sample bundle arrives a task after `stop`, so `_captureStop` waits for it (`whenSealed()`) instead of sealing from what had already arrived and dropping it. Anything that reads a take right after stopping it goes through `whenSealed()`. Transport faults are counted in the worklet's `_diag`. **(4) A jittered read outside the audio is dropped, not clamped** (2026-09-05, Ek: the wash's "comb filter / zipper right at the beginning", with the dry monitor off): start jitter used to clamp to sample 0 on the negative side and be slid to the edge by the fit block on the positive side, so in the first jitter-width of a take every grain of a dense brush landed on one of two samples — the wash's 400 ms grains every 15 ms with ±400 ms jitter became twenty-seven copies of the same few milliseconds 15 ms apart, a comb with notches every 66 Hz, gone once the take outgrew the jitter; pen, sparser, barely showed it. Dropping thins the brush near an edge (half the reads at a take's very start, none away from the edges) and never piles it up; an unjittered mark keeps every frontier rule. Counted as `jitterDropped` in `_diag`; `grain-engine.test.mjs` has the four cases. Part one of that doc was a reading copy of the engine; the code is the copy that is kept current.

**Sensors round ten** (`docs/archive/SENSORS-ROUND-TEN.md`, #314, 2026-09-01). The rulings behind Settings → Sensors and the chrome pills. One word per transport — `wifi` · `usb` · `osc`, never "serial". Three attach controls (`Add over USB`, `Rescan`, per-row `Connect`); no layer headings (who owns a setting is our problem, not the player's); no Sources table — its facts are the list head's one line and the empty state. Three zeros became one row, **Where forward is**: `Set mounting` (the whole pose, once per mounting), `Zero heading` (yaw only, before each set) and a quiet `Clear`, with the status in the description. The nine measurements live in Diagnostics; only the live `msg/s` badge stays on the sensor. One door for the device's own storage, **Instrument settings**, rendered only for sensors that have storage. **The pills read `● SUBJECT · slot`** — subject fixed, slot a fixed 40 px (`—` · `found` · `wifi` / `usb` / `osc` · `usb 2` when several, showing the transport that carries the cursor · `lost`), because a readout glanced at forty times a set must not change width; no third pill for OSC, which is how a sensor got here, not a second question; the pill reads `S.rig`, published once from `_updateSensorGroup()`, never a regex over a hidden footer's text. `mic → input` (R11) was a rename to ASK about first.

**The heading zero is the yaw the app reads** (`js/sensor-registry.js` `captureHeading`, 2026-09-10). Ek: "when i zero it doesn't go back to 0 0 lon lat, always a bit off, only sometimes, even with mag off." H was `twistAboutZ(q·conj(B))`, the swing-twist split, which is the heading only when the pose is level: what remains after removing the twist carries a yaw of its own whenever pitch and roll are both non-zero (0.9° at 10°/10°, 8° at 20°/45°), and near a 180° roll — the rig's uncalibrated, near-inverted mount, read live at roll −175.7° — the twist is two vanishing components, so 4° of pitch at zero time moved the residual by 72° and the zero landed at lon −69°. "Sometimes" was the roll the hand happened to hold. Now `H = Rz(yaw(q·conj(B)))`, `quatToEulerDeg`'s yaw — the azimuth of the forward axis — as a pure Z rotation, so `zeroEuler.z` is 0 the instant after the press at every attitude; H is still about world Z, so a turn still commutes and § B, E, G hold unchanged. The twist stays where the pose is level by construction (mount pose 1, the v1 migration). Pitch and roll after a zero remain the attitude held — a zero cannot level a tilted board, that is the mount's job. Not magnetometer-related: the sensor sends a quaternion and the fault was ours. § B2 of `sensor-audit.js` zeroes at 300 rolled, pitched attitudes and at the live quaternion, and fails against the old definition (worst 180°).

**Extra long, and what shares a button (Ek, 2026-09-10).** "i think we need an extra long hold. and again the setting to change the number of ms." A sixth gesture, `xlong`, on a second timer (`buttonTiming.xlong`, 3000 ms by default — long is 300 and the tap window 120, Ek's numbers of the same day — held above `long` by the setter) — at the extra-long time while still held, after long has already fired, the way a press has fired before a long; so it carries what can follow a long, and a momentary on long is still on when it fires (the button's held gestures are a LIST now, all released on the up). Learning waits for it: a hold released between the two times learns as long. The rule Ek asked for, now a row on Settings → Instrument buttons: **only tap, long and extra long are true alternatives** (one of them fires, by how long the button is down); everything else STACKS — a press fires on every gesture of its button, ×2 and ×3 replace only the second and third press (the first press or tap has already fired), and a momentary on press or long is still on when long or extra long fires. So tap-for-toggle and long-for-momentary works, and a ×2 beside them fires after the tap, not instead of it. Same day: **dry monitor mute is an action** (`dry_mute`, `/dry/mute`; `dry_mute_hold`, `/dry/mute/hold`), the footer's dry switch bindable — off is the mute, and unmuting returns to the mode it left, on or auto, never blindly to on.

**The factory button set, and the pin pair on the palette (Ek, 2026-09-10).** The instrument's three buttons ship bound tap · long · extra long: **1** is the hand (`tile 3 (tape) · activate (toggle)`, `tile 4 (grain) · activate (momentary)`), **2** is the session (`undo`, `sweep the scratch`, `erase all`), **3** is the pins (`pin here`, `unpin`, `unpin all`) — Ek's own map, made the default so a fresh profile plays the way the rig does; it was the three palette presses before. A saved map is still never re-defaulted. **Pin · unpin are on the palette again**, after a second hairline — "pin and unpin should have dedicated tile buttons like the palette. just add a divider and put the pin and unpin button to the right side". They left it in #256 as "two buttons pretending to be instruments"; what is different now is that they are ACTIONS in the tile's box and nothing else: grey glyph (a pin holds any engine's material), no armed or playing face, the 180 ms flash the pins rail already had, the key in the corner from the keys page. Space cannot fire them, so they are not tools and never join the arm or the cycle; the palette audit asserts five tools + two actions, two hairlines, the pair last and never armed. Same day: the Instrument buttons page's descriptions read full width — its rows are read, not set. **And unpin is `unpin`, not `unpin nearest`** — nearest, farthest or oldest is Settings → Pins, and "unpin does the version of whatever the setting is". The `-` key and the pins rail's button had a nearest-only search of their own (`releaseNearestPin`, deliberately ignoring the setting per its own comment) while the action, OSC, MIDI and the buttons went through `releaseCommit()` → `selectedPinSlot()`; the nearest-only path is deleted and every unpin is one path.

**Every learned key and MIDI note is a button (Ek, 2026-09-11).** "we designed a super complex
  button system with tap hold press x2 x3 long hold. can the keyboard do that too? it should
  follow the same system/rule as the buttons so if i ever change how the button works the
  keyboard should follow … position 1 i can map to Q tap. position 3 i can map to Q long.
  position 2, keyboard number 5 extra long … it will be a great way to practice with the
  computer having it mirror what the button does." `midi.js` `dispatchGesture(src, down)` is the
  one recogniser, keyed by a SOURCE string — `btn:N` for the instrument, `key:Code[+shift][+ctrl]
  [+meta]` for a learned key, `note:ch:num` for a MIDI note — and every binding in the three maps
  carries a gesture `g` (absent = press, what every key and note did before). Same six gestures,
  same timings (Settings → Instrument buttons), same rules: a press never waits, a tap beside a
  ×2 waits the window, a neighbour swallows what the press did. events.js sends a learned key's
  two edges (matched by CODE, so a modifier changing under a held key still releases it; a window
  blur releases everything down); `handleMidiMessage` sends a note's on and off and keeps CCs
  as travel. Learning a key or a note watches the whole gesture like a button's — hold R past
  the long time and the row learns "R long"; ⇧-click the cell for a tap. The factory keys (a
  digit, S, M, space …) are not bindings and stay direct, one edge each; a key learned onto a
  digit still stands the digit down (`_keyRelearned`). `S._holdActionIds` and the per-key hold
  map events.js kept are gone — the recogniser owns the release.

**A tap beside a ×2 waits the window (Ek, 2026-09-10, evening).** "for button 3 i want one press to be drop pin, two press to be pickup pin, 3 press to be pick up all. but right now it always does drop pin, then when i try ×2 it drops then picks up." The morning's rule had the tap fire at the up edge and ×2 replace only the second press, so the first press's tap always fired first. Now, on a button with a ×2 or ×3 bound, the tap is DEFERRED to the end of the tap window (`st.tapDeferred`): one press is the tap, two the ×2, three the ×3, exactly one fires, and the tap costs the window (120 ms). **The window runs from the UP edge**: it is the gap after a press in which the next press counts, because the gap is what a hand controls — from the down, 120 ms would have asked for a second down within 120 ms of the first. The press keeps its ruling — the down edge is never delayed, a press stacks on every gesture of its button — so a take button is unchanged. Button 3 ships tap · ×2 · ×3 = pin here · unpin · unpin all; long and extra long there are free. The Instrument buttons page's "What shares a button" row says so.

**The pin action is the `=` key (Ek, 2026-09-10, evening).** "the pin binding is old i think, it only pins clouds. it should pin the same as the = button which pins whatever the cursor is on." `commit_drop` chose by `S.commitMode` (cloud → plant a seed, else drop a loop) — the pre-brush-model rule, where the mode setting said what a pin was. The `=` key (`tiles.js` `pinDown` / `pinUp`, #238) decides by what the cursor is ON: painting a tape stroke grows the loop to the release, a stroke in reach becomes a loop, nothing in reach pins a ghost cloud at the cursor. Both action forms go through it now — `commit_drop` is `S._pinTap`, `commit_draw` is `S._pinHold(on)` — sequenced so a quick momentary cannot release before its down has landed. The old loop-arm branch of `commit_draw` (a live take recorded straight into a loop) went with it: the tape brush is that take.

**A press's neighbour swallows the take the press started (Ek, 2026-09-10, evening).** "set loop (toggle) using button 1 press. on the same button i want grain (momentary) to be button 1 long. so when button 1 long activates it'll cancel the loop that just started as if it was never meant to be, then do cloud." The press cannot wait — the down edge is the take's start — so exclusivity with a long is impossible; what is possible is the abort. When long, extra long, ×2 or ×3 fires on a button whose press fired an ACTIVATE this sequence (`palette_N_toggle` / `_hold`, `trace_toggle`, `recpaint`), the recogniser calls `S._gestureAbort()` before the neighbour fires: brush.js ends the gesture with the stroke id stamped in `S._abortStrokeId`, and `_commitTraceStroke` (events.js) discards the stroke once it has sealed — `history.discard()`, the stroke's own undo run and the action gone for good, never redoable, nothing armed — waiting for the seal so the recorder's last bundle cannot land in a freed slot. Only activates are aborted: a press that pinned or undid is a fact, and its neighbour is bound to what follows it (button 3's press · ×2 · ×3 = pin · unpin · unpin all nets to a cancel by its own actions). Proven: a take started on button 1's press is thrown away at 300 ms and the grain momentary runs and is kept; a plain toggle take on the same button is kept and armed.

**The swallow is general (Ek, 2026-09-10, later).** "pin with button 3 press, then pin (drawn momentary) with button 3 long. i see the first pin drop with the press, but once the long activated it started a new pin. i was expecting it to remove that first pin like it was never meant." The paragraph above limited the swallow to activates; that was wrong. A press's neighbour takes back WHATEVER the press did: `st.pressMark` is the undo stack's height at the down, and `_abortPress` runs `history.discardSince(mark)` — every action the press wrote since (a pin, a sweep, an erase), undone newest-first and gone for good — before aborting a gesture the press started (the take path, unchanged: an in-progress stroke is left to the seal). A press that only undid wrote nothing above the mark, so nothing is taken back and the undo stands.
