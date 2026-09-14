// ============================================================================
// pins.js — the pin mix: mute and solo on every pin and on the two groups
//
// Pinned material plays off-cursor, and it groups by WHAT IT IS: clouds in one
// group, loops in the other. The group is DERIVED, never stored (2026-08-30,
// Ek: "all pinned material will just go into the pinned material, there's no
// group differentiator"): `groupOf()` is `slot.type`, so there is no id to
// resolve, no set to restore, and no way for the rail and the audio to
// disagree about which group a pin is in.
//
// AUDIBILITY IS DERIVED TOO (2026-09-05, Ek: "let's not have on/off indicators
// but use the proper one which is mute and solo, even on each loop item").
// Every pin carries two flags, `mute` and `solo`; every group carries the same
// two. Nothing writes "on" or "off" anywhere. Whether a pin sounds is one
// function of the four flags — `isPinAudible()` — and `applyMix()` makes the
// engine agree with it. That replaces the write-through model, whose restore
// rule (`_preGroupOn`: remember which pins were already silent when the group
// went down, bring back only those) existed only because the intent and the
// engine state were the same field. Now they are two: the intent stays where
// the player put it, and a group unmuting cannot resurrect a pin muted by hand
// because that pin's own `mute` is still true.
//
//   audible(pin) = !pin.mute && !group.muted
//                  && (nothing is soloed || pin.solo || group.solo)
//
// Solo is ADDITIVE, as in every DAW: the set of soloed things is what you
// hear, and mute wins over solo on the same pin. A group solo is "clouds only"
// / "loops only"; soloing both groups is everything, which is honest.
//
// A pin's MUTE is immediate — a 20 ms ramp on a loop, a stop on a cloud — and
// never waits for the loop boundary. Waiting for the end of the pass is a
// different verb: RELEASE, the unpin, whose timing is Settings → Pins
// (`S.loopReleaseMode`: fade / at end; a cloud's fade out). Before 2026-09-05
// the rail's mute landed at the boundary and the word "mute" was doing both
// jobs (Ek: "we should not appropriate MUTE and give it other meanings").
//
// A group owns no audio and neither does this file: the engine verbs are
// composer.js (a loop is MUTED, source running, returns mid-phrase; a cloud is
// STOPPED with its slot intact). `applyMix()` only calls them.
//
// THE SELECTED PIN. Unpin, and anything else that acts on "the" pin, takes the
// one `selectedPinSlot()` names — nearest to the cursor or the oldest, by
// `S.selectionMode` — and the rail marks it so the hand knows what it is about
// to remove (Ek, 2026-09-05: "the item that is selected is super important").
// ============================================================================

import { S } from './state.js';
import { setLoopMuted, setCloudPlaying, isCommitOn } from './composer.js';
import { angleBetweenSphere } from './grain.js';

// The two groups, and there will never be a third: a pin is a cloud or a loop
// because a commit slot is one or the other. They carry an ENGINE hue, not a
// colour of their own (#257: colour answers "which engine is this").
export const GROUPS = [
  { key: 'cloud', name: 'clouds', hue: '--eng-grain', muted: false, solo: false },
  { key: 'loop',  name: 'loops',  hue: '--eng-tape',  muted: false, solo: false },
];

export function groups() { return GROUPS; }

/** The group a pin is in — its kind, asked fresh every time. */
export function groupOf(c) {
  if (!c) return null;
  return GROUPS.find(g => g.key === c.type) ?? null;
}

export function pinsIn(g) {
  if (!g) return [];
  const out = [];
  for (const c of S.commitSlots) if (c && c.type === g.key) out.push(c);
  return out;
}

/** AN EMPTY GROUP HOLDS NO STATE (Ek, 2026-09-12, night: "i muted the group.
 *  then i erase that loop. when i go to make a new loop it starts muted. the
 *  mute flag should reset if it's coming from no loops pinned"). The two
 *  flags are the player's intent about the pins IN the group; with none
 *  left there is nothing the intent is about, and the rail hides the row, so
 *  a flag left set was invisible until the next pin was born silent. Called
 *  from the rail's tick (ui-pins.js, on every change) and from applyMix. */
/** A pin on its way OUT — a cloud fading through its release, a loop fading
 *  or playing to its end after an unpin — is no longer IN its group: the slot
 *  lingers for the tail, and counting it kept the flags alive exactly long
 *  enough for the next pin to be born under them (Ek: "same issue with
 *  clouds" — a release time was set). ui-presets treats such a slot as free. */
function leaving(c) {
  return c.type === 'cloud' ? c._releasingAt > 0 : !!(c._playingToEnd || c._fadingOut);
}
export function pruneEmptyGroups() {
  let changed = false;
  for (const g of GROUPS) {
    if (!(g.muted || g.solo) || pinsIn(g).some(c => !leaving(c))) continue;
    g.muted = false; g.solo = false; changed = true;
  }
  if (changed) S._pinsDirty = true;
  return changed;
}
// The RELEASE is where it has to run (ui-presets.js _releaseSlotAt): at the
// next pin's creation the newborn already counts as live, so a prune there
// can no longer tell an emptied group from one that still holds a pin.
S._prunePinGroups = pruneEmptyGroups;

// ── The derivation ──────────────────────────────────────────────────────────

/** Is anything soloed — a pin or a group. When nothing is, solo has no say. */
export function anySolo() {
  if (GROUPS.some(g => g.solo)) return true;
  for (const c of S.commitSlots) if (c && c.solo) return true;
  return false;
}

/** What the player asked for, from the four flags. Never reads the engine. */
export function isPinAudible(c) {
  if (!c) return false;
  const g = groupOf(c);
  if (c.mute || g?.muted) return false;
  if (!anySolo()) return true;
  return !!(c.solo || g?.solo);
}

/** Make the engine agree with the flags. Idempotent and cheap (≤16 slots), so
 *  it is called after every flag change, when a pin arrives, and after an
 *  import — a pin born under a solo is silent from its first tick. */
export function applyMix() {
  pruneEmptyGroups();
  for (const c of S.commitSlots) {
    if (!c) continue;
    const want = isPinAudible(c);
    if (isCommitOn(c) === want) continue;
    if (c.type === 'loop') setLoopMuted(c, !want);
    else if (c.type === 'cloud') setCloudPlaying(c, want);
  }
  S._pinsDirty = true;
  S._syncComposerUI?.();
}
S._applyPinMix = applyMix;

// ── The pin's own two flags ─────────────────────────────────────────────────

export function setPinMuted(c, muted) {
  if (!c) return;
  c.mute = !!muted;
  applyMix();
}

export function togglePinMute(c) {
  if (!c) return null;
  setPinMuted(c, !c.mute);
  return isPinAudible(c);
}

export function setPinSolo(c, solo) {
  if (!c) return;
  c.solo = !!solo;
  applyMix();
}

export function togglePinSolo(c) { if (c) setPinSolo(c, !c.solo); }

// ── The group's two flags ───────────────────────────────────────────────────

export function setGroupMuted(g, muted) {
  if (!g) return;
  g.muted = !!muted;
  applyMix();
}

export function toggleGroup(g) { setGroupMuted(g, !g?.muted); }

/** What the cursor calls when a gesture flips a whole kind. */
export function toggleGroupOf(c) {
  const g = groupOf(c);
  if (!g) return null;
  toggleGroup(g);
  return !g.muted;
}
S._toggleGroupOf = toggleGroupOf;

export function setGroupSolo(g, solo) {
  if (!g) return;
  g.solo = !!solo;
  applyMix();
}

export function toggleSolo(g) { setGroupSolo(g, !g?.solo); }

// ── Everything back ─────────────────────────────────────────────────────────

/** True when no flag is set anywhere — drives the `all on` affordance. */
export function everythingOn() {
  if (GROUPS.some(g => g.muted || g.solo)) return false;
  for (const c of S.commitSlots) if (c && (c.mute || c.solo)) return false;
  return true;
}

export function allOn() {
  for (const g of GROUPS) { g.muted = false; g.solo = false; }
  for (const c of S.commitSlots) if (c) { c.mute = false; c.solo = false; }
  applyMix();
}
S._pinsAllOn = allOn;

// ── The selected pin ────────────────────────────────────────────────────────

/** A pin already on its way out is nobody's target. */
function _leaving(c) {
  if (c.type === 'cloud') return c._releasingAt > 0;
  return !!(c._playingToEnd || c._fadingOut || c._selfKilled);
}

/** A pin's ANCHOR: where the pin gesture RELEASED (Ek, 2026-09-05). A loop
 *  dropped by hand is anchored where the hand was; a loop or a cloud that a
 *  brush pinned at the end of its stroke (looper, wash), and a cloud whose
 *  path was drawn under a held pin, are anchored where the stroke ENDED — so
 *  under focus with tether on you hear just that stroke the moment you let
 *  go. Every reader of a pin's position goes through here: the focus law,
 *  the nearest-slot search, the selected pin, the nearest-pin line, the markers.
 *  Stamped on the slot as `anchorLon` / `anchorLat`; the fallbacks are for
 *  slots from older sessions and hand-built ones. Writes `out[0]`, `out[1]`
 *  (no allocation on the scheduler tick); false when the pin has no place. */
export function pinAnchorInto(c, out) {
  let lon, lat;
  if (c.type === 'cloud') {
    const f = c.frames && c.frames.length ? c.frames[c.frames.length - 1] : null;
    lon = c.anchorLon ?? (f ? f.lon : c.lon);
    lat = c.anchorLat ?? (f ? f.lat : c.lat);
  } else {
    const ps = c.particles, last = ps && ps.length ? ps[ps.length - 1] : null;
    lon = c.anchorLon ?? last?.lon;
    lat = c.anchorLat ?? last?.lat;
  }
  if (lon == null || lat == null) return false;
  out[0] = lon; out[1] = lat;
  return true;
}
const _anch = [0, 0];

function _pinLonLat(c) {
  return pinAnchorInto(c, _anch) ? [_anch[0], _anch[1]] : [null, null];
}

/** The slot index unpin (and the rail's mark) is about, or -1. `nearest`
 *  and `farthest` measure from the cursor (farthest, Ek 2026-09-06: let go
 *  of what is behind you without turning round); `oldest` is the one pinned
 *  first, by the same stamp the overflow rule reads. */
export function selectedPinSlot(lon, lat) {
  const mode = S.selectionMode;
  const oldest = mode === 'oldest', farthest = mode === 'farthest';
  let best = -1, bestKey = Infinity;
  for (let i = 0; i < S.commitSlotCount; i++) {
    const c = S.commitSlots[i];
    if (!c || _leaving(c)) continue;
    let key;
    if (oldest) {
      key = c._plantedAt || c._createdAt || 0;
    } else {
      const [pl, pt] = _pinLonLat(c);
      if (pl == null || pt == null || lon == null || lat == null) continue;
      key = angleBetweenSphere(pl, pt, lon, lat);
      if (farthest) key = -key;   // the same search, the sign flipped
    }
    if (key < bestKey) { bestKey = key; best = i; }
  }
  return best;
}
S._selectedPinSlot = selectedPinSlot;

// ── Persistence ─────────────────────────────────────────────────────────────
// The group half: two flags per group. The pin half (`mute`, `solo`) rides the
// commit slot in ui-export.js. There is no group set to round-trip — the groups
// are the two kinds, present in every session that has ever existed.

export function exportGroups() {
  return GROUPS.map(g => ({ key: g.key, muted: !!g.muted, solo: !!g.solo }));
}

export function restoreGroups(spec) {
  const raw = Array.isArray(spec) ? spec : [];
  for (const g of GROUPS) {
    const saved = raw.find(x => x && x.key === g.key);
    g.muted = !!saved?.muted;
    g.solo  = !!saved?.solo;
  }
  S._pinsDirty = true;
}
