# Brush model — the 1.14 redesign

> **Status: ARCHIVED 2026-09-05** — the plan for the tile screen, v1–v3, all shipped or superseded. The rulings live in `docs/RULINGS.md` (palette, main button, tiles); the code is `js/tiles.js`. Record only; do not learn current behaviour from it.

> **Status: DESIGN INTENT** — the model, rewritten 2026-08-25 (v2) after Ek's own planning pass.
> **Nothing on `main`.** Branch `brush-model` carries a v1 build whose *layout* is worth keeping
> and whose *tool model* this document supersedes — see § 0.
>
> **§ 5's measurements describe 1.13, not the branch.** Read them as the problem statement they
> are: on `brush-model` the eleven panels and the top bar are hidden (#291), and step 2 of § 11 is
> done.
>
> Naming lives in `docs/VOCABULARY.md`. Read it alongside this one.
>
> **v2 changed the model, not the argument.** § 5's audit of what is wrong with 1.13 stands
> untouched and is still the reason any of this exists. What changed is the answer.

---

## Why now

Eight months of playing the instrument produced the right features in the wrong shape. Every one
of them earned its place on a rig — the hit tool came out of the percussion workshop,
`start: 'ends'` exists because a turntable only ever arrives at one end of a stroke, erase became
a trimming tool because that is what you needed mid-set. None of it is wrong.

What is wrong is that each answer arrived as **a new mode next to the old modes**. Nothing was
ever asked to move over. The result is not a complicated instrument — it is a simple instrument
wearing eleven coats.

The measurable version, at 1.13 alpha: 11 right-panel devices, 11 modals, 101 bindable actions,
141 buttons, 62 sliders, 75 segmented switches. And **seven independent flags decide what the
cursor does**: `traceMode` (3) × `commitMode` (2) × `scanMuted` × `trigMuted` × `eraseHeld` ×
`composerMode` × `activeSampleIndex` (11) = **1,056 distinct cursor behaviours**, or 8,448 once
`nearestMode`, `grainKAllMode` and `grainKSeqMode` are counted. Procreate has one: the selected
tool.

---

## 0. What v1 got wrong

v1 proposed four tools — Paint, Hold, Erase, Arrange — in one list, and built them as a floating
dock. Playing it exposed two errors, both of the same kind: **a list of peers that are not peers.**

- **Hold is not a tool.** It is a *gesture*, and it needs a destination. You do not select
  "hold" and then use it; you hold *this* thing *into* somewhere.
- **Arrange is not a tool.** It is a *room* — a whole view with its own controls.
- **And a brush is not a state you toggle between.** The dock made brushes look like modes,
  which is precisely the thing the redesign exists to remove. The v1 rail (see the *Six Brushes*
  mockup) was the better presentation and is what § 3c now describes.

The correction is to stop having one list. There are **four different kinds of thing**, and
conflating any two of them is what produced 1.13 in the first place.

> **The v1 build was removed from the tree 2026-08-25 (#208).** `js/tool.js` (the four-peer
> selector), `js/tool-layout.js` (the dock layout) and `js/ui-layers.js` (the v1 arrange rail)
> are gone, along with `S.tool`, the five `tool_*` actions and the `/tool/*` OSC addresses.
> Recoverable at tag `v1-tool-build` (`651f9c7`). What survived in place: the brush library and
> "the brush decides the material", extracted to `js/brush.js`; the #205 canvas-ownership
> mechanism in `events.js`; `js/layers.js` as the persistence substrate of #207 (its destructive
> mute is still marked for replacement by the derived rule in § 3e).

---

## 1. The model

### 1a. Four classes, not one list

| Class | What it does | Members | Extensible |
|---|---|---|---|
| **Brushes** | *add* material to the scratch layer | line · spray · stamp | yes — duplicate and customise |
| **Edit tools** | *act on* material already there | scrape top · scrape bottom · scrape all | yes |
| **Hold** | a **gesture**, not a tool — press a layer number | — | — |
| **Rooms** | perform · arrange | — | — |

Only the first two are selectable things in the rail. They are two separate kinds — one adds
and one takes away — and the built row tells them apart by glyph hue alone, not by dividers:
the row stays freely orderable so any tile can sit on any digit.

### 1b. Scratch, and layers

Everything you paint lands in **scratch**. Scratch material **sounds only under the cursor** —
it is what you are playing, live, right now.

**Holding files a clone into a numbered layer**, and a layer **sounds on its own**. That is the
whole distinction, and it is the only thing scratch-vs-layer means:

> scratch = sounds when you are on it · a layer = sounds whether you are on it or not

The name is Photoshop's and earns its place: it says "not committed" without inventing a concept,
and it gives the sphere a default state that needs no explanation.

### 1c. The hold gesture

**Press and hold a layer number while the cursor is on material.**

On **press**, the hold clones what the cursor is *currently sounding at that position*:

- on a **line** stroke — its buffer, as a loop
- on **spray** material — the cloud the cursor is making, which **may draw on several buffers at
  once**. This is the important case: a spray hold is not "this stroke", it is *this position's
  granulation* — a function of where you are, your reach and the recency depth
- on a **stamp** — that placed sample, looping

While **held**, the hold records the cursor's path. On **release**, that path is its motion.

**There is no tap-versus-hold threshold, and that is the point.** A quick press naturally yields a
path of near-zero length, so a stationary hold is not a special case, a mode, or a branch — it is
the degenerate version of the only behaviour. `COMMIT_DRAW_THRESHOLD_MS` and
`MOVING_SEED_THRESHOLD_MS` stop existing rather than moving somewhere else.

**Nothing leaves scratch.** The stroke you held from is still there, still scannable, still
paintable over. The hold is an additional sounding object.

> **Carry the E9 lesson into the clone.** `docs/EXPORT-IMPORT-AUDIT-2026-08.md` § E9 exists
> because a loop stored `S.particles.indexOf(p)` for objects deliberately replaced by copies —
> every index came back `−1` and every imported loop was silent for months. A hold is now
> explicitly a clone, so **it stores values, never indices into an array its objects are not in.**

**What this deletes outright:** `commitMode` and its cycle key and OSC address, the cloud/loop
segmented control, `commit_drop` vs `commit_draw` as two actions, both threshold constants, and
the entire idea of choosing what kind of thing you are about to make. **The stroke already knows.**

### 1c-bis. A hold is the cursor, dropped

> [Ek] *"it's more like if that cursor was dropped there."*

That settles the clone-versus-live-view question by dissolving it. **A hold is not a copy of
material. It is a copy of the CURSOR** — position, reach, and the brush settings in force at the
moment you pressed — left running there. It then reads whatever material is in its reach, exactly
the way the cursor does.

Every consequence falls out the right way:

- **Erasing under a hold changes what it plays**, because a cursor plays what is there. Erase
  stays an editor rather than acquiring a special case.
- **No memory grows per hold.** It stores parameters, not audio.
- **E9's bug class cannot recur** — nothing holds detached copies of anything, so there is no
  array for an index to be wrong about.
- **Cloud and loop stop differing.** Today's cloud *already is* a dropped cursor: position,
  radius, grain params, re-reading `S.particles` every tick. Today's loop is not — it extracts a
  buffer and owns detached copies (`buildLoopPayload`). Under this rule the loop becomes a dropped
  cursor too, reading the line's material live.

**That last point is § 3a arriving from the other direction.** The "one stroke type" section
argues for unifying three objects. This says there was only ever one object and the loop was the
odd one out. It is the cheaper path to the same place, and it means the migration is *making the
loop behave like the cloud*, not inventing a new shape for both.

### 1d. The brush contract

A brush owns **both halves of a mark** — how it goes down *and* how it reads back forever. That
is not a contradiction with "brushes paint into scratch"; it is the same rule as Procreate, and
it is what makes § 1c work with no mode anywhere.

Five questions define a brush completely:

> **Correction — "no tick" was too strong.** Verified against `js/trigger.js:400`: a trigger *is*
> particles (`particles: []`, filled by `rebuildTrigger`), and its playable region is derived from
> whichever survive. That is what makes the erase brush double as a trimming tool and what makes
> proximity work at all. **A stroke with no particles has nothing for the cursor to find and
> nothing for erase to cut.**
>
> So: **particles are the spatial index, not the grain clock.** Every stroke deposits them,
> whatever the brush. What varies is whether each one is a *grain onset* — spray yes, line and
> stamp no. Same data, two readings. `paintTicker`'s interval becomes a spray parameter governing
> onset density, not whether marks exist.

| | **line** (loop) | **spray** (grain) | **stamp** (sampler) |
|---|---|---|---|
| **deposits** | marks along a path + one buffer. Marks are **index, not onsets** | marks on a tick, each a window into the buffer | marks at one place + a file reference. **Not onsets** |
| **while painting** | monitors dry | granulates the incoming signal live | previews the sample |
| **on touch** | starts — from touch point / top / nearest end | granulates what is in reach | fires |
| **on dwell** | keeps looping while in reach | keeps granulating | once, or loops |
| **when held** | a loop playing on its own | a cloud granulating its own position | a looping sample |

Row 1 is a correction v1 missed: **`paintTicker`'s 50 ms deposit clock is a *spray* property, not
a global one.** A line is one continuous buffer with a path; a stamp is a single placed instance.
Only spray needs marks on a clock, and today all three would get them.

Rows 2–5 replace `dwell`, `start`, `retrig`, `scan`, `trigMuted` and `commitMode` — six controls
that exist because the answers were global instead of per-brush.

> **2026-08-28 — the stamp column is superseded by § 1g.** A sample is a *source*, not a brush:
> line and spray read unchanged, and stamp's rows redistribute to the sampler source (deposits,
> granulate/loop) and the hit brush (fires on touch).

### 1d-bis. The brush head — deposit geometry (Ek, 2026-08-25 — width + edge BUILT same day)

> **Scoped by Ek before building: the head is STATIC.** The paint qualities are predetermined
> by the chosen brush — deliberately not modulated by sensor movement. The hand supplies the
> path; the brush supplies the character; changing character means changing brushes, same as
> everything else. The gesture-driven levers below (splatter-from-speed, voice-as-pressure,
> the roll nib, paint load) stay recorded as idea space, unbuilt.
>
> **Built:** `headOffset()` in `paint-ticker.js` — **head** (band half-width, 0–30°, 0 = on the
> line) and **edge** (hard = uniform disc, crisp rim · soft = folded-gaussian, dense core with
> an airbrush skirt). Applies to spray and stamp; **a line never scatters** — it is a path by
> this section's own contract. Rows live in the spray/stamp options (`S.headWidthDeg`,
> `S.headEdge` — scope-free state, no panel mirror, no persistence yet). Longitude offsets are
> cos(lat)-corrected so the band keeps constant angular width away from the poles.
>
> **Three experimental brushes followed (Ek's go, same day) — dynamism as a CONTRACT, chosen
> not modal:** **splatter**, whose head listens to speed and voice (thrown paint lands ahead
> of the motion, loud playing loads the brush); **match**, the CataRT *query* — each deposit
> lays down the best descriptor match from everything already painted, by value (E9); and
> **comb**, the CataRT *layout* and the idea Ek actually described — **the path stays, the
> phrase redistributes**: the drawn polyline is kept as pure geometry and the stroke's marks
> continuously re-sort along it by a chosen feature (bright at the front, dark at the back),
> so the line becomes a sorted index of the phrase rather than a timeline, with a `keep`
> sieve dropping non-qualifying material entirely. This is the first brush to break the
> assumption that a stroke's layout is its timeline — the deepest unstated rule in the deposit
> path. A second round added **staff** (latitude is brightness — the sphere as a spectrogram
> you played), **echo** (fading repeats behind along the path — delay time as drawn distance)
> and **chop** (the transient sieve). All live in `paint-ticker.js` behind one contract field
> (`S.brushFx`), applied on tile selection. **The full inventory, tuning constants, unbuilt
> bench and check-back questions live in `docs/EXPERIMENTAL-BRUSHES.md`** — that page is the
> record; TODO #218 has the verification numbers.

Every brush today deposits its marks exactly on the cursor path — the stroke is a line of
marks because nothing else was ever possible. But a brush has a HEAD, and § 1d's "how it goes
down" was only ever half-answered. The unexplored half, from the painting side of the metaphor:

- **width** — a wide head scatters marks across a band around the path, so one sweep lays down
  a territory rather than a line. This is spatially SONIC, not cosmetic: wider material
  occupies more sphere, so it granulates over a wider region later and its VBAP image spreads.
- **edge** — hard vs soft: the distribution of marks across the width. Hard = uniform to the
  edge and stop; soft = gaussian falloff, sparse fringes that read (and sound) like the skirt
  of an airbrush.
- The deposit tick (spray's clock, § 1d row 1) already covers **flow**; head width and edge
  complete the set. All three are per-brush contract entries, frozen into the stroke like
  everything else (#210) — and they compose with the lens: the brush decides where marks LAND,
  the lens decides which are READ.

Cheap to prototype: `paint-ticker` offsets each mark perpendicular to the recent path direction
by `width × draw(profile)`. Worth building ONE brush (a soft wide spray) before generalising —
this is a playing question, exactly like the founding lens set.

### 1e. Presets retire

> **BUILT 2026-09-03 (#325)** — the bank, its storage category, the table editor, its migration
> flag, param locks and the cloud-morph slider are in `sandbox/sunset-2026-09-03/`. What made it
> possible was the same day's earlier ruling that a grain tile owns its whole block (TODO #324).

Not "a patch becomes a brush" — **the twenty granular presets were an artifact of one brush type
owning every parameter.** With three brush types that each have their own contract, a flat bank of
grain patches has nothing to be a bank *of*. Factory brushes, duplicate, customise. The patch
bank, its storage category, its table editor and its migration flag all go.

### 1f. Edit tools

The counterpart set. Three to start, all variations on *what does the cursor take away*:

| Tool | Removes |
|---|---|
| **scrape top** | the newest material under the cursor, revealing what was beneath. Today's erase brush, unchanged |
| **scrape bottom** | the oldest first — digs out the foundation, leaves the recent |
| **scrape all** | everything within the reach, no recency filter at all |

Later, and only sketched: erase by criterion — all bass, all bright, all percussive.
`audio-features.js` already computes centroid and RMS per mark, so the data exists and only the
"which criterion" surface is new.

### 1g. The sampler is an input, not a brush (Ek, 2026-08-28 — supersedes the stamp column)

> **BUILT the same day (#247)** — sourceKind/samplerIndex in state, `js/sampler.js` +
> `js/ui-source.js`, the source tiles as Ek ruled them (a grouped section left of the tile
> row, each live tile its own meter, the sampler tile opening its library sheet in design
> view), `/source/*` + `/sampler/*` replacing `/paint/N`, record-into-sampler via
> `sampler_record`, hit + sampler as the old stamp, the fx sieves reading file features, and
> export v9. The post tap below stays deliberately unbuilt. Details in TODO #247.

> "samples are more like selecting the input… in performance with multiple performers i found it
> very necessary to have clear which input is being used."

The stamp brush was the input leaking into the brush table. A loaded sample is not a way of
putting material down — it is **where the ink comes from**. Named that way, the signal chain has
three stations, each already owning its half of the instrument:

```
source (live ch N | sampler) → paint stage (the brush writes) → material on the sphere (the lens reads)
```

- **Source** — what the brush inks from. Exactly one at a time, and it must be visible on the
  performance screen: one level meter per live input plus a sampler cell, **click a meter to
  switch**. The strip already exists, buried in the audio-settings modal —
  `renderInputMeters()` in `ui-audio-settings.js` draws per-channel meters and highlights
  `S.mainInputChannel`, the channel feeding the engine. Switching is *deliberate*, not
  lens-speed: nobody flips live ↔ sampler mid-phrase.
- **Sampler** — the sample instrument. **One input channel** that is also a store: a library of
  files from disk (and, later, recorded takes) with a current-sample picker inside it — the old
  sampler modal, demoted to the sampler's own surface. Honest sizing from years of use: **nobody
  has ever played it live** — every mubone player brings their own instrument — so it is
  Ableton's Simpler with an audio-in, a **testing and piece-building tool**: load the sounds you
  will play live and build the piece without playing them.
- **Recording into it is gesture-free.** Nothing to do with the sensor, the cursor or space — a
  prep-time act, or at most a MIDI-mapped press, because the body/augmented instrument *is* the
  instrument and a live sample-load ceremony breaks that. ("Reserve the south pole as the
  sample's destination" was considered and dropped: solving a creative problem we don't have.)

**What dissolves.** The stamp column of § 1d redistributes with nothing left over: *deposits a
file reference* was the source; *granulate / loop it* is spray or line **from** the sampler
(`paint-ticker.js` already branches on `S.activeSampleIndex` at deposit time, so half of this
exists); *fires on touch, once or loops* is the hit brush's territory — **hit + sampler source is
the old stamp**. So there is no stamp engine and there are no stamp tiles. `activeSampleIndex`
becomes sampler-internal state (which sample is current), not brush state; `setBrush('stamp:…')`,
`brushClaimsTrace`'s stamp branch and the `paint1`–`paint10` dispatch path go with it, succeeded
by source-select and sampler-sample-select actions. Stroke colour keys off the **source**, not
the sample index — the multi-performer legibility win for free: every stroke on the sphere says
which input painted it.

**Bookmarked, deliberately unbuilt — the post tap.** The live-context version worth exploring
later: the sampler fed by a **tap** on the chain — `off` (files only; build this) · `pre` (dry
input before the paint stage) · `post` (whatever the system is playing, into a ring buffer, with
a *capture* action freezing the last N seconds into a take). Post is the creatively interesting
one: painting from the sampler snapshots the region into the stroke (#210's freezing rule), so
sampler → post tap → sampler is not a literal feedback loop but **generational resampling** —
paint from a capture of your own output, capture that, paint again. Build the plain sampler
first; the tap waits until it has a player asking for it. Tracked as #247.


## 2. The best renames are deletions — NOT BUILT

Counting every noun and verb the UI, the keyboard doc and the OSC namespace expose comes to about
**forty terms**. Most do not need better names. They need to stop existing.

| Today | Becomes | Why |
|---|---|---|
| `seed` · `seq` · `cloud` · `loop` · `playhead` · `commit` · `plant` · `drop` · `draw` · `uproot` · `lift` | **hold** | Eleven words for one idea: material that keeps sounding after the cursor leaves. Which kind it is follows from the brush, so it never needed its own name |
| `scan` · scan on/off · triggers on/off | **deleted** | The cursor always plays what it reaches. The only remaining state is silence, and that word is already **mute** |
| `traceMode` · `commitMode` · `composerMode` | **deleted** | Three mode-cycles that all answer "what is the cursor for". The tool answers it once |
| `patch` · `preset` · user/factory patch | **brush** | A saved parameter set *is* a brush. One concept where there were two |
| `recency` | **layers** | It limits how many of the newest buffers under the cursor are audible. That is a layer stack, and every painter knows what one is |
| `search radius` · trigger radius · erase radius | **reach** | Already unified in code by #185 — one cursor, one reach. Only the name lagged |
| `trigger` | **hit** | "Trigger" is a mechanism; "hit" is a musical event. One syllable, obvious verb |
| `sweep` · `erase all` | **erase** + **clear** | Sweep is erase with a filter. Folding it in leaves two destructive words instead of three |
| `session export` · `setup export` · import | **set** · **rig** | The audit already wrote the sentence: *setup is the rig, session is the music* |
| `morph` · radial morph · staging · snapshot · pin | **blend** | Five names for interpolating between saved parameter sets. Under brushes there is one verb |

Roughly **forty terms → fourteen**: paint, brush, mark, stroke, hold, reach, layers, hit, stamp,
mute, erase, arrange, set, rig.

> **2026-08-28:** *stamp* leaves the list — § 1g makes the sample a **source**, which joins the
> vocabulary in its place (with **sampler** naming the input that is also a store). The
> fires-on-touch reading was already **hit**. Still fourteen.

### The state that stops existing

Deleting a word only counts if the field goes with it. From `state.js`:

- `traceMode` and its three values (the `commitLockEnabled` / `seedLockEnabled` getter pair that
  mapped onto it went 2026-09-05; the grain sheet's `on end` row is what reads and writes it now)
- `commitMode` and the `seqModeEnabled` getter pair
- `scanMuted`, `trigMuted` — both fold into one `muted`
- `composerMode`, `_composerPrevScanMuted`, `_composerHold`
- `commitSlots` (fixed array of 16), `commitSlotCount`, `commitOverflow`, `selectionMode`,
  `commitPlayback`, `commitXfade`, `commitTether`
- The legacy alias family: `MAX_SEEDS`, `MAX_SEQS`, `SEED_COLORS`, `SEQ_COLORS`,
  `MOVING_SEED_THRESHOLD_MS`

**Delete the aliases in the same commit as the rename.** The project rule is no compat hedging,
and `state.js` already carries the reasoning, on `AXIS_SOURCES`: *delete the name, break loudly.*
Renaming on top of a getter alias gives you three live names for one field, which is how the
current situation happened.

---

## 3. The total redesign

### 3a. One stroke type — NOT BUILT

This is the part that makes everything above cheap instead of cosmetic. Today three objects live
on the sphere under three different ownership stories, and the code proves it. From
`js/ui-presets.js`:

- **A cloud slot** (line 673) is **27 fields**. It owns nothing — it re-searches `S.particles`
  every tick — and carries `lon`, `lat`, `searchRadiusDeg`, `nearestMode`, `kAllMode`,
  `kSeqMode`, a full 20-key `grainParams` snapshot, envelope state and moving-seed frames.
- **A loop slot** (line 1172) is **21 fields**. It owns *detached copies* of particles and an
  extracted buffer, and carries `strokeId`, `loopStart`, `loopEnd`, `playheadIndex`, `direction`,
  `speed`, `playing`, `anchorLon`, `anchorLat` and audio nodes.

**The two live in the same array and share four field names** — `type`, `slotIndex`, `color`,
`grainParams` — and one of those four means different things in each: 20 keys in a cloud, `{
volume }` in a loop. Position is `lon`/`lat` in one and `anchorLon`/`anchorLat` in the other.
Every consumer branches on `type` and hopes.

That is what produced E9 (loop particles serialised as `S.particles.indexOf(p)` on objects
`buildLoopPayload` had deliberately replaced with copies — every index came back `−1`, every
imported loop silent for months, past two audits), and it is why `composer-audit.js` § H has to
spell out that a loop claims its stroke by `strokeId` and not by the particle objects it holds.

**The good news is that the merge is already half-built.** A trigger entry (`js/trigger.js:400`)
is deliberately shaped like a loop slot — same `startOffset`, `direction`, `speed`, `playing`,
`color`, `_sourceNode`, `_gainNode`, `_revBuffer`, `_createdAt`, `_startedAt`, `grainParams:{
volume }` — with one `trigger:{}` sub-object bolted on for the gate. Ek's own code already
decided a hit is a loop with a gate. One more step makes a cloud the same thing.

```js
// The only object on the sphere.
{
  id:        7,                  // stable; survives save/load. Replaces slotIndex
  brush:     'wash',             // which brush painted it — #183, generalised
  material:  'grain',            // 'grain' | 'hit' | 'stamp'. Cached from the brush so
                                 // playback never resolves a brush at audio time
  particles: [ … ],              // the live objects in S.particles. NEVER copies (E9)
  buffer:    AudioBuffer,
  region:    { start, end },     // which span of the buffer this stroke owns
  lon, lat,                      // ONE name for position, everywhere
  colour:    '#e8a030',
  _builtAt:  0,                  // vs S._particleVersion — the rebuild check trigger.js
                                 // already uses, now shared by everything

  gate: null,                    // non-null iff material === 'hit'
                                 // { inside, lastFireAt, capX, capY, capZ, capRad }

  hold: null,                    // non-null iff the player held it. THIS ONE FIELD
                                 // replaces cloud / loop / playhead / armed-trigger
                                 // { since, silent, env, motion, audio }
}
```

Four rules, and there is nothing else to know:

- `hold === null` — material only. The cursor reads it when it reaches it.
- `hold !== null`, `material: 'grain'` — a granulator standing where you left it. (Today: a cloud.)
- `hold !== null`, `material: 'hit'` — the sample loops. (Today: `dwell: 'loop'`.)
- `gate !== null` — proximity fires it. A property of **material**, orthogonal to hold.

`hold.silent` is what Arrange toggles. That is the entire composer feature.

**Nothing owns a copy of anything**, so E7 (shared loop buffers duplicated per slot) and E9's
whole class of bug become impossible rather than fixed.

### 3b. The scheduler — NOT BUILT

`scheduleGrains()` runs every subsystem every tick, unconditionally, in this order: cursor scan →
moving-seed playheads → per-seed weights → seed data post → **trigger gates** → **composer gate**
→ loop playback. Two of those are gates for modes you are usually not in, each with its own
hysteresis constant and its own sweep of the cached-cartesian bounding cap, and
`refreshTriggers()` runs on top of that "unconditionally" by design.

Under one stroke type the tick has four phases:

1. **One proximity pass.** Walk the stroke list once, stamp `_inside`. One bounding-cap sweep, one
   hysteresis constant, one rearm window.
2. **Cursor read.** Group what the cursor reaches by `material`; hand each group to that
   material's playback.
3. **Holds.** Each held stroke advances per its own material.
4. **One post to the worklet.**

Two constants stop being guesses in two places. `hysteresis: 1.15` and `rearmMs: 120` appear
in both `trigger.js` and `composer.js` today, and **neither has ever been played on a rig** — #180
and the composer plan both say so. There is exactly one right moment to unify them: before they
are tuned.

The render loop benefits the same way. `_TRAIL_BUDGET = 120` is shared across all moving seeds and
was lowered from 200 because 200 measurably drifted the scheduler; with one active tool, only that
tool's overlay draws. And `tickMeters()`'s collapsed-panel early-out (#116) rarely fires today
because eleven panels are open by default — with one panel it fires almost always, for free.

### 3c. The layout — v3 BUILT 2026-08-25 (#216)

> The v3b/v3 blocks below are in the app as `body.tile-layout` — chrome, one full-bleed sphere,
> the layers rail, the tile row with the options bar under it, digits-as-tiles and `Q W E` as
> layers. `docs/mockups/brush-model-ui.html` is the layout authority; #216 in `docs/TODO.md`
> lists what is ghost-labelled rather than built (layer fade, doc chip, scrape bottom, redo,
> the design sheet, the 1+Q growing loop).

Three surfaces, and one test decides which a control belongs to: **if it is not true of every
tool, it belongs to a tool.**

**Chrome** — true of everything, always visible:
document name + dirty state · mute + master · undo · **reach** · Perform/Arrange · one Rig door.

Reach is the only shared *parameter*, and #185 already established why: one cursor, one reach.

**Stage** — the sphere. Same grid, same reach ring, same dot-plus-ring firing grains from the
2026-08-24 pass.

> **Revised 2026-08-25 (Ek): the brush decides how a mark LOOKS, too.** "Unchanged" was the plan
> until the tile screen made three materials playable side by side and identical dots stopped
> being honest. Per-material rendering in `drawParticles()`: **spray** stays the feature-hued
> dot; **line** material draws as one connected ribbon in its palette colour whose **width
> follows the recorded volume** — thin where the playing was quiet, swelling where it was loud
> (a path breaks where erase removed marks — no chord across a gap); **stamp** material draws as thin vertical
> bars whose height is the file's amplitude at that mark's offset — a stamp swept through space
> lays the file's waveform along the painted path. No new data: `paint-ticker` already computes
> per-mark rms from the sample buffer at deposit. The zero-alloc and batching contracts in § 7
> hold — all new buffers are preallocated and grown, never per-frame.

> **v3b — the keymap is two independent rows.** [Ek] **Numbers are tiles; `Q W E` are layers.**
> Not `⇧`+number: a modifier makes the second gesture a variation on the first, whereas two
> separate rows make them **simultaneous**, and simultaneity is the feature. Hold `1`+`Q` and a
> line records *and loops as it is drawn*, like a looper pedal. Hold `2` through a sweeping
> gesture and tap `E` three times: three clouds dropped mid-stroke without the spray stopping.
>
> **This means a hold can capture material that does not exist yet** — the stroke being painted
> right now, not just one already finished. For a line the hold keeps **growing** with the stroke
> until either key is released; spray and stamp capture at the instant of the tap, which is why
> three taps give three clouds rather than one that swells. **This is the one part of the gesture
> with no equivalent in the engine today:** `buildLoopPayload` runs on stroke *release*, so
> recording into a loop that is already looping is closer to `addPlayheadFromExisting` than to
> `createSeqFromStroke`, and is genuinely new work.
>
> Settings sit **under** the tile row, so the thing being adjusted is next to the thing pressed.
>
> **2026-08-28 (#251): still under the row, but ONE surface rather than two.** The perform strip
> and the design sheet were both built, and they showed the same numbers at once — the strip a
> chosen subset, the sheet everything. The strip is deleted; what sits under the row is the
> **properties** section, fixed height, hidden or shown. The ◉ eyes kept their job by changing
> what they point at: what shows on the TILE, not in a strip.

> **v3 — one screen, and a tile row.** [Ek] Superseding both the dock and the rail-of-tools:
> Photoshop's layout. **Options above** (the selected tile's settings, always visible so a brush
> can be tuned while the cursor is on the sound it is making), **layers on the right**
> permanently, **a row of tiles along the bottom**, sphere in the middle. **There is no arrange
> room** — the arrangement is simply always on screen, the way a layers panel always is.
>
> **The tile row is the play surface and its order is the keymap.** Brushes, edit tools, undo and
> redo all live in one row; **numbers run left to right, so a tile's position is its key** —
> nothing to memorise past "first tile is 1". Drag a tile and its number follows (forScore).
> **Numbers rather than letters** because a letter row is a keyboard-layout accident and a number
> row is not. Holding into a layer moves to **⇧1 / ⇧2 / ⇧3**, since the plain digits are now the
> tiles.
>
> **This retires the sample bank as well as the patch bank.** A stamp tile *is* a loaded sample:
> make another tile, point it at another file. No fixed ten slots, no `paint1`–`paint10`. The
> modular answer — *make a tile, keep a tile* — replaces both banks at once.
>
> **2026-08-28 — "a stamp tile is a loaded sample" is superseded by § 1g: there are no stamp
> tiles.** A loaded sample is a *source*, not a tile; the tile row stays brushes and edit tools
> only. The retirement of both banks and of `paint1`–`paint10` stands — the sample bank's
> successor is the sampler's own library, not the tile row.
>
> The section below described the v2 rail; its reasoning about what the rail holds still applies,
> now split between the options bar and the tile row.

**Tool rail** — a right-hand rail, **not a floating dock**. v1 shipped the dock and it was wrong:
floating chips over the visualisation imply brushes are states you toggle between, and it costs
canvas without buying legibility. The rail is the *Six Brushes* presentation — most of the screen
is the sphere, and one column holds:

1. the **brushes** (line · spray · stamp, `+` to add)
2. a divider
3. the **edit tools** (scrape top · bottom · all, `+` to add)
4. the **selected tool's settings**, live and editable *while the cursor is on a sound* — this is
   the thing to protect, and the reason settings are not banished to a separate page
5. a **layers** button, opening the arrange rail

Tapping a tool that is already selected opens its **design sheet** — full parameters, duplicate,
create new. The forScore model: the palette is for playing, the sheet is for designing, and the
same tap gets you both depending on whether the tool was already active.

> **BUILT 2026-08-26 as the DESIGN VIEW (#223), grown per Ek into the engine model:** every
> tile runs on an ENGINE — granular (spray + every experimental brush), loop/sample (line,
> slice), or scope (the lens) — and a chrome toggle flips the big window from the viz to the
> selected tile's whole engine surface. Each parameter carries an eye (◉/○) deciding whether
> it appears in the perform options bar, persisted per tile (`mubone_perform_vis`) — perform
> stays "the most important controls at my fingertips", design is everything under the hood.
> The engine registry in `js/tiles.js` (PARAM_DEFS / ENGINES) is the single description both
> views render from, every row writing through the real rig-view control.
>
> **And a day later (#224), tiles became PRESETS in earnest, per Ek's full statement of the
> architecture:** an engine defines the parameter vocabulary (the instrument designer decides
> what belongs to each, borrowed params included — depth sits in both scope and erase);
> **a tile is a saved configuration of one engine.** Selecting a tile APPLIES its params;
> editing any param captures the engine back into the tile (Procreate's rule — the brush
> remembers). Factory tiles start owning only what their identity requires — scrape-all IS
> the `depth: all` preset, no special code — and diverge as they are dialled. **`+` asks
> "which engine?"** (granular · loop · erase), snapshots the current dials into a new custom
> tile, and lands it on the BELT, armed, with **properties** open on it (#248/#251 — the design
> view became a fixed-height footer section, and the perform quick view it used to duplicate is
> gone). Store: `mubone_tiles`. Scope tiles are presets too, which
> resolves the per-scope field-memory question: yes, via the same mechanism. Still open from
> #214: retiring the patch/sample BANKS themselves, custom-tile rename/delete, and per-tile
> copies of the underlying state (values are still global between captures).

**Rig** — one settings surface, entered before a show and never during one. Seven modals land
here: audio settings, sensor setup, sensor mapping, accessory, LED, keys/MIDI/OSC, viz.

### 3d. Where every current surface lands — PARTLY BUILT

| Today | Becomes | Note |
|---|---|---|
| **session** panel | chrome + rig | Undo and clear are chrome. Sweep folds into Erase. Tare and cursor-lock are sensor controls |
| **erase** panel | Erase tool | Already a tool in all but name — it follows the reach and the layer filter |
| **patches** panel | the brush library | The 20 slots are all `material: 'grain'` brushes |
| **grain envelope** | Paint, per brush | Stays exactly as drawn — best readout in the app, and it is about one brush |
| **audio** panel | rig + chrome | Input, gate, dry monitor are rig. Master stays in chrome |
| **search** panel | reach (chrome) + brush | Reach to chrome; mode, k, layers, fade split between lens and brush |
| **grain** panel | brush params | Shared by every `grain` brush |
| **cursor** panel | dissolved | Trace → the record gesture. Scan → gone. Trace-mode → gone. Morph → blend. Axis sources → sensor |
| **commits** panel | Hold tool | Slots, overflow, selection, tether, crossfade were all consequences of cloud-vs-loop being a mode |
| **composer** panel | Arrange tool | Its four params are the gate's params, merged with the hit gate's |
| **trigger** panel | hit brushes | Moves wholesale. `trigMuted` retires |
| **sampler** modal | the sampler's own surface (§ 1g) | An *input* that is also a store: library, current-sample picker, record-in. Not tiles, not brushes |
| viz, audio settings, sensor setup, sensor mapping, accessory, LED, keys/MIDI/OSC, patch table | **rig** | Eight doors, one destination. None of them is a tool |
| **staging** modal | *unresolved* | See § 8 — it may not belong in mubone at all |
| **gesture** modal | rig + blend | Feature readouts are diagnostics; radial-morph pins merge into blend |

### 3e. Layers and Arrange — v1 BUILT, v2 REVISED

**v2 correction:** layers are not a grouping applied *after the fact* — they are the destination
of the hold gesture (§ 1c). You never "assign a hold to a layer"; the number you pressed *was* the
layer. Auto-grouping by material type, which v1 built, is superseded: a layer is whatever the
player put in it.

> **v3c — there is no arranger mode.** [Ek] The question was how to turn the cursor into an
> arranging instrument. The answer is that it never becomes one, because "cursor arranges layers"
> is not one behaviour — it is two, of different kinds:
>
> - **Continuous** (crossfade by distance) → an **amount**, and an amount of zero *is* "off". It
>   lives as a `layer fade` dial in the rail. At 0 the cursor does not touch the balance at all,
>   which is exactly what turning the mode off would have meant.
> - **Discrete** (flip a layer on touch — today's composer) → a **momentary verb**, so it is a
>   **tile** you hold and sweep, like erase. Not a latch.
>
> Both halves therefore fit surfaces that already exist, and the mode disappears. This is the same
> move that worked on `commitMode` and on hold-vs-tool: **the thing that looked like a mode was a
> parameter and a verb wearing a coat.**
>
> **The fade acts on whole layers**, not individual holds [Ek] — a layer's level follows the
> cursor's distance to the nearest thing in it. Per-hold distance is what `commitXfade` /
> `commitPlayback: 'focus'` already does, so layer-level is the part that needs building and the
> part that makes layers worth having.
>
> **What the momentary tile fixes, and what it does not.** Composer as a latch has to mute scan on
> entry, seed inside-flags so entering while standing on a commit does not toggle it (#193), and
> deliberately not restore on exit. As a tile the first and third stop applying. **The entry
> seeding still does** — you still press it while standing somewhere — so `toggleSeed()` is
> load-bearing, just over a much shorter window.
>
> **`scan` survives as an explicit switch** [Ek], and it belongs in the **chrome beside mute**, by
> this document's own test in § 3c: if it is not true of every tile it belongs to a tile, and if
> it is, it belongs in the chrome. Mute is "does the instrument sound"; scan is "does the cursor
> sound". Same class. Note this corrects § 1d: `scan` is **not** fully absorbed by each brush's
> *while painting* answer — that covers painting only, and auditioning material you are *not*
> painting is a separate, genuinely global question.

> **v4 — the scope (Ek, 2026-08-25; supersedes both the toggle tile and scan-in-chrome; BUILT
> the same day).** The tile row answers what the HAND does; a second family answers what the
> EYE does, and it never had a home — scan, reach, `nearestMode`, `recencyN`, the fade pair,
> and the toggle tile were all the same homeless question. The answer is the camera model:
> **the cursor always has a lens installed.** You pick the lens for the subject — wide, spot,
> arrange — set its **field** (reach; called *zoom* for a day) and **depth** (recency), leave it on, and paint. The
> **cap** is the toggle at the end of the scope set: the lens stays mounted with its settings,
> the cursor just stops reading (scan off). Scopes are TILES, rendered at the right end of the
> row separated by space, extensible like brushes — make a scope, keep a scope — but with no key badges: digits
> belong to the hands, and hand and eye compose (paint through any lens).
>
> Selection is **derived from the flags** (`composerMode` → arrange, `nearestMode` → spot/wide,
> `scanMuted` → cap), never stored — ⇧K and N keep working and the tiles cannot lie, the same
> derivation rule as § 3e audibility. This re-latches arranging, which v3c argued against —
> but v3c's real target was a mode with no home (composer juggling scan state invisibly); an
> installed lens is one visible selection on a permanent surface, the same rehabilitation that
> turned modes into brushes. The toggle tile retired: sweep-to-flip was an eye behaviour
> wearing a hand costume, which is why it confused. The continuous half (layer fade) becomes
> the arrange scope's falloff property when its engine lands. A hold already snapshots reach
> at drop, so "a hold is the cursor, dropped" now completes itself: **a hold is the cursor and
> its scope, dropped.** Open, deliberately: per-scope zoom memory (a lens keeps its zoom —
> defensible where per-brush reach was not, since the scope IS the pointing apparatus), and
> whether the cap silences hits too (today `trigMuted` is separate).
>
> **v4b — the scope absorbs the search panel; k resolves as APERTURE (Ek + built 2026-08-25).**
> Everything in the old search panel except ORDER is scope settings: field (radius), depth
> (recency), edge (the radius-fade pair), and density. Density looked like a collision with
> #212 (k frozen per brush) and is actually two quantities sharing a name: the brush's k is the
> MATERIAL's polyphony — character, frozen — and the scope's **aperture** is how many marks the
> LENS admits, live. Effective density = min(brush k, aperture); wide open (the default) is
> exactly the #212 behaviour, and stopping down caps k-all brushes too — the lens can narrow
> what the material offers but never force vinyl to be polyphonic. `pins-audit` § I guards
> both directions. ORDER stays outside the scope (Ek's call — it is about how admitted marks
> are sequenced, not which are admitted).

> **v4c — the family is called LENS (Ek, 2026-08-26).** "scope" carried the rifle sight as
> much as the camera — "i don't like the rifle scope connotation" — so the family keeps the
> camera model and drops the word with the crosshair. The quotes above keep saying *scope*
> because they are dated records; the code and every current surface say **lens** (the engine
> id, `S.lensAperture`, the tile classes, the old search panel's mode row). In the same pass
> the lens engine sheet became exhaustive: **mode** (area | nearest — the wide/spot identity,
> shown live and never captured into a preset, since flipping it IS switching lenses) joined
> field/depth/aperture/edge/curve, and arrange's gate surfaced whole — **flips, start,
> release, hysteresis, rearm** write through the composer panel. `start` answers the
> "based on a crossfade?" question: the flip is a 20 ms mute ramp, and *continue* is the
> mode where a loop was only ever muted and returns mid-phrase.

> **v4d — radius, fade, and the falloff diagram (Ek, 2026-08-26, same day).** *field* is
> renamed **radius** ("it's clear. it's the radius") and *edge* becomes **fade** — the camera
> metaphor keeps only the words that explain something (aperture, cap, the lenses themselves).
> **depth stays** — Ek: "depth makes sense" — but its readout now says what the number counts
> ("last 3 strokes", never a bare "3"). And the fade *curve %* is replaced by a drawn
> **falloff diagram**: an x/y plot of gain over distance (the worklet bridge's real formula,
> gain = (1 − d/r)^(1 + curve×3)), dragged vertically — down pulls the belly toward
> centre-only, up flattens toward an even ramp. A percentage said nothing about which way
> 100% bends; the shape says everything.

> **v4e — the sheet edits its own tile; factory edits are session-only (Ek, 2026-08-26,
> same day).** Supersedes v4c's mode rule within hours: flipping area↔nearest inside wide's
> sheet must NOT switch the lens — "everything on the engine sheet is for that tile." So
> installed-lens selection is now **stored** (only tapping a lens tile moves it; composerMode
> is the one flag still followed, for ⇧K), `mode` is an ordinary captured param (wide ships
> area, spot ships nearest, via FACTORY_PARAMS), and a factory tile's sheet edits overlay in
> memory only — temporary for the session, gone on reload. *"We'll reconcile how to save
> those later"* — deliberately unresolved. Custom `+` tiles keep persisting.

> **v4f — k, fill and order come home to the lens; aperture retired (Ek, 2026-08-27).**
> Reverses the k half of #212, and the reasoning is worth the record: the argument for
> brush-owned k ("vinyl at k=1 is character") predated **flow**. With the deposit clock, a
> brush's density is *painted into the material* — you can see how much paint there is — so
> what k actually decides is how many marks the cursor READS at once, which is a lens
> question, like radius and depth. The lens sheet now carries the whole old search panel:
> mode · radius · depth · **k** · **fill** (k | all) · **order** (random | step — homeless
> since v4b deliberately left it out) · fade · falloff, plus the arrange section. **Aperture
> is deleted** two days after it was coined: it existed only to cap k without touching the
> frozen brush — two controls fighting over one outcome — and with k on the lens it had no
> job left. Strokes no longer remember their k (the mono idiom is a lens preset: spot, k=1);
> k/fill/order left the patch vocabulary; voicings freeze only the sound.

> **v4g — the lens reads loops too; the loop engine keeps only what bakes in (Ek,
> 2026-08-27, same conversation).** The organising question is now explicit: **what gets
> baked in when the line is drawn, and why?** "When I draw that line I'm not thinking about
> how [touch playback] works" — so everything about TOUCHING a loop moves to the lens as an
> **on loops** section (dwell · start · release · retrig · rearm), the mirror of **on
> grains** (k · fill · order). The loop engine keeps the baked-in half: **speed** ("I am
> thinking about committing the speed — if I want it to play back half speed"), **how it
> slices** (chop, min slice), and level. Honest caveat, recorded in the code too: today
> these all still write live globals — the split is which TILE owns and applies them;
> per-stroke freezing of the baked-in half is future work.
>
> Three ideas from the same pass, recorded not built: **a dedicated looper tile** — a loop
> param that DOES earn brush placement is *what happens immediately after recording*: a tile
> whose loops start playing at once and lay themselves into a layer, a traditional looper
> (must square with the layer principles); **layer pickup** — ⇧Q/⇧W/⇧E to pick the nearest
> hold of that layer back up, the inverse of the hold gesture, never yet designed; and
> **self-killing loops** — decided at record time: play N passes, fading each, then delete.

> **v4h — all three built, and the baked half actually freezes (2026-08-27, same day).**
> The looper tile ships (loop engine, after slice): `armTrigger` fires a hook on every
> trigger-stroke release, and with looper selected the stroke also becomes a loop slot at
> once, stamped with the tile's dials as drawn (speed, volume, passes) and filed into its
> layer lazily by `layerOf()` — the armed trigger is not a doubling bug, same rule as the
> 1+Q hold. **⇧Q/W/E** is layer pickup, through the same release tail as ⌘D
> (`releaseNearestInLayer`). **passes** is the self-kill: the scheduler's wrap edge steps
> the gain down each pass and pass N releases the slot with a short fade (never the user's
> manual-release fade, which can be seconds) and deletes the stroke's paint and trigger.
> And the #240 freeze is real now: `_applyLiveParams` no longer pushes speed/volume — a
> trigger keeps what `_newTriggerShell` stamped at arm, so the dials change the NEXT
> recording, never what is on the sphere. Dwell still reaches sounding material live (it is
> the lens's). trigger-audit § read-time-vs-baked asserts both directions. *(v5a: the filing
> and the ⇧Q/W/E pickup are gone with the named groups — a loop joins the loops by being one,
> and the pickup is `-` / `releaseNearestPin`.)*

> **v4i — the rail is everything OFF-CURSOR; a claimed stroke leaves the lens's reach
> (Ek, 2026-08-27, same conversation).** The mental model, in Ek's words: *"scratch is
> subject to the cursor/lenses, then the right panel is actually everything off-cursor.
> Layer group is just how off-cursor things are grouped — it's not actually a layer
> panel."* So the boundary is the CLAIM, not a copy — nothing is file-wise cloned
> ("whether it needs to actually be cloned doesn't matter, probably not"): a stroke claimed
> by a live loop slot is off-cursor, and the lens stops reading it — touching a looping
> stroke fires nothing, which is the accidental-trigger fix that motivated the model. The
> claim follows the slot, not audibility (a composer-muted loop still holds its stroke);
> release the slot and the stroke is scratch again, under the leave-and-come-back rule.
> **v4j — erase reaches held loops; the looper contract is a param (Ek, 2026-08-27).**
> Erasing under a held loop now edits the MATERIAL, never the time: the erased spans go
> silent inside the loop while it keeps rolling (zeroed in place in the slot's buffer,
> which the playing source shares), and erasing the whole stroke takes the loop with it —
> the snapshot no longer makes held loops deaf to the eraser. `erases: touch | stroke` on
> the erase engine widens the take to whole strokes by contact. And "loops immediately" is
> the baked param `on end: arm | loop` rather than the looper tile's id — line/slice fix
> arm by identity, and any custom loop tile flips it to become a looper filed into a chosen
> group with intention.

> This REVISES § 1c's "nothing leaves scratch" for loop-claimed strokes — the marks stay
> painted and erasable, but the lens no longer reads them while the claim lives. Cloud-held
> granular material stays lens-readable, SETTLED same day (Ek: "correct — that should be
> lens readable"): a cloud claims a region, not a stroke, and the cursor granulating what a
> cloud also plays is the instrument working. The off-cursor claim rule is a loop rule.
> The looper's record-release audition also went: the loop starting IS the playback you
> hear. The rail's own text now says what it is.

> **v4k — the verb is PIN; *hold* and *layer* leave the vocabulary (Ek, 2026-08-27, the
> conversation after v4i).** The off-cursor model got its word: *"maybe pin is the verb and
> I just say, I have 4 things pinned. Some clouds and some loops … let's put a 'pin' in
> it."* **Pin** is the category — the kinds stay *cloud* and *loop* — and **unpin** returns
> a stroke to scratch, which is v4i's claim-release said in one word. The rail is titled
> **Pinned**; its rows are **groups**, never layers ("it's not actually a layer panel").
> This supersedes § 1c's *hold* wording before the `commit → hold` rename was ever run —
> the landing plan's step 1 is now `commit → pin`. The radial-morph "pins" (gesture panel,
> unused) were renamed **anchors** the same day so the word points at one thing. Full
> reasoning and the updated glossary: `docs/VOCABULARY.md` § Pin.

> **v4l — SUPERSEDED by v5a. The permanent groups; v1's type-defaults actually die
> (2026-08-28).** § 3e v2
> declared auto-grouping by material superseded, but the `grain` / `loops` defaults
> survived in `layers.js` — and because Q/W/E resolved by RAIL ORDER, pinning with Q filed
> into a group named "grain". Now the substrate seeds exactly three permanents —
> **group Q / group W / group E**, keyed `q`/`w`/`e` — and `layerForKey()` (moved into
> `layers.js`) resolves by key, never by position. **Every group is key-addressable**: a
> pin whose gesture named no group (the looper's auto-pin, the plain commit paths, a v6
> import) lands in group Q, the first, and the looper tile's `group` option is `Q | W | E`
> with Q the default. (An **inbox** for unfiled pins was built the same day and cut within
> hours — Ek: only the looper ever fed it, and it was the one group the keys could not
> address; "I still want the semantic of being able to add to that group with q w e.")
> Old sessions restore their own saved groups; missing permanents are appended on the next
> `ensureLayers()`. The group header also grew a real **M** mute button beside S — the
> colour dot was the mute all along, an invisible affordance, and is now just the group's
> swatch.

> **v5a — THE GROUPS ARE THE KINDS (Ek, 2026-08-30).** Named groups are sunset, and with
> them the two pin lenses. Ek: *"I still want pinned material but they should automatically
> group by if it's a loop or cloud, then I can mute or solo them as a group. But not group
> in the sense that we've been using it — all pinned material will just go into the pinned
> material, there's no group differentiator. And no weird filters to have to wrap our heads
> around."*
>
> So the rail has exactly two rows, **clouds** and **loops**, each with M and S, each
> present only when it holds something. **The group is DERIVED and stored nowhere** —
> `groupOf(c)` is `c.type` (`js/pins.js`) — which is the whole point: v4l's model needed a
> `layerId` per pin, a group set in the session file, five keys to address it, and the
> import-ordering guard in § E10 of the export audit. None of that has anywhere to go wrong
> when the answer is the pin's own kind. What survives is the **restore rule** (v3e's one
> testable behaviour) under the name `_preGroupOn`, and the blunt one-at-a-time solo.
>
> Three consequences. **`Q W E`, `⇧Q W E` and `⇧Tab` are free keys** — they only ever
> addressed groups; pinning is `=` and unpinning is `-`, and the looper gesture is `1 + =`.
> The trigger sheet's `group` option is gone for the same reason: a loop joins the loops by
> being a loop. And **the lens is the scratch layer's alone** — the two composing pin
> lenses (`pincloud` / `pinloop`, § v4-era) are deleted, `xfade` / `tether` are off the lens
> sheet, and **every pin parameter is on Settings → Pins**, reached from the gear in the
> rail's own header. How the pins share the mix is `S.commitPlayback` — Blend: *all* plays
> them flat, *focus* leans toward whichever is closest — which is the control the pin lenses
> had quietly taken over while leaving it on screen. `pins-audit` § A/B/E/G assert all of it.

> **v4m — the ghost pin (Ek, 2026-08-28).** Pressing Q/W/E with nothing in reach is a
> strategy, not an error: *"it's like painting a ghost pin so I can put scratch material
> there and know that it'll continue."* The press pins a **cloud** at the cursor — a cloud
> stores a place and re-reads the live particle pool every tick (`grain.js`), so scratch
> painted into its radius later simply starts sounding. **Ghosts are cloud-only by
> nature**, and the tap path already encodes this: only trigger material under the cursor
> makes a loop pin (`pinDown`, `js/tiles.js`; the gesture was on Q/W/E until v5a moved it
> to `=`), everything else — granular material and
> empty space alike — is the cloud branch. A ghost loop is not merely unsupported, it is
> incoherent: a cloud is a place that reads, a loop is a recording that plays, and with no
> stroke there is nothing to record. `pins-audit` § B asserts the ghost's type.

> **v4n — the path is the loop's clock (Ek, 2026-08-28).** Tightens v4j after rig time:
> erasing a pinned loop edits the MATERIAL and never the time — *"if the loop path is 4
> seconds … it's always 4 … it'll create creative gaps in the audio."* v4j's zeroing was
> right, but the hook also removed the matched copies from `slot.particles`, shortening
> the drawn path and compressing the pan traversal — and since a drawn loop path usually
> closes back near its start, erasing "the front" also bit the tail marks beside it,
> heard as the end of the audio disappearing. Now the copies STAY (flagged `_silenced`);
> the playhead and VBAP travel the full circuit through the gaps; the loop still dies
> only when its whole scratch stroke goes. Second fix found by the harness on the way in:
> per-mark edge ramps left a comb of ~6 ms full-level blips through a contiguous erase
> (end-ramp meeting start-ramp at every mark boundary) — spans are now merged per bite
> and ramp only against live audio. Third, found on the rig the same day: partial erase
> could still UNPIN the loop with material left, because the erase-split re-ids
> surviving segments and the loop's whole claim keys on strokeId — a mid-bite split
> re-ided the tail, and the "all scratch gone?" check then saw nothing under the
> original id. **A claimed stroke's trigger rebuild is now DEFERRED**
> (`refreshTriggers`): it cannot fire while claimed (#241) so there is nothing to
> rebuild for, and the trim / split / drop lands the moment the claim is released.
> Lines and slices are untouched: not in flight, so erasing ends trims the take and
> erasing the middle splits it into two strokes (`_assignSegmentIds`, shared with
> chop). `composer-audit` § D2 asserts the whole contract against a real playing
> source, armed trigger included. Two render-side consequences landed with it: the
> stroke RIBBON breaks at erased gaps by the stroke's own timeline — the old
> original-index break recomputed from the compacted array and never actually saw an
> erase, so the ribbon drew a chord — and the playhead RECTANGLE's tangent now comes
> from a wide baseline, angle-smoothed per slot (`_tickTx/Ty`): the adjacent mark is
> ~2 px away and an angle from that baseline is noise, which read as the rect
> wiggling wherever it rode an erased stretch with no ribbon under it. A claimed
> stroke also draws no armed-trigger outline (it cannot fire, and its deferred
> particle list is stale). Two trigger-side leaks the same testing found: a claim
> landing on a SOUNDING trigger now stops it (with enter/exit suppressed while
> claimed, a trigger fired before the pin had no stop edge left — it looped as if
> the cursor never left), and the play-to-end tail now schedules its `src.stop()`
> at the pass end — with `loop=false` the source ignores loopEnd and ran silently
> to the end of the whole recording, keeping the tail record alive so the marker
> wrapped from the start of a trimmed region for the length of the original take.
> `composer-audit` § D2 covers the first; the second was verified against the real
> gate (tail cleared at the pass remainder, not the buffer remainder).

> **v4o — the eraser is a swept capsule, and a line's segments are material (Ek,
> 2026-08-28).** *"A line should be just that — if I erase any part of the line it
> should erase."* Two sampling gaps in `erase.js` said otherwise at small radii: the
> brush tested a CIRCLE against MARKS, but marks deposit every 50 ms of hand motion
> (2–4° apart at drawing speed), so a 1–2° radius crossing a line between two marks
> touched nothing — and the circle itself was stamped every 30 ms, so a fast pass
> skipped stretches of its own path. Now the brush is the SEGMENT the cursor swept
> since the last tick, fattened by the radius (a >20°-per-tick jump is a TELEPORT
> and stamps rather than sweeps — a sensor glitch must not mow a swath across the
> sphere), and for line material (trig) the drawn segment between path-adjacent
> marks is itself erasable. Three refinements settled the bite size, each caught by
> the harness: the segment test fires only when the brush covers NEITHER mark and
> takes the single mark nearest the crossing (taking the bounding pair made a
> stationary erase bite ~double its diameter — every segment clipping the circle's
> edge donated its far endpoint); a pair carries a segment only when one deposit
> interval apart in the stroke's own timeline (without that, each tick re-paired
> the survivors across the fresh hole and kept drilling outward); and one removed
> mark is one removed adjacency — exactly what `_clusterByRemoval` keys on — so
> the minimal cut still splits the trigger in two, and the split's new strokeId
> breaks the ribbon. Verified through the real erase path: a 1.5° brush at the
> midpoint of a 4°-spaced line removes exactly one mark and leaves two triggers; a
> 3° brush parked on a mark removes exactly that mark. The LAST piece of "double
> wide" turned out to be the RENDERER, not the eraser: a ribbon run could only draw
> survivor-to-survivor, so a gap always read one full mark-spacing wider than the
> material removed. Runs now wear MATERIAL-TRUE END CAPS — each extends half its
> terminal segment past the end marks, the half-segment of line each mark stands
> for — and an erase gap reads as the eraser's own diameter. Hard edge, as asked:
> "only the stuff in the radius should erase." Two follow-on rules make the caps
> safe on CLAIMED strokes, where the erase-split (whose new strokeId is the usual
> ribbon break) is deferred: the eraser stamps `_gapAfter` on the survivor before
> each hole and the ribbon breaks on the stamp — a time threshold alone cannot
> tell a small hole from a musical rest the paint gate recorded, and without the
> stamp the ribbon chorded across sub-threshold holes and the caps then extended
> half of that chord into space ("a long straight line jets out"). And a cap only
> extends across a TRUE adjacency (terminal segment within the paint tick) —
> bridges over rests get flat caps. Sweep-undo clears the stamps, since it
> restores the same particle objects. Verified against a pinned (claim-deferred)
> line: two erases leave three clean segments, no chords, no jets.
>
> The rule that finally closed the intermittent small-radius misses (Ek: *"lines
> should fundamentally be audio strokes of buffer, a line, not particles"*): **the
> erasable geometry of a line is exactly what the ribbon draws — one shared
> threshold.** The paint gate leaves time gaps at every rest and decay; the ribbon
> bridges those up to its gap threshold, but the erase's segment pairing used a
> one-tick gate, so brushing across any bridged stretch hit nothing. Pairing now
> uses the ribbon's own threshold, and the thing that must NOT re-pair — an erase
> hole — is excluded by its `_gapAfter` stamp instead, which the ribbon honours
> too. The teleport guard also rose from ~20° to ~40° per tick: a wrist flick is
> a sweep, not a teleport, and an un-swept flick missed the line it crossed.
> Verified: a 1.5° brush crossing at a 0.2 s bridged rest cuts exactly one mark;
> a 3° brush held five ticks on a dense line removes exactly the marks inside 3°.
>
> **The root of the whole "sometimes it doesn't erase" saga, found last (Ek's 2°
> passes cutting ~10% of the time): the swept capsule was a straight 3D CHORD, and
> the sphere is curved.** A 60° sweep's chord sags 1−cos 30° ≈ 7.7° below the
> surface at mid-sweep; even a 20° tick-jump sags 1.5° — the brush TUNNELLED under
> the line it visibly crossed, and any radius smaller than the sag effectively
> vanished mid-sweep. Slow passes (short chords) hit, fast passes tunnelled — a
> hit rate that collapses with gesture speed, which is why every stationary
> harness test passed while the rig kept missing. Sweeps are now subdivided along
> the great circle (slerped waypoints, sub-segments ≤ 8°, sag < 0.25°), and the
> teleport guard became a VELOCITY budget (2500°/s over the measured tick gap,
> clamped 50–150°) — the erase tick slips under load, and a fixed per-tick cap
> kept eating real x-imu3 flicks. Measured through the real sensor-cursor path
> (a stubbed `_getSensorCursorQ` feeding the render loop): 9/9 crossings at 2°
> for both slow sweeps and single-tick 60° flicks, with the rest-bridge cut and
> the stationary-drill bound both still exact.

> **v4r — the reach ring is the projected true circle (Ek, 2026-08-28).** *"The
> cursor still looks flat … it doesn't look like it's on the sphere, just on the
> screen."* Correct, and it lied: the ring was a flat screen circle of
> `focalLen·tan(r)`, exact only on the view axis — this is a rectilinear
> projection at 80° FOV, and at a screen corner the true 2° region is an ELLIPSE
> ~2.5× the flat ring. The engine always captured in angular space (the ring was
> the only liar), but the ring is what the player aims erase and triggers with.
> It is now drawn by projecting the actual angular circle — 36 perimeter points
> around the cursor's world direction through the same cameraTransform/project as
> every particle — so it foreshortens, stretches and hugs the sphere honestly in
> every camera mode; the flat circle survives only as the fallback when the ring
> doesn't project. Still flat and known-lying: the cloud/slot catchment rings
> (`vizSearchRadiusDeg` in the renderer) — same fix applies when they start to
> grate. The DEEPER question Ek raised — whether the rectilinear projection
> itself should go — WAS DECIDED the same day, see the equidistant note below.
> Same projection, one more artifact fixed the same day:
> near ±90° off-axis tan blows up, a mark passes the z-cull but "projects"
> thousands of px off-screen, and every projected POLYLINE reaching for it drew
> a streak across the whole canvas (lines at the edges in steer mode). One
> shared guard (`_onCanvasish`, a one-canvas margin past each edge) now breaks
> the path there instead — applied to the stroke ribbon, the armed-trigger
> outlines, the graticule arcs and the reach ring.

> **v4s — the trigger gate sweeps, and reads the LINE (Ek, 2026-08-28).** Fast
> up-and-down retrig across a line fired "sometimes": two sampling gaps, the same
> two the eraser had. TEMPORAL — the gate sampled the cursor once per 20 ms tick,
> so a fast pass could be inside the band for less than a tick and never produce
> an enter edge; it now also tests the ARC swept since the previous distinct
> cursor position (slerped ≤ 8° sub-segments — a straight chord tunnels below the
> surface; velocity budget 2500°/s with dt measured from the last actual MOVE,
> because the cursor quaternion steps at the render rate while the gate ticks
> faster, and dt clamped so a flick from rest still sweeps). A swept crossing
> fires enter-then-exit at the nearest mark: a strum, riding the same rearm and
> release semantics. SPATIAL — the gate measured distance to MARKS, so a radius
> under half the mark spacing read "on the ribbon between marks" as outside; both
> the level gate and the swept crossing now measure distance to the stroke's
> drawn SEGMENTS under the ribbon's own pairing rules (bridge threshold,
> `_gapAfter`). Verified through the sensor-cursor path: 10/10 single-tick 60°
> flick crossings landing exactly between marks, previously 0/10; trigger-audit's
> hysteresis and cost sections stay green.

> **v4t — ONE VIEW: azimuthal equidistant, and the pull-back is retired (Ek,
> 2026-08-28).** *"I just want one view that's accurate, and a way to zoom out so
> that it becomes a flat map."* Two decisions in one. FIRST, the projection: the
> centred camera now projects AZIMUTHAL EQUIDISTANT — angular distance from the
> view axis is LINEAR pixel distance, so a 3° radius is the same size everywhere
> on screen, the reach ring is a circle, and nothing stretches toward the
> corners. From the centre every direction sees exactly one surface point (no
> occlusion, no "behind"), so the FOV slider (extended to 360°) doubles as the
> zoom: at 360 the whole sphere lies flat as a disc map, antipode at the rim —
> the world-map view. The far hemisphere draws dimmed (`facing` → 0). The
> boundary audit holds under it: a 3° erase brackets [2.92°, 3.04°] at centre,
> edges and corner alike. SECOND, the finding that reframed the week: every rig
> was booting with **camPull 1.2** restored from the saved viz calibration — the
> outside/demo view, rectilinear, was the view all along, and its off-axis
> stretch is what kept reading as "the cursor isn't on the sphere". The pull is
> retired from the UI: the calibration loader no longer restores it, the slider
> row is gone, and `S.camPull` survives console-only with the pulled render
> paths dormant at 0 — flagged for a deletion pass. `project()` /
> `screenToLonLat()` / `projectInto()` carry both models; everything else in the
> app is angular and never noticed the change (all five suites green untouched).
> OPEN from the same conversation: Ek wants ONE default way to engage the sphere
> (surface vs steer — the message reads both ways); not acted on yet.

> **v4u — round grid, scroll gestures, and "zoom" gets its name (Ek,
> 2026-08-28).** The "minecraft" grid was never a transform-cost problem — each
> arc point went through the ALLOCATING project(), and the step count had been
> halved to limit GC pressure. The arcs now use the zero-alloc projectInto at
> 48 steps (96 past 180° zoom, 12 per meridian segment): more segments, fewer
> allocations than the blocky version, nothing near the audio thread. Scroll on
> the canvas: plain scroll = RADIUS (dispatched as radius_inc/dec through the
> ACTIONS table so every mirror follows), ⇧-scroll = ZOOM (multiplicative,
> 10–360°); a custom scroll binding still wins. And the old "throw angle /
> projector calibration" slider is renamed **zoom** — with the equidistant view
> the one number IS the view span, the flat map lives at 360°, and matching it
> to the projector's throw is still exactly what room-locks a show (the tooltip
> keeps the throw table). `S.fovDeg` and `mubone_fovDeg` keep their internal
> names until a rename pass. The STROKE RIBBON and the armed-trigger outline got
> the same cure as the grid: marks sit 50 ms of hand travel apart and straight
> screen segments between them read as a polygon, so segments spanning more than
> ~3° are densified with slerped sub-points along the great circle — the drawn
> ribbon IS the true spherical path, the same one the eraser and the trigger
> gate test. Budget-bounded (`_LINE_SMOOTH_BUDGET` 800 sub-points/frame shared
> across strokes, 400 for outlines — the _TRAIL_BUDGET discipline); when the
> budget runs out later strokes draw straight. The material-true end caps still
> come from the original mark pair. Surface AND steer both stay (Ek). Grain DOTS
> got two accuracy fixes with it: the centred depth ramp is clamped at 1 (the
> equidistant view draws the far hemisphere, where the unclamped ramp OVERSIZED
> dots past max — facing already dims it as the depth cue), and dot size scales
> with the zoom (80° is the reference; zoomed to the map, marks keep a roughly
> constant angular footprint instead of swamping the disc). And the wheel radius
> is CONTINUOUS: `S._setSearchRadius` (same clamp and UI sync as the actions,
> 0.1° resolution, multiplicative on the wheel) — the 2° `radius_inc/dec` ladder
> stays for keys and pedals, where steps are the right feel. AUDITED under the
> new view (stationary erases across radius 1.5–10° × spacing 0.5–2°): visual
> hole / ring diameter = 1.00 in every cell, centring within half a mark
> spacing — the ring and the bite agree exactly. And "the line shifts when I
> erase" was the ARMED-TRIGGER OUTLINE, not the ribbon: its decimation stride
> divided a budget by the trigger COUNT, so the split after every erase
> resampled the outline along the whole stroke. Stride is now a fixed 48-point
> per-trigger cap — sampling depends only on the stroke's own marks, and any
> stroke of ≤48 marks draws every mark, provably erase-stable. The ribbon
> itself was proven pixel-identical across an erase (parked-cursor canvas
> diff); with the cursor MOVING, the ring and steer tether legitimately move
> with it — chrome, not material.

> **v4p — a pinned cut segment is the cut, not the take (Ek, 2026-08-28).** Touching
> a cut segment looped the right region, but PINNING it played through the erased
> gap into the rest of the original line. `buildLoopPayload` ended its region at
> `lastMark.grainStart + grainDuration` — and on a trigger stroke `grainDuration`
> is the GRANULAR grain length (seconds on a wash patch), the exact trap
> `_applyCluster` documents for triggers. The loop builder now uses the same rule
> for trig strokes: one median mark spacing past the last mark — the material the
> mark stands for. Granular strokes keep `grainDuration`; their grains genuinely
> read that span. Verified: marks carrying 2 s grains now pin to a 0.75 s loop that
> matches the trigger's own region, where before the loop owned 2.7 s.

> **v4q — erasing a line that is LOOPING re-bounds the audio in flight (Ek,
> 2026-08-28).** A looping trigger's source keeps the loop points it was STARTED
> with — they are plain node properties, not derived from the trigger — so erasing
> the line mid-loop re-bounded the marker maths but not the sound: paint gone,
> visual playhead looping the new shorter segment, audio still playing the old full
> region. `_applyCluster` now moves the live node's loop points when the region
> changes and re-seats `_startedAt` so marker and audio stay phase-locked; if the
> position being played was itself erased, or playback is reversed (the node's
> bounds live in reversed-buffer coordinates), it restarts at the top of the new
> region through the scheduler's own rebuild. Verified against the real gate: a
> mid-loop erase split the stroke, and the SAME playing source re-bounded from
> [1.0, 3.0] to [1.0, 1.8] without a restart.

**Arrange is a room, not a tool.** It is dedicated to how held material behaves: the layer list,
mute, solo, merge, creating layers, and crossfade. Nothing is painted there.

**Crossfade follows distance to each layer's material** [Ek]. A layer rises as the cursor
approaches anything in it and falls as you move away — emergent, needing no placement step, and
reusing today's commit-blend maths (`commitXfade`, `commitPlayback: 'focus'`) almost unchanged.
The known limit, worth stating: **two layers occupying the same region cannot be crossfaded
against each other**, because distance cannot tell them apart. If that bites, the fallback is
`interp-kernels.js` with per-layer anchors — the machinery radial morph already uses.

The rest of this section describes the v1 build, whose mechanics carry over:



Ek's framing, and the right one: the sphere says *where* a hold is and the tool strip says *what
kind*, but nothing let you act on a whole family at once. A **layer** is a named group of holds
that mute together — Photoshop's model, applied to sound.

Three properties make it cheap rather than a new subsystem:

- **A layer owns no audio.** `setLayerMuted()` calls `toggleCommit()` — the same path the cursor
  takes in arrange — so a loop is still MUTED (source keeps running, returns mid-phrase) and a
  cloud is still STOPPED. Nothing in `docs/archive/COMPOSER-MODE-PLAN.md` was re-implemented or changed.
- **Membership is lazy.** `layerOf(c)` assigns a hold to its type's default layer the first time
  anyone asks, so no creation path in `ui-presets.js` needed touching and a session made before
  layers existed still opens. Defaults are `grain` (clouds) and `loops`.
- **The gate needed one line.** `tickComposerGate` has exactly one `toggleCommit()` call;
  `S.arrangeScope` chooses between it and `toggleLayerOf()` there. No second gate, no second
  hysteresis constant — the thing § 3b exists to prevent.

> **v3 correction — audibility is DERIVED, never written.** [Ek asked for layer solo; building
> it showed the v1 approach was wrong.] A hold is audible unless **(a)** you muted that hold,
> **(b)** its layer is muted, or **(c)** another layer is soloed. Compute that at read time and
> the restore problem below **does not exist**: nothing is ever written into a hold, so a hold you
> silenced by hand survives any number of layer mutes and solos untouched. Verified: mute layer 1,
> solo layer 3, un-solo — layer 1 is still muted, because nothing ever un-muted it.
>
> This also gives the rail something honest to say. A quiet layer is quiet for one of three
> reasons and they undo differently, so the rail names it — `muted` (you did it), `ducked`
> (another layer is soloed), `solo`. **Solo is deliberately blunt: one at a time.** A cumulative
> solo set reads well in a mixer and badly at speed, where the question is always "just this, now".
>
> The paragraph below describes the v1 destructive implementation, which is still what
> `js/pins.js` does (v5a changed WHAT a group is, not how a mute lands). **It should be
> replaced by the derived version above, not preserved** — that rewrite is still open, and
> `js/ui-pins.js` says so in its header rather than drawing a muted/ducked distinction it
> cannot yet compute.

**The restore rule is the part to preserve.** Muting a layer records which of its holds were
*already* silent (`_preLayerOn`) and unmuting brings back only the ones that were sounding.
Without it, unmuting a layer resurrects holds the player deliberately silenced one at a time,
which defeats the point of having two levels at all. It is the one behaviour here worth a test.

**DOM work never happens in the gate** — that runs on the 20 ms scheduler tick. It sets
`S._layersDirty` and the rail repaints at 6 Hz, which reads as live and cannot starve the
scheduler.

**Perform / Arrange is a view switch, not a fifth mode.** The room *is* the tool: selecting
Arrange selects the arrange tool, so the chrome toggle and the dock are two handles on one state.
Making them independent would add exactly the kind of second opinion this redesign removes.

**Persisted 2026-08-25 (#207), `EXPORT_VERSION` 7.** `live.layers` carries the layer set and its
id counter; each commit carries `layerId` and `_preLayerOn`. Session file only — layers are music,
not rig. The one thing to know before touching the import: **the layer set is restored before the
commit slots are, not with the rest of `live`.** `layerOf()`'s lazy assignment — the property that
let layers ship without touching a creation path — means a late restore lets a 6 Hz rail repaint
land mid-import, fail to resolve an imported `layerId` against the previous session's `S.layers`,
and silently flatten the arrangement into two groups. See § E10 of
`docs/EXPORT-IMPORT-AUDIT-2026-08.md`, and `scripts/pins-audit.js` § F, which is that case.

**Still open: hits have no layer.** Composer deliberately excludes triggers because a hit owns
nothing — it is a view onto a stroke — so grouping them needs § 3a's stroke model first.

---

## 4. Real files — NOT BUILT

The concept is finished and correct — two disjoint types, a version gate, a payload normaliser,
`EXPORT_VERSION` 6, and the audit's own sentence: **setup is the rig, session is the music.**
What is missing is smaller than it looks.

**`electron-preload.js` exposes 22 IPC methods and not one of them touches the filesystem.** So
saving does what a web page does: `URL.createObjectURL` into a timestamped download, and an
`<input type="file">` back in. There is no save, no save-as, no open-recent, no autosave, no crash
recovery, and no name for the thing you are playing. Nothing in the architecture prevents files.
Nobody has added the handles.

| Piece | What it is | Size |
|---|---|---|
| **4 IPC handles** | `dialog.showSaveDialog`, `dialog.showOpenDialog`, `fs.readFile`, `fs.writeFile` + preload entries. Browser mode keeps today's download path — it is a demo, and degrading visibly is already the contract | ~80 lines |
| **Document identity** | One object: path, dirty flag, display name. The dirty flag is the only genuinely new state; the payload is `buildSessionPayload()` already | small |
| **⌘S / ⇧⌘S / ⌘O** | Save overwrites the open path with no dialog. The name goes in the chrome | small |
| **`.mubone` as a zip** | The audit's own open item E8. `set.json` + raw `audio/*.wav` instead of base64 inside JSON: −33% size, audio openable in a DAW for debugging, and E7 becomes fixable by reference | half a day |
| **Autosave + recover** | Write the working document to the instance userData directory every N seconds; offer it back on the next launch. This is the one that matters at a show and is impossible today | small |
| **Rename** | *Export* and *Import* stop being top-bar buttons. **Set** → New/Open/Save/Save As/Open Recent; **Rig** → Save/Load, in settings | rename |

**Do this after the material model, not before.** A set today is a snapshot of memory — particles,
buffers, commit slots. A set under this proposal is a **list of strokes**: smaller, diffable, and
the version worth designing the container around. Building files first means writing the format
twice.

One invariant to revisit deliberately rather than by accident: `main.js` and the reset dialog both
depend on *localStorage only, no IndexedDB*. Real files do not break that — a document on disk is
not browser storage — but the autosave slot is exactly where someone will reach for IndexedDB. Put
autosave in userData through the same IPC handles and the invariant survives intact.

---

## 5. What else this fixes

Six more collisions, each of which is two correct ideas that were never told they were the same
idea. § 3 covers the first two; these are the rest, kept short because the evidence is the point.

1. **No `S.tool`.** Nothing owns the question "what is the cursor for", so seven flags arbitrate
   at runtime instead of at design time. `composer.js` saves `_composerPrevScanMuted` on entry and
   restores it on exit, because entering a mode has to mute a mode it does not own. #181 gave the
   hit tool its own panel with the reasoning *"selecting it mutes the granular scan"*. Both are
   mode arbitration; a tool selector deletes both.
2. **Five systems that mean "recall a parameter set".** Patches (20 slots), cloud morph (two
   endpoints, sticky/return), radial morph (N pins, inverse-distance weighted), staging snapshots
   (posture macros → MIDI/OSC out), param-lock (per-parameter bypass). Two of them literally share
   `interp-kernels.js`; `seed-morph.js` carries its own `lerpPresets` 2/3/4/5-point family
   alongside. The storage registry needs its whole `guards` mechanism because
   `mubone_preset_layout_v` gates a migration whose three data keys span **three reset
   categories**. Under brushes there is one library and one verb, **blend**.
3. **Four record verbs on four unrelated keys.** `space`, `⇧space`, `hold D`, `Q`–`P`. One record
   gesture; the brush decides what it becomes.
4. **Panels grouped by implementing module.** search + grain + envelope are three panels answering
   one question. `cursor` holds six unrelated things. The projector layout needs a hand-authored
   `DEFAULT_PROJECTOR_LAYOUT` (#162) precisely because no arrangement follows from what the panels
   *are*.
5. **Controls that exist twice.** `cc-mirror-audit.js` exists solely to catch setters that move a
   modal copy and leave the mirrored panel copy behind. **A harness whose job is finding duplicated
   controls is a measurement of how many there are.** A rail that renders from the selected
   thing's parameter list has one DOM node per parameter, so there is no mirror to desync — and one
   fewer harness to run.
6. **Nothing is a document.** § 4.

---

## 5b. Pre-flight — what is unresolved

Checked against the code 2026-08-25. These are the things that will bite during implementation,
in the order they should be settled.

| # | Finding | Status |
|---|---|---|
| 1 | **Particles are the spatial index.** Every stroke needs them; only spray reads them as onsets | **resolved** — see § 1d |
| 2 | **A hold is the cursor dropped**, not a clone of material | **resolved** — see § 1c-bis |
| 3 | **`1`+`Q` (record-and-loop-as-you-go) has no engine path.** `buildLoopPayload` runs on stroke *release*. Playing a buffer that is still being written needs wrap handling, a moving loop end and a seam declick. **The only genuinely new DSP in the redesign** — prototype it standalone before building any UI around it | **resolved 2026-08-25 (#209)** — prototyped and green: `js/live-loop.js` + `js/worklets/live-loop.worklet.js`, verified by `scripts/live-loop-audit.js`. The loop end advances **at the wrap** (continuous tracking never wraps at 1×); the seam is a live equal-power crossfade. See #209 in `docs/TODO.md` for the full findings |
| 4 | **Layer gain lands in two places.** The worklet has two outputs (monitor / house) and cloud volume is a **per-grain parameter**, so a cloud cannot own a node; loops *do* have `_gainNode` (`grain.js:1287`) plus composer's `mute` gain. Layer fade is therefore a parameter for one and a node for the other — the cloud/loop asymmetry reappearing at the audio graph even after the model unifies them | **open — accept or fix** |
| 5 | **Patches and samples must retire *with* the tiles, not after.** `1`–`0` are factory patches, `Q`–`P` are `paint1`–`paint10`. Both collide head-on with the tile row and the layer keys. There is no order in which tiles ship first | **sequencing** |
| 6 | **Every OSC address changes.** 106 actions; `/commit/*`, `/trace/*`, `/search/radius` all move. Anything on a pedalboard or in a Max patch breaks — batch into one release | **sequencing** |
| 7 | **Three harnesses assert the old model** — `trigger-audit`, `composer-audit`, `cc-mirror-audit` fail by design. Decide rewrite-or-retire up front so a red suite does not become normal | **decide** |
| 8 | `EXPORT_VERSION` bump: strokes need `brush`, holds need `layer`, layers need persisting | **known** |

Still undesigned, and not blocking: what undo means for a held stroke; how many layers beyond
`Q W E`; the tile design sheet; whether erase touches holds or only scratch; how any of this
behaves with two cursors (#123).

## 6. Build sequence

Six moves. Every one leaves the instrument playable at the end of the day, because that is the
standing constraint — `main` is what the jams and shows run on.

1. **Add `S.tool` and the tool rail. Change nothing else.** Four values. The tool *derives* the
   existing flags rather than replacing them: selecting the hit brush sets `trigMuted = false` and
   mutes the scan exactly as #181 already does; Erase holds the erase brush; Arrange enters
   composer mode. Every current keybinding keeps working underneath.
   *Gain: the answer to "what does the cursor do" is one word, and there is somewhere to add the
   next feature that is not an eleventh panel.*
2. **Collapse the panel column into the rail; move rig-shaped controls to a settings surface.**
   Pure UI, no engine risk. *Gain: 11 panels → 1. The meter early-out starts firing.*
   ✅ **Done 2026-08-29 (#291).** The panel column is `display: none` and there is no way back to
   it — one screen, no `rig` pill. The eleven devices survive as the **rig cabinet**: hidden
   markup holding the 44 elements the engine pages drive by id, the settings openers, and four
   nodes borrowed out and hosted elsewhere. Moving a control family out of the cabinet is the
   remaining work, and `scripts/engine-audit.js` § C is what makes it a safe one-at-a-time job.
3. **Stamp `brush` and `material` on every stroke at record time.** Initially it only records what
   the code already decides, so nothing changes behaviourally. *Cost: an `EXPORT_VERSION` bump and
   one payload normaliser next to `splitLegacyAudioBlob`. Gain: the cursor can start reading
   material instead of reading modes.*
4. **Merge the two proximity gates.** One pass, one hysteresis constant, one rearm window.
   `trigger-audit.js` and `composer-audit.js` § gate merge into one suite testing one algorithm.
   *Do this before the constants are ever tuned on hardware — see § 3b.*
5. **Retire `commitMode`. Hold becomes a stroke field.** The hardest step and the biggest payoff:
   cloud, loop and hit stop being three object types with three ownership stories. *Touches
   `grain.js`, `ui-presets.js`, `trigger.js`, `composer.js`, the export format.*
6. **Give the set a filename.** Four IPC handles, ⌘S, a dirty flag, autosave, and the zip layout
   designed around strokes. Last, deliberately.

Steps 1–2 are worth doing even if the rest is never built: they are cheap, they are reversible,
and they stop the bleeding — nothing new gets added as a twelfth mode once there is a tool rail to
add to instead.

---

## 7. What this must not break

- **The visualisation's performance contracts.** The zero-alloc `projectInto()` /
  `updateProjectionCache()` contract, the batched trail fills and `_TRAIL_BUDGET` all stay
  exactly as they are. (§ 3c's per-material rendering pass changed what marks look like, not
  how the hot path is allowed to behave.)
- **Live acoustic input first.** Nothing here adds a generator or moves the instrument away from
  processing mic signal.
- **`main` stays playable.** Each step above is a day's work with a working instrument at the end.
- **The sphere as a spatial score.** Material deposited by playing, at a bearing, read by a
  physical gesture. Every one of those survives — the proposal only removes the layer between the
  player and them.

## 8. Open questions

Six things the code cannot settle.

1. **Is Arrange a tool or a room?** The tool reading is cheaper and keeps everything on one
   surface. The room reading is truer to what composing is and unlocks the camera split that
   the retired MAIN-PAGE-REDESIGN proposal wanted (deleted 2026-08-30; its token values were stale and its
   type recommendation — Urbanist display / Inter body — is not what shipped). Lean tool-first, room-later — but the real answer comes from
   whether you ever want to compose while still holding the sensor in playing position.
2. **Does staging belong in mubone?** The posture-macro engine reads sensor identity and emits
   MIDI/OSC to *other* instruments. It shares `interp-kernels.js` with radial morph and nothing
   else. Lifting it into its own small app would delete a modal, a 951-line UI, a 615-line engine
   and a whole persistence category without losing the capability.
3. **Per-brush banks or one flat bank?** Conceptually the brush library is right, but it means the
   digit keys change meaning with the selected material. That may be worse in performance than one
   flat bank. Playing question.
4. **Should reach really be global?** — **ANSWERED 2026-08-25 (#212): yes, fully global.** The
   per-brush-scale middle path this section proposed was offered and declined. A brush owns the
   sound; the cursor owns where it points. `searchRadiusDeg`, `nearestMode`, `recencyN` and the
   radius-fade pair are out of the patch entirely — before that, glitch yanked the reach to 80° and
   stutter to 6°, and picking a brush could flip your scope mid-set. The counter-argument this
   section raised is real and stands: the ten factory brushes spanned 6°–85°, so some of their felt
   character *was* their reach, and re-dialling by hand is now the cost. **`k` went the other way**
   — it is sonic, so it is frozen per brush and capped per voicing.
5. **What happens to `dwell: 'grain'`?** It is the one place hit and grain material meet. Under
   typed material it could become something better — a stroke carrying two readings, with movement
   vs rest choosing between them. More elegant than a dropdown, but a new idea; do not build it in
   the same pass as the migration.
6. **Does the sphere want a second representation?** There is no way to see *what is sounding* as
   a list, or to silence one thing without pointing at it. A list view changes what the stroke
   model must expose — a stable id, a display name, a bearing — none of which a commit slot has
   today. Decide before building, not after.

## 9. Reverting

Nothing to revert yet. When steps land, each is independently revertable in the order given, and
step 1 is the only one that must be reverted last: every later step assumes `S.tool` exists.

The one irreversible-feeling move is deleting the `state.js` alias family in step 5. It is not
actually irreversible — `git log --diff-filter=D` finds it forever — but it is the point after
which the old model cannot be half-used, which is the intent.
