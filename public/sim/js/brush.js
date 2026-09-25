// ============================================================================
// brush.js — the brush decides the material
//
// The surviving core of the v1 tool build (#208), extracted from the deleted
// tool-layout.js because it was never presentation: this is the settled model
// of docs/archive/BRUSH-MODEL.md § 1d, and the engine keepers ride on it —
// brush-voicing.js names the voicing a stroke freezes from S._currentBrush
// (#210), and pins-audit.js §§ H–I drive the frozen-brush checks through
// setBrush().
//
//   grain  — granular; the sound is the PLAYING tile's block (tiles.js), not
//            the patch bank's slot, since 2026-09-03.
//   tape   — the primary gesture records a TRIGGER instead of granular
//            material: #183's rule ("the player knows before pressing
//            record") with the decision moved onto the brush.
//
// The stamp material is gone (#247): a loaded sample is a SOURCE, not a
// brush — S.sourceKind decides where the ink comes from, and sampler.js owns
// that half. The same gesture deposits granular or struck material depending
// on the brush, from whichever source is on.
// ============================================================================

import { S, GESTURE_LONG_MS } from './state.js';

export function brushLibrary() {
  // Two keys, one per MATERIAL. There used to be one per patch-bank slot
  // (`grain:N`); the bank went on 2026-09-03 and the sound is the tile's.
  return [
    { key: 'grain', label: 'grain', material: 'grain' },
    { key: 'tape',  label: 'tape',  material: 'tape' },
  ];
}

/** Which brush is selected. Material is derived from it — never set directly. */
export function currentBrush() {
  if (!S.brushKey) S.brushKey = 'grain';
  const lib = brushLibrary();
  return lib.find(b => b.key === S.brushKey) || lib[0];
}

export function setBrush(key) {
  const b = brushLibrary().find(x => x.key === key);
  if (!b) return;
  S.brushKey = key;
  // The key says WHAT the gesture deposits (grain or tape) and nothing about
  // how it sounds: a grain tile owns its whole block and `applyTileParams`
  // writes it right after this (2026-09-03). Loading the patch-bank slot
  // here as well used to run first and be overwritten a frame later, with a
  // HUD flash and the bank's active index moved for nothing; the bank itself
  // went the same day (sandbox/sunset-2026-09-03).
  S._renderBrushUI?.();
}

/** The material the primary gesture will deposit. */
export function currentMaterial() { return currentBrush()?.material || 'grain'; }

// ── The gesture funnel (Ek, 2026-09-04) ─────────────────────────────────────
// Every play goes through here: a palette key, a pad, a pedal or OSC presses
// a POSITION (tiles.js slotDown) and that presses this. It is one of two
// things — the way a button on a MIDI controller is:
//
//   TOGGLE     press starts, the NEXT press stops it, release does nothing.
//              The default, and what a position's own row is.
//   MOMENTARY  press starts, release stops. A position's `_hold` row.
//
// Which one is the BINDING's (2026-09-09) — it was one setting above every
// tool until then. There is no hybrid: the old "hold = momentary, quick tap =
// latch" was two behaviours on one button with a 200 ms window deciding
// which, and it reached ONE tool — a grain brush on the live source in plain
// trace mode — because the brush claimed every other press before the window
// was read. Erase, the line brushes and anything sampler-sourced were
// momentary whatever you did. Now a binding is a toggle or a binding is
// momentary, and the brush only decides what a started gesture DEPOSITS
// (`_toolDown` / `_toolUp`).
//
// THIS USED TO BE "THE MAIN BUTTON" (deleted 2026-09-11). Space, a click on
// the sphere, a phone tap, `/trace`, `/trace/toggle` and `F` all pressed it
// with whatever tool was ARMED, and arming is gone: a press now names the
// position it plays, so a button with no tile behind it has nothing to mean.
// Spacebar is learnable onto a position like any other key.
//
// Because a hold means nothing else in toggle mode, it is free for a second
// function: a button still down after GESTURE_LONG_MS fires the tool's LONG
// PRESS. Erase: erase all (the stroke ends first). Other tools: nothing yet.
// Momentary mode has no long press — a long hold there is a long stroke.
//
// The gesture remembers the mode it STARTED in, so the setting flipping under
// a held key or note cannot strand it: a momentary-started gesture always
// ends on its release, and a toggle-started one always ends on the next
// press. A press while a momentary gesture is down (a second wire) is
// ignored. Ending from outside — the trace mode changing, the window losing focus — is `gestureEnd()`.


let _active    = false;   // a gesture is running
let _latched   = false;   // … and was started by a TOGGLE press
let _longTimer = null;

/** What a started gesture deposits: the brush's business, and the hand's
 *  tile — the position that is playing, which is the only hand there is. */
function _toolDown() {
  if (S._handKind?.() === 'edit') { S._startEraseStroke?.(); return true; }
  const mat = currentMaterial();
  if (mat === 'tape') {
    // The overdub brush: a tape take that joins the nearest pinned loop as a
    // layer — or, with nothing pinned, SEEDS the loop it will join next time
    // (ui-presets.js beginOverdub). A false return is the tool refusing.
    if (S._handIsOverdub?.() && !S._beginOverdub?.()) return false;
    // tape + sampler = the old stamp's fires-on-touch: the sampler stroke is
    // recorded as a trigger and armed on release (#247).
    if (S.sourceKind === 'sampler') { S._samplerTrace?.(true, { trigger: true }); return true; }
    S._startTriggerRecord?.(); return true;
  }
  if (S.sourceKind === 'sampler') { S._samplerTrace?.(true); return true; }
  S._startPaintStroke?.();
  return true;
}
function _toolUp() {
  // Every stop is a no-op when its tool is not running, so the hand having
  // moved under a gesture (it cannot — tiles.js holds it — but a session
  // import can) ends whatever IS running rather than nothing.
  S._stopEraseStroke?.();
  if (S.sourceKind === 'sampler') S._samplerTrace?.(false);
  S._stopTriggerRecord?.();
  // The overdub's press-time flags are read by the stroke's commit inside
  // stopTriggerRecord; a press that never recorded (no take started) would
  // otherwise hand them to the next stroke.
  S._overdubTake = null; S._overdubSeed = false;
  S._stopPaintStroke?.();
}

function _clearLong() { if (_longTimer) { clearTimeout(_longTimer); _longTimer = null; } }

function _begin(latched) {
  _active = true; _latched = latched;
  S.paintLatched = latched;
  if (!_toolDown()) {           // the tool refused (an overdub with no master)
    _active = false; _latched = false; S.paintLatched = false;
    S._gestureChanged?.();
    return;
  }
  S._gestureChanged?.();
}
function _end() {
  _clearLong();
  _active = false; _latched = false;
  S.paintLatched = false;
  _toolUp();
  S._gestureChanged?.();
}

/** The press edge, from any wire. */
export function gesturePress(momentary = false) {
  if (_active) {
    if (_latched) _end();      // toggle: the second press stops
    return;                    // momentary: a second wire while down — nothing
  }
  _begin(!momentary);
  // THE LONG PRESS IS A PRESS THAT IS STILL DOWN, so the timer is armed for both
  // kinds. It used to be armed only for a latched (toggle) press, because the
  // hand's verb was a stored setting and a held spacebar counted as latched.
  // Since 2026-09-21 the hand has no verb — holding IS the momentary press — so
  // guarding on `_latched` made the eraser's long press unreachable either way.
  _longTimer = setTimeout(() => {
    _longTimer = null;
    if (!_active) return;
    if (S._handKind?.() === 'edit') {
      _end();
      S._eraseAllProgress?.(0);
      S._sessionEraseAll?.();
    }
  }, GESTURE_LONG_MS);
}

/** The release edge, from any wire. */
export function gestureRelease() {
  _clearLong();
  if (_active && !_latched) _end();
}

/** PROMOTE the running gesture to a latched one — the hand's tap (Ek,
 *  2026-09-21). Every hand press starts as a hold so the stroke begins on the
 *  down with no waiting; a release inside HAND_TAP_MS promotes it instead of
 *  ending it, and from then on it behaves exactly like a gesture that was
 *  pressed as a toggle: the next press stops it.
 *
 *  Without this the latch lived only in tiles.js's `_held`, the funnel stayed
 *  momentary, and `gesturePress` answered a second press with "a second wire
 *  while down — nothing". That is the bug Ek hit: the click started a stroke
 *  nothing could stop. */
export function gestureLatch() {
  if (!_active || _latched) return false;
  _latched = true;
  return true;
}

/** End the running gesture from outside, whichever mode started it. */
export function gestureEnd() { if (_active) _end(); }

/** End the running gesture and THROW AWAY what it recorded — the take never
 *  happened. The instrument's buttons use it (midi.js): a long, extra long,
 *  ×2 or ×3 on a button whose press started an activate swallows that take
 *  (Ek, 2026-09-10: "cancel the loop that just started as if it was never
 *  meant to be, then do cloud"). The stroke id is stamped before the stop so
 *  _commitTraceStroke (events.js) discards instead of arming. */
export function gestureAbort() {
  if (!_active) return false;
  if (S.currentStrokeId > 0) S._abortStrokeId = S.currentStrokeId;
  _end();
  return true;
}

export function gestureActive()  { return _active; }
export function gestureLatched() { return _active && _latched; }

// Registered on S rather than imported, the house pattern — the record path
// (ui-samples.js → brush-voicing.js) must not import a UI-adjacent module.
S._currentBrush     = currentBrush;
S._currentMaterial  = currentMaterial;
S._gesturePress     = gesturePress;
S._gestureRelease   = gestureRelease;
S._gestureEnd       = gestureEnd;
S._gestureAbort     = gestureAbort;
S._gestureActive    = gestureActive;
S._gestureLatched   = gestureLatched;
S._gestureLatch     = gestureLatch;
