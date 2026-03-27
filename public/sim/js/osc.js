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
  getOrCreateSlot, getByRole, assignQuatRole, assignInertialRole,
  handleSlotQuaternion, handleSlotInertial,
} from './sensor-registry.js';
import { updateGestureMorph } from './seed-morph.js';
import { setScanMuted, setMixdownCursorGain, setMixdownHouseGain } from './ui-meters.js';
import {
  toggleNearestMode, dropSeqFromCursor,
  releaseCommit, clearAllCommits, clearAllSeqs, clearAllSeeds, updatePlaybackControls,
} from './ui-presets.js';
import { sweep } from './ui-sweep.js';
import { findNearestSeedSlot } from './grain.js';
import { getCursorLonLat, screenToLonLat } from './sphere.js';

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

    case '/grain/curve':
      if (['hann', 'tri', 'rect'].includes(values[0])) {
        S.grainCurveType = values[0];
        rebuildGrainCurves();
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

    // ── Camera mode ────────────────────────────────────────────────────────
    case '/camera/mode':
      if (['pull', 'surface', 'sensor'].includes(values[0])) {
        if (S._setCameraMode) S._setCameraMode(values[0]);
        else S.cameraMode = values[0];
      }
      break;

    // ── Spatial panning ──────────────────────────────────────────────────────
    case '/spatial/panning':
      if (values[0] === 'headlocked' || values[0] === 'worldlocked') {
        if (S._setSpatialPanning) S._setSpatialPanning(values[0]);
        else S.spatialPanning = values[0];
      }
      break;

    // ── Legacy spatial mode (backwards compat) ───────────────────────────────
    // Maps old /spatial/mode sim|physical to new camera + panning axes.
    case '/spatial/mode':
      if (values[0] === 'physical') {
        if (S._setCameraMode) S._setCameraMode('sensor');
        if (S._setSpatialPanning) S._setSpatialPanning('worldlocked');
      } else if (values[0] === 'sim') {
        if (S._setCameraMode) S._setCameraMode('pull');
        if (S._setSpatialPanning) S._setSpatialPanning('headlocked');
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
      setScanMuted(!!values[0]);
      break;

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
    // New addresses — preferred going forward.
    case '/commit/drop':
      if (S.commitMode === 'cloud') S._plantSeed?.();
      else                          dropSeqFromCursor();
      break;
    case '/commit/draw':
      if (S.commitMode === 'cloud') {
        if (values[0] > 0) S._startSeedPlant?.();
        else               S._finalizeSeedPlant?.();
      } else {
        S._dispatchAction?.('commit_draw', values[0] ? 127 : 0);
      }
      break;
    case '/commit/release':
      releaseCommit();
      break;
    case '/commit/clear':
      clearAllCommits();
      break;
    case '/commit/mode':
      if (values[0] === 'cloud' || values[0] === 'loop') {
        S.commitMode = values[0];
      } else {
        // Toggle
        S.commitMode = S.commitMode === 'cloud' ? 'loop' : 'cloud';
      }
      S._syncCommitUI?.();
      break;
    case '/commit/blend':
      if (values[0] === 'all' || values[0] === 'focus') {
        S.seedMode = values[0];
        S._syncImprovUI?.();
      }
      break;
    case '/commit/tether':
      S.seedTether = !!values[0];
      S._syncImprovUI?.();
      break;
    case '/commit/xfade':
      S.seedXfade = clamp(values[0], 0, 1);
      S._syncImprovUI?.();
      break;
    case '/commit/loop_release':
      if (values[0] === 'fade' || values[0] === 'play-to-end') {
        S.loopReleaseMode = values[0];
      } else {
        S.loopReleaseMode = S.loopReleaseMode === 'fade' ? 'play-to-end' : 'fade';
      }
      { const lrSeg = document.getElementById('loopReleaseModeSeg');
        if (lrSeg) lrSeg.querySelectorAll('[data-lrmode]').forEach(b =>
          b.classList.toggle('active', b.dataset.lrmode === S.loopReleaseMode)); }
      break;
    case '/commit/loop_fade_time':
      S.loopFadeTimeMs = clamp(values[0], 0, 2000);
      { const sl = document.getElementById('loopFadeTimeSlider'); if (sl) sl.value = S.loopFadeTimeMs;
        const nb = document.getElementById('loopFadeTimeNum');    if (nb) nb.value = S.loopFadeTimeMs < 1000 ? Math.round(S.loopFadeTimeMs) + 'ms' : (S.loopFadeTimeMs / 1000).toFixed(1) + 's'; }
      break;
    case '/commit/dir':
      if (['fwd', 'rev', 'pingpong'].includes(values[0])) {
        S.seedLoopMode = values[0];
        const seg = document.getElementById('seedLoopModeSeg');
        if (seg) seg.querySelectorAll('[data-loopmode]').forEach(b =>
          b.classList.toggle('active', b.dataset.loopmode === S.seedLoopMode));
      }
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

    // ── Trace mode ──────────────────────────────────────────────────────────
    case '/trace/mode':
      if (['trace', 'trace+loop', 'trace+cloud'].includes(values[0])) {
        S.traceMode = values[0];
      } else {
        // Cycle
        const _tm = ['trace', 'trace+loop', 'trace+cloud'];
        S.traceMode = _tm[(_tm.indexOf(S.traceMode) + 1) % _tm.length];
      }
      S._syncCommitUI?.();
      break;

    // ── Legacy seed/loop addresses (backward compat with existing Max patches) ──
    case '/seed/mode':
      if (values[0] === 'all' || values[0] === 'focus') {
        S.seedMode = values[0];
        S._syncImprovUI?.();
      }
      break;
    case '/seed/tether':
      S.seedTether = !!values[0];
      S._syncImprovUI?.();
      break;
    case '/seed/xfade':
      S.seedXfade = clamp(values[0], 0, 1);
      S._syncImprovUI?.();
      break;
    case '/seed/loopmode':
      if (values[0] === 'pingpong' || values[0] === 'forward' || values[0] === 'rev') {
        S.seedLoopMode = values[0];
        // Apply to nearest commit that has frames
        const { lon: _lmLon, lat: _lmLat } = S.mouseInCanvas
          ? screenToLonLat(S.mousePixelX, S.mousePixelY)
          : getCursorLonLat();
        const _lmSlot = findNearestSeedSlot(_lmLon, _lmLat);
        if (_lmSlot >= 0) {
          const _lmSeed = S.commitSlots?.[_lmSlot] || S.seedSlots?.[_lmSlot];
          if (_lmSeed && _lmSeed.frames) _lmSeed.loopMode = values[0];
        }
        S._syncImprovUI?.();
      }
      break;
    case '/seed/sow':     S._plantSeed?.();  break;
    case '/seed/trail':   // hold-style: value > 0 = start, value 0 = finalize
      if (values[0] > 0) S._startSeedPlant?.();
      else               S._finalizeSeedPlant?.();
      break;
    case '/seed/uproot':  releaseCommit(); break;
    case '/seed/lock': {
      // Legacy: cycle trace mode
      const _tm2 = ['trace', 'trace+loop', 'trace+cloud'];
      S.traceMode = _tm2[(_tm2.indexOf(S.traceMode) + 1) % _tm2.length];
      S._syncCommitUI?.();
      break;
    }
    case '/seed/clear':   clearAllCommits(); break;
    case '/undo':         S._undo?.();       break;
    case '/sweep':        sweep();           break;

    // ── Paint (live rec + sample painting) ─────────────────────────────────
    // Routed through dispatchAction for full lifecycle (mic, stroke, seq mode).
    // /paint int — 1 = start live paint, 0 = stop
    case '/paint':
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

    // ── Search radius step ──────────────────────────────────────────────────
    case '/grain/radius/inc':
      S._dispatchAction?.('radius_inc', 127);
      break;
    case '/grain/radius/dec':
      S._dispatchAction?.('radius_dec', 127);
      break;

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
    case '/app/perf':
      S.perfMonitorVisible = !S.perfMonitorVisible;
      { const el = document.getElementById('perfMonitor');
        if (el) el.style.display = S.perfMonitorVisible ? 'block' : 'none'; }
      break;

    // ── Commit envelope (legacy /seed/ aliases) ──────────────────────────────
    case '/seed/attack':
      S.seedAttack = clamp(values[0], 0, 10);
      { const sl = document.getElementById('seedAttackSlider');  if (sl) sl.value = S.seedAttack;
        const nb = document.getElementById('seedAttackNum');     if (nb) nb.value = S.seedAttack < 1 ? (S.seedAttack * 1000).toFixed(0) + 'ms' : S.seedAttack.toFixed(1) + 's'; }
      break;
    case '/seed/release':
      S.seedRelease = clamp(values[0], 0, 10);
      { const sl = document.getElementById('seedReleaseSlider'); if (sl) sl.value = S.seedRelease;
        const nb = document.getElementById('seedReleaseNum');    if (nb) nb.value = S.seedRelease < 1 ? (S.seedRelease * 1000).toFixed(0) + 'ms' : S.seedRelease.toFixed(1) + 's'; }
      break;

    // ── Search: recency, scope, fill, order ─────────────────────────────────
    case '/grain/recency': {
      const n = Math.max(1, Math.min(16, Math.round(values[0])));
      if (typeof S.setRecency === 'function') S.setRecency(n);
      else S.recencyN = n;
      const el = document.getElementById('recencyVal'); if (el) el.value = n;
      break;
    }
    case '/grain/lock':
      toggleNearestMode();
      break;
    case '/grain/kall':
      if (!S.nearestMode) { S.grainKAllMode = !S.grainKAllMode; updatePlaybackControls(); }
      break;
    case '/grain/kseq':
      S.grainKSeqMode = !S.grainKSeqMode;
      updatePlaybackControls();
      break;

    // ── Radius fade ─────────────────────────────────────────────────────────
    case '/grain/radiusfade':
      S.radiusFadeEnabled = !!values[0];
      S._syncRadiusFadeUI?.();
      break;
    case '/grain/radiusfadecurve':
      S.radiusFadeCurve = clamp(values[0], 0, 1);
      S._syncRadiusFadeUI?.();
      break;

    // ── Pitch shift ─────────────────────────────────────────────────────────
    case '/grain/pitchshift':
      S.grainOverrides.pitchShift = clamp(values[0], -24, 24);
      scheduleUISync();
      break;

    // ── Legacy looper addresses (backward compat) ──────────────────────────
    case '/loop/arm':
      S._dispatchAction?.('commit_draw', values[0] ? 127 : 0);
      break;
    case '/loop/mode':
      // Legacy: set commit mode to loop when 1, cloud when 0
      S.commitMode = values[0] ? 'loop' : 'cloud';
      S._syncCommitUI?.();
      break;
    case '/loop/drop':
      dropSeqFromCursor();
      break;
    case '/loop/resume':
      // Pause/resume removed — release is the only undo for commits
      break;
    case '/loop/pause':
      // Pause/resume removed — use release instead
      break;
    case '/loop/remove':
      releaseCommit();
      break;
    case '/loop/clear':
      clearAllCommits();
      break;
    case '/loop/volume':
      S.seqNextParams.volume = clamp(values[0], 0, 1);
      { const sl = document.getElementById('seqVolumeSlider'); if (sl) sl.value = S.seqNextParams.volume;
        const nb = document.getElementById('seqVolumeNum');    if (nb) nb.value = Math.round(S.seqNextParams.volume * 100) + '%'; }
      break;
    case '/loop/speed':
      S.seqNextParams.speed = clamp(values[0], 0.25, 4);
      { const sl = document.getElementById('seqSpeedSlider'); if (sl) sl.value = S.seqNextParams.speed;
        const nb = document.getElementById('seqSpeedNum');    if (nb) nb.value = S.seqNextParams.speed.toFixed(2) + '×'; }
      break;
    case '/loop/dir':
      if (['fwd', 'rev', 'pingpong'].includes(values[0])) {
        S.seedLoopMode = values[0];
        const seg = document.getElementById('seedLoopModeSeg');
        if (seg) seg.querySelectorAll('[data-loopmode]').forEach(b =>
          b.classList.toggle('active', b.dataset.loopmode === S.seedLoopMode));
      }
      break;

    // ── Headphone mixdown levels ────────────────────────────────────────────
    case '/mixdown/cursor':
      setMixdownCursorGain(clamp(values[0], 0, 1));
      break;
    case '/mixdown/house':
      setMixdownHouseGain(clamp(values[0], 0, 1));
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
