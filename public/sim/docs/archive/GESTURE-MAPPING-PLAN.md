# Gesture Mapping — Tier 2 Design

> **Status: ARCHIVED / HISTORICAL.** This plan or audit is complete — kept as the record of what was decided, what changed, and how to revert it. **It does not describe current behaviour** and may use superseded terminology. Do not use it to learn how the system works today; read the reference docs listed in CLAUDE.md instead.

> **Note (2026-04-23):** Written against the old `wand.js` / `ui-wand.js` architecture. The Mar 28 sensor-registry refactor deleted those files and moved the mapping engine to `sensor-mapping.js` and the morph helpers to `seed-morph.js`. References below have been updated to the current module names, but the overall plan predates the refactor — verify against the code before implementing.

## Where we are

The gesture chain (gesture.js) runs every inertial tick and produces:

| Feature | Range | What it captures |
|---|---|---|
| smoothness (motion) | 0–1 | How much you're moving — slow EMA of gyro magnitude |
| effort | 0–1 | Velocity + acceleration combined — how hard you're working |
| directness | 0–1 | Net displacement / total path — straight line vs wandering |
| periodicity | 0–1 | Autocorrelation — are you repeating a gesture? |
| periodicityHz | Hz | Detected repetition frequency |
| accumulatedEnergy | 0–1 | Leaky integrator of effort — builds up, decays slowly |
| jerk | deg/s² | Rate of change of gyro magnitude — abruptness |

Plus the **radial joystick** (pitch × roll gyro → 2D position with physics):

| Signal | Range | What it captures |
|---|---|---|
| joyX | −1 to +1 | Roll-driven lateral position (wrist twist) |
| joyY | −1 to +1 | Pitch-driven vertical position (nod/wave) |
| joyDist | 0–1 | Distance from center (dead zone applied) |
| joyAngle | radians | Direction from center |

These are all conditioned (dead zone, curve, smoothing) and written to `S.gesture` and `S.gestureJoy`. **Nothing reads them yet** — they're computed and visualized but don't drive any audio.

The radial is especially interesting because pitch/roll gyro captures *movement direction independent of orientation*. You can face any direction, be standing or sitting, and slow roll right always means the same thing. It's body-relative movement quality, not pointing direction.

---

## What needs to happen (tier 2)

Conditioned gesture features → synthesis parameter destinations. The gesture page is the natural home for this UI — it already shows the live feature values and conditioning controls.

---

## Architecture

### Dispatch model

A new function `applyGestureMapping()` runs every frame after `S.gesture` is updated. It reads the mapping config, reads conditioned feature values, and writes to synthesis parameters using the same `applyParam()` mechanism from `sensor-mapping.js` (writes to `S.grainOverrides`, `S.searchRadiusDeg`, etc.).

This is *separate* from the sensor mapping system. Sensor mapping maps euler orientation (where you're pointing). Gesture maps movement quality (how you're moving). They can coexist — gesture writes first as a baseline, sensor mapping layers on top if enabled.

### Mapping config on S

```js
S.gestureMapping = {
  // Scalar feature → single param mappings
  features: {
    smoothness: { param: 'none', outMin: null, outMax: null, invert: false },
    effort:     { param: 'none', outMin: null, outMax: null, invert: false },
    directness: { param: 'none', outMin: null, outMax: null, invert: false },
    periodicity:{ param: 'none', outMin: null, outMax: null, invert: false },
    energy:     { param: 'none', outMin: null, outMax: null, invert: false },
  },

  // Radial joystick → preset interpolation
  radial: {
    mode: 'off',         // 'off' | 'nearest' | 'bilinear' | 'pinned'
    pins: [],            // for 'pinned' mode — see below
    presetTL: -1,        // for 'bilinear' — four corners
    presetTR: -1,
    presetBL: -1,
    presetBR: -1,
    presetCenter: -1,    // optional center point (5-point interp)
    trailPersist: false, // leave movement trail on for placement help
    trailDecay: 30,      // seconds before trail fades (0 = permanent)
  },
};
```

### Persistence

Stored on `S` and saved/loaded alongside presets or as a separate localStorage key (`mubone_gesture_mapping`). Independent of preset slots — the gesture mapping is a performance config, not a per-patch thing (though we could revisit that).

---

## Feature → parameter mapping (scalar features)

Each conditioned feature (0–1) maps to one synthesis parameter. Simple dropdown per feature in the gesture page, same parameter list as `sensor-mapping.js` `PARAM_DEFS`:

- duration, period, searchRadiusDeg, pitchJitter, panSpread, volume, fadeRatio, k, probability, durJitter, durVar, periodVar

Plus potential new destinations as they emerge (filter cutoff, spatial width, etc.).

### Examples of useful mappings

| Feature | → Parameter | Musical result |
|---|---|---|
| smoothness | duration | Moving more = longer grains, stillness = short choppy |
| effort | pitchJitter | Harder motion = more pitch scatter, gentle = pure |
| periodicity | period | Repetitive gesture syncs grain rate to gesture rhythm |
| energy | searchRadiusDeg | Built-up energy widens the grain search — more variety |
| directness | panSpread | Straight lines = focused spatial image, wandering = wide |

The point is the performer discovers what feels right — these are just starting points.

---

## Radial preset interpolation

The radial joystick (pitch × roll) is the most expressive 2D space. Three modes for how it drives presets:

### Mode 1: Bilinear (simple)

Same math as the sensor mapping's `xy2d` but driven by the gesture radial instead of euler angles. Pin four presets at corners, optional center. `lerpPresets5()` already exists in `seed-morph.js`.

Good starting point. Limitation: the presets are at fixed corners — doesn't match how you actually move.

### Mode 2: Nearest-neighbor blend

Place N presets anywhere on the radial (not just corners). The joystick position blends presets weighted by inverse distance. Closer presets dominate.

```
weight_i = 1 / (distance_i ^ falloff)
normalized_weight_i = weight_i / sum(all weights)
output = sum(preset_i * normalized_weight_i)
```

This is more flexible — you can cluster presets in one region or spread them around. A `falloff` parameter (1–4) controls how sharply it transitions.

### Mode 3: Pinned (learned placement)

This is the creative one. Instead of manually placing presets at coordinates, the system watches where you go and helps you place them.

**How it works:**

1. **Trail persistence** — turn on `trailPersist` and the movement trail stays visible on the radial (currently it fades after ~1.5s). You play for a while, see the full territory of your movement as a heat trail.

2. **Pin a preset** — while the trail is showing, tap a preset slot and tap a position on the radial (or press a key at the current joystick position). That preset gets pinned at those coordinates. The trail helps you see where your natural resting points and movement corridors are.

3. **Auto-suggest** — the system tracks a density map of where the joystick spends time. After enough data, it highlights "hotspots" — natural attractors in your movement. You can pin presets at the suggested spots with one tap. The suggestions update as you play.

4. **Interpolation** — same nearest-neighbor blend as mode 2, but the pin positions came from your actual movement patterns rather than abstract grid corners.

**Why this is powerful:** Every performer moves differently. A cellist's pitch/roll space looks nothing like a trumpet player's. Instead of mapping to a generic grid, the system adapts to *your* movement vocabulary. The presets end up at positions that correspond to real physical gestures — not arbitrary coordinates.

---

## Movement density and trail visualization

The radial already draws a fading trail. We extend this:

### Persistent trail

Toggle that keeps the trail visible (with slow decay or permanent). The trail draws as a path with opacity proportional to how recently the joystick visited. Useful for:
- Seeing your full movement range
- Identifying movement corridors and attractors
- Deciding where to pin presets

### Density heatmap

Behind the trail, a low-resolution density grid (e.g. 16×16) accumulates time spent at each position. Rendered as a subtle glow — brighter where you spend more time. This reveals:
- Natural resting positions (home base)
- Preferred movement corridors
- Regions you never visit (dead zones)

### Hotspot detection

Simple peak-finding on the density grid. When the density at a cell exceeds a threshold and is a local maximum, mark it as a hotspot. Display as a small ring or pulse on the radial. These are suggested preset pin positions.

The density grid decays slowly (configurable), so it adapts if your movement changes over the course of a performance.

---

## Creative extensions

### Confidence / conviction signal

Combine multiple features into a meta-signal:
- High effort + high directness + moderate speed = confident, decisive gesture
- Low effort + low directness + high periodicity = meditative, repetitive
- High effort + low directness = searching, uncertain

This "confidence" value could gate the strength of the gesture mapping itself — when you're moving with conviction, the mapping responds strongly. When you're tentative, it stays closer to the current preset.

```js
confidence = effort * 0.4 + directness * 0.3 + smoothness * 0.3
mappingStrength = baseStrength * confidence
```

### Gesture memory (movement signatures)

Track characteristic gesture shapes over short windows (1–3s):
- **Circle** — consistent periodicity + cycling through radial angles
- **Sweep** — high directness + covering distance
- **Shake** — high effort + low directness + high frequency
- **Settle** — decreasing energy, converging to a point
- **Burst** — sudden jerk spike from stillness

These don't need ML — they're detectable with threshold logic on existing features. Each signature could trigger a discrete event (switch mode, capture buffer, reset energy) rather than continuous mapping.

### Momentum in the mapping space

The radial joystick already has physics (inertia, friction, spring return). Extend this to the mapping output: when the joystick is moving fast through preset space, the interpolation "overshoots" slightly — grains get more extreme than the position would suggest. When it's settled, the mapping is precise. This makes the instrument feel alive — it has momentum like a physical resonator.

### Radial zones

Divide the radial into regions (concentric rings, pie slices, or arbitrary shapes) that trigger different *behaviors* rather than just interpolating presets:
- Inner ring: current preset, no morphing (safe zone)
- Middle ring: continuous interpolation between pinned presets
- Outer ring: parameter scatter — randomize within range proportional to edge distance
- Specific quadrant: engage rhythmic sync (periodicity drives grain timing)

### Time-varying mapping

Let the gesture mapping itself evolve. accumulatedEnergy is already a slow-moving integrator — it could modulate the mapping config:
- Low energy (beginning of performance): simple 1:1 feature→param mappings
- Building energy: radial preset interpolation kicks in
- High energy (peak): mapping responds more aggressively, wider parameter ranges
- Energy decay (wind-down): mapping gradually returns to neutral

---

## Implementation order

### Phase 1 — Scalar feature mapping
- Add `S.gestureMapping.features` config
- Add destination dropdown per feature in gesture panel (reuse PARAM_DEFS from `sensor-mapping.js`)
- Add `applyGestureMapping()` dispatch function
- Wire into the frame loop (after gesture update, before render)
- Persist to localStorage

### Phase 2 — Radial preset interpolation (bilinear)
- Add preset selector for four corners + center in gesture panel
- Wire `S.gestureJoy` → `lerpPresets5()` → `applyLerpedPreset()`
- Toggle between radial-drives-presets vs radial-is-just-viz

### Phase 3 — Persistent trail + density
- Trail persistence toggle
- Density grid accumulation + rendering
- Trail decay setting

### Phase 4 — Pinned presets + hotspot suggestions
- Click-to-pin on radial
- Nearest-neighbor blend
- Hotspot detection from density grid
- Auto-suggest UI

### Phase 5 — Creative extensions
- Confidence meta-signal
- Gesture signatures (circle/sweep/shake/settle/burst detection)
- Momentum overshoot
- Radial zones
- Time-varying mapping via energy

---

## Open questions

1. **Per-preset or global?** Is the gesture mapping config per-preset-slot or one global config? Global seems right for now — it's about your movement vocabulary, not the current patch. But "save mapping with preset" could be useful for prepared performances.

2. **Gesture + sensor mapping conflict resolution.** If both gesture and sensor mapping try to write the same parameter, who wins? Options: last-write-wins (sensor mapping runs after gesture, so sensor mapping wins), additive (gesture sets baseline, sensor mapping adds delta), or priority system. Simplest start: gesture writes first, sensor mapping overwrites. Avoid conflicts by not mapping the same param in both.

3. **Feature count.** Five conditioned features + radial XY might be too many simultaneous mappings. In practice, performers will probably use 2–3 at most. The UI should make it easy to leave things on "none."

4. **Conditioning UI placement.** The conditioning controls (dead zone, curve, smoothing) currently live in the gesture panel. The mapping destinations would go next to them. Should conditioning and mapping be on the same page, or should conditioning stay separate (it's about signal quality) and mapping be a new section below?
