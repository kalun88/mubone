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
// AUDITIONED paint is the one exception, and the PRESS declares it (2026-09-22,
// see "Auditioned paint" below): a tool being AUDITIONED owns ONE voicing, every stroke
// it paints points at it, and the brush's knobs keep moving those strokes for
// for as long as it exists. Paint made by PLAYING is frozen at the stroke.
//
// ── What a voicing is ───────────────────────────────────────────────────────
//
// A voicing is one resolved grain param block plus the TILE that produced it —
// the tile id, not the patch-bank key it used to record: pen and splatter on
// the same patch are different brushes, and auditioned paint has to find a tool's
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
function _liveKey(tile) { return 'live ' + tile; }
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

// An index over the list, rebuilt when the list is replaced (restore) or grows
// (a new voicing). `voicingById` runs per candidate per cloud per 10 ms tick
// in the bridge, and the list was searched linearly every time (2026-09-16).
let _byIdList = null, _byIdLen = -1;
const _byId = new Map();
export function voicingById(id) {
  if (!id) return null;                       // 0 / undefined → live params
  const list = ensureVoicings();
  if (list !== _byIdList || list.length !== _byIdLen) {
    _byId.clear();
    for (const v of list) _byId.set(v.id, v);
    _byIdList = list; _byIdLen = list.length;
  }
  return _byId.get(id) || null;
}

/**
 * The voicing a stroke starts on, for the brush in the hand. Called at STROKE
 * START. Dry: interned on tile + the live block, created if this exact block
 * has not been painted with before. Live: the ONE voicing this tile owns, its
 * params brought up to the live block, created on its first auditioned stroke.
 */
export function voicingFor(tile, label, live = false) {
  ensureVoicings();
  const params = resolveGrainParams();
  tile = tile || '?';
  if (live) {
    const own = S.voicings.find(v => v.live && v.tile === tile);
    if (own) {
      for (const k of Object.keys(params)) own.params[k] = params[k];
      S._voicingChanged?.(own.id);
      return own.id;
    }
    S.voicingSeq = (S.voicingSeq || LIVE_VOICING) + 1;
    S.voicings.push({ id: S.voicingSeq, key: _liveKey(tile), tile, label: label || tile, params, live: true });
    return S.voicingSeq;
  }
  const key = _key(tile, params);
  const hit = S.voicings.find(v => !v.live && v.key === key);
  if (hit) return hit.id;

  S.voicingSeq = (S.voicingSeq || LIVE_VOICING) + 1;
  S.voicings.push({ id: S.voicingSeq, key, tile, label: label || tile, params, live: false });
  return S.voicingSeq;
}

/** The tool that is playing, as tiles.js publishes it: `{ id, label, live }` —
 *  the position that is PLAYING, and null between presses (2026-09-11). Every
 *  caller here asks during a stroke, so the fallback is for the edge where
 *  tiles.js has not loaded yet. */
function _hand() {
  return S._handTile?.() ?? { id: S.brushKey ?? 'grain', label: '', live: false };
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
let _liveKeys = null, _lastVo = 0, _lastTile = null, _lastLive = false, _lastSeen = null;

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
  if (_lastSeen && h.id === _lastTile && !!h.live === _lastLive) {
    let same = true;
    for (const k of _liveKeys) if (p[k] !== _lastSeen[k]) { same = false; break; }
    if (same) return _lastVo;
  }
  if (!_liveKeys) _liveKeys = Object.keys(p);
  _lastSeen = _lastSeen || {};
  for (const k of _liveKeys) _lastSeen[k] = p[k];
  _lastTile = h.id; _lastLive = !!h.live;
  _lastVo = voicingFor(h.id, h.label ?? '', !!h.live);
  return _lastVo;
}

/** Stamp the current brush's voicing onto a stroke. Returns the id. */
export function voicingForCurrentBrush() {
  const h = _hand();
  return voicingFor(h.id, h.label ?? '', !!h.live);
}

// ── AUDITIONED PAINT (Ek, 2026-09-22; was "wet paint", 2026-09-03) ─────────
// The rule was a per-tool toggle — a brush you had marked owned one voicing,
// and every stroke it painted shared it, so moving a knob moved all of them.
// The toggle is gone and the mechanism stays, because the mechanism was always
// the good part. What declares it now is HOW THE PAINT WAS MADE:
//
//     Anything placed while AUDITIONING is live, by definition. Anything placed
//     by PLAYING freezes at the stroke, and the pin is where it freezes.
//
// That is Ek's ruling of 2026-09-22 — "anything placed on the world with
// audition tile should by definition be always live … let's sunset the term live
// and the concept" — and it is the same model the pin already states: paint is
// live until you fix it, and auditioning is the one act that never fixes it.
// The bench is where you are BUILDING a tool, so its marks have to follow the
// numbers you are building with; the moment you play the tool for real, from
// the spacebar or a key, what you paint is what you heard.
//
// It covers TAPE as well as grain (Ek, same ruling): audition a loop, move any
// parameter, and every auditioned loop on the sphere moves with it.
//
// Nothing is heard "through" anything: the live voicing's params ARE the live
// block, and the marks read it where they sound. Nothing DRAWS liveness since
// 2026-09-22: it was worth a ring while it was declared by a gesture and so
// invisible, and it stopped being worth one the moment AUDITION became a switch
// you can see at the top of the rail.

/** Bring the playing tool's LIVE voicing up to the live block. Called from the
 *  scheduler-side candidate post every 20 ms, so a pot, an OSC value or a
 *  sheet row moves the strokes within a tick; allocation-free, ~22 compares
 *  when nothing has moved. Returns the voicing id it changed, or 0. */
export function syncLiveVoicing() {
  // LIVENESS IS THE VOICING'S, NOT THE HAND'S. This asked the hand, which is
  // null between presses, so a knob moved AFTER the audition ended reached
  // nothing and the marks sounded exactly as they had (Ek, 2026-09-22:
  // "none of the stuff changes when i retrigger an audition line. same with
  // audition-based grains").
  //
  // Which tile's live voicing follows the block depends on what owns the block:
  //   auditioning        — the bench's tool owns it, and that is `h.id`
  //   a position playing — that tool owns it, so nothing here may move
  //   nothing playing    — the BENCH owns it, because benching applies it
  const h = S._handTile?.();
  const tile = h ? (h.live ? h.id : null) : S._benchTileId?.();
  if (!tile) return 0;
  const v = S.voicings?.find(x => x.live && x.tile === tile);
  if (!v) return 0;
  resolveGrainParamsInto(_scratch);
  let same = true;
  for (const k of _liveKeys) if (_scratch[k] !== v.params[k]) { same = false; break; }
  if (same) return 0;
  for (const k of _liveKeys) v.params[k] = _scratch[k];
  S._voicingChanged?.(v.id);
  return v.id;
}

// (`liveVoicingIds` is gone, 2026-09-22 — the renderer's ring was its only
// caller, and the ring went with it. Liveness is still a property of the
// voicing and still makes its params follow; it is just not drawn, because
// AUDITION is a mode you can see in the rail.)

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

/** FREEZE a tool's auditioned strokes where they sound: its live voicing
 *  becomes an ordinary frozen block. Nothing calls this from a button any more
 *  — the toggle is gone — and it is kept because the PIN is a freeze and will
 *  want it: a pin press or a session import can end a voicing's
 *  liveness without touching what it sounds like. Returns how many froze. */
export function freezeVoicing(tile) {
  let n = 0;
  for (const v of ensureVoicings()) {
    if (!v.live || v.tile !== tile) continue;
    v.live = false; v.key = _key(tile, v.params); n++;
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
  // `live` written only when true, like `trig` on a particle.
  return { list: ensureVoicings().map(v => ({ id: v.id, tile: v.tile, label: v.label, params: v.params,
                                             ...(v.live ? { live: true } : {}) })),
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
    // Liveness no longer depends on a tool's state — no tool has one (the wet
    // toggle went, 2026-09-22). A voicing that was live when the file was
    // written comes back live, one per tile; the second one freezes, with the
    // sound the file gave it.
    const live = !!v.live && !list.some(x => x.live && x.tile === tile);
    // Re-intern on the stored params so dedup keeps working after import:
    // painting again with the same brush and the same knobs must land on the
    // restored voicing rather than minting a duplicate beside it.
    const params = migrateBlockKeys({ ...resolveGrainParams(), ...v.params });
    list.push({ id, tile, label: typeof v.label === 'string' ? v.label : tile,
                params, live, key: live ? _liveKey(tile) : _key(tile, params) });
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
  S.voicings.push({ id: S.voicingSeq, key, tile: 'legacy', label: label || 'imported', params, live: false });
  return S.voicingSeq;
}

S._voicingForCurrentBrush = voicingForCurrentBrush;
S._voicingById            = voicingById;
S._syncLiveVoicing        = syncLiveVoicing;
S._peakOffsetForVoicing   = peakOffsetForVoicing;
S._grainPeakOffsetS       = grainPeakOffsetS;
