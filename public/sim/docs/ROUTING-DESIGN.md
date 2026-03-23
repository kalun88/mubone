# Signal Routing Design

## Pipeline

```
OSC in → Registry (discovery) → Calibration (hardware zero) → Routing (where it goes) → Destinations
```

## Signal Inventory

Every sensor can produce two OSC streams. Here's what comes out at each stage:

### Quaternion stream (`/sensor/{name}/quaternion` — 4 floats)

| Stage | Signals | Notes |
|---|---|---|
| **Raw** | quat x, y, z, w | Direct from IMU |
| **Calibrated** | euler pitch, yaw, roll | After tare (conjugate multiply) + axis remap |

Calibration is always applied. The three euler angles are the routable units.

### Inertial stream (`/sensor/{name}/inertial` — 6 floats)

| Stage | Signals | Notes |
|---|---|---|
| **Raw** | gyro x, y, z, accel x, y, z | Direct from IMU |
| **Calibrated** | gyro x, y, z, dynamic accel x, y, z | After gravity reference subtraction |
| **Computed** | smoothness, effort, directness, periodicity, periodicityHz, accumulatedEnergy, jerk | Gesture chain output (only runs if something subscribes) |

Calibration (gravity sub) is always applied. The six calibrated axes + computed features are routable units.

---

## Routing Table — what the UI shows

One row per breakout signal. The "destination" column shows where it goes. For preset roles (cursor/gesture/frame), destinations are locked and shown as labels. For custom, they become dropdowns.

### Quaternion breakout

| Signal | Cursor (locked) | Frame (locked) | Custom (editable) |
|---|---|---|---|
| euler pitch | → viz elevation | → world ref | [dropdown] |
| euler yaw | → viz azimuth | → world ref | [dropdown] |
| euler roll | → viz roll | → world ref | [dropdown] |

### Inertial breakout — calibrated raw

| Signal | Gesture (locked) | Custom (editable) |
|---|---|---|
| gyro x | → gesture chain | [dropdown] |
| gyro y | → gesture chain | [dropdown] |
| gyro z | → gesture chain | [dropdown] |
| dynamic accel x | → gesture chain | [dropdown] |
| dynamic accel y | → gesture chain | [dropdown] |
| dynamic accel z | → gesture chain | [dropdown] |

### Inertial breakout — computed features (available after gesture chain runs)

| Signal | Gesture (locked) | Custom (editable) |
|---|---|---|
| smoothness | → gesture panel | [dropdown] |
| effort | → gesture panel | [dropdown] |
| directness | → gesture panel | [dropdown] |
| periodicity | → gesture panel | [dropdown] |
| periodicityHz | → gesture panel | [dropdown] |
| accumulatedEnergy | → gesture panel | [dropdown] |
| jerk | → gesture panel | [dropdown] |

---

## Destination list (for custom dropdowns)

These are where signals can be sent. Maintained as a live list:

- **viz azimuth** — camera/cursor horizontal rotation
- **viz elevation** — camera/cursor vertical rotation
- **viz roll** — camera/cursor roll
- **world reference** — frame correction quaternion
- **gesture chain** — feeds the gesture computation pipeline
- **morph target N** — morph parameter slots (future)
- **grain density** — direct grain parameter control
- **grain scatter** — direct grain parameter control
- **grain pitch** — direct grain parameter control
- *...any OSC-addressable parameter*

---

## Order of operations question

The tricky bit: computed gesture features (smoothness, effort, etc.) come FROM the inertial stream AFTER the gesture chain processes them. So they're second-tier routable signals.

**Resolution:** Two tiers in the routing table.

1. **Tier 1 — always available:** Calibrated euler angles (from quat) and calibrated gyro/accel axes (from inertial). These exist as soon as calibration runs. Routable immediately.

2. **Tier 2 — computed, available after processing:** Gesture features. These only exist if inertial data is flowing through the gesture chain. If a custom route sends all six inertial axes somewhere else and nothing goes to the gesture chain, then the computed features don't exist and those rows are greyed out / hidden.

This means: in custom mode, if you want access to computed features, at least the inertial stream needs to still feed the gesture chain. The UI can show this dependency clearly — if no inertial signals are routed to "gesture chain", the computed features section says "no inertial input → gesture chain" and the rows are inactive.

---

## UI behavior in the registry panel — IMPLEMENTED

Each stream row in the sensor registry panel now contains:

1. **Header row**: activity dot, name, badge, role dropdown, live readout (unchanged)
2. **Routing breakout table** (below header, inside the same block):
   - One row per breakout signal (3 for quat, 6 for inertial)
   - Two columns: SIGNAL and DESTINATION
   - **cursor/gesture/frame**: destination column shows locked labels (greyed text, not clickable)
   - **custom**: destination column shows live dropdowns with all available destinations
   - **unmapped**: breakout table hidden entirely

Implementation files:
- `js/sensor-registry.js` — `QUAT_SIGNALS`, `INERTIAL_SIGNALS`, `QUAT_DESTINATIONS`, `INERTIAL_DESTINATIONS`, `CURSOR_DEFAULTS`, `FRAME_DEFAULTS`, `GESTURE_DEFAULTS`, `getEffectiveRoutes()`, `setCustomRoute()`, `dispatchCustomQuat()`, `dispatchCustomInertial()`
- `js/ui-sensors.js` — `buildStreamBlock()`, `buildRoutingBreakout()`
- `css/style.css` — `.sensor-stream-block`, `.sensor-routing-breakout`, `.sensor-route-table`, etc.

Custom routes persist to localStorage alongside calibration data. Factory reset clears everything.

### Dispatch hooks for custom routing (S._ callbacks)
- `S._onCustomToGesture(signal, value)` — euler angle fed into gesture chain
- `S._onCustomToMorph(signal, value)` — signal fed into morph parameter
- `S._onCustomVizUpdate(slot)` — custom viz euler data available on `slot._customVizEuler`
- `S._onCustomToViz(signal, dest, value)` — inertial signal routed direct to viz
