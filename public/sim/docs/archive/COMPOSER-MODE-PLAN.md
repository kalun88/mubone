# Composer mode — design + build notes

> **Status: ARCHIVED 2026-09-05** — shipped. Loop-is-muted / cloud-is-stopped and the `_composerHold` rule are one paragraph in `docs/RULINGS.md`; the checks are in `scripts/pins-audit.js`. Record only.

> **Status: HISTORICAL** — the feature described here was **sunset on 2026-08-29** (Ek:
> "remove the arrange lens — we are sunsetting this idea"). The proximity gate, the
> `arrange` lens, its scope flips and its start/release/hysteresis/rearm params are gone.
> What survived is the pin/group MUTE engine the gate drove — `setLoopMuted`,
> `toggleCommit`, `syncParticleMarks` in js/composer.js — because the pinned rail and the
> two pin groups (js/pins.js) are built on it. The distance-weighted crossfade this plan
> compares itself to (TODO #228) now lives on Settings → Pins, gated by Blend: focus.
> Kept for the reasoning.
>
> Originally: **built 2026-08-24**, the same day as the plan, in the order below.
> Decisions marked **[Ek]** were confirmed in the design conversation. Verified headless by
> `scripts/composer-audit.js (sunset; now in scripts/pins-audit.js)` (sunset 2026-08; its checks live in `scripts/pins-audit.js`) (67 checks, in `rig-audit`), but **not yet played on a real rig**:
> `hysteresis` and `rearmMs` are still the trigger tool's unsettled guesses, and a latch is
> where they bite. See § To verify on the rig.
>
> Reverting: `js/composer.js` + `js/ui-composer.js`, the `playing` gate and release fork in
> `grain.js`, the mute node in the seq graph, the panel markup, and the `composer` action.
> Nothing in the trace, scan or commit paths changed.

---

## The problem

Once material is on the sphere and commits exist — clouds and loops, dropped and drawn — the
performer has no way to **play the commits as a set**. A commit starts sounding when it is
made and stops when it is released, and release destroys it. There is no arrangement layer:
no muting a loop for eight bars and bringing it back, no thinning to one voice and building
up again.

Looping stations solve this with a grid of buttons. mubone's version has to be spatial and
gestural, because the commits are already *somewhere* — the sphere is the grid.

## The finding that shapes everything

**Most of the machinery exists, in two places.**

The trigger tool (`js/trigger.js`, `docs/archive/TRIGGER-TOOL-PLAN.md`) is a proximity gate with
hysteresis, a rearm window and edge tracking, running inside the 20 ms scheduler. It already
solves "the cursor is near this thing, act on it" including the bounding-cap early-out.

And the loop commit already has the on/off gate and the stop semantics:

| Need | Existing mechanism | Where |
|---|---|---|
| On/off for a loop | `seq.playing` — scheduler skips the slot | `grain.js:987` |
| Loop-boundary timing maths | inside `_stopSeqAudio` — `elapsed` / `loopLen` / `posInLoop` / `remaining`. **Lift the maths, not the function**: it stops the source, which is what loses the place (§0) | `ui-presets.js:1425` |
| Slot volume + stop fades | `seq._gainNode` — already owned by volume and by `_stopSeqAudio`, so composer needs its own node | `grain.js:1168` |
| Cloud fade in / out | `S.commitAttack` / `S.commitRelease` (0–10 s, 0 = instant), cubed ramps | `grain.js:746–773` |
| Proximity + hysteresis + rearm | `triggerParams.hysteresis`, `.rearmMs`, `trigger._inside` | `js/trigger.js` |
| Per-commit colour + bank chips | `COMMIT_COLORS`, `updateCommitBanksUI()` | `state.js:97`, `ui-presets.js` |

## What is genuinely new

### 0. A loop is MUTED, not stopped — it never loses its place **[Ek]**

The decision that shapes the loop half: toggling a loop off is **DJ muting**. The loop keeps
running silently, in time, and toggling back on drops you in **where it would have been** —
not at the top. It does not miss a beat.

That rules out `_stopSeqAudio()` for composer mode entirely. That function *stops the source*
(`src.loop = false`, let it end, clean up on `ended`), which is exactly what destroys the
position. Composer mode needs a mute, and a mute is simpler than a stop:

- **A dedicated mute gain node, in series after the existing `gain`.** The current graph is
  `src → gain → VBAP fan-out`; composer inserts `src → gain → mute → VBAP fan-out`. It has to
  be its own node: `gain.gain.value` already carries `grainParams.volume` **and** is the node
  `_stopSeqAudio` ramps for fades, so riding it would fight both. With a separate node,
  `_stopSeqAudio` keeps owning `gain`, volume keeps owning `gain.gain.value`, and composer
  owns `mute.gain` alone.
- **`seq.playing` stays `true` the whole time.** The source keeps looping and the scheduler
  keeps updating the VBAP playhead pan, so the moment you unmute, the position *and* the
  spatial position are already correct. Nothing to resynchronise.
- **A new flag carries the mute**: `seq.composerMuted`. `playing` keeps its existing meaning
  and the existing gate at `grain.js:987` is untouched.

`release` then means *when* the mute lands, not whether the source stops:

| `release` | toggle off does |
|---|---|
| `play-to-end` (default **[Ek]**) | ramp `mute.gain` → 0 **at the next loop boundary**. The remaining-time maths already exists inside `_stopSeqAudio` (`elapsed`, `loopLen`, `posInLoop`, `remaining`) and can be lifted out — but ramp the mute node instead of stopping the source. |
| `cut` | ramp `mute.gain` → 0 now, over ~20 ms so it does not click |

Toggle **on** is instant in both cases: ~20 ms ramp back to 1. It does not need quantising —
the loop never left the groove, so waiting for a boundary would only add latency to a gesture
that should feel immediate. Coming back in mid-phrase is the point.

**The cost, stated plainly:** a muted loop is still a running `AudioBufferSourceNode` with a
live VBAP fan-out, and the scheduler still updates its pan every tick. Sixteen muted commits
cost roughly what sixteen sounding ones do. That is the price of never losing the place, and
it is the right trade for this feature — but it means composer mode does not reduce CPU, and
"mute everything to lighten the load" is not a thing a performer can do.

**None of this applies to clouds** **[Ek]**. A cloud is granular — there is no continuous
source, no playhead, and no place to lose. It uses the fade in/out envelope, below.

### 1. The gate latches instead of following

The trigger gate is **momentary**: `playing` tracks presence, so leaving the zone stops the
sound. Composer mode is **latching**: crossing into a commit flips `playing` and it *stays*
flipped after the cursor leaves.

That is a small change to the edge handling and a large change to the risk. With a momentary
gate, chatter at the boundary is a glitch you hear and forget. With a latch, chatter
**toggles twice** and the error persists — you walk away with a loop running you meant to
kill, in the middle of a piece. So `hysteresis` and `rearmMs` stop being polish and become
correctness. The trigger tool's current values (1.15×, 120 ms) are explicitly flagged in its
own plan as guesses that "only a turntable can settle", and they have still never been played.
**Composer mode should not ship on unverified values** — see § To verify on the rig.

### 2. Clouds have no on/off, and their "stop" is a destroy

This is the asymmetry that makes the feature more than plumbing, and it is invisible from
outside: to a performer, clouds and loops are both "commits".

| | Loop | Cloud |
|---|---|---|
| on/off gate | `seq.playing`, honoured by the scheduler | **does not exist** |
| what "stop" does today | silences; the slot survives | **destroys** — the release ramp ends with `S.commitSlots[i] = null` (`grain.js:765`) |
| play-to-end | real, and already built | meaningless — granular, no buffer end |

Composer mode needs a state clouds do not have: **silenced but alive.** The envelope
machinery is all there (`_envAttack`, `_envRelease`, `_envGainCurrent`, `_releasingAt`); the
only thing missing is a release that ramps to zero and **holds** rather than deleting.

**Recommendation: give clouds a `playing` flag too**, so `playing` becomes the single commit
gate for both types. That is also the direction `docs/INTERACTION-MODEL.md` already asks for
("merging two parallel systems into one"). The release branch then forks on intent:

- **uproot** (⌘D, unchanged) — ramp, then `commitSlots[i] = null`
- **composer toggle off** — ramp, then `playing = false`, slot kept, `_releasingAt` cleared

Toggling back on re-runs the attack ramp from `_plantedAt`.

## Decisions **[Ek]**

1. **Composer mode is only for commits** — clouds and loops, dropped and drawn. **Not
   triggers.** Triggers are a view onto a stroke and own nothing (see the trigger plan);
   making them latch-toggleable would fight that model.
2. **Touch toggles. No qualifier.** If the cursor reaches a commit, it flips: playing → stopped,
   stopped → playing. No jab, no dwell, no gesture-quality gate.
3. **Latched mode, not held.** Composer mode is entered and left like the camera-mode chips,
   not held down for its duration. It is for a whole section, not a moment.
4. **Scan auto-mutes in composer mode.** Otherwise every commit the cursor passes sounds
   twice — once as granulation, once as the commit — and the toggle is inaudible inside its
   own side effect. Recording a loop already mutes scan, so the precedent and the code path
   exist.
5. **Clouds toggle with the existing fade in / out** — `S.commitAttack` / `S.commitRelease`,
   the "fade in" / "fade out" sliders in the cloud section (`#seedAttackSlider`,
   `#seedReleaseSlider`, 0–10 s). **0 for both = instant**, which is already the default. No
   composer-owned envelope.
5b. **A loop is muted, never stopped** — it keeps running in time and returns where it would
   have been, like a DJ mute. `play-to-end` is the default and defers the mute to the loop
   boundary. See § 0, which is where the loop half of this feature actually lives.
6. **Deferred: everything from the BNO085.** Its free on-chip detectors (tap, shake, stability
   classifier, circle — `docs/BNO085-CONTROL.md` §4.5) are the obvious way to make composer
   mode non-modal later, and the stability classifier in particular is a calibrated dwell
   detector for free. But they are blocked on an int path through OSC (§5.1 of that doc:
   `_encodeOSC` sends every number as `,f` and sygaldry drops the mismatch **silently**), they
   are firmware work in another repo, and the x-imu3 is the sensor in use. Separate track.
7. **Deferred: `js/gesture.js`.** Not calibrated well enough to gate anything on.

## Design

### The mode

```js
// state.js
composerMode: false,     // latched; scan auto-mutes while true
composerParams: {
  release:    'play-to-end',  // 'play-to-end' | 'cut'  — LOOPS ONLY. When the mute lands.
  hysteresis: 1.15,           // exit radius = search radius × this
  rearmMs:    120,            // minimum time before the same commit can re-toggle
},

// per loop slot
composerMuted: false,         // DJ mute — source keeps running, see §0
_muteGain: null,              // dedicated gain node, series after seq._gainNode
_muteAtTime: 0,               // audio-clock time a play-to-end mute is scheduled for
```

`release` is loop-only and the panel must say so — it controls *when the mute lands*, not
whether anything stops. A cloud's equivalent is the fade in/out pair it already has, per
decision 5.

**Entering mutes scan and stores the previous value; leaving restores it.** Do not assume
scan was on.

### Reach

The same rule the trigger tool settled on (#185): **the reach is the cursor's search radius.**
No composer-owned radius. One physical gesture must not have two sizes depending on what it
happens to touch.

A commit is touched when the cursor is within that radius of:

- **dropped cloud / dropped loop** — its anchor `lon` / `lat`
- **drawn cloud / drawn loop** — *any particle in its stroke*, matching the trigger tool's
  hit test, with the same cached-cartesian bounding cap as an early-out

### The toggle edge

Per commit, mirroring `trigger._inside`:

```js
_composerInside: bool,     // was the cursor inside on the previous tick
_composerToggledAt: ms,    // rearm clock
```

Toggle on the **enter edge only**: `!inside && nowInside && (now - toggledAt > rearmMs)`.
Exit uses the hysteresis radius, so the zone you must leave is larger than the one you
entered.

**Pre-seed `_composerInside = true` for every commit already under the cursor at the moment
the mode is entered.** Without this, entering composer mode toggles whatever you happen to be
hovering — a random kill at the worst possible moment. This is the same class of bug as the
enter edge and is easy to miss, because it only shows up when you enter the mode while
standing on something.

### Per-type stop, one entry point

```
toggle(commit):
  loop:                                    # never stops — see §0
    muting   → composerMuted = true
                 play-to-end: ramp _muteGain → 0 at the next loop boundary
                 cut:         ramp _muteGain → 0 now, ~20 ms
    unmuting → composerMuted = false, ramp _muteGain → 1 now, ~20 ms
               (no quantising — the loop never left the groove)

  cloud:                                   # no place to lose
    stopping  → release ramp over S.commitRelease, then HOLD at 0
                  playing = false, slot kept, do NOT null it
    starting  → playing = true, attack ramp over S.commitAttack
```

The two branches share only the gate. They are different verbs on different machinery, and
the panel should not pretend otherwise: a loop is *muted*, a cloud is *stopped*.

### The panel

A new `composer` device tile. Minimum useful contents:

- **mode chip** — in / out, matching `.grain-seg` styling like the camera chips
- **commit list** — one row per occupied slot: colour swatch, type (cloud/loop),
  drop/draw, and **playing state**. This is the readout that makes the mode usable.
- **`release`** — play-to-end / cut, labelled loop-only
- **hysteresis / rearm** — because they are unverified and will need tuning on the rig

The existing bank chips (`updateCommitBanksUI`) are the other half of the readout and should
show stopped-vs-playing rather than occupied-vs-empty. On the sphere, a stopped commit should
draw its ring dimmed or dashed — a commit that is silent must not look identical to one that
is sounding.

**Pending state must be visible.** With `release: 'play-to-end'` there is a gap between the
gesture and the silence. A loop that is stopping-at-end needs a visible countdown — the
depleting-ring treatment — or the performer cannot tell whether the toggle registered and
will toggle again.

## Risks

1. **Latch chatter** — the whole feature's correctness rests on hysteresis and rearm values
   nobody has played. Highest risk item.
2. **Scheduler drift** — the gate runs per tick inside the 20 ms scheduler, like the trigger
   gate. At 16 commits the cost should be well under the trigger tool's measured 0.003 ms at
   32 triggers, but it must be measured, not assumed.
3. **Cloud release fork** — the change at `grain.js:765` sits in the path that today deletes
   the slot. Get it wrong and ⌘D stops uprooting, or a composer-stopped cloud silently
   vanishes.
4. **Scan restore** — leaving composer mode must restore the *previous* scan state, not force
   it on.
5. **CPU does not fall when you mute.** Muted loops keep their source and VBAP fan-out
   running (§0). A performer who mutes everything expecting headroom will not get it, and a
   rig sized on "how many can sound at once" is sized wrong — the number that matters is how
   many exist.
6. **The two gain nodes.** `seq._gainNode` (volume + `_stopSeqAudio` fades) and the new
   `_muteGain` must have disjoint owners. If composer ever ramps `_gainNode`, a stop fade and
   a mute will fight mid-ramp, which is the class of bug that only shows up when two things
   happen within the same 50 ms.

## To verify on the rig

`scripts/composer-audit.js (sunset; now in scripts/pins-audit.js)` (sunset 2026-08; its checks live in `scripts/pins-audit.js`) covers the mechanical half of this list headlessly (67 checks),
including § G, which makes commits through the real `dropSeqFromCursor()` / `plantSeed()`
paths and sweeps them with nothing but the cursor while the live gate does the work.
What remains is what only a body and a room can settle — marked **[rig]**.

- [ ] Toggle a loop off and on; both `release` modes.
- [ ] **A muted loop keeps its place.** Mute a loop, wait several passes, unmute — it comes
      back mid-phrase, in time, not at the top. This is the decision the feature rests on and
      the easiest to regress: any change that routes composer through `_stopSeqAudio` breaks
      it, and it will look fine on a short loop.
- [ ] **Two loops stay in phase with each other** across a mute/unmute of one of them.
- [ ] `play-to-end` mutes at the boundary, not immediately — audible on a long loop.
- [ ] Muting does not disturb slot volume, and a volume change while muted takes effect on
      unmute (the two gain nodes must not fight).
- [ ] Toggle a cloud off and on with fade 0 s (instant) and with a long fade.
- [ ] A composer-stopped cloud **survives** — it is still in its slot, still on the bank, and
      toggles back on.
- [ ] ⌘D still uproots and destroys, from both playing and stopped states.
- [ ] Enter composer mode while standing on a commit — nothing toggles.
- [ ] Sweep slowly across a commit boundary; confirm no double-toggle. **Tune hysteresis and
      rearm here** — this is the test the trigger tool never got.
- [ ] Session export/import round-trips `playing` for both commit types.
- [ ] Gate cost at 16 commits, measured against the 20 ms tick.

## What actually got built

Everything in the plan, plus three things it did not anticipate.

**The mute node lives in the seq graph**, not in `composer.js`: `src → gain → mute → VBAP`,
created alongside the source in `grain.js` and torn down in `releaseSeqNodes`. It reads
`seq.composerMuted` when built, so a rebuilt slot comes back in the state it was left in.

**Three surprises, all in the plan's blind spots:**

1. **Uproot on a stopped cloud did nothing at all.** The scheduler skipped
   `playing === false` slots outright, so `releaseCommit()` stamped `_releasingAt` and the
   branch that deletes the slot was never reached — the commit was **unkillable while
   stopped**. Fixed in two places: the scheduler now lets a release in flight through
   (`playing === false && !(_releasingAt > 0)`), and all three destroy paths
   (`releaseCommit`, `uprootNearestSeed`, `clearAllSeeds`) clear `_composerHold` first,
   because uproot means destroy from either state. This is section D of the audit.
2. **The bounding cap was not optional.** Without it the drawn-stroke hit test is linear in
   stroke length: 0.075 ms/tick for 16 strokes of 200 particles. With it, 0.016 ms — a 4.7×
   win, and it bounds the worst case instead of letting a long drawn cloud scale it.
3. **Both new surfaces needed the same isolation lesson.** The gate runs in the live 20 ms
   scheduler off the real cursor, which sits at canvas centre — inside any commit placed
   there. A harness that sleeps while composer mode is on has its commits toggled underneath
   it, and the failure reads as a broken rearm window. `composer-audit.js` calls
   `rig.quiesce()` before the gate section for exactly this reason.

**Cost, measured** (budget is the 20 ms tick): 0.0011 ms at 16 dropped commits, 0.0017 ms at
16 drawn strokes of 40, 0.016 ms at 16 × 200. Under 0.1% of the tick in the worst case.

### Added after the first play (2026-08-24)

Two things Ek asked for once it was in front of him, both of which the plan had
not thought about.

**Mute is visible on the sphere, not just in the panel.** A muted loop's painted
stroke renders **grey** — desaturated rather than merely dimmed, because dimming
already means "far away" or "quiet" in this render and grey is the only thing
left that reads as *not sounding*. Applied in both `drawParticles` and
`drawParticlesMinimal` (perfMode gets its own bucket, `_PB_MUTED`, so the
batching that path exists for survives).

The marks are keyed on **`strokeId`, not on the particle objects the loop
holds** — and that is the whole subtlety. `buildLoopPayload()` spreads each
particle into a NEW object to rebase `grainStart` against the extracted,
crossfaded loop buffer, so a loop owns a rebased *snapshot*. Marking those marks
nothing you can see. The first cut did exactly that and reported "60 particles
muted" while colouring none of them. `strokeId` is the link back to the material
actually on screen, and § H of the audit asserts the copy-ness directly so the
reason cannot be lost.

A stroke greys only when **every** loop reading it is muted — `dropSeqFromCursor()`
deliberately allows a second playhead on the same buffer, and one muted playhead
does not make the material silent.

**Both commit types take part, claiming material differently.** A loop claims
its stroke; a cloud claims whatever is inside its radius, at its current
position — which is exact even for a *moving* cloud, because a stopped cloud's
playhead does not advance, so a silent one is frozen exactly where it stopped
and that IS the material it was playing.

**A particle greys only when EVERY commit claiming it is silent.** That rule is
the whole reason this is counted rather than flagged: a stopped cloud parked
over a playing loop's stroke must not grey material you can still hear, and one
muted playhead must not grey a stroke a second playhead is still reading. § H of
the audit tests exactly that overlap.

### Leaving the mode does NOT restore the commits

Ek asked whether it should. It should not, and the reason is what composer mode
is for: **the arrangement is the product.** You compose a state, leave the mode,
and play over what you left running. Restoring on exit would mean the mode could
only ever be used from inside it, and every arrangement would be destroyed by
the act of going back to playing.

The two problems that would have justified auto-restore are solved without it:

- **You can see what is silent** — the greying above, plus the bank and the
  panel list.
- **You can undo it in one gesture** — `all on`, which appears in the panel only
  while something is actually silent (a button that shows up exactly when it
  answers the question you are having is a hint as well as a control), and is
  bindable as `composer_all_on` / `/composer/allon` so it can be a pad or a
  pedal.

The panel's commit rows are clickable in **either** mode, for the same reason:
if the arrangement survives leaving the mode, it has to be editable from outside
it too.

*(If this turns out to be wrong on the rig, auto-restore is one call to
`allCommitsOn()` in the `else` branch of `setComposerMode`.)*

**`composerParams.start` — where a loop resumes.** Loops only:

| | |
|---|---|
| `continue` (default) | DJ mute. The source never stopped, so it returns exactly where it would have been, in phase with everything else. |
| `touch` | Drop the playhead at the point of the stroke the cursor reached — touch mid-phrase, start mid-phrase. Reads the particle's `grainStart` for the same reason the trigger tool's `start: touch` does. |
| `top` | Restart from the beginning of the loop region. |

`touch` and `top` **restart the source**, which is the one place composer mode
stops audio on purpose — they trade away the phase that `continue` keeps, and
that trade is the whole choice. Implemented with parts that already existed:
set `seq.startOffset`, call `releaseSeqNodes()`, and the scheduler rebuilds at
the new offset on its next tick — the same mechanism the pause/resume path uses.

**Also shipped:** `Shift+K` and `/app/composer` through the shared ACTIONS table, both new
modules in `sw.js` APP_SHELL, and composer state in the session export (a muted loop and a
held cloud both round-trip, and `playing === undefined` still means playing so every commit
made before this existed is unaffected).

## Build order

1. **Loop mute** — the `_muteGain` node, `composerMuted`, both `release` timings. No UI;
   drive it from the console. This is the half with a decision in it, and the "keeps its
   place" check can be made before any gate exists.
2. **Cloud stop** — `playing` on clouds + the release fork that holds instead of deleting.
   Also console-verifiable.
3. The gate in `js/composer.js`, driven from the scheduler; mode flag; scan mute.
4. The panel and the bank/sphere readout.
5. Pending-state visuals for play-to-end.

Steps 1–3 are the feature. 4 and 5 are what make it playable. Steps 1 and 2 are independent
of each other and of the gate, so either can be built and verified first.

**All five shipped 2026-08-24.**
