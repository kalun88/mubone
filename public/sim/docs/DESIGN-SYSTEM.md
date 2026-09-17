# Design system — the aesthetic, and the numbers that carry it

> **Status: CURRENT** — written 2026-08-30, describing the tile screen as built (branch `brush-model`, now `main`).
> **Read this before touching `css/`, `index.html`'s markup, or anything that draws the cursor.**
> Verify with `npm run audit:align`, which asserts most of § 5 against the running app.
>
> This document has two halves and they are not interchangeable. **§ 1–3 are Ek's taste** — the
> standing brief, in his own words, which does not expire when a screen is redesigned. **§ 4–6 are
> the current system** — tokens, grids and contracts, which are true until someone measures
> otherwise. When they disagree, § 1–3 wins and § 4–6 is what needs changing.

> **Read this first.** § 1–3 are Ek's brief and do not expire: flat, no gradients, simplicity as the tie-breaker, symbol and colour over text, accuracy as part of the aesthetic, and § 3 — *measure, never assert* (`npm run audit:align`). Read § 1–3 for any UI change. Go into § 4 (tokens, the warm text ramp) only when adding a colour or size, and § 5 (the footer's one-row grid, the rail's half-moon / half-square selection shapes, the settings type contract) only when touching that geometry. § 6 is workflow. Written on branch `brush-model`, which is `main` now.

---

## 1. The brief, in Ek's words

Quoted rather than paraphrased, because the paraphrases drifted:

- *"a real performer instrument, artsy… take a look at the best minimalist design rules"*
- *"all of this needs to be lightweight. zippy. it's a performance instrument"*
- *"i generally prefer flat design no gradients"*
- *"i'm always leaning for simplicity"*
- *"i think generally the text overall can afford to be bigger"*
- *"an elegant symbol/colour based solution that is expertly designed, clever and builds muscle
  memory, not much text and not busy… and above all accurate"*
- *"the alignment and center need to be clean across the whole app"*
- *"i don't want competing sources"*

The palette direction he chose, from four offered, was **warm analogue**.

## 2. What those actually mean here

**Performance instrument, not an app.** Everything on screen is either the material or a control
you reach for mid-set. A control you have to *read* before you can use it has failed; a control
you find by shape, position and colour has not. This is why the footer's mute is one icon with two
faces rather than a labelled two-segment capsule, and why the tool rail says how it selects with a
shape instead of a word.

**Flat means flat.** No gradients as decoration, no glows, no inset "depth" bloom. The sphere is
the only thing in the instrument with depth in it; anything else claiming depth competes with it.
A solid ground and a hairline do every job a shadow was doing. (The one surviving inset shadow is
the *seated* state of a radio row, where it means "installed", not "elevated".)

**Simplicity is a tie-breaker, not a slogan.** When a mark and no mark both work, no mark wins.
The cursor's engine cap arc was removed not because it was ugly but because colouring the ring
that was already there did the same job with one fewer object.

**Accuracy is part of the aesthetic.** *"the radius should erase what it erases and look like it."*
A drawing that is prettier than the truth is a bug. Two real ones, both found this way: the erase
band was drawn from the last tick's start to the **live cursor** rather than to the sweep's own
end, so it grew the faster you moved; and it was drawn as a straight screen line when the sweep
runs along a **great circle**, so a fast flick drew a bar across the sphere. If you are drawing
something the engine computed, publish the engine's own values and draw *those* — never re-derive.

**One fact, one owner, one display.** The footer's sensor block still resolves sensor state, but
it is `hidden`; the header pill *mirrors* what it resolved. Two listeners for one question is two
answers that are free to disagree. Same reason the pills open the settings **page** rather than
the sensor modal — the shell and the modal host the same DOM.

**Bigger, and up the ramp — not louder.** "Text can be bigger" was never "text can shout". The
brand mark went *down* two steps and got tracked out. Weight, tracking and colour separate roles;
size separates hierarchy levels, and there are five of them, not nine.

## 3. The one rule that matters most

**Do not claim something is aligned, centred, consistent or balanced without measuring it.**

This is here because it was broken six times in two days, and every time the cause was structural
rather than cosmetic — invisible by eye, obvious in numbers:

| what was claimed | what was true |
| --- | --- |
| the footer is aligned | 7 caption baselines spanning 15px |
| MUTE matches DRY | MUTE 1.6px low — exactly half the box-height difference |
| the slider tick is centred | the tick was 2.3px tall |
| the groups sit side by side | 105px of overlap; PH and OUT printed under DRY VOL |
| the footer has equal air | 18.4 below, 32.4 above everything but the tallest group |
| the type contract covers the pages | two pages matched none of its selectors |

The method that works: **read the live values, change one thing, read them again.** The dev bridge
(§ 6) makes that a few seconds' work. `npm run audit:align` makes it repeatable.

Two CSS gotchas cost a measurement each and will cost another:

- **An inline `style="font-size:…"` outranks every stylesheet rule.** Six of them in `index.html`
  silently beat a correct contract. `grep 'style="[^"]*font-size'` before concluding a rule is wrong.
- **Specificity is not reading order.** `.settings-host .in-settings .grain-seg .grain-seg-btn` is
  four classes and beats a three-class rule however far down the file it sits. Being last is not
  winning.

---

## 4. Tokens

> Everything in § 4–6 governs the app **outside** `#settingsModal`. Inside the settings
> dialog the standard is `docs/SETTINGS-GUI.md` (implemented by `css/settings-gui.css`) —
> its own row model, kit geometry, type sizes and casing. Where the two disagree in there,
> that file wins.

All in `css/tokens.css`, which is the single source of truth. Never write a raw colour, size or
radius into `style.css`.

**The rem base** — `--ui-base-px: 16`. It lived in three places (a CSS rule, `BASE_FONT_PX` in
`ui-viz.js`, a literal in `index.html`'s boot script) and both JS copies write an inline
font-size, so raising the CSS one alone did nothing. All three read this now. `uiScale` multiplies
it. **This is the one lever that grows the whole instrument together.**

**Surfaces** — warm-shifted near-blacks, hue ~40°, chroma ~0.005. `--bg-app: #0b0a09`. Translucent
overlays are warm white `rgb(255,240,224)`, never pure white: a pure-white hairline over a warm
black reads faintly blue, which is how "minimal dark UI" ends up cold by accident.

**Text** — a monotonic warm ramp, each step solved for a measured contrast ratio against
`--bg-app`, from `--text-highlight` (18.5:1) down to `--text-faint` (2.7:1). Warming a grey
*lowers* its luminance (green carries ~72% of it), which is why the first warm ramp lost contrast
at every step and had to be re-solved. **If you change a text colour, recompute the ratio.**

**Type** — five sizes doing real work:

| token | rem | px @16 | role |
| --- | --- | --- | --- |
| `--fs-nano` | 0.64 | 10.24 | quiet text on a settings page |
| `--fs-eyebrow` | 0.69 | 11.04 | THE uppercase micro-label; settings page body |
| `--fs-body` | 0.78 | 12.48 | body text inside panels; a page lede |
| `--fs-control` | 0.88 | 14.08 | standard control label; settings nav |
| `--fs-md` | 0.98 | 15.68 | primary buttons, the brand mark |
| `--fs-xl` | 1.12 | 17.92 | settings page titles |

**Tracking** — `--ls-widest: 0.18em` pairs with `--fs-eyebrow` and is the instrument's *engraved
lettering*: it is what SENSOR, IN, GATE, DRY, AZ, EL, RO and MUTE are set in. That pairing is a
house style, not a default — use it wherever a caption names a control.

**Radius** — three steps plus one. `--r-1: 2px` controls, `--r-2: 3px` grouped sets, `--r-3: 4px`
icon buttons, and `--r-card: 12px` for **the hero surfaces only**: the canvas wrapper and the
settings dialog. It was 0/2/3/5/20 and the 20 fought every 2px control beside it.

**Accents** — one family, derived from `SPHERE_PALETTE`: `--accent-action` ember `#e07b3c`,
`--accent-lock` `#7fa8ae`, `--accent-sensor` `#a793c0`, `--accent-sweep` `#9db87e`,
`--accent-danger` `#cc6a55`, `--accent-warn` `#c99552`.

**Engine hues** (`--eng-*`) are the colour language: source `#4aa3e8`, lens `#5fbf9a`, tape
`#f2569e`, grain `#e8a030`, erase `#b07c8f`, pins `#cfc7bc`, none `#857f76`. **These are
load-bearing.** The rail tile, the engine sheet and the cursor all read the same property, so the
tile you pressed and the mark under your hand are the same colour *by construction*, not by two
lists agreeing. They were re-cut brighter and more saturated on 2026-09-12 (§ 11 of
`docs/PALETTE-GUI.md`, six hues); this line described the muted originals until 2026-09-13.

**The lettering keeps up with them.** When the hues got brighter, everything else read as dull —
and measuring said it was never lightness (the four regions sit within a few points of each other)
but that the eyebrow-caption layer was set in `--text-faint`, 2.7:1, the step this file's own
ramp reserves for "disabled marks only, never a word". Captions and group labels take
`--text-secondary`, which is what the ramp assigns them; `--text-faint` keeps the genuinely-off
things — a disabled button, a ghost row, an `.off` state, an unbound sticker. Mean contrast per
region is 7.3:1 – 8.7:1 across chrome, footer, tool rail and palette, and 9:1 in settings.

### The rails keep their own tracking, and the reason is width

`--ls-widest` (0.18em) is the instrument's engraved-lettering setting and the rails do **not** take
it. A **rail under 250px cannot afford 0.18em** (the tool rail is 248; the pinned rail was 246.4
when this was measured and is 320 since the mixer, 2026-09-16, whose eyebrows DO take 0.18em; the
tool rail was 216): four labels already wrap at the tracking they have —

| label | rendered width | rail |
|---|---|---|
| `pin Q` | 111.2 | 216 |
| `unpin Q` | 111.2 | 216 |
| `unpin all` | 221.4 | 216 |
| `nothing pinned` | 245.4 | 216 |

so widening them makes a wrap worse, not a heading louder. The exception has a reason and the
reason is measurable, which is what stops it being drift.

Note also that the three rail rules were never on one setting, which is why "move them all off
`--ls-uppercase`" was the wrong shape of question: only `.lyr-empty` is on it. `.lyr-bar button`
carries a **0.09em literal** — no token equals 0.09em (`--ls-wider` is 0.06, `--ls-uppercase` 0.10),
so tokenising it would change the rendered value and it is left alone deliberately.
`.lyr-actions .tc-btn` uses `--ls-wider`.

## 5. The grids and contracts

**The footer is one row.** Every group — the meter columns, the axis buttons and the ⌥ lock,
dry/mute, and the two-row level group — is `--footer-row: 40px` tall and bottom-aligned, so the bar's inset
(`--footer-inset: 1.15rem`) is the only air in the footer, above and below, for everything in it.
Balancing the *bar* does not fix an imbalance *between groups*; one row height does. The meter
height is derived (`--footer-meter`), never set beside it.

Inside a group: glyph `--footer-glyph: 24px`, gap 5px, caption `--fs-eyebrow` with `line-height: 1`
and an explicit height. **The explicit height is the point** — two captions at different line
heights, bottom-aligned to the same edge, still sit on different baselines. That alone put MUTE
1.6px off DRY.

The level pair (`dry vol` over `master`) fills the row and distributes into it, so the top row
lands on the row's top edge and the bottom row on the caption line. The gap between them is what's
left over — the grid decides the spacing, not the reverse.

**The rail says how it selects.** One mark per row, flush at the left edge, in the row's own hue,
and its *shape* carries the rule:

- **half moon** — radio. One of these. Source and lens. **The pinned rail's SELECTED track wore it
  until 2026-09-16** and wears a FRAME now (`.lyr-sel`: a hairline in the pins hue around row one's
  place, a fixture that stays when the rail is empty and holds "nothing pinned", the word SELECTED as
  the rail's eyebrow sitting on its top-right corner the way a sticker sits on a tile's outline). What
  unpin takes is always row one, since the sort is the selection, and a radio mark nobody reads
  mid-show was not saying so (Ek: "sure we have the half moon dot but that's old"). Neutral, never
  ember: chosen is not exceptional. **Tool rows wore it until 2026-09-11**
  and do not any more: arming is gone, so nothing selects a tool — a click on one points the
  DRAWER at it (`.open`, the raised ground) and its key plays it, and neither is a selection.
- **half square** — additive. As many as you like. Off is the same solid block at 24%, not an
  outline: outlined, at 6px with the rail's edge as its fourth side, it read as a bracket rather
  than a shape. **Nothing in the lens dock wears it today** — the pin filters that did were sunset
  on 2026-08-30 and every lens is a radio row — but the shape stays in the language, because the
  rule is about the QUESTION a row answers, not about which rows currently exist.

Round is the shape that cannot tile; square is the one that can. Every row that IS a choice must
carry `trow--radio` or `trow--multi` — the audit fails on a bare one, and equally on a tool row
claiming a mark it has no choice to report. The lit class is `.on`; it was `.armed` until
2026-09-11, when the word left the vocabulary with the thing.

**Settings pages have one type contract**, and its reference is `sensors` and `mapping`: body
`--fs-page` (= `--fs-eyebrow`, 11.04), quiet text `--fs-hint` (= `--fs-nano`, 10.24), declared on
`.settings-host`. The audit reads the allowed set *off those two pages* rather than from a
hardcoded list, so the reference stays the contract. A hint is a step **down** from the label it
explains, never up.

**Off-factory** — a tool dialled off its preset carries a 4px dot in its engine hue, top-right.
Presence-of-edit, not a value diff: moved-and-returned still counts as touched, which is the
honest thing that data can say.

### Two scopes, and where they deliberately differ

This document governs the INSTRUMENT. `docs/SETTINGS-GUI.md` governs everything inside
`#settingsModal`. Two controls exist at both sizes on purpose, and neither is a drift:

| control | the instrument (this doc) | the settings window (SETTINGS-GUI § 3) |
|---|---|---|
| slider | 2px track, 2px tick | 4px track, 16px round knob, readout 64px right |
| switch | 32 × 18, knob 14, 2px inset | 44 × 26, knob 20, 3px inset |
| segmented | a **pill** (`.seg-pill`, r999) — chrome density, where a bordered box adds one line too many | r8 outer / r6 inner, 36 / 30 — beside an r8 dropdown and an r8 field a pill reads as foreign |

The reason is the same for both: the instrument is read at arm's length while your hands are
busy and the sphere has your attention, so a control is a mark you glance at. The settings window
is read at a desk while you are looking straight at it, so a control is a thing you take hold of.
A 2px tick is unmissable in a rail and unusable in a dialog; a 16px knob is right in a dialog and
would be a smear across the footer.

State it here because the temptation, every time, is to "fix" one to match the other. Neither is
the exception — they are two scopes with one reason between them. `npm run audit:align` does not
assert a single slider geometry, so nothing had to be loosened to say this.

## 6. How to work on this

```
npm run electron:dev        # the app, with the dev bridge
npm run audit:align         # 27 invariants, against that running app
npm run audit:docs          # doc staleness — no browser needed
```

`scripts/align-audit.js` talks to the app through `.dev-bridge/` rather than launching its own
Electron, so it runs from anywhere with access to the repo folder — including a sandbox that
cannot execute the macOS binary. Its assertions are the shape to copy: not *"these look aligned"*
but *"these numbers collapse to one value"*, printing the actual spread so a pass is evidence and
a failure says how far off it is.

**Adding an invariant is cheap and is the right response to any design bug that shipped.** The
level group sat 12.5px low for a full round while the audit passed, because the audit only checked
the bar's direct children and that group is nested. The fix was four lines.

For one-off probing, write JS to `.dev-bridge/in/<id>.js` and read `.dev-bridge/out/<id>.json`;
`<id>.shot` gives a PNG. Two things to know: the serialiser **depth-caps at 4**, so flatten
anything you want numbers out of; and `location.reload()` on `file://` serves a cached
`index.html`, so markup changes need `location.href = location.pathname + '?r=' + Date.now()`.

### Where the *why* lives

Numbered sections at the foot of `css/style.css` (currently 1–26) each carry the measurement that
motivated them and the failure they fix. Those comments are the local record and should keep being
written that way — this document is the index, not a replacement. If you change something in
§ 4–5, update both.
