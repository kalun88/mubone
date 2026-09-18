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
  the engine hue, and folds the pin's own `fadeIn` / `fadeOut` open; **a mute rides those ramps** the
  same as an unpin, so a pin set to leave over ten seconds leaves that way by either verb
  (`composer.js`), and the playhead runs on through it — the DJ mute made visible. **Sort IS
  `S.selectionMode`**: nearest / farthest / oldest, rows laid out by the key `selectedPinSlot` uses, so
  row one is always what unpin takes and the half moon never disagrees with the order; under nearest in
  focus the rail is a proximity meter. The mode bar (blend · tether · sort · curve) is the door to the
  four settings switched mid-set, each writing the S field it always had; the rail polls S on its tick,
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
  touch section (`on tape` then, `on strokes` since the walker), `--eng-tape`, and the brush material — with a one-shot `mubone_slots` key migration and
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
  tape hides `k` and `order`, reading grains hides the whole `on strokes` family — unless the
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
- **The stroke WALKER is the lens's third mode** (2026-09-18, `js/walker.js`, the study § 7). The
  lens's `order: step` was sold as a line loop for the grain engine and could not be one: the
  candidate list is only what sits inside the CURSOR's circle, rebuilt every tick, played one per
  grain period — so it faked a loop for a short stroke under a still cursor and was a shuffle with
  a memory otherwise (Ek: "it's on the lens and it only works on the cursor, which is circular,
  and strokes are not always falling into the cursor circle"). `S.nearestMode` becomes
  `S.lensMode`: `area · nearest · stroke`. Under `stroke` the cursor reads NOTHING on its own;
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
  `on tape` family is `on strokes` now, because dwell / start / release / retrig / rearm mean the
  same thing to a take and to a walker. Wet paint reaches a walker for free: the bridge buckets
  its pool by each mark's own voicing, as a cloud's.
- **The lens sheet is three sections, named for the question each answers** (2026-09-18, Ek: "the
  lens engine sheet is getting pretty confusing … it's really hard to tell just from the params how
  things work together and what links to what or depends on what"). `reach` (reads · radius) holds
  the only two rows that govern BOTH engines — the radius is the grain reach and the distance at
  which a stroke is touched (`enterRad`). `on grains` (mode · depth · k · order · fade · falloff)
  is everything grains-only, with **`mode` leading it**: the tape gate reads the mode in one place,
  to decide whether to build walk gates, and never to decide how a take is touched, so Ek's hunch
  that it belonged with the grains was right. `on strokes` (dwell · start · release · retrig ·
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

### From the settings dialog

Cut from the settings rows on 2026-09-14 when descriptions went to one sentence under 92
characters (align-audit R5). The rows keep the sentence that says what the control does; this is
everything else they were carrying. **Checked before appending: only 7 of the 40 distinctive
clauses across all nineteen cuts appeared anywhere in docs/ beforehand, so this is not a
duplicate of what follows — for most of these rows the settings dialog was the only place the
information existed.**

**Blend.** All plays every pin at equal weight. Focus leans toward whichever is closest to the cursor.

**Curve.** The crossfader curve between two pins — the DJ mixer's word (Ek, 2026-09-17: "width" read as a size; it is whether the handover is gradual or sharp). 100% blends the whole way from one anchor to the next; 0% cuts at the midpoint. On an anchor, that pin is alone. Focus only; outside focus the row is greyed.

**Selected Pin.** The pin unpin takes, marked in the rail: the one nearest the cursor, the one farthest from it, or the one pinned first.

**Tap Window.** The gap after a release in which the next press counts as the ×2 or ×3, and how long a tap waits beside them.
