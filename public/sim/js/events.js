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
import { toggleHandsfree } from './handsfree.js';
import { screenToLonLat } from './sphere.js';
import {
  recordStrokeStart, undoLastStroke, updateSampleListActiveState,
  updateSvTabStates, updateSamplePaintIndicator, switchSvTab,
} from './ui-samples.js';
import {
  toggleNearestMode, plantSeed, startSeedPlant, finalizeSeedPlant,
  uprootNearestSeed,
  updatePlaybackControls, flashRadiusTooltip, selectPreset,
  drawPresetWaveform, createSeqFromStroke, dropSeqFromCursor,
  releaseCommit, clearAllCommits,
} from './ui-presets.js';
import { resizeCanvas } from './renderer.js';
import { loadAudioFile } from './ui-samples.js';

import { setScanMuted } from './ui-meters.js';

// ── Erase-all triple-press state ────────────────────────────────────────────
let _erasePressCount = 0;
let _eraseLastPress  = 0;

// ── Tap-toggle vs hold-momentary trace ─────────────────────────────────────
// Quick tap (<200ms) = toggle trace on/off. Hold (≥200ms) = momentary.
// When toggled on + handsfree armed + plain trace mode, gate segments buffers.
const TRACE_TAP_MS  = 200;
let _traceDownAt    = 0;   // performance.now() when spacebar/click went down

// ── Focus helpers ───────────────────────────────────────────────────────────
// Returns true when focus is on a text-entry element that should consume
// keypresses (text inputs, textareas). Selects, range inputs, and buttons
// are blurred after interaction instead so they don't block shortcuts.
function _focusedOnFormField() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT' && el.type !== 'range') return true;
  return false;
}

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

// Grey/restore D-loop buttons when trace+loop owns recording
function _syncCommitBtnLock(locked) {
  if (S.commitMode !== 'loop') return;  // only lock when commit is in loop mode
  const dropBtn = document.getElementById('commitDropBtn');
  const drawBtn = document.getElementById('commitDrawBtn');
  if (dropBtn) { dropBtn.style.opacity = locked ? '0.35' : ''; dropBtn.style.pointerEvents = locked ? 'none' : ''; }
  if (drawBtn) { drawBtn.style.opacity = locked ? '0.35' : ''; drawBtn.style.pointerEvents = locked ? 'none' : ''; }
}

/** Stop toggle-trace: called when user taps space/click to toggle trace OFF,
 *  or when trace mode changes away from plain trace. */
function _stopToggleTrace() {
  S._traceToggled = false;
  S._traceActive  = false;
  _traceDownAt    = 0;

  // If handsfree gate is mid-capture, finalize it
  if (S.hfRecording) {
    const wasPainting = S.isPainting;
    S.isPainting      = false;
    S.currentStrokeId = -1;
    if (S.isRecording) stopLiveRecording();
    S.hfRecording = false;
    S.hfGateOpen  = false;
    // Only count if there was an active painting stroke
    if (wasPainting) {
      S.hfCaptureCount++;
      S.hfCaptureFlashUntil = performance.now() + 400;
      S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
    }
  }

  // If non-handsfree toggle trace was recording, stop it
  if (S.isPainting || S.isRecording) {
    S.isPainting      = false;
    S.currentStrokeId = -1;
    if (S.isRecording) stopLiveRecording();
    S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
  }

  _updateLiveRecUI();
  S._syncHandsfreeUI?.();
}

export function setupEvents() {
  // ── Pointer lock for surface mode ───────────────────────────────────────
  // Surface mode uses pointer lock so the full trackpad range is available
  // (no screen-edge limits). Accumulated deltas map to sphere orientation.
  const SURFACE_SENSITIVITY = 600; // px per π radians of rotation
  let _pointerLocked = false;

  S._surfaceDelta = { dx: 0, dy: 0 };
  S._resetSurfacePosition = () => {
    S._surfaceDelta = { dx: 0, dy: 0 };
    S.camQ = [0, 0, 0, 1]; // identity — face front of sphere
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

    // Surface mode with pointer lock: accumulate per-frame deltas
    if (S.cameraMode === 'surface' && _pointerLocked) {
      S._surfaceDelta.dx += e.movementX / SURFACE_SENSITIVITY;
      S._surfaceDelta.dy += e.movementY / SURFACE_SENSITIVITY;
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

  // ── Right-panel focus management ──────────────────────────────────────────
  // Buttons, sliders, selects, and segmented controls in the right panel steal
  // keyboard focus after interaction. Blur them so shortcuts work immediately.
  const rightPanel = document.querySelector('.right-panel');
  if (rightPanel) {
    rightPanel.addEventListener('mouseup', e => {
      const el = e.target;
      if (!el) return;
      const tag = el.tagName;
      // Blur buttons, range sliders, and div-based seg buttons after click.
      // Text inputs are left alone — user may be typing.
      if (tag === 'BUTTON' || (tag === 'INPUT' && el.type === 'range') ||
          el.classList.contains('grain-seg-btn') ||
          el.classList.contains('oct-btn')) {
        el.blur();
      }
    }, true);  // capture phase so we blur even if a handler stops propagation

    // Blur select dropdowns after the user picks a value — they don't need
    // to stay focused and would otherwise swallow keyboard shortcuts.
    rightPanel.addEventListener('change', e => {
      if (e.target?.tagName === 'SELECT') e.target.blur();
    }, true);
  }

  // ── Spacebar scroll prevention ────────────────────────────────────────────
  // Space is always claimed for paint/record — never let it scroll the page,
  // even when focus is on a right-panel button, slider, or other element.
  // This synchronous listener fires before the async handler below and before
  // the browser's built-in scroll behaviour.
  document.addEventListener('keydown', e => {
    if (_focusedOnFormField()) return;             // let form fields behave normally
    if (e.code === 'Space' && !S._isKeyLearning?.()) e.preventDefault();
  });

  // ── Keyboard ──────────────────────────────────────────────────────────────
  document.addEventListener('keydown', async e => {

    // Skip all default handling while key learn mode is active
    if (S._isKeyLearning?.()) return;

    // Skip shortcuts when a text input, select, or textarea has focus —
    // the user is typing into a form field, not issuing app commands.
    // Escape blurs the focused field and stops — it shouldn't also fire
    // any app-level Escape action.
    if (_focusedOnFormField()) {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }

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
        // Track which hold action this key code activated so keyup releases the right one
        if (S._holdActionIds?.has(actionId)) S._activeHoldKeyMap?.set(e.code, actionId);
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
        S._syncSessionAltLock?.(true);
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
        S._syncSessionAltLock?.(false);
      }
      return;
    }

    // ⌘D: release one commit (nearest or farthest based on selectionMode)
    if (e.key === 'd' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.repeat) {
      e.preventDefault();
      releaseCommit();
    }

    // Shift+D: cycle commit mode (cloud ↔ loop)
    if (e.key === 'D' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.repeat) {
      e.preventDefault();
      S.commitMode = S.commitMode === 'cloud' ? 'loop' : 'cloud';
      S._syncCommitUI?.();
    }

    // D: unified commit key
    //   Quick tap (<200ms) = drop commit (cloud: parked cloud, loop: drop from cursor)
    //   Long hold (≥200ms) = draw commit (cloud: moving path, loop: record new loop)
    //   In loop mode, D-loop takes priority over trace (spacebar/mouse).
    if (e.key === 'd' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.repeat) {
      e.preventDefault();
      // Disallow if slots are full and overflow is off
      if (S.commitOverflow === 'off') {
        let full = true;
        for (let i = 0; i < S.commitSlotCount; i++) {
          const sl = S.commitSlots[i];
          if (!sl || (sl.type === 'cloud' && sl._releasingAt > 0)) { full = false; break; }
        }
        if (full) return;
      }
      S._commitStartMs = performance.now();
      ensureAudioContext();

      if (S.commitMode === 'loop') {
        // Block D-loop while trace+loop is actively recording — trace owns the mic
        if (S._traceActive && S.traceMode === 'trace+loop') return;
        S._cLoopActive = true;
        _traceDownAt = 0; // clear stale tap timestamp — D-loop owns recording now
        // Loop mode: start recording immediately (decision on keyup)
        if (!S.scanMuted) setScanMuted(true);
        const gotMic = S.micPermissionGranted ? true : await requestMicAccess();
        if (gotMic) startLiveRecording();
        recordStrokeStart('live', S.currentLiveBufferIdx);
        S.isPainting      = true;
        S.paintFrameCount = 0;
        // Grey out trace indicator while D-loop owns recording
        const traceInd = document.getElementById('paintIndicatorBtn');
        if (traceInd) { traceInd.style.opacity = '0.35'; traceInd.style.pointerEvents = 'none'; }
      } else {
        // Cloud mode: start cloud recording (captures cursor frames)
        // If trace+cloud is mid-recording, shelve its state so D gets its own seed
        if (S._traceActive && S.traceMode === 'trace+cloud' && S._seedRecordingFrames) {
          S._shelvedSeed = { frames: S._seedRecordingFrames, start: S._seedRecordingStart, slot: S._seedRecordingSlot };
          S._seedRecordingFrames = null;
          S._seedRecordingStart  = 0;
          S._seedRecordingSlot   = -1;
        }
        startSeedPlant();
      }
      _updateLiveRecUI();
    }

    // Spacebar: live recording + painting (trace)
    // Tap (<200ms) = toggle on/off. Hold (≥200ms) = momentary.
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();

      // If trace is already toggled on, this tap toggles it OFF
      if (S._traceToggled) {
        _stopToggleTrace();
        return;
      }

      S._traceActive = true;
      _traceDownAt = performance.now();
      // If D-loop owns recording, just mark trace as held — don't touch audio
      if (!S._cLoopActive) {
        ensureAudioContext();
        // Mute scan + lock commit buttons immediately for trace+loop — don't wait
        // for startLiveRecording to finish (worklet may load async on first press)
        if (S.traceMode === 'trace+loop') {
          if (!S.scanMuted) setScanMuted(true);
          _syncCommitBtnLock(true);
        }
        const gotMic = S.micPermissionGranted ? true : await requestMicAccess();
        if (gotMic) startLiveRecording();
        recordStrokeStart('live', S.currentLiveBufferIdx);
        S.isPainting      = true;
        S.paintFrameCount = 0;
        // Auto-commit cloud during trace when in trace+cloud mode
        if (S.traceMode === 'trace+cloud') startSeedPlant();
        _updateLiveRecUI();
      }
    }

    // QWERTYUIOP: momentary sample paint (10 slots)
    const _sampleKeys = 'qwertyuiop';
    const _sampleIdx = _sampleKeys.indexOf(e.key.toLowerCase());
    if (_sampleIdx !== -1 && !e.repeat && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      if (_sampleIdx < S.samples.length && S.samples[_sampleIdx].buffer) {
        e.preventDefault();
        ensureAudioContext();
        // In trace+loop mode, mute scan when painting
        if (S.traceMode === 'trace+loop' && !S.scanMuted) setScanMuted(true);
        S.activeSampleIndex = _sampleIdx;
        recordStrokeStart('sample');
        S.isPainting      = true;
        S.paintFrameCount = 0;
        // Cold-start worklet if not yet running (e.g. sample paint as first action)
        S._ensureWorkletForSample?.(S.samples[_sampleIdx].buffer);
        if (S.traceMode === 'trace+cloud') startSeedPlant();
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

    // p: toggle performance monitor | Shift+P: toggle high-perf render mode
    if (e.key === 'p' && !e.shiftKey) {
      e.preventDefault();
      S.perfMonitorVisible = !S.perfMonitorVisible;
      const el = document.getElementById('perfMonitor');
      if (el) el.style.display = S.perfMonitorVisible ? 'block' : 'none';
    }
    if (e.key === 'P' && e.shiftKey) {
      e.preventDefault();
      S.perfMode = !S.perfMode;
      S._syncPerfModeUI?.();
      console.log(`[perf] high-performance render mode ${S.perfMode ? 'ON' : 'OFF'}`);
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

    // A: cycle trace mode (trace → trace+loop → trace+cloud → trace)
    if (e.key === 'a' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.repeat) {
      e.preventDefault();
      // If toggled trace is active, force-stop before mode change
      if (S._traceToggled) _stopToggleTrace();
      const _modes = ['trace', 'trace+loop', 'trace+cloud'];
      const _idx = _modes.indexOf(S.traceMode);
      S.traceMode = _modes[(_idx + 1) % _modes.length];
      // Flash the button
      const _btn = document.getElementById('commitLockBtn');
      if (_btn) { _btn.classList.add('flashing'); setTimeout(() => _btn.classList.remove('flashing'), 180); }
      S._syncCommitUI?.();
    }

    // S: toggle scan (cursor spotlight on/off)
    if (e.key === 's' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.repeat) {
      e.preventDefault();
      setScanMuted(!S.scanMuted);
    }

    // M: system mute (master output)
    if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey && !e.repeat) {
      e.preventDefault();
      S._setMuted?.(!S.isMuted);
    }

    // X: toggle radial morph
    if (e.key === 'x' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.repeat) {
      e.preventDefault();
      S.radialMorphOn = !S.radialMorphOn;
      S._syncMorphBtnUI?.();
    }

    // H: toggle handsfree recording
    if ((e.key === 'h' || e.key === 'H') && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.repeat) {
      e.preventDefault();
      toggleHandsfree();
    }

    // - (minus): sweep
    if (e.key === '-' && !e.metaKey && !e.ctrlKey && !e.repeat) {
      e.preventDefault();
      S._sessionSweep?.();
    }

    // Backtick: tare cursor sensor
    if (e.key === '`' && !e.metaKey && !e.ctrlKey && !e.repeat) {
      e.preventDefault();
      S._tareCursor?.();
    }

    // Delete/Backspace: erase all (triple-press within 800ms)
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey && !e.ctrlKey && !e.repeat) {
      e.preventDefault();
      const now = performance.now();
      if (now - (_eraseLastPress ?? 0) > 800) _erasePressCount = 0;
      _erasePressCount = (_erasePressCount ?? 0) + 1;
      _eraseLastPress = now;
      if (_erasePressCount >= 3) {
        _erasePressCount = 0;
        S._eraseAllProgress?.(0); // clear progress display
        S._sessionEraseAll?.();
      } else {
        S._eraseAllProgress?.(_erasePressCount);
      }
    }

    // Shift+F: toggle projector mode
    if (e.key === 'F' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.repeat) {
      e.preventDefault();
      if (S._dispatchAction) S._dispatchAction('projector', 127);
      else toggleProjectorMode();
    }
  });

  document.addEventListener('keyup', e => {
    // Alt key-up is intentionally ignored — lock is a toggle, not momentary
    if (e.code === 'AltLeft' || e.code === 'AltRight') return;

    // Custom key binding keyup — release the hold action that this key activated.
    // Uses _activeHoldKeyMap (populated on keydown) so we release the exact action
    // even if modifiers changed between keydown and keyup.
    if (S._activeHoldKeyMap?.has(e.code)) {
      const actionId = S._activeHoldKeyMap.get(e.code);
      S._activeHoldKeyMap.delete(e.code);
      S._dispatchAction?.(actionId, 0);
      return;
    }
    // For custom-bound trigger actions, swallow keyup (don't fall through to hardcoded handlers)
    if (S._keyMappings) {
      for (const [, km] of Object.entries(S._keyMappings)) {
        if (km.type === 'key' && km.code === e.code) return;
      }
    }

    // D release: finalize commit (tap = drop, hold = draw)
    if (e.key === 'd' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const holdMs = performance.now() - (S._commitStartMs || 0);
      const DROP_THRESHOLD_MS = 200;

      if (S.commitMode === 'loop') {
        // If D-loop was blocked (trace+loop active), nothing to finalize
        if (!S._cLoopActive) return;
        // Loop commit
        if (holdMs < DROP_THRESHOLD_MS) {
          // Quick tap → drop loop: discard the aborted recording, then drop
          // existing stroke under cursor into a loop slot.
          const abortedStrokeId = S.currentStrokeId;
          S.isPainting      = false;
          S.currentStrokeId = -1;
          if (S.isRecording) stopLiveRecording();
          // Remove any particles deposited during the tiny hold
          if (abortedStrokeId > 0) {
            S.particles = S.particles.filter(p => p.strokeId !== abortedStrokeId);
            S._particleVersion++;
            const hIdx = S.strokeHistory.findIndex(h => h.strokeId === abortedStrokeId);
            if (hIdx !== -1) {
              const entry = S.strokeHistory.splice(hIdx, 1)[0];
              if (entry.type === 'live' && entry.liveBufferIndex >= 0) {
                const idx = entry.liveBufferIndex;
                if (idx < S.liveRecBuffers.length) {
                  S.liveRecBuffers.splice(idx, 1);
                  S.particles.forEach(p => { if (p.liveBufferIdx > idx) p.liveBufferIdx--; });
                }
              }
            }
          }
          // Drop the stroke under cursor into a loop slot
          dropSeqFromCursor();
        } else {
          // Long hold → draw loop: finalize recording first so the loop
          // gets the sealed buffer (exact sample count, not over-allocated).
          S.isPainting = false;
          const savedStrokeId = S.currentStrokeId;
          S.currentStrokeId = -1;
          if (S.isRecording) stopLiveRecording();
          if (savedStrokeId > 0) {
            try { createSeqFromStroke(savedStrokeId); } catch (_) {}
          }
          S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
        }
        // D-loop done — restore trace indicator
        S._cLoopActive = false;
        const traceInd = document.getElementById('paintIndicatorBtn');
        if (traceInd) { traceInd.style.opacity = ''; traceInd.style.pointerEvents = ''; }
        // If trace (spacebar/mouse) is still held, resume recording
        if (S._traceActive && !S._traceToggled) {
          if (S.traceMode === 'trace+loop') {
            if (!S.scanMuted) setScanMuted(true);
            _syncCommitBtnLock(true);
          }
          startLiveRecording();
          recordStrokeStart('live', S.currentLiveBufferIdx);
          S.isPainting      = true;
          S.paintFrameCount = 0;
          if (S.traceMode === 'trace+cloud') startSeedPlant();
        }
      } else {
        // Cloud commit: finalize (tap = parked, hold = moving)
        finalizeSeedPlant();
        // If trace+cloud had a shelved seed, restore it so it keeps recording
        if (S._shelvedSeed) {
          S._seedRecordingFrames = S._shelvedSeed.frames;
          S._seedRecordingStart  = S._shelvedSeed.start;
          S._seedRecordingSlot   = S._shelvedSeed.slot;
          S._shelvedSeed = null;
        }
      }
      S._commitStartMs = 0;
      _updateLiveRecUI();
    }

    // Spacebar release: stop recording, end live paint stroke
    if (e.code === 'Space') {
      e.preventDefault();

      // If trace is toggled on, release is a no-op — trace stays on
      if (S._traceToggled) return;

      // Tap (<200ms) = toggle trace on (don't stop recording)
      const tapDuration = performance.now() - _traceDownAt;
      if (_traceDownAt > 0 && tapDuration < TRACE_TAP_MS && !S._cLoopActive) {
        // Only allow toggle in plain trace mode (not trace+loop or trace+cloud)
        if (S.traceMode === 'trace') {
          S._traceToggled = true;
          // If handsfree is armed, hand off to the gate for segmentation:
          // stop this initial recording (too short to keep) and let the gate manage
          if (S.hfArmed) {
            S.isPainting      = false;
            S.currentStrokeId = -1;
            if (S.isRecording) stopLiveRecording();
            // Don't increment color — the gate will manage colors per segment
          } else {
            // No handsfree: just keep recording continuously (toggle trace without gate)
            // Recording stays active, will be stopped by next tap
          }
          _updateLiveRecUI();
          S._syncHandsfreeUI?.();
          return;
        }
        // In locked modes (trace+loop, trace+cloud), fall through to normal momentary stop
      }

      S._traceActive = false;
      _syncCommitBtnLock(false);
      // If D-loop owns recording, just mark trace as released — don't touch audio
      if (!S._cLoopActive) {
        S.isPainting      = false;
        // Finalize recording BEFORE creating the loop so createSeqFromStroke
        // sees the sealed buffer (exact sample count) instead of the over-
        // allocated live buffer whose duration extends into silence.
        const savedStrokeId = S.currentStrokeId;
        S.currentStrokeId = -1;
        if (S.isRecording) stopLiveRecording();

        // Auto-commit based on trace mode
        if (S.traceMode === 'trace+loop' && savedStrokeId > 0) {
          try { createSeqFromStroke(savedStrokeId); } catch (_) {}
        }
        if (S.traceMode === 'trace+cloud') {
          if (S._shelvedSeed) {
            // D is still held — finalize the shelved trace seed, leave D's active recording alone
            const sh = S._shelvedSeed;
            S._shelvedSeed = null;
            const slot = sh.slot;
            const seed = S.commitSlots[slot];
            if (seed && sh.frames && sh.frames.length >= 2) {
              seed.frames   = sh.frames;
              seed.duration = sh.frames[sh.frames.length - 1].t;
              seed.lon      = sh.frames[0].lon;
              seed.lat      = sh.frames[0].lat;
            }
            (S.updateSeedBanksUI || S._syncCommitUI)?.();
          } else {
            finalizeSeedPlant();
          }
        }
        // Scan stays muted after trace+loop — performer controls scan manually
        S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
        _updateLiveRecUI();
      }
    }

    // QWERTYUIOP key release: end sample paint stroke
    const _sampleKeysUp = 'qwertyuiop';
    const _sampleIdxUp = _sampleKeysUp.indexOf(e.key.toLowerCase());
    if (_sampleIdxUp !== -1 && S.activeSampleIndex === _sampleIdxUp) {
      if (S.traceMode === 'trace+loop' && S.currentStrokeId > 0) {
        try { createSeqFromStroke(S.currentStrokeId); } catch (_) {}
      }
      if (S.traceMode === 'trace+cloud') finalizeSeedPlant();
      S.isPainting      = false;
      S.currentStrokeId = -1;
      S.activeSampleIndex = -1;
      updateSampleListActiveState();
      updateSamplePaintIndicator();
    }
  });

  window.addEventListener('resize', () => { resizeCanvas(); drawPresetWaveform(); });

  // Scroll: custom scroll bindings only (radius is [ ] keys only)
  S.canvas.addEventListener('wheel', e => {
    if (S._keyMappings && S._dispatchAction) {
      const dir = e.deltaY > 0 ? 'scroll_down' : 'scroll_up';
      for (const [actionId, km] of Object.entries(S._keyMappings)) {
        if (km.type === dir) {
          e.preventDefault();
          S._dispatchAction(actionId, 127);
          return;
        }
      }
    }
  }, { passive: false });

  // Left click: live rec + paint (trace)
  // Tap (<200ms) = toggle on/off. Hold (≥200ms) = momentary.
  S.canvas.addEventListener('mousedown', async e => {
    if (S.altLocked) return;
    if (e.button !== 0) return;
    e.preventDefault();

    // If trace is already toggled on, this click toggles it OFF
    if (S._traceToggled) {
      _stopToggleTrace();
      return;
    }

    S._traceActive = true;
    _traceDownAt = performance.now();
    // If D-loop owns recording, just mark trace as held — don't touch audio
    if (S._cLoopActive) return;
    ensureAudioContext();
    const hasInput = S.micPermissionGranted ||
                     (window.electronBridge?.isElectron && window._rtAudioInputListening);
    if (!hasInput) {
      await requestMicAccess();
      return;
    }
    // Mute scan + lock commits immediately for trace+loop — don't gate on
    // S.isRecording which may be false if worklet is still loading (first press)
    if (S.traceMode === 'trace+loop') {
      if (!S.scanMuted) setScanMuted(true);
      _syncCommitBtnLock(true);
    }
    startLiveRecording();
    recordStrokeStart('live', S.currentLiveBufferIdx);
    S.isPainting      = true;
    S.paintFrameCount = 0;
    if (S.traceMode === 'trace+cloud') startSeedPlant();
    _updateLiveRecUI();
  });
  S.canvas.addEventListener('mouseup', e => {
    if (S.altLocked) return;
    if (e.button !== 0) return;

    // If trace is toggled on, release is a no-op — trace stays on
    if (S._traceToggled) return;

    // Tap (<200ms) = toggle trace on
    const tapDuration = performance.now() - _traceDownAt;
    if (_traceDownAt > 0 && tapDuration < TRACE_TAP_MS && !S._cLoopActive) {
      if (S.traceMode === 'trace') {
        S._traceToggled = true;
        if (S.hfArmed) {
          // Hand off to gate: stop initial recording, gate manages from here
          S.isPainting      = false;
          S.currentStrokeId = -1;
          if (S.isRecording) stopLiveRecording();
        }
        _updateLiveRecUI();
        S._syncHandsfreeUI?.();
        return;
      }
    }

    S._traceActive = false;
    _syncCommitBtnLock(false);
    // If D-loop owns recording, just mark trace as released — don't touch audio
    if (S._cLoopActive) return;
    S.isPainting = false;
    // Finalize recording BEFORE creating the loop (same fix as spacebar path)
    const savedStrokeId = S.currentStrokeId;
    S.currentStrokeId = -1;
    if (S.isRecording) stopLiveRecording();

    if (S.traceMode === 'trace+loop' && savedStrokeId > 0) {
      try { createSeqFromStroke(savedStrokeId); } catch (_) {}
    }
    if (S.traceMode === 'trace+cloud') {
      if (S._shelvedSeed) {
        // D is still held — finalize the shelved trace seed, leave D's active recording alone
        const sh = S._shelvedSeed;
        S._shelvedSeed = null;
        const slot = sh.slot;
        const seed = S.commitSlots[slot];
        if (seed && sh.frames && sh.frames.length >= 2) {
          seed.frames   = sh.frames;
          seed.duration = sh.frames[sh.frames.length - 1].t;
          seed.lon      = sh.frames[0].lon;
          seed.lat      = sh.frames[0].lat;
        }
        (S.updateSeedBanksUI || S._syncCommitUI)?.();
      } else {
        finalizeSeedPlant();
      }
    }
    // Scan stays muted after trace+loop — performer controls scan manually
    S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
    _updateLiveRecUI();
  });

  // Right click: undo (works even when alt-locked)
  S.canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    undoLastStroke();
  });

  if (!S.isMobile) S.canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

  // ── Fullscreen — shared UI update + toggle ──────────────────────────────
  function applyFullscreenState(isFs) {
    document.getElementById('fullscreenBtn').textContent = isFs ? '✕' : '⛶';
    const btn2 = document.getElementById('fullscreenBtn2');
    if (btn2) btn2.textContent = isFs ? '✕ exit fullscreen' : '⛶ fullscreen';
    document.body.classList.toggle('electron-fullscreen', isFs);
    requestAnimationFrame(() => resizeCanvas());
  }

  document.getElementById('fullscreenBtn')?.addEventListener('click', () => {
    if (window.electronBridge?.toggleFullscreen) {
      // Electron: native fullscreen via IPC. State update comes back via
      // onFullscreenChanged event.
      window.electronBridge.toggleFullscreen();
    } else {
      // Browser: use Fullscreen API on the canvas wrapper.
      const wrapper = document.getElementById('canvasWrapper');
      if (!document.fullscreenElement) wrapper?.requestFullscreen().catch(() => {});
      else document.exitFullscreen();
    }
  });
  // Browser: Fullscreen API state changes (enter/exit, including Escape key)
  document.addEventListener('fullscreenchange', () => {
    const isFs = !!document.fullscreenElement;
    applyFullscreenState(isFs);
  });
  // Electron: native fullscreen state changes (enter/leave, green button, IPC)
  if (window.electronBridge?.onFullscreenChanged) {
    window.electronBridge.onFullscreenChanged((isFs) => applyFullscreenState(isFs));
  }

  // ── Projector mode (Shift+F) — popup mirror + compact laptop layout ─────
  // Opens a popup that mirrors the main canvas each frame (drag to projector,
  // double-click to fullscreen).  Main window switches to 4-column panel
  // layout.  The canvas is moved into a mini tile inside the panel column
  // flow so it sits alongside the control panels at panel size.

  // Move the real canvas into / out of a mini wrapper inside the panel flow
  let _miniWrapper = null;
  let _origCanvasParent = null;
  let _origCanvasNext = null;

  function setProjectorLayout(on) {
    const panel = document.querySelector('.right-panel');
    const canvasWrapper = document.querySelector('.canvas-wrapper');
    const canvas = S.canvas;
    if (!panel || !canvasWrapper || !canvas) return;

    if (on) {
      // Remember original position so we can restore later
      _origCanvasParent = canvas.parentElement;
      _origCanvasNext = canvas.nextSibling;

      // Create mini wrapper and move the real canvas into it
      _miniWrapper = document.createElement('div');
      _miniWrapper.className = 'projector-mini-canvas device';
      const label = document.createElement('div');
      label.className = 'device-label';
      label.innerHTML = '<span class="device-name">projector</span>';
      _miniWrapper.appendChild(label);
      const miniBody = document.createElement('div');
      miniBody.className = 'projector-mini-body';
      miniBody.appendChild(canvas);
      _miniWrapper.appendChild(miniBody);

      // Insert at the top of the panel flow
      panel.insertBefore(_miniWrapper, panel.firstChild);

      document.body.classList.add('projector-mode');
    } else {
      document.body.classList.remove('projector-mode');

      // Move canvas back to its original wrapper
      if (_origCanvasParent) {
        if (_origCanvasNext) _origCanvasParent.insertBefore(canvas, _origCanvasNext);
        else _origCanvasParent.appendChild(canvas);
      }
      if (_miniWrapper) { _miniWrapper.remove(); _miniWrapper = null; }
      _origCanvasParent = null;
      _origCanvasNext = null;
    }

    requestAnimationFrame(() => resizeCanvas());
  }

  function toggleProjectorMode() {
    const btn = document.getElementById('projectorModeBtn');

    // If popup exists, close it
    if (S.projectorPopup && !S.projectorPopup.closed) {
      S.projectorPopup.close();
      S.projectorPopup = null;
      S.projectorCtx = null;
      S.projectorMode = false;
      setProjectorLayout(false);
      if (btn) btn.classList.remove('active');
      return;
    }

    // Open a popup — size it generously so user can drag to projector + fullscreen
    const w = screen.width;
    const h = screen.height;
    const pop = window.open('', 'mubone_projector',
      `width=${w},height=${h},left=0,top=0,menubar=no,toolbar=no,location=no,status=no,scrollbars=no,resizable=yes`);
    if (!pop) {
      console.warn('Popup blocked — allow popups for this site');
      return;
    }

    pop.document.write(`<!DOCTYPE html>
<html><head><title>mubone — projector</title>
<style>
  *{margin:0;padding:0;overflow:hidden;font-family:Inter,Helvetica,sans-serif}
  body{background:#000}
  canvas#mirror{display:block;width:100vw;height:100vh;object-fit:contain}
  .hud{
    position:fixed;
    top:calc(18px * var(--hud-scale,1) + 0.75rem * var(--hud-scale,1));
    left:1rem;right:1rem;
    font-size:calc(1.1rem * var(--hud-scale,1));
    color:#666;pointer-events:none;
    display:flex;align-items:center;justify-content:space-between;
    line-height:1;z-index:10;
  }
  .hud-left,.hud-right{display:flex;align-items:center;gap:calc(1rem * var(--hud-scale,1));flex:1}
  .hud-left{justify-content:flex-start}
  .hud-right{justify-content:flex-end}
  .hud-center{flex:0 0 auto;text-align:center}
  .vm-patch-info{color:#999;font-weight:600;font-size:calc(1.2rem * var(--hud-scale,1));white-space:nowrap;letter-spacing:0.03em}
  #popCoords{white-space:pre;font-variant-numeric:tabular-nums}
  .hf-hud-label{color:#50b850;font-size:calc(0.72rem * var(--hud-scale,1));letter-spacing:0.04em;margin-left:calc(6px * var(--hud-scale,1));opacity:0.85}
  .vm-commit-dots{display:flex;align-items:center;gap:calc(3px * var(--hud-scale,1))}
  .vm-commit-dot{width:calc(7px * var(--hud-scale,1));height:calc(7px * var(--hud-scale,1));border-radius:50%;flex-shrink:0}
  .alt-lock{color:#f0c060}
</style></head>
<body>
<canvas id="mirror"></canvas>
<div class="hud" id="popHud">
  <div class="hud-left">
    <span id="popCoords">--,--</span>
    <span id="popHfLabel" class="hf-hud-label" style="display:none">handsfree</span>
    <span id="popAltLock" class="alt-lock" style="display:none">alt: locked</span>
  </div>
  <div class="hud-center">
    <span id="popPatchInfo" class="vm-patch-info"></span>
  </div>
  <div class="hud-right">
    <span id="popDots" class="vm-commit-dots"></span>
    <span id="popBuffers"></span>
  </div>
</div>
<script>
  document.addEventListener('dblclick', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{});
    else document.exitFullscreen();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.close();
  });
</script></body></html>`);
    pop.document.close();

    const mirrorCanvas = pop.document.getElementById('mirror');
    const resizeMirror = () => {
      if (pop.closed) return;
      mirrorCanvas.width = pop.innerWidth;
      mirrorCanvas.height = pop.innerHeight;
      resizeCanvas();
    };
    pop.addEventListener('resize', resizeMirror);
    resizeMirror();

    // Cache popup HUD element references for per-frame sync
    const _popHud = {
      root:      pop.document.getElementById('popHud'),
      coords:    pop.document.getElementById('popCoords'),
      hfLabel:   pop.document.getElementById('popHfLabel'),
      altLock:   pop.document.getElementById('popAltLock'),
      patchInfo: pop.document.getElementById('popPatchInfo'),
      dots:      pop.document.getElementById('popDots'),
      buffers:   pop.document.getElementById('popBuffers'),
    };
    // Apply initial HUD scale
    pop.document.body.style.setProperty('--hud-scale', S.hudScale);
    if (S.hudScale === 0 && _popHud.root) _popHud.root.style.display = 'none';

    // Sync HUD content from main window → popup each frame
    let _prevHudScale = S.hudScale;
    S._syncProjectorHUD = () => {
      if (pop.closed) { S._syncProjectorHUD = null; return; }
      // Sync HUD scale — controls size of text overlay and hides at 0
      if (S.hudScale !== _prevHudScale) {
        _prevHudScale = S.hudScale;
        pop.document.body.style.setProperty('--hud-scale', S.hudScale);
        if (_popHud.root) _popHud.root.style.display = S.hudScale === 0 ? 'none' : '';
      }
      const src = {
        coords:    document.getElementById('coordinates'),
        hfLabel:   document.getElementById('hfHudLabel'),
        altLock:   document.getElementById('altLockIndicator'),
        patchInfo: document.getElementById('vmPatchInfo'),
        dots:      document.getElementById('vmCommitDots'),
        buffers:   document.getElementById('vmBuffers'),
      };
      if (src.coords && _popHud.coords)
        _popHud.coords.textContent = src.coords.textContent;
      if (src.hfLabel && _popHud.hfLabel)
        _popHud.hfLabel.style.display = src.hfLabel.style.display;
      if (src.altLock && _popHud.altLock)
        _popHud.altLock.style.display = src.altLock.style.display;
      if (src.patchInfo && _popHud.patchInfo)
        _popHud.patchInfo.textContent = src.patchInfo.textContent;
      if (src.dots && _popHud.dots)
        _popHud.dots.innerHTML = src.dots.innerHTML;
      if (src.buffers && _popHud.buffers)
        _popHud.buffers.textContent = src.buffers.textContent;
    };

    S.projectorPopup = pop;
    S.projectorCtx = mirrorCanvas.getContext('2d');
    S.projectorMode = true;
    setProjectorLayout(true);
    if (btn) btn.classList.add('active');

    // Clean up if user closes popup directly
    pop.addEventListener('beforeunload', () => {
      S.projectorPopup = null;
      S.projectorCtx = null;
      S.projectorMode = false;
      S._syncProjectorHUD = null;
      setProjectorLayout(false);
      if (btn) btn.classList.remove('active');
    });
  }
  S._toggleProjectorMode = toggleProjectorMode;
  document.getElementById('projectorModeBtn')?.addEventListener('click', () => {
    if (S._dispatchAction) S._dispatchAction('projector', 127);
    else toggleProjectorMode();
  });

  // (Divider removed — projector mode uses mini canvas tile in panel flow)

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
    S._syncSessionMute?.();
  }
  if (muteBtn) muteBtn.addEventListener('click', () => setMuted(!S.isMuted));
  // Expose for osc.js so /mute also ramps the audio gain and updates the button
  S._setMuted = setMuted;

  // Expose seed/undo actions for osc.js (/seed/sow, /seed/trail, /seed/uproot, /undo)
  S._plantSeed        = plantSeed;
  S._startSeedPlant   = startSeedPlant;
  S._finalizeSeedPlant = finalizeSeedPlant;
  S._uprootSeed       = uprootNearestSeed;
  S._undo         = undoLastStroke;
  // Expose toggle-trace cleanup so other modules (ui-meters commitLockBtn) can call it
  S._stopToggleTrace  = _stopToggleTrace;

  // Expose slot-full check for inline indicator scripts (non-module context)
  window._loopSlotsFull = () =>
    S.seqOverflow === 'off' &&
    Array.from({ length: S.seqSlotCount }, (_, i) => S.seqSlots[i]).every(Boolean);

  // Expose for osc.js — /trace 1 starts trace, /trace 0 stops it.
  // OSC 1/0 is always toggle-style (sender controls timing).
  // When handsfree is armed in plain trace mode, the gate segments buffers.
  S._setRecording = async (shouldRecord) => {
    ensureAudioContext();
    if (shouldRecord) {
      // If already toggled on, ignore duplicate 1
      if (S._traceToggled) return;
      S._traceActive = true;

      // In plain trace + handsfree armed: toggle on, let gate manage recording
      if (S.traceMode === 'trace' && S.hfArmed) {
        S._traceToggled = true;
        S._syncHandsfreeUI?.();
        _updateLiveRecUI();
        return;
      }
      // Plain toggle trace (no handsfree): start one continuous recording
      if (S.traceMode === 'trace') {
        S._traceToggled = true;
      }
      const gotMic = S.micPermissionGranted ? true : await requestMicAccess();
      if (gotMic) startLiveRecording();
      recordStrokeStart('live', S.currentLiveBufferIdx);
      S.isPainting      = true;
      S.paintFrameCount = 0;
    } else {
      // /trace 0 → stop
      if (S._traceToggled) {
        _stopToggleTrace();
        return;
      }
      S.isPainting      = false;
      S.currentStrokeId = -1;
      if (S.isRecording) stopLiveRecording();
      S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
      S._traceActive = false;
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
