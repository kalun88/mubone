# Sensors round ten — the page, and the rig pills

> **Status: ARCHIVED 2026-09-05** — shipped same day (#314). The eleven rulings are condensed into one paragraph in `docs/RULINGS.md` (§ Plans that shipped). Record only.

> **Status: CURRENT** — written 2026-09-01. A brief for one round of work on the sensors page
> (`#imuSetupModal`, hosted as Settings → Sensors) and the two chrome pills.
> Mockups: `docs/mockups/sensors-10b.png` (the page, resting), `docs/mockups/pills-10c.png`
> (the pill states). Geometry comes from `docs/SETTINGS-GUI.md` § 2–3; the pill is instrument
> scope and answers to `docs/INSTRUMENT-GUI.md`. **Nothing here adds an element to either kit.**
>
> **Amended on the rig, same day (Ek):** R4 is REVERSED — the two layers are back, renamed
> **Software settings / Device settings** — and the three disclosure doors are gone: the card
> scrolls, Axes and the Command log included. § 5's checks #2/#3 now assert 1–2 layer heads and
> zero doors. The device-settings rows carry certainty markers: a live `device: …` readback
> where the firmware publishes one (calibration bits, configured rate), a `sent hh:mm` stamp
> where it does not (magnetometer, tare). The attach choice expands IN PLACE — the floating menu
> covered the list rows under it. Shipped as #314/#315. **Second amendment (#316):** "Feeds the
> sphere" is deleted — a selected role just works (`setRole` implies feeding); the standing
> wifi-join warning note is gone; the calibration flags are three stacked kit toggles; and R8 is
> reversed — the nine measurements came home to the card as an "Instrument diagnostics" block
> under Device settings, painted by the block's own painter. Diagnostics keeps its computed
> judgements only. **Third amendment (#317):** every network fact and control is ONE Wi-Fi
> section (Router: ssid + password + Join on one line, the join caveat in its description;
> Uplink: dot + status + address + radio + Disconnect; then Listening and Traffic); the
> Connection row and the Show checkbox are gone. And the pill's word derives from `via` first,
> everywhere — a sygaldry instrument is FILED under transport 'osc' whatever the wire, so the
> pill read "osc" for a wifi BNO; `declareSensorKind` now re-syncs sensor-status, the osc word
> is appended only when nothing else is up, and `SENSOR WIFI` is what a wifi instrument says.
> **Fourth amendment (#320): S1 is superseded — Rescan is the ONE attach verb.** The header's
> Add-over-USB button and its two choices are gone: in Electron every row carries its own Connect
> (the mubone tty's included, through sygaldry's filtered request), and in browser mode Rescan IS
> the WebSerial permission picker, routed by USB vendor after the pick — safe there because a
> person picks; Electron's auto-answering chooser never receives an unfiltered request.

---

## 1. What is wrong

The markup is not off-standard — it uses the kit correctly. The *shape* of the page is the
problem. Counted on screen, 2026-09-01:

- **four organising devices** on one page: a Sources table, a device list, and two layer
  headings (“In mubone”, “On the instrument”);
- **25 rows** in the selected sensor, behind three disclosure doors;
- **six ways to attach a sensor**: `Add USB device`, `Connect over USB`, `Rescan` in the list
  head, `Rescan all` in the title bar, per-row `Connect`, per-row `✕`;
- **three controls that set a zero**, with three names and five buttons between them:
  Mounting (`Calibrate` / `Clear`), Heading (`Zero heading`), Sensor zero (`Tare now` /
  `Persist`);
- **nine measurements** — orientation quaternion, report rate, fusion accuracy, reports lost,
  buttons, Wi-Fi station status, station IP, WebSocket clients, sequence number. Nothing in
  that list is *set*; every one is *read*.

The last point is not a new ruling. `index.html` already draws the line, above the diagnostics
panel: *Sensors is what a thing IS and how it is SET; this is what you measure.* The instrument
block crossed it.

## 2. The rulings

**R1 — The Sources table goes.** Its three rows carry no control, which the page's own comment
already calls documentation rather than rows. The facts fold into the list head as one line
(`1 more found · wifi 2 · usb 1 · osc none`) and reappear **in full as the empty state**, which
is the only moment that copy tells anyone anything. `renderSources()` writes the summary line
instead of three badges; `#imuWifiStatus` / `#imuSerialStatus` / `#imuOSCStatus` retire with it.

**R2 — One word per transport: `wifi`, `usb`, `osc`.** `_TRANSPORT_WORD.serial` becomes `usb`
(ui-imu-setup.js:557). A cable is USB to the person holding it; *serial* is the API's word. One
word everywhere in the sensor UI, and all three fit a fixed slot, which R9 depends on.

**R3 — Six attach controls become three.** `Add over USB` and `Rescan` in the list head, and
per-row `Connect`. `Rescan all` in the title bar goes (it was the same verb twice), `Blink`
stays on connected rows, `✕ forget` stays on remembered instruments. See **S1** before merging
the two USB buttons.

**R4 — Both layer headings go.** Who owns a setting — mubone or the device — is our problem,
not the player's. Order the rows by how often they are touched instead.

**R5 — Three zeros become one row, “Where forward is”.** Two buttons: `Set mounting` (the whole
pose, once per mounting) and `Zero heading` (yaw only, before each set), plus a quiet `Clear`.
The status reads in the description: *Mounting set · heading zeroed 20:14*. This changes
behaviour — see **S2**.

**R6 — The Axes door loses a column.** `NWU` and `Maps to` are the same fact stated twice;
the heading already says NWU is fixed. Six columns to five.

**R7 — One door for the device's own storage,** titled *Instrument settings*: sampling rate,
magnetometer, calibration, reset. Rendered only for sensors that have storage.

**R8 — The nine measurements move to Diagnostics** (`setPanelDiag`). What remains of them on
this page is the live `msg/s` badge beside the sensor's name, which is the one number you check
while setting a sensor up. See **S3**.

**R9 — The pills: fixed subject, fixed slot.** Both chrome pills become `● SUBJECT · slot`,
where the subject never changes and the slot is a **fixed 40px**. The dot carries state; the
slot carries the transport. A readout glanced at forty times a set must not change width, and
today both pills resize on every 200ms tick.

| state | dot | slot | when |
|---|---|---|---|
| absent | `--text-faint` | `—` | nothing on any transport |
| found | `--accent-warn` | `found` | announcing itself, not connected |
| up | `--accent-lock` | `wifi` / `usb` / `osc` | connected; steel is the token's own word for *a sensor feed you are not driving* |
| up, several | `--accent-lock` | `usb 2` | count only when >1; the transport shown is the one carrying the **cursor** |
| lost | `--accent-danger` | `lost` | it was up and the messages stopped |

**No third pill for OSC.** OSC is how a sensor got here, not a second question. One question per
pill; the transport is the answer's detail.

**R10 — the sensor pill must read state, not a picture of state.** It currently takes
`#sensorGroupStatus.textContent` from a hidden footer node and strips the brackets with a regex
(tile-layout.js:252-266). `main.js` already resolves the fact in `_updateSensorGroup()` from the
`sensor-status` event (`{connected, transports, count, devices}`) plus the OSC bridge flag. Have
it publish that object once — `S.rig = {up, transports, count, cursorVia, lost}` — and have the
pill read it. The footer block stays hidden and unchanged.

**R11 — `mic` → `input`, only if Ek says so.** The input pill's subject is currently its own
value: it reads `mic ready`, then `src: sampler`, and the word beside it moves. A fixed slot
needs a stable subject, so the pill would read `input · mic` / `input · live` / `input · file`.
**Ask before doing this one** — it renames something the player knows. Declined, the input pill
keeps jumping and the sensor pill still gets its fixed slot.

## 3. Work, by file

| file | change |
|---|---|
| `index.html` | `#imuSetupModal`: delete the Sources `.set-section`; rebuild `.set-devices-head` as two lines (count, then summary) + `Add over USB` + `Rescan`; delete the `.set-syg-status` line (its badge folds into the head); drop `Rescan all` from the borrowed head actions. `#sygInstrumentTpl`: split — settings rows stay, the nine measurement rows move to `#setPanelDiag`. |
| `js/ui-imu-setup.js` | `_TRANSPORT_WORD.serial` → `usb` (R2). `renderSources()` writes the head summary. `renderSensors()` head shows `N sensors` + summary. `renderSelected()`: drop both `.set-layer-head`s, six rows at rest, three doors, merged zero row. |
| `js/ui-sygaldry.js` | The block it lends the card keeps only the storage rows; hand the measurement rows to diagnostics instead. Keep the borrow pattern — the block is bound and may hold a half-typed network name. |
| `js/ui-diagnostics.js` | Receives the nine rows. Check first whether it already binds those OSC addresses (**S3**). |
| `js/main.js` | Publish `S.rig` from `_updateSensorGroup()`; keep the footer block's own text as it is. |
| `js/tile-layout.js` | `tick()` reads `S.rig` and writes the two pills; no text parsing, no regex. |
| `css/style.css` | `.mu-pill` gains a fixed-width slot span (`40px`, tabular numerals) and the four dot states. Append-only against the existing rule; do not restyle the pill's ground, height or hover. |
| `scripts/align-audit.js` | The five checks in § 5. |

## 4. Stop conditions

**S1 — the two USB buttons.** `imuSetupSerialRequest` and `sygConnectUsb` may call
`navigator.serial.requestPort()` with different filters. Measure that before merging them. If
they genuinely cannot be one picker, keep **one** button with a two-item menu and report the
reason; do not leave two buttons side by side.

**S2 — the third zero has a property the other two do not.** The instrument's own tare persists
across a power cycle; the app-side one does not. Before merging it into `Set mounting`, report
what that button should do on a device with storage — write both, or write one and keep a
`Persist` affordance inside the Instrument settings door. Do not silently drop persistence.

**S3 — do not duplicate the diagnostics rows.** If `setPanelDiag` already renders these OSC
addresses, bind the existing rows rather than adding a second set.

**S4 — an empty diff proves only that nothing visible moved.** Force each pill state and read it
back with `scripts/screen-probe.mjs`; measure `offsetWidth` on both pills across four states and
show they are equal.

## 5. Checks to add (`scripts/align-audit.js`)

1. Settings → Sensors renders **zero** `.set-table--sources`.
2. `#imuSetupSelected` renders **no** `.set-layer-head`.
3. At rest the selected sensor renders **≤ 6** `.set-row` outside doors, and exactly **3**
   `.set-row--disclose`.
4. Both `.mu-pill`s report the same `offsetWidth` across the states in R9's table.
5. No module reads `#sensorGroupStatus.textContent` (grep-level check, like the borrow ledger's).

## 6. Docs to update in the same round

- `docs/SETTINGS-GUI.md` — the sensors row in the page table; the *documentation, not rows* rule
  gains its empty-state clause.
- `docs/INSTRUMENT-GUI.md` — `.mu-pill` gains the slot spec and the state table from R9.
- `CLAUDE.md` — a row for this file in the doc table.
- `docs/TODO.md` — whatever S1 and S2 defer, with the reason.
