# PALETTE-GUI.md — the palette bar, after the hand

> **Status: CURRENT.** Ruled by Ek 2026-09-11 and BUILT the same evening — `js/tiles.js`,
> `js/midi.js`, `js/osc.js` and `css/style.css` implement it, and `scripts/palette-audit.js`
> holds it (146 checks). `docs/mockups/palette-6c.png` is the picture. Where this file and the
> code disagree, **the code wins** — fix this file.
>
> Supersedes, explicitly: the five-tile slot palette, the nine-position three-verb palette, and
> `docs/KEYBOARD-SHORTCUTS.md` § "The tile screen" in its entirety. Those describe **arming**,
> which is deleted.
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

## 1. There is no hand

Arming was one model laid over another. A palette, where you pick a tool and space uses it; and a
pedalboard, where a key fires a tool directly. Ek plays the second, and every customisation built
since — learned keys, button gestures, MIDI, OSC — serves the second. So the first goes.

**A tile is one thing in one verb, and the position is its binding.** Nothing is selected, nothing
is held in a hand, and space is an ordinary learned key pointed at whichever tile is played most.

What this deletes, by name:

| gone | why |
| --- | --- |
| `sel`, `armTile`, `selectedTile`, the "`sel` is always a tool on the palette" invariant | nothing is armed |
| the armed box, the ember `skin-arm` keyframe, `.palette .tile.armed` | no state to draw |
| the radio bracket (never shipped) | the group it grouped does not exist |
| tap-to-arm in `_paletteTap` | a tap **fires**; that is the only thing a tap does |
| spring-loaded hand-back (`slotUp` restoring the armed tool) | there is nothing to come back to |
| `palette_N_toggle` and `palette_N_hold` — 18 of the 27 palette actions, and the 18 OSC addresses with them | one verb per position, so one action per position |
| `verbsOf`'s three-verb return | returns the position's **one** verb |
| `_lastPick` | becomes `lastFired` (§ 5) |
| `S._paletteActivate`'s `momentary` argument | the verb is the tile's, not the caller's |

`mubone_palette` changes shape: `["wide","pen",…]` → `[{id:"wide",verb:"toggle"}, …]`, once, behind
a stamp key on the `_PALETTE_RENUMBER_KEY` precedent.

**The verb of a stored string is DERIVED, not defaulted** (correction 2). A stored `palette_N_hold`
binding meant momentary and a `palette_N_toggle` meant toggle, so the migration reads the three maps
and takes the verb from whichever was bound — `_hold` beats `_toggle` when both were, because a
position could carry two verbs before and carries one now, and the precedence is stated rather than
guessed. The kind's default (§ 4) is the fallback when neither was bound. Defaulting outright would
have put a **momentary under button 1's tap**, which cannot work — see § 4.

Nothing is lost either way: `midi.js` `collapsePaletteVerbsOnce` MOVES every binding on all three
ids onto `palette_N`, and a tile carrying two sources is legal (§ 6). One stamp per side, read
before written, so the two migrations cannot race.

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

The verb is set in the tile's **drawer head**, as the kit's "which one?" shape — a segmented
control, 24 tall, radius 2, selected segment **neutral, never ember** (`INSTRUMENT-GUI § 3`). It
offers only that kind's verbs. Placing one tool in two verbs is two drags and two settings; that is
the mechanism, and it is how pin ends up on the strip twice.

**A pin tile has no engine and so had no drawer at all.** Its sheet is now its HEAD alone, carrying
the verb and nothing else, and the door to it is firing it — § 5.2 makes `Tab` follow the last tile
fired, every tile.

**A momentary is refused while a TAP is bound to that position**, and the segment is inert rather
than refusing after the click. A tap is a bang on the up edge with no second edge, so it cannot
drive a `hold` action: it would fire 127 with no 0 and latch the tile on for ever. `midi.js`
`_learnGesture` already refuses the same pairing when a key is learned; this is that rule at the
other door. It is also why the FACTORY palette is not all § 4 defaults — `BUTTON_DEFAULTS` puts
button 1 **tap** on position 2, so position 2 ships as a **toggle** while a brush's drop default is
momentary. Change one and change the other.

`palette_N`'s ACTIONS `type` follows the verb through a **getter**: a momentary tile is a `hold`
taking `int 0|1`, a bang or a toggle a `trigger` taking a bang. Five places read `.type`, one of them
`osc.js`'s release-edge guard, and a getter keeps all five right with no call-site change.

## 5. The six rulings (Ek, 2026-09-11)

1. **A left-click on the sphere does nothing.** A click is how you reach the UI; the tiles are the
   instrument. `js/brush.js` `gesturePress` loses its pointer path.
2. **`Tab` and the properties footer both follow the last tile fired.** One rule, one variable
   (`lastFired`). `⇧Tab` still opens the installed lens's drawer.
3. **A rail click places nothing.** Dragging is the only way onto the strip, so a rail row has **no
   click behaviour at all**: it is a drag source with a `⋯`. Delete the load-and-arm path.
4. **A delayed gesture is drawn** (§ 7).
5. ~~The diamond stays for bang.~~ **Superseded by § 3** (correction 1): the diamond is dead and
   the circle is the bang. `palette-6c.png` is the picture.
6. Space is a binding like any other and carries no privilege in code.

A phone tap is the one pointer path left, wired to position 1 — a phone has no keys, and without it
the browser demo cannot be played at all.

## 6. The legend

One line **under the tile**, centred on its column, in the strip's bed and outside the tile's outline
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
| source — a key name, a button number, a note | 10.5px | key `--text-bright` · button `#dd9a6a` (ember) · MIDI `#9d978e` |
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
`<path d="M2 2v5h20V2">`, `stroke-width 1.8`, `viewBox="0 0 24 10"`.

## 7. The delay mark, and what it found

Binding `×2` or `×3` anywhere on an input makes that input's **tap** wait for the double window
before it can fire (`midi.js`: the tap timer only runs on a button that has a `×2` or `×3` to count
for). That is invisible today, and it is a timing change to a gesture the performer did not touch.

So: **`···` after the gesture, on the tile that is slowed**, present only while a sibling binding
actually causes the delay.

This is not hypothetical, and it is **measured**. `BUTTON_DEFAULTS` ships the trap: `palette_7`
(pin) is button 3 **tap** and `palette_6` (unpin) is button 3 **×2**, so out of the box pinning with
your thumb is a delayed gesture. Five presses each, timed from the UP edge to the recogniser's own
`button-gesture` event:

| binding | fire latency |
|---|---|
| `palette_7` on btn 3 tap, `palette_6` on btn 3 ×2 (the factory set) | **123.6 · 124.3 · 124.6 · 124.9 · 127.8 ms** |
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

`armed` is gone, so the strip has one state worth drawing and it is **lit** — sounding, or on.

| state | face |
| --- | --- |
| rest | `1px solid rgba(255,240,224,0.10)`, ground `rgba(255,240,224,0.035)` |
| **lit** | engine hue at 18–20%, `inset 0 0 0 2px` the hue; a *sounding tool* adds `0 0 18px` the hue at 18% |
| hover | ground to `--surface-1`, glyph to `--text-bright` |
| press | `scale(0.955)`, 40ms — unchanged |
| bang fired | the existing 180ms flash |

A toggle's lit is "on". A momentary's lit is "while down". A bang has no lit, only the flash.

## 9. Audit changes — `scripts/palette-audit.js`

The sections are independent, so this is surgery, not a rewrite.

| § | change |
| --- | --- |
| A | factory list unchanged in spirit; assert **no tile is armed** and no `.armed` element exists |
| B | **delete** — "loading" was the rail click, which no longer acts |
| C | drawer: `Tab` follows `lastFired`, not `_lastPick`; `⇧Tab` unchanged; no palette tap opens a drawer |
| D | placing: unchanged, plus **the verb is set at the drop** from § 4's defaults, and the same tool may appear twice in two verbs |
| E | **rewrite** — the digits fire by position according to the tile's verb; no `palette_N_hold`; no hand-back; assert `sel` does not exist |
| F | lens and cap: unchanged (a lens tile toggles; no lens on is the cap) |
| G | **delete** — "lit, and tool keys fire" tested the armed box outranking the lit fill, and there is no armed box |
| H | **rewrite** — the main button is not a mode: a tile's verb is the binding's, and a momentary gesture ends when its input goes up. Keep the eraser's `GESTURE_LONG_MS` erase-all check |
| **new I** | **shape is the verb** — computed `border-radius` is `999px` on every bang tile, `--r-hand` on every momentary and `24px 3px 24px 3px` on every toggle; flip a tile's verb in its drawer and read the shape back off the strip. No tile may share an outline with a different verb |
| **new J** | **the legend is the truth** — the rendered legend equals source + `GESTURE_LABEL` + delay for every bound input; blank suffix iff `press`; `···` iff a sibling `×2`/`×3` delays it |

Ek's rule 6 applies to both new sections: force each state and read it back. An empty diff proves
only that nothing visible moved.

## 10. Files

| file | work |
| --- | --- |
| `js/tiles.js` | the model (§ 1), the shapes (§ 3), `verbsOf` (§ 4), the legend (§ 6), `lastFired` (§ 5.2) |
| `js/midi.js` | 27 palette actions → 9, with `type`/`fmt`/`tip` as getters over the verb; `_ACTIVATES` narrowed; `bindingsOf` for the legend and the delay; the collapse stamp; `BUTTON_DEFAULTS` on the bare ids |
| `js/osc.js` | 27 addresses → 9; `/palette/N` takes `1\|0` for a momentary tile and a bang otherwise, which the generic O2 guard now decides from the verb |
| `scripts/engine-audit.js` | it reached every tile by a rail click, which no longer acts — the `⋯` is the door |
| `js/brush.js` | `gesturePress` loses the pointer path (§ 5.1) |
| `css/style.css` | append-only: the three shapes, the legend, the delay mark; delete `.palette .tile.armed` and `skin-arm` |
| `scripts/palette-audit.js` | § 9 |
| `docs/KEYBOARD-SHORTCUTS.md` | § "The tile screen" rewritten; banner the retired arming vocabulary |
| `docs/mockups/palette-6c.png` | the picture this file describes |
