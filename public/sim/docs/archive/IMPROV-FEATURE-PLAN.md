# Mubone — Improv Mode Feature Plan

> **Status: ARCHIVED / HISTORICAL.** This plan or audit is complete — kept as the record of what was decided, what changed, and how to revert it. **It does not describe current behaviour** and may use superseded terminology. Do not use it to learn how the system works today; read the reference docs listed in CLAUDE.md instead.

> **Living document.** Update this file at the end of every session to reflect what has been completed, what is in progress, and any decisions made. New agents should read this first.

---

## Context

This plan was developed through a design conversation about making Mubone more immediate and usable as a live improv instrument. The core problem: the current instrument is compositional and requires planning — there is a delay between thought and action, the sound world accumulates unpredictably during live painting, and movement/orientation alone cannot provide enough control in real-time improv.

The solution is a new performance modality built around four interconnected features:

1. Monitor / House bus split
2. Per-seed grain state
3. Nearest-seed navigation mode
4. Gesture morph system

These are designed to be implemented in order — each phase is fully testable before the next begins, and the existing instrument continues to work throughout.

---

## Performance Workflow (What We're Building Toward)

The performer enters with a **pre-built sound world** on the sphere — loaded before the show. During performance:

- **Monitoring is always on** in headphones. The cursor granulates wherever it points. This is private — the performer is searching.
- **Seeds are always in the house.** When a seed is planted, it immediately appears in the house mix. Uprooting it removes it.
- A **MIDI pedal** optionally sends the cursor (monitor) granulation to the house too — for moments when the performer wants to play the cursor live to the audience.
- A **volume pedal** controls the overall seed bus output level.
- The performer builds the house texture by planting seeds one by one — collaging layers.
- Switching to **focus-seed mode**: the house plays only the seed closest to the cursor. Moving through the sphere navigates between sonic territories. A **crossfade slider** controls whether transitions are hard cuts or smooth dissolves.
- While a seed is active (nearest to cursor), **gesture morphing** shapes its grain params in real time — shaking the instrument pushes it toward agitation, slow waving pulls it toward smoothness. The morph holds where you leave it.
- The **trombone mute** acts as a mode gate for future integration with PiPo audio analysis (separate feature, not in this plan).

---

## Codebase Overview

| File | Role |
|---|---|
| `js/state.js` | All constants, presets (11 system + 8 user), and the `S` mutable state object. Start here to understand data shape. |
| `js/grain.js` | Core granular engine. `playGrain()` routes to VBAP speaker buses or stereo fallback. Seed and cursor scheduling loops live here. Hot path — changes need care. |
| `js/audio.js` | AudioContext setup, speaker bus graph, headphone downmix. |
| `js/sensor.js` | BNO085 quaternion processing, tare, world frame. |
| `js/wand.js` | Second IMU mapping engine. Already has `gyroMag` and `accelDynMag` from inertial stream. Agitation axis, preset morphing (1D and 2D bilinear), per-axis parameter slots. |
| `js/osc.js` | Single `handleOSC()` dispatcher for all incoming OSC. Both Electron IPC and browser WebSocket transports. |
| `js/ui-presets.js` | Seed bank UI, preset buttons, grain parameter controls. `plantSeed`, `uprootNearestSeed` live here. |
| `js/events.js` | Keyboard, mouse, MIDI, fader events. |

### Key existing state relevant to this plan

```js
S.seedSlots           // Array(8), each null or { lon, lat, ... } — NO per-seed grain params yet
S.grainParams         // Active preset params — currently shared by ALL seeds and cursor
S.grainOverrides      // Per-param overrides — also currently global, not per-seed
S.outputGainValue     // Master output gain
wand.inertial         // { gx, gy, gz, ax, ay, az, gyroMag, accelDynMag } — already captured
findNearestSeedSlot   // Already exists in grain.js — computes nearest seed to a lon/lat
```

### Current audio graph (simplified)

```
Cursor grains ──┐
                ├──► masterBus ──► softClipper ──► destination (all output)
Seed grains   ──┘
```

### Target audio graph

```
Cursor grains ──► monitorBus ──► headphones (always)
                      │
                      └──► [MIDI pedal gain] ──► houseBus ──► house speakers
Seed grains   ──────────────────────────────────► houseBus ──► house speakers
                                                      │
                                                  [volume pedal]
```

---

## Phase 1 — Monitor / House Bus Split

**Status:** ✅ Implemented (2026-03-12)

**Goal:** Cursor granulation goes to headphones only by default. Seeds always go to house. MIDI pedal fades cursor into house when desired.

**Files to change:**
- `js/audio.js` — add `monitorBus` and `houseBus` GainNodes
- `js/grain.js` — `playGrain()` takes a `destination` param; cursor grains → monitorBus, seed grains → houseBus
- `js/state.js` — add `S.monitorGain`, `S.houseGain`
- `js/osc.js` — add `/monitor/volume` and `/house/volume` OSC addresses

**OSC additions:**

| Address | Args | Description |
|---|---|---|
| `/monitor/volume` | `f` | Cursor granulation volume to house (0–1, pedal controlled) |
| `/house/volume` | `f` | Overall seed bus volume (0–2, volume pedal) |

**Before starting:** Confirm MOTU M2 routing. The M2 has 2 main outs + headphone that mirrors main. Decide whether monitor and house are separate physical outputs (needs mixer/second interface) or whether this split is handled inside Mubone's mix and sent to a single stereo out with the split handled downstream.

**Test criteria:**
- Cursor granulation audible in headphones only by default
- Planting a seed immediately audible in house
- Uprooting a seed removes it from house
- MIDI pedal smoothly crossfades cursor into house
- Volume pedal controls seed bus level
- All existing instrument behavior preserved

---

## Phase 2 — Per-Seed Grain State

**Status:** ✅ Implemented (2026-03-12) — was already mostly working; added Phase 4 preparation fields (grainOverrides, morphT, morphVelocity) and ensured curveType/direction/probability are captured in snapshot.

**Goal:** Each seed captures the active grain params at the moment it is planted. Seeds play with their own independent grain character rather than the current global preset. This is the prerequisite for Phase 3 and Phase 4.

**Files to change:**
- `js/ui-presets.js` — `plantSeed()`: snapshot current merged params onto seed object
- `js/grain.js` — seed scheduling loop reads from `seed.grainParams` + `seed.grainOverrides` instead of `S.grainParams` + `S.grainOverrides`
- `js/state.js` — add `S.perSeedGrainState` feature flag (boolean, default `false` initially for safety)

**Seed object shape after this phase:**

```js
{
  lon, lat,               // existing position
  color,                  // existing
  grainParams: { ... },   // NEW: snapshot of merged params at drop time
  grainOverrides: {},     // NEW: starts empty, morphing writes here (Phase 4)
  morphT: 0.5,            // NEW: agitation position 0=smooth, 0.5=neutral, 1=agitated (Phase 4)
  morphVelocity: 0,       // NEW: momentum accumulator (Phase 4)
}
```

**Snapshot merge function** (new helper, probably in `state.js` or `ui-presets.js`):

```js
function snapshotGrainParams() {
  const snap = { ...S.grainParams };
  for (const [k, v] of Object.entries(S.grainOverrides)) {
    if (v !== null) snap[k] = v;
  }
  return snap;
}
```

**Feature flag safety:** Keep `S.perSeedGrainState = false` until Phase 2 is fully tested. When false, grain.js falls back to reading from S (current behavior). Flip to true once verified.

**Before starting:** Read the full seed scheduling loop in `grain.js` (lines ~200+, not yet fully read). Understand exactly where `S.grainParams` and `S.grainOverrides` are read during seed grain scheduling.

**Test criteria:**
- Drop two seeds with different active presets
- Both play simultaneously with their own independent grain character
- Changing the active preset after dropping does not affect existing seeds
- Feature flag off = identical behavior to current instrument

---

## Phase 3 — Nearest-Seed Navigation Mode

**Status:** ✅ Implemented (2026-03-12) — distance-weighted grain volume in focus mode, crossfade via seedXfade, OSC control. UI toggle not yet added.

**Depends on:** Phase 2 (per-seed grain state)

**Goal:** A new seed playback mode where only the seed nearest to the cursor plays (or a distance-weighted blend). Toggle between all mode (all seeds play, current behavior) and focus-seed mode.

**New state:**

```js
S.seedMode       // 'all' | 'focus'  (default: 'all')
S.seedXfade  // 0.0 = hard snap, 1.0 = full crossfade  (default: 0.0)
S.seedTether     // true = always play, false = radius-gated  (default: true)
```

**Gain weighting logic (focus-seed mode):**

- Compute angular distance from cursor to each active seed
- At `crossfade = 0`: weight = 1 for nearest seed, 0 for all others
- At `crossfade = 1`: weight = inverseDist / sum(inverseDists) for all active seeds
- In between: softmax-style — dominant seed strongly favored, neighbors bleed proportionally
- Weights write to per-seed GainNodes in real time

**Secondary meaning of crossfade slider:** Also controls morph target exclusivity — at full snap, gesture morphing only affects the single nearest seed; at full crossfade, morph energy distributes across all seeds weighted by distance.

**UI additions:**
- Toggle button: All / Focus mode
- Crossfade slider (0–1)
- Tether toggle: Always play vs. radius-gated
- Visual indicator in seed bank showing which seed is currently dominant (brightest/highlighted)

**OSC additions:**

| Address | Args | Description |
|---|---|---|
| `/seed/mode` | `s` | `all` or `focus` |
| `/seed/xfade` | `f` | 0.0 (snap) to 1.0 (crossfade) |
| `/seed/tether` | `i` | 0 = radius-gated, 1 = always play |

**Test criteria:**
- 4 seeds planted, cursor navigates between them in snap mode — hard cuts
- Same in crossfade mode — smooth dissolves
- At equidistant position between 4 seeds in crossfade mode — all 4 blend equally
- All mode still works as before
- Feature toggle between modes mid-performance is clean (no clicks/pops)
- Tether toggle works: with tether ON, seed always plays; with OFF, respects radius

---

## Phase 4 — Gesture Morph System

**Status:** ✅ Implemented (2026-03-12) — updateGestureMorph() in wand.js, called on every /space/wand/inertial tick. Momentum and elastic hold modes. Agitation axis deltas tunable. Seed grainOverrides merged at scheduling time.

**Depends on:** Phase 2 (per-seed grain state)

**Goal:** The seed nearest to the cursor can be morphed along a smooth↔agitated axis using physical gesture (wand/instrument inertial data). Morph holds its position when gesture stops (momentum) or slowly recovers (elastic). Focus-seed selection for morphing follows the same snap/crossfade logic as Phase 3.

**Agitation axis definition (additive deltas on top of planted snapshot):**

| Direction | Parameters affected |
|---|---|
| Agitated (+) | period ↓, pitchJitter ↑, durJitter ↑, fadeRatio ↓, curveType → rect |
| Smooth (−) | duration ↑, period ↑, pitchJitter ↓, durJitter ↓, fadeRatio ↑, curveType → hann |

These are applied as scaled deltas from `seed.grainParams` (the planted snapshot) — not lerp between two separate presets. `morphT = 0.5` = snapshot exactly. `morphT = 1.0` = max agitation delta applied. `morphT = 0.0` = max smooth delta applied.

**Gesture input (from `wand.inertial`):**

```
gyroMag > agitateThreshold  →  accumulate positive morphVelocity (toward agitated)
gyroMag < smoothThreshold   →  accumulate negative morphVelocity (toward smooth)
                               (only when some movement present — accelDynMag > deadzone)
```

Default thresholds (tunable): `agitateThreshold = 80 deg/s`, `smoothThreshold = 20 deg/s`

**Hold modes:**

- **Momentum** (default for all mode): `morphVelocity` decays to zero, `morphT` holds at last position. Permanent until gestured back.
- **Elastic**: `morphT` drifts toward 0.5 at a configurable rate when `gyroMag < deadzone`. Rate stored as `S.morphElasticRate` (0.0 = no recovery, 1.0 = instant snap back). Suggested default: 0.02 (very slow drift).
- Toggle between modes: `S.morphHoldMode = 'momentum' | 'elastic'`

**Which seed is targeted:**
- In focus-seed mode (Phase 3): same seed that is dominant per the snap/crossfade weighting
- In all mode: nearest seed to cursor regardless of playback weighting
- At full crossfade: morph energy distributes across seeds weighted by distance (same weights as audio)

**Morph update loop:** Runs on every `/space/wand/inertial` OSC tick (already firing). Calls into seed morph update function, writes delta to `seed.grainOverrides` via the agitation axis delta function.

**New state:**

```js
S.morphHoldMode     // 'momentum' | 'elastic'
S.morphElasticRate  // 0.0–1.0
S.agitateThreshold  // deg/s, default 80
S.smoothThreshold   // deg/s, default 20
```

**Before starting:** Confirm whether the wand (second IMU, `/space/wand`) or the main instrument sensor (`/space/cursor`) is the gesture input for morphing. They have separate inertial streams. Currently only the wand has `inertial` data (`gyroMag`, `accelDynMag`). If the main instrument sensor is intended, the inertial stream needs to be added to its OSC path.

**Test criteria:**
- Plant seed with wash preset
- Shake instrument → seed becomes more agitated (shorter period, more jitter) in house
- Stop shaking → holds at agitated position (momentum mode)
- Wave slowly → seed smooths back toward and past its planted character
- Switch to elastic mode → seed slowly recovers toward planted state when idle
- Two seeds planted: morphing targets the nearest one only (snap mode) or both proportionally (crossfade mode)

---

## Open Questions (resolve before each phase)

1. **MOTU M2 routing** (before Phase 1): Are monitor and house separate physical outputs, or is the split happening inside Mubone's mix sent to a single stereo pair? The M2 has 2 main outs + headphone. Headphone mirrors main. A true split needs either a mixer downstream or a second audio interface.

2. **Gesture sensor** (before Phase 4): Is the wand (second IMU) or the main instrument sensor the intended gesture input? Only the wand currently has inertial data in the OSC stream.

3. **Morph axis parameters** (before Phase 4): The agitation deltas above are first-draft estimates. Tune these after Phase 2 is working and you can hear per-seed grain character clearly.

---

## Current OSC Namespace (full, for reference)

| Address | Args | Description |
|---|---|---|
| `/orientation` | `f f f f` | BNO085 quaternion `[qx, qy, qz, qw]` |
| `/grain/duration` | `f` | Grain duration in seconds |
| `/grain/period` | `f` | Onset period in seconds |
| `/grain/volume` | `f` | Grain volume (0–2) |
| `/grain/pitch` | `f` | Pitch jitter (0–1) |
| `/grain/pan` | `f` | Pan spread (0–1) |
| `/grain/radius` | `f` | Search radius in degrees (1–180) |
| `/grain/k` | `i` | Pool size |
| `/grain/prob` | `f` | Fire probability (0–1) |
| `/grain/dir` | `s` | `fwd` / `rev` / `rnd` |
| `/preset` | `i` | Select preset (1-based) |
| `/spatial/mode` | `s` | `sim` / `physical` |
| `/record` | `i` | `1` = start, `0` = stop |
| `/mute` | `i` | `1` = mute, `0` = unmute |
| `/seed/plant` | *(bang)* | Plant seed at current cursor position |
| `/seed/uproot` | *(bang)* | Uproot nearest seed |
| `/undo` | *(bang)* | Undo last particle paint stroke |
| `/monitor/volume` | `f` | *(Phase 1)* Cursor-to-house send level |
| `/house/volume` | `f` | *(Phase 1)* Seed bus master volume |
| `/seed/mode` | `s` | *(Phase 3)* `all` or `focus` |
| `/seed/tether` | `i` | *(Phase 3)* 0=radius-gated, 1=always |
| `/seed/xfade` | `f` | *(Phase 3)* 0.0=snap, 1.0=crossfade |

---

## Progress Log

> Add an entry here at the end of every session.

- **2026-03-12** — Design conversation complete. All four phases defined. No code written yet. Plan written to this file.
- **2026-03-12** — All four phases implemented:
  - **Phase 1**: monitorBus + houseBus created in audio.js ensureAudioContext(). Stereo path in playGrain routes cursor → monitorBus, seeds → houseBus. VBAP (Electron) path unchanged until MOTU routing is confirmed. OSC: `/monitor/volume` (pedal 0–1), `/house/volume` (volume pedal 0–2) with setTargetAtTime smoothing.
  - **Phase 2**: Already partially implemented — plantSeed() was already snapshotting merged params. Added curveType/direction/probability capture, plus Phase 4 preparation fields (grainOverrides: {}, morphT: 0.5, morphVelocity: 0).
  - **Phase 3**: Per-seed distance-weighted volume in scheduleGrains seed loop. `S.seedMode` ('all'|'focus'), `S.seedXfade` (0=snap, 1=crossfade), `S.seedTether` (true=always, false=radius-gated). Inverse-distance weighting with configurable sharpness. Silent seeds still advance onset clock. OSC: `/seed/mode`, `/seed/xfade`, `/seed/tether`.
  - **Phase 4**: `updateGestureMorph()` in wand.js, called on every `/space/wand/inertial` tick (independent of wandConfig.enabled). Reads gyroMag, drives morphT on focus seed(s) via velocity accumulation. Agitation axis: period↓ pitchJitter↑ durJitter↑ fadeRatio↓ duration↓. Smooth axis: reverse. Momentum and elastic hold modes. Seed.grainOverrides merged at scheduling time via Object.create prototype chain.
  - **Remaining**: UI controls (toggle buttons, sliders) not yet added — all features controllable via OSC. MOTU M2 routing for true monitor/house physical split needs hardware confirmation. Agitation delta values are first-draft estimates — tune after testing.
