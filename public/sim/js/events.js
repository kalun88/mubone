// ============================================================================
// EVENTS — keyboard, mouse, touch, faders, drag & drop
// ============================================================================

import {
  S,
  LIVE_PAINT_COLORS, SEARCH_RADIUS_MIN, SEARCH_RADIUS_MAX, SEARCH_RADIUS_STEP,
  MASTER_DEFAULT_GAIN, MAX_SAMPLES,
} from './state.js';
import { ensureAudioContext } from './audio.js';
import { requestMicAccess, startLiveRecording, stopLiveRecording, stopLiveRecordingHeld, whenSealed } from './audio.js';
import * as history from './history.js';
import { toggleHandsfree } from './handsfree.js';
import { screenToLonLat } from './sphere.js';
import { recordStrokeStart, undoLastStroke, redoLastStroke } from './ui-samples.js';
import {
  toggleNearestMode, plantSeed, startSeedPlant, startSeedPath, finalizeSeedPlant,
  uprootNearestSeed,
  updatePlaybackControls, flashRadiusTooltip,
} from './ui-presets.js';
import { resizeCanvas } from './renderer.js';
import { loadAudioFile } from './ui-samples.js';

import { setScanMuted } from './ui-meters.js';
import { armTrigger } from './trigger.js';
import { toggleRail } from './tiles.js';

// ── Erase-all triple-press state ────────────────────────────────────────────
let _erasePressCount = 0;
let _eraseLastPress  = 0;

// Every play is ONE thing, decided in brush.js `gesturePress` (toggle or
// momentary, Ek 2026-09-04), and it is started by a PALETTE POSITION — a key,
// a pad, a pedal or OSC (tiles.js). This file owns what a live-source grain
// stroke IS (startPaintStroke / stopPaintStroke below) and nothing about the
// edges: space and the canvas mousedown were the last two raw wires into the
// funnel and both went with arming on 2026-09-11, because "the tool in the
// hand" is what they pressed and there is no hand between presses.

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

// ── Steer reach: the rails ARE the edge (Ek, 2026-08-29) ────────────────────
// Steer maps the pointer's offset from the centre of the CANVAS to a rotation
// speed. The rails overlay the canvas rather than resizing it (#291), so the
// canvas stays full-window while the part you can actually reach with the
// pointer gets narrower every time a rail opens — and the mapping never knew.
//
// Measured at 1440 wide with the tool rail, an engine sheet and the pinned rail
// open, the reachable stage is 385px of a 1438px canvas, and:
//
//   pointer at the RIGHT rail edge → offset 0.659 → t⁴ curve → 7% of full speed
//   pointer at the LEFT  rail edge → offset 0.122 → inside the 0.30 dead zone,
//                                    so the sphere does not move AT ALL
//
// which is exactly "the sphere barely moves". The fix is not to change the
// curve or the dead zone — both are fine — but to measure the offset against
// the stage you can actually reach, so a rail edge means the same thing a
// window edge does: hard over.
//
// The insets are cached and only recomputed when a rail opens or closes or the
// window resizes, because this is read on every pointer move and a
// getBoundingClientRect per rail per event is a forced layout at pointer rate.
// The PALETTE is the bottom edge (Ek, 2026-09-12: "make it move faster at the
// top of the palette bar, that speed there should be the same as the top
// edge. it's moving real slow near that top edge of the palette"): the dock
// overlays the lower stage the way the rails overlay its sides, so the
// vertical offset is measured against the stage above it — hard over at the
// strip's top edge, and the pointer is off-stage once it is on the strip.
const _STAGE_RAILS = { left: ['#toolRail', '#propRail'], right: ['#tcRail'], bottom: ['#paletteDock'] };
let _stageInset = { l: 0, r: 0, b: 0 };
let _stageInsetDirty = true;

function _railExtent(sel, side) {
  const el = document.querySelector(sel);
  if (!el) return 0;
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
  const r = el.getBoundingClientRect();
  if (r.width < 1) return 0;
  const c = S.canvas.getBoundingClientRect();
  // How far the rail eats INTO the canvas from that side — a rail parked
  // off-canvas (a closing transition) contributes nothing.
  return side === 'left'   ? Math.max(0, Math.min(r.right - c.left, c.width))
       : side === 'bottom' ? Math.max(0, Math.min(c.bottom - r.top, c.height))
                           : Math.max(0, Math.min(c.right - r.left, c.width));
}

function _stageInsets() {
  if (_stageInsetDirty) {
    _stageInsetDirty = false;
    const l = Math.max(0, ..._STAGE_RAILS.left.map(s => _railExtent(s, 'left')));
    const r = Math.max(0, ..._STAGE_RAILS.right.map(s => _railExtent(s, 'right')));
    const b = Math.max(0, ..._STAGE_RAILS.bottom.map(s => _railExtent(s, 'bottom')));
    // Never let the rails claim the whole stage: if they somehow cover
    // everything, fall back to the full canvas rather than dividing by ~0.
    const c = S.canvas.getBoundingClientRect();
    _stageInset = { ...((l + r) > 0 && (l + r) < 0.9 * c.width ? { l, r } : { l: 0, r: 0 }),
                    b: b > 0 && b < 0.9 * c.height ? b : 0 };
  }
  return _stageInset;
}

/** Mark the cached stage insets stale. Cheap; the recompute is lazy. */
export function invalidateStageInsets() { _stageInsetDirty = true; }

function _watchStageInsets() {
  window.addEventListener('resize', invalidateStageInsets);
  // The rails are shown and hidden by classes on <body>, so that is the signal.
  new MutationObserver(invalidateStageInsets)
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

// ── Helper: get lon/lat from mouse screen position ────────────────────────────
function getMouseLonLat() {
  return screenToLonLat(S.mousePixelX, S.mousePixelY);
}

// ── updateLiveRecUI re-export (used inline here) ──────────────────────────────
function _updateLiveRecUI() {
  S.updateLiveRecUI?.();
}

/** What a finished trace stroke becomes.
 *
 *  A trigger-type recording (⇧space, or the bindable trace_trigger action)
 *  becomes a trigger regardless of trace mode: the type was chosen before the
 *  recording started and belongs to the buffer, not to any app state.
 *
 *  Shared by the three trace release paths (spacebar, mouse, sample keys) —
 *  they used to carry three copies of one branch, and a fourth would have
 *  been three ways to forget one. Also the single place the trigger-recording
 *  flag is cleared, so it can't leak into the next stroke. A grain stroke
 *  that ends as a CLOUD is not decided here: its path is finalized by
 *  stopPaintStroke (`_seedRecordingDeferred`), after this commit. */
function _commitTraceStroke(strokeId) {
  const wasTrigger = S._recordingTrigger;
  S._recordingTrigger = false;
  S._syncTriggerRecUI?.();
  // An overdub take: hit material that is never armed — it joins its master
  // as a layer instead (ui-presets.js attachOverdub). Read once and cleared
  // here, whatever the stroke came to, so a refused or empty take cannot
  // hand its master to the next stroke.
  const overdub = S._overdubTake;
  S._overdubTake = null;
  // An overdub take with no master SEEDS one (ui-presets.js beginOverdub):
  // read and cleared here for the same reason, and handed to armTrigger so
  // the looper hook pins it whatever the tile's own `on end` says.
  const seed = !!S._overdubSeed;
  S._overdubSeed = false;
  if (!(strokeId > 0)) return;
  // An aborted gesture (brush.js gestureAbort): the take is thrown away once
  // it has sealed — particles, buffer slot, anything it pinned — through the
  // stroke's own history action, which is then gone for good, not redoable.
  // Nothing is armed. Waiting for the seal keeps the recorder's last bundle
  // from landing in a slot that has already been freed.
  if (S._abortStrokeId === strokeId) {
    S._abortStrokeId = null;
    // Off the history NOW — a ×2 bound to undo fires right after the abort
    // and must reach what came before this take, not this take (Ek,
    // 2026-09-10: "i wanted that undo to act instead of the loop activate").
    // The clean-up itself waits for the seal.
    const a = history.detach(x => x.kind === 'stroke' && x.strokeId === strokeId);
    whenSealed(() => { if (a) { a.undo(); a.dispose?.(); } S._pinsDirty = true; S._syncCommitUI?.(); });
    return;
  }
  // The take seals a few ms after stopLiveRecording(), when the recorder's
  // last bundle lands. Both commits read slot.buffer and would otherwise
  // fall back to the oversized live buffer (audio.js, sealing).
  whenSealed(() => {
    if (overdub) {
      let ov = null;
      try { ov = S._attachOverdub?.(strokeId, overdub.seq, overdub.ov); } catch (e) { console.warn('[overdub] attach failed:', e); }
      // The master went while the take ran: the stroke is an ordinary line
      // now, the same as an overdub whose master is unpinned.
      if (!ov) { try { armTrigger(strokeId, { plain: true }); } catch (_) {} }
      return;
    }
    if (wasTrigger) {
      try { armTrigger(strokeId, { loop: seed }); } catch (_) {}
    }
  });
}

/**
 * Start / stop a trigger-type recording: what the main button does when the
 * hand holds a hit brush (the line brushes), from any wire.
 *
 * One implementation reached from the trigger panel's record button and the
 * bindable `trace_trigger` action, so a pad, a pedal and the mouse can't drift
 * apart — the #166 rule.
 *
 * ⇧space is not this: it sets `_recordingTrigger` and presses the main
 * button, so the stroke runs through startPaintStroke with whatever brush is
 * in the hand. Both routes converge on the same two facts — `_recordingTrigger`
 * set while painting, and `armTrigger` on release — through `_commitTraceStroke`.
 */
async function startTriggerRecord() {
  if (S.isPainting) return;
  ensureAudioContext();
  const gotMic = S.micPermissionGranted ? true : await requestMicAccess();
  if (!gotMic) return;
  // Scan is deliberately left alone — see _commitTraceStroke.
  S._recordingTrigger = true;
  startLiveRecording();
  recordStrokeStart('live', S.currentLiveBufferIdx);
  S.isPainting = true;
  _updateLiveRecUI();
  S._syncTriggerRecUI?.();
}

function stopTriggerRecord() {
  if (!S._recordingTrigger) return;
  const savedStrokeId = S.currentStrokeId;
  S.isPainting      = false;
  S.currentStrokeId = -1;
  // The release is stamped and the recorder held by the input latency, so
  // the region from the button has the sound of the release in it.
  if (S.isRecording) stopLiveRecordingHeld(S.latency?.inS || 0);
  // _commitTraceStroke reads and clears the flag, and is the single place that
  // decides what a finished stroke becomes.
  _commitTraceStroke(savedStrokeId);
  S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
  S._liveInk = null;   // the next stroke inks itself from its own first mark
  _updateLiveRecUI();
  S._syncTriggerRecUI?.();
}
S._startTriggerRecord = startTriggerRecord;
S._stopTriggerRecord  = stopTriggerRecord;

/**
 * A live-source grain stroke — what a position press starts when its tile is
 * a grain brush over the live input. One body: space, the mouse, the touch
 * screen and the `recpaint` action each used to carry their own copy, and
 * they disagreed about the mic (space painted without one, the mouse asked
 * and gave up) and about the tap-latch window.
 *
 * Under handsfree (armed, plain trace mode, a TOGGLE-started gesture) the
 * stroke is not recorded here at all: the gate in handsfree.js opens and
 * closes the takes between this start and its stop.
 */
async function startPaintStroke() {
  if (S.isPainting) return;
  ensureAudioContext();
  if (S.hfArmed && S.paintLatched && S.traceMode === 'trace' && !S._recordingTrigger) {
    _updateLiveRecUI(); S._syncHandsfreeUI?.();
    return;
  }
  const hasInput = S.micPermissionGranted ||
                   (window.electronBridge?.isElectron && window._rtAudioInputListening);
  const gotMic = hasInput ? true : await requestMicAccess();
  if (!gotMic || !S._gestureActive?.()) return;   // denied, or released during the prompt
  startLiveRecording();
  recordStrokeStart('live', S.currentLiveBufferIdx);
  S.isPainting = true;
  // `on end: cloud` (the wash brush): record the path, no slot until the
  // release — the cursor alone reads the stroke while it is painted.
  if (S.traceMode === 'trace+cloud') startSeedPath();
  _updateLiveRecUI();
  S._syncTriggerRecUI?.();
}

function stopPaintStroke() {
  // A handsfree take mid-capture is finalised, and counted.
  if (S.hfRecording) {
    const wasPainting = S.isPainting;
    S.isPainting      = false;
    S.currentStrokeId = -1;
    if (S.isRecording) stopLiveRecording();
    S.hfRecording = false;
    S.hfGateOpen  = false;
    if (wasPainting) {
      S.hfCaptureCount++;
      S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
      S._liveInk = null;   // the next stroke inks itself from its own first mark
    }
    S._syncHandsfreeUI?.();
  }
  if (S.isPainting || S.isRecording) {
    S.isPainting = false;
    // Finalize the recording BEFORE the commit so the commit sees
    // the sealed buffer (exact sample count), not the over-allocated live
    // buffer whose duration extends into silence.
    const savedStrokeId = S.currentStrokeId;
    S.currentStrokeId = -1;
    if (S.isRecording) stopLiveRecording();
    _commitTraceStroke(savedStrokeId);
    // Keyed on the recording in flight, not the mode: the sheet's row can
    // flip mid-stroke, and a path left recording would grow for ever.
    if (S._seedRecordingDeferred) finalizeSeedPlant();
    S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
    S._liveInk = null;   // the next stroke inks itself from its own first mark
  } else if (S._recordingTrigger) {
    // ⇧space on a tool that never recorded (the mic was denied, or the
    // eraser): the flag must not leak into the next stroke.
    S._recordingTrigger = false;
    S._syncTriggerRecUI?.();
  }
  _updateLiveRecUI();
  S._syncHandsfreeUI?.();
}
S._startPaintStroke = startPaintStroke;
S._stopPaintStroke  = stopPaintStroke;

export function setupEvents() {
  _watchStageInsets();
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
  // The canvas's own parent, not #canvasWrapper by name. Today those are the
  // same element — the rig view's partition, which used to move the canvas out
  // into a mini tile and collapse the wrapper to `height: 0`, was sunset with
  // the rig view (#291). Following the live canvas keeps that history from
  // being a trap: an overlay appended to a wrapper the canvas has left is
  // present in the DOM with every computed style reading "visible" and zero
  // pixels on screen, which is exactly how the perf monitor broke (#141).
  //
  // Both hosts are `position: relative`, which is what the
  // absolutely-positioned overlays need.
  function _canvasHost() {
    return S.canvas?.parentElement || document.getElementById('canvasWrapper');
  }

  // Release alt-lock: resume camera control, re-enter pointer lock in surface
  // mode. Shared by the Alt keypress and the overlay's click — clicking the
  // overlay while alt-locked must clear the lock too, or the pointer would be
  // recaptured with S.altLocked still true and the two would disagree.
  // ── Whose pointer is it (Ek, 2026-09-01) ────────────────────────────────
  // "in sensor mode, when the sensor is not connected, i don't see the real
  // mouse cursor when it's above the viz area — only in the surrounding
  // footer/header rails."
  //
  // The stage hides the OS pointer (css/style.css, .canvas-wrapper and its
  // canvas) because in steer and surface the mouse IS the instrument: it steers
  // the sphere, the app draws its own reticle, and a second arrow chasing it is
  // noise. Sensor mode is the exception and always was — applyCameraMode's own
  // comment there reads "hide cursor, mouse is free for UI", which is two
  // clauses that contradict each other. Since #291 it also stopped being
  // harmless: the palette and both rails FLOAT OVER the stage, so the hidden
  // region is exactly where those controls live.
  //
  // One owner, because there are two callers and they ran in an order that
  // undid each other: applyCameraMode sets the mode's cursor, and releasing a
  // cursor lock restores it — and the release runs LAST on a mode change.
  S._syncStageCursor = () => {
    if (S.altLocked) return;            // the lock owns it while it is on
    const c = S.cameraMode === 'sensor' ? 'auto' : '';
    const host = _canvasHost();
    if (host) host.style.cursor = c;
    if (S.canvas) S.canvas.style.cursor = c;
  };

  // ── The POINTER half of cursor lock (2026-09-01) ────────────────────────
  // Cursor lock itself is not a state — it is az and el both held, and
  // setAxisSource() in main.js owns that and calls this on the edge. What is
  // left here is the part that only means anything with a mouse: hand the
  // pointer back so the UI is clickable, and freeze the cursor where it was.
  //
  // Sensor mode is excluded, and that gate is load-bearing rather than tidy.
  // S.altLocked is read by grain.js:693, renderer.js:2154/2170 and
  // sensor-mapping.js:354 to switch the cursor from the camera-driven
  // getCursorLonLat() to a FROZEN MOUSE PIXEL. With a sensor driving a tethered
  // cursor (S.cursorQ === null) letting it go true teleports the cursor to
  // wherever the mouse was last seen. Ek's own reading of the mode is the same
  // one: "in sensor mode, az and el lock — cursor does nothing, it's already
  // free."
  S._applyCursorLockPointer = (on) => {
    const want = !!on && S.cameraMode !== 'sensor';
    if (want === S.altLocked) return;   // edge only — this is called per write
    if (!want) { _releaseAltLock(); return; }
    S.altLocked            = true;
    S.altFrozenMousePixelX = S.mousePixelX;
    S.altFrozenMousePixelY = S.mousePixelY;
    if (S.cameraMode === 'surface') S._exitSurfaceLock?.();
    // Raise the overlay here rather than leaning on the pointerlockchange
    // that exitPointerLock triggers: that event only fires if the lock was
    // actually held, and cursor lock is reachable from states where it was
    // not (lock request denied, window never focused). The event path still
    // runs and no-ops on the early return, so locked and unlocked entries
    // agree. In EVERY mode, not surface alone (Ek, 2026-09-12): the option
    // key frees the cursor the same way wherever the camera is, so the same
    // wash says so — a steer-mode lock used to show only the small indicator.
    _showSurfaceOverlay();
    const host = _canvasHost();   // NOT #canvasWrapper — see _canvasHost
    if (host) { host.style.cursor = 'auto'; S.canvas.style.cursor = 'auto'; }
    const ind = document.getElementById('altLockIndicator');
    if (ind) ind.style.display = '';
    S._syncSessionAltLock?.(true);
  };

  function _releaseAltLock() {
    S.altLocked = false;
    if (S.cameraMode === 'surface') {
      S._requestSurfaceLock?.();     // also hides the overlay
    } else {
      _hideSurfaceOverlay();
      S._syncStageCursor();
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
    const back = S.cameraMode === 'surface' ? 're-enter surface mode' : 'take the cursor back';
    _surfaceOverlay.innerHTML = viaAlt
      ? `<span class="surface-overlay-main">cursor freed — the UI is yours</span>` +
        `<span class="surface-overlay-hint">click here or press ${altKey} again to ${back}</span>`
      : `<span class="surface-overlay-main">click to re-enter point mode</span>` +
        `<span class="surface-overlay-hint">tip: use ${altKey} to free the cursor without leaving point mode</span>`;
    wrapper.appendChild(_surfaceOverlay);
    _surfaceOverlay.addEventListener('click', () => {
      // Clicking is equivalent to pressing ⌥ again when cursor-locked, so route
      // through the same unlock — and that now means the AXES, not just the
      // pointer. Releasing only the pointer would recapture it with az and el
      // still held, leaving the sphere frozen with no overlay left to say why.
      if (S.altLocked) S._setCursorLock?.(false);
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

  // The "surface mode — the pointer is captured" banner that popped over the
  // stage on entering surface mode is gone (Ek, 2026-09-12: "remove that box.
  // the overlay is enough"). The overlay below is the one way in and out.

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
  // ON THE DOCUMENT, not the canvas (Ek, 2026-09-12, night: "with the palette
  // bar in the way, the pull moves the sphere really slowly when i want to
  // pull down"). The palette's bed sits over the lower stage and takes the
  // pointer, so a canvas listener stopped hearing the mouse the moment it
  // crossed the strip's top edge — the steer offset froze a few px under
  // centre, which reads as a slow pull. The canvas RECT is still the
  // boundary: inside it the mouse steers whatever is drawn on top, outside
  // it (the chrome, the footer) the mouse has left, which is what
  // `mouseleave` said before.
  const _CHROME = '.tc-bar, .tc-rail, .tc-lrail, .tc-prail, #paletteDock, #settingsModal, .mu-modal, .mu-dialog';
  document.addEventListener('mousemove', e => {
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
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      // THE CHROME IS OUTSIDE (Ek, 2026-09-12: "when my mouse is trying to
      // engage with either rail or the header or footer row or the palette
      // bar, basically anywhere i'm trying to use the GUI, the sphere should
      // automatically stop spinning"). The rails and the palette overlay the
      // canvas, so the rect alone kept the steer alive under a pointer that
      // was reaching for a tile; a pointer on any chrome has left the stage,
      // and the steer stops dead rather than holding its last offset.
      if (!inside || e.target.closest(_CHROME)) { S.mouseInCanvas = false; return; }
      // STEER offset is measured against the reachable stage (canvas minus any
      // open rails) so the rail edge means hard over; the PIXEL coordinates
      // stay in canvas space, because they answer a different question — where
      // on the sphere the cursor is — and the rails do not move the sphere.
      const ins  = _stageInsets();
      const sx0  = rect.left + ins.l;
      const sw   = Math.max(1, rect.width - ins.l - ins.r);
      const sh   = Math.max(1, rect.height - ins.b);
      const clamp1 = v => v < -1 ? -1 : v > 1 ? 1 : v;
      _pendingMouseX = clamp1(((e.clientX - sx0) / sw - 0.5) * 2);
      _pendingMouseY = clamp1(((e.clientY - rect.top) / sh - 0.5) * 2);
      _pendingPixelX = (e.clientX - rect.left) * (S.canvas.width  / rect.width);
      _pendingPixelY = (e.clientY - rect.top)  * (S.canvas.height / rect.height);
      S.mouseInCanvas = true;
      if (!_inputRAFPending) {
        _inputRAFPending = true;
        requestAnimationFrame(_flushInput);
      }
    }
  });
  // The leave is the rect test above; a `mouseleave` on the canvas fired on
  // every crossing into the palette's bed, which is inside the stage.
  document.addEventListener('mouseleave', () => {
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
  const _downKeySrc = new Map();   // key code → the recogniser source it put down
  // A window blur is a release edge: a key-up that never arrives must not
  // leave a source down (a long firing in another window, a momentary stuck).
  window.addEventListener('blur', () => {
    for (const [code, src] of _downKeySrc) { _downKeySrc.delete(code); S._dispatchGesture?.(src, false); }
  });
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
    // A learned key is a SOURCE the button recogniser reads (midi.js
    // dispatchGesture, 2026-09-11): this down and the matching up below are
    // its two edges, and the recogniser decides press · tap · long · extra
    // long · ×2 · ×3 from them with the buttons' timings and rules. The up
    // is matched by CODE, so modifiers changing under a held key still
    // release it. `_downKeySrc` is what is down right now.
    const typingIntoField = _focusedOnFormField() && _producesText(e);
    if (S._keySourceOf && S._dispatchGesture && !e.repeat && !typingIntoField) {
      const src = S._keySourceOf(e);
      if (S._sourceBound?.(src)) {
        e.preventDefault();
        _downKeySrc.set(e.code, src);
        S._dispatchGesture(src, true);
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

    // ⌥ is a SHORTCUT to the two axis locks, not a mechanism of its own
    // (Ek, 2026-09-01). It used to freeze the camera by a separate route and
    // leave azSource/elSource alone, so the footer could read "free" while the
    // sphere would not move. Now it writes the same state the footer buttons
    // write, and the pointer follows from that.
    //
    // No sensor-mode early return any more: there the axes still lock, and
    // _applyCursorLockPointer is what knows the pointer half does not apply.
    if ((e.code === 'AltLeft' || e.code === 'AltRight') && !e.repeat) {
      e.preventDefault();
      S._toggleCursorLock?.();
      return;
    }

    // The D keys (tap D pin, hold D draw, ⇧D kind, ⌘D unpin) went on
    // 2026-09-03 (#327): `=` and `-` are the pin pair on the tile screen
    // (tiles.js, capture phase), and one fact does not get two keys.
    // SPACE IS A FREE KEY (2026-09-11). It was the main button — it fired
    // whatever tool was armed — and with arming gone it has no tool to name.
    // It is learnable onto any palette position on the keys page, which is
    // what Ek asked for: "now spacebar is just like any other key".
    // (⇧space recorded a trigger buffer until 2026-09-09 — "record a hit",
    // out of the vocabulary with the action and its address.)

    // The letter and digit rows belong to the tile screen (#214): digits are
    // tiles by position, Q W E are layers. The patch bank's digits and the
    // Q–P sample-paint row lost their default keys in the same pass the tile
    // row landed. The preset actions stay bindable via MIDI/OSC; the
    // paint1–10 actions died with the stamp brush (#247) — the sampler is a
    // SOURCE now (/source/sampler + /sampler/sample), painted by any brush.

    // (p / ⇧P — the perf monitor and high-perf render — and ⇧F, the projector,
    // lost their keys 2026-09-09: all three are set on their settings pages.)

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

    // Shift+Cmd/Ctrl+Z: redo — checked first; shifted the key reads 'Z'
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z') && !e.repeat) {
      e.preventDefault();
      redoLastStroke();
    }
    // Cmd/Ctrl+Z: undo last stroke
    else if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.repeat) {
      e.preventDefault();
      undoLastStroke();
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

    // H: toggle handsfree recording
    if ((e.key === 'h' || e.key === 'H') && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.repeat) {
      e.preventDefault();
      toggleHandsfree();
    }

    // F was the ERASER's key here until 2026-09-03, when it moved to tiles.js
    // as a palette hold; it is UNBOUND now (Ek, 2026-09-07: "F should be
    // unbounded as a key for erase. We have the palette tiles now"). An
    // eraser is played from its position like every other tool, which applies
    // its preset — a bare startEraseStroke() here never could.

    // `-` used to sweep here; tiles.js takes `-` for unpin in the capture
    // phase and stops it, so that handler was dead (#327). Sweep is the pill.
    // Backtick: zero the cursor
    if (e.key === '`' && !e.metaKey && !e.ctrlKey && !e.repeat) {
      e.preventDefault();
      S._tareCursor?.();
    }

    // Tilde (⇧`): the tool rail, shown or hidden — the tools pill's key. The
    // shifted key rather than the bare one because ` is tare, and tare is
    // hit mid-performance. Tab is the drawer (tiles.js).
    if (e.key === '~' && !e.metaKey && !e.ctrlKey && !e.repeat) {
      e.preventDefault();
      toggleRail();
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


  });

  document.addEventListener('keyup', e => {
    // Alt key-up is intentionally ignored — lock is a toggle, not momentary
    if (e.code === 'AltLeft' || e.code === 'AltRight') return;

    // A learned key's up edge: the recogniser's release (a tap fires here, a
    // momentary lets go, a long that never came is cancelled).
    if (_downKeySrc.has(e.code)) {
      const src = _downKeySrc.get(e.code);
      _downKeySrc.delete(e.code);
      S._dispatchGesture?.(src, false);
      return;
    }
    // For custom-bound trigger actions, swallow keyup (don't fall through to hardcoded handlers)
    if (S._keyMappings) {
      for (const [, km] of Object.entries(S._keyMappings)) {
        if (km.type === 'key' && km.code === e.code) return;
      }
    }

    // Spacebar release: the main button's up edge (nothing in toggle mode).
    if (e.code === 'Space') { e.preventDefault(); S._gestureRelease?.(); }

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
      S._drawEngineScope?.();
    });
  });

  // Scroll (2026-08-28, Ek): a custom scroll binding wins; otherwise plain
  // scroll is the RADIUS (dispatched through the ACTIONS table so every
  // mirror follows — never a bare S.searchRadiusDeg write) and ⇧-scroll is
  // the ZOOM, multiplicative so a notch feels equal at every scale, out to
  // the 360° flat map.
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
    e.preventDefault();
    if (e.shiftKey) {
      // macOS hands ⇧-scroll to deltaX on some devices.
      const d = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      const v = Math.max(10, Math.min(360, (S.fovDeg ?? 80) * Math.exp(d * 0.0015)));
      S.fovDeg = v;
      S._syncZoomUI?.(v);
      return;
    }
    // Continuous, multiplicative — a trackpad should glide, not step
    // through the 2° ladder the inc/dec actions use (those stay for keys
    // and pedals). Scroll up grows the radius.
    S._setSearchRadius?.((S.searchRadiusDeg ?? 10) * Math.exp(e.deltaY * -0.002));
  }, { passive: false });

  // A CLICK ON THE SPHERE PLAYS NOTHING (2026-09-11). It was the main button,
  // the same as space, and it pressed the tool in the hand — there is no hand
  // to press with. The mouse aims the cursor and that is all it does; what
  // plays is a palette position, from a key, a pad or a pedal.
  //
  // A momentary gesture whose key-up the window never sees (focus left
  // mid-hold) ends here, the way erase's does; a toggle-started one is not
  // touched — it ends on its next press, which is what the player expects.
  window.addEventListener('blur', () => S._gestureRelease?.());

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

  // ── Projector MIRROR ──────────────────────────────────────────────────
  // ⇧F / the projector button open a popup window that mirrors the sphere onto
  // an external display. That is all "projector" means here now.
  //
  // The rig view's projector LAYOUT — the partition that moved #sphereCanvas
  // into a mini tile inside .right-panel and dealt the .device tiles into five
  // draggable columns — was sunset on 2026-08-29 (#291) together with the rig
  // view itself. It lives at sandbox/sunset-2026-08-29/projector-partition.js
  // with its revival notes. The canvas is full-bleed in .canvas-wrapper and
  // never moves, so the overlays positioned against it (#perfMonitor,
  // #surfaceLockOverlay, #surfaceEntryHint) never move either — which is the
  // whole class of bug that block existed to keep re-solving.

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
  document.getElementById('projectorModeBtn')?.addEventListener('click', () => toggleProjectorMode());

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
    // Browser path: audio flows masterBus → ceiling → analyser → _muteGain → destination
    const mg = window._muteGain;
    if (mg) mg.gain.setTargetAtTime(target, t, 0.01);
    // Electron path: grains connect directly to speaker buses → ChannelMerger → audify.
    // _muteGain is not in that chain, so ramp each bus gain instead.
    // On unmute, restore to the current output gain level (not just 1).
    if (S.speakerBuses) {
      const busTarget = muted ? 0 : (S.outputGainValue ?? MASTER_DEFAULT_GAIN);
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

  // Expose slot-full check for inline indicator scripts (non-module context)
  window._loopSlotsFull = () =>
    S.seqOverflow === 'off' &&
    Array.from({ length: S.seqSlotCount }, (_, i) => S.seqSlots[i]).every(Boolean);



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
        if (S.samples.length >= MAX_SAMPLES) break;
        await loadAudioFile(file);
      }
    })();
  });
}
