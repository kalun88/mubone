# Euler vs Quaternion Input — x-IMU3 Analysis

> Written Mar 28, 2025. Reference: [x-IMU3 User Manual v1.11](https://x-io.co.uk/downloads/x-IMU3-User-Manual-v1.11.pdf), mubone sensor-registry.js, TODO.md bugs #9, #75, #76.

---

## Context

We've hit a cluster of interrelated problems with the quaternion-based sensor pipeline: gravity-aware tare breaks on non-default axis maps, roll mute causes pole inaccuracies (bug #75, disabled in UI), mount axis configuration is hard to reason about, and recenter logic is unclear (bug #76, also disabled). These all stem from the complexity of working with quaternions that need to be decomposed, remapped, and recomposed.

The x-IMU3 can send Euler angles directly from its onboard AHRS instead of quaternions. This document analyses whether switching to Euler input would help with these issues, and proposes an architecture that supports both.

---

## What the x-IMU3 sends

The x-IMU3 runs its Madgwick/Fusion AHRS at a fixed 400 Hz internally. The `ahrs_message_type` device setting selects what gets transmitted:

| Value | Message type          | Content                                |
|-------|-----------------------|----------------------------------------|
| 0     | Quaternion (default)  | W, X, Y, Z (4 floats)                 |
| 1     | Rotation matrix       | 9 floats (3×3)                         |
| 2     | **Euler angles**      | **Roll, Pitch, Yaw (3 floats, degrees)** |
| 3     | Linear acceleration   | Quat + linear accel XYZ               |
| 4     | Earth acceleration    | Quat + earth accel XYZ                |

The Euler message (ASCII prefix `A`) sends three values: roll, pitch, yaw in degrees. These are derived on-sensor from the same internal quaternion — the x-IMU3 does the decomposition before transmitting.

The AHRS message rate is configurable via `ahrs_message_rate_divisor` (400 Hz ÷ divisor). Default divisor 8 = 50 msg/s.

### Relevant x-IMU3 device settings

- **`ahrs_axes_convention`**: Earth frame convention — NWU (default), ENU, or NED. Determines what "yaw = 0" means (north) and which way is up.
- **`axes_alignment`**: 24 permutations of ±X±Y±Z. Remaps the physical sensor axes to body axes *before* the AHRS runs. If the sensor is mounted sideways, this corrects for it at the hardware level.
- **`ahrs_message_type`**: Selects quaternion, rotation matrix, Euler, or acceleration output.
- **`ahrs_ignore_magnetometer`**: When true, heading drifts but avoids magnetic interference.

---

## Issue-by-issue analysis

### 1. Gravity-aware tare and off-kilter roll

**Current approach (quat):** `slotTare()` extracts only the yaw heading from the raw quaternion, stores it as `tareQuat`, and separately captures the roll offset (`tareRollOffset`) for later subtraction. The roll offset is subtracted before Euler decomposition in `applyAxisMapQuat()` (line 670) to prevent pitch↔yaw coupling from the tilted roll axis. This only works when X maps to roll (ZYX innermost rotation).

> **⚠ Update (Mar 28):** `slotTare()` now auto-selects between gravity-aligned tare (flat mount, X=roll) and full-quaternion tare (non-flat mount, Y/Z=roll). Full-quat tare captures the entire raw orientation — after tare the quaternion is near-identity at rest, so the Euler decomposition works cleanly for any mounting angle. This eliminates the "only works when X maps to roll" limitation for non-default mounts. The gravity-aligned path is unchanged for the default flat case. See `_isFlatMount()` in sensor-registry.js.

**With Euler input:** Tare becomes simpler — capture `(tareRoll, tarePitch, tareYaw)` and subtract. No conjugate multiplication, no decomposition order dependency, no roll-offset special case. Gravity alignment is already baked in by the AHRS.

**Caveat:** Simple Euler subtraction doesn't compose correctly for large rotations. Yaw wrapping (tare at 170°, rotate to -170° = naïve diff of -340° instead of +20°) needs explicit angle wrapping. Pitch is bounded ±90° and roll ±180°, each with different wrapping rules. This is solvable but introduces a new class of edge cases. Quaternion conjugate multiplication handles this automatically.

**Verdict:** Euler tare is easier to implement and debug for typical performance ranges. For extreme rotations, angle wrapping adds complexity but is still more transparent than the current roll-offset subtraction hack. *(Note: with the full-quat tare fix above, the quat path now handles non-flat mounts correctly too — Euler input is no longer the only solution for this issue.)*

### 2. Roll mute causing pole inaccuracies (bug #75)

**The problem:** When roll is muted/unmapped, `applyAxisMapQuat()` uses a forward-vector path that bypasses Euler decomposition. This path has a coordinate-system mismatch that prevents pitch from reaching ±90° and causes yaw instability near poles. The roll mute button is disabled in the UI because of this.

**Would Euler input fix this?** No. The fundamental issue is gimbal lock in the Euler representation itself. When pitch approaches ±90°, yaw and roll become degenerate — they rotate around the same axis. Whether the x-IMU3 decomposes the quaternion or our JS does, the same singularity exists. The sensor's Euler values will jump erratically near poles regardless.

The current Euler path (path 2, all three axes active) already handles poles well. The problem is exclusively in the 2-DOF case (roll muted). See the "Proposed fixes for 2-DOF gimbal lock" section below for approaches.

**Verdict:** Euler input doesn't help with this specific bug.

### 3. Mount axis configuration complexity

**Current approach:** Receive quat → decompose to Euler → remap axes (axisMap table) → recompose to quat. Three coordinate transforms, hard to debug.

**With Euler input:** Receive Euler → remap axes. No decomposition, no recomposition. Every value is human-readable at every step. The signal path is half as long.

**Note on x-IMU3 `axes_alignment`:** The sensor's 24-permutation `axes_alignment` setting could handle mount remapping at the hardware level. However, we prefer keeping axis remapping in mubone software rather than baking it into the sensor. During experimentation we remount sensors frequently and need to change the mapping quickly from the mubone UI without having to reconfigure the x-IMU3 device settings each time. The x-IMU3 `axes_alignment` should stay at default (+X+Y+Z) and all remapping should happen in mubone's sensor panel.

**Verdict:** Euler input significantly simplifies the axis remap path and makes it inspectable. Software-level axis control is preferred over hardware `axes_alignment`.

### 4. Debugging and readability

**Current state:** When something goes wrong, you're staring at quaternion values like `[0.183, -0.412, 0.707, 0.541]` trying to figure out if pitch is coupled to yaw.

**With Euler input:** You see `roll: 12.3, pitch: -45.2, yaw: 178.4` and immediately know what's happening. The entire tare/remap pipeline is inspectable without mental quaternion math. Raw values in the sensor panel UI become meaningful. Axis map calibration (rotate left/right, check which channel moves) becomes trivially obvious.

**Verdict:** Strongest argument for Euler input. Debugging and calibration become dramatically easier.

---

## Recommended architecture

**Don't switch away from quaternions as the internal representation.** The renderer, sphere transforms, frame/cursor cancellation, and delta rotation paths all need quaternions. The existing Euler path (path 2 in `applyAxisMapQuat`) works well when all three axes are active.

**Add a `/euler` OSC input path** alongside `/quaternion`. The data flow:

```
/sensor/{name}/euler  [roll, pitch, yaw]  (degrees)
  → store raw euler on slot
  → apply tare (subtract + angle-wrap)
  → axis remap (simple viz assignment, sign flip)
  → convert tared/remapped euler to quaternion
  → feed into existing S.camQ / S.frameQ pipeline
```

Everything downstream of the euler→quat conversion stays exactly the same. The renderer, sphere, grain scheduler, frame cancellation — all unchanged.

### What changes in sensor-registry.js

1. **New handler:** `handleSlotEuler(slot, values)` — receives `[roll, pitch, yaw]` in degrees, stores as `slot.rawEuler`.
2. **Euler tare:** `slotTareEuler()` captures `(tareRoll, tarePitch, tareYaw)`. Apply via subtraction + angle wrapping.
3. **Euler axis remap:** Same axisMap table, but operates directly on the three Euler values. No quat decomposition needed.
4. **Euler→quat conversion:** Standard `eulerToQuat(roll, pitch, yaw)` at the end, feeding into the same `getSensorCamQ()` output path.
5. **OSC address:** `/sensor/{name}/euler` → dispatches to `handleSlotEuler()`.

### What stays the same

- `getSensorCamQ()`, `getSensorRawCursorQ()`, `getFrameQ()` — all still return quaternions.
- Renderer, sphere.js, grain.js — no changes.
- Frame/cursor cancellation — still quaternion multiply.
- Delta rotation path — still uses raw quaternion (for sensors that send quat).
- Existing `/quaternion` OSC path — unchanged, both paths coexist.

### Slot-level format tracking

Each sensor slot should track which format it's receiving:

```javascript
slot.inputFormat = 'quat' | 'euler';  // set on first message arrival
```

This lets the UI show the right calibration interface (e.g. Euler tare vs quaternion tare) and lets the code choose the right processing path.

---

## Current pole handling: the yaw-hold hack (what exists now)

When roll is muted, `applyAxisMapQuat()` takes the forward-vector path (lines 630–655 in sensor-registry.js). This path has an existing attempt at pole handling that is **neither** of the proposed fixes below — it's a partial workaround with known problems.

**How it works:** The forward physical axis (freed up by muting roll) is rotated by the quaternion into world space via `forwardVecFromQuat()`. Yaw and pitch are then extracted: `yaw = atan2(fy, fx)`, `pitch = asin(-fz)`. When the XY projection length (`xyLen`) drops below 0.15, the code freezes yaw to its last known value (`_axisMapLastYaw`) instead of computing a new one, because `atan2` becomes unstable when both `fx` and `fy` approach zero.

**Why pitch can't reach the pole:** The decomposition `pitch = asin(-fz)` should reach ±90° when `fz → ±1`, but there's a coordinate-system mismatch between the forward axis and the assumed rest orientation. The forward vector computation assumes the freed physical axis points along a direction where the XY/Z decomposition cleanly separates yaw from pitch. If the forward axis doesn't align with that assumption (which depends on which physical axis is freed and how the sensor is mounted), pitch maxes out below 90° and the remaining rotation bleeds into yaw — causing the spinning.

**Why the cursor spins near the pole:** The 0.15 threshold for yaw-hold is a hard cutoff. As you approach the pole, `xyLen` oscillates around 0.15 due to sensor noise, so the cursor alternates between normal tracking (computing yaw from noisy near-zero values) and frozen yaw. This creates the erratic spinning/jittering behaviour. The yaw-hold also has no blending — it snaps between "tracking" and "frozen" rather than smoothly transitioning.

**In summary:** The existing code tries to mask the pole problem with a yaw freeze, but (a) pitch can't actually reach 90° due to coordinate assumptions, and (b) the hard threshold creates jitter rather than preventing it. Neither Approach A nor Approach B below is currently implemented.

---

## Proposed fixes for 2-DOF gimbal lock (roll muted, bug #75)

The pole problem when roll is muted is a fundamental Euler/gimbal-lock issue, not a data format issue. Two approaches to explore:

### Approach A: Pitch clamp

When roll is muted, clamp pitch to a range short of ±90° (e.g. ±85°). This keeps yaw stable by preventing the singularity from being reached.

**Pros:** Simple to implement — a single `clamp()` call in the axis remap output. Predictable behaviour. No new math.

**Cons:** The performer can't point straight up or straight down. For a spatial instrument on a sphere, this means the poles are unreachable. The 5° dead zone is small but could be audible/noticeable if the performer expects to reach the top/bottom of the sphere.

**Implementation:** In `applyAxisMapQuat()` forward-vector path (or the future Euler input path), after computing pitch:
```javascript
const PITCH_CLAMP = 85;  // degrees
pitch = Math.max(-PITCH_CLAMP, Math.min(PITCH_CLAMP, pitch));
```

Could be configurable via a setting if performers need to tune the dead zone size.

### Approach B: Delta/incremental rotation path

`getSensorRawCursorQ()` already provides the cursor quaternion after tare but *before* axis-map/Euler decomposition. The renderer can use this for incremental (delta-based) rotation, which avoids gimbal lock entirely because deltas between consecutive frames are always small angles.

The idea: instead of decomposing the absolute orientation to Euler and remapping, compute the *change* in quaternion since last frame (`delta = conj(prevQ) * currQ`), decompose *that* small-angle delta to Euler (safe — small angles never hit poles), apply axis remap and sign flips to the delta, recompose to a delta quaternion, and accumulate into the camera orientation.

**Pros:** Completely avoids gimbal lock. Works at all orientations including poles. Roll mute is trivial — just zero out the roll component of the delta. No dead zones, no clamping. Mathematically clean.

**Cons:** Drift — small floating-point errors accumulate over time since you're integrating deltas rather than using absolute orientation. Tare becomes "reset accumulated rotation to identity" rather than capturing a reference. The renderer already has a delta path for surface/trackpad mode; extending it to sensor mode means maintaining two rotation accumulation strategies. More complex to reason about than absolute orientation.

**Implementation sketch:**
```javascript
// Each frame:
const currQ = applyTare(slot.quat, slot.quatCal.tareQuat);
const prevQ = slot._prevTaredQ || currQ;
slot._prevTaredQ = currQ;

// Small-angle delta — safe to decompose
const delta = qMulQ(qConj(prevQ), currQ);
const dEuler = quatToEulerDeg(delta[0], delta[1], delta[2], delta[3]);

// Apply axis remap to the delta
const mapped = applyAxisMapToEuler(dEuler, slot.quatCal);

// Zero roll if muted — this is now safe!
if (rollMuted) mapped.x = 0;

// Convert remapped delta back to quat
const dQ = eulerToQuat(mapped.x, mapped.y, mapped.z);

// Accumulate
slot._accumulatedQ = qMulQ(slot._accumulatedQ || [0,0,0,1], dQ);
// Normalize periodically to prevent drift
slot._accumulatedQ = qNormalize(slot._accumulatedQ);
```

**Drift mitigation:** Periodic re-normalization of the accumulated quaternion. Could also blend the accumulated orientation toward the absolute orientation on a slow time constant (e.g. 1-2 second exponential) to bound long-term drift while preserving frame-to-frame smoothness.

### Recommendation

Explore both. Approach A (pitch clamp) is a quick win that could re-enable the roll mute button immediately. Approach B (delta rotation) is the proper long-term fix and would also solve bug #9 (surface mode yaw after pole). They're not mutually exclusive — Approach A can serve as a fallback if Approach B's drift proves problematic in practice.

---

## Other sensors (future-proofing)

Some off-the-shelf sensors only send Euler angles (no quaternion option). The `/euler` OSC path would support these directly. The architecture should be format-agnostic at the slot level — a sensor sends whatever it sends, mubone handles it.

Potential OSC address scheme:
```
/sensor/{name}/quaternion   [qx, qy, qz, qw]    — existing
/sensor/{name}/euler        [roll, pitch, yaw]    — new
/sensor/{name}/inertial     [gx, gy, gz, ax, ay, az]  — existing (unchanged)
```

---

## Summary

| Issue | Euler helps? | Notes |
|-------|-------------|-------|
| Gravity-aware tare | Yes — simpler | Subtract + wrap vs conjugate multiply + roll offset hack. *(Partially addressed: full-quat tare now handles non-flat mounts on the quat path too.)* |
| Roll mute pole bug (#75) | No | Gimbal lock is intrinsic to Euler; fix via pitch clamp or delta rotation |
| Mount axis config | Yes — much simpler | Direct remap on 3 readable values vs decompose/remap/recompose |
| Debugging | Yes — dramatically | Human-readable values at every pipeline stage |
| Future sensor compat | Yes | Supports Euler-only sensors out of the box |

**Bottom line:** Add `/euler` as an input format. Keep quaternions as the internal representation. Both formats coexist, per-slot. The Euler path simplifies tare, axis mapping, and debugging for the common case. The pole/roll-mute bug needs a separate fix (pitch clamp and/or delta rotation) regardless of input format.
