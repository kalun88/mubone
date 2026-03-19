# Changelog

All notable changes to mubone are documented here.
Format: newest version first. Entries written at the end of each working session.

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
