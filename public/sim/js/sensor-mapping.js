// ============================================================================
// sensor-mapping.js — Sensor axis → grain parameter mapping engine
//
// Maps IMU orientation axes (roll, elevation, azimuth) to any grain parameter
// override.  Each mapping defines: source axis, input range, curve type +
// exponent, target grain param, output range, and enabled state.
//
// Evaluation runs once per render frame (30Hz) via tickMappings().  Results
// write directly to S.grainOverrides so the grain scheduler picks them up.
//
// Mappings persist globally in localStorage (session-level, not per-preset).
// ============================================================================

import { S } from './state.js';
import { getByRole } from './sensor-registry.js';
import { getCursorLonLat, screenToLonLat } from './sphere.js';

// ── Mapping data model ─────────────────────────────────────────────────────
// Each mapping is a plain object:
// {
//   id:          string    — unique ID (auto-generated)
//   axis:        string    — 'roll' | 'elevation' | 'azimuth'
//   inputMin:    number    — degrees, lower edge of active range
//   inputMax:    number    — degrees, upper edge of active range
//   curveType:   string    — 'linear' | 'log' | 'exp'
//   curveExp:    number    — exponent (1.0 = linear, <1 = log, >1 = exp)
//   targetParam: string    — grain param key (e.g. 'hpfFreq', 'volume', 'pitchShift')
//   outputMin:   number    — param value at inputMin
//   outputMax:   number    — param value at inputMax
//   enabled:     boolean   — can be toggled in performance
// }

// ── Mappable grain params registry ─────────────────────────────────────────
// Each entry describes a param that can be targeted by a mapping.
// label: display name, min/max: valid range, default: bypass value, unit: display suffix.
export const MAPPABLE_PARAMS = [
  { key: 'hpfFreq',         label: 'HPF cutoff',     min: 20,    max: 20000, default: 20,    unit: 'Hz',  log: true },
  { key: 'lpfFreq',         label: 'LPF cutoff',     min: 20,    max: 20000, default: 20000, unit: 'Hz',  log: true },
  { key: 'filterQ',         label: 'filter Q',       min: 0.1,   max: 20,    default: 0.707, unit: '',    log: false },
  { key: 'filterFreqJitter',label: 'filter jitter',  min: 0,     max: 1,     default: 0,     unit: '%',   log: false },
  { key: 'volume',          label: 'volume',          min: 0.001, max: 2.0,   default: 0.5,   unit: '',    log: false },
  { key: 'duration',        label: 'duration',        min: 0.002, max: 4.0,   default: 0.1,   unit: 's',   log: true },
  { key: 'period',          label: 'period',          min: 0.010, max: 4.0,   default: 0.06,  unit: 's',   log: true },
  { key: 'pitchShift',      label: 'pitch shift',    min: -2400, max: 2400,  default: 0,     unit: '¢',   log: false },
  { key: 'pitchJitter',     label: 'pitch jitter',   min: 0,     max: 0.498, default: 0,     unit: '¢',   log: false },
  { key: 'durJitter',       label: 'dur jitter',     min: 0,     max: 1,     default: 0,     unit: '%',   log: false },
  { key: 'panSpread',       label: 'pan spread',     min: 0,     max: 1,     default: 0.05,  unit: '%',   log: false },
  { key: 'fadeRatio',       label: 'fade',            min: 0,     max: 0.5,   default: 0.25,  unit: '%',   log: false },
];

// Axis definitions — maps axis name to how we read it from the sensor
export const AXIS_DEFS = {
  roll:      { label: 'Roll',      read: e => e.x, defaultMin: -90,  defaultMax: 90 },
  elevation: { label: 'Elevation', read: e => e.y, defaultMin: -90,  defaultMax: 90 },
  azimuth:   { label: 'Azimuth',   read: e => e.z, defaultMin: -180, defaultMax: 180 },
};

// ── Active mappings list ───────────────────────────────────────────────────
let _mappings = [];
let _nextId = 1;

// ── Public API ─────────────────────────────────────────────────────────────

/** Get the current list of mappings (read-only copy). */
export function getMappings() {
  return _mappings;
}

/** Create a new mapping with sensible defaults. Returns the new mapping. */
export function addMapping(opts = {}) {
  const m = {
    id:          'map_' + (_nextId++),
    axis:        opts.axis        || 'elevation',
    inputMin:    opts.inputMin    ?? -45,
    inputMax:    opts.inputMax    ?? 45,
    curveType:   opts.curveType   || 'linear',
    curveExp:    opts.curveExp    ?? 1.0,
    targetParam: opts.targetParam || 'hpfFreq',
    outputMin:   opts.outputMin   ?? 20,
    outputMax:   opts.outputMax   ?? 2000,
    enabled:     opts.enabled     ?? true,
  };
  // Enforce one-mapping-per-param: remove any existing mapping for this target
  _mappings = _mappings.filter(x => x.targetParam !== m.targetParam);
  _mappings.push(m);
  _saveMappings();
  S._syncMappingUI?.();
  S._syncMappingHighlights?.();
  return m;
}

/** Update an existing mapping by ID.  Pass partial object with new values. */
export function updateMapping(id, updates) {
  const m = _mappings.find(x => x.id === id);
  if (!m) return;
  // If target param changed, enforce one-mapping-per-param
  if (updates.targetParam && updates.targetParam !== m.targetParam) {
    _mappings = _mappings.filter(x => x.targetParam !== updates.targetParam || x.id === id);
  }
  Object.assign(m, updates);
  _saveMappings();
  S._syncMappingUI?.();
  S._syncMappingHighlights?.();
}

/** Remove a mapping by ID. */
export function removeMapping(id) {
  const idx = _mappings.findIndex(x => x.id === id);
  if (idx === -1) return;
  // Reset the grain override this mapping was controlling
  const param = _mappings[idx].targetParam;
  S.grainOverrides[param] = null;
  S.syncGrainControlsUI?.();
  _mappings.splice(idx, 1);
  _saveMappings();
  S._syncMappingUI?.();
  S._syncMappingHighlights?.();
}

/** Toggle a mapping's enabled state by ID. Returns new enabled state. */
export function toggleMapping(id) {
  const m = _mappings.find(x => x.id === id);
  if (!m) return false;
  m.enabled = !m.enabled;
  // When disabling, reset the grain override so the preset value takes over
  if (!m.enabled) {
    S.grainOverrides[m.targetParam] = null;
    S.syncGrainControlsUI?.();
  }
  _saveMappings();
  S._syncMappingUI?.();
  S._syncMappingHighlights?.();
  return m.enabled;
}

/** Toggle a mapping by its index (0-based). For OSC/MIDI. */
export function toggleMappingByIndex(idx) {
  if (idx >= 0 && idx < _mappings.length) {
    return toggleMapping(_mappings[idx].id);
  }
  return false;
}

// ── Evaluation engine ──────────────────────────────────────────────────────
// Called once per render frame from animate().  Reads sensor data, applies
// curve, writes to S.grainOverrides.

// ── Unified cursor euler source ────────────────────────────────────────────
// Returns {x, y, z} (roll, elevation, azimuth in degrees) from whatever is
// driving the cursor — IMU sensor when available, otherwise derived from
// the cursor's lon/lat on the sphere (pull / surface / mouse modes).
// Roll is 0 when derived from lon/lat (no roll data without IMU).

export function getCursorEuler() {
  // 1. If an IMU sensor is assigned to cursor role, prefer its tare-relative euler
  const slot = getByRole('cursor');
  if (slot?.zeroEuler) return slot.zeroEuler;

  // 2. Derive from cursor position on the sphere (same pattern used by
  //    renderer, grain scheduler, seed-morph, etc.)
  const { lon, lat } = S.cursorQ
    ? getCursorLonLat()
    : (S.mouseInCanvas || S.altLocked)
      ? screenToLonLat(
          S.altLocked ? S.altFrozenMousePixelX : S.mousePixelX,
          S.altLocked ? S.altFrozenMousePixelY : S.mousePixelY
        )
      : getCursorLonLat();

  // Convert lon/lat (radians) → degrees matching the AXIS_DEFS conventions:
  //   elevation (y) = latitude  in degrees (-90..90)
  //   azimuth   (z) = longitude in degrees (-180..180)
  //   roll      (x) = 0 (no roll from mouse/trackpad)
  const RAD2DEG = 180 / Math.PI;
  return {
    x: 0,
    y: lat * RAD2DEG,
    z: lon * RAD2DEG,
  };
}

/** Evaluate all enabled mappings. Call from the render loop at 30fps. */
export function tickMappings() {
  if (_mappings.length === 0) return;

  const euler = getCursorEuler();
  if (!euler) return;

  for (let i = 0; i < _mappings.length; i++) {
    const m = _mappings[i];
    if (!m.enabled) continue;

    const axisDef = AXIS_DEFS[m.axis];
    if (!axisDef) continue;

    // Read the axis value (degrees)
    const raw = axisDef.read(euler);

    // Normalise to [0, 1] within the input range
    const range = m.inputMax - m.inputMin;
    if (Math.abs(range) < 0.001) continue;  // avoid division by zero
    const t = Math.max(0, Math.min(1, (raw - m.inputMin) / range));

    // Apply curve
    const curved = applyCurve(t, m.curveType, m.curveExp);

    // Map to output range
    const paramDef = MAPPABLE_PARAMS.find(p => p.key === m.targetParam);
    let value;
    if (paramDef?.log) {
      // Log-scale output: interpolate in log domain
      const logMin = Math.log(Math.max(1e-6, m.outputMin));
      const logMax = Math.log(Math.max(1e-6, m.outputMax));
      value = Math.exp(logMin + curved * (logMax - logMin));
    } else {
      value = m.outputMin + curved * (m.outputMax - m.outputMin);
    }

    // Clamp to param's valid range
    if (paramDef) {
      value = Math.max(paramDef.min, Math.min(paramDef.max, value));
    }

    // Write to grain override
    S.grainOverrides[m.targetParam] = value;
  }

  // Sync UI (throttled — only if callback is set)
  S.syncGrainControlsUI?.();
}

// ── Curve functions ────────────────────────────────────────────────────────

export function applyCurve(t, curveType, exp) {
  switch (curveType) {
    case 'log': return Math.pow(t, 1 / Math.max(0.1, exp));  // fast rise, slow top
    case 'exp': return Math.pow(t, Math.max(0.1, exp));       // slow start, fast top
    case 'linear':
    default:    return t;
  }
}

// ── Persistence ────────────────────────────────────────────────────────────
const STORAGE_KEY = 'mubone_sensorMappings';

function _saveMappings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_mappings));
  } catch (_) { /* quota exceeded — silent */ }
}

export function loadMappings() {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    if (json) {
      const arr = JSON.parse(json);
      if (Array.isArray(arr)) {
        _mappings = arr;
        // Restore _nextId to avoid collisions
        for (const m of _mappings) {
          const num = parseInt(m.id?.replace('map_', ''));
          if (!isNaN(num) && num >= _nextId) _nextId = num + 1;
        }
      }
    }
  } catch (_) { /* corrupt data — start fresh */ }
}

/** Export mappings as a JSON string (for settings export). */
export function exportMappings() {
  return JSON.stringify(_mappings, null, 2);
}

/** Import mappings from a JSON string (for settings import). */
export function importMappings(json) {
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) {
      _mappings = arr;
      _saveMappings();
      S._syncMappingUI?.();
      S._syncMappingHighlights?.();
    }
  } catch (_) { /* invalid JSON — ignore */ }
}

/** Clear all mappings and reset grain overrides. */
export function clearAllMappings() {
  for (const m of _mappings) {
    S.grainOverrides[m.targetParam] = null;
  }
  _mappings = [];
  _saveMappings();
  S.syncGrainControlsUI?.();
  S._syncMappingUI?.();
  S._syncMappingHighlights?.();
}

// ── Initialise on import ───────────────────────────────────────────────────
loadMappings();
