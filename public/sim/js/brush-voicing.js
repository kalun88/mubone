// ============================================================================
// brush-voicing.js — a stroke remembers the brush that painted it
//
// STEP 3 of docs/archive/BRUSH-MODEL.md, the behavioural half. The doc's claim about
// the finished model is "one sweep of the cursor plays each correctly, with no
// mode anywhere", and § 1 notes that sentence is false today. This is why it
// was false: nothing recorded which brush painted a mark, and the cursor had
// exactly ONE voice in the worklet with one global param block. Painting with
// `wash` and then selecting `shimmer` re-voiced everything already on the
// sphere, because the brush was a mode rather than a property of the material.
//
// FROZEN by default. Ek's call, and it is the composing answer: a stroke
// captures its brush's settings at the moment it is painted, and editing that
// brush afterwards changes only what you paint next. A finished passage stops
// moving under you. The cost is that the grain panel shows the SELECTED brush
// rather than what the cursor is currently hearing — see the TODO item.
//
// WET is the one exception, and it is the brush's to declare (Ek, 2026-09-03,
// see "Wet paint" below): a brush toggled wet owns ONE voicing, every stroke
// it paints points at it, and the brush's knobs keep moving those strokes for
// as long as it stays wet. A dry brush's strokes cannot be moved by anything.
//
// ── What a voicing is ───────────────────────────────────────────────────────
//
// A voicing is one resolved grain param block plus the TILE that produced it —
// the tile id, not the patch-bank key it used to record: pen and splatter on
// the same patch are different brushes, and wet paint has to find a brush's
// strokes by the brush. Strokes point at voicings; they never carry their own
// copy of the params.
//
// The dedup is the point. Painting five strokes without touching a knob must
// produce ONE voicing, not five — otherwise the worklet needs a voice per
// stroke and the whole idea collapses under a normal set. So dry voicings are
// interned on a key built from the tile plus the resolved params, and a stroke
// gets an int id. Turning a knob and turning it back lands on the same voicing
// again, which is correct rather than merely convenient.
//
// Voicing 0 is reserved and means "whatever the global params are right now" —
// the pre-step-3 behaviour. It is what material with no voicing plays with:
// nothing paints that way any more, but a v7-and-earlier session imports that
// way for the instant before the migration in ui-export.js assigns it the
// session's own embedded patch.
// ============================================================================

import { S, gp } from './state.js';

export const LIVE_VOICING = 0;   // reserved — follows the global params

const _DIR_MAP   = { fwd: 0, rev: 1, rand: 2, rnd: 2 };
const _CURVE_MAP = { hann: 0, tri: 1, rect: 2 };

/**
 * Build the worklet-shaped grain param block from the live global state.
 *
 * THE one place this field list exists. ui-presets.js `_syncWorkletParams()`
 * calls it too, rather than keeping a second copy — a divergence between the
 * block the cursor is sent and the block a stroke freezes would be silent, and
 * would present as "this brush sounds different after I reload", which is the
 * hardest class of bug to chase in this app. cc-mirror-audit.js exists because
 * this project has already been bitten by exactly one duplicated control list.
 */
export function resolveGrainParams() {
  const ov   = S.grainOverrides;
  const base = gp();
  return {
    period:           ov.period           ?? base.period,
    duration:         ov.duration         ?? base.duration,
    volume:           ov.volume           ?? base.volume,
    pitchShift:       ov.pitchShift       ?? base.pitchShift       ?? 0,
    pitchJitter:      ov.pitchJitter      ?? base.pitchJitter      ?? 0,
    periodVar:        ov.periodVar        ?? base.periodVar        ?? 0,
    durVar:           ov.durVar           ?? base.durVar           ?? 0,
    durJitter:        ov.durJitter        ?? base.durJitter        ?? 0,
    startJitter:      ov.startJitter      ?? base.startJitter      ?? 0,
    fadeRatio:        ov.fadeRatio        ?? base.fadeRatio        ?? 0.5,
    fadeMode:         (ov.fadeMode ?? base.fadeMode) === 'ms' ? 1 : 0,
    fadeMs:           ov.fadeMs           ?? base.fadeMs           ?? 0.020,
    probability:      S.grainProbability ?? 1.0,
    direction:        _DIR_MAP[S.grainDirection]   ?? 0,
    envShape:         _CURVE_MAP[S.grainCurveType] ?? 0,
    hpfFreq:          ov.hpfFreq          ?? base.hpfFreq          ?? 20,
    lpfFreq:          ov.lpfFreq          ?? base.lpfFreq          ?? 20000,
    hpfQ:             ov.hpfQ             ?? base.hpfQ             ?? 0.707,
    lpfQ:             ov.lpfQ             ?? base.lpfQ             ?? 0.707,
    filterFreqJitter: ov.filterFreqJitter ?? base.filterFreqJitter ?? 0,
    panSpread:        ov.panSpread        ?? base.panSpread        ?? 0,
    // k, kAllMode and kSeqMode are deliberately NOT here (#233, reversing
    // #212's k half): how many marks the cursor reads, whether the count
    // applies at all, and in what order, are LENS properties — live globals,
    // never frozen into a stroke. A voicing freezes only the SOUND. The lens
    // sends order live to every cursor voice via the cursorVoices post.
  };
}

// The field order above is fixed, so JSON.stringify of the block is a stable
// intern key. Built once per STROKE — never per particle and never per tick.
function _key(tile, params) { return tile + ' ' + JSON.stringify(params); }
function _wetKey(tile) { return 'wet ' + tile; }
// ── Where a grain is loudest (Ek, 2026-09-02) ───────────────────────────────
// A live mark is a POINT in the take — its colour and size describe that
// instant — and the grain it fires starts THIS far before it, so the point
// sits where the envelope peaks. Under a plain Hann that is half the duration
// (the mark is the centre of the window, TGrains-style); under a short attack
// it is the fade length; under rect it is zero. The old convention, grain
// starts AT the mark, put the mark at the foot of the attack — the one part of
// the window you can barely hear — so a hit painted on a mark was a swell,
// and the mark drawn big for a hit was one or two AFTER the mark you heard it
// from. Pitch and direction move the read head at a different rate, so they
// are in the arithmetic too; jitter is not (it averages to zero). Mirrors the
// worklet's fade resolution in _fireGrain: frEff, the 2 ms floor, the ½ cap.
//
// APPLIED BY THE READER, NOT BAKED INTO THE MARK. A mark stores only its
// moment (`grainStart`); the bridge subtracts this offset per candidate from
// the params of whichever voice will PLAY the mark — its frozen voicing, the
// live params under the filter, a cloud's own block. Baking it at paint time
// was wrong the moment a different engine read the mark: a 50 ms filter over a
// stroke painted with a 300 ms Hann started 150 ms before every dot and never
// reached it. Loops and triggers read moments and never see this.
// Accepts the resolved numeric block or a raw patch (string curve/direction).
const _PEAK_DIR   = { fwd: 0, rev: 1, rand: 2, rnd: 2 };
const _PEAK_CURVE = { hann: 0, tri: 1, rect: 2 };
export function grainPeakOffsetS(p) {
  if (!p) return 0;
  const dur = p.duration ?? 0;
  if (!(dur > 0)) return 0;
  const shape = _PEAK_CURVE[p.curveType] ?? p.envShape ?? 0;
  if (shape === 2) return 0;                            // rect — instant on
  const msMode = p.fadeMode === 1 || p.fadeMode === 'ms';
  let fr = msMode ? (p.fadeMs ?? 0.020) / dur : (p.fadeRatio ?? 0.5);
  if (fr <= 0) return 0;
  const floor = 0.002 / dur;
  if (fr < floor) fr = floor;
  if (fr > 0.5) fr = 0.5;
  const tPeak = fr * dur;
  const rate  = Math.pow(2, (p.pitchShift ?? 0) / 1200);
  const dir   = _PEAK_DIR[p.direction] ?? p.direction ?? 0;
  return dir === 1 ? rate * (dur - tPeak) : rate * tPeak;
}

/** The peak offset for a voicing id — 0 / unknown means the live params. */
export function peakOffsetForVoicing(id) {
  const v = id ? voicingById(id) : null;
  return grainPeakOffsetS(v ? v.params : resolveGrainParams());
}

export function ensureVoicings() {
  if (!Array.isArray(S.voicings)) { S.voicings = []; S.voicingSeq = LIVE_VOICING; }
  return S.voicings;
}

export function voicingById(id) {
  if (!id) return null;                       // 0 / undefined → live params
  return ensureVoicings().find(v => v.id === id) || null;
}

/**
 * The voicing a stroke starts on, for the brush in the hand. Called at STROKE
 * START. Dry: interned on tile + the live block, created if this exact block
 * has not been painted with before. Wet: the ONE voicing this tile owns, its
 * params brought up to the live block, created on the first wet stroke.
 */
export function voicingFor(tile, label, wet = false) {
  ensureVoicings();
  const params = resolveGrainParams();
  tile = tile || '?';
  if (wet) {
    const own = S.voicings.find(v => v.wet && v.tile === tile);
    if (own) {
      for (const k of Object.keys(params)) own.params[k] = params[k];
      S._voicingChanged?.(own.id);
      return own.id;
    }
    S.voicingSeq = (S.voicingSeq || LIVE_VOICING) + 1;
    S.voicings.push({ id: S.voicingSeq, key: _wetKey(tile), tile, label: label || tile, params, wet: true });
    return S.voicingSeq;
  }
  const key = _key(tile, params);
  const hit = S.voicings.find(v => !v.wet && v.key === key);
  if (hit) return hit.id;

  S.voicingSeq = (S.voicingSeq || LIVE_VOICING) + 1;
  S.voicings.push({ id: S.voicingSeq, key, tile, label: label || tile, params, wet: false });
  return S.voicingSeq;
}

/** The brush in the hand, as tiles.js publishes it: `{ id, label, wet }` —
 *  the position that is PLAYING, and null between presses (2026-09-11). Every
 *  caller here asks during a stroke, so the fallback is for the edge where
 *  tiles.js has not loaded yet. */
function _hand() {
  return S._handTile?.() ?? { id: S.brushKey ?? 'grain', label: '', wet: false };
}

// ── Re-freezing WHILE the stroke is being painted (Ek, 2026-08-29) ─────────
// "If I'm painting a stroke and I have period go shorter, that's a committed
// baked stroke." The visual half already worked — widen the head mid-stroke and
// the particles visibly spread — and the sound has to behave the same way. It
// matters most for gestures mapped to params, which move continuously as you
// paint and never touch a knob the UI could notice.
//
// The obstacle is the intern key: it is a JSON.stringify of 22 fields, which is
// why the note above says "built once per STROKE — never per particle". So the
// expensive path is gated behind a cheap one. `_scratch` is filled IN PLACE,
// compared field-by-field against the last resolved block, and only a real
// change pays for a stringify and a table lookup. Twenty-two numeric compares
// and no allocation is nothing at deposit rate; an unchanged stroke costs
// almost exactly what it cost before.
const _scratch = {};
let _liveKeys = null, _lastVo = 0, _lastTile = null, _lastWet = false, _lastSeen = null;

export function resolveGrainParamsInto(out) {
  const src = resolveGrainParams();
  if (!_liveKeys) _liveKeys = Object.keys(src);
  for (const k of _liveKeys) out[k] = src[k];
  return out;
}

/** The voicing for the params live RIGHT NOW, cheap when nothing has moved.
 *  Call per deposit while painting; `voicingForCurrentBrush()` remains the
 *  once-per-stroke entry point. */
export function voicingForCurrentBrushLive() {
  const h  = _hand();
  const p  = resolveGrainParams();
  if (_lastSeen && h.id === _lastTile && !!h.wet === _lastWet) {
    let same = true;
    for (const k of _liveKeys) if (p[k] !== _lastSeen[k]) { same = false; break; }
    if (same) return _lastVo;
  }
  if (!_liveKeys) _liveKeys = Object.keys(p);
  _lastSeen = _lastSeen || {};
  for (const k of _liveKeys) _lastSeen[k] = p[k];
  _lastTile = h.id; _lastWet = !!h.wet;
  _lastVo = voicingFor(h.id, h.label ?? '', !!h.wet);
  return _lastVo;
}

/** Stamp the current brush's voicing onto a stroke. Returns the id. */
export function voicingForCurrentBrush() {
  const h = _hand();
  return voicingFor(h.id, h.label ?? '', !!h.wet);
}

// ── Wet paint (Ek, 2026-09-03) ───────────────────────────────────────────────
// "I can paint with a wet-toggled brush, switch to a dry brush, paint some,
// then change the params of that wet brush and all strokes that were painted
// with that brush will change." A brush is DRY by default and its strokes
// freeze, above. A brush toggled WET owns one voicing instead, every stroke it
// paints points at that voicing, and the brush's knobs move all of them —
// whether the cursor is on them or not — for as long as the brush stays wet.
// It is a property of the BRUSH, never a mode on the hand: a dry brush's
// strokes cannot be moved by anything, which is what makes them trustworthy,
// and a wet brush is a tile you can see on the palette. This replaced audition
// (2026-08-29..09-03), a read-only tile that heard everything through one
// engine and could not paint.
//
// Only the SOUND moves: flow, head and the experimental placement constants
// decide where marks land, and a mark already on the sphere is not re-placed.
//
// Nothing is heard "through" anything. The wet voicing's params are edited IN
// PLACE and the bridge posts each voice's params on every tick, so the worklet
// simply sees new numbers; a stroke not under the cursor is not playing and
// costs nothing. Turning wet OFF dries the brush's strokes where they sound —
// the voicing becomes an ordinary frozen block (`dryVoicing`) — and turning it
// back on does not re-wet them; only what is painted next is wet. A brush that
// disappears (a custom tile deleted, a session opened on a rig without it)
// dries the same way, so its strokes keep their last sound rather than going
// silent or jumping to some other brush's.

/** Bring the hand's wet voicing up to the live block. Called from the
 *  scheduler-side candidate post every 20 ms, so a pot, an OSC value or a
 *  sheet row moves the strokes within a tick; allocation-free, ~22 compares
 *  when nothing has moved. Returns the voicing id it changed, or 0. */
export function syncWetVoicing() {
  const h = S._handTile?.();
  if (!h?.wet) return 0;
  const v = S.voicings?.find(x => x.wet && x.tile === h.id);
  if (!v) return 0;
  resolveGrainParamsInto(_scratch);
  let same = true;
  for (const k of _liveKeys) if (_scratch[k] !== v.params[k]) { same = false; break; }
  if (same) return 0;
  for (const k of _liveKeys) v.params[k] = _scratch[k];
  S._voicingChanged?.(v.id);
  return v.id;
}

/** Every voicing that is still WET, by id — the marks whose sound can still
 *  move. Asked once per frame by the renderer (the ring on a wet mark), so it
 *  fills a reused array rather than returning a fresh one, and the caller must
 *  not hold on to it across frames. Wet is a property of the BRUSH, not of the
 *  hand: a brush stays wet until it is dried, and the hand is null between
 *  presses — so this is read from the voicing table, never from `_hand()`. */
const _wetIds = [];
export function wetVoicingIds() {
  _wetIds.length = 0;
  const list = S.voicings;
  if (list) for (const v of list) if (v.wet) _wetIds.push(v.id);
  return _wetIds;
}

/** One-shot key migrations for a stored grain block. Read old key → write new
 *  → delete old; never a fallback at read time, or the old name lives forever.
 *  v14 (2026-09-07): `filterQ` was one number for both corners and became
 *  `hpfQ` / `lpfQ` — a block that stored the shared one gets it on both, which
 *  is exactly the filter it had. */
export function migrateBlockKeys(p) {
  if (p && typeof p === 'object' && p.filterQ != null) {
    p.hpfQ = p.hpfQ ?? p.filterQ;
    p.lpfQ = p.lpfQ ?? p.filterQ;
    delete p.filterQ;
  }
  return p;
}

/** Dry a brush's strokes where they sound: its wet voicing becomes a frozen
 *  block. Returns how many voicings dried (0 or 1). */
export function dryVoicing(tile) {
  let n = 0;
  for (const v of ensureVoicings()) {
    if (!v.wet || v.tile !== tile) continue;
    v.wet = false; v.key = _key(tile, v.params); n++;
  }
  if (n) { S._voicingChanged?.(0); _lastSeen = null; }
  return n;
}

// ── Persistence (session file, EXPORT_VERSION 8) ─────────────────────────────
// Same shape of contract as layers (§ E10 of the export audit): music, not rig,
// so session-only. Unlike layers this has no ordering hazard — nothing assigns
// a voicing lazily, so a particle carrying an unknown id simply plays with the
// live params until the table arrives. Restored early anyway, alongside them.

export function exportVoicings() {
  // `wet` written only when true, like `trig` on a particle.
  return { list: ensureVoicings().map(v => ({ id: v.id, tile: v.tile, label: v.label, params: v.params,
                                             ...(v.wet ? { wet: true } : {}) })),
           seq: S.voicingSeq ?? LIVE_VOICING };
}

export function restoreVoicings(spec) {
  const raw = Array.isArray(spec?.list) ? spec.list : null;
  if (!raw) { S.voicings = []; S.voicingSeq = LIVE_VOICING; return; }

  const seen = new Set();
  const list = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const id = Number(v.id);
    // id 0 is reserved for the live params and must never be handed out as a
    // stored voicing, or a stroke pointing at it would silently follow the
    // global knobs — which is precisely the behaviour frozen mode removes.
    if (!Number.isFinite(id) || id === LIVE_VOICING || seen.has(id)) continue;
    if (!v.params || typeof v.params !== 'object') continue;
    seen.add(id);
    // v8–v10 files recorded the patch-bank key as `brushKey`; it is read once
    // here as the tile name so the dedup key stays stable, and never matches
    // a tile — which is right, because nothing can tell which tile it was.
    // A renamed tile (tiles.js _RENAMED_TILES) keeps its voicings under its new name.
    const named = typeof v.tile === 'string' ? v.tile : (typeof v.brushKey === 'string' ? v.brushKey : '?');
    const tile = S._migrateTileId ? S._migrateTileId(named) : named;
    // A wet voicing follows its brush, so it stays wet only if this rig has
    // that tile AND the tile is still wet — otherwise its strokes dry here,
    // with the sound the file gave them. One wet voicing per tile.
    const wet = !!v.wet && !!S._tileIsWet?.(tile) && !list.some(x => x.wet && x.tile === tile);
    // Re-intern on the stored params so dedup keeps working after import:
    // painting again with the same brush and the same knobs must land on the
    // restored voicing rather than minting a duplicate beside it.
    const params = migrateBlockKeys({ ...resolveGrainParams(), ...v.params });
    list.push({ id, tile, label: typeof v.label === 'string' ? v.label : tile,
                params, wet, key: wet ? _wetKey(tile) : _key(tile, params) });
  }
  _lastSeen = null;
  S.voicings = list;
  const maxId = list.reduce((m, v) => Math.max(m, v.id), LIVE_VOICING);
  S.voicingSeq = Math.max(Number(spec?.seq) || LIVE_VOICING, maxId);
}

/**
 * One-shot migration for sessions written before voicings existed (v7 and
 * earlier). Those files carry `patch` — the resolved patch object the session
 * was actually played on (v5, audit § E4) — so their material does not have to
 * be guessed at or left following whatever the current brush happens to be. It
 * gets one voicing built from the patch it was really painted with.
 *
 * Returns the id to stamp on every imported particle, or 0 to leave them on the
 * live params when the file carries no patch either.
 */
export function voicingFromLegacyPatch(patch, label) {
  if (!patch || typeof patch !== 'object') return LIVE_VOICING;
  ensureVoicings();
  // Resolve against the live block for anything the patch does not carry —
  // a patch holds the grain params, not S.grainDirection or the probability.
  const params = { ...resolveGrainParams() };
  for (const k of Object.keys(params)) {
    if (patch[k] !== undefined && typeof patch[k] === typeof params[k]) params[k] = patch[k];
  }
  const key = _key('legacy', params);
  const hit = S.voicings.find(v => v.key === key);
  if (hit) return hit.id;
  S.voicingSeq = (S.voicingSeq || LIVE_VOICING) + 1;
  S.voicings.push({ id: S.voicingSeq, key, tile: 'legacy', label: label || 'imported', params, wet: false });
  return S.voicingSeq;
}

S._voicingForCurrentBrush = voicingForCurrentBrush;
S._voicingById            = voicingById;
S._syncWetVoicing         = syncWetVoicing;
S._wetVoicingIds          = wetVoicingIds;
S._peakOffsetForVoicing   = peakOffsetForVoicing;
S._grainPeakOffsetS       = grainPeakOffsetS;
