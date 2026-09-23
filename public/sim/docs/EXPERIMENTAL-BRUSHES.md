# Experimental brushes — the bench and the built

> **Status: CURRENT** — written 2026-08-25, the day everything here was built or benched.
> **Culled 2026-08-29, and the line closed 2026-09-22.** The page for the #218 line of work, kept
> for what it records rather than for what is live. **There are no experimental brushes any more.**
> **All four are gone.** `match` and `staff` were deleted outright; `spray` and `sort by` became
> ordinary grain shape params on every sheet — each with its off inside its own value — and were
> both sunset within the same day, `sort by` with the `index` tile that was its preset and `spray`
> that evening ("too complicated to have dynamic spray … this is not an app to do visual
> painting"). The `spray` and `index` PRESETS went with them. The grain sheet's DEPOSIT section is
> `rate` and `width`; the head is static again — `headOffset` with `S.headWidthDeg` and
> `S.headEdge`, and whether a wider head is MUSICAL is the open question. RULINGS.md, "SPRAY IS
> SUNSET" and the superseded "A head is a SHAPE PARAM" below it, carry the reasoning. Every tuning constant is named below so a rig
> session can calibrate them without reading code. The unbuilt bench at the end is the idea
> pool from the same brainstorms — kept so nothing is lost. `docs/archive/BRUSH-MODEL.md` § 1d-bis
> carries the design reasoning; this page is the inventory.
>
> **What the first session settled** (Ek, playing them): *spray [now pen] is our classic, good. splatter
> makes sense. comb is cool. match has potential.* Potential is what it stayed: it was deleted
> four weeks later without ever earning a session. **echo, chop and pour were deleted** — see
> § Culled. **staff was broken, not bad**: a unit bug pinned every mark to the bottom of the
> sphere, fixed the same day (see its row).

The frame, settled with Ek across three passes:

- **Dynamism is a CONTRACT, chosen not modal.** A brush's character is predetermined; picking
  the tile is the control. Where a brush listens (to speed, to the voice), that listening IS
  its fixed contract — nothing modulates a brush you didn't choose.
- **Only data already in hand.** Cursor position history, the live input's feature frame
  (rms / centroid / zcr), and the corpus of marks already painted. No new sensor taps.
- One field carries the active contract: `S.brushFx` — `'none' | 'spray' |
  'comb' | 'staff' | 'slice'` — set on tile selection
  (`_applyBrushCharacter`, `js/tiles.js`). All engine code is `js/paint-ticker.js`.

## Built — on the tile row now

| Brush | One line | Listen for on the rig | Tunables (`paint-ticker.js`) |
|---|---|---|---|
| **splatter** | Scatter rides your speed with a forward fling; width rides your voice. Slow + quiet ≈ a line, a loud flick is a splash | Does gesture-driven deposit feel like playing or like noise? Is the fling readable? | `SPLAT_SPEED_W/MAX`, `SPLAT_VOICE_W/MAX`, `SPLAT_THROW/MAX` |
| **index** (`comb` until 2026-09-22) | The path stays, the phrase redistributes — the stroke live-sorts its marks along the drawn line by a feature. Now the `sort by` row on every grain sheet; the tile is the preset that sets it to noisy | Sweep an indexed line: is scrubbing-by-timbre musical, and is zcr the axis that reads first? | `sort by` on the sheet (the `keep` sieve is deleted) |

### staff's unit bug (found and fixed 2026-08-29)

Ek: *"staff doesn't work, I just see it deposit at the bottom."* It was not a tuning problem
and it had never worked. `staffLat()`'s endpoints are **hertz** — 110 Hz at the bottom of the
sphere, 7040 Hz at the top — but the value handed to it, `feat.centroid`, is the **normalised**
centroid `js/audio-features.js` publishes: mean bin over bin count, a fraction of Nyquist, never
greater than 1. Clamped against a 110 Hz floor, every sound in the world produced `lat = -0.9`.

The conversion (`centroidNorm × sampleRate / 2`) belongs inside `staffLat` rather than at the
call site: `centroid` is normalised **everywhere else in the app** — `featuresToColor`, the viz
hue, the patch table — and staff is the only consumer that wants hertz. Moving the units at the
boundary keeps that one true fact about the field intact.

Worth naming as a class: this is the same failure the cc-action `curve` flag has
(`scripts/verify-action-ranges.js` exists for it). A number crosses a boundary carrying the
wrong unit, nothing throws, and the UI keeps showing something plausible. There is no harness
for the brushes yet; the bench below is where one would go.

## Culled — deleted 2026-08-29

Removed from `js/tiles.js`, `js/paint-ticker.js` and `S.fx` the day Ek played them.
`git log --diff-filter=D` finds the code; this is why each went.

| Brush | What it was | Why it went |
|---|---|---|
| **echo** | Three fading repeats behind along the drawn path, same moment — delay time was drawn distance | Cut on sight. The idea reads better than it plays: the repeats are marks, not echoes, so they granulate as material rather than decaying like a delay |
| **chop** | The transient sieve: marks landed only on a level jump, reducing a phrase to its attacks | Cut on sight. `scrape` plus a tight paint gate reaches the same place with controls that already exist |
| **pour** | Spray whose flow rate rode motion — sweep for spray, dwell for drips, EMA-glided | Cut on sight. It was the only brush that moved the deposit CLOCK, which made `flow` mean two different things depending on which tile was armed |
| **staff** (2026-09-22) | Longitude from the hand, **latitude from brightness** (6 octaves, log; 110 Hz bottom → 7 kHz top) — the sphere as a spectrogram you played | Ek: "remove staff low and hi, and the staff setting." It is the one head that cannot become a general shape param: it takes latitude away from the hand, and a param that does that cannot sit at a default behind every other shape. Its unit bug, below, is kept as the worked example |
| **match** (2026-09-22) | CataRT *query*: each deposit laid the best descriptor match from everything already painted — your voice digging moments out of your own corpus | Four weeks on the strip and still "has potential" — never a brush anyone reached for. It was also the one experimental brush that graduated NO tunable: its three weights stayed constants in `paint-ticker.js`, so there was nothing to tune it with in a session, which is the whole point of this page. Gone with `concatMatch`, `_depositConcat` and `CONCAT_W_RMS/CENT/ZCR`; `_centHz` stayed, because comb's sieve uses it |

Also in every brush's reach: the **static head** (`head` 0–30° + `edge` hard/soft on the pen and
stamp — `S.headWidthDeg`/`S.headEdge`). (Aperture, which used to be
listed here, was retired by #233 — k, fill and order are the lens's own now.)

Everything is verified numerically on the rig (see TODO #218 for the numbers) but **none of it
has been played with a mic** — the constants exist to be moved in a session, not trusted.

**2026-08-26 (#225): the tunables graduated.** The constants named above became state
(`S.fx.*`) and live as knobs in every granular tile's design view, EXPERIMENTAL section —
splat spread/throw, staff lo/hi, plus comb's sort/keep. That section was a fold from #283 until
2026-09-22 and is an ordinary open section now (Ek: "dont make experimental a dropdown in the
grain shape sheet"); a tool only ever shows the rows that are its own, which is two. (Drip/spray, repeats/spacing and chop
rise went with their brushes on 2026-08-29.)
They capture per tile like any engine param. The `paint-ticker.js` constants remain only as
defaults.

## The bench — designed, unbuilt, in rough order of pull

Motion-quality set (all derivable from the cursor history splatter already keeps — curvature,
winding, straightness, reversal rate are each a few lines on a shared helper):

- **stir** — the CW/CCW winding sign used whole: clockwise circles deposit, counterclockwise
  circles LIFT PAINT OFF. One gesture that is its own eraser by stir direction. The boldest
  test of motion-quality-as-meaning; first pick.
- **lathe** — circling detected → each lap works the area: density accumulates per revolution,
  straight travel lays thin. Circling = spending effort here.
- **hatch** — back-and-forth reversals fill the swept band dense, like pencil shading.
- **italic** — a fixed nib angle: stroke across it wide, along it thin. Calligraphy with no
  wrist data.
- **slow-is-deep** — speed → per-mark grain duration: careful movement lays long grains, fast
  passes lay ticks.

Feature/corpus set:

- **magnet** — new marks pulled toward timbre-similar neighbours (or repelled): the sphere
  self-organises into a timbre map through playing. Exciting, and the most likely to turn to
  mud — hear before trusting.
- **moss** — paints only where material already exists (thickening), or only into emptiness
  (gap-filling that can't mud up what's built).
- **drip** — heavy paint sags: marks displace downward with loudness; loud moments hang below
  the path like runs.
- **orbit** — marks circle the cursor as you draw, laying a helix: spatial vibrato baked into
  material.
- **stitch** — a duty-cycled deposit clock: bursts and gaps, a drawn tremolo. (The clock
  itself is now a visible `flow` row on the granular brushes — stitch is its rhythmic cousin.)
- **even-flow** — deposit per DISTANCE instead of per time: constant marks-per-degree along
  the path, like real paint. Today's time-based clock makes dwell = thickness (musical info);
  per-distance gives uniform lines whatever the speed. Two valid contracts — the brush decides.
- **voice-flow** — the clock rides the input level: louder = denser deposit. Pressure, again,
  applied to rate rather than width. (pour took the motion half of this idea the next morning;
  voice-flow remains the level half.)
- **gravel/wash** — feature → grain duration at deposit: bright moments short, dark long. One
  brush whose texture varies with what it was fed (`grainDuration` is already per-mark; no
  voicing machinery needed).
- **picky line** — a slice variant that lays trigger points only on material meeting a
  criterion (only bright attacks, only percussive, only a chosen band) — Ek's framing the day
  slice was built. `detectOnsets` already yields the boundaries; the criterion is a filter over
  each segment's features. Note: **slice itself is a CORE tool, not experimental** — it lives
  beside line and its detector is guarded by `trigger-audit` § slice.
- **spatial-scatter = time-scatter** — a head refinement, not a brush: a mark flung far also
  gets its `grainStart` smeared with the offset, so a splatter's fringe is its temporal halo.

Gesture-IMU set (needs new sensor taps — deliberately deferred by Ek):

- **the roll nib** — wrist roll as the calligraphy angle. The most on-the-body idea here.
- **paint load** — strokes thin as they lengthen until re-dipped (a pause, a loud attack).
- **tremor** — hand-shake jitter → scatter width; steadiness as a texture control.

## Open questions for the check-back

1. Which built brushes survive contact with a mic? (Expected cuts are fine — that's what the
   bench is for.)
2. Persistence: (ANSWERED 2026-09-22 — spray and sort by are shape pids now, captured into a
   tile's block like every other number.) `brushFx`, head, comb axis/keep all live in memory only. They should
   ride with user-made tiles when #214 lands — decide then, not before.
3. Should match search inside the lens's reach rather than the whole sphere? (The scope and
   the brush meeting; one-line change either way.)
4. Does a combed stroke remember its axis (re-comb after erase) or stay frozen at release?
   Current answer: frozen, same physicality as frozen brushes.
5. The tile row is getting long (15 hands). When favourites emerge, the losers go to the bench
   here rather than sitting as ghosts — same day, per the CLAUDE.md rule.
