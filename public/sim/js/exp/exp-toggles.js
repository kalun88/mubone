// ============================================================================
// exp-toggles.js — Toggle panel for experimental features
//
// Provides a small collapsible UI for enabling/disabling exp features at
// runtime and adjusting their parameters.  Reads/writes S.paintTicker.*
// (consumed by paint-ticker.js) and future feature flags on S.
//
// Only loaded in ?exp mode via exp-init.js.
// ============================================================================

import { S } from '../state.js';

// ── Registry of toggleable features ─────────────────────────────────────────
// Each entry: { key, label, default, type, min?, max?, step?, unit?, onset? }
//   key     — path under S.paintTicker (or S.<key> for top-level flags)
//   group   — which S sub-object the key lives on (default: 'paintTicker')
//   label   — display name
//   type    — 'bool' | 'range'
//   onset   — optional callback when value changes

const _features = [
  // Drop rate moved to perf monitor (always available, not exp-only).
  // Register new exp-only features here.
];

// ── State read/write helpers ────────────────────────────────────────────────

function _get(group, key) {
  const obj = S[group];
  return obj?.[key];
}

function _set(group, key, value) {
  if (!S[group]) S[group] = {};
  S[group][key] = value;
}

function _getOrDefault(feat) {
  const v = _get(feat.group, feat.key);
  return v ?? feat.default;
}

// ── DOM ─────────────────────────────────────────────────────────────────────

let _panel = null;
let _body = null;
let _visible = true;

function _buildPanel() {
  _panel = document.createElement('div');
  _panel.id = 'exp-toggles';
  _panel.style.cssText = `
    position: fixed; bottom: 8px; left: 8px; z-index: 9998;
    background: rgba(10,15,15,0.92); border: 1px solid rgba(122,188,188,0.2);
    border-radius: 6px; font: 11px/1.4 'Inter', sans-serif; color: #7abcbc;
    min-width: 180px; max-width: 240px; user-select: none;
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  `;

  // Header (click to collapse)
  const hdr = document.createElement('div');
  hdr.style.cssText = `
    padding: 5px 8px; cursor: pointer; display: flex; justify-content: space-between;
    align-items: center; border-bottom: 1px solid rgba(122,188,188,0.12);
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.7;
  `;
  hdr.textContent = 'exp toggles';
  const arrow = document.createElement('span');
  arrow.textContent = '▾';
  arrow.style.transition = 'transform 0.15s';
  hdr.appendChild(arrow);
  hdr.addEventListener('click', () => {
    _visible = !_visible;
    _body.style.display = _visible ? '' : 'none';
    arrow.style.transform = _visible ? '' : 'rotate(-90deg)';
  });
  _panel.appendChild(hdr);

  // Body
  _body = document.createElement('div');
  _body.style.cssText = 'padding: 4px 8px 6px;';
  _panel.appendChild(_body);

  _rebuildRows();
  document.body.appendChild(_panel);
}

function _rebuildRows() {
  _body.innerHTML = '';

  for (const feat of _features) {
    // Conditional visibility
    if (feat.showWhen && !feat.showWhen()) continue;

    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; margin:3px 0; gap:6px;';

    const lbl = document.createElement('span');
    lbl.textContent = feat.label;
    lbl.title = feat.desc || '';
    lbl.style.cssText = 'flex:1; font-size:10px; opacity:0.85; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
    row.appendChild(lbl);

    if (feat.type === 'bool') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = _getOrDefault(feat);
      cb.style.cssText = 'accent-color:#7abcbc; cursor:pointer; margin:0;';
      cb.addEventListener('change', () => {
        _set(feat.group, feat.key, cb.checked);
        feat.onset?.(cb.checked);
        _rebuildRows();  // refresh conditional rows
      });
      row.appendChild(cb);
    } else if (feat.type === 'range') {
      const val = _getOrDefault(feat);
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = feat.min;
      slider.max = feat.max;
      slider.step = feat.step;
      slider.value = val;
      slider.style.cssText = 'width:70px; height:12px; cursor:pointer; accent-color:#7abcbc;';

      const readout = document.createElement('span');
      readout.style.cssText = 'font:10px/1 "Roboto Mono",monospace; min-width:32px; text-align:right; opacity:0.7;';
      readout.textContent = _fmtVal(val, feat);

      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        _set(feat.group, feat.key, v);
        readout.textContent = _fmtVal(v, feat);
        feat.onset?.(v);
      });

      row.appendChild(slider);
      row.appendChild(readout);
    }

    _body.appendChild(row);
  }
}

function _fmtVal(v, feat) {
  const s = feat.step < 1 ? v.toFixed(1) : String(Math.round(v));
  return feat.unit ? s + feat.unit : s;
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Call once from exp-init.js after S.exp = true. */
export function initExpToggles() {
  // Ensure S.paintTicker exists with defaults so paint-ticker reads clean values
  if (!S.paintTicker) S.paintTicker = {};
  for (const feat of _features) {
    if (_get(feat.group, feat.key) === undefined) {
      _set(feat.group, feat.key, feat.default);
    }
  }

  _buildPanel();
  console.log('[exp] toggles panel initialized');
}

/** Register a new feature toggle at runtime.  Returns a remove function. */
export function registerExpToggle(feat) {
  _features.push(feat);
  if (_body) _rebuildRows();
  return () => {
    const idx = _features.indexOf(feat);
    if (idx >= 0) { _features.splice(idx, 1); _rebuildRows(); }
  };
}

// Console shortcut
export function expToggleState() {
  const out = {};
  for (const f of _features) out[f.key] = _getOrDefault(f);
  return out;
}
