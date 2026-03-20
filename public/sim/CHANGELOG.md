# Changelog

All notable changes to mubone are documented here.
Format: newest version first. Entries written at the end of each working session.

---

## 0.4 alpha — 2026-03-21

### Fixed
- **Shift+D / Shift+S button flash** — pressing Shift+D (loop lock) or Shift+S (seed lock) no longer causes the underlying D (drop loop) and S (sow seed) buttons to visually flash. Added `_plainD` / `_plainS` flag pattern to distinguish bare keydown from modified keydown on keyup.

### Added
- **UI scale slider** — new "panel & text size" control in viz settings scales all UI elements (panels, top bar, HUD overlay, text) without affecting the 3D rendering. Range 0.70–1.60×, persisted to localStorage.
- **Recency exclusion note** — added code comments in seed capture and frame capture confirming `recencyN` is intentionally global, not stored per-seed.

### Changed
- **HUD quadrant redesign** — mode ring arcs repositioned: top = scan off (orange), left = seed lock (green `#6ec97a`), right = loop lock (pink `#ff6b9d`), bottom = patch number (centered below cursor). Removed old seed tether indicator from left arc.
- **Panel width fixed** — right panel no longer scales with viewport. Root font locked at 15px, panel width converted to rem (22.7rem) so it responds only to the UI scale slider.
- **Param panel cleanup** — removed all `grain-row--gap-top` utility classes that were standing in for removed subtitle headings. Merged search panel toggles and parameters into a single section (eliminates double padding between k-seq and radius).
- **Morph section independence** — morph collapsible moved from nested inside params to a sibling section in the seeder panel, so collapsing params no longer hides morph.
- **Panel heading flattening** — removed redundant section/sublabel headings (SLOT CONFIG, SEED PARAMS, BLEND, MOVEMENT, ENVELOPE, LOOP PARAMS, RADIUS FADE, AXIS LOCK) across seeder, looper, cursor, and search panels. Replaced with single collapsible "params" toggles per panel.
- **Divider lines removed** — stripped all faint horizontal dividers within panels (`border-top: none` on `.seq-section + .seq-section`, `.seq-section-sublabel`, `.seed-section--morph`).
- **Visual polish pass** — slider track 1px→2px, slider thumb 10→12px, seg button radius 1→2px, section label color `#444`→`#555`, grain row padding tightened, numbox color `#888`→`#808`, slots dropdown height matched to seg buttons.

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
