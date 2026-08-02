# mubone — Quick Start Guide

> **Status: CURRENT** · user-facing guide · verified 2026-07-28 against 1.11 alpha.

## What is mubone?

mubone is a browser-based spatial granular synthesizer. You play into a mic, your audio gets painted as particles on a 3D sphere, and grains are continuously synthesized from particles near your cursor. In a multi-speaker setup, grains are spatialized across the array via VBAP panning.

## Getting Started

**Open the app** at `mubone.org/sim` (or locally via `python3 serve.py` → `https://localhost:4443`).

**Enable your mic** — click the mic button in the top-left. The browser will ask for microphone permission. Once granted, audio begins recording into the internal buffer.

**Paint particles** — press and hold **Space** to trace. Your live audio is captured and painted as colored dots onto the sphere at the cursor position. Release to stop. A quick tap toggles trace on/off; a hold (≥200ms) is momentary (trace only while held).

**Move the cursor** — by default the camera is in **pull mode**: drag your mouse to rotate the sphere. The cursor stays at center and the sphere rotates around it. You can switch to **surface mode** (finger/trackpad position maps directly to sphere coordinates) or **sensor mode** (x-imu3) from the top bar.

**Listen** — as the cursor passes over painted particles, grains are synthesized from the audio stored at those positions. Adjust the **search radius** with `[` and `]` to widen or narrow the area of particles the cursor picks up.

## Core Concepts

**Particles** are points on the sphere, each holding a snippet of recorded audio. Their color indicates recency — newest are bright, oldest fade out.

**Grains** are short audio fragments continuously triggered from nearby particles. The grain engine runs on a 20ms scheduler. You shape the sound with controls for duration, period, pitch, filter, pan spread, and more — all in the right-side panel.

**Seeds (commits)** are persistent playback points you plant on the sphere. They keep generating grains independently of your cursor. This is how you build up layers. See the Commits section below.

**Monitor vs House bus** — the cursor feeds the monitor bus (your mix), seeds feed the house bus (audience mix). The **Scan** button (`S`) controls whether the cursor is also sent to the house.

## Commits (Seeds)

Seeds are the main performance tool for building layers.

**D key** is the universal commit key. Its behavior depends on commit mode:

In **cloud mode** (default): tap `D` to drop a stationary seed at the cursor; hold `D` to draw a moving seed that traces your cursor path. In **loop mode**: tap `D` to drop a loop from the cursor; hold `D` to record a new loop.

Press **Shift+D** to cycle between cloud and loop commit modes.

Press **⌘D / Ctrl+D** to release (remove) the nearest seed.

The right panel's **commits** section lets you set the slot count (up to 16), overflow behavior (what happens when slots are full), and playback direction for moving seeds.

## Trace Modes

Press **A** to cycle through three trace modes:

**trace** — plain recording mode. Space paints particles at the cursor. The left HUD dot is dim white.

**trace+loop** — while tracing, audio also records into a loop commit. The dot turns pink.

**trace+cloud** — while tracing, a cloud seed is automatically planted and follows your path. The dot turns blue.

## Presets

mubone has 20 patch slots: **10 factory presets** (1–10) followed by **10 user slots** (11–20).

The factory patches are wash, vinyl, cloud, pulse, shimmer, glitch, chop, ocean, stutter and wobble. They're read-only — saving always goes to a user slot.

**Select** a patch with the number keys: `1`–`9` and `0` select the factory patches 1–10. `Shift+1`–`0` select your own slots 11–20. You can also use the dropdown in the right panel.

**Save** your current grain settings to a slot by clicking the save icon next to the preset selector. You'll be prompted to name it.

**What's stored**: all grain parameters (duration, period, pitch, filter, volume, pan, search radius, etc.) — everything in the grain/search/commit panels. Locked parameters (if you've set any via the lock feature) are excluded from recall, so they stay at their current value when switching presets.

**Persistence**: presets save to your browser's localStorage under the key `mubone_user_presets`. They survive page reloads and persist across sessions. A factory reset (in the settings menu) can optionally preserve your patches if you check "keep my patches."

## URL Parameters

Append these to the URL as query params:

| Param | Effect |
|-------|--------|
| `?debug` | Enables verbose console logging |

Checked once at startup. Example: `mubone.org/sim?debug`. The legacy `?exp` flag was removed — experimental modules either always load now (gesture, snapshot/staging) or are reachable from the DevTools console via `await import('./js/<module>.js')`.

## Sensor Mapping Module

The mapping module lets you wire IMU orientation axes directly to grain parameters for real-time gestural control.

**Open it** via the **⇆ mapping** button in the top bar. A modal shows all active mappings as rows.

**Each mapping row** contains: an enable/disable toggle, an axis selector (Roll / Elevation / Azimuth), input range in degrees, a live raw readout, a target parameter selector, output range, curve type (linear / log / exp), curve exponent, a mini curve preview, and a live output readout.

**Mappable parameters**: HPF cutoff, LPF cutoff, filter Q, filter jitter, volume, duration, duration jitter, period, pitch shift, pitch jitter, pan spread, and fade ratio.

**Input axes**: Roll (±90°), Elevation (±90°), Azimuth (±180°) — read from the IMU with the "cursor" role.

**Adding a mapping**: click "+ add mapping" at the bottom. The module auto-picks the next unmapped parameter. Set your input range (the active window of sensor motion), output range (the parameter value extremes), and curve shape. The live readouts update at ~30fps so you can tune while moving.

**One mapping per parameter** — only one axis can drive a given parameter at a time.

**Curves**: linear is 1:1, log rises fast then flattens, exp starts slow then rises fast. The exponent numbox fine-tunes the shape (0.1–10).

**Persistence**: mappings save to localStorage globally (not per-preset). They survive reloads.

**Remote toggle**: the first 4 mappings can be toggled via MIDI (`mapping_toggle_1`–`4`) or OSC (`/mapping/toggle/1`–`4`).

## Keyboard Shortcut Cheatsheet

### Recording & Painting

| Key | Action |
|-----|--------|
| **Space** (tap) | Toggle trace on/off |
| **Space** (hold) | Momentary trace (paint while held) |
| **A** | Cycle trace mode: trace → trace+loop → trace+cloud |
| **Q W E R T Y U I O P** | Momentary sample paint (slots 1–10) |

### Commits (Seeds)

| Key | Action |
|-----|--------|
| **D** (tap) | Drop commit (cloud: plant seed / loop: drop from cursor) |
| **D** (hold) | Draw commit (cloud: moving path / loop: record) |
| **Shift+D** | Cycle commit mode (cloud ↔ loop) |
| **⌘D / Ctrl+D** | Release nearest commit |

### Playback & Navigation

| Key | Action |
|-----|--------|
| **S** | Toggle scan (cursor → house bus) |
| **M** | System mute |
| **N** | Toggle nearest/snap mode |
| **X** | Toggle radial morph |
| **H** | Toggle handsfree recording |
| **[ / ]** | Decrease / increase search radius |
| **Alt** | Lock sphere position (freeze camera, release pointer) |

### Presets

| Key | Action |
|-----|--------|
| **1–9, 0** | Select user presets 1–10 |
| **Shift + 1–9, 0** | Select user presets 11–20 |

### Editing

| Key | Action |
|-----|--------|
| **⌘Z / Ctrl+Z** | Undo last stroke |
| **Delete / Backspace** ×3 | Erase all (triple-press within 800ms) |
| **−** (minus) | Session sweep |
| **`** (backtick) | Tare cursor sensor |

### Display

| Key | Action |
|-----|--------|
| **P** | Toggle performance monitor |
| **Shift+P** | Toggle high-performance render mode |
| **Shift+G** | Toggle gesture panel |
| **Shift+F** | Toggle projector mode |
| **Esc** | Close topmost modal / blur focused field |

### Custom Bindings

Any key can be remapped via the MIDI mapping modal (learn mode). Modifier combos (Shift, Ctrl, Cmd) and scroll wheel are supported. Blocked keys: Escape, Tab, F5, F11, F12.

---

*mubone v1.11 alpha*
