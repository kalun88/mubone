// ============================================================================
// accessory-registry.js — x-IMU3 serial accessory channels
//
// Turns serial-accessory payloads (relayed from imu-setup.js via the
// S._onAccessoryData hook) into control values.
//
// The only accessory type today is the x-IMU3-SA-A8: 8 analogue inputs,
// 12-bit, fixed 100 Hz, emitted as comma-separated volts on a 3.0 V rail.
// The x-IMU3 passes the payload through verbatim (manual §8.2.14), so the
// CSV-of-volts format is the A8's, not the sensor's — a different accessory
// would need its own parser here.  Format assumptions are marked A8-ONLY.
//
// Each channel declares a role (pot / slider / button) and targets an action
// from the shared ACTIONS registry that midi.js publishes on S.  Dispatch goes
// through S._dispatchAction, so this module never imports midi.js — same
// callback-hook convention the rest of the app uses to dodge circular imports.
//
// Resolution: dispatchAction's domain is 0–127 but not integer-only, so pots
// pass a float and keep their full 12-bit resolution through the ccFn's /127.
//
// Continuous signal path:
//   volts → cal → invert → smooth → deadband → curve → output window → ×127
// The last two are the scale stage (scale.js), stored per channel as curve /
// outLo / outHi.  It sits in the normalised 0–1 domain, before the ×127, so it
// works against any destination without knowing what that destination is.
//
// Initialised from main.js alongside the UI in ui-accessory.js.  Also exposed
// on `window.acc` for console work — every table control has an equivalent
// method (setRole, setAction, armCalibration, dump, watch), addressed by PAD
// NUMBER 1–8 to match the silkscreen.
// ============================================================================

import {
  S, DEBUG,
  ACC_CHANNEL_COUNT, ACC_RAIL_VOLTS, ACC_STALE_MS, ACC_WATCHDOG_MS, ACC_RATE_WINDOW_MS,
  ACC_DEFAULT_SMOOTH, ACC_DEFAULT_DEADBAND, ACC_DEFAULT_HI, ACC_DEFAULT_LO,
} from './state.js';
import { getDevices, sendCommandTo } from './imu-setup.js';
import { scaleControl } from './scale.js';

// ── Tuning ──────────────────────────────────────────────────────────────────
// Constants live in state.js per CLAUDE.md; aliased here for readability.

const CHANNEL_COUNT    = ACC_CHANNEL_COUNT;
const RAIL_VOLTS       = ACC_RAIL_VOLTS;
const STALE_MS         = ACC_STALE_MS;
const WATCHDOG_MS      = ACC_WATCHDOG_MS;
const RATE_WINDOW_MS   = ACC_RATE_WINDOW_MS;

const DEFAULT_SMOOTH   = ACC_DEFAULT_SMOOTH;
const DEFAULT_DEADBAND = ACC_DEFAULT_DEADBAND;
const DEFAULT_HI       = ACC_DEFAULT_HI;
const DEFAULT_LO       = ACC_DEFAULT_LO;

const STORAGE_KEY      = 'mubone-accessory-a8';
const SERIAL_MODE_ACCESSORY = 2; // x-IMU3 manual §11.1.18 — confirmed by read-back

export const ROLES = ['unused', 'pot', 'slider', 'button'];

// pot and slider are deliberately the same code path — both are continuous
// 0–1 controls.  The distinction is labelling only, so the table can say what
// the hardware physically is.  Don't add behaviour to one without the other.
const CONTINUOUS = new Set(['pot', 'slider']);

// ── State ───────────────────────────────────────────────────────────────────

let _channels = [];
let _lastDev  = null;
let _lastAt   = 0;
let _wasStale = true;
let _watchdog = null;
let _inited   = false;

const _rateStamps = [];

// Presence transitions (data starts / goes stale), for status chrome that has
// to stay right while the modal is closed. Rides the watchdog that is already
// running rather than adding a second always-on timer near the grain
// scheduler — it fires on the edge only, so an idle app costs one boolean
// compare per 250 ms tick.
const _presenceListeners = new Set();
function _notifyPresence(live) {
  for (const cb of _presenceListeners) { try { cb(live); } catch (_) {} }
}

function makeChannel(i) {
  return {
    idx: i,
    label: String(i + 1),        // matches the silkscreen on the A8 pads
    role: 'unused',
    actionId: null,

    cal: { min: 0, max: RAIL_VOLTS },
    invert: false,
    smooth: DEFAULT_SMOOTH,
    deadband: DEFAULT_DEADBAND,
    hi: DEFAULT_HI,
    lo: DEFAULT_LO,

    // Scale stage — see scale.js.  Stored NORMALISED (0–1 of the destination's
    // travel), not in the destination's units: the table converts to cents/Hz
    // for display using the action's range.  Keeping the storage normalised is
    // what lets you retarget a pot from pitch to cutoff without the saved
    // bounds becoming nonsense.
    curve: 1,        // response exponent — 1 linear, >1 fine at the bottom
    outLo: 0,        // output window, 0–1.  outLo > outHi reverses the throw.
    outHi: 1,

    // runtime — not persisted
    raw: 0,          // volts as received
    value: 0,        // normalised 0–1 after cal/invert/smoothing
    state: 0,        // button state
    _smoothed: null,
    _sent: null,
    _learning: false,
  };
}

// ── Persistence ─────────────────────────────────────────────────────────────
// Config only — never runtime values.  Same localStorage pattern as the MIDI
// and key mappings in midi.js.

const PERSISTED = ['role', 'actionId', 'invert', 'smooth', 'deadband', 'hi', 'lo',
                   'curve', 'outLo', 'outHi'];

export function saveConfig() {
  try {
    const out = _channels.map(ch => {
      const o = { cal: { min: ch.cal.min, max: ch.cal.max } };
      for (const k of PERSISTED) o[k] = ch[k];
      return o;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch (_) { /* private mode — config just won't survive the session */ }
}

export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return;
    saved.forEach((s, i) => {
      const ch = _channels[i];          // 0-based: array order, not pad number
      if (!ch || !s) return;
      for (const k of PERSISTED) if (s[k] !== undefined) ch[k] = s[k];
      if (s.cal && Number.isFinite(s.cal.min) && Number.isFinite(s.cal.max)) {
        ch.cal.min = s.cal.min;
        ch.cal.max = s.cal.max;
      }
      if (!ROLES.includes(ch.role)) ch.role = 'unused';
    });
  } catch (_) { /* corrupt config — fall back to defaults rather than throw */ }
}

export function resetConfig() {
  _channels = Array.from({ length: CHANNEL_COUNT }, (_, i) => makeChannel(i));
  saveConfig();
  return _channels;
}

// ── Intake ──────────────────────────────────────────────────────────────────

function handleAccessoryData(dev, fields) {
  _lastDev = dev;
  _lastAt  = performance.now();
  _rateStamps.push(_lastAt);

  // A8-ONLY: fields are volts, one per channel, in pad order 1–8.
  const n = Math.min(CHANNEL_COUNT, fields.length);
  for (let i = 0; i < n; i++) {
    const volts = parseFloat(fields[i]);
    if (!Number.isFinite(volts)) continue;   // '?' substitution on non-printable bytes

    const ch = _channels[i];            // 0-based: field order == pad order
    ch.raw = volts;

    if (ch._learning) {
      if (volts < ch.cal.min) ch.cal.min = volts;
      if (volts > ch.cal.max) ch.cal.max = volts;
    }

    // Skip everything else for unused channels — at 8ch × 100Hz this loop is
    // the only thing standing between an idle accessory and 800 needless
    // dispatches a second on the same thread as the grain scheduler.
    if (ch.role === 'unused') continue;
    processChannel(ch, volts);
  }
}

// 'trigger' | 'hold' | 'cc' | null — resolved lazily against the registry
// midi.js publishes.  Only called on button edges, so the scan is free.
function actionType(id) {
  return (S._actions || []).find(a => a.id === id)?.type ?? null;
}

function processChannel(ch, volts) {
  const span = ch.cal.max - ch.cal.min;
  let v = span > 1e-6 ? (volts - ch.cal.min) / span : 0;
  v = v < 0 ? 0 : v > 1 ? 1 : v;
  if (ch.invert) v = 1 - v;

  if (ch.role === 'button') {
    // Schmitt trigger — once high, stays high until it falls below lo.  The
    // dead zone between lo and hi is what kills contact flicker; don't let the
    // two thresholds meet or this degrades to a bare comparison.
    const next = ch.state ? (v < ch.lo ? 0 : 1) : (v > ch.hi ? 1 : 0);
    ch.value = v;
    if (next === ch.state) return;
    ch.state = next;
    if (!ch.actionId) return;
    // Only 'hold' actions get the release edge.  A 'trigger' is a bang — it
    // fires on press and must not fire again on release, or an undo bound to a
    // button undoes twice per push.  midi.js draws the same line (it suppresses
    // note-off for triggers); this mirrors it so a button behaves identically
    // whether it's bound here or over MIDI.
    if (next) S._dispatchAction?.(ch.actionId, 127);
    else if (actionType(ch.actionId) === 'hold') S._dispatchAction?.(ch.actionId, 0);
    return;
  }

  if (!CONTINUOUS.has(ch.role)) return;

  const a = ch.smooth;
  ch._smoothed = (ch._smoothed === null) ? v : ch._smoothed + a * (v - ch._smoothed);
  // Snap the rails: a one-pole filter approaches its target asymptotically, so
  // without this a fully-swept pot never quite reaches 0 or 1.
  let out = ch._smoothed;
  if (v <= 0) out = 0;
  if (v >= 1) out = 1;
  ch.value = out;

  // Deadband is checked on the RAW normalised value, before shaping.  Checking
  // it after would make the effective threshold depend on the output window: a
  // pot squeezed into a narrow range would shrink every step below the deadband
  // and stop sending entirely.
  if (ch._sent !== null && Math.abs(out - ch._sent) < ch.deadband) return;
  ch._sent = out;
  if (!ch.actionId) return;
  const shaped = scaleControl(out, { curve: ch.curve, lo: ch.outLo, hi: ch.outHi });
  S._dispatchAction?.(ch.actionId, shaped * 127);   // float — keeps 12-bit
}

// ── Staleness watchdog ──────────────────────────────────────────────────────
// The adapter hot-plugs with no event, so silence is the only unplug signal.

function tickWatchdog() {
  const stale = !isReceiving();
  if (stale && !_wasStale) {
    _wasStale = true;
    // Release held buttons: a stuck 'hold' action (erase brush, trace) would
    // otherwise stay engaged after an accidental unplug.  Continuous channels
    // deliberately freeze at their last value instead — a pot snapping to zero
    // mid-set is a hole in the performance, a frozen one is recoverable.
    for (const ch of _channels) {
      if (ch.role === 'button' && ch.state) {
        ch.state = 0;
        // Same rule as a normal release: only 'hold' actions take the 0.
        // Sending it to a trigger would fire it a second time on unplug.
        if (ch.actionId && actionType(ch.actionId) === 'hold') {
          S._dispatchAction?.(ch.actionId, 0);
        }
      }
    }
    DEBUG && console.log('[accessory] data stale — held buttons released');
    _notifyPresence(false);
  } else if (!stale && _wasStale) {
    _wasStale = false;
    DEBUG && console.log('[accessory] data resumed');
    _notifyPresence(true);
  }
}

/** Subscribe to accessory presence edges. Called with `true` when data starts
 *  flowing and `false` when it goes stale (STALE_MS with nothing arriving —
 *  the A8 hot-plugs with no event, so a timeout IS the unplug signal). */
export function onAccessoryPresenceChange(cb) { _presenceListeners.add(cb); }

// ── Public API ──────────────────────────────────────────────────────────────
// Everything public is addressed by PAD NUMBER (1–8) to match the silkscreen on
// the A8 and the channel labels in the x-IMU3 GUI.  The array stays 0-based
// internally; this is the only place the two conventions meet.  Doing the
// arithmetic in your head at the console is how you calibrate the wrong pot.

function byPad(pad) {
  const ch = _channels[pad - 1];
  if (!ch) console.warn(`[accessory] no pad ${pad} — the A8 has pads 1–${CHANNEL_COUNT}`);
  return ch || null;
}


export function initAccessory() {
  // Channel state is built once, but the hook and watchdog are (re)installed on
  // every call — console debugging routinely stomps S._onAccessoryData with a
  // temporary probe, and an early return would leave the registry permanently
  // deaf with no visible sign of it.  Idempotent, not once-only.
  if (!_inited) {
    _channels = Array.from({ length: CHANNEL_COUNT }, (_, i) => makeChannel(i));
    loadConfig();
    _inited = true;
  }
  S._onAccessoryData = handleAccessoryData;
  if (_watchdog) clearInterval(_watchdog);
  _watchdog = setInterval(tickWatchdog, WATCHDOG_MS);
  try { window.acc = api; } catch (_) {}
  DEBUG && console.log('[accessory] registry ready — window.acc');
  return _channels;
}

export function stopAccessory() {
  if (S._onAccessoryData === handleAccessoryData) S._onAccessoryData = null;
  if (_watchdog) { clearInterval(_watchdog); _watchdog = null; }
  _inited = false;
}

export function getChannels() { return _channels; }

export function isReceiving() {
  return _lastAt > 0 && (performance.now() - _lastAt) < STALE_MS;
}

export function getRateHz() {
  const now = performance.now();
  while (_rateStamps.length && now - _rateStamps[0] > RATE_WINDOW_MS) _rateStamps.shift();
  return _rateStamps.length;
}

export function setRole(pad, role) {
  const ch = byPad(pad);
  if (!ch || !ROLES.includes(role)) return false;
  ch.role = role;
  // Reset runtime so a role change can't inherit a stale smoothing/button state
  ch._smoothed = null;
  ch._sent = null;
  ch.state = 0;
  saveConfig();
  return true;
}

export function setAction(pad, actionId) {
  const ch = byPad(pad);
  if (!ch) return false;
  if (actionId && !(S._actions || []).some(a => a.id === actionId)) {
    console.warn(`[accessory] unknown action id: ${actionId}`);
    return false;
  }
  ch.actionId = actionId || null;
  saveConfig();
  return true;
}

// Actions a given role can legally target: buttons fire trigger/hold, pots and
// sliders drive cc.  Used by the console today, by the modal's dropdown later.
export function listActions(role) {
  const wanted = (role === 'button') ? ['trigger', 'hold'] : ['cc'];
  return (S._actions || [])
    .filter(a => a.id && wanted.includes(a.type))
    .map(a => ({ id: a.id, label: a.label, osc: a.osc, type: a.type }));
}

const NUMERIC_OPTIONS = {
  // key      clamp lo, clamp hi
  smooth:   [0, 1],
  deadband: [0, 1],
  hi:       [0, 1],
  lo:       [0, 1],
  outLo:    [0, 1],
  outHi:    [0, 1],
  // A curve of 0 or below would collapse the whole throw onto one value, and
  // beyond ~10 the bottom of the pot is dead travel. Clamp rather than reject:
  // a numbox that silently refuses your input is worse than one that clips.
  curve:    [0.1, 10],
};

export function setOption(pad, key, value) {
  const ch = byPad(pad);
  if (!ch) return false;
  if (key === 'invert') { ch.invert = !!value; saveConfig(); return true; }
  const bounds = NUMERIC_OPTIONS[key];
  if (!bounds) return false;
  const v = Number(value);
  if (!Number.isFinite(v)) return false;
  ch[key] = v < bounds[0] ? bounds[0] : v > bounds[1] ? bounds[1] : v;
  saveConfig();
  return true;
}

/** Back to linear, full travel. The table's reset affordance and a console verb. */
export function resetScale(pad) {
  const ch = byPad(pad);
  if (!ch) return false;
  ch.curve = 1;
  ch.outLo = 0;
  ch.outHi = 1;
  saveConfig();
  return true;
}

// ── Calibration ─────────────────────────────────────────────────────────────
// Explicitly armed, never passive: min/max must not drift during a performance.

export function armCalibration(pad) {
  const ch = byPad(pad);
  if (!ch) return false;
  ch._learning = true;
  ch.cal.min = Infinity;
  ch.cal.max = -Infinity;
  DEBUG && console.log(`[accessory] ch${ch.label} learning — sweep it, then endCalibration(${pad})`);
  return true;
}

export function endCalibration(pad) {
  const ch = byPad(pad);
  if (!ch || !ch._learning) return false;
  ch._learning = false;
  if (!Number.isFinite(ch.cal.min) || !Number.isFinite(ch.cal.max) ||
      ch.cal.max - ch.cal.min < 0.05) {
    ch.cal.min = 0;
    ch.cal.max = RAIL_VOLTS;
    console.warn(`[accessory] ch${ch.label} calibration too narrow — reset to 0–${RAIL_VOLTS} V`);
    return false;
  }
  ch._smoothed = null;
  ch._sent = null;
  saveConfig();
  DEBUG && console.log(`[accessory] ch${ch.label} calibrated ${ch.cal.min.toFixed(3)}–${ch.cal.max.toFixed(3)} V`);
  return true;
}

// ── Serial mode ─────────────────────────────────────────────────────────────
// Read on connect by imu-setup; only ever written by explicit user action.

export function getSerialMode() {
  return _lastDev?.serialMode ?? [...getDevices().values()][0]?.serialMode ?? null;
}

export function isAccessoryModeSet() {
  return getSerialMode() === SERIAL_MODE_ACCESSORY;
}

// Manual override.  The connect handshake already enforces serial_mode = 2 on
// every device (js/ximu-settings.js), so this is not needed to get an SA-A8
// working — it's here to write the setting with `save` on demand, and to turn
// accessory mode *off*, which the next connect will undo.
//
// Defaults to EVERY connected device.  Accessories get swapped between hosts
// mid-show, so every x-imu3 needs to be standing ready to receive one — fixing
// whichever device happened to send the last S message is exactly backwards.
// Pass a serial number to target one:  acc.setAccessoryMode(true, 'A1B2C3')
export function setAccessoryMode(on = true, sn = null) {
  const devs = sn
    ? [getDevices().get(sn)].filter(Boolean)
    : [...getDevices().values()].filter(d => d.transport !== 'osc');

  if (!devs.length) {
    console.warn(sn ? `[accessory] no connected device ${sn}` : '[accessory] no connected devices');
    return false;
  }

  for (const dev of devs) {
    sendCommandTo(dev, { serial_mode: on ? SERIAL_MODE_ACCESSORY : 0 });
    sendCommandTo(dev, { apply: null });
    sendCommandTo(dev, { save: null });
    sendCommandTo(dev, { serial_mode: null });   // read back to confirm
    console.log(`[accessory] ${dev.name} (${dev.sn}): serial_mode → ${on ? SERIAL_MODE_ACCESSORY : 0}, saved to flash`);
  }
  return true;
}

// ── Console diagnostics ─────────────────────────────────────────────────────

export function dump() {
  console.table(_channels.map(ch => ({
    ch: ch.label,
    role: ch.role,
    raw_V: ch.raw.toFixed(4),
    norm: ch.value.toFixed(4),
    state: ch.role === 'button' ? ch.state : '',
    cal: `${ch.cal.min.toFixed(2)}–${ch.cal.max.toFixed(2)}`,
    scale: ch.role === 'button' ? '' : `${ch.outLo.toFixed(2)}–${ch.outHi.toFixed(2)} γ${ch.curve}`,
    action: ch.actionId || '—',
  })));
  // Distinguish "nothing has ever arrived" from "it stopped" — dump() called in
  // the same tick as initAccessory() would otherwise report a bare false and
  // send you hunting for a fault that doesn't exist yet.
  const status = _lastAt === 0
    ? 'waiting for first S message'
    : (isReceiving() ? 'receiving' : `stale (${Math.round(performance.now() - _lastAt)} ms since last)`);
  console.log(
    `${status}   rate: ${getRateHz()} Hz   ` +
    `serial_mode: ${getSerialMode() ?? '?'}${isAccessoryModeSet() ? ' (Accessory)' : ''}`
  );
}

// Live console readout — watch(0) to stop.
let _watchTimer = null;
export function watch(hz = 4) {
  if (_watchTimer) { clearInterval(_watchTimer); _watchTimer = null; }
  if (!hz) return;
  _watchTimer = setInterval(() => {
    console.log(_channels.map(ch =>
      `${ch.label}:${ch.raw.toFixed(3)}${ch.role !== 'unused' ? `→${ch.value.toFixed(3)}` : ''}`
    ).join('  '));
  }, 1000 / hz);
}

const api = {
  initAccessory, stopAccessory, getChannels, isReceiving, getRateHz,
  setRole, setAction, setOption, listActions, resetScale,
  armCalibration, endCalibration,
  getSerialMode, isAccessoryModeSet, setAccessoryMode,
  saveConfig, loadConfig, resetConfig,
  dump, watch, ROLES,
};

export default api;
