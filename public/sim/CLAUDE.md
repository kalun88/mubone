# CLAUDE.md — Project Context for Cowork / Claude Code

> **Status: CURRENT — this file is authoritative.** Last verified against the code 2026-09-15 (5.0 alpha). Read this first on every new session, then ONLY the docs the table below marks as relevant to the task *and* CURRENT. If this file disagrees with a doc, this file wins; if it disagrees with the code, **the code wins** — and fix the doc.

> **This file stays under 32 KB** (`docs-audit.js` fails past it) and holds rules and pointers, not narrative — no paragraph here per change. Rulings go in `docs/RULINGS.md`, audit reasoning in `docs/AUDITS.md`, finished items in `docs/archive/TODO-DONE-<month>.md`.

---

## What is mubone?

A browser-based spatial granular synthesizer for live acoustic instrumentalists. The performer plays into a mic, audio is recorded into a particle cloud on a 3D sphere, and grains are spatialized via VBAP to multi-channel speakers. An **x-imu3** sensor tracks orientation for the cursor; additional sensors can be added via the generic sensor registry (`/sensor/{name}/quaternion`).

Deployed to **mubone.org/sim** via Cloudflare Workers (static). Source is private.

## How we work together

Ek is the only user of mubone. This shapes how we approach changes:

- **No compat hedging.** No legacy aliases, no deprecation shims, no "other collaborators might expect the old name". When renaming or removing something, just do it cleanly. One-shot migrations (read old key → write new key → delete old) are fine; persistent fallbacks are not.
- **Commit after each change; releases are explicit.** When a change is done and its mapped audit is green, commit it (Ek, 2026-09-05): one commit per change, the reasoning in the message, no push. Version bumps, `CHANGELOG.md` and pushes are separate actions Ek initiates — see Versioning.
- **The two engines are TAPE and GRAIN** (Ek, 2026-09-07). Tape plays a take WHOLE — `line`,
  `slice`, `looper`, `overdub`; grain plays it in fragments. `loop` was the engine's name until
  then and was wrong: a **loop is what a tape take becomes once you pin it**, so the engine was
  named after one outcome of half its tools, and `line` / `slice` / `dwell: once` never loop at
  all. `loop` still names the PIN KIND (`slot.type`, the pins rail, `commitMode`) and only that.
  The brush material is `tape`, never `hit` — **hit is out of the vocabulary** (Ek: "i hate hit,
  we should remove it from the vocab").
- **Canonical terminology.** The performer-held sensor is an **x-imu3** — never "wand" or "IMU wand". Generic word is **sensor**. Active per-slot calibration lives in `sensor-registry.js` — `quatCal.mountQuat` + `quatCal.headingQuat`, the two gestures described under Debugging approach. No `sensor3Cal` (deleted with `gesture-window.html`, 2026-09-05), no `wandCal`, no `tareEuler`, no device-level `polarity`. OSC convention: `/sensor/{name}/{type}`. If you see legacy terminology in code or docs, flag it as a rename candidate — don't match it.
- **Plan before executing — for what cannot be unwound.** A rename, a deletion, or a refactor that crosses modules gets a sketch first (naming, files, risks) and a confirmation. A bounded change inside one module, or anything a green audit proves, just goes; the round trip on every change cost more than it saved (Ek).
- **Surface debt.** Flag stale docs, inconsistent naming and dead code — never silently accommodate.
- **Session hygiene — the cheap session is the goal.** Start with this file and the open items in `docs/TODO.md` that touch the task; read nothing else end to end. Run the ONE audit the diff maps to (`node scripts/audit-for.js`, see Debugging approach), never the whole set. End by writing one entry of five lines or fewer per thing done into `docs/archive/TODO-DONE-<month>.md`, any new ruling as one paragraph in `docs/RULINGS.md`, and the long reasoning in the commit message. Nothing is added to this file unless a rule of the codebase changed. `/finish` is this close-out as one command; `/release` is the release checklist; a parallel session lives in its own worktree (`claude --worktree`, then `sh scripts/worktree-setup.sh`).

## Tech stack

- Vanilla HTML/JS/CSS — ES6 modules, no build step, no framework
- Web Audio API for all synthesis and processing
- Optional Electron wrapper for multi-channel audio output
- OSC in: binary OSC on UDP 7500 (Electron); `proxy.js` relays the x-imu3 into the browser over WebSocket 8080
- Python HTTPS server for local dev (`./serve.py` → https://localhost:4443; `--port` and
  `--host` to move it). Needs a `localhost.pem` / `localhost-key.pem` pair — gitignored as
  machine-specific, so generate them once with mkcert; the server says how if they are missing.

## Repo structure

```
index.html          — single-page app entry point
js/                 — all modules (flat: state, audio, grain, renderer, UI, sensor, brush, tiles, etc.)
js/worklets/        — AudioWorklet processors
css/                — styles
scripts/            — verification harnesses and launch helpers, run by hand
electron-main.js    — Electron main process
electron-preload.js — Electron preload bridge
docs/               — project reference documents (see below)
```

## What's live, and what only looks live

The repo carries finished experiments alongside running code. Recency is not evidence — a stale
`.maxpat` reads as authoritative until someone checks its UDP port. Each area has a marker.

- **`js/`** — the gate is *imported by `main.js`*. See "Off-main-GUI work" below. Since
  2026-09-05 every module in `js/` is on the right side of it (`docs-audit` fails on a new orphan
  unless it is declared in `KNOWN_ORPHANS`, which is empty). `node scripts/deadweight-audit.js`
  lists what has drifted toward the wrong side.
- **`docs/`** — the gate is the status banner under the H1. See the table below.
- **`sandbox/` is gone (2026-09-05).** The graveyard is git; `docs/archive/SANDBOX.md` is the ledger —
  every file that left, why, and how to read it (`git log --diff-filter=D -- <path>`). Nothing comes
  back from history unless Ek names it.
- **Max is a prototyping tool, not part of the app** (Ek, 2026-09-05): a patch tests custom OSC
  mappings on the fly. No module loads anything from it; the old patches are git history. Never add a
  code path that assumes Max, never describe it as a setup step, and name OSC senders generically.
- **`scripts/`** — the verification harnesses and launch helpers, all run by hand. Which one covers
  which file, and what each guards, is `docs/AUDITS.md`; `node scripts/audit-for.js` answers it from
  the diff. `dev-bridge.js` is the transport behind `.dev-bridge/`, `lib/rig.js` its node client.
  `composer-audit.js` no longer exists (its checks are in `pins-audit.js`); `live-loop-audit.js`
  exists and is run by hand.

## Control surface, and what browser mode is for

mubone's control surface is two ports. Anything that speaks them drives the app, and nothing
about either is specific to Max.

- **UDP 7500** — binary OSC, Electron only. Received in `electron-main.js`, dispatched by
  `js/osc.js`. This is the show path. Status goes back out on 7501; per-station ports come from
  `--osc-port` (`docs/MULTI-INSTANCE-PLAN.md`).
- **`ws://localhost:8080`** — `{ address, values }` JSON, browser only. `proxy.js` (x-IMU3 UDP →
  WebSocket) is the implementation this repo maintains and ships; mubone-joycon-gui has its own,
  and the example Max patches (git history) a third.

The address namespace is the dispatch `switch` in `js/osc.js` — an address not in there is not
handled, whatever a patch or a doc says. `README.md` tabulates it.

**Max is external, always** — see above; the patches are history and the two ports are the whole contract.

**Effort goes to Electron. The browser build is a demo** — not a second product held at parity.
It exists so the instrument can be shown without an install. Two things follow, both true in code: the hosted origin never opens the WebSocket (`_bridgeReachable()`), so the public demo
has no OSC input; and Electron-only controls are expected to degrade visibly rather than work.
`scripts/browser-audit.js` guards the second and stays mandatory at release — it catches Electron-only
assumptions leaking into shared modules, which breaks the rig too. Its offline / service-worker
assertions are demo-grade and can be relaxed if they ever cost real time. **The phone is the hosted
demo in a phone's browser** (`js/mobile.js`: gyro steers, a touch is the spacebar, the chrome hidden) —
no separate app, no phone work beyond `node scripts/phone-audit.js` staying green.

## Design and UX work

**Writing a GUI element? Read `docs/GUI-BUILD-SHEET.md` — that one page, not the long docs.**
It is the lookup: scope table, spacing scale, type, radius, both kits, the colour order of
operations, motion, and the always-wrong list. Every row is already argued somewhere else and the
*why* is not your problem while you are building. Read `DESIGN-SYSTEM.md` when you want to
**change** a rule; read the build sheet when you want to **follow** one.

**If the answer is not on the sheet, use the nearest thing that already exists.** Do not invent a
size, hue or radius. Adding to a kit is a decision Ek makes, not a side effect of a feature.

**Read `docs/DESIGN-SYSTEM.md` before touching `css/`, UI markup, or the cursor.** It carries Ek's
standing brief in his own words (flat, no gradients, simplicity as the tie-breaker, symbol and
colour over text, accuracy as part of the aesthetic) and the measured system underneath it —
tokens, the footer row grid, the rail's selection shapes, the settings type contract.

**Never claim something is aligned, centred, consistent or balanced without measuring it.** This is
the project's most-repeated failure: six times in two days a design change was reported as done, by
eye, and was wrong — captions on seven baselines, a group 105px into its neighbour, 32.4px of air
against 18.4. Every cause was structural and invisible until read as numbers. Read, change one
thing, read again.

    npm run audit:align     # the alignment invariants, against the running app; needs `npm run electron:dev`

It talks to the app through `.dev-bridge/` instead of launching Electron, so unlike the rig
harnesses it runs anywhere with the repo folder. **A design bug that shipped should leave
an invariant behind** — usually four lines, and the audit's blind spots are how the regressions
got out.

Two CSS traps, each of which has already cost a wrong diagnosis: an inline `style="font-size:…"`
outranks every stylesheet rule, and specificity is not reading order — a four-class selector beats
a three-class one anywhere.

## Key architecture patterns

One line each. The reasoning, the traps and the history are in `docs/RULINGS.md` under the same
words — read that entry before touching the area, and put a new ruling there, not here.

- **Shared state object `S`** (`state.js`): all modules read/write `S`; callback hooks (`S._funcName = handler`) avoid circular imports.
- **AudioWorklet grain engine** (`js/worklets/grain-engine.worklet.js`): synthesis on the audio thread with sample-accurate onsets; the main-thread scheduler (`grain.js`, `GRAIN_SCHEDULER_INTERVAL_MS` = 10 ms since 2026-09-06) only does spatial search and writes candidates into shared tables through `grain-worklet-bridge.js`.
- **Sensor registry** (`sensor-registry.js`): sensors self-register from `/sensor/{name}/{type}`; roles (cursor / frame / gesture) per stream; the x-imu3 is the primary sensor.
- **Accessory registry** (`accessory-registry.js`; its table UI was sunset 2026-08-28, git history): the x-IMU3-SA-A8's 8 channels (pad numbers 1–8, not indices) bind to the shared `ACTIONS` registry (`S._actions` / `S._dispatchAction`). Accessory, MIDI, keys and OSC all dispatch through ONE table — never add a parallel mapping system. Device settings are read on connect, never written automatically.
- **VBAP** spatial panning: pre-computed lookup, O(1) per grain, any speaker count. Head-locked vs world-locked modes.
- **A tile is the preset**: every grain tile owns and persists its whole block (`mubone_tiles`); the patch bank was sunset 2026-09-03 (git history).
- **`_held` is what plays, null between presses** (`js/tiles.js`). The engine flags (`traceMode`, `commitMode`, `scanMuted`, `lensReads`, `composerMode`) are the truth underneath; the tile screen drives them and follows them. `docs/archive/BRUSH-MODEL.md`.
- **One screen, and the rig cabinet** (`js/tile-layout.js`): the tile screen IS the app. `.top-bar` and `.right-panel` are permanently `display:none` and hold the 41 cabinet elements the engine pages write through. **Never delete a control there because nothing shows it** — move it to whatever owns its state, `engine-audit` green after.
- **ONE TILE, ONE VERB, and the verb is the TILE's** (`docs/PALETTE-GUI.md` is the authority — read it): `mubone_palette` is `[{id,verb}]`, ≤ 9; a tile fires `bang` · `momentary` · `toggle`, set by right-click on the strip tile from `verbsOf`. One action and one OSC address per POSITION (`palette_N`; its `type` is a getter over the verb), the same tool may sit twice in two verbs, built by DRAG only. The verb is DRAWN as the shape — `border-radius` (`VERB_RADIUS`).
- **The hand is ONE tool** (`inHand`), played by **space** and a left-click on the sphere in one global verb (`handVerb`); **the strip is quick access** — a tile fires from its own key in its own verb, never touching the hand. `Tab` shows the tool rail, never a drawer; the row's panel button (`[data-more]`) is the drawer's door. **Every learned key and note is a button** — one recogniser.
- **Overdub** (tape kind) records into the NEAREST pinned loop as a phase-locked layer on the master's gain nodes, pass by pass; nothing pinned, the first take IS the main loop, pinned on release like the looper. **Wash** (grain kind) pins its stroke at release as a moving cloud through the grain sheet's `on end` row (`S.traceMode`: `trace` / `trace+cloud`; `trace+loop` is deleted). `docs/archive/OVERDUB-PLAN.md`.
- **Shape encodes affordance** (rectangle = action, switch = yes/no, capsule = which one), **one hue per engine** (`--eng-*`), **never dim to mean anything**, flat surfaces. A true boolean on an engine sheet is the SWITCH, not an `on | off` capsule (2026-09-07). `docs/INSTRUMENT-GUI.md`.
- **A piece is the music, the rig is an export** (`js/piece.js`; `.mubone` is a zip of manifest + float32 audio, `js/mubone-file.js`): ⌘S · ⇧⌘S · ⌘O, a File menu, a quit guard, no autosave, nothing migrates.
- **One settings door** (`#settingsModal`, `js/ui-settings.js`): a section's body is the REAL modal's `.mu-dialog` moved in and moved back on close — never a copy, and anything borrowed must be returned. A setting with no nav item has no way in.
- **The engine page** (`renderProps`): one line per parameter, every number typeable, double-click resets to the tick. A `slider` param's raw value is its POSITION (the grain sliders are log-mapped) — typed values go through the numbox's `fromDisplay`, never a re-derived one.
- **Two left rails** (`#toolRail`, `#propRail`) overlay the stage, never resizing the sphere. A row that is a CHOICE (a lens, a source) wears `.on`; `.open` is the drawer's mark. A tool row wears neither.
- **The loop follows the button, and the machine knows its latency** (`js/latency.js`): press and release stamped on the audio clock, `S.latency` estimated or measured by loopback, one cushion (`S.audioCushionMs`, 10 ms) for both MessagePort hops — **the GUI thread is not in the audio path**. `docs/RULINGS.md` "the two IPC hops are bounded".
- **A pinned cloud owns its material** (`grain.js` `_refreshCloudClaims`): the cursor never granulates inside one; the claim is by PINNING, not sounding; `forCursor` keeps the cloud's own playback out of the skip; nearest mode needs its own. **The reach line is one per CANDIDATE** (`S._cursorPool`), the ring one per grain.
- **Pin groups are derived** (`groupOf(c)` is `c.type`) and **so is audibility** (`js/pins.js` `isPinAudible`: every pin has `mute` and `solo`, nothing stores on/off; `applyMix()` makes the engine agree). **The selected pin** (`selectedPinSlot`) is what unpin takes and the rail marks. Every pin parameter is on Settings → Pins — except the slot COUNT, which the rail's tracker sets too.
- **One pin press takes the whole moment** (`tiles.js` `pinDown`, 2026-09-14): every line the cursor is on becomes a loop — by `trigger._inside`, the gate's own geometry — and a granulating cursor (`S._cursorPool`) adds a cloud beside them. Nothing in reach still pins the ghost. One press is ONE undo (`history.js` `mergeTagged`).
- **A stroke freezes the brush that painted it** (`brush-voicing.js`): `resolveGrainParams()` is the ONE builder of a grain block, voicings interned and keyed on the TILE. **Wet paint** is the exception. **The lens owns how the cursor reads** (`k`, order, fill, radius, nearest, recency); the brush owns the sound.
- **A live mark is sized by the audio AFTER it**; **its grain starts before it** by `grainPeakOffsetS`, which the bridge subtracts per candidate for the voice that plays it — the mark stores only its moment.

**Render-path performance.** The 10 ms grain scheduler shares the main thread with the render loop
and trails have starved it (#108); four invariants hold it — `docs/RULINGS.md` "Render path".
Profile new per-frame work against scheduler drift first.

## Off-main-GUI work lives in the DevTools console

The old `?exp` URL flag and `js/exp/` subfolder were removed (2026-04-23). Everything that was gated by them is either always-on now or can be invoked from the DevTools console via `await import('./js/<module>.js')`. **Not gesture or snapshot-engine:** `gesture.js`, `gesture-panel.js`, `gesture-viz.js` and `snapshot-engine.js` were sunset 2026-08-29 and are git history, so there is nothing in `js/` to import. Console shortcuts: `window.wg` (worklet control) is always exposed.

**Don't reintroduce the pattern.** When adding untested or research code:

- Do NOT add a new URL flag (`?exp`, `?flag`, etc.) to gate it. The only URL flag that should exist is `?debug` for verbose console logging.
- Do NOT create a feature-flag const in `state.js` that reads from URL params.
- Do NOT add a new `js/exp/` or `js/experimental/` or `js/beta/` subfolder. All modules live flat under `js/`.
- Do NOT import a new experimental module from `main.js` if it's not ready to always-run. Let it sit in `js/` as a standalone module and load it from the DevTools console when you want to try it.

A module mature enough to always load is wired into `main.js`; otherwise it stays unreferenced and Ek pulls it in from the console. One-bit gate: imported by `main.js` or not. No URL flags.

## Versioning — releases are explicit, never automatic

Current version: **5.0 alpha** (`5.0.0-alpha` in `package.json`; the chrome shows the minor) **Do not bump the version, touch `CHANGELOG.md`, or push as part of a normal change** (see How we work together). A release is a separate, explicit action Ek initiates ("release" / "bump" / "push", ideally via a release skill). Only then do these five updates apply:

1. **`index.html`** — BOTH version strings: the `<span class="top-bar-version">` (cabinet, hidden) and the chrome brand `<b>mubone</b> <i>1.14</i>`, which is the one the player sees
2. **`package.json`** line 3 — the `"version"` field (semver, e.g. `"1.10.0-alpha"`)
3. **`CHANGELOG.md`** — add a new section at the top with the version, date, and what changed (grouped into Fixed / Added / Changed / Removed)
4. **`sw.js`** — `CACHE_VERSION` (must match, e.g. `'mubone-1.12.0-alpha'`) **and** `APP_SHELL` if any `js/` module was added or renamed since the last release. This is the browser deploy's cache key. The `/release` skill carries the one-liner that lists modules missing from `APP_SHELL`.

5. **This file** — the version in the status banner at the top and in the line above.

Bump the minor for feature work or meaningful fixes (1.10 → 1.11), the patch for hotfixes (1.10.1). Stay on "alpha" until public beta. `git push` is explicit, never automatic; a commit closes every change.

## Reference documents (read as needed)

**Every doc carries a status banner directly under its H1 — read it before reading the doc.** The four statuses:

- **CURRENT** — describes shipped behaviour; trust it (but code always wins on conflict)
- **DESIGN INTENT** — the *why*; may be only partly built, banner says how much
- **HISTORICAL** — completed work, kept as record + revert instructions; **does not describe today**
- **PROPOSAL — NOT IMPLEMENTED** — never built; do not treat as reality

**Nothing HISTORICAL lives in `docs/` any more** (2026-09-05); the unrun checklists the four archived ones held are named by their TODO items (#127, #129, #138, #336), so a checklist is found from the work, not from a doc.

**A doc about shipped behaviour is kept only for what the code cannot say** (Ek, 2026-09-05: most docs were plans for things that had shipped, and every session read them). Kept: a ruling and its why (`docs/RULINGS.md`), an operating procedure (the runbook, multi-instance), a hardware fact (x-imu3, BNO085, mounting), a design brief (the three GUI docs), a file or wire contract (export/import, OSC). Archived the day it ships: a plan, a brief for a round, a reading copy of the code — its rulings become one paragraph in `docs/RULINGS.md` first, and the archived file gets a banner saying where they went. A table cell says WHEN to read, with a concrete trigger. A session reads a doc's **Read this first** block and goes deeper only when the task is inside what it names.

| Doc | Status | When to read |
|---|---|---|
| `docs/GUI-BUILD-SHEET.md` | CURRENT | **The GUI lookup — read before writing any GUI element.** Scopes, spacing scale, type, radius, the instrument + settings kits, colour order-of-operations, motion, always-wrong. Sourced from `DESIGN-SYSTEM.md`, `INSTRUMENT-GUI.md`, `SETTINGS-GUI.md`, `PALETTE-GUI.md` |
| `docs/TODO.md` | CURRENT | **The OPEN list only** — done items are in `docs/archive/TODO-DONE-<month>.md`. Read the items that touch the task, not the file |
| `docs/RULINGS.md` | CURRENT | **The reasoning behind every architecture ruling** — palette, main button, overdub, wash, latency, cloud claims, pin groups, brush/lens split, wet paint, mark timing, and the rulings left by the archived plans (trigger tool, composer mode, the release glitch, sensors round ten). Read the entry for the area you touch; a new ruling goes here as one paragraph |
| `docs/AUDITS.md` | CURRENT | **Which audit to run for which file, and what each guards.** § 1 the two-tier rule, § 2 the file-to-suite map (`scripts/audit-for.js` is it as code), § 4 the per-suite reasoning and traps. Read before running any audit |
| `docs/CONSOLIDATION-PLAN.md` | CURRENT | The pre-ruled plan for consolidation rounds 26+. Every item is decided: work through them in order, come back only on a **STOP** condition or at the end |
| `docs/PERFORMANCE-AUDIT-2026-09.md` | PROPOSAL — NOT IMPLEMENTED | **Read before any latency or audio-glitch work.** The 2026-09-06 measurements (the GUI thread out of the hops, the cushion at 10 ms, the sensor flood, the full pool), the app's latency budget, and the ranked plan R1–R10 with files and proofs. `scripts/transport-probe.js` reproduces the numbers |
| `docs/FADING-STROKES.md` | PROPOSAL — NOT IMPLEMENTED | The 2026-09-05 study for a brush whose marks leave on their own (`life` per mark, heard through the per-candidate gain, the pin following its stroke into death). Nothing built |
| `docs/CAPS-AND-THROTTLES-2026-09.md` | CURRENT (audit) + PROPOSAL | **Read before touching any grain cap, throttle or budget.** What each one protects, whether it still binds, what the gauges themselves cost (measured), and the ranked plan P1–P6. § 3 is the answer to "how do we know the machine is at its limit" |
| `docs/MULTI-INSTANCE-PLAN.md` | CURRENT | Multi-station setups (3 windows/sensors on one machine), instance profiles, per-instance OSC ports, WiFi findings |
| `docs/KEYBOARD-SHORTCUTS.md` | CURRENT | Working on UI / hotkeys / input handling |
| `docs/mubone-architecture-notes.md` | CURRENT | Audio routing, multi-channel, VBAP, Electron bridge |
| `docs/XIMU3-SETTINGS.md` | CURRENT | The x-imu3 connect handshake, device settings, message rates — what mubone consumes and enforces |
| `docs/RIG-RUNBOOK.md` | CURRENT | **Read before a gig, and before diagnosing a jittery cursor.** Router settings, choosing a 2.4 GHz channel at the venue, the pre-show checklist (the instrument forgets its calibration on EVERY boot), reference jitter measurements |
| `docs/BNO085-CONTROL.md` | CURRENT (study) | The BNO085/SH-2 control surface — what the pico firmware exposes over OSC, what it half-implements, what nobody has wired up. Read before a BNO panel or touching `sygaldry-private/sygaldry/sygsp-bno085/` |
| `docs/EULER-VS-QUAT.md` | CURRENT | Sensor input format, Euler vs quaternion. Its roll-mute framing is superseded: since 2026-09-01 the camera takes no roll — the sensor drives the CURSOR and the camera is derived in `cameraFromPointing` |
| `docs/SENSOR-MOUNTING.md` | CURRENT | Physical sensor placement — mounting orientations, axis alignment |
| `docs/TARE-RECENTER-ZERO.md` | CURRENT | Mount calibration and zero heading — how cursor zero works; why recenter was deleted |
| `docs/ELECTRON-MULTICHANNEL-SETUP.md` | CURRENT | Setting up a fresh machine for multi-channel output |
| `docs/QUICK-START.md`, `README.md`, `INSTALL.md` | CURRENT | User-facing docs — update these when user-visible behaviour changes |
| `docs/DESIGN-SYSTEM.md` | CURRENT | **Read before any CSS, UI-markup or cursor change.** Ek's standing aesthetic brief (§ 1–3) and the built system (§ 4–6): tokens, the footer grid, the rail's selection language. § 3: measure, don't assert. Enforced by `npm run audit:align` |
| `docs/SETTINGS-GUI.md` | CURRENT | **Read before touching anything inside `#settingsModal`.** The row model, the closed ten-element kit, the sentence-case rule. Implemented by `css/settings-gui.css`, which loads AFTER `style.css` on purpose |
| `docs/PALETTE-GUI.md` | CURRENT | **Read before touching the palette strip, a tile's verb, or how an input reaches one.** One tile one verb, the shapes, the legend, the delay mark, the six rulings |
| `docs/INSTRUMENT-GUI.md` | CURRENT | **Read before any change to the rig view** — chrome, tool rail, footer, cabinet, engine sheet, palette. The element kit: the button's two sizes, the five faces, the four boolean shapes, the radius scale. Companion to `docs/SETTINGS-GUI.md` |
| `docs/INTERACTION-MODEL.md` | DESIGN INTENT | Trace / scan / commit — the reasoning behind the model (largely shipped) |
| `docs/ROUTING-DESIGN.md` | DESIGN INTENT (partial) | Routing architecture — **custom-routing destinations are no-op scaffolding**, verify against `sensor-registry.js` |
| `docs/EXP-NOTES.md` | MIXED | Gesture, snapshot and staging were sunset 2026-08-29 (git history); the rest is unbuilt idea-space. **Staging is DEAD (2026-08-30)** — no module, no markup, no way in; this file called it shipped for months |
| `docs/BROWSER-AUDIT-2026-07.md` | CURRENT | The browser (non-Electron) build and deploying to mubone.org/sim; the service-worker caching contract. Verification #153 unrun |
| `docs/OSC-AUDIT-2026-08.md` | CURRENT | The OSC dispatch audit — the release-edge guard, station addressing, what `js/osc.js` does and does not handle. Read before touching the dispatch `switch` |
| `docs/EXPORT-IMPORT-AUDIT-2026-08.md` | CURRENT (setup half) | **Read before touching the SETUP file.** Its session half records a format nothing reads — the music is a document (`js/piece.js`) |
| `docs/EXPERIMENTAL-BRUSHES.md` | CURRENT | The #218 inventory: four experimental brushes beside `spray`; echo, chop and pour deleted and why; staff's unit bug as a worked example. Read before touching `js/paint-ticker.js` or adding a brush |
| `docs/VOCABULARY.md` | MIXED | The naming half of the redesign: why `trace` is the outlier, the glossary, what each rename breaks. **New surfaces speak it; the old panels, actions and OSC namespace do not** |
| `docs/archive/` | ARCHIVED | Completed plans and audits, and `TODO-DONE-<month>.md` — record only, may use superseded terminology. Don't learn current behaviour from these |
| `CHANGELOG.md` | HISTORICAL RECORD | Version history. **Only edit during an explicit release.** Entries describe the code at that version, not now |

## Design principles

1. **Live acoustic input first.** The performer is an instrumentalist. Modules should process live mic signal or recorded granular buffers, not generate sound from oscillators.
2. **Gesture quality over axis mapping.** Sensor mapping should translate movement qualities (smoothness, effort, periodicity) into sonic qualities, not axis values into knob values.
3. **The system has memory.** Gestures deposit energy that decays over time. The system has inertia like a physical instrument.
4. **Main branch stays playable.** Don't break `main` — Ek uses it in jam sessions and live shows. Anything untested should be reachable only via the DevTools console (e.g. a standalone module that's not auto-imported from `main.js`), not wired into automatic startup.

## Debugging approach

**The app is drivable from here.** `npm run electron:dev` arms the dev bridge (`scripts/dev-bridge.js`): write JS to `.dev-bridge/in/<id>.js` and the renderer evaluates it, `in/<id>.shot` returns a PNG of the window, and every renderer console line, load failure and crash lands in `.dev-bridge/console.log`. `scripts/lib/rig.js` is the node-side client — `launch()` starts a private instance (own profile, own OSC port, muted), `attach()` talks to the open one, `evaluate(fn)` mirrors playwright's `page.evaluate`. Plain `npm run electron` loads none of it. `location.href = location.pathname + '?debug'` turns on verbose logging without a restart. A live app is a **concurrent writer** — `js/grain.js` drives the trigger gates from the 10 ms scheduler — so anything driving the engine with synthetic timestamps calls `rig.quiesce()` first.

**Audits are two-tier. Read `docs/AUDITS.md` § 1–2 before running one.** Per change: the ONE suite that covers the files touched — `node scripts/audit-for.js` names it from the diff, `--run` runs it, and a doc-only change runs nothing but `docs-audit`. Per release (Ek says "release" / "ship" / "bump"): everything. `osc-audit.js` (minutes of reloads, for a path Ek does not use) and `browser-audit.js` (playwright) are **release-only**; for an `osc.js` edit run `AUDIT_ONLY=wiring node scripts/osc-audit.js`, which is static and instant. Say what ran and what did not. Every launch is a fresh profile, deleted on close; a second concurrent session sets `MUBONE_RIG_PORT` so the two do not share port 7599.

**Before any before/after claim about the screen** `node scripts/probe-selftest.mjs` must be green (`docs/AUDITS.md` says why); CSS work runs `npm run audit:align` and `node scripts/ui-shots.js`.

**Worklet problems that code reading cannot settle:** add the value to the worklet's `_diag` feedback (`grain-engine.worklet.js` → the handler in `grain-worklet-bridge.js`) and log it at ~1 Hz. The audio thread has no console; one such line (`activeCount` = 2, ~10 expected) found a duration clamp reading never would have.

## Code style

- Match existing patterns — read neighbouring code first
- Comments explain *why*
- Constants at top of `state.js`, not scattered across modules
- UI wiring goes through `S` callbacks to avoid circular imports
- Hot paths (grain scheduling, render loop) stay lean
