# Main Page Redesign — Design Brief

> ⚠️ **Status: PROPOSAL — NOT IMPLEMENTED.** Drafted April 2026 and never built. **Nothing in this document describes shipped behaviour** — the periscope/overview split, the compass rose, and the card treatments do not exist in the app. The main page today is the projector-partition column layout (see `css/style.css` and `js/panel-drag.js`). Read only as a design direction under consideration.

Status: **draft** — April 2026. Proposed direction, not yet implemented.
Inspiration: "Route Covered" topographic map card + SolarEdge dashboard hero.

---

## Vision

The hero *is* the sphere. Today the canvas is "a canvas" — it shows particles and grains but doesn't communicate the instrument's spatial logic at a glance. The redesign makes the sphere the focal point and gives the performer two complementary ways to read it:

- **Periscope** — first-person view along the sensor's forward vector. This is the *playing* view. Shows what radius, what scan arc, what's about to trigger.
- **Overview** — third-person view of the whole sphere from outside, with a compass rose and a direction line. This is the *exploring* view. Shows everything you've deposited and where the sensor is currently pointing.

Same 3D scene, same particle cloud, different camera. User toggles between them.

Aesthetic target: pure-black canvas, heavy rounded corners, minimal chrome, one visual dominant, floating info cards that overlay without stealing focus.

---

## The two views

### Periscope (default)

- Camera at sphere center, looking along the sensor forward vector.
- Current **radius** draws a visible ring-of-engagement around the cursor.
- Particles *inside* the current scan arc: full opacity.
- Particles *outside*: dimmed to 30–40% so the arc reads as a flashlight beam.
- Grain spawn points flash briefly as small dots as they fire.
- No compass — cardinal directions don't apply in first-person.
- This is where you perform.

### Overview

- Orbit camera outside the sphere. Drag-to-orbit only — no auto-rotate. Start angle: slight tilt down-and-forward, roughly 15° elevation.
- Full sphere visible with every particle deposited this session.
- **Compass rose at the base** (the "Route Covered" trick):
  - 36 ticks around the base (every 10° of azimuth).
  - **Each tick only renders if at least one particle exists in its wedge.**
  - The rose becomes a density map: where you've sung, the rose has ticks; where you haven't, it's bare.
  - Cardinal labels (N/E/S/W) fade in at each quadrant once any particle lands there.
- **Direction line**: thin dashed line from sphere center outward along the sensor forward vector. This is your periscope cursor, viewed from outside.
- Optional: subtle contour lines on the sphere surface (if cheap). Mimics the topographic feel of Route Covered.
- This is where you inspect and recall.

---

## Visual language

Pulled directly from the references:

| Element | Spec |
|---|---|
| Outer container | Rounded card, ~20px radius, sits inside the app chrome |
| Hero surface | Pure black (`--bg-canvas`) — already matches |
| Top strip | Logo • session name • view toggle • icon buttons. All small, all dim until hover. |
| Typography | See **Type** below — Urbanist is the inspiration; Inter is what we ship today. |
| Accent pins | Reuse the existing semantic palette — teal lock, amber action, violet sensor. Already tokenized. |
| Floating readout cards | Translucent dark panel, rounded, 1–2 lines of data, subtle sparkline where relevant (Solar "Battery level, %" pattern). |
| Chrome density | Low. Most controls hide until hover or mode-change. Reference-1 has exactly 6 visible UI chrome elements on a busy scene. |

### Palette (reference → mubone)

The SolarEdge reference palette is only five values. Each one maps cleanly (or doesn't) to what we already have:

| Reference | Hex | Role | Mubone mapping |
|---|---|---|---|
| Black | `#000000` | Hero canvas | ✓ `--bg-canvas` already matches |
| White | `#FFFFFF` | Display type, highlights | ✓ `--text-highlight` already matches |
| Orange | `#F26415` | Primary accent (active state, highlighted data) | ⚠ Close to but brighter than `--accent-action: #e8a030`. See decision below. |
| Dark grey | `#3E3E3E` | Card borders, secondary type | ≈ `--chrome-border-dim: #333333` and `--text-faint: #3a3a3a` |
| Light grey | `#D2D2D2` | Light-mode card backgrounds, dividers | Doesn't map — we're dark-mode throughout. Skip. |

The **orange question** is real. `#F26415` is saturated and warm (red-leaning); `#e8a030` is muted and amber (yellow-leaning). Swapping `--accent-action` to the reference orange would:

- Make the "action" state visually punchier — good for visibility on the dark canvas.
- Shift the mood from "sonic instrument / tape machine" to "bright dashboard / alert".
- Break the current visual coherence with `--accent-warn: #c86020` (which sits between them).

Recommendation: **try `#F26415` in a branch on a few surfaces and compare side-by-side before committing.** If we adopt it, also pull `--accent-warn` warmer to match. Neither accent has to change — this is a taste decision.

### Type

Reference: **Urbanist** — geometric sans-serif, softer than Inter, slightly more open apertures, single-story 'a'. Has a subtle "tech / product" feel vs. Inter's more functional "system UI" feel.

Current shipping: **Inter** (self-hosted variable font, weights 300–600).

Options:

1. **Keep Inter.** Zero cost. Already tokenized via `--font-sans`. Inter does the job well and the mono readouts wouldn't pair with Urbanist as cleanly (Urbanist doesn't have a natural monospace sibling).
2. **Add Urbanist for display only.** New token `--font-display: 'Urbanist'`, used exclusively for the large session-name / mode labels. Inter stays as body; Roboto Mono stays for readouts. Gives us the reference's "feel" where it matters (hero + section titles) without the risk of a full type swap.
3. **Swap fully.** Replace Inter with Urbanist. Lowest-risk UI-wise because we've already tokenized the font stack, but every screen gets the Urbanist treatment — bigger visual shift.

Recommendation: **option 2** — Urbanist for display, Inter elsewhere. We get the reference's hero feel with no risk to the dense control surfaces.

Proposed token addition:

```css
--font-display: 'Urbanist', 'Inter', 'Helvetica Neue', sans-serif;
```

Self-host Urbanist the same way Inter is hosted — Google Fonts v20 latin subset, variable axis — and add a `@font-face` block alongside the existing one. About +30 KB on first load.

---

## Proposed layout

```
┌───────────────────────────────────────────────────────────┐
│  [○]  Session: untitled ⌄       [Periscope │ Overview]  [⚙] │   ← top strip (compact)
├───────────────────────────────────────────────────────────┤
│                                                           │
│                                                           │
│                                                           │
│                ╔═══════════════════════╗                  │
│                ║                       ║                  │
│                ║    3D HERO CANVAS     ║                  │
│                ║   (periscope or       ║                  │
│                ║    overview)          ║                  │
│                ║                       ║                  │
│                ╚═══════════════════════╝                  │
│                                                           │
│                ┌──────────────────┐                       │
│                │  Radius   0.47   │  ← floating overlay   │
│                │  Grains   12/16  │   card, bottom-left   │
│                └──────────────────┘                       │
│                                                           │
├───────────────────────────────────────────────────────────┤
│  [ record ]  [ session ]  [ grain ]  [ morph ]  [ out ]    │  ← control strip
└───────────────────────────────────────────────────────────┘
```

- Hero takes ~60–65% of the viewport height.
- Floating readout card(s) overlay the hero bottom-left. Think "Battery level, %" from SolarEdge.
- Control strip below is a horizontal lane of card-grouped controls — echoing the SolarEdge lower grid but dark-mode. Existing device-strip would migrate into this shape.

---

## Interaction

- **View toggle**: segmented control in the top strip — `[ Periscope │ Overview ]`. Active state is the amber-tinted pill (current `--accent-action` already does this).
- **Transition**: when toggling, the camera dollies from inside to outside (or vice versa) over ~400ms. Gives the user a mental anchor — they see the continuity between views.
- **Overview peek while playing**: long-press (or hold `\`) to swap to Overview for the duration of the press, then snap back. Lets performers glance at the whole sphere without losing their playing frame.
- **PiP**: always-on ~120–140px thumbnail of the other view, docked bottom-right, translucent. Shows Overview while playing Periscope, and Periscope while inspecting in Overview. Decided — see Decisions section.
- **Default**: Periscope on first load, Overview after session load (so the performer sees what they loaded).

---

## What maps to existing code

| New thing | Existing thing |
|---|---|
| Periscope view | Head-locked spatial mode already exists — camera state is there |
| Overview view | World-locked spatial mode — same state flag probably drives this |
| Direction line | `sensor-mapping.js` / `sensor-registry.js` already computes the forward vector; extend it visually |
| Rounded hero container | New wrapper around `#canvas-wrapper`, CSS-only |
| Floating readout card | New DOM overlay; reuse existing data from `S` |
| Compass rose | New render pass — likely an SVG or second canvas layer at the base of the hero region. Queries particle positions for tick gating. |
| Control strip below | Existing `.device-strip` restyled to a horizontal row of cards |
| View toggle | New segmented control in top bar — parallel to existing session/preset toggles |

No new audio work. Everything here is presentational.

---

## Decisions (resolved 2026-04-22)

1. **Default view on first load** — **Periscope.** The app opens into the playing view.
2. **Simultaneous views** — **PiP thumbnail always visible.** A small Overview thumbnail docks in a corner while Periscope is active (and vice versa during Overview). Adds permanent chrome but keeps the performer always oriented. Target size ~120–140px, translucent, bottom-right.
3. **Compass rose granularity** — **36 ticks, every 10°.** Each tick represents a meaningful 10° wedge. Empty regions stay clearly empty; dense regions read as dense.
4. **Control strip shape** — **Horizontal card lane.** Reflow record / session / grain / morph / output into side-by-side cards along a single horizontal row under the hero. Existing device-strip CSS gets restructured.
5. **Overview camera** — **Drag-to-orbit only.** No auto-rotate. User chooses when to move the camera. Deliberate, no visual distraction. Start angle: slight tilt down-and-forward (~15° elevation).
6. **Accent orange** — **Swap `--accent-action` to `#F26415`.** Warmer and punchier than current `#e8a030`. One-line token change. After the swap, audit `--accent-warn` and `--tint-action-*` to see if they need to shift warmer too.
7. **Type direction** — **Urbanist for display only.** Add `--font-display: 'Urbanist', 'Inter', 'Helvetica Neue', sans-serif;`. Apply to hero session name and section headers. Inter stays for body UI; Roboto Mono stays for numeric readouts. Self-host Urbanist via Google Fonts v20 latin subset, variable axis.

---

## Not in scope for v1

- Real-time contour lines on the sphere surface (nice-to-have, render cost unclear)
- Custom compass rose fonts or artwork (use the existing Inter at small sizes)
- 3D gesture trails in Overview (could come in v2 once the layout is right)
- Mobile-specific layout (the current mobile meta CSS stays; this brief is desktop-first)
