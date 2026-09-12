# Fading strokes — a brush whose marks leave on their own

> **Status: PROPOSAL — NOT IMPLEMENTED.** A study, written 2026-09-05 at Ek's ask, the evening
> the wash brush shipped (#334). Nothing here is built. It says what already fades in the engine,
> the smallest model that gives a brush a lifetime, and what the movement-derived version would
> need. Read with `docs/archive/BRUSH-MODEL.md` (a stroke freezes its brush) and `docs/archive/OVERDUB-PLAN.md`
> § 5 (the shape of a plan that departed from its sketch).

## 0. The ask

Today a mark is permanent: it stays until an eraser, a sweep, an undo or an unpin takes it.
Ek wants a brush where that is not the promise — *"I know it's gonna fade away on its own"* —
with the stay decided one of two ways:

- **a parameter**: a fade-out time on the brush, like anything else in its sheet;
- **the movement**: how energetic the stroke was (speed, acceleration) or how much of the
  sphere it covered — a small, slow stroke leaves quickly, a big one stays.

*"For starters we can define the fadeout time."* And the observation that makes it matter:
you hear a fading stroke mostly through a **pin** — a scratch stroke is silent until the
cursor visits it, so a wash (`on end: cloud`) is where this is heard.

## 1. What already fades — the precedents

Four things in the engine already take material away on a clock, and between them they
cover every mechanism the feature needs. None is a new idea.

| precedent | where | what it does |
|---|---|---|
| **`passes`** — the self-killing loop (#239) | `grain.js` wrap detection → `selfKillSlot()` in `ui-presets.js` | a loop recorded with `passes: N` steps its gain down each wrap and, at the pass after the last, releases the slot AND deletes its paint (`S.particles = S.particles.filter(p => p.strokeId !== sid)`, bumps `_particleVersion`, drops its triggers). *The stroke was born promising to clean up after itself.* This is the loop family's version of the feature, and it is finished. |
| **a cloud's release ramp** | `_releasingAt` / `_envRelease` / `_envGainCurrent` on the slot, advanced per scheduler tick in `grain.js` | uproot does not delete a cloud, it ramps it: gain 1→0 over `S.commitRelease` seconds, then the slot is cleared. The ramp is the pin's death, and it is already the path every unpin takes. |
| **the radius fade** | `grain-worklet-bridge.js` `_postWorkletCandidates` — `radiusFade` on every candidate, cursor and cloud alike | a per-GRAIN gain the bridge computes on the main thread and the worklet applies. The worklet knows nothing about why; it multiplies. Any per-mark gain can ride the same number. |
| **erase's removal path** | `erase.js` (`S.particles = next`, `_gapAfter` stamps, `_particleVersion++`) and `onMarksErased()` in `ui-presets.js` | the one correct way to remove marks: it writes through to held loops (a loop over erased marks goes silent there, in place), stamps the ribbon break, and invalidates the angle caches. Removing marks any other way leaves loops singing over nothing. |

## 2. The smallest model — `life`, baked per mark

**A mark is born with a lifetime.** Two numbers on the particle, stamped by the paint ticker
at deposit: `bornAt` (seconds, the same `performance.now() / 1000` clock `_plantedAt` uses)
and `life` (seconds; `0` = ∞, today's behaviour). The brush's `life` row is the source, read at
deposit like every other placement constant — so it is **frozen per mark**, not per voicing.
Voicings are interned on the resolved sound and a lifetime is not a sound: putting it on the
voicing would give every stroke of a brush one clock, and make wet paint move death around.

**Three consumers, no new machinery.**

1. **Gain.** The bridge already computes `radiusFade` per candidate; `life` multiplies it:
   `g = lifeCurve(1 − age / life)`. Every reader — the cursor, a cloud on its path — hears the
   mark fade with no worklet change. The curve wants to be perceptual (a power ≥ 2, or 60 dB
   over the last quarter); a linear fade sits audibly at half-level for most of its life.
2. **Sight.** The renderer draws the mark at its gain: alpha × g, radius shrinking with it. The
   scratch layer is batched by fill style, and a per-mark alpha would break the batch into per-dot
   calls — the exact stall #108 removed. Quantise g to four levels and batch by level, the way
   the glow map is drawn. **Profile against scheduler drift before shipping** (CLAUDE.md, render
   path).
3. **Death.** A janitor in the scheduler tick (it walks every particle already, for the cloud
   claims) collects marks past `bornAt + life` and hands them to the erase path in one batch at
   ~2 Hz — never per tick, because the filter allocates. `onMarksErased` then does what it does
   for a held loop, and `_particleVersion` invalidates the caches. Undo sees a dead stroke the way
   it sees a self-killed loop: the history entry stays, the marks are gone.

**The pin follows the stroke.** A cloud pinned by `on end: cloud` reads what is inside its
radius, so over a dying stroke it goes quiet on its own — but it stays pinned, a ghost, taking a
slot. The deferred path (`startSeedPath` → `finalizeSeedPlant`) knows which stroke made the
cloud; stamp `seed.strokeId` there, and when the stroke's last mark dies release the cloud
through its own ramp (`_releasingAt`, not a delete). That is `selfKillSlot` with the causality
reversed: the loop's clock kills its paint; here the paint's clock kills the pin. A loop pinned
(the looper) has a snapshot buffer and does not fade with its marks — `passes` is that loop's
lever, and the two rows are the same question asked of two engines: **how long does this
stay?**

**Where it goes.** The grain sheet, deposit section: `rate · width · on end · life`. Display
seconds, `∞` at 0, the same `fx`-kind row `passes` uses. The wash ships at ∞ — a reverb that
stays until unpinned — unless Ek wants the wash to be the fading brush, in which case it is one
factory value.

## 3. The movement-derived version — later

What the stroke can know about itself, all of it already computed somewhere:

| quantity | where it exists today | what it would say |
|---|---|---|
| speed at each deposit | `paint-ticker.js` — splatter's scatter rides it | energy, instant |
| acceleration | one difference of the above | effort, *"if I was moving energetically"* |
| angular extent of the stroke | the trigger gate's bounding cap (`trigger.js`) | *"how much surface area my stroke took up"* |
| path length | the comb's `total` | how far the hand travelled |

Two rulings the study makes before anyone builds it:

- **Judge the stroke whole, at the seal.** A per-mark life from movement kills a stroke's slow
  start before its fast middle, so a phrase dies from the front. The stroke's `life` should be
  one number, computed from the whole path when the stroke ends and stamped onto every mark
  then (`bornAt` stays per mark, so the fade still runs front to back — but from one deadline).
  The cost is that nothing fades while you are still painting, which is right: a stroke in the
  hand is not finished.
- **One row, three sources.** `life by: fixed · speed · area`, with the `life` number as the
  scale (fixed: the value; speed and area: the value at a reference energy, doubled or halved by
  the stroke). Not three rows; the choice is which measurement, and the number is the same
  number. Ek's *"we can figure that part out later"* — this is the shape to figure it into.

## 4. What this is not

- Not a decay of the **audio** — the take is untouched; a dead mark is a mark nothing reads.
- Not a new layer type, not staging (dead since 2026-08-30), not a mode on the hand: a
  property of the brush, frozen into the material, like everything else in the brush model.
- Not the wash's job. The wash is `on end: cloud`; fading is `life`. Independent rows, and a
  fading wash is the one brush that wants both.
