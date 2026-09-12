# Trigger tool — design + build notes

> **Status: ARCHIVED 2026-09-05** — this plan shipped. The rulings it left are one paragraph in `docs/RULINGS.md` (§ Plans that shipped); `scripts/trigger-audit.js` guards the behaviour. Record only; do not learn current behaviour from it.

> **Status: CURRENT** — built 2026-08-10, same day as the plan, then reworked twice as the
> model got simpler (#182, #183, #184, #185). Verified headless
> (`scripts/trigger-audit.js`) but **not yet played on the rig**: hysteresis and rearm are
> starting guesses that only a turntable can settle.
> Written after the percussion-ensemble workshop. Decisions marked **[Ek]** were confirmed
> before building; everything else was a recommendation.
>
> Reverting: the feature is `js/trigger.js` plus a gate call and two lines in the seq block
> of `grain.js`. Deleting the module and those three edits removes it; nothing in the loop
> or cloud paths depends on it.

---

## The problem

Granulation cannot play a recording verbatim. For the turntable piece — x-imu3 on a
turntable, azimuth painting positions around the horizon — Ek wants discrete percussion
gestures parked at fixed bearings (triangle at 12 o'clock, woodblock at 3) that **fire as
samples** the moment the cursor's direction vector reaches them. Tweaking grain params
doesn't get there; grains are the wrong primitive.

So: a second tool. Not a second kind of granulation.

## The finding that shapes everything

**The playback engine already exists.** The `loop` commit type (`type: 'loop'` slots) is
not granular at all — it is one `AudioBufferSourceNode` reading a buffer straight through,
with VBAP panning that follows the playhead along the painted particles. Ek built a looper
and it has been sitting inside the commit system the whole time.

Concretely, already working and directly reusable:

| Need | Existing mechanism | Where |
|---|---|---|
| Verbatim playback, no grains | single `AudioBufferSourceNode` | `grain.js` seq block, ~896–1140 |
| Stroke → audio buffer | `createSeqFromStroke()` — collects stroke particles, extracts the buffer region, bakes a 30 ms crossfade | `ui-presets.js` ~982–1130 |
| Spatial position | per-speaker VBAP fan-out, updated per tick from the playhead particle's lon/lat | `grain.js` ~1085–1135 |
| On/off gate | `seq.playing` — scheduler skips the slot when false | `grain.js` 903 |
| Start anywhere in the buffer | `seq.startOffset` → `src.start(startAt, loopStart + offset)` | `grain.js` 1041–1048 |
| Reverse | `seq.direction = -1` + cached `_revBuffer` | `grain.js` 932–950 |
| Stop with fade or play-to-end | `_stopSeqAudio(seq, playToEnd)`, `S.loopFadeTimeMs` | `ui-presets.js` 1402 |
| Click-free start | 35 ms fade-in ramp on the gain node | `grain.js` 1044–1046 |
| Proximity maths | `angleBetweenSphere()`, cached-cartesian `_angleFromCached()` + `stampCartesian()` | `grain.js` |

**What is genuinely new is one thing: a gate.** Instead of `playing` being pinned true at
creation, it becomes a function of cursor proximity. Everything else is plumbing around
that.

This is why the estimate is small. It is also why the risk is concentrated in two places —
the per-tick hit test (scheduler drift) and the retrigger edge logic (musical feel) —
rather than spread across the audio path.

---

## Decisions **[Ek]**

1. **Hit test = any particle in the stroke.** Not an anchor hotspot. A paint stroke from
   12 to 4 o'clock singing *do re mi fa so* is live along its whole arc.
2. **The type is chosen before recording and belongs to the buffer** (#183). Hold **space**
   for granular material, **⇧space** for a trigger. Whenever the cursor touches a buffer it
   does what that buffer was recorded as — **never both**. There is no global tool mode; the
   first two builds had one, and it was wrong. See § The type is the material.
3. **One-shot by default, with a loop-while-held toggle.** Both ship in v1; the difference
   is `src.loop = true`, and there is no reason to stage a one-line difference. Dwell is a
   **live playback control**, not a property of the recording (#184) — switchable mid-set,
   and it reaches a trigger that is already ringing.
4. **No slot bank.** Triggers do not compete for the 16 commit slots and get no bank chips.
   The painted strokes on the sphere are the readout.
5. **No disarm.** A trigger is a view onto a stroke, so the erase brush already removes one.
   A separate disarm would be a second way to do the same thing with different semantics.
5b. **The reach is the cursor's search radius** (#185, Ek). There is no trigger-owned radius:
   it is the same cursor and the same gesture, and erase already follows `S.searchRadiusDeg`.
   A second radius meant one physical gesture had two different sizes depending on what it
   happened to touch. Consequence worth knowing: riding the radius slider during a granular
   passage widens every trigger zone at the same time.
6. **Recording a trigger does not mute scan.** You may be granulating a section and want to
   drop a trigger point into it; the granulation should carry on through the placement.
   (Recording a *loop* still mutes scan — unchanged.)
7. **Erase is agnostic, and doubles as an editor.** It treats trigger and granular material
   identically, and erasing part of a trigger stroke edits the sample.

### The type is the material (#183)

`S.triggers` is a plain array, cap 32, independent of `S.commitSlots`. Each entry is
**shaped exactly like a `loop` commit slot** plus a `trigger` block, so the existing seq
playback block in `grain.js` runs a trigger without knowing it is one. The block iterates
two arrays instead of one; its only slot-index-dependent line
(`if (si >= S.commitSlotCount) releaseSeqNodes`) is skipped for triggers.

But an entry **owns nothing**. It is a *view* onto a painted stroke:

- **particles** are the live objects in `S.particles`, found by `strokeId`
- **the buffer** is the stroke's source buffer — no extraction, no copy
- **the region** is the first surviving particle's `grainStart` to the last one's, plus one
  median spacing as the tail — **not** `grainStart + grainDuration`, see below

`rebuildTrigger()` re-derives all three, plus the bounding cap, whenever
`S._particleVersion` moves; `refreshTriggers()` runs it from the gate and drops any trigger
whose material is gone. That one property is what makes erase, erase-all, undo, sweep and
session import work on triggers **with no special cases** — they all operate on the
particles, and the trigger follows.

`p.trig` on the particle is what keeps the two apart: both granular candidate-pool builders
skip flagged particles, in the recency pass as well as the collection pass. (Skip only the
collection pass and a trigger stroke can still push a granular buffer out of the recency
top-N — silencing material that *is* granulatable.)

**`dwell: 'grain'` is the one place they meet** (#191). Sweep past a trigger and it fires;
**stop** on it and its material opens up to the granular cursor. It needs no per-particle
bookkeeping: a trigger's zone IS the cursor radius, so any `trig` particle inside the radius
necessarily belongs to a trigger the cursor is currently inside — the mode flag alone is
exact, and stays one hoisted boolean rather than a set lookup in the hot loop. **Nearest mode
is the exception to that shortcut**: it has no radius, so a `trig` particle can be nowhere
near the cursor, and it checks proximity explicitly before letting one through.

No new audio code path. No parallel panner. No second envelope. No second copy of anything.

**`grainDuration` is not a region length** (#187). `buildLoopPayload` ends a loop at
`lastParticle.grainStart + grainDuration`, which is right for a loop. For a trigger it is
wrong twice over: `grainDuration` is the *granular grain length* (seconds, on a wash-type
patch) and a trigger particle marks a **position in the recording**, not a length of one.
Using it overshot the region end by up to the whole buffer. Trigger regions end at the last
particle's position plus one median spacing — the material that particle actually stands
for at the rate the stroke was painted.

---

## Design

### Data

```js
// state.js
_recordingTrigger: false,    // true while ⇧space is recording trigger material
trigMuted: false,            // global triggers on/off — the counterpart of scanMuted
triggers: [],                // trigger entries, cap MAX_TRIGGERS = 32
triggerParams: {             // how triggers PLAY — global, live, read at fire time
  hysteresis:  1.15,         // exit radius = SEARCH radius × this — anti-chatter
  rearmMs:     120,          // minimum silence before the same trigger can refire
  dwell:       'oneshot',    // 'oneshot' | 'loop' | 'grain'
  start:       'top',        // 'top' | 'touch' | 'ends'
  retrig:      'cut',        // 'cut' | 'layer' — refire over a pass still sounding
  chopOn:      false,        // the switch — bindable as `trigger_chop`
  chop:        300,          // ms of silence that counts as a break
  release:     'play-to-end',// on exit: 'play-to-end' | 'fade'
  volume:      1.0,
  speed:       1.0,
},
```

A trigger entry is loop-slot-shaped (particles, buffer, loopStart/End, direction, speed,
grainParams, colour) — but every one of those fields is **derived**, not stored, and
re-derived by `rebuildTrigger()` whenever the particle set moves. Its own state is only:

```js
trigger: { _inside: true, _lastFireAt: now, _capX, _capY, _capZ, _capRad },
playing: false,              // the gate owns this
_builtAt: S._particleVersion,// what the derived fields were built against
_appliedVol, _appliedSpeed,  // what the live source node was last given
```

**Nothing about how a trigger plays is stored on it** (#184). Dwell, start, release, rearm,
hysteresis, speed and volume all live in `S.triggerParams` and are read at fire time,
so moving a slider mid-set changes every trigger at once — including one that is sounding.
The recording supplies material and position; that is all it decides. An entry therefore
carries only runtime state, which is why the session payload for one is a `strokeId` and a
colour.

`_applyLiveParams()` pushes changes into a sounding source: `src.loop` for dwell,
`playbackRate` for speed, the gain node for volume. It compares against `_appliedVol` /
`_appliedSpeed` rather than the node's current values, because the gain is mid-ramp for the
first 35 ms of every fire (the click-free fade-in) and comparing against `gain.value` would
see the ramp in progress and fight it every tick.

`_cap*` is the bounding cap — the centroid of the stroke's particles and the max angular
distance from it. It is the early-out that keeps the hit test cheap.

**`_inside` starts `false` on a fresh recording, `true` on everything else** (#188). A newly
recorded trigger *should* play once the moment you release the record button — the cursor is
still on the stroke it just painted, so the first gate tick is an enter edge and you hear
what you captured. It then behaves like any other and won't refire until you leave and come
back. `restoreTrigger()` (session import) and `_cloneTriggerShell()` (erase-split) both start
primed **inside**, because those are edits rather than placements and neither should make
noise on its own. Muting/unmuting relies on the same priming: the gate keeps tracking while
muted so unmuting can't bang whatever the cursor is resting on.

### The gate

New `js/trigger.js` — imports `state.js` and `sphere.js` only, so no circular-import
gymnastics and no `S._callback` hook needed. `grain.js` imports it directly and calls
`updateTriggerGates(cursorLon, cursorLat, now)` once per scheduler tick, immediately before
the seq playback block.

Per trigger, per tick:

1. **Bounding-cap reject.** `angleBetween(cursor, _cap) > _capRad + exitRadius` → not
   inside, done. One trig call. For a sphere with a dozen triggers and a cursor near one of
   them, this rejects nearly all of them.
2. **Stroke scan** on survivors: min angular distance from cursor to any particle, using the
   `_cx/_cy/_cz` cartesian stamps (the `stampCartesian` + `_angleFromCached` pattern already
   in `grain.js`) so the inner loop is a dot product and one `acos`, not six transcendentals.
   Stamps are written once when the trigger is armed — the particles never move.
3. **Hysteresis.** Enter when `minDist < radiusDeg`; leave only when
   `minDist > radiusDeg × hysteresis`. Without this a jittery sensor sitting on the boundary
   machine-guns the sample. A turntable held near a bearing is exactly that case.
4. **Edges.**
   - **Enter** and `now - _lastFireAt > rearmMs` → set `startOffset` per `start` mode,
     `playing = true`, `_lastFireAt = now`. The existing seq block builds the source node on
     its next pass, including the 35 ms fade-in.
     - `start: 'top'` → `startOffset = 0`.
     - `start: 'touch'` → `startOffset = ` the `grainStart` of the particle that was nearest
       at the entry instant. Both already supported by `src.start(startAt, loopStart + offset)`.
   - **Exit** →
     - `dwell: 'oneshot'` → **do nothing.** The sample finishes; that's the point. A cursor
       sweeping past a triangle at speed should still get the whole triangle.
     - `dwell: 'loop'` → `stopTriggerAudio(t, release)`.
5. **One-shot completion.** `src.loop = false` for `dwell: 'oneshot'`, and the existing
   `'ended'` listener sets `_stopped = true`; the gate additionally sets `playing = false` so
   the seq block's `needsNewSource` check (`!_sourceNode || _sourceNode._stopped`) doesn't
   immediately refire it. **This is the one place a missed line produces a runaway loop** —
   worth a comment at the site.

### Trigger mute — the counterpart of SCAN (#183)

Scan is how you turn granulation off without touching what you recorded; `trigMuted` is the
same switch for triggering. Muting stops what is sounding through each trigger's own release
rule, so a `play-to-end` one-shot finishes rather than being chopped.

**The geometry keeps running while muted**, and only the edge *actions* are suppressed. That
is what stops unmuting from banging every trigger the cursor happens to be resting on:
`_inside` is already accurate, so there is no spurious enter edge. The alternative — skip the
work, prime the state on the transition — is a second code path and a second thing to forget,
and running it costs ~0.003 ms/tick at 32 triggers.

The renderer draws muted triggers at 0.45 alpha and never shows their proximity or firing
states, since the gate is still tracking `_inside` and drawing it would promise a shot that
isn't coming.

### chop — segmenting a traced gesture (#194)

Trace a physical gesture while playing a phrase, and `chop` turns each note into its own
trigger along the path. Retrace the path and they fire in sequence, so the gesture replays
the phrase instead of firing one long buffer.

**The noise gate has already done the analysis.** The paint ticker deposits nothing while the
input sits under `vizNoiseFloor`, so *the gaps in a trigger stroke already are the silences in
the phrase*. Chopping needs no transient detection — just a threshold on gaps that are
sitting in the data. The switch (`chopOn`) is kept separate from the threshold (`chop`, ms) — **[Ek]** wanted a
hard on/off that can go on a pad or pedal, and splitting them means the value you dialled in
survives being toggled and the binding is a plain switch with nothing to remember.

This is deliberately the same gap test #192 removed. As an always-on heuristic guessing at
erasure it was wrong and chopped a 20-second take into eight; as an opt-in chop it is exactly
the tool. The difference is not the code, it is **who decides** — a threshold the performer
sets, rather than a guess the code makes on their behalf. The audit asserts both halves
against identical material: chop off → one trigger, chop 300 ms → four.

Two rules keep it from fighting the other reason a trigger divides:

- **Record time only.** The erase-split (`_clusterByRemoval`) runs on every rebuild; chop runs
  once, when the take is armed. A deliberate act and an edit stay separate.
- **Every run gets its own strokeId**, including one-particle ones that don't become
  triggers. Leaving a stray singleton on the original id would put it back in run 0's
  trigger, and since a trigger collects by strokeId, that region would stretch across the
  whole take again — undoing the chop invisibly.

Why not handsfree, which already segments by noise gate: handsfree is about **recording** —
it stops and starts the capture, and needs latched trace to do it. Trigger recording is
momentary by design. `chop` is about **segmenting a take you already made**, which needs no
mode and no change to the gesture.

### Polyphony — retrig:'layer' (#193)

`cut` fades the pass already sounding and restarts from the top; `layer` leaves it ringing
and stacks a new voice on top, to a hard ceiling of 8.

**Layering needed no voice engine.** A one-shot source already carries its own scheduled end
(the `duration` argument) and its own `'ended'` cleanup, so `_detachVoice()` simply drops the
node references without stopping — the trigger is left sourceless, the seq block builds a
fresh one next tick, and the two sound together. The only bookkeeping is a small `_voices`
array, and that exists solely so the oldest can be stolen at the ceiling and so muting can
reach them.

Two things this makes a trap:

- **A detached voice ending must not clear `playing`.** The seq block's `'ended'` handler now
  passes the source, and `onTriggerSourceEnded` ignores any node that is no longer the
  current one. Without that, an old voice finishing silences the voice that replaced it.
- **Anything that silences a trigger has to reach the stack** — mute, erase-removal,
  clear-all all go through `stopTriggerAudio`, which now stops `_voices` first.

**A stacked voice freezes its spatial position.** The per-tick VBAP update follows
`_sourceNode`, so an older voice holds the bearing it was fired at. On a spatial instrument
that is a feature rather than a limitation: hit the same buffer at different bearings and the
stack spreads across the speakers. Live volume changes still reach every voice, because a
ride that moved only the newest of five would read as broken.

### Stopping without deleting

`_stopSeqAudio()` cannot be reused: both its paths end with `S.commitSlots[idx] = null` on
the `ended` event, and a trigger must survive being stopped. `stopTriggerAudio()` detaches
the node references up front and lets the old subgraph clean itself up on `ended`, so the
trigger stays live while its previous pass fades.

### Recording

A trigger-type recording is the trace gesture with a modifier: **⇧space** sets
`S._recordingTrigger`, which the paint ticker stamps onto every particle it deposits and
`_commitTraceStroke()` reads on release to call `armTrigger(strokeId)`. `trace_trigger` is
the bindable equivalent for pads and pedals.

It follows the main button's mode like every other performance button (2026-09-04; it was
momentary-only until then, on the argument that a latched trigger recording would record until
you noticed — the tile now lights while it records, and the toggle is the default everywhere).
`trace_trigger` sets the flag and presses the same funnel `recpaint` does.

**A line's region is the BUTTON, not the marks (2026-09-04, #332).** A hit take stamps its
press and release on the audio clock, is held open past the release by the input latency
(`stopLiveRecordingHeld` in audio.js), and its `edges = [inS, end]` are the region
`_applyCluster` uses while the stroke is untrimmed — its kept marks still span what was painted
(`take.markSpan`). Erase a mark off either end and the marks rule again, which is what erase
edits. Marks sit on a 50 ms tick and were the region before this; a line was late at the head
and quantised at the tail whatever the hand did. Hit material is never paint-gated, for the same
reason: a gap in the path is a place it cannot be fired from.

**Both ends of a one-shot are ramped (2026-09-04, #331).** The start always was — 3 ms of gain
from zero (`DECLICK_S` in grain.js). The end was a bare `src.start(at, pos, span)` running out,
and a trigger plays the raw take region (no seam crossfade, unlike a loop's buffer), so the cut
clicked whenever the waveform was away from zero — which for a slice was most of the time,
because a slice's region ended at last-mark-plus-median-spacing, on or into the next attack.
Now `ONESHOT_FADE_S` (5 ms, wall time) ramps the gain to zero before the source runs out, and a
slice carries the onset that closed it as `endCap`, which `_applyCluster` clamps the region to,
less `SLICE_END_LEAD_S` (12 ms: the onset detector's hop plus the fade). A trigger dwelling as a
loop gets no end fade; its native wrap over the raw region is the same discontinuity and is
still open.

**It deliberately does not mute scan** (Ek). You may be granulating a section and want to
drop a trigger point into it; the granulation should carry on through the placement. (The
`trace+loop` mode, whose recording did mute scan, was deleted 2026-09-05.)

Removal is the erase brush, not a disarm. Erasing part of a trigger stroke **edits the
sample**: the region is `[earliest, latest]` of one contiguous run of surviving particles,
so erasing the tail shortens it, erasing the head trims it, and **erasing the middle splits
it into two triggers** (#186) — it is two sounds now, and a region spanning the hole would
play back silence the performer deliberately removed.

The split gives the new segment **its own strokeId and its own trigger** rather than teaching
a trigger to hold a list of segments. That preserves the invariant that a trigger is a view
onto exactly one stroke, so the next rebuild, undo, sweep and export keep working unchanged —
and it makes re-splitting impossible, since each half now collects only its own particles.

**A split is detected by removal, not by gap size** (#192). The first version thresholded on
how big a time gap was — and because `armTrigger` runs the same rebuild, it fired on the
FIRST pass, before any erase existed: a 20-second take with ordinary musical phrasing was
chopped into ~8 separate triggers the moment it was recorded. The reason is that a gap in a stroke means two completely different things
and its size cannot tell them apart: *never painted* (a rest, a breath, a decay sitting under
`vizNoiseFloor` — the paint ticker deposits nothing there) versus *erased*. Both look
identical after the fact. So the rebuild compares against the previous particle list instead:
two survivors that were **not adjacent before** have something missing between them. Exact,
threshold-free, and it cannot misfire on phrasing. An empty baseline — a fresh recording or a
session import — never splits, so a take is always one trigger however it was played.

Sweep **keeps** trigger strokes, for the same reason it keeps loop strokes: sweep discards
material nothing is using, and a percussion map is in use.

### What the performer sees

No bank. On the sphere:

- An armed stroke's particles get a distinct tint — armed but idle.
- The active radius drawn as a halo **around the nearest point of the stroke**, not around
  the anchor. A circle at the anchor would be a lie once the hit test is stroke-wide.
- Firing lights the stroke and runs the playhead glow that loops already have
  (`activeGrainMap.set(p, {expiry, glowColor})`).

Panel: **its own `device--trigger` panel** (#181, Ek's call) rather than a section under
commits. It carries the `⇧space` record reminder, the triggers on/off, a hint line with the
count, and the defaults the next recording inherits. Reuses `.grain-row` / `.grain-seg`
vocabulary throughout. No tool picker (there is no mode) and no disarm (erase is the delete).

One trap worth knowing before adding rows: `_dim()` on a row inside an already-dimmed section
multiplies (0.35 × 0.35 = 0.12, which reads as a rendering fault, not an inactive control).
Dim within a live section only.

---

## What shipped

All ten steps below landed. Three things came out different from the plan, each for a
reason worth keeping:

- **The hot path has no transcendentals at all.** The plan said "cheap trig"; the build
  compares **dot products against cosines** instead. `acos` is monotonic on [-1,1], so
  `angle < gate` is exactly `dot > cos(gate)` — the per-particle loop became pure
  multiply-add, and the only `cos` calls are two per trigger per tick on the gate radii.
  Measured: **32 armed triggers × 200 particles = 0.0018 ms/tick** against the 20 ms
  scheduler interval, i.e. under one hundredth of one percent. The bounding cap is visibly
  working — 32 triggers cost 2.8× one trigger, not 32×.
- **`_stopSeqAudio()` could not be reused at all**, as suspected, but for a sharper reason
  than "it deletes the slot": *both* of its paths end by nulling the commit slot on the
  `ended` event. `stopTriggerAudio()` detaches the node references up front and lets the old
  subgraph clean itself up, so the trigger stays armed while its previous pass fades.
- **The export bug was real and got fixed on the way past.** See below.
- **The model was rebuilt twice** — #182 then #183 — and both times the trigger got *less*
  machinery. First a global tool mode (mode decides what a stroke becomes), then the tool
  switch doubling as an on/off, then #183: the type belongs to the buffer, chosen before
  recording, and a trigger is a view onto a stroke that owns nothing. Parking, disarming,
  double-sounding and the "does erase reach it" question were all symptoms of the material
  having been copied out from under the thing that owns it. They stopped needing answers
  rather than getting better ones.

## Where the pieces are

| Concern | Where |
|---|---|
| Gate, rebuild, arm, mute, stop | `js/trigger.js` (registers on `S`, not imported by `grain.js`) |
| Gate call + playback | `grain.js` — `S._updateTriggerGates()` then the seq block, which iterates `S.commitSlots` and `S.triggers` |
| "Never both" | `grain.js` `_buildCandidatePoolRadius` / `_buildCandidatePoolNearest`, both skipping `p.trig` |
| Type stamped on material | `paint-ticker.js` reads `S._recordingTrigger` |
| ⇧space recording | `events.js` space keydown/keyup + `_commitTraceStroke()` |
| Bindable `trace_trigger` / `trig_toggle` | `midi.js` `ACTIONS`; OSC `/trace/trigger`, `/trigger/mute` |
| Erase / erase-all / undo / sweep | fall out of `refreshTriggers()`; only erase-all and undo call in explicitly, for immediacy |
| Drawing | `renderer.js` `drawTriggers()` |
| Panel | `index.html` `.device--trigger` + `js/ui-trigger.js` |
| Session export | `ui-export.js` — `strokeId` + settings only, `EXPORT_VERSION` 6 |

## Verification

- **Scheduler drift is the acceptance test.** Log `perf.schedulerAvg` with 0 / 1 / 8 / 32
  triggers armed at ~200 particles each. The bounding-cap early-out should make 32-armed
  indistinguishable from 0. If it isn't, the cap is wrong before the loop is.
- **Chatter test** — park the cursor exactly on the boundary and jitter it. Zero retriggers
  is the pass condition; this is what hysteresis exists for and it can only be judged live.
- `node scripts/trigger-audit.js` — the dedicated harness. Gate edges, the hysteresis band
  from both directions, the rearm window, the cap early-out, the mute, and the material
  lifecycle (erase trims, erase-all removes, a fresh trigger doesn't fire itself). Also the
  **"never both"** checks, which run the real pool builders through the `__testCandidatePool`
  seam in `grain.js` — `scheduleGrains()` itself returns early without a running
  AudioContext, which headless can't produce.
- `node scripts/verify-action-ranges.js` (no new cc rows expected — the new actions are a
  hold and a trigger — but the harness is what proves it).
- `node scripts/browser-audit.js` — includes the v6 session payload assertions.
- On the rig: triangle at 12, woodblock at 3, spin the turntable at performance speed. Judge
  the rearm window and hysteresis by ear; the numbers above are starting guesses, not results.

## Deliberately out of scope for v1

- **Reverse and ping-pong triggers.** The machinery exists but `startOffset` in reverse is
  measured in original-buffer time while playback reads the reversed copy — a latent bug in
  the loop path today. Forward only until that's fixed on its own terms.
- **Velocity sensitivity** (spin speed → level). Musically interesting, needs the gesture
  feature pipeline, not the gate.
- **Granulating a trigger buffer.** Ek's call in #183: musically unnecessary, and "never
  both" is what makes the two types legible. The type is one flag on the particle, so if it
  ever becomes wanted the change is small — but it should stay off by default.
- **Changing a buffer's type after recording.** There is no convert-to-granular. Deliberate:
  the whole model is that you decide before you press record, and an after-the-fact switch
  would put the decision back in app state where it started.
- **Per-trigger playback settings.** Everything is global **[Ek, #184]** — dwell, radius,
  speed, volume, the lot. So you can't have the triangle at 12 set to `once` while a drone at
  3 loops. If that turns out to matter, the shape of the fix is per-entry overrides on top of
  the globals plus a way to aim at one trigger (the nearest-to-cursor grammar the cloud morph
  already uses), *not* going back to copying settings in at record time.
- **Per-trigger mute.** `trigMuted` is global, like scan. Same reasoning.
- **Trigger-type sample paint (Q–P).** Live mic only for now **[Ek]** — the trigger record
  action records from the mic, as trace does.
- **More retrigger modes.** `cut` and `layer` shipped (#193); **[Ek]** declined `hold`
  (re-entry does nothing while a pass is still playing, so each hit always completes) and
  `toggle` (re-entry stops it, making each pass an on/off — most interesting with
  `dwell: loop`). Both are a couple of lines in `_onEnter` if wanted.
- **Per-hit direction alternation** — forwards, backwards, forwards. Nearly free now that
  `ends` brought the reverse path in. Declined for now.
- **Per-voice speed drift** under `layer`, so a stack thickens into a chorus rather than a
  phase-locked pile. Declined for now.
- **Voice cap as a control.** Hard-coded at 8. Exposing it would give voice-stealing a
  deliberate character at low values; declined as a knob until the fixed one proves wrong.

---

## Debt found while reading

- **Session export of `loop` slots was broken — fixed, `EXPORT_VERSION` 5 → 6.**
  `ui-export.js` serialised `particleIndices: slot.particles.map(p => S.particles.indexOf(p))`,
  but `createSeqFromStroke()` replaces its particles with detached copies
  (`{...p, grainStart: p.grainStart - offsetShift}`), so they are not in `S.particles` and
  every index was −1. On import `particles` filtered to empty, and the scheduler's
  `!seq.particles.length` guard then skipped the slot entirely: **an imported loop came back
  silent and without a playhead**, buffer intact. `addPlayheadFromExisting()` shares the same
  copies, so it was affected too. Now stored as values — `[lon, lat, grainStart,
  grainDuration]` per particle, which is also several times smaller than an object each.
  Pre-v6 files keep the old read path so they still import their buffer, but there is no
  recovering playhead data that was never written.
  **The general lesson, and the reason this survived a two-round export audit:** an index is
  a reference into a specific array, and `buildLoopPayload` deliberately hands back objects
  that are *not* in that array. Identity was never available to lean on here. Anything that
  serialises loop or trigger particles must store values.
- **`slot.searchRadiusDeg` is dead for loops** — still open. `renderer.js` reads it to draw a
  radius circle, but `createSeqFromStroke()` never sets it, so the branch never fires.
  Triggers carry their own `trigger.radiusDeg` and don't need it. Either set it at creation
  for loops or drop the read.
- **`browser-audit.js` asserted 12 modals in three places** — stale since #169 deleted
  `cameraModal`, so **four of its checks had been failing on every run**. Corrected to 11. A
  harness that is always red hides the next real regression, which is most of why it exists.
- **Not fixed, deliberately:** `audioBufferToBase64Wav()` throws out of `buildSessionPayload`
  if any commit or trigger holds a malformed buffer, taking the whole session export down
  rather than losing one slot. Found by handing it a stub buffer in a test fixture, which is
  not a state the app can reach — so it stays noted rather than papered over with a guard
  that would mostly hide real corruption.
