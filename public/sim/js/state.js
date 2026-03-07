// ============================================================================
// state.js — Constants, presets, and shared mutable state
// Extracted from index.html monolith.
// ============================================================================

// ── Constants ────────────────────────────────────────────────────────────────

export const SPHERE_RADIUS       = 1200;
export const GRID_SEGMENTS_LON   = 36;  // every 10deg
export const GRID_SEGMENTS_LAT   = 18;  // every 10deg
export const AUTO_ROTATION_SPEED = 0.0001;
export const ROTATION_SPEED      = 0.06;
export const FOV_DEG             = 80;
export const PAINT_INTERVAL      = 3;
export const PARTICLE_BASE_SIZE  = 4;
export const PARTICLE_MAX_SIZE   = 20;
export const MAX_SAMPLES         = 10;

export const SEARCH_RADIUS_MIN  = 1;
export const SEARCH_RADIUS_MAX  = 180;
export const SEARCH_RADIUS_STEP = 2;

export const BG_COLOR   = '#1a2a2a';
export const GRID_COLOR = '#7abcbc';

// ── Hann window curves (precomputed Float32Arrays for setValueCurveAtTime) ──
// Web Audio requires at least 2 samples; we use 128 for smoothness.
// HANN_ATTACK : 0 -> 1 over the attack portion  (first half of Hann: cos rising)
// HANN_RELEASE: 1 -> 0 over the release portion (second half of Hann: cos falling)
export const HANN_LEN = 128;
export const HANN_ATTACK  = new Float32Array(HANN_LEN);
export const HANN_RELEASE = new Float32Array(HANN_LEN);
for (let i = 0; i < HANN_LEN; i++) {
  // Attack: 0.5*(1 - cos(pi * i/(N-1)))  -- rises from 0 to 1
  HANN_ATTACK[i]  = 0.5 * (1 - Math.cos(Math.PI * i / (HANN_LEN - 1)));
  // Release: 0.5*(1 + cos(pi * i/(N-1))) -- falls from 1 to 0
  HANN_RELEASE[i] = 0.5 * (1 + Math.cos(Math.PI * i / (HANN_LEN - 1)));
}

// Loaded-sample paint colours (cooler, more saturated)
export const SAMPLE_PAINT_COLORS = [
  '#ff6b6b', '#ffa06b', '#ffd06b',
  '#a0ff6b', '#6bffa0', '#6bffd0',
  '#6ba0ff', '#6b6bff', '#d06bff'
];

// Live-rec paint colours (warm amber/orange/gold family)
export const LIVE_PAINT_COLORS = [
  '#e8a030', '#e86030', '#e8c840',
  '#c87830', '#e07050', '#d4a060',
  '#c8603a', '#e8b050', '#d06838'
];

// Cloud drop system
export const MAX_CLOUDS = 8;
export const CLOUD_COLORS = [
  '#4fc3f7', '#81c784', '#ffb74d', '#e57373',
  '#ce93d8', '#fff176', '#80cbc4', '#ff8a65'
];
// Glow color for nearest-lock cursor grains -- distinct from particle and cloud colors
export const NEAREST_GLOW_COLOR = '#b8a0ff'; // soft violet

// Hard cap on concurrent AudioBufferSourceNodes
export const MAX_GRAIN_NODES = 250;

// Live rebuild throttle
export const LIVE_REBUILD_INTERVAL_MS = 200; // rebuild at most every 200ms

// ── Presets ───────────────────────────────────────────────────────────────────
// k    = neighbourhood pool size -- how many nearest particles are candidates.
//        One grain fires per cursor onset, chosen randomly from the k pool.
// period = seconds between cursor onsets (global clock, independent of duration).
//   period > duration -> silence gap between grains (sparse/pulsed feel)
//   period < duration -> grains overlap in time (dense/washy feel)
// retriggerMs = per-particle debounce for cloud mode only (not cursor).

export const PRESETS = [
  // -- 0. wash -- default: smooth granular freeze, live-monitor feel
  {
    name:          'wash',
    nearestMode:   false,
    searchRadiusDeg: 12,
    recencyN:      3,
    k:             10,
    duration:      0.38,   // 380ms -- long enough to overlap smoothly
    durJitter:     0.08,
    durVar:        0.04,
    period:        0.09,   // 90ms -> dense, very responsive to live input
    periodVar:     0.01,
    fade:          0.12,   // generous fade for smooth hann envelope
    retriggerMs:   55,
    startJitter:   0.05,
    sprayCount:    1,
    spraySpread:   0.04,
    pitchJitter:   0.01,   // low pitch jitter -> stays legible
    panSpread:     0.65,
    volume:        0.045,
    probability:   1.0,
    direction:     'fwd',
    curveType:     'hann',
  },
  // -- 1. vinyl -- lock+recency1: scrubbing a record, exact position tracking
  {
    name:          'vinyl',
    nearestMode:   true,
    searchRadiusDeg: 12,
    recencyN:      1,
    k:             1,
    duration:      0.14,   // 140ms -- tight grain
    durJitter:     0.04,
    durVar:        0.02,   // slight flutter +/-20ms
    period:        0.10,   // 100ms -> near-continuous
    periodVar:     0.01,
    fade:          0.03,
    retriggerMs:   80,
    startJitter:   0.01,
    sprayCount:    1,
    spraySpread:   0.01,
    pitchJitter:   0.015,
    panSpread:     0.2,
    volume:        0.07,
    probability:   1.0,
    direction:     'fwd',
    curveType:     'hann',
  },
  // -- 2. cloud -- wide radius, long overlapping grains, atmospheric wash
  {
    name:          'cloud',
    nearestMode:   false,
    searchRadiusDeg: 55,
    recencyN:      4,
    k:             8,
    duration:      0.85,   // 850ms -- very long, overlapping
    durJitter:     0.3,
    durVar:        0.12,
    period:        0.28,   // 280ms -> density
    periodVar:     0.04,
    fade:          0.24,
    retriggerMs:   400,
    startJitter:   0.28,
    sprayCount:    1,
    spraySpread:   0.18,
    pitchJitter:   0.02,
    panSpread:     1.0,
    volume:        0.025,
    probability:   0.9,
    direction:     'fwd',
    curveType:     'hann',
  },
  // -- 3. freeze -- lock+wide: drone, holds position in a wide halo
  {
    name:          'freeze',
    nearestMode:   true,
    searchRadiusDeg: 40,
    recencyN:      5,
    k:             10,
    duration:      2.0,    // 2s -- very long
    durJitter:     0.35,
    durVar:        0.25,
    period:        1.1,    // 1100ms
    periodVar:     0.08,
    fade:          0.5,
    retriggerMs:   900,
    startJitter:   0.01,
    sprayCount:    1,
    spraySpread:   0.06,
    pitchJitter:   0.004,
    panSpread:     0.85,
    volume:        0.012,
    probability:   1.0,
    direction:     'fwd',
    curveType:     'hann',
  },
  // -- 4. pulse -- rhythmic, medium grains with tight period, forward drive
  {
    name:          'pulse',
    nearestMode:   false,
    searchRadiusDeg: 18,
    recencyN:      2,
    k:             4,
    duration:      0.22,   // 220ms
    durJitter:     0.05,
    durVar:        0.03,
    period:        0.40,   // 400ms -> 2.5Hz beat
    periodVar:     0.02,
    fade:          0.05,
    retriggerMs:   100,
    startJitter:   0.04,
    sprayCount:    1,
    spraySpread:   0.04,
    pitchJitter:   0.0,
    panSpread:     0.4,
    volume:        0.08,
    probability:   1.0,
    direction:     'fwd',
    curveType:     'tri',
  },
  // -- 5. shimmer -- dense rapid onsets, heavy pitch scatter, stereo spread
  {
    name:          'shimmer',
    nearestMode:   false,
    searchRadiusDeg: 35,
    recencyN:      3,
    k:             8,
    duration:      0.42,   // 420ms
    durJitter:     0.18,
    durVar:        0.08,
    period:        0.055,  // 55ms -> rapid shimmer
    periodVar:     0.01,
    fade:          0.14,
    retriggerMs:   180,
    startJitter:   0.14,
    sprayCount:    2,
    spraySpread:   0.12,
    pitchJitter:   0.20,
    panSpread:     1.0,
    volume:        0.018,
    probability:   0.85,
    direction:     'fwd',
    curveType:     'hann',
  },
  // -- 6. ghost -- reverse, sparse, eerie smear from far-flung particles
  {
    name:          'ghost',
    nearestMode:   false,
    searchRadiusDeg: 70,
    recencyN:      6,
    k:             6,
    duration:      0.70,   // 700ms -- long reverse grains
    durJitter:     0.25,
    durVar:        0.15,
    period:        0.65,   // 650ms -> sparse
    periodVar:     0.10,
    fade:          0.22,
    retriggerMs:   350,
    startJitter:   0.35,
    sprayCount:    1,
    spraySpread:   0.20,
    pitchJitter:   0.06,
    panSpread:     0.9,
    volume:        0.030,
    probability:   0.6,
    direction:     'rev',
    curveType:     'hann',
  },
  // -- 7. glitch -- ultra-short random bursts, dropout probability, wide pitch
  {
    name:          'glitch',
    nearestMode:   false,
    searchRadiusDeg: 80,
    recencyN:      8,
    k:             12,
    duration:      0.018,  // 18ms -- micro grains
    durJitter:     0.5,
    durVar:        0.01,
    period:        0.04,   // 40ms
    periodVar:     0.03,
    fade:          0.004,
    retriggerMs:   20,
    startJitter:   0.9,
    sprayCount:    3,
    spraySpread:   0.35,
    pitchJitter:   0.45,
    panSpread:     1.0,
    volume:        0.18,
    probability:   0.55,
    direction:     'rnd',
    curveType:     'rect',
  },
  // -- 8. chop -- mechanical, short exact grains with long gap, no jitter
  {
    name:          'chop',
    nearestMode:   false,
    searchRadiusDeg: 15,
    recencyN:      2,
    k:             3,
    duration:      0.095,  // 95ms -- consistent short chop
    durJitter:     0.01,
    durVar:        0.0,
    period:        0.20,   // 200ms -> choppy rhythm
    periodVar:     0.0,
    fade:          0.008,
    retriggerMs:   60,
    startJitter:   0.02,
    sprayCount:    1,
    spraySpread:   0.01,
    pitchJitter:   0.0,
    panSpread:     0.5,
    volume:        0.10,
    probability:   1.0,
    direction:     'fwd',
    curveType:     'rect',
  },
  // -- 9. stutter -- CD-skip: lock, very fast repeat of nearly the same point
  {
    name:          'stutter',
    nearestMode:   true,
    searchRadiusDeg: 6,
    recencyN:      1,
    k:             2,
    duration:      0.065,  // 65ms
    durJitter:     0.02,
    durVar:        0.005,
    period:        0.060,  // 60ms -> rapid fire repeat
    periodVar:     0.005,
    fade:          0.01,
    retriggerMs:   40,
    startJitter:   0.005,
    sprayCount:    1,
    spraySpread:   0.005,
    pitchJitter:   0.01,
    panSpread:     0.15,
    volume:        0.09,
    probability:   1.0,
    direction:     'fwd',
    curveType:     'tri',
  },
  // -- 10. wobble -- warped tape: slow period with heavy dur+period variation
  {
    name:          'wobble',
    nearestMode:   false,
    searchRadiusDeg: 25,
    recencyN:      3,
    k:             5,
    duration:      0.48,   // 480ms -- medium grain
    durJitter:     0.12,
    durVar:        0.18,   // heavy variation = tape wobble
    period:        0.38,   // 380ms
    periodVar:     0.15,   // period drifts wildly
    fade:          0.12,
    retriggerMs:   150,
    startJitter:   0.08,
    sprayCount:    2,
    spraySpread:   0.08,
    pitchJitter:   0.08,
    panSpread:     0.65,
    volume:        0.045,
    probability:   0.88,
    direction:     'fwd',
    curveType:     'hann',
  },
];

// ── Sample-rate-derived grain parameter floors ───────────────────────────────
// Minimum grain duration = 5 samples; minimum inter-onset period = 2 samples.
// Getter functions read the live AudioContext sample rate (falls back to 22050
// before the context is created, e.g. during early UI initialisation).
export const minGrainDurS    = () => 5 / (S.audioCtx?.sampleRate ?? 22050);
export const minGrainPeriodS = () => 2 / (S.audioCtx?.sampleRate ?? 22050);

// ── Envelope curve builders ──────────────────────────────────────────────────

// Build envelope attack/release arrays for a given curve type and volume
export function buildEnvelopeCurves(curveType, volume) {
  const atk = new Float32Array(HANN_LEN);
  const rel = new Float32Array(HANN_LEN);
  for (let i = 0; i < HANN_LEN; i++) {
    const t = i / (HANN_LEN - 1); // 0->1
    let a, r;
    if (curveType === 'tri') {
      // Linear trapezoid (Henke Granulator III style): linear up then linear down
      a = t;
      r = 1 - t;
    } else if (curveType === 'rect') {
      // Rectangular: instant on, instant off (hard cut)
      a = i === 0 ? 0 : 1;
      r = i === HANN_LEN - 1 ? 0 : 1;
    } else {
      // Hann (default)
      a = HANN_ATTACK[i];
      r = HANN_RELEASE[i];
    }
    atk[i] = a * volume;
    rel[i] = r * volume;
  }
  return { atk, rel };
}

// Rebuild scaled Hann curves (called by rebuildGrainCurves, kept for compatibility)
export function rebuildHannCurves(volume) {
  for (let i = 0; i < HANN_LEN; i++) {
    S.GRAIN_ATTACK_CURVE[i]  = HANN_ATTACK[i]  * volume;
    S.GRAIN_RELEASE_CURVE[i] = HANN_RELEASE[i] * volume;
  }
}

// Rebuild global cached curves (called when curve type or volume changes)
export function rebuildGrainCurves() {
  const vol = S.grainOverrides.volume ?? S.grainParams.volume;
  const { atk, rel } = buildEnvelopeCurves(S.grainCurveType, vol);
  S.GRAIN_ATTACK_CURVE  = atk;
  S.GRAIN_RELEASE_CURVE = rel;
}

// Shorthand alias (used throughout playback code)
export const gp = () => S.grainParams;

// ── Performance monitor ──────────────────────────────────────────────────────

export const perf = {
  frameMs:        0,    // last frame duration ms
  frameMsMax:     0,    // rolling max (resets every 2s)
  frameMsMaxAt:   0,
  schedulerDrift: 0,    // how late scheduleGrains fired vs 30ms target
  schedulerMax:   0,
  schedulerMaxAt: 0,
  grainsFired:    0,    // grains fired in last scheduler tick
  activeNodes:    0,    // running AudioBufferSource count
  audioClockLast: 0,    // audioCtx.currentTime last check
  audioClockWall: 0,    // performance.now() at that check
  underruns:      0,    // times audio clock fell behind wall clock
  lastResetAt:    0,
};

export function perfTick() {
  // Reset rolling maxes every 2s
  const now = performance.now();
  if (now - perf.lastResetAt > 2000) {
    perf.frameMsMax     = perf.frameMs;
    perf.schedulerMax   = perf.schedulerDrift;
    perf.lastResetAt    = now;
  }
  perf.frameMsMax   = Math.max(perf.frameMsMax,   perf.frameMs);
  perf.schedulerMax = Math.max(perf.schedulerMax, perf.schedulerDrift);
  perf.activeNodes  = S._grainSourceCount;

  // Audio clock health -- skip first 3s while AudioContext warms up
  if (S.audioCtx && now > 3000) {
    const wallElapsed  = (now - perf.audioClockWall) / 1000;
    const audioElapsed = S.audioCtx.currentTime - perf.audioClockLast;
    if (perf.audioClockWall > 0 && wallElapsed > 0.2) {
      if (audioElapsed < wallElapsed * 0.70) perf.underruns++; // clock lagging >30%
      perf.audioClockLast = S.audioCtx.currentTime;
      perf.audioClockWall = now;
    } else if (perf.audioClockWall === 0) {
      perf.audioClockLast = S.audioCtx.currentTime;
      perf.audioClockWall = now;
    }
  }

  // -- Always-visible load indicator
  const loadEl = document.getElementById('loadIndicator');
  if (loadEl) {
    const frameBad = perf.frameMs > 25;        // >25ms = dropped frame
    const schedBad = perf.schedulerDrift > 20; // >20ms late on 30ms interval = likely glitch
    const nodesBad = perf.activeNodes > MAX_GRAIN_NODES * 0.75; // approaching cap
    if (frameBad || schedBad || nodesBad) {
      const reasons = [];
      if (nodesBad) reasons.push(`${perf.activeNodes} grains`);
      if (schedBad) reasons.push(`sched +${perf.schedulerDrift.toFixed(0)}ms`);
      if (frameBad) reasons.push(`frame ${perf.frameMs.toFixed(0)}ms`);
      loadEl.style.color = frameBad ? '#e06060' : '#e8a030';
      loadEl.textContent = `overload: ${reasons.join(', ')}`;
    } else {
      loadEl.style.color = '#555';
      loadEl.textContent = `${perf.activeNodes} grains`;
    }
  }

  if (!S.perfMonitorVisible) return;
  const el = document.getElementById('perfMonitor');
  if (!el) return;

  const frameColor    = perf.frameMs   > 20 ? '#e06060' : perf.frameMs   > 12 ? '#e8a030' : '#7abcbc';
  const schedColor    = perf.schedulerDrift > 20 ? '#e06060' : perf.schedulerDrift > 10 ? '#e8a030' : '#7abcbc';
  const underrunColor = perf.underruns > 0 ? '#e06060' : '#555';

  el.innerHTML =
    `<span style="color:#555">── perf monitor (P) ──</span>\n` +
    `frame  <span style="color:${frameColor}">${perf.frameMs.toFixed(1)}ms</span>  max <span style="color:#e8a030">${perf.frameMsMax.toFixed(1)}ms</span>\n` +
    `sched  <span style="color:${schedColor}">+${perf.schedulerDrift.toFixed(1)}ms</span> max <span style="color:#e8a030">+${perf.schedulerMax.toFixed(1)}ms</span>\n` +
    `grains <span style="color:#aaa">${perf.grainsFired} fired / ${perf.activeNodes} active</span>\n` +
    `underruns <span style="color:${underrunColor}">${perf.underruns}</span>`;
}

// ============================================================================
// MUTABLE STATE  (S object)
// ============================================================================
// All mutable `let` variables are properties on `S` so importers can reassign
// them (ES module bindings are read-only for re-exports of `let`).

export const S = {
  // ── Canvas / rendering ─────────────────────────────────────────────────
  canvas: undefined,
  ctx:    undefined,
  camQ:   [1, 0, 0, 0],       // camera orientation quaternion
  mouseX: 0,
  mouseY: 0,
  mousePixelX: 0,
  mousePixelY: 0,
  mouseInCanvas: false,
  altLocked:          false,  // true while Alt held -- sphere position frozen
  altFrozenMouseX:      0,    // mouse coords snapshotted at Alt press
  altFrozenMouseY:      0,
  altFrozenMousePixelX: 0,
  altFrozenMousePixelY: 0,

  // ── Mobile mode ────────────────────────────────────────────────────────
  isMobile: navigator.maxTouchPoints > 0 && window.innerWidth < 1024,
  orientationActive: false,
  searchRadiusDeg: 10,
  nearestMode: false,   // when true: ignore radius, always pick closest particle
  radiusTooltipUntil: 0, // performance.now() -- show transient radius label until this time

  // ── Painting ───────────────────────────────────────────────────────────
  isPainting: false,          // true while mouse-move painting is active
  paintFrameCount: 0,
  particles: [],              // all painted particles on the sphere

  // ── Stroke history (for undo) ──────────────────────────────────────────
  // Each entry: { strokeId, type: 'sample'|'live', liveBufferIndex (live only) }
  strokeHistory: [],
  strokeIdCounter: 0,
  currentStrokeId: -1,       // the stroke being painted right now

  // ── Recency filter ─────────────────────────────────────────────────────
  // Only granulate the N most recently recorded buffers present in radius.
  recencyN: 3,               // how many most-recent buffers to allow
  drawRecencyDial: null,     // set during setup -- module-level so MIDI CC can call it
  setRecency:      null,     // same
  setSearchK:      null,     // set during setup -- module-level so selectPreset can call it

  // ── Cloud drop system ──────────────────────────────────────────────────
  cloudSlots: new Array(MAX_CLOUDS).fill(null), // fixed positions

  // ── Loaded samples (1-9) ───────────────────────────────────────────────
  // activeSampleIndex: which slot is currently toggled ON for painting (-1 = none)
  activeSampleIndex: -1,
  sampleColorIndex:  0,       // cycles through SAMPLE_PAINT_COLORS
  // Each slot: { buffer, name, duration, grainCursor, cropStart, cropEnd }
  samples: [],

  // ── Live recording (spacebar) ──────────────────────────────────────────
  // Each entry: { buffer, grainCursor } -- grows without bound
  liveRecBuffers: [],
  liveColorIndex: 0,          // cycles through LIVE_PAINT_COLORS
  liveGranulatingThisFrame: false,  // true if any live particle is selected this frame

  // Current live recording working state
  isRecording:        false,
  recordingStream:    null,
  recordingNode:      null,
  recordingSourceNode: null,
  recordingRaw:       null,
  recordingWritePos:  0,
  recordingStartTime: 0,
  liveBufferSampleCount: 0,
  recordingSampleRate: 0,
  micPermissionGranted: false,
  currentLiveBufferIdx: -1,   // index into liveRecBuffers being recorded

  // ── Sensor calibration ─────────────────────────────────────────────────
  sensorCal: {
    axisMap: {
      x: { viz: 'x', sign:  1, mute: false },
      y: { viz: 'y', sign:  1, mute: false },
      z: { viz: 'z', sign:  1, mute: false },
    }
  },

  // ── Audio ──────────────────────────────────────────────────────────────
  audioCtx:   null,
  inputStream: null,   // shared MediaStream from mic (set by audio.js)
  masterBus:  null,
  masterAnalyser: null,
  inputGainNode:  null,   // pre-compressor gain for mic signal
  inputAnalyser:  null,   // AnalyserNode tapped after inputGain, before compressor
  inputGainValue: 1.0,    // 0.0 - 2.0, default unity

  // Grain tracking for waveform playhead
  activeGrains: [],

  // ── Performance monitor ────────────────────────────────────────────────
  perfMonitorVisible: false,
  _grainSourceCount: 0, // incremented on start, decremented on ended

  // ── Grain params / overrides ───────────────────────────────────────────
  grainParams: null,          // initialised below
  activePresetIndex: 0,
  grainOverrides: {
    duration:    null,
    durVar:      null,   // +/- seconds of duration randomisation per grain
    k:           null,
    period:      null,
    periodVar:   null,   // +/- seconds of period randomisation per onset
    pitchJitter: null,
    panSpread:   null,
    volume:      null,
  },
  grainProbability: 1.0,   // 0-1: probability each candidate grain fires per tick
  grainDirection:   'fwd', // 'fwd' | 'rev' | 'rnd'
  grainCurveType:   'hann', // 'hann' | 'tri' | 'rect'

  // Scaled Hann curves reused every grain -- rebuilt once on preset change.
  // Avoids allocating two Float32Array(128) per grain (thousands of GC objects/sec).
  GRAIN_ATTACK_CURVE:  new Float32Array(HANN_LEN),
  GRAIN_RELEASE_CURVE: new Float32Array(HANN_LEN),

  // ── Sample preview playback ────────────────────────────────────────────
  // { source, gain, startTimePerfNow, startSec, duration, slotIdx }
  samplePreviews: {},

  // Overlay canvases for loaded-sample waveform playheads
  waveformOverlays: [],

  // Drag-reorder state
  dragSrcIndex: -1,

  // ── Audio engine warm-up ───────────────────────────────────────────────
  audioEngineWarmedUp: false,

  // ── Live rebuild throttle ──────────────────────────────────────────────
  lastLiveRebuildTime: 0,

  // ── Output gain + mute ─────────────────────────────────────────────────
  outputGainValue: 0.9,  // linear gain (0–2), matches masterGain initial value
  isMuted:         false,

  // ── Mobile setup gate ──────────────────────────────────────────────────
  _mobileSetupDone: false, // true once orientation + gyro setup completes

  // ── Spatial mode ───────────────────────────────────────────────────────────
  // 'sim'      — simulation / headphones. Sensor ignored; mouse drives camera.
  //              Audio panned relative to current view direction (video-game style).
  //              Always stereo out.
  // 'physical' — real speaker setup. Sensor drives camera AND paint cursor.
  //              Audio VBAP uses world-space grain positions (speakers are fixed
  //              in the room — turning your body doesn't pan the sound).
  //              2 to N speakers.
  spatialMode: 'sim',   // 'sim' | 'physical'

  // ── Multi-channel audio routing ────────────────────────────────────────
  // channelRouting: null → identity (bus i → physical ch i).
  // When set, channelRouting[physicalCh] = speaker bus index (or -1 = mute).
  channelRouting: null,

  // speakerAnalysers: one AnalyserNode per speaker bus, populated by initSpeakerBuses.
  // Used by the audio settings modal output meter strip.
  speakerAnalysers: null,

  // ── Channel label overrides ───────────────────────────────────────────────
  // Short names shown on VU meter bars. null = auto-generate.
  inputChannelLabels:  null,   // string[] | null
  outputChannelLabels: null,   // string[] | null
};

// ── Initialise grainParams from first preset ─────────────────────────────────
S.grainParams = { ...PRESETS[0] };

// Init scaled Hann curves, then rebuild with correct curve type
rebuildHannCurves(S.grainParams.volume);
rebuildGrainCurves();
