// ============================================================================
// osc.js — shared OSC dispatcher + transport init
//
// All OSC messages, regardless of source, flow through handleOSC().
// Two transports:
//
//   Electron  — electronBridge.onOSC (IPC from main process, UDP 7500)
//   Browser   — WebSocket ws://localhost:8080 (bridge.js running in Max patch)
//
// The browser falls back gracefully to mouse/gyro if the bridge isn't running.
// ============================================================================

import { S, DEBUG, PRESETS, rebuildGrainCurves } from './state.js';
import {
  handleSensorOSC, handleSensor2OSC, handleWandOSC, handleWandInertialOSC,
  sensor, wand,
} from './sensor.js';
import { updateWand, updateGestureMorph } from './wand.js';
import { setCursorHouseMuted } from './ui-meters.js';

const WS_URL            = 'ws://localhost:8080';
const WS_RETRY_INTERVAL = 3000;  // ms between reconnect attempts

let _ws              = null;
let _retryTimer      = null;
let _connected       = false;
let _electronMsgSeen = false;  // Electron: show indicator on first message

// ── MAX indicator ─────────────────────────────────────────────────────────────
// Small dot in the top-right corner. Created once, toggled by connection state.

let _indicator = null;

function getIndicator() {
  if (_indicator) return _indicator;
  _indicator = document.createElement('div');
  Object.assign(_indicator.style, {
    position:    'fixed',
    top:         '10px',
    right:       '12px',
    fontSize:    '10px',
    fontFamily:  "'Roboto Mono', monospace",
    letterSpacing: '0.08em',
    color:       '#7abcbc',
    opacity:     '0',
    transition:  'opacity 0.4s',
    pointerEvents: 'none',
    zIndex:      '9999',
    userSelect:  'none',
  });
  _indicator.textContent = '● MAX';
  document.body.appendChild(_indicator);
  return _indicator;
}

function setIndicator(visible) {
  getIndicator().style.opacity = visible ? '1' : '0';
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initOSC() {
  if (window.electronBridge?.isElectron) {
    window.electronBridge.onOSC((address, values) => {
      // Show indicator on the first message received from Max
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

  // Browser: try to connect to the Max bridge
  connectWebSocket();
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
    clearTimeout(_retryTimer);
    setIndicator(true);
    window.dispatchEvent(new CustomEvent('osc-connected'));
    DEBUG && console.log('[osc] Max bridge connected — ws://localhost:8080');
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
      DEBUG && console.log('[osc] Max bridge disconnected');
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

  // ── Sensor quaternions ─────────────────────────────────────────────────────
  // Both addresses expect:  qx qy qz qw  (4 floats, scalar W last)
  // /space/cursor — sensor 1, instrument (drives the visual cursor)
  if (address === '/space/cursor' && values.length === 4) {
    handleSensorOSC(values);
    return;
  }
  // /space/frame  — sensor 2, world reference (body frame or floor lock)
  if (address === '/space/frame' && values.length === 4) {
    handleSensor2OSC(values);
    return;
  }
  // /space/wand — wand controller quaternion stream (viz-invisible)
  // Sends tare-relative euler back to Max as /space/wand/0euler.
  if (address === '/space/wand' && values.length === 4) {
    handleWandOSC(values);
    if (wand.zeroEuler) sendOSC('/space/wand/0euler', [wand.zeroEuler.x, wand.zeroEuler.y, wand.zeroEuler.z]);
    updateWand();
    return;
  }
  // /space/wand/inertial — gyro + accel from x-IMU
  // Values: [gx, gy, gz, ax, ay, az]  (deg/s, g)
  if (address === '/space/wand/inertial' && values.length === 6) {
    handleWandInertialOSC(values);
    updateWand();
    updateGestureMorph();  // Phase 4: drive cloud morph from gyro (independent of wandConfig)
    return;
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

    case '/grain/volume':
      S.grainOverrides.volume      = clamp(values[0], 0, 2);
      rebuildGrainCurves();
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

    case '/grain/k':
      S.grainOverrides.k           = Math.max(1, Math.round(values[0]));
      scheduleUISync();
      break;

    case '/grain/prob':
      S.grainProbability           = clamp(values[0], 0, 1);
      scheduleUISync();
      break;

    case '/grain/radius':
      S.searchRadiusDeg            = clamp(values[0], 1, 180);
      scheduleUISync();
      break;

    case '/grain/dir':
      if (['fwd', 'rev', 'rnd'].includes(values[0])) {
        S.grainDirection = values[0];
        scheduleUISync();
      }
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

    case '/grain/pervar':
      // Incoming value in ms (0–500) → convert to seconds internally
      S.grainOverrides.periodVar   = clamp(values[0], 0, 500) / 1000;
      scheduleUISync();
      break;

    case '/grain/retrigger':
      S.grainOverrides.retriggerMs = clamp(values[0], 0, 500);
      scheduleUISync();
      break;

    // ── Preset ───────────────────────────────────────────────────────────────
    // Dispatches a CustomEvent so ui-presets.js can update its UI alongside
    // the state change. ui-presets.js listens for 'osc-preset'.
    case '/preset': {
      const idx = Math.round(values[0]) - 1;  // 1-indexed from Max
      if (idx >= 0 && idx < PRESETS.length) {
        S._selectPreset?.(idx);
      }
      break;
    }

    // ── Spatial mode ──────────────────────────────────────────────────────────
    // S._setSpatialMode is registered by main.js — it updates button + cursor too.
    case '/spatial/mode':
      if (values[0] === 'sim' || values[0] === 'physical') {
        if (S._setSpatialMode) S._setSpatialMode(values[0]);
        else S.spatialMode = values[0];
      }
      break;

    // ── Transport controls ────────────────────────────────────────────────────
    // S._setRecording / S._setMuted registered by events.js.

    case '/record':
      S._setRecording?.(!!values[0]);
      break;

    case '/mute':
      // S._setMuted is registered by events.js — it ramps audio gain and
      // updates the mute button UI in addition to setting S.isMuted.
      if (S._setMuted) S._setMuted(!!values[0]);
      else S.isMuted = !!values[0];
      break;

    case '/cursor/mute':
      setCursorHouseMuted(!!values[0]);
      break;

    // ── Monitor / House bus (Phase 1 — Improv Mode) ────────────────────────
    // /monitor/volume f  — cursor-to-house send level (MIDI pedal, 0–1)
    // /house/volume   f  — cloud bus master volume (volume pedal, 0–2)
    case '/monitor/volume': {
      const v = clamp(values[0], 0, 1);
      S.monitorGainValue = v;
      if (S.monitorToHouseGain) {
        const effectiveGain = S.cursorHouseMuted ? 0 : v;
        S.monitorToHouseGain.gain.setTargetAtTime(effectiveGain, S.audioCtx.currentTime, 0.02);
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

    // ── Nearest-cloud navigation (Phase 3 — Improv Mode) ───────────────────
    // /cloud/mode     s  — 'collage' | 'nearest'
    // /cloud/always   i  — 1 = always play nearest, 0 = radius-gated
    // /cloud/snapfade f  — 0.0 = hard snap (nearest only), 1.0 = full crossfade
    case '/cloud/mode':
      if (values[0] === 'collage' || values[0] === 'nearest') {
        S.cloudMode = values[0];
        S._syncImprovUI?.();
      }
      break;
    case '/cloud/always':
      S.cloudNearestAlways = !!values[0];
      S._syncImprovUI?.();
      break;
    case '/cloud/snapfade':
      S.cloudSnapFade = clamp(values[0], 0, 1);
      S._syncImprovUI?.();
      break;

    // ── Cloud / undo ──────────────────────────────────────────────────────────
    // S._dropCloud / _pickupCloud / _undo registered by events.js.
    // Bang-style: any value (or no value) triggers the action.
    case '/cloud/drop':    S._dropCloud?.();   break;
    case '/cloud/pickup':  S._pickupCloud?.(); break;
    case '/undo':          S._undo?.();        break;

    default:
      DEBUG && console.log(`[osc] unhandled: ${address}`, values);
  }
}

// ── Outbound (browser → Max) ──────────────────────────────────────────────────
// Sends an OSC-style message back to the Max bridge over the same WebSocket.
// Silently dropped when not connected (browser mode only; Electron not supported).
// Usage: sendOSC('/my/address', [1, 2, 3])

export function sendOSC(address, values = []) {
  if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
  try {
    _ws.send(JSON.stringify({ address, values }));
  } catch (e) {
    console.warn('[osc] sendOSC failed:', e);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Number(v)));
}
