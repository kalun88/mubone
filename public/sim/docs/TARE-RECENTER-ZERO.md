# Tare, Recenter & Spatial Alignment

> **Status: CURRENT** · reference · how tare / recenter / zero heading relate, and which of them you can actually reach. The Recenter section carries its own warning — it describes design intent, not shipped behaviour.

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

**Where the button is.** One operation, two entry points — both call `captureTare(dev)`:

- **`tare sensor`** in the sensor modal's tare row — aimed at the one device whose card you're looking at.
- **`tare cursor`** in the session panel (and the `` ` `` key, and the `tare` action over MIDI/OSC) — aimed at whichever sensor currently holds the **cursor** role, so it works without opening the modal mid-set. It does not touch any other sensor.

They were called "capture tare" and "tare cursor" until the labels were unified; if you find the old name in a doc or comment, it means this.

**Tare is auto-cleared when the axes-alignment dropdown changes** — the reference frame moved, so the stored offset no longer means anything. Re-tare after any mounting change.

**What it defines:**
- The sensor's identity orientation (no rotation = the tare pose)
- The center of the viz — the tare pose maps to lon=0, lat=0 on the sphere
- By extension, alignment with the VBAP field — lon=0 maps to 0° in the speaker layout

**Facing direction matters.** When you tare, face where you consider "front of the room" to be. This is NOT necessarily where speaker 1 is — it's the center of the spatial field. For stereo, front is the phantom center between L/R speakers. For multi-channel, front is the geometric center of the speaker array.

**Tare does not change the speaker layout.** Speakers are configured independently (equal spacing from 0° for standard layouts). Tare aligns the sensor to the existing speaker field.

---

## Zero heading (hardware yaw reference)

**What it does:** Sends a `heading: 0` command to the x-IMU3 itself, resetting the **AHRS yaw reference in firmware**. Everything above this line is software; this one changes what the sensor reports.

**When to use:** Long-term yaw drift that tare keeps having to re-correct. Point the sensor at your desired 0° *before* pressing it — the command zeroes whatever it is looking at.

**It clears tare, deliberately.** The two corrections stack in the wrong direction if both are live: tare captures yaw = 45°, zero heading then makes the hardware report 0°, and the next frame calibrates to `0° − 45° = −45°`. `captureTare()` therefore does **not** send the heading command, and `resetHeading()` drops the stored tare. Re-tare afterwards if you want a pitch offset too.

**Where the button is:** sensor modal only, per device (`zero heading`). There is no main-UI shortcut and no MIDI/OSC action — it is a setup operation, not a performance one, and it talks to hardware.

**Naming trap:** "zero heading" is the *only* thing in mubone that "zero" should refer to. The session-panel button next to it is a **tare**, not a heading reset — its element id was `cursorZeroTopBtn` for a while, which is where the confusion came from. It is now `cursorTareBtn`.

---

## Recenter (drift correction)

> ⚠️ **Not reachable at all.** The recenter button is disabled pending **#76** (the logic is unverified — tare works, recenter's behaviour is unclear), and the auto-recenter path is gone too: it was armed only by `sensor-registry.js`'s `slotTare()`, which had no caller and was removed on 2026-08-01. `recenterCursor()` survives and is exposed as `S._recenterCursor()` for console investigation of #76, but nothing in the UI, keys, MIDI or OSC calls it, so `S.driftOffsetQ` stays null. **Tare is the only drift correction that exists in practice** — which is why it has a panel button and a key. The rest of this section describes intended design, not today's behaviour.

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

| Operation | What it does | Software / hardware | Where | Frequency |
|-----------|-------------|---------------------|-------|-----------|
| **Tare** (`tare sensor` / `tare cursor`, `` ` ``) | Sets sensor reference + defines center | Software | Sensor modal *and* session panel | Once per mount / session start — and, until #76, as the mid-show drift fix too |
| **Clear tare** | Drops the stored offset | Software | Sensor modal | Rarely |
| **Zero heading** | Resets the AHRS yaw reference in firmware; clears tare | **Hardware** | Sensor modal only | Long-term drift, setup only |
| **Recenter** | Corrects drift back to tare-defined center | Software | ⚠️ no button — auto-fires after a gravity-aligned tare (#76) | Intended: as needed during performance |
| **Speaker config** | Sets channel count and layout | Software | Audio settings | Once per venue |

---

## Per-sensor applicability

- **Cursor sensor:** Tare and recenter both apply. This is the primary use case.
- **Frame sensor:** Tare and recenter both apply. Corrects drift in the sphere's world rotation.
- **Gesture sensor:** Tare applies (sensor calibration). Recenter does not apply — gesture feeds into the processing chain, not a spatial view.
