// ============================================================================
// UI — PATCH TABLE EDITOR (Max-style sparse preset table)
// ============================================================================
// Opens a modal with patches as columns, parameters as rows.
// Each cell can be empty (no mapping → parameter untouched on recall)
// or hold a value (applied on recall).  Full pattr-like flexibility.
// ============================================================================

import {
  S,
  PRESETS, FACTORY_PRESET_START, USER_PRESET_START,
  saveUserPresets, rebuildGrainCurves, _buildValidParamKeys,
} from './state.js';
import { resetCursorPeriod } from './grain.js';
import { isLocked, isLockable, toggleLock, onLockChange, loadLocks } from './param-lock.js';

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

export const PARAM_REGISTRY = [

  // ── Search ────────────────────────────────────────────────────────────────
  { key: 'nearestMode',    label: 'scope (nearest)',  group: 'search', type: 'boolean',
    get: () => S.nearestMode,
    set: v  => { S.nearestMode = v; },
    fmt: v  => v ? 'on' : 'off',
    parse: s => parseBool(s) },
  { key: 'searchRadiusDeg', label: 'radius °',        group: 'search', type: 'number',
    get: () => S.searchRadiusDeg,
    set: v  => { S.searchRadiusDeg = Math.max(1, Math.min(180, Math.round(v))); },
    fmt: v  => v + '°',
    parse: s => { const n = parseInt(s); return isNaN(n) ? null : Math.max(1, Math.min(180, n)); } },
  { key: 'k',              label: 'k',                group: 'search', type: 'number',
    get: () => S.grainOverrides.k ?? S.grainParams.k,
    set: v  => { if (typeof S.setSearchK === 'function') S.setSearchK(v); else S.grainOverrides.k = v; },
    fmt: v  => String(v),
    parse: s => { const n = parseInt(s); return isNaN(n) ? null : Math.max(1, Math.min(Math.max(1, S.particles.length), n)); } },
  { key: 'grainKAllMode',  label: 'k-all',            group: 'search', type: 'boolean',
    get: () => S.grainKAllMode,
    set: v  => { if (S.nearestMode) return; S.grainKAllMode = v; },
    fmt: v  => v ? 'on' : 'off',
    parse: s => parseBool(s) },
  { key: 'grainKSeqMode',  label: 'k-seq',            group: 'search', type: 'boolean',
    get: () => S.grainKSeqMode,
    set: v  => { S.grainKSeqMode = v; },
    fmt: v  => v ? 'on' : 'off',
    parse: s => parseBool(s) },
  { key: 'recencyN',       label: 'recency',          group: 'search', type: 'number',
    get: () => S.recencyN,
    set: v  => { if (typeof S.setRecency === 'function') S.setRecency(v); else S.recencyN = v; },
    fmt: v  => v === 0 ? 'all' : String(v),
    parse: s => { const t = s.trim().toLowerCase(); if (t === 'all') return 0; const n = parseInt(t); return isNaN(n) ? null : Math.max(0, Math.min(16, n)); } },

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
    set: v  => { S.grainOverrides.volume = v; rebuildGrainCurves(); },
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
  { key: 'filterQ',    label: 'filter Q',     group: 'grain', type: 'number',
    get: () => S.grainOverrides.filterQ ?? S.grainParams.filterQ ?? 0.707,
    set: v  => { S.grainOverrides.filterQ = v; },
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
    set: v  => { S.grainCurveType = v; rebuildGrainCurves(); },
    fmt: v  => v,
    parse: s => ['hann', 'tri', 'rect'].includes(s.trim()) ? s.trim() : null },

  // ── Cursor ────────────────────────────────────────────────────────────────
  { key: 'scanMuted', label: 'scan', group: 'cursor', type: 'boolean',
    get: () => S.scanMuted,
    set: v  => { _setScanMutedFn?.(v); },
    fmt: v  => v ? 'off' : 'on',
    parse: s => parseBool(s) },
  { key: 'radiusFadeEnabled', label: 'radius fade', group: 'cursor', type: 'boolean',
    get: () => S.radiusFadeEnabled,
    set: v  => { S.radiusFadeEnabled = v; },
    fmt: v  => v ? 'on' : 'off',
    parse: s => parseBool(s) },
  { key: 'radiusFadeCurve', label: 'fade curve', group: 'cursor', type: 'number',
    get: () => S.radiusFadeCurve,
    set: v  => { S.radiusFadeCurve = Math.max(0, Math.min(1, v)); },
    fmt: v  => Math.round(v * 100) + '%',
    parse: s => { const v = parseFloat(s.replace('%', '')) / 100; return isNaN(v) ? null : Math.max(0, Math.min(1, v)); } },
  { key: 'axisLockAz', label: 'lock azimuth', group: 'cursor', type: 'bool',
    get: () => S.axisLockAz,
    set: v  => {
      S.axisLockAz = v;
      S._axisLockFrozenNx = null; S._axisLockFrozenYaw = null;
      const seg = document.getElementById('axisLockAzSeg');
      if (seg) seg.querySelectorAll('.grain-seg-btn').forEach(b =>
        b.classList.toggle('active', (b.dataset.val === 'on') === v));
    },
    fmt: v  => v ? 'on' : 'off',
    parse: s => s.trim() === 'on' ? true : s.trim() === 'off' ? false : null },
  { key: 'axisLockEl', label: 'lock elevation', group: 'cursor', type: 'bool',
    get: () => S.axisLockEl,
    set: v  => {
      S.axisLockEl = v;
      S._axisLockFrozenNy = null; S._axisLockFrozenPitch = null;
      const seg = document.getElementById('axisLockElSeg');
      if (seg) seg.querySelectorAll('.grain-seg-btn').forEach(b =>
        b.classList.toggle('active', (b.dataset.val === 'on') === v));
    },
    fmt: v  => v ? 'on' : 'off',
    parse: s => s.trim() === 'on' ? true : s.trim() === 'off' ? false : null },
  // ── Commits — shared params (matches commits panel in main GUI) ──────────
  { key: 'seqSlotCount', label: 'slots', group: 'commits', type: 'number',
    get: () => S.commitSlotCount,
    set: v  => {
      S.commitSlotCount = Math.max(1, Math.min(16, Math.round(v)));
      const sel = document.getElementById('commitSlotCountSelect');
      if (sel) sel.value = String(S.commitSlotCount);
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
  { key: 'selectionMode', label: 'select', group: 'commits', type: 'enum', options: ['closest', 'farthest'],
    get: () => S.selectionMode,
    set: v  => {
      S.selectionMode = v;
      const seg = document.getElementById('commitSelectionSeg');
      if (seg) seg.querySelectorAll('.grain-seg-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.selection === v));
    },
    fmt: v  => v,
    parse: s => ['closest', 'farthest'].includes(s.trim()) ? s.trim() : null },
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

// Keys handled by selectPreset's inline grain-engine logic — skip in applySparsePreset
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
    if (isLocked(p.key)) continue;   // ◆ param lock — skip locked params
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
  const { updatePlaybackControls } = _lazyImports();
  updatePlaybackControls?.();
}

// Lazy import to avoid circular dependency
let _imports = null;
function _lazyImports() {
  if (!_imports) {
    _imports = { updatePlaybackControls: null };
  }
  return _imports;
}

// ── Late-bound function references (set by initPatchTable) ──────────────
let _setScanMutedFn = null;
let _selectPresetFn = null;

// ── Modal state ─────────────────────────────────────────────────────────
let _modal = null;
let _isOpen = false;

// ── Build + open the patch table modal ──────────────────────────────────

export function openPatchTable() {
  if (!_modal) _buildModal();
  _renderTable();
  _isOpen = true;
  _modal.classList.add('open');
}

export function closePatchTable() {
  _isOpen = false;
  if (_modal) _modal.classList.remove('open');
}

function _buildModal() {
  _modal = document.getElementById('patchTableModal');
  if (!_modal) return;
  _modal.querySelector('#patchTableClose')?.addEventListener('click', closePatchTable);
  _modal.addEventListener('click', e => { if (e.target === _modal) closePatchTable(); });
  // ESC to close (but don't block digit keys for preset switching)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _isOpen) { closePatchTable(); e.stopPropagation(); }
  });
}

// ── Update highlight when active preset changes (keyboard shortcut, etc) ──
export function refreshActiveColumn() {
  if (!_modal || !_isOpen) return;
  const table = _modal.querySelector('.pt-table');
  if (!table) return;

  // Update selector row radios
  table.querySelectorAll('.pt-radio').forEach(r => {
    r.checked = (parseInt(r.dataset.idx) === S.activePresetIndex);
  });

  // Update column highlights
  table.querySelectorAll('.pt-active').forEach(el => el.classList.remove('pt-active'));
  table.querySelectorAll('.pt-active-col').forEach(el => el.classList.remove('pt-active-col'));
  table.querySelectorAll(`th[data-idx="${S.activePresetIndex}"]`).forEach(el => el.classList.add('pt-active'));
  table.querySelectorAll(`td[data-preset="${S.activePresetIndex}"]`).forEach(el => el.classList.add('pt-active-col'));

  // Update selector cell highlight
  table.querySelectorAll('.pt-selector-cell').forEach(el => {
    el.classList.toggle('pt-active-col', parseInt(el.dataset.preset) === S.activePresetIndex);
  });
}

// ── Render the full table ───────────────────────────────────────────────

function _renderTable() {
  const table = _modal.querySelector('.pt-table');
  if (!table) return;
  table.innerHTML = '';

  const thead = document.createElement('thead');

  // ── Row 1: Selector row (radio buttons to switch presets) ─────────────
  const selRow = document.createElement('tr');
  selRow.className = 'pt-selector-row';
  const selLabel = document.createElement('th');
  selLabel.className = 'pt-param-col pt-selector-label';
  selLabel.textContent = '●';
  selRow.appendChild(selLabel);
  // Lock column spacer in selector row
  const selLockSpacer = document.createElement('th');
  selLockSpacer.className = 'pt-lock-col';
  selRow.appendChild(selLockSpacer);

  for (let i = 0; i < PRESETS.length; i++) {
    const td = document.createElement('td');
    td.className = 'pt-selector-cell';
    td.dataset.preset = i;
    if (i === S.activePresetIndex) td.classList.add('pt-active-col');

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'pt-preset-select';
    radio.className = 'pt-radio';
    radio.dataset.idx = i;
    radio.checked = (i === S.activePresetIndex);
    radio.addEventListener('change', () => {
      if (_selectPresetFn) _selectPresetFn(i);
      refreshActiveColumn();
    });
    td.appendChild(radio);
    // Click anywhere in the cell to select
    td.addEventListener('click', e => {
      if (e.target === radio) return; // already handled
      radio.checked = true;
      if (_selectPresetFn) _selectPresetFn(i);
      refreshActiveColumn();
    });
    selRow.appendChild(td);
  }
  thead.appendChild(selRow);

  // ── Row 2: Name headers ───────────────────────────────────────────────
  const hRow = document.createElement('tr');
  const thParam = document.createElement('th');
  thParam.textContent = 'parameter';
  thParam.className = 'pt-param-col';
  hRow.appendChild(thParam);
  // Lock column header
  const thLock = document.createElement('th');
  thLock.className = 'pt-lock-col';
  thLock.textContent = '🔒';
  thLock.title = 'parameter locks — locked params hold through preset changes';
  thLock.style.fontSize = '0.55rem';
  hRow.appendChild(thLock);

  for (let i = 0; i < PRESETS.length; i++) {
    const th = document.createElement('th');
    th.className = 'pt-preset-col';
    th.dataset.idx = i;
    if (i === S.activePresetIndex) th.classList.add('pt-active');
    if (i < FACTORY_PRESET_START) th.classList.add('pt-user');

    if (i < FACTORY_PRESET_START) {
      // Editable name for user presets
      const nameSpan = document.createElement('span');
      nameSpan.className = 'pt-preset-name pt-editable-name';
      nameSpan.textContent = PRESETS[i].name;
      nameSpan.title = 'click to rename';
      nameSpan.addEventListener('dblclick', () => _editPresetName(i, nameSpan));
      th.appendChild(nameSpan);
    } else {
      const nameSpan = document.createElement('span');
      nameSpan.className = 'pt-preset-name';
      nameSpan.textContent = PRESETS[i].name;
      nameSpan.title = PRESETS[i].name;
      th.appendChild(nameSpan);
    }

    hRow.appendChild(th);
  }
  thead.appendChild(hRow);
  table.appendChild(thead);

  // ── Body rows: one per parameter, grouped ─────────────────────────────
  const tbody = document.createElement('tbody');
  let currentGroup = '';

  for (const param of PARAM_REGISTRY) {
    if (param.group !== currentGroup) {
      currentGroup = param.group;
      const groupRow = document.createElement('tr');
      groupRow.className = 'pt-group-row';
      const groupTd = document.createElement('td');
      groupTd.colSpan = PRESETS.length + 2;  // +2 for label + lock column
      groupTd.textContent = currentGroup;
      groupRow.appendChild(groupTd);
      tbody.appendChild(groupRow);
    }

    const row = document.createElement('tr');
    row.className = 'pt-param-row';
    if (isLocked(param.key)) row.classList.add('pt-row-locked');

    const labelTd = document.createElement('td');
    labelTd.className = 'pt-label';
    labelTd.textContent = param.label;
    row.appendChild(labelTd);

    // Lock cell
    const lockTd = document.createElement('td');
    lockTd.className = 'pt-lock-col';
    if (isLockable(param.key)) {
      const lockSpan = document.createElement('span');
      lockSpan.className = 'pt-lock-cell' + (isLocked(param.key) ? ' locked' : '');
      lockSpan.textContent = isLocked(param.key) ? '🔒' : '🔓';
      lockSpan.dataset.lockKey = param.key;
      lockSpan.title = isLocked(param.key)
        ? `unlock ${param.label} — preset recall will change this again`
        : `lock ${param.label} — holds value through preset changes`;
      lockSpan.addEventListener('click', () => {
        const nowLocked = toggleLock(param.key);
        lockSpan.classList.toggle('locked', nowLocked);
        lockSpan.textContent = nowLocked ? '🔒' : '🔓';
        lockSpan.title = nowLocked
          ? `unlock ${param.label} — preset recall will change this again`
          : `lock ${param.label} — holds value through preset changes`;
        row.classList.toggle('pt-row-locked', nowLocked);
      });
      lockTd.appendChild(lockSpan);
    }
    row.appendChild(lockTd);

    for (let i = 0; i < PRESETS.length; i++) {
      const td = document.createElement('td');
      td.className = 'pt-cell';
      td.dataset.param = param.key;
      td.dataset.preset = i;

      const preset = PRESETS[i];
      const hasValue = preset && param.key in preset && preset[param.key] !== undefined && preset[param.key] !== null;

      if (hasValue) {
        td.textContent = param.fmt(preset[param.key]);
        td.classList.add('pt-mapped');
      } else {
        td.textContent = '';
        td.classList.add('pt-empty');
      }

      if (i === S.activePresetIndex) td.classList.add('pt-active-col');

      td.addEventListener('click', e => _onCellClick(e, param, i, td));
      td.addEventListener('contextmenu', e => {
        e.preventDefault();
        _clearCell(param, i, td);
      });

      row.appendChild(td);
    }

    tbody.appendChild(row);
  }

  table.appendChild(tbody);
}

// ── Preset name editing ─────────────────────────────────────────────────

function _editPresetName(presetIdx, nameSpan) {
  if (presetIdx >= FACTORY_PRESET_START) return;
  if (nameSpan.querySelector('input')) return; // already editing

  const currentName = PRESETS[presetIdx].name;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'pt-inline-input pt-name-input';
  input.value = currentName;
  nameSpan.textContent = '';
  nameSpan.appendChild(input);
  input.focus();
  input.select();

  const commit = () => {
    const newName = input.value.trim();
    if (newName && newName !== currentName) {
      PRESETS[presetIdx].name = newName;
      saveUserPresets();
      // Also update the main preset button label
      const btn = document.querySelectorAll('.preset-btn')[presetIdx];
      const btnName = btn?.querySelector('.preset-name');
      if (btnName) btnName.textContent = newName;
      S._rebuildPresetDropdown?.();
      S._rebuildMorphDropdowns?.();
    }
    nameSpan.textContent = PRESETS[presetIdx].name;
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { nameSpan.textContent = currentName; }
    // Stop digit keys from triggering preset selection while editing name
    e.stopPropagation();
  });
}

// ── Cell interaction ────────────────────────────────────────────────────

function _onCellClick(e, param, presetIdx, td) {
  if (presetIdx >= FACTORY_PRESET_START) return;

  const preset = PRESETS[presetIdx];
  const hasValue = preset && param.key in preset && preset[param.key] !== undefined && preset[param.key] !== null;

  if (!hasValue) {
    const currentVal = param.get();
    preset[param.key] = currentVal;
    td.textContent = param.fmt(currentVal);
    td.classList.remove('pt-empty');
    td.classList.add('pt-mapped');
    saveUserPresets();
  } else {
    _startInlineEdit(param, presetIdx, td);
  }
}

function _clearCell(param, presetIdx, td) {
  if (presetIdx >= FACTORY_PRESET_START) return;
  const preset = PRESETS[presetIdx];
  if (preset) {
    delete preset[param.key];
    td.textContent = '';
    td.classList.remove('pt-mapped');
    td.classList.add('pt-empty');
    saveUserPresets();
  }
}

function _startInlineEdit(param, presetIdx, td) {
  if (td.querySelector('input, select')) return;

  const preset = PRESETS[presetIdx];
  const currentVal = preset[param.key];

  if (param.type === 'boolean') {
    const newVal = !currentVal;
    preset[param.key] = newVal;
    td.textContent = param.fmt(newVal);
    saveUserPresets();
    return;
  }

  if (param.type === 'enum') {
    const opts = param.options;
    const idx = opts.indexOf(currentVal);
    const newVal = opts[(idx + 1) % opts.length];
    preset[param.key] = newVal;
    td.textContent = param.fmt(newVal);
    saveUserPresets();
    return;
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'pt-inline-input';
  input.value = param.fmt(currentVal);
  td.textContent = '';
  td.appendChild(input);
  input.focus();
  input.select();

  const commit = () => {
    const parsed = param.parse(input.value);
    if (parsed !== null) {
      preset[param.key] = parsed;
      td.textContent = param.fmt(parsed);
      saveUserPresets();
    } else {
      td.textContent = param.fmt(currentVal);
    }
    td.classList.add('pt-mapped');
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { td.textContent = param.fmt(currentVal); }
    // Stop digit keys from triggering preset selection while editing
    e.stopPropagation();
  });
}

// ── Initialise — called from main.js ────────────────────────────────────

export function initPatchTable(updatePlaybackControlsFn, setScanMutedFn, selectPresetFn) {
  _imports = { updatePlaybackControls: updatePlaybackControlsFn };
  _setScanMutedFn = setScanMutedFn;
  _selectPresetFn = selectPresetFn;

  // Register the canonical PARAM_REGISTRY key set with state.js so
  // loadUserPresets can strip stale keys from stored data.
  _buildValidParamKeys(PARAM_REGISTRY);

  // Wire the menu button
  const btn = document.getElementById('patchTableBtn');
  if (btn) btn.addEventListener('click', openPatchTable);

  // Hook into selectPreset so the table updates when presets change
  // (keyboard shortcuts, OSC, MIDI, etc.)
  const origSelectPreset = S._selectPreset;
  if (origSelectPreset) {
    S._selectPreset = function(idx) {
      origSelectPreset(idx);
      refreshActiveColumn();
    };
  }
  // Also hook S._patchTableRefresh so selectPreset in ui-presets.js can call it
  S._patchTableRefresh = refreshActiveColumn;
}
