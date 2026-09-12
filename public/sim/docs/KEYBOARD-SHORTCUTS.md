# mubone — Keyboard Shortcuts

> **Status: CURRENT** · reference · verified 2026-07-28. If a binding here disagrees with `ACTIONS` in `js/midi.js`, the code is authoritative — the in-app keys/midi/osc modal renders from it.

> **Read this first.** `ACTIONS` in `js/midi.js` is authoritative and the in-app keys / MIDI / OSC modal renders from it; this file is the prose copy. The digits `1`–`5` are the palette's keys by position and Tab / ⇧Tab open the drawers (`docs/RULINGS.md`, palette). Find the key you are changing in its section; read *Custom Bindings & Remote Control* for learn. Some section text predates the tile screen becoming `main`.

## Cursor & Camera Modes

In **steer mode** (default), your mouse controls the camera — drag to rotate the sphere.

In **surface mode**, your trackpad/mouse position maps directly onto the sphere surface — move your finger and the cursor follows.

Both modes use pointer lock. To access the UI or interact with panels, **press ⌥ Option** — it locks cursor azimuth and elevation and hands your pointer back. Press ⌥ Option again to re-enter.

⌥ is a **shortcut to the AZ and EL locks in the footer**, not a mechanism of its own (2026-09-01): it writes exactly the state those two buttons write, so locking both by hand does the same thing and the footer always shows what ⌥ did. In **sensor mode** it still locks both axes — the pointer half simply has nothing to do there, since the mouse is already yours.

**⌥ Option is the most important key to learn first** — it's how you get in and out of cursor control.

You can switch between steer, surface, and sensor modes from the camera mode button in the top bar. All three are orientation only — camera **distance** is the pull-back slider in the viz panel and applies to all of them.

## The tile screen

**The palette is a strip of up to nine positions; the tool rail is the library**
(`js/tiles.js`, 2026-09-11). A fresh palette is **wide · line · pen · all · overdub · unpin ·
pin**, on keys **`1` to `9` by position**. It is BUILT BY DRAGGING a row in from the rail
(Procreate): drag within the strip to move a tile, drag one off to remove it.

**Nothing is armed** (Ek, 2026-09-11: "we are now sunsetting the concept of arming a tool.
there's no concept anymore of what the hand holds"). A POSITION is a button. It has one action,
one OSC address and **ONE VERB**, and the verb is the tile's:

| verb | what the press means | shape |
|---|---|---|
| **bang** | it happens, once | a circle — no corners to hold |
| **momentary** | it runs while the input is down | a plate — four corners you grip |
| **toggle** | it runs until you press again | an asymmetric plate — it has thrown one way and can throw back |

The verb is set in the tile's **drawer head**, and it offers only what the kind allows: a brush,
an eraser and a lens are momentary or toggle; **pin** has all three, which is how one pin tile
pins where you stand and a second draws a path; **unpin** is a bang alone. Drop a tile and it
lands on its kind's default — a tool momentary, a lens toggle, pin a bang. Putting one tool on the
strip twice in two verbs is two drags and two settings, and that is the mechanism.

**A click on the strip FIRES it**, in that tile's verb, exactly as its key does. **A rail row has
no click at all**: it is a drag source with a `⋯`, and the `⋯` is the only gesture that points the
drawer without firing. **There is no main button**: `space`, a click on the sphere, `F`, `/trace`
and `/trace/toggle` all meant "fire the tool in the hand", and all are gone. Space is a free key
you can learn onto any position on the keys page.

**Each tile wears a LEGEND** — one line saying what fires it: the source (a key bright, a button
ember, a MIDI note grey), then the gesture in the app's own word, and **blank means press**. A
tile may carry several inputs. A `···` after the gesture means that tap is **delayed**: a `×2` or
`×3` bound anywhere on the same input makes its tap wait the double window — measured at ~125 ms,
and it ships on button 3, where pin is the tap and unpin the `×2`.

**Pinning is `=` and unpinning is `-`** — one gesture, no group to aim: tap = pin where you
stand, hold = pin a drawn path.
`Q W E`, `⇧Q W E` and `⇧Tab` addressed the three named pin groups and are **free keys** since
2026-08-30; pinned material groups by what it is, clouds and loops (`docs/archive/BRUSH-MODEL.md` § 3e).

| Key | Does |
|-----|------|
| **`space`** | **free** since 2026-09-11 — it was the main button, and there is no tool in the hand for it to fire. Learn it onto the position you reach for most |
| **`Tab`** | the **drawer** of the last tile FIRED, open or shut — one rule, one variable. The `⋯` on a rail row is the other door, and the only one that does not fire |
| **`⇧Tab`** | the installed **lens's** drawer, open or shut. Also the ⋯ on a lens row (on an uninstalled lens it installs it, then opens) |
| **`=`** | **pin** what the cursor is sounding — a hold: tap = pin where you stand, hold = pin a drawn path |
| **`-`** | **unpin** — release the selected pin (nearest, farthest or oldest — Settings → Pins), whichever kind it is. *(This took sweep's key; sweep is the chrome pill, and stays bindable as `sweep`.)* |
| **1 … 9** | **fire** palette position N (`palette_N`), in that tile's verb — a momentary plays while the digit is down, a toggle runs until the same digit again, a bang happens once. Factory palette: 1 wide *(toggle)* · 2 line *(toggle)* · 3 pen *(momentary)* · 4 all *(momentary)* · 5 overdub *(momentary)* · 6 unpin *(bang)* · 7 pin *(bang)*; drag tiles to change it, and the digits follow the positions. One play at a time — while a tool runs, the other tool keys are dead and its own key is what ends it |
| **S** | the installed lens **off**, and on again — no lens on, the cursor reads nothing: the cap (`scan_toggle`). A lens tile tapped when on does the same |
| | a position has **one row** on the keys page, in its tile's own words — `line · play (toggle)`, `pen · play (momentary)`, `wide · on / off`, `pin · pin here`. `palette_N_toggle` and `palette_N_hold` went with the three-verb position (2026-09-11); the verb lives on the tile now. **F was unbound on 2026-09-07**: it was a second key for one tool, from before the palette existed |
| | every palette key is a factory default of its action: relearn it on the keys page and the digit stands down |
| | the keys page shows only BOUND actions by default — a learned key, a factory key nobody else took, a button, a MIDI assignment. **Show all** at the top reveals the rest, and the filter box searches whichever set is showing (2026-09-10) |
| | **the instrument's three buttons** send 1 on the down and 0 on the up. A momentary action takes the whole button; a toggle or bang action sits on a gesture — press (the down, never delayed) · tap (a bang on the up) · long press · extra long · ×2 · ×3 — bound in the Button column (Settings → Instrument buttons sets the windows and shows what each button does) |
| *(none)* | **wet** on/off for the grain brush in the hand — the switch in its sheet head, or bind `wet_toggle` (`/palette/wet`). A wet brush's knobs keep moving every stroke it painted; off dries them where they sound |
| **overdub** (a loop-kind tile) | a take inside the NEAREST PINNED LOOP's cycle: press with the overdub brush in the hand and the take joins that loop as a layer — every cycle, at the phase you played it, at 1× whatever the loop's speed; longer than the cycle and the passes stack. One pin, a dot per overdub on its row. Nothing pinned, the first take IS the main loop — pinned on release like the looper's — and the next press overdubs onto it. `docs/archive/OVERDUB-PLAN.md` |
| **wash** (a grain-kind tile) | the looper's move for the grain family: end the stroke and it is PINNED at once as a moving cloud looping the path you drew, reading the marks you laid on it. While you paint only the cursor reads it; the cloud takes the path on release. The contract is the grain sheet's **on end** row (`scratch · cloud`) — any grain tile becomes a wash by flipping it; the tile remembers. The row is what the **A** key and `/trace/mode` used to cycle under the palette; both are gone (2026-09-05) |
| **paint + `=`** | the looper gesture: while painting a line (a digit, a pad or a pedal), hold `=` and the stroke-so-far loops immediately and keeps growing with the stroke; releasing `=` freezes it |
| **Q W E · ⇧Q W E** | **free.** They addressed the named pin groups, which no longer exist |

**The pin buttons** live in the pinned rail, above the material they act on — **pin**, **unpin**
(on `=` and `-`) and **unpin all**. They are not tools: space never fires them and `Tab` never
lands on them; they act on what already exists. They carry no state: there is one pin gesture and
nothing to aim it at, so the label is the verb.

**Pinned material groups by kind** — the rail shows a **clouds** row and a **loops** row, each
appearing only when it holds something, each with **M** (mute the group) and **S** (solo it, one
at a time). Muting a group remembers what was already silent inside it, so unmuting brings back
only what was sounding. Every pin *parameter* — blend, crossfade, tether, slot count — is on
**Settings → Pins**, reached from the gear in the rail's own header and from nowhere else; the
lens reads the scratch layer and does not touch the pins.

**The palette floats over the lower sphere**, centred and large — it is the instrument, so it sits on
the instrument's surface rather than in the chrome. The gaps around its tiles still paint (the
dock is pointer-transparent); the tiles themselves do not.

**The library is the left rail** — **source · lens · tape · grain · erase**, one row per
tool, mirroring the pinned rail on the right. It always shows everything the app has; the palette
holds the ones you reach for. Each engine's title carries a **`+`** at its right edge
(2026-09-10): tap it to mint a tool of that engine from what is on the sliders now — it is picked
and its drawer opens. This replaced a `new tool` row at the foot of the list and its engine
chooser. **Clicking a row points the drawer at that tool and does nothing else** — it plays
nothing and it does not place it on the palette (drag it there). **The ⋯ at the right edge of
every row, or `Tab`, opens a second rail beside it** with that tool's whole engine (on another
row the ⋯ picks the tool first, as the click would) — one line per parameter, **type into any
number**, **double-click any track to reset it** to the tick shown beneath it, and for a granular
tool a window at the top showing one grain against the next one's onset. The filter is drawn: drag
its edges for hpf and lpf, up and down for Q. An open drawer follows whatever you pick next. A lens
row installs the lens and nothing more, and every lens row carries the same ⋯ (`⇧Tab`; on an
uninstalled lens it installs first). Both rails float over the sphere and never resize it. `Esc` closes
the properties rail, then the tool rail; **tools** in the chrome (and `~`) shows and hides them.

**The footer is audio + sensor** — levels, the audio controls (gate, dry monitor, dry gain,
master) and the cursor's azimuth / elevation source pickers, with sensor and OSC status at the
right. The input channel lives in Settings → audio, since it is chosen when you plug in.

**Every rail overlays the sphere**, left and right alike — the pinned rail included, behind its
own **pinned** pill. Nothing on this screen resizes the stage: the sphere is the full window, and
each rail is shown or hidden over it.

**LIT is the only mark a tile carries.** The tile filled in its engine's hue is the tool
*sounding* — a key, a pad, a pedal — and it shows on the palette tile and its rail row alike.
There is no resting mark: the **box** that meant ARMED went with arming on 2026-09-11, along with
the question it answered ("what would space do?"). A lens tile lights its glyph while the lens is
on; a pin tile flashes on the press.

**Changing what is on the palette is a DRAG.** Drag a row in from the rail to place it (the caret
says where), drag a tile within the strip to move it, drag a tile off to remove it — nine is full,
and the strip is exactly as wide as the list. Every tool may leave: the palette can hold nothing
but lenses and pins. Nothing cycles under a tile and no palette click opens a drawer (`Tab`
does). The palette's badge at its head is chrome, not a tile. The list persists in
`mubone_palette`. A **lens tile** is a state — tap it on, tap it off, and no lens on is the cap,
where the cursor reads nothing; there is no cap tile. `⇧Tab` is the lens's drawer.

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

**The grain filter and the source are NOT palette candidates.** A lens IS one — it goes on the
strip and its tile turns it on and off — but the filter and the source are modes, not tools:
they change what everything else means — so they keep their own dock at the right end of the row
(`wide` · `spot` · `arrange` · `cap` · `grain filter`) and the source group at the left. No keys: a lens is installed by
tapping and left on, like a camera. One is always installed; **cap** is the toggle that mutes
reading (the lens stays mounted with its settings). **Selection is stored, not derived** (Ek,
2026-08-26): the engine sheet always edits its own tile, so flipping `mode` inside wide runs
nearest *as wide*, as a session edit — the highlight doesn't move. `N` still flips the flag (the
installed lens carries it); `⇧K` still enters and leaves arrange, the one flag the tiles follow.
Grain tiles keep their sheet edits (a grain tile owns its whole block, 2026-09-03); lens and
eraser factory tiles' edits are per session, because their factory value is their identity. The old toggle-7 tile retired into the
arrange lens.

**Retired:** digits `1`–`0` no longer select patches and `Q`–`P` no longer paint samples (#214),
and the patch bank itself went on 2026-09-03 (#325, `sandbox/sunset-2026-09-03/`) — a grain
tile owns its whole block, so there is nothing for a bank to hold.

Every play is one funnel, decided once in `js/brush.js` (`gesturePress`) and only then handed to
the brush of the position that started it, to say what it deposits (`_toolDown`). It was called
the **main button** while space, a click and `/trace` all pressed it with whatever was armed;
arming went on 2026-09-11 and a press now names the POSITION it fires — and the tile at that
position says how.

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

## Commits (Clouds & Loops)

| Key | Action |
|-----|--------|
| **D** (tap) | Drop commit (cloud: plant at cursor / loop: drop from cursor) |
| **D** (hold) | Draw commit (cloud: moving path / loop: record) |
| **Shift+D** | Cycle commit mode (cloud ↔ loop) |
| **⌘D / Ctrl+D** | Release nearest commit |

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

The **cap** — `S`, or turning the lens that is on off — silences hits as well
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
| **H** | Arm / disarm handsfree recording *(the pill is Settings → audio → handsfree gate)* |
| **[ / ]** | Decrease / increase search radius |
| **⌥ Option** | Cursor lock — hold azimuth + elevation (in steer/surface, also releases the pointer) |

## Patches

Gone (2026-09-03, #325). A grain tile is the preset: arm it and its whole block is the live
sound, edit a row and the tile keeps it. `preset_N`, `/preset`, `/preset/N`, the cloud-morph
actions and the `X` radial-morph key all went with the bank.

## Editing

| Key | Action |
|-----|--------|
| **⌘Z / Ctrl+Z** | Undo the last thing you did — a stroke with everything it made, a pin placed by hand, an unpin, an erase or a sweep. One gesture is one action; hold it and you walk back to the top of the show |
| **⇧⌘Z / Shift+Ctrl+Z** | Redo the last undone action — a stroke comes back with its recording, its trigger arming and the pin it made; a pin or an unpin comes back as it was. A new action forks history: what was undone stays undone |
| *(unbound)* | An eraser's spring-loaded hold has no key — its digit TAPS its position like every other, and the hold is that position's `palette_N_hold` on a button or pedal (2026-09-07) |
| **Delete / Backspace** ×3 | Erase all (triple-press within 800ms) |
| **`** (backtick) | Zero the cursor — the sensor's heading in sensor mode; in steer and surface the camera goes back to the front. Also the footer's ZERO button, leftmost of the cursor group |
| **~** (⇧`) | Show or hide the tool rail — the tools pill's key. `Tab` is the drawer. The shifted key rather than the bare one because **`** is tare, which is hit mid-performance |

## Display

| Key | Action |
|-----|--------|
| *(none)* | The perf monitor, high-perf render and the projector window have no keys and no actions (2026-09-09): Diagnostics, Visuals and Camera + display set them |
| **Esc** | Close topmost modal / blur focused field |

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
