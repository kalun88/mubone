# VOICES-AND-HEADS.md — one engine, several voices, a handful of heads

> **Status: DESIGN INTENT — largely built 2026-09-21, and its VOCABULARY IS SUPERSEDED.** A `head` is
> a **SHAPE**, the pair is **shape · voice**, `keeps` is the MODE section's `autopin` and `join` is its
> `cycle`. What shipped and the rulings it left are in `docs/RULINGS.md` under *"A tool is a shape and
> a voice"* — read that first, and this for the arguments behind it. Still open: § 9.1 `match`, § 9.5
> erase as one shape or three, and whether `cycle` means anything for a grain cloud.
>
> **Its own first banner, kept because the quotes in it are the record.** Ruled out of a design
> conversation with Ek, 2026-09-19 → 20, which started from "the current way we do things is
> honestly confusing … wet, pin, different tools which are basically different presets on the
> same engine" and landed on "one engine which has several voices. and heads."
>
> **Read this first.** A tool answers three independent questions and a tile name fuses all
> three: **what it sounds like** (voice), **how it lands** (head), **whether it stays** (keeps).
> All three already exist as separate runtime state — `resolveGrainParams()`, `S.brushFx`,
> `gEnd`/`onEnd` — so **this is a library and naming change, not an engine change. The audio
> path does not move.** What is fused is `TILE_DEFS`: 13 tiles, each an opaque name over a
> triple. The payoff is the cross product: named voices that every head can play, which is the
> "four different sonic possibilities under granular" the current design has no slot for.
>
> **Not in scope:** a performance mode. The palette IS the performance mode (Ek, 2026-09-19) and
> it does not move — `/palette/N`, the `palette_N` ACTIONS rows and the key digits address a
> POSITION, and that stays true throughout.

---

## 1. The finding: the split is already in the code, in three places

This is not a taxonomy invented for the plan. Three independent parts of the codebase already
sort the same params the same way.

**`PARAM_DEFS[*].sec`** — the sheet's own sections, and the tape ones were renamed by EFFECT on
2026-09-18, one day before this conversation, with the comment saying it outright: *"`tape` is
the sound, `on end` is what happens when the stroke ends, `slicing` is how the take is cut,
once."* That is voice / keeps / head, already named.

**`resolveGrainParams()`** (`js/brush-voicing.js`) — the ONE builder of a grain block. It returns
`period duration volume pitchShift pitchJitter periodVar durVar durJitter startJitter fadeRatio
fadeMode fadeMs probability direction envShape filterType cutoff res filterFreqJitter
panSpread`. **No `flow`, no `headW`, no `gEnd`.** The voice already exists as a function.

**`S.brushFx`** (`js/state.js`, set at `tiles.js:781`) — `'spray' | 'match' | 'comb' | 'staff' |
'slice' | 'none'`. The head already exists as a variable, and `'none'` is already the plain head.

### The counts

| engine | voice | head | keeps |
|---|---|---|---|
| **granular** (29 pids) | 20 — `dur period glink fade curve startJit durVar perVar` · `pitch octave pitchJit dir` · `flt ftype cutoff res fltJit` · `vol pan prob` | 8 — `flow headW` shared, plus each head's own two: `splatSpread splatThrow` · `combAxis combKeep` · `staffLo staffHi` | 1 — `gEnd` |
| **tape** (10 + `decay`) | 5 — `tspeed tpitch tstep treverse tvol` | 3 — `tchop chopMs sliceMin` | 3 — `onEnd passes`, and `decay` for dub |
| **erase** (3) | — none; it makes no sound | 3 — `depth efrom escope` | — |

Two engines, one shared head pair (`flow` + `headW`), and every named head adds exactly two of
its own. Erase having no voice column is why the three scrapes never felt like tools: they are
three heads on an engine that has nothing to sound.

## 2. The model

> **A tool is an engine, a voice, and a head. Keeps is a field, not a tool.**

- **A voice** is a named block of one engine's voice params. It is what a stroke freezes today —
  `S.voicings`, `{ id, key, tile, label, params, wet }` — promoted from an anonymous intern-as-a-
  side-effect-of-painting to something you author and name.
- **A head** is how the gesture deposits. It has a glyph, because it is a gesture.
- **Keeps** is `no · loop · join` — `join` being dub, whose take enters the nearest pinned loop's
  cycle instead of starting its own.

**Heads have glyphs, voices have names.** You can draw a gesture; you cannot draw a sound. That
is the rule that decides every rendering question below, and it is why a minted voice stops
needing the `custom` spark glyph, which today says only "made here" and nothing else.

## 3. The 13, decomposed

Verified against `TILE_DEFS`, `FACTORY_PARAMS`, `FACTORY_SOUND` and the `brushFx` list.

| tile | engine | voice | head | keeps |
|---|---|---|---|---|
| `line` | tape | live block | plain | no |
| `slice` | tape | live block | **chop** (`brushFx`) | no |
| `looper` | tape | live block | plain | **loop** |
| `overdub` | tape | live block | plain | **join** |
| `pen` | granular | *adopted* | plain | no |
| `wash` | granular | **wash — the only designed one** | plain | **loop** |
| `spray` | granular | *adopted* | **scatter** | no |
| `comb` | granular | *adopted* | **sort** | no |
| `staff` | granular | *adopted* | **displace** | no |
| `match` | granular | *adopted* | **match** (§ 9.1) | no |
| `scrape` `bottom` `all` | erase | — | three scopes | — |

**The revealing column is the voice.** `FACTORY_SOUND` has exactly one entry. Every other grain
tile *adopts the live block the first time it is applied* and owns it from then on — so each of
your grain tools carries a sound that was whatever happened to be on the sliders that day. Every
grain tile has a voice and exactly one of them meant to. That is the gap this plan fills, and it
is why the conclusion is not "collapse 13 into 3".

## 4. What each thing becomes in code

**Voice.** `_tileCfg[id].params` minus the head and keeps pids, lifted into its own store
(`mubone_voices`) with a name. `resolveGrainParams()` is untouched — it still reads the live
block, and a voice is applied to the live block on selection exactly as a tile's block is today
(*"any other tile's press re-applies its whole block anyway (`_applyHand`)"*, tiles.js:2718).

**Head.** `S.brushFx` keeps its job and gets a better name and a table: id, glyph, engine, its
own pids, its factory `flow`/`headW`. `paint-ticker.js` and `trigger.js:577` read it as they do
now.

**Keeps.** `isAutoPin`/`setAutoPin` already derive from `_tileParam(id, 'gEnd'|'onEnd')` —
correct by construction, and they stay that way, reading the pairing instead of the tile. The
`overdub` special-case (`isAutoPin` returns `true`, `setAutoPin` refuses) disappears, because
`join` is a value of the field rather than a tile that has to be lied about.

**Keeps COMES WITH THE TOOL, like the verb, and the hand wears it** (Ek, 2026-09-20, reading the
canvas: "in hand, should that show the type of keep as well?"). The first draft of § 4 put keeps
on the pairing alone, which left a hole: a tool taken in hand from the RAIL has no pairing, so no
keeps. The answer is a ruling that already exists — `handVerbFor` (PALETTE-GUI § 1, 2026-09-16):
a strip tile hands the hand its own verb, a rail row its engine's factory verb, and a right-click
flips it from there. Keeps has exactly that shape, so it takes exactly that rule.

It is therefore DRAWN on the hand tile, and it has to be, because it is the one of the four facts
that no other channel carries: the glyph is the head, the name is the voice, the shape is the
verb, the hue is the engine — and nothing says whether the next press keeps. The mark is the
existing pin family, filled-on / outlined-off (the wet drop's rule), with `join` as the filled pin
inside a ring: pinned into something already there. Erase shows no mark and no row at all, because
it has no end. `docs/mockups/voices-heads/Hand.dc.html` draws the three; `Main.dc.html` is live.

**A strip tile** is `{ head, voice, keeps, verb }`. The palette stays nine positions, drag-to-
place, right-click-for-verb, one key per position. Nothing about the performance surface moves.

**The rail** grows a voices row per engine beside its heads row. Click a head → in hand with the
current voice; click a voice → in hand with the current head. One choice per click, no drawer.
The hand tile already draws glyph + name; it becomes head glyph + voice name, which is the whole
state, visible.

## 5. What changes, by file

| file | change | size |
|---|---|---|
| `js/tiles.js` | `TILE_DEFS` → `HEADS` + voices store; `ENGINES` lists split into `VOICE_PIDS`/`HEAD_PIDS`/`KEEP_PIDS`; rail render; palette entry shape; `engineOf`; custom minting; `isAutoPin`/`setAutoPin` read the pairing | the bulk |
| `js/brush-voicing.js` | voicings keyed on VOICE id, not tile; `exportVoicings`/`restoreVoicings` carry the voice name; the `wet` field per § 9.3 | medium |
| `js/paint-ticker.js`, `js/trigger.js` | `S.brushFx` → `S.head`, mechanical rename at 9 read sites | small |
| `js/state.js` | `brushFx: 'none'` → `head: 'plain'` | one line |
| `js/midi.js` | `PALETTE_FACTORY_ENTRIES` / `PALETTE_FACTORY_ORDER` become triples; one new seed stamp | small |
| `js/storage-registry.js` | `mubone_voices`, the migration stamps, note rewrites for `mubone_tiles` | small |
| `js/ui-export.js` | `EXPORT_VERSION` 14 → 15 | one line |
| `js/osc.js` | **none** — positions, not tiles | — |
| `js/pins.js`, `js/ui-pins.js` | **none** — a pin is material, not a tool | — |

## 6. Migration — one-shot, no fallback

Per CLAUDE.md: read old key → write new key → delete old, behind a stamp, on the
`mubone_palette_renumber` / `mubone_palette_verbs_collapsed` precedent. `_RENAMED_TILES` /
`migrateTileId` (tiles.js:2284) is the existing mechanism for carrying a renamed tile through
every stored map.

1. **`mubone_tiles`** — each grain tile's stored block splits: voice pids → a voice named after
   the tile, head pids → that head's defaults, `gEnd` → the pairing's keeps. **You wake up with
   the six voices you accidentally already had**, named `dots`, `trail`, `spray`, `comb`,
   `staff`, `match`.
2. **`mubone_palette`** — `[{id,verb}]` → `[{head,voice,keeps,verb}]` through the § 3 table.
   Deterministic; every one of the 13 has a defined triple.
3. **`mubone_tiles_gone`** — deleted factory ids map to deleted heads or voices by the same table.
4. **Session files** — `exportVoicings` already writes `tile`; v15 writes `voice` beside it and
   v14 files read `tile` as the voice name. `restoreVoicings`'s existing "unknown id plays with
   the live params until the table arrives" contract is unaffected.
5. **`mubone_cycle_off`, `mubone_slots`** — already dead keys from the pre-2026-09-11 palette;
   this is the moment to drop them rather than migrate them.

## 7. Audits

`scripts/palette-audit.js` and `scripts/engine-audit.js` carry the most tile-id assumptions;
`pins-audit.js` § H and § L cover the wet/voicing rulings; `colour-audit.js` will need the
"one hue per engine" rule extended to the sheet head (see § 9.5); `trigger-audit.js` covers the
`slice` path. `scripts/audit-for.js` maps the diff to the list. Per the three-tier rule the rig
suites run on request and at release, not per change.

**A new invariant belongs here:** every entry on the palette resolves to a head that exists, a
voice that exists for that head's engine, and a keeps value that engine allows. That is the one
thing this design can get structurally wrong.

## 8. Staging — each stage playable and committable

**Stage 0 — the honest readout row.** Not part of the refactor. Draw each rail row's
decomposition (`loop → tape · keeps`, `trail → grain · wash · keeps`). Non-destructive, and it
tests whether the three columns hold in front of Ek's peers before anything moves.

**Stage 1 — name the piles, change no behaviour.** Split the `ENGINES` arrays into
`VOICE_PIDS` / `HEAD_PIDS` / `KEEP_PIDS` and build the sheet's sections from them. Pure
refactor; `engine-audit` proves it.

**Stage 2 — voices become first-class.** `mubone_voices`, the `+` on an engine title mints and
names a voice, the rail grows a voices row. The 13 tiles still exist, now as pairings. **This is
the stage that delivers the four granular sounds**, and it is worth having on its own.

**Stage 3 — heads become first-class.** The rail shows heads; picking is two clicks; the hand
tile shows both.

**Stage 4 — keeps becomes a field.** `looper` and `overdub` stop being heads. The cross product
is complete.

**Stage 5 — the wet decision** (§ 9.3), last, because it is the only stage with a behavioural
risk and it wants Stage 2 in your hands first.

Stages 0–2 are reversible and leave `main` playable. Stage 4 is the one that deletes tiles.

## 9. Open questions — decide these before Stage 2

**9.1 `match` does not decompose.** Every other head decides *where a mark lands*; match decides
*which material the mark reads* — and "where it reads from" is currently a voice param
(`startJit`, "read-OFFSET randomness … it widens each grain's reach into the audio between
markers"). So match is either a third axis, a voice mode, or a head that is allowed to reach into
the voice's business. It is the only one of the 13 that refuses the model, which is why it should
be argued rather than forced.

**9.2 A 53px tile has to say "scatter + wash".** The glyph carries the head, the hue carries the
engine, and the voice has nowhere to go. Options: a 2–3 letter voice tag in the tile; the voice
in the legend row (currently the key binding's, 15px); or the pairing carries a name you give it
when you place it. Worth drawing three ways rather than picking here — `docs/mockups`.

**9.3 Live voices, or keep `wet`.** A named voice is live by nature: every stroke made with it
follows it, the way a note follows its preset. Freezing becomes *duplicate the voice* — one bench
click, and it leaves two things you can see and recall instead of two anonymous frozen blocks. It
deletes `wet`, `setWet`, `dryVoicing`, the drop glyph and `wetOff`, the row button, and the #352
dilemma. **The risk, stated plainly:** a pot sweep then moves every stroke ever painted with that
voice. Expressive or frightening, and neither of us knows which until it is played. `docs/RULINGS.md`
"Wet paint" is the ruling this would reverse.

**9.4 Keeps is three-way** (`no · loop · join`), and the shape memory says a performance control
is boolean with its third state on a settings page. But keeps is part of a tile's definition,
not a control on the playing surface — so this may be fine. Needs Ek's call.

**9.5 Erase:** one head with `depth`/`efrom`/`escope` exposed, or three named heads? The three
names are instantly readable and the params are unperformable numbers, which is the case where
presets earn their tiles.

**9.6 Scope of a voice:** engine-scoped (a tape voice and a grain voice may share a name), which
is what § 5 assumes.

## 10. The lens: a head, a boundary, and no voice

The lens is the EYE — *"the tile row says what the HAND does, the lens says what the EYE does, and
they compose"* — so it is installed, one at a time, wears `.on` because it is a choice, and
**does not enter the cross product**. But it answers the same questions, and its own sheet was
reorganised into them on 2026-09-18, the same day the tape sheet was:

```
reach       reads · radius              governs BOTH engines
on grains   mode · depth · k · order · fade · falloff
on strokes  dwell · start · release · retrig · rearm
```

| | the hand | the eye |
|---|---|---|
| **head** — the geometry of the gesture | `deposit` | `reach` + `on grains` |
| **voice** — what it sounds like | yes | **none** |
| **the boundary event** | `on end` — when I let go | `on strokes` — when I arrive |

The mirror in the last row is exact: the end of a stroke and the arrival of the cursor are the
same kind of moment, and both engines give it a section of its own.

**The lens has no voice, and that is a ruling already made twice.** Two features tried to give it
one — the grain filter (#292) and audition (2026-08-29 → 2026-09-03) — and both were deleted,
*"both of which forced every cursor candidate onto voicing 0 to hear the whole sphere through one
engine"*. Wet paint replaced them by putting the live sound back on the brush. So the model
generalises:

> **Every engine has a head. Only what sounds has a voice. Only what deposits has an end.**

grain and tape take all three. Erase takes a head alone — and its section is already called
`reach` too, sharing `depth` with the lens. The lens takes a head and a boundary.

**What that does to the rail: the lens is erase-shaped** — no voices row, just named reaches. And
here the model discriminates rather than deleting. `wide` and `spot` are `mode: area` and
`mode: nearest`, exactly as `loop` was `onEnd` — but since the three-way landed (2026-09-18,
`area · nearest · stroke`), **`stroke` has no tile at all**. By the earns-a-tile test the three
are three genuinely different ways of reading, like the three scrapes, so they earn their tiles.
The lens is not carrying two tiles too many. It is missing one.

## 11. The two honesty fixes this supersedes, and the one it does not

From the same conversation, and independent of any of the above:

- **The pins fader shows the outcome, not your setting** — `_level()` returns `g × m × w`, so a
  pin you muted and a pin you pulled to zero draw identically, breaking *"if I see that slider in
  that position, it's set"*. `R.fill` and `R.edge` are both written every frame from the same
  number; split them — the edge is where your hand left it, the fill is what is sounding. **Not
  superseded by this plan; do it whenever.**
- **The sheet head colours a tool by a hue nothing else uses** — `TILE_DEFS.c` is read at exactly
  one site (`tiles.js:3062`), so `match` is green in its sheet head and grain-orange everywhere
  else. Superseded: under § 2 voices have names and heads take the engine hue, and `TILE_DEFS.c`
  goes away with `TILE_DEFS`. Two characters if you want it fixed before then.
