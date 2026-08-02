# Multi-Instance Plan — 3 stations, 1 machine

> **Status: CURRENT** · active plan · Phases 1–3 implemented 2026-07-27, Phase 4 (unattended robustness) still open. The operational checklist at the bottom is live.

> Context: installation with 3 lazy-susan "DJ surfaces". Each station = one mubone
> instance paired with one x-imu3 over WiFi. All three instances run on one
> machine (`npm run electron` ×3). Preliminary 2-instance test worked.
>
> Verdict from the architecture study: **3 Electron instances is the right
> architecture.** One-instance/3-sphere would mean tripling `S` (one `camQ`,
> `cursorQ`, `particles`, `grainParams`, one worklet engine, one VBAP bus, one
> preset bank — all singletons threaded through ~35k lines) and would put 3×
> render + scheduler load on one main thread whose timing budget is already
> tight. Three processes give per-station CPU **and crash** isolation — one
> station dying mid-show leaves the other two playing.
>
> This doc: everything that is currently crossed or fragile between instances,
> and the change plan to make multi-instance first-class.

---

## 1. Findings

### 1.1 Port map (who binds what)

| Port | Direction | Where | Multi-instance behaviour today |
|---|---|---|---|
| UDP 7500 (`OSC_PORT`) | in | electron-main.js:35, bound 127.0.0.1, **no reuseAddr** | First instance wins; others log EADDRINUSE warning and receive no OSC. |
| UDP 7501 (`OSC_OUT_PORT`) | out | electron-main.js:43 | Fine — client-side sockets, no bind. All instances send to the same relay, unlabelled (see 1.7). |
| UDP 10000 (x-imu3 discovery) | in | electron-main.js:192, `reuseAddr: true` | Broadcasts reach **all** instances — every instance sees all 3 device cards. OK because connect is manual (ui-imu-setup.js → `connectDevice`). |
| UDP 8000+ (x-imu3 data) | in | electron-main.js:227, per-port, `reuseAddr: true` | **Danger zone** — see 1.2. |
| UDP 9000+ (x-imu3 commands) | out | electron-main.js:298 | Fine — ephemeral client socket. |
| WS 8080 (Max bridge) | out-connect | osc.js:32 | Browser mode only; not in the Electron show path. |

### 1.2 IMU data routing — the one real cross-wire risk

Node's `reuseAddr` maps to **SO_REUSEPORT on macOS**. For *unicast* UDP
(x-imu3 data is unicast to the host), packets on a shared port are delivered
to **one** socket — effectively the last binder — not all of them. So if all
three IMUs keep the factory send port (8000):

- All three instances bind 8000; each packet reaches only one process.
- Two instances see frozen cursors, or worse, intermittent theft.
- Compounding it: imu-setup.js:586–598 routes inbound lines by source IP, but
  has a fallback — *"if no IP match, use first UDP device"*. A packet from a
  foreign IMU arriving on a listening instance gets attributed to that
  instance's own device → two quaternion streams fighting over one cursor.

**Required operational rule: each x-imu3 gets a distinct send port
(8000 / 8001 / 8002).** Then each instance binds only its own device's port
after connect, and nothing is shared. The preliminary test likely worked
because the two devices already had different ports — verify before trusting.

Hardening (code): restrict the first-UDP-device fallback to the
`_devices.size === 1` case and drop lines from unknown source IPs otherwise.

### 1.2b WiFi mode — why client mode is required for multi-sensor

Field finding (AP-mode tests, ~Apr 2026, one IMU per laptop): several sensors
went laggy while others were fine. Cause: **in AP mode each x-imu3 is its own
access point**, and three APs defaulting to the same channel form three
uncoordinated networks in one slice of spectrum — collisions, retries, hidden
nodes. Retry backoff hits unevenly, so only *some* sensors degrade. Separate
laptops don't help; the contention is in the air.

**Client mode (current setup) fixes this structurally** — all three sensors are
clients of one router, so a single AP schedules airtime across them. Same
channel, but coordinated rather than competing. No lag observed since the
switch (as of Jul 2026).

Keep it that way:

- Prefer 5 GHz, **non-DFS** channel (36 is what's in use). DFS channels
  (52–144) can stall for seconds on radar detection.
- Pin the router to a fixed channel; disable band steering so a sensor can't
  get bounced to 2.4 GHz mid-show.
- 5 GHz attenuates faster through bodies/walls — keep the AP in line of sight
  of the stations.
- **If you ever fall back to AP mode** (gig with no router), manually set
  non-overlapping channels per device (2.4 GHz: 1 / 6 / 11). Never leave all
  three on the default.

If lag ever does appear in client mode, the raw material for measuring it is
already on the wire and unused: every data line carries a device-side µs
timestamp (`dev.lastTimestamp`, written per packet, never read) and the stream
is a fixed 100 Hz — enough to derive true packet loss (timestamp-sequence
gaps), arrival jitter, and queuing delay (host−device clock vs its rolling
minimum) per device, without clock sync. Build the instrument then, not before.

### 1.3 Shared localStorage / userData — confirmed cross-hairs

All instances launched from the same app dir share one Electron `userData`
profile → one localStorage. Full key inventory:

| Key | Owner | Cross-instance damage |
|---|---|---|
| `mubone_audio_defaults` | ui-audio-settings.js:1370 | **Worst one.** Stores `inputDeviceId`, `mainInputChannel`, `outputDeviceId`, gains, buffer size. Station B saving defaults overwrites Station A's input channel → wrong mic on next launch. |
| `mubone_user_presets` | state.js | One shared patch bank; concurrent saves clobber. |
| `mubone_sensor_cal` (+ `_version`) | sensor-registry.js:1011 | Per-slot tare/axis-map shared across stations. |
| `mubone-sensor-prefs` | imu-setup.js:206 | Per-device prefs (by serial) — mostly OK since serials differ, but writes race. |
| `mubone_custom_speaker_angles` | ui-audio-settings.js:469 | Shared speaker layout — fine if identical, racing writes if not. |
| `mubone_key_map`, `mubone_midi_map` | midi.js | Shared bindings. |
| `mubone_sensorMappings` | sensor-mapping.js:484 | Shared gesture mappings. |
| `mubone_param_locks`, `mubone_staging`, `mubone_gesture_panel`, `mubone_osc_stream`, `mubone_radial_pins`, `mubone_projector_layout_v2`, `mubone_panel_*`, `mubone_sec_*`, `mubone_panel_order`, `mubone_bufferSize`, `mubone-learn-mode` | various | All shared; racy but low-stakes. |

Also: multiple Electron processes on one profile dir can contend for the
LevelDB lock — persistence in instances 2/3 may silently fail. Everything in
this table is fixed at once by giving each instance its own userData dir
(Phase 1, item 1). `ui-export.js` settings export/import already exists and is
the migration path for seeding each instance's profile from today's shared one.

### 1.4 Audio input / output — per-instance selection already works

Answer to "can I control which input each instance uses": **yes, today.**
In Electron the input path is RtAudio (`set-input-device` IPC), picked in the
audio settings modal per instance, including `S.mainInputChannel` — so all
three stations can share one multichannel interface, each taking a different
input channel. Output likewise via `set-audio-device`; CoreAudio mixes three
processes writing to the same device. The only problem is persistence
(1.3, `mubone_audio_defaults`) — solved by per-instance userData.

Watch: total CPU (3 × worklet + 3 × RtAudio streams) and per-instance
`baseLatency` drift. No code change expected.

### 1.5 Keyboard — focus-based, unfixable; OSC is the control plane

The OS delivers keys to the focused window only. Per-instance shortcut
schemes were rightly rejected. The control plane for the show is OSC: the
`ACTIONS` registry in midi.js (89 actions) already gives **every** action an
OSC address, and osc.js dispatches all of them. With per-instance OSC ports
(Phase 1, item 2), any controller — Max patch, TouchOSC, pedal bridge,
per-station hardware — targets a station by port. Focus becomes irrelevant,
which is what you want live anyway.

### 1.6 MIDI — cross-wired by design today

midi.js:350 subscribes to **all** MIDI inputs; three instances would all react
to every message from every controller. Either don't use MIDI for the show
(OSC instead), or add a per-instance input-device / channel filter (Phase 2).

### 1.7 Status publisher / joycon relay

All instances send `/status/*` to 127.0.0.1:7501 with no instance tag — a
relay consumer can't tell stations apart. Only matters if the joycon GUI is
part of the show. If so: prefix with instance name (`/status/{instance}/...`)
or per-instance `--osc-out-port`. Deferred otherwise.

---

## 2. OSC audit

Source of truth: `ACTIONS` in midi.js — every entry carries its OSC address
and format, and the keys/midi/osc panel renders that table in-app. Audit
result:

- **Complete coverage of the registry**: all 89 action ids have an OSC
  address, and every address in the table has a live `case` in osc.js
  `handleOSC()`. Addresses use current terminology (`/commit/*`, `/trace/*`,
  `/search/*`) — no stale `/seed`/`/seq` addresses on the wire.
- **Keyboard-only gaps (no OSC path):**
  - `x` → `S.radialMorphOn` toggle (events.js:538) — direct mutation, no
    action id, no OSC. Add `radial_morph` action + `/morph/radial` if the
    show needs it.
  - `Shift+F` → `dispatchAction('projector')` (events.js:585) — handled in
    dispatchAction (midi.js:501) but **absent from the ACTIONS table**, so no
    OSC address and invisible in the mapping UI. Add `/app/projector`.
  - Fullscreen (Electron IPC) — no OSC. Probably fine (set up once pre-show).
- **Live verification needed**: the table is self-consistent, but a wire test
  is the only proof. Checklist: with `localStorage.muboneOscTrace = '1'`,
  send each address from the show controller to each instance's port and
  confirm the monitor panel + UI feedback. The keys/midi/osc live monitor
  (midi.js:826+) already shows every inbound message including unhandled
  ones — use it as the test harness. Priority addresses for the show:
  `/trace`, `/cursor/tare`, `/cursor/scan`, `/preset`, `/commit/drop|draw|release|clear`,
  `/sweep`, `/undo`, `/session/erase`, `/mute`, `/master/volume`, `/search/radius`.

---

## 3. Change plan

### Phase 1 — required for the 3-station setup — **implemented (items 1–3)**

> Solo use is untouched: no flags → default profile, OSC 7500, same title —
> byte-identical to the previous behaviour. Instance profiles live under
> `<userData>/instances/<name>` and are only created when `--instance` is
> passed. No prefix scheme — ports are the instance address.

1. **Per-instance profile** (`electron-main.js`, ~15 lines).
   Parse `--instance=<name>` (fallback: `MUBONE_INSTANCE` env). Before
   `app.whenReady()`:
   `app.setPath('userData', path.join(app.getPath('userData'), 'instances', name))`.
   No flag → unchanged default profile (normal solo use untouched). Append
   the name to the window title: `mubone [a]`.
2. **Per-instance OSC listen port** (`electron-main.js`).
   `--osc-port=<n>` (default 7500) → `startOSCReceiver(port)`. Renderer needs
   no change (OSC arrives via IPC). Convention: a=7500, b=7510, c=7520.
3. **Launcher**. `scripts/run-stations.sh` (or three npm scripts) spawning:
   `electron . --instance=a --osc-port=7500` etc. Beats three terminals.

   **Packaged-app note:** macOS Launch Services will not start a second copy
   of an installed `.app` on double-click — it just activates the running one.
   The app itself is fine (no `requestSingleInstanceLock` in the code, and the
   flag parsing is identical when packaged); the launch mechanism is what
   differs. From an installed build, each station must be started with:

   ```
   open -n -a /Applications/mubone.app --args --instance=a --osc-port=7500
   ```

   `scripts/launch-stations.command` wraps this — double-clickable from Finder
   or the Desktop, `COUNT` at the top sets how many stations. Dev checkout uses
   `npm run stations`; installed app uses the `.command`. Both produce the same
   naming/port convention (a=7500, b=7510, c=7520), and both share the same
   per-instance profiles under `~/Library/Application Support/mubone/instances/`.
4. **Operational**: set distinct x-imu3 send ports (8000/8001/8002) via the
   x-IMU3 GUI; one manual connect per instance; seed each instance's profile
   via ui-export settings export/import; verify with the pre-show checklist
   below.

### Phase 2 — hardening

5. **Data-routing guard** (imu-setup.js) — **implemented.** Fallback to
   first-UDP-device only when exactly one device is connected; otherwise
   unknown-IP lines are dropped and counted (`?debug` warns every 400).
6. **Instance badge in-app** — **implemented.** Instance name rides
   `additionalArguments` → preload `electronBridge.instanceName` → badge in
   the top bar next to the version. Solo (no flag): no badge, no DOM change.
7. **OSC additions** — **implemented.** `/app/projector` (action was in
   dispatchAction but missing from ACTIONS — now mappable) and
   `/morph/radial` (new `radial_morph` action; the X key now routes through
   dispatchAction so keyboard/MIDI/OSC share one path).
8. **MIDI input filter** per instance — **implemented** (promoted from
   deferred once the FCB-1010 entered the rig: CoreMIDI delivers the pedal to
   every instance, not just Max). "midi: on/off" toggle in the keys/midi/osc
   modal, persisted per profile (`mubone_midi_input`), default ON. Turn OFF
   on all three stations; the pedal then reaches them only via Max → OSC.
9. **Status-publisher instance prefix** — deferred; only if the joycon relay
   is used.

### Phase 3 — show control plane (FCB-1010 → Max → stations)

Rig: FCB-1010 MIDI pedal → Max patch → per-station UDP ports.

**Decided: the show patch sends with plain `[udpsend 127.0.0.1 750x]` ×3** —
no node.script dependency at showtime. Station switching lives in the patch
(gate/route in front of the three udpsend objects). bridge.js stays as the
browser-mode relay (collaborator demos) and as an optional convenience; it
also understands stations now (a=7500, b=7510, c=7520, matching the
launcher):

- `[setstation b]` — route subsequent messages to station b (default: a, so
  existing solo patches behave exactly as before)
- `[setstation all]` / `[to all /sweep]` — roster broadcast (roster set via
  `[setstations a b c]`)
- `[to b /trace 1]` — stateless one-shot targeting, ideal for `[prepend to b]`

Remaining (Max-patch side, not repo code):

- FCB-1010 mapping in Max. Suggested layout: 3 switches = station select
  (send `setstation a|b|c` — mirrors "which lazy susan am I driving"),
  remaining switches = actions on the selected station (`/trace`,
  `/cursor/tare`, `/commit/drop`, `/sweep`, `/preset` bank…), expression
  pedals = `/master/volume` and `/morph/position` (or `/monitor/volume`).
- Wire test (§2 checklist) through the real chain: pedal → Max → each port,
  in-app monitor open, all three instances running.

### Phase 4 — unattended robustness (future; operator present for now)

- Pin instance → sensor serial with auto-connect on launch
- Sensor dropout watchdog (500ms, stale flag in top bar)
- Battery in top bar + low warning
- Summed-headroom guard / per-instance trim; station keep-alive script

### Explicitly not doing

- Single-instance multi-sphere simulation (core rewrite, violates "main stays
  playable", worse for scheduler timing).
- Per-instance keyboard shortcut schemes (OS focus makes this a trap).
- URL flags / feature flags for any of this (see CLAUDE.md) — instance
  identity is a process-level CLI arg, not an app flag.

## 4. Pre-show checklist (operational)

- [ ] Three x-imu3 devices on the shared router, distinct send ports 8000/8001/8002
- [ ] Router AP isolation OFF (discovery broadcasts must reach the host)
- [ ] Launch 3 instances via launcher; confirm 3 distinct window titles
- [ ] Each instance: connect its own IMU only; tare; confirm the other two cards stay disconnected
- [ ] Each instance: audio settings → its own input channel on the shared interface; save defaults; relaunch; confirm they stick per-instance
- [ ] OSC wire test per §2 against all three ports
- [ ] Kill one instance mid-audio; confirm the other two are unaffected; relaunch it
- [ ] Full 3-station jam with all IMUs spinning on the lazy susans
