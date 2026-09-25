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
// NO EXCEPTION ANY MORE (2026-09-24). Live material — one shared voicing per
// auditioned tool, moved by the knobs — is gone. AUDITION is the CURSOR's:
// with `S.auditionMode` on, the cursor plays whatever it reads through the
// live block (voicing 0) instead of each mark's own, and nothing is
// rewritten (grain-worklet-bridge.js `_voiceOf`, trigger.js `_applyAudition`).
// Every mark on the sphere is baked, always.
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

import { S, gp, FILTER_Q_FLAT, FILTER_Q_PEAK, FILTER_TYPE_OF } from './state.js';

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
/** The worklet's filter int from the UI's two fields: 0 when the switch is
 *  off, else the mode's number. Overrides win over the base block, as every
 *  other field does. */
export function filterTypeOf(ov, base) {
  if (!(ov.filterOn ?? base.filterOn ?? false)) return 0;
  return FILTER_TYPE_OF[ov.filterMode ?? base.filterMode] ?? 1;
}

/** ONE filter from the two-corner block (v15, 2026-09-23). A low-pass alone
 *  becomes `lp`, a high-pass alone `hp`; both set become a `bp` at the
 *  geometric centre with the Q the band implies. Nothing set is off. The old
 *  Q (0.1–20) lands on `res` through the same log curve the sheet uses. */
export function filterFromCorners(hp, lp, hq, lq) {
  const hpOn = hp > 22, lpOn = lp < 19500;
  const resOf = q => Math.max(0, Math.min(1,
    Math.log((q || FILTER_Q_FLAT) / FILTER_Q_FLAT) / Math.log(FILTER_Q_PEAK / FILTER_Q_FLAT)));
  if (hpOn && lpOn) {
    const fc = Math.sqrt(hp * lp);
    return { filterOn: true, filterMode: 'bp', cutoff: fc, res: resOf(fc / Math.max(1, lp - hp)) };
  }
  if (lpOn) return { filterOn: true, filterMode: 'lp', cutoff: lp, res: resOf(lq) };
  if (hpOn) return { filterOn: true, filterMode: 'hp', cutoff: hp, res: resOf(hq) };
  return { filterOn: false, filterMode: 'lp', cutoff: 1000, res: 0 };
}

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
    filterType:       filterTypeOf(ov, base),
    cutoff:           ov.cutoff           ?? base.cutoff           ?? 1000,
    res:              ov.res              ?? base.res              ?? 0,
    filterFreqJitter: ov.filterFreqJitter ?? base.filterFreqJitter ?? 0,
    panSpread:        ov.panSpread        ?? base.panSpread        ?? 0,
    // k (0 = all) and lensStep are deliberately NOT here (#233, reversing
    // #212's k half): how many marks the cursor reads, and in what order,
    // are LENS properties — live globals,
    // never frozen into a stroke. A voicing freezes only the SOUND. The lens
    // sends order live to every cursor voice via the cursorVoices post.
  };
}

// The field order above is fixed, so JSON.stringify of the block is a stable
// intern key. Built once per STROKE — never per particle and never per tick.
function _key(tile, params) { return tile + ' ' + JSON.stringify(params); }
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
 * START and per deposit: interned on tile + the live block, created if this
 * exact block has not been painted with before.
 */
export function voicingFor(tile, label) {
  ensureVoicings();
  const params = resolveGrainParams();
  tile = tile || '?';
  const key = _key(tile, params);
  const hit = S.voicings.find(v => v.key === key);
  if (hit) return hit.id;
  S.voicingSeq = (S.voicingSeq || LIVE_VOICING) + 1;
  S.voicings.push({ id: S.voicingSeq, key, tile, label: label || tile, params });
  return S.voicingSeq;
}

/** The tool that is playing, as tiles.js publishes it: `{ id, label }` — the
 *  position that is PLAYING, and null between presses (2026-09-11). Every
 *  caller here asks during a stroke, so the fallback is for the edge where
 *  tiles.js has not loaded yet. */
function _hand() {
  return S._handTile?.() ?? { id: S.brushKey ?? 'grain', label: '' };
}

// ── A KNOB RIDDEN WHILE PAINTING RIDES ON THE MARKS (Ek, 2026-09-25) ──────
// "when i sweep or ride the params while recording … i dont want a new voice
// created … it's just like a guitar pedal with the knobs." A stroke keeps ONE
// voicing, the pedal as it stood when the stroke began. A mark painted after
// a knob moved stores only what moved — `{ cutoff: 1840 }` — as a MARK
// OVERRIDE, and its grain plays with that on top of the stroke's voicing
// (grain-engine.worklet.js `_fireGrain`). One stroke is one worklet voice and
// one clock however far a knob travels; a period sweep reaches the clock too,
// since the next onset is taken from the mark just played.
//
// It replaced a voicing per changed mark (2026-08-29 → 09-25): a continuous
// sweep minted one every deposit, and each ran its own clock — a swept
// stroke played up to sixteen times as dense as the same stroke unswept, the
// voice cap silenced an arbitrary rest, and `S.voicings` grew without end.
//
// An override is interned on its own contents (absolute values, not deltas),
// so a knob moved and then left alone stamps one id on every mark after it.
// Id 0 means none. The comparison against the stroke's voicing is gated
// behind a cheap one against the last block seen, so a still pedal costs ~22
// compares per deposit and no allocation.
let _liveKeys = null, _lastSeen = null, _lastVo = -1, _lastOv = 0;
let _ovByKey = new Map(), _ovById = new Map();

export function ensureMarkOverrides() {
  if (!Array.isArray(S.markOverrides)) { S.markOverrides = []; S.markOverrideSeq = 0; }
  if (_ovById.size !== S.markOverrides.length) {
    _ovByKey = new Map(); _ovById = new Map();
    for (const o of S.markOverrides) { _ovByKey.set(o.key, o); _ovById.set(o.id, o); }
  }
  return S.markOverrides;
}

export function markOverrideById(id) {
  if (!id) return null;
  ensureMarkOverrides();
  return _ovById.get(id) || null;
}

function _internOverride(params) {
  ensureMarkOverrides();
  const key = JSON.stringify(params);
  const hit = _ovByKey.get(key);
  if (hit) return hit.id;
  const o = { id: ++S.markOverrideSeq, key, params };
  S.markOverrides.push(o);
  _ovByKey.set(key, o); _ovById.set(o.id, o);
  return o.id;
}

/** The mark override for a deposit on a stroke voiced `vo`: what the pedal
 *  has moved off that voicing since the stroke began, interned, or 0. */
export function markOverrideLive(vo) {
  const base = voicingById(vo)?.params;
  if (!base) return 0;
  const p = resolveGrainParams();
  if (!_liveKeys) _liveKeys = Object.keys(p);
  if (_lastSeen && vo === _lastVo) {
    let same = true;
    for (const k of _liveKeys) if (p[k] !== _lastSeen[k]) { same = false; break; }
    if (same) return _lastOv;
  }
  _lastSeen = _lastSeen || {};
  for (const k of _liveKeys) _lastSeen[k] = p[k];
  _lastVo = vo;
  let diff = null;
  for (const k of _liveKeys) {
    if (p[k] !== base[k]) (diff || (diff = {}))[k] = p[k];
  }
  _lastOv = diff ? _internOverride(diff) : 0;
  return _lastOv;
}

/** A stroke's voicing and one mark's override as one block — for the reader
 *  that needs the whole of what a grain plays with (the peak offset, a glow). */
export function markParams(vo, ov) {
  const v = vo ? voicingById(vo) : null;
  const base = v ? v.params : resolveGrainParams();
  const o = ov ? markOverrideById(ov) : null;
  return o ? { ...base, ...o.params } : base;
}

/** The overrides the marks in `particles` still point at, for a file. What
 *  an erase left behind is not written. */
export function exportMarkOverrides(particles) {
  const used = new Set();
  for (const p of particles ?? []) if (p?._ov) used.add(p._ov);
  return ensureMarkOverrides().filter(o => used.has(o.id)).map(o => ({ id: o.id, params: o.params }));
}

export function restoreMarkOverrides(list) {
  S.markOverrides = [];
  S.markOverrideSeq = 0;
  for (const o of Array.isArray(list) ? list : []) {
    const id = Number(o?.id);
    if (!(id > 0) || !o.params || typeof o.params !== 'object') continue;
    S.markOverrides.push({ id, key: JSON.stringify(o.params), params: o.params });
    if (id > S.markOverrideSeq) S.markOverrideSeq = id;
  }
  _ovById = new Map(); ensureMarkOverrides();
  _lastSeen = null;
  S.markOverrideGen = (S.markOverrideGen || 0) + 1;   // the bridge re-sends
}

/** Stamp the current brush's voicing onto a stroke. Returns the id. */
export function voicingForCurrentBrush() {
  const h = _hand();
  return voicingFor(h.id, h.label ?? '');
}

// ── AUDITION IS THE CURSOR'S (Ek, 2026-09-24) ──────────────────────────────
// "The sheet is the guitar pedal: whatever it reads gets baked in. The cursor
// is the monitor, read only. Audition should not change what's baked." So
// there is no live material: the auditioned-paint mechanism (2026-09-03 as
// wet paint, 2026-09-22 as audition) — one shared voicing per tool, moved in
// place by `syncLiveVoicing` every 20 ms, `freezeVoicing` at the pin — is
// gone. With `S.auditionMode` on, the CURSOR posts every candidate on
// voicing 0, the live block, and hears the pedal on whatever it reads; a
// pinned cloud's own playback is untouched, and so is every mark.
// (Riding a knob while painting still bakes a gradient along the stroke,
// mark by mark — on each mark's override, above.)
/** One-shot key migrations for a stored grain block. Read old key → write new
 *  → delete old; never a fallback at read time, or the old name lives forever.
 *  v14 (2026-09-07): `filterQ` was one number for both corners and became
 *  `hpfQ` / `lpfQ`. v15 (2026-09-23): the two corners became ONE filter —
 *  `filterType` / `cutoff` / `res` — through `filterFromCorners`. A block is
 *  a frozen worklet block, so it carries the int, not the switch and mode. */
export function migrateBlockKeys(p) {
  if (!p || typeof p !== 'object') return p;
  if (p.filterQ != null) {
    p.hpfQ = p.hpfQ ?? p.filterQ;
    p.lpfQ = p.lpfQ ?? p.filterQ;
    delete p.filterQ;
  }
  if ('hpfFreq' in p || 'lpfFreq' in p || 'hpfQ' in p || 'lpfQ' in p) {
    const f = filterFromCorners(+p.hpfFreq || 20, +p.lpfFreq || 20000, +p.hpfQ || 0.707, +p.lpfQ || 0.707);
    p.filterType = f.filterOn ? FILTER_TYPE_OF[f.filterMode] : 0;
    p.cutoff = f.cutoff; p.res = f.res;
    delete p.hpfFreq; delete p.lpfFreq; delete p.hpfQ; delete p.lpfQ;
  }
  return p;
}

// ── Persistence (session file, EXPORT_VERSION 8) ─────────────────────────────
// Same shape of contract as layers (§ E10 of the export audit): music, not rig,
// so session-only. Unlike layers this has no ordering hazard — nothing assigns
// a voicing lazily, so a particle carrying an unknown id simply plays with the
// live params until the table arrives. Restored early anyway, alongside them.

export function exportVoicings(used = null) {
  return { list: ensureVoicings().filter(v => !used || used.has(v.id))
             .map(v => ({ id: v.id, tile: v.tile, label: v.label, params: v.params })),
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
    // A file written before 2026-09-24 may mark a voicing `live`; it comes
    // back frozen with the sound the file gave it — nothing is live now.
    // Re-intern on the stored params so dedup keeps working after import:
    // painting again with the same brush and the same knobs must land on the
    // restored voicing rather than minting a duplicate beside it.
    const params = migrateBlockKeys({ ...resolveGrainParams(), ...v.params });
    list.push({ id, tile, label: typeof v.label === 'string' ? v.label : tile,
                params, key: _key(tile, params) });
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
S._markOverrideById       = markOverrideById;
S._markParams             = markParams;
S._peakOffsetForVoicing   = peakOffsetForVoicing;
S._grainPeakOffsetS       = grainPeakOffsetS;
