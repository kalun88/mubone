# The overdub brush — a take inside a pinned loop's cycle

> **Status: ARCHIVED 2026-09-05** — shipped 2026-09-04 (#330–#335). The overdub entry in `docs/RULINGS.md` is the ruling; § 5 below is where the build departed from the sketch, kept as record. Do not learn current behaviour from it.

> **Status: CURRENT** — designed and built the same day (Ek, 2026-09-04, #330). §§ 2–4 describe
> what shipped; § 5 lists the four places the build departed from the sketch, and § 7 what is
> still open. Read with `docs/archive/TRIGGER-TOOL-PLAN.md` (the loop playback engine it reuses) and
> `docs/archive/BRUSH-MODEL.md`. The main button's toggle mode (#329) is what made it buildable: a take
> is one press to start and one to stop. Covered by `pins-audit.js` § M.

## 1. The idea, in Ek's words

> "it's gonna be another tile. the overdub loop tile. all overdubs are owned by a main loop …
> main loop means that loop's length is master. not only their length, but kinda their playhead
> position on that track. … i tap to toggle on with the overdub brush on to record a take
> within that 10 second loop, like second 4 to 6 of that loop, on the next cycle of that main
> loop the 4 to 6 second will be overdubbed at that spot. … if i leave the overdub toggled on
> for like 35 seconds, all of that will go in but as 3 and a bit loops. this is normal loop
> overdub behaviour … when i overdub to a main loop, it's still one pinned item … i can mute or
> solo that entire pin which is basically muting a whole synced loop + its overdubs."

A Ditto-style looper, on the sphere. The **main loop** is any pinned loop. An **overdub** is
a take recorded while a main loop plays, anchored to the main loop's timeline at the moment the
take started, and played back as a **layer** of that pin — phase-locked, the length of the
main loop's cycle, every cycle. The overdub's marks land on the sphere wherever the cursor
was, as their own stroke, so the cursor can still read them, erase them, undo them.

## 2. The rulings (Ek, 2026-09-04)

1. **Every loop pin is a main loop.** No segmented gate: "anything i pin loop-wise will be
   something i want to keep, musically i'm not going to pin something that is not loopable" —
   and a loop pinned from the slice brush is exactly the kind of loop you want to overdub onto.
2. **The nearest pinned loop is the master**, chosen at the press that starts the take
   (the finder `uprootNearestSeed` already uses, over loop pins only). The take stays with
   that master for its whole length, however far the cursor moves and however many cycles it
   runs. When the take ends, the selector is nearest again, so the next take can go to
   another loop.
3. **Longer than the cycle: LAYER.** A 35 s take over a 10 s cycle is three and a bit passes,
   all sounding every cycle. **Shorter than the cycle: it lands where it was played** — a hit
   on beat 2 of a 4-bar loop comes back on beat 2. Both are the same rule: the take is folded
   onto the master's timeline from the phase it started at.
4. **No repitching, no respeeding.** The overdub plays at 1×. The master's playhead is the
   master's — a 10 s buffer pinned at half speed has a 20 s cycle, and that 20 s is the
   overdub's canvas. (Speed is baked at pin time, so the cycle length is fixed for the life
   of the master.)
5. **One pin.** Overdubs are not pins of their own. The master's row in the pinned rail wears
   **a dot per overdub**. Mute, solo, unpin act on the family through the calls that already
   exist; a loop's mute keeps its source rolling, so unmuting comes back in time, and unpin
   already has fade / play-to-end (`S.loopReleaseMode`). Nothing overdub-specific there.
6. **Erase and undo are the sphere's, not the pin's.** Erasing a pinned loop's marks, today,
   changes what the cursor reads and leaves the loop playing (erase.js never touches
   `commitSlots`). Overdub marks behave the same. Undo of an overdub stroke removes its layer,
   because the stroke IS the layer's identity.
7. **`passes`** (the loop page's self-deleting loop, N passes then gone): a master that
   deletes itself takes its overdubs with it — paint included. No gate.
9. **Unpin the master and the overdubs become ordinary lines** (Ek, the first play on the
   rig: "all overdubs should become normal loops once unpinned"). The master's own stroke was
   always scratch the cursor can fire; an overdub's marks were a hit stroke never armed, so
   after the unpin the master played and the overdubs did not. Now every road out of the pin
   (`orphanOverdubs`: unpin with fade or play-to-end, undo of the master, a slot replaced) arms
   each overdub's stroke **plain** — one trigger, no audition, no slice or chop from whatever
   tool is in the hand, and the looper hook stays out so nothing re-pins — while the layers
   ride out the master's fade.
11. **The overdub is pulled back by the round trip** (#332). The performer sings against what
    they hear, late by the output path, and the mic hears that late by the input path; the take
    is stamped at capture, so the layer landed late by the whole trip, by a constant. `attachOverdub`
    and `refreshLiveOverdub` subtract `S.latency.roundTripS` (`js/latency.js`: the streams'
    estimate, or the loopback measurement from Settings → Audio) from the take's start before
    reading the master's phase.
10. **A take is heard pass by pass while it records** (Ek, the second play: "each time it
    cycles back to the top that material should play back the next time around"). At every
    wrap of the master the take SO FAR — the recorder's raw pool up to its write head, which
    is exactly what the seal keeps — is folded onto the cycle as a provisional layer and
    swapped in under an 8 ms crossfade (`refreshLiveOverdub`, fired from the seq block in
    grain.js; `swapOverdubLayer`). Everything already played sits behind the playhead, so it
    comes round on the next pass, as on a real looper. The sealed layer lands in the same
    overdub at the stroke's end. A master unpinned mid-take drops the provisional layer and
    the stroke is handed back as a plain line at its seal.
8. **Tap to start, tap to stop** — the main button in toggle mode. In momentary mode the take
   is the hold. Nothing here reads timing.

## 3. What it rides on

| Need | Already there |
|---|---|
| the master's playhead | a loop pin is one looping `AudioBufferSourceNode` started at `seq._startedAt`; phase = `((now − _startedAt) · speed) mod (loopEnd − loopStart)` — one subtraction |
| nearest pin from the cursor | `findNearestSeedSlot` / the unpin path; filter to `type === 'loop'` |
| the first pass (the Ditto's first tap) | pin **while painting a line** is the growing live loop (`_startLiveHold`, `live-loop.js`), closed on release |
| recording a take with a time base | the ordinary paint path: `startLiveRecording` seals a take on the audio clock; the paint ticker deposits its marks |
| the family's gain | `seq._gainNode` / `seq._pinGain` — a second source into the same nodes is muted, soloed and faded with the master |
| mute keeps time | a loop is *muted*, its source keeps running (`docs/archive/COMPOSER-MODE-PLAN.md`) |

## 4. The model in code

**An overdub is `{ strokeId, phase0, buffer, layer, src }` on the master's slot**, in
`seq.overdubs[]`.

- `phase0` — the master's phase, in **wall seconds of its cycle**, at the audio-clock time the
  take started. Captured on the press, from `S.commitSlots[masterIdx]`.
- `buffer` — the sealed take (the same object the stroke's marks point at).
- `layer` — one buffer the length of the master's **wall cycle** (`(loopEnd − loopStart) /
  |speed|` seconds at 1×): the take written in from `phase0`, wrapping, every pass summed.
  A 35 s take on a 10 s cycle is written 0→7 at 3, 7→17 at 0, 17→27 at 0, 27→35 at 0.
  Built once, at `whenSealed`, by `buildOverdubLayer()` in `ui-presets.js` beside
  `buildLoopPayload`.
- `src` — a looping source over `layer` at rate 1, `loop = true`, started at the master's
  `_startedAt` on the same nodes the master feeds. Started in the seq start path in
  `grain.js` (the block that builds `src` for the master), so it exists exactly when the
  master's source does: mute, solo, `_stopSeqAudio` (fade or play-to-end) and the `ended`
  teardown see one family.

**A master's clock.** Because the master's source is `loop = true` and never restarts,
`_startedAt` is a fixed origin and every layer started at that origin stays locked
without bookkeeping. The one thing that moves `_startedAt` is a **restart** — unmute after a
*stop* (a cloud's semantics, not a loop's), or import — and both rebuild every source from
the slot, layers included.

**Selecting the master.** `nearestLoopPin(lon, lat)` in `pins.js`: over `commitSlots`, `type
=== 'loop'`, not `_releasing`, by angular distance to the slot's anchor. No radius: nearest is
nearest. With no loop pinned the overdub tile **ghosts** (the `ghost` flag the *new tool* tile
uses) and a press refuses with the sampler's `_refuse` message, so nothing paints as a stray
line.

**The take.** The overdub tile is a **loop-kind brush** (lives in the loop slot, cycles with
line · slice · looper). It deposits `hit` material through the normal path, tagged
`overdubOf: masterIdx` on the stroke record so its marks can be drawn as the family's: the
master's hue and a ring. It does NOT arm a trigger or make a loop of its own when the stroke
ends; `_commitTraceStroke` reads the tag and calls `attachOverdub(strokeId)` instead.

**Speed.** The layer is in wall time at 1×, so the "normal speed onto a slower track" rule
falls out of §4's definition of `layer`. Nothing resamples.

## 5. Where it lives, and where the build departed from the sketch

- `js/grain.js` — `nearestLoopPin`, `masterPhaseWall`, the layer sources
  (`startOverdubLayer(s)`, `swapOverdubLayer`, `stopOverdubLayers`) in the seq start path and
  `releaseSeqNodes`; the wrap detection that fires the live refresh.
- `js/ui-presets.js` — `beginOverdub` (the press), `buildOverdubLayer`, `refreshLiveOverdub`
  (each wrap while recording), `attachOverdub` (the stroke's end), `removeOverdubByStrokeId`
  (undo, and erase-all), `orphanOverdubs` (the hand-back), the overdub half of
  `onMarksErased` (erase write-through, 2026-09-05);
  `_stopSeqAudio`, `removeSeq` and `selfKillSlot` stop the layers with the master.
- `js/trigger.js` — `armTrigger(id, { plain })`: one trigger, no audition, no hook.
- `js/brush.js` `_toolDown` — the overdub brush picks its master before the hit take starts,
  and a refusal aborts the gesture (`_begin` never goes active).
- `js/events.js` `_commitTraceStroke` — an overdub take attaches instead of arming.
- `js/audio.js` — a take records `startedAt` on the audio clock.
- `js/tiles.js` — the tile, its glyph, its empty sheet, `S._handIsOverdub`, the refusal flash.
- `js/paint-ticker.js` — the marks wear the master's colour.
- `js/ui-pins.js` + `css/style.css` — a dot per overdub (`.lyr-ovd`).
- `js/renderer.js` `_drawOverdubHeads` + `js/grain.js` `overdubHeads` — the overdub's head
  (2026-09-05): the same square as the master's at a lower alpha, on the mark of the take
  nearest where the master's phase falls, one per stacked pass, with a thin line to the
  master's head. The layer has no clock of its own and the line says so.
- `js/ui-export.js` — `overdubs` on a loop slot, `EXPORT_VERSION` 11 → 12.
- `js/ui-samples.js` — undo removes the layer.

Departures, each a ruling made while building:

1. **No ghosting.** The tile does not grey when nothing is pinned — a ghost tile cannot be
   armed or sit in a slot, and the slot machinery would have to evict it the moment the last
   loop was unpinned. Instead the **press refuses**: the tile flashes (the sampler's
   no-sample flash) and the gesture never starts, so nothing latches and nothing paints.
2. **No ring on the marks.** They wear the master's colour, which is what the pinned rail's
   row wears, and that was enough to read the family. A ring is one more render-path draw for
   a distinction the colour already makes.
3. **The marks are inert to the cursor.** They are a line stroke never armed as a trigger, so
   the lens does not read them and touching them fires nothing — the sound is the pin's. They
   erase and undo like any stroke — and since 2026-09-05 **erase reaches the layer** (Ek: "that
   part of the overdub stroke I erased should not play"): the erased marks' spans are zeroed in
   the TAKE and the layer is rebuilt from it and swapped in under the seam, so a long take's
   stacked passes stay honest and the erase survives a reload (the file carries the take).
   The whole stroke erased takes the overdub off its master, dot and all, the way a loop dies
   with its stroke. **The family keeps the clock** (Ek, same day): the MASTER's whole stroke
   erased under a standing overdub silences the master's own audio and the cycle runs on for
   its layers; the last overdub leaving is what releases the pin. Derived from the marks, not
   a stored flag, so a session saved in between reads the same.
4. **Redo restores the marks, not the layer** — the same rule a pin already follows ("a pin
   is a placement; redo restores the material, not where it was later filed").

## 6. Tests

A section in `pins-audit.js`: pin a loop of known length, quiesce, inject a take at a known
audio-clock time and phase, and assert (a) which master it attached to when two are pinned at
different distances, (b) the layer's length equals the master's wall cycle, (c) the take's
samples land at `phase0` in the layer and wrap into pass two when the take is longer than the
cycle, (d) a take shorter than the cycle lands at its phase and nowhere else, (e) the master at
speed 0.5 gets a layer twice as long and the take unresampled, (f) mute, solo and unpin act on
the family, (g) undo of the stroke removes the layer, (h) export → import round-trips the
family and the layers come back phase-locked.

## 7. Open

- **The long press on the overdub tile** (toggle mode, 8 s): the Ditto's hold is *undo the
  last overdub*. A natural fit, not in this build.
- **A take that starts while the master is muted** still has a playhead (the source rolls);
  it attaches normally. Worth playing on the rig.
- **Two masters, one overdub** — never: a take has one master. If you want the same idea in
  two loops, play it twice.
