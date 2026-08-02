# Changelog

> **Status: HISTORICAL RECORD** — append-only release history, newest first. Only edited during an explicit release (see CLAUDE.md § Versioning). Older entries describe the code *as it was at that version*, not as it is now; for current behaviour read the reference docs, not this file.

All notable changes to mubone are documented here.
Format: newest version first. Entries written at the end of each working session.

---

## 1.12 alpha — 2026-08-02

**Covers 2026-07-29 → 2026-08-01 (TODO #147–#175).** Four working sessions: serial accessory support (Jul 30), the browser-mode audit and pot scaling (Jul 31), the storage-registry and export/import rework plus the x-imu3 settings enforcement (Aug 1), and a UI/UX pass (Aug 1).

Headline: **the x-IMU3's SA-A8 serial accessory drives app actions** — 8 analogue pots, sliders and buttons through the same `ACTIONS` table that MIDI, keys and OSC already use, with per-channel response curves set in the destination's own units. Alongside it, three audits closed: the **browser build works again** (the deployed demo is still five releases behind — see #152), **localStorage got a registry** so reset can be per-category and export can't drift, and the **x-imu3 connect handshake now enforces one settings table and reads it back** instead of four copies that had silently diverged.

### Added

#### Serial accessory — x-IMU3-SA-A8 (Jul 30, #147)
- **8 analogue inputs (12-bit, fixed 100 Hz) mapped to app actions.** The sensor already talked directly to the app, so this is a new `case 'S'` in `imu-setup.parseDataLine`'s existing switch, not a new transport — no Max in the path, no UDP port contention. New **`js/accessory-registry.js`**: per-channel role (`pot` / `slider` / `button` / `unused`), learned min/max calibration, one-pole smoothing + deadband on continuous channels, Schmitt trigger + edge detection on buttons, localStorage persistence, `window.acc` console API. New **`js/ui-accessory.js`** + modal: 8-row table with live volts/value bar, type dropdown, destination dropdown filtered by action type, per-row calibrate and invert.
- **Binds against the existing `ACTIONS` registry rather than duplicating it.** `midi.js` publishes `S._actions` / `S._dispatchAction`, so accessory channels, MIDI, keys and OSC share one source of truth and one mapping table. **Full 12-bit resolution survives**: `dispatchAction`'s 0–127 domain is not integer-only, so a pot passes a float through each `ccFn`'s `/127` — 456 distinct values across a sweep versus MIDI's 128, with zero refactoring.
- **Presence is observed from data flow, not configuration** — the adapter hot-plugs with no event, so a staleness timeout *is* the unplug signal. On unplug, held `hold` actions release (a stuck erase brush would be worse than silence) while continuous channels freeze at their last value rather than snapping to zero. Public API is addressed by **pad number 1–8** to match the silkscreen, not array index.
- Payload parsing note for anyone extending it: unlike `Q`/`I`, the accessory payload is passed through verbatim and contains its own commas, so field-count checks don't apply — everything after the timestamp is payload, and interpreting it is the accessory type's job.

#### Pot scaling — response curves + output windows (Jul 31, #155)
- **A pot can be given a response curve and confined to part of its destination's travel, set in the destination's own units** (`−600 ¢` to `+600 ¢`, `200 Hz` to `8000 Hz`) rather than percentages. New **`js/scale.js`**: `scaleControl()` (exponent γ then remap into `[lo,hi]`, both domain and codomain 0–1 so it composes with any destination) plus `toNorm`/`fromNorm`. Applied between the deadband check and the `×127` dispatch — **deadband stays on the raw value**, since checking it after shaping would make a narrowed pot's steps fall below the threshold and stop sending entirely. Stored **normalised**, so retargeting a pot keeps the same fraction of travel instead of corrupting the bounds. Written as a standalone helper so MIDI CC mappings can adopt it; deliberately not wired into `midi.js` yet.
- **Every cc `ACTION` now carries a structured `range: { min, max, unit, int, curve, maxFn }`**, and `fmt` is *derived* from it via `fmtRange()` instead of hand-written — 36 actions annotated. That collapses part of the debt of `ACTIONS` and `MAPPABLE_PARAMS` being two parallel range tables, and immediately caught a hand-written lie (`preset_select`'s label claimed "(1–20)" for a 40-entry list). Ragged cases documented rather than smoothed over: `grain_k`'s ceiling is the particle count so it uses `maxFn`; `recency_cc`'s `0 = all` is a sentinel *above* 16 and stays out of `range`.
- UI: `min` / `max` / `curve` columns in the accessory table, live in destination units, disabled for button and unbound rows, double-click to reset, and a violet pad number flagging any channel that isn't full-travel-linear.

#### x-imu3 settings enforcement (Aug 1, #175)
- **New `js/ximu-settings.js` — one table for the whole connect handshake**, 16 enforced keys plus a UDP-only overlay, each annotated with its manual section and the reason it's there. Every connect writes the table, sends `apply`, then **reads it back** — writes to the x-IMU3 are effectively unacknowledged, so until now a rejected or misspelled setting failed in complete silence. `verifySettings(dev)` warns per key 400 ms after `apply` (long enough for write echoes to drain), stores `{ ok, mismatched, unanswered, at }` on `dev.settingsVerify`, and **reports "no response" separately from a mismatch, under `?debug` only** — UDP command responses can simply be dropped, and treating that as a failure would cry wolf before every show. Second line of defence: `parseDataLine`'s `default` case counts unexpected message types and warns once per type per device after 20, which catches the case a read-back can't (reads back correct, isn't in effect).
- **Everything mubone doesn't consume is switched off at the device** — inertial, magnetometer, high-g, temperature, battery and RSSI divisors all 0. Only `Q` (cursor) and `S` (accessory) reach live code. Battery and RSSI still display; they arrive on the discovery announcement, a separate channel. **`serial_mode: 2` is enforced unconditionally**, accessory attached or not: SA-A8s get swapped between hosts mid-show, so silence on the `S` stream proves nothing and every sensor has to stand ready. It governs the expansion-connector UART, not the USB CDC port a `serial`-transport device connects through, so it can never threaten mubone's own connection.
- Full rationale, the enforced table with manual sections, the `apply`-vs-`save` note (the device saves to EEPROM on shutdown regardless — there is no session-scoped tier), and the known Max-patch conflict in **`docs/XIMU3-SETTINGS.md`**.

#### Reset, storage registry, and export/import (Aug 1, #157 · #159 · #161)
- **Reset is now per-category**, framed as "reset these" rather than "keep these": all boxes unchecked, confirm disabled until one is ticked, and a `select all + clear offline cache` row that is the old factory reset. There is no "defaults" mechanism and shouldn't be — defaults are whatever the modules initialise to on a cold boot, so per-category reset is *delete those keys and reload*. The reload IS the mechanism.
- **New `js/storage-registry.js` — the single authoritative key→category table** (35 keys, 8 categories, prefix entries for `mubone_panel_*` / `mubone_sec_*`, and a `LEGACY_KEYS` list). Three consumers read it: the reset dialog, the settings export, and `browser-audit.js`. It exports `unregisteredKeys()`, which is why a list is safe to own this time — **the audit boots the app and fails if any live key isn't registered.** Schema flags carry a `guards` list so a partial reset can't delete a migration flag while its guarded data survives (that would silently re-run an old→new remap over already-remapped values). Add a key to a module and the registry in the same commit.
- **Setup and session are now genuinely disjoint file types — setup is the rig, session is the music** (`EXPORT_VERSION` 3 → 5). A session no longer carries settings; it embeds its resolved patch as a detached deep copy plus `patchIndex` for the HUD label only. Import offers **merge** (default, non-destructive) or **replace** (`clearGovernedKeys()` wipes every registered category except `debug` first), with the dialog showing how many groups the file carries and how many of yours a merge would leave alone. v1–v4 files still import. Second audit written up in **`docs/EXPORT-IMPORT-AUDIT-2026-08.md`**; E6–E8 remain open.

#### Bindable actions
- **`erase_toggle` / `/erase/toggle` (Jul 30, #148)** — latching counterpart to `erase_brush` for controllers that only emit a press edge (AirTurn and most foot pedals), which can never deliver the release a `hold` action needs. Shares `S.eraseHeld` with the hold action, so a toggled-on erase can still be ended by releasing **F**. Caveat: a latch has no dead-man's switch — window-blur stops it, mid-performance nothing does.
- **Octave shortcuts + momentary mute (Aug 1, #166)** — `pitch_oct_down` / `pitch_oct_reset` / `pitch_oct_up` (`/grain/oct/down|reset|up`) are *triggers*, not a cc: a pot sweeping pitch is already `grain_pitchshift`, but a pad wants the discrete jump. **`mute_hold`** (`/mute/hold`) is a cough-button mute — release restores the state **at press time**, so tapping it while already muted by **M** doesn't open the output mid-set. Press state lives on `S` because press and release can arrive from different transports.
- **20 `preset_N` triggers (Jul 31, #156c)** — one row per patch in keys/midi/osc, each with its own key, OSC address (`/preset/1`…`/preset/20`) and MIDI-learn slot, so a patch can go on a pad or pedal. Generated from `PRESETS` with `label`/`tip` as getters, so renaming a user slot updates the modal without a reload. `/preset N` survives alongside them for sequencing from Max.

#### UI (Aug 1, #163–#169)
- **Camera mode is a segmented picker** (`pull | surface | sensor`) instead of a word that read as a status readout. **Entering surface mode raises a transient banner naming the key that gets you out** — `⌥ option` to free the cursor, `Esc` to release the lock. A banner, not a dialog: something you must dismiss is the wrong thing to put in front of a performer who just changed camera mode. Holds 12 s, `pointer-events: none`, and Alt dismisses it early — using the key is proof the message landed.
- **Backdrop click closes every modal.** One delegated handler in `main.js` covers all 12 `.mu-overlay`s and any future one, routed through the ✕ so per-modal cleanup (metering, live-tick timers, row highlights) still runs.
- **Feedback and accessory buttons report state.** LED is relabelled `○ feedback` / `● feedback` and **arms itself when a cursor-role sensor connects**, on the null → sn transition only. The A8 is passive, so its button reports presence rather than offering a toggle — white within ~250 ms of data, hollow after the 500 ms stale window, riding the registry's existing watchdog rather than a second timer near the grain scheduler.
- **Tare button feedback** — flashes `✓ tared` on success and **`no cursor sensor` when there was nothing to tare**, the case worth knowing about mid-set. Tare was previously silent and instantaneous, so `` ` `` was indistinguishable from an unbound key.
- **Default layout and collapse state now match the arrangement actually in use** — `canvasPos: 0` with audio/session and play/erase nested under the canvas, then envelope/preset/search, grain, commit; cloud morph ships collapsed.

#### Tooling + docs
- **`scripts/browser-audit.js`** — loads the app with no `electronBridge` and asserts module load, Electron-only controls degrading visibly, hosted-origin console cleanliness, settled-layout startup, and a service-worker redeploy + offline test. Grew from 36 checks to include a 24-check reset/export section. **`scripts/verify-action-ranges.js`** — runs every real `ccFn` at v = 0, 63.5, 127, finds which key it writes, and checks the half-throw reading, comparing *shape* not absolute values. Half throw is the whole test: lin and log agree at both endpoints and diverge hardest in the middle, so a swapped `curve` flag is a 15× error at v=63.5 and invisible anywhere else. **33 ok · 0 mismatched · 2 skipped.**
- **New docs** — `docs/BROWSER-AUDIT-2026-07.md`, `docs/EXPORT-IMPORT-AUDIT-2026-08.md`, `docs/XIMU3-SETTINGS.md`, `docs/archive/RETIRED-PRESETS.md`. CLAUDE.md gained the accessory-registry architecture note, the two new debugging harnesses, and `sw.js` as release-checklist item 4.

### Changed
- **Patch bank 40 → 20, factory first (Jul 31, #156).** 10 factory + 10 user instead of 20 + 20, with the order **inverted**: factory occupies patches 1–10 (keys `1`–`0`), user 11–20 (`shift`+`1`–`0`). The ten keepers are wash, vinyl, cloud, pulse, shimmer, glitch, chop, ocean, stutter, wobble — the original relative order with the cuts removed, so wash is still patch 1 and still the default. `events.js` needed no change at all: it already derived the index as `digit + (shift ? 10 : 0)`, which only becomes *correct* once factory is first. A one-shot migration (`migratePresetIndices()`) remaps stored preset indices in `mubone_radial_pins` and `mubone_desktop_morph` through a literal old→new table; `mubone_user_presets` is discarded when its length doesn't match, since truncating 20 → 10 would mean guessing which ten to keep.
- **`proxy.js` is a transport again (#175).** It no longer enforces device settings — that block had been copy-pasted into four places and drifted: `proxy.js` wrote `ahrs_message_rate_divisor: 1` (400 Hz) where `imu-setup.js` wrote `4` (100 Hz), and never wrote `binary_mode_enabled` or `axes_alignment` at all, **so the same physical sensor was configured differently depending on whether you launched Electron or browser mode.** `imu-setup.js` now runs one enforcement pass for every transport, routing browser-mode UDP commands through the proxy's `{ type: 'command' }` relay. The LED handshake blink moved with it.
- **`udp_low_latency` true → false (#175).** Low latency sends each data message as its own UDP packet, which the manual notes "will significantly limit the maximum throughput and number of devices able to stream on the same network". mubone runs 3+ sensors on one network, so packet aggregation is worth more than the few ms. Flip back only for a single-sensor rig where latency is the whole game.
- **Speaker sweep follows master volume, and is 8× quieter (Aug 1, #173).** The sweep was fixed at `vol = 0.06` and was the one sound in the app the master slider couldn't touch — in Electron only, because `playSweepChannel()` connects straight to the ChannelMerger, bypassing the bus where master lives. Scaled by `S.outputGainValue` and read per burst so the slider is live while the sweep loops. **Base level cut 0.06 → 0.015** over two rounds of listening on the actual rig: white noise is broadband and reads far louder through a PA than the same nominal gain of granulated material, and the original value had only ever been judged on a laptop. Net at −6 dB master: −42.5 dBFS. That's the right order for "identify which box is making noise" rather than "test the system". Button moved directly above the master vol row.
- **Service worker is network-first for code, cache-first for assets (Jul 31, B1)**, with per-entry caching so one bad path can't abort the install. It had been cache-first with a stale `CACHE_VERSION` and 8 modules missing from `APP_SHELL`, meaning a redeploy would *still* have served the old build to returning visitors.
- **Tare naming unified (Aug 1, #167).** The sensor modal's button is now `tare sensor` and the session panel's is `tare cursor` — one verb differing only in target, both `captureTare()`. "Zero" now only ever means the firmware AHRS heading reset, which deliberately *clears* tare (both live = a −45° double-correction).
- **`accessory-registry.setAccessoryMode()` defaults to all connected devices**, not `_lastDev` (whichever last sent an `S` message) — backwards on a multi-sensor rig, since the device needing the fix is by definition the one that *isn't* sending.
- **`mubone_audio_defaults` split into four keys** — plus `mubone_seed_settings`, `mubone_viz_calibration` and `mubone_active_patch`, with a one-shot migration. It had been a grab-bag carrying viz calibration, `darkMode`, seed settings and the active patch index alongside audio, so no honest "audio settings" reset category could exist.
- **Electron `--osc-port` / instance flags, Max patches and station scripts** carried forward from 1.11 unchanged; `scripts/launch-stations.command` added as a double-clickable wrapper for `npm run stations`.

### Fixed
- **A pot bound to pitch shift moved the slider but was inaudible (Jul 31, #154a).** `S.grainOverrides.pitchShift` is in **cents** everywhere — slider, sensor mapping, patch table, worklet — but the shared `grain_pitchshift` action computed semitones (`((v/127)*48)-24`) and wrote them straight into the cents field. A full pot sweep produced ±24 cents, a quarter-tone: visible on the slider, inaudible in the room. `osc.js` `/grain/pitchshift` had the identical bug. Both now cents. Diagnosis note: committed clouds freeze their own `grainParams` at commit time, so a global pitch change only moves the live cursor — by design, but it compounds the symptom if you test on a committed cloud.
- **The pitch slider was crushed to nothing in the narrow tiers (#154b).** `.grain-row` is a flex row and the `−oct / 0 / +oct` group is `flex-shrink: 0`, so the slider was the only element that could absorb a narrowing panel. The oct buttons now own an unlabeled right-aligned row of their own; verified pixel-identical to the pitch-jitter slider at 1400/1100/800/520.
- **Importing any pre-v4 setup or session file silently discarded its seed settings, viz calibration and active patch (Aug 1, E1).** The blob-split migration written the day before carried a don't-clobber-existing-destination guard — correct for "migrate my own storage, once", wrong for import: the payload's keys were written first, then the split ran over localStorage where the successor keys now existed, so the guard skipped the write while the strip still deleted the fields from the blob. Fixed by making the migration store-agnostic and normalising the **payload** before any key is written, with `overwrite: true` because an import is an explicit instruction to take the file's values. **Lesson recorded in the doc: a migration for "my storage, once" is not automatically right for "a file from elsewhere".**
- **A session imported on another rig applied whatever patch happened to sit in slot N there (#161).** Import resolved the patch through `S.activePresetIndex` against the local bank; the bank travelling inside the session hid it. `applyPresetObject(preset)` is now extracted from `selectPreset(index)` and the payload carries the resolved patch itself, so nothing resolves through an index any more.
- **Session import was applying about 4 of ~30 settings (#159, E2)** — a session deliberately never reloads, so only settings with a runtime re-apply path took effect, and the dialog said an unqualified `session loaded`. Moot after #161 decoupled the two file types, but the extra loader calls survive on the pre-v5 path.
- **`applySettingsPayload` wrote values unvalidated (#159, E3)** — a hand-edited file with an object stringified to `"[object Object]"` poisoned the key, so every later `JSON.parse` threw and the module fell back to defaults, reading as "import did nothing". Non-strings now skipped with a warning; write failures logged rather than swallowed.
- **A markup-collapsed section could never be persistently expanded (#162).** The collapse restore only ever *added* `collapsed`, so opening one and reloading snapped it shut. A stored value now overrides the markup in both directions, which also un-sticks `hfGate` in the audio modal.
- **The "click to re-enter surface mode" recovery screen had been invisible since projector became the default layout (#169).** Both surface overlays were appended to `#canvasWrapper`, which `setProjectorLayout()` empties and collapses to `height: 0; overflow: hidden` — in the DOM, every computed style reading "visible", zero pixels on screen. Losing pointer lock therefore left no way back in. `setProjectorLayout` now carries `perfMonitor`, `surfaceLockOverlay` and `surfaceEntryHint` into the mini tile, listed by id rather than moving every child. Third occurrence of this class of bug (see #141). **Lesson for the harness: asserting presence + `opacity` passes for a clipped element; assert the painted box against the host's box instead.**
- **Alt-lock left no way back (#169).** The `pointerlockchange` handler explicitly skipped the alt-locked case, so pressing Alt in surface mode gave a free cursor, a frozen camera and nothing on screen — the most common way to leave the lock was the one case with no affordance. Now one rule: *in surface mode, no pointer lock ⇒ show the way back in*, with distinct copy for a dropped lock versus an Alt release (telling someone who just pressed Alt to use Alt describes what they did).
- **The audio auto-save dirty check had drifted from the save (#157c).** `_buildSettingsSnapshot()` omitted all nine handsfree fields, `recLimitSeconds` and `sensor3Cal`, so **changing only a handsfree setting or the recording limit never marked state dirty and was never persisted** until something unrelated changed — while it watched `fovDeg`, which `ui-viz.js` owns. Both paths now consume one `_buildPayloads()`.
- **`darkMode` had two writers (#157b)** — `ui-viz.js` and the audio blob; load order decided which won. `ui-viz.js` is now sole owner and the audit asserts it.
- **The settings export was missing four keys (#157).** `mubone-accessory-a8`, `mubone-ximu-led-map`, `mubone_midi_input` and `mubone_preset_layout_v` were all absent from the hand-written `STATIC_KEYS`, so a setup export carried none of the A8 configuration or the LED map, and omitting the schema flag meant an import re-ran the preset-index migration against already-migrated pins. The list is now derived from the storage registry.
- **The service worker was registering inside Electron (Jul 31, B1b).** The gate was `hostname !== 'localhost' && hostname !== '127.0.0.1'`, and a `file://` URL has an **empty** hostname, so it passed both tests and served the desktop app out of the browser build's cache. Silent under cache-first; fatal under network-first (`fetch()` of `file://` always rejects). Registration now gates on `location.protocol` + `isElectron`, and unregisters + purges any worker the old gate left behind. **Never gate an environment check on hostname alone.**
- **Startup visibly re-laid-out itself (Jul 31, B7)** — three distinct painted states, first panel at x=1094 → 973 → 23 in ~140 ms, worse in Electron with ~40 modules to load. Fixed with a boot veil: a blocking `<head>` script applies the saved UI scale pre-paint so the font-size never reflows, `.main-layout` is hidden while the top bar stays visible, and `main.js` lifts it in a rAF after the last layout mutation, with a 4 s failsafe that reveals regardless. If you add startup work that moves the UI, put it before the reveal.
- **Browser-mode degradation (Jul 31, B2–B6)** — hosted origins no longer dial `ws://localhost:8080/8081` (two red console errors on every demo visit, unfixable by the visitor); the sensor panel's WiFi copy is now three-way (Electron / local browser / hosted) since `proxy.js` has had a working browser path for some time; house-speaker and stereo-mixdown rows were *invisible* rather than disabled and are now shown with an explanation; buffer size was disabled but looked live; the OSC panel advertised UDP port 7500 in a runtime with no UDP listener.
- **Factory reset didn't reach Cache Storage or the service worker (Jul 31, B8)** — so in browser mode the previous build survived a reset, untrue to "back to day one" precisely when someone resets because something is off. Now torn down before reload, raced against a 1500 ms timeout so a hang can't leave the app half-wiped.

### Removed
- **Ten factory presets** — freeze, ghost, tape, swarm, haunt, morse, smear, drill, scatter, ritual. Literal source and restore instructions in `docs/archive/RETIRED-PRESETS.md`; the parameter combinations took tuning to find.
- **`FACTORY_PRESET_START`** — it was 20 and would now be 0, so every `i < FACTORY_PRESET_START` test would have silently *inverted* rather than failing. Deleting it broke all 14 call sites loudly; they're now `isUserPreset(i)`.
- **`slotTare()` / `slotClearTare()` / `_isFlatMount()` from `sensor-registry.js`** — no caller, *and* they could not have worked: `setFeeding()` nulls `quatCal.tareQuat` on every connect, because `imu-setup.js` owns calibration and the registry passes data through. With them went the `_pendingRecenter` branch in `renderer.js` — per-frame work in the render loop that could never fire — and `S._onTare`. `applyTare()` and the `tareQuat` reads **stay**: inert on null, and `tareQuat` is still in the persisted calibration schema.
- **`cameraModal`** — nothing would have opened it. Its per-mode descriptions became the segmented picker's chip tooltips.
- **The `patch select` cc row**, replaced by 20 `preset_N` triggers. Accessory dropdowns sort themselves out for free: buttons filter to triggers and see all 20, pots see none.
- **`STATIC_KEYS` in `ui-export.js`** — derived from `js/storage-registry.js` instead, closing the refactor #137 deferred.
- **`RESTART_ONLY` / `pendingRestart()`**, added by #159 and deleted by #161 the same day — they described a condition that decoupling setup from session removed, and keeping them would have been a monument to the old problem.
- **`sensor3Cal` persistence** — nothing in the app ever assigned to it, so it could only ever be the `state.js` default. If a UI for it lands, add persistence back deliberately.
- **Settings enforcement in `proxy.js`** — see Changed.

### Not yet verified
The work is done but the checklists aren't run: **#149** accessory in rehearsal (unplug mid-set, `serial_mode` across a power cycle, 8 channels at 100 Hz against scheduler drift, the AirTurn's press-only edge), **#152** redeploy `mubone.org/sim` — *the demo still serves 1.2 alpha, and nothing in this release is visible to anyone until it's published* — and **#153** browser mode on real hardware (audio, sensor over WebSerial, A8 over that connection, `node proxy.js` WiFi discovery, an export/import round-trip).

Still open from earlier releases: **#129** perf-audit verification, **#131** panel drag on touch/trackpad, **#133** erase-brush ear-checks, **#138** export/import round-trip, **#135** latent sweep-undo buffer-index bug, **#144** multi-station live, **#146** layout debt. New decisions parked: **#170** orphaned `recenterCursor()` (finish #76 and give it a button, or delete it), **#171** tare silently cleared by an axes-alignment change, **#174** the speaker sweep ignores mute in Electron and obeys it in browser — pick a rule and make both paths follow it.

---

## 1.11 alpha — 2026-07-27

**Backlog release — covers everything since 1.10 (2026-04-23 → 2026-07-27).** No release was cut between April and July, so this entry reconstructs four working sessions from `docs/TODO.md` and the working tree: the `?exp` flattening (Apr 23), the performance + leak + panel-drag session (Jul 6), the erase brush + export/import session (Jul 15), and the multi-station session (Jul 27). Grouped by theme rather than by session; session dates noted where the TODO records them.

Headline: **experimental modules graduated to always-on**, the **worklet buffer leak behind the group-show noise glitch is fixed**, an **erase brush**, **drag-and-drop panel layout**, and **multi-station support** — several instances side by side on one machine, each with its own sensor, settings profile, and OSC port.

### Added

#### Multi-station (Jul 27)
- **`--instance=<name>` gives a process its own settings profile.** `electron-main.js` parses the flag and calls `app.setPath('userData', <userData>/instances/<name>)` before `app.whenReady()`, so each station gets an isolated localStorage: presets, sensor calibration, audio defaults (input device *and* channel), panel layout, MIDI maps. Without the flag nothing changes — default profile, same as solo use. The name is sanitised (`[A-Za-z0-9_-]`) and appended to the window title; a `page-title-updated` handler re-applies it since `index.html`'s own `<title>` would otherwise overwrite it on load. Motivation: three instances on one profile silently clobber each other's saved settings, and multiple Electron processes contend for the same LevelDB lock. Full cross-hair inventory in `docs/MULTI-INSTANCE-PLAN.md`.
- **Per-instance OSC listen port — `--osc-port=<n>` (default 7500).** The port *is* the instance address: OSC address strings stay identical across stations, so a controller targets a station by port (convention a=7500, b=7510, c=7520). Deliberately no address-prefix scheme — three processes can't reliably share one UDP port on macOS, so ports are load-bearing regardless. Solves the "which window has keyboard focus" problem for live use: focus stops mattering.
- **`scripts/run-stations.sh` + `npm run stations`** — launch N stations from one terminal (`npm run stations -- 2`, 1–9, default 3). Names and ports are stable regardless of count (a is always 7500), so controller mappings never shift when you open fewer.
- **Instance identity in the UI.** Name and OSC port ride into the renderer via `additionalArguments` → `electronBridge.instanceName` / `.oscPort` (no IPC round-trip). A `[a]` badge sits next to the version in the top bar; the keys/midi/osc modal footer shows `osc in: udp 7510` (or `ws 8080` in browser mode).
- **Max setup instructions inside the keys/midi/osc modal** — a `[udpsend 127.0.0.1 <this window's port>]` one-liner with the live port filled in, a "this window is station b" line, and the bridge station-message cheatsheet, alongside the existing address table and live monitor. The modal is now self-sufficient for building a patch from scratch.
- **Station routing in `max/bridge.js`.** `[setstation b]` routes subsequent messages to one station, `[setstation all]` / `[to all /sweep]` broadcasts to the roster (`[setstations a b c]`), `[to b /trace 1]` targets one message without changing the selection. Defaults to station a, so existing solo patches behave exactly as before. Optional in Electron (plain `[udpsend]` ×3 is the lighter show path); still required in browser mode, where it's the WebSocket relay.
- **Per-instance MIDI input toggle** — "midi: on/off" in the keys/midi/osc modal footer, persisted per profile (`mubone_midi_input`), default on. Every instance sees every CoreMIDI device, so a shared pedal would otherwise fire directly in all three stations *in addition* to reaching them through Max.

#### Experimental modules graduated (Apr 23)
- **`?exp` URL flag and the `js/exp/` subfolder are gone — gesture, snapshot-engine, and staging UI are always-on.** Everything previously gated now either runs by default or is reachable from the DevTools console via `await import('./js/<module>.js')`. Modules moved flat into `js/`: `gesture.js`, `gesture-panel.js`, `gesture-viz.js`, `snapshot-engine.js`, `interp-kernels.js`, `relational-features.js`, `ui-staging.js`. `window.wg` (worklet control) is always exposed. The one-bit gate is now simply "imported by `main.js`" vs not — no URL flags, no feature-flag consts, no beta subfolders (rule recorded in `CLAUDE.md`).
- **`camera` sensor role — projector-aim.** `QUAT_ROLES` gains `'camera'` alongside `cursor`/`frame`/`unmapped`; a camera-role sensor rotates the viewport while the cursor and the body-reference frame stay independent. New `getCameraQ()`, `getFrameQ()`, and `getCursorWorldQ()` in `sensor-registry.js`, hooked into the renderer through `S._getCameraQ` / `S._getFrameQ` to avoid circular imports.
- **`js/ui-posture-map.js` — equirectangular posture map in the staging modal.** The whole posture space at once: Δaz on screen X (±180°), Δpitch on screen Y (±90°), Δroll as the rotation of a small up-stem through each dot, with parallels and meridians like a plate-carrée map. No camera, no FOV. Deliberately insulated from the granulator viz — reads `S.staging.relational` and never touches `S.camQ` / `S.frameQ` / `S.cursorQ`.
- **`js/osc-stream.js` — live posture + per-sensor Euler out as OSC.** Forwards `/delta droll dpitch daz` (cursor relative to the body frame, frame-cancellation already applied) and `/sensor/<name> roll pitch yaw` (post-tare, post-axis-map) to an external host, so mapping logic can live in Max/SuperCollider with mubone as the data source. Both messages use roll/pitch/yaw order so one `[unpack f f f]` handles either. Destination + running flag persist in `mubone_osc_stream`.
- **Audio panel in the main UI** (`initAudioPanel()` in `ui-meters.js`) — input channel, input gain, noise gate, master volume, dry-monitor toggle and dry gain as a first-class panel, instead of living only in the audio-settings modal.

#### Erase brush (Jul 15, #132)
- **Momentary hold-to-erase at the cursor** — new `js/erase.js`. While held (**hold F**, OSC `/erase/hold 0|1`, or the new erase panel button) a 30 ms ticker removes particles inside the cursor's search radius that pass **the same local recency filter the scan uses**, so erasing the newest buffers under the cursor reveals the older ones underneath. **One hold = one eraser pass:** buffers first sighted during a stroke are protected for the rest of it (`_strokeFate`), so the revealed layer stays audible instead of being re-ranked into the top-N and eaten ~30 ms later — release and press again to dig deeper. (The naive per-tick re-rank chewed through every layer while holding still, destroying the reveal.) Undo is one level via the existing sweep-snapshot machinery. Hardening: defensive `stampCartesian` (unstamped particles would NaN the dot product), skip-tick when the mouse cursor is inactive, snapshot-ownership check so releasing F can't discard a snapshot that sweep/erase-all/undo replaced mid-hold, window-blur ends the stroke. Cursor ring tints red while erasing (colour swap only — no new draw calls). Deliberately not done: no grain flush (tails ring out like a lifted pen), no `liveRecBuffers` compaction (indices stay valid mid-performance), recording untouched.

#### Layout + interaction (Jul 6, #130 · Jul 27)
- **Drag-and-drop panel rearrangement** — new `js/panel-drag.js` replaces the ▲▼ reorder arrows. Pointer-based with a 5 px threshold so label clicks still collapse; a placeholder shows the insertion point; drop into any of the five column slots including empty ones. **The viz block moves too**: hover the canvas tile for a slim grab handle, drag horizontally to place the 2-slot canvas span at slots 1–2, 2–3, or 3–4, with a dashed amber preview. Column contents never move with the canvas — only the nesting changes. Layout model refactored to five positional columns (`data-col` 0–4) + `canvasPos`, persisted as `mubone_projector_layout_v2` with one-shot migration from the old named-key format.
- **Responsive column tiers** — the panel grid steps through discrete column counts instead of shrinking into overlap. ≥1161px keeps the designed 5-slot layout untouched; 961–1160 reflows to 4 columns; 701–960 to 3; ≤700 to 2 ("narrow mode" — canvas full-width and sticky at the top, panels scrolling beneath, bars wrapping onto extra rows, modals capped to the viewport). The canvas is always two column-widths. Additive `@media` blocks at the end of `style.css`; in the mid tiers `.projector-center` and `.projector-center-cols` become `display: contents` so all five columns share one wrap flow (nothing measures those wrappers — drag/drop and the partition code are unaffected).

#### Control surface
- **OSC string-addressed mode switching (Jul 6, #105).** All 11 multi-option controls (`/camera/mode`, `/spatial/panning`, `/trace/mode`, `/commit/mode`, `/grain/dir`, `/grain/curve`, `/commit/dir`, `/commit/blend`, `/commit/selection`, `/commit/overflow`, `/commit/loop_release`) accept a string arg to set a mode directly (`/camera/mode sensor`); bang still cycles. Case-insensitive with aliases (forward→fwd, world→worldlocked, triangle→tri — see `_strMode` in `midi.js`). MIDI/keyboard behaviour unchanged.
- **Configurable cursor fade time (Jul 6, #14).** Mute/unmute already ramped at a fixed 20 ms click guard; the time-constant is now `S.scanFadeS`, settable live via OSC `/scan/fade <ms>` (0–2000) or the console. `S.scanFadeS = 0.1` gives a half-second musical swell.
- **OSC coverage for two keyboard-only actions (Jul 27)** — `/app/projector` (the action existed in `dispatchAction` but was missing from the `ACTIONS` table, so it had no address and was invisible in the mapping UI) and `/morph/radial` (new `radial_morph` action). The `X` key now routes through `dispatchAction` so keyboard, MIDI, and OSC share one path.

#### Tooling + docs
- **`scripts/ui-shots.js` — headless layout screenshot harness.** Renders `index.html` at the tier widths in headless Chromium and dumps projector-column geometry as JSON, so layout regressions are caught numerically instead of by eyeballing. Browser mode only: layout/DOM, no audio. Setup recipe in the script header; referenced from `CLAUDE.md`.
- **New docs** — `docs/PERFORMANCE-AUDIT-2026-07.md` (full audit + per-fix revert instructions + verification checklist), `docs/EXPORT-IMPORT-AUDIT-2026-07.md`, `docs/ELECTRON-MULTICHANNEL-SETUP.md` (fresh-machine checklist, `npm run rebuild` gotcha, interface/buffer/routing setup), `docs/MULTI-INSTANCE-PLAN.md` (architecture rationale, port map, localStorage cross-hairs, OSC audit, WiFi AP-vs-client findings), `docs/NARROW-LAYOUT-PLAN.md`. README substantially expanded, including an "Exploring beyond the main UI" section for the now-always-on modules.

### Fixed
- **Worklet buffer leak — the group-show noise glitch (Jul 6, #126).** Confirmed by manual record→erase cycles: the worklet retained 11–14 buffers / up to 92.6 MB after erases, with `bufMapSize` in lockstep. Buffers are now released at **sweep-snapshot commit time** (next stroke, or the 30 s auto-commit — deliberately *not* at erase, so undo-after-erase still works) via a new `resyncWorkletBuffers()` in `grain-worklet-bridge.js`, a `compactBuffers` worklet message, an orphan fix in `flushWorkletGrains()`, and calls from `commitSweep()`. Post-fix verification: `wg.diag()` shows `sampleBufs: 1` / 0.23 MB after 5–10 full record→erase cycles. Full change list + revert checklist in `docs/GROUP-SHOW-NOISE-GLITCH.md` § "Fix applied (2026-07-06)".
- **Performance audit fixes (Jul 6, #128)** — H1 recording buffer pooling (was allocating 57.6 MB per record press), H2 transfer lists on worklet buffer posts (was 3 full copies at record release), H3 IPC credits refunded on dropped buffers (permanent credit loss could silence output entirely), H4 register-once credit listener, M2 deterministic loop-node teardown, M3/#116 meters skip work while hidden (`tickMeters()` early-returns inside `.collapsed` panels; the audio-settings RAF only runs while the modal is open), `[dir]` logging debug-gated. Every change is tagged `perf audit <ID>` in code comments. Deliberately deferred pending measurement: M1 flat-array candidate posting, M4 paint-ticker always-on, M5 IPC batching.
- **Export/import corruption bugs (Jul 15, #137).** A1 `strokeIdCounter` continuity — a collision made new recordings rank *older* than imported material under the recency filter (exported in v3, recovered from data for v1/v2 files); A2 stale `strokeHistory` corrupted undo-after-import (now cleared); A3 the previous session's playing loops became unstoppable zombies (loop-node teardown via `releaseSeqNodes` + `killAllGrains` before restore); A4 a pending sweep/erase snapshot mixed sessions on undo (`commitSweep()` at import start). Also: all 9 missing `STATIC_KEYS` added to the settings export — worst was `mubone_sensor_cal_v`, whose omission re-ran the frame→camera migration on import and silently rewrote `frame`-role sensors — plus a version gate (refuses newer-than-build files) and payload-shape validation before any state mutation, recording guards on both export and import, and `EXPORT_VERSION` 2 → 3.
- **IMU data routing could attribute a foreign sensor's stream to the wrong device (Jul 27).** `imu-setup.js`'s inbound handler fell back to "first UDP device" whenever a line's source IP matched no connected device — with several devices connected (or several instances sharing a data port) that let two quaternion streams fight over one cursor. The fallback now applies only when exactly one UDP device is connected; otherwise the line is dropped and counted, with a throttled `?debug` warning naming the unknown source.
- **`p` (perf monitor) appeared to do nothing.** `#perfMonitor` lives inside `.canvas-wrapper`, which the projector-partition layout collapses to `height: 0` — the monitor was toggling visibility inside an invisible container. It now moves into the mini-canvas tile with the canvas (and back).
- **Audio zipper noise while resizing the window.** macOS fires resize continuously during a drag and every event re-ran `resizeCanvas()` + `drawPresetWaveform()`, reallocating the canvas buffer each time; those main-thread stalls starve the renderer→RtAudio IPC hop. Resize work is now coalesced to one run per frame via `requestAnimationFrame`.
- **Panel columns crushed to slivers and cards overlapping at mid widths.** The base `.projector-center-cols > .projector-col { flex: 1 1 0 }` rule out-specified the tier rules, squeezing the two center sub-columns to ~10–20 px while their tiles painted over neighbours. Tier rules now match that specificity.
- **Giant empty grey slab under the canvas in the reflowed tiers** — the mini-canvas tile inherits `align-self: stretch`, so in a wrap row it stretched to the tallest sibling column. Now `align-self: flex-start` in the tier blocks.
- **Top and bottom bars clipped in narrow mode.** `flex-wrap` alone wasn't enough — the button rows sit in `align-items: flex-start` columns with `flex-shrink: 0`, so without a width cap they grew to content width and wrap never engaged. Added `max-width: 100%` + `min-width: 0` + `flex-shrink: 1`.

### Changed
- **Electron minimum window size 800×600 → 380×500**, so a window can reach the narrow tier. Solo full-width use is unaffected.
- **Buffer-count meter semantics clarified (Jul 6, #6)** — sample painting correctly doesn't add to the buffer count: `perf.recTotalSec` is a recorded-audio *memory* gauge feeding the rec-limit guard, and sample particles reference pre-loaded `S.samples` buffers, adding zero audio memory. Resolved as intentional, not a bug.

### Removed
- **`js/exp/` subfolder and the `?exp` URL flag** — with `exp-init.js` and `exp-toggles.js` deleted outright (~320 lines of gating). `?debug` is now the only URL flag that should exist.
- **▲▼ panel reorder arrows** — replaced by drag-and-drop (see Added). Saved layouts migrate forward automatically but not backward; the old localStorage key is deleted on migration.
- **`docs/GESTURE-MAPPING-PLAN.md`** moved to `docs/archive/` (plan completed).

### Not yet verified
Carried into the next session — the work is done but the checklists aren't run: **#129** perf-audit verification (7 steps), **#131** panel drag on touch/trackpad + projector popup, **#133** erase-brush ear-checks, **#138** export/import round-trip checklist. Also open: **#135** latent sweep-undo bug (survivor buffer indices; pre-existing, found while auditing the erase brush).

---

## 1.10 alpha — 2026-04-22

### Added
- **`css/tokens.css` — single source of truth for design tokens.** Colors (bg/surface/text/accent/border/tint/chrome), typography (font stacks + size + letter-spacing scales), spacing, radius, transitions, slider dims, focus ring — all as CSS custom properties so `style.css` can reference `var(--name)` instead of hardcoding. Values extracted from the previous hardcoded palette with no intentional visual drift; the two structural design shifts (accent swap + display font + panel grey) are noted inline. Sets up a cleaner pass over `style.css` in follow-up sessions where the goal is migrating raw hex/px values onto the tokens.
- **Always-on-top bottom footer (`.bottom-bar`).** New persistent footer below `.main-layout` that replaces the former `.device--meters` panel and the top-bar sensor-group row. Left side holds the mute tile, a vertical gate strip, and input/gate/dry/phones/house level meters laid out as one unified rail of 12×48 vertical bars with lowercase group labels; right side holds the sensor controls (OSC indicator, sensor status, quick-switch buttons, sensors/LED/gesture/mapping/staging). Sits at the viewport bottom flush against the panel grid via `1.15rem` horizontal padding (matches `.main-layout` + `.right-panel` inner padding). Hidden in electron-fullscreen and mobile-mode like the top-bar. Layout moved in `index.html`, styling in `css/style.css`.
- **Mute tile in the footer lights up red when muted.** `.bottom-bar-mute.active` now paints the whole tile (icon via `currentColor`, "mute" text, border, background tint, M-badge outline) with `--accent-danger` and the danger tint tokens. `.active` is driven by the existing `ui-sweep.js → syncMute()` toggle on `S.isMuted`, so no JS wiring changes — purely a CSS state rule.
- **`js/ui-meters.js _drawGateMeter()` gained a vertical layout branch.** When the canvas is taller than wide (`h > w`), the RMS fills from the bottom up with the threshold rendered as a horizontal line, the peak as a thin horizontal tick, and the "gated"/"open" label + triangle markers dropped since they don't fit in a 12px-wide rail. Wide canvases (the audio-settings modal) keep the original horizontal rendering — both live in one function so there's no duplication. Lets the footer's gate meter match the visual language of the level meters without a second draw routine.

### Changed
- **Typography unified on Urbanist.** `--font-sans` and `--font-mono` both resolve to Urbanist now so the whole UI — buttons, labels, sliders, numeric readouts — renders in one face. Hardcoded `'Inter', monospace` and `'SF Mono', …` fallbacks in `style.css` swapped to `var(--font-sans)`. Added `font-variant-numeric: tabular-nums` on `body` to keep numeric readouts column-aligned without the Roboto Mono fallback. `css/fonts/Urbanist-latin.woff2` is a variable-axis subset so one file covers weights 100–900.
- **Panels flattened + lightened.** `.device` cards drop their 1px outer border (`.right-panel .device { border: none; border-radius: 6px }`) and sit on `--chrome-bg-raised` at the brighter `#262626` (was `#1a1a1a`) so they read as solid floating surfaces rather than outlined boxes. Contrast inside the cards rebalanced alongside: text tokens brightened ~10–15% across the hierarchy (`--text-primary #aaa → #c8c8c8`, `--text-secondary #888 → #a8a8a8`, etc.), border alphas strengthened ~50% (`--border-base 0.06 → 0.10`, `--border-hover 0.15 → 0.24`, `--border-strong 0.25 → 0.38`), surface alphas bumped ~50–80% so button chips sit visibly brighter than the new card grey.
- **Body is pure black; only the footer is grey chrome.** Body bg is `#000` so the inter-panel gutter matches the canvas and the lighter-grey panels float as distinct cards on a true black surround. `.top-bar` is also black (merges with body — no floating-chrome feel) since it only carries labels/switches; `.bottom-bar` stays at `--bg-app` `#161616` because it carries live monitoring (levels + sensor state) and earns the chrome treatment. Body padding stripped to zero so the bars go edge-to-edge horizontally and vertically; `.main-layout` owns the `0.5rem 0.75rem` padding for the panel gutter instead.
- **Panel + chrome alignment.** Top-bar and bottom-bar horizontal padding bumped to `1.15rem` (`.main-layout 0.75rem` + `.right-panel 0.4rem`) in both base and projector-mode rules so the "mubone" logo, the menu row, and the footer content line up flush with the panel-card left edge. The brand block's extra `padding-left: 0.15rem` was dropped as part of this.
- **Top-bar rows vertically aligned.** `.top-bar { align-items: flex-end }` + `.top-bar-right` simplified back to a single `flex-direction: row` (no longer stacking two rows now that the sensor-group moved to the footer), so the right-side menu now sits on the same horizontal line as the left-side mic/mute/projector row instead of floating above it.
- **Cursor panel button rhythm matches session + commit.** `.play-body { gap: 0 !important }` — `body.projector-mode .device-body { gap: 0.35rem }` was out-specificity-ing the non-important `.play-body { gap: 0 }`, giving the cursor panel wider vertical spacing than session + commit (which guard with `!important`). Same `!important` added here.
- **Projector mini-canvas fills its tile.** Zeroed the tile's inherited `.device` padding and dropped the `<div class="device-label">projector</div>` element entirely from `events.js _miniWrapper` — the sphere render now goes corner-to-corner inside the tile with no header band eating vertical space. Pinned tile, no reorder need for a label.
- **Grain-envelope waveform fills the panel.** `.envelope-body` uses negative margins to cancel the `.device` card padding so the waveform sits flush to the card sides and bottom; `.envelope-waveform-wrap` swapped its fixed height clamp for `flex: 1` with a `clamp(80px, 8vw, 120px)` min-height; bottom corners rounded to match the card. `margin-top: -0.5rem` eats the label's bottom margin so the render butts directly under the title bar.
- **Global dark scrollbars.** `* { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.14) transparent }` + `::-webkit-scrollbar` rules for Chrome/Safari: 8px translucent-white thumb (12% resting, 22% hover, 30% active) on a transparent track so scrollbars recede into whatever surface they appear on instead of showing the bright default OS bar.
- **Session / commit / cursor button sizing standardized.** All three panels now share the `.seq-section { padding: 7px 6px }` convention for single-button sections and `.seq-section--row` for paired buttons, with their respective body containers (`.session-body`, `.commit-body`, `.play-body`) all at `padding: 0; gap: 0` so the section padding alone owns the vertical rhythm. Session panel buttons gained icons matching the cursor/commit "big button" style.
- **Projector-mode layout became the default view.** `setProjectorLayout(true)` is called via `requestAnimationFrame` on boot in `events.js`, and is idempotent (early-return guards on `_miniWrapper`). Pressing the projector button or `Shift+F` now only toggles the mirrored popup — the laptop-friendly column layout is always on.
- **Mubone brand block in the top-left.** "mubone" in `--font-display` (Urbanist 1.55rem, weight 600) stacked over the version line. Pushed the menu-item spacing above so the row no longer reads as cramped against the brand.

### Removed
- **`.device--meters` / levels panel.** Moved to the bottom footer (see Added). The panel chrome (label, card bg, border) is gone; the meter DOM IDs (`sessionMuteBtn`, `mainGateMeter`, `mainInputMeters`, `mainHouseMeters`, `mainMixMeters`, `mainDryMeters`) all preserved so `ui-meters.js`, `ui-sweep.js`, and the metering tick loop keep working with no JS changes. `DEFAULT_PROJECTOR_LAYOUT` in `events.js` no longer references `'meters'`.
- **Top-bar sensor-group row.** Moved into `.bottom-bar-right` (see Added). Same element ID (`sensorGroup`), same `no-sensor` class so connection-state JS continues to drive the same element.

---

## 1.9 alpha — 2026-04-22

### Added
- **Staging Change B — posture-snapshot engine (experimental, `?exp` gated).** New parallel engine that sits on top of the Change A MIDI/OSC transports. Rather than binding one sensor axis to one destination, the performer drops named *snapshots* in a relational Δ-euler space, each with a set of per-channel output values; the live outbound values are computed at ~30 Hz by blending the snapshots via a distance-weighted kernel. The aim is posture-based macros — lean forward-left to morph to this formant/cutoff/pitch-shift combo, lean back-right to morph to that one — with smooth interpolation in between. Lives entirely in `js/exp/`, off by default, touches zero main code paths.
  - **`js/exp/interp-kernels.js`** — shared kernel helpers taking (identity, anchors, opts): `gaussianWeights` (default — `exp(-d²/2σ²)`, normalized, with an exact-hit shortcut to avoid overflow at very small σ), `kNearestBarycentricWeights` (only the k nearest anchors contribute, IDW-weighted then normalized), `snapWeights` (one anchor gets 1.0, rest 0), and `idwWeights` (inverse-distance with configurable falloff — same math as `applyRadialMorph()` in `js/exp/gesture.js`, lifted here so the radial morph and snapshot engine can eventually share a single implementation). `computeWeights(mode, ...)` is the single entry used by the engine. Every kernel takes an optional `axisWeights` array for per-dimension bias before the Euclidean distance is computed.
  - **`js/exp/relational-features.js`** — computes the posture identity vector. When both a `frame` and a `cursor` sensor are assigned, it builds Δquat = conj(frameQ) * cursorRawQ and decomposes to Δeuler (roll/pitch/yaw in degrees) via the same ZYX convention used by `sensor-registry.js`, so `Δaz/Δpitch/Δroll` represent the hand's orientation relative to the chest. If only a cursor is assigned it falls back to the cursor's calibrated euler and publishes a `hasFrame: false` flag so the UI can annotate the degraded mode. Writes to `S.staging.relational` on every call — no per-tick allocation, scratch object is reused. `identityVectorFromRelational()` projects into the `[daz, dpitch, droll]` order that snapshots + kernels expect.
  - **`js/exp/snapshot-engine.js`** — data model + tick loop. `S.staging.snapshots` is an array of `{id, label, identity:[n], values:{channelName→number}, color?}`. `S.staging.mappingPreset` declares the channel set (`{name, protocol, device/ch/cc/bits | host/port/address, min, max, hold}`); `mappingPresetLibrary` stores saveable named copies so the performer can swap from "oVox+Ableton" to "hardware pedals" mid-show and snapshots carry over their values by channel *name* (unmapped names just go dormant on emit). `S.staging.interpolation` holds `{mode, sigma, k, falloff, axisWeights:{daz,dpitch,droll}, smoothingMs}` — `mode` drives the `computeWeights` dispatch. Per tick: call `tickRelational()`, normalize the live identity against per-axis snapshot extents (with a 120° fallback span when a dimension has <2 samples), compute weights via the selected kernel, blend per channel (`pre = Σ wᵢ · snapshotᵢ.values[name]`, renormalized against the subset that defined the channel so outputs don't droop when only some snapshots declare it), then emit via `midiSendCC` (0..127 or 0..16383 scaled from min/max) or `sendOSCExternal` (floats in raw min/max range). `ch.hold` freezes emission per channel for troubleshooting. All telemetry (weights, per-channel pre/wire/status, identity raw + normalized, tick count, total emitted) is parked on `S.staging.telemetry` for the UI to read. Persistence is JSON-only under `mubone_staging` — snapshots, mapping preset, library, interpolation config, running/logging flags. Tick timer is a plain `setInterval` at ~30 Hz — same rate as the Change A mapping engine — started/stopped by UI toggle rather than auto-running with the engine.
  - **`js/exp/ui-staging.js`** — new modal, same visual language as the mapping modal. Transport banner with engine start/stop button (flips green when running), MIDI + OSC availability dots, and a log-to-console toggle. Interpolation controls: mode dropdown (`Gaussian | k-nearest | snap | IDW`) with mode-specific secondary widgets (σ slider for Gaussian, k input for k-nearest, falloff input for IDW), plus per-axis weight inputs for `Δaz / Δpitch / Δroll`. Channel editor with protocol accent stripe (amber=MIDI, green=OSC), inline rename (auto-propagates to all snapshot value keys), protocol-specific destination widgets, min/max, hold, test-send, and a live tx dot per row that flashes on each emitted message. Snapshot table with "capture from live" button — grabs the current identity vector and seeds each channel's value to the midpoint of its range; per-row weight bar + numeric weight that animate in real time, editable label, read-only identity coords, per-channel value inputs (empty clears the key so the channel goes dormant for that snapshot). Mapping-preset library with save/load/delete — load replaces the current channel set; value keys on snapshots survive by name. Live readouts: identity vector (raw Δ-euler in degrees), frame pairing state (paired/cursor-only/none), per-channel `pre → wire [status]` grid, running weight sum, tick count, total emit count. UI update is event-driven off a new `S._onStagingTick` hook — the engine fires it once per tick when running, the UI patches numbers into existing DOM rather than rebuilding any section, so the modal stays responsive at 30 Hz without garbage pressure.
  - **`index.html`** — new `<button id="stagingBtn" class="top-bar-btn exp-only">◇ staging</button>` next to the mapping button (hidden by default via `style="display:none"`, revealed by `exp-init.js` when `?exp` is on). New `#stagingModal` shell with a `.staging-dialog-body` div that `ui-staging.js` populates on init.
  - **`css/style.css`** — full staging stylesheet (~330 lines) covering the 1200 px dialog, sticky transport banner, section cards, interpolation controls, channel rows with protocol-coloured accent bars, snapshot table (CSS grid with `80px 120px repeat(3, 54px) 1fr 28px` columns), weight bars that animate via `width` transition, identity readout boxes, and per-channel output grid (`repeat(auto-fill, minmax(200px, 1fr))` so it reflows at narrow widths).
  - **`js/exp/exp-init.js`** — calls `initSnapshotEngine({autoStart:false})` then `initStagingUI()` during exp bootstrap, and reveals all `.exp-only` elements (generic pattern so future exp-gated UI can opt in with a single class).
  - **Service worker** — `CACHE_VERSION` bumped to `mubone-1.9.0-alpha`; `js/exp/interp-kernels.js`, `js/exp/relational-features.js`, `js/exp/snapshot-engine.js`, `js/exp/ui-staging.js` added to the app-shell list.

---

## 1.8 alpha — 2026-04-22

### Added
- **Staging Change A — sensor mapping can now drive external MIDI CC and OSC destinations, not just grain params.** The existing mapping modal was repurposed from a grain-only control surface into a general IMU → {grain, MIDI, OSC} dispatcher so the performer can use mubone as an IMU staging rig for external vocal-synth software (oVox, VocalSynth), DAW automation, or hardware expression inputs without the granular engine in the audio path. Two orthogonal changes are landing: Change A is the transport + pass-thru extension below; Change B (snapshot engine with posture identity vectors and interpolation) is a separate pass that will build on this. The grain path is unchanged — existing rows auto-migrate on load (rows without an `output` block get `output: {kind:'grain', param:targetParam}` synthesised the first time `loadMappings()` runs, and subsequent saves write the new shape), and `targetParam` stays populated for grain rows so `js/ui-presets.js`, which reads `mappings[i].targetParam` directly, keeps working.
  - **New renderer-side transports.** `js/midi-out.js` wraps WebMIDI (`navigator.requestMIDIAccess`) with `initMIDIOut`, `isMIDIOutAvailable`, `listOutputs`, `onStateChange`, `sendCC`, `testSend`. Supports both 7-bit and 14-bit CC — 14-bit sends the standard paired MSB on the selected CC# and LSB on CC#+32 (hence the `cc > 95` validation). Per-(deviceId, channel, cc) throttle (`DEFAULT_THROTTLE_MS = 5` → ~200 Hz cap) and dedup on identical consecutive values. `js/osc-out.js` wraps real OSC 1.0 binary to arbitrary host:port via `window.electronBridge.sendOSCExternal`. Separate from `osc.js`'s `sendOSC()` (which targets the internal relay on port 7501 with JSON payload for the joycon-GUI LED/rumble feedback loop — that path is unaffected). Per-(host, port, address) throttle + dedup, same `'sent'|'deduped'|'throttled'|'unavailable'|'invalid'` status vocabulary. Browser mode without the Electron bridge is a no-op with a one-time console warning — the deprecated Max/WebSocket bridge is not resurrected.
  - **Electron main + preload bridge.** `electron-main.js` gained an OSC 1.0 binary encoder (`_encodeOSCString`, `_encodeOSC` with typed tags — Float32 for `f`, Int32 for `i`, null-terminated 4-byte-padded strings) and a per-`host:port` dgram socket pool (`_oscExtSocks`) so repeat sends don't re-create sockets. IPC handler `osc-send-external` validates host/port/address and blasts the encoded packet. `electron-preload.js` exposes `sendOSCExternal(host, port, address, values)` alongside the existing `sendOSC` — explicitly distinct names so no caller accidentally routes external OSC through the internal relay.
  - **Mapping engine extension.** `js/sensor-mapping.js` rows carry an optional `output: {kind, ...}` block (grain uses `param`; MIDI uses `deviceId, channel, cc, bits`; OSC uses `host, port, address`). `tickMappings()` dispatches per kind: grain writes to `S.grainOverrides` as before; MIDI calls `midiSendCC`; OSC calls `sendOSCExternal`. Destination-uniqueness is now per kind — `_destKey(m)` returns `grain:<param>`, `midi:<device>:<ch>:<cc>`, or `osc:<host>:<port>:<address>` — so the existing "one row per destination" rule generalises without knocking out unrelated rows. Transient telemetry (`_lastEmitted`, `_lastWireValue`, `_lastTxAt`, `_lastTxStatus`, `_lastError`) is attached to each row on every tick and stripped via `_stripTransient()` before `localStorage.setItem` so persisted config stays small. Two new exports `getMappingTelemetry(id)` and `getTransportStatus()` feed the diagnostics surface.
  - **Mapping modal UI extension.** `js/ui-sensor-mapping.js` grew a kind dropdown between the arrow and the destination fields — switching kind calls `_defaultDestForKind(kind)` and `_defaultOutputRangeForKind(kind, opts)` so MIDI rows start at 0..127 (or 0..16383 for 14-bit), OSC rows start at 0..1, and grain rows inherit the target param's native range. Kind-specific destination widgets are built by `_buildGrainFields` / `_buildMidiFields` / `_buildOscFields`; MIDI row gets device select + channel + cc + bits selector with survival-of-selection across disconnects (the current deviceId stays in the dropdown as `(disconnected)` so roll-call reconnects resume); OSC row gets host + port + address textboxes with `/`-prefix auto-insertion. Each row carries a left-border accent colour by kind (blue = grain / amber = midi / green = osc) so at a glance the performer can see what a row is wired to. A transport banner at the top of the modal shows MIDI availability + device list + a "request access" button when WebMIDI hasn't been prompted yet, OSC availability (Electron vs browser), and editable global defaults for new OSC rows (persisted to `localStorage` under `mubone_mappingTransportGlobal`). `onMIDIStateChange` re-renders the list on device connect/disconnect so newly-plugged-in hardware shows up immediately without reopening the modal.
  - **Diagnostics surface.** Per-row tx indicator (small coloured dot) reflects the last transport status: green = sent, amber = throttled, grey = deduped/idle, red = unavailable/invalid. Hovering it shows the last error message when present (e.g. "incomplete MIDI destination", "External OSC requires Electron build"). Each MIDI/OSC row gets a `▸` test-send button that fires a one-shot at `outputMax` and briefly tints itself with the outcome colour so the performer can verify the destination is reachable without having to rotate the wand. The transport banner polls `getTransportStatus()` at 2 Hz so the dots stay live even when the list is idle.
  - **Modal dialog widened to 1120 px and the row list now scrolls horizontally as a fallback** — a MIDI row's field count (axis + input + bar + raw + arrow + kind + device + ch + cc + bits + outMin + outMax + curve + exp + canvas + scaled + tx + test + remove) exceeds the old 900 px width. The transport banner is sticky-positioned on both axes so it stays in view when either dimension scrolls.
  - **Service worker updated** — `CACHE_VERSION` bumped to `mubone-1.8.0-alpha`; `js/midi-out.js` and `js/osc-out.js` added to the app-shell list so browsers cache them for offline use.

### Changed
- **Mapping modal hint updated** — "map IMU axes to grain parameters — each mapping connects one sensor axis to one grain param" → "map IMU axes to grain parameters, MIDI CC, or OSC — one sensor axis per destination" to reflect the expanded scope.

---

## 1.7 alpha — 2026-04-18

### Fixed
- **Undoing the last buffer left cursor grains audibly playing after the particles disappeared from the sphere** — when the performer scanned over particles of the only remaining buffer and then undid the stroke that produced it, the visual cloud was correctly removed (renderer reads from `S.particles` which the undo path filters down to zero) but cursor grains kept firing into the house bus until something repopulated the particle array. Root cause was a gating asymmetry between the cursor and seed posts in `scheduleGrains()` (`js/grain.js`): the entire candidate-build block, including the `S._postWorkletCandidates(...)` call, sits behind `if (S.particles.length && !(S.seqModeEnabled && S.isPainting))`. When `S.particles.length` dropped to 0, the block was skipped and the worklet was never told the cursor pool was empty — so its `_candidates` array kept the previous tick's list, the onset clock kept firing at the cursor period (~50 ms), and `_fireGrain()` happily looked up `cands[ci]` for a still-valid `bufIndex` + `offset` (the worklet's `_sampleBufs` / SAB still held the audio data — the undo path intentionally doesn't tear those down, see the comment in `flushWorkletGrains`). Sound only stopped when the user did something that brought `S.particles.length` back above zero (paint, draw, etc.) and the next tick posted a fresh list. The seed path already had this exact fix applied — its `S._postWorkletSeeds(...)` call at the bottom of the function is unconditional, with a comment noting that "removing the last cloud leaves a stale `seed.active=true` in the worklet that keeps firing grains from old candidates indefinitely" if the post is skipped. Mirrored that pattern on the cursor side: when the else branch fires *because* `S.particles.length === 0`, post an empty candidate list to the worklet (`S._postWorkletCandidates([], cursorLon, cursorLat)`). The bridge already handles empty pools correctly (line 361 in `grain-worklet-bridge.js` short-circuits to `_workletNode.port.postMessage({ type: 'candidates', list: [] })`) and the worklet already exits cleanly on `candCount === 0` (line 646 in `grain-engine.worklet.js`), so no other code paths needed touching. Deliberately scoped the new post to `S.particles.length === 0` rather than the full else clause so the seq-mode-while-painting skip case (the other reason this branch fires) keeps its existing behaviour — that path's stale-candidate situation is pre-existing and out of scope for this fix.

### Changed
- **Service worker updated** — `CACHE_VERSION` bumped to `mubone-1.7.0-alpha` so browsers re-fetch the updated `js/grain.js`.

---

## 1.6 alpha — 2026-04-17

### Fixed
- **Undo briefly cut out the cursor audio when scanning/tracing unrelated material** — three distinct cuts in the same path, all in `undoLastStroke()` (`js/ui-samples.js`). **(1) Worklet cursor flush:** the function unconditionally called `flushCursorGrains()`, which posts `flush-cursor` to the worklet and fades out every in-flight cursor-tagged grain in ~3ms. It's meant to silence the undone stroke's lingering audio ("made a cloud, lifted pen, hit undo → instant silence"), but cursor-tagged grains at the moment of undo aren't necessarily reading from the stroke being undone — when the performer is painting, tracing, or just scanning somewhere else, most of them are reading from particles near the current cursor. A first pass gated the flush behind `S.isPainting || S._traceToggled`, but that missed scan mode (cursor producing grains with both flags false), which is exactly the case the performer reproduced: record into buffer 1 with trace, record into buffer 2 with trace elsewhere, move cursor over buffer-1 particles *without re-arming trace*, hit undo — every cursor grain reading from buffer 1 got flushed by the ~3 ms envelope, and the next scheduler tick (up to ~20 ms) plus the ~50–100 ms grain period meant the performer heard a ~100 ms fade-out-then-back-in on the buffer-1 audio they were actively listening to. The correct fix is that undo never needs to flush cursor grains at all: the particle filter one line below the flush already removes the undone stroke's particles from `S.particles` the same tick, so the next candidate-list post (≤20 ms later) excludes them — no new grains fire from undone material — and any in-flight grains that *were* reading from the undone particles finish their natural hann/tri envelope (≤200 ms, typically ≤80 ms), which matches the normal grain tail the performer already hears whenever they lift the pen. The flush call was removed entirely. The "instant silence after painting a cloud and undoing it" UX still holds because in that scenario there are no cursor grains left firing by the time undo runs — the pen was already lifted. **(2) Mic→worklet disconnect:** even with the flush gone, an earlier pass had the function running a `wasRecording = S.isRecording && S.isPainting` branch that called `stopLiveRecording()` at the top and `startLiveRecording()` + `recordStrokeStart()` at the bottom so the performer could keep painting through an undo. But `stopLiveRecording()` runs `hotSwapRecording()` which disconnects `S.inputAnalyser` from the grain worklet, and `startLiveRecording()` calls `_beginProvisionalRecording()` which reconnects it — the ~10–50 ms gap between those was itself audible whenever it applied. That branch also targeted the *in-progress* stroke at the top of `S.strokeHistory`, which doesn't match what the performer expects: while they're actively tracing, "undo" should remove something they committed earlier, not rip out the thing they're still drawing. Rewrote the branch to skip the top of the history and splice the second-from-top entry instead (or early-return if nothing committed yet is under it). No `stop/startLiveRecording` calls in the undo path at all anymore — the mic stays connected to the worklet the entire time, and the buffer-reshuffle loop now also decrements `liveBufferIndex` on any *other* `strokeHistory` entry that sat above the removed slot so a later undo of the still-live stroke targets the correct buffer after the splice. Unused `stopLiveRecording` / `startLiveRecording` imports removed. **(3) Loop hard-stop transient:** `removeSeq(slotIndex, immediate=true)` in `js/ui-presets.js`, called unconditionally from `removeSeqByStrokeId()` on the undo path, did a bare `try { src.stop(); } catch (_) {}` on the running `AudioBufferSourceNode` for any loop in the undone stroke. Depending on the waveform position at the instant of stop, that produces a loud transient click on the main output bus that reads as "audio shut down for a split second" even though nothing else in the audio graph changed, because the click is loud enough to mask the continuous cursor/seed grains for the samples it's decaying through downstream nodes. Loops created from the undone stroke are also not necessarily the thing the performer was consciously listening to at the moment of undo — they play autonomously once committed. `removeSeq(immediate=true)` now schedules a 10 ms `linearRampToValueAtTime(0)` on the slot's gain node, stops the source ~12 ms later, and defers extra-node cleanup to the source's `ended` event. The slot is still nulled synchronously (so the seed scheduler and UI stop referencing it immediately), and 10 ms is imperceptible as a delay but decisive enough to kill the transient. Falls back to the old hard stop if the gain node / context isn't available. Added a diagnostic `console.log` in `undoLastStroke` that reports the relevant state flags alongside the stroke being undone, so future "is this still clicking" reports can be resolved against concrete values rather than guesswork.
- **Initial-connect and WebSerial/Electron-serial handshake blinks were invisible under LED feedback** — the previous 1.6 fix rerouted `blinkDevice()` through the LED-feedback module's `mubone-led-identify` event, but the three connect paths in `js/imu-setup.js` (WiFi/UDP Electron, WebSerial browser, Electron serial) weren't calling `blinkDevice()` — they each had their own inline `for (let i = 0; i < 5; i++) { await _delay(200); sendCommandTo(dev, { blink: null }); }` loop fired at the end of the handshake. That loop sent the firmware's white-strobe command directly, bypassing the LED module entirely, and `_paintBaselines()` (triggered by the role-change that rides in on the next `sensor-status` event) painted over it almost immediately — so the initial five-flash identification either disappeared instantly or, because we overwrote it with the device's new grey idle or red trace baseline, appeared to "blink on the same colour." All three inline loops now call `await blinkDevice(dev, 5, 200)` which dispatches `mubone-led-identify` when feedback is enabled — the module's red-on/black-off flash sequence is visible against the grey idle and the state-restore at the end of the sequence correctly returns to the final baseline (grey for non-cursor, red for cursor-with-trace-armed, etc.). Falls through to the firmware command path when feedback is off, so nothing changes for users who keep the LED toggle disabled.
- **LED feedback was injecting jitter into x-IMU3 raw readings during handsfree** — `_paintBaselines()` in `js/ximu-led-feedback.js` ran on every state change and wrote a `{colour: ...}` command to *every* connected x-IMU3 (not just the cursor one) every time. During a handsfree session `S.hfRecording` toggles each time the noise gate opens or closes, which can fire several times a second; with three sensors connected that's up to 30 redundant colour commands per second going out over the same WiFi as the inbound data frames, and the readings started dropping samples and looking glitchy. Added a per-device `_lastSent` dedupe map: a colour is only actually sent if it differs from the last value pushed to that device, so non-cursor sensors receive at most one colour command per session and the cursor only fires when its baseline genuinely changes (idle ↔ orange ↔ red). The baseline-restore inside event blink sequences invalidates the dedupe entry first so it always lands on the device. Net traffic dropped from O(devices × state-changes) to O(actual cursor-baseline changes).
- **`releaseCommit()` didn't fire the `mubone-led-release` event** — only the legacy `uprootNearestSeed()` path dispatched it, but the keyboard shortcut (⌘C), MIDI, and the UI pickup button all call `releaseCommit()`, so picking up a cloud or loop showed no blink on the x-IMU3 LED even with feedback enabled. Added the dispatch at the end of `releaseCommit()` in `js/ui-presets.js` so the 2-green-blink sequence fires on every real pickup.
- **Firmware `{blink:null}` white strobe was invisible when LED feedback was on** — `blinkDevice()` in `js/imu-setup.js` is called on connect (5×), on cursor role-switch (3×), and from the per-device "blink" button in the sensors modal (5×). The firmware's built-in white blink returns to the currently-set colour when done, but our `_paintBaselines` write (triggered by the role-change `sensor-status` event that rides alongside each of those actions) would cancel the strobe almost immediately, and against the new grey idle the brief white flash read as "same as idle." `blinkDevice()` now checks `isXimuLedEnabled()` — if the feedback module owns the colour, it dispatches `mubone-led-identify` instead and the module runs a trace-blue flash sequence against off, which contrasts clearly against the grey idle and matches the rest of the LED vocabulary. Falls through to the firmware command when feedback is disabled so nothing changes for users who have it off.

### Changed
- **LED feedback trace palette re-scoped around the noise gate** — on the x-IMU3's RGB LED, successive iterations of "joycon home-button blue" never matched the performer's reference (the emitter's white point and gamma push every blue toward cyan-white), so the trace palette moved to red/orange: `#FF0000` red means "recording right now" and `#FF8800` orange means "hands-free armed, gate closed, waiting for input." Manual trace is always recording, so it's solid red (no more blinking). Hands-free trace swings orange ⇄ red every time the noise gate opens or closes — driven by the same `S.hfRecording` flag that toggles the on-screen `hf-recording` class, so the LED mirrors the HF button's indicator. Manual-trace blinker removed along with its ~220ms interval. Events stay green for clear contrast against red/orange; idle stays grey. Carries the conventional "record = red" association.

### Added
- **x-IMU3 RGB LED feedback on the cursor sensor** — new `js/ximu-led-feedback.js` module driving the RGB LED of whichever x-IMU3 is currently holding the `cursor` role. Think of it as the x-IMU3 equivalent of the joycon-gui status LEDs, but kept deliberately simple — a single LED annotates the performer's own actions rather than mirroring app-wide gauges (the joycon's player-LED slot gauge stays on the joycon, where the four physical LEDs actually fit that purpose). Palette uses red/orange for trace state, scoped around the noise gate (the x-IMU3 LED's gamma washed out every shade of blue on the device, so we moved to colours that read unambiguously and carry the conventional "record = red" association): solid red (`#FF0000`) means "recording right now," orange (`#FF8800`) means "hands-free armed, gate closed, waiting for input," the joycon's player-LED green (`#9de38b`) means "commit/release happened," and a quiet grey (`#555555`) is idle. Baseline idle is dim grey on every connected x-IMU3; the cursor sensor overlays trace state as: solid red for manual trace (which is always recording), orange for hands-free trace while the gate is closed, and red the moment the gate opens — swinging back to orange when it closes. The gate state comes from `S.hfRecording`, the same flag that drives the `hf-recording` class on the HF button, so the LED stays in lockstep with the on-screen indicator. On top of the baseline the cursor LED plays transient blink sequences for single events: 1 green blink on commit/plant seed, 2 green blinks on release (uproot) a cloud/seed, 1 off-blink (black) on undo (Cmd+Z or right-click), 5 green blinks when the user attempts a commit while slots are full and overflow is off. Overflow-on behaves as a normal commit. Signals travel over simple `window.CustomEvent`s (`mubone-led-commit`, `mubone-led-release`, `mubone-led-undo`, `mubone-led-full`) dispatched from the call sites in `ui-presets.js` / `ui-samples.js`, so the module itself does no state polling or diffing — it's pure presentation. Cursor tracking rides on the existing `sensor-status` event. Trace state and gate-recording state are polled together (10 Hz, cheap). A per-device mutex drops overlapping sequences so rapid inputs don't stack blinks or leave the LED on a transient colour. Manual-trace blinking runs on a separate ~220ms interval that only repaints the cursor device, never the idle peers, and yields to in-flight event blinks via the same mutex. Toggle button `○ LED` lives in the sensor row of the top bar next to `⚙ sensors`; state is persisted to localStorage. On disable we send `{"colour":null}` to every x-IMU3 so the firmware's normal per-mode colour (cyan for Wi-Fi client, magenta for Wi-Fi AP, etc. per x-IMU3 manual §6) comes back cleanly. Uses the `colour` command from x-IMU3 User Manual v1.11 §8.1.14 via the existing `sendCommandTo()` bridge — works over both UDP (Wi-Fi) and USB-serial. `sw.js` CACHE_VERSION bumped to `mubone-1.6.7-alpha` so browsers re-fetch the new module and palette.

### Fixed
- **Sensor quick-switch buttons all showed "active" after hot-swapping between IMUs** — the top-bar row of per-sensor pills (`#sensorSwitchBtns` in `main.js`, styled via `.sensor-switch-btn.active` in `css/style.css`) highlights the device currently holding the `cursor` role. `assignQuatRole()` in `js/sensor-registry.js` correctly cleared the old holder's `quatRole` to `'unmapped'` in its internal `_registry`, but it only called `S._onSensorRoleChanged` for the *new* holder — the clear was silent. The role-change handler in `js/imu-setup.js` updates `DeviceState.role` from the slot argument it's passed, so the previously-cursor device never had its `DeviceState.role` reset, and the sensor-status event kept reporting its role as `cursor`. After a few switches every button had `.active` and they all looked identical. Fixed by firing `_onSensorRoleChanged` for every slot that loses a role during the clear sweep, not just for the slot that gains it. Same fix applied to `assignInertialRole`. The blink side-effect still only triggers on `role === 'cursor'` so the old cursor doesn't flash when it's cleared.
- **Connecting a 3rd x-IMU3 over WiFi froze the first two** — the Electron main process held a single `_ximu3DataSock` and each new device connect called `startXIMU3DataListener(port)`, which unconditionally closed the existing socket and rebound a fresh one to the newest device's send port. If the three devices used different send ports (or even the same port, during the brief close→bind window), data from the earlier devices was orphaned and raw numbers in the UI froze. Refactored to a `Map<port, { sock, refs, bufs: Map<sourceIP, string> }>` in `electron-main.js` with per-port reference counting — multiple devices on the same port share one socket, multiple devices on different ports get multiple sockets, and the listener only closes when the last device releases the port. The LF-reassembly buffer is now keyed per source IP so partial-datagram boundaries from device A can't splice into frames from device B. IPC `ximu3-stop-data` now takes a port argument (`electron-preload.js` forwarded, `disconnectDevice` in `js/imu-setup.js` passes `dev.send`). Quit cleanup iterates every socket.
- **Electron window stayed black until WiFi changed** — `css/style.css` began with `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap')`, and CSS `@import` is render-blocking. On a flaky network (captive portal, slow DNS, venue WiFi with no real internet) Chromium would stall fetching that stylesheet, the page never painted, no JS ran, and `setAudioDevice` IPC never fired — so `audify stream started` didn't appear in the terminal either. Changing WiFi kicked the network stack, the request resolved, and the app suddenly "started." Now self-hosting a single 48 KB Inter variable-font `.woff2` at `css/fonts/Inter-latin.woff2` (Google Fonts v20 latin subset, covers weights 100–900 via variable-axis interpolation, SIL OFL) and replacing the `@import` with a local `@font-face`. Desktop app is now fully offline-capable for rendering — no stage WiFi dependency. `package.json` electron-builder `files` list gained `css/fonts/**/*` so the font ships in the DMG; `sw.js` `APP_SHELL` gained the font path so the hosted web build caches it for offline too.

### Changed
- **x-IMU3 handshake hardened against stale device settings** — sensors remember any configuration written by a previous host (x-IMU3 GUI, another app, a different mubone build), so connecting to mubone would silently inherit whatever state the device was last left in. The WiFi/UDP (Electron) and both serial (WebSerial + IPC) connect paths in `js/imu-setup.js` now enforce two additional settings in the settings block before `apply`, matching the existing pattern for AHRS config and UDP low-latency:
  - `binary_mode_enabled: false` — force ASCII/JSON data messages. Device default is `true` (compact binary), which mubone's parser does not speak; a sensor previously switched to binary would hand off silently-broken frames. Ref: x-IMU3 User Manual v1.11 §11.1.66.
  - `axes_alignment: 0` — force `+X+Y+Z`. If the device had been remapped (24 possible values in the alignment table), orientation math downstream would be rotated/reflected and the wand would feel wrong without any visible error. Ref: x-IMU3 User Manual v1.11 §11.1.59.

---

## 1.5 alpha — 2026-04-16

### Added
- **`/status/*` outbound OSC namespace** — mubone now publishes its own state to the wire so peers (notably the mubone-joycon-gui) can mirror it. `js/status-publisher.js` polls a four-address watchlist at 20 Hz and emits one message per transition; no heartbeat. Addresses: `/status/trace` (trace armed, hf off), `/status/trace/hf` (trace armed, hf on), `/status/slots/filled` (integer 0..`MAX_COMMITS` — raw occupied-slot count), `/status/slots/max` (integer 1..`MAX_COMMITS` — current `S.commitSlotCount`, user-adjustable during a session). On `osc-connected` the full set is force-resent once so a late-joining peer comes up in sync. Wired from `main.js` right after `initOSC()`. Kept deliberately small — the joycon GUI pushes BLE HID reports per inbound message, and early bursts were audibly choking input. The trace/hf split lets the controller show a different home-LED effect for the two modes; the filled/max pair drives the controller's four player LEDs as a gauge — 1 slot = LED 1, up to 4 slots = LEDs 1-4 solid, 5..max-1 = LEDs 1-3 solid with LED 4 blinking, at max = all four blink. All gauge math lives in the consumer so mubone's wire contract stays two plain integers and "full" tracks the runtime session limit, not the hard cap.
- **Generic OSC mapping inputs `/mapping1` `/mapping2` `/mapping3`** — the mapping modal used to accept only IMU axes (roll/elevation/azimuth). There are now three wire-addressable "axes" whose value is simply whatever an upstream peer last sent on `/mappingN` (one float, nominally -1..1 but not clamped). Any external controller — the mubone-joycon-gui stick, a Max patch, a foot pedal going through a MIDI→OSC bridge — can alias a control to one of these addresses and then drive any mappable grain parameter from the normal mapping UI, with the same curve/range/curve-exp controls as the IMU axes. Implementation: `sensor-mapping.js` holds a small `_externalInputs` bucket (`{ mapping1: 0, mapping2: 0, mapping3: 0 }`) and exposes `setMappingInput(name, value)`; the three new entries in `AXIS_DEFS` just read that bucket. `osc.js` routes `/mappingN` straight into `setMappingInput`. `ui-sensor-mapping.js` grew three new `AXIS_OPTIONS` entries (labelled `OSC /mapping1` etc.) and now asks the axis definition for its live-value formatter — IMU axes keep their `°` suffix, generic channels show a plain two-decimal float. The mini range-bar's axis-full-range lookup moved from hard-coded degree bounds to per-option `min`/`max` so the unitless -1..1 axes render correctly.
- **Electron → relay UDP uplink (port 7501)** — the renderer's outbound `sendOSC()` used to be browser-only (wrote to the same WebSocket used for inbound). Now in Electron it dispatches over IPC (`electronBridge.sendOSC`) to `electron-main.js`, which UDP-sends JSON frames to 127.0.0.1:7501. The mubone-joycon-gui relay listens on that port and rebroadcasts to its WS peers, so the joycon page receives status messages without any Max dependency. JSON on the wire (not binary OSC) because both ends are our own Node processes.

### Changed
- **`sendOSC()` in `js/osc.js`** — now picks Electron IPC first, then falls back to the browser WebSocket. Callers (currently the new status publisher, but any future caller) don't need to know which build they're running in.
- **Joycon no longer masquerades as a sensor.** Up to now the joycon GUI had an "emit inertial" toggle that published joycon gyro+accel to `/sensor/joyconR/inertial`, which hit mubone's generic sensor-discovery dispatch and caused a "joyconR" slot to appear in the sensors module alongside real IMUs. That conflated two very different signal classes — orientation-quality IMU streams from the BNO085 wand vs. low-rate controller telemetry — and polluted role assignment (cursor/frame/gesture). The emit toggle, `/sensor/{name}/inertial` path, and associated DOM are removed from the joycon GUI; the sensor registry is now strictly for dedicated IMU modules. Joycon-driven parameter control goes through the new `/mapping1..3` generic channels or the existing `/joycon/*` button namespace.

---

## 1.4 alpha — 2026-04-16

### Fixed
- **Mapping-modal "data" column accuracy** — two CC entries claimed `float` but their ccFn uses `Math.round`, so the stored value is always an integer: `radius_cc` (`/search/radius`) is now `int 1–180 °`, and `loop_fade_time` (`/commit/loop_fade_time`) is now `int 0–2000 ms`. All other 30+ CC rows were verified against their ccFn formulas and are accurate.
- **Missing `/dry/gain` OSC handler** — the `dry_gain` action declared `osc: '/dry/gain'` in the mapping table but `osc.js` had no corresponding case, so OSC traffic on that address silently dropped (MIDI and UI paths worked). Added a one-line handler that calls `S._setDryMonitorGain?.(clamp(values[0], 0, 2))`, matching the pattern of the other mixdown addresses. The documented address now actually routes.

### Added
- **Bang-handling legend** under the mapping table in the keys/midi/osc modal. Explains what `bang` means (zero-arg OSC message) and how the two transports differ: OSC accepts but ignores any trailing args on a bang target; MIDI CC mapped to a bang-type action fires on value > 0 and drops the value-0 release, so Softwave-style "trigger" mode (127 then 0) produces exactly one action per tap. Addresses the common confusion around why a MIDI note-off / CC-release doesn't double-trigger a mapped bang.

---

## 1.3 alpha — 2026-04-16

### Added
- **Live MIDI/OSC monitor** in the keys/midi/osc modal — shows every inbound MIDI and OSC message as it arrives, with timestamp, channel/type decode for MIDI and raw address + args for OSC. Ring buffer of 200 entries per side, auto-scrolling, with pause and clear. Events fire before dispatch so unhandled addresses (wrong path, typo, etc.) are still visible, making it easy to diagnose "why isn't my controller activating this action." `mubone-midi-in` and `mubone-osc-in` CustomEvents are broadcast on `window` from `midi.js:handleMidiMessage` and `osc.js:handleOSC` respectively; the monitor is a consumer and adds zero cost when the modal is closed (ring buffer fills but DOM is untouched).

---

## 1.2 alpha — 2026-04-15

### Fixed
- **Electron shutdown crash (SIGABRT in audify.node)** — RtAudio input stream's native ThreadSafeFunction callback fired during `node::FreeEnvironment()` after the JS context had started tearing down. Centralised all cleanup into an idempotent `cleanupBeforeQuit()` called from both `window-all-closed` and `before-quit`. App now quits immediately on all platforms (mubone is single-window) instead of lingering on macOS with stale native refs. Also destroys the RtAudio enumerator instance (`_rtEnum`) which held a live C++ object through shutdown.
- **WiFi info showed "AP" when sensor was in client mode** — `_wifiInfoText()` now uses RSSI from discovery broadcasts to detect mode (RSSI −1 = AP, 0–100 = client) instead of assuming AP. Queries `wi_fi_client_ssid` and `wi_fi_client_channel` on connect; displays correct mode label, SSID, channel, band, and signal strength.
- **WiFi transport label said "wifi AP"** — changed to just "wifi" since sensors can be in either AP or client mode.

### Changed
- **AHRS message rate reduced from 400Hz to 100Hz** — `ahrs_message_rate_divisor` changed from 1 to 4 across all three connect paths (UDP, serial Electron, serial Web). The device's internal AHRS still runs at 400Hz and averages intermediate samples (anti-aliasing), so orientation quality is preserved. 100Hz is well above the paint ticker's 200Hz consumption rate and gives 3× WiFi headroom for multi-sensor shows.
- **Tare button renamed to "tare cursor"** — clarifies that it only tares the cursor-assigned sensor's orientation, not all sensors, and does not send a hardware heading reset. Tooltip expanded.
- **Sensor switch buttons visible with a single connected sensor** — previously required ≥2 feeding sensors to show. Now shows with ≥1, so the performer can always see which sensor is assigned to cursor.

### Added
- **WiFi client-mode fields in DeviceState** — `wifiClientChannel`, `wifiClientSsid` tracked alongside existing AP fields. Queried on connect for UDP devices.

---

## 1.1 alpha — 2026-04-11

### Fixed
- **Particle RMS/visual size misaligned with audible loudness** — paint ticker's `grainStart` now offsets back by one deposit interval so the particle marker sits in the centre of the recording window its RMS snapshot represents, aligning visual size with audible transient position.
- **Random grain direction only played forward** — HTML button uses `data-dir="rnd"` but the direction maps in `ui-presets.js` and `grain-worklet-bridge.js` only had `"rand"`. Added `rnd: 2` to both `_DIR_MAP` / `DIR_MAP` so the worklet receives `direction=2`.
- **Grains near buffer end sounded too short** — duration clamping truncated grains whose read window extended past the buffer. Now slides `bufOffset` backward so the full grain duration is preserved; character stays consistent across all particles.

### Changed
- **Input analyser smoothing** — reduced `smoothingTimeConstant` from 0.6 to 0.3 for more responsive spectral colours (particle timbral differentiation).
- **Reverse grain readPos** — reverse grains now start at `bufOffset + durSamples * absRate` (end of grain window) instead of end of buffer, matching the forward grain's audio region in reverse order.
- **Duration clamping direction-independent** — available-space calculation uses `bufLen - bufOffset` for both forward and reverse grains (was direction-dependent).

### Added
- **Debug waveform overlay (`debug-waveform.js`)** — full-screen overlay showing audio waveform, particle marker lines, and RMS bars. Hover shows particle details (idx, grainStart, dur, rms, centroid). Invoke via `wg.waveform()` in console.
- **Direction diagnostic feedback** — worklet feedback includes `dir`, `dirFwd`, `dirRev` counts; bridge logs `[dir]` at ~1Hz for runtime verification.

---

## 1.0 alpha — 2026-04-11

### Added
- **AudioWorklet grain engine (`grain-engine.worklet.js`)** — all grain synthesis now runs on the audio thread via a 256-slot pool with sample-accurate onset timing. Zero main-thread AudioBufferSourceNode creation for granular playback. VBAP panning computed in the worklet from a packed Float32Array lookup table (`packVBAPLookup()`).
- **Grain worklet bridge (`grain-worklet-bridge.js`)** — main-thread ↔ worklet communication layer. Handles parameter forwarding, candidate posting, feedback (active grain count, diagnostics), hot-swap recording buffers, and flush commands.
- **Paint ticker (`paint-ticker.js`)** — velocity-adaptive particle deposition driven by IMU quaternion arrival at up to 400Hz (was render-loop gated at ~10Hz). Decouples particle density from frame rate.
- **Sample-exact period control** — below 128 samples (one render quantum, ~2.67ms @48kHz), the period/duration sliders snap to integer sample counts. Display shows `Nsmp` + Hz. Arrow keys step ±1 sample. Every integer sample count is a distinct pitch in the harmonic series of the sample rate.
- **Overlap slider** — new grain parameter (`overlap = duration / period`) on a log scale from 0.01× to 100×. Moving the overlap slider adjusts duration to maintain the ratio. MIDI CC and OSC (`/grain/overlap`) support.
- **Duration jitter (`durJitter`)** — per-grain proportional jitter (0–100%). New slider row, MIDI CC, OSC path (`/grain/filterjitter`), sensor mapping target, preset save/load, patch table integration.
- **Scheduler peak hold meter** — perf monitor sched row now shows an EMA average + sticky peak marker (like a DAW peak meter). Click the row to reset peak.
- **Drop rate numbox** — editable particle deposit interval in the perf monitor (5–500ms). Writes to `S.paintTicker.intervalMs`.
- **AudioContext crash recovery** — detects Chrome error code 5 (renderer crash, context goes to `closed`). Auto-rebuilds the AudioContext, resets grain state, re-requests mic if it was active. Shows toast notification.
- **Rolling diagnostic event log (`dlog`)** — 500-entry ring buffer in `diag.js`. Always active (not gated by `?debug`). `dlog(tag, msg, data)` from any module; `window.dlog(N)` in console; last 80 entries appended to crash reports. Bridges audio-thread opacity.
- **Debug waveform overlay (`debug-waveform.js`)** — visual debug tool for inspecting audio buffers.
- **Exp toggles panel (`exp-toggles.js`)** — runtime feature toggle UI for experimental mode. `window.expToggles` console access.
- **Exp test fixtures** — `?exp` now auto-loads a 440Hz sine wave into sampler slot Q and a clean-conditions test patch (k=1, zero variation) into user slot 1.
- **Meter DOM caching** — `tickMeters()` now caches canvas refs, contexts, and gradient objects per container. Eliminates ~500 `getElementById` calls/sec and 240 gradient allocations/sec that were starving the grain scheduler.

### Fixed
- **Recording tail truncation** — `stopLiveRecording()` now delays worklet disconnect by one render quantum (~3ms) so the flush message is processed before the input is yanked. Preserves the last ~128 samples.
- **Loop buffer sealed before seq creation** — spacebar-up, D-loop release, and touch-end paths now call `stopLiveRecording()` *before* `createSeqFromStroke()`, so loops get the finalized buffer with exact sample count instead of the over-allocated live buffer whose tail extends into silence.
- **Undo removes all commit slot types** — `removeSeqByStrokeId()` now scans the full `MAX_COMMITS` array (not just `commitSlotCount`) and removes all slot types matching the stroke ID, not just loops. Hard-stops audio immediately (no fade) on undo.
- **Handsfree feedback detection modulo bug** — trend window index calculation used JS `%` which returns negative for negative operands, causing overlapping sample windows and false feedback detection. Fixed with `((x % n) + n) % n`.
- **Handsfree forced-close gap** — when max recording length or feedback triggers a forced close while the gate is still open, a new segment now starts immediately. Previously the gate waited for a close→open transition that never came during sustained notes.
- **WebSocket/proxy retry flood** — OSC and IMU proxy WebSocket connections now stop retrying after 3 failures if they never connected. Eliminates console spam in browser-only dev mode.
- **Corrupt preset localStorage handling** — `loadUserPresets()` now removes corrupt JSON on parse failure instead of retrying and failing every load. `saveUserPresets()` surfaces `QuotaExceededError` to the user via toast.
- **Recording guard race** — `recordingNode.port.onmessage` now early-returns if `S.recordingRaw` is null (recording already stopped while worklet still sending).
- **Erase-all during recording** — re-creates a fresh buffer slot and re-inits the provisional live buffer stream so new particles from the ongoing recording have somewhere to land.
- **AudioBuffer leak on context recreation** — `recreateAudioContext()` now nulls out all `liveRecBuffers` slot references so old-context buffers can be GC'd.
- **Input analyser smoothing** — reduced `smoothingTimeConstant` from 0.6 to 0.3 for snappier meter/gate response.

### Changed
- **Main-thread grain synthesis fully removed** — `playGrain()`, `_cursorNextOnsetT` onset clock, `SCHED_LOOKAHEAD`, `MAX_GRAIN_NODES`, node creation budget/throttle, `_deferDisconnect()`, and all per-grain Web Audio node creation stripped from `grain.js`. ~800 lines removed.
- **Particle deposition moved out of render loop** — `animate()` no longer drops particles. Paint ticker and `paint-ticker.js` handle deposition at IMU rate, decoupled from canvas frame rate. Eliminates the main source of scheduler-vs-renderer contention.
- **Period floor lowered to 50µs** — `SCHED_SAFE_PERIOD_S` dropped from 10ms to 50µs (20kHz grain rate). Safe now that the worklet handles all synthesis — no main-thread crash risk at sub-ms periods.
- **Live rebuild interval reduced** — `LIVE_REBUILD_INTERVAL_MS` lowered from 200ms to 50ms. Only controls main-thread AudioBuffer staleness for offset clamping; the worklet has real-time audio via `process()` input.
- **IMU report rate raised to 400Hz** — `ahrs_message_rate_divisor` changed from 8 (50Hz) to 1 (400Hz) across WiFi and serial transports. Paint ticker handles adaptive spacing.
- **Perf monitor reworked** — removed grains/sec rate row (meaningless with worklet). Added scheduler EMA average, peak hold, seeds-posted count. Perf counters updated to reflect worklet pool feedback.
- **Slider ranges extended** — durVar and periodVar sliders expanded from 0–500 to 0–750 to accommodate hybrid linear/log scale with sample-exact zone.
- **`fmtMs()` precision bump** — now shows two decimal places up to 100ms (was one decimal up to 10ms). Better visibility at audio-rate grain periods.
- **Loop region rounding** — `createSeqFromStroke()` uses symmetric `Math.round` for start/end samples instead of `floor`/`ceil` which biased the region longer.
- **k-seq mode forwarded to worklet** — toggling k-seq via UI or MIDI now sends `kSeqMode` to the worklet.
- **Sensor mapping highlights** — all mapping add/update/remove/toggle/import/clear paths now call `S._syncMappingHighlights?.()` for consistent UI feedback.
- **Service worker updated** — `CACHE_VERSION` bumped to `mubone-1.0-alpha`, APP_SHELL updated with new modules (`grain-worklet-bridge.js`, `paint-ticker.js`, `debug-waveform.js`, `grain-engine.worklet.js`, `exp-toggles.js`).

### Removed
- Main-thread grain synthesis path (`playGrain()`, per-grain AudioBufferSourceNode/GainNode/BiquadFilterNode/StereoPannerNode creation, `_deferDisconnect` batching, `_cursorEP` reusable params object, `_radiusFadeAtten`)
- `MAX_GRAIN_NODES` constant (worklet has its own 256-slot pool)
- `SCHED_SAFE_PERIOD_S` 10ms floor (replaced with 50µs)
- Grains-per-second rate display and `perf.grainsFired`/`perf.grainsPerSec`/`perf._grainAccum`/`perf._grainRateTs` counters
- Particle deposition code from `renderer.js` `animate()` (~70 lines)
- `PAINT_INTERVAL` import in renderer (deposition no longer frame-gated)

---

## 0.19 alpha — 2026-04-09

### Changed
- **AudioWorklet grain engine promoted to always-on** — the worklet grain engine (previously behind `?exp` flag) is now the only grain engine. All grain synthesis runs on the audio thread with sample-accurate onset timing. The main-thread `playGrain()` / `setInterval` scheduler / lookahead onset clock path has been removed.
- **Worklet startup moved to main.js** — `_startWorkletEngine()`, `S._onRecordingComplete` auto-start hook, and `window.wg` console API moved from `exp-init.js` to `main.js`. Worklet starts on first recording regardless of `?exp` flag.
- **`S.useWorkletEngine` flag removed** — replaced with `isWorkletGrainActive()` runtime check from the bridge module. No more feature flag gating.
- **Scheduler simplified** — `scheduleGrains()` now only performs spatial search (cursor + seed candidate pools) and posts results to the worklet. Cursor onset clock, budget calculations, node creation throttling, and main-thread `playGrain()` calls all removed. Seed onset clocks retained for data posting sync.

### Removed
- Main-thread grain synthesis path (`playGrain()` calls from scheduler, `_cursorNextOnsetT` onset clock, `SCHED_LOOKAHEAD` budget calculations, node creation budget/throttle logic)
- `S.useWorkletEngine` state flag and all conditional branches across `grain.js`, `ui-presets.js`, `state.js`, `exp-init.js`
- Worklet-related code from `exp-init.js` (engine start/stop, `S._onRecordingComplete`, `window.wg` API, `wg.toggle()` A/B switch)

---

## 0.18 alpha — 2026-04-05

### Fixed
- **Stereo mixdown crash on 2-channel hardware** — opening the app with saved multichannel+mixdown state on a stereo device created a broken 1-house + 2-monitor bus layout. `initSpeakerBuses()` now forces `S.stereoMixdownEnabled = false` when channel count < 4, and `syncHouseSpeakersSeg()` writes the state back (not just the UI checkbox).
- **Buffer size switching no longer crashes Electron** — repeated buffer-size changes triggered `RtApiCore::closeStream()` SIGTRAP/SIGBUS in CoreAudio's HAL. Buffer size changes now save the preference and show a "restart to apply" button that cleanly relaunches the app (`app.relaunch()` + `app.exit(0)`). New buffer size persists to `localStorage` and is picked up on next launch.
- **`applyBufferSize` used wrong device and channel count** — was finding the system default instead of the current device, and reading `S.speakerBuses.length` (house bus count) instead of `.numChannels` (total hardware channels).
- **`applySampleRate` passed `undefined` for buffer size** — now reads `S.preferredBufferSize` so rate changes preserve the user's buffer size preference.

### Changed
- **Removed factory patches 41–46** — shimmer-high, deep-drone, glitch-burst, crystal-seq, swarm-buzz, ghost-breath (radial morph presets) removed from the preset array and MIDI range updated to 1–40.
- **WiFi AP instructions for browser users** — no longer mentions `node proxy.js`; browser users are pointed to the Max patch OSC websocket bridge instead.

---

## 0.17 alpha — 2026-04-04

### Added
- **LED blink handshake on connect** — both WiFi and serial connections send 5× `{"blink":null}` with 200ms spacing after initial settings enforcement. Physical confirmation the device is talking to mubone.
- **Settings enforcement on connect** — every connection (WiFi, serial, browser, Electron) auto-configures the sensor: ignore magnetometer, acceleration rejection enabled, gyro offset correction, UDP low latency, quaternion output mode, then apply.
- **Heading command on tare** — `captureTare()` now sends `{"heading":0}` to the hardware (non-OSC devices), resetting accumulated yaw drift between tares.
- **Multi-device UDP routing** — `electron-main.js` tags each UDP data packet with source IP. `electron-preload.js` passes `sourceIP` through IPC. `imu-setup.js` routes data to the correct device by matching source IP, with fallback to first UDP device. Enables multiple WiFi x-IMU3s on a shared network.
- **Browser proxy (`proxy.js`)** — standalone Node.js script replacing Max bridge for browser-mode WiFi sensors. Port 8080 (data, `{ address, values }` JSON — drop-in for `osc.js`) + port 8081 (control: discovery list, connect/disconnect, commands). Converts x-IMU3 ASCII to `/sensor/{name}/quaternion` and `/sensor/{name}/inertial` OSC messages. Handles settings enforcement and LED blink server-side. Launch: `node proxy.js`.
- **WebSerial for browser USB serial** — `imu-setup.js` no longer returns early in browser mode. Chrome WebSerial API support for direct USB serial connections without Electron. New `requestSerialPort()` export for user-gesture-triggered port selection. "Add USB device" button appears in the sensor setup modal when running in browser with WebSerial available.
- **RSSI bar in discovery list** — WiFi device rows show RSSI percentage text and a color-coded bar (green > 60%, yellow 30–60%, red < 30%).

### Changed
- **`imu-setup.js` architecture** — all transport-dependent code now branches on `bridge?.isElectron` vs browser mode. `sendCommandTo()`, `connectDevice()`, `connectSerialDevice()`, `disconnectDevice()`, and `scanSerialPorts()` all support both Electron IPC and browser (WebSerial/proxy) paths.
- **`electron-preload.js`** — `onXIMU3Data` and `onXIMU3CommandResponse` callbacks now receive `sourceIP` as second argument for multi-device routing.

---

## 0.16 alpha — 2026-04-03

### Added
- **Unified sensor module** (`js/imu-setup.js`, `js/ui-imu-setup.js`) — replaces the old sensors module. Single module owns all IMU device discovery, connection, and calibration for three transports: x-IMU3 via WiFi UDP, x-IMU3 via serial/USB, and OSC sensors from Max. Per-device cards with orientation readout, polarity toggles, tare, roll mute, role assignment, and feed-to-sphere toggle.
- **Serial/USB transport for x-IMU3** — native serial port support via `serialport` npm package in Electron. Lazy-loaded so WiFi-only setups don't need the dependency. IPC bridge for open/close/send/list, auto-SN detection from device query response.
- **OSC sensor auto-discovery** — first `/sensor/{name}/quaternion` or `/sensor/{name}/inertial` message auto-creates a DeviceState and card. Same calibration pipeline as direct connections. Feed-to-sphere button (previously OSC auto-fed with no toggle).
- **NWU axis mapping readout** — orientation table shows three columns: semantic label (roll/pitch/yaw), NWU direction (N/W/U), and hardware axis mapping (+X/+Y/+Z) that updates dynamically when axes alignment changes.
- **Roll mute** — per-device toggle that zeros roll before feeding to sphere. Propagates to registry axis map to activate the pole-safe forward-vector path (yaw hold near poles).
- **Euler-space tare** — tare captures pitch and yaw offsets and subtracts them in Euler space rather than quaternion multiplication. Roll stays gravity-referenced — no cross-coupling when yawing with off-kilter mounts.
- **Pole clamp** — calibrated pitch clamped to ±89.5° before quaternion recomposition, preventing gimbal lock twirl at the poles.
- **Global tare wiring** — backtick key, MIDI tare action, OSC `/cursor/tare`, and top-bar tare button all routed through imu-setup to tare the cursor-role device.

### Removed
- **Old sensors module** — deleted `js/sensor.js` and `js/ui-sensors.js`. All sensor data now flows through imu-setup's calibration pipeline. Sensors button removed from top bar, sensorsModal removed from HTML, ~280 lines of `.sensor-*` CSS removed.
- **Legacy Max patches** — removed `max/bno085.maxpat`, `max/mubone-controller.maxpat`, `max/sensor-mapping.maxpat`, and `mumath.*` utility patches (replaced by reorganised `max/bno085/` and `max/main.maxpat`).

### Changed
- **Top-bar button renamed** — "imu setup" → "sensors" now that it's the single entry point for all sensor configuration.
- **Service worker updated** — `CACHE_VERSION` bumped to `mubone-0.16-alpha`, APP_SHELL updated to reflect new/removed files.
- **Axes alignment auto-clears tare** — changing hardware axes alignment invalidates any existing tare captured in the old frame.

---

## 0.15 alpha — 2026-04-02

### Added
- **Per-grain HPF/LPF filtering** — 4 new grain parameters: `hpfFreq`, `lpfFreq`, `filterQ`, `filterFreqJitter`. Uses native `BiquadFilterNode` (highpass + lowpass) inserted per-grain between source and gain. Conditional bypass: no filter nodes created when HPF ≤ 22 Hz and LPF ≥ 19.5 kHz (zero overhead when off). Audio-rate skip at grain periods ≤ 5 ms (same pattern as panner skip). Filter nodes cleaned up via `_deferDisconnect` in all four `ended` callbacks.
- **Filter UI sliders** — 4 new slider rows in the grain device panel with log-scale frequency conversion for HPF/LPF (20 Hz–20 kHz). Integrated into preset save/load, patch table (`PARAM_REGISTRY`), and wash factory preset defaults.
- **Sensor mapping module** (`js/sensor-mapping.js`) — general-purpose mapping engine that maps IMU axes (roll, elevation, azimuth) to any grain parameter. Evaluates at 30 Hz in the render loop. Features: input normalization, curve shaping (linear/log/exp with adjustable exponent), log-aware output scaling for frequency params, one-mapping-per-param constraint, global persistence to localStorage (`mubone_sensorMappings`).
- **Sensor mapping UI** (`js/ui-sensor-mapping.js`) — modal interface for configuring mappings. Each row: enable toggle, axis selector, input min/max with range bar, live raw axis readout (green, degrees), arrow, param selector, output min/max, curve selector, exponent numbox, mini curve canvas, live scaled output readout (amber), remove button. rAF-based live update loop runs only while modal is open.
- **MIDI/OSC mapping toggles** — 4 mapping toggle actions (`mapping_toggle_1`–`mapping_toggle_4`) via MIDI CC and `/mapping/toggle/1`–`/mapping/toggle/4` OSC paths.
- **Filter OSC paths** — `/grain/hpf`, `/grain/lpf`, `/grain/filterq`, `/grain/filterjitter`.
- **Filter MIDI CC actions** — `grain_hpf`, `grain_lpf`, `grain_filterq`, `grain_filterjitter`.
- **Electron packaging** — `electron-builder` config in package.json with DMG + ZIP targets for arm64 and x64. Build scripts: `npm run dist`, `dist:arm64`, `dist:x64`, `dist:universal`.
- **INSTALL.md** — collaborator setup guide covering pre-built DMG install and run-from-source paths.

### Changed
- **AudioContext latency hint** — added `latencyHint: 'interactive'` to AudioContext constructor, reducing dry monitor round-trip latency from ~20–40 ms to ~5–10 ms.
- **Latency display** — audio settings now shows real `baseLatency` + `outputLatency` from the browser instead of just the buffer-size estimate.
- **Sensor mapping modal width** — widened from 780 px to 900 px to accommodate live readout columns.

---

## 0.14 alpha — 2026-04-01

### Fixed
- **Electron SIGBUS crash on launch** — RtAudio's CoreAudio IO thread was crashing with `KERN_PROTECTION_FAILURE` in `_platform_memmove`. Three root causes: (1) throwaway `new RtAudio()` instances for device enumeration conflicted with active streams on macOS — replaced with a single persistent enumerator; (2) the sample-rate retry loop created a fresh RtAudio instance per attempt, destabilising CoreAudio — now reuses one instance; (3) `closeStream()` was called without `stop()` first, racing the IO thread. All three fixed.
- **Grain clicking artifacts** — `createGain()` defaults to gain=1.0, but the Hann envelope path assumed gain started at 0. Within the same render quantum, a few samples of full-volume signal could leak before `setValueCurveAtTime` took over. Added `gain.gain.value = 0` at node creation so every grain is silent from birth.
- **VBAP cleanup TypeError** — `_extraNodes` was null when mixdown inputs didn't exist, but the `ended` callback did `for (const n of _extraNodes)` unconditionally — threw TypeError on every grain in the multi-speaker path. Added null guard.
- **48 kHz everywhere** — all `44100` fallbacks across the app changed to `48000`: `ensureAudioContext`, `getUserMedia`, `minGrainDurS`/`minGrainPeriodS`, `ui-audio-settings.js` (6 call sites), `index.html` sample rate dropdown default. Electron `createOutputStream`/`createInputStream` now try the AudioContext rate first.
- **RECENCY_SLIDER_ALL scope bug** — `const` was declared inside `setupPresets()` but referenced from `initGrainControls()` (separate export), causing a ReferenceError that froze the entire app. Moved to module scope.
- **Wash factory preset silent on load** — removing `durJitter` from the sparse preset left `S.grainParams.durJitter` as `undefined` → `rand(-undefined, undefined)` → NaN duration → silent grains. Preset now explicitly sets `durJitter: 0`.

### Added
- **Dry monitor layer** — continuous spatialized pass-through of the live input signal, panned to the cursor position. VBAP path for multi-channel (Electron), StereoPanner for browser stereo. Updated each frame (~30fps) with 30ms gain ramps to avoid zippering. Includes on/off toggle, gain slider, dedicated meter in the levels panel, and headphone mixdown feed.
- **MIDI/OSC: dry monitor gain** — new `dry_gain` action (0–2) via `/dry/gain` OSC path, drives `S._setDryMonitorGain` callback.
- **MIDI/OSC: recency=0 (all)** — recency CC and `/search/recency` OSC now support value 0 meaning "no recency filter" (all buffers eligible).
- **Energy map UI** (experimental) — on/off toggle and gain slider in gesture panel, persisted to localStorage.
- **Main-window dry meter** — single-bar dry monitor level meter alongside input and house meters.

### Changed
- **Wash factory preset updated** — k:99, duration:589ms, period:61ms, fadeRatio:0.50, pitchJitter:±12¢, panSpread:0.05, volume:0.85, hann envelope, fwd direction, recency:all, probability:100%.
- **Default buffer size 512→1024** — safer default for 48 kHz on macOS CoreAudio. Updated in electron-main.js, audio.js worklet batchSize, main.js auto-open, ui-audio-settings.js, HTML dropdown, and quad-capture worklet default (4→8 blocks).
- **Electron RtAudio hardened** — `rtAudio.write()` wrapped in try-catch to prevent native errors from crashing the process. Shutdown sequence now stops streams before closing.

---

## 0.13 alpha — 2026-03-31

### Fixed
- **MIDI radius slider not syncing** — MIDI CC for radius updated the canvas and numbox but not the slider element. Also added `Math.round()` so CC values show integer degrees.
- **MIDI grain envelope not updating** — `syncGrainControlsUI` called `updatePlaybackControls()` and `drawRadiusViz()` but not `drawPresetWaveform()`, so moving MIDI faders for dur/per/fade didn't redraw the grain envelope visualization.
- **OSC `/search/radius` not syncing UI** — handler set `S.searchRadiusDeg` and called `updatePlaybackControls()` but never synced the slider, numbox, or radius canvas. Now uses `scheduleUISync()` with integer rounding.
- **Multichannel input meter scramble** (#112) — 10-channel MOTU input caused channel levels to jump randomly, especially when switching hardware input. Root cause: fixed 8192-sample ring buffer in the input-meter worklet overflowed at high channel counts (~18ms for 10ch). Rewrote with scaled ring size (`max(32768, numChannels × 8192)` rounded to power of 2), bitmask wrap on both cursors, and overflow detection that snaps the read cursor forward on frame boundaries.
- **`S.mainInputChannel` not synced** — legacy `asInputChannel` handler didn't update `S.mainInputChannel`, causing main UI meters to use stale channel index.
- **Master volume range too narrow** — slider min extended from −24 dB to −60 dB in HTML, MIDI mapping, and `S._setOutputGainDb` callback.
- **Empty user patches zero volume on recall** (#111) — selecting a user patch with no visible data in the patch table was silently zeroing volume. Three-part fix: strip unknown keys on load, early-return for empty presets, fall through to live grainParams for empty slots.
- **Preset select OSC range** — `fmt` field said `int 1–20` but actual range is 1–46 (20 user + 26 factory). Corrected the documentation.

### Added
- **MIDI/OSC: cloud morph** — three new mappable actions: `morph_cc` (position 0–1), `morph_sticky` (hold toggle), `morph_return` (return time 50–3000 ms). Wired to `S._setDesktopMorphT`, `S._toggleDesktopMorphSticky`, `S._setDesktopMorphReturnMs` callbacks in ui-presets.js.
- **MIDI/OSC: master volume** — new `master_vol` action (−60 to +6 dB) drives the actual audio settings slider via `S._setOutputGainDb` callback.
- **MIDI/OSC: noise gate threshold** — new `noise_gate` action (0–0.06 RMS) via `S._setNoiseGateThreshold` callback.
- **OSC routes for new actions** — added `/master/volume`, `/gate/threshold`, `/morph/position`, `/morph/sticky`, `/morph/return` to osc.js dispatcher. All accept real-world values matching their `fmt` fields.
- **Headphone mix meters in levels panel** — when the mixdown bus is active, an L/R "phones" meter column appears alongside input and house in the main UI levels panel.
- **Parameter lock indicators on all params** — 27 missing `param-lock-indicator` spans added across the main GUI. Locking any parameter in the patch table now shows the blue (#7abcbc) tint on the corresponding slider/label in the main GUI. Covers all grain params, search toggles, cursor params, and commit/seeder params.
- **Radial morph orange indicators** — CSS for `.param-morphed` class turns slider thumb, track, numbox, and label orange when gesture morph is driving a parameter.
- **Handsfree arm button** — dedicated `hfArmBtn` in the trace section with green armed / red recording states and HUD label.
- **Projector mode** — compact laptop layout with popup mirror window for projector output. Panel reorder arrows. Projector divider bar.
- **6 new factory presets** — shimmer-high, deep-drone, glitch-burst, crystal-seq, swarm-buzz, ghost-breath (indices 20–25).

### Changed
- **Levels panel meters wrap** — `flex-wrap: wrap` on `.levels-meters-row` so input, house, and phones meter groups stack vertically when the panel is too narrow for side-by-side layout.
- **Removed orphaned MIDI actions** — removed `monitor_vol` and `house_vol` from ACTIONS array (no corresponding UI or audio functionality).
- **Handsfree + trace mode buttons side by side** — combined into a `.seq-section--row` for compact layout.

---

## 0.12 alpha — 2026-03-30

### Fixed
- **Empty user patches zero volume on recall** (#111) — selecting a user patch with no visible data in the patch table was silently zeroing volume (and potentially other params). Stale keys from old saves (`durJitter`, `retriggerMs`) that weren't in PARAM_REGISTRY could trigger the grain merge block. Three-part fix: `loadUserPresets()` strips unknown keys on load, `selectPreset()` early-returns for truly empty presets, and `drawPresetWaveform()`/`updatePresetStats()` fall through to live grainParams for empty slots.

---

## 0.11 alpha — 2026-03-29

### Fixed
- **Undo during active recording** (#104) — undo while tracing/recording was splicing the live buffer out of `liveRecBuffers` while the worklet was still writing into it, desyncing `currentLiveBufferIdx` and breaking subsequent undos. Undo now cleanly stops the recording, runs normal undo (splice + reindex), then restarts recording with a fresh stroke so the performer keeps painting seamlessly. Also fixed a pre-existing bug where splicing a finished buffer below the active recording slot didn't adjust `currentLiveBufferIdx`.
- **Alt-lock blocking painting and undo** (#105) — alt-lock (freeze view, free mouse) was over-blocking: particle painting guard in renderer.js prevented spacebar/D-key/OSC recording from depositing particles while alt-locked. Removed the guard since the position calculation already uses frozen coords. Right-click undo on canvas also unblocked.
- **OSC trigger/bang actions missing button flash** — OSC-triggered actions (trace, sweep, commit drop/draw/release/clear, trace mode cycle) now produce the same visual button feedback as keyboard shortcuts by routing through `dispatchAction`. Added `_flash()` helper for consistent 180ms flash pattern.
- **Trace indicator not lighting from OSC** — `/trace 1` via OSC started recording but didn't toggle the `painting` class on `#paintIndicatorBtn`. The dispatch `recpaint` case now syncs the button. Sample paint (QWERTYUIOP via MIDI) also syncs.
- **Sweep via dispatch had no UI feedback** — `sweep` dispatch case was calling raw `sweep()` instead of `S._sessionSweep()` which wraps it with the button flash.

### Added
- **Performance mode toggle in viz settings** (#96) — on/off segmented toggle with ⇧P shortcut label. Syncs with keyboard shortcut and `/app/perfmode` OSC via `S._syncPerfModeUI` callback.
- **Factory reset expanded** — added 7 missing localStorage keys to factory reset: `mubone_darkMode`, `mubone_uiScale`, `mubone-hud-scale`, `mubone_fovDeg`, `mubone_edgeIndicator`, `mubone_edgeIndicatorSize`, `mubone_param_locks`, `grainDiagSnapshot`.

### Changed
- **OSC namespace redesign** (#102) — `/cursor/mute` → `/cursor/scan`, search params moved from `/grain/*` to `/search/*` (`/search/scope`, `/search/fill`, `/search/order`, `/search/radius`, `/search/k`, `/search/recency`). New paths: `/cursor/tare`, `/session/erase`, `/commit/selection`, `/app/darkmode`. Removed standalone `/record` (always paint into space — use `/trace`). Removed 10+ legacy aliases. All trigger/bang OSC handlers now route through `S._dispatchAction` for consistent UI feedback.
- **"rec + paint" renamed to "trace"** — GUI label, ACTIONS array, and OSC path all use "trace" terminology. Standalone "record" action removed — recording always paints into space.
- **Unused imports cleaned from osc.js** — removed 8 stale imports (`toggleNearestMode`, `dropSeqFromCursor`, `releaseCommit`, `clearAllCommits`, `clearAllSeqs`, `clearAllSeeds`, `setScanMuted`, `sweep`) after routing everything through dispatch.

---

## 0.10 alpha — 2026-03-28

### Fixed
- **Fullscreen grey border** (#92) — Electron fullscreen left body padding (`0.5rem 0.75rem`) and dark-grey background visible around the canvas. Added `body.electron-fullscreen { padding: 0; gap: 0 }` to eliminate the border. Browser fullscreen `::backdrop` also set to `#000`.
- **FOV vertical drift on pitch** (#88a) — FOV slider only controlled horizontal field of view (`focalLen` derived from `canvas.width`). When the canvas aspect ratio didn't match the projector (e.g. laptop 16:10 mirroring to 16:9 projector), vertical pitch caused the equator to drift from its physical position. Changed all six `focalLen` computation sites (`project()`, `screenToLonLat()`, and four renderer functions) to use `Math.min(canvas.width, canvas.height)`. The slider now controls vertical FOV, matching the standard 3D convention.
- **Worldlocked panning ignored frameQ** — headlocked spatial panning now correctly uses `cameraTransformInto()` (fused quaternion), and worldlocked mode no longer applies `frameQ` (was causing drift in two-IMU setups).
- **Cursor position in detethered mode** — grain scheduler, OSC loop-mode handler, seed plant/uproot/release, and sequence drop all now check `S.cursorQ` first (detethered cursor IMU) before falling back to mouse/camQ. Added `getCursorPos()` helper to centralize the pattern.
- **`stopLiveRecording()` didn't reset `_liveCopiedUpTo`** — incremental copy offset persisted across recordings, causing stale data in subsequent live buffers.

### Added
- **High-performance render mode** (Shift+P) — skips non-essential rendering when CPU pressure is high. Separate from perf monitor (p). OSC: `/app/perfmode`, MIDI mappable.
- **Max bridge indicator in top bar** (#92) — moved from floating `position: fixed` overlay (was obscuring the Learn button) to inline `<span>` in the sensor group, left of "sensor (connected)". Automatically hidden in fullscreen (inside top bar which is `display: none`).
- **HUD scale goes to zero** — HUD size slider now ranges 0–2.0×. At 0 the canvas edge bars and DOM HUD overlay are both hidden (label shows "off").
- **Editable numbox on viz sliders** — click any value label in viz settings to type a precise number. Clamps to slider min/max, Enter to confirm, Escape to cancel. Keyboard events stopped so typing doesn't trigger app shortcuts.
- **FOV slider refinements** — label updated to "vertical FOV", range narrowed to 10°–90°, step increased to 0.5° for easier targeting. Tooltip shows Nebula Capsule 3 Laser reference (~26° at 1.2:1 throw). FOV now persisted in audio settings snapshot.
- **Fullscreen button deduplication** — top-bar `fullscreenBtn2` now delegates to the HUD `fullscreenBtn` click handler (single source of truth). Unified `applyFullscreenState()` function updates both button labels, toggles `electron-fullscreen` class, and fires `resizeCanvas()`.
- **Electron fullscreen body padding fix** — `body.electron-fullscreen` zeroes padding and gap so the canvas-wrapper fills the viewport edge-to-edge.

### Changed
- **Incremental live buffer copy** — `rebuildLiveBuffer()` now only copies new samples since the last rebuild (~9,600 samples at 48kHz/200ms interval) instead of the entire recording buffer. Eliminates the linear-growth copy cost that caused stalls during long recordings.
- **O(N) k-selection in grain scheduler** — nearest-mode particle selection replaced O(N log N) `sort()` + `slice()` with a single-pass k-selection (`_buildCandidatePoolNearest`). At 16 seeds × 500 particles × 50 ticks/sec, this eliminates ~72K comparisons/tick.
- **Incremental angular distance stamps** — when painting adds new particles, only the new particles are stamped with cursor distance (was re-stamping all N particles on every `_particleVersion` bump). Cursor movement still re-stamps all.
- **Seed frame capture throttled** — `tickSeedRecording()` reduced from 50/sec to ~15/sec (66ms interval). Sufficient for gesture path resolution, eliminates 35 wasted `{...spread}` + `Object.entries` allocations per second.
- **Zero-allocation grain spatial math** — `playGrain()` now uses `spherePointInto()` / `cameraTransformInto()` with scratch buffers instead of allocating arrays per grain. Seed weight buffer reused via `.fill(0)` instead of `new Float32Array` per tick.
- **Fused camera quaternion in scheduler** — `updateFusedCamQ()` called at scheduler entry so headlocked panning uses the latest camQ/frameQ even when the scheduler fires between render frames.

---

## 0.9 alpha — 2026-03-28

### Added
- **Detethered cursor / two-IMU mode** (#31) — when both cursor-role and frame-role sensors are assigned, the cursor detethers from the viewport center and roams freely on the sphere. Frame IMU anchors the viewport (projector-mounted, floor-locked, or body-mounted — same code, different physical placement); cursor IMU controls where you paint and play. Activates automatically, no manual toggle.
- **`S.cursorQ`** — separate cursor orientation quaternion for detethered mode. `S.detethered` derived getter (`cursorQ !== null`).
- **`getSensorCursorQ()`** in sensor-registry.js — returns cursor-role quaternion only when frame-role is also active. Same processing pipeline as `getSensorCamQ()` (tare, axis map, custom layers).
- **Edge indicator** — off-screen cursor arrow drawn on canvas when detethered cursor is outside the viewport. On/off toggle and size slider (0.5–2.0×) in viz settings, persisted to localStorage.
- **Camera modal dynamic subtitle** — shows "1 sensor — cursor locked" or "2 sensors — cursor free" under the sensor option.
- **Role tooltips in sensor panel** — dropdown options now have descriptive tooltips (cursor: "Controls where you paint and play", frame: "Sets the world orientation", etc.).
- **Dual tare** — main tare button (Z/backtick) now tares both cursor and frame when both sensors are assigned.

### Fixed
- **Frame sensor gimbal lock** — frame exhibited pitch→roll coupling at 90° yaw because `cameraTransform()` applies `frameQ` directly but conjugates `camQ`. Fixed by conjugating `getFrameQ()` output to compensate for the asymmetry. Both sensors now use the exact same processing pipeline with identical visual behavior.
- **Paint-drop in detethered mode** — renderer.js paint-drop code now uses `getCursorLonLat()` when `S.cursorQ` is set, instead of always using `screenToLonLat()`.
- **Trace capture in detethered mode** — `ui-trace.js` `captureFrame()` now uses `getCursorLonLat()` when detethered, instead of always using mouse pixel coords.

### Changed
- **`getCursorLonLat()`** reads `S.cursorQ || S.camQ` — one-line change that propagates detethered cursor position to all downstream consumers (grain scheduler, seed morph, OSC broadcast, etc.).
- **Natural roll-muting in detethered mode** — physically rolling the cursor IMU has no effect on cursor position because `cursorQ` is only used for forward-vector projection (a point, not an orientation). This is a mathematical property of the architecture, not explicit muting code.
- **`cameraTransform()`** now has protective comments documenting the conjugation asymmetry between `camQ` and `frameQ`, with cross-references to `getFrameQ()`.
- **Mounting-aware tare** — `slotTare()` now selects tare strategy based on axis map configuration. Default flat mount (X = roll/forward) uses gravity-aligned tare (heading-only, preserves horizon). Non-flat mount (Y or Z = roll/forward) uses full-quaternion tare — captures the entire raw orientation and divides it out, so any physical mounting angle works cleanly with the Euler decomposition. Set axis map *before* taring. In detethered mode, roll is naturally muted on the cursor anyway, so the gravity tare's roll handling is irrelevant.

---

## 0.8 alpha — 2026-03-27

### Fixed
- **Electron: painting doesn't produce particles** (#77) — `startLiveRecording()` guard checked only `S.recordingStream` which is never set in Electron's RtAudio path. Added `hasRtAudioInput` alternative check. Also pre-loads recording-capture worklet via `warmUpAudioEngine()` in Electron startup.
- **Electron: getUserMedia conflict** (#78) — `startAudio()` in audio settings now skips `getUserMedia` when Electron RtAudio input is already active, preventing a conflicting second input stream.
- **Electron: fullscreen button label + canvas resize** (#79) — native `BrowserWindow.setFullScreen()` didn't fire the web `fullscreenchange` event. Main process now emits `fullscreen-changed` IPC; preload exposes `onFullscreenChanged` listener; events.js hooks it to update button label and fire `resizeCanvas()`.
- **Sensor tare correction for off-axis wrist mount** (#69) — gravity-aligned tare extracts only heading (yaw around Z/up), keeping the reference frame level. Auto-recenters on next render frame. Tilt-tare correction works with default axis mapping (X=roll).
- **Sensor mode pole/gimbal-lock fix** — replaced delta-based yaw/pitch tracking in renderer.js with a single absolute path via `applyAxisMapQuat()`. Forward-vector path now auto-selects the correct forward axis based on axis map configuration, avoiding gimbal lock when roll is muted.

### Added
- **Zero reference indicator on sphere** (#10) — visual meridian + equator marker showing where sensor zero is, so drift is visible over time. Toggleable via viz settings.
- **Recenter / drift correction** — `recenterCursor()` computes a shortest-arc rotation offset mapping current camera forward to front-center. Applied every frame. Composed with existing drift offset. (Button currently disabled pending further testing.)
- **Backtick (`) keyboard shortcut for tare** — quick tare from keyboard without opening sensor panel.
- **Sensor panel UI improvements** — tooltips on all axis map controls, caution notes for mounting orientation and roll axis requirements. Axis mute buttons disabled with explanation (known pole/yaw bug).
- **HUD scale and UI scale** — `S.hudScale` (canvas HUD) and `S.uiScale` (DOM) sliders with persistence.

### Changed
- **Sensor axis map refactored** — `applyAxisMapQuat()` rewritten with two clear paths: forward-vector (roll muted/unmapped) and Euler (all axes active). New `findForwardAxis()` helper auto-detects which physical axis is the pointing direction. `forwardVecFromQuat()` supports x/y/z forward axes, not just x.
- **Renderer sensor mode simplified** — removed 80+ lines of delta-based tracking code. Sensor mode now uses the same absolute `getSensorCamQ()` path for all cases, with axis lock applied on top.
- **Max controller patch updated** — expanded `mubone-controller.maxpat` with additional routing.

---

## 0.7 alpha — 2026-03-26

### Fixed
- **Loop fade-out mode broken** — fade path in `_stopSeqAudio` disconnected VBAP/panner nodes and nulled source/gain references immediately after scheduling the gain ramp, cutting audio before the fade could complete. Now defers all cleanup to the `ended` event (same pattern as play-to-end). Slot removal also deferred so grain scheduler doesn't interfere during fade.
- **`/seed/trail` OSC handler used undefined `val`** — was referencing MIDI handler variable instead of `values[0]`. Fixed.
- **`/seed/lock` OSC handler set wrong state** — was directly setting `S.seedLockEnabled` instead of cycling trace mode. Fixed.
- **`/seed/loopmode` referenced removed `S.seedSlots`** — updated to use `S.commitSlots` with `S.seedSlots` fallback.
- **`/seed/clear` and `/seed/uproot` called removed functions** — updated to call `clearAllCommits()` and `releaseCommit()`.
- **`/loop/mode` set wrong state** — was setting `S.seqModeEnabled` (removed). Now sets `S.commitMode`.
- **Overflow: drop/draw buttons stayed greyed when slots full** (#26) — buttons now only disable when overflow is off.
- **D-loop + trace conflict** (#27) — mutual exclusion via `_cLoopActive`/`_traceActive` flags with proper handoff on release.
- **Release-all didn't work** (#25) — ⌘D tap now releases one commit (nearest/farthest per `selectionMode`). Hold-to-clear removed; clear-all is GUI button only.
- **K count slider minimum range** (#15) — slider floor set to 30 so k can be set before painting.
- **Tooltip delay too fast with Learn off** (#21) — increased from 400ms to 3000ms.
- **`scan_toggle` key was 'X'** — corrected to 'S'.

### Added
- **Unified commit system** (#23) — clouds (particle-based) and loops (buffer-based) share a single `commitSlots[16]` pool. D key: tap=drop, hold=draw. Shift+D=cycle mode (cloud↔loop). ⌘D=release nearest/farthest. Three-function model: trace (spacebar) / scan (S) / commit (D). Selection mode (closest/farthest) for morph and release targeting. Legacy aliases preserve backward compatibility.
- **Trace mode cycle** (#28) — `S.traceMode` cycles through trace / trace+loop / trace+cloud. A key or button cycles mode. Trace+loop and D-loop are mutually exclusive with visual greying. Trace+cloud allows concurrent D-cloud drops with shelved seed recording.
- **Loop release mode: play-to-end** (#29) — `S.loopReleaseMode` ('fade'|'play-to-end'). Play-to-end disables loop flag on AudioBufferSourceNode, plays through to loopEnd with 50ms fade, auto-removes from slot via 'ended' event.
- **Configurable loop fade time** — `S.loopFadeTimeMs` (0–2000ms, default 15ms). New slider in loop subsettings. MIDI CC mappable, OSC `/commit/loop_fade_time`, preset save/load wired.
- **Canvas edge HUD** (#32) — 3-column top bar (A=trace, S=scan, D=commit) drawn in renderer.js, DOM text HUD with left/center/right layout, commit dots, patch info, HUD scale slider (0.5–2.0×) with localStorage persistence.
- **OSC commit handlers** — new `/commit/drop`, `/commit/draw`, `/commit/release`, `/commit/clear`, `/commit/mode`, `/commit/blend`, `/commit/tether`, `/commit/xfade`, `/commit/dir`, `/commit/attack`, `/commit/release_time`, `/commit/volume`, `/commit/speed`, `/commit/loop_release`, `/commit/loop_fade_time`, `/trace/mode`.
- **MIDI commit actions** — `trace_mode`, `commit_mode`, `commit_drop`, `commit_draw`, `commit_release`, `commit_clear`, `commit_slots`, `commit_overflow`, `commit_dir`, `commit_volume`, `commit_speed`, `commit_attack`, `commit_release_time`, `loop_release_mode`, `loop_fade_time`, `commit_blend`, `commit_tether`, `commit_xfade`. Legacy actions hidden from UI with `_legacy: true`.

### Changed
- **Cloud "attack"/"release" → "fade in"/"fade out"** — renamed across UI labels, state comments, patch table, grain.js, and improv panel. Consistent terminology with loop fade controls.
- **MIDI/OSC modules restructured** (#70) — ACTIONS array merged seed+loop groups into unified commit group. OSC dispatch rewritten for `/commit/*` and `/trace/*` paths. Legacy `/seed/*` and `/loop/*` handlers fixed for backward compatibility. Dead code removed (`seq_pause`/`seq_resume`, duplicate `seed_slots`/`seq_slots`).
- **Loop fade controls moved to loop subsettings** — fade out mode (fade/play→end) and fade ms slider relocated from cloud section to loop section in index.html.
- **Commit slot pool expanded** — MAX_COMMITS raised from 12 to 16, shared between clouds and loops.

---

## 0.6 alpha — 2026-03-24

### Added
- **Recording time meter** — HUD now shows total recorded audio duration next to the buffer count (`buffers: 3 · 2m14s`). Computed from live buffer durations, no expensive byte-counting.
- **Recording memory guard** — configurable limit (default 10 min) warns at 80% (amber) and 95% (red), blocks new recordings at 100% with "rec limit — sweep!" flash. Prevents silent tab crashes during long performances.
- **Rec limit slider** — new slider in audio settings → engine section. Range 2–30 minutes, persisted to localStorage.
- **Perf monitor rec bar** — new `rec` row in the performance monitor (P key) showing recorded time vs limit with amber/red thresholds.
- **Sweep auto-commit** — undo snapshot now auto-expires after 30s, freeing buffer memory even if the performer never paints again. Manual undo still works within the 30s window.

### Changed
- **Search panel restructured** — scope (area/nearest) is now the top-level decision, displayed first. Panel organized into two labeled sections: "selection" (k, order — always visible) and "area" (radius, recency, fill — hidden when scope is nearest). Area-only params disappear entirely in nearest mode instead of being greyed out.
- **Search terminology renamed** — "lock/snap/free" → scope: nearest/area. "k-all" → fill: all/k. "k-seq" → order: step/random. Updated across UI, MIDI table, OSC, patch table, and renderer.
- **Default button positions** — area, random, and k are now on the left of their toggle rows (default = left convention).
- **Area param order** — radius first, then recency, then fill (was fill, radius, recency).
- **Perf monitor k display standardized** — format is now `X / k (R) [W]` where X=firing, k=k-limit, (R)=in-radius pool (area mode only), [W]=world particle count (always shown). Nearest mode: `X / k [W]`. Area+all: `X all [W]`.
- **World particle count format** — k slider and perf monitor both use `[n]` square brackets for world particle count.
- **Canvas cursor label** — "snap" → "nearest" (violet text under cursor brush).

---

## 0.5 alpha — 2026-03-23

### Fixed
- **Surface mode: trackpad stuck at poles** — removed the `[-1,+1]` clamp on `_surfaceNY` that prevented the cursor from passing through the poles.
- **Surface mode: gimbal-lock bowing and roll** — replaced absolute yaw/pitch angle reconstruction with incremental world-yaw × local-pitch rotation (`camQ = qYaw * camQ * qPitch`). Straight trackpad lines now trace great circles at any orientation; no roll accumulation, no pole bowing.
- **Sensor mode: image spin at poles** — `applyAxisMapQuat` Euler decomposition entangled yaw and roll near pitch ±90°. Added a pole-safe forward-vector path (when roll is muted) that bypasses Euler entirely.
- **Sensor mode: bounce/snap at poles** — absolute orientation decomposition clamps pitch via `asin`, causing bounce-back and yaw snap at the poles. Replaced with delta-based tracking: each frame computes the small rotation since the last frame and applies it incrementally — same pattern as the trackpad fix. Continuous rotation through the poles now works in both modes.
- **Sensor mode: wrong axis mapping with roll muted** — forward-vector path used `[0,0,1]` but default axis map has X as forward. Fixed to `[1,0,0]`, producing correct yaw/pitch.
- **Sensor mode: roll mute toggle had no effect** — delta-based path always stripped roll. Now checks `rollMuted` flag: muted uses delta path, unmuted falls through to absolute 3DOF quaternion.
- **Shift+D / Shift+S button flash** — pressing Shift+D/S no longer causes the underlying bare-key buttons to visually flash.
- **k-all / k-nearest conflict** — k-all mode is now mutually exclusive with nearest lock. Toggling nearest forces k-all off; k-all toggle is disabled (greyed out) when nearest is active. Enforced everywhere: UI, MIDI, OSC, preset load, patch table.
- **k slider max capped at 20** — k slider now dynamically tracks total particle count, allowing selection up to the full particle pool. MIDI CC for k also scales to particle count.
- **Scroll hijacked radius** — default mouse wheel no longer adjusts search radius (was too easy to trigger accidentally). Radius is now keyboard-only ([ ] keys) or custom-bound scroll.

### Added
- **Sensor registry** (`sensor-registry.js`) — new generic sensor slot system. Sensors auto-discover from OSC messages (`/sensor/{name}/quaternion`, `/sensor/{name}/inertial`). Roles assigned per-stream (quaternion→cursor/frame, inertial→gesture). Replaces the old hardcoded cursor/wand/frame trio in `sensor.js`. Legacy `/space/*` addresses still work via aliases.
- **Sensor registry UI** (`ui-sensors.js`) — new modal panel (⊕ sensors button) showing all connected sensors, per-stream role assignment, axis map with sign/mute, tare controls, and live raw readouts. Replaces the old two-column sensor calibration modal.
- **Seed morph extraction** (`seed-morph.js`) — preset interpolation (`lerpPresets`) and gesture-driven morph (`updateGestureMorph`) extracted from the deleted `wand.js` into a standalone module.
- **Gesture extraction promoted to core** — `gesture.js` now loads for all users (not just `?exp`). Completely rewritten with new feature set: intensity (EMA of gyroMag), smoothness (coefficient of variation), periodicity (dominant-axis autocorrelation with hysteresis), accumulated energy (leaky integrator). Removed directness (required quaternion). Added signal conditioning chain (inRange, deadZone, curve, outRange, smoothing) controllable from the gesture panel.
- **Gesture panel** (`gesture-panel.js`) — new in-page modal for live gesture visualization. Shows sparkline trails with draggable inMin/inMax thresholds, per-feature conditioning controls, and a joystick morpher. Opened via ◎ gesture button or Shift+G. Replaces the old `?exp`-only canvas overlay.
- **Session panel** — new top-level panel in the right column with mute (M), undo (⌃Z), sweep (−), lock cursor (Alt), and erase all (⌫×3) buttons. Consolidates session-level actions that were previously scattered or keyboard-only.
- **Erase all** — triple-press Delete/Backspace clears all particles, buffers, strokes, seeds, and loops. Shows progress indicator (Del 1/3, 2/3) and supports one-level undo. Erase-all button also available in the session panel.
- **Sweep keyboard shortcut** — minus key (−) triggers sweep. When no seeds/loops are active, sweep now acts as erase-all (clears everything).
- **Sweep undo for erase-all** — sweep snapshot now captures seed and loop state, allowing full undo after erase-all.
- **Frame sensor rotation** — sensors assigned the "frame" role rotate the virtual sphere independently of the camera. `sphere.js` applies `S.frameQ` in `cameraTransform`, `getCursorLonLat`, and `screenToLonLat`. VBAP spatial panning in `grain.js` also applies frame rotation to world positions.
- **k performance meter** — new "k" row in the perf monitor showing actual particles selected per tick, k setting, and pool size. Helps diagnose selection behavior at a glance.
- **World particle count on k slider** — `/n` indicator next to the k numbox shows total particles in the world.
- **Radius/recency greyed out in nearest mode** — radius slider, recency slider, and k-all toggle are visually disabled when nearest lock is active (since they have no effect).
- **Sensor connected/not-connected labels** — top-bar sensor group now shows "(connected)" / "(not connected)" status text.
- **Camera rotation design note** — prominent comment block in `renderer.js` documenting the gimbal-lock-free rotation pattern and why absolute Euler reconstruction must not be reintroduced.
- **Architecture docs** — new "Camera Rotation (gimbal-lock-free)" section in `mubone-architecture-notes.md`.
- **Routing design doc** (`docs/ROUTING-DESIGN.md`) — design document for future custom signal routing layer.
- **TODO reorganized** — tasks grouped by workshop prep priorities (memory, multi-channel, reliability) with experimental features deferred.

### Changed
- **Sensor system rewrite** — `sensor.js` gutted to a stub; all sensor logic, calibration, and state moved to `sensor-registry.js`. `ui-sensor.js` deleted and replaced by `ui-sensors.js`. `wand.js` and `ui-wand.js` deleted entirely; morph engine moved to `seed-morph.js`.
- **OSC dispatch refactored** — `osc.js` now routes through the sensor registry's generic `/sensor/{name}/{type}` convention. Legacy `/space/cursor`, `/space/frame`, `/space/wand` addresses auto-create named slots with correct roles.
- **Gesture features overhauled** — removed directness (quaternion-dependent), added intensity. Smoothness changed from jerk-based to coefficient-of-variation. Periodicity uses dominant-axis autocorrelation with hysteresis instead of gyroMag autocorrelation. All features now have raw (pre-conditioning) and conditioned (post-chain) outputs.
- **Morph settings simplified** — removed `morphHoldMode` (momentum/elastic), `morphElasticRate`, and `morphEnabled` from state and patch table. Morph behavior is now always momentum-based.
- **exp-init.js slimmed** — gesture and gesture-viz modules removed from experimental loader (they're now core). `?exp` flag only sets `S.exp = true` and shows the badge.
- **Search tooltips rewritten** — all search parameter tooltips (lock, k-all, k-seq, radius, k, recency) rewritten with clearer descriptions of behavior and interaction constraints.
- **Max patches updated** — `mubone-controller.maxpat` and `x-imu3.maxpat` updated with new OSC routing for the sensor registry convention.
- **Export includes sensor cal** — `mubone_sensor_cal` added to the static keys list in `ui-export.js`, and cleared on factory reset.
- **Sweep button moved** — sweep removed from top-bar system row; now lives in the session panel.
- **Undo button moved** — undo removed from the seeder panel inline; now in the session panel with consistent styling.
- **Wand config removed from save/load** — `wandConfig` references removed from `ui-audio-settings.js` save/load defaults and settings snapshot.

### Removed
- **wand.js** — wand controller mapping engine (531 lines). Morph/interpolation extracted to `seed-morph.js`; axis mapping replaced by sensor registry roles.
- **ui-wand.js** — wand control panel (700 lines). Live XY scatter, roll strip, inertial meters, and morph bar. Functionality replaced by gesture panel and sensor registry UI.
- **ui-sensor.js** — old two-column sensor calibration modal (173 lines). Replaced by `ui-sensors.js`.
- **Morph UI in improv panel** — morph enable (on/off) and morph hold mode (momentum/elastic) toggles removed from the improv settings panel.
- **Morph entries in patch table** — `morphEnabled` and `morphHoldMode` removed from `PARAM_REGISTRY`.

---

## 0.3 alpha — 2026-03-20

### Fixed
- **Seeder panel spacing** — `.improv-body` inherited `gap: 0.25rem` from `.device-body`, causing inconsistent spacing vs the looper panel. Added `gap: 0 !important` to match `.seq-body`.
- **Canvas arc negative radius** — `updateSeqBanksUI` and `updateSeedBanksUI` passed negative radius to `ctx.arc()` when many slots in a small canvas, producing 1000+ errors per page load. Clamped with `Math.max(0.5, ...)`.
- **Tooltip style on newer elements** — dynamically-set `title` attributes (e.g. on axis lock buttons) bypassed the custom tooltip system. Enhanced `MutationObserver` to also catch `attributes` mutations with `attributeFilter: ['title']`.
- **"remove nearest loop" terminology** — renamed to "lift" across all UI labels, tooltips, MIDI/OSC table, events.js comments, and index.html.

### Added
- **Sow trail action** — hold S to record a moving seed path; seed loops along the trail. New `sow_trail` entry in MIDI/OSC table, OSC handler (`/seed/trail`), and dedicated indicator button with teal-green active styling.
- **Independent axis locks** — azimuth and elevation can now be locked independently and simultaneously. Two new booleans (`axisLockAz`, `axisLockEl`) replace the single enum. Separate UI rows, patch table entries, MIDI/OSC toggle actions, and renderer logic.
- **Drop loop button** — dedicated big button for tap-D (drop loop), with pink flash on activation. Separate from draw loop (hold D).
- **Sow seed indicator button** — visual feedback for tap-S sow, matching the existing paint-indicator style.

### Changed
- **Axis lock type changed from hold to toggle** — press once to lock, press again to unlock. Updated MIDI dispatch to only act on press (ignores release).
- **Morph sticky mode** — instead of hiding the time parameter row, it's now greyed out with reduced opacity and disabled pointer events. Return mode keeps time fully visible and interactive.
- **Panel layout reorder** — slot config (slots + overflow) moved below the action buttons and transport row in both looper and seeder panels, placing it before the parameter sections.
- **D key dual-action** — tap D drops a loop, hold D draws a loop. S key follows same pattern: tap sows seed, hold sows trail.
- Updated CSS comment corrections (`A key` → `D key`, `sow` → `sow seed`).

---

## 0.2 alpha — 2026-03-19

### Fixed
- **MIDI noteOff never released hold actions** — hold actions (recpaint, paint1–10, alt_lock, lock_az, lock_el) got permanently stuck "on" when mapped to MIDI notes. Now handles both status-type-8 noteOff and velocity-0 noteOn.
- **seed_xfade CC blocked by toggle case** — the `dispatchAction` switch had a hardcoded toggle that ran instead of the ccFn. MIDI CC now smoothly controls 0–1 as intended.
- **Custom keyup released wrong action** — when two hold actions shared a key code with different modifiers (e.g. `E` vs `Shift+E`), keyup could release the wrong one. Now tracks active holds via a Map populated on keydown.
- **Scroll could be mapped to hold actions** — scroll events have no release, so hold actions would get stuck "on". Scroll learn mode now rejects hold actions with a status message.

### Added
- **Arm loop action (`seq_arm`)** — added to ACTIONS table as type `hold`, key `A`, OSC `/loop/arm`. Full press/release lifecycle in `dispatchAction`: press forces seq mode + starts recording, release creates loop + restores prior mode. Wired in osc.js.
- **Gesture extraction** (experimental, `?exp`) — `js/exp/gesture.js` extracts smoothness, effort, periodicity, accumulated energy, and directness from wand IMU data. `js/exp/gesture-viz.js` provides live feature bars, gyro trace, and energy arc overlay (press G to toggle).
- **CHANGELOG.md** — this file, for version tracking going forward.

### Changed
- `seq_remove` key label updated from `—` to `Shift+A` in ACTIONS table.
- `uproot_seed` key label updated from `↑` to `Shift+S` in ACTIONS table.
- Removed stale ArrowUp → uproot binding from events.js.
- Updated README with current project description and architecture.

---

## 0.1 alpha — 2026-03-17

Initial alpha release. Core granular engine, VBAP spatialization, preset system, looper, seeder, wand IMU input, MIDI/keyboard/OSC mapping system.
