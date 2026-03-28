# Tare, Recenter & Spatial Alignment

Reference doc for how sensor calibration, drift correction, and VBAP spatialization relate to each other.

---

## Three reference frames

mubone has three independent spatial reference frames that must align for the system to feel correct:

1. **Sensor frame** — the IMU's idea of orientation. Raw quaternion output. Affected by mounting angle and drift.
2. **Viz frame** — the sphere's coordinate system. lon=0, lat=0 is front-center. The camera/cursor lives here.
3. **Speaker frame** — the VBAP field. 0° is front-center. Speakers are distributed around this.

The viz frame and speaker frame share the same 0° = front convention, so they're always aligned by definition. The sensor frame is the one that needs to be brought into agreement with the other two via tare.

---

## Tare (sensor calibration)

**What it does:** Stores the current sensor quaternion as the reference orientation. All subsequent readings are expressed relative to this pose: `conj(Q_tare) * Q_current`.

**When to use:** Once per session, or whenever the sensor is remounted. Hold the sensor in the position you consider "front-center" and press tare.

**What it defines:**
- The sensor's identity orientation (no rotation = the tare pose)
- The center of the viz — the tare pose maps to lon=0, lat=0 on the sphere
- By extension, alignment with the VBAP field — lon=0 maps to 0° in the speaker layout

**Facing direction matters.** When you tare, face where you consider "front of the room" to be. This is NOT necessarily where speaker 1 is — it's the center of the spatial field. For stereo, front is the phantom center between L/R speakers. For multi-channel, front is the geometric center of the speaker array.

**Tare does not change the speaker layout.** Speakers are configured independently (equal spacing from 0° for standard layouts). Tare aligns the sensor to the existing speaker field.

---

## Recenter (drift correction)

**What it does:** Applies a persistent offset to the sensor→camera pipeline so the cursor snaps back to the center reference point (lon=0, lat=0) defined at tare time.

**When to use:** During performance, whenever you notice drift. Physically return your hand to the tare position and press recenter. The view corrects to match your physical position.

**How it differs from tare:**
- Tare resets the full sensor reference frame — it redefines what "zero" means
- Recenter preserves the existing tare and just applies a small rotational offset to compensate for accumulated IMU drift
- Tare is a calibration step; recenter is a correction step

**Mechanically:** `correctedCamQ = driftOffset * sensorCamQ`. On recenter, the system computes the rotation between the current camera direction and the stored center reference, stores that as `driftOffset`, and applies it every frame going forward.

**Recenter does not move particles.** It adjusts the camera/view, not the world. From the performer's perspective, the cursor jumps back to center — which is correct because your hand IS physically at center.

---

## Center reference marker

A visual indicator on the sphere showing where lon=0, lat=0 is — the point defined at tare time. Its purpose is to let the performer see how far drift has accumulated. If the center marker is far from where the cursor rests when you return to the tare pose, it's time to recenter.

---

## VBAP speaker layout

Speakers are positioned automatically based on channel count:

| Channels | Layout |
|----------|--------|
| 1 (mono) | 0° (front) |
| 2 (stereo) | 270° (left), 90° (right) — no speaker at front, phantom center |
| 3+ | Equal spacing starting from 0° — e.g. quad: 0°, 90°, 180°, 270° |

0° in the VBAP field = lon=0 on the sphere = "front." This alignment is automatic and fixed. Tare brings the sensor into agreement with it; it doesn't change the speaker positions.

---

## Summary of operations

| Operation | What it does | When | Frequency |
|-----------|-------------|------|-----------|
| **Tare** | Sets sensor reference + defines center | Facing front, sensor in rest position | Once per mount / session start |
| **Recenter** | Corrects drift back to tare-defined center | Hand at tare position, cursor has drifted | As needed during performance |
| **Speaker config** | Sets channel count and layout | Audio setup | Once per venue |

---

## Per-sensor applicability

- **Cursor sensor:** Tare and recenter both apply. This is the primary use case.
- **Frame sensor:** Tare and recenter both apply. Corrects drift in the sphere's world rotation.
- **Gesture sensor:** Tare applies (sensor calibration). Recenter does not apply — gesture feeds into the processing chain, not a spatial view.
