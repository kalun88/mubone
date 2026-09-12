# Rig runbook — the mubone instrument at a venue

> **Status: CURRENT** — written 2026-08-31 from a session that diagnosed a jittery cursor down to
> its causes and measured each one. Every number below was taken off the rig, not estimated. This
> is an operating procedure; `docs/BNO085-CONTROL.md` is the firmware reference behind it and is
> the place to look when something here needs explaining rather than doing.

---

## 1. The topology

    laptop ──ethernet── Netgear AC1750 ──2.4 GHz── mubone instrument

Ek carries the router. That matters more than it sounds: it means **no audience is ever on your
network** — their phones are clients of the venue's WiFi, which is a different network — and it
means the channel is yours to change at any time, including after doors, without finding anyone
with admin access.

The laptop is on **ethernet**, so there is exactly one wireless hop in the whole path. Keep it that
way. It is the best this hardware can do.

**The instrument is 2.4 GHz only and no setting changes that.** `PICO_BOARD pico2_w` →
Infineon CYW43439, a single-band 802.11n part. The router's 5 GHz band is unreachable.

## 2. Router settings — set once, never change

| setting | value | why |
|---|---|---|
| Mode | **Up to 217 Mbps** | 20 MHz. "450" is 40 MHz bonding: on 2.4 GHz it swallows two of the three non-overlapping channels, collides with the neighbours, and buys nothing — the CYW43439 is single-stream 20 MHz regardless |
| Channel | **1, 6 or 11 — never Auto** | Auto can hop mid-set and drop the link. § 3 picks which |
| Security | **WPA2-PSK [AES]** | Not mixed WPA/WPA2: TKIP forbids 802.11n rates, so the AP silently falls back to 54 Mbps and the Mode setting stops meaning anything. Not WPA3 — the Pico SDK's support is unreliable |
| SSID broadcast | **on** | Hiding it is not security (the name is in every association frame) and it costs the instrument real reconnect time: with no beacons it must probe actively, and this link does drop |
| WPS | **off** | Brute-forcible PIN, and credentials go in through mubone's Network row anyway |
| Band SSIDs | **different names per band** | With one shared SSID, band steering keeps trying to move the instrument to 5 GHz, which it physically cannot join |
| 20/40 coexistence | on | Inert at 20 MHz; it is the failsafe if Mode is ever reset |
| Address reservation | **reserve the instrument's IP** | mubone reconnects to a remembered address. A DHCP change silently breaks the Connect button |

**Use a throwaway password on this network.** `/syg/describe` publishes `/WiFi/password` in
plaintext to anything that opens a WebSocket to the instrument — no authentication. On a rig
router that costs nothing; on a home network it is a real exposure. See § 7.

## 3. Choosing the channel, at each venue

Only three 2.4 GHz channels do not overlap: **1, 6, 11**. Scan from where the laptop will be:

    system_profiler SPAirPortDataType | sed -n '/Other Local Wi-Fi Networks/,$p'

Diagnostics → WiFi channel does this from inside the app. **Grant mubone Location Services**
(System Settings → Privacy & Security) or macOS returns every SSID as `<redacted>` — channels and
signal strengths still come through and the survey is usable, but your own network cannot be told
apart from a neighbour's.

**This Netgear R6400 (firmware V1.0.1.78) does not honour its own 2.4 GHz channel setting.**
Selecting 11, applying, and rebooting left the radio on channel 4; the form showed 11, ADVANCED
Home showed 4, and an over-the-air scan agreed with the status page. WPS is greyed out on this
build, so the usual culprit could not be ruled out either way. **Do not spend load-in time fighting
it** — on channel 4, beside a second router, the link still measured 0% loss and a 25 ms worst gap.
Scan to know what the room looks like; if the router will not move, take the reading and get on
with the soundcheck.

**Trust the router's STATUS page, not its form.** On a Netgear the Wireless Setup page shows what
is typed in the box; ADVANCED Home shows what the radio is actually on. They disagreed on
2026-08-31 — the form said 11 and the radio was on 4 — and the survey was right.

What to look for, in order:

1. **Which channel is the venue's own WiFi on? Avoid it.** This is the rule that survives the doors
   opening. Audience phones are clients: they transmit on the channel of the network they joined,
   so a full house piles onto the venue AP's channel and nowhere else. Scanning for "empty" measures
   the room before the people arrive; scanning for "where the venue AP is" predicts where they will
   be.
2. **Weight by signal, not by count.** −55 dBm is about a thousand times the power of −84 dBm. Four
   distant APs are nothing; one close one is the whole problem.
3. **Near catering, prefer channel 1.** A microwave oven hammers ~2450 MHz, which is channels 8–11.

**A full room costs you signal.** Bodies absorb 2.4 GHz — several dB between an empty soundcheck
and a full house — so the link is measurably worse at showtime than when tested. Put the router
**close to the performer, elevated, line of sight**, not at FOH.

## 4. Pre-show checklist

**The instrument forgets almost everything at power-up.** Only `sampling_rate` and the WiFi
credentials carry `tag_session_data`. Every boot lands on *magnetometer on, calibration off* —
which is the worst combination, and gives a cursor that jitters and swings.

1. **Cable in.** Settings → Sensors → mubone instrument → Connect over USB.
2. **Sensor → Calibration**: tick **accel and gyro**, once, and leave the row alone. It reads 0 on
   every fresh boot however it was left. Mag calibration is for a magnetometer you will play with
   on; with it off it only streams mag reports at the full rate. Every change to the row is one
   write that also clears the sensor's on-table gyro calibration (firmware, `BNO085-CONTROL.md`
   § 3.3), so set it once (2026-09-10).
3. **Still, and warm.** The gyro learns its bias — the whole of the drift with the magnetometer off
   — only while the sensor is still on a surface for three seconds or more, and the bias moves as
   the board warms for several minutes. So: power on ten minutes early, rest the sensor on a table
   or its case, not in a hand and not on the stage floor by a sub. Rest on six faces (~2 s each)
   if the accelerometer is suspect; the figure-8 is the magnetometer's and is skipped for a mag-off
   show. Gyro bias is the sensor plus temperature, never the room — only the magnetometer's
   calibration is venue-specific.
4. **Watch the Fusion row.** The ± figure is the go/no-go: it starts near ±97° uncalibrated and
   should fall into single degrees. Measured 97.6° → 7.3° from the gyro settling alone. With the
   magnetometer off the figure freezes — the Game Rotation Vector publishes no accuracy.
5. **Zero heading in mubone** (`` ` ``), last, facing the stage — and again at every pause; put the
   instrument down still for a few seconds in a pause so the bias re-trims. The hardware
   **Sensor zero** row is disabled (2026-09-10): its tare is taken against the magnetometer's
   heading even with the magnetometer off, and a heading tare cannot be persisted against the
   Game Rotation Vector, which has no north. mubone's zero is exact at every attitude since
   2026-09-10 (`sensor-audit.js` § B2).
6. **Magnetometer off for the show.** The app does not re-send it: every boot is mag on until
   this switch is flipped. The firmware's own words: with it on,
   "magnetic distortions may cause the heading to shift consistently but in surprising ways"; with
   it off, estimates "tend to be more accurate, especially if the magnetic environment is
   challenging." A stage is challenging — speakers are magnets, plus truss and lighting. A slow
   drift corrected by a tare between pieces is predictable; a heading swing when you pass a wedge is
   not, and it happens mid-phrase.
7. **Sampling rate 200 Hz.** See § 5.
8. **Decide cable or wifi.** See § 6.
9. **The audio interface — on a MOTU, on a borrowed one, on the built-in** (#332, #333). Three
   things, in this order, because the loop engine steers by them:
   - **Make the interface the OS default output too.** The engine's clock is the system default
     device's; RtAudio's is the interface's. When they are different devices they drift, and the
     hops then drop or repeat a block now and then to stay bounded. One device, one clock.
   - **Settings → Audio → Stall cushion.** 20 ms is the default and holds a 20 ms freeze without a
     dropout; 10 is tighter to sing against on a healthy machine; 30 or 50 if the set has
     dropouts. The row shows the queue and the ring live, so a drift shows before it is heard.
   - **Settings → Audio → Latency → Measure**, with the output reaching the mic (the house
     speakers, or a cable from an interface output into an input). The value is stored per
     input device × output device × rate × buffer × cushion, so a new interface, or a new buffer
     size, means a new measurement. Until then the row shows the estimate — a floor, not the
     truth. What it is for: an overdub lands where you sang it, a loop's edges land on your
     press and release.

## 5. Sampling rate

Measured over the cable, sweeping the rate:

| asked | device delivers | arriving |
|---|---|---|
| 400 | 320 | 264 — the runtime tick coalesces what it cannot send |
| 300 | 322 | 261 |
| **200** | **199.7** | **200.4 — full delivery** |
| 150 | 199.3 | 199.6 — the BNO quantises the interval; 150 and 200 are the same subscription |
| 100 | 99.8 | 99.6 — cleanest, but coarse |

**200 Hz is where the whole chain agrees.** Above ~320 the I2C bus cannot carry gyro + accel +
rotation vector at one interval, and `dropped_reports` climbs. This setting survives a power cycle.

## 6. Reference numbers — what good and bad look like

Identical 6-second measurement, three link states:

| | bad wifi (ch 6, two neighbours at −55/−64 dBm) | good wifi (own router, ch 11, 20 MHz) | cable |
|---|---|---|---|
| bundles lost | 6 – 32%, varying minute to minute | **0%** over 8 consecutive runs | 0% |
| stalls > 33 ms per 6 s | 12 – 39 | **0** | 1 |
| stalls > 100 ms | 4 – 30 | 0 | 0 |
| worst gap | **1346 ms** | 17 – 29 ms | 57 ms |
| p99 gap | ~140 ms | 10.7 – 14.1 ms | 8.8 ms |

The middle column is what a correctly set up dedicated router gives, and it is cable-grade. The
left column is what a shared channel with loud neighbours gives, and it is what "jittery, then
smooth, then jittery" looks like in numbers — the neighbours' traffic is bursty, so the stalls come
and go.

**Prefer the cable when it can reach.** WiFi can equal it, but only when the channel is clean, and
a venue is not a bedroom.

### Reading the page mid-set

- **Fusion** — the sensor's own heading confidence. Wide means jitter before it reaches the sphere.
- **Report rate vs the pill** — the row says what the device produced; the pill says what arrived.
  A gap between them IS the link loss. 199.5 produced against 141 arrived is 29% lost.
- **Reports lost** — the sensor's own sequence gaps. Rises when the rate is set past the I2C bus.
- **Traffic → ws-dropped** — the instrument's WebSocket only. On a cable it cannot move, and it
  never resets until the instrument reboots, so a large number there means nothing by itself.

## 7. Known gaps

- **The instrument forgets its configuration on every boot** (§ 4). mubone remembers; the
  instrument does not. Re-applying the wanted config on connect is unbuilt, and it is the one that
  would actually protect a show — a brownout mid-set brings the sensor back uncalibrated with the
  magnetometer on, and nothing on screen says so.
- **`/syg/describe` leaks the WiFi password in plaintext** to any unauthenticated WebSocket client
  on the LAN. Firmware issue.
- **The instrument cannot scan and does not report its own RSSI** — `sygbr-wifi.hpp` still says
  `TODO: wifi rssi, bssid`. So the channel survey in § 3 is taken from the laptop's position, not
  from the sensor on the performer's body, which is where it matters and which changes as they
  move. One `cyw43` call in firmware would fix this.
- **`persist_calibration` is not exposed in mubone**, because it sends SH-2 command `0x09`
  (*configure periodic DCD save*) where save-on-demand is `0x06` — so a button labelled "save
  calibration" would lie. Enabling periodic save is nonetheless what you want before a run of
  shows; see `docs/BNO085-CONTROL.md` § 3.1.
- **`/WiFi/channel` is ignored while the station is associated** — one radio, one channel. mubone
  can only set a channel in the instrument's own AP mode, never on a router it did not create.
