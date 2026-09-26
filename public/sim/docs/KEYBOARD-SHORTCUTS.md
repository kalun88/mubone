# mubone — Keyboard Shortcuts

> **Status: CURRENT** · reference · verified 2026-07-28. If a binding here disagrees with `ACTIONS` in `js/midi.js`, the code is authoritative — the in-app keys/midi/osc modal renders from it.

> **Read this first.** `ACTIONS` in `js/midi.js` is authoritative and the in-app keys / MIDI / OSC modal renders from it; this file is the prose copy. The palette's keys are the tiles' own (`docs/PALETTE-GUI.md`); Tab shows and hides the tool rail; the ⋯ on a row is the drawer's door. Find the key you are changing in its section; read *Custom Bindings & Remote Control* for learn. Some section text predates the tile screen becoming `main`.

## Cursor & Camera Modes

In **steer mode** (default), your mouse controls the camera — its offset from the centre of the **reachable stage** (the canvas minus any open rail and the palette strip) is a rotation speed, so a rail's edge and the strip's top edge are both hard over. **The steer stops the moment the pointer is on any chrome** — a rail, the top bar, the palette, a settings page (Ek, 2026-09-12: "anywhere i'm trying to use the GUI the sphere should automatically stop spinning") — and picks up again when it is back on the sphere.

In **surface mode**, your trackpad/mouse position maps directly onto the sphere surface — move your finger and the cursor follows.

Both modes use pointer lock. To access the UI or interact with panels, **press ⌥ Option** — it locks cursor azimuth and elevation and hands your pointer back. Press ⌥ Option again to re-enter.

⌥ is a **shortcut to the AZ and EL locks in the footer**, not a mechanism of its own (2026-09-01): it writes exactly the state those two buttons write, so locking both by hand does the same thing and the footer always shows what ⌥ did. In **sensor mode** it still locks both axes — the pointer half simply has nothing to do there, since the mouse is already yours.

**⌥ Option is the most important key to learn first** — it's how you get in and out of cursor control.

You can switch between steer, surface, and sensor modes from the camera mode button in the top bar. All three are orientation only — camera **distance** is the pull-back slider in the viz panel and applies to all of them.

## The tile screen

**The hand, and the palette as quick access** (`js/tiles.js`, 2026-09-12; `docs/PALETTE-GUI.md`
is the authority). **The hand is one tool** — click it in the rail or on the strip and it is in
hand; **the spacebar and a left-click on the sphere play it**, in one global verb (momentary by
factory; right-click the hand tile to flip it), and the **hand tile** at the head of the strip shows it: its glyph, its shape the verb,
its binding as ONE keycap under it — the key, and `click` beside it while that key is the spacebar.
**The hand's key is learnable** (2026-09-22): click the keycap to relearn, right-click to clear.
**The sphere's left click is a second spacebar** — it follows whatever `key:Space` is bound to, not
the hand, so rebinding the hand to another key takes the click off it. **The palette is quick access**:
four positions, each with its own key, button or note, firing in the tile's own verb and never
touching what is in hand.

**THE PALETTE IS A FIXED TOOLBAR** (Ek, 2026-09-22: "there's no more drag. it's like forscore or
procreate or adobe edit"). The row is six tiles: the HAND's two sides, then four positions.

| | tile | plays it | verb |
|---|---|---|---|
| hand | **tape** · its voice | spacebar **press** | — |
| hand | **grain** · its voice | spacebar **hold** | — |
| 1 | **lens** | `c` | toggle |
| 2 | **erase** | `e` | momentary |
| 3 | **pin** | `↓` | bang |
| 4 | **unpin** | `↑` | bang |

The first two tiles ARE the tape and grain tools — they are the hand's two sides, each naming its
tool and the **voice** it wears, and the spacebar plays them. They are not positions and take no
letter: a `t` and a `g` beside them would be a second key for the spacebar. What is yours per
position is the **verb** (right-click) and the **binding**; what varies on a tile is what it wears
— the two tools their voice, the lens tile its installed preset — not which tiles exist.

It was composed by dragging a row in from the rail until 2026-09-22, up to nine positions, with a
dropped tile taking the next free digit. That ended when tools collapsed to one per instrument:
there were four tools for nine slots, and the rail stopped drawing rows to drag from, so the strip
had quietly become unbuildable.

**Nothing is armed** (Ek, 2026-09-11) — the hand is not arming: a tile fires in its own verb
whatever is in hand, and the only mark the hand leaves on the strip is a one-hairline ring. A
POSITION is a button. It has one action, one OSC address and **ONE VERB**, and the verb is the tile's:

| verb | what the press means | shape |
|---|---|---|
| **bang** | it happens, once | a circle — no corners to hold |
| **momentary** | it runs while the input is down | a plate — four corners you grip |
| **toggle** | it runs until you press again | an asymmetric plate — it has thrown one way and can throw back |

The verb is set by a **right-click on the strip tile**, cycling through what the kind allows: a
brush, an eraser and a lens are momentary or toggle; **pin** has all three, which is how one pin
tile pins where you stand and a second draws a path; **unpin** is a bang alone. Drop a tile and it
lands on its kind's default — a tool momentary, a lens toggle, pin a bang. Putting one tool on the
strip twice in two verbs is two drags and two right-clicks, and that is the mechanism. A
right-click on the hand tile flips the hand's verb the same way.

**A click on a tool — rail row or strip tile — takes it in hand** and plays nothing. A click on a
lens tile installs it or turns it off; a click on a pin tile fires it. The `⋯` opens the drawer
and picks nothing. `F`, `/trace` and `/trace/toggle` are gone; the hand has no action row — space
and the click are wired to it directly.

**Each bound tile wears a STICKER** on its bottom-left corner — one binding kind at a time, chosen
on the keys page (key by factory; button or MIDI note instead when you want them) — saying what
fires it: the source (a key bright, a button ember, a note grey), then the gesture in the app's
own word, **blank means press**, and long / extra long as a bar. **Click the sticker to relearn**:
the next key, button or note of that kind lands on that position (`Esc` or another click cancels;
right-click clears). A palette key is a plain key: ⌘, ctrl and ⇧ chords are refused.
A `···` after the gesture means that tap is **delayed**: a `×2` or `×3` bound anywhere on the
same input makes its tap wait the double window — measured at ~125 ms. It shipped on button 3
(pin the tap, unpin the `×2`) until 2026-09-12; pin is button 3's **press** now, so the factory
pin tile takes all three verbs and pins the moment the button goes down.

**Pinning and unpinning are the pin tiles' own keys** (`↓` and `↑` by factory, or whatever the
drop dealt) — the palette is the whole truth (Ek, 2026-09-12); the `=` / `-` keys are gone. One
gesture, no group to aim: a bang pins where you stand, a momentary or toggle pin tile draws a path.
`Q W E` and `⇧Q W E` addressed the three named pin groups and are **free keys** since
2026-08-30 (`⇧Tab` was too, and is the pinned rail's since 2026-09-12); pinned material groups by what it is, clouds and loops (`docs/archive/BRUSH-MODEL.md` § 3e).

| Key | Does |
|-----|------|
| **`space`** | **plays the tool in hand** at factory, in the hand's verb — toggle: press starts, press again stops; momentary: while held. A left-click on the sphere does whatever `space` does. **Learnable since 2026-09-22**, both ways: the hand's key can be changed, and `space` can be bound to anything else (which takes it off the hand). `A` is audition's, and learnable too |
| **`A`** | **audition** at factory (2026-09-24) — the cursor plays what it reads through the live tape and grain sheets; press again for baked. A binding like any other: learnable off `A` and onto anything. (It was the bench's play key, reserved, from 2026-09-21) |
| **stickers** | since 2026-09-25 every PERFORMANCE control with a factory key wears the palette's key sticker — autopin, overdub, audition, radius `[ ]`, mode `N`, follow, and on the chrome undo `⌘Z`, sweep, erase all `⌫×3`, zero `` ` ``, lock `⌥`, mute `M`. Click the sticker to learn, right-click to clear. N, `[ ]`, `⌘Z`, M and `` ` `` are seeded bindings now (they were hardcoded); ⌥ and ⌫×3 stay hardcoded and a learn adds a key beside them |
| **`↑` extra long** | **unpin all** at factory (2026-09-25) — the unpin tile's key held past the extra-long window: the press unpins the selected pin, keeping it down clears the rest |
| **`F`** | **follow** at factory (2026-09-25) — the pinned rail's switch: the faders follow the cursor. Learnable like any binding |
| **`P`** | **grain autopin as cloud** at factory (2026-09-25; both engines until 2026-09-26, when tape stopped having one — a take dubs by touch). There is no overdub key: a take started on a loop or a line layers onto it |
| **`Tab`** | show or hide the **tool rail** — never the drawer (Ek, 2026-09-12). The `⋯` on a rail row is the drawer's only door; `~` is the same act as Tab. The tools pill's tooltip says so |
| **`⇧Tab`** | show or hide the **pinned rail** on the right (Ek, 2026-09-12: "shift tab to open and close the pin"). The pinned pill's tooltip says so |
| **`c` `e`, `↑`, `↓`** | **fire** a palette position (`palette_N`), in that tile's verb — a momentary plays while the key is down, a toggle runs until the same key again, a bang happens once. Factory: `c` lens *(toggle)* · `e` erase *(momentary)* · `↓` pin *(momentary — hold it and move, the path is the cloud; a hold under 200 ms pins where you stand)* · `↑` unpin. The two tools are the hand's, on the spacebar. **The key belongs to the position**, and since 2026-09-22 a position holds one tile for good — the strip is fixed, so nothing moves and no digit is ever freed. One play at a time: while a tool runs, the other tool keys are dead and its own key is what ends it |
| | **`S` went on 2026-09-24**: it was `scan_toggle`, the same cap `c` fires as the lens tile's toggle, and one control gets one row. `c` is the lens off and on — the cursor reads nothing under the cap. **Not a mute** (2026-09-23): a take already fired plays to its release, a grain or a walker in flight finishes |
| | a position has **one row** on the keys page, in its tile's own words — `line · play (toggle)`, `pen · play (momentary)`, `lens · on / off`, `pin · pin here`. `palette_N_toggle` and `palette_N_hold` went with the three-verb position (2026-09-11); the verb lives on the tile now. **F was unbound on 2026-09-07**: it was a second key for one tool, from before the palette existed |
| | every palette key is an explicit row on the keys page — relearn it there, or click the tile's legend row and press the new key |
| | the keys page shows only BOUND actions by default — a learned key, a factory key nobody else took, a button, a MIDI assignment. **Show all** at the top reveals the rest, and the filter box searches whichever set is showing (2026-09-10) |
| | **the instrument's three buttons** send 1 on the down and 0 on the up. A momentary action takes the whole button; a toggle or bang action sits on a gesture — press (the down, never delayed) · tap (a bang on the up) · long press · extra long · ×2 · ×3 — bound in the Button column (Settings → Instrument buttons sets the windows and shows what each button does) |
| *(none)* | **wet** on/off for the grain brush in the hand — the switch in its sheet head, or bind `wet_toggle` (`/palette/wet`). A wet brush's knobs keep moving every stroke it painted; off dries them where they sound |
| **overdub** (a loop-kind tile) | a take inside the NEAREST PINNED LOOP's cycle: press with the overdub brush in the hand and the take joins that loop as a layer — every cycle, at the phase you played it, at 1× whatever the loop's speed; longer than the cycle and the passes stack. One pin, a dot per overdub on its row. Nothing pinned, the first take IS the main loop — pinned on release like the looper's — and the next press overdubs onto it. `docs/archive/OVERDUB-PLAN.md` |
| **wash** (a grain-kind tile) | the looper's move for the grain family: end the stroke and it is PINNED at once as a moving cloud looping the path you drew, reading the marks you laid on it. While you paint only the cursor reads it; the cloud takes the path on release. The contract is the grain sheet's **on end** row (`scratch · cloud`) — any grain tile becomes a wash by flipping it; the tile remembers. The row is what the **A** key and `/trace/mode` used to cycle under the palette; both are gone (2026-09-05) |
| **paint + the pin tile's key** | the looper gesture: while painting a line, hold a momentary pin tile's key and the stroke-so-far loops immediately and keeps growing with the stroke; releasing it freezes it |
| **Q W E · ⇧Q W E** | **free.** They addressed the named pin groups, which no longer exist |

**The pin buttons.** **pin** and **unpin** are palette tiles (positions 3 and 4, `↓` / `↑` by
factory) and nowhere else since 2026-09-22 night; **unpin all** is a button row in the pinned
rail's top block, under *when full* (2026-09-25). They are not tools:
they cannot be in hand and `Tab` never lands on them; they act on what already exists. They carry no state: there is one pin gesture and
nothing to aim it at, so the label is the verb.

**Pinned material groups by kind** — the rail's two BUSSES, **clouds** and **loops**, each
appearing only when it holds something, each with **M** (mute the group) and **S** (solo it, one
at a time). A pin muted by hand stays muted when its group comes back. Every pin is a TRACK above
them (2026-09-16): the bar is its fader, its number folds its own in / out open, its M and S are
the same pair. Follow, sort and curve are the rail's mode bar (follow is the switch that was `blend:
all | focus`; tether went with it on 2026-09-22 — the radius never gates a pin); the rest — when full, what a
new pin is born with — is **Settings → Pins**, reached from the ≡ in the rail's own header and from
nowhere else; the lens reads the scratch layer and does not touch the pins.

**The palette floats over the lower sphere**, centred and large — it is the instrument, so it sits on
the instrument's surface rather than in the chrome. The gaps around its tiles still paint (the
dock is pointer-transparent); the tiles themselves do not.

**The library is the left rail** — **source · lens · tape · grain · erase**, one row per
tool, mirroring the pinned rail on the right. It always shows everything the app has; the palette
holds the ones you reach for. Each engine's title carries a **`+`** at its right edge
(2026-09-10): tap it to mint a tool of that engine from what is on the sliders now — it is picked
and its drawer opens. This replaced a `new tool` row at the foot of the list and its engine
chooser. **Clicking a row takes that tool in hand** — space and the sphere's click play it; it
plays nothing itself and does not place the tool on the palette (drag it there). **The ⋯ at the
right edge of every row opens a second rail beside it** with that tool's whole engine (the ⋯
points the drawer without changing the hand; `Tab` never opens it) — one line per parameter, **type into any
number**, **double-click any track to reset it** to the tick shown beneath it, and for a granular
tool a window at the top showing one grain against the next one's onset. The filter is drawn: drag
across for the cutoff, up and down for the resonance. An open drawer follows whatever you pick next. A lens
row installs the lens and nothing more, and every lens row carries the same ⋯ (on an
uninstalled lens it installs first). Both rails float over the sphere and never resize it. `Esc` closes
the properties rail, then the tool rail; **tools** in the chrome (and `~`) shows and hides them.

**The footer is audio + sensor** — levels, the audio controls (gate, dry monitor, dry gain,
master) and the cursor's azimuth / elevation source pickers, with sensor and OSC status at the
right. The input channel lives in Settings → audio, since it is chosen when you plug in.

**Every rail overlays the sphere**, left and right alike — the pinned rail included, behind its
own **pinned** pill. Nothing on this screen resizes the stage: the sphere is the full window, and
each rail is shown or hidden over it.

**LIT, and IN HAND, are the marks a tile carries.** The tile filled in its engine's hue is the
tool *sounding* — a key, a pad, a pedal — and it shows on the palette tile and its rail row alike.
The in-hand tool IS the hand tile at the head of the strip, and its rail row is marked — that is
the answer to "what would space do?", asked again since 2026-09-12.
The **box** that meant ARMED is gone. A lens tile lights its glyph while the lens is on; a pin
tile flashes on the press.

**Changing what is on the palette is a DRAG.** Drag a row in from the rail to place it (the caret
says where), drag a tile within the strip to move it, drag a tile off to remove it — nine is full,
and the strip is exactly as wide as the list. Every tool may leave: the palette can hold nothing
but lenses and pins. Nothing cycles under a tile and no palette click opens a drawer (the ⋯
does); a click on a tool tile takes it in hand. The lens tile leads the row (2026-09-22 night), then the hand's two tiles, three tiles wide like a spacebar. The list persists in
`mubone_palette`. A **lens tile** is a state — tap it on, tap it off, and no lens on is the cap,
where the cursor reads nothing; there is no cap tile. The ⋯ on its rail row is the lens's drawer.

A tile's engine shows in exactly one place on the tile itself: **the hue of its glyph** — one hue
per engine, not per tile (source slate-blue · lens teal · loop rose · grain sand · erase clay,
`--eng-*` in `css/style.css`); in the toolbox the engine is also the group caption. Nothing in the
strip is dimmed. **Undo, redo, sweep and erase-all live in the chrome** (top bar pills; ⌘Z, ⇧⌘Z, `−` and
⌫×3 still work; the redo pill greys out while there is nothing to redo). **Sweep = clear the
scratch layer** — everything unheld goes, holds keep sounding. **properties** in the chrome shows a
**footer section** under the tile row with the PICKED tool's whole engine (granular · loop/sample ·
erase), or the lens's if a lens was the last thing tapped — every parameter, each with a ◉/○ eye.
Its height is **fixed** whatever engine is in it, so nothing moves under you mid-edit; deep
engines scroll inside it. Hide it with the pill, the `esc ✕` in its head, or **`Esc`**; clicking
another tool re-targets it without hiding it. **There is no perform quick view** — the strips
under the row are gone, and this is the one place a parameter lives.

**The grain filter and the source are NOT palette candidates.** The lens IS one — it is on the
strip at position 1 (`c`) and its tile turns the eye off and on: off is the **cap**, the cursor
reads nothing, and the lens keeps its settings. **There is ONE lens** (2026-09-22 night): its
settings are the lens TAB in the tool rail — reads, radius, mode (area · nearest), depth, k (0 = all),
order, fade, falloff — and `N` flips its mode from the keyboard. `wide` and `spot` were presets of
it and are gone; `⇧K` still enters and leaves arrange. Grain tiles keep their sheet edits (a grain
tile owns its whole block, 2026-09-03); the lens's and the eraser's are per session. The old toggle-7 tile retired into the
arrange lens.

**Retired:** digits `1`–`0` no longer select patches and `Q`–`P` no longer paint samples (#214),
and the patch bank itself went on 2026-09-03 (#325, `sandbox/sunset-2026-09-03/`) — a grain
tile owns its whole block, so there is nothing for a bank to hold.

Every play is one funnel, decided once in `js/brush.js` (`gesturePress`) and only then handed to
the brush that started it, to say what it deposits (`_toolDown`). Two doors press it: a POSITION
(a quick-access key, in the tile's verb) and THE HAND (space, the sphere's click, the hand tile, in
the hand's verb). One play at a time, whichever door.

---

## Recording & Painting

| Key | Action |
|-----|--------|
| **a TOGGLE tile's key** | the press starts it, the next press on the same position stops it, the key-up does nothing |
| **a MOMENTARY tile's key** | down starts, up stops. For a pedal, a footswitch or a held pad |
| **a BANG tile's key** | it happens on the down; the up means nothing |
| **a toggle eraser held 8 s** | Erase all — the long press is the toggle's second function, free because a hold means nothing else to a toggle |

There is no tap-versus-hold hybrid (2026-09-04), and no mode setting: **which one a tile is, is the
TILE's** (2026-09-11), set in its drawer head, so the same press means different things on two
tiles and the wire never has to say which it wants. A momentary tile's action takes `1` and `0`;
everything else takes a bang. One consequence worth knowing: a **tap** gesture cannot drive a
momentary tile — a tap is a bang on the up edge with no second edge — so the drawer refuses that
combination and says why. `Space` and a click on the sphere were the old main button's factory
keys until 2026-09-11; with nothing armed there was no tool for them to name, so they are free.

## Pins (clouds & loops)

**There is no D key.** The four D bindings — tap to drop, hold to draw, ⇧D for the kind,
⌘D to release — went on 2026-09-03 (#327) and their replacement `=` / `-` pair went on
2026-09-12: pinning is two TILES on the palette and the keys those tiles hold, factory
`↓` pin and `↑` unpin (§ the palette, above). What a pin IS is decided by the cursor, not
by a mode — `pinDown` / `pinUp` in `js/tiles.js` — so there is nothing for a kind key to
cycle: a pin during a tape take cuts it — the part before is the main loop, the rest an
overdub on it, each further pin a new layer (`pinSplitTake`, `js/events.js`) — a stroke in reach becomes
a loop, and nothing in reach pins a ghost cloud at the cursor. Unpin takes the pin
**Settings → Pins** names (nearest by default), never a nearest-only search of its own.

## Trigger tool

A trigger buffer fires as a whole sample whenever the cursor touches it, and is
not granular material. **There is no key or action that records one any more**
(2026-09-09: "record a hit" and `/trace/trigger` went — hit is out of the
vocabulary); the module stays for the console. `chop (toggle)` is bindable.

**A new trigger plays once when you release the record button** — the cursor is
still on the stroke you just painted, so you hear what you captured. After
that it needs you to leave and come back, like any other.

**Recording a trigger doesn't touch scan.** You can be granulating a section and
drop a trigger point into it without the granulation stopping. (Recording a loop
still mutes scan — that's unchanged.)

There is **no disarm**, because there is nothing separate to disarm: a trigger
is a view onto the painted stroke. The **erase brush** (its palette tile, or its position's `palette_N_hold`) removes it like
anything else, and treats trigger and granular material identically.

Erase is also how you **trim a trigger**: erasing the tail of a trigger stroke
shortens the sample, erasing the head trims it, erasing the middle **splits it
into two triggers**, and erasing all of it removes the trigger. The brush
doubles as an editor. Pauses you played — rests, breaths, decays — are part of
the material and never split anything; only erasing does.

The **cap** — `c`, turning the lens that is on off — silences hits as well
as granulation: it is the cursor's one mute, and under it the cursor reads
nothing on the scratch surface. (There is no cap TILE; the cap is no lens on.) The separate **triggers on/off** switch that stood beside it was
deleted on 2026-09-07: hits play through the loop engine rather than the cursor
bus, which is the only reason the cap had ever left them sounding. Uncapping
doesn't fire whatever the cursor is already resting on: you have to leave and
come back, the same rule that stops a freshly recorded trigger firing itself.
Nothing recorded is touched either way.

A trigger's **reach is the cursor's search radius** — there is no separate
trigger radius, because it is the same cursor and the same gesture (erase
works the same way). Widen the radius slider in the search panel and every
trigger zone widens with it.

**`start` has three modes**, and which one suits you depends on how the cursor
moves:

| Mode | Behaviour |
|------|-----------|
| **top** | Always forwards from the beginning of the recording |
| **touch** | Forwards from the point you actually reached. Best with free movement — a turntable only ever arrives at one end, and arriving at the tail leaves nothing to play |
| **ends** | Direction follows the end you arrive at. Front half → forwards from the top; back half → **backwards from the very end**. Always in full, never from the contact point — so on a turntable, playback direction follows spin direction |

**`dwell` says what happens when you *stop* on a trigger.** Sweeping past always
fires it; dwell is the rest:

| Mode | Behaviour |
|------|-----------|
| **once** | Nothing more — silent until you leave and come back |
| **loop** | Keeps looping, like a real looper, for as long as you stay |
| **grain** | The buffer **opens up and granulates** while you're on it. Needs **SCAN** on to be heard. Leave and it closes again |

`grain` is the one place trigger and granular material meet, and it's a live
playback choice rather than a second buffer type — the recording is still a
trigger buffer, and switching dwell back closes it.

**`chop` splits a take at its silences, when you record it.** It's a switch
plus a `gap` threshold in ms — the switch is bindable (**chop on/off**) so it
can go on a pad or pedal, and the threshold survives being toggled off. Trace a physical gesture while you play a
phrase and each note becomes its own trigger along the path — retrace the path
and they fire in sequence, so the gesture replays the phrase. It works off the
same noise gate that decides whether a particle is painted at all, so the
pauses are already in the material. Record time only; erasing the middle of a
trigger is the other way one divides.

**`retrig` says what a refire does to a pass that's still sounding:**

| Mode | Behaviour |
|------|-----------|
| **cut** | The old pass fades and it restarts from the top |
| **layer** | The old keeps ringing and the new one stacks on top, up to 8 voices |

A layered voice holds the position it was fired at, so hitting the same buffer at
different bearings spreads the stack across the speakers.

**Everything in the trigger panel is live and global.** Dwell, start, release,
rearm, speed and volume apply to every trigger the moment you move them — including one that's currently sounding. Flip dwell to `loop` while a
one-shot is ringing and it starts looping. None of it is baked into a
recording; the recording only supplies the material and where it sits.

## Playback & Navigation

| Key | Action |
|-----|--------|
| **S** | The cap — the lens's mute, on or off |
| **M** | System mute (latching) |
| **N** | The installed lens's mode: nearest / area |
| **[ / ]** | Decrease / increase search radius |
| **⌥ Option** | Cursor lock — hold azimuth + elevation (in steer/surface, also releases the pointer) |

## Patches

Gone (2026-09-03, #325). A grain tile is the preset: arm it and its whole block is the live
sound, edit a row and the tile keeps it. `preset_N`, `/preset`, `/preset/N`, the cloud-morph
actions and the `X` radial-morph key all went with the bank.

## The piece — save, open

A piece is the music you have played: takes, marks, pins, triggers and the sound
they were played on, in one `.mubone` file (`js/piece.js`). The rig — devices,
calibration, bindings, the strip, the layout — is NOT in it and never travels
with it; that is Settings → Export · Import, a separate file for a separate job.

These are the File menu's accelerators in Electron, which is what actually
catches them; in the hosted demo the same four keys are handled in the page, and
a save comes down as a download rather than to a path. **There is no autosave**
— nothing is written unless you ask, and the only thing standing between a set
and the bin is the prompt when you close the window.

| Key | Action |
|-----|--------|
| **⌘S / Ctrl+S** | Save the piece. Straight to its file once it has one, so it is silent and quick; a piece that has never been saved gets the Save As dialog |
| **⇧⌘S / Shift+Ctrl+S** | Save As — always asks, then that file is the piece |
| **⌘O / Ctrl+O** | Open a piece. Replaces what is on the sphere, so save first — the quit guard cannot help you here |
| **⌘N / Ctrl+N** | New — an empty piece. The same teardown an open runs |

The open piece's name sits beside the version in the chrome, with a dot after it
when there is something unsaved; macOS also puts it in the window title and the
dot in the close button. **File → Open Recent** holds the last eight, and a
double-clicked `.mubone` opens in mubone.

## Editing

| Key | Action |
|-----|--------|
| **⌘Z / Ctrl+Z** | Undo the last thing you did — a stroke with everything it made, a pin placed by hand, an unpin, an erase or a sweep. One gesture is one action; hold it and you walk back to the top of the show |
| **⇧⌘Z / Shift+Ctrl+Z** | Redo the last undone action — a stroke comes back with its recording, its trigger arming and the pin it made; a pin or an unpin comes back as it was. A new action forks history: what was undone stays undone |
| *(unbound)* | An eraser's spring-loaded hold has no key — its digit TAPS its position like every other, and the hold is that position's `palette_N_hold` on a button or pedal (2026-09-07) |
| **Delete / Backspace** ×3 | Erase all (triple-press within 800ms) |
| **`** (backtick) | Zero the cursor — the sensor's heading in sensor mode; in steer and surface the camera goes back to the front. Also the footer's ZERO button, leftmost of the cursor group |
| **~** (⇧`) | Show or hide the tool rail — the tools pill's key, the same act as `Tab`. The shifted key rather than the bare one because **`** is tare, which is hit mid-performance |

## Display

| Key | Action |
|-----|--------|
| *(none)* | The perf monitor, high-perf render and the projector window have no keys and no actions (2026-09-09): Diagnostics, Visuals and Camera + display set them |
| **Esc** | Close topmost modal / blur focused field |

### Gestures — stated once, never in a row's description

Both moved here on 2026-09-14. A global behaviour written per-row is how one sentence ended up
written four times; a gesture belonging to a different window was documented nowhere else at all.

| Gesture | Action |
|---|---|
| **Double-click a slider** | Reset it to its default. True of every slider with a default — the settings dialog's and the engine sheets' alike (the sheet's § 5 says the same) |
| **Double-click the projector window's title bar** | Fullscreen it. This is the window manager's gesture, not a mubone control — mubone has no key for it |

## Inside the keys / midi / osc modal

The filter box above the table is focused when the modal opens; typing hides
every row that doesn't match. Terms are ANDed and match the whole row — action
name, group heading, default key, key override, MIDI binding and OSC path.

| Key | Action |
|-----|--------|
| **⌘F / Ctrl+F** | Focus + select the filter box (modal only — no effect elsewhere) |
| **Esc** | Clear the filter if non-empty, else blur; a second Esc closes the modal |

## Custom Bindings & Remote Control

These are the default keyboard shortcuts. All bindings can be remapped via the learn mode in the **keys / midi / osc** module (top bar) — and a LEARNED key is read like an instrument button (2026-09-11): press, tap, long, extra long, ×2 and ×3, with the buttons' timings, so one key can carry several actions (Q tap arms position 2, Q long position 3). Hold the key past the long time while learning and the row learns the long; ⇧-click the cell to learn a tap. MIDI notes the same. The module also shows the full list of available MIDI CCs and OSC addresses.

Several actions ship with **no** default key and exist only to be bound — they show `—` in the key column of that module, and appear in the accessory modal's destination dropdown for any pad set to `button`:

| Action | Notes |
|--------|-------|
| `mute_hold` — system mute (hold) | Momentary / cough-button mute. Silent while held; on release it restores the state at press time, so tapping it while already muted by **M** leaves the system muted. |
| `pitch_oct_down` / `pitch_oct_up` | Step the base pitch shift by ∓1200¢, clamped at ±2400¢ — the `−oct` / `+oct` buttons in the grain panel. |
| `pitch_oct_reset` | Return the base pitch shift to 0¢ — the `0` button in the grain panel. |
| `erase_toggle` — erase brush (toggle) | Latching erase, for controllers that only send a press edge. |
 Modifier combos (Shift, Ctrl, ⌘) and scroll wheel are also mappable. Blocked keys that can't be rebound: Escape, Tab, F5, F11, F12.

The in-app module is always the source of truth for the current state of all bindings.

---

*mubone v1.10 alpha*
