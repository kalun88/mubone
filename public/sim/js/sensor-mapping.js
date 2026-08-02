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
import { sendCC as midiSendCC, isMIDIOutAvailable } from './midi-out.js';
import { sendOSCExternal, isOSCOutAvailable } from './osc-out.js';

// ── Mapping data model ─────────────────────────────────────────────────────
// Each mapping is a plain object:
// {
//   id:          string    — unique ID (auto-generated)
//   axis:        string    — 'roll' | 'elevation' | 'azimuth' | 'mapping1..3'
//   inputMin:    number    — lower edge of active range (degrees for IMU axes)
//   inputMax:    number    — upper edge of active range
//   curveType:   string    — 'linear' | 'log' | 'exp'
//   curveExp:    number    — exponent (1.0 = linear, <1 = log, >1 = exp)
//   outputMin:   number    — output value at inputMin
//   outputMax:   number    — output value at inputMax
//   enabled:     boolean   — can be toggled in performance
//
//   // Legacy field — still populated for grain rows so existing code and
//   // localStorage stay compatible. For non-grain rows it's the empty string.
//   targetParam: string
//
//   // Destination. Optional for backward compat: rows persisted before this
//   // extension are auto-migrated on load to {kind:'grain', param:targetParam}.
//   output: {
//     kind: 'grain' | 'midi' | 'osc',
//     // grain:
//     param?:    string         // e.g. 'hpfFreq' — mirrors legacy targetParam
//     // midi:
//     deviceId?: string         // from navigator.requestMIDIAccess().outputs
//     channel?:  number         // 1–16 (user-facing)
//     cc?:       number         // 0–127 (for 14-bit, LSB uses cc+32)
//     bits?:     7 | 14
//     // osc:
//     host?:     string         // e.g. '127.0.0.1'
//     port?:     number         // UDP port on the receiver
//     address?:  string         // OSC address, must start with '/'
//   },
//
//   // Transient telemetry (not persisted — see _stripTransient before save):
//   _lastEmitted?: number       // last emitted value (post-scale, pre-protocol)
//   _lastWireValue?: number     // last value as it went on the wire (int for MIDI)
//   _lastTxAt?:    number       // performance.now() of last attempted tx
//   _lastTxStatus?:string       // 'sent' | 'deduped' | 'throttled' | 'unavailable' | 'invalid'
//   _lastError?:   string       // last transport error message, if any
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

// External-input buckets for generic OSC mapping channels (/mapping1 etc.).
// Written by osc.js via setMappingInput(); read by the corresponding AXIS_DEFS
// entries below. Values are whatever floats the upstream peer sends — the
// joycon GUI, for example, normalises its joystick x/y to [-1, 1] and emits
// them on one of these addresses so the user can map a joystick axis to any
// grain param via the standard mapping modal, no new code per target.
const _externalInputs = { mapping1: 0, mapping2: 0, mapping3: 0 };

/** Write a value into a generic /mappingN bucket. Called from osc.js. */
export function setMappingInput(name, value) {
  if (!(name in _externalInputs)) return;
  const v = Number(value);
  if (Number.isFinite(v)) _externalInputs[name] = v;
}

/** Read current /mappingN buckets (for diagnostics / UI). */
export function getMappingInputs() { return { ..._externalInputs }; }

// Axis definitions — maps axis name to how we read it from the sensor.
// `format(v)` is used by the mapping modal's live readout so units stay right
// when the axis isn't in degrees (generic inputs have no meaningful unit).
export const AXIS_DEFS = {
  roll:      { label: 'Roll',      read: e => e.x, defaultMin: -90,  defaultMax: 90,
               format: v => v.toFixed(1) + '°' },
  elevation: { label: 'Elevation', read: e => e.y, defaultMin: -90,  defaultMax: 90,
               format: v => v.toFixed(1) + '°' },
  azimuth:   { label: 'Azimuth',   read: e => e.z, defaultMin: -180, defaultMax: 180,
               format: v => v.toFixed(1) + '°' },
  mapping1:  { label: 'OSC /mapping1', read: () => _externalInputs.mapping1,
               defaultMin: -1, defaultMax: 1, format: v => v.toFixed(2) },
  mapping2:  { label: 'OSC /mapping2', read: () => _externalInputs.mapping2,
               defaultMin: -1, defaultMax: 1, format: v => v.toFixed(2) },
  mapping3:  { label: 'OSC /mapping3', read: () => _externalInputs.mapping3,
               defaultMin: -1, defaultMax: 1, format: v => v.toFixed(2) },
};

// ── Active mappings list ───────────────────────────────────────────────────
let _mappings = [];
let _nextId = 1;

// ── Public API ─────────────────────────────────────────────────────────────

/** Get the current list of mappings (read-only copy). */
export function getMappings() {
  return _mappings;
}

// ── Destination uniqueness helpers ─────────────────────────────────────────
// Two mapping rows writing to the same destination would fight (last writer
// wins, but values oscillate). So we enforce one row per destination — the
// notion of "destination" depends on the output kind:
//   grain — uniqueness by grain param key
//   midi  — uniqueness by (device, channel, cc) tuple
//   osc   — uniqueness by (host, port, address) tuple
// Rows without an output block are treated as grain (legacy).

function _destKey(m) {
  const out = m.output;
  if (!out || out.kind === 'grain') {
    return 'grain:' + (out?.param || m.targetParam || '');
  }
  if (out.kind === 'midi') {
    return `midi:${out.deviceId || ''}:${out.channel || 0}:${out.cc ?? -1}`;
  }
  if (out.kind === 'osc') {
    return `osc:${out.host || ''}:${out.port || 0}:${out.address || ''}`;
  }
  return 'unknown:' + m.id;
}

/** Resolve effective output block for a row, tolerating legacy rows. */
function _getOutput(m) {
  if (m.output && m.output.kind) return m.output;
  // Legacy row — synthesise a grain output from the old targetParam field.
  return { kind: 'grain', param: m.targetParam };
}

/** Default output block for a freshly added row (grain / hpfFreq). */
function _defaultOutput() {
  return { kind: 'grain', param: 'hpfFreq' };
}

// Transient telemetry keys are stripped before persist so they don't bloat
// localStorage with volatile per-frame data.
const _TRANSIENT_KEYS = [
  '_lastEmitted', '_lastWireValue', '_lastTxAt', '_lastTxStatus', '_lastError',
];

function _stripTransient(m) {
  const out = { ...m };
  for (const k of _TRANSIENT_KEYS) delete out[k];
  return out;
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
    // Legacy field — still populated for grain rows so other modules that read
    // `m.targetParam` directly keep working. Non-grain rows get ''.
    targetParam: opts.targetParam || (opts.output?.kind === 'grain' || !opts.output
                   ? (opts.output?.param || 'hpfFreq')
                   : ''),
    outputMin:   opts.outputMin   ?? 20,
    outputMax:   opts.outputMax   ?? 2000,
    enabled:     opts.enabled     ?? true,
    output:      opts.output      || _defaultOutput(),
  };
  // Keep targetParam in sync with output.param for grain rows.
  if (m.output.kind === 'grain') {
    m.targetParam = m.output.param || m.targetParam || 'hpfFreq';
    m.output.param = m.targetParam;
  }
  // Enforce one-row-per-destination
  const key = _destKey(m);
  _mappings = _mappings.filter(x => _destKey(x) !== key);
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

  // Build a candidate merged row to check if the destination changed.
  const merged = { ...m, ...updates };
  if (updates.output) merged.output = { ...(m.output || {}), ...updates.output };

  // Keep targetParam / output.param in sync for grain rows.
  if (merged.output?.kind === 'grain') {
    // Prefer an explicit update.targetParam, else update.output.param, else current.
    const p = updates.targetParam || updates.output?.param || merged.targetParam || 'hpfFreq';
    merged.targetParam = p;
    merged.output = { ...merged.output, param: p };
  } else if (merged.output && merged.output.kind !== 'grain') {
    merged.targetParam = '';  // non-grain rows don't own a grain param
  }

  // If destination changed, clear any lingering grain override on the old
  // destination and enforce uniqueness on the new one.
  const oldKey = _destKey(m);
  const newKey = _destKey(merged);
  if (oldKey !== newKey) {
    // Old was grain — release its override so preset value takes over.
    if ((m.output?.kind || 'grain') === 'grain') {
      const oldParam = m.output?.param || m.targetParam;
      if (oldParam) {
        S.grainOverrides[oldParam] = null;
        S.syncGrainControlsUI?.();
      }
    }
    // Remove any existing row occupying the new destination.
    _mappings = _mappings.filter(x => _destKey(x) !== newKey || x.id === id);
  }

  Object.assign(m, merged);
  _saveMappings();
  S._syncMappingUI?.();
  S._syncMappingHighlights?.();
}

/** Remove a mapping by ID. */
export function removeMapping(id) {
  const idx = _mappings.findIndex(x => x.id === id);
  if (idx === -1) return;
  const m = _mappings[idx];
  // If the row was driving a grain param, release it so the preset value
  // takes over. Non-grain rows don't own grain state.
  if ((m.output?.kind || 'grain') === 'grain') {
    const param = m.output?.param || m.targetParam;
    if (param) {
      S.grainOverrides[param] = null;
      S.syncGrainControlsUI?.();
    }
  }
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
  // When disabling a grain row, reset its override so the preset value takes
  // over. Non-grain rows simply stop sending — nothing to reset.
  if (!m.enabled && (m.output?.kind || 'grain') === 'grain') {
    const param = m.output?.param || m.targetParam;
    if (param) {
      S.grainOverrides[param] = null;
      S.syncGrainControlsUI?.();
    }
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

  let anyGrain = false;

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

    const out = _getOutput(m);

    if (out.kind === 'grain') {
      anyGrain = true;
      _dispatchGrain(m, out, curved);
    } else if (out.kind === 'midi') {
      _dispatchMidi(m, out, curved);
    } else if (out.kind === 'osc') {
      _dispatchOsc(m, out, curved);
    }
  }

  // Only sync grain controls when a grain row actually ran — avoids redundant
  // DOM work when the module is used purely as a MIDI/OSC control surface.
  if (anyGrain) S.syncGrainControlsUI?.();
}

// ── Per-kind dispatchers ───────────────────────────────────────────────────

function _dispatchGrain(m, out, curved) {
  const param = out.param || m.targetParam;
  if (!param) return;
  const paramDef = MAPPABLE_PARAMS.find(p => p.key === param);

  let value;
  if (paramDef?.log) {
    const logMin = Math.log(Math.max(1e-6, m.outputMin));
    const logMax = Math.log(Math.max(1e-6, m.outputMax));
    value = Math.exp(logMin + curved * (logMax - logMin));
  } else {
    value = m.outputMin + curved * (m.outputMax - m.outputMin);
  }

  if (paramDef) {
    value = Math.max(paramDef.min, Math.min(paramDef.max, value));
  }

  S.grainOverrides[param] = value;
  m._lastEmitted = value;
  m._lastWireValue = value;
  m._lastTxAt = _now();
  m._lastTxStatus = 'sent';
}

function _dispatchMidi(m, out, curved) {
  const bits = out.bits === 14 ? 14 : 7;
  const maxVal = bits === 14 ? 16383 : 127;

  // outputMin/outputMax for MIDI rows are in 0..maxVal. Linear interp is the
  // natural choice — integer MIDI values don't benefit from a log output curve
  // since the input curve already handles that shape.
  const lo = Math.max(0, Math.min(maxVal, m.outputMin ?? 0));
  const hi = Math.max(0, Math.min(maxVal, m.outputMax ?? maxVal));
  const value = lo + curved * (hi - lo);

  m._lastEmitted = value;

  if (!out.deviceId || !Number.isFinite(out.channel) || !Number.isFinite(out.cc)) {
    m._lastTxStatus = 'invalid';
    m._lastError = 'incomplete MIDI destination';
    return;
  }

  const status = midiSendCC(out.deviceId, out.channel, out.cc, value, { bits });
  m._lastTxAt = _now();
  m._lastTxStatus = status;
  if (status === 'sent') {
    m._lastWireValue = Math.round(value);
    m._lastError = undefined;
  } else if (status === 'unavailable') {
    m._lastError = 'MIDI output not available';
  } else if (status === 'invalid') {
    m._lastError = 'invalid MIDI args';
  }
}

function _dispatchOsc(m, out, curved) {
  // For OSC, outputMin/outputMax are the user's preferred float range
  // (typically 0..1 for plugin knobs). No clamping to a canonical range — the
  // receiver decides what's valid.
  const lo = Number.isFinite(m.outputMin) ? m.outputMin : 0;
  const hi = Number.isFinite(m.outputMax) ? m.outputMax : 1;
  const value = lo + curved * (hi - lo);

  m._lastEmitted = value;

  if (!out.host || !Number.isFinite(out.port) || !out.address) {
    m._lastTxStatus = 'invalid';
    m._lastError = 'incomplete OSC destination';
    return;
  }

  const status = sendOSCExternal(out.host, out.port, out.address, [value]);
  m._lastTxAt = _now();
  m._lastTxStatus = status;
  if (status === 'sent') {
    m._lastWireValue = value;
    m._lastError = undefined;
  } else if (status === 'unavailable') {
    m._lastError = 'External OSC requires Electron build';
  } else if (status === 'invalid') {
    m._lastError = 'invalid OSC args';
  }
}

function _now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
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
    // Strip transient telemetry so localStorage only holds persistent config.
    const persistable = _mappings.map(_stripTransient);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  } catch (_) { /* quota exceeded — silent */ }
}

export function loadMappings() {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    if (json) {
      const arr = JSON.parse(json);
      if (Array.isArray(arr)) {
        // Migrate legacy rows on load: rows without an `output` block get
        // `output: {kind: 'grain', param: targetParam}` synthesised. This is
        // a lazy one-way migration — first subsequent save writes the new
        // shape back. No risk of duplicating state across refactors.
        _mappings = arr.map(m => {
          if (!m.output || !m.output.kind) {
            return { ...m, output: { kind: 'grain', param: m.targetParam } };
          }
          return m;
        });
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
  return JSON.stringify(_mappings.map(_stripTransient), null, 2);
}

/** Import mappings from a JSON string (for settings import). */
export function importMappings(json) {
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) {
      // Apply the same legacy-row migration we do on localStorage load, so
      // older exports (pre-output-block) import cleanly.
      _mappings = arr.map(m => {
        if (!m.output || !m.output.kind) {
          return { ...m, output: { kind: 'grain', param: m.targetParam } };
        }
        return m;
      });
      _saveMappings();
      S._syncMappingUI?.();
      S._syncMappingHighlights?.();
    }
  } catch (_) { /* invalid JSON — ignore */ }
}

/** Clear all mappings and reset grain overrides. Non-grain rows just stop
 *  firing — nothing external to reset from the renderer's side. */
export function clearAllMappings() {
  for (const m of _mappings) {
    if ((m.output?.kind || 'grain') === 'grain') {
      const param = m.output?.param || m.targetParam;
      if (param) S.grainOverrides[param] = null;
    }
  }
  _mappings = [];
  _saveMappings();
  S.syncGrainControlsUI?.();
  S._syncMappingUI?.();
  S._syncMappingHighlights?.();
}

/** Read-only snapshot of a row's live telemetry. Returns null if unknown. */
export function getMappingTelemetry(id) {
  const m = _mappings.find(x => x.id === id);
  if (!m) return null;
  return {
    lastEmitted:   m._lastEmitted,
    lastWireValue: m._lastWireValue,
    lastTxAt:      m._lastTxAt,
    lastTxStatus:  m._lastTxStatus,
    lastError:     m._lastError,
  };
}

/** Diagnostics: runtime availability of the two external transports. */
export function getTransportStatus() {
  return {
    midi: isMIDIOutAvailable(),
    osc:  isOSCOutAvailable(),
  };
}

// ── Initialise on import ───────────────────────────────────────────────────
loadMappings();
