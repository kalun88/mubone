// ============================================================================
// history.js — ONE action stack: undo is the last thing the performer did
//
// Ek, 2026-09-05: "undo should undo the last user thing. Right now it just
// looks like it undoes strokes." It did: strokes had a stack, an erase had a
// single snapshot on a 30-second timer, and a pin had nothing. Three histories
// that did not know about each other, so undo answered "what was the last
// stroke" rather than "what did I last do".
//
// Now every undoable thing is an ACTION on one chronological stack, and each
// module builds its own: a stroke (ui-samples.js — its marks, its recording,
// the trigger it armed, the loop or cloud or overdub layer the gesture pinned),
// an erase, a sweep or an erase-all (ui-sweep.js / erase.js — a before and an
// after snapshot of the material), a pin placed by hand and an unpin
// (ui-presets.js — the slot object itself, put back or taken out). One gesture
// is one action. Mixing moves (mute, solo), knobs, lens and pin settings, tile
// arming and the camera are instrument state, not things made, and are not
// here (Ek, same day — Procreate draws the same line).
//
// UNBOUNDED (Ek: "artists want to keep pressing undo till they kinda reset —
// back to the top of the show, or to what was loaded"). An entry holds
// references, not copies: a stroke's marks and its recording, which the show
// held anyway while the material existed; an erase's arrays of references to
// the same. The cost of the whole stack is the audio you recorded and later
// removed. A session import starts a fresh history (ui-export.js).
//
// Redo keeps the classic rule: a new action forks history and what was undone
// stays undone. An action may say it is IN PROGRESS (a stroke still being
// painted and recorded): undo reaches past it to the one before, because
// undoing the live take would have to drop and re-open the mic.
// ============================================================================

import { S } from './state.js';

const _undo = [];
const _redo = [];

/** An action: `{ kind, undo(), redo(), inProgress?() }`. */
export function push(action) {
  if (!action || typeof action.undo !== 'function' || typeof action.redo !== 'function') return;
  _undo.push(action);
  if (_redo.length) { for (const a of _redo) a.dispose?.(); _redo.length = 0; }
}

export function undo() {
  let i = _undo.length - 1;
  while (i >= 0 && _undo[i].inProgress?.()) i--;
  if (i < 0) return null;
  const a = _undo.splice(i, 1)[0];
  a.undo();
  _redo.push(a);
  return a;
}

export function redo() {
  const a = _redo.pop();
  if (!a) return null;
  a.redo();
  _undo.push(a);
  return a;
}

export function clear() {
  for (const a of _undo) a.dispose?.();
  for (const a of _redo) a.dispose?.();
  _undo.length = 0; _redo.length = 0;
}

export function clearRedo() {
  for (const a of _redo) a.dispose?.();
  _redo.length = 0;
}

/** Take back everything pushed since the stack stood at `n` — undone and
 *  gone, never redoable. The button recogniser's swallow rule (midi.js
 *  _abortPress): a long, extra long, ×2 or ×3 takes back whatever its
 *  button's press did — a pin, a sweep, an erase — as if it was never meant.
 *  An action still in progress (a stroke being recorded) is left in place:
 *  the abort path discards it once the take has sealed. */
export function discardSince(n) {
  const gone = [];
  for (let i = _undo.length - 1; i >= n; i--) {
    if (_undo[i].inProgress?.()) continue;
    gone.push(_undo.splice(i, 1)[0]);
  }
  for (const a of gone) { a.undo(); a.dispose?.(); }   // newest first
  return gone.length;
}

/** Take an action off the stack WITHOUT undoing it — the caller will, later.
 *  The abort path: an aborted take must leave the history the instant the
 *  abort happens (a ×2 bound to undo fires right after, and must reach what
 *  came BEFORE the take), while its buffer can only be freed once the take
 *  has sealed. Newest match; null if none. */
export function detach(pred) {
  for (let i = _undo.length - 1; i >= 0; i--) {
    if (!pred(_undo[i])) continue;
    const a = _undo.splice(i, 1)[0];
    return a;
  }
  return null;
}

/** ONE GESTURE IS ONE ACTION even when its halves land on different edges.
 *  A pin press writes its loops on the DOWN — so the button recogniser's
 *  swallow (`discardSince`) can still take the press back while it is still
 *  held — and its cloud on the RELEASE, because a held pin draws a moving
 *  cloud. This folds every entry carrying `tag` into the oldest of them, in
 *  place: undo then takes the whole press, newest half first. Fewer than two
 *  and nothing happens. It works on the stack directly rather than through
 *  detach-and-push, which would have cleared the redo stack as a side effect.
 *  A null tag matches nothing — an untagged action is nobody's gesture. */
export function mergeTagged(tag) {
  if (tag == null) return 0;
  const at = [];
  for (let i = 0; i < _undo.length; i++) if (_undo[i].tag === tag) at.push(i);
  if (at.length < 2) return 0;
  const parts = at.map(i => _undo[i]);
  for (let i = at.length - 1; i >= 1; i--) _undo.splice(at[i], 1);
  _undo[at[0]] = {
    kind: parts[0].kind,
    undo() { for (let i = parts.length - 1; i >= 0; i--) parts[i].undo(); },
    redo() { for (const a of parts) a.redo(); },
    dispose() { for (const a of parts) a.dispose?.(); },
  };
  return parts.length;
}

export function undoCount() { return _undo.length; }
export function redoCount() { return _redo.length; }
/** The stack, read-only, for audits and the console. */
export function entries() { return _undo.map(a => a.kind); }

S._historyDiscardSince = discardSince;
S._undoCount   = undoCount;
S._redoCount   = redoCount;
