// ============================================================================
// ui-sensor-mapping.js — Mapping modal UI
//
// Renders the mapping list, handles add/remove/edit interactions, wires the
// modal open/close button, and syncs the UI when mappings change externally
// (e.g. via OSC toggle).
//
// Extended for staging Change A (v1.2-alpha): each row's destination picker is
// now two-level — first a "kind" selector (grain / MIDI CC / OSC), then the
// kind-specific destination fields. A transport banner at the top of the modal
// shows live availability of MIDI/OSC transports and lets the user edit the
// default OSC host/port. Each row carries a small tx status indicator + last
// error tooltip so the performer can troubleshoot without opening DevTools.
// ============================================================================

import { S } from './state.js';
import {
  getMappings, addMapping, updateMapping, removeMapping, toggleMapping,
  MAPPABLE_PARAMS, AXIS_DEFS, applyCurve, clearAllMappings, getCursorEuler,
  getMappingTelemetry, getTransportStatus,
} from './sensor-mapping.js';
import {
  initMIDIOut, isMIDIOutAvailable, isMIDIOutInitialized, listOutputs,
  onStateChange as onMIDIStateChange, testSend as midiTestSend,
} from './midi-out.js';
import { isOSCOutAvailable, testSend as oscTestSend } from './osc-out.js';

// ── Output kind registry ───────────────────────────────────────────────────
// Each kind knows how to describe itself, what default destination to
// synthesise when the user switches to it, and how to render destination
// fields. Keeps _buildRow from becoming a giant conditional tree.
const OUTPUT_KINDS = [
  { value: 'grain', label: 'grain' },
  { value: 'midi',  label: 'MIDI CC' },
  { value: 'osc',   label: 'OSC' },
];

// Default destination hydration when user switches a row's kind.
function _defaultDestForKind(kind) {
  if (kind === 'grain') return { kind: 'grain', param: 'hpfFreq' };
  if (kind === 'midi')  return { kind: 'midi',  deviceId: '', channel: 1, cc: 20, bits: 7 };
  if (kind === 'osc')   return { kind: 'osc',   host: _defaultOscHost(), port: _defaultOscPort(), address: '/staging/out' };
  return { kind: 'grain', param: 'hpfFreq' };
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
const AXIS_OPTIONS = [
  { value: 'roll',      label: 'Roll',           min: -90,  max:  90 },
  { value: 'elevation', label: 'Elevation',      min: -90,  max:  90 },
  { value: 'azimuth',   label: 'Azimuth',        min: -180, max: 180 },
  { value: 'mapping1',  label: 'OSC /mapping1',  min:  -1,  max:   1 },
  { value: 'mapping2',  label: 'OSC /mapping2',  min:  -1,  max:   1 },
  { value: 'mapping3',  label: 'OSC /mapping3',  min:  -1,  max:   1 },
];

// ── Curve presets ──────────────────────────────────────────────────────────
const CURVE_OPTIONS = [
  { value: 'linear', label: '— linear',  exp: 1.0 },
  { value: 'log',    label: '⌒ log',     exp: 2.0 },
  { value: 'exp',    label: '⌓ exp',     exp: 2.0 },
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

// Tx indicator colors — green = sent recently, yellow = deduped/throttled (OK
// but nothing on the wire this frame), red = error, grey = idle.
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
  const s = telemetry?.lastTxStatus;
  const fresh = telemetry?.lastTxAt && (now - telemetry.lastTxAt < 600);
  const color = (s && fresh) ? (TX_COLORS[s] || TX_COLORS.idle) : TX_COLORS.idle;
  entry.tx.style.color = color;
  if (telemetry?.lastError) {
    entry.tx.title = `${s || 'idle'} — ${telemetry.lastError}`;
  } else if (s) {
    entry.tx.title = s;
  } else {
    entry.tx.title = 'idle';
  }
}

function _updateLiveValues() {
  if (_liveSpans.length === 0) return;

  const euler = getCursorEuler();
  const mappings = getMappings();

  for (const entry of _liveSpans) {
    const m = mappings.find(x => x.id === entry.mappingId);
    if (!m) continue;

    // Raw axis value
    const axisDef = AXIS_DEFS[m.axis];
    if (!axisDef) {
      entry.raw.textContent = '—';
      entry.scaled.textContent = '—';
      continue;
    }
    const raw = axisDef.read(euler);
    entry.raw.textContent = _fmtRawForAxis(axisDef, raw);

    // Scaled output preview
    const range = m.inputMax - m.inputMin;
    if (Math.abs(range) < 0.001) {
      entry.scaled.textContent = '—';
    } else {
      const t = Math.max(0, Math.min(1, (raw - m.inputMin) / range));
      const curved = applyCurve(t, m.curveType, m.curveExp);
      const value = _previewScaledForRow(m, curved);
      entry.scaled.textContent = _fmtValueForDisplay(value);
    }

    // Tx indicator
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
  // the modal is open so the new device shows up immediately.
  onMIDIStateChange(() => {
    if (modal.classList.contains('open')) _renderList();
  });

  // Open/close modal
  btn.addEventListener('click', () => {
    modal.classList.toggle('open');
    if (modal.classList.contains('open')) {
      // Proactively kick off MIDI access so the device dropdown is populated
      // before the user opens a MIDI row. initMIDIOut() is idempotent.
      initMIDIOut().then(() => {
        if (modal.classList.contains('open')) _renderList();
      });
      _renderList();
      _startLiveLoop();
    } else {
      _stopLiveLoop();
    }
  });
  if (close) close.addEventListener('click', () => { modal.classList.remove('open'); _stopLiveLoop(); });
  modal.addEventListener('click', e => { if (e.target === modal) { modal.classList.remove('open'); _stopLiveLoop(); } });

  // Add mapping button — defaults to a grain row with the first unused grain
  // param; if all are used, falls back to adding a fresh MIDI row so the user
  // isn't stuck.
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
      // All grain params mapped — add a fresh MIDI row so the user can keep
      // expanding the mapping list for external control.
      addMapping({
        output:    { kind: 'midi', deviceId: '', channel: 1, cc: 20, bits: 7 },
        outputMin: 0,
        outputMax: 127,
      });
    }
    _renderList();
  });

  // Clear all button
  if (clearBtn) clearBtn.addEventListener('click', () => {
    clearAllMappings();
    _renderList();
  });

  // Sync callback — called when mappings change externally (toggle via OSC/MIDI)
  S._syncMappingUI = () => {
    if (modal.classList.contains('open')) _renderList();
  };

  // Initial render
  _renderList();
}

// ── Render the mapping list ────────────────────────────────────────────────

function _renderList() {
  const container = document.getElementById('sensorMappingList');
  if (!container) return;

  _liveSpans = [];  // reset live span refs
  _midiDeviceSelects = new Map();

  container.innerHTML = '';

  // Transport banner sits above the list — status of MIDI + OSC transports
  // and editable global OSC host/port defaults.
  container.appendChild(_buildTransportBanner());

  const mappings = getMappings();
  if (mappings.length === 0) {
    const empty = _el('div', 'mapping-empty', 'no mappings — press + to add one');
    container.appendChild(empty);
    return;
  }

  for (const m of mappings) {
    container.appendChild(_buildRow(m));
  }
}

// ── Transport banner ───────────────────────────────────────────────────────
// Shows MIDI + OSC transport state and lets the user set global defaults for
// new OSC rows. Also exposes a button to trigger WebMIDI permission when the
// browser hasn't granted it yet.

function _buildTransportBanner() {
  const banner = _el('div', 'mapping-transport-banner');

  // ── MIDI side ──
  const midiSide = _el('div', 'mapping-transport-side');
  const midiLabel = _el('span', 'mapping-transport-label', 'MIDI');
  const midiDot = _el('span', 'mapping-transport-dot', '●');
  const midiStatus = _el('span', 'mapping-transport-status', '');
  const midiInitBtn = _el('button', 'mapping-transport-btn', 'request access');
  midiInitBtn.title = 'request WebMIDI access from the browser';
  midiInitBtn.addEventListener('click', () => {
    initMIDIOut().then(() => _renderList());
  });
  midiSide.appendChild(midiLabel);
  midiSide.appendChild(midiDot);
  midiSide.appendChild(midiStatus);
  if (!isMIDIOutInitialized()) midiSide.appendChild(midiInitBtn);

  // ── OSC side ──
  const oscSide = _el('div', 'mapping-transport-side');
  const oscLabel = _el('span', 'mapping-transport-label', 'OSC');
  const oscDot = _el('span', 'mapping-transport-dot', '●');
  const oscStatus = _el('span', 'mapping-transport-status', '');
  oscSide.appendChild(oscLabel);
  oscSide.appendChild(oscDot);
  oscSide.appendChild(oscStatus);

  // Default host / port inputs (apply to new OSC rows, don't retroactively
  // change existing rows).
  const hostIn = _el('input', 'mapping-numbox mapping-osc-host');
  hostIn.type = 'text';
  hostIn.value = _defaultOscHost();
  hostIn.title = 'default host for new OSC rows';
  hostIn.placeholder = '127.0.0.1';
  hostIn.addEventListener('change', () => {
    _global.oscHost = hostIn.value.trim() || '127.0.0.1';
    _saveGlobal();
  });
  const portIn = _el('input', 'mapping-numbox');
  portIn.type = 'text';
  portIn.value = _defaultOscPort();
  portIn.title = 'default port for new OSC rows';
  portIn.placeholder = '9000';
  portIn.addEventListener('change', () => {
    const v = parseInt(portIn.value, 10);
    if (Number.isInteger(v) && v > 0 && v <= 65535) {
      _global.oscPort = v;
      _saveGlobal();
    } else {
      portIn.value = _defaultOscPort();  // reject invalid
    }
  });
  oscSide.appendChild(_el('span', 'mapping-transport-sep', 'default'));
  oscSide.appendChild(hostIn);
  oscSide.appendChild(_el('span', 'mapping-dash', ':'));
  oscSide.appendChild(portIn);

  banner.appendChild(midiSide);
  banner.appendChild(oscSide);

  _bannerRefs = { midiDot, midiStatus, oscDot, oscStatus };
  _updateBanner();
  // Poll transport status at 2Hz — device connect/disconnect also fires
  // onMIDIStateChange, but the OSC side has no event stream and needs polling.
  if (_bannerTick) clearInterval(_bannerTick);
  _bannerTick = setInterval(_updateBanner, 500);

  return banner;
}

function _updateBanner() {
  if (!_bannerRefs) return;
  const s = getTransportStatus();

  _bannerRefs.midiDot.style.color = s.midi ? TX_COLORS.sent : TX_COLORS.idle;
  if (!isMIDIOutInitialized()) {
    _bannerRefs.midiStatus.textContent = 'not requested';
  } else if (!s.midi) {
    _bannerRefs.midiStatus.textContent = 'no outputs';
  } else {
    const outs = listOutputs();
    _bannerRefs.midiStatus.textContent = outs.length === 1
      ? outs[0].name
      : `${outs.length} devices`;
  }

  _bannerRefs.oscDot.style.color = s.osc ? TX_COLORS.sent : TX_COLORS.unavailable;
  _bannerRefs.oscStatus.textContent = s.osc ? 'ready' : 'electron only';
}

// ── Build a single mapping row ─────────────────────────────────────────────

function _buildRow(m) {
  const out = m.output || { kind: 'grain', param: m.targetParam };
  const row = document.createElement('div');
  row.className = 'mapping-row' + (m.enabled ? '' : ' mapping-disabled') + ` mapping-kind-${out.kind}`;
  row.dataset.id = m.id;

  // ── Toggle enable button ──
  const toggleBtn = _el('button', 'mapping-toggle-btn', m.enabled ? '●' : '○');
  toggleBtn.title = m.enabled ? 'disable this mapping' : 'enable this mapping';
  toggleBtn.addEventListener('click', () => {
    toggleMapping(m.id);
    _renderList();
  });

  // ── Axis selector ──
  const axisSel = _select(AXIS_OPTIONS.map(a => ({ value: a.value, label: a.label })), m.axis);
  axisSel.className = 'mapping-sel mapping-axis-sel';
  axisSel.title = 'sensor axis';
  axisSel.addEventListener('change', () => {
    updateMapping(m.id, { axis: axisSel.value });
    _renderList();
  });

  // ── Input range: min/max ──
  const axisOpt = AXIS_OPTIONS.find(a => a.value === m.axis);
  const axisUnitHint = axisOpt && (axisOpt.value === 'roll' || axisOpt.value === 'elevation' || axisOpt.value === 'azimuth')
    ? '°' : '';
  const inMin = _numbox(m.inputMin, axisUnitHint, -180, 180);
  inMin.title = 'input min';
  inMin.addEventListener('change', () => {
    const v = parseFloat(inMin.value);
    if (!isNaN(v)) updateMapping(m.id, { inputMin: v });
  });
  const inMax = _numbox(m.inputMax, axisUnitHint, -180, 180);
  inMax.title = 'input max';
  inMax.addEventListener('change', () => {
    const v = parseFloat(inMax.value);
    if (!isNaN(v)) updateMapping(m.id, { inputMax: v });
  });

  // ── Range visualization bar (thin horizontal strip) ──
  const rangeBar = _el('div', 'mapping-range-bar');
  const rangeFill = _el('div', 'mapping-range-fill');
  const axisMin = axisOpt ? axisOpt.min : -1;
  const axisMax = axisOpt ? axisOpt.max :  1;
  const fillL = ((m.inputMin - axisMin) / (axisMax - axisMin)) * 100;
  const fillR = ((m.inputMax - axisMin) / (axisMax - axisMin)) * 100;
  rangeFill.style.left  = Math.max(0, Math.min(100, fillL)) + '%';
  rangeFill.style.width = Math.max(0, Math.min(100, fillR - fillL)) + '%';
  rangeBar.appendChild(rangeFill);

  // ── Live raw axis readout ──
  const liveRaw = _el('span', 'mapping-live mapping-live-raw', '—');
  liveRaw.title = 'live axis reading';

  // ── Arrow ──
  const arrow = _el('span', 'mapping-arrow', '→');

  // ── Output-kind selector ──
  const kindSel = _select(OUTPUT_KINDS, out.kind);
  kindSel.className = 'mapping-sel mapping-kind-sel';
  kindSel.title = 'output kind';
  kindSel.addEventListener('change', () => {
    const newKind = kindSel.value;
    const newOut = _defaultDestForKind(newKind);
    const range = _defaultOutputRangeForKind(newKind, newOut);
    updateMapping(m.id, { output: newOut, outputMin: range.outputMin, outputMax: range.outputMax });
    _renderList();
  });

  // ── Kind-specific destination fields ──
  const destFields = _buildDestFields(m, out);

  // ── Output range: min/max ──
  const { outMin, outMax, dash } = _buildOutputRange(m, out);

  // ── Curve selector ──
  const curveSel = _select(CURVE_OPTIONS.map(c => ({ value: c.value, label: c.label })), m.curveType);
  curveSel.className = 'mapping-sel mapping-curve-sel';
  curveSel.title = 'curve shape';
  curveSel.addEventListener('change', () => {
    const preset = CURVE_OPTIONS.find(c => c.value === curveSel.value);
    updateMapping(m.id, { curveType: curveSel.value, curveExp: preset?.exp ?? 1.0 });
    _renderList();
  });

  // ── Curve exponent numbox ──
  const expBox = _numbox(m.curveExp, '', 0.1, 10);
  expBox.className = 'mapping-numbox mapping-exp-box';
  expBox.title = 'curve exponent';
  expBox.addEventListener('change', () => {
    const v = parseFloat(expBox.value);
    if (!isNaN(v)) updateMapping(m.id, { curveExp: Math.max(0.1, Math.min(10, v)) });
    _renderList();
  });

  // ── Mini curve canvas ──
  const curveCanvas = _el('canvas', 'mapping-curve-canvas');
  curveCanvas.width = 32;
  curveCanvas.height = 20;
  _drawCurve(curveCanvas, m.curveType, m.curveExp);

  // ── Live scaled output readout ──
  const liveScaled = _el('span', 'mapping-live mapping-live-scaled', '—');
  liveScaled.title = 'live scaled output';

  // ── Tx indicator (small dot, color = last status) ──
  const txDot = _el('span', 'mapping-tx-dot', '●');
  txDot.title = 'transport status';
  txDot.style.color = TX_COLORS.idle;

  // ── Test-send button (kind-specific; hidden for grain) ──
  const testBtn = (out.kind === 'midi' || out.kind === 'osc')
    ? _buildTestButton(m, out)
    : null;

  // Register live updates
  _liveSpans.push({ raw: liveRaw, scaled: liveScaled, mappingId: m.id, tx: txDot });

  // ── Remove button ──
  const removeBtn = _el('button', 'mapping-remove-btn', '✕');
  removeBtn.title = 'remove this mapping';
  removeBtn.addEventListener('click', () => {
    removeMapping(m.id);
    _renderList();
  });

  // ── Assemble row ──
  row.appendChild(toggleBtn);
  row.appendChild(axisSel);
  row.appendChild(inMin);
  row.appendChild(rangeBar);
  row.appendChild(inMax);
  row.appendChild(liveRaw);
  row.appendChild(arrow);
  row.appendChild(kindSel);
  for (const el of destFields) row.appendChild(el);
  row.appendChild(outMin);
  row.appendChild(dash);
  row.appendChild(outMax);
  row.appendChild(curveSel);
  row.appendChild(expBox);
  row.appendChild(curveCanvas);
  row.appendChild(liveScaled);
  row.appendChild(txDot);
  if (testBtn) row.appendChild(testBtn);
  row.appendChild(removeBtn);

  return row;
}

// ── Kind-specific destination fields ───────────────────────────────────────
// Returns an array of elements to be appended after the kind selector.

function _buildDestFields(m, out) {
  if (out.kind === 'grain') {
    return _buildGrainFields(m, out);
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
  paramSel.className = 'mapping-sel mapping-param-sel';
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
  devSel.className = 'mapping-sel mapping-midi-dev-sel';
  devSel.title = 'MIDI output device';
  devSel.addEventListener('change', () => {
    updateMapping(m.id, { output: { ...out, deviceId: devSel.value } });
  });
  _midiDeviceSelects.set(m.id, devSel);

  // Channel box (1-16)
  const chBox = _numbox(out.channel || 1, '', 1, 16);
  chBox.className = 'mapping-numbox mapping-midi-ch';
  chBox.title = 'MIDI channel (1–16)';
  chBox.addEventListener('change', () => {
    const v = parseInt(chBox.value, 10);
    if (Number.isInteger(v) && v >= 1 && v <= 16) {
      updateMapping(m.id, { output: { ...out, channel: v } });
    } else {
      chBox.value = out.channel || 1;
    }
  });

  // CC number (0-127, or 0-95 for 14-bit)
  const ccBox = _numbox(out.cc ?? 20, '', 0, 127);
  ccBox.className = 'mapping-numbox mapping-midi-cc';
  ccBox.title = 'MIDI CC number';
  ccBox.addEventListener('change', () => {
    const v = parseInt(ccBox.value, 10);
    const ceiling = out.bits === 14 ? 95 : 127;
    if (Number.isInteger(v) && v >= 0 && v <= ceiling) {
      updateMapping(m.id, { output: { ...out, cc: v } });
    } else {
      ccBox.value = out.cc ?? 20;
    }
  });

  // Bits selector (7 / 14)
  const bitsSel = _select(
    [{ value: '7', label: '7-bit' }, { value: '14', label: '14-bit' }],
    String(out.bits || 7)
  );
  bitsSel.className = 'mapping-sel mapping-midi-bits';
  bitsSel.title = 'MIDI CC resolution';
  bitsSel.addEventListener('change', () => {
    const bits = parseInt(bitsSel.value, 10) === 14 ? 14 : 7;
    const range = _defaultOutputRangeForKind('midi', { bits });
    updateMapping(m.id, {
      output: { ...out, bits },
      outputMin: range.outputMin,
      outputMax: range.outputMax,
    });
    _renderList();
  });

  return [devSel, chBox, ccBox, bitsSel];
}

function _buildOscFields(m, out) {
  const hostIn = _el('input', 'mapping-numbox mapping-osc-host');
  hostIn.type = 'text';
  hostIn.value = out.host || '';
  hostIn.title = 'OSC destination host';
  hostIn.placeholder = _defaultOscHost();
  hostIn.addEventListener('change', () => {
    const v = hostIn.value.trim();
    if (v) updateMapping(m.id, { output: { ...out, host: v } });
  });

  const portIn = _numbox(out.port ?? _defaultOscPort(), '', 1, 65535);
  portIn.className = 'mapping-numbox mapping-osc-port';
  portIn.title = 'OSC destination port';
  portIn.addEventListener('change', () => {
    const v = parseInt(portIn.value, 10);
    if (Number.isInteger(v) && v > 0 && v <= 65535) {
      updateMapping(m.id, { output: { ...out, port: v } });
    } else {
      portIn.value = out.port ?? _defaultOscPort();
    }
  });

  const addrIn = _el('input', 'mapping-numbox mapping-osc-addr');
  addrIn.type = 'text';
  addrIn.value = out.address || '';
  addrIn.title = 'OSC address (must start with /)';
  addrIn.placeholder = '/staging/out';
  addrIn.addEventListener('change', () => {
    let v = addrIn.value.trim();
    if (v && !v.startsWith('/')) v = '/' + v;
    if (v) updateMapping(m.id, { output: { ...out, address: v } });
  });

  return [hostIn, portIn, addrIn];
}

// ── Output range: shared for all kinds, but with kind-aware unit/bounds ────

function _buildOutputRange(m, out) {
  let unit = '';
  let min, max;
  if (out.kind === 'grain') {
    const paramDef = MAPPABLE_PARAMS.find(p => p.key === (out.param || m.targetParam));
    unit = paramDef?.unit || '';
    min = paramDef?.min;
    max = paramDef?.max;
  } else if (out.kind === 'midi') {
    unit = '';
    min = 0;
    max = out.bits === 14 ? 16383 : 127;
  } else if (out.kind === 'osc') {
    unit = '';
    // OSC has no canonical range — leave bounds open-ended.
    min = undefined;
    max = undefined;
  }

  const outMin = _numbox(m.outputMin, unit, min, max);
  outMin.title = 'output min';
  outMin.addEventListener('change', () => {
    const v = parseFloat(outMin.value);
    if (!isNaN(v)) updateMapping(m.id, { outputMin: v });
  });
  const outMax = _numbox(m.outputMax, unit, min, max);
  outMax.title = 'output max';
  outMax.addEventListener('change', () => {
    const v = parseFloat(outMax.value);
    if (!isNaN(v)) updateMapping(m.id, { outputMax: v });
  });
  return { outMin, outMax, dash: _el('span', 'mapping-dash', '–') };
}

// ── Test-send button ───────────────────────────────────────────────────────
// Fires a one-shot send at the row's outputMax so the user can verify the
// destination is reachable without having to rotate the sensor.

function _buildTestButton(m, out) {
  const btn = _el('button', 'mapping-test-btn', '▸');
  btn.title = 'test send (fires at outputMax)';
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

// ── Draw curve preview ─────────────────────────────────────────────────────

function _drawCurve(canvas, curveType, exp) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, 0, w, h);

  // Curve line
  ctx.strokeStyle = '#4fc3f7';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let px = 0; px <= w; px++) {
    const t = px / w;
    let y;
    if (curveType === 'log')      y = Math.pow(t, 1 / Math.max(0.1, exp));
    else if (curveType === 'exp') y = Math.pow(t, Math.max(0.1, exp));
    else                          y = t;
    const py = h - y * h;
    if (px === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
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

function _numbox(value, unit, min, max) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'mapping-numbox';
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Math.abs(value) >= 100)      input.value = Math.round(value);
    else if (Math.abs(value) >= 1)   input.value = value.toFixed(1);
    else                              input.value = value.toFixed(3);
  } else {
    input.value = String(value ?? '');
  }
  return input;
}

// Trim long device names so the MIDI device dropdown stays readable.
function _shortenName(name) {
  if (!name) return '(unnamed)';
  if (name.length <= 22) return name;
  return name.slice(0, 20) + '…';
}
