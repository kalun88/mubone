// ============================================================================
// ui-sensor-mapping.js — Mapping page UI
//
// Master–detail (#round six), for the reason the sensors page took the same
// shape: _buildRow() put fourteen controls on one line — toggle, axis, |x|,
// in min/max, bar, live, curve, exp, kind, dest, out min/max, delete — and no
// table row survives that. Now:
//
//   · the LIST is one sentence per mapping ("roll → grain density") with the
//     numbers as a sub-line, and a toggle at the left;
//   · the DETAIL is six rows in the order the signal takes them — axis, fold,
//     input range, curve, destination, output range. That order is the
//     documentation, which is why the flow diagram above the list could go.
//
// Selection is module state, persisted; the default is the first enabled
// mapping. Every control keeps the id, listener and update path it had.
// ============================================================================

import { S } from './state.js';
import {
  getMappings, addMapping, updateMapping, removeMapping, toggleMapping,
  MAPPABLE_PARAMS, MAPPABLE_CURSOR_AXES, AXIS_DEFS, applyCurve, clearAllMappings, getCursorEuler,
  readMappingInput,
  getMappingTelemetry, getTransportStatus,
} from './sensor-mapping.js';
import {
  initMIDIOut, isMIDIOutInitialized, listOutputs,
  onStateChange as onMIDIStateChange, testSend as midiTestSend,
} from './midi-out.js';
import { testSend as oscTestSend } from './osc-out.js';

// ── Output kind registry ───────────────────────────────────────────────────
// Each kind knows how to describe itself, what default destination to
// synthesise when the user switches to it, and how to render destination
// fields. Keeps _buildRow from becoming a giant conditional tree.
const OUTPUT_KINDS = [
  { value: 'grain',  label: 'grain' },
  { value: 'cursor', label: 'cursor' },
  { value: 'midi',   label: 'MIDI CC' },
  { value: 'osc',    label: 'OSC' },
];

// Default destination hydration when user switches a row's kind.
function _defaultDestForKind(kind) {
  if (kind === 'grain')  return { kind: 'grain', param: 'cutoff' };
  if (kind === 'cursor') return { kind: 'cursor', param: 'elevation' };
  if (kind === 'midi')  return { kind: 'midi',  deviceId: '', channel: 1, cc: 20, bits: 7 };
  if (kind === 'osc')   return { kind: 'osc',   host: _defaultOscHost(), port: _defaultOscPort(), address: '/mubone/out' };
  return { kind: 'grain', param: 'cutoff' };
}

// ── One-way auto-arm ────────────────────────────────────────────────────────
// Picking a cursor destination sets that axis's source to 'mapped', because an
// enabled row that silently does nothing reads as a bug ("I made the mapping
// and nothing happened").
//
// It does NOT disarm.  Deleting or disabling the row leaves the axis on
// 'mapped', where it holds its last position — a dropdown must not put the
// cursor back under sensor control mid-performance. Disarming stays manual.
function _armCursorAxis(param) {
  const axis = MAPPABLE_CURSOR_AXES.find(a => a.key === param);
  if (axis) S._setAxisSource?.(axis.source, 'mapped');
}

// Default output range when switching kinds — grain rows inherit the param's
// native range; MIDI rows go 0..127 (or 0..16383 for 14-bit); OSC rows go 0..1.
function _defaultOutputRangeForKind(kind, opts = {}) {
  if (kind === 'grain') {
    const def = MAPPABLE_PARAMS.find(p => p.key === opts.param);
    return { outputMin: def?.min ?? 0, outputMax: def?.max ?? 1 };
  }
  if (kind === 'midi') {
    const hi = opts.bits === 14 ? 16383 : 127;
    return { outputMin: 0, outputMax: hi };
  }
  if (kind === 'cursor') {
    const def = MAPPABLE_CURSOR_AXES.find(a => a.key === opts.param);
    return { outputMin: def?.min ?? -90, outputMax: def?.max ?? 90 };
  }
  if (kind === 'osc') return { outputMin: 0, outputMax: 1 };
  return { outputMin: 0, outputMax: 1 };
}

// ── Global transport defaults (persisted) ──────────────────────────────────
const GLOBAL_KEY = 'mubone_mappingTransportGlobal';
let _global = { oscHost: '127.0.0.1', oscPort: 9000 };
try {
  const raw = localStorage.getItem(GLOBAL_KEY);
  if (raw) _global = { ..._global, ...(JSON.parse(raw) || {}) };
} catch (_) { /* ignore */ }

function _saveGlobal() {
  try { localStorage.setItem(GLOBAL_KEY, JSON.stringify(_global)); } catch (_) { /* ignore */ }
}
function _defaultOscHost() { return _global.oscHost || '127.0.0.1'; }
function _defaultOscPort() { return _global.oscPort || 9000; }

// ── Axis options ───────────────────────────────────────────────────────────
// min/max describe the axis's native full range, used for the mini range-bar
// visualization (fill position is computed relative to this). IMU axes are in
// degrees; the generic /mapping* channels are unitless, nominally -1..1.
// `word` is what the row's SENTENCE says. The label is a dropdown option and
// takes sentence case; "Roll → grain density" reads as two sentences colliding,
// so the sentence gets the bare noun.
const AXIS_OPTIONS = [
  { value: 'roll',      label: 'Roll',           word: 'roll',       unit: '\u00b0', min: -90,  max:  90 },
  { value: 'elevation', label: 'Elevation',      word: 'elevation',  unit: '\u00b0', min: -90,  max:  90 },
  { value: 'azimuth',   label: 'Azimuth',        word: 'azimuth',    unit: '\u00b0', min: -180, max: 180 },
  { value: 'mapping1',  label: 'OSC /mapping1',  word: '/mapping1',  unit: '',  min:  -1,  max:   1 },
  { value: 'mapping2',  label: 'OSC /mapping2',  word: '/mapping2',  unit: '',  min:  -1,  max:   1 },
  { value: 'mapping3',  label: 'OSC /mapping3',  word: '/mapping3',  unit: '',  min:  -1,  max:   1 },
];

// ── Curve presets ──────────────────────────────────────────────────────────
// The glyphs went with the mini canvas: a dropdown carries a word, and the
// sub-line under each list row says the same word, so the two agree by
// construction rather than by anyone remembering to.
const CURVE_OPTIONS = [
  { value: 'linear', label: 'Linear',      word: 'linear',      exp: 1.0 },
  { value: 'log',    label: 'Logarithmic', word: 'logarithmic', exp: 2.0 },
  { value: 'exp',    label: 'Exponential', word: 'exponential', exp: 2.0 },
];

// ── Live readout loop ─────────────────────────────────────────────────────
// Runs only while the modal is open. Updates raw axis + scaled output spans
// at ~30fps so the user can see sensor values while setting input ranges.
// Also pokes the per-row tx indicator so the performer can see whether
// packets are actually leaving the machine.

let _rafId = null;
// [ { raw, scaled, mappingId, tx, txWrap }, ... ] — tx/txWrap may be missing
let _liveSpans = [];
// Maps mappingId → refs to the destination-specific controls we might need to
// re-render when the MIDI device list updates asynchronously.
let _midiDeviceSelects = new Map();
// Transport banner element refs — updated on each interval tick.
let _bannerRefs = null;
let _bannerTick = null;

function _startLiveLoop() {
  if (_rafId) return;
  function tick() {
    _updateLiveValues();
    _rafId = requestAnimationFrame(tick);
  }
  _rafId = requestAnimationFrame(tick);
}

function _stopLiveLoop() {
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  if (_bannerTick) { clearInterval(_bannerTick); _bannerTick = null; }
}

// Is this page on screen? Two hosts, and only one of them is the modal: the
// settings shell (#255) MOVES this dialog into #settingsHost and takes the
// overlay's `.open` back off, so every `classList.contains('open')` guard read
// false while the page was in front of you — a MIDI device arriving mid-session
// never appeared, and an OSC toggle never repainted the row it had just moved.
function _visible() {
  const modal = document.getElementById('sensorMappingModal');
  return !!modal?.classList.contains('open')
      || !!document.querySelector('.settings-host .sensor-mapping-dialog');
}

// ── Selection ───────────────────────────────────────────────────────────────
// One mapping at a time is "the" mapping: its chain is the six rows below the
// list. Default is the first ENABLED one — the row that is actually running is
// the one you opened the page to look at.
const _SEL_KEY = 'mubone_settings_mapping';
let _selectedId = null;
try { _selectedId = localStorage.getItem(_SEL_KEY); } catch (_) {}

function _resolveSelection() {
  const mappings = getMappings();
  if (_selectedId && mappings.some(m => m.id === _selectedId)) return _selectedId;
  const want = (mappings.find(m => m.enabled) || mappings[0])?.id ?? null;
  _selectedId = want;
  // Persist what was RESOLVED, not only what was clicked: otherwise the default
  // is recomputed every session and the stored key stays empty until someone
  // happens to pick a second mapping.
  if (want) { try { localStorage.setItem(_SEL_KEY, want); } catch (_) {} }
  return want;
}

function selectMapping(id) {
  if (_selectedId === id) return;
  _selectedId = id;
  try { localStorage.setItem(_SEL_KEY, id); } catch (_) {}
  _renderList();
}

function _fmtValueForDisplay(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 100)    return Math.round(v).toString();
  if (Math.abs(v) >= 1)      return v.toFixed(1);
  return v.toFixed(3);
}

function _fmtRawForAxis(axisDef, v) {
  if (typeof axisDef?.format === 'function') return axisDef.format(v);
  if (typeof v === 'number' && Number.isFinite(v)) return v.toFixed(2);
  return '—';
}

// Per-kind scaled-output preview — mirrors the dispatcher math in
// sensor-mapping.js so what the user sees in the modal is what gets sent.
// Called from _updateLiveValues.
function _previewScaledForRow(m, curved) {
  const out = m.output || { kind: 'grain', param: m.targetParam };
  if (out.kind === 'grain') {
    const paramDef = MAPPABLE_PARAMS.find(p => p.key === (out.param || m.targetParam));
    let value;
    if (paramDef?.log) {
      const logMin = Math.log(Math.max(1e-6, m.outputMin));
      const logMax = Math.log(Math.max(1e-6, m.outputMax));
      value = Math.exp(logMin + curved * (logMax - logMin));
    } else {
      value = m.outputMin + curved * (m.outputMax - m.outputMin);
    }
    if (paramDef) value = Math.max(paramDef.min, Math.min(paramDef.max, value));
    return value;
  }
  if (out.kind === 'cursor') {
    const def = MAPPABLE_CURSOR_AXES.find(a => a.key === out.param);
    const v = m.outputMin + curved * (m.outputMax - m.outputMin);
    return def ? Math.max(def.min, Math.min(def.max, v)) : v;
  }
  if (out.kind === 'midi') {
    const maxVal = out.bits === 14 ? 16383 : 127;
    const lo = Math.max(0, Math.min(maxVal, m.outputMin ?? 0));
    const hi = Math.max(0, Math.min(maxVal, m.outputMax ?? maxVal));
    return lo + curved * (hi - lo);
  }
  // osc
  const lo = Number.isFinite(m.outputMin) ? m.outputMin : 0;
  const hi = Number.isFinite(m.outputMax) ? m.outputMax : 1;
  return lo + curved * (hi - lo);
}

// The test button's flash. The per-row indicator is the list's pip, which wears
// classes rather than inline colour so the tokens stay in the stylesheet.
const TX_COLORS = {
  sent:        '#81c784',
  deduped:     '#8e8e8e',
  throttled:   '#ffb74d',
  unavailable: '#e57373',
  invalid:     '#e57373',
  idle:        '#555',
};

function _updateTxIndicator(entry, telemetry) {
  if (!entry.tx) return;
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const st = telemetry?.lastTxStatus;
  const fresh = telemetry?.lastTxAt && (now - telemetry.lastTxAt < 600);
  // A failure LATCHES, the way the clip pip does: by the time you look up from
  // the sensor, an unlatched dot has already gone back to grey and the page is
  // saying everything is fine. Only a later successful send clears it.
  if (st === 'unavailable' || st === 'invalid') entry.latched = 'err';
  else if (st === 'sent' && fresh) entry.latched = null;
  const cls = entry.latched === 'err' ? 'map-tx--err'
            : (fresh && st === 'sent')      ? 'map-tx--ok'
            : (fresh && st === 'throttled') ? 'map-tx--warn'
            : '';
  entry.tx.className = 'map-tx' + (cls ? ' ' + cls : '');
  entry.tx.title = telemetry?.lastError ? `${st || 'idle'} — ${telemetry.lastError}`
                 : (entry.latched === 'err' ? 'last send failed' : (st || 'idle'));
}

function _updateLiveValues() {
  if (_liveSpans.length === 0) return;

  const euler = getCursorEuler();
  const mappings = getMappings();

  for (const entry of _liveSpans) {
    const m = mappings.find(x => x.id === entry.mappingId);
    if (!m) continue;

    const axisDef = AXIS_DEFS[m.axis];
    if (!axisDef) {
      if (entry.pair) entry.pair.textContent = '—';
      continue;
    }
    // Shared reader — the readout shows the value the evaluator actually uses,
    // folded or not, so an |x| row doesn't display a negative it never sees.
    const raw = readMappingInput(m, euler, axisDef);
    const rawTxt = _fmtRawForAxis(axisDef, raw);

    // Scaled output preview
    let scaledTxt = '—';
    const range = m.inputMax - m.inputMin;
    if (Math.abs(range) >= 0.001) {
      const t = Math.max(0, Math.min(1, (raw - m.inputMin) / range));
      scaledTxt = _fmtValueForDisplay(_previewScaledForRow(m, applyCurve(t, m.curveType, m.curveExp)));
    }
    // One string, because the pair IS the reading: "32.4° → 0.41".
    if (entry.pair) entry.pair.textContent = `${rawTxt} → ${scaledTxt}`;

    // The range bar's live tick, on the bar's OWN scale — which folds with |x|.
    if (entry.tick) {
      const span = entry.axisMax - entry.axisMin;
      const f = span ? (raw - entry.axisMin) / span : 0;
      entry.tick.style.left = (Math.max(0, Math.min(1, f)) * 100).toFixed(2) + '%';
    }

    _updateTxIndicator(entry, getMappingTelemetry(m.id));
  }
}

// ── Initialise ─────────────────────────────────────────────────────────────

export function initMappingUI() {
  const btn   = document.getElementById('mappingBtn');
  const modal = document.getElementById('sensorMappingModal');
  const close = document.getElementById('sensorMappingClose');
  const addBtn   = document.getElementById('sensorMappingAddBtn');
  const clearBtn = document.getElementById('sensorMappingClearBtn');

  if (!btn || !modal) return;

  // Listen for MIDI device connect/disconnect — re-render affected selects if
  // the page is on screen so the new device shows up immediately.
  onMIDIStateChange(() => {
    if (_visible()) _renderList();
  });

  // Open/close modal
  btn.addEventListener('click', () => {
    modal.classList.toggle('open');
    if (modal.classList.contains('open')) {
      // Proactively kick off MIDI access so the device dropdown is populated
      // before the user opens a MIDI row. initMIDIOut() is idempotent.
      initMIDIOut().then(() => {
        if (_visible()) _renderList();
      });
      _renderList();
      _startLiveLoop();
    } else {
      _stopLiveLoop();
    }
  });
  if (close) close.addEventListener('click', () => { modal.classList.remove('open'); _stopLiveLoop(); });
  modal.addEventListener('click', e => { if (e.target === modal) { modal.classList.remove('open'); _stopLiveLoop(); } });

  // Add mapping — defaults to a grain row with the first unused grain param; if
  // all are used, falls back to a fresh MIDI row so the user isn't stuck. The
  // new row becomes the selected one: adding a mapping and landing on someone
  // else's chain is the one thing this button must not do.
  if (addBtn) addBtn.addEventListener('click', () => {
    const mappings = getMappings();
    const usedParams = new Set(
      mappings
        .filter(m => (m.output?.kind || 'grain') === 'grain')
        .map(m => m.output?.param || m.targetParam)
    );
    const available = MAPPABLE_PARAMS.find(p => !usedParams.has(p.key));
    if (available) {
      addMapping({
        output:    { kind: 'grain', param: available.key },
        outputMin: available.min,
        outputMax: available.max,
      });
    } else {
      addMapping({
        output:    { kind: 'midi', deviceId: '', channel: 1, cc: 20, bits: 7 },
        outputMin: 0,
        outputMax: 127,
      });
    }
    const added = getMappings();
    const fresh = added[added.length - 1];
    if (fresh) { _selectedId = fresh.id; try { localStorage.setItem(_SEL_KEY, fresh.id); } catch (_) {} }
    _renderList();
  });

  // Clear all button
  if (clearBtn) clearBtn.addEventListener('click', () => {
    clearAllMappings();
    _selectedId = null;
    _renderList();
  });

  // Sync callback — called when mappings change externally (toggle via OSC/MIDI)
  S._syncMappingUI = () => {
    if (_visible()) _renderList();
  };

  // Initial render
  _renderList();
}

// ── Render the mapping list ────────────────────────────────────────────────

function _renderList() {
  const list = document.getElementById('sensorMappingRows');
  if (!list) return;

  _liveSpans = [];  // reset live span refs
  _midiDeviceSelects = new Map();

  _buildTransports();

  const mappings = getMappings();
  const active   = mappings.filter(m => m.enabled).length;
  const count = document.getElementById('sensorMappingCount');
  if (count) {
    count.textContent = mappings.length
      ? `${mappings.length} mapping${mappings.length === 1 ? '' : 's'} · ${active} active`
      : 'No mappings';
  }

  list.innerHTML = '';
  if (mappings.length === 0) {
    list.innerHTML = '<div class="set-empty">No mappings yet. Add one to drive a grain parameter, the cursor, a MIDI CC or an OSC address from a sensor axis.</div>';
    _renderSelected(null);
    return;
  }

  const sel = _resolveSelection();
  for (const m of mappings) list.appendChild(_buildListRow(m, m.id === sel));
  _renderSelected(mappings.find(m => m.id === sel) || null);
}

// ── One row of the list: the mapping as a sentence ─────────────────────────
// A filled circle is not a control, so the enable state is the kit's toggle.
// Everything else in the row is text: the sentence, and the numbers under it.

function _buildListRow(m, isSel) {
  const out = m.output || { kind: 'grain', param: m.targetParam };
  const row = _el('div', 'set-device' + (isSel ? ' set-device--sel' : '') + (m.enabled ? '' : ' set-device--off'));
  row.dataset.id = m.id;

  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 'set-toggle';
  toggle.checked = !!m.enabled;
  toggle.title = m.enabled ? 'disable this mapping' : 'enable this mapping';
  toggle.addEventListener('click', e => e.stopPropagation());
  toggle.addEventListener('change', () => { toggleMapping(m.id); _renderList(); });

  const text = _el('span', 'set-device-text');
  const sentence = _el('span', 'map-sentence');
  const axisOpt = AXIS_OPTIONS.find(a => a.value === m.axis);
  sentence.appendChild(_el('span', null, axisOpt?.word || m.axis));
  sentence.appendChild(_el('span', 'map-arrow', '→'));
  sentence.appendChild(_el('span', null, _destWord(m, out)));
  if (out.kind === 'midi') sentence.appendChild(_el('span', 'map-ch', `ch ${out.channel || 1}`));
  text.appendChild(sentence);
  text.appendChild(_el('span', 'set-table-sub', _subLine(m, out)));

  const pair = _el('span', 'map-live', '—');
  const entry = { mappingId: m.id, pair };
  row.appendChild(toggle);
  row.appendChild(text);
  row.appendChild(pair);
  // MIDI and OSC are the only kinds that can fail to leave the machine.
  if (out.kind === 'midi' || out.kind === 'osc') {
    entry.tx = _el('div', 'map-tx');
    entry.tx.title = 'idle';
    row.appendChild(entry.tx);
  }
  _liveSpans.push(entry);
  if (isSel) {
    const b = _el('span', 'set-badge set-badge--ok', 'Selected');
    row.appendChild(b);
  }
  row.addEventListener('click', () => selectMapping(m.id));
  return row;
}

// What the sentence calls the destination.
function _destWord(m, out) {
  if (out.kind === 'grain') {
    return MAPPABLE_PARAMS.find(p => p.key === (out.param || m.targetParam))?.label || 'grain';
  }
  if (out.kind === 'cursor') {
    return MAPPABLE_CURSOR_AXES.find(a => a.key === out.param)?.label || 'cursor';
  }
  if (out.kind === 'midi') return `CC ${out.cc ?? 20}`;
  return out.address || '/…';
}

// The numbers, as one line: in-range (folded?) · curve · out-range.
function _subLine(m, out) {
  const axisOpt = AXIS_OPTIONS.find(a => a.value === m.axis);
  const u = axisOpt?.unit || '';
  const inSpan = `${_n(m.inputMin)}…${_n(m.inputMax)}${u}` + (m.absInput ? ' folded' : '');
  const curve  = CURVE_OPTIONS.find(c => c.value === m.curveType);
  const word   = curve?.word || 'linear';
  const shape  = (m.curveType !== 'linear' && Math.abs((m.curveExp ?? 1) - 1) > 0.001)
    ? `${word} ${(+m.curveExp).toFixed(1)}` : word;
  const ou = (out.kind === 'grain')
    ? (MAPPABLE_PARAMS.find(p => p.key === (out.param || m.targetParam))?.unit || '') : '';
  return `${inSpan} · ${shape} · ${_n(m.outputMin)}…${_n(m.outputMax)}${ou}`;
}

// A number the way the sub-line says it: integers bare, everything else 2dp,
// and a real minus sign, because the page is set in prose.
function _n(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  const txt = Number.isInteger(v) ? String(v)
            : (Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(2));
  return txt.replace('-', '−');
}

// ── Transport banner ───────────────────────────────────────────────────────
// Shows MIDI + OSC transport state and lets the user set global defaults for
// new OSC rows. Also exposes a button to trigger WebMIDI permission when the
// browser hasn't granted it yet.

function _buildTransports() {
  const host = document.getElementById('mappingTransports');
  if (!host) return;
  host.innerHTML = '';
  host.appendChild(_el('div', 'set-sec-title', 'Transports'));
  host.appendChild(_el('div', 'set-sec-lede', 'What the MIDI and OSC rows send through. Neither is needed for a grain or cursor mapping.'));

  // ── MIDI ──
  const midiDot    = _el('span', 'map-tx', '●');
  const midiStatus = _el('span', 'set-badge', '');
  const midiCtl    = [midiDot, midiStatus];
  if (!isMIDIOutInitialized()) {
    const b = _el('button', 'set-btn set-btn--sm', 'Request access');
    b.addEventListener('click', () => { initMIDIOut().then(() => _renderList()); });
    midiCtl.push(b);
  }
  host.appendChild(_setRow('MIDI', 'The browser grants Web MIDI once per origin — until it does, no device list exists.', midiCtl));

  // ── OSC ──
  const oscDot    = _el('span', 'map-tx', '●');
  const oscStatus = _el('span', 'set-badge', '');
  const hostIn = _field('text', _defaultOscHost(), '', 'set-field--host');
  hostIn.input.placeholder = '127.0.0.1';
  hostIn.input.addEventListener('change', () => {
    _global.oscHost = hostIn.input.value.trim() || '127.0.0.1';
    _saveGlobal();
    _applyOscEndpoint();
  });
  const portIn = _field('text', _defaultOscPort(), '');
  portIn.input.placeholder = '9000';
  portIn.input.addEventListener('change', () => {
    const v = parseInt(portIn.input.value, 10);
    if (Number.isInteger(v) && v > 0 && v <= 65535) { _global.oscPort = v; _saveGlobal(); _applyOscEndpoint(); }
    else portIn.input.value = _defaultOscPort();   // reject invalid
  });
  host.appendChild(_setRow('OSC output', 'Where every OSC row sends. One address book, so a typo is fixed once rather than per row.', [oscDot, oscStatus, hostIn, portIn]));

  _bannerRefs = { midiDot, midiStatus, oscDot, oscStatus };
  _updateBanner();
  // Poll transport status at 2Hz — device connect/disconnect also fires
  // onMIDIStateChange, but the OSC side has no event stream and needs polling.
  if (_bannerTick) clearInterval(_bannerTick);
  _bannerTick = setInterval(_updateBanner, 500);
}

function _updateBanner() {
  if (!_bannerRefs) return;
  const s = getTransportStatus();

  _bannerRefs.midiDot.style.color = s.midi ? TX_COLORS.sent : TX_COLORS.idle;
  if (!isMIDIOutInitialized()) {
    _badge(_bannerRefs.midiStatus, 'Not requested', false);
  } else if (!s.midi) {
    _badge(_bannerRefs.midiStatus, 'No outputs', false);
  } else {
    const outs = listOutputs();
    _badge(_bannerRefs.midiStatus, outs.length === 1 ? _shortenName(outs[0].name) : `${outs.length} devices`, true);
  }

  _bannerRefs.oscDot.style.color = s.osc ? TX_COLORS.sent : TX_COLORS.unavailable;
  _badge(_bannerRefs.oscStatus, s.osc ? 'Ready' : 'Electron only', s.osc);
}

function _badge(el, text, ok) {
  if (!el) return;
  el.textContent = text;
  el.className = 'set-badge' + (ok ? ' set-badge--ok' : '');
}

// ── The selected mapping ───────────────────────────────────────────────────

function _renderSelected(m) {
  const sec = document.getElementById('sensorMappingSelected');
  if (!sec) return;
  if (!m) { sec.hidden = true; sec.innerHTML = ''; return; }
  sec.hidden = false;
  sec.innerHTML = '';

  const out = m.output || { kind: 'grain', param: m.targetParam };

  // Heading: the same sentence the list row carries, so there is never a
  // question about which row is open. The live pair rides it as a badge.
  const head = _el('div', 'set-sec-title map-detail-head');
  const axisOpt = AXIS_OPTIONS.find(a => a.value === m.axis);
  head.appendChild(_el('span', null, `${axisOpt?.word || m.axis} → ${_destWord(m, out)}`));
  const pair = _el('span', 'set-badge set-badge--ok', '—');
  _liveSpans.push({ mappingId: m.id, pair });
  head.appendChild(pair);

  const del = _el('button', 'set-btn set-btn--sm set-btn--danger', 'Delete');
  del.title = 'remove this mapping';
  del.addEventListener('click', () => {
    removeMapping(m.id);
    _selectedId = null;
    _renderList();
  });
  head.appendChild(del);

  sec.appendChild(head);
  sec.appendChild(_el('div', 'set-sec-lede', 'The chain runs top to bottom in the order the signal takes it.'));
  for (const row of _buildRow(m)) sec.appendChild(row);
}

// ── The chain, one row per stage ───────────────────────────────────────────
// Six rows in the order the signal takes them — read the axis, fold it, clamp
// it into the input range, bend it, send it, scale it. That order is the
// documentation, which is why the flow diagram above the list could go.
//
// Every control here is the one that was on the old fourteen-control line: the
// same element, the same listener, the same updateMapping() call. What changed
// is what contains it.

function _buildRow(m) {
  const out = m.output || { kind: 'grain', param: m.targetParam };
  const rows = [];

  // ── 1. Axis ──
  const axisSel = _select(AXIS_OPTIONS.map(a => ({ value: a.value, label: a.label })), m.axis);
  axisSel.className = 'set-select';
  axisSel.addEventListener('change', () => {
    updateMapping(m.id, { axis: axisSel.value });
    _renderList();
  });
  rows.push(_setRow('Axis', 'Which reading this mapping watches, on the sensor holding the frame role.', [axisSel]));

  // ── 2. Fold at zero ──
  // Sits before the input range because that is exactly where it acts: it
  // conditions the reading before the range sees it.
  const absTog = document.createElement('input');
  absTog.type = 'checkbox';
  absTog.className = 'set-toggle';
  absTog.checked = !!m.absInput;
  absTog.addEventListener('change', () => {
    updateMapping(m.id, { absInput: absTog.checked });
    _renderList();
  });
  rows.push(_setRow('Fold at zero', 'Magnitude only: −179° and +179° both read 179°. Folds before the input range sees it, so the range runs 0 upward.', [absTog]));

  // ── 3. Input range, and the bar under it ──
  const axisOpt = AXIS_OPTIONS.find(a => a.value === m.axis);
  const axisUnit = axisOpt?.unit || '';
  const inMin = _numbox(m.inputMin, axisUnit);
  inMin.input.title = 'input min';
  inMin.input.addEventListener('change', () => {
    const v = parseFloat(inMin.input.value);
    if (!isNaN(v)) { updateMapping(m.id, { inputMin: v }); _renderList(); }
  });
  const inMax = _numbox(m.inputMax, axisUnit);
  inMax.input.title = 'input max';
  inMax.input.addEventListener('change', () => {
    const v = parseFloat(inMax.input.value);
    if (!isNaN(v)) { updateMapping(m.id, { inputMax: v }); _renderList(); }
  });
  const inRow = _setRow('Input range', 'The span of the folded reading that maps to the full output. Outside it, the output holds at its end.', [inMin, inMax], 'map-row--range');
  inRow.appendChild(_buildRangeBar(m, axisOpt));
  rows.push(inRow);

  // ── 4. Curve ──
  const curveSel = _select(CURVE_OPTIONS.map(c => ({ value: c.value, label: c.label })), m.curveType);
  curveSel.className = 'set-select';
  curveSel.addEventListener('change', () => {
    const preset = CURVE_OPTIONS.find(c => c.value === curveSel.value);
    updateMapping(m.id, { curveType: curveSel.value, curveExp: preset?.exp ?? 1.0 });
    _renderList();
  });
  const expBox = _numbox(m.curveExp, '');
  expBox.input.title = 'curve exponent';
  expBox.input.addEventListener('change', () => {
    const v = parseFloat(expBox.input.value);
    if (!isNaN(v)) updateMapping(m.id, { curveExp: Math.max(0.1, Math.min(10, v)) });
    _renderList();
  });
  rows.push(_setRow('Curve', 'How the input maps across the range. Exponential gives fine control at the low end.', [curveSel, expBox]));

  // ── 5. Destination ──
  const kindSel = _select(OUTPUT_KINDS, out.kind);
  kindSel.className = 'set-select set-select--narrow';
  kindSel.addEventListener('change', () => {
    const newKind = kindSel.value;
    const newOut = _defaultDestForKind(newKind);
    const range = _defaultOutputRangeForKind(newKind, newOut);
    updateMapping(m.id, { output: newOut, outputMin: range.outputMin, outputMax: range.outputMax });
    if (newKind === 'cursor') _armCursorAxis(newOut.param);
    _renderList();
  });
  const destCtl = [kindSel, ..._buildDestFields(m, out)];
  // Test send stays with the destination — it is the destination you are
  // testing. The tx PIP is in the list instead: it says which row is failing,
  // which is a question you ask before you have opened one.
  if (out.kind === 'midi' || out.kind === 'osc') destCtl.push(_buildTestButton(m, out));
  rows.push(_setRow('Destination', 'Where the mapped value lands. Cursor axes arm on selection; MIDI and OSC need their own fields.', destCtl));

  // ── 5b. Resolution — a MIDI row only ──
  // Its own row rather than a fifth control in the destination: it changes the
  // OUTPUT RANGE under you (0…127 becomes 0…16383), which is a consequence
  // worth a sentence.
  if (out.kind === 'midi') {
    const bitsSel = _select(
      [{ value: '7', label: '7-bit' }, { value: '14', label: '14-bit' }],
      String(out.bits || 7)
    );
    bitsSel.className = 'set-select set-select--narrow';
    bitsSel.addEventListener('change', () => {
      const bits = parseInt(bitsSel.value, 10) === 14 ? 14 : 7;
      const range = _defaultOutputRangeForKind('midi', { bits });
      updateMapping(m.id, { output: { ...out, bits }, outputMin: range.outputMin, outputMax: range.outputMax });
      _renderList();
    });
    rows.push(_setRow('Resolution', 'A 14-bit CC sends a second controller 32 numbers below the first. Changing this resets the output range.', [bitsSel]));
  }

  // ── 6. Output range ──
  const { outMin, outMax } = _buildOutputRange(m, out);
  rows.push(_setRow('Output range', 'The parameter’s own units. Reverse them to invert the mapping.', [outMin, outMax]));

  return rows;
}

// ── The range bar, rebuilt as the meter element ────────────────────────────
// The bar's own scale FOLDS with the axis: with |x| on, the reachable span is
// 0..max, so drawing the selection against the full −max..max would show a
// correct 0..180 selection as the right-hand half of the bar.

function _buildRangeBar(m, axisOpt) {
  const wrap = _el('div', 'mapping-range-bar set-meters');
  const unit = axisOpt?.unit || '';
  const rawMin = axisOpt ? axisOpt.min : -1;
  const rawMax = axisOpt ? axisOpt.max :  1;
  const axisMin = m.absInput ? 0 : rawMin;
  const axisMax = m.absInput ? Math.max(Math.abs(rawMin), Math.abs(rawMax)) : rawMax;
  const span = axisMax - axisMin;

  const ruler = _el('div', 'set-meter-ruler');
  ruler.appendChild(_el('span', 'set-meter-label'));
  const scale = _el('span', 'set-meter-scale');
  for (const f of [0, 0.5, 1]) {
    const tick = _el('span', null, _n(axisMin + f * span) + unit);
    tick.style.left = (f * 100) + '%';
    scale.appendChild(tick);
  }
  ruler.appendChild(scale);
  wrap.appendChild(ruler);

  const row = _el('div', 'set-meter-row');
  row.appendChild(_el('span', 'set-meter-label', 'reach'));
  const track = _el('div', 'set-meter-track');
  const band = _el('div', 'set-meter-band');
  const l = ((m.inputMin - axisMin) / span) * 100;
  const r = ((m.inputMax - axisMin) / span) * 100;
  band.style.left  = Math.max(0, Math.min(100, Math.min(l, r))) + '%';
  band.style.right = (100 - Math.max(0, Math.min(100, Math.max(l, r)))) + '%';
  const tick = _el('div', 'set-meter-peak');
  track.appendChild(band);
  track.appendChild(tick);
  row.appendChild(track);
  wrap.appendChild(row);
  _liveSpans.push({ mappingId: m.id, tick, axisMin, axisMax });

  wrap.appendChild(_el('div', 'mapping-range-note',
    `Lit span is the selected range against the axis’s own reachable travel — ${_n(axisMin)}…${_n(axisMax)}${unit}${m.absInput ? ' once folded' : ''}. The tick is live.`));
  return wrap;
}

// ── One row of the kit ─────────────────────────────────────────────────────
// Title + description left, controls flush right (SETTINGS-GUI § 2).

function _setRow(title, desc, ctls, extraCls) {
  const row = _el('div', 'set-row' + (extraCls ? ' ' + extraCls : ''));
  const text = _el('div', 'set-row-text');
  text.appendChild(_el('span', 'set-row-title', title));
  if (desc) text.appendChild(_el('span', 'set-row-desc', desc));
  row.appendChild(text);
  const ctl = _el('div', 'set-ctl');
  for (const c of ctls) if (c) ctl.appendChild(c);
  row.appendChild(ctl);
  return row;
}

// ── Kind-specific destination fields ───────────────────────────────────────
// Returns an array of elements to be appended after the kind selector.

function _buildDestFields(m, out) {
  if (out.kind === 'grain') {
    return _buildGrainFields(m, out);
  }
  if (out.kind === 'cursor') {
    return _buildCursorFields(m, out);
  }
  if (out.kind === 'midi') {
    return _buildMidiFields(m, out);
  }
  if (out.kind === 'osc') {
    return _buildOscFields(m, out);
  }
  return [];
}

function _buildGrainFields(m, out) {
  const paramSel = _select(
    MAPPABLE_PARAMS.map(p => ({ value: p.key, label: p.label })),
    out.param || m.targetParam
  );
  paramSel.className = 'set-select';
  paramSel.title = 'target grain parameter';
  paramSel.addEventListener('change', () => {
    const paramDef = MAPPABLE_PARAMS.find(p => p.key === paramSel.value);
    updateMapping(m.id, {
      output:    { kind: 'grain', param: paramSel.value },
      outputMin: paramDef?.min ?? 0,
      outputMax: paramDef?.max ?? 1,
    });
    _renderList();
  });
  return [paramSel];
}

function _buildCursorFields(m, out) {
  const axisSel = _select(
    MAPPABLE_CURSOR_AXES.map(a => ({ value: a.key, label: a.label })),
    out.param || 'elevation'
  );
  axisSel.className = 'set-select';
  axisSel.title = 'target cursor axis — sets that axis to "mapped"';
  axisSel.addEventListener('change', () => {
    const def = MAPPABLE_CURSOR_AXES.find(a => a.key === axisSel.value);
    updateMapping(m.id, {
      output:    { kind: 'cursor', param: axisSel.value },
      outputMin: def?.min ?? -90,
      outputMax: def?.max ?? 90,
    });
    _armCursorAxis(axisSel.value);
    _renderList();
  });
  return [axisSel];
}

function _buildMidiFields(m, out) {
  const devices = listOutputs();
  // Device dropdown. Current device id might not be in the list (not yet
  // connected) — keep it as an option with a placeholder label so selection
  // survives a disconnect.
  const devOpts = devices.map(d => ({ value: d.id, label: _shortenName(d.name) }));
  if (out.deviceId && !devices.find(d => d.id === out.deviceId)) {
    devOpts.unshift({ value: out.deviceId, label: '(disconnected)' });
  }
  if (devOpts.length === 0) {
    devOpts.push({ value: '', label: '(no devices)' });
  }
  const devSel = _select(devOpts, out.deviceId || devOpts[0].value);
  devSel.className = 'set-select';
  devSel.title = 'MIDI output device';
  devSel.addEventListener('change', () => {
    updateMapping(m.id, { output: { ...out, deviceId: devSel.value } });
  });
  _midiDeviceSelects.set(m.id, devSel);

  // Channel box (1-16)
  const chBox = _numbox(out.channel || 1, 'ch');
  chBox.input.title = 'MIDI channel (1–16)';
  chBox.input.addEventListener('change', () => {
    const v = parseInt(chBox.input.value, 10);
    if (Number.isInteger(v) && v >= 1 && v <= 16) {
      updateMapping(m.id, { output: { ...out, channel: v } });
      _renderList();
    } else {
      chBox.input.value = out.channel || 1;
    }
  });

  // CC number (0-127, or 0-95 for 14-bit)
  const ccBox = _numbox(out.cc ?? 20, 'cc');
  ccBox.input.title = 'MIDI CC number';
  ccBox.input.addEventListener('change', () => {
    const v = parseInt(ccBox.input.value, 10);
    const ceiling = out.bits === 14 ? 95 : 127;
    if (Number.isInteger(v) && v >= 0 && v <= ceiling) {
      updateMapping(m.id, { output: { ...out, cc: v } });
      _renderList();
    } else {
      ccBox.input.value = out.cc ?? 20;
    }
  });

  // Resolution is its own row (it rewrites the output range), not a control here.
  return [devSel, chBox, ccBox];
}

function _buildOscFields(m, out) {
  // Address only. Host and port are the PAGE's — four rows each carrying a host
  // is four places to fix one typo — and live in the OSC output row above.
  const addrIn = _field('text', out.address || '', '', 'set-field--wide');
  addrIn.input.title = 'OSC address (must start with /)';
  // Default and placeholder only — an address already saved in a mapping is the
  // player's and is never rewritten (staging died 2026-08-30; this string was
  // the last thing in the app still named after it).
  addrIn.input.placeholder = '/mubone/out';
  addrIn.input.addEventListener('change', () => {
    let v = addrIn.input.value.trim();
    if (v && !v.startsWith('/')) v = '/' + v;
    if (v) { updateMapping(m.id, { output: { ...out, address: v } }); _renderList(); }
  });
  return [addrIn];
}

/** Point every OSC row at the page's host and port.
 *
 *  The rows still CARRY host/port — the evaluator in sensor-mapping.js reads
 *  out.host / out.port and nothing outside this page changes — but there is one
 *  place to type them, and a row can no longer be quietly pointed somewhere
 *  else. New rows inherit the same values through _defaultDestForKind(). */
function _applyOscEndpoint() {
  for (const m of getMappings()) {
    const out = m.output;
    if (out?.kind !== 'osc') continue;
    if (out.host === _global.oscHost && out.port === _global.oscPort) continue;
    updateMapping(m.id, { output: { ...out, host: _global.oscHost, port: _global.oscPort } });
  }
}

// ── Output range: shared for all kinds, but with kind-aware unit/bounds ────

function _buildOutputRange(m, out) {
  let unit = '';
  if (out.kind === 'grain') {
    unit = MAPPABLE_PARAMS.find(p => p.key === (out.param || m.targetParam))?.unit || '';
  }

  const outMin = _numbox(m.outputMin, unit);
  outMin.input.title = 'output min';
  outMin.input.addEventListener('change', () => {
    const v = parseFloat(outMin.input.value);
    if (!isNaN(v)) { updateMapping(m.id, { outputMin: v }); _renderList(); }
  });
  const outMax = _numbox(m.outputMax, unit);
  outMax.input.title = 'output max';
  outMax.input.addEventListener('change', () => {
    const v = parseFloat(outMax.input.value);
    if (!isNaN(v)) { updateMapping(m.id, { outputMax: v }); _renderList(); }
  });
  return { outMin, outMax };
}

// ── Test-send button ───────────────────────────────────────────────────────
// Fires a one-shot send at the row's outputMax so the user can verify the
// destination is reachable without having to rotate the sensor.

function _buildTestButton(m, out) {
  const btn = _el('button', 'set-btn set-btn--sm', 'Test');
  btn.title = 'test send (fires at output max)';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const value = Number.isFinite(m.outputMax) ? m.outputMax : 0;
    let status;
    if (out.kind === 'midi') {
      status = midiTestSend(out.deviceId, out.channel, out.cc, value, { bits: out.bits });
    } else if (out.kind === 'osc') {
      status = oscTestSend(out.host, out.port, out.address, [value]);
    }
    // Briefly flash the button color based on outcome.
    const color = TX_COLORS[status] || TX_COLORS.idle;
    btn.style.color = color;
    setTimeout(() => { btn.style.color = ''; }, 500);
  });
  return btn;
}



// ── DOM helpers ────────────────────────────────────────────────────────────

function _el(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function _select(options, selected) {
  const sel = document.createElement('select');
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (String(opt.value) === String(selected)) o.selected = true;
    sel.appendChild(o);
  }
  return sel;
}

function _numbox(value, unit) {
  let txt;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Math.abs(value) >= 100)     txt = String(Math.round(value));
    else if (Math.abs(value) >= 1)  txt = value.toFixed(1);
    else                            txt = value.toFixed(3);
  } else {
    txt = String(value ?? '');
  }
  return _field('text', txt, unit);
}

/** The kit's field. A unit that is a numeric SUFFIX of the value (90°, 127)
 *  belongs INSIDE the box, after the number — the `.as-dim` order:-1 rule is
 *  for a unit that NAMES what a control measures ("frames"), which is read
 *  before the control rather than as part of its value. Returns the wrapper,
 *  with the real input on `.input` so every listener still binds to the
 *  element that carries the value. */
function _field(type, value, unit, extraCls) {
  const wrap = _el('span', 'set-field' + (extraCls ? ' ' + extraCls : ''));
  const input = document.createElement('input');
  input.type = type;
  input.value = String(value ?? '');
  wrap.appendChild(input);
  if (unit) wrap.appendChild(_el('span', 'set-field-unit', unit));
  wrap.input = input;
  return wrap;
}

// Trim long device names so the MIDI device dropdown stays readable.
function _shortenName(name) {
  if (!name) return '(unnamed)';
  if (name.length <= 22) return name;
  return name.slice(0, 20) + '…';
}
