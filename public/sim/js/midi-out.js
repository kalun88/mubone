// ============================================================================
// midi-out.js — WebMIDI output wrapper (staging Change A)
//
// Separate from js/midi.js, which handles MIDI *input* for action triggers
// (mute, undo, sweep, etc.). This module only sends MIDI CC out for the
// staging module to drive external synths via a DAW or MIDI-capable host.
//
// WebMIDI requires no special permission beyond the browser prompt on first
// request. Works in Electron and recent Chromium-based browsers. Not enabled
// automatically — call initMIDIOut() when the staging module is ready.
//
// CC resolution:
//   - 7-bit (default): one CC message, value 0–127.
//   - 14-bit: paired CC MSB on cc# and LSB on cc#+32 (standard MIDI
//     high-resolution convention). Value 0–16383. Use for slow morphs where
//     7-bit stepping is audible.
//
// Throttling: per (deviceId, channel, cc) tuple, min interval between sends.
// Consecutive identical values are deduped. The mapping engine ticks at ~30Hz
// so the throttle is mostly defensive.
// ============================================================================

const DEFAULT_THROTTLE_MS = 5;   // min interval per tuple — ~200Hz cap

let _access = null;              // MIDIAccess instance once granted
let _initPromise = null;         // dedup concurrent init calls
let _stateListeners = [];        // fired on device connect/disconnect
let _totalSent = 0;

// key = `${deviceId}:${channel}:${cc}` → per-tuple state
const _state = new Map();

function _key(deviceId, channel, cc) {
  return `${deviceId}:${channel}:${cc}`;
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

/**
 * Request WebMIDI access. Safe to call multiple times — returns the same
 * promise on repeat calls. Resolves with true if MIDI is available, false
 * otherwise. Never throws.
 */
export function initMIDIOut() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      console.warn('[midi-out] WebMIDI not supported in this runtime');
      return false;
    }
    try {
      _access = await navigator.requestMIDIAccess({ sysex: false });
      _access.onstatechange = (evt) => {
        for (const fn of _stateListeners) {
          try { fn(evt); } catch (e) { console.warn('[midi-out] listener error:', e); }
        }
      };
      return true;
    } catch (e) {
      console.warn('[midi-out] requestMIDIAccess failed:', e);
      _access = null;
      return false;
    }
  })();
  return _initPromise;
}

/** True if WebMIDI access has been granted and at least one output is visible. */
export function isMIDIOutAvailable() {
  if (!_access) return false;
  // Even if access is granted, there might be no outputs connected yet.
  return _access.outputs.size > 0;
}

/** True if the WebMIDI init attempt has completed (regardless of outcome). */
export function isMIDIOutInitialized() {
  return _access !== null;
}

/**
 * Return an array of { id, name, manufacturer, state } for every output
 * currently visible. Order matches the WebMIDI map iteration order.
 */
export function listOutputs() {
  if (!_access) return [];
  const out = [];
  for (const [id, device] of _access.outputs) {
    out.push({
      id,
      name: device.name || '(unnamed)',
      manufacturer: device.manufacturer || '',
      state: device.state,
      connection: device.connection,
    });
  }
  return out;
}

/** Register a callback to fire on device connect/disconnect. Returns unsub fn. */
export function onStateChange(cb) {
  _stateListeners.push(cb);
  return () => {
    const i = _stateListeners.indexOf(cb);
    if (i >= 0) _stateListeners.splice(i, 1);
  };
}

function _getOutput(deviceId) {
  if (!_access) return null;
  return _access.outputs.get(deviceId) || null;
}

/**
 * Send a CC message. Returns status string:
 *   'sent' | 'deduped' | 'throttled' | 'unavailable' | 'invalid'
 *
 * @param deviceId  WebMIDI output id (from listOutputs()[i].id)
 * @param channel   MIDI channel 1–16 (user-facing convention; wire value is 0–15)
 * @param cc        CC number 0–127
 * @param value     Value 0–127 for 7-bit, 0–16383 for 14-bit
 * @param opts      { bits: 7 | 14 } — default 7
 */
export function sendCC(deviceId, channel, cc, value, opts = {}) {
  if (!_access) return 'unavailable';
  const output = _getOutput(deviceId);
  if (!output) return 'unavailable';

  const bits = opts.bits === 14 ? 14 : 7;

  // Validate
  if (!Number.isInteger(channel) || channel < 1 || channel > 16) return 'invalid';
  if (!Number.isInteger(cc) || cc < 0 || cc > 127) return 'invalid';
  if (bits === 14 && cc > 95) return 'invalid';  // CC+32 must fit in 0–127
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'invalid';

  // Clamp + quantize
  const maxVal = bits === 14 ? 16383 : 127;
  const vQuant = Math.max(0, Math.min(maxVal, Math.round(value)));

  const k = _key(deviceId, channel, cc);
  const st = _getOrCreate(k);

  // Dedup: skip identical
  if (vQuant === st.lastValue) {
    st.suppressed++;
    return 'deduped';
  }

  // Throttle
  const now = _now();
  if (now - st.lastSentAt < DEFAULT_THROTTLE_MS) {
    st.suppressed++;
    return 'throttled';
  }

  try {
    const chWire = channel - 1;           // 0–15 on the wire
    const statusByte = 0xB0 | chWire;     // CC status for this channel

    if (bits === 14) {
      const msb = (vQuant >> 7) & 0x7F;
      const lsb = vQuant & 0x7F;
      output.send([statusByte, cc, msb]);
      output.send([statusByte, cc + 32, lsb]);
    } else {
      output.send([statusByte, cc, vQuant]);
    }

    st.lastSentAt = now;
    st.lastValue = vQuant;
    st.sent++;
    _totalSent++;
    return 'sent';
  } catch (e) {
    console.warn('[midi-out] send failed:', e);
    return 'invalid';
  }
}

/**
 * Like sendCC but skips dedup (for explicit test buttons). Still throttled.
 */
export function testSend(deviceId, channel, cc, value, opts = {}) {
  if (!_access) return 'unavailable';
  const output = _getOutput(deviceId);
  if (!output) return 'unavailable';

  const bits = opts.bits === 14 ? 14 : 7;
  if (!Number.isInteger(channel) || channel < 1 || channel > 16) return 'invalid';
  if (!Number.isInteger(cc) || cc < 0 || cc > 127) return 'invalid';
  if (bits === 14 && cc > 95) return 'invalid';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'invalid';

  const maxVal = bits === 14 ? 16383 : 127;
  const vQuant = Math.max(0, Math.min(maxVal, Math.round(value)));

  const k = _key(deviceId, channel, cc);
  const st = _getOrCreate(k);
  const now = _now();
  if (now - st.lastSentAt < DEFAULT_THROTTLE_MS) return 'throttled';

  try {
    const chWire = channel - 1;
    const statusByte = 0xB0 | chWire;
    if (bits === 14) {
      const msb = (vQuant >> 7) & 0x7F;
      const lsb = vQuant & 0x7F;
      output.send([statusByte, cc, msb]);
      output.send([statusByte, cc + 32, lsb]);
    } else {
      output.send([statusByte, cc, vQuant]);
    }
    st.lastSentAt = now;
    st.lastValue = vQuant;
    st.sent++;
    _totalSent++;
    return 'sent';
  } catch (e) {
    console.warn('[midi-out] testSend failed:', e);
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

/** Clear internal throttle/dedup state. */
export function resetMIDIOut() {
  _state.clear();
}
