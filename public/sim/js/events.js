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
import { startEraseStroke, stopEraseStroke } from './erase.js';

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

// True when this keypress would insert a character — i.e. it belongs to whoever
// is typing, not to the shortcut layer. Used to decide which side wins when a
// text field has focus: printable keys yield to typing, everything else
// (function keys, Page Up/Down, Home/End, arrows) still fires its binding.
function _producesText(e) {
  return e.key.length === 1 && !e.ctrlKey && !e.metaKey;
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

  // Where canvas overlays must be appended.
  //
  // NOT #canvasWrapper. In projector mode — which is the DEFAULT layout —
  // setProjectorLayout() moves the real canvas out into .projector-mini-body
  // and collapses .canvas-wrapper to `height: 0; overflow: hidden`. Anything
  // appended to the wrapper is then clipped to nothing: present in the DOM,
  // computed styles all "visible", zero pixels on screen. This is exactly how
  // the perf monitor broke (#141) — it had to be carried into the mini tile.
  //
  // Following the live canvas's parent works in both layouts and survives any
  // future re-nesting. Both hosts are `position: relative`, which is what the
  // absolutely-positioned overlays need.
  function _canvasHost() {
    return S.canvas?.parentElement || document.getElementById('canvasWrapper');
  }

  // Release alt-lock: resume camera control, re-enter pointer lock in surface
  // mode. Shared by the Alt keypress and the overlay's click — clicking the
  // overlay while alt-locked must clear the lock too, or the pointer would be
  // recaptured with S.altLocked still true and the two would disagree.
  function _releaseAltLock() {
    S.altLocked = false;
    if (S.cameraMode === 'surface') {
      S._requestSurfaceLock?.();     // also hides the overlay
    } else {
      const host = _canvasHost();
      if (host) { host.style.cursor = ''; S.canvas.style.cursor = ''; }
    }
    const ind = document.getElementById('altLockIndicator');
    if (ind) ind.style.display = 'none';
    S._syncSessionAltLock?.(false);
  }

  function _showSurfaceOverlay() {
    if (_surfaceOverlay) return;
    const wrapper = _canvasHost();
    if (!wrapper) return;
    const altKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌥ option' : 'Alt';
    // Same overlay, two situations — the copy has to say which one you're in.
    // Alt-lock is a deliberate "let me use the UI"; a dropped lock (Esc, focus
    // loss, boot) is not. Telling someone who just pressed Alt to "use Alt to
    // free the cursor" would be describing what they already did.
    const viaAlt = !!S.altLocked;
    _surfaceOverlay = document.createElement('div');
    _surfaceOverlay.id = 'surfaceLockOverlay';
    _surfaceOverlay.innerHTML = viaAlt
      ? `<span class="surface-overlay-main">cursor freed — the UI is yours</span>` +
        `<span class="surface-overlay-hint">click here or press ${altKey} again to re-enter surface mode</span>`
      : `<span class="surface-overlay-main">click to re-enter surface mode</span>` +
        `<span class="surface-overlay-hint">tip: use ${altKey} to free the cursor without leaving surface mode</span>`;
    wrapper.appendChild(_surfaceOverlay);
    _surfaceOverlay.addEventListener('click', () => {
      // Clicking is equivalent to pressing Alt again when alt-locked, so route
      // through the same release — otherwise the alt-lock indicator would
      // stay lit and the camera stay frozen with the pointer recaptured.
      if (S.altLocked) _releaseAltLock();
      else             S._requestSurfaceLock?.();
    });
  }

  S._hideSurfaceOverlay = _hideSurfaceOverlay;

  function _hideSurfaceOverlay() {
    if (_surfaceOverlay) {
      _surfaceOverlay.remove();
      _surfaceOverlay = null;
    }
  }

  // ── "How to get out" banner, shown on ENTERING surface mode ──────────────
  // The overlay above only appears once pointer lock has already been lost —
  // it tells you how to get back IN. Entering is the moment that needs the
  // opposite: the pointer is captured, the mouse no longer reaches the UI, and
  // nothing on screen says which key releases it.
  //
  // A banner rather than a modal on purpose: a dialog that has to be dismissed
  // is the wrong thing to put in front of someone who just changed camera mode
  // mid-performance. This states the escape hatch and gets out of the way.
  let _surfaceHint = null;
  let _surfaceHintTimer = null;

  function _showSurfaceEntryHint() {
    const wrapper = _canvasHost();   // see _canvasHost — never #canvasWrapper
    if (!wrapper) return;
    const altKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌥ option' : 'Alt';
    clearTimeout(_surfaceHintTimer);
    _surfaceHint?.remove();

    _surfaceHint = document.createElement('div');
    _surfaceHint.id = 'surfaceEntryHint';
    _surfaceHint.innerHTML =
      `<span class="surface-hint-title">surface mode</span>` +
      `<span class="surface-hint-body">the pointer is captured — hold <kbd>${altKey}</kbd> ` +
      `to free the cursor, or press <kbd>Esc</kbd> to release the lock</span>`;
    wrapper.appendChild(_surfaceHint);
    // Non-interactive (pointer-events: none in CSS) so it can never swallow a
    // click meant for the canvas underneath it.
    requestAnimationFrame(() => _surfaceHint?.classList.add('visible'));

    // 4s was too short to read twice — long enough to notice, not long enough
    // to absorb. This is a message you read once and act on, so it holds until
    // it's been used or clearly ignored. Pressing Alt dismisses it early (see
    // the keydown handler), which is the real exit for anyone who already
    // knows the shortcut.
    _surfaceHintTimer = setTimeout(() => {
      _surfaceHint?.classList.remove('visible');
      // Outlast the fade before removing, so it doesn't disappear mid-transition.
      setTimeout(() => { _surfaceHint?.remove(); _surfaceHint = null; }, 400);
    }, 12000);
  }
  S._showSurfaceEntryHint = _showSurfaceEntryHint;

  function _hideSurfaceEntryHint() {
    clearTimeout(_surfaceHintTimer);
    _surfaceHint?.remove();
    _surfaceHint = null;
  }
  S._hideSurfaceEntryHint = _hideSurfaceEntryHint;

  document.addEventListener('pointerlockchange', () => {
    _pointerLocked = document.pointerLockElement === S.canvas;
    if (!_pointerLocked && S.cameraMode === 'surface') {
      // One rule: in surface mode, no pointer lock ⇒ show the way back in.
      // This used to skip the alt-lock case, which meant pressing Alt dropped
      // you into a state with a free cursor, a frozen camera and nothing on
      // screen saying how to resume. Alt-locking is the most common way to
      // leave the lock, so it was the case that needed the overlay most.
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

    // ── Custom key bindings (overrides) ─────────────────────────────────
    // Check user-defined key mappings before hardcoded defaults.
    // If a custom binding matches, dispatch it and skip the rest.
    //
    // This runs BEFORE the text-entry guard below. Foot pedals and external
    // controllers send ordinary keystrokes, and hands are often still on a
    // panel field when the pedal fires — bailing on focus first would skip the
    // binding and let the raw key reach the browser, so a pedal bound to Page
    // Down would scroll the panel instead of firing its action. Printable keys
    // still yield to typing (a binding on "d" must not eat text entry); keys
    // that don't insert a character always win.
    const typingIntoField = _focusedOnFormField() && _producesText(e);
    if (S._keyMappings && S._dispatchAction && !e.repeat && !typingIntoField) {
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

    // Skip the hardcoded shortcuts below when a text input or textarea has
    // focus — the user is typing into a form field, not issuing app commands.
    // Escape blurs the focused field and stops — it shouldn't also fire
    // any app-level Escape action.
    if (_focusedOnFormField()) {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
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
        // The banner exists to teach exactly this key. Using it is proof the
        // message landed, so retire it early instead of making it sit out its
        // full timeout over the canvas.
        _hideSurfaceEntryHint();
        if (S.cameraMode === 'surface') {
          S._exitSurfaceLock?.();
          // Raise the overlay here rather than leaning on the
          // pointerlockchange that exitPointerLock triggers: that event only
          // fires if the lock was actually held, and alt-lock is reachable
          // from states where it wasn't (lock request denied, window never
          // focused). The event path still runs and no-ops on the early
          // return, so locked and unlocked entries agree.
          _showSurfaceOverlay();
        }
        const host = _canvasHost();   // NOT #canvasWrapper — see _canvasHost
        if (host) { host.style.cursor = 'auto'; S.canvas.style.cursor = 'auto'; }
        const ind = document.getElementById('altLockIndicator');
        if (ind) ind.style.display = '';
        S._syncSessionAltLock?.(true);
      } else {
        _releaseAltLock();
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
      // Route through dispatchAction so keyboard, MIDI and /morph/radial OSC
      // all share one code path (and the mapping UI flash).
      if (S._dispatchAction) S._dispatchAction('radial_morph', 127);
      else { S.radialMorphOn = !S.radialMorphOn; S._syncMorphBtnUI?.(); }
    }

    // H: toggle handsfree recording
    if ((e.key === 'h' || e.key === 'H') && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.repeat) {
      e.preventDefault();
      toggleHandsfree();
    }

    // F (hold): erase brush — momentary erase at cursor (radius + recency)
    if (e.key === 'f' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.repeat) {
      e.preventDefault();
      startEraseStroke();
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

    // F release: end erase stroke
    if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
      stopEraseStroke();
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

  // Coalesce resize handling to one run per frame — macOS fires resize
  // continuously during a window drag, and each un-throttled handler run
  // reallocates the canvas buffer. Those main-thread stalls starve the
  // renderer→RtAudio IPC audio hop (audible as zipper noise while
  // resizing). One rAF-batched run per frame keeps the drag smooth; the
  // final geometry is always applied.
  let _resizeQueued = false;
  window.addEventListener('resize', () => {
    if (_resizeQueued) return;
    _resizeQueued = true;
    requestAnimationFrame(() => {
      _resizeQueued = false;
      resizeCanvas();
      drawPresetWaveform();
    });
  });

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

  // ── Projector mode ────────────────────────────────────────────────────
  // The 4-column layout (canvas mini-tile + device columns) is the DEFAULT
  // view — it is applied once at the end of setupEvents and never torn down.
  // Shift+F / the projector button only opens/closes the mirrored popup that
  // drives an external display (drag to projector, double-click to fullscreen).
  //
  // Column partition: each .device tile lives in one of four flex columns
  // ([ leftCol ][ centerWrap( canvas, [ cLeftCol, cRightCol ] ) ][ rightCol ]).
  // Initial column membership comes from DEFAULT_PROJECTOR_LAYOUT (or the
  // saved layout in localStorage); the up/down arrows on each tile header
  // reorder across columns and persist via _saveProjectorLayoutFromDom.

  // Move the real canvas into / out of a mini wrapper inside the panel flow
  let _miniWrapper = null;
  let _origCanvasParent = null;
  let _origCanvasNext = null;

  // Default projector-mode column layout — applied on first entry when there
  // is no saved layout in localStorage. Keys match the `device--KEY` class
  // suffix in index.html. Unlisted tiles fall into the right column so they
  // remain reachable.
  // 5-column projector layout. Outer ratio is 1 : 3 : 1 — the center takes
  // 3 sub-columns (cleft, cmid, cright) under the canvas, so the whole
  // panel rail reads as five equal-width slices. Tuned 2026-04-23 to
  // avoid over-wide panels at laptop-and-up viewport widths where the
  // old 4-column (1:2:1) layout left each panel ~25% of the viewport.
  // v2 layout model (2026-07-06, drag-rearrange work): five POSITIONAL
  // columns (slots 0–4) plus a canvas position. The canvas block spans two
  // adjacent slots (canvasPos, canvasPos+1); those two columns nest under it,
  // the other three stand at root level. Moving the canvas re-nests columns —
  // tiles never move with it ("canvas alone" semantics, chosen by Ek).
  // Old named-key format (left/cleft/cmid/cright/right) migrates one-shot.
  const DEFAULT_PROJECTOR_LAYOUT = {
    canvasPos: 0,
    cols: [
      ['audio', 'session'],                // slot 0 — under canvas
      ['play', 'erase'],                   // slot 1 — under canvas
      ['envelope', 'preset', 'search'],    // slot 2
      ['grain'],                           // slot 3
      ['commit'],                          // slot 4
    ],
  };

  function _loadProjectorLayout() {
    // v2 format
    try {
      const saved = JSON.parse(localStorage.getItem('mubone_projector_layout_v2'));
      if (saved && Array.isArray(saved.cols) && saved.cols.length === 5) {
        saved.canvasPos = Math.max(0, Math.min(3, saved.canvasPos ?? 1));
        return saved;
      }
    } catch (_) {}
    // One-shot migration from the old named-key format (canvas was fixed at
    // slots 1–2): read old → write v2 → delete old.
    try {
      const old = JSON.parse(localStorage.getItem('mubone_projector_layout'));
      if (old && typeof old === 'object' && 'cmid' in old) {
        const v2 = {
          canvasPos: 1,
          cols: [old.left || [], old.cleft || [], old.cmid || [],
                 old.cright || [], old.right || []],
        };
        localStorage.setItem('mubone_projector_layout_v2', JSON.stringify(v2));
        localStorage.removeItem('mubone_projector_layout');
        return v2;
      }
      localStorage.removeItem('mubone_projector_layout');
    } catch (_) {}
    return null;
  }
  function _saveProjectorLayoutFromDom() {
    const panel = document.querySelector('.right-panel');
    if (!panel) return;
    const cols = [[], [], [], [], []];
    panel.querySelectorAll('.projector-col').forEach(col => {
      const i = parseInt(col.dataset.col, 10);
      if (i < 0 || i > 4 || Number.isNaN(i)) return;
      cols[i] = [...col.children]
        .map(d => d.className.match?.(/device--(\S+)/)?.[1])
        .filter(Boolean);
    });
    try {
      localStorage.setItem('mubone_projector_layout_v2',
        JSON.stringify({ canvasPos: _canvasPos, cols }));
    } catch (_) {}
  }

  // Move device tiles into five positional flex-column wrappers (slots 0–4)
  // so each column packs its tiles independently (true masonry). The canvas
  // block (projector-center) spans two adjacent slots — canvasPos and
  // canvasPos+1 — and those two columns nest inside it, below the canvas:
  //
  //    canvasPos = 1 (default):
  //    [ col0 ][        centerWrap         ][ col3 ][ col4 ]
  //    [      ][   projector-mini-canvas   ][      ][      ]
  //    [      ][   col1   ][    col2       ][      ][      ]
  //
  // Moving the canvas (S._moveCanvasTo) re-nests which two columns sit under
  // it; column CONTENTS never move with the canvas. Columns keep stable
  // identity via data-col regardless of nesting.
  //
  // querySelectorAll('.device') walks depth-first in document order, so
  // _savePanelOrder in main.js continues to see tiles in the correct order.
  let _canvasPos = 1;   // canvas spans slots (_canvasPos, _canvasPos + 1)

  function _projectorCols(panel) {
    const cols = [];
    for (let i = 0; i < 5; i++) {
      let col = panel.querySelector(`.projector-col[data-col="${i}"]`);
      if (!col) {
        col = document.createElement('div');
        col.className = 'projector-col';
        col.dataset.col = String(i);
      }
      cols.push(col);
    }
    return cols;
  }

  // Arrange the outer row + centerWrap nesting for the current _canvasPos.
  // Idempotent — safe to call after any reorder or canvas move.
  function _arrangeProjectorColumns(panel) {
    const ensureDiv = (sel, cls) =>
      panel.querySelector(sel) || Object.assign(document.createElement('div'), { className: cls });
    const centerWrap = ensureDiv('.projector-center',      'projector-center');
    const centerRow  = ensureDiv('.projector-center-cols', 'projector-center-cols');
    const cols = _projectorCols(panel);

    const mini = panel.querySelector('.projector-mini-canvas');
    if (mini && mini.parentNode !== centerWrap) {
      centerWrap.insertBefore(mini, centerWrap.firstChild);
    }
    if (centerRow.parentNode !== centerWrap) centerWrap.appendChild(centerRow);

    // Nest the two spanned columns inside centerRow, in slot order; all
    // others go to the panel root, with centerWrap taking the spanned pair's
    // place in the outer row.
    for (let i = 0; i < 5; i++) {
      if (i === _canvasPos) {
        panel.appendChild(centerWrap);
        centerRow.appendChild(cols[i]);
        centerRow.appendChild(cols[i + 1]);
        i++;  // skip the second spanned slot — already nested
      } else {
        panel.appendChild(cols[i]);
      }
    }
    return cols;
  }

  function _repartitionProjectorPanels() {
    const panel = document.querySelector('.right-panel');
    if (!panel) return;

    // Collect tiles in document order across all existing wrappers.
    const tiles = [...panel.querySelectorAll('.device')]
      .filter(d => !d.classList.contains('projector-mini-canvas'));

    // Column membership is assigned ONCE (on initial entry, when tiles are
    // still flat in .right-panel). After that, drag-and-drop reorders tiles
    // freely across columns — we do not re-distribute. The saved layout
    // (or the default if none exists) decides the initial columns AND the
    // initial canvas position.
    const needsInitial = tiles.some(d => !d.closest('.projector-col'));
    const layout = needsInitial ? (_loadProjectorLayout() || DEFAULT_PROJECTOR_LAYOUT) : null;
    if (layout) _canvasPos = Math.max(0, Math.min(3, layout.canvasPos ?? 1));

    const cols = _arrangeProjectorColumns(panel);

    if (needsInitial) {
      const deviceByKey = new Map();
      tiles.forEach(d => {
        const k = d.className.match(/device--(\S+)/)?.[1];
        if (k) deviceByKey.set(k, d);
      });
      const placed = new Set();
      for (let i = 0; i < 5; i++) {
        for (const k of (layout.cols[i] || [])) {
          const d = deviceByKey.get(k);
          if (d) { cols[i].appendChild(d); placed.add(d); }
        }
      }
      // Any unlisted tiles spill into the last column so they stay visible.
      tiles.forEach(d => { if (!placed.has(d)) cols[4].appendChild(d); });
    }

    // Persist the current layout so it survives reloads.
    _saveProjectorLayoutFromDom();
  }

  // Move the canvas block to span slots (pos, pos+1). Tiles stay in their
  // columns — only the nesting changes. Exposed for panel-drag.js.
  function _moveCanvasTo(pos) {
    pos = Math.max(0, Math.min(3, pos | 0));
    if (pos === _canvasPos) return;
    const panel = document.querySelector('.right-panel');
    if (!panel) return;
    _canvasPos = pos;
    _arrangeProjectorColumns(panel);
    _saveProjectorLayoutFromDom();
    requestAnimationFrame(() => resizeCanvas());
  }

  function _clearProjectorPartition() {
    const panel = document.querySelector('.right-panel');
    if (!panel) return;
    // Flatten: move every device (including mini) back out as a direct child
    // of panel in document order, then drop all (now empty) scaffolding
    // wrappers. Mini is subsequently removed by setProjectorLayout itself.
    [...panel.querySelectorAll('.device')].forEach(t => panel.appendChild(t));
    panel.querySelectorAll(
      '.projector-col, .projector-center-cols, .projector-center'
    ).forEach(el => el.remove());
  }

  function setProjectorLayout(on) {
    const panel = document.querySelector('.right-panel');
    const canvasWrapper = document.querySelector('.canvas-wrapper');
    const canvas = S.canvas;
    if (!panel || !canvasWrapper || !canvas) return;

    // Idempotent: no-op if already in the requested state. Protects against
    // double-entry from the boot path + any legacy callers.
    if (on && _miniWrapper) return;
    if (!on && !_miniWrapper) return;

    if (on) {
      // Remember original position so we can restore later
      _origCanvasParent = canvas.parentElement;
      _origCanvasNext = canvas.nextSibling;

      // Create mini wrapper and move the real canvas into it.
      // No device-label here — the sphere render fills the tile edge-to-edge.
      // A slim hover-reveal grab handle (top center) lets the performer drag
      // the whole canvas block left/right between column slots (panel-drag.js
      // → S._moveCanvasTo); it must NOT cover much canvas since the canvas
      // itself is the paint surface.
      _miniWrapper = document.createElement('div');
      _miniWrapper.className = 'projector-mini-canvas device';
      const miniBody = document.createElement('div');
      miniBody.className = 'projector-mini-body';
      miniBody.appendChild(canvas);
      // Everything that overlays the canvas has to travel WITH the canvas, or
      // it stays marooned in the now-collapsed (height:0, overflow:hidden)
      // .canvas-wrapper — present in the DOM, computed styles all "visible",
      // zero pixels on screen. That was #141 for the perf monitor (p appeared
      // to do nothing) and it recurred for the surface overlays, which main.js
      // can create at boot BEFORE this rAF runs.
      //
      // Listed by id rather than "move every child": .canvas-wrapper also
      // holds the HUD, the drop overlay and the first-run hint, which are
      // positioned against the wrapper and must not follow the canvas.
      for (const id of ['perfMonitor', 'surfaceLockOverlay', 'surfaceEntryHint']) {
        const el = document.getElementById(id);
        if (el) miniBody.appendChild(el);
      }
      _miniWrapper.appendChild(miniBody);
      const miniHandle = document.createElement('div');
      miniHandle.className = 'canvas-drag-handle';
      miniHandle.title = 'drag to move the viz between columns';
      _miniWrapper.appendChild(miniHandle);

      // Insert at the top of the panel flow
      panel.insertBefore(_miniWrapper, panel.firstChild);

      document.body.classList.add('projector-mode');

      // Assign left/right columns to device tiles, and expose the partition
      // fn so the reorder handlers in main.js can re-run it after each move.
      _repartitionProjectorPanels();
      S._repartitionProjector = _repartitionProjectorPanels;
      S._moveCanvasTo = _moveCanvasTo;
      S._saveProjectorLayout = _saveProjectorLayoutFromDom;
    } else {
      document.body.classList.remove('projector-mode');

      // Move canvas back to its original wrapper
      if (_origCanvasParent) {
        if (_origCanvasNext) _origCanvasParent.insertBefore(canvas, _origCanvasNext);
        else _origCanvasParent.appendChild(canvas);
        // Perf monitor rides with the canvas (see enable branch)
        const _pmBack = document.getElementById('perfMonitor');
        if (_pmBack) _origCanvasParent.appendChild(_pmBack);
      }
      if (_miniWrapper) { _miniWrapper.remove(); _miniWrapper = null; }
      _origCanvasParent = null;
      _origCanvasNext = null;

      // Drop partition classes so normal-mode .right-panel flow resumes
      _clearProjectorPartition();
      S._repartitionProjector = null;
      S._moveCanvasTo = null;
      S._saveProjectorLayout = null;
    }

    requestAnimationFrame(() => resizeCanvas());
  }
  // Expose so the boot path (end of setupEvents) can flip layout on once
  // the DOM is fully wired.
  S._setProjectorLayout = setProjectorLayout;

  function toggleProjectorMode() {
    const btn = document.getElementById('projectorModeBtn');

    // Projector LAYOUT is the default view (applied once at boot). This
    // toggle now only opens/closes the mirrored popup — it no longer flips
    // the panel partition or moves the canvas back into .canvas-wrapper.

    // If popup exists, close it
    if (S.projectorPopup && !S.projectorPopup.closed) {
      S.projectorPopup.close();
      S.projectorPopup = null;
      S.projectorCtx = null;
      S.projectorMode = false;
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
    if (btn) btn.classList.add('active');

    // Clean up if user closes popup directly
    pop.addEventListener('beforeunload', () => {
      S.projectorPopup = null;
      S.projectorCtx = null;
      S.projectorMode = false;
      S._syncProjectorHUD = null;
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
    // OSC sends an explicit 0|1 rather than a toggle, so a repeat of the
    // current value is a no-op and shouldn't flash the LED.
    const ledChanged = S.isMuted !== muted;
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
    if (ledChanged) window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'mute_toggle' } }));
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

  // ── Projector layout = default view ─────────────────────────────────────
  // The projector column layout (mini canvas + 4 device columns) is the
  // primary layout for the app. Apply it once at the end of init so every
  // cold-load lands in this view without the user pressing Shift+F. The
  // Shift+F / projector button now only toggles the mirrored popup.
  requestAnimationFrame(() => setProjectorLayout(true));

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
