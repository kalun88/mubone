# Rulings — how the instrument is built, and why

> **Status: CURRENT.** The architecture rulings that used to live in CLAUDE.md's "Key architecture patterns" and "Debugging approach", moved here verbatim on 2026-09-05 so a session reads them when it touches the area, not on every boot. Each entry is a decision Ek made and the reasoning that has to survive the next refactor. Code wins on conflict — fix the entry. **A new ruling goes here, in one paragraph, the day it is made**; CLAUDE.md keeps one line pointing at it.

How to use this file: find the heading for the area you are about to touch and read that entry and its neighbours. Do not read it top to bottom at the start of a session.

---

## The instrument — tiles, palette, button, pins, latency

- **The pinned rail is a mixer, and the track is its fader** (`js/ui-pins.js`, 2026-09-16; designed on
  the canvas in `docs/mockups/pins-rail/`). One 32px bar per pin. Its FILL is the level, read from the
  audio every frame — a loop's `_gainNode × _muteGain × _pinGain`, a cloud's envelope × focus weight ×
  volume — so the bar is the truth, never a copy; dragging it writes the pin's `level`. **The fader is
  its own stage** (Ek, 2026-09-16: a grain tool at 0.85 pinned clouds whose track read −1.4 dB while a
  loop read 0 — "it should be like … a new pin's fader start at unity and keep the brush's volume as a
  separate multiplier underneath … same with loops"): `level` is 1 when the pin is made, the block's
  `volume` (the brush's or the tape tool's slider, copied in at pin time) rides under it, a loop's gain
  node carries the product (`grain.js` `_loopGain`) and a cloud's seed gain does; the bar shows the
  fader alone. **The fader has headroom** (Ek, the same hour: "i see the mixer as increasing or
  decreasing the volume so should it start at unity 0 then i can make things louder or softer?"): a
  channel fader's law — unity is the kit's 2px TICK two thirds along, the right end +12 dB (Ek: "+6db
  doesnt sound like it's enough"; Pro Tools' range), one power curve through both (`_levelOf` / `_posOf`, ui-pins.js); `level` stays the amplitude so the
  engine never sees the law; the readout wears a `+` above unity; double-click is the tick. It used to write `grainParams.volume`, the one volume both kinds already had. The MATERIAL you drew sits inside the bar laid flat, in the pin's slot
  colour (the sphere's), each mark at the size its rms gives it there; a loop is marks on one line, a
  cloud loose dots — the shape says the kind, so the words and the bearing readout went. The NUMBER is
  the engine hue, a label (it folded the pin's own `fadeIn` / `fadeOut` open until 2026-09-23, when Ek
  ruled In / Out one live pair for every pin — Settings › Pins, `pins.js` `pinFadeIn` / `pinFadeOut`,
  never stamped); the loop an overdub would join wears the white O round it. **A mute rides In / Out** the
  same as an unpin, so a pin set to leave over ten seconds leaves that way by either verb
  (`composer.js`), and the playhead runs on through it — the DJ mute made visible. **Sort IS
  `S.selectionMode`**: nearest / farthest / oldest, rows laid out by the key `selectedPinSlot` uses, so
  row one is always what unpin takes and the half moon never disagrees with the order; under nearest in
  focus the rail is a proximity meter. The mode bar (follow · sort; blend and tether until
  2026-09-22 night; the crossfade curve went to Settings → Pins on 2026-09-23, set once, not ridden) is the door to the settings switched mid-set, each writing the S field it always had; the rail polls S on its tick,
  so OSC, MIDI and the settings page land in it without a hook. **Focus is said by the fader edge
  turning `--accent-sensor`** — "the body is driving it" is literally true — never by an ember segment.
  The two groups are the busses at the foot, their fill the members' mean level (derived, no new
  state). The slot tracker is gone: the list is the count, row one the nearest, and a pin above the max
  wears its number outlined. Settings → Pins keeps only what the rail does not hold — when full, and
  what a new pin is born with (Ek: "any pin settings that are now on the pin rail can be removed").

- **The hand's verb comes with the tool** (`js/tiles.js` `pickHand(id, verb)`, `handVerbFor`, 2026-09-16,
  Ek: "when i press on a tool from the palette bar, it goes to the hand. but the toggle / momentary
  verb type should follow that tile it came from. if something from the left rail is chosen, by
  default, tape tools should be toggle, grain tools should be momentary held. erase should be
  momentary held. lens of course toggle"). `handVerb` was one global switch above every tool
  (toggle by factory, then momentary). Now a strip tile's click hands over its own verb — the shape
  you see is the shape you get — and a rail row's click hands over its engine's: a take plays whole
  and latches, paint and erase are held while the key is. The hand tile's right-click still flips it
  afterwards; a pick with no verb (the fallback when a tool is deleted) leaves it. A lens is not a
  hand tool; its tile verb stays `VERBS_OF.lens`, toggle. The 2026-09-04 ruling that the mode sits
  above the tool stands for a BUTTON's tap-vs-hold (never a hybrid); this is which mode the hand
  wakes up in.

- **The selected pin is a FRAME, a fixture of the rail** (`js/ui-pins.js` `.lyr-sel`, 2026-09-16, Ek: "i
  dont think it's obvious enough that the first item on the pinned rail is the selected one. sure we
  have the half moon dot but that's old. i think it needs to be a full border around the first item
  that's always there, even when there are no pins"). Row one is what unpin takes because the sort is
  the selection, and the half moon said so in the rail's radio language — a mark for a reader of the
  design system, not a player mid-show. So the slot itself is drawn: a hairline in the pins hue, 2px
  outside row one's bar (radius r-3 against the bar's r-1, the concentric rule), labelled SELECTED by
  the rail's own eyebrow on the line at its top-right corner with the ground behind it — a tile's
  sticker with a word. It is there when the rail is empty and holds "nothing pinned" in the track's
  own 32px box, so the rail explains itself before the first pin. Nothing new in the kit, and never
  ember: chosen is not exceptional (INSTRUMENT-GUI, the faces). One mark per thing — the moon left
  this rail; source and lens keep it. `_layout` sizes the frame with row one's fold; `SEL_INSET` and
  `SEL_ROOM` mirror the stylesheet.

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
- **THE HAND IS BACK; THE PALETTE IS QUICK ACCESS** (Ek, 2026-09-12: "like any computer painting
  app, the tool rail has the tool. you should be able to pick the tool and have it 'in hand'. in
  hand just should mean what the spacebar or click does. that should be always the truth"). The
  2026-09-11 ruling above cut the hand out because two models fought; one day of playing showed
  the cut was in the wrong place, and the fix is that each model owns its inputs. **The hand** is
  ONE tool (`inHand`, `mubone_hand`), picked by a CLICK on its rail row or strip tile, played by the
  **spacebar** and a **left-click on the sphere** in one global verb (`handVerb`, toggle by factory,
  `mubone_hand_verb`), drawn as the **spacebar plate** under the strip — glyph, name, engine hue,
  its shape the verb in the tile's two radii, lit while the hand plays, a spacebar itself
  (press it), right-click flips the verb. The two inputs are reserved: the keys page refuses the
  spacebar and a stored Space row is dropped at load; there is no `hand` action row. **Quick access**
  is the strip: a tile fires from its own key, button or note, in its own verb, and never touches
  the hand — pen can be in hand while `5` plays pen momentary, and the tile lights, not the plate.
  `_held` stays the one gate (what is PLAYING, one at a time, `i = HAND_POS` for the hand); `Tab`
  opens the in-hand tool's drawer, the drawer follows the hand, and `lastFired` is deleted — a
  quick-access key pulling the drawer off the tool you are working on was the wrong rule once
  there was a hand. **A key belongs to its tile**: every palette key is an explicit row, seeded
  once (1 … 5 on wide · wash · overdub · line · pen, ↑ · ↓ on the pins), carried through every
  place, move and remove by `S._paletteReordered`; **a drop takes the next free digit** (the
  afternoon reversed the morning's "don't auto find a key", and the afternoon stands); a removed
  tile takes its keys, buttons and notes with it. **The legend is a ledger**: one row per binding
  kind the keys page's "on tiles" switches show, each the page's own learn cell brought to the
  tile (`S._paletteLearn` arms the page's `keyLearningId` / `buttonLearningId` / `midiLearningId`;
  the page's recogniser finishes it — no second learn path), Esc or a second click cancels,
  right-click clears. **The verb is the placement's, set on the strip** by right-click (the
  drawer's segment went the same morning: the drawer is the tool's, the verb the placement's), and
  the MODEL refuses a momentary under a TAP (`setVerbAt`), not only the doors. The clicks by kind:
  a tool → in hand; a lens → installed or off (a choice); a pin tile → fired (an act). The in-hand
  tool wears a one-hairline ring on its tile and its row — the armed box is not back. Held by
  `palette-audit` §§ A, C, D, E, H, N, O (the bed measured 12px taller per ledger row).
  `docs/PALETTE-GUI.md` § 1, § 5–6.
- **A `×2` or `×3` bound anywhere on an input delays that input's TAP**, and the
  slowed tile says so with `···` (PALETTE-GUI § 7). The recogniser defers a tap
  it might have to re-read as the first of a pair (`dispatchGesture`:
  `if (counting) st.tapDeferred = true`), which is correct and invisible — a
  timing change to a gesture the performer did not touch. MEASURED, five presses
  each, from the up edge to the recogniser's own event: **123.6–127.8 ms** with a
  sibling `×2`, **0.1–0.3 ms** without. It shipped until 2026-09-12: pin was button 3
  tap and unpin button 3 `×2`, so pinning with your thumb was ~125 ms late from the day
  the button map was written (pin is the press now — see the paragraph below). Only a TAP is slowed — a
  press fires on the down edge — and only the slowed tile wears the mark, never
  the `×2`'s own. **Measuring it found a second trap**: `renumberPaletteOnce`
  ran on a FRESH profile, over a `BUTTON_DEFAULTS` already written in today's
  numbering, and shifted every factory button down a position — button 1 onto
  the lens, the pin pair onto 6 and 5. Invisible since it landed, because
  nothing read the factory button map back until the delay mark needed to know
  what sat on button 3. Both one-shot migrations now skip a map the profile
  never stored, which is the rule every one-shot migration should have had.
- **The factory pin is button 3's PRESS, so the pin tile has three verbs** (Ek, 2026-09-12: "as i
  right click thru pin it should have 3 states avail. right now it's just toggle and bang. it should
  have momentary"). The model refuses a momentary under a TAP (a tap has no up edge), and the factory
  map put pin on button 3's tap, so the one pin tile every profile starts with could never take its
  third verb. The tap was chosen on 2026-09-10 so that "one press = pin, two = unpin" did not pin
  before the ×2 fired; the swallow being general since that evening (a press's neighbour takes back
  whatever the press did) makes the press the better binding anyway: it pins on the down, undelayed,
  the ×2 takes that pin back and unpins, and a momentary path holds. `BUTTON_DEFAULTS` says press; a
  stored map with button 3 tap on `palette_6` is moved to press once at load.
- **The wash is the looper's move for the grain family** — and since 2026-09-22 it is a MODE, not a
  tool. Ek deleted the tile ("remove trail the preset"); everything below still holds except for
  WHERE you turn it on. It is **`autopin`, the grain tab's MODE switch** — `_AUTOPIN.granular` is
  `{ pid: 'gEnd', on: 'cloud', off: 'scratch' }`, so the switch reads and writes the very param the
  sheet's `on end` row used to show, and that row left the sheet with the rest of the MODE pile
  (`SWITCH_PIDS.granular = ['gEnd']`). One standing answer per instrument, not a property of the
  shape in your hand. `FACTORY_SOUND` is empty with the tile (its one entry was the wash's reverb
  block) and the mechanism is kept for the next tile that has to arrive sounding like itself.
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
  press and drag it to set, click without moving to type (the DIGITS are selected, the unit
  left standing, so the next keystroke replaces the value — Blender, Figma, Photoshop; a click on a
  cell already being edited places the caret; 2026-09-23), double-click to reset, shift
  for the track's quarter-speed fine drag — the number field of Ableton, Logic and Photoshop. That
  is how the ± SPREAD is set. It used to be ⌥-drag on the track, and ⌥ is the cursor LOCK
  (`js/events.js`), so one key did two jobs; the modifier gesture was invisible besides, while the
  spread's cell is on screen at the end of its row with a resize cursor. Two things the gesture
  needed: the band is always in the DOM, hidden at zero, so a spread raised from nothing appears at
  once, and `_paintRow` on a spread repaints its BASE row — the row that draws the band and the
  cell's zero state. Covered by `engine-audit.js` § B2.
  **The band's EDGE sets the spread too** (Ek, 2026-09-23: "i want to be able to drag the jitter
  still, shift?"). No modifier is free — shift is the fine drag, ⌥ the lock — and no DAW puts a range
  on one: a range is dragged by its edge, with nothing held (Bitwig's modulation ring, Sampler's zone
  edges, Max's rslider, every two-thumb slider). So the track is that: the HANDLE moves the value,
  the band's EDGE widens or narrows the spread about it, the ± cell following; shift is quarter-speed
  on both. At zero spread there is no edge, so a fixed zone just outside the handle (3–10 px) always
  means the edge — reach past the handle and pull outward and the band opens from nothing. The
  pointer says which it is over (`col-resize` on an edge, the sample slot's handle cursor). The
  band's half-width is `vf × 45 %` of the track (`_knobFor`), and the edge drag is its inverse.
- **A sub-row is a parameter OF a parameter** (Ek, 2026-09-23: "step is part of pitch … taper is
  part of curve, it should be under curve firstly, then indented") — `SUB_OF` in `js/tiles.js`:
  taper → curve, step → pitch (tape), octave → pitch, res → cutoff. The row sits directly
  under its parent in `VOICE_PIDS` and wears `prow--sub`: the NAME steps in one step of the scale
  (`--sp-5`) and one step quieter (`--text-tertiary` against the sheet's `--text-secondary`); the
  track, chips and number stay in their columns, so only the word moves — the tab's `mrow--sub`
  (dwell and retrig under walk), on the sheet. Nothing about a pid, a binding, an OSC address or a
  stored block changes; it is the sheet's reading order. A ± spread is NOT a sub-row — it is folded
  into its base row as the band (#277).
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

- **Bright means SOUNDING, and the MARK carries that, not the cap** (2026-09-15, Ek: "when i turn
  the lens off … the pinned clouds still are audible as i expect but they are greyed out in the
  viz"). With the lens capped the cursor posts no candidates and `grain.js` simulates the onsets it
  would have had, so you can still see what the cursor is over; those entries are tagged `ghost` in
  `activeGrainMap` and the renderer draws them at a quarter weight. It used to dim on `S.scanMuted`
  instead — the whole batch, in one `globalAlpha` — and a PINNED CLOUD goes on playing under the cap,
  so the marks it was audibly granulating were greyed along with the simulation. The tag is the fix
  because the two are indistinguishable from outside: the worklet's feedback is a flat list of
  particle ids and the cloud's grains and the cursor's carry the same white tag. perfMode had the
  same bug pointing the other way — no faint pass at all, so it lit the simulation at full weight —
  and now treats a ghost as not active. **A mark that is lit and silent is a lie either way round.**
  The two cannot collide on one mark: a pinned cloud claims its material, the cursor's pool skips it,
  and the preview is drawn from that pool.

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
  `ENGINES.tape`, `engineOf → 'tape'`, `SLOT_KINDS`, `DEFAULT_SLOTS`, the rail group, the lens's
  touch section (`on tape` then, `cursor behaviour` since the walker), `--eng-tape`, and the brush material — with a one-shot `mubone_slots` key migration and
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
  tape hides `k` and `order`, reading grains hides the whole `cursor behaviour` family — unless the
  lens is in `stroke` mode, where a grain stroke's WALKER answers to exactly those rows.

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
- **The tape has its own direction, and the lens flips it** (2026-09-18, `docs/TAPE-STUDY-2026-09.md`).
  Until then the only backwards playback was the lens's `start: ends` turntable rule, and a pinned
  loop took its direction from the CLOUD's `path dir`, a setting no tape tile shows. `reverse` is
  a switch on the tape sheet, baked like speed: `S.triggerParams.reverse` → the trigger shell's
  own `reverse` field (`direction` is what a FIRE runs at and `_onEnter` rewrites it every time,
  so the baked value needs a field nothing rewrites) → the pinned slot's `direction`, stamped by
  `createSeqFromStroke` from the trigger; the piece file carries it beside speed and passes.
  `start: ends` composes: arriving at the tail flips the tape's own direction, so a reversed tape
  entered at its tail runs forward — Tensor's DIR switch against its SPEED sign, both reversed is
  forward. `path dir` is the cloud's alone. The tape sheet's sections are named by EFFECT like the
  grain sheet's (`tape` · `on end` · `slicing`), because `baked in` said how a value is stored and
  not what it does; `loop on end` is the row `loop` under `on end`, the sentence the switch ruling
  above asked for. What the field does with reverse, speed and pitch, and the rounds that follow
  (pitch by an offline phase vocoder, overdub decay, the dub's one-shot), are the study's § 3–4.
- **The tape's pitch is a second dial, baked, and computed offline** (2026-09-18, the study § 3).
  The field has three parametrisations of speed and pitch — the tape's one knob, Tensor's and
  Blooper's three, Octatrack's two plus a switch — and mubone takes two dials with no switch:
  `speed` is tape (pitch follows), `pitch` is Blooper's Pitcher, a shift on top at constant length.
  Stretcher is speed with pitch cancelling it, a gesture nobody rides while drawing, so it is not
  baked; if it ever rides live from the instrument it is the wet-loop round, and the live path is
  the grain engine reading the take SEQUENTIALLY. Because a baked value never needs real time, the
  region is stretched ONCE in a Worker by a phase vocoder (`js/workers/phase-vocoder.worker.js`,
  2048-point frames, identity phase locking, the output trimmed to the exact length) and played
  at speed × ratio: the stretch and the rate cancel in time, so every reader of `seq.speed`
  against the original region — the playhead, the overdub fold, the tail — is untouched, and
  overdub layers keep the pitch they were sung at. Electron refuses a Worker from a `file://`
  URL, so `js/tape-pitch.js` fetches the source and spins the worker from a blob. `step` is one
  capsule for the pair (`free · semi · oct+5th`), quantising the DIAL so a stored value is always
  what the sheet shows. Measured: a 2 s region stretched ×2 in 72 ms; the stretch starts at arm
  and at pin (`S._prepareTapePitch`) so the first fire does not wait on it.
- **Overdub decay is a wear on the family, and the dub's bang is Blooper's one-shot** (2026-09-18,
  the study § 4 and § 6.3). `decay` is the dub tile's one dial, a percentage, baked at the press:
  at every wrap of the master WHILE THE DUB RECORDS, the master's own material and every earlier
  layer step down by that much, and the take's own earlier passes fold in already worn (pass p of
  P scaled by (1 − d)^(P − 1 − p)). Nothing fades in playback — Blooper's REPEATS rule, Tensor's
  loop decay, Octatrack's GAIN. It is held as `wear` per family member, never written into the
  audio: the master got a gain of its own in front of the family node the layers share
  (`seq._ownGain`), each layer's gain carries its wear, the piece file carries both, and undoing
  the dub gives the family the wears it had at the press (`ov.wearBefore` / `wearAfter`). The dub
  is the one TOOL allowed the bang verb (`VERBS_OF.overdub`): toggle is the overdub, momentary the
  punch-in, bang the ONE-SHOT — press, and it records exactly one cycle of its master and releases
  itself. A timer lands the release near the wrap and the fold trims the take to the cycle
  exactly, so the layer is one pass whatever the timer did; with nothing pinned the bang refuses
  (a one-shot has no length without a cycle) where the dub already flashes. Measured on the real
  path: two wraps at 50 % wore the master to 0.25 with its gain following, undo restored 1, redo
  restored 0.25.
- **The registry is the screen** (2026-09-24, Ek: "the app is considered spec, what i see are generally
  the things i want to be key bindable … go thru all the GUI available items and make sure they're on
  the keys+midi"). `ACTIONS` in `js/midi.js` has one row per control on the rig screen, grouped by the
  screen's own areas in screen order — palette · hand · tape · grain · erase · cursor · pins · chrome —
  and named the way the screen names them; a value set once on a Settings page stays bindable under
  `settings`. One control, one row: a second door onto the same state goes (`commit_drop` / `draw` /
  `release` were `palette_3` and `palette_4`'s verbs; `scan_toggle` and the `S` key were `palette_1`'s
  toggle; `palette_5..9` had no position; `grain_retrig` wrote a field nothing read). A rename carries
  its bindings through `_RENAMED_IDS`; a retirement drops them through `_RETIRED_IDS`. Every switch
  takes 1 / 0 to set and anything else to flip (`_onOff`, `/…` via `_bangOrOnOff`); every capsule
  takes a string to set and a bang to cycle (`_strMode` + `_cycle`). The reach is through `S._set…`
  doors that call the same setters the clicks do, so a key, a pad, an address and a click leave the app
  in one state. `scripts/osc-audit.js` reads the table, so a row with no case is a finding there.
- **The stroke WALKER is the lens's third mode** (2026-09-18, `js/walker.js`, the study § 7). The
  lens's `order: step` was sold as a line loop for the grain engine and could not be one: the
  candidate list is only what sits inside the CURSOR's circle, rebuilt every tick, played one per
  grain period — so it faked a loop for a short stroke under a still cursor and was a shuffle with
  a memory otherwise (Ek: "it's on the lens and it only works on the cursor, which is circular,
  and strokes are not always falling into the cursor circle"). `S.nearestMode` becomes
  `S.nearestMode` became `S.lensMode`. **The walk moved off the lens on 2026-09-22** — see the entry
  below; the lens is `area · nearest`, the aperture, and `S.grainWalk` is the grain shape's `on
  touch`. What follows describes the walk itself, which did not change. While walking the cursor
  reads NOTHING on its own;
  touching a grain stroke launches a walker, a reading cursor that retraces the stroke's own path
  at the pace it was painted — the marks' buffer times ARE its clock, so nothing new is recorded —
  and plays what is in ITS reach with the lens's live radius, `k` and `order`. **`order` still
  applies, and that is the point**: the walker carries the time, `random` or `step` decides the
  texture inside each moment, which is meta-sequential. The result is a granular tape — the loop's
  path and pace, every instant a cloud — and the radius is a time smear. **It is not a pin**: a pin
  is off-cursor and keeps playing; a walker plays once (`dwell: once`) or loops while you are on
  the stroke and dies when you lift off. The pin press takes it exactly as it takes a line, and
  what it freezes into IS a moving cloud — same path, same phase — because that is what a walker
  already is. The gates live beside the tape triggers in `trigger.js` (same cap, nearest-segment,
  hysteresis and swept-crossing geometry, `walk: true`), built only in `stroke` mode; the lens's
  `on tape` family is `cursor behaviour` now, because dwell / start / release / retrig / rearm mean the
  same thing to a take and to a walker. Wet paint reaches a walker for free: the bridge buckets
  its pool by each mark's own voicing, as a cloud's.
- **Wet paint is the cursor's, walk or not** (2026-09-24, Ek: "when i have walk on with grain, and i'm
  painting with the grain tool, it should live granulate while i'm painting but it seems to be muted
  until i am not recording"). Under walk the cursor reads only what a finished walk has opened, and the
  stroke under the brush is never opened — a walk is launched by a TOUCH on a finished stroke. So the
  stroke being painted counts as open for as long as it is being painted (`S.isPainting && S.isRecording`,
  `S.currentStrokeId`, in `_buildCandidatePoolRadius`): it sounds as it goes down, exactly as it does
  with walk off, and walk keeps its meaning for every stroke the brush has left. A take being recorded
  is not wet paint — tape is played whole, never granulated as it goes down — so `_recordingTrigger`
  keeps its marks out. `scripts/lens-audit.js` holds the three cases.
- **The lens sheet is three sections, named for the question each answers** (2026-09-18, Ek: "the
  lens engine sheet is getting pretty confusing … it's really hard to tell just from the params how
  things work together and what links to what or depends on what"). `reach` (reads · radius) holds
  the only two rows that govern BOTH engines — the radius is the grain reach and the distance at
  which a stroke is touched (`enterRad`). `on grains` (mode · depth · k · order · fade · falloff)
  is everything grains-only, with **`mode` leading it**: the tape gate reads the mode in one place,
  to decide whether to build walk gates, and never to decide how a take is touched, so Ek's hunch
  that it belonged with the grains was right. `cursor behaviour` (dwell · start · release · retrig ·
  rearm) is what a touch does. It is NOT "and loops": a pinned loop is claimed and the cursor is
  forbidden to re-fire it (#241), so the lens never reads one.
  **Dependency is shown, not inferred.** Three devices, all already in the kit: every dead row
  hides, and now consistently — the fade pair was dead in nearest and still drawn, and the two
  halves hide as one each way round (`reads: tape` takes the whole grain section, `reads: grains`
  the whole stroke section unless the mode is `stroke`). A section carries one quiet
  `--fs-nano` line where its rows cannot say it themselves, and both notes are computed at render
  so a note never names a row the mode has hidden. And **the `mode` row says what it does under
  itself**, per value — "every mark in reach", "the k closest, anywhere — radius, depth and fade
  are off", "touch a stroke and it plays itself, at its own pace" — which puts the answer at the
  moment of the decision instead of in a tooltip. `on dwell` is `dwell`: the section already says
  it. The eraser borrows `depth` and would have borrowed its section name, so it calls it `reach`
  too, which is what its reach in time is.
- **`dwell: grain` is PLAY ONCE, THEN OPEN** (2026-09-18, Ek: "on loops when on dwell: grain, i
  hear the grain immediate, not after the first loop playback … i want the loop to play once then
  cursor becomes granulator, same as mode stroke, on a grain stroke"). It used to be the bare flag
  `dwell === 'grain'` read in the pool builders, so a tape stroke's material opened to the cursor
  the INSTANT the cursor arrived — the grains sounded over the take's own first pass instead of
  after it. A stroke now lands in `S._openStrokes` when its playthrough ENDS with the cursor still
  on it — a take's one-shot reaching `ended` (`onTriggerSourceEnded`), or a WALKER finishing its
  walk (`walker.js`, `openOnEnd`) — and leaves when the cursor leaves it (`_onExit`). Until then
  the cursor granulates it exactly as `area` would, radius, k, order and fade, whatever the lens's
  mode: **in `stroke` mode the cursor reads nothing of its own EXCEPT an opened stroke**, which is
  what "after the walker is done the cursor should granulate as per mode: area, until i move away
  from it" asks for. So the three dwells read the same in both modes: `once` plays through and
  stops, `grain` plays through and hands the material to the cursor, `loop` repeats. The set is
  empty in every other case, so the builders' hot loop costs one `.size` read; a walker asks
  `gateInside` before opening, because a `once` walker plays out after the cursor has left and
  must not re-open what the exit closed.
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
  (That entry went when the wash tile did, 2026-09-22; the table is empty and its two readers stand.)
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
  other and goes through the same migration. **Superseded 2026-09-23 by the one filter below.**

- **One filter per grain** (2026-09-23, Ek: "i'm not confident it's a good filter, what do grain
  filters normally look like and can it be simpler or more musical"). The two-corner layout — a
  high-pass and a low-pass with a Q each — is an EQ's, not a grain synth's: Granulator, Pigments,
  Quanta, Portal and Emission Control all put ONE filter on the grain, a type (`lp · bp · hp`), a
  cutoff, a resonance and a per-grain spread, and the band-pass is the one that makes a pitched
  cloud, which the old sheet could not make at all. The 09-07 Q split was treating a symptom of the
  model. So the sheet is a `filter` SWITCH, a `type` capsule, `cutoff`, `res` and `cutoff ±`; the
  engine is Simper's trapezoidal SVF, one section per grain where there were two biquads, the
  three outputs picked per sample. `res` is 0–1 on a log curve from Butterworth (0.707) to Q 10
  (`FILTER_Q_FLAT` / `FILTER_Q_PEAK` in state.js, repeated in the worklet because it cannot
  import): the top of the track is "about to ring", not the +26 dB that Q 20 gave. The band output
  is normalised so a cloud does not get louder as it narrows; low and high keep their bump, which
  is the control. **The drawing is the real transfer function** on a dB axis (+24 to −36) — the
  old one drooped to 70 % at 20 Hz / 20 kHz while the engine bypassed there, its Q was a hand-made
  bump that left the canvas at Q ≈ 2, and its double-click reset still named a pid the Q split had
  removed. Block keys `filterType` (0 off, 1 lp, 2 bp, 3 hp) `cutoff` `res`; UI state `filterOn`
  `filterMode`; pids `flt ftype cutoff res fltJit`; OSC `/grain/filter` `/grain/filtertype`
  `/grain/cutoff` `/grain/res`, the four corner addresses deleted, not aliased. `EXPORT_VERSION`
  15, `migrateBlockKeys` and `_migratePids` through `filterFromCorners`: a low-pass alone becomes
  `lp`, a high-pass alone `hp`, both set a `bp` at the geometric centre with the Q the band
  implies, nothing set is off. Stored MIDI bindings on the four old action ids are not migrated;
  they point at nothing and can be re-learned.

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
  tied, the handover is a smoothstep over the last `xfade` of that span. (Tether off kept the
  reach ring as a gate until 2026-09-22 night; there is no gate now — see the glossary's
  "Tether — deleted".) On an anchor the nearest pin is alone at any width; midway the mix is
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
  **A pin you cannot hear is not a crossfade partner** (2026-09-16): the weight pass skipped only a
  cloud with `playing === false`, so a muted loop, a cloud under a mute hold and a pin on its way
  out (`isPinLeaving`) could still be `nearest` — and with `d0` = 0 on a silent pin every audible
  pin's weight went to zero while the cursor sat on it. The pass now skips anything `isCommitOn`
  says is off or `isPinLeaving` says is going, so focus is a crossfade between the pins that sound.

- **The cursor is ONE rule** (`js/sphere.js` `cursorLonLatNow`, 2026-09-16): a cursor sensor
  (`cursorQ`, the two-sensor modes) is the cursor; otherwise the pointer is, while it is ON the
  canvas or frozen there by ⌥; off the canvas the cursor is the camera's centre, which is what the
  sensor steers in single-sensor mode. The rule had been copied into seven modules and two of the
  copies — the paint ticker and the eraser — read the pointer wherever it was. Found on the
  2026-09-16 long run: with the pointer resting outside the private window, forty minutes of
  strokes were laid at the pointer's last projection while the scan read the centre, so the ink and
  the ear never met and the worklet fired no grain the whole session. On the rig the same happens
  whenever the pointer rests on a rail while the sensor drives. Everything that paints, erases,
  scans, listens or maps at the cursor calls the one function, the renderer's three included.

- **Undo is unbounded, and the worklet holds only what can sound** (2026-09-16, Ek: "i really
  want to be able to undo to the beginning just by undoing, that's worth the price — but double
  check if there's a less memory costly way"). The price is ONE copy of every take ever recorded,
  on the main thread, as the AudioBuffer history's entries reference — 48 kHz mono float32 is
  11.5 MB a minute, so an hour's playing is ~700 MB whatever else is done, and that is the cost
  Ek accepts. What was NOT the price: the worklet's own Float32 copy of every take, kept after
  the take was swept or erased (only undo and redo ever resynced it) — a second ~700 MB on the
  audio thread's side, the "group-show noise glitch" retention, and on the 2026-09-16 long runs
  the place both ~50 ms audio stalls landed. Since 2026-09-16 `sweep()` and `eraseAll()` call
  `resyncWorkletBuffers()` the moment they compact, so the worklet carries only takes a candidate
  can read; an undo that brings a take back re-registers it (one memcpy + a zero-copy transfer,
  ~1 MB for a five-second take). The less costly way that is still on the table, sketched in
  `docs/TODO.md`: erased material held ONCE as a raw Float32Array moved between the threads by
  transfer (the AudioBuffer rebuilt on undo), which halves the live copies too. Not Int16: the
  file is float32 on purpose and undo must give back exactly what was taken. **Measured the next day
  (2026-09-17, a quiet 40-minute run):** the audio thread itself never stalled (`process()` ≤ 1 ms),
  the faults came at minute 38 with the renderer at 939 MB on an 8 GB machine with swap in use — so on
  the laptop the memory IS the stability, and the transfer design is on the list for that reason.
  It is the only pin cue on the cursor: the pin COMPASS (a short arc per pin in reach, on a ring
  outside the reach ring, opacity by share) went the same day (Ek: "now that we have the one-line
  selector we can remove those indicators") — the line says which pin, the rail's mark which is
  selected, and the mix is heard, not drawn.
  Covered by `pins-audit.js` § C.

---

**Toggle or momentary is the binding, not a setting; tool keys fire is gone (Ek, 2026-09-09).** "i need clarity in the table … if it's buildable in the table assignments i prefer that than having settings that actually change the bindings." The Main button's toggle/momentary switch (`S.gestureMomentary`, 2026-09-04) and "tool keys fire" (`S.paletteTrigger`) were two settings whose whole effect was to change what a binding did. Both are rows now: `activate (toggle)` (space, a click; `/trace/toggle`) and `activate (momentary)` (a pedal; `/trace 1|0`); each slot is `tile N (kind) · arm` (the digit; arm, then cycle), `· activate (toggle)` (`palette_N_toggle`, `/palette/N/toggle`; the instrument's buttons by default) and `· activate (momentary)` (`palette_N_hold`, `/palette/N/hold`). `gesturePress(momentary)` carries the kind; a play remembers the kind it started as. A key learned onto a play is what tool-keys-fire was. Titles are by tile POSITION — `tile 3 (tape)` — because the palette is what the player sees. The camera-mode and spatial-panning actions left the table the same day (the header capsule and the settings page set them); their OSC addresses went with them. The tap gesture went that afternoon ("remove mentions of tap") and came back that evening on testing ("it's useful to have tap, which is fire on the up"): a BANG on the up edge of a short press nothing else claimed, allowed beside a press on the same button, never for a momentary (no second edge); ⇧-click the cell to learn it. The gestures are press · tap · long press · ×2 · ×3.

**A button always sends 1 and 0; the action decides (Ek, 2026-09-09).** Every physical button and every key sends both edges, the down and the up. A **momentary** action (type id `hold`) takes the whole button — on at the down, off at the up — and has no gestures: learning it binds the button itself, whatever was done. A **toggle** action flips on each press; it and every other **bang** (type id `trigger`, the OSC word) can sit on any of the five gestures — press (the down, never delayed: "the down edge needs to be the thing that starts and ends a take"), tap (the up), **long press** (at the end of the long time, still held), ×2 and ×3 (on the second and third press inside the window, INSTEAD of the press). Where an action exists in both versions the version is in its title — `system mute (toggle)`, `system mute (momentary)` — and the keys page's sub-line carries OSC facts only, the address and the format. The three slots' `(play)` actions are momentary in shape but follow the Main button setting, toggle by default, which is the one mode setting above every tool. No per-button momentary-or-bang option: "the hardware button always sends 1 and 0. the software deals with those in special ways depending on what it's bound to." An earlier draft the same day used "on/off" for the action type and reserved toggle for the Main button; Ek ruled it more complicated than the thing it described. "Hold" is not a word of the instrument.

**The pin takes the whole moment, not the nearest half of it (Ek, 2026-09-14).** "it's unclear if my cursor is actively on top of grains AND triggering a line (loop), and i drop a pin, does a pin drop on both? it doesn't do that now and it seems it's choosing whatever's closer … the point of the pin is to take that moment, whatever it is and have it continue off cursor." It was choosing: `pinDown` took the NEAREST mark, asked whether it was tape, and did one thing — a loop from that one stroke, or a cloud. So a cursor standing on a chord of three lines pinned one of them, and a cursor over grains AND a line pinned whichever mark happened to be closer. The two halves are independent in the engine and always were — the grain scheduler skips `trig` material, so grains and lines never read the same marks — which is what makes taking both honest rather than a doubling. Now every line the cursor is on becomes a loop and a granulating cursor adds a cloud beside them; nothing in reach still pins the ghost.

WHICH LINES is the trigger gate's OWN answer (`trigger._inside`), not a second search. Three things follow from that and none of them is free: the gate measures to the drawn SEGMENT between marks, so a cursor resting on the ribbon between two far-apart marks is inside for it and would have been outside for a mark-based search — the same hole that made lines "sometimes not fire" before the gate moved to segments; `_inside` keeps tracking while a stroke is CLAIMED by a pinned loop, so pinning a second playhead onto an already-pinned line still works, which a `playing` test would have silently removed; and it keeps tracking while the scan is muted, so a press still takes what the cursor is standing on when nothing is sounding. The anchor is the gate's `_nearestIdx` — the mark the cursor is over, which under `start: touch` is where that line fired from, so the loop begins on the sound you just heard. Tape material no armed trigger covers has no gate to ask, and falls back to the nearest `trig` mark in radius; granular marks are never candidates, which is the `.trig` test that used to live in the caller.

Three consequences were paid for rather than assumed. A press must not evict what the SAME press just pinned (`_thisPress`), or under overflow oldest/nearest the third pin of a press takes back the first — the overflow rule is about the pins that were there BEFORE the gesture. A press is ONE undo even though its halves land on different edges, the loops on the down so the button recogniser's swallow can still take the press back mid-hold and the cloud on the release because a held pin draws a moving cloud: `history.mergeTagged` folds them on the stack in place, rather than a detach-and-push pair, which would clear the redo stack as a side effect. And `createSeqFromStroke` now builds its audio BEFORE it evicts and records what it evicted — it had been doing neither, so a drop on unusable material silently emptied a slot and undoing a loop that had evicted a pin brought back the loop and not the pin, while the cloud path beside it had always been correct.

**The pinned rail carries the slot tracker, and the max (Ek, 2026-09-14).** "there used to be a tracker with slots of how many pins are filled, i want to bring that back and put that in the pin rail. also the max slot number and ability to set that should also be in the pin rail." It still existed — `#commitSlotsCanvas` and `#commitCountLabel` in the hidden cabinet, borrowed by Settings → Pins — so the answer to "how full am I" was behind a door, which is no answer during a set and less of one now that one press can take several slots. One cell per slot, a filled cell in its pin's ENGINE hue so fullness and mix read together, `3 / 8` beside them with the 8 typeable and steppable. This is the ONE amendment to "every pin parameter is on Settings → Pins and nowhere else": the count is not a parameter you set and forget, it is the tracker's own scale, and the pips are unreadable without it. Both doors write `S.commitSlotCount` and refresh each other; there is no second copy. A pin above the line when the max shrinks is drawn as an over-the-line pip, because shrinking does not unpin — the engine simply stops servicing those slots — and nothing else on screen said so. The strip sits OUTSIDE `.lyr-bar`: that bar's two buttons are measured against each other by `npm run audit:align`, and the tracker has its own invariants there (one cell per slot, the cells on the title's x, the count on the buttons' right edge, cells and count on one centre line, eight to a row, no clash with the count).

**Every cell carries its pin's number, and the selected pin is ringed (Ek, 2026-09-14).** "maybe have it more informationally consistent with the actual loop number or cloud number and if it's the closest one highlight it as so in the tracker?" A pin is named by its SLOT — `loop 3` is the pin in slot 3, clouds and loops sharing one sequence because they share one pool — so the cell's POSITION was already the answer and only the counting was left to the eye. The digit is `_pinName`'s, not a second derivation, and `pins-audit` § J3 asserts a cell names what its row names rather than merely holding a number. The cells wrap at eight a row, declared as a `max-width` rather than left to fall out of the column, so sixteen slots always read as two rows of eight. The cell is sized from the widest thing it holds (`10` is 11px of ink, leaving 6.6px of slack) and the gap from the SELECTION RING, which reaches 2px past the cell and had 1.2px of clearance before the gap went to 0.25rem. Past eight slots the count centres on the BLOCK of cells, not on the first of them — an invariant written against the one-row case only, which the audit caught the moment the count went to sixteen.

**One readout, one size, one weight (Ek, 2026-09-14).** "the number sizes dont match the 4/8 number, just make it look more like the rest of the app design wise." The cells were `--fs-nano`/600 and the count `--fs-meta`/bold, and the typeable max — a form control, which inherits neither family nor weight — had quietly fallen to 400 beside both. They are one number said four ways, so only COLOUR may separate them: size is for hierarchy LEVELS and weight is for ROLES (`docs/DESIGN-SYSTEM.md` § 2), and neither applies inside a single readout. Everything is `--fs-meta` at 500, and the cells grew to meet the count rather than the count shrinking to meet them — "text can afford to be bigger" is the standing brief. The ramp that does the work is colour: an empty slot `--text-muted`, the filled count `--text-secondary`, the settable max `--text-light`, and a taken slot the app's own ground on its engine hue. `align-audit` asserts the one-size-one-weight-one-family rule, because it is the thing that drifts.

The same pass took the BORDERS out. An empty slot lost its chip entirely — the ground says "slot" and the hue says "taken", so a line around either is the second mark simplicity breaks the tie against — and the resting rail is now a row of quiet numbers rather than eight outlined boxes. The typeable max lost its box too: it now rests transparent and takes the tint on focus, exactly as `.grain-numbox` and the rail's own `.trow-rn` do. That box was not merely extra; sitting at the end of eight cells with a ground of its own, it read as a NINTH cell, which is the one thing this readout must not say. The over-the-line state dropped its dashed border for its hue as an unfilled ring — outlined-not-filled is already the instrument's way of saying a thing is not live, and a dash was a language nothing else here speaks.

The ring is the SELECTED pin, off the same `selectedPinSlot` the rail's half-moon and the sphere's bracket read: three marks, one answer. Under the default mode that is the pin nearest the cursor, which is what Ek asked for by name; under `oldest` / `farthest` it keeps saying what unpin will actually take rather than offering a second opinion about "closest", because a mark that means something different from the other two is worse than no mark. The way this breaks is not a disagreement about the rule but two SEARCHES a few milliseconds apart while the cursor moves, so the rail's tick does ONE search and hands it to both painters. A ring rather than a moon because a cell has no left edge to wear one on, and a hue mark would vanish against a hue fill; the inner ring is the rail's own ground, so the bright one reads as separate from the cell rather than as a thicker border.

- **A take is held ONCE — one SharedArrayBuffer both threads read** (2026-09-17). A take is
  `{ data, sampleRate, length, duration }` (`js/take.js`), `data` a Float32Array over shared memory; the
  bridge posts it by reference (no copy, no transfer list — transferring a SAB is an error), the primary
  starts on the take's own buffer, the provisional take is a view over the raw pool re-cut every tick, and
  erase and undo move nothing: the worklet drops or re-takes a reference. Before, a live take was an
  AudioBuffer here plus a Float32Array there, the engine-start take a third time, and the 40-minute run of
  2026-09-17 faulted at 939 MB on the 8 GB laptop with the material held twice. The TODO's transfer design
  (samples in the worklet, handed back on erase) was dropped: the main thread reads a LIVE take in nine
  places (the waveform, onsets, the loop region, the fold, the save, the sampler), and every one would have
  become a round trip. A source node cannot play shared memory, so tape copies the region it plays: a pinned loop's
  `buffer` IS its crossfaded region AudioBuffer (`buildLoopPayload`, unchanged), a trigger's `buffer` is the
  take and `grain.js` `_regionCopy` cuts the [loopStart, loopEnd) it plays into a cached AudioBuffer on the
  slot (the reverse copy used the same cache; a moved region re-cuts), the sampler's monitor copies its crop
  while the pedal is held. The `.mubone` writer takes either shape (`samplesOf` in `mubone-file.js`, the
  one place the two meet) and the loader hands a loop its region back as an AudioBuffer. Copy into an
  AudioBuffer with `getChannelData(0).set`, never `copyToChannel`, which rejects a shared view. The instrument is mono: `.mubone` members are written mono,
  a stereo member from an older file loads as its first channel. Remaining copies, by design: a pinned loop's
  crossfaded region, an overdub's folded layer, the raw pool (5 min, retained), and history's hold on every
  erased take — the next lever is compressing those.
## Colour — what a timbre looks like

**For anything touching `js/audio-features.js` or the viz legend:** the hue axis is a **ratio of
peaks, never a share of sums**, and it is read at **fftSize 2048**, never off the shared 256
analyser. Both halves were learned the hard way on 2026-09-13, when the sphere came out peach and
tan through a microphone after every bench test passed. At 256 the bins are 187 Hz wide, so the
first-formant range that separates `ee` from `ah` — 270 to 730 Hz — lives inside four bins: the
axis cannot see what it is being asked to measure. And a sum over bins is not robust to a floor.
Room tone, mic self-noise and the breath under any real voice put energy in EVERY bin, and with 124
bins above the 800 Hz split against four below, 97% of that floor lands high and offsets the hue
rather than blurring it — a vowel reading 0.206 in silence reads 0.358 with a floor under it.
Subtracting an estimated floor (the frame's median bin, by histogram) was tried and measured and
halved the error, which is not enough; comparing the two bands' loudest peaks removes it for free,
because a floor lifts every bin by about the same amount and so barely moves either maximum. Use
the mean of each band's TOP THREE bins, not the single loudest — same immunity, and a vibrato hands
its strength to the neighbouring bin instead of dropping out (wobble 0.029 against 0.036). Measured
after: a room floor moves the hue by at most 0.023, eleven sounds span 144° of hue, and the whole
snapshot costs 8.1 µs, taken per MARK and never per frame. **The bounds are constants, not
sliders** (Ek: "it should be very predictable so that i see yellow everytime and my collaborators
see yellow and they know what sound that is") — the viz panel shows a legend of measured landings,
and anything that would let a performer redefine a colour is the wrong answer to a colour problem.

**A mark with no sound in it has no timbre, and a colour table has to be finer than the eye.**
Two rules from reading a real take back (2026-09-13). **A tape take records continuously**, so most
of its marks are the gaps between what was played — measured on one of Ek's strokes, two clicks at
rms 0.69 against everything else at 0.002. An axis that answers for those marks is reading the
room, and it does not merely add noise: as a note decays into the floor the reading walks
systematically from the note's colour toward the room's, which drew a single tongue click as purple
through green to yellow. Anything below 34 dB of the loudest thing recently played HOLDS the last
reading; the reference is a decaying peak hold, never an absolute threshold (wrong at a different
input gain) and never a floor tracker (gets stuck). The rule it states is true of the instrument:
the colour is the last thing you actually played, until you play something else. **And the memo
table's resolution is a design parameter, not an optimisation.** 64 buckets across a 265° arc put 36
of 63 neighbours over a just-noticeable difference and one over six, because sRGB's blue corner
makes the gamut cusp fall 0.25 in lightness across 24° of hue and the ramp inherited the cliff.
Smooth the cusp curve and use enough buckets; a smoothed cusp cannot put a colour out of gamut,
since the chroma bisection is exact for whatever lightness it is handed. Check it by measuring the
OKLab step between ADJACENT buckets, not by looking at the ramp.

**Both colour axes must survive a room, and the test must prove it.** A microphone always
arrives with a broadband floor under it — room tone, mic self-noise, the breath under any voice —
and a synthesised bench tone never does, so a feature can pass every test here and be useless on
stage. That is exactly what happened through four rounds on 2026-09-13. The rule that comes out of
it: **never accept an audio feature that sums or averages over all bins.** A sum counts the empty
bins, a floor fills exactly those, and the result is offset rather than blurred — the old hue axis
(share of energy above 800 Hz) moved 0.187 with room tone under it, and spectral flatness, which is
a geometric mean, moved by 2.21 against a class gap of 0.71, which is no axis at all. Both fixes
are the same shape: **compare peaks, or count them.** Hue is the top three bins below the split
against the top three above; saturation is how many bins sit within 12 dB of the loudest. A floor
lifts every bin including the loudest, so neither moves. Second rule, from the same day: **never
fit a correction on a range narrower than the one it will be used over** — `noise` carried a
brightness trend `flat − 9.4 · centroid` whose slope came from sung material spanning centroid
0.038 to 0.050 and was applied to a hiss at 0.374, where it did not weaken the axis but INVERTED
it, drawing a hiss at full saturation for months. `scripts/colour-audit.js` is the standing guard:
it measures at three floor levels and gates on what the floor MOVED, not on the spread.

**The arc goes DOWN through green, and chroma rides the gamut edge** (2026-09-13, reversing the
2026-04 routing). Two rules, both learned from the same sphere. **Never set chroma to a flat
number.** `_oklchHex` clamps, so a chroma that fits at one hue bends the hue at another, and the
only safe flat value is about half of what sRGB holds — which makes hue 15° salmon instead of red
and hue 54° tan instead of yellow. Bisect for the most chroma that lightness and hue can hold and
take a share of it; 2048 buckets verified unclipped in both themes. **And lightness belongs to the
hue, not to the ramp.** sRGB's yellow lives at L 0.96 and its blue at L 0.45; one monotone ramp
through both makes one of them mud. Follow each hue's gamut CUSP, nudged a little toward the middle
so the deep end is not a hole on black. The old arc climbed 248° → 58° specifically to miss green
and yellow, because in HSL they glare — but that glare was HSL holding lightness constant in name
only, and the routing survived into OKLCh where the reason had stopped applying, costing the axis a
third of the wheel. Going down 290° → 25° is 265° wide and passes through violet, blue, cyan,
green, yellow, orange and red. **Last, spend the arc where the material is:** the axis is not
uniformly populated and cannot be, since below the split means voiced and above means fricative, so
everything sung lands in a third of the range. Four measured piecewise-linear knots hand the voiced
cluster 54% of the wheel. Monotone, so it reorders nothing; constant, so it is not a setting.

## Render path — protect the scheduler

**For anything adding per-frame work to `js/renderer.js`:** moved here verbatim from CLAUDE.md on
2026-09-14, unchanged. It was the one block in that file that was reasoning rather than rule, and
it existed nowhere else, so it moved rather than being cut; CLAUDE.md keeps one line pointing here.

The grain scheduler is timing-sensitive (10 ms interval, audio-rate onset precision). The render loop (30fps RAF) shares the main thread and can starve it. **Moving cloud trail rendering was the #1 source of scheduler drift** until the Mar 29 optimization pass (#108). Key invariants to preserve:

- **`projectInto()` + `updateProjectionCache()`** — zero-alloc projection for hot paths. Trail rendering must never use `project()` (allocates per call). The projection cache (focalLen, canvas half-dims) is set once per frame in `drawFrame()`.
- **Batched canvas fills** — all trail dots go into a single `beginPath()/fill()`. Never revert to per-dot `beginPath()/arc()/fill()` triplets — that was the main GPU stall.
- **`_TRAIL_BUDGET = 120`** — total trail projections per frame, shared across all moving seeds. Keep this low. The old value (200) caused measurable scheduler drift.
- **`_interpolateMovingSeed()` reuses `seed._currentFrame`** — no per-tick object allocation in the scheduler. Don't change this to return a new object.

New per-frame render work (trig, projection, canvas calls): profile against scheduler drift first.

## The canvas is part of the GUI — what it inks, and what it sets type in

**For anything drawing on `S.ctx` in `js/renderer.js`:** the canvas is not exempt from the design
system just because no stylesheet can reach it. **Colour comes from tokens** (2026-09-14). The
cursor carried nine hand-written colours while the tiles it is meant to match carried tokens, so it
had drifted in every direction at once — recording in a red that was not the mic-live ramp, erase
in a red borrowing `--accent-danger`'s "it will not come back", nearest in a violet in no ramp, and
three pin-slot fallbacks a few points off the engine hues they were copying. `_tok()` reads the
token and caches it, the way `FOCUS_INK` does, because this runs per frame and `getComputedStyle`
is a layout read on the thread the grain scheduler shares; nothing flushes it, because the canvas has
one theme (the `mubone-theme` event and `S.darkMode` went with the light canvas, 2026-09-18). The invariant is that the tile you
pressed and the mark under your hand are the same colour BY CONSTRUCTION rather than by two lists
agreeing, and `align-audit`'s R4 holds it — its allowance list is empty.

**The ring says whose hands, the dot says what material (Ek, 2026-09-14).** The last two cursor
literals were both a wrong OBJECT rather than a wrong hue, which is why neither could be settled by
picking a nicer colour. `CURSOR_IDLE_COLOR` was `#f5a69c`, and `#f5a69c` is `SAMPLE_PAINT_COLORS[0]`
— `state.js` said so outright — so the one mark whose whole job is to name the material you are
inking from showed the same dot for the live mic and for sample 1. It is the mic's colour now
(`--mic-live-border`), the same fact the top bar states, and recording falls into the same branch
because recording IS the mic; recording stays unmistakable by taking the 2.4x dot and the ring as
well. The hands-free mark was a green pip drawn over the centre dot **at the dot's own radius**, so
it hid the material, and it sat below `painting` in the ring's branch chain — and latched MEANS
painting, so the green ring only ever rendered while latched and not painting, absent exactly when
it had something to say. Hands-free is now the RING, in `--accent-sensor` ("the body is driving
it"), and it outranks everything. Every combination shows both facts at once: recording hands-free
is a violet ring around a mic-red 2.4x dot; painting hands-free is a violet ring around the
material's colour. One object each — the ring is whose hands, the dot is what material.

**Canvas labels are Urbanist (Ek, 2026-09-14).** All four named `"Roboto Mono", monospace`, which
is not loaded — `css/fonts/` holds Inter and Urbanist and nothing else — so they rendered in
whatever mono the machine had, the only foreign glyph on screen. Measured, `bold 11px "Roboto
Mono", monospace` came out at exactly the width of `bold 11px "NoSuchFaceXYZ", monospace`: naming
it did nothing at all. (`document.fonts.check()` is not a way to test this — it answers "can this
be rendered", fallback included, and returns true.) The obvious objection is tabular figures:
canvas 2D cannot set `font-variant-numeric`, and Urbanist's ten digits span 36.30px to 59.95px at
bold 11px, so a numeric column would shuffle. It does not apply here — **tabular figures exist to
stop a right-aligned or fixed-position column from shuffling, and all four labels are
`textAlign: 'center'` on strings of one to four characters.** Centring absorbs a proportional
width change (a centred single digit's edge moves at most 1.51px), and the one label that changes
digit count changes width anyway. So the tie-breaker is the house rule: one typeface on screen.
**If a right-aligned numeric column ever appears on canvas, that is when this reopens** — and this
paragraph belongs in § 2 of `docs/GUI-BUILD-SHEET.md` the day that file lands.

## The kit's sizes — a control's height is stated, not fallen out

**Every control-shaped element in the instrument computes to a kit height, and the tail that
recorded the exceptions is empty (Ek, 2026-09-15: "snap them all").** The kit is 18 · 24 · 32 · 38
— status pill, button and segmented, icon, `--lg` — and `align-audit`'s R6 keys the expectation on
WHICH kit element a thing is, not on a flat set, so a 32px `.mu-btn` still fails while a 32px
`.tc-icon` passes. Nine elements were off it and all nine were the same defect, not nine
judgements: a height nobody chose, left over from `padding` plus whatever line box the font
happened to produce. `.trow` was 27.9, `span.seg` 25, `.tbx-add` and `.trow-more` 22.4,
`#lyrSettings` a named 22 that named nothing but itself, `.ds-editbtn` 21.7, `.ds-close` 17.3,
`.ds-del` 15.7. All are 24 now, with `height` + `box-sizing: border-box` carrying the box and the
vertical padding removed where it had been doing the sizing — because a padding that is load-bearing
is the derivation coming back. `.tc-cam-row` (30.9) joined them the same day, found by the empty
tail on its first run: it is a dropdown menu row whose own comment calls it the rail's row model, so
it takes the row's 24.

**An empty tail is the strongest form of the check, which is why nothing may be added back to it.**
While it held entries, a new off-kit element could hide behind "the known tail, unchanged"; empty,
any off-kit element fails by name and the failure line already says which kit height it should take.
The one thing R6 cannot do is see an element that did not render on that run — coverage is
state-dependent, and both `.tc-cam-row` and `.lyr-hold-body` surfaced only when the app happened to
be in the state that draws them. So a green R6 means "nothing off-kit among what rendered", never
"nothing off-kit".

**A row sized by its own CONTENT is not this defect, and snapping it is a bug — so it says so:
`mu-h-content` (Ek, 2026-09-15).** `.lyr-hold-body` is 44.2px because it carries a two-line name,
`loop 3` over the pin's coordinates, and forcing it to 24 or 38 would clip the second line. The kit
governs controls whose height is a DECISION; a row whose height is its text belongs with `.set-row`,
which `docs/SETTINGS-GUI.md` already says "runs taller by design".

The marker is its own kind in R6 (`content`), deliberately not folded into `bare`: `mu-btn--bare` is
a SHAPE — a button with no box, no border, no background, no radius — and a two-line row is not a
bare button, so collapsing them would cost the failure line its ability to say which one a thing
claimed. What the two share is the mechanism, and the mechanism is the point: **both are keyed on a
class the author writes in the markup, so being content-sized is DECLARED, not whitelisted in the
audit.** An exemption that lives in the audit is a list nobody reads; an exemption that lives on the
element is a sentence the next person edits right next to the thing it describes. The check still
bites — verified both ways on the running app, 2026-09-15: the same row without the class resolves
to kind `any` at 44.2 and fails.

## The size law is one picture, and the picture is the control

**Four sliders across two sections became one figure (Ek, 2026-09-15: "for the
particles smallest largest quietest loudest i really have no idea what those
numbers mean").** Smallest, Largest, Quietest Input and Loudest Input are not
four settings — they are the two ENDS of one straight line, `size = min + (max −
min) · normalise(rms, rmsMin, rmsMax)`, which `renderer.js` runs for every mark
of every frame. A line with two ends is a picture, so it is drawn and you drag
the ends. The two loudness values were raw RMS, 0.005 and 0.31; the axis is dB
now (−60…0, the meters' own domain) because −46 and −10 are numbers a player can
act on and dB is the unit every other level on every other page already reads in.
The state stays linear, because `renderer.js` wants it linear; the conversion
lives at that one boundary.

**It is the LAW RUNNING, not an illustration of it.** The live needle reads
`readGateLoudness()`, which is the same metric a mark's own `rms` is
(`snapshotInputFeatures` → `consumeWindowLoudness` → `gateLoudness`), so it shows
where the mark you play right now would land. The dots are drawn at their real
pixel radii, and the tape ribbon's thickness is its real stroke width. The cost
is that if those formulas change this must change with them, which is the price
of a figure that cannot quietly drift from what you see on the sphere.

**THE PAINT GATE BELONGS ON IT** (Ek, 2026-09-15: "why would it not be better if
the gate control for the paint be with the figure you created, it's literally for
that. it's what gets painted"). I argued it should only be SHOWN here, on the
grounds that the gate decides whether material is captured rather than how it is
drawn, and that it already had a good control on Settings → Audio. Overruled, and
rightly: it is the same metric on the same axis, and it is the leftmost threshold
on it — under the gate a grain mark is never deposited at all, so the flat
minimum this figure drew down there was a lie for half the marks on the sphere.
It is draggable here and still settable there; one number, two doors, the way the
pin slot count already is. It writes through `S._setPaintGateThreshold`, never
`S.paintGateThreshold` directly — that setter clamps and calls `_syncGateVal()`,
which pushes the value into the modal slider, the hidden main-panel carrier and
the readouts. Writing the state raw sets the threshold correctly and leaves every
mirror stale; `cc-mirror-audit` holds this now, and the gate's mirror PAIR was
missing from that suite's list entirely until this round.

**The figure is the control, so the DEFAULTS are whatever it was left at** (Ek, 2026-09-15, twice in one day). The first pass set 2.8 px at −42 dB with the gate just under it at −44, to close a band where marks landed but could only ever draw at minimum size. The second dropped the quiet end to the floor the figure allows — 1.0 px at −54 dB, the gate at −53 — which closes the same band from the other side and widens the loudness window from 31 dB to 43, so quiet playing spends its whole range inside the ramp instead of arriving half-grown. The gate now sits one dB ABOVE the foot of the ramp rather than under it; the dB beneath belongs to tape, which is never gated. Both passes are the same ruling: Ek drags the handles, and what he leaves them at is what `state.js` ships. Note the defaults only reach a machine with no saved calibration — `mubone_viz_calibration` and `mubone_audio_defaults` override them at boot.

**The figure draws the tape line too, because the numbers are not grain-only.**
The same four values set three materials through three formulas: a grain dot's
RADIUS, a tape line's WIDTH (its own 1.35 exponent, so a line blooms much later
than a dot grows), and a stamp bar's height. Two facts the drawing settles that
four sliders hid: tape is NEVER gated — `paint-ticker.js`, Ek 2026-09-04, "a gap
in the path is a place it cannot be fired from" — and the thin line that keeps a
path continuous through a silence already exists, at 0.60px, but it sits at the
RAMP's left end and not at the gate, 8 dB higher up. Ek asked whether those two
were the same threshold; they are not, and the figure now shows them as two marks
so the question can be answered by looking.

## A legend is a section, not a row

**A cell that cannot be operated is never shaped like one** — `docs/SETTINGS-GUI.md` § 3 says it
about binding cells, and the viz page was the one place that broke it. "What The Colours Mean" and
the timbre ramp under it were two `.set-row`s with no `.set-ctl` between them and no interactive
descendant at all: a hairline and a right edge promising a control that was never coming. The fix
needed no new element and the kit stays closed at eleven. A heading with prose under it and no rows
beneath is exactly `.set-section` + `.set-sec-title` + `.set-sec-lede`, which is what the rest of
that page is already built from — so the legend became its own section, and moved OUT of "What Size
Means", where a block about colour had no business sitting. The general form: **if a settings block
has nothing to operate, it is not a row — it is a section, or it is a lede on one.**

## AUDITION is a mode, and the editor writes the slot — the bench is gone

**For anything touching `S.auditionMode`, `slotOf`, `setBench`/`benchShape`, or where a param
lives:** the tool editor keeps no tool of its own. `setBench` used to say in as many words that it
does NOT touch the hand, the palette or the spacebar — "that is the whole point of the rail being
an editor" — and that is the sentence 2026-09-22 reversed (Ek: "when i'm in the tool
creator/editor, i change the shape preset and voice preset and it should update what is being
held"). Picking a preset IS the change, so there is nothing left to drag and nowhere else for the
choice to sit. `slotOf(instr)` derives the subject: the hand's side for tape and grain, a palette
POSITION for erase, the act for the sampler. `_benchBy` — a tool per instrument, saved to disk —
was a THIRD place a tool could be, and keeping the three in step was the bench's whole cost. The
bench tile, `placeBench` and the drag went with it; `A` and the audition survive, re-pointed.

**LIVENESS IS A MODE, not a gesture.** Auditioned paint was declared by the PRESS — paint from the
bench followed the knobs, paint from the spacebar froze — which tied a property of the SESSION to
one key, and is why the bench had to exist to mean anything. `S.auditionMode` is one switch above
every tool now, and it lands in ONE predicate: `S._handTile().live`, which the grain voicing's
`live` flag, the stroke stamp in `recordStrokeStart`, a tape take's `_live`, and `syncLiveVoicing`
all read. Marks already painted keep what they are, and nothing DRAWS liveness — the ring both
halves wore was worth it only while the fact was invisible.

**Both halves of auditioned paint were built and neither could fire**, for one reason: liveness was
read from the HAND, which is null between presses. A tape take is armed from `whenSealed`, *after*
the play has ended, so `_live` was false for every auditioned take ever made; the fact is stamped
on the STROKE now (`recordStrokeStart`, the one place a stroke begins). `syncLiveVoicing` bailed
unless the bench was sounding, so a knob moved after an audition reached nothing. Under audition a
SOUNDING pass follows too: speed and level ride the running node, while reverse and pitch are baked
into a region copy and are re-cut at the LOOP SEAM (`_liveRecutReady`, which waits for the pitch
worker so the seam is never silent) — under `dwell: loop` there is no next fire to pick them up at.

**Two questions place a param** (the test Ek stated on 2026-09-22): a VOICE is what audition moves;
a SHAPE is the drawing and cannot move once made; anything that is neither — autopin, overdub, walk
on touch, erase by stroke, and the five arrival rows — is one standing answer per INSTRUMENT and
lives in its tab, as MODE or as CURSOR INTERACTION. Only `audition` is global. The arrival rows are
`S.triggerParams` and are captured into no tile.

## The row loads, the door opens — and a lens's sheet is the live eye

**For anything touching the rail's rows or `toggleSheet`:** a row click LOADS (writes the slot); the
door at its right edge OPENS the sheet. They were one act for a day, which threw a drawer over the
stage at every glance at a preset. An open sheet still follows a row click, because a drawer showing
the tool you just put down would be lying.

**A LENS is the exception, and it is not a compromise.** *(History since 2026-09-22 night: the
lens has no sheet and no list — its rows are its TAB. See "One lens".)* A lens's sheet IS the live eye — its rows
are the cursor's own controls and there is no stored view of one to read — so opening it INSTALLS
it. Without that the drawer named `spot` in its header and drew `wide`'s numbers underneath, and
editing them moved wide. `setBench` had refused to apply a lens since the day it was written and
said why in the code; nothing surfaced it while the only route to a lens's sheet was the row.

**The shape sheet is gone, and a voice row points the sheet (2026-09-22 night).** Ek: "when i open
up grains and press the voice presets it still shows the old shape sheet. i thought we sunsetted
that." `SHAPE_SHARED`'s rows — rate and width, slice · min slice · dub decay, depth and from — are
all on the instrument's tab or on Settings → Tools, so a tool's sheet was the tab's rows drawn a
second time under a stale title; a tool and the lens now draw a HEAD only, saying where the rows
went. The one sheet with rows is a VOICE's. So a tab points an open drawer at the voice its
instrument is on, and a voice row's click points it too (the door still opens it) — the same rule
a shape row had, "an open sheet follows the click". **And the tab's rows capture into their TOOL,
named by `capId`** on both `_wireOptions` and `_wireKnobs`: with the sheet a voice's, an unnamed
capture would land on the voice, whose block has no `rate`, and the tab's edit would be lost —
measured before the fix as `mubone_tiles` staying at 50 while S read 33.

**Two traps that cost real time here.** `propsOpen()` cannot see a shut drawer — `closeProps` drops
the `prail-open` class and leaves `_propsOn` set — so ask the CLASS. And `toggleSheet`'s "already
showing" test must be computed BEFORE anything installs, because `lensTap` writes `_propRow` itself.

## The rail's rhythm, and which rows may grow

**A CONTROL THE RAIL DRAWS MUST BE REPAINTED BY `render()` (Ek, 2026-09-22).** "The options for
dwell retrig etc still dont click — when I hover it shows it's ready to click but I can't actually
click to change it." **The click was landing the whole time.** Measured: one press moved
`S.triggerParams.dwell` from `oneshot` to `loop` AND moved the cabinet's own segment to `loop` —
and left the rail's pill lit on `oneshot`. A control whose state changes invisibly is worse than a
dead one: the instrument had changed and the rail was still saying it had not.

The cause is one word. `_wireOptions`' seg and switch handlers ended with `renderOptions()`, which
is `if (_propsOn) renderProps()` — it repaints the DRAWER. These rows live in the RAIL now, which
`render()` draws, and `render()` ends by calling `renderOptions()`, so calling the outer one keeps
the drawer following. The switches that always worked (autopin, walk on touch) had their own
handlers that already called `render()`, which is why the fault looked like it belonged to the
segments.

**The lesson for the next one of these: when a control "does not respond", check whether its STATE
moved before assuming the input did not arrive.** Three separate measurements — hit-target size,
what covers the point, and whether the panel re-renders under the press — were all spent on the
input path before one probe read the state and found it had been changing all along.

**A SEGMENT SAYS WORDS UNLESS ITS OPTIONS ARE SHAPES (Ek, 2026-09-22).** "That looks better, go
back to words for dwell and retrig." Grain's arrival rows were built from a label table and read
`once | loop`, `cut | layer`; tape's read the same options as glyphs, and side by side the words
won. A glyph earns its place when the thing it names IS a shape — a gesture, a direction, an
envelope — and `once` against `loop` is not: two short words, each of which had to be learned as a
drawing before it could be read. `words: true` is opt-IN per param rather than a cut to `_segIcon`,
because the icon table still serves `start`, whose three options genuinely are directions, and the
lens's own segs.

**A SEGMENT IN THE RAIL IS 24, AND ITS GROUP HAS NO PADDING (Ek, 2026-09-22).** "The pill toggles
for the cursor behaviours … don't press easily, it was also a problem before it moved." Measured:
each option was **28.6 × 19**, and worse, the group's 2px padding meant its `overflow: hidden`
clipped those buttons back to ~20 — so the hit area was smaller than the button, which is why the
press missed and why moving the rows changed nothing. The shared pill rule sizes a button from its
CONTENT, which lands on the kit's height for the chrome's text segments and five pixels under it
for these, which hold a 15.2px glyph. Now stated: **24 tall, and the container gives up its
padding.** That is the kit's PLAIN segmented — "24 tall, container AND buttons, no padding" —
rather than the pill, because a pill is buttons 24 inside a group of **28** and 28 does not fit:
`.tc-lrail .mrow` is 30 with `--sp-1` either side, a 24px content box, and the 30 pitch is the
ruling below. It keeps the pill's radius; only the geometry changes. **A hit target that a
container clips is the bug, not the button's height** — the two had to change together.

**For any spacing change in `#toolRail`:** every row is pitch **30**, and the kit decides how each
kind gets there. A `.mrow` is a DIV and is stated at 30 — the kit's 24 plus `--sp-1` either side.
A `.trow` is a BUTTON, and `align-audit` R6 holds every button in the instrument to 18 / 24 / 32 /
38 (its probe reads `button,[role=button],.seg,…`), so a preset row at 30 fails by name: they keep
24 and the LIST spaces them with `--sp-3`. **A row grown by padding alone is only as tall as what
sits in it** — a MODE row holds an 18 switch, so 18 + 3 + 3 came back to the 24 it started at while
a cursor row holding a 24 pill went to 30. That is why the height is stated, and it was found by
measuring, not by looking.

**What you PICK is above what you SET, and the fold takes the difference (Ek, 2026-09-22).** The
instrument card's order was MODE · CURSOR INTERACTION · SHAPE PRESETS · VOICE PRESETS, which is the
logic of building a tool and the opposite of playing one. Measured against the running app: the
list is **695** tall and the grain tab's content was **828**, so 133px sat below a fold the rail
drew nothing to mark — `match` cut in half, and VOICE PRESETS, both voices and its `+` not on
screen at all — while **269 of the card's 450px** came before the first thing you pick, 150px of it
CURSOR INTERACTION greyed out because grain does nothing with it until WALK ON TOUCH is on. The two
hidden lists are the two that GROW by `+`, so it got worse by being used. Something must fall below
the fold in a 695px column; the ORDER decides what. Now: the instrument's mode switches (no
heading — the tab named the instrument one row above), then SHAPE PRESETS, then VOICE PRESETS with
AUDITION at its head, then CURSOR INTERACTION. Grain went from 133px hidden to 68, and what is
hidden is the block you set once. **The GLOBAL MODES card went with it** — a heading over one
switch — and audition sits on the list it governs.

**A rail that scrolls says so, and the platform will not say it (2026-09-22).** `::-webkit-scrollbar`
at 6px with a hover-only thumb had been in the stylesheet for weeks and paints NOTHING here:
`offsetWidth - clientWidth` is 0, so macOS overlay scrollbars win, and `scrollbar-width: thin` with
`scrollbar-color` does not bring it back either (both measured through the dev bridge, both 0, both
invisible in a cropped shot of the rail's right edge at rest). `js/tiles.js` `railScrollMark()`
draws it instead — a 2px bar in `--text-faint` at the list's right edge, positioned from
`scrollTop`, hidden when nothing overflows, updated from `render()` and the list's own scroll and
never per frame. It is a MARK, not a control: the wheel already scrolls the list.

**The tabs are four tabs, and the open one says its name (Ek, 2026-09-22).** Four 72.8px glyphs on
the rail's ground said which of four was chosen and never which one that WAS, and the three closed
ones read as marks beside a tab rather than as tabs. Each now carries the tab shape with
`--surface-0` under it, one step below the card's `--surface-1`, so the row reads front-to-back;
the open one adds its name in `--fs-eyebrow` in its own hue. The hue rule that used to sit under
the chosen glyph is gone — the ground, the colour and now the word already said it — and removing
it is what let the glyph centre in its own 32px box, since the 8px under it was that rule's
clearance. **The section headings stay ASH**: the tab names the engine in the hue at full strength,
and hueing four headings under it made structure look like identity (tried, reverted same day).

**The two RAILS are one width** (`--rail-w`, 20rem): the tools rail and the PINS rail are the two
you work in, one on each edge. The drawer (`.tc-prail`) keeps its own 15.5rem — it is a sheet that
opens over the stage. Matching the drawer instead is how the tools rail came out 248 against the
pins rail's 320. `--lrail-w` was derived from the BENCH TILE until the bench went, leaving a rail
sized for an object it no longer held.

**SPRAY IS SUNSET (Ek, 2026-09-22, evening) — and the entry below is the record of the day it was
alive, not current behaviour.** "Removing spray, sunsetting it, it's too complicated to have dynamic
spray, no paint apps like procreate do it. I need to remember this is not an app to do visual
painting." What sank it is not that it worked badly. It was answering a question borrowed from the
wrong instrument: a painting app has no dynamic spray, and the reason is the point — scattering
paint is a LOOK, while here a mark's position is **where its grain sounds from**. Width is spatial,
so it is audible, and the question that has to come first is Ek's: **does spreading the material
wider affect musicality?** Until that is answered, mapping speed and rms onto the spread was tuning
a quality nobody had decided the value of. `dynamicHeadOffset`, `resetDynamicHead`, the six
`SPRAY_*` constants, `S.fx.spray` and the DEPOSIT row are deleted; `headOffset` with
`S.headWidthDeg` and `S.headEdge` is the whole head again, static, and the per-deposit
`readGateLoudness()` went with the voice term. `sort by` had already gone the same day. **The
one-shot that fills a missing pid into old blocks is kept and a reverse one added** — a block is
written back WHOLE, so a pid the sheet has dropped would outlive the param in every profile and
every `.mubone` that quotes one. Width and edge are next, and are not to be touched until the
musicality question is discussed.

**A head is a SHAPE PARAM, and its off is its own zero (Ek, 2026-09-22).** "We need to have a way
of thinking them as general shape params, not just designed for experimental." The #218 brushes
were CONTRACTS — `S.brushFx`, one exclusive field set by which tile you picked, so the only way to
spray was to hold the tile called spray. Now `spray` is an amount (0…100%) and `sort by` a selector
(`none · bright · loud · noisy`) on EVERY grain shape's sheet, in DEPOSIT beside rate and width.
Neither needs a switch: **a quantity that can be none does not need one**, which is why the answer
to "we'll need a way to turn each on or off" is the zero of the slider and the first option of the
selector. `SHAPE_OWN` is deleted with them — every grain shape shows the same sheet, the way every
tape shape already did.

Two things that had to be true and are, both measured: `dynamicHeadOffset` at `spray: 0` returns
the plain static head **exactly** (0.0 difference over 40 samples, moving and still) — it is on the
path of every grain mark now, so zero has to mean "as if this code were not here"; and a tile's
block carries both pids, so picking spray gives 0.25 and picking dots gives 0 with nothing bleeding
between them. A one-shot fills them into blocks minted before the pids existed — **a partial block
silently inherits**, which is the trap in "a grain tile owns its WHOLE block".

What went with the change: `keep` (it dropped material before it landed — a different job from
arranging what did), and `staff` entirely, because a head that takes latitude out of the hand's
control cannot sit quietly at its default behind every other shape.

**`spray` and `index` survive as PRESETS**, each `dots` with one of the two dialled — and each
states EVERY shape pid, not just the one that names it (Ek: "they should actually be set to the
right params"). A preset that states one value and adopts the other three is three quarters
whatever happened to be live when it was first armed. spray is 85% over a 6° head at 30 ms — a
preset named for one number belongs near the top of that number's range, and the wide brush is
already `width`; index is a LINE — no width, no spray — sorted NOISY, because the ordering is the
point, a scattered band has nothing to order along, and zcr splits a voice from a breath more
plainly than brightness splits two vowels, so the ordering is audible on the first sweep. **COMB became `index`** the same day: the id stays
`comb`, the way `pen` stayed when it became dots and `wash` stayed when it became trail, because a
label is what the player reads and an id is what a stored block, a palette slot and an OSC address
are keyed on. `comb` named the TOOL that did the sorting and there is no such tool now; `index`
names what the stroke BECOMES, and stays true whichever axis you sort by. `FACTORY_PARAMS` is only
the floor under a persisted block, so a stamped one-shot (`mubone_tiles_presets`) hands these two
their factory numbers once — stamped, because unstamped it would revert Ek's own tuning on every
launch, which is the difference between a migration and a fallback.

**The palette's lens position is THE CURSOR, not a lens (Ek, 2026-09-22).** "When I switch them in
the tool rail, it doesn't switch the cursor tile on the palette, it just seems to turn off the one
on the tile." It held one lens by id, so its `on` answered *is `wide` the installed lens* — install
`spot` and the strip showed a dim `wide` and nothing at all said which eye was on. PALETTE-GUI § F
already ruled what a lens tile is — **the lens is a state, the cap is no lens on** — and a tile
showing one value of a state is not showing the state. So the position draws whatever
`installedLens()` answers (glyph, name, `data-lens`, and the keys page's row with it), its TOGGLE
caps and uncaps, and its MOMENTARY is a PEEK: `_lensPeek` drops the eye while the key is down and
puts back what it found on release. `_lensMomentary` — hold a NAMED lens, restore the previous one
— is deleted, because on a position that always shows the installed lens it held a lens against
itself. The hand tile at the head of the row has always followed the hand this way; this is the
eye's half of the same idea. `data-pal` keeps the STORED id, which is what the position IS for drag
and removal. **Consequence, accepted:** two lens positions would draw the same tile — one is all a
following slot can mean, and placing a second is not worth refusing until it happens.

**The click is a SECOND SPACEBAR, not the hand's (Ek, 2026-09-22).** "Make spacebar and click one
pill flag not two … when I key bind spacebar, click should automatically follow in the same way …
click is not always on the hand, it follows what the spacebar does." Both inputs were RESERVED to
the hand — four fixed rows outside every map, `key:Space` and `mouse:0` on `hand_press` /
`hand_long` — and the hand drew them as two stickers, as if it held two bindings.

Three changes, and they only work together. **The hand's key is an ordinary row**: seeded onto
Space in `keyMappings`, learnable from its own pill (the sticker is the learn cell, § O) by action
id rather than by position, because the hand tiles are not positions (§ A). **Space is not
reserved** — `KeyA` still is, for the bench — so it can be learned onto anything, which takes it off
the hand. **The reservation lived in THREE places and the last one was the only one the player could
see**: `RESERVED_KEYS` (the load sweep), `BLOCKED_KEYS` (what a learn will not take), and an explicit
`if (e.key === ' ')` branch in the learn listener that answered "the spacebar is the hand's … cannot
be assigned". Clearing the first two changed nothing anyone could feel — a stored Space row could
survive, but none could ever be MADE (Ek: "i can't seem to map spacebar to any of the key
pills/flags"). When a rule is enforced in more than one layer, the one that TALKS to the player is
the one to grep for first. **The mouse is derived**: `_gestureBindings` yields `mouse:0` for whatever holds
`key:Space`, so the twin holds by construction with nothing to keep in sync.

**Why 3 and 4 cannot ship apart:** the learn path already enforces *one gesture, one action — the
same source+gesture on another row goes* — but it deletes from the three MAPS, and a reserved
binding is in none of them. Unreserving Space while the hand's rows were still reserved would have
left both bound and **fired twice**.

Two consequences, both measured. The pill shows `click` only while the hand's key IS the spacebar,
so rebinding the hand to `F` visibly drops the click from that tile — F fires the hand, space and
the click fire nothing. And a cleared hand row is written as a **tombstone** (`type: 'none'`) rather
than deleted, because the seed fills ABSENT rows on every load and a delete would hand the spacebar
back on the next launch.

**ONE CUTTER: slice, at the attacks (Ek, 2026-09-22).** "One is newer, the older method didn't
work … the newer one was meant to replace the older one so we should sunset that and its params."
Two cutters had been shipping side by side for a month. `_chopStroke` (2026-08-20) split a take
where the PAINT GATE had closed, so its threshold was the gate's — its own replacement's commit
says it "only worked around 100 ms", the unanticipatable-noise-floor problem. `_sliceStroke`
(2026-08-25, #219) segments the AUDIO: `detectOnsets` in the dB domain against a 500 ms local
median, floor-immune by construction, tuned against a 24-scenario matrix and guarded by
trigger-audit's `section slice` at 92/92. Slice was checked FIRST in the chain, so whenever a take
had both, the newer one silently won and the older one's `chop ms` dial did nothing. The gap
chopper, `triggerParams.chopOn`, `.chop` and the cabinet's gap row are deleted; what survives is
**`triggerParams.sliceOn`, a performance switch on the tape tab** rather than a tool you pick up.
The bindable action kept its id `trigger_chop` until 2026-09-24, when it became `tape_slice` at
`/tape/slice` with a migration in `_RENAMED_IDS`, so a learned binding still lands on the switch. **`S.brushFx` is deleted with it**: the #218 field that said which
experimental HEAD a tile carried emptied out over one day, its last value becoming a switch, and a
field with no values is not a field.

## The rail is what you reach for MID-PHRASE

**EACH HAND HAS ITS OWN VERB AGAIN, AND A STRIP CLICK OPENS A PAGE (Ek, 2026-09-22, night).**
"The big hands should also be able to be right clickable to change the verb" and "clicking the tile
in the palette rail now should open up left tool rail to its respective page."

The first REVERSES the 2026-09-21 ruling "the hand has no verb — the press is the verb", and the
reversal is not a change of mind: the premise expired the next day. That ruling was true of ONE
tool played two ways, where a tap latched it and a hold played it while held, so a stored verb
would have been a third answer to a question the gesture already answered. On 2026-09-22 the two
sides became two TOOLS, each with its own tile, voice and engine — and tape wanting to latch while
grain wants to be held is a property of the tool on the side, not of the gesture that reaches it.
One fixed answer per side became the wrong number of answers the moment the sides could differ.
**The recogniser still decides which SIDE a gesture reaches; the verb decides what that side then
does** — the division was always there, it just had nothing to vary. Seeded with exactly what was
hardcoded (press toggles, hold is momentary) and cycled by the same right-click and the same
`verbsOf` table a position uses. **No bang on the hand**: `verbsOf('tape')` allows it for the dub's
one-shot, but `_playDown` reads that off `palette[i].verb` and the hand's `i` is −1 with no entry,
so a bang would silently be a momentary — filtered out rather than half-wired.

The second is what a fixed strip makes possible. While the palette was composed, a click had to be
about WHICH tools you had; now that the six are the build's, it can be about the one you are
looking at — Procreate's rule, where the toolbar selects and the canvas plays. **Nothing left the
performance**: every tile is still played by its own key and the hand by the spacebar, and those
paths are untouched. A tool's page is its INSTRUMENT'S TAB, because one tool per instrument makes
the tab the tool's own page and it brings the performance rows, the shape sheet and the voices with
it. A lens has had no tab since that afternoon and its list sits above the tabs, so the lens tile
opens the installed lens's sheet directly. The pin pair keep FIRING on a click — they are acts, not
objects, with no page to open. And the click OPENS the rail as well as pointing it: a click that
switched a tab behind a closed rail looks like nothing happening, which is the failure mode the
dwell pills had already cost a day.

**THE PALETTE IS A FIXED TOOLBAR, AND THE TOOL IS THE INSTRUMENT (Ek, 2026-09-22, evening).**
"There's no more drag. It's like forscore or procreate or adobe edit. The tile is the tool, the
first tile is the tape tool, the 2nd tile is the grain tool … lens tile is there after, then erase,
then the pins as they are." The row is SIX TILES and only four of them are positions: the first two
are the HAND's sides, **tape** and **grain**, each naming its tool and the voice it wears and played
by the spacebar's press and hold. "The first tile is the tape tool" was describing those, which is
worth writing down because the first build read it as a request for two new positions and drew each
tool twice — once big with its voice, once as a bare `T` and `G` — caught on screen the same
evening. The four positions are **lens · erase · pin · unpin**, ids and order the build's. What is still the player's per position is the VERB (right-click)
and the BINDING; what varies is what a tile WEARS — the two tools their voice, the lens tile its
installed preset — not which tiles exist.

It ended because it had already ended. The strip was composed by dragging a row in from the rail,
and when tools collapsed to one per instrument the rail stopped listing tools — the TABS became
the list — so `tileHTML`'s `zone: 'box'` branch, the draggable rail row with the bench half moon,
went unreachable: one caller, passing `palette`. There were four tools for nine slots and no way to
put any of them anywhere. Deleting the drag is what made that visible instead of latent. Gone with
it: `placeTile`, `moveEntry`, `removeAt`, `removeFromPalette`, the whole `dragstart`/`dragover`/
`drop`/`dragend` block and its drop-index maths, `PALETTE_MAX`, `_entryFromStored`, and midi.js's
`S._paletteReordered`, which carried every binding along when a tile moved — a position that cannot
move needs no carrier.

**The id is the tool's instrument, and it is the ENGINE's id.** `line`, `dots` and `scrape top`
were SHAPE-PRESET names, each distinguishing itself from siblings now all deleted, while the tab
above already said tape / grain / erase. So `line` → `tape`, `pen` → `granular`, `scrape` →
`erase`, and `engineOf(id) === id` for all three: one string keys the tool, its engine, its hue,
its sheet and its tab, and `ENGINES[toolId]` can never be right for two tools and wrong for the
third. That is why grain's id is `granular` rather than `grain` — `granular` is the engine's id and
GRAIN is what a person reads, the convention already in force. `engineOf` loses its `id === 'line'`
special case; the drawer head loses a word, because `grain · grain shape` said the engine twice
once the tool stopped being a preset.

**Storage keeps only what is yours.** `mubone_palette` holds one verb per position; the ids are the
code's, and storing them would only be a way for a profile to disagree with the build. Both earlier
shapes migrate once — a stored `[{id,verb},…]` has each entry's verb carried to the slot its tool
now occupies, so a verb set on the eraser is still on the eraser after it moved from 2 to 4. The
key seed re-deals BY TILE on a stamp bump, which is what puts `c` on the lens's new position rather
than leaving it on position 1; the letter names the tool (`t` `g` `c` `e`), extending the rule that
already gave "`e` for erase beside `c` for cursor". `BUTTON_DEFAULTS` moves the pin pair from 3 · 4
to 5 · 6 and stops moving, because the strip cannot be rearranged again.

**And the hand is written back.** Its loader had always resolved a dead id through `_DROPPED_TILES`
and `migrateTileId` and never saved the answer, so a hand stored as `line` was re-migrated on every
boot — a persistent fallback wearing a migration's clothes, invisible until the rename made `line`
dead.

**THE RULING (Ek, 2026-09-22):** "Anything I need access to while performing should be there. I'm
realizing a lot of stuff should actually just be a setting in the settings module." That is the
test every row in the tool rail now has to pass, and it is the reason the rail can be read at a
glance: it holds the controls you move while a phrase is going, and nothing else.

**PERFORMANCE SETTINGS, per instrument**, one block under the tabs with no heading — the tab has
already named the instrument:

| | |
|---|---|
| **tape** | autopin as loop · overdub · slice · dwell · retrig |
| **grain** | autopin as cloud · walk · ↳ dwell · ↳ retrig · rate · width |
| **erase** | by stroke · depth · from |

Measured after: every tab fits with **0 px** below the fold.

**Each row names what it MAKES, and the rows that belong to one hang off it** (Ek, 2026-09-22,
later). `autopin` alone said a stroke pins itself and left the reader to remember what it becomes,
which is the whole difference between the engines — so it reads `autopin as loop` and `autopin as
cloud`, from `_AUTOPIN[e].on`, the word the tooltip already ended on. `walk on touch` lost its
`on touch`: every switch in the block acts when you play and none of the others says so. `slice`
moved up between `overdub` and `dwell`, because the three switches are tape's standing answers —
how a stroke ends, what it joins, whether it is cut — and the two pills are what happens when you
TOUCH what those made; appended last, it sorted the block by shape instead of by question.

**Subordination is an INDENT, not a glyph.** `dwell` and `retrig` belong to `walk`, and the kit
already had the answer: the settings rail's `.set-nav-item--sub` (2026-09-14) indents a row to
where its parent's LABEL begins and drops it one step quieter, with no mark of its own — "the icon
belongs to the subject, and there is one subject". Ported rather than copied: out in the tool rail
the parent's label starts at the row's own left edge, so there is no icon column to clear and the
indent is one step of the scale (`--sp-5`). An arrow bullet would have been a second vocabulary for
a relationship the kit already draws. **Greying is a different statement and both are drawn**:
`.ds-na` says "nothing to act on" and goes when walk comes on; the indent says "belongs to walk"
and never goes, because it stays true. That needed saying in CSS — the disabled rule is
`.tc-lrail .ds-na *` at three classes and the sub rule is at three with one more, so without an
explicit override the sub label stayed tertiary inside a greyed row. Measured: sub labels at x=37
against x=25, `#938d83` with walk on and `#776f66` greyed with it off, against `#aba59d` for every
unindented row.

**SHAPE PRESETS ARE SUNSET, and the concept with them.** Each instrument has ONE shape, so the
list was one meaningful entry plus variations better said as values — and each variation went to
the kind of control it always was: `spray` is an AMOUNT (0 is no spray), `slice` is a SWITCH, and
the three erasers were "a preset of depth + direction", which is two rows. `line`, `pen` (dots)
and `scrape` are what is left. `slice`, `spray`, `comb`/`index`, `scrape bottom` and `scrape all`
are deleted, and `_DROPPED_TILES` resolves each to the tool that absorbed it so a stored palette
slot keeps its position and its learned key. **The hand reads that map too** — without it a hand
holding `slice` fell through to null and BOTH sides collapsed onto the first tool in the order;
measured, both came up holding `scrape top`.

**`sort by` is deleted** with the `index` tile that was its preset ("let's sunset the sort by and
remove the index preset"), and the comb engine with it — `combLayout`, `combDeposit`, `resetComb`,
`S.combAxis`. A stroke keeps the order you played it in. `_centHz` is kept with no caller: it is
the one place the app converts a normalised centroid to hertz, and the unit bug it documents is
the worked example the docs point at.

**SETTINGS → TOOLS is the other half of the ruling** (`setPanelTools`, under `sound` beside Pins):
what a tool does that you decide BETWEEN phrases. Tape's start, release and rearm, min slice, and
dub decay. Built to SETTINGS-GUI § 2 — title and description left, control flush right, one
hairline per row — and measured: five rows, every control group ending at the same right edge.
Its controls are **borrowed from the rig cabinet**, on the same terms as the camera picker: the
real control comes over, keeps its id, its listener and its live state, and goes home on close
(verified both ways). Mirroring them would be a second source of truth for values the gate reads
every tick. **`min slice` and `dub decay` are the exception and are OWNED here** — they never had a
cabinet control, they were drawn straight from state by the tape shape sheet, and when that sheet
went they had no door at all.

**CURSOR INTERACTION IS PER INSTRUMENT (Ek, 2026-09-22).** "Make sure there's a separate cursor
interaction setting for grain and loop." They were ONE set, and that was defensible while only tape
read them — a trigger is a tape take's gate, which is what the 2026-09-22 morning entry above found.
Then `walk on touch` gave grain a gate of its own: a walker retraces a stroke and answers the same
questions on arrival, through the SAME object, so how a tape take started also set how a grain
walker did.

`S.triggerParams` stays TAPE's — every stored file, OSC address and audit names it — and
**`S.grainTrigger` is grain's**, holding only the arrival set. `hysteresis` is NOT in it: that is the
GATE's geometry, and it is one cursor with one reach.

The whole split is **`t.walk`**, in two places: `_onEnter` picks its set from it (which covers the
rearm window as well as start and retrig), and `_onExit` hands `exitWalker` grain's. Everything in
`grain.js` that reads `triggerParams.dwell` stays — those test for `'grain'`, the TAPE dwell option
that opens a stroke for granulation, and a walker has no such option because a walker IS the stroke
playing.

Grain's five have **their own pids** (`gdwell` · `gstart` · `grelease` · `gretrig`, kind `gseg`,
plus the page's own rearm slider), because the pid system is global and tape's proxy the cabinet's
segments. Grain never had cabinet twins — until walk on touch it had no gate — so they carry their
options in `PARAM_DEFS` and write `S.grainTrigger` directly. Proven by the one test that matters:
moving grain's dwell to `loop` leaves tape's on `oneshot`, and moving grain's start to `ends` leaves
tape's on `touch`.

## The cap is not a mute

**For anything touching `S.scanMuted`, `setScanMuted` or the trigger gate's edges (Ek, 2026-09-23):**
"when the cursor is muted, things that are still in flight, like loops, long grains, anything should
still finish out. it's not a mute." Capped, the cursor READS nothing — the scheduler posts no new
candidates and the gate takes no ENTER edge — and that is the whole of it. A grain already sounding
plays out, a take already fired plays to its release when the cursor leaves it (the EXIT edge acts
capped too, or a looping take would loop until uncapped), a walker finishes its pass. Until then the
cap also zeroed the cursor bus, cutting every grain in flight in 20 ms, and called
`silenceTriggers` on the way down — the 2026-09-07 "the cap is the one mute" ruling, which this
supersedes. The `c` tile does what `S` does, and opens the lens tab when the rail is up, as a tool's
play opens its own.

## One lens, and its tab is the whole cursor sheet

**For anything touching the lens tile, the lens tab, `PERF_PIDS.lens` or `S.scanMuted`:** there
is ONE lens (Ek, 2026-09-22 night: "it doesn't make sense anymore to have cursor presets and just
all the params available as performance settings, as a tab in the tool rail"). `wide` and `spot`
differed by one capsule — `mode`: area · nearest — so they were one lens with a setting
pre-answered, which is the argument that sunset the shape presets the same evening; a custom lens
was a saved sheet, which is what the rail no longer does for anything. So the lens is a TAB beside
tape, grain, sampler and erase, and every row of `ENGINES.lens` is on it — reads, radius, mode,
depth, k, fill, order, fade, falloff — with the sheet's greying (nearest bypasses radius, depth,
fill and the fade pair; `fill: all` has no k) and the sheet's two live numbers beside radius and k.
Nothing of it goes to Settings: the eye is what you steer with. The lens has NO SHEET — a drawer
repeating its rows would be one number in two places — and a drawer pointed at it SHUTS (2026-09-23;
for a day it drew a head saying where the rows went, which was still a drawer over the stage). The
same for a tool: the only sheet is a voice's. **The tab FOLLOWS the eye** (Ek, the same night:
"the lens tab needs to be the source of truth or at least reflect / match what the cursor is doing"):
every row writes through the cabinet's own control, and `_syncLensTab` re-reads the cabinet and S on
the layout's 5 Hz tick — the wheel over the sphere, `N`, `K`, a pot, an OSC value all land on it
within a tick — and redraws the panel once when mode or fill moves the greying. A numbox being typed
into is left alone. The one thing left to PLAY is on / off: the lens
tile on the strip, `c` by factory, toggle (the cap) or momentary (a peek); `lensTap()` takes no id.
The tab was tried once on 2026-09-22 morning and could not work, because the tabs then BUILT a tool
you placed and there is no unheld moment for the eye; the editor writes the SLOT now, and the lens
has exactly one slot, its strip position, like the eraser. The rulings below on cursor presets and
on a lens's sheet installing it are history from that day; they describe a list that no longer
exists. A profile's `wide` · `spot` deletions and custom lenses are swept once in `initTiles`.

**The cursor is not a tab since 2026-09-23 (Ek):** it is the tool rail's lower half — `#cursorSec`, a
CURSOR bar in the header design with a rule above and below, on the rail's foot at the height of its
rows, always shown — and the three instrument tabs above take the rest and scroll. The palette's
cursor tile and `c` no longer switch tabs; a click on the tile only opens the rail. Its rows capture
into the lens tile (`LENS_ID`) whatever tab is open. **The 2026-09-23 round (Ek), which amends the above.** The player's word is **cursor**, not lens
(the id, `S.lens*` and the hue keep `lens`), and `reads` is **scope**, its `grains` · `tape` wearing
the engines' glyphs. The tab reads TOP DOWN AS A FILTER: scope, radius — the one reach tape shares —
then a `GRAIN SELECTION` heading over mode (`area` reads `radius`), depth, all, k, step, fade; scope
`tape` greys the block. One counter, `in reach → taken` on k. **Falloff is set once, so it went to
Settings → Tools** (the cabinet slider, borrowed; it stays in `ENGINES.lens` for capture), and so
did the pins' crossfade, to Settings → Pins. **Fade is grain's only**: tried on tape, a distance fade
silenced every take as the cursor let go, overriding its RELEASE, which is what says how a take ends.
**`dwell: grain` beats scope** — an opened take granulates under any scope and depth, and only once it
has played through, in nearest too. **Its pin is the LOOP**: the press adds a cloud only for GRAIN material in
the cursor's pool (`_cursorGranulating` skips trig marks), and no cloud — seed or walker — ever reads
an opened take; `_openStrokes` opens it to the cursor alone. **Depth counts STROKES**, cursor and eraser alike (`depthKey`; it
counted buffers, so every sampler stroke — one file — stayed at depth 1). **Step walks marks in the
order they were made** (stroke, then `takeT`), not their offset in the buffer. `scripts/lens-audit.js`
holds all of it.

## A cursor preset carries the WHOLE cursor sheet — including its reach (HISTORY, 2026-09-22 morning)

**Superseded the same night — see "One lens, and its tab is the whole cursor sheet" above.** Kept
for the two bugs it found, which are still traps. The original:

**For anything touching `GLOBAL_PIDS`, `applyTileParams`, or which rows a lens preset owns:**
every row on the cursor sheet belongs to the preset whose sheet it is. There are no exceptions,
which is why the exception mechanism itself is gone rather than emptied. From 2026-08-27 a set
named `GLOBAL_PIDS` held exactly one pid — `radius` — on the ruling that reach is the cursor's
and not any one lens's, so it was neither captured into a preset nor applied from one. Ek
overturned it on 2026-09-22: *"if wide is 31, and i create a new preset narrow that's 5 degree
radius, it should switch the radius when i switch the preset."* A preset that does not carry its
own reach is a preset of four of the cursor's nine rows, which is not a preset of the cursor.
`fill` was global too, by omission rather than by rule: it is DRAWN inside k's row, so it had
been left out of `ENGINES.lens` — but that list is what a preset captures and applies, not what
the sheet draws, so a pid drawn by a neighbour still belongs on it and `cell` returns `''` for it.

Two bugs were hiding under the ruling, and neither was visible by reading. **A typed number never
reached the instrument**: `_paramTypeSet` writes the value into the CABINET numbox and dispatched
only `keydown` Enter, while every cabinet numbox commits on `change` (radiusVal) or on `blur`
(kBigNum) — their Enter handler just calls `.blur()`, which does nothing on an element that was
never focused, and the cabinet is in a `display:none` panel so it never is. It now dispatches all
three. **And the radius applied by a preset was undone by the preset's own later rows**: the
radius slider's `input` handler is throttled 50 ms, and `mode`, `fill`, `korder` and `rfade` are
applied after `radius` and each call `updatePlaybackControls` → `drawRadiusViz`, which re-syncs
the slider FROM `S.searchRadiusDeg` — still the old degrees, because the throttle has not fired.
So the new reach was written, overwritten three times, and then the throttle re-applied the old
one. `_applyParam` commits `radius` through its numbox instead, which is synchronous (applyRadius
writes S, slider and numbox in one step), the same shape as the `depth` case beside it. **The
general trap: a pid whose apply depends on a throttled read-back of its own element cannot be
applied in a loop with pids that re-sync that element.** A trap on the slider's `value` setter
caught the sequence in four lines of stack; no amount of reading the two modules would have.

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

## Audio quality — which knob is which

**The render quantum is not a setting, and the buffer dropdown is not the same buffer** (measured 2026-09-14, Chrome 146). A probe worklet reports exactly 128 frames per `process()` call; `renderQuantumSize` is not exposed in the worklet scope, and an `AudioContext({ renderSizeHint: 'hardware' })` is accepted without error and changes nothing (baseLatency stays 5.33 ms — two quanta). So Web Audio's block is 128 and no UI can move it. `#asBufferSize` is the RtAudio output block in the audio host, a different number that happens to share the word: 128 frames = 2.7 ms at 48 kHz, it needs an app restart (CoreAudio crashes on repeated close/open), and it is a DROPOUT remedy, not a quality control — a bigger block changes nothing about the sound.

**The gain structure, and where the ceiling goes** (Ek, 2026-09-14: "we also have the grain volume, so there are a few levers before we even hit the software ceiling … i want it more unified, there should be no special case for web version"). In order: the interface's own trim, which alone decides the converter's headroom and the noise floor under it; each hardware channel's own TRIM and its SEND, on its row in the Hardware in block (2026-09-14 — several channels sent at once sum to the one mono input the engine takes, which the graph could always do: `splitter[i] → routingGain[i] → S.inputGainNode` is a mono sum bus, and the old 'stereo' setting was two channels enabled at once); `S.inputGainNode`, now the SUM's level rather than a per-channel memory, on the Instrument in row and mirrored by the footer's `in`; the brush's `volume` per voicing and the grain COUNT, which together set how loud a wash is and are the two levers a performer actually plays; dry vol; master, which is `masterGain` in the browser and the per-speaker bus gains in Electron. **The ceiling is last and is not a lever** — it is `js/worklets/ceiling.worklet.js`, the same node at the end of both chains, bit-exact below −3.1 dBFS and bending to −0.09 dBFS above, linked across channels so it cannot pull a VBAP pair's image sideways, and zero-latency because a lookahead brickwall would cost the thing the whole engine is built around. It has to be in software: the clip it prevents happens inside the converter, and no outboard limiter is upstream of that. **The ceiling goes AFTER master, and its link is GROUPED** (Ek, 2026-09-14: "help me rule on the ceiling after or before master … it needs to be good for every case i want the ceiling to be more automatic and just doing the job"). After, because that is the only position that actually does the job: master is the per-speaker bus gain, and a ceiling upstream of it would be defeated by a fader that goes to +18 dB. It also makes the obvious fix work — the ceiling acts, you pull master down, it stops acting. Before master the crunch would follow the fader down unchanged, which is the behaviour nobody expects. The cost is that how hard you hit the ceiling is a property of the master setting rather than of the material alone; at the −6 dB default the grains have to sum past 1.4 before the knee is reached at all, so in practice the fader is the control that decides how close you run, which is the right shape. **Nothing about it scales with speaker count**: the threshold is each channel against its own full scale, and VBAP splits a grain across two speakers whatever the total is, so six speakers carry fewer grains each than two. What DOES depend on the rig is which channels belong together — the house and the headphone pair are different destinations sharing one interface, so they are separate link groups (`groups` in the processor options, built from `headphoneRouting`). Linked across everything, a hot monitor mix would duck the room. Proven with a 4-channel render, groups [0,0,1,1]: channel 0 at 1.6 comes out at 0.989, its partner ducks with it, and the other group's two channels come back bit-exact.

**It is a meter, not a lamp** (Ek, 2026-09-14: "i don't see anything in the gui re ceiling"): the node posts its deepest gain reduction every ~50 ms and the levels row draws it as a CEIL column beside OUT, hanging from the top the way every compressor's GR meter does, empty in the normal state — which is the state it should be in all night. The dB figure is also on the audio page beside the queue depths. A safety net nobody can see is a crutch, and when this one moves the answer is one of the levers above it, not the ceiling.

**The order of the levers, for quality** (Ek, 2026-09-14: "first lever is max grains … no need to change from 48k"). The live path is float32 end to end — worklet → MessagePort → audio host → `RTAUDIO_FLOAT32` — so nothing in playback is quantised and bit depth is not a lever at all. What is, in order: (1) MAX GRAINS, because a wash stealing voices sounds worse than anything else on this list; (2) the grain engine's INTERPOLATION, which is 2-point linear in `_readSample` / `_readLiveChunked` and therefore the dominant distortion the moment pitch shift, pitch jitter or tape speed leaves 1.0 (TODO #355); (3) sample rate, which mostly buys a better linear interpolation for twice the cost per grain — Chrome grants 44.1 and 96 k on request here, and both stay selectable with the consequences written into the row (Ek kept the dropdown, 2026-09-14); (4) the buffer, which is not about quality at all. `S.audioCushionMs` (10 ms) is the separate robustness/latency dial for the two IPC hops.

## The document — a piece, and the file it lives in

**A piece is the music; the rig is an export** (Ek, 2026-09-14: "right now we have export and import, not sure why, since that's for changing platforms. we won't change platforms, we are always in mubone … what we want is a save and save as, open, all that good stuff, with a proper file extension"). Two file types, two verbs, and the split is not a technicality: a piece is samples, takes, marks, pins, triggers and the sound they were played on, it has a PATH, and it saves; the rig — devices, calibration, bindings, the tool strip, the layout — is per-machine localStorage and it EXPORTS, because carrying it somewhere else is the only reason to write it down. Ek chose the split knowing the cost: opening a piece from months ago brings back its material but not the tiles it was played with, so the tools you would play NEXT are whatever is on the strip today. What you already played is safe either way — a stroke freezes its voicing and the piece carries the table.

**`.mubone` is a zip, and nothing about that shows** (`js/mubone-file.js`, 2026-09-14): `manifest.json` deflated, plus one STORED float32 WAV member per distinct audio buffer, each named by a hash of its samples. No dependency — deflate is Chromium's own `CompressionStream`, CRC32 and the zip records are a hundred lines, and the module works in the browser demo through a Blob exactly as it does in Electron through the file IPC. The extension is not `.zip`, so no file manager expands it; renaming a COPY to `.zip` is the debugging escape hatch, and a member drags into a DAW. Three measured faults in the JSON it replaces drove every part of this: the audio was 16-bit, undithered and hard-clamped at ±1.0 (a sine peaking at 1.5 came back at 1.0, and a float32 member round-trips it intact); base64 added 33% over the PCM it wrapped; and two slots sharing one AudioBuffer encoded it twice (§ E7), which content addressing collapses — verified on the real path, a take and the loop pinned from it write one member and come back sharing one buffer, which the worklet's identity-keyed `_bufferMap` also wants. The trade Ek took knowingly: float32 is twice 16-bit per distinct buffer, so a piece with nothing shared is bigger. A project file should be lossless. Container overhead measured at 0.36%. **What content addressing does NOT collapse is a pinned loop**: `createSeqFromStroke` copies a region AND crossfades its tail, so the loop is derived material, not a slice — storing it as a recipe against its take is the open follow-up (#354), and it is the same shape as the overdub rule, where a file cannot carry a layer that disagrees with its master.

**Nothing migrates** (Ek, 2026-09-14). A piece is v1 and reads v1; every legacy read path the old session format carried went with it — the v1–v5 particle indices, the v≤4 embedded settings, the v<8 voicing fallback, the v7–v9 layer set, `_preGroupOn`/`_preLayerOn`, the pre-v9 `activeSampleIndex`, `migrateBlockKeys` on a stored block, the pre-2026-09-13 colour repair — along with the pins-audit § G tests that asserted them. This is the no-compat-hedging rule applied to a file format: a reader kept for files that no longer exist is a persistent fallback, and it is the thing that made the old format's import path the most delicate code in the app. `docs/EXPORT-IMPORT-AUDIT-2026-08.md` keeps the history as a record.

**Dirty is the manifest, hashed, and nothing runs on a timer** (Ek, 2026-09-14: "this a performance app i dont want it to try to save every 2 min or something. it needs to be peak performance … maybe if the app closes, then a warning to save or not can come up"). No autosave, no crash recovery file, one quit guard. The signature being the manifest itself is what stops it going stale as the document grows — a field that is saved is a field that is signed — and it is why the container work had to come first: with the audio outside the manifest, the manifest is small enough to hash. Two measurements shaped it. A freshly booted mubone compared dirty against its own baseline, because the app goes on settling after the document takes it, so an UNTITLED session with no material is never dirty whatever the signature says (a piece WITH a path is compared honestly — opening one and erasing it is worth being asked about). And the signature costs 1.6 ms at a thousand marks, 11.6 at ten thousand, 101 at thirty thousand on a loaded instance — fine at the quit, where the answer must be exact and the pause costs nothing, and far too expensive to watch the document with. **So there are two signatures** (Ek, 2026-09-14: "once i open or change the doc, if it's already saved as, can there be an indication … to show that new things aren't saved?" — the first build refreshed the mark only at a save, an open and a window blur, and an indication you only see after clicking away is not an indication). `quickSignature()` writes the mark array as its length and version — the pair `renderer.js` already trusts as its own cache key — and costs 0.05 ms at thirty thousand marks, so the chrome polls it twice a second for 0.01% of a core, and everything that is not a mark is still exact: a knob moved with nothing painted shows. What it can miss is a mark edited in place by code that bumps neither, which is why the quit guard asks the exact one. **It is deliberately not event-driven**: the document has no single mutation point — every knob writes its own field — so a mark driven by the seams anyone remembered to call would go on saying "saved" after the one they forgot. Audio is identified by object identity for this, never content-hashed; its frame count rides in the id so a take that grew in place still reads as changed. **The mark is the only dot in the line**: a separator dot before the name was the first try and failed at exactly what it was for — two faint dots either side of a word read as decoration, and neither one could be the one that meant something. The gap separates now, and the dot left over is brighter and bigger than the name it follows, because it is the signal and the name is only what the signal is about.

**A piece opens the way it was played, and nothing lets go of it in silence** (2026-09-15, the debugging round after the format shipped). Five faults, one shape: the file was right and the restore was not. A pinned LOOP came back `playing: false` — "the performer starts it" — and no control in the app can set it true (only the pin gesture and undo do; composer mode rides `composerMuted`, and the loop's own stroke stays CLAIMED so the cursor cannot fire its trigger either), so every tape line in an opened piece was visible, silent and untouchable while the clouds, which restore playing, sounded. A loop is MUTED, never stopped — the composer ruling above — so it comes back playing and `composerMuted` carries the arrangement's silence. The take's `edges` and `markSpan` were not saved, so "the loop follows the button" was quietly undone on every open and each take was re-cut to its paint ticks (measured: a 0.04–1.96 s region came back 0.10–1.90, and a re-pinned loop is then a different LENGTH than the one saved). `_gapAfter` was not saved, so an erased hole came back drawn closed and the trigger gate would fire from inside it. The dirty signature included `playheadIndex`, which the audio clock moves every tick, so any piece holding a running loop read unsaved one tick after it was saved and the quit guard offered to save a piece nobody had touched — the hash now drops what moves on its own, while the file still carries it. And `refreshAfterOpen` ran the patch fourth inside one `try` that began with a UI rebuild, so a throw anywhere in the screens left the piece playing on the PREVIOUS piece's grain block behind a `console.warn`; sound is applied first now, each half guarded on its own. **The cap is not saved and must not survive either**: opening a piece into a muted scan reads as a broken file, so the open lifts it through `setScanMuted`.

**The quit is not the only door** (2026-09-15). ⌘N, ⌘O, Open Recent and a double-clicked file each discarded an unsaved session without a word — the exact loss the quit guard exists to prevent, reachable by four other keys, in an app with no autosave. The ask lives in `js/piece.js` at the top of `newPiece` / `openPiece` / `openPieceAt` rather than in the File menu, because the menu is not the only caller: the keyboard, the recent list and the Finder all arrive at those three functions. It is the quit guard's own three-button box (`doc-confirm-discard` → `askAboutUnsaved`, one wording for both), and Save writes first — cancelled or failed there, the open is cancelled too. `S._askDiscard` is the audit's seam, since a native modal cannot be answered by a script. **Every document command goes through one wrapper** (`S._pieceAction`, `ui-export.js`): on macOS a menu accelerator takes ⌘S before the page sees it, so the path Ek actually uses had no progress panel on a long write, no failure panel (a disk error died in a main-process catch — quit, Save, and the window just stayed open saying nothing) and no re-entrancy guard. Underneath, two saves of one piece shared one `<dest>.part`: the second truncated the first mid-stream and both renamed the wreck over the document, so `docWriteBegin` refuses a second writer per destination and the temp name carries the write id.

**The main process owns the menu and the guard, and asks the renderer everything** (`electron-main.js`, 2026-09-14). The File menu is the only menu mubone defines — New, Open, Open Recent, Save, Save As — with the rest left as Electron's roles so ⌘Q, services and the window list keep working; a double-clicked `.mubone` arrives on `open-file` and goes through the same door, held until the window exists on a cold start. None of it owns state: main cannot reach the module graph, so the document answers on `window.__mubonePiece` with three questions (state, save, run). The quit guard asks at the moment of the close rather than reading a flag pushed earlier, so the answer can never be one edit stale, and a Save that raises its own dialog and is cancelled cancels the quit too. The file IPC underneath is deliberately narrow — two native dialogs, a ranged read, a streamed write — and a write lands through a `<path>.part` renamed on close, because a piece can be hundreds of MB and a crash halfway through must leave the previous document intact rather than a truncated one.

## A tool is a shape and a voice — the 2026-09-21 round

**The pair, and why the words took three tries.** A tool answers two questions and a tile name used
to fuse them: **what it sounds like** (VOICE) and **how it exists in the space** (SHAPE — where it
lands, how it spreads, and what it does when the cursor arrives). Ek's own account of playing is
where the split came from: one half is *"how it is drawn in the space and how it is seen by the
cursor"*, the other *"sound processing"*. The names went head/voice → sound/space → shape/voice,
and the middle one earned its day: *"it's sound in space. so space is all questions about how it
exists in the space"* is what proved there is no THIRD category — the lens's five arrival rows are
spatial, because arriving at a mark is a spatial event. `head` was wrong because a head only
deposits and says nothing about being READ. **One word, two jobs, still open:** the palette draws a
tile's VERB as its shape (`VERB_RADIUS`), so if shape is the half, the verb's rendering wants its
own word — the OUTLINE.

**A shape's sheet is its own, not its engine's.** Every tool of an engine used to draw all 29 of
its rows, so `dots` showed comb's sort axis and staff's latitudes — rows that could never do
anything for it. A sheet is now `SHAPE_SHARED[engine]` + `SHAPE_OWN[id]` + the arrival rows, and a
VOICE has its own sheet behind its own `⋯`, holding `VOICE_PIDS` and nothing else. **Every tape
shape shows the SAME sheet** (Ek): a take can be cut at its onsets whatever else it does, so
slicing was never one shape's private property, and `decay` riding along is what made overdubbing
a sheet setting rather than a shape with an empty one (`DUB_PIDS` is gone). An edit on a voice
sheet captures into the VOICE — that is what makes it a living preset and not a snapshot.

**Pinned is frozen, unpinned is live, and the jump is the gesture.** `wet` stops being a decision:
paint is wet until you fix it, and PINNING is fixing it. An unpinned stroke references its voice,
so a value moved on that voice's sheet moves every unpinned stroke made with it; the pin copies the
values into the slot and that take keeps them for good. Unpinning hands the material back to the
live voice, and it JUMPS if the voice has moved since — Ek: *"the unpinning jump is good and can be
intentional"*, which is what gives the scanning half a sound gesture without a fourth control. A
pin therefore stores both the copy it took and the id of the voice it came from. **Structure
freezes at the pin; sound may stay live.**

**MODE asks twice, before you play, for everything.** `autopin` (does a stroke pin itself when you
let go) and `cycle` (`own` or `master` — whose clock a loop runs on) are pre-play settings, not
per-tool flags: Ek reads them as *"is the record/paint mode, pinned or unpinned after i paint"*.
`autopin` writes the two end flags that already do the work through `_AUTOPIN` rather than becoming
a third truth; `cycle` cost one line, because the dub's whole press path hangs off
`S._handIsOverdub`. So **no tool carries a pin icon**, `looper` and `dub` have nothing of their own
left to say, and § 9.4's three-way (`no · loop · join`) dissolved — `join` was never the same kind
of fact as the other two.

**The press is the verb, and the latch must be real.** The hand has TWO tiles — a tap latches, a
hold plays while held — and both are live at once, so `handVerb` is gone; a stored verb would be a
third answer to a question the press already answers. A press STARTS as a momentary so the stroke
begins on the down with no waiting, and the release decides: under `HAND_TAP_MS` (which is
deliberately `COMMIT_DRAW_THRESHOLD_MS` — one number for "tap or hold" in the whole instrument) it
is promoted. **The promotion must happen in the FUNNEL** (`gestureLatch`), not in `_held.latched`
alone: `_held.latched` mirrors `S._gestureLatched()` everywhere, and a latch in the tile layer only
left `gesturePress` answering the next press with *"a second wire while down — nothing"*, which
shipped as a stroke nothing could stop. The same change armed `GESTURE_LONG_MS` for both press
kinds, because a long press is a press that is still DOWN and holding is now the momentary one.

**The hand is TWO tools, and the spacebar goes through the one recogniser** (Ek, 2026-09-22: "when
i drag the tile in tool creator to the hand tile it fills in both of them, should just fill in the
one" → "we already have the entire mechanism for different press types for everything except space
bar, it should go thru the same determiner"). The two hand tiles were one tool drawn twice, which is
why a drop on either filled both. Each holds its own now: `inHand` is `{ press, long }`, migrated
one-shot off the single id so a player's hand is unchanged until they drop onto one of the two.

I ARGUED IT COULD NOT BE DONE, and was wrong in a way worth recording. `handUp` decided tap-vs-hold
RETROSPECTIVELY, by comparing the release against `HAND_TAP_MS`, so at the down edge the app did not
yet know which tile you meant — and waiting to find out would cost 200 ms on every press, against
the whole latency ruling. What I missed is that the recogniser already solves exactly this, and Ek
designed it for exactly this case on 2026-09-10: a `press` binding fires on the DOWN with no
latency, and when a `long` follows, `_abortPress` takes back everything the press wrote to history
and throws away the take it started — *"it'll cancel the loop that just started as if it was never
meant to be, then do cloud."* I reasoned from the spacebar's own code instead of the shared one; the
spacebar was the app's only second determiner, and CLAUDE.md already said there is one recogniser.

So the spacebar and the sphere's button are RESERVED BINDINGS — `hand_press` (trigger) and
`hand_long` (hold) on `key:Space` and `mouse:0`. They are not in `keyMappings` (`RESERVED_KEYS`
strips them on every load, so they can never be learned onto anything else) but `_gestureBindings`
yields them, which is all `_bindingsOnSource` needs: events.js sees a bound source and hands both
edges to `dispatchGesture`. No new plumbing, and the hand gets OSC for free — `/hand/press` and
`/hand/long`, because every other action in that table has an address and the table's contract is
the point.

Two things the wiring turned up. `_ACTIVATES`, which decides whether an abort may throw a take away,
matched `palette_[1-9]` only — so the hand's press was never aborted; it takes `hand_press` too. And
`handDown` refused to start while a play was running, which it has to do for the one-at-a-time rule
— but the long fires WHILE the press's play is still up, so it saw a busy hand, ended that play and
returned, and the hold only ever stopped things. `S._handLong` lets go of the press's play first.

**The eye is not a tool, so it has no bench and it does not live in the tabs** (Ek, 2026-09-22: "the
lens actually is above the whole tool section and shouldnt have a bench. it should be in the left
rail but always visible above the tabs"). The lens was a fifth tab for a day and the tab could not
work, for a reason that is about the instrument rather than the UI: **tape, grain, erase and the
sampler are assembled and then placed; the lens is always being worn.** There is no unheld moment
for the eye — one is on unless you turn it off — so there is nothing to build toward, and choosing
one IS using it.

The symptom was exact and is what forced the question. Benching `spot` while `wide` was installed
gave a sheet TITLED SPOT whose `mode` cell read `area` — wide's value, and the live one — because
`renderProps` draws the live controls; anything changed there edited the eye you were actually
looking through and was then captured into spot. The same bug `setBench` had for tools, which was
fixed by applying the tile's block on selection. That fix cannot be applied here: for a tool nothing
is in the hand between presses, so loading its block costs nothing until you press; for the eye
there is no such moment.

So: the lens section sits ABOVE the tabs, always visible, outside the editor. A click INSTALLS, and
`lensTap` applies that lens's own block — which makes the sheet correct BY CONSTRUCTION rather than
by a second mechanism. The moon means INSTALLED again, its meaning before the editor round, which is
also what `.on` has always meant for a row that is a choice; clicking the lit one turns the eye off,
which is the cap. No bench tile and no `A`: there is nothing to audition when you are already
looking through it, and PEEKING through another lens mid-play is the palette's momentary verb
(`_lensMomentary` puts the old eye back on release) — a live gesture, not an editor one. The lens
keeps no MODE either, and correctly: `reads` is captured into each lens's block, so every lens
remembers what it is allowed to see, which makes it per-preset rather than instrument-wide.

**The panel card, and the accident that produced it** (Ek, 2026-09-22: "give the lens special design
treatment like the new background you made for the shapes/voice" → "i asked for this simple design,
but for the lenses"). The three rail panels — lenses, presets, sampler — sit on a ground one step up
from the rail (`--surface-1`) with the hand's radius, and nothing else: flat, no gradient and no
shadow (build sheet § 8.7), one token for the ground and one for the radius (§ 8.8). The rows still
BLEED out of the card to the rail's edge, so the moons sit on the rail and the single glyph column
holds — a card here is a GROUND BEHIND a group, not a box around it. Measured after: 0.00 spread on
row x and glyph centre across every row in the rail.

I had first given the lens a hued band of its own — `--eng-lens` at 7% with a matching hairline, and
the one heading in the app taking a hue — which was the wrong answer to the right question and Ek
said so plainly. **Worth recording is where the card came from**: it was a BUG I had written two
commits earlier. `html body .tc-lrail .tilebar, .srcbar, .lensbar { height: auto; }` lost its
declaration block when I deleted the third selector as dead, the two survivors ran on into
`html body .palette` below, and the presets panel came up wearing the HAND's plate — gradient,
shadow, 9px backdrop blur. Ek saw it, liked it, and asked for it on the lenses. The rule is closed
again (the `height: auto` it carried is the fix for a permanent scrollbar over empty space, so
losing it was a real regression), and the card is stated deliberately and flatly instead. A
CSS rule that loses its body does not fail — it silently merges into the next one.

**A shape whose whole identity is a MODE switch is not a shape** (2026-09-22). `loop` and `dub` are
deleted. `loop` was `FACTORY_PARAMS.looper = { onEnd: 'loop' }` and nothing else, and `onEnd` is what
AUTOPIN writes; `dub` was `handTileId() === 'overdub'` forcing `S._handIsOverdub`, which is what the
OVERDUB switch says. Two doors onto one flag, and the worse kind — picking the shape moved the switch
behind your back. What they did is not lost, it is asked once. `passes`, the looper's self-killing N,
is a tape sheet row and belongs to any tape shape; the dub's BANG — one cycle of the master, then it
lets go — moved onto TAPE's allowed verbs, where it means that whenever overdub is on. `line` and
`slice` are what is left and both are real: slice AUTO-SLICES at onsets (`brushFx`, trigger.js
`_sliceStroke`), behaviour no parameter can stand in for. The test this leaves behind: **if deleting
the tile and setting the MODE switch gives you the same instrument, it was never a shape.**

**The three erasers keep what is theirs; `erases` goes up** (2026-09-22). `depth` and `efrom` ARE each
eraser's identity — newest layer, oldest layer, everything in reach — which is what makes them three
PRESETS of one engine rather than three modes, and that was already right. `escope` was not: one
boolean shared by all three, drawn as a `touch | stroke` capsule, breaking two rulings at once (a
true boolean is the SWITCH, 2026-09-07; one answer per instrument is MODE, 2026-09-22). It is
`whole stroke`, erase's first and only MODE switch, and the presets are untouched.

**Depth is four answers on a capsule** (Ek, 2026-09-24: "it should be a multi select pill with just
1 2 3 then all"). It was a 1–16 slider with `all` past the top, read out in words ("last 3 strokes")
because a bare number said nothing; the sixteen positions were never played — the erasers ship 1 and
all, the cursor 3 — and a slider promises a continuum where there are four musical choices. So the
cabinet control is a seg (`recencySeg`, `data-depth` 1 · 2 · 3 · 0), `depth` is a `seg` param on
the cursor section and the erase sheet (one control, two engines, as before), a tile stores the
data value ('0' is all, what `FACTORY_PARAMS` always wrote), `S.setRecency` clamps anything deeper
to 3 and a stored deeper value lands on 3 once. The `/search/recency` address and the `recency_cc`
pot keep their names; the pot's throw is quartered.

**k is one slider, and zero is all** (Ek, 2026-09-24: "i don't know why all is its on toggle, it should
be one slider, and if it's 0 it's all"). What k IS, read off the scheduler: every 10 ms the marks in
reach (inside the radius, or the nearest anywhere) are cut to the k closest — the candidate pool —
and the worklet fires ONE grain per period, picking one mark from that pool. So k is how many marks
the cursor spreads its grains over, not how many sound at once (that is duration over period, capped
by MAX GRAINS in Settings › Audio). k = 1 is the same mark over and over, all is the wash. The `fill`
switch lifted the cap because 0 had no position on a 1–1024 scale; now position 0 IS all, the
default (99 was only ever "all in practice"), in both modes — under nearest, all is the whole
sphere. The ceiling drops to 100 (`K_MAX`): with all a position of its own the slider needs no
headroom above what you might paint, and past ~100 the spread is indistinguishable from all at any
playable period; the log scale keeps 1–10 fine. Gone with the switch: `grainKAllMode`, the `fill`
row, `k_all` (`/search/fill`), the frames' and seeds' `kAllMode` (a cloud's k is in its frozen
block). Nothing stored has to move: k and fill were the lens's, and the lens's block is session-only
(a fresh boot reads the default). The `/search/k` address and the `grain_k` pot reach 0 the same way.

**GLOBAL MODES: every instrument's standing answers in one list, above the tool creator** (Ek,
2026-09-22: "maybe the modes should be taken out completely and put under lenses as GLOBAL MODES …
then the tabbed section is strictly a tool creator"). The modes had been behind the instrument tabs,
which conflated two questions that are not the same: WHAT AM I MAKING, and HOW DOES THIS INSTRUMENT
BEHAVE. A mode is not part of building a tool — it is a standing decision — and behind a tab you
could not flip tape's autopin without leaving the grain tab. All five now sit in one card beside the
lenses: `autopin (loop)` · `autopin (cloud)` · `overdub` · `grain walker` · `whole stroke`. Erase's
came with the rest, because leaving one mode behind would undo the point of the tabbed panel being
strictly a creator.

TWO THINGS THE FLAT LIST FORCED, and both are better than what they replaced. A ROW CARRIES ITS
INSTRUMENT'S HUE — tape pink, grain gold, erase orchid — because one list holds four instruments'
answers and colour is what says whose each row is; the switch was neutral when the tab above it
supplied the context. And the WORD disambiguates only where it must: `autopin` is the only label
that appears twice, so it is the only one qualified, by the value the switch actually writes. The
caption went `MODE` → `TAPE MODES` → `GLOBAL MODES` in an afternoon, and the last is the only one
that is true of the list as it now stands. `TOOL CREATOR` became a full-width rail heading over the
tabs, so the tabs read as part of the creator rather than as the rail's top-level navigation.

**The rail says whose each thing is: the instrument above the line, the tool below it** (Ek,
2026-09-22: "since the mode is global for that tool, it should be design UX wise to show that"). The
rail is **TOOLS**. Under that title: the five-tab pill, then MODE — both the INSTRUMENT's, and MODE
sits with the pill because that is whose answers it holds. Then a hairline and the heading **TOOL
CREATOR**, and everything under it belongs to the one thing you are making: the bench, the shape
presets, the voice presets. MODE had been inside the panel with the presets, which put an
instrument-wide switch in the same box as a per-preset row and made the two look like one kind of
thing. A tab with no mode (erase, the lens, the sampler) collapses its box to nothing and the line
rises — an empty heading is worse than no heading, which is the same rule MODE has always followed.

**The left rail is the TOOL EDITOR, and selecting is not playing.** A click on a rail row lands on
the BENCH — it does not reach the hand, the palette or the spacebar — and the sheet follows, so the
editor shows what it is editing. The bench draws what you are building as the tile it will become,
and `A` auditions it, always momentary, reserved the way the spacebar is (`RESERVED_KEYS` in
midi.js). A position on the palette carries its VOICE, so two grain positions can be two different
sounds, and `place` refuses without one — half a pair is not a tool. An eraser is not a special
case: it has no voice to give, so nothing is missing.

**Everything in the editor is editable, the LENS included, and the moon follows the bench**
(2026-09-22). Two rows were left over from the rail's selector days. The lens row still *installed*
on a click — it was how you changed your eye — and Ek's rule finished the job: *"i want everything
in the tool editor to be editor mode right it's only when i drop it in the palette it becomes
performable."* It benches now, the palette already knew how to hold a lens position, and holding `A`
does the visual equivalent of an audition: it looks THROUGH the lens while you hold and puts the old
eye back on release, through `_lensMomentary`, the same restore path the palette's momentary verb
uses. The trap: a factory lens is not in `TILE_DEFS` — its own table, its own glyphs — so
`tileById('spot')` is null and the bench, which resolved a tile, drew nothing; `benchSubject()`
returns `{ id, label, glyph }` for either kind and `handTileInner` takes that, so the bench and the
strip's hand still come out of ONE builder. The second leftover was the MARK. The half moon said
"installed" on a lens row and nothing at all on a shape row, while `.open` — the drawer's mark, in a
rail that has no drawer doors — quietly followed the last click; clicking a preset moved the bench
and the moon stayed put (Ek: *"the half moon doesn't change and when i click it doesn't highlight
correctly"*). Now every editor row is a radio and ONE moon marks each group — shape, lens, voice —
the shape group's on the BENCH, and a tool being a pair means the shape's moon and the voice's moon
together are what you are building. `.open` is gone from the rail entirely: selecting IS opening, so
it could only say "chosen" a second time, more quietly, sometimes on a different row. What is LOST
and worth knowing: the rail no longer shows which lens is actually installed — that is performance
state, it lives on the palette tile, and the row's tooltip still says so. The rail's gutter then
had to be cleared of its last competitor: the IN-HAND LINE, a 2px rule down a row's left edge since
2026-09-12, sat 2px from the moon and answered a different question (Ek, seeing it beside the new
mark: "scrape still uses the old line instead of half moon"). It is deleted from the rail and from
the strip; the hand tile names its shape and its voice in words, which is where a performance fact
belongs. And the moon is FLUSH with the rail now rather than with the row — `.lyr-list` had been
insetting it 12px, which was never a regression, just never right for a mark whose whole job is to
be read at the edge without looking.

**The sampler tab is the sampler's, and the mic is not a preset** (2026-09-22). The tab opened onto
the old source panel: one `in N` row per live channel, then the sampler. Ek: *"in the sampler tool
editor it's no longer source … at the min remove the in 1 mic since that's already a setting in the
header the mic."* The `in N` rows are gone — they were a second door onto a setting the chrome owns,
filed under a tab about a FILE — and with them the per-channel glyph and the rebuild-on-channel-count
path they existed for. WHICH MAKES THE SAMPLER A BOOLEAN: it was a radio when it was one of N
sources and it is one switch now, wearing the half SQUARE, on for a file and off for the mic, and
clicking it again is the way back that the `in N` rows used to be.

**And then the sampler became a TILE** (Ek, same day: "make the sampler a legit bench tile as
well") — the last thing in the rails you could not put under a key. It is an ACT, not a tool: it has
no shape and no voice, it changes what the tools READ, the way a lens changes what the cursor sees.
Two verbs, `toggle` and `momentary`, no bang — swapping the source is a STATE, and a bang that turned
it on with no way back is the trap the `in N` rows used to cover. HOLD IT AND THIS STROKE COMES OFF
THE FILE; toggle it and the next few do. Its state is DERIVED from `S.sourceKind` the way the mix
mute is derived from the pins, so the tile agrees however it was changed — the row, an OSC address,
a pad. It took the source hue into the palette with it, since the act tiles' shared hue is the pins'
and the sampler is not in that group. The panel row then had to obey the rail's one rule, so it
BENCHES and no longer performs, and the two doors onto the file are the palette tile and `A` on the
bench. THE ROW WEARS ONE MARK, the bench's: whether the file is under the brush right now is
performance state, read off the lit palette tile and off the sheet's head, which spends its one line
on "under the brush" / "the mic is live". A second mark in that gutter is the in-hand line, deleted
the same morning for the same reason. The sampler's glyph moved into `G` on the way — it had been
copied in `SRC_G` and `INSTR_G`, "kept identical on purpose", which is two copies and a promise.

**MODE stays autopin and overdub; the arrival family is CURSOR BEHAVIOUR and belongs on the sheet**
(2026-09-22). Ek, on the sections the round had produced: *"since the modes autopin and overdub are
part of the tool editor they are technically tool-specific. but now at least they're not buried into
a preset … arguably we could probably also put some other things in mode."* What else might belong
was worth measuring, and the measurement found something real: the five arrival rows — dwell · start
· release · retrig · rearm — were drawn on ELEVEN shape sheets and there was only ever ONE of them.
Setting `dwell` to loop on `line` read loop on `slice`, and on grain's `pen`. They went up into MODE
for a day on the strength of that, and came back down the same day (*"those things you moved out
actually they should be cursor behaviour inside the shape presets move them back in"*): BEING SHARED
IS NOT THE SAME AS BEING A MODE. The sheet already groups them under their own `cursor behaviour`
heading, which is where they read as what they are — how the cursor treats what it arrives at, not a
question you answer once about the instrument. MODE is the two switches, and the fourth pile
(`MODE_PIDS`) that carried them is gone with them; so is the rail's borrowed `.opt` capsule, which
was a second home for a control that already had one.

AND THEY ARE GRAIN'S TOO, which I got wrong for a day. I had claimed the family was tape's, on a
grep of grain.js that found only `seq.trigger` readers, and took the rows off the grain sheets on
that basis. The reader is the GATE: `trigger.js` `_onEnter` spends `tp.rearmMs` and then hands the
same `tp` to `startWalker` for a grain stroke. Under the lens's `mode: stroke` a touch on a grain
stroke launches a WALKER (`js/walker.js`) and these five rows are its whole behaviour — `start`
decides where the walk begins and which way it runs, `dwell` whether it loops and whether it opens
the stroke, `release` how it leaves, `retrig` cut against layer. walker.js's header says so in its
first paragraph, and `SEC_NOTE['cursor behaviour']` says it on the sheet itself: *"what a touch does
— tape now; grains under mode: stroke"*. Ek remembered the feature when the rows went missing. The
lesson is cheap to state and was expensive here: a grep of one module is not a reader census, and
the codebase had already written the answer down in the place I was editing. The rows are on every
sheet but the eraser's, and the section's NOTE now renders on all of them rather than only the
lens's — it is the line that says when a grain stroke answers to them. `reads` went back to the lens
sheet the same way.

**A PARAM LIVES WITH THE TOOL IT WORKS ON, and a MODE is that instrument's one answer for all of
them** (Ek, 2026-09-22, stating it out loud after the walk had moved twice: "the ruling is that, as
much as possible params should exist for the tool they work on. also those modes are global for
those tools only"). Two rules, and between them they place anything. WHICH TOOL does this act on?
That is the sheet it belongs to — which is what took the arrival family off the lens and onto tape
and grain, and the walk off the lens and onto grain. IS THERE ONE ANSWER PER INSTRUMENT, or one per
preset? One per instrument is MODE, a switch above the presets; one per preset is a row on the
shape's own sheet. The walk took an hour to land because it passes the first test and the second:
grain's, and asked once. `autopin`, `overdub` and `walk` are the three that have earned a switch.

**The walk is the GRAIN's, not the eye's — and it is MODE** (2026-09-22). Ek, dialling it in: *"whether the
cursor when it touches a grain walks the stroke or if it just plays what's in cursor. by default
it's cursor … i think it should be a grain shape param."* It had been the lens's `mode: stroke`, the
third cell of a capsule whose other two are the APERTURE — how a reader chooses among what is in its
reach. That put one answer on the eye for a question about the brush you are holding, and it meant
`wide` and `spot` could not be what they are (area and nearest) while a walk was on. Now `mode` is
`area · nearest` and nothing else, and `S.grainWalk` decides whether a touch hands the stroke to a
walker. It spent an hour as a per-SHAPE capsule (`on touch`, `cursor · walk`, in the grain sheet's
`cursor behaviour` section) and is a MODE SWITCH now, `walk`, beside autopin: every grain preset was
carrying an answer to a question the instrument asks once. A true boolean on this rail is the
SWITCH, so it wears one rather than the capsule it had on the sheet, and the short-lived `gwalk` key
is stripped from any block minted in that window — one shot, no fallback. Off by default, which is
the cursor, which is what it always was.

THE ONE COMBINATION TO KNOW: a walker is AREA-ONLY by a rule in grain.js ("never `nearest`, that
would read the whole sphere from a moving point"), so a walk under the `spot` lens reads as area
while it walks. Nothing is refused and nothing is silently wrong — `nearest` has no meaning for a
point moving along a path — and it is said where it is decided rather than left to be discovered.

AND IT FOUND A REAL BUG, which is why the first two attempts at "per shape" did not hold. `setBench`
set the sheet's tile without APPLYING its block, so `renderProps` drew the live controls while
`_pollLiveBlock` captured them back into the newly selected tile: `wash` held `cursor` in storage the
whole time and the sheet was reading `pen`'s live value. `pickForSheet` states the rule in a comment
— "a pick that did not apply would show the last tile's numbers and write them into this one" — and
the bench had skipped it since the day it existed. It applies now, for TOOLS only: applying a lens's
block would change what the cursor reads this instant, and selecting is not performing in this rail,
so a benched lens's sheet still edits the live eye. That is the one place the editor is not yet
honest, and it is named in the code rather than left to be found.

## Plans that shipped — the rulings they left behind

The plans below are in `docs/archive/` (2026-09-05). Each shipped; what a session still needs from each is here. `BRUSH-MODEL.md` and `OVERDUB-PLAN.md` are covered by the palette, main-button and overdub entries above, and `TIMING-REFERENCE.md` by the constants block at the top of `js/state.js`.

**There is no trigger ceiling (Ek, 2026-09-23: "there should be no limit").** Every stroke arms. There was a ceiling — `MAX_TRIGGERS` 32, and full meant REFUSED — put on when the gate was new as insurance for the scheduler's tick, and it bit: with slice on a take is several triggers, eight strokes filled it, and every take after that painted deaf (marks with the trigger flag and no gate) with nothing on screen saying so; the arm call's errors were swallowed too, and are warned now. Found in Ek's open window by reading the strokes: 33 with trigger marks and no trigger. It rolled (steal the oldest) for an hour, then went: measured, the insurance was never needed — the bounding-cap reject makes the gate's cost grow with how many strokes are NEAR the cursor, not how many exist (64 × 200 marks 0.015 ms a tick; trigger-audit keeps the 256 number under 2 ms as the standing proof).

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

### From the settings dialog

Cut from the settings rows on 2026-09-14 when descriptions went to one sentence under 92
characters (align-audit R5). The rows keep the sentence that says what the control does; this is
everything else they were carrying. **Checked before appending: only 7 of the 40 distinctive
clauses across all nineteen cuts appeared anywhere in docs/ beforehand, so this is not a
duplicate of what follows — for most of these rows the settings dialog was the only place the
information existed.**

**Follow.** A switch (2026-09-22 night; it was `blend: all | focus`, a which-one over a yes/no — Ek: "i want it to be boolean when possible"). On, the faders follow the cursor: the nearest pin is loudest and the rest hand over by distance, the mix summing to one. Off, every pin plays at full. `S.commitPlayback` still holds `all | focus` underneath; `pins_follow` / `/pins/follow` is the wire.

**Tether — deleted (2026-09-22 night).** It only meant anything under follow, and there it gated a pin by the LENS radius. Ek: "if cursor-mixer is on there's really no radius so tether becomes confusing … act as if tether is on." A pin is never gated by the radius now; the radius is the scratch layer's (the 2026-08-30 ruling, finished).

**Curve.** The crossfader curve between two pins — the DJ mixer's word (Ek, 2026-09-17: "width" read as a size; it is whether the handover is gradual or sharp). 100% blends the whole way from one anchor to the next; 0% cuts at the midpoint. On an anchor, that pin is alone. Focus only; outside focus the row is greyed.

**Selected Pin.** The pin unpin takes, marked in the rail: the one nearest the cursor, the one farthest from it, or the one pinned first.

**Tap Window.** The gap after a release in which the next press counts as the ×2 or ×3, and how long a tap waits beside them.
