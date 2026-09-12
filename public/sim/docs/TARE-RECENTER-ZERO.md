# Tare, Recenter & Spatial Alignment

> **Status: CURRENT** · reference · how mount calibration / heading zero / recenter relate, and which of them you can actually reach. Rewritten 2026-08-31 when the single Euler-space tare was replaced by two quaternion operations. The Recenter section carries its own warning — it describes design intent, not shipped behaviour.

Reference doc for how sensor calibration, drift correction, and VBAP spatialization relate to each other.

---

## Three reference frames

mubone has three independent spatial reference frames that must align for the system to feel correct:

1. **Sensor frame** — the IMU's idea of orientation. Raw quaternion output. Affected by mounting angle and drift.
2. **Viz frame** — the sphere's coordinate system. lon=0, lat=0 is front-center. The camera/cursor lives here.
3. **Speaker frame** — the VBAP field. 0° is front-center. Speakers are distributed around this.

The viz frame and speaker frame share the same 0° = front convention, so they're always aligned by definition. The sensor frame is the one that needs to be brought into agreement with the other two via tare.

---

## Two operations, not one

Calibration is **two** gestures on opposite sides of the sensor quaternion, and keeping them apart is the whole design:

```
output = conj(H) · q · conj(B)
```

| | **B — mount** | **H — heading** |
|---|---|---|
| answers | how does the sensor sit on the thing it is strapped to | which way is the stage |
| set | once per mounting — aim, then bow | whenever you like, one press |
| where | Settings → Sensors → **Mounting → Calibrate** | `` ` ``, the `tare` action, `/cursor/tare`, or **Heading → Zero heading** |
| stored | `slot.quatCal.mountQuat` | `slot.quatCal.headingQuat` |
| side | body (right) | world (left) |

Both live in `sensor-registry.js`, and **the sides are the design**. H is constrained to a pure rotation about world Z, so it **commutes** with a performer turning on the spot:

```
conj(H) · Rz(φ) · H · B · conj(B)  =  Rz(φ)
```

A turn therefore reads as yaw and nothing else, **at every mounting angle**. Put the mount on the left instead and the output frame becomes the *device's* rest frame, whose Z is the device's up rather than the world's — level mounts survive that because the two coincide, and a sensor worn vertically on a back reads a turn as **pitch**. That shipped once and is guarded by `scripts/sensor-audit.js` § G, which tests five named mountings plus 200 random ones.

### Mount calibration — a bow, counted in

Press **Calibrate** and follow the clock. Four steps, five seconds each:

1. *Get ready* — hold it as it will be worn, aimed the way you play
2. *HOLD — aimed forward*
3. *Now BOW it forward* — rotate it forwards, the way you would take a bow
4. *HOLD — bowed forward*

**It is the rotation that is measured, not two snapshots.** That distinction matters, because gravity alone gives only *up* — the azimuth of a level sensor is unknowable from any single sample, however long you hold it. Bowing forwards is the only way mubone can learn which horizontal direction is forward. Bow it sideways and forward is defined 90° off. This is information-theoretic, not a quirk of the method: something has to declare forward, and the rotation is the only thing that can.

| step | what it yields |
|---|---|
| hold 1 | gravity → the performer's **up**, in sensor coordinates |
| the bow | the rotation axis → the performer's **left-right**, with sign |

`up × left-right` gives forward — a full orthonormal frame, the true `B`. Then `H = twist(q₁ · conj(B))` is the real heading, because `B` is real.

**A countdown, not a stillness detector.** The first build advanced automatically when the sensor went still. It worked, and it was the wrong design: pressing Calibrate either silently advanced or silently did nothing, with no way to tell which while the sensor is on your back (Ek, 2026-08-31). A clock you can see beats cleverness you cannot. Each hold window is **averaged** rather than sampled once, so a wobbling hand contributes its mean, and a hold that drifted more than 8° says so instead of quietly producing a bad frame.

**Why two positions at all.** Splitting a single rest pose by its twist about world Z gives `H_est = twist(H_true · B)` — which absorbs whatever rotation about vertical the **strap itself** carries. The estimated heading is then wrong by that amount and the performer's pitch smears into roll by the same angle: measured 2026-08-31 at **95% cross-axis leak** on a flat inverted mount, ~55% on a twisted vertical one. A *turn* is immune, because `H` commutes with `Rz(φ)` whether or not it is the right `H` — which is how a suite that tested only turns passed a broken calibration twice.

It works for a hand, a rotated wrist, a head, a back, a tuba bell, and a strap with its own twist — `sensor-audit.js` § H drives all six and requires pitch to stay pitch and roll to stay roll. The bow also fixes the **sign**, so bowing forward is a negative pitch on every mounting and no polarity flip is needed to get there.

**The two sign flips are not yours to make.** `defaultQuatAxisMap()` ships pitch and yaw at `-1`, because `applyAxisMapQuat` decomposes Z-up (`quatToEulerDeg`, yaw about Z) and recomposes in the sphere's Y-up graphics convention (yaw about `(0,1,0)`, pitch about `(1,0,0)`, roll about `(0,0,1)`). That relabelling is mount-independent, so the correction belongs in the default once rather than in the player's hands on every mounting. Reset them to `+1` and every fresh calibration needs the same two manual flips — which is how the cause was found. Guarded by `sensor-audit.js` § I.

**Refused, rather than fudged:** a bow shallower than `MOUNT_POSE_MIN_DEG` (20°), or a rotation about *vertical* rather than a bow — there is no frame in either, and a calibration built from one would be worse than none.

### Zero heading

Face the audience and press. Re-derives **H only**, from `q · conj(B)` — how far the world has turned since the mount was calibrated. **B is untouched, so the mounting survives.**

**H is the yaw the app reads, not the swing-twist** (2026-09-10). `H = Rz(yaw(q · conj(B)))`, where yaw is `quatToEulerDeg`'s — the azimuth of the forward axis — so the cursor sits at lon 0 the instant after the press whatever the pitch and roll held. It was `twist(q · conj(B))` before, which is the heading only at a level pose: the swing left over has a yaw of its own once pitch and roll are both non-zero (0.9° at 10°/10°, 8° at 20°/45°), and near a 180° roll — an **uncalibrated upside-down mount** — the twist lives in two vanishing components, so 4° of pitch at zero time moved the residual by 72° and a zero landed at lon −69°. Pitch and roll after a zero are still the attitude actually held: it cannot level a tilted board, only a mount calibration can. `sensor-audit.js` § B2.

This is both your drift correction and your **speaker alignment**: the viz frame and the VBAP field share 0° = front, so setting the heading is what puts the performer's forward and the room's forward in the same place. Safe to bind to a key and press mid-set — which is exactly what `` ` `` does.

It is a **software** operation. The sensor is never written to, so it survives a sensor reset and cannot be persisted into the hardware in a state you can't clear.

### What happened to `captureTare`

Removed, along with `DeviceState.tareEuler`, `polarity` and `rollMute`. All four were applied in `getCalibratedQuat()` — **upstream** of the registry, so setting any of them changed the very quaternion the registry's calibration had been captured against, and the two composed instead of one replacing the other.

`tareEuler` in particular could never have done this job: it decomposed to Euler, subtracted yaw, then recomposed, and subtracting an angle **after** a decomposition cannot rotate the frame the decomposition was done in. Axis signs and roll mute now live in `slot.quatCal.axisMap`, which is applied *downstream* of B and H and therefore cannot disturb them.

## Zero heading on the hardware

The BNO's own `/BNO085/tare_sensor` is `tare_now(Axes::XYZ)` — a **mounting-alignment** command whose firmware docstring says outright that it is *"not for setting the direction of the stage"*. Don't use it for that. See `docs/BNO085-CONTROL.md` § 3.2: there is no `zero_heading` endpoint, no clear-tare, and a persisted tare survives `reset`.

The software heading zero above is better on every axis that matters here — instant, reversible, no flash wear, and it works with the magnetometer disabled, where a hardware Z-axis tare cannot be persisted at all.

## Recenter — deleted 2026-09-05

There was a third operation, **recenter**: a drift-offset quaternion composed onto the sensor every frame so the cursor snapped back to centre without re-taring. It had no caller from 2026-08-01 (the button was disabled pending #76, the auto path went with `slotTare`) and was deleted on 2026-09-05 (#170). The drift an IMU accumulates is in **yaw** — pitch and roll come from gravity and do not drift — and yaw is exactly what **Zero heading** corrects, so recenter was a second control for the one correction. `recenterCursor()` and `S.driftOffsetQ` are git history.

---

## Summary of operations

| Operation | What it does | Software / hardware | Where | Frequency |
|-----------|-------------|---------------------|-------|-----------|
| **Calibrate mounting** | Stores how the sensor sits on the body (`B`) | Software | Settings → Sensors → Mounting | Once per mounting |
| **Clear** | Drops `M`; the sensor reads raw again | Software | Settings → Sensors → Mounting | Rarely |
| **Zero heading** | Sets which way is forward (`H`); corrects yaw drift. Cannot move pitch or roll | Software | `` ` ``, the `tare` action, `/cursor/tare`, or Settings → Sensors → Heading | Freely, mid-set |
| **Axis signs / roll mute** | Flips a channel's direction, downstream of `B` and `H` | Software | Settings → Sensors, on the selected sensor | Setup |
| **Speaker config** | Sets channel count and layout | Software | Audio settings | Once per venue |
| `/BNO085/tare_sensor` | Mounting alignment **in the sensor**. Not for stage direction, no clear-tare, survives `reset` | **Hardware** | Settings → Sensors, instrument block | Avoid — see § Zero heading on the hardware |

---

## Per-sensor applicability

- **Cursor sensor:** both operations apply, plus recenter. This is the primary use case.
- **Frame sensor:** both apply. Heading zero corrects drift in the sphere's world rotation.
- **Gesture sensor:** mount calibration applies. Heading is meaningless for a stream that feeds the processing chain rather than a spatial view, and recenter does not apply either.

Calibration is **per slot**, keyed by slot name in `mubone_sensor_cal`, so two sensors on one rig are calibrated independently — which is the point when one is on a wrist and the other on a music stand.
