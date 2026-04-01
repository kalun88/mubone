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

import { S, DEBUG, PRESETS, SEARCH_RADIUS_MIN, SEARCH_RADIUS_MAX, SEARCH_RADIUS_STEP, rebuildGrainCurves } from './state.js';
import {
  getOrCreateSlot, getByRole, assignQuatRole, assignInertialRole,
  handleSlotQuaternion, handleSlotInertial,
} from './sensor-registry.js';
import { updateGestureMorph } from './seed-morph.js';
import { setMixdownCursorGain, setMixdownHouseGain } from './ui-meters.js';
import { updatePlaybackControls } from './ui-presets.js';

const WS_URL            = 'ws://localhost:8080';
const WS_RETRY_INTERVAL = 3000;  // ms between reconnect attempts

let _ws              = null;
let _retryTimer      = null;
let _connected       = false;
let _electronMsgSeen = false;  // Electron: show indicator on first message

// ── MAX indicator ─────────────────────────────────────────────────────────────
// Inline in the sensor group bar. Toggled by connection state via CSS class.

function setIndicator(visible) {
  const el = document.getElementById('maxIndicator');
  if (el) el.classList.toggle('visible', visible);
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

  // ── Generic sensor dispatch ─────────────────────────────────────────────────
  // New convention: /sensor/{name}/quaternion  (4 floats)
  //                 /sensor/{name}/inertial    (6 floats)
  // The {name} is arbitrary — the app auto-discovers slots on first contact.
  {
    const parts = address.split('/');   // ["", "sensor", name, type]
    if (parts[1] === 'sensor' && parts.length === 4) {
      const name = parts[2];
      const type = parts[3];
      const slot = getOrCreateSlot(name);

      if (type === 'quaternion' && values.length >= 4) {
        handleSlotQuaternion(slot, values);
        // If this slot's quat drives the cursor, send tare state
        if (slot.quatRole === 'cursor') {
          if (slot.zeroEuler) sendOSC('/sensor/' + name + '/0euler', [slot.zeroEuler.x, slot.zeroEuler.y, slot.zeroEuler.z]);
        }
        return;
      }
      if (type === 'inertial' && values.length >= 6) {
        handleSlotInertial(slot, values);
        // If this slot's inertial is gesture source, run downstream
        if (slot.inertialRole === 'gesture') {
          updateGestureMorph();
          S._onGestureUpdate?.();
        }
        return;
      }
    }
  }

  // ── Legacy /space/* aliases ──────────────────────────────────────────────────
  // Map old addresses into the registry so existing Max patches keep working.
  // /space/cursor → slot "cursor" quaternion
  if (address === '/space/cursor' && values.length === 4) {
    const slot = getOrCreateSlot('cursor');
    if (slot.quatRole === 'unmapped') assignQuatRole('cursor', 'cursor');
    handleSlotQuaternion(slot, values);
    return;
  }
  // /space/frame → slot "frame" quaternion
  if (address === '/space/frame' && values.length === 4) {
    const slot = getOrCreateSlot('frame');
    if (slot.quatRole === 'unmapped') assignQuatRole('frame', 'frame');
    handleSlotQuaternion(slot, values);
    return;
  }
  // /space/wand → slot "wand" quaternion
  if (address === '/space/wand' && values.length === 4) {
    const slot = getOrCreateSlot('wand');
    handleSlotQuaternion(slot, values);
    if (slot.zeroEuler) sendOSC('/space/wand/0euler', [slot.zeroEuler.x, slot.zeroEuler.y, slot.zeroEuler.z]);
    return;
  }
  // /space/wand/inertial → slot "wand" inertial
  if (address === '/space/wand/inertial' && values.length === 6) {
    const slot = getOrCreateSlot('wand');
    handleSlotInertial(slot, values);
    updateGestureMorph();
    S._onGestureUpdate?.();
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

    case '/grain/prob':
      S.grainProbability           = clamp(values[0], 0, 1);
      scheduleUISync();
      break;

    case '/grain/dir':    S._dispatchAction?.('grain_dir', 127);   break;

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

    case '/grain/curve':  S._dispatchAction?.('grain_curve', 127); break;

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

    // ── Camera mode (bang → cycle) ──────────────────────────────────────────
    case '/camera/mode':
      S._dispatchAction?.('camera_mode', 127);
      break;

    // ── Spatial panning (bang → toggle) ──────────────────────────────────────
    case '/spatial/panning':
      S._dispatchAction?.('spatial_panning', 127);
      break;

    // ── Legacy spatial mode (bang → toggle sim/physical compound state) ──────
    case '/spatial/mode':
      if (S.cameraMode === 'sensor' && S.spatialPanning === 'worldlocked') {
        // currently "physical" → switch to "sim"
        if (S._setCameraMode) S._setCameraMode('pull');
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
    case '/cursor/scan':    S._dispatchAction?.('scan_toggle', values[0] ?? 127); break;
    case '/cursor/tare':    S._dispatchAction?.('tare', 127);        break;
    case '/cursor/lock_az': S._dispatchAction?.('lock_az', 127);     break;
    case '/cursor/lock_el': S._dispatchAction?.('lock_el', 127);     break;
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
        const effectiveGain = S.scanMuted ? 0 : v;
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

    // ── Commit system (unified cloud + loop) ────────────────────────────────
    // Trigger/bang actions route through dispatchAction for consistent UI feedback.
    case '/commit/drop':    S._dispatchAction?.('commit_drop', 127);    break;
    case '/commit/draw':    S._dispatchAction?.('commit_draw', values[0] ? 127 : 0); break;
    case '/commit/release': S._dispatchAction?.('commit_release', 127); break;
    case '/commit/clear':   S._dispatchAction?.('commit_clear', 127);   break;
    case '/commit/mode':    S._dispatchAction?.('commit_mode', 127);    break;
    case '/commit/blend':   S._dispatchAction?.('commit_blend', 127);   break;
    case '/commit/tether':  S._dispatchAction?.('commit_tether', 127);  break;
    case '/commit/xfade':
      S.seedXfade = clamp(values[0], 0, 1);
      S._syncImprovUI?.();
      break;
    case '/commit/loop_fade_time':
      S.loopFadeTimeMs = clamp(values[0], 0, 2000);
      { const sl = document.getElementById('loopFadeTimeSlider'); if (sl) sl.value = S.loopFadeTimeMs;
        const nb = document.getElementById('loopFadeTimeNum');    if (nb) nb.value = S.loopFadeTimeMs < 1000 ? Math.round(S.loopFadeTimeMs) + 'ms' : (S.loopFadeTimeMs / 1000).toFixed(1) + 's'; }
      break;
    case '/commit/attack':
      S.seedAttack = clamp(values[0], 0, 10);
      { const sl = document.getElementById('seedAttackSlider');  if (sl) sl.value = S.seedAttack;
        const nb = document.getElementById('seedAttackNum');     if (nb) nb.value = S.seedAttack < 1 ? (S.seedAttack * 1000).toFixed(0) + 'ms' : S.seedAttack.toFixed(1) + 's'; }
      break;
    case '/commit/release_time':
      S.seedRelease = clamp(values[0], 0, 10);
      { const sl = document.getElementById('seedReleaseSlider'); if (sl) sl.value = S.seedRelease;
        const nb = document.getElementById('seedReleaseNum');    if (nb) nb.value = S.seedRelease < 1 ? (S.seedRelease * 1000).toFixed(0) + 'ms' : S.seedRelease.toFixed(1) + 's'; }
      break;
    case '/commit/volume':
      S.seqNextParams.volume = clamp(values[0], 0, 1);
      { const sl = document.getElementById('seqVolumeSlider'); if (sl) sl.value = S.seqNextParams.volume;
        const nb = document.getElementById('seqVolumeNum');    if (nb) nb.value = Math.round(S.seqNextParams.volume * 100) + '%'; }
      break;
    case '/commit/speed':
      S.seqNextParams.speed = clamp(values[0], 0.25, 4);
      { const sl = document.getElementById('seqSpeedSlider'); if (sl) sl.value = S.seqNextParams.speed;
        const nb = document.getElementById('seqSpeedNum');    if (nb) nb.value = S.seqNextParams.speed.toFixed(2) + '×'; }
      break;

    case '/commit/slots':
      S.commitSlotCount = Math.max(1, Math.min(16, Math.round(values[0])));
      { const sel = document.getElementById('commitSlotCountSelect');
        if (sel) sel.value = String(S.commitSlotCount); }
      (S.updateSeedBanksUI || S._syncCommitUI || (() => {}))();
      break;
    case '/commit/overflow':  S._dispatchAction?.('commit_overflow', 127);  break;
    case '/commit/selection': S._dispatchAction?.('commit_selection', 127); break;
    case '/commit/dir':       S._dispatchAction?.('commit_dir', 127);      break;
    case '/commit/loop_release': S._dispatchAction?.('loop_release_mode', 127); break;

    // ── Trace mode ──────────────────────────────────────────────────────────
    case '/trace/mode':   S._dispatchAction?.('trace_mode', 127); break;
    case '/trace/toggle': S._dispatchAction?.('trace_toggle', 127); break;

    case '/undo':         S._dispatchAction?.('undo', 127);       break;
    case '/sweep':        S._dispatchAction?.('sweep', 127);      break;

    // ── Paint (live rec + sample painting) ─────────────────────────────────
    // Routed through dispatchAction for full lifecycle (mic, stroke, seq mode).
    // /trace int — 1 = start trace (rec + paint), 0 = stop
    case '/trace':
      S._dispatchAction?.('recpaint', values[0] ? 127 : 0);
      break;
    // /paint/N int — 1 = start sample N paint, 0 = stop
    case '/paint/1':  case '/paint/2':  case '/paint/3':  case '/paint/4':
    case '/paint/5':  case '/paint/6':  case '/paint/7':  case '/paint/8':
    case '/paint/9':  case '/paint/10': {
      const n = parseInt(address.split('/')[2]);
      S._dispatchAction?.('paint' + n, values[0] ? 127 : 0);
      break;
    }

    // ── Spatial lock (hold) ─────────────────────────────────────────────────
    case '/spatial/lock': {
      if (S.cameraMode === 'sensor') break;  // alt lock not needed in sensor mode
      const lock = !!values[0];
      if (lock && !S.altLocked) {
        S.altLocked            = true;
        S.altFrozenMousePixelX = S.mousePixelX;
        S.altFrozenMousePixelY = S.mousePixelY;
        if (S.cameraMode === 'surface') S._exitSurfaceLock?.();
        const wrapper = document.getElementById('canvasWrapper');
        if (wrapper) { wrapper.style.cursor = 'auto'; S.canvas.style.cursor = 'auto'; }
        const ind = document.getElementById('altLockIndicator');
        if (ind) ind.style.display = '';
      } else if (!lock && S.altLocked) {
        S.altLocked = false;
        if (S.cameraMode === 'surface') {
          S._requestSurfaceLock?.();
        } else {
          const wrapper = document.getElementById('canvasWrapper');
          if (wrapper) { wrapper.style.cursor = ''; S.canvas.style.cursor = ''; }
        }
        const ind = document.getElementById('altLockIndicator');
        if (ind) ind.style.display = 'none';
      }
      break;
    }

    // ── App ─────────────────────────────────────────────────────────────────
    case '/handsfree':      S._dispatchAction?.('handsfree', 127);  break;
    case '/app/perf':       S._dispatchAction?.('perf', 127);      break;
    case '/app/perfmode':   S._dispatchAction?.('perfmode', 127);  break;
    case '/app/darkmode':   S._dispatchAction?.('darkmode', 127);  break;
    case '/session/erase':  S._dispatchAction?.('erase_all', 127); break;

    // ── Search ───────────────────────────────────────────────────────────────
    case '/search/scope':   S._dispatchAction?.('snap', 127);      break;
    case '/search/fill':    S._dispatchAction?.('k_all', 127);     break;
    case '/search/order':   S._dispatchAction?.('k_seq', 127);     break;
    case '/search/recency': {
      const raw = Math.round(values[0]);
      const n = raw <= 0 ? 0 : Math.min(16, raw);   // 0 = all (no filter)
      if (typeof S.setRecency === 'function') S.setRecency(n);
      else { S.recencyN = n; const el = document.getElementById('recencyVal'); if (el) el.value = n === 0 ? 'all' : n; }
      break;
    }
    case '/search/radius':
      S.searchRadiusDeg = Math.round(clamp(values[0], SEARCH_RADIUS_MIN, SEARCH_RADIUS_MAX));
      scheduleUISync();
      break;
    case '/search/radius/inc': S._dispatchAction?.('radius_inc', 127); break;
    case '/search/radius/dec': S._dispatchAction?.('radius_dec', 127); break;
    case '/search/k': {
      const mx = Math.max(1, S.particles.length);
      S.grainOverrides.k = Math.max(1, Math.min(mx, Math.round(values[0])));
      S.syncGrainControlsUI?.();
      break;
    }

    // ── Pitch shift ─────────────────────────────────────────────────────────
    case '/grain/pitchshift':
      S.grainOverrides.pitchShift = clamp(values[0], -24, 24);
      scheduleUISync();
      break;

    // ── Headphone mixdown levels ────────────────────────────────────────────
    case '/mixdown/cursor':
      setMixdownCursorGain(clamp(values[0], 0, 1));
      break;
    case '/mixdown/house':
      setMixdownHouseGain(clamp(values[0], 0, 1));
      break;

    // ── Master volume & noise gate ──────────────────────────────────────────
    // /master/volume f  — dB value (-60 to +6), drives the audio settings slider
    case '/master/volume':
      S._setOutputGainDb?.(clamp(values[0], -60, 6));
      break;
    // /gate/threshold f — linear RMS (0 to 0.06)
    case '/gate/threshold':
      S._setNoiseGateThreshold?.(clamp(values[0], 0, 0.06));
      break;

    // ── Cloud morph ─────────────────────────────────────────────────────────
    // /morph/position f  — 0–1 morph position
    case '/morph/position':
      S._setDesktopMorphT?.(clamp(values[0], 0, 1));
      break;
    // /morph/sticky bang — toggle morph hold
    case '/morph/sticky':
      S._toggleDesktopMorphSticky?.();
      break;
    // /morph/return f — return-to-center glide time in ms (50–3000)
    case '/morph/return':
      S._setDesktopMorphReturnMs?.(clamp(values[0], 50, 3000));
      break;

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
