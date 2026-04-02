# mubone — Keyboard Shortcuts

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
| **M** | System mute |
| **N** | Toggle nearest/snap mode |
| **X** | Toggle radial morph (experimental, currently not functioning) |
| **H** | Toggle handsfree recording |
| **[ / ]** | Decrease / increase search radius |
| **⌥ Option** | Lock sphere position (freeze camera, release pointer) |

## Presets

| Key | Action |
|-----|--------|
| **1–9, 0** | Select user presets 1–10 |
| **Shift + 1–9, 0** | Select user presets 11–20 |

## Editing

| Key | Action |
|-----|--------|
| **⌘Z / Ctrl+Z** | Undo last stroke |
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

## Custom Bindings & Remote Control

These are the default keyboard shortcuts. All bindings can be remapped via the learn mode in the **keys / midi / osc** module (top bar), which also shows the full list of available MIDI CCs and OSC addresses. Modifier combos (Shift, Ctrl, ⌘) and scroll wheel are also mappable. Blocked keys that can't be rebound: Escape, Tab, F5, F11, F12.

The in-app module is always the source of truth for the current state of all bindings.

---

*mubone v0.15 alpha*
