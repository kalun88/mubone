# CLAUDE.md — Project Context for Cowork / Claude Code

Read this file first on every new session. Then read relevant docs from `docs/` depending on the task.

---

## What is mubone?

A browser-based spatial granular synthesizer for live acoustic instrumentalists. The performer plays into a mic, audio is recorded into a particle cloud on a 3D sphere, and grains are spatialized via VBAP to multi-channel speakers. An IMU (BNO085) wand controller tracks orientation; a second optional IMU provides world-frame reference.

Deployed to **mubone.org/sim** via Cloudflare Workers (static). Source is private on GitHub.

## Tech stack

- Vanilla HTML/JS/CSS — ES6 modules, no build step, no framework
- Web Audio API for all synthesis and processing
- Optional Electron wrapper for multi-channel audio output
- Max/MSP bridge for OSC/sensor input (Electron only)
- Python HTTPS server for local dev (`python3 serve.py` → https://localhost:4443)

## Repo structure

```
index.html          — single-page app entry point
js/                 — all modules (state, audio, grain, renderer, UI, sensor, wand, etc.)
js/exp/             — experimental modules (loaded only with ?exp flag)
js/worklets/        — AudioWorklet processors
css/                — styles
max/                — Max/MSP patches and Node.js bridge
electron-main.js    — Electron main process
electron-preload.js — Electron preload bridge
docs/               — project reference documents (see below)
```

## Key architecture patterns

- **Shared state object `S`** (in `state.js`): all modules read/write to `S`. Callback hooks (`S._funcName = handler`) avoid circular imports.
- **Grain scheduler** runs on its own setInterval (20ms), independent of the render loop (30fps).
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

## Feature flag: experimental mode

`?exp` in the URL activates experimental modules from `js/exp/`. Default off — collaborators never see these. Controlled by `EXP` const in `state.js`, lazy-loaded via dynamic import in `main.js`. Runtime check: `S.exp === true`.

## Versioning

Current version: **0.14 alpha**. Two things must be updated on every release:

1. **`index.html`** line 17 — the `<span class="top-bar-version">` text shown in the UI
2. **`CHANGELOG.md`** — add a new section at the top with the version, date, and what changed (grouped into Fixed / Added / Changed / Removed)

Bump the minor number (0.2 → 0.3) for feature work or meaningful bug fixes. Bump the patch if we ever need one (0.2.1). Stay on "alpha" until public beta.

## Reference documents (read as needed)

| Doc | When to read |
|---|---|
| `CHANGELOG.md` | **Update on every release** — version history, what changed |
| `docs/TODO.md` | **Always check this** — current tasks, priorities, what's done |
| `docs/mubone-architecture-notes.md` | Working on audio routing, multi-channel, VBAP, Electron bridge |
| `docs/IMPROV-FEATURE-PLAN.md` | Working on improv mode, seeds, monitor/house bus, gesture morph |
| `docs/EULER-VS-QUAT.md` | Working on sensor input format, Euler vs quaternion tradeoffs, roll-mute pole fix, `/euler` OSC path |
| `docs/EXP-NOTES.md` | Working on experimental modules — gesture extraction, processing chain, new synthesis modes |
| `docs/DETETHER-PLAN.md` | Working on two-IMU detethered cursor, frame sensor, conjugation fix, projection calibration |

## Design principles

1. **Live acoustic input first.** The performer is an instrumentalist. Modules should process live mic signal or recorded granular buffers, not generate sound from oscillators.
2. **Gesture quality over axis mapping.** IMU mapping should translate movement qualities (smoothness, effort, periodicity) into sonic qualities, not axis values into knob values.
3. **The system has memory.** Gestures deposit energy that decays over time. The system has inertia like a physical instrument.
4. **Collaborator-safe.** Don't break `main`. Use the `?exp` flag for anything untested. Experimental code lives in `js/exp/`.

## Code style

- Match existing patterns — look at neighboring code before writing
- Comments explain *why*, not *what*
- Constants at top of `state.js`, not scattered across modules
- UI wiring goes through `S` callbacks to avoid circular imports
- Performance-sensitive paths (grain scheduling, render loop) must stay lean
