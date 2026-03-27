# Interaction Model — Three-Function System

> Design doc for mubone's core performer interaction model.
> Started Mar 26, 2026. Update as thinking evolves.

---

## Overview

mubone's interaction is built on **three composable functions** — not a pipeline. The performer combines them freely, in any order, overlapping as needed. The sequence and combination is a real-time creative decision.

| Function | Intent | What happens |
|---|---|---|
| **Trace** | Compose the map | Paint particles onto the sphere. Silent. The spatial score takes shape. |
| **Scan** | Listen / explore | Cursor previews what's on the sphere. Nothing committed. Auditioning the map. |
| **Commit** | Activate / sustain | Commit sustained sound to the sphere. Creates either a cloud or a loop. Release to undo. |

These are not steps 1-2-3. They compose freely:

- **Trace alone** — build the map silently
- **Scan alone** — explore what's already there
- **Commit alone** — commit a cloud or loop. If particles exist there, it plays them immediately. If empty, it waits for material to be traced into its path later.
- **Trace + Scan** — paint while listening. The default exploratory mode — building the map and auditioning it simultaneously before any commitment.
- **Trace + Commit** — live commit, paint and sustain simultaneously (current Shift+D/S)
- **Scan → Commit** — deferred commit, preview then commit. Requires existing particles — scanning an empty sphere has nothing to commit.
- **Trace + Scan → Commit** — compose, audition, then commit

The sphere is a spatial score, not a timeline. The performance unfolds in linear time, but the composition exists as a map or landscape. The performer navigates it, revisits it, crosses the same terrain differently each time.

---

## Commit — Unified Model

Currently seeds and loops are separate systems with separate slots, separate lock modes, and separate key bindings. The performer must track 12+12 slots across two mental models. They should be unified under **commit**.

**Important: all commit behaviors described below already exist in the current implementation.** This is a reorganization and simplification — merging two parallel systems into one. No new audio or synthesis functionality unless explicitly specified. The work is: unified pool, unified key binding, unified mental model.

### Input model

Two gestures × two modes = four commit types:

| | Tap C (drop) | Hold C (draw) |
|---|---|---|
| **Cloud mode** | Drop cloud — parked, plays nearby particles | Draw cloud — moving, draws a path through particles |
| **Loop mode** | Drop loop — plays existing buffer in radius | Draw loop — records a new buffer-based loop |

- **C** (tap) = drop (stationary commit)
- **C** (hold) = draw (commit with extent/motion)
- **Shift+C** = cycle commit mode between cloud and loop
- **⌘C** = release nearest or farthest commit from cursor (configurable)
- HUD displays current commit mode prominently

A commit is either a cloud or a loop — **you cannot commit both at the same time.** They are mutually exclusive commit types; the performer chooses one or the other for each commit action.

### Commit panel parameters

| Parameter | Scope | Notes |
|---|---|---|
| **Slot display** | Panel-wide | Default 8, range 1–16 |
| **Slot count selector** | Panel-wide | Dropdown to set pool size |
| **Overflow rule** | Panel-wide | Evicts when pool is full. Currently designed for nearest — needs review for closest/farthest options |
| **Playback mode** | Panel-wide | All (collage) / Focus |
| **Tether** | Panel-wide | Governs spatial relationship of commits to cursor |
| **Crossfade %** | Panel-wide | Crossfade amount between commits |
| **Direction** | Panel-wide | Forward / reverse / ping-pong. Applies to both clouds and loops |
| **Attack** | Panel-wide | Fade in time. Applied at commit time (not stamped — uses current panel value). Loops override to 0ms by default (backdoor to change TBD). |
| **Release** | Panel-wide | Fade out time. Applied at release time (not stamped — uses current panel value). |
| **Selection mode** | Panel-wide | **NEW** — closest or farthest from cursor. Determines which commit is targeted for morph and release. |
| **Clear all** | Panel-wide | Releases all commits |
| **Release (⌘C)** | Panel-wide | Releases the commit selected by selection mode (closest or farthest) |
| **Volume** | Loop only | Stamped at drop/draw time. Not adjustable after commit via selection. |
| **Speed** | Loop only | Stamped at drop/draw time. Not adjustable after commit via selection. |
| **Morph** | Cloud only | Interpolates granular params. Targets the cloud selected by selection mode (closest or farthest). |

### Parameter behavior

**Attack and release are not stamped to individual commits.** They are panel-wide values that apply in the moment — attack applies when a commit is created, release applies when a commit is released. Whatever the panel says at that moment is what's used.

**Loop override:** attack is forced to 0ms for loops (immediate start). A backdoor to change this may be added later but is not a priority.

**Volume and speed (loop only)** are stamped at drop/draw time. Not adjustable after commit via selection.

**Selection mode (closest/farthest) only controls two things:**
1. **Which commit is morphed** (cloud only)
2. **Which commit is released** (⌘C)

### Clouds (particle-based)

A **cloud** is a granular player committed to the sphere. It doesn't own a specific buffer — it plays whatever particles the grain engine finds nearby, governed by proximity, recency, k count, radius, and other granular patch settings.

**Motion:**
- **Parked (drop)** — cloud stays in one place, plays grains from a fixed position
- **Moving (draw)** — cloud travels along a path, scanning through particles as it goes

**Granular params:** grain size, density, pitch, and all other patch settings apply to clouds. Morph targets are cloud-based — morphing interpolates between granular parameter sets across clouds.

### Loops (buffer-based)

A **loop** is a buffer-locked player — like dropping the needle on a tape. The performer chose *that exact recording* and wants it repeating. The loop is bound to a specific buffer, not to whatever particles happen to be nearby.

**Created by:** drop loop (plays existing buffer in radius) or draw loop (records a new buffer-based loop).

**Playback direction:** forward, reverse, or ping-pong, with adjustable playback speed. Volume and speed are stamped at commit time.

### Removed from current implementation

- **Pause / resume** — no longer available. Commits are either active or released.
- **Lift / uproot** — replaced by release (⌘C). Same function, unified terminology.

### Empty commit

A cloud can be committed into empty space — no particles yet. The trail moves through nothing. Then the performer traces particles into its path later, and the cloud picks them up as they appear. This inverts the typical workflow: commit the motion first, fill in the material later. The cloud becomes a spatial listener waiting to be fed.

### Terminology

- **Commit** — the action of activating sustained sound (encompasses all four types)
- **Release** — remove nearest or farthest commit from cursor (configurable). The opposite of commit.
- **Drop** — tap gesture. Drop cloud (parked) or drop loop (existing buffer).
- **Draw** — hold gesture. Draw cloud (moving path) or draw loop (new recording).
- **Cloud** — particle-based commit (drop = parked, draw = moving)
- **Loop** — buffer-locked commit (drop = existing buffer, draw = new recording)
- **Commit lock** — unified lock mode (replaces separate seed lock / loop lock)

### Commit during trace

Commit can happen during trace (live commit). The performer paints and every particle is immediately active — no preview step. This is the current Shift+D/S behavior. In the unified model this becomes trace + commit combined, not a separate mode.

---

## Playback Modes

Playback modes govern how the world of **commits** (clouds and loops) behaves. They are distinct from scanning — scan is the preview/audition layer, playback modes only apply to committed items.

Current modes: **tether**, **focus**, **collage/all**.

These modes don't need to differentiate between clouds and loops. They operate on all commits. Unification simplifies this — one pool, one set of rules.

Note: the performer can commit in collage (all) mode and still use the cursor to crossfade between worlds. The crossfade capability lives in the playback mode layer, not in any cloud-vs-loop distinction.

---

## Open Design Questions

### Does behavior mode live on the commit or the patch?

If **on the commit**: behavior is stamped at creation time. A trail stays a trail, a loop stays a loop. Simpler, more predictable. Switching patches doesn't mutate existing commits.

If **on the patch**: switching patches could change how existing commits behave. A trail could become parked, a loop could change speed. Musically interesting but potentially chaotic. Harder to reason about.

Needs performer testing to decide.

### Unified pool size

Pool is 1–16 slots (default 8), configurable via dropdown. Previous system was 12+12=24 across two banks.

### Visual language

How to visually distinguish clouds vs loops on the sphere? Different glow, different shape, different trail rendering? The tether visual (#20 in TODO) becomes part of this.

### Morph

Morph applies to clouds only — interpolating between granular parameter sets. The cloud targeted for morph is determined by selection mode (closest or farthest).

### Overflow modes

Overflow is currently designed for nearest eviction only. Needs review — should overflow also respect the new selection mode (closest/farthest)? Or should overflow have its own rule (e.g. always evict oldest)?

---

## Relationship to Existing TODOs

This doc is the design thinking behind:
- **#23** — Unify loop mode and cloud/seed mode
- **#22** — Fade in/out for picked-up loops (becomes: envelope for all commits)
- **#13** — Farthest-first pickup (becomes: release selection mode — nearest or farthest)
- **#7** — Crash from too many loops/seeds (one pool, one limit, overflow rule)
- **#8** — Edge case seed lock + sample switching (one state machine, commit lock)
- **#20** — Tether seed visual (unified visual language for clouds and loops)
