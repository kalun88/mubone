# GUI-PATCH-PROMPT.md — paste this whole file into Claude Code, once

> **Status: ARCHIVED** · the work order for the 2026-09-14 GUI round, moved here the day it was
> spent (Task 11a). Every task in it shipped; nothing here describes today's behaviour. What was
> durable was harvested first: the copy standard, the top-align rule, the never-write-a-global
> rule, the armed-confirm rule and the disabled-row rule are in `docs/GUI-BUILD-SHEET.md` § 5, the
> coverage-gap rule is in its § 9, and the invariants themselves are R1–R6 in
> `scripts/align-audit.js`. The two items still open went to `docs/TODO.md`.

> Four tasks, all pre-ruled. Nothing here needs a design decision from you. Where a decision was
> *not* made, the task says **ASK EK** and you stop at that line rather than guessing.
>
> Order matters: Task 0 first (it is what stops this file being needed again), then 1–4.
> After each task: `npm run audit:align && npm run audit:docs`, and report deltas rather than
> absorbing them. **An empty diff proves only that nothing visible moved** — force each state.

---

## Task 0 — wire the build sheet in, so the next element is right by default

1. Copy `GUI-BUILD-SHEET.md` (handed over with this file) to `docs/GUI-BUILD-SHEET.md`.

2. In `CLAUDE.md`, § *Design and UX work*: **the sheet replaces the section's body rather than
   joining it** — which is also how you stay under the 32 KB ceiling. Delete the three existing
   paragraphs (the `DESIGN-SYSTEM.md` pointer, the six-failures anecdote, and the `audit:align`
   paragraph with the `.dev-bridge/` note) and put this in their place:

```markdown
**Writing a GUI element? Read `docs/GUI-BUILD-SHEET.md` — that page, not the long docs.** It is
the lookup: the three scopes and why they differ, the spacing scale, type, radius, both kits, the
colour order-of-operations, motion, and the always-wrong list. Every row is already argued
elsewhere and the *why* is not your problem while you are building. Read `docs/DESIGN-SYSTEM.md`
when you want to **change** a rule.

**If the answer is not on the sheet, use the nearest thing that already exists.** Never invent a
size, hue or radius. Adding to a kit is Ek's decision, not a side effect of a feature.

**Never claim something is aligned, centred, consistent or balanced without measuring it** — the
project's most-repeated failure, six times in two days, and every cause was invisible until read
as numbers. Read, change one thing, read again. A design bug that shipped should leave an
invariant behind.
```

   That is roughly **1,650 characters out, 950 in**, so the section gets smaller even before the
   table row. Nothing is lost: § 9 of the sheet carries measure-don't-assert in full, and
   `npm run audit:align` is already named in § *Debugging approach* under CSS work — it was
   duplicated here.

3. In § *Reference documents*, add a row, first in the table:

```markdown
| `docs/GUI-BUILD-SHEET.md` | CURRENT | **The GUI lookup — read before writing any GUI element.** Scopes, spacing scale, type, radius, the instrument + settings kits, colour order-of-operations, motion, always-wrong. Sourced from `DESIGN-SYSTEM.md`, `INSTRUMENT-GUI.md`, `SETTINGS-GUI.md`, `PALETTE-GUI.md` |
```

4. `npm run audit:docs` — the sheet needs its banner recognised like the other 31. Then report
   `CLAUDE.md`'s new size; the swap in step 2 should leave it **under** 32 KB, not at it. If it is
   still at the ceiling, say so and stop rather than trimming something else on your own.

---

## Task 1 — `css/tokens.css`: the four stale comments

Lines 306–309. The comments were computed at a 15px base; `--ui-base-px` has been **16** for
months, so the sheet's px column and the file's own comments disagree. Comments only — **no value
changes**.

```css
    --sp-5:  0.75rem;    /* ~11px */   →   /* 12px */
    --sp-6:  1rem;       /* ~15px */   →   /* 16px */
    --sp-7:  1.5rem;     /* ~23px */   →   /* 24px */
    --sp-8:  2rem;       /* ~30px */   →   /* 32px */
```

While there: drop the `~` from `--sp-0`…`--sp-4` too. At a 16px base every step is a whole pixel;
the tilde is what let the drift look intentional.

---

## Task 2 — `css/style.css`: the two new spacing names

Two values recur across unrelated components, so they are **not** per-component tokens. Declare
both beside `--footer-cap-gap` (line 6242):

```css
    --seam: 1px;        /* abutting objects — meter channels, tile strips, lens bar. A SEAM,
                           not a spacing step: these things are meant to read as one object
                           with a hairline in it. Never use as padding. */
```

`--seam` replaces `gap: 1px` at lines **515, 4078, 4165, 4834, 5022, 5080** and `gap: 1px` in
**2226**. It does **not** replace `padding: 1px 5px` (that is padding — see Task 3).

**5px is the other recurring value and gets no token.** It appears in seven unrelated places and a
half-step between 4 and 6 would be a twelfth element in a closed kit. Snap each to the scale:

| line | now | to |
|---|---|---|
| 2000, 2154 | `padding: 1px 5px` | `padding: var(--sp-1) var(--sp-3)` → 3px 6px |
| 3639 | `gap: 5px` | `var(--sp-2)` |
| 3739 | `padding: 5px` | `var(--sp-2)` |
| 4934 | `gap: 5px; padding: 5px` | `var(--sp-2)` both |
| 5681, 5903 | `gap: 5px` | `var(--sp-2)` |
| 6525 | `padding: 0 5px` | `0 var(--sp-3)` → 6px, the pill needs the width |
| 2086 | `padding: 7px 6px` | `var(--sp-3)` both → 6px |
| 3622 | `margin-bottom: 10px` | `var(--sp-5)` → 12px |
| 6496 | `gap: 10px` | `var(--sp-5)` → 12px |

`--footer-cap-gap: 5px` **stays** — it is measured, named and beside its component. It is the
pattern, not the exception to be cleaned up.

**Then measure.** Screen-probe every touched component and report any object whose width or right
edge moved **more than 2px**. Revert those lines individually and list them — a snap that moves a
flush-right edge is a wrong snap, and finding one is a success, not a failure.

**Straight find-and-replace, on-scale already** (no decision, no measurement risk): `2px`→`--sp-0`,
`3px`→`--sp-1`, `4px`→`--sp-2`, `6px`→`--sp-3`, `8px`→`--sp-4` in `padding`/`margin`/`gap` only —
lines 252, 261, 425, 465, 506, 518, 526, 1371, 1451, 1477, 1545, 1685, 1694, 1750, 1900, 1989,
2651, 2697, 2712, 3100, 3140, 3171, 3337, 3347, 3355, 3358, 3555, 3622, 3628, 3738, 3942, 4079,
4137, 4230, 5075, 5331, 6523, 6524, 6534.

**Exempt, do not touch:** `--pal-tile/--pal-gap/--pal-pad` (53/11/13px, already named);
`margin: -5.5px 0 0 -1px` at 4481 (half of an 11px height — geometry, not spacing; mark it
`/* geometry */` so the audit skips it); `calc(3px * var(--hud-scale))` at 752; any
`env(safe-area-inset-*)`.

**A hole in the rule, worth closing:** § 1 of the sheet says "never a bare **px** literal" and so
`padding: 0.38rem 0.7rem`, `1.2rem 1rem`, `0.25rem`, `0.4rem`, `0.6rem` (lines 893, 1477, 1685,
2226, 4798, 4813) sail past it. They are the same violation in a different unit. **Do not convert
them in this pass** — some are deliberate rem so they track `--ui-base-px`. Instead add one line
to § 1 of the sheet and make the Task 4 check match both units, then bring them in as a named
round.

---

## Task 3 — `js/renderer.js`: the cursor reads tokens

Nine hand-written colours. All six cursor rulings are on the sheet, § 6.

**3a. Add the reader** beside `_focusInk` (line 146), which is already the precedent:

```js
// Cursor ink comes from tokens (ruled 2026-09-14). The invariant: the tile you pressed and
// the mark under your hand are the same colour BY CONSTRUCTION, not by two lists agreeing.
const _tokCache = new Map();
function _tok(name, fallback) {
  let v = _tokCache.get(name);
  if (v === undefined) {
    v = getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
    _tokCache.set(name, v);
  }
  return v;
}
export function flushCursorTokens() { _tokCache.clear(); }   // call on theme change
```

Cached because this runs per frame and `getComputedStyle` is a layout read — the grain scheduler
shares this thread.

**3b. Recording → the mic-live ramp.** Recording *is* the mic being live, and the top bar already
says so in that colour. It is not `--accent-danger`: that means "it will not come back".

- line 2632 `'#e83030'` → `_tok('--mic-live-border', '#d25e3e')`
- line 2846 `'rgba(232,48,48,0.95)'` → `_hexA(_tok('--mic-live-border', '#d25e3e'), 0.95)`
- line 2856 `'rgba(232,48,48,0.90)'` → `_hexA(_tok('--mic-live-border', '#d25e3e'), 0.90)`

**3c. Erase → `--eng-erase`.** It must match its own tile; the old red was borrowing danger.

- line 2667 `'rgba(224,64,64,0.12)'` → `_hexA(_tok('--eng-erase', '#be7ace'), 0.12)`
- line 2670 `'rgba(224,64,64,0.85)'` → `_hexA(_tok('--eng-erase', '#be7ace'), 0.85)`

**3d. Nothing in hand → the warm neutral.** `rgba(180,180,180,…)` and `rgba(200,200,200,…)` are
cool greys over a warm black, which is exactly how the sheet's § 8.1 says a dark UI goes cold.

- line 2669 `'rgba(180,180,180,0.10)'` → `_hexA(_tok('--text-tertiary', '#938d83'), 0.10)`
- line 2672 `'rgba(200,200,200,0.55)'` → `_hexA(_tok('--text-tertiary', '#938d83'), 0.55)`

**3e. Scan off → drop the fill.** No palette hue fits without colliding with a loaded meaning, and
the ring already carries five signals on one 60px object. The wash *is* the reach; nothing is being
read, so the ring is empty: outline only, in `--text-faint` (a disabled **mark** — legal; the ban
is on words).

- line 2668 `: scanOff ? 'rgba(232,160,48,0.10)'` → `: scanOff ? 'transparent'`
- line 2671 `: scanOff ? 'rgba(232,160,48,0.55)'` → `: scanOff ? _hexA(_tok('--text-faint', '#5c564c'), 0.85)`

Alpha rises to 0.85 because the fill is gone and a 2.7:1 token at 0.55 over the canvas is not a
visible ring. Measure it: force `S.scanMuted` and read the ring back at centre and at full tilt.

**3f. Nearest → the ramp, not a new violet.** Line 928 `'#b8a0ff'` →
`_tok('--accent-sensor', '#a793c0')`. Ruled: nearest comes from the ramps.

**3g. Slot-colour fallbacks are near-misses of real tokens** — three defaults drifted a few points
off the engine hues they were copying:

- line 2299 `'#4a9fd4'` → `_tok('--eng-source', '#4aa3e8')`
- line 2302 `'#ff6b9d'` → `_tok('--eng-tape', '#f2569e')`
- line 2822 `'#8aa6bc'` → `_tok('--accent-lock', '#7fa8ae')`

**3h. Stale comments after the above:** lines 2340–2343 name the edge-indicator colours as literal
hexes (`amber #e8a030`, `pink #ff6b9d`, `violet #b8a0ff`), and lines 2638–2640 still say "Erase
brush held: red tint (danger). Scan off: amber". Rewrite both to name tokens. A comment that
contradicts the code is how the six-colour cursor survived this long.

**ASK EK — two colours have no ruling. Stop, do not pick:**

1. `CURSOR_IDLE_COLOR = '#f5a69c'` (`js/state.js:165`) — a warm pink in no ramp. It is the centre
   dot while painting a **live** source. The invariant says the mark wears what it inks from, which
   would make it `--eng-source` azure — a visible change to the thing Ek looks at most.
2. The toggle-trace green, `rgba(77,204,122,…)` (lines 2848, 2865). Not on the sheet's cursor
   table. Two honest candidates: `--accent-sweep` sage (closest hue, but means "it worked") or
   `--accent-sensor` dusty violet (means "the body is driving it", which is what hands-free
   latched *is* — but collides with 3f's nearest violet on the same object).

---

## Task 4 — four rhythm checks in `scripts/align-audit.js`

The audit has 27 invariants and not one about spacing rhythm, which is why the drift in Task 2 was
invisible. These are the four that would have caught it. Follow the existing check signature.

```
R1  no bare px OR rem literal in padding / margin / gap in style.css,
    outside: a var(), a calc() with a var() in it, env(), or a line marked /* geometry */.
    Reports file:line and the literal. This is the one that pays for itself.
R2  every named component spacing token (--*-gap, --*-pad, --*-inset, --seam) resolves to a
    whole number of px, and is declared in the same rule block as the component that uses it.
R3  settings rows: every control group's right edge within 1px of the same x, per page.
    The row model is not negotiable and this is the only way to know it held.
R4  cursor: no hex or rgb()/rgba() literal inside the cursor draw block of renderer.js
    (the reticle + radius + reach section), except via _tok(). Fallbacks inside _tok() calls
    are exempt — that is the whole point of them.
```

Then, per the house rule, this file's own lesson: **adding an invariant is the right response to
any design bug that shipped.** R1 is four lines and closes the class.

---

## Task 5 — `js/renderer.js`: two cursor objects get deleted

Both were ruled on 2026-09-14 in card **A5**. Deletions, not rewrites — the whole point is one
fewer object. Do these **after** Task 3 so the token wiring doesn't touch code that is leaving.

**5a. The radius label's persistent ghost — cut it.** Line 933 area, `drawRadiusTooltip`:

```js
const baseAlpha = 0.20;
```

That 0.20 is why the degree readout is on screen permanently. **The ring is the radius** — the
number is confirmation of a change, not a fact that needs standing. Show it only while the flash
is alive: return early when `S.radiusTooltipUntil - now <= 0`, and drop `baseAlpha` entirely so
the alpha is just the flash curve. Keep the flash timing (600ms) and `nearest` behaviour as they
are — `nearest` is a *mode*, not a value, so if it still needs standing text say so and stop.

This also disposes of the 9px-font problem in the resting state (see 5c): at rest there is no text.

**5b. The centre anchor dot — delete.** Lines 2601–2606, the `if (!S.cursorQ)` block drawing a
2.5px dot at `cx, cy` in standard mode. The tether origin and the cursor reticle are **two objects
for one fact**: in standard mode with no mouse in canvas the cursor already sits at `cx, cy`, so
the dot is drawn underneath the reticle and is invisible; when the mouse *is* in canvas it marks a
point that means nothing on its own. Delete the block and its two comment lines. The reticle is
the mark.

After deleting, check the `S.ctx.save()` immediately above it still has its matching `restore()`
— the save is used by the block below, so it **stays**.

**5c. RULED — Urbanist. Drop `"Roboto Mono"` from all four.** The 23.65px measurement settles it
the other way: tabular figures exist to stop a **right-aligned or fixed-position** numeric column
from shuffling, and all four of these are `textAlign = 'center'` (lines 196, 396, 959, 2362) on
strings of **1–4 characters**. Centring absorbs a proportional-width change, and the only one that
changes digit count — the radius readout — changes width anyway. Proportional figures cost nothing
here, so the tie-breaker is the house rule: one typeface on screen.

```js
font = 'bold 11px Urbanist, sans-serif'   // lines 195, 2350
font = `${fs}px Urbanist, sans-serif`     // lines 395, 947
```

Re-measure the four labels' rendered widths after the swap — Urbanist at the same px is wider than
the platform mono, and line 2352 draws a pin number 14px above its mark with no collision box.
**Add to § 2 of the sheet:** canvas labels are Urbanist; if a *right-aligned* numeric column ever
appears on canvas, that is when this gets reopened.

---

## Task 6 — the disabled row is an inline opacity, and it takes the words with it

`index.html` lines **1024** and **1035** (`improvSnapRow`, `improvAlwaysRow`) and line **613**
(`radiusFadeCurveRow`) disable a row with `style="opacity:0.35"`. Three problems, one fix:

1. It is an inline style, so it outranks every stylesheet rule — § 8.5 of the sheet, the trap that
   has already beaten a correct contract six times.
2. **It dims the words.** `.set-row-desc` is `--text-muted` `#857e74`, 4.9:1. At 0.35 alpha over the
   dialog ground that composites to roughly **1.4:1** — below the ramp's own floor, and the ramp's
   floor is *disabled marks only, never a word*. The title, `--text-light` 14.7:1, lands near 2.6:1.
   Both of those rows carry the longest descriptions on the pins page, so the text that most needs
   reading is the text being erased.
3. It says nothing about *why*. Crossfade and Tether are off **because Blend is on All** — a
   condition the row could state.

**The fix, from rules that already exist — nothing invented:** a `.set-row--off` class in
`settings-gui.css`. A disabled row keeps its words at full strength and dims **only the control**:

```css
.settings-host .in-settings .set-row--off .set-ctl { opacity: 0.4; pointer-events: none; }
.settings-host .in-settings .set-row--off .set-row-title { color: var(--text-secondary); }
```

Title steps down one ramp stop — which is what "not available" looks like in a monotonic ramp —
and the description does not move at all. Add `aria-disabled="true"` on the row while you are
there; the inline opacity was also hiding the state from the accessibility tree.

Remove all three inline `opacity` attributes. Whatever JS toggles those rows must toggle the class
instead — grep `improvSnapRow` and `radiusFadeCurveRow` and check for a JS writer that sets
`style.opacity` directly, because an inline write will beat the class the same way.

**Then measure:** force each row's off state and read back the computed colour of the title and the
description. Report both ratios.

---

## Task 7 — the description cap (ruled 2026-09-14: cut them, top-align always)

Measured first: **76 rows carry a description, 33 are over 92 characters, 42 run to more than one
sentence**, and they range from 1 word (Defaults) to 107 (Calibration) — 107:1 through one row
shape. Two mechanical parts below, then the copy, which is written out in full in 7c.

**7a. Top-align always.** `settings-gui.css` line 101:

```css
.settings-host .in-settings .set-row--top { align-items: flex-start; }
```

Move `align-items: flex-start` onto `.set-row` itself and **delete the `--top` rule**, then remove
`set-row--top` from the four rows carrying it (`index.html` 2051, 2066, 2078, and the fourth —
grep it). A control now sits on its title's line at every description length, so a page has one
horizontal rhythm instead of one per row.

**7b. Delete the pressure valve.** `settings-gui.css` line 1261:
`.set-row-desc--wide { max-width: none; }`. Remove the rule and the four `set-row-desc--wide`
classes on the Buttons page (`index.html` 2007, 2014, 2021, 2028). With a cap it has no job, and
it is what let the paragraph win.

**7c. The twenty cuts.** The table below **is** the copy — replace each row's `.set-row-desc` with
the sentence given. Do not paraphrase: each is written to the 92-character cap and to what the row
actually needs. `w` is the counted word count going in.

| row | w | the description, in full |
|---|---|---|
| Calibration † | 107 | The chip's own bias learning — one routine per sensor, off on every boot. |
| Latency | 81 | The time between a sound and its sample, in and out — the tape engine steers by it. |
| Magnetometer † | 56 | On, heading holds to a global north; off, it drifts at the gyro's bias rate. |
| Access Point † | 53 | The instrument's own network at 192.168.4.1, no router in the path. |
| Sensor Zero † | 53 | *— ASK EK, see below. Do not cut this one yet.* |
| WiFi Channel | 51 | Surveys 2.4 GHz and picks 1, 6 or 11 — the only three that do not overlap. |
| Max Grains | 48 | How many grains may sound at once, and how many marks light with them. |
| Output Ceiling | 47 | The last stage before the interface — transparent below −3.1 dBFS, holding −0.1 above. |
| Stall Cushion | 46 | How deep the two hops between the engine and the interface may run. |
| Buffer Size | 45 | The native output block — the dropout remedy, not a quality control. |
| Access Point Name † | 41 | What the network is called and its password; blank is the factory pair. |
| Router † | 39 | Join a network — the instrument keeps the name and password and reports neither. |
| Sample Rate | 36 | 48 kHz is what the rig runs and what everything is tuned to. |
| Link Quality | 35 | Six seconds of the live stream: what the sensor produced against what arrived. |
| Crossfade | 33 | How wide the handover is between two pins — 0% snaps at the midpoint. |
| Diagnostic Report | 33 | Audio state, grain parameters, counts, and the last eighty logged events. |
| Tap Window | 24 | The gap after a release in which the next press counts as ×2 or ×3. |
| Selected Pin | 23 | The pin unpin takes, marked in the rail. |
| Recording Limit | 19 | Live recording stops when the buffer reaches this. |
| Blend | 16 | All plays every pin at equal weight; Focus leans toward the closest. |

**† = inside `<template id="sygInstrumentTpl">`** (`index.html` 1677). Six of the twenty. Edit them
in the template markup — same file, further down.

Longest replacement is 85 characters (Output Ceiling), so all twenty clear the cap.

The cut text is **not deleted**: append it to the doc that already owns the subject (sensor rows →
`docs/BNO085-CONTROL.md`, audio rows → `docs/CAPS-AND-THROTTLES-2026-09.md`), under a
`### From the settings dialog` heading, and note in your report which paragraphs were already
there verbatim — most are.

**7d. Three sentences must NOT go to the docs.** They are needed at the moment the control is in
front of you. Do these three and nothing more:

1. **Latency → `.set-row-status`.** "Measure needs the output to reach the mic" is a precondition
   of a button on that row; cut it and Measure fails silently on a headphone rig. Show
   `needs output → mic` in the existing status column when no path exists, nothing when one does.
2. **The three every-boot instructions** (Magnetometer off, Access Point on, Calibration off) —
   **leave them in place for now.** They are finding 3 and Ek has not ruled on it. Cutting them
   before that lands is the one way this change makes the app worse.
3. **Output Ceiling → status pill.** Its description has to say "Nothing to set", which means the
   row is drawn as a control and is not one. The sheet already rules this: a cell that cannot be
   operated is never shaped like a control. Rebuild it as the instrument kit's status pill (18
   tall, r999, 6px dot + label, reading `idle`) and the sentence becomes unnecessary rather than
   short.

**7e. R5 in `align-audit.js`** — the only check here that catches a *writing* regression, which is
how all twenty got in:

```
R5  every .set-row-desc is ONE sentence and <= 92 characters.
    92 = two lines of the 46ch column it is already capped to (measured: 278px, 56.8 ch/line).
    MUST instantiate <template> content before querying — see below.
    Reports page, row title, length. No --wide escape exists any more.
```

**⚠ R5 will silently pass the worst rows unless it opens the templates.** Measured while writing
this: **11 of the 76 described rows live inside `<template id="sygInstrumentTpl">`** (`index.html`
1677) — Calibration, Magnetometer, Sensor Zero, Sampling Rate, Router, Uplink, Access Point,
Access Point Name and three more. A `document.querySelectorAll('.set-row-desc')` does not see
template content, so the **107-word description — the longest in the app — has been sitting behind
44 passing checks.** R5 must walk `document.querySelectorAll('template')` and query each
`.content`, or instantiate the sensor page first.

**Worth checking the same day: how many of the existing 44 checks query the document directly?**
Any of them that touch settings rows have the same blind spot. That is a bigger finding than the
descriptions and it came out of counting them.

**The measured picture, for the report:** 76 rows carry a description — **33 over 92 characters**,
**42 over one sentence**, range 1 word (Defaults) to 107 (Calibration). A7 cuts the top 20. The
remaining 13, same treatment, same cap, after the 20 land: What The Colours Mean (63w), Master
Volume (46w), Shown On The Palette (26w), Margin (23w), Hold (21w), Reset All (20w), MIDI Input
(17w), Mode (17w), Dry Gain (17w), Projector Window (16w), Release (16w), Sidechain High-pass
(15w), Uplink. Bring them in a second pass so the first one stays reviewable.

**ASK EK — Sensor Zero** (53 words, in the template). Its description exists to tell you *not to
use the control* and to press `` ` `` instead. Cut to one sentence it reads like a working feature.
Either the row is disabled with that as its reason (Task 6's `.set-row--off`), or the row goes. Do
not cut it until Ek says which.

---

## Task 8 — the second description pass (A9)

**First, R5 changes — the sentence rule was the wrong proxy.** `≤ 92 characters` is geometric and
stays. `one sentence` was my stand-in for "not a paragraph", and measuring the remainder shows it
firing on 11 rows that have no problem: `The floor, in pixels. Quiet material never draws smaller
than this.` is 67 characters, two clean sentences, and joining them with a semicolon makes it
worse. A 67-character description is not a paragraph.

```
R5  every .set-row-desc is <= 92 characters AND at most TWO sentences.
    92 = two lines of the 46ch column (measured: 278px, 56.8 ch/line).
    Three sentences inside 92 characters is choppy, not dense — that is what the count catches.
    MUST open <template> content.
```

That takes the remainder from 27 rows to **16**, and the 11 it releases are listed at the bottom as
**leave exactly as they are** — do not touch them.

### 8a. The sixteen cuts

| row | ch | the description, in full |
|---|---|---|
| vizModal/What The Colours Mean ‡ | 322 | Hue is brightness, from deep tones to noise; saturation is how tonal it is. |
| tpl/Sensor Zero † | 320 | Off until the firmware's tare follows the magnetometer switch — zero heading (\`) instead. |
| audioSettingsModal/Master Volume ◆ | 243 | The last gain in the app; on a multichannel rig it is the per-speaker bus gain. |
| tpl/Reset Sensor † | 160 | A hardware reset pulse — the tare and calibration go back to the sensor's own storage. |
| tpl/Sampling Rate † | 154 | One interval shared by the gyroscope, linear acceleration and rotation vector. |
| mappingModal/Shown On The Palette | 142 | Which binding each tile wears as its sticker; the table below shows all three. |
| hfTune/Margin | 126 | Input must exceed output by this much before the gate opens; 0 dB is off. |
| setPanelReset/Reset All ◆ | 126 | Every stored setting and the offline cache; the app starts from factory. |
| hfTune/Hold | 118 | How long the gate stays open after the signal drops below the paint gate. |
| setPanelView/Projector Window ◆ | 101 | A second window mirroring the sphere, for the projector. |
| setPanelView/Mode | 99 | Steer follows the mouse; surface captures it; sensor hands the view to the x-imu3. |
| mappingModal/MIDI Input | 98 | Every attached device, on every channel — a binding names its own channel. |
| hfTune/Sidechain High-pass | 95 | Keeps low rumble out of the gate's detection; the recording is untouched. |
| hfTune/Release | 94 | How quickly the gate fades closed once hold expires. |
| audioSettingsModal/Dry Gain ◆ | 94 | Level of the spatialized live input in the house mix. |
| commitPanel/Tether ★ | 91 | On, a pin keeps sounding wherever the cursor goes; off, only within its radius. |

Longest is 89 (Sensor Zero). **† inside `sygInstrumentTpl`** — three of the sixteen.

### 8b. Sensor Zero — RULED: disabled and visible

Its two buttons are already `disabled` in the markup, so the row is non-operable and does not look
it. **`.set-row--off`, and the description becomes the reason** — the sentence in the table above.
Not deleted: the instrument *has* a tare, and a person who knows that and cannot find the row will
go looking in the firmware. A visibly disabled row with a reason answers the question; a missing
row raises it.

The endorsement trap you flagged is real and the off-state is what defuses it: dimmed control plus
`aria-disabled` says *not available* before the sentence is read. Verify that specifically — force
the off state and confirm the control reads as disabled without the words doing the work.

### 8c. ★ Tether — the reason belongs to the state, not the prose

`Focus only.` is the third sentence and it is there because the row is disabled under Blend=All.
That is exactly `.set-row--off` from Task 6 (`improvAlwaysRow` — already on your list). **The
reason renders from the off state, not from the description**, same as Sensor Zero. So cut the
sentence from the prose only once the off-state reason is showing, and check the two do not
now say it twice.

### 8d. ◆ Four rows lose an affordance, not a fact — and it is one pattern

Master Volume "Double-click to reset to −6 dB" · Dry Gain "Double-click the slider to reset to
50%" · Projector Window "Double-click its title bar to fullscreen it" · Reset All "Click twice".

These are **not** documentation — they tell you how to operate the control in front of you, and a
doc cannot do that. They are also the same sentence four times, which means the app has an
undocumented interaction (double-click resets a slider) that it explains per-row in prose.

**Do not send these to docs and do not drop them.** Park them: leave each of the four sentences in
place for now, over the cap, and report them as a set. The right fix is one of — a `title`
attribute on the control, a reset affordance the kit owns, or an entry in
`docs/KEYBOARD-SHORTCUTS.md` plus nothing in the row — and that is a kit decision for Ek, not a
copy edit. **Four knowingly-failing rows is the correct outcome of this task**, and R5 should name
them rather than be silenced.

### 8e. ‡ What The Colours Mean is probably not a row

322 characters explaining a legend, ending "It is not settable" — the Output Ceiling smell exactly.
A row whose description has to say it is not a control is drawn as a control. Cut it per the table,
then check what control that row actually holds. If the answer is none, it is a legend block on the
viz page and the row model is the wrong container for it. Report, do not restructure.

### 8f. Leave these eleven EXACTLY as they are

They fail the old sentence rule and pass the amended one. Two short sentences inside 92 characters
is a description doing its job:

```
hfTune/Feedback Detect 90 · vizModal/Minimal Rendering 89 · setPanelAudioAdv/Handsfree Gate 86
commitPanel/When Full 85 · mappingModal/OSC Input 85 · setPanelSession/Import 77
vizModal/Quietest Input 77 · audioSettingsModal/House Speakers 77 · vizModal/Largest 69
setPanelButtons/Extra Long 68 · vizModal/Smallest 67
```

### 8g. Two things from your report that are not design questions

**The audit blind spot — 33 of 104 checks cannot see the 11 template rows.** That is a harness bug,
not a ruling: the checks are correct and are being run against an incomplete DOM. Fix it once in
the shared query helper — instantiate `sygInstrumentTpl` (or walk `template.content`) before any
check enumerates rows — rather than 33 times. Report how many of the 33 then fail; a check that
has never seen its rows has never passed them either.

**`--footer-inset: 18.4px` and the two other fractional tokens.** A fractional token is legal only
where the fraction is *derived* and the derivation is written beside it (18.4 = 1.15rem at a 16px
base, or a half of something measured — say which). If no derivation exists, it predates the scale
and snaps to the nearest step. Show both values before changing anything: this is § 1's "measured
reason" clause, and a token that cannot state its reason does not have one.

## Task 9 — the reason the CLI still guesses: `index.html` routes to nothing

This is the original complaint ("I spend three prompts telling it how to align and size things")
and it is not a documentation problem. It is two lines in `scripts/audit-for.js`.

**9a. `index.html` is not in the MAP.** The router's patterns cover `^css/`,
`js/ui-settings.js`, `js/tile-layout.js`, `^docs/`, `^js/[^/]+\.js$` and the rest — and
**nothing matches `index.html`**. Line 118 then prints:

```
no suite maps to these files — run nothing, and say so
```

**A new GUI element is markup in `index.html`.** So on precisely the change class that keeps going
wrong, the router *instructs* the agent to run no audit at all. 104 checks, R1–R5 included, and the
one change that adds an unmeasured element is the one change exempted from them. The fix:

```js
[/^css\/|^index\.html$|^js\/(ui-settings|tile-layout)\.js$/,
  'npm run audit:align && node scripts/probe-selftest.mjs',
  ...
```

Then update `docs/AUDITS.md § 2` — the header says the MAP and that table are kept identical.
Report anything that starts failing: those are the elements that were never measured.

**9b. The instrument scope has no kit-size check.** Settings has one —
`${sec} uses only the kit's sizes` (line ~1282) — and it is why settings drift stopped. The
instrument side is all *per-component* invariants: the footer's glyphs, the rail's rows, the
stickers, the lens page, the buttons table. A **brand-new** element matches none of them and is
therefore checked by nothing, which is the other half of the symptom.

The sheet already claims this is enforced: *"A 32px button fails the audit by name."* Today that is
aspirational. Make it true, with R1's own frozen-tail pattern so the backlog does not block it:

```
R6  every control-shaped element in the INSTRUMENT scope computes to a kit height.
    Scope: everything outside #settingsModal and outside .palette.
    Enumerate button, [role=button], .mu-btn, .mu-btn--lg, .tc-icon, .seg, .seg-pill,
    .status-pill — anything with a border, a background or a click handler that is not text.
    Assert computed height is one of: 24 (.mu-btn) · 38 (--lg) · 32 (.tc-icon object)
    · 24 (segmented, container AND buttons) · 18 (status pill) · content (--bare).
    Freeze today's offenders in an R6_TAIL by selector, exactly like R1_PX_TAIL, and fail
    only on a NEW height. CLAUDE.md already notes top-bar-btn has five.
    Detail line should name the element and the nearest legal height — the agent's next
    move should be readable straight off the failure.
```

**Why R6 and not more prose:** the sheet fixed *findability* — the numbers are one page away now
instead of 50,000 characters away. What is still missing is the part that has always done the work
in this repo: **nothing fails when it guesses.** R1 proved the pattern on spacing, R5 on copy. R6
is the same four lines for size, and it is the check that turns three prompts into one failure line.

## Task 10 — two rulings from the R6 report, and a correction

**My 9a premise was wrong.** `^index\.html$` *is* in the MAP, inside the engine-rig pattern; the
router prints `rig-audit engine` and never reaches the no-suite line. Your sharper diagnosis is the
one to keep: the change class was **audited for the wrong thing** — cabinet ids intact, and none of
the 108 checks that measure spacing, kit size, the row model or the copy cap. I also predicted
failures on adding `align`; none appeared, and your reason is right — the gap was prospective, and
it is the *next* element that was unguarded.

### 10a. The six 40px footer buttons — RULED: no sixth kit size

Neither of your two options. **A control that fills a named structural box takes the box and gets no
size of its own.** The footer buttons are 40 because `--footer-row` is 40 — the box is stated once
and the button fills it. Same reason a settings button in a table cell is 30 rather than 36.

So: not off-kit, and not a sixth size — nothing *else* may be 40. Two consequences for R6:

1. **Assert the computed token, never the literal.** These six pass when their height equals
   `getComputedStyle(...).getPropertyValue('--footer-row')`, so the check follows the token if the
   box ever moves. A frozen 40 would rot silently the day the footer row changes.
2. **Unfreeze them.** They come out of the 16-entry tail and into this derived rule — a tail entry
   says *known wrong*, and these are known **right**. Leaving them frozen would teach the next
   reader the footer is a violation being tolerated.

Added to § 4 of the sheet, so the kit table stops looking like it omits a size.

### 10b. Absence is not evidence — and it is now a house rule, not an R6 detail

Your `srcRecBtn` / `srcTestBtn` catch is the third instance of one bug this week: 11 settings rows
behind a `<template>`, 33 of 104 checks querying a document that never instantiated it, and two
buttons that exist only while their drawer is rendered. Same shape every time — **a check mistook
"did not see it" for "it is fine."**

Make the rule explicit in the tail mechanism, and not only R6's:

```
A frozen tail drops an entry ONLY when it was measured and clean.
An entry not present this run STAYS in the tail and reports as "not reached".
The run's detail line states coverage: n seen / n in tail / n unreachable.
An entry unreachable on every path the probe has is a COVERAGE GAP and is named as one —
that is a finding about the audit, not a pass for the element.
```

Apply the same three-state read to `R1_PX_TAIL`, `R2_FRACTIONAL` and `R5_LONG_TAIL`/`R5_MULTI_TAIL`
while it is fresh — they are all "gone means fixed" today, and R5's tail covers rows inside a
template that is not always instantiated. **Do not silence this by widening the probe** — report the
coverage number and let it be visibly low; 21 of 660 with the rails shut was the useful fact.

Also in § 9 of the sheet, since it generalises past the audit: *a probe that cannot reach a thing
reports a coverage gap, and the gap is the finding.*

### 10c. Your two refusals were right, log them

**You would not click a tool row to measure it** — a probe may not play the instrument — and you
measured that the doors reach the same components anyway, so the clicks bought nothing. **And you
tested my flat height list literally, found it passed a 32px `.mu-btn`, and made R6 per-kind.**
That one is a defect in my spec, not in the implementation: 32 is legal, but only as `.tc-icon`.
The sheet's line now reads *"a 32px `.mu-btn` fails by name — 32 is legal, but only as `.tc-icon`"*
so the next reader cannot repeat my mistake.

## Task 11 — archive this file, but harvest it first; and the affordance ruling

### 11a. Archive — yes, with two things lifted out first

Your reasoning matches the policy and the 759 bytes settle it. But a work order is only spent when
everything durable in it has a home, and two things did not:

1. **The copy standard.** "One sentence, ≤ 92 characters, two maximum, no `--wide`" lived only in
   R5's source and in this file. A person writing a new settings row reads the sheet, not the audit.
   **Now in § 5 of `GUI-BUILD-SHEET.md`** (re-copy it), together with the top-align rule and the
   double-click convention from 11b.
2. **The open affordance question.** It must not be archived while it is still open — add it to
   `TODO.md` as one line before the `git mv`, then archive.

Then: move it to `docs/archive/GUI-PATCH-PROMPT.md` — done 2026-09-14. No table row, no bytes out of
`CLAUDE.md`. Do not add a row for it.

### 11b. The double-click affordance — RULED, and it unparks all three rows

Four sentences, three different things. Only one of them was ever an affordance:

**Master Volume · Dry Gain — kit-wide convention.** *Double-click resets a slider to its default.*
True of every slider with a default, so it is stated **once** in § 5 of the sheet and once in
`docs/KEYBOARD-SHORTCUTS.md`, and **never in a row's description**. Writing a global behaviour
per-row is exactly how one sentence got written four times. Cut both sentences:

| row | the description, in full |
|---|---|
| audioSettingsModal/Master Volume | The last gain in the app; on a multichannel rig it is the per-speaker bus gain. |
| audioSettingsModal/Dry Gain | Level of the spatialized live input in the house mix. |

**Reset All — not an affordance, a confirm state.** "Click twice" describes the button's own
two-step arm. A control that needs confirming says so **in the armed state**, not in prose: first
click → the button reads `Click again to confirm` (`--accent-danger` face, per § 6), second click
fires, blur or 3s disarms. Then the description drops the sentence:

| setPanelReset/Reset All | Every stored setting and the offline cache; the app starts from factory. |

**Projector Window — information about a different window.** "Double-click its title bar to
fullscreen it" is a window-manager gesture, not this control's behaviour, and this row is the only
place it is written down. It goes to `docs/KEYBOARD-SHORTCUTS.md` beside the double-click line —
same section, both are gestures:

| setPanelView/Projector Window | A second window mirroring the sphere, for the projector. |

Align-audit should go green on all three. **If the Reset All confirm state is more than a small
change, park that row alone and say so** — the other two are copy-only and should land regardless.

### 11c. The last two R5 entries — report before I write copy

`keys/OSC Input` and `mapping/MIDI` are in neither A7's nor A9's tables because I never saw them.
I checked the two rows I *can* see — `MIDI Input` on the keys page is already at 74 characters, and
that page's `OSC Input` is 85 with two sentences, so under the amended rule it passes and is not
the entry R5 means.

**So these are rows on another page and I will not guess their copy.** Report, for each: the page,
the selector, the character count, and the current text in full. Note whether the description
contains a **live element** — that page's `OSC Input` embeds `#oscStationInline` and a
`.js-osc-port` inside its sentence, so a naive cut deletes a live readout. I will write both
sentences from the real text in one reply.

## Task 12 — the last two descriptions

**`mapping/MIDI`** — no live elements, straight cut. 95 → 82:

| row | the description, in full |
|---|---|
| mapping/MIDI | The browser grants Web MIDI once per origin — until it does, no device list exists. |

**`keys/OSC Input`** — your instinct was right, and it does better than fit: **`#oscStationInline`
is a live readout, so it belongs in `.set-row-status`, not inside a sentence.** That is the row
model's own rule (a live value reads *after* you use the control; prose reads before), it is where
the Latency precondition went, and **the row directly above already does exactly this** with
`#midiPortName`. The pair becomes symmetrical instead of one row hiding its state mid-paragraph.

```html
<div class="set-row-text">
  <span class="set-row-title">OSC Input</span>
  <span class="set-row-desc">Any OSC sender reaches this station — from Max,
    <code>[udpsend 127.0.0.1 <span class="js-osc-port">7500</span>]</code>.</span>
  <span class="set-row-status"><span id="oscStationInline">solo (port 7500)</span></span>
</div>
```

73 characters, one sentence, **both live elements kept**: `.js-osc-port` stays inside the
copy-pasteable Max command where it is useful, `#oscStationInline` moves up a line and keeps its
id, so whatever writes to it keeps working untouched.

**One thing to verify, and it is the only risk here:** grep what writes `#oscStationInline` and
confirm **every** value it can hold reads as a standalone status. It currently sits after "This
station is …", so a value phrased to complete that sentence would read wrong alone. If one does,
reword that value — do not put the span back in the sentence.

### On Reset All — my hedge was wrong and your number stands

The confirm state already existed at `main.js:500`; "park that row alone" was me hedging against
work that was already done. And keeping the measured **4s** stand-down over the 3s I wrote is
correct on the house rule — a live measured number beats a spec written without it. The blur clause
re-registering per arm rather than `{once: true}` is the better reading of it too.

### Where this leaves the round

Everything from the original ask has shipped: the sheet is in `docs/` and pointed at from
`CLAUDE.md`; spacing, tokens, cursor colours and the copy cap are enforced by R1–R6 rather than
described; `index.html` routes to the alignment suite; and the frozen tails no longer read absence
as a fix. The two things still genuinely open are in `TODO.md` where they belong — the viz legend
drawn as a row that is not one, and the 13-row third copy pass. Neither blocks anything.

---

## When you are done

Report, per task: what changed, what you measured, what moved more than 2px, and every line you
reverted. Then the two ASK EK items, unanswered. Do not report this as aligned, consistent or
balanced — report the numbers.
