// ============================================================================
// MIDI + KEYBOARD MAPPING SYSTEM
// ============================================================================

import {
  S,
  SEARCH_RADIUS_MIN, SEARCH_RADIUS_MAX, SEARCH_RADIUS_STEP,
  DEBUG, AXIS_SOURCES, axisHeld,
  GATE_METER_MAX, GATE_METER_GAMMA, LEVEL_FADER_GAMMA
} from './state.js';
import { toggleHandsfree } from './handsfree.js';
import { undoLastStroke, redoLastStroke } from './ui-samples.js';
import {
  toggleNearestMode, clearAllCommits,
  updatePlaybackControls, flashRadiusTooltip,
  releaseCommit
} from './ui-presets.js';
import { sweep } from './ui-sweep.js';
import { startEraseStroke, stopEraseStroke } from './erase.js';
import { setMixdownCursorGain, setMixdownHouseGain, gateFracToRms } from './ui-meters.js';
import { setScanMuted } from './ui-meters.js';
import { findNearestSeedSlot } from './grain.js';
import { getCursorLonLat, screenToLonLat } from './sphere.js';
import {
  fmtRange, scaleControl, clampGamma, toNorm, fromNorm, clampReal, fmtNumber,
  rangeMin, rangeMax, baseGamma
} from './scale.js';

// Each action definition: { id, label, key, osc, type, ccFn?, range? }
// id: null entries are section headers (group: 'label')
// type: 'hold' | 'trigger' | 'cc' (continuous 0-127)
// osc: OSC path string or null
//
// fmt: for non-cc actions this is a literal describing the payload ('bang',
// 'int 0|1', 'bang=cycle, str=set (…)').  For cc actions it is DERIVED from
// `range` by fmtRange() at the bottom of this block — don't hand-write it, or
// the modal and the scaling maths drift apart the way preset_select did.
//
// range: { min, max, unit?, int?, curve?, maxFn? } — the real-unit span the
// ccFn covers across MIDI 0–127, and the curve it already applies internally.
// Consumed by the accessory table so a pot's limits can be set in cents and Hz
// rather than percentages.  See scale.js for the full contract.
const ACTIONS = [

  // ── Palette (2026-09-03, #327; positions 1–9 since 2026-09-11) ───────────
  // ONE ROW PER POSITION (docs/PALETTE-GUI.md § 1). A POSITION is a button and
  // this is where it is bound, whatever sits there today — the performer
  // designs the palette first and maps to positions after (Ek). Every key on
  // a position is an explicit row in the key map — seeded from the factory
  // set once, the next free digit given on a drop — and it FOLLOWS ITS TILE
  // when the strip is rearranged (S._paletteReordered, 2026-09-12). The
  // SPACEBAR and the sphere's left-click are the HAND's (tiles.js) and are
  // learnable onto nothing.
  //
  // `type`, `fmt` and `tip` are GETTERS because the tile's VERB decides them
  // and the verb is set in the tile's drawer at any time: a momentary tile is
  // a `hold` taking `int 0|1`, a bang or a toggle is a `trigger` taking a
  // bang. Five places read `.type` — `_fireGesture`, `_learnGesture`, the CC
  // path, the key-learn path and `osc.js`'s release-edge guard — and a getter
  // keeps every one of them correct with no call-site change. The row is a
  // plain object everywhere else; nothing spreads it, which a getter would
  // flatten.
  //
  // There were 27 rows until 2026-09-11 — tap · toggle · momentary per
  // position — and before that a four-row slot with `arm` and `cycle`. Both
  // asked the CALLER how to fire; the tile says now.
  { id: null, group: 'palette' },
  { id: 'palette_1', label: 'tile 1', row: () => S._paletteRow?.(1), key: '—', osc: '/palette/1',
    get type() { return S._paletteType?.(1) ?? 'trigger'; },
    get fmt()  { return this.type === 'hold' ? 'int 0|1' : 'bang'; },
    get tip()  { return S._paletteTip?.(1) ?? 'position 1'; } },
  { id: 'palette_2', label: 'tile 2', row: () => S._paletteRow?.(2), key: '—', osc: '/palette/2',
    get type() { return S._paletteType?.(2) ?? 'trigger'; },
    get fmt()  { return this.type === 'hold' ? 'int 0|1' : 'bang'; },
    get tip()  { return S._paletteTip?.(2) ?? 'position 2'; } },
  { id: 'palette_3', label: 'tile 3', row: () => S._paletteRow?.(3), key: '—', osc: '/palette/3',
    get type() { return S._paletteType?.(3) ?? 'trigger'; },
    get fmt()  { return this.type === 'hold' ? 'int 0|1' : 'bang'; },
    get tip()  { return S._paletteTip?.(3) ?? 'position 3'; } },
  { id: 'palette_4', label: 'tile 4', row: () => S._paletteRow?.(4), key: '—', osc: '/palette/4',
    get type() { return S._paletteType?.(4) ?? 'trigger'; },
    get fmt()  { return this.type === 'hold' ? 'int 0|1' : 'bang'; },
    get tip()  { return S._paletteTip?.(4) ?? 'position 4'; } },
  { id: 'palette_5', label: 'tile 5', row: () => S._paletteRow?.(5), key: '—', osc: '/palette/5',
    get type() { return S._paletteType?.(5) ?? 'trigger'; },
    get fmt()  { return this.type === 'hold' ? 'int 0|1' : 'bang'; },
    get tip()  { return S._paletteTip?.(5) ?? 'position 5'; } },
  { id: 'palette_6', label: 'tile 6', row: () => S._paletteRow?.(6), key: '—', osc: '/palette/6',
    get type() { return S._paletteType?.(6) ?? 'trigger'; },
    get fmt()  { return this.type === 'hold' ? 'int 0|1' : 'bang'; },
    get tip()  { return S._paletteTip?.(6) ?? 'position 6'; } },
  { id: 'palette_7', label: 'tile 7', row: () => S._paletteRow?.(7), key: '—', osc: '/palette/7',
    get type() { return S._paletteType?.(7) ?? 'trigger'; },
    get fmt()  { return this.type === 'hold' ? 'int 0|1' : 'bang'; },
    get tip()  { return S._paletteTip?.(7) ?? 'position 7'; } },
  { id: 'palette_8', label: 'tile 8', row: () => S._paletteRow?.(8), key: '—', osc: '/palette/8',
    get type() { return S._paletteType?.(8) ?? 'trigger'; },
    get fmt()  { return this.type === 'hold' ? 'int 0|1' : 'bang'; },
    get tip()  { return S._paletteTip?.(8) ?? 'position 8'; } },
  { id: 'palette_9', label: 'tile 9', row: () => S._paletteRow?.(9), key: '—', osc: '/palette/9',
    get type() { return S._paletteType?.(9) ?? 'trigger'; },
    get fmt()  { return this.type === 'hold' ? 'int 0|1' : 'bang'; },
    get tip()  { return S._paletteTip?.(9) ?? 'position 9'; } },
  { id: 'wet_toggle', label: 'wet paint (toggle)', key: '—', osc: '/palette/wet', fmt: 'int 0|1, bang=toggle', type: 'trigger',
    tip: 'wet on/off for the brush in the hand — the switch in its sheet head. A wet brush\'s knobs keep moving every stroke it painted; off dries them where they sound' },

  // ── Source / sampler (#247 — the chain is source → brush → lens) ──────────
  // ── Recording ─────────────────────────────────────────────────────────────
  // `recpaint` and `trace_toggle` — "activate (momentary)" and "activate
  // (toggle)", on `/trace` and `/trace/toggle`, with spacebar and the sphere
  // click as their factory keys — stood at the head of this group until
  // 2026-09-11. Both meant "fire the tool in the hand", and with arming gone
  // there was no hand. The hand is back since 2026-09-12 (tiles.js `inHand`),
  // but not as a ROW: the spacebar and the sphere's click are wired to it
  // directly, reserved, and refused by the learn — so there is still nothing
  // here to bind.
  { id: null, group: 'recording' },
  { id: 'handsfree',   label: 'handsfree (toggle)',          key: 'H',                 osc: '/handsfree',         fmt: 'bang',             type: 'trigger',
    tip: 'toggle handsfree arm — when on, toggle-trace segments buffers at the paint gate threshold, with its own envelope' },

  // ── Trigger tool ──────────────────────────────────────────────────────────
  { id: 'trigger_chop', label: 'chop (toggle)',                key: '—',                 osc: '/trigger/chop',    fmt: 'bang=toggle, int 0|1',  type: 'trigger',
    tip: 'chop on/off — when on, a trigger take is split into separate triggers at its silences. affects the NEXT take recorded; the gap threshold stays where you set it' },

  // ── Commit (D) ────────────────────────────────────────────────────────────
  // ── Session ────────────────────────────────────────────────────────────────
  { id: null, group: 'session' },
  { id: 'mute',         label: 'system mute (toggle)',      key: 'M',                 osc: '/mute',              fmt: 'int 0|1',          type: 'trigger',
    tip: 'silence all audio output — each press flips it. The momentary one is below' },
  { id: 'dry_mute',     label: 'dry monitor mute (toggle)', key: '—',                 osc: '/dry/mute',          fmt: 'bang',             type: 'trigger',
    tip: 'the footer\'s dry switch: muted is off; unmuting returns to the mode it was in — on, or auto' },
  { id: 'dry_mute_hold', label: 'dry monitor mute (momentary)', key: '—',              osc: '/dry/mute/hold',     fmt: 'int 0|1',          type: 'hold',
    tip: '1 mutes the dry monitor, 0 restores the mode it was in at the press' },
  { id: 'mute_hold',    label: 'system mute (momentary)',        key: '—',                 osc: '/mute/hold',         fmt: 'int 0|1',          type: 'hold',
    tip: 'momentary mute — silent while held, restores the PREVIOUS state on release, so a tap over an already-muted system leaves it muted' },
  { id: 'undo',         label: 'undo',          key: 'right click / ⌘Z',  osc: '/undo',              fmt: 'bang',             type: 'trigger',
    tip: 'remove the most recently painted stroke from the sphere' },
  { id: 'redo',         label: 'redo',        key: '⇧⌘Z',               osc: '/redo',              fmt: 'bang',             type: 'trigger',
    tip: 'bring back the last thing undone — a stroke with everything it made, an erase, a pin. A new action forks history: what was undone stays undone' },
  { id: 'sweep',        label: 'sweep the scratch', key: '—',             osc: '/sweep',             fmt: 'bang',             type: 'trigger',
    tip: 'everything unpinned goes; pinned clouds and loops keep sounding. The chrome pill, bindable here' },
  { id: 'erase_all',    label: 'erase all',       key: 'Backspace×3',       osc: '/session/erase',     fmt: 'bang',             type: 'trigger',
    tip: 'erase everything — all particles, commits, and recordings' },
  // ── Search ─────────────────────────────────────────────────────────────────
  { id: null, group: 'lens' },
  { id: 'snap',         label: 'lens mode · nearest / area (toggle)', key: 'N',                 osc: '/search/scope',   fmt: 'int 0|1',          type: 'trigger',
    tip: 'the installed lens\'s mode — nearest: the k closest marks on the whole sphere / area: within the radius and depth' },
  { id: 'k_all',        label: 'fill · all / k (toggle)',              key: '—',                 osc: '/search/fill',    fmt: 'int 0|1',          type: 'trigger',
    tip: 'fill — all: fire every particle in radius / k: cap to k nearest (area mode only)' },
  { id: 'k_seq',        label: 'order · step / random (toggle)',       key: '—',                 osc: '/search/order',   fmt: 'int 0|1',          type: 'trigger',
    tip: 'step through candidates one at a time in recording order instead of random' },
  { id: 'radius_cc',    label: 'radius',                    key: '—',                 osc: '/search/radius',  type: 'cc',
    range: { min: SEARCH_RADIUS_MIN, max: SEARCH_RADIUS_MAX, unit: '°', int: true },
    ccFn: v => { S.searchRadiusDeg = Math.round(SEARCH_RADIUS_MIN + (v / 127) * (SEARCH_RADIUS_MAX - SEARCH_RADIUS_MIN)); updatePlaybackControls(); flashRadiusTooltip(); } },
  { id: 'radius_inc',   label: 'radius ↑',                  key: 'scroll ↑ / ]',      osc: '/search/radius/inc', fmt: 'bang',          type: 'trigger',
    tip: 'increase search radius by 2°' },
  { id: 'radius_dec',   label: 'radius ↓',                  key: 'scroll ↓ / [',      osc: '/search/radius/dec', fmt: 'bang',          type: 'trigger',
    tip: 'decrease search radius by 2°' },
  // Ceiling is the particle count, so it moves as you paint — a pot limited to
  // "k up to 12" has to re-resolve every time it's read, not at bind time.
  { id: 'grain_k',      label: 'k',                         key: '—',                 osc: '/search/k',       type: 'cc',
    range: { min: 1, maxFn: () => Math.max(1, S.particles.length), max: 1, int: true },
    ccFn: v => { const mx = Math.max(1, S.particles.length); S.grainOverrides.k = Math.max(1, Math.round(1 + (v / 127) * (mx - 1))); S.syncGrainControlsUI?.(); } },
  // 0 = "all" is a sentinel sitting ABOVE 16, not part of the numeric range, so
  // it stays out of `range` — a scaled pot spans 1–16 and can't reach it. Bind
  // a button to it if you want "all" on a controller.
  { id: 'recency_cc',   label: 'depth',                     key: '—',                 osc: '/search/recency', type: 'cc',
    range: { min: 1, max: 16, int: true },
    tip: 'how many recent buffers the scan can reach — the top of the throw is 0 = all',
    ccFn: v => { const raw = Math.round((v / 127) * 17); const n = raw >= 17 ? 0 : Math.max(1, raw); if (typeof S.setRecency === 'function') S.setRecency(n); else S.recencyN = n; } },

  // ── Grain ──────────────────────────────────────────────────────────────────
  { id: null, group: 'grain' },
  // Declared in ms though the ccFn stores seconds: the range describes what the
  // performer reads and types, not the internal unit. Ratio is identical either
  // way (1→4000 ms is the same log span as 0.001→4.0 s), so the maths holds.
  { id: 'grain_dur',    label: 'duration',                  key: '—',  osc: '/grain/dur',         type: 'cc',
    tip: 'grain length — log scale, 1ms to 4s',
    range: { min: 1, max: 4000, unit: 'ms', curve: 'log' },
    ccFn: v => { const lo = Math.log(0.001), hi = Math.log(4.0); S.grainOverrides.duration = Math.exp(lo + (v / 127) * (hi - lo)); S.syncGrainControlsUI?.(); } },
  { id: 'grain_durvar', label: 'dur ±',                     key: '—',  osc: '/grain/durvar',      type: 'cc',
    tip: 'additive duration randomness per grain',
    range: { min: 0, max: 500, unit: 'ms' },
    ccFn: v => { S.grainOverrides.durVar = (v / 127) * 0.5; S.syncGrainControlsUI?.(); } },
  { id: 'grain_durjit', label: 'dur jitter',                key: '—',  osc: '/grain/durjitter',   type: 'cc',
    tip: 'multiplicative duration randomness — also driven by the sensor mapping system',
    range: { min: 0, max: 1 },
    ccFn: v => { S.grainOverrides.durJitter = v / 127; S.syncGrainControlsUI?.(); } },
  { id: 'grain_startjit', label: 'start ±',                 key: '—',  osc: '/grain/startjitter', type: 'cc',
    tip: 'per-grain read-offset randomness — lets grains begin between markers instead of only on one',
    range: { min: 0, max: 500, unit: 'ms' },
    ccFn: v => { S.grainOverrides.startJitter = (v / 127) * 0.5; S.syncGrainControlsUI?.(); } },
  { id: 'grain_fade',   label: 'fade',                      key: '—',  osc: '/grain/fade',        type: 'cc',
    tip: 'attack + release each as % of grain duration — 0% instant on/off, 50% pure envelope',
    range: { min: 0, max: 50, unit: '%' },
    ccFn: v => { S.grainOverrides.fadeRatio = (v / 127) * 0.5; S.syncGrainControlsUI?.(); } },
  { id: 'grain_period', label: 'period',                    key: '—',  osc: '/grain/per',         type: 'cc',
    tip: 'time between grain onsets — log scale, 1ms to 4s',
    range: { min: 1, max: 4000, unit: 'ms', curve: 'log' },
    ccFn: v => { const lo = Math.log(0.001), hi = Math.log(4.0); S.grainOverrides.period = Math.exp(lo + (v / 127) * (hi - lo)); S.syncGrainControlsUI?.(); } },
  { id: 'grain_overlap', label: 'overlap',                   key: '—',  osc: '/grain/overlap',     type: 'cc',
    tip: 'grain overlap ratio (dur/period) — drives duration',
    range: { min: 0.01, max: 100, unit: '×', curve: 'log' },
    ccFn: v => { const ov = Math.pow(10, -2 + 4 * (v / 127)); const per = S.grainOverrides.period ?? S.grainParams?.period ?? 0.061; S.grainOverrides.duration = Math.max(0.001, per * ov); S.syncGrainControlsUI?.(); } },
  { id: 'grain_pervar', label: 'per ±',                     key: '—',  osc: '/grain/pervar',      type: 'cc',
    tip: 'additive period randomness per onset',
    range: { min: 0, max: 500, unit: 'ms' },
    ccFn: v => { S.grainOverrides.periodVar = (v / 127) * 0.5; S.syncGrainControlsUI?.(); } },
  // pitchShift is stored in CENTS everywhere (slider, sensor mapping, worklet).
  { id: 'grain_pitchshift', label: 'pitch shift',           key: '—',  osc: '/grain/pitchshift',  type: 'cc',
    tip: 'base pitch offset in cents — ±2400 (2 octaves)',
    range: { min: -2400, max: 2400, unit: '¢', int: true },
    ccFn: v => { S.grainOverrides.pitchShift = Math.round(((v / 127) * 4800) - 2400); S.syncGrainControlsUI?.(); } },
  // The three octave shortcuts beside the pitch slider, as bindable triggers.
  // They're steps, not a span, so they're triggers rather than a cc: a pot
  // sweeping the pitch is already grain_pitchshift above — what a pad or pedal
  // wants is a discrete jump. Reset is its own action for the same reason
  // (returning to 0 mid-phrase is a gesture, not a value).
  { id: 'pitch_oct_down',  label: 'pitch −1 octave',          key: '—',  osc: '/grain/oct/down',  fmt: 'bang',  type: 'trigger',
    tip: 'drop the base pitch shift by 1200¢ — same button as −oct in the grain panel, clamped at −2400¢' },
  { id: 'pitch_oct_reset', label: 'pitch reset to 0',         key: '—',  osc: '/grain/oct/reset', fmt: 'bang',  type: 'trigger',
    tip: 'return the base pitch shift to 0¢ — same button as 0 in the grain panel' },
  { id: 'pitch_oct_up',    label: 'pitch +1 octave',          key: '—',  osc: '/grain/oct/up',    fmt: 'bang',  type: 'trigger',
    tip: 'raise the base pitch shift by 1200¢ — same button as +oct in the grain panel, clamped at +2400¢' },
  // Range is in cents (what you read); the ccFn converts to the ratio the
  // worklet wants. Linear in cents, which is why curve is left at the default.
  { id: 'grain_pitch',  label: 'pitch jitter',              key: '—',  osc: '/grain/pitch',       type: 'cc',
    tip: 'random pitch spread per grain in cents',
    range: { min: 0, max: 700, unit: '¢' },
    ccFn: v => { S.grainOverrides.pitchJitter = Math.pow(2, (v / 127) * 700 / 1200) - 1; S.syncGrainControlsUI?.(); } },
  { id: 'grain_prob',   label: 'probability',               key: '—',  osc: '/grain/prob',        type: 'cc',
    tip: 'chance each grain fires — 0 = never, 1 = always',
    range: { min: 0, max: 1 },
    ccFn: v => { S.grainProbability = v / 127; S.syncGrainControlsUI?.(); } },
  { id: 'grain_pan',    label: 'pan spread',                key: '—',  osc: '/grain/pan',         type: 'cc',
    tip: 'stereo spread — 0% mono, 100% full stereo',
    range: { min: 0, max: 100, unit: '%' },
    ccFn: v => { S.grainOverrides.panSpread = v / 127; S.syncGrainControlsUI?.(); } },
  // Curved toward the top of the throw like master volume — see
  // LEVEL_FADER_GAMMA in state.js.
  { id: 'grain_vol',    label: 'volume',                    key: '—',  osc: '/grain/volume',      type: 'cc',
    tip: 'grain volume — 1.0 = unity/input parity, max 2.0. the throw is curved toward the top, where a level actually sits',
    range: { min: 0, max: 2, curve: 'pow', gamma: LEVEL_FADER_GAMMA },
    ccFn: v => { S.grainOverrides.volume = Math.pow(v / 127, LEVEL_FADER_GAMMA) * 2; S.syncGrainControlsUI?.(); } },
  { id: 'grain_dir',    label: 'direction (cycle)',                 key: '—',  osc: '/grain/dir',         fmt: 'bang=cycle, str=set (fwd|rev|rnd)',              type: 'trigger',
    tip: 'grain playback direction — cycles fwd → rev → rnd' },
  { id: 'grain_curve',  label: 'envelope curve (cycle)',            key: '—',  osc: '/grain/curve',       fmt: 'bang=cycle, str=set (hann|tri|rect)',              type: 'trigger',
    tip: 'grain envelope shape — cycles hann → triangle → rectangular' },
  { id: 'grain_retrig', label: 'retrigger',            key: '—',  osc: '/grain/retrigger',   type: 'cc',
    tip: 'per-particle cooldown — prevents the same point from firing again within this window',
    range: { min: 0, max: 500, unit: 'ms' },
    ccFn: v => { S.grainOverrides.retriggerMs = (v / 127) * 500; S.syncGrainControlsUI?.(); } },
  { id: 'grain_hpf',    label: 'HPF cutoff',                key: '—',  osc: '/grain/hpf',         type: 'cc',
    tip: 'highpass filter cutoff — 20 Hz = off, log scale',
    range: { min: 20, max: 20000, unit: 'Hz', curve: 'log' },
    ccFn: v => { S.grainOverrides.hpfFreq = 20 * Math.pow(1000, v / 127); S.syncGrainControlsUI?.(); } },
  { id: 'grain_lpf',    label: 'LPF cutoff',                key: '—',  osc: '/grain/lpf',         type: 'cc',
    tip: 'lowpass filter cutoff — 20 kHz = off, log scale',
    range: { min: 20, max: 20000, unit: 'Hz', curve: 'log' },
    ccFn: v => { S.grainOverrides.lpfFreq = 20 * Math.pow(1000, v / 127); S.syncGrainControlsUI?.(); } },
  { id: 'grain_hpfq',    label: 'hpf Q',                    key: '—',  osc: '/grain/hpfq',        type: 'cc',
    tip: 'resonance at the HIGH-PASS corner — 0.707 = flat (Butterworth), higher = a peak there',
    range: { min: 0.1, max: 20 },
    ccFn: v => { S.grainOverrides.hpfQ = 0.1 + (v / 127) * 19.9; S.syncGrainControlsUI?.(); } },
  { id: 'grain_lpfq',    label: 'lpf Q',                    key: '—',  osc: '/grain/lpfq',        type: 'cc',
    tip: 'resonance at the LOW-PASS corner — 0.707 = flat (Butterworth), higher = a peak there',
    range: { min: 0.1, max: 20 },
    ccFn: v => { S.grainOverrides.lpfQ = 0.1 + (v / 127) * 19.9; S.syncGrainControlsUI?.(); } },
  { id: 'grain_fltjit',  label: 'filter jitter',            key: '—',  osc: '/grain/filterjitter', type: 'cc',
    tip: 'per-grain cutoff randomisation — 0% = static, 100% = ±1 octave',
    range: { min: 0, max: 1 },
    ccFn: v => { S.grainOverrides.filterFreqJitter = v / 127; S.syncGrainControlsUI?.(); } },

  // ── Cursor / Scan (S) ─────────────────────────────────────────────────────
  { id: null, group: 'cursor' },
  { id: 'scan_toggle',  label: 'lens off (toggle)',               key: 'S',                 osc: '/cursor/scan',       fmt: 'int 0|1',          type: 'trigger',
    tip: 'no lens on: the cursor reads nothing (the cap). Again, the same lens is back on. S by default; a lens tile tapped when on does the same' },
  { id: 'tare',         label: 'zero',                   key: '`',                 osc: '/cursor/tare',       fmt: 'bang',             type: 'trigger',
    tip: 'zero the cursor — in sensor mode the current heading becomes the centre; in pull and point the camera goes back to the front. The footer\'s ZERO button' },
  { id: 'az_source',    label: 'azimuth source (cycle)',       key: '—',                 osc: '/cursor/az_source',  fmt: 'bang=cycle, str=set (sensor|locked|mapped)', type: 'trigger',
    tip: 'who drives azimuth — sensor (free), locked (frozen), or mapped (a cursor mapping row)' },
  { id: 'el_source',    label: 'elevation source (cycle)',     key: '—',                 osc: '/cursor/el_source',  fmt: 'bang=cycle, str=set (sensor|locked|mapped)', type: 'trigger',
    tip: 'who drives elevation — sensor (free), locked (frozen), or mapped (a cursor mapping row)' },
  { id: 'radius_fade',  label: 'radius fade (toggle)',        key: '—',                 osc: '/cursor/radiusfade', fmt: 'int 0|1',          type: 'trigger',
    tip: 'attenuate grains by distance from cursor centre' },
  { id: 'radius_fade_curve', label: 'radius fade curve',    key: '—',                 osc: '/cursor/radiusfadecurve', type: 'cc',
    tip: '0 = gentle linear fade, 1 = steep sharp edge rolloff',
    range: { min: 0, max: 1 },
    ccFn: v => { S.radiusFadeCurve = v / 127; S._syncRadiusFadeUI?.(); } },

  { id: null, group: 'pins (= / −)' },
  { id: 'commit_drop',  label: 'pin here',          key: '=',                 osc: '/commit/drop',     fmt: 'bang',             type: 'trigger',
    tip: 'the = key: pin what the cursor is on — a tape stroke becomes a loop; nothing in reach pins a cloud at the cursor' },
  { id: 'commit_draw',  label: 'pin a drawn path (momentary)', key: 'hold =',            osc: '/commit/draw',     fmt: 'int 0|1',          type: 'hold',
    tip: 'hold =: while painting the loop grows to the release; otherwise a cloud path is drawn — release to pin it' },
  { id: 'commit_release', label: 'unpin',               key: '−',                 osc: '/commit/release',  fmt: 'bang',             type: 'trigger',
    tip: 'unpin the selected pin, cloud or loop — nearest, farthest or oldest is Settings → Pins' },
  { id: 'pins_mute',       label: 'mute pins',       key: '—', osc: '/pins/mute',      fmt: 'int 0|1', type: 'hold',
    tip: 'silence every pin, and let it back on the next press — your per-pin mutes and solos survive the round trip. 1 mutes, 0 lets back, no value flips it' },
  { id: 'pins_unmute_all', label: 'unmute all pins', key: '—', osc: '/pins/unmuteall', fmt: 'bang', type: 'trigger',
    tip: 'bring every pin back — clears every mute and solo, on the groups and on each pin' },
  { id: 'commit_clear', label: 'unpin all',                 key: '—',                 osc: '/commit/clear',    fmt: 'bang',             type: 'trigger',
    tip: 'unpin every cloud and loop — the pinned rail\'s UNPIN ALL' },
  { id: 'commit_selection', label: 'selected pin · nearest / oldest (toggle)', key: '—',               osc: '/commit/selection', fmt: 'bang=toggle, str=set (nearest|oldest)',                 type: 'trigger',
    tip: 'which pin is SELECTED — what unpin takes and the rail marks: nearest the cursor, or the oldest' },
  { id: 'commit_slots', label: 'pin slot count',         key: '—',                 osc: '/commit/slots',    type: 'cc',
    tip: 'number of active commit slots (1–16)',
    range: { min: 1, max: 16, int: true },
    ccFn: v => {
      S.commitSlotCount = Math.max(1, Math.min(16, Math.round(1 + v * 15 / 127)));
      S._syncCommitSlotCount?.();    // syncs slider + numbox
      (S.updateSeedBanksUI || S._syncCommitUI || (() => {}))();
    } },
  { id: 'commit_overflow', label: 'pin overflow (cycle)', key: '—',                osc: '/commit/overflow', fmt: 'bang=cycle, str=set (off|oldest|nearest)',                   type: 'trigger',
    tip: 'cycle overflow mode: off → oldest → nearest' },
  { id: 'commit_dir',   label: 'cloud movement (cycle)',       key: '—',                 osc: '/commit/dir',      fmt: 'bang=cycle, str=set (pingpong|forward|rev)',                 type: 'trigger',
    tip: 'how moving commits traverse their path — cycles fwd → rev → pingpong' },
  { id: 'commit_attack', label: 'cloud fade in',             key: '—',                 osc: '/commit/attack',   type: 'cc',
    tip: 'cloud fade-in time — 0s instant, up to 10s swell',
    range: { min: 0, max: 10, unit: 's' },
    ccFn: v => { S.seedAttack = (v / 127) * 10; const sl = document.getElementById('seedAttackSlider'); if (sl) sl.value = S.seedAttack; const nb = document.getElementById('seedAttackNum'); if (nb) nb.value = S.seedAttack < 1 ? (S.seedAttack * 1000).toFixed(0) + 'ms' : S.seedAttack.toFixed(1) + 's'; } },
  { id: 'commit_release_time', label: 'cloud fade out',     key: '—',               osc: '/commit/release_time', type: 'cc',
    tip: 'cloud fade-out time — 0s instant, up to 10s fade',
    range: { min: 0, max: 10, unit: 's' },
    ccFn: v => { S.seedRelease = (v / 127) * 10; const sl = document.getElementById('seedReleaseSlider'); if (sl) sl.value = S.seedRelease; const nb = document.getElementById('seedReleaseNum'); if (nb) nb.value = S.seedRelease < 1 ? (S.seedRelease * 1000).toFixed(0) + 'ms' : S.seedRelease.toFixed(1) + 's'; } },
  { id: 'loop_release_mode', label: 'loop fade out · fade / play-to-end (toggle)',   key: '—',                 osc: '/commit/loop_release', fmt: 'bang=toggle, str=set (fade|play-to-end)',                 type: 'trigger',
    tip: 'fade = fade out over time, play-to-end = loop finishes current pass then stops' },
  { id: 'loop_fade_time', label: 'loop fade out time',    key: '—',                 osc: '/commit/loop_fade_time', type: 'cc',
    tip: 'fade-out duration for loops when released — 0ms instant, up to 2000ms',
    range: { min: 0, max: 2000, unit: 'ms', int: true },
    ccFn: v => { S.loopFadeTimeMs = Math.round((v / 127) * 2000); const sl = document.getElementById('loopFadeTimeSlider'); if (sl) sl.value = S.loopFadeTimeMs; const nb = document.getElementById('loopFadeTimeNum'); if (nb) nb.value = S.loopFadeTimeMs < 1000 ? S.loopFadeTimeMs + 'ms' : (S.loopFadeTimeMs / 1000).toFixed(1) + 's'; } },
  { id: 'commit_blend', label: 'pin blend · all / focus (toggle)',         key: '—',                 osc: '/commit/blend',    fmt: 'bang=toggle, str=set (focus|all)',             type: 'trigger',
    tip: 'all = equal weight, focus = distance-weighted blend toward closest' },
  { id: 'commit_tether', label: 'pin tether (toggle)',            key: '—',                 osc: '/commit/tether',   fmt: 'int 0|1',          type: 'trigger',
    tip: 'on = commit always plays regardless of cursor distance, off = radius-gated' },
  { id: 'commit_xfade', label: 'pin xfade',              key: '—',                 osc: '/commit/xfade',    type: 'cc',
    tip: '0 = hard snap to nearest commit, 1 = smooth distance-weighted crossfade',
    range: { min: 0, max: 1 },
    ccFn: v => { S.seedXfade = v / 127; S._syncImprovUI?.(); } },

  // ── Levels ─────────────────────────────────────────────────────────────────
  { id: null, group: 'levels' },
  // dB is already a log scale, so linear IN dB used to be the whole story — but
  // that spends half the throw under −20 dB. The curve is applied to the throw,
  // not to the dB, so the range stays declared in dB and carries the exponent.
  // See LEVEL_FADER_GAMMA in state.js.
  { id: 'master_vol',   label: 'master volume',             key: '—',                 osc: '/master/volume',  type: 'cc',
    tip: 'master output gain — the master vol slider in audio settings (-60 to +18 dB). the throw is curved toward the top, where a level actually sits',
    range: { min: -60, max: 18, unit: 'dB', curve: 'pow', gamma: LEVEL_FADER_GAMMA },
    ccFn: v => { S._setOutputGainDb?.(-60 + Math.pow(v / 127, LEVEL_FADER_GAMMA) * 78); } },
  { id: 'mixdown_cursor', label: 'headphone cursor level',  key: '—',                 osc: '/mixdown/cursor', type: 'cc',
    tip: 'cursor grain level in the headphone stereo mix',
    range: { min: 0, max: 1 },
    ccFn: v => { setMixdownCursorGain(v / 127); } },
  { id: 'mixdown_house', label: 'headphone house level',    key: '—',                 osc: '/mixdown/house',  type: 'cc',
    tip: 'house speaker fold-down level in the headphone stereo mix',
    range: { min: 0, max: 1 },
    ccFn: v => { setMixdownHouseGain(v / 127); } },
  // Curved, not linear: the gate's whole working range against a live mic sits
  // in the bottom few percent of the span, which a linear throw gives 8 of 128
  // steps.  gateFracToRms is the meter's own axis, so the pot and the drawn
  // threshold move together — see GATE_METER_GAMMA in state.js.
  // id and osc path deliberately keep the old names through the rename: the id
  // is the key Ek's saved midi/key bindings are stored under, and the osc path
  // is wired into Max patches. Renaming either would silently orphan them for a
  // cosmetic gain. The label is what anyone actually reads.
  { id: 'noise_gate',   label: 'paint gate threshold',      key: '—',                 osc: '/gate/threshold', type: 'cc',
    tip: 'paint gate threshold — below this, no particle is deposited, so that moment is not granulatable or triggerable. it does NOT attenuate audio. the throw is curved toward zero, where the noise floor lives',
    range: { min: 0, max: GATE_METER_MAX, unit: 'RMS', curve: 'pow', gamma: GATE_METER_GAMMA },
    ccFn: v => { S._setPaintGateThreshold?.(gateFracToRms(v / 127)); } },
  { id: 'dry_gain',    label: 'dry monitor gain',           key: '—',                 osc: '/dry/gain',       type: 'cc',
    tip: 'spatialized live input level in the house mix (0 = silent, 2 = +6dB)',
    range: { min: 0, max: 2 },
    ccFn: v => { S._setDryMonitorGain?.(v / 127 * 2); } },

  // ── Spatial ────────────────────────────────────────────────────────────────
  { id: null, group: 'spatial' },
  { id: 'cursor_lock',      label: 'cursor lock (momentary)',         key: 'Alt / Opt',         osc: '/spatial/lock',     fmt: 'int 0|1',           type: 'hold',
    tip: 'holds azimuth and elevation together — the same state the AZ and EL footer buttons write. In steer and surface it also hands the pointer back so the UI is clickable' },

  { id: null, group: 'source / sampler' },
  { id: 'source_live',    label: 'source: live input',      key: '—',                 osc: '/source/live',    fmt: 'bang',             type: 'trigger',
    tip: 'the brush inks from the live input channel (see audio settings for which)' },
  { id: 'source_sampler', label: 'source: sampler',         key: '—',                 osc: '/source/sampler', fmt: 'bang',             type: 'trigger',
    tip: 'the brush inks from the sample instrument’s current sample' },
  { id: 'sampler_sample', label: 'sampler: select sample',  key: '—',                 osc: '/sampler/sample', fmt: 'int 1..10 = slot, 127 = next loaded', type: 'trigger',
    tip: 'set the sampler’s current sample — explicit slot number, or cycle the loaded ones' },
  { id: 'sampler_record', label: 'sampler: record (momentary)',  key: '—',                 osc: '/sampler/record', fmt: 'int 0|1',          type: 'hold',
    tip: 'capture the live input into the next free sampler slot — refused while a paint stroke is recording' },

  // ── App ────────────────────────────────────────────────────────────────────
];

// Derive the format column for every cc action from its range, so the modal and
// the accessory's unit maths can't disagree. Non-cc actions keep their literal
// fmt — 'bang' and 'bang=cycle, str=set (…)' describe a payload shape, not a
// numeric span, and there's nothing to derive them from.
for (const a of ACTIONS) {
  if (a.type === 'cc' && a.range) a.fmt = fmtRange(a.range);
}

// MIDI mappings: { actionId → { type: 'cc'|'note', channel, number,
//                                curve?, outLo?, outHi? } }
let midiMappings = {};
let midiLearningId = null;
let midiAccess = null;

// THE ONE BINDING KIND THE PALETTE SHOWS (PALETTE-GUI § 11.4, 2026-09-12):
// key · button · midi, chosen on the keys page's segmented row, read by
// tiles.js paletteLegend. It was three booleans (`mubone_legend_kinds`) for
// the afternoon's ledger; the first that was on carries over, once.
const LEGEND_KINDS = ['key', 'button', 'midi'];
let legendKind = 'key';
try {
  const one = localStorage.getItem('mubone_legend_kind');
  if (LEGEND_KINDS.includes(one)) legendKind = one;
  else {
    const old = JSON.parse(localStorage.getItem('mubone_legend_kinds') || 'null');
    if (old && typeof old === 'object') { legendKind = LEGEND_KINDS.find(k => old[k]) ?? 'key'; localStorage.setItem('mubone_legend_kind', legendKind); }
  }
  localStorage.removeItem('mubone_legend_kinds');
} catch (_) {}
function _paintLegendKind() {
  document.querySelectorAll('#legendKindSeg [data-legend-kind]').forEach(el => {
    const on = el.dataset.legendKind === legendKind;
    el.classList.toggle('active', on); el.setAttribute('aria-pressed', String(on));
  });
}
S._legendKind = () => legendKind;
S._setLegendKind = kind => {
  if (!LEGEND_KINDS.includes(kind) || kind === legendKind) return;
  legendKind = kind;
  try { localStorage.setItem('mubone_legend_kind', kind); } catch (_) {}
  _paintLegendKind();
  S._bindingsChanged?.();
};
// The afternoon's two-argument form, kept for the audits: "show this kind"
// chooses it; "hide" is a no-op — one kind is always shown.
S._setLegendShown = (kind, on) => { if (on) S._setLegendKind(kind); };

// Key/scroll mappings: { actionId → { key, code, shift, ctrl, meta, type } }
// type: 'key' | 'scroll_up' | 'scroll_down'
let keyMappings = {};
let keyLearningId = null;

// Action ids that were renamed or retired, applied once to a stored map on
// load so a learned key or pad keeps doing what it did. 2026-09-04: the belt
// became the PALETTE, ids and addresses with it (`belt_*` → `palette_*`).
// The 2026-09-03 map (#327: the holds moved to position ids, `erase_brush`
// folded into the erase slot's hold) ran the day it landed and is gone —
// a stored `belt_1` now means the cap tap, not the old brush-slot hold.
const _RENAMED_IDS = {
  belt_2: 'palette_1', belt_3: 'palette_2', belt_4: 'palette_3', belt_5: 'palette_4',
  belt_3_hold: 'palette_2_hold', belt_4_hold: 'palette_3_hold', belt_5_hold: 'palette_4_hold',
  erase_brush: 'palette_4_hold'
};
const _RETIRED_IDS = ['belt_1', 'erase_toggle', 'trace_trigger', 'commit_mode', 'commit_volume', 'commit_speed', 'perf', 'perfmode', 'darkmode', 'projector', 'camera_mode', 'spatial_panning'];
function _migrateIds(map) {
  let n = 0;
  for (const [was, now] of Object.entries(_RENAMED_IDS)) {
    if (!(was in map)) continue;
    if (!(now in map)) map[now] = map[was];
    delete map[was]; n++;
  }
  for (const id of _RETIRED_IDS) if (id in map) { delete map[id]; n++; }
  return n;
}
// The cap left the palette (2026-09-11) and every position below it moved
// up one: palette_2 → palette_1 (the lens), palette_3* → palette_2* (tape),
// palette_4* → palette_3* (grain), palette_5* → palette_4* (erase); the old
// palette_1 (the cap tap) is dropped — `scan_toggle` is that action. The old
// and new ids OVERLAP, so this cannot live in _RENAMED_IDS, which runs on
// every load: it runs ONCE per profile, stamped, over the three maps.
const _PALETTE_RENUMBER_KEY = 'mubone_palette_renumber';
const _PALETTE_RENUMBER_V = '2026-09-11';
function _renumberPalette(map) {
  const out = {}; let n = 0;
  for (const [id, v] of Object.entries(map)) {
    const m = /^palette_([1-5])(_cycle|_toggle|_hold)?$/.exec(id);
    if (!m) { out[id] = v; continue; }
    n++;
    if (m[1] === '1') continue;                      // the cap tap: gone
    out[`palette_${Number(m[1]) - 1}${m[2] ?? ''}`] = v;
  }
  if (n) { for (const k of Object.keys(map)) delete map[k]; Object.assign(map, out); }
  return n;
}
/** True when this profile actually STORED that map. A one-shot migration must
 *  not run over a map that was never stored: `loadButtonMappings` falls back
 *  to BUTTON_DEFAULTS, which are written in TODAY's numbering, and renumbering
 *  them shifted every factory button down a position on a fresh profile —
 *  button 1 landed on the lens instead of line, and the pin pair on 6 and 5.
 *  It has done that since the renumber landed; nothing read the factory button
 *  map back until the delay mark (§ 7) needed to know what sat on button 3. */
function _wasStored(key) { try { return localStorage.getItem(key) != null; } catch (_) { return false; } }
function renumberPaletteOnce() {
  let stamp = null;
  try { stamp = localStorage.getItem(_PALETTE_RENUMBER_KEY); } catch (_) {}
  if (stamp === _PALETTE_RENUMBER_V) return;
  if (_wasStored('mubone_key_map')    && _renumberPalette(keyMappings))    saveKeyMappings();
  if (_wasStored('mubone_midi_map')   && _renumberPalette(midiMappings))   saveMidiMappings();
  if (_wasStored('mubone_button_map') && _renumberPalette(buttonMappings)) saveButtonMappings();
  try { localStorage.setItem(_PALETTE_RENUMBER_KEY, _PALETTE_RENUMBER_V); } catch (_) {}
}

// ── 27 palette actions → 9, ONCE (docs/PALETTE-GUI.md § 1) ──────────────────
// A position had three actions and the caller chose; it has one, and the tile
// chooses. Every binding on `palette_N_toggle` or `palette_N_hold` MOVES onto
// `palette_N` — nothing is lost, because a tile carrying two sources is
// explicitly legal (§ 6) and `_learnGesture` already guarantees no two actions
// share a source+gesture, so the move cannot collide.
//
// The VERB those bindings implied is derived on the other side, in tiles.js
// `_derivedVerbs`, which reads these maps at module load — before this runs,
// because module evaluation precedes every init. Two stamps, no coupling.
//
// `palette_N` wins if it is already bound in the same map: it is the id that
// survives, so its binding is the one the performer will see on the row.
const _PALETTE_VERBS_KEY = 'mubone_palette_verbs_collapsed';
const _PALETTE_VERBS_V = '2026-09-11';
function _collapsePaletteVerbs(map) {
  let n = 0;
  for (const suffix of ['_hold', '_toggle']) {
    for (let i = 1; i <= 9; i++) {
      const was = `palette_${i}${suffix}`, now = `palette_${i}`;
      if (!(was in map)) continue;
      if (!(now in map)) map[now] = map[was];
      delete map[was]; n++;
    }
  }
  return n;
}
function collapsePaletteVerbsOnce() {
  let stamp = null;
  try { stamp = localStorage.getItem(_PALETTE_VERBS_KEY); } catch (_) {}
  if (stamp === _PALETTE_VERBS_V) return;
  // Same rule as the renumber: a map that was never stored is already in
  // today's shape, and BUTTON_DEFAULTS is.
  if (_wasStored('mubone_key_map')    && _collapsePaletteVerbs(keyMappings))    saveKeyMappings();
  if (_wasStored('mubone_midi_map')   && _collapsePaletteVerbs(midiMappings))   saveMidiMappings();
  if (_wasStored('mubone_button_map') && _collapsePaletteVerbs(buttonMappings)) saveButtonMappings();
  try { localStorage.setItem(_PALETTE_VERBS_KEY, _PALETTE_VERBS_V); } catch (_) {}
}
function loadKeyMappings() {
  try {
    const saved = localStorage.getItem('mubone_key_map');
    if (saved) keyMappings = JSON.parse(saved);
    let dirty = _migrateIds(keyMappings);
    // The spacebar is the hand's (2026-09-12): a row on it is not a binding.
    for (const [id, km] of Object.entries(keyMappings)) if (km && km.type === 'key' && km.code === 'Space') { delete keyMappings[id]; dirty = true; }
    if (dirty) saveKeyMappings();
  } catch(e) { keyMappings = {}; }
}

// ── THE DIGITS ARE THE TILE'S, NOT THE POSITION'S (Ek, 2026-09-12) ──────────
// "when i move the tiles around, the keybound should follow the tile … we
// shouldn't have the numbers auto assign based on position on the palette."
// Until today digit N was an IMPLICIT factory key for position N (tiles.js
// read it straight off the keyboard), so a tile dragged from 1 to 4 answered
// to 4, and a key learned onto position 1 stayed with position 1. Now every
// palette key is an explicit row in this map, seeded once from the factory
// digits, and `S._paletteReordered` carries the three maps along with every
// place, move and remove — so what a tile answers to is a property of the
// tile on the strip. A tile that ARRIVES takes the next free digit (Ek,
// 2026-09-12, afternoon: "the palette bar should auto assign based on the
// next number up that's available when a tool is dragged in" — reversing the
// morning's "don't auto find a key"; the key then stays with the tile
// wherever it is moved). `{ type: 'none' }` — a removed factory digit — has
// nothing to remove any more and is dropped: an unbound row is just unbound.
//
// THE SPACEBAR IS THE HAND'S (tiles.js, 2026-09-12) and cannot be a binding:
// the learn refuses it (BLOCKED_KEYS) and loadKeyMappings drops any stored
// row on it — the morning's factory seed put it on line and pen.
const _PALETTE_DIGITS_KEY = 'mubone_palette_digits';
const _PALETTE_DIGITS_V   = '2026-09-12d';
const _keyRow = (key, code, g = 'press') => ({ type: 'key', key, code, shift: false, ctrl: false, meta: false, g });
function _digitRow(d) { return _keyRow(String(d), `Digit${d}`); }
// THE FACTORY KEYS, by TILE, for the factory strip in tiles.js
// DEFAULT_PALETTE (Ek, 2026-09-12): 1 … 5 for the wide lens, wash, overdub,
// line and pen — the digits a drop would have given them, in order; ↑ unpins
// and ↓ pins. Seeded onto whichever POSITION holds that tile, so a profile
// with its own order still gets 4 on line; a tile the factory does not name,
// or a second copy of one it does, takes the next free digit like a drop.
// THE FACTORY STRIP (Ek, 2026-09-12, night) — tiles.js DEFAULT_PALETTE is the
// same list; keep them in step. Dots and line SHARE the 1 key: line is its
// press (a toggle, on the down edge, never delayed) and dots its long (a
// momentary, both edges) — the button-1 rule on a key.
const PALETTE_FACTORY_ORDER = ['pen', 'line', 'looper', 'overdub', 'scrape', 'pin', 'unpin'];
const PALETTE_FACTORY_ENTRIES = [
  { id: 'pen', verb: 'momentary' }, { id: 'line', verb: 'toggle' }, { id: 'looper', verb: 'toggle' }, { id: 'overdub', verb: 'toggle' },
  { id: 'scrape', verb: 'momentary' }, { id: 'pin', verb: 'bang' }, { id: 'unpin', verb: 'bang' },
];
const PALETTE_FACTORY_KEYS = {
  pen: _keyRow('1', 'Digit1', 'long'), line: _digitRow(1), looper: _digitRow(2), overdub: _digitRow(3), scrape: _digitRow(4),
  pin: _keyRow('↓', 'ArrowDown'), unpin: _keyRow('↑', 'ArrowUp')
};
const _sameKey = (a, b) => a && b && a.type === 'key' && b.type === 'key' && a.code === b.code && !!a.shift === !!b.shift && !!a.ctrl === !!b.ctrl && !!a.meta === !!b.meta && (a.g || 'press') === (b.g || 'press');
/** The lowest digit 1–9 no key row uses (unmodified, any gesture), or null. */
function _freeDigit() {
  const used = new Set(Object.values(keyMappings).filter(m => m && m.type === 'key' && !m.shift && !m.ctrl && !m.meta).map(m => m.code));
  for (let d = 1; d <= 9; d++) if (!used.has(`Digit${d}`)) return d;
  return null;
}
function seedPaletteDigitsOnce() {
  let stamp = null;
  try { stamp = localStorage.getItem(_PALETTE_DIGITS_KEY); } catch (_) {}
  if (stamp === _PALETTE_DIGITS_V) return;
  // THE FACTORY STRIP, RE-DEALT ONCE (Ek, 2026-09-12, night: "i'm ready to
  // redo the factory palette defaults again"): a profile on an older stamp
  // takes the new strip whole — the list, the hand (dots, momentary), the
  // palette rows of all three maps: keys dealt by tile below, the buttons
  // back to BUTTON_DEFAULTS, notes dropped. Runs before initTiles reads
  // the palette (main.js: setupMappingModal first), so the strip boots new.
  try {
    localStorage.setItem('mubone_palette', JSON.stringify(PALETTE_FACTORY_ENTRIES));
    localStorage.setItem('mubone_hand', 'pen');
    localStorage.setItem('mubone_hand_verb', 'momentary');
  } catch (_) {}
  for (const map of [keyMappings, buttonMappings, midiMappings]) for (const k of Object.keys(map)) if (/^palette_[1-9]$/.test(k)) delete map[k];
  for (const [k, v] of Object.entries(BUTTON_DEFAULTS)) if (/^palette_[1-9]$/.test(k)) buttonMappings[k] = { ...v };
  // AND NOTHING ELSE MAY SIT ON A GESTURE A POSITION JUST TOOK (#351, Ek's
  // ruling 2026-09-13: "just delete the colliding old rows"). The redeal above
  // ADDS the palette rows and leaves whatever the profile already had, so a map
  // written before 2026-09-11 — where the pin pair were the bare ids — ended up
  // with `commit_release` AND `palette_7` both on button 3's double, and both
  // are unpin: one double-press released two pins. Every stale row on a taken
  // gesture goes; a row on a free gesture is a binding you made and stays.
  const taken = new Set();
  for (const [k, v] of Object.entries(buttonMappings))
    if (/^palette_[1-9]$/.test(k) && v && v.btn != null) taken.add(`${v.btn}:${v.g || 'press'}`);
  for (const [k, v] of Object.entries(buttonMappings)) {
    if (/^palette_[1-9]$/.test(k) || !v || v.btn == null) continue;
    if (!taken.has(`${v.btn}:${v.g || 'press'}`)) continue;
    console.info(`[buttons] dropping ${k} on button ${v.btn} ${v.g || 'press'} — a palette position holds that gesture now`);
    delete buttonMappings[k];
  }
  saveButtonMappings(); saveMidiMappings();
  const ids = PALETTE_FACTORY_ORDER;
  const given = new Set();
  // A learned key stays. An earlier seed — the plain digit of the position,
  // or the morning's spacebar — and a removed factory digit are the
  // factory's to replace.
  const replaceable = (km, n) => !km || km.type === 'none' || km.code === 'Space' || _sameKey(km, _digitRow(n));
  ids.forEach((tid, j) => {
    const n = j + 1, id = `palette_${n}`, km = keyMappings[id];
    if (!replaceable(km, n)) return;
    delete keyMappings[id];
    const fac = tid && !given.has(tid) ? PALETTE_FACTORY_KEYS[tid] : null;
    if (fac && !Object.values(keyMappings).some(m => _sameKey(m, fac))) { keyMappings[id] = { ...fac }; given.add(tid); return; }
    if (tid) { const d = _freeDigit(); if (d) keyMappings[id] = _digitRow(d); }
  });
  saveKeyMappings();
  try { localStorage.setItem(_PALETTE_DIGITS_KEY, _PALETTE_DIGITS_V); } catch (_) {}
}
/** The palette changed shape: `from[j]` is the OLD position of what now sits
 *  at position j, or -1 for a tile that just arrived. Every binding on
 *  `palette_N` follows its tile through all three maps; an arrival takes the
 *  lowest free digit. tiles.js calls this after every place, move and remove. */
S._paletteReordered = (from) => {
  const maps = [[keyMappings, saveKeyMappings], [buttonMappings, saveButtonMappings], [midiMappings, saveMidiMappings]];
  for (const [map] of maps) {
    const old = {};
    for (let n = 1; n <= 9; n++) { old[n] = map[`palette_${n}`]; delete map[`palette_${n}`]; }
    from.forEach((o, j) => { if (o >= 0 && old[o + 1]) map[`palette_${j + 1}`] = old[o + 1]; });
  }
  // An arrival takes the next free digit — after the moves, so a digit that
  // just travelled with its tile is not counted free.
  from.forEach((o, j) => {
    if (o >= 0 || keyMappings[`palette_${j + 1}`]) return;
    const d = _freeDigit(); if (d) keyMappings[`palette_${j + 1}`] = _digitRow(d);
  });
  for (const [, save] of maps) save();
};

// ── LEARNING FROM THE TILE (Ek, 2026-09-12) ─────────────────────────────────
// "we should be able to click that number and be in 'learning' mode waiting
// for the key press. same function as in the key+midi setting but faster and
// in the palette. same with midi and the buttons." The legend's rows are the
// keys page's cells, brought to the tile: one arms the learn for its kind on
// its position, and the page's own recogniser finishes it — nothing is a
// second learn path. tiles.js reads `_paletteLearning` to draw the row.
S._paletteLearn = (pos, kind) => {
  const id = `palette_${pos + 1}`;
  if (!ACTIONS.some(a => a.id === id)) return false;
  keyLearningId = null; buttonLearningId = null; midiLearningId = null;
  _learnShortAs = 'press';
  if (kind === 'key') keyLearningId = id; else if (kind === 'button') buttonLearningId = id; else if (kind === 'midi') midiLearningId = id; else return false;
  setMappingStatus(`press a ${kind === 'key' ? 'key' : kind === 'button' ? 'button on the instrument' : 'MIDI note'} to assign it to position ${pos + 1}… (Esc cancels)`);
  renderMappingTable();
  S._bindingsChanged?.();
  return true;
};
S._paletteLearning = () => keyLearningId ? { id: keyLearningId, kind: 'key' }
                         : buttonLearningId ? { id: buttonLearningId, kind: 'button' }
                         : midiLearningId ? { id: midiLearningId, kind: 'midi' } : null;
S._paletteLearnCancel = () => {
  keyLearningId = null; buttonLearningId = null; midiLearningId = null; _learnKeyEv = null;
  setMappingStatus(''); renderMappingTable(); S._bindingsChanged?.();
};
/** Right-click on a legend row: that kind's binding on the position goes. */
S._paletteUnbind = (pos, kind) => {
  const id = `palette_${pos + 1}`;
  if (kind === 'key') { delete keyMappings[id]; saveKeyMappings(); }
  else if (kind === 'button') { delete buttonMappings[id]; saveButtonMappings(); }
  else if (kind === 'midi') { delete midiMappings[id]; saveMidiMappings(); }
  renderMappingTable();
};

function saveKeyMappings() {
  try { localStorage.setItem('mubone_key_map', JSON.stringify(keyMappings)); } catch(e) {}
  S._bindingsChanged?.();
}

// ── The instrument's buttons (Ek, 2026-09-09) — and every key and note (2026-09-11) ──
// "there should be a way for me to map those buttons to anything in that
// settings page." A third input beside key and MIDI, in the ONE table. Each
// physical button is SIX inputs — press, tap, long, extra long, ×2, ×3 — and the map is
// actionId → { btn, g }, learned by performing the gesture while a cell
// listens, cleared by right-click.
// Since 2026-09-11 the same recogniser reads EVERY two-edged source (Ek: "can
// the keyboard do that too? it should follow the same system/rule as the
// buttons so if i ever change how the button works the keyboard should
// follow"): a learned key (`key:Code[+shift][+ctrl][+meta]`, keyMappings with
// a `g`) and a MIDI note (`note:ch:num`, midiMappings with a `g`) are sources
// like a button (`btn:N`), with the same six gestures, the same timings and
// the same rules below. A binding without `g` is a press — what every key and
// note did before. The factory KEYS (a digit, S, M …) are not bindings and
// stay direct. The factory button set is Ek's own (2026-09-10),
// tap · long · extra long down each button: 1 is the hand (tape toggle, grain
// momentary), 2 is the session (undo, sweep, erase all), 3 is the pins (pin,
// unpin, unpin all — one, two and three presses). It was the three palette presses before, which
// is what sygaldry.js had hard-wired.
// One gesture, one action: learning it onto a row takes it off any other.
// Saved `{}` is a real answer and is never re-defaulted.
//
// THE EDGES (Ek, ruled 2026-09-09):
//   press  the down edge, never delayed. "the down edge needs to be the thing
//          that starts and ends a take. not the up edge." A press fires at
//          the start of every gesture on its button, so press is EXCLUSIVE
//          with tap there, and long / ×2 / ×3 beside a press are only for
//          actions that swallow what the press started (abort and erase).
//   tap    the up edge, if it came before the long time — the classic short
//          press, the one that can share a button with long as a true
//          alternative. Costs the length of the tap; never on a take button.
//          Beside a ×2 or ×3 it WAITS the tap window (Ek, 2026-09-10: "one
//          press drop pin, two press pick up, three pick up all" — it fired
//          at the up and the double then fired on top). So on such a button
//          one press is the tap, two the ×2, three the ×3, exactly one fires,
//          and the tap costs the window. A press never waits.
//   long   the timer, at the long time while still held.
//   extra long  a second timer, at the extra-long time while still held
//          (Ek, 2026-09-10: "i think we need an extra long hold"). Long has
//          already fired by then, the way a press has fired before a long —
//          so it carries what can follow a long, and a momentary on long is
//          still on when it fires. Learning waits for it: a hold released
//          between the two times learns as long.
//   ×2     the second down inside the tap window — INSTEAD of that down's own
//          press or tap (a looper's "press twice": the first press does its
//          thing, the second is the double). Waits the window only when a ×3
//          is bound on the same button. ×3 is the third down.
//   A hold action on any gesture is released on the up edge. On a button
//   with a press bound, the tap window is the shortest take it can make:
//   two downs inside it are a double, not start and stop. The tap timer
//   only runs on a button that has a ×2 or ×3 to count for.
let buttonMappings = {};
let buttonLearningId = null;
let _learnKeyEv = null;      // the key event a key learn started on (code + modifiers)
let _learnKeyDown = null;    // its code while it is still down
const BUTTON_GESTURES = ['press', 'tap', 'long', 'xlong', 'double', 'triple'];
const GESTURE_LABEL = { press: '', tap: 'tap', long: 'long', xlong: 'extra long', double: '×2', triple: '×3' };
// Position 3's tile (overdub) is a TOGGLE in the factory palette and position
// 2's (wash) is a MOMENTARY, and this map is why (tiles.js DEFAULT_PALETTE
// says so too): a `tap` is a bang on the up edge with no second edge, so it
// cannot drive a momentary — `_learnGesture` refuses exactly that pairing
// below. Button 1 tap therefore needs a toggle under it, and button 1 long,
// which has both edges, can have the momentary. Change one and change the
// other. (Positions 2 and 3 swapped roles with the 2026-09-12 factory strip.)
// BY POSITION on the factory strip of 2026-09-12 night (PALETTE_FACTORY_ORDER):
// button 1 tap plays LINE at 2 (a toggle — a tap is a bang with no up edge)
// and button 1 long plays DOTS at 1 (a momentary — long has both edges);
// button 3 tap is PIN at 6, ×2 UNPIN at 7; unpin all stays the action.
const BUTTON_DEFAULTS = {
  palette_2:        { btn: 1, g: 'tap' },  palette_1:        { btn: 1, g: 'long' },
  undo:             { btn: 2, g: 'tap' },  sweep:            { btn: 2, g: 'long' }, erase_all:    { btn: 2, g: 'xlong' },
  // Pin on button 3's PRESS, not its tap (Ek, 2026-09-12: "as i right click
  // thru pin it should have 3 states avail. right now it's just toggle and
  // bang. it should have momentary"): a tap has no up edge, so the model
  // refused momentary on the factory pin tile from day one. A press fires
  // undelayed, holds a momentary path, and the ×2 beside it takes the press's
  // pin back before unpinning (the swallow is general) — so button 3 is still
  // pin · unpin · unpin all, ~125 ms sooner.
  palette_6:        { btn: 3, g: 'press' }, palette_7:        { btn: 3, g: 'double' }, commit_clear: { btn: 3, g: 'triple' }
};
function loadButtonMappings() {
  try {
    const saved = localStorage.getItem('mubone_button_map');
    buttonMappings = saved ? JSON.parse(saved) : { ...BUTTON_DEFAULTS };
    let n = _migrateIds(buttonMappings);
    for (const bm of Object.values(buttonMappings)) if (bm && !bm.g) { bm.g = 'press'; n++; }
    // One-shot (2026-09-12): the factory pin was button 3 TAP; it is the press now.
    if (buttonMappings.palette_6?.btn === 3 && buttonMappings.palette_6?.g === 'tap') { buttonMappings.palette_6.g = 'press'; n++; }
    if (n) saveButtonMappings();
  } catch(e) { buttonMappings = { ...BUTTON_DEFAULTS }; }
}
function saveButtonMappings() {
  try { localStorage.setItem('mubone_button_map', JSON.stringify(buttonMappings)); } catch(e) {}
  S._bindingsChanged?.();
}
function buttonMappingLabel(bm) { return bm ? `btn ${bm.btn}${GESTURE_LABEL[bm.g] ? ' ' + GESTURE_LABEL[bm.g] : ''}` : ''; }
// A SOURCE is what a gesture is read on: `btn:N`, `key:Code[+mods]`, `note:ch:num`.
const btnSource  = n  => `btn:${n}`;
const keySource  = km => `key:${km.code}${km.shift ? '+shift' : ''}${km.ctrl ? '+ctrl' : ''}${km.meta ? '+meta' : ''}`;
const noteSource = mm => `note:${mm.channel}:${mm.number}`;
const keySourceOf = e => keySource({ code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey });
function sourceLabel(src) {
  if (src.startsWith('btn:')) return `button ${src.slice(4)}`;
  if (src.startsWith('note:')) { const [, ch, n] = src.split(':'); return `note ${n} ch${ch}`; }
  const km = Object.values(keyMappings).find(m => m && m.type === 'key' && keySource(m) === src);
  return km ? `key ${keyMappingLabel({ ...km, g: undefined })}` : src.replace(/^key:/, 'key ');
}
/** Every gesture binding in the three maps: [actionId, source, gesture]. */
function* _gestureBindings() {
  for (const [id, bm] of Object.entries(buttonMappings)) if (bm) yield [id, btnSource(bm.btn), bm.g || 'press'];
  for (const [id, km] of Object.entries(keyMappings)) if (km && km.type === 'key') yield [id, keySource(km), km.g || 'press'];
  for (const [id, mm] of Object.entries(midiMappings)) if (mm && mm.type === 'note') yield [id, noteSource(mm), mm.g || 'press'];
}
function actionForGesture(src, g) {
  for (const [id, s, gg] of _gestureBindings()) if (s === src && gg === g) return id;
  return null;
}
function _bindingsOnSource(src) {
  const out = new Set();
  for (const [, s, g] of _gestureBindings()) if (s === src) out.add(g);
  return out;
}
/** Which learn is armed for a source's kind — the recogniser learns into the
 *  map the source belongs to. */
function _learningFor(src) {
  return src.startsWith('btn:') ? buttonLearningId : src.startsWith('key:') ? keyLearningId : midiLearningId;
}

// The two windows, in ms. Set on Settings → Instrument buttons; kept here
// because the recogniser is here.
// Ek's numbers (2026-09-10): long 300, extra long 3000, tap window 120.
const BUTTON_TIMING_DEFAULT = { long: 300, xlong: 3000, tap: 120 };
let buttonTiming = { ...BUTTON_TIMING_DEFAULT };
function loadButtonTiming() {
  try { const t = JSON.parse(localStorage.getItem('mubone_button_timing') || 'null'); if (t) buttonTiming = { ...BUTTON_TIMING_DEFAULT, ...t }; } catch (_) {}
}
function setButtonTiming(t) {
  buttonTiming = { ...buttonTiming, ...t };
  // Extra long is a second timer past long; equal or shorter would fire both
  // at once, or the extra long first.
  if (buttonTiming.xlong <= buttonTiming.long) buttonTiming.xlong = buttonTiming.long + 100;
  try { localStorage.setItem('mubone_button_timing', JSON.stringify(buttonTiming)); } catch (_) {}
}

// Per-button recogniser state. `held` is the gesture whose hold action is
// down right now, released on the up edge whatever gesture it was. `swallowed`
// marks a down that fired ×2/×3 (or was learned) so its up edge fires no tap.
const _btn = {};
function _bs(btn) { return _btn[btn] || (_btn[btn] = { down: false, downAt: 0, taps: 0, tapTimer: null, longTimer: null, xlongTimer: null, held: [], swallowed: false, longFired: false, xlongFired: false, tapDeferred: false, pressAction: null, pressMark: null }); }
// A press's neighbour SWALLOWS what the press did (Ek, 2026-09-10: "set loop
// (toggle) on button 1 press, grain (momentary) on button 1 long — when long
// activates it'll cancel the loop that just started as if it was never meant
// to be, then do cloud"; and the same evening, pin on the press, pin a drawn
// path on the long: "i was expecting it to remove that first pin like it was
// never meant"). When long, extra long, ×2 or ×3 fires on a button whose
// press fired this sequence: everything the press wrote to the history since
// the down is taken back — a pin, a sweep, an erase — undone and gone, never
// redoable; and a gesture the press started (an activate) is aborted, its
// take thrown away and never armed. Then the neighbour fires.
// ONLY WHAT THE PRESS STARTED (Ek, 2026-09-12: loop toggle on 2, line
// toggle on 2 ×2 — "i double 2 to try toggle out of line but it doesn't
// respond, it's forever stuck recording"). The second double's first down
// pressed loop under the running line, which is dead by the one-play rule;
// the abort then threw away the LINE the press never touched, and the double
// started it again. `pressStarted` is read off the engine around the fire.
const _ACTIVATES = /^palette_[1-9]$/;
function _abortPress(st) {
  const id = st.pressAction; st.pressAction = null;
  const started = st.pressStarted; st.pressStarted = false;
  if (st.pressMark != null) { S._historyDiscardSince?.(st.pressMark); st.pressMark = null; }
  if (id && _ACTIVATES.test(id) && started) S._gestureAbort?.();
}
// A gesture whose action is momentary stays on until the up edge. More than
// one can be on at once — a momentary on press and another on long — so the
// button keeps a list and the release lets go of all of them.
function _hold(st, g) { if (g) st.held.push(g); }

function _fireGesture(src, g, down) {
  const id = actionForGesture(src, g);
  const action = id && ACTIONS.find(a => a.id === id);
  // Settings → Instrument buttons' live monitor reads this: the source (a
  // button, a key, a note), the gesture as read, and the action it landed
  // on (or none).
  window.dispatchEvent(new CustomEvent('button-gesture', { detail: { btn: src.startsWith('btn:') ? Number(src.slice(4)) : null, src, srcLabel: sourceLabel(src), g, down, id: action ? id : null, label: actionLabel(action) || null } }));
  if (!action) return null;
  if (action.type === 'hold') { dispatchAction(id, down ? 127 : 0); return down ? g : null; }
  if (down) dispatchAction(id, 127);
  return null;
}

// Learning: the whole gesture is watched, so assigning a press or a tap takes
// one tap window — the only time those wait for anything. Press and tap are
// the same physical thing, so learning either takes the other off the button.
function _learnGesture(src, g) {
  const id = _learningFor(src);
  if (id === null) return;
  // TAP is a bang on the up edge (back 2026-09-09 evening — Ek, testing: "it's
  // useful to have tap, which is fire on the up"). It has no second edge, so
  // a momentary cannot take it: the learn stays armed and says so.
  if (g === 'tap' && ACTIONS.find(a => a.id === id)?.type === 'hold') {
    setMappingStatus(`“${ACTIONS.find(a => a.id === id)?.label}” is momentary and needs an off edge — tap has none. Press, long-press or double-tap instead…`);
    return;
  }
  // A momentary action (type `hold`) can sit on any gesture that has two
  // edges — and every gesture does: press is on at the down, long is on at
  // the long time, ×2 / ×3 on at the second / third down, and all of them
  // are off at the release (_fireGesture returns the gesture as `held`, and
  // the up edge releases it). An earlier draft the same day forced a
  // momentary onto the press; Ek: "for momentary buttons, how come i can't
  // do btn3 long".
  // One gesture, one action: the same source+gesture on another row goes.
  for (const [other, s, gg] of [..._gestureBindings()]) {
    if (other === id || s !== src || gg !== g) continue;
    if (s.startsWith('btn:')) delete buttonMappings[other];
    else if (s.startsWith('key:')) delete keyMappings[other];
    else delete midiMappings[other];
  }
  let shown;
  if (src.startsWith('btn:')) {
    buttonMappings[id] = { btn: Number(src.slice(4)), g }; saveButtonMappings();
    shown = buttonMappingLabel(buttonMappings[id]); buttonLearningId = null;
  } else if (src.startsWith('key:')) {
    const ev = _learnKeyEv || {};
    keyMappings[id] = { type: 'key', key: ev.key ?? null, code: ev.code, shift: !!ev.shift, ctrl: !!ev.ctrl, meta: !!ev.meta, g }; saveKeyMappings();
    shown = keyMappingLabel(keyMappings[id]); keyLearningId = null; _learnKeyEv = null;
  } else {
    const [, ch, n] = src.split(':');
    midiMappings[id] = { type: 'note', channel: Number(ch), number: Number(n), g }; saveMidiMappings();
    shown = _midiLabel(midiMappings[id]); midiLearningId = null;
  }
  const action = ACTIONS.find(a => a.id === id);
  setMappingStatus(`mapped "${actionLabel(action)}" → ${shown}`);
  renderMappingTable();
  // The save above redrew the strip while the learn was still armed, so the
  // legend row still said "…": redraw now that it has stood down.
  S._bindingsChanged?.();
}

/** A physical button's edge. `btn` is 1-based, the number printed on the row. */
// A short press learns as the press, or as TAP when the cell was ⇧-clicked —
// the two are the same physical thing, so the cell has to say which.
let _learnShortAs = 'press';

/** The instrument's buttons, from sygaldry.js: button N's edge. */
function dispatchButton(n, down) { dispatchGesture(btnSource(n), down); }
/** The recogniser. `src` is a source string (btnSource · keySource · noteSource);
 *  `down` its edge. Learning is per source kind — the key cell learns keys. */
function dispatchGesture(btn, down) {
  const st = _bs(btn);
  if (down === st.down) return;
  st.down = down;
  const learning = _learningFor(btn) !== null;
  const bound = learning ? new Set(BUTTON_GESTURES) : _bindingsOnSource(btn);
  const counting = learning || bound.has('double') || bound.has('triple');

  if (down) {
    st.downAt = performance.now();
    st.swallowed = false; st.longFired = false; st.xlongFired = false;
    st.tapDeferred = false;                         // a second down makes the first press a double, not a tap
    // A down continues the count only while a window is OPEN — the timer the
    // last release started. Any other down is the first of a new sequence.
    // The count used to carry over from a press whose release was not counted
    // (a learn cancelled while the button was down, a binding changed under
    // it), and the next learn's first press then arrived as a ×2 (Ek,
    // 2026-09-10). Only a button with something to count for counts at all.
    const inWindow = st.tapTimer !== null;
    clearTimeout(st.tapTimer); st.tapTimer = null;
    st.taps = !counting ? 0 : inWindow ? st.taps + 1 : 1;
    // The second and third down inside the window are the double and the
    // triple — INSTEAD of their own press or tap. The first down always is.
    if (st.taps === 3 && counting && bound.has('triple')) {
      st.taps = 0; st.swallowed = true;
      if (learning) _learnGesture(btn, 'triple'); else { _abortPress(st); _hold(st, _fireGesture(btn, 'triple', true)); }
      return;
    }
    if (st.taps === 2 && !learning && bound.has('double') && !bound.has('triple')) {
      st.taps = 0; st.swallowed = true;
      _abortPress(st); _hold(st, _fireGesture(btn, 'double', true));
      return;
    }
    if (st.taps === 2 && counting) {
      // A ×3 may follow (or, learning, anything may): this down is neither a
      // press nor a tap; the tap timer decides double at the window's end.
      st.swallowed = true;
    } else if (!learning && bound.has('press')) {
      // The front edge, undelayed.
      st.pressAction = actionForGesture(btn, 'press');
      st.pressMark = S._undoCount?.() ?? null;       // what the press writes lands above this
      const wasOn = !!S._gestureActive?.();
      _hold(st, _fireGesture(btn, 'press', true));
      st.pressStarted = !wasOn && !!S._gestureActive?.();
    }
    if (bound.has('long')) {
      clearTimeout(st.longTimer);
      st.longTimer = setTimeout(() => {
        st.longTimer = null;
        if (!st.down) return;
        clearTimeout(st.tapTimer); st.tapTimer = null; st.taps = 0;
        st.longFired = true; st.swallowed = true;
        // Learning waits: the release decides long, the next timer extra long.
        if (!learning) { _abortPress(st); _hold(st, _fireGesture(btn, 'long', true)); }
      }, buttonTiming.long);
    }
    if (bound.has('xlong')) {
      clearTimeout(st.xlongTimer);
      st.xlongTimer = setTimeout(() => {
        st.xlongTimer = null;
        if (!st.down) return;
        clearTimeout(st.tapTimer); st.tapTimer = null; st.taps = 0;
        st.xlongFired = true; st.swallowed = true;
        if (learning) _learnGesture(btn, 'xlong');
        else { _abortPress(st); _hold(st, _fireGesture(btn, 'xlong', true)); }
      }, buttonTiming.xlong);
    }
  } else {
    clearTimeout(st.longTimer); st.longTimer = null;
    clearTimeout(st.xlongTimer); st.xlongTimer = null;
    if (st.held.length) { for (const g of st.held) _fireGesture(btn, g, false); st.held = []; }
    else if (!learning && !st.swallowed && bound.has('press')) _fireGesture(btn, 'press', false);
    // THE TAP WINDOW runs from the UP edge: it is the GAP after a press in
    // which the next press counts as the ×2 or ×3 (2026-09-10, evening). It
    // ran from the down until then, so at Ek's 120 ms a double had to land
    // its second down within 120 ms of the first — no hand does that; the
    // gap is what a hand controls. A long or extra long ends the sequence.
    const short = !st.longFired && !st.xlongFired;
    if (counting && short) {
      clearTimeout(st.tapTimer);
      st.tapTimer = setTimeout(() => {
        st.tapTimer = null;
        const n = st.taps; st.taps = 0;
        if (learning) _learnGesture(btn, n >= 3 ? 'triple' : n === 2 ? 'double' : _learnShortAs);
        else if (n === 2 && bound.has('double')) { _abortPress(st); _hold(st, _fireGesture(btn, 'double', true)); }
        else if (n === 1 && st.tapDeferred) { st.tapDeferred = false; _fireGesture(btn, 'tap', true); }
      }, buttonTiming.tap);
    }
    if (learning) {
      if (st.xlongFired) return;                    // learned at the timer
      if (st.longFired) _learnGesture(btn, 'long');
      return;                                       // else the window decides
    }
    if (st.swallowed) return;                       // a double, a triple, a long: no tap
    // TAP: a bang on the up edge of a short press nothing else claimed. It
    // may share the button with a press — the press fired at the down, the
    // tap fires now — so a press-and-tap button does both on every short press.
    if (bound.has('tap')) {
      // Beside a ×2 or ×3 the tap waits the window, so one press is a tap
      // and two are a double, never both.
      if (counting) st.tapDeferred = true;
      else _fireGesture(btn, 'tap', true);
    }
  }
}

/** What fires an action today, for a surface that shows its bindings (the
 *  palette's key legend, tiles.js): the learned key if there is one, the
 *  MIDI assignment if there is one. Read through a function, never through
 *  the map objects — the keys page replaces a map wholesale on "clear". */
function bindingOf(actionId) {
  const km = keyMappings[actionId], mm = midiMappings[actionId], bm = buttonMappings[actionId];
  return {
    key:    km ? keyMappingLabel(km) : null,
    removed: !!km && km.type === 'none',   // its factory key was right-clicked away
    midi:   mm ? (mm.type === 'cc' ? `cc ${mm.number}` : `n ${mm.number}${mm.g && GESTURE_LABEL[mm.g] ? ' ' + GESTURE_LABEL[mm.g] : ''}`) : null,
    button: bm ? buttonMappingLabel(bm) : null
  };
}
/** EVERY input bound to one action, for the palette's legend (PALETTE-GUI § 6).
 *  `bindingOf` above answers with LABELS for the keys page's three cells; this
 *  answers with the parts, because the tile draws source, gesture and delay in
 *  three colours and needs them apart.
 *
 *  `delayed` is § 7: binding `×2` or `×3` anywhere on an input makes that
 *  input's TAP wait the double window before it can fire, because the
 *  recogniser defers a tap it might have to re-read as the first of a pair
 *  (`dispatchGesture`: `if (counting) st.tapDeferred = true`). Measured at
 *  ~125 ms against ~0.3 ms on a button with no sibling — a timing change to a
 *  gesture the performer did not touch, so the tile says so. Only a TAP is
 *  slowed: a press fires on the down edge and never waits.
 *
 *  `factoryCode` is the tile's own digit, which is not in any map — pass it
 *  and it is reported like a learned key when nothing has taken it. */
function bindingsOf(actionId, factoryCode) {
  const out = [];
  const slow = (src, g) => g === 'tap' && (() => { const b = _bindingsOnSource(src); return b.has('double') || b.has('triple'); })();
  const km = keyMappings[actionId], bm = buttonMappings[actionId], mm = midiMappings[actionId];
  if (km && km.type === 'key') {
    const mods = (km.meta ? '⌘' : '') + (km.ctrl ? 'ctrl' : '') + (km.shift ? '⇧' : '');
    const g = km.g || 'press';
    out.push({ kind: 'key', label: mods + (km.code === 'Space' ? 'spacebar' : keyGlyph(km)), space: km.code === 'Space', g, delayed: slow(keySource(km), g) });
  } else if (factoryCode && !km && !keyTaken(factoryCode)) {
    const src = keySource({ code: factoryCode });
    out.push({ kind: 'key', label: factoryCode.replace(/^Digit|^Key/, ''), space: factoryCode === 'Space', g: 'press', delayed: slow(src, 'press') });
  }
  if (bm) { const g = bm.g || 'press'; out.push({ kind: 'button', label: String(bm.btn), g, delayed: slow(btnSource(bm.btn), g) }); }
  // The note's label is its number bare (PALETTE-GUI § 11.6): the `n ` went
  // with the ledger — the sticker's hue says the kind, and `n 127 tap` ran
  // 57.7px against a 53px tile.
  if (mm && mm.type === 'note') { const g = mm.g || 'press'; out.push({ kind: 'midi', label: String(mm.number), g, delayed: slow(noteSource(mm), g) }); }
  return out;
}

/** True when a factory key was learned onto some other action, so the
 *  factory binding it stood on is gone (tiles.js _keyRelearned's second half). */
function keyTaken(code) {
  return Object.values(keyMappings).some(m => m.type === 'key' && m.code === code && !m.shift && !m.ctrl && !m.meta);
}

// THE KEY'S OWN GLYPH (Ek, 2026-09-12, night: "arrow up down left right when
// i assign-learned it wrote out the whole word arrowup, should be just the
// correct glyph"). A learned key arrives as `e.key`, which for the arrows
// and the editing keys is a WORD; the keycap draws the mark the keyboard
// prints. By code, so a layout cannot change it.
const KEY_GLYPH = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Enter: '↩', NumpadEnter: '↩', Backspace: '⌫', Delete: '⌦',
  PageUp: '⇞', PageDown: '⇟', Home: '↖', End: '↘'
};
function keyGlyph(km) { return KEY_GLYPH[km.code] ?? (km.key || km.code); }

// Returns a human-readable label for a key mapping
function keyMappingLabel(km) {
  if (!km || km.type === 'none') return '';   // `none`: a factory key REMOVED (right-click)
  if (km.type === 'scroll_up')   return 'scroll ↑';
  if (km.type === 'scroll_down') return 'scroll ↓';
  const parts = [];
  if (km.meta)  parts.push('⌘');
  if (km.ctrl)  parts.push('ctrl');
  if (km.shift) parts.push('shift');
  // A learned spacebar arrives as e.key ' ' — blank in a cell — so it is named
  // (Ek, 2026-09-10: "anytime the assignment is space it should be spacebar").
  parts.push(km.code === 'Space' ? 'spacebar' : keyGlyph(km));
  // The gesture the key is read for (2026-09-11); a press says nothing, as on a button.
  return parts.join('+') + (km.g && GESTURE_LABEL[km.g] ? ' ' + GESTURE_LABEL[km.g] : '');
}

// Remove any existing binding that uses the same key combo (conflict resolution)
function removeConflictingKeyBinding(newMapping, skipId) {
  for (const [id, km] of Object.entries(keyMappings)) {
    if (id === skipId) continue;
    if (km.type === newMapping.type &&
        km.code === newMapping.code &&
        km.shift === newMapping.shift &&
        km.ctrl === newMapping.ctrl &&
        km.meta === newMapping.meta) {
      delete keyMappings[id];
    }
  }
}

function loadMidiMappings() {
  try {
    const saved = localStorage.getItem('mubone_midi_map');
    if (saved) midiMappings = JSON.parse(saved);
    if (_migrateIds(midiMappings)) saveMidiMappings();
  } catch(e) { midiMappings = {}; }
}

function saveMidiMappings() {
  try { localStorage.setItem('mubone_midi_map', JSON.stringify(midiMappings)); } catch(e) {}
  S._bindingsChanged?.();
}

// ── Per-mapping scale stage ─────────────────────────────────────────────────
// A cc mapping can carry a response curve and an output window — the same stage
// scale.js already applies to an accessory pot, now on the MIDI path it was
// written for.  It lives on the MAPPING, not the action: a fader and an OSC
// sender pointed at the same destination want different shapes, and the ccFn is
// the thing they have in common.
//
// Why it exists: a 7-bit cc has 128 steps and no more.  A curve cannot invent
// resolution the controller never sent — it redistributes the steps it did, so
// buying finer control at one end always spends it at the other.  Master volume
// linear in dB is 0.52 dB a step everywhere, half of them below −27 dB where
// nothing is audible; γ 0.5 halves the step at the top and pays for it with a
// 15 dB first step off the stop.
//
// Absent fields mean identity, so an untouched mapping dispatches the raw cc
// value byte for byte and nothing already bound changes feel.  Bounds are
// stored NORMALISED (0–1 of the destination's travel), matching
// accessory-registry: retargeting then keeps the same fraction of the throw
// rather than reading as a corrupt value in the new destination's units.

function mapScale(mapping) {
  const c = Number(mapping?.curve);
  const l = Number(mapping?.outLo);
  const h = Number(mapping?.outHi);
  return {
    curve: Number.isFinite(c) && c > 0 ? c : 1,
    lo:    Number.isFinite(l) ? l : 0,
    hi:    Number.isFinite(h) ? h : 1
  };
}

/** Is this mapping doing anything other than passing the cc straight through? */
function isScaled(mapping) {
  const s = mapScale(mapping);
  return Math.abs(s.curve - 1) > 0.001 || s.lo > 0.001 || s.hi < 0.999;
}

/** A destination has a throw to shape only if it's continuous and cc-bound. */
function scaleEditable(action, mapping) {
  return action?.type === 'cc' && mapping?.type === 'cc';
}

// ── MIDI input enable (per instance profile) ────────────────────────────────
// Multi-station: every instance sees every CoreMIDI device, so a shared pedal
// (FCB-1010 → Max) would also fire directly in all instances with mappings.
// Stations driven by OSC turn MIDI input OFF here.  Default ON — solo
// behaviour unchanged.  Persisted per profile: 'mubone_midi_input'.
let midiInputEnabled = (() => {
  try { return localStorage.getItem('mubone_midi_input') !== 'off'; }
  catch (_) { return true; }
})();

function _syncMidiInputToggleUI() {
  const tog = document.getElementById('midiInputToggle');
  if (tog) tog.checked = midiInputEnabled;
  const portEl = document.getElementById('midiPortName');
  if (portEl && !midiInputEnabled) portEl.textContent = 'Off';
}

export async function initMidi() {
  if (!navigator.requestMIDIAccess) return;

  const toggleBtn = document.getElementById('midiInputToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('change', () => {
      midiInputEnabled = !!toggleBtn.checked;
      try { localStorage.setItem('mubone_midi_input', midiInputEnabled ? 'on' : 'off'); } catch (_) {}
      if (midiInputEnabled) refreshMidiInputs();
      _syncMidiInputToggleUI();
    });
    _syncMidiInputToggleUI();
  }

  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    refreshMidiInputs();
    midiAccess.onstatechange = refreshMidiInputs;
  } catch(e) {
    DEBUG && console.log('MIDI not available:', e.message);
  }
}

function refreshMidiInputs() {
  const inputs = [...midiAccess.inputs.values()];
  const portEl = document.getElementById('midiPortName');
  if (portEl) portEl.textContent = midiInputEnabled
    ? (inputs.length
        ? `${inputs.map(i => i.name).join(', ')} · ${inputs.length} port${inputs.length === 1 ? '' : 's'} available`
        : 'No devices attached')
    : 'Off';
  for (const input of inputs) {
    input.onmidimessage = handleMidiMessage;
  }
}

function handleMidiMessage(event) {
  if (!midiInputEnabled) return;   // per-instance MIDI kill switch
  const [status, num, val] = event.data;
  const type    = status >> 4;
  const channel = (status & 0xF) + 1;

  // Broadcast raw message for the keys/midi/osc live monitor.  Dispatched before
  // any dispatch/learn logic so the monitor sees every byte even if unmapped.
  try {
    window.dispatchEvent(new CustomEvent('mubone-midi-in', {
      detail: { status, num, val, type, channel, ts: performance.now() }
    }));
  } catch (_) {}

  // A NOTE is a two-edged source like a button (2026-09-11): on and off go to
  // the recogniser, which reads press · tap · long · extra long · ×2 · ×3 on it
  // and, learning, learns the gesture performed. A CC has travel, not edges.
  const isNote = type === 9 || type === 8;
  if (isNote) {
    const src = noteSource({ channel, number: num });
    const down = type === 9 && val > 0;
    if (midiLearningId !== null || _bindingsOnSource(src).size) dispatchGesture(src, down);
    return;
  }
  if (midiLearningId !== null) {
    midiMappings[midiLearningId] = { type: 'cc', channel, number: num };
    saveMidiMappings();
    const action = ACTIONS.find(a => a.id === midiLearningId);
    setMappingStatus(`mapped "${actionLabel(action)}" → CC ${num} ch${channel}`);
    midiLearningId = null;
    renderMappingTable();
    return;
  }

  // Sends its release edge: a hold by declaration, or a palette slot tap —
  // ALWAYS for those three, not only while "tool keys fire" is on. The
  // switch can flip while a note or CC bound to one is down, and the
  // release must still land or the hold is stranded; with the switch off,
  // a 0 there is a no-op (tiles.js S._paletteTap).
  const _isHold = a => a.type === 'hold';
  for (const action of ACTIONS) {
    if (!action.id) continue;  // skip group headers
    const mapping = midiMappings[action.id];
    if (!mapping) continue;
    const matchCC   = mapping.type === 'cc'   && type === 11 && mapping.number === num && mapping.channel === channel;
    // For trigger-type actions mapped to CC, only fire on press (val > 0), not release
    if (matchCC && action.type === 'trigger' && !_isHold(action) && val === 0) continue;
    if (matchCC) {
      // Continuous destinations go through the mapping's scale stage; a trigger
      // or hold has no throw to shape and passes the raw press value.
      // dispatchAction's domain is not integer-only, so the shaped float
      // survives all the way into the ccFn.
      const out = action.type === 'cc' ? scaleControl(val / 127, mapScale(mapping)) * 127 : val;
      dispatchAction(action.id, out);
    }
  }
}

// Brief flash on a button element (same 180ms pattern used by undo, commit, etc.)
function _flash(el) {
  if (!el) return;
  el.classList.add('flashing');
  setTimeout(() => el.classList.remove('flashing'), 180);
}

// #105: OSC string-set support. Multi-option controls historically cycled on
// bang; they now ALSO accept the target mode as a string (e.g.
// `/camera/mode sensor`, `/commit/mode loop`) so external controllers
// can set a specific mode without cycling. Normalizes case/aliases; returns
// the canonical mode or null (→ fall back to cycling).
function _strMode(midiVal, modes, aliases = {}) {
  if (typeof midiVal !== 'string' || !midiVal) return null;
  const v = midiVal.trim().toLowerCase();
  const c = aliases[v] ?? v;
  return modes.includes(c) ? c : null;
}

function dispatchAction(id, midiVal) {
  switch(id) {
    case 'mute':
      if (S._setMuted) S._setMuted(!S.isMuted);
      else S.isMuted = !S.isMuted;
      break;
    // The dry monitor's mute is a MODE change — off is the mute, and unmuting
    // returns to the mode it left (on or auto), never blindly to on. The
    // setting is never persisted (state.js), so neither is what it left.
    case 'dry_mute': {
      if (S.dryMonitorMode !== 'off') { S._dryModeBeforeMute = S.dryMonitorMode; S._setDryMonitorMode?.('off'); }
      else S._setDryMonitorMode?.(S._dryModeBeforeMute || 'on');
      break;
    }
    case 'dry_mute_hold': {
      const on = midiVal > 0;
      if (on) {
        if (S._dryMuteHoldPrev == null) S._dryMuteHoldPrev = S.dryMonitorMode;
        S._setDryMonitorMode?.('off');
      } else if (S._dryMuteHoldPrev != null) {
        const prev = S._dryMuteHoldPrev; S._dryMuteHoldPrev = null;
        S._setDryMonitorMode?.(prev);
      }
      break;
    }
    case 'mute_hold': {
      // Momentary (cough-button) mute. Release restores the state at press
      // time rather than blindly unmuting — otherwise tapping the pedal while
      // the system was already muted by M would open the output mid-set.
      //
      // The press state lives on S rather than in a module local because a
      // press can arrive from one transport and the release from another (key
      // down, accessory unplugged) — and the accessory watchdog synthesises a
      // release for every held action on unplug, which lands here as val 0.
      const on = midiVal > 0;
      if (on) {
        if (S._muteHoldPrev == null) S._muteHoldPrev = !!S.isMuted;
        if (S._setMuted) S._setMuted(true); else S.isMuted = true;
      } else if (S._muteHoldPrev != null) {
        const prev = S._muteHoldPrev;
        S._muteHoldPrev = null;
        if (S._setMuted) S._setMuted(prev); else S.isMuted = prev;
      }
      break;
    }
    case 'pitch_oct_down':  S._pitchOctave?.(-1); break;
    case 'pitch_oct_reset': S._pitchOctave?.(0);  break;
    case 'pitch_oct_up':    S._pitchOctave?.(1);  break;
    case 'scan_toggle':
      // OSC sends 0|1 (0 = off, 1 = on); keys/GUI send 127 → toggle
      if (midiVal === 1)       setScanMuted(false);   // 1 = scan ON
      else if (midiVal === 0)  setScanMuted(true);    // 0 = scan OFF
      else                     setScanMuted(!S.scanMuted); // 127 = toggle
      break;
    case 'tare':
      S._tareCursor?.();
      break;
    case 'erase_all':
      S._sessionEraseAll?.();
      break;
    case 'undo':        undoLastStroke(); break;
    case 'redo':        redoLastStroke(); break;
    case 'sweep':
      if (S._sessionSweep) S._sessionSweep();
      else sweep();
      break;
    case 'handsfree':
      toggleHandsfree();
      break;

    // ── View ─────────────────────────────────────────────────────────────────
    // `recpaint` and `trace_toggle` were handled here — the main button as a
    // pedal and as a toggle. They are gone (2026-09-11): a play is started by
    // a POSITION through `S._paletteFire`, or by the HAND through
    // `S._handDown` — the spacebar and the sphere's click, which are wired to
    // it directly and never come through here (2026-09-12).

    // ── Trigger tool ────────────────────────────────────────────────────────
    case 'trigger_chop':
      // Same shape as scan_toggle: 1 / 0 set, anything else (a bang) toggles.
      // The row existed in ACTIONS since #194 with no case here, so a pad or
      // /trigger/chop bound to it did nothing — osc-audit's wiring section
      // reported it on every run and nobody could tell it from #322.
      if (midiVal === 1)       S._setChopOn?.(true);
      else if (midiVal === 0)  S._setChopOn?.(false);
      else                     S._setChopOn?.(!S.triggerParams.chopOn);
      break;

    // ── Commit: unified drop/draw/release/clear ─────────────────────────────
    // Both pin forms are the `=` key's own path (tiles.js S._pinTap / S._pinHold,
    // 2026-09-10): what the cursor is on decides, never the commitMode setting.
    case 'commit_drop':
      S._pinTap?.();
      _flash(document.getElementById('commitDropBtn'));
      S._pinFlash?.('pin');
      break;
    case 'commit_draw': {
      const on = midiVal > 0;
      S._pinHold?.(on);
      document.getElementById('commitDrawBtn')?.classList.toggle('painting', on);
      break;
    }
    case 'commit_release':
      releaseCommit();
      _flash(document.getElementById('commitReleaseBtn'));
      S._pinFlash?.('unpin');
      break;
    case 'commit_clear':
      clearAllCommits();
      _flash(document.getElementById('commitClearBtn'));
      S._pinFlash?.('all');
      break;
    // The MIX pair (Ek, 2026-09-15): silence everything, bring it back. They
    // are not unpin — nothing is released, so the pins and their material are
    // still there when the sound comes back.
    // Explicit 1/0 sets it, a bare bang flips it — so one OSC address and one
    // MIDI note both work, and a pad that only sends 127 is still a toggle.
    case 'pins_mute': {
      const want = midiVal == null ? !S._pinsAllMuted?.() : midiVal > 0;
      S._pinsSetAllMuted?.(want);
      S._pinsMuteLit?.(want);
      break;
    }
    case 'pins_unmute_all':
      S._pinsAllOn?.();
      S._pinFlash?.('unmuteall');
      break;
    case 'commit_selection': {
      S.selectionMode = _strMode(midiVal, ['nearest', 'oldest'], { closest: 'nearest' })
        ?? (S.selectionMode === 'nearest' ? 'oldest' : 'nearest');
      S._syncImprovUI?.();
      break;
    }
    case 'commit_overflow': {
      const modes = ['off', 'oldest', 'nearest'];
      const curOF = S.seedOverflow || 'off';
      const nextOF = _strMode(midiVal, modes)
        ?? modes[(modes.indexOf(curOF) + 1) % modes.length];
      S.seedOverflow = nextOF;
      S.seqOverflow  = nextOF;
      const seg = document.getElementById('commitOverflowSeg');
      if (seg) seg.querySelectorAll('.grain-seg-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.overflow === nextOF));
      break;
    }
    case 'commit_dir': {
      const cycle = { pingpong: 'forward', forward: 'rev', rev: 'pingpong' };
      S.seedLoopMode = _strMode(midiVal, ['pingpong', 'forward', 'rev'],
        { fwd: 'forward', reverse: 'rev', 'ping-pong': 'pingpong' })
        ?? cycle[S.seedLoopMode] ?? 'forward';
      const seg = document.getElementById('seedLoopModeSeg');
      if (seg) seg.querySelectorAll('[data-loopmode]').forEach(b =>
        b.classList.toggle('active', b.dataset.loopmode === S.seedLoopMode));
      break;
    }
    case 'loop_release_mode': {
      S.loopReleaseMode = _strMode(midiVal, ['fade', 'play-to-end'],
        { play_to_end: 'play-to-end', playtoend: 'play-to-end', end: 'play-to-end' })
        ?? (S.loopReleaseMode === 'fade' ? 'play-to-end' : 'fade');
      const lrSeg = document.getElementById('loopReleaseModeSeg');
      if (lrSeg) lrSeg.querySelectorAll('[data-lrmode]').forEach(b =>
        b.classList.toggle('active', b.dataset.lrmode === S.loopReleaseMode));
      break;
    }
    case 'commit_blend':
      S.seedMode = _strMode(midiVal, ['focus', 'all'])
        ?? (S.seedMode === 'focus' ? 'all' : 'focus');
      S._syncImprovUI?.();
      break;
    case 'commit_tether':
      S.seedTether = !S.seedTether;
      S._syncImprovUI?.();
      break;

    // ── Search ──────────────────────────────────────────────────────────────
    case 'snap':         toggleNearestMode(); break;
    case 'k_all':
      if (!S.nearestMode) { S.grainKAllMode = !S.grainKAllMode; updatePlaybackControls(); }
      break;
    case 'k_seq':
      S.grainKSeqMode = !S.grainKSeqMode;
      updatePlaybackControls();
      S._updateWorkletParams?.({ kSeqMode: S.grainKSeqMode });
      break;
    case 'radius_fade':
      S.radiusFadeEnabled = !S.radiusFadeEnabled;
      S._syncRadiusFadeUI?.();
      break;
    case 'grain_dir': {
      const dirs = ['fwd', 'rev', 'rnd'];
      S.grainDirection = _strMode(midiVal, dirs,
        { forward: 'fwd', reverse: 'rev', random: 'rnd', rand: 'rnd' })
        ?? dirs[(dirs.indexOf(S.grainDirection) + 1) % dirs.length];
      S.syncGrainControlsUI?.();
      break;
    }
    case 'grain_curve': {
      const curves = ['hann', 'tri', 'rect'];
      S.grainCurveType = _strMode(midiVal, curves,
        { triangle: 'tri', rectangle: 'rect', square: 'rect' })
        ?? curves[(curves.indexOf(S.grainCurveType) + 1) % curves.length];
      S.syncGrainControlsUI?.();
      break;
    }
    // THE PALETTE BY POSITION — one action each (docs/PALETTE-GUI.md § 1).
    // The VERB is the tile's, so this hands the raw edge to tiles.js and asks
    // nothing: a bang tile acts on the down and ignores the 0, a momentary
    // takes both edges, a toggle flips on the down. `palette_N_toggle` and
    // `palette_N_hold` — 18 of the old 27 rows — are gone with the three-verb
    // position; `_collapsePaletteVerbsOnce` moved any binding on them here.
    case 'palette_1': S._paletteFire?.(0, midiVal > 0); break;
    case 'palette_2': S._paletteFire?.(1, midiVal > 0); break;
    case 'palette_3': S._paletteFire?.(2, midiVal > 0); break;
    case 'palette_4': S._paletteFire?.(3, midiVal > 0); break;
    case 'palette_5': S._paletteFire?.(4, midiVal > 0); break;
    case 'palette_6': S._paletteFire?.(5, midiVal > 0); break;
    case 'palette_7': S._paletteFire?.(6, midiVal > 0); break;
    case 'palette_8': S._paletteFire?.(7, midiVal > 0); break;
    case 'palette_9': S._paletteFire?.(8, midiVal > 0); break;
    case 'wet_toggle':
      // Same convention as scan_toggle: OSC 0|1 sets, keys/GUI send 127 → toggle.
      S._setWet?.(midiVal === 1 ? true : midiVal === 0 ? false : null);
      break;
    case 'cursor_lock':
      // One owner. The body that used to sit here was a copy of events.js's and
      // had lost _syncSessionAltLock, the surface overlay and the entry-hint
      // dismissal along the way — so a pedal and the ⌥ key left the app in
      // measurably different states.
      S._setCursorLock?.(midiVal > 0);
      break;
    case 'az_source':
    case 'el_source': {
      if (midiVal === 0) break; // act on press only, ignore release
      // Same bang-cycles / string-sets idiom as trace_mode: a pedal cycles,
      // Max can address a state directly.  Frozen-snapshot clearing and the
      // DOM sync both live in setAxisSource() (main.js) — one owner.
      const stateKey = id === 'az_source' ? 'azSource' : 'elSource';
      const set = _strMode(midiVal, AXIS_SOURCES, { free: 'sensor', lock: 'locked', map: 'mapped' });
      // A bang toggles HELD ↔ FREE, the same two states the footer button has
      // (2026-09-01) — a pedal that steps a foot into 'mapped' mid-set is the
      // same trap the three-state button was. The explicit string sets keep all
      // three, so Max can still address 'mapped' directly.
      S._setAxisSource?.(stateKey, set ?? (axisHeld(S[stateKey]) ? 'sensor' : 'locked'));
      break;
    }
    case 'radius_dec':
      S.searchRadiusDeg = Math.max(SEARCH_RADIUS_MIN, S.searchRadiusDeg - SEARCH_RADIUS_STEP);
      updatePlaybackControls(); flashRadiusTooltip();
      break;
    case 'radius_inc':
      S.searchRadiusDeg = Math.min(SEARCH_RADIUS_MAX, S.searchRadiusDeg + SEARCH_RADIUS_STEP);
      updatePlaybackControls(); flashRadiusTooltip();
      break;
    case 'source_live':
      if (midiVal > 0) S._samplerSelectSource?.('live');
      break;
    case 'source_sampler':
      if (midiVal > 0) S._samplerSelectSource?.('sampler');
      break;
    case 'sampler_sample':
      if (midiVal > 0) S._samplerSelectSample?.(midiVal);
      break;
    case 'sampler_record':
      S._samplerCaptureHold?.(midiVal > 0);
      break;
    default:
      // CC actions and any other actions dispatched via ccFn
      { const action = ACTIONS.find(a => a.id === id);
        if (action?.type === 'cc' && action.ccFn) action.ccFn(midiVal); }
      break;
  }
}

// ── Modal UI ─────────────────────────────────────────────────────────────────

// ── Row filter ───────────────────────────────────────────────────────────────
// The action list is ~100 rows.  cmd+F is a no-op in the Electron build (no app
// menu, so no find bar) and in the browser it only highlights — neither gets you
// to one row.  This hides everything that doesn't match instead.
let _mapFilter = '';
// Bound rows only, by default (Ek, 2026-09-10: "hide anything that doesn't
// have a binding by default, and add a show all / hide toggle at the top").
// A binding is a learned key, a factory key nobody else has taken, a button
// or a MIDI assignment; a row being learned counts, so it cannot vanish.
let _mapShowAll = false;
try { _mapShowAll = localStorage.getItem('mubone_keys_show_all') === '1'; } catch (_) {}

// Hide rows that don't match every whitespace-separated term, and hide a group
// header when nothing under it survived.  Walks backwards so each header is
// reached after the rows it introduces.
function _applyMappingFilter() {
  const body = document.getElementById('mappingTableBody');
  if (!body) return;

  const terms = _mapFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows  = [...body.children];
  let shown = 0, total = 0, groupHasVisible = false;

  // Backwards, so a group heading knows whether anything under it survived.
  for (let i = rows.length - 1; i >= 0; i--) {
    const el = rows[i];
    if (el.dataset.groupHeader) {
      el.classList.toggle('filtered-out', !groupHasVisible);
      groupHasVisible = false;
      continue;
    }
    total++;
    const hit = (_mapShowAll || el.dataset.bound === '1') &&
                (terms.length === 0 || terms.every(t => (el.dataset.search || '').includes(t)));
    el.classList.toggle('filtered-out', !hit);
    if (hit) { shown++; groupHasVisible = true; }
  }

  const countEl = document.getElementById('mappingFilterCount');
  if (countEl) countEl.textContent = (terms.length || !_mapShowAll)
    ? `${shown} of ${total} actions`
    : `${total} actions`;
  document.querySelector('.set-toolbar')?.classList.toggle('filtering', terms.length > 0);
}

function _setMappingFilter(v, { focus = false } = {}) {
  const el = document.getElementById('mappingFilter');
  if (el) el.value = v;
  _mapFilter = v;
  _applyMappingFilter();
  if (focus) el?.focus();
}

function openMappingModal() {
  renderMappingTable();
  document.getElementById('mappingModal').classList.add('open');
  // Focus the filter on open — typing is the fastest way into a 100-row table,
  // and select() means an old query is replaced rather than appended to.
  const filterEl = document.getElementById('mappingFilter');
  if (filterEl) { filterEl.focus(); filterEl.select(); }
  // Force a monitor render so any messages already in the ring buffer are
  // visible immediately.  Also lets the user confirm the monitor is mounted:
  // empty ring renders "— waiting for messages —", so the pane never looks
  // "broken" just because nothing's arrived yet.
  _midiDirty = true;
  _oscDirty  = true;
  _scheduleMonRender();
}

function closeMappingModal() {
  midiLearningId = null;
  keyLearningId  = null;
  _setMappingFilter('');   // don't leave a stale query hiding rows next open
  document.getElementById('mappingModal').classList.remove('open');
  setMappingStatus('');
  renderMappingTable();
}

const _MAP_HINT = 'Click a cell to learn · right-click to clear';
function setMappingStatus(msg) {
  const el = document.getElementById('mappingStatus');
  // Empty means "nothing to report", and an empty slot where an instruction
  // was reads as the page having lost something. It goes back to the hint.
  if (el) el.textContent = msg || _MAP_HINT;
}

// ── Live MIDI/OSC monitor ───────────────────────────────────────────────────
// Ring buffers are filled unconditionally; DOM is only updated when the modal
// is visible and pause is off.  Each render is flushed at most once per rAF
// so a burst of sensor data (e.g. 100Hz /sensor/*/inertial) can't starve the
// main thread.

const MONITOR_MAX = 200;
const _midiRing = [];
const _oscRing  = [];
let _midiDirty = false;
let _oscDirty  = false;
let _monPaused = false;
let _monRafQueued = false;
// Sensor STREAMS stay out of the log (Ek, 2026-09-10: "the osc live monitor
// should filter out the osc quaternion and sensor data"): a quaternion at
// 100–400 Hz buries every control message in seconds. They are counted, not
// dropped silently — the count is how you know the sensor is arriving at all.
const _OSC_STREAM = /^\/sensor\//;
let _oscStreamHidden = 0;

function _pad2(n) { return n < 10 ? '0' + n : '' + n; }
function _pad3(n) { return n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n; }

function _tsStr(d) {
  return _pad2(d.getHours()) + ':' + _pad2(d.getMinutes()) + ':' +
         _pad2(d.getSeconds()) + '.' + _pad3(d.getMilliseconds());
}

// Raw MIDI → human-readable line
function _fmtMidi(m) {
  const ts = _tsStr(new Date());
  const ch = 'ch' + m.channel;
  switch (m.type) {
    case  8: return `${ts}  NoteOff  ${ch}  #${m.num} vel ${m.val}`;
    case  9: return `${ts}  ${m.val === 0 ? 'NoteOff ' : 'NoteOn  '} ${ch}  #${m.num} vel ${m.val}`;
    case 10: return `${ts}  Aftertch ${ch}  #${m.num} ${m.val}`;
    case 11: return `${ts}  CC       ${ch}  #${m.num} = ${m.val}`;
    case 12: return `${ts}  Program  ${ch}  #${m.num}`;
    case 13: return `${ts}  ChanPres ${ch}  ${m.num}`;
    case 14: return `${ts}  PitchBnd ${ch}  ${(m.num | (m.val << 7)) - 8192}`;
    default: return `${ts}  raw      st=${m.status.toString(16)} ${m.num} ${m.val}`;
  }
}

function _fmtOsc(o) {
  const ts = _tsStr(new Date());
  // Trim long float strings but keep precision for short lists
  const args = o.values.map(v => {
    if (typeof v === 'number') {
      if (Number.isInteger(v)) return String(v);
      // 4 sig figs is enough for monitor display
      const s = v.toFixed(4);
      return s.replace(/\.?0+$/, '') || '0';
    }
    return JSON.stringify(v);
  }).join(' ');
  return `${ts}  ${o.address}${args ? '  ' + args : ''}`;
}

function _monitorModalOpen() {
  return _visible();
}

/** Is this page on screen? Two hosts, and only one of them is the modal: the
 *  settings shell (#255) MOVES this dialog into #settingsHost and takes the
 *  overlay's `.open` back off, so the monitor rendered nothing and cmd-F did
 *  nothing for the whole time the page was hosted — which is all of the time,
 *  since the shell became the only door (#291). */
function _visible() {
  return !!document.getElementById('mappingModal')?.classList.contains('open')
      || !!document.querySelector('.settings-host .mapping-dialog');
}

function _monPaint(el, ring, what) {
  if (!el) return;
  if (!ring.length) {
    el.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'set-empty';
    empty.textContent = `Nothing received yet.`;
    el.appendChild(empty);
    return;
  }
  // Newest last, and the pane is scrolled to it: a monitor you have to scroll
  // to see the latest line of is not telling you anything live.
  el.innerHTML = '';
  for (const line of ring) {
    const d = document.createElement('div');
    d.className = 'mon-line';
    d.textContent = line;
    el.appendChild(d);
  }
  el.scrollTop = el.scrollHeight;
}

function _scheduleMonRender() {
  if (_monRafQueued) return;
  _monRafQueued = true;
  requestAnimationFrame(() => {
    _monRafQueued = false;
    if (_monPaused) return;
    if (!_monitorModalOpen()) return;
    if (_midiDirty) {
      _monPaint(document.getElementById('ioMonMidiLog'), _midiRing, 'MIDI');
      const c = document.getElementById('ioMonMidiCount');
      if (c) c.textContent = String(_midiRing.length);
      _midiDirty = false;
    }
    if (_oscDirty) {
      _monPaint(document.getElementById('ioMonOscLog'), _oscRing, 'OSC');
      const c = document.getElementById('ioMonOscCount');
      if (c) c.textContent = String(_oscRing.length);
      const h = document.getElementById('ioMonOscHidden');
      if (h) h.textContent = _oscStreamHidden ? `· ${_oscStreamHidden.toLocaleString()} sensor messages hidden` : '';
      _oscDirty = false;
    }
  });
}

function setupIOMonitor() {
  window.addEventListener('mubone-midi-in', (ev) => {
    if (_monPaused) return;
    _midiRing.push(_fmtMidi(ev.detail));
    if (_midiRing.length > MONITOR_MAX) _midiRing.shift();
    _midiDirty = true;
    _scheduleMonRender();
  });

  window.addEventListener('mubone-osc-in', (ev) => {
    if (_monPaused) return;
    if (_OSC_STREAM.test(ev.detail.address)) { _oscStreamHidden++; _oscDirty = true; _scheduleMonRender(); return; }
    _oscRing.push(_fmtOsc(ev.detail));
    if (_oscRing.length > MONITOR_MAX) _oscRing.shift();
    _oscDirty = true;
    _scheduleMonRender();
  });

  const pauseEl = document.getElementById('ioMonPause');
  if (pauseEl) pauseEl.addEventListener('change', () => { _monPaused = pauseEl.checked; });

  const clearEl = document.getElementById('ioMonClear');
  if (clearEl) clearEl.addEventListener('click', () => {
    _midiRing.length = 0;
    _oscRing.length  = 0;
    _oscStreamHidden = 0;
    _midiDirty = true;
    _oscDirty  = true;
    _scheduleMonRender();
  });
}

// ── Scale cells for one mapping row ─────────────────────────────────────────
// The min / max / γ trio, mirroring the accessory table (ui-accessory.js) so the
// two places you shape a controller look and behave the same.  min and max are
// typed in the DESTINATION's own units (dB, Hz, cents) and stored normalised; γ
// is the response exponent.  Rows with nothing to shape still get three cells,
// dimmed and disabled, so the columns stay aligned down ~100 rows.
//
// Edits are committed on Enter or blur, never per keystroke — typing "-24"
// would otherwise apply "-" and "-2" on the way through and move the window
// twice mid-edit.  Committing re-syncs only this row rather than re-rendering
// the table: a full rebuild on blur would destroy the box you just tabbed into.
function _el(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

/** A binding cell: 30px, the kit's small button, and the button IS the learn
 *  control — click to learn, right-click to clear. Two columns of "learn" and
 *  "✕" buttons pointing at the cell beside them were the same thing said
 *  three times. */
function _bindBtn(label, { empty = false, learning = false, title = '' } = {}) {
  const b = _el('button', 'bind-btn'
    + (empty ? ' bind-btn--empty' : '')
    + (learning ? ' bind-btn--learning' : ''), learning ? 'Listening…' : label);
  if (title) b.title = title;
  return b;
}

// ── The scale menu ──────────────────────────────────────────────────────────
// min / max / γ, behind the cell that reads them out. They are read constantly
// and edited rarely, so three always-on columns were three columns paying rent
// for a popover. Same maths as before, same units, same double-click reset.
//
// Edits commit on Enter or blur, never per keystroke — typing "-24" would
// otherwise apply "-" and "-2" on the way through and move the window twice.
let _openScaleMenu = null;
function _closeScaleMenu() {
  if (_openScaleMenu) { _openScaleMenu.remove(); _openScaleMenu = null; }
}
document.addEventListener('mousedown', e => {
  if (_openScaleMenu && !_openScaleMenu.contains(e.target)) _closeScaleMenu();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') _closeScaleMenu(); });

function _scaleLabel(action, mapping) {
  if (!isScaled(mapping)) return 'Full travel';
  const range = action.range;
  const sc = mapScale(mapping);
  const base = baseGamma(range);
  const g = fmtNumber(sc.curve * base);
  if (!range) return `γ${g}`;
  const unit = range.unit ? ` ${range.unit}` : '';
  return `${fmtNumber(fromNorm(range, sc.lo), !!range.int)}–${fmtNumber(fromNorm(range, sc.hi), !!range.int)}${unit} γ${g}`;
}

function _openScale(cell, btn, action, mapping, redraw) {
  _closeScaleMenu();
  const range   = action.range;
  const bounded = !!range;
  const base    = baseGamma(range);
  const menu = _el('div', 'set-menu scale-menu');

  const field = (labelText, disabled) => {
    const row = _el('div', 'scale-menu-row');
    row.appendChild(_el('span', null, labelText));
    const wrap = _el('span', 'set-field');
    const input = document.createElement('input');
    input.type = 'text';
    input.disabled = !!disabled;
    wrap.appendChild(input);
    row.appendChild(wrap);
    menu.appendChild(row);
    return input;
  };
  const minBox   = field(range?.unit ? `min (${range.unit})` : 'min', !bounded);
  const maxBox   = field(range?.unit ? `max (${range.unit})` : 'max', !bounded);
  const curveBox = field('γ', false);

  const sync = () => {
    const sc = mapScale(mapping);
    if (bounded) {
      minBox.value = fmtNumber(fromNorm(range, sc.lo), !!range.int);
      maxBox.value = fmtNumber(fromNorm(range, sc.hi), !!range.int);
    } else {
      minBox.placeholder = maxBox.placeholder = '—';
    }
    curveBox.value = fmtNumber(sc.curve * base);
    btn.textContent = _scaleLabel(action, mapping);
  };

  const commit = (box, apply) => {
    box.addEventListener('blur', () => { apply(box); saveMidiMappings(); sync(); redraw(); });
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); box.blur(); }
      if (e.key === 'Escape') { sync(); box.blur(); }
    });
  };

  if (bounded) {
    const full = `${fmtNumber(rangeMin(range), !!range.int)}–${fmtNumber(rangeMax(range), !!range.int)}${range.unit ? ' ' + range.unit : ''}`;
    minBox.title = maxBox.title =
      `where the two ends of the controller's travel land — full travel of this destination: ${full}`;
    const boundBox = (box, key) => commit(box, b => {
      const typed = parseFloat(String(b.value).replace(/[^\d.+-]/g, ''));
      if (Number.isFinite(typed)) mapping[key] = toNorm(range, clampReal(range, typed));
    });
    boundBox(minBox, 'outLo');
    boundBox(maxBox, 'outHi');
  }

  curveBox.title = `response exponent for the whole chain — 1 linear, above 1 gives fine control at the bottom of the throw, below 1 at the top. this destination starts at ${fmtNumber(base)}, which is the curve its own ccFn applies. double-click to reset the whole scale stage.`;
  commit(curveBox, b => {
    const typed = parseFloat(String(b.value).replace(/[^\d.]/g, ''));
    // Divide the destination's own exponent back out: the box is the product of
    // the two, the mapping stores only its own share.
    if (Number.isFinite(typed)) mapping.curve = clampGamma(typed / base);
  });
  curveBox.addEventListener('dblclick', () => {
    delete mapping.curve; delete mapping.outLo; delete mapping.outHi;
    saveMidiMappings(); sync(); redraw();
  });

  sync();
  cell.appendChild(menu);
  _openScaleMenu = menu;
  (bounded ? minBox : curveBox).focus();
  (bounded ? minBox : curveBox).select();
}

/** An action's label as it reads TODAY: a palette row says what sits at its
 *  position (tiles.js `S._paletteRow`), everything else is its static label. */
function actionLabel(action) { return action ? (action.row?.()?.label ?? action.label) : ''; }
function _midiLabel(midiMap) {
  if (!midiMap) return '—';
  return midiMap.type === 'note'
    ? `Note ${midiMap.number}${midiMap.g && GESTURE_LABEL[midiMap.g] ? ' ' + GESTURE_LABEL[midiMap.g] : ''}`
    : `${midiMap.type.toUpperCase()} ${midiMap.number} · ch ${midiMap.channel}`;
}

function renderMappingTable() {
  const body = document.getElementById('mappingTableBody');
  if (!body) return;
  _closeScaleMenu();
  body.innerHTML = '';

  let curGroup = '';   // most recent section heading — folded into each row's filter text

  for (const action of ACTIONS) {
    // Skip legacy aliases — they still work for existing MIDI maps but don't show in UI
    if (action._legacy) continue;

    // ── Section heading ────────────────────────────────────────────────────
    if (!action.id) {
      curGroup = action.group || '';
      const head = _el('div', 'set-table-row set-table-row--group', action.group);
      head.dataset.groupHeader = '1';
      body.appendChild(head);
      continue;
    }

    // A palette row reads what is at its position today, and whether this
    // verb is live for that kind of tile (an empty position, a lens's toggle,
    // a pin's arm are listed and blank — blank means impossible, as below).
    const live  = action.row?.() ?? null;
    if (live?.hidden) continue;   // a verb this tile has not: no row at all
    const label = live?.label ?? action.label;
    const na    = live ? !live.enabled : false;
    const midiMap        = midiMappings[action.id];
    const keyMap         = keyMappings[action.id];
    const btnMap         = buttonMappings[action.id];
    const isMidiLearning = midiLearningId   === action.id;
    const isKeyLearning  = keyLearningId    === action.id;
    const isBtnLearning  = buttonLearningId === action.id;

    const row = _el('div', 'set-table-row');

    // A factory key another action has learned is not this row's binding: the
    // cell says so below, and the bound-only view agrees.
    const takenBy = !keyMap && action.key && action.key !== '—'
      ? Object.entries(keyMappings).find(([id, km]) => id !== action.id && km.type === 'key'
          && keyMappingLabel(km).toLowerCase() === action.key.toLowerCase()) : null;
    const factoryKeyLive = !!(action.key && action.key !== '—' && !takenBy);
    // A palette row is always shown, bound or not: the page is where the
    // performer designs the palette's bindings, so every verb of every
    // position is on it (Ek, 2026-09-11: "all tools should have a activate
    // (toggle) and activate (momentary)" — the bound-only view hid them).
    row.dataset.bound = (live || keyMap || btnMap || midiMap || factoryKeyLive
      || isMidiLearning || isKeyLearning || isBtnLearning) ? '1' : '0';

    // Everything the filter box searches — built from the same values the cells
    // below display, plus the group heading and the action id, so "grain",
    // "cc 74", "/trace" and "pitch_shift" all find their row. Unmapped rows
    // carry "unassigned": it is the only way to filter to what needs binding.
    if (na) row.classList.add('set-table-row--na');
    row.dataset.search = [
      label, curGroup, action.id,
      action.key && action.key !== '—' ? action.key : '',
      keyMap  ? keyMappingLabel(keyMap) : '',
      btnMap  ? `button ${buttonMappingLabel(btnMap)}` : '',
      midiMap ? `${midiMap.type} ${midiMap.number} ch${midiMap.channel}` : 'unassigned',
      isScaled(midiMap) ? 'scaled curved' : '',
      action.osc || '', action.fmt || '',
    ].join(' ').toLowerCase();

    // ── Action: the name, and under it the address and what it accepts ──────
    // Those were two columns. They are not independent facts about the action,
    // they describe it — so they are its sub-line.
    const nameCell = _el('div');
    const title = _el('span', 'set-row-title', live ? '' : label);
    if (live) {
      // Position · glyph · name · verb, as separate marks: the number says
      // WHERE, the glyph and name say WHAT, the verb says which of the tile's
      // own acts this row binds. The kind (brush, lens, eraser) is not said.
      // No position number (Ek, 2026-09-11, late): the rows come in the
      // palette's order, and the key cell says what fires the tile.
      title.classList.add('set-row-title--tile');
      if (live.glyph) {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        g.setAttribute('viewBox', '0 0 24 24'); g.setAttribute('fill', 'currentColor'); g.setAttribute('aria-hidden', 'true');
        g.classList.add('set-row-glyph'); if (live.hue) g.style.color = live.hue; g.innerHTML = live.glyph;
        title.appendChild(g);
      }
      title.appendChild(_el('span', 'set-row-name', live.name));
      if (live.verb) title.appendChild(_el('span', 'set-row-verb', live.verb));
    }
    if (na && live?.why) title.title = live.why; else if (action.tip) title.title = action.tip;
    nameCell.appendChild(title);
    // Address · what it accepts · what KIND of action it is. The third field
    // came from the OSC reference page's `osc-kind` column when that page was
    // folded into this one (round eleven): `int 0|1` alone cannot tell a hold
    // from a trigger, and eighteen rows share that format.
    // OSC facts only (Ek, 2026-09-09: "the extra stuff is all confusing. int
    // 0|1 sure, that makes sense for OSC"). Which VERSION of an action this is
    // — toggle or momentary — is in its title where there are two.
    const sub = [action.osc, action.fmt].filter(Boolean).join(' · ');
    if (sub) nameCell.appendChild(_el('span', 'set-table-sub', sub));
    row.appendChild(nameCell);

    // ── Key ────────────────────────────────────────────────────────────────
    const canKeyLearn = !na && (action.type === 'trigger' || action.type === 'hold' || action.type === 'toggle');
    const keyCell = _el('div', 'bind-cell');
    if (canKeyLearn) {
      // A factory key is a literal on the row, not a binding, so learning it
      // onto another action never removed it here — the table showed 3 on
      // tile 3 · arm AND on the play it was learned onto, while the digit had
      // already stood down at runtime (Ek, 2026-09-09: "3 is listed twice").
      // The cell says what the key DOES: a factory key another action has
      // learned reads as unbound, and the hover says who took it.
      // A stored `none` is a factory key the performer REMOVED (Ek,
      // 2026-09-11: "i should be able to right click even factory defaults
      // to remove them"): the cell reads unbound, and a right-click on it
      // puts the factory key back.
      const removed = keyMap?.type === 'none';
      const bound = keyMap ? keyMappingLabel(keyMap)
                  : (action.key && action.key !== '—' && !takenBy ? action.key : null);
      // 84px truncates a compound default like "right click / ⌘Z", so the
      // full binding is always in the hover text, not only the short ones.
      const kb = _bindBtn(bound || '—', {
        empty: !bound, learning: isKeyLearning,
        title: (bound ? bound + ' — ' : '')
             + (removed ? `factory key ${action.key} removed — right-click to put it back · click to learn a key`
               : keyMap ? 'click to relearn · right-click to clear the override'
                       : takenBy ? `its factory key ${action.key} is learned onto “${ACTIONS.find(a => a.id === takenBy[0])?.label}” — click to learn another`
                                 : 'click, then press · long-press · extra-long-press · double- or triple-tap a key, or scroll · ⇧-click to learn a tap (the up edge)'
                                   + (factoryKeyLive ? ' · right-click removes the factory key' : ''))
      });
      kb.addEventListener('click', e => {
        midiLearningId = null; buttonLearningId = null;   // cancel the other learns
        keyLearningId = (keyLearningId === action.id) ? null : action.id;
        _learnShortAs = e.shiftKey ? 'tap' : 'press';
        setMappingStatus(keyLearningId
          ? (e.shiftKey ? `Tap a key to assign “${label}” to its tap — the up edge…`
                        : `Press, long-press, extra-long-press, double- or triple-tap a key, or scroll, to assign “${label}”… (⇧-click the cell to learn a tap)`)
          : '');
        renderMappingTable();
      });
      kb.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (!keyMap) {
          // No override: a live factory key is REMOVED by storing `none`.
          if (!factoryKeyLive) return;
          keyMappings[action.id] = { type: 'none' };
        } else delete keyMappings[action.id];   // an override, or a removal, cleared
        saveKeyMappings();
        renderMappingTable();
      });
      keyCell.appendChild(kb);
    } else {
      // Blank. A dash means unbound; blank means impossible. This action can
      // never carry a key, so offering an empty slot would be a lie.
      //
      // There is no fourth "fixed default" state: every action in ACTIONS that
      // carries a `key` is trigger, hold or toggle, so a non-learnable action
      // with a default key does not exist. A state with no case in the table is
      // an invented one (round ten).
      keyCell.appendChild(_el('span', 'bind-blank'));
    }
    row.appendChild(keyCell);

    // ── Button — the instrument's three ─────────────────────────────────────
    // Same three states as the key cell, same rule: a dash is an empty slot,
    // blank means a button cannot do this (a cc has travel, a button has none).
    const btnCell = _el('div', 'bind-cell');
    if (canKeyLearn) {
      const bb = _bindBtn(btnMap ? buttonMappingLabel(btnMap) : '—', {
        empty: !btnMap, learning: isBtnLearning,
        title: btnMap ? 'click to relearn · right-click to clear'
             : 'click, then press · long-press · extra-long-press · double- or triple-tap a button on the instrument · ⇧-click to learn a tap (the up edge)'
      });
      bb.addEventListener('click', e => {
        keyLearningId = null; midiLearningId = null;
        const was = buttonLearningId;
        buttonLearningId = (was === action.id) ? null : action.id;
        _learnShortAs = e.shiftKey ? 'tap' : 'press';
        setMappingStatus(buttonLearningId
          ? (e.shiftKey ? `Tap a button on the instrument to assign “${action.label}” to its tap — the up edge…`
                        : `Press, long-press, extra-long-press, double- or triple-tap a button on the instrument to assign “${action.label}”… (⇧-click the cell to learn a tap, the up edge)`)
          : '');
        renderMappingTable();
      });
      bb.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (!btnMap) return;
        delete buttonMappings[action.id];
        saveButtonMappings();
        renderMappingTable();
      });
      btnCell.appendChild(bb);
    } else {
      btnCell.appendChild(_el('span', 'bind-blank'));
    }
    row.appendChild(btnCell);

    // ── MIDI ───────────────────────────────────────────────────────────────
    const midiCell = _el('div', 'bind-cell');
    if (na) { midiCell.appendChild(_el('span', 'bind-blank')); row.appendChild(midiCell); }
    else {
    const mb = _bindBtn(_midiLabel(midiMap), {
      empty: !midiMap, learning: isMidiLearning,
      title: midiMap ? 'click to relearn · right-click to clear' : 'click to learn a control'
    });
    mb.addEventListener('click', () => {
      keyLearningId = null; buttonLearningId = null;      // cancel the other learns
      midiLearningId = (midiLearningId === action.id) ? null : action.id;
      setMappingStatus(midiLearningId ? `Move a control, or press · long-press · double-tap a note, to assign “${label}”…` : '');
      if (midiLearningId && !midiAccess) initMidi().then(refreshMidiInputs);
      renderMappingTable();
    });
    mb.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (!midiMap) return;
      delete midiMappings[action.id];
      saveMidiMappings();
      renderMappingTable();
    });
    midiCell.appendChild(mb);
    row.appendChild(midiCell);
    }

    // ── Scale ──────────────────────────────────────────────────────────────
    const scaleCell = _el('div', 'bind-cell');
    if (!midiMap || !scaleEditable(action, midiMap)) {
      // Blank, both times, and for the same reason: with no MIDI binding there
      // is no travel to shape, and a bang has none either. Neither is an empty
      // slot waiting to be filled, so neither gets a dash. "n/a" was a third
      // word for the same fact.
      scaleCell.appendChild(_el('span', 'bind-blank'));
    } else {
      const sb = _bindBtn(_scaleLabel(action, midiMap), { title: 'min, max and γ for this binding' });
      sb.addEventListener('click', e => {
        e.stopPropagation();
        if (_openScaleMenu && scaleCell.contains(_openScaleMenu)) { _closeScaleMenu(); return; }
        _openScale(scaleCell, sb, action, midiMap, () => {
          // A shaped mapping looks identical to a raw one once you have stopped
          // reading the numbers — the label is what makes it findable.
          sb.textContent = _scaleLabel(action, midiMap);
        });
      });
      scaleCell.appendChild(sb);
    }
    row.appendChild(scaleCell);

    body.appendChild(row);
  }

  // Rows are rebuilt on every learn/clear — reapply the active query so the
  // list doesn't silently expand back to all ~100 rows underneath the user.
  _applyMappingFilter();
}

// ── Modal setup (called from init) ───────────────────────────────────────────

export function setupMappingModal() {
  loadMidiMappings();
  loadKeyMappings();
  loadButtonMappings();
  renumberPaletteOnce();
  collapsePaletteVerbsOnce();
  seedPaletteDigitsOnce();   // AFTER the two renumberings: they shift palette ids, and ran over the seed once (2026-09-12)
  loadButtonTiming();

  // Patch recency CC fn to also redraw the dial
  const recEntry = ACTIONS.find(a => a.id === 'recency_cc');
  if (recEntry) {
    const orig = recEntry.ccFn;
    recEntry.ccFn = v => { orig(v); S.drawRecencyDial?.(); };
  }

  document.getElementById('mappingClose')?.addEventListener('click', closeMappingModal);
  document.getElementById('mappingModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('mappingModal')) closeMappingModal();
  });
  // One button, one confirm. It used to prompt() for "keys", "midi" or
  // "both" — and Electron has no prompt(): the click threw "prompt() is not
  // supported" and cleared nothing (found 2026-09-09). Clear all is all:
  // key overrides, MIDI assignments, and the instrument's buttons back to
  // their factory plays. Right-click a cell to clear one.
  document.getElementById('keysClearAll')?.addEventListener('click', () => {
    if (!window.confirm('Clear all bindings?\n\nEvery key override and MIDI assignment goes; the instrument\'s buttons go back to the three plays. Right-click a cell to clear just one.')) return;
    // Cleared IN PLACE: events.js and tiles.js hold `S._keyMappings`, the
    // same object — a fresh `{}` here left them reading the old map, so the
    // factory digits stayed dead until a reload (found 2026-09-06).
    for (const k of Object.keys(keyMappings))  delete keyMappings[k];  saveKeyMappings();
    for (const k of Object.keys(midiMappings)) delete midiMappings[k]; saveMidiMappings();
    for (const k of Object.keys(buttonMappings)) delete buttonMappings[k];
    Object.assign(buttonMappings, BUTTON_DEFAULTS); saveButtonMappings();
    renderMappingTable();
    setMappingStatus('All key overrides and MIDI assignments cleared; the buttons are back to the factory set');
  });

  // ── Key learn: capture keydown while learning ────────────────────────────
  // Non-overridable keys that should not be captured
  // ' ' is the spacebar: the hand's, never a binding (tiles.js, 2026-09-12).
  const BLOCKED_KEYS = new Set(['Escape', 'Tab', 'F5', 'F11', 'F12', ' ']);

  document.addEventListener('keydown', e => {
    if ((buttonLearningId !== null || midiLearningId !== null) && e.key === 'Escape') {
      buttonLearningId = null; midiLearningId = null; setMappingStatus(''); renderMappingTable(); S._bindingsChanged?.();
      e.stopImmediatePropagation(); return;
    }
    if (keyLearningId === null) return;

    // Escape cancels learning (don't close modal)
    if (e.key === 'Escape') {
      keyLearningId = null;
      buttonLearningId = null;   // a button learn left armed on a closed page eats the next press
      setMappingStatus('');
      renderMappingTable();
      S._bindingsChanged?.();    // a legend row armed from the strip stands down
      e.stopImmediatePropagation();
      return;
    }

    if (e.key === ' ') {
      // Swallowed, not passed on: the hand must not play while a learn is up.
      e.preventDefault(); e.stopImmediatePropagation();
      setMappingStatus('the spacebar is the hand\'s — it plays the tool in hand and cannot be assigned. Press another key…');
      return;
    }
    // A PALETTE KEY IS A PLAIN KEY (Ek, 2026-09-12: chords refused for
    // palette positions): nine positions and ten digits do not need ⌘, ctrl
    // or ⇧, and a chord on a performance tile is a mis-binding — its sticker
    // would run two tiles wide (§ 11.6). The learn stays armed and says so.
    if (/^palette_[1-9]$/.test(keyLearningId) && (e.metaKey || e.ctrlKey || e.shiftKey) && !['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) {
      e.preventDefault(); e.stopImmediatePropagation();
      setMappingStatus('a palette key is a plain key — no ⌘, ctrl or ⇧. Press the key on its own…');
      return;
    }
    if (BLOCKED_KEYS.has(e.key) || ['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) return;
    // A HELD key auto-repeats, and each repeat is a fresh keydown with its
    // default action: holding the spacebar to learn a long press scrolled the
    // page a screen per repeat (Ek, 2026-09-12). The repeats are swallowed;
    // only the first down reaches the recogniser.
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;

    // The whole GESTURE is learned, as on a button (2026-09-11): this down
    // starts the recogniser on the key's source; the up (below), the long
    // timer or a second down decides press · tap · long · extra long · ×2 · ×3,
    // and _learnGesture writes the key WITH its gesture. A plain press learns
    // as press — what every key did before — unless the cell was ⇧-clicked
    // for a tap.
    _learnKeyEv = { key: e.key, code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey };
    _learnKeyDown = e.code;
    buttonLearningId = null;   // a button learn left armed on a closed page eats the next press
    dispatchGesture(keySourceOf(e), true);
  }, true);  // capture phase — runs before events.js handlers
  document.addEventListener('keyup', e => {
    if (_learnKeyDown === null || e.code !== _learnKeyDown) return;
    e.preventDefault(); e.stopImmediatePropagation();
    _learnKeyDown = null;
    if (_learnKeyEv) dispatchGesture(keySource(_learnKeyEv), false);
  }, true);

  // ── Key learn: capture scroll while learning ─────────────────────────────
  document.addEventListener('wheel', e => {
    if (keyLearningId === null) return;

    // Hold actions need a release event — scroll has no release, so block it
    const learningAction = ACTIONS.find(a => a.id === keyLearningId);
    if (learningAction?.type === 'hold') {
      setMappingStatus(`scroll can't be assigned to an on/off action — press a key instead`);
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const dir = e.deltaY > 0 ? 'scroll_down' : 'scroll_up';
    const newMapping = {
      type: dir,
      key: null, code: null, shift: false, ctrl: false, meta: false
    };

    removeConflictingKeyBinding(newMapping, keyLearningId);
    keyMappings[keyLearningId] = newMapping;
    saveKeyMappings();

    const action = ACTIONS.find(a => a.id === keyLearningId);
    setMappingStatus(`mapped "${action?.label}" → ${keyMappingLabel(newMapping)}`);
    keyLearningId = null;
    buttonLearningId = null;   // a button learn left armed on a closed page eats the next press
    renderMappingTable();
  }, { capture: true, passive: false });

  // ── Filter box ───────────────────────────────────────────────────────────
  // Registered after the key-learn listeners above on purpose: those capture
  // and stopImmediatePropagation, so cmd+F is assignable as a binding while
  // learning rather than being eaten by the focus shortcut.
  const filterEl = document.getElementById('mappingFilter');

  filterEl?.addEventListener('input', () => {
    _mapFilter = filterEl.value;
    _applyMappingFilter();
  });

  // WHICH KIND THE PALETTE SHOWS (§ 11.4): the segmented row above the table.
  // bindingsOf stays complete: the keys page, the delay rule and the audits
  // read every binding whether or not a tile draws it.
  _paintLegendKind();
  document.querySelectorAll('#legendKindSeg [data-legend-kind]').forEach(el => {
    el.addEventListener('click', () => S._setLegendKind(el.dataset.legendKind));
  });
  const showAllEl = document.getElementById('mappingShowAll');
  if (showAllEl) {
    showAllEl.checked = _mapShowAll;
    showAllEl.addEventListener('change', () => {
      _mapShowAll = showAllEl.checked;
      try { localStorage.setItem('mubone_keys_show_all', _mapShowAll ? '1' : '0'); } catch (_) {}
      _applyMappingFilter();
    });
  }

  // Escape clears a non-empty query, otherwise blurs — so the next Escape
  // reaches the modal instead of the field.
  filterEl?.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (filterEl.value) _setMappingFilter('');
    else filterEl.blur();
  });

  document.getElementById('mappingFilterClear')
    ?.addEventListener('click', () => _setMappingFilter('', { focus: true }));

  // cmd/ctrl+F focuses the filter while the modal is open.  Nothing in
  // events.js binds it (every 'f' shortcut requires !metaKey && !ctrlKey) and
  // the Electron build has no find bar to override, so there's nothing to lose.
  document.addEventListener('keydown', e => {
    if (e.key !== 'f' && e.key !== 'F') return;
    if (!e.metaKey && !e.ctrlKey) return;
    if (!_visible()) return;
    e.preventDefault();
    e.stopPropagation();
    filterEl?.focus();
    filterEl?.select();
  }, true);

  // ── Live monitor — shows every inbound MIDI + OSC message ────────────────
  // Listens always (cheap: push to ring buffer), but only touches the DOM when
  // the mapping modal is open and not paused.  This lets users verify that
  // OSC arrives at the app at all — invaluable for diagnosing "I'm sending
  // /trace 1 but nothing happens" situations (wrong address, wrong transport,
  // dropped args, etc.).
  setupIOMonitor();

  // Expose modal open/close via S so events.js and ui-presets.js can call them
  S.openMappingModal  = openMappingModal;
  S.closeMappingModal = closeMappingModal;

  // Expose key mappings and dispatch for events.js to intercept.
  // S._actions is the same registry any non-MIDI input source binds against
  // (accessory-registry.js is the first) — published here rather than imported
  // so those modules don't pull in midi.js and create a cycle.  Note
  // dispatchAction's 0–127 domain is not integer-only: a caller with finer
  // resolution than MIDI can pass a float and the ccFn `v / 127` stays smooth.
  S._keyMappings    = keyMappings;
  S._buttonMappings = buttonMappings;   // the same object, for the audits — a removed tile takes its buttons with it
  S._actions        = ACTIONS;
  S._dispatchAction = dispatchAction;
  S._dispatchButton = dispatchButton;   // the instrument's buttons, sygaldry.js
  // Keys through the same recogniser (events.js): the source a key event is,
  // whether anything is bound on it, and its edge.
  S._keySourceOf    = keySourceOf;
  S._sourceBound    = src => _bindingsOnSource(src).size > 0;
  S._dispatchGesture = dispatchGesture;
  S._handleMidiMessage = handleMidiMessage;   // the audits' way in for a note
  S._buttonBindings = () => Object.entries(buttonMappings).map(([id, bm]) => ({ id, ...bm, label: actionLabel(ACTIONS.find(a => a.id === id)) || id }));
  S._buttonTiming   = { get: () => ({ ...buttonTiming }), set: setButtonTiming, defaults: { ...BUTTON_TIMING_DEFAULT } };
  S._bindingsOf     = bindingsOf;                    // the palette's legend reads these two
  S._gestureLabel   = g => GESTURE_LABEL[g] ?? '';
  // Continuous radius setter for the canvas wheel (2026-08-28): the
  // radius_inc/dec actions step by SEARCH_RADIUS_STEP (2°), which is right
  // for a key or a pedal and wrong for a trackpad — the radius visibly
  // quantised. Same clamp, same UI sync as the actions; tenth-degree
  // resolution so the readout stays legible.
  S._setSearchRadius = (deg) => {
    const v = Math.max(SEARCH_RADIUS_MIN, Math.min(SEARCH_RADIUS_MAX, deg));
    S.searchRadiusDeg = Math.round(v * 10) / 10;
    updatePlaybackControls(); flashRadiusTooltip();
  };
  S._isKeyLearning  = () => keyLearningId !== null;

}
