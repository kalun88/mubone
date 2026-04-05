# Direct x-IMU3 Connection Plan

> Eliminate Max/MSP from the sensor pipeline. Connect x-IMU3 to mubone via Wi-Fi (UDP) or USB serial directly, with a lightweight Node.js proxy for browser mode.

---

## Status — What's Built (v0.17 alpha, Apr 4 2026)

All planned features are now implemented:

### Done

- **`electron-main.js`** — UDP discovery listener on port 10000, data listener with source IP tagging for multi-device routing, command sender, serial port open/close/send, ASCII line parser with LF buffering
- **`electron-preload.js`** — Full IPC bridge with source IP passthrough: `onXIMU3Discovery`, `onXIMU3Data(line, sourceIP)`, `onXIMU3CommandResponse(json, sourceIP)`, `ximu3StartData`, `ximu3StopData`, `ximu3SendCommand`, serial equivalents
- **`js/imu-setup.js`** — DeviceState class with per-device calibration, ASCII data parser, feed-to-registry pipeline, connect/disconnect for UDP and serial, axes alignment, OSC sensor auto-discovery, multi-transport support (udp/serial/osc), **LED blink handshake** (5× on connect), **settings enforcement** (AHRS config on connect), **heading command on tare**, **multi-device UDP routing** (source IP matching), **browser-mode transport** (WebSerial + proxy control channel)
- **`js/ui-imu-setup.js`** — Sensor setup modal with WiFi discovery list, serial port list, connect/disconnect buttons, per-device cards, rAF readout loop, global tare shortcut, **RSSI bar** in discovery list, **"add USB device" button** for WebSerial in browser mode
- **`proxy.js`** — Standalone Node.js proxy for browser mode. Port 8080 (data, osc.js compatible) + port 8081 (control: discovery, connect/disconnect, commands). Replaces Max bridge for WiFi sensors.
- **Discovery → connect → calibrate → feed-to-sphere** flow works end-to-end in Electron and browser
- **Serial (USB)** in Electron (IPC) and browser (WebSerial API)
- **Multi-device routing** via source IP tagging in electron-main.js

### Remaining / Future

1. **Binary mode** — x-IMU3 supports binary data messages (more compact, lower parse overhead). ASCII is simpler to debug.
2. **Auto-connect on discovery** — For workshop simplicity, could auto-connect to first discovered sensor. Configurable.
3. **Multi-device data port** — If multiple WiFi sensors use different send ports, the data listener needs to handle multiple bound sockets.

---

## Problem

The current Max-based sensor path causes:

1. **Connection friction** — collaborators retry Wi-Fi passwords, Max patch won't connect to sensor even when visible in x-IMU3 GUI.
2. **Jitter / lag** — multiple hops (serial parse → Max scheduler → node.script → WebSocket/UDP) add variable latency. Multiple x-IMU3s in AP mode on the same channel compound this with RF contention.
3. **Dependency on Max** — requires Max license, Max runtime, and correct patch state. Students and collaborators without Max can't use Wi-Fi sensors at all.

---

## Architecture

### Transport layers

| Mode | Sensor transport | App transport | Middleware |
|------|-----------------|---------------|------------|
| **Browser + Wi-Fi** | UDP from x-IMU3 | WebSocket to renderer | `proxy.js` (Node) ✅ |
| **Browser + USB** | WebSerial API (Chrome) | Direct in renderer | None ✅ |
| **Electron + Wi-Fi** | UDP from x-IMU3 | IPC to renderer | `electron-main.js` ✅ |
| **Electron + USB** | Serial (115200 baud) | IPC to renderer | `electron-main.js` ✅ |

All three paths converge on the same DeviceState → feedToRegistry → sensor-registry pipeline. The sensor-registry, role assignment, and grain mapping systems are untouched.

### Data flow: Wi-Fi UDP

1. x-IMU3 broadcasts **network announcement** on UDP port **10000**, once per second. JSON payload includes device name, serial number, IP, TCP port, UDP send/receive ports, battery, RSSI.

2. Proxy (or Electron main) listens on UDP port 10000 for announcements. Discovered devices appear in the sensor setup UI under "x-IMU3 wifi."

3. User clicks **connect** on a discovered device. The system:
   - Starts listening on the device's UDP send port for data
   - Sends settings enforcement sequence (AHRS config)
   - Sends 5× blink command (LED handshake)
   - Queries device info (axes alignment, name, serial number)

4. x-IMU3 streams ASCII data messages via UDP:

   | Prefix | Message | Fields |
   |--------|---------|--------|
   | `Q` | Quaternion | timestamp, w, x, y, z |
   | `I` | Inertial | timestamp, gx, gy, gz, ax, ay, az |
   | `A` | Euler angles | timestamp, roll, pitch, yaw |
   | `B` | Battery | timestamp, percentage, voltage, status |
   | `W` | RSSI | timestamp, percentage, dBm |

5. Data parsed in `imu-setup.js` → `parseDataLine()` → DeviceState raw values → `feedToRegistry()` sends pre-calibrated quaternion to sensor-registry.

### Commands: mubone → x-IMU3

Commands sent as JSON + LF to the device's UDP receive port (default 9000):

- **Heading command** on tare: `{"heading":0}\n` — resets sensor yaw drift
- **LED blink** on connect: `{"blink":null}\n` — visual handshake
- **Settings enforcement**: `{"ahrs_ignore_magnetometer":true}\n`, etc.
- **Axes alignment**: `{"axes_alignment":0}\n` + `{"apply":null}\n`

Existing infrastructure: `sendCommandTo(dev, jsonObj)` in `imu-setup.js` → routes to `bridge.ximu3SendCommand()` (UDP) or `bridge.serialSendCommand()` (serial).

---

## Implementation Summary (completed Apr 4 2026)

All phases implemented in a single session:

1. **LED blink + settings enforcement** — `connectDevice()` and `connectSerialDevice()` in `imu-setup.js` now send AHRS config (ignore magnetometer, accel rejection, gyro offset correction, low latency, quaternion mode) + apply, then 5× blink with 200ms spacing. Both Electron and browser modes.

2. **Heading command on tare** — `captureTare()` sends `{"heading":0}` to non-OSC devices, resetting hardware yaw drift.

3. **Multi-device UDP routing** — `electron-main.js` tags each UDP data packet with `rinfo.address`. `electron-preload.js` passes `sourceIP` through IPC. `imu-setup.js` routes by matching source IP to device, with fallback to first UDP device.

4. **Browser proxy (`proxy.js`)** — Standalone Node.js script at repo root. Two WebSocket interfaces:
   - Port 8080: data channel, same `{ address, values }` JSON as Max bridge (drop-in for `osc.js`)
   - Port 8081: control channel for discovery, connect/disconnect, commands
   - Converts x-IMU3 ASCII to `/sensor/{name}/quaternion` and `/sensor/{name}/inertial` OSC messages
   - Handles settings enforcement and LED blink on connect (same as Electron)
   - Launch: `node proxy.js` (requires `ws` package)

5. **WebSerial in browser** — `imu-setup.js` now supports Chrome WebSerial API for USB serial in browser mode. `initIMUSetup()` no longer returns early in browser. New `requestSerialPort()` export for user-gesture-triggered port selection. "Add USB device" button in the sensor setup modal (browser only).

6. **RSSI display** — Discovery list shows RSSI percentage text and color-coded bar (green > 60%, yellow 30–60%, red < 30%). CSS added in `style.css`.

---

## Wi-Fi Channel Best Practices

### Channel contention (from jam session experience)

Three x-IMU3s on the same 5GHz channel (36) in AP mode caused jitter and delay. Each AP contends for airtime even if only one is actively connected.

### Recommendations

- **AP mode (workshop):** Assign different channels per sensor — e.g. 40, 44, 48. Avoid channel 36 (most congested default).
- **Client mode (performance):** All sensors join a shared router. One channel, one network, no AP contention.
- **Pre-show scan:** Open macOS Wireless Diagnostics → Window → Scan. Check "Best 5GHz" recommendation. Or run `airport -s` in Terminal.
- **Upper 5GHz band:** Channels 149–165 often much emptier in venue spaces. Set x-IMU3 Region to "US" (FCC, valid for Canada) to unlock these channels.

---

## Connection Modes Summary

| Scenario | Setup | Sensor mode | Network | Sensors per computer |
|----------|-------|-------------|---------|---------------------|
| **Workshop** | Student laptop, no router | AP mode | Each x-IMU3 creates own network | 1 |
| **Performance (solo)** | Performer laptop + router | Client mode | All on shared network | 1–3 |
| **Performance (multi)** | Multiple laptops + router | Client mode | All on shared network | 1 per laptop (or multi) |
| **Development** | USB serial | N/A (wired) | N/A | 1+ |

---

## Open Questions

1. **Binary mode** — x-IMU3 supports binary data messages (more compact, lower parse overhead). Worth enabling later for performance, but ASCII is simpler to debug. Switch is a parse-layer change only.

2. **Auto-connect on discovery** — For workshop simplicity, could auto-connect to the first discovered sensor (skipping the manual connect click). Configurable behavior: auto-connect for single-sensor, manual for multi-sensor.

3. **Multi-port data listener** — If multiple WiFi sensors use different send ports, the proxy and Electron data listener each bind to a single port. Would need multiple bound sockets or a shared port with source IP routing.
