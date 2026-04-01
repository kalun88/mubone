// ============================================================================
// state.js — Constants, presets, and shared mutable state
// Extracted from index.html monolith.
// ============================================================================

// ── Debug ────────────────────────────────────────────────────────────────────
// Set to true (or add ?debug to the URL) to enable verbose console logging.
export const DEBUG = new URLSearchParams(window.location.search).has('debug');

// ── Experimental mode ────────────────────────────────────────────────────────
// Add ?exp to the URL to enable experimental modules (gesture engine,
// processing chain, etc.).  Off by default — collaborators on the published
// build never see these features until they graduate to main.
export const EXP = new URLSearchParams(window.location.search).has('exp');

// ── Constants ────────────────────────────────────────────────────────────────

export const SPHERE_RADIUS       = 1200;
export const GRID_SEGMENTS_LON   = 18;  // every 20deg (halved for perf)
export const GRID_SEGMENTS_LAT   = 9;   // every 20deg (halved for perf)
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

export const BG_COLOR_DARK  = '#000000';
export const BG_COLOR_LIGHT = '#ffffff';
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
  '#6ba0ff', '#6b6bff', '#d06bff',
  '#ff6bcc'
];

// Live-rec paint colours (warm amber/orange/gold family)
export const LIVE_PAINT_COLORS = [
  '#e8a030', '#e86030', '#e8c840',
  '#c87830', '#e07050', '#d4a060',
  '#c8603a', '#e8b050', '#d06838'
];

// Commit system — unified pool for clouds (particle-based) and loops (buffer-based).
// MAX_COMMITS is the hard upper bound (array size).
// S.commitSlotCount (1–16) is the active limit per session.
export const MAX_COMMITS = 16;
// Legacy aliases — kept so existing code compiles during transition
export const MAX_SEEDS = MAX_COMMITS;
export const MAX_SEQS  = MAX_COMMITS;
export const COMMIT_COLORS = [
  '#4fc3f7', '#81c784', '#ffb74d', '#e57373',
  '#ce93d8', '#fff176', '#80cbc4', '#ff8a65',
  '#ff6b9d', '#c084fc', '#67e8f9', '#fbbf24',
  '#a3e635', '#f472b6', '#38bdf8', '#fb923c'
];
// Legacy aliases
export const SEED_COLORS = COMMIT_COLORS;
export const SEQ_COLORS  = COMMIT_COLORS;
// Commit draw threshold (ms) — hold D longer than this to record a moving cloud / new loop.
// Shorter is treated as a stationary drop.
export const COMMIT_DRAW_THRESHOLD_MS = 200;
export const MOVING_SEED_THRESHOLD_MS = COMMIT_DRAW_THRESHOLD_MS; // legacy alias
// Glow color for nearest-lock cursor grains -- distinct from particle and seed colors
export const NEAREST_GLOW_COLOR = '#b8a0ff'; // soft violet

// ── Performance tuning ────────────────────────────────────────────────────────
// These were set conservatively during early CPU-load testing. Adjust here if
// you want to change system-wide behaviour without hunting through call sites.

// Hard cap on concurrent AudioBufferSourceNodes. Each live grain holds 3–5 nodes.
// Hard ceiling on simultaneous AudioBufferSourceNodes.
//
// Why 200: each live source has 2–3 Web Audio nodes attached (source + gain,
// optional panner/elev).  Chrome's audio thread becomes unstable above ~400–600
// active nodes and will crash the tab.  200 sources × 2–3 nodes = 400–600
// total — right at the safe ceiling.
//
// At sub-ms grain periods (audio-rate granulation) with duration riding up,
// steady-state concurrency = ceil(duration / period).  Without this cap, at
// period=0.1ms and duration=200ms that reaches 2000 concurrent sources and
// 4000 nodes → reliable tab crash.  With 200 the scheduler throttles gracefully:
// new grains are only scheduled as old ones expire, keeping node count stable.
//
// For all normal-use presets (period ≥ 30ms, duration ≤ 480ms) the steady-state
// concurrent count stays ≤ 16 — this cap is never the binding constraint.
// Lowered from 200 → 150: at extreme combos (2ms period × 4s duration) Chrome's
// audio renderer processes all concurrent nodes per render quantum (2.9ms).
// 150 concurrent chains + deferred disconnect batching keeps the audio thread
// within budget.  Normal presets use < 20 nodes so this cap has zero effect.
export const MAX_GRAIN_NODES = 150;

// Grain scheduler tick rate in ms. 30ms ≈ 33 ticks/sec.
// Grains are 25ms–2000ms so 30ms resolution is inaudible.
// 20ms tick = 50 ticks/sec; with 40ms lookahead, grains overlap 2× (no gaps).
// Was 10ms but the seed scheduling loop is O(seeds×particles) per tick —
// at 16 seeds × 500 particles that's 800k+ ops/sec, starving the render loop.
// 20ms halves the scheduler CPU while keeping onset precision well under
// the 5ms audio-rate threshold.
export const GRAIN_SCHEDULER_INTERVAL_MS = 20;

// Minimum period for onset-clock advancement and the UI slider floor.
// The scheduler can smoothly deliver grains down to
// GRAIN_SCHEDULER_INTERVAL_MS / MAX_GRAINS_PER_TICK ≈ 0.83ms.
// 10ms = 100 grains/sec max.  Raised from 2ms to prevent Chrome renderer
// crashes at extreme period+duration combos (error code 5).
export const SCHED_SAFE_PERIOD_S = 0.010; // 10 ms

// Render loop frame rate cap. The animate() loop throttles canvas redraws to
// this rate while requestAnimationFrame still runs at full display rate (handling
// painting and camera). Lower this (e.g. 20) to cut canvas draw cost on dense scenes.
export const RENDER_TARGET_FPS = 30;

// Live rebuild throttle
export const LIVE_REBUILD_INTERVAL_MS = 200; // rebuild at most every 200ms

// Recording memory guard — warn performer when total recorded audio approaches
// this ceiling.  At 48kHz mono, each minute ≈ 11.5MB of Float32 data.
// 600s (10 min) ≈ 115MB — conservative for student laptops with 8GB RAM.
// Mutable at runtime via audio settings slider (stored on S.recLimitSeconds).
export const REC_LIMIT_SECONDS_DEFAULT = 600;

// ── Presets ───────────────────────────────────────────────────────────────────
// k    = neighbourhood pool size -- how many nearest particles are candidates.
//        One grain fires per cursor onset, chosen randomly from the k pool.
// period = seconds between cursor onsets (global clock, independent of duration).
//   period > duration -> silence gap between grains (sparse/pulsed feel)
//   period < duration -> grains overlap in time (dense/washy feel)
// retriggerMs = per-particle debounce for seeder mode only (not cursor).

export const PRESETS = [

  // ═══════════════════════════════════════════════════════════════════════════
  // FACTORY PRESETS 0–19 — core sonic palette
  // Sparse: only character-defining grain params. Unset params pass through.
  // panSpread kept tight (≤0.20) for VBAP precision unless spread IS the sound.
  // All searchRadiusDeg ≤ 90.
  // ═══════════════════════════════════════════════════════════════════════════

  // -- 0. wash -- smooth granular freeze, live-monitor feel
  //    Overlap ~9.7 (589ms/61ms) — dense cloud, full-sphere k=99.
  {
    name:          'wash',
    nearestMode:   false,
    grainKAllMode: false,
    grainKSeqMode: false,
    searchRadiusDeg: 10,
    k:             99,
    duration:      0.589,
    durJitter:     0,
    durVar:        0.04,
    fadeRatio:     0.50,
    period:        0.061,
    periodVar:     0.025,
    pitchShift:    0,
    pitchJitter:   0.012,
    recencyN:      0,
    probability:   1.0,
    panSpread:     0.05,
    volume:        0.85,
    direction:     'fwd',
    curveType:     'hann',
    seqOverflow:   'oldest',
  },

  // -- 1. vinyl -- lock+recency1: scrubbing a record, exact position tracking
  {
    name:          'vinyl',
    nearestMode:   true,
    searchRadiusDeg: 12,
    recencyN:      1,
    k:             1,
    duration:      0.14,
    durJitter:     0.04,
    durVar:        0.02,
    period:        0.10,
    periodVar:     0.01,
    fadeRatio:     0.21,
    pitchJitter:   0.015,
    panSpread:     0.10,
    volume:        0.85,
  },

  // -- 2. cloud -- wide radius, long overlapping grains, atmospheric wash
  //    panSpread 0.55 — spread is character-defining here.
  {
    name:          'cloud',
    searchRadiusDeg: 55,
    recencyN:      4,
    k:             8,
    duration:      0.85,
    durJitter:     0.3,
    durVar:        0.12,
    period:        0.28,
    periodVar:     0.04,
    fadeRatio:     0.28,
    pitchJitter:   0.02,
    panSpread:     0.55,
    volume:        0.55,
    probability:   0.9,
  },

  // -- 3. freeze -- lock+wide: drone, holds position in a wide halo
  {
    name:          'freeze',
    nearestMode:   true,
    searchRadiusDeg: 40,
    recencyN:      5,
    k:             10,
    duration:      2.0,
    durJitter:     0.35,
    durVar:        0.25,
    period:        1.1,
    periodVar:     0.08,
    fadeRatio:     0.25,
    panSpread:     0.20,
    volume:        0.70,
  },

  // -- 4. pulse -- rhythmic, medium grains with tight period, forward drive
  {
    name:          'pulse',
    searchRadiusDeg: 18,
    k:             4,
    duration:      0.22,
    durJitter:     0.05,
    durVar:        0.03,
    period:        0.40,
    periodVar:     0.02,
    fadeRatio:     0.23,
    panSpread:     0.12,
    volume:        1.0,
    curveType:     'tri',
  },

  // -- 5. shimmer -- dense rapid onsets, pitch scatter
  //    ~5 concurrent grains (350ms/70ms) — tuned for Chrome audio budget.
  //    panSpread 0.45 — shimmer spread is part of the character.
  {
    name:          'shimmer',
    searchRadiusDeg: 35,
    k:             6,
    duration:      0.35,
    durJitter:     0.18,
    durVar:        0.06,
    period:        0.070,
    periodVar:     0.015,
    fadeRatio:     0.30,
    pitchJitter:   0.025,
    panSpread:     0.45,
    volume:        0.38,
    probability:   0.85,
  },

  // -- 6. ghost -- reverse, sparse, eerie smear from far-flung particles
  //    panSpread 0.35 — eerie spatial drift is part of the character.
  {
    name:          'ghost',
    searchRadiusDeg: 70,
    recencyN:      6,
    k:             6,
    duration:      0.70,
    durJitter:     0.25,
    durVar:        0.15,
    period:        0.65,
    periodVar:     0.10,
    fadeRatio:     0.31,
    pitchJitter:   0.06,
    panSpread:     0.35,
    volume:        0.85,
    probability:   0.6,
    direction:     'rev',
  },

  // -- 7. glitch -- ultra-short random bursts, dropout probability, wide pitch
  {
    name:          'glitch',
    searchRadiusDeg: 80,
    recencyN:      8,
    k:             12,
    duration:      0.018,
    durJitter:     0.5,
    durVar:        0.01,
    period:        0.04,
    periodVar:     0.03,
    fadeRatio:     0.22,
    pitchJitter:   0.45,
    panSpread:     0.18,
    volume:        1.0,
    probability:   0.55,
    direction:     'rnd',
    curveType:     'rect',
  },

  // -- 8. chop -- mechanical, short exact grains with long gap, no jitter
  //    Defining: zero jitter everywhere, rect envelope.
  {
    name:          'chop',
    searchRadiusDeg: 15,
    k:             3,
    duration:      0.095,
    period:        0.20,
    fadeRatio:     0.08,
    panSpread:     0.12,
    volume:        1.0,
    curveType:     'rect',
  },

  // -- 9. ocean -- massive ambient wash, very long grains, slow onset
  //    Everything bleeds together into an enveloping drone.
  //    panSpread 0.50 — ambient spread is character-defining.
  //    Radius capped at 85 (was 120).
  {
    name:          'ocean',
    searchRadiusDeg: 85,
    recencyN:      8,
    k:             10,
    duration:      3.2,
    durJitter:     0.4,
    durVar:        0.45,
    period:        1.0,
    periodVar:     0.20,
    fadeRatio:     0.40,
    panSpread:     0.50,
    volume:        0.38,
    probability:   0.75,
  },

  // -- 10. stutter -- CD-skip: lock, very fast repeat of nearly the same point
  {
    name:          'stutter',
    nearestMode:   true,
    searchRadiusDeg: 6,
    recencyN:      1,
    k:             2,
    duration:      0.065,
    durJitter:     0.02,
    period:        0.060,
    periodVar:     0.005,
    fadeRatio:     0.15,
    panSpread:     0.08,
    volume:        0.90,
    curveType:     'tri',
  },

  // -- 11. tape -- k-seq: walks through particles in recording order
  //    Like playing back a worn cassette, slightly detuned and drifting.
  {
    name:          'tape',
    grainKSeqMode: true,
    searchRadiusDeg: 30,
    recencyN:      5,
    k:             4,
    duration:      0.32,
    durJitter:     0.10,
    durVar:        0.12,
    period:        0.28,
    periodVar:     0.08,
    fadeRatio:     0.28,
    pitchJitter:   0.04,
    panSpread:     0.15,
    volume:        0.70,
    probability:   0.92,
  },

  // -- 12. swarm -- k-all + wide radius: every particle within earshot fires
  //    Dense insect texture that thickens as you paint more.
  {
    name:          'swarm',
    grainKAllMode: true,
    searchRadiusDeg: 45,
    k:             20,
    duration:      0.055,
    durJitter:     0.3,
    durVar:        0.02,
    period:        0.035,
    periodVar:     0.015,
    fadeRatio:     0.18,
    pitchJitter:   0.12,
    panSpread:     0.20,
    volume:        0.30,
    probability:   0.7,
    direction:     'rnd',
    curveType:     'rect',
  },

  // -- 13. haunt -- reverse + sparse + pitched down an octave
  //    Long ghostly swells, suboctave spectral bass presence.
  {
    name:          'haunt',
    searchRadiusDeg: 90,
    recencyN:      6,
    k:             5,
    duration:      1.4,
    durJitter:     0.3,
    durVar:        0.25,
    period:        1.2,
    periodVar:     0.30,
    fadeRatio:     0.35,
    pitchJitter:   0.03,
    pitchShift:    -12,
    panSpread:     0.20,
    volume:        0.75,
    probability:   0.5,
    direction:     'rev',
  },

  // -- 14. morse -- k-seq + lock: sequential walk, telegraph precision
  //    Short rect grains with silence between — sonar ping.
  {
    name:          'morse',
    nearestMode:   true,
    grainKSeqMode: true,
    searchRadiusDeg: 20,
    k:             6,
    duration:      0.045,
    period:        0.18,
    fadeRatio:     0.05,
    panSpread:     0.10,
    volume:        1.0,
    curveType:     'rect',
  },

  // -- 15. smear -- ultra-long grains, high overlap, pitched up a fifth (+7)
  //    Everything blurs into shimmering harmonic sustain.
  //    ~4.3 concurrent grains (2.6s/0.60s).
  {
    name:          'smear',
    searchRadiusDeg: 50,
    recencyN:      4,
    k:             7,
    duration:      2.6,
    durJitter:     0.30,
    durVar:        0.25,
    period:        0.60,
    periodVar:     0.10,
    fadeRatio:     0.40,
    pitchJitter:   0.015,
    pitchShift:    7,
    panSpread:     0.20,
    volume:        0.42,
    probability:   0.85,
  },

  // -- 16. drill -- audio-rate grains: period at 3ms pushes into pitched
  //    buzzing territory. The grain stream becomes a tone.
  {
    name:          'drill',
    searchRadiusDeg: 8,
    k:             3,
    duration:      0.004,
    period:        0.003,
    fadeRatio:     0.10,
    panSpread:     0.05,
    volume:        0.65,
    curveType:     'rect',
  },

  // -- 17. scatter -- k-seq + reverse + high probability dropout
  //    Walks recording order backwards with random silences.
  //    panSpread 0.35 — scattered spatial fragments.
  {
    name:          'scatter',
    grainKSeqMode: true,
    searchRadiusDeg: 60,
    recencyN:      5,
    k:             8,
    duration:      0.25,
    durJitter:     0.20,
    durVar:        0.10,
    period:        0.32,
    periodVar:     0.12,
    fadeRatio:     0.20,
    pitchJitter:   0.18,
    panSpread:     0.35,
    volume:        0.80,
    probability:   0.45,
    direction:     'rev',
    curveType:     'tri',
  },

  // -- 18. wobble -- warped tape: heavy dur+period variation
  //    Unstable playback speed, like dying batteries.
  {
    name:          'wobble',
    searchRadiusDeg: 25,
    k:             5,
    duration:      0.48,
    durJitter:     0.12,
    durVar:        0.18,
    period:        0.38,
    periodVar:     0.15,
    fadeRatio:     0.25,
    pitchJitter:   0.08,
    panSpread:     0.15,
    volume:        0.80,
    probability:   0.88,
  },

  // -- 19. ritual -- slow, deep, deliberate. Pitched down a fourth (-5).
  //    k-all so when grains fire, the whole radius speaks like a choir.
  {
    name:          'ritual',
    grainKAllMode: true,
    searchRadiusDeg: 35,
    recencyN:      6,
    k:             20,
    duration:      1.8,
    durJitter:     0.25,
    durVar:        0.20,
    period:        2.2,
    periodVar:     0.40,
    fadeRatio:     0.38,
    pitchShift:    -5,
    panSpread:     0.18,
    volume:        0.60,
    probability:   0.4,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RADIAL MORPH PRESETS 20–25 — designed for gyro joystick morphing
  // Pin these 6 on the radial joystick for full-spectrum gesture control.
  // Each is an extreme pole; inverse-distance blending between any pair
  // sweeps through musically meaningful intermediate territory.
  // ═══════════════════════════════════════════════════════════════════════════

  // -- 20. shimmer-high -- ENERGY pole
  //    Bright, dense, fast, pitched up an octave. Maximum liveliness.
  //    Morph toward this = excite, accelerate, brighten.
  {
    name:          'shimmer-high',
    searchRadiusDeg: 30,
    k:             6,
    duration:      0.25,
    durJitter:     0.15,
    durVar:        0.05,
    period:        0.065,
    periodVar:     0.012,
    fadeRatio:     0.30,
    pitchJitter:   0.03,
    pitchShift:    12,
    panSpread:     0.15,
    volume:        0.35,
    probability:   0.90,
  },

  // -- 21. deep-drone -- CALM pole
  //    Long, slow, pitched down an octave, smooth. Maximum stillness.
  //    Morph toward this = settle, deepen, sustain.
  {
    name:          'deep-drone',
    searchRadiusDeg: 45,
    recencyN:      5,
    k:             8,
    duration:      2.5,
    durJitter:     0.20,
    durVar:        0.30,
    period:        1.4,
    periodVar:     0.15,
    fadeRatio:     0.38,
    pitchShift:    -12,
    panSpread:     0.12,
    volume:        0.65,
  },

  // -- 22. glitch-burst -- CHAOS pole
  //    Micro grains, random direction, wide pitch scatter, dropout.
  //    Morph toward this = fragment, scatter, destabilize.
  {
    name:          'glitch-burst',
    searchRadiusDeg: 75,
    recencyN:      8,
    k:             10,
    duration:      0.020,
    durJitter:     0.45,
    durVar:        0.01,
    period:        0.045,
    periodVar:     0.025,
    fadeRatio:     0.15,
    pitchJitter:   0.40,
    panSpread:     0.18,
    volume:        0.90,
    probability:   0.50,
    direction:     'rnd',
    curveType:     'rect',
  },

  // -- 23. crystal-seq -- ORDER pole
  //    K-seq, clean, precise, no jitter. Maximum clarity and sequence.
  //    Morph toward this = focus, clarify, articulate.
  {
    name:          'crystal-seq',
    grainKSeqMode: true,
    searchRadiusDeg: 20,
    k:             5,
    duration:      0.18,
    period:        0.15,
    fadeRatio:     0.22,
    panSpread:     0.08,
    volume:        0.85,
    curveType:     'tri',
  },

  // -- 24. swarm-buzz -- DENSITY pole
  //    K-all, short grains, many particles buzzing. Maximum saturation.
  //    Morph toward this = thicken, swarm, saturate.
  {
    name:          'swarm-buzz',
    grainKAllMode: true,
    searchRadiusDeg: 40,
    k:             20,
    duration:      0.040,
    durJitter:     0.25,
    period:        0.030,
    periodVar:     0.010,
    fadeRatio:     0.15,
    pitchJitter:   0.10,
    panSpread:     0.15,
    volume:        0.28,
    probability:   0.75,
    curveType:     'rect',
  },

  // -- 25. ghost-breath -- SPACE pole
  //    Reverse, sparse, wide radius, low probability. Maximum openness.
  //    Morph toward this = dissolve, haunt, open.
  {
    name:          'ghost-breath',
    searchRadiusDeg: 85,
    recencyN:      7,
    k:             5,
    duration:      1.0,
    durJitter:     0.30,
    durVar:        0.20,
    period:        0.90,
    periodVar:     0.20,
    fadeRatio:     0.35,
    pitchJitter:   0.04,
    pitchShift:    -5,
    panSpread:     0.18,
    volume:        0.70,
    probability:   0.45,
    direction:     'rev',
  },

];

// ── User-defined preset slots (indices 0–19) ────────────────────────────────
// 20 user slots are prepended to factory presets.  On startup they hold
// neutral wash-like defaults; loadUserPresets() overwrites them from localStorage
// so any saves from a previous session survive a page reload.
// Positions 0–19 = user (keyboard 1–0, shift+1–0), positions 20+ = factory.
export const USER_PRESET_START = 0;
export const FACTORY_PRESET_START = 20;
// User slots start empty (sparse) — no parameter values by default.
// When selected, an empty slot changes nothing (all params pass through).
// Users populate slots via the save button or the patch table editor.
const _userDefault = n => ({
  name:           `user ${n}`,
  userDefined:    true,
});
// Insert 20 user slots at the front (indices 0–19), shifting factory to 20+
for (let n = 20; n >= 1; n--) PRESETS.unshift(_userDefault(n));

// Meta keys that every preset has (not parameter data).
const _PRESET_META_KEYS = new Set(['name', 'userDefined']);

// Load saved user presets from localStorage and overwrite the 20 slots in-place.
// Call this before building the preset buttons so the UI reflects saved names.
// Strips any stale keys that aren't in PARAM_REGISTRY (e.g. durJitter,
// retriggerMs from old saves) so they can't silently trigger parameter
// application in selectPreset.
export function loadUserPresets() {
  try {
    const raw = localStorage.getItem('mubone_user_presets');
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return;

    // Build the set of valid keys lazily (PARAM_REGISTRY may not exist yet
    // at import time, so we defer to first call).
    if (!_validParamKeys) _buildValidParamKeys();

    let cleaned = false;
    saved.forEach((p, n) => {
      const idx = USER_PRESET_START + n;
      if (idx < FACTORY_PRESET_START && p && typeof p === 'object') {
        // Strip unknown keys — prevents old saves from hiding data that
        // selectPreset would silently apply (e.g. durJitter, retriggerMs).
        for (const k of Object.keys(p)) {
          if (!_PRESET_META_KEYS.has(k) && !_validParamKeys.has(k)) {
            delete p[k];
            cleaned = true;
          }
        }
        PRESETS[idx] = { ...PRESETS[idx], ...p, userDefined: true };
      }
    });
    if (cleaned) {
      console.info('[presets] stripped stale keys from user presets — re-saving');
      saveUserPresets();
    }
  } catch (e) {
    console.warn('[presets] could not load user presets from localStorage:', e);
  }
}

// Valid parameter keys — populated lazily from PARAM_REGISTRY on first use.
let _validParamKeys = null;
/** @param {Array} [registry] — pass PARAM_REGISTRY from ui-patch-table */
export function _buildValidParamKeys(registry) {
  if (registry) {
    _validParamKeys = new Set(registry.map(p => p.key));
  } else {
    // Fallback: build from known keys until PARAM_REGISTRY is available.
    // Must stay in sync with PARAM_REGISTRY in ui-patch-table.js.
    _validParamKeys = new Set([
      'duration', 'durVar', 'fadeRatio', 'period', 'periodVar',
      'pitchJitter', 'pitchShift', 'panSpread', 'volume', 'k',
      'probability', 'direction', 'curveType',
      'nearestMode', 'grainKAllMode', 'grainKSeqMode',
      'searchRadiusDeg', 'recencyN',
      'radiusFadeEnabled', 'radiusFadeCurve',
      'scanMuted', 'axisLockAz', 'axisLockEl',
      'seqSlotCount', 'seqOverflow', 'seqModeEnabled',
      'seqNextVolume', 'seqNextSpeed', 'seqNextDirection',
      'seedSlotCount', 'seedOverflow', 'seedLockEnabled',
      'seedMode', 'seedTether', 'seedXfade',
      'seedAttack', 'seedRelease', 'seedLoopMode',
    ]);
  }
}

/** Check whether a preset has any actual parameter data (beyond name/meta). */
export function presetHasParams(preset) {
  if (!preset || typeof preset !== 'object') return false;
  for (const k of Object.keys(preset)) {
    if (!_PRESET_META_KEYS.has(k)) return true;
  }
  return false;
}

// Persist the 20 user slots to localStorage.
export function saveUserPresets() {
  try {
    localStorage.setItem(
      'mubone_user_presets',
      JSON.stringify(PRESETS.slice(USER_PRESET_START, FACTORY_PRESET_START))
    );
  } catch (e) {
    console.warn('[presets] could not save user presets to localStorage:', e);
  }
}

// ── Sample-rate-derived grain parameter floors ───────────────────────────────
// Minimum grain duration = 2 samples; minimum inter-onset period = 2 samples.
// Getter functions read the live AudioContext sample rate (falls back to 48000
// before the context is created, e.g. during early UI initialisation).
export const minGrainDurS    = () => 2 / (S.audioCtx?.sampleRate ?? 48000);
export const minGrainPeriodS = () => 2 / (S.audioCtx?.sampleRate ?? 48000);

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
  schedulerDrift: 0,    // how late scheduleGrains fired vs GRAIN_SCHEDULER_INTERVAL_MS target
  schedulerMax:   0,
  schedulerMaxAt: 0,
  grainsFired:    0,    // grains fired in last scheduler tick
  activeNodes:    0,    // running AudioBufferSource count
  grainsPerSec:   0,    // rolling 1s grain rate
  _grainAccum:    0,    // accumulator fed by scheduleGrains
  _grainRateTs:   0,    // wall time of last rate computation
  _pmLastUpdate:  0,    // wall time of last perf monitor DOM update
  audioClockLast: 0,    // audioCtx.currentTime last check
  audioClockWall: 0,    // performance.now() at that check
  underruns:      0,    // times audio clock fell behind wall clock
  kCount:         0,    // actual particles selected per grain tick (live k count)
  kPool:          0,    // total candidates available before k cap
  frameSkips:     0,    // frames skipped to give scheduler headroom
  lastResetAt:    0,
  recTotalSec:    0,    // total seconds of audio in liveRecBuffers (updated by updateLiveRecUI)
  recWarning:     false,// true when approaching REC_LIMIT_SECONDS
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

  // -- Always-visible load indicator + node bar
  const loadEl  = document.getElementById('loadIndicator');
  const barEl   = document.getElementById('vmNodeBar');
  const frameTarget = 1000 / RENDER_TARGET_FPS;
  const frameBad = perf.frameMs > frameTarget * 1.25;
  const hwBufMs  = (S.audioCtx?.baseLatency ?? 0) * 1000;
  const schedBad = perf.schedulerDrift > GRAIN_SCHEDULER_INTERVAL_MS * 0.60 + hwBufMs * 0.90;
  const nodesBad = perf.activeNodes > MAX_GRAIN_NODES * 0.90;

  if (barEl) {
    const pct = Math.min(100, (perf.activeNodes / MAX_GRAIN_NODES) * 100);
    barEl.style.width = `${pct}%`;
    barEl.style.backgroundColor = pct > 85 ? '#e06060' : pct > 55 ? '#e8a030' : '#7abcbc';
  }

  if (loadEl) {
    if (frameBad || schedBad || nodesBad) {
      const reasons = [];
      if (nodesBad) reasons.push(`${perf.activeNodes} nodes`);
      if (schedBad) reasons.push(`sched +${perf.schedulerDrift.toFixed(0)}ms`);
      if (frameBad) reasons.push(`frame ${perf.frameMs.toFixed(0)}ms`);
      loadEl.style.color = frameBad ? '#e06060' : '#e8a030';
      loadEl.textContent = reasons.join(' · ');
    } else {
      loadEl.style.color = '';
      loadEl.textContent = '';
    }
  }

  // Rolling grain rate: accumulate in _grainAccum (fed by scheduleGrains) and
  // compute grains/sec once per second to avoid per-frame division noise.
  if (perf._grainRateTs === 0) perf._grainRateTs = now;
  const rateElapsed = now - perf._grainRateTs;
  if (rateElapsed >= 1000) {
    perf.grainsPerSec = Math.round(perf._grainAccum * 1000 / rateElapsed);
    perf._grainAccum  = 0;
    perf._grainRateTs = now;
  }

  // Always update particle world count + dynamic k max
  const pCount = S.particles.length;
  const kwcEl = document.getElementById('kWorldCount');
  if (kwcEl) {
    const txt = pCount > 0 ? `[${pCount}]` : '';
    if (kwcEl.textContent !== txt) kwcEl.textContent = txt;
  }
  // Dynamic k slider max = particle count, floor 30 so k can be set before painting
  const kSliderEl = document.getElementById('searchKSlider');
  if (kSliderEl) {
    const newMax = String(Math.max(30, pCount));
    if (kSliderEl.max !== newMax) kSliderEl.max = newMax;
  }

  if (!S.perfMonitorVisible) return;

  // Throttle DOM writes to 4Hz — readable without churning layout.
  if (now - perf._pmLastUpdate < 250) return;
  perf._pmLastUpdate = now;

  function setBar(barId, valId, pct, valStr, warnPct, critPct) {
    const bar = document.getElementById(barId);
    const val = document.getElementById(valId);
    if (bar) {
      bar.style.width = `${Math.min(100, pct)}%`;
      bar.style.backgroundColor = pct > critPct ? '#e06060' : pct > warnPct ? '#e8a030' : '#7abcbc';
    }
    if (val) {
      val.textContent = valStr;
      val.style.color = pct > critPct ? '#e06060' : pct > warnPct ? '#e8a030' : '#7abcbc';
    }
  }

  const hwBufMsDisp = (S.audioCtx?.baseLatency ?? 0) * 1000;
  const schedMax    = GRAIN_SCHEDULER_INTERVAL_MS * 2 + hwBufMsDisp;

  // nodes: 0–200, warn at 55%, crit at 85%
  setBar('pmNodesBar', 'pmNodesVal',
    (perf.activeNodes / MAX_GRAIN_NODES) * 100,
    `${perf.activeNodes} / ${MAX_GRAIN_NODES}`,
    55, 85);

  // frame: 60fps = 16.7ms baseline. Bar spans 16–50ms (0% = 16ms, 100% = 50ms).
  // Warn at 33ms (dropping to ~30fps), crit at 50ms (~20fps).
  const frameBaseline = 1000 / 60;
  const frameCap      = 50;
  setBar('pmFrameBar', 'pmFrameVal',
    Math.max(0, (perf.frameMs - frameBaseline) / (frameCap - frameBaseline)) * 100,
    `${perf.frameMs.toFixed(1)}ms`,
    (33 - frameBaseline) / (frameCap - frameBaseline) * 100,
    (50 - frameBaseline) / (frameCap - frameBaseline) * 100);

  // sched drift: cap bar at 2× interval, warn at 60%, crit at 90%
  setBar('pmSchedBar', 'pmSchedVal',
    (perf.schedulerDrift / Math.max(schedMax, 1)) * 100,
    `+${perf.schedulerDrift.toFixed(1)}ms`,
    60, 90);

  // grains/sec: cap bar at 200/s, always teal (informational)
  setBar('pmRateBar', 'pmRateVal',
    (perf.grainsPerSec / 200) * 100,
    `${perf.grainsPerSec}/s`,
    101, 101);  // never warn

  // k display — visual grammar: / = k cap, () = radius pool, [] = world
  //   nearest:    "3 / 10 [42]"          X / k [world]
  //   area+k:     "3 / 10 (12) [42]"     X / k (inRadius) [world]
  //   area+all:   "12 all [42]"           X all [world]  (k bypassed, radius=X)
  //   idle:       "— [42]"
  const kSetting = S.grainOverrides.k ?? gp().k;
  const worldCount = S.particles.length;
  let kLabel, kPct;
  if (perf.kPool > 0) {
    const effectiveAll = S.grainKAllMode && !S.nearestMode;
    if (effectiveAll) {
      kLabel = `${perf.kCount} all [${worldCount}]`;
      kPct = Math.min(100, perf.kCount * 2);
    } else if (S.nearestMode) {
      kLabel = `${perf.kCount} / ${kSetting} [${worldCount}]`;
      kPct = (perf.kCount / Math.max(kSetting, 1)) * 100;
    } else {
      // area + k cap
      kLabel = `${perf.kCount} / ${kSetting} (${perf.kPool}) [${worldCount}]`;
      kPct = (perf.kCount / Math.max(kSetting, 1)) * 100;
    }
  } else {
    kLabel = worldCount > 0 ? `— [${worldCount}]` : '—';
    kPct = 0;
  }
  setBar('pmKBar', 'pmKVal', kPct, kLabel, 101, 101);

  // rec: recorded audio duration vs S.recLimitSeconds. Warn 80%, crit 95%.
  const recSec = perf.recTotalSec;
  const recLim = S.recLimitSeconds;
  const recPct = (recSec / recLim) * 100;
  const recMins = Math.floor(recSec / 60);
  const recSecs = Math.floor(recSec % 60);
  const limMins = Math.floor(recLim / 60);
  const recLabel = recMins > 0
    ? `${recMins}m${recSecs < 10 ? '0' : ''}${recSecs}s / ${limMins}m`
    : `${recSecs}s / ${limMins}m`;
  setBar('pmRecBar', 'pmRecVal', recPct, recLabel, 80, 95);

  const infoEl = document.getElementById('pmInfo');
  if (infoEl) {
    const srHz = S.audioCtx?.sampleRate;
    const srStr = srHz ? `${(srHz / 1000).toFixed(1)}kHz` : '—';
    const blMs  = S.audioCtx?.baseLatency != null
      ? `${(S.audioCtx.baseLatency * 1000).toFixed(1)}ms` : '—';
    infoEl.textContent = `${srStr}  ·  buf ${blMs}`;
  }

  const warnEl = document.getElementById('pmUnderruns');
  if (warnEl) {
    const parts = [];
    if (perf.underruns > 0)  parts.push(`⚠ ${perf.underruns} underrun${perf.underruns > 1 ? 's' : ''}`);
    if (perf.frameSkips > 0) parts.push(`⏭ ${perf.frameSkips} skip${perf.frameSkips > 1 ? 's' : ''}`);
    warnEl.textContent   = parts.join('  ');
    warnEl.style.display = parts.length > 0 ? 'block' : 'none';
  }
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
  camQ:   [0, 0, 0, 1],       // camera orientation quaternion [x, y, z, w]
  cursorQ: null,               // [x,y,z,w] | null — separate cursor quat when detethered (two-IMU mode)
  get detethered() { return this.cursorQ !== null; },  // true when cursor is independent of camera
  mouseX: 0,
  mouseY: 0,
  mousePixelX: 0,
  mousePixelY: 0,
  mouseInCanvas: false,
  altLocked:          false,  // true while Alt held -- sphere position frozen
  axisLock:           'off',  // legacy compat — derived from axisLockAz/El
  axisLockAz:         false,  // independent azimuth lock toggle
  axisLockEl:         false,  // independent elevation lock toggle
  _axisLockFrozenNx:  null,   // snapshot of surface nx when az locked
  _axisLockFrozenNy:  null,   // snapshot of surface ny when el locked
  _axisLockFrozenYaw:   null, // snapshot of sensor yaw when az locked
  _axisLockFrozenPitch: null, // snapshot of sensor pitch when el locked
  altFrozenMousePixelX: 0,
  altFrozenMousePixelY: 0,

  // ── Mobile mode ────────────────────────────────────────────────────────
  isMobile: navigator.maxTouchPoints > 0 && window.innerWidth < 1024,
  orientationActive: false,
  searchRadiusDeg: 10,
  nearestMode: false,   // when true: ignore radius, always pick closest particle
  grainKAllMode: false, // when true: k limit is removed — all particles within radius fire
  grainKSeqMode: false, // when true: step through candidates sequentially by grainStart order
  radiusTooltipUntil: 0, // performance.now() -- show transient radius label until this time

  // ── Painting ───────────────────────────────────────────────────────────
  isPainting: false,          // true while mouse-move painting is active
  paintFrameCount: 0,
  particles: [],              // all painted particles on the sphere
  _particleVersion: 0,        // incremented on every push/remove; grain.js uses this to invalidate angular-distance caches

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

  // ── Commit system (unified clouds + loops) ─────────────────────────────
  // Each slot is either a cloud (particle-based granular) or a loop (buffer-based).
  // type: 'cloud' | 'loop' stored on each slot object.
  commitSlots: new Array(MAX_COMMITS).fill(null),
  commitSlotCount:    8,        // active limit (1–16), adjustable during session
  commitOverflow:     'off',    // 'off' | 'oldest' | 'nearest'
  traceMode:          'trace',  // 'trace' | 'trace+loop' | 'trace+cloud' — what spacebar/click does
  commitMode:         'cloud',  // 'cloud' | 'loop' — what the next C press creates
  selectionMode:      'closest', // 'closest' | 'farthest' — which commit is targeted for morph & release
  // Legacy aliases for code that still references old names
  get seedSlots()       { return this.commitSlots; },
  set seedSlots(v)      { this.commitSlots = v; },
  get seedSlotCount()   { return this.commitSlotCount; },
  set seedSlotCount(v)  { this.commitSlotCount = v; },
  get seedOverflow()    { return this.commitOverflow; },
  set seedOverflow(v)   { this.commitOverflow = v; },
  // Legacy: commitLockEnabled maps to traceMode !== 'trace'
  get commitLockEnabled()  { return this.traceMode !== 'trace'; },
  set commitLockEnabled(v) { this.traceMode = v ? 'trace+cloud' : 'trace'; },
  get seedLockEnabled()    { return this.commitLockEnabled; },
  set seedLockEnabled(v)   { this.commitLockEnabled = v; },
  get seqSlots()        { return this.commitSlots; },
  set seqSlots(v)       { this.commitSlots = v; },
  get seqSlotCount()    { return this.commitSlotCount; },
  set seqSlotCount(v)   { this.commitSlotCount = v; },
  get seqOverflow()     { return this.commitOverflow; },
  set seqOverflow(v)    { this.commitOverflow = v; },
  get seqModeEnabled()  { return this.commitMode === 'loop'; },
  set seqModeEnabled(v) { this.commitMode = v ? 'loop' : 'cloud'; },

  // ── Loaded samples (1-9) ───────────────────────────────────────────────
  // activeSampleIndex: which slot is currently toggled ON for painting (-1 = none)
  activeSampleIndex: -1,
  sampleColorIndex:  0,       // cycles through SAMPLE_PAINT_COLORS
  // Each slot: { buffer, name, duration, grainCursor, cropStart, cropEnd }
  samples: [],

  // ── Live recording (spacebar) ──────────────────────────────────────────
  recLimitSeconds: REC_LIMIT_SECONDS_DEFAULT, // adjustable via audio settings
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
      x: { viz: 'roll',  sign: -1, mute: false },
      y: { viz: 'pitch', sign:  1, mute: false },
      z: { viz: 'yaw',   sign: -1, mute: false },
    }
  },

  sensor2Cal: {
    axisMap: {
      x: { viz: 'roll',  sign: -1, mute: false },
      y: { viz: 'pitch', sign:  1, mute: false },
      z: { viz: 'yaw',   sign: -1, mute: false },
    }
  },

  // /space/wand — wand controller (viz-invisible, forwarded to Max)
  wandCal: {
    axisMap: {
      x: { viz: 'roll',  sign:  1, mute: false },
      y: { viz: 'pitch', sign: -1, mute: false },
      z: { viz: 'yaw',   sign: -1, mute: false },
    }
  },

  // ── Particle visualisation (audio-feature-driven) ────────────────────
  // When true, particle color/size derived from audio features baked at
  // paint time.  When false, original palette-based colouring is used.
  darkMode:      true,      // true = black bg (dark mode), false = white bg (light mode)
  vizMinSize:    6,         // particle min radius (px) — quiet floor, overrides PARTICLE_BASE_SIZE
  vizMaxSize:    120,       // particle max radius (px) — loud ceiling, overrides PARTICLE_MAX_SIZE
  // Calibration ranges — raw feature values outside these clip to 0 or 1.
  // Users adjust via the viz panel sliders to match their input level / content.
  vizNoiseFloor: 0.002,     // RMS below this → particle not created (noise gate)
  vizRmsMin:     0.005,     // quiet floor (below this → smallest particle)
  vizRmsMax:     0.31,      // loud ceiling (above this → largest particle)
  vizCentroidMin: 0.04,     // lowest expected centroid (deepest bass content)
  vizCentroidMax: 0.45,     // highest expected centroid (bright/hissy content)
  modeRingSize:  30,        // mode ring radius (px) — controls how big the 4 status arcs are
  uiScale:       1.0,       // UI scale factor — multiplied with base font-size (15px)
  hudScale:      1.0,       // canvas HUD scale — multiplies edge bar height, text size, dot size, spacing
  edgeIndicator:     'on',  // 'on' | 'off' — show off-screen cursor arrow when detethered
  edgeIndicatorSize: 1.0,   // 0.5–2.0 — scale of the edge arrow
  fovDeg:        80,        // field of view (degrees) — match to projector throw for room-anchored use
  driftOffsetQ:  null,      // persistent [x,y,z,w] correction quaternion applied on recenter

  // ── Handsfree recording ────────────────────────────────────────────────
  // Pedal-armed auto-record: noise gate segments buffers within toggle-trace.
  // Tap trace on → gate listens → each phrase becomes a separate buffer.
  hfArmed:          false,   // true = handsfree armed (gate segmentation active in toggle-trace)
  hfRecording:      false,   // true = handsfree gate has opened a buffer capture
  hfGateOpen:       false,   // current gate state (after envelope processing)
  _traceToggled:    false,   // true = trace was toggled on (tap), not momentary-held
  hfHoldMs:         500,     // hold time (ms) — gate stays open through pauses shorter than this
  hfReleaseMs:      200,     // release time (ms) — smooth gate close after hold expires
  hfAttackMs:       3,       // attack time (ms) — how fast gate opens
  hfMarginDb:       0,       // output-referenced threshold margin (dB above output RMS) — 0 = off
  hfHpfFreq:        120,     // high-pass filter frequency (Hz) for gate sidechain
  hfHpfEnabled:     true,    // enable HPF on gate sidechain
  hfMinBufferMs:    150,     // reject gate opens shorter than this (ms)
  hfMaxBufferSec:   30,      // auto-close after this many seconds
  hfFeedbackDetect: true,    // enable rising-RMS feedback trend detection
  hfCompEnabled:    false,   // optional pre-gate compressor (off by default)
  hfCompRatio:      3,       // compressor ratio (2:1–4:1)
  hfCaptureCount:   0,       // number of buffers auto-captured this session
  hfCaptureFlashUntil: 0,    // performance.now() timestamp for HUD flash

  // ── Audio ──────────────────────────────────────────────────────────────
  audioCtx:   null,
  inputStream: null,   // shared MediaStream from mic (set by audio.js)
  masterBus:  null,
  masterAnalyser: null,
  inputGainNode:  null,   // pre-compressor gain for mic signal
  inputAnalyser:  null,   // AnalyserNode tapped after inputGain, before compressor
  inputGainValue: 1.0,    // 0.0 - 2.0, default unity

  // Grain tracking for waveform playhead (ring buffer)
  activeGrains: [],
  _agWriteIdx: 0,    // ring-buffer write cursor for activeGrains

  // ── Performance mode ──────────────────────────────────────────────────
  // When true: minimal rendering — equator + meridian, particles (no glow),
  // cursor, no edge HUD, no seed trails, no depth sort. Audio first.
  perfMode: false,

  // ── Performance monitor ────────────────────────────────────────────────
  perfMonitorVisible: false,
  _grainSourceCount: 0, // incremented on start, decremented on ended

  // ── Grain params / overrides ───────────────────────────────────────────
  grainParams: null,          // initialised below
  activePresetIndex: 20,  // first factory preset (wash)
  _patchFlashUntil: 0,    // performance.now() — flash patch number on change
  grainOverrides: {
    duration:    null,
    durJitter:   null,   // multiplier randomisation per grain (0–1)
    durVar:      null,   // +/- seconds of duration randomisation per grain
    fadeRatio:   null,   // attack+release each as fraction of dur (0–0.5)
    k:           null,
    period:      null,
    periodVar:   null,   // +/- seconds of period randomisation per onset
    pitchJitter: null,
    pitchShift:  null,   // base pitch shift in cents (±2400 = ±2 octaves)
    panSpread:   null,
    volume:      null,
    retriggerMs: null,   // minimum re-trigger time for seeder grains (ms)
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

  // ── Gesture morph (Phase 4 — Improv Mode) ──────────────────────────────
  // Physical gesture drives seeder grain character along a smooth↔agitated axis.
  agitateThreshold: 80,          // deg/s — gyroMag above this pushes toward agitated
  smoothThreshold:  20,          // deg/s — gyroMag below this (with movement) pushes toward smooth

  // ── Desktop morph (1D slider morph for HCI — no sensor) ────────────────
  // Morphs the nearest non-moving seed's grain params between two presets,
  // with center position = the seed's planted grain settings.
  desktopMorphPresetL: -1,       // PRESETS index for left endpoint (-1 = none)
  desktopMorphPresetR: -1,       // PRESETS index for right endpoint (-1 = none)
  desktopMorphT:       0.5,      // 0=left preset, 0.5=center (planted), 1=right preset
  desktopMorphSticky:  false,    // true = slider stays where released; false = returns to center
  desktopMorphReturnMs: 800,     // return-to-center time in ms (when not sticky)
  _desktopMorphAnimId: 0,        // rAF handle for return animation

  // ── Commit playback modes ──────────────────────────────────────────────
  // 'all' = all commits play simultaneously (collage)
  // 'focus' = distance-weighted blend toward closest commit(s)
  commitPlayback:  'all',    // 'all' | 'focus'
  commitXfade:     0.5,      // 0.0 = hard snap (focus only), 1.0 = full crossfade (distance blend)
  commitTether:    false,    // true = always plays closest commit(s) even if far away
                              // false = gated by cursor radius — commits outside radius fade to silence
  // Legacy aliases
  get seedMode()    { return this.commitPlayback; },
  set seedMode(v)   { this.commitPlayback = v; },
  get seedXfade()   { return this.commitXfade; },
  set seedXfade(v)  { this.commitXfade = v; },
  get seedTether()  { return this.commitTether; },
  set seedTether(v) { this.commitTether = v; },

  // ── Monitor / House bus split (Phase 1 — Improv Mode) ─────────────────
  // monitorBus:  cursor grains route here (private monitoring, always on)
  // houseBus:    seeder grains route here (public house mix)
  // monitorToHouseGain: pedal-controlled send from monitor → house (0–1)
  // houseGainNode: volume pedal for overall seeder/house level (0–2)
  monitorBus:           null,   // GainNode — cursor grain destination
  houseBus:             null,   // GainNode — seeder grain destination
  monitorToHouseGain:   null,   // GainNode — pedal send: monitor → house
  houseGainNode:        null,   // GainNode — house master volume
  monitorGainValue:     0.0,    // 0–1, MIDI pedal (cursor → house send level)
  houseGainValue:       1.0,    // 0–2, volume pedal (house master)
  // When interface has ≥4 outputs, cursor grains route to the last 2 channels
  // (headphone pair) via these two speaker-bus objects {bus, angleDeg, angleRad}.
  // null = use stereo monitorBus path (browser / 2-ch interface).
  monitorSpeakerBuses:  null,   // [{bus,angleDeg,angleRad}, ...] — headphone pair

  // ── Cursor house mute ─────────────────────────────────────────────────
  // When true, scan is off — cursor grains are silenced in the house / main output.
  // In stereo mode this mutes cursorMasterGain (only seeds are heard).
  // In multi-ch mode this also zeros monitorToHouseGain (cursor stays on monitor outputs).
  scanMuted: false,
  cursorMasterGain: null,   // GainNode inserted between monitorBus and masterGain

  // ── Radius fade (distance attenuation within cursor radius) ───────────
  // When enabled, grains near the edge of the search radius are attenuated
  // based on angular distance from the cursor centre, creating a smooth
  // musical fade-in/out instead of an abrupt volume cliff at the boundary.
  radiusFadeEnabled: false,
  radiusFadeCurve:   0.5,   // 0 = gentle (linear), 1 = aggressive (steep edge fade)

  // Cloud envelope: fade in = swell-in time on commit, fade out = fade-out time on release
  commitAttack:  0,     // cloud fade in — seconds (0 = instant, max 10)
  commitRelease: 0,     // cloud fade out — seconds (0 = instant, max 10)
  commitCloudLoopMode: 'pingpong', // default loop mode for moving clouds: 'pingpong' | 'forward'
  loopReleaseMode: 'fade',        // loop fade out mode: 'fade' = fade over loopFadeTimeMs, 'play-to-end' = finish buffer then stop
  loopFadeTimeMs: 15,             // loop fade out duration in ms (0 = instant, max 2000)
  // Legacy aliases
  get seedAttack()       { return this.commitAttack; },
  set seedAttack(v)      { this.commitAttack = v; },
  get seedRelease()      { return this.commitRelease; },
  set seedRelease(v)     { this.commitRelease = v; },
  get seedLoopMode()     { return this.commitCloudLoopMode; },
  set seedLoopMode(v)    { this.commitCloudLoopMode = v; },

  // The recording stroke ID — set when painting starts in loop commit mode,
  // used on release to collect particles into a loop.
  _seqRecordingStrokeId: -1,
  // Defaults for the *next* loop commit — sliders in the commit panel edit these.
  commitLoopParams: { direction: 1, speed: 1.0, volume: 1.0 },
  get seqNextParams()  { return this.commitLoopParams; },
  set seqNextParams(v) { this.commitLoopParams = v; },

  // ── Commit recording state ────────────────────────────────────────────
  // Non-null while C is held and recording cursor movement for a moving cloud.
  _commitRecordingFrames: null,
  _commitRecordingStart:  0,     // performance.now() of C keydown
  _commitRecordingSlot:   -1,    // which commit slot is being recorded into
  // Legacy aliases
  get _seedRecordingFrames()  { return this._commitRecordingFrames; },
  set _seedRecordingFrames(v) { this._commitRecordingFrames = v; },
  get _seedRecordingStart()   { return this._commitRecordingStart; },
  set _seedRecordingStart(v)  { this._commitRecordingStart = v; },
  get _seedRecordingSlot()    { return this._commitRecordingSlot; },
  set _seedRecordingSlot(v)   { this._commitRecordingSlot = v; },

  // ── Mixdown source gains ────────────────────────────────────────────────
  // Independent volume controls for house fold-down and cursor contributions
  // to the stereo mixdown bus. Allows performer to hear more/less of either.
  mixdownHouseGainValue:  1.0,   // 0–1, how much house fold-down in the mixdown
  mixdownCursorGainValue: 1.0,   // 0–1, how much cursor in the mixdown
  mixdownHouseGainNodes:  null,  // [GainNode L, GainNode R] — house fold-down → mix sum
  mixdownCursorGainNodes: null,  // [GainNode L, GainNode R] — cursor → mix sum
  mixdownCursorInputs:    null,  // [GainNode L, GainNode R] — cursor grains connect here

  // ── Dry monitor layer ──────────────────────────────────────────────────
  // Continuous spatialized pass-through of the live input signal, panned to
  // the cursor position.  Updates every frame — no recording, no buffering.
  dryMonitorEnabled:  true,   // on/off toggle for the dry spatial layer
  dryMonitorGainValue: 0.5,   // 0–2, dry signal level in the house mix
  dryGainNode:         null,  // GainNode — dry level control
  dryAnalyser:         null,  // AnalyserNode — dry level meter tap
  dryVBAPGains:        null,  // [GainNode, ...] — one per speaker bus (Electron multi-ch)
  dryPanner:           null,  // StereoPanner — stereo path (browser / 2-ch)
  dryMixdownInputs:    null,  // [GainNode L, GainNode R] — dry → headphone mixdown (Electron)

  // ── Output gain + mute ─────────────────────────────────────────────────
  outputGainValue: 0.9,  // linear gain (0–2), matches masterGain initial value
  isMuted:         false,
  projectorMode:   false,  // true when projector layout is active (Shift+F)
  projectorPopup:  null,   // popup Window reference for projector mirror
  projectorCtx:    null,   // popup canvas 2D context for mirror blit
  _syncProjectorHUD: null, // per-frame HUD sync callback (set when popup opens)

  // ── Mobile setup gate ──────────────────────────────────────────────────
  _mobileSetupDone: false, // true once orientation + gyro setup completes

  // ── Camera mode ───────────────────────────────────────────────────────────
  // Controls how the 3D sphere camera is driven and where the paint cursor lives.
  // 'pull'    — (default) mouse/trackpad pull-from-center with dead zone + ease curve.
  //             Cursor follows mouse position. Alt-lock supported.
  // 'surface' — trackpad surface = flattened sphere map. Finger position → sphere
  //             coordinate directly. Cursor hidden, paint target = canvas center.
  //             Alt-lock supported.
  // 'sensor'  — mubone IMU sensor drives camera quaternion. Cursor hidden,
  //             paint target = canvas center. Alt-lock not needed (mouse is free).
  cameraMode: 'pull',   // 'pull' | 'surface' | 'sensor'

  // ── Spatial panning ──────────────────────────────────────────────────────
  // Controls how grain audio is spatialized, independent of camera mode.
  // 'headlocked'  — sound field rotates with the camera (binaural / stereo sim).
  //                  Uses StereoPanner, view-relative grain positions.
  // 'worldlocked' — sounds fixed in room (VBAP). Grain positions are absolute
  //                  world-space, speakers are fixed. Any number of speakers.
  spatialPanning: 'headlocked',   // 'headlocked' | 'worldlocked'

  // ── Multi-channel audio routing ────────────────────────────────────────
  // Number of spatial house speaker positions in the VBAP field.
  // initSpeakerBuses creates exactly this many house buses.
  // When stereoMixdownEnabled is true the last 2 physical channels are
  // reserved for the mixdown pair; otherwise all channels are house.
  numHouseSpeakers: 2,

  // When true, a dedicated stereo mixdown bus pair is created and wired to
  // the last 2 physical output channels (overrideable via mixdownRouting).
  // Cursor grains route to this pair.  When false, all channels are house
  // and cursor grains use the stereo monitorBus path.
  stereoMixdownEnabled: false,

  // Hardware input channel index (0-based) that feeds the granular engine.
  // Shown as "main (mono)" in audio settings input mapping table.
  mainInputChannel: 0,

  // Physical output channel assignments for the stereo mixdown pair.
  // null = auto (last 2 physical channels of the device: [n-2, n-1]).
  headphoneRouting: null,   // [physChL, physChR] or null  (kept as headphoneRouting for compat)

  // channelRouting[busIndex] = physical output channel (or -1 = mute).
  // null → identity (house bus i → physical ch i).
  channelRouting: null,

  // speakerAnalysers: one AnalyserNode per speaker bus, populated by initSpeakerBuses.
  // Used by the audio settings modal output meter strip.
  speakerAnalysers: null,

  // ── Channel label overrides ───────────────────────────────────────────────
  // Short names shown on VU meter bars. null = auto-generate.
  inputChannelLabels:  null,   // string[] | null
  outputChannelLabels: null,   // string[] | null

};

// ── Initialise grainParams from first factory preset (index 20 = wash) ───────
S.grainParams = { ...PRESETS[FACTORY_PRESET_START] };

// Init scaled Hann curves, then rebuild with correct curve type
rebuildHannCurves(S.grainParams.volume);
rebuildGrainCurves();
