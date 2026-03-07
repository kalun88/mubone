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

import { S, PRESETS, rebuildGrainCurves } from './state.js';
import { handleSensorOSC } from './sensor.js';

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
    console.log('[osc] Electron IPC transport active');
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
    console.log('[osc] Max bridge connected — ws://localhost:8080');
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
      console.log('[osc] Max bridge disconnected');
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

  // ── Sensor quaternion ──────────────────────────────────────────────────────
  // BNO085 sends: /orientation qx qy qz qw  (4 floats)
  if (address === '/orientation' && values.length === 4) {
    handleSensorOSC(values);
    return;
  }

  // ── Grain parameters ───────────────────────────────────────────────────────
  // Writing to S.grainOverrides is picked up by grain.js on the next scheduler tick.
  // A null override means "use the preset value" — sending a param value sets the
  // override; there is currently no OSC message to clear it (patch handles that
  // by sending the preset value explicitly, or via /preset).

  switch (address) {

    case '/grain/duration':
      S.grainOverrides.duration    = clamp(values[0], 0.001, 10);
      scheduleUISync();
      break;

    case '/grain/period':
      S.grainOverrides.period      = clamp(values[0], 0.001, 10);
      scheduleUISync();
      break;

    case '/grain/volume':
      S.grainOverrides.volume      = clamp(values[0], 0, 2);
      rebuildGrainCurves();
      scheduleUISync();
      break;

    case '/grain/pitch':
      S.grainOverrides.pitchJitter = clamp(values[0], 0, 1);
      scheduleUISync();
      break;

    case '/grain/pan':
      S.grainOverrides.panSpread   = clamp(values[0], 0, 1);
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

    // ── Cloud / undo ──────────────────────────────────────────────────────────
    // S._dropCloud / _pickupCloud / _undo registered by events.js.
    // Bang-style: any value (or no value) triggers the action.
    case '/cloud/drop':    S._dropCloud?.();   break;
    case '/cloud/pickup':  S._pickupCloud?.(); break;
    case '/undo':          S._undo?.();        break;

    default:
      console.log(`[osc] unhandled: ${address}`, values);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Number(v)));
}
