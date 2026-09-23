# Vocabulary — what the instrument calls things

> **Status: MIXED** — drafted 2026-08-25, **partly in the app the same day** on branch
> `brush-model`. Companion to `docs/archive/BRUSH-MODEL.md`; read this one first if a word there looks
> unfamiliar.
>
> **The app now speaks two vocabularies at once, and you need to know which surface you are on.**
> The proposed words reach code in three places: the **brush library** (`js/brush.js` — *brush,
> hit, stamp, grain*, `S.brushKey`) and, since 2026-08-25 (#216), the **tile row** (`js/tiles.js`
> — *line, pen, stamp, scrape, reach*) and the **pinned rail** (`js/ui-pins.js` — *pin,
> group*; it launched speaking *layers, hold* and was renamed 2026-08-27, see § Pin below). The
> v1 surfaces that spoke them first — the tool strip, the four-tools dock and the v1
> arrange rail — were removed the same day (#208) along with `S.tool`.
> Everything else still uses the old names: the eleven
> panels, all 101 entries in `ACTIONS`, the whole OSC namespace (`/commit/*`, `/trace/*`,
> `/search/radius`), `docs/KEYBOARD-SHORTCUTS.md`, and every identifier in `js/`.
> **No rename in § "How to land it" has been done.**
>
> That split is deliberate — the words were put on the new surfaces first so they could be read
> before being committed to — but it is exactly the "two correct names, neither trusted" state
> this doc warns against, and it should not outlive the branch.
>
> This doc is the naming half of one redesign. The model half — four tools, one stroke type, the
> deletions and the build sequence — lives in `docs/archive/BRUSH-MODEL.md`. Neither is much use alone:
> half the renames here are only possible because the model deletes the thing being renamed.

---

## The problem is not a bad word. It is three metaphors at once.

The app currently speaks three languages simultaneously and does not notice:

- a **drawing** language — *trace*, *paint*, *stroke*, *erase*, *brush*
- a **version-control** language — *commit*, *release*, *staging*, *snapshot*
- a **gardening** language — *seed*, *plant*, *sow*, *uproot*

None of them is wrong on its own. Together they mean a player has to hold three mental models to
describe one gesture, and the app cannot help because it does not know which one it is speaking.

**Pick one metaphor and commit to it all the way down.** That is the whole recommendation. The
rest of this doc is which one, and what it costs.

---

## Why *trace* is the wrong word, specifically

Three reasons, in ascending order of how much they matter.

**It is a weak verb.** You *trace* something that already exists — a shape, an outline. What the
player actually does is put new sound into a place. Every candidate below is a stronger verb than
that.

**It collides twice.** With `ui-trace.js` (deleted 2026-09-05), a superseded module that shared only the word and
loads from nowhere — CLAUDE.md has to warn sessions about it by name. And with its own three
sub-modes, where `traceMode: 'trace'` means *trace* is simultaneously the verb and one of the
three things the verb can be.

**And the decisive one: the codebase already disagrees with the UI.**

- `js/paint-ticker.js` — *"Drops a particle at the current cursor position every N milliseconds
  **while painting**."*
- `paintGateThreshold` · `SAMPLE_PAINT_COLORS` · `LIVE_PAINT_COLORS` · `updatePaintIndicator()` ·
  `recordStrokeStart` · actions `paint1`–`paint10`
- `index.html`, the first-run hint that was shown to every new user until 2026-08-30: *"click and
  drag on the canvas to **paint sound**."* The overlay is deleted; the evidence stands, because it
  is what the app told every new user for the whole period this argument is about.

**The app tells new users it paints and then labels the button "trace".** Trace appears in
`traceMode`, one button and one doc. It is the outlier, not the incumbent — which means adopting
*paint* is not abandoning an established word, it is finishing a rename that half-happened years
ago.

---

## Four systems

Each is internally consistent. The point of listing four is that consistency matters more than
which one wins — but they are not equal, and the recommendation is at the end.

| Concept | **Paint** *(recommended)* | Voice | Tape | Today |
|---|---|---|---|---|
| put material down | **Paint** | Sing | Record | Trace |
| the material | paint | breath | tape | particles |
| one run of it | a stroke | a phrase | a take | a stroke |
| leave it sounding | **Pin** *(was Hold — see § Pin)* | Hold | Hold | Commit / plant / drop / draw |
| a held thing | a pin — kinds stay *cloud* and *loop* | a drone | a loop | a seed, a seq, a cloud, a playhead |
| take it away | **Erase** | Hush | Wipe | Erase, sweep, uproot, lift |
| decide what is audible | **Arrange** | Conduct | Mix | Composer mode |
| the cursor's range | **reach** | earshot | window | search radius |
| how deep it hears | **depth** *(settled 2026-08-26)* | voices | takes | recency |
| a saved sound | **a brush** | a voice | a preset | a patch |
| whole-sample material | **tape** *(settled 2026-09-07)* | a strike | a shot | a trigger |
| prepared material | **a stamp** | a quote | a drop-in | a loaded sample |
| the music, saved | **a set** | a piece | a session | a session export |
| the machine, saved | **the rig** | the stage | the setup | a setup export |

**Paint** — every word already appears somewhere in the code, so nothing has to be taught, and it
matches the tool model exactly. Risk: it is a visual metaphor for an audible instrument, and
*paint* as a mass noun ("there's paint here") takes a beat to land.

**Voice** — the most honest to what mubone is for: a performer sounding into a room, not a painter
and not an engineer. **Conduct** is the best single word in any of these systems — it says
precisely what Arrange does and carries the right authority. Risk: *hush* and *earshot* are
charming in a design doc and precious at a soundcheck, and the system is only worth adopting whole.

**Tape** — anyone who has opened a DAW is fluent on sight. Zero teaching cost, zero personality,
and it quietly reframes the instrument as a recorder, which is the one thing design principle 1
says it is not.

> **Superseded for the ENGINE (Ek, 2026-09-07):** *"it's more like a tape instrument. these brushes
> are presets for instruments. grain is the GRANULATOR, and TAPE is TAPE, makes sense. it's a
> machine."* The objection above was to Tape as the whole vocabulary — the material, the verbs, the
> lot. As the name of ONE engine beside the granulator it reads as a machine rather than a
> metaphor, which is the reading that objection was aimed at. This does not adopt the rest of the
> Tape column; *paint*, *stroke* and *pin* stand.

**Recommendation: Paint**, with one graft — take **Conduct** from Voice if *Arrange* ever feels
too administrative in use. That is the only cross-system borrow worth making; the rest is
pick-one-and-stop.

---

## The glossary

The fourteen terms, in the recommended system. Anything not on this list should not be in the UI.

| Term | Part of speech | Means |
|---|---|---|
| **paint** | v. / n. | Deposit material with the current brush; the material itself |
| **brush** | n. | A saved sound *and* a material type. Replaces patch/preset entirely |
| **mark** | n. | One deposited point. (Internally still `particle` — see below) |
| **stroke** | n. | One run of marks with one buffer. The only object on the sphere |
| **pin** | v. / n. | Leave a stroke sounding off-cursor; the thing so left. Its kinds stay **cloud** and **loop** — pin is the category, not a third kind. **Unpin** returns it to scratch (superseded *hold*, 2026-08-27 — see § Pin) |
| **reach** | n. | How far the cursor hears. One value, every tool |
| **depth** | n. | How many of the newest strokes under the cursor are audible (took this row from *layers*, 2026-08-26; the readout counts strokes: "last 3 strokes") |
| **tape** | n. | Material played WHOLE — a take, not fragments of one. The engine behind `line`, `slice`, `looper`, `overdub`; fired on entering the reach. Superseded *hit* and *trigger* (2026-09-07, Ek: "i hate hit, we should remove it from the vocab… it's more like a tape instrument") |
| **source** | n. | Where the brush inks from — a live input channel or the **sampler** (the one input that is also a store); exactly one on. (Superseded *stamp*, 2026-08-28 — a sample is an input, not a material, so any brush can paint from it; BRUSH-MODEL § 1g) |
| **mute** | v. | Silence. Replaces scan-off and triggers-off both |
| **erase** | v. | Remove material inside the reach, newest first |
| **arrange** | v. | Silence and restore pinned material with the cursor — one pin or its whole group |
| **set** | n. | The music, saved. `.mubone` |
| **rig** | n. | The machine, saved. `.mubonerig` |

### The button terms (2026-09-09)

| word | means |
|---|---|
| **momentary** | an action that takes the whole button: on at the down, off at the up (type id `hold`). No gestures. `play (momentary)` on a position — a binding, never a mode setting (2026-09-09) |
| **toggle** | an action that flips on each press (a bang, type id `trigger`); the title says which version where there are two — `system mute (toggle)` / `system mute (momentary)` |
| **bang** | the OSC word for fires-once; the keys page's sub-line is OSC facts only (`/undo · bang`, `/mute/hold · int 0|1`) |
| **verb** | n. | HOW a tile fires, and the only thing its SHAPE says: `bang` · `momentary` · `toggle`. One per tile, set in its drawer head, and the same tool may sit on the strip twice in two verbs. It is the tile's, never the caller's — which is why a position has one action and one OSC address |
| **play** | v. | What a position's press does, in a tool's own words: `line · play (toggle)`, `pen · play (momentary)`. It replaced **activate**, which had replaced *play* on the slot rows and *paint* on the main button (Ek, 2026-09-10) |
| **arm**, **cycle**, **activate**, **the main button** | ~~retired~~ (2026-09-11). A slot once had four rows — `arm` (the digit), `cycle`, `activate (toggle)`, `activate (momentary)` — and above them a main button that fired whatever was armed. Nothing is armed, nothing is in the hand between presses, and a position carries ONE row in its tile's own words. **Do not reintroduce any of these four words** |
| **press · tap · long press · extra long · ×2 · ×3** | the instrument's six gestures; a press is the down edge and is never delayed, a tap is a bang on the up edge of a short press nothing else claimed (back 2026-09-09 evening, on testing); extra long is a second timer past long (2026-09-10). Tap, long, extra long, ×2 and ×3 are alternatives (a tap beside a ×2 waits the window); only the press stacks |

"Hold" is not a word of the instrument any more. Reasoning in `docs/RULINGS.md`.

### The lens terms (added 2026-08-25 as "scope"; renamed 2026-08-26 — the camera system)

Three terms joined with the lens model (`docs/archive/BRUSH-MODEL.md` § 3e v4), and one retired.
**The family's own name changed the next day:** it launched as *scope*, and Ek renamed it
**lens** — "i don't like the rifle scope connotation." The camera analogy stays; only the
word with the crosshair went. Code followed the same day (`ENGINES.lens`, `S.lensAperture`,
`.tile--lens`, the search panel's mode row). `S.arrangeScope` keeps its name: that is
"scope of the flip" (one hold vs its layer), the ordinary programming sense, not this family.

| Term | Part of speech | Means |
|---|---|---|
| **lens** | n. | How the cursor reads material. ONE, since 2026-09-22 night: its settings are the lens tab in the tool rail, its tile on the strip turns the eye off and on. (`wide` · `spot` were presets of it; `mode: area · nearest` is the row they differed by) |
| **radius** | n. | How wide a circle the installed lens reads, in degrees. The term has now been *reach* → *zoom* (a day) → *field* (a day) → **radius** (Ek, 2026-08-26: "it's clear. it's the radius") — the camera metaphor lost this one to the plain geometric word, and the lesson is worth keeping: metaphor terms earn their place only where they explain something (*aperture*, *cap*), not where a literal word already does |
| **cap** | n. | The lens's mute: it stays mounted with its settings, the cursor stops reading. Replaces *scan on/off* |
| ~~**aperture**~~ | n. | RETIRED (#233, 2026-08-27, two days after it was coined). It was the lens's live density cap, min(brush k, aperture) — a workaround for k being frozen into the brush. When flow made density a painted property and **k moved to the lens**, the workaround had no job left, and \"two controls fighting over one outcome\" had been the confusion all along. The lens now owns **k**, **fill** (k \| all) and **order** (random \| step) directly |

**Off-cursor (added 2026-08-27, #241):** the model that finally names the split — **scratch
is what the lens reads; the rail is everything playing off-cursor, grouped.** "Layer group is
just how off-cursor things are grouped — it's not actually a layer panel" [Ek]. The boundary
is the claim, not a copy: a stroke claimed by a live loop slot is off-cursor and the lens
does not read it (no accidental re-trigger); release the claim and it is scratch again.

### Pin (2026-08-27) — the off-cursor verb, and *hold* superseded before it ever shipped

The same day off-cursor landed, the verb for it did too. Ek, working from the app's own oldest
word: *"originally we had always been using the word drop … maybe pin is the verb and I just
say, I have 4 things pinned. Some clouds and some loops … you pin articles for reading later.
Let's put a 'pin' in it."* So:

- **pin** (v./n.) replaces **hold** everywhere hold appeared in this doc's plan. Hold implied
  the player's continued effort; a pin says the *system* keeps it (design principle 3 as a
  verb). "Drop a pin" even reconciles the original *drop* — a pin dropped on a map marks a
  spot that persists after you move on, and the sphere is a map.
- **Pin is the category, not a third kind.** The things pinned stay **clouds** and **loops** —
  "I have 4 things pinned, some clouds and some loops." No forced umbrella noun.
- **Unpin** is the release verb, free of charge — it carries the #241 claim rule by itself:
  unpin and the stroke is scratch again, back under the lens. Retires
  release/uproot/lift/pickup as UI words.
- **The rail is titled *Pinned***, and ***layer* exits the vocabulary entirely** — "it's not
  actually a layer panel" [Ek]. Rows in the rail are **groups** (#242 already said
  `layerGroup`), and with *depth* confirmed on the lens sheet nothing else needed the word.
- Pin is a third metaphor — maps and app chrome, neither painting nor photography — and that
  is fine by the *radius* precedent: it sits in the plain-word tier (radius, depth, pin) that
  carries the mechanics while the metaphors carry the making.
- **Cost paid the same day:** the radial-morph "pins" (gesture panel, experimental and unused)
  were renamed **anchors** — `S.radialAnchors`, `mubone_radial_anchors` with a one-shot key
  migration — so the word points at exactly one thing. The rail, `js/tiles.js`'s looper/arrange
  feet and the flips seg (displays *pin | group*, values still `'hold' | 'layer'`) speak pin;
  internal identifiers (`commitSlots`, `layerId`, `layerOf`, `lyr-*`) keep their names until
  the § "How to land it" pass.

*Depth* (how many strokes deep the lens sees — today's `recency`) is now on the lens sheet as
**depth**, confirmed by Ek 2026-08-26 ("depth makes sense") — but its readout must say what the
number counts: "last 3 strokes", never a bare "3" ("2 is nothing to me"). It has taken the
"how deep it hears" row from *layers* — and with § Pin retiring *layer* from the arrangement
side too, the word is out of the vocabulary altogether.

**Sweep found its meaning (Ek, 2026-08-25):** § 2's table folded *sweep* into erase — but the
scratch model gives it a cleaner home: **sweep = clear scratch.** Everything unpinned
goes; pins keep their material and keep sounding. The existing `sessionSweepBtn` already does
exactly this (it removes particles not used by active seeds or loops), so the word landed on
behaviour that was already true — the chrome pill says *sweep scratch*.

**`particle` stays internal.** It is the right word in `grain.js` and the wrong word in the UI.
The UI says *marks* or just *paint*; the code keeps `S.particles` and `_particleVersion` because
renaming a hot-path field buys nothing and breaks every doc that cites it.

### The test sentence

A player should be able to describe a whole set in one breath using only words nobody taught them:

> *"I painted a wash across the top, pinned it, painted three hits low and left, then arranged
> them out one at a time until only the wash was left."*

Fourteen terms, no manual. The same sentence today needs *trace, trace+cloud, commit, cloud, drop,
seed slot, trigger, arm, composer mode, latch* — and a listener who already knows the app.

---

## How to land it

**One commit, no aliases.** This is the one place the project's own rule does real work: *no
compat hedging, no legacy shims, no "other collaborators might expect the old name."* A
half-renamed vocabulary is worse than either end state, because both words are then correct and
neither is trusted.

**Do `commit` → `pin` first and alone.** It is the word already carrying eleven synonyms.
(This step was `commit → hold` until § Pin superseded *hold* on 2026-08-27 — before the rename
had been run, so nothing was ever half-renamed.) Doing it as its own pass makes the diff honest
about how much of the old model is still load-bearing.

**Delete the aliases in the same commit.** `state.js` currently maps `MAX_SEEDS`, `MAX_SEQS`,
`SEED_COLORS`, `SEQ_COLORS`, `MOVING_SEED_THRESHOLD_MS` onto the commit pool, and carries
a getter/setter pair for `seqModeEnabled` (`commitLockEnabled` / `seedLockEnabled` went 2026-09-05). Renaming on
top of those produces **three live names for one field**, which is exactly how the current
situation arose. The reasoning is already written in that file, on `AXIS_SOURCES`:

> The rename is the whole point: `if (S.axisLockEl)` is truthy for the string 'off', so retyping
> in place would have left every read site silently behaving as locked. **Delete the name, break
> loudly.**

### What each rename touches

| Rename | Also touches |
|---|---|
| `commit` → `pin` | 12 actions in `ACTIONS` (`js/midi.js`) and their OSC addresses `/commit/*` → `/pin/*`; `docs/KEYBOARD-SHORTCUTS.md`; `README.md`'s address table; `osc-audit.js`'s wiring cross-check. Also `S.arrangeScope`'s `'hold' \| 'layer'` values → `'pin' \| 'group'` (the flips seg already displays the new words) |
| `trigger` → `tape` | `/trigger/*` addresses, `js/trigger.js` → `js/tape.js`, `trigger-audit.js`, `docs/archive/TRIGGER-TOOL-PLAN.md`. The user-facing half landed 2026-09-07 (the engine, the rail group, the brush material, `ENGINES.tape`); the module and the OSC namespace have not moved |
| `patch`/`preset` → `brush` | `mubone_user_presets`, `mubone_active_patch`, `mubone_preset_view`, `mubone_preset_layout_v` in `js/storage-registry.js` — needs a one-shot key migration, and the `guards` entry moves with it |
| ~~`search radius` → `reach`~~ | SUPERSEDED — *radius* won the word on 2026-08-26 (see the lens table), so `/search/radius` and the `radius_*` actions keep their names. No rename |
| `recency` → `depth` | `/search/recency`, `recency_cc`, and the `live` block in the session payload (was `recency → layers` until depth took the row, 2026-08-26) |
| session/setup → set/rig | `_magic` values `mubone-setup` / `mubone-session`, `EXPORT_VERSION` bump, the pre-v-N normaliser |

**Every OSC rename is a breaking change for any external client** — the Max example patches in
the old Max patches (git history), mubone-joycon-gui, and anything Ek has on a pedalboard. The address namespace is
the dispatch `switch` in `js/osc.js` and nothing else, so the change is mechanical; the cost is
re-pointing whatever is currently sending. Worth batching all address renames into a single
release rather than dribbling them out.

### Order

1. `commit` → `pin`, plus the alias deletion. Its own commit.
2. `trigger` → `tape`, including the module rename.
3. `recency` → `depth` — UI + action + OSC only. (`search radius` keeps its name: *radius*
   won on 2026-08-26.)
4. `patch` → `brush` — last of the renames, because it wants the storage migration and it is
   entangled with the model change in `docs/archive/BRUSH-MODEL.md` § 1.
5. session/setup → set/rig — with the file work, not before it.

`node scripts/docs-audit.js` after each: it checks that every `docs/` path cited in prose still
resolves, which is the thing renames quietly break.
