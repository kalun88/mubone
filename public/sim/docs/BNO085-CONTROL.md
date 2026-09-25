# BNO085 Control Surface

> **Status: CURRENT (study, not a plan)** — written 2026-08-23 against `sygaldry-private` @ `f48142b` (`sygaldry/sygsp-bno085/`, `sygaldry/sygsr-bno085/`, `sygaldry-instruments/mubone/main.cpp`) and the [SH-2 Reference Manual v1.2](https://cdn.sparkfun.com/assets/4/d/9/3/8/SH-2-Reference-Manual-v1.2.pdf) (1000-3625). Sections marked **NOT IMPLEMENTED** describe silicon capability with no firmware behind it — do not read them as things the sensor does today. Firmware is the authority on §2–3; the manual is the authority on §4.

This is the reference for building a BNO085 control panel in mubone, in the spirit of `docs/XIMU3-SETTINGS.md`. It answers three questions: what can be driven today, what the firmware already half-implements, and what the part can do that nobody has wired up.

## 1. The chain

```
BNO085 ──I2C 400kHz──> RP2040 (Pico W)  ──┬── UDP OSC     :49170 in / :49171 out
  SHTP/SH-2            sygaldry runtime   ├── WebSocket OSC :80 (binary OSC frames)
  HINT=GPIO3                              └── SLIP OSC over USB CDC
  nRESET=GPIO28
```

- Portable driver: `sygaldry/sygsp-bno085/sygsp-bno085.hpp` (endpoints, reset handshake, report parsing). SH-2 wire types: `sygsp-bno085-sh2.hpp`. Pico specifics (pins, hardware reset): `sygaldry/sygsr-bno085/sygsr-bno085.hpp`. **Edit the `.lili.md`, never the `.hpp`** — see `sygaldry-private/CLAUDE.md`.
- OSC addresses are `/<ComponentName>/<endpoint_name>` with spaces→underscores and case preserved (`sygbp-osc_string_constants`). The BNO's component name is `BNO085`, so `/BNO085/tare_sensor`. Siblings on the same tree: `/WiFi/*`, `/UDP_OSC/*`, `/WebSocket_OSC/*`, `/Buttons/state`, `/syg/*`.
- **Every input endpoint is settable from every transport**, and incoming messages are handled even when that transport's `enable` is off.
- `/syg/describe` bangs a full dump of every endpoint's name, type and range, one message per endpoint, prefixed `/describe/inputs` or `/describe/output`. A panel can be generated from that rather than hardcoded — see §5.
- **`js/sygaldry.js` is the control path**, over SLIP-framed OSC on the USB cable or a WebSocket on the network, with `js/ui-sygaldry.js` as its panel in Settings → Sensors. It translates three output addresses into the app's sensor intake (`/BNO085/orientation` → `/sensor/{name}/quaternion`, plus `angular_rate` and `acceleration`) and drives the wifi endpoints. **Six of the seven §2 inputs are wired** as of 2026-08-31, one row each on Settings → Sensors: `tare_sensor`, `persist_tare`, `enable_calibration` (three boxes over one bitfield), `disable_magnetometer` (inverted once, in `SygaldryLink.magnetometer`, so the UI can say what it means), `sampling_rate` and `reset`. **The two tare buttons are `disabled` in the markup since 2026-09-10** (Ek): the basis is hardwired to the mag-referenced Rotation Vector (§ 3.2), so with the magnetometer off — the show setting — the hardware tare zeroes against the estimate that was switched off; the row's description says so and points at mubone's own zero heading. They come back when the tare basis follows `disable_magnetometer`. **The access point is wired (2026-09-10)**: two rows in the block's Wi-Fi section — a switch on `/WiFi/enable_access_point` painted back from `/WiFi/ap_enabled`, with `ap_status`, `ap_address` and `connected_stations` beside it, and name + password (`ap_ssid`, `ap_password`, write-only, persisted on the instrument) with a Set that re-sends the 1 when the AP is up, because the firmware reads them only in `enable_ap_mode()`. Two firmware facts the row states: the AP and the station are independent interfaces, and a persisted `enable_access_point = 1` does NOT bring the AP up at boot (`Wifi::init` starts the station only), so it is re-sent after every power-up like the magnetometer switch. `ap_ip`, `ap_netmask`, `ap_gateway`, `channel` and `power_mode` are not exposed. **`persist_calibration` is deliberately not exposed** — § 3.1 below: it sends 0x09 where saving on demand is 0x06, so a button labelled "save calibration" would be a lie until the firmware is fixed. The type tags are load-bearing and are taken from the § 2 table: `sygbp-osc` strcmps the tag string as well as the address, so a float at an `,i` endpoint is dropped in silence. This paragraph said nothing controlled the firmware until 2026-08-31, which was true only of the branch it was written on: the support landed on `main` 28 minutes before `brush-model` was cut from a commit that predated it, so the doc and the code sat on opposite branches for eight days. `sandbox/max/bno085/bno085.maxpat` is not a control path either: it was built for an earlier BNO firmware, hardcodes `udpsend 192.168.1.97 49160` / `udpreceive 49161` against the current build's 49170/49171, and has not been touched since 0.16 alpha. Its address names happen to resemble the ones below because both descend from the same sygaldry component, not because the patch drives this device. **`sygaldry-private` is the source of truth for the firmware** — read the endpoints out of `sygsp-bno085.hpp`, or bang `/syg/describe`, never out of the Max patch (which now lives in `sandbox/`, where nothing describes live behaviour).

## 2. What is exposed today

Inputs (`sygsp-bno085.hpp:36-43`). Type tag matters: the OSC binding matches address **and** type string exactly (`sygbp-osc.hpp` `match()` does `strcmp` on the tags), so a float sent to an `,i` endpoint is silently dropped.

| Address | Tag | Effect | Survives power cycle? |
|---|---|---|---|
| `/BNO085/reset` | `,` | Hardware reset pulse + `DeviceReset`, re-runs the whole handshake, re-applies sampling rate | — |
| `/BNO085/tare_sensor` | `,` | Tare Now, all three axes (`Axes::XYZ`), basis hardwired to Rotation Vector | no (RAM only) |
| `/BNO085/persist_tare` | `,` | Writes the tare to the System Orientation FRS record | yes (in the sensor) |
| `/BNO085/enable_calibration` | `,i` | Bitfield: 1 = accel, 2 = gyro, 4 = mag. Also gates whether magnetic-field reports stream at all | no |
| `/BNO085/disable_magnetometer` | `,i` | 0 → subscribe Rotation Vector (0x05); non-zero → subscribe Game Rotation Vector (0x08) | no |
| `/BNO085/persist_calibration` | `,` | **Does not save calibration** — see §3.1 | — |
| `/BNO085/sampling_rate` | `,f` | 0–400 Hz, one interval shared by gyro + linear accel + the chosen rotation vector (+ mag if bit 2) | **yes** (`tag_session_data`) |

Outputs: `/BNO085/orientation` (quat ijkw), `/angular_rate`, `/acceleration`, `/magnetic_field`, `/accuracy` (RV accuracy in radians), `/magnetic_status`, `/period`, `/configured_period`, `/configured_rate`, `/report_rate`, `/report_loss`, `/dropped_reports`, `/calibration_enabled`, `/calibration_success`.

## 3. Firmware gaps in what is already half-built

Cheap wins — the SH-2 message types for all of these already exist in `sygsp-bno085-sh2.hpp`.

### 3.1 `persist_calibration` sends the wrong command

`SaveDCD` is declared as `Sh2CommandRequest<Sh2Command::DCD_Save>` = command **0x09** with an all-zero payload. Manual §6.4.8: 0x09 is *Configure Periodic DCD Save*, P0 = `0x00` **enable** periodic save / `0x01` disable, and "there is no response to this command". Saving on demand is command **0x06** (`Sh2Command::DCD`, already in the enum), which does answer with a status. So today:

- pressing `persist_calibration` enables background auto-save rather than writing the DCD now;
- `SaveDCDResponse` can never arrive, and nothing handles it anyway, so `calibration_success` only ever reflects the ME-cal config response;
- there is no way to disable periodic save, and no way to save on demand.

This is the one item on the list that is a plain bug rather than a missing feature. Cross-checked against CEVA's own driver, where `sh2_saveDcdNow()` and `sh2_setDcdAutoSave(bool)` are separate calls.

### 3.2 Tare is coarser than the part allows

- `zero_heading()` (Z only) and `zero_level()` (XY only) exist as methods with **no endpoints**. Heading-only zeroing is exactly what mubone means by "face the audience" (`docs/TARE-RECENTER-ZERO.md`), and it is one `bng` each.
- The tare basis (P2) is always `Default` = Rotation Vector, even when `disable_magnetometer` is on and the live output is the Game RV. Manual §6.4.4.1: with P2 = 0 the tare reorients all motion outputs, so it is not inert — but the offset is computed from the mag-referenced estimate you deliberately stopped trusting. The basis should follow `disable_magnetometer`. Note the manual's other constraint: **a Z-axis tare on the Game RV cannot be persisted**, because the GRV has no absolute heading reference.
- **No clear-tare.** Manual §6.4.4.3: Tare subcommand **0x02, Set Reorientation**, with an all-zero Q14 quaternion clears the run-time tare; the same command with a real quaternion sets an arbitrary mounting rotation without any physical alignment ritual. A persisted tare needs the System Orientation FRS record deleted instead. Today a bad tare survives until `reset` (and a bad *persisted* tare survives that too).

### 3.3 ME calibration writes more than it says

`ConfigureMECalibration` zeroes `planar_accel_cal_enable` and `on_table_cal_enable` on every write, so any `enable_calibration` message silently disables both. Neither is reachable from OSC, and `on_table` is the closest BNO analogue to the x-imu3's `gyroscope_offset_correction_enabled` that mubone leans on.

Also: magnetic-field reports are subscribed only when bit 2 is set, but nothing ever unsubscribes them — clearing bit 2 leaves the mag stream running until the next reset. And when they are on they run at the master rate (up to 400 Hz) where the calibration procedure only asks for 50 Hz, on a bus the firmware TODO already measures at 71–82 % of the tick.

### 3.4 Settings do not survive a power cycle

Only `sampling_rate` carries `tag_session_data`. `enable_calibration` and `disable_magnetometer` do not, so after every boot the hub reverts to its own defaults — mag-referenced Rotation Vector, no mag reports — and whatever set them has to notice and re-send. The runtime restores session data *before* components initialize (`sygbr-runtime.hpp`, the storage-ordering comment), so tagging those two would make the sensor boot into the configuration it was left in. This is the single change that most reduces what a GUI has to babysit.

### 3.5 Range metadata is wrong for a describe-driven UI

Both int endpoints use the `slider_message` defaults, min 0 / max 1 / init 0 — so `/syg/describe` advertises a 3-bit bitfield as a 0..1 slider. Nothing clamps on the way in (the driver hand-clamps `sampling_rate` precisely because the framework does not), so the values still work; only any UI generated from the description is wrong. Declaring `int, 0, 7, 7` and `int, 0, 1, 0` fixes it.

### 3.6 Reads the driver already performs but never publishes

- `ProductIDResponse` (reset cause, SW version, part number, build) is waited for during reset and discarded. Useful for "which firmware is in this sensor", and the reset-cause byte is the only clue when a sensor brown-outs mid-set.
- Every input report carries 2-bit accuracy (0 unreliable → 3 high). Only the magnetometer's is published (`magnetic_status`); the rotation vector's is dropped in favour of its radian accuracy estimate — which the Game RV does not have, so with mag disabled `/BNO085/accuracy` freezes and there is no quality indicator at all.
- `hint_stats` (I2C retry/edge counters) go to `printf` on the USB CDC every 100 000 messages rather than to endpoints.

### 3.7 Rates are one knob for three subscriptions

`sampling_rate()` sets gyro, linear acceleration and the rotation vector to the same interval. mubone's cursor needs only the quaternion; gyro and accel are paid for whether or not anything downstream reads them. `set_report_interval()` is already per-report — this is an endpoint-shape decision, not new mechanism.

## 4. What the part can do that the firmware does not — **NOT IMPLEMENTED**

### 4.1 The "ignore mag" spectrum

mubone's x-imu3 config pins `ahrs_ignore_magnetometer: true` because mag is unusable next to speakers and stage metal. The BNO's equivalent is not a flag but a choice of which fused output to subscribe, and there are more than the two the firmware offers:

| Report | ID | Heading reference | Notes |
|---|---|---|---|
| Rotation Vector | 0x05 | magnetometer | exposed today (`disable_magnetometer` = 0). Heading is absolute; corrections arrive as steps |
| Game Rotation Vector | 0x08 | none (gyro + gravity) | exposed today (`disable_magnetometer` ≠ 0). Yaw drifts; pitch/roll stay honest |
| Geomagnetic RV | 0x09 | accel + mag, no gyro | low power, low rate — not interesting here |
| **ARVR-Stabilized RV** | 0x28 | magnetometer, smoothed | mag correction applied *only while moving*, so heading never visibly jumps |
| **ARVR-Stabilized Game RV** | 0x29 | none, smoothed | the drift-corrected GRV without the steps. The most promising unexplored option for a gestural instrument |
| **Gyro-Integrated RV** | 0x2A | either, configurable | high-rate low-latency: gyro integrated every sample, periodically corrected against a slower fused vector. Optional forward prediction |

The ARVR-stabilized pair is configured by FRS records (§4.2) and is otherwise a drop-in: same quaternion payload, same subscription mechanism. The gyro-integrated RV is not a drop-in — it arrives on its own SHTP channel (5, which the driver names but never handles) with **no report ID, sequence or status prefix**, so `handle_message_()`'s `report_length[buffer[0]]` walk would misparse it. It needs a channel-5 special case.

### 4.2 Fusion tuning lives in FRS records, and FRS is not implemented at all

`FrsReadRequest` / `FrsWriteRequest` / `FrsWriteDataRequest` and their responses are declared in `sygsp-bno085-sh2.hpp` and **no code sends or handles any of them**. That is the single largest missing capability: it gates everything in this section. The records worth reaching, with the manual's own defaults:

**AR/VR Stabilization** (`0x3E2D` for RV, `0x3E2E` for Game RV), manual §4.3.5. Unprogrammed records default to all zeros, i.e. no stabilization.

| Word | Field | Units / Q | Typical |
|---|---|---|---|
| 0 | Scaling — fraction of angular velocity usable to correct error | dimensionless, Q30, 0–1 | 0.2 |
| 1 | Max rotation — largest correction applied at once | radians, Q29, 0–π | 0.127 (7.3°) |
| 2 | Max error — error tolerated before a single-step jump | radians, Q29, 0–π | 0.785 (45°) |
| 3 | Stability magnitude — change required before the output updates | radians, Q29 | 0.0 |

Scaling and max rotation together are, in effect, "how hard is heading allowed to be pulled while you are moving" — the nearest thing the BNO has to the x-imu3's `ahrs_gain`.

**Gyro-Integrated RV Configuration** (`0xA1A2`), manual §4.3.24: reference data type (0x0207 Game RV — default — or 0x0204 absolute RV), synchronization interval (µs, default 10000 = 100 Hz), maximum error before a discontinuous snap (radians Q29, default π/6), prediction amount (seconds, Q10, default 0 = off), and alpha/beta/gamma filter coefficients. Forward prediction is the interesting knob: it trades a little smoothness for negative latency, which on a spatial cursor is directly perceptible.

Others: **System Orientation** `0x2D3E` (the record `persist_tare` writes — an arbitrary mounting quaternion, and the continuous version of the x-imu3's 24 discrete `axes_alignment` options); **Maximum Fusion Period** `0xD7D7` and **MotionEngine Power Management** `0xD3E2` (fusion CPU budget); per-sensor mount rotations `0x2D41` / `0x2D46` / `0x2D4C`; **Dynamic Calibration** `0x1F1F` — the DCD itself, readable and writable, which makes per-venue calibration snapshots stored on the host a real possibility; **Serial Number** `0x4B4B` (which physical sensor am I talking to, for multi-station rigs); detector configs for shake `0x7D7D`, pickup, flip, stability, circle.

### 4.3 Calibration commands

Beyond §3.1 and §3.3: **Clear DCD and Reset** (0x0B) is the escape hatch when a venue's magnetic environment has poisoned the stored calibration — currently unreachable, and the only alternative is a factory reflash. **Simple calibration** (0x0C, `sh2_startCal`/`sh2_finishCal`) and **interactive calibration** (0x0E) exist; the literate source explicitly defers them as under-documented.

CEVA's procedure (1000-4044) for what a calibration wizard would have to walk the player through: enable all three cal bits, subscribe Game RV **and** magnetic field at ≥50 Hz, watch the mag status bit; 4–6 distinct orientations held ~1 s each (accel), 2–3 s stationary (gyro), ~180° and back on each of roll/pitch/yaw at ~2 s per axis (mag) until status reads 2–3; then save. It also states the thing that matters most for mubone's use: calibration is specific to a magnetic environment, and should be redone whenever the device moves to a new room.

### 4.4 Per-sensor feature flags

`SetFeatureCommand` carries fields the driver always writes as zero: change-sensitivity enable + absolute/relative threshold, batch interval, wake enable, always-on enable, and a sensor-specific config word. The `FeatureFlag` helpers (`change_sensitivity()`, `wake_up()`, `always_on()`) are written and unused. Change sensitivity is the interesting one on a bus the firmware TODO says is the bottleneck: report only when the value has moved by more than a threshold.

### 4.5 Diagnostics and free gesture detectors

Unimplemented commands: Errors (0x01), Counter get/clear (0x02), Initialize (0x04), Get Oscillator Type (0x0A), Bootloader/DFU (0x0D). Unimplemented reports that cost nothing to subscribe: gravity (0x06), uncalibrated gyro (0x07, which exposes the bias estimate separately), uncalibrated mag (0x0F), raw accel/gyro/mag (0x14–0x16), tap (0x10), step counter/detector (0x11/0x18), significant motion (0x12), stability classifier/detector (0x13/0x1C), shake (0x19), flip (0x1A), pickup (0x1B), tilt (0x20), circle (0x22). The stability classifier in particular ("on table", "stationary", "motion") is free information about whether the player is holding still.

## 5. Building the mubone panel

### 5.1 Prerequisite: the app cannot currently send an int

*(History: that encoder was deleted with the sensor-mapping rows 2026-09-25; the control path is `js/sygaldry.js`.)* `electron-main.js:_encodeOSC` encoded **every** finite number as `,f`, with an explicit "int support can be added later" comment. The sygaldry binding compares type strings exactly, so `/BNO085/enable_calibration 3.0` is parsed, matched against `,i`, and dropped without a word. Bangs already work: `values: []` produces a lone `,` which is what a `bng` endpoint expects. So step one is an int path through `sendOSCExternal` — otherwise the two most useful controls fail silently.

### 5.2 Transport

| Path | Works where | Cost |
|---|---|---|
| **Electron UDP** to the Pico's IP `:49170` via `sendOSCExternal` | Electron only | low — the socket and encoder existed for the sensor-mapping rows (`js/osc-out.js`, `sendOSCExternal`) and were deleted with them 2026-09-25; git history has them |
| **Direct WebSocket OSC** from the renderer to the Pico `:80` | Electron (page is `file://`, so `ws://` is allowed); **not** the hosted build or `https://localhost:4443`, where mixed-content blocking kills `ws://` and the Pico cannot serve `wss://` | medium — binary OSC framing in JS, but it is a direct bidirectional channel to the sensor with nothing in between |
| **Node proxy**, the `proxy.js` / port-8081 pattern already used for x-imu3 WiFi discovery | everywhere, including hosted | highest — another process to run |
| SLIP OSC over USB CDC | tethered | already the debug channel; not a performance path |

Recommendation: Electron UDP first, because it is a few lines on top of what exists and matches the rig. The WebSocket path is what makes a browser-only BNO panel possible later, and is the reason the firmware carries a WebSocket transport at all.

### 5.3 Shape of the panel

The x-imu3 model in `js/ximu-settings.js` is: a table of enforced values, re-asserted on every connect, read back, and anything that did not take gets a warning. That model **half** transfers. The BNO answers `GetMECalibration` (cal bits) and `GetFeatureRequest` (the interval the hub actually adopted, already surfaced as `/BNO085/configured_rate`), and FRS records are readable once §4.2 exists — but there is no read-back for tare state or for which rotation vector is subscribed. So enforcement can be verified for calibration config and report rates, and for everything else the panel is asserting into the dark. Fixing §3.4 (persist the settings in the sensor's own flash) is worth more than any amount of re-assertion.

Two ways to source the control list: hardcode a table like `ximu-settings.js`, or bang `/syg/describe` at connect and generate the panel from the reply (name, type, range, per endpoint, one message each). Describe-driven is the better fit here — the firmware is under active development, the endpoint set will keep moving, and a stale hardcoded table fails silently. It needs §3.5 fixed first, and a `/describe/*` handler in `js/osc.js`.

Sensible order of work: §3.4 (persistence) → §5.1 (int encoding) → §3.2 (zero-heading endpoint, tare basis, clear tare) → §3.1 (save-DCD fix) → panel → FRS read/write → ARVR-stabilized RV and the gyro-integrated RV experiments.

## 6. To verify on the rig

- That `persist_calibration` really is enabling periodic save rather than saving (read the DCD back, or watch for the absent response). The command-number reading is from the manual and CEVA's driver, not from observed behaviour.
- Whether `on_table_cal_enable` at P5 exists in the firmware revision on these parts — manual v1.2 lists P5 as reserved, and the field comes from a later revision. Read the part's SW version out of `ProductIDResponse` first.
- Whether the hub honours a 400 Hz request for three reports at once. `/BNO085/configured_rate` now answers this; datasheet §6.9 only promises 0.9×–2.1× of the request and warns that not all sensors can run at maximum simultaneously.
- Whether the ARVR-stabilized Game RV actually feels better than the plain Game RV on a moving player. This is the experiment the whole FRS effort is for.

## Sources

- [SH-2 Reference Manual v1.2 (1000-3625)](https://cdn.sparkfun.com/assets/4/d/9/3/8/SH-2-Reference-Manual-v1.2.pdf) — §4.3.5 AR/VR stabilization, §4.3.24 gyro-integrated RV config, §6.4.4 tare, §6.4.7 ME calibration, §6.4.8 periodic DCD save, §6.5 input reports
- [BNO080/BNO085 Sensor Calibration Procedure (1000-4044)](https://xdevs.com/doc/CEVA/BNO080-BNO085-Sesnor-Calibration-Procedure.pdf)
- [BNO08X Datasheet](https://www.ceva-ip.com/wp-content/uploads/BNO080_085-Datasheet.pdf)
- [CEVA/Hillcrest `sh2.h` driver API](https://github.com/hcrest/bno080-driver/blob/master/sh2.h) — `sh2_saveDcdNow` vs `sh2_setDcdAutoSave`, `sh2_setReorientation`, `sh2_clearTare`, `SH2_CAL_*`

### From the settings dialog

Cut from the settings rows on 2026-09-14 when descriptions went to one sentence under 92
characters (align-audit R5). The rows keep the sentence that says what the control does; this is
everything else they were carrying. **Checked before appending: only 7 of the 40 distinctive
clauses across all nineteen cuts appeared anywhere in docs/ beforehand, so this is not a
duplicate of what follows — for most of these rows the settings dialog was the only place the
information existed.**

**Calibration.** The chip's own bias learning, one routine per sensor, off on every boot: the device readout is what is actually on. Accel and gyro for a show; the mag routine only matters with the magnetometer on and streams mag reports at the full rate. The gyro learns its bias only while the sensor is still on a surface, three seconds or more, and the bias moves as the board warms — power on early, rest it on a table, then zero heading. Every change here is one write that also clears the sensor's on-table gyro calibration, a firmware bug, so set the boxes once and leave them.

**Magnetometer.** On, heading holds to a global north but bends near metal and jumps as you move. Off, heading has no reference: gestures are precise and the heading drifts at the rate of the gyro's bias. Off for a show. The sensor boots with it on and nothing re-sends this, so switch it off after every power-up.

**Access Point.** The instrument's own network at 192.168.4.1, no router in the path: a laptop that joins it gets an address from the instrument and a 6 ms round trip. Off on every boot whatever it was before, so switch it on after each power-up; switching it off while connected through it drops this connection.

**Access Point Name.** What the network is called and its password. The instrument keeps both and reports neither; blank is the instrument's own name and its factory password. Read when the access point comes up, so setting them restarts it if it is on.

**Router.** Join a network. The instrument keeps the name and password and reports neither back — the Uplink row says which one it was last asked for. Joining over wifi drops this connection while it moves; the cable is quicker.
