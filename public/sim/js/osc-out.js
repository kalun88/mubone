// ============================================================================
// osc-out.js — External OSC transport wrapper (staging Change A)
//
// Renderer-side wrapper for sending real OSC 1.0 binary to arbitrary host:port.
// Backed by electronBridge.sendOSCExternal. Browser mode (no Electron bridge)
// is a no-op with a one-time warning — the Max/WebSocket bridge is deprecated
// for this use case.
//
// Separate from osc.js's sendOSC(), which targets the internal relay on port
// 7501 with JSON payload and serves the joycon-GUI LED/rumble feedback loop.
// That path is unaffected by this module.
//
// Throttling: per (host, port, address) tuple, a minimum interval between
// successive sends. Consecutive identical single-value messages are deduped
// (skip when value hasn't changed). The mapping engine ticks at ~30Hz so the
// throttle is mostly defensive; it protects against future callers that push
// updates faster than the wire can absorb.
//
// Stats: per-tuple counters (sent, suppressed, lastValue, lastSentAt) exposed
// via getStats() for the diagnostics/telemetry UI.
// ============================================================================

const DEFAULT_THROTTLE_MS = 5;   // min interval per tuple — caps burst rate ~200Hz
let _browserWarned = false;
let _totalSent = 0;              // module-wide counter for quick-read UI

// key = `${host}:${port}:${address}` → per-tuple state
const _state = new Map();

function _key(host, port, address) {
  return `${host}:${port}:${address}`;
}

function _now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function _getOrCreate(k) {
  let st = _state.get(k);
  if (!st) {
    st = { lastValue: null, lastSentAt: 0, sent: 0, suppressed: 0 };
    _state.set(k, st);
  }
  return st;
}

/** True if real external OSC can be sent from this runtime. */
export function isOSCOutAvailable() {
  return !!(typeof window !== 'undefined' && window.electronBridge?.sendOSCExternal);
}

/**
 * Send an OSC message to an external destination. Throttled + deduped per tuple.
 * Returns:
 *   'sent'        — message went on the wire
 *   'deduped'     — skipped, identical to last sent single value
 *   'throttled'   — skipped, within min interval for this tuple
 *   'unavailable' — skipped, no Electron bridge (browser mode)
 *   'invalid'     — skipped, malformed args
 */
export function sendOSCExternal(host, port, address, values = []) {
  const bridge = typeof window !== 'undefined' ? window.electronBridge : null;
  if (!bridge?.sendOSCExternal) {
    if (!_browserWarned) {
      console.warn('[osc-out] External OSC requires Electron build — ignoring');
      _browserWarned = true;
    }
    return 'unavailable';
  }
  if (typeof host !== 'string' || !host) return 'invalid';
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return 'invalid';
  if (typeof address !== 'string' || !address.startsWith('/')) return 'invalid';

  const k = _key(host, port, address);
  const st = _getOrCreate(k);

  // Dedup: skip identical single-valued messages
  const isSingle = Array.isArray(values) && values.length === 1;
  if (isSingle && values[0] === st.lastValue) {
    st.suppressed++;
    return 'deduped';
  }

  // Throttle: cap outbound per tuple
  const now = _now();
  if (now - st.lastSentAt < DEFAULT_THROTTLE_MS) {
    st.suppressed++;
    return 'throttled';
  }

  try {
    bridge.sendOSCExternal(host, port, address, values);
    st.lastSentAt = now;
    st.lastValue = isSingle ? values[0] : null;
    st.sent++;
    _totalSent++;
    return 'sent';
  } catch (e) {
    console.warn('[osc-out] send failed:', e);
    return 'invalid';
  }
}

/**
 * Send without dedup (for explicit test-send buttons). Still throttled so a
 * user mashing the button doesn't flood the wire.
 */
export function testSend(host, port, address, values = []) {
  const bridge = typeof window !== 'undefined' ? window.electronBridge : null;
  if (!bridge?.sendOSCExternal) return 'unavailable';
  if (typeof host !== 'string' || !host) return 'invalid';
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return 'invalid';
  if (typeof address !== 'string' || !address.startsWith('/')) return 'invalid';

  const k = _key(host, port, address);
  const st = _getOrCreate(k);
  const now = _now();
  if (now - st.lastSentAt < DEFAULT_THROTTLE_MS) return 'throttled';

  try {
    bridge.sendOSCExternal(host, port, address, values);
    st.lastSentAt = now;
    const isSingle = Array.isArray(values) && values.length === 1;
    st.lastValue = isSingle ? values[0] : null;
    st.sent++;
    _totalSent++;
    return 'sent';
  } catch (e) {
    console.warn('[osc-out] testSend failed:', e);
    return 'invalid';
  }
}

/** Snapshot of per-tuple counters and module totals. For diagnostics. */
export function getStats() {
  const tuples = {};
  for (const [k, v] of _state.entries()) {
    tuples[k] = { ...v };
  }
  return { totalSent: _totalSent, tuples };
}

/** Clear internal throttle/dedup state. Call on destination change or reset. */
export function resetOSCOut() {
  _state.clear();
  _browserWarned = false;
}
