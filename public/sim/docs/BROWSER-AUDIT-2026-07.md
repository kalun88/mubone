# Browser-Mode Audit — July 2026

> **Status: CURRENT** · audit of the browser (non-Electron) build at 1.11 alpha, run 2026-07-31 after ~4 months of Electron-only development. Fixes in the "Fixed" section are applied and verified; the "Open" section is not. Re-run `node scripts/browser-audit.js` to check the fixed items still hold.

---

## Headline: the deployed demo is five releases behind

**`mubone.org/sim` currently serves version 1.2 alpha.** Fetched and confirmed 2026-07-31 — the page reports `1.2 alpha`, has no erase panel, no accessory or LED buttons, no responsive tiers, and still labels the sensor indicator `MAX` rather than `OSC`.

Everything from 1.3 through 1.11 is absent from the public demo: the AudioWorklet grain engine, the unified sensor module, per-grain filtering, the dry monitor layer, the 48 kHz migration, the unified commit system, the UI redesign, drag-rearrangeable panels, the erase brush, the responsive column tiers, and the export/import v3 format.

There is no deploy config in the repo (no `wrangler.toml`, no CI workflow), so the publish step is manual and simply hasn't been run. **No amount of code fixing changes what visitors see until the current tree is redeployed.** That is the single highest-value action from this audit.

Two things to do before redeploying — both fixed below, but they are the reason a naive redeploy would have under-delivered:

1. The service worker would have pinned returning visitors to the old build anyway (see B1).
2. `_headers` already sets COOP/COEP correctly, so `SharedArrayBuffer` and the grain worklet will work on Cloudflare. Verified: the app is cross-origin isolated when served with those headers.

---

## The good news

The **code** is in much better browser shape than the deployed artefact suggests. Loaded headless at 1.11 with no `electronBridge`:

- zero page errors, zero console errors (after the fixes below), zero 404s
- all 10 panels and all 12 modals present and openable
- cross-origin isolated → `SharedArrayBuffer` available → the AudioWorklet grain engine runs
- `window.wg` and `window.acc` console shortcuts both exposed
- Electron gating is consistent — every `window.electronBridge` access is either `?.`-guarded or already inside an `isElectron` branch. No unguarded call was found.

Feature-by-feature, the 1.10/1.11 work is browser-capable:

| Feature | Browser status |
|---|---|
| AudioWorklet grain engine | works (SAB via COOP/COEP) |
| Erase brush (#132) | works — pure state + canvas |
| Panel drag-rearrange (#130) | works — pointer events |
| Responsive column tiers (#140) | works |
| Export/import v3 (#137) | works — localStorage + File API |
| Perf-audit fixes (#128) | works |
| Sensor over USB | works — WebSerial, incl. the `serial_mode` read-back |
| Serial accessory A8 (#147) | works — shares `parseDataLine`, so `case 'S'` is reached over WebSerial too |
| x-IMU3 LED feedback | works — commands go out over WebSerial |
| Sensor over WiFi | works **locally** via `node proxy.js` (ws 8081 control + ws 8080 data) |
| MIDI | works — Web MIDI, secure context |
| Multichannel / VBAP >2ch | Electron only — browser is stereo, by design |
| External OSC out (`osc-out.js`) | Electron only — already reports `unavailable` to the UI |
| Native fullscreen | browser uses the Fullscreen API instead — fine |

---

## Fixed

### B1 — the service worker would have pinned everyone to the old build

`sw.js` was **cache-first for every file**, with `CACHE_VERSION = 'mubone-1.10.0-alpha'` — stale, because the release checklist in CLAUDE.md listed only `index.html`, `package.json` and `CHANGELOG.md`. With cache-first, the version string is the *only* thing that can evict a cached file. So a returning visitor would have kept getting the cached build after a redeploy, indefinitely.

Worse, the cache also had **8 modules missing from `APP_SHELL`**: `accessory-registry.js`, `ui-accessory.js`, `ui-led-map.js`, `erase.js`, `panel-drag.js`, `status-publisher.js`, `osc-stream.js`, `ui-posture-map.js`.

Changes:

- `CACHE_VERSION` → `mubone-1.11.0-alpha`; all 8 missing modules added to `APP_SHELL`.
- **Fetch strategy split**: code (`.html/.js/.css/.mjs` + navigations) is now **network-first with cache fallback**; static assets (fonts, images) stay cache-first. Online visitors always get current code; offline visitors still get the whole app. The version string becomes a cache-eviction hint rather than a single point of failure.
- `install` now caches entries individually instead of `cache.addAll()`. `addAll` is all-or-nothing, so one stale path in `APP_SHELL` would have aborted the install and left the previous worker in place — the failure mode is now a warned-about missing file, not a dead service worker.
- **CLAUDE.md release checklist gained `sw.js` as item 4**, with a one-liner that lists any `js/` module missing from `APP_SHELL`. This is the root cause of the drift, not the symptom.

Verified end-to-end in `scripts/browser-audit.js`: after priming the cache, editing `index.html` on disk **without** touching `CACHE_VERSION`, and reloading, the new content is served — and the app still loads fully offline (10 panels, 12 modals, grain worklet present, no page errors).

### B1b — the service worker was running inside Electron

Found immediately after B1 shipped, because the network-first change made a pre-existing bug loud. The registration gate in `index.html` was:

```js
if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1')
```

**A `file://` URL has an empty hostname.** It is neither `'localhost'` nor `'127.0.0.1'`, so both tests passed and **the worker registered inside the packaged desktop app**, where it then served Electron out of the *browser* build's cache. Symptom: Electron opening on an old version, and ⌘R failing with

```
electron: Failed to load URL: file:///…/index.html with error: ERR_FAILED
```

while ⌘⇧R (which bypasses the service worker) showed the correct build.

Under the old cache-first strategy this was silent — Electron just quietly ran whatever the cache held. Network-first made it fatal instead: `fetch()` of a `file://` URL always rejects, the cache lookup misses for that request, and the handler returned `Response.error()`. **The bug predates this audit; only the symptom is new.**

Fixes:

- Registration now gates on `location.protocol` being `http:`/`https:`, and bails out explicitly when `window.electronBridge?.isElectron` or `file:`.
- On that bail-out path it **actively unregisters** any existing worker and deletes its caches — otherwise a registration left behind by the old gate keeps intercepting the desktop app forever. This is a one-shot cleanup; it logs a warning and asks for one more reload.
- `sw.js`'s fetch handler now ignores any non-`http(s)` scheme, as defence in depth.
- A navigation that misses the cache now falls back to the cached `./index.html` shell instead of a bare `Response.error()`.

Two static assertions in `scripts/browser-audit.js` guard the regression: the registration must reference `location.protocol`, and `sw.js` must reject non-http schemes.

**Lesson: never gate an environment check on hostname alone.** `file://` has no hostname, so hostname-based allowlists silently include Electron.

### B2 — a hosted demo logged connection errors on every visit

`osc.js` and `imu-setup.js` both dialled `ws://localhost:8080` / `:8081` unconditionally in browser mode. Those addresses are only reachable when the page is itself served from the same machine, so on `mubone.org/sim` every first-time visitor got red `ERR_CONNECTION_REFUSED` errors in the console with nothing they could do about it.

Both now check the origin and skip the local bridge on a hosted page; a local origin still retries exactly as before, because a local dev genuinely may be about to start Max or `proxy.js`. Verified: hosted-origin console is now completely clean, local-origin still attempts the bridge.

### B3 — the sensor panel said WiFi was desktop-only. It isn't.

`ui-imu-setup.js` told browser users: *"WiFi is only available in the desktop app — use the Max patch OSC websocket bridge"*. But `imu-setup.js` has had a full browser WiFi path for some time: `_initBrowserTransport()` opens a control channel to `proxy.js`, which does UDP discovery and relays connect / disconnect / commands. The copy predated the feature.

Now three-way: Electron listens on UDP; a **local** browser is told to run `node proxy.js` (and that serial/USB needs nothing extra); a **hosted** browser is told WiFi isn't reachable from a hosted page and pointed at WebSerial.

### B4 — the multichannel story was invisible in the browser, not degraded

`initSpeakerBuses()` is an Electron no-op, so `S.speakerAnalysers` never populates in the browser — and the only code that revealed `#asHouseSpeakersRow` and `#asStereoMixdownRow` sat inside `if (S.speakerAnalysers?.length)`. Result: the house-speaker count and stereo-mixdown controls simply *didn't exist* in the browser UI, which reads as "mubone is a stereo app" rather than "this is the desktop feature".

`syncHouseSpeakersSeg()` already contained the correct disabled state and explanatory note for browser mode — it was just never called. Now called on modal open in browser mode, with the rows revealed. Both controls are visible, disabled, dimmed to 0.35, and carry an explanation.

### B5 — the buffer-size control looked live but ignored you

`#asBufferSize` was correctly `disabled` in browser mode but styled identically to an enabled select, so it read as a setting that silently does nothing. Now dimmed with `cursor: not-allowed`; the existing tooltip explains the 128-sample render quantum.

### B6 — the OSC panel advertised a UDP port the browser doesn't have

`#oscStationInline` read `solo (port 7500)` in browser mode. There is no UDP listener in a browser — OSC arrives over the WebSocket bridge. Anyone following that text would have configured a `[udpsend]` aimed at nothing. Now reads: *"browser — OSC arrives over the ws://localhost:8080 bridge, not UDP"*. (`#oscPortDisplay` was already correct at `ws 8080`.)

### B7 — the app visibly re-laid-out itself on every startup

Reported as "it shows the default layout and the help overlay for a split second, then loads the persisted settings". Not browser-specific — it happens in Electron too, and worse there.

`main.js` is `type="module"`, so it runs **after** the document has been parsed and painted. It then applies four things from `localStorage`, each of which moves the UI:

| applied in | what moves |
|---|---|
| `ui-viz.js` `applyUiScale` | root `font-size` — reflows everything |
| `main.js` panel-order restore + repartition | panels change column |
| `main.js` collapse restore | panels change height |
| `events.js` projector partition | 5-column layout replaces the flat one |
| `main.js` first-run-hint decision | the "get started" overlay is hidden |

Measured on a seeded non-default layout: **three distinct painted states**, with the first panel at `x=1094`, then `973`, then `23`, all inside ~140 ms. In Electron, with ~40 ES modules to load before `main.js` body runs, that spread is long enough to read as the app loading twice.

Fix — a boot veil:

- An inline **blocking** `<script>` in `<head>` (runs before first paint) adds `html.booting` and applies the saved UI scale immediately, so the root font-size never reflows at all.
- `html.booting .main-layout { opacity: 0 }` hides only the part that moves. **The top bar stays visible**, so the window still reads as "opened" rather than going blank.
- `main.js` lifts the veil in a `requestAnimationFrame` right after the section-collapse restore — the last thing that moves anything — so the browser paints the settled layout once.
- The fade transition is attached via a separate `booting-reveal` class that is removed after 400 ms, so no permanent compositing layer sits over the canvas (the render loop is timing-sensitive — see CLAUDE.md).
- `prefers-reduced-motion` skips the fade.

**Failsafe:** the head script removes `booting` unconditionally after 4 s and logs a warning. If `main.js` ever throws before reaching the reveal, the app appears anyway — an unstyled flash is a papercut, a blank window mid-show is not. Verified by blocking `main.js` entirely.

Verified in `scripts/browser-audit.js`: with a seeded non-default layout, the only panel position the user ever sees is the final one, and the UI scale is already correct before anything is visible.

**If you add new startup work that moves the UI, put it before the reveal in `main.js`** — otherwise the flash comes back for that element.

### B8 — factory reset didn't reach the offline cache

Checked in response to "does the reset button still cover everything after all these changes".

**The good news: it can't drift.** Factory reset uses `localStorage.clear()`, not an enumerated key list. A full storage inventory found the app persists to localStorage **only** — ~40 keys across audio defaults, sensor calibration, MIDI/OSC/key maps, panel layout, accessory config, LED map, presets and locks. No IndexedDB, no sessionStorage. Electron adds nothing outside the userData profile (which is where localStorage lives). So every key any module adds in future is already covered, by construction. This is the opposite of the export path, whose enumerated `STATIC_KEYS` list drifted and was missing 9 keys (see `EXPORT-IMPORT-AUDIT-2026-07.md`) — worth keeping it that way.

**The gap:** `localStorage.clear()` does not touch **Cache Storage or the service worker**. In browser mode those survived a reset and kept serving the previous build — so "back to day one" was untrue in exactly the situation where someone reaches for factory reset, i.e. something is behaving strangely and they want a clean slate.

Fixed: the confirm handler now also deletes every cache and unregisters every service worker before reloading. Details:

- The teardown is raced against a 1500 ms timeout. A reset that hangs before `location.reload()` would leave the app half-wiped, which is worse than an uncleared cache.
- The confirm button disables itself and shows "resetting…" — the handler is now async, so the click is no longer instantaneous.
- The dialog copy now says "…calibration, **and the offline cache**". It should say what it does.
- No-op in Electron, where neither API is in play.

Also removed: `_showResetDialog()`, a 21-line generic reset-dialog helper that was defined and never called.

Verified in `scripts/browser-audit.js`, which drives the real dialog: it dirties storage, plants a sentinel cache entry, clicks through with "keep my patches" ticked, and then asserts the presets survived, the sentinel is gone, and the app boots clean on the other side. Counting caches after the reset proves nothing — the service worker legitimately re-registers and re-caches on the reload, and *that is* day one.

For reference, the keys a clean boot immediately re-writes (so seeing them after a reset is correct, not leakage): `mubone-learn-mode`, `mubone-hud-scale`, `mubone_darkMode`, `mubone_sensor_cal_v`, `mubone_preset_view`, `mubone_projector_layout_v2`, `mubone_uiScale`.

---

## Gotcha worth remembering

**`title` set from JavaScript is swallowed.** `ui-learn.js` runs a MutationObserver that moves every `title` attribute into `data-title` and strips the original, to feed the custom tooltip system. Setting `el.title = '…'` still ends up working (the observer relocates it), but **reading `el.title` back always returns empty** — which will mislead any test or debug probe. Write and read `data-title`. This cost a false failure during this audit.

---

## Open — not fixed

1. **Redeploy `mubone.org/sim`.** Nothing above is visible to anyone until this happens. Consider adding a `wrangler.toml` / deploy script so the publish step is repeatable rather than remembered, and add it to the release checklist alongside `sw.js`.
2. **`docs/TODO.md` #146 confirmed.** `perfTick()` in `state.js` (~line 785) still queries `#loadIndicator` and `#vmNodeBar`, and neither exists in the DOM — verified at runtime, both `ABSENT`. The always-visible load/drift warning is genuinely gone, in both modes. Left alone because "restore or delete" is a design call, not a bug fix; note that restoring it matters more in the browser, where there is no Electron console to fall back on. Two dead `getElementById` calls per `perfTick` in the meantime.
3. **`.js-osc-port` help spans** still print `7500` in the Max `[udpsend]` example even in browser mode. Low harm now that B6 states the transport, but the Max setup block as a whole is Electron-shaped.
4. **Untested by this audit:** live audio, mic capture, actual granulation, WebSerial against a real x-imu3, and MIDI against real hardware. The harness has no audio device or sensor. B1–B6 are all structural/UI; the audio path was inspected by reading (`grain-worklet-bridge.js:283` connects straight to `ctx.destination` when `S.speakerBuses` is absent, which is the correct stereo browser path) but not heard.
5. **Mobile.** `S.isMobile` gates a separate mode; not exercised here.

---

## Harness

`scripts/browser-audit.js` — companion to `scripts/ui-shots.js` (which covers layout only). Starts its own COOP/COEP static server and runs three passes: local origin, hosted origin (via `127.0.0.2`, which is loopback and therefore a secure context, so the service worker registers without needing TLS), and a service-worker redeploy + offline test. Exits non-zero on failure.

```
node scripts/browser-audit.js
```

Setup is identical to `ui-shots.js` (`playwright-core` + `chromium-headless-shell`, plus the `libXdamage` stub in sandboxes).

## Verification checklist — needs a real machine

- [ ] Redeploy current tree to `mubone.org/sim`; confirm the top bar reads `1.11 alpha`.
- [ ] Load the redeployed demo in a browser that visited the **old** site, without clearing site data — confirm 1.11 appears (this is the B1 fix under real conditions; the old cache-first worker has to be superseded once).
- [ ] Open DevTools on a first visit to the deployed demo: console should be clean, no `ws://localhost` errors.
- [ ] Paint and scan with the laptop mic in the browser — confirm audible granulation, stereo panning follows the cursor.
- [ ] Connect an x-imu3 over USB from the browser (sensor setup → serial / USB → add USB device); confirm quaternion arrives, LED handshake blinks, and `serial_mode` reads back.
- [ ] Plug in the A8 accessory over the same WebSerial connection; confirm channels appear in the accessory modal and drive actions.
- [ ] Run `node proxy.js` next to a locally-served page; confirm WiFi discovery populates the list per the new B3 copy.
- [ ] Audio settings in browser: house-speakers and stereo-mixdown rows visible and greyed, buffer size greyed, tooltips readable.
- [ ] Export a session in the browser, reimport it, confirm v3 round-trip.
