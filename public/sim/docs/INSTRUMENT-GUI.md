# Instrument GUI — the element kit

> **Status: CURRENT** — the instrument's element kit, verified against the built app 2026-08-30.
> Governs the rig view: chrome, tool rail, footer, cabinet, engine sheet, palette.
> Companion to `docs/SETTINGS-GUI.md`, which governs everything inside `#settingsModal`, and to
> `docs/DESIGN-SYSTEM.md`, which holds the aesthetic and the reasoning this file turns into parts.
>
> Every number below was read from the live app. Three were wrong in the first draft and are
> corrected here: the segmented control is 24 tall throughout (its container has no padding), the
> status pill's dot is 6px, and the instrument switch was **specified but not built** until
> 2026-09-03, when a grain brush's WET setting became its first instance (`.mu-switch`, in the
> sheet head). Treat a disagreement between this file and a measurement as this file being wrong,
> and fix it the same day.

> **Read this first.** The element kit for everything OUTSIDE `#settingsModal` — chrome, tool rail, footer, cabinet, engine sheet, palette. One section per question: § 2 the button (two sizes plus `--bare`, five faces, the held test), § 3 the four boolean shapes, § 4 the radius scale and `--r-hand`'s concentric arithmetic, § 5 type and the rails' tracking exception, § 6 the `--eng-*` hues. Read only the section for the element you are adding or changing; § 7 for workflow. Companion: `docs/SETTINGS-GUI.md` governs everything inside the dialog.

---

## 1. Why there are two kits

The settings window is read between sets, at a desk, looking straight at it. The instrument is
played mid-set, at arm's length, with your hands busy. Those are different jobs and they get
different numbers — 15px rows and 36px controls in there, 11px eyebrows and 24px controls out here.

What they share is the *vocabulary*: the same question always gets the same shape, and a control's
size never means anything on its own. Where a control exists in both scopes it appears in
`DESIGN-SYSTEM § 5`'s two-scopes table with both sets of numbers, so nobody "fixes" one to match the
other. That table currently holds the slider, the switch and the segmented control.

## 2. The button — one element, three sizes, one box question

There were 42 button classes. What they actually contained was **three sizes and two smears**;
the smears were padding-plus-font arithmetic nobody chose.

| class | height | where |
| --- | --- | --- |
| `.mu-btn` | 24 | the default for chrome |
| `.mu-btn--lg` | 38 | the cabinet's pill row — play/mute, paint indicator, session |
| `.mu-btn--bare` | content-sized | a text action with **no box** |
| `.mu-h-content` | content-sized | a MARKER, not a shape: this box is sized by its text. It is how a row opts out of the kit **in the markup**, so the audit never needs a list. Its one carrier, the pinned rail's two-line hold, went with the mixer (2026-09-16) — nothing wears it today, and the next two-line box is what it is for |

**The set is closed at two sizes plus `--bare`, and an audit check enforces it.** A 32px button
fails by name. There was a `--md` at 32; it ended with zero users and was deleted, because a size
with no users is the same mistake as a face with no users. If something needs 32px, the **icon
button** is the precedent — `tc-icon`, its own element, a bare glyph at r4/13.33 with no border,
background or padding.

The **segmented control is also not a button.** Its selected state is neutral, not ember, and its
radius, padding and font all differ; a segment button is a *part* of the segmented control the way a
device row's state mark is a part of a device row. Parts are not elements.

**Size and box are independent.** `--bare` is not a modifier — it was tried as one and had to unset
nine properties to say one thing, which is a shape pretending to be a variant. A bare button has no
border, no background and no radius; its height is elastic *because there is no box edge to align*,
and that is correct rather than broken. `top-bar-btn` rendering at five heights between 23.8 and
28.8 was the finding that made this obvious.

### The faces

Orthogonal to size. Every one has a live user; none was invented.

| face | treatment |
| --- | --- |
| default | `--text-dim` on `--surface-1`, hairline border |
| `.on` | ember **border only, no fill** — exceptional engagement |
| `.on--held` | adds fill and a glow |
| `.mu-btn--danger` | brick text, brick hairline |
| `:disabled` | `--text-faint`, `--border-subtle`, no background, `cursor: default` |

**`on` is not `selected`, and the difference is a rule: ember means exceptional, neutral means
chosen.** A segmented control always has exactly one active segment, so its selection is never
exceptional and must never be ember — every segmented control in the app would glow permanently and
the colour would carry no information. A button's `on` state is exceptional, because most buttons
are off. Conflating the two is the same error as giving four different questions one box with a dot
in it, one level down.

`opacity: .25` on a whole button is **not** a disabled face. It dims the label and the border and the
background together, which is why a disabled control used to read as a rendering artefact.

**The held test, and it is a real test:** *can you afford to miss this state during a show?* Mute
qualifies and nothing else does — the thing that tells you mute is on is silence, and silence is
also what a broken cable sounds like. Record-arm does not qualify: you just armed it, so you already
know. Anyone adding a third holder answers that question aloud first.

### Flash

One transient modifier whose colours come from variables — ember for an action on that control, sage
for a sweep. It is not two faces. The two flashes carry different border alphas and that is left
alone deliberately: **two states that never appear at the same time do not need to match.** A sweep
flash and an action flash are never on screen together, so there is nothing to compare and
normalising them would cost a visible change for nothing. That is coincidence, not drift.

**A modifier is carried under whatever name its surface already uses**, the way `.on--held` is
carried by `.muted` on the chrome's play/mute pill. The flash has two carriers:

| carrier | surface | note |
| --- | --- | --- |
| `.flash` / `.flashing` / `.sweep-flash` | `.mu-btn` | ember, or sage for a sweep |
| `.fired` | `.trow--act`, the pinned rail's action rows | ember, no border — a rail row has no box |

Both read the same `--mu-flash` / `--mu-flash-soft` variables, which is what makes them one modifier
rather than two that happen to look alike. `.fired` was written into `_pinFlash()` in #256 and had
no rule at all until 2026-08-30: the class went on for 180ms and nothing changed on screen. A
modifier with a carrier and no rule is the failure this table exists to make visible.

## 3. Booleans — four questions, four shapes

Five shapes used to mean "boolean". The cause was not indecision: **four different questions all got
a box with a dot in it.** Name the question and the shape stops being a choice.

| the question | the shape |
| --- | --- |
| **Is it true?** You cannot *set* it here | **status pill** — 18 tall, radius 999, no border, 6px dot + label |
| **Do you want it?** Set and forget | **switch** — 32 × 18, knob 14, 2px inset. Track in the engine hue when on, knob the page ground; flat, no border. Every true boolean ON an engine sheet (`.prow--sw` > `.ds-sw`, 2026-09-07: `fade`, `chop`, `loop on end`, `cloud on end`, `link`), and since 2026-09-10 a grain brush's **wet** as the first row of its DEPOSIT section (`[data-wet]`; it was a head item with a droplet from 2026-09-03). On the engine sheet the OFF track is `--border-soft` and its knob `--text-tertiary`, not the settings kit's `--surface-2` at 6.5 % — that is a desk-lamp value and this kit is read at arm's length with the lights down (§ 1). Those four wore the SEGMENTED shape until then, which answers "which one?" and made a yes/no read as a mode pick — Ek: "there's already a nice toggle design, the engine sheet should use that if it is on and off" |
| **Which one?** Two to four named modes | **segmented** — 24 tall (container and buttons both; no padding), radius 2, selected segment **neutral** |
| **Is it engaged right now?** Held, then over | **not a boolean shape** — a button wearing its `on` face |

**A pill may carry a shortcut.** A status that also opens the page where its value *is* set keeps the
pill: reads as information, reveals the click on hover by lifting its ground one step, never looks
like a switch. Clicking does not change the value, which is why the pill stays honest. This is a
modifier on the readout, not a fifth shape — the kit stays at four.

**A pill with segments is a control; a pill with a dot and one label is a readout.** Nobody confuses
those, which is what lets `.seg-pill` and the status pill share a silhouette.

**The rig readouts are a GLYPH with a dot** (`.tc-readout`, 2026-09-09; Ek: "minimalist"): the
same 32px object as `.tc-icon`, so the chrome is glyphs end to end, with a 6px dot at the glyph's
foot. The glyph is the subject (mic, the sensor mark), the dot's colour is the state, and the
detail is the tooltip (`input · mic —`, `sensor · wifi 2 —`), written by `tile-layout.js` into
`data-title`. Round ten's `● SUBJECT · slot` word pill (`.mu-pill`, fixed 42px slot) is git history;
its invariant survives — a readout glanced at forty times a set never changes width — and
align-audit's "sensors round ten" section still drives every state and measures it. The states:

| state | dot | slot |
|---|---|---|
| absent | `--text-faint` | `—` |
| found | `--accent-warn` (ochre — the one state where clicking through is the point) | `found` |
| up | `--accent-lock` (steel — a sensor feed you are not driving) | `wifi` / `usb` / `osc`, `+ N` only when >1, transport = the one carrying the cursor |
| lost | `--accent-danger` (brick — it was up and the messages stopped) | `lost` |

The sensor readout reads `S.rig` — the fact `main.js` resolves from the `sensor-status` event —
never the rendered text of the hidden footer node (R10; the old regex-strip is an audit failure
by grep now). The input readout's subject is `input`, detail `mic` / `live` / `file` (R11, ruled).
The camera capsule beside them is three glyphs (pointer, orbit, the sensor mark) since the same
day — "steer surface sensor should be 3 icons" — with the words in the segments' titles.

No native `<input type="checkbox">` anywhere. A checkbox is a form control and nothing here is a
form.

### `.seg-pill` — the chrome-density segment

Footer, tool rail and engine sheet, where a bordered box adds too much line: uppercase, `--fs-meta`,
no border, flat tinted fill, radius 999. The plain bordered segment is the panel one. Same control,
two densities — and the settings window's is a third, at 36 / 30 with radius 8 / 6.

## 4. Radius

`--r-0` 0 · `--r-1` 2 · `--r-2` 3 · `--r-3` 4 · `--r-hand` 10 · `--r-card` 12.

`--r-hand` exists for one reason, and it is arithmetic rather than taste: **nested rounded
rectangles need the outer radius larger than the inner by about the inset, or the corners pinch.**
The palette is a bed holding 53px tiles with a ~6px inset at the top and sides, plus the key legend's line under the tile row (81 tall since 2026-09-11; 65 before, when the legend was inside the cell) — so tile 4 and palette 10 is exactly
concentric (since 2026-09-11 the palette is ONE ordered list of up to nine tiles of one design, no beds and no hairlines — the factory list wide · line · pen · all · overdub · unpin · pin, pin farthest right, no position number drawn — a tile wears the key that PLAYS it, and NO tile wears a resting mark at all since arming went on 2026-09-11 — LIT is the only face the strip has; there is no cap tile, the cap being no lens on, and a lens tile off is a grey glyph with no box — two ACTIONS in the same box, grey glyph, no playing face, a flash; the inset is unchanged). Anything else looks either pinched (7/10, under by 3) or like a rounded pill holding
square chips (4/12, over by 2). Both were tried and measured.

Its docstring is *"an object you grab with a whole hand rather than a fingertip — the palette today,
and nothing else until something else earns it."* If a second object claims it, check the
arithmetic first.

## 5. Type

`--fs-eyebrow` (11.04) + `--ls-widest` (0.18em) is the house engraved lettering: use it wherever a
caption names a control.

**One documented exception: the side rails.** Neither rail can afford 0.18em on a multi-word label
— the tool rail (`.tc-lrail`) is 248px (216 until 2026-09-10), and the pinned rail (`.tc-rail`) was
246.4px until the mixer (320px since 2026-09-16), inside whose 221.4px content box `unpin all`
wrapped to two lines at the tracking it already had. The exception has a reason and the reason was
the rail's width; the tool rail still has it. `.lyr-bar button` also carries a 0.09em literal that
no token equals, so tokenising it would change what renders; it stays, deliberately.

**The rail has one row model, and it is the fix for the wrapping:** one item per row, mark or label
left, keycap or affordance flush right. The action cluster was the only thing in that column still
laid out as a wrapping chip group, which is why it fought the width: a narrow column cannot carry
two layout models, and the inline one is the one that broke. Stacking the actions costs one row of
height and buys a fixed rail height and explicit copy, which matters for a destructive action you
hit mid-set.

**The pinned rail is a mixer since 2026-09-16** (`docs/RULINGS.md` "the track is its fader").
Since 2026-09-25 there are no action rows at its foot. **Unpin all** is a row of the top block with a
24 `.mu-btn` danger button flush right. The mix mute is **ALL**, a third bus under clouds and loops:
their mean level, and M with no S. The pins themselves are TRACKS — a
row per pin in three columns (2026-09-23): the number in the engine hue — ringed by the white O
when it is the loop an overdub would join, the tape tile's overdub flag — then the 32px BOX, the
fader and only the fader: its fill is the level, the material drawn edge to edge inside it, the
playhead, the dB readout on a chip of the rail ground — then M and S (the 18px pair). Nothing that comes and
goes sits in the box, so the material never changes width; the bus lines use the same columns, so
every box shares one left and one right edge, and every row, bus line and the mode bar's CARD
another. **The mode bar sits on a card since 2026-09-22 night** — the tool rail's
own `#instrPanel` design: `--surface-3` (was `--surface-1` until 2026-09-26: "i barely notice it"), `--r-hand`, 12 in from either rail edge, 12 of air on all
four sides inside, `--sp-6` under the bar — and its rows are the tool rail's `.mrow`: one setting
per row (follow · sort; the curve went to Settings → Pins on 2026-09-23), 30 tall, the name in `.mrow-l` at card + 12, the control flush
right, a yes/no the switch and a which-one the sheet's `.opt .seg` at 24 (not the chrome's 28
`.seg-pill`), in sentence case like every capsule in the rails and the drawer. `npm run
audit:align` "the mixer" measures exactly that.

**The principle behind the right column: no fact appears twice in a row.** If the label says
`pin Q` and the right column says `Q`, the row states one fact in two places and the column stops
meaning one thing — it becomes "sometimes the key, sometimes the group". The label carries the VERB;
the right column carries the key that performs that row's action; a row with no key has an empty
column. That is the reason, and it holds whatever the column ends up showing.

**The column is NOT settled, and § 5 should not pretend otherwise.** As built it shows the
armed-group keys (`=` pin, `−` unpin); `mockups/rail-9a.png` option B draws the group letter (`Q`
on both rows). Both are defensible because *both are real keys for these actions* — the map is:

**Settled by the 2026-08-30 sunset**, which removed the question rather than answering it: there
are no named pin groups, so there is no armed group, no group letter to draw and no `⇧Tab` to
change it. The map is two keys.

| does | keys |
| --- | --- |
| pin | `=` |
| unpin the selected pin | `−` |
| unpin all | none |

The keycap is `--fs-nano` mono. The
empty state, `nothing pinned`, is `--fs-eyebrow` (11.04) rather than `--fs-body`: it is a caption in
a 246px column, and a step above the actions read as the loudest thing in an empty rail.

Widening the rail was considered and rejected: the rails' widths are load-bearing against the
canvas, and a rail that grows to fit its longest word will do it again.

*(Ek's mockup for this is `mockups/rail-9a.png`, option B — repo root, not `docs/mockups/`, which
holds only `brush-model-ui.html`.)*

## 6. Colour

Tokens or nothing. Every literal is on a shrinking budget the audit enforces, and a colour not on
the budget fails the build.

The one thing worth knowing about the palette's history: three colour systems ran in parallel until
the August token pass, and the survivors were all **cool greys and saturated hues in a warm
interface** — `#6abca0`, `#5aba80`, `#e8c840`, `#505050`, a grey ramp from `#252525` to `#d0d0d0`.
When a literal has no token, the likeliest explanation is that it predates the tokens, not that it
needs a new one. Show both values before inventing anything.

Status: `--status-ok` sage · `--status-warn` ochre · `--status-error` / `--accent-danger` brick ·
`--accent-action` ember · `--accent-sweep` sage.

**One cool accent is deliberate.** `--accent-lock` is a teal, `rgb(127,168,174)` — the only cool
hue in the palette, and it earns that by meaning something the warm hues cannot: **held by something
else.** A locked parameter, a sensor feed you are not driving, the mic's ready state. Warm means you
are acting; cool means something else has it. It is a named token, not a survivor — the four
survivors were `#6abca0`, `#5aba80`, `#e8c840` and `#505050`, all of which are gone.

The warn dot lost ~24% luminance moving to ochre; if it stops reading at a glance mid-show, **the
fix is the dot's size or a ring, not a brighter colour.**

**~50 grey literals remain** where a token exists but holds a genuinely different colour — mostly
cool greys from before the palette change. Left deliberately: the budget stops them growing, and
warming them is a visible change with no functional gain. Pay them down when a region is being
touched anyway, never as a push.

## 7. How to work on this code

The rules that made twenty-five rounds of change safe, in the order they earned their place:

1. **Measure the screen, not the source.** The pins page hid seven controls behind a documented
   block. `top-bar-btn` has five heights. `.as-io-reset-btn` renders zero times. A class in the file
   is not a class on screen.
2. **Zero-diff is the deliverable.** `scripts/screen-probe.mjs` records box and computed style for
   ~2,800 elements; snapshot, change, diff, explain every line.
3. **An empty diff proves only that nothing *visible* moved.** A rule for a state that is not on
   screen is invisible to it — the status colours diffed to 0 while genuinely changing. Force each
   state and read the value back.
4. **The measuring instrument needs its own test.** `probe-selftest.mjs` must be green before any
   diff is trusted. It was wrong four times: absolute coordinates in a scroller, live-driven
   geometry, a class name inside its element key, reordered siblings, and — worst — the probe
   disturbing what it measured by leaving a borrowed node out of the cabinet.
5. **A stop is a success.** Three rulings in this project were reversed because a measurement
   contradicted them and the measurement was reported rather than absorbed.
6. **Delete rather than keep.** A class with zero usages, a state with zero users, a doc row for a
   sunset module: all cost more than they save. Three features were advertised as shipped with their
   code in `sandbox/sunset-2026-08-29/`.
