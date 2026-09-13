# PALETTE-GUI.md — the hand, and the palette as quick access

> **Status: CURRENT.** Ruled by Ek 2026-09-11 and BUILT the same evening; **re-ruled
> 2026-09-12** (§ 1: the hand is back, the palette is quick access; **§ 11**, newest, wins on
> every conflict: the six hues, the glyph in its hue, one binding kind, the sticker) and rebuilt the same day —
> `js/tiles.js`, `js/midi.js`, `js/osc.js` and `css/style.css` implement it, and
> `scripts/palette-audit.js` holds it. `docs/mockups/palette-6c.png` is the picture of the tiles;
> the hand tile at their head has none yet. Where this file and the code disagree, **the code
> wins** — fix this file.
>
> Supersedes, explicitly: the five-tile slot palette, the nine-position three-verb palette, and
> `docs/KEYBOARD-SHORTCUTS.md` § "The tile screen" in its entirety. Those describe **arming**,
> which is deleted — and the 2026-09-11 "there is no hand" ruling, which lasted one day.
>
> **Three corrections made while building, recorded here rather than left to drift:**
> 1. § 5 rule 5 ("the diamond stays for bang") contradicts § 3, which retires the diamond and
>    gives the circle to bang, citing `6c`. `palette-6c.png` draws a **circle**. § 3 wins; rule 5
>    is a stale line carried from the earlier six rulings.
> 2. § 1 says migrate a stored palette to its kind's **default** verb. That breaks the factory
>    button map — see § 4's note — so the verb is DERIVED from which of the three old actions was
>    bound, and the default is only the fallback.
> 3. § 9's "new I" and "new J" are **M** and **N** in the audit: both letters were already taken
>    by the wash and the wet button when this was written.

## 1. The hand, and quick access (Ek, 2026-09-12)

> "like any computer painting app, the tool rail has the tool. you should be able to pick the
> tool and have it 'in hand'. in hand just should mean what the spacebar or click does. that
> should be always the truth. … the palette tiles and basically anything assigned a key other
> than space and left click are quick access tools."

The 2026-09-11 ruling deleted the hand outright ("there is no hand"): a palette where you pick
and space uses the pick, laid over a pedalboard where a key fires a tile, had been two models
fighting, and the pedalboard won. One day of playing it showed the cut was in the wrong place.
The two models are **not** in conflict once each owns its inputs:

| | what it is | how you choose it | what plays it | its verb |
| --- | --- | --- | --- | --- |
| **the hand** | ONE tool — a brush or an eraser | a **click** on its rail row or its strip tile | the **spacebar** and a **left-click on the sphere** — reserved, learnable onto nothing | one global switch, `handVerb`, drawn as the hand tile's shape |
| **quick access** | the palette: up to nine positions, tools, lenses and the pin pair | drag it onto the strip | its **own key, button or note** — an explicit row that follows the tile | the tile's own (§ 3, § 4) |

A quick-access play never touches the hand, and the hand never touches the strip: pen can be in
hand while `5` plays pen momentary from the strip, and that tile lights, not the hand tile. Both go
through one gate — `_held`, what is PLAYING, one play at a time from either door — and the hand
is a second variable beside it, `inHand`, persisted in `mubone_hand`.

**The hand tile** (`#handKey`, `.tile--hand`): a TILE at the head of the row, THREE tiles wide
like a spacebar, at the row's own gap (Ek, night: "make the spacebar to the left of the tile
group, tiles wide … 3 tiles wide in design, like a spacebar to look special"; it was a plate the
row's width, under the bed and then across its head, for one evening, and the palette badge that
headed the row went the same evening). It carries the in-hand tool's glyph in its engine hue with
its name beside it; its **shape is
the hand's verb** — the tile's own two radii (§ 3): the asymmetric plate is toggle, the rounded
one momentary; it lights like any tile while the hand plays. Under it, in the ledger's own cap
(§ 6), what plays it: the drawn spacebar in a wide keycap and the word CLICK in a keycap (night:
"make the left click more obvious or spell out left click" — a mouse glyph at cap size was not a
symbol anyone could read) — fixed, not learn cells. **The strip's measures** are tokens on `.palette` (night, "generally too crowded"):
tile 53 · gap 7 · inset 8 · legend row 15 with 6 above; the bed's radius `--r-card`, inset + the
tile's smallest radius. No `data-pos`, no `data-pal`, not draggable: it is not a position. Pressing it presses
the hand. A right-click flips the verb (the same gesture that cycles a tile's, § 4). Toggle is
the factory verb (the standing ruling: buttons are toggle by default, the mode is one setting
above every tool). A bang tool in hand ignores the switch. The in-hand tool is also marked on its
RAIL row (`.in-hand`: the ground lifted a step, a 2px left inset in the hue), so it can be found
in the library; the quick-access tile of the same tool wears nothing — the hand tile shows the
same glyph, and a ring there said it twice. The armed BOX is not back.

**A click, by kind.** On a tool, rail or strip: in hand. On a lens: it is a choice, so the click
installs it or turns it off, as its row always did. On a pin tile: an act with no span to hold,
so the click fires it in its verb, both edges at once. Nothing on the strip plays a TOOL from the
mouse — that is the rule kept from the morning of 2026-09-12 ("clicking never activates any more").
The `⋯` still opens the drawer and picks nothing; an open drawer follows the hand (Photoshop's
options bar); **`Tab` shows and hides the tool rail and never opens the drawer** (night: "tab should
only open the tool rail, never the drawer"; it opened the in-hand tool's for one evening), and a
quick-access fire moves nothing —
`lastFired` is deleted, because a key pulling the drawer off the tool you are working on was the
wrong rule once there was a hand again.

**Space and the left-click are unlearnable.** The keys page refuses the spacebar (`BLOCKED_KEYS`;
a learn armed when space is pressed says so and stays armed) and a stored Space row is dropped at
load. There is no `hand` ACTION row either: the two inputs are wired to it directly and that is
the whole of its interface. The phone's touch is the hand too, momentary (`mobile.js`).

What the 2026-09-11 ruling deleted stays deleted, by name: `sel`, `armTile`, the armed box, the
radio bracket, tap-to-arm, the spring-loaded hand-back, `palette_N_toggle` / `_hold` and their 18
OSC addresses, `verbsOf`'s three-verb return, the `momentary` argument on the fire. `_lastPick` →
`lastFired` → gone.

`mubone_palette` is `[{id,verb}]`, migrated once behind a stamp key on the `_PALETTE_RENUMBER_KEY`
precedent; the verb of a stored string is DERIVED from which old action was bound (correction 2),
and `midi.js` `collapsePaletteVerbsOnce` moves every binding onto `palette_N`.

## 2. Three signals, three questions

Every question a tile answers is answered by exactly one channel. This is the whole design.

| question | channel |
| --- | --- |
| **How does it fire?** | the tile's **shape** |
| **What kind of thing is it?** | the glyph's **hue** — `--eng-*`, unchanged |
| **Which thing is it?** | the **glyph** |
| **What fires it, and with which press?** | the **legend** under the tile |

`Palette.dc.html` `1a` ruled shape-says-the-kind (box tool · pill lens · bare act). That is
**reversed**: shape says the verb, and the kind was already carried by the hue. One reversal,
recorded, not a drift.

## 3. The shapes

The verbs differ along one axis — **is there a span, and is it closed** — so the shapes do too. One
53px cell, one closed outline, one property: `border-radius`. Nothing is missing from an outline and
nothing is added inside one, so no tile can look broken and none of them grows. 44px under the
820px breakpoint; gaps stay 5px.

| verb | | shape | `border-radius` |
| --- | --- | --- | --- |
| **bang** — one edge, no span | a point; nothing to hold | circle | `999px` |
| **momentary** — two edges, the span is your finger | a key you hold | plate | `var(--r-hand)` — 10px |
| **toggle** — two edges, the span is open until you close it | thrown one way, can throw back | asymmetric plate | `24px 3px 24px 3px` |

`--r-hand` is already annotated "an object you grab with a whole hand", which is the momentary
exactly. The toggle's two rounded and two square corners give it a **direction** — the one thing a
latch has and a spring does not.

**Two reversals, recorded** (Ek, 2026-09-11, `Palette.dc.html` `6c`). The **diamond is dead**: it
was distinct rather than accurate, said nothing about instantaneity, and collided with the spot
lens's reticle. And **the circle moves from toggle to bang** — "a round thing latches" was the
weaker reading of the two, since every struck pad in music hardware is round and a point has no
duration. Two rejected alternatives, for the record: an outline with its top side **missing** (the
most literal — the span is genuinely not closed — but it reads as a rendering fault behind an
instrument), and the kit's **switch drawn inside the tile** (buys an on/off signal that does not
spend the hue, but leaves toggle and momentary sharing one outline, which breaks § 2).

## 4. Which verbs a kind may have

From `verbsOf`, which keeps its name and its job and loses its shape:

| kind | allowed | default on drop |
| --- | --- | --- |
| brush, eraser (`kind: 'brush' \| 'edit'`) | momentary · toggle | **momentary** |
| lens | momentary · toggle | **toggle** |
| `pin` | bang · momentary · toggle | **bang** |
| `unpin` | bang | **bang** |

The verb is set by a **right-click on the strip tile**, which cycles through the verbs its kind
allows (2026-09-12; Ek: "it doesn't need to be on the master tile drawer sheet"). The drawer is
the TOOL's — the block every placement of that tool plays — and the verb is the PLACEMENT's, so
the drawer head's segmented control went the morning after it landed. Placing one tool in two
verbs is two drags and two right-clicks; that is the mechanism, and it is how pin ends up on the
strip twice. The hand tile's verb flips the same way (§ 1).

**A pin tile has no engine and so has no drawer**; its sheet is its head alone (`openProps`).

**A momentary is refused while a TAP is bound to that position**: the cycle skips it, and a pin
tile with only a bang left flashes instead of moving. A tap is a bang on the up edge with no second edge, so it cannot
drive a `hold` action: it would fire 127 with no 0 and latch the tile on for ever. `midi.js`
`_learnGesture` already refuses the same pairing when a key is learned; this is that rule at the
other door. It is also why the FACTORY palette is not all § 4 defaults — `BUTTON_DEFAULTS` puts
button 1 **tap** on position 2, so position 2 ships as a **toggle** while a brush's drop default is
momentary. Change one and change the other.

`palette_N`'s ACTIONS `type` follows the verb through a **getter**: a momentary tile is a `hold`
taking `int 0|1`, a bang or a toggle a `trigger` taking a bang. Five places read `.type`, one of them
`osc.js`'s release-edge guard, and a getter keeps all five right with no call-site change.

## 5. The rulings

**2026-09-11**, the six, as they stand after 2026-09-12:

1. ~~A left-click on the sphere does nothing.~~ **Reversed 2026-09-12**: it is the hand's press
   (§ 1). `js/brush.js` is untouched either way — `gesturePress` never knew who called it.
2. ~~`Tab` and the properties footer follow the last tile fired.~~ **Reversed**: the drawer follows
   the hand, and `Tab` (shifted or not) shows and hides the TOOL RAIL, never a drawer (the night's
   ruling; it opened the in-hand tool's drawer for one evening, and `⇧Tab` the lens's). The ⋯ on a
   row is the drawer's only door.
3. ~~A rail click places nothing~~ — still true — ~~and has no click behaviour at all~~.
   **Reversed**: a rail click takes the tool in hand. Dragging is still the only way onto the strip.
4. **A delayed gesture is drawn** (§ 7). Stands.
5. ~~The diamond stays for bang.~~ Superseded by § 3 (correction 1): the circle is the bang.
6. ~~Space is a binding like any other and carries no privilege in code.~~ **Reversed**: space is
   the hand's and cannot be a binding.

**2026-09-12**, the new ones:

7. **The hand is one tool, picked by a click, played by space and the sphere's click, in one
   global verb.** The palette is quick access. § 1.
8. **A key stays with its tile.** Every palette key is an explicit row, seeded from the factory
   set once (1 … 5 on the five, ↑ · ↓ on the pins), carried through every place, move and remove
   by `S._paletteReordered`. **A drop takes the next free digit** — the lowest of 1 … 9 no key row
   uses. (The morning of the same day had ruled "don't auto find a key"; the afternoon reversed
   it, and the afternoon stands.)
9. **The legend is a ledger, and every row is a learn cell.** § 6.
10. **The verb is the placement's, set on the strip** (§ 4), not in the drawer.

A phone tap is the hand's press, momentary — a phone has no keys, and without it the browser demo
cannot be played at all.

## 6. The legend — a ledger, and a learn cell

> **Superseded by § 11.4–11.6 the same evening:** the ledger is gone; the binding is ONE sticker
> on the tile's bottom-left corner, of the one kind the keys page shows, and that sticker is the
> learn cell (click to relearn, right-click to clear; an unbound tile wears an empty one, a dash,
> and is learned from it). What follows is the ledger as it stood for the afternoon, kept for the parts § 11
> leaves standing: the delay mark, the source colours, the drawn spacebar.

**One ROW per binding kind the keys page's three "on tiles" switches show** (2026-09-12) —
key, then button, then MIDI note — each `--pal-leg-h` (12px) tall, the bed reserving that many
lines (`--pal-leg-rows`, written on the bed by `render()`; `npm run audit:align` "the palette
legend" measures it, and palette-audit § O proves the bed grows exactly 12px per row). The key
row is the factory default; the switches are under the column titles on Settings → Keys and MIDI.
A row with nothing bound is a dash.

**Every row is the keys page's learn cell, brought to the tile.** Click it and the learn for that
kind is armed on that position (`S._paletteLearn` sets the page's own `keyLearningId` /
`buttonLearningId` / `midiLearningId`; the page's recogniser finishes it, so there is no second
learn path): the row says `…` and pulses, the next key, button or note of that kind lands there
with its gesture, and the row shows it. Click it again or `Esc` to cancel; right-click to clear
that kind's binding. The spacebar pressed into a key learn binds nothing and says why (§ 1).

Each row is one line **under the tile**, centred on its column, in the strip's bed and outside the tile's outline
(2026-09-11; it was inside the cell until then, and could not be: the glyph overlapped the line by
3.4px, and on a bang tile the circle's chord at the line's height is ~31px against a legend that
measures 54px — `7 3 tap ···` — so the round tiles clipped both ends). The strip reserves the line
(`--pal-leg-h` 12px under a 4px gap); the line spans the column plus 3px each side and is never
clipped. Enforced by `npm run audit:align` "the palette legend": below the outline, inside the bed,
≥ 3px between adjacent legends' ink.

```
[source] [gesture]? [delay]?
```

| part | type | colour |
| --- | --- | --- |
| source — a key name, a button number, a note, **drawn as a CAP** (2026-09-12, evening: "something that denotes that it's a reference for a key"): a `<kbd>` keycap, radius 2, the row's 15px, one hairline in the TILE's border colour (`--border-medium`, night: "the same border colour"), no fill; a **keycap** for a key (letters uppercase; the arrows and editing keys as their glyphs, `KEY_GLYPH`), a **round cap** for the instrument's button, the keycap in grey for a note; an empty row is an empty **dashed** cap | 11px weight 400 inside the cap | key `--text-bright` · button `#dd9a6a` (ember) · MIDI `#9d978e` |
| gesture — the app's own word, `GESTURE_LABEL` | 9.5px | `#9d978e` |
| delay — `···` | 9.5px | `#c9a06a` |

**Blank means press.** `GESTURE_LABEL.press` is already the empty string, so the drawing and the
code agree with no translation table. `tap`, `long`, `×2`, `×3` are verbatim; **`extra long`
renders `xlong`** on the tile, and that abbreviation lives here and nowhere else.

A tile may carry more than one source — exclusivity is one **verb** per tile, not one input. A
learned key and a MIDI note read the same six gestures as a button, so `Q long` is as legal as
`btn 1 long` and the legend does not care which it is.

**The spacebar is drawn, not typed.** `␣` (U+2423) is not in `fonts/Urbanist-latin.woff2` and
renders from a fallback face at the wrong advance. Use the 15×6 stroke mark:
`<path d="M2 2v5h20V2">`, `stroke-width 1.8`, `viewBox="0 0 24 10"`. Since 2026-09-12 it is drawn
on the PLATE alone — a tile never wears a spacebar, because space is the hand's.

## 7. The delay mark, and what it found

Binding `×2` or `×3` anywhere on an input makes that input's **tap** wait for the double window
before it can fire (`midi.js`: the tap timer only runs on a button that has a `×2` or `×3` to count
for). That is invisible today, and it is a timing change to a gesture the performer did not touch.

So: **`···` after the gesture, on the tile that is slowed**, present only while a sibling binding
actually causes the delay.

This is not hypothetical, and it is **measured**. `BUTTON_DEFAULTS` shipped the trap until
2026-09-12: pin was button 3 **tap** and unpin button 3 **×2**, so out of the box pinning with
your thumb was a delayed gesture. **Pin is button 3's PRESS now** (Ek: "as i right click thru pin it
should have 3 states avail … it should have momentary"): a tap has no up edge and the model refuses
a momentary under it, so the factory pin tile could never take its third verb; a press fires
undelayed, holds a momentary path, and the ×2 beside it takes the press's pin back before unpinning
(RULINGS: the swallow is general). The mark still draws for any tap learned beside a ×2. Five
presses each, timed from the UP edge to the recogniser's own `button-gesture` event:

| binding | fire latency |
|---|---|
| pin on btn 3 tap, unpin on btn 3 ×2 (the factory set until 2026-09-12) | **123.6 · 124.3 · 124.6 · 124.9 · 127.8 ms** |
| `palette_2` on btn 1 tap, nothing else on btn 1 | **0.1 · 0.2 · 0.2 · 0.2 · 0.3 ms** |

~125 ms, the 120 ms tap window plus timer slop. Only a TAP is slowed — a press fires on the down
edge and never waits — and only the slowed tile wears the mark, never the ×2's own.

**A second trap surfaced while measuring it.** `renumberPaletteOnce` ran on a FRESH profile, where
`loadButtonMappings` had just fallen back to `BUTTON_DEFAULTS` — written in today's numbering — and
shifted every factory button down a position: button 1 landed on the lens and the pin pair on 6 and
5. It had done that since the renumber landed, invisibly, because nothing read the factory button
map back until this mark needed to know what sat on button 3. Both one-shot migrations now skip a
map the profile never stored.

## 8. States

`armed` is gone. The strip draws **lit** — sounding, or on. **In hand** is the hand tile itself at
the row's head (2026-09-12); the rail row of that tool is marked, and no quick-access tile is.

| state | face |
| --- | --- |
| rest | `1px solid var(--border-medium)` (2026-09-12; the outline vanished against the bed at 10 %), ground `rgba(255,240,224,0.035)` |
| **in hand** | the hand tile at the head of the row; the RAIL row takes `--surface-1` and a 2px left inset in the hue; no mark on a quick-access tile |
| **lit** | engine hue at 18–20%, `inset 0 0 0 2px` the hue; a *sounding tool* adds `0 0 18px` the hue at 18% |
| hover | ground to `--surface-1`, glyph to `--text-bright` |
| press | `scale(0.955)`, 40ms — unchanged |
| bang fired | the existing 180ms flash |

A toggle's lit is "on". A momentary's lit is "while down". A bang has no lit, only the flash.

## 9. The audit — `scripts/palette-audit.js`

The sections, as they stand after 2026-09-12 (the letters are the script's; the file's header
lists them):

| § | holds |
| --- | --- |
| A | the factory seven on 1 … 5 · ↑ · ↓; nothing armed; the hand tile heads the row — first child, a tile's box on the tiles' line, 10px off the first quick-access tile, not a position, not draggable, no badge — shows the hand, draws the toggle shape, and wears the spacebar and mouse keycaps under it; the in-hand mark on the rail row alone |
| C | Tab shows and hides the tool rail and never opens a drawer; the drawer follows the hand and a fire does not move it; a rail click and a strip click take a tool in hand; the ⋯ leaves the hand alone; a lens tile's click installs; a pin tile's click fires |
| D | placing by drag; **a drop takes the next free digit; a move carries the key; a removal frees it**; nine is full; every tool may leave |
| E | the keys are explicit rows; each fires in its tile's verb; one play at a time; no hand-back; unbound is a dash sticker |
| F | the lens is a state, the cap is no lens on |
| H | **the hand**: space and the sphere's click, toggle then momentary after the hand tile's right-click, its shape following; the hand tile is a spacebar; space unlearnable, a stored Space row dropped; a quick-access play stays the tile's verb, flipped by the strip's right-click, momentary refused under a TAP |
| I · J · K · L | the wash, the wet button, the `+`, keys and notes through the recogniser (a fire leaves the drawer where it was) |
| M | shape is the verb, flipped by right-click |
| N | **the sticker is the truth** (§ 11.5–11.6): one sticker per position of the one kind shown, a dash when unbound; source + gesture + delay; long/xlong a bar; a note bare; nowrap and flex-shrink 0; nothing wider than the tile; the hand tile's sticker draws the spacebar |
| O | **the sticker is the learn cell**: one kind at a time, the bed 71px whatever the kind; click relearns, right-click clears, Esc cancels, a chord is refused |
| P | **hue is identity** (§ 11.2–11.3): every glyph its family's `--eng-*`, the pin tiles bone, nothing `--text-subtle`, rest `surface-1` |

Ek's rule 6 applies throughout: force each state and read it back. An empty diff proves only that
nothing visible moved.

## 10. Files

| file | work |
| --- | --- |
| `js/tiles.js` | the model (§ 1: `inHand`, `handVerb`, `handDown` / `handUp`, `pickHand`, the hand tile), the shapes (§ 3), `verbsOf` (§ 4), the legend rows and caps (§ 6), the strip's clicks, the space and sphere wires |
| `js/midi.js` | the 9 palette actions with `type`/`fmt`/`tip` as getters over the verb; the factory-key seed and `S._paletteReordered` (rulings 8); `S._paletteLearn` and its three siblings (§ 6); space refused and dropped |
| `js/mobile.js` | the touch is the hand's press |
| `js/osc.js` | 9 addresses; `/palette/N` takes `1\|0` for a momentary tile and a bang otherwise |
| `css/style.css` | § 23 the tiles, § 24 the hand: the hand tile, the rail's in-hand mark, the ledger rows and the caps |
| `index.html` | the three "on tiles" switches under the keys page's column titles |
| `scripts/palette-audit.js` | § 9 |
| `docs/KEYBOARD-SHORTCUTS.md` | § "The tile screen" |
| `docs/mockups/palette-6c.png` | the tiles as drawn (the hand tile and the caps are not in it) |

## 11. Rulings after the brief (2026-09-12, Ek) — newest, wins on conflict

Picture: `docs/mockups/palette-10a.png`. Source of the mock: `Palette.dc.html` `10a`.

### 11.1 The hand is back — § 1 and § 5.1–5.2 are partly reversed

Not arming. **One tool is in hand**, picked by a *click* on its rail row or its strip tile, and
played by the **spacebar and a left-click on the sphere**. Tiles still fire from their own bindings
directly — both models now coexist, cleanly split. Already built; `js/tiles.js` header is correct.

| § | was | now |
| --- | --- | --- |
| § 1 "There is no hand" | `sel` and the hand deleted | a hand exists, as a **tile at the head of the strip**, 3 tiles wide (`173px` = 3 × 53 + 2 × 7) |
| § 5.1 | a sphere click does nothing | a left-click on the sphere **plays the hand** |
| § 5.2 | Tab / props follow `lastFired` | **superseded the same night**: `Tab` shows and hides the TOOL RAIL and never a drawer; the drawer follows the hand; `lastFired` is deleted (§ 5.2 below) |
| § 5.3 | a rail click places nothing | **a rail click takes the tool in hand** (it still never places) |

Still true from § 1: no `palette_N_toggle` / `_hold` (27 → 9 actions), one verb per position,
`verbsOf` returns the kind's allowed verbs and its default, `mubone_palette` → `[{id,verb}]`.
**Correction (built, 2026-09-11 evening, "One tile, one verb"):** this paragraph as first written
said those were still unbuilt; they were already in the tree when § 11 was ruled. Nothing remained
to do for them.

### 11.2 Engine colours — replace `--eng-*`

Current tokens are three dusty warm mid-tones inside a 50° arc; these are six quadrants.

| family | hex | note |
| --- | --- | --- |
| source | `#4aa3e8` | azure — the only blue |
| lens | `#5fbf9a` | sea green, the sage lifted; still the "this is on" hue |
| tape | `#f2569e` | hot pink — what line/slice/loop/dub already are in `TILE_DEFS` |
| grain | `#e8a030` | gold — dots' own colour, unchanged |
| erase | `#b07c8f` | mauve — tape's hue drained |
| pins | `#cfc7bc` | bone — a pin is not an engine, it is what engines commit into |

**Ember owns 25–40°** (`--accent-action`, `--leg-button`), so only one family may be warm and grain
has it. All six clear 5:1 on the bed. Per-tool `TILE_DEFS.c` values become tints of their family.

### 11.3 The glyph uses the hue — hue is identity, brightness is state

`tileHTML` already writes `--c` on every tile and then `.palette .tile { color: var(--text-subtle) }`
paints every glyph `#9d978e`. **Eight hues computed, eight grey glyphs drawn.** Ruled: the glyph takes
`var(--c)`. Hue says *which engine*, always; **state moves to brightness** — lit is the hue at 20 %
fill with a 2 px border and a `0 0 20px` glow in the hue. This overrides the "an engine hue answers
*this is on*" note at `style.css:4951`.

Free and separate: rest is `transparent` today with `surface-1` as hover, so an untouched strip is a
wireframe. **Rest becomes `surface-1`, hover `surface-3`.**

### 11.4 One binding kind at a time

The keys page's three switches become **one choice** — key *or* button *or* note: the kit's
segmented control in a row above the bindings table, "Shown on the palette" (`#legendKindSeg`,
`mubone_legend_kind`; built 2026-09-12, night). Consequences: **the ledger is deleted** — no rows, no `--pal-leg-rows`, no reserved
height, no `padding-bottom` for it; a tile carries **one sticker or none**; and the round-cap-for-a-
button shape rule goes, because with one kind on the strip there is nothing to disambiguate. Hue
alone carries the kind: key `--text-bright`, button `#dd9a6a`, note `#9d978e`.

Bed: **92px → 71px** (8 pad + 1 border + 53 tile + 8 pad + 1 border).

### 11.5 The binding is a STICKER, bottom-left

Same device as wet and pin, which were right all along. Every shape, **including the bang circle** —
a circle holds a corner sticker by 5.1px where a plate holds it fully; Ek ruled that acceptable, so
there is **no per-shape exception** and one offset everywhere.

```
position: absolute; left: -5px; bottom: -5px; z-index: 2;
display: flex; flex: none; white-space: nowrap;      /* ← see 11.6 */
align-items: center; justify-content: center;
height: 18px; min-width: 18px; padding: 0 5px; box-sizing: border-box;
border-radius: 999px;                                 /* circle at 1 char, stadium beyond */
background: var(--bg-app); border: 1px solid var(--border-medium);
font-size: 11px;
```

Corners: **wet top-left, pin top-right, binding bottom-left.** The gesture rides *inside* the
sticker at 9.5px in `--leg-midi`; a plain press has no suffix (`GESTURE_LABEL.press` is `''`). The
delay mark `···` (§ 7) still applies, after the gesture. The spacebar is the drawn 15 × 6 mark, not
`␣`. The hand tile's own legend is two stickers — the spacebar mark and the word `click`.

**An unbound position still wears the sticker** (Ek, 2026-09-12, later: "when i right click to
remove a binding from a palette tile, it should have a hyphen thru the sticker but it just
disappears so i have no way to bind a new key via the palette tile"): the sticker IS the learn
cell, so with nothing of the shown kind bound it is an empty one — a dash, `–`, in
`--text-faint` on `--border-faint` (`.tile-bind--none`) — and a click on it arms the learn as on
any other. Right-click on a bound sticker clears it to the dash; it never disappears.

### 11.6 The overflow trap — this one will bite

The sticker is `position:absolute` at an offset, so it is **shrink-to-fit**. Left at
`white-space:normal` with the default `flex-shrink:1` it does **not** overhang — it silently
compresses the label to min-content, and nothing clips, so nothing looks wrong. Set
`flex:none; white-space:nowrap` **on the sticker and on its gesture span**.

Measured in a real 53px tile, at the real type stack:

| sticker | width | |
| --- | --- | --- |
| `3 xlong` — any button, any gesture | 48.1 | fits |
| `n 127 ×2` | 53.1 | 0.1 over |
| `n 127 tap` | 57.7 | over |
| `n 127 xlong` | 66.0 | over |
| `127 tap` — `n ` prefix dropped | 49.2 | fits |
| `127` + bar — and gesture as a mark | 45.8 | fits |
| `Escape xlong` | 77.8 | over |
| `⌘ctrl⇧Escape xlong` | 115.1 | two tiles wide |

**Two changes clear every note:** drop the `n ` prefix from `bindingsOf`'s note label (the hue says
the kind, and with one kind on the strip the letter is redundant), and draw `long` and `xlong` as a
**bar** rather than a word. Buttons and digit keys were always comfortable.

**Open, needs Ek:** a learned key with a long name. Truncating to three characters plus modifiers
still leaves 80.9px. Either the sticker truncates hard to ~4 characters with the full name in the
tooltip, **or modified keys are not offered for palette positions at all** — nine positions, ten
digits, and a `⌘ctrl⇧` chord on a performance tile is arguably a mis-binding. My lean is refusing it.

### 11.7 Audit — additions to § 9

- **§ I (shape is the verb)** as § 9 states, unchanged.
- **§ J** rewrites: the legend is now one sticker, not a ledger row. Assert exactly one sticker per
  position — a dash with no parts when unbound; assert its computed `white-space` is `nowrap` and
  `flex-shrink` is `0`; assert no sticker's rendered width exceeds 53px for any binding the app can
  emit. Delete every assertion about `--pal-leg-rows` and dashed empty caps.
- **new § K (hue is identity)**: every tile's glyph computed `color` equals its family's `--eng-*`,
  and no tile renders `--text-subtle`.
