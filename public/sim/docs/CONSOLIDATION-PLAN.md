# Consolidation plan — pre-ruled, work through it end to end

> **Status: CURRENT** — the pre-ruled plan for consolidation rounds 26+, written 2026-08-30.
> Every item below is already ruled. Work through them in order without stopping to ask, and come
> back only when you hit a **STOP** condition or finish.
>
> This file exists because most recent rounds ended with "no ruling needed", and those round-trips
> cost an afternoon. It is not a licence to move faster on judgement — the three rulings that got
> reversed in this project (the palette's radius arithmetic, `.seg-pill`, the mic chip) were all
> reversed because a measurement contradicted me and you reported it. **That behaviour is the point
> of the whole exercise. Keep it.**
>
> Prerequisites: rounds 24 and 25 are done, `probe-selftest` is 7/7, and the three harness files are
> committed. If any of those is false, say so and stop.

---

## The standing rules — they apply to every item below

1. **Zero-diff is the default deliverable.** Snapshot, change, diff. An empty diff means nothing
   visible moved. A non-empty diff must be explained line by line.
2. **An empty diff proves only that nothing VISIBLE moved.** Anything that changes a state's
   appearance also needs a forced-state read — the round-twelve status colours diffed to 0 because
   neither state was on screen.
3. **STOP and report** when: a measurement contradicts a ruling here; a token does not exist or does
   not hold the value this file claims; a colour has no token and you would have to invent one; a
   deletion turns out to have a live user; a diff contains a line you cannot explain; or the
   self-test goes red. A stop is a success, not a failure.
4. **Never invent a token to make a change fit.** Show me both values instead.
5. **Measure the screen, not the source.** The pins page hid seven controls behind a documented
   block; `top-bar-btn` has five heights; `.as-io-reset-btn` renders zero times. Source-declared
   numbers are not measurements, and a class in the file is not a class on screen.
6. **No commit of app code.** Harness and docs may be committed.
7. Report per item, not per round: what changed, the diff, and the counts. Brief is fine.

---

## Item A — `.mu-btn--md`, the 32px step

`tc-icon` (7 usages, 32px, r4, 13.33px) and `as-btn` (3 usages, 30.59px, r0, 15.68px, padding
4.8/14.4).

**Ruled:** both take `.mu-btn--md` at **32px**. `tc-icon` is already exactly 32 and is the reference.
`as-btn` moves 30.59 → 32 (+1.4px) and gains `--r-field`-equivalent corners from the shared rule.

- `tc-icon` is a **bare glyph** — no border, no background at rest. If `.mu-btn--md` as written gives
  it a box, then `tc-icon` belongs with `.mu-btn--bare` at 32px instead, and **that is the answer**:
  size and box are independent, exactly as round sixteen established when `--bare` refused to be a
  modifier. Measure first, then pick, and say which you picked and why.
- `as-btn`'s three usages are in a hosted dialog. If all three are inside `.settings-host`, they
  belong to the **settings kit** (`.set-btn`, 36px), not the instrument — the same ruling that moved
  `as-io-capture-btn`. **Check this before converting.** If they are inside, do that instead and
  `--md` ends up with only `tc-icon`.

Expected diff: `as-btn` × 3 by 1.4px and whatever reflows; `tc-icon` 0.

## Item B — CANCELLED. The segment is not a button.

> **Ruled 2026-08-30, after the STOP this item's own condition produced.** The stop was correct and
> the collision is real: `.active` is not `.on`. I conflated **selection** with **engagement**.
>
> - A segment's selected state: *one of a set is always chosen.* Neutral bright, fill .14. Because
>   there is always exactly one active segment, ember would carry no information — every segmented
>   control in the app would glow permanently.
> - A button's `on` state: *exceptional engagement.* Ember. Most buttons are off, so ember means
>   something.
>
> **Ember means exceptional; neutral means chosen.** Different questions, different faces.
>
> With radius (2 vs 4), padding (4/8 vs 0/11.2) and font (12.48 vs 15.68) all differing as well,
> converting 48 elements would move pixels for no gain. So: **`grain-seg-btn` stays.** A segment
> button is a *part* of the segmented control — like a device row's state mark is a part of a device
> row — and parts are not elements.
>
> Two consequences, both to be applied:
> 1. **Delete `.mu-btn--md`.** Zero users after item A, and a size with no users is what the closed-kit
>    rule forbids — the same reason the badge binding-state was deleted. `tc-icon` is the icon
>    button and is its own element: bare glyph, 32px, r4, 13.33px. Leave it, and document it.
> 2. The button consolidation is **finished**: `.mu-btn` base + faces, `--lg` (21 usages), `--bare`
>    (31). Fewer classes than predicted, which is what the measurements said.

## Item C — the dead-class sweep

~154 provably-dead classes, ~214 orphan selectors (~200 in `style.css`), after excluding anything in
markup, in JS, or plausibly built by concatenation. Largest families: `as-*` (15), `seq-*` (12),
`acc-*` (8), `seed-*` (6), `set-*` (6). The staging block is already gone.

**Ruled: delete them, one family per step, with a diff after each family.**

- Every class gets the **three-way check from round thirteen** before deletion: class attribute in
  `index.html`, whole-word match in JS with comments stripped, and prefix/suffix concatenation
  (`'as-btn--' +`, template literals). That check has already saved one class (`key-badge`) — expect
  it to save more.
- The sweeper must **descend into `@media`**, and its at-rule test must not assume `@` is the first
  character (a paragraph of explanation routinely precedes an `@media` in this file). Both fixed in
  round twelve — verify they still hold before trusting its output.
- `set-*` needs care: the settings kit's own classes are named `set-*` and are very much alive. A
  `set-*` reported dead is more likely a sweeper miss than a dead class. **STOP** on any `set-*` and
  list them rather than deleting.
- Keep `.mapping-legend`, `.mapping-table`, `.mapping-filter*` — the keys + MIDI page.
- Report the line count per family, and any class the three-way check rescued.

## Item D — the hex tail

59 colours / 96 literals, with the budget already in place.

**Ruled: opportunistic, not a push.** While you are inside a file for items A–C, tokenise any literal
whose token exists and holds the **same value**. Do not change a colour to make it tokenisable —
that is out of scope, and it is Ek's call, not yours or mine.

- Tighten `HEX_BUDGET` after each item and report the new count.
- Two known typos to fix regardless of where you are: **`#7abc` at `style.css:225` and `:5050`**
  (`.sensor-group-status`). `#7abc` is a valid *four*-digit hex — `#77aabbcc`, teal at 80% alpha —
  and one character short of `#7abcbc`, the pre-August teal. It renders a colour nobody chose.
  Fix means: work out what it was meant to be from its neighbours, then use the **token** for that
  intent. If no token fits, **STOP** and show me the two candidates.

## Item E — verify the instrument kit against the app

`docs/INSTRUMENT-GUI.md` is the instrument's element kit, drafted from the consolidation rounds. It
is the counterpart to `SETTINGS-GUI.md` and it is what makes "build something new in the rig view"
answerable without reading 7,000 lines of CSS.

Every number in it came out of a live measurement during these rounds, but **the file itself has not
been verified against the built app.** Do that:

1. For each stated number — the three button heights, `--bare`'s elastic height, each of the five
   faces, the status pill's 18/999, the switch's 32×18/knob 14/inset 2, the segment's 24/22/r2,
   `.seg-pill`'s treatment, all six radii, the eyebrow pairing, the rails' exception — read the live
   computed value and mark it confirmed or wrong.
2. Where it is wrong, **fix the doc, not the app** — unless the app disagrees with a ruling recorded
   in `INSTRUMENT-AUDIT.md`, in which case STOP and report which.
3. Then change its banner from `DESIGN INTENT` to `CURRENT`, add its row to `CLAUDE.md`'s doc table,
   and add a `docs-audit` check if the shape allows: every number this file states is measurable and
   matches. A design doc that can go stale silently is how this project started.

## Item F — close the loop

When A–E are done:

1. `docs/SETTINGS-GUI.md`, `docs/INSTRUMENT-GUI.md` and `docs/DESIGN-SYSTEM.md` should describe what
   the code now is. Fix any line any of them gets wrong — that is the whole point of this project
   and a stale doc undoes it.
2. Report the final tally: button classes remaining of 42, `HEX_BUDGET`, total lines removed across
   all rounds, and every invariant now enforced (with what each one fails on).
3. State plainly anything you believe is still wrong and did not touch. A known problem written down
   beats a clean-looking report.

---

## Out of scope — leave these alone

Design decisions, and they are Ek's:

- Any colour change where the token differs from the literal (the remaining warm/cool greys).
- The four rail labels that wrap at 216px — logged in round twenty-four as a layout finding.
- The eight JS-only button classes: `factory-reset-btn`, `factory-reset-btns`, `ds-editbtn`,
  `imu-setup-pol-btn`, `imu-setup-mute-btn`, `sensor-switch-btn`, `as-io-reset-btn`, `mob-big-btn`.
  Five need a sensor or a destructive flow; `mob-big-btn` needs a window resize. **Leave all eight.**
  They are the honest remainder, not debt.
- `docs/DESIGN-SYSTEM.md`'s prose beyond the two-scopes table.
