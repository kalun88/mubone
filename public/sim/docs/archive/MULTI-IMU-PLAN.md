# Multi-IMU Live Show — Implementation Plan

> **Status: HISTORICAL** — written for the April 2026 group show (5 students, 3 shared sensors, one cursor at a time). **Superseded by `MULTI-INSTANCE-PLAN.md`** for the current 3-station installation, which uses one instance per sensor instead of role-switching a single instance. Items 3–7 shipped; 1 (dropout watchdog) and 2 (battery display) are still deferred and still worth doing.

> Context: 5 students sharing 3 x-IMU3 sensors, octophonic VBAP, Electron app.
> WiFi client mode on a shared router. One active cursor at a time, instant switching.
> Sweep/clear between performers — no crossfade or smoothing needed on switch.

---

## What already works

The multi-sensor architecture is solid. All of these are confirmed working:

- **Unlimited simultaneous sensor slots** — `_registry` is a `Map<string, SensorSlot>`, no limit (sensor-registry.js:159)
- **Per-device calibration** — tare, polarity, axes alignment, roll mute — all independent per DeviceState (imu-setup.js:89–137)
- **Per-slot tare in registry** — gravity-aligned and full-quaternion strategies per slot (sensor-registry.js:492–524). Tare survives role changes — `assignQuatRole()` never touches `quatCal`.
- **Role-based routing** — cursor/frame roles with automatic exclusivity (sensor-registry.js:189–206)
- **Instant role switching** — `assignQuatRole()` takes effect on next quaternion message (~2.5ms at 400Hz). No teardown, no reconnection.
- **Auto-discovery** — new devices auto-create DeviceState and registry slots on first message
- **Per-device state persistence** — calibration survives page reload (localStorage `mubone-sensor-prefs` by serial, `mubone_sensor_cal` by slot)
- **Data routing by source IP** — Electron-side routing matches UDP packets to devices by IP (imu-setup.js:580–590), handles multiple devices correctly
- **Dynamic IP update** — discovery broadcasts update stored IP even for connected devices (imu-setup.js:567–573), handles DHCP re-lease
- **WiFi client mode compatibility** — discovery uses `rinfo.address` (actual source IP), no hardcoded IPs, no AP-mode assumptions in the data path. All settings enforcement (AHRS, quaternion mode, 400Hz) is mode-independent.

## What we're building

### 1. Sensor dropout detection and warning — DEFERRED

**Deferred — not needed for the show.** The show is in 3 days; minimal changes only. If a sensor drops, the cursor freezes at its last position. The teacher will notice and can switch manually. Add proper watchdog + UI warning in a future session when there's time to test thoroughly.

See edge case audit notes: `getSensorCamQ()` returns stale quaternion forever, `dev.lastTimestamp` is recorded but never checked, proxy.js cleans `discovered` but not `connected`. When we do implement this: 500ms watchdog, `.stale` CSS class on card, flash the top-bar sensor line.

### 2. Battery visibility during performance — DEFERRED

**Deferred — not needed for the show.** Battery is already visible in the discovery list inside the IMU setup modal (ui-imu-setup.js:251). Can open the modal to check. All sensors will be fully charged before the show. Add top-bar battery display + low-battery warning in a future session.

### 3. Quick-switch sensor buttons in main UI top bar — HIGH PRIORITY

**Problem:** Switching the active cursor sensor currently requires opening the IMU setup modal and changing the role dropdown. During a show, we need instant one-click switching from the main performance view.

**Design:**

Add a row of sensor buttons to the top-bar sensor group (index.html `#sensorGroup`). One button per connected sensor. Clicking a button assigns that sensor as cursor. The active cursor button is visually highlighted.

**Files and changes:**

`index.html`:
- Add a `<span id="sensorSwitchBtns" class="sensor-switch-btns"></span>` inside `#sensorGroup` (after `#sensorGroupStatus`, before or after the existing buttons)

`js/main.js` or `js/ui-imu-setup.js`:
- Listen for `sensor-status` events (already fires on device connect/disconnect/role change)
- Rebuild the switch buttons dynamically: one button per connected+feeding device
- Each button shows a short label — device name or a number (1, 2, 3)
- On click: call `assignQuatRole(dev.slotName, 'cursor')` from sensor-registry.js, which auto-unassigns the previous cursor
- The active cursor button gets a `.active` class (bright highlight)
- Non-cursor buttons are dimmer but clearly clickable
- When a device disconnects, its button is removed
- Wire up via the existing `S._onSensorRoleChanged` callback so buttons update when role changes from any source (modal dropdown, MIDI, etc.)

`js/imu-setup.js`:
- The `sensor-status` event (line ~1254) needs to include device list with roles so main.js can build buttons. Add `devices: devs.map(d => ({ sn: d.sn, name: d.name, slotName: d.slotName, role: d.role, feeding: d.feeding, transport: d.transport }))` to the event detail.
- Also fire `_syncSensorStatus()` when role changes (if not already — check `assignQuatRole` path)

`css/style.css`:
- `.sensor-switch-btns` — inline-flex row, small gap
- `.sensor-switch-btn` — small pill button matching the existing top-bar style, monospace font
- `.sensor-switch-btn.active` — bright teal highlight (or similar to show "this is the active cursor")
- `.sensor-switch-btn:hover` — subtle highlight

**Button label:** Use the device name (e.g. "x-IMU3" or the custom name set on the device). If names are identical, append a short serial suffix. Keep it compact — these need to fit in the top bar.

### 4. Manual blink button on device cards in IMU setup modal — HIGH PRIORITY

**Problem:** Before the show, the teacher needs to verify which physical sensor corresponds to which device card. Currently there's no way to ping a specific sensor to confirm identity/connectivity.

**Design:**

Add a "blink" button to each device card in the IMU setup modal. Pressing it sends a few LED blinks to that specific physical device.

**Files and changes:**

`js/ui-imu-setup.js`:
- In `buildCard()` (~line 469), add a blink button in the card header area or the feed section: `<button class="imu-setup-blink-btn js-blink" title="blink LED on this device to identify it">blink</button>`
- Wire click handler: call `blinkDevice(dev)` (new function, see below)

`js/imu-setup.js`:
- Add exported function `blinkDevice(dev, count = 3, intervalMs = 150)`:
  ```
  export async function blinkDevice(dev, count = 3, intervalMs = 150) {
    for (let i = 0; i < count; i++) {
      if (i > 0) await _delay(intervalMs);
      sendCommandTo(dev, { blink: null });
    }
  }
  ```
- Works for all transports: `sendCommandTo` already routes to UDP (Electron), serial, or proxy command relay (browser)

`css/style.css`:
- `.imu-setup-blink-btn` — small secondary button, positioned in the card header row

### 5. LED blink on cursor role switch — MEDIUM PRIORITY (uses blinkDevice from #4)

**Problem:** The 5× blink handshake (imu-setup.js:761–765) only fires on initial connection, not when the cursor role changes. When switching the active performer, the student picking up the active sensor has no physical feedback that they're now in control.

**Design:**

When `assignQuatRole(slotName, 'cursor')` fires, find the DeviceState for that slot and send a blink command to the physical device. Short distinctive pattern (3× fast blink) to differentiate from the connection handshake (5× blink).

**Files and changes:**

`js/imu-setup.js`:
- Add exported function `blinkDevice(dev, count = 3, intervalMs = 150)` that sends `{ blink: null }` to the device `count` times at `intervalMs` intervals
- In Electron: uses `sendCommandTo(dev, { blink: null })` directly
- In browser: routes through proxy.js command relay (already works via `_sendProxyControl({ type: 'command', ip, port, json })`)

`js/ui-imu-setup.js` (or `js/sensor-registry.js`):
- Listen for `S._onSensorRoleChanged` callback (sensor-registry.js:203, already fires but nobody listens)
- When a slot gets role `'cursor'`, find the matching DeviceState by slot name and call `blinkDevice(dev, 3, 150)`

**Blink is best-effort:** If the device is stale/disconnected, the UDP command just fails silently. No error handling needed.

### 6. "wifi AP" badge — cosmetic fix — LOW PRIORITY

**Problem:** The transport badge says "wifi AP" for all UDP-connected devices (ui-imu-setup.js:478, imu-setup.js:1250). Misleading in client mode.

**Design:**

Change the label from `'wifi AP'` to `'wifi'`. One-line change in two places.

**Files and changes:**

`js/ui-imu-setup.js` line 478:
- Change `dev.transport === 'udp' ? 'wifi AP' : dev.transport` → `dev.transport === 'udp' ? 'wifi' : dev.transport`

`js/imu-setup.js` line 1250:
- Change `transports.add('wifi AP')` → `transports.add('wifi')`

`index.html` line 925:
- Change the transport tab label from `wifi AP` to `wifi` (or keep as-is since it describes the discovery method, not the device's network mode — judgement call)

### 7. WiFi info display in client mode — cosmetic fix — LOW PRIORITY

**Problem:** The device card WiFi info section shows AP settings (`wi_fi_ap_ssid`, `wi_fi_ap_channel`) which are meaningless in client mode — they show what AP the device *would* create, not the router it joined.

**Design:**

Two options (pick one):
- **Option A (minimal):** Change the "querying wifi AP…" placeholder to just "querying wifi…". Leave the data as-is — the SSID/channel shown is technically the device's AP config, which is still useful info (confirms which device you're looking at).
- **Option B (better):** Also query `wi_fi_client_ssid` and display it if the device is in client mode. But we can't detect AP vs client mode from the current data — the x-IMU3 doesn't report which mode it's in via discovery broadcasts. Would need to query `wi_fi_mode` setting. **Defer this — not worth the complexity for the show.**

Go with Option A: rename "wifi AP" labels, leave the data display as-is.

---

## Explicitly not doing

These were considered during the edge case audit and ruled out:

| Item | Reason |
|---|---|
| **Cursor position smoothing/slerp on switch** | Instant jump is fine. Sweep/clear between performers makes this moot. |
| **Per-student calibration profiles** | Axes alignment decided before show, tare moment built into the performance flow. Manual re-tare is fast (one button). |
| **Combined heading+tare reset button** | Heading reset at start of day, tare before each performance. Two separate presses is fine — not a real problem. |
| **Audio crossfade on cursor switch** | Built into show flow — sweep/clear before next performer. |
| **Paint trail discontinuity handling** | Expected behavior. Switch properly, or it's a feature not a bug. |
| **Proxy.js auto-reconnect after crash** | Browser-mode only. Electron manages UDP directly via Node.js — no proxy.js in the show path. |

## Scope and priority

| # | Task | Priority | Status | Est. effort |
|---|------|----------|--------|-------------|
| 1 | Sensor dropout detection + UI warning | High | **Deferred** | — |
| 2 | Battery visibility in top bar | Medium | **Deferred** | — |
| 3 | Quick-switch sensor buttons in main UI top bar | **High** | **Do now** | ~2 hours |
| 4 | Manual blink button on device cards | **High** | **Do now** | ~1 hour |
| 5 | LED blink on cursor role switch | **Medium** | **Do now** | ~30 min (shares blinkDevice from #4) |
| 6 | "wifi AP" → "wifi" badge rename | Low | **Do now** | ~10 min |
| 7 | WiFi info label tweak (Option A) | Low | **Do now** | ~10 min |

Total for "Do now" items: ~4 hours.

## Pre-show checklist (not code — operational)

- [ ] Configure all 3 x-IMU3 devices for WiFi client mode via x-IMU3 GUI (join shared router's SSID)
- [ ] Verify all 3 use the same UDP data port (default 8000) — otherwise Electron's single data listener loses devices
- [ ] Test router: ensure AP isolation is OFF (client-to-client UDP must work for discovery broadcasts)
- [ ] Decide axes alignment per mounting orientation, document it
- [ ] Assign sensor serial numbers to students (or at least note which SN is which physical device)
- [ ] Test the full switching flow: connect 3 sensors, assign roles, switch cursor mid-session, verify tare persists
- [ ] Verify battery levels before show start
