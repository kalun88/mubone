// ============================================================================
// EVENTS — keyboard, mouse, touch, faders, drag & drop
// ============================================================================

import {
  S,
  LIVE_PAINT_COLORS, SEARCH_RADIUS_MIN, SEARCH_RADIUS_MAX, SEARCH_RADIUS_STEP,
  PRESETS,
} from './state.js';
import { ensureAudioContext } from './audio.js';
import { requestMicAccess, startLiveRecording, stopLiveRecording } from './audio.js';
import { screenToLonLat } from './sphere.js';
import {
  recordStrokeStart, undoLastStroke, updateSampleListActiveState,
  updateSvTabStates, updateSamplePaintIndicator, switchSvTab,
} from './ui-samples.js';
import {
  toggleNearestMode, plantSeed, startSeedPlant, finalizeSeedPlant, uprootNearestSeed,
  updatePlaybackControls, flashRadiusTooltip, selectPreset,
  drawPresetWaveform, createSeqFromStroke, clearAllSeqs, dropSeqFromCursor,
} from './ui-presets.js';
import { resizeCanvas } from './renderer.js';
import { loadAudioFile } from './ui-samples.js';
import { triggerWandTare } from './ui-wand.js';
import { setCursorHouseMuted } from './ui-meters.js';

// ── Input event coalescing ──────────────────────────────────────────────────
// Buffer the latest mouse/touch position and flush once per rAF to avoid
// invalidating angular-distance caches at 60–120Hz when 30Hz is sufficient.
let _pendingMouseX = null, _pendingMouseY = null;
let _pendingPixelX = null, _pendingPixelY = null;
let _inputRAFPending = false;

function _flushInput() {
  _inputRAFPending = false;
  if (_pendingMouseX !== null) {
    S.mouseX      = _pendingMouseX;
    S.mouseY      = _pendingMouseY;
    S.mousePixelX = _pendingPixelX;
    S.mousePixelY = _pendingPixelY;
    _pendingMouseX = null;
  }
}

// ── Helper: get lon/lat from mouse screen position ────────────────────────────
function getMouseLonLat() {
  return screenToLonLat(S.mousePixelX, S.mousePixelY);
}

// ── updateLiveRecUI re-export (used inline here) ──────────────────────────────
function _updateLiveRecUI() {
  S.updateLiveRecUI?.();
}

export function setupEvents() {
  // ── Pointer lock for surface mode ───────────────────────────────────────
  // Surface mode uses pointer lock so the full trackpad range is available
  // (no screen-edge limits). Accumulated deltas map to sphere orientation.
  let _surfaceNX = 0, _surfaceNY = 0;
  const SURFACE_SENSITIVITY = 600; // px for a full -1..+1 sweep
  let _pointerLocked = false;

  S._surfaceInput = { nx: 0, ny: 0 };
  S._resetSurfacePosition = () => {
    _surfaceNX = 0; _surfaceNY = 0;
    S._surfaceInput = { nx: 0, ny: 0 };
  };

  // Pointer lock helpers
  S._requestSurfaceLock = () => {
    if (document.pointerLockElement !== S.canvas) {
      S.canvas.requestPointerLock().catch(() => {});
    }
    _hideSurfaceOverlay();
  };
  S._exitSurfaceLock = () => {
    if (document.pointerLockElement === S.canvas) {
      document.exitPointerLock();
    }
  };

  // ── "Click to re-enter" overlay for surface mode ────────────────────────
  let _surfaceOverlay = null;

  S._showSurfaceOverlay = _showSurfaceOverlay;

  function _showSurfaceOverlay() {
    if (_surfaceOverlay) return;
    const wrapper = document.getElementById('canvasWrapper');
    if (!wrapper) return;
    const altKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌥ option' : 'Alt';
    _surfaceOverlay = document.createElement('div');
    _surfaceOverlay.id = 'surfaceLockOverlay';
    _surfaceOverlay.innerHTML =
      `<span class="surface-overlay-main">click to re-enter surface mode</span>` +
      `<span class="surface-overlay-hint">tip: use ${altKey} to free the cursor without leaving surface mode</span>`;
    wrapper.appendChild(_surfaceOverlay);
    _surfaceOverlay.addEventListener('click', () => {
      S._requestSurfaceLock?.();
    });
  }

  S._hideSurfaceOverlay = _hideSurfaceOverlay;

  function _hideSurfaceOverlay() {
    if (_surfaceOverlay) {
      _surfaceOverlay.remove();
      _surfaceOverlay = null;
    }
  }

  document.addEventListener('pointerlockchange', () => {
    _pointerLocked = document.pointerLockElement === S.canvas;
    if (!_pointerLocked && S.cameraMode === 'surface' && !S.altLocked) {
      // Pointer lock lost (Escape or browser) — show re-enter overlay
      _showSurfaceOverlay();
    }
  });

  // ── Mouse tracking on canvas ─────────────────────────────────────────────
  S.canvas.addEventListener('mousemove', e => {
    // Sensor mode: mouse doesn't drive camera — skip
    if (S.cameraMode === 'sensor') return;

    // Surface mode with pointer lock: accumulate deltas
    if (S.cameraMode === 'surface' && _pointerLocked) {
      _surfaceNX += e.movementX / SURFACE_SENSITIVITY;
      _surfaceNY += e.movementY / SURFACE_SENSITIVITY;
      _surfaceNY = Math.max(-1, Math.min(1, _surfaceNY));
      S._surfaceInput = { nx: _surfaceNX, ny: _surfaceNY };
      return;
    }

    // Surface mode without pointer lock: ignore (overlay is showing)
    if (S.cameraMode === 'surface') return;

    // Pull mode: standard mouse tracking
    if (!S.altLocked) {
      const rect  = S.canvas.getBoundingClientRect();
      _pendingMouseX = ((e.clientX - rect.left) / rect.width  - 0.5) * 2;
      _pendingMouseY = ((e.clientY - rect.top)  / rect.height - 0.5) * 2;
      _pendingPixelX = (e.clientX - rect.left) * (S.canvas.width  / rect.width);
      _pendingPixelY = (e.clientY - rect.top)  * (S.canvas.height / rect.height);
      S.mouseInCanvas = true;
      if (!_inputRAFPending) {
        _inputRAFPending = true;
        requestAnimationFrame(_flushInput);
      }
    }
  });
  S.canvas.addEventListener('mouseleave', () => {
    // Surface mode: keep last position so camera stays put when cursor leaves
    if (S.cameraMode === 'surface') return;
    if (!S.altLocked) S.mouseInCanvas = false;
  });

  // Non-mobile touch for canvas pan (not painting — painting uses mouse events)
  if (!S.isMobile) {
    S.canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const rect = S.canvas.getBoundingClientRect(), t = e.touches[0];
      S.mouseX = ((t.clientX - rect.left) / rect.width  - 0.5) * 2;
      S.mouseY = ((t.clientY - rect.top)  / rect.height - 0.5) * 2;
      S.mouseInCanvas = true;
    });
    S.canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      const rect = S.canvas.getBoundingClientRect(), t = e.touches[0];
      _pendingMouseX = ((t.clientX - rect.left) / rect.width  - 0.5) * 2;
      _pendingMouseY = ((t.clientY - rect.top)  / rect.height - 0.5) * 2;
      _pendingPixelX = 0; _pendingPixelY = 0;  // touch doesn't use pixel coords
      S.mouseInCanvas = true;
      if (!_inputRAFPending) {
        _inputRAFPending = true;
        requestAnimationFrame(_flushInput);
      }
    });
    S.canvas.addEventListener('touchend', e => { e.preventDefault(); S.mouseInCanvas = false; });
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────
  document.addEventListener('keydown', async e => {

    // Skip all default handling while key learn mode is active
    if (S._isKeyLearning?.()) return;

    // ── Custom key bindings (overrides) ─────────────────────────────────
    // Check user-defined key mappings before hardcoded defaults.
    // If a custom binding matches, dispatch it and skip the rest.
    if (S._keyMappings && S._dispatchAction && !e.repeat) {
      for (const [actionId, km] of Object.entries(S._keyMappings)) {
        if (km.type !== 'key') continue;
        if (km.code !== e.code) continue;
        if (km.shift !== e.shiftKey || km.ctrl !== e.ctrlKey || km.meta !== e.metaKey) continue;
        e.preventDefault();
        S._dispatchAction(actionId, 127);
        return;
      }
    }

    // Alt: toggle-lock sphere at current position
    // Only meaningful in pull and surface modes (sensor mode has free mouse already)
    if ((e.code === 'AltLeft' || e.code === 'AltRight') && !e.repeat) {
      e.preventDefault();
      if (S.cameraMode === 'sensor') return;  // alt lock not needed in sensor mode
      if (!S.altLocked) {
        // Lock: freeze camera, release pointer lock (surface), show cursor for UI
        S.altLocked            = true;
        S.altFrozenMousePixelX = S.mousePixelX;
        S.altFrozenMousePixelY = S.mousePixelY;
        if (S.cameraMode === 'surface') S._exitSurfaceLock?.();
        const wrapper = document.getElementById('canvasWrapper');
        if (wrapper) { wrapper.style.cursor = 'auto'; S.canvas.style.cursor = 'auto'; }
        const ind = document.getElementById('altLockIndicator');
        if (ind) ind.style.display = '';
      } else {
        // Unlock: resume camera control, re-enter pointer lock (surface)
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
      return;
    }

    // Spacebar: live recording + painting
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      ensureAudioContext();
      // Auto-mute cursor when starting a sequential recording
      if (S.seqModeEnabled && !S.cursorHouseMuted) setCursorHouseMuted(true);
      const gotMic = S.micPermissionGranted ? true : await requestMicAccess();
      if (gotMic) startLiveRecording();
      recordStrokeStart('live', S.currentLiveBufferIdx);
      S.isPainting      = true;
      S.paintFrameCount = 0;
      _updateLiveRecUI();
    }

    // QWERTYUIOP: momentary sample paint (10 slots)
    const _sampleKeys = 'qwertyuiop';
    const _sampleIdx = _sampleKeys.indexOf(e.key.toLowerCase());
    if (_sampleIdx !== -1 && !e.repeat && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      if (_sampleIdx < S.samples.length && S.samples[_sampleIdx].buffer) {
        e.preventDefault();
        ensureAudioContext();
        // Auto-mute cursor when starting a sequential recording
        if (S.seqModeEnabled && !S.cursorHouseMuted) setCursorHouseMuted(true);
        S.activeSampleIndex = _sampleIdx;
        recordStrokeStart('sample');
        S.isPainting      = true;
        S.paintFrameCount = 0;
        switchSvTab(_sampleIdx);
        updateSampleListActiveState();
        updateSvTabStates();
        updateSamplePaintIndicator();
      }
    }

    // Number keys: select user presets (use e.code to work with shift held)
    // 1–9 → user presets 0–8, 0 → user preset 9
    // Shift+1–9 → user presets 10–18, Shift+0 → user preset 19
    {
      const _digitCodes = ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Digit0'];
      const _digitIdx = _digitCodes.indexOf(e.code);
      if (_digitIdx !== -1 && !e.repeat && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const presetIdx = (_digitIdx === 9 ? 9 : _digitIdx) + (e.shiftKey ? 10 : 0);
        if (presetIdx < PRESETS.length) selectPreset(presetIdx);
      }
    }

    // P: toggle performance monitor
    if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      S.perfMonitorVisible = !S.perfMonitorVisible;
      const el = document.getElementById('perfMonitor');
      if (el) el.style.display = S.perfMonitorVisible ? 'block' : 'none';
    }

    // N: toggle snap/nearest mode
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      toggleNearestMode();
    }

    // [ ] adjust search radius
    if (e.key === '[' || e.key === ']') {
      e.preventDefault();
      if (e.key === '[') S.searchRadiusDeg = Math.max(SEARCH_RADIUS_MIN, S.searchRadiusDeg - SEARCH_RADIUS_STEP);
      if (e.key === ']') S.searchRadiusDeg = Math.min(SEARCH_RADIUS_MAX, S.searchRadiusDeg + SEARCH_RADIUS_STEP);
      updatePlaybackControls();
      flashRadiusTooltip();
    }

    // Cmd/Ctrl+Z: undo last stroke
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.repeat) {
      e.preventDefault();
      undoLastStroke();
    }

    // ArrowDown: start seed drop (hold to record a moving seed)
    if (e.key === 'ArrowDown' && !e.repeat) {
      e.preventDefault();
      startSeedPlant();
    }

    // ArrowUp: pick up nearest seed
    if (e.key === 'ArrowUp' && !e.repeat) {
      e.preventDefault();
      uprootNearestSeed();
    }

    // C: toggle cursor mute
    if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.repeat) {
      e.preventDefault();
      setCursorHouseMuted(!S.cursorHouseMuted);
    }

    // L: toggle sequential mode
    if (e.key === 'l' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.repeat) {
      e.preventDefault();
      S.seqModeEnabled = !S.seqModeEnabled;
      document.getElementById('seqModeBtn')?.classList.toggle('active', S.seqModeEnabled);
    }

    // D: drop loop from current cursor grain
    if (e.key === 'd' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.repeat) {
      e.preventDefault();
      dropSeqFromCursor();
    }

    // M: system mute (master output)
    if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey && !e.repeat) {
      e.preventDefault();
      S._setMuted?.(!S.isMuted);
    }
  });

  document.addEventListener('keyup', e => {
    // Alt key-up is intentionally ignored — lock is a toggle, not momentary
    if (e.code === 'AltLeft' || e.code === 'AltRight') return;

    // Custom key binding keyup — only for hold-type actions (recpaint, paint samples)
    // Trigger/cc actions fire once on keydown and should NOT re-fire on keyup.
    // Modifier matching is relaxed on keyup because modifiers may release first.
    if (S._keyMappings && S._dispatchAction && S._holdActionIds) {
      for (const [actionId, km] of Object.entries(S._keyMappings)) {
        if (km.type !== 'key') continue;
        if (km.code !== e.code) continue;
        if (!S._holdActionIds.has(actionId)) return;  // not a hold action — swallow but don't dispatch
        S._dispatchAction(actionId, 0);
        return;
      }
    }

    // ArrowDown release: finalize seed drop (short hold = stationary, long = moving)
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      finalizeSeedPlant();
    }

    // Spacebar release: stop recording, end live paint stroke
    if (e.code === 'Space') {
      e.preventDefault();
      // In sequential mode, create a sequence from this stroke before resetting.
      // Wrapped in try/catch so cleanup always runs even if seq creation fails
      // (e.g. degenerate region when noise gate rejected most particles).
      if (S.seqModeEnabled && S.currentStrokeId > 0) {
        try { createSeqFromStroke(S.currentStrokeId); } catch (_) {}
      }
      S.isPainting      = false;
      S.currentStrokeId = -1;
      if (S.isRecording) stopLiveRecording();
      S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
      _updateLiveRecUI();
    }

    // QWERTYUIOP key release: end sample paint stroke
    const _sampleKeysUp = 'qwertyuiop';
    const _sampleIdxUp = _sampleKeysUp.indexOf(e.key.toLowerCase());
    if (_sampleIdxUp !== -1 && S.activeSampleIndex === _sampleIdxUp) {
      if (S.seqModeEnabled && S.currentStrokeId > 0) {
        try { createSeqFromStroke(S.currentStrokeId); } catch (_) {}
      }
      S.isPainting      = false;
      S.currentStrokeId = -1;
      S.activeSampleIndex = -1;
      updateSampleListActiveState();
      updateSamplePaintIndicator();
    }
  });

  window.addEventListener('resize', () => { resizeCanvas(); drawPresetWaveform(); });

  // Scroll: radius (or custom scroll binding)
  S.canvas.addEventListener('wheel', e => {
    e.preventDefault();

    // Check custom scroll bindings first
    if (S._keyMappings && S._dispatchAction) {
      const dir = e.deltaY > 0 ? 'scroll_down' : 'scroll_up';
      for (const [actionId, km] of Object.entries(S._keyMappings)) {
        if (km.type === dir) {
          S._dispatchAction(actionId, 127);
          return;
        }
      }
    }

    // Default: radius adjustment
    // deltaY > 0 = scroll/swipe down → shrink radius (zoom in)
    // deltaY < 0 = scroll/swipe up   → grow radius (zoom out)
    const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const delta = raw > 0 ? -SEARCH_RADIUS_STEP : SEARCH_RADIUS_STEP;
    S.searchRadiusDeg = Math.max(SEARCH_RADIUS_MIN, Math.min(SEARCH_RADIUS_MAX, S.searchRadiusDeg + delta));
    updatePlaybackControls();
    flashRadiusTooltip();
  }, { passive: false });

  // Left click: live rec + paint
  S.canvas.addEventListener('mousedown', async e => {
    if (S.altLocked) return;
    if (e.button !== 0) return;
    e.preventDefault();
    ensureAudioContext();
    // Auto-mute cursor when starting a sequential recording
    if (S.seqModeEnabled && !S.cursorHouseMuted) setCursorHouseMuted(true);
    if (!S.micPermissionGranted) {
      await requestMicAccess();
      return;
    }
    startLiveRecording();
    recordStrokeStart('live', S.currentLiveBufferIdx);
    S.isPainting      = true;
    S.paintFrameCount = 0;
    _updateLiveRecUI();
  });
  S.canvas.addEventListener('mouseup', e => {
    if (S.altLocked) return;
    if (e.button !== 0) return;
    if (S.seqModeEnabled && S.currentStrokeId > 0) {
      try { createSeqFromStroke(S.currentStrokeId); } catch (_) {}
    }
    S.isPainting      = false;
    S.currentStrokeId = -1;
    if (S.isRecording) stopLiveRecording();
    S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
    _updateLiveRecUI();
  });

  // Right click: undo
  S.canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (S.altLocked) return;
    undoLastStroke();
  });

  if (!S.isMobile) S.canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

  // ── Fullscreen ────────────────────────────────────────────────────────────
  // In Electron, requestFullscreen() on a sub-element doesn't work — use native
  // BrowserWindow.setFullScreen() via IPC instead.
  document.getElementById('fullscreenBtn')?.addEventListener('click', () => {
    if (window.electronBridge?.toggleFullscreen) {
      window.electronBridge.toggleFullscreen();
    } else {
      const wrapper = document.getElementById('canvasWrapper');
      if (!document.fullscreenElement) wrapper?.requestFullscreen().catch(() => {});
      else document.exitFullscreen();
    }
  });
  document.addEventListener('fullscreenchange', () => {
    document.getElementById('fullscreenBtn').textContent =
      document.fullscreenElement ? '✕' : '⛶';
    requestAnimationFrame(() => resizeCanvas());
  });

  // ── Mute button ───────────────────────────────────────────────────────────
  const muteBtn = document.getElementById('muteBtn');
  function setMuted(muted) {
    S.isMuted = muted;
    ensureAudioContext();
    const t      = S.audioCtx.currentTime;
    const target = muted ? 0 : 1;
    // Browser path: audio flows masterBus → softClipper → analyser → _muteGain → destination
    const mg = window._muteGain;
    if (mg) mg.gain.setTargetAtTime(target, t, 0.01);
    // Electron path: grains connect directly to speaker buses → ChannelMerger → audify.
    // _muteGain is not in that chain, so ramp each bus gain instead.
    // On unmute, restore to the current output gain level (not just 1).
    if (S.speakerBuses) {
      const busTarget = muted ? 0 : (S.outputGainValue ?? 1);
      S.speakerBuses.forEach(({ bus }) => bus.gain.setTargetAtTime(busTarget, t, 0.01));
    }
    if (muteBtn) {
      muteBtn.classList.toggle('muted', S.isMuted);
      const span = muteBtn.querySelector('span:last-child');
      if (span) span.textContent = S.isMuted ? 'unmute' : 'mute';
    }
  }
  if (muteBtn) muteBtn.addEventListener('click', () => setMuted(!S.isMuted));
  // Expose for osc.js so /mute also ramps the audio gain and updates the button
  S._setMuted = setMuted;

  // Expose seed/undo actions for osc.js (/seed/plant, /seed/uproot, /undo)
  S._plantSeed   = plantSeed;
  S._uprootSeed  = uprootNearestSeed;
  S._undo         = undoLastStroke;

  // Expose for osc.js — /record 1 starts live capture, /record 0 stops it.
  // Mirrors the spacebar keydown/keyup logic exactly.
  S._setRecording = async (shouldRecord) => {
    ensureAudioContext();
    if (shouldRecord) {
      const gotMic = S.micPermissionGranted ? true : await requestMicAccess();
      if (gotMic) startLiveRecording();
      recordStrokeStart('live', S.currentLiveBufferIdx);
      S.isPainting      = true;
      S.paintFrameCount = 0;
    } else {
      S.isPainting      = false;
      S.currentStrokeId = -1;
      if (S.isRecording) stopLiveRecording();
      S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
    }
    _updateLiveRecUI();
  };

}

// ── Drag & drop file loading ──────────────────────────────────────────────────

export function setupDragDrop() {
  const overlay = document.getElementById('dropOverlay');
  let dragCounter = 0;

  document.body.addEventListener('dragenter', e => {
    if (e.dataTransfer.types.includes('text/plain') && !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    if (++dragCounter === 1) overlay.classList.add('visible');
  });
  document.body.addEventListener('dragleave', e => {
    e.preventDefault();
    if (--dragCounter <= 0) { dragCounter = 0; overlay.classList.remove('visible'); }
  });
  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', e => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.remove('visible');
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    const files = [...e.dataTransfer.files].filter(f =>
      f.type.startsWith('audio/') || /\.(wav|mp3|ogg|m4a|flac|aac|webm)$/i.test(f.name)
    );
    (async () => {
      for (const file of files) {
        if (S.samples.length >= 9) break;
        await loadAudioFile(file);
      }
    })();
  });
}
