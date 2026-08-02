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
import { getOrCreateSlot } from './sensor-registry.js';
import {
  handleOSCSensorQuaternion, handleOSCSensorInertial,
} from './imu-setup.js';
import { updateGestureMorph } from './seed-morph.js';
import { setMixdownCursorGain, setMixdownHouseGain } from './ui-meters.js';
import { updatePlaybackControls } from './ui-presets.js';
import { toggleMappingByIndex, setMappingInput } from './sensor-mapping.js';

// #105: multi-option controls accept either a bang (cycle to next mode) or a
// string argument (set that mode directly, e.g. `/camera/mode sensor`).
// Returns the string arg when present, else 127 (the bang convention that
// dispatchAction's cycle paths expect).
function _bangOrStr(values) {
  const v = values?.[0];
  return (typeof v === 'string' && v.length) ? v : 127;
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

// The local bridge (Max bridge.js / proxy.js) listens on localhost, so it is
// only reachable when mubone is itself being served from this machine.
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
        // If this slot's inertial is gesture source, run downstream
        const slot = getOrCreateSlot(name);
        if (slot.inertialRole === 'gesture') {
          updateGestureMorph();
          S._onGestureUpdate?.();
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

    case '/grain/pervar':
      // Incoming value in ms (0–500) → convert to seconds internally
      S.grainOverrides.periodVar   = clamp(values[0], 0, 500) / 1000;
      scheduleUISync();
      break;

    case '/grain/retrigger':
      S.grainOverrides.retriggerMs = clamp(values[0], 0, 500);
      scheduleUISync();
      break;

    case '/grain/curve':  S._dispatchAction?.('grain_curve', _bangOrStr(values)); break;

    case '/grain/hpf':
      // Incoming value in Hz (20–20000)
      S.grainOverrides.hpfFreq     = clamp(values[0], 20, 20000);
      scheduleUISync();
      break;
    case '/grain/lpf':
      // Incoming value in Hz (20–20000)
      S.grainOverrides.lpfFreq     = clamp(values[0], 20, 20000);
      scheduleUISync();
      break;
    case '/grain/filterq':
      S.grainOverrides.filterQ     = clamp(values[0], 0.1, 20);
      scheduleUISync();
      break;
    case '/grain/filterjitter':
      // Incoming value 0–1 (fraction)
      S.grainOverrides.filterFreqJitter = clamp(values[0], 0, 1);
      scheduleUISync();
      break;

    // ── Preset ───────────────────────────────────────────────────────────────
    // Dispatches a CustomEvent so ui-presets.js can update its UI alongside
    // the state change. ui-presets.js listens for 'osc-preset'.
    //
    // Two forms, both 1-indexed. `/preset N` stays because sequencing patches
    // from Max is far easier with one address and a number than with twenty
    // addresses; `/preset/N` exists because that is the shape every other
    // per-patch binding takes (one action, one address, bang to fire).
    case '/preset': {
      const idx = Math.round(values[0]) - 1;  // 1-indexed from Max
      if (idx >= 0 && idx < PRESETS.length) {
        S._selectPreset?.(idx);
      }
      break;
    }

    // ── Camera mode (bang → cycle, string → set: e.g. `/camera/mode sensor`) ─
    case '/camera/mode':
      S._dispatchAction?.('camera_mode', _bangOrStr(values));
      break;

    // ── Spatial panning (bang → toggle, string → set) ────────────────────────
    case '/spatial/panning':
      S._dispatchAction?.('spatial_panning', _bangOrStr(values));
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
    // Momentary counterpart — 1 = mute, 0 = restore the pre-press state.
    case '/mute/hold':      S._dispatchAction?.('mute_hold', values[0] ? 127 : 0); break;
    case '/cursor/scan':    S._dispatchAction?.('scan_toggle', values[0] ?? 127); break;
    case '/cursor/tare':    S._dispatchAction?.('tare', 127);        break;
    case '/cursor/lock_az': S._dispatchAction?.('lock_az', 127);     break;
    case '/cursor/lock_el': S._dispatchAction?.('lock_el', 127);     break;

    // Sensor mapping toggles (1-indexed from Max → 0-indexed internally)
    case '/mapping/toggle/1': toggleMappingByIndex(0); break;
    case '/mapping/toggle/2': toggleMappingByIndex(1); break;
    case '/mapping/toggle/3': toggleMappingByIndex(2); break;
    case '/mapping/toggle/4': toggleMappingByIndex(3); break;

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
    case '/commit/mode':    S._dispatchAction?.('commit_mode', _bangOrStr(values));    break;
    case '/commit/blend':   S._dispatchAction?.('commit_blend', _bangOrStr(values));   break;
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
      S._syncCommitSlotCount?.();    // syncs slider + numbox
      (S.updateSeedBanksUI || S._syncCommitUI || (() => {}))();
      break;
    case '/commit/overflow':  S._dispatchAction?.('commit_overflow', _bangOrStr(values));  break;
    case '/commit/selection': S._dispatchAction?.('commit_selection', _bangOrStr(values)); break;
    case '/commit/dir':       S._dispatchAction?.('commit_dir', _bangOrStr(values));      break;
    case '/commit/loop_release': S._dispatchAction?.('loop_release_mode', _bangOrStr(values)); break;

    // ── Trace mode ──────────────────────────────────────────────────────────
    case '/trace/mode':   S._dispatchAction?.('trace_mode', _bangOrStr(values)); break;
    case '/trace/toggle': S._dispatchAction?.('trace_toggle', 127); break;

    case '/undo':         S._dispatchAction?.('undo', 127);       break;
    case '/sweep':        S._dispatchAction?.('sweep', 127);      break;
    case '/erase/hold':   S._dispatchAction?.('erase_brush', values[0] ? 127 : 0); break;
    case '/erase/toggle': S._dispatchAction?.('erase_toggle', 127); break;

    // ── Octave shortcuts (discrete steps on the base pitch shift) ──────────
    case '/grain/oct/down':  S._dispatchAction?.('pitch_oct_down', 127);  break;
    case '/grain/oct/reset': S._dispatchAction?.('pitch_oct_reset', 127); break;
    case '/grain/oct/up':    S._dispatchAction?.('pitch_oct_up', 127);    break;

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
    case '/app/projector':  S._dispatchAction?.('projector', 127); break;
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

    // ── Master volume & noise gate ──────────────────────────────────────────
    // /master/volume f  — dB value (-60 to +6), drives the audio settings slider
    case '/master/volume':
      S._setOutputGainDb?.(clamp(values[0], -60, 6));
      break;
    // /gate/threshold f — linear RMS (0 to 0.06)
    case '/gate/threshold':
      S._setNoiseGateThreshold?.(clamp(values[0], 0, 0.06));
      break;
    // /dry/gain f — spatialized live-input gain in the house mix (0 to 2; 1 = unity)
    case '/dry/gain':
      S._setDryMonitorGain?.(clamp(values[0], 0, 2));
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
    // /morph/radial bang — toggle gesture-joystick morph (X key)
    case '/morph/radial':
      S._dispatchAction?.('radial_morph', 127);
      break;

    default: {
      // /preset/N — the per-patch addresses, one per generated preset_N action.
      // Handled here rather than as twenty cases for the same reason the actions
      // are generated: the bank size lives in state.js and nothing else should
      // hard-code it. A bare bang selects; an explicit 0 does not, matching how
      // every other trigger treats a release edge.
      const patch = /^\/preset\/(\d+)$/.exec(address);
      if (patch) {
        const n = parseInt(patch[1], 10);
        if (n >= 1 && n <= PRESETS.length && !(values.length && Number(values[0]) === 0)) {
          S._selectPreset?.(n - 1);
        }
        break;
      }
      DEBUG && console.log(`[osc] unhandled: ${address}`, values);
    }
  }
}

// ── Outbound (browser → Max, or Electron → relay uplink) ─────────────────────
// Sends an OSC-style message out. Transport depends on runtime:
//   Electron — IPC to main, which forwards over UDP 7501 to the relay.
//              The relay rebroadcasts to its WS peers (e.g. the joycon GUI).
//   Browser  — the same WebSocket we use for inbound; relay fans it out to
//              every other peer. Silently dropped when the WS isn't open.
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

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Number(v)));
}
