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
// the two ways of pressing (a tap latches, a hold plays), drawn as two spacebar plates under the
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
//     real tile under it — which is what brush-voicing.js reads.
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

import { S, perf, gp , HAND_TAP_MS, FILTER_Q_FLAT, FILTER_Q_PEAK } from './state.js';
import { setBrush } from './brush.js';
import { resolveGrainParams, filterFromCorners } from './brush-voicing.js';
import * as HIST from './history.js';
import { fmtPitch, quantPitch, quantSpeed, PITCH_MAX_CENTS, TAPE_STEPS } from './tape-pitch.js';

const LS_ORDER = 'mubone_tile_order';
const LS_PALETTE = 'mubone_palette';   // the palette: one verb per fixed position (2026-09-22)
// Factory tools DELETED (Ek, 2026-09-10: "delete should be available for
// the factory defaults also"). A custom tool is deleted by dropping its
// definition; a factory one has no definition to drop, so its id is written
// here and tileDef answers as if it never existed. (Lenses were deletable
// too, until there was one — 2026-09-22 night.)
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
  // TRAIL: dots' own dots — r 2.1 — in a circle, six of them on r 7 (Ek,
  // 2026-09-12, night: "the same size dots but in a circle"). LOOP: line's
  // own stroke as a circle with a small gap — r 8, 1.6 wide, 40° open at the
  // top-right ("same width line as the line logo but a circle with a small
  // space in the circle's line"). Both are their engine's brush shape closed
  // into a ring: what they pin on release. The pin mark says the same thing.
  // OVERDUB IS AN O (Ek, 2026-09-23: "make the symbol just a white circle,
  // like an O for overdub"): a plain ring, the letter it stands for. It flags
  // the tape tile, and the same ring circles the number of the loop a dub
  // would join in the pinned rail (css .lyr-trk.dub .lyr-num).
  overdub: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  // AUDITION (Ek, 2026-09-24): headphones — the monitor's own sign, what every
  // DAW draws for "cue this without committing it". It flags the CURSOR tile
  // while the switch is on, and the reticle on the sphere wears the same band
  // and cups (renderer.js drawCursor), so the two are one picture.
  audition: '<path d="M5 15.5v-3.5a7 7 0 0 1 14 0v3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
            '<rect x="3.2" y="13" width="4.2" height="6.6" rx="1.6"/><rect x="16.6" y="13" width="4.2" height="6.6" rx="1.6"/>',
  // TOOLS (Ek, 2026-09-23: "make a glyph for the tools title"): the two
  // instruments you play, drawn as the marks they already wear — tape's line
  // over grain's dots — so the rail's name is read the way its tabs are.
  tools: '<path d="M3 8.5c2.2-3.6 4.4-4.2 6.6-1.9S13.8 8.5 16.5 4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
         '<circle cx="6" cy="15.8" r="2"/><circle cx="12" cy="19.4" r="2"/><circle cx="18.6" cy="16.6" r="2"/>',
  // The pen: a nib on a stroke — the classic thin granular line (spray until 2026-09-06).

  // A VOICE has no gesture to draw, so its row wears the quietest mark there
  // is: one dot in the engine hue. The name is what you read.
  // (`voice`, the dot, and `voiceEdited`, its ring, went 2026-09-24 evening:
  //  a preset row is a word alone.)
  // The sampler's frame. It lived in ui-source.js's `SRC_G` and in `INSTR_G`,
  // "kept identical on purpose" — which is two copies with a promise. It is a
  // TILE now, so it is here, and the tab and the row read it from here.
  sampler: '<rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
           '<path d="M7 14.5l3-4 2.4 3 1.6-2L17 15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  erase: '<path d="M20 19H9l-4.2-4.2a1.6 1.6 0 010-2.3l7.5-7.5a1.6 1.6 0 012.3 0l4.6 4.6a1.6 1.6 0 010 2.3L13 19" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
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
  // the pin family's rule, filled on, outlined off; UNPIN is the outlined pin with
  // the app's own off-slash; UNPIN ALL is two outlined pins under one slash —
  // plural, and gone. The tack silhouette these replace collided with the
  // slash at row size, and its doubled form read as a smudge.
  pin:        '<circle cx="12" cy="8.5" r="5"/><path d="M12 13.5v7.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  unpin:      '<circle cx="12" cy="8.5" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 12.7v8.3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M4.5 19.5l15-15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  unpinAll:   '<circle cx="7.3" cy="8.5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7.3 11.9v8.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="16.7" cy="8.5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M16.7 11.9v8.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M3 20.5L21 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  // The MIX pair. A speaker with its wave, and the same speaker struck
  // through — the footer's mute button already speaks this shape, so the rail
  // is not teaching a new one.
  muteAll:    '<path d="M11 5.5 6.5 9.5H3v5h3.5L11 18.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M16 9.5 21.5 15M21.5 9.5 16 15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  palette:    '<path fill-rule="evenodd" d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zM4.9 12a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0zM7.9 8a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0zM12.9 8a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0zM15.9 12a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0z"/>',
  // The pin mark's OFF face: the same pin, its head outlined.
  pinOff: '<circle cx="12" cy="8.5" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 12.7v8.3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  // YOUR tool, whatever its engine (Ek, 2026-09-10: "give the custom ones a
  // special logo that's distinguishable"): a four-point spark, filled, in
  // the engine's hue. One mark for all of them — the group and the hue
  // already say the engine, so the glyph is free to say "made here".
  custom: '<path d="M12 2.5c.6 5.5 4 8.9 9.5 9.5-5.5.6-8.9 4-9.5 9.5-.6-5.5-4-8.9-9.5-9.5 5.5-.6 8.9-4 9.5-9.5z"/>',
};

// The factory row, mockup order. `ghost` marks tiles whose behaviour is not
// built — they say so rather than pretending.
// ── THE TOOL IS THE INSTRUMENT, ID AND ALL (Ek, 2026-09-22) ───────────────
// "id is the name of the tool, so tape, grain for 1 and 2. 3 is lens, 4 is
// erase." The three survivors still wore their SHAPE-PRESET names — `line`,
// `dots`, `scrape top` — each of which existed to tell it apart from siblings
// that are all deleted now (`slice`/`looper`/`overdub`, `spray`/`comb`,
// `bottom`/`all`). One tool per instrument means the name of the tool is the
// name of the instrument, and the tab directly above was already saying it.
//
// THE ID IS THE ENGINE'S. `engineOf(id) === id` for all three, so one string
// keys the tool, its engine, its hue, its sheet and its tab — and `ENGINES[id]`
// or `PERF_PIDS[id]` can never be right for two tools and wrong for the third.
// That is why grain's id is `granular` and not `grain`: `granular` is the
// engine's id and GRAIN is what it is called everywhere a person reads it,
// which is the convention already in force. The label carries the word.
//
// The old ids die — `_RENAMED_TILES` carries every stored slot, block, hand
// and palette entry across in one shot, and nothing falls back afterwards.
const TILE_DEFS = {
  tape:   { kind: 'brush', g: 'line',   c: '#ff6b9d', label: 'tape',
            foot: 'Records a trigger — one buffer, played whole when the cursor reaches it. Loop-on-touch is the dwell option. The line ↔ trigger merge is § 1d.' },
  // (SLICE was a tile here until 2026-09-22. One take cut into triggers at its
  //  onsets is `triggerParams.sliceOn` now — a switch on the tape tab, because
  //  it is something you decide while playing, not a tool you pick up. Tape has
  //  one shape.)
  // LOOP AND DUB ARE DELETED (2026-09-22). Each was a tape shape whose whole
  // identity had become a MODE switch: `loop` was `onEnd: 'loop'`, which is
  // AUTOPIN, and `dub` forced `S._handIsOverdub`, which is OVERDUB. Two doors
  // onto one flag — and the worse kind, because picking the shape moved the
  // switch behind your back. What they did is not lost, it is asked once:
  // autopin on, a take pins itself on release; overdub on, it joins the nearest
  // pinned loop. `passes` (the self-killing N) is a tape sheet row and belongs
  // to any tape shape; the dub's BANG — one cycle of the master and let go —
  // moved onto tape's allowed verbs, where it means that whenever overdub is on.
  // `line` is what is left: one tape tool, and the behaviours that used to be
  // separate shapes are the tab's own switches.
  // (`pen` was the id and DOTS the name, from 2026-09-12 to 2026-09-22 — "the
  //  id stays: it keys stored blocks, palettes, voicings in session files and
  //  every audit, and a rename of the id is a migration for a day the audits
  //  run." This is that day, and the migration is `_RENAMED_TILES`.)
  granular: { kind: 'brush', g: 'dots', c: '#e8a030', label: 'grain',
            foot: 'The granular trace — marks on a tick, each a window into the buffer. Granulates what is in reach.' },
  // TRAIL WAS HERE (deleted 2026-09-22, Ek). The wash tile — id `wash`, named
  // trail since 2026-09-12 — arrived pre-dialled as a reverb and pinned its
  // stroke as a cloud on release. The BEHAVIOUR is not gone with it: `cloud on
  // end` is a row on the grain shape sheet and `S.traceMode` is the flag under
  // it, so any grain shape can still be the wash. What went is the preset that
  // came with one answer already chosen. (The grain VOICE named `wash`,
  // VOICE_SEED.granular below, is a different object and stays.)
  // (SPRAY was a tile here until 2026-09-22. It is an AMOUNT on grain's
  //  performance block — 0 is no spray — so there was no identity left to be a
  //  tile with.)
  // (INDEX — `comb` — was a tile here until 2026-09-22, for one evening. It
  //  went with `sort by` itself: "let's sunset the sort by and remove the index
  //  preset". The stroke keeps the order you played it in.)
  // ── ONE ERASER (Ek, 2026-09-22: "for erase, no more presets!") ───────
  // There were three, and the ruling that made them says why they went: each
  // was "a preset of depth + direction", and those are two rows on the erase
  // tab now. `scrape all` was the same pair with the recency filter off, which
  // depth at its ceiling already is.
  // `scrape top` named the one of three that took the newest layer. There is
  // one eraser, so `top` distinguishes nothing; depth is a row on the tab.
  erase:  { kind: 'edit',  g: 'erase',  c: '#e57373', label: 'erase',
            foot: 'Takes ONE layer off the top — the newest material under the cursor, revealing what was beneath. Depth is the same knob as the cursor\'s; raise it to take more.' },
};
// Core brushes, then edits (both fully keyed — the working set), then the
// experimental brushes. Kind changes draw dividers, so the sets read as
// sets. Undo/redo moved to the chrome (⌘Z still works). The `+` that ended
// the list is gone (2026-09-10): a new tool is minted from the `+` on its
// engine's title, so there is no "new" group and no engine chooser.
// echo, chop and pour were cut 2026-08-29 (Ek); trail, match and staff on
// 2026-09-22, and `spray` and `comb` the same day — they had become `pen` with
// one shared row dialled, and when `spray` and `sort by` were themselves sunset
// there was no number left for either to be a named starting point at. ONE TOOL
// PER INSTRUMENT is what is left.
const DEFAULT_ORDER = ['tape', 'erase', 'granular'];   // one tool each, named for it

// ── The lens — ONE, and it is the cursor (Ek, 2026-09-22 night) ───────────
// "it doesn't make sense anymore to have cursor presets and just all the
// params available as performance settings, as a tab in the tool rail."
// The camera model stands: the hand tiles say what the HAND does, the lens
// says what the EYE does, and they compose. What went is the LIST — `wide`,
// `spot` and the `+` that minted more. The two factory lenses differed by one
// capsule (`mode`: area · nearest), so they were one lens with a setting
// pre-answered, which is the same reason the shape presets went that evening.
// Every one of the cursor's rows is on the LENS TAB now (`PERF_PIDS.lens`),
// and the one thing left to PLAY is on / off: the lens tile on the strip, in
// its toggle (the cap: no lens on, the cursor reads nothing) or momentary (a
// peek). No block to apply, no selection to store — the sheet is the live eye.
const LENS_ID = 'lens';
// The mode's two marks: rings for area, the reticle's diamond for nearest —
// the glyphs `wide` and `spot` wore, now naming the VALUE they always meant.
// `area` is also the lens's own glyph, on the tile and the tab.
const MODE_G = {
  area:    '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55"/>',
  nearest: '<path d="M12 3l9 9-9 9-9-9z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M12 9.6l2.4 2.4-2.4 2.4-2.4-2.4z"/>',
};
const LENS_G = MODE_G.area;

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
// THE FACTORY STRIP IS QUICK ACCESS, NOT THE TOOLS (Ek, 2026-09-22: "the first
// spacebar hand is line default. the second spacebar hold is dots default, next
// quick access, cursor wide keylearn to c, pin and unpin key down and up").
// The two tools you PLAY are in the hand — line on the spacebar's press, dots on
// its hold — so they need no position, and the strip is what is left: the eye,
// and the two pin acts. Three positions, and every one of them is a thing you
// reach for mid-phrase rather than a thing you paint with.
// midi.js PALETTE_FACTORY_ENTRIES is the same list and seeds it; keep them in
// step. (They had drifted — this one had five entries and that one six.)
// ── THE PALETTE IS A FIXED TOOLBAR (Ek, 2026-09-22) ───────────────────────
// "there's no more drag. it's like forscore or procreate or adobe edit. the
// tile is the tool, the first tile is the tape tool, the 2nd tile is the grain
// tool … lens tile is there after, then erase, then the pins as they are."
//
// It was a strip you COMPOSED — drag a tool in from the rail, drag it off to
// remove, reorder, up to nine. That made sense when an engine had several
// shapes and which three you wanted on the strip was a real question. It has
// not made sense since one tool per instrument: there were four tools and nine
// slots, the rail stopped drawing rows to drag FROM (its `zone:'box'` branch
// went unreachable), and the strip quietly became unbuildable — nothing could
// be added to it at all. A fixed toolbar is what it had already become.
//
// So the ids are the code's and the ORDER is the code's. What is still yours
// per position: the VERB (right-click) and the key / MIDI / accessory binding.
// What the two tool tiles WEAR is their voice — that is the variable now, not
// which tiles exist. The lens tile is the eye, on or off.
//
// The verbs are each engine's own default, the same ones the hand takes from
// the rail: tape toggles, grain and erase are momentary — erasing is
// destructive and held is the gesture that says so.
// THE TWO TOOLS ARE ALREADY THE FIRST TWO TILES — they are the HAND's two
// sides, the wide tiles at the head of the row, each naming its tool and the
// VOICE it wears. "The first tile is the tape tool, the 2nd tile is the grain
// tool … then the voice is the thing those wear" describes those, and putting
// `tape` and `granular` in the list as well drew each tool twice, once big and
// once as a `T` and a `G` (caught on screen, 2026-09-22). The row is six tiles:
// the hand's two, then these four.
const DEFAULT_PALETTE = [
  { id: LENS_ID,  verb: 'toggle'    },
  { id: 'erase',  verb: 'momentary' },
  // PIN IS A MOMENTARY BY FACTORY (Ek, 2026-09-23: "by default the pin factory
  // default should be a momentary"): hold it and move, and the path you draw
  // is the cloud. A bang pins where you stand; a right-click cycles to it.
  { id: 'pin',    verb: 'momentary' },
  { id: 'unpin',  verb: 'bang'      },
];
// The palette's ids are not stored any more — only the verb per position — so
// this is the list every read rebuilds from. `PALETTE_LEN` replaces the old
// `PALETTE_MAX`: not a cap on how many you may add, a statement of how many
// there are.
const PALETTE_LEN = DEFAULT_PALETTE.length;
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
    for (let n = 1; n <= PALETTE_LEN; n++) {
      const has = suffix => maps.some(m => m && m[`palette_${n}${suffix}`]);
      if (has('_hold')) out[n - 1] = 'momentary';
      else if (has('_toggle')) out[n - 1] = 'toggle';
    }
  } catch (_) {}
  return out;
})();
// DELETED TILES (2026-09-22): `looper` and `overdub`. What each did is a MODE
// switch now — autopin and overdub — so a stored position becomes `line`, which
// is what a tape shape is, and the switches say the rest. No fallback: after
// this the ids resolve to nothing. Their stored BLOCKS are dropped rather than
// merged: a dub's block over `line`'s would be a preset nobody asked for.
// 2026-09-22: one tool per instrument. A stored slot keeps its POSITION and its
// learned key by resolving to the tool that absorbed it.
// The RIGHT-hand side moved with the rename (2026-09-22): these resolve a dead
// id to the tool that absorbed it, so they have to name the tool as it is
// called now, not as it was called the hour they were written.
const _DROPPED_TILES = { looper: 'tape', overdub: 'tape',
  slice: 'tape', spray: 'granular', comb: 'granular',
  bottom: 'erase', all: 'erase' };
// (`_entryFromStored` was here until 2026-09-22. It turned one stored palette
//  element into an entry, resolving a dead id and deriving a verb from the old
//  three-action bindings. `_loadPalette` does the resolving now, and it does it
//  to find a slot rather than to build one.)

// The two pin ACTIONS as tiles: grey glyph (a pin holds any engine's
// material), a flash on the press (`_pinFlash`).
const ACT_TILES = {
  pin:   { g: 'pin',   action: 'commit_drop',    label: 'pin',   tip: 'pin — keeps what the cursor is sounding, where it stands: every line it is on becomes a loop, and the grains in reach a cloud. Hold it and move to pin a cloud along a path. Played from its key; a click here does nothing' },
  unpin: { g: 'unpin', action: 'commit_release', label: 'unpin', tip: 'unpin — lets go of the selected pin, the first row of the pinned rail (sort decides which). Hold its key extra long to unpin everything. Played from its key; a click here does nothing' },
  // A palette candidate since 2026-09-12 (Ek, night: the pin rows are tool
  // rows, "consistent with being able to drag those tools from the right
  // rail into and out of the palette bar"). A bang, always; nothing to aim.
  unpinall: { g: 'unpinAll', action: 'commit_clear', label: 'unpin all', tip: 'unpin all — release every pin, clouds and loops', danger: true },
  // MIX, not PIN (Ek, 2026-09-15). This changes what you HEAR and releases
  // nothing, which is why it is its own group on the rail rather than a row
  // under pin: `unpin all` beside `mute all` would read as two degrees of the
  // same act, and one of them cannot be undone. (`unmute all` — clear every
  // per-pin M and S at once — sat beside it until 2026-09-23; Ek: no use for it
  // now that mute is a toggle that keeps the per-pin flags. M and S clear one
  // at a time.)
  mute:      { g: 'muteAll',   action: 'pins_mute',       label: 'mute',       tip: 'silence every pin, and let it back on the next press — your per-pin mutes and solos survive the round trip. Hold it instead for a cut: set the tile momentary in its drawer' },
  // THE SAMPLER IS A TILE (Ek, 2026-09-22: "make the sampler a legit bench tile
  // as well"). It was a row in a panel and nothing else — the one thing in the
  // rails you could not put under a key. What it does is swap the MATERIAL the
  // brush inks from, which is a press like any other: hold it and this stroke
  // comes off the file, toggle it and the next few do. It is an ACT and not a
  // tool because it has no shape and no voice — it changes what the tools read,
  // the way a lens changes what the cursor sees.
  sampler: { g: 'sampler', action: 'source_sampler', label: 'sampler', hue: 'source',
             tip: 'paint from a file instead of the mic — any brush inks from the current take. Hold it for one stroke, or toggle it and it stays' },
};
function isActTile(id) { return Object.prototype.hasOwnProperty.call(ACT_TILES, id); }
/** A tool you play — a brush or an eraser, not a ghost. Custom tiles qualify. */
function isToolTile(id) {
  const t = tileDef(id);
  return !!t && (t.kind === 'brush' || t.kind === 'edit') && !t.ghost;
}
/** The one lens. Not deletable, not mintable, not in `_gone` (2026-09-22). */
function isLensTile(id) { return id === LENS_ID; }
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
// THE DEFAULT VERB IS THE MATERIAL'S (Ek, 2026-09-22: "all tape should by
// default on load be a toggle verb, all grain should by default load as
// momentary … sampler by default should be momentary. scrape should be
// momentary. lens is a toggle on and off"). It is the same rule the HAND has
// always had — a take is a thing you start and leave running, a grain cloud is
// a thing you hold — and it was only ever stated for the hand. Now every door
// into a verb reads it: the bench, a drop on the strip, a stored entry whose
// verb went missing. A right-click still flips any of them; this is where they
// START, not what they are.
//
// Keyed by ENGINE, with `tool` left as the floor for anything that has none.
const VERBS_OF = {
  tool:  { allowed: ['momentary', 'toggle'], def: 'momentary' },
  // TAPE HAS THE BANG (2026-09-18, and it outlived the dub tile that carried
  // it): Blooper's three record gestures are three verbs — toggle is the
  // overdub, momentary the punch-in, and BANG the one-shot, exactly one cycle
  // of the master and then it lets go of itself. It does that whenever OVERDUB
  // is on; with it off a bang has no master to borrow a length from and is
  // refused visibly, the same way it always was.
  tape:     { allowed: ['momentary', 'toggle', 'bang'], def: 'toggle' },
  granular: { allowed: ['momentary', 'toggle'], def: 'momentary' },
  // A TAP, NOT A HOLD (Ek, 2026-09-22: "sampler and erase should be A normal
  // not long for audition"). The bench's verb IS the audition's gesture — a
  // toggle taps, a momentary is held — and it is also the verb the tile is
  // placed with, so these two now DROP as toggles too; a right-click on the
  // bench cycles either back.
  erase:    { allowed: ['momentary', 'toggle'], def: 'toggle' },

  lens:  { allowed: ['momentary', 'toggle'], def: 'toggle' },
  pin:   { allowed: ['bang', 'momentary', 'toggle'], def: 'momentary' },   // 2026-09-23: was bang
  unpin: { allowed: ['bang'], def: 'bang' },
  unpinall: { allowed: ['bang'], def: 'bang' },
  // A toggle by factory, and momentary allowed because holding it is a CUT —
  // the same tool in two verbs, which the strip already supports.
  mute:      { allowed: ['toggle', 'momentary'], def: 'toggle' },
  // No bang: swapping the source is a STATE, and a bang that turned it on with
  // no way back would be the trap the `in N` rows used to cover.
  // A TOGGLE BY FACTORY since 2026-09-22 (Ek: "sampler and erase should be A
  // normal not long for audition"). It was momentary on the reasoning that the
  // file under the brush for ONE stroke is the gesture — but the bench's verb
  // is also the audition's, so that reasoning made `A` a key you had to hold
  // down to hear the sampler at all. Trying it is a toggle: on, listen, off.
  // Momentary stays allowed, one right-click away, for the one-stroke gesture.
  sampler:   { allowed: ['toggle', 'momentary'], def: 'toggle' },
};
export function verbsOf(id) {
  const k = paletteKind(id);
  if (!k) return null;
  // The tile's own entry, then its ENGINE's, then its kind's. `overdub` is the
  // one tile with its own, because its bang is a Blooper gesture no other tape
  // shape has.
  return VERBS_OF[id]
      ?? (k === 'tool' ? VERBS_OF[engineOf(id)] : null)
      ?? (k === 'act' ? null : VERBS_OF[k])
      ?? null;
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
/** ONLY THE VERBS ARE YOURS (2026-09-22). The strip is a fixed toolbar, so the
 *  ids and the order are the code's and storing them would only be a way for a
 *  profile to disagree with the build. One verb per position, in order. */
function _savePalette() {
  try { localStorage.setItem(LS_PALETTE, JSON.stringify(palette.map(e => e.verb))); } catch (_) {}
}
/** Make every verb one its kind allows. The ids need no sanitising any more —
 *  they are `DEFAULT_PALETTE`'s and nothing can put anything else there. */
function _sanitizePalette() {
  palette = DEFAULT_PALETTE.map((d, i) => {
    const v = palette[i]?.verb;
    return { id: d.id, verb: verbAllowed(d.id, v) ? v : d.verb };
  });
}
/** The strip, read from disk. Two shapes have been stored here and this reads
 *  both: a list of VERBS (2026-09-22 on), and the composable strip's
 *  `[{id,verb},…]` before it — from which each entry's verb is carried to the
 *  position its tool now occupies, so a verb you set on the eraser is still on
 *  the eraser after it moved from slot 2 to slot 4. Anything that no longer
 *  has a slot simply has nowhere to land. One shot: `_savePalette` writes the
 *  new shape immediately after. */
function _loadPalette() {
  palette = DEFAULT_PALETTE.map(e => ({ ...e }));
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(LS_PALETTE) || 'null'); } catch (_) {}
  if (!Array.isArray(raw) || !raw.length) return;
  if (typeof raw[0] === 'string') {
    raw.forEach((v, i) => { if (palette[i] && verbAllowed(palette[i].id, v)) palette[i].verb = v; });
    return;
  }
  raw.forEach((e, i) => {
    const was = typeof e === 'string' ? e : e?.id;
    if (typeof was !== 'string') return;
    const id = _DROPPED_TILES[was] ?? migrateTileId(was);
    const at = palette.findIndex(p => p.id === id);
    const verb = typeof e === 'object' && e ? e.verb : _derivedVerbs[i];
    if (at >= 0 && verbAllowed(id, verb)) palette[at].verb = verb;
  });
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
// (PLACE, MOVE, REMOVE and REMOVE-BY-ID were here until 2026-09-22. They were
//  the composable strip's whole API — drop a tool in, drag it along, drag it
//  off — and the strip is a fixed toolbar now: "there's no more drag. it's
//  like forscore or procreate or adobe edit." The ids and the order are the
//  code's, so there is nothing to place, nothing to move and nothing to
//  remove; `setVerbAt` above is the only thing left that writes the strip.
//  `S._paletteReordered`, which carried every key and MIDI binding along when
//  a tile shifted, went with them — a position that cannot move needs no
//  carrier, and midi.js keeps its bindings on `palette_N` as before.)

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
let _optSel = { kind: 'tool', id: 'granular' };  // what the options bar shows
// ── THE HAND (Ek, 2026-09-12) ─────────────────────────────────────────────
// "like any computer painting app, the tool rail has the tool. you should be
// able to pick the tool and have it 'in hand'. in hand just should mean what
// the spacebar or click does. that should be always the truth."
//
// The hand is ONE tool — a brush or an eraser — picked by a CLICK on its rail
// row or its strip tile, and played by the SPACEBAR and a LEFT-CLICK on the
// sphere: the two inputs reserved for it, learnable onto nothing else. Its
// hand has NO verb: the press is the verb (two hand tiles, 2026-09-21) and the hand
// tile's right-click flips it; it is drawn as the spacebar plate under
// the strip (the tile's own two shapes). The palette tiles are QUICK ACCESS:
// each fires from its own key, button or note, in its own verb, and never
// touches what is in hand. `_held` (below) stays what is PLAYING, from either
// door; `inHand` is what space would play. The drawer follows the hand
// (pickHand). That replaces `lastFired`, which made the drawer follow whatever was
// fired last — a quick-access key moving the drawer off the tool you are
// working on was the wrong rule once there was a hand again.
const LS_HAND = 'mubone_hand';   // (LS_HAND_VERB retired: the hand has no verb)
const HAND_POS = -1;          // `_held.i` while the hand plays — no position
// ── THE BENCH (Ek, 2026-09-21) ─────────────────────────────────────────────
// The left rail is an EDITOR, so selecting a shape or a voice in it must not
// reach the palette: "selecting the thing shouldn't load it into the spacebar
// glyph in the palette bar. we should build the glyph/tile in the left rail."
// So a selection lands on the BENCH. (It had its own key, `A`, to hear what
// you were building without placing it, 2026-09-21 to 09-24; the editor
// writes the slot since 09-22, so the spacebar plays what you select, and `A`
// is AUDITION's key now.) The spacebar stays the palette's, always.
// ── THE EDITOR SHOWS ONE INSTRUMENT (Ek, 2026-09-22) ──────────────────────
// "i'm trying too hard to make global settings work for the whole rail. when
// really it's a TAPE instrument, and GRAIN instrument and a SAMPLER." So the
// rail is scoped to one of them at a time, and everything under the tabs
// belongs to it. Erase and the lens are tabs too, on a second row: they are not
// instruments, and the row they sit on says so.
// ONE ROW, ICONS (Ek, 2026-09-22). Each tab wears the thing's OWN glyph — the
// same mark it wears everywhere else in the app — so the row is read the way the
// rest of the instrument is read: by shape and hue, never by a word.
// `sampler` borrows ui-source.js's own picture-frame, which is what the source
// row has drawn since #253; the lens takes its reach rings.
// THE LENS IS A TAB AGAIN (Ek, 2026-09-22 night). It was one for a day and
// left, because the tabs then BUILT a tool you placed and there is no unheld
// moment for the eye. The editor writes the SLOT now — a tab reflects what its
// instrument holds and edits it in place — and the lens has exactly one slot,
// its position on the strip, like the eraser. So the tab is the cursor's
// controls, all of them, and the tile on the strip is its on / off.
// THE SAMPLER CLOSES (Ek, 2026-09-22 night). The lens LED the row until
// 2026-09-23, when it left the tabs for its own section at the rail's foot
// (`#cursorSec`, always shown); the tabs are the instruments you play.
const INSTRUMENTS = [
  { id: 'tape',     label: 'tape',    g: 'line',    tip: 'plays a take whole — its switches, how the cursor fires a line, its voice presets' },
  { id: 'granular', label: 'grain',   g: 'dots',    tip: 'plays a take in fragments — its switches, how marks are laid down, its voice presets' },
  { id: 'erase',    label: 'erase',   g: 'erase',   tip: 'takes marks off the sphere — how deep it reaches, and which layer first' },
  { id: 'sampler',  label: 'sampler', g: 'sampler', tip: 'the file the brushes ink from' },
];
// The one that is not in `G`: the lens's own reach rings.
const INSTR_G = { lens: LENS_G };
// The sampler is PARKED unless Settings › Tools switches it in (sampler.js):
// off, its tab is not in the row and nothing can select it.
const _instruments = () => S.samplerEnabled ? INSTRUMENTS : INSTRUMENTS.filter(i => i.id !== 'sampler');
S._samplerAvailChanged = () => render();
const LS_INSTR = 'mubone_instrument';
let _instr = 'tape';
try { const v = localStorage.getItem(LS_INSTR); if (INSTRUMENTS.some(i => i.id === v)) _instr = v; } catch (_) {}
export function instrument() { return _instr; }
export function setInstrument(id) {
  if (!_instruments().some(i => i.id === id) || id === _instr) return false;
  _instr = id;
  try { localStorage.setItem(LS_INSTR, id); } catch (_) {}
  // The tab swaps the bench, so the SHEET follows it — the same rule a row
  // click obeys. Without this you arrive on tape still reading a lens's page.
  const b = benchShape();
  if (b) {
    // A tool has no sheet of its own any more; its ENGINE's VOICE has — one
    // sheet per instrument, the live block, which the presets under it recall
    // (2026-09-24). So the sheet follows the tab to that engine, and only an
    // instrument without a voice (erase, the lens, the sampler) points at the
    // tool itself, whose sheet is a head saying where its rows are.
    const eng = engineOf(b);
    if (VOICE_PIDS[eng]?.length) { _optSel = { kind: 'engine', id: eng }; _propRow = eng; }
    else {
      _optSel = { kind: _selKind(b), id: b }; _propRow = b;
      // NO DRAWER on a tab with nothing to draw in one (Ek, 2026-09-23: erase
      // "doesn't have a drawer sheet to be opened, it still seems to open …
      // same with the lens sheet, there's no lens drawer anymore"). A head
      // saying "every setting is on its tab" was still a drawer over the stage.
      document.body.classList.remove('prail-open');
    }
  }
  render();
  if (propsOpen()) renderProps();
  return true;
}
/** What `_optSel.kind` says for a benchable id — the three the sheet tells apart. */
function _selKind(id) { return isActTile(id) ? 'act' : isLensTile(id) ? 'lens' : 'tool'; }
// THE BENCH REMEMBERS PER INSTRUMENT (Ek, 2026-09-22: "clicking on the tool tab
// for an item should also load whatever was last on the bench in that tool").
// A tab is not a filter over one bench — each instrument is a workbench of its
// own, and coming back to tape should find the tape shape you left there. The
// key is the instrument, so `lens` keeps its own alongside the two engines.
// (`_benchBy` and `_benchLast` are gone, 2026-09-22. They were the editor's own
// memory of a tool per instrument — a THIRD place a tool could be, beside the
// hand and the strip, which is exactly what made the bench worth its keep and
// then worth deleting. `slotOf` derives the subject from the slot now, so the
// editor cannot disagree with what plays.)
// The bench tile carries the VERB the tool will be PLACED with, and a
// right-click cycles it — the same gesture the strip has always used (Ek,
// 2026-09-22: "that bench tile should also be right clickable the switch the
// verb"). It is not the hand's verb: the hand has none, both ways of pressing
// are live. This is the outline the tile will wear once it is on the strip.
// PER INSTRUMENT, like the bench itself: flipping tape to momentary must not
// follow you to grain, or the "grain loads momentary" rule would last exactly
// until the first right-click on a tape shape. Not persisted — it is what you
// flipped this session, and the default is what you get on load.
// (The bench's stored tool, `mubone_bench`, is a retired key — storage-registry.js.)
// THE HAND IS TWO TOOLS, one per press kind (Ek, 2026-09-22: "when i drag the
// tile in tool creator to the hand tile it fills in both of them, should just
// fill in the one"). `press` is the first tile — the one a tap latches — and
// `long` the second, played while you hold. The spacebar and the sphere's click
// carry both, told apart by the SAME recogniser every other binding uses, so a
// press fires on the down with no latency and a long that follows takes back
// what the press started (midi.js `_abortPress`).
// THE HAND HOLDS A PAIR PER SIDE, exactly as a palette position does (Ek,
// 2026-09-22: "i thought the whole point of creating the tool then dragging it
// into the palette is that once they're in the palette they're fixed").
// Positions were already frozen — a placed entry stamps `{id, verb, voice}` and
// nothing later moves it except the editor rewriting its own slot. The HAND was the hole: it plays through
// `HAND_POS` (-1), which `_playDown` read as "no voice", so the spacebar played
// whatever was on the live block — and picking a voice in the tool creator
// WRITES the live block. Change the grain voice while building a tool and the
// hand's dots changed with it, which is what Ek saw, and the hand tiles sit at
// the head of the strip so it read as the palette moving.
// Each side is `{ id, voice }` now, frozen at the PICK, applied at the press.
let inHand = { press: null, long: null };
const _side = which => (which === 'long' ? 'long' : 'press');
/** The tool one of the hand's two presses holds. */
function handTool(which) { return inHand[_side(which)]?.id ?? null; }
/** The preset that side's engine is on — for the hand tile's word. A PRESET
 *  IS A RECALL (Ek, 2026-09-24): the side no longer freezes a voice at the
 *  pick, because there is nothing to freeze — the press plays the engine's
 *  live block, and the preset only says where the sliders were last set
 *  from. (`_ensureHandVoices` and `_writeSlotVoice`, which kept a per-side
 *  copy in step, went with the copy.) */
function handVoice(which) {
  const id = inHand[_side(which)]?.id;
  const eng = id ? engineOf(id) : null;
  return eng ? currentVoice(eng) : null;
}
// ── EACH HAND HAS ITS OWN VERB AGAIN (Ek, 2026-09-22) ─────────────────────
// "The big hands should also be able to be right clickable to change the verb."
//
// `handVerb` was deleted on 2026-09-21 under a true ruling that has since
// stopped applying: THE PRESS IS THE VERB — one tool played two ways, a tap
// latching it and a hold playing it while held, so a stored verb would have
// been a third answer to a question the gesture already answered. What changed
// the day after is that the two sides became two TOOLS, each with its own tile,
// its own voice and its own engine. Tape wants to latch and grain wants to be
// held, but that is a property of the tool on the side, not of the gesture that
// reaches it — and the moment the sides can hold different tools, one fixed
// answer per side is the wrong number of answers.
//
// So the verb is stored per SIDE, seeded with exactly what was hardcoded —
// press toggles, hold is momentary — and cycled by a right-click on the tile,
// the same gesture and the same `verbsOf` table a palette position uses. The
// recogniser still decides WHICH SIDE a gesture reaches; the verb decides what
// that side then does, which is the division that was always there.
//
// NO BANG on the hand. `verbsOf('tape')` allows it for the dub's one-shot, and
// `_playDown` reads that off `palette[i].verb` — the hand's `i` is -1 and has
// no entry, so a bang here would silently be a momentary. It is filtered out
// rather than half-wired.
const HAND_VERB_DEF = { press: 'toggle', long: 'momentary' };
function handVerb(which) {
  const side = _side(which), id = handTool(side);
  const v = inHand[side]?.verb;
  return (id && verbAllowed(id, v) && v !== 'bang') ? v : HAND_VERB_DEF[side];
}
/** The verbs a hand side may cycle: its tool's, minus the bang it cannot do. */
function handVerbsOf(which) {
  const id = handTool(which);
  return (verbsOf(id)?.allowed ?? []).filter(v => v !== 'bang');
}
function setHandVerb(which, v) {
  const side = _side(which);
  if (!inHand[side] || !handVerbsOf(side).includes(v)) return false;
  inHand[side].verb = v;
  _saveHand();
  render();
  return true;
}
/** Both hands, written whole. `mubone_hand` held ONE id until 2026-09-22;
 *  a stored string is read as the press hand and the long hand takes it too,
 *  so nothing changes under a player until they drop something new. */
function _saveHand() {
  try { localStorage.setItem(LS_HAND, JSON.stringify(inHand)); } catch (_) {}
}
export function inHandId(which) { return handTool(which); }
/** What is playing, for the rig: which position and whether it latched. The
 *  hand's two tiles are a view of exactly this, so a suite that checks them can
 *  check the fact behind them too. */
export function heldDebug() { return _held ? { i: _held.i, id: _held.id, latched: !!_held.latched } : null; }
/** PICK a tool into the hand. The one gesture that does it is a click — the
 *  rail row or the strip tile — and the drawer follows the pick (Photoshop's
 *  options bar, through pickTile). Placing on the strip is still a drag. */
export function pickHand(id, which = 'press') {
  const t = tileById(id);
  if (!t || t.ghost || !isToolTile(id)) return false;
  // The verb is the SIDE's, not the tool's, so it stays through a pick;
  // `handVerb` falls back to the default when the new tool does not allow it.
  const verb = inHand[_side(which)]?.verb;
  inHand[_side(which)] = verb ? { id, verb } : { id };
  _saveHand();
  pickTile(id);
  return true;
}
/** What is on the bench: a SHAPE (a tool tile), and the voice its engine is
 *  on. Falls forward to the first real tool so the bench is never empty — an
 *  empty bench has nothing to audition and nothing to place. */
// The lens too (2026-09-22 night): its tab edits the eye in place, so it is the
// tab's subject the way the eraser is the erase tab's.
const _benchable = id => !!id && (isToolTile(id) || isActTile(id) || isLensTile(id));
/** The first shape an instrument offers, for a bench that has never been set:
 *  its own rail order, so the answer is the top row of what you are looking at. */
function _firstShapeOf(instr) {
  if (instr === 'sampler') return 'sampler';
  if (instr === 'lens') return LENS_ID;
  return DEFAULT_ORDER.find(id => engineOf(id) === instr && isToolTile(id)) ?? null;
}
/** WHICH TAB A BENCHABLE THING BELONGS TO. Not `engineOf`: an act tile has no
 *  engine, so the sampler filed itself under `null` and its tab never found it
 *  again (Ek, 2026-09-22: "the sampler tile doesn't load when i press it on the
 *  tab"). The bench is keyed by INSTRUMENT because the tabs are. */
function instrOf(id) {
  if (isActTile(id)) return id === 'sampler' ? 'sampler' : null;
  return engineOf(id);
}
// ── THE EDITOR HAS NO STATE OF ITS OWN (Ek, 2026-09-22) ───────────────────
// "the tool creator is still actually a tool editor … when i'm in the tool
// creator/editor, i change the shape preset and voice preset and it should
// update what is being held … same with erase, when i change the preset in the
// tabbed area it'll just update the erase tile in the palette."
//
// So the editor no longer holds a tool of its own beside the ones that play.
// It REFLECTS the slot its tab belongs to and WRITES to it. `_benchBy` — the
// per-instrument bench, saved to disk — is gone with the bench tile: it was a
// third place a tool could be, beside the hand and the strip, and keeping the
// three in step was the whole cost of the bench.

/** The side of the hand an engine lives on: the one already holding it, else
 *  that engine's factory home — tape on the press, everything else on the hold
 *  (midi.js HAND_FACTORY: line and dots). */
function handSideFor(eng) {
  if (eng && engineOf(handTool('press')) === eng) return 'press';
  if (eng && engineOf(handTool('long'))  === eng) return 'long';
  return eng === 'tape' ? 'press' : 'long';
}
/** WHERE AN INSTRUMENT'S ONE TOOL LIVES. The hand for tape and grain; a palette
 *  POSITION for erase, which the hand does not hold; the act itself for the
 *  sampler. `null` when that instrument has nowhere — an eraser with no
 *  position is the live case, since the factory strip is wide · pin · unpin. */
function slotOf(instr) {
  if (instr === 'sampler') return { kind: 'act', id: 'sampler' };
  if (instr === 'erase' || instr === 'lens') {
    const i = palette.findIndex(e => engineOf(e.id) === instr);
    return i >= 0 ? { kind: 'pos', i, id: palette[i].id } : null;
  }
  const side = handSideFor(instr);
  const id = handTool(side);
  return id ? { kind: 'hand', side, id } : null;
}
/** WHAT THE OPEN TAB IS EDITING — the tool in its slot. Still called
 *  `benchShape` while the rename lands; every caller wants the same thing it
 *  always wanted, which is "the subject of the editor". */
export function benchShape() {
  const slot = slotOf(_instr);
  if (_benchable(slot?.id)) return slot.id;
  // NOWHERE TO LIVE YET. An eraser has no slot until one is on the strip, so
  // the tab would ignore the row you just clicked and snap back to the first
  // preset — the sheet showing one tool and the moon marking another. Fall back
  // to what the SHEET is on, which the click already set; it is not editor
  // state, it is the same selection the drawer reads.
  if (_optSel?.id && instrOf(_optSel.id) === _instr && _benchable(_optSel.id)) return _optSel.id;
  const first = _firstShapeOf(_instr);
  if (_benchable(first)) return first;
  return DEFAULT_ORDER.find(id => tileById(id) && isToolTile(id)) ?? null;
}
/** Put a tool INTO its instrument's slot. Returns false when there is nowhere
 *  to put it, which the caller treats as "selected for editing only". */
function _writeSlot(id) {
  const eng = engineOf(id);
  if (!isToolTile(id) || !eng) return false;
  if (eng === 'erase') {
    const i = palette.findIndex(e => engineOf(e.id) === 'erase');
    if (i < 0) return false;                       // no eraser on the strip
    if (palette[i].id === id) return true;
    const verb = verbAllowed(id, palette[i].verb) ? palette[i].verb : defaultVerb(id);
    palette[i] = { ...palette[i], id, verb };
    _savePalette();
    return true;
  }
  const side = handSideFor(eng);
  if (handTool(side) === id) return true;
  return pickHand(id, side);
}
/** WHAT THE BENCH IS SHOWING — a tool or a lens, drawn the same way. A factory
 *  lens lives in its own table with its own glyphs, so the bench asks for a
 *  subject rather than for a tile and nothing downstream has to know which. */
// (`benchSubject` and `cycleBenchVerb` went with the tile they drew and the
// right-click that cycled it, 2026-09-22. The verb a tool is placed with is its
// engine's default now — nothing places by hand — and `benchVerb` below keeps
// answering the one question left: whether A is a tap or a hold.)
/** Put a shape on the bench. It does NOT touch the hand, the palette or the
 *  spacebar — that is the whole point of the rail being an editor. The sheet
 *  follows, because the designer shows what is selected. */
export function setBench(id) {
  // EVERYTHING IN THE EDITOR IS EDITABLE, the lens included (Ek, 2026-09-22:
  // "i want everything in the tool editor to be editor mode … it's only when i
  // drop it in the palette it becomes performable").
  if (!_benchable(id)) return false;
  // THE CLICK IS THE CHANGE. This used to say, in as many words, that it does
  // NOT touch the hand, the palette or the spacebar — "that is the whole point
  // of the rail being an editor". That is the sentence being reversed: picking
  // a preset here IS how you change what is held, so there is nothing left to
  // drag and nowhere else for the choice to sit.
  _writeSlot(id);
  _optSel = { kind: _selKind(id), id };
  _propRow = id;
  // THE SHEET'S TILE OWNS THE LIVE BLOCK — the same rule `pickForSheet` states
  // and for the same reason: `renderProps` draws the LIVE controls and
  // `_pollLiveBlock` captures them back into `sheetTileId()`, so a selection
  // that did not apply would show the last shape's numbers and then write them
  // into this one. The bench skipped it from the day it existed, which is how
  // `on touch` looked cursor-wide: `wash` held `cursor` in storage the whole
  // time and the sheet was reading `pen`'s live value.
  //
  // TOOLS ONLY. The lens has no block to apply — its rows ARE the live eye.
  if (isToolTile(id)) applyTileParams(id);
  render();
  if (propsOpen()) renderProps();
  return true;
}
// (`placeBench` put the bench tile on the strip by drag. Gone 2026-09-22: the
// palette is what the factory seeds plus what the editor rewrites, and a tool
// is changed where it lives rather than carried there.)
/** The verb a tool comes into the hand with from the RAIL, by engine: a
 *  take is played whole, so it latches; paint and erase are held. */
/** The last-resort verb for a tile with no entry of its own and no engine —
 *  the same rule `VERBS_OF` now states per engine, kept as the floor under a
 *  lookup that can return null. */
export function handVerbFor(id) {
  return engineOf(id) === 'tape' ? 'toggle' : 'momentary';
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
  // (A custom LENS was mintable here until 2026-09-22 night. There is one
  //  lens, and its settings are its tab; a stored custom lens is dropped once
  //  in initTiles.)
};
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
let _engHueTable = null;
function _engineHueTable() {
  if (_engHueTable) return _engHueTable;
  const cs = getComputedStyle(document.body);
  const hue = k => cs.getPropertyValue('--eng-' + k).trim() || '#8a9090';
  _engHueTable = { tape: hue('tape'), erase: hue('erase'), granular: hue('grain'),
                   lens: hue('lens'), source: hue('source'), pins: hue('pins'), none: hue('none') };
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

/** The tile the properties sheet is about — what the engine page and the
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
  if (engineOf(t.id) === 'tape') setBrush('tape');
  else setBrush('grain');   // pen, spray, comb — all granular
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
  // The dub's ONE-SHOT (the bang verb): a press that records exactly one
  // cycle of its master and releases itself. It needs a master — a one-shot
  // with nothing pinned has no length, so it refuses where the dub already
  // refuses visibly.
  const oneShot = engineOf(id) === 'tape' && S.overdub && i >= 0 && palette[i]?.verb === 'bang';
  if (oneShot) {
    if (!S._loopPinNear?.()) { _pinFlash('pin', i); return; }
    momentary = true;
  }
  _held = { i, id, latched: false };
  // The engine last PLAYED — what AUDITION opens the drawer on (setAudition).
  { const pe = engineOf(id); if (pe === 'tape' || pe === 'granular') _lastPlayedEng = pe; }
  // A tile is a preset, and the press is what applies it — nothing did
  // between presses, because nothing was in the hand. Under a grain filter it
  // changes the hand, not the glass (#292).
  _applyHand(t);
  // THE RAIL FOLLOWS THE PLAY (Ek, 2026-09-23: "when i use a tool, and the
  // tool rail is open, it should show the tab of the tool"). Only while the
  // rail is up — a play never opens it — and only when the tab is not already
  // the tool's, because setInstrument redraws the rail.
  if (propsOpen()) { const instr = instrOf(id); if (instr && instr !== _instr) setInstrument(instr); }
  // NO VOICE IS RE-APPLIED HERE (2026-09-24). A press plays the engine's LIVE
  // block — the sliders as they stand. A preset moved them when it was taken
  // and has no further say; re-applying it here would undo every edit made
  // since, which is exactly what a preset must not do.
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
  if (oneShot && _held) {
    _held.oneShot = true;                          // slotUp lets the cycle end it
    const tk = S._overdubTake, seq = tk?.seq;
    if (tk) tk.oneShot = true;                     // the fold trims to the cycle exactly
    const cycleS = seq ? (seq.loopEnd - seq.loopStart) / Math.abs(seq.speed || 1) : 0;
    const held = _held;
    // The timer lands the release near the wrap; the fold makes it exact.
    setTimeout(() => { if (_held === held) slotEnd(i); }, Math.max(20, cycleS * 1000));
  }
}

/** The up edge from a key or the wire: ends a momentary hold, nothing to a
 *  latched one. */
function slotUp(i) {
  // A one-shot ignores the up: a bang acts on the down, and its cycle ends it.
  if (_held && _held.i === i && !_held.latched && !_held.oneShot) slotEnd(i);
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
  if (h.i === HAND_POS) {
    document.getElementById('handKey')?.classList.remove('playing');
    document.getElementById('handKeyHold')?.classList.remove('playing');
  }
  // The hand is empty again. The tool's brush character and block stay where
  // the press left them — nothing reads them until the next press, which
  // re-applies whatever it wants — but the CURSOR must stop wearing the hue,
  // because that is what says a tool is playing.
  _publishHandHue();
}

// The funnel's edge, both ways. A play whose gesture ended elsewhere — the
// trace mode changed under it, the eraser's long press
// erased all — empties the hand here rather than staying lit.
S._gestureChanged = () => {
  if (_held && !S._gestureActive?.()) _releaseHeld();
  refreshPlayingState();
};

// ── PLAYING THE HAND — the spacebar and the sphere's click ─────────────────
// Both edges, like a position's — and the release is what says which verb it was:
// not a tile's: a momentary plays from the down to the up, a toggle from one
// down to the next. `momentary` can be forced — a phone's touch has no verb
// switch to read (mobile.js). One play at a time, whichever door started it;
// the hand's own second press ends its toggle play, as a position's does.
function handDown(which = 'press', momentary = false) {
  const id = handTool(which);
  if (!id || !tileById(id)) return;
  // A second press ends a latched play — the tap's own off switch.
  if (_held) { if (_held.latched && _held.i === HAND_POS) slotEnd(HAND_POS); return; }
  _playDown(HAND_POS, id, momentary);
  // WHICH SIDE is playing, stated. The tiles lit by `latched` until each side
  // got its own verb (2026-09-22): a toggle on the long side latched, so a
  // held grain lit the TAPE tile (Ek, 2026-09-25).
  if (_held && _held.i === HAND_POS) { _held.side = _side(which); _lightHeld(); }
}
/** The up edge. With a side named, only that side's play lets go — a long
 *  key coming up must not end the press side's momentary it switched to. */
function handUp(which) {
  if (which && _held && _held.i === HAND_POS && _held.side !== _side(which)) return;
  slotUp(HAND_POS);
}

// THE RECOGNISER DECIDES, not this file (2026-09-22). `handUp` used to compare
// the release against `HAND_TAP_MS` and promote a short press to a latch — a
// second determiner, on one input, beside the one every other binding uses.
// midi.js runs the spacebar and the sphere's button through `dispatchGesture`
// now, so:
//
//   PRESS  fires on the DOWN, as a trigger. Zero latency, and it latches — the
//          play stays until the next press, which is what a tap always did.
//   LONG   fires at the long window while still down, as a hold. `_abortPress`
//          has already taken back whatever the press started — the take thrown
//          away, never armed — so the two never overlap.
//
// Which is the behaviour the hand had, minus the bespoke timer, PLUS the thing
// it could not have: the two presses can hold DIFFERENT tools.
// …AND THE SIDE'S VERB DECIDES WHAT IT DOES WITH THAT (2026-09-22). `momentary`
// is passed straight to `_playDown`; `toggle` latches, and `slotUp` already
// refuses to end a latched play, so a release needs no special case either way.
// THE TWO HANDS' KEYS, ONE RULE (Ek, 2026-09-25: "it's not consistent if how /
// if it cuts the other off"): a side's own key STOPS its own play; the OTHER
// side's key SWITCHES — the running play ends, keeping what it made, and this
// side's tool starts. Before, a press stopped whatever was latched and a long
// always switched, so Q-grain was cut off by the spacebar but tape was
// switched away from by Q.
//
// ONE HOLD ON ONE KEY is the spacebar's press and then its long. When the press
// SWITCHED away from the long side, the long that follows in the same hold
// means "off": the recogniser calls `_handPressAbort` exactly then, the take
// the press started is thrown away, and the long starts nothing.
let _pressPlay = null;     // the play this press started, for its abort
let _pressStopped = null;  // the side this press ended
let _longIsOff = false;    // set by the abort, read by the long in the same tick
S._handPress = () => {
  _pressPlay = null; _pressStopped = null;
  if (_held && _held.i === HAND_POS) {
    const side = _held.side;
    if (side !== 'long') { if (_held.latched) { slotEnd(HAND_POS); _pressStopped = 'press'; } return; }
    slotEnd(HAND_POS); _pressStopped = 'long';   // the other side: switch
    if (_held) return;                           // it would not let go
  }
  const mom = handVerb('press') === 'momentary';
  handDown('press', mom);
  // The recogniser says whether the GESTURE latched; a momentary verb overrides
  // it, because the question the verb answers is the later one.
  if (!mom && _held && _held.i === HAND_POS) { _held.latched = !!S._gestureLatched?.(); refreshPlayingState(); }
  if (_held && _held.i === HAND_POS) _pressPlay = _held;
};
/** midi.js `_abortPress` for `hand_press`: a long, ×2 or ×3 on the same key
 *  has fired this hold. What the press STARTED is thrown away; what it ended
 *  stays ended and keeps its pins — the history discard a palette press gets
 *  would have taken back a loop the press had just closed. */
S._handPressAbort = () => {
  const play = _pressPlay; _pressPlay = null;
  _longIsOff = _pressStopped === 'long'; _pressStopped = null;
  queueMicrotask(() => { _longIsOff = false; });   // only the gesture firing now may read it
  if (!play || _held !== play) return;
  S._gestureAbort?.();
  slotEnd(HAND_POS);                               // the take is gone; let go of the play
};
S._handLong = down => {
  if (!down) { handUp('long'); return; }
  if (_longIsOff) { _longIsOff = false; return; }
  if (_held && _held.i === HAND_POS) {
    // Its own latch: off. (A momentary of its own cannot be down twice.)
    if (_held.side === 'long') { if (_held.latched) slotEnd(HAND_POS); return; }
    slotEnd(HAND_POS);                             // the other side: switch
    if (_held) return;
  }
  const tog = handVerb('long') === 'toggle';
  handDown('long', !tog);
  if (tog && _held && _held.i === HAND_POS) { _held.latched = true; refreshPlayingState(); }
};
S._handUp   = handUp;
S._handVerb = handVerb;   // midi.js: the hand rows' type follows their side's verb
S._handToolOf = which => { const id = handTool(which); return id ? (tileDef(id)?.label ?? id) : null; };   // …and their label names the tool
// THE PHONE'S TOUCH (js/mobile.js): a finger on the sphere plays the hand for
// as long as it is down — no recogniser, no latch. `S._handDown` went missing
// when the spacebar moved onto the recogniser (2026-09-22) and the phone had
// been calling nothing since; phone-audit caught it at release (2026-09-23).
S._handDown = (momentary = true) => handDown('press', momentary);

// (The bench's own key — `A` playing the tab's tool through `_playDown(BENCH_POS)`,
//  in the tool's verb, an act held for as long as you held — went 2026-09-24.
//  AUDITION is the cursor's switch now and `A` is its factory key (midi.js);
//  with no live paint there is nothing a bench play did that the spacebar does not.)
// The sampler's row lives in ui-source.js and has to obey the editor's rule —
// a click BENCHES — without importing this module back.
S._setBench  = setBench;
S._benchIs   = id => benchShape() === id;

// ── Installing a lens ──────────────────────────────────────────────────────
// Writes go through the real controls (setComposerMode, toggleNearestMode,
// the scan button) so every old binding stays in sync; the tiles re-derive.

/** The lens tile tapped. A lens is a STATE (Ek, 2026-09-11): tapping it on
 *  turns it off — no lens on, the cursor reads nothing, which is the cap —
 *  and tapping it off turns reading back on. There is one lens (2026-09-22
 *  night), so there is nothing to install: this is the cap and its undo.
 *  Writes go through the real control (the scan button) so every old
 *  binding stays in sync; the tile re-derives. */
function lensTap() {
  document.getElementById('scanBtn')?.click();
  render();
}
/** A PEEK: the cap while the key is down, the eye back on release (2026-09-22).
 *
 *  This was `_lensMomentary(id, down)` — hold a NAMED lens, put the previous
 *  one back on the up edge — which a position that always shows the INSTALLED
 *  lens cannot mean any more: the named lens and the installed one are the same
 *  lens, so the hold was a no-op against itself. Momentary on the cursor is the
 *  other gesture in § F, and the useful one: drop the eye for as long as you
 *  hold it and hear the take without the cursor reading it, then let go.
 *
 *  Symmetric under the cap, like every momentary here: held from capped, it
 *  puts the eye ON while down. The up edge restores what it found, so a peek
 *  never changes where you were. */
let _lensHeld = null;   // { prevMuted } while the cursor's position is held
function _lensPeek(down) {
  if (down) {
    if (_lensHeld) return;
    _lensHeld = { prevMuted: !!S.scanMuted };
    document.getElementById('scanBtn')?.click();
    render();
  } else {
    const h = _lensHeld; if (!h) return;
    _lensHeld = null;
    if (!!S.scanMuted !== h.prevMuted) { document.getElementById('scanBtn')?.click(); render(); }
  }
}

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
  if (_pinPathPos !== null) _pinLit('pin', true, _pinPathPos);
  if (!_held) return;
  document.querySelector(`#paletteDock .tile[data-pos="${_held.i}"]`)?.classList.add('playing');
  document.querySelector(`#toolRail [data-tile="${_held.id}"]`)?.classList.add('playing');
  if (_held.i === HAND_POS) {
    // BOTH, every time: a long takes over from the press it swallowed, so the
    // tile that was lit a moment ago has to be put out. An add-only sync left
    // both hand tiles lit after every tap — seen the first time this ran.
    const long = _held.side === 'long';
    document.getElementById(long ? 'handKeyHold' : 'handKey')?.classList.add('playing');
    document.getElementById(long ? 'handKey' : 'handKeyHold')?.classList.remove('playing');
  }
  // The bench sounds through its own position, so its button lights like the
  // hand tile does — otherwise an audition runs with nothing on screen saying so.
}

/** Cheap class sync, called from the layout's 5 Hz tick; never rebuilds the
 *  row. The lens tile says whether the eye is ON — `S.scanMuted` from S, OSC
 *  or a tap, all one flag. (Selection went with the second lens.) */
export function refreshLensStates() {
  const on = !S.scanMuted;
  document.querySelectorAll('#paletteDock .tile--lens').forEach(el => {
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', String(on));
  });
}

const lensTileTitle = (label, verb) => `${label} · ${verb === 'momentary' ? 'on while its key is down' : 'fires on / off'} — off, the cursor reads nothing; its settings are the CURSOR section at the foot of the tool rail`;

// ── The hold gesture — Q W E file material into a layer ─────────────────────
// § 1c through today's engine: on granular material the layer key runs the
// cloud draw path (startSeedPlant on press, finalizeSeedPlant on release —
// tap = stationary, held = a recorded path, exactly the mockup semantics); on
// trigger material it drops a loop from the nearest stroke. The new slot is
// then tagged with the pressed layer's id, which is all "filing into a
// layer" means (#207).
//
// ── A PIN DURING A TAPE TAKE IS AN OVERDUB INSIDE THE STROKE (2026-09-25) ──
// It was the growing loop until today (the `1`+`Q` looper-pedal gesture of
// BRUSH-MODEL § 3c v3b, js/live-loop.js): the take-so-far looped in a worklet
// of its own, with no track and no pin until the stroke ended, and a second
// press fell through to the ordinary pin and pinned the half-recorded take —
// one phrase, several copies of it, the first not undoable. Now the press CUTS
// the take (events.js pinSplitTake): the part before is the main loop, the rest
// an overdub on it, and each further press starts the next layer. Ek: "it
// should essentially be the same thing [as overdub], a shortcut".

async function pinDown() {
  const UP = await import('./ui-presets.js');

  // Recording a tape take right now: the pin cuts it into a loop and a layer.
  if (S.isPainting && S._recordingTrigger) {
    if (S._pinSplitTake?.()) S._pinsDirty = true;
    return;
  }

  // ONE PRESS TAKES THE MOMENT, ALL OF IT (Ek, 2026-09-14): "the point of the
  // pin is to take that moment, whatever it is and have it continue off
  // cursor". Lines and grains are two INDEPENDENT halves of what the cursor is
  // doing — the scheduler skips trig material, so the two never read the same
  // marks — and the press used to pick one of them by whichever mark happened
  // to be closer, with a coarse 1.5×-radius type test in front of a strict
  // drop that between them left a dead band doing nothing at all. Both halves
  // now go: every line the cursor is on becomes a loop (dropSeqFromCursor),
  // and if the cursor is granulating as well, the grains become a cloud.
  S._pinPressTag = ++_pinPress;
  const loops = UP.dropSeqFromCursor();
  if (loops.length) S._pinsDirty = true;
  // A WALKER is the third thing the cursor can be doing (2026-09-18): under
  // `mode: stroke` it is what reads, so the press takes it exactly as it takes
  // a line — the walker freezes into the moving cloud it already is, same path,
  // same phase. It keeps walking; the pin is what makes it survive the lift.
  const walked = UP.pinWalkers();
  if (walked.length) { UP.clearWalkersNow(); S._pinsDirty = true; }
  // Nothing in reach is NOT a no-op either: the press still pins a cloud at the
  // cursor — a GHOST PIN (Ek, 2026-08-28). Pin the place first, paint scratch
  // into it later, and it keeps sounding: a cloud stores a place and re-reads
  // S.particles every tick. Ghosts are cloud-only by nature — a cloud is a
  // place that reads, a loop is a recording that plays, and with no stroke
  // there is nothing to record.
  if (_cursorGranulating() || !loops.length) {
    UP.startSeedPlant();
    S._pinPlantPending = true;
  } else {
    _sealPinPress();
  }
}

/** Is the cursor MAKING GRAINS right now? The scheduler publishes the pool it
 *  hands the worklet on every tick (`S._cursorPool`), already minus whatever a
 *  pinned cloud claims, so this asks the engine rather than re-deriving a
 *  radius search that could disagree with it. The lens decides whether any of
 *  it is heard; a stale timestamp means the scheduler is not running, which is
 *  also not granulating. */
function _cursorGranulating() {
  if (S.scanMuted || S.lensReads === 'tape') return false;
  const pool = S._cursorPool;
  if (!(pool?.length)) return false;
  if (performance.now() - (S._cursorPoolAt || 0) >= 250) return false;
  // GRAIN MATERIAL, not a take that `dwell: grain` opened (Ek, 2026-09-23: "it
  // seems to do both a grain pin and a tape loop pin. i think it should only
  // drop the pin for the loop"). An opened take's marks are in the pool — the
  // cursor is granulating them — but they are TAPE, and the loop the same press
  // makes is their pin. Only a mark that is grain material asks for a cloud.
  for (let i = 0; i < pool.length; i++) if (!pool[i].trig) return true;
  return false;
}

// The press this pin belongs to. Its two halves land on different edges — the
// loops on the down so the button recogniser's swallow can still take the press
// back while it is held, the cloud on the release because a held pin draws a
// moving cloud — and this folds them into one undo (history.js mergeTagged).
let _pinPress = 0;
function _sealPinPress() {
  const tag = S._pinPressTag;
  S._pinPressTag = null;
  if (tag != null) HIST.mergeTagged(tag);
}

async function pinUp() {
  if (!S._pinPlantPending) { _sealPinPress(); return; }
  S._pinPlantPending = false;
  const UP = await import('./ui-presets.js');
  UP.finalizeSeedPlant();
  _sealPinPress();
  S._pinsDirty = true;
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
// the seal: stopLiveRecording must finalize the buffer
// createSeqFromStroke reads. The armed trigger is not a doubling bug — the
// stroke stays scratch (touch it and it fires), the loop sounds on its own;
// the same rule as the pin hold.
// `loop` is the overdub brush SEEDING (Ek, 2026-09-06): with nothing pinned
// its first take is the main loop — this hook pins it, whatever the tile's
// own `on end` says — and the next press overdubs onto it.
// …AND EVERY PINNED CLOUD IS A ZONE (Ek, 2026-09-25): a frozen cursor that
// pins whatever line touches it (ui-presets.js pinStrokeInZones). On the same
// beat, after tape's own autopin, so a stroke both pin makes the zone's a
// second playhead at the touch point — what a cursor standing there would do.
S._onTriggerStrokeArmed = (strokeId, { loop = false, trigs = [] } = {}) => {
  const auto = S.triggerParams.loopOnEnd || loop;    // the contract, not the tile id (#244)
  const zoned = S.commitSlots.some(c => c && c.type === 'cloud');
  if (!auto && !zoned) return;
  setTimeout(async () => {
    try {
      const UP = await import('./ui-presets.js');
      if (!auto) { UP.pinStrokeInZones(trigs); return; }
      // The loop starting IS the playback you hear on release — the trigger
      // audition doubling it for one pass reads as a glitch, so it goes.
      const TR = await import('./trigger.js');
      const audT = S.triggers?.find(x => x.strokeId === strokeId);
      if (audT?.playing) TR.stopTriggerAudio(audT, 'immediate', 0.02);
      const before = S.commitSlots.slice();
      UP.createSeqFromStroke(strokeId);
      // Stamp the BAKED half (#240) onto the new slot: the looper commits
      // the tile's dials as they stood when the stroke was drawn. Direction
      // is stamped by createSeqFromStroke from the trigger's own `reverse`.
      for (let i = 0; i < S.commitSlots.length; i++) {
        const slot = S.commitSlots[i];
        if (slot && slot !== before[i]) {
          slot.speed  = S.triggerParams.speed ?? slot.speed;
          slot.grainParams.volume = S.triggerParams.volume ?? slot.grainParams.volume;
          slot.passes = S.triggerParams.passes | 0;
          slot.pitch  = S.triggerParams.pitch ?? slot.pitch ?? 0;
          // A pin's cut (events.js pinSplitTake): the take still recording is
          // this loop's overdub from here.
          if (loop) UP.bindPendingOverdub(strokeId, slot);
          break;
        }
      }
      UP.pinStrokeInZones(trigs);
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
  // THE SPACEBAR IS NOT READ HERE ANY MORE (2026-09-22). It is a RESERVED
  // BINDING on `key:Space` — `hand_press` and `hand_long` — so events.js sees a
  // bound source and hands both edges to midi.js's recogniser, the same one
  // every other key goes through. This file gets `S._handPress` / `S._handLong`
  // back out of it. The bespoke down/up pair that lived here was the app's only
  // second determiner.
  // (`A` was swallowed here as the bench's audition play, 2026-09-21 to
  //  09-24. It is AUDITION's factory key now — a binding like any other,
  //  seeded in midi.js — and the bench play is gone with auditioned paint.)
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
  // (it used to follow the strip being rearranged; the strip is fixed now).
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
// ONE SPACEBAR. A second, LONGER bar drew the held press for a day (2026-09-21)
// and came back out: the sticker already has a vocabulary for how an input is
// pressed — SOURCE then GESTURE, a bare source meaning a plain press — and a
// glyph that encodes the gesture in its own width is a second vocabulary for
// the same fact (Ek, 2026-09-22: "whatever convention we used should be the
// same for space bar"). The bar after it is `_gestureHTML('long')`, the same
// mark a learned long press wears anywhere else.
// THE KEY, NOT THE CHARACTER (Ek, 2026-09-22: "can spacebar be a spacebar
// glyph and click be a cursor glyph?"). It was `␣`, the open box — the correct
// SPACE CHARACTER, and at 15×6 with a 1.1px stroke it read as a bracket rather
// than as a key. The spacebar is the widest KEY on the keyboard, so the cap is
// what says it: a wide rounded rectangle, 2:1, which no letter key could be.
const SPACE_MARK = '<svg class="leg-space" viewBox="0 0 24 12" width="16" height="8" fill="none" aria-label="spacebar">' +
  '<rect x="1.2" y="1.2" width="21.6" height="9.6" rx="2.6" stroke="currentColor" stroke-width="1.9"/></svg>';
// THE POINTER, for the sphere's left button. It was the WORD `click`, four
// characters against a 15px mark beside it, which is the one place on the strip
// where a source was spelled instead of drawn — every other one is a glyph or a
// number. Filled rather than stroked: a stroked pointer at 10px closes up.
const CLICK_MARK = '<svg class="leg-click" viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-label="left click">' +
  '<path d="M6 3.2 L6 18.4 L10.1 14.6 L12.8 20.6 L15.4 19.4 L12.7 13.6 L18 13.2 Z"/></svg>';
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
 *  bottom-left, the same disc as the flags; none when unbound. It is the
 *  keys page's learn cell brought to the tile: click to relearn, right-click
 *  to clear, and while learning it says `…`. `key` and `midi` stay complete
 *  whatever is drawn — they are the fact, for the tooltips. */
/** THE HAND'S STICKER — ONE PILL, NOT TWO (Ek, 2026-09-22: "make spacebar and
 *  click one pill flag not two"). The hand drew two `<kbd>`s, a spacebar and a
 *  `click`, as if it held two bindings. It holds ONE — and the click is not the
 *  hand's at all: it is the SPACEBAR's twin ("click is not always on the hand,
 *  it follows what the spacebar does"), derived in midi.js from whatever
 *  `key:Space` is bound to. So the pill draws the hand's key, and `click` beside
 *  it ONLY while that key is the spacebar. Bind the hand to F and the click
 *  leaves the pill, because it stayed with the spacebar.
 *
 *  A learn cell like every other sticker (PALETTE-GUI § O): click relearns,
 *  right-click clears, a dash when unbound — and the hand is reachable by
 *  ACTION id rather than by position, because the two hand tiles are not
 *  positions (§ A). */
function handLegend(actionId) {
  const kind = legendKind();
  const binds = (S._bindingsOf?.(actionId) ?? []).filter(b => b.kind === kind);
  const learning = S._paletteLearning?.() ?? null;
  const lrn = !!learning && learning.id === actionId && learning.kind === kind;
  const none = !lrn && !binds.length;
  // ONE BINDING, TWO WAYS IN, ONE GESTURE. The sources are drawn together and
  // the gesture ONCE after them — `▭ ➤ —` rather than `▭ — ➤ —`. The sticker's
  // convention is SOURCE then GESTURE, and it repeats the gesture per source
  // everywhere else because there the sources are independent bindings. Here
  // they are not: the click IS the spacebar, so it can only ever be held the
  // same way, and saying it twice reads as four marks in a pill that exists to
  // say one thing.
  const sp = binds.find(b => b.space);
  const marks = binds.map(b => `<span class="leg leg--${b.kind}">${_shortLabel(b)}</span>`).join('');
  const twin = sp ? `<span class="leg leg--key">${CLICK_MARK}</span>` : '';
  const gest = binds.length ? _gestureHTML(binds[0].g) : '';
  const what = binds.map(b => b.label + (b.g && b.g !== 'press' ? ' ' + (S._gestureLabel?.(b.g) ?? b.g) : '')).join(', ');
  const tip = lrn ? `press the ${_KIND_WORD[kind]} to bind the hand — press, hold, ×2 … · Esc or click again cancels`
            : none ? `no ${_KIND_WORD[kind]} on this hand — click to learn one · the sphere's click follows the SPACEBAR, so it plays whatever holds it`
            : `${what}${sp ? ', and the sphere\'s click with it' : ' — the sphere\'s click stays with the spacebar'} — click to relearn · right-click to clear`;
  const inner = lrn ? '…' : none ? '<span class="leg-none">–</span>' : marks + twin + gest;
  return `<span class="tile-binds"><kbd class="tile-bind tile-bind--${kind}${lrn ? ' learning' : ''}${none ? ' tile-bind--none' : ''}"` +
    ` data-learn-kind="${kind}" data-learn-action="${actionId}" title="${esc(tip)}">${inner}</kbd></span>`;
}
/** THE ROW'S STICKER (Ek, 2026-09-25: "any gui that has a key binding shortcut
 *  by factory default should also have the same glyph design on the palette
 *  tile, and it should also be learnable — press that flag/pill"). The hand's
 *  pill (`handLegend`) for any action, on a rail row or a chrome button, filled
 *  in by `_fillRowBinds`: the legend kind's binding; for keys with nothing
 *  learned, the FACTORY key an action still reads by hand (⌥, Backspace×3); a
 *  dash when there is neither; `…` while learning. Click relearns, right-click
 *  clears — the palette's own cell. */
function rowBindHTML(actionId) {
  const kind = legendKind();
  const binds = (S._bindingsOf?.(actionId) ?? []).filter(b => b.kind === kind);
  const learning = S._paletteLearning?.() ?? null;
  const lrn = !!learning && learning.id === actionId && learning.kind === kind;
  const a = S._actions?.find(x => x.id === actionId);
  const label = a?.label?.replace(/\s*\(.*\)\s*$/, '') ?? actionId;
  const factory = kind === 'key' && !binds.length && a?.key && a.key !== '—' && _HAND_KEYED.has(actionId)
    ? a.key.replace(/^Backspace/, '⌫') : null;
  const none = !lrn && !binds.length && !factory;
  const what = factory ?? binds.map(b => b.label + (b.g && b.g !== 'press' ? ' ' + (S._gestureLabel?.(b.g) ?? b.g) : '')).join(', ');
  const tip = lrn ? `press the ${_KIND_WORD[kind]} for ${label} — press, hold, ×2 … · Esc or click again cancels`
            : none ? `no ${_KIND_WORD[kind]} on ${label} — click to learn one`
            : `${label}: ${what} — click to ${factory ? 'learn another' : 'relearn'}${factory ? '' : ' · right-click to clear'}`;
  const inner = lrn ? '…' : none ? '<span class="leg-none">–</span>'
    : factory ? `<span class="leg leg--key">${esc(factory)}</span>`
    : binds.map(b => `<span class="leg leg--${b.kind}">${_shortLabel(b)}${_gestureHTML(b.g)}</span>`).join('');
  return `<kbd class="tile-bind tile-bind--${kind}${lrn ? ' learning' : ''}${none ? ' tile-bind--none' : ''}"` +
    ` data-learn-kind="${kind}" data-learn-action="${actionId}" data-row-learn="${esc(label)}" title="${esc(tip)}">${inner}</kbd>`;
}
// The actions whose factory key is read BY HAND in events.js rather than seeded
// as a binding, so the sticker shows it until a learn adds one.
const _HAND_KEYED = new Set(['cursor_lock', 'erase_all']);
/** Fill every `[data-binds="id,id"]` slot on screen with its stickers — rail
 *  rows drawn by render(), the pinned rail's rows and the chrome's buttons. */
function _fillRowBinds() {
  const kind = legendKind();
  const learning = S._paletteLearning?.() ?? null;
  // `a|b`: the first alternative bound in this legend's kind (or being
  // learned), else the last — a specific binding shown over a shared one.
  const pick = tok => {
    if (!tok.includes('|')) return tok;
    const alts = tok.split('|');
    return alts.find(id => (learning && learning.id === id && learning.kind === kind) ||
      (S._bindingsOf?.(id) ?? []).some(b => b.kind === kind)) ?? alts[alts.length - 1];
  };
  document.querySelectorAll('[data-binds]').forEach(el => {
    const html = el.dataset.binds.split(',').map(t => rowBindHTML(pick(t))).join('');
    if (el.innerHTML !== html) el.innerHTML = html;
  });
}
S._fillRowBinds = _fillRowBinds;
/** Put a sticker slot after a row's label (the first `</span>`). */
const _withBinds = (html, ids) => html ? html.replace('</span>', `</span><span class="row-binds" data-binds="${ids}"></span>`) : html;
// Which tab rows answer to a factory key, by pid.
const _PID_BINDS = { mode: 'snap', radius: 'radius_dec,radius_inc' };
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
  // THE POINTER FOLLOWS THE SPACEBAR ONTO A POSITION TOO (Ek, 2026-09-22: "when
  // i keybind a smaller palette tile with spacebar, i should also see the cursor
  // glyph"). The click is the spacebar's twin wherever the spacebar goes — bind
  // it to position 4 and the sphere's left button fires position 4 — so the
  // sticker has to say both, or the strip is lying about what plays it. Same
  // reading as the hand's pill: cap, pointer, then the gesture once.
  const inner = lrn ? '…' : none ? '<span class="leg-none">–</span>' : shown.map(b => `<span class="leg leg--${b.kind}">${_shortLabel(b)}${b.space ? CLICK_MARK : ''}${_gestureHTML(b.g)}` +
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
  // (The bench's `A` release lived here until 2026-09-24; nothing is read on
  //  key-up now — every learned key's edges go through the recogniser.)
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
//   tool     — (the dub: one     plays while down          plays until pressed again
//              cycle, the one-shot)
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
let _pinPathPos = null;     // palette index drawing a pin path (toggle or momentary), or null
// THE MIX MUTE'S STATE IS DERIVED, never stored (2026-09-15). It was a local
// `_muteHeld` "mirrored from pins.js", and a mirror is a second truth: mute from
// the rail and the palette tile's own flag still said off, so the next press on
// the tile muted again instead of letting go. CLAUDE.md's rule for pins is that
// audibility is derived and nothing stores on/off — this is that rule, applied
// to the toggle above them. `allMuted()` is the one answer, and it is correct
// now that it counts only the groups holding pins.
const muteOn = () => !!S._pinsAllMuted?.();
/** THE SAMPLER'S STATE IS DERIVED, like the mute above it: `S.sourceKind` is
 *  the one truth and the tile reads it, so the tile agrees however it was
 *  changed — the panel row, an OSC address, a pad. */
const samplerOn = () => S.sourceKind === 'sampler';
/** One door for every press of it: the palette's two verbs and the bench's A.
 *  `want` false is the LIVE input, which is what "off" means here. */
function _samplerSet(want, pos) {
  if (want === samplerOn()) return;
  S._samplerSelectSource?.(want ? 'sampler' : 'live');
  // selectSource refuses mid-stroke, so read the state back rather than
  // lighting what we asked for.
  _pinLit('sampler', samplerOn(), pos);
}
S._paletteFire = (i, down = true) => {
  const e = palAt(i); if (!e) return;
  const { id, verb } = e;
  const k = paletteKind(id); if (!k) return;
  // A fire moves nothing: the drawer follows the HAND (pickHand), and a
  // quick-access key must not pull it off the tool you are working on
  // (2026-09-12; it followed the last tile fired for a day).

  if (k === 'lens') {
    // The position is the CURSOR. Toggle caps and uncaps; momentary is a PEEK
    // — the cap while the key is down, the eye back on release.
    // (It switched the rail to the lens TAB for a day; the cursor is the
    // rail's own lower section since 2026-09-23, always shown — nothing to open.)
    if (verb === 'momentary') _lensPeek(down);
    else if (down) lensTap();
    return;
  }
  if (k === 'act') {
    if (id === 'unpinall') { if (down) { _pinFlash('unpinall'); document.getElementById('commitClearBtn')?.click(); } return; }
    // MIX. Bangs, both — and routed by NAME rather than by "everything that is
    // not pin", which is what the line below used to be and would have sent
    // them to unpin the moment they existed.
    // MUTE is the one act tile with a sustained state, so it LIGHTS rather than
    // flashes — the same rule the pin's momentary and toggle follow.
    if (id === 'mute') {
      const want = verb === 'momentary' ? down : !muteOn();
      if (verb === 'momentary' ? down === muteOn() : !down) return;
      S._pinsSetAllMuted?.(want); _pinLit('mute', muteOn(), i);
      return;
    }
    // THE SAMPLER, in the mute's shape: a momentary holds the file under the
    // brush for as long as you hold, a toggle leaves it there.
    if (id === 'sampler') {
      if (verb === 'momentary') _samplerSet(down, i);
      else if (down) _samplerSet(!samplerOn(), i);
      return;
    }
    if (id !== 'pin') { if (down) { _pinFlash('unpin'); unpinSelected(); } return; }
    // Pin in three verbs (Ek, 2026-09-11): a BANG pins where you stand; a
    // MOMENTARY draws a path from the down to the up; a TOGGLE opens the path
    // on one press and seals it on the next. One flag says whether a path is
    // open, whichever way it was opened.
    if (verb === 'bang') { if (down) { _pinFlash('pin', i); S._pinTap(); } return; }
    if (verb === 'momentary') {
      if (down === (_pinPathPos !== null)) return;
      _pinPathPos = down ? i : null; _pinLit('pin', down, i); S._pinHold(down);
      return;
    }
    // A toggle holds the path open between two presses, so it is lit for that
    // whole time too — the flag is the same one either verb opens.
    if (down) {
      const open = _pinPathPos === null;
      _pinPathPos = open ? i : null; _pinLit('pin', open, i); S._pinHold(open);
    }
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
  if (!k) return { pos: n, name: 'empty', verb: '', glyph: null, hue: null, label: 'empty', enabled: false, hidden: false, why: `nothing is at position ${n}` };
  const { id, verb } = e;
  const name = k === 'tool' ? tileDef(id).label : k === 'lens' ? 'cursor' : ACT_TILES[id].label;
  const glyph = k === 'tool' ? G[tileDef(id).g] : k === 'lens' ? LENS_G : G[ACT_TILES[id].g];
  const hue = k === 'act' ? null : (_engineHueTable()[engineOf(id)] ?? null);
  const w = verbWord(id, verb) ?? '';
  // A verb that repeats the name says nothing twice: `unpin · unpin` is `unpin`.
  return { pos: n, name, verb: w, glyph, hue, label: w && w !== name ? `${name} · ${w}` : name, enabled: true, hidden: false, why: '' };
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
  if (!e) return `nothing is at position ${n}`;
  const w = verbWord(e.id, e.verb) ?? e.verb;
  // Named: the strip is fixed, so position n IS one tile — `whatever sits
  // there` described the drag-and-drop palette (tooltip review, 2026-09-25).
  const k = paletteKind(e.id);
  const name = k === 'tool' ? tileDef(e.id).label : k === 'lens' ? 'cursor' : ACT_TILES[e.id]?.label ?? e.id;
  return e.verb === 'momentary'
    ? `${name} — ${w}: 1 starts it, 0 stops it (the palette's tile ${n})`
    : `${name} — ${w}, a bang (the palette's tile ${n})`;
};

// ("Tool keys fire" and the Main button's toggle/momentary switch were two
// settings here until 2026-09-09; their keys are retired — storage-registry.js.)

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
// ── The tile's two corner STICKERS ──────────────────────────────────────────
// ── THE TILE'S FLAGS ───────────────────────────────────────────────────────
// Top-right, one corner, read-only: autopin and overdub, the two answers to
// "what happens when you let go". Both are MODE's, per instrument, so a tile
// REPORTS them and never sets them.
//
// The top-left is empty. It held the wet drop, a per-grain-tile switch, until
// the concept was sunset (Ek, 2026-09-22) — liveness is decided by how paint was
// MADE now, not by a tool's setting, so there is nothing for a tool to declare.
function tileStickers(id) {
  const eng = engineOf(id);
  // THE CURSOR TILE WEARS THE HEADPHONES while audition is on (Ek, 2026-09-24:
  // "the flag on the palette bar for the cursor tile … consistent with the
  // cursor design for audition"). It is the eye's flag alone — audition is how
  // the cursor reads — and it is a mark, not a switch: the switch is the row
  // in the CURSOR section. White, as the eye is.
  if (eng === 'lens') {
    return S.auditionMode
      ? `<span class="tile-marks"><span class="tile-flags"><span class="tile-aud" data-word="audition" title="audition is on — the cursor` +
        ` plays what it reads through the live tape and grain sheets; nothing is rewritten · the switch is in the CURSOR section">` +
        `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${G.audition}</svg></span></span></span>`
      : '';
  }
  // The wet drop is gone with the toggle (Ek, 2026-09-22: "let's sunset the term
  // wet and the concept"). Whether paint can still move is decided by HOW it was
  // made — auditioned, or played — so a tool has nothing to declare about it,
  // and the top-LEFT corner is empty now.
  // THE PIN IS BACK, AND IT IS A MARK (Ek, 2026-09-22: "if there's autopin on,
  // it should show the pin flag like we always had"). It is not the switch it
  // used to be — MODE owns autopin now, per instrument — so it reads that and
  // cannot be clicked. It is on the tile because that is where you look while
  // you are about to play: the mode says WHAT happens, the tile says it is
  // going to happen to THIS.
  const pin = autoPinOn(eng)
    ? `<span class="tile-pin" data-word="autopin" title="autopin is on for ${GRP_LABEL_G[eng] ?? eng} — this stroke pins itself` +
      ` when you let go · the switch is MODE, in the tool editor">` +
      `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${G.pin}</svg></span>`
    : '';
  // OVERDUB, the same way (Ek, 2026-09-22). Tape's alone, because only a take
  // has a master to join — and it wears the O (G.overdub), in the tape hue like the pin (2026-09-25).
  const dub = eng === 'tape' && overdubOn()
    ? `<span class="tile-dub" data-word="overdub" title="overdub is on — this take joins the nearest pinned loop, at the phase` +
      ` you played it · the switch is MODE, in the tool editor">` +
      `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${G.overdub}</svg></span>`
    : '';
  if (!pin && !dub) return '';
  // BOTH FLAGS SHARE THE TOP-RIGHT, in a row: they are two answers to the same
  // question — what happens when you let go — so they belong together rather
  // than fighting for one corner. The top-left corner is empty.
  const flags = pin || dub ? `<span class="tile-flags">${dub}${pin}</span>` : '';
  return `<span class="tile-marks">${flags}</span>`;
}

// ── THE BENCH, at the top of the editor ────────────────────────────────────
// What you are building, drawn as the TILE it will become — same glyph, same
// hue, same outline as the verb it will wear — so building and placing are one
// picture. Under it the only two things you can do to it: put it on the
// palette, or hold A and listen.
// (`renderBench` drew the bench tile; gone 2026-09-22 with the bench.)

// TWO HAND TILES: the same tool, played two ways, each drawing its own spacebar.
// The left one is the TAP — press and let go and it keeps playing, press again
// and it stops, so it wears the plain bar and the toggle outline. The right one
// is the HOLD — it plays while the bar is down — so it wears the long bar and
// the momentary outline. Neither is a mode you set: they are both live at once,
// and which one you get is which way you pressed.
/** THE HAND TILE'S INSIDES, built once and used by both the strip's hand and the
 *  bench — they are the same object, and the last round's whole lesson was that
 *  two builders for one object drift a property at a time.
 *
 *  It says BOTH names (Ek, 2026-09-22: "the tile should say the shape and the
 *  voice in text"): the shape on top, because it is the tool's identity and the
 *  glyph only hints at it, and the voice under it in the engine's hue, because
 *  it is the half with no other channel. A tool with no voice shows one line —
 *  an empty second line would be a promise of something that is not there. */
/** The inside of a hand-sized tile, for a SUBJECT — `{ id, label, glyph }` —
 *  rather than for a tile, because a factory lens is not in `TILE_DEFS` and
 *  has its own glyph table. Same markup either way, which is the point. */
function handTileInner(t, vname) {
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${t.glyph}</svg>` +
    `<span class="tile-nm">` +
      `<span class="tile-nm-shape">${esc(t.label)}</span>` +
      (vname ? `<span class="tile-nm-voice">${esc(vname)}</span>` : '') +
    `</span>` +
    tileStickers(t.id);
}

function handTileHTML(ENGINE_HUE) {
  const held = !!(_held && _held.i === HAND_POS);
  // EACH TILE DRAWS ITS OWN TOOL (2026-09-22). They were one tool drawn twice,
  // which is why a drop on either filled both.
  const one = (which, verb, id, lit) => {
    const t = tileById(handTool(which));
    if (!t) return '';
    const c = ENGINE_HUE[engineOf(t.id)] ?? ENGINE_HUE.none;
    // THE SIDE'S OWN VOICE, not the engine's current one (2026-09-22). This
    // read `currentVoice(engine)`, so the name written on the hand tile — and
    // in its tooltip — followed whatever was picked in the tool creator. That
    // is the half of the bug you could SEE: the tile at the head of the strip
    // renaming itself while you built something else. The play path had the
    // same fault underneath (see `inHand`); both read the frozen pair now.
    // THE TILE SAYS WHAT THE SOUND IS CALLED (Ek, 2026-09-24: "the tile needs
    // to properly reflect the preset or no preset"): the preset's name while
    // the live block IS that preset, and `wash*` once a slider has moved off
    // it (2026-09-25 — `custom` threw away the one thing worth knowing, that
    // it is still mostly wash). `_handVoiceWord` answers, and
    // `_refreshVoiceMarks` rewrites the line after every capture.
    const vid = handVoice(which);
    const vname = _handVoiceWord(vid);
    // The same first clause as a quick-access tile's, in the same order, so the
    // two read as one sentence about one kind of thing.
    // The GESTURE that reaches this side is fixed — a press, or a hold past the
    // long window — and the VERB is what the side then does with it, which is
    // why both are said. They used to be the same sentence because the side's
    // verb could not be anything else.
    const reach = which === 'press'
      ? 'PRESS the spacebar (or click the sphere)'
      : 'HOLD the spacebar (or hold on the sphere) past the long window';
    const does = verb === 'toggle' ? 'and it keeps playing; the same again stops it'
                                   : 'and it plays while you hold';
    // (It said the engine a second time — `tape · verbatim · tape` — and sent
    //  you to pick a SHAPE in the tool editor; one tool per instrument since
    //  2026-09-22, so neither was true. Tooltip review, 2026-09-25.)
    const title = `${t.label}${vname ? ' · ' + vname : ''} — ` +
      `${reach} ${does}` +
      (which === 'long' ? ' — it takes back whatever the press had started' : '') +
      ` · right-click for the other verb · click to open its tab`;
    return `<button type="button" class="tile tile--hand${lit ? ' playing' : ''}" id="${id}"` +
      ` style="--c:${c};--eng:${c};--pal-r:${VERB_RADIUS[verb]}" data-hand="${t.id}" data-verb="${verb}" data-which="${which}" data-eng="${engineOf(t.id) ?? ''}"` +
      ` title="${esc(title)}">` +
      handTileInner({ id: t.id, label: t.label, glyph: G[t.g] }, vname) +
      handLegend(which === 'press' ? 'hand_press' : 'hand_long') + `</button>`;
  };
  // ONE PILL PER HAND, drawn by `handLegend` from the hand's own binding — the
  // sticker convention, SOURCE then GESTURE, the same one every learned binding
  // on the strip reads (Ek, 2026-09-22: "if it's just the letter/icon it's
  // press, then you have the word hold after"). The marks are no longer passed
  // in: the binding is the truth and the tile reads it, so a rebind shows.
  return one('press', handVerb('press'), 'handKey',     held && _held.side !== 'long') +
         one('long',  handVerb('long'),  'handKeyHold', held && _held.side === 'long');
}

// ── Render ──────────────────────────────────────────────────────────────────

// A NUMBER BEING DRAGGED IS NOT REDRAWN UNDER THE HAND (2026-09-25, Ek: "the
// k param … when i click to drag it (from all) it just highlights the text
// instead of going up or down"). The first step off `all` changes which lens
// rows are ash, `_syncLensTab` redraws the rail, and the input the pointer had
// captured was replaced mid-drag — the rest of the drag landed on the new
// one's text as a selection. radius did the same once per tool, on its first
// capture. A render asked for during a scrub waits for the release.
let _scrubbing = false, _renderAfterScrub = false;
function _scrubStart() { _scrubbing = true; }
function _scrubEnd() {
  _scrubbing = false;
  if (_renderAfterScrub) { _renderAfterScrub = false; render(); }
}

export function render() {
  if (_scrubbing) { _renderAfterScrub = true; return; }
  // A stored `sampler` tab, or the switch just turned off: back to tape.
  if (_instr === 'sampler' && !S.samplerEnabled) { _instr = 'tape'; try { localStorage.setItem(LS_INSTR, _instr); } catch (_) {} }
  // The hue table is resolved from CSS here, so the published hand hue is
  // refreshed with it — a dark-mode flip changes both.
  _publishHandHue();
  const bar = document.getElementById('tileBar');
  if (!bar) return;
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
  // drawer opener should always be visible") — it
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
  // The tile's FLAGS are `tileStickers`,
  // module scope, shared with the hand tile. On the RAIL each is a button on
  // the row: the pin here, the drop just below.
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
  const grpLabel = (label, engine, hue, half = 'shape') =>
    `<span class="tbx-lbl" style="--eng:${hue}">${label}` +
    `<span class="tbx-add" data-${half === 'voice' ? 'addvoice' : 'add'}="${engine}" role="button" tabindex="-1"` +
    ` title="new ${label} — starts from what is on the sliders now">` +
    // A DRAWN plus, not the character (Ek, 2026-09-16: "the plus sign … is
    // not vertically aligned, it looks a bit lower than the title"). The
    // glyph sat on a 14px font's baseline inside a 24px box, and a baseline
    // is (ascent − descent)/2 below the box's centre — one pixel lower than
    // the 11px title's caps beside it, measured. An SVG is centred by the
    // box, not by a baseline: 12px, so its ink is the title's 7px cap height.
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">` +
    `<path d="M12 5v14M5 12h14"/></svg></span></span>`;
  // ONE ZONE (2026-09-22). `tileHTML` took a `zone` — `palette` or `box` — and
  // the `box` half drew the rail's tool row. It has one caller and it passes
  // `palette`, so the parameter was a choice with one answer; the strip is a
  // fixed toolbar and the rail lists no tools, so it stays that way.
  const tileHTML = (id, { html = '', verb = null, pos = '', voice = null }) => {
    const t = tileDef(id); if (!t) return '';
    const eng = engineOf(id);
    const c = ENGINE_HUE[eng] ?? ENGINE_HUE.none;
    // `off-factory` marks a tool whose params have been moved this session.
    const dirty = isOffFactory(id) ? ' off-factory' : '';
    const hand = id === handTool('press') ? ' \u00b7 the spacebar\u2019s press plays it too'
      : id === handTool('long') ? ' \u00b7 the spacebar held plays it too' : '';
    const what = INSTRUMENTS.find(x => x.id === eng)?.tip;
    // THE QUICK-ACCESS TILE KEEPS ITS DESIGN — a glyph and nothing else (Ek,
    // 2026-09-22) — so the TOOLTIP is where its pair is written down. A position
    // says the voice it was PLACED with, which is the one it plays.
    const vname = voice ? voiceName(voice) : null;
    // No `drag to move it, drag off the palette to remove it` any more: the
    // strip is fixed, and the two things still yours are named instead.
    // (It said the engine twice — `erase · erase` — and offered `click to take
    //  it in hand` and a drawer door, both gone: the click opens its tab.)
    const title = `${t.label}${vname ? ' \u00b7 ' + vname : ''}${what ? ' — ' + what.split(' — ')[0] : ''}` +
      ` \u00b7 ${verbWord(id, verb) ?? verb} from its key${hand} \u00b7 right-click for the other verb \u00b7 click to open its tab` +
      `${t.ghost ? ' \u00b7 not built yet' : ''}`;
    const body = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${G[t.g]}</svg>` +
      `<span class="tile-nm">${t.label}</span>`;
    // No idle mark on a palette tile: the box said ARMED and there is no armed
    // tool (2026-09-11). A tile is lit only while it plays, and its SHAPE is
    // its verb (§ 3).
    return `<button type="button" class="tile` +
      `${t.ghost ? ' ghost' : ''}${dirty}" style="--c:${c};--eng:${c};${SHAPE(verb)}"` +
      ` data-tile="${id}" data-pal="${id}"${pos} title="${title}">` +
      body + tileStickers(id) + html + `</button>`;
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
    if (k === 'tool') return tileHTML(id, { html: paletteLegend(n).html, verb, pos, voice: e.voice });
    // A LENS POSITION IS THE CURSOR: § F says what a lens tile is — THE LENS
    // IS A STATE, THE CAP IS NO LENS ON — so the tile is lit while the eye
    // reads and its press is the cap. One lens (2026-09-22 night), so the
    // glyph and the name are fixed; only `on` moves.
    if (k === 'lens') {
      const c = ENGINE_HUE.lens, on = !S.scanMuted;
      return `<button type="button" class="tile tile--lens${on ? ' on' : ''}" style="--c:${c};--eng:${c};${SHAPE(verb)}"` +
        ` data-lens="${id}" data-pal="${id}"${pos} aria-pressed="${on}" title="${lensTileTitle('cursor', verb)}">` +
        // THE EYE OFF IS THE EYE STRUCK THROUGH (Ek, 2026-09-24: the lit /
        // unlit tile "is not obvious enough"): the unpin glyph's own slash,
        // always in the markup and shown by CSS while the tile is not `.on`,
        // so `refreshLensStates` (a class sync at 5 Hz) moves it too. The
        // reticle wears the same slash (renderer.js drawCursor).
        `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${LENS_G}` +
        `<path class="lens-slash" d="M4.5 19.5l15-15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>` +
        `<span class="tile-nm">cursor</span>${tileStickers(id)}${LEG(n)}</button>`;   // the audition sticker, when on
    }
    const a = ACT_TILES[id];
    // An act tile's hue is its own when it names one: the pins share theirs
    // because they are one group, and the sampler is not in it.
    const ac = ENGINE_HUE[a.hue ?? 'pins'] ?? ENGINE_HUE.pins;
    return `<button type="button" class="tile tile--act${id === 'sampler' && samplerOn() ? ' fired' : ''}" style="--c:${ac};--eng:${ac};${SHAPE(verb)}" data-act="${a.action}" data-pal="${id}"${pos} title="${esc(id === 'pin' || id === 'unpin' ? a.tip : `${a.tip} — ${verbWord(id, verb) ?? verb}`)}">` +
      `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${G[a.g]}</svg>${LEG(n)}</button>`;
  };
  const dock = document.getElementById('paletteDock');
  // ONE ROW: the LENS first (Ek, 2026-09-22 night: "make lens first item …
  // also on the palette rail"), then the hand's two tiles, then the rest of
  // quick access in order. The hand headed the row from 2026-09-12 ("the
  // spacebar to the left of the tile group"); the eye now stands before it,
  // as it does in the tabs — the lens is position 1 still, so `c` and
  // `palette_1` are untouched; only where it is DRAWN moved.
  const lensAt = palette.findIndex(e => isLensTile(e.id));
  const tiles = palette.map((e, i) => paletteTile(e, i + 1));
  const lensTile = lensAt >= 0 ? tiles.splice(lensAt, 1)[0] : '';
  if (dock) dock.innerHTML =
    `<div class="palette" id="paletteBed" title="the palette — the cursor, the hand, then quick access; each tile wears the key that fires it — click the sticker to relearn it, right-click to clear; right-click a tile for its verb">` +
    lensTile + handTileHTML(ENGINE_HUE) + tiles.join('') + `</div>`;
  // The strip was just rebuilt: a tool sounding through it must not go dark
  // for a poll's worth of frames (the switch flipped, a lens cycled on `2`).
  refreshPlayingState();
  renderPinChrome();
  // The seed reads the engines' factory blocks off their real controls, so it
  // waits for the first render rather than running at module load.
  if (!_seeded) { _seeded = true; _seedVoices(); }

  // The box groups by ENGINE, in the same order the engines are named
  // everywhere else. A group with nothing in it is not drawn — an empty
  // caption reads as a broken UI, not as an invitation.
  const byEng = { tape: [], granular: [], erase: [] };
  for (const id of boxIds()) byEng[engineOf(id)]?.push(id);
  // Source · lens · PAINT (tape, grain) · erase — the order Ek asked for, and
  // the order the chain actually runs in.
  // A PRESET row (Ek, 2026-09-24: "pressing the preset just moves the sliders
  // on the main sheet"): a WORD, nothing else — no dot, no half moon (Ek, the
  // same evening: "we can remove the half moon dot design now, and i don't
  // think we need the bullet dot"). The row is ON — the rail's left edge in
  // the hue, bright text — while the live sliders ARE this preset; move one
  // off it and no row is on (Photoshop's presets: a modified brush selects
  // nothing), and pressing the preset puts them back. `.edited` stays on the
  // row as the hook the audit reads. No door — the door is the VOICE line's,
  // one per instrument, because there is one sheet and the presets only move it. The
  // delete is on the row, at the edge the door left (Ek: "the delete should
  // go on the specific preset's line in the tab"). A FACTORY preset has no
  // × at all (Ek, 2026-09-24: "don't allow the deleting of factory presets"):
  // the seeded ones are the instrument's floor, so every engine always has a
  // preset and nothing here needs a "last one stays" state.
  // PRESETS CARRY WEIGHT (Ek, 2026-09-25, from the rails canvas — option B's
  // list): a 42px row, the instrument's glyph (lit in its hue while the row
  // is on), the name at the rail's largest row size, and on the right a few
  // numbers of what the preset DOES, so two presets are told apart before
  // either is pressed.
  const voiceRow = (vid, engine, hue) => {
    const on = currentVoice(engine) === vid;
    const edited = on && _voiceEdited(vid);
    const factory = !!_voices[vid]?.factory;
    const nm = esc(voiceName(vid));
    const word = esc(on ? _voiceWord(vid) : voiceName(vid));
    const eng = GRP_LABEL_G[engine] ?? engine;
    const sum = esc(_voiceSummary(vid));
    const g = INSTR_G[engine] ?? G[tileDef(engine)?.g] ?? '';
    // The row you started from STAYS lit when you move off it (2026-09-25):
    // the asterisk on its name says it has changed, as the hand tile's does.
    return `<button type="button" class="trow trow--voice trow--own${on ? ' on' : ''}${edited ? ' edited' : ''}"` +
      ` style="--c:${hue};--eng:${hue}" data-voice="${vid}" aria-pressed="${on}"` +
      ` title="${nm} \u00b7 ${factory ? 'factory ' : ''}${eng} preset${sum ? ` (${esc(_voiceSummaryKey(engine))}: ${sum})` : ''} \u00b7 click to set the ${eng} voice to it` +
      `${edited ? ' \u00b7 the voice has moved off it — click to go back' : ''}${factory ? '' : ' \u00b7 double-click to rename'}">` +
      `<svg class="trow-g" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${g}</svg>` +
      `<span class="tile-nm">${word}</span>` +
      (sum ? `<span class="trow-sum">${sum}</span>` : '') +
      (factory ? '' :
      `<span class="trow-del" data-delvoice="${vid}" role="button" tabindex="-1"` +
      ` title="delete this preset — the voice keeps sounding as it is">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">` +
      `<path d="M7 7l10 10M17 7L7 17"/></svg></span>`) + `</button>`;
  };

  // ── THE EDITOR PANEL: one instrument, three sections ───────────────────
  // MODE first, then SHAPE PRESETS, then VOICE PRESETS (Ek, 2026-09-22 —
  // "those are basically presets we should call it that"). The sections belong
  // to whichever instrument the tabs are on, and nothing outside it is drawn:
  // nineteen rows became six, by scope rather than by hiding.
  //
  // NO DRAWER DOOR on a row. You are in the EDITOR — selecting a thing IS
  // editing it — so a click both takes the preset and points the sheet at it
  // ("maybe no drawer is needed since it's assumed i'm in editor mode").
  const eng = _instr === 'sampler' ? null : (_instr === 'erase' ? 'erase' : _instr);
  const hue = ENGINE_HUE[eng] ?? ENGINE_HUE.none;
  // ALL THE HEADINGS ARE THE SAME, AND ASH (Ek, 2026-09-22: "can the titles
  // SHAPE PRESETS and VOICE PRESETS use the same design as the word MODE", and
  // again that evening: "go back to grey subheadings"). They took the engine's
  // hue for an hour on the argument that it ranks a heading INSIDE the
  // instrument's card against one naming a card of its own — and it does, but
  // the tab above them already names the engine in that hue at full strength,
  // so the card was saying it three more times and structure ended up looking
  // like identity. They are warm ash: the app's own word for "no engine", which
  // is what a heading is.
  // What ONE of a section is called, for the `+`'s tooltip. A table rather than
  // `t.replace(' presets','')`, which said "new lenses" the moment a section was
  // named in the plural instead of as `<noun> presets`.
  const SEC_NOUN = { 'shape presets': 'shape', 'voice': 'preset' };
  // `extra` follows the `+`: the VOICE line carries its engine's door there
  // (2026-09-24) — the sheet is the instrument's, so its door is on the line
  // that names it, not on each preset that moves it.
  // A CARD'S HEAD (Ek, 2026-09-25 — the rails canvas, F): a section is its own
  // card and this is the top of it — sentence case, semibold, over a hairline,
  // with the `+` and the door flush right.
  const secLbl = (t, engine, add, extra = '') =>
    `<span class="tbx-lbl tbx-lbl--sec" style="--eng:var(--eng-none)"><span class="tbx-lbl-t">${t.charAt(0).toUpperCase() + t.slice(1)}</span>` +
    (add ? `<span class="tbx-add" data-${add}="${engine}" role="button" tabindex="-1"` +
      ` title="new ${SEC_NOUN[t] ?? t.toLowerCase()} — from what is on the sliders now">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">` +
      `<path d="M12 5v14M5 12h14"/></svg></span>` : '') + extra + `</span>`;
  // The VOICE line's door: the drawer glyph, `data-sheet` naming the engine,
  // lit in the engine hue while that sheet is up.
  const voiceDoor = (engine, hue) =>
    `<span class="trow-more${document.body.classList.contains('prail-open') && _propRow === engine ? ' open' : ''}"` +
    ` data-more data-sheet="${engine}" role="button" tabindex="-1" style="--c:${hue}" data-word="voice"` +
    ` title="the ${GRP_LABEL_G[engine] ?? engine} voice — every number of what it sounds like; opens beside the rail">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true">` +
    `<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M14.5 5v14"/></svg></span>`;

  // MODE — only what this instrument actually has. The eraser and the lens have
  // none, and an empty heading is worse than no heading.
  // ── GLOBAL MODES: every instrument's standing answers, in ONE list ──────
  // (Ek, 2026-09-22: "maybe the modes should be taken out completely and put
  // under lenses as GLOBAL MODES … then the tabbed section is strictly a tool
  // creator"). They are not part of BUILDING a tool, so they were in the wrong
  // place behind the tabs: it conflated "what am I making" with "how does this
  // instrument behave", and flipping tape's autopin meant leaving the grain tab.
  //
  // EVERY ROW NAMES ITS SUBJECT FIRST (Ek, 2026-09-22, giving the order and the
  // words): `tape autopin` · `grain autopin` · `loops overdub` · `grains walk on
  // touch` · `erase by stroke`. The subject is the INSTRUMENT where the
  // instrument is the thing that behaves, and the MATERIAL where the material
  // is — a loop is what overdub joins, grains are what a walk reads — so a row
  // reads as a sentence about a thing rather than as a setting with a scope
  // bolted on. The hue carries the same fact a second way.
  // Which param a MODE switch row is, by the hook it carries — so the row
  // names its pid and `_applyParamTips` can put the definition on its label
  // (Ek, 2026-09-25: the performance switches had no tooltip on their words).
  const _SW_PID = [['data-autopin="tape"', 'onEnd'], ['data-autopin="granular"', 'gEnd'], ['data-overdub', 'overdub'],
    ['data-swproxy="trigChopSeg"', 'tchop'], ['data-gwalk', 'walk'], ['data-escope', 'bystroke'], ['data-audition', 'audition']];
  const swRow = (label, on, attr, title, c) =>
    `<div class="mrow"${(p => p ? ` data-pid="${p}"` : '')(_SW_PID.find(([k]) => attr.includes(k))?.[1])}><span class="mrow-l">${label}</span>` +
    `<button type="button" class="mrow-sw${on ? ' on' : ''}" ${attr} role="switch" aria-checked="${on}"` +
    ` style="--c:${c ?? hue}" title="${esc(title)}"><span class="mrow-knob"></span></button></div>`;
  // ── ONE GLOBAL MODE, AND THE REST GO HOME (Ek, 2026-09-22: "since the tool
  //    editor changes what's in the palette, i think that means we can add back
  //    some modes back into their respective tabs right? the only thing that is
  //    truly global is audition") ─────────────────────────────────────────────
  // They were pulled OUT of the tabs earlier today, when the tabbed section was
  // "strictly a tool creator" and an instrument's standing answer had no
  // business there. The editor writes the SLOT now — picking a preset changes
  // what plays — so the tab is exactly where an instrument's settings live, and
  // the five go back to the one they belong to.
  //
  // (AUDITION left this block on 2026-09-24 for the CURSOR section: it is how
  //  the cursor reads, not what an instrument does with paint — see render()'s
  //  cursor panel.)
  //
  // The instrument's own, for the tab that is open. Named WITHOUT the engine —
  // `tape autopin` was right in one list of five engines and is a stammer under
  // the tape tab, which has already said which instrument this is.
  let instrModeHTML = '';
  for (const e of (_instr === 'tape' || _instr === 'granular' ? [_instr] : [])) {
    const ap = autoPinOn(e), kind = _AUTOPIN[e]?.on ?? '';
    // AUTOPIN NAMES WHAT IT MAKES (Ek, 2026-09-22: "rename autopin to autopin
    // as loop … rename autopin to autopin as cloud"). `autopin` alone said that
    // a stroke pins itself and left the reader to remember WHAT it becomes,
    // which is the whole difference between the two engines: tape pins a loop,
    // grain pins a cloud. The word is already in `_AUTOPIN[e].on` — the kind the
    // tooltip has always ended on — so the label reads it rather than repeating
    // it, and a third engine would name itself.
    // Its sticker is the engine's own binding if it has one, else P — the
    // key that sets both engines at once (`a|b` in data-binds: the first bound).
    instrModeHTML += _withBinds(swRow(`autopin as ${kind}`, ap, `data-autopin="${e}"`, ap
      ? `a ${GRP_LABEL_G[e]} stroke pins itself as a ${kind} when you let go — click for manual, where you pin by hand`
      : `a ${GRP_LABEL_G[e]} stroke stays scratch until you pin it — click to pin it as a ${kind} on release`,
      ENGINE_HUE[e]), `${e === 'tape' ? 'tape_autopin' : 'grain_autopin'}|autopin`);
  }
  if (_instr === 'tape') {
    const od = overdubOn();
    instrModeHTML += _withBinds(swRow('overdub', od, 'data-overdub', od
      ? 'a take joins the nearest pinned loop, at the phase you played it — click for its own clock'
      : 'a take runs on its own clock — click to join the nearest pinned loop', ENGINE_HUE.tape), 'tape_overdub');
    // SLICE SITS WITH THE OTHER TWO (Ek, 2026-09-22: "move slice between
    // overdub and dwell"). It was appended after the arrival rows because it
    // arrived last, which put a SWITCH below two pills and broke the block in
    // half: the three switches are tape's standing answers — how a stroke ends,
    // what it joins, whether it is cut — and dwell and retrig are what happens
    // when you TOUCH what those made. Shape sorted the rows before; now the
    // question does, and the shapes agree with it.
    instrModeHTML += swRow('slice', !!S.triggerParams.sliceOn,
      ' data-swproxy="trigChopSeg" data-swon="on" data-swoff="off"',
      S.triggerParams.sliceOn
        ? 'the next take is cut into a trigger per ATTACK — click to keep it whole'
        : 'the next take stays one take — click to cut it at every attack',
      ENGINE_HUE.tape);
  }
  if (_instr === 'granular') {
    const wk = !!S.grainWalk;
    // JUST `walk` (Ek, 2026-09-22: "rename walk on touch as walk"). `on touch`
    // was answering a question the row does not raise: every switch in this
    // block acts when you play, and none of the others says so. What the touch
    // does is the tooltip's job, and the two rows it governs now hang off it.
    instrModeHTML += swRow('walk', wk, 'data-gwalk', wk
      ? 'a touch hands the stroke to a WALKER — it retraces the path at the pace it was painted, playing what is in its reach as it goes, and the cursor reads nothing on its own. Click for the cursor'
      : 'a touch plays what is in the cursor\u2019s reach. Click to walk the stroke you touch instead',
      ENGINE_HUE.granular);
  }
  if (_instr === 'erase') {
    const ws = !!S.eraseWholeStroke;
    instrModeHTML += swRow('by stroke', ws, 'data-escope', ws
      ? 'an erase takes the WHOLE stroke of any mark it touches. Click to take only what is in reach'
      : 'an erase takes what is in reach, mark by mark. Click to take the whole stroke you touch',
      ENGINE_HUE.erase);
  }
  // The GLOBAL MODES card is empty now and stays out of the flow entirely — an
  // empty card is 12px of ground with nothing in it, and the rail's gaps are
  // built on the cards being there or not.
  const gmBar = document.getElementById('globalModes');
  if (gmBar) { gmBar.innerHTML = ''; gmBar.hidden = true; }

  // (The CURSOR PRESETS card — `#lensBar`, the lens rows and their `+` — stood
  //  here until 2026-09-22 night. The lens is a TAB now, and its rows are in
  //  `PERF_PIDS.lens` below.)

  // ── CURSOR INTERACTION, the tab's fourth section (Ek, 2026-09-22) ───────
  // The five arrival rows, in the SAME markup the engine sheet draws them in —
  // `.prow` and the `.opt` kit are unscoped, so the rows that were correct in
  // the drawer are correct here, and `_wireOptions` below is the drawer's own
  // wiring pointed at this panel. Nothing new was drawn for them.
  //
  // GREYED UNDER GRAIN WITH WALK OFF, as they were on the sheet: these five ARE
  // the walker's behaviour, and with `grains walk on touch` off nothing reads
  // them. The switch that opens them is now two rows above, in the same panel.
  // ── PERFORMANCE SETTINGS (Ek, 2026-09-22) ───────────────────────
  // "Anything i need access to while performing should be there. I'm realizing
  // a lot of stuff should actually just be a setting in the settings module."
  // That is the ruling the rail is built on now, and it decides every row: a
  // control earns its place here by being something you reach for MID-PHRASE.
  // Everything else went to Settings → Tools — the rest of cursor interaction,
  // slice min, and dub.
  //
  // It also ends SHAPE PRESETS. Each instrument has one shape, so the list was
  // one meaningful entry plus variations better said as values: `slice` is a
  // switch, the erasers were depth and direction, and `spray` was an amount
  // until it was sunset the same evening. What the presets held is distributed
  // — the live half to these rows, the rest to the settings page.
  // Every tab row names its pid (`data-pid`), so the tooltip can find the
  // row's actions and their keys (midi.js PID_ACTION, 2026-09-24: "nearest
  // has a shortcut, N, but it doesn't show").
  const perfRow = (pid, e = eng) => {
    let h = _perfRowRaw(pid, e);
    if (h && _PID_BINDS[pid]) h = _withBinds(h, _PID_BINDS[pid]);
    return h ? h.replace(/class="mrow\b/, `data-pid="${pid}" class="mrow`) : h;
  };
  const _perfRowRaw = (pid, e = eng) => {
    const d = PARAM_DEFS[pid]; if (!d) return '';
    // The rail's word where the param carries one — see `perfLabel`.
    const lbl = d.perfLabel ?? d.label;
    // A TWO-VALUED PARAM IS A SWITCH OUT HERE (see `bool` in PARAM_DEFS). The
    // switch writes through whatever the param already writes through: a
    // `gseg` owns its value on `S.grainTrigger` and takes `data-gsw`; a `seg`
    // proxies a cabinet control and takes `data-swproxy`, the same pair
    // `slice` uses. The off value is never drawn — it is what the label
    // denies — so the row says `retrig` and the knob says whether.
    if (d.bool) {
      const [onV, offV] = d.bool;
      // A `seg` with no `tp` proxies a cabinet seg outright: read the button.
      const cur = d.kind === 'gseg' ? S.grainTrigger?.[d.path]
                : d.tp ? S.triggerParams?.[d.tp]
                : _readParam(pid);
      const on = cur === onV;
      const attr = d.kind === 'gseg'
        ? ` data-gsw="${d.path}" data-swon="${onV}" data-swoff="${offV}"`
        : ` data-swproxy="${d.seg}" data-swon="${onV}" data-swoff="${offV}"`;
      // The row's own words where it has them (`tips: [on, off]`); retrig's
      // pair is the floor, because it was the first switch drawn here.
      const [tipOn, tipOff] = d.tips ?? [
        'a refire CUTS the pass still sounding — click to let a new pass lay over it',
        'a refire LAYERS over the pass still sounding — click to cut it instead'];
      return swRow(lbl, on, attr, on ? tipOn : tipOff, ENGINE_HUE[e] ?? ENGINE_HUE.none);
    }
    // A NUMBER IS A NUMBER, not a track (Ek, 2026-09-22: "no need for a slider
    // for rearm, just need the numbox ms"). `_knobFor` draws the sheet's full
    // knob in a `.prow` GRID whose columns do not exist out here; the numbox
    // alone is the sheet's own control, and `_wireKnobs` gives it the same
    // drag, type and double-click-to-default.
    // THE LENS'S TWO LIVE NUMBERS ride their rows here as they did on its
    // sheet (2026-09-07): marks in reach beside radius, taken / k beside k —
    // `refreshLensLive` repaints them at 5 Hz while the rail is up.
    // ONE counter, at the end of the filter (Ek, 2026-09-23): radius carried
    // `in reach` and k `taken / k`, which read the same number until reach
    // passed k. `in reach → taken` on k says both, where the filter ends.
    const live = pid === 'k' ? `<span class="mrow-live" data-klive></span>` : '';
    // A readout in WORDS (`depth`: `last 3 strokes`) needs more than a
    // number's 3.5rem — measured, the default clipped it at `last 3 strok`.
    const wide = d.read ? ' mrow-num--words' : '';
    if (_knobFor(pid))
      return `<div class="mrow"><span class="mrow-l">${lbl}</span>${live}` +
        `<input class="prow-v mrow-num${wide}" data-pval="${pid}" value="${esc(_knobVal(pid).disp)}"` +
        ` spellcheck="false" aria-label="${esc(lbl)}"` +
        ` title="drag to set, or type a value and press Enter · double-click resets"></div>`;
    return _cursorSegRow(pid, ENGINE_HUE[e] ?? ENGINE_HUE.none, e);
  };
  // The switches are built above in `instrModeHTML`; these are the rest, in the
  // order Ek named them.
  // THE CURSOR SECTION IS THE WHOLE CURSOR SHEET (Ek, 2026-09-22 night; a tab
  // until 2026-09-23, the rail's lower half since). `ENGINES.lens`' order —
  // the order Ek named on 2026-09-23.
  const PERF_PIDS = {
    tape:     ['dwell', 'retrig'],
    granular: ['gdwell', 'gretrig', 'flow', 'headW'],
    erase:    ['depth', 'efrom'],
    // FALLOFF LIVES IN SETTINGS → TOOLS (Ek, 2026-09-23): it is set once, not
    // ridden. It stays in ENGINES.lens, which is what the tile captures.
    lens:     ENGINES.lens.filter(pid => pid !== 'fadeCurve'),
  };
  // GREYED UNDER GRAIN WITH WALK OFF, as they were on the sheet: `dwell` and
  // `retrig` ARE the walker's behaviour, and with `walk on touch` off nothing
  // reads them. The switch that opens them is two rows above, in this panel.
  const dead = eng === 'granular' && !S.grainWalk;
  const why  = 'a touch reads what is in reach, so this has nothing to act on' +
               ' — turn WALK on, just above, and a touch plays the stroke';
  // AND THEY HANG OFF IT (Ek, 2026-09-22: "add a visual element to show that
  // dwell and retrig are part of walk setting, use what's standard in the
  // design kit"). The kit has one and it is not a glyph: the settings rail's
  // sub-item (`.set-nav-item--sub`, 2026-09-14) indents a row to where its
  // parent's LABEL begins and drops it a step quieter, with no mark of its own
  // — "the icon belongs to the subject, and there is one subject". An arrow
  // bullet would be a second vocabulary for a relationship the kit already
  // draws, and it would have to be learned; an indent is read.
  //
  // Ported rather than copied: out here the parent's label starts at the row's
  // own left edge, so there is no icon column to clear and the indent is one
  // step of the scale (`--sp-5`, 12px). GREYING IS THE OTHER STATE, not this
  // one — `.ds-na` says "nothing to act on" and goes when walk comes on; the
  // indent says "belongs to walk" and never goes, because it is still true.
  const sub = pid => pid === 'gdwell' || pid === 'gretrig';
  // THE LENS GREYS WHAT ITS MODE BYPASSES, as its sheet did (2026-09-22:
  // "it should just grey out the one's not available"). Nearest hands the
  // whole sphere to the selection pass, so radius, depth and the fade pair
  // have nothing to act on. (k = 0 is `all` since 2026-09-24 — the `fill`
  // switch that greyed k is gone.) The rows stay in place — a tab that reshapes
  // itself under a flip is the thing that made the old page feel like it was
  // collapsing.
  const nearest = S.lensMode === 'nearest';
  const uncapped = (S.grainOverrides.k ?? gp().k) === 0;   // k = 0 is all
  const reads = S.lensReads ?? 'both';
  // Radius is the TAPE gate's too, so nearest only takes it off a cursor that
  // reads grains alone.
  const grainsOnlyNearest = nearest && reads === 'grains';
  const lensNA = pid =>
    reads === 'tape' && ['mode', 'depth', 'k', 'step', 'rfade'].includes(pid)
      ? `scope is tape — a take fires when the cursor comes within the radius, and ${PARAM_DEFS[pid].perfLabel ?? PARAM_DEFS[pid].label} only shapes how grains are read`
    : nearest && ['depth', 'rfade'].includes(pid) || grainsOnlyNearest && pid === 'radius'
      ? `nearest reads the k closest anywhere, so ${PARAM_DEFS[pid].perfLabel ?? PARAM_DEFS[pid].label} has nothing to act on — switch mode to radius to use it`
    : null;
  let perfHTML = (PERF_PIDS[eng] ?? []).map(pid => {
    let row = perfRow(pid); if (!row) return '';
    // Both row builders open with the same literal — the numbox's `<div
    // class="mrow">` and the seg row's `<div class="mrow" style="--c:…">` — so
    // one replacement reaches either.
    if (sub(pid)) row = row.replace('class="mrow"', 'class="mrow mrow--sub"');
    return (dead && sub(pid))
      ? `<div class="ds-na" title="${esc(why)}">${row}</div>` : row;
  }).join('');
  // VOICE PRESETS — only what sounds has one.
  const vIds = eng && VOICE_PIDS[eng]?.length ? voicesOf(eng) : null;

  // MODE IS IN THE PANEL — and it comes LAST (Ek, 2026-09-22, evening). It led
  // for a day, on the reasoning that it is the question asked once that every
  // preset below is built under. True about the logic, wrong about the hand: the
  // rail was measured on the running app and the order was costing the two lists
  // you actually play.
  //
  //   the list is 695px tall; the GRAIN tab's content was 828. 133px sat below
  //   the fold with no scrollbar drawn at rest, so `match` was half gone and
  //   VOICE PRESETS — its label, both voices and its `+` — was not on screen at
  //   all. Above them, 269 of the card's 450px came before the first thing you
  //   pick, and on grain 150px of THAT is CURSOR INTERACTION greyed out, because
  //   it does nothing until WALK ON TOUCH is on.
  //
  // The rail was spending its best space on rows that were off and hiding the
  // ones you reach for — and the two hidden lists are the two that GROW every
  // time the `+` is pressed, so it got worse by being used. Something must fall
  // below the fold in a 695px column; the order decides WHAT. Picks first, set-
  // once second, and a rule between them, because a division breaks harder than
  // a gap.
  // THE PANEL WEARS THE TAB'S HUE (2026-09-22): one custom property, set where
  // the instrument is already known, and the outline reads it.
  const panel = document.getElementById('instrPanel');
  if (panel) panel.style.setProperty('--eng', ENGINE_HUE[_instr === 'sampler' ? 'source' : eng] ?? ENGINE_HUE.none);
  // (The bar that bridged the pill to the card went with the pill: the chosen
  // tab IS the card now, so there is nothing to bridge.)
  // THE MODE SWITCHES LEAD, AND THEY ARE NOT A SECTION (Ek, 2026-09-22,
  // evening: "mode params need to be at the top of the tab and we can remove
  // the mode subtitle"). Two switches under the tab that names the instrument
  // need no heading to say whose they are — the tab said it, in the hue, one
  // row above. MODE was a label over two rows, which is a heading doing less
  // work than the space it took in a 320px column.
  //
  // No rule between the halves either (same evening). The labels below carry
  // their own 12px of top padding and the switches are visibly a different
  // shape from a preset row, so the division was drawing a line where the
  // content already changed.
  // The switches and the rows are ONE block with no heading: the tab above has
  // already named the instrument, and `performance settings` as a caption would
  // name the only thing in the card.
  // …and audition closes it, after the instrument's own rows.
  // AUDITION ONLY WHERE THERE IS PAINT TO AUDITION (Ek, 2026-09-23: "erase tab
  // and lens tab dont need the audition toggle"): it is what tape and grain do
  // with what you paint, and the eraser and the eye paint nothing.
  const perf = instrModeHTML + perfHTML;
  const panelHTML =
    (perf ? `<div class="tbx-grp tbx-grp--bare" data-grp="perf" data-half="perf">` + perf + `</div>` : '');
  // THE VOICE IS ITS OWN CARD (Ek, 2026-09-25 — the rails canvas, F: "more
  // balanced … everything else is too squished"). Under the instrument's card,
  // titled in its head; the rail's click wiring is on #toolRail, so the rows
  // work wherever they are drawn.
  const voiceHTML = vIds ? `<div class="tbx-grp" data-grp="${eng}" data-half="voice">` +
      // THE VOICE LINE (Ek, 2026-09-24): the instrument's sound, one sheet,
      // its door here. What is listed under it are PRESETS of it.
      secLbl('voice', eng, 'addvoice', voiceDoor(eng, hue)) +
      (vIds.length ? `<div class="tbx-tiles">${vIds.map(v => voiceRow(v, eng, hue)).join('')}</div>` : '') +
      `</div>` : '';

  bar.innerHTML = panelHTML;
  const voiceBox = document.getElementById('voicePanel');
  if (voiceBox) { voiceBox.innerHTML = voiceHTML; voiceBox.hidden = !voiceHTML; }
  // THE DRAWER'S OWN WIRING, pointed at the panel: the cursor rows write through
  // the real cabinet controls exactly as they did on the sheet. No `capId` —
  // these five are `S.triggerParams`, the instrument's, and no tile captures
  // them any more.
  // …and `_wireKnobs` with it: `rearm` is a slider, so its track and numbox are
  // the drawer's knob kit and want the drawer's drag, type and double-click.
  // The tab's rows capture into the TOOL the tab edits, not into whatever the
  // sheet happens to show — the sheet is a voice's now, and a voice's block
  // does not hold `rate` or `width` (2026-09-22 night).
  if (perfHTML) { _wireOptions(bar, () => benchShape()); _wireKnobs(bar, () => benchShape()); }

  // ── THE CURSOR SECTION (Ek, 2026-09-23) ────────────────────────────────
  // "bring out the cursor tab and have its own section that is aligned with
  // the bottom of the left rail … the cursor is always shown". It was a TAB,
  // so reading the eye meant leaving the tool you were on, and the palette's
  // `c` had to switch tabs to show it. Now it is the rail's lower half, a
  // fixed height from the bottom under its own CURSOR bar, and the tools'
  // tabs above it change height freely. Same rows, same greying, same wiring;
  // what they capture into is the lens tile, whatever tab is open above.
  const curBox = document.getElementById('cursorPanel');
  if (curBox) {
    // AUDITION IS THE CURSOR'S (Ek, 2026-09-24): the switch sits here, after
    // the reach, because it says how the cursor READS — as baked, or through
    // the live sheet — for both instruments, and the cursor is the monitor.
    // It rewrites nothing. It was the last row of each engine's performance
    // block from 2026-09-22, when it made new paint follow the knobs.
    const au = !!S.auditionMode;
    const auRow = _withBinds(swRow('audition', au, 'data-audition', au
      ? 'ON — the cursor plays what it reads through the live tape and grain sheets, so a preset or a knob is heard on what is already there. Nothing is rewritten; pins play as baked. Click to hear the sphere as baked'
      : 'OFF — the cursor plays what it reads as baked. Click to hear it through the live sheets instead: audition a preset or a knob on what is already there, without repainting',
      ENGINE_HUE.none), 'audition');
    const curHTML = (PERF_PIDS.lens ?? []).map(pid => {
      const row = perfRow(pid, 'lens'); if (!row) return '';
      // THE GRAIN BLOCK wears the heading VOICE PRESETS wears (Ek, 2026-09-23):
      // what follows answers only for grains, and the heading says so once.
      // Since 2026-09-25 (the rails canvas, F) it is its OWN CARD, headed: the
      // first card closes here and the grain behaviour's opens.
      const head = pid === 'mode' ? `</div><div class="rail-card">` + secLbl('grain Behaviour', 'lens')   /* Ek, 2026-09-25: "Grain Behaviour (capital B)" */ : '';
      const na = lensNA(pid);
      return head + (na ? `<div class="ds-na" title="${esc(na)}">${row}</div>` : row) + (pid === 'radius' ? auRow : '');
    }).join('');
    curBox.innerHTML = `<div class="tbx-grp tbx-grp--bare" data-grp="perf" data-half="perf"><div class="rail-card">${curHTML}</div></div>`;
    curBox.style.setProperty('--eng', ENGINE_HUE.lens ?? ENGINE_HUE.none);
    _wireOptions(curBox, () => LENS_ID);
    _wireKnobs(curBox, () => LENS_ID);
    // What the section was drawn UNDER — `_syncLensTab` redraws when it moves.
    curBox.dataset.lensKey = `${nearest ? 'n' : 'a'}${uncapped ? 'A' : 'k'}${reads}`;
    refreshLensLive();
  }
  // The SAMPLER is its own panel — it has no shapes and no voices, because it is
  // where material comes FROM rather than what you do with it (ui-source.js
  // fills it). Shown only on its own tab; the tools panel steps aside for it.
  const srcBar = document.getElementById('srcBar');
  if (srcBar) srcBar.hidden = _instr !== 'sampler';
  if (bar) bar.hidden = _instr === 'sampler';

  // ── THE TABS ────────────────────────────────────────────────────────────
  const tabs = document.getElementById('instrTabs');
  if (tabs) {
    // THE TABS ARE A SEG-PILL, the app's existing segmented control (Ek,
    // 2026-09-22: "the tab should have the same design as the rounded multi
    // select pill like on the right rail pin side e.g. SORT: near far old").
    // Not a lookalike: the same `.seg-pill` > `.grain-seg-btn` the pins rail's
    // sort uses, in the `.seg-glyph` density, so the two read as one control in
    // two places and a change to the kit reaches both. `.itabs` / `.itab` were
    // a third design for a control that already existed twice.
    const one = i => {
      const on = i.id === _instr;
      const c = ENGINE_HUE[i.id === 'sampler' ? 'source' : i.id] ?? ENGINE_HUE.none;
      const g = INSTR_G[i.id] ?? G[i.g] ?? '';
      // THE ONE YOU ARE IN SAYS SO (2026-09-22, evening). Four 72.8px glyphs
      // and the instrument named nowhere: the row said which of four is chosen
      // but never which one that IS, and the card below it inherited the
      // question. The word rides ONLY the chosen tab — the other three stay
      // marks, so the row is still read by shape at arm's length — and it is
      // the same word the tooltip and `aria-label` already carry.
      // An icon-only button says what it is to a reader as well as to an eye.
      return `<button type="button" class="grain-seg-btn${on ? ' active' : ''}" data-instr="${i.id}"` +
        ` style="--c:${c}" aria-pressed="${on}" aria-label="${i.label}"` +
        ` title="${i.label} — ${i.tip}">` +
        `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${g}</svg>` +
        (on ? `<span class="itab-nm">${i.label}</span>` : '') + `</button>`;
    };
    tabs.innerHTML = `<span class="seg-pill seg-glyph" role="group" aria-label="instrument">` +
      `${_instruments().map(one).join('')}</span>`;
  }

  renderOptions();
  _fillRowBinds();          // the stickers on rows and chrome buttons (2026-09-25)
  _applyParamTips(document.getElementById('toolRail'));
  // After the rail has been laid out, not during: the mark measures.
  requestAnimationFrame(railScrollMark);
}

/** THE RAIL DRAWS ITS OWN SCROLL MARK (2026-09-22).
 *
 *  The list has always scrolled and has never said so. `::-webkit-scrollbar`
 *  with a 6px width and a thumb that appeared on hover was already in the
 *  stylesheet — and MEASURED against the running app it paints nothing:
 *  `offsetWidth - clientWidth` is 0, and a cropped screenshot of the rail's
 *  right edge is empty at rest. macOS overlay scrollbars win, and
 *  `scrollbar-width: thin` with `scrollbar-color` does not change that either
 *  (both tried through the bridge, both 0). So the platform will not draw this
 *  and the rail has to.
 *
 *  It cost a whole section. On the grain tab the content was 828 in a 695 box:
 *  `match` was cut in half and VOICE PRESETS — its label, both voices, its `+`
 *  — was below the fold with nothing on screen to say it existed.
 *
 *  A MARK, not a control: the list is scrolled by the wheel and the trackpad
 *  like everything else, and a 2px bar is not something to take hold of. It is
 *  the slider's own track width, in the ramp's quietest value, and it is only
 *  there when there is something to say — no overflow, no mark. Called from
 *  `render()` and on the list's own scroll; nothing per-frame, because this
 *  thread belongs to the grain scheduler.
 */
// THE RAIL SCROLLS AS ONE (2026-09-25). The tools list scrolled on its own
// above a cursor section pinned to the foot, so on a laptop-height window the
// voice presets sat below the fold behind the cursor. Now the list grows to
// fill and the RAIL scrolls when the two do not fit: with room, the cursor
// still sits on the foot; without, you scroll to it and nothing is hidden
// behind it. The Tools bar stays put (sticky). The mark follows the rail.
function railScrollMark() {
  const rail = document.getElementById('toolRail');
  if (!rail) return;
  let mark = rail.querySelector('.lyr-scroll');
  if (!mark) {
    mark = document.createElement('div');
    mark.className = 'lyr-scroll';
    mark.setAttribute('aria-hidden', 'true');
    mark.appendChild(document.createElement('i'));
    rail.appendChild(mark);
    rail.addEventListener('scroll', railScrollMark, { passive: true });
    window.addEventListener('resize', railScrollMark);
  }
  const over = rail.scrollHeight - rail.clientHeight;
  if (over <= 1) { mark.hidden = true; return; }
  mark.hidden = false;
  // Under the sticky bar, over the rest of the visible rail — offset by the
  // scroll, because the mark is a child of the thing that scrolls.
  const bar = rail.querySelector(':scope > .lyr-bar')?.offsetHeight ?? 0;
  const vis = rail.clientHeight - bar;
  mark.style.top = `${rail.scrollTop + bar}px`;
  mark.style.height = `${vis}px`;
  // A floor on the thumb, or a long list draws a mark too short to see.
  const h = Math.max(24, vis * (rail.clientHeight / rail.scrollHeight));
  const thumb = mark.firstElementChild;
  thumb.style.height = `${h}px`;
  thumb.style.transform = `translateY(${(rail.scrollTop / over) * (vis - h)}px)`;
}

/** UNPIN ALL's button in the pinned rail's block (2026-09-25) — its glyph, the
 *  one the act row wore. The rows at the rail's foot are gone: unpin all moved
 *  up into the block, and the MIX mute became the ALL bus's M (ui-pins.js). */
export function renderPinChrome() {
  const b = document.getElementById('lyrUnpinAll');
  const html = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${G[ACT_TILES.unpinall.g]}</svg>`;
  if (b && b.innerHTML !== html) b.innerHTML = html;
}

/** The pressed look for the pin pair — they have no `playing` state (nothing
 *  sustains), so the press is the only feedback there is. */
// The flash belongs to the ACTION, not to the way in: the `-` key never
// flashed, and a button, OSC or MIDI press flashed a hidden cabinet element
// (Ek, 2026-09-10: "for the unpin i don't see it light up when i press it").
// midi.js calls this from the commit_drop / commit_release / commit_clear
// cases through S._pinFlash; the key and rail paths that bypass dispatch call
// it themselves.
// BY POSITION, like every other tile (Ek, 2026-09-15: "i hold down arrow, the
// take over is working on the viz but the pin down (short) is still lit up in
// the palette"). This looked up the strip tile by ACTION with a SINGULAR
// querySelector, and both pin verbs carry the same `data-act="commit_drop"` —
// so with a pin bang and a pin momentary on the strip it could only ever reach
// the FIRST of them. Holding the momentary lit the bang tile and left the
// momentary dark: the light said the wrong verb was running, while the viz did
// the right thing. _lightHeld's own comment eight hundred lines up already
// states the rule this broke — "the same tool may sit on the strip twice in two
// verbs, and lighting both would say the wrong one is sounding".
//
// `pos` is the palette index the action came FROM. Given, exactly that tile
// lights. Omitted — the `=` key, OSC, MIDI, a rail click — the action is not
// attributable to a position, so every pin tile flashes; that is the "the flash
// belongs to the ACTION, not to the way in" rule above, unchanged.
function _pinEls(kind, pos) {
  if (kind === 'all') kind = 'unpinall';   // midi.js's commit_clear says `all`
  const act = { pin: 'commit_drop', unpin: 'commit_release', unpinall: 'commit_clear',
                mute: 'pins_mute',
                sampler: 'source_sampler' }[kind];
  const rail = document.querySelector(`#lyrModes [data-pin="${kind}"]`);
  const tiles = pos == null
    ? (act ? [...document.querySelectorAll(`#paletteDock [data-act="${act}"]`)] : [])
    : [...document.querySelectorAll(`#paletteDock .tile[data-pos="${pos}"]`)];
  return [rail, ...tiles].filter(Boolean);
}
function _pinFlash(kind, pos) {
  const els = _pinEls(kind, pos);
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
function _pinLit(kind, on, pos) {
  // A sustained light must be the one position that is running, never every
  // tile that shares the action — see _pinEls.
  for (const el of _pinEls(kind, pos)) el.classList.toggle('fired', !!on);
}
S._pinFlash = _pinFlash;
// The pin ACTION is the `=` key (Ek, 2026-09-10: "the pin binding is old, it
// only pins clouds. it should pin the same as the = button"): what the cursor
// is on decides — a tape stroke becomes a loop, a take being recorded is cut into a loop and a layer,
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
  // A ROW SAYS `deposit` ONLY WHERE NOTHING ELSE DOES (Ek, 2026-09-22: "what
  // would make it more clear is renaming rate, deposit rate, and width,
  // deposit width"). `rate` and `width` are bare words — rate of what, width
  // of what — and on the tool rail's performance block there is no heading to
  // answer, because that block deliberately has none: the tab above it names
  // the instrument and nothing else is said. On the SHEET they already sit
  // under a DEPOSIT heading, so the same prefix there reads `DEPOSIT · deposit
  // rate`, which is the stammer that took the engine off `tape autopin` under
  // the tape tab this morning. So `perfLabel` is the rail's word and `label`
  // the sheet's — one param, named for where it is read, the way `autopin`
  // already is.
  // granular engine — deposit
  flow:     { label: 'rate',    perfLabel: 'deposit rate',  kind: 'flow', def: 50, sec: 'deposit' },
  // WIDTH of the deposit head: 0° lays a single line of marks, anything above
  // spreads them across that many degrees either side of the path (#279).
  // NOT `spread` (2026-09-22): `pan` already wears that label one section down
  // in OUTPUT, and both are spatial — a second `spread` on one sheet would be
  // the one rename that made this less clear rather than more.
  headW:    { label: 'width',   perfLabel: 'deposit width', kind: 'head', def: 0,  sec: 'deposit' },
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
  // SLOPE (Ek, 2026-09-24; `taper` from #277 until then), not fade: this is
  // the fraction of the grain spent ramping — the Tukey window's α — and
  // "fade" is spoken for by the LEVEL fades elsewhere (the lens's radius
  // fade, loop fades). The pid stays `fade` so every binding, OSC address and
  // stored patch is untouched. It has NO TRACK: it is the number at the end
  // of the CURVE row — a property of the shape, typed or scrubbed there.
  fade:     { label: 'slope',   kind: 'slider', el: 'gcFadeSlider', sec: 'grain' },
  durVar:   { label: 'dur ±',   kind: 'slider', el: 'gcDurVarSlider', sec: 'grain' },
  perVar:   { label: 'per ±',   kind: 'slider', el: 'gcPeriodVarSlider', sec: 'grain' },
  // Two rows that are their own controls, not parameters (#280). They live in
  // PARAM_DEFS so they take a place in the engine's order like anything else.
  glink:    { label: 'link',    kind: 'glink',  sec: 'grain' },
  octave:   { label: 'octave',  kind: 'octave', sec: 'grain' },
  // Read-OFFSET randomness, not a start time: markers land on a fixed clock,
  // so without this a grain can only begin exactly on one. It widens each
  // grain's reach into the audio between markers.
  startJit: { label: 'offset ±', kind: 'slider', el: 'gcStartJitterSlider', sec: 'grain' },
  durJit:   { label: 'dur jit', kind: 'slider', el: 'gcDurJitterSlider', sec: 'grain' },
  // Probability is a gate on the OUTPUT, not a property of the grain: it
  // decides whether a scheduled grain sounds at all (#283).
  prob:     { label: 'prob',    kind: 'slider', el: 'gcProbSlider', sec: 'output' },
  // granular — pitch. NO HEADING OF ITS OWN (Ek, 2026-09-24: "remove the
  // pitch heading"): pitch, its octave and the read direction are three rows
  // under GRAIN, after the timing rows, so the sheet's second column is one
  // block rather than a heading over three lines.
  pitch:    { label: 'pitch',   kind: 'slider', el: 'gcPitchShiftSlider', sec: 'grain' },
  pitchJit: { label: 'pitch ±', kind: 'slider', el: 'gcPitchSlider', sec: 'grain' },
  dir:      { label: 'direction', kind: 'seg', seg: 'gcDirSeg', sec: 'grain' },
  // granular — filter. ONE filter per grain (2026-09-23): a switch, a type,
  // a cutoff, a resonance and a spread — Granulator's layout, Pigments',
  // Emission Control's. The old hpf + lpf with a Q each was an EQ's layout
  // and could not make a band-pass, which is the grain filter that matters.
  flt:      { label: 'filter',  kind: 'seg', seg: 'gcFilterOnSeg', bool: ['on', 'off'], sec: 'filter' },
  ftype:    { label: 'type',    kind: 'seg', seg: 'gcFilterTypeSeg', words: true, sec: 'filter' },
  cutoff:   { label: 'cutoff',  kind: 'slider', el: 'gcCutoffSlider', sec: 'filter' },
  res:      { label: 'res',     kind: 'slider', el: 'gcResSlider', num: 'gcResNum', sec: 'filter' },
  // Per-grain cutoff randomisation (0–1 octave either side). Drawn as the
  // BAND on the cutoff row, as dur ± and per ± are (VAR_OF), not a row.
  fltJit:   { label: 'cutoff ±', kind: 'slider', el: 'gcFilterJitterSlider', sec: 'filter' },
  // granular — output
  pan:      { label: 'spread',  kind: 'slider', el: 'gcPanSlider', sec: 'output' },
  vol:      { label: 'vol',     kind: 'slider', el: 'gcVolSlider', sec: 'output' },
  // (SPRAY was a DEPOSIT row here for one day, 2026-09-22, and `sort by` beside
  //  it for an evening. Both were "general shape params, not an experimental
  //  annexe", both carried their own OFF inside their value — and both are
  //  gone, spray last: a dynamic head answers the hand, and nobody has decided
  //  yet whether a wider head is musical. DEPOSIT is `rate` and `width`.)
  // tape engine — what the tape IS, frozen when the stroke ends (#236, Ek):
  // speed, direction, level. "When I draw that line I'm not thinking about
  // how [touch playback] works" — so everything about TOUCHING a tape (dwell,
  // start, release, retrig, rearm) lives on the LENS, beside k/fill/order for
  // grains. Speed, reverse, vol and passes ARE frozen per stroke: armTrigger
  // snapshots them onto the trigger and the piece file carries them, and
  // NOTHING rewrites them afterwards — the grain filter is granular-only and
  // writes to no material at all (#292). These rows write S.triggerParams,
  // which sets FUTURE arms. The sections are named by EFFECT, as the grain
  // sheet's are (2026-09-18; `baked in` said how a value is stored, not what
  // it does): `tape` is the sound, `on end` is what happens when the stroke
  // ends, `slicing` is how the take is cut, once. docs/TAPE-STUDY-2026-09.md.
  tspeed:   { label: 'speed',   kind: 'slider', el: 'trigSpeedSlider', sec: 'tape' },
  // Two dials, no switch (docs/TAPE-STUDY-2026-09.md § 3): speed is tape,
  // pitch is a shift on top at constant length, computed offline by the phase
  // vocoder because a baked value never needs real time. `step` quantises
  // both dials — free, semitones, or octaves and fifths.
  tpitch:   { label: 'pitch',   kind: 'tp', path: 'pitch', min: -PITCH_MAX_CENTS, max: PITCH_MAX_CENTS, step: 1, def: 0,
              fmt: v => fmtPitch(v), q: v => quantPitch(v), sec: 'tape' },
  tstep:    { label: 'step',    kind: 'tstep', sec: 'tape' },
  // The dub tile's one dial (docs/TAPE-STUDY-2026-09.md § 4): Blooper's
  // REPEATS. While a dub records, everything already in the loop steps down
  // by this at every wrap; nothing fades in playback. Baked at the press.
  decay:    { label: 'decay',   kind: 'tp', path: 'dubDecay', min: 0, max: 100, step: 1, def: 0,
              fmt: v => Math.round(v) + '%', sec: 'dub' },
  // The only backwards playback used to be the lens's `start: ends` turntable
  // rule, a read-time accident standing in for a property of the tape; a
  // pinned loop took its direction from the CLOUD's `path dir`. Now the tape
  // has its own, and `ends` flips it (trigger.js _onEnter).
  treverse: { label: 'reverse', kind: 'treverse', sec: 'tape' },
  tvol:     { label: 'vol',     kind: 'slider', el: 'trigVolumeSlider', sec: 'tape' },
  tchop:    { label: 'slice',   kind: 'seg', seg: 'trigChopSeg', sec: 'slicing' },
  sliceMin: { label: 'min slice', kind: 'fx', path: 'sliceMinMs', min: 0, max: 500, step: 10,
              fmt: v => (+v > 0 ? Math.round(v) + 'ms' : 'keep all'), sec: 'slicing' },
  // Self-killing loops (#239): a looper stroke plays N passes, fading each,
  // then deletes itself AND its paint. 0 = ∞ (a loop that stays). Baked at
  // record time — "a decision I make when I record the loop" (Ek).
  passes:   { label: 'passes',  kind: 'tp', path: 'passes', min: 0, max: 8, step: 1,
              fmt: v => (+v > 0 ? Math.round(v) + '×' : '∞'), sec: 'on end' },
  // The looper contract as a param (#244): 'loop' = end the stroke and it
  // loops immediately. Any loop tile — a custom one included —
  // becomes a looper by flipping this; line/slice pin 'arm' by identity.
  onEnd:    { label: 'loop',    kind: 'onend', sec: 'on end' },
  // Read-time params — the LENS engine: how the cursor reads a stroke it
  // TOUCHES. One family for both readers (2026-09-18): a tape stroke fires its
  // take, a grain stroke under `mode: stroke` launches a WALKER (js/walker.js),
  // and dwell / start / release / retrig / rearm mean the same thing to each —
  // once or loop, from the top or the touch or the end you arrived at, how it
  // leaves, what a refire does, how soon it may refire. Hence `cursor
  // behaviour` (Ek, 2026-09-22) — the rows are not about the stroke, they are
  // about what the CURSOR does when it gets there,
  // not `on tape`.
  // `words` came off dwell the evening it got `1` and `∞` — those two ARE the
  // words, shorter. `retrig` keeps them: `cut | layer` has no symbol yet.
  dwell:    { label: 'dwell',   kind: 'seg', seg: 'trigDwellSeg', sec: 'cursor behaviour' },
  // GRAIN'S OWN ARRIVAL SET (2026-09-22). Tape's four above proxy the cabinet's
  // segments, which write `S.triggerParams`; grain's write `S.grainTrigger` and
  // have no cabinet control, so they carry their options here and render
  // through `gseg`. `dwell` has no `grain` option for a walker: a walker IS the
  // stroke playing, so there is nothing for it to open.
  // `icons` names an entry in SEG_ICONS for a `gseg` to borrow. Grain's dwell
  // asks tape's question with tape's two values, so it wears tape's two marks
  // rather than a second drawing of `1` and `∞` (2026-09-22).
  gdwell:   { label: 'dwell',   kind: 'gseg', path: 'dwell', icons: 'trigDwellSeg',
              opts: [['oneshot', 'once'], ['loop', 'loop']], sec: 'cursor behaviour' },
  gstart:   { label: 'start',   kind: 'gseg', path: 'start',
              opts: [['top', 'top'], ['touch', 'touch'], ['ends', 'ends']], sec: 'cursor behaviour' },
  grelease: { label: 'release', kind: 'gseg', path: 'release',
              opts: [['play-to-end', 'play→end'], ['fade', 'fade']], sec: 'cursor behaviour' },
  // RETRIG IS A SWITCH (Ek, 2026-09-22: "i want retrig as on off, if it's on
  // then it's cut, if it's off it's layer assumed"). `bool: [on, off]` says a
  // two-valued param is a YES/NO rather than a WHICH-ONE, and the perf rail
  // draws it as the switch the kit reserves for that — `cut` is the thing
  // retrig NAMES, so retrig on is cut and the other state needs no word. The
  // `opts` stay for the sheet, which still draws the capsule.
  gretrig:  { label: 'retrig',  kind: 'gseg', path: 'retrig', bool: ['cut', 'layer'],
              opts: [['cut', 'cut'], ['layer', 'layer']], sec: 'cursor behaviour' },
  tstart:   { label: 'start',   kind: 'seg', seg: 'trigStartSeg', sec: 'cursor behaviour' },
  release:  { label: 'release', kind: 'seg', seg: 'trigReleaseSeg', sec: 'cursor behaviour' },
  retrig:   { label: 'retrig',  kind: 'seg', seg: 'trigRetrigSeg', words: true,
              bool: ['cut', 'layer'], tp: 'retrig', sec: 'cursor behaviour' },
  rearm:    { label: 'rearm',   kind: 'slider', el: 'trigRearmSlider', sec: 'cursor behaviour' },
  // lens engine
  // `mode` (area | nearest) is a normal per-tile param (Ek: the sheet always
  // edits its own tile) — wide ships area and spot ships nearest via
  // FACTORY_PARAMS, and flipping it on a factory lens is a session edit.
  // THE LENS SHEET, REORGANISED (2026-09-18, Ek: "it's really hard to tell
  // just from the params how things work together and what links to what or
  // depends on what"). Three sections, named for the question each answers:
  //
  //   reach       reads · radius            the two that govern BOTH engines
  //   on grains   mode · depth · k · order · fade · falloff
  //   cursor behaviour  dwell · start · release · retrig · rearm
  //
  // `mode` LEADS `on grains` because it is grains-only — the tape gate reads
  // it in one place, to decide whether to build walk gates, and never to
  // decide how a take is touched — and because it decides what the rest of
  // that section means. `radius` stays shared: it is the grain reach AND the
  // distance at which a stroke is touched (trigger.js `enterRad`). Every
  // other row here is grains-only.
  mode:     { label: 'mode',    kind: 'seg', seg: 'snapToggleSeg', sec: 'on grains' },
  // WHAT the cursor reads, beside HOW it reads (2026-09-07, Ek: "it should be
  // in a lens, reads grains, loops or both"). This is where the deleted
  // `triggers on|off` global belongs: per lens, saved with the tile, so a lens
  // that only fires tape is a tool you arm on `2` rather than a mute you have
  // to remember. The cap outranks it — capped, the cursor reads nothing.
  reads:     { label: 'scope',    kind: 'reads', sec: 'reach' },
  radius:    { label: 'radius',   kind: 'slider', el: 'radiusSlider', num: 'radiusVal', sec: 'reach' },
  // Recency is reach in TIME — only the N most recent takes are readable —
  // and it filters the grain pools, never the tape gate. The eraser shares
  // the row (one knob, two engines) and calls its section `reach` too.
  // FOUR ANSWERS, ON A CAPSULE (Ek, 2026-09-24: "a multi select pill with just
  // 1 2 3 then all"). It was a 1–16 slider read out in words; the cabinet seg
  // `recencySeg` holds 1 … 6 · all (6 since 2026-09-25), and a tile stores its data-depth —
  // '0' is all, the values FACTORY_PARAMS already used.
  depth:     { label: 'depth',   kind: 'seg', seg: 'recencySeg', words: true, sec: 'on grains' },
  // k, fill and order came HOME to the lens (#233): flow made density a
  // painted property of the material, so how many marks the cursor reads —
  // and in what order — is the lens's job. Aperture is deleted: it existed
  // only to cap k without touching the brush, and with k here it had no job.
  k:        { label: 'k',       kind: 'slider', el: 'searchKSlider', num: 'kBigNum', sec: 'on grains' },
  // A YES/NO WEARING A CAPSULE (Ek, 2026-09-22 night: "i want it to be
  // boolean when possible"). `order` asks "in the order it was played, or not"
  // — so on the tab it is the switch `step`, named for the thing that is on
  // (the same rule retrig follows). The cabinet keeps its two-button seg; the
  // switch writes through it (`data-swproxy`). (`fill` — "cap it at k, or
  // not" — stood beside it until 2026-09-24; k = 0 is that answer now.)
  step:   { label: 'order',   perfLabel: 'step', kind: 'seg', seg: 'lensStepSeg', bool: ['on', 'off'], sec: 'on grains',
              tips: ['marks play one at a time, in the order they were made — click for random',
                     'the next mark is picked at random from what is in reach — click to play them in order'] },
  // The fade pair — volume falloff from cursor centre to the radius edge.
  // `falloff` renders as an x/y diagram (distance → volume), not a knob: the
  // old "curve %" said nothing about WHICH way 100% bends (Ek). The shape is
  // the worklet bridge's truth: gain = (1 − d/radius)^(1 + curve×3).
  // `rfade`, not `fade` (2026-08-28): this key used to be `fade` too, which
  // silently SHADOWED the granular envelope fade five entries up — one object,
  // one key — so every granular sheet rendered the radius-fade seg where the
  // envelope fade belonged.
  // The fade pair shapes the gain across the RADIUS, for grains only, and is
  // dead in nearest mode (the bridge's `fadeOn`) — so it lives with the other
  // grain rows and hides there, like every other dead row.
  rfade:     { label: 'fade',    kind: 'seg', seg: 'radiusFadeSeg', bool: ['on', 'off'], sec: 'on grains',
               tips: ['volume fades with distance from the cursor — click for full volume out to the edge',
                      'every mark in reach at full volume — click to fade it with distance'] },
  fadeCurve: { label: 'falloff', kind: 'fadecurve', el: 'radiusFadeCurveSlider', sec: 'on grains' },
  // `xfade` and `tether` used to sit here, as an "on pins" section of the LENS
  // sheet. They are pin parameters, so on 2026-08-30 they went back to being
  // only that: Settings → Pins, beside the Blend they shape. A lens reads the
  // scratch layer; it does not touch the pins, so nothing about the pins may
  // appear on its page (Ek). The cabinet controls they drove went with the
  // mixer (2026-09-16): blend, tether, crossfade and the selected pin are the
  // pinned rail's mode bar now (js/ui-pins.js), writing the same S fields.
  efrom:    { label: 'from',    kind: 'efrom', sec: 'erase' },
  // 'erases: stroke' (#243) — the brush's contact picks WHICH strokes, then
  // the whole take goes: erase a stroke by touching it anywhere. 'touch' is
  // the classic brush that takes only what it reaches.
};

// ── WHAT EACH PARAMETER IS (Ek, 2026-09-25: "none of the params in the sheets
// have tooltips, it just says how to move the slider around. there's the
// definition part of what that thing is, then how to GUI with it") ─────────
// One sentence per parameter, in performer terms: what it does to the sound
// or to the playing, never how to operate the control. `_applyParamTips`
// puts it on the row's label, and in front of the how-to every control on
// the row already carries — so with learn on, a tooltip reads "what it is ·
// how to move it". A row with no entry here keeps its how-to alone.
const PARAM_TIPS = {
  // grain — deposit
  flow:     'how often a mark is laid down while you paint — the time between marks; slower leaves fewer, further apart',
  headW:    'how wide the painting head is — 0 lays every mark on the line you draw, wider scatters them across a band',
  gEnd:     'what a grain stroke becomes when you let go — scratch the cursor reads, or a cloud pinned on the path you drew',
  // grain — the grain
  dur:      'how long each grain lasts',
  period:   'the time between one grain and the next — shorter is denser',
  overlap:  'how many grains sound at once — duration over period',
  curve:    'the shape each grain fades in and out with — a smooth bell, a triangle, or square and instant',
  fade:     'how much of each grain is ramp — low is hard-edged, high is all fade',
  durVar:   'how much each grain\'s length varies at random, either side of the duration',
  perVar:   'how much the time between grains varies at random — steady at none, scattered at more',
  glink:    'holds duration and period together, so the density stays put while the grain size changes',
  octave:   'moves the pitch in whole octaves',
  startJit: 'how far a grain may read from its mark, either side — reaches the audio between marks and smears the timing',
  durJit:   'random spread on each grain\'s length, as a share of the duration',
  pitch:    'transposes every grain, in cents — 100 is a semitone',
  pitchJit: 'how much each grain\'s pitch wanders at random around the pitch',
  dir:      'which way a grain reads the audio — forward, backward, or a coin toss per grain',
  flt:      'sends every grain through the filter',
  ftype:    'what the filter keeps — below the cutoff, a band around it, or above it',
  cutoff:   'the filter\'s frequency',
  res:      'a resonant peak at the cutoff — more rings harder',
  fltJit:   'how far each grain\'s cutoff wanders at random, in octaves — smears the colour',
  prob:     'the chance each grain actually plays — lower thins the texture without changing its rhythm',
  pan:      'how far grains scatter around the speakers from their mark\'s direction — 0 keeps each at its point',
  vol:      'the level of this grain voice',
  // tape
  tspeed:   'playback speed — varispeed, so the pitch moves with it',
  tpitch:   'transposes the take without changing its speed, in cents',
  tstep:    'snaps speed and pitch to a grid — free, semitones, or octaves and fifths',
  decay:    'while overdubbing, how much everything already in the loop drops at each pass — 0 keeps every layer',
  treverse: 'plays the take backwards',
  tvol:     'the level of this tape voice',
  tchop:    'cuts the next take into a separate line at every attack',
  sliceMin: 'the shortest piece slice will cut — anything shorter joins its neighbour',
  passes:   'how many times a pinned loop plays before it lets itself go — ∞ stays',
  onEnd:    'what a tape stroke becomes when you let go — a line the cursor fires, or a loop pinned at once',
  dwell:    'what a line does while the cursor stays on it — plays once, loops, or plays once and then opens to the cursor\'s grains',
  gdwell:   'when walking a stroke, whether it plays once or loops while the cursor stays',
  gstart:   'where a walk starts — the stroke\'s top, where you touched it, or the nearer end',
  grelease: 'what a walk does when the cursor leaves — plays to its end, or fades',
  gretrig:  'when a stroke is touched again while it plays — on cuts the pass that is sounding, off lays a new one over it',
  tstart:   'where a fired line starts — its top, where the cursor touched it, or the nearer end',
  release:  'what a line does when the cursor leaves — plays to its end, stops, or fades',
  retrig:   'when a line fires again while it plays — on cuts the pass that is sounding, off lays a new one over it',
  rearm:    'how long after firing a line can fire again',
  // cursor
  reads:    'what the cursor plays — grains, tape lines, or both',
  radius:   'how far the cursor reaches, in degrees',
  mode:     'how the cursor gathers grain marks — everything within the radius, or the k nearest anywhere',
  depth:    'how many layers it reaches, newest first — 1 is the top stroke only, all reaches everything',
  k:        'how many of the marks in reach the cursor plays — all of them, or this many',
  step:     'the order marks are played in — picked at random, or one after another in the order they were made',
  rfade:    'fades marks with distance from the cursor\'s centre',
  fadeCurve:'how the fade falls off toward the edge of the radius — a tight centre or an even ramp',
  overdub:  'a take records into the nearest pinned loop as a layer, in time with it; nothing pinned, the first take becomes the loop',
  walk:     'a touch sets a walker going along the stroke you touched, retracing it at the pace it was painted — instead of the cursor reading what is in reach',
  audition: 'hear what the cursor reads through the live sheets instead of as it was baked — try a preset or a knob on what is already there; nothing is rewritten',
  // erase
  bystroke: 'an erase takes the whole stroke of any mark it touches, instead of only the marks in reach',
  efrom:    'which layer an erase takes first — the newest on top, or the oldest at the bottom',
};
/** Give every param row on `root` its definition: on the label, and in front
 *  of the how-to on each control of the row (a number, a track, a switch).
 *  Idempotent — the how-to is kept once in `data-how`. */
function _applyParamTips(root) {
  if (!root) return;
  const title = el => el.getAttribute('title') ?? el.getAttribute('data-title') ?? '';
  const put = (el, text) => { if (title(el) !== text) el.setAttribute('title', text); };
  for (const row of root.querySelectorAll('[data-pid]')) {
    const pid = row.dataset.pid;
    const lab = row.querySelector(':scope > .prow-n, :scope > .mrow-l');
    const word = pid => (PARAM_DEFS[pid]?.perfLabel && row.classList.contains('mrow') ? PARAM_DEFS[pid].perfLabel : PARAM_DEFS[pid]?.label) ?? pid;
    const head = pid => PARAM_TIPS[pid] ? `${lab && pid === row.dataset.pid ? lab.textContent.trim() : word(pid)} — ${PARAM_TIPS[pid]}` : '';
    if (lab && head(pid)) put(lab, head(pid));
    // A row greyed as not applying (`.ds-na`) takes the hover itself: its note
    // says why, and now says what the row is first.
    const na = row.parentElement?.classList.contains('ds-na') ? row.parentElement : null;
    if (na && head(pid)) {
      if (na.dataset.how === undefined) na.dataset.how = title(na);
      put(na, na.dataset.how ? `${head(pid)} · ${na.dataset.how}` : head(pid));
    }
    // A switch keeps its own words: they already say what it does NOW and what
    // a click changes, and the definition is on the label beside it.
    for (const c of row.querySelectorAll('[data-pval], [data-ptrack]')) {
      const own = c.dataset.pval || c.dataset.ptrack || pid;
      const h = head(own);
      if (!h) continue;
      if (c.dataset.how === undefined) c.dataset.how = title(c);
      put(c, c.dataset.how ? `${h} · ${c.dataset.how}` : h);
    }
  }
}
// (`SEC_NOTE` is gone, 2026-09-22. It put one explanatory line under a section
// heading — `reach` and `cursor behaviour` had one — and the cursor sheet lost
// its copy first. Ek then asked for the rest: "remove any of the help text from
// the other sheets (tape and grain) eraser". Both lines were read at render and
// changed with the mode, which is the trouble: prose that rewrites itself moves
// every row beneath it, so the sheet reshaped under the hand that was using it.
// A sheet is a panel of controls, not a page of writing. What the lines said is
// still said — in the tooltip on the row it is about, which is where it can be
// asked for rather than imposed.)
// ── The arrival rows: what a mark does when the cursor reaches it ──────────
// They were the lens's `on strokes` section — `cursor behaviour` since
// 2026-09-22 — which meant ONE global answer for
// every stroke on the sphere. They belong to the mark, so they belong to the
// SHAPE that made it — and once they do, two strokes in reach of the same
// cursor can answer differently, which was impossible before (Ek, 2026-09-21).
// CURSOR BEHAVIOUR, and it belongs on the SHEET (Ek, 2026-09-22: "those things
// you moved out actually they should be cursor behaviour inside the shape
// presets move them back in"). They went up to MODE for a day on the strength of
// being one shared value; being shared is not the same as being a mode, and the
// sheet already groups them under their own `sec` heading, which is where they
// read as what they are.
//
// THEY ARE GRAIN'S TOO. I claimed the opposite for a day, on a grep of grain.js
// that found only `seq.trigger` readers — but the reader is the GATE,
// `trigger.js` `_onEnter`, which spends `tp.rearmMs` and then hands the same
// `tp` to `startWalker` for a grain stroke: `start` decides where the walk
// begins and which way it runs, `dwell` whether it loops and whether it opens
// the stroke, `release` how it leaves, `retrig` cut against layer. Under the
// lens's `mode: stroke` a touch on a grain stroke launches a walker and these
// five rows ARE its behaviour — walker.js's header says so. The sheet used to
// say it too, in the `cursor behaviour` section's note; that note is gone with
// the rest of the sheets' prose (2026-09-22), so walker.js and this comment are
// where the fact lives now. A grep of one module is not a reader census.
// ── CURSOR INTERACTION — the INSTRUMENT's, not the shape's (Ek, 2026-09-22) ──
// "by definition audition should change everything in the voice presets, that's
// the rule. shape presets cant be changed cause it's already drawn. that leaves
// cursor behaviour dangling. i think cursor behaviour is something i want to
// switch on the fly like autopin and overdub."
//
// That is the test that places them. A VOICE is what audition moves; a SHAPE is
// the drawing and cannot move once made; these five are neither — they are what
// a touch DOES when it arrives, decided while you play, and nothing about them
// is baked into the mark. They spent a day on the shape sheets (2026-09-21, "a
// param lives with the TOOL it works on") and one press of MODE's own logic
// takes them off again: like autopin and overdub they are one standing answer
// per instrument, so they belong beside those, in the tab.
//
// They are NOT captured into a tile any more — they are `S.triggerParams`, which
// is where they always lived; only the sheet pretended otherwise.
const ARRIVAL_PIDS = ['dwell', 'tstart', 'release', 'retrig', 'rearm'];
// Engine → the word the player uses for it. `granular` is the engine's id;
// GRAIN is what it is called everywhere a person reads it.
const GRP_LABEL_G = { tape: 'tape', granular: 'grain', erase: 'erase', lens: 'cursor' };
const ENGINES = {
  granular: ['flow', 'headW', 'gEnd',
             // duration and period lead and take a full row each — they are
             // the two that decide what granular sounds like, and their ±
             // bands need the width to be readable (#278). `fade` (slope) is
             // the number at the end of `curve`'s row: one is the shape, the
             // other is how much of the grain that shape occupies.
             // `overlap` left as a slider (#279): it is grain ÷ period, so it is
             // a READOUT, and the scope already draws it. What was useful about
             // it is now the LINK — see _grainLink. `durJit` left too: it is
             // duration jitter as a proportion, which `dur ±` already does in
             // absolute ms, and two controls for one idea made the panel
             // arbitrary.
             'dur', 'period', 'glink', 'fade', 'curve', 'startJit',
             'durVar', 'perVar', 'pitch', 'octave', 'pitchJit', 'dir',
             'flt', 'ftype', 'cutoff', 'res', 'fltJit',
             // Output: the gate first — whether a grain sounds at all — then
             // how loud, then how wide (Ek, 2026-09-24: "prob, vol, spread").
             'prob', 'vol', 'pan'],
  tape:     ['tspeed', 'tpitch', 'tstep', 'treverse', 'tvol', 'onEnd', 'passes', 'tchop', 'sliceMin',
             'decay'],
  // The lens sheet reads as: geometry, then what touching GRAINS does, then
  // what touching a STROKE does, then the edge fade (#236). Nothing about pins:
  // that is the whole of the 2026-08-30 split.
  // `fill` is DRAWN inside k's row (2026-09-07: k and fill were one question
  // wearing two controls — 'all' is k = infinity, and the sheet drew a
  // live-looking k slider beside it that was doing nothing) but it is LISTED
  // here all the same, because this list is what a preset captures and applies,
  // not what the sheet draws. Left off it, fill was the last row of the cursor
  // that did not follow the preset — the same bug as `radius`, by omission
  // instead of by rule. The lens TAB draws it beside k (2026-09-22 night).
  // The five arrival rows LEFT the lens on 2026-09-21 (Ek: "move the lens params
  // to the shape sheets"). What is left is the two sections that are about how
  // you LOOK — the eye keeps its aperture, the mark keeps its reply.
  // THE TAB IS THE FILTER, TOP DOWN (Ek, 2026-09-23: "more mentally
  // logically top down like different layers of the filtering"). Each row
  // narrows what the one above let through: WHAT material (scope) → WHERE
  // (radius) → then, under GRAIN SELECTION, what only grains answer: HOW the
  // eye looks (mode), WHEN (depth), whether to cap (all), HOW MANY (k), IN
  // WHAT ORDER (step), and how what survives LANDS (fade; its falloff is in
  // Settings → Tools). Radius alone leads because tape fires on touch at it
  // too (trigger.js `enterRad`), so scope `tape` greys the whole block below.
  // FADE IS GRAIN'S ONLY (Ek, 2026-09-23, after trying it on tape): a take
  // plays whole and its RELEASE says how it ends; a distance fade silenced
  // every take the moment the cursor let go, overriding play-to-end.
  lens:     ['reads', 'radius', 'mode', 'depth', 'k', 'step',
             'rfade', 'fadeCurve'],
  // The erase engine shares depth with the lens (one knob, two engines).
  erase:    ['depth', 'efrom'],
};
// ── SOUND and SPACE (Ek, 2026-09-21) ──────────────────────────────────────
//
//     A tool is a SOUND and a SPACE.
//
// Ek, choosing the pair: "this is cool cause it really breaks down what this
// app is. it's sound in space. so space is all questions about how it exists
// in the space. and sound is how it sounds." The tool's anatomy and the
// instrument's own description are now the same sentence.
//
// SOUND is what it sounds like. SPACE is EVERY question about how it exists in
// the space — where it lands, how it spreads, and what it does when the cursor
// arrives at it. That last part is why the lens's five arrival rows are space
// and not a third thing: arriving at a mark is a spatial event.
//
// `head` and `voice` were the words for these until this conversation. `head`
// was wrong because a head only deposits and says nothing about being read;
// `voice` because it is the performer's own word for what he is playing.
//
// Erase has a space and no sound, which is why its three scrapes never felt
// like tools. The lens has a space and NO sound — a ruling made twice, by the
// deletion of the grain filter (#292) and of audition, both of which forced
// every candidate onto voicing 0.
//
// SWITCH_PIDS is not a third half. It names the pids that are LEAVING the
// tool: `gEnd`, `onEnd` and `passes` become the two pre-play switches — does it
// stay (keeps), and whose clock does it run on (cycle) — asked once, in the
// footer, for everything.
//
// This is CLASSIFICATION, NOT ORDER. `ENGINES` above still states the sheet's
// own order and `_sheetPids` still reads it. `_pileCheck` keeps the piles
// honest about every pid, because one added to ENGINES and not sorted here
// would otherwise go quietly missing from all of them.
const SHAPE_PIDS = {
  granular: ['flow', 'headW'],
  tape:     ['tchop', 'sliceMin', 'decay'],
  // The eye's aperture: what it reaches for, and how it chooses among what it
  // reaches. `radius` governs BOTH engines — it is also the trigger gate's own
  // reach — which is why it sits in `reach` and not in `on grains`.
  lens:     ['reads', 'radius', 'mode', 'depth', 'k', 'step', 'rfade', 'fadeCurve'],
  erase:    ['depth', 'efrom'],
};
const VOICE_PIDS = {
  // A SUB-ROW FOLLOWS ITS PARENT (Ek, 2026-09-23): taper is a property of
  // the curve, res of the cutoff, step and octave of pitch — see SUB_OF.
  granular: ['dur', 'period', 'glink', 'curve', 'fade', 'startJit', 'durVar', 'perVar',
             'pitch', 'octave', 'pitchJit', 'dir',
             'flt', 'ftype', 'cutoff', 'res', 'fltJit',
             'prob', 'vol', 'pan'],
  tape:     ['tspeed', 'tpitch', 'tstep', 'treverse', 'tvol'],
  lens:     [],   // the eye has no voice
  erase:    [],   // nor does the eraser
};
const SWITCH_PIDS = {
  granular: ['gEnd'],
  tape:     ['onEnd', 'passes'],
  lens:     [],   // the eye's arrival rows are its SHAPE — see SHAPE_PIDS.lens
  erase:    [],   // an erase asks neither question
};
/** Which pile a pid belongs to for an engine, or null. */
function roleOf(engine, pid) {
  if (SHAPE_PIDS[engine]?.includes(pid))  return 'shape';
  if (VOICE_PIDS[engine]?.includes(pid))  return 'voice';
  if (SWITCH_PIDS[engine]?.includes(pid)) return 'switch';
  return null;
}
/** The invariant: the three piles PARTITION each engine's sheet order —
 *  every pid in exactly one pile, and no pile naming a pid the engine does
 *  not have. Returns a list of complaints, empty when clean; called once at
 *  load and by the engine audit. */
function _pileCheck() {
  const bad = [];
  for (const eng of Object.keys(ENGINES)) {
    const order = ENGINES[eng];
    for (const pid of order) {
      if (!roleOf(eng, pid)) bad.push(`${eng}.${pid} is in no pile`);
    }
    for (const [name, table] of [['shape', SHAPE_PIDS], ['voice', VOICE_PIDS], ['switch', SWITCH_PIDS]]) {
      for (const pid of table[eng] ?? []) {
        if (!order.includes(pid)) bad.push(`${eng}.${pid} is in ${name} but not on the sheet`);
      }
    }
    const counts = {};
    for (const table of [SHAPE_PIDS, VOICE_PIDS, SWITCH_PIDS]) {
      for (const pid of table[eng] ?? []) counts[pid] = (counts[pid] ?? 0) + 1;
    }
    for (const [pid, n] of Object.entries(counts)) {
      if (n > 1) bad.push(`${eng}.${pid} is in ${n} piles`);
    }
  }
  return bad;
}
{
  const bad = _pileCheck();
  if (bad.length) console.warn('[tiles] the shape/voice piles are out of step with ENGINES:', bad);
}

// (`DUB_PIDS` is gone: the dub showed only its own `decay` and none of the tape
// sheet, which is exactly the "dub shape with an empty sheet" Ek asked to be rid
// of. `decay` is a row on every tape shape's sheet now.)

// ── A SHAPE'S SHEET IS ITS OWN, not its engine's (Ek, 2026-09-21: "now we're
//    splitting out sheets so that the SHAPES have their sheets per tape or
//    grain, and same with VOICE") ────────────────────────────────────────────
// Before this, every tool of an engine showed all 29 of its rows, so `plain`
// drew comb's axis and staff's two latitudes — rows that do nothing for it.
// A shape's sheet is now: what its engine gives EVERY shape, what THIS shape
// adds, and the arrival rows, which every shape has because every mark can be
// touched. The eraser has no arrival rows: an erase is over when you let go.
const SHAPE_SHARED = {
  // EVERY GRAIN SHAPE SHOWS THE SAME SHEET (Ek, 2026-09-22), the way every tape
  // shape already did: rate and width say how often and how wide. None of them
  // is one tile's private property — which is what `SHAPE_OWN` used to make
  // them, and why it is gone. (`spray` and `sort by` were the other two; both
  // were sunset the same day, so the list is down to the two that describe the
  // deposit itself rather than what answers the hand.)
  granular: ['flow', 'headW'],
  // EVERY TAPE SHAPE SHOWS THE SAME SHEET (Ek, 2026-09-21: "all the tape shape
  // sheets should be the same … i dont see slicing on loop"). A take can be cut
  // at its onsets whatever else it does, so slicing is not one shape's private
  // property — and `decay` comes with it, which is what makes overdubbing a
  // SETTING on the sheet rather than a shape with an empty one.
  tape:     ['tchop', 'sliceMin', 'decay'],
  erase:    ['depth', 'efrom'],
};
// THE ARRIVAL GROUP IS NOT A SHAPE'S (2026-09-22). It was drawn on eleven shape
// sheets and there was only ever ONE of it: set `dwell` to loop on `line` and
// `slice` read loop, and so did grain's `pen`. Two facts came out of measuring
// that, and they decide where it goes:
//
//   IT IS READ LIVE, at the moment the cursor arrives, never stamped on a mark
//   — `_applyLiveParams`' neighbour in trigger.js says so in as many words. So
//   it cannot be split per shape: one cursor, one answer.
//
//   IT IS TAPE'S. Every reader is `S.triggerParams.*`, and a trigger is a tape
//   take's gate — grain.js only consults it under `seq.trigger`. On a grain
//   shape's sheet those five rows did nothing at all; they were five of pen's
//   seven.
//
// So: out of the presets, up into MODE, and only on the tape tab. Per
// instrument, with grain's set being empty because grain has no arrival to set.
function shapeSheetPids(id) {
  const eng = engineOf(id);
  if (!eng || eng === 'lens') return ENGINES[eng] ?? [];
  // THE TOOL'S BLOCK IS ITS WHOLE BLOCK (2026-09-24): the tab's rows AND the
  // voice pids. The tool is what persists the live block across a reload
  // (`mubone_tiles`); the presets are recalls onto it, not its store.
  return [...(SHAPE_SHARED[eng] ?? []), ...(VOICE_PIDS[eng] ?? [])];   // arrival rows are the INSTRUMENT's
}
/** What a tile captures and applies: its engine's whole block. (A voice id
 *  no longer reaches here — the sheet is the ENGINE's since 2026-09-24.) */
function _sheetPids(id) { return shapeSheetPids(id); }
function engineOf(id) {
  // A voice is an object of one engine too, so its sheet, hue and accent all
  // resolve through the same call every other surface uses.
  if (_voices?.[id]) return _voices[id].engine;
  const cu = _tileCfg?.[id]?.custom;
  if (cu) return cu.engine;
  // ONE TOOL PER INSTRUMENT, and the tool's id IS its engine's (2026-09-22).
  // This has to precede the kind tests below, and it also RETIRES them for the
  // three tools: `tape`'s kind is `brush`, so falling through would have called
  // it granular. Nothing is special-cased any more — the answer is the id.
  if (id === 'tape' || id === 'granular' || id === 'erase') return id;
  if (isLensTile(id)) return 'lens';
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
// (2026-08-26), fq→hpq+lpq (2026-09-07), hpf+lpf+hpq+lpq→flt+ftype+cutoff+res
// (2026-09-23). Read old key → write new → done; no fallback.
// `fade` is TWO params — granular envelope fade on brush tiles, radius fade
// on lens tiles (a duplicate PARAM_DEFS key until 2026-08-28, when the lens
// one became `rfade`) — so that rename applies on lens tiles only.
const _PID_RENAMES = { field: 'radius', sedge: 'rfade', scurve: 'fadeCurve', korder: 'step' };
function _migratePids(bag, pick) {
  let dirty = false;
  for (const [tileId, tile] of Object.entries(bag ?? {})) {
    const m = pick(tile);
    if (!m) continue;
    for (const [o, n] of Object.entries(_PID_RENAMES)) {
      if (o in m) { m[n] = m[o]; delete m[o]; dirty = true; }
    }
    if (isLensTile(tileId) && 'fade' in m) {
      m.rfade = m.fade; delete m.fade; dirty = true;
    }
    // 2026-09-07: one Q became two. A tile that stored the shared one gets it
    // on BOTH corners, which is exactly the filter it had.
    if ('fq' in m) { m.hpq = m.hpq ?? m.fq; m.lpq = m.lpq ?? m.fq; delete m.fq; dirty = true; }
    // 2026-09-23: two corners became ONE filter. The stored values are slider
    // POSITIONS (the two cutoffs log-mapped over 0–1000, the Qs raw), so they
    // are turned into Hz first and the new cutoff back into a position; the
    // rule for which corner survives is `filterFromCorners`.
    if ('hpf' in m || 'lpf' in m || 'hpq' in m || 'lpq' in m) {
      const hz  = pos => 20 * Math.pow(1000, (+pos || 0) / 1000);
      const pos = f => Math.round(1000 * Math.log(Math.max(20, f) / 20) / Math.log(1000));
      const f = filterFromCorners(hz(m.hpf ?? 0), hz(m.lpf ?? 1000), +m.hpq || 0.707, +m.lpq || 0.707);
      m.flt = f.filterOn ? 'on' : 'off'; m.ftype = f.filterMode;
      m.cutoff = pos(f.cutoff); m.res = Math.round(f.res * 100) / 100;
      delete m.hpf; delete m.lpf; delete m.hpq; delete m.lpq; dirty = true;
    }
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
// 2026-09-22: the three survivors took their instruments' names, so the three
// ids that had been alive all along join the map. Every one of them is DEAD on
// the left by the rule above — nothing mints a `line`, a `pen` or a `scrape`
// any more — and the two older rows rechain to where their targets went:
// `splatter` → `spray` → (deleted, absorbed by grain), `pencil` → `pen` →
// `granular`. A chain is collapsed here rather than followed at read time,
// because `migrateTileId` is one lookup and a loop over it would be a fallback.
const _RENAMED_TILES = {
  line: 'tape', pen: 'granular', scrape: 'erase',
  splatter: 'granular', pencil: 'granular',
};
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
// One-shot (2026-09-18): the lens's `mode` was the seg's `off` / `on`; it is
// `area` / `nearest` / `stroke` now. Read the old word, write the new, once.
// `gwalk` was a grain SHAPE param for one hour on 2026-09-22 before the ruling
// put it in MODE, so a block minted in that window carries a key no sheet reads.
// One shot: drop it. No fallback — the flag is the instrument's now.
{ let dropped = false;
  for (const c of Object.values(_tileCfg)) if (c?.params && 'gwalk' in c.params) { delete c.params.gwalk; dropped = true; }
  if (dropped) { try { localStorage.setItem(LS_TILES, JSON.stringify(_tileCfg)); } catch (_) {} } }
{ const M = { off: 'area', on: 'nearest' }; let moved = false;
  for (const c of Object.values(_tileCfg)) { const m = c?.params?.mode; if (m in M) { c.params.mode = M[m]; moved = true; } }
  if (moved) { try { localStorage.setItem(LS_TILES, JSON.stringify(_tileCfg)); } catch (_) {} } }
// The deleted tiles' blocks go with them — see `_DROPPED_TILES`.
// `escope` became erase's MODE on 2026-09-22 — one shot, drop the stored pid.
{ let n = 0; for (const c of Object.values(_tileCfg)) if (c?.params && 'escope' in c.params) { delete c.params.escope; n++; }
  if (n) _saveTileCfg(); }
// Depth is 1 · 2 · 3 · all since 2026-09-24 — a stored deeper value lands on 3, one shot.
{ let n = 0; for (const c of Object.values(_tileCfg)) if (c?.params && +c.params.depth > 3) { c.params.depth = '3'; n++; }
  if (n) _saveTileCfg(); }
{ let n = 0; for (const id of Object.keys(_DROPPED_TILES)) if (id in _tileCfg) { delete _tileCfg[id]; n++; }
  if (n) _saveTileCfg(); }
if (_migrateTileKeys(_tileCfg) + _migratePids(_tileCfg, t => t?.params)) { _saveTileCfg(); }
const FACTORY_PARAMS = {
  // The erasers differ ONLY in these two values — that is what makes them
  // three presets of one engine rather than three modes (#287).
  all:    { depth: '0' },                      // 0 = no recency filter
  scrape: { depth: '1', efrom: 'top' },        // one layer, newest first
  bottom: { depth: '1', efrom: 'bottom' },     // one layer, oldest first
  lens:   { mode: 'area' },        // snapToggleSeg's data-mode values
  // NO `onEnd` HERE any more (2026-09-22). It was the loop family's identity
  // (#244) and it is AUTOPIN's, asked once for the instrument — a tape shape
  // that pinned it would move the MODE switch by being selected. (It was
  // already inert: `onEnd` left the shape sheet when MODE took it, and
  // `applyTileParams` only applies pids the sheet lists.)
  // The grain family's identity is the same question, and since trail went
  // (2026-09-22) every factory brush answers it the same way: paint scratch,
  // and reach for `cloud on end` on the sheet when you want the wash.
  // Persisted edits sit over these (a pen you flipped to `cloud` stays so).
  pen:      { gEnd: 'scratch' },
  // (SPRAY and INDEX carried their dialled values here for one evening. Both
  //  tiles went on 2026-09-22 with the shape-preset concept.)
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
// EMPTY since trail went (2026-09-22). Its one entry was the wash: the only
// tile that had to arrive sounding like itself, because its name was a sound
// rather than a gesture. Every other grain tile adopts the live block on first
// use, which is why this table only ever had one row.
//
// The MECHANISM is kept and the table is not: `_mintBlock` and
// `_birthFactoryBlocks` still read it, so a factory tile that must arrive
// pre-dialled is one row away. Nothing needs one today — if nothing ever does,
// this and both readers come out together.
const FACTORY_SOUND = {};

// ── A grain tile owns its whole block (Ek, 2026-09-03) ──────────────────────
// "If I see that slider in that position, it's set." Factory grain tiles used
// to carry nothing at all and keep sheet edits per session: arming pen
// applied NOTHING to the sound, so its sheet showed whatever the last tool
// had left in the live block, and a reload threw the edits away. Now a grain
// tile with no stored block ADOPTS the live block the first time it is
// applied, and its edits persist in `_tileCfg[id].params` like a custom
// tile's — from then on what its sheet shows is its own. Auditioned paint
// depends on this: its strokes follow the TOOL, so the tool has to have a
// sound to follow. The OTHER factory tiles keep their session-only edits
// (`_sessionCfg`): wide IS mode:off and scrape IS depth:1, and a persisted
// flip would leave the name on the tile lying (palette-audit § F caught exactly
// that when this was briefly every tile).
let _sessionCfg = {};   // factory non-grain tileId → { pid: value }, until reload
/** Does this tile keep its edits on disk — a custom tile, or any grain tile? */
// Tape too since 2026-09-24: its tool holds the live tape voice the way the
// grain tool holds the grain block, so a reload comes back where it was left.
function _persists(id) { const e = engineOf(id); return !!_tileCfg[id]?.custom || e === 'granular' || e === 'tape'; }

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

// ── Voices: a named block of one engine's VOICE_PIDS (2026-09-21) ─────────
// `FACTORY_SOUND` has exactly ONE entry, and that is the finding this store
// answers: every other grain tile adopted whatever was on the sliders the
// first time it was applied, so each of them carries a sound nobody chose.
// A voice is that block, named, authored on purpose and recalled by name.
//
// A shape has a GLYPH, a voice has a NAME — you can draw a gesture, you cannot
// draw a sound. So a voice row carries a dot and a word, and the rail marks the
// current one the way it marks a lens, because a voice is a CHOICE.
//
// Engine-scoped: a tape voice and a grain voice may share a name, and the two
// never mix — a voice only ever holds its own engine's VOICE_PIDS.
//
// One key, two fields: `v` the voices, `sel` which one each engine is on, so
// the rail's mark survives a reload rather than going blank beside a live
// block that IS one of them.
const LS_VOICES = 'mubone_sounds';
// One-shot: the store shipped for one day as `mubone_voices`, before `voice`
// became `sound` (Ek, 2026-09-21). Read the old key, write the new, delete the
// old — no fallback, per CLAUDE.md.
try {
  const was = localStorage.getItem('mubone_voices');
  if (was != null && localStorage.getItem(LS_VOICES) == null) localStorage.setItem(LS_VOICES, was);
  if (was != null) localStorage.removeItem('mubone_voices');
} catch (_) {}
let _voices = {};     // voiceId → { name, engine, params: {pid: value} }
let _voiceSel = {};   // engine  → voiceId
let _voiceSeq = 0;    // makes a minted id unique inside one millisecond
let _seeded = false;  // the default voices are seeded once, on the first render
try {
  const raw = JSON.parse(localStorage.getItem(LS_VOICES) || '{}') || {};
  if (raw && typeof raw === 'object' && raw.v && typeof raw.v === 'object') {
    _voices = raw.v; _voiceSel = (raw.sel && typeof raw.sel === 'object') ? raw.sel : {};
  }
} catch (_) {}
function _saveVoices() {
  try { localStorage.setItem(LS_VOICES, JSON.stringify({ v: _voices, sel: _voiceSel })); } catch (_) {}
}

// ── One voice per sounding engine, on a fresh rig (Ek, 2026-09-21: "create a
//    default tape voice and grain voice") ──────────────────────────────────
// A tool must have a voice to go on the palette, so an empty store means a rig
// you cannot place anything from. Seeded once, from the engine's own factory
// block — not from whatever is on the sliders at that moment, which is the one
// source that is not reproducible.
//
// EACH ONE IS NAMED FOR THE SOUND IT IS (Ek, 2026-09-22: "rename voice preset
// default to wash, rename line default to verbatim"). They were both called
// `default`, which said only that nobody had named them — and a rail of presets
// where the first entry of each engine reads `default` teaches nothing about
// what it will sound like. TAPE's is VERBATIM: the take played as recorded, at
// speed, unshifted, which is what its factory block is. GRAIN's is WASH: the
// factory grain block heard as a cloud. `wash` is also a tile id, but that tile
// reads `trail` to the player, so no two things on screen share the word.
//
// THEN ONE MORE EACH (Ek, 2026-09-22: "create a new voice preset that is reverse
// and pitched down and call it something, create a new voice preset that is
// glitchy"). Both words land on ONE engine's controls and not the other's, which
// is what decided where each goes: reverse and pitch are `treverse` and `tpitch`,
// TAPE voice pids, so UNDERTOW is a tape voice — the take pulled backwards an
// octave down. Glitch is made of grain sizes and jitter, so GLITCH is a grain
// voice: grains too short to be notes, read from anywhere near their mark, on a
// clock that will not sit still, and not every one of them fires.
//
// A voice with a `sound` is DIALLED and then captured, in display units through
// each numbox's own `fromDisplay` — the same idiom as FACTORY_SOUND, never a
// second copy of the log curves. The live block is put back afterwards, because
// a seed must not leave the instrument dialled to the last preset it wrote.
const VOICE_SEED = {
  tape: [
    { name: 'verbatim' },                       // the block as the rig boots
    { name: 'undertow', sound: { treverse: 'on', tpitch: '-1200' } },
  ],
  granular: [
    // FILTER OFF, said outright (Ek, 2026-09-24: "by default the presets
    // should have filter off") — the engine's default already is, but a seed
    // that takes "the block as the rig boots" inherits whatever a rig was
    // left on, and this one is not left to inheritance.
    { name: 'wash', sound: { flt: 'off' } },
    // Short and hard-edged (a 10% fade is almost a square window, which is the
    // click), the read point thrown a long way from the mark, and duration and
    // period both wobbling — so no two grains are the same length or land on
    // the beat. `prob` at 70% is the dropout: the stutter comes from the grains
    // that never fire.
    { name: 'glitch', sound: { dur: '22ms', period: '11ms', fade: '10%',
                               startJit: '900ms', durVar: '16ms', perVar: '20ms',
                               pan: '40%', prob: '70%', flt: 'off' } },
  ],
};
// BY NAME, NOT ALL-OR-NOTHING (2026-09-22). The seed used to be one boolean:
// written once, and skipped entirely for any engine that already had a voice —
// so a rig that had booted before could never receive a factory voice added
// later, which is exactly what `undertow` and `glitch` are. It tops up by NAME
// instead, under a stamp: a spec whose name is already on that engine is left
// alone, whatever it has been tuned to since, and only the stamp moving can add
// anything. A voice you delete stays deleted until the stamp changes again.
const LS_VOICE_SEED = 'mubone_voice_seed';
const VOICE_SEED_STAMP = '2026-09-22';
function _seedVoices() {
  let done = null;
  try { done = localStorage.getItem(LS_VOICE_SEED); } catch (_) {}
  if (done === VOICE_SEED_STAMP) return;
  const capture = eng => {
    const params = {};
    for (const pid of VOICE_PIDS[eng] ?? []) {
      const v = _readParam(pid);
      if (v !== undefined) params[pid] = v;
    }
    return params;
  };
  for (const eng of ['tape', 'granular']) {
    const have = new Set(voicesOf(eng).map(id => _voices[id]?.name));
    const want = (VOICE_SEED[eng] ?? []).filter(spec => !have.has(spec.name));
    if (!want.length) continue;
    const base = capture(eng);                  // the block as this rig booted
    for (const spec of want) {
      if (spec.sound) {
        for (const [pid, v] of Object.entries(spec.sound)) {
          if (PARAM_DEFS[pid]?.kind === 'slider') _paramTypeSet(pid, v); else _applyParam(pid, v);
        }
      }
      const id = 'v' + Date.now().toString(36) + (_voiceSeq++).toString(36);
      // `factory`: seeded here, and so never deletable (2026-09-24).
      _voices[id] = { name: spec.name, engine: eng, factory: true, params: spec.sound ? capture(eng) : { ...base } };
      // The FIRST of each engine is the one the rig starts on — and only if
      // nothing is selected, so a top-up never moves a rig off its own choice.
      if (!_voiceSel[eng]) _voiceSel[eng] = id;
      if (spec.sound) for (const [pid, v] of Object.entries(base)) _applyParam(pid, v);
    }
  }
  _saveVoices();
  try { localStorage.setItem(LS_VOICE_SEED, VOICE_SEED_STAMP); } catch (_) {}
}
// One shot, for a rig seeded before the names existed: a voice STILL called
// `default` is one nobody has named, so it takes its engine's name. Stamped, so
// a voice a player deliberately calls `default` later is theirs and stays.
const LS_VOICE_NAMES = 'mubone_voice_names';
{
  let done = null;
  try { done = localStorage.getItem(LS_VOICE_NAMES); } catch (_) {}
  if (done !== '2026-09-22') {
    let n = 0;
    for (const v of Object.values(_voices)) {
      const want = VOICE_SEED[v?.engine]?.[0]?.name;
      if (v?.name === 'default' && want) { v.name = want; n++; }
    }
    if (n) _saveVoices();
    try { localStorage.setItem(LS_VOICE_NAMES, '2026-09-22'); } catch (_) {}
  }
}
// One shot (Ek, 2026-09-24: "by default the presets should have filter off"):
// every stored GRAIN voice has its filter switched off. The 09-23 corner
// migration turned a voice's filter ON wherever a low-pass had been set at all,
// which made the filter a default rather than a choice. Type, cutoff and
// resonance are kept — the switch is one press to bring a voice's filter back.
const LS_VOICE_FILTER = 'mubone_voice_filter';
{
  let done = null;
  try { done = localStorage.getItem(LS_VOICE_FILTER); } catch (_) {}
  if (done !== '2026-09-24') {
    let n = 0;
    for (const v of Object.values(_voices)) {
      if (v?.engine === 'granular' && v.params && v.params.flt !== 'off') { v.params.flt = 'off'; n++; }
    }
    if (n) _saveVoices();
    try { localStorage.setItem(LS_VOICE_FILTER, '2026-09-24'); } catch (_) {}
  }
}
// One shot (2026-09-24): a preset seeded before the flag existed is a factory
// preset by its NAME — the seed's own names, on the seed's own engines.
const LS_VOICE_FACTORY = 'mubone_voice_factory';
{
  let done = null;
  try { done = localStorage.getItem(LS_VOICE_FACTORY); } catch (_) {}
  if (done !== '2026-09-24') {
    let n = 0;
    for (const v of Object.values(_voices)) {
      if (!v || v.factory) continue;
      if ((VOICE_SEED[v.engine] ?? []).some(spec => spec.name === v.name)) { v.factory = true; n++; }
    }
    if (n) _saveVoices();
    try { localStorage.setItem(LS_VOICE_FACTORY, '2026-09-24'); } catch (_) {}
  }
}
S._seedVoices = _seedVoices;

/** The voices of one engine, oldest first — the order they were minted in,
 *  which is the order the rail lists them. */
export function voicesOf(engine) {
  return Object.keys(_voices).filter(id => _voices[id]?.engine === engine);
}
export function voiceName(id) { return _voices[id]?.name ?? ''; }
/** A preset's few numbers, for its rail row: tape is how it plays the take —
 *  reversed or not, speed, pitch in semitones; grain is its grain — duration
 *  and period. Read from the STORED block through the numbox's own display
 *  (S._sliderDisplay), never a second copy of the log curves. */
function _voiceSummary(vid) {
  const v = _voices[vid]; if (!v?.params) return '';
  const p = v.params;
  if (v.engine === 'tape') {
    const sp = +p.tspeed, ct = +p.tpitch;
    const st = Number.isFinite(ct) ? Math.round(ct / 10) / 10 : 0;
    return [p.treverse === 'on' ? 'reverse' : null,
            Number.isFinite(sp) ? `${+sp.toFixed(2)}\u00d7` : null,
            `${st > 0 ? '+' : st < 0 ? '\u2212' : ''}${Math.abs(st)} st`].filter(Boolean).join(' \u00b7 ');
  }
  if (v.engine === 'granular') {
    // The numbox shows two decimals for editing; a summary rounds (22.07ms → 22ms).
    const tidy = t => t && String(t).replace(/(\d+(?:\.\d+)?)\s*ms/, (_, n) => `${+n >= 10 ? Math.round(+n) : (+n).toFixed(1)}ms`);
    const d = tidy(S._sliderDisplay?.('gcDurSlider', p.dur)), per = tidy(S._sliderDisplay?.('gcPeriodSlider', p.period));
    return d && per ? `${d} \u00b7 ${per}` : '';
  }
  return '';
}
function _voiceSummaryKey(engine) { return engine === 'tape' ? 'direction, speed, pitch' : 'duration, period'; }
export function isVoiceId(id) { return !!_voices[id]; }
/** The voice this engine is on, or null. */
export function currentVoice(engine) {
  const id = _voiceSel[engine];
  return id && _voices[id] ? id : null;
}

/** Mint a voice from the LIVE block of one engine — what is on the sliders
 *  now, which is the only honest source: it is what you have been listening
 *  to. Named `voice N` for the first N not in use, by the same rule as a
 *  custom tool's name, and selected, because you minted it to use it. */
export function mintVoice(engine) {
  const pids = VOICE_PIDS[engine]; if (!pids?.length) return null;
  const params = {};
  for (const pid of pids) {
    const v = _readParam(pid);
    if (v !== undefined) params[pid] = v;
  }
  const taken = new Set(Object.values(_voices).map(v => v?.name));
  let n = voicesOf(engine).length + 1;
  while (taken.has('voice ' + n)) n++;
  // A COUNTER, not the clock alone: three mints inside one millisecond all
  // produced the same id and overwrote each other — seen on the first boot
  // of this store, which is exactly the bug a timestamp id always has.
  const id = 'v' + Date.now().toString(36) + (_voiceSeq++).toString(36);
  _voices[id] = { name: 'voice ' + n, engine, params };
  _voiceSel[engine] = id;
  _saveVoices();
  return id;
}

/** Take a voice — write its params onto the live block, exactly as a tile's
 *  press re-applies its own (applyTileParams). The live-block poll is quieted
 *  for the same reason it is there: these writes are a RECALL, not a hand
 *  edit of whatever tile the sheet happens to be showing, and without this
 *  they would be captured straight into it. */
/** Write a voice's numbers onto the live block and nothing else — no
 *  selection, no save, no render. This is what a PRESS uses: it is in the
 *  audio path's way and must do the least possible. */
function _applyVoiceParams(id) {
  const v = _voices[id]; if (!v) return false;
  _pollQuietUntil = performance.now() + 400;
  for (const [pid, val] of Object.entries(v.params)) {
    if (VOICE_PIDS[v.engine]?.includes(pid)) _applyParam(pid, val);
  }
  return true;
}
/** Has the engine's live block moved off this preset? String compare on the
 *  same reads capture stores, so a recall reads equal and any edit reads
 *  different. ~20 reads, at render. */
function _voiceEdited(vid) {
  const v = _voices[vid]; if (!v) return false;
  for (const pid of VOICE_PIDS[v.engine] ?? []) {
    if (!(pid in v.params)) continue;
    const live = _readParam(pid);
    if (live !== undefined && String(live) !== String(v.params[pid])) return true;
  }
  return false;
}
/** The word the hand tile writes under the tool: the preset's name while
 *  the live block is that preset, the name and an asterisk once it has moved
 *  off it — the DAW convention for "this preset, changed" (Ek, 2026-09-25:
 *  "usually i just screw with one or two settings it's still mostly from a
 *  preset like Wash") — and nothing when the engine has no preset at all.
 *  Audition says the same words: the headphones on the cursor already say it
 *  is a trial, and the name says what the trial started from. */
function _voiceWord(vid) { return voiceName(vid) + (_voiceEdited(vid) ? '*' : ''); }
function _handVoiceWord(vid) {
  if (!vid) return null;
  return _voiceWord(vid);
}
// ── AUDITION opens the drawer (Ek, 2026-09-24 night) ─────────────────────
// "audition should open the drawer automatically, and it stays open even if
// I turn off audition so it's a manual escape." Every door — the cursor row,
// the A key, a pedal, `/audition` — comes through here. ON opens the voice
// sheet of the engine last PLAYED (the tab you are on if nothing has played
// yet, the press hand's engine failing that), tab and drawer together; OFF
// leaves the drawer where it is.
let _lastPlayedEng = null;
// THE AUDITION VOICE (Ek, 2026-09-24: "when audition is on, instead of custom
// it should be an audition voice that is temporarily activated, and when i
// turn audition off, it goes back to what it was before"). ON takes a snapshot
// of BOTH engines' voice — every voice pid, and which preset each was on — and
// the sheets become a scratch copy: anything goes, presets can be tried on,
// nothing is saved (captureTileParams). OFF puts the snapshot back, sliders and
// preset marks. To KEEP an audition sound: `+` saves it as a preset, or a pin
// freezes it; both happen before the revert and survive it. The hand tile
// names the scratch the same way as the real voice — `wash`, `wash*` — since
// 2026-09-25; the headphones are the audition's sign, not a word.
let _auditionSnap = null;
// A/B (Ek, 2026-09-24: "if i turn back audition will it remember the last
// audition params? so i can a b a b"). OFF keeps the scratch voice before it
// restores the real one, and the next ON puts the scratch back — so audition
// is a compare button: each press flips between the sound you had and the
// one you are trying. Session only: a relaunch starts the scratch from the
// real sound again.
let _auditionScratch = null;
function _snapVoices() {
  const snap = {};
  for (const eng of ['tape', 'granular']) {
    const params = {};
    for (const pid of VOICE_PIDS[eng] ?? []) { const v = _readParam(pid); if (v !== undefined) params[pid] = v; }
    snap[eng] = { params, sel: _voiceSel[eng] ?? null };
  }
  // Tape's numbers straight from state as well: OSC, MIDI and the sensor
  // mappings write `S.triggerParams` directly and only then sync the sliders,
  // so the sliders alone can miss what the pedal is really set to.
  const tp = S.triggerParams;
  snap.tapeState = { speed: tp.speed, pitch: tp.pitch, step: tp.step, reverse: tp.reverse, volume: tp.volume };
  return snap;
}
function _restoreVoices(snap, save = true) {
  _pollQuietUntil = performance.now() + 400;      // a restore is not an edit
  for (const eng of ['tape', 'granular']) {
    const e = snap?.[eng]; if (!e) continue;
    for (const [pid, v] of Object.entries(e.params)) _applyParam(pid, v);
    if (e.sel && _voices[e.sel]) _voiceSel[eng] = e.sel; else delete _voiceSel[eng];
  }
  if (snap?.tapeState) { Object.assign(S.triggerParams, snap.tapeState); S._syncTriggerUI?.(); }
  if (save) _saveVoices();          // the scratch's marks are never saved
}
function setAudition(on) {
  on = !!on;
  const was = S.auditionMode;
  if (on && !was) {
    _auditionSnap = _snapVoices();
    if (_auditionScratch) _restoreVoices(_auditionScratch, false);   // B again
  }
  S.auditionMode = on;
  if (!on && was && _auditionSnap) {
    _auditionScratch = _snapVoices();                                 // remember B
    _restoreVoices(_auditionSnap);
    _auditionSnap = null;
    render();
    // The panel handlers coalesce their writes; redraw once they have landed.
    setTimeout(() => { if (propsOpen()) renderProps(); _refreshVoiceMarks(); S._drawEngineScope?.(); }, 90);
    return;
  }
  if (on && !was) {
    const eng = _lastPlayedEng
      ?? ((_instr === 'tape' || _instr === 'granular') ? _instr : null)
      ?? engineOf(handTool('press'))
      ?? 'granular';
    if (VOICE_PIDS[eng]?.length) { setInstrument(eng); openProps(eng, 'engine'); return; }
  }
  render(); if (propsOpen()) renderProps();
}
/** Repaint the last-recalled preset row's ON, and the hand tiles' word, from
 *  live state without a render: capture's debounce calls it after every edit.
 *  The row is on only while the live block IS the preset. */
function _refreshVoiceMarks() {
  document.querySelectorAll('#toolRail [data-voice]').forEach(row => {
    const vid = row.dataset.voice, v = _voices[vid];
    if (!v || currentVoice(v.engine) !== vid) return;
    const edited = _voiceEdited(vid);
    row.classList.toggle('edited', edited);
    row.classList.add('on');
    row.setAttribute('aria-pressed', 'true');
    const nm = row.querySelector('.tile-nm'), word = _voiceWord(vid);
    if (nm && nm.textContent !== word) nm.textContent = word;
  });
  document.querySelectorAll('#paletteDock .tile--hand[data-eng]').forEach(tile => {
    const eng = tile.dataset.eng; if (!eng) return;
    const word = _handVoiceWord(currentVoice(eng)) ?? '';
    const el = tile.querySelector('.tile-nm-voice');
    if (el && el.textContent !== word) el.textContent = word;
  });
}
export function applyVoice(id) {
  const v = _voices[id]; if (!v) return false;
  _applyVoiceParams(id);
  _voiceSel[v.engine] = id;
  // Not saved while auditioning: the pick is the scratch voice's, and the
  // revert puts the real one back (setAudition). A quit mid-audition must not
  // wake up marked on a preset the sliders are not on.
  if (!S.auditionMode) _saveVoices();
  // The recall lands in the TOOL's block too, so a reload comes back on it:
  // the poll is quiet during a recall (by design), so nothing else would.
  setTimeout(() => captureTileParams(v.engine), 120);
  // AND THE RAIL REDRAWS. `_voiceSel` is what marks the chosen voice row, and
  // the hand tile names the voice its side holds — both are `render`'s, and
  // this only scheduled `renderProps`, which is the SHEET. It never showed
  // because the row's click used to call `openProps` too, and that rendered;
  // the door took that over on 2026-09-22 and the mark stopped following
  // (Ek: "the sound changes as i expect but the voice preset doesnt show
  // glitch selected it's stuck on wash"). Every caller wants it — a voice
  // taken from OSC or a binding marks its row the same way.
  render();
  // Same 90 ms beat applyTileParams uses: the panel handlers coalesce their
  // S writes, so a sheet redrawn now would show the values one recall behind.
  setTimeout(() => { if (propsOpen()) renderProps(); }, 90);
  return true;
}

export function renameVoice(id, label) {
  const v = _voices[id]; if (!v) return false;
  if (v.factory) return false;                     // a factory preset keeps its name (Ek, 2026-09-24)
  const name = String(label).trim().slice(0, 24);
  if (!name || name === v.name) return false;
  v.name = name; _saveVoices();
  render();
  return true;
}

/** Delete a voice. What was painted with it is unaffected: a pinned stroke
 *  holds the copy it took at the pin, and the live block keeps the values —
 *  deleting a voice removes the NAME, never what you can hear. */
export function deleteVoice(id) {
  if (!_voices[id]) return false;
  if (_voices[id].factory) return false;           // a factory preset stays (Ek, 2026-09-24)
  const eng = _voices[id].engine;
  if (voicesOf(eng).length <= 1) return false;     // the last one stays
  delete _voices[id];
  // The mark moves to the first remaining preset WITHOUT recalling it — the
  // voice keeps sounding as it is, and the row shows the ring if it differs.
  if (_voiceSel[eng] === id) _voiceSel[eng] = voicesOf(eng)[0];
  _saveVoices();
  render();
  return true;
}

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
    case 'gseg':     return S.grainTrigger?.[d.path];
    case 'efrom':    return S.eraseOldest ? 'bottom' : 'top';
    case 'reads':    return S.lensReads ?? 'both';
    case 'fx': case 'tp': return String(_pStore(d)?.[d.path]);
    case 'onend':    return S.triggerParams.loopOnEnd ? 'loop' : 'arm';
    case 'treverse': return S.triggerParams.reverse ? 'on' : 'off';
    case 'tstep':    return S.triggerParams.step ?? 'free';
    case 'gend':     return _GEND_OF[S.traceMode] ?? 'scratch';
    case 'seg': {
      const seg = document.getElementById(d.seg);
      const b = seg?.querySelector('button.active');
      if (!b) return undefined;
      const attr = Object.keys(b.dataset)[0];
      return attr ? b.dataset[attr] : undefined;
    }
    default: {
      const el = document.getElementById(d.el);
      return el ? String(el.value) : undefined;
    }
  }
}

function _applyParam(pid, v) {
  const d = PARAM_DEFS[pid];
  if (!d || v === undefined) return;
  switch (d.kind) {
    case 'flow':     S.paintTicker = S.paintTicker || {}; S.paintTicker.intervalMs = +v || 50; return;
    case 'head':     try { const [w, e] = JSON.parse(v); S.headWidthDeg = +w || 0; S.headEdge = e === 'hard' ? 'hard' : 'soft'; } catch (_) {} return;
    case 'gseg':     if (S.grainTrigger) S.grainTrigger[d.path] = v; return;
    case 'efrom':    S.eraseOldest = v === 'bottom'; return;
    case 'reads':    S.lensReads = ['both', 'grains', 'tape'].includes(v) ? v : 'both'; return;
    case 'fx': case 'tp': { const o = _pStore(d); if (o && isFinite(+v)) o[d.path] = d.q ? d.q(+v) : +v; return; }
    case 'onend':    S.triggerParams.loopOnEnd = v === 'loop'; return;
    case 'treverse': S.triggerParams.reverse = v === 'on'; return;
    case 'tstep':    S.triggerParams.step = TAPE_STEPS.includes(v) ? v : 'free'; return;
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
      if (pid === 'radius') {
        // THROUGH THE NUMBOX, NOT THE SLIDER (2026-09-22). The radius slider's
        // own `input` handler is throttled 50 ms (ui-presets, to a MIDI pot's
        // rate) and applies whatever the slider reads WHEN IT FIRES. Every seg
        // pid applied after this one — `mode`, `fill`, `step`, `rfade` —
        // calls updatePlaybackControls → drawRadiusViz, which re-syncs the
        // slider FROM `S.searchRadiusDeg`, still the old degrees because the
        // throttle has not run yet. So selecting a cursor preset set the
        // slider to its radius, three seg clicks wrote the OLD radius back
        // over it, and the throttle then re-applied the old one: the preset's
        // reach was the only row that never arrived. A trap on the slider's
        // `value` setter caught the sequence — 10, then 44, 44, 44.
        // `radiusVal`'s `change` handler is applyRadius, which writes S, the
        // slider and the numbox in ONE synchronous step, so there is no window
        // in which something can read a stale S and undo this.
        const num = document.getElementById(d.num);
        if (num) {
          num.value = String(v);
          num.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
      if (String(el.value) !== String(v)) {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }
}

// (`GLOBAL_PIDS` is gone, 2026-09-22. It held exactly one pid — `radius` — on
// the 2026-08-27 ruling that reach is the cursor's and not any one lens's, so
// it was neither captured into a preset nor applied from one. Ek overturned it:
// "if wide is 31, and i create a new preset narrow that's 5 degree radius, it
// should switch the radius when i switch the preset." A preset that does not
// carry its own reach is not a preset of the cursor, it is a preset of four of
// the cursor's nine rows. Every row on the sheet now belongs to the tile whose
// sheet it is — no exceptions, which is why the set itself went rather than
// being emptied.)

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
  for (const pid of _sheetPids(id)) {
    if (pid in saved) _applyParam(pid, saved[pid]);
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
// One debounce PER TILE: a single shared timer let a capture into one tool
// cancel a pending capture into another (the live-block poll can edit tape
// and grain in the same tick).
const _capTimers = {};

function captureTileParams(explicitId) {
  const id = typeof explicitId === 'string' ? explicitId : sheetTileId();
  // Mid-stroke re-freezing is NOT done here any more. It belongs to the paint
  // ticker, which re-resolves before every deposit — that catches a gesture
  // sweeping a param, which never touches a control this capture would see.
  const eng = engineOf(id);
  if (!eng) return;
  clearTimeout(_capTimers[id]);
  _capTimers[id] = setTimeout(() => {
    const params = {};
    for (const pid of _sheetPids(id)) {
      const v = _readParam(pid);
      if (v !== undefined) params[pid] = v;
    }
    // Never into a preset (2026-09-24): an edit is the ENGINE's, stored under
    // its TOOL. The preset it was last set from stays as saved, and its row
    // shows the ring until it is pressed again.
    // NOTHING IS SAVED WHILE AUDITIONING (2026-09-24): the sheet is a scratch
    // copy then, and a quit mid-audition must come back to the sound you had.
    if (S.auditionMode) { _refreshVoiceMarks(); return; }
    if (_persists(id)) { _tileCfg[id] = { ...(_tileCfg[id] ?? {}), params }; _saveTileCfg(); }
    else _sessionCfg[id] = params;
    _refreshVoiceMarks();
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
// THE REST OF EACH TOOL'S SHEET (2026-09-25). The grain block below is only
// the SOUND half of the grain sheet; the tape sheet, and grain's rate and
// width, were never compared, so a pot, OSC or a sensor moving tape speed was
// never saved into the tape tool and a reload or a voice recall put it back.
// Each tool's sheet is read as the capture would read it, and a change is an
// edit of that tool.
const _sheetSig = { tape: null, granular: null };
function _pollSheets(quiet) {
  for (const id of ['tape', 'granular']) {
    const sig = _sheetPids(id).map(_readParam).join('|');
    const was = _sheetSig[id];
    _sheetSig[id] = sig;
    if (!quiet && was != null && sig !== was) captureTileParams(id);
  }
}
function _pollLiveBlock() {
  _pollSheets(performance.now() < _pollQuietUntil);
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
  // Into the GRAIN TOOL, whatever the sheet shows (2026-09-24): the tool is
  // the live block's store, and a pot moving the grain engine is an edit of
  // it whether or not its sheet is up.
  captureTileParams('granular');
}

/** The cursor section's live number, repainted at 5 Hz while the rail is up.
 *  Text writes only — no layout read, nothing the grain scheduler can
 *  feel. The values come from the scheduler's own tick (grain.js, perf.kPool
 *  / perf.kCount), which runs whether or not the gesture is down: aim the
 *  cursor and the row says what it WOULD read before you play it.
 *
 *  `hot` is the whole point of the pair (Ek): taken === k means the ceiling
 *  is what is limiting the cursor, not the material — which is the one thing
 *  a ceiling has to be able to tell you. */
export function refreshLensLive() {
  if (!_propsOn) return;
  const bar = document.getElementById('cursorPanel');
  const kEl = bar && bar.querySelector('[data-klive]');
  if (!kEl) return;
  const k    = S.grainOverrides.k ?? gp().k;
  const all  = k === 0;
  const live = perf.kPool > 0;
  // Uncapped, the pair would be a lie — there is nothing to saturate against
  // — so the row says the one true number and what it is.
  const txt  = !live ? '—' : `${perf.kPool} → ${perf.kCount}`;
  if (kEl.textContent !== txt) kEl.textContent = txt;
  kEl.title = all
    ? 'grain marks in reach → firing — k is all, so every one fires'
    : `grain marks in reach → taken — lit when k (${k}) is what is limiting the cursor`;
  kEl.classList.toggle('hot', live && !all && perf.kCount >= k);
}

// ── AUDITIONED PAINT — the concept that replaced wet (Ek, 2026-09-22) ──────
// There is no per-tool switch any more. Paint made while AUDITIONING follows its
// numbers for as long as it exists; paint made by PLAYING freezes at the stroke,
// and the pin is where it freezes. The mechanism and the argument are one file
// over, in brush-voicing.js "Auditioned paint".
const _AUTOPIN = { granular: { pid: 'gEnd', on: 'cloud', off: 'scratch' }, tape: { pid: 'onEnd', on: 'loop', off: 'arm' } };
/** Does a stroke of THIS instrument pin itself when you let go? */
export function autoPinOn(engine) {
  const a = _AUTOPIN[engine]; if (!a) return false;
  return _readParam(a.pid) === a.on;
}
export function setAutoPin(engine, on) {
  const a = _AUTOPIN[engine]; if (!a) return false;
  _applyParam(a.pid, on ? a.on : a.off);
  render();
  if (propsOpen()) renderProps();
  return !!on;
}
/** OVERDUB — the word for what it is (Ek: "instead of calling cycle, we just
 *  call it what it is, overdub on or off"). On, a tape take joins the nearest
 *  pinned loop at the phase you played it; off, it runs on its own clock. */
export function overdubOn() { return !!S.overdub; }
export function setOverdub(on) { S.overdub = !!on; render(); return S.overdub; }

function _tileParam(id, pid) {
  const s = _sessionCfg[id]?.[pid]; if (s !== undefined) return s;
  const p = _persists(id) ? _tileCfg[id]?.params?.[pid] : undefined; if (p !== undefined) return p;
  return FACTORY_PARAMS[id]?.[pid];
}
// DUB is pinned by nature (Ek, 2026-09-12, night: "the overdub one tool is
// special … it technically works with pinned items only. add the pin
// sticker to the tile"): its take joins the nearest pinned loop, or seeds
// one — there is no unpinned outcome — so it wears the mark always and the
// mark is not a switch on it.
/** The tile in the HAND — the position that is PLAYING, and null between
 *  presses (2026-09-11: nothing is held when nothing sounds). This is what a
 *  stroke freezes from and what auditioned paint follows. Every stroke starts from a
 *  position press, so it is never null while one is running. */
function handTileId() { return _held?.id ?? null; }

function _numFor(def) {
  if (def.num) return def.num;
  return def.el ? def.el.replace('Slider', 'Num') : null;
}
function _rowFor(pid, omit) {
  const d = PARAM_DEFS[pid];
  if (!d) return '';
  if (d.kind === 'gseg') {
    const cur = S.grainTrigger?.[d.path];
    const seg = d.opts.map(([v, l]) => {
      // A `gseg` draws words unless its def names an icon set — the same
      // opt-in `_segRowAuto` has, so one param's marks live in one table
      // whichever renderer reaches them. The word stays as the tooltip.
      const ico = d.icons ? _segIcon(d.icons, v) : null;
      return `<span class="${cur === v ? 'on' : ''}${ico ? ' seg-ico' : ''}"` +
        ` data-gseg="${d.path}" data-val="${v}" title="${l}">` +
        (ico ? `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ico}</svg>` : l) +
        `</span>`;
    }).join('');
    return `<span class="opt"><i>${d.label}</i><span class="seg">${seg}</span></span>`;
  }
  if (d.kind === 'flow')     return _flowRow();
  if (d.kind === 'head')     return _headRows();
  if (d.kind === 'tstep') {
    const seg = [['free', 'speed and pitch move freely'], ['semi', 'snap both to semitones'],
                 ['oct5', 'snap both to octaves and fifths']].map(([v, t]) =>
      `<span class="${(S.triggerParams.step ?? 'free') === v ? 'on' : ''}" data-tstep="${v}" title="${t}">${v === 'oct5' ? 'oct+5th' : v}</span>`).join('');
    return `<span class="opt"><i>step</i><span class="seg">${seg}</span></span>`;
  }
  // SCOPE wears the engines' own glyphs (Ek, 2026-09-23): `grains` and `tape`
  // ARE the two instruments, so their tabs' marks say it; `both` stays a word.
  if (d.kind === 'reads') {
    const seg = [['both', 'grains and tape', null], ['grains', 'grains only — tape strokes do not fire', G.dots],
                 ['tape', 'tape only — no granulation under the cursor', G.line]].map(([v, t, ico]) =>
      `<span class="${S.lensReads === v ? 'on' : ''}${ico ? ' seg-ico' : ''}" data-reads="${v}" title="${t}">` +
      (ico ? `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ico}</svg>` : v) + `</span>`).join('');
    return `<span class="opt"><i>${d.label}</i><span class="seg">${seg}</span></span>`;
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
  if (d.kind === 'seg') return _segRowAuto(d.label, d.seg, omit, d.words);
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
// The stroked-glyph attributes these icons share — one weight, one cap, so a
// row of them reads as one set rather than as several hands.
const _ST = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
const SEG_ICONS = {
  snapToggleSeg: {
    off: () => MODE_G.area,
    on:  () => MODE_G.nearest,
  },
  lensStepSeg: {
    off: () => '<path d="M3 7h4l10 10h4M3 17h4l10-10h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 4.5L21 7l-2.5 2.5M18.5 14.5L21 17l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    on:  () => '<path d="M3 19h5v-5h5V9h5V4h3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>',
  },
  radiusFadeSeg: {
    on:  () => '<path d="M3 18L21 6v12z"/>',
    off: () => '<rect x="3" y="9" width="18" height="6" rx="1"/>',
  },
  // ── CURSOR INTERACTION (Ek, 2026-09-22: "turn the cursor behaviour into
  //    icons to save space, using a pill select design") ───────────────────
  // Each one draws what the WORD said, so the row reads at arm's length: the
  // label stays at the left and the three marks replace three words.
  // DWELL IS COUNTED, NOT DESCRIBED (Ek, 2026-09-22: "for once, use 1, for
  // loop, use infiniti sign, for grain, use the grain glyph"). The first two
  // drawings were pictures OF the behaviour — an arrow into a wall, a pair of
  // repeat arrows — and both had to be interpreted. The question dwell asks is
  // HOW MANY TIMES, and that question has two symbols every reader already
  // owns: `1` and `∞`. They are the answer rather than an illustration of it,
  // and the third is the grain glyph itself, which was already right.
  // Drawn as paths, not characters: every mark in this table is a path in a
  // 24 box, and one `<text>` would be a second mechanism for one glyph.
  trigDwellSeg: {
    // one pass — the numeral, flag and base, on the kit's stroke.
    // Stem on 12, not 12.7: MEASURED, the first cut put the glyph's box at
    // 9.4–16.0, a centre of 12.7 in a 24 box — 0.7 right of every other mark
    // in the row. The flag hangs to the LEFT of a numeral's stem, so centring
    // the stem is not centring the glyph; the box is what had to move.
    oneshot: () => `<path d="M8.9 9.3 12 6.8V17.4" ${_ST}/><path d="M8.7 17.4h6.6" ${_ST}/>`,
    // round and round — a lemniscate, two 2.9 lobes crossing at the centre.
    // Lobes of 3.4, not 2.9: MEASURED against the two it stands beside, the
    // smaller lemniscate was 5.8 tall against the `1`'s 10.6 and the dots' 16,
    // and read as the runt of the row. 3.4 puts it at 6.8 over 15.6 — an ∞ is
    // a wide flat mark and forcing it to cap height would bloat it, so it
    // moves toward the set rather than onto it.
    loop:    () => `<path d="M12 12c-1.5-2.2-2.7-3.4-4.4-3.4a3.4 3.4 0 1 0 0 6.8` +
                   `c1.7 0 2.9-1.2 4.4-3.4s2.7-3.4 4.4-3.4a3.4 3.4 0 1 1 0 6.8` +
                   `c-1.7 0-2.9-1.2-4.4-3.4z" ${_ST}/>`,
    // the stroke's own dots: it plays through and then OPENS into grains.
    grain:   () => G.dots,
  },
  trigStartSeg: {
    // the head of the stroke, and off it runs.
    top:   () => `<path d="M5 6v12" ${_ST}/><path d="M9 12h9M15 8l4 4-4 4" ${_ST}/>`,
    // wherever you touched it — the mark under the cursor, and off from there.
    touch: () => `<circle cx="6" cy="12" r="2.4"/><path d="M11 12h8M16 8l4 4-4 4" ${_ST}/>`,
    // the tail, running backwards: the turntable rule, drawn.
    ends:  () => `<path d="M19 6v12" ${_ST}/><path d="M15 12H6M10 8l-4 4 4 4" ${_ST}/>`,
  },
  trigReleaseSeg: {
    // ▶ into a wall: the pass finishes on its own terms.
    'play-to-end': () => `<path d="M7 6l8 6-8 6z"/><path d="M19 6v12" ${_ST}/>`,
    // the ramp down — the same wedge the radius fade wears, the other way up.
    fade:          () => '<path d="M3 6v12h18z"/>',
  },
  trigRetrigSeg: {
    // the line, cut through.
    cut:   () => `<path d="M4 12h6M14 12h6" ${_ST}/><path d="M12 5v14" ${_ST}/>`,
    // one pass laid over the one still ringing.
    layer: () => '<rect x="3.5" y="7" width="13" height="4" rx="1.4"/>' +
                 '<rect x="7.5" y="13" width="13" height="4" rx="1.4"/>',
  },
};
const _segIcon = (segId, val) => SEG_ICONS[segId]?.[val]?.() ?? null;

/** A CURSOR INTERACTION row: MODE's row model — label left, control flush
 *  right — carrying THE ENGINE SHEET'S OWN PILL (Ek, 2026-09-22: "there's
 *  already a design from the grain engine sheet for multi select pills use
 *  that"). That is `.opt .seg`, which `_segRowAuto` already builds and which
 *  already reaches `SEG_ICONS`, so the glyphs come through it rather than from
 *  a second drawing of the same control. The row's `--c` is the instrument's
 *  hue, which is what tints the chosen chip — the amber in a grain sheet.
 *
 *  The pill's own caps label is hidden in the rail (`.opt > i`), exactly as the
 *  engine sheet hides it under `.prow--seg`: `.mrow-l` names the row, in MODE's
 *  type, so the two sections read as one column. */
/** Options an instrument does not offer. `dwell: grain` plays the take once and
 *  then opens its material to the granular cursor — which a GRAIN stroke
 *  already is, so on the grain tab it names the thing it is made of (Ek,
 *  2026-09-22: "grain should not be an option for dwell in the grain tab").
 *  TAPE keeps it: there it is the one thing that turns a take into a cloud. */
const SEG_OMIT = { granular: { dwell: ['grain'] } };
function _cursorSegRow(pid, hue, eng = _instr) {
  const d = PARAM_DEFS[pid];
  const row = _rowFor(pid, SEG_OMIT[eng]?.[pid]);
  if (!row) return '';
  return `<div class="mrow" style="--c:${hue}"><span class="mrow-l">${d.label}</span>${row}</div>`;
}

// _segRow without knowing the data attribute — segs name theirs differently
// (data-dwell, data-curve, data-kall …); auto-detect from the first button.
// WORDS OR GLYPHS (Ek, 2026-09-22: "that looks better, go back to words for
// dwell and retrig"). A glyph earns its place when the thing it names is a
// SHAPE — a gesture, a direction, an envelope. `once | loop` and `cut | layer`
// are neither: they are two words each, already short, and the drawing had to
// be learned before it could be read. Grain's own arrival rows have said them
// in words since they were built an hour ago, which is what made the
// difference visible side by side. `words` is opt-IN per param rather than a
// change to `_segIcon`, because the icon table still serves `start`, whose
// three options ARE directions, and the lens's own segs.
function _segRowAuto(label, segId, omit, words) {
  const seg = document.getElementById(segId);
  if (!seg) return '';
  let btns = [...seg.querySelectorAll('button')];
  if (!btns.length) return '';
  const attr = Object.keys(btns[0].dataset)[0];
  if (!attr) return '';
  // Options this surface does not offer (SEG_OMIT). The cabinet keeps them —
  // the value is one global and another tab may still set it — so this hides a
  // CHOICE, never the state behind it.
  if (omit?.length) {
    const kept = btns.filter(b => !omit.includes(b.dataset[attr]));
    if (kept.length) btns = kept;
  }
  return `<span class="opt"><i>${label}</i><span class="seg">` +
    btns.map(b => {
      const ico = words ? null : _segIcon(segId, b.dataset[attr]);
      return `<span class="${b.classList.contains('active') ? 'on' : ''}${ico ? ' seg-ico' : ''}"` +
        // The cabinet button's own title where it has one (`hann — smooth
        // bell curve`), not its text: a glyph repeated as its own tooltip
        // said nothing (ui-learn has moved it to data-title by now).
        ` data-proxy="${segId}" data-val="${b.dataset[attr]}" title="${esc(b.dataset.title ?? b.title ?? b.textContent.trim())}">` +
        (ico ? `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ico}</svg>` : b.textContent) + `</span>`;
    }).join('') +
    `</span></span>`;
}

// ── Options bar — the selected tile's settings, write-through ───────────────


const READS = {
  radius:  () => `${S.searchRadiusDeg}°`,
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

// (`_extrasFor` is gone, 2026-09-22. It was the per-tool footnote under a
// sheet's rows: `slice`, `spray`, `match` and `staff` had one, `spot` had one,
// and one of them pointed at a source file — the clearest sign of who they were
// written for. Ek: "remove any of the help text from the other sheets (tape and
// grain) eraser". Nothing replaced it, so the function held only comments and
// a `return ''`. Two controls left it earlier and for the same reason: naming
// and retiring a tool are on the RAIL ROW (#284), because the row IS the tool
// and neither gesture should need a sheet open.)
function _noteFor(id) {
  const t = TILE_DEFS[id];
  if (t?.kind === 'edit') {
    return id === 'all' ? 'everything the cursor reaches — depth forced off for the hold'
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

/** THE PAGE A STRIP TILE OPENS (2026-09-22). A tool's page is its INSTRUMENT'S
 *  tab — one tool per instrument, so the tab is the tool's own page and it
 *  carries the performance rows, the shape sheet and the voices with it. The
 *  lens has no tab since 2026-09-23 — its rows are the rail's CURSOR section,
 *  always shown — so its tile only opens the rail.
 *
 *  It OPENS the rail as well as pointing it: a click that switched a tab behind
 *  a closed rail would look like nothing happening, which is the failure mode
 *  the dwell pills already cost a day. */
function openTilePage(id) {
  const instr = instrOf(id);
  if (instr && _instruments().some(i => i.id === instr)) setInstrument(instr);
  if (!propsOpen()) setPropsOpen(true); else { render(); renderProps(); }
}

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
  // Ask the CLASS, not `propsOpen()`: `closeProps` drops `prail-open` and
  // leaves `_propsOn` set, so the other never sees a shut drawer.
  const showing = document.body.classList.contains('prail-open') && _propRow === id;
  if (showing) { closeProps(); return; }
  openProps(id, kind);
}

// The drawer carried the position's verb segment from 2026-09-11 to
// 2026-09-12. The verb is the PLACEMENT's, and the right-click on the strip
// tile is its one control now (Ek: "it doesn't need to be on the master tile
// drawer sheet"); the drawer is the TOOL's — the block every placement of that
// tool plays.

// ── NEVER REBUILD THE SHEET UNDER A HELD POINTER (2026-09-24) ──────────────
// The filter dot did not stick: a quarter second into the FIRST drag on a
// tile, captureTileParams saw the tile go off-factory and called render(),
// whose tail is renderProps() — the whole sheet re-rendered, the canvas under
// the pointer was replaced by a fresh one (grab = false, no capture), and the
// rest of the drag went to an element that had never seen the press. The row
// tracks capture the pointer the same way and died the same way. Proved with
// a real mouse over the bridge: `sameCanvas` false 500 ms after the down.
// So a rebuild that arrives while the sheet holds a pointer WAITS for the
// release — the values it would draw are the live ones the drag is writing,
// so nothing is lost by drawing them a moment later.
let _sheetHeld = false, _propsPending = false;
function _sheetRelease(e) {
  if (!_sheetHeld) return;
  // Only the WINDOW's blur is a release edge. A capture listener on the
  // window sees every element's blur too, and typing a value fires a
  // synthetic one on the cabinet numbox (_paramTypeSet) — mid-drag.
  if (e?.type === 'blur' && e.target !== window) return;
  _sheetHeld = false;
  if (_propsPending) { _propsPending = false; if (_propsOn) renderProps(); }
}
export function renderProps() {
  const sheet = document.getElementById('propRail');
  if (!sheet) return;
  if (_sheetHeld) { _propsPending = true; return; }
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
  // Whatever the drawer is pointed at — the one answer, see sheetTileId.
  const id = sheetTileId();
  // THE LENS HAS NO SHEET (2026-09-22 night): every one of its rows is on its
  // tab, and a drawer repeating them would be the same number in two places
  // (#251). NOR HAS A TOOL (Ek, the same night: "when i open up grains and
  // press the voice presets it still shows the old shape sheet. i thought we
  // sunsetted that"). The SHAPE SHEET was `SHAPE_SHARED`'s rows — rate and
  // width, slice · min slice · dub decay, depth and from — and every one of
  // them is on the instrument's tab or on Settings → Tools now, so the sheet
  // was drawing the tab's rows a second time under a stale title. The only
  // sheet left is a VOICE's: the sound, every number of it. The head stays so
  // a drawer left open says where it is pointed, and where the rows went.
  // …AND NO HEAD EITHER (Ek, 2026-09-23): a drawer pointed at a tool or the
  // lens shuts. The class is dropped here without render(), which would call
  // back into this function.
  if (_optSel.kind === 'lens' || _optSel.kind === 'tool') {
    sheet.innerHTML = '';
    document.body.classList.remove('prail-open');
    _propRow = null;
    return;
  }
  // THE SHEET IS THE ENGINE'S VOICE (Ek, 2026-09-24: "a preset changes the
  // controls of an existing global set of controls … make it more like an
  // actual preset"). It is headed by the instrument, not by a preset's name.
  const meta = _optSel.kind === 'engine'
    ? { id, label: GRP_LABEL_G[id] ?? id, c: null }
    : tileById(id);
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
  for (const pid of (_optSel.kind === 'engine' ? VOICE_PIDS[eng] ?? [] : _sheetPids(id))) {
    const d = PARAM_DEFS[pid];
    if (!d) continue;
    // (The lens's greying — nearest bypasses radius, depth and the fade pair;
    //  a lens reading only tape has no `on grains` — moved to the lens TAB with
    //  its rows, 2026-09-22 night: `lensNA` in render().)
    // (The line that dropped the lens's own `cursor behaviour` rows stood here
    // until 2026-09-22. The five arrival rows left the lens for the shape
    // sheets on 2026-09-21, so `ENGINES.lens` has not named one since and the
    // condition could never be true.)
    // The eraser borrows `depth` from the lens, so it would borrow the section
    // name with it. Its reach is in time only, and `reach` is what that is.
    const secName = (eng === 'erase' && d.sec === 'on grains') ? 'reach' : (d.sec ?? '');
    if (!cur || cur.name !== secName) { cur = { name: secName, pids: [] }; sections.push(cur); }
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
  const WIDE = new Set(['dur', 'period', 'pitch', 'cutoff', 'vol']);
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
    return `<div class="prow prow--seg prow--segwide" data-pid="octave"><span class="prow-n">octave</span>` +
      `<div class="ds-chips"><span class="opt"><span class="seg seg-pill" data-octsel>${opts}` +
      `</span></span></div></div>`;
  };

  // (`kRow`, `radiusRow` and `modeRow` — the lens sheet's own three rows, with
  //  the live pair — went to the lens TAB on 2026-09-22 night: `perfRow` and
  //  `refreshLensLive`.)

  // ── Booleans wear the SWITCH (Ek, 2026-09-07) ───────────────────────────
  // "there's a bunch of on and off simple toggles. there's already a nice
  // toggle design, the engine sheet should use that if it is on and off."
  // INSTRUMENT-GUI § 3 already assigns the shape — "do you want it? set and
  // forget → switch" — and its one instance, a grain brush's drop, is gone.
  // These four ask the same question and were wearing `on | off` segments,
  // which is the shape for "WHICH one?" and made a yes/no look like a mode
  // pick. `on end`'s `arm | loop` was the worst of them: `arm` named the
  // absence of the thing (Ek: "arm is confusing. it's more like loop on end?
  // yes or no"), so the row is now `loop on end` with a switch.
  const swBtn = (on, attrs, title) =>
    `<button type="button" class="ds-sw${on ? ' on' : ''}" role="switch"` +
    ` aria-checked="${on}"${attrs}${title ? ` title="${title}"` : ''}>` +
    `<i class="mu-switch"><b></b></i></button>`;
  const swRow = (label, on, attrs, title) =>
    `<div class="prow prow--sw"><span class="prow-n">${label}</span>${swBtn(on, attrs, title)}</div>`;
  // THE FILTER'S SWITCH IS ON ITS HEADING (Ek, 2026-09-24: "the filter toggle
  // should be on the filter title like a section on off"). The whole section
  // is the thing the switch turns on, so the switch sits where the section is
  // named — the same `data-swproxy` write-through as a row's switch.
  const filterHead = () =>
    `<div class="ds-sec-h ds-sec-h--sw"><span>filter</span>` +
    swBtn(_readParam('flt') === 'on', ' data-swproxy="gcFilterOnSeg" data-swon="on" data-swoff="off"',
      'on — every grain goes through the filter drawn below; off — grains play unfiltered') + `</div>`;

  // (`cellOrNA` — a row in ash when the state cannot use it — went with the
  //  lens sheet, 2026-09-22 night; the greying lives on the lens TAB now and
  //  no other sheet has a row that goes dead.)
  // Every row shape opens with `class="prow`, so one replacement indents any
  // of them when the pid is a sub-row.
  const cell = pid => {
    let h = cellRaw(pid);
    // Every row names its pid, so `_applyParamTips` can put the definition on
    // its label — the switch rows (`swRow`) were drawn without one.
    if (h && !/^<div[^>]*data-pid=/.test(h)) h = h.replace('<div class="prow', `<div data-pid="${pid}" class="prow`);
    return SUB_OF[pid] && h ? h.replace('class="prow', 'class="prow prow--sub') : h;
  };
  const cellRaw = pid => {
    if (pid === 'glink')  return swRow('link', _grainLink.on, ' data-sw="glink"',
      _grainLink.on ? `linked — period follows duration at ${_grainLink.ratio.toFixed(2)}\u00d7`
                    : 'free — duration and period move on their own');
    if (pid === 'octave') return octaveRow();
    if (pid === 'gEnd')   return swRow('cloud on end', _GEND_OF[S.traceMode] === 'cloud', ' data-sw="gend"',
      'on — the stroke is pinned as a moving cloud on the path you drew, and keeps playing; off — it stays scratch, read only by the cursor');
    if (pid === 'onEnd')  return swRow('loop', !!S.triggerParams.loopOnEnd, ' data-sw="onend"',
      'on — the stroke loops when it ends; off — it is armed, and the cursor fires it');
    if (pid === 'treverse') return swRow('reverse', !!S.triggerParams.reverse, ' data-sw="treverse"',
      !!S.triggerParams.reverse ? 'on — the take plays backwards; baked into the stroke when it ends' : 'off — the take plays forwards');
    if (pid === 'rfade')  return swRow('fade', !!S.radiusFadeEnabled, ' data-swproxy="radiusFadeSeg" data-swon="on" data-swoff="off"',
      'volume fades with distance from the cursor');
    if (pid === 'tchop')  return swRow('slice', !!S.triggerParams.sliceOn, ' data-swproxy="trigChopSeg" data-swon="on" data-swoff="off"',
      'on — the next take is cut into a trigger per ATTACK, measured against the room\'s own floor; off — it stays one take');
    if (pid === 'flt')    return '';                     // on the FILTER heading — filterHead()
    if (pid === 'fade')   return '';                     // the number on the CURVE row — see below
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
      return `<div class="${cls}" data-pid="${pid}"><span class="prow-n">${d.label}</span>${kn}` +
        (mateRow ? `<span class="prow-n prow-n--mate">${PARAM_DEFS[mate].label}</span>` +
                   `<div class="ds-chips">${mateRow}</div>` : '') + tail + `</div>`;
    }
    const row = _rowFor(pid);
    if (!row) return '';
    // THE CURVE ROW ENDS IN ITS SLOPE (Ek, 2026-09-24: "move it on the same
    // line as curve, remove the slider … we just need the percent on the
    // right side"). The shape is the choice, the slope is how much of the
    // grain that shape occupies — one line. The number is the same `.prow-v`
    // cell every track ends in, so it scrubs, types and double-click resets
    // through the one wiring; it simply has no track in front of it.
    const tail = pid === 'curve' && _knobRange('fade')
      ? `<input class="prow-v" data-pval="fade" value="${_knobVal('fade').disp}" spellcheck="false"` +
        ` aria-label="slope" data-word="slope" title="drag to set · click and type a value · double-click to reset">`
      : '';
    return `<div class="prow prow--seg" data-pid="${pid}"><span class="prow-n">${d.label}</span>` +
      `<div class="ds-chips">${row}</div>${tail}</div>`;
  };

  // (A grain brush's head carried its WET switch from 2026-09-03 — the one
  // "do you want it?" boolean in the instrument, so it is the kit's switch
  // shape (docs/INSTRUMENT-GUI.md § 3), built here for the first time. It
  // was a property of the brush, saved with the tile, and every stroke
  // this brush paints keeps following these rows; dry, and each stroke
  // freezes the rows as they were when it was painted. Switching it off
  // dries the strokes it already painted, where they sound.
  // It became a deposit row in 2026-09-10, and left altogether on 2026-09-22.)
  // THE ONLY SHEET IS A VOICE'S (2026-09-22 night), so `del` deletes the
  // voice. The one refusal: the last voice of an engine stays, so the
  // instrument always has a sound; the word says so rather than vanishing.
  // (The head's `del` went 2026-09-24 with the preset's name: the sheet is
  //  the instrument's, and a preset is deleted on its own row in the tab.)
  sheet.innerHTML =
    `<div class="ds-head"><b style="color:${accent}">${meta.label}</b>` +
    // What the subject IS, not just which engine it belongs to: a shape says
    // its engine, a voice says whose voice it is. Both halves of a tool now
    // have sheets, so the head has to tell them apart.
    // A TOOL'S HEAD SAYS `shape`, NOT `grain shape` (2026-09-22). The subtitle
    // named the engine because the title used to be a preset — `dots`, `line`,
    // `scrape top` — and a preset name does not say whose it is. The tool is
    // named for its instrument now, so the engine was being said twice in one
    // row: `grain · grain shape`. A voice still names its engine, because a
    // voice's title is its own name and carries no engine at all.
    `<span>voice</span>` +
    `<button type="button" class="ds-close" title="hide properties (Esc)"><kbd>esc</kbd>✕</button></div>` +
    // The drawer is WIDE and SHORT where the page flip was tall, so the
    // sections column-pack instead of stacking (#249): granular's six
    // sections stacked scrolled 692px inside a 332px drawer, which is worse
    // than the page it replaced. .ds-body carries the columns.
    // The granular engine's FILTER section is a drawing, not four rows.
    (isGrainEng
      ? `<div class="eng-scope"><canvas id="engScope" data-accent="${accent}"></canvas></div>`
      : '') +
    `<div class="ds-body">` +
    sections.map(sc => {
      if (isGrainEng && sc.name === 'filter') {
        // OFF IS COLLAPSED (Ek, 2026-09-24: "when the filter is off, also
        // collapse the section"): the heading and its switch are the whole
        // section until the switch is on. The switch's click reaches
        // `render()`, which redraws the drawer, so the section opens and
        // shuts on the press with nothing else to wire.
        if (_readParam('flt') !== 'on') return `<div class="ds-sec ds-sec--shut">${filterHead()}</div>`;
        // The drawing answers "what shape is this"; the rows answer "what
        // exactly, and let me type it". Both, not either — the graph is the
        // fastest way to grab an edge and the worst way to set 4.2k (#283).
        // The old text caption under the canvas said the same four numbers the
        // rows now say, so it is gone.
        return `<div class="ds-sec">${filterHead()}` +
          `<canvas id="engFilter" data-accent="${accent}" title="drag across for the cutoff · up and down for the resonance · double-click resets"></canvas>` +
          `<div class="ds-sec-cells">${sc.pids.map(cell).join('')}</div></div>`;
      }
      // EVERY SECTION IS OPEN (Ek, 2026-09-22: "dont make experimental a
      // dropdown in the grain shape sheet"). `experimental` alone started
      // folded, on the reasoning that it is a long tail of tuning constants
      // nobody opens in a session (#283) — but a section that hides itself is
      // the only section on the sheet you have to learn a gesture to read, and
      // the sheet's own contract is one line per parameter. Its six rows belong
      // to spray, comb and staff, which are tools you pick like any other.
      // A section note only where the rows cannot say it themselves: that the
      // radius governs both engines, and that the `cursor behaviour` family reaches
      // grains only in stroke mode.
      return `<div class="ds-sec">` +
        `<div class="ds-sec-h">${sc.name}</div>` +
        `<div class="ds-sec-cells">${sc.pids.map(cell).join('')}</div></div>`;
    }).join('') +
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
  const nameIn = sheet.querySelector('[data-rename]');
  if (nameIn) {
    const commit = () => renameCustomTile(id, nameIn.value);
    nameIn.addEventListener('change', commit);
    nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); nameIn.blur(); } });
    // The rail listens for typing keys as tool shortcuts; a name field must
    // swallow them or naming a tile arms a different one mid-word.
    nameIn.addEventListener('keydown', e => e.stopPropagation());
  }
  sheet.querySelector('.ds-close')?.addEventListener('click', () => setPropsOpen(false));
  _wireOptions(sheet);
  _wireKnobs(sheet);
  _applyParamTips(sheet);
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
  if (d.kind === 'fx' || d.kind === 'tp') { const o = _pStore(d); if (o) o[d.path] = d.q ? d.q(raw) : raw; return; }
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

// `cutoff ±` joined 2026-09-24 (Ek: "use the same method of randomisation
// like in dur and per where it's the same slider") — one row, its band.
const VAR_OF = { dur: 'durVar', period: 'perVar', pitch: 'pitchJit', cutoff: 'fltJit' };
// ── A SUB-ROW: a parameter OF another parameter (Ek, 2026-09-23) ──────────
// "step is part of pitch … taper is part of curve, it should be under curve
// firstly, then indented." The tab already had the shape — dwell and retrig
// under walk (`mrow--sub`) — so the sheet wears the same one: the row sits
// directly under its parent in VOICE_PIDS, its NAME steps in one step of the
// scale and a step quieter, the control stays flush. Nothing here changes a
// pid, a binding or a stored block; it is the sheet's reading order alone.
const SUB_OF = { tstep: 'tpitch', octave: 'pitch', res: 'cutoff' };
const IS_VAR = new Set(Object.values(VAR_OF));
// The other way: a spread's base row, which is the row that DRAWS it.
const OWNER_OF = Object.fromEntries(Object.entries(VAR_OF).map(([k, v]) => [v, k]));

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
      ` value="${vv.disp}" spellcheck="false" aria-label="${PARAM_DEFS[vpid].label}" data-word="${PARAM_DEFS[vpid].label}"` +
      ` title="drag to set · click and type a value · double-click for none">`;
  }
  // (A row at a do-nothing default — full probability, no jitter — used to
  //  draw at 40 % opacity. Gone 2026-09-24: it read as a lighter track, not
  //  as a meaning, and the rule is never dim to mean anything.)
  return `<span class="prow-t" data-ptrack="${pid}"` +
    ` title="drag to set${resetTip}${vpid ? ' · drag the band\'s edge, or the ± cell at the end of the row, for the spread' : ''}">` +
    `<i class="prow-f" style="width:${(f * 100).toFixed(1)}%"></i>${band}${tick}` +
    `<i class="prow-h" style="left:${(f * 100).toFixed(1)}%"></i></span>` +
    `<input class="prow-v" data-pval="${pid}" value="${disp}" spellcheck="false"` +
    ` aria-label="${d.label}" title="drag to set · click and type a value, Enter to keep it · double-click to reset">` + spreadCell;
}
function _wireKnobs(sheet, capId) {
  // `capId` names the tile a knob captures into, as `_wireOptions` takes it —
  // the tab's rows belong to the TOOL while the sheet shows its voice.
  const capture = () => captureTileParams(capId ? capId() : undefined);
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
    capture();
  };

  // ── THE BAND'S EDGE SETS THE SPREAD (Ek, 2026-09-23) ─────────────────────
  // "i want to be able to drag the jitter still" — and no modifier is free:
  // shift is the fine drag, ⌥ the viz lock, and a modifier gesture is
  // invisible besides. So the track is the two-thumb range every DAW draws —
  // Bitwig's modulation ring, Sampler's zone edges, Max's rslider: grab the
  // HANDLE and the value moves, grab the BAND'S EDGE and the spread widens or
  // narrows, symmetric about the handle, the ± cell following. At zero spread
  // the band has no edge, so a fixed zone just outside the handle always
  // means "the edge": reach past the handle and pull outward and the band
  // opens from nothing. The pointer says which it is over — `col-resize` on
  // an edge, the track's own `ew-resize` elsewhere — the same cursor the
  // sample slot's handles wear.
  const EDGE_PX = 7, HANDLE_PX = 3, BAND_MAX = 0.45;   // BAND_MAX: _knobFor's 45 %
  const edgeAt = (tr, pid, x) => {
    const vpid = VAR_OF[pid]; if (!vpid) return null;
    const vr = _knobRange(vpid); if (!vr) return null;
    const r = tr.getBoundingClientRect(), rg = _knobRange(pid);
    const hx = r.left + r.width * Math.max(0, Math.min(1, (_knobVal(pid).raw - rg.min) / (rg.max - rg.min || 1)));
    const vf = Math.max(0, Math.min(1, (_knobVal(vpid).raw - vr.min) / (vr.max - vr.min || 1)));
    const half = vf * BAND_MAX * r.width, d = Math.abs(x - hx);
    if (d <= HANDLE_PX) return null;                   // the handle is the value
    if (Math.abs(d - half) > EDGE_PX) return null;     // not on an edge
    return { vpid, vr, hx, width: r.width };
  };
  sheet.querySelectorAll('[data-ptrack]').forEach(tr => {
    const pid = tr.dataset.ptrack;
    const rg = _knobRange(pid); if (!rg) return;
    // Shift = fine drag. A track is ~170px for a full range, so a param with
    // a wide span moves in coarse jumps at 1:1; holding shift scales the
    // movement to a quarter of it, anchored where the shift-drag began (#272).
    let fineFrom = null, edge = null;
    const fromX = e => {
      const r = tr.getBoundingClientRect();
      let f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      if (e.shiftKey) {
        if (fineFrom === null) fineFrom = { x: e.clientX, f: (_knobVal(pid).raw - rg.min) / (rg.max - rg.min || 1) };
        f = Math.max(0, Math.min(1, fineFrom.f + ((e.clientX - fineFrom.x) / r.width) * 0.25));
      } else fineFrom = null;
      apply(pid, rg.min + f * (rg.max - rg.min));
    };
    // The spread from the pointer's distance to the handle, the inverse of the
    // band _knobFor draws; shift is the same quarter-speed, anchored likewise.
    const spreadFromX = e => {
      let vf = Math.abs(e.clientX - edge.hx) / (BAND_MAX * edge.width);
      if (e.shiftKey) {
        if (fineFrom === null) fineFrom = { d: Math.abs(e.clientX - edge.hx), vf: (_knobVal(edge.vpid).raw - edge.vr.min) / (edge.vr.max - edge.vr.min || 1) };
        vf = fineFrom.vf + ((Math.abs(e.clientX - edge.hx) - fineFrom.d) / (BAND_MAX * edge.width)) * 0.25;
      } else fineFrom = null;
      vf = Math.max(0, Math.min(1, vf));
      apply(edge.vpid, edge.vr.min + vf * (edge.vr.max - edge.vr.min));
    };
    tr.addEventListener('pointerdown', e => {
      if (e.detail > 1) return;              // let dblclick own the reset
      try { tr.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      edge = edgeAt(tr, pid, e.clientX);
      if (edge) spreadFromX(e); else fromX(e);
    });
    tr.addEventListener('pointermove', e => {
      if (e.buttons) { if (edge) spreadFromX(e); else fromX(e); return; }
      tr.style.cursor = edgeAt(tr, pid, e.clientX) ? 'col-resize' : '';
    });
    tr.addEventListener('pointerleave', () => { tr.style.cursor = ''; });
    tr.addEventListener('pointerup', () => { edge = null; fineFrom = null; });
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
  // Press and drag it to set the value; click without moving to type over it;
  // double-click to reset. That is the number field of every DAW (Ableton,
  // Logic) and of Photoshop's scrubby values, and it is how the ± SPREAD is
  // set since 2026-09-06 (Ek): the spread used to be ALT-drag on the track,
  // and ⌥ is the cursor lock (events.js), so the two fought over one key. The
  // gesture was invisible besides — this cell is on screen at the end of its
  // row, with a resize cursor, and the band follows as it moves.
  //
  // THE CLICK SELECTS THE NUMBER (2026-09-23, Ek). A click used to put a bare
  // caret wherever the pointer landed, so typing a value meant finding the
  // digits, selecting them by hand around the unit, and only then typing —
  // "really finicky". Blender, Figma and Photoshop's scrubby fields all open
  // the edit with the value selected so the next keystroke replaces it; here
  // the selection is the DIGITS ONLY, so the unit stays on screen as the
  // reminder of what is being typed ("120 ms" → type "80" → "80 ms"; the
  // parser strips the unit either way). The sign and a kilo suffix go WITH
  // the digits — "+42¢" is one number, and "2.5k" typed over as "500" must
  // read 500 Hz, not 500k. A click on a cell ALREADY being edited places the
  // caret, as it does everywhere else — the select-all is the way in, not a
  // trap. It is done on `click`, not `pointerup`: the mouseup default action
  // collapses a selection made before it.
  const SCRUB_PX = 200;                      // one full range per this much travel
  const selectNumber = inp => {
    const m = /[+-]?\d+(?:\.\d+)?k?/.exec(inp.value);
    if (m) inp.setSelectionRange(m.index, m.index + m[0].length);
    else inp.select();
  };
  sheet.querySelectorAll('input[data-pval]').forEach(inp => {
    const pid = inp.dataset.pval;
    const rg = _knobRange(pid);
    if (!rg) return;
    let from = null, moved = false, wasEditing = false;
    inp.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.detail > 1) return;   // let dblclick own the reset
      wasEditing = document.activeElement === inp;
      from = { x: e.clientX, raw: _knobVal(pid).raw };
      moved = false;
      _scrubStart();
      try { inp.setPointerCapture(e.pointerId); } catch (_) {}
    });
    inp.addEventListener('click', e => {
      if (e.detail > 1 || moved || wasEditing) return;
      if (document.activeElement !== inp) inp.focus();
      selectNumber(inp);
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
      _scrubEnd();
    };
    inp.addEventListener('pointerup', endScrub);
    inp.addEventListener('pointercancel', endScrub);
    inp.addEventListener('lostpointercapture', () => { if (_scrubbing) { from = null; _scrubEnd(); } });
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
        capture();
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

  // (The caption under the drawing — duration · taper | period apart ·
  //  overlap · window — went 2026-09-24 (Ek: "no need to have the text
  //  readout, any of it"): every number it said is a row directly below.)
}
S._drawEngineScope = () => { _drawScope(); _drawFilter(); };

// ── The filter, drawn (#261; ONE filter since 2026-09-23) ──────────────────
// Sliders describe a shape you then have to imagine, so the shape IS the
// control: drag across for the cutoff, up and down for the resonance. This is
// the one place the horizontal-track default is broken, because here the
// curve is the parameter — everything else in the engine is genuinely
// one-dimensional and a picture would add nothing. Jitter draws as a band
// around the curve rather than a fourth control: it is a smear on the shape.
// THE CURVE IS THE REAL RESPONSE, not a sketch of one: the old drawing was a
// Butterworth that drooped to 70 % at 20 Hz and 20 kHz while the engine
// bypassed there, and a hand-made Q bump that left the canvas at Q ≈ 2 and
// drew the same flat top for every Q above it. This evaluates the SVF's own
// transfer function at the prewarped frequency, on a dB axis with a fixed
// ceiling, so bypass draws flat, a peak reads true, and nothing can leave
// the box. `_resQ` is the worklet's curve (`_computeSVF`) — the two must
// agree, which is why both are written from FILTER_Q_FLAT / FILTER_Q_PEAK.
const _FILT_PIDS = { cut: 'cutoff', res: 'res', jit: 'fltJit' };
function _filtVal(k) { return _dispNum(_FILT_PIDS[k]); }
const _resQ = r => FILTER_Q_FLAT * Math.pow(FILTER_Q_PEAK / FILTER_Q_FLAT, Math.max(0, Math.min(1, r)));
const _FILT_DB_TOP = 24, _FILT_DB_BOT = -36;   // the axis; +20 dB is the loudest peak
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
  // THE GRAPH IS THE SHAPE, THE SWITCH IS THE SWITCH (Ek, 2026-09-24). Off
  // used to draw flat — honest about what the grains hear, but dragging the
  // dot along a flat line "doesn't work … stuck flat" while the rows moved.
  // Serum and Ableton's filter displays keep drawing the set curve with the
  // module off; the switch row says whether it is applied.
  const mode = _readParam('ftype') ?? 'lp';
  const fc   = Math.max(20, Math.min(20000, _filtVal('cut') || 1000));
  const res  = _filtVal('res') / 100;            // the row shows a percent
  const jit  = _filtVal('jit') / 100;            // ±octaves, as the worklet reads it
  const sr   = S.audioCtx?.sampleRate ?? 48000;
  const LO = Math.log10(20), HI = Math.log10(20000);
  const X = f => ((Math.log10(f) - LO) / (HI - LO)) * w;
  // |H| of the trapezoidal SVF at f for a cutoff fcc: the analogue prototype
  // at the prewarped frequency, which is exact for a bilinear filter.
  const k = 1 / _resQ(res);
  const mag = (f, fcc) => {
    const g = Math.tan(Math.PI * Math.min(fcc, sr * 0.45) / sr);
    const x = Math.tan(Math.PI * Math.min(f, sr * 0.499) / sr) / g;
    const den = Math.hypot(1 - x * x, k * x);
    return mode === 'lp' ? 1 / den : mode === 'bp' ? k * x / den : x * x / den;
  };
  const Y = m => {
    const db = Math.max(_FILT_DB_BOT, Math.min(_FILT_DB_TOP, 20 * Math.log10(Math.max(1e-6, m))));
    return 4 + (1 - (db - _FILT_DB_BOT) / (_FILT_DB_TOP - _FILT_DB_BOT)) * (h - 8);
  };
  c.strokeStyle = 'rgba(255,255,255,0.06)';
  for (const f of [100, 1000, 10000]) { c.beginPath(); c.moveTo(X(f), 0); c.lineTo(X(f), h); c.stroke(); }
  c.beginPath(); c.moveTo(0, Y(1)); c.lineTo(w, Y(1)); c.stroke();   // unity
  const path = (fcc, back) => {
    for (let i = 0; i <= w; i += 2) {
      const x = back ? w - i : i;
      const f = Math.pow(10, LO + (x / w) * (HI - LO));
      const y = Y(mag(f, fcc));
      (i === 0 && !back) ? c.moveTo(x, y) : c.lineTo(x, y);
    }
  };
  if (jit > 0) {
    // The band is where the cutoff can land: the curve an octave-fraction up,
    // back along the curve the same fraction down.
    c.beginPath(); path(Math.min(20000, fc * Math.pow(2, jit)), false); path(Math.max(20, fc * Math.pow(2, -jit)), true);
    c.closePath(); c.fillStyle = accent; c.globalAlpha = 0.1; c.fill(); c.globalAlpha = 1;
  }
  c.beginPath(); path(fc, false);
  c.strokeStyle = accent; c.lineWidth = 1.5; c.stroke();
  c.lineTo(w, h); c.lineTo(0, h); c.closePath();
  c.fillStyle = accent; c.globalAlpha = 0.11; c.fill(); c.globalAlpha = 1;
  c.beginPath(); c.arc(X(fc), Y(mag(fc, fc)), 3.2, 0, 7); c.fillStyle = accent; c.fill();
  // The rows below the graph show the same numbers, so grabbing the curve has
  // to move them too — otherwise the drawing and the rows disagree and the
  // rows are the ones you can type into (#283).
  const sheet = cv.closest('#propRail');
  if (sheet) for (const pid of Object.values(_FILT_PIDS)) _paintRow(sheet, pid);
}
function _wireFilter(sheet) {
  const cv = sheet.querySelector('#engFilter');
  if (!cv) return;
  const LO = Math.log10(20), HI = Math.log10(20000);
  let grab = false;
  const freqAt = x => Math.pow(10, LO + (Math.max(0, Math.min(cv.clientWidth, x)) / cv.clientWidth) * (HI - LO));
  // Real units in, through the numbox — same reason as typing.
  const setP = (pid, v) => _paramTypeSet(pid, String(Math.round(v * 100) / 100));
  const move = e => {
    if (!grab) return;
    const r = cv.getBoundingClientRect();
    setP(_FILT_PIDS.cut, freqAt(e.clientX - r.left));
    // Resonance over the height, 0 at the floor to 100 % at the ceiling —
    // the same 0–1 the row shows and the CC and OSC send.
    const fy = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / cv.clientHeight));
    setP(_FILT_PIDS.res, Math.round(fy * 100));
    _drawFilter();
    captureTileParams();
  };
  cv.addEventListener('pointerdown', e => {
    grab = true;
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault(); move(e);
  });
  cv.addEventListener('pointermove', e => { if (e.buttons) move(e); });
  cv.addEventListener('pointerup', () => { grab = false; });
  cv.addEventListener('dblclick', e => {
    e.preventDefault();
    // The drawn three go back to their ticks; the switch and the type are
    // rows of their own and keep what they say. The element default is a
    // slider POSITION, so it is set through _knobSet (position space).
    for (const pid of Object.values(_FILT_PIDS)) {
      const def = _paramDefault(pid);
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
  // NOT A READONLY ONE. Some cabinet numboxes are DISPLAYS: `bindSlider`
  // (ui-trigger.js) listens on the slider and only writes the numbox, and the
  // markup marks it `readonly` to say so. Routing a typed value there set the
  // text of an input nothing listens to and stopped — so `rearm` could be
  // dragged but never typed, against the engine page's own rule that every
  // number is typeable. Falling through reaches `_knobSet`, which writes the
  // slider and fires the `input` those handlers do listen for.
  if (num && !num.readOnly) {
    num.value = text;
    // THE EVENT THE NUMBOX ACTUALLY LISTENS FOR (2026-09-22). This dispatched
    // only `keydown` Enter, and every cabinet numbox commits on `change`
    // (radiusVal) or on `blur` (kBigNum) — their Enter handler just calls
    // `.blur()`, which does nothing at all on an element that was never
    // focused, and the cabinet lives in a `display:none` panel so it never is.
    // So typing a radius or a k on the sheet wrote the number into a hidden
    // input and stopped there: S never moved, and the row repainted back to
    // the old value a moment later. Found while proving that a cursor preset
    // carries its own radius — the preset was only half the story, the other
    // half was that the radius could not be typed in the first place.
    // All three go out, because which one a numbox wants is its own business:
    // committing twice with the same text is idempotent, missing it is not.
    num.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    num.dispatchEvent(new Event('change', { bubbles: true }));
    num.dispatchEvent(new FocusEvent('blur'));
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
  box.querySelectorAll('[data-sw], [data-swproxy], [data-gsw]').forEach(sw => {
    sw.addEventListener('click', () => {
      const proxy = sw.dataset.swproxy;
      // A grain switch owns its value outright — `S.grainTrigger` has no
      // cabinet control to write through, which is the whole reason `gseg`
      // exists. Same two data attributes either way, so the markup reads the
      // same whichever engine drew it.
      if (sw.dataset.gsw) {
        if (S.grainTrigger)
          S.grainTrigger[sw.dataset.gsw] =
            sw.classList.contains('on') ? sw.dataset.swoff : sw.dataset.swon;
      } else if (proxy) {
        const want = sw.classList.contains('on') ? sw.dataset.swoff : sw.dataset.swon;
        const seg = document.getElementById(proxy);
        const btn = seg && [...seg.querySelectorAll('button')].find(b => Object.values(b.dataset).includes(want));
        if (btn) btn.click();
      } else if (sw.dataset.sw === 'glink') { toggleGrainLink(); return; }
      else if (sw.dataset.sw === 'onend')  { S.triggerParams.loopOnEnd = !S.triggerParams.loopOnEnd; }
      else if (sw.dataset.sw === 'treverse') { S.triggerParams.reverse = !S.triggerParams.reverse; }
      else if (sw.dataset.sw === 'gend')   { setGrainOnEnd(_GEND_OF[S.traceMode] === 'cloud' ? 'scratch' : 'cloud'); }
      cap();
      // `render()`, NOT `renderOptions()` (Ek, 2026-09-22: "the options for
      // dwell retrig etc still dont click … when i hover it shows it's ready to
      // click but i can't actually click to change it"). `renderOptions` is
      // `if (_propsOn) renderProps()` — it repaints the DRAWER, and these
      // controls are in the RAIL now, which `render()` draws. The click was
      // always landing: the state moved, the cabinet moved, and the pill under
      // the cursor did not, which is indistinguishable from a dead control and
      // worse, because the instrument had changed and the rail was still
      // telling you it had not. `render()` ends by calling `renderOptions()`,
      // so the drawer still follows.
      render();
    });
  });
  box.querySelectorAll('[data-gseg]').forEach(sp => {
    sp.addEventListener('click', () => {
      if (S.grainTrigger) S.grainTrigger[sp.dataset.gseg] = sp.dataset.val;
      render();   // the RAIL draws these — see the note on the proxy handler
    });
  });
  box.querySelectorAll('[data-proxy]').forEach(sp => {
    sp.addEventListener('click', () => {
      const seg = document.getElementById(sp.dataset.proxy);
      const btn = seg && [...seg.querySelectorAll('button')].find(b =>
        Object.values(b.dataset).includes(sp.dataset.val));
      if (btn) { btn.click(); render(); }   // the RAIL draws these now — see above
    });
  });
  box.querySelectorAll('[data-tstep]').forEach(sp => {
    sp.addEventListener('click', () => {
      S.triggerParams.step = sp.dataset.tstep;
      // Re-snap both dials to the new grid, so the sheet never shows a value off it.
      S.triggerParams.pitch = quantPitch(S.triggerParams.pitch);
      const sl = document.getElementById('trigSpeedSlider');
      if (sl) { sl.value = quantSpeed(+sl.value); sl.dispatchEvent(new Event('input', { bubbles: true })); }
      captureTileParams(); renderOptions();
    });
  });
  box.querySelectorAll('[data-reads]').forEach(sp => {
    sp.addEventListener('click', () => { S.lensReads = sp.dataset.reads; cap(); render(); });
  });
  box.querySelectorAll('[data-combkeep]').forEach(sp => {
  });
  box.querySelectorAll('[data-efrom]').forEach(sp => {
    // The rail's row is drawn by render(), not renderOptions() — without it
    // the state moved and the pill stayed on `top` (Ek, 2026-09-25: "i can't
    // press the bottom in the from pill").
    sp.addEventListener('click', () => { S.eraseOldest = sp.dataset.efrom === 'bottom'; cap(); renderOptions(); render(); });
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

/** THE CURSOR SECTION FOLLOWS THE EYE (Ek, 2026-09-22 night, of the lens TAB it was: "the lens tab needs to
 *  be the source of truth or at least reflect / match what the cursor is
 *  doing. when i scroll to change the radius i see it change on the viz").
 *
 *  Every row on the tab WRITES through the cabinet's own control, so the tab
 *  was already a door onto the truth — but it was drawn once, by `render()`,
 *  and nothing repainted it when the eye moved from another door: the wheel
 *  over the sphere (`S._setSearchRadius`), `N` for the mode, `K` for fill, a
 *  pot on k, an OSC value on depth or the falloff. The cabinet followed all of
 *  those (every writer ends in `updatePlaybackControls` or `_syncRadiusFadeUI`)
 *  and the tab did not, so the two disagreed within one scroll.
 *
 *  So the tab is re-read from S and the cabinet on the layout's 5 Hz tick,
 *  class and text writes only — the same kind of pass `refreshLensStates` and
 *  `refreshValues` already make — and a change of MODE or FILL, which decides
 *  which rows are ash, redraws the panel once. A numbox being typed into is
 *  left alone (`_paintRow` checks the focus). */
function _syncLensTab() {
  if (!_propsOn) return;
  const bar = document.getElementById('cursorPanel');
  if (!bar) return;
  // The greying is structure, not a class on a row: redraw when it changes.
  const nearest = S.lensMode === 'nearest';
  const key = `${nearest ? 'n' : 'a'}${(S.grainOverrides.k ?? gp().k) === 0 ? 'A' : 'k'}${S.lensReads ?? 'both'}`;
  if (bar.dataset.lensKey !== key) {
    // Set BEFORE render() so a render that re-enters here does not loop.
    bar.dataset.lensKey = key;
    render();
    return;
  }
  for (const pid of ['radius', 'k']) _paintRow(bar, pid);
  // The segments proxy a cabinet seg, and the cabinet is what every writer
  // syncs — so the cabinet's `.active` is the eye's answer.
  bar.querySelectorAll('.opt .seg > [data-proxy]').forEach(sp => {
    const seg = document.getElementById(sp.dataset.proxy);
    const b = seg && [...seg.querySelectorAll('button')].find(x => Object.values(x.dataset).includes(sp.dataset.val));
    if (b) sp.classList.toggle('on', b.classList.contains('active'));
  });
  bar.querySelectorAll('[data-reads]').forEach(sp => sp.classList.toggle('on', S.lensReads === sp.dataset.reads));
  // Every switch that proxies a cabinet seg (fade, all, step): the seg's lit
  // button is the answer, and every writer lights it.
  bar.querySelectorAll('[data-swproxy]').forEach(sw => {
    const seg = document.getElementById(sw.dataset.swproxy);
    const lit = seg?.querySelector('button.active');
    if (!lit) return;
    const on = Object.values(lit.dataset).includes(sw.dataset.swon);
    sw.classList.toggle('on', on); sw.setAttribute('aria-checked', String(on));
  });
  const fc = bar.querySelector('[data-fadecurve]');
  if (fc) {
    fc.classList.toggle('fcurve-off', !S.radiusFadeEnabled);
    const path = fc.querySelector('.fc-line');
    const d = _fadePathD(S.radiusFadeCurve ?? 0.5, 72, 30);
    if (path && path.getAttribute('d') !== d) path.setAttribute('d', d);
  }
}

/** Cheap value refresh — called from the layout's 5 Hz tick. */
export function refreshValues() {
  _syncLensTab();
  for (const boxId of ['propRail', 'tileBar', 'cursorPanel']) {
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
  if (!custom && !TILE_DEFS[id]) return false;
  if (slotKind(id) && kindAll(slotKind(id)).length <= 1) return false;
  if (custom) { delete _tileCfg[id]; _saveTileCfg(); }
  else { _gone.add(id); _saveGone(); }
  order = order.filter(t => t !== id);
  // Whatever it was, something else has to be in the drawer and the hand
  // now — and BEFORE the palette save below, which re-renders through
  // S._bindingsChanged: a sheet pointed at a tile that no longer exists
  // threw in renderProps (found 2026-09-12).
  const fb = order.find(isToolTile);
  const wasSel = _optSel.id === id;
  const wasHand = handTool('press') === id || handTool('long') === id;
  if (wasSel && fb) _optSel = { kind: 'tool', id: fb };
  if (wasHand && fb) {
    // The replacement takes the fallback's OWN engine's voice, not the deleted
    // tool's — a tape voice on a grain tool would be half a pair of the wrong
    // kind. `_ensureHandVoices` fills it the same way a pick would.
    if (handTool('press') === id) inHand.press = { id: fb };
    if (handTool('long')  === id) inHand.long  = { id: fb };
    _saveHand();
  }
  // (A deleted tile used to leave the palette here. It cannot be on one: the
  //  strip's six are factory and only a CUSTOM tool can be deleted.)
  _saveOrder();
  if ((wasSel || wasHand) && fb) pickHand(fb);
  else { render(); renderProps(); }
  return true;
}

// (DRAG WAS HERE, all of it — 2026-09-22. `dragstart` / `dragover` / `drop` /
//  `dragend`, the drop-index maths, the zone bookkeeping and the caret. Two
//  things it did are gone rather than moved: composing the palette, which is
//  a fixed toolbar now, and re-ranking your tiles in the library, which had
//  already stopped happening — the rail's tool rows went unreachable when
//  tools collapsed to one per instrument, so there has been nothing to rank.
//  What a tool IS, where it sits and what plays it are all decided by the
//  build now; what is still yours is each position's VERB and its binding.)


// ── Init ────────────────────────────────────────────────────────────────────

// (The rail titles wore glyphs from 2026-09-23 — `_titleGlyphs` — until the
// rails canvas's F, 2026-09-25: a large word alone, Tools · Cursor · Pinned.)

export function initTiles() {
  const bar = document.getElementById('tileBar');
  if (!bar) return;
  _birthFactoryBlocks();
  try { const g = JSON.parse(localStorage.getItem(LS_GONE) || '[]'); if (Array.isArray(g)) _gone = new Set(g); } catch (_) {}
  // One-shot (2026-09-22 night): ONE LENS. A profile that deleted `wide` or
  // `spot`, or minted a custom lens, holds ids nothing answers for now — the
  // deletion is dropped from `mubone_tiles_gone`, the custom lens's definition
  // from `mubone_tiles`, and a factory lens's stray block with it. The one
  // lens's own block (`lens`) is session-only, as a factory lens's always was.
  { let swept = false;
    for (const id of ['wide', 'spot']) if (_gone.delete(id)) swept = true;
    if (swept) _saveGone();
    let dropped = false;
    for (const id of Object.keys(_tileCfg))
      if (_tileCfg[id]?.custom?.engine === 'lens' || id === 'wide' || id === 'spot') { delete _tileCfg[id]; dropped = true; }
    if (dropped) _saveTileCfg(); }
  // One-shot: a custom tool minted while the tape engine was called `loop`
  // (before 2026-09-07) is stored under that name; read it as tape, write it
  // back, no fallback kept.
  { let moved = false;
    for (const id of Object.keys(_tileCfg)) if (_tileCfg[id]?.custom?.engine === 'loop') { _tileCfg[id].custom.engine = 'tape'; moved = true; }
    if (moved) _saveTileCfg(); }
  // One-shot: a BLOCK belonging to a factory tile that no longer exists (trail
  // and match, 2026-09-22) is dead weight in `mubone_tiles` — every grain tile
  // owns its whole block, so each of these is a full sheet's worth of numbers
  // for a tool with no definition to hang them on. The palette and the rail
  // order drop the ids by themselves (`known` below
  // go through `tileDef`); this is the third store, and the only one that keeps
  // anything. A CUSTOM tile is not a factory tile and is never touched: its
  // definition IS the entry.
  { let pruned = false;
    for (const id of Object.keys(_tileCfg))
      if (!_tileCfg[id]?.custom && !TILE_DEFS[id]) { delete _tileCfg[id]; pruned = true; }
    if (pruned) _saveTileCfg(); }
  // A BLOCK THAT PREDATES A PARAM GETS THAT PARAM (2026-09-22). Written for
  // `spray` and `sort by`, which joined the shared grain sheet that day and
  // were both sunset within it; kept because the hazard is the SHEET's, not
  // theirs. A tile's block only writes the pids it HOLDS, and a grain tile owns
  // its WHOLE block (Ek, 2026-09-03) — so a block minted before a row existed
  // leaves that row's value standing from whatever was picked last, and the
  // tile silently inherits a number it does not own. Any row added to the grain
  // sheet from here on lands in every stored block through this loop.
  // Filled from the tile's factory identity where it has one, else from the
  // live value, which at this point in init is still the state default.
  { let filled = false;
    for (const [id, cfg] of Object.entries(_tileCfg)) {
      if (cfg?.custom || !cfg?.params || engineOf(id) !== 'granular') continue;
      for (const pid of shapeSheetPids(id))
        if (!(pid in cfg.params)) {
          cfg.params[pid] = FACTORY_PARAMS[id]?.[pid] ?? _readParam(pid);
          filled = true;
        }
    }
    if (filled) _saveTileCfg(); }
  // …AND THE REVERSE, for the same reason (2026-09-22): a block carrying a pid
  // the sheet no longer has. `spray` was on every grain block for a day before
  // it was sunset, and an orphan key is not inert — the block is written back
  // whole, so it would outlive the param in every profile and in every `.mubone`
  // that quotes one. One shot, no fallback: the key goes, the sheet is the list.
  { let dropped = false;
    for (const [id, cfg] of Object.entries(_tileCfg)) {
      if (cfg?.custom || !cfg?.params || engineOf(id) !== 'granular') continue;
      const keep = new Set(shapeSheetPids(id));
      for (const pid of Object.keys(cfg.params))
        if (!keep.has(pid)) { delete cfg.params[pid]; dropped = true; }
    }
    if (dropped) _saveTileCfg(); }
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
  // The palette. Fixed ids, stored verbs — `_loadPalette` reads both shapes
  // the key has held and carries an old entry's verb to its tool's new slot.
  // (The 2026-09-03 three-slot one-shot went with the composable strip: it
  //  rebuilt an ORDER, and there is no order to rebuild.)
  _loadPalette();
  // (The slot, belt, cycle and tiles-presets keys this used to sweep are
  // retired keys now — storage-registry.js purges them at boot, the one
  // mechanism for a key nothing reads.)
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
    const ok = id => id && tileById(id) && isToolTile(id) ? id : null;
    let stored = null;
    try { stored = h && h.startsWith('{') ? JSON.parse(h) : null; } catch (_) {}
    // THREE SHAPES HAVE BEEN STORED HERE, and this reads all of them: a bare
    // id (to 2026-09-22 morning) becomes BOTH hands; `{press, long}` as ids
    // (the two-tool hand, that afternoon) keeps its tools and takes its voices
    // from the engines they are on; and `{press:{id,voice}, long:{id,voice}}`
    // is read whole. A voice that cannot be filled yet — a rig whose voices are
    // seeded on the first render, after this runs — is filled by
    // `_ensureHandVoices` the moment they exist.
    // A DELETED TOOL RESOLVES TO THE ONE THAT ABSORBED IT (2026-09-22). The hand
    // is stored by id, and the shape-preset sunset took five of them; without
    // the redirect a hand holding `slice` fell through `ok()` to null and BOTH
    // sides collapsed onto the first tool in the order — measured, both hands
    // came up holding `scrape top`. `_DROPPED_TILES` is the same map the
    // palette reads, so a hand and a slot that held the same tool land together.
    const side = v => {
      if (!v) return null;
      const raw = typeof v === 'string' ? v : v.id;
      const id = ok(_DROPPED_TILES[raw] ?? migrateTileId(raw));
      // A stored `voice` is dropped: the preset is the engine's now. The VERB
      // stays — it is the side's (setHandVerb), and dropping it here reset a
      // toggled grain hand to momentary on every launch (2026-09-25).
      return id ? (typeof v === 'object' && v.verb ? { id, verb: v.verb } : { id }) : null;
    };
    inHand = stored ? { press: side(stored.press), long: side(stored.long) }
                    : { press: side(h), long: side(h) };
    if (!inHand.press && first) inHand.press = { id: first };
    if (!inHand.long)  inHand.long  = inHand.press ? { ...inHand.press } : null;
    // …AND WRITE IT BACK, once (2026-09-22). `side()` resolves a dead id every
    // boot and nothing ever saved the answer, so a hand stored as `line` was
    // re-migrated on every single load — a persistent fallback wearing a
    // migration's clothes, and the rename that made `line` dead is exactly
    // when that stops being invisible. Written whole if anything moved, so the
    // dead id leaves the disk the first time it is read.
    if (h && JSON.stringify(inHand) !== h) _saveHand();
    if (handTool('press')) _optSel = { kind: 'tool', id: handTool('press') };
    // (The re-read of the hand's stored VERB stood here; the hand has no verb
    // since 2026-09-21 — the press is the verb — so there is nothing to re-read.)
  }
  // The hand's block is applied at boot, as a pick applies it (pickHand →
  // pickTile → applyTileParams): the sheet's tile OWNS the live block, and
  // the sheet opened on the boot hand showed the boot state instead of the
  // tool's own — found 2026-09-12 night, when wash's drawer read "scratch"
  // with cloud on end baked into its block. (From 2026-09-11 to then nothing
  // was applied at boot, because there was no hand to apply.)
  // BOTH ENGINES' TOOLS (2026-09-24): each holds its engine's live block, the
  // voice included, so a reload comes back where it was left whichever tool
  // the hand holds.
  for (const id of ['tape', 'granular']) if (tileById(id)) applyTileParams(id);

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

    // The ghost act tiles in the rail (undo) are buttons, not tools.
    if (t?.kind === 'act' && !t.ghost) {
      if (t.id === 'undo') S._dispatchAction?.('undo', 127);
      flash(id); return;
    }
    // THE ROW LOADS. It writes the slot — what the spacebar holds, or the
    // eraser on the strip — and stops there. It used to open the sheet as well,
    // on the reasoning that selecting IS editing, which made every glance at a
    // preset throw a drawer over the stage (Ek, 2026-09-22: "clicking of those
    // presets only changes what's loaded in the palette bar as it is now, not
    // opening the drawer"). An OPEN sheet still follows the click, because a
    // drawer showing the tool you just put down would be lying; `setBench` does
    // that, and only that.
    setBench(id);
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
  // THE STICKER IS THE LEARN CELL WHEREVER IT IS (§ O) — and that now includes
  // the two hand tiles, so this is tested BEFORE the hand guard below. It was
  // after it, which was harmless while the hand's pills were painted-on marks
  // and is not now that they are bindings (Ek, 2026-09-22: "to be able to
  // change the keybinding of the large hands (2) in the palette bar").
  const _learnCell = row => {
    const kind = row.dataset.learnKind;
    const id = row.dataset.learnAction ?? `palette_${Number(row.dataset.learnPos) + 1}`;
    const cur = S._paletteLearning?.();
    if (cur && cur.id === id && cur.kind === kind) S._paletteLearnCancel?.();
    else S._learnAction?.(id, kind, row.dataset.learnAction ? 'the hand' : `position ${Number(row.dataset.learnPos) + 1}`);
  };
  const onStripClick = e => {
    const row = e.target.closest('.tile-bind[data-learn-kind]');
    if (row) { e.preventDefault(); e.stopPropagation(); _learnCell(row); return; }
    // (The wet sticker was a button here too, 2026-09-14 → 2026-09-22.)
    // ── A CLICK OPENS THE TILE'S PAGE (Ek, 2026-09-22) ──────────────────
    // "Clicking the tile in the palette rail now should open up left tool rail
    // to its respective page." The strip is fixed, so a click can stop being
    // about WHICH tools you have and become about the one you are looking at —
    // Procreate's rule, where the toolbar selects and the canvas plays. Nothing
    // is lost from the performance: every tile is still played by its own key,
    // the hand by the spacebar, and those paths are untouched.
    //
    // The hand tile was a legend that swallowed its own click. It has a page
    // like anything else — its tool's tab — so now it opens it.
    const h = e.target.closest('.tile--hand[data-which]');
    if (h) { const id = handTool(h.dataset.which); if (id) openTilePage(id); return; }
    const b = e.target.closest('.tile[data-pos]'); if (!b) return;
    const i = Number(b.dataset.pos), en = palAt(i); if (!en) return;
    const k = paletteKind(en.id);
    // A tool or a lens has a page, and the click opens it.
    if (k === 'tool' || k === 'lens') { openTilePage(en.id); return; }
    // AN ACT HAS NO PAGE, AND A CLICK DOES NOTHING (Ek, 2026-09-22: "clicking
    // the bang pins on the palette rail right now still activate it, it
    // shouldn't. it shouldn't do anything"). Firing them was the last thing
    // the mouse still did to the strip, kept on the reasoning that a pin tile
    // has nothing to open — but "nothing to open" is a reason to do NOTHING,
    // not a reason to keep the old behaviour under a rule that has changed for
    // every other tile. One rule now: on this strip the mouse SELECTS, the
    // binding PLAYS. A pin you can trip over with the pointer is worse than a
    // pin you reach for with `↓`, because the pointer is on this strip for
    // reasons that have nothing to do with pinning.
  };
  const onStripContext = e => {
    const row = e.target.closest('.tile-bind[data-learn-kind]');
    if (row) {
      e.preventDefault(); e.stopPropagation();
      S._unbindAction?.(row.dataset.learnAction ?? `palette_${Number(row.dataset.learnPos) + 1}`, row.dataset.learnKind);
      return;
    }
    // A HAND TILE CYCLES ITS SIDE'S VERB (Ek, 2026-09-22: "the big hands should
    // also be able to be right clickable to change the verb"). Same gesture and
    // the same `verbsOf` table as a position, on a side rather than an index —
    // minus the bang, which the hand cannot do (see `handVerb`). No tap guard:
    // a tap is a palette gesture, and the hand's two sources are reserved.
    const h = e.target.closest('.tile--hand[data-which]');
    if (h) {
      e.preventDefault();
      const which = h.dataset.which, order = handVerbsOf(which);
      if (order.length < 2) return;
      setHandVerb(which, order[(order.indexOf(handVerb(which)) + 1) % order.length]);
      return;
    }
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
  // 'image', big and wide the width of the palette bar." It is a LEGEND: a
  // mouse press on it does nothing (Ek, 2026-09-17: "it shouldn't actually
  // be clickable" — it pressed the hand from 2026-09-12 until then; the
  // spacebar and the sphere are the hand's inputs). A right-click flips its
  // verb, the way a tile's right-click cycles the tile's, and a finger still
  // presses it (below) because the phone's palette is this tile alone.
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
    _downHandMouse = true;
    // Same treatment as the spacebar (Ek, 2026-09-22: "click is same treatment
    // as spacebar"): the button is a SOURCE the recogniser reads, so a click
    // fires the press hand and holding it past the long window fires the other.
    S._dispatchGesture?.('mouse:0', true);
  };
  const onMouseUp = e => {
    if (e.button !== 0 || !_downHandMouse) return;
    _downHandMouse = false; S._dispatchGesture?.('mouse:0', false);
  };
  // A window blur is a release edge for both wires: a key-up or mouse-up
  // that never arrives must not leave a momentary hand stuck down.
  window.addEventListener('blur', () => {
    if (_downHandMouse) { _downHandMouse = false; S._dispatchGesture?.('mouse:0', false); }
  });

  // UNPIN ALL's button in the pinned rail's block: a bang, so it flashes, and it
  // goes through the cabinet button every other door uses.
  document.getElementById('lyrUnpinAll')?.addEventListener('click', () => {
    _pinFlash('unpinall');
    document.getElementById('commitClearBtn')?.click();
  });
  // The palette floats OVER the canvas, whose mousedown starts a trace. The dock
  // is pointer-transparent so the gaps still paint; a tile must swallow its
  // own press so clicking one never lays a mark under it.
  const paletteDock = document.getElementById('paletteDock');
  const toolRail = document.getElementById('toolRail');
  // Both rails float OVER the canvas, whose mousedown starts a trace, so
  // every press inside them is swallowed — not just presses on a control.
  for (const el of [toolRail, document.getElementById('propRail')]) {
    el?.addEventListener('mousedown', e => e.stopPropagation());
  }
  toolRail?.addEventListener('click', onRailClick);
  paletteDock?.addEventListener('click', onStripClick);
  paletteDock?.addEventListener('contextmenu', onStripContext);
  // A FINGER ON THE HAND TILE is the same press (the phone, 2026-09-12: the
  // palette there is the hand tile alone). preventDefault, so the browser
  // sends no compat mousedown/up pair after the finger lifts — that pair
  // would be a press of no length.
  const onPlateTouch = e => {
    if (!e.target.closest('#handKey')) return;
    e.preventDefault(); e.stopPropagation();
    // ON THE PHONE the tile is a spacebar with no verb switch: momentary, like
    // the sphere's touch beside it. Through the recogniser a touch is a PRESS,
    // which latches, so lifting the finger left the hand playing (phone-audit,
    // 2026-09-23). The desktop keeps the recogniser — a tap latches there by
    // the same rule the spacebar follows.
    const phone = document.body.classList.contains('mobile-mode');
    if (e.type === 'touchstart') { if (_downHandMouse) return; _downHandMouse = true; phone ? handDown('press', true) : S._dispatchGesture?.('mouse:0', true); }
    else if (_downHandMouse) { _downHandMouse = false; phone ? handUp() : S._dispatchGesture?.('mouse:0', false); }
  };
  for (const t of ['touchstart', 'touchend', 'touchcancel']) paletteDock?.addEventListener(t, onPlateTouch, { passive: false });
  paletteDock?.addEventListener('mousedown', e => { if (e.target.closest('.tile')) e.stopPropagation(); });
  S.canvas?.addEventListener('mousedown', onSphereDown);
  window.addEventListener('mouseup', onMouseUp);
  // (The two rails and the palette were wired as drag sources and targets
  //  here from 2026-09-11 until 2026-09-22. Nothing drags now — the strip is
  //  fixed and the rail lists no tools.)

  // (The lens bar's click — install on tap — was bound here until 2026-09-22
  //  night. The lens tile on the STRIP is the one lens control: `_paletteFire`.)

  // ── Naming and retiring a tool, on the row (#284) ────────────────────────
  // Both live in the rail rather than the sheet: the row IS the tool, and
  // neither gesture should need a properties panel open. Bound once on the
  // rail, in CAPTURE, so the row's own click handler never sees the press.
  const rowId = el => el?.dataset.tile ?? el?.dataset.voice ?? null;
  // (The wet button sat here until 2026-09-22.)
  // MODE's switches are the INSTRUMENT's. They are settings, not plays, so a
  // click is a click — changing one affects the next take, never the one
  // running. Bound on `#globalModes`, where they all live since 2026-09-22 —
  // one list, above the tool creator, not scoped to whichever tab is open.
  // ONE HANDLER, ON THE RAIL (2026-09-22). `audition` is drawn above the line
  // and the five instrument modes inside their tab, so the same switches sit in
  // two containers now — and `#globalModes` is INSIDE `#toolRail`, so binding
  // both meant audition's click ran twice and toggled back to where it started.
  // The rail contains every mode row either way; the rows are `.mrow-sw`, so no
  // other rail handler matches them.
  const onModeClick = e => {
    if (e.target.closest('[data-audition]')) {
      e.preventDefault(); setAudition(!S.auditionMode); return;
    }
    const a = e.target.closest('[data-autopin]');
    if (a) { e.preventDefault(); setAutoPin(a.dataset.autopin, !autoPinOn(a.dataset.autopin)); return; }
    if (e.target.closest('[data-overdub]')) { e.preventDefault(); setOverdub(!overdubOn()); return; }
    if (e.target.closest('[data-gwalk]')) {
      e.preventDefault(); S.grainWalk = !S.grainWalk;
      render(); if (propsOpen()) renderProps(); return;
    }
    if (e.target.closest('[data-escope]')) {
      e.preventDefault(); S.eraseWholeStroke = !S.eraseWholeStroke;
      render(); if (propsOpen()) renderProps();
    }
  };
  toolRail?.addEventListener('click', onModeClick);

  // The instrument tabs.
  document.getElementById('instrTabs')?.addEventListener('click', e => {
    const t = e.target.closest('[data-instr]'); if (!t) return;
    e.preventDefault();
    setInstrument(t.dataset.instr);
  });

  // ── THE DOOR OPENS THE SHEET, and it is the only thing that does ─────────
  // One handler for all three kinds of row, in CAPTURE so the row's own click
  // never sees it: a shape row LOADS its preset, a voice row TAKES its voice, a
  // lens row INSTALLS its eye — and none of them opens a drawer over the stage.
  // The door is the handle for that, at the row's right edge, and it says which
  // row it belongs to by sitting inside it (`[data-more]`, the hook every audit
  // reaches the drawer through).
  toolRail?.addEventListener('click', e => {
    const d = e.target.closest('[data-more]'); if (!d) return;
    e.preventDefault(); e.stopPropagation();
    // The VOICE line's door opens its engine's sheet (2026-09-24); a preset
    // row has no door any more.
    if (d.dataset.sheet) { toggleSheet(d.dataset.sheet, 'engine'); return; }
    const row = d.closest('[data-tile]'); if (!row) return;
    const id = row.dataset.tile;
    const kind = 'tool';
    // `toggleSheet` is this door's own function — written for it, and keyed on
    // `_propRow`: the door with another page up brings THIS page, and only a
    // second press on the page it is already showing shuts it. (Not
    // `propsOpen()`: `closeProps` drops the `prail-open` class and leaves
    // `_propsOn` set, so asking that instead never saw a shut drawer.)
    toggleSheet(id, kind);
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
  // The `+` on a VOICE caption mints a voice from the live block and opens its
  // name for typing — a voice you cannot name is one you will not recognise in
  // a month, which is the whole point of having it.
  toolRail?.addEventListener('click', e => {
    const a = e.target.closest('[data-addvoice]'); if (!a) return;
    e.preventDefault(); e.stopPropagation();
    if (_held) return;
    const id = mintVoice(a.dataset.addvoice);
    if (!id) return;
    render();
    setTimeout(() => _openRename(id), 0);
  }, true);
  // Taking a preset: the row's click writes its params onto the live block —
  // under a held play too (2026-09-24). A recall only moves the pedal, and a
  // grain stroke bakes mark by mark, so the rest of the stroke bakes the new
  // sound the way a ridden knob would. (It waited out a play, audition
  // excepted, while auditioned paint followed the knobs; no paint does now.)
  // DELETE, on the preset's own row (Ek, 2026-09-24). Before the row's click,
  // which would recall the preset it is about to remove.
  toolRail?.addEventListener('click', e => {
    const d = e.target.closest('[data-delvoice]'); if (!d) return;
    e.preventDefault(); e.stopPropagation();
    if (_held) return;
    deleteVoice(d.dataset.delvoice);
  }, true);
  toolRail?.addEventListener('click', e => {
    const row = e.target.closest('[data-voice]'); if (!row) return;
    e.preventDefault(); e.stopPropagation();
    const vid = row.dataset.voice;
    // The door opens the voice's own sheet — every number of what it sounds
    // like, and nothing about how it lands. Anywhere else on the row takes it.
    // THE SLOT FIRST, then the voice — `applyVoice` is what redraws, and the
    // hand tile names the voice its side holds, so writing the slot after it
    // would draw the tile with the voice it is about to stop having.
    // (Ek, 2026-09-22: "i change the shape preset and voice preset and it
    // should update what is being held".) The hand froze its voice at the pick,
    // so without this the editor would say one thing and the spacebar another.
    // The sheet is the ENGINE's (2026-09-24), so the row only points the drawer
    // at that engine; the door on the VOICE line opens it. A press RECALLS the
    // preset — pressing the one already marked puts the sliders back on it.
    const veng = _voices[vid]?.engine;
    if (veng) { _optSel = { kind: 'engine', id: veng }; _propRow = veng; }
    applyVoice(vid);
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
    // A voice is renamed by the same gesture as a tool or a lens of yours,
    // so the editor opens on whichever row holds the id.
    const row = document.querySelector(`#toolRail [data-tile="${id}"], #toolRail [data-lens="${id}"], #toolRail [data-voice="${id}"]`);
    if (!row || row.querySelector('.trow-rn')) return;
    if (_voices[id]?.factory) return;              // a factory preset keeps its name (Ek, 2026-09-24)
    const nm = row.querySelector('.tile-nm'); if (!nm) return;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'trow-rn'; inp.value = isVoiceId(id) ? voiceName(id) : nm.textContent; inp.maxLength = 24;   // not the edited mark's `*`
    nm.replaceWith(inp);
    inp.focus(); inp.select();
    let done = false;
    const finish = keep => {
      if (done) return; done = true;
      // Always repaint: `renameCustomTile` bails out when the name did not
      // change, and without this the row would be left holding a text input.
      const ok = isVoiceId(id) ? renameVoice(id, inp.value) : renameCustomTile(id, inp.value);
      if (!keep || !ok) { render(); renderProps(); }
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
  // The sheet's held-pointer guard (see renderProps). Capture phase on the
  // rail, so a control that stops propagation still counts; the release is
  // read on the window, because a captured pointer's up lands on the
  // capturing element and a blur may be the only edge that ever comes.
  document.getElementById('propRail')?.addEventListener('pointerdown', e => { if (e.isPrimary !== false) _sheetHeld = true; }, true);
  for (const t of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(t, _sheetRelease, true);
  setInterval(_pollLiveBlock, 100);
  // The lit state, at a rate a press can be seen at (see refreshPlayingState).
  setInterval(refreshPlayingState, 33);
  setInterval(refreshLensLive, 200);
  // THE REGISTRY IS THE SCREEN (2026-09-24): every switch, capsule and row on
  // the rail is an ACTIONS row (midi.js), and these are the doors it reaches
  // them by — the same setters the clicks use, so a key, a pad and a click
  // leave the app in one state.
  S._setAudition   = setAudition;
  S._setAutoPin    = setAutoPin;
  S._setOverdub    = setOverdub;
  S._setWalk       = on => { S.grainWalk = !!on; render(); if (propsOpen()) renderProps(); };
  S._setEraseScope = on => { S.eraseWholeStroke = !!on; render(); if (propsOpen()) renderProps(); };
  S._setLensReads  = v  => { S.lensReads = v; captureTileParams(LENS_ID); render(); };
  S._toggleGrainLink = toggleGrainLink;
  S._voicesOf      = voicesOf;
  S._currentVoice  = currentVoice;
  S._applyVoice    = applyVoice;
  S._renderRail    = () => { render(); if (propsOpen()) renderProps(); };
  S._setToolRail   = setPropsOpen;
  S._toolRailOpen  = propsOpen;
  render();
}

// The hand, for the record path (brush-voicing.js freezes from it), the
// bridge (the live sync), the renderer (the glow on a live mark) and import (a
// live voicing comes back live, one per tile). NULL
// between presses — every caller asks while a stroke is running, and every
// one of them handles the empty hand (2026-09-11).
// WHAT IS PLAYING, and whether its paint is LIVE. Live means "made while
// AUDITIONING" (Ek, 2026-09-22) — the bench is where you are building a tool, so
// its marks follow the numbers you are building with, and a knob moved after the
// fact moves every one of them. Paint made by PLAYING freezes at the stroke.
// The old per-tool `wet` toggle is gone; the press declares it now.
S._handTile   = () => {
  const id = handTileId();
  // No `live` any more (2026-09-24): nothing painted is live. AUDITION is the
  // cursor's switch — brush-voicing.js "Audition is the cursor's".
  return id ? { id, label: tileDef(id)?.label ?? id } : null;
};
S._setGrainOnEnd = setGrainOnEnd;
// (`S._liveHue` is gone with the glow it coloured, 2026-09-22.)
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
// A take joins the master's cycle because the MODE says so — not because of
// which tile is in the hand (Ek, 2026-09-21). The `overdub` tile still answers
// true while it exists, so nothing that is stored or bound breaks on the way.
// OVERDUB IS THE MODE, and only the mode: the `dub` tile that also forced it
// was deleted on 2026-09-22 for being a second door onto this flag.
S._handIsOverdub = () => !!S.overdub;
// Visible refusal: the overdub tile flashes when nothing is pinned to overdub onto.
// The keys page saved a binding: the palette's key legend reads the bindings
// at render, so a repaint is the whole update.
S._bindingsChanged = () => render();
// A STICKER IS A LEARN CELL WHEREVER IT IS (2026-09-25): click arms a learn for
// its action in the legend's kind, right-click clears it — the palette's two
// gestures, on any row or chrome button that wears one. Capture phase, so the
// button or row under it never sees the click.
document.addEventListener('click', e => {
  const k = e.target.closest('.row-binds .tile-bind[data-learn-action]'); if (!k) return;
  e.preventDefault(); e.stopPropagation();
  const id = k.dataset.learnAction, kind = k.dataset.learnKind;
  const cur = S._paletteLearning?.();
  if (cur && cur.id === id && cur.kind === kind) S._paletteLearnCancel?.();
  else S._learnAction?.(id, kind, k.dataset.rowLearn || id);
}, true);
document.addEventListener('contextmenu', e => {
  const k = e.target.closest('.row-binds .tile-bind[data-learn-action]'); if (!k) return;
  e.preventDefault(); e.stopPropagation();
  if (!_HAND_KEYED.has(k.dataset.learnAction) || (S._bindingsOf?.(k.dataset.learnAction) ?? []).some(b => b.kind === k.dataset.learnKind))
    S._unbindAction?.(k.dataset.learnAction, k.dataset.learnKind);
}, true);
S._migrateTileId = migrateTileId;   // a session file's voicings name tiles by id (brush-voicing.js)
