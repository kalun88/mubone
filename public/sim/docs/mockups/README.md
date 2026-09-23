# Mockups — the interface, as designed

> **Status: REFERENCE.** Not app code. Nothing here is imported, bundled or served by mubone;
> `sw.js` does not cache it and `scripts/docs-audit.js` does not scan it. It is the visual half of
> `docs/archive/BRUSH-MODEL.md`, kept in the repo so a session can read the design rather than be told
> about it.

## `brush-model-ui.html`

The interactive mockup Ek signed off on. **Open it in a browser** — it is self-contained, no build,
no server. Four tabs across the top; the one that matters is **the second, `s-six`**, which despite
its id is the *current* design, not the superseded six-brushes proposal. The other three (`s-today`,
`s-sets`, `s-words`) are the audit's before-picture, the file/set browser, and the vocabulary
comparison.

**This file is the authority on layout and interaction. `docs/archive/BRUSH-MODEL.md` is the authority on
behaviour and audio.** Where they disagree about what the screen looks like, the mockup is right and
the doc needs a line added — Ek approved the mockup by playing with it.

**Built 2026-08-25 (#216):** the `s-six` screen is in the app as `body.tile-layout`
(`js/tile-layout.js`, `js/tiles.js`, `js/ui-pins.js`), on by default on branch `brush-model`.
What the build deliberately leaves out — the layer-fade dial, the doc chip, scrape bottom, redo,
the `+` design sheet, the 1+Q growing loop — is ghost-labelled in the UI and listed under #216 in
`docs/TODO.md`.

### Reading it without loading 1,700 lines

| Lines | What |
|---|---|
| 6–446 | `<style>` — the entire design system: custom properties, the tile bar, the layers rail, the options bar |
| 509–577 | `s-six` markup — **the screen to build.** Topbar, stage, layers `<aside>`, `.tilebar`, `.optbar` |
| 766–1721 | `<script>` — tile rendering, drag-to-reorder, key handling, the fake sphere, layer fade |

The prose inside `s-six`'s `.readout` block states the reasoning for each decision (why numbers and
not letters, why the options bar moved under the tiles, why there is no arrange room). Read it before
changing any of them.

### What it is not

- **Not pixel-exact.** Colours and metrics are a starting point; they were tuned against a mock
  sphere, not the real canvas at real sizes.
- **Not wired to anything.** The sphere is a canvas animation. No audio, no state, no `S`.
- **The `s-today` screenshot was stripped** from this copy (an 82 KB inline JPEG of the 1.13 window).
  That tab renders empty; nothing else is affected.

## `voices-heads/`

The canvas for `docs/VOICES-AND-HEADS.md` (2026-09-20). Five artboards: the rail today, the rail as
it would be (**interactive** — pick a head, pick a voice, watch the hand), the sheet in its three
sections, the hand and the strip, and the 53px tile drawn three ways. Tokens lifted from
`css/tokens.css`; glyphs are the real ones from `js/tiles.js`.

Live canvas: <https://claude.ai/artifact/8Z585vU8KuAqqGf3VyaMA3>

## `tool-rail/`

The left rail, measured and redrawn (2026-09-22), then updated to what shipped the same day. Three
artboards: the rail **before**, as it rendered on the grain tab with the fold marked; the rail **as
built**, picks above parameters with a scroll mark; and four details (the `+`'s three edges, the two
headings that named one row each, the cut bottom edge, and the tabs). Every number in it was read
off the running app through `.dev-bridge/`, not estimated. The rulings are in `docs/RULINGS.md`
under "The rail's rhythm, and which rows may grow".

Live canvas: <https://claude.ai/artifact/EPUAepg6M57ymE8Gyfkt9U>

## Provenance

Built 2026-08-25 in a Cowork session, alongside `docs/archive/BRUSH-MODEL.md` and `docs/VOCABULARY.md`.
Live version: <https://claude.ai/code/artifact/ccb28e5a-d0c6-4bea-bdfd-5547a8a3a598>
