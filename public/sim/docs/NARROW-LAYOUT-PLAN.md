# Narrow-Window Layout — Audit + Plan

> **Status: HISTORICAL** — implemented 2026-07-27 (responsive column tiers + narrow mode). Kept for the layout audit and the tier rationale. The live rules are the `RESPONSIVE COLUMN TIERS` block at the end of `css/style.css`.

> **Update (2026-07-28) — final tier map, verified by headless render at every
> width.** Discrete column tiers so nothing shrinks into overlap:
>
> | Width | Columns | Notes |
> |---|---|---|
> | ≥1161px | 5 (designed layout) | untouched; canvas position draggable |
> | 961–1160 | 4 | canvas spans 2 (half width), top-left, not sticky |
> | 701–960 | 3 | canvas spans 2 (two thirds) |
> | 431–700 | 2 | **narrow mode** — canvas full width + sticky, bars wrap, modals capped |
> | ≤430 | 1 | everything full width; keeps controls usable to the 380px minimum |
>
> **Panel-level fixes for narrow (2026-07-28)** — found by rendering the real
> page, not by inspection:
> - `.preset-buttons` 4 cols → 2: at ~220px every patch name truncated to
>   "1 use…" / "26 shimm", which defeats the panel's whole purpose.
> - `.seq-section--row` stacks: paired buttons (sweep|erase all, tare|lock)
>   put icon + label + keycap badge in ~105px and they overlapped.
> - Grain rows recover slider length from the row gap and numbox padding, NOT
>   from the label column — narrowing labels wrapped "dry gain" / "fade out"
>   onto two lines and made the row taller instead. Labels get `nowrap`.
> - `.grain-seg` wraps instead of squeezing (third chip of every segmented
>   picker was clipping).
> - `.audio-dialog` / `.viz-dialog` `min-width: 0` — **min-width beats
>   max-width in CSS**, so the audio-settings modal rendered 640px wide inside
>   a 480px window despite the `.mu-dialog` viewport cap.
>
> **Window auto-tiling** — `--station-count=N` (passed by both launchers) sizes
> each instance to 1/N of the display work area and parks it in its own column,
> so `npm run stations` comes up already tiled and already in narrow mode
> (1440px screen ÷ 3 = 480px per station). Solo launches ignore it.

> Goal: run 3 station windows side by side on one screen. Each window should
> shrink to roughly canvas width, then flip into a "phone portrait" layout:
> canvas on top, panels stacked below, vertical scroll. Solo full-width
> behaviour unchanged.
>
> Status: **implemented + verified working** (2026-07-27). Decisions:
> breakpoint 700px, sticky canvas, canvas shape untouched, bars wrap.
> Electron min window: 380×500.
>
> **Audit correction:** the main page's default layout is the *projector
> partition* (`body.projector-mode` applied once at boot — see
> toggleProjectorMode in events.js: the Shift+F toggle only opens/closes the
> mirrored popup now). The narrow mode therefore targets the projector-
> partition selectors: `.right-panel` row → column, `.projector-center` →
> `display: contents` (so the canvas tile can stick against the full panel
> scroll — nothing in JS measures that wrapper, verified), canvas tile
> `order:-1` + sticky, sub-columns stacked. A second branch covers the flat
> (`body:not(.projector-mode)`) layout.
>
> **Debt flagged:** the flat layout may be unreachable now that the
> projector partition is boot-default — the disable branch in events.js
> (~1196) and the flat-mode narrow CSS branch are cleanup candidates if so.

---

## 1. Audit — how layout works today

### Structure

Body is a flex column: `.top-bar` / `.main-layout` / `.bottom-bar`.
`.main-layout` is a flex **row**: `.canvas-wrapper` (flex:1) + `.right-panel`
(fixed `width: 22.7rem`, its own vertical scroll). Shrinking the window
squeezes only the canvas; the panel column never gives. Electron enforces
`minWidth: 800, minHeight: 600` — that's the wall you're hitting.

### Key findings

1. **Zero `@media` queries in style.css.** There is no responsive behaviour
   at all today — nothing to fight, clean slate.
2. **Canvas is fully adaptive already.** `resizeCanvas()` (renderer.js:1206)
   reads the wrapper's bounding rect on every window resize. Whatever shape
   CSS gives the wrapper, the render follows. No canvas code changes needed.
3. **Panels are portable tiles.** Each `.device` card is self-contained;
   collapse state (`mubone_panel_*`) and order (`mubone_panel_order`,
   projector layout v2) are persisted; projector mode already re-parents
   tiles into 5 drag-managed columns (panel-drag.js + events.js). Stacking
   them under the canvas is structurally supported — in normal (non-projector)
   mode it's even easier: the `.right-panel` column can simply go full-width
   under the canvas with **no DOM changes**.
4. **uiScale** (0.7–1.6, persisted per profile) multiplies the root font-size;
   nearly everything is rem-based. It composes cleanly with a narrow mode —
   a station window can also run uiScale 0.8 for extra density.
5. **Two layout systems coexist**: normal mode (canvas + right panel) and
   projector mode (5-column grid, canvas spanning 2 slots). Recommendation:
   narrow mode applies to **normal mode only**. Projector mode is inherently
   a wide-display layout; combining them multiplies states for no use case.
6. **Bars will overflow.** `.top-bar` (brand + two button rows) and
   `.bottom-bar` (meters + sensor group) have no wrap behaviour; below
   ~700px they'll clip. They need `flex-wrap` (or reduced content) in narrow
   mode.
7. **Mobile mode won't false-trigger.** `S.isMobile` requires
   `maxTouchPoints > 0` *and* width < 1024 — a narrow desktop Electron
   window has no touch points. (Caveat: touchscreen laptops could
   false-positive; pre-existing issue, not made worse.)
8. **Modals** (`.mu-dialog`) have fixed/intrinsic widths — need a
   `max-width: calc(100vw - 2rem)` guard so setup modals stay usable in a
   narrow window.
9. **HUD overlay** on the canvas already has `hudScale`; the mode ring and
   edge indicators are proportional. Expect no changes; verify visually.

### Why this is cheap rather than scary

The hard version of this feature would be re-parenting panel DOM into new
containers with new persistence. None of that is needed: normal mode's panel
column already *is* the stack — narrow mode just moves it from "beside" to
"below" with two flex properties, and lets `.main-layout` scroll.

## 2. Design

### Trigger

Pure CSS breakpoint — `@media (max-width: 700px)` — plus a `body.narrow`
class set by a tiny resize listener for the few JS-adjacent bits (none known
yet; class is future-proofing). No user setting, no persistence: width *is*
the setting, and it's per-window, which is exactly the multi-station need.
Threshold ~700px ≈ canvas at two-panel-column width; tune by feel.

### Narrow-mode rules (normal mode only)

- `.main-layout` → `flex-direction: column; overflow-y: auto` (the page
  scrolls as one column)
- `.canvas-wrapper` → `width: 100%; aspect-ratio: 1 / 1; max-height: 55vh;
  flex: none` — square-ish sphere pinned to the top, scrolls away when you
  dig into panels below (alternative: `position: sticky; top: 0` to keep the
  sphere always visible — decide by feel)
- `.right-panel` → `width: 100%; flex: 1; overflow visible` (its scroll job
  moves to `.main-layout`)
- `.top-bar` rows and `.bottom-bar` → `flex-wrap: wrap`, meters allowed to
  take a second row
- `.mu-dialog` → `max-width: calc(100vw - 2rem)`
- Panel order/collapse: unchanged — same persisted state drives both wide
  and narrow, per instance profile

### Electron window

- `minWidth: 800` → `380`, `minHeight: 600` → `500`
- Everything else unchanged; solo full-width windows never hit the breakpoint

## 3. Open questions (answer before implementing)

1. **Breakpoint 700px OK?** Or measure against the real 3-across-on-your-
   screen math (screen width / 3 minus margins) and pick from that.
2. **Sphere sticky or scroll-away** when you scroll down the panel stack in
   narrow mode? Sticky keeps the instrument visible while tweaking; scroll-
   away gives panels more room.
3. **Canvas shape in narrow mode**: square (`1/1`) vs shorter (`4/3`)?
   Square shows the full sphere; 4/3 buys panel space.
4. **Bottom bar in narrow mode**: wrap everything onto two rows, or hide the
   per-channel meter strip and keep only mute/master/sensor status?

## 4. Implementation steps (after sign-off)

1. `css/style.css`: one `@media (max-width: 700px)` block implementing §2
   (~40 lines, all additive — zero changes to wide-mode rules)
2. `electron-main.js`: lower minWidth/minHeight
3. `js/main.js`: 3-line resize listener toggling `body.narrow` (reserved)
4. Manual test matrix: wide→narrow→wide drag-resize (canvas follows, no
   layout residue); collapse/drag panels in narrow; open every modal at
   380px; projector mode unaffected; solo window unaffected; scheduler
   drift unchanged while resizing (perf monitor open)
