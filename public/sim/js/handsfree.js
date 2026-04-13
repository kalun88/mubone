/**
 * handsfree.js — Handsfree buffer segmentation engine
 *
 * When armed + trace is toggled on (tap) + plain trace mode:
 * a noise gate with proper envelope (attack/hold/release) monitors mic input
 * and segments the audio into separate buffers — one per phrase.
 *
 * The gate does NOT independently start/stop trace. It runs WITHIN an active
 * toggle-trace session and segments the continuous input into discrete buffers.
 *
 * Features:
 *  - Gate envelope (attack / hold / release) with hysteresis
 *  - Output-referenced threshold (input must exceed output by configurable margin)
 *  - HPF sidechain (reject low-freq speaker bleed without altering recording)
 *  - Min/max buffer length enforcement
 *  - Feedback trend detection (rising RMS → auto-close)
 *  - HUD flash on buffer capture
 *
 * Integration:
 *  - Ticked from the meter loop (~30fps via tickMainMeters → tickHandsfree)
 *  - Uses startLiveRecording / stopLiveRecording from audio.js
 *  - Uses recordStrokeStart from ui-samples.js for particle painting
 *  - S._syncHandsfreeUI callback updates the UI
 */

import { S, LIVE_PAINT_COLORS } from './state.js';
import { ensureAudioContext, startLiveRecording, stopLiveRecording } from './audio.js';
import { recordStrokeStart } from './ui-samples.js';

// ── Constants ──────────────────────────────────────────────────────────────────
const TICK_INTERVAL_MS = 33;  // ~30fps — called from meter loop, not our own timer
const RMS_BUF_SIZE     = 256; // match inputAnalyser fftSize

// ── Module state ───────────────────────────────────────────────────────────────
let _inputRmsBuf  = null;    // Float32Array for input RMS calculation
let _outputRmsBuf = null;    // Float32Array for output RMS calculation

// Gate envelope state machine
let _gateLevel     = 0;      // 0 = closed, 1 = open (continuous)
let _holdTimer     = 0;      // ms remaining in hold phase
let _lastTickTime  = 0;      // performance.now() of last tick
let _bufferStartTime = 0;    // when current buffer capture started

// Feedback trend detection — sliding window of input RMS
// Window must be long enough that normal playback buildup doesn't trigger it.
// Only true feedback (runaway loop) should cross the slope threshold.
const _TREND_WINDOW  = 90;   // ~3s at 30fps — needs sustained rise, not just onset
const _TREND_SLOPE   = 0.35; // RMS rise per second — raised to avoid false positives on loud input
let _rmsHistory      = [];   // ring buffer of recent input RMS values
let _rmsHistoryIdx   = 0;

// HPF BiquadFilter node (created lazily, persists across arm/disarm)
let _hpfNode = null;
let _hpfAnalyser = null;     // AnalyserNode after HPF for sidechain RMS
let _hpfRmsBuf = null;

// UI sync throttle (~10fps for DOM updates)
let _lastUISyncTime = 0;
const UI_SYNC_INTERVAL = 100; // ms

// Debug throttle
let _dbgLastLog = 0;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Convert dB to linear gain */
function dbToLinear(db) { return Math.pow(10, db / 20); }

/** Compute RMS from an AnalyserNode's time-domain data */
function computeRMS(analyser, buf) {
  if (!analyser || !buf) return 0;
  analyser.getFloatTimeDomainData(buf);
  let sumSq = 0;
  for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
  return Math.sqrt(sumSq / buf.length);
}

// ── HPF Sidechain ──────────────────────────────────────────────────────────────
// The HPF is inserted as a parallel sidechain tap from inputGainNode.
// It does NOT affect the recording signal — only feeds _hpfAnalyser for gating.

function _ensureHPF() {
  if (_hpfNode && _hpfAnalyser) return;
  const ctx = S.audioCtx;
  if (!ctx || !S.inputGainNode) return;

  _hpfNode = ctx.createBiquadFilter();
  _hpfNode.type = 'highpass';
  _hpfNode.frequency.value = S.hfHpfFreq;
  _hpfNode.Q.value = 0.707; // Butterworth

  _hpfAnalyser = ctx.createAnalyser();
  _hpfAnalyser.fftSize = RMS_BUF_SIZE;
  _hpfAnalyser.smoothingTimeConstant = 0.6;

  _hpfRmsBuf = new Float32Array(RMS_BUF_SIZE);

  // Sidechain tap: inputGainNode → HPF → analyser (dead-end)
  S.inputGainNode.connect(_hpfNode);
  _hpfNode.connect(_hpfAnalyser);
}

function _teardownHPF() {
  if (_hpfNode) {
    try { S.inputGainNode?.disconnect(_hpfNode); } catch (_) {}
    try { _hpfNode.disconnect(); } catch (_) {}
    _hpfNode = null;
  }
  if (_hpfAnalyser) {
    try { _hpfAnalyser.disconnect(); } catch (_) {}
    _hpfAnalyser = null;
  }
  _hpfRmsBuf = null;
}

/** Update HPF frequency from state (called when slider changes) */
export function updateHPFFreq() {
  if (_hpfNode) _hpfNode.frequency.value = S.hfHpfFreq;
}

// ── Gate Tick (called every frame from meter loop) ─────────────────────────────

/**
 * Main tick — called ~30fps from tickMainMeters().
 * Only active when: hfArmed + _traceToggled + traceMode === 'trace'.
 * Runs the gate envelope and starts/stops buffer segments.
 */
export function tickHandsfree() {
  // Only run when all conditions are met:
  // armed + trace is toggled on + plain trace mode (no locked modes)
  if (!S.hfArmed || !S._traceToggled || S.traceMode !== 'trace') return;
  if (!S.inputAnalyser || !S.audioCtx) return;

  const now = performance.now();
  const dt  = _lastTickTime > 0 ? Math.min(now - _lastTickTime, 100) : TICK_INTERVAL_MS;
  _lastTickTime = now;

  // Lazily allocate RMS buffers
  if (!_inputRmsBuf)  _inputRmsBuf  = new Float32Array(RMS_BUF_SIZE);
  if (!_outputRmsBuf) _outputRmsBuf = new Float32Array(RMS_BUF_SIZE);

  // ── 1. Compute input RMS (sidechain: HPF if enabled, raw if not) ──────
  let inputRms;
  if (S.hfHpfEnabled) {
    _ensureHPF();
    inputRms = computeRMS(_hpfAnalyser, _hpfRmsBuf);
  } else {
    inputRms = computeRMS(S.inputAnalyser, _inputRmsBuf);
  }

  // ── 2. Compute output RMS for output-referenced threshold ─────────────
  const outputRms = computeRMS(S.masterAnalyser, _outputRmsBuf);

  // ── 3. Compute effective threshold ────────────────────────────────────
  const marginLinear = dbToLinear(S.hfMarginDb);
  const baseThreshold = S.vizNoiseFloor;
  const effectiveThreshold = Math.max(baseThreshold, outputRms * marginLinear);

  // ── 4. Gate detector: is input above threshold? ───────────────────────
  const inputAbove = inputRms > effectiveThreshold;

  // ── 5. Gate envelope (attack / hold / release) ────────────────────────
  const prevOpen = S.hfGateOpen;

  if (inputAbove) {
    _holdTimer = S.hfHoldMs;
    const attackRate = S.hfAttackMs > 0 ? dt / S.hfAttackMs : 1;
    _gateLevel = Math.min(1, _gateLevel + attackRate);
  } else {
    if (_holdTimer > 0) {
      _holdTimer -= dt;
    } else {
      const releaseRate = S.hfReleaseMs > 0 ? dt / S.hfReleaseMs : 1;
      _gateLevel = Math.max(0, _gateLevel - releaseRate);
    }
  }

  // Gate is "open" when level exceeds 0.5 (hysteresis midpoint)
  S.hfGateOpen = _gateLevel > 0.5;

  // ── 6. Feedback trend detection ───────────────────────────────────────
  let feedbackDetected = false;
  if (S.hfFeedbackDetect && S.hfRecording) {
    if (_rmsHistory.length < _TREND_WINDOW) {
      _rmsHistory.push(inputRms);
    } else {
      _rmsHistory[_rmsHistoryIdx % _TREND_WINDOW] = inputRms;
    }
    _rmsHistoryIdx++;

    if (_rmsHistory.length >= _TREND_WINDOW) {
      const half = Math.floor(_TREND_WINDOW / 2);
      let firstHalfAvg = 0, secondHalfAvg = 0;
      for (let i = 0; i < half; i++) {
        // Use ((x % n) + n) % n to guarantee non-negative modulo —
        // plain JS % returns negative for negative operands, which
        // caused overlapping sample windows and false feedback detection.
        const idx1 = ((_rmsHistoryIdx - _TREND_WINDOW + i) % _TREND_WINDOW + _TREND_WINDOW) % _TREND_WINDOW;
        const idx2 = ((_rmsHistoryIdx - half + i) % _TREND_WINDOW + _TREND_WINDOW) % _TREND_WINDOW;
        firstHalfAvg  += _rmsHistory[idx1];
        secondHalfAvg += _rmsHistory[idx2];
      }
      firstHalfAvg  /= half;
      secondHalfAvg /= half;

      const risePerSec = (secondHalfAvg - firstHalfAvg) / (_TREND_WINDOW * TICK_INTERVAL_MS / 1000);
      if (risePerSec > _TREND_SLOPE && secondHalfAvg > effectiveThreshold * 3) {
        feedbackDetected = true;
      }
    }
  }

  // ── 7. Max buffer length enforcement ──────────────────────────────────
  const bufferTooLong = S.hfRecording
    && (now - _bufferStartTime) > S.hfMaxBufferSec * 1000;

  // ── 8. State transitions: start / stop buffer segment ─────────────────

  // GATE OPENED → start a new buffer segment
  if (S.hfGateOpen && !prevOpen && !S.hfRecording) {
    _startSegment(now);
  }

  // If something external stopped recording, reset tracking
  if (S.hfRecording && !S.isRecording && !S.isPainting) {
    S.hfRecording = false;
  }

  // ── Debug: log why gate isn't re-opening (throttled ~1/s) ──────────
  if (!S.hfRecording && !S.hfGateOpen && inputRms > 0.001 && now - (_dbgLastLog || 0) > 1000) {
    _dbgLastLog = now;
    console.log(`hf: gate blocked? inputRms=${inputRms.toFixed(4)} thresh=${effectiveThreshold.toFixed(4)} outputRms=${outputRms.toFixed(4)} margin=${marginLinear.toFixed(2)} gateLevel=${_gateLevel.toFixed(3)} isPaint=${S.isPainting} isRec=${S.isRecording} hfRec=${S.hfRecording}`);
  }

  // GATE CLOSED (or forced close) → finalize buffer segment
  const forcedClose = feedbackDetected || bufferTooLong;
  const shouldClose = (!S.hfGateOpen && prevOpen) || forcedClose;
  if (shouldClose && S.hfRecording) {
    _stopSegment(now);
    // If this was a forced close (max length or feedback) and the gate is still
    // open (player is still playing), immediately start a new segment so there's
    // no gap in recording.  Without this, the gate waits for a close→open
    // transition that never comes while the player holds a continuous note.
    if (forcedClose && S.hfGateOpen) {
      _startSegment(now);
    }
  }

  // ── 9. Update UI state (throttled to ~10fps) ──────────────────────────
  if (now - _lastUISyncTime > UI_SYNC_INTERVAL) {
    _lastUISyncTime = now;
    S._syncHandsfreeUI?.();
  }
}

// ── Buffer segment lifecycle ──────────────────────────────────────────────────

function _startSegment(now) {
  // Don't start if something else owns recording
  if (S.isPainting || S.isRecording) return;

  ensureAudioContext();
  startLiveRecording();
  if (!S.isRecording) return; // guard: may bail (limit, no mic, etc.)

  recordStrokeStart('live', S.currentLiveBufferIdx);
  S.isPainting = true;
  S.paintFrameCount = 0;
  S.hfRecording = true;
  _bufferStartTime = now;

  // Reset feedback trend history for this segment
  _rmsHistory = [];
  _rmsHistoryIdx = 0;

  S.updateLiveRecUI?.();
}

function _stopSegment(now) {
  if (!S.hfRecording) return;

  const bufferDurationMs = now - _bufferStartTime;

  // Finalize stroke
  S.isPainting = false;
  S.currentStrokeId = -1;
  if (S.isRecording) stopLiveRecording();
  S.hfRecording = false;

  // Check minimum buffer length — reject gate chatter
  if (bufferDurationMs < S.hfMinBufferMs) {
    // Too short — discarded
  } else {
    // Valid capture
    S.hfCaptureCount++;
    S.hfCaptureFlashUntil = performance.now() + 400;
    S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
  }

  S.updateLiveRecUI?.();
}

// ── Arm / Disarm ───────────────────────────────────────────────────────────────

/** Arm handsfree mode. Sets up sidechain nodes. */
export function armHandsfree() {
  if (S.hfArmed) return;
  S.hfArmed = true;
  _gateLevel = 0;
  _holdTimer = 0;
  _lastTickTime = 0;
  _rmsHistory = [];
  _rmsHistoryIdx = 0;

  // Set up sidechain nodes
  if (S.hfHpfEnabled && S.audioCtx && S.inputGainNode) {
    _ensureHPF();
  }

  S._syncHandsfreeUI?.();
}

/** Disarm handsfree mode. Stops any in-progress segment and ends toggle-trace. */
export function disarmHandsfree() {
  if (!S.hfArmed) return;

  // If mid-segment, finalize it
  if (S.hfRecording) {
    _stopSegment(performance.now());
  }

  // If trace was toggled on, fully clean up (stops any continuous recording too)
  if (S._traceToggled) {
    S._stopToggleTrace?.();
  }

  S.hfArmed = false;
  S.hfGateOpen = false;
  _gateLevel = 0;
  _holdTimer = 0;

  // Teardown sidechain nodes to save CPU
  _teardownHPF();

  S._syncHandsfreeUI?.();
}

/** Toggle arm state */
export function toggleHandsfree() {
  if (S.hfArmed) disarmHandsfree();
  else           armHandsfree();
}
