# x-IMU3 Settings Enforcement

> **Status: CURRENT** — describes shipped behaviour as of 2026-08-01 (1.11 alpha). The authoritative values live in `js/ximu-settings.js`; if this doc and that file disagree, the file wins. Manual references are [x-IMU3 User Manual v1.11](https://x-io.co.uk/downloads/x-IMU3-User-Manual-v1.11.pdf) (April 3, 2025).

## The problem this solves

x-IMU3 settings persist in the device's flash. The x-IMU3 GUI writes them. The Max patches write them. Whatever touched the sensor last is what mubone inherits — and until 2026-08-01 the connect handshake only asserted about half the settings that matter, so a sensor that had been through the GUI or a Max session would arrive streaming data mubone parses and throws away.

Concretely, `max/x-imu3.maxpat` sets `inertial_message_rate_divisor: 1` (400 messages/second of gyro + accel) and `max/x-imu3 copy.maxpat` sets `magnetometer_message_rate_divisor: 1`. mubone never wrote either key, so those stuck. On a three-sensor rig that's 1200 unwanted messages/second of WiFi and main-thread parse work, all of it discarded at the bottom of `parseDataLine`.

## What mubone actually consumes

Only two ASCII data message types reach live code:

| Type | Contents | Consumed by |
|---|---|---|
| `Q` | quaternion | the cursor — `feedToRegistry()` → `sensor-registry` → sphere. The entire spatial path. |
| `S` | serial accessory payload | SA-A8 pots / sliders / buttons via `S._onAccessoryData` → `accessory-registry.js`. Fixed 100 Hz, no rate divisor; gated by `serial_mode` = 2, which mubone reads on connect and never writes. |

`A` (Euler) is handled by the parser but only appears if you call `requestEulerMode(dev)` from the DevTools console — `ahrs_message_type` selects one AHRS output, so `Q` and `A` are mutually exclusive.

Everything else — inertial, magnetometer, high-g accelerometer, temperature, battery, RSSI — is disabled at the device.

**Inertial is the one worth understanding.** `parseDataLine` used to fill `dev.rawInertial` from `I` messages, but `feedToRegistry()` only ever forwards the quaternion, so the gesture and seed-morph engines never saw inertial on a direct connection. Those run off the Max/OSC path (`/sensor/{name}/inertial` → `handleOSCSensorInertial` → `handleSlotInertial`), which this table does not touch. Direct-connect gesture is therefore **not a thing today**. To make it one: set `inertial_message_rate_divisor` to 8 (50 Hz) and have `feedToRegistry()` also call `handleSlotInertial()`.

**Battery and RSSI still display.** Those come from the discovery announcement, a separate channel from data messages, unaffected by the divisors.

## The enforced table

Every connect writes all of this, sends `apply`, then reads it back. Source: `js/ximu-settings.js`.

| Key | Value | §  | Why |
|---|---|---|---|
| `ahrs_message_type` | `0` | 11.1.67 | Quaternion. Also what keeps Euler off the wire. |
| `ahrs_message_rate_divisor` | `4` | 11.1.70 | 400 Hz / 4 = 100 msg/s. Above the paint ticker's 200 Hz consumption, and §9.3 means each message is the **average** of the 4 most recent samples — free anti-aliasing. Divisor 1 buys nothing at 4× the bandwidth. |
| `ahrs_axes_convention` | `0` | 11.1.61 | NWU. Every Euler transform in `imu-setup.js` assumes it. ENU or NED breaks the cursor silently. |
| `ahrs_gain` | `0.5` | 11.1.62 | Accelerometer correction strength, pinned so feel can't drift with the GUI. **This is the number to change if the cursor feels sluggish or twitchy.** |
| `ahrs_ignore_magnetometer` | `true` | 11.1.63 | Mag is unusable next to speakers, laptops, stage metal. Yaw drifts instead; tare and heading-zero handle it. |
| `ahrs_acceleration_rejection_enabled` | `true` | 11.1.64 | Fast playing can't corrupt pitch/roll. |
| `gyroscope_offset_correction_enabled` | `true` | 11.1.60 | Continuous gyro bias estimation. |
| `axes_alignment` | `0` | 11.1.59 | `+X+Y+Z`. All mount remapping stays in mubone software (polarity / roll mute) so it can change live. |
| `binary_mode_enabled` | `false` | 11.1.66 | Device default is binary; mubone's parser only speaks ASCII. A sensor left in binary hands over silently-broken frames. |
| `serial_mode` | `2` | 11.1.18 | Accessory. Enforced unconditionally, whether or not an SA-A8 is currently attached — see below. |
| `inertial_message_rate_divisor` | `0` | 11.1.68 | Off — see above. |
| `magnetometer_message_rate_divisor` | `0` | 11.1.69 | Off — the AHRS ignores mag anyway. |
| `high_g_accelerometer_message_rate_divisor` | `0` | 11.1.71 | Off. |
| `temperature_message_rate_divisor` | `0` | 11.1.72 | Off. |
| `battery_message_rate_divisor` | `0` | 11.1.73 | Off — battery UI reads discovery. |
| `rssi_message_rate_divisor` | `0` | 11.1.74 | Off — RSSI UI reads discovery. |

**UDP devices only:**

| Key | Value | § | Why |
|---|---|---|---|
| `udp_low_latency` | `false` | 11.1.45 | Low latency sends each data message as its own UDP packet. The manual: *"will significantly limit the maximum throughput and number of devices able to stream on the same network."* mubone runs 3+ sensors on one network (`MULTI-INSTANCE-PLAN.md`), so packet aggregation is worth more than the few ms. **Was `true` before 2026-08-01.** Flip back only for a single-sensor rig where latency is the whole game. |

§9.2: *"A message rate divisor of 0 will disable the sending of that data message type."*

## `serial_mode` — enforced, regardless of what's plugged in

SA-A8s get swapped between hosts mid-show as part of the performance, so an absent accessory is normal and silence on the `S` stream proves nothing about configuration. Every x-imu3 has to be standing ready to receive one, so `serial_mode: 2` is enforced unconditionally like everything else. `apply` makes it take effect; no `save`, no EEPROM write on connect.

If the read-back shows it didn't take, the warning says so in accessory terms rather than as a bare key mismatch — a device stuck out of Accessory mode is indistinguishable from one with nothing attached, which is exactly the confusion worth pre-empting.

`accessory-registry.setAccessoryMode()` remains as the manual override — it writes with `save` and can also turn accessory mode *off*, though connect will put it back:

```js
acc.setAccessoryMode(true, 'A1B2C3')   // one device
acc.setAccessoryMode()                 // every connected device
```

It defaults to **all** connected devices. It used to fix only `_lastDev` (whichever device last sent an `S` message), which is backwards on a multi-sensor rig: the device needing the fix is by definition the one that *isn't* sending.

### `serial_mode` is not the USB port

The x-IMU3's serial interface is the UART on the expansion connector, where the SA-A8 lives. It is **not** the USB CDC port that a mubone `serial`-transport device connects through. The manual keeps them separate — §11.1.75 *USB data messages enabled* vs §11.1.76 *Serial data messages enabled*, plus `serial_baud_rate` and `serial_rts_cts_enabled`, which are UART-only concepts. So connecting over USB never disturbs accessory mode, and setting accessory mode never threatens a USB connection.

Naming debt worth knowing about: `dev.transport === 'serial'` in mubone means **USB CDC** (`/dev/tty.usbmodem*`). Same word, two different interfaces. The setting governing mubone's serial transport is `usb_data_messages_enabled`, not `serial_data_messages_enabled`.

### `apply` is enough — and there is no such thing as "session only"

§8.1.4: the apply command "applies all settings … immediately instead of after a two second delay." So a written setting takes effect without a reboot, and without `save`. mubone sends `apply` and never `save`.

But do **not** read that as "mubone's settings are temporary." §8.1.5: *"The save command is unnecessary in most applications because the x-IMU3 will automatically save all settings on shutdown."* The device persists everything to EEPROM when it powers down, so the enforced table ends up in flash either way. There is no session-scoped tier of settings on this hardware.

Practical consequence: **after a sensor has been through mubone, the x-IMU3 GUI will show inertial and magnetometer streams disabled.** That's mubone's table persisting, not a fault. Re-enable them in the GUI if you need them there.

The device does stream its stored config for the few hundred ms before the handshake lands — harmless, and the unexpected-type counter absorbs the first 20 messages before it says anything.

## Verification

Writes to the x-IMU3 are effectively unacknowledged: the device echoes the key, but nothing looked at the echo, so a rejected or misspelled setting failed in complete silence. After `apply`, `verifySettings(dev)` re-reads every enforced key and compares.

- **Mismatch** → `console.warn` naming the key, the wanted value, and what the device reports. This is a real failure: mubone wrote the setting and it didn't take. `serial_mode` gets an extra line explaining the accessory consequence.
- **No response** → reported separately, and only under `?debug`. UDP command responses are unacknowledged and can simply be dropped; treating that as a failed setting would cry wolf before every show.
- Result is stored on `dev.settingsVerify` as `{ ok, mismatched, unanswered, at }` — available for a device-card indicator if one is ever wanted.

There is a 400 ms gap between `apply` and the read sweep so the write echoes drain first. A stale echo carries the desired value, so at worst it could mask a failure, never invent one.

**Second line of defence:** `parseDataLine`'s `default` case counts message types mubone doesn't consume and warns once per type per device after 20 of them. If `I` or `M` shows up after a connect, enforcement didn't take — that's the cheapest possible signal, and it catches cases the read-back can't (a setting that reads back correct but isn't in effect).

## Where enforcement lives — one place, deliberately

`js/ximu-settings.js` has **no imports**. That's load-bearing: it's consumed by `js/imu-setup.js` as a browser ES module and was previously duplicated in `proxy.js` (Node). Adding an import breaks the Node side.

Before 2026-08-01 the same enforcement block was copy-pasted into four places — UDP connect, WebSerial connect, Electron serial connect, and `proxy.js`. They drifted, exactly as you'd expect:

- `proxy.js` wrote `ahrs_message_rate_divisor: 1` (400 Hz) while `imu-setup.js` wrote `4` (100 Hz)
- `proxy.js` never wrote `binary_mode_enabled` or `axes_alignment`

So the same physical sensor was configured differently depending on whether you launched Electron or browser mode. The fix was structural, not a re-sync: **`proxy.js` no longer enforces anything.** It's a transport — it owns the sockets and relays commands. `imu-setup.js` runs one enforcement pass for every transport, routing browser-mode UDP commands through the proxy's `{ type: 'command' }` relay. The LED handshake blink moved with it, so it goes through `ximu-led-feedback.js` in browser mode too.

## Known conflict: the Max patches

`max/x-imu3.maxpat`, `max/x-imu3 copy.maxpat` and `max/x-imu3pia.maxpat` all contain message boxes that write settings mubone now enforces the other way:

| Patch writes | mubone enforces |
|---|---|
| `inertial_message_rate_divisor: 1` | `0` |
| `magnetometer_message_rate_divisor: 1` (copy only) | `0` |
| `ahrs_message_rate_divisor: 20` | `4` |

None are on a loadbang — they only fire if you click them. **These are left alone on purpose.** In the Max workflow inertial *is* consumed (it becomes `/sensor/{name}/inertial` and drives gesture), so the patch's settings are correct for the patch. But whichever ran last wins, and mubone only re-asserts on connect. If a sensor behaves oddly after a Max session, reconnect it in mubone rather than assuming the handshake covered it.

## Related

- `docs/TIMING-REFERENCE.md` — where the 100 Hz figure sits relative to the paint ticker and grain scheduler
- `docs/EULER-VS-QUAT.md` — why quaternion rather than Euler
- `docs/MULTI-INSTANCE-PLAN.md` — the 3-sensor case that drove `udp_low_latency: false`
- `docs/archive/JAM-NOTES-2026-03-24.md` — the original settings survey this doc supersedes
