# The graveyard ledger — what left, when, and where to find it

> **Status: ARCHIVED (a ledger).** Every file deleted from the app after 2026-09-05 gets a line here: what it was, why it left, and the commit that removed it. `git log --diff-filter=D -- <path>` finds a deletion forever; this file is so nobody has to know the path first. Nothing listed here runs, ships or describes how mubone behaves. The old `sandbox/` folder's README follows below once the folder itself is deleted.

## 2026-09-05 — the dead-weight pass (Ek's rulings on `scripts/deadweight-audit.js`)

| Path | What it was | Why it left |
|---|---|---|
| `css/style.css.bak`, `css/style.css.bak2` | tracked copies of the stylesheet | git holds every version; the build excluded them |
| `shortcuts.html` | a standalone keyboard-shortcuts page for collaborators | the keys / MIDI / OSC modal renders the same from `ACTIONS`; no link in since the tile screen |
| `gesture-window.html` + `S.sensor3Cal` | a separate gesture-visualisation window from 1.11 with its own raw-gyro remap | nothing opened it; the calibration slot it read was assigned by nothing. `SPLIT_DROPPED` in ui-audio-settings.js still drops the field from old blobs |
| `js/debug-waveform.js` | console-only waveform overlay (`wg.waveform(i)`) showing a recorded buffer with particle markers | unused since April; the worklet `_diag` feedback is how the engine is inspected now |
| `js/ui-trace.js` | a superseded "trace" idea (`MAX_TRACES`, `TRACE_COLORS`) sharing only the word with `S.traceMode` | unimported since March; the one entry in docs-audit's `KNOWN_ORPHANS` |
| `mapping_toggle_1`–`4` (ACTIONS) + `/mapping/toggle/1`–`4` + `toggleMappingByIndex` | toggle a sensor-mapping row by index from a pad or OSC | no factory key, never bound; a mapping is switched on its own row |
| `mubone_perform_vis`, `mubone_osc_stream`, `mubone_gesture_panel`, `mubone-hud-scale` (storage keys) | keys of sunset panels | moved to `RETIRED_KEYS`, deleted on sight |
| 92 CSS classes in `css/style.css` (85 rules) and `css/settings-gui.css` (8 rules) | styles of sunset panels: `imu-setup-*`, `seq-*`, `sample-*`, `staging-*`, `acc-*`/`accessory-*`, `as-*` labels, `syg-*`, `mapping-*`, `set-badge--*`, `led-*`… | no markup, module or script carried them; before/after screen probe IDENTICAL, align-audit green |
| `PERFORMANCE-AUDIT-2026-07.md`, `EXPORT-IMPORT-AUDIT-2026-07.md`, `GROUP-SHOW-NOISE-GLITCH.md`, `viz-changes-for-cli.md` (docs/ → docs/archive/) | HISTORICAL records held in docs/ by unrun checklists | the checklists are TODO #129, #138, #127, #336; the archive rule applies |
| `sandbox/` (58 files, 1.3 MB: `max/`, `sunset-2026-08-28/`, `sunset-2026-08-29/`, `sunset-2026-09-03/`, the one-question pages) | the graveyard folder itself | git is the graveyard: `git log --diff-filter=D -- sandbox/<path>` finds any of it, `git show <commit>^:sandbox/<path>` reads it. Every `sandbox/…` path a doc still cites means this |

## The `sandbox/` README as it stood when the folder was deleted (2026-09-05)


Working space. **Nothing here runs in the app, ships in a build, or describes how mubone
behaves.** Files land here when they stop being live but are still worth keeping — a
finished experiment, a staging copy from another project, a page written to answer one
question in April.

The rule that matters, restated in `CLAUDE.md` so every session reads it: an agent should
not read anything in here unless asked for it by name, and must never cite it as evidence
for how the app works. That is the whole point of the folder. Recency and plausibility are
not enough to tell live code from dead code, and a `.maxpat` or a `.js` in a familiar shape
reads as authoritative when it isn't.

Excluded from the Electron build by `"!sandbox/**"` in `package.json`, so it cannot reach
the rig. Tracked in git — ignoring it would leave it on disk, unlabelled, which is the
situation this folder exists to end. Only `node_modules/` and `*.log` under here are
ignored.

Delete freely. Git keeps whatever was committed; `git log --diff-filter=D -- sandbox/`
finds it again.

## What's in here

| | |
|---|---|
| `max/` | The entire Max/MSP folder — patches, `bridge.js`, the per-patch Node scripts. Moved here Aug 2026 when Max stopped being part of the rig. `bridge.js` is still the relay browser mode looks for on `ws://localhost:8080`; run it by hand if a browser-mode OSC peer is wanted. `max/bno085/` inside it targets a pre-sygaldry BNO firmware and drives nothing |
| `ring-test/` | Apr 2026 — TikTok ring HID capture experiment. `ring-bridge.js`, `ring-seize-test.js`, a Hammerspoon media-key suppressor. The live ring path is `max/tiktokring.maxpat` |
| `relay-updated.js`, `relay-updates/` | Staging copies of files belonging to the **mubone-joycon-gui** project (its `relay.js`, `app.js`, `mapping.js`) — edited here, meant to be carried back there. Not this repo's code. `docs/OSC-AUDIT-2026-08.md` finding 3 cites `relay-updated.js` |
| `max.zip` | Apr 2026 snapshot of `max/` taken before a reorganisation |
| `timing-margin.html`, `timing-rates.html` | Standalone pages used while writing `docs/archive/TIMING-REFERENCE.md`. Nothing links to them |

## sunset-2026-08-28 (#269)

Unwired from the app on 2026-08-28, kept because the work is worth returning to. None of it
is imported, none of it ships, and `modals.html` holds the markup that was removed from
`index.html` alongside the modules that drove it.

| What | Why it went |
|---|---|
| `gesture.js`, `gesture-panel.js`, `gesture-viz.js` | Nothing in the app consumed the gesture features — the panel was their only reader. The extraction itself is the part worth reviving. |
| `snapshot-engine.js`, `osc-stream.js`, `ui-staging.js`, `ui-posture-map.js` | Staging. `osc-stream` is the seed of TODO #122 (OSC values out) and should come back as its own thing rather than as staging. |
| `interp-kernels.js`, `relational-features.js` | Orphaned when the two above left; they had no other reader. |
| `ui-accessory.js` | The A8 accessory TABLE. `js/accessory-registry.js` stays live — the setup file carries its config, so only the UI went. |
| `modals.html` | The sample-instrument, gesture, staging and accessory modal markup. The sampler is in the tool rail now; its library is the properties-rail sheet. |

A setup file that still carries a `staging` block round-trips untouched (`ui-export.js` reads
it into nothing and writes it back), so reviving staging does not need an old file rewritten.

## sunset-2026-09-03 (#325) — the patch bank, its table, param locks, cloud morph

A tile owns its whole block (TODO #324, the same day), so a flat bank of grain patches had
nothing to be a bank OF (`docs/archive/BRUSH-MODEL.md` § 1e). Everything that was built on a bank
INDEX went with it. Ek: *"sunset patch bank"*; cloud morph killed "for now — we'll build the new
tile end points feature later".

| What | Why it went |
|---|---|
| `presets-data.js` | The ten factory patches, the user-slot scaffolding, the bank loader/saver, the 40→20 index migration and the axis-source migration, lifted verbatim from `js/state.js`. Slot 0 (`wash`) lives on as `DEFAULT_GRAIN`. Not a module. |
| `ui-patch-table.js` | The Max-style table editor, whole. Its REGISTRY half — one entry per parameter with get/set against `S` — survives as `js/param-registry.js`, because a session import still applies a sparse parameter object. |
| `param-lock.js` | "Hold this value across patch recalls." Nothing to hold against. |
| `patch-bank.js` | The removed blocks of `js/ui-presets.js` in file order — the buttons, dropdown, save-to-slot, `selectPreset`, the envelope waveform and stats readouts, the whole cloud-morph slider (`initDesktopMorph`) — plus the `lerpPresets` family from `js/seed-morph.js`, whose only reader was that slider. Not a module. Reviving cloud morph as two TILES for endpoints is a new feature, not a paste-back. |

Also gone, without a file here: the `patches` storage category and its four keys, the locks /
radial-anchor / desktop-morph keys (deleted once at boot by `purgeRetiredKeys()`), the twenty
`preset_N` and three `morph_*` actions and `radial_morph`, `/preset`, `/preset/N` and `/morph/*`,
the `X` key, the cabinet's patch and envelope devices, the `#morphBtn`, the patch-table modal, and
forty `.param-lock-indicator` spans. Gesture morph (`js/seed-morph.js` `updateGestureMorph`) stays:
it drives a cloud's agitation from the gyro and never read the bank.

## sunset-2026-08-29 (#291) — the rig VIEW

The rig view stopped being a screen on 2026-08-29. What went is the PRESENTATION — the panel
columns, the mini canvas tile, and the dragging that rearranged them. What stayed, in
`index.html`, is `.top-bar` and `.right-panel`, permanently `display: none`: the **rig cabinet**,
which still holds the 44 elements the engine pages drive by id, every settings modal's opener,
and four nodes borrowed out and hosted elsewhere. Read the `THE RIG CABINET` comment at the top
of `index.html` before touching any of them.

| What | Why it went |
|---|---|
| `panel-drag.js` | Dragged `.device` tiles between column slots, and dragged/resized the canvas block. Nothing renders those columns any more. Was `js/panel-drag.js`, imported by `main.js`. |
| `projector-partition.js` | Lifted verbatim out of `setupEvents()` in `js/events.js`. It moved `#sphereCanvas` into a mini tile inside `.right-panel` and dealt the tiles into five positional columns, with a `mubone_projector_layout_v2` schema and a v1 migration behind it. **Not a module** — paste it back into `setupEvents()` to revive. |

The popup MIRROR (⇧F, `#projectorModeBtn`) is a different feature and is still live in
`js/events.js` — it only ever shared the word *projector*.

Also gone from the app, with no file to keep: the `rig` / `◈ tiles` pills and `setTileLayout()`
(there is one screen, so `body.tile-layout` is unconditional and the class was dropped from ~74
CSS rules), the `.device-label` collapse toggle, the saved panel order, and the `.proj-divider`.
Their localStorage keys (`mubone_panel_order`, `mubone_panel_*`, `mubone_projector_layout*`,
`mubone_tile_layout`) are cleared once at boot in `main.js` — a collapsed `.device` would have
made Settings → pins show up empty, since that page borrows the commits device whole.
