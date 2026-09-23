# mubone — Quick Start Guide

> **Status: CURRENT** · user-facing guide · verified 2026-07-28 against 1.11 alpha.

## What is mubone?

mubone is a browser-based spatial granular synthesizer. You play into a mic, your audio gets painted as particles on a 3D sphere, and grains are continuously synthesized from particles near your cursor. In a multi-speaker setup, grains are spatialized across the array via VBAP panning.

## Getting Started

**Open the app** at `mubone.org/sim` (or locally via `python3 serve.py` → `https://localhost:4443`).

**Enable your mic** — click the mic button in the top-left. The browser will ask for microphone permission. Once granted, audio begins recording into the internal buffer.

**Set the latency once** — Settings → Audio → Latency shows what the app knows about the time in and out through your interface; press **Measure** with the output reaching the mic (speakers, or a cable) and the tape engine steers by the real figure from then on, per device pair.

**Paint particles** — click a tool in the left rail to take it **in hand** (the first tile of the palette, with the spacebar under it, shows it), then press **Space** or click the sphere to play it. Your live audio is captured and painted as colored dots onto the sphere at the cursor position. Press again to stop (the hand is a toggle by default; right-click that tile to make it momentary: paint only while held). The other palette tiles are quick access — each has its own key, shown under it.

**On a phone** — open `mubone.org/sim` in the phone's browser and tap the ring. The phone's gyro turns the sphere, a touch on the sphere plays the tool in hand (the phone's spacebar), and the ⚙ button is the whole settings page: live sensor readout, axis and sign, mic and output. There is no rail or bar on the phone, and the palette is the hand tile alone — touch it or the sphere to play. iPhone asks for motion access at the tap; refuse it and the sphere stays still.

**Move the cursor** — by default the camera is in **steer mode**: drag your mouse to rotate the sphere. The cursor stays at center and the sphere rotates around it. You can switch to **surface mode** (finger/trackpad position maps directly to sphere coordinates) or **sensor mode** (x-imu3) from the top bar.

**See the whole sphere** — the viz panel's **camera pull-back** slider moves the camera out from the sphere's centre (0 = inside, the original view; 1 = on the surface; above that you are outside and the sphere has a silhouette). This is a dolly, not a zoom — the FOV slider above it is the zoom, and no FOV value can get you outside. Pulling back changes only what you see: what the cursor reaches, and what you hear, are unaffected.

**Listen** — as the cursor passes over painted particles, grains are synthesized from the audio stored at those positions. Adjust the **search radius** with `[` and `]` to widen or narrow the area of particles the cursor picks up.

## Core Concepts

**Particles** are points on the sphere, each holding a snippet of recorded audio. Their color indicates recency — newest are bright, oldest fade out.

**Grains** are short audio fragments continuously triggered from nearby particles. The grain engine runs on a 20ms scheduler. You shape the sound with controls for duration, period, pitch, filter, pan spread, and more — all in the right-side panel.

**Seeds (commits)** are persistent playback points you plant on the sphere. They keep generating grains independently of your cursor. This is how you build up layers. See the Commits section below.

**Monitor vs House bus** — the cursor feeds the monitor bus (your mix), seeds feed the house bus (audience mix). The **Scan** button (`S`) controls whether the cursor is also sent to the house.

## Pins

Pinning is how you build layers: a pin keeps playing on its own while you paint the next thing.

**↓ pins and ↑ unpins** — the last two tiles on the palette, and the two keys next to them.
What a pin IS follows the cursor, not a mode: painting a tape stroke grows the loop until you
let go, a stroke already in reach becomes a loop, and nothing in reach pins a cloud where the
cursor is. Unpin takes whichever pin the **Settings → Pins** rule names — nearest by default.

The pinned rail on the right (**⇧Tab**) is a mixer: one track per pin, the bar its fader (drag
it), what you drew laid flat inside it, M and S at the right, and its own in / out under its
number. The mode bar above holds follow, sort and curve; sort is the selected pin, so the
top track is what unpin takes. Settings → Pins keeps what happens when the slots are full and what
a new pin is born with.

*(The `D` keys — tap to drop, hold to draw, ⇧D for the kind, ⌘D to release — went in September
2026: what a pin is now follows the cursor, so there is nothing for a mode key to cycle.)*

## What a stroke becomes

Every grain brush's sheet has an **on end** row — what the stroke turns into when you let go:

**scratch** — it stays on the sphere for the cursor to read. The default.

**cloud** — it is pinned at once as a moving cloud that loops the path you drew. The **wash**
brush ships this way, with a reverb-like block: paint a phrase and it stays in the room.

The tile remembers the choice. There is no key that cycles it.

## Presets

mubone has 20 patch slots: **10 factory presets** (1–10) followed by **10 user slots** (11–20).

The factory patches are wash, vinyl, cloud, pulse, shimmer, glitch, chop, ocean, stutter and wobble. They're read-only — saving always goes to a user slot.

**Select** a patch with the number keys: `1`–`9` and `0` select the factory patches 1–10. `Shift+1`–`0` select your own slots 11–20. You can also use the dropdown in the right panel.

**Save** your current grain settings to a slot by clicking the save icon next to the preset selector. You'll be prompted to name it.

**What's stored**: all grain parameters (duration, period, pitch, filter, volume, pan, search radius, etc.) — everything in the grain/search/commit panels. Locked parameters (if you've set any via the lock feature) are excluded from recall, so they stay at their current value when switching presets.

**Persistence**: every tile and setting lives in your browser's localStorage and survives reloads. Settings → Session has **Reset all** (two clicks, everything back to factory) and **Reset selected** (switch on the categories to clear). **On mubone.org the demo starts from factory on every new build** — it is a prototype, and nothing is kept across builds; Electron and a local server keep their settings.

## URL Parameters

Append these to the URL as query params:

| Param | Effect |
|-------|--------|
| `?debug` | Enables verbose console logging |

Checked once at startup. Example: `mubone.org/sim?debug`. The legacy `?exp` flag was removed — what it gated either always loads now or is reachable from the DevTools console via `await import('./js/<module>.js')`. The gesture, snapshot and staging modules it also gated were sunset in August 2026 and are git history.

## Sensor Mapping Module

The mapping module lets you wire IMU orientation axes directly to grain parameters for real-time gestural control.

**Open it** via the **⇆ mapping** button in the top bar. A modal shows all active mappings as rows.

**Each mapping row** contains: an enable/disable toggle, an axis selector (Roll / Elevation / Azimuth), input range in degrees, a live raw readout, a target parameter selector, output range, curve type (linear / log / exp), curve exponent, a mini curve preview, and a live output readout.

**Mappable parameters**: filter cutoff, resonance (one filter per grain since 2026-09-23), filter jitter, volume, duration, duration jitter, period, pitch shift, pitch jitter, pan spread, and fade ratio.

**Input axes**: Roll (±90°), Elevation (±90°), Azimuth (±180°) — read from the IMU with the "cursor" role.

**Adding a mapping**: click "+ add mapping" at the bottom. The module auto-picks the next unmapped parameter. Set your input range (the active window of sensor motion), output range (the parameter value extremes), and curve shape. The live readouts update at ~30fps so you can tune while moving.

**One mapping per parameter** — only one axis can drive a given parameter at a time.

**Curves**: linear is 1:1, log rises fast then flattens, exp starts slow then rises fast. The exponent numbox fine-tunes the shape (0.1–10).

**Persistence**: mappings save to localStorage globally (not per-preset). They survive reloads.

**Remote toggle**: none — the `mapping_toggle_1`–`4` actions and `/mapping/toggle/N` addresses were deleted 2026-09-05, never having been bound; a mapping is switched on its row.

## Keyboard Shortcut Cheatsheet

### Recording & Painting

| Key | Action |
|-----|--------|
| **Space** / left-click on the sphere | Play the tool in hand — toggle by default, momentary after a right-click on the hand tile |
| **1 … 9, ↑, ↓** | Fire a palette tile in its own verb (each tile wears its key) |
| **Tab** | Show or hide the tool rail (the ⋯ on a row opens a tool's drawer) |

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
| **N** | The installed lens's mode: nearest / area (the third, `stroke`, is set on the lens sheet) |
| **H** | Toggle handsfree recording |
| **[ / ]** | Decrease / increase search radius |
| **Alt** | Lock sphere position (freeze camera, release pointer) |

### The palette

| Key | Action |
|-----|--------|
| **Space** | Play the tool **in hand** — the first tile, with the spacebar under it. A left-click on the sphere is the same press |
| **1 … 9** | Fire that palette position, in that tile's verb. The key belongs to the TILE: move the tile and its key goes with it |
| **↓ / ↑** | Pin / unpin |
| **Tab** | Show or hide the tool rail (**~** does the same) |
| **⇧Tab** | Show or hide the pinned rail |

*(1–9 selected patch-bank presets until September 2026. The bank is gone — a tile is the preset now.)*

### Editing

| Key | Action |
|-----|--------|
| **⌘Z / Ctrl+Z** | Undo the last thing you did — a stroke, a pin, an unpin, an erase; keep going to the top of the show |
| **Delete / Backspace** ×3 | Erase all (triple-press within 800ms) |
| **−** (minus) | Session sweep |
| **`** (backtick) | Tare cursor sensor |

### Display

| Key | Action |
|-----|--------|
| **Esc** | Close topmost modal / blur focused field |

The performance monitor, the high-performance render mode and the projector mirror lost their
keys in September 2026 — each is a setting on its own page now. The gesture panel was sunset.

### Custom Bindings

Any key can be remapped via the MIDI mapping modal (learn mode). Modifier combos (Shift, Ctrl, Cmd) and scroll wheel are supported. Blocked keys: Escape, Tab, F5, F11, F12.

---

*mubone v1.11 alpha*
