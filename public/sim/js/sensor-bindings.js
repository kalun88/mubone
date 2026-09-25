// ============================================================================
// sensor-bindings.js — a sensor axis as a knob on the ONE binding table
//
// Settings → Mapping was a second mapping system beside the Keys + MIDI table:
// its own list of 12 grain params, its own curves, its own writes into
// S.grainOverrides (removed 2026-09-25). A sensor is a continuous controller,
// and the table already has one of those — a MIDI CC — so a sensor binds onto
// the same cc rows, through the same ccFn, with the same scale stage
// (scale.js: curve + output window). Every destination a knob can reach, a
// sensor can: grain, tape, lens, volumes, and the cursor's two axes.
//
// A binding is  { sensor, axis, inLo, inHi, fold, curve?, outLo?, outHi? }
// keyed by action id. `sensor` is a slot NAME (`/sensor/{name}/…`), not a
// role, so any sensor on the rig can drive a row — not only the cursor's.
// The axis is read from the slot's `zeroEuler` (post-calibration, the same
// reading the old mapping rows used): elevation, roll, azimuth. Azimuth is
// heading and drifts with the magnetometer off; elevation and roll are
// gravity-referenced and do not.
//
// Evaluated once per render frame (renderer.js), before the cursor is
// resolved, so a row driving a cursor axis lands in the same frame. A value is
// dispatched only when it moves — a still sensor sends nothing.
// ============================================================================

import { S } from './state.js';
import { getRegistry, getByRole } from './sensor-registry.js';
import { scaleControl } from './scale.js';

const STORAGE_KEY = 'mubone_sensor_bindings';

export const SENSOR_AXES = [
  { id: 'elevation', label: 'Elevation', read: e => e.y },
  { id: 'roll',      label: 'Roll',      read: e => e.x },
  { id: 'azimuth',   label: 'Azimuth',   read: e => e.z, note: 'heading — drifts with the magnetometer off' },
];
const _AXIS = Object.fromEntries(SENSOR_AXES.map(a => [a.id, a]));

// Rows that drive a cursor axis, and the axis source a binding arms.
const _CURSOR_ROWS = { cursor_az: 'azSource', cursor_el: 'elSource' };

// The smallest move, on the 0–127 dispatch scale, worth sending. A sensor at
// rest still jitters in the last decimal; this keeps it from re-writing the
// destination every frame.
const SEND_EPS = 0.02;

let _bindings = {};
const _last = new Map();   // action id → last dispatched value

try {
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  if (raw && typeof raw === 'object') _bindings = raw;
} catch (_) { _bindings = {}; }

function _save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_bindings)); } catch (_) {}
}

export function getSensorBinding(id) { return _bindings[id] ?? null; }

/** Create or update a row's binding. A field passed as undefined is removed.
 *  A new binding on a cursor row arms that axis, so a binding never silently
 *  does nothing. */
export function setSensorBinding(id, b) {
  const fresh = !_bindings[id];
  const next = { ..._bindings[id], ...b };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  _bindings[id] = next;
  _last.delete(id);
  _save();
  if (fresh) armCursorAxisFor(id);
}

export function clearSensorBinding(id) {
  delete _bindings[id];
  _last.delete(id);
  _save();
}

export function clearAllSensorBindings() {
  for (const k of Object.keys(_bindings)) delete _bindings[k];
  _last.clear();
  _save();
}

/** A binding landing on a cursor row sets that axis to 'mapped'. One way only:
 *  removing the binding leaves the axis holding where it was — nothing may put
 *  the cursor back under sensor control mid-performance. The footer's AZ / EL
 *  button is how an axis is freed. Called for MIDI learn too (midi.js). */
export function armCursorAxisFor(id) {
  const key = _CURSOR_ROWS[id];
  if (key && S[key] !== 'mapped') S._setAxisSource?.(key, 'mapped');
}

/** The sensor holding the cursor role, by name, or null. */
export function cursorSensorName() { return getByRole('cursor')?.name ?? null; }

/** The sensors that have sent a quaternion, by name. */
export function sensorNames() {
  return [...getRegistry().values()].filter(s => s.hasQuat).map(s => s.name);
}

/** One axis of one sensor, in degrees, or null while it is not sending. */
export function readSensorAxis(sensor, axis, fold = false) {
  const e = getRegistry().get(sensor)?.zeroEuler;
  const a = _AXIS[axis];
  if (!e || !a) return null;
  const v = a.read(e);
  if (!Number.isFinite(v)) return null;
  return fold ? Math.abs(v) : v;
}

/** Where a reading sits in the binding's input range, 0–1. From > To is legal
 *  and reverses the throw. */
export function inputFraction(b, v) {
  const span = b.inHi - b.inLo;
  if (!(Math.abs(span) > 1e-6) || v == null) return null;
  const t = (v - b.inLo) / span;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function tickSensorBindings() {
  _tickLearn();
  const actions = S._actions;
  if (!actions) return;
  for (const id in _bindings) {
    const b = _bindings[id];
    const t = inputFraction(b, readSensorAxis(b.sensor, b.axis, b.fold));
    if (t == null) continue;
    const v = scaleControl(t, { curve: b.curve ?? 1, lo: b.outLo ?? 0, hi: b.outHi ?? 1 }) * 127;
    const last = _last.get(id);
    if (last != null && Math.abs(v - last) < SEND_EPS) continue;
    _last.set(id, v);
    S._dispatchAction?.(id, v);
  }
}

// ── Learn: move the sensor, and the axis that moved most is the one ──────────
// Every axis of every sensing slot is tracked from the moment learn starts.
// Azimuth and roll wrap at ±180, so each is followed UNWRAPPED — a sweep
// through the seam reads as the 40° it was, not 320°. The result is the axis
// with the widest sweep, and the range it swept becomes the input range.
let _learn = null;   // Map 'sensor|axis' → { sensor, axis, prev, cur, lo, hi }

export function startSensorLearn() { _learn = new Map(); }
export function stopSensorLearn()  { _learn = null; }
export function sensorLearning()   { return !!_learn; }

function _tickLearn() {
  if (!_learn) return;
  for (const name of sensorNames()) {
    for (const a of SENSOR_AXES) {
      const v = readSensorAxis(name, a.id);
      if (v == null) continue;
      const k = name + '|' + a.id;
      const t = _learn.get(k);
      if (!t) { _learn.set(k, { sensor: name, axis: a.id, prev: v, cur: v, lo: v, hi: v }); continue; }
      let d = v - t.prev;
      if (d > 180) d -= 360; else if (d < -180) d += 360;
      t.prev = v; t.cur += d;
      if (t.cur < t.lo) t.lo = t.cur;
      if (t.cur > t.hi) t.hi = t.cur;
    }
  }
}

/** The widest sweep so far: { sensor, axis, lo, hi, span }, or null. */
export function sensorLearnResult() {
  if (!_learn) return null;
  let best = null;
  for (const t of _learn.values()) {
    const span = t.hi - t.lo;
    if (!best || span > best.span) best = { sensor: t.sensor, axis: t.axis, lo: t.lo, hi: t.hi, span };
  }
  return best;
}
