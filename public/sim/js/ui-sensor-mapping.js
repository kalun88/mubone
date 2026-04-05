// ============================================================================
// ui-sensor-mapping.js — Mapping modal UI
//
// Renders the mapping list, handles add/remove/edit interactions, wires the
// modal open/close button, and syncs the UI when mappings change externally
// (e.g. via OSC toggle).
// ============================================================================

import { S } from './state.js';
import {
  getMappings, addMapping, updateMapping, removeMapping, toggleMapping,
  MAPPABLE_PARAMS, AXIS_DEFS, applyCurve, clearAllMappings, getCursorEuler
} from './sensor-mapping.js';

// ── Axis options ───────────────────────────────────────────────────────────
const AXIS_OPTIONS = [
  { value: 'roll',      label: 'Roll' },
  { value: 'elevation', label: 'Elevation' },
  { value: 'azimuth',   label: 'Azimuth' },
];

// ── Curve presets ──────────────────────────────────────────────────────────
const CURVE_OPTIONS = [
  { value: 'linear', label: '— linear',  exp: 1.0 },
  { value: 'log',    label: '⌒ log',     exp: 2.0 },
  { value: 'exp',    label: '⌓ exp',     exp: 2.0 },
];

// ── Live readout loop ─────────────────────────────────────────────────────
// Runs only while the modal is open.  Updates raw axis + scaled output spans
// at ~30fps so the user can see sensor values while setting input ranges.

let _rafId = null;
let _liveSpans = [];   // [ { raw: <span>, scaled: <span>, mappingId: string }, ... ]

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
    entry.raw.textContent = raw.toFixed(1) + '°';

    // Scaled output value (same logic as tickMappings)
    const range = m.inputMax - m.inputMin;
    if (Math.abs(range) < 0.001) { entry.scaled.textContent = '—'; continue; }
    const t = Math.max(0, Math.min(1, (raw - m.inputMin) / range));
    const curved = applyCurve(t, m.curveType, m.curveExp);

    const paramDef = MAPPABLE_PARAMS.find(p => p.key === m.targetParam);
    let value;
    if (paramDef?.log) {
      const logMin = Math.log(Math.max(1e-6, m.outputMin));
      const logMax = Math.log(Math.max(1e-6, m.outputMax));
      value = Math.exp(logMin + curved * (logMax - logMin));
    } else {
      value = m.outputMin + curved * (m.outputMax - m.outputMin);
    }
    if (paramDef) value = Math.max(paramDef.min, Math.min(paramDef.max, value));

    // Format output value with sensible precision
    if (Math.abs(value) >= 100)     entry.scaled.textContent = Math.round(value);
    else if (Math.abs(value) >= 1)  entry.scaled.textContent = value.toFixed(1);
    else                            entry.scaled.textContent = value.toFixed(3);
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

  // Open/close modal
  btn.addEventListener('click', () => {
    modal.classList.toggle('open');
    if (modal.classList.contains('open')) {
      _renderList();
      _startLiveLoop();
    } else {
      _stopLiveLoop();
    }
  });
  if (close) close.addEventListener('click', () => { modal.classList.remove('open'); _stopLiveLoop(); });
  modal.addEventListener('click', e => { if (e.target === modal) { modal.classList.remove('open'); _stopLiveLoop(); } });

  // Add mapping button
  if (addBtn) addBtn.addEventListener('click', () => {
    // Find a target param not yet mapped
    const used = new Set(getMappings().map(m => m.targetParam));
    const available = MAPPABLE_PARAMS.find(p => !used.has(p.key));
    if (!available) return;  // all params mapped
    const m = addMapping({
      targetParam: available.key,
      outputMin:   available.min,
      outputMax:   available.max,
    });
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

  const mappings = getMappings();
  if (mappings.length === 0) {
    container.innerHTML = '<div class="mapping-empty">no mappings — press + to add one</div>';
    return;
  }

  container.innerHTML = '';
  for (const m of mappings) {
    container.appendChild(_buildRow(m));
  }
}

// ── Build a single mapping row ─────────────────────────────────────────────

function _buildRow(m) {
  const row = document.createElement('div');
  row.className = 'mapping-row' + (m.enabled ? '' : ' mapping-disabled');
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
  });

  // ── Input range: min/max ──
  const inMin = _numbox(m.inputMin, '°', -180, 180);
  inMin.title = 'input min (degrees)';
  inMin.addEventListener('change', () => {
    const v = parseFloat(inMin.value);
    if (!isNaN(v)) updateMapping(m.id, { inputMin: v });
  });
  const inMax = _numbox(m.inputMax, '°', -180, 180);
  inMax.title = 'input max (degrees)';
  inMax.addEventListener('change', () => {
    const v = parseFloat(inMax.value);
    if (!isNaN(v)) updateMapping(m.id, { inputMax: v });
  });

  // ── Range visualization bar (thin horizontal strip) ──
  const rangeBar = _el('div', 'mapping-range-bar');
  const rangeFill = _el('div', 'mapping-range-fill');
  // Position fill within bar based on inputMin/inputMax relative to axis full range
  const axisDef = AXIS_OPTIONS.find(a => a.value === m.axis);
  const axisMin = m.axis === 'azimuth' ? -180 : -90;
  const axisMax = m.axis === 'azimuth' ? 180 : 90;
  const fillL = ((m.inputMin - axisMin) / (axisMax - axisMin)) * 100;
  const fillR = ((m.inputMax - axisMin) / (axisMax - axisMin)) * 100;
  rangeFill.style.left  = Math.max(0, Math.min(100, fillL)) + '%';
  rangeFill.style.width = Math.max(0, Math.min(100, fillR - fillL)) + '%';
  rangeBar.appendChild(rangeFill);

  // ── Live raw axis readout ──
  const liveRaw = _el('span', 'mapping-live mapping-live-raw', '—');
  liveRaw.title = 'live axis reading (degrees)';

  // ── Arrow ──
  const arrow = _el('span', 'mapping-arrow', '→');

  // ── Target param selector ──
  const paramSel = _select(MAPPABLE_PARAMS.map(p => ({ value: p.key, label: p.label })), m.targetParam);
  paramSel.className = 'mapping-sel mapping-param-sel';
  paramSel.title = 'target grain parameter';
  paramSel.addEventListener('change', () => {
    const paramDef = MAPPABLE_PARAMS.find(p => p.key === paramSel.value);
    updateMapping(m.id, {
      targetParam: paramSel.value,
      outputMin: paramDef?.min ?? 0,
      outputMax: paramDef?.max ?? 1,
    });
    _renderList();
  });

  // ── Output range: min/max ──
  const paramDef = MAPPABLE_PARAMS.find(p => p.key === m.targetParam);
  const outMin = _numbox(m.outputMin, paramDef?.unit || '', paramDef?.min, paramDef?.max);
  outMin.title = 'output min';
  outMin.addEventListener('change', () => {
    const v = parseFloat(outMin.value);
    if (!isNaN(v)) updateMapping(m.id, { outputMin: v });
  });
  const outMax = _numbox(m.outputMax, paramDef?.unit || '', paramDef?.min, paramDef?.max);
  outMax.title = 'output max';
  outMax.addEventListener('change', () => {
    const v = parseFloat(outMax.value);
    if (!isNaN(v)) updateMapping(m.id, { outputMax: v });
  });

  // ── Curve selector ──
  const curveSel = _select(CURVE_OPTIONS.map(c => ({ value: c.value, label: c.label })), m.curveType);
  curveSel.className = 'mapping-sel mapping-curve-sel';
  curveSel.title = 'curve shape';
  curveSel.addEventListener('change', () => {
    const preset = CURVE_OPTIONS.find(c => c.value === curveSel.value);
    updateMapping(m.id, { curveType: curveSel.value, curveExp: preset?.exp ?? 1.0 });
  });

  // ── Curve exponent numbox ──
  const expBox = _numbox(m.curveExp, '', 0.1, 10);
  expBox.className = 'mapping-numbox mapping-exp-box';
  expBox.title = 'curve exponent';
  expBox.addEventListener('change', () => {
    const v = parseFloat(expBox.value);
    if (!isNaN(v)) updateMapping(m.id, { curveExp: Math.max(0.1, Math.min(10, v)) });
  });

  // ── Mini curve canvas ──
  const curveCanvas = _el('canvas', 'mapping-curve-canvas');
  curveCanvas.width = 32;
  curveCanvas.height = 20;
  _drawCurve(curveCanvas, m.curveType, m.curveExp);

  // ── Live scaled output readout ──
  const liveScaled = _el('span', 'mapping-live mapping-live-scaled', '—');
  liveScaled.title = 'live scaled output';

  // Register for live updates
  _liveSpans.push({ raw: liveRaw, scaled: liveScaled, mappingId: m.id });

  // ── Remove button ──
  const removeBtn = _el('button', 'mapping-remove-btn', '✕');
  removeBtn.title = 'remove this mapping';
  removeBtn.addEventListener('click', () => {
    removeMapping(m.id);
    _renderList();
  });

  // ── Assemble row ──
  // Layout: [toggle] [axis] [inMin] [rangeBar] [inMax] [rawVal] → [param] [outMin–outMax] [curve] [exp] [canvas] [scaledVal] [✕]
  row.appendChild(toggleBtn);
  row.appendChild(axisSel);
  row.appendChild(inMin);
  row.appendChild(rangeBar);
  row.appendChild(inMax);
  row.appendChild(liveRaw);
  row.appendChild(arrow);
  row.appendChild(paramSel);
  row.appendChild(outMin);
  row.appendChild(_el('span', 'mapping-dash', '–'));
  row.appendChild(outMax);
  row.appendChild(curveSel);
  row.appendChild(expBox);
  row.appendChild(curveCanvas);
  row.appendChild(liveScaled);
  row.appendChild(removeBtn);

  return row;
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
  if (text) el.textContent = text;
  return el;
}

function _select(options, selected) {
  const sel = document.createElement('select');
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === selected) o.selected = true;
    sel.appendChild(o);
  }
  return sel;
}

function _numbox(value, unit, min, max) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'mapping-numbox';
  // Format: show reasonable precision
  if (typeof value === 'number') {
    if (Math.abs(value) >= 100)      input.value = Math.round(value);
    else if (Math.abs(value) >= 1)   input.value = value.toFixed(1);
    else                              input.value = value.toFixed(3);
  }
  return input;
}
