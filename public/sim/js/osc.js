// ============================================================================
// osc.js — shared OSC dispatcher + transport init
//
// All OSC messages, regardless of source, flow through handleOSC().
// Two transports, neither tied to any particular sender:
//
//   Electron  — electronBridge.onOSC (IPC from main process, UDP 7500)
//   Browser   — { address, values } JSON over ws://localhost:8080
//
// The WebSocket port is a published interface. proxy.js in this repo (x-IMU3
// UDP → WebSocket) is the implementation mubone maintains; mubone-joycon-gui
// ships another. Nothing here knows which is on the other end.
//
// Hosted origins skip the WebSocket entirely — see _bridgeReachable() — so the
// demo at mubone.org/sim has no OSC input at all, by design. With no relay
// running the browser falls back to mouse/gyro.
// ============================================================================

import { S, DEBUG, SEARCH_RADIUS_MIN, SEARCH_RADIUS_MAX, SEARCH_RADIUS_STEP, GATE_METER_MAX } from './state.js';
import { getOrCreateSlot } from './sensor-registry.js';
import {
  handleOSCSensorQuaternion, handleOSCSensorInertial,
} from './imu-setup.js';
import { updateGestureMorph } from './seed-morph.js';
import { setMixdownCursorGain, setMixdownHouseGain } from './ui-meters.js';
import { setMappingInput } from './sensor-mapping.js';

// #105: multi-option controls accept either a bang (cycle to next mode) or a
// string argument (set that mode directly, e.g. `/camera/mode sensor`).
// Returns the string arg when present, else 127 (the bang convention that
// dispatchAction's cycle paths expect).
function _bangOrStr(values) {
  const v = values?.[0];
  return (typeof v === 'string' && v.length) ? v : 127;
}
/** A bang toggles; an explicit int sets (0 = off, anything else = on). The
 *  release-edge guard below already drops a bare 0 on a bang address, so an
 *  int 0 only arrives when the sender meant it. */
function _bangOrInt(values) {
  const v = values?.[0];
  return typeof v === 'number' ? (v > 0 ? 127 : 0) : 'toggle';
}
/** The screen's switches (2026-09-24, midi.js `_onOff`): an int sets — 1 on,
 *  0 off — and a bang flips. 1 rather than 127, because 127 is what a key or
 *  a note sends and that means a flip. */
function _bangOrOnOff(values) {
  const v = values?.[0];
  return typeof v === 'number' ? (v > 0 ? 1 : 0) : 'toggle';
}

// ── Release-edge guard ────────────────────────────────────────────────────────
// Almost every trigger case below hardcodes 127 and throws the incoming value
// away, so without this an explicit `0` — which is what any controller that
// sends both edges emits on release — runs the action a
// SECOND time.  A latching toggle then cancels itself and looks broken; a mode
// cycle skips a mode; /undo undoes two strokes.  The MIDI path has always had
// this guard (a trigger action mapped to a CC ignores val === 0, and note-off
// only reaches `hold` actions); the OSC path never did.  See
// docs/OSC-AUDIT-2026-08.md § O2.
//
// The trigger/hold/cc split is read from the shared ACTIONS registry
// (`S._actions`) rather than a list kept here — a parallel table would drift
// the first time an address is added.  Addresses the registry doesn't know
// (/scan/fade, /mapping1-3, /monitor/volume, /house/volume,
// /spatial/mode) fall through unguarded, which is exactly today's behaviour:
// this can only ever suppress a message it can prove is a release edge.

// Two registry 'trigger' actions genuinely decode the payload — their cases
// below read `values[0] ?? 127`, so 1 = on, 0 = off, bang = toggle. For those,
// a zero is a command and not a release edge. They are exempt by address
// rather than by `fmt`, because `fmt` is not a reliable discriminator: /search
// /scope and /search/order also advertise 'int 0|1' but their cases hardcode
// 127 and ignore the int.
// Every SWITCH on the screen takes 1 / 0 the same way (2026-09-24, the
// registry is the screen): `_bangOrInt` hands the int on and the case sets;
// a bang flips. `/grain/filter` read the int before this list knew it, so
// an explicit 0 there was dropped as a release edge and never turned it off.
const _VALUED_TRIGGERS = new Set([
  '/tape/slice', '/audition', '/tape/autopin', '/tape/overdub', '/tape/reverse',
  '/grain/autopin', '/grain/walk', '/grain/link', '/grain/filter', '/erase/bystroke',
  '/pins/sel/mute', '/pins/sel/solo', '/pins/clouds/mute', '/pins/clouds/solo', '/pins/loops/mute', '/pins/loops/solo',
  '/rail/tools', '/rail/pins', '/settings', '/spatial/lock',
]);

// The one bang address with no ACTIONS row, so the registry can't classify it.
// A compound toggle (camera mode + spatial panning in one message) that
// double-fired like everything else.
const _EXTRA_TRIGGERS = new Set(['/spatial/mode']);

// ── Numeric-payload guard ─────────────────────────────────────────────────────
// Addresses whose case reads values[0] as a number. A bang or a non-numeric
// symbol on one of these has no meaning, and letting it through wrote NaN into
// S with no error (§ O3). Registry `cc` rows supply most of the set; the rest
// are the value addresses that have no ACTIONS row at all, so nothing else can
// tell us their shape.
const _EXTRA_VALUE_ADDRS = new Set([
  '/scan/fade', '/mapping1', '/mapping2', '/mapping3',
  '/monitor/volume', '/house/volume', '/cursor/radiusfadecurve',
]);

function _needsNumber(address) {
  if (_EXTRA_VALUE_ADDRS.has(address)) return true;
  return (S._actions || []).find(x => x.osc === address)?.type === 'cc';
}

function _isUnusableValue(values) {
  return !values || !values.length || !Number.isFinite(Number(values[0]));
}

function _isReleaseEdge(address, values) {
  // A bang carries no value, so it can't be a release. Only an explicit
  // numeric zero is — and only for an action the registry calls a trigger.
  if (!values || values.length !== 1) return false;
  if (Number(values[0]) !== 0) return false;
  if (_VALUED_TRIGGERS.has(address)) return false;
  if (_EXTRA_TRIGGERS.has(address)) return true;
  const a = (S._actions || []).find(x => x.osc === address);
  return a?.type === 'trigger';
}

const WS_URL            = 'ws://localhost:8080';
const WS_RETRY_INTERVAL = 3000;  // ms between reconnect attempts
const WS_MAX_SILENT_RETRIES = 3; // stop retrying after N failures if never connected
let _retryCount = 0;
let _everConnected = false;

let _ws              = null;
let _retryTimer      = null;
let _connected       = false;
let _electronMsgSeen = false;  // Electron: show OSC indicator on first inbound message

// ── OSC bridge indicator ──────────────────────────────────────────────────────
// Inline in the sensor group bar. Toggled by connection state via CSS class.
// Called "OSC" rather than "MAX" because the bridge (WebSocket in browser,
// UDP relay in Electron) now carries traffic from any OSC peer — Max patches,
// mubone-joycon-gui, a MIDI→OSC pedal bridge, etc. — not only Max/MSP.

function setIndicator(visible) {
  const el = document.getElementById('oscIndicator');
  if (el) el.classList.toggle('visible', visible);
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initOSC() {
  if (window.electronBridge?.isElectron) {
    window.electronBridge.onOSC((address, values) => {
      // Show the bridge indicator on the first inbound message from any peer.
      if (!_electronMsgSeen) {
        _electronMsgSeen = true;
        setIndicator(true);
        window.dispatchEvent(new CustomEvent('osc-connected'));
      }
      handleOSC(address, values);
    });
    DEBUG && console.log('[osc] Electron IPC transport active');
    return;
  }

  // Browser: try to connect to the OSC bridge (any relay on WS_URL — Max,
  // mubone-joycon-gui, etc.). Only meaningful when the page itself is served
  // locally: WS_URL points at localhost, so on a hosted origin like
  // mubone.org/sim it can only ever fail, and every attempt writes a red
  // ERR_CONNECTION_REFUSED into the console of a first-time visitor who has no
  // bridge and no reason to want one.
  if (!_bridgeReachable()) {
    DEBUG && console.log('[osc] hosted origin — skipping local WebSocket bridge');
    return;
  }
  connectWebSocket();
}

// Any relay on this port listens on localhost (proxy.js, a joycon GUI, an
// example Max patch), so it is only reachable when mubone is itself being
// served from this machine.
export function _bridgeReachable() {
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '';
}

// ── WebSocket transport (browser) ─────────────────────────────────────────────

function connectWebSocket() {
  if (_ws) {
    _ws.onclose = null;
    _ws.onerror = null;
    try { _ws.close(); } catch (_) {}
  }

  try {
    _ws = new WebSocket(WS_URL);
  } catch (e) {
    scheduleRetry();
    return;
  }

  _ws.onopen = () => {
    _connected = true;
    _everConnected = true;
    _retryCount = 0;
    clearTimeout(_retryTimer);
    setIndicator(true);
    window.dispatchEvent(new CustomEvent('osc-connected'));
    DEBUG && console.log('[osc] OSC bridge connected — ws://localhost:8080');
  };

  _ws.onmessage = (event) => {
    try {
      const { address, values } = JSON.parse(event.data);
      handleOSC(address, values);
    } catch (e) {
      console.warn('[osc] bad message from bridge:', event.data);
    }
  };

  _ws.onclose = () => {
    if (_connected) {
      DEBUG && console.log('[osc] OSC bridge disconnected');
      setIndicator(false);
      window.dispatchEvent(new CustomEvent('osc-disconnected'));
    }
    _connected = false;
    scheduleRetry();
  };

  _ws.onerror = () => {
    // onclose fires after onerror — retry is handled there
  };
}

function scheduleRetry() {
  clearTimeout(_retryTimer);
  // If we've never connected and already tried a few times, stop retrying
  // to avoid flooding the console with WebSocket errors in browser-only dev mode.
  if (!_everConnected) {
    _retryCount++;
    if (_retryCount > WS_MAX_SILENT_RETRIES) return;
  }
  _retryTimer = setTimeout(connectWebSocket, WS_RETRY_INTERVAL);
}

// ── UI sync (debounced) ───────────────────────────────────────────────────────
// Grain param OSC messages write to S.grainOverrides / S.grainProbability etc.
// and then call scheduleUISync() to flush those values back to the sliders,
// direction buttons, k display, and radius viz — all in one rAF batch.

let _uiSyncScheduled = false;

function scheduleUISync() {
  if (_uiSyncScheduled) return;
  _uiSyncScheduled = true;
  requestAnimationFrame(() => {
    _uiSyncScheduled = false;
    S.syncGrainControlsUI?.();
  });
}

// ── Central OSC dispatcher ────────────────────────────────────────────────────
// Called by both transports with the same signature: (address: string, values: any[])

export function handleOSC(rawAddress, values) {
  // Electron's parseOSC strips the leading '/' from OSC addresses.
  // Normalize so both transports produce the same /address strings.
  const address = rawAddress.startsWith('/') ? rawAddress : '/' + rawAddress;

  // Broadcast every inbound OSC message for the keys/midi/osc live monitor.
  // Fires before dispatch so unhandled addresses are visible too (critical for
  // debugging mapping issues — you can see the raw address hitting the app).
  try {
    window.dispatchEvent(new CustomEvent('mubone-osc-in', {
      detail: { address, values: Array.isArray(values) ? values : [values], ts: performance.now() },
    }));
  } catch (_) {}

  // Opt-in console trace for diagnosing "no OSC arriving" — set
  // `localStorage.muboneOscTrace = '1'` in DevTools, then reload.  Prints
  // every inbound message to the console (browser AND Electron DevTools).
  // Turn off with `localStorage.removeItem('muboneOscTrace')`.
  if (localStorage.getItem('muboneOscTrace') === '1') {
    console.log('[osc:in]', address, values);
  }

  // Drop the release edge of a two-edge controller before anything acts on it.
  // Deliberately AFTER the monitor broadcast above — the keys/midi/osc monitor
  // must still show the message arriving, or a suppressed edge looks like a
  // dropped packet and you debug the wrong layer.
  if (_isReleaseEdge(address, values)) {
    DEBUG && console.log(`[osc] release edge ignored: ${address} 0`);
    return;
  }

  // Same idea for the other direction: a value address that got handed
  // something it can't read. Warned unconditionally rather than under DEBUG —
  // this is always a patch bug, it is otherwise completely silent, and it fires
  // once per bad message rather than per frame.
  if (_needsNumber(address) && _isUnusableValue(values)) {
    console.warn(`[osc] ${address} needs a number, got ${JSON.stringify(values)} — ignored`);
    return;
  }

  // ── Generic sensor dispatch ─────────────────────────────────────────────────
  // New convention: /sensor/{name}/quaternion  (4 floats)
  //                 /sensor/{name}/inertial    (6 floats)
  // Routed through imu-setup for unified calibration + UI card.
  {
    const parts = address.split('/');   // ["", "sensor", name, type]
    if (parts[1] === 'sensor' && parts.length === 4) {
      const name = parts[2];
      const type = parts[3];

      if (type === 'quaternion' && values.length >= 4) {
        handleOSCSensorQuaternion(name, values);
        return;
      }
      if (type === 'inertial' && values.length >= 6) {
        handleOSCSensorInertial(name, values);
        // If this slot's inertial is gesture source, run downstream. The slot
        // is the device's (`osc-<name>`, imu-setup.js) — asking for the bare
        // name minted a second, empty slot per OSC sensor (2026-09-16).
        const slot = getOrCreateSlot('osc-' + name);
        if (slot.inertialRole === 'gesture') {
          updateGestureMorph();
        }
        return;
      }
    }
  }

  // ── Grain parameters ───────────────────────────────────────────────────────
  // Writing to S.grainOverrides is picked up by grain.js on the next scheduler tick.
  // A null override means "use the preset value" — sending a param value sets the
  // override; there is currently no OSC message to clear it (patch handles that
  // by sending the preset value explicitly, or via /preset).

  switch (address) {

    case '/grain/dur':
      // Incoming value in ms (1–4000) → convert to seconds internally
      S.grainOverrides.duration    = clamp(values[0], 1, 4000) / 1000;
      scheduleUISync();
      break;

    case '/grain/per':
      // Incoming value in ms (1–4000) → convert to seconds internally
      S.grainOverrides.period      = clamp(values[0], 1, 4000) / 1000;
      scheduleUISync();
      break;

    case '/grain/overlap':
      // Incoming value as ratio (0.01–100) → drives duration = period × overlap
      { const ov = clamp(values[0], 0.01, 100);
        const per = S.grainOverrides.period ?? S.grainParams?.period ?? 0.061;
        S.grainOverrides.duration = Math.max(0.001, per * ov);
        scheduleUISync(); }
      break;

    case '/grain/volume':
      S.grainOverrides.volume      = clamp(values[0], 0, 2);
      scheduleUISync();
      break;

    case '/grain/pitch':
      // Incoming value in cents (0–700) → rate-ratio offset: v = 2^(c/1200) - 1
      S.grainOverrides.pitchJitter = Math.pow(2, clamp(values[0], 0, 700) / 1200) - 1;
      scheduleUISync();
      break;

    case '/grain/pan':
      // Incoming value in percent (0–100) → 0–1 internal
      S.grainOverrides.panSpread   = clamp(values[0], 0, 100) / 100;
      scheduleUISync();
      break;

    case '/grain/prob':
      S.grainProbability           = clamp(values[0], 0, 1);
      scheduleUISync();
      break;

    case '/grain/dir':    S._dispatchAction?.('grain_dir', _bangOrStr(values));   break;

    case '/scan/fade':
      // #14: cursor mute/unmute fade time-constant. Incoming value in ms
      // (0–2000) → seconds internally. Applies to the next mute/unmute.
      S.scanFadeS = clamp(values[0], 0, 2000) / 1000;
      break;

    case '/grain/fade':
      // Incoming value in percent (0–50, matching UI slider max) → 0–0.5 internal
      S.grainOverrides.fadeRatio   = clamp(values[0], 0, 50) / 100;
      scheduleUISync();
      break;

    case '/grain/durjitter':
      S.grainOverrides.durJitter   = clamp(values[0], 0, 1);
      scheduleUISync();
      break;

    case '/grain/durvar':
      // Incoming value in ms (0–500) → convert to seconds internally
      S.grainOverrides.durVar      = clamp(values[0], 0, 500) / 1000;
      scheduleUISync();
      break;

    case '/grain/startjitter':
      // Incoming value in ms (0–500) → convert to seconds internally
      S.grainOverrides.startJitter = clamp(values[0], 0, 500) / 1000;
      scheduleUISync();
      break;

    case '/grain/pervar':
      // Incoming value in ms (0–500) → convert to seconds internally
      S.grainOverrides.periodVar   = clamp(values[0], 0, 500) / 1000;
      scheduleUISync();
      break;

    case '/grain/curve':  S._dispatchAction?.('grain_curve', _bangOrStr(values)); break;

    // ONE filter per grain since 2026-09-23: a switch, a type, a cutoff and a
    // resonance. `/grain/hpf` `/grain/lpf` `/grain/hpfq` `/grain/lpfq` are
    // gone, not aliased — two corners cannot be undone to one.
    case '/grain/filter':     S._dispatchAction?.('grain_filter', _bangOrInt(values)); break;
    case '/grain/filtertype': S._dispatchAction?.('grain_filtertype', _bangOrStr(values)); break;
    case '/grain/cutoff':
      // Incoming value in Hz (20–20000)
      S.grainOverrides.cutoff      = clamp(values[0], 20, 20000);
      scheduleUISync();
      break;
    case '/grain/res':
      // Incoming value 0–1: flat at 0, +20 dB at the cutoff at 1
      S.grainOverrides.res         = clamp(values[0], 0, 1);
      scheduleUISync();
      break;
    case '/grain/filterjitter':
      // Incoming value 0–1 (±octaves per grain)
      S.grainOverrides.filterFreqJitter = clamp(values[0], 0, 1);
      scheduleUISync();
      break;

    case '/spatial/mode':
      if (S.cameraMode === 'sensor' && S.spatialPanning === 'worldlocked') {
        // currently "physical" → switch to "sim"
        if (S._setCameraMode) S._setCameraMode('steer');
        if (S._setSpatialPanning) S._setSpatialPanning('headlocked');
      } else {
        // anything else → switch to "physical"
        if (S._setCameraMode) S._setCameraMode('sensor');
        if (S._setSpatialPanning) S._setSpatialPanning('worldlocked');
      }
      break;

    // ── Transport & cursor controls ────────────────────────────────────────
    // Trigger/bang actions route through dispatchAction for consistent UI feedback.
    case '/mute':           S._dispatchAction?.('mute', 127);        break;
    // Momentary counterpart — 1 = mute, 0 = restore the pre-press state.
    case '/mute/hold':      S._dispatchAction?.('mute_hold', values[0] ? 127 : 0); break;
    // The dry monitor's mute: off is the mute, unmuting returns to on or auto.
    case '/dry/mute':       S._dispatchAction?.('dry_mute', 127);    break;
    case '/dry/mute/hold':  S._dispatchAction?.('dry_mute_hold', values[0] ? 127 : 0); break;
    // The cap is the ONE mute the cursor has (2026-09-07): granular and hits
    // together. `/trigger/mute` was deleted with the second flag rather than
    // aliased here — one address per thing, or the table stops being the
    // namespace and becomes two names for one action.
    case '/cursor/tare':    S._dispatchAction?.('tare', 127);        break;
    // Bang cycles, string sets — same idiom as /commit/mode.
    case '/cursor/az_source': S._dispatchAction?.('az_source', _bangOrStr(values)); break;
    case '/cursor/el_source': S._dispatchAction?.('el_source', _bangOrStr(values)); break;

    // Sensor mapping toggles (1-indexed from Max → 0-indexed internally)

    // Generic external mapping inputs — any peer (joycon GUI, Max patch, etc.)
    // can emit a float on these addresses and the value shows up as an
    // additional axis in the mapping modal. No fixed target — the user picks
    // a grain param in the modal. Value is stored raw; curve + input range
    // in the mapping evaluate it the same as any other axis.
    case '/mapping1': setMappingInput('mapping1', values[0]); break;
    case '/mapping2': setMappingInput('mapping2', values[0]); break;
    case '/mapping3': setMappingInput('mapping3', values[0]); break;
    case '/cursor/radiusfade': S._dispatchAction?.('radius_fade', 127); break;

    case '/cursor/radiusfadecurve': {
      const v = clamp(values[0], 0, 1);
      S.radiusFadeCurve = v;
      S._syncRadiusFadeUI?.();
      break;
    }

    // ── Monitor / House bus (Phase 1 — Improv Mode) ────────────────────────
    // /monitor/volume f  — cursor-to-house send level (MIDI pedal, 0–1)
    // /house/volume   f  — seed bus master volume (volume pedal, 0–2)
    case '/monitor/volume': {
      const v = clamp(values[0], 0, 1);
      S.monitorGainValue = v;
      if (S.monitorToHouseGain) {
        S.monitorToHouseGain.gain.setTargetAtTime(v, S.audioCtx.currentTime, 0.02);   // the cap gates no bus
      }
      S._syncImprovUI?.();
      break;
    }
    case '/house/volume': {
      const v = clamp(values[0], 0, 2);
      S.houseGainValue = v;
      if (S.houseGainNode) {
        S.houseGainNode.gain.setTargetAtTime(v, S.audioCtx.currentTime, 0.02);
      }
      S._syncImprovUI?.();
      break;
    }

    // ── Commit system (unified cloud + loop) ────────────────────────────────
    // Trigger/bang actions route through dispatchAction for consistent UI feedback.
    // ── The tabs, the foot, the pinned rail, the chrome (2026-09-24) ──────
    // A switch: int sets, bang flips. A capsule: string sets, bang cycles.
    case '/tape/slice':      S._dispatchAction?.('tape_slice', _bangOrOnOff(values)); break;
    case '/audition':        S._dispatchAction?.('audition', _bangOrOnOff(values)); break;
    case '/tape/autopin':    S._dispatchAction?.('tape_autopin', _bangOrOnOff(values)); break;
    case '/tape/overdub':    S._dispatchAction?.('tape_overdub', _bangOrOnOff(values)); break;
    case '/tape/dwell':      S._dispatchAction?.('tape_dwell', _bangOrStr(values)); break;
    case '/tape/retrig':     S._dispatchAction?.('tape_retrig', _bangOrStr(values)); break;
    case '/tape/step':       S._dispatchAction?.('tape_step', _bangOrStr(values)); break;
    case '/tape/reverse':    S._dispatchAction?.('tape_reverse', _bangOrOnOff(values)); break;
    case '/tape/voice':      S._dispatchAction?.('tape_voice', values.length ? Number(values[0]) : 127); break;
    case '/tape/voice/next': S._dispatchAction?.('tape_voice_next', 127); break;
    case '/tape/voice/prev': S._dispatchAction?.('tape_voice_prev', 127); break;
    case '/tape/speed':
      S.triggerParams.speed = clamp(values[0], 0.25, 4); S._syncTriggerUI?.(); S._renderRail?.(); break;
    case '/tape/pitch':
      S.triggerParams.pitch = Math.round(clamp(values[0], -2400, 2400)); S._syncTriggerUI?.(); S._renderRail?.(); break;
    case '/tape/volume':
      S.triggerParams.volume = clamp(values[0], 0, 1); S._syncTriggerUI?.(); S._renderRail?.(); break;
    case '/grain/autopin':   S._dispatchAction?.('grain_autopin', _bangOrOnOff(values)); break;
    case '/grain/walk':      S._dispatchAction?.('grain_walk', _bangOrOnOff(values)); break;
    case '/grain/dwell':     S._dispatchAction?.('grain_dwell', _bangOrStr(values)); break;
    case '/grain/retrig':    S._dispatchAction?.('grain_retrig', _bangOrStr(values)); break;
    case '/grain/link':      S._dispatchAction?.('grain_link', _bangOrOnOff(values)); break;
    case '/grain/flow':
      S.paintTicker = S.paintTicker || {}; S.paintTicker.intervalMs = Math.round(clamp(values[0], 10, 200)); S._renderRail?.(); break;
    case '/grain/head':
      S.headWidthDeg = Math.round(clamp(values[0], 0, 30)); S._renderRail?.(); break;
    case '/grain/voice':     S._dispatchAction?.('grain_voice', values.length ? Number(values[0]) : 127); break;
    case '/grain/voice/next': S._dispatchAction?.('grain_voice_next', 127); break;
    case '/grain/voice/prev': S._dispatchAction?.('grain_voice_prev', 127); break;
    case '/erase/bystroke':  S._dispatchAction?.('erase_bystroke', _bangOrOnOff(values)); break;
    case '/erase/from':      S._dispatchAction?.('erase_from', _bangOrStr(values)); break;
    case '/cursor/reads':    S._dispatchAction?.('lens_reads', _bangOrStr(values)); break;
    case '/pins/sel/mute':   S._dispatchAction?.('pin_mute', _bangOrOnOff(values)); break;
    case '/pins/sel/solo':   S._dispatchAction?.('pin_solo', _bangOrOnOff(values)); break;
    case '/pins/sel/level':  S._setSelectedPinLevel?.(clamp(values[0], 0, 1)); break;
    case '/pins/clouds/mute': S._dispatchAction?.('bus_cloud_mute', _bangOrOnOff(values)); break;
    case '/pins/clouds/solo': S._dispatchAction?.('bus_cloud_solo', _bangOrOnOff(values)); break;
    case '/pins/loops/mute':  S._dispatchAction?.('bus_loop_mute', _bangOrOnOff(values)); break;
    case '/pins/loops/solo':  S._dispatchAction?.('bus_loop_solo', _bangOrOnOff(values)); break;
    case '/rail/tools':      S._dispatchAction?.('rail_tools', _bangOrOnOff(values)); break;
    case '/rail/pins':       S._dispatchAction?.('rail_pins', _bangOrOnOff(values)); break;
    case '/settings':        S._dispatchAction?.('settings', _bangOrOnOff(values)); break;
    case '/camera':          S._dispatchAction?.('camera_mode', _bangOrStr(values)); break;
    case '/input/gain':      S._setInputGainDb?.(clamp(values[0], -24, 24)); break;

    case '/commit/clear':   S._dispatchAction?.('commit_clear', 127);   break;
    // ── The MIX pair ────────────────────────────────────────────────────────
    // Both were advertised in the ACTIONS table from the day the MIX group was
    // built and NEITHER had a case here, so over OSC they did nothing while the
    // OSC modal listed them — the exact shape CLAUDE.md warns about, that the
    // switch in this file IS the namespace whatever a table or a doc says.
    // Caught by osc-audit's wiring check at the 5.0 release.
    //
    // `/pins/mute` carries its value: an explicit 1 mutes and 0 lets go, and a
    // BARE bang flips — that is what midi.js's `midiVal == null` branch is for,
    // so a pad that only ever sends 127 is still a toggle. Passing `?? null`
    // rather than `?? 127` is what keeps the flip reachable from OSC at all.
    // THE HAND, on the wire like every other action (2026-09-22). Its two
    // presses are `hand_press` and `hand_long` — the same pair the spacebar's
    // reserved binding fires — so a pedal or a patch can play the hand without
    // a keyboard. `/hand/long` carries its value: 1 holds, 0 lets go.
    case '/hand/press':     S._dispatchAction?.('hand_press', 127); break;
    case '/hand/long':      S._dispatchAction?.('hand_long', values.length ? (values[0] ? 127 : 0) : 127); break;
    case '/pins/mute':      S._dispatchAction?.('pins_mute', values.length ? (values[0] ? 127 : 0) : null); break;
    case '/pins/follow':    S._dispatchAction?.('pins_follow', _bangOrStr(values));    break;
    case '/commit/xfade':
      S.commitXfade = clamp(values[0], 0, 1);
      S._syncImprovUI?.();
      break;
    case '/commit/loop_fade_time':
      S.loopFadeTimeMs = clamp(values[0], 0, 2000);
      { const sl = document.getElementById('loopFadeTimeSlider'); if (sl) sl.value = S.loopFadeTimeMs;
        const nb = document.getElementById('loopFadeTimeNum');    if (nb) nb.value = S.loopFadeTimeMs < 1000 ? Math.round(S.loopFadeTimeMs) + 'ms' : (S.loopFadeTimeMs / 1000).toFixed(1) + 's'; }
      break;
    case '/commit/attack':
      S.commitAttack = clamp(values[0], 0, 10);
      { const sl = document.getElementById('seedAttackSlider');  if (sl) sl.value = S.commitAttack;
        const nb = document.getElementById('seedAttackNum');     if (nb) nb.value = S.commitAttack < 1 ? (S.commitAttack * 1000).toFixed(0) + 'ms' : S.commitAttack.toFixed(1) + 's'; }
      break;
    case '/commit/release_time':
      S.commitRelease = clamp(values[0], 0, 10);
      { const sl = document.getElementById('seedReleaseSlider'); if (sl) sl.value = S.commitRelease;
        const nb = document.getElementById('seedReleaseNum');    if (nb) nb.value = S.commitRelease < 1 ? (S.commitRelease * 1000).toFixed(0) + 'ms' : S.commitRelease.toFixed(1) + 's'; }
      break;
    case '/commit/slots':
      S.commitSlotCount = Math.max(1, Math.min(16, Math.round(values[0])));
      (S.updateSeedBanksUI || S._syncCommitUI || (() => {}))();
      break;
    case '/commit/overflow':  S._dispatchAction?.('commit_overflow', _bangOrStr(values));  break;
    case '/commit/selection': S._dispatchAction?.('commit_selection', _bangOrStr(values)); break;
    case '/commit/dir':       S._dispatchAction?.('commit_dir', _bangOrStr(values));      break;
    case '/commit/loop_release': S._dispatchAction?.('loop_release_mode', _bangOrStr(values)); break;

    case '/undo':         S._dispatchAction?.('undo', 127);       break;
    case '/redo':         S._dispatchAction?.('redo', 127);       break;
    case '/sweep':        S._dispatchAction?.('sweep', 127);      break;
    // ── Tool (bang → cycle, string → set) ───────────────────────────────


    // ── Octave shortcuts (discrete steps on the base pitch shift) ──────────
    case '/grain/oct/down':  S._dispatchAction?.('pitch_oct_down', 127);  break;
    case '/grain/oct/reset': S._dispatchAction?.('pitch_oct_reset', 127); break;
    case '/grain/oct/up':    S._dispatchAction?.('pitch_oct_up', 127);    break;

    // ── Paint ──────────────────────────────────────────────────────────────
    // `/trace` and `/trace/toggle` were here until 2026-09-11. They started
    // and stopped "the tool in the hand", and arming is gone — a play names
    // the POSITION it plays, so the address is `/palette/N` and nothing else
    // (the `/hold` and `/toggle` pair went the same evening, with the verb).
    // ── Source / sampler (#247) ────────────────────────────────────────────
    // /source/live | /source/sampler — bang selects what the brush inks from
    case '/source/live':    S._dispatchAction?.('source_live', 127);    break;
    case '/source/sampler': S._dispatchAction?.('source_sampler', 127); break;
    // /sampler/sample int — 1..10 = slot, anything else = next loaded
    case '/sampler/sample': S._dispatchAction?.('sampler_sample', values[0] || 127); break;
    // /sampler/record int — 1 = start capture into next free slot, 0 = stop
    case '/sampler/record': S._dispatchAction?.('sampler_record', values[0] ? 127 : 0); break;

    // ── Cursor lock (hold) ──────────────────────────────────────────────────
    // Held az + el, and in steer/surface the pointer handed back. This used to
    // be a third hand-written copy of the alt-lock body (midi.js and events.js
    // had the other two) and it had drifted from both: no _syncSessionAltLock,
    // no surface overlay, and #canvasWrapper by name where events.js follows
    // the live canvas. One owner now — see cursorLocked() in main.js.
    // ── The palette by position, 1–9 ────────────────────────────────────────
    // ONE ADDRESS PER POSITION (docs/PALETTE-GUI.md § 1), because the tile's
    // VERB decides what an edge means and the wire no longer chooses:
    //
    //   a MOMENTARY tile  → `int 1|0`, both edges, and its ACTIONS row is a
    //                       `hold`, so `_isReleaseEdge` lets the 0 through
    //   a BANG or TOGGLE  → a bang; its row is a `trigger`, so the same guard
    //                       swallows an explicit 0 as a release edge (O2)
    //
    // That guard is generic and reads `S._actions`, whose `type` is a getter
    // over the tile's verb — so the payload contract follows the tile with no
    // per-case test here, and the hand-written `Number(values[0]) === 0` this
    // block used to carry is gone with the 18 `/toggle` and `/hold` addresses.
    case '/palette/1': S._dispatchAction?.('palette_1', values.length && !Number(values[0]) ? 0 : 127); break;
    case '/palette/2': S._dispatchAction?.('palette_2', values.length && !Number(values[0]) ? 0 : 127); break;
    case '/palette/3': S._dispatchAction?.('palette_3', values.length && !Number(values[0]) ? 0 : 127); break;
    case '/palette/4': S._dispatchAction?.('palette_4', values.length && !Number(values[0]) ? 0 : 127); break;

    case '/spatial/lock':
      S._dispatchAction?.('cursor_lock', _bangOrOnOff(values));
      break;

    // ── App ─────────────────────────────────────────────────────────────────
    case '/handsfree':      S._dispatchAction?.('handsfree', 127);  break;
    case '/session/erase':  S._dispatchAction?.('erase_all', 127); break;

    // ── Search ───────────────────────────────────────────────────────────────
    case '/search/scope':   S._dispatchAction?.('snap', 127);      break;
    case '/search/order':   S._dispatchAction?.('k_seq', 127);     break;
    case '/search/recency': {
      const raw = Math.round(values[0]);
      const n = raw <= 0 ? 0 : Math.min(6, raw);   // 0 = all (no filter); 1–6 strokes (2026-09-25)
      if (typeof S.setRecency === 'function') S.setRecency(n);
      else S.recencyN = n;
      break;
    }
    case '/search/radius':
      S.searchRadiusDeg = Math.round(clamp(values[0], SEARCH_RADIUS_MIN, SEARCH_RADIUS_MAX));
      scheduleUISync();
      break;
    case '/search/radius/inc': S._dispatchAction?.('radius_inc', 127); break;
    case '/search/radius/dec': S._dispatchAction?.('radius_dec', 127); break;
    case '/search/k': {
      // 0 = all (no cap); otherwise 1…K_MAX (2026-09-24). setSearchK clamps
      // and places the slider; the fallback is for a message before setup.
      const n = Math.round(values[0]);
      if (typeof S.setSearchK === 'function') S.setSearchK(n);
      else S.grainOverrides.k = n > 0 ? n : 0;
      break;
    }

    // ── Pitch shift ─────────────────────────────────────────────────────────
    case '/grain/pitchshift':
      // cents, not semitones — matches the slider / sensor mapping / worklet
      S.grainOverrides.pitchShift = Math.round(clamp(values[0], -2400, 2400));
      scheduleUISync();
      break;

    // ── Headphone mixdown levels ────────────────────────────────────────────
    case '/mixdown/cursor':
      setMixdownCursorGain(clamp(values[0], 0, 1));
      break;
    case '/mixdown/house':
      setMixdownHouseGain(clamp(values[0], 0, 1));
      break;

    // ── Master volume & paint gate ──────────────────────────────────────────
    // /master/volume f  — dB value (-60 to +18), drives the audio settings slider
    case '/master/volume':
      S._setOutputGainDb?.(clamp(values[0], -60, 18));
      break;
    // /gate/threshold f — the gate's loudness metric, max(rms, 0.7*peak), 0 to 1.
    // Not plain RMS: see gateLoudness() in audio-features.js.
    case '/gate/threshold':
      S._setPaintGateThreshold?.(clamp(values[0], 0, GATE_METER_MAX));
      break;
    // /dry/gain f — spatialized live-input gain in the house mix (0 to 2; 1 = unity)
    case '/dry/gain':
      S._setDryMonitorGain?.(clamp(values[0], 0, 2));
      break;

    default: {
      DEBUG && console.log(`[osc] unhandled: ${address}`, values);
    }
  }
}

// ── Outbound (Electron → relay uplink, or the browser's WebSocket) ───────────
// Sends an OSC-style message out. Transport depends on runtime:
//   Electron — IPC to main, which forwards over UDP 7501 to the relay.
//              The relay rebroadcasts to its WS peers (e.g. the joycon GUI).
//   Browser  — the same WebSocket we use for inbound. proxy.js drops what a
//              browser sends it (only the relay it was written for fanned it
//              out). Silently dropped when the WS isn't open.
// Used by js/status-publisher.js to push /status/* messages so the joycon GUI
// can drive LED/rumble feedback in response to app state.
// Usage: sendOSC('/my/address', [1, 2, 3])

export function sendOSC(address, values = []) {
  const bridge = typeof window !== 'undefined' ? window.electronBridge : null;
  if (bridge?.sendOSC) {
    try { bridge.sendOSC(address, values); } catch (e) {
      console.warn('[osc] sendOSC (electron) failed:', e);
    }
    return;
  }
  if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
  try {
    _ws.send(JSON.stringify({ address, values }));
  } catch (e) {
    console.warn('[osc] sendOSC failed:', e);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// NaN survives both Math.min and Math.max, and `Number(undefined)` is NaN, so
// this used to write NaN straight into S whenever a value address received a
// bang or a non-numeric symbol.  The bad payload is now rejected up front by
// _isUnusableValue() (see handleOSC), which is the only place that can decline
// the write without inventing a value — from in here, `min` would be a lie: a
// bang would read as "you asked for the minimum".  The Number.isFinite check
// stays as a belt-and-braces guard for any future caller that skips the gate.
// See docs/OSC-AUDIT-2026-08.md § O3.
function clamp(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
