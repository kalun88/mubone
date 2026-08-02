// ============================================================================
// X-IMU LED FEEDBACK — configurable RGB feedback on the cursor-assigned x-IMU3.
//
// The LED is the performer's only glanceable status surface once they're away
// from the screen, so what it shows is mapped rather than hardcoded: every
// state and every event below has a user-editable colour + pattern, edited in
// the LED modal (`ui-led-map.js`) and persisted to localStorage.
//
// Two row kinds:
//
//   STATES  — held baselines. Exactly one is active at a time on the cursor
//             device, resolved by _currentStateId() from trace / hands-free /
//             gate flags. Non-cursor x-IMU3s always sit at solid idle.
//
//   EVENTS  — transient sequences fired by a `mubone-led` CustomEvent, then
//             the baseline resumes. An event interrupts a running baseline
//             pattern; the baseline restarts when the sequence finishes.
//
// ── Why patterns are driven from here, not the device ───────────────────────
// The x-IMU3 firmware exposes `{colour:"#RRGGBB"}` (static, any hex) and
// `{blink:null}` (a fixed white strobe with no colour or rate control). There
// is no "blink this colour at this rate" command, so every on edge and every
// off edge of a pattern is a message we send. Costs, per active pattern:
//
//   solid  0 msg/s     flash  ~9.5 msg/s     slow  3 msg/s
//   fast   10 msg/s    pulse  ~6.7 msg/s
//
// For WiFi sensors these share the radio with inbound data frames. That is
// survivable — the flash sequences have always run at ~9.5 msg/s — but it is
// worth knowing: 1.7 shipped a bug where `_paintBaselines()` wrote to *every*
// connected sensor on *every* state change, ~30 msg/s across three sensors,
// and the readings started dropping samples. Two defences remain from that
// fix and should stay:
//
//   1. `_lastSent` dedupe — a colour is only sent if it differs from the last
//      value pushed to that device.
//   2. Only the cursor device ever animates. Others get one idle write.
//
// The modal shows each row's msg/s so a glitchy session can be diagnosed by
// looking at the table rather than rediscovering this from scratch.
//
// Patterns also stop when the tab is hidden (we'd otherwise freeze mid-cycle
// on a throttled timer and leave the LED stuck on an arbitrary phase).
// ============================================================================

import { S } from './state.js';
import { getDevices, sendCommandTo } from './imu-setup.js';
import { normalise } from './audio-features.js';

const ENABLED_KEY = 'mubone-ximu-led-feedback';
const MAP_KEY     = 'mubone-ximu-led-map';

const CLR_OFF = '#000000';

// ── Timbre tracking ────────────────────────────────────────────────────────
// The `timbre` pattern paints the LED with the same colour the visualiser gives
// the grains the cursor is currently firing, so sweeping across the sphere reads
// as a colour change on the sensor in your hand: bass regions blue, bright
// regions orange, noisy material desaturated.
//
// Source is `S._cursorPool` — the scheduler's candidate pool, published once
// per tick by grain.js. See the long note above _sampleCursorTimbre() for why
// it's the pool rather than the grains that are actually sounding.
//
// Cost control, in order of effect:
//   1. Hue is quantised to TIMBRE_HUE_STEPS. Holding still, or drifting within
//      one step, sends nothing — the existing `_lastSent` dedupe swallows it.
//   2. TIMBRE_STEP_MS floors the sample interval, so the worst case (sweeping
//      hard across the whole range) is the same 10 msg/s as a fast blink.
//   3. Only the cursor device is ever painted, as with every other pattern.
const TIMBRE_STEP_MS   = 100;   // sampler interval → 10 Hz ceiling
const TIMBRE_HUE_STEPS = 24;    // 15° buckets across the 220° range
// Smoothing time constant, in ms. Small enough that a deliberate move reads as
// immediate (~2τ to settle), large enough that pool churn doesn't jitter the
// hue. Raise for calmer, lower for twitchier.
const TIMBRE_TAU_MS    = 90;

// LED-optimised rather than a faithful port of featuresToHSL(). Two reasons the
// screen values don't survive the trip: the viz washes noisy material to 35%
// saturation, which on an emitter reads as plain white; and this emitter's white
// point drags everything toward cyan (the 1.7 notes record several failed
// attempts at a "blue" that always came out cyan). So saturation is compressed
// into a high, narrow band and lightness is pinned below the screen's 62% —
// a lit LED is already perceptually bright, and 62% just desaturates it further.
const TIMBRE_SAT_MAX = 100;
const TIMBRE_SAT_MIN = 62;
const TIMBRE_LIT     = 50;

// ── Palette ────────────────────────────────────────────────────────────────
// Ten colours chosen to stay distinguishable from each other on a small RGB
// emitter at low brightness in a dim room, plus black for "off". The emitter's
// white point pushes everything toward cyan-white, which is why there is no
// pure blue here (1.7 tried repeatedly to land "joycon home-button blue" and
// it always read as cyan) and why the reds are desaturated rather than #F00 —
// full-saturation red reads as an alarm on stage.
export const LED_PALETTE = [
  { hex: '#555555', name: 'grey'   },
  { hex: '#CC1A1A', name: 'red'    },
  { hex: '#A04000', name: 'orange' },
  { hex: '#C8A000', name: 'amber'  },
  { hex: '#9DE38B', name: 'green'  },
  { hex: '#00A86B', name: 'jade'   },
  { hex: '#1E90D0', name: 'cyan'   },
  { hex: '#3B4FC8', name: 'indigo' },
  { hex: '#8A3FC0', name: 'violet' },
  { hex: '#D04A8C', name: 'pink'   },
  // Reads slightly cyan on this emitter (its white point isn't neutral), but
  // it's still unmistakably the brightest, least-hued thing the LED can do.
  { hex: '#FFFFFF', name: 'white'  },
  { hex: '#000000', name: 'off'    },
];

// ── Patterns ───────────────────────────────────────────────────────────────
// `states` / `events` flag which row kinds may select each pattern. `solid`
// is meaningless for a transient event; `flash` is meaningless as a baseline.
export const LED_PATTERNS = {
  solid:  { label: 'solid',  states: true,  events: false },
  flash:  { label: 'flash',  states: false, events: true,  onMs: 90,  offMs: 120 },
  slow:   { label: 'slow',   states: true,  events: true,  onMs: 333, offMs: 333 },
  fast:   { label: 'fast',   states: true,  events: true,  onMs: 100, offMs: 100 },
  pulse:  { label: 'pulse',  states: true,  events: true,  steps: 8,  cycleMs: 1200 },
  // Timbre isn't a pattern in the same sense as the others — it's a colour
  // *source*, and it only means anything for the one state where the cursor is
  // actually granulating. `rows` restricts it to that row rather than letting
  // it show up on undo or slots-full, where it could never do anything.
  timbre: { label: 'timbre', states: false, events: false, rows: ['scan'], stepMs: TIMBRE_STEP_MS },

  // Interleave: alternate the row's own colour with the live scan timbre
  // instead of with black. The LED then carries two facts at once — "you are
  // muted" *and* "here's what you'd be hearing if you weren't". Costs exactly
  // the same as plain slow/fast (two messages per cycle); the off-phase is just
  // a different colour. Excluded from the scan row, where it would be timbre
  // interleaved with itself.
  slow_timbre: { label: 'slow ⇄ timbre', states: true, events: false, notRows: ['scan'], onMs: 333, offMs: 333, alt: 'timbre' },
  fast_timbre: { label: 'fast ⇄ timbre', states: true, events: false, notRows: ['scan'], onMs: 100, offMs: 100, alt: 'timbre' },
};

// Does this pattern put the live timbre colour on the LED?
export function usesTimbre(pattern) {
  return pattern === 'timbre' || LED_PATTERNS[pattern]?.alt === 'timbre';
}

// Which patterns a given row may use. `rows` pins a pattern to specific rows;
// `notRows` excludes it from some. Otherwise fall back to the kind flags.
export function patternsFor(rowId, kind) {
  return Object.entries(LED_PATTERNS).filter(([, p]) => {
    if (p.rows) return p.rows.includes(rowId);
    if (p.notRows?.includes(rowId)) return false;
    return kind === 'state' ? p.states : p.events;
  });
}

// Messages per second a pattern costs while running. Surfaced in the modal.
// For timbre this is the *ceiling*, not the actual cost: hue is quantised, so
// holding still sends nothing at all and only movement across a hue step pays.
export function patternRate(pattern) {
  const p = LED_PATTERNS[pattern];
  if (!p || pattern === 'solid') return 0;
  if (pattern === 'timbre') return 1000 / p.stepMs;
  if (pattern === 'pulse')  return p.steps / (p.cycleMs / 1000);
  // Interleaves land here too — two edges per cycle, same as plain slow/fast.
  // Swapping black for a timbre colour costs nothing extra on the wire.
  return 2 / ((p.onMs + p.offMs) / 1000);
}

// ── Row registry ───────────────────────────────────────────────────────────
// Listed lowest-priority first, matching _currentStateId()'s fallthrough, so
// the modal reads top-to-bottom as the precedence stack.
export const LED_STATES = [
  { id: 'idle',         label: 'idle',                 tip: 'nothing happening — also what every non-cursor x-IMU3 shows' },
  { id: 'scan',         label: 'scan (cursor firing)',
    tip: 'scan is on and there are particles under the cursor. Lowest priority — every other state overrides it. The only row that can take its colour from the audio: set its pattern to "timbre".' },
  { id: 'mute',         label: 'system muted',
    tip: 'master output muted. Beats scan (it explains the silence) but loses to recording and erasing — you already know you muted it, whereas the take is the thing you need confirmed.' },
  { id: 'erase',        label: 'erasing',              tip: 'erase brush is down (held or latched). Destructive, so it outranks mute.' },
  { id: 'trace',        label: 'trace armed',          tip: 'manual trace — every moment is recording. Outranks mute so tracking into a muted rig still shows the take is running.' },
  { id: 'trace_hf',     label: 'hands-free armed',     tip: 'hands-free trace armed, noise gate still closed' },
  { id: 'trace_hf_rec', label: 'hands-free recording', tip: 'hands-free trace, gate open — capturing audio right now' },
];

export const LED_EVENTS = [
  { id: 'commit',    label: 'commit / plant seed' },
  { id: 'release',   label: 'release / pick up'   },
  { id: 'undo',      label: 'undo'                },
  { id: 'full',      label: 'slots full (rejected)', tip: 'commit refused because every slot is taken and overflow is off' },
  { id: 'identify',  label: 'identify / connect',    tip: 'the blink on connect and on cursor role-switch — this one fires on the named device, not necessarily the cursor' },
  // Not `mute` — that's the state row for *being* muted. This is the toggle.
  { id: 'mute_toggle', label: 'mute toggled on/off' },
  { id: 'tare',      label: 'tare / zero'         },
  { id: 'patch',     label: 'patch change'        },
  { id: 'sweep',     label: 'sweep'               },
  { id: 'erase_all', label: 'erase all'           },
  // Not `scan` — that's the state row for the cursor actually granulating.
  // This is the toggle action, matching midi.js's `scan_toggle` action id.
  { id: 'scan_toggle', label: 'scan toggled on/off' },
  { id: 'snapshot',  label: 'snapshot capture'    },
];

export const LED_ROW_KIND = new Map([
  ...LED_STATES.map(r => [r.id, 'state']),
  ...LED_EVENTS.map(r => [r.id, 'event']),
]);

// Defaults reproduce the 1.7 hardcoded behaviour exactly for the rows that
// existed then, so turning the modal on changes nothing until it's edited.
const DEFAULTS = {
  // Idle is black — LED off. A dark sensor is the quietest thing on a stage and
  // makes any colour that does appear unambiguous. Disabling this row is a
  // different thing: that releases the override and hands the LED back to the
  // firmware's own mode colour.
  idle:         { colour: '#000000', pattern: 'solid', count: 1, enabled: true },
  // Colour here is only the fallback for when the pattern isn't timbre.
  scan:         { colour: '#00A86B', pattern: 'timbre', count: 1, enabled: true },
  erase:        { colour: '#FFFFFF', pattern: 'fast',  count: 1, enabled: true },
  // White alternating with the live timbre: tells you the output is dead and
  // what you'd be hearing if it weren't, in one blink. Slow against erase's
  // fast — they share a colour, so tempo is what separates them.
  mute:         { colour: '#FFFFFF', pattern: 'slow_timbre', count: 1, enabled: true },
  trace:        { colour: '#CC1A1A', pattern: 'pulse', count: 1, enabled: true },
  trace_hf:     { colour: '#A04000', pattern: 'solid', count: 1, enabled: true },
  trace_hf_rec: { colour: '#CC1A1A', pattern: 'solid', count: 1, enabled: true },

  commit:    { colour: '#9DE38B', pattern: 'flash', count: 1, enabled: true },
  release:   { colour: '#9DE38B', pattern: 'flash', count: 2, enabled: true },
  undo:      { colour: '#000000', pattern: 'flash', count: 1, enabled: true },
  full:      { colour: '#9DE38B', pattern: 'flash', count: 5, enabled: true },
  identify:  { colour: '#CC1A1A', pattern: 'flash', count: 3, enabled: true },
  // New rows default off — they'd otherwise turn a quiet LED into a strobe
  // the first time the app updates.
  mute_toggle: { colour: '#D04A8C', pattern: 'flash', count: 1, enabled: false },
  tare:      { colour: '#1E90D0', pattern: 'flash', count: 1, enabled: false },
  patch:     { colour: '#8A3FC0', pattern: 'flash', count: 1, enabled: false },
  sweep:     { colour: '#C8A000', pattern: 'flash', count: 2, enabled: false },
  erase_all: { colour: '#CC1A1A', pattern: 'flash', count: 3, enabled: false },
  scan_toggle: { colour: '#00A86B', pattern: 'flash', count: 1, enabled: false },
  snapshot:  { colour: '#3B4FC8', pattern: 'flash', count: 1, enabled: false },
};

// ── Module state ───────────────────────────────────────────────────────────
let _enabled     = false;
let _map         = {};
let _cursorSn    = null;
let _traceArmed  = false;
let _traceHf     = false;
let _hfRecording = false;
let _eraseHeld   = false;
let _muted       = false;
let _pollTimer   = null;

let _patTimer    = null;   // baseline pattern — setTimeout chain, one handle
let _patPhase    = 0;
let _seqBusy     = false;  // an event sequence owns the LED right now
let _seqEpoch    = 0;      // bumped to cancel an in-flight sequence

// Last event the engine was asked to run, and whether it actually reached the
// LED. The modal shows this live: "I hit commit and nothing happened" is
// otherwise indistinguishable between a disabled row, no cursor sensor, and a
// genuinely broken dispatch — this names which one it was.
let _lastEvent = { id: null, at: 0, fired: false, why: '' };

const _enabledListeners = new Set();

// ── Persistence ────────────────────────────────────────────────────────────
function _loadPersisted() {
  try { _enabled = localStorage.getItem(ENABLED_KEY) === 'on'; }
  catch (_) { _enabled = false; }

  _map = {};
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(MAP_KEY) || '{}') || {}; }
  catch (_) { saved = {}; }

  // Merge over defaults per-field so a row added in a later version picks up
  // its default rather than vanishing from a stale saved map.
  for (const [id, def] of Object.entries(DEFAULTS)) {
    const s = saved[id] || {};
    _map[id] = {
      colour:  typeof s.colour  === 'string'  ? s.colour  : def.colour,
      pattern: LED_PATTERNS[s.pattern]        ? s.pattern : def.pattern,
      count:   Number.isFinite(s.count)       ? Math.max(1, Math.min(5, s.count | 0)) : def.count,
      enabled: typeof s.enabled === 'boolean' ? s.enabled : def.enabled,
    };
    // Guard against a pattern that isn't legal for this row kind (e.g. a saved
    // map from before a pattern was restricted).
    const kind = LED_ROW_KIND.get(id);
    const p    = LED_PATTERNS[_map[id].pattern];
    if (kind === 'state' && !p.states) _map[id].pattern = def.pattern;
    if (kind === 'event' && !p.events) _map[id].pattern = def.pattern;
  }
}

function _persistEnabled() {
  try { localStorage.setItem(ENABLED_KEY, _enabled ? 'on' : 'off'); } catch (_) {}
}
function _persistMap() {
  try { localStorage.setItem(MAP_KEY, JSON.stringify(_map)); } catch (_) {}
}

// ── Colour maths ───────────────────────────────────────────────────────────
function _scaleHex(hex, f) {
  const n = parseInt((hex || '#000000').slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >>  8) & 255) * f);
  const b = Math.round(( n        & 255) * f);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// Raised cosine — starts dim, peaks mid-cycle, returns. Floor at 0.15 rather
// than 0 so the pulse reads as breathing rather than blinking.
function _pulseFactor(step, steps) {
  return 0.15 + 0.85 * (0.5 - 0.5 * Math.cos((2 * Math.PI * step) / steps));
}

function _hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if      (h <  60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  const to = v => Math.round((v + m) * 255);
  return '#' + ((to(r) << 16) | (to(g) << 8) | to(b)).toString(16).padStart(6, '0');
}

// ── Timbre sampler ─────────────────────────────────────────────────────────
// Driven by the 10 Hz state poll, not a timer of its own — see _pollTraceState.
let _timbreCent  = 0.5;    // smoothed, normalised
let _timbreZcr   = 0.5;
let _timbreSeen  = false;  // have we ever had audio to look at?
let _timbreAt    = 0;      // timestamp of the last EMA advance
let _lastTimbreHex = null; // last colour actually sent, for the modal's swatch
let _timbreGrains  = 0;    // grains inside the radius at the last sample
let _scanActive    = false;// cursor is granulating right now (with release hold)
let _scanHoldUntil = 0;
let _lastScan      = false;// last value _applyBaseline() was run against

// Short hold so the state doesn't chatter at the radius boundary. Much shorter
// than it used to be: the pool is stable frame to frame, so this only covers
// a particle or two crossing the edge, not gaps between grain onsets.
const SCAN_HOLD_MS  = 150;
const POOL_STALE_MS = 120;   // pool older than this = scheduler has stopped
const POOL_MAX      = 96;    // cap the walk; strided beyond this

// ── Why the pool, and not the grains that are actually sounding ─────────────
// The first version averaged `activeGrainMap` — the particles audibly firing.
// That coupled the LED's update rate to grain *duration*, which spans three
// orders of magnitude, and produced exactly the two symptoms reported:
//
//   short grains (dur ~5 ms) — each glow entry lives ~5 ms, so a 10 Hz sample
//     almost always lands between them. The map reads empty, the state drops
//     to idle, and the LED blinks colour/black a few times a second.
//   long grains (dur ~seconds) — entries linger, so the average stays full of
//     material the cursor has already moved away from, and the colour lags.
//
// The scheduler's candidate pool has neither problem. It's "the particles the
// cursor would fire from right now", rebuilt every tick (20 ms) regardless of
// grain length, so the colour tracks the cursor rather than the grain clock.
// It's also what the performer means by "the spot I'm on": the spot is yellow
// because the material there is yellow, not because of which 5 ms grain
// happened to fire at the instant we looked.
//
// Weighting is proximity × RMS. `p._ang` is the angular distance the pool build
// already computed, so the spotlight falloff is free — particles at the centre
// of the radius dominate, which makes small movements read immediately instead
// of waiting for the pool membership to turn over.
function _sampleCursorTimbre() {
  const pool = S._cursorPool;
  const age  = performance.now() - (S._cursorPoolAt ?? 0);
  if (!pool || !pool.length || age > POOL_STALE_MS) { _timbreGrains = 0; return null; }

  const radRad = Math.max(1e-3, (S.searchRadiusDeg ?? 10) * Math.PI / 180);
  const step   = pool.length > POOL_MAX ? Math.ceil(pool.length / POOL_MAX) : 1;

  let wSum = 0, cSum = 0, zSum = 0, n = 0;
  for (let i = 0; i < pool.length; i += step) {
    const p = pool[i];
    // Skip particles with no analysis rather than folding them in as zeros —
    // a zero centroid is a valid "deep bass" reading, so counting featureless
    // particles would drag the whole average to blue instead of being ignored.
    const rms = p.rms ?? 0;
    if (rms <= 0) continue;
    // Cosine-ish falloff on angle: 1 at the cursor, 0 at the radius edge.
    const prox = Math.max(0, 1 - (p._ang ?? 0) / radRad);
    const w = rms * (0.15 + 0.85 * prox * prox);
    wSum += w;
    cSum += w * (p.centroid ?? 0);
    zSum += w * (p.zcr ?? 0);
    n++;
  }
  _timbreGrains = n;
  if (wSum <= 0) return null;
  return {
    centroid: normalise(cSum / wSum, S.vizCentroidMin, S.vizCentroidMax),
    zcr:      Math.max(0, Math.min(1, zSum / wSum)),
  };
}

// Advance the smoothing filter. Split from the colour read so the UI can ask
// for the current colour without secretly making the LED track faster whenever
// the modal happens to be open.
function _advanceTimbre(f) {
  const now = performance.now();
  // Time-constant EMA rather than a fixed per-sample coefficient. A fixed
  // coefficient makes the response depend on how often we happen to be called,
  // which is the class of bug this whole section is fixing.
  const dt = _timbreSeen ? Math.min(500, now - _timbreAt) : Infinity;
  const k  = _timbreSeen ? 1 - Math.exp(-dt / TIMBRE_TAU_MS) : 1;
  _timbreAt   = now;
  _timbreCent = _timbreCent + (f.centroid - _timbreCent) * k;
  _timbreZcr  = _timbreZcr  + (f.zcr      - _timbreZcr)  * k;
  _timbreSeen = true;
}

// Same centroid→hue mapping as featuresToHSL() so the LED and the screen agree
// on pitch/brightness; saturation and lightness are remapped for the emitter.
// Pure — no side effects, safe to call from anywhere.
function _timbreHex() {
  if (!_timbreSeen) return null;
  const rawHue  = 240 - _timbreCent * 220;         // matches featuresToHSL()
  const stepDeg = 220 / TIMBRE_HUE_STEPS;
  const hue     = Math.round(rawHue / stepDeg) * stepDeg;
  const sat     = TIMBRE_SAT_MAX - _timbreZcr * (TIMBRE_SAT_MAX - TIMBRE_SAT_MIN);
  return _hslToHex(hue, sat, TIMBRE_LIT);
}

// Timbre only if it reflects something happening *now*. `_timbreHex()` alone
// keeps returning the last smoothed value forever once it's seen audio, which
// would leave an interleave alternating against a stale colour long after the
// cursor moved off everything.
function _liveTimbreHex() {
  return _timbreGrains > 0 ? _timbreHex() : null;
}

// Read-only for the modal's live swatch.
export function currentTimbreColour() { return _lastTimbreHex; }

// Why the LED isn't showing a timbre colour, for the modal's readout. Every
// stage of this can fail silently, so name the stage rather than leaving the
// user to guess between "no sensor", "no audio" and "broken".
//
// Resolved against the *winning* state rather than the scan row, because the
// interleave patterns put timbre on rows other than scan — while muted on
// `fast ⇄ timbre`, timbre is live even though scan lost the precedence.
export function timbreStatus() {
  // `used` drives whether the modal shows this readout at all.
  const used = LED_STATES.some(r => _map[r.id]?.enabled && usesTimbre(_map[r.id].pattern));
  if (!used)             return { used: false, ok: false, why: 'no row set to timbre' };
  if (!_enabled)         return { used, ok: false, why: 'feedback off' };
  if (!_findCursorDev()) return { used, ok: false, why: 'no cursor x-imu3' };

  const st    = _currentStateId();
  const cfg   = _map[st];
  const label = LED_STATES.find(r => r.id === st)?.label ?? st;

  // The winning state doesn't use timbre — expected whenever an action state
  // outranks scan, so name the winner rather than implying a fault.
  if (!cfg || !usesTimbre(cfg.pattern)) return { used, ok: false, why: `overridden by ${label}` };

  if (S.scanMuted)        return { used, ok: false, why: 'scan muted' };
  if (_timbreGrains <= 0) return { used, ok: false, why: 'no particles in radius' };
  return { used, ok: true, why: '', grains: _timbreGrains, hex: _lastTimbreHex, state: label };
}

// ── Device helpers ─────────────────────────────────────────────────────────
function* _allXimuDevices() {
  for (const dev of getDevices().values()) {
    // Only x-IMU3 transports have a colour command. OSC sensors (from the Max
    // bridge) don't, so skip them.
    if (dev.transport === 'udp' || dev.transport === 'serial') yield dev;
  }
}

function _findDev(sn) {
  if (!sn) return null;
  for (const d of _allXimuDevices()) if (d.sn === sn) return d;
  return null;
}
function _findCursorDev() { return _findDev(_cursorSn); }

const _lastSent = new Map();  // sn → hex string (or null for cleared)

function _setColour(dev, hex) {
  if (_lastSent.get(dev.sn) === hex) return;     // dedupe — see header
  _lastSent.set(dev.sn, hex);
  try { sendCommandTo(dev, { colour: hex }); } catch (_) {}
}
// Animation frames must land even when the value repeats a previous write.
function _forceColour(dev, hex) {
  _lastSent.delete(dev.sn);
  _setColour(dev, hex);
}
function _clearColour(dev) {
  if (_lastSent.get(dev.sn) === null) return;
  _lastSent.set(dev.sn, null);
  try { sendCommandTo(dev, { colour: null }); } catch (_) {}
}

// ── Baseline resolution ────────────────────────────────────────────────────
// Precedence, highest first. The rule: what you are *doing* outranks the
// conditions you are doing it under.
//
//   actions      trace / hands-free / erase   — you are mid-gesture
//   conditions   mute                         — the rig is in a mode
//   readouts     scan                         — what happens to be under you
//
// Recording beats mute because recording into a muted rig is a real workflow
// (tracking in the dark) and the LED is the only confirmation the take is
// happening — you already know you muted it. Erase beats mute on the same
// logic, and it's destructive, so it should never be masked.
//
// Mute still beats scan: granulating is true most of the time during a set, so
// letting it mask "the output is dead" would hide the thing that explains the
// silence. Add new action states above `mute`, new conditions below it.
function _currentStateId() {
  if (_traceArmed && _traceHf && _hfRecording) return 'trace_hf_rec';
  if (_traceArmed && _traceHf)                 return 'trace_hf';
  if (_traceArmed)                             return 'trace';
  if (_eraseHeld)                              return 'erase';
  if (_muted)                                  return 'mute';
  if (_scanActive)                             return 'scan';
  return 'idle';
}

// A disabled state falls back to idle rather than to the firmware default —
// "I don't want the LED reacting to trace" almost always means "leave it at
// idle", not "hand it back to the firmware mid-performance". Disabling idle
// itself is the escape hatch that releases the override entirely.
function _baselineCfg(dev) {
  const idle = _map.idle;
  if (dev.sn !== _cursorSn) return idle.enabled ? { ...idle, pattern: 'solid' } : null;
  const cfg = _map[_currentStateId()];
  if (cfg && cfg.enabled) return cfg;
  return idle.enabled ? idle : null;
}

// The colour a device should sit at right now, resolving `timbre` to the live
// audio colour rather than the row's (unused) swatch. Used wherever a single
// static colour is needed — event off-phases, parking on tab-hide.
function _baselineColour(dev) {
  const cfg = _baselineCfg(dev);
  if (!cfg) return null;
  if (cfg.pattern === 'timbre' && dev.sn === _cursorSn) {
    return _lastTimbreHex || cfg.colour;
  }
  return cfg.colour;
}

// ── Baseline pattern driver ────────────────────────────────────────────────
function _stopPattern() {
  if (_patTimer !== null)    { clearTimeout(_patTimer);   _patTimer = null; }
}

// Abandon any in-flight event sequence and free the mutex. The sequence's own
// loop notices the epoch change and unwinds; this makes the LED responsive
// again immediately rather than after its remaining awaits drain.
function _cancelSequence() {
  _seqEpoch++;
  _seqBusy = false;
}

function _startPattern(dev, cfg) {
  _patPhase = 0;
  const p = LED_PATTERNS[cfg.pattern];

  // Timbre has no timer of its own — the 10 Hz state poll drives it. All this
  // needs to do is land the current colour immediately so entering the scan
  // state doesn't wait up to 100 ms for the next tick.
  if (cfg.pattern === 'timbre') {
    const hex = _timbreHex();
    if (hex) { _lastTimbreHex = hex; _setColour(dev, hex); }
    else     _setColour(dev, cfg.colour);   // nothing sampled yet — fall back
    return;
  }

  if (cfg.pattern === 'pulse') {
    const stepMs = p.cycleMs / p.steps;
    const tick = () => {
      const f = _pulseFactor(_patPhase++ % p.steps, p.steps);
      _forceColour(dev, _scaleHex(cfg.colour, f));
      _patTimer = setTimeout(tick, stepMs);
    };
    tick();
    return;
  }

  const tick = () => {
    const on = (_patPhase++ % 2) === 0;
    // Interleaved patterns swap the off-phase for the live timbre. Falls back
    // to black when there's nothing under the cursor, so "muted and pointing at
    // empty sphere" reads as a plain white blink rather than freezing on a
    // stale colour.
    const off = p.alt === 'timbre' ? (_liveTimbreHex() ?? CLR_OFF) : CLR_OFF;
    _forceColour(dev, on ? cfg.colour : off);
    _patTimer = setTimeout(tick, on ? p.onMs : p.offMs);
  };
  tick();
}

// Push baselines to every device. Only the cursor animates; everyone else gets
// a single solid idle write that the dedupe map collapses to once per session.
function _applyBaseline() {
  _stopPattern();
  if (!_enabled || _seqBusy) return;

  for (const dev of _allXimuDevices()) {
    const cfg = _baselineCfg(dev);
    if (!cfg) { _clearColour(dev); continue; }
    if (cfg.pattern === 'solid' || dev.sn !== _cursorSn) _setColour(dev, cfg.colour);
    else _startPattern(dev, cfg);
  }
}

function _releaseAll() {
  _stopPattern();
  for (const dev of _allXimuDevices()) _clearColour(dev);
  _lastSent.clear();
}

// ── Event sequences ────────────────────────────────────────────────────────
function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// The off-phase of an event returns to the baseline colour rather than black,
// so a flash reads as a blip layered on the current state instead of the LED
// dropping out. `undo` gets its blink-to-black by mapping black as its *on*
// colour, which still works under this scheme.
function _eventOffColour(dev) {
  return _baselineColour(dev) ?? CLR_OFF;
}

function _noteEvent(id, fired, why) {
  _lastEvent = { id, at: performance.now(), fired, why: why || '' };
}

async function _runEvent(id, snOverride = null, overrides = null) {
  if (!_enabled)               { _noteEvent(id, false, 'feedback off');  return; }
  const base = _map[id];
  if (!base)                   { _noteEvent(id, false, 'unknown row');   return; }
  if (!base.enabled)           { _noteEvent(id, false, 'row off');       return; }
  const cfg = overrides ? { ...base, ...overrides } : base;

  const dev = snOverride ? _findDev(snOverride) : _findCursorDev();
  if (!dev)                    { _noteEvent(id, false, 'no cursor x-imu3'); return; }
  if (_seqBusy)                { _noteEvent(id, false, 'busy');          return; }

  _noteEvent(id, true, '');
  _seqBusy = true;
  _seqEpoch++;
  const epoch = _seqEpoch;
  _stopPattern();          // an event interrupts a running baseline pattern
  try {
    const p = LED_PATTERNS[cfg.pattern] || LED_PATTERNS.flash;
    const n = Math.max(1, Math.min(5, cfg.count || 1));

    for (let i = 0; i < n; i++) {
      // Bail if the sequence was cancelled mid-flight (tab hidden, feedback
      // switched off). Without this a backgrounded tab throttles the awaits to
      // ~1 Hz and the mutex stays held for the whole stretched-out sequence,
      // silently dropping every event until it finally unwinds.
      if (epoch !== _seqEpoch || !_enabled) break;
      if (cfg.pattern === 'pulse') {
        const stepMs = p.cycleMs / p.steps;
        for (let s = 0; s < p.steps; s++) {
          _forceColour(dev, _scaleHex(cfg.colour, _pulseFactor(s, p.steps)));
          await _delay(stepMs);
        }
      } else {
        _forceColour(dev, cfg.colour);
        await _delay(p.onMs);
        _forceColour(dev, _eventOffColour(dev));
        if (i < n - 1) await _delay(p.offMs);
      }
    }
  } finally {
    // Only release the mutex if we still own it — a cancelled sequence must not
    // clear the flag out from under whichever sequence replaced it.
    if (epoch === _seqEpoch) {
      _seqBusy = false;
      _applyBaseline();    // state may have changed during the sequence
    }
  }
}

// ── Inbound events ─────────────────────────────────────────────────────────
// One generic event for every row: `mubone-led` with { id }. `identify` also
// carries { sn, count } so it can target a named device.
function _onLedEvent(e) {
  const d = e.detail || {};
  if (!d.id || !LED_ROW_KIND.has(d.id)) return;
  const overrides = Number.isFinite(d.count) ? { count: d.count } : null;
  _runEvent(d.id, d.sn || null, overrides);
}

// ── Cursor tracking ────────────────────────────────────────────────────────
function _onSensorStatus(detail) {
  const devices = detail?.devices || [];
  const cursor  = devices.find(d => d.role === 'cursor' && d.feeding);
  const prevSn  = _cursorSn;
  _cursorSn = cursor?.sn || null;

  // A cursor sensor just arrived (including at boot, where the restored
  // registry fires this once) — arm feedback. A sensor with a dark LED reads
  // as a dead sensor, so "connected" is the state where feedback is wanted;
  // off is the exception, and it lasts until the next connect rather than
  // persisting past it. Fires on the null → sn TRANSITION only, so it doesn't
  // fight the toggle on every subsequent status event.
  if (_cursorSn && !prevSn && !_enabled) {
    setXimuLedEnabled(true);   // applies the baseline itself
    return;
  }

  // Repaint unconditionally — a newly-connected x-IMU3 would otherwise sit at
  // its firmware default. The dedupe map makes the redundant case free.
  _applyBaseline();
}

// ── State polling (cheap, 10 Hz) ───────────────────────────────────────────
// One timer resolves the whole baseline: trace flags, whether the cursor is
// granulating, and — when the scan row is on timbre — the colour itself. The
// timbre sampler used to be a second interval started by the pattern driver,
// but scan-vs-idle now *depends* on the grain count, so it has to be sampled
// every tick regardless of which row is active. One timer, one source of truth.
function _pollTraceState() {
  const armed     = !!(S._traceToggled || S.isPainting);
  const hf        = armed && !!S.hfArmed;
  const recording = hf && !!S.hfRecording;
  // Covers both the held brush and the latching toggle — erase.js sets
  // S.eraseHeld for both, and clears it if the input drops mid-hold.
  const erasing   = !!S.eraseHeld;
  const muted     = !!S.isMuted;

  // Sample the cursor's pool. Only worth doing when the feature is on and a
  // sensor is listening — otherwise this is pure waste on every tick.
  const wantScan = _enabled && !!_cursorSn;
  let f = null;
  if (wantScan) {
    f = _sampleCursorTimbre();          // also updates _timbreGrains
    const now = performance.now();
    // Scan requires audible playback: the pool is still built while scan is
    // muted (the sphere keeps glowing) but the performer hears nothing, so the
    // LED shouldn't claim playback.
    if (_timbreGrains > 0 && !S.scanMuted) {
      _scanActive    = true;
      _scanHoldUntil = now + SCAN_HOLD_MS;
    } else if (now > _scanHoldUntil) {
      _scanActive = false;
    }
    if (f) _advanceTimbre(f);
  } else if (_scanActive) {
    _scanActive = false;
  }

  const scan    = _scanActive;
  const changed = armed    !== _traceArmed || hf    !== _traceHf
               || recording!== _hfRecording || scan !== _lastScan
               || erasing  !== _eraseHeld   || muted!== _muted;

  // Commit the flags before resolving, so _currentStateId() and _applyBaseline()
  // both see the same world. Resolve once and use that everywhere below —
  // reading a raw flag instead of the resolved state is what let the timbre
  // repaint paint over the trace colour.
  _traceArmed  = armed;
  _traceHf     = hf;
  _hfRecording = recording;
  _eraseHeld   = erasing;
  _muted       = muted;
  _lastScan    = scan;

  if (changed) { _applyBaseline(); return; }

  // Unchanged state, but `scan` on timbre tracks colour continuously. Gate on
  // the *resolved* state: scan is the lowest-priority row, so any action state
  // — recording, erasing, muted — must suppress this entirely.
  if (_seqBusy || _currentStateId() !== 'scan') return;
  if (_map.scan?.pattern !== 'timbre' || !_map.scan?.enabled) return;

  // `_setColour` (not `_forceColour`) so the dedupe swallows a held cursor —
  // that's what keeps this from being a constant 10 msg/s.
  const dev = _findCursorDev();
  const hex = _timbreHex();
  if (dev && hex) { _lastTimbreHex = hex; _setColour(dev, hex); }
}

// ── Public API (consumed by ui-led-map.js) ─────────────────────────────────
export function isXimuLedEnabled() { return _enabled; }

export function setXimuLedEnabled(on) {
  const next = !!on;
  if (next === _enabled) return;
  _enabled = next;
  _persistEnabled();
  _cancelSequence();     // don't let a mid-flight flash paint over the change
  if (_enabled) _applyBaseline();
  else          _releaseAll();
  for (const cb of _enabledListeners) { try { cb(_enabled); } catch (_) {} }
}

export function onLedEnabledChange(cb) { _enabledListeners.add(cb); }

export function getLedMap() { return _map; }

export function setLedEntry(id, patch) {
  if (!_map[id]) return;
  Object.assign(_map[id], patch);
  _persistMap();
  _applyBaseline();
}

export function resetLedMap() {
  for (const [id, def] of Object.entries(DEFAULTS)) _map[id] = { ...def };
  _persistMap();
  _applyBaseline();
}

// Fire a row's sequence on demand from the modal's test button. States have no
// sequence of their own, so testing one flashes it as a 2× burst to preview
// the colour without disturbing the real baseline for long.
export function testLedEntry(id) {
  if (!_enabled) return;
  const kind = LED_ROW_KIND.get(id);
  if (kind === 'event') { _runEvent(id); return; }
  const cfg = _map[id];
  if (cfg) _previewState(cfg);
}

async function _previewState(cfg) {
  const dev = _findCursorDev();
  if (!dev || _seqBusy) return;
  _seqBusy = true;
  _seqEpoch++;
  const epoch = _seqEpoch;
  _stopPattern();
  try {
    if (cfg.pattern === 'solid') {
      for (let i = 0; i < 2; i++) {
        if (epoch !== _seqEpoch || !_enabled) break;
        _forceColour(dev, cfg.colour);  await _delay(320);
        _forceColour(dev, CLR_OFF);     await _delay(160);
      }
    } else {
      // Run the actual pattern for ~2 seconds so slow/pulse are legible.
      const p = LED_PATTERNS[cfg.pattern];
      const end = performance.now() + 2000;
      let phase = 0;
      while (performance.now() < end) {
        if (epoch !== _seqEpoch || !_enabled) break;
        if (cfg.pattern === 'pulse') {
          const stepMs = p.cycleMs / p.steps;
          _forceColour(dev, _scaleHex(cfg.colour, _pulseFactor(phase++ % p.steps, p.steps)));
          await _delay(stepMs);
        } else {
          const on = (phase++ % 2) === 0;
          _forceColour(dev, on ? cfg.colour : CLR_OFF);
          await _delay(on ? p.onMs : p.offMs);
        }
      }
    }
  } finally {
    if (epoch === _seqEpoch) {
      _seqBusy = false;
      _applyBaseline();
    }
  }
}

// Is there a cursor x-IMU3 to talk to? The modal greys out its test buttons
// when there isn't, rather than silently doing nothing.
export function hasCursorDevice() { return !!_findCursorDev(); }

// ── Live introspection (the modal's activity readout) ──────────────────────
// The defaults deliberately reproduce the pre-1.11 hardcoded palette, which
// makes "is the table actually driving this, or is old code still running?"
// impossible to answer by looking at the LED. These two let the modal show its
// own work: which state row is live right now, and what the last event did.
export function getActiveStateId() { return _enabled ? _currentStateId() : null; }
export function getLastEvent()     { return _lastEvent; }

// ── Public entry ───────────────────────────────────────────────────────────
export function initXimuLedFeedback() {
  _loadPersisted();

  window.addEventListener('sensor-status', (e) => _onSensorStatus(e.detail));
  window.addEventListener('mubone-led', _onLedEvent);

  _pollTimer = setInterval(_pollTraceState, 100);

  // A hidden tab gets its timers throttled to ~1 Hz, which would leave a
  // pattern frozen on whatever phase it happened to be in. Park on the solid
  // baseline colour instead and resume on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      _stopPattern();
      _cancelSequence();
      if (!_enabled) return;
      const dev = _findCursorDev();
      if (dev) { const c = _baselineColour(dev); if (c) _forceColour(dev, c); }
    } else {
      _applyBaseline();
    }
  });

  // If the feature was left on across reloads, paint baselines on startup.
  // Deferred a tick so sensor-status has time to fire with the restored
  // cursor assignment.
  setTimeout(() => { if (_enabled) _applyBaseline(); }, 250);
}
