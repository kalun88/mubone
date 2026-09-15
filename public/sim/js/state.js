// ============================================================================
// state.js — Constants, presets, and shared mutable state
// Extracted from index.html monolith.
// ============================================================================

// ── Debug ────────────────────────────────────────────────────────────────────
// Set to true (or add ?debug to the URL) to enable verbose console logging.
export const DEBUG = new URLSearchParams(window.location.search).has('debug');

// ── Constants ────────────────────────────────────────────────────────────────

export const SPHERE_RADIUS       = 1200;
export const GRID_SEGMENTS_LON   = 18;  // every 20deg (halved for perf)
export const GRID_SEGMENTS_LAT   = 9;   // every 20deg (halved for perf)
export const AUTO_ROTATION_SPEED = 0.0001;
export const ROTATION_SPEED      = 0.06;
export const FOV_DEG             = 80;
// The sensor-mode CAMERA pitches with the cursor all the way to ±90 — the
// crosshair stays vertically centred at every elevation (Ek, 2026-09-01: "i
// expect it to be fixed in the center in sensor mode"). A 60°→74° soft-knee
// compression lived here for one build; it was solving the wrong half of the
// measured pole problem. The spin (body yaw at elevation e → sin(e) view-axis
// spin, 99.7% at 85°, with roll at exactly zero) comes from yaw MOTION near
// vertical — and yaw is faded to a stop there (below) — so full pitch is safe.
// The geometry then works FOR the crosshair instead of against it: the
// on-screen offset from a yaw error shrinks as cos(el)·err — a 180° azimuth
// gap at el 88 is 4° on screen, and at the pole itself every azimuth is the
// same point, so the crosshair is exactly centred no matter what yaw does.
// The servo camera's three rig-data constants (2026-09-01, all derived from a
// 128 s recording of Ek's actual sensor — scratchpad rig-recording, findings
// in TODO #306). The camera is UPRIGHT-ONLY: pitch clamps at ±90, so an
// upside-down world is unrepresentable — the flip Ek kept hitting turned out
// to be dropout TELEPORTS (a 4.5 s wifi gap swallowed a whole descent; the
// pointing reappeared 84° away in one packet) resolving through the old
// inverted branch and sticking there for the rest of the session.
export const SENSOR_CAM_SWING_DEG_S   = 360; // A comes around at this rate when
                                             // pitch is pinned at the pole and
                                             // the hand keeps going — the
                                             // deliberate over-the-top pan
export const SENSOR_CAM_OVERSHOOT_DEG = 2;   // pitch overshoot past the clamp
                                             // that counts as "kept going"
export const SENSOR_CAM_TELEPORT_DEG  = 20;  // a pointing step this big between
                                             // CONSECUTIVE packets is not a
                                             // hand, it is a dropout resume —
                                             // reacquire upright, clean cut
                                             // (local dt is no defence: resumes
                                             // arrive as bursts of stale queued
                                             // packets with tiny dt)

// (Four generations of sensor-camera yaw machinery lived here on 2026-09-01 —
// a hard clamp, a soft knee, a fade+glide state machine, a lazy pursuit, each
// with its constants. All deleted the same day: the camera is now an
// INCREMENTAL servo — surface mode's composition with the sensor's pointing
// as the trackpad — and it has no tunables. See cameraFromPointing in
// renderer.js for why that dissolves the pole rather than managing it.)
// ── k is a CEILING on a stable scale (Ek, 2026-09-07) ──────────────────────
// k used to be a slider whose MAX was rewritten to the particle count on every
// perf tick, so the same handle position meant k = 30 before a session and
// k = 900 after it. That made k unusable as the thing Ek actually wants it to
// be: "K is more of the max pool size — set it at a higher number and once it
// hits it, i know i've maxed out the pool on the cursor". A ceiling you cannot
// set on a fixed scale is not a ceiling, and a slider whose max moves under
// your hand breaks the engine page's rule that a slider's raw value is its
// POSITION. So the scale is fixed and log-mapped: fine control down at 1–10
// where one mark more is a musical difference, and headroom to park k above
// anything you will paint — uncapped in practice, but still instrumented,
// because the live count can only tell you it saturated if there is a number
// to saturate against.
export const K_MAX = 1024;

export const PARTICLE_BASE_SIZE  = 4;
export const PARTICLE_MAX_SIZE   = 20;
export const MAX_SAMPLES         = 10;

export const SEARCH_RADIUS_MIN  = 1;
export const SEARCH_RADIUS_MAX  = 180;
export const SEARCH_RADIUS_STEP = 2;

// ── The main button ─────────────────────────────────────────────────────────
// What space, a click, the pedal and the slot keys do is one of two things,
// decided in brush.js `gesturePress` (Ek, 2026-09-04). In TOGGLE mode a hold
// means nothing else, so it is free for a second function: a button still
// down after GESTURE_LONG_MS fires the tool's long press (erase: erase all).
// The old tap-versus-hold hybrid and its two windows (TRACE_TAP_MS,
// TRACE_TAP_MIN_MS) went with it — see the header of that function.
export const GESTURE_LONG_MS = 8000;

// ── Cursor axis source ──────────────────────────────────────────────────────
// Who drives each cursor axis, held in S.azSource / S.elSource.  One owner per
// axis, declared by the state itself — there is no precedence rule to get wrong.
//
//   'sensor' — the cursor-role sensor's own yaw/pitch, free running
//   'locked' — frozen at the value held when the source was last set
//   'mapped' — driven by a sensor-mapping row targeting cursor azimuth/elevation
//
// An axis set to 'mapped' with no mapping row feeding it HOLDS its last value
// (i.e. behaves as 'locked') rather than snapping back to sensor control.
// Silently resuming sensor motion mid-performance because a row got disabled is
// the worse failure — see CURSOR_SOURCE in docs/TODO.md.
//
// These replaced booleans `axisLockAz` / `axisLockEl`.  The rename is the whole
// point: `if (S.axisLockEl)` is truthy for the string 'off', so retyping in
// place would have left every read site silently behaving as locked.  Same
// reasoning as FACTORY_PRESET_START in #156 — delete the name, break loudly.
export const AXIS_SOURCES = ['sensor', 'locked', 'mapped'];

/** True when the axis is held rather than free-running ('locked' or 'mapped'). */
export const axisHeld = src => src !== 'sensor';

// ── The sphere's palette (2026-08-29) ────────────────────────────────────
// The grid is the WORLD, not an engine. It has to recede so that material,
// commits and the cursor read against it — so it carries no engine hue and
// almost no chroma. Cyan graph paper on pure black was the loudest thing on
// the stage and read as a gunsight (Ek: "very matrix neo green").
//
// Two bright lines and everything else is structure:
//   horizon — the equator and the front meridian, warm ivory. The only bright
//             thing on the grid: level, and which way you are facing. This is
//             the artificial-horizon read the sphere is identified by.
//   behind  — the back meridian: the same great circle from the far side, so
//             the same hue, dropped toward grey rather than recoloured.
//   graph   — every other meridian. Structure. Nothing to look at.
//   north / south — sky above, earth below. Desaturated hard, because the cue
//             has to survive a glance without turning the stage into a poster.
// ink is a lifted black: at #000 every line on top of it reads as neon, and
// the lift is far below anything a projector puts on a wall. The lift is WARM
// (2026-08-29): a cool lift under a warm ivory horizon is the same mismatch the
// chrome had, one layer down, and it is the black every other colour in the app
// is now derived against. `graph` lost its blue cast for the same reason —
// structure should read as structure, and `north` should be the only cool thing
// in the sky.
export const SPHERE_PALETTE = {
  dark:  { ink: '#090806', horizon: '#e4ddd0', behind: '#8b8478',
           graph: '#6e6963', north: '#6d8ea6', south: '#a8806b' },
  light: { ink: '#ffffff', horizon: '#3b3529', behind: '#8a8377',
           graph: '#98a2a9', north: '#41708f', south: '#8d6448' },
};

// NOTE: the precomputed HANN_ATTACK / HANN_RELEASE arrays and the
// buildEnvelopeCurves / rebuildHannCurves / rebuildGrainCurves machinery that
// scaled them were removed 2026-08-04.  They were the main-thread envelope from
// before the AudioWorklet migration.  The worklet builds its own 1024-entry
// hann and triangle tables ONCE in its constructor and only ever indexes them —
// changing curve type just selects a different array, and fadeRatio changes the
// lookup mapping, not the table.  Nothing read S.GRAIN_ATTACK_CURVE /
// S.GRAIN_RELEASE_CURVE anywhere in the repo; rebuildGrainCurves() was still
// being called on every volume CC, allocating two Float32Array(128) per call
// (~128KB of garbage per pot sweep) to fill arrays no one looked at.

// Loaded-sample paint colours. Ten identities that have to stay tellable
// apart, so they do go all the way round the wheel — but at ONE perceptual
// lightness (OKLCH L=0.80, C=0.095), which the old set did not: '#ffd06b' was
// far lighter than '#6b6bff', so sample 3 always looked more important than
// sample 8 for no reason anyone chose. Pastels, not highlighters.
export const SAMPLE_PAINT_COLORS = [
  '#f5a69c', '#e9b17c', '#ccc076',
  '#a2cc8f', '#79d2b7', '#6ccfde',
  '#88c5f7', '#b1b7fa', '#d6abe7',
  '#eea4c4'
];

// Live-rec paint colours — the pool a stroke's colour cycles through. Nine
// identities confined to the warm quadrant, rose through ember to ochre, at one
// perceptual lightness (OKLCH L=0.755, C=0.105). The old set was already an
// amber family but still contained '#e8c840', a near-pure yellow: once the
// timbre map stopped producing greens that was the last highlighter left on
// the stage, and it read as a mistake next to everything else. That reasoning
// no longer holds for the TIMBRE map — its arc runs through green and yellow
// again since 2026-09-13 (see featuresToColor) — but it still holds here: this
// pool is a fallback identity for a stroke with no engine behind it, not a
// reading of the sound, and it stays in the warm quadrant.
// The nine-step ramp a live stroke used to cycle through, pink → gold, one
// step per take REGARDLESS OF ENGINE. That is what made painted material
// "alternate colours" (Ek, 2026-09-13) and it contradicted the one rule the
// hues exist for: the tile you pressed and the mark under your hand are the
// same colour by construction (DESIGN-SYSTEM § 4). It survives only as the
// fallback for a stroke with no engine behind it.
export const LIVE_PAINT_COLORS = [
  '#e294b9', '#e793ab', '#ea939d',
  '#eb958f', '#ea9782', '#e79a76',
  '#e29e6b', '#dba363', '#d2a85e'
];

/** THE COLOUR A LIVE MARK IS PAINTED IN (2026-09-13).
 *
 *  The ENGINE's hue — tape pink, grain gold — so a glance at the sphere says
 *  what made the material, the same way the rail row and the tile do. Takes
 *  still have to be tellable from each other, so consecutive ones step through
 *  a small lightness swing AROUND that hue rather than across the spectrum:
 *  five steps, ±9%, which separates neighbours without ever reading as a
 *  different engine. `S._paintHue` is published by tiles.js for whatever is
 *  playing and is null between presses; with no engine behind the stroke the
 *  old ramp still answers. */
const _PAINT_STEPS = [0, 0.09, -0.09, 0.045, -0.045];
export function livePaintColor(index = 0) {
  const hue = S._paintHue;
  if (!hue || !/^#[0-9a-f]{6}$/i.test(hue))
    return LIVE_PAINT_COLORS[index % LIVE_PAINT_COLORS.length];
  const k = _PAINT_STEPS[index % _PAINT_STEPS.length];
  const ch = [1, 3, 5].map(i => parseInt(hue.slice(i, i + 2), 16));
  const out = ch.map(v => {
    const t = k >= 0 ? v + (255 - v) * k : v * (1 + k);
    return Math.max(0, Math.min(255, Math.round(t))).toString(16).padStart(2, '0');
  });
  return '#' + out.join('');
}

// Commit system — unified pool for clouds (particle-based) and loops (buffer-based).
// MAX_COMMITS is the hard upper bound (array size).
// S.commitSlotCount (1–16) is the active limit per session.
export const MAX_COMMITS = 16;
// Legacy aliases — kept so existing code compiles during transition
export const MAX_SEEDS = MAX_COMMITS;
// Sixteen slot identities. These DO circle the whole wheel — a slot colour's
// only job is to be tellable from the other fifteen at a glance, and hue
// separation is the only budget that buys that. What changed on 2026-08-29 is
// that they are all at the same perceptual lightness (OKLCH L=0.775, C=0.082)
// instead of being Material-design swatches: '#fff176' sat next to '#4fc3f7'
// sat next to '#c084fc', so slot 6 read as louder than slot 11 for no reason.
// A set of pastels rather than a packet of highlighters.
export const COMMIT_COLORS = [
  '#e4a58d', '#dbab7e', '#ccb378', '#b9bb7d',
  '#a3c18b', '#8cc69f', '#7ac7b5', '#72c6ca',
  '#78c2db', '#89bce7', '#9eb5eb', '#b4aee7',
  '#c8a7dc', '#d7a2cb', '#e1a0b6', '#e6a1a1'
];
// Legacy aliases
export const SEED_COLORS = COMMIT_COLORS;
// Commit draw threshold (ms) — hold D longer than this to record a moving cloud / new loop.
// Shorter is treated as a stationary drop.
export const COMMIT_DRAW_THRESHOLD_MS = 200;
export const MOVING_SEED_THRESHOLD_MS = COMMIT_DRAW_THRESHOLD_MS; // legacy alias
// ── Performance tuning ────────────────────────────────────────────────────────
// These were set conservatively during early CPU-load testing. Adjust here if
// you want to change system-wide behaviour without hunting through call sites.

// Grain scheduler tick rate in ms. 30ms ≈ 33 ticks/sec.
// Grains are 25ms–2000ms so 30ms resolution is inaudible.
// 20ms tick = 50 ticks/sec; with 40ms lookahead, grains overlap 2× (no gaps).
// Was 10ms but the seed scheduling loop is O(seeds×particles) per tick —
// at 16 seeds × 500 particles that's 800k+ ops/sec, starving the render loop.
// 10 ms since 2026-09-06 (R3, #340): the pass costs 0.5 ms on the probe's stressed
// scene now that the pool crosses as shared tables, and the halved tick is
// −10 ms of worst-case gesture-to-grain. Was 20.
export const GRAIN_SCHEDULER_INTERVAL_MS = 10;

// Minimum period for the UI slider floor and seed onset-clock advancement.
// With the AudioWorklet grain engine handling all synthesis on the audio thread,
// there is no main-thread crash risk at sub-ms periods.  The slider log scale
// extends down to 50µs (20kHz grain rate).  Below ~2.67ms (1 render quantum
// @48kHz) grains lose individual identity — you're writing a continuous waveform.
// Below ~0.05ms you're at audio rate.
export const SCHED_SAFE_PERIOD_S = 0.00005; // 50µs

// Render loop frame rate cap. The animate() loop throttles canvas redraws to
// this rate while requestAnimationFrame still runs at full display rate (handling
// painting and camera). Lower this (e.g. 20) to cut canvas draw cost on dense scenes.
export const RENDER_TARGET_FPS = 30;

// Live rebuild throttle — how often the provisional live buffer updates its
// AudioBuffer reference for candidate offset resolution and UI.
// With the direct mic input path (worklet accumulates audio at audio rate),
// this no longer controls audio latency — only how stale the main-thread
// AudioBuffer is for offset clamping in candidate posts.
// 50ms is plenty: the scheduler (20ms) flushes before posting candidates,
// and the worklet has the real data via its process() input.
export const LIVE_REBUILD_INTERVAL_MS = 50;

// Recording memory guard — the total live audio the app will hold before it
// REFUSES a new take (audio.js startLiveRecording). At 48kHz mono a minute is
// about 11.5 MB of Float32, so 1800s (30 min) is roughly 345 MB.
//
// It was 600s from 2026-03-24 until 2026-09-13, sized in its own comment as
// "conservative for student laptops with 8GB RAM" — the Dartmouth workshop
// machines. Ek's ruling on the day the silent-refusal bug was found: 30 min,
// which is the slider's existing maximum and long enough that a set does not
// reach it, while still bounded. Refusing is still what happens at the
// ceiling — nothing is auto-deleted, because the takes still hold marks on
// the sphere and undo cannot bring them back — and the chrome now says so
// from 80% on (tile-layout.js).
export const REC_LIMIT_SECONDS_DEFAULT = 1800;

// ── Level fader response ──────────────────────────────────────────────────────
// Response exponent baked into the master and grain volume ccFns, so a fader
// or pot on either spends more of its throw at the top:
//
//   value = span · (cc/127)^LEVEL_FADER_GAMMA
//
// Below 1 = finer at the top of the throw, which is where a level lives during
// a piece; the bottom of a volume fader is the part nobody needs resolution in.
// At 0.8 over master's 78 dB the top step is 0.49 dB rather than 0.61, and the
// cost is a 1.7 dB first step off the stop instead of 0.6 — inaudible territory
// either way. Unity moves from 77% to 72% of the throw.
//
// A 7-bit cc has 128 steps whatever the curve: this redistributes them, it
// cannot add any. Controllers can shape further on top of this per binding
// (the γ column in keys / midi / osc, which shows the product).
//
// OSC is untouched — /master/volume and /grain/volume take real values, not
// controller positions, so no curve applies there.
export const LEVEL_FADER_GAMMA = 0.8;

// ── Master output default ───────────────────────────────────────────
// The one place the master's cold-boot level is decided. Defaults are not
// stored anywhere in this app — they are whatever modules initialise to — so
// every consumer must derive from here rather than repeat a literal.
//
// This used to be 0.9 linear in S.outputGainValue while every master slider
// and the audio-settings `outputGain` said -6 dB. On a cold boot with no
// saved settings the graph really was at -0.9 dB, the UI claimed -6, and the
// first touch of the fader dropped the output ~5 dB out of nowhere.
//
// Consumers: `masterGain` and `busGainInit` in js/audio.js, `as.outputGain`
// in js/ui-audio-settings.js, and the value/data-default on asOutputGain +
// apMasterGainSlider in index.html (those two are markup, so keep them in
// step by hand).
export const MASTER_DEFAULT_DB   = -6;
export const MASTER_DEFAULT_GAIN = Math.pow(10, MASTER_DEFAULT_DB / 20);  // ≈0.5012

// ── Gate meter ballistics ─────────────────────────────────────────────────────
// Attack, release and peak fall for the gate meter, as TIME CONSTANTS rather
// than per-tick coefficients — the meter ticks at half the RAF rate (~30 Hz,
// see tickMainMeters), and a bare coefficient silently means something else if
// that ever changes.
//
// They are applied to the DRAWN POSITION, not to the RMS. The axis below is a
// γ3 power curve, and an exponential decay in RMS is an exponential in position
// with THREE TIMES the time constant: smoothing the RMS made a 205 ms release
// take 1.4 s to fall to a tenth of the meter's width, which is too laggy to
// judge a threshold against. Smoothing the position instead puts these numbers
// back in the domain the eye is in — the same reason hardware meters specify
// their ballistics in dB.
export const GATE_METER_TICK_MS      = 1000 / 30;
// 10 ms is ~0.96 of the way in a single tick — effectively instant rise, which
// is what a peak meter does and what makes a woodblock read at its true height.
// 28 ms (the old RMS-domain coefficient, carried over) only reached 91% of a
// 67 ms hit before the release started pulling it back down.
export const GATE_METER_ATTACK_MS    = 10;
export const GATE_METER_RELEASE_MS   = 205;  // ~470 ms to fall to a tenth of the width
export const GATE_METER_PEAK_HOLD_MS = 667;  // peak marker sits still this long,
export const GATE_METER_PEAK_FALL_MS = 650;  // then falls, deliberately slower than the bar

// ── Paint gate meter scale ──────────────────────────────────────────
// The gate meter's axis. Everything that reads or writes a position on that
// meter shares it — the RMS bar, the peak tick, the threshold marker, the mouse
// drag, and the noise_gate cc action — so a pot's throw matches what's drawn.
//
//   rms = GATE_METER_MAX · frac^GATE_METER_GAMMA
//
// Why not linear: the gate's working range against a live mic is 0–0.004 RMS,
// which is 7% of a linear 0–0.06 span — 8 steps of a 7-bit cc, and a threshold
// marker pinned to the left edge. At γ=3 that region takes 41% of the travel
// (~52 cc steps) while the ceiling still reads 0.06, so the full input range
// stays visible. γ=4 gives it 51%, γ=2 gives 26%.
//
// Changing GATE_METER_GAMMA re-scales the meter and the cc together; stored
// thresholds are real RMS and are unaffected.

// The ceiling is 1.0 because the meter now draws the metric the gate tests
// (audio-features.gateLoudness), whose range is 0…1 — so "threshold all the way
// up" is guaranteed to gate everything, and the top of the meter is full scale.
// The old 0.06 was sized for plain RMS and could not be reached at all by the
// peak-weighted value: anything above ~−22 dBFS peak painted regardless.
//
// γ is re-derived to keep the working region where it was: 0.004 sits at
// 0.004^(1/6) = 40% of the travel, the same 40% it had at 0.06/γ3, and the
// noise_gate cc still spends 51 of its 128 steps below it. Landmarks:
//   room noise ~0.001 → 32%   ·  threshold 0.002 → 36%
//   playing    ~0.1   → 68%   ·  full scale 1.0  → 100%
export const GATE_METER_MAX   = 1.0;    // full scale — the metric's own ceiling
export const GATE_METER_GAMMA = 6;      // >1 = more of the throw spent near zero

// ── Serial accessory (x-IMU3-SA-A8) ───────────────────────────────────────────
// 8 analogue inputs, 12-bit, fixed 100 Hz, arriving as comma-separated volts in
// the x-IMU3's serial-accessory message (manual §8.2.14).  See accessory-registry.js.

export const ACC_CHANNEL_COUNT = 8;      // pads 1–8 on the A8
export const ACC_RAIL_VOLTS    = 3.0;    // low-noise rail feeding the pads

// The adapter hot-plugs with no event, so silence IS the unplug signal.  500ms
// is five missed samples at 100Hz — long enough not to trip on a dropped WiFi
// packet, short enough that a held button releases before it's musically odd.
export const ACC_STALE_MS      = 500;
export const ACC_WATCHDOG_MS   = 250;    // staleness poll — half the stale window
export const ACC_RATE_WINDOW_MS = 1000;  // window for the observed-rate readout

// Per-channel defaults, applied to every new channel and used as the reset value.
// Tuned against measured hardware noise: an idle pot jitters a few mV, so the
// deadband sits just above that.  Raising smoothing past ~0.5 is audible as lag
// on grain duration; dropping deadband below ~0.001 lets dither through.
export const ACC_DEFAULT_SMOOTH   = 0.25;   // one-pole coeff: 1 = raw, lower = smoother
export const ACC_DEFAULT_DEADBAND = 0.002;  // normalised; below this we don't dispatch
export const ACC_DEFAULT_HI       = 0.66;   // schmitt upper threshold (normalised)
export const ACC_DEFAULT_LO       = 0.33;   // schmitt lower threshold (normalised)

// ── The default grain block ──────────────────────────────────────────────────
// What S.grainParams starts as, and what a grain tile adopts the first time it
// is armed on a fresh profile (tiles.js _adoptBlock). It is the old factory
// patch `wash` — smooth granular freeze, live-monitor feel, overlap ~9.7
// (589 ms / 61 ms), full-sphere k = 99. The rest of the bank (ten factory
// patches, ten user slots, the loader, the index migration) was sunset on
// 2026-09-03: a tile owns its whole block now, so a flat bank of grain
// patches had nothing to be a bank OF (docs/archive/BRUSH-MODEL.md § 1e). The data is
// in the sunset folder's presets-data.js (see the sandbox README, #325).
//
// k    = neighbourhood pool size -- how many nearest particles are candidates.
//        One grain fires per cursor onset, chosen randomly from the k pool.
//        (A LENS property since #233; kept here only as gp().k's fallback.)
// period = seconds between cursor onsets (global clock, independent of duration).
//   period > duration -> silence gap between grains (sparse/pulsed feel)
//   period < duration -> grains overlap in time (dense/washy feel)
export const DEFAULT_GRAIN = {
  grainKAllMode: false,
  grainKSeqMode: false,
  k:             99,
  duration:      0.589,
  durJitter:     0,
  startJitter:   0,        // on-marker only — see grainOverrides.startJitter
  fadeMode:      'pct',    // 'pct' = fade scales with duration, 'ms' = fixed ramp
  fadeMs:        0.020,    // ramp length in seconds, used when fadeMode === 'ms'
  durVar:        0.04,
  fadeRatio:     0.50,
  period:        0.061,
  periodVar:     0.025,
  pitchShift:    0,
  pitchJitter:   0.012,
  probability:   1.0,
  panSpread:     0.05,
  volume:        0.85,
  direction:     'fwd',
  curveType:     'hann',
  hpfFreq:       20,       // 20 Hz = off (below audible, bypass)
  lpfFreq:       20000,    // 20 kHz = off (above audible, bypass)
  // ONE Q PER FILTER (Ek, 2026-09-07: "the current Q for filter changes both
  // the Q for the hpf and lpf, they should have their own right?"). It was one
  // shared number, so a resonant low-pass could not be had without the same
  // peak appearing at the high-pass corner. Butterworth (flat, no resonance)
  // at both defaults.
  hpfQ:          0.707,
  lpfQ:          0.707,
  filterFreqJitter: 0,     // no per-grain cutoff randomisation
};

// ── Sample-rate-derived grain parameter floor ────────────────────────────────
// Minimum grain duration = 2 samples. Reads the live AudioContext sample rate
// (falls back to 48000 before the context is created, e.g. during early UI
// initialisation). Its twin `minGrainPeriodS`, the same expression for the
// inter-onset floor, was imported once and never called.
export const minGrainDurS = () => 2 / (S.audioCtx?.sampleRate ?? 48000);

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
  schedulerAvg:   0,    // exponential moving average of drift (~1s window)
  schedulerPeak:  0,    // manual peak hold — only resets on user click
  _schedAvgInit:  false,
  seedsPosted:    0,    // active seeds posted to worklet in last scheduler tick
  activeNodes:    0,    // active grains in worklet pool (from feedback)
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

  // Exponential moving average for sched drift (~1s time constant at 50Hz tick rate)
  // α = 1 - e^(-dt/τ) ≈ 0.02 per tick gives ~1s smoothing
  const α = 0.02;
  if (!perf._schedAvgInit) {
    perf.schedulerAvg = perf.schedulerDrift;
    perf._schedAvgInit = true;
  } else {
    perf.schedulerAvg += α * (perf.schedulerDrift - perf.schedulerAvg);
  }
  // Peak hold — never auto-resets, only on user click
  perf.schedulerPeak = Math.max(perf.schedulerPeak, perf.schedulerDrift);

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
  const nodesBad = perf.activeNodes > 256 * 0.90;  // worklet pool = 256 slots

  if (barEl) {
    const pct = Math.min(100, (perf.activeNodes / 256) * 100);  // worklet pool = 256
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



  // Always update particle world count + dynamic k max
  const pCount = S.particles.length;
  const kwcEl = document.getElementById('kWorldCount');
  if (kwcEl) {
    const txt = pCount > 0 ? `[${pCount}]` : '';
    if (kwcEl.textContent !== txt) kwcEl.textContent = txt;
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

  // grains: worklet pool is 256 slots. Show active grain count vs pool size.
  // Warn at 55% (141), crit at 85% (218) — pressure throttle kicks in at 75% (192).
  const WORKLET_POOL = 256;
  setBar('pmNodesBar', 'pmNodesVal',
    (perf.activeNodes / WORKLET_POOL) * 100,
    `${perf.activeNodes} / ${WORKLET_POOL}`,
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

  // sched drift: bar shows rolling average, peak marker shows highest spike
  const schedAvgPct = (perf.schedulerAvg / Math.max(schedMax, 1)) * 100;
  setBar('pmSchedBar', 'pmSchedVal',
    schedAvgPct,
    `+${perf.schedulerAvg.toFixed(1)}ms`,
    60, 90);
  // Peak hold marker + value
  const peakEl = document.getElementById('pmSchedPeak');
  const peakValEl = document.getElementById('pmSchedPeakVal');
  if (peakEl) {
    const peakPct = Math.min(100, (perf.schedulerPeak / Math.max(schedMax, 1)) * 100);
    peakEl.style.left = `${peakPct}%`;
    peakEl.style.display = perf.schedulerPeak > 0.5 ? '' : 'none';
  }
  if (peakValEl) {
    if (perf.schedulerPeak > 0.5) {
      peakValEl.textContent = `pk ${perf.schedulerPeak.toFixed(1)}`;
      peakValEl.style.color = perf.schedulerPeak > schedMax * 0.9 ? '#e06060'
        : perf.schedulerPeak > schedMax * 0.6 ? '#e8a030' : '#7abcbc';
    } else {
      peakValEl.textContent = '';
    }
  }


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
  // [x,y,z,w] | null — the cursor's own quat, whenever a sensor is pointing:
  // two-IMU mode as before, and since 2026-09-01 single-IMU sensor mode too.
  // The camera is DERIVED from it (cameraFromPointing in renderer.js — yaw +
  // clamped pitch, never roll), so "cursor = camera centre" stopped being a
  // rule and became the common case below the pitch clamp.
  // (A `detethered` getter aliasing cursorQ !== null lived here; its one
  // reader is gone and the name stopped being true — single-IMU mode sets
  // cursorQ now.)
  cursorQ: null,
  mouseX: 0,
  mouseY: 0,
  mousePixelX: 0,
  mousePixelY: 0,
  mouseInCanvas: false,
  altLocked:          false,  // true while Alt held -- sphere position frozen
  // Round ten: every command either control path sends to a sensor, for the
  // card's Command log door. {t, what}; capped by the writers at 200.
  _cmdLog: [],
  azSource:           'sensor',  // who drives cursor azimuth   — see AXIS_SOURCES
  elSource:           'sensor',  // who drives cursor elevation — see AXIS_SOURCES
  // (rollSource is gone, 2026-09-01. Roll is DATA: the camera takes none —
  // applyAxisSources strips a sensor quat to yaw+pitch structurally — and the
  // mapping rows read the sensor's roll live via getCursorEuler. The RO footer
  // button and _gateRoll went with it; disable a mapping row in Settings →
  // Mapping when roll should stop driving something.)
  // Degrees written by sensor-mapping rows whose output kind is 'cursor'.
  // null = no row is feeding that axis, so a 'mapped' axis holds instead.
  // Same shape and lifetime as S.grainOverrides.
  cursorOverrides:    { azimuth: null, elevation: null, roll: null },
  _axisLockFrozenNx:  null,   // snapshot of surface nx when az is held
  _axisLockFrozenNy:  null,   // snapshot of surface ny when el is held
  _axisLockFrozenYaw:   null, // snapshot of sensor yaw when az is held
  _axisLockFrozenPitch: null, // snapshot of sensor pitch when el is held
  // (_axisLockFrozenRoll lived here for two days, 2026-08-31 → 09-01: a
  // snapshot so MUTING roll could hold the horizon. Then roll stopped reaching
  // the camera at all — applyAxisSources composes yaw·pitch only — and a
  // snapshot for a channel that no longer exists is exactly the kind of
  // leftover the next session mistakes for a mechanism.)
  _rawCamQ:             null, // pre-substitution sensor quats, kept so a cursor
  _rawCursorQ:          null, // mapping can be re-applied after tickMappings()
  altFrozenMousePixelX: 0,
  altFrozenMousePixelY: 0,

  // ── Mobile mode ────────────────────────────────────────────────────────
  isMobile: navigator.maxTouchPoints > 0 && window.innerWidth < 1024,
  orientationActive: false,
  searchRadiusDeg: 10,
  // ── What the lens READS (Ek, 2026-09-07) ────────────────────────────────
  // The lens owns HOW the cursor reads — k, order, fill, radius, nearest,
  // depth — so WHICH MATERIAL it reads belongs to it too, and it was the last
  // thing here that was still a global. It replaces the `triggers on|off` row
  // the cap absorbed: a mute you have to remember you left on becomes a lens
  // you can see you are holding, which is the safer of the two on stage.
  // 'both' | 'grains' | 'tape'. The cap still overrides it — capped, the
  // cursor reads nothing whatever this says.
  lensReads: 'both',
  nearestMode: false,   // when true: ignore radius, always pick closest particle
  grainKAllMode: false, // when true: k limit is removed — all particles within radius fire
  grainKSeqMode: false, // when true: step through candidates sequentially by grainStart order
  radiusTooltipUntil: 0, // performance.now() -- show transient radius label until this time

  // ── Painting ───────────────────────────────────────────────────────────
  isPainting: false,          // true while mouse-move painting is active
  particles: [],              // all painted particles on the sphere
  _particleVersion: 0,        // incremented on every push/remove; grain.js uses this to invalidate angular-distance caches

  // ── Paint ticker (consumed by paint-ticker.js) ─────────────────────────
  // intervalMs: ms between marker deposits while painting.  Also sets onset
  //   precision — the gate lookback rewinds by one interval, so this bounds
  //   how close a grain can start to a detected transient.
  // intervalMs: the deposit clock. (alignMs, a hand-set backdate of each
  // mark's grainStart, was retired 2026-09-02: the offset is now derived from
  // the stroke's frozen brush — brush-voicing.js grainPeakOffsetS.)
  paintTicker: { intervalMs: 50 },

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
  setSearchK:      null,     // set during setup -- module-level so applyPresetObject can call it

  // ── Erase brush ────────────────────────────────────────────────────────
  // Momentary hold-to-erase at the cursor (hold F / /erase/hold).  Follows
  // the cursor's search radius and the same local recency filter the scan
  // uses, so it erases exactly what is currently audible — clearing the
  // newest buffers under the cursor reveals older ones.  See erase.js.
  eraseHeld: false,          // true while the erase input is held
  _syncEraseUI: null,        // set by initEraseUI — reflects held state + count

  // ── Commit system (unified clouds + loops) ─────────────────────────────
  // Each slot is either a cloud (particle-based granular) or a loop (buffer-based).
  // type: 'cloud' | 'loop' stored on each slot object.
  // ── Composer mode ─────────────────────────────────────────────────────────
  // Latched mode. While on, scan is muted and the cursor toggles any commit it
  // reaches. Loops are MUTED (source keeps running, never loses its place);
  // clouds are stopped with the commit attack/release envelope. Commits only —
  // triggers are deliberately out of scope. See docs/archive/COMPOSER-MODE-PLAN.md.
  // Pin groups — clouds and loops, DERIVED from each pin's kind, so there is
  // no membership to store here. See js/pins.js; the two groups' mute/solo
  // flags live on that module's GROUPS table because they belong to the group,
  // not to the session's global state.

  // ── Scope aperture (#217/#218) ────────────────────────────────────────────
  // ── Brush head — deposit geometry (#218) ──────────────────────────────────
  // STATIC paint qualities, deliberately not gesture-driven (Ek): the control
  // is the CHOICE of brush, whose head is predetermined. Width is the band
  // marks scatter across around the path (degrees of half-width; 0 = deposit
  // exactly on the line, today's behaviour). Edge is the distribution across
  // that band: 'hard' = uniform to the rim and stop, 'soft' = gaussian skirt
  // whose sparse fringes read like an airbrush. Spatially SONIC, not
  // cosmetic — wider material granulates over a wider region and spreads its
  // VBAP image. Frozen into the stroke for free: a mark's position is
  // physical (#210 needs no help here).
  headWidthDeg: 0,
  headEdge: 'soft',        // 'hard' | 'soft'
  // The two experimental brush contracts (#218). Set by tile SELECTION —
  // choosing the brush is the control; the character is predetermined:
  // Which experimental deposit contract is active — ONE field, set on tile
  // selection, because these are mutually exclusive characters of the chosen
  // brush: 'none' | 'splatter' | 'match' | 'comb' | 'staff' | 'slice'.
  // echo, chop and pour were cut 2026-08-29 (Ek) — see the tombstone in
  // paint-ticker.js and docs/EXPERIMENTAL-BRUSHES.md.
  brushFx: 'none',
  eraseOldest: false,      // scrape — erase from the bottom (oldest first)
  eraseWholeStroke: false, // scrape — 'erases: stroke' (#243): contact picks
                           // WHICH strokes, then every mark of them goes

  // ── Experimental engine dials (#225) — graduated from module constants ────
  // Every value here was a const in paint-ticker.js; as state they appear in
  // the design view like any engine param, captured per tile like any other.
  fx: {
    splatSpread: 0.10,     // splatter — ° of width per °/s of cursor speed
    splatThrow:  0.06,     // splatter — forward fling, ° per °/s
    staffLo:     110,      // staff — Hz at the bottom of the sphere
    staffHi:     7040,     // staff — Hz at the top
    sliceMinMs:  100,      // slice — cuts producing a segment shorter than
                           // this merge into the previous one (0 = keep all).
                           // Kills the ~100 ms double-onset artifacts without
                           // losing audio: the cut goes, not the material.
  },
  combAxis: 'centroid',    // 'centroid' | 'rms' | 'zcr' — what sorts the comb
  combKeep: 'all',         // 'all' | 'high' | 'low' — the comb's sieve

  // ── Brush voicings (docs/archive/BRUSH-MODEL.md step 3) ──
  // A stroke freezes the brush that painted it. `voicings` is the interned
  // table of distinct resolved param blocks, `currentVoicing` is the id being
  // stamped on everything the current stroke deposits, and each particle keeps
  // it as `_vo`. `currentVoicing` is set at recordStrokeStart and re-set per
  // deposit when a param moves MID-STROKE (paint-ticker.js _refreshVoicing),
  // so one strokeId can carry several voicings — the worklet buckets by
  // particle, so a later sweep plays each section as it was painted. A WET
  // brush's strokes all point at the one voicing its knobs edit in place
  // (brush-voicing.js, "Wet paint"). id 0 means "follow the live params",
  // which is what nothing paints as any more.
  voicings: [],
  voicingSeq: 0,
  currentVoicing: 0,

  // Which brush is selected in the brush library (js/brush.js), as a
  // 'grain' | 'tape' key.  The MATERIAL is derived from it and never set
  // directly — that is the whole point (docs/archive/BRUSH-MODEL.md § 1). The old
  // 'stamp:N' keys died with #247: a sample is a source, not a brush.
  brushKey: null,

  // ── The pin lenses (2026-08-29) ────────────────────────────────────────
  commitSlots: new Array(MAX_COMMITS).fill(null),
  commitSlotCount:    8,        // active limit (1–16), adjustable during session
  commitOverflow:     'off',    // 'off' | 'oldest' | 'nearest'
  // What a finished grain stroke BECOMES: 'trace' scratch, 'trace+cloud' a
  // moving cloud on its own path (the wash brush). Driven by the grain sheet's
  // `on end` row (tiles.js) — the A key, /trace/mode and the cabinet button
  // that cycled it went on 2026-09-05, and so did the third value,
  // 'trace+loop' (the looper with grain marks; a session file carrying it
  // reads as 'trace').
  traceMode:          'trace',
  commitMode:         'cloud',  // 'cloud' | 'loop' — what the next C press creates
  selectionMode:      'nearest', // 'nearest' | 'farthest' | 'oldest' — the SELECTED pin: what unpin takes, what the rail marks (pins.js)
  // Legacy aliases for code that still references old names
  get seedSlots()       { return this.commitSlots; },
  set seedSlots(v)      { this.commitSlots = v; },
  get seedSlotCount()   { return this.commitSlotCount; },
  set seedSlotCount(v)  { this.commitSlotCount = v; },
  get seedOverflow()    { return this.commitOverflow; },
  set seedOverflow(v)   { this.commitOverflow = v; },
  get seqSlots()        { return this.commitSlots; },
  set seqSlots(v)       { this.commitSlots = v; },
  get seqSlotCount()    { return this.commitSlotCount; },
  set seqSlotCount(v)   { this.commitSlotCount = v; },
  get seqOverflow()     { return this.commitOverflow; },
  set seqOverflow(v)    { this.commitOverflow = v; },
  get seqModeEnabled()  { return this.commitMode === 'loop'; },
  set seqModeEnabled(v) { this.commitMode = v ? 'loop' : 'cloud'; },

  // ── Trigger tool ───────────────────────────────────────────────────────
  // Whether a recording is granular or trigger material is decided BEFORE the
  // record button is pressed (space vs ⇧space) and is fixed for the life of
  // that buffer — there is no global "trigger mode". See js/trigger.js.
  //
  // True while a trigger-type stroke is being recorded; read when the stroke is
  // released to decide what it becomes, and stamped onto each particle so the
  // type travels with the material rather than with the app's state.
  _recordingTrigger: false,
  // The overdub take in flight: { seq } — the master chosen at the press
  // (ui-presets.js beginOverdub). Read once at the stroke's end by
  // attachOverdub and cleared. Null when the hand is not the overdub brush.
  _overdubTake:      null,
  _overdubSeed:      false,   // an overdub press with nothing pinned: this take is pinned as the main loop on release (ui-presets.js, events.js)
  // What the app knows about the time between a sound and its sample, and
  // between a scheduled sample and its sound (js/latency.js). `inS` moves a
  // loop's edges and `roundTripS` moves an overdub's phase; `source` is
  // 'estimate' (from the streams' own reports) or 'measured' (the loopback
  // calibration on Settings → Audio). Zero until latency.js has run.
  latency: { inS: 0, outS: 0, roundTripS: 0, source: 'none', detail: '' },
  // Global trigger off, the exact analogue of scanMuted for granulation:
  // silences firing without touching what was recorded.
  // Triggers — views onto trigger-type strokes, not owners of material.
  triggers: [],
  // How triggers PLAY. Global and live: read at fire time, not copied into each
  // trigger, so moving a slider mid-set changes every trigger immediately —
  // including whatever is sounding. Only the material and its position belong
  // to the recording; none of this is baked in.
  // NOTE: no radius here. A trigger's reach IS the cursor's search radius
  // (S.searchRadiusDeg) — one cursor, one reach. Erase already works that way,
  // and a second radius meant the same physical gesture had two different sizes
  // depending on what it happened to touch.
  triggerParams: {
    hysteresis: 1.15,          // exit radius = search radius × this — anti-chatter
    rearmMs:    120,           // minimum gap before the same trigger can refire
    dwell:      'oneshot',     // 'oneshot' | 'loop' | 'grain' — what dwelling does
    start:      'top',         // 'top' | 'touch' | 'ends' — where playback begins
    retrig:     'cut',         // 'cut' | 'layer' — refire over a pass still sounding
    // Chop splits a take into separate triggers at its silences, at record
    // time. The switch is kept separate from the threshold so toggling it off
    // and back on doesn't lose the value you dialled in — and so the toggle can
    // be a bindable action with nothing to remember.
    chopOn:     false,         // the switch (bindable: trigger_chop)
    chop:       300,           // ms of silence that counts as a break
                               // The paint ticker's paint gate already leaves
                               // the silences as gaps in the particles.
    release:    'play-to-end', // 'play-to-end' | 'fade' — only used by dwell:'loop'
    volume:     1.0,
    speed:      1.0,
    passes:     0,             // self-killing loops (#239): a looper slot plays
                               // N passes, fading each, then deletes itself and
                               // its paint. 0 = ∞. Baked at record time like
                               // speed/volume (#240).
                               // (#242): 'q' | 'w' | 'e', default the first.
                               // Every group is key-addressable — the inbox
                               // was cut 2026-08-28. Baked.
    loopOnEnd:  false,         // the looper CONTRACT as a param (#244): end
                               // the stroke and it loops immediately into its
                               // group. line/slice fix 'arm' via
                               // FACTORY_PARAMS; any custom loop tile can
                               // flip it and become a looper with intention.
  },

  // ── Source (#247 — what the brush inks from) ───────────────────────────
  // The chain is source → brush → lens (BRUSH-MODEL § 1g). Exactly one
  // source is on: 'live' (the input channel in S.mainInputChannel) or
  // 'sampler' (the sample instrument). Persistent, unlike the old
  // activeSampleIndex which doubled as transient per-stroke paint state.
  sourceKind: 'live',
  // samplerIndex: the sampler's current sample. Sampler-internal, 0-based,
  // never -1 — the sampler always has a "current" slot, loaded or not.
  samplerIndex: 0,
  // Each slot: { buffer, name, duration, grainCursor, cropStart, cropEnd }
  samples: [],
  // True while sampler capture (record-into-sampler) holds the shared
  // recording singletons. One rule: while either this or isRecording is up,
  // the other family refuses.
  isSamplerCapturing: false,

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
  // Transport faults since load, so a crackle can be attributed after the
  // fact (2026-09-02): input ring ran dry (a block of silence went into the
  // take), input ring overflowed (samples skipped), output buffer dropped for
  // want of an IPC credit (a 21 ms hole). Grain-pool steals are in the
  // worklet's own diag. Read with wg.status().
  transportDiag: { inDry: 0, inOverflow: 0, outDropped: 0, outDry: 0, inSkipped: 0, inFillMs: 0, outDepthMs: 0,
                   hostGapMaxMs: 0, hostGaps10: 0, hostGaps20: 0, hostSlow: [], hostGcMaxMs: 0, hostGcOver10: 0,   // the audio host's loop
                   mainGapMaxMs: 0, mainGaps10: 0, mainGaps20: 0, mainSlow: [] },                                  // the browser thread
  // Until when the loop-gap timers should run (P1, 2026-09-06). They cost ~1 %
  // of a core in each of two processes, so they are armed by whoever reads
  // them — wg.status(), the transport probe, Settings → Audio — and off in a
  // show. The HOLDERS and the fault counts do not depend on this.
  _wantLoopGapsUntil: 0,
  // The stall cushion (2026-09-04, #333): how deep the two IPC hops are
  // allowed to run, in ms — the output queue (credit window) and the input
  // ring's target fill. Latency against stall tolerance, one number for both;
  // Settings → Audio, `mubone_audio_cushion`. The estimate in js/latency.js
  // adds it to each side. 10 ms since 2026-09-06 (R1, #338): with the audio
  // host, the grain-major loop, no allocation while recording and the shared
  // candidate tables in, Ek's laptop ran 58 takes at 10 ms with zero
  // cumulative faults. 5 is a choice; the formula floors at two blocks.
  audioCushionMs: 10,

  // ── Max grains (P2, 2026-09-06) ─────────────────────────────────────────
  // Polyphony: how many grains may sound at once, and the size of the glow
  // ring with it. 256 was set in 2026-03 against a grain that cost more than
  // twice what it costs now; the probe's dense scene sat at that ceiling. The
  // choices are 256 / 512 / 1024, Settings → Audio, `mubone_max_grains`. The
  // throttle reads LOAD (the worklet), so this is a ceiling on the sound, not
  // the thing that protects the thread.
  maxGrains: 512,
  recordingSourceNode: null,
  recordingRaw:       null,
  recordingWritePos:  0,
  recordingStartTime: 0,
  liveBufferSampleCount: 0,
  recordingSampleRate: 0,
  micPermissionGranted: false,
  currentLiveBufferIdx: -1,   // index into liveRecBuffers being recorded

  // ── Particle visualisation (audio-feature-driven) ────────────────────
  // When true, particle color/size derived from audio features baked at
  // paint time.  When false, original palette-based colouring is used.
  // THE CANVAS IS DARK, always (Ek, 2026-09-15). This was a setting — a Dark |
  // Light capsule on Settings -> Visuals, for a projector in a lit room — and
  // the option is gone. It stays as a constant only because renderer.js still
  // branches on it in ~25 places and audio-features.js keys a colour cache on
  // it; every one of those light halves is now unreachable, and deleting them
  // is its own pass because it crosses modules (docs/TODO.md).
  darkMode:      true,
  // SET ON THE FIGURE, BY EAR AND BY EYE (Ek, 2026-09-15). These four and the
  // paint gate below are one curve — Settings -> Visuals draws it — and Ek set
  // it by dragging the handles and then asked for what he had as the default.
  // It is a WIDER range than the old 3 -> 22: a 2.8px floor is nearer a speck
  // than a dot, the 36px ceiling is half again as large, and the loudness
  // window is 31 dB rather than 36, so the same playing spans more of the size
  // range. -42 dB and -11 dB, in the unit the figure reads in; the state stays
  // linear because renderer.js wants it linear.
  vizMinSize:    2.8,       // particle min radius (px) — quiet floor, overrides PARTICLE_BASE_SIZE
  vizMaxSize:    36,        // particle max radius (px) — loud ceiling, overrides PARTICLE_MAX_SIZE
  // At the old 120px ceiling a loud grain covered a quarter of the sphere, so
  // paint read as fog and featuresToColor's hue was lost to overlap. Even at 36
  // the RMS→size ratio stays near 13× while grains stop occluding each other.
  // It is the figure's right-hand handle, so this is a default, not a law.
  gazeTrail:     [],        // [{lon, lat, t}] — appended once per frame in the draw pass
  // 2s, not 6 (Ek, 2026-08-29): six seconds of wake is a drawing in its own
  // right, and it was still on screen long after it had stopped saying
  // anything about where the cursor is going. 0 disables entirely.
  gazeTrailSec:  2,         // trail length in seconds; 0 disables entirely
  // ── Camera pull-back ──────────────────────────────────────────────────────
  // How far the camera sits back from the sphere's centre, in RADII. This is a
  // DOLLY, not a zoom: S.fovDeg is the zoom, and no fov value can ever get you
  // outside the sphere.
  //   0    — camera at the centre, looking out. The original inside-sphere
  //          model, and every render path is bit-identical to pre-2026-08-24
  //          at this value.
  //   <1   — still inside, sphere surface closer on the far side
  //   1    — exactly on the surface
  //   >1   — OUTSIDE. The sphere becomes an object with a silhouette.
  // Applied in CAMERA space (after rotation) so it always means "back away
  // along the view axis", identically in all three camera modes.
  //
  // Audio is deliberately untouched by this: the grain search is angular on the
  // sphere surface (grain.js `p._ang`), so pulling back changes what you SEE
  // and never what the cursor REACHES.
  camPull:       0,         // camera distance from centre, in SPHERE_RADIUS units
  // Calibration ranges — raw feature values outside these clip to 0 or 1.
  // Users adjust via the viz panel sliders to match their input level / content.
  // THE GATE SITS JUST UNDER THE RAMP (Ek, 2026-09-15): -44 dB against the
  // ramp's -42, so almost everything that lands is already on the curve rather
  // than piled on the floor. It was -54, a full 8 dB below, which left a band
  // where marks were deposited but could only ever draw at minimum size — the
  // band the figure made visible for the first time. Raising it also means less
  // of the room is painted at all.
  paintGateThreshold: 0.0063,    // -44 dB · RMS below this → particle not created (paint gate)
  vizRmsMin:     0.0079,    // -42 dB · quiet floor (below this → smallest particle)
  vizRmsMax:     0.282,     // -11 dB · loud ceiling (above this → largest particle)
  // ── THE COLOUR LEGEND, FIXED (Ek, 2026-09-13) ─────────────────────────
  // "it should be very predictable so that i see yellow every time and my
  // collaborators see yellow and they know what sound that is."
  //
  // These two are the whole mapping from brightness to hue, and they are
  // CONSTANTS: no sliders, no calibration, and deliberately NOT saved with a
  // profile, so every copy of mubone paints the same sound the same colour and
  // a colour can be a word two people share. They are still on S, so the
  // console can move them for an experiment; nothing in the GUI can.
  //
  // The span is one acoustic instrument's honest range, 200 Hz to 10 kHz —
  // 5.6 octaves, logarithmically (audio-features normaliseCentroid), which is
  // what an experimental vocalist covers from chest tones through open vowels
  // and pressed nasal sounds to fricatives, breath and hiss. Where things land:
  //   250 Hz deep tones 0.06 · 1 kHz open voice 0.41 · 2.2 kHz pressed 0.61
  //   4.5 kHz breath 0.80 · 8.3 kHz cymbal and hiss 0.95 · noise 1.00
  vizCentroidMin: 0.0083,   // 200 Hz — below a chest tone
  vizCentroidMax: 0.4167,   // 10 kHz — above a cymbal
  modeRingSize:  30,        // mode ring radius (px) — controls how big the 4 status arcs are
  uiScale:       1.0,       // UI scale factor — multiplied with base font-size (15px)
  // Canvas HUD scale — multiplied edge bar height, text size, dot size and
  // spacing. Its slider went with the HUD (2026-08-29): the main screen's
  // `.hud` has been display:none since #291, so there was a control in the viz
  // settings for something no longer on screen. ONE reader survives — the
  // projector popup in events.js builds its own `.hud` and hides it at 0 — and
  // that popup now has no control, because the window it mirrors has no HUD to
  // match. Console-only until someone wants the popup HUD back.
  hudScale:      1.0,
  fovDeg:        80,        // field of view (degrees) — match to projector throw for room-anchored use

  // ── Handsfree recording ────────────────────────────────────────────────
  // Pedal-armed auto-record: paint gate segments buffers within toggle-trace.
  // Tap trace on → gate listens → each phrase becomes a separate buffer.
  hfArmed:          false,   // true = handsfree armed (gate segmentation active in toggle-trace)
  hfRecording:      false,   // true = handsfree gate has opened a buffer capture
  hfGateOpen:       false,   // current gate state (after envelope processing)
  paintLatched:     false,   // true = the running gesture was started by a TOGGLE press and
                             // ends on the next press (brush.js gesturePress); never in momentary
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

  // ── Grain period floor ──────────────────────────────────────────────────
  // Mutable period floor — defaults to SCHED_SAFE_PERIOD_S (50µs).
  // With the AudioWorklet grain engine, sub-ms periods are safe.
  minPeriodS: SCHED_SAFE_PERIOD_S,

  // ── Grain params / overrides ───────────────────────────────────────────
  grainParams: null,          // initialised below
  grainOverrides: {
    duration:    null,
    durJitter:   null,   // multiplier randomisation per grain (0–1)
    durVar:      null,   // +/- seconds of duration randomisation per grain
    startJitter: null,   // +/- seconds of read-offset randomisation per grain.
                         // Decouples scrub resolution from marker deposit rate:
                         // lets a grain begin between markers instead of only
                         // on one. 0 = strictly on-marker (previous behaviour).
    fadeRatio:   null,   // attack+release each as fraction of dur (0–0.5)
    fadeMode:    null,   // 'pct' (ramp scales with grain length) | 'ms' (fixed ramp).
                         // Under durJitter every grain is a different length, so
                         // 'pct' gives every grain a different attack; 'ms' keeps
                         // attack character constant. Percussion generally wants 'ms'.
    fadeMs:      null,   // ramp length in seconds when fadeMode === 'ms'
    k:           null,
    period:      null,
    periodVar:   null,   // +/- seconds of period randomisation per onset
    pitchJitter: null,
    pitchShift:  null,   // base pitch shift in cents (±2400 = ±2 octaves)
    panSpread:   null,
    volume:      null,
    retriggerMs: null,   // minimum re-trigger time for seeder grains (ms)
    hpfFreq:     null,   // highpass filter cutoff Hz (20 = off, max 20000)
    lpfFreq:     null,   // lowpass filter cutoff Hz  (20000 = off, min 20)
    hpfQ:        null,   // resonance at the HPF corner (0.1–20, default 0.707)
    lpfQ:        null,   // resonance at the LPF corner (0.1–20, default 0.707)
    filterFreqJitter: null, // per-grain cutoff randomisation (0–1, fraction of freq)
  },
  grainProbability: 1.0,   // 0-1: probability each candidate grain fires per tick
  grainDirection:   'fwd', // 'fwd' | 'rev' | 'rnd'
  grainCurveType:   'hann', // 'hann' | 'tri' | 'rect'

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
  // #14: mute/unmute fade time-constant in seconds (setTargetAtTime τ —
  // perceived fade ≈ 4–5× this value). Default matches the historical 20ms
  // click-guard; raise for a musical fade (e.g. 0.1 ≈ half-second swell).
  // Set live via OSC `/scan/fade <ms>` or console `S.scanFadeS = 0.1`.
  scanFadeS: 0.02,
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
  // dryMonitorMode is the SETTING: off | on | auto (#245). off and on are
  // explicit; auto rests ON and ducks itself while a granular-engine stroke
  // records (hear the granulation forming, not the instrument doubled), but
  // stays ON through a loop-engine take (the take IS the instrument — you play
  // against yourself). dryMonitorEnabled is the EFFECTIVE state the gain node
  // follows; under auto it flips without the setting changing. Always starts
  // OFF — never persisted, never in a setup file — so a rig cannot boot into
  // feedback.
  dryMonitorMode:     'off',
  dryMonitorEnabled:  false,  // effective on/off of the dry spatial layer
  dryMonitorGainValue: 0.5,   // LINEAR 0–2, the gain node's own unit. Both dry
                              // sliders read dB (ui-meters.js _dbOfLin): 0.5 is −6.0 dB,
                              // the same level Master Volume shows, and 2.0 is +6.0.
  dryGainNode:         null,  // GainNode — dry level control
  dryAnalyser:         null,  // AnalyserNode — dry level meter tap
  dryVBAPGains:        null,  // [GainNode, ...] — one per speaker bus (Electron multi-ch)
  dryPanner:           null,  // StereoPanner — stereo path (browser / 2-ch)
  dryMixdownInputs:    null,  // [GainNode L, GainNode R] — dry → headphone mixdown (Electron)

  // ── Output gain + mute ─────────────────────────────────────────────────
  outputGainValue: MASTER_DEFAULT_GAIN,  // linear; -6 dB. Single source: MASTER_DEFAULT_DB above
  isMuted:         false,
  projectorMode:   false,  // true when the mirrored projector popup is open.
                           // The projector column LAYOUT is the default view
                           // (applied once at boot in events.js); this flag
                           // now tracks the popup only, so renderer.js knows
                           // when to mirror each frame.
  projectorPopup:  null,   // popup Window reference for projector mirror
  projectorCtx:    null,   // popup canvas 2D context for mirror blit
  _syncProjectorHUD: null, // per-frame HUD sync callback (set when popup opens)

  // ── Mobile setup gate ──────────────────────────────────────────────────
  _mobileSetupDone: false, // true once orientation + gyro setup completes

  // ── Camera mode ───────────────────────────────────────────────────────────
  // Controls how the 3D sphere camera is ROTATED and where the paint cursor lives.
  // All three are orientation only — camera DISTANCE is camPull, below, and is
  // orthogonal to all of them.
  // 'steer'   — (default) mouse/trackpad offset from centre steers the view, with
  //             dead zone + ease curve. Cursor follows mouse. Alt-lock supported.
  // 'surface' — trackpad surface = flattened sphere map. Finger position → sphere
  //             coordinate directly. Cursor hidden, paint target = canvas center.
  //             Alt-lock supported.
  // 'sensor'  — mubone IMU sensor drives camera quaternion. Cursor hidden,
  //             paint target = canvas center. Alt-lock not needed (mouse is free).
  //
  // RENAMED 2026-08-24: 'pull' → 'steer'. The old name described the gesture
  // (you pull the sphere around) but read as a distance, and camPull now IS a
  // distance in the same panel. One-shot migration in _loadVizCalibration.
  cameraMode: 'steer',  // 'steer' | 'surface' | 'sensor'

  // ── Spatial panning ──────────────────────────────────────────────────────
  // Controls how grain audio is spatialized, independent of camera mode.
  // 'headlocked'  — sound field rotates with the camera (binaural / stereo sim).
  //                  Uses StereoPanner, view-relative grain positions.
  // 'worldlocked' — sounds fixed in room (VBAP). Grain positions are absolute
  //                  world-space, speakers are fixed. Any number of speakers.
  // World-locked is the factory default (Ek, 2026-09-05): the product is the
  // rig, and a fresh profile should pan to the room, not to the camera.
  spatialPanning: 'worldlocked',  // 'headlocked' | 'worldlocked'

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
  // WHICH HARDWARE CHANNELS FEED THE INSTRUMENT (2026-09-14). An array of
  // channel indices; several at once sum to the one mono input the engine
  // takes. `mainInputChannel` is DERIVED from it (the first one sent, or
  // 'stereo' when more than one is) for the few readers that still ask
  // "which channel" — the meter highlight and the sampler's label.
  inputSends: [0],
  mainInputChannel: 0,

  // Physical output channel assignments for the stereo mixdown pair.
  // null = auto (last 2 physical channels of the device: [n-2, n-1]).
  headphoneRouting: null,   // [physChL, physChR] or null  (kept as headphoneRouting for compat)

  // customSpeakerAngles[busIndex] = azimuth in degrees (0–360).
  // null → use computed equal-spacing from speakerAngleDeg().
  // Persisted independently in localStorage (room config, not per-patch).
  customSpeakerAngles: null,

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

// ── Initialise grainParams from the default block (the old `wash`) ───────────
S.grainParams = { ...DEFAULT_GRAIN };

