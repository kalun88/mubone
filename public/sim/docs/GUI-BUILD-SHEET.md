# GUI-BUILD-SHEET.md — read this before writing any GUI

> **Status: CURRENT — THE LOOKUP.** One page, no reasoning. Every row here is a decision already made and
> argued somewhere else; the *why* is one hop away and is not your problem while you are building.
>
> **Read this file. Do not read the long docs to answer a build question** — read them when you
> want to *change* a rule. `DESIGN-SYSTEM.md` (the brief + grids), `INSTRUMENT-GUI.md` (the kit
> outside the dialog), `SETTINGS-GUI.md` (the kit inside it), `PALETTE-GUI.md` (the strip).
>
> If the answer is not here, the answer is **use the nearest thing that already exists**. Do not
> invent a size, a hue or a radius. Adding to a kit is a decision Ek makes, not a side effect.

---

## 0. Which scope am I in?

Three, and they deliberately differ. Getting this wrong is the most common failure.

| | **instrument** | **settings** | **palette** |
|---|---|---|---|
| where | everything outside `#settingsModal` | inside `#settingsModal` | `.palette` |
| read at | arm's length, hands busy, lights down | a desk, looking straight at it | arm's length, hit with a finger |
| a control is | a mark you glance at | a thing you take hold of | an object you strike |
| button | 24 tall | 36 tall (30 in a table cell) | — |
| slider | 2px track, 2px tick | 4px track, 16px round knob | — |
| switch | 32 × 18, knob 14, 2px inset | 44 × 26, knob 20, 3px inset | — |
| segmented | 24 tall, r2, no padding | 36 outer / 30 inner, r8 / r6 | — |
| body type | `--fs-eyebrow` 11.04 | `--fs-page` 11.04, hint `--fs-hint` 10.24 | — |
| casing | lowercase | sentence case | lowercase |

**Never "fix" one scope to match another.** Two scopes, one reason: distance.

---

## 1. Spacing — the scale, as it renders

At `--ui-base-px: 16`. *(`tokens.css` comments state `--sp-5`…`--sp-8` wrong — they were computed
at a 15px base. These are the rendered values.)*

| token | rem | px |
|---|---|---|
| `--sp-0` | 0.125 | **2** |
| `--sp-1` | 0.1875 | **3** |
| `--sp-2` | 0.25 | **4** |
| `--sp-3` | 0.375 | **6** |
| `--sp-4` | 0.5 | **8** |
| `--sp-5` | 0.75 | **12** |
| `--sp-6` | 1 | **16** |
| `--sp-7` | 1.5 | **24** |
| `--sp-8` | 2 | **32** |

**THE RULE — a spacing value is one of exactly two things:**

1. a `--sp-*` step, or
2. a **named component token** with a measured reason — `--footer-cap-gap: 5px`, `--pal-gap`,
   `--footer-row`, `--footer-inset`, or `--seam: 1px` (abutting objects — a hairline in one
   object, never padding).

**Never a bare `px` — or bare `rem` — literal in `padding`, `margin` or `gap`.** Both units are
the same violation; `0.38rem` only looks intentional. If you are reaching for 5px or 7px there is
no step: snap to the nearest step, and name a component token only when you have **measured** that
the snap moves something. Recurring across unrelated components means it is not a component token
and does not get a name — 5px appears seven times and gets none.

**Exempt:** geometry (a centring offset that is half a known height — mark it `/* geometry */`),
`env(safe-area-inset-*)`, and `calc()` against a scale variable.

---

## 2. Type

| token | px | use |
|---|---|---|
| `--fs-nano` | 10.24 | **the floor.** Quiet text on a settings page. Nothing in the app is smaller |
| `--fs-eyebrow` | 11.04 | THE uppercase micro-label — pair with `--ls-widest` 0.18em |
| `--fs-body` | 12.48 | body inside a panel; a page lede |
| `--fs-control` | 14.08 | standard control label; settings nav |
| `--fs-md` | 15.68 | primary buttons, the brand mark |
| `--fs-xl` | 17.92 | settings page titles |

- **Urbanist only.** `Inter` and `Roboto Mono` are declared in the stacks but **not loaded** —
  naming either gets you the platform fallback and the only foreign glyphs on screen.
- Numeric readouts: `font-variant-numeric: tabular-nums`. Not a monospace face.
- A hint is a step **down** from the label it explains, never up.
- `--ls-widest` (0.18em) pairs with `--fs-eyebrow` and is the engraved-lettering setting. **The
  rails are the exception** and keep their own tracking — a rail under 250px cannot afford it.

---

## 3. Radius

| token | px | use |
|---|---|---|
| `--r-0` | 0 | slider tracks, flush edges |
| `--r-1` | 2 | controls |
| `--r-2` | 3 | grouped controls, segmented sets |
| `--r-3` | 4 | icon buttons, tooltips |
| `--r-hand` | 10 | an object grabbed with a whole hand — **the palette, and nothing else** |
| `--r-card` | 12 | **hero surfaces only** — the canvas wrapper, the settings dialog |

**Concentric rule:** nested rounded rectangles need outer = inner + the inset, or the corners
pinch. Palette: tile 4 inside bed 10.

---

## 4. The instrument kit — closed, six elements

| element | spec |
|---|---|
| **button** | `.mu-btn` **24** · `.mu-btn--lg` **38** (cabinet pill row) · `.mu-btn--bare` content-sized, no border/background/radius. **A 32px `.mu-btn` fails the audit by name** — 32 is legal, but only as `.tc-icon`, so the check is per-kind and so is this table |
| **a box sized by its text** | `.mu-h-content` — the marker that says so. Every other control-shaped element must land on 18 / 24 / 32 / 38, and `align-audit` R6 carries **no exemption list**: a row opts out by wearing this class, never by being added to the audit. Use it only where the height really is the content (a two-line name), never to quiet a derived height — that is the thing the kit round deleted |
| **icon button** | `.tc-icon` — 32px object, r4, glyph 13.33, no border, background or padding. *This is the precedent when you think you need a 32px button* |
| **segmented** | 24 tall, container **and** buttons, no padding, r2, **selected segment neutral — never ember**. `.seg-pill` (r999, flat tinted fill, no border) is the chrome-density variant |
| **status pill** | 18 tall, r999, no border, 6px dot + label. *For "is it true?" when you cannot set it here* |
| **switch** | 32 × 18, knob 14, 2px inset. On: track in the engine hue, knob the page ground. Off: track `--border-soft`, knob `--text-tertiary`. Flat, no border |
| **slider** | 2px track, 2px tick |

**A control that fills a named structural box takes the box, and gets no size of its own.** The
footer's buttons are **40** because `--footer-row` is 40 — the box is stated once and the button
fills it; same reason a settings button in a table cell is 30. This is not a sixth kit size: nothing
*else* may be 40. A check on this class asserts the height equals the **computed token**, never the
literal, so it follows the token if the box ever moves (ruled 2026-09-14).

**Which boolean shape?** The question decides, not the look:
| the question | the element |
|---|---|
| Is it true? (you cannot set it here) | **status pill** |
| Do you want it? (set and forget) | **switch** |
| Which one? (2–4 named modes) | **segmented** |
| Do it, now | **button** |

A page needing a seventh element is a page that should use one of the six.

---

## 5. The settings kit

**One row model, and it is not negotiable:** title + description left, control **flush right**,
one hairline above each row, every control group ending at the **same right edge**. Rows
**top-align always** — the control sits on the title's line at every description length.

**A description is one sentence and ≤ 92 characters** — two lines of the 46ch column it is capped
to (measured: 278px, 56.8 ch/line). Two sentences inside 92 is fine; a third is choppy, not dense.
There is no `--wide` escape. A row that needs a paragraph is a row whose control you will not find,
and the long version belongs in the doc that owns the subject. Enforced by `align-audit` R5.

**Double-click resets a slider to its default.** Kit-wide, stated once here and in
`KEYBOARD-SHORTCUTS.md` — never in a row's description. A per-row sentence explaining a global
behaviour is how the same sentence ends up written four times (ruled 2026-09-14).

**A live readout may contradict the description, and when it does it wins.** The prose is the
general case; `.set-row-status` is what *this build* does — Keys → OSC Input describes
`[udpsend …]` while its status line says OSC arrives on a websocket in browser mode, because
nothing listens on UDP there. That is the row model working, not a contradiction to fix. Comment
any status string carrying that weight, or the next person shortening it will strip the override.

| element | spec |
|---|---|
| **toggle** | 44 × 26, knob 20, 3px inset. On `--accent-action` + `--text-highlight` knob; off `--surface-5` + `--text-subtle` knob |
| **button** | 36 tall (**30** in a table cell), `--r-field`, 14.5px. Faces: light-primary / secondary / danger |
| **dropdown** | 36 tall, `--r-field`. Widths are roles, never free: **standard 190** · **wide 260** (prose — an address) · **narrow 120** (a prefix governing the control to its right) |
| **menu** | `--r-menu`, 6px padding, 34px items on `--chrome-bg-well`, selected `--surface-2` + ember check right |
| **segmented** | 36 outer / 30 inner, `--r-field` / 6px. **2–3 short options only** — four is a dropdown |
| **field** | 36 tall, `--r-field`, `--surface-0`. Widths: **standard 96** · **wide 260** · **host 140**. Focus = `--accent-action` border, **no glow** |
| **slider** | 4px track, 16px round knob, readout 64px right |
| **nav item** | 36 tall |

**A binding cell is the button in three states** — *a dash means unbound, blank means impossible*:
solid = bound · dashed `—` = bindable and empty · blank = no binding possible, draw nothing.
A cell that cannot be operated is never shaped like a control.

---

## 6. Colour — answer these in order

**1 · Is it material, or the engine that makes material?** → `--eng-*`. Hue is **identity**.

| | |
|---|---|
| `--eng-source` `#4aa3e8` | azure — what the brush inks from. The only blue |
| `--eng-lens` `#5fbf9a` | sea green — how the cursor reads |
| `--eng-tape` `#f2569e` | hot pink — recordings that play whole |
| `--eng-grain` `#e8a030` | gold — grains from a buffer. **The one warm engine** |
| `--eng-erase` `#be7ace` | orchid — material removed |
| `--eng-pins` `#cfc7bc` | bone — what the engines commit into. Not an engine |
| `--eng-none` `#857f76` | warm ash — no engine |

State on an engine surface is **brightness, not hue**: rest = the hue at low alpha; lit = hue at
20% fill, 2px border in the hue, `0 0 20px` glow in the hue. **That glow is the only sanctioned
glow in the app** — it means *sounding*. Nowhere else, ever.

**Ember owns 25–40°.** `--accent-action` and `--leg-button` live there. A new hue in that arc stops
reading as identity and starts reading as *an action*.

**2 · Is it an interaction state?** → `--accent-*`. Warm = you are acting. Cool = something else
has it.

| | |
|---|---|
| `--accent-action` `#e07b3c` | ember — do it, now |
| `--accent-lock` `#7fa8ae` | steel — held by something else; learn mode |
| `--accent-sensor` `#a793c0` | dusty violet — the body is driving it |
| `--accent-sweep` `#9db87e` | sage — it worked |
| `--accent-danger` `#cc6a55` | brick — it will not come back |
| `--accent-warn` `#c99552` | ochre — watch this |

**3 · Is it text?** → the `--text-*` ramp, twelve monotonic steps solved for measured contrast.
Captions and group labels take **`--text-secondary`**. `--text-faint` (2.7:1) is **disabled marks
only — never a word.**

**4 · Is it a line?** → `--border-*`. Translucent **warm** white.

**5 · None of the above?** → it does not need a colour.

**The palette legend** has its own three: `--leg-button` ember · `--leg-midi` grey · `--leg-delay`
amber.

**The cursor is not exempt** (ruled 2026-09-14 — it had six hand-written colours):

| cursor state | colour |
|---|---|
| a tool in hand | that engine's `--eng-*` — **this is the invariant**: the tile you pressed and the mark under your hand are the same colour by construction |
| nothing in hand | the warm neutral, from the ramp — never a cool grey |
| erasing | `--eng-erase` — it must match its own tile |
| recording | the `--mic-live-*` ramp — recording *is* the mic being live, and the top bar already says so in that colour |
| scan off (no lens) | **no colour — drop the fill.** The wash is the reach; nothing is being read, so the ring is empty |
| nearest | from the ramps, not a new violet |

---

## 7. Motion

| token | ms | use |
|---|---|---|
| `--m-touch` | 90 | hover / press — must feel like contact |
| `--m-state` | 190 | on, open, armed |
| `--m-decay` | 480 | glows and flashes fading out |

`--ease-out` and `--ease-snap`. **Never the browser default `ease`** — it starts slow and on a
control being played that reads as lag. **Only animate transform, opacity, colour and shadow.**
Never anything that triggers layout: the grain scheduler shares this thread.

---

## 8. Always wrong

1. **A cool or neutral grey.** Overlays are warm white `rgb(255,240,224)`. A pure-white hairline
   over a warm black reads blue — that is how "minimal dark UI" ends up cold by accident.
2. **A bare `px` or `rem` literal** in `padding` / `margin` / `gap`. See § 1.
3. **A new hue.** The ramps are closed. If nothing fits, the thing probably does not need colour.
4. **`--text-faint` on a word.**
5. **An inline `style="font-size:…"`.** It outranks every stylesheet rule and has silently beaten a
   correct contract six times. `grep 'style="[^"]*font-size'` before concluding a rule is broken.
6. **A font that is not Urbanist.**
7. **A gradient, drop-shadow or inset bloom as decoration.** Flat. The sphere is the only thing in
   the instrument with depth in it. (The lit-engine glow of § 6 is *state*, not decoration.)
8. **A raw colour, size or radius in `style.css`.** `tokens.css` is the single source of truth.

---

## 9. Before you say it is done

```
npm run audit:align     # invariants against the running app — incl. R1–R4, the spacing rhythm
npm run audit:docs      # doc staleness, no browser needed
```

**R1 is the one that catches you**: a bare px/rem literal in `padding`/`margin`/`gap`. If it fires,
the fix is a `--sp-*` step, not a new name.

**Do not claim something is aligned, centred, consistent or balanced without measuring it.** This
is the house's oldest rule and it has been broken every time it was skipped. Read the live values,
change one thing, read them again.

**An empty diff proves only that nothing *visible* moved.** Force each state and read it back.

**Absence is not evidence.** A frozen tail drops an entry when it is *measured and clean* — never
when it simply was not there. This has now bitten **four** times: 11 settings rows inside a
`<template>`, 33 of 104 checks querying a document that had not instantiated it, two source buttons
that exist only while their drawer is rendered, and **nine descriptions that exist only at
runtime** — built by JS, absent from `index.html`, so a source read misses them entirely. A probe
that cannot reach a thing reports a **coverage gap**, and the gap is the finding. Ask what fraction
of the matching surface a check actually read: R6 reads 21 of 660 with the rails shut and 68 with
the doors open.

**The source is not the surface.** Grepping `index.html` and `style.css` answers *what was
written*, never *what renders*. Measure the running app — that is what the align suite is for.

**Adding an invariant is the right response to any design bug that shipped** — it is usually four
lines, and it is the only thing that stops the bug coming back.
