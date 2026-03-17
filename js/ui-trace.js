// ============================================================================
// UI — GESTURE TRACE SYSTEM
// Records cursor movement + grain parameters as a looping gesture trace.
// Traces fire grains along the recorded path, replaying the exact sonic
// behaviour of the original cursor movement.
// ============================================================================

import { S, MAX_TRACES, TRACE_COLORS } from './state.js';
import { screenToLonLat } from './sphere.js';

// ── Recording ────────────────────────────────────────────────────────────────

/** Capture a single frame of cursor position + all grain-relevant params. */
function captureFrame() {
  const now = performance.now();
  const t = now - S._traceRecordingStart;

  // Get cursor position (use alt-locked position if alt is held)
  const px = S.altLocked ? S.altFrozenMousePixelX : S.mousePixelX;
  const py = S.altLocked ? S.altFrozenMousePixelY : S.mousePixelY;
  const { lon, lat } = screenToLonLat(px, py);

  // Merge overrides into params for a complete snapshot
  const mergedParams = { ...S.grainParams };
  for (const [k, v] of Object.entries(S.grainOverrides)) {
    if (v !== null) mergedParams[k] = v;
  }

  return {
    t,
    lon, lat,
    grainParams:       { ...mergedParams },
    searchRadiusDeg:   S.searchRadiusDeg,
    nearestMode:       S.nearestMode,
    kAllMode:          S.grainKAllMode,
    kSeqMode:          S.grainKSeqMode,
    grainDirection:    S.grainDirection,
    grainCurveType:    S.grainCurveType,
    grainProbability:  S.grainProbability,
    radiusFadeEnabled: S.radiusFadeEnabled,
    radiusFadeCurve:   S.radiusFadeCurve,
  };
}

/** Start recording gesture frames. Call on painting start when trace mode is on. */
export function startTraceRecording() {
  S._traceRecordingFrames = [];
  S._traceRecordingStart = performance.now();
}

/** Capture a frame. Call each scheduler tick or paint frame while recording. */
export function tickTraceRecording() {
  if (!S._traceRecordingFrames) return;
  S._traceRecordingFrames.push(captureFrame());
}

/** Stop recording and drop the trace into an available slot. Returns slot index or -1. */
export function stopTraceRecording() {
  const frames = S._traceRecordingFrames;
  S._traceRecordingFrames = null;

  if (!frames || frames.length < 2) return -1; // too short

  const slotIndex = S.traceSlots.indexOf(null);
  if (slotIndex === -1) return -1; // all slots full

  const duration = frames[frames.length - 1].t; // ms
  if (duration < 50) return -1; // shorter than 50ms — accidental tap

  S.traceSlots[slotIndex] = {
    slotIndex,
    frames,
    duration,
    loopMode: 'pingpong',  // default
    playing: true,
    color: TRACE_COLORS[slotIndex],

    // Runtime playback state
    _playheadMs:    0,
    _pingForward:   true,
    _nextOnsetT:    0,     // set on first scheduler tick
    _seqPool:       null,
    _seqIdx:        0,
    _crx: 0, _cry: 0, _crz: 0,
    _angBufPartVer: -1,
  };

  rebuildTraceUI();
  return slotIndex;
}

// ── Playback helpers ─────────────────────────────────────────────────────────

/**
 * Interpolate trace frames at a given playhead time (ms).
 * Returns the blended frame data for the grain scheduler to use.
 */
export function interpolateTrace(trace) {
  const { frames, duration, loopMode, _playheadMs } = trace;

  // Compute effective time accounting for loop mode
  let effectiveT;
  if (loopMode === 'pingpong') {
    // Ping-pong: 0→duration→0→duration...
    const cycle = duration * 2;
    const pos = _playheadMs % cycle;
    effectiveT = pos <= duration ? pos : cycle - pos;
  } else {
    // Forward: 0→duration→0→duration...
    effectiveT = _playheadMs % duration;
  }

  // Binary search for the two bounding frames
  let lo = 0, hi = frames.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= effectiveT) lo = mid;
    else hi = mid;
  }

  const a = frames[lo];
  const b = frames[hi];

  // Edge case: exact match or single frame
  if (lo === hi || a.t === b.t) return a;

  // Linear interpolation factor
  const frac = (effectiveT - a.t) / (b.t - a.t);

  return {
    lon:               a.lon + (b.lon - a.lon) * frac,
    lat:               a.lat + (b.lat - a.lat) * frac,
    grainParams:       frac < 0.5 ? a.grainParams : b.grainParams, // snap, don't lerp objects
    searchRadiusDeg:   a.searchRadiusDeg + (b.searchRadiusDeg - a.searchRadiusDeg) * frac,
    nearestMode:       frac < 0.5 ? a.nearestMode : b.nearestMode,
    kAllMode:          frac < 0.5 ? a.kAllMode : b.kAllMode,
    kSeqMode:          frac < 0.5 ? a.kSeqMode : b.kSeqMode,
    grainDirection:    frac < 0.5 ? a.grainDirection : b.grainDirection,
    grainCurveType:    frac < 0.5 ? a.grainCurveType : b.grainCurveType,
    grainProbability:  a.grainProbability + (b.grainProbability - a.grainProbability) * frac,
    radiusFadeEnabled: frac < 0.5 ? a.radiusFadeEnabled : b.radiusFadeEnabled,
    radiusFadeCurve:   a.radiusFadeCurve + (b.radiusFadeCurve - a.radiusFadeCurve) * frac,
  };
}

/**
 * Advance a trace's playhead by deltaMs.
 * Called each scheduler tick for playing traces.
 */
export function advanceTrace(trace, deltaMs) {
  trace._playheadMs += deltaMs;
}

// ── Slot management ──────────────────────────────────────────────────────────

export function pauseTrace(slotIndex) {
  const trace = S.traceSlots[slotIndex];
  if (trace) { trace.playing = false; }
  rebuildTraceUI();
}

export function resumeTrace(slotIndex) {
  const trace = S.traceSlots[slotIndex];
  if (trace) { trace.playing = true; trace._nextOnsetT = 0; }
  rebuildTraceUI();
}

export function removeTrace(slotIndex) {
  S.traceSlots[slotIndex] = null;
  rebuildTraceUI();
}

export function clearAllTraces() {
  S.traceSlots.fill(null);
  rebuildTraceUI();
}

export function toggleTraceLoopMode(slotIndex) {
  const trace = S.traceSlots[slotIndex];
  if (!trace) return;
  trace.loopMode = trace.loopMode === 'pingpong' ? 'forward' : 'pingpong';
  rebuildTraceUI();
}

// ── UI ───────────────────────────────────────────────────────────────────────

const _traceBtn     = () => document.getElementById('traceModeBtn');
const _tracePanel   = () => document.getElementById('tracePanel');
const _traceSlotsCt = () => document.getElementById('traceSlots');

export function initTraceUI() {
  const btn = _traceBtn();
  if (!btn) return;

  btn.addEventListener('click', () => {
    S.traceModeEnabled = !S.traceModeEnabled;
    // Disable seq mode if enabling trace mode (mutually exclusive cursor modes)
    if (S.traceModeEnabled) S.seqModeEnabled = false;
    updateTraceModeBtn();
  });

  document.getElementById('traceClearBtn')?.addEventListener('click', clearAllTraces);

  rebuildTraceUI();
}

function updateTraceModeBtn() {
  const btn = _traceBtn();
  if (!btn) return;
  const on = S.traceModeEnabled;
  btn.classList.toggle('trace-active', on);
  btn.textContent = on ? '● gesture trace' : '○ gesture trace';
}

export function rebuildTraceUI() {
  const container = _traceSlotsCt();
  if (!container) return;

  container.innerHTML = '';
  const hasAny = S.traceSlots.some(t => t !== null);

  if (!hasAny) {
    container.innerHTML = '<div class="trace-empty">no traces — record with <kbd>G</kbd> mode + paint</div>';
    return;
  }

  S.traceSlots.forEach((trace, i) => {
    if (!trace) return;
    const el = document.createElement('div');
    el.className = 'trace-slot';
    el.style.borderLeftColor = trace.color;

    const dur = (trace.duration / 1000).toFixed(1);
    const frames = trace.frames.length;
    const mode = trace.loopMode === 'pingpong' ? '⇄' : '→';
    const state = trace.playing ? '▶' : '⏸';

    el.innerHTML = `
      <span class="trace-slot-info">
        <span class="trace-slot-state" style="color:${trace.color}">${state}</span>
        <span class="trace-slot-dur">${dur}s</span>
        <span class="trace-slot-frames">${frames}f</span>
      </span>
      <span class="trace-slot-btns">
        <button class="trace-btn trace-btn--mode" data-slot="${i}" title="loop mode: ${trace.loopMode}">${mode}</button>
        <button class="trace-btn trace-btn--playpause" data-slot="${i}" title="${trace.playing ? 'pause' : 'resume'}">${trace.playing ? '⏸' : '▶'}</button>
        <button class="trace-btn trace-btn--remove" data-slot="${i}" title="remove">✕</button>
      </span>
    `;
    container.appendChild(el);
  });

  // Wire buttons
  container.querySelectorAll('.trace-btn--mode').forEach(b =>
    b.addEventListener('click', () => toggleTraceLoopMode(+b.dataset.slot)));
  container.querySelectorAll('.trace-btn--playpause').forEach(b =>
    b.addEventListener('click', () => {
      const idx = +b.dataset.slot;
      S.traceSlots[idx]?.playing ? pauseTrace(idx) : resumeTrace(idx);
    }));
  container.querySelectorAll('.trace-btn--remove').forEach(b =>
    b.addEventListener('click', () => removeTrace(+b.dataset.slot)));
}
