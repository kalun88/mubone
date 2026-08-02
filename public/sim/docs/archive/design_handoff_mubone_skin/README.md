# Handoff: mubone GUI Skin

## Overview

A **visual re-skin** of the mubone.org/sim web app. The live app is a web-based audio spatial granulator; the goal of this handoff is to port its surface — chassis, panels, typography, controls, layout of player controls and parameter racks — to a tighter, studio-hardware aesthetic without touching the audio engine, OSC/MIDI plumbing, sphere renderer, keyboard shortcuts, or any other behavior.

The new look is a dark, low-chroma "outboard rack" treatment: Ableton-style rack rows with vertical label strips, compact knob rows, a consolidated two-row transport bar under the sphere, and a 2×20 patch grid with keycap labels. **No gradients.** Flat fills only.

## About the Design Files

The files under `design/` are **design references created in HTML**. They are prototypes showing intended look and behavior — **not** production code to copy directly.

The task is to **recreate this look inside the live `muboneapp/` codebase** (the one already on your disk: plain HTML + vanilla JS + a single `css/style.css`). Use the existing markup and IDs wherever possible; swap classes and add new CSS on top of the existing stylesheet. Do not migrate to a framework. Do not refactor JS files except where markup changes require re-selecting the same element by a new class.

**Do not break functionality.** Every `id="..."` in `muboneapp/index.html` is wired to listeners in `muboneapp/js/*.js`. Preserve all IDs and all event bindings. If you rename a class, update any CSS and JS that depended on that class, but never rename an ID.

## Fidelity

**High-fidelity.** Colors, typography, spacing, border radii, button sizes, and rack geometry in the design are final. Match them pixel-to-pixel where the live app's DOM allows; where a live-app control has no direct analog in the mock (rare), apply the nearest equivalent style from the tokens below.

## Target Codebase

- Repo: the `muboneapp/` folder already on your local disk.
- Entry: `muboneapp/index.html`, single page.
- Stylesheet: `muboneapp/css/style.css` (single file; extend it, don't replace it).
- JS: `muboneapp/js/*.js` (vanilla, module-per-concern: `main.js`, `sphere.js`, `ui-patch-table.js`, `ui-presets.js`, `ui-meters.js`, `ui-audio-settings.js`, `ui-improv.js`, `ui-viz.js`, `ui-sensor-mapping.js`, `ui-samples.js`, `ui-learn.js`, …).

Read `muboneapp/CLAUDE.md` and `muboneapp/docs/KEYBOARD-SHORTCUTS.md` before you start. They describe the app's architecture and the full keyboard surface the new transport must mirror.

## Scope (confirmed)

In scope:

1. **Visual skin only** — CSS/markup swap. Zero behavior changes.
2. **New transport bar under the sphere** — two keyboard-ordered rows of keycap buttons consolidating every player action (shortcuts on top row, commits + session on bottom row).
3. **Rack reorganization of the parameter panels** into four rows: `patches` / `grain` (env + params) / `cursor + search` / `commits`. Each rack has a vertical rotated label strip on its left, like Ableton device racks.
4. **Resizable sphere pane** — a drag-to-resize handle on the bottom edge of the sphere area; height persists in `localStorage`, clamped to ≥ ⅓ of viewport.
5. **2×20 patch grid with keycap numbers** — 40 slots in 2 rows of 20, each showing its hotkey as a keycap with the patch name below.

Out of scope:

- Audio engine, granulation, OSC, MIDI, IMU pipeline, sphere renderer, `state.js` — untouched.
- Mobile/touch layout — the new skin targets desktop only; leave existing mobile rules alone.
- Any change to keyboard shortcut bindings. If the mock shows a keycap, the letter on that keycap is the shortcut that is *already* wired in the live app. Pull the current binding from the JS; don't make up new ones.

## Design Tokens

Defined at the top of `design/styles.css` under `:root`. Port these **verbatim** into `muboneapp/css/style.css`, at or near the existing `:root`. If the live stylesheet already defines any of these names, prefer the new values.

### Colors

All in `oklch` so chroma stays perceptually uniform. Fall back to nothing — modern browsers only.

```css
/* Neutral chassis — warm cool-grey */
--ink-0:  oklch(0.09 0.004 240);  /* pure backdrop */
--ink-1:  oklch(0.14 0.004 240);  /* chassis */
--ink-2:  oklch(0.18 0.005 240);  /* module surface */
--ink-3:  oklch(0.22 0.005 240);  /* raised surface */
--ink-4:  oklch(0.28 0.006 240);  /* hairline / rules */
--ink-5:  oklch(0.36 0.008 240);  /* dim text */
--ink-6:  oklch(0.55 0.008 240);  /* secondary text */
--ink-7:  oklch(0.78 0.008 240);  /* primary text */
--ink-8:  oklch(0.96 0.004 240);  /* emphasized */

/* Accents */
--teal:    oklch(0.78 0.08 195);  /* active / engaged */
--teal-d:  oklch(0.58 0.08 195);
--teal-xd: oklch(0.32 0.04 195);
--amber:   oklch(0.78 0.12 75);   /* armed / record-ready */
--amber-d: oklch(0.55 0.10 75);
--red:     oklch(0.65 0.18 25);   /* live signal */
--red-d:   oklch(0.45 0.14 25);
--violet:  oklch(0.72 0.10 300);  /* morph / expressive */
```

### Radius

```css
--r-0: 0;
--r-1: 2px;
--r-2: 3px;
--r-3: 6px;
```

### Rules, elevation

```css
--rule:        1px solid color-mix(in oklab, var(--ink-8) 6%, transparent);
--rule-strong: 1px solid color-mix(in oklab, var(--ink-8) 12%, transparent);
--inner:       inset 0 1px 0 color-mix(in oklab, var(--ink-8) 4%, transparent),
               inset 0 -1px 0 color-mix(in oklab, #000 30%, transparent);
```

### Density (default "compact")

```css
--gap: 8px;
--pad-x: 10px;
--pad-y: 8px;
--row-h: 22px;
--module-gap: 6px;
--fs-xs: 9.5px;
--fs-sm: 10.5px;
--fs-md: 11.5px;
--fs-lg: 13px;
--fs-xl: 16px;
--fs-readout: 11px;
--tween: 120ms ease-out;
```

The mock also defines `[data-density="comfortable"]` and `[data-density="spacious"]` overrides. Port them, but keep the live app on `data-density="compact"` by default (set the attribute on `<body>`).

### Typography

Two families only. Google Fonts import:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
```

- **Inter** for UI text (`font-family: 'Inter', 'Helvetica Neue', sans-serif;`).
- **JetBrains Mono** for numeric readouts, keycaps, rack labels, patch slots.
- Body defaults: `font-size: var(--fs-md); font-feature-settings: 'ss01', 'cv11'; letter-spacing: 0.005em;`.

### No gradients

Anywhere you find `linear-gradient(...)` or `radial-gradient(...)` in the existing `muboneapp/css/style.css`, replace it with a single flat color (usually `var(--ink-2)` for surfaces, `#000` for the sphere background, or a `color-mix(...)` teal/amber tint for on-states). The reference CSS has already been flattened — use it as the template.

## Regions & Selectors

The live `muboneapp/index.html` already has most of the structure we want, just dressed differently. Map region-by-region. Each section below lists:

- **Live selector** — what exists today in `muboneapp/index.html` or gets created by `muboneapp/js/*.js`.
- **Target mock selector** — the corresponding class/id in `design/mubone-gui-redesign.html` and `design/styles-v3.css`. Port the CSS; apply the classes to the existing elements.

### 1. Top rail

- Live: `.top-bar`, `.top-bar-left`, `.top-bar-right`, `.top-bar-row`, buttons `#fullscreenBtn2`, `#projectorModeBtn`, `#micEnableBtn`, `#muteBtn`, `#cameraModeBtn`, `#audioSettingsBtn`, `#vizSettingsBtn`, `#helpBtn`.
- Target: `.rail` in the mock — `.brand` on the left (word-mark + version), a row of mode switch + status chips in the center (`.mode-switch`, `.status-chip.live`, `.status-chip.ok`), and settings/menu buttons on the right. Keep all existing IDs; just restyle. The live app has no "mode switch" (studio/performance) — **do not add one**. That is decorative in the mock and out of scope here.

### 2. Sphere stage

- Live: the sphere-hosting container in `muboneapp/index.html` (WebGL canvas rendered by `muboneapp/js/sphere.js` + `renderer.js`).
- Target: `.stage-view`, `.sphere-wrap`, `.sphere-canvas` from the mock. Background of `.sphere-canvas` is flat `#000`, radius `var(--r-3)`, overflow hidden. Do not change any canvas sizing code; only wrap/skin it.
- **Resizable**: add a drag handle on the bottom edge of `.sphere-wrap`. On `mousedown`, capture pointer, update the wrapper's `height` on `mousemove` (clamp to `≥ 33vh` and `≤ 80vh`), write the final value to `localStorage['mubone.skin.sphereH']`. Restore on load. Must not interfere with any canvas pointer handlers — attach only to the handle element.

### 3. Transport bar (under sphere)

The mock's `.transport` is the **single source of truth** for every player control. Two rows, each `.transport-row`, flex-wrapped, right-aligned:

- **Row 1 — shortcuts** (keycaps from the existing shortcut map). Order matches the order the shortcuts appear in `muboneapp/docs/KEYBOARD-SHORTCUTS.md`. Examples from the mock (adjust to whatever the live keymap actually contains): `space` play/pause, `R` record, `L` loop, `,` / `.` nudge, `M` mute, `S` solo, `T` tare, etc.
- **Row 2 — commits + session**: commit slot access, save/load patch, undo/redo, etc.

Each button uses the `.tbtn` primitive:

- Pill, `min-height: 26px`, `padding: 4px 8px 4px 4px`, `border-radius: var(--r-2)`.
- Flat background `var(--ink-2)`.
- Border `1px solid color-mix(in oklab, var(--ink-4) 80%, transparent)`.
- Text: Inter 11px / 500 / `--ink-7`, `letter-spacing: 0.02em`.
- Shadow: `inset 0 1px 0 color-mix(in oklab, white 6%, transparent), 0 1px 0 rgba(0,0,0,0.4)`.
- Keycap (`.tbtn .tk`): `min-width: 26px; height: 20px`, JetBrains Mono 10px uppercase, background `var(--ink-0)`, own border + shadow.
- `.tbtn:hover` → border `var(--teal)`, text `--ink-8`.
- `.tbtn.on` → flat teal tint background `color-mix(in oklab, var(--teal) 14%, var(--ink-2))`, teal border + text.
- `.tbtn.accent` → amber variant for armed/record states.
- `.tbtn.danger` → red on hover (destructive actions).
- `.t-sep` → 1px vertical rule between button groups.

Wire each button to the same handler the live app already uses for that shortcut. Don't invent new actions. If the mock shows a button that has no live equivalent, omit it.

### 4. Parameter racks (Ableton-style)

Four rows, stacked, below the transport:

1. **patches** — 40-slot patch grid (see §5).
2. **grain** — grain envelope viz + grain parameters (density, size, jitter, pitch, pan, …).
3. **cursor + search** — cursor parameters + sample/search controls.
4. **commits** — commit-slot bank + session controls.

Each rack uses:

- `.rack[data-rack="<name>"]`.
- Header `.rack-head` — 22px min-height, flat `var(--ink-2)` background, bottom hairline, JetBrains Mono label, collapse + reorder affordances on the right (`.rack-head-r`).
- Left edge `.rack-label` — vertically rotated rack name, Ableton-style, JetBrains Mono, `--ink-5`, 90° rotation, fixed narrow column.
- Body `.rack-body` — flat `var(--ink-1)`, 4px inner padding, flex row of labelled knob groups.

Map each live parameter control to a **knob cell**: label above (caps, `--fs-xs`, `--ink-5`), the knob/ring SVG in the middle, numeric readout below (JetBrains Mono, `--fs-readout`, `--ink-7`). **No horizontal sliders.** If the live app uses an `<input type="range">`, keep it in the DOM (so existing listeners still work) but hide it visually and paint a knob on top that writes back into it on drag; or replace with a knob component that dispatches `input` events identical to the original element. The least-risk path is: keep the `<input>`, position it `opacity: 0; pointer-events: none;` over the knob, and dispatch `new Event('input', {bubbles: true})` after each drag tick.

Rack bodies must **wrap** rather than squish: each knob cell is fixed-width, wraps to next line if out of space. No horizontal scrollbars.

### 5. Patch grid (2 × 20)

- Live: `muboneapp/js/ui-patch-table.js` + `ui-presets.js` — patches are ordered, each has a hotkey and a name.
- Target: `.rack[data-rack="patches"] .patch-grid`, a CSS grid `grid-template-columns: repeat(20, 1fr); grid-template-rows: 1fr 1fr; gap: 1px; padding: 2px; background: var(--ink-0); border-radius: var(--r-2);`.
- Each slot is a `.patch`:
  - Flat `var(--ink-2)`, border `1px solid color-mix(in oklab, var(--ink-4) 80%, transparent)`, radius `3px`, `min-height: 38px`.
  - Grid rows: keycap on top (`.idx`), name below (`.name`).
  - `.idx` — JetBrains Mono, flat `var(--ink-0)` background, narrow border, 1px/3px padding.
  - `.name` — Inter, truncated, `--ink-6`.
  - `.patch:hover` → border tinted teal.
  - `.patch.on` → flat teal tint `color-mix(in oklab, var(--teal) 16%, var(--ink-2))`, teal border; keycap turns teal too.
  - `.patch.on.dirty` → 4px amber dot top-right corner.
  - `.patch.empty .idx` → dimmed.

### 6. Envelope viz (grain rack)

- SVG in `design/app-v3.js` (`<div class="env-canvas">...`).
- No `<linearGradient>`. Flat translucent teal fill `rgba(122,188,188,0.14)`, stroke `#9dd6d6` at 1.4px, center guide amber dashed.
- Port verbatim when building the grain-envelope visual. If the live app renders this on a canvas, match the same colors.

### 7. Interaction states

- **All interactive elements** get a 1px teal border on hover, no other color change.
- **Active/on** states use a flat 14–16% teal-over-`--ink-2` tint, not a gradient.
- **Armed/recording** states use amber at the same intensity.
- **Danger** (destructive hover) uses red only at hover.
- **Focus** — use `outline: 1px solid var(--teal); outline-offset: 1px;` where focus rings are meaningful (text inputs, search).
- Transitions: `all var(--tween)` — 120ms ease-out. Nothing slower.

## Files in This Bundle

```
design_handoff_mubone_skin/
├── README.md                              ← this file
├── design/
│   ├── mubone-gui-redesign.html           ← full mock entry (open in a browser to inspect)
│   ├── styles.css                         ← base tokens + shared primitives
│   ├── styles-v3.css                      ← skin layer (racks, transport, patches, knobs)
│   └── app-v3.js                          ← mock JS (patch grid, racks, knob rendering, env SVG)
└── screenshots/
    ├── 01-full.png                        ← whole GUI
    ├── 02-transport.png                   ← two-row transport close-up
    ├── 03-patches-rack.png                ← 2×20 patch grid
    ├── 04-grain-rack.png                  ← env + grain params
    ├── 05-cursor-search-rack.png
    └── 06-commits-rack.png
```

Open `design/mubone-gui-redesign.html` directly to click around and measure things with devtools.

## Implementation Order (suggested)

1. **Tokens first.** Add the `:root` block from `design/styles.css` to the top of `muboneapp/css/style.css`. Import Inter + JetBrains Mono. Commit. App should already look slightly different (backgrounds darken, text tightens).
2. **Strip gradients.** Search `muboneapp/css/style.css` for `gradient` and flatten every hit to a single color using the token palette. Commit.
3. **Top rail.** Apply `.rail`, `.brand`, `.status-chip`, settings-button classes to the existing `.top-bar` structure. Keep all IDs.
4. **Transport bar.** Build `.transport` under the sphere host element. Pull the list of player actions from `muboneapp/docs/KEYBOARD-SHORTCUTS.md` + whatever's bound in `muboneapp/js/events.js` / `main.js`. Wire each `.tbtn` to the same handler the existing shortcut calls (factor a named function if needed; don't duplicate logic).
5. **Racks.** Wrap the existing parameter UI in `.rack` rows. Add rotated `.rack-label` strips. Don't reorder parameters arbitrarily — match the mock's grouping (patches / grain / cursor+search / commits) but keep the parameters that exist today.
6. **Knobs.** Replace each `<input type="range">` visually with a knob (SVG or canvas). Keep the `<input>` in the DOM, hidden, so listeners remain wired. Dispatch `input` events on drag.
7. **Patch grid.** Rebuild the patch table as `.rack[data-rack="patches"] .patch-grid` with 40 `.patch` cells. Use the same data source `ui-patch-table.js` already reads.
8. **Sphere resize handle.** Add `.sphere-resize-handle` on the bottom edge of `.sphere-wrap`. Persist via `localStorage`.
9. **Pass.** Open both the live app and `design/mubone-gui-redesign.html` side-by-side. Match spacings with devtools. Check every hover/active/on state.

## Things to Not Break

- Every existing `id="..."` stays. Re-skin the element; don't re-parent it if anything else in `muboneapp/js/` queries it by ID that depends on DOM position.
- Every keyboard shortcut continues to work. The transport bar calls into the *same* handlers; it is not a new surface.
- The sphere renderer (`muboneapp/js/sphere.js`, `renderer.js`) must keep getting the canvas dimensions it expects. Test after resize-handle work.
- OSC / MIDI / IMU / handsfree / mic enable / mute / camera mode / projector mode / fullscreen all keep behaving identically.
- Mobile layout — leave it alone. Guard new desktop-only rules behind `@media (min-width: 900px)` if they conflict.
- Undo/redo, commits, patches, session save/load — all unchanged. Only their chrome moves.

## Notes

- The mock also has a "Tweaks" panel (mode / density / detail toggles). **Out of scope** for this port — do not ship it.
- If you encounter any button or control in the mock that doesn't exist in the live app, it's decorative. Skip it rather than inventing functionality.
- If a live control exists but isn't in the mock, leave it in place and apply the closest matching primitive style (`.tbtn`, `.pill`, `.rack`).
