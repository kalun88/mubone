# CLAUDE.md — Project Context for Cowork / Claude Code

> **Status: CURRENT — this file is authoritative.** Last verified against the code 2026-08-02 (1.12 alpha). Read this first on every new session, then read only the docs the table below marks as relevant *and* CURRENT. If this file disagrees with a doc, this file wins; if it disagrees with the code, **the code wins** — and fix the doc.

Then read relevant docs from `docs/` depending on the task.

---

## What is mubone?

A browser-based spatial granular synthesizer for live acoustic instrumentalists. The performer plays into a mic, audio is recorded into a particle cloud on a 3D sphere, and grains are spatialized via VBAP to multi-channel speakers. An **x-imu3** sensor tracks orientation for the cursor; additional sensors can be added via the generic sensor registry (`/sensor/{name}/quaternion`).

Deployed to **mubone.org/sim** via Cloudflare Workers (static). Source is private on GitHub.

## How we work together

Ek is the only user of mubone. This shapes how we approach changes:

- **No compat hedging.** No legacy aliases, no deprecation shims, no "other collaborators might expect the old name". When renaming or removing something, just do it cleanly. One-shot migrations (read old key → write new key → delete old) are fine; persistent fallbacks are not.
- **Releases are explicit.** See the Versioning section. Normal edits don't bump versions, don't touch `CHANGELOG.md`, don't commit, don't push. These are separate actions Ek initiates.
- **Canonical terminology.** The performer-held sensor is an **x-imu3** — never "wand" or "IMU wand". Generic word is **sensor**. Active per-slot calibration lives in `sensor-registry.js`; `S.sensor3Cal` is a separate legacy-style slot used only by `gesture-window.html`. No `wandCal`. OSC convention: `/sensor/{name}/{type}`. If you see legacy terminology in code or docs, flag it as a rename candidate — don't match it.
- **Plan before executing.** For non-trivial changes, sketch the plan first (naming decisions, files touched, risks) and confirm before editing. Cheap to disagree in words; expensive to unwind a botched refactor.
- **Surface debt.** Flag stale docs, inconsistent naming, dead code when you see them — don't silently accommodate.

## Tech stack

- Vanilla HTML/JS/CSS — ES6 modules, no build step, no framework
- Web Audio API for all synthesis and processing
- Optional Electron wrapper for multi-channel audio output
- Max/MSP bridge for OSC/sensor input (Electron only)
- Python HTTPS server for local dev (`python3 serve.py` → https://localhost:4443)

## Repo structure

```
index.html          — single-page app entry point
js/                 — all modules (flat: state, audio, grain, renderer, UI, sensor, gesture, snapshot, staging, etc.)
js/worklets/        — AudioWorklet processors
css/                — styles
max/                — Max/MSP patches and Node.js bridge
electron-main.js    — Electron main process
electron-preload.js — Electron preload bridge
docs/               — project reference documents (see below)
```

## Key architecture patterns

- **Shared state object `S`** (in `state.js`): all modules read/write to `S`. Callback hooks (`S._funcName = handler`) avoid circular imports.
- **AudioWorklet grain engine** (`js/worklets/grain-engine.worklet.js`): all grain synthesis runs on the audio thread with sample-accurate onset timing. The main-thread scheduler (`grain.js`, **20ms interval — `GRAIN_SCHEDULER_INTERVAL_MS` in state.js**) only performs spatial search and posts candidate lists to the worklet via `postMessage` at ~50Hz. Bridge code in `grain-worklet-bridge.js`.
- **Sensor registry** (`sensor-registry.js`): sensors register themselves from incoming OSC traffic at `/sensor/{name}/{type}`. Roles (cursor / frame / gesture input) are assigned per stream. The x-imu3 is the primary sensor in use today.
- **Accessory registry** (`accessory-registry.js` + `ui-accessory.js`): the x-IMU3's serial accessory (**x-IMU3-SA-A8** — 8 analogue inputs, 12-bit, fixed 100 Hz) arrives as `S` data messages through the same `imu-setup.parseDataLine` path as `Q`/`I`. Channels declare a role (pot / slider / button) and bind to the **shared `ACTIONS` registry** that `midi.js` publishes on `S._actions` / `S._dispatchAction` — accessory, MIDI, keys and OSC all dispatch through one table, so don't add a parallel mapping system. Addressed by pad number 1–8 (silkscreen), not array index. Device settings are read on connect and never written automatically.
- **VBAP** for spatial panning — pre-computed lookup table, O(1) per grain, works for any speaker count.
- **Head-locked vs world-locked** spatial modes.
- **Preset system** with 20 slots, save/load to localStorage.

### Render-path performance — protect the scheduler

The grain scheduler is timing-sensitive (20ms interval, audio-rate onset precision). The render loop (30fps RAF) shares the main thread and can starve it. **Moving cloud trail rendering was the #1 source of scheduler drift** until the Mar 29 optimization pass (#108). Key invariants to preserve:

- **`projectInto()` + `updateProjectionCache()`** — zero-alloc projection for hot paths. Trail rendering must never use `project()` (allocates per call). The projection cache (focalLen, canvas half-dims) is set once per frame in `drawFrame()`.
- **Batched canvas fills** — all trail dots go into a single `beginPath()/fill()`. Never revert to per-dot `beginPath()/arc()/fill()` triplets — that was the main GPU stall.
- **`_TRAIL_BUDGET = 120`** — total trail projections per frame, shared across all moving seeds. Keep this low. The old value (200) caused measurable scheduler drift.
- **`_interpolateMovingSeed()` reuses `seed._currentFrame`** — no per-tick object allocation in the scheduler. Don't change this to return a new object.

If you add new per-frame work to the render loop (especially anything with trig, projection, or canvas calls), profile against scheduler drift first.

## Off-main-GUI work lives in the DevTools console

The old `?exp` URL flag and `js/exp/` subfolder were removed (2026-04-23). Everything that was gated by them is either always-on now (gesture, snapshot-engine, staging UI) or can be invoked from the DevTools console via `await import('./js/<module>.js')`. Console shortcuts: `window.wg` (worklet control) is always exposed.

**Don't reintroduce the pattern.** When adding untested or research code:

- Do NOT add a new URL flag (`?exp`, `?flag`, etc.) to gate it. The only URL flag that should exist is `?debug` for verbose console logging.
- Do NOT create a feature-flag const in `state.js` that reads from URL params.
- Do NOT add a new `js/exp/` or `js/experimental/` or `js/beta/` subfolder. All modules live flat under `js/`.
- Do NOT import a new experimental module from `main.js` if it's not ready to always-run. Let it sit in `js/` as a standalone module and load it from the DevTools console when you want to try it.

If a module is mature enough to always load, wire it into `main.js` directly. If it's not, leave it unreferenced — Ek will pull it in from the console. This is the one-bit gate: "imported by `main.js`" vs "not imported by `main.js`". No URL flags.

## Versioning — releases are explicit, never automatic

Current version: **1.12 alpha** (`1.12.0-alpha` in `package.json`). **Do not bump the version, touch `CHANGELOG.md`, or commit/push as part of a normal change.** A release is a separate, explicit action Ek initiates ("release" / "bump" / "commit & push", ideally via a release skill). Only then do these four updates apply:

1. **`index.html`** line 17 — the `<span class="top-bar-version">` text shown in the UI
2. **`package.json`** line 3 — the `"version"` field (semver format, e.g. `"1.10.0-alpha"`)
3. **`CHANGELOG.md`** — add a new section at the top with the version, date, and what changed (grouped into Fixed / Added / Changed / Removed)
4. **`sw.js`** — `CACHE_VERSION` (must match, e.g. `'mubone-1.12.0-alpha'`) **and** `APP_SHELL` if any `js/` module was added or renamed since the last release. This is the browser deploy's cache key; it went un-bumped for the whole 1.11 cycle. Check with:
   `node -e "const s=require('fs').readFileSync('sw.js','utf8'),l=new Set([...s.matchAll(/'\.\/(js\/[^']+)'/g)].map(m=>m[1]));require('fs').readdirSync('js').filter(f=>f.endsWith('.js')&&!l.has('js/'+f)).forEach(f=>console.log('missing from APP_SHELL:',f))"`

Bump the minor number for feature work or meaningful bug fixes (1.10 → 1.11). Bump the patch for hotfixes (1.10.1). Stay on "alpha" until public beta. `git commit` / `git push` are also explicit — never automatic.

## Reference documents (read as needed)

**Every doc carries a status banner directly under its H1 — read it before reading the doc.** The four statuses:

- **CURRENT** — describes shipped behaviour; trust it (but code always wins on conflict)
- **DESIGN INTENT** — the *why*; may be only partly built, banner says how much
- **HISTORICAL** — completed work, kept as record + revert instructions; **does not describe today**
- **PROPOSAL — NOT IMPLEMENTED** — never built; do not treat as reality

| Doc | Status | When to read |
|---|---|---|
| `docs/TODO.md` | CURRENT | **Always check this** — current tasks, priorities, what's done |
| `docs/MULTI-INSTANCE-PLAN.md` | CURRENT | Multi-station setups (3 windows/sensors on one machine), instance profiles, per-instance OSC ports, WiFi mode findings |
| `docs/KEYBOARD-SHORTCUTS.md` | CURRENT | Working on UI / hotkeys / input handling |
| `docs/TIMING-REFERENCE.md` | CURRENT | Timing-sensitive code — master table of intervals, rates, scheduling values (line numbers drift; trust file + constant names) |
| `docs/mubone-architecture-notes.md` | CURRENT | Audio routing, multi-channel, VBAP, Electron bridge |
| `docs/XIMU3-SETTINGS.md` | CURRENT | Anything touching the x-imu3 connect handshake, device settings, or message rates — what mubone consumes, the enforced table, read-back verification, the Max patch conflict |
| `docs/EULER-VS-QUAT.md` | CURRENT | Sensor input format, Euler vs quaternion tradeoffs, roll-mute pole fix |
| `docs/SENSOR-MOUNTING.md` | CURRENT | Physical sensor placement — mounting orientations, axis alignment |
| `docs/TARE-RECENTER-ZERO.md` | CURRENT | Orientation tare / recenter / zero — how cursor zero works |
| `docs/ELECTRON-MULTICHANNEL-SETUP.md` | CURRENT | Setting up a fresh machine for multi-channel output |
| `docs/QUICK-START.md`, `README.md`, `INSTALL.md` | CURRENT | User-facing docs — update these when user-visible behaviour changes |
| `docs/INTERACTION-MODEL.md` | DESIGN INTENT | Trace / scan / commit — the reasoning behind the model (largely shipped) |
| `docs/ROUTING-DESIGN.md` | DESIGN INTENT (partial) | Routing architecture — **custom-routing destinations are no-op scaffolding**, verify against `sensor-registry.js` |
| `docs/EXP-NOTES.md` | MIXED | Gesture/snapshot/staging shipped; the rest is unbuilt idea-space |
| `docs/STAGING-PLAN.md` | HISTORICAL (built) | Staging design reasoning + mapping-preset schema |
| `docs/BROWSER-AUDIT-2026-07.md` | CURRENT | Anything touching the browser (non-Electron) build, or deploying to mubone.org/sim. Also the service-worker caching contract. Verification #153 unrun |
| `docs/PERFORMANCE-AUDIT-2026-07.md` | HISTORICAL | What was slow, what was fixed (tagged `perf audit <ID>` in code), what was deferred. Verification #129 unrun |
| `docs/EXPORT-IMPORT-AUDIT-2026-08.md` | CURRENT | **Read this before touching export/import.** Second audit (`EXPORT_VERSION` 5): setup and session are disjoint file types — setup is the rig, session is the music. The pre-v4 payload normaliser, the session's embedded patch, merge-vs-replace on import, and the open items E6–E8 |
| `docs/EXPORT-IMPORT-AUDIT-2026-07.md` | HISTORICAL | The first audit's A–D findings + fixes (`EXPORT_VERSION` 3). Its *format* description is superseded by the 2026-08 doc. Verification #138 unrun |
| `docs/GROUP-SHOW-NOISE-GLITCH.md` | HISTORICAL | The buffer-retention leak: investigation, fix, revert checklist |
| `docs/MULTI-IMU-PLAN.md` | HISTORICAL | April 2026 group show (role-switching one instance). **Superseded by MULTI-INSTANCE-PLAN.md**; its deferred items 1–2 are still open |
| `docs/NARROW-LAYOUT-PLAN.md` | HISTORICAL | Layout audit + responsive-tier rationale (shipped 1.11) |
| `docs/MAIN-PAGE-REDESIGN.md` | ⚠️ PROPOSAL — NOT IMPLEMENTED | Periscope/overview concept. **Nothing here exists in the app.** Don't use it to understand the current UI |
| `docs/archive/` | ARCHIVED | Completed plans and audits — record only, may use superseded terminology. Don't learn current behaviour from these |
| `CHANGELOG.md` | HISTORICAL RECORD | Version history. **Only edit during an explicit release.** Entries describe the code at that version, not now |

## Design principles

1. **Live acoustic input first.** The performer is an instrumentalist. Modules should process live mic signal or recorded granular buffers, not generate sound from oscillators.
2. **Gesture quality over axis mapping.** Sensor mapping should translate movement qualities (smoothness, effort, periodicity) into sonic qualities, not axis values into knob values.
3. **The system has memory.** Gestures deposit energy that decays over time. The system has inertia like a physical instrument.
4. **Main branch stays playable.** Don't break `main` — Ek uses it in jam sessions and live shows. Anything untested should be reachable only via the DevTools console (e.g. a standalone module that's not auto-imported from `main.js`), not wired into automatic startup.

## Debugging approach

**For CSS/layout work:** verify with the headless screenshot harness `scripts/ui-shots.js` (setup + usage in its header) instead of shipping blind — it renders index.html at the responsive tier widths and dumps column geometry as JSON. Browser mode only: layout/DOM, no audio.

**For anything touching a cc action's `range` or its `ccFn`:** run `node scripts/verify-action-ranges.js` (same setup as `ui-shots.js`). Every cc action declares the real-unit span its `ccFn` covers and the curve it applies; the accessory table does unit maths against that declaration, so a wrong `curve` flag is silent — the UI keeps showing plausible cents and Hz while the pot's throw is skewed. The script runs the actual `ccFn` at v = 0, 63.5, 127 and checks the half-throw reading, which is the only place lin and log disagree. Exits non-zero on mismatch.

**For anything touching browser mode or the service worker:** run `node scripts/browser-audit.js` (same setup as `ui-shots.js`). It loads the app with no `electronBridge` and asserts module load, Electron-only controls degrading visibly, hosted-origin console cleanliness, that startup paints the settled layout rather than reflowing into it, and that a redeploy reaches a returning visitor while offline still works. Exits non-zero on failure. Note when writing assertions: `ui-learn.js` moves every `title` attribute to `data-title` and strips it, so reading `el.title` back always returns empty.

When audio or worklet issues are hard to diagnose from code alone, **add diagnostic data to the worklet feedback message** (`_diag` object in `grain-engine.worklet.js` → feedback handler in `grain-worklet-bridge.js`). Log key values at ~1Hz so the console output can be shared back. This bridges the gap between code-level reasoning and what's actually happening at runtime — the worklet runs on a separate thread and can't use `console.log` directly. Example: adding `liveBufLen`, `liveRec`, `activeCount` to the feedback revealed that only 2 grains were active (should be ~10), immediately pointing to the duration clamping as the root cause.

## Code style

- Match existing patterns — look at neighboring code before writing
- Comments explain *why*, not *what*
- Constants at top of `state.js`, not scattered across modules
- UI wiring goes through `S` callbacks to avoid circular imports
- Performance-sensitive paths (grain scheduling, render loop) must stay lean
