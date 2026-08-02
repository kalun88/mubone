# mubone — Keyboard Shortcuts

> **Status: CURRENT** · reference · verified 2026-07-28. If a binding here disagrees with `ACTIONS` in `js/midi.js`, the code is authoritative — the in-app keys/midi/osc modal renders from it.

## Cursor & Camera Modes

In **pull mode** (default), your mouse controls the camera — drag to rotate the sphere.

In **surface mode**, your trackpad/mouse position maps directly onto the sphere surface — move your finger and the cursor follows.

Both modes use pointer lock. To access the UI or interact with panels, **press ⌥ Option** to temporarily freeze the sphere and release your pointer. Press ⌥ Option again to re-enter.

**⌥ Option is the most important key to learn first** — it's how you get in and out of cursor control.

You can switch between pull, surface, and sensor modes from the camera mode button in the top bar.

## Recording & Painting

| Key | Action |
|-----|--------|
| **Space** (tap) / **Left Click** (tap) | Toggle trace on/off |
| **Space** (hold) / **Left Click** (hold) | Momentary trace (paint while held) |
| **A** | Cycle trace mode: trace → trace+loop → trace+cloud |
| **Q W E R T Y U I O P** | Momentary sample paint (slots 1–10) |

## Commits (Clouds & Loops)

| Key | Action |
|-----|--------|
| **D** (tap) | Drop commit (cloud: plant at cursor / loop: drop from cursor) |
| **D** (hold) | Draw commit (cloud: moving path / loop: record) |
| **Shift+D** | Cycle commit mode (cloud ↔ loop) |
| **⌘D / Ctrl+D** | Release nearest commit |

## Playback & Navigation

| Key | Action |
|-----|--------|
| **S** | Toggle scan (cursor → house bus) |
| **M** | System mute (latching) |
| **N** | Toggle nearest/snap mode |
| **X** | Toggle radial morph (experimental, currently not functioning) |
| **H** | Toggle handsfree recording |
| **[ / ]** | Decrease / increase search radius |
| **⌥ Option** | Lock sphere position (freeze camera, release pointer) |

## Patches

20 slots: 10 factory then 10 user. Factory is first, so the unshifted digits
reach the built-in patches and shift reaches your own.

| Key | Action |
|-----|--------|
| **1–9, 0** | Select factory patches 1–10 — wash, vinyl, cloud, pulse, shimmer, glitch, chop, ocean, stutter, wobble |
| **Shift + 1–9, 0** | Select user patches 11–20 |

Each patch is also its own bindable action (`preset_1` … `preset_20`, OSC
`/preset/1` … `/preset/20`), so any of them can be put on a MIDI note, an
accessory button or a foot pedal from the keys / midi / osc modal.

## Editing

| Key | Action |
|-----|--------|
| **⌘Z / Ctrl+Z** | Undo last stroke |
| **F** (hold) | Erase brush — erase particles under the cursor (radius + recency) |
| **Delete / Backspace** ×3 | Erase all (triple-press within 800ms) |
| **−** (minus) | Session sweep |
| **`** (backtick) | Tare cursor sensor |

## Display

| Key | Action |
|-----|--------|
| **P** | Toggle performance monitor |
| **Shift+P** | Toggle high-performance render mode |
| **Shift+F** | Toggle projector mode |
| **Esc** | Close topmost modal / blur focused field |

## Inside the keys / midi / osc modal

The filter box above the table is focused when the modal opens; typing hides
every row that doesn't match. Terms are ANDed and match the whole row — action
name, group heading, default key, key override, MIDI binding and OSC path.

| Key | Action |
|-----|--------|
| **⌘F / Ctrl+F** | Focus + select the filter box (modal only — no effect elsewhere) |
| **Esc** | Clear the filter if non-empty, else blur; a second Esc closes the modal |

## Custom Bindings & Remote Control

These are the default keyboard shortcuts. All bindings can be remapped via the learn mode in the **keys / midi / osc** module (top bar), which also shows the full list of available MIDI CCs and OSC addresses.

Several actions ship with **no** default key and exist only to be bound — they show `—` in the key column of that module, and appear in the accessory modal's destination dropdown for any pad set to `button`:

| Action | Notes |
|--------|-------|
| `mute_hold` — system mute (hold) | Momentary / cough-button mute. Silent while held; on release it restores the state at press time, so tapping it while already muted by **M** leaves the system muted. |
| `pitch_oct_down` / `pitch_oct_up` | Step the base pitch shift by ∓1200¢, clamped at ±2400¢ — the `−oct` / `+oct` buttons in the grain panel. |
| `pitch_oct_reset` | Return the base pitch shift to 0¢ — the `0` button in the grain panel. |
| `erase_toggle` — erase brush (toggle) | Latching erase, for controllers that only send a press edge. |
 Modifier combos (Shift, Ctrl, ⌘) and scroll wheel are also mappable. Blocked keys that can't be rebound: Escape, Tab, F5, F11, F12.

The in-app module is always the source of truth for the current state of all bindings.

---

*mubone v1.10 alpha*
