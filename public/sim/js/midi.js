// ============================================================================
// MIDI + KEYBOARD MAPPING SYSTEM
// ============================================================================

import {
  S,
  PRESETS, isUserPreset, SEARCH_RADIUS_MIN, SEARCH_RADIUS_MAX, SEARCH_RADIUS_STEP,
  LIVE_PAINT_COLORS, DEBUG, rebuildGrainCurves,
} from './state.js';
import { ensureAudioContext } from './audio.js';
import { toggleMappingByIndex } from './sensor-mapping.js';
import { startLiveRecording, stopLiveRecording } from './audio.js';
import { toggleHandsfree } from './handsfree.js';
import {
  recordStrokeStart, undoLastStroke,
} from './ui-samples.js';
import {
  toggleNearestMode, plantSeed, startSeedPlant, finalizeSeedPlant, uprootNearestSeed,
  clearAllSeeds, clearAllCommits, clearAllSeqs,
  updatePlaybackControls, flashRadiusTooltip, selectPreset,
  createSeqFromStroke, dropSeqFromCursor, releaseCommit,
} from './ui-presets.js';
import { sweep } from './ui-sweep.js';
import { startEraseStroke, stopEraseStroke } from './erase.js';
import { setMixdownCursorGain, setMixdownHouseGain } from './ui-meters.js';
import { wireSaveDefaultBtn } from './ui-audio-settings.js';
import { setScanMuted } from './ui-meters.js';
import { findNearestSeedSlot } from './grain.js';
import { getCursorLonLat, screenToLonLat } from './sphere.js';
import { fmtRange } from './scale.js';

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
// Placeholder spliced out below — lets the patch rows keep their position in
// the ordered ACTIONS list without hand-writing twenty near-identical entries.
const _PATCH_ACTIONS_MARKER = Object.freeze({ _patchMarker: true });

const ACTIONS = [

  // ── Session ────────────────────────────────────────────────────────────────
  { id: null, group: 'session' },
  { id: 'mute',         label: 'system mute (toggle)',      key: 'M',                 osc: '/mute',              fmt: 'int 0|1',          type: 'trigger',
    tip: 'silence all audio output — latching' },
  { id: 'mute_hold',    label: 'system mute (hold)',        key: '—',                 osc: '/mute/hold',         fmt: 'int 0|1',          type: 'hold',
    tip: 'momentary mute — silent while held, restores the PREVIOUS state on release, so a tap over an already-muted system leaves it muted' },
  { id: 'undo',         label: 'undo last stroke',          key: 'right click / ⌘Z',  osc: '/undo',              fmt: 'bang',             type: 'trigger',
    tip: 'remove the most recently painted stroke from the sphere' },
  { id: 'sweep',        label: 'sweep (remove unused)',     key: '—',                 osc: '/sweep',             fmt: 'bang',             type: 'trigger',
    tip: 'delete all particles not referenced by active seeds or loops' },
  { id: 'erase_all',    label: 'erase all (session)',       key: 'Backspace×3',       osc: '/session/erase',     fmt: 'bang',             type: 'trigger',
    tip: 'erase everything — all particles, commits, and recordings' },
  { id: 'erase_toggle', label: 'erase brush (toggle)',      key: '—',                 osc: '/erase/toggle',      fmt: 'bang',             type: 'trigger',
    tip: 'latching erase — one press starts erasing, the next stops. For controllers that only send a press edge (foot pedals), where the hold version would never release' },
  { id: 'erase_brush',  label: 'erase brush (hold)',        key: 'hold F',            osc: '/erase/hold',        fmt: 'int 0|1',          type: 'hold',
    tip: 'hold to erase particles under the cursor — same radius + recency as the scan, so erasing reveals older buffers' },

  // ── Patches ────────────────────────────────────────────────────────────────
  // One row per patch, generated below from PRESETS — see _buildPatchActions().
  // This used to be a single `patch select` cc row spanning the whole bank,
  // which is the wrong shape for the thing people actually do with it: bind a
  // button, or a pad, to one patch. A cc sweep can't express that at all.
  { id: null, group: 'patches' },
  _PATCH_ACTIONS_MARKER,

  // ── Search ─────────────────────────────────────────────────────────────────
  { id: null, group: 'search' },
  { id: 'snap',         label: 'scope (nearest/area)',       key: 'N',                 osc: '/search/scope',   fmt: 'int 0|1',          type: 'trigger',
    tip: 'scope — nearest: fire k closest on whole sphere / area: search within radius + recency' },
  { id: 'k_all',        label: 'fill (all/k)',              key: '—',                 osc: '/search/fill',    fmt: 'int 0|1',          type: 'trigger',
    tip: 'fill — all: fire every particle in radius / k: cap to k nearest (area mode only)' },
  { id: 'k_seq',        label: 'order (step/random)',       key: '—',                 osc: '/search/order',   fmt: 'int 0|1',          type: 'trigger',
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
  { id: 'grain_k',      label: 'k (nearest)',               key: '—',                 osc: '/search/k',       type: 'cc',
    range: { min: 1, maxFn: () => Math.max(1, S.particles.length), max: 1, int: true },
    ccFn: v => { const mx = Math.max(1, S.particles.length); S.grainOverrides.k = Math.max(1, Math.round(1 + (v / 127) * (mx - 1))); S.syncGrainControlsUI?.(); } },
  // 0 = "all" is a sentinel sitting ABOVE 16, not part of the numeric range, so
  // it stays out of `range` — a scaled pot spans 1–16 and can't reach it. Bind
  // a button to it if you want "all" on a controller.
  { id: 'recency_cc',   label: 'recency',                   key: '—',                 osc: '/search/recency', type: 'cc',
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
  { id: 'grain_vol',    label: 'volume',                    key: '—',  osc: '/grain/volume',      type: 'cc',
    tip: 'grain volume — 1.0 = unity/input parity, max 2.0',
    range: { min: 0, max: 2 },
    ccFn: v => { S.grainOverrides.volume = (v / 127) * 2; rebuildGrainCurves(); S.syncGrainControlsUI?.(); } },
  { id: 'grain_dir',    label: 'direction',                 key: '—',  osc: '/grain/dir',         fmt: 'bang=cycle, str=set (fwd|rev|rnd)',              type: 'trigger',
    tip: 'grain playback direction — cycles fwd → rev → rnd' },
  { id: 'grain_curve',  label: 'envelope curve',            key: '—',  osc: '/grain/curve',       fmt: 'bang=cycle, str=set (hann|tri|rect)',              type: 'trigger',
    tip: 'grain envelope shape — cycles hann → triangle → rectangular' },
  { id: 'grain_retrig', label: 'retrigger (ms)',            key: '—',  osc: '/grain/retrigger',   type: 'cc',
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
  { id: 'grain_filterq', label: 'filter Q',                 key: '—',  osc: '/grain/filterq',     type: 'cc',
    tip: 'filter resonance — 0.707 = flat (Butterworth), higher = resonant peak',
    range: { min: 0.1, max: 20 },
    ccFn: v => { S.grainOverrides.filterQ = 0.1 + (v / 127) * 19.9; S.syncGrainControlsUI?.(); } },
  { id: 'grain_fltjit',  label: 'filter jitter',            key: '—',  osc: '/grain/filterjitter', type: 'cc',
    tip: 'per-grain cutoff randomisation — 0% = static, 100% = ±1 octave',
    range: { min: 0, max: 1 },
    ccFn: v => { S.grainOverrides.filterFreqJitter = v / 127; S.syncGrainControlsUI?.(); } },

  // ── Cursor / Scan (S) ─────────────────────────────────────────────────────
  { id: null, group: 'cursor' },
  { id: 'scan_toggle',  label: 'scan on/off (S)',            key: 'S',                 osc: '/cursor/scan',       fmt: 'int 0|1',          type: 'trigger',
    tip: 'toggle scan — cursor spotlight on/off in the house output' },
  { id: 'tare',         label: 'tare / zero (Z)',            key: '`',                 osc: '/cursor/tare',       fmt: 'bang',             type: 'trigger',
    tip: 'zero the cursor sensor — set current orientation as center reference' },
  { id: 'lock_az',      label: 'lock azimuth (toggle)',      key: '—',                 osc: '/cursor/lock_az',    fmt: 'int 0|1',          type: 'toggle',
    tip: 'toggle azimuth lock — freezes horizontal position' },
  { id: 'lock_el',      label: 'lock elevation (toggle)',    key: '—',                 osc: '/cursor/lock_el',    fmt: 'int 0|1',          type: 'toggle',
    tip: 'toggle elevation lock — freezes vertical position' },
  { id: 'mapping_toggle_1', label: 'toggle mapping 1',       key: '—',                 osc: '/mapping/toggle/1',  fmt: 'bang',             type: 'trigger',
    tip: 'toggle the first sensor-to-param mapping on/off' },
  { id: 'mapping_toggle_2', label: 'toggle mapping 2',       key: '—',                 osc: '/mapping/toggle/2',  fmt: 'bang',             type: 'trigger',
    tip: 'toggle the second sensor-to-param mapping on/off' },
  { id: 'mapping_toggle_3', label: 'toggle mapping 3',       key: '—',                 osc: '/mapping/toggle/3',  fmt: 'bang',             type: 'trigger',
    tip: 'toggle the third sensor-to-param mapping on/off' },
  { id: 'mapping_toggle_4', label: 'toggle mapping 4',       key: '—',                 osc: '/mapping/toggle/4',  fmt: 'bang',             type: 'trigger',
    tip: 'toggle the fourth sensor-to-param mapping on/off' },
  { id: 'radius_fade',  label: 'radius fade on/off',        key: '—',                 osc: '/cursor/radiusfade', fmt: 'int 0|1',          type: 'trigger',
    tip: 'attenuate grains by distance from cursor centre' },
  { id: 'radius_fade_curve', label: 'radius fade curve',    key: '—',                 osc: '/cursor/radiusfadecurve', type: 'cc',
    tip: '0 = gentle linear fade, 1 = steep sharp edge rolloff',
    range: { min: 0, max: 1 },
    ccFn: v => { S.radiusFadeCurve = v / 127; S._syncRadiusFadeUI?.(); } },

  // ── Trace (A) ─────────────────────────────────────────────────────────────
  { id: null, group: 'trace (A)' },
  { id: 'recpaint',     label: 'trace (hold/tap)',           key: 'click / space',     osc: '/trace',             fmt: 'int 0|1',          type: 'hold',
    tip: 'hold = momentary record, tap = toggle on/off (handsfree segments when armed)' },
  { id: 'trace_toggle', label: 'trace toggle',               key: '—',                 osc: '/trace/toggle',    fmt: 'bang',             type: 'trigger',
    tip: 'directly toggle trace on/off (no tap timing — ideal for foot pedals)' },
  { id: 'handsfree',   label: 'handsfree arm (H)',          key: 'H',                 osc: '/handsfree',         fmt: 'bang',             type: 'trigger',
    tip: 'toggle handsfree arm — when on, toggle-trace segments buffers by noise gate' },
  { id: 'trace_mode',   label: 'trace mode cycle (A)',      key: 'A',                 osc: '/trace/mode',      fmt: 'bang=cycle, str=set (trace|trace+loop|trace+cloud)',                             type: 'trigger',
    tip: 'cycle trace mode: trace → trace+loop → trace+cloud' },

  // ── Commit (D) ────────────────────────────────────────────────────────────
  { id: null, group: 'commit (D)' },
  { id: 'commit_mode',  label: 'commit mode cycle (⇧D)',    key: 'Shift+D',           osc: '/commit/mode',     fmt: 'bang=cycle, str=set (cloud|loop)',             type: 'trigger',
    tip: 'cycle commit mode: cloud ↔ loop — what D key creates' },
  { id: 'commit_drop',  label: 'drop commit (tap D)',       key: 'D',                 osc: '/commit/drop',     fmt: 'bang',             type: 'trigger',
    tip: 'drop a stationary cloud or loop at the current cursor position' },
  { id: 'commit_draw',  label: 'draw commit (hold D)',      key: 'hold D',            osc: '/commit/draw',     fmt: 'int 0|1',          type: 'hold',
    tip: 'hold to draw a moving cloud path or record a loop — release to finalize' },
  { id: 'commit_release', label: 'release nearest (⌘D)',    key: '⌘D',               osc: '/commit/release',  fmt: 'bang',             type: 'trigger',
    tip: 'release the nearest commit (cloud or loop) from its slot' },
  { id: 'commit_clear', label: 'clear all commits',         key: '—',                 osc: '/commit/clear',    fmt: 'bang',             type: 'trigger',
    tip: 'remove all clouds and loops from all slots' },
  { id: 'commit_selection', label: 'selection mode (toggle)', key: '—',               osc: '/commit/selection', fmt: 'bang=toggle, str=set (closest|farthest)',                 type: 'trigger',
    tip: 'toggle which commit is targeted for release and morph — closest or farthest from cursor' },
  { id: 'commit_slots', label: 'commit slot count',         key: '—',                 osc: '/commit/slots',    type: 'cc',
    tip: 'number of active commit slots (1–16)',
    range: { min: 1, max: 16, int: true },
    ccFn: v => {
      S.commitSlotCount = Math.max(1, Math.min(16, Math.round(1 + v * 15 / 127)));
      S._syncCommitSlotCount?.();    // syncs slider + numbox
      (S.updateSeedBanksUI || S._syncCommitUI || (() => {}))();
    } },
  { id: 'commit_overflow', label: 'commit overflow (cycle)', key: '—',                osc: '/commit/overflow', fmt: 'bang=cycle, str=set (off|oldest|nearest)',                   type: 'trigger',
    tip: 'cycle overflow mode: off → oldest → nearest' },
  { id: 'commit_dir',   label: 'commit movement dir',       key: '—',                 osc: '/commit/dir',      fmt: 'bang=cycle, str=set (pingpong|forward|rev)',                 type: 'trigger',
    tip: 'how moving commits traverse their path — cycles fwd → rev → pingpong' },
  { id: 'commit_volume', label: 'next commit volume',       key: '—',                 osc: '/commit/volume',   type: 'cc',
    tip: 'volume for the next commit — set before recording',
    range: { min: 0, max: 1 },
    ccFn: v => { S.seqNextParams.volume = v / 127; const sl = document.getElementById('seqVolumeSlider'); if (sl) sl.value = S.seqNextParams.volume; const nb = document.getElementById('seqVolumeNum'); if (nb) nb.value = Math.round(S.seqNextParams.volume * 100) + '%'; } },
  { id: 'commit_speed', label: 'next commit speed',         key: '—',                 osc: '/commit/speed',    type: 'cc',
    tip: 'speed for the next commit — 1× = original, set before recording',
    range: { min: 0.25, max: 4, unit: '×' },
    ccFn: v => { S.seqNextParams.speed = 0.25 + (v / 127) * 3.75; const sl = document.getElementById('seqSpeedSlider'); if (sl) sl.value = S.seqNextParams.speed; const nb = document.getElementById('seqSpeedNum'); if (nb) nb.value = S.seqNextParams.speed.toFixed(2) + '×'; } },
  { id: 'commit_attack', label: 'cloud fade in',             key: '—',                 osc: '/commit/attack',   type: 'cc',
    tip: 'cloud fade-in time — 0s instant, up to 10s swell',
    range: { min: 0, max: 10, unit: 's' },
    ccFn: v => { S.seedAttack = (v / 127) * 10; const sl = document.getElementById('seedAttackSlider'); if (sl) sl.value = S.seedAttack; const nb = document.getElementById('seedAttackNum'); if (nb) nb.value = S.seedAttack < 1 ? (S.seedAttack * 1000).toFixed(0) + 'ms' : S.seedAttack.toFixed(1) + 's'; } },
  { id: 'commit_release_time', label: 'cloud fade out',     key: '—',               osc: '/commit/release_time', type: 'cc',
    tip: 'cloud fade-out time — 0s instant, up to 10s fade',
    range: { min: 0, max: 10, unit: 's' },
    ccFn: v => { S.seedRelease = (v / 127) * 10; const sl = document.getElementById('seedReleaseSlider'); if (sl) sl.value = S.seedRelease; const nb = document.getElementById('seedReleaseNum'); if (nb) nb.value = S.seedRelease < 1 ? (S.seedRelease * 1000).toFixed(0) + 'ms' : S.seedRelease.toFixed(1) + 's'; } },
  { id: 'loop_release_mode', label: 'loop fade out mode',   key: '—',                 osc: '/commit/loop_release', fmt: 'bang=toggle, str=set (fade|play-to-end)',                 type: 'trigger',
    tip: 'fade = fade out over time, play-to-end = loop finishes current pass then stops' },
  { id: 'loop_fade_time', label: 'loop fade out time',    key: '—',                 osc: '/commit/loop_fade_time', type: 'cc',
    tip: 'fade-out duration for loops when released — 0ms instant, up to 2000ms',
    range: { min: 0, max: 2000, unit: 'ms', int: true },
    ccFn: v => { S.loopFadeTimeMs = Math.round((v / 127) * 2000); const sl = document.getElementById('loopFadeTimeSlider'); if (sl) sl.value = S.loopFadeTimeMs; const nb = document.getElementById('loopFadeTimeNum'); if (nb) nb.value = S.loopFadeTimeMs < 1000 ? S.loopFadeTimeMs + 'ms' : (S.loopFadeTimeMs / 1000).toFixed(1) + 's'; } },
  { id: 'commit_blend', label: 'commit blend mode',         key: '—',                 osc: '/commit/blend',    fmt: 'bang=toggle, str=set (focus|all)',             type: 'trigger',
    tip: 'all = equal weight, focus = distance-weighted blend toward closest' },
  { id: 'commit_tether', label: 'commit tether',            key: '—',                 osc: '/commit/tether',   fmt: 'int 0|1',          type: 'trigger',
    tip: 'on = commit always plays regardless of cursor distance, off = radius-gated' },
  { id: 'commit_xfade', label: 'commit xfade',              key: '—',                 osc: '/commit/xfade',    type: 'cc',
    tip: '0 = hard snap to nearest commit, 1 = smooth distance-weighted crossfade',
    range: { min: 0, max: 1 },
    ccFn: v => { S.seedXfade = v / 127; S._syncImprovUI?.(); } },

  // ── Cloud Morph ─────────────────────────────────────────────────────────────
  { id: null, group: 'cloud morph' },
  { id: 'morph_cc',        label: 'morph position',            key: '—',                 osc: '/morph/position', type: 'cc',
    tip: 'cloud morph slider — 0 = left preset, 0.5 = planted center, 1 = right preset',
    range: { min: 0, max: 1 },
    ccFn: v => { S._setDesktopMorphT?.(v / 127); } },
  { id: 'morph_sticky',    label: 'morph hold (toggle)',       key: '—',                 osc: '/morph/sticky',   fmt: 'bang',             type: 'trigger',
    tip: 'toggle morph hold — sticky keeps position, return glides back to center' },
  { id: 'morph_return',    label: 'morph return time',         key: '—',                 osc: '/morph/return',   type: 'cc',
    tip: 'return-to-center glide time when hold is off',
    range: { min: 50, max: 3000, unit: 'ms' },
    ccFn: v => { S._setDesktopMorphReturnMs?.(50 + (v / 127) * 2950); } },
  { id: 'radial_morph',    label: 'gesture morph (X)',         key: 'X',                 osc: '/morph/radial',   fmt: 'int 0|1',          type: 'trigger',
    tip: 'toggle gesture-joystick morph between pinned presets' },

  // ── Levels ─────────────────────────────────────────────────────────────────
  { id: null, group: 'levels' },
  // dB is already a log scale — the ccFn is linear IN dB, so curve stays 'lin'.
  { id: 'master_vol',   label: 'master volume',             key: '—',                 osc: '/master/volume',  type: 'cc',
    tip: 'master output gain — the master vol slider in audio settings (-60 to +6 dB)',
    range: { min: -60, max: 6, unit: 'dB' },
    ccFn: v => { S._setOutputGainDb?.(-60 + (v / 127) * 66); } },
  { id: 'mixdown_cursor', label: 'headphone cursor level',  key: '—',                 osc: '/mixdown/cursor', type: 'cc',
    tip: 'cursor grain level in the headphone stereo mix',
    range: { min: 0, max: 1 },
    ccFn: v => { setMixdownCursorGain(v / 127); } },
  { id: 'mixdown_house', label: 'headphone house level',    key: '—',                 osc: '/mixdown/house',  type: 'cc',
    tip: 'house speaker fold-down level in the headphone stereo mix',
    range: { min: 0, max: 1 },
    ccFn: v => { setMixdownHouseGain(v / 127); } },
  { id: 'noise_gate',   label: 'noise gate threshold',      key: '—',                 osc: '/gate/threshold', type: 'cc',
    tip: 'noise gate threshold — signal below this RMS level is gated',
    range: { min: 0, max: 0.06, unit: 'RMS' },
    ccFn: v => { S._setNoiseGateThreshold?.(v / 127 * 0.06); } },
  { id: 'dry_gain',    label: 'dry monitor gain',           key: '—',                 osc: '/dry/gain',       type: 'cc',
    tip: 'spatialized live input level in the house mix (0 = silent, 2 = +6dB)',
    range: { min: 0, max: 2 },
    ccFn: v => { S._setDryMonitorGain?.(v / 127 * 2); } },

  // ── Spatial ────────────────────────────────────────────────────────────────
  { id: null, group: 'spatial' },
  { id: 'camera_mode',     label: 'camera mode (cycle)',        key: '—',                 osc: '/camera/mode',      fmt: 'bang=cycle, str=set (pull|surface|sensor)',              type: 'trigger',
    tip: 'pull = mouse drag, surface = pointer lock, sensor = IMU input' },
  { id: 'spatial_panning',  label: 'spatial panning (toggle)',   key: '—',                 osc: '/spatial/panning',  fmt: 'bang=toggle, str=set (headlocked|worldlocked)',              type: 'trigger',
    tip: 'headlocked = stereo follows head, worldlocked = stereo follows sphere position' },
  { id: 'alt_lock',         label: 'freeze sphere (hold)',       key: 'Alt / Opt',         osc: '/spatial/lock',     fmt: 'int 0|1',           type: 'hold',
    tip: 'hold to freeze sphere rotation — cursor stays in place while camera stops' },

  // ── Paint ──────────────────────────────────────────────────────────────────
  { id: null, group: 'paint samples' },
  { id: 'paint1',       label: 'paint sample 1 (hold)',     key: 'Q',                 osc: '/paint/1',        fmt: 'int 0|1',          type: 'hold' },
  { id: 'paint2',       label: 'paint sample 2 (hold)',     key: 'W',                 osc: '/paint/2',        fmt: 'int 0|1',          type: 'hold' },
  { id: 'paint3',       label: 'paint sample 3 (hold)',     key: 'E',                 osc: '/paint/3',        fmt: 'int 0|1',          type: 'hold' },
  { id: 'paint4',       label: 'paint sample 4 (hold)',     key: 'R',                 osc: '/paint/4',        fmt: 'int 0|1',          type: 'hold' },
  { id: 'paint5',       label: 'paint sample 5 (hold)',     key: 'T',                 osc: '/paint/5',        fmt: 'int 0|1',          type: 'hold' },
  { id: 'paint6',       label: 'paint sample 6 (hold)',     key: 'Y',                 osc: '/paint/6',        fmt: 'int 0|1',          type: 'hold' },
  { id: 'paint7',       label: 'paint sample 7 (hold)',     key: 'U',                 osc: '/paint/7',        fmt: 'int 0|1',          type: 'hold' },
  { id: 'paint8',       label: 'paint sample 8 (hold)',     key: 'I',                 osc: '/paint/8',        fmt: 'int 0|1',          type: 'hold' },
  { id: 'paint9',       label: 'paint sample 9 (hold)',     key: 'O',                 osc: '/paint/9',        fmt: 'int 0|1',          type: 'hold' },
  { id: 'paint10',      label: 'paint sample 10 (hold)',    key: 'P',                 osc: '/paint/10',       fmt: 'int 0|1',          type: 'hold' },

  // ── App ────────────────────────────────────────────────────────────────────
  { id: null, group: 'app' },
  { id: 'perf',         label: 'perf monitor',              key: 'p',                  osc: '/app/perf',       fmt: 'int 0|1',          type: 'trigger' },
  { id: 'perfmode',     label: 'high-perf render',          key: 'Shift+P',            osc: '/app/perfmode',   fmt: 'int 0|1',          type: 'trigger' },
  { id: 'darkmode',     label: 'dark / light mode',         key: '—',                  osc: '/app/darkmode',   fmt: 'int 0|1',          type: 'trigger',
    tip: 'toggle dark mode (black background) and light mode (white background)' },
  { id: 'projector',    label: 'projector mode',            key: 'Shift+F',            osc: '/app/projector',  fmt: 'bang',             type: 'trigger',
    tip: 'toggle the projector output window' },
];

// ── Per-patch actions ───────────────────────────────────────────────────────
// One trigger per patch, so each can be bound to its own button, pad or note.
// Generated from PRESETS rather than written out: the bank size is a constant in
// state.js, and twenty hand-written entries would be twenty chances to drift
// from it.
//
// The keyboard column mirrors what events.js already does — digits 1–0 for the
// first ten, shift+digit for the next ten — so the modal documents the real key
// map instead of a second, hand-maintained copy of it. Past twenty patches
// there are no digits left, and the key column says so.
const _DIGIT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

function _buildPatchActions() {
  return PRESETS.map((_, i) => {
    const n = i + 1;
    const digit = _DIGIT_KEYS[i % 10];
    const a = {
      id:   `preset_${n}`,
      key:  i < 10 ? digit : (i < 20 ? `⇧${digit}` : '—'),
      osc:  `/preset/${n}`,
      fmt:  'bang',
      type: 'trigger',
    };
    // label and tip are getters, not strings: renaming a user slot in the patch
    // table has to show up here without a reload, and the modal reads .label.
    Object.defineProperty(a, 'label', {
      enumerable: true,
      get: () => `${n}  ${PRESETS[i]?.name ?? ''}`,
    });
    Object.defineProperty(a, 'tip', {
      enumerable: true,
      get: () => isUserPreset(i)
        ? `user patch ${n} — an empty slot changes nothing, every parameter passes through`
        : `factory patch ${n} — read-only`,
    });
    return a;
  });
}

{
  const at = ACTIONS.indexOf(_PATCH_ACTIONS_MARKER);
  if (at === -1) console.warn('[midi] patch-action marker missing — no per-patch rows');
  else ACTIONS.splice(at, 1, ..._buildPatchActions());
}

// Derive the format column for every cc action from its range, so the modal and
// the accessory's unit maths can't disagree. Non-cc actions keep their literal
// fmt — 'bang' and 'bang=cycle, str=set (…)' describe a payload shape, not a
// numeric span, and there's nothing to derive them from.
for (const a of ACTIONS) {
  if (a.type === 'cc' && a.range) a.fmt = fmtRange(a.range);
}

// MIDI mappings: { actionId → { type: 'cc'|'note', channel, number } }
let midiMappings = {};
let midiLearningId = null;
let midiAccess = null;

// Key/scroll mappings: { actionId → { key, code, shift, ctrl, meta, type } }
// type: 'key' | 'scroll_up' | 'scroll_down'
let keyMappings = {};
let keyLearningId = null;

function loadKeyMappings() {
  try {
    const saved = localStorage.getItem('mubone_key_map');
    if (saved) keyMappings = JSON.parse(saved);
  } catch(e) { keyMappings = {}; }
}

function saveKeyMappings() {
  try { localStorage.setItem('mubone_key_map', JSON.stringify(keyMappings)); } catch(e) {}
}

// Returns a human-readable label for a key mapping
function keyMappingLabel(km) {
  if (!km) return '';
  if (km.type === 'scroll_up')   return 'scroll ↑';
  if (km.type === 'scroll_down') return 'scroll ↓';
  const parts = [];
  if (km.meta)  parts.push('⌘');
  if (km.ctrl)  parts.push('ctrl');
  if (km.shift) parts.push('shift');
  parts.push(km.key || km.code);
  return parts.join('+');
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
  } catch(e) { midiMappings = {}; }
}

function saveMidiMappings() {
  try { localStorage.setItem('mubone_midi_map', JSON.stringify(midiMappings)); } catch(e) {}
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
  const btn = document.getElementById('midiInputToggle');
  if (btn) {
    btn.textContent = midiInputEnabled ? 'midi: on' : 'midi: off';
    btn.classList.toggle('active', midiInputEnabled);
  }
  const portEl = document.getElementById('midiPortName');
  if (portEl && !midiInputEnabled) portEl.textContent = 'off';
}

export async function initMidi() {
  if (!navigator.requestMIDIAccess) return;

  const toggleBtn = document.getElementById('midiInputToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      midiInputEnabled = !midiInputEnabled;
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
    ? (inputs.length ? inputs.map(i => i.name).join(', ') : '—')
    : 'off';
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
      detail: { status, num, val, type, channel, ts: performance.now() },
    }));
  } catch (_) {}

  if (midiLearningId !== null) {
    const mapType = (type === 11) ? 'cc' : 'note';
    midiMappings[midiLearningId] = { type: mapType, channel, number: num };
    saveMidiMappings();
    const action = ACTIONS.find(a => a.id === midiLearningId);
    setMappingStatus(`mapped "${action?.label}" → ${mapType.toUpperCase()} ${num} ch${channel}`);
    midiLearningId = null;
    renderMappingTable();
    return;
  }

  for (const action of ACTIONS) {
    if (!action.id) continue;  // skip group headers
    const mapping = midiMappings[action.id];
    if (!mapping) continue;
    const matchCC   = mapping.type === 'cc'   && type === 11 && mapping.number === num && mapping.channel === channel;
    const matchNote = mapping.type === 'note' && type === 9  && mapping.number === num && mapping.channel === channel && val > 0;
    // Note-off for hold actions: status type 8 (noteOff) or type 9 with vel 0
    const matchNoteOff = mapping.type === 'note' && mapping.number === num && mapping.channel === channel &&
      ((type === 8) || (type === 9 && val === 0));
    // For trigger-type actions mapped to CC, only fire on press (val > 0), not release
    if (matchCC && action.type === 'trigger' && val === 0) continue;
    if (matchCC || matchNote) {
      dispatchAction(action.id, matchCC ? val : 127);
    } else if (matchNoteOff && action.type === 'hold') {
      dispatchAction(action.id, 0);
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
// `/camera/mode sensor`, `/trace/mode trace+loop`) so external controllers
// can set a specific mode without cycling. Normalizes case/aliases; returns
// the canonical mode or null (→ fall back to cycling).
function _strMode(midiVal, modes, aliases = {}) {
  if (typeof midiVal !== 'string' || !midiVal) return null;
  const v = midiVal.trim().toLowerCase();
  const c = aliases[v] ?? v;
  return modes.includes(c) ? c : null;
}

function dispatchAction(id, midiVal) {
  // Patch triggers are generated, so they're matched by prefix rather than
  // twenty switch cases. Press edge only — a patch change on note-off would
  // fire twice per pad hit.
  if (id.startsWith('preset_')) {
    const n = parseInt(id.slice(7), 10);
    if (Number.isFinite(n) && n >= 1 && n <= PRESETS.length && midiVal > 0) selectPreset(n - 1);
    return;
  }
  switch(id) {
    case 'recpaint': {
      // Tap-toggle vs hold-momentary: same logic as spacebar/click.
      // val > 0 = press, val === 0 = release.
      if (midiVal > 0) {
        // If already toggled on, this is a tap-off — use canonical cleanup
        if (S._traceToggled) {
          S._stopToggleTrace?.();
        } else if (!S.isPainting) {
          // Press: start painting
          S._traceActive = true;
          S._midiTraceDownAt = performance.now();
          ensureAudioContext(); startLiveRecording();
          recordStrokeStart('live', S.currentLiveBufferIdx);
          S.isPainting = true; S.paintFrameCount = 0;
          S.updateLiveRecUI?.();
        }
      } else if (midiVal === 0) {
        // Release — if toggled, no-op
        if (S._traceToggled) break;
        // Tap detection
        const tapMs = performance.now() - (S._midiTraceDownAt || 0);
        // Only allow toggle in plain trace mode (not trace+loop or trace+cloud)
        if (S._midiTraceDownAt && tapMs < 200 && S.traceMode === 'trace') {
          S._traceToggled = true;
          if (S.hfArmed) {
            S.isPainting = false; S.currentStrokeId = -1;
            if (S.isRecording) stopLiveRecording();
          }
          S.updateLiveRecUI?.(); S._syncHandsfreeUI?.();
          S._midiTraceDownAt = 0;
          break;
        }
        S._midiTraceDownAt = 0;
        // Momentary release: stop painting
        if (S.isPainting) {
          if (S.seqModeEnabled && S.currentStrokeId > 0) {
            try { createSeqFromStroke(S.currentStrokeId); } catch (_) {}
          }
          S.isPainting      = false;
          S.currentStrokeId = -1;
          if (S.isRecording) stopLiveRecording();
          S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
          S.updateLiveRecUI?.();
        }
        S._traceActive = false;
      }
      // Sync trace indicator button with isPainting state (OSC/MIDI path)
      const _traceBtn = document.getElementById('paintIndicatorBtn');
      if (_traceBtn) _traceBtn.classList.toggle('painting', S.isPainting || S._traceToggled);
      break;
    }
    case 'mute':
      if (S._setMuted) S._setMuted(!S.isMuted);
      else S.isMuted = !S.isMuted;
      break;
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
    case 'erase_brush':
      // hold: val > 0 = press (start erasing), val === 0 = release
      if (midiVal > 0) startEraseStroke();
      else             stopEraseStroke();
      break;
    case 'erase_toggle':
      // Latching counterpart to erase_brush, same rationale as trace_toggle:
      // controllers that only emit a press edge (AirTurn and most foot pedals)
      // can never deliver the release a hold action needs, so the brush would
      // latch on forever.  S.eraseHeld is the single source of truth for state
      // — both entry points drive the same stroke lifecycle, so a toggle can
      // be ended by releasing the F key and vice versa.
      if (S.eraseHeld) stopEraseStroke();
      else             startEraseStroke();
      break;
    case 'undo':        undoLastStroke(); break;
    case 'sweep':
      if (S._sessionSweep) S._sessionSweep();
      else sweep();
      break;
    case 'handsfree':
      toggleHandsfree();
      break;

    // ── View ─────────────────────────────────────────────────────────────────
    case 'projector':
      if (S._toggleProjectorMode) S._toggleProjectorMode();
      _flash(document.getElementById('projectorModeBtn'));
      break;

    // ── Gesture morph ────────────────────────────────────────────────────────
    case 'radial_morph':
      S.radialMorphOn = !S.radialMorphOn;
      S._syncMorphBtnUI?.();
      _flash(document.getElementById('morphBtn'));
      break;

    // ── Trace ───────────────────────────────────────────────────────────────
    case 'trace_toggle': {
      // Direct toggle: no tap-timing required — ideal for foot pedals.
      // Bang toggles trace on/off with same lifecycle as tap-toggle.
      if (S._traceToggled || S.isPainting) {
        // Currently on → turn off
        S._stopToggleTrace?.();
      } else if (S.traceMode === 'trace') {
        // Currently off, plain trace mode → toggle on
        S._traceToggled = true;
        S._traceActive  = true;
        // If handsfree armed, let the gate manage recording segments
        if (S.hfArmed) {
          S.updateLiveRecUI?.(); S._syncHandsfreeUI?.();
        } else {
          // No handsfree — start continuous recording immediately
          ensureAudioContext(); startLiveRecording();
          recordStrokeStart('live', S.currentLiveBufferIdx);
          S.isPainting = true; S.paintFrameCount = 0;
          S.updateLiveRecUI?.();
        }
      }
      const _tb = document.getElementById('paintIndicatorBtn');
      if (_tb) _tb.classList.toggle('painting', S.isPainting || S._traceToggled);
      break;
    }
    case 'trace_mode': {
      // If toggled trace is active, force-stop before mode change
      if (S._traceToggled) {
        S._stopToggleTrace?.();
      }
      const _modes = ['trace', 'trace+loop', 'trace+cloud'];
      const _set = _strMode(midiVal, _modes, { loop: 'trace+loop', cloud: 'trace+cloud' });
      const _idx = _modes.indexOf(S.traceMode);
      S.traceMode = _set ?? _modes[(_idx + 1) % _modes.length];
      _flash(document.getElementById('commitLockBtn'));
      S._syncCommitUI?.();
      break;
    }

    // ── Commit: unified drop/draw/release/clear ─────────────────────────────
    case 'commit_mode': {
      S.commitMode = _strMode(midiVal, ['cloud', 'loop'])
        ?? (S.commitMode === 'cloud' ? 'loop' : 'cloud');
      S._syncCommitUI?.();
      break;
    }
    case 'commit_drop':
      if (S.commitMode === 'cloud') plantSeed();
      else                          dropSeqFromCursor();
      _flash(document.getElementById('commitDropBtn'));
      break;
    case 'commit_draw': {
      const _drawBtn = document.getElementById('commitDrawBtn');
      if (S.commitMode === 'cloud') {
        if (midiVal > 0) { startSeedPlant(); if (_drawBtn) _drawBtn.classList.add('painting'); }
        else             { finalizeSeedPlant(); if (_drawBtn) _drawBtn.classList.remove('painting'); }
      } else {
        // Loop arm: reuse existing seq_arm logic
        if (midiVal > 0 && !S.isPainting) {
          if (S.seqOverflow === 'off') {
            let full = true;
            for (let i = 0; i < S.seqSlotCount; i++) { if (!S.seqSlots[i]) { full = false; break; } }
            if (full) break;
          }
          ensureAudioContext();
          S._loopRecPreSeqMode = S.seqModeEnabled;
          S.seqModeEnabled = true;
          if (!S.scanMuted) setScanMuted(true);
          startLiveRecording();
          recordStrokeStart('live', S.currentLiveBufferIdx);
          S.isPainting = true; S.paintFrameCount = 0;
          if (_drawBtn) _drawBtn.classList.add('painting');
          S.updateLiveRecUI?.();
        } else if (midiVal === 0 && S.isPainting) {
          if (S.currentStrokeId > 0) {
            try { createSeqFromStroke(S.currentStrokeId); } catch (_) {}
          }
          S.isPainting      = false;
          S.currentStrokeId = -1;
          if (S.isRecording) stopLiveRecording();
          S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
          if (S._loopRecPreSeqMode !== undefined) {
            S.seqModeEnabled = S._loopRecPreSeqMode;
            S._syncCommitUI?.();
            S._loopRecPreSeqMode = undefined;
          }
          if (_drawBtn) _drawBtn.classList.remove('painting');
          S.updateLiveRecUI?.();
        }
      }
      break;
    }
    case 'commit_release':
      releaseCommit();
      _flash(document.getElementById('commitReleaseBtn'));
      break;
    case 'commit_clear':
      clearAllCommits();
      _flash(document.getElementById('commitClearBtn'));
      break;
    case 'commit_selection': {
      S.selectionMode = _strMode(midiVal, ['closest', 'farthest'], { nearest: 'closest' })
        ?? (S.selectionMode === 'closest' ? 'farthest' : 'closest');
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

    // ── Cloud Morph ────────────────────────────────────────────────────────
    case 'morph_sticky':
      S._toggleDesktopMorphSticky?.();
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
      rebuildGrainCurves();
      S.syncGrainControlsUI?.();
      break;
    }
    case 'camera_mode': {
      const modes = ['pull', 'surface', 'sensor'];
      const idx = modes.indexOf(S.cameraMode);
      const next = _strMode(midiVal, modes) ?? modes[(idx + 1) % modes.length];
      if (S._setCameraMode) S._setCameraMode(next);
      break;
    }
    case 'spatial_panning': {
      const set = _strMode(midiVal, ['headlocked', 'worldlocked'],
        { head: 'headlocked', world: 'worldlocked' });
      if (S._setSpatialPanning) S._setSpatialPanning(
        set ?? (S.spatialPanning === 'headlocked' ? 'worldlocked' : 'headlocked'));
      break;
    }
    case 'alt_lock':
      if (midiVal > 0 && !S.altLocked) {
        S.altLocked = true;
        S.altFrozenMousePixelX = S.mousePixelX;
        S.altFrozenMousePixelY = S.mousePixelY;
        if (S.cameraMode === 'surface') S._exitSurfaceLock?.();
        const wrapper = document.getElementById('canvasWrapper');
        if (wrapper) { wrapper.style.cursor = 'auto'; S.canvas.style.cursor = 'auto'; }
        const ind = document.getElementById('altLockIndicator');
        if (ind) ind.style.display = '';
      } else if (midiVal === 0 && S.altLocked) {
        S.altLocked = false;
        if (S.cameraMode === 'surface') {
          S._requestSurfaceLock?.();
        } else {
          const wrapper = document.getElementById('canvasWrapper');
          if (wrapper) { wrapper.style.cursor = ''; S.canvas.style.cursor = ''; }
        }
        const ind = document.getElementById('altLockIndicator');
        if (ind) ind.style.display = 'none';
      }
      break;
    case 'lock_az':
    case 'lock_el': {
      if (midiVal === 0) break; // toggle on press only, ignore release
      const stateKey = id === 'lock_az' ? 'axisLockAz' : 'axisLockEl';
      const segId    = id === 'lock_az' ? 'axisLockAzSeg' : 'axisLockElSeg';
      S[stateKey] = !S[stateKey];
      // Clear frozen snapshots so next lock captures fresh position
      if (id === 'lock_az') { S._axisLockFrozenNx = null; S._axisLockFrozenYaw = null; }
      if (id === 'lock_el') { S._axisLockFrozenNy = null; S._axisLockFrozenPitch = null; }
      // Sync UI buttons
      const seg = document.getElementById(segId);
      if (seg) seg.querySelectorAll('.grain-seg-btn').forEach(b =>
        b.classList.toggle('active',
          (b.dataset.val === 'on') === S[stateKey]));
      break;
    }
    case 'mapping_toggle_1': if (midiVal === 0) break; toggleMappingByIndex(0); break;
    case 'mapping_toggle_2': if (midiVal === 0) break; toggleMappingByIndex(1); break;
    case 'mapping_toggle_3': if (midiVal === 0) break; toggleMappingByIndex(2); break;
    case 'mapping_toggle_4': if (midiVal === 0) break; toggleMappingByIndex(3); break;
    case 'perf':
      S.perfMonitorVisible = !S.perfMonitorVisible;
      { const el = document.getElementById('perfMonitor'); if (el) el.style.display = S.perfMonitorVisible ? 'block' : 'none'; }
      break;
    case 'perfmode':
      S.perfMode = !S.perfMode;
      S._syncPerfModeUI?.();
      console.log(`[perf] high-performance render mode ${S.perfMode ? 'ON' : 'OFF'}`);
      break;
    case 'darkmode':
      S.darkMode = !S.darkMode;
      S._syncDarkModeUI?.();
      break;
    case 'radius_dec':
      S.searchRadiusDeg = Math.max(SEARCH_RADIUS_MIN, S.searchRadiusDeg - SEARCH_RADIUS_STEP);
      updatePlaybackControls(); flashRadiusTooltip();
      break;
    case 'radius_inc':
      S.searchRadiusDeg = Math.min(SEARCH_RADIUS_MAX, S.searchRadiusDeg + SEARCH_RADIUS_STEP);
      updatePlaybackControls(); flashRadiusTooltip();
      break;
    default:
      if (id.startsWith('paint')) {
        const n = parseInt(id.replace('paint', ''));
        const idx = n - 1;
        if (midiVal > 0 && !S.isPainting && idx < S.samples.length && S.samples[idx].buffer) {
          // Start sample paint
          ensureAudioContext(); S.activeSampleIndex = idx;
          if (S.seqModeEnabled && !S.scanMuted) S._setMuted?.(false) || setScanMuted?.(true);
          const s = S.samples[idx]; s.grainCursor = s.cropStart * s.duration;
          recordStrokeStart('sample'); S.isPainting = true; S.paintFrameCount = 0;
          // Cold-start worklet if not yet running (e.g. sample paint as first action)
          S._ensureWorkletForSample?.(S.samples[idx].buffer);
        } else if (midiVal === 0 && S.isPainting && S.activeSampleIndex === idx) {
          // Stop sample paint
          if (S.seqModeEnabled && S.currentStrokeId > 0) {
            try { createSeqFromStroke(S.currentStrokeId); } catch (_) {}
          }
          S.isPainting = false;
          S.currentStrokeId = -1;
          S.activeSampleIndex = -1;
        }
        // Sync trace indicator for sample paint too
        const _traceBtn2 = document.getElementById('paintIndicatorBtn');
        if (_traceBtn2) _traceBtn2.classList.toggle('painting', S.isPainting);
      }
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

// Hide rows that don't match every whitespace-separated term, and hide a group
// header when nothing under it survived.  Walks backwards so each header is
// reached after the rows it introduces.
function _applyMappingFilter() {
  const tbody = document.getElementById('mappingTableBody');
  if (!tbody) return;

  const terms = _mapFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows  = tbody.rows;
  let shown = 0, total = 0, groupHasVisible = false;

  for (let i = rows.length - 1; i >= 0; i--) {
    const tr = rows[i];
    if (tr.dataset.groupHeader) {
      tr.classList.toggle('filtered-out', !groupHasVisible);
      groupHasVisible = false;
      continue;
    }
    total++;
    const hit = terms.length === 0 ||
                terms.every(t => (tr.dataset.search || '').includes(t));
    tr.classList.toggle('filtered-out', !hit);
    if (hit) { shown++; groupHasVisible = true; }
  }

  const countEl = document.getElementById('mappingFilterCount');
  if (countEl) countEl.textContent = terms.length ? `${shown} / ${total}` : `${total} rows`;
  document.querySelector('.mapping-filter-row')
    ?.classList.toggle('filtering', terms.length > 0);
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

function setMappingStatus(msg) {
  const el = document.getElementById('mappingStatus');
  if (el) el.textContent = msg;
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
  return document.getElementById('mappingModal')?.classList.contains('open');
}

function _scheduleMonRender() {
  if (_monRafQueued) return;
  _monRafQueued = true;
  requestAnimationFrame(() => {
    _monRafQueued = false;
    if (_monPaused) return;
    if (!_monitorModalOpen()) return;
    if (_midiDirty) {
      const el = document.getElementById('ioMonMidiLog');
      if (el) {
        el.textContent = _midiRing.length ? _midiRing.join('\n') : '— waiting for messages —';
        el.scrollTop = el.scrollHeight;
      }
      const c = document.getElementById('ioMonMidiCount');
      if (c) c.textContent = String(_midiRing.length);
      _midiDirty = false;
    }
    if (_oscDirty) {
      const el = document.getElementById('ioMonOscLog');
      if (el) {
        el.textContent = _oscRing.length ? _oscRing.join('\n') : '— waiting for messages —';
        el.scrollTop = el.scrollHeight;
      }
      const c = document.getElementById('ioMonOscCount');
      if (c) c.textContent = String(_oscRing.length);
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
    _midiDirty = true;
    _oscDirty  = true;
    _scheduleMonRender();
  });
}

function renderMappingTable() {
  const tbody = document.getElementById('mappingTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  let curGroup = '';   // most recent section heading — folded into each row's filter text

  for (const action of ACTIONS) {
    // Skip legacy aliases — they still work for existing MIDI maps but don't show in UI
    if (action._legacy) continue;

    // ── Section header row ──────────────────────────────────────────────────
    if (!action.id) {
      curGroup = action.group || '';
      const tr = document.createElement('tr');
      tr.className = 'mapping-group-header';
      tr.dataset.groupHeader = '1';
      const th = document.createElement('th');
      th.colSpan = 8;
      th.textContent = action.group;
      tr.appendChild(th);
      tbody.appendChild(tr);
      continue;
    }

    const midiMap    = midiMappings[action.id];
    const keyMap     = keyMappings[action.id];
    const isMidiLearning = midiLearningId === action.id;
    const isKeyLearning  = keyLearningId  === action.id;

    const tr = document.createElement('tr');

    // Everything the filter box searches — built from the same values the cells
    // below display, plus the group heading and the action id, so "grain",
    // "cc 74", "/trace" and "pitch_shift" all find their row.  Unmapped rows
    // carry the word "unassigned" even though the cell now shows a hyphen: it's
    // the only way to filter down to what still needs binding.
    tr.dataset.search = [
      action.label,
      curGroup,
      action.id,
      action.key && action.key !== '—' ? action.key : '',
      keyMap  ? keyMappingLabel(keyMap) : '',
      midiMap ? `${midiMap.type} ${midiMap.number} ch${midiMap.channel}` : 'unassigned',
      action.osc || '',
      action.fmt || '',
    ].join(' ').toLowerCase();

    // Function name
    const tdName = document.createElement('td');
    tdName.className = 'fn-name';
    tdName.textContent = action.label;
    if (action.tip) tdName.title = action.tip;
    tr.appendChild(tdName);

    // Keyboard default shortcut
    const tdKey = document.createElement('td');
    if (action.key && action.key !== '—') {
      const badge = document.createElement('span');
      badge.className = 'key-badge';
      badge.textContent = action.key;
      tdKey.appendChild(badge);
    } else {
      tdKey.textContent = '—';
      tdKey.className   = 'unassigned';
    }
    tr.appendChild(tdKey);

    // Key override (custom binding) — only for trigger/hold actions
    const canKeyLearn = action.type === 'trigger' || action.type === 'hold' || action.type === 'toggle';
    const tdKeyOverride = document.createElement('td');
    tdKeyOverride.className = 'key-cell' + (keyMap ? '' : ' unassigned');
    if (canKeyLearn && keyMap) {
      tdKeyOverride.textContent = keyMappingLabel(keyMap);
    } else {
      tdKeyOverride.textContent = '—';
    }
    tr.appendChild(tdKeyOverride);

    // Key learn / clear buttons — only for trigger/hold actions
    const tdKeyBtn = document.createElement('td');
    tdKeyBtn.style.whiteSpace = 'nowrap';

    if (canKeyLearn) {
      const keyLearnBtn = document.createElement('button');
      keyLearnBtn.className = 'learn-btn' + (isKeyLearning ? ' learning' : '');
      keyLearnBtn.textContent = isKeyLearning ? 'waiting…' : 'learn';
      keyLearnBtn.addEventListener('click', () => {
        midiLearningId = null;  // cancel any MIDI learn
        if (keyLearningId === action.id) {
          keyLearningId = null;
          setMappingStatus('');
        } else {
          keyLearningId = action.id;
          setMappingStatus(`press a key or scroll to assign "${action.label}"…`);
        }
        renderMappingTable();
      });
      tdKeyBtn.appendChild(keyLearnBtn);

      if (keyMap) {
        const clearBtn = document.createElement('button');
        clearBtn.className = 'clear-midi-btn';
        clearBtn.textContent = '✕';
        clearBtn.title = 'clear key override';
        clearBtn.addEventListener('click', () => {
          delete keyMappings[action.id];
          saveKeyMappings();
          renderMappingTable();
        });
        tdKeyBtn.appendChild(clearBtn);
      }
    }
    tr.appendChild(tdKeyBtn);

    // MIDI assignment
    const tdMidi = document.createElement('td');
    tdMidi.className = 'midi-cell' + (midiMap ? '' : ' unassigned');
    if (midiMap) {
      tdMidi.textContent = `${midiMap.type.toUpperCase()} ${midiMap.number} ch${midiMap.channel}`;
    } else {
      tdMidi.textContent = '—';
    }
    tr.appendChild(tdMidi);

    // MIDI learn / clear buttons
    const tdMidiBtn = document.createElement('td');
    tdMidiBtn.style.whiteSpace = 'nowrap';

    const midiLearnBtn = document.createElement('button');
    midiLearnBtn.className = 'learn-btn' + (isMidiLearning ? ' learning' : '');
    midiLearnBtn.textContent = isMidiLearning ? 'waiting…' : 'learn';
    midiLearnBtn.addEventListener('click', () => {
      keyLearningId = null;  // cancel any key learn
      if (midiLearningId === action.id) {
        midiLearningId = null;
        setMappingStatus('');
      } else {
        midiLearningId = action.id;
        setMappingStatus(`move a midi control to assign "${action.label}"…`);
        if (!midiAccess) initMidi().then(refreshMidiInputs);
      }
      renderMappingTable();
    });
    tdMidiBtn.appendChild(midiLearnBtn);

    if (midiMap) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'clear-midi-btn';
      clearBtn.textContent = '✕';
      clearBtn.title = 'clear midi assignment';
      clearBtn.addEventListener('click', () => {
        delete midiMappings[action.id];
        saveMidiMappings();
        renderMappingTable();
      });
      tdMidiBtn.appendChild(clearBtn);
    }
    tr.appendChild(tdMidiBtn);

    // OSC path
    const tdOsc = document.createElement('td');
    tdOsc.className = 'osc-path';
    if (action.osc) {
      const badge = document.createElement('span');
      badge.className = 'osc-badge';
      badge.textContent = action.osc;
      tdOsc.appendChild(badge);
    } else {
      tdOsc.textContent = '—';
      tdOsc.classList.add('unassigned');
    }
    tr.appendChild(tdOsc);

    // Data format
    const tdFmt = document.createElement('td');
    tdFmt.className = 'osc-fmt';
    if (action.fmt) {
      tdFmt.textContent = action.fmt;
    } else {
      tdFmt.textContent = '—';
      tdFmt.classList.add('unassigned');
    }
    tr.appendChild(tdFmt);
    tbody.appendChild(tr);
  }

  // Rows are rebuilt on every learn/clear — reapply the active query so the
  // list doesn't silently expand back to all ~100 rows underneath the user.
  _applyMappingFilter();
}

// ── Modal setup (called from init) ───────────────────────────────────────────

export function setupMappingModal() {
  loadMidiMappings();
  loadKeyMappings();

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
  document.getElementById('clearAllMidi')?.addEventListener('click', () => {
    midiMappings = {};
    saveMidiMappings();
    renderMappingTable();
    setMappingStatus('all midi mappings cleared');
  });
  document.getElementById('clearAllKeys')?.addEventListener('click', () => {
    keyMappings = {};
    saveKeyMappings();
    renderMappingTable();
    setMappingStatus('all key overrides cleared');
  });

  // ── Key learn: capture keydown while learning ────────────────────────────
  // Non-overridable keys that should not be captured
  const BLOCKED_KEYS = new Set(['Escape', 'Tab', 'F5', 'F11', 'F12']);

  document.addEventListener('keydown', e => {
    if (keyLearningId === null) return;

    // Escape cancels learning (don't close modal)
    if (e.key === 'Escape') {
      keyLearningId = null;
      setMappingStatus('');
      renderMappingTable();
      e.stopImmediatePropagation();
      return;
    }

    if (BLOCKED_KEYS.has(e.key)) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    const newMapping = {
      type:  'key',
      key:   e.key,
      code:  e.code,
      shift: e.shiftKey,
      ctrl:  e.ctrlKey,
      meta:  e.metaKey,
    };

    removeConflictingKeyBinding(newMapping, keyLearningId);
    keyMappings[keyLearningId] = newMapping;
    saveKeyMappings();

    const action = ACTIONS.find(a => a.id === keyLearningId);
    setMappingStatus(`mapped "${action?.label}" → ${keyMappingLabel(newMapping)}`);
    keyLearningId = null;
    renderMappingTable();
  }, true);  // capture phase — runs before events.js handlers

  // ── Key learn: capture scroll while learning ─────────────────────────────
  document.addEventListener('wheel', e => {
    if (keyLearningId === null) return;

    // Hold actions need a release event — scroll has no release, so block it
    const learningAction = ACTIONS.find(a => a.id === keyLearningId);
    if (learningAction?.type === 'hold') {
      setMappingStatus(`scroll can't be assigned to hold actions — press a key instead`);
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const dir = e.deltaY > 0 ? 'scroll_down' : 'scroll_up';
    const newMapping = {
      type: dir,
      key: null, code: null, shift: false, ctrl: false, meta: false,
    };

    removeConflictingKeyBinding(newMapping, keyLearningId);
    keyMappings[keyLearningId] = newMapping;
    saveKeyMappings();

    const action = ACTIONS.find(a => a.id === keyLearningId);
    setMappingStatus(`mapped "${action?.label}" → ${keyMappingLabel(newMapping)}`);
    keyLearningId = null;
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
    if (!document.getElementById('mappingModal')?.classList.contains('open')) return;
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
  S._actions        = ACTIONS;
  S._dispatchAction = dispatchAction;
  S._isKeyLearning  = () => keyLearningId !== null;
  S._holdActionIds  = new Set(ACTIONS.filter(a => a.type === 'hold').map(a => a.id));
  S._activeHoldKeyMap = new Map();  // code → actionId for held custom-bound keys

}
