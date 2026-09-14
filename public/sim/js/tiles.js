// ============================================================================
// tiles.js — the palette and the toolbox (#248, slots 2026-09-03)
//
// ── The hand, and the palette as quick access ────────────────────────────────
// (Ek, 2026-09-03; arming deleted 2026-09-11; THE HAND BACK 2026-09-12.)
// "like any computer painting app, the tool rail has the tool. you should be
// able to pick the tool and have it 'in hand'. in hand just should mean what
// the spacebar or click does. that should be always the truth." Two things,
// cleanly split. THE HAND is one tool, picked by a click on its rail row or
// its strip tile, played by the SPACEBAR and a LEFT-CLICK on the sphere in
// one global verb (`handVerb`), and drawn as the spacebar plate under the
// strip. THE PALETTE is quick access: a POSITION is a button with its own
// key, button or note, in its own verb; pressing it plays what sits there
// and never touches what is in hand. "What would space do?" has one answer
// again, and the plate is it.
//   · The palette is BUILT by dragging (Ek, 2026-09-11, Procreate): a row
//     from the rail onto the strip places it, a tile within the strip moves
//     it, a tile dragged off is removed. Nothing cycles under a tile; every
//     tile is visible.
//   · A LENS is a state: its tile (or rail row) tapped turns it on, tapped
//     again turns it off, and NO LENS ON is the cap — the cursor reads
//     nothing. There is no cap tile and no cap row (Ek, 2026-09-11).
//   · A CLICK on a tool — on the strip or in the rail — takes it IN HAND and
//     plays nothing; key N, a pad or OSC on a position PLAYS it. A lens tile's
//     click installs it (a choice), a pin tile's fires it (an act).
//   · The tool rail is the LIBRARY, and a click there never PLACES: placing
//     is drag. Tab shows and hides the TOOL RAIL; the ⋯ is the drawer's door.
//
// Two models used to run at once here and fought (Ek): a palette, where a
// click selects and space uses the selection, and a pedalboard, where a held
// digit fires a slot. The pedalboard won outright. What is left:
//   · THE HAND EXISTS ONLY WHILE SOMETHING PLAYS (`_held`, handTileId). A
//     stroke can only be started by a position press, so every stroke has a
//     real tile under it — which is what brush-voicing.js and wet paint read.
//     Between presses the hand is null and the cursor wears no engine hue.
//   · The DIGITS are the palette's keys BY POSITION (Ek, 2026-09-04): `N`
//     does that position's primary act — a tool plays, a lens goes on or
//     off, a pin tile fires. They are the factory keys of `palette_1`…
//     `palette_9`, so the keys page can move any of them, and a relearned
//     one gives its digit up.
//   · A position has TOGGLE and MOMENTARY and nothing else (Ek, 2026-09-11:
//     "a position can still have toggle and momentary, just not arm"). For a
//     TOOL the position's own row IS the toggle — the rule a lens already
//     followed, where the tap is the activate — so `palette_N` plays and
//     `palette_N_hold` plays while held. Pin keeps a third row, because
//     "pin here" and "pin a path" are two different acts.
//   · THERE IS NO MAIN BUTTON (2026-09-11). `trace_toggle`, `recpaint`,
//     `/trace`, `/trace/toggle`, the Space key and the click on the sphere
//     are all gone: every one of them meant "fire the tool in the hand".
//     Spacebar ships unbound and is learnable onto any position — Ek: "if I
//     want to key bind spacebar I can still do that and bind it to the most
//     used tile. now spacebar is just like any other key."
//
// docs/mockups/brush-model-ui.html (s-six) is the authority on this surface;
// docs/archive/BRUSH-MODEL.md § 3c v3 carries the reasoning. One row along the bottom
// holds brushes, edit tools, arrange-toggle, undo/redo and `+`; **numbers run
// left to right, so a tile's position is its key** — drag a tile and its
// number follows (forScore). Holding a digit IS the primary gesture: the tile
// decides what the cursor deposits or removes while it is down. `Q W E` were
// the three named pin groups, and both they and the groups are gone
// (2026-08-30): pinned material groups by kind, so pinning is one gesture on
// `=` / `-` (js/ui-pins.js) with nothing to aim.
//
// Everything a tile does routes through EXISTING engine paths:
//   line  — the tape brush: setBrush('tape') + the position press, so
//           brushClaimsTrace() records a trigger. Loop-on-touch is
//           triggerParams.dwell, surfaced in the options bar.
//   pen — a grain brush + the position press → the normal granular trace.
//           What it inks from is the SOURCE (S.sourceKind, #247) — live
//           input or the sampler — not a property of any tile.
//   scrape top / scrape bottom / scrape all — an erase stroke through the
//           position press. The three differ only in the
//           depth and direction they preset; erase already reads the global
//           recency filter and S.eraseOldest (#212, #287).
//   toggle — momentary composer at group scope: hold and sweep, and a pin's
//           whole group flips (pins.js toggleGroupOf). The latch, its
//           scan-mute and its restore rule stop applying because the press IS
//           the window (§ 3e v3c).
//   undo  — the undo action.
// Options-bar controls WRITE THROUGH the real panel elements and dispatch
// 'input' — the cc-mirror-audit lesson: a setter that moves one copy and not
// the other is invisible until a controller drives it.
//
// NOT here yet, deliberately: redo (the app has no redo) renders as a ghost
// tile that says so. Scrape bottom used to be listed here as unbuildable —
// `S.eraseOldest` and the `from` control landed since, so it is now just a
// preset like the other two (#287).
// ============================================================================

import { S, perf, gp } from './state.js';
import { setBrush } from './brush.js';
import { resolveGrainParams, dryVoicing, wetVoicingOf } from './brush-voicing.js';

const LS_ORDER = 'mubone_tile_order';
const LS_PALETTE = 'mubone_palette';   // the palette: ordered tile ids, ≤ PALETTE_MAX (2026-09-11)
// Factory tools and lenses DELETED (Ek, 2026-09-10: "delete should be
// available for the factory defaults also"). A custom tool is deleted by
// dropping its definition; a factory one has no definition to drop, so its
// id is written here and tileDef / lensAll answer as if it never existed.
// The order restore would otherwise put it back beside its neighbours on
// the next boot. A factory reset (Settings → Export · import · reset, the
// `ui` category) clears the key, and the originals come back.
const LS_GONE = 'mubone_tiles_gone';
let _gone = new Set();
function _saveGone() { try { localStorage.setItem(LS_GONE, JSON.stringify([..._gone])); } catch (_) {} }

// Glyphs shared with the mockup (same paths).
const G = {
  line:  '<path d="M3 16c3-7 6-9 9-5s6 2 9-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  // DOTS: four big dots on a lightly curved L (Ek, 2026-09-12, night: "make
  // it a lightly curved L shape" — after a dashed curve, dots on line's curve
  // and a straight diagonal). The centres are the quadratic (5,4) → control
  // (5.5,19.5) → (20,20) at t = 0, ⅓, ⅔, 1: down the left, a soft bend, out
  // along the bottom. r 2.1.
  dots:  '<circle cx="5" cy="4" r="2.1"/><circle cx="6.9" cy="12.7" r="2.1"/><circle cx="11.9" cy="18" r="2.1"/><circle cx="20" cy="20" r="2.1"/>',
  // The line's glyph, TWICE: one take cut into pieces is more than one line,
  // and two of the same squiggle says so at any size (Ek, 2026-09-03). The
  // first redraw cut one curve into segments with bars through the gaps; at
  // rail size that read as noise beside the plain line.
  slice: '<g transform="translate(0 -4.5)"><path d="M3 16c3-7 6-9 9-5s6 2 9-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></g><g transform="translate(0 4.5)"><path d="M3 16c3-7 6-9 9-5s6 2 9-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></g>',
  // TRAIL: dots' own dots — r 2.1 — in a circle, six of them on r 7 (Ek,
  // 2026-09-12, night: "the same size dots but in a circle"). LOOP: line's
  // own stroke as a circle with a small gap — r 8, 1.6 wide, 40° open at the
  // top-right ("same width line as the line logo but a circle with a small
  // space in the circle's line"). Both are their engine's brush shape closed
  // into a ring: what they pin on release. The pin mark says the same thing.
  trail: '<circle cx="19.00" cy="12.00" r="2.1"/><circle cx="15.50" cy="18.06" r="2.1"/><circle cx="8.50" cy="18.06" r="2.1"/><circle cx="5.00" cy="12.00" r="2.1"/><circle cx="8.50" cy="5.94" r="2.1"/><circle cx="15.50" cy="5.94" r="2.1"/>',
  loop:  '<path d="M19.25 8.62A8 8 0 1 1 15.38 4.75" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  // Overdub: the looper's circle with a second arc laid inside it — a layer on a cycle.
  overdub: '<path d="M12 4a8 8 0 1 1-7.1 4.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 8.5a3.5 3.5 0 1 1-3.1 1.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  // Wash: one mark and the halo it leaves — the stroke that stays as a cloud.

  // The pen: a nib on a stroke — the classic thin granular line (spray until 2026-09-06).

  spray: '<circle cx="10" cy="12" r="3.2"/><circle cx="16" cy="8" r="1.6"/><circle cx="17.5" cy="13.5" r="1.1"/><circle cx="14.5" cy="17" r="1.3"/><circle cx="6" cy="7.5" r="1.2"/><circle cx="5.5" cy="16.5" r=".9"/><circle cx="20" cy="10.5" r=".7"/><circle cx="12" cy="5.5" r=".8"/>',
  match: '<rect x="3" y="9" width="4.5" height="6" rx="1"/><rect x="8.8" y="7" width="2.8" height="10" rx="1"/><rect x="12.9" y="10" width="4" height="4.5" rx="1"/><rect x="18.2" y="8" width="2.6" height="8" rx="1"/>',
  comb: '<rect x="3" y="6" width="3" height="12" rx="1"/><rect x="7.6" y="8" width="3" height="10" rx="1"/><rect x="12.2" y="10.5" width="3" height="7.5" rx="1"/><rect x="16.8" y="13" width="3" height="5" rx="1"/>',
  staff: '<path d="M3 12h18" stroke="currentColor" stroke-width="1.1" opacity=".5"/><circle cx="6" cy="7" r="1.7"/><circle cx="11" cy="15.5" r="1.7"/><circle cx="16" cy="10" r="1.7"/><circle cx="20" cy="17" r="1.4"/>',
  erase: '<path d="M20 19H9l-4.2-4.2a1.6 1.6 0 010-2.3l7.5-7.5a1.6 1.6 0 012.3 0l4.6 4.6a1.6 1.6 0 010 2.3L13 19" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  erase2:'<path d="M20 19H9l-4.2-4.2a1.6 1.6 0 010-2.3l7.5-7.5a1.6 1.6 0 012.3 0l4.6 4.6a1.6 1.6 0 010 2.3L13 19" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5 21.4h15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  erase3:'<path d="M20 19H9l-4.2-4.2a1.6 1.6 0 010-2.3l7.5-7.5a1.6 1.6 0 012.3 0l4.6 4.6a1.6 1.6 0 010 2.3L13 19" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="12" cy="12" r="10.4" fill="none" stroke="currentColor" stroke-width=".9" stroke-dasharray="2 2.6"/>',
  undo:  '<path d="M4 8h10a5 5 0 010 10H9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.5 4.5L4 8l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  redo:  '<path d="M20 8H10a5 5 0 000 10h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.5 4.5L20 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  // The PALETTE — the palette's own symbol (Ek, 2026-09-03: the palette is a
  // palette). Filled, dabs cut out, for "on the palette"; outline with hollow
  // dabs for "not". Material's silhouette, thumb notch lower right.
  // The pin pair on the palette (2026-09-10): a pushpin, and the pushpin
  // struck through — the slash is the footer's own word for "off".
  // THE PIN FAMILY (Ek, 2026-09-12, night: "come up with a better logo for
  // pin unpin and unpin all"): a pushpin from the side — a round head and a
  // needle — flat and geometric. PIN is the head filled; the PIN MARK's off
  // face (`pinOff`, the rows and stickers) is the same head outlined — the
  // wet drop's rule, filled on, outlined off; UNPIN is the outlined pin with
  // the app's own off-slash; UNPIN ALL is two outlined pins under one slash —
  // plural, and gone. The tack silhouette these replace collided with the
  // slash at row size, and its doubled form read as a smudge.
  pin:        '<circle cx="12" cy="8.5" r="5"/><path d="M12 13.5v7.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  unpin:      '<circle cx="12" cy="8.5" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 12.7v8.3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M4.5 19.5l15-15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  unpinAll:   '<circle cx="7.3" cy="8.5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7.3 11.9v8.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="16.7" cy="8.5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M16.7 11.9v8.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M3 20.5L21 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  palette:    '<path fill-rule="evenodd" d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zM4.9 12a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0zM7.9 8a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0zM12.9 8a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0zM15.9 12a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0z"/>',
  // A drop: the mark of a WET brush, whose knobs keep moving its strokes.
  wet: '<path d="M12 3.4C9.2 7.4 6.6 10.4 6.6 13.6a5.4 5.4 0 0 0 10.8 0c0-3.2-2.6-6.2-5.4-10.2z"/>',
  // The pin mark's OFF face: the same pin, its head outlined — the wet drop's rule.
  pinOff: '<circle cx="12" cy="8.5" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 12.7v8.3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  // The same drop, outlined: the wet BUTTON's dry face on a grain brush's
  // row — shape, not dimming, the palette mark's rule (Ek, 2026-09-06).
  wetOff: '<path d="M12 3.4C9.2 7.4 6.6 10.4 6.6 13.6a5.4 5.4 0 0 0 10.8 0c0-3.2-2.6-6.2-5.4-10.2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  // YOUR tool, whatever its engine (Ek, 2026-09-10: "give the custom ones a
  // special logo that's distinguishable"): a four-point spark, filled, in
  // the engine's hue. One mark for all of them — the group and the hue
  // already say the engine, so the glyph is free to say "made here".
  custom: '<path d="M12 2.5c.6 5.5 4 8.9 9.5 9.5-5.5.6-8.9 4-9.5 9.5-.6-5.5-4-8.9-9.5-9.5 5.5-.6 8.9-4 9.5-9.5z"/>',
};

// The factory row, mockup order. `ghost` marks tiles whose behaviour is not
// built — they say so rather than pretending.
const TILE_DEFS = {
  line:   { kind: 'brush', g: 'line',   c: '#ff6b9d', label: 'line',
            foot: 'Records a trigger — one buffer, played whole when the cursor reaches it. Loop-on-touch is the dwell option. The line ↔ trigger merge is § 1d.' },
  slice:  { kind: 'brush', g: 'slice',  c: '#ff8fab', label: 'slice',
            foot: 'A line that AUTO-SLICES: one take, cut into separate triggers at its onsets. Detection is on the audio in the dB domain against a local median, so it adapts to any noise floor — an attack is whatever rises out of the room. Swells stay whole; each slice fires on touch like any line.' },
  // `looper` and `overdub` are the IDS; LOOP and DUB are the names (Ek,
  // 2026-09-12, night: "rename looper loop. rename overdub, dub"), the ids
  // kept for the same reason as `pen` → dots above.
  looper: { kind: 'brush', g: 'loop',   c: '#ff5c7a', label: 'loop',
            foot: 'The traditional looper (#237): end the stroke and it LOOPS IMMEDIATELY, pinning itself into a group — record, it repeats. The stroke stays scratch too, touch it and it fires. `passes` (baked in) makes it self-killing: N passes, fading each, then it deletes itself and its paint. ⇧Q/W/E unpins the nearest pin of that group back to the cursor.' },
  overdub: { kind: 'brush', g: 'overdub', c: '#ff9db3', label: 'dub',
            foot: 'A take INSIDE a pinned loop\'s cycle (docs/archive/OVERDUB-PLAN.md). The nearest pinned loop at the press is the master; the take joins it as a layer — every cycle, at the phase you played it, at 1× whatever the master\'s speed; longer than the cycle and the passes stack. Its marks are its own stroke (erase, undo), the sound is the pin\'s: one pin, a dot per overdub. Nothing pinned, and the first take IS the main loop — pinned on release, like the looper — so the next press has a master.' },
  // `pen` is the ID; DOTS is the name (Ek, 2026-09-12, night: "change the
  // name pen to dots"). The id stays: it keys stored blocks, palettes,
  // voicings in session files and every audit, and a rename of the id is a
  // migration for a day the audits run.
  pen:  { kind: 'brush', g: 'dots', c: '#e8a030', label: 'dots',
            foot: 'The granular trace — marks on a tick, each a window into the buffer. Granulates what is in reach.' },
  // The wash (Ek, 2026-09-05; renamed away on 2026-09-07 and RESTORED the same
  // day — "actually i forgot about the wash being the one that drops a pin
  // simultaneously"). The looper's move for the grain family, and the one grain
  // tile that arrives with a sound of its own.
  // `wash` is the ID; TRAIL is the name (Ek, 2026-09-12, night: "rename wash
  // trail"), the id kept as pen → dots above.
  wash:   { kind: 'brush', g: 'trail',  c: '#d9a86c', label: 'trail',
            foot: 'A granular wash that STAYS: end the stroke and it is pinned as a cloud on the path you drew, looping it — `cloud on end`, the looper\'s contract for the grain family. While you paint only the cursor reads it; the cloud takes the path on release. Factory block is a reverb, not a granulator: long, dense, smeared, dark. Unpin it like any cloud.' },
  spray:  { kind: 'brush', g: 'spray',  c: '#f26415', label: 'spray',
            foot: 'EXPERIMENTAL — the one brush whose head is dynamic, and that IS its predetermined contract: scatter rides your speed (a flick throws paint forward), width rides your voice (louder loads the brush). Slow and quiet converges on a thin line.' },
  match: { kind: 'brush', g: 'match', c: '#81c784', label: 'match',
            foot: 'EXPERIMENTAL (CataRT query) — paints with your own corpus, steered by your voice: each deposit lays down the best descriptor match from everything already painted. Nothing painted yet = nothing to collage.' },
  comb: { kind: 'brush', g: 'comb', c: '#b8d977', label: 'comb',
            foot: 'EXPERIMENTAL (CataRT layout) — the path stays, the phrase redistributes: while you paint, the stroke continuously re-sorts its marks along the drawn line by the chosen feature, so the line becomes a sorted index of what you played, not a timeline. Sweep it later and you scrub by brightness, not by time. The keep sieve drops material that does not qualify.' },
  staff: { kind: 'brush', g: 'staff', c: '#9fa8da', label: 'staff',
            foot: 'EXPERIMENTAL — the hand supplies longitude only; LATITUDE IS BRIGHTNESS (6 octaves of centroid, log-mapped). Draw left to right and the phrase notates itself vertically — the sphere becomes a spectrogram you played. Comb sorts along the line; staff displaces across it.' },
  // ── The three erasers (#287) ──────────────────────────────────────────
  // One question each, and between them they cover the erase engine: take
  // the newest layer, take the oldest layer, or take everything in reach.
  // Nothing here is a mode — each is a preset of depth + direction, so the
  // engine page still exposes both and a deeper scrape is a custom tool.
  scrape: { kind: 'edit',  g: 'erase',  c: '#e57373', label: 'scrape top',
            foot: 'Takes ONE layer off the top — the newest material under the cursor, revealing what was beneath. Depth is the same knob as the lens\'s; raise it to take more.' },
  bottom: { kind: 'edit',  g: 'erase2', c: '#e57373', label: 'scrape bottom',
            foot: 'Takes ONE layer off the bottom — the oldest material under the cursor, leaving what you played most recently standing.' },
  all:    { kind: 'edit',  g: 'erase3', c: '#e57373', label: 'scrape all',
            foot: 'Everything inside the reach, no recency filter at all — the hold forces recency off and restores it on release.' },
};
// Core brushes, then edits (both fully keyed — the working set), then the
// experimental brushes. Kind changes draw dividers, so the sets read as
// sets. Undo/redo moved to the chrome (⌘Z still works). The `+` that ended
// the list is gone (2026-09-10): a new tool is minted from the `+` on its
// engine's title, so there is no "new" group and no engine chooser.
// echo, chop and pour were cut 2026-08-29 (Ek). What is left is the set that
// earned its place: pen the classic, the wash, spray, comb, staff and match.
const DEFAULT_ORDER = ['line', 'slice', 'looper', 'overdub',   // tape engine
                       'scrape', 'bottom', 'all',       // erase engine
                       'pen', 'wash', 'spray', 'comb',
                       'staff', 'match'];               // granular engine

// ── Scopes — the cursor's lens (Ek, 2026-08-25; postdates the mockup) ──────
// The camera model: the tile row says what the HAND does, the lens says what
// the EYE does, and they compose. One lens is always installed — pick the
// lens for the subject, set its radius and depth, leave it on, paint. The CAP
// is the toggle tile at the end of the set: the lens stays mounted with its
// settings, the cursor just stops reading. Selection is DERIVED from the
// engine flags (composerMode, nearestMode, scanMuted), never stored — ⇧K and
// N keep working and the tiles can never lie (the § 3e audibility lesson).
// This retires the toggle tile: sweep-to-flip was an eye behaviour wearing a
// hand costume, which is why it confused.
const SCOPE_G = {
  wide:    '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55"/>',
  // The spot lens wears the CURSOR's shape (Ek, 2026-09-07) — it is the lens
  // that locks onto what the cursor is nearest, so the reticle's diamond says
  // it better than a target ring did.
  spot:    '<path d="M12 3l9 9-9 9-9-9z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M12 9.6l2.4 2.4-2.4 2.4-2.4-2.4z"/>',
};
const LENSES = [
  { id: 'wide',    label: 'wide',    c: '#7abcbc',
    foot: 'The wide lens — everything inside the radius, newest first to the depth you set. Today’s area scan.' },
  { id: 'spot',    label: 'spot',    c: '#7abcbc',
    foot: 'The spot lens — locks the closest marks whatever the radius. Today’s nearest mode.' },
  // The two PIN LENSES that stood here — `pincloud` and `pinloop`, toggles that
  // composed — were sunset on 2026-08-30. The lens reads the SCRATCH layer and
  // nothing else now (Ek: "pins are a separate thing that lenses don't touch"),
  // so how the pins share the mix is a pin parameter, on Settings → Pins, where
  // Blend / Crossfade / Tether already were. That is also what deleted the
  // "which filters" group from this dock: every entry below is one lens, and
  // the question has exactly one answer again.
  // The CAP is not a lens and not a tile (Ek, 2026-09-11): it is NO LENS ON.
  // A lens tile toggles — on installs it, on again turns it off — and with
  // none on the cursor reads nothing, which is what the cap always meant.
  // `S.scanMuted` is still the engine's flag for that state; `scan_toggle`
  // (S) flips it without moving `_lensSel`, so the same lens comes back.
];

/** Which lens is installed — STORED (Ek, 2026-08-26; supersedes the #228
 *  derivation rule): the sheet always edits ITS OWN tile, so flipping `mode`
 *  inside wide's sheet must not move the highlight to spot — wide just runs
 *  nearest for the session, like any other temporary sheet edit. Only
 *  lensTap moves the selection. The one flag still synced is composerMode
 *  (⇧K enters arrange from outside the tiles — see refreshLensStates). */
let _lensSel = 'wide';
export function installedLens() { return _lensSel; }

let order = DEFAULT_ORDER.slice();

// ── The palette: ONE TILE, ONE VERB (docs/PALETTE-GUI.md, Ek 2026-09-11) ─────
// An ordered list of up to nine ENTRIES — `{ id, verb }` — and the POSITION is
// the binding: key `N`, `/palette/N` and ONE `palette_N` row on the keys page
// address whatever sits at N today, so the performer designs the palette first
// and maps buttons to positions after. Nothing is locked to a kind and nothing
// cycles under a tile — every tile on the palette is visible ("if it doesn't
// need to show don't show it") — and the rail is the library you drag from
// (Procreate: drag a row onto the strip to place it, drag a tile within it to
// move it, drag a tile off to remove it).
//
// **The VERB is the tile's, not the caller's** (PALETTE-GUI § 1). A tile fires
// exactly one way — `bang`, `momentary` or `toggle` — chosen in its drawer
// head from what its kind allows (`verbsOf`, § 4), and that is why there is one
// action per position instead of three. THE SAME TOOL MAY SIT ON THE STRIP
// TWICE in two verbs: two drags and two settings (§ 4), which is also how pin
// ends up on the strip twice in the mockup. So the list is not deduped by id,
// and everything that addresses a tile addresses a POSITION.
//
// The verb is drawn, once, as the tile's SHAPE — one closed outline, one
// property, `border-radius` (§ 3): a bang is a circle (no corners to hold), a
// momentary is a plate (`--r-hand`, "an object you grab with a whole hand"),
// a toggle is an asymmetric plate whose two rounded and two square corners
// give it the one thing a latch has and a spring does not, a direction.
//
// Before this (2026-09-03 → 2026-09-11) the palette was three slots locked to
// an engine each, a second tap cycling a slot through its kind with a skip
// list chosen in the rail (`mubone_cycle_off`), plus a cap tile, a lens tile
// and the pin pair in beds of their own; and until the evening of 2026-09-11
// every position carried three verbs at once and the caller chose. All of that
// is git history.
const PALETTE_MAX = 9;
const VERB_RADIUS = { bang: '999px', momentary: 'var(--r-hand)', toggle: '24px 3px 24px 3px' };
// Factory: wide · line · pen · all · overdub · unpin · pin. The first four
// keep the positions the digits had before the list existed (a stored key or
// button on 2, 3 or 4 still means line, pen, all); overdub is the second tape
// tool Ek wanted on a fresh rig (2026-09-07); pin, the add, is farthest right.
//
// The VERBS here are not all § 4's drop defaults, and that is deliberate: LINE
// is a toggle because the factory button map puts button 1 TAP on position 2,
// and a tap is a bang with no up edge — it cannot drive a momentary (midi.js
// `_learnGesture` refuses the same pairing at the other door). Pen keeps
// momentary because button 1 LONG has both edges. Change one and change
// BUTTON_DEFAULTS with it.
// The factory strip (Ek, 2026-09-12), left to right, with its factory keys
// (midi.js PALETTE_FACTORY_KEYS seeds them, by position, once per profile):
//   wide     lens  toggle     1
//   wash     tool  momentary  2
//   overdub  tool  toggle     3
//   line     tool  toggle     space        — a press, on the down edge
//   pen      tool  momentary  space long   — the same key, held
//   unpin    act   bang       ↑
//   pin      act   bang       ↓
// THE FACTORY STRIP (Ek, 2026-09-12, night), left to right, with the factory
// keys midi.js PALETTE_FACTORY_KEYS deals by tile — keep the two lists and
// midi.js PALETTE_FACTORY_ENTRIES in step:
//   dots        momentary   1 long        — the same key as line, held
//   line        toggle      1
//   loop        toggle      2
//   dub         toggle      3
//   scrape top  momentary   4
//   pin         bang        ↓
//   unpin       bang        ↑
// The hand ships holding DOTS, momentary. No lens on the strip: wide is
// installed and stays so; a lens tile is a drag away.
const DEFAULT_PALETTE = [
  { id: 'pen',     verb: 'momentary' },
  { id: 'line',    verb: 'toggle'    },
  { id: 'looper',  verb: 'toggle'    },
  { id: 'overdub', verb: 'toggle'    },
  { id: 'scrape',  verb: 'momentary' },
  { id: 'pin',     verb: 'bang'      },
  { id: 'unpin',   verb: 'bang'      },
];
let palette = DEFAULT_PALETTE.map(e => ({ ...e }));
// ── Reading the list ────────────────────────────────────────────────────────
// Positions, not ids: a duplicate id is legal, so `indexOf` is never the
// question. `posOf` answers "the FIRST position holding this id" and is only
// for the rail's tooltip; everything that fires reads `palAt`.
function palAt(i)   { return palette[i] ?? null; }
function idAt(i)    { return palette[i]?.id ?? null; }
function verbAt(i)  { return palette[i]?.verb ?? null; }
function palIds()   { return palette.map(e => e.id); }
function posOf(id)  { return palette.findIndex(e => e.id === id); }
/** Every position holding `id`, 1-based — a tool may sit on the strip twice. */
function posesOf(id) { const out = []; palette.forEach((e, i) => { if (e.id === id) out.push(i + 1); }); return out; }

// ── Migrating a stored palette to entries, ONCE (2026-09-11 evening) ────────
// `mubone_palette` was `["wide","line",…]` and is `[{id,verb},…]`. A stored
// string has no verb, and PALETTE-GUI § 1 says to use the kind's default —
// but that BREAKS the factory button map, which is why this derives instead:
// `BUTTON_DEFAULTS` puts button 1 TAP on position 2, a tap is a bang with no
// up edge, and a brush's default verb is momentary, whose action is a `hold`.
// midi.js `_learnGesture` already refuses that pairing at the other door.
//
// So the verb comes from WHICH of the three old actions the performer had
// bound at that position, read straight out of the three maps:
//
//   palette_N_hold   bound → momentary   (it meant "while down")
//   palette_N_toggle bound → toggle      (pin's drawn path, press to press)
//   neither          → the kind's default (§ 4)
//
// `_hold` beats `_toggle` when both are bound, because a position could carry
// two verbs before and can carry one now; there is no non-arbitrary choice, so
// the precedence is stated rather than guessed. NOTHING IS LOST either way —
// midi.js `_collapsePaletteVerbsOnce` moves every binding on all three ids
// onto `palette_N`, and a tile carrying two sources is explicitly legal (§ 6).
//
// Read at MODULE LOAD, from raw localStorage, so it cannot race midi.js's own
// collapse: module evaluation runs before any init function.
const LS_PALETTE_VERBS = 'mubone_palette_verbs';
const PALETTE_VERBS_V = '2026-09-11';
const _derivedVerbs = (() => {
  const out = {};
  try {
    if (localStorage.getItem(LS_PALETTE_VERBS) === PALETTE_VERBS_V) return out;
    const maps = ['mubone_key_map', 'mubone_button_map', 'mubone_midi_map']
      .map(k => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (_) { return {}; } });
    for (let n = 1; n <= PALETTE_MAX; n++) {
      const has = suffix => maps.some(m => m && m[`palette_${n}${suffix}`]);
      if (has('_hold')) out[n - 1] = 'momentary';
      else if (has('_toggle')) out[n - 1] = 'toggle';
    }
  } catch (_) {}
  return out;
})();
/** One stored element → an entry. A string is pre-2026-09-11 and takes its
 *  derived verb, or its kind's default; an object is already an entry. */
function _entryFromStored(v, i) {
  if (typeof v === 'string') {
    const id = migrateTileId(v);
    return paletteKind(id) ? { id, verb: _derivedVerbs[i] && verbAllowed(id, _derivedVerbs[i]) ? _derivedVerbs[i] : defaultVerb(id) } : null;
  }
  if (v && typeof v === 'object' && typeof v.id === 'string') {
    const id = migrateTileId(v.id);
    return paletteKind(id) ? { id, verb: verbAllowed(id, v.verb) ? v.verb : defaultVerb(id) } : null;
  }
  return null;
}
// The two pin ACTIONS as tiles: grey glyph (a pin holds any engine's
// material), a flash on the press (`_pinFlash`).
const ACT_TILES = {
  pin:   { g: 'pin',   action: 'commit_drop',    label: 'pin',   tip: 'pin here — what the cursor is sounding, where you stand. Its verb is in its drawer: bang pins where you stand, momentary and toggle draw a path' },
  unpin: { g: 'unpin', action: 'commit_release', label: 'unpin', tip: 'unpin the selected pin — nearest, farthest or oldest, Settings → Pins' },
  // A palette candidate since 2026-09-12 (Ek, night: the pin rows are tool
  // rows, "consistent with being able to drag those tools from the right
  // rail into and out of the palette bar"). A bang, always; nothing to aim.
  unpinall: { g: 'unpinAll', action: 'commit_clear', label: 'unpin all', tip: 'unpin all — release every pin, clouds and loops', danger: true },
};
function isActTile(id) { return Object.prototype.hasOwnProperty.call(ACT_TILES, id); }
/** A tool you play — a brush or an eraser, not a ghost. Custom tiles qualify. */
function isToolTile(id) {
  const t = tileDef(id);
  return !!t && (t.kind === 'brush' || t.kind === 'edit') && !t.ghost;
}
function isLensTile(id) { return !_gone.has(id) && (LENSES.some(l => l.id === id) || _tileCfg[id]?.custom?.engine === 'lens'); }
/** What a palette id IS: 'tool' · 'lens' · 'act', or null for nothing placeable. */
function paletteKind(id) {
  return isToolTile(id) ? 'tool' : isLensTile(id) ? 'lens' : isActTile(id) ? 'act' : null;
}
/** A tool's engine — `tape` · `granular` · `erase` — or null if it is not a
 *  tool. The name is from the slot days; it is still the question the rail's
 *  grouping and the delete guard ask. */
export function slotKind(id) { return isToolTile(id) ? engineOf(id) : null; }
/** Every tool of an engine, in the rail's order. */
function kindAll(kind) { return order.filter(id => slotKind(id) === kind); }
/** WHICH VERBS A KIND MAY HAVE, and which one a drop lands on
 *  (docs/PALETTE-GUI.md § 4). It kept its name and its job and lost its shape:
 *  it used to answer "which of the three rows are live for this position",
 *  and there are no rows any more — a position has ONE verb, stored on the
 *  entry (`verbAt`), and this is the menu it was chosen from.
 *
 *  A lens is momentary or toggle and never a bang: turning a lens on is a
 *  state, and a state with one edge has no way back. Unpin is a bang and only
 *  a bang: there is no span to hold open. Pin has all three, which is what
 *  lets one pin tile pin where you stand and a second draw a path. */
const VERBS_OF = {
  tool:  { allowed: ['momentary', 'toggle'], def: 'momentary' },
  lens:  { allowed: ['momentary', 'toggle'], def: 'toggle' },
  pin:   { allowed: ['bang', 'momentary', 'toggle'], def: 'bang' },
  unpin: { allowed: ['bang'], def: 'bang' },
  unpinall: { allowed: ['bang'], def: 'bang' },
};
export function verbsOf(id) {
  const k = paletteKind(id);
  if (!k) return null;
  return VERBS_OF[k === 'act' ? id : k] ?? null;
}
/** The verb a tile lands on when it is dropped, and the one a stored entry
 *  falls back to when its verb is missing or not allowed for its kind. */
function defaultVerb(id) { return verbsOf(id)?.def ?? null; }
function verbAllowed(id, verb) { return !!verbsOf(id)?.allowed.includes(verb); }

/** The palette's entries, for a surface that needs the verbs too. */
export function paletteEntries() { return palette.map(e => ({ ...e })); }
/** The tools on the palette, in order — ids, and a duplicate counts twice. */
function tools() { return palIds().filter(isToolTile); }
function inPalette(id) { return posOf(id) >= 0; }
function _savePalette() { try { localStorage.setItem(LS_PALETTE, JSON.stringify(palette)); } catch (_) {} }
/** Drop what is not placeable, cap the length, and make every verb one its
 *  kind allows. NOT deduped any more (§ 4): the same tool in two verbs is two
 *  entries, and the mockup's two pin tiles are the case that pays for it. */
function _sanitizePalette() {
  palette = palette
    .filter(e => e && paletteKind(e.id))
    .map(e => ({ id: e.id, verb: verbAllowed(e.id, e.verb) ? e.verb : defaultVerb(e.id) }))
    .slice(0, PALETTE_MAX);
}
/** Set the verb at a position. Refused for a verb the kind does not allow. */
export function setVerbAt(i, verb) {
  const e = palAt(i);
  if (!e || !verbAllowed(e.id, verb) || e.verb === verb) return false;
  // A momentary cannot sit under a TAP: a tap is a bang with no up edge, so
  // it would fire 127 with no 0 and latch the tile on for ever. midi.js
  // `_learnGesture` refuses the pairing from the learn side; the strip's
  // right-click skips it; and the MODEL refuses it here, so no third door
  // can slip it through (palette-audit § H).
  if (verb === 'momentary' && (S._bindingsOf?.(`palette_${i + 1}`) ?? []).some(b => b.g === 'tap')) return false;
  e.verb = verb; _savePalette();
  render();
  if (propsOpen()) renderProps();
  return true;
}
/** PLACE a tile at position index `at`, in its kind's default verb (§ 4). A
 *  NEW entry every time — the same tool may sit on the strip twice, in two
 *  verbs, which is two drags and two settings — so this no longer moves an
 *  entry that is already there; `moveEntry` does that. */
export function placeTile(id, at, verb) {
  if (!paletteKind(id) || palette.length >= PALETTE_MAX) return false;
  const v = verbAllowed(id, verb) ? verb : defaultVerb(id);
  const i = Math.max(0, Math.min(palette.length, at ?? palette.length));
  const from = palette.map((_, n) => n); from.splice(i, 0, -1);
  palette.splice(i, 0, { id, verb: v });
  _savePalette();
  S._paletteReordered?.(from);
  render();
  return true;
}
/** MOVE the entry at `from` to position index `at`, carrying its verb. `at`
 *  counts positions in the list WITHOUT the moved tile, so dropping a tile on
 *  itself or its own gap is a no-op rather than a shift. */
export function moveEntry(from, at) {
  const e = palAt(from); if (!e) return false;
  const next = palette.filter((_, i) => i !== from);
  const i = Math.max(0, Math.min(next.length, at ?? next.length));
  next.splice(i, 0, e);
  if (next.every((x, n) => x === palette[n])) return false;
  const origin = next.map(x => palette.indexOf(x));
  palette = next; _savePalette();
  S._paletteReordered?.(origin);
  render();
  return true;
}
/** Take the entry AT a position off the strip. */
export function removeAt(i) {
  if (!palAt(i)) return false;
  const from = palette.map((_, n) => n).filter(n => n !== i);
  palette.splice(i, 1); _savePalette();
  S._paletteReordered?.(from);
  render();
  return true;
}
/** Take `id` off the palette. The last tool used to be pinned there — a
 *  palette with nothing to arm had nothing for space to do — and both halves
 *  of that reason are gone. */
export function removeFromPalette(id) {
  const i = posOf(id);
  if (i < 0) return false;
  return removeAt(i);
}
function isEraseTile(id) { return tileDef(id)?.kind === 'edit'; }

// ── The pin pair (#252) ────────────────────────────────────────────────────
// The palette's second section: UNPIN and PIN on `-` and `=`, the two keys next
// to the digits. They are NOT tools — they deposit nothing and they do not
// join the Tab cycle — so they sit in their own bed and carry their own keys.
//
// They used to point at a GROUP, named in their label and cycled with ⇧Tab,
// with `Q W E` addressing the three groups directly. All of that went on
// 2026-08-30: pinned material groups by what it IS, clouds and loops, so
// there is nothing to aim. One gesture, two keys, no state to read before
// pressing them.

// `sel`, the ARMED tile, was here until 2026-09-11; `inHand` (below) is the
// 2026-09-12 answer to the one question it used to answer that still exists
// — what does space play. What the DRAWER is about is `_optSel`: what the
// sheet is SHOWING, which ⇧Tab moves without touching the hand.
let _optSel = { kind: 'tool', id: 'pen' };  // what the options bar shows
// ── THE HAND (Ek, 2026-09-12) ─────────────────────────────────────────────
// "like any computer painting app, the tool rail has the tool. you should be
// able to pick the tool and have it 'in hand'. in hand just should mean what
// the spacebar or click does. that should be always the truth."
//
// The hand is ONE tool — a brush or an eraser — picked by a CLICK on its rail
// row or its strip tile, and played by the SPACEBAR and a LEFT-CLICK on the
// sphere: the two inputs reserved for it, learnable onto nothing else. Its
// verb is one global switch, `handVerb`, drawn as the spacebar plate under
// the strip (the tile's own two shapes). The palette tiles are QUICK ACCESS:
// each fires from its own key, button or note, in its own verb, and never
// touches what is in hand. `_held` (below) stays what is PLAYING, from either
// door; `inHand` is what space would play. The drawer follows the hand
// (pickHand). That replaces `lastFired`, which made the drawer follow whatever was
// fired last — a quick-access key moving the drawer off the tool you are
// working on was the wrong rule once there was a hand again.
const LS_HAND = 'mubone_hand', LS_HAND_VERB = 'mubone_hand_verb';
const HAND_POS = -1;          // `_held.i` while the hand plays — no position
let inHand = null;            // a tool id; set at boot, never null after
let handVerb = 'momentary';   // 'toggle' | 'momentary' — the spacebar's verb; momentary by factory (Ek, 2026-09-12, night)
try { const v = localStorage.getItem(LS_HAND_VERB); if (v === 'momentary' || v === 'toggle') handVerb = v; } catch (_) {}
export function inHandId() { return inHand; }
export function handVerbOf() { return handVerb; }
export function setHandVerb(v) {
  if (v !== 'toggle' && v !== 'momentary') return false;
  handVerb = v;
  try { localStorage.setItem(LS_HAND_VERB, v); } catch (_) {}
  render();
  return true;
}
/** PICK a tool into the hand. The one gesture that does it is a click — the
 *  rail row or the strip tile — and the drawer follows the pick (Photoshop's
 *  options bar, through pickTile). Placing on the strip is still a drag. */
export function pickHand(id) {
  const t = tileById(id);
  if (!t || t.ghost || !isToolTile(id)) return false;
  inHand = id;
  try { localStorage.setItem(LS_HAND, id); } catch (_) {}
  pickTile(id);
  return true;
}
// A digit held on the keyboard. It came back on 2026-09-11 evening with the
// VERB: a digit carries both edges now, because the tile decides what they
// mean — a momentary tile plays from the down to the up, and without the up
// it would latch on for ever. A toggle and a bang ignore the release, which
// `_paletteFire` handles, so this only has to deliver it.
let _downHandKey = false; // the spacebar is down
let _downHandMouse = false; // the sphere's left button is down

/** The toolbox shows EVERY tile, always (Ek, 2026-08-28) — it is the
 *  library, not the leftovers. The palette HOLDS tools the library still
 *  lists, so a tile can be on screen TWICE, and anything that touches a
 *  tile's element has to touch both (see tileEls). */
function boxIds() { return order.filter(id => tileDef(id) && engineOf(id) !== 'lens'); }
function _saveOrder() { try { localStorage.setItem(LS_ORDER, JSON.stringify(order)); } catch (_) {} }

// Every custom tile wears G.custom, the spark, whatever its engine. The key
// was `loop` until 2026-09-10 — the engine's old name — which meant the tape
// `+` minted a tile with no kind (found by the § K audit the day the `+`
// moved onto the titles); stored customs with `engine: 'loop'` are migrated
// once in initTiles.
const ENGINE_TILE = {   // how a custom tile of each engine presents + behaves
  granular: { kind: 'brush', g: 'custom', c: '#d4b06a' },
  tape:     { kind: 'brush', g: 'custom', c: '#e08cb0' },
  erase:    { kind: 'edit',  g: 'custom', c: '#e57373' },
  // A lens is a preset too — `lensTap` already calls `applyTileParams`, which
  // is per-lens memory. What a custom one is NOT is a tool: space cannot fire
  // it, so it never joins the palette and never enters the toolbox (#283). It
  // lives in the lens group after wide and spot.
  lens:     { kind: 'lens',  g: 'custom', c: '#7abcbc' },
};
/** Custom lenses, in creation order — the lens bar's tail. */
function customLensIds() {
  return order.filter(id => _tileCfg[id]?.custom?.engine === 'lens');
}
function tileDef(id) {
  if (_gone.has(id)) return null;
  if (TILE_DEFS[id]) return TILE_DEFS[id];
  const c = _tileCfg[id]?.custom;
  if (!c) return null;
  return { ...ENGINE_TILE[c.engine], label: c.label,
           foot: `Your tool — a preset of the ${c.engine} engine. Double-click its name in the rail to rename it.`,
           custom: true, engine: c.engine };
}
function tileAt(i) { const d = tileDef(order[i]); return d ? { id: order[i], ...d } : null; }
/** A tile by id — the addressing the palette/box split needs. */
function tileById(id) { const d = tileDef(id); return d ? { id, ...d } : null; }
/** EVERY element drawing this tile. A tool on the palette is also in the
 *  toolbox, so a class set on one copy and not the other is a tile that
 *  lights up in one place and not the other. */
function tileEls(id) {
  return document.querySelectorAll(`#paletteDock [data-tile="${id}"], #toolRail [data-tile="${id}"]`);
}
/** Which tile the properties sheet is CURRENTLY about — the one a knob writes
 *  into. One function, because there was briefly two answers and they
 *  disagreed (Ek, 2026-08-29): rendering keyed on one state while capture
 *  resolved another, so a knob on one sheet wrote into a different tile.
 *  Every question about "the open tile" comes here. It read `sel` for a tool
 *  until arming went; `_optSel` was already carrying the answer. */
function sheetTileId() { return _optSel.id; }

/** engine id → its hue, resolved from the --eng-* properties in style.css.
 *
 *  Hoisted to module scope 2026-08-29 because the CURSOR needs it too (it
 *  wears the hue of whatever is playing), and the mapping is not the identity: the
 *  engine is `granular` and the property is `--eng-grain` (#257). A second
 *  copy of that table in the renderer would have been a drift hazard of
 *  exactly the kind this file keeps finding — so there is one table, and
 *  everything reads it. */
let _engHueTable = null, _engHueDark = null;
function _engineHueTable() {
  if (_engHueTable && _engHueDark === S.darkMode) return _engHueTable;
  const cs = getComputedStyle(document.body);
  const hue = k => cs.getPropertyValue('--eng-' + k).trim() || '#8a9090';
  _engHueTable = { tape: hue('tape'), erase: hue('erase'), granular: hue('grain'),
                   lens: hue('lens'), source: hue('source'), pins: hue('pins'), none: hue('none') };
  _engHueDark = S.darkMode;
  return _engHueTable;
}

/** The HAND's hue, published for the cursor. Null between presses: nothing is
 *  in the hand then, so the cursor wears no engine colour — which is the
 *  visible half of "arming is gone" (2026-09-11). `S._armedEngine` and
 *  `S._armedIsErase` were published beside it and read by nobody; they went
 *  with `sel`. */
function _publishHandHue() {
  const t = tileById(handTileId());
  const eng = t ? engineOf(t.id) : null;
  S._handHue = eng ? (_engineHueTable()[eng] ?? _engineHueTable().none) : null;
}

/** The tile the properties sheet is about — what the engine page, the wet
 *  switch and the auto dry monitor ask for. It was the armed tile until
 *  2026-09-11. */
export function selectedTile() { return tileById(sheetTileId()); }

/** POINT THE DRAWER at a tool. The `⋯` does this alone; a click on a row or
 *  a strip tile does it THROUGH pickHand, which also takes the tool in hand
 *  (2026-09-12). It is also where a minted tool lands and where a deleted
 *  tool's neighbour is picked up from.
 *
 *  It does not place the tool on the palette: the rule that a clicked tool
 *  joined the strip existed to keep the armed tool visible on it, and placing
 *  is drag alone. */
function pickTile(id) {
  const t = tileById(id);
  if (!t || t.ghost || !isToolTile(id)) return false;
  _optSel = { kind: 'tool', id };
  // The sheet's tile OWNS the live block: renderProps draws the live controls
  // and `_pollLiveBlock` captures them back into sheetTileId(), so a pick that
  // did not apply would show the last tile's numbers and write them into this
  // one. It is NOT the hand — the press applies the whole character again
  // (_applyHand) and the cursor stays unhued until it does.
  applyTileParams(id);
  // An open drawer FOLLOWS the pick (Photoshop's options bar): it never opens
  // on its own, but if it is up it shows the tool you just picked.
  if (document.body.classList.contains('prail-open')) _propRow = id;
  render();
  return true;
}

/** The whole of "this tool is in the cursor": its brush character (what the
 *  gesture records) and its preset. The press that starts a play applies it;
 *  nothing applies it between presses, because nothing is in the hand then. */
function _applyHand(t) {
  if (t.kind === 'brush') _applyBrushCharacter(t);
  applyTileParams(t.id);
  _publishHandHue();
}

/**
 * A brush tile's whole predetermined character, applied on selection — the
 * brushKey (what the main button deposits, brush.js `_toolDown`) plus the experimental contract
 * flags. Selecting IS the control; nothing here reads the gesture.
 */
function _applyBrushCharacter(t) {
  S.brushFx = ['spray', 'match', 'comb', 'staff', 'slice'].includes(t.id) ? t.id : 'none';
  if (engineOf(t.id) === 'tape') setBrush('tape');
  else setBrush('grain');   // pen, wash, spray, comb, staff, match — all granular
  return true;
}

// ── Playing a position ──────────────────────────────────────────────────────
// This is the ONLY way a stroke starts (2026-09-11). Press = the position's
// tool takes the cursor and the gesture funnel is pressed with it in the hand
// (brush.js gesturePress); when that gesture ends, the hand is EMPTY again.
// It used to hand the cursor back to the armed tool — there is no armed tool,
// so there is nothing to hand it back to, and `_held` is the whole of the
// hand. One play at a time, whichever of the keyboard, the ACTIONS table or a
// pedal started it.
//
// Toggle or momentary is the BINDING's (Ek, 2026-09-09, and 2026-09-11: "a
// position can still have toggle and momentary, just not arm"): under toggle
// the key-up and the wire's 0 do nothing, and the SAME position pressed again
// ends it. `_held.latched` records which kind this one is. The tile stays lit
// until it ends.

let _held = null;   // { i, id, latched } while a tool is held, from any source

function slotDown(i, momentary = true) { _playDown(i, idAt(i), momentary); }
/** A play from either door: a strip POSITION (`i` ≥ 0, its tile) or the HAND
 *  (`i` = HAND_POS, the tool in hand). */
function _playDown(i, id, momentary) {
  const t = isToolTile(id) ? tileById(id) : null;
  if (!t) return;
  if (_held) { if (_held.latched && _held.i === i) slotEnd(i); return; }
  if (S._gestureActive?.()) return;   // another wire already has the hand
  _held = { i, id, latched: false };
  // A tile is a preset, and the press is what applies it — nothing did
  // between presses, because nothing was in the hand. Under a grain filter it
  // changes the hand, not the glass (#292).
  _applyHand(t);
  // THE HUE THE MARKS ARE PAINTED IN, for as long as this play runs. The
  // playing tile's engine, not the hand's: a palette key can fire a position
  // without the hand ever holding it (2026-09-13). state.js livePaintColor().
  S._paintHue = _engineHueTable()[engineOf(id)] ?? null;
  _lightHeld();
  // The tool in the hand is now this position's (handTileId), so the funnel
  // starts an erase for an eraser and a stroke for a brush. Toggle or
  // momentary is the binding's, not a mode.
  S._gesturePress?.(momentary);
  if (_held) _held.latched = !!S._gestureLatched?.();
}

/** The up edge from a key or the wire: ends a momentary hold, nothing to a
 *  latched one. */
function slotUp(i) {
  if (_held && _held.i === i && !_held.latched) slotEnd(i);
}

/** End this position's play, however it started — the gesture ends through
 *  the funnel, and `_gestureChanged` empties the hand. */
function slotEnd(i) {
  if (!_held || _held.i !== i) return;
  if (!S._gestureActive?.()) { _releaseHeld(); return; }
  if (_held.latched) S._gesturePress?.(); else S._gestureRelease?.();
}

function _releaseHeld() {
  const h = _held;
  if (!h) return;
  S._paintHue = null;
  _held = null;
  document.querySelector(`#paletteDock .tile[data-pos="${h.i}"]`)?.classList.remove('playing');
  document.querySelector(`#toolRail [data-tile="${h.id}"]`)?.classList.remove('playing');
  if (h.i === HAND_POS) document.getElementById('handKey')?.classList.remove('playing');
  // The hand is empty again. The tool's brush character and block stay where
  // the press left them — nothing reads them until the next press, which
  // re-applies whatever it wants — but the CURSOR must stop wearing the hue,
  // because that is what says a tool is playing.
  _publishHandHue();
}

// The funnel's edge, both ways. A play whose gesture ended elsewhere — the
// trace mode changed under it, handsfree disarmed, the eraser's long press
// erased all — empties the hand here rather than staying lit.
S._gestureChanged = () => {
  if (_held && !S._gestureActive?.()) _releaseHeld();
  refreshPlayingState();
};

// ── PLAYING THE HAND — the spacebar and the sphere's click ─────────────────
// Both edges, like a position's. The verb is the hand's own (`handVerb`),
// not a tile's: a momentary plays from the down to the up, a toggle from one
// down to the next. `momentary` can be forced — a phone's touch has no verb
// switch to read (mobile.js). One play at a time, whichever door started it;
// the hand's own second press ends its toggle play, as a position's does.
function handDown(momentary = handVerb === 'momentary') {
  const id = inHand;
  if (!id || !tileById(id)) return;
  if (_held) { if (_held.latched && _held.i === HAND_POS) slotEnd(HAND_POS); return; }
  _playDown(HAND_POS, id, momentary);
}
function handUp() { slotUp(HAND_POS); }
S._handDown = handDown;
S._handUp   = handUp;

// ── Installing a lens ──────────────────────────────────────────────────────
// Writes go through the real controls (setComposerMode, toggleNearestMode,
// the scan button) so every old binding stays in sync; the tiles re-derive.

/** A lens tile or row tapped. A lens is a STATE (Ek, 2026-09-11): tapping
 *  the one that is on turns it off — no lens on, the cursor reads nothing,
 *  which is the cap — and tapping any other installs it and turns reading
 *  back on. Writes go through the real controls (the scan button) so every
 *  old binding stays in sync; the tiles re-derive. */
async function lensTap(id) {
  if (!isLensTile(id)) return;
  if (id === _lensSel && !S.scanMuted) {
    // Off.
    document.getElementById('scanBtn')?.click();
    render();
    return;
  }
  _lensSel = id;
  applyTileParams(id);   // a lens is a preset too — per-lens memory
  if (S.scanMuted) document.getElementById('scanBtn')?.click();
  // Installing does not open the drawer (Ek, 2026-09-03): a click chooses,
  // and ⇧Tab or the ⋯ on the row opens the page. An open drawer FOLLOWS the
  // choice, though — the sheet is up, so it shows the lens you just put on.
  // Otherwise the options selection stays on the hand, so the sheet keeps
  // showing the tool when it is next opened by Tab.
  if (document.body.classList.contains('prail-open')) {
    _optSel = { kind: 'lens', id }; _propRow = id;
    render(); renderProps();
  } else render();
}
/** A lens held (activate (momentary) on its position): on while down, and
 *  the up edge puts back whatever was on before — another lens, or none. */
let _lensHeld = null;   // { id, prevSel, prevMuted } while a lens is held
function _lensMomentary(id, down) {
  if (down) {
    if (_lensHeld || !isLensTile(id)) return;
    _lensHeld = { id, prevSel: _lensSel, prevMuted: !!S.scanMuted };
    if (!(id === _lensSel && !S.scanMuted)) lensTap(id);
  } else {
    const h = _lensHeld; if (!h || h.id !== id) return;
    _lensHeld = null;
    if (h.prevMuted) { if (!S.scanMuted) { document.getElementById('scanBtn')?.click(); render(); } }
    else if (h.prevSel !== id) lensTap(h.prevSel);
  }
}

/** Every installable lens, in rail order: factory, then yours. */
function lensAll() { return LENSES.filter(l => !_gone.has(l.id)).map(l => l.id).concat(customLensIds()); }

/** LIT means sounding, and only the tile that is PLAYING is lit. There is no
 *  idle mark on any tile any more: the box that said "armed" went with
 *  arming, so `playing` is the only class the strip carries.
 *
 *  slotDown lights the tile, but any render() in between (a lens turned on,
 *  a binding saved) rebuilds the strip and drops the class — so it is
 *  re-asserted here. Polled at 30 Hz from initTiles: at the layout's 5 Hz a
 *  press showed up to 200 ms late, which on an instrument reads as "the tile
 *  does not light". */
export function refreshPlayingState() { _lightHeld(); }
/** Light what is playing: the strip tile BY POSITION (the same tool may sit
 *  on the strip twice in two verbs, and lighting both would say the wrong one
 *  is sounding), the rail row by id (there is one), and the spacebar plate
 *  when the play is the HAND's — a quick-access play of the in-hand tool
 *  lights its row and its tile, never the plate. */
function _lightHeld() {
  // An OPEN PIN PATH is re-asserted here for the same reason a play is: any
  // render() rebuilds the strip and drops the class, and a held pin would go
  // dark mid-path on a binding change or a lens toggle (2026-09-13).
  if (_pinPathOpen) _pinLit('pin', true);
  if (!_held) return;
  document.querySelector(`#paletteDock .tile[data-pos="${_held.i}"]`)?.classList.add('playing');
  document.querySelector(`#toolRail [data-tile="${_held.id}"]`)?.classList.add('playing');
  if (_held.i === HAND_POS) document.getElementById('handKey')?.classList.add('playing');
}

/** Cheap class sync, called from the layout's 5 Hz tick; never rebuilds the
 *  row. Selection is stored, so the only flag followed is composerMode —
 *  ⇧K enters and leaves arrange from outside the tiles. N flipping
 *  nearestMode deliberately does NOT move the highlight any more: the
 *  installed lens just carries the flipped mode as a session edit. */
export function refreshLensStates() {
  // The rail's lens rows AND the palette's lens tiles — every one says
  // whether it is the lens that is on, so all follow the flags. On means
  // installed AND reading: under the cap (no lens on) every lens is off.
  const inst = installedLens();
  document.querySelectorAll('#lensBar [data-lens], #paletteDock .tile--lens[data-lens]').forEach(el => {
    const on = el.dataset.lens === inst && !S.scanMuted;
    // Tile and row both light with `on` — the class render() writes. The row's
    // was `armed` until 2026-09-11; a lens is not armed, it is ON, and the
    // word left the vocabulary with arming itself.
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', String(on));
  });
}

/** A lens's name, factory or yours. */
function lensLabel(id) { return LENSES.find(l => l.id === id)?.label ?? tileDef(id)?.label ?? id; }
const lensTileTitle = (label, verb) => `${label} · lens · ${verb === 'momentary' ? 'on while its key is down' : 'fires on / off'} — no lens on, the cursor reads nothing; the ⋯ on its rail row is its drawer`;

// ── The hold gesture — Q W E file material into a layer ─────────────────────
// § 1c through today's engine: on granular material the layer key runs the
// cloud draw path (startSeedPlant on press, finalizeSeedPlant on release —
// tap = stationary, held = a recorded path, exactly the mockup semantics); on
// trigger material it drops a loop from the nearest stroke. The new slot is
// then tagged with the pressed layer's id, which is all "filing into a
// layer" means (#207).
//
// ── 1+Q: the growing loop ──────────────────────────────────────────────────
// Pressing a layer key WHILE PAINTING A LINE is the looper-pedal gesture
// (BRUSH-MODEL § 3c v3b): the stroke-so-far starts looping immediately and
// keeps growing with the stroke. The #209 worklet carries the DSP (the wrap
// rule, the seam crossfade — see its header); this wiring adds the two ends:
//   press — the main-thread recording [0, now) is PRELOADED into the worklet
//           so the loop covers the stroke from its start (§ 1c), and the
//           worklet records on from live input;
//   close — releasing Q freezes growth at the stroke-so-far; the stroke
//           ending (digit up) HANDS the hold OVER to a normal loop slot
//           built from the finalized buffer, tagged with the layer, while
//           the worklet fades out. If Q closed early, the slot's loopEnd is
//           trimmed to the close point — that wrap lands before the baked
//           seam crossfade, a small click accepted until buildLoopPayload
//           learns regions (noted in TODO #216).
// The armed trigger the stroke also becomes is not a doubling bug: the
// stroke stays scratch (touch it and it fires), the hold sounds on its own.

let _liveHold = null;   // { ll, strokeId, closedAt } while a pin hold runs

async function _startLiveHold() {
  const { createLiveLoop } = await import('./live-loop.js');
  const ll = await createLiveLoop({ minLoopS: 0.5, xfadeS: 0.030 });
  // Snapshot the stroke-so-far. Copy — recordingRaw is the reusable pool and
  // the transfer to the worklet must never detach it.
  const n = S.recordingWritePos | 0;
  if (n > 0 && S.recordingRaw) ll.preload(new Float32Array(S.recordingRaw.subarray(0, n)));
  ll.record();
  ll.loop();
  _liveHold = { ll, strokeId: S.currentStrokeId, closedAt: null };
  // The stroke can end from the digit key, but also from a pad, a pedal or
  // OSC — a position is one act with many bindings. Watch for the end rather
  // than assuming which gesture delivers it.
  const watch = setInterval(() => {
    if (!_liveHold || _liveHold.ll !== ll) { clearInterval(watch); return; }
    if (!S.isPainting) { clearInterval(watch); _finishLiveHold(); }
  }, 120);
}

/** The stroke ended — build the real slot and retire the worklet. Runs a
 *  beat later so stopLiveRecording has finalized the buffer that
 *  createSeqFromStroke reads. */
function _finishLiveHold() {
  const h = _liveHold;
  _liveHold = null;
  if (!h) return;
  setTimeout(async () => {
    try {
      const UP = await import('./ui-presets.js');
      const before = S.commitSlots.slice();
      UP.createSeqFromStroke(h.strokeId);
      for (let i = 0; i < S.commitSlots.length; i++) {
        if (S.commitSlots[i] && S.commitSlots[i] !== before[i]) {
          const slot = S.commitSlots[i];
          if (h.closedAt != null && h.closedAt > 0.05 && h.closedAt < slot.loopEnd) {
            slot.loopEnd = h.closedAt;
          }
          S._pinsDirty = true;
          break;
        }
      }
    } finally {
      // The slot opens with its own declick ramp; overlap the worklet's 3 ms
      // fade under it rather than gapping.
      h.ll.stop();
      setTimeout(() => h.ll.dispose(), 150);
    }
  }, 60);
}

async function pinDown() {
  const UP = await import('./ui-presets.js');

  // Painting a line right now: the growing loop.
  if (S.isPainting && S._recordingTrigger && !_liveHold) {
    await _startLiveHold();
    return;
  }

  // What is the cursor on? Nearest particle decides granular vs trigger.
  // The type test is coarse (1.5× the radius) and the drop is strict (the
  // radius itself), so between the two the drop finds nothing — and until
  // 2026-09-12 that was a press that did NOTHING: no loop, and no ghost
  // either, measured as a band from ~100 to ~130 px out from a take where
  // nearer pinned the loop and farther pinned a cloud. The drop now says
  // whether it pinned, and a press it declines falls through to the ghost.
  const near = _nearestParticle();
  if (near && near.trig && UP.dropSeqFromCursor()) {
    S._pinsDirty = true;
    return;
  }
  // Nothing in reach is NOT a no-op: the press still pins a cloud at the
  // cursor — a GHOST PIN (Ek, 2026-08-28). Pin the place first, paint scratch
  // into it later, and it keeps sounding: a cloud stores a place and re-reads
  // S.particles every tick. Ghosts are cloud-only by nature — a cloud is a
  // place that reads, a loop is a recording that plays, and with no stroke
  // there is nothing to record.
  UP.startSeedPlant();
  S._pinPlantPending = true;
}

async function pinUp() {
  // The pin key released first — growth freezes at the stroke-so-far. The
  // whole stroke keeps recording; the handover happens when the stroke ends.
  if (_liveHold) {
    if (S.isPainting) {
      const { getRecordingDuration } = await import('./audio.js');
      _liveHold.closedAt = getRecordingDuration();
      _liveHold.ll.close();
    } else {
      _finishLiveHold();
    }
    return;
  }
  if (!S._pinPlantPending) return;
  S._pinPlantPending = false;
  const UP = await import('./ui-presets.js');
  UP.finalizeSeedPlant();
  S._pinsDirty = true;
}

function _nearestParticle() {
  const lon = S._frameCursorLon ?? 0, lat = S._frameCursorLat ?? 0;
  const rad = S.searchRadiusDeg * Math.PI / 180;
  let best = null, bd = Infinity;
  for (const p of S.particles) {
    if (p.strokeId == null || p.strokeId < 0) continue;
    const dLon = (p.lon - lon), dLat = (p.lat - lat);
    const d = Math.hypot(dLon, dLat);            // coarse — only picks a type
    if (d < bd) { bd = d; best = p; }
  }
  return bd < rad * 1.5 ? best : null;
}

/** `-` — unpin the SELECTED pin (#238), through the real release path. Which
 *  one is selected — nearest, farthest or oldest — is Settings → Pins, and
 *  this used to bypass it with a nearest-only search of its own while the
 *  action, OSC and the buttons honoured it (Ek, 2026-09-10: "unpin does the
 *  version of whatever the setting is"). One path now. */
async function unpinSelected() {
  const UP = await import('./ui-presets.js');
  UP.releaseCommit();
}

// ── The looper tile (#237) ──────────────────────────────────────────────────
// armTrigger fires this hook at the end of EVERY trigger-stroke release —
// digit, pad or pedal, a position is one act with many bindings. With the
// looper tile playing, the stroke that just armed also becomes a loop slot
// at once: record, and it repeats. It is a loop, so it joins the loops group
// by being one — there is nothing to file. The 60 ms beat matches
// _finishLiveHold: stopLiveRecording must finalize the buffer
// createSeqFromStroke reads. The armed trigger is not a doubling bug — the
// stroke stays scratch (touch it and it fires), the loop sounds on its own;
// the same rule as the pin hold.
// `loop` is the overdub brush SEEDING (Ek, 2026-09-06): with nothing pinned
// its first take is the main loop — this hook pins it, whatever the tile's
// own `on end` says — and the next press overdubs onto it.
S._onTriggerStrokeArmed = (strokeId, { loop = false } = {}) => {
  if (!S.triggerParams.loopOnEnd && !loop) return;   // the contract, not the tile id (#244)
  setTimeout(async () => {
    try {
      const UP = await import('./ui-presets.js');
      // The loop starting IS the playback you hear on release — the trigger
      // audition doubling it for one pass reads as a glitch, so it goes.
      const TR = await import('./trigger.js');
      const audT = S.triggers?.find(x => x.strokeId === strokeId);
      if (audT?.playing) TR.stopTriggerAudio(audT, 'immediate', 0.02);
      const before = S.commitSlots.slice();
      UP.createSeqFromStroke(strokeId);
      // Stamp the BAKED half (#240) onto the new slot: the looper commits
      // the tile's dials as they stood when the stroke was drawn.
      for (let i = 0; i < S.commitSlots.length; i++) {
        const slot = S.commitSlots[i];
        if (slot && slot !== before[i]) {
          slot.speed  = S.triggerParams.speed ?? slot.speed;
          slot.grainParams.volume = S.triggerParams.volume ?? slot.grainParams.volume;
          slot.passes = S.triggerParams.passes | 0;
          break;
        }
      }
      S._pinsDirty = true;
    } catch (e) { console.warn('[looper] commit failed:', e); }
  }, 60);
};


// ── Keymap ──────────────────────────────────────────────────────────────────
// Capture phase, so the older panel-era keymaps never see keys the tiles own.


// A key belongs to whoever is TYPING, not to whatever last took focus: a
// range slider, a checkbox or a button keeps focus after the pointer leaves
// it, and none of them takes a digit. Until 2026-09-12 a drag on the footer's
// IN slider left every palette key dead until a tile was clicked (Ek).
const _NOT_TYPING = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file']);
function _typing(e) {
  const el = e.target, t = (el.tagName || '').toLowerCase();
  if (t === 'input') return !_NOT_TYPING.has((el.type || 'text').toLowerCase());
  return t === 'textarea' || t === 'select' || !!el.isContentEditable;
}

function onKeydown(e) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || _typing(e)) return;
  // The keys page is listening for a key to learn: every key is its.
  if (S._isKeyLearning?.()) return;
  // Tab used to be handed back to the browser while the filter was on
  // ("edit owns the screen"). That was fair when it was a momentary state;
  // it is a LENS now and stays installed all session, so the guard silently
  // turned Tab into native focus traversal and it crawled the tool rail
  // instead of doing its job (#288). Tab is always swallowed — see below.
  // Esc hides the properties panel, and that is ALL it does to a grain filter
  // (#292). It used to take the filter off, from when nothing could be played
  // under one; now that you can paint through a filter, hiding the sheet to
  // get at the sphere is the common gesture and losing the glass to it would
  // be maddening. The filter comes off by its own row, its `take off` button,
  // or the lens dock. It can never be on invisibly: the chrome's tools pill
  // carries the filtering mark — see refreshLensStates.
  // Esc closes exactly ONE thing, so it stops propagating. It used to defer to
  // the first-run overlay, which advertised Esc itself; that overlay is gone.
  if (e.code === 'Escape') {
    // A learn armed from a tile's legend row is the innermost thing of all.
    if (S._paletteLearning?.()) { e.preventDefault(); e.stopPropagation(); S._paletteLearnCancel?.(); return; }
    // Innermost first: the properties rail, then the tool rail. Closing the
    // list while its device view stayed up left an orphaned panel.
    if (document.body.classList.contains('prail-open')) {
      e.preventDefault(); e.stopPropagation(); closeProps(); return;
    }
    if (propsOpen()) { e.preventDefault(); e.stopPropagation(); setPropsOpen(false); return; }
  }

  // Q, W, E, ⇧Q/W/E and ⇧Tab are FREE KEYS (2026-08-30). They addressed the
  // named pin groups — which group a gesture filed into, which group the pair
  // was pointed at — and pins do not have named groups any more: a pin is a
  // cloud or a loop and that is the whole of it. There is one pin gesture, on
  // `=` / `-`, so there is nothing left for those five bindings to say.
  //
  // TAB SHOWS AND HIDES THE TOOL RAIL, and nothing else (Ek, 2026-09-12,
  // night: "tab should only open the tool rail, never the drawer") — shifted
  // or not. The drawer's only doors are the ⋯ on a row and the pin tile's
  // press. Tab opened the in-hand tool's drawer for one evening, followed the
  // last tile fired for a day before that, and cycled the palette before
  // that (Ek, 2026-09-03). The browser's own focus walk would otherwise crawl
  // the chrome pills, so it is swallowed here; Tab is already unbindable in
  // the mapping table. `~` is the same act (events.js), the tools pill's key.
  // ⇧Tab is the PINNED rail's (Ek, 2026-09-12: "for the right, let's make it
  // shift tab to open and close the pin"); tile-layout.js owns that rail.
  if (e.code === 'Tab') {
    e.preventDefault(); e.stopPropagation();
    if (e.shiftKey) S._togglePinnedRail?.(); else toggleRail();
    return;
  }
  // THE SPACEBAR IS THE HAND'S (Ek, 2026-09-12: "spacebar and left click are
  // not key binding options since those are reserved for the in-hand tool").
  // midi.js refuses to learn it and drops any stored binding on it, so this
  // is the only thing space does. Both edges — onKeyup has the up.
  if (e.code === 'Space' && !e.shiftKey) {
    e.preventDefault(); e.stopPropagation();
    if (_downHandKey) return;
    _downHandKey = true;
    handDown();
    return;
  }
  // `=` and `-` no longer pin and unpin (Ek, 2026-09-12, night: "palette is
  // whole truth"): the pin tiles' own keys are the only ones, read off the
  // strip. They were hard-wired here from 2026-09-10, unshown once the pin
  // rows lost their caps, and `-` shadowed the sweep key underneath.
  // The palette's keys: the digits PLAY by position (Ek, 2026-09-04, and the
  // press is a play rather than an arm since 2026-09-11). `N` does that
  // position's primary act — a tool plays (toggle), a lens goes on or off, a
  // pin tile fires. These are the factory keys of the palette_* actions, so
  // the keys page can move them: a learned key on this code, or a relearned
  // palette action, takes the digit away and events.js dispatches the
  // binding instead.
  //
  // ONE PLAY AT A TIME (Ek, 2026-09-04): while a tool is playing, the other
  // tool keys are dead — the live one is the playing position's OWN, whose
  // second press ends it, and slotDown holds that rule. A lens or pin key
  // stays live: it is the eye's, not the hand's.
  // The digits are not read here (2026-09-12): every palette key, the
  // factory digits included, is an explicit row in the key map that
  // events.js dispatches like any learned key — and that row follows its tile
  // when the strip is rearranged (midi.js S._paletteReordered).
}
/** Attribute- and text-safe. The legend prints a learned key's own name, which
 *  can be any character the keyboard produces. */
function esc(v) { return String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ── THE LEGEND (docs/PALETTE-GUI.md § 6) ───────────────────────────────────
// One line under the tile, centred, inside the cell: `source gesture? delay?`
// per bound input, and a tile may carry several — exclusivity is one VERB per
// tile, not one input, so `Q long` and `btn 1 long` sit side by side and the
// legend does not care which is which.
//
// BLANK MEANS PRESS. `GESTURE_LABEL.press` is already the empty string, so the
// drawing and the code agree with no translation table. The one abbreviation
// is `extra long` → `xlong`, and § 6 rules that it lives HERE and nowhere else.
const _GESTURE_SHORT = { 'extra long': 'xlong' };
// THE SPACEBAR IS DRAWN, NOT TYPED (§ 6). `␣` (U+2423) is not in
// fonts/Urbanist-latin.woff2 and renders from a fallback face at the wrong
// advance, which is the kind of thing that reads as a broken glyph behind an
// instrument. 15×6 stroke mark instead.
const SPACE_MARK = '<svg class="leg-space" viewBox="0 0 24 10" width="15" height="6" fill="none" aria-label="spacebar">' +
  '<path d="M2 2v5h20V2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
/** The palette tile's LEGEND — what fires position `n` today, not what the
 *  factory said (Ek, 2026-09-06). Re-read on every render; midi.js calls
 *  `S._bindingsChanged` on every save.
 *
 *  `html` is what the tile draws. `key` and `midi` are kept as plain text for
 *  the audits and the tooltips, which want the fact and not the markup. */
const _KIND_WORD = { key: 'key', button: 'button on the instrument', midi: 'MIDI note' };
/** The gesture inside the sticker (PALETTE-GUI § 11.5–11.6): a plain press
 *  has no suffix; tap · ×2 · ×3 are the app's own words at 9.5px; LONG and
 *  XLONG are drawn as a BAR, short and long — the words were what ran a
 *  button sticker past the tile. The ids are GESTURE_LABEL's keys. */
function _gestureHTML(g) {
  if (g === 'long' || g === 'xlong') return `<i class="leg-g leg-g--bar${g === 'xlong' ? ' leg-g--xlong' : ''}" title="${g === 'xlong' ? 'extra long' : 'long'}"></i>`;
  const raw = S._gestureLabel?.(g) ?? '';
  return raw ? `<i class="leg-g">${esc(raw)}</i>` : '';
}
/** The source, short enough for a sticker: the drawn spacebar; a key's glyph
 *  or its name cut to four characters (Ek, 2026-09-12: the full name is the
 *  tooltip's); a button's number; a note's number bare — the `n` went with
 *  the ledger, the hue says the kind. */
function _shortLabel(b) {
  if (b.space) return SPACE_MARK;
  const l = String(b.label ?? '');
  return esc(l.length > 4 ? l.slice(0, 4) : l);
}
/** THE BINDING STICKER (§ 11.4–11.6): ONE per bound position, of ONE kind —
 *  the kind the keys page shows, key · button · note — at the tile's
 *  bottom-left, the same disc as wet and pin; none when unbound. It is the
 *  keys page's learn cell brought to the tile: click to relearn, right-click
 *  to clear, and while learning it says `…`. `key` and `midi` stay complete
 *  whatever is drawn — they are the fact, for the tooltips. */
function paletteLegend(n) {
  const binds = S._bindingsOf?.(`palette_${n}`) ?? [];
  const kind = legendKind();
  const shown = binds.filter(b => b.kind === kind);
  const learning = S._paletteLearning?.() ?? null;
  const lrn = !!learning && learning.id === `palette_${n}` && learning.kind === kind;
  const tip = lrn ? `press the ${_KIND_WORD[kind]} to bind here — press, hold, ×2 … · Esc or click again cancels`
                  : `${shown.map(b => b.label + (b.g && b.g !== 'press' ? ' ' + (S._gestureLabel?.(b.g) ?? b.g) : '')).join(', ')} — click to relearn · right-click to clear`;
  // NO BINDING IS STILL A STICKER (Ek, 2026-09-12: "when i right click to
  // remove a binding from a palette tile, it should have a hyphen thru the
  // sticker but it just disappears so i have no way to bind a new key via
  // the palette tile"): the sticker is the learn cell, so an unbound tile
  // wears an empty one — a dash — and a click on it learns.
  const none = !lrn && !shown.length;
  const inner = lrn ? '…' : none ? '<span class="leg-none">–</span>' : shown.map(b => `<span class="leg leg--${b.kind}">${_shortLabel(b)}${_gestureHTML(b.g)}` +
    (b.delayed ? `<i class="leg-d" title="a ×2 or ×3 on the same input makes this tap wait the double window before it fires">···</i>` : '') + `</span>`).join('');
  const tipNone = `no ${_KIND_WORD[kind]} — click to learn one`;
  const html = `<span class="tile-binds"><kbd class="tile-bind tile-bind--${kind}${lrn ? ' learning' : ''}${none ? ' tile-bind--none' : ''}" data-learn-kind="${kind}" data-learn-pos="${n - 1}" title="${esc(none ? tipNone : tip)}">${inner}</kbd></span>`;
  const text = binds.map(b => [b.label, _GESTURE_SHORT[S._gestureLabel?.(b.g) ?? ''] ?? (S._gestureLabel?.(b.g) ?? ''), b.delayed ? '···' : ''].filter(Boolean).join(' '));
  return {
    html,
    key:  text.filter((_, i) => binds[i].kind === 'key').join(' · '),
    midi: text.filter((_, i) => binds[i].kind !== 'key').join(' · '),
  };
}
function onKeyup(e) {
  if (_downHandKey && e.code === 'Space') { _downHandKey = false; handUp(); }
}

// ── FIRING A POSITION — the one door (docs/PALETTE-GUI.md § 1) ──────────────
// `palette_1..9` from a key, a button, a pad, a pedal or OSC. Positions, not
// tiles: the palette IS what you see, so the wire counts what the player sees.
//
// THE VERB IS THE TILE'S, NOT THE CALLER'S. `S._paletteActivate` used to take
// a `momentary` argument and every position carried three actions for the
// caller to pick from; now the entry says how it fires and this reads it. What
// each verb means, per kind:
//
//            bang                momentary                 toggle
//   tool     —                   plays while down          plays until pressed again
//   lens     —                   on while down             on / off
//   pin      pin where you stand draws a path, down to up  opens the path, seals it
//   unpin    unpins              —                         —
//
// `down` is the edge. A BANG acts on the down and ignores the up — which is
// also why its ACTIONS row is a `trigger` and an explicit 0 does nothing (the
// O2 guard). A MOMENTARY's row is a `hold` and takes both edges. A TOGGLE's is
// a `trigger`: the flip is on the down, and the up is nothing.
//
// Guarded as the key handler is: one tool playing at a time, and a press on an
// empty position is a no-op.
let _downExternal = null;   // externally-held palette index, or null
let _pinPathOpen = false;   // a pin path is being drawn (toggle or momentary)
S._paletteFire = (i, down = true) => {
  const e = palAt(i); if (!e) return;
  const { id, verb } = e;
  const k = paletteKind(id); if (!k) return;
  // A fire moves nothing: the drawer follows the HAND (pickHand), and a
  // quick-access key must not pull it off the tool you are working on
  // (2026-09-12; it followed the last tile fired for a day).

  if (k === 'lens') {
    if (verb === 'momentary') _lensMomentary(id, down);
    else if (down) lensTap(id);                       // toggle: on / off
    return;
  }
  if (k === 'act') {
    if (id === 'unpinall') { if (down) { _pinFlash('unpinall'); document.getElementById('commitClearBtn')?.click(); } return; }
    if (id !== 'pin') { if (down) { _pinFlash('unpin'); unpinSelected(); } return; }
    // Pin in three verbs (Ek, 2026-09-11): a BANG pins where you stand; a
    // MOMENTARY draws a path from the down to the up; a TOGGLE opens the path
    // on one press and seals it on the next. One flag says whether a path is
    // open, whichever way it was opened.
    if (verb === 'bang') { if (down) { _pinFlash('pin'); S._pinTap(); } return; }
    if (verb === 'momentary') {
      if (down === _pinPathOpen) return;
      _pinPathOpen = down; _pinLit('pin', down); S._pinHold(down);
      return;
    }
    // A toggle holds the path open between two presses, so it is lit for that
    // whole time too — the flag is the same one either verb opens.
    if (down) { _pinPathOpen = !_pinPathOpen; _pinLit('pin', _pinPathOpen); S._pinHold(_pinPathOpen); }
    return;
  }

  // A TOOL. `_downExternal` is a physical down waiting for its up; a toggle
  // play has no up to wait for — it ends on the next press — so it must not
  // hold the position, and did, which refused the next momentary play.
  const momentary = verb === 'momentary';
  if (down) {
    if (_held) { if (_held.latched && _held.i === i) slotEnd(i); return; }
    if (_downExternal !== null) return;
    if (momentary) _downExternal = i;
    slotDown(i, momentary);
  } else if (_downExternal === i) {
    _downExternal = null;
    slotUp(i);
  }
};
// The digits and a click on an act tile come through here — the same door,
// down edge only. Kept as its own name because a tap genuinely has no up.
S._paletteTap = (i) => S._paletteFire(i, true);

/** THE VERB IN THE TILE'S OWN WORDS — what the keys page prints, what the
 *  tile's drawer segment is labelled with, and what the OSC tip says. One
 *  word per (kind, verb) pair, and a pair a kind does not allow is absent
 *  (`verbsOf` § 4 is the same table's other half). */
const VERB_WORDS = {
  tool:  { momentary: 'play (momentary)', toggle: 'play (toggle)' },
  lens:  { momentary: 'on while held',    toggle: 'on / off' },
  pin:   { bang: 'pin here', momentary: 'pin a path (momentary)', toggle: 'pin a path (toggle)' },
  unpin: { bang: 'unpin' },
  unpinall: { bang: 'unpin all' },
};
/** The short word for the drawer's segmented control — the verb alone. */
const VERB_SHORT = { bang: 'bang', momentary: 'momentary', toggle: 'toggle' };
function verbWord(id, verb) {
  const k = paletteKind(id); if (!k) return null;
  return VERB_WORDS[k === 'act' ? id : k]?.[verb] ?? null;
}
/** The keys page's row for position n (midi.js reads it through S): the
 *  tile's glyph, its name and its ONE verb in the tile's own words. An empty
 *  position is one row, blank, saying to drag a tile there (Ek, 2026-09-11:
 *  "the action title in the row should reflect the options available for the
 *  tile type. the tile tool (lens/brush/erase/etc) should not be in the
 *  title").
 *
 *  It took a `verb` argument until 2026-09-11 and answered three times per
 *  position, hiding the rows the kind had no verb for. A position has one
 *  verb now, so it answers once and nothing is hidden. */
S._paletteRow = (n) => {
  const e = palAt(n - 1);
  const k = e && paletteKind(e.id);
  if (!k) return { pos: n, name: 'empty', verb: '', glyph: null, hue: null, label: 'empty', enabled: false, hidden: false, why: `nothing is at position ${n} — drag a tile there` };
  const { id, verb } = e;
  const name = k === 'tool' ? tileDef(id).label : k === 'lens' ? lensLabel(id) : ACT_TILES[id].label;
  const glyph = k === 'tool' ? G[tileDef(id).g] : k === 'lens' ? (SCOPE_G[id] ?? G.custom) : G[ACT_TILES[id].g];
  const hue = k === 'act' ? null : (_engineHueTable()[engineOf(id)] ?? null);
  const w = verbWord(id, verb) ?? '';
  return { pos: n, name, verb: w, glyph, hue, label: w ? `${name} · ${w}` : name, enabled: true, hidden: false, why: '' };
};
/** The ACTIONS row's `type` for position n, which its verb decides: a
 *  momentary tile is a `hold` and takes both edges, everything else is a
 *  `trigger` and acts on the down. Read through a getter in midi.js, so a
 *  verb changed in a drawer is live on the next dispatch with nothing to
 *  invalidate. */
S._paletteType = (n) => verbAt(n - 1) === 'momentary' ? 'hold' : 'trigger';
/** The keys page's hover for position n — what the wire sends and what it does. */
S._paletteTip = (n) => {
  const e = palAt(n - 1);
  if (!e) return `nothing is at position ${n} — drag a tile onto the palette`;
  const w = verbWord(e.id, e.verb) ?? e.verb;
  return e.verb === 'momentary'
    ? `${w} — 1 starts it, 0 stops it. Position ${n}, whatever sits there`
    : `${w} — a bang. Position ${n}, whatever sits there`;
};

// "Tool keys fire" and the Main button's toggle/momentary switch were two
// settings here until 2026-09-09; both became bindings on the keys page, and
// the main button itself went on 2026-09-11 with arming. Their stored keys go
// on first load.
try { localStorage.removeItem('mubone_palette_trigger'); localStorage.removeItem('mubone_gesture_momentary'); } catch (_) {}

/** ONE binding kind on the strip at a time (PALETTE-GUI § 11.4): the keys
 *  page's segmented row chooses key · button · note; key is the factory. */
function legendKind() { return S._legendKind?.() ?? 'key'; }

// ── THE HAND TILE — what is in hand (Ek, 2026-09-12) ───────────────────────
// A TILE at the head of the row, one extra gap off the quick-access group
// (night: "the spacebar to the left of the tile group, tiles wide, and of
// course moving the keyboard binding under it like the same design as the
// tiles"): the in-hand tool's glyph in its engine hue, its SHAPE the hand's
// verb in the tile's own two radii (VERB_RADIUS) — a toggle the asymmetric
// plate, a momentary the rounded one — lit like any tile while the hand
// plays, and under it, in the ledger's cap, the two inputs that play it: the
// drawn spacebar in a wide keycap, the mouse in a keycap. No `data-pos` and
// no `data-pal`: it is not a position, nothing fires it by number, and a
// drag never picks it up. Right-click flips the verb; a press presses the
// hand. It was a plate the row's width for one evening. The click is the
// WORD in a keycap (Ek, night: "make the left click more obvious or spell out
// left click, i can't see what that icon is") — a 7×10 mouse in a 15px cap
// was not a symbol anyone could read.
function handTileHTML(ENGINE_HUE) {
  const t = tileById(inHand);
  if (!t) return '';
  const c = ENGINE_HUE[engineOf(t.id)] ?? ENGINE_HUE.none;
  const verb = handVerb;
  const playing = _held && _held.i === HAND_POS;
  const title = `${t.label} is in hand — the spacebar and a left-click on the sphere play it, ` +
    (verb === 'toggle' ? 'from one press to the next (toggle)' : 'while held (momentary)') +
    ` · right-click for ${verb === 'toggle' ? 'momentary' : 'toggle'} · click a tool in the rail or on the strip to take it in hand · its ⋯ in the rail opens its drawer`;
  return `<button type="button" class="tile tile--hand${playing ? ' playing' : ''}" id="handKey"` +
    ` style="--c:${c};--eng:${c};--pal-r:${VERB_RADIUS[verb]}" data-hand="${t.id}" data-verb="${verb}" title="${esc(title)}">` +
    `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${G[t.g]}</svg>` +
    `<span class="tile-nm">${esc(t.label)}</span>` +
    ((isWet(t.id) || isAutoPin(t.id)) ? `<span class="tile-marks">${isWet(t.id) ? `<span class="tile-wet"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${G.wet}</svg></span>` : ''}${isAutoPin(t.id) ? `<span class="tile-pin"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${G.pin}</svg></span>` : ''}</span>` : '') +
    `<span class="tile-binds"><kbd class="tile-bind tile-bind--key" aria-label="spacebar">${SPACE_MARK}</kbd>` +
    `<kbd class="tile-bind tile-bind--key" aria-label="left click">click</kbd></span></button>`;
}

// ── Render ──────────────────────────────────────────────────────────────────

export function render() {
  // The hue table is resolved from CSS here, so the published hand hue is
  // refreshed with it — a dark-mode flip changes both.
  _publishHandHue();
  const bar = document.getElementById('tileBar');
  if (!bar) return;
  const inst = installedLens();
  // ── One hue per ENGINE (#257) ──────────────────────────────────────────
  // There were fifteen tile colours — a different hue per brush, each picked
  // on its own — and on one dark strip they read as confetti, not as a
  // system. Colour now answers exactly one question, "which engine is this",
  // so five hues cover the whole app. They sit at matched chroma and
  // lightness so no group shouts louder than another; a tile's own identity
  // is its glyph and its name, which is what you actually read.
  // The values live in style.css as --eng-* so the palette has one home.
  const ENGINE_HUE = _engineHueTable();
  // Two areas, and the split IS the information (#248): the PALETTE is what
  // the keys and pedals reach; the LIBRARY is everything. A tile is drawn the
  // same way in both — same glyph, same engine hue — because it is the same
  // tool; only the key legend says where it stands. Engine still speaks
  // through one signal, the glyph's hue.
  // Two presentations of one tile. On the PALETTE it is a big target you hit;
  // in the RAIL it is a row you read — Ableton's browser, where the list is a
  // list and the thing you play is elsewhere (#258).
  // The row carries no delete any more (Ek, 2026-09-10): Delete is a button
  // in the tool's drawer head, on every tool, factory or yours — see
  // renderProps and deleteTile. Rename is still the row's (double-click).
  // The drawer's handle (Ek, 2026-09-03: "a 3 dots icon on the right of the
  // tool"), on EVERY tool row since 2026-09-10 (Ek: "the palette icon and
  // wet icon should always be visible, same with the drawer opener") — it
  // was on the armed row only, and a handle that appears when you pick the
  // row up is one you cannot find from behind an instrument. It picks the
  // tool, as the row's click does, and opens its drawer.
  // Never on hover. Tab shows the rail; the ⋯ is the drawer's one door.
  // The palette MARK that stood here — filled for "in the cycle", outlined for
  // "skipped" — left with the cycle (Ek, 2026-09-11: "we can remove the palette
  // icon/toggle from the left rail. we just drag it in"). Whether a tool is on
  // the palette is read off the palette.
  // The drawer's door is the PANEL-RIGHT glyph — a frame with its right third
  // marked, the accepted "open a panel to the right" (Ek, 2026-09-12, night:
  // "3 dots makes me think that it'll open a menu … use the accepted icon for
  // opening up a drawer to the right"). It was ⋯ from 2026-09-03. The class
  // and the `data-more` hook keep their names: every audit reaches the drawer
  // through them.
  const MORE = `<span class="trow-more" data-more role="button" tabindex="-1"` +
    ` title="its drawer — opens beside the rail">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true">` +
    `<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M14.5 5v14"/></svg></span>`;
  // The WET mark (Ek, 2026-09-03): a drop after the name of a brush whose
  // knobs keep moving every stroke it painted (brush-voicing.js, "Wet
  // paint"). On the row AND the palette tile, because the point of wet being a
  // property of the brush rather than a mode is that you can see which
  // brush it is from the palette.
  const WET = `<span class="tile-wet" title="wet — its knobs move every stroke it painted; switch it off in its sheet to dry them">` +
    `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${G.wet}</svg></span>`;
  // The PIN mark (Ek, 2026-09-12, night): the tile pins what it plays on
  // release — a cloud for grain, a loop for tape — read off its own on-end
  // flag. On the palette tile beside the wet drop; on the row a button that
  // flips it, exactly as the drop does.
  const PIN = `<span class="tile-pin" title="pins on end — the stroke is pinned when you let go; the switch is in its sheet">` +
    `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${G.pin}</svg></span>`;
  const PIN_BTN = (on, eng) => `<span class="tile-pin tile-pin--btn${on ? ' on' : ''}" data-pin-tgl role="switch" tabindex="-1" aria-checked="${on}"` +
    ` title="${on ? `pins on end — the stroke becomes a ${eng === 'tape' ? 'loop' : 'cloud'} when you let go; tap to stop pinning`
                 : `does not pin — the stroke stays scratch; tap to pin it as a ${eng === 'tape' ? 'loop' : 'cloud'} on release`}">` +
    `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${on ? G.pin : G.pinOff}</svg></span>`;
  const MARKS = id => { const w = isWet(id), p = isAutoPin(id); return (w || p) ? `<span class="tile-marks">${w ? WET : ''}${p ? PIN : ''}</span>` : ''; };
  // On the RAIL the drop is a BUTTON (Ek, 2026-09-06), on every grain brush's
  // row — the palette mark's shape rule: outlined is dry, filled is wet, and
  // a tap flips it without loading the row (the capture handler in init).
  // Only the grain engine has wet paint (setWet refuses the rest), so a loop
  // or erase row shows nothing here rather than a control that cannot act.
  const WET_BTN = on => `<span class="tile-wet tile-wet--btn${on ? ' on' : ''}" data-wet-tgl role="switch" tabindex="-1" aria-checked="${on}"` +
    ` title="${on ? 'wet — its knobs move every stroke it painted; tap to dry them'
                 : 'dry — its strokes keep the sound they were painted with; tap to make it wet'}">` +
    `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${on ? G.wet : G.wetOff}</svg></span>`;
  // An engine's title carries its `+`, just right of the word (Ek,
  // 2026-09-10: "instead of a new tool row under NEW in the left rail, just
  // add a + button beside each engine title" — first flush right, then
  // "put the plus button … just to the right of the title"). A tap mints a tool of THAT engine from what is on
  // the sliders now, arms it and opens its drawer — the one act of choosing
  // that also opens (see _createCustomTile). It replaced a `new tool` row at
  // the foot of the list that opened an engine chooser: the engine is
  // already said by the title the + sits on. The source group has none —
  // a source is not an engine, and nothing is minted from it. (It used to
  // arm the minted tool as well; it picks it for the drawer now.)
  const grpLabel = (label, engine, hue) =>
    `<span class="tbx-lbl" style="--eng:${hue}">${label}` +
    `<span class="tbx-add" data-add="${engine}" role="button" tabindex="-1"` +
    ` title="new ${label} tool — starts from what is on the sliders now">+</span></span>`;
  const tileHTML = (id, { html = '', zone, verb = null, pos = '' }) => {
    const t = tileDef(id); if (!t) return '';
    const eng = engineOf(id);
    const open    = zone === 'box' && _optSel.kind === 'tool' && _optSel.id === id;
    const c = ENGINE_HUE[eng] ?? ENGINE_HUE.none;
    // `off-factory` marks a tool whose params have been moved this session.
    // (`trow--radio` marked one-brush-at-a-time selection; nothing selects a
    // tool any more, so the rail is a plain list — see the lens rows, which
    // are still a radio group because a lens IS a selection.)
    const rule = '';
    const dirty = isOffFactory(id) ? ' off-factory' : '';
    const wet = isWet(id), autopin = isAutoPin(id);
    const hand = id === inHand ? ' · IN HAND — space and a click on the sphere play it' : ' · click to take it in hand';
    const title = `${t.label}${eng ? ' · ' + eng : ''}` +
      (zone === 'palette'
        ? `${hand} · ${verbWord(id, verb) ?? verb} from its own key — right-click for the other verb · the ⋯ in the rail opens its drawer · drag to move it, drag off the palette to remove it`
        : inPalette(id) ? `${hand} · the ⋯ opens its drawer · on the palette at ${posesOf(id).join(' and ')} · drag it onto the palette for another verb`
        : `${hand} · the ⋯ opens its drawer · drag it onto the palette to place it`) +
      `${t.ghost ? ' · not built yet' : ''}`;
    const body = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${G[t.g]}</svg>` +
      `<span class="tile-nm">${t.label}</span>`;
    if (zone === 'palette') {
      // No idle mark on a palette tile: the box said ARMED and there is no
      // armed tool (2026-09-11). A tile is lit only while it plays, and its
      // SHAPE is its verb (§ 3).
      // No in-hand mark on a quick-access tile: the hand tile at the head of
      // the row shows the same glyph, and a ring here said it twice.
      return `<button type="button" class="tile` +
        `${t.ghost ? ' ghost' : ''}${dirty}${wet ? ' wet' : ''}" style="--c:${c};--eng:${c};${SHAPE(verb)}"` +
        ` data-tile="${id}" data-pal="${id}" data-zone="palette"${pos} draggable="true" title="${title}">` +
        body + MARKS(id) + html + `</button>`;
    }
    // A rail row carries `open` (its drawer is up) and `in-hand` (space plays
    // it, 2026-09-12) — the one place the hand is marked besides the hand
    // tile itself, so the tool can be found in the library.
    return `<button type="button" class="trow${rule}${open ? ' open' : ''}${id === inHand ? ' in-hand' : ''}` +
      `${t.ghost ? ' ghost' : ''}${t.custom ? ' trow--own' : ''}${dirty}${wet ? ' wet' : ''}${autopin ? ' autopin' : ''}"` +
      ` style="--c:${c};--eng:${c}"` +
      ` data-tile="${id}" data-zone="box" draggable="true" aria-pressed="${open}" title="${title}">` +
      // Dub's pin is a fact, not a switch: the mark, not the button.
      // … in the button's own 1.4rem box, so it sits where every other
      // row's pin sits (Ek, night: "not at the same position as the others").
      body + (eng === 'granular' ? WET_BTN(wet) : '') + (id === 'overdub' ? `<span class="tile-pin tile-pin--btn tile-pin--fixed on" title="dub works on pinned loops only — its take joins the nearest one, or seeds it"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${G.pin}</svg></span>` : (eng === 'granular' || eng === 'tape' ? PIN_BTN(autopin, eng) : '')) + MORE + `</button>`;
  };

  // ── The palette: the list, in order ───────────────────────────────────────
  // One strip answers every glance question (Ek, 2026-09-03): which lens is
  // on, what is in reach, what each key does. Every tile is the same box; a
  // tool lights while it sounds and carries no idle mark at all (the armed
  // box went 2026-09-11), a lens lights its glyph while it is on, a pin tile
  // flashes on the press. The strip is
  // exactly as wide as the list (Ek, 2026-09-11: "dynamic and not have all 9
  // slots shown"); the badge at its head is chrome, not a tile, the same box
  // so the row reads as one row.
  // No position NUMBER anywhere on the strip (Ek, 2026-09-11, late: "get rid
  // of the tile positions completely, not the design of it being positioned
  // but the mental heuristic of a position number … it's more about what
  // key is bound to it"). Positions are kept internally — they are what the
  // wire and the maps address — and the tile wears its BOUND KEY, bottom-left:
  // the factory digit while it still fires, a learned key, a MIDI tag.
  const LEG = n => paletteLegend(n).html;
  // THE VERB IS THE SHAPE (§ 3), and it is the only thing the shape says. One
  // closed outline and one property, so no tile can look broken and none of
  // them grows: `--pal-r` is the tile's `border-radius` and nothing else
  // changes. Written as an inline custom property rather than a class because
  // the audit reads the COMPUTED radius back off the strip (§ 9 I), and a
  // class would let CSS and this table drift apart silently.
  const SHAPE = verb => ` --pal-r:${VERB_RADIUS[verb] ?? VERB_RADIUS.bang};`;
  const paletteTile = (e, n) => {
    const { id, verb } = e;
    const k = paletteKind(id);
    const pos = ` data-pos="${n - 1}" data-verb="${verb}"`;
    if (k === 'tool') return tileHTML(id, { html: paletteLegend(n).html, zone: 'palette', verb, pos });
    if (k === 'lens') {
      const c = ENGINE_HUE.lens, label = lensLabel(id), on = id === inst && !S.scanMuted;
      return `<button type="button" class="tile tile--lens${on ? ' on' : ''}" style="--c:${c};--eng:${c};${SHAPE(verb)}"` +
        ` data-lens="${id}" data-pal="${id}" data-zone="palette"${pos} draggable="true" aria-pressed="${on}" title="${lensTileTitle(label, verb)}">` +
        `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${SCOPE_G[id] ?? G.custom}</svg>` +
        `<span class="tile-nm">${label}</span>${LEG(n)}</button>`;
    }
    const a = ACT_TILES[id];
    return `<button type="button" class="tile tile--act" style="--c:${ENGINE_HUE.pins};--eng:${ENGINE_HUE.pins};${SHAPE(verb)}" data-act="${a.action}" data-pal="${id}" data-zone="palette"${pos} draggable="true" title="${a.tip} — ${verbWord(id, verb) ?? verb}">` +
      `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${G[a.g]}</svg>${LEG(n)}</button>`;
  };
  const dock = document.getElementById('paletteDock');
  // ONE ROW: the hand tile at its head, one extra gap, then the quick-access
  // tiles in order (Ek, 2026-09-12, night: "the spacebar to the left of the
  // tile group, tiles wide"). The palette badge that headed the row went
  // the same evening.
  if (dock) dock.innerHTML =
    `<div class="palette" id="paletteBed" title="the palette — the hand at its head, then quick access: drag a tool, a lens or the pin pair here from the rails; drag a tile to move it, off the strip to remove it; each tile wears the key that fires it — click the sticker to relearn it, right-click to clear">` +
    handTileHTML(ENGINE_HUE) +
    palette.map((e, i) => paletteTile(e, i + 1)).join('') + `</div>`;
  // The strip was just rebuilt: a tool sounding through it must not go dark
  // for a poll's worth of frames (the switch flipped, a lens cycled on `2`).
  refreshPlayingState();
  renderPinChrome();

  // The box groups by ENGINE, in the same order the engines are named
  // everywhere else. A group with nothing in it is not drawn — an empty
  // caption reads as a broken UI, not as an invitation.
  const byEng = { tape: [], granular: [], erase: [] };
  for (const id of boxIds()) byEng[engineOf(id)]?.push(id);
  // Source · lens · PAINT (tape, grain) · erase — the order Ek asked for, and
  // the order the chain actually runs in.
  const GRP_LABEL = { tape: 'tape', granular: 'grain', erase: 'erase' };
  const boxHTML = ['tape', 'granular', 'erase'].map(k => {
    if (!byEng[k].length) return '';
    return `<div class="tbx-grp" data-grp="${k}">${grpLabel(GRP_LABEL[k], k, ENGINE_HUE[k] ?? ENGINE_HUE.none)}` +
      `<div class="tbx-tiles">${byEng[k].map(id => tileHTML(id, { zone: 'box' })).join('')}</div></div>`;
  }).join('');

  bar.innerHTML = boxHTML;
  // The lens dock — its own area, never in the hand row (Ek, 2026-08-27:
  // the lens is unique, so it must not compete with the brushes for the
  // options bar; it gets its tiles on top and a quick view of its params
  // underneath).
  // The lens group sits in the same strip as everything else (#253) — it was
  // penned into the right column beside the pinned rail, which made it look
  // like a different kind of surface rather than a different kind of tool.
  const lensBar = document.getElementById('lensBar');
  const lensRow = sc => {
    // A lens row lights while it is the lens that is ON: installed and
    // reading. No lens on is the cap, so under it every row is dark.
    const on = sc.id === inst && !S.scanMuted;
    const openL = _optSel.kind === 'lens' && _optSel.id === sc.id;
    return `<button type="button" class="trow trow--lens trow--radio${on ? ' on' : ''}${openL ? ' open' : ''}` +
      `${sc.custom ? ' trow--own' : ''}" data-sel="radio"` +
      ` style="--c:${ENGINE_HUE.lens};--eng:${ENGINE_HUE.lens}" data-lens="${sc.id}" draggable="true" aria-pressed="${on}"` +
      ` title="${sc.label} · lens · tap to turn it on, again to turn it off${inPalette(sc.id) ? ' · on the palette at ' + posesOf(sc.id).join(' and ') : ' · drag it onto the palette to place it'}">` +
      `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${SCOPE_G[sc.id] ?? G.custom}</svg>` +
      `<span class="tile-nm">${sc.label}</span>` +
      // Every lens row carries the drawer handle like every tool row does (2026-09-10).
      MORE + `</button>`;
  };
  // ONE group again (#286's second question retired 2026-08-30): "which lens"
  // takes exactly one answer, and with the pin filters gone there is no second
  // question in this dock. Factory lenses first, in factory order, then yours.
  const lensGrp = LENSES.filter(l => !_gone.has(l.id))
    .concat(customLensIds().map(id => ({ id, label: tileDef(id).label, custom: true })));
  const grp = (label, rows) =>
    `<div class="tbx-grp" data-grp="lens">${grpLabel(label, 'lens', ENGINE_HUE.lens)}` +
    `<div class="tbx-tiles">${rows.map(lensRow).join('')}</div></div>`;
  if (lensBar) lensBar.innerHTML = grp('lens', lensGrp);
  renderOptions();
}

/** The pin actions as ROWS, not chips. The rail has one row model — mark or
 *  label left, keycap or affordance flush right — and the pinned list below
 *  already used it; this cluster was the only thing on this column still laid
 *  out as a wrapping chip group, which is why it fought the rail's width and
 *  why `unpin all` kept being proposed for abbreviation. Stacking costs two
 *  rows of height and buys a fixed rail height and explicit copy.
 *  These carry NO state now the groups are gone (2026-08-30) — the label is
 *  the verb, and the dot is the rail's own mark rather than a group's colour. */
export function renderPinChrome() {
  const wrap = document.getElementById('tcPins');
  if (!wrap) return;
  // THE PIN GROUP, in the tool rail's own row model (Ek, 2026-09-12, night:
  // "a section of the same design as the left rail, but on the right rail,
  // it's for the pin and unpin tools, and unpin all … consistent with being
  // able to drag those tools from the right rail into and out of the
  // palette bar"): a group title, then one .trow per act — glyph, name, and
  // the key that does the same thing as a cap at the right edge, where a
  // tool row keeps its drawer button (an act has no drawer). A click FIRES
  // (an act has no span to hold); a drag places it on the palette. The
  // glyph is the chrome's grey, not an engine hue: a pin holds any engine's
  // material. Unpin all is named in full — beside two pin rows "all" could
  // read as "pin all" (#267) — and turns brick on approach, as every
  // destructive control does.
  // No key cap on the row (Ek, night: "remove the keyboard shortcut glyphs
  // from the pin rows since we see them in the palette, which right now are
  // mismatched"): the palette tile's legend is where a key is read, and the
  // fixed = / − caps disagreed with whatever digit the drop had dealt.
  const row = (id, extra = '') => { const a = ACT_TILES[id];
    return `<button type="button" class="trow trow--act${a.danger ? ' trow--danger' : ''}" style="--c:var(--eng-pins);--eng:var(--eng-pins)" data-pin="${id}" data-act="${a.action}" draggable="true"` +
      ` title="${a.tip} · click to do it · drag it onto the palette for a tile of its own${extra}">` +
      `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${G[a.g]}</svg>` +
      `<span class="tile-nm">${a.label}</span></button>`; };
  wrap.innerHTML =
    `<div class="tbx-grp" data-grp="pin"><span class="tbx-lbl" style="--eng:var(--eng-pins)">pin</span>` +
    `<div class="tbx-tiles">${row('pin', ' (hold to draw a path)')}${row('unpin')}${row('unpinall')}</div></div>`;
}

/** The pressed look for the pin pair — they have no `playing` state (nothing
 *  sustains), so the press is the only feedback there is. */
// The flash belongs to the ACTION, not to the way in: the `-` key never
// flashed, and a button, OSC or MIDI press flashed a hidden cabinet element
// (Ek, 2026-09-10: "for the unpin i don't see it light up when i press it").
// midi.js calls this from the commit_drop / commit_release / commit_clear
// cases through S._pinFlash; the key and rail paths that bypass dispatch call
// it themselves.
function _pinEls(kind) {
  if (kind === 'all') kind = 'unpinall';   // midi.js's commit_clear says `all`
  const act = { pin: 'commit_drop', unpin: 'commit_release', unpinall: 'commit_clear' }[kind];
  return [document.querySelector(`#tcPins [data-pin="${kind}"]`),
          act ? document.querySelector(`#paletteDock [data-act="${act}"]`) : null].filter(Boolean);
}
function _pinFlash(kind) {
  const els = _pinEls(kind);
  for (const el of els) el.classList.add('fired');
  setTimeout(() => els.forEach(el => el.classList.remove('fired')), 180);
}
/** A HELD pin stays lit (Ek, 2026-09-13: "for momentary hold pins, the pin
 *  should stay lit like all the other momentary holds"). The comment above
 *  used to say the pair has no sustained state — true of a bang, and wrong
 *  since the pin took three verbs: a MOMENTARY holds a path open from the down
 *  to the up, and a TOGGLE holds one open between two presses, and for that
 *  whole time the tile went dark 180 ms in while the thing it started was
 *  still running. Same `.fired` face as the press, held rather than timed out,
 *  so nothing new has to be learned — it is the press look, sustained. */
function _pinLit(kind, on) {
  for (const el of _pinEls(kind)) el.classList.toggle('fired', !!on);
}
S._pinFlash = _pinFlash;
// The pin ACTION is the `=` key (Ek, 2026-09-10: "the pin binding is old, it
// only pins clouds. it should pin the same as the = button"): what the cursor
// is on decides — a tape stroke becomes a loop, painting grows the loop,
// nothing in reach is a ghost cloud. midi.js's commit_drop / commit_draw go
// through here rather than the old commitMode branch. Sequenced, because both
// halves import lazily and a quick momentary must not release before it lands.
let _pinQueue = Promise.resolve();
const _pinSeq = (fn) => (_pinQueue = _pinQueue.then(fn).catch(() => {}));
S._pinTap  = () => _pinSeq(async () => { await pinDown(); await pinUp(); });
S._pinHold = (on) => _pinSeq(() => (on ? pinDown() : pinUp()));

function flash(id) {
  const els = tileEls(id);
  els.forEach(el => el.classList.add('fired'));
  setTimeout(() => els.forEach(el => el.classList.remove('fired')), 180);
}


// ── The engine registry (#223 — the designer view) ──────────────────────────
// Ek's model, Procreate-shaped: every tile runs on an ENGINE — granular
// (pen and all the experimental brushes), loop/sample (line, slice), or
// lens (the lens). The registry below is the single description of each
// engine's full parameter surface: the DESIGN view renders all of it over
// the stage, the PERFORM view renders the subset each tile marks visible
// (the eye toggles), and a future "+" tile starts from exactly this list.
// Every row writes through the real panel element and reads its paired
// numbox, so the sheet can never disagree with the rig view.
// 'fx' params live on S.fx, 'tp' params on S.triggerParams — one machinery.
const _pStore = d => (d.kind === 'tp' ? S.triggerParams : S.fx);

const PARAM_DEFS = {
  // granular engine — deposit
  flow:     { label: 'rate',    kind: 'flow', def: 50, sec: 'deposit' },
  // WIDTH of the deposit head: 0° lays a single line of marks, anything above
  // spreads them across that many degrees either side of the path (#279).
  headW:    { label: 'width',   kind: 'head', def: 0,  sec: 'deposit' },
  // What the stroke BECOMES when it ends (Ek, 2026-09-05) — the loop family's
  // `on end` row, for grains: `scratch` stays on the sphere for the cursor,
  // `cloud` is pinned at the release as a moving cloud looping the path (the
  // wash brush). Reads and writes S.traceMode, which the A key and
  // /trace/mode used to cycle under the palette. The third value that mode
  // had, `trace+loop` (grain marks under a loop pin, scan muted while it
  // recorded), was cut the same day: it was the looper with different marks,
  // and nobody had asked for it.
  gEnd:     { label: 'on end',  kind: 'gend', sec: 'deposit' },

  // granular — grain
  // DURATION, not "grain": the section is already called grain, so the row was
  // saying it twice and saying nothing (#278).
  dur:      { label: 'duration', kind: 'slider', el: 'gcDurSlider', sec: 'grain' },
  period:   { label: 'period',  kind: 'slider', el: 'gcPeriodSlider', sec: 'grain' },
  overlap:  { label: 'overlap', kind: 'slider', el: 'gcOverlapSlider', sec: 'grain' },
  curve:    { label: 'curve',   kind: 'seg', seg: 'gcCurveSeg', sec: 'grain' },
  // TAPER, not fade (#277): this is the fraction of the grain spent ramping —
  // the Tukey window's α — and "fade" is spoken for by the LEVEL fades
  // elsewhere (the lens's radius fade, loop fades). The pid stays `fade` so
  // every binding, OSC address and stored patch is untouched.
  fade:     { label: 'taper',   kind: 'slider', el: 'gcFadeSlider', sec: 'grain' },
  durVar:   { label: 'dur ±',   kind: 'slider', el: 'gcDurVarSlider', sec: 'grain' },
  perVar:   { label: 'per ±',   kind: 'slider', el: 'gcPeriodVarSlider', sec: 'grain' },
  // Two rows that are their own controls, not parameters (#280). They live in
  // PARAM_DEFS so they take a place in the engine's order like anything else.
  glink:    { label: 'link',    kind: 'glink',  sec: 'grain' },
  octave:   { label: 'octave',  kind: 'octave', sec: 'pitch' },
  // Read-OFFSET randomness, not a start time: markers land on a fixed clock,
  // so without this a grain can only begin exactly on one. It widens each
  // grain's reach into the audio between markers.
  startJit: { label: 'offset ±', kind: 'slider', el: 'gcStartJitterSlider', sec: 'grain' },
  durJit:   { label: 'dur jit', kind: 'slider', el: 'gcDurJitterSlider', sec: 'grain' },
  // Probability is a gate on the OUTPUT, not a property of the grain: it
  // decides whether a scheduled grain sounds at all (#283).
  prob:     { label: 'prob',    kind: 'slider', el: 'gcProbSlider', sec: 'output' },
  // granular — pitch
  pitch:    { label: 'pitch',   kind: 'slider', el: 'gcPitchShiftSlider', sec: 'pitch' },
  pitchJit: { label: 'pitch ±', kind: 'slider', el: 'gcPitchSlider', sec: 'pitch' },
  dir:      { label: 'direction', kind: 'seg', seg: 'gcDirSeg', sec: 'pitch' },
  // granular — filter
  hpf:      { label: 'hpf',     kind: 'slider', el: 'gcHpfSlider', sec: 'filter' },
  lpf:      { label: 'lpf',     kind: 'slider', el: 'gcLpfSlider', sec: 'filter' },
  hpq:      { label: 'hpf Q',   kind: 'slider', el: 'gcHpfQSlider', num: 'gcHpfQNum', sec: 'filter' },
  lpq:      { label: 'lpf Q',   kind: 'slider', el: 'gcLpfQSlider', num: 'gcLpfQNum', sec: 'filter' },
  fltJit:   { label: 'flt ±',   kind: 'slider', el: 'gcFilterJitterSlider', sec: 'filter' },
  // granular — output
  pan:      { label: 'spread',  kind: 'slider', el: 'gcPanSlider', sec: 'output' },
  vol:      { label: 'vol',     kind: 'slider', el: 'gcVolSlider', sec: 'output' },
  // granular — experimental (graduated from paint-ticker constants, #225)
  combAxis: { label: 'sort by', kind: 'combAxis', sec: 'experimental' },
  combKeep: { label: 'keep',    kind: 'combKeep', sec: 'experimental' },
  splatSpread: { label: 'splat spread', kind: 'fx', path: 'splatSpread', min: 0, max: 0.4, step: 0.01, fmt: v => (+v).toFixed(2) + '°/°/s', def: 0.10, sec: 'experimental' },
  splatThrow:  { label: 'splat throw',  kind: 'fx', path: 'splatThrow',  min: 0, max: 0.2, step: 0.005, fmt: v => (+v).toFixed(3), def: 0.06, sec: 'experimental' },
  staffLo:     { label: 'staff lo', kind: 'fx', path: 'staffLo', min: 40, max: 1000, step: 5, fmt: v => Math.round(v) + 'Hz', def: 110, sec: 'experimental' },
  staffHi:     { label: 'staff hi', kind: 'fx', path: 'staffHi', min: 1000, max: 16000, step: 50, fmt: v => (v / 1000).toFixed(1) + 'k', def: 7040, sec: 'experimental' },
  // loop/sample engine — what's left here is what gets BAKED IN when the
  // line is drawn (#236, Ek): speed, how it slices, its level. "When I draw
  // that line I'm not thinking about how [touch playback] works" — so
  // everything about TOUCHING a loop (dwell, start, release, retrig, rearm)
  // lives on the LENS, beside k/fill/order for grains. Speed, vol and passes
  // ARE frozen per stroke: armTrigger snapshots them onto the trigger and the
  // session file carries them, and NOTHING rewrites them afterwards — the
  // grain filter is granular-only and writes to no material at all (#292).
  // These rows write S.triggerParams, which sets FUTURE arms. Chop/sliceMin stay arm-time structural (they decide how the stroke
  // is cut, once).
  tspeed:   { label: 'speed',   kind: 'slider', el: 'trigSpeedSlider', sec: 'baked in' },
  tvol:     { label: 'vol',     kind: 'slider', el: 'trigVolumeSlider', sec: 'baked in' },
  tchop:    { label: 'chop',    kind: 'seg', seg: 'trigChopSeg', sec: 'slicing' },
  chopMs:   { label: 'chop ms', kind: 'slider', el: 'trigChopSlider', sec: 'slicing' },
  sliceMin: { label: 'min slice', kind: 'fx', path: 'sliceMinMs', min: 0, max: 500, step: 10,
              fmt: v => (+v > 0 ? Math.round(v) + 'ms' : 'keep all'), sec: 'slicing' },
  // Self-killing loops (#239): a looper stroke plays N passes, fading each,
  // then deletes itself AND its paint. 0 = ∞ (a loop that stays). Baked at
  // record time — "a decision I make when I record the loop" (Ek).
  passes:   { label: 'passes',  kind: 'tp', path: 'passes', min: 0, max: 8, step: 1,
              fmt: v => (+v > 0 ? Math.round(v) + '×' : '∞'), sec: 'baked in' },
  // The looper contract as a param (#244): 'loop' = end the stroke and it
  // loops immediately. Any loop tile — a custom one included —
  // becomes a looper by flipping this; line/slice pin 'arm' by identity.
  onEnd:    { label: 'on end',  kind: 'onend', sec: 'baked in' },
  // read-time loop params — LENS engine (how the cursor reads a loop it touches)
  dwell:    { label: 'on dwell', kind: 'seg', seg: 'trigDwellSeg', sec: 'on tape' },
  tstart:   { label: 'start',   kind: 'seg', seg: 'trigStartSeg', sec: 'on tape' },
  release:  { label: 'release', kind: 'seg', seg: 'trigReleaseSeg', sec: 'on tape' },
  retrig:   { label: 'retrig',  kind: 'seg', seg: 'trigRetrigSeg', sec: 'on tape' },
  rearm:    { label: 'rearm',   kind: 'slider', el: 'trigRearmSlider', sec: 'on tape' },
  // lens engine
  // `mode` (area | nearest) is a normal per-tile param (Ek: the sheet always
  // edits its own tile) — wide ships area and spot ships nearest via
  // FACTORY_PARAMS, and flipping it on a factory lens is a session edit.
  mode:     { label: 'mode',    kind: 'seg', seg: 'snapToggleSeg', sec: 'lens' },
  // WHAT the cursor reads, beside HOW it reads (2026-09-07, Ek: "it should be
  // in a lens, reads grains, loops or both"). This is where the deleted
  // `triggers on|off` global belongs: per lens, saved with the tile, so a lens
  // that only fires tape is a tool you arm on `2` rather than a mute you have
  // to remember. The cap outranks it — capped, the cursor reads nothing.
  reads:     { label: 'reads',    kind: 'reads', sec: 'lens' },
  radius:    { label: 'radius',   kind: 'slider', el: 'radiusSlider', num: 'radiusVal', sec: 'lens' },
  depth:     { label: 'depth',   kind: 'slider', el: 'recencySlider', read: 'depth', sec: 'lens' },
  // k, fill and order came HOME to the lens (#233): flow made density a
  // painted property of the material, so how many marks the cursor reads —
  // and in what order — is the lens's job. Aperture is deleted: it existed
  // only to cap k without touching the brush, and with k here it had no job.
  k:        { label: 'k',       kind: 'slider', el: 'searchKSlider', num: 'kBigNum', sec: 'on grains' },
  fill:     { label: 'fill',    kind: 'seg', seg: 'kAllSeg', sec: 'on grains' },
  korder:   { label: 'order',   kind: 'seg', seg: 'kSeqSeg', sec: 'on grains' },
  // The fade pair — volume falloff from cursor centre to the radius edge.
  // `falloff` renders as an x/y diagram (distance → volume), not a knob: the
  // old "curve %" said nothing about WHICH way 100% bends (Ek). The shape is
  // the worklet bridge's truth: gain = (1 − d/radius)^(1 + curve×3).
  // `rfade`, not `fade` (2026-08-28): this key used to be `fade` too, which
  // silently SHADOWED the granular envelope fade five entries up — one object,
  // one key — so every granular sheet rendered the radius-fade seg where the
  // envelope fade belonged.
  rfade:     { label: 'fade',    kind: 'seg', seg: 'radiusFadeSeg', sec: 'fade' },
  fadeCurve: { label: 'falloff', kind: 'fadecurve', el: 'radiusFadeCurveSlider', sec: 'fade' },
  // `xfade` and `tether` used to sit here, as an "on pins" section of the LENS
  // sheet. They are pin parameters, so on 2026-08-30 they went back to being
  // only that: Settings → Pins, beside the Blend they shape. A lens reads the
  // scratch layer; it does not touch the pins, so nothing about the pins may
  // appear on its page (Ek). The cabinet controls they drove — #improvSnapSlider
  // and #seedAlwaysSeg — are unmoved, because that panel IS the settings page.
  efrom:    { label: 'from',    kind: 'efrom', sec: 'scrape' },
  // 'erases: stroke' (#243) — the brush's contact picks WHICH strokes, then
  // the whole take goes: erase a stroke by touching it anywhere. 'touch' is
  // the classic brush that takes only what it reaches.
  escope:   { label: 'erases',  kind: 'escope', sec: 'scrape' },
};
const ENGINES = {
  granular: ['flow', 'headW', 'gEnd',
             // duration and period lead and take a full row each — they are
             // the two that decide what granular sounds like, and their ±
             // bands need the width to be readable (#278). `fade`(taper)
             // shares a row with `curve`: one is the shape, the other is how
             // much of the grain that shape occupies.
             // `overlap` left as a slider (#279): it is grain ÷ period, so it is
             // a READOUT, and the scope already draws it. What was useful about
             // it is now the LINK — see _grainLink. `durJit` left too: it is
             // duration jitter as a proportion, which `dur ±` already does in
             // absolute ms, and two controls for one idea made the panel
             // arbitrary.
             'dur', 'period', 'glink', 'fade', 'curve', 'startJit',
             'durVar', 'perVar', 'pitch', 'octave', 'pitchJit', 'dir',
             'hpf', 'lpf', 'hpq', 'lpq', 'fltJit',
             // Output: level takes the row, then the two that shape how it
             // lands share the next one (#283).
             'vol', 'pan', 'prob',
             'combAxis', 'combKeep', 'splatSpread', 'splatThrow', 'staffLo', 'staffHi'],
  tape:     ['tspeed', 'tvol', 'onEnd', 'passes', 'tchop', 'chopMs', 'sliceMin'],
  // The lens sheet reads as: geometry, then what touching GRAINS does, then
  // what touching a LOOP does, then the edge fade (#236). Nothing about pins:
  // that is the whole of the 2026-08-30 split.
  // `fill` is NOT listed: it is folded into k's row (2026-09-07). k and fill
  // were one question wearing two controls — 'all' is k = infinity, and the
  // sheet drew a live-looking k slider beside it that was doing nothing.
  lens:     ['mode', 'reads', 'radius', 'depth', 'k', 'korder',
             'dwell', 'tstart', 'release', 'retrig', 'rearm',
             'rfade', 'fadeCurve'],
  // The erase engine shares depth with the lens (one knob, two engines).
  erase:    ['depth', 'efrom', 'escope'],
};
function engineOf(id) {
  const cu = _tileCfg?.[id]?.custom;
  if (cu) return cu.engine;
  if (id === 'line' || id === 'slice' || id === 'looper' || id === 'overdub') return 'tape';
  if (LENSES.some(s => s.id === id)) return 'lens';
  if (TILE_DEFS[id]?.kind === 'brush') return 'granular';
  if (TILE_DEFS[id]?.kind === 'edit') return 'erase';
  return null;
}
// The PERFORM-VISIBILITY machinery is gone (#257). The ◉/○ eyes chose which
// params appeared in the perform quick view; that view was deleted in #251 and
// the strip now opens with the panel (#254), so the eyes were choosing what
// shows in a place that no longer exists — and their half-dimmed cells read as
// "these values are muted", which is what dimming means in every DAW.

// One-shot pid migrations: field→radius, sedge→rfade, scurve→fadeCurve
// (2026-08-26), fq→hpq+lpq (2026-09-07). Read old key → write new → done;
// no fallback.
// `fade` is TWO params — granular envelope fade on brush tiles, radius fade
// on lens tiles (a duplicate PARAM_DEFS key until 2026-08-28, when the lens
// one became `rfade`) — so that rename applies on lens tiles only.
const _PID_RENAMES = { field: 'radius', sedge: 'rfade', scurve: 'fadeCurve' };
function _migratePids(bag, pick) {
  let dirty = false;
  for (const [tileId, tile] of Object.entries(bag ?? {})) {
    const m = pick(tile);
    if (!m) continue;
    for (const [o, n] of Object.entries(_PID_RENAMES)) {
      if (o in m) { m[n] = m[o]; delete m[o]; dirty = true; }
    }
    if (LENSES.some(s => s.id === tileId) && 'fade' in m) {
      m.rfade = m.fade; delete m.fade; dirty = true;
    }
    // 2026-09-07: one Q became two. A tile that stored the shared one gets it
    // on BOTH corners, which is exactly the filter it had.
    if ('fq' in m) { m.hpq = m.hpq ?? m.fq; m.lpq = m.lpq ?? m.fq; delete m.fq; dirty = true; }
  }
  return dirty;
}


// ── Tiles are PRESETS of an engine (#214 core, Ek 2026-08-26) ───────────────
// An engine defines the parameter vocabulary; a tile is a saved configuration
// of one engine. Selecting a tile APPLIES its params to the live state (write-
// through, so the rig view moves too); editing any param while a tile is
// selected CAPTURES the engine's current values back into that tile. Factory
// tiles start owning what their identity requires (scrape-all IS the
// depth:'all' preset — no special code) and their edits are SESSION-ONLY
// (`_sessionCfg`) — a persisted flip of wide's mode would make "wide" a lie.
// A GRAIN tile is different (Ek, 2026-09-03: "if I see that slider in that
// position, it's set"): it has no factory identity beyond its contract, it
// adopts the whole live block the first time it is applied, and its edits
// persist in mubone_tiles like a custom tile's. Old factory captures of
// other engines still sitting in mubone_tiles are ignored on read.
const LS_TILES = 'mubone_tiles';
// Tile ids that were renamed, applied ONCE to everything stored under the old
// name — the tile cfg, the slots, the rail order, the cycle skips, and a
// session file's voicings (brush-voicing.js restoreVoicings) — so a saved
// palette comes back as it was. 2026-09-06: `spray` became `pen` (Ek: splatter
// is the spray head now; the classic draws a thin line).
// One-shot id migrations, applied to every stored tile map. Two rows have been
// deleted rather than left standing, for the same reason both times: the id on
// the LEFT came back to life. `spray: 'pen'` (2026-09-06) had to go when
// `splatter` became `spray`, and `wash: 'pencil'` had to go when the wash was
// restored hours later. THE RULE: only a DEAD id may stand on the left, or the
// map sends the tile you just made straight to something else. `pencil: 'pen'`
// is safe by that test — the pencil is gone and the pen is where its edits
// belong (2026-09-07, the pencil folded back into the pen).
const _RENAMED_TILES = { splatter: 'spray', pencil: 'pen' };
export function migrateTileId(id) { return (typeof id === 'string' && _RENAMED_TILES[id]) || id; }
function _migrateTileKeys(cfg) {
  let n = 0;
  for (const [was, now] of Object.entries(_RENAMED_TILES)) {
    if (!(was in cfg)) continue;
    if (!(now in cfg)) cfg[now] = cfg[was];
    delete cfg[was]; n++;
  }
  return n;
}
let _tileCfg = {};   // tileId → { params: {pid: value}, custom?: {label, engine} }
try { _tileCfg = JSON.parse(localStorage.getItem(LS_TILES) || '{}') || {}; } catch (_) {}
if (_migrateTileKeys(_tileCfg) + _migratePids(_tileCfg, t => t?.params)) { _saveTileCfg(); }
const FACTORY_PARAMS = {
  // The erasers differ ONLY in these two values — that is what makes them
  // three presets of one engine rather than three modes (#287).
  all:    { depth: '0' },                      // 0 = no recency filter
  scrape: { depth: '1', efrom: 'top' },        // one layer, newest first
  bottom: { depth: '1', efrom: 'bottom' },     // one layer, oldest first
  wide:   { mode: 'off' },         // area — snapToggleSeg's data-snap values
  spot:   { mode: 'on' },          // nearest
  // The loop family's identity is what happens ON END (#244): line and slice
  // arm; the looper loops. Pinned here so switching tiles always restores it.
  line:   { onEnd: 'arm' },
  slice:  { onEnd: 'arm' },
  looper: { onEnd: 'loop' },
  overdub: { onEnd: 'arm' },   // moot — an overdub take is never armed — but pinned so the row reads true
  // The grain family's identity is the same question: every factory brush
  // paints scratch except the wash, which is pinned as a cloud on release.
  // Persisted edits sit over these (a pen you flipped to `cloud` stays so).
  pen:    { gEnd: 'scratch' },
  spray:    { gEnd: 'scratch' },
  comb:     { gEnd: 'scratch' },
  staff:    { gEnd: 'scratch' },
  match:    { gEnd: 'scratch' },

  wash:     { gEnd: 'cloud' },
};

// A factory SOUND, in the units the sheet displays, for the one grain tile
// whose identity is its block. Grain tiles otherwise adopt the live block on
// their first arming (below); the wash has to arrive sounding like a reverb
// whatever was on the sliders. Applied once, through each numbox's own
// `fromDisplay` (never a second copy of the log curves), then adopted like
// any other block, so from then on it is the tile's and Ek's to tune.
//   long soft grains, dense (period ≪ duration), every grain read from
//   somewhere around its mark rather than on it (offset ±, what dissolves
//   the transients), the clock randomised (per ±) so nothing buzzes, no
//   detune, a dark top, wide, and under the source.
//
// One entry: the WASH. It is the only tile that has to arrive sounding like
// itself, because its name is a sound rather than a gesture. Every other grain
// tile adopts the live block on first use.
const FACTORY_SOUND = {
  wash: { dur: '400ms', period: '15ms', fade: '50%', curve: 'hann', startJit: '400ms',
          durVar: '150ms', perVar: '10ms', pitch: '0', pitchJit: '0', dir: 'fwd',
          lpf: '6k', pan: '90%', vol: '0.5', prob: '100%' },
};

// ── A grain tile owns its whole block (Ek, 2026-09-03) ──────────────────────
// "If I see that slider in that position, it's set." Factory grain tiles used
// to carry nothing at all and keep sheet edits per session: arming pen
// applied NOTHING to the sound, so its sheet showed whatever the last tool
// had left in the live block, and a reload threw the edits away. Now a grain
// tile with no stored block ADOPTS the live block the first time it is
// applied, and its edits persist in `_tileCfg[id].params` like a custom
// tile's — from then on what its sheet shows is its own. Wet paint depends on
// this: a wet brush's strokes follow the brush, so the brush has to have a
// sound to follow. The OTHER factory tiles keep their session-only edits
// (`_sessionCfg`): wide IS mode:off and scrape IS depth:1, and a persisted
// flip would leave the name on the tile lying (palette-audit § F caught exactly
// that when this was briefly every tile).
let _sessionCfg = {};   // factory non-grain tileId → { pid: value }, until reload
/** Does this tile keep its edits on disk — a custom tile, or any grain tile? */
function _persists(id) { return !!_tileCfg[id]?.custom || engineOf(id) === 'granular'; }

/** Has this tile been dialled since the app started? (Ek, 2026-08-29: "we
 *  should have a dot or some indicator on the tool when we move the params
 *  around off the factory default.")
 *
 *  Presence, not a value diff: moving a knob and putting it back still counts
 *  as touched. A value comparison would need a factory snapshot of every pid,
 *  and most pids have no recorded factory value — so it would be a more
 *  complicated answer that is wrong in a different place. Touched is the
 *  honest thing this data can say. Session-scoped: the VALUES persist now,
 *  but the dot is about this session's hands. */
const _touched = new Set();
export function isOffFactory(id) { return _touched.has(id); }

function _saveTileCfg() { try { localStorage.setItem(LS_TILES, JSON.stringify(_tileCfg)); } catch (_) {} }

// `on end` ↔ S.traceMode. One table, read both ways.
const _GEND_OF = { 'trace': 'scratch', 'trace+cloud': 'cloud' };
const _MODE_OF = { scratch: 'trace', cloud: 'trace+cloud' };
/** Set what a grain stroke becomes. A stroke in flight ends first — the
 *  deferred path (startSeedPath) is keyed on the recording, not the mode,
 *  so a flip mid-stroke would otherwise leave it growing for ever. */
export function setGrainOnEnd(v) {
  const mode = _MODE_OF[v];
  if (!mode || S.traceMode === mode) return;
  S._gestureEnd?.();
  S.traceMode = mode;
  S._syncCommitUI?.();
}

function _readParam(pid) {
  const d = PARAM_DEFS[pid];
  if (!d) return undefined;
  switch (d.kind) {
    case 'flow':     return String((S.paintTicker && S.paintTicker.intervalMs) ?? 50);
    case 'head':     return JSON.stringify([S.headWidthDeg, S.headEdge]);
    case 'combAxis': return S.combAxis;
    case 'combKeep': return S.combKeep;
    case 'efrom':    return S.eraseOldest ? 'bottom' : 'top';
    case 'escope':   return S.eraseWholeStroke ? 'stroke' : 'touch';
    case 'reads':    return S.lensReads ?? 'both';
    case 'fx': case 'tp': return String(_pStore(d)?.[d.path]);
    case 'onend':    return S.triggerParams.loopOnEnd ? 'loop' : 'arm';
    case 'gend':     return _GEND_OF[S.traceMode] ?? 'scratch';
    case 'seg': {
      const seg = document.getElementById(d.seg);
      const b = seg?.querySelector('button.active');
      if (!b) return undefined;
      const attr = Object.keys(b.dataset)[0];
      return attr ? b.dataset[attr] : undefined;
    }
    default: {
      // depth reads recencyN 0 as 'all' via the slider max; store raw value
      const el = document.getElementById(d.el);
      return el ? String(pid === 'depth' && S.recencyN === 0 ? 0 : el.value) : undefined;
    }
  }
}

function _applyParam(pid, v) {
  const d = PARAM_DEFS[pid];
  if (!d || v === undefined) return;
  switch (d.kind) {
    case 'flow':     S.paintTicker = S.paintTicker || {}; S.paintTicker.intervalMs = +v || 50; return;
    case 'head':     try { const [w, e] = JSON.parse(v); S.headWidthDeg = +w || 0; S.headEdge = e === 'hard' ? 'hard' : 'soft'; } catch (_) {} return;
    case 'combAxis': S.combAxis = v; return;
    case 'combKeep': S.combKeep = v; return;
    case 'efrom':    S.eraseOldest = v === 'bottom'; return;
    case 'escope':   S.eraseWholeStroke = v === 'stroke'; return;
    case 'reads':    S.lensReads = ['both', 'grains', 'tape'].includes(v) ? v : 'both'; return;
    case 'fx': case 'tp': { const o = _pStore(d); if (o && isFinite(+v)) o[d.path] = +v; return; }
    case 'onend':    S.triggerParams.loopOnEnd = v === 'loop'; return;
    case 'gend':     setGrainOnEnd(v); return;
    case 'seg': {
      const seg = document.getElementById(d.seg);
      const btns = seg ? [...seg.querySelectorAll('button')] : [];
      const attr = btns[0] && Object.keys(btns[0].dataset)[0];
      const b = attr && btns.find(x => x.dataset[attr] === v);
      if (b && !b.classList.contains('active')) b.click();
      return;
    }
    default: {
      const el = document.getElementById(d.el);
      if (!el) return;
      if (pid === 'depth') {
        // depth 'all' (0) has no slider position, so the slider and state can
        // diverge — apply unconditionally rather than trusting el.value.
        if (String(v) === '0') { S.recencyN = 0; return; }
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      if (String(el.value) !== String(v)) {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }
}

// Radius is the cursor's, not any one lens's (Ek, 2026-08-27): moving it
// under spot carries to wide. So it is neither captured into a lens preset
// nor applied from one — one global reach, whatever glass is mounted.
// Pids that belong to the CURSOR, not to the tile whose sheet they appear on —
// excluded from both capture and apply, so opening a tool's page cannot move
// them and moving them cannot end up baked into a tool.
//
const GLOBAL_PIDS = new Set(['radius']);

/** Selecting a tile applies its preset — factory identity first, then
 *  whatever the tile has captured over it. A grain tile with no block yet
 *  adopts the live one, so from its first arming its sheet is its own. */
function applyTileParams(id) {
  const eng = engineOf(id);
  if (!eng) return;
  // The live-block poll must not read the values this apply writes as an
  // edit of the tile they belong to — see _pollLiveBlock. Before the adopt,
  // whose factory-sound writes it would otherwise capture as a hand edit.
  _pollQuietUntil = performance.now() + 400;
  if (eng === 'granular' && !_tileCfg[id]?.params) _adoptBlock(id);
  const persisted = _persists(id) ? (_tileCfg[id]?.params ?? {}) : {};
  const saved = { ...(FACTORY_PARAMS[id] ?? {}), ...persisted, ...(_sessionCfg[id] ?? {}) };
  for (const pid of ENGINES[eng]) {
    if (pid in saved && !GLOBAL_PIDS.has(pid)) _applyParam(pid, saved[pid]);
  }
  // The panel handlers COALESCE their S writes (30–50 ms), and the caller
  // renders immediately — so a row whose caption is derived from S rather than
  // from its element drew the PREVIOUS tile's value. `depth` is the visible
  // one: selecting scrape top read "last 3 strokes", then "all strokes", one
  // selection behind for ever (#287). Same 90 ms beat the engine rows use.
  setTimeout(() => { if (propsOpen()) renderProps(); }, 90);
}

/** Any edit while a tile is selected captures the whole engine back into it —
 *  Procreate's rule: the brush remembers. Debounced; ~25 cheap reads.
 *  `explicitId` lets a surface name its own capture target (the lens dock
 *  captures into the installed lens, whatever the optbar shows). */
let _capTimer = null;


function captureTileParams(explicitId) {
  const id = typeof explicitId === 'string' ? explicitId : sheetTileId();
  // Mid-stroke re-freezing is NOT done here any more. It belongs to the paint
  // ticker, which re-resolves before every deposit — that catches a gesture
  // sweeping a param, which never touches a control this capture would see.
  const eng = engineOf(id);
  if (!eng) return;
  clearTimeout(_capTimer);
  _capTimer = setTimeout(() => {
    const params = {};
    for (const pid of ENGINES[eng]) {
      if (GLOBAL_PIDS.has(pid)) continue;
      const v = _readParam(pid);
      if (v !== undefined) params[pid] = v;
    }
    if (_persists(id)) { _tileCfg[id] = { ...(_tileCfg[id] ?? {}), params }; _saveTileCfg(); }
    else _sessionCfg[id] = params;
    // The off-factory dot is decided at render time, and a capture is the
    // one moment a tile can become off-factory — so the rail has to be told.
    // Only on the transition, because this fires on every knob that lands
    // and re-rendering the whole rail per knob would be silly.
    if (!_touched.has(id)) { _touched.add(id); render(); }
  }, 250);
}

/** A grain tile's first block: the live one, read whole. The same read
 *  `_mintTile` does for a custom tool, so factory and custom tiles are the
 *  same kind of thing from here on. */
function _adoptBlock(id) {
  _tileCfg[id] = { ...(_tileCfg[id] ?? {}), params: _mintBlock(id) };
  _saveTileCfg();
}

/** The live grain block, read whole — positions, not units. */
function _readBlock() {
  const params = {};
  for (const pid of ENGINES.granular) {
    if (GLOBAL_PIDS.has(pid)) continue;
    const v = _readParam(pid);
    if (v !== undefined) params[pid] = v;
  }
  return params;
}

/** A tile's first block. A tile with a FACTORY SOUND is dialled to it first,
 *  so the block it adopts IS that sound — sliders take display text through
 *  the numbox, everything else its value straight — and the factory
 *  identity (`on end`) sits over the read: without it the block would record
 *  whatever the last tool left, and a persisted `scratch` would outrank the
 *  wash's `cloud` for ever. */
function _mintBlock(id) {
  for (const [pid, v] of Object.entries(FACTORY_SOUND[id] ?? {})) {
    if (PARAM_DEFS[pid]?.kind === 'slider') _paramTypeSet(pid, v); else _applyParam(pid, v);
  }
  return { ..._readBlock(), ...(FACTORY_PARAMS[id] ?? {}) };
}

/** Every factory grain tile owns a block from the first launch (2026-09-05).
 *  Born lazily — on the first arming, or on the first sheet edit — a block
 *  could be minted by an edit made BEFORE the tile was ever armed, from
 *  whatever the live block held, and the factory identity went under that
 *  first capture: the wash came up `scratch`, with no factory sound, on the
 *  profile engine-audit had driven. So the blocks are born here, once per
 *  profile: the live block put back as it was after each mint, and no sheet
 *  open to see any of it. */
function _birthFactoryBlocks() {
  const ids = Object.keys(TILE_DEFS).filter(id => engineOf(id) === 'granular' && !_tileCfg[id]?.custom && !_tileCfg[id]?.params);
  if (!ids.length) return;
  _pollQuietUntil = performance.now() + 600;
  const live = _readBlock();
  for (const id of ids) {
    _tileCfg[id] = { ...(_tileCfg[id] ?? {}), params: _mintBlock(id) };
    if (FACTORY_SOUND[id]) for (const [pid, v] of Object.entries(live)) _applyParam(pid, v);
  }
  _saveTileCfg();
}

// ── The live block is the hand's block ────────────────────────────────────
// The sheet's rows capture into the tile on their own (captureTileParams,
// wired per row), but a pot, a pedal or an OSC value writes S directly and
// never touches a row — and "what the sheet shows is set" has to hold for
// those too. So the resolved grain block is compared 10× a second against the
// last one seen, and a change while a grain tile is in the hand captures into
// it. `_pollQuietUntil` covers the window right after applyTileParams writes
// a tile's own values back into the live block: that is not an edit.
let _pollLast = null, _pollQuietUntil = 0;
function _pollLiveBlock() {
  const p = resolveGrainParams();
  if (performance.now() < _pollQuietUntil || !_pollLast) { _pollLast = p; return; }
  let same = true;
  for (const k in p) if (p[k] !== _pollLast[k]) { same = false; break; }
  if (same) return;
  _pollLast = p;
  // The tile the SHEET is about, not the hand: a slider moved on an engine
  // page belongs to the tile that page is for, and between presses there is
  // no hand at all. They were the same tile while the sheet followed the
  // armed tool.
  const id = sheetTileId();
  if (engineOf(id) === 'granular') captureTileParams(id);
}

/** The lens page's two live numbers, repainted at 5 Hz while its sheet is
 *  open. Text writes only — no layout read, nothing the grain scheduler can
 *  feel. The values come from the scheduler's own tick (grain.js, perf.kPool
 *  / perf.kCount), which runs whether or not the gesture is down: aim the
 *  cursor and the row says what it WOULD read before you play it.
 *
 *  `hot` is the whole point of the pair (Ek): taken === k means the ceiling
 *  is what is limiting the cursor, not the material — which is the one thing
 *  a ceiling has to be able to tell you. */
export function refreshLensLive() {
  if (!_propsOn) return;
  const sheet = document.getElementById('propRail');
  const kEl = sheet && sheet.querySelector('[data-klive]');
  if (!kEl) return;                              // not a lens sheet
  const all  = !!S.grainKAllMode && !S.nearestMode;
  const k    = S.grainOverrides.k ?? gp().k;
  const live = perf.kPool > 0;
  // Uncapped, the pair would be a lie — there is nothing to saturate against
  // — so the row says the one true number and what it is. The column is the
  // leftover 1fr in that state, so the word fits.
  const txt  = !live ? '—' : all ? `${perf.kCount} firing` : `${perf.kCount}/${k}`;
  if (kEl.textContent !== txt) kEl.textContent = txt;
  kEl.title = all
    ? 'marks firing — no ceiling, so nothing here can saturate'
    : 'marks taken / the ceiling — when they meet, k is what is limiting the cursor';
  kEl.classList.toggle('hot', live && !all && perf.kCount >= k);
  const rEl = sheet.querySelector('[data-reachlive]');
  if (rEl) {
    const t = live ? String(perf.kPool) : '—';
    if (rEl.textContent !== t) rEl.textContent = t;
  }
}

// ── Wet paint (Ek, 2026-09-03) ─────────────────────────────────────────────
// A brush is dry by default: its strokes freeze the block they were painted
// with. Toggle it WET and every stroke it paints from then on keeps following
// its rows — all of them, wherever the cursor is — until it is switched dry
// again, which freezes them where they sound. A property of the brush, saved
// with the tile, shown on the palette: the whole point over audition (the
// read-only tile this replaced) is that a dry brush's strokes can never be
// moved by anything, and you can see which brushes are wet without opening
// anything. The voicing side is brush-voicing.js "Wet paint".
// THE PEN SHIPS WET (Ek, 2026-09-07: "wet is more of a brush wide property i
// dont think i need a dedicated brush for it, but start the pen with the wet on
// by factory default"). There was a `pencil` for a few hours — the pen's wet
// twin — and the pair was one tool wearing two names, which is exactly the kind
// of thing the palette is meant not to have. Wet is a PROPERTY of any brush and
// the switch in the sheet head is where you set it; the only thing worth
// deciding centrally is which way it starts.
//
// `wet` is read three-valued: a stored boolean wins, and only an unconfigured
// tile falls to the factory. `setWet` therefore stores `false` rather than
// deleting the key — dropping it would spring the pen back to wet.
const FACTORY_WET = new Set(['pen']);
export function isWet(id) {
  const cfg = _tileCfg[id];
  return cfg && typeof cfg.wet === 'boolean' ? cfg.wet : FACTORY_WET.has(id);
}
export function setWet(id, on) {
  if (engineOf(id) !== 'granular') return false;
  on = on == null ? !isWet(id) : !!on;
  if (on === isWet(id)) return false;
  _tileCfg[id] = { ...(_tileCfg[id] ?? {}), wet: on };
  _saveTileCfg();
  // Off dries: the strokes keep the sound they have now, as a frozen block.
  if (!on) dryVoicing(id);
  render();
  if (propsOpen()) renderProps();
  return true;
}
// AUTO-PIN IS A PROPERTY OF THE TILE, like wet (Ek, 2026-09-12, night: "maybe
// the pin is the same as the wet, it's like a quickly visible property of that
// tile … auto loop at end of a tape engine, auto pin at end of a grain engine.
// yes that's smarter"). It IS the engine's own on-end switch — `gEnd` cloud
// for a grain tile, `onEnd` loop for a tape tile — read off the tile's stored
// block, so the mark is accurate by construction: the looper is line with it
// on, the wash is dots with it on. The row's pin button flips it; the sheet's
// switch is the same value from the other side.
function _tileParam(id, pid) {
  const s = _sessionCfg[id]?.[pid]; if (s !== undefined) return s;
  const p = _persists(id) ? _tileCfg[id]?.params?.[pid] : undefined; if (p !== undefined) return p;
  return FACTORY_PARAMS[id]?.[pid];
}
const _AUTOPIN = { granular: { pid: 'gEnd', on: 'cloud', off: 'scratch' }, tape: { pid: 'onEnd', on: 'loop', off: 'arm' } };
// DUB is pinned by nature (Ek, 2026-09-12, night: "the overdub one tool is
// special … it technically works with pinned items only. add the pin
// sticker to the tile"): its take joins the nearest pinned loop, or seeds
// one — there is no unpinned outcome — so it wears the mark always and the
// mark is not a switch on it.
export function isAutoPin(id) {
  if (id === 'overdub') return true;
  const a = _AUTOPIN[engineOf(id)];
  return !!a && _tileParam(id, a.pid) === a.on;
}
export function setAutoPin(id, on) {
  if (id === 'overdub') return false;
  const a = _AUTOPIN[engineOf(id)]; if (!a) return false;
  on = on == null ? !isAutoPin(id) : !!on;
  if (on === isAutoPin(id)) return false;
  const v = on ? a.on : a.off;
  if (_persists(id)) { _tileCfg[id] = { ...(_tileCfg[id] ?? {}), params: { ...(_tileCfg[id]?.params ?? {}), [a.pid]: v } }; _saveTileCfg(); }
  else _sessionCfg[id] = { ...(_sessionCfg[id] ?? {}), [a.pid]: v };
  // The sheet's tile OWNS the live block, so the live flag follows only then;
  // any other tile's press re-applies its whole block anyway (_applyHand).
  if (sheetTileId() === id) _applyParam(a.pid, v);
  render();
  if (propsOpen()) renderProps();
  return true;
}
/** The tile in the HAND — the position that is PLAYING, and null between
 *  presses (2026-09-11: nothing is held when nothing sounds). This is what a
 *  stroke freezes from and what wet paint follows. Every stroke starts from a
 *  position press, so it is never null while one is running. */
function handTileId() { return _held?.id ?? null; }

function _numFor(def) {
  if (def.num) return def.num;
  return def.el ? def.el.replace('Slider', 'Num') : null;
}
function _rowFor(pid) {
  const d = PARAM_DEFS[pid];
  if (!d) return '';
  if (d.kind === 'flow')     return _flowRow();
  if (d.kind === 'head')     return _headRows();
  if (d.kind === 'combAxis') {
    const ax = [['centroid', 'bright'], ['rms', 'loud'], ['zcr', 'noisy']].map(([v, l]) =>
      `<span class="${S.combAxis === v ? 'on' : ''}" data-combaxis="${v}">${l}</span>`).join('');
    return `<span class="opt"><i>sort by</i><span class="seg">${ax}</span></span>`;
  }
  if (d.kind === 'combKeep') {
    const kp = ['all', 'high', 'low'].map(v =>
      `<span class="${S.combKeep === v ? 'on' : ''}" data-combkeep="${v}">${v}</span>`).join('');
    return `<span class="opt"><i>keep</i><span class="seg">${kp}</span></span>`;
  }
  if (d.kind === 'reads') {
    const seg = [['both', 'grains and tape'], ['grains', 'grains only — tape strokes do not fire'],
                 ['tape', 'tape only — no granulation under the cursor']].map(([v, t]) =>
      `<span class="${S.lensReads === v ? 'on' : ''}" data-reads="${v}" title="${t}">${v}</span>`).join('');
    return `<span class="opt"><i>reads</i><span class="seg">${seg}</span></span>`;
  }
  if (d.kind === 'escope') {
    const seg = [['touch', false], ['stroke', true]].map(([l, v]) =>
      `<span class="${!!S.eraseWholeStroke === v ? 'on' : ''}" data-escope="${l}">${l}</span>`).join('');
    return `<span class="opt"><i>erases</i><span class="seg">${seg}</span></span>`;
  }
  if (d.kind === 'efrom') {
    const seg = [['top', false], ['bottom', true]].map(([l, v]) =>
      `<span class="${!!S.eraseOldest === v ? 'on' : ''}" data-efrom="${l}">${l}</span>`).join('');
    return `<span class="opt"><i>from</i><span class="seg">${seg}</span></span>`;
  }
  if (d.kind === 'fx' || d.kind === 'tp') {
    const v = (+(_pStore(d)?.[d.path]) - d.min) / (d.max - d.min || 1);
    return `<span class="opt"><i>${d.label}</i>` +
      `<span class="tr live" data-fx="${pid}"><i class="thumb" style="left:calc(${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}% - 1px)"></i></span>` +
      `<b data-fxread="${pid}">${d.fmt(_pStore(d)?.[d.path])}</b></span>`;
  }
  if (d.kind === 'fadecurve') return _fadeCurveRow();
  if (d.kind === 'seg') return _segRowAuto(d.label, d.seg);
  // slider — display from the paired numbox when one exists
  const el = document.getElementById(d.el);
  if (!el) return '';
  const min = +el.min, max = +el.max, v = (+el.value - min) / (max - min || 1);
  const numId = _numFor(d);
  const numEl = numId && document.getElementById(numId);
  const disp = d.read ? _readVal(d.read) : (numEl ? (numEl.value ?? numEl.textContent) : el.value);
  const readAttr = d.read ? `data-read="${d.read}"` : `data-readnum="${numId ?? ''}" data-readel="${d.el}"`;
  return `<span class="opt"><i>${d.label}</i>` +
    `<span class="tr live" data-slider="${d.el}"${numId ? ` data-num="${numId}"` : ''}>` +
    `<i class="thumb" style="left:calc(${(v * 100).toFixed(1)}% - 1px)"></i></span>` +
    `<b ${readAttr}>${disp}</b></span>`;
}
// ── Icon segments (Ek, 2026-09-03: "consider icons instead of the all caps
// text if it makes sense, especially the lens engine") ──────────────────────
// Keyed by cabinet seg id, then by the option's data value. The cabinet keeps
// its words (and Settings, which borrows the same elements, keeps showing
// them); only the sheet swaps a word for its glyph, and the word becomes the
// title. Only where the glyph IS the thing: area / nearest are the wide and
// spot lens marks the palette already wears; k / all are few dots / every dot;
// random / step are the shuffle already used for random direction and a
// stair; fade on / off are a ramp and a flat.
const SEG_ICONS = {
  snapToggleSeg: {
    off: () => SCOPE_G.wide,
    on:  () => SCOPE_G.spot,
  },
  kAllSeg: {
    off: () => '<circle cx="6" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="18" cy="12" r="1.9"/>',
    on:  () => [5.5, 12, 18.5].flatMap(x => [5.5, 12, 18.5].map(y => `<circle cx="${x}" cy="${y}" r="1.8"/>`)).join(''),
  },
  kSeqSeg: {
    off: () => '<path d="M3 7h4l10 10h4M3 17h4l10-10h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 4.5L21 7l-2.5 2.5M18.5 14.5L21 17l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    on:  () => '<path d="M3 19h5v-5h5V9h5V4h3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>',
  },
  radiusFadeSeg: {
    on:  () => '<path d="M3 18L21 6v12z"/>',
    off: () => '<rect x="3" y="9" width="18" height="6" rx="1"/>',
  },
};
const _segIcon = (segId, val) => SEG_ICONS[segId]?.[val]?.() ?? null;

// _segRow without knowing the data attribute — segs name theirs differently
// (data-dwell, data-curve, data-kall …); auto-detect from the first button.
function _segRowAuto(label, segId) {
  const seg = document.getElementById(segId);
  if (!seg) return '';
  const btns = [...seg.querySelectorAll('button')];
  if (!btns.length) return '';
  const attr = Object.keys(btns[0].dataset)[0];
  if (!attr) return '';
  return `<span class="opt"><i>${label}</i><span class="seg">` +
    btns.map(b => {
      const ico = _segIcon(segId, b.dataset[attr]);
      return `<span class="${b.classList.contains('active') ? 'on' : ''}${ico ? ' seg-ico' : ''}"` +
        ` data-proxy="${segId}" data-val="${b.dataset[attr]}" title="${b.textContent.trim()}">` +
        (ico ? `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ico}</svg>` : b.textContent) + `</span>`;
    }).join('') +
    `</span></span>`;
}

// ── Options bar — the selected tile's settings, write-through ───────────────

// A slider row that writes through a real panel element and dispatches
// 'input', reading its display value back from S via `read`.
function _sliderRow(label, elId, read) {
  const el = document.getElementById(elId);
  if (!el) return '';
  const min = +el.min, max = +el.max, v = (+el.value - min) / (max - min || 1);
  return `<span class="opt"><i>${label}</i>` +
    `<span class="tr live" data-slider="${elId}"><i class="thumb" style="left:calc(${(v * 100).toFixed(1)}% - 1px)"></i></span>` +
    `<b data-read="${read}">${_readVal(read)}</b></span>`;
}

const READS = {
  radius:  () => `${S.searchRadiusDeg}°`,
  depth:  () => {
    const n = S.recencyN;
    if (!(n > 0)) return 'all strokes';
    const s = n === 1 ? 'stroke' : 'strokes';
    // A scrape reading from the bottom takes the OLDEST n — say so (Ek).
    // The lens always reads newest-first, so only erase tiles flip the word.
    // The unit STAYS (docs/VOCABULARY.md: "last 3 strokes", never a bare 3);
    // the value column is sized for it — see --prow-val.
    const id = sheetTileId();
    return engineOf(id) === 'erase' && S.eraseOldest ? `first ${n} ${s}` : `last ${n} ${s}`;
  },
  flow:   () => `${(S.paintTicker && S.paintTicker.intervalMs) ?? 50}ms`,
  fadeCurve: () => `${Math.round((S.radiusFadeCurve ?? 0.5) * 100)}%`,
  head:   () => (S.headWidthDeg > 0 ? `${S.headWidthDeg}°` : 'line'),
  dur:    () => `${Math.round((S.grainOverrides.duration ?? S.grainParams.duration) * 1000)}ms`,
  period: () => `${((S.grainOverrides.period ?? S.grainParams.period) * 1000).toFixed(0)}ms`,
  pitch:  () => `${Math.round(S.grainOverrides.pitchShift ?? 0)}¢`,
  speed:  () => `${(S.triggerParams.speed ?? 1).toFixed(2)}×`,
};
function _readVal(k) { return READS[k] ? READS[k]() : ''; }

// The falloff diagram — x is distance from the cursor (centre → radius
// edge), y is volume; the drawn shape IS the gain the worklet bridge applies
// (gain = (1 − d/r)^(1 + curve×3)). Drag vertically: pull the belly down for
// a tighter centre, up for an even ramp. Writes through the panel slider.
function _fadePathD(c, w, h) {
  const exp = 1 + (Math.max(0, Math.min(1, c))) * 3;
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const g = Math.pow(1 - t, exp);
    pts.push(`${(t * w).toFixed(1)},${((1 - g) * (h - 2) + 1).toFixed(1)}`);
  }
  return 'M' + pts.join(' L');
}
function _fadeCurveRow() {
  const c = S.radiusFadeCurve ?? 0.5;
  const w = 72, h = 30;
  const off = !S.radiusFadeEnabled;
  return `<span class="opt"><i>falloff</i>` +
    `<span class="fcurve${off ? ' fcurve-off' : ''}" data-fadecurve="1" title="volume from cursor centre (left) to the radius edge (right) — drag: down = tight centre, up = even ramp${off ? ' — fade is OFF' : ''}">` +
    `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">` +
    `<line class="fc-base" x1="0" y1="${h - 1}" x2="${w}" y2="${h - 1}"/>` +
    `<path class="fc-line" d="${_fadePathD(c, w, h)}"/>` +
    `</svg></span>` +
    `<b data-read="fadeCurve">${_readVal('fadeCurve')}</b></span>`;
}

// Flow — the deposit clock, surfaced (#211: the tick is a brush property,
// not a hidden global; this is its first surface). Still ONE value under the
// hood until tiles own their settings (#214); shown on the granular family
// because marks-per-second is both their spatial resolution and their onset
// density. 15–200 ms; the row label reads as rate, the state stays ms.
function _flowRow() {
  const ms = (S.paintTicker && S.paintTicker.intervalMs) ?? 50;
  const v = 1 - Math.min(1, Math.max(0, (ms - 10) / 190));   // left = sparse
  return `<span class="opt"><i>rate</i>` +
    `<span class="tr live" data-flow="1"><i class="thumb" style="left:calc(${(v * 100).toFixed(1)}% - 1px)"></i></span>` +
    `<b data-read="flow">${_readVal('flow')}</b></span>`;
}

// The brush head (#218) — static paint qualities, no panel mirror either.
function _headRows() {
  const v = Math.min(1, (S.headWidthDeg || 0) / 30);
  const seg = ['hard', 'soft'].map(x =>
    `<span class="${S.headEdge === x ? 'on' : ''}" data-headedge="${x}">${x}</span>`).join('');
  return `<span class="opt"><i>head</i>` +
    `<span class="tr live" data-head="1"><i class="thumb" style="left:calc(${(v * 100).toFixed(1)}% - 1px)"></i></span>` +
    `<b data-read="head">${_readVal('head')}</b></span>` +
    `<span class="opt"><i>edge</i><span class="seg">${seg}</span></span>`;
}

/** The PERFORM QUICK VIEW IS GONE (#251, Ek). It was three strips under the
 *  row — the open tile's visible params, the installed lens's, and a foot
 *  note — and the properties panel repeated all of it at full size, so the
 *  same number showed twice on one screen. One parameter, one place.
 *
 *  This keeps the name every option handler already calls after an edit; it
 *  repaints the panel when the panel is what is showing. */
export function renderOptions() {
  if (_propsOn) renderProps();
}

// Non-engine extras and empty-state notes, per tile.
function _extrasFor(id) {
  if (id === 'slice')    return `<span class="opt-none">cuts at onsets, floor-adaptive — tuning in js/onsets.js</span>`;
  if (id === 'overdub')  return `<span class="opt-none">the master decides — the nearest pinned loop at the press: its length, its speed, its mix. The take plays at 1×</span>`;
  if (id === 'spray') return `<span class="opt-none">head is dynamic — scatter rides your speed, width rides your voice</span>`;
  if (id === 'match')    return `<span class="opt-none">corpus = everything painted; your voice picks the moments</span>`;
  if (id === 'staff')    return `<span class="opt-none">latitude is brightness — 6 octaves, low at the bottom</span>`;
  if (id === 'spot')     return `<span class="opt-none">locks the closest marks — depth and fade do not apply</span>`;
  // Naming and retiring a tool used to live here as a field and a button
  // (#283). They moved to the rail row itself (#284): the row IS the tool, so
  // double-clicking its name renames it and a `del` appears on hover. Two
  // fewer controls in the sheet, and neither needs the sheet open.
  return '';
}
function _noteFor(id) {
  const t = TILE_DEFS[id];
  if (t?.kind === 'edit') {
    return id === 'all' ? 'everything the lens reaches — depth forced off for the hold'
      : id === 'bottom' ? 'one layer off the bottom — the oldest material in reach'
      : 'one layer off the top — the newest material in reach';
  }
  if (t?.ghost) return t.foot.replace(/<[^>]+>/g, '');
  return 'no settings visible — open design view to choose what shows here';
}

// ── PROPERTIES (#223, reshaped by #251) — the footer section ────────────────
// Every parameter of the selected tool or lens, in a section under the tile
// row. Not a page flip (the sphere stayed visible for a reason) and not a
// drawer over the stage (it moved and resized under you). A FIXED-HEIGHT
// footer you show or hide: the sphere keeps its own space, the panel keeps
// its own, and a deep engine scrolls inside a box whose size never changes.
let _propsOn = false;
/** Which rail row the properties sheet was opened FROM — what the ⋯ and Tab
 *  toggle against, so a second click on the SAME row shuts the sheet and a
 *  click on a different one moves it. */
let _propRow = null;

/** The chrome pill shows/hides the TOOL rail. The properties rail follows
 *  what you click in it, and closing the tool rail closes both — a device
 *  view with no list beside it is orphaned. */
export function setPropsOpen(on) {
  _propsOn = !!on;
  document.body.classList.toggle('props-open', _propsOn);
  if (!_propsOn) { document.body.classList.remove('prail-open'); _propRow = null; }
  const pill = document.getElementById('tcTools');
  if (pill) { pill.classList.toggle('on', _propsOn);
              pill.setAttribute('aria-pressed', String(_propsOn)); }
  if (_propsOn) { render(); renderProps(); }
  // The rails OVERLAY the stage now rather than taking grid rows, so opening
  // them no longer resizes the canvas — but the event stays: it is what the
  // renderer re-measures on, and it costs nothing.
  window.dispatchEvent(new Event('resize'));
}
export function propsOpen() { return _propsOn; }

/** Open the properties rail on a specific tool or lens. */
export function openProps(id, kind = 'tool') {
  // There is ONE grain block, and while a filter is installed it is the
  // filter's (#292) — so a brush's page opened under a filter would show the
  // filter's numbers under the brush's name, and editing them would move both.
  // The tool still arms; only the page refuses to follow. renderProps pins the
  // same way, and pinning here too is what keeps the rail's `open` mark from
  // pointing at a row the sheet is not showing.
  _optSel = { kind, id };
  _propRow = id;
  _propsOn = true;
  document.body.classList.add('props-open');
  document.body.classList.add('prail-open');
  const pill = document.getElementById('tcTools');
  if (pill) { pill.classList.add('on'); pill.setAttribute('aria-pressed', 'true'); }
  render();
  renderProps();
}

/** Close the properties rail but leave the tool list up. */
export function closeProps() {
  document.body.classList.remove('prail-open');
  _propRow = null;
  render();
}

/** ⇧` (tilde) — the tool rail, shown or hidden; the same act as the chrome's
 *  tools pill. Ek asked for plain backtick, but ` is already TARE — the one
 *  thing you hit mid-performance to re-zero the sensor — so this takes the
 *  shifted key and tare keeps the bare one. It used to walk four steps (rail,
 *  sheet, sheet closed, rail closed) with a remembered step to tell two of
 *  them apart; with Tab owning the drawer there is one thing left for it to
 *  do, and nothing to remember. */
export function toggleRail() { setPropsOpen(!propsOpen()); }

/** The drawer, open or shut — the ⋯ on a row (Tab took it from 2026-09-03
 *  to 2026-09-12; Tab is the rail's now). Shut only when it is showing THIS
 *  thing: the ⋯ with another page up brings this page, not darkness. */
function toggleSheet(id, kind = 'tool') {
  const showing = document.body.classList.contains('prail-open') && _propRow === id;
  if (showing) closeProps(); else openProps(id, kind);
}

// The drawer carried the position's verb segment from 2026-09-11 to
// 2026-09-12. The verb is the PLACEMENT's, and the right-click on the strip
// tile is its one control now (Ek: "it doesn't need to be on the master tile
// drawer sheet"); the drawer is the TOOL's — the block every placement of that
// tool plays.

export function renderProps() {
  const sheet = document.getElementById('propRail');
  if (!sheet) return;
  // ── Order matters here, and got it wrong twice (#275) ────────────────────
  // The FILTER first: it is a state that overrides whatever is selected, so it
  // has to be settled before the source guard — with the sampler last-tapped,
  // the guard was returning before the filter's sheet could draw and the
  // filter looked dead. It does not get a sheet of its own any more (#292):
  // it is a tile of the granular engine, so it goes down the ordinary path and
  // gets the ordinary sheet — the sound window, the drawn filter graph, the
  // link pill, the octave capsule, typed values, the lot.
  // The sampler's sheet is ui-source.js's to draw; the shell only opens the
  // rail for it. Without this guard render()'s tail would repaint the rail
  // with the picked BRUSH's engine a frame after the sampler filled it. It
  // still gets the WIDE rail — it is a library of waveform rows, and at the
  // narrow width it was crushed — so the class is set before returning.
  if (_optSel.kind === 'source') {
    // The sampler draws its own sheet (ui-source.js). A click there renders it
    // after opening; Tab reopens through here, so the sheet is drawn here too.
    S._renderSamplerSheet?.();
    document.body.classList.add('engine-page'); return;
  }
  document.body.classList.remove('engine-page');
  const isLens = _optSel.kind === 'lens';
  // Whatever the drawer is pointed at — the one answer, see sheetTileId.
  const id = sheetTileId();
  // A custom lens is not in LENSES — it is a tile whose engine is `lens`, so
  // the lookup has to fall through to the tile store or the sheet renders
  // against `undefined` and throws before it draws anything (#283).
  const meta = isLens ? (LENSES.find(s => s.id === id) ?? tileById(id)) : tileById(id);
  const eng = engineOf(id);
  if (!eng) {
    // A pin tile has no engine and therefore no rows — but it does have a
    // VERB, and § 4 puts the verb in the drawer head. So the head alone is its
    // sheet, and this is the only door to it.
    sheet.innerHTML = `<div class="ds-head"><b style="color:${meta?.c}">${meta?.label ?? ''}</b>` +
      `<span>no engine — ${_noteFor(id)}</span>` +
      `<button type="button" class="ds-close" title="hide properties (Esc)"><kbd>esc</kbd>✕</button></div>`;
    return;
  }
  // Same rule as the strip: the accent is the ENGINE's, not the tile's (#257).
  const isGrainEng = eng === 'granular';
  const _cs = getComputedStyle(document.body);
  const accent = (_cs.getPropertyValue('--eng-' + (isGrainEng ? 'grain' : eng)).trim())
    || _cs.getPropertyValue('--eng-none').trim() || '#8a9090';

  // Group by section, in registry order — the SAME sheet for every tile of
  // an engine; only the eyes differ.
  const sections = [];
  let cur = null;
  // The overdub brush has no dials of its own: its master decides the
  // length, the speed and the mix, and the take lands at 1× (§ 2 of the plan).
  for (const pid of (id === 'overdub' ? [] : ENGINES[eng])) {
    const d = PARAM_DEFS[pid];
    if (!d) continue;
    // Nearest bypasses the radius and the recency filter outright (grain.js
    // hands the WHOLE sphere to the selection pass), and `fill: all` is a
    // no-op there too — `const all = S.grainKAllMode && !S.nearestMode`. The
    // hidden cabinet has always known this (#areaOnlyParams); the sheet did
    // not, so three of the lens page's six rows were dead in nearest mode and
    // none of them said so. That is most of why the page reads as confusing.
    if (eng === 'lens' && S.nearestMode && (pid === 'radius' || pid === 'depth')) continue;
    // Same rule for what the lens READS: a lens reading only tape granulates
    // nothing, so k and order have no job; one reading only grains fires no
    // tape, so the whole `on tape` family is inert. `radius` survives both —
    // the trigger gate's reach IS the cursor's search radius.
    if (eng === 'lens' && S.lensReads === 'tape' && (pid === 'k' || pid === 'korder')) continue;
    if (eng === 'lens' && S.lensReads === 'grains' && (d.sec === 'on tape')) continue;
    if (!cur || cur.name !== (d.sec ?? '')) { cur = { name: d.sec ?? '', pids: [] }; sections.push(cur); }
    cur.pids.push(pid);
  }
  // A section can end up empty once its rows are hidden — drop it rather than
  // print a heading with nothing under it.
  for (let i = sections.length - 1; i >= 0; i--) if (!sections[i].pids.length) sections.splice(i, 1);

  // Every parameter, drawn the same: one line, name · control · number.
  // Amounts get a track; CHOICES stay segmented — they are not quantities and
  // a slider through three named options is a lie about the data.
  // Full-width rows: the two parameters that decide what granular sounds
  // like, and which carry a ± band that needs the width to be readable.
  const WIDE = new Set(['dur', 'period', 'pitch', 'vol']);
  // Rows that share a line: the shape of the grain window and how much of the
  // grain that shape occupies are one idea, so they read as one line.
  // Curve had been folded onto taper's line (#278); it is back on its own
  // half-row with its own title (#281) — the window's SHAPE is a first-class
  // choice, not a footnote to how much of the grain it occupies.
  const PAIRED_WITH = {};
  const PAIRED_IN = new Set(Object.values(PAIRED_WITH));

  // ── Octave, as a state and not three steppers ───────────────────────────
  // Steppers in a capsule would lie about the shape (#267): a capsule says
  // "pick one of N". So this IS one of N — which octave the pitch sits in,
  // read back from the pitch itself. Picking one moves to that octave and
  // KEEPS the cents you had inside it, so the fine control below stays true.
  const octaveRow = () => {
    const rg = _knobRange('pitch');
    if (!rg) return '';
    const cents = _knobVal('pitch').raw;
    const cur = Math.max(-2, Math.min(2, Math.round(cents / 1200)));
    const opts = [-2, -1, 0, 1, 2].map(o =>
      `<span class="${o === cur ? 'on' : ''}" data-oct="${o}">${o > 0 ? '+' + o : o}</span>`).join('');
    // Five segments span the row: they do not fit a half column once the
    // pills have real padding, and `overflow: hidden` on the capsule clips
    // silently. The note is gone — the pill already says which octave you are
    // in, and the cents remainder is on the pitch row above it (#283).
    return `<div class="prow prow--seg prow--segwide"><span class="prow-n">octave</span>` +
      `<div class="ds-chips"><span class="opt"><span class="seg seg-pill" data-octsel>${opts}` +
      `</span></span></div></div>`;
  };

  // ── The two rows that carry a live number (2026-09-07) ──────────────────
  // Ek: "K is more of the max pool size. so we can set it at a higher number
  // and once it hits it, then i know i've maxed out the pool on the cursor."
  // That turns k from a sculpting knob into a CEILING, and a ceiling is only
  // useful next to the count that is pressing on it. The numbers already
  // existed — perf.kPool and perf.kCount, written by the scheduler every tick
  // — but only the perf monitor showed them, which is a debug overlay and not
  // the instrument.
  //
  // Each number goes on the row that CAUSES it: radius decides how many marks
  // are in reach, so the reach count sits there; k decides how many of them
  // are taken, so `taken / k` sits there and goes hot when they are equal.
  // Nothing needs a meter panel of its own.
  const kRow = () => {
    const nearest = !!S.nearestMode;
    const all = !!S.grainKAllMode && !nearest;
    // The capsule is the question Ek wanted asked first — a number, or all —
    // and it leads the row rather than standing above it. In nearest mode it
    // is not drawn at all, because 'all' there would mean the whole sphere.
    const cap = nearest ? '' : `<div class="ds-chips">${_rowFor('fill')}</div>`;
    const live = `<span class="prow-note" data-klive></span>`;
    const cls = all ? 'prow prow--lensk prow--lensk-all'
              : nearest ? 'prow prow--lensk prow--lensk-near' : 'prow prow--lensk';
    // Uncapped: the slider and its number would be a lie, so they are not
    // drawn. What is left is the count that IS firing.
    return `<div class="${cls}"><span class="prow-n">${PARAM_DEFS.k.label}</span>${cap}` +
      (all ? '' : _knobFor('k')) + live + `</div>`;
  };
  const radiusRow = () =>
    `<div class="prow prow--lensr"><span class="prow-n">${PARAM_DEFS.radius.label}</span>` +
    _knobFor('radius') + `<span class="prow-note" data-reachlive title="marks in reach — inside the radius, after recency"></span></div>`;

  // ── Booleans wear the SWITCH (Ek, 2026-09-07) ───────────────────────────
  // "there's a bunch of on and off simple toggles. there's already a nice
  // toggle design, the engine sheet should use that if it is on and off."
  // INSTRUMENT-GUI § 3 already assigns the shape — "do you want it? set and
  // forget → switch" — and had exactly one instance, a grain brush's `wet`.
  // These four ask the same question and were wearing `on | off` segments,
  // which is the shape for "WHICH one?" and made a yes/no look like a mode
  // pick. `on end`'s `arm | loop` was the worst of them: `arm` named the
  // absence of the thing (Ek: "arm is confusing. it's more like loop on end?
  // yes or no"), so the row is now `loop on end` with a switch.
  const swRow = (label, on, attrs, title) =>
    `<div class="prow prow--sw"><span class="prow-n">${label}</span>` +
    `<button type="button" class="ds-sw${on ? ' on' : ''}" role="switch"` +
    ` aria-checked="${on}"${attrs}${title ? ` title="${title}"` : ''}>` +
    `<i class="mu-switch"><b></b></i></button></div>`;

  const cell = pid => {
    if (pid === 'glink')  return swRow('link', _grainLink.on, ' data-sw="glink"',
      _grainLink.on ? `linked — period follows duration at ${_grainLink.ratio.toFixed(2)}\u00d7`
                    : 'free — duration and period move on their own');
    if (pid === 'octave') return octaveRow();
    if (pid === 'gEnd')   return swRow('cloud on end', _GEND_OF[S.traceMode] === 'cloud', ' data-sw="gend"',
      'on — the stroke is pinned as a moving cloud on the path you drew, and keeps playing; off — it stays scratch, read only by the cursor');
    if (pid === 'onEnd')  return swRow('loop on end', !!S.triggerParams.loopOnEnd, ' data-sw="onend"',
      'on — the stroke loops when it ends; off — it is armed, and the cursor fires it');
    if (pid === 'rfade')  return swRow('fade', !!S.radiusFadeEnabled, ' data-swproxy="radiusFadeSeg" data-swon="on" data-swoff="off"',
      'volume fades with distance from the cursor');
    if (pid === 'tchop')  return swRow('chop', !!S.triggerParams.chopOn, ' data-swproxy="trigChopSeg" data-swon="on" data-swoff="off"',
      'cut the next take at its onsets');
    if (eng === 'lens' && pid === 'k')      return kRow();
    if (eng === 'lens' && pid === 'radius') return radiusRow();
    // Folded into its base parameter's row (#277).
    if (IS_VAR.has(pid) && VAR_OF[Object.keys(VAR_OF).find(k => VAR_OF[k] === pid)]) return '';
    if (PAIRED_IN.has(pid)) return '';                    // drawn by its partner
    const d = PARAM_DEFS[pid];
    const kn = _knobFor(pid);
    if (kn) {
      const mate = PAIRED_WITH[pid];
      const mateRow = mate && _rowFor(mate);
      // Two rows carry an extra control at their end: period the LINK, pitch
      // the octave steps (which the tile screen had no way to reach at all).
      const tail = '';
      const cls = 'prow' + (VAR_OF[pid] ? ' prow--var' : '') +
                  (WIDE.has(pid) ? ' prow--wide' : '') + (mateRow ? ' prow--duo' : '') +
                  (tail ? ' prow--tail' : '');
      return `<div class="${cls}"><span class="prow-n">${d.label}</span>${kn}` +
        (mateRow ? `<span class="prow-n prow-n--mate">${PARAM_DEFS[mate].label}</span>` +
                   `<div class="ds-chips">${mateRow}</div>` : '') + tail + `</div>`;
    }
    const row = _rowFor(pid);
    if (!row) return '';
    return `<div class="prow prow--seg"><span class="prow-n">${d.label}</span>` +
      `<div class="ds-chips">${row}</div></div>`;
  };

  // A grain brush's head carries its WET switch (Ek, 2026-09-03) — the one
  // "do you want it?" boolean in the instrument, so it is the kit's switch
  // shape (docs/INSTRUMENT-GUI.md § 3), built here for the first time. It
  // is a property of the brush, saved with the tile: wet, and every stroke
  // this brush paints keeps following these rows; dry, and each stroke
  // freezes the rows as they were when it was painted. Switching it off
  // dries the strokes it already painted, where they sound.
  // WET is a deposit row now, not a head item (Ek, 2026-09-10: "move the wet
  // toggle into the actual deposit params") — see the deposit section below.
  // Delete, on EVERY tool's head (Ek, 2026-09-10: "del is now a consistent
  // button on all engine sheets"), factory or yours — a factory reset brings
  // the originals back (deleteTile). The one refusal: the last tool of a
  // kind, or the last lens, stays, so a slot and the eye always hold
  // something; the word says so rather than vanishing.
  const lastOne = isLens ? lensAll().length <= 1 : (slotKind(id) ? kindAll(slotKind(id)).length <= 1 : false);
  // A bare red word beside the esc ✕ (Ek, 2026-09-10: "just a simple del red
  // text beside the esc is fine"). It was the settings Clear-all button for
  // an hour, then a second row for it; both were more than the head could
  // carry beside its name. One row again.
  const delBtn = `<button type="button" class="ds-del" data-deltile${lastOne ? ' disabled' : ''}` +
    ` title="${lastOne ? (isLens ? 'the last lens stays — the cursor always reads through one' : 'the last tool of its kind stays — its slot always holds something')
                      : (meta.custom ? 'delete this tool' : 'delete this tool — a factory reset (Settings → Export · import · reset) brings it back')}">del</button>`;
  sheet.innerHTML =
    `<div class="ds-head"><b style="color:${accent}">${meta.label}</b>` +
    `<span>${eng} engine</span>${delBtn}` +
    `<button type="button" class="ds-close" title="hide properties (Esc)"><kbd>esc</kbd>✕</button></div>` +
    // The drawer is WIDE and SHORT where the page flip was tall, so the
    // sections column-pack instead of stacking (#249): granular's six
    // sections stacked scrolled 692px inside a 332px drawer, which is worse
    // than the page it replaced. .ds-body carries the columns.
    // The granular engine's FILTER section is a drawing, not four rows.
    (isGrainEng
      ? `<div class="eng-scope"><canvas id="engScope" data-accent="${accent}"></canvas>` +
        `<div class="eng-scope-cap"><span id="engScopeL"></span><span id="engScopeR"></span></div></div>`
      : '') +
    `<div class="ds-body">` +
    sections.map(sc => {
      if (isGrainEng && sc.name === 'filter') {
        // The drawing answers "what shape is this"; the rows answer "what
        // exactly, and let me type it". Both, not either — the graph is the
        // fastest way to grab an edge and the worst way to set 4.2k (#283).
        // The old text caption under the canvas said the same four numbers the
        // rows now say, so it is gone.
        return `<div class="ds-sec"><div class="ds-sec-h">filter</div>` +
          `<canvas id="engFilter" data-accent="${accent}" title="drag the edges for hpf / lpf · up and down for Q · double-click resets"></canvas>` +
          `<div class="ds-sec-cells">${sc.pids.map(cell).join('')}</div></div>`;
      }
      // Experimental is a long tail of tuning constants nobody opens in a
      // session — it starts folded so the sections that ARE played sit above
      // the fold (#283). Session-scoped, not persisted: it is a disclosure,
      // not a preference.
      const fold = sc.name === 'experimental';
      const shut = fold && !_expOpen;
      // WET leads the grain brush's DEPOSIT section (Ek, 2026-09-10; it was
      // a head item from 2026-09-03). It is the brush's property, not a grain
      // parameter — brush-voicing.js "wet paint" — so it is not a PARAM_DEF;
      // it wears the section's own switch row and the `[data-wet]` binding
      // below flips it.
      const wetRow = isGrainEng && sc.name === 'deposit'
        ? swRow('wet', isWet(id), ' data-wet', isWet(id)
            ? 'WET — these rows keep moving every stroke this brush painted. Switch off to dry them where they sound'
            : 'dry — a stroke freezes these rows as they were when it was painted. Switch on and every stroke this brush paints from now on follows them')
        : '';
      return `<div class="ds-sec${shut ? ' ds-sec--shut' : ''}">` +
        (fold
          ? `<button type="button" class="ds-sec-h ds-sec-h--fold" data-fold aria-expanded="${!shut}">` +
            `<span class="ds-fold-c">${shut ? '\u203a' : '\u2039'}</span>${sc.name}` +
            `<span class="ds-fold-n">${sc.pids.length}</span></button>`
          : `<div class="ds-sec-h">${sc.name}</div>`) +
        `<div class="ds-sec-cells">${wetRow}${sc.pids.map(cell).join('')}</div></div>`;
    }).join('') +
    (_extrasFor(id) ? `<div class="ds-extras">${_extrasFor(id)}</div>` : '') +
    `</div>`;

  // Rows paint their fill and handle from --c. It used to arrive on each cell
  // as an inline style on the knob; when knobs became rows (#261) that went
  // with them and nothing replaced it, so `background: var(--c)` resolved to
  // transparent — the handle moved every time and was invisible every time,
  // and the only mark you could see was the static default tick (#274). The
  // accent belongs on the panel root, once.
  sheet.style.setProperty('--c', accent);
  sheet.querySelectorAll('[data-octsel] [data-oct]').forEach(b =>
    b.addEventListener('click', () => {
      const rg = _knobRange('pitch'); if (!rg) return;
      const cents = _knobVal('pitch').raw;
      const cur = Math.round(cents / 1200);
      const rem = cents - cur * 1200;              // the cents inside the octave
      const want = +b.dataset.oct * 1200 + rem;
      _knobSet('pitch', Math.max(rg.min, Math.min(rg.max, want)));
      captureTileParams();
      setTimeout(() => { renderProps(); S._drawEngineScope?.(); }, 90);
    }));
  sheet.querySelectorAll('[data-fold]').forEach(b =>
    b.addEventListener('click', () => { _expOpen = !_expOpen; renderProps(); }));
  const nameIn = sheet.querySelector('[data-rename]');
  if (nameIn) {
    const commit = () => renameCustomTile(id, nameIn.value);
    nameIn.addEventListener('change', commit);
    nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); nameIn.blur(); } });
    // The rail listens for typing keys as tool shortcuts; a name field must
    // swallow them or naming a tile arms a different one mid-word.
    nameIn.addEventListener('keydown', e => e.stopPropagation());
  }
  sheet.querySelector('[data-wet]')?.addEventListener('click', () => setWet(id, !isWet(id)));
  sheet.querySelector('[data-deltile]')?.addEventListener('click', () => deleteTile(id));
  sheet.querySelector('.ds-close')?.addEventListener('click', () => setPropsOpen(false));
  _wireOptions(sheet);
  _wireKnobs(sheet);
  refreshLensLive();   // the live pair must be there on the first frame, not 200 ms in
  _wireFilter(sheet);
  // The canvases size from their laid-out width, which is 0 until the rail
  // has been through a layout pass.
  requestAnimationFrame(() => { _drawScope(); _drawFilter(); });
  // The sampler's sheet is a LIBRARY — waveform rows, names, durations — and
  // it was rendering into the narrow rail while every engine got the wide one,
  // so it arrived crushed. Same width for both (#275): it is a page of the
  // same kind, whatever draws it.
  document.body.classList.toggle('engine-page', !!eng);
}

// ── Knobs — audio design language for continuous values ─────────────────────
// A 270° rotary with a value arc in the tile's colour; drag vertically
// (Ableton's gesture). Raw range comes from the backing element or the fx
// def; the display comes from the paired numbox or the fx formatter, so the
// knob can never disagree with the rig view.
function _knobRange(pid) {
  const d = PARAM_DEFS[pid];
  if (d.kind === 'fx' || d.kind === 'tp') return { min: d.min, max: d.max, step: d.step };
  if (d.kind === 'flow')     return { min: 10, max: 200, step: 1 };
  if (d.kind === 'head')     return { min: 0, max: 30, step: 1 };
  const el = document.getElementById(d.el);
  if (!el) return null;
  return { min: +el.min, max: +el.max, step: +el.step || 1 };
}
function _knobVal(pid) {
  const d = PARAM_DEFS[pid];
  if (d.kind === 'fx' || d.kind === 'tp') return { raw: +_pStore(d)?.[d.path], disp: d.fmt(_pStore(d)?.[d.path]) };
  if (d.kind === 'flow')     return { raw: (S.paintTicker?.intervalMs ?? 50), disp: _readVal('flow') };
  if (d.kind === 'head')     return { raw: S.headWidthDeg || 0, disp: _readVal('head') };
  const el = document.getElementById(d.el);
  if (!el) return { raw: 0, disp: '' };
  if (d.read) return { raw: +el.value, disp: _readVal(d.read) };
  const numId = _numFor(d);
  const num = numId && document.getElementById(numId);
  return { raw: +el.value, disp: num ? (num.value ?? num.textContent) : el.value };
}
function _knobSet(pid, raw) {
  const d = PARAM_DEFS[pid];
  if (d.kind === 'fx' || d.kind === 'tp') { const o = _pStore(d); if (o) o[d.path] = raw; return; }
  if (d.kind === 'flow')     { S.paintTicker = S.paintTicker || {}; S.paintTicker.intervalMs = Math.round(raw); return; }
  if (d.kind === 'head')     { S.headWidthDeg = Math.round(raw); return; }
  const el = document.getElementById(d.el);
  if (!el) return;
  el.value = raw;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
const _KNOB_KINDS = new Set(['slider', 'fx', 'tp', 'flow', 'head']);

// ── Variation belongs to its parameter (#277) ──────────────────────────────
// `dur ±`, `per ±` and `pitch ±` are not parameters of their own — they are
// the SPREAD of the row above them, and drawn as separate tracks they made you
// hold two numbers in your head to know what one thing does. Each pair becomes
// one row: the handle is the value, a band around it is the range it varies
// over, and the ± number sits beside the value and is typeable.
//   base pid → variation pid
// ── The grain/period LINK (#279, Ek) ───────────────────────────────────────
// Photoshop's canvas-proportion chain, for the one ratio that matters here:
// press it and whatever overlap you have RIGHT NOW is held, so moving duration
// carries period with it and the density stays put while the grain size
// changes. That is the thing an `overlap` slider was reaching for and could
// not do — a slider sets a number, this preserves a relationship.
// Kept on S, not module-private: it is app state, it is the kind of thing a
// pedal or an OSC address will want later, and a control the engine audit
// cannot see is a control it reports as dead (#280).
S.grainLink = S.grainLink ?? { on: false, ratio: 1 };
const _grainLink = S.grainLink;

/** Duration and period in REAL SECONDS, straight off engine state — the same
 *  source the scope draws from.
 *
 *  Not `_dispNum()`, which was the #282 bug: it strips the unit, so a period
 *  reading "1.14s" parsed as 1.14 and was written back as the bare string
 *  "1.14", which the numbox's `_parseMs` reads as *milliseconds*. Push period
 *  past 1 s — the point where the formatter switches to seconds — and the link
 *  folded duration from 1.14 s to 1.14 ms, i.e. a sample count. A ratio between
 *  two times must never be computed from strings whose units can change under
 *  it. */
function _grainSec(which) {
  const ov = S.grainOverrides ?? {}, gpm = S.grainParams ?? {};
  const v = which === 'dur' ? (ov.duration ?? gpm.duration) : (ov.period ?? gpm.period);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function toggleGrainLink() {
  _grainLink.on = !_grainLink.on;
  if (_grainLink.on) {
    const d = _grainSec('dur'), p = _grainSec('period');
    _grainLink.ratio = (d > 0 && p > 0) ? d / p : 1;
  }
  renderProps();
}

/** Carry the partner when the link is on. Deferred, and deliberately so: the
 *  panel handlers COALESCE their S writes (30–50 ms), so reading engine state
 *  in the same tick as the move returns the value from BEFORE it — which had
 *  the link setting the partner to the previous position, one move behind for
 *  ever. Same 80 ms beat the row readback already waits on.
 *
 *  Called from both edit paths. Typing does not go through `apply()`, so a
 *  typed duration moved nothing at all until this was hoisted out of it. */
function _syncLink(pid, sheet) {
  if (!_grainLink.on || (pid !== 'dur' && pid !== 'period')) return;
  const other = pid === 'dur' ? 'period' : 'dur';
  setTimeout(() => {
    // Seconds in, seconds out, and written back with an EXPLICIT unit —
    // `_parseMs` treats a bare number as ms, so the suffix is what stops the
    // value changing magnitude on the way through (#282).
    const mine = _grainSec(pid);
    const want = pid === 'dur' ? mine / _grainLink.ratio : mine * _grainLink.ratio;
    if (!Number.isFinite(want) || want <= 0) return;
    _paramTypeSet(other, (want * 1000).toFixed(3) + 'ms');
    setTimeout(() => { _paintRow(sheet, other); S._drawEngineScope?.(); }, 80);
  }, 80);
}

const VAR_OF = { dur: 'durVar', period: 'perVar', pitch: 'pitchJit' };
const IS_VAR = new Set(Object.values(VAR_OF));
// The other way: a spread's base row, which is the row that DRAWS it.
const OWNER_OF = Object.fromEntries(Object.entries(VAR_OF).map(([k, v]) => [v, k]));
// Params whose default IS "do nothing" — dimmed when they sit there.
const _NOOP_AT_DEFAULT = new Set(['startJit', 'durJit', 'prob', 'fltJit', 'perVar', 'durVar', 'pitchJit']);

/** A parameter's DEFAULT, for the tick under its track and for the
 *  double-click reset (#261). For a `slider` this is free and exact:
 *  `el.defaultValue` is the HTML `value` attribute, which no interaction ever
 *  changes. The stores that have no element carry `def` in PARAM_DEFS. */
function _paramDefault(pid) {
  const d = PARAM_DEFS[pid];
  if (d?.def !== undefined) return d.def;
  if (d?.kind === 'slider') {
    const el = document.getElementById(d.el);
    return el ? +el.defaultValue : null;
  }
  return null;
}
function _knobArc(f) {
  // 270° sweep starting at 225° (7:30) — the audio-gear standard.
  const a0 = Math.PI * 0.75, a1 = a0 + Math.PI * 1.5 * Math.max(0, Math.min(1, f));
  const large = (a1 - a0) > Math.PI ? 1 : 0;
  const r = 14, cx = 18, cy = 18;
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
/** ONE LINE per parameter: name · track · number (#261, replacing the knob).
 *  A knob on screen is bigger than a track for the same precision, has
 *  nowhere to put its value, and cannot be compared with the knob beside it —
 *  two arcs at 40% look identical whether that is 40% of 10 ms or of two
 *  seconds. A row of tracks fixes all three: the fill length IS the value,
 *  rows line up so a section reads as a shape, and the number sits at the end
 *  of the line where it can be typed into. */
function _knobFor(pid) {
  const d = PARAM_DEFS[pid];
  if (!_KNOB_KINDS.has(d.kind)) return null;
  const rg = _knobRange(pid);
  if (!rg) return null;
  const { raw, disp } = _knobVal(pid);
  const span = (rg.max - rg.min) || 1;
  const f = (raw - rg.min) / span;
  const def = _paramDefault(pid);
  const tick = def == null ? '' :
    `<i class="prow-d" style="left:${(((def - rg.min) / span) * 100).toFixed(1)}%"></i>`;
  const resetTip = def == null ? '' : ' · double-click resets';

  // The spread band. Its half-width is the variation's own position in its
  // range, scaled to the track — PROPORTIONAL, not an absolute mapping of the
  // value: the grain and period sliders are log-mapped, so ±40 ms is not a
  // fixed fraction of the track and pretending otherwise would draw a lie.
  // What it says truthfully is "how much this varies", and it orders
  // correctly, which is what the row is for.
  const vpid = VAR_OF[pid];
  let band = '', spreadCell = '';
  if (vpid && _knobRange(vpid)) {
    const vr = _knobRange(vpid), vv = _knobVal(vpid);
    const vf = Math.max(0, Math.min(1, (vv.raw - vr.min) / ((vr.max - vr.min) || 1)));
    const half = vf * 45;                       // up to 45% of the track each side
    const l = Math.max(0, f * 100 - half), r = Math.min(100, f * 100 + half);
    // ALWAYS in the DOM, hidden at zero: _paintRow moves and shows it, and a
    // spread raised from zero by a drag or a typed value has to appear at
    // once (before 2026-09-06 the element was rendered only when the spread
    // was already non-zero, so it stayed invisible until the sheet redrew).
    band = `<i class="prow-band" data-pband="${vpid}"` +
      ` style="left:${l.toFixed(1)}%;width:${(r - l).toFixed(1)}%${vf > 0.001 ? '' : ';display:none'}"></i>`;
    spreadCell = `<input class="prow-s${vf > 0.001 ? '' : ' zero'}" data-pval="${vpid}"` +
      ` value="${vv.disp}" spellcheck="false" aria-label="${PARAM_DEFS[vpid].label}"` +
      ` title="${PARAM_DEFS[vpid].label} — drag to set, type a value, double-click for none">`;
  }
  // A parameter sitting at a value that does nothing (no jitter, full
  // probability) is visual noise; dim it so the eye goes to what is set.
  const inert = def != null && Math.abs(raw - def) < (rg.step || 1e-9) / 2 && _NOOP_AT_DEFAULT.has(pid);
  return `<span class="prow-t${inert ? ' inert' : ''}" data-ptrack="${pid}"` +
    ` title="drag to set${resetTip}${vpid ? ' · the ± spread is the cell at the end of the row' : ''}">` +
    `<i class="prow-f" style="width:${(f * 100).toFixed(1)}%"></i>${band}${tick}` +
    `<i class="prow-h" style="left:${(f * 100).toFixed(1)}%"></i></span>` +
    `<input class="prow-v" data-pval="${pid}" value="${disp}" spellcheck="false"` +
    ` aria-label="${d.label}" title="drag to set, or type a value and press Enter">` + spreadCell;
}
function _wireKnobs(sheet) {
  // One place sets a param, whichever gesture asked: drag, double-click reset
  // or a typed number. The panel handlers coalesce their S writes (30–50 ms),
  // so the readback is deferred rather than read straight back.
  const apply = (pid, raw) => {
    const rg = _knobRange(pid); if (!rg) return;
    const v = Math.round(Math.max(rg.min, Math.min(rg.max, raw)) / rg.step) * rg.step;
    _knobSet(pid, v);
    // The link holds the ratio captured when it was pressed: move one and the
    // other follows, so the overlap you had is the overlap you keep.
    _syncLink(pid, sheet);
    _paintRow(sheet, pid);
    S._drawEngineScope?.();
    // The panel handlers COALESCE their S writes (30–50 ms), so an immediate
    // redraw draws the value that was there a moment ago — which is why the
    // scope's caption never followed `period`. Redraw again once the write has
    // landed, on the same beat the row readback already uses.
    setTimeout(() => { _paintRow(sheet, pid); S._drawEngineScope?.(); }, 80);
    captureTileParams();
  };

  sheet.querySelectorAll('[data-ptrack]').forEach(tr => {
    const pid = tr.dataset.ptrack;
    const rg = _knobRange(pid); if (!rg) return;
    // Shift = fine drag. A track is ~170px for a full range, so a param with
    // a wide span moves in coarse jumps at 1:1; holding shift scales the
    // movement to a quarter of it, anchored where the shift-drag began (#272).
    let fineFrom = null;
    const fromX = e => {
      const r = tr.getBoundingClientRect();
      let f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      if (e.shiftKey) {
        if (fineFrom === null) fineFrom = { x: e.clientX, f: (_knobVal(pid).raw - rg.min) / (rg.max - rg.min || 1) };
        f = Math.max(0, Math.min(1, fineFrom.f + ((e.clientX - fineFrom.x) / r.width) * 0.25));
      } else fineFrom = null;
      apply(pid, rg.min + f * (rg.max - rg.min));
    };
    tr.addEventListener('pointerdown', e => {
      if (e.detail > 1) return;              // let dblclick own the reset
      try { tr.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault(); fromX(e);
    });
    tr.addEventListener('pointermove', e => { if (e.buttons) fromX(e); });
    tr.addEventListener('dblclick', e => {
      e.preventDefault(); e.stopPropagation();
      const def = _paramDefault(pid);
      if (def == null) return;
      apply(pid, def);
    });
  });

  // Every number is typeable — PARAM_DEFS already carries min/max/step for
  // all of them, so one parse-and-clamp covers the lot. Units and suffixes in
  // the displayed value are stripped, so "120 ms" round-trips.
  // ── A number cell is a slider you can also type into ──────────────────
  // Press and drag it to set the value; click without moving to put the caret
  // in; double-click to reset. That is the number field of every DAW (Ableton,
  // Logic) and of Photoshop's scrubby values, and it is how the ± SPREAD is
  // set since 2026-09-06 (Ek): the spread used to be ALT-drag on the track,
  // and ⌥ is the cursor lock (events.js), so the two fought over one key. The
  // gesture was invisible besides — this cell is on screen at the end of its
  // row, with a resize cursor, and the band follows as it moves.
  const SCRUB_PX = 200;                      // one full range per this much travel
  sheet.querySelectorAll('input[data-pval]').forEach(inp => {
    const pid = inp.dataset.pval;
    const rg = _knobRange(pid);
    if (!rg) return;
    let from = null, moved = false;
    inp.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.detail > 1) return;   // let dblclick own the reset
      from = { x: e.clientX, raw: _knobVal(pid).raw };
      moved = false;
      try { inp.setPointerCapture(e.pointerId); } catch (_) {}
    });
    inp.addEventListener('pointermove', e => {
      if (!from || !e.buttons) return;
      const dx = e.clientX - from.x;
      // Under the threshold this is still a click: the caret stays where the
      // hand put it and nothing is written.
      if (!moved) {
        if (Math.abs(dx) < 3) return;
        moved = true;
        inp.blur();                       // a drag must not select the text
        from.raw = _knobVal(pid).raw;     // the blur may have committed an edit
      }
      e.preventDefault();
      // Shift is the fine drag, the same quarter-speed the track uses (#272).
      apply(pid, from.raw + (dx / SCRUB_PX) * ((rg.max - rg.min) || 1) * (e.shiftKey ? 0.25 : 1));
    });
    const endScrub = e => {
      from = null;
      try { inp.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    inp.addEventListener('pointerup', endScrub);
    inp.addEventListener('pointercancel', endScrub);
    inp.addEventListener('dblclick', e => {
      // The track's gesture, on the number: back to the tick — and for a
      // spread the tick IS no spread.
      const def = _paramDefault(pid) ?? (IS_VAR.has(pid) ? rg.min : null);
      if (def == null) return;
      e.preventDefault(); e.stopPropagation();
      inp.blur();
      apply(pid, def);
    });
    const commit = () => {
      if (_paramTypeSet(pid, inp.value)) {
        _paintRow(sheet, pid);
        setTimeout(() => _paintRow(sheet, pid), 80);
        _syncLink(pid, sheet);
        captureTileParams();
        S._drawEngineScope?.();
      } else _paintRow(sheet, pid);
    };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); inp.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); _paintRow(sheet, pid); inp.blur(); }
      e.stopPropagation();          // letters are tile keys; not while typing
    });
    inp.addEventListener('blur', commit);
  });
}

// ── The sound window (#261) ────────────────────────────────────────────────
// One grain at its real duration and envelope, plus the NEXT grain's onset —
// which is the question the four numbers make you compute in your head: am I
// overlapping, and by how much. Same slot per engine; only granular draws
// today (loop's take-with-slice-points and the lens falloff are the obvious
// next two, and the slot is here for them).
function _drawScope() {
  const cv = document.getElementById('engScope');
  if (!cv || !cv.clientWidth) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight || 68;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const accent = cv.dataset.accent || '#cfa46b';

  const gpm = S.grainParams, ov = S.grainOverrides ?? {};
  const liveDur    = Math.max(1e-5, ov.duration ?? gpm.duration ?? 0.1);
  const livePeriod = Math.max(1e-5, ov.period   ?? gpm.period   ?? 0.05);

  // ── The FADE, resolved exactly as the worklet resolves it ────────────────
  // This is the part the first version got wrong: it read `grainParams.fade`,
  // a key nothing writes, so the curve never moved. Fade is a RATIO of the
  // grain, expressed either as a percentage or in absolute ms, with a 2 ms
  // floor (unless it is exactly zero) and a hard 0.5 cap — drawing it from
  // fadeRatio alone would show a pct envelope while ms mode was sounding.
  const fadeIsMs = (ov.fadeMode ?? gpm.fadeMode ?? 'pct') === 'ms';
  let fadeRatio = fadeIsMs
    ? (ov.fadeMs ?? gpm.fadeMs ?? 0.020) / liveDur
    : (ov.fadeRatio ?? gpm.fadeRatio ?? 0.25);
  if (fadeRatio > 0) fadeRatio = Math.max(fadeRatio, 0.002 / liveDur);
  fadeRatio = Math.min(fadeRatio, 0.5);
  const liveFade = Math.min(liveDur / 2 - 1e-4, liveDur * fadeRatio);

  // ── The two half-shapes, per curve type ──────────────────────────────────
  const curve = S.grainCurveType;
  const atk = t => curve === 'tri' ? t : curve === 'rect' ? (t <= 0 ? 0 : 1)
                 : 0.5 * (1 - Math.cos(Math.PI * t));
  const rel = t => curve === 'tri' ? 1 - t : curve === 'rect' ? (t >= 1 ? 0 : 1)
                 : 0.5 * (1 + Math.cos(Math.PI * t));

  // ── A time base driven by DURATION alone, and snapped (#281) ────────────
  // The window used to be `period × 4.5 + duration`, so it rescaled on every
  // move — and moving PERIOD made the grain visibly grow or shrink, which
  // reads as the duration changing when it has not. Period is now out of the
  // axis entirely: the grain is the subject, so only the grain's own length
  // sets the scale, and sliding period slides the copies within a still frame.
  //
  // Snapped rather than continuous, because the axis has to do two opposite
  // jobs. If it tracked duration smoothly the grain would occupy the same
  // fraction of the width forever and duration would look frozen too. Stepping
  // is how a scope solves this: inside a step the grain visibly grows, and the
  // axis only jumps at a threshold — stated in the caption, so a jump reads as
  // a range change rather than a glitch.
  //
  // One truly fixed number was the other option and it loses at the ends: at a
  // 1.5 s axis a 10 ms grain is a seven-pixel sliver, and its envelope — the
  // thing this window exists to show — is unreadable. 1-2-5 steps keep the
  // grain between roughly a sixth and half the width across the whole range.
  const SCOPE_STEPS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];   // seconds
  const need    = liveDur * 2.5;
  const viewSec = SCOPE_STEPS.find(v => v >= need) ?? SCOPE_STEPS[SCOPE_STEPS.length - 1];
  const stride  = Math.max(livePeriod, 1e-4);
  const pxPerSec = w / viewSec;
  const grainW    = liveDur * pxPerSec;
  const fadeW     = liveFade * pxPerSec;
  const sustW     = Math.max(0, grainW - fadeW * 2);

  const PAD = 2, baseY = h - 9, ampH = (h - 20) - PAD;
  c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(0, baseY + 0.5); c.lineTo(w, baseY + 0.5); c.stroke();

  // Same 50-shape cap as the original: at low period and high duration the
  // raw count reaches 100+ shapes and starves the grain scheduler.
  const count = Math.min(stride > 0 ? Math.ceil(viewSec / stride) + 1 : 6, 50);
  const STEPS = count > 30 ? 20 : 40;

  // ── The axis break (#284) ────────────────────────────────────────────────
  // When the next onset falls past the right edge you see one grain and no
  // pattern, which reads as "the second one is missing" rather than "the gap
  // is longer than the window". Rescaling to fit it is the obvious fix and the
  // wrong one: it puts period back into the axis and the grain starts changing
  // size again, which is exactly what #281 removed.
  //
  // So the axis stays put and the GAP is drawn broken — grain one at true
  // scale on the left, grain two at true scale on the right, a marked break
  // between them, and the real distance in the caption. Same device a broken
  // y-axis uses, for the same reason: two things worth seeing, one of which
  // will not fit next to the other at one scale.
  const broken = livePeriod + liveDur > viewSec;
  const onsets = broken
    ? [0, Math.max(grainW + 22, w - grainW)]
    : Array.from({ length: count }, (_, i) => i * stride * pxPerSec);

  if (broken) {
    const a = grainW + 7, b = onsets[1] - 7, midY = baseY - PAD - ampH * 0.5;
    if (b > a + 10) {
      c.save();
      c.strokeStyle = 'rgba(255,255,255,0.15)'; c.lineWidth = 1;
      c.setLineDash([2, 3]);
      c.beginPath(); c.moveTo(a, midY); c.lineTo(b, midY); c.stroke();
      c.setLineDash([]);
      // The two slashes that say "not to scale" in every broken axis ever
      // drawn — without them a dashed line just reads as a quiet grain.
      const mx = (a + b) / 2;
      for (const sx of [mx - 3.5, mx + 3.5]) {
        c.beginPath(); c.moveTo(sx - 3.5, midY + 5.5); c.lineTo(sx + 3.5, midY - 5.5); c.stroke();
      }
      c.restore();
    }
  }

  for (let i = onsets.length - 1; i >= 0; i--) {
    const x0 = onsets[i];
    c.beginPath();
    for (let sIdx = 0; sIdx <= STEPS; sIdx++) {
      const t = sIdx / STEPS, x = x0 + t * fadeW, y = baseY - PAD - atk(t) * ampH;
      sIdx ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.lineTo(x0 + fadeW + sustW, baseY - PAD - ampH);
    for (let sIdx = 0; sIdx <= STEPS; sIdx++) {
      const t = sIdx / STEPS;
      c.lineTo(x0 + fadeW + sustW + t * fadeW, baseY - PAD - rel(t) * ampH);
    }
    // The first grain is the subject; the rest are the pattern behind it.
    const alpha = i === 0 ? 1 : 0.28;
    c.strokeStyle = accent; c.globalAlpha = alpha; c.lineWidth = 1.4; c.stroke();
    c.lineTo(x0 + grainW, baseY); c.lineTo(x0, baseY); c.closePath();
    c.globalAlpha = alpha * 0.13; c.fillStyle = accent; c.fill(); c.globalAlpha = 1;
  }

  const L = document.getElementById('engScopeL'), R = document.getElementById('engScopeR');
  const ms = v => v >= 1 ? Math.round(v) + ' ms' : v.toFixed(2) + ' ms';
  // Name the row, not the concept: the slider says `duration`, so the caption
  // that reports it says duration too (#281).
  if (L) L.textContent = `duration ${ms(liveDur * 1000)} · taper ${ms(liveFade * 1000)}`;
  if (R) {
    const ovl = livePeriod > 0 ? liveDur / livePeriod : 0;
    const win = viewSec >= 1 ? viewSec.toFixed(viewSec % 1 ? 1 : 0) + ' s' : Math.round(viewSec * 1000) + ' ms';
    R.textContent = `${ms(livePeriod * 1000)} apart · ` +
      (ovl >= 1 ? ovl.toFixed(1) + '\u00d7 overlap' : 'gaps between grains') +
      `  ·  window ${win}` + (broken ? ' · gap not to scale' : '');
  }
}
S._drawEngineScope = () => { _drawScope(); _drawFilter(); };

// ── The filter, drawn (#261) ───────────────────────────────────────────────
// Sliders describe a shape you then have to imagine, so the shape IS the
// control: drag the left edge for hpf, the right for lpf, and vertically for
// the Q OF THE EDGE YOU GRABBED (2026-09-07 — one Q per filter). This is the one place the horizontal-track default is broken, because
// here the curve is the parameter — everything else in the engine is genuinely
// one-dimensional and a picture would add nothing. Jitter draws as a band
// around the curve rather than a fourth control: it is a smear on the shape.
let _expOpen = false;   // the experimental fold, per session
// `q` is per EDGE since 2026-09-07 — dragging up on the high-pass corner
// raises the peak THERE, which is the whole reason the two were split.
const _FILT_PIDS = { hp: 'hpf', lp: 'lpf', hpq: 'hpq', lpq: 'lpq', jit: 'fltJit' };
function _filtVal(k) { return _dispNum(_FILT_PIDS[k]); }
function _drawFilter() {
  const cv = document.getElementById('engFilter');
  if (!cv || !cv.clientWidth) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight || 76;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const accent = cv.dataset.accent || '#cfa46b';
  const hp = Math.max(20, _filtVal('hp')), lp = Math.max(hp * 1.1, _filtVal('lp'));
  const hq = _filtVal('hpq'), lq = _filtVal('lpq'), jit = _filtVal('jit');
  const LO = Math.log10(20), HI = Math.log10(20000);
  const X = f => ((Math.log10(f) - LO) / (HI - LO)) * w;
  const resp = f => {
    const a = 1 / Math.sqrt(1 + Math.pow(hp / f, 4));
    const b = 1 / Math.sqrt(1 + Math.pow(f / lp, 4));
    const peak = (fc, q) => Math.exp(-Math.pow(Math.log10(f / fc) * 6, 2)) * Math.max(0, q - 0.7) * 0.42;
    return Math.max(0, Math.min(1.25, a * b + peak(hp, hq) + peak(lp, lq)));
  };
  const Y = g => h - 9 - g * (h - 20);
  c.strokeStyle = 'rgba(255,255,255,0.06)';
  for (const f of [100, 1000, 10000]) { c.beginPath(); c.moveTo(X(f), 0); c.lineTo(X(f), h); c.stroke(); }
  const path = fn => { c.beginPath(); for (let x = 0; x <= w; x += 2) {
    const f = Math.pow(10, LO + (x / w) * (HI - LO)); const y = fn(f); x ? c.lineTo(x, y) : c.moveTo(x, y); } };
  if (jit > 0) {
    const sp = 1 + jit / 100;
    path(f => Y(resp(f * sp))); c.lineTo(w, h); c.lineTo(0, h); c.closePath();
    c.fillStyle = accent; c.globalAlpha = 0.1; c.fill(); c.globalAlpha = 1;
  }
  path(f => Y(resp(f)));
  c.strokeStyle = accent; c.lineWidth = 1.5; c.stroke();
  c.lineTo(w, h); c.lineTo(0, h); c.closePath();
  c.fillStyle = accent; c.globalAlpha = 0.11; c.fill(); c.globalAlpha = 1;
  for (const f of [hp, lp]) { c.beginPath(); c.arc(X(f), Y(resp(f)), 3.2, 0, 7); c.fillStyle = accent; c.fill(); }
  // The four rows below the graph show the same four numbers, so grabbing an
  // edge has to move them too — otherwise the drawing and the rows disagree
  // and the rows are the ones you can type into (#283).
  const sheet = cv.closest('#propRail');
  if (sheet) for (const pid of Object.values(_FILT_PIDS)) _paintRow(sheet, pid);
}
function _wireFilter(sheet) {
  const cv = sheet.querySelector('#engFilter');
  if (!cv) return;
  const LO = Math.log10(20), HI = Math.log10(20000);
  let grab = null;
  const freqAt = x => Math.pow(10, LO + (Math.max(0, Math.min(cv.clientWidth, x)) / cv.clientWidth) * (HI - LO));
  // Real units in, through the numbox — same reason as typing.
  const setP = (pid, v) => _paramTypeSet(pid, String(Math.round(v * 100) / 100));
  const move = e => {
    if (!grab) return;
    const r = cv.getBoundingClientRect();
    const f = freqAt(e.clientX - r.left);
    // The two edges cannot cross: an hpf above the lpf is a silent filter and
    // reads as a broken control rather than an extreme setting.
    if (grab === 'hp') setP(_FILT_PIDS.hp, Math.min(f, _filtVal('lp') * 0.8));
    else               setP(_FILT_PIDS.lp, Math.max(f, _filtVal('hp') * 1.25));
    const fy = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / cv.clientHeight));
    setP(grab === 'hp' ? _FILT_PIDS.hpq : _FILT_PIDS.lpq, 0.5 + fy * 7.5);   // Q 0.5 … 8 over the height
    _drawFilter();
    captureTileParams();
  };
  cv.addEventListener('pointerdown', e => {
    const r = cv.getBoundingClientRect();
    const f = freqAt(e.clientX - r.left);
    grab = Math.abs(Math.log10(f / Math.max(20, _filtVal('hp')))) <
           Math.abs(Math.log10(f / Math.max(21, _filtVal('lp')))) ? 'hp' : 'lp';
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault(); move(e);
  });
  cv.addEventListener('pointermove', e => { if (e.buttons) move(e); });
  cv.addEventListener('pointerup', () => { grab = null; });
  cv.addEventListener('dblclick', e => {
    e.preventDefault();
    // Real-unit defaults: the element default is a slider POSITION, so it is
    // set through _knobSet (position space), not through the numbox.
    for (const k of ['hp', 'lp', 'q', 'jit']) {
      const pid = _FILT_PIDS[k], def = _paramDefault(pid);
      if (def != null) _knobSet(pid, def);
    }
    _drawFilter(); captureTileParams();
  });
}

/** Commit a TYPED value. A `slider` param's raw units are the element's
 *  position, not the units it displays — the grain sliders are log-mapped, so
 *  "250" typed into a 0–1000 position slider is 250/1000 of the travel, not
 *  250 ms. The app already owns that inversion in the paired numbox
 *  (`fromDisplay` in ui-presets.js), so typing hands the string to the numbox
 *  and presses Enter on it rather than re-deriving the mapping here — which
 *  would be a second copy of a log curve, drifting silently. */
function _paramTypeSet(pid, text) {
  const d = PARAM_DEFS[pid];
  const numId = d?.kind === 'slider' ? _numFor(d) : null;
  const num = numId && document.getElementById(numId);
  if (num) {
    num.value = text;
    num.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  }
  const n = parseFloat(String(text).replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(n)) return false;
  const rg = _knobRange(pid); if (!rg) return false;
  _knobSet(pid, Math.round(Math.max(rg.min, Math.min(rg.max, n)) / rg.step) * rg.step);
  return true;
}

/** The displayed value as a NUMBER — "1.0k" → 1000, "20 Hz" → 20. The filter
 *  works in real units; the sliders behind it do not. */
function _dispNum(pid) {
  const t = String(_knobVal(pid)?.disp ?? '').trim();
  const m = t.match(/^(-?[\d.]+)\s*([kK])?/);
  if (!m) return 0;
  return parseFloat(m[1]) * (m[2] ? 1000 : 1);
}

/** Repaint one row from live state — fill, handle and number. */
function _paintRow(sheet, pid) {
  const rg = _knobRange(pid); if (!rg) return;
  // A spread has no row of its own — it is drawn as the BAND on its base row,
  // and its cell's `zero` class is set there too. Painting the base does both
  // (2026-09-06: typing a spread moved the number and left the band behind).
  if (IS_VAR.has(pid) && OWNER_OF[pid]) { _paintRow(sheet, OWNER_OF[pid]); return; }
  const { raw, disp } = _knobVal(pid);
  const span = (rg.max - rg.min) || 1;
  const f = Math.max(0, Math.min(1, (raw - rg.min) / span)) * 100;
  const tr = sheet.querySelector(`[data-ptrack="${pid}"]`);
  if (tr) {
    tr.querySelector('.prow-f').style.width = f.toFixed(1) + '%';
    tr.querySelector('.prow-h').style.left  = f.toFixed(1) + '%';
  }
  const inp = sheet.querySelector(`[data-pval="${pid}"]`);
  if (inp && document.activeElement !== inp) inp.value = disp;
  // The band belongs to the base row, so repainting a base repaints it.
  const vpid = VAR_OF[pid];
  if (vpid && tr) {
    const vr = _knobRange(vpid);
    const band = tr.querySelector('.prow-band');
    const sInp = sheet.querySelector(`[data-pval="${vpid}"]`);
    if (vr) {
      const vv = _knobVal(vpid);
      const vf = Math.max(0, Math.min(1, (vv.raw - vr.min) / ((vr.max - vr.min) || 1)));
      const half = vf * 45;
      const l = Math.max(0, f - half), r2 = Math.min(100, f + half);
      if (band) {
        band.style.left = l.toFixed(1) + '%';
        band.style.width = (r2 - l).toFixed(1) + '%';
        band.style.display = vf > 0.001 ? '' : 'none';
      }
      if (sInp && document.activeElement !== sInp) {
        sInp.value = vv.disp;
        sInp.classList.toggle('zero', !(vf > 0.001));
      }
    }
  }
}

function _wireOptions(box, capId) {
  // Procreate's rule: the selected tile remembers. Any interaction in the
  // options or design surfaces captures the engine back into the tile —
  // `capId` names the tile a surface captures into (default: _optSel).
  const cap = () => captureTileParams(capId ? capId() : undefined);
  // Every control in the panel repaints the scope, not just the tracks. The
  // panel handlers coalesce their S writes (30–50 ms), so an immediate redraw
  // shows the value from before the click — which is why changing `curve`
  // moved `S.grainCurveType` and drew the same envelope three times. One
  // delayed redraw here covers segments, chips and tracks alike.
  const repaint = () => setTimeout(() => S._drawEngineScope?.(), 90);
  box.addEventListener('pointerup', () => { cap(); repaint(); });
  box.addEventListener('click', () => { cap(); repaint(); });
  box.querySelectorAll('[data-slider]').forEach(tr => {
    const el = document.getElementById(tr.dataset.slider);
    if (!el) return;
    const drag = e => {
      const r = tr.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const min = +el.min, max = +el.max, step = +el.step || 1;
      el.value = Math.round((min + f * (max - min)) / step) * step;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      tr.querySelector('.thumb').style.left = `calc(${(f * 100).toFixed(1)}% - 1px)`;
      // The panel handlers coalesce their S writes (30–50 ms), so read back
      // just after they land — the 5 Hz tick alone leaves the number lagging
      // the thumb by a visible beat.
      setTimeout(refreshValues, 80);
    };
    tr.addEventListener('pointerdown', e => {
      try { tr.setPointerCapture(e.pointerId); } catch (_) {}
      drag(e); e.preventDefault();
    });
    tr.addEventListener('pointermove', e => { if (e.buttons) drag(e); });
  });
  box.querySelectorAll('[data-fadecurve]').forEach(fc => {
    const el = document.getElementById('radiusFadeCurveSlider');
    if (!el) return;
    let y0 = 0, c0 = 0;
    const apply = c => {
      c = Math.max(0, Math.min(1, c));
      el.value = c;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      const path = fc.querySelector('.fc-line');
      if (path) path.setAttribute('d', _fadePathD(c, 72, 30));
      const read = fc.parentElement?.querySelector('[data-read="fadeCurve"]');
      if (read) read.textContent = `${Math.round(c * 100)}%`;
    };
    fc.addEventListener('pointerdown', e => {
      try { fc.setPointerCapture(e.pointerId); } catch (_) {}
      y0 = e.clientY; c0 = S.radiusFadeCurve ?? 0.5;
      e.preventDefault();
    });
    fc.addEventListener('pointermove', e => {
      if (!e.buttons) return;
      apply(c0 + (e.clientY - y0) / 60);   // full drag ≈ the svg's height ×2
      setTimeout(refreshValues, 80);
    });
  });
  // The switch writes what its segment used to: two of them proxy a cabinet
  // seg (the write-through rule stands — a row still writes through a real
  // element), the other two call what the old pill called.
  box.querySelectorAll('[data-sw], [data-swproxy]').forEach(sw => {
    sw.addEventListener('click', () => {
      const proxy = sw.dataset.swproxy;
      if (proxy) {
        const want = sw.classList.contains('on') ? sw.dataset.swoff : sw.dataset.swon;
        const seg = document.getElementById(proxy);
        const btn = seg && [...seg.querySelectorAll('button')].find(b => Object.values(b.dataset).includes(want));
        if (btn) btn.click();
      } else if (sw.dataset.sw === 'glink') { toggleGrainLink(); return; }
      else if (sw.dataset.sw === 'onend')  { S.triggerParams.loopOnEnd = !S.triggerParams.loopOnEnd; }
      else if (sw.dataset.sw === 'gend')   { setGrainOnEnd(_GEND_OF[S.traceMode] === 'cloud' ? 'scratch' : 'cloud'); }
      captureTileParams();
      renderOptions();
    });
  });
  box.querySelectorAll('[data-proxy]').forEach(sp => {
    sp.addEventListener('click', () => {
      const seg = document.getElementById(sp.dataset.proxy);
      const btn = seg && [...seg.querySelectorAll('button')].find(b =>
        Object.values(b.dataset).includes(sp.dataset.val));
      if (btn) { btn.click(); renderOptions(); }
    });
  });
  box.querySelectorAll('[data-reads]').forEach(sp => {
    sp.addEventListener('click', () => { S.lensReads = sp.dataset.reads; captureTileParams(); renderOptions(); });
  });
  box.querySelectorAll('[data-escope]').forEach(sp => {
    sp.addEventListener('click', () => { S.eraseWholeStroke = sp.dataset.escope === 'stroke'; renderOptions(); });
  });
  box.querySelectorAll('[data-combaxis]').forEach(sp => {
    sp.addEventListener('click', () => { S.combAxis = sp.dataset.combaxis; renderOptions(); });
  });
  box.querySelectorAll('[data-combkeep]').forEach(sp => {
    sp.addEventListener('click', () => { S.combKeep = sp.dataset.combkeep; renderOptions(); });
  });
  box.querySelectorAll('[data-efrom]').forEach(sp => {
    sp.addEventListener('click', () => { S.eraseOldest = sp.dataset.efrom === 'bottom'; renderOptions(); });
  });
  const flTr = box.querySelector('[data-flow]');
  if (flTr) {
    const drag = e => {
      const r = flTr.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      S.paintTicker = S.paintTicker || {};
      S.paintTicker.intervalMs = Math.round(10 + (1 - f) * 190);
      flTr.querySelector('.thumb').style.left = `calc(${(f * 100).toFixed(1)}% - 1px)`;
      refreshValues();
    };
    flTr.addEventListener('pointerdown', e => {
      try { flTr.setPointerCapture(e.pointerId); } catch (_) {}
      drag(e); e.preventDefault();
    });
    flTr.addEventListener('pointermove', e => { if (e.buttons) drag(e); });
  }
  const hdTr = box.querySelector('[data-head]');
  if (hdTr) {
    const drag = e => {
      const r = hdTr.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      // 0 = on the line at the far left; up to a 30° half-width band.
      S.headWidthDeg = f < 0.03 ? 0 : Math.round(f * 30);
      hdTr.querySelector('.thumb').style.left = `calc(${(f * 100).toFixed(1)}% - 1px)`;
      refreshValues();
    };
    hdTr.addEventListener('pointerdown', e => {
      try { hdTr.setPointerCapture(e.pointerId); } catch (_) {}
      drag(e); e.preventDefault();
    });
    hdTr.addEventListener('pointermove', e => { if (e.buttons) drag(e); });
  }
  box.querySelectorAll('[data-headedge]').forEach(sp => {
    sp.addEventListener('click', () => { S.headEdge = sp.dataset.headedge; renderOptions(); });
  });
  box.querySelectorAll('[data-fx]').forEach(tr => {
    const d = PARAM_DEFS[tr.dataset.fx];
    const drag = e => {
      const r = tr.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const raw = d.min + f * (d.max - d.min);
      _pStore(d)[d.path] = Math.round(raw / d.step) * d.step;
      tr.querySelector('.thumb').style.left = `calc(${(f * 100).toFixed(1)}% - 1px)`;
      refreshValues();
    };
    tr.addEventListener('pointerdown', e => {
      try { tr.setPointerCapture(e.pointerId); } catch (_) {}
      drag(e); e.preventDefault();
    });
    tr.addEventListener('pointermove', e => { if (e.buttons) drag(e); });
  });
}

/** Cheap value refresh — called from the layout's 5 Hz tick. */
export function refreshValues() {
  for (const boxId of ['propRail']) {
    const box = document.getElementById(boxId);
    if (!box) continue;
    box.querySelectorAll('[data-read]').forEach(b => { b.textContent = _readVal(b.dataset.read); });
    box.querySelectorAll('[data-fxread]').forEach(b => {
      const d = PARAM_DEFS[b.dataset.fxread];
      if (d) b.textContent = d.fmt(_pStore(d)?.[d.path]);
    });
    box.querySelectorAll('[data-readnum]').forEach(b => {
      const num = b.dataset.readnum && document.getElementById(b.dataset.readnum);
      if (num && (num.value ?? num.textContent)) { b.textContent = num.value ?? num.textContent; return; }
      const el = document.getElementById(b.dataset.readel);
      if (el) b.textContent = el.value;
    });
  }
}

// ── A new tool: the `+` on an engine's title (#214, reshaped 2026-09-10) ───
let _customSeq = Object.keys(_tileCfg).filter(k => _tileCfg[k]?.custom).length;
/** Mint a custom tile from the LIVE params of one engine — shared by the `+`
 *  on the engine's title and the edit sheet's "+ tile" (where the live params
 *  are the stroke's, so the tile is minted from what the stroke sounds like).
 *  It lands at the end of the order, which is the end of its engine's group. */
function _mintTile(engine) {
  const id = 'user' + Date.now().toString(36);
  _customSeq++;
  const params = {};
  for (const pid of ENGINES[engine]) {
    const v = _readParam(pid);
    if (v !== undefined) params[pid] = v;
  }
  // The name is the first `custom N` not in use — a counter alone handed a
  // tape tool the same name as a lens after a deletion (seen 2026-09-10).
  const taken = new Set(Object.values(_tileCfg).map(c => c?.custom?.label));
  let n = _customSeq; while (taken.has('custom ' + n)) n++;
  _tileCfg[id] = { custom: { label: 'custom ' + n, engine }, params };
  _saveTileCfg();
  order.push(id);
  try { localStorage.setItem(LS_ORDER, JSON.stringify(order)); } catch (_) {}
  return id;
}
function _createCustomTile(engine) {
  const id = _mintTile(engine);
  if (engine === 'lens') { lensTap(id); openProps(id, 'lens'); return; }
  // A tile you just minted is one you want to DIAL, so this is the one act of
  // choosing that also opens the drawer. It used to go into the armed slot as
  // well; it goes onto the palette by drag, like every other tile.
  pickTile(id);
  openProps(id, 'tool');
}

/** Rename or retire a custom tile. Factory tiles have neither: their name is
 *  how everything else refers to them, and a factory tile is not yours to
 *  delete (#283). */
function renameCustomTile(id, label) {
  const cu = _tileCfg[id]?.custom; if (!cu) return false;
  const name = String(label).trim().slice(0, 24);
  if (!name || name === cu.label) return false;
  cu.label = name;
  _saveTileCfg();
  render(); renderProps();
  return true;
}
/** Delete a tool or a lens, factory or yours (Ek, 2026-09-10). A custom one
 *  loses its definition; a factory one is written to `mubone_tiles_gone` and
 *  answers as no tile from then on, until a factory reset clears the key.
 *  Refused for the last tool of a kind and the last lens — see renderProps. */
function deleteTile(id) {
  const custom = !!_tileCfg[id]?.custom;
  const factoryLens = LENSES.some(l => l.id === id);
  if (!custom && !TILE_DEFS[id] && !factoryLens) return false;
  const wasLens = engineOf(id) === 'lens';
  if (wasLens ? lensAll().length <= 1 : (slotKind(id) && kindAll(slotKind(id)).length <= 1)) return false;
  // A brush that disappears dries its strokes where they sound.
  dryVoicing(id);
  if (custom) { delete _tileCfg[id]; _saveTileCfg(); }
  else { _gone.add(id); _saveGone(); }
  order = order.filter(t => t !== id);
  // Whatever it was, something else has to be in the drawer and the hand
  // now — and BEFORE the palette save below, which re-renders through
  // S._bindingsChanged: a sheet pointed at a tile that no longer exists
  // threw in renderProps (found 2026-09-12).
  const fb = order.find(isToolTile);
  const wasSel = _optSel.id === id, wasHand = inHand === id;
  if (wasSel && fb) _optSel = { kind: 'tool', id: fb };
  if (wasHand && fb) { inHand = fb; try { localStorage.setItem(LS_HAND, fb); } catch (_) {} }
  // A deleted tile leaves the palette too.
  { const keep = palette.map((e, n) => e.id !== id ? n : -1).filter(n => n >= 0);
    palette = palette.filter(e => e.id !== id); _sanitizePalette(); _savePalette();
    S._paletteReordered?.(keep.slice(0, palette.length)); }
  _saveOrder();
  if (wasLens) { if (installedLens() === id) lensTap(lensAll()[0]); else { render(); renderProps(); } }
  else if ((wasSel || wasHand) && fb) pickHand(fb);
  else { render(); renderProps(); }
  return true;
}

// ── Drag to reorder — the number follows the position ───────────────────────

// ── Drag — re-ranking your tiles in the library ───────────────────────────
// Dropping ON a tile inserts before it (the reorder everyone expects). This
// used to move tiles between the palette and the box as well; the palette is two
// fixed slots now (2026-09-03), filled by clicking, so the rail is the only
// drag surface left.
let _dragFrom = null;
let _dragFromPos = -1;     // the position a strip drag started on, or -1 from a rail
let _dragFromZone = null;
let _dragDropped = false;   // a drop on a zone happened; dragend reads it to tell "off the strip"
function _clearOver() {
  document.querySelectorAll('.over, .zone-over').forEach(el => el.classList.remove('over', 'zone-over'));
}
/** What a drag picked up, from any of the three sources: a tool row, a lens
 *  row, a pin-rail row, or a palette tile (`data-pal`). Null if it is not
 *  something the palette can hold. */
function _dragIdOf(el) {
  const t = el.closest('[data-pal], .trow[data-tile], .trow[data-lens], [data-pin]');
  if (!t) return null;
  const id = t.dataset.pal ?? t.dataset.tile ?? t.dataset.lens ?? t.dataset.pin ?? null;
  return paletteKind(id) ? id : null;
}
/** Where a drop at clientX lands in the palette: the index among the tiles
 *  OTHER than the one being dragged (`moveEntry` counts that way), and the
 *  tile the caret is drawn before, or null for the end. Filtered by POSITION,
 *  not by id — the same tool may sit on the strip twice, and excluding both
 *  copies would put the caret in the wrong gap. */
function _paletteDropAt(bed, x) {
  const tiles = [...bed.querySelectorAll('.tile[data-pal]')].filter(el => Number(el.dataset.pos) !== _dragFromPos);
  for (let i = 0; i < tiles.length; i++) {
    const r = tiles[i].getBoundingClientRect();
    if (x < r.left + r.width / 2) return { at: i, before: tiles[i] };
  }
  return { at: tiles.length, before: null };
}
function wireDrag(bar) {
  const clearOver = _clearOver;

  bar.addEventListener('dragstart', e => {
    const id = _dragIdOf(e.target);
    if (!id) return;
    const t = e.target.closest('[data-pal], .trow');
    _dragFrom = id;
    // The POSITION the drag started on, or -1 from a rail. A drag within the
    // strip MOVES that entry and carries its verb; a drag in from a rail
    // PLACES a new one in its kind's default verb (§ 4).
    _dragFromPos = t.dataset.pos != null ? Number(t.dataset.pos) : -1;
    _dragFromZone = t.closest('[data-zone]')?.dataset.zone ?? 'pins';
    _dragDropped = false;
    t.classList.add('dragging');
    // A synthetic DragEvent (the audits') may carry no dataTransfer.
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', _dragFrom); } catch (_) {} }
  });
  bar.addEventListener('dragend', () => {
    const from = _dragFrom, fromZone = _dragFromZone, dropped = _dragDropped, fromPos = _dragFromPos;
    _dragFrom = null; _dragFromPos = -1;
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    clearOver();
    // Procreate: a tile dragged off the strip and let go anywhere else is
    // taken off the palette. BY POSITION — a tool on the strip twice must
    // lose the copy you dragged, not the first one.
    if (from && fromZone === 'palette' && !dropped && fromPos >= 0) removeAt(fromPos);
  });
  bar.addEventListener('dragover', e => {
    if (!_dragFrom) return;
    const zone = e.target.closest('[data-zone]'); if (!zone) return;
    e.preventDefault();
    clearOver();
    if (zone.dataset.zone === 'palette') {
      // The insertion caret: on the tile the drop lands before, or the
      // strip's far edge for the end.
      const bed = document.getElementById('paletteBed'); if (!bed) return;
      const { before } = _paletteDropAt(bed, e.clientX);
      if (before) before.classList.add('over'); else bed.classList.add('zone-over');
      return;
    }
    const t = e.target.closest('.tile, .trow');
    // An insertion caret over a factory tile in the box would be a promise the
    // drop handler refuses — the catalogue order is fixed (#283).
    const canInsert = !!_tileCfg[_dragFrom]?.custom;
    if (t && t.dataset.tile !== _dragFrom && canInsert) t.classList.add('over');
    else if (!t || !canInsert) zone.classList.add('zone-over');
  });
  bar.addEventListener('drop', e => {
    const from = _dragFrom, fromZone = _dragFromZone;
    if (!from) return;
    const zone = e.target.closest('[data-zone]'); if (!zone) return;
    e.preventDefault();
    const toZone = zone.dataset.zone;

    // Onto the PALETTE, from anywhere: place it at the caret (a tile already
    // on the palette moves). Full, and nothing happens.
    if (toZone === 'palette') {
      _dragDropped = true;
      const bed = document.getElementById('paletteBed');
      const { at } = bed ? _paletteDropAt(bed, e.clientX) : { at: undefined };
      const fromPos = _dragFromPos;
      _dragFrom = null; _dragFromPos = -1;
      if (fromPos >= 0) moveEntry(fromPos, at); else placeTile(from, at);
      return;
    }

    // Within the BOX: re-ranking YOUR tiles in the library. The factory order
    // is the order the engines run in and the order every doc lists them in,
    // so it is not a preference (#283). A palette tile dropped on the rail is
    // an off-the-strip drop and dragend removes it.
    if (toZone !== 'box' || fromZone !== 'box') return;
    _dragDropped = true;
    const overTile = e.target.closest('.tile, .trow');
    const before = overTile && overTile.dataset.tile !== from ? overTile.dataset.tile : null;
    if (before && _tileCfg[from]?.custom) {
      const cur = order.indexOf(from);
      if (cur >= 0) order.splice(cur, 1);
      const at = order.indexOf(before);
      order.splice(at < 0 ? order.length : at, 0, from);
      _saveOrder();
    }
    _dragFrom = null;
    render();
  });
}

// ── Init ────────────────────────────────────────────────────────────────────

export function initTiles() {
  const bar = document.getElementById('tileBar');
  if (!bar) return;
  _birthFactoryBlocks();
  try { const g = JSON.parse(localStorage.getItem(LS_GONE) || '[]'); if (Array.isArray(g)) _gone = new Set(g); } catch (_) {}
  if (_gone.has(_lensSel)) _lensSel = lensAll()[0] ?? 'wide';
  // One-shot: a custom tool minted while the tape engine was called `loop`
  // (before 2026-09-07) is stored under that name; read it as tape, write it
  // back, no fallback kept.
  { let moved = false;
    for (const id of Object.keys(_tileCfg)) if (_tileCfg[id]?.custom?.engine === 'loop') { _tileCfg[id].custom.engine = 'tape'; moved = true; }
    if (moved) _saveTileCfg(); }
  try {
    const saved = JSON.parse(localStorage.getItem(LS_ORDER) || 'null');
    if (Array.isArray(saved)) {
      const known = id => !!tileDef(id);
      const kept = saved.map(migrateTileId).filter(known);
      // anything known but missing (a new factory tile, a custom made
      // elsewhere) appends. A stored `add` (the old `+` row) is not a tile
      // any more and falls out through `known`.
      // A factory tile the saved order has never seen lands BESIDE its
      // factory neighbours, not at the end (#287): appending put the new
      // `scrape bottom` after the granular brushes, detached from the two
      // erasers it belongs with, for everyone who had already played once.
      for (let i = 0; i < DEFAULT_ORDER.length; i++) {
        const id = DEFAULT_ORDER[i];
        if (kept.includes(id) || _gone.has(id)) continue;   // deleted stays deleted
        let at = -1;
        for (let j = i - 1; j >= 0 && at < 0; j--) {
          const k = kept.indexOf(DEFAULT_ORDER[j]);
          if (k >= 0) at = k + 1;
        }
        if (at < 0) at = kept.length;
        kept.splice(at, 0, id);
      }
      for (const id of Object.keys(_tileCfg)) if (_tileCfg[id]?.custom && !kept.includes(id)) kept.push(id);
      if (kept.length) order = kept;
    }
  } catch (_) {}
  // The palette. Stored as a list of ENTRIES since 2026-09-11 evening; a tile
  // that no longer exists falls out and a verb its kind cannot have is
  // corrected (_sanitizePalette).
  try {
    const raw = localStorage.getItem(LS_PALETTE);
    const arr = raw == null ? null : JSON.parse(raw);
    if (Array.isArray(arr)) palette = arr.map(_entryFromStored).filter(Boolean);
    else {
      // One-shot from the three-slot palette (2026-09-03 → 2026-09-11): what
      // the slots held lands at 2 · 3 · 4 under the wide lens, the pin pair
      // after, so a stored key or button on those positions still means the
      // same tile. `mubone_belt` and the two-slot keys were folded into the
      // slots on 2026-09-03 and are dropped here with them.
      const saved = JSON.parse(localStorage.getItem('mubone_slots') || 'null');
      if (saved && typeof saved === 'object') {
        palette = ['wide', migrateTileId(saved.tape ?? saved.loop), migrateTileId(saved.granular), migrateTileId(saved.erase), 'unpin', 'pin']
          .filter(Boolean).map(_entryFromStored).filter(Boolean);
      }
    }
    for (const k of ['mubone_slots', 'mubone_cycle_off', 'mubone_belt', 'mubone_brush_slot', 'mubone_erase_slot']) localStorage.removeItem(k);
  } catch (_) {}
  _sanitizePalette(); _savePalette();
  try { localStorage.setItem(LS_PALETTE_VERBS, PALETTE_VERBS_V); } catch (_) {}
  // What the DRAWER opens on, before the first render, which reads it. It was
  // the armed tile and had to be a tool on the palette; it is just the tile
  // the sheet is pointed at now, so the rail's first tool will do.
  { const first = tools()[0] ?? order.find(isToolTile);
    if (first) _optSel = { kind: 'tool', id: first };
    // THE HAND at boot: the tool it held last, if it still exists; the first
    // tool otherwise. Picked without applying — nothing is in the cursor
    // until the first press (below).
    let h = null; try { h = localStorage.getItem(LS_HAND); } catch (_) {}
    inHand = (h && tileById(h) && isToolTile(h)) ? h : first;
    if (inHand) _optSel = { kind: 'tool', id: inHand };
    // Re-read here, not only at module load: midi.js's factory re-deal
    // (seedPaletteDigitsOnce, which runs before initTiles) may have just
    // written the hand and its verb.
    try { const v = localStorage.getItem(LS_HAND_VERB); if (v === 'momentary' || v === 'toggle') handVerb = v; } catch (_) {} }
  // The hand's block is applied at boot, as a pick applies it (pickHand →
  // pickTile → applyTileParams): the sheet's tile OWNS the live block, and
  // the sheet opened on the boot hand showed the boot state instead of the
  // tool's own — found 2026-09-12 night, when wash's drawer read "scratch"
  // with cloud on end baked into its block. (From 2026-09-11 to then nothing
  // was applied at boot, because there was no hand to apply.)
  if (inHand) applyTileParams(inHand);

  // ── A RAIL CLICK TAKES THE TOOL IN HAND (Ek, 2026-09-12) ─────────────────
  // "you pick the tool with the mouse i.e. click it, then you should use it.
  // clicking it shouldn't open the drawer, it should be that tool is in
  // hand." The ⋯ is still the drawer's door, and the rail's ghost act tiles
  // (undo) are buttons. Placing on the strip is a drag, as before.
  const onRailClick = e => {
    const b = e.target.closest('.trow');
    if (!b || !b.dataset.tile) return;
    const id = b.dataset.tile;
    const t = tileById(id);
    if (e.target.closest('[data-more]')) {
      if (id === _optSel.id) toggleSheet(id, 'tool');
      else if (pickTile(id)) openProps(id, 'tool');
      return;
    }
    // The ghost act tiles in the rail (undo) are buttons, not tools.
    if (t?.kind === 'act' && !t.ghost) {
      if (t.id === 'undo') S._dispatchAction?.('undo', 127);
      flash(id); return;
    }
    // Anywhere else on the row: in hand. It plays nothing — space and the
    // sphere's click do that — and an open drawer follows the pick.
    pickHand(id);
  };

  // ── A CLICK ON THE STRIP (Ek, 2026-09-12) ────────────────────────────────
  // The strip is a reduction of the rail, so a click means what it means
  // there: a TOOL tile is taken in hand. A LENS tile is a choice — the click
  // installs it or turns it off, as its rail row does. A PIN tile is an act
  // with no span to hold, so the click fires it in its verb, both edges at
  // once. Playing a tool from the strip is its key's, its button's, the
  // wire's — never the mouse's (Ek, this morning: "clicking never activates
  // anymore"). The strip fired from the pointer for one day, 2026-09-11.
  //
  // A click on a LEGEND ROW under a tile arms a learn for that row's kind —
  // the keys page's own cell, brought to the tile (S._paletteLearn); the next
  // key, button or note pressed lands on this position. Clicking it again, or
  // Esc, cancels. Right-click on a row clears that kind's binding.
  //
  // A RIGHT-click on the tile cycles the position's verb through the verbs
  // its kind allows — momentary ↔ toggle for a tool or a lens, the three for
  // a pin — and skips a momentary that a TAP binding could not hold
  // (midi.js `_learnGesture` refuses the same pairing). A bang-only tile has
  // nothing to cycle.
  const onStripClick = e => {
    if (e.target.closest('#handKey')) return;   // the hand tile presses on mousedown (onPlateDown); its legend is fixed
    const row = e.target.closest('.tile-bind[data-learn-kind]');
    if (row) {
      e.preventDefault(); e.stopPropagation();
      const pos = Number(row.dataset.learnPos), kind = row.dataset.learnKind;
      const cur = S._paletteLearning?.();
      if (cur && cur.id === `palette_${pos + 1}` && cur.kind === kind) S._paletteLearnCancel?.();
      else S._paletteLearn?.(pos, kind);
      return;
    }
    const b = e.target.closest('.tile[data-pos]'); if (!b) return;
    const i = Number(b.dataset.pos), en = palAt(i); if (!en) return;
    const k = paletteKind(en.id);
    if (k === 'tool') { pickHand(en.id); return; }
    if (k === 'lens') { lensTap(en.id); return; }
    S._paletteFire(i, true); S._paletteFire(i, false);
  };
  const onStripContext = e => {
    const row = e.target.closest('.tile-bind[data-learn-kind]');
    if (row) { e.preventDefault(); e.stopPropagation(); S._paletteUnbind?.(Number(row.dataset.learnPos), row.dataset.learnKind); return; }
    const b = e.target.closest('.tile[data-pos]'); if (!b) return;
    e.preventDefault();
    const i = Number(b.dataset.pos), en = palAt(i); if (!en) return;
    const allowed = verbsOf(en.id)?.allowed ?? [];
    if (allowed.length < 2) return;
    const taps = (S._bindingsOf?.(`palette_${i + 1}`) ?? []).some(x => x.g === 'tap');
    const order = allowed.filter(v => !(v === 'momentary' && taps));
    // Nothing else this position can take: say so with the fired flash rather
    // than nothing — the factory map binds a TAP on positions 2 and 7, so a
    // right-click on line or pin meets this on day one.
    if (order.length < 2) { flash(en.id); console.info(`[palette] ${en.id} at ${i + 1} stays ${en.verb}: a tap is bound here and cannot hold a momentary`); return; }
    const next = order[(order.indexOf(en.verb) + 1) % order.length];
    setVerbAt(i, next);
  };
  // ── THE SPACEBAR PLATE (Ek, 2026-09-12) ──────────────────────────────────
  // "beside the palette bar it should show what tool is in hand … the space
  // bar actually had the icon and the name of the tool on the spacebar
  // 'image', big and wide the width of the palette bar." It is a spacebar,
  // so pressing it presses the hand — both edges, the release on the window
  // so a drag off it still ends what it started — and a right-click flips
  // its verb, the way a tile's right-click cycles the tile's.
  const onPlateDown = e => {
    if (e.button !== 0 || !e.target.closest('#handKey')) return;
    e.preventDefault(); e.stopPropagation();
    if (_downHandMouse) return;
    _downHandMouse = true; handDown();
  };
  const onPlateContext = e => {
    if (!e.target.closest('#handKey')) return;
    e.preventDefault(); e.stopPropagation();
    setHandVerb(handVerb === 'toggle' ? 'momentary' : 'toggle');
  };
  // ── A LEFT-CLICK ON THE SPHERE PLAYS THE HAND (Ek, 2026-09-12) ───────────
  // The other reserved input. Not while the option key has freed the cursor
  // for the UI, and not in surface mode without the lock (the overlay is up
  // and owns the click). The rails and the dock swallow their own presses,
  // so a press on a control never reaches here.
  const onSphereDown = e => {
    if (e.button !== 0 || S.altLocked) return;
    if (S.cameraMode === 'surface' && document.pointerLockElement !== S.canvas) return;
    e.preventDefault();
    if (_downHandMouse) return;
    _downHandMouse = true; handDown();
  };
  const onMouseUp = e => {
    if (e.button !== 0 || !_downHandMouse) return;
    _downHandMouse = false; handUp();
  };
  // A window blur is a release edge for both wires: a key-up or mouse-up
  // that never arrives must not leave a momentary hand stuck down.
  window.addEventListener('blur', () => {
    if (_downHandKey)   { _downHandKey = false;   handUp(); }
    if (_downHandMouse) { _downHandMouse = false; handUp(); }
  });

  // The pin pair is not a tool, so it gets its own handler. A CLICK cannot
  // hold, so it is the tap form of the gesture — pin where you stand.
  const onPinClick = async e => {
    const b = e.target.closest('[data-pin]');
    if (!b) return;
    _pinFlash(b.dataset.pin);
    if (b.dataset.pin === 'unpinall') { document.getElementById('commitClearBtn')?.click(); return; }
    if (b.dataset.pin === 'unpin') { unpinSelected(); return; }
    await pinDown();
    await pinUp();
  };
  // The palette floats OVER the canvas, whose mousedown starts a trace. The dock
  // is pointer-transparent so the gaps still paint; a tile must swallow its
  // own press so clicking one never lays a mark under it.
  const paletteDock = document.getElementById('paletteDock');
  const toolRail = document.getElementById('toolRail');
  document.getElementById('tcPins')?.addEventListener('click', onPinClick);
  // Both rails float OVER the canvas, whose mousedown starts a trace, so
  // every press inside them is swallowed — not just presses on a control.
  for (const el of [toolRail, document.getElementById('propRail')]) {
    el?.addEventListener('mousedown', e => e.stopPropagation());
  }
  toolRail?.addEventListener('click', onRailClick);
  paletteDock?.addEventListener('click', onStripClick);
  paletteDock?.addEventListener('contextmenu', onStripContext);
  paletteDock?.addEventListener('contextmenu', onPlateContext);
  paletteDock?.addEventListener('mousedown', onPlateDown);
  // A FINGER ON THE HAND TILE is the same press (the phone, 2026-09-12: the
  // palette there is the hand tile alone). preventDefault, so the browser
  // sends no compat mousedown/up pair after the finger lifts — that pair
  // would be a press of no length.
  const onPlateTouch = e => {
    if (!e.target.closest('#handKey')) return;
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'touchstart') { if (_downHandMouse) return; _downHandMouse = true; handDown(); }
    else if (_downHandMouse) { _downHandMouse = false; handUp(); }
  };
  for (const t of ['touchstart', 'touchend', 'touchcancel']) paletteDock?.addEventListener(t, onPlateTouch, { passive: false });
  paletteDock?.addEventListener('mousedown', e => { if (e.target.closest('.tile')) e.stopPropagation(); });
  S.canvas?.addEventListener('mousedown', onSphereDown);
  window.addEventListener('mouseup', onMouseUp);
  // Drag sources and targets: the two rails and the palette (2026-09-11).
  for (const el of [toolRail, paletteDock, document.getElementById('tcPins')]) if (el) wireDrag(el);

  // The lens group — taps install. It sits in the toolbox strip now (#253),
  // so this binds to #lensBar; the wrapping dock element is gone.
  const lensBar = document.getElementById('lensBar');
  lensBar?.addEventListener('click', e => {
    if (e.target.closest('.trow-rn')) return;
    const sc = e.target.closest('[data-lens]');
    if (!sc) return;
    const id = sc.dataset.lens;
    if (!e.target.closest('[data-more]')) { lensTap(id); return; }
    // The ⋯ on the installed lens toggles its drawer; on another lens it
    // installs that lens first (lensTap's synchronous part), then opens.
    if (id === _lensSel) toggleSheet(id, 'lens');
    else { lensTap(id); openProps(id, 'lens'); }
  });
  lensBar?.addEventListener('mousedown', e => e.stopPropagation());

  // ── Naming and retiring a tool, on the row (#284) ────────────────────────
  // Both live in the rail rather than the sheet: the row IS the tool, and
  // neither gesture should need a properties panel open. Bound once on the
  // rail, in CAPTURE, so the row's own click handler never sees the press.
  const rowId = el => el?.dataset.tile ?? el?.dataset.lens ?? null;
  // The wet button, the same way: a tap flips the brush, never loads it.
  toolRail?.addEventListener('click', e => {
    const w = e.target.closest('[data-wet-tgl]'); if (!w) return;
    e.preventDefault(); e.stopPropagation();
    const id = rowId(w.closest('[data-tile]'));
    if (id) setWet(id);
  }, true);
  // The pin button, the same way: a tap flips the tile's on-end flag.
  toolRail?.addEventListener('click', e => {
    const w = e.target.closest('[data-pin-tgl]'); if (!w) return;
    e.preventDefault(); e.stopPropagation();
    const id = rowId(w.closest('[data-tile]'));
    if (id) setAutoPin(id);
  }, true);
  // The `+` on an engine's title mints a tool of that engine and opens its
  // drawer. It waits out a play, the way every click on this rail used to —
  // not because it would move the hand (nothing does), but because opening a
  // drawer over a running stroke is not what the press meant.
  toolRail?.addEventListener('click', e => {
    const a = e.target.closest('[data-add]'); if (!a) return;
    e.preventDefault(); e.stopPropagation();
    if (!_held) _createCustomTile(a.dataset.add);
  }, true);
  // ── Double-click to rename, detected from CLICKS, not `dblclick` (#285) ──
  // The native event never arrives here. The first click picks the tool, which
  // re-renders the rail and REPLACES the row's DOM node — and Chromium only
  // synthesises `dblclick` when both clicks land on the same node. So the
  // second press was always a first press on a new element, and the rename
  // never opened. (A synthetic `dblclick` in a test bypasses that rule, which
  // is exactly why it passed.)
  //
  // The fix is to pair the clicks by TOOL ID rather than by node, and to open
  // the editor on the next tick so the click's own re-render has already
  // happened — otherwise the input is built and then wiped by it.
  let _lastRowClick = { id: null, t: 0 };
  toolRail?.addEventListener('click', e => {
    const row = e.target.closest('.trow--own');
    const id = rowId(row);
    if (!id || e.target.closest('.trow-rn')) return;
    const now = performance.now();
    const again = _lastRowClick.id === id && now - _lastRowClick.t < 500;
    _lastRowClick = { id, t: now };
    if (!again) return;
    _lastRowClick = { id: null, t: 0 };
    setTimeout(() => _openRename(id), 0);
  }, true);

  /** The name field, in place of the row's label. */
  function _openRename(id) {
    const row = document.querySelector(`#toolRail [data-tile="${id}"], #toolRail [data-lens="${id}"]`);
    if (!row || row.querySelector('.trow-rn')) return;
    const nm = row.querySelector('.tile-nm'); if (!nm) return;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'trow-rn'; inp.value = nm.textContent; inp.maxLength = 24;
    nm.replaceWith(inp);
    inp.focus(); inp.select();
    let done = false;
    const finish = keep => {
      if (done) return; done = true;
      // Always repaint: `renameCustomTile` bails out when the name did not
      // change, and without this the row would be left holding a text input.
      if (!keep || !renameCustomTile(id, inp.value)) { render(); renderProps(); }
    };
    inp.addEventListener('blur', () => finish(true));
    // The rail treats letters and digits as tool keys; a name field has to
    // swallow them or typing a name arms a different tool mid-word.
    inp.addEventListener('keydown', e2 => {
      e2.stopPropagation();
      if (e2.key === 'Enter')  { e2.preventDefault(); finish(true); }
      if (e2.key === 'Escape') { e2.preventDefault(); finish(false); }
    });
    for (const t of ['click', 'dblclick', 'mousedown'])
      inp.addEventListener(t, e2 => e2.stopPropagation());
  }

  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('keyup', onKeyup, true);
  setInterval(_pollLiveBlock, 100);
  // The lit state, at a rate a press can be seen at (see refreshPlayingState).
  setInterval(refreshPlayingState, 33);
  setInterval(refreshLensLive, 200);
  render();
}

// The hand, for the record path (brush-voicing.js freezes from it), the
// bridge (wet sync), the renderer (the ring on a wet mark) and import (a wet
// voicing stays wet only for a tile that exists and is wet here). NULL
// between presses — every caller asks while a stroke is running, and every
// one of them handles the empty hand (2026-09-11).
S._handTile   = () => { const id = handTileId(); return id ? { id, label: tileDef(id)?.label ?? id, wet: isWet(id) } : null; };
S._tileIsWet  = id => isWet(id);
S._setGrainOnEnd = setGrainOnEnd;
// The wet switch is in the tool's SHEET head, so it flips the tile the sheet
// is about — it used to flip the hand's, which was the same tile back when
// the sheet followed the armed tool.
S._setWet     = on => setWet(sheetTileId(), on);
// ui-source.js opens the properties rail for the sampler through this — its
// sheet is rendered by that module, so the shell only has to open the rail.
S._openProps = (id, kind) => {
  _optSel = { kind: kind ?? 'tool', id };
  _propsOn = true;
  document.body.classList.add('props-open', 'prail-open');
  document.getElementById('tcTools')?.classList.add('on');
  render();
};
// ui-source.js closes the properties rail through this when a live input is
// chosen — the live source is the one selection in the rail with no sheet
// behind it.
S._closeProps = () => { closeProps(); };
// The auto dry monitor (#245) asks which engine the PLAYING tile records
// with. It asked the selected tile until 2026-09-11, when they were the same
// tile; the drawer's tile is not what a stroke is recorded by.
S._handEngine = () => { const id = handTileId(); return id ? engineOf(id) : null; };
// What KIND of thing is PLAYING — 'brush' | 'edit' | 'act', undefined when
// nothing is. The gesture layer needs this because an erase tile's gesture is
// not a deposit (see brush.js).
S._handKind    = () => tileById(handTileId())?.kind;
S._handIsOverdub = () => handTileId() === 'overdub';
// Visible refusal: the overdub tile flashes when nothing is pinned to overdub onto.
// The keys page saved a binding: the palette's key legend reads the bindings
// at render, so a repaint is the whole update.
S._bindingsChanged = () => render();
S._migrateTileId = migrateTileId;   // a session file's voicings name tiles by id (brush-voicing.js)
