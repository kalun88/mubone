# Sensor Mounting & Calibration

> **Status: CURRENT** · reference · physical mounting + axis alignment. Unaffected by the 1.11 changes.

How to set up two sensors in different physical orientations — one as **cursor** (hand), one as **frame** (body reference) — so they agree in the visualization.

---

## Why mounting matters

After tare, the sensor reports rotation relative to its pose at tare time — expressed in its **local axes at that moment**. A sensor pointing forward and a sensor pointing up have different local axes, so the same body movement (e.g. yaw) shows up on different Euler channels. The per-sensor axis map fixes this.

## Setup steps

### 1. Mount the sensors

Attach each sensor in its performance position. Typical setups:

- **Cursor** — wrist or hand (pointing roughly forward)
- **Frame** — chest, belly, belt clip, or music stand (may point up, forward, or sideways)

Orientation doesn't need to be precise. The calibration below handles any mounting angle.

### 2. Assign roles

In the sensor panel, assign one quaternion stream to **cursor** and the other to **frame**.

### 3. Tare both sensors

Stand in your neutral "home" pose (the orientation you want to be center/origin in the viz) and tare both sensors. This zeros each sensor to its own mounted orientation. Order doesn't matter — just hold still while you tare.

### 4. Calibrate the mounting

**This replaces the per-channel axis mapping this section used to describe.** That control was documented here for months and never existed in the panel — `DeviceState` held signs only, and the channel map lives in the registry, which had no UI at all. Worse, it was the wrong tool: a mounting is an arbitrary rotation, and no assignment of three channels to three axes with three signs can express one. Only the 24 right-angle cases, which is not where a strap ends up.

Instead, for each sensor:

1. **Settings → Sensors → Mounting → Calibrate**, then follow the countdown.
2. Hold it **as it will be worn, aimed the way you play**.
3. **Bow it forwards** — rotate it the way you would take a bow — and hold.

The bow is the measurement, not two snapshots: gravity gives only *up*, so bowing forwards is the only way mubone can learn which way forward is. Bow it sideways and forward lands 90° off. A single position cannot work at all — it cannot separate the strap's own twist about vertical from which way you are facing, so pitch comes out mixed into roll. See `docs/TARE-RECENTER-ZERO.md`. Done this way it works at any angle: wrist rotated to taste, head, back, a clip on a tuba bell.

Then, separately, **face the audience and press `` ` ``** to zero the heading. Do that as often as you like; it cannot disturb the mounting.

### 5. Check the directions, and flip signs if needed

With the frame correct, anything still backwards is a genuine one-bit problem:

- pitch up → cursor moves toward the **blue** (upper hemisphere)
- twist → the **horizon rolls**, the cursor does not translate
- turn → the cursor sweeps along the **ivory equator**

Flip the offending axis in the sensor's polarity row. Those write `slot.quatCal.axisMap`, downstream of the mount and heading rotations, so they cannot invalidate the calibration.

**If sign-flipping does not converge, stop flipping.** A rotated reference frame is not a one-bit problem and no sequence of sign changes can fix it — recalibrate the mounting instead. That distinction cost a full debugging session on 2026-08-31; `docs/TARE-RECENTER-ZERO.md` has the reasoning.

## Quick reference

| Step | What to do |
|------|-----------|
| Mount | Attach sensors in performance positions |
| Roles | Assign cursor + frame in sensor panel |
| Tare | Stand neutral, tare both |
| Axis map | Test one axis at a time, map channel → viz axis, fix signs |
| Verify | Stack both, move together — viz shouldn't move |

## Notes

- **Re-tare any time** you reposition a sensor or notice drift.
- Cursor and frame will almost always have **different axis maps** — that's expected.
- The axis map is saved per sensor slot in localStorage, so it persists across reloads.
- Tare is not saved — you need to re-tare each session (it depends on the sensor's absolute orientation at startup).
