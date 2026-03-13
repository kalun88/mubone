# Mubone — Improv Mode Feature Plan

> **Living document.** Update this file at the end of every session to reflect what has been completed, what is in progress, and any decisions made. New agents should read this first.

---

## Context

This plan was developed through a design conversation about making Mubone more immediate and usable as a live improv instrument. The core problem: the current instrument is compositional and requires planning — there is a delay between thought and action, the sound world accumulates unpredictably during live painting, and movement/orientation alone cannot provide enough control in real-time improv.

The solution is a new performance modality built around four interconnected features:

1. Monitor / House bus split
2. Per-cloud grain state
3. Nearest-cloud navigation mode
4. Gesture morph system

These are designed to be implemented in order — each phase is fully testable before the next begins, and the existing instrument continues to work throughout.

---

## Performance Workflow (What We're Building Toward)

The performer enters with a **pre-built sound world** on the sphere — loaded before the show. During performance:

- **Monitoring is always on** in headphones. The cursor granulates wherever it points. This is private — the performer is searching.
- **Clouds are always in the house.** When a cloud is dropped, it immediately appears in the house mix. Picking it up removes it.
- A **MIDI pedal** optionally sends the cursor (monitor) granulation to the house too — for moments when the performer wants to play the cursor live to the audience.
- A **volume pedal** controls the overall cloud bus output level.
- The performer builds the house texture by dropping clouds one by one — collaging layers.
- Switching to **nearest-cloud mode**: the house plays only the cloud closest to the cursor. Moving through the sphere navigates between sonic territories. A **snap/crossfade slider** controls whether transitions are hard cuts or smooth dissolves.
- While a cloud is active (nearest to cursor), **gesture morphing** shapes its grain params in real time — shaking the instrument pushes it toward agitation, slow waving pulls it toward smoothness. The morph holds where you leave it.
- The **trombone mute** acts as a mode gate for future integration with PiPo audio analysis (separate feature, not in this plan).

---

## Codebase Overview

| File | Role |
|---|---|
| `js/state.js` | All constants, presets (11 system + 8 user), and the `S` mutable state object. Start here to understand data shape. |
| `js/grain.js` | Core granular engine. `playGrain()` routes to VBAP speaker buses or stereo fallback. Cloud and cursor scheduling loops live here. Hot path — changes need care. |
| `js/audio.js` | AudioContext setup, speaker bus graph, headphone downmix. |
| `js/sensor.js` | BNO085 quaternion processing, tare, world frame. |
| `js/wand.js` | Second IMU mapping engine. Already has `gyroMag` and `accelDynMag` from inertial stream. Agitation axis, preset morphing (1D and 2D bilinear), per-axis parameter slots. |
| `js/osc.js` | Single `handleOSC()` dispatcher for all incoming OSC. Both Electron IPC and browser WebSocket transports. |
| `js/ui-presets.js` | Cloud bank UI, preset buttons, grain parameter controls. `dropCloud`, `pickupNearestCloud` live here. |
| `js/events.js` | Keyboard, mouse, MIDI, fader events. |

### Key existing state relevant to this plan

```js
S.cloudSlots          // Array(8), each null or { lon, lat, ... } — NO per-cloud grain params yet
S.grainParams         // Active preset params — currently shared by ALL clouds and cursor
S.grainOverrides      // Per-param overrides — also currently global, not per-cloud
S.outputGainValue     // Master output gain
wand.inertial         // { gx, gy, gz, ax, ay, az, gyroMag, accelDynMag } — already captured
findNearestCloudSlot  // Already exists in grain.js — computes nearest cloud to a lon/lat
```

### Current audio graph (simplified)

```
Cursor grains ──┐
                ├──► masterBus ──► softClipper ──► destination (all output)
Cloud grains  ──┘
```

### Target audio graph

```
Cursor grains ──► monitorBus ──► headphones (always)
                      │
                      └──► [MIDI pedal gain] ──► houseBus ──► house speakers
Cloud grains  ──────────────────────────────────► houseBus ──► house speakers
                                                      │
                                                  [volume pedal]
```

---

## Phase 1 — Monitor / House Bus Split

**Status:** ✅ Implemented (2026-03-12)

**Goal:** Cursor granulation goes to headphones only by default. Clouds always go to house. MIDI pedal fades cursor into house when desired.

**Files to change:**
- `js/audio.js` — add `monitorBus` and `houseBus` GainNodes
- `js/grain.js` — `playGrain()` takes a `destination` param; cursor grains → monitorBus, cloud grains → houseBus
- `js/state.js` — add `S.monitorGain`, `S.houseGain`
- `js/osc.js` — add `/monitor/volume` and `/house/volume` OSC addresses

**OSC additions:**

| Address | Args | Description |
|---|---|---|
| `/monitor/volume` | `f` | Cursor granulation volume to house (0–1, pedal controlled) |
| `/house/volume` | `f` | Overall cloud bus volume (0–2, volume pedal) |

**Before starting:** Confirm MOTU M2 routing. The M2 has 2 main outs + headphone that mirrors main. Decide whether monitor and house are separate physical outputs (needs mixer/second interface) or whether this split is handled inside Mubone's mix and sent to a single stereo out with the split handled downstream.

**Test criteria:**
- Cursor granulation audible in headphones only by default
- Dropping a cloud immediately audible in house
- Picking up a cloud removes it from house
- MIDI pedal smoothly crossfades cursor into house
- Volume pedal controls cloud bus level
- All existing instrument behavior preserved

---

## Phase 2 — Per-Cloud Grain State

**Status:** ✅ Implemented (2026-03-12) — was already mostly working; added Phase 4 preparation fields (grainOverrides, morphT, morphVelocity) and ensured curveType/direction/probability are captured in snapshot.

**Goal:** Each cloud captures the active grain params at the moment it is dropped. Clouds play with their own independent grain character rather than the current global preset. This is the prerequisite for Phase 3 and Phase 4.

**Files to change:**
- `js/ui-presets.js` — `dropCloud()`: snapshot current merged params onto cloud object
- `js/grain.js` — cloud scheduling loop reads from `cloud.grainParams` + `cloud.grainOverrides` instead of `S.grainParams` + `S.grainOverrides`
- `js/state.js` — add `S.perCloudGrainState` feature flag (boolean, default `false` initially for safety)

**Cloud object shape after this phase:**

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

**Feature flag safety:** Keep `S.perCloudGrainState = false` until Phase 2 is fully tested. When false, grain.js falls back to reading from S (current behavior). Flip to true once verified.

**Before starting:** Read the full cloud scheduling loop in `grain.js` (lines ~200+, not yet fully read). Understand exactly where `S.grainParams` and `S.grainOverrides` are read during cloud grain scheduling.

**Test criteria:**
- Drop two clouds with different active presets
- Both play simultaneously with their own independent grain character
- Changing the active preset after dropping does not affect existing clouds
- Feature flag off = identical behavior to current instrument

---

## Phase 3 — Nearest-Cloud Navigation Mode

**Status:** ✅ Implemented (2026-03-12) — distance-weighted grain volume in nearest mode, snap/crossfade via cloudSnapFade, OSC control. UI toggle not yet added.

**Depends on:** Phase 2 (per-cloud grain state)

**Goal:** A new cloud playback mode where only the cloud nearest to the cursor plays (or a distance-weighted blend). Toggle between collage mode (all clouds play, current behavior) and nearest-cloud mode.

**New state:**

```js
S.cloudMode      // 'collage' | 'nearest'  (default: 'collage')
S.cloudSnapFade  // 0.0 = hard snap, 1.0 = full crossfade  (default: 0.0)
```

**Gain weighting logic (nearest-cloud mode):**

- Compute angular distance from cursor to each active cloud
- At `snapFade = 0`: weight = 1 for nearest cloud, 0 for all others
- At `snapFade = 1`: weight = inverseDist / sum(inverseDists) for all active clouds
- In between: softmax-style — dominant cloud strongly favored, neighbors bleed proportionally
- Weights write to per-cloud GainNodes in real time

**Secondary meaning of snap/crossfade slider:** Also controls morph target exclusivity — at full snap, gesture morphing only affects the single nearest cloud; at full crossfade, morph energy distributes across all clouds weighted by distance.

**UI additions:**
- Toggle button: Collage / Nearest mode
- Snap–Crossfade slider (0–1)
- Visual indicator in cloud bank showing which cloud is currently dominant (brightest/highlighted)

**OSC additions:**

| Address | Args | Description |
|---|---|---|
| `/cloud/mode` | `s` | `collage` or `nearest` |
| `/cloud/snapfade` | `f` | 0.0 (snap) to 1.0 (crossfade) |

**Test criteria:**
- 4 clouds planted, cursor navigates between them in snap mode — hard cuts
- Same in crossfade mode — smooth dissolves
- At equidistant position between 4 clouds in crossfade mode — all 4 blend equally
- Collage mode still works as before
- Feature toggle between modes mid-performance is clean (no clicks/pops)

---

## Phase 4 — Gesture Morph System

**Status:** ✅ Implemented (2026-03-12) — updateGestureMorph() in wand.js, called on every /space/wand/inertial tick. Momentum and elastic hold modes. Agitation axis deltas tunable. Cloud grainOverrides merged at scheduling time.

**Depends on:** Phase 2 (per-cloud grain state)

**Goal:** The cloud nearest to the cursor can be morphed along a smooth↔agitated axis using physical gesture (wand/instrument inertial data). Morph holds its position when gesture stops (momentum) or slowly recovers (elastic). Nearest-cloud selection for morphing follows the same snap/crossfade logic as Phase 3.

**Agitation axis definition (additive deltas on top of planted snapshot):**

| Direction | Parameters affected |
|---|---|
| Agitated (+) | period ↓, pitchJitter ↑, durJitter ↑, fadeRatio ↓, curveType → rect |
| Smooth (−) | duration ↑, period ↑, pitchJitter ↓, durJitter ↓, fadeRatio ↑, curveType → hann |

These are applied as scaled deltas from `cloud.grainParams` (the planted snapshot) — not lerp between two separate presets. `morphT = 0.5` = snapshot exactly. `morphT = 1.0` = max agitation delta applied. `morphT = 0.0` = max smooth delta applied.

**Gesture input (from `wand.inertial`):**

```
gyroMag > agitateThreshold  →  accumulate positive morphVelocity (toward agitated)
gyroMag < smoothThreshold   →  accumulate negative morphVelocity (toward smooth)
                               (only when some movement present — accelDynMag > deadzone)
```

Default thresholds (tunable): `agitateThreshold = 80 deg/s`, `smoothThreshold = 20 deg/s`

**Hold modes:**

- **Momentum** (default for collage): `morphVelocity` decays to zero, `morphT` holds at last position. Permanent until gestured back.
- **Elastic**: `morphT` drifts toward 0.5 at a configurable rate when `gyroMag < deadzone`. Rate stored as `S.morphElasticRate` (0.0 = no recovery, 1.0 = instant snap back). Suggested default: 0.02 (very slow drift).
- Toggle between modes: `S.morphHoldMode = 'momentum' | 'elastic'`

**Which cloud is targeted:**
- In nearest-cloud mode (Phase 3): same cloud that is dominant per the snap/crossfade weighting
- In collage mode: nearest cloud to cursor regardless of playback weighting
- At full crossfade: morph energy distributes across clouds weighted by distance (same weights as audio)

**Morph update loop:** Runs on every `/space/wand/inertial` OSC tick (already firing). Calls into cloud morph update function, writes delta to `cloud.grainOverrides` via the agitation axis delta function.

**New state:**

```js
S.morphHoldMode     // 'momentum' | 'elastic'
S.morphElasticRate  // 0.0–1.0
S.agitateThreshold  // deg/s, default 80
S.smoothThreshold   // deg/s, default 20
```

**Before starting:** Confirm whether the wand (second IMU, `/space/wand`) or the main instrument sensor (`/space/cursor`) is the gesture input for morphing. They have separate inertial streams. Currently only the wand has `inertial` data (`gyroMag`, `accelDynMag`). If the main instrument sensor is intended, the inertial stream needs to be added to its OSC path.

**Test criteria:**
- Plant cloud with wash preset
- Shake instrument → cloud becomes more agitated (shorter period, more jitter) in house
- Stop shaking → holds at agitated position (momentum mode)
- Wave slowly → cloud smooths back toward and past its planted character
- Switch to elastic mode → cloud slowly recovers toward planted state when idle
- Two clouds planted: morphing targets the nearest one only (snap mode) or both proportionally (crossfade mode)

---

## Open Questions (resolve before each phase)

1. **MOTU M2 routing** (before Phase 1): Are monitor and house separate physical outputs, or is the split happening inside Mubone's mix sent to a single stereo pair? The M2 has 2 main outs + headphone. Headphone mirrors main. A true split needs either a mixer downstream or a second audio interface.

2. **Gesture sensor** (before Phase 4): Is the wand (second IMU) or the main instrument sensor the intended gesture input? Only the wand currently has inertial data in the OSC stream.

3. **Morph axis parameters** (before Phase 4): The agitation deltas above are first-draft estimates. Tune these after Phase 2 is working and you can hear per-cloud grain character clearly.

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
| `/cloud/drop` | *(bang)* | Drop cloud at current cursor position |
| `/cloud/pickup` | *(bang)* | Pick up nearest cloud |
| `/undo` | *(bang)* | Undo last particle paint stroke |
| `/monitor/volume` | `f` | *(Phase 1)* Cursor-to-house send level |
| `/house/volume` | `f` | *(Phase 1)* Cloud bus master volume |
| `/cloud/mode` | `s` | *(Phase 3)* `collage` or `nearest` |
| `/cloud/snapfade` | `f` | *(Phase 3)* 0.0=snap, 1.0=crossfade |

---

## Progress Log

> Add an entry here at the end of every session.

- **2026-03-12** — Design conversation complete. All four phases defined. No code written yet. Plan written to this file.
- **2026-03-12** — All four phases implemented:
  - **Phase 1**: monitorBus + houseBus created in audio.js ensureAudioContext(). Stereo path in playGrain routes cursor → monitorBus, clouds → houseBus. VBAP (Electron) path unchanged until MOTU routing is confirmed. OSC: `/monitor/volume` (pedal 0–1), `/house/volume` (volume pedal 0–2) with setTargetAtTime smoothing.
  - **Phase 2**: Already partially implemented — dropCloud() was already snapshotting merged params. Added curveType/direction/probability capture, plus Phase 4 preparation fields (grainOverrides: {}, morphT: 0.5, morphVelocity: 0).
  - **Phase 3**: Per-cloud distance-weighted volume in scheduleGrains cloud loop. `S.cloudMode` ('collage'|'nearest'), `S.cloudSnapFade` (0=snap, 1=crossfade). Inverse-distance weighting with configurable sharpness. Silent clouds still advance onset clock. OSC: `/cloud/mode`, `/cloud/snapfade`.
  - **Phase 4**: `updateGestureMorph()` in wand.js, called on every `/space/wand/inertial` tick (independent of wandConfig.enabled). Reads gyroMag, drives morphT on nearest cloud(s) via velocity accumulation. Agitation axis: period↓ pitchJitter↑ durJitter↑ fadeRatio↓ duration↓. Smooth axis: reverse. Momentum and elastic hold modes. Cloud.grainOverrides merged at scheduling time via Object.create prototype chain.
  - **Remaining**: UI controls (toggle buttons, sliders) not yet added — all features controllable via OSC. MOTU M2 routing for true monitor/house physical split needs hardware confirmation. Agitation delta values are first-draft estimates — tune after testing.
