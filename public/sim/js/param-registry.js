// ============================================================================
// param-registry.js — every parameter a sparse patch object can carry
// ============================================================================
// The registry half of the old patch table (sandbox/sunset-2026-09-03/
// ui-patch-table.js): one entry per mappable parameter — key, group, type,
// get/set against S, format and parse. The table that edited twenty columns
// of these went with the patch bank on 2026-09-03; what still needs the list
// is a SESSION IMPORT, which applies the resolved grain block a session was
// played on (`patch` in the session file) through applyPresetObject() in
// ui-presets.js → applySparsePreset() here. Sparse on purpose: an absent key
// leaves live state alone rather than resetting it.
// ============================================================================

import { S, AXIS_SOURCES } from './state.js';
import { resetCursorPeriod } from './grain.js';

// ── Parameter registry ──────────────────────────────────────────────────────
// Each entry describes one mappable parameter.
//   key:       unique id (used as property name in preset object)
//   label:     human-readable row label in the table
//   group:     section header in the table
//   type:      'number' | 'boolean' | 'enum'
//   options:   for enum type, list of allowed values
//   get:       () => current value from S
//   set:       (v) => write value to S (no UI sync — that's done separately)
//   fmt:       (v) => display string for table cell
//   parse:     (str) => parsed value from user input (null = invalid)

// NOT in this registry, on purpose (#212): `nearestMode`, `searchRadiusDeg`,
// `recencyN`, `radiusFadeEnabled`, `radiusFadeCurve`. They describe WHERE THE
// CURSOR POINTS and how it reads, not what a brush sounds like, so they are
// global controls and never patch params. They used to be here, and the result
// was that picking a brush moved your reach and could flip your scope mid-set.
//
// Removing them from this registry is also the migration: loadUserPresets()
// strips any key the registry does not know and re-saves, so an old user patch
// carrying a radius loses it on next load rather than keeping a dead key that
// nothing reads.
export const PARAM_REGISTRY = [

  // ── Search ────────────────────────────────────────────────────────────────
  // k, k-all and k-seq (order) are gone from here (#233): they are LENS
  // properties now — live globals like searchRadiusDeg and recencyN, owned by
  // the lens tiles. Their absence from this registry is what strips them out
  // of old user patches on load, the same mechanism #212 used for the rest of
  // the search panel.

  // ── Grain ─────────────────────────────────────────────────────────────────
  { key: 'duration',   label: 'duration',     group: 'grain', type: 'number',
    get: () => S.grainOverrides.duration ?? S.grainParams.duration,
    set: v  => { S.grainOverrides.duration = v; },
    fmt: v  => fmtMs(v),
    parse: s => parseMs(s) },
  { key: 'durVar',     label: 'dur var',      group: 'grain', type: 'number',
    get: () => S.grainOverrides.durVar ?? S.grainParams.durVar,
    set: v  => { S.grainOverrides.durVar = v; },
    fmt: v  => Math.round(v * 1000) + 'ms',
    parse: s => { const v = parseMs(s); return v === null ? null : Math.max(0, Math.min(0.5, v)); } },
  { key: 'durJitter',  label: 'dur jitter',   group: 'grain', type: 'number',
    get: () => S.grainOverrides.durJitter ?? S.grainParams.durJitter ?? 0,
    set: v  => { S.grainOverrides.durJitter = v; },
    fmt: v  => Math.round(v * 100) + '%',
    parse: s => { const v = parseFloat(s.replace('%', '')) / 100; return isNaN(v) ? null : Math.max(0, Math.min(1, v)); } },
  { key: 'fadeMode',   label: 'fade unit',    group: 'grain', type: 'enum', options: ['pct', 'ms'],
    get: () => S.grainOverrides.fadeMode ?? S.grainParams.fadeMode ?? 'pct',
    set: v  => { S.grainOverrides.fadeMode = v === 'ms' ? 'ms' : 'pct'; S.syncGrainControlsUI?.(); },
    fmt: v  => v === 'ms' ? 'ms' : '%',
    parse: s => /^\s*ms\s*$/i.test(s) ? 'ms' : /pct|^\s*%\s*$/i.test(s) ? 'pct' : null },
  { key: 'fadeMs',     label: 'fade ms',      group: 'grain', type: 'number',
    get: () => S.grainOverrides.fadeMs ?? S.grainParams.fadeMs ?? 0.020,
    set: v  => { S.grainOverrides.fadeMs = v; },
    fmt: v  => Math.round(v * 1000) + 'ms',
    parse: s => { const v = parseMs(s); return v === null ? null : Math.max(0, Math.min(0.5, v)); } },
  { key: 'startJitter', label: 'start jitter', group: 'grain', type: 'number',
    get: () => S.grainOverrides.startJitter ?? S.grainParams.startJitter ?? 0,
    set: v  => { S.grainOverrides.startJitter = v; },
    fmt: v  => Math.round(v * 1000) + 'ms',
    parse: s => { const v = parseMs(s); return v === null ? null : Math.max(0, Math.min(0.5, v)); } },
  { key: 'fadeRatio',  label: 'fade',         group: 'grain', type: 'number',
    get: () => S.grainOverrides.fadeRatio ?? S.grainParams.fadeRatio,
    set: v  => { S.grainOverrides.fadeRatio = v; },
    fmt: v  => Math.round(v * 100) + '%',
    parse: s => { const v = parseFloat(s.replace('%', '')) / 100; return isNaN(v) ? null : Math.max(0, Math.min(0.5, v)); } },
  { key: 'period',     label: 'period',       group: 'grain', type: 'number',
    get: () => S.grainOverrides.period ?? S.grainParams.period,
    set: v  => { S.grainOverrides.period = v; resetCursorPeriod(); },
    fmt: v  => fmtMs(v),
    parse: s => parseMs(s) },
  { key: 'overlap',    label: 'overlap',      group: 'grain', type: 'number',
    get: () => {
      const dur = S.grainOverrides.duration ?? S.grainParams.duration;
      const per = S.grainOverrides.period   ?? S.grainParams.period;
      return per > 0 ? dur / per : 1;
    },
    set: v  => {
      const per = S.grainOverrides.period ?? S.grainParams.period;
      S.grainOverrides.duration = Math.max(2 / (S.audioCtx?.sampleRate ?? 48000), per * v);
    },
    fmt: v  => v.toFixed(2) + '×',
    parse: s => { const v = parseFloat(s.replace('×', '').replace('x', '')); return isNaN(v) ? null : Math.max(0.01, Math.min(100, v)); } },
  { key: 'periodVar',  label: 'period var',   group: 'grain', type: 'number',
    get: () => S.grainOverrides.periodVar ?? S.grainParams.periodVar,
    set: v  => { S.grainOverrides.periodVar = v; resetCursorPeriod(); },
    fmt: v  => Math.round(v * 1000) + 'ms',
    parse: s => { const v = parseMs(s); return v === null ? null : Math.max(0, Math.min(0.5, v)); } },
  { key: 'pitchShift', label: 'pitch shift',  group: 'grain', type: 'number',
    get: () => S.grainOverrides.pitchShift ?? S.grainParams.pitchShift ?? 0,
    set: v  => { S.grainOverrides.pitchShift = v; },
    fmt: v  => { const c = Math.round(v); if (c === 0) return '0¢'; if (c % 100 === 0) return (c > 0 ? '+' : '') + (c / 100) + 'st'; return (c > 0 ? '+' : '') + c + '¢'; },
    parse: s => {
      const t = s.trim().replace(/[¢\s]/g, '');
      if (t.endsWith('st')) { const st = parseFloat(t.replace('st', '')); return isNaN(st) ? null : Math.max(-2400, Math.min(2400, Math.round(st * 100))); }
      const c = parseFloat(t); return isNaN(c) ? null : Math.max(-2400, Math.min(2400, Math.round(c)));
    } },
  { key: 'pitchJitter', label: 'pitch jitter', group: 'grain', type: 'number',
    get: () => S.grainOverrides.pitchJitter ?? S.grainParams.pitchJitter,
    set: v  => { S.grainOverrides.pitchJitter = v; },
    fmt: v  => '±' + Math.round(1200 * Math.log2(1 + Math.max(0, v))) + '¢',
    parse: s => { const c = parseFloat(s.replace(/[±¢\s]/g, '')); return isNaN(c) ? null : Math.pow(2, Math.max(0, c) / 1200) - 1; } },
  { key: 'probability', label: 'probability',  group: 'grain', type: 'number',
    get: () => S.grainProbability,
    set: v  => { S.grainProbability = Math.max(0, Math.min(1, v)); },
    fmt: v  => Math.round(v * 100) + '%',
    parse: s => { const v = parseFloat(s.replace('%', '')) / 100; return isNaN(v) ? null : Math.max(0, Math.min(1, v)); } },
  { key: 'panSpread',  label: 'pan spread',   group: 'grain', type: 'number',
    get: () => S.grainOverrides.panSpread ?? S.grainParams.panSpread,
    set: v  => { S.grainOverrides.panSpread = v; },
    fmt: v  => Math.round(v * 100) + '%',
    parse: s => { const v = parseFloat(s.replace('%', '')) / 100; return isNaN(v) ? null : Math.max(0, Math.min(1, v)); } },
  { key: 'volume',     label: 'volume',       group: 'grain', type: 'number',
    get: () => S.grainOverrides.volume ?? S.grainParams.volume,
    set: v  => { S.grainOverrides.volume = v; },
    fmt: v  => v.toFixed(3),
    parse: s => { const v = parseFloat(s); return isNaN(v) ? null : Math.max(0.001, Math.min(2.0, v)); } },
  { key: 'hpfFreq',    label: 'hpf',          group: 'grain', type: 'number',
    get: () => S.grainOverrides.hpfFreq ?? S.grainParams.hpfFreq ?? 20,
    set: v  => { S.grainOverrides.hpfFreq = v; },
    fmt: v  => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) + 'Hz',
    parse: s => { const t = s.trim().toLowerCase().replace('hz', ''); let v; if (t.endsWith('k')) v = parseFloat(t) * 1000; else v = parseFloat(t); return isNaN(v) ? null : Math.max(20, Math.min(20000, v)); } },
  { key: 'lpfFreq',    label: 'lpf',          group: 'grain', type: 'number',
    get: () => S.grainOverrides.lpfFreq ?? S.grainParams.lpfFreq ?? 20000,
    set: v  => { S.grainOverrides.lpfFreq = v; },
    fmt: v  => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) + 'Hz',
    parse: s => { const t = s.trim().toLowerCase().replace('hz', ''); let v; if (t.endsWith('k')) v = parseFloat(t) * 1000; else v = parseFloat(t); return isNaN(v) ? null : Math.max(20, Math.min(20000, v)); } },
  { key: 'hpfQ',    label: 'hpf Q',     group: 'grain', type: 'number',
    get: () => S.grainOverrides.hpfQ ?? S.grainParams.hpfQ ?? 0.707,
    set: v  => { S.grainOverrides.hpfQ = v; },
    fmt: v  => v.toFixed(2),
    parse: s => { const v = parseFloat(s); return isNaN(v) ? null : Math.max(0.1, Math.min(20, v)); } },
  { key: 'lpfQ',    label: 'lpf Q',     group: 'grain', type: 'number',
    get: () => S.grainOverrides.lpfQ ?? S.grainParams.lpfQ ?? 0.707,
    set: v  => { S.grainOverrides.lpfQ = v; },
    fmt: v  => v.toFixed(2),
    parse: s => { const v = parseFloat(s); return isNaN(v) ? null : Math.max(0.1, Math.min(20, v)); } },
  { key: 'filterFreqJitter', label: 'flt jitter', group: 'grain', type: 'number',
    get: () => S.grainOverrides.filterFreqJitter ?? S.grainParams.filterFreqJitter ?? 0,
    set: v  => { S.grainOverrides.filterFreqJitter = v; },
    fmt: v  => Math.round(v * 100) + '%',
    parse: s => { const v = parseFloat(s.replace('%', '')) / 100; return isNaN(v) ? null : Math.max(0, Math.min(1, v)); } },
  { key: 'direction',  label: 'direction',    group: 'grain', type: 'enum', options: ['fwd', 'rev', 'rnd'],
    get: () => S.grainDirection,
    set: v  => { S.grainDirection = v; },
    fmt: v  => v,
    parse: s => ['fwd', 'rev', 'rnd'].includes(s.trim()) ? s.trim() : null },
  { key: 'curveType',  label: 'envelope',     group: 'grain', type: 'enum', options: ['hann', 'tri', 'rect'],
    get: () => S.grainCurveType,
    set: v  => { S.grainCurveType = v; },
    fmt: v  => v,
    parse: s => ['hann', 'tri', 'rect'].includes(s.trim()) ? s.trim() : null },

  // ── Cursor ────────────────────────────────────────────────────────────────
  { key: 'scanMuted', label: 'scan', group: 'cursor', type: 'boolean',
    get: () => S.scanMuted,
    set: v  => { _setScanMutedFn?.(v); },
    fmt: v  => v ? 'off' : 'on',
    parse: s => parseBool(s) },
  { key: 'azSource', label: 'azimuth src', group: 'cursor', type: 'enum', options: AXIS_SOURCES,
    get: () => S.azSource,
    set: v  => { S._setAxisSource?.('azSource', v); },
    fmt: v  => v,
    parse: s => AXIS_SOURCES.includes(s.trim()) ? s.trim() : null },
  { key: 'elSource', label: 'elevation src', group: 'cursor', type: 'enum', options: AXIS_SOURCES,
    get: () => S.elSource,
    set: v  => { S._setAxisSource?.('elSource', v); },
    fmt: v  => v,
    parse: s => AXIS_SOURCES.includes(s.trim()) ? s.trim() : null },
  // ── Commits — shared params (matches commits panel in main GUI) ──────────
  { key: 'seqSlotCount', label: 'slots', group: 'commits', type: 'number',
    get: () => S.commitSlotCount,
    set: v  => {
      S.commitSlotCount = Math.max(1, Math.min(16, Math.round(v)));
      S._syncCommitSlotCount?.();    // syncs slider + numbox
      S._syncCommitUI?.();
    },
    fmt: v  => String(v),
    parse: s => { const v = parseInt(s, 10); return isNaN(v) ? null : Math.max(1, Math.min(16, v)); } },
  { key: 'seqOverflow', label: 'overflow', group: 'commits', type: 'enum', options: ['off', 'oldest', 'nearest'],
    get: () => S.commitOverflow,
    set: v  => {
      S.commitOverflow = v;
      const seg = document.getElementById('commitOverflowSeg');
      if (seg) seg.querySelectorAll('.grain-seg-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.overflow === v));
      S._syncSeqButtonStates?.();
    },
    fmt: v  => v,
    parse: s => ['off', 'oldest', 'nearest'].includes(s.trim()) ? s.trim() : null },
  { key: 'seqModeEnabled', label: 'mode',    group: 'commits', type: 'enum', options: ['cloud', 'loop'],
    get: () => S.commitMode,
    set: v  => { S.commitMode = v; S._syncCommitUI?.(); },
    fmt: v  => v,
    parse: s => ['cloud', 'loop'].includes(s.trim()) ? s.trim() : null },
  // The rail's SORT reads this on its own tick (ui-pins.js), so there is no
  // element to refresh here since 2026-09-16.
  { key: 'selectionMode', label: 'select', group: 'commits', type: 'enum', options: ['nearest', 'farthest', 'oldest'],
    get: () => S.selectionMode,
    set: v  => { S.selectionMode = v; },
    fmt: v  => v,
    parse: s => ['nearest', 'farthest', 'oldest'].includes(s.trim()) ? s.trim() : null },
  { key: 'seedMode',         label: 'playback',      group: 'commits', type: 'enum', options: ['all', 'focus'],
    get: () => S.seedMode,
    set: v  => { S.seedMode = v; },
    fmt: v  => v,
    parse: s => ['all', 'focus'].includes(s.trim()) ? s.trim() : null },
  { key: 'seedTether',       label: 'tether',         group: 'commits', type: 'boolean',
    get: () => S.seedTether,
    set: v  => { S.seedTether = v; },
    fmt: v  => v ? 'on' : 'off',
    parse: s => parseBool(s) },
  { key: 'seedXfade',    label: 'xfade',      group: 'commits', type: 'number',
    get: () => S.seedXfade,
    set: v  => { S.seedXfade = Math.max(0, Math.min(1, v)); },
    fmt: v  => Math.round(v * 100) + '%',
    parse: s => { const v = parseFloat(s.replace('%', '')) / 100; return isNaN(v) ? null : Math.max(0, Math.min(1, v)); } },
  { key: 'seedLoopMode',     label: 'path dir',       group: 'commits', type: 'enum', options: ['pingpong', 'forward', 'rev'],
    get: () => S.seedLoopMode,
    set: v  => { S.seedLoopMode = v; },
    fmt: v  => v,
    parse: s => ['pingpong', 'forward', 'rev'].includes(s.trim()) ? s.trim() : null },

  // ── Cloud params ─────────────────────────────────────────────────────────
  { key: 'seedAttack',       label: 'fade in',         group: 'cloud', type: 'number',
    get: () => S.seedAttack,
    set: v  => { S.seedAttack = Math.max(0, Math.min(10, v)); },
    fmt: v  => v.toFixed(1) + 's',
    parse: s => { const v = parseFloat(s.replace('s', '')); return isNaN(v) ? null : Math.max(0, Math.min(10, v)); } },
  { key: 'seedRelease',      label: 'fade out',        group: 'cloud', type: 'number',
    get: () => S.seedRelease,
    set: v  => { S.seedRelease = Math.max(0, Math.min(10, v)); },
    fmt: v  => v.toFixed(1) + 's',
    parse: s => { const v = parseFloat(s.replace('s', '')); return isNaN(v) ? null : Math.max(0, Math.min(10, v)); } },

  // ── Loop params ──────────────────────────────────────────────────────────
  { key: 'seqNextVolume', label: 'volume',    group: 'loop', type: 'number',
    get: () => S.seqNextParams.volume,
    set: v  => { S.seqNextParams.volume = Math.max(0, Math.min(1, v)); },
    fmt: v  => Math.round(v * 100) + '%',
    parse: s => { const v = parseFloat(s.replace('%', '')) / 100; return isNaN(v) ? null : Math.max(0, Math.min(1, v)); } },
  { key: 'seqNextSpeed', label: 'speed',      group: 'loop', type: 'number',
    get: () => S.seqNextParams.speed,
    set: v  => { S.seqNextParams.speed = Math.max(0.25, Math.min(4, v)); },
    fmt: v  => '×' + v.toFixed(2),
    parse: s => { const v = parseFloat(s.replace('×', '')); return isNaN(v) ? null : Math.max(0.25, Math.min(4, v)); } },

];

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseBool(s) {
  const t = (typeof s === 'string' ? s : String(s)).trim().toLowerCase();
  if (['on', '1', 'true', 'yes', 'muted'].includes(t)) return true;
  if (['off', '0', 'false', 'no', 'unmuted'].includes(t)) return false;
  return null;
}

function fmtMs(v) {
  const ms = v * 1000;
  if (ms >= 1000)  return (ms / 1000).toFixed(2) + 's';
  if (ms < 0.01)   return ms.toFixed(4) + 'ms';
  if (ms < 0.1)    return ms.toFixed(3) + 'ms';
  if (ms < 1)      return ms.toFixed(2) + 'ms';
  if (ms < 10)     return ms.toFixed(1) + 'ms';
  return Math.round(ms) + 'ms';
}

function parseMs(str) {
  const s = str.trim();
  let v;
  if (s.endsWith('ms')) v = parseFloat(s) / 1000;
  else if (s.endsWith('s')) v = parseFloat(s);
  else v = parseFloat(s) / 1000;
  return isNaN(v) ? null : Math.max(0, v);
}

// ── Build a sparse snapshot of the current state ──────────────────────────
export function snapshotCurrentState(keys) {
  const snap = {};
  for (const p of PARAM_REGISTRY) {
    if (keys && !keys.has(p.key) && !Array.from(keys).includes(p.key)) continue;
    snap[p.key] = p.get();
  }
  return snap;
}

// Keys handled by applyPresetObject's inline grain-engine logic — skip in applySparsePreset
const INLINE_HANDLED_KEYS = new Set([
  'duration', 'durJitter', 'durVar', 'fadeRatio', 'period', 'periodVar',
  'pitchJitter', 'pitchShift', 'panSpread', 'volume', 'k', 'retriggerMs',
  'direction', 'curveType', 'nearestMode', 'grainKAllMode', 'grainKSeqMode',
  'searchRadiusDeg', 'recencyN', 'probability', 'radiusFadeEnabled', 'radiusFadeCurve',
]);

// ── Apply a sparse preset to live state ─────────────────────────────────
export function applySparsePreset(patch, skipInlineKeys = true) {
  if (!patch || typeof patch !== 'object') return;
  for (const p of PARAM_REGISTRY) {
    if (skipInlineKeys && INLINE_HANDLED_KEYS.has(p.key)) continue;
    if (!(p.key in patch) || patch[p.key] === undefined || patch[p.key] === null) continue;
    p.set(patch[p.key]);
  }
}

// ── Sync all UI controls after a sparse preset is applied ───────────────
export function syncAllUI() {
  S.syncGrainControlsUI?.();
  S._syncRadiusFadeUI?.();
  S._syncImprovUI?.();
  S._syncSeqUI?.();
  S._syncScanUI?.();
  // ui-presets.js registers this; importing it here would be circular.
  S._updatePlaybackControls?.();
}
