# Sensor Mounting & Calibration

> **Status: CURRENT** · reference · physical mounting + calibration. Roles reconciled 2026-10-04 (frame back beside camera).

How to set up two sensors in different physical orientations — one as **cursor** (hand), one as **frame** (the body or a turntable the cursor is read relative to) or **camera** (pans and tilts the view) — so they agree in the visualization.

---

## Why mounting matters

A sensor reports rotation in its **own axes**. A sensor pointing forward and a sensor pointing up have different axes, so the same body movement (e.g. a turn) shows up on different Euler channels. The per-sensor mount calibration (step 4) fixes this. For a frame sensor it matters more than anywhere: the frame's WHOLE rotation is taken out of the cursor, so an uncalibrated frame worn upright on a chest reads as a 90° bow and carries the cursor 90° with it.

## Setup steps

### 1. Mount the sensors

Attach each sensor in its performance position. Typical setups:

- **Cursor** — wrist or hand (pointing roughly forward)
- **Frame** — chest, belly, belt clip, or a turntable / lazy susan (may point up, forward, or sideways)
- **Camera** — a projector, the head, or the body, if the view should follow it instead

Orientation doesn't need to be precise. The calibration below handles any mounting angle.

### 2. Assign roles

Settings → Sensors → Role: one sensor **cursor**, the other **frame** (or **camera**). All three at once works: the cursor read relative to the frame, the view the camera's.

### 3. Zero the heading

Stand in your neutral "home" pose, facing the audience, and press `` ` ``. It zeroes the heading of every sensor holding a role at once, so cursor and frame agree on forward.

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

Flip the offending axis with its polarity button on the Sensors page. Those write `slot.quatCal.signs`, downstream of the mount and heading rotations, so they cannot invalidate the calibration.

**If sign-flipping does not converge, stop flipping.** A rotated reference frame is not a one-bit problem and no sequence of sign changes can fix it — recalibrate the mounting instead. That distinction cost a full debugging session on 2026-08-31; `docs/TARE-RECENTER-ZERO.md` has the reasoning.

## Quick reference

| Step | What to do |
|------|-----------|
| Mount | Attach sensors in performance positions |
| Roles | Cursor + frame (or camera) on the Sensors page |
| Mounting | Calibrate each sensor: aim, then bow forwards |
| Heading | Face the audience, press `` ` `` — zeroes both |
| Verify | With a frame: stack both, turn and tip them together — the cursor shouldn't move |

## Notes

- **Re-zero the heading any time** you notice drift; re-calibrate the mounting when you reposition a sensor.
- Cursor and frame will almost always have **different mountings and signs** — that's expected.
- Mounting, heading and signs are saved per sensor slot (`mubone_sensor_cal`), so they persist across reloads — but the heading depends on where each sensor thinks north is at boot, so zero it every session.
- A frame sensor that goes silent stops counting after 2 s: the cursor falls back to the world one rather than freezing on the frame's last pose.
