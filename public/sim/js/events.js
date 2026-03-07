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
  toggleNearestMode, dropCloud, pickupNearestCloud,
  updatePlaybackControls, flashRadiusTooltip, selectPreset,
  drawPresetWaveform,
} from './ui-presets.js';
import { resizeCanvas, gainToFaderPos, faderPosToGain } from './renderer.js';
import { loadAudioFile } from './ui-samples.js';

// ── Helper: get lon/lat from mouse screen position ────────────────────────────
function getMouseLonLat() {
  return screenToLonLat(S.mousePixelX, S.mousePixelY);
}

// ── updateLiveRecUI re-export (used inline here) ──────────────────────────────
function _updateLiveRecUI() {
  S.updateLiveRecUI?.();
}

export function setupEvents() {
  // ── Mouse tracking on canvas ─────────────────────────────────────────────
  S.canvas.addEventListener('mousemove', e => {
    if (!S.altLocked) {
      const rect  = S.canvas.getBoundingClientRect();
      S.mouseX      = ((e.clientX - rect.left) / rect.width  - 0.5) * 2;
      S.mouseY      = ((e.clientY - rect.top)  / rect.height - 0.5) * 2;
      S.mousePixelX = (e.clientX - rect.left) * (S.canvas.width  / rect.width);
      S.mousePixelY = (e.clientY - rect.top)  * (S.canvas.height / rect.height);
      S.mouseInCanvas = true;
    }
  });
  S.canvas.addEventListener('mouseleave', () => { if (!S.altLocked) S.mouseInCanvas = false; });

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
      S.mouseX = ((t.clientX - rect.left) / rect.width  - 0.5) * 2;
      S.mouseY = ((t.clientY - rect.top)  / rect.height - 0.5) * 2;
    });
    S.canvas.addEventListener('touchend', e => { e.preventDefault(); S.mouseInCanvas = false; });
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────
  document.addEventListener('keydown', async e => {

    // Alt: freeze sphere at current position
    if (e.code === 'AltLeft' || e.code === 'AltRight') {
      e.preventDefault();
      if (!S.altLocked) {
        S.altLocked            = true;
        S.altFrozenMouseX      = S.mouseX;
        S.altFrozenMouseY      = S.mouseY;
        S.altFrozenMousePixelX = S.mousePixelX;
        S.altFrozenMousePixelY = S.mousePixelY;
        const wrapper = document.getElementById('canvasWrapper');
        if (wrapper) { wrapper.style.cursor = 'auto'; S.canvas.style.cursor = 'auto'; }
        const ind = document.getElementById('altLockIndicator');
        if (ind) ind.style.display = '';
      }
      return;
    }

    // Spacebar: live recording + painting
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      ensureAudioContext();
      const gotMic = S.micPermissionGranted ? true : await requestMicAccess();
      if (gotMic) startLiveRecording();
      recordStrokeStart('live', S.currentLiveBufferIdx);
      S.isPainting      = true;
      S.paintFrameCount = 0;
      _updateLiveRecUI();
    }

    // Number keys 1–9: momentary sample paint
    const num = parseInt(e.key);
    if (num >= 1 && num <= 9 && !e.repeat && !e.metaKey && !e.ctrlKey) {
      const idx = num - 1;
      if (idx < S.samples.length && S.samples[idx].buffer) {
        ensureAudioContext();
        S.activeSampleIndex = idx;
        recordStrokeStart('sample');
        S.isPainting      = true;
        S.paintFrameCount = 0;
        switchSvTab(idx);
        updateSampleListActiveState();
        updateSvTabStates();
        updateSamplePaintIndicator();
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

    // ArrowDown: drop cloud
    if (e.key === 'ArrowDown' && !e.repeat) {
      e.preventDefault();
      dropCloud();
    }

    // ArrowUp: pick up nearest cloud
    if (e.key === 'ArrowUp' && !e.repeat) {
      e.preventDefault();
      pickupNearestCloud();
    }

    // M: open/close MIDI / keyboard map
    if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey && !e.repeat) {
      e.preventDefault();
      const modal = document.getElementById('mappingModal');
      if (modal.classList.contains('open')) S.closeMappingModal?.();
      else S.openMappingModal?.();
    }
  });

  document.addEventListener('keyup', e => {
    // Alt release
    if (e.code === 'AltLeft' || e.code === 'AltRight') {
      S.altLocked = false;
      const wrapper = document.getElementById('canvasWrapper');
      if (wrapper) { wrapper.style.cursor = ''; S.canvas.style.cursor = ''; }
      const ind = document.getElementById('altLockIndicator');
      if (ind) ind.style.display = 'none';
      return;
    }

    // Spacebar release: stop recording, end live paint stroke
    if (e.code === 'Space') {
      e.preventDefault();
      S.isPainting      = false;
      S.currentStrokeId = -1;
      if (S.isRecording) stopLiveRecording();
      S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
      _updateLiveRecUI();
    }

    // Number key release: end sample paint stroke
    const num = parseInt(e.key);
    if (num >= 1 && num <= 9) {
      const idx = num - 1;
      if (S.activeSampleIndex === idx) {
        S.isPainting      = false;
        S.currentStrokeId = -1;
        S.activeSampleIndex = -1;
        updateSampleListActiveState();
        updateSamplePaintIndicator();
      }
    }
  });

  window.addEventListener('resize', () => { resizeCanvas(); drawPresetWaveform(); });

  // Scroll: radius | Shift+scroll: cycle presets
  S.canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (e.shiftKey) {
      const dir  = raw > 0 ? 1 : -1;
      const next = (S.activePresetIndex + dir + PRESETS.length) % PRESETS.length;
      selectPreset(next);
    } else {
      const delta = raw > 0 ? SEARCH_RADIUS_STEP : -SEARCH_RADIUS_STEP;
      S.searchRadiusDeg = Math.max(SEARCH_RADIUS_MIN, Math.min(SEARCH_RADIUS_MAX, S.searchRadiusDeg + delta));
      updatePlaybackControls();
      flashRadiusTooltip();
    }
  }, { passive: false });

  // Left click: live rec + paint
  S.canvas.addEventListener('mousedown', async e => {
    if (S.altLocked) return;
    if (e.button !== 0) return;
    e.preventDefault();
    ensureAudioContext();
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

  // ── Input gain fader ─────────────────────────────────────────────────────
  const faderCanvas = document.getElementById('inputFaderMeter');

  function setInputGain(linearVal) {
    S.inputGainValue = Math.max(0, Math.min(2, linearVal));
    if (S.inputGainNode) S.inputGainNode.gain.setTargetAtTime(S.inputGainValue, ensureAudioContext().currentTime, 0.01);
  }

  let faderDragStart = null;
  if (faderCanvas) {
    faderCanvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      faderCanvas.setPointerCapture(e.pointerId);
      const rect = faderCanvas.getBoundingClientRect();
      const PAD_T = 3, trackH = rect.height - PAD_T - 3;
      const clickPos = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top - PAD_T) / trackH));
      setInputGain(faderPosToGain(clickPos));
      faderDragStart = { startY: e.clientY, startPos: gainToFaderPos(S.inputGainValue), trackH };
    });
    faderCanvas.addEventListener('pointermove', e => {
      if (!faderDragStart) return;
      const dy    = faderDragStart.startY - e.clientY;
      const delta = dy / faderDragStart.trackH;
      setInputGain(faderPosToGain(Math.max(0, Math.min(1, faderDragStart.startPos + delta))));
    });
    faderCanvas.addEventListener('pointerup',     () => { faderDragStart = null; });
    faderCanvas.addEventListener('pointercancel', () => { faderDragStart = null; });
    faderCanvas.addEventListener('dblclick', () => setInputGain(1.0));
  }

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
    const mg = window._muteGain;
    if (mg) mg.gain.setTargetAtTime(
      S.isMuted ? 0 : 1,
      S.audioCtx.currentTime, 0.01
    );
    if (muteBtn) {
      muteBtn.classList.toggle('muted', S.isMuted);
      const span = muteBtn.querySelector('span:last-child');
      if (span) span.textContent = S.isMuted ? 'unmute' : 'mute';
    }
  }
  if (muteBtn) muteBtn.addEventListener('click', () => setMuted(!S.isMuted));

  // ── Output fader drag ─────────────────────────────────────────────────────
  const outputFaderCanvas = document.getElementById('outputFaderMeter');
  function setOutputGain(linearVal) {
    S.outputGainValue = Math.max(0, Math.min(2, linearVal));
    if (S.masterBus)
      S.masterBus.gain.setTargetAtTime(S.outputGainValue, S.audioCtx.currentTime, 0.01);
  }
  let outputFaderDrag = null;
  if (outputFaderCanvas) {
    outputFaderCanvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      outputFaderCanvas.setPointerCapture(e.pointerId);
      const rect = outputFaderCanvas.getBoundingClientRect();
      const PAD_T = 3, PAD_B = 3, trackH = rect.height - PAD_T - PAD_B;
      const clickPos = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top - PAD_T) / trackH));
      setOutputGain(faderPosToGain(clickPos));
      outputFaderDrag = { startY: e.clientY, startPos: gainToFaderPos(S.outputGainValue), trackH };
    });
    outputFaderCanvas.addEventListener('pointermove', e => {
      if (!outputFaderDrag) return;
      const dy    = outputFaderDrag.startY - e.clientY;
      const delta = dy / outputFaderDrag.trackH;
      setOutputGain(faderPosToGain(Math.max(0, Math.min(1, outputFaderDrag.startPos + delta))));
    });
    outputFaderCanvas.addEventListener('pointerup',     () => { outputFaderDrag = null; });
    outputFaderCanvas.addEventListener('pointercancel', () => { outputFaderDrag = null; });
    outputFaderCanvas.addEventListener('dblclick', () => setOutputGain(1.0));
  }
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
