# Settings GUI — the standard

> **Status: CURRENT** — written 2026-08-30. Governs everything inside `#settingsModal`.
> Companion to `docs/DESIGN-SYSTEM.md`, which governs everything outside it. Where the two
> disagree *inside the settings dialog*, this file wins; anywhere else, DESIGN-SYSTEM wins.
> The live spec is the design file (`Settings.dc.html`, options 1a/1b/1c). When a number here
> and a number there disagree, re-measure both before editing either.

> **Read this first.** Governs everything INSIDE `#settingsModal`. § 2 the row model (title + description + control flush right) is what every new setting follows; § 3 the kit is CLOSED at eleven elements — do not add a twelfth, pick one; § 5 sentence case; § 6 the four tokens the dialog adds. `css/settings-gui.css` loads AFTER `style.css` on purpose (rules tie on specificity). § 7 is the page-by-page application. Read § 2–3 for a new row; the rest only when the kit itself is in question.

---

## 1. Why the settings dialog is exempt from the instrument's numbers

The instrument is dense on purpose: 11px eyebrows, 2px slider tracks, 2–4px radii, lowercase
labels, controls you find by shape rather than by reading. That is correct for a bar you reach
into mid-set with your hands full.

The settings dialog is the opposite situation. It is opened **between** sets, read rather than
played, and every row in it is a decision made once. Its failure mode is not "slow to hit" but
"three pages that look like three applications" — which is what nine borrowed modal dialogs
produced, each with its own idea of what a label, a note and a slider are.

So the settings window is treated as a **window**: the conventions every desktop app converged on
(row = title + description + control flush right, 15px body, 36px controls, 8px fields, one
hairline per row). Not fashion — those conventions are what make an unfamiliar page legible on
first read, and the pages that need this most are the ones opened once a month.

The instrument keeps its own numbers. Nothing in this file crosses `#settingsModal`'s edge.

**The kit is ELEVEN elements: ten conventions plus one.** The ten are what every desktop app
converged on, and the argument for them is that they are already known. The eleventh — the
**meter** — has no desktop precedent to borrow, because it is not a form control at all: it is the
app's own subject matter, the only element on any of these pages that is *reading* rather than
*setting*. It is in the kit for the same reason the other ten are: one meter, defined once, so a
level on the audio page and a level in a mixdown group are the same object rather than two
canvases that happen to look alike.

## 2. The row model

**Title + description on the left, control flush right, one hairline above each row.** That is the
whole layout. What it replaces: `grid-template-columns: 9rem minmax(0,1fr) 4rem` — a label column
narrow enough to wrap two-word labels, a control column that stretched dropdowns into wide boxes,
and a value column that put a number 40rem away from the slider it belonged to.

- Row: `padding: 15px 0`, `border-top: 1px solid var(--border-faint)`, `gap: 24px`.
- Title: `--fs-set-row` (15px), weight 500, `--text-light`.
- Description: `--fs-set-hint` (13.5px), `--text-muted`, `line-height: 1.45`, `text-wrap: pretty`.
  One sentence. It says what the control does or what the units mean — never what the label
  already said.
- Control group: `flex: 0 0 auto`, right-aligned. A slider's readout is **inside** it, 64px wide,
  right-aligned, tabular-nums.
- Section: 16px/600 heading + optional status badge + one 13.5px lede, then its rows. 30px above.

**Where small text goes beside a control — three cases, and they are not a judgement call.**

| The small text is | Where it goes | Example |
|---|---|---|
| a **unit that names what the control measures** — read before you use it | LEFT of the control (`.as-dim`, `order: -1`) | "frames", "stereo field" |
| a **unit that is a numeric suffix of the field's own value** — part of the number | INSIDE the field, after the input (`.set-field-unit`) | `90°`, `127`, `2.0` |
| a **live readout** — what the control currently says, read after | RIGHT, in a 64px column (`.as-val`) | "10 min", "−6.0 dB" |

The middle case is the one that was missing, and it is not a variant of the first: `° 0 – 90` is not
a sentence, and a unit parked to the right of a pair of boxes leaves them ending short of every
other control group on the page. `_numbox()` already took a unit argument — it renders it inside
the box. Anything longer than two words is not a unit; it belongs in `.set-row-desc`.

A row with no description is fine. A description without a control is a note, and a note that is
not attached to a control is documentation — put it in `docs/`, not on the page. **One place
documentation IS allowed on a page: the empty state** (round ten). The sensors page's transport
copy folds to a one-line summary under the list count while anything is connected, and reappears
in full only when the list is empty — the moment it actually tells someone something.

## 3. The kit — eleven elements, closed

| element | geometry | notes |
| --- | --- | --- |
| toggle | 44 × 26, knob 20, 3px inset | on = `--accent-action` + `--text-highlight` knob; off = `--surface-5` + `--text-subtle` knob; disabled 50% |
| button | 36 tall, `--r-field`, 14.5px; in a table cell, 30 | three faces: light-primary (`--text-light` ground, `--bg-app` label, weight 600), secondary (hairline `--border-soft`), danger (`--accent-danger` hairline + `--status-error` label). **A BINDING CELL is this button in three states**, and the rule between them is *a dash means unbound, blank means impossible*: **solid** = bound and rebindable · **dashed `—`** = unbound and bindable, an empty slot · **blank** = no binding is possible, so nothing is drawn. A cell that cannot be operated is never shaped like a control, and "n/a" is a third word for what blank already says. There is no fourth state: one was specified and built for a fixed default that cannot be rebound, and deleted when the ACTIONS table turned out to contain no such case |
| dropdown (+ its menu) | 36 tall, `--r-field`, chevron right; the open menu is `--r-menu`, 6px padding, 34px items on `--chrome-bg-well`, selected = `--surface-2` + ember check right-aligned | a menu is what a dropdown looks like when OPEN; it never appears without one, and CLAUDE.md already listed them together. Three ROLES, never a free width: **standard** (190) is the page column; **wide** (`--wide`, 260) is for a value that is prose — an address, a device name; **paired prefix** (`--narrow`, 120) is a one-word selector that GOVERNS the control to its right — the mapping page's output kind, which reads as the subordinate control if it matches the destination beside it. Never stretched |
| segmented | **36 outer / 30 inner**, `--r-field` outer, 6px inner | 2–3 short options only; more than three is a dropdown. 36 matches the dropdown and the field beside it — this table said 32 until round eight, and the app was right |
| slider | 4px track, 2px radius, 16px round knob, ember fill | readout 64px right, tabular-nums |
| field | 36 tall, `--r-field`, `--surface-0` ground; a suffix unit sits inside it, right of the input | focus = `--accent-action` border, no glow. Same three roles as the dropdown, and for the same reason: **standard** (96) is a number, and a PAIR of them ends on the same right edge as a 190 dropdown; **wide** (`--wide`, 260) is prose — an OSC address; **host** (`--host`, 140) is the one shape that is neither, an IP that will not fit 96 |
| device list | `--r-menu` box, 52px header, 13px rows | header states the count and carries one action (Rescan); rows are index · state mark · name + sub-line · right edge. The sub-line is the WIRE AS A MARK (`.set-wire`: the wifi arcs, the usb trident; a bare OSC sender keeps its word) then only what changes — rate, role — repainted on the page's 1 Hz tick; kind and serial go to the row's tooltip (Ek, 2026-09-09: "a bit too much info"). A connected row's right edge is the **Connected** badge (sage) and the rail's ⋯ door (`.set-device-more`, the small button, lit while the block below shows this sensor) — "Selected" named the list's own mechanism where the rig's state belongs; Blink appears only with two or more connected. An idle row's is Connect |
| table | a fixed-column grid; header row `--fs-set-hint` in `--text-muted`, rows at body size and **no taller than 56px**, hairline per row | no zebra, no outer frame. The 56px ceiling is a TABLE-row rule: a `.set-row` is title + description + control and runs taller by design. A **READOUT** is a type role, not an element: a value fixed elsewhere (the OSC port, set at launch by `--osc-port`) is plain right-aligned tabular text in the control slot — no box, because a box is the promise of an edit |
| badge | 22 tall, `--r-field` / 6px, 12.5px | grey = neutral/Beta; sage = connected; ochre = reconnecting; brick = no signal; violet = a sensor's identity |
| meter | one row per channel, ONE dB ruler per group · 54 label · 6px track · 64 readout · 10 pip | **curved scale** (pow 1.5 — the top 20 dB take half the track); the number is **rms**, the held tick is **peak** (the gate tests `max(rms, 0.7×peak)`, so rms is what a threshold is set against); the heat ramp is anchored to the **scale**, not to the fill, or a quiet signal paints its own tip red; **lit band −18…−6** says where to aim; the ruler, its labels and the threshold caption are **`--fs-set-tick`** (11.5px) — an eighth size, the only one below the badge, and it belongs to the meter alone: `align-audit` fails if anything else wears it; the **threshold variant** is the same element carrying a draggable marker — that is the paint gate, and it is the ONE sanctioned short row: inside a control group it is track + readout only, no 54 label and no pip, because the `.set-row` above it is already titled and a 300px group cannot spend 64px on two elements that say nothing (nothing clips a paint gate). Don't add spacers to it for parity |
| empty state | centred, 38px vertical padding | primitive-shape mark, one 14.5px line, light-primary + secondary button |

Colour comes from `tokens.css` and nowhere else. The accent inside settings is
**`--accent-action`** (ember) — the teal `--set-accent` the sliders used was a fifth colour system
nobody had signed off.

## 4. Chrome

- Dialog: 1180 × 760 max, `--r-card`, `overflow: hidden`. The content pane is the **one** scroller
  (`ui-settings.js` already relies on this — see the `overscroll-behavior` note in style.css § on
  the hosted dialog).
- Nav: 250px, ground `#161311` — one warm step **up** from `--bg-app`, because at `--bg-deep` the
  nav and the page were both simply black and the seam did all the work alone. Items 36 tall,
  `--r-field`, 14.5px, one 16px primitive-shape icon each; selected = `--surface-3` filled row,
  `--text-light`. Group headings 11.5px, `--ls-display`, `--text-dimmer`.
- Header: 60 tall, title 20px/600 `--text-highlight`, sentence case. Page-level actions live here
  (Speaker sweep), then the ✕ as a bare 34px glyph.

## 5. Casing

Sentence case, inside the settings dialog only: "Sample rate", "Master volume", "Recording limit".
The instrument stays lowercase. This is the one place the app runs prose — a description line in
lowercase reads as a code comment, not as an explanation.

### The kit loses to its own page contract unless it is stated at the same depth

`html body .settings-host .set-x` is (0,2,2). The § 24 restatement near the top of
`settings-gui.css` is `html body .settings-host .in-settings span` — (0,2,3) — so **it beats every
kit rule written one level shallower, on any element that is a span, div, p, label, td or button.**
Only type is affected (`font-size`, `letter-spacing`, `text-transform`); height, colour and
background are not in that sweep and still land.

This has now been found twice. The badge and device families were fixed when the sensors page was
built. The **meter** was missed and shipped wrong: its ruler and threshold caption rendered at 14
instead of 11.5 and its channel label at 14 instead of 13.44, on all three meter pages, from the day
it landed. It survived a round of measurement because the rules were read rather than the elements —
and it made the type-ramp check *pass by being broken*, since 11.5 was never on the ramp until the
rule started applying. When adding a kit element, write it at `.in-settings` depth, and check a
rendered element rather than the stylesheet.

## 6. Tokens added

```css
--fs-set-body: 0.875rem; /* 14.00px — body text inside the dialog      */
--fs-set-sub:  0.8125rem;/* 13.00px — a sub-line under a name or number */
--fs-set-tick: 0.71875rem;/* 11.50px — a meter tick. The ruler, its labels and
                             the gate's threshold caption, and nothing else. */
--fs-set-row:  0.94rem;  /* 15.04px — a settings row's title           */
--fs-set-hint: 0.84rem;  /* 13.44px — its description, one step down   */
--r-field:     8px;      /* fields, buttons, dropdowns, nav items      */
--r-menu:      12px;     /* popovers, device lists — matches --r-card  */
```

**The rem value is canonical, the px is the reading.** These are `rem`, so they
follow `--ui-base-px` like everything else; at the base of 16 they compute to
14.00 / 15.04 / 13.44, and those are the numbers an audit should expect. Round
figures in prose ("15px", "13.5px") are the intent, not the contract — do not
report 15.04 as a miss.

**Body text is 14px, and that retires the instrument's voice inside the dialog.**
`style.css` § 24 brings every hosted page down to the instrument's reference —
`--fs-page` 11.04, `--fs-hint` 10.24, declared on `.settings-host` and spent
across some sixty selectors. `settings-gui.css` re-points both variables at the
same depth, declared later, so every one of those rules resolves to the window's
sizes without a single `!important` and without touching § 24. Nothing inside
`.settings-host` is 11px, and nothing is uppercase except the nav's group
headings.

The radius scale topped out at 4px plus the 12px hero card, and an 8px step is exactly what a
36px-tall field needs: at 4px it reads as a 2px control that grew, at 12px it reads as a pill.
The two font sizes are named rather than borrowed so a settings row cannot drift onto the
instrument's ramp, which is where the 11px pages came from.

## 7. Applying it to the remaining pages

**The session page's reset is on the page, not a popup** (Ek, 2026-09-12, night). Two rows of the
kit: **Reset all**, a danger button armed by one click and fired by the next (the armed face is the
danger face filled, `.set-btn--danger.armed`, for four seconds) — the arm is the confirmation; and
**Reset selected**: one `.set-row` per storage category (`CATEGORIES` in `js/storage-registry.js`,
title in sentence case, the hint as the description) with the kit's toggle flush right, then the
button, live only while a toggle is on, its description naming what is selected. Unregistered keys
are named in a lede under Reset all. `js/main.js` `initResetSection`.

`settings-gui.css` styles the shell and the kit. Each hosted page still needs its markup taken
from `.as-row` (label + control) to the row model (title + description + control). **Done: `audio`,
`sensors`, `led feedback`, `mapping`, `camera + display`, `export · import · reset`,
`keys + MIDI`, `visuals`, `pins`, `instrument buttons` (2026-09-09: the three buttons × press · long · ×2 · ×3, the two windows, the last gesture).** Remaining: `OSC reference`, and it is proposed for deletion —
every address and data type it lists is already the Action column's sub-line on `keys + MIDI`.

**Round ten (2026-09-01, docs/archive/SENSORS-ROUND-TEN.md) reshaped the sensors page again**: the
Sources table is GONE (its facts are the list head's summary line and the empty state), the page
scrolls with two renamed layer headings (Software settings / Device settings — Ek reversed the
brief's R4 on the rig, and every disclosure door went with it), the three zeros are one "Where forward is" row (app-side only — S2's
ruling keeps the on-device tare with the device's own rows), the Axes table lost the NWU
column, the nine measurements moved to Diagnostics, and attach is one "Add over USB" button whose
two choices expand in place (S1: the two pickers cannot merge — Electron answers the port chooser by taking
the first port, safe only because the instrument's request is vendor-filtered). Five checks in
align-audit's "sensors round ten" section hold the shape.

**The sensors page had a second pass (2026-09-01, Ek: "simplify without losing
any info… maybe it should be in a table form… the connected sensor is in a box
of sorts to show that it's like a thing").** Two moves, both compositions of
existing kit elements rather than new ones. *Sources* became a table — four
static rows of prose, three with no control, are this file's own definition of
documentation, and as `source · what arrives · status · action` the same
facts read in a third of the height, which puts the device list on the first
screen. *The selected sensor* became a boxed card: the device list's own box
geometry (`--r-menu` border, 52 px `--surface-0` header strip —
`.imu-setup-card` / `.set-card-head`) reused as the container for its rows,
so the sensor reads as an object with a name, an identity and a liveness
number, holding its settings. The Mounting row's seven-line description was
also cut to the one sentence this file requires — the dropped reasoning was
already verbatim in the Calibrate button's tooltip.

**The 42.8px section rhythm was never designed** (found 2026-09-01, second sensors
pass): the borrowed `.mu-dialog` is flex with the rig view's 0.8rem gap, and inside
the shell that 12.8px stacked onto every section's 30px margin — audio, visuals and
sensors all ran 42.8 while pins, hosted from a different element, ran the 30 this
file specifies. `.in-settings` now sets `gap: 0`; the section margin is the one
number. Same pass: layer heads inside the sensor card take the section's 30 above,
and the card's insets are 16px — the device list's own inset — top to bottom.

**The standard is fully applied, and `style.css` § 24 is gone.** § 24 was the settings type contract:
`--fs-page` / `--fs-hint` on `.settings-host`, then ~120 lines naming every class that could put text
on a hosted page and sweeping it to an 11.04px body. It existed because the pages were unconverted —
each carried its own rig-view markup, so the only way to give the shell one voice was to sweep. With
every page on the row model the block had no users left: deleting all 139 lines moved **nothing** on
any of the ten pages.

It was also the cause of the specificity problem this document kept recording. The sweep was (0,2,3);
a kit rule one level shallower is (0,2,2), so `.settings-host .set-x` lost to
`.settings-host .in-settings span` on every span, div and p. Five rules had been written to out-rank
it — the meter's whole type block, the badge and device-name family, the mapping sentence's child
spans. All five are gone with it. What survives is three rules that target a **bare span**, which the
body-size default names directly, so inheritance from the parent is not enough; they are listed
together in the stylesheet with the measured evidence.

Two things the teardown surfaced that were never about § 24. `.set-empty` had been held at 14 by the
sweep, against the 14.5px this table specifies — collapsing it restored the kit's own size. And
`.set-device-n` carried a `13.5px` literal, 0.06px off `--fs-set-hint`, which is the seventh-step
problem noted in this file for `.set-btn--sm`; it is the token now.

`visuals` regroups by **what a control affects**, not by which cabinet section it came from: View, Cursor,
Particles, What size and colour mean, Performance. The last of those is the pair of calibration windows —
how big a mark can get is a different question from what its size *means*, and they were adjacent sliders
with the same words on them.

`pins` is params only, and that is #270's ruling, not this round's: the slot bank, the mode picker, the
D / hold-D / ⌘D buttons, clear-all, cloud, loop and morph are all hidden by `style.css` because the tile
screen owns them. Seven rows survive, in two sections — Slots and Playback. Two traps it paid for: the
shell puts `.in-settings` on the borrowed node **itself**, so `.in-settings .device--commit` matches
nothing (they are one element, not two), and `style.css` caps a commit section at 34rem for the rig
view's narrow column, which left the whole page ending 316px short of the app's only right edge.

`keys + MIDI` was the widest page in the app and the cut is the whole design: **ten columns became
four.** `osc` and `data` were never independent facts — an address and what it accepts *describe*
the action, so they are its sub-line. `key learn` and `midi learn` were columns of buttons pointing
at the cell beside them, so **the cell became the button**: click to learn, right-click to clear.
`min`, `max` and γ are read constantly and edited rarely, so they are a menu behind a cell that
reads them out — three always-on columns were three columns paying rent for a popover. The live
monitor is a **device list**, not a twelfth kit element: a header stating a count with one action,
over rows.

The last two were plain row pages and took an afternoon between them, which is what a page costs
once the kit is right. Both are entirely PROXIES — `data-proxy="<id>"` presses the real button in
the rig cabinet — so neither page owns a control or a listener. `camera + display` is the first page
to carry a `.set-row-status`: frame time, fps and grain count under the performance monitor's
description, written at 2 Hz only while that page is open.

`mapping` is the master–detail one: fourteen controls on a line became a list of sentences plus six
rows that are the signal chain in order. Two things it proved worth knowing. A `.set-device` list
row is **63.5px** — that is the device-list row, not a table row, so the 56px ceiling above does not
apply to it; and `.set-table-sub` carries `line-height: 1.15` for the LED table's ceiling, so a
device list has to put it back to `normal` or the two lists sit 1.05px apart. And the sentence's own
child spans need their size stated: `.in-settings span` sets 14px at a higher specificity than
inheritance, so a container at `--fs-set-row` measures 15.04 while every word inside it renders 14.

Each conversion also owns one entry in `align-audit.js`'s `KNOWN_GATED` list — the module's
live-update path gated on the overlay's `.open` class, which is false exactly while the page is
hosted. Delete the entry as part of the page.

Two things that will bite, both already paid for once in `style.css`:

- An inline `style="font-size:…"` in `index.html` beats every rule here. `grep 'style="[^"]*font-size'`
  before concluding a rule is wrong.
- Specificity is not reading order. `.settings-host .in-settings .grain-seg .grain-seg-btn` is four
  classes; being further down the file does not beat it.
