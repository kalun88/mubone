// ============================================================================
// paint-ticker.js — Fixed-rate particle deposit clock
//
// Drops a particle at the current cursor position every N milliseconds while
// painting.  The interval is adjustable at runtime via S.paintTicker.intervalMs
// (editable from the perf-monitor dropdown or DevTools console).
//
// A single setInterval at 200Hz polls whether enough time has elapsed since
// the last deposit.  The high poll rate ensures deposit timing stays tight
// regardless of input source (IMU at 400Hz, mouse at 30fps, etc.).
//
// All camera modes (sensor, pull, surface) share one code path — the tick
// just reads the latest cursor position and deposits if the clock says go.
// ============================================================================

import { S, SAMPLE_PAINT_COLORS, LIVE_PAINT_COLORS, gp, minGrainDurS } from './state.js';
import { getCursorLonLat, screenToLonLat } from './sphere.js';
import { rand, stampCartesian } from './grain.js';
import { getRecordingDuration } from './audio.js';
import { snapshotInputFeatures, featuresFromBuffer } from './audio-features.js';

// ── Defaults ────────────────────────────────────────────────────────────────

const _DEF_INTERVAL_MS = 50;   // 20 Hz — deposit every 50ms while painting

// Poll rate — high enough for sub-ms jitter on the deposit clock.
const TICK_HZ = 200;
const TICK_MS = 1000 / TICK_HZ;

// ── State ───────────────────────────────────────────────────────────────────

let _lastDepositMs  = 0;
let _wasPainting    = false;
let _intervalId     = null;

// Gate lookback: when the noise gate transitions from closed → open,
// the plosive transient ("d", "t") is already over. We backdate the
// first particle's grainStart by the time since the last gate-closed
// tick, capped to GATE_LOOKBACK_S, to capture the attack.
const GATE_LOOKBACK_S = 0.050; // 50ms max lookback
let _gateWasOpen = false;      // was the gate open on the previous tick?
let _lastGateClosedRecTime = 0; // recording time of last gate-closed tick

// ── Read configured interval ────────────────────────────────────────────────

function _intervalMs() {
  return (S.paintTicker && S.paintTicker.intervalMs) ?? _DEF_INTERVAL_MS;
}

// ── Cursor position helper ──────────────────────────────────────────────────

function _cursorLonLat() {
  if (S.cursorQ) return getCursorLonLat();
  return screenToLonLat(
    S.altLocked ? S.altFrozenMousePixelX : S.mousePixelX,
    S.altLocked ? S.altFrozenMousePixelY : S.mousePixelY
  );
}

// ── Core deposit function ───────────────────────────────────────────────────
// Creates a particle at the current cursor position with audio feature snapshot.

function _depositParticle() {
  if (!S.isPainting) return false;

  const { lon, lat } = _cursorLonLat();
  const gpr = gp();
  const durVariation = rand(-gpr.durJitter * 0.5, gpr.durJitter * 0.5);

  let particle = null;

  if (S.isRecording && S.currentLiveBufferIdx >= 0) {
    const recTime = getRecordingDuration();
    // Centre grainStart in the deposit interval: the RMS snapshot reflects
    // audio from the last ~50ms, so place the marker in the middle of that
    // window rather than at the end.  This aligns particle size with the
    // actual waveform transient position.
    const centred = Math.max(0, recTime - _intervalMs() * 0.001);
    particle = {
      lon, lat,
      strokeId:       S.currentStrokeId,
      lastTriggeredAt: undefined,
      grainDuration:  Math.max(minGrainDurS(), gpr.duration + durVariation),
      source:         'live',
      liveBufferIdx:  S.currentLiveBufferIdx,
      grainStart:     centred,
      color:          LIVE_PAINT_COLORS[S.liveColorIndex % LIVE_PAINT_COLORS.length]
    };
    const feat = snapshotInputFeatures();
    if (feat) {
      if (S.vizNoiseFloor > 0 && feat.rms < S.vizNoiseFloor) {
        // Gate closed — remember this time for lookback
        _gateWasOpen = false;
        _lastGateClosedRecTime = recTime;
        particle = null;
      } else {
        particle.rms = feat.rms; particle.centroid = feat.centroid; particle.zcr = feat.zcr;
        // Gate lookback: on the closed→open transition, backdate grainStart
        // to capture the plosive transient that triggered the gate.
        if (!_gateWasOpen && _lastGateClosedRecTime > 0) {
          const lookback = Math.min(recTime - _lastGateClosedRecTime, GATE_LOOKBACK_S);
          particle.grainStart = Math.max(0, recTime - lookback);
        }
        _gateWasOpen = true;
      }
    }
  } else if (S.activeSampleIndex >= 0 && S.samples[S.activeSampleIndex] && S.samples[S.activeSampleIndex].buffer) {
    const s         = S.samples[S.activeSampleIndex];
    const cropStart = s.cropStart * s.duration;
    const cropEnd   = s.cropEnd   * s.duration;
    const cropLen   = cropEnd - cropStart;
    let rawStart    = s.grainCursor;
    if (cropLen > 0) rawStart = cropStart + ((rawStart - cropStart) % cropLen + cropLen) % cropLen;
    const clampedStart = Math.max(cropStart, Math.min(rawStart, cropEnd - 0.01));
    const grainDur     = Math.max(minGrainDurS(), Math.min(gpr.duration + durVariation, cropEnd - clampedStart));

    particle = {
      lon, lat,
      strokeId:       S.currentStrokeId,
      lastTriggeredAt: undefined,
      source:         'sample',
      sampleIndex:    S.activeSampleIndex,
      grainStart:     clampedStart,
      grainDuration:  grainDur,
      color:          SAMPLE_PAINT_COLORS[S.activeSampleIndex % SAMPLE_PAINT_COLORS.length]
    };
    const feat = featuresFromBuffer(s.buffer, clampedStart);
    if (feat) { particle.rms = feat.rms; particle.centroid = feat.centroid; particle.zcr = feat.zcr; }

    const stride = gpr.period * rand(0.8, 1.2);
    s.grainCursor += stride;
    if (s.grainCursor > cropEnd) s.grainCursor = cropStart + ((s.grainCursor - cropStart) % cropLen);
  }

  if (particle) {
    stampCartesian(particle);
    S.particles.push(particle);
    S._particleVersion++;
    return true;
  }
  return false;
}

// ── Tick ─────────────────────────────────────────────────────────────────────
// 200Hz poll — deposits when the fixed clock interval has elapsed.

function _tick() {
  if (!S.isPainting) {
    if (_wasPainting) {
      _wasPainting = false;
    }
    return;
  }

  const nowMs = performance.now();

  // Painting just started — deposit immediately
  if (!_wasPainting) {
    _wasPainting = true;
    _lastDepositMs = nowMs;
    _depositParticle();
    return;
  }

  // Fixed clock: deposit every intervalMs
  if (nowMs - _lastDepositMs >= _intervalMs()) {
    _depositParticle();
    _lastDepositMs = nowMs;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export function startPaintTicker() {
  if (_intervalId != null) return;
  _intervalId = setInterval(_tick, TICK_MS);
}

export function stopPaintTicker() {
  if (_intervalId != null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  _wasPainting = false;
}

export function getPaintTickerState() {
  return {
    intervalMs:        _intervalMs(),
    depositRateHz:     1000 / _intervalMs(),
    timeSinceDepositMs: performance.now() - _lastDepositMs,
    tickHz:            TICK_HZ,
    running:           _intervalId != null,
  };
}
