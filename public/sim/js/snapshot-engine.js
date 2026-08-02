// ============================================================================
// snapshot-engine.js — Posture-macro interpolation engine (staging Change B)
//
// Per-tick loop:
//   1. read S.staging.relational (set by relational-features.tickRelational)
//   2. normalize the identity vector against the snapshot extents
//   3. compute per-snapshot weights via the configured kernel
//   4. blend per-channel values and emit via midi-out / osc-out
//   5. publish telemetry (weights, per-channel pre/wire values) for the UI
//
// Data model lives under S.staging:
//   snapshots           : [{ id, label, identity:[n], values:{name→num}, color? }]
//   mappingPreset       : { name, channels:[{name, protocol, ...}] }
//   mappingPresetLibrary: [mappingPreset, ...]
//   interpolation       : { mode, sigma, k, axisWeights:{daz,dpitch,droll} }
//   telemetry           : { weights:[], perChannel:{name→{pre,wire,status}},
//                           lastTickAt, tickCount }
//   running             : bool — engine on/off
//   logging             : bool — console-dump every emitted message
//
// Everything is persisted to localStorage (JSON of snapshots + preset +
// interpolation + library).  No binary state crosses the persistence boundary.
//
// Engine never throws; any per-channel failure is logged into telemetry and
// the tick continues.  If the user hasn't assigned a mapping preset, the
// engine still runs (so you can see weights live on the posture map), it just
// doesn't emit.
// ============================================================================

import { S } from './state.js';
import {
  tickRelational,
  identityVectorFromRelational,
  IDENTITY_KEYS,
} from './relational-features.js';
import { computeWeights, weightedDistance } from './interp-kernels.js';
import { sendCC as midiSendCC } from './midi-out.js';
import { sendOSCExternal } from './osc-out.js';

const LS_KEY       = 'mubone_staging';
const DEFAULT_TICK_HZ = 33;                       // ~30Hz, aligned with mapping engine
const DEFAULT_TICK_MS = 1000 / DEFAULT_TICK_HZ;

let _timer       = null;
let _startedAt   = 0;
let _totalEmit   = 0;
let _tickCount   = 0;

// ── Defaults ────────────────────────────────────────────────────────────────

function _defaultInterpolation() {
  return {
    mode: 'gaussian',
    sigma: 0.3,
    k: 3,
    axisWeights: { daz: 1, dpitch: 1, droll: 1 },
    smoothingMs: 0,
  };
}

function _defaultMappingPreset() {
  return {
    name: 'untitled',
    channels: [],
  };
}

export function _defaultChannel(name = 'channel') {
  return {
    name,
    protocol: 'midi',
    device:   '',
    ch:       1,
    cc:       20,
    bits:     7,
    host:     '127.0.0.1',
    port:     9000,
    address:  '/' + name,
    min:      0,
    max:      1,
    hold:     false,     // freeze emission for troubleshooting
  };
}

function _ensureStaging() {
  if (!S.staging) S.staging = {};
  if (!S.staging.relational) S.staging.relational = { daz: 0, dpitch: 0, droll: 0 };
  if (!Array.isArray(S.staging.snapshots))            S.staging.snapshots = [];
  if (!Array.isArray(S.staging.mappingPresetLibrary)) S.staging.mappingPresetLibrary = [];
  if (!S.staging.mappingPreset)                       S.staging.mappingPreset = _defaultMappingPreset();
  if (!S.staging.interpolation)                       S.staging.interpolation = _defaultInterpolation();
  if (!S.staging.telemetry) {
    S.staging.telemetry = {
      weights: [],
      perChannel: {},
      identityNorm: [],
      identityRaw: [],
      lastTickAt: 0,
      tickCount: 0,
      totalEmit: 0,
    };
  }
  if (typeof S.staging.running !== 'boolean') S.staging.running = false;
  if (typeof S.staging.logging !== 'boolean') S.staging.logging = false;
  return S.staging;
}

// ── Persistence ─────────────────────────────────────────────────────────────

const _PERSIST_KEYS = [
  'snapshots', 'mappingPreset', 'mappingPresetLibrary',
  'interpolation', 'running', 'logging',
];

export function saveStaging() {
  _ensureStaging();
  const dump = {};
  for (const k of _PERSIST_KEYS) dump[k] = S.staging[k];
  try { localStorage.setItem(LS_KEY, JSON.stringify(dump)); } catch (_) {}
}

export function loadStaging() {
  _ensureStaging();
  let raw;
  try { raw = localStorage.getItem(LS_KEY); } catch (_) { raw = null; }
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    for (const k of _PERSIST_KEYS) {
      if (data[k] !== undefined) S.staging[k] = data[k];
    }
    // Patch in missing defaults for partial saves (forward-compat).
    if (!S.staging.interpolation) S.staging.interpolation = _defaultInterpolation();
    if (!S.staging.mappingPreset) S.staging.mappingPreset = _defaultMappingPreset();
    if (!Array.isArray(S.staging.snapshots)) S.staging.snapshots = [];
    if (!Array.isArray(S.staging.mappingPresetLibrary)) S.staging.mappingPresetLibrary = [];
  } catch (e) {
    console.warn('[staging] failed to load persisted state:', e);
  }
}

// ── Snapshot CRUD ───────────────────────────────────────────────────────────

function _nextSnapshotId() {
  // Monotonic id keyed off the current array — avoids collisions on delete.
  const used = new Set((S.staging?.snapshots || []).map(s => s.id));
  for (let i = 1; ; i++) {
    const id = `snap-${i}`;
    if (!used.has(id)) return id;
  }
}

/**
 * Drop a new snapshot at the current identity vector.  Initial values default
 * to the midpoint of each channel's range.
 */
export function captureSnapshot(label) {
  _ensureStaging();
  const rel = S.staging.relational;
  const identity = identityVectorFromRelational(rel);
  const snap = {
    id:       _nextSnapshotId(),
    label:    label || `snap ${S.staging.snapshots.length + 1}`,
    identity,
    values:   {},
    color:    null,
  };
  for (const ch of (S.staging.mappingPreset?.channels || [])) {
    const mid = ((ch.min ?? 0) + (ch.max ?? 1)) / 2;
    snap.values[ch.name] = mid;
  }
  S.staging.snapshots.push(snap);
  saveStaging();
  window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'snapshot' } }));
  return snap;
}

export function deleteSnapshot(id) {
  _ensureStaging();
  const arr = S.staging.snapshots;
  const i = arr.findIndex(s => s.id === id);
  if (i >= 0) {
    arr.splice(i, 1);
    saveStaging();
    return true;
  }
  return false;
}

export function updateSnapshotValue(id, channelName, value) {
  _ensureStaging();
  const snap = S.staging.snapshots.find(s => s.id === id);
  if (!snap) return false;
  snap.values[channelName] = value;
  saveStaging();
  return true;
}

export function updateSnapshotIdentity(id, identity) {
  _ensureStaging();
  const snap = S.staging.snapshots.find(s => s.id === id);
  if (!snap) return false;
  snap.identity = identity.slice();
  saveStaging();
  return true;
}

export function updateSnapshotLabel(id, label) {
  _ensureStaging();
  const snap = S.staging.snapshots.find(s => s.id === id);
  if (!snap) return false;
  snap.label = label;
  saveStaging();
  return true;
}

// ── Mapping preset library ──────────────────────────────────────────────────

export function saveMappingPresetToLibrary(name) {
  _ensureStaging();
  const current = S.staging.mappingPreset;
  if (!current) return false;
  const clone = JSON.parse(JSON.stringify(current));
  clone.name = name || clone.name || 'untitled';
  // Replace existing entry with the same name, or append.
  const lib = S.staging.mappingPresetLibrary;
  const i = lib.findIndex(p => p.name === clone.name);
  if (i >= 0) lib[i] = clone; else lib.push(clone);
  saveStaging();
  return clone;
}

export function loadMappingPresetFromLibrary(name) {
  _ensureStaging();
  const lib = S.staging.mappingPresetLibrary;
  const preset = lib.find(p => p.name === name);
  if (!preset) return false;
  S.staging.mappingPreset = JSON.parse(JSON.stringify(preset));
  // Snapshots keep their value maps keyed by channel name — any channels that
  // moved in/out of the preset just get empty slots / stay dormant on emit.
  saveStaging();
  return true;
}

export function deleteMappingPresetFromLibrary(name) {
  _ensureStaging();
  const lib = S.staging.mappingPresetLibrary;
  const i = lib.findIndex(p => p.name === name);
  if (i >= 0) {
    lib.splice(i, 1);
    saveStaging();
    return true;
  }
  return false;
}

// ── Channel editor helpers ──────────────────────────────────────────────────

export function addChannel(name) {
  _ensureStaging();
  const preset = S.staging.mappingPreset;
  const used = new Set(preset.channels.map(c => c.name));
  let n = name || 'channel';
  let suffix = 1;
  while (used.has(n)) n = `channel ${++suffix}`;
  preset.channels.push(_defaultChannel(n));
  saveStaging();
}

export function removeChannel(name) {
  _ensureStaging();
  const preset = S.staging.mappingPreset;
  const i = preset.channels.findIndex(c => c.name === name);
  if (i >= 0) {
    preset.channels.splice(i, 1);
    // Clear any snapshot values keyed on the removed name so old data doesn't
    // resurrect if the user re-adds a channel with the same name later.
    for (const s of S.staging.snapshots) {
      if (s.values && name in s.values) delete s.values[name];
    }
    saveStaging();
  }
}

export function renameChannel(oldName, newName) {
  _ensureStaging();
  const preset = S.staging.mappingPreset;
  const ch = preset.channels.find(c => c.name === oldName);
  if (!ch) return false;
  const clash = preset.channels.some(c => c.name === newName);
  if (clash) return false;
  ch.name = newName;
  for (const s of S.staging.snapshots) {
    if (s.values && oldName in s.values) {
      s.values[newName] = s.values[oldName];
      delete s.values[oldName];
    }
  }
  saveStaging();
  return true;
}

// ── Identity normalization ──────────────────────────────────────────────────
// Per-axis rescale against snapshot extents — keeps distance math scale-
// invariant.  Falls back to ±60° if a dimension has zero variance (one
// snapshot or all snapshots share that axis value) so weights still behave
// sensibly before the second snapshot lands.

function _computeNormBounds(snapshots) {
  const n = IDENTITY_KEYS.length;
  const mins = new Array(n).fill(Infinity);
  const maxs = new Array(n).fill(-Infinity);
  for (const s of snapshots) {
    const v = s.identity;
    for (let i = 0; i < n; i++) {
      if (v[i] < mins[i]) mins[i] = v[i];
      if (v[i] > maxs[i]) maxs[i] = v[i];
    }
  }
  const spans = new Array(n);
  for (let i = 0; i < n; i++) {
    let span = maxs[i] - mins[i];
    if (!isFinite(span) || span < 1e-3) span = 120;   // ±60° default
    spans[i] = span;
  }
  return { mins, maxs, spans };
}

function _normalizeIdentity(vec, bounds) {
  const n = vec.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const m = bounds.mins[i];
    const span = bounds.spans[i];
    // Center the live vector in the snapshot extents → 0, extents → ±1.
    out[i] = ((vec[i] - m) / span) * 2 - 1;
  }
  return out;
}

function _normalizeSnapshots(snapshots, bounds) {
  return snapshots.map(s => ({
    id: s.id,
    identity: _normalizeIdentity(s.identity, bounds),
    values: s.values,
  }));
}

// ── Output emission ─────────────────────────────────────────────────────────

function _scaleToRange(value, ch) {
  const lo = ch.min ?? 0;
  const hi = ch.max ?? 1;
  const v = Math.max(lo, Math.min(hi, value));
  return { normalized: v, unit: hi > lo ? (v - lo) / (hi - lo) : 0 };
}

function _emitChannel(ch, pre) {
  if (ch.hold) return { status: 'held', wire: null };

  if (ch.protocol === 'midi') {
    const maxVal = ch.bits === 14 ? 16383 : 127;
    const { unit } = _scaleToRange(pre, ch);
    const wire = Math.round(unit * maxVal);
    if (!ch.device) return { status: 'unavailable', wire };
    const status = midiSendCC(ch.device, ch.ch || 1, ch.cc ?? 0, wire, { bits: ch.bits || 7 });
    return { status, wire };
  }

  if (ch.protocol === 'osc') {
    const { normalized } = _scaleToRange(pre, ch);
    const wire = normalized;
    if (!ch.host || !ch.port || !ch.address) return { status: 'invalid', wire };
    const status = sendOSCExternal(ch.host, ch.port, ch.address, [wire]);
    return { status, wire };
  }

  return { status: 'unavailable', wire: null };
}

// ── Lock detection ──────────────────────────────────────────────────────────
// "Am I back at the same posture?" — a simple nearness check against the full
// snapshot list, reusing the engine's own normalization + axis weights so the
// lock distance and the kernel distance are the exact same metric.
//
// Threshold rule:
//   Gaussian mode → max(0.04, σ * 0.3)   (tighter σ ⇒ tighter lock, matches
//                                         the intuition that Gaussian width
//                                         already defines "how close is close")
//   all other modes → 0.08               (fixed — Voronoi/IDW kernels don't
//                                         have a scale parameter to key off)
//
// Callers (the posture map) poll this every frame; it's cheap and runs even
// when the staging engine itself is stopped.  Returns null if there are no
// snapshots to compare against.

export function evaluateLock() {
  _ensureStaging();
  const snaps = S.staging.snapshots;
  if (!snaps || snaps.length === 0) return null;

  const identity = identityVectorFromRelational(S.staging.relational);
  const bounds = _computeNormBounds(snaps);
  const liveN  = _normalizeIdentity(identity, bounds);

  const interp = S.staging.interpolation || _defaultInterpolation();
  const axisW = IDENTITY_KEYS.map(k => interp.axisWeights?.[k] ?? 1);

  let bestIdx = -1;
  let bestD = Infinity;
  for (let i = 0; i < snaps.length; i++) {
    const snapN = _normalizeIdentity(snaps[i].identity, bounds);
    const d = weightedDistance(liveN, snapN, axisW);
    if (d < bestD) { bestD = d; bestIdx = i; }
  }

  const threshold = (interp.mode || 'gaussian') === 'gaussian'
    ? Math.max(0.04, (interp.sigma ?? 0.3) * 0.3)
    : 0.08;

  return {
    idx:       bestIdx,
    id:        snaps[bestIdx].id,
    distance:  bestD,
    threshold,
    locked:    bestD < threshold,
  };
}

// ── Tick ────────────────────────────────────────────────────────────────────
//
// The core work is in _evalStagingFrame(shouldEmit) — it computes the live
// relational vector, per-snapshot weights, per-channel blended values, and
// publishes them on S.staging.telemetry + fires S._onStagingTick.
//
// Two public entry points wrap it:
//   - tickStaging() — called from the engine's setInterval when running=true.
//                     Computes AND emits (MIDI/OSC sends).
//   - recomputeStagingTelemetry() — called from the posture-map's render loop.
//                     Computes only; never emits.  Runs even when the engine
//                     is stopped, so weights + readouts stay live while the
//                     performer is exploring/tuning but not ready to send.
//
// Callers must avoid double-computing when the engine is running — the
// posture map checks S.staging.running and only falls back to the recompute
// path when stopped.

function _evalStagingFrame(shouldEmit) {
  tickRelational();

  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const snaps = S.staging.snapshots;
  const preset = S.staging.mappingPreset;
  const interp = S.staging.interpolation || _defaultInterpolation();
  const tel = S.staging.telemetry;

  tel.lastTickAt = now;
  tel.tickCount = ++_tickCount;

  const identityRaw = identityVectorFromRelational(S.staging.relational);
  tel.identityRaw = identityRaw;

  if (snaps.length === 0) {
    tel.weights = [];
    tel.identityNorm = identityRaw.slice();
    tel.perChannel = {};
    S._onStagingTick?.();
    return;
  }

  const bounds = _computeNormBounds(snaps);
  const identityNorm = _normalizeIdentity(identityRaw, bounds);
  const anchors = _normalizeSnapshots(snaps, bounds);

  // Axis-weight array in identity-key order.
  const axisW = IDENTITY_KEYS.map(k => interp.axisWeights?.[k] ?? 1);
  const weights = computeWeights(interp.mode || 'gaussian', identityNorm, anchors, {
    sigma:       interp.sigma,
    k:           interp.k,
    falloff:     interp.falloff,
    axisWeights: axisW,
  });

  tel.weights = weights;
  tel.identityNorm = identityNorm;

  // Blend per channel and (conditionally) emit.
  const channels = preset?.channels || [];
  const perChannel = {};
  for (const ch of channels) {
    let pre = 0;
    let contributions = 0;
    for (let i = 0; i < snaps.length; i++) {
      const w = weights[i];
      if (!w) continue;
      const v = snaps[i].values?.[ch.name];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      pre += w * v;
      contributions += w;
    }
    // If some snapshots didn't define the channel, renormalize against the
    // subset that did — otherwise the output droops toward zero.
    if (contributions > 0 && contributions < 1) pre = pre / contributions;

    let emit;
    if (shouldEmit) {
      emit = _emitChannel(ch, pre);
      if (emit.status === 'sent') _totalEmit++;
    } else {
      // Engine stopped (or recompute-only caller): report "idle" so the UI
      // shows pre values without faking a wire number.
      emit = { status: 'idle', wire: null };
    }

    perChannel[ch.name] = {
      pre,
      wire: emit.wire,
      status: emit.status,
      contributions,
    };

    if (shouldEmit && S.staging.logging) {
      console.log(
        `[staging] ${ch.name} pre=${pre.toFixed(4)} wire=${emit.wire} [${emit.status}]`
      );
    }
  }
  tel.perChannel = perChannel;
  tel.totalEmit = _totalEmit;

  // Notify UI — kept as a single callback hook so ui-staging.js can redraw
  // readouts without forcing this module to know about the DOM.
  S._onStagingTick?.();
}

export function tickStaging() {
  _ensureStaging();
  if (!S.staging.running) return;
  _evalStagingFrame(true);
}

// Compute weights + telemetry without emitting.  Safe to call at any rate;
// meant to be driven from a UI render loop so readouts stay live when the
// engine isn't running.
export function recomputeStagingTelemetry() {
  _ensureStaging();
  _evalStagingFrame(false);
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export function startStaging() {
  _ensureStaging();
  if (_timer) return;
  _startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  S.staging.running = true;
  saveStaging();
  _timer = setInterval(tickStaging, DEFAULT_TICK_MS);
}

export function stopStaging() {
  if (!_timer) {
    if (S.staging) {
      S.staging.running = false;
      saveStaging();
    }
    return;
  }
  clearInterval(_timer);
  _timer = null;
  if (S.staging) {
    S.staging.running = false;
    saveStaging();
  }
}

export function setInterpolation(partial) {
  _ensureStaging();
  const current = S.staging.interpolation || _defaultInterpolation();
  S.staging.interpolation = { ...current, ...partial };
  if (partial.axisWeights) {
    S.staging.interpolation.axisWeights = { ...current.axisWeights, ...partial.axisWeights };
  }
  saveStaging();
}

export function setLogging(on) {
  _ensureStaging();
  S.staging.logging = !!on;
  saveStaging();
}

export function getStagingRuntime() {
  return {
    running:   !!(S.staging && S.staging.running),
    startedAt: _startedAt,
    tickCount: _tickCount,
    totalEmit: _totalEmit,
  };
}

/**
 * Bootstrap — loads persisted state into S.staging and (optionally) starts the
 * engine if it was running last session.  Called once at startup from main.js.
 */
export function initSnapshotEngine({ autoStart = false } = {}) {
  _ensureStaging();
  loadStaging();
  if (autoStart && S.staging.running) {
    // Clear running flag first — startStaging will set it again, and this
    // ensures the timer actually gets created even if save was mid-state.
    S.staging.running = false;
    startStaging();
  }
}
