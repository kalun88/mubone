// ============================================================================
// osc-stream.js — Pump live posture + per-sensor euler out as OSC for Max
//
// Mubone produces calibrated sensor data and a frame-cancelled Δ-orientation
// (cursor relative to a body-mounted "frame" sensor); this module forwards
// both to an external host (Max, SuperCollider, etc.) so all the actual
// mapping logic can live there.  Mubone is just the data source.
//
// Schema (both messages use roll / pitch / yaw order so a single
// [unpack f f f] in Max works for either):
//   /delta         droll dpitch daz            (3 floats, degrees)
//   /sensor/<name> roll  pitch  yaw            (3 floats, degrees, calibrated)
//
// Ranges: roll ±180°, pitch ±90°, yaw ±180°.  /delta is cursor-relative-to-
// frame (frame cancellation already applied); /sensor is per-slot post-tare,
// post-axis-map.
//
// "Calibrated" = post-tare, post-axis-map — exactly what the rest of the app
// uses internally (slot.zeroEuler, kept fresh by handleSlotQuaternion).
//
// Sensor names get a quick scrub (anything outside [A-Za-z0-9_-] becomes "_")
// so pathological device names can't produce malformed OSC addresses.
//
// Transport:
//   sendOSCExternal() (osc-out.js) — real OSC binary via the Electron bridge.
//   In browser mode the send is a no-op with one warn from osc-out itself.
//
// Lifecycle:
//   initOSCStream()                — load persisted dest+running flag, restart if needed
//   setOSCStreamDest(host, port)   — update destination, persists to localStorage
//   startOSCStream() / stopOSCStream()
//
// Telemetry: S.oscStream.lastSent = { delta:[...], sensors:{name→[r,p,y]}, at }
// — refreshed every tick, consumed by the staging UI's stream-out readout.
// ============================================================================

import { S } from './state.js';
import { getRegistry } from './sensor-registry.js';
import { tickRelational } from './relational-features.js';
import { sendOSCExternal } from './osc-out.js';

const LS_KEY        = 'mubone_osc_stream';
const DEFAULT_HZ    = 33;
const DEFAULT_HOST  = '127.0.0.1';
const DEFAULT_PORT  = 7400;

let _timer = null;

// ── State helpers ───────────────────────────────────────────────────────────

function _ensureState() {
  if (!S.oscStream) {
    S.oscStream = {
      host:    DEFAULT_HOST,
      port:    DEFAULT_PORT,
      running: false,
      rateHz:  DEFAULT_HZ,
      lastSent: { delta: null, sensors: {}, at: 0 },
    };
  }
  if (!S.oscStream.lastSent) {
    S.oscStream.lastSent = { delta: null, sensors: {}, at: 0 };
  }
  return S.oscStream;
}

function _persist() {
  const s = _ensureState();
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      host: s.host, port: s.port, running: s.running, rateHz: s.rateHz,
    }));
  } catch (_) {}
}

function _loadPersisted() {
  let raw;
  try { raw = localStorage.getItem(LS_KEY); } catch (_) { return; }
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    const s = _ensureState();
    if (typeof data.host    === 'string') s.host    = data.host;
    if (Number.isFinite(data.port))       s.port    = data.port;
    if (typeof data.running === 'boolean') s.running = data.running;
    if (Number.isFinite(data.rateHz))     s.rateHz  = data.rateHz;
  } catch (_) {}
}

// OSC addresses must be a single token after each `/`; sensor names from the
// wild can contain spaces, dots, brackets, etc.  Replace anything unsafe with
// "_" — collisions are the user's problem to rename around.
function _sanitizeName(name) {
  return String(name).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'sensor';
}

// ── Tick ────────────────────────────────────────────────────────────────────

function _tick() {
  const s = _ensureState();
  if (!s.running) return;

  // Refresh the relational vector ourselves — neither the snapshot engine nor
  // the posture map needs to be running for this stream to work.
  tickRelational();

  const rel = S.staging?.relational;
  const lastSent = s.lastSent;

  // /delta — only emit if we've got a cursor (otherwise daz/dpitch/droll are
  // stale/zero and we'd send misleading values).
  // Wire order: droll, dpitch, daz — matches per-sensor (roll, pitch, yaw)
  // so the same Max [unpack f f f] handles both addresses.
  if (rel?.hasCursor) {
    const droll  = +(rel.droll  || 0);
    const dpitch = +(rel.dpitch || 0);
    const daz    = +(rel.daz    || 0);
    sendOSCExternal(s.host, s.port, '/delta', [droll, dpitch, daz]);
    lastSent.delta = [droll, dpitch, daz];
  } else {
    lastSent.delta = null;
  }

  // /sensor/<name> — every slot with calibrated euler ready
  const sensorsOut = {};
  for (const slot of getRegistry().values()) {
    const ze = slot.zeroEuler;
    if (!ze) continue;
    const name = _sanitizeName(slot.name);
    const r = +(ze.x || 0), p = +(ze.y || 0), y = +(ze.z || 0);
    sendOSCExternal(s.host, s.port, '/sensor/' + name, [r, p, y]);
    sensorsOut[slot.name] = [r, p, y];   // keep readout keyed by original name
  }
  lastSent.sensors = sensorsOut;
  lastSent.at = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // Optional UI hook — stream-out readout listens here.
  S._onOSCStreamTick?.();
}

// ── Public API ──────────────────────────────────────────────────────────────

export function setOSCStreamDest(host, port) {
  const s = _ensureState();
  if (typeof host === 'string' && host.trim()) s.host = host.trim();
  if (Number.isFinite(port) && port > 0 && port <= 65535) s.port = Math.floor(port);
  _persist();
}

export function startOSCStream() {
  const s = _ensureState();
  if (_timer) return;
  s.running = true;
  _persist();
  const periodMs = Math.max(5, Math.round(1000 / (s.rateHz || DEFAULT_HZ)));
  _timer = setInterval(_tick, periodMs);
}

export function stopOSCStream() {
  const s = _ensureState();
  if (_timer) { clearInterval(_timer); _timer = null; }
  s.running = false;
  _persist();
  s.lastSent = { delta: null, sensors: {}, at: 0 };
  S._onOSCStreamTick?.();
}

export function isOSCStreamRunning() {
  return !!(S.oscStream && S.oscStream.running && _timer);
}

export function getOSCStreamDest() {
  const s = _ensureState();
  return { host: s.host, port: s.port };
}

/**
 * Bootstrap.  Loads persisted host/port + running flag and (if it was running
 * last session) starts the stream.  Idempotent.
 */
export function initOSCStream() {
  _ensureState();
  _loadPersisted();
  // Saved-running flag → restart, but flip it off first so startOSCStream
  // can take its normal path (matches the snapshot engine's pattern).
  if (S.oscStream.running) {
    S.oscStream.running = false;
    startOSCStream();
  }
}
