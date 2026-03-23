# Sensor Mounting & Calibration

How to set up two BNO085 IMUs in different physical orientations — one as **cursor** (wand/hand), one as **frame** (body reference) — so they agree in the visualization.

---

## Why mounting matters

After tare, the sensor reports rotation relative to its pose at tare time — expressed in its **local axes at that moment**. A sensor pointing forward and a sensor pointing up have different local axes, so the same body movement (e.g. yaw) shows up on different Euler channels. The per-sensor axis map fixes this.

## Setup steps

### 1. Mount the sensors

Attach each sensor in its performance position. Typical setups:

- **Cursor** — wrist, hand, or wand (pointing roughly forward)
- **Frame** — chest, belly, belt clip, or music stand (may point up, forward, or sideways)

Orientation doesn't need to be precise. The calibration below handles any mounting angle.

### 2. Assign roles

In the sensor panel, assign one quaternion stream to **cursor** and the other to **frame**.

### 3. Tare both sensors

Stand in your neutral "home" pose (the orientation you want to be center/origin in the viz) and tare both sensors. This zeros each sensor to its own mounted orientation. Order doesn't matter — just hold still while you tare.

### 4. Configure axis maps (one axis at a time)

Each sensor has its own axis map: three physical channels (x, y, z) each mapped to a viz axis (yaw, pitch, roll) with a sign (±) and mute toggle.

For each sensor independently:

1. **Yaw** — rotate your body left/right. Watch the live Euler readout and note which channel (x, y, or z) moves the most. Map that channel → `viz yaw`. If the direction is inverted, flip the sign.

2. **Pitch** — nod up/down. Find the channel that moves, map it → `viz pitch`. Check sign.

3. **Roll** — tilt head/body side to side. Map the moving channel → `viz roll`. Check sign.

If a channel doesn't map to anything useful, mute it.

### 5. Verify with the stacked test (optional)

Place both sensors together, tare both, and move them as a unit. The viz should stay perfectly still — cursor and frame cancel. If it drifts at large angles, an axis map is wrong (likely a sign flip or axis swap).

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
