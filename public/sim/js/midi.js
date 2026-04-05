// ============================================================================
// MIDI + KEYBOARD MAPPING SYSTEM
// ============================================================================

import {
  S,
  PRESETS, SEARCH_RADIUS_MIN, SEARCH_RADIUS_MAX, SEARCH_RADIUS_STEP,
  LIVE_PAINT_COLORS, DEBUG, rebuildGrainCurves,
} from './state.js';
import { ensureAudioContext } from './audio.js';
import { toggleMappingByIndex } from './sensor-mapping.js';
import { startLiveRecording, stopLiveRecording } from './audio.js';
import { toggleHandsfree } from './handsfree.js';
import {
  recordStrokeStart, undoLastStroke,
} from './ui-samples.js';
import {
  toggleNearestMode, plantSeed, startSeedPlant, finalizeSeedPlant, uprootNearestSeed,
  clearAllSeeds, clearAllCommits, clearAllSeqs,
  updatePlaybackControls, flashRadiusTooltip, selectPreset,
  createSeqFromStroke, dropSeqFromCursor, releaseCommit,
} from './ui-presets.js';
import { sweep } from './ui-sweep.js';
import { setMixdownCursorGain, setMixdownHouseGain } from './ui-meters.js';
import { wireSaveDefaultBtn } from './ui-audio-settings.js';
import { setScanMuted } from './ui-meters.js';
import { findNearestSeedSlot } from './grain.js';
import { getCursorLonLat, screenToLonLat } from './sphere.js';

// Each action definition: { id, label, key, osc, type, ccFn? }
// id: null entries are section headers (group: 'label')
// type: 'hold' | 'trigger' | 'cc' (continuous 0-127)
// osc: OSC path string or null
const ACTIONS = [

  // ── Session ────────────────────────────────────────────────────────────────
  { id: null, group: 'session' },
  { id: 'mute',         label: 'system mute',               key: 'M',                 osc: '/mute',              fmt: 'int 0|1',          type: 'trigger',
    tip: 'silence all audio output' },
  { id: 'undo',         label: 'undo last stroke',          key: 'right click / ⌘Z',  osc: '/undo',              fmt: 'bang',             type: 'trigger',
    tip: 'remove the most recently painted stroke from the sphere' },
  { id: 'sweep',        label: 'sweep (remove unused)',     key: '—',                 osc: '/sweep',             fmt: 'bang',             type: 'trigger',
    tip: 'delete all particles not referenced by active seeds or loops' },
  { id: 'erase_all',    label: 'erase all (session)',       key: 'Backspace×3',       osc: '/session/erase',     fmt: 'bang',             type: 'trigger',
    tip: 'erase everything — all particles, commits, and recordings' },

  // ── Patches ────────────────────────────────────────────────────────────────
  { id: null, group: 'patches' },
  { id: 'preset_select', label: 'patch select (1–20)',      key: '1–0, shift+1–0',    osc: '/preset',        fmt: 'int 1–40',          type: 'cc',
    ccFn: v => { const idx = Math.min(PRESETS.length - 1, Math.floor((v / 127) * PRESETS.length)); selectPreset(idx); } },

  // ── Search ─────────────────────────────────────────────────────────────────
  { id: null, group: 'search' },
  { id: 'snap',         label: 'scope (nearest/area)',       key: 'N',                 osc: '/search/scope',   fmt: 'int 0|1',          type: 'trigger',
    tip: 'scope — nearest: fire k closest on whole sphere / area: search within radius + recency' },
  { id: 'k_all',        label: 'fill (all/k)',              key: '—',                 osc: '/search/fill',    fmt: 'int 0|1',          type: 'trigger',
    tip: 'fill — all: fire every particle in radius / k: cap to k nearest (area mode only)' },
  { id: 'k_seq',        label: 'order (step/random)',       key: '—',                 osc: '/search/order',   fmt: 'int 0|1',          type: 'trigger',
    tip: 'step through candidates one at a time in recording order instead of random' },
  { id: 'radius_cc',    label: 'radius',                    key: '—',                 osc: '/search/radius',  fmt: 'float 1–180 °',    type: 'cc',
    ccFn: v => { S.searchRadiusDeg = Math.round(SEARCH_RADIUS_MIN + (v / 127) * (SEARCH_RADIUS_MAX - SEARCH_RADIUS_MIN)); updatePlaybackControls(); flashRadiusTooltip(); } },
  { id: 'radius_inc',   label: 'radius ↑',                  key: 'scroll ↑ / ]',      osc: '/search/radius/inc', fmt: 'bang',          type: 'trigger',
    tip: 'increase search radius by 2°' },
  { id: 'radius_dec',   label: 'radius ↓',                  key: 'scroll ↓ / [',      osc: '/search/radius/dec', fmt: 'bang',          type: 'trigger',
    tip: 'decrease search radius by 2°' },
  { id: 'grain_k',      label: 'k (nearest)',               key: '—',                 osc: '/search/k',       fmt: 'int 1–N',          type: 'cc',
    ccFn: v => { const mx = Math.max(1, S.particles.length); S.grainOverrides.k = Math.max(1, Math.round(1 + (v / 127) * (mx - 1))); S.syncGrainControlsUI?.(); } },
  { id: 'recency_cc',   label: 'recency',                   key: '—',                 osc: '/search/recency', fmt: 'int 1–16,0=all',   type: 'cc',
    ccFn: v => { const raw = Math.round((v / 127) * 17); const n = raw >= 17 ? 0 : Math.max(1, raw); if (typeof S.setRecency === 'function') S.setRecency(n); else S.recencyN = n; } },

  // ── Grain ──────────────────────────────────────────────────────────────────
  { id: null, group: 'grain' },
  { id: 'grain_dur',    label: 'duration',                  key: '—',  osc: '/grain/dur',         fmt: 'float 1–4000 ms',   type: 'cc',
    tip: 'grain length — log scale, 1ms to 4s',
    ccFn: v => { const lo = Math.log(0.001), hi = Math.log(4.0); S.grainOverrides.duration = Math.exp(lo + (v / 127) * (hi - lo)); S.syncGrainControlsUI?.(); } },
  { id: 'grain_durvar', label: 'dur ±',                     key: '—',  osc: '/grain/durvar',      fmt: 'float 0–500 ms',    type: 'cc',
    tip: 'additive duration randomness per grain',
    ccFn: v => { S.grainOverrides.durVar = (v / 127) * 0.5; S.syncGrainControlsUI?.(); } },
  { id: 'grain_durjit', label: 'dur jitter',                key: '—',  osc: '/grain/durjitter',   fmt: 'float 0–1',         type: 'cc',
    tip: 'multiplicative duration randomness — also driven by the wand system',
    ccFn: v => { S.grainOverrides.durJitter = v / 127; S.syncGrainControlsUI?.(); } },
  { id: 'grain_fade',   label: 'fade',                      key: '—',  osc: '/grain/fade',        fmt: 'float 0–50 %',      type: 'cc',
    tip: 'attack + release each as % of grain duration — 0% instant on/off, 50% pure envelope',
    ccFn: v => { S.grainOverrides.fadeRatio = (v / 127) * 0.5; S.syncGrainControlsUI?.(); } },
  { id: 'grain_period', label: 'period',                    key: '—',  osc: '/grain/per',         fmt: 'float 1–4000 ms',   type: 'cc',
    tip: 'time between grain onsets — log scale, 1ms to 4s',
    ccFn: v => { const lo = Math.log(0.001), hi = Math.log(4.0); S.grainOverrides.period = Math.exp(lo + (v / 127) * (hi - lo)); S.syncGrainControlsUI?.(); } },
  { id: 'grain_pervar', label: 'per ±',                     key: '—',  osc: '/grain/pervar',      fmt: 'float 0–500 ms',    type: 'cc',
    tip: 'additive period randomness per onset',
    ccFn: v => { S.grainOverrides.periodVar = (v / 127) * 0.5; S.syncGrainControlsUI?.(); } },
  { id: 'grain_pitchshift', label: 'pitch shift',           key: '—',  osc: '/grain/pitchshift',  fmt: 'float -24–+24 st',  type: 'cc',
    tip: 'base pitch offset in semitones — ±24 (2 octaves)',
    ccFn: v => { S.grainOverrides.pitchShift = ((v / 127) * 48) - 24; S.syncGrainControlsUI?.(); } },
  { id: 'grain_pitch',  label: 'pitch jitter',              key: '—',  osc: '/grain/pitch',       fmt: 'float 0–700 ¢',     type: 'cc',
    tip: 'random pitch spread per grain in cents',
    ccFn: v => { S.grainOverrides.pitchJitter = Math.pow(2, (v / 127) * 700 / 1200) - 1; S.syncGrainControlsUI?.(); } },
  { id: 'grain_prob',   label: 'probability',               key: '—',  osc: '/grain/prob',        fmt: 'float 0–1',         type: 'cc',
    tip: 'chance each grain fires — 0 = never, 1 = always',
    ccFn: v => { S.grainProbability = v / 127; S.syncGrainControlsUI?.(); } },
  { id: 'grain_pan',    label: 'pan spread',                key: '—',  osc: '/grain/pan',         fmt: 'float 0–100 %',     type: 'cc',
    tip: 'stereo spread — 0% mono, 100% full stereo',
    ccFn: v => { S.grainOverrides.panSpread = v / 127; S.syncGrainControlsUI?.(); } },
  { id: 'grain_vol',    label: 'volume',                    key: '—',  osc: '/grain/volume',      fmt: 'float 0–2',         type: 'cc',
    tip: 'grain volume — 1.0 = unity/input parity, max 2.0',
    ccFn: v => { S.grainOverrides.volume = (v / 127) * 2; rebuildGrainCurves(); S.syncGrainControlsUI?.(); } },
  { id: 'grain_dir',    label: 'direction',                 key: '—',  osc: '/grain/dir',         fmt: 'bang',              type: 'trigger',
    tip: 'grain playback direction — cycles fwd → rev → rnd' },
  { id: 'grain_curve',  label: 'envelope curve',            key: '—',  osc: '/grain/curve',       fmt: 'bang',              type: 'trigger',
    tip: 'grain envelope shape — cycles hann → triangle → rectangular' },
  { id: 'grain_retrig', label: 'retrigger (ms)',            key: '—',  osc: '/grain/retrigger',   fmt: 'float 0–500 ms',    type: 'cc',
    tip: 'per-particle cooldown — prevents the same point from firing again within this window',
    ccFn: v => { S.grainOverrides.retriggerMs = (v / 127) * 500; S.syncGrainControlsUI?.(); } },
  { id: 'grain_hpf',    label: 'HPF cutoff',                key: '—',  osc: '/grain/hpf',         fmt: 'float 20–20000 Hz', type: 'cc',
    tip: 'highpass filter cutoff — 20 Hz = off, log scale',
    ccFn: v => { S.grainOverrides.hpfFreq = 20 * Math.pow(1000, v / 127); S.syncGrainControlsUI?.(); } },
  { id: 'grain_lpf',    label: 'LPF cutoff',                key: '—',  osc: '/grain/lpf',         fmt: 'float 20–20000 Hz', type: 'cc',
    tip: 'lowpass filter cutoff — 20 kHz = off, log scale',
    ccFn: v => { S.grainOverrides.lpfFreq = 20 * Math.pow(1000, v / 127); S.syncGrainControlsUI?.(); } },
  { id: 'grain_filterq', label: 'filter Q',                 key: '—',  osc: '/grain/filterq',     fmt: 'float 0.1–20',     type: 'cc',
    tip: 'filter resonance — 0.707 = flat (Butterworth), higher = resonant peak',
    ccFn: v => { S.grainOverrides.filterQ = 0.1 + (v / 127) * 19.9; S.syncGrainControlsUI?.(); } },
  { id: 'grain_fltjit',  label: 'filter jitter',            key: '—',  osc: '/grain/filterjitter', fmt: 'float 0–1',        type: 'cc',
    tip: 'per-grain cutoff randomisation — 0% = static, 100% = ±1 octave',
    ccFn: v => { S.grainOverrides.filterFreqJitter = v / 127; S.syncGrainControlsUI?.(); } },

  // ── Cursor / Scan (S) ─────────────────────────────────────────────────────
  { id: null, group: 'cursor' },
  { id: 'scan_toggle',  label: 'scan on/off (S)',            key: 'S',                 osc: '/cursor/scan',       fmt: 'int 0|1',          type: 'trigger',
    tip: 'toggle scan — cursor spotlight on/off in the house output' },
  { id: 'tare',         label: 'tare / zero (Z)',            key: '`',                 osc: '/cursor/tare',       fmt: 'bang',             type: 'trigger',
    tip: 'zero the cursor sensor — set current orientation as center reference' },
  { id: 'lock_az',      label: 'lock azimuth (toggle)',      key: '—',                 osc: '/cursor/lock_az',    fmt: 'int 0|1',          type: 'toggle',
    tip: 'toggle azimuth lock — freezes horizontal position' },
  { id: 'lock_el',      label: 'lock elevation (toggle)',    key: '—',                 osc: '/cursor/lock_el',    fmt: 'int 0|1',          type: 'toggle',
    tip: 'toggle elevation lock — freezes vertical position' },
  { id: 'mapping_toggle_1', label: 'toggle mapping 1',       key: '—',                 osc: '/mapping/toggle/1',  fmt: 'bang',             type: 'trigger',
    tip: 'toggle the first sensor-to-param mapping on/off' },
  { id: 'mapping_toggle_2', label: 'toggle mapping 2',       key: '—',                 osc: '/mapping/toggle/2',  fmt: 'bang',             type: 'trigger',
    tip: 'toggle the second sensor-to-param mapping on/off' },
  { id: 'mapping_toggle_3', label: 'toggle mapping 3',       key: '—',                 osc: '/mapping/toggle/3',  fmt: 'bang',             type: 'trigger',
    tip: 'toggle the third sensor-to-param mapping on/off' },
  { id: 'mapping_toggle_4', label: 'toggle mapping 4',       key: '—',                 osc: '/mapping/toggle/4',  fmt: 'bang',             type: 'trigger',
    tip: 'toggle the fourth sensor-to-param mapping on/off' },
  { id: 'radius_fade',  label: 'radius fade on/off',        key: '—',                 osc: '/cursor/radiusfade', fmt: 'int 0|1',          type: 'trigger',
    tip: 'attenuate grains by distance from cursor centre' },
  { id: 'radius_fade_curve', label: 'radius fade curve',    key: '—',                 osc: '/cursor/radiusfadecurve', fmt: 'float 0–1',   type: 'cc',
    tip: '0 = gentle linear fade, 1 = steep sharp edge rolloff',
    ccFn: v => { S.radiusFadeCurve = v / 127; S._syncRadiusFadeUI?.(); } },

  // ── Trace (A) ─────────────────────────────────────────────────────────────
  { id: null, group: 'trace (A)' },
  { id: 'recpaint',     label: 'trace (hold/tap)',           key: 'click / space',     osc: '/trace',             fmt: 'int 0|1',          type: 'hold',
    tip: 'hold = momentary record, tap = toggle on/off (handsfree segments when armed)' },
  { id: 'trace_toggle', label: 'trace toggle',               key: '—',                 osc: '/trace/toggle',    fmt: 'bang',             type: 'trigger',
    tip: 'directly toggle trace on/off (no tap timing — ideal for foot pedals)' },
  { id: 'handsfree',   label: 'handsfree arm (H)',          key: 'H',                 osc: '/handsfree',         fmt: 'bang',             type: 'trigger',
    tip: 'toggle handsfree arm — when on, toggle-trace segments buffers by noise gate' },
  { id: 'trace_mode',   label: 'trace mode cycle (A)',      key: 'A',                 osc: '/trace/mode',      fmt: 'bang',                             type: 'trigger',
    tip: 'cycle trace mode: trace → trace+loop → trace+cloud' },

  // ── Commit (D) ────────────────────────────────────────────────────────────
  { id: null, group: 'commit (D)' },
  { id: 'commit_mode',  label: 'commit mode cycle (⇧D)',    key: 'Shift+D',           osc: '/commit/mode',     fmt: 'bang',             type: 'trigger',
    tip: 'cycle commit mode: cloud ↔ loop — what D key creates' },
  { id: 'commit_drop',  label: 'drop commit (tap D)',       key: 'D',                 osc: '/commit/drop',     fmt: 'bang',             type: 'trigger',
    tip: 'drop a stationary cloud or loop at the current cursor position' },
  { id: 'commit_draw',  label: 'draw commit (hold D)',      key: 'hold D',            osc: '/commit/draw',     fmt: 'int 0|1',          type: 'hold',
    tip: 'hold to draw a moving cloud path or record a loop — release to finalize' },
  { id: 'commit_release', label: 'release nearest (⌘D)',    key: '⌘D',               osc: '/commit/release',  fmt: 'bang',             type: 'trigger',
    tip: 'release the nearest commit (cloud or loop) from its slot' },
  { id: 'commit_clear', label: 'clear all commits',         key: '—',                 osc: '/commit/clear',    fmt: 'bang',             type: 'trigger',
    tip: 'remove all clouds and loops from all slots' },
  { id: 'commit_selection', label: 'selection mode (toggle)', key: '—',               osc: '/commit/selection', fmt: 'bang',                 type: 'trigger',
    tip: 'toggle which commit is targeted for release and morph — closest or farthest from cursor' },
  { id: 'commit_slots', label: 'commit slot count',         key: '—',                 osc: '/commit/slots',    fmt: 'int 1–16',         type: 'cc',
    tip: 'number of active commit slots (1–16)',
    ccFn: v => { S.commitSlotCount = Math.max(1, Math.min(16, Math.round(1 + v * 15 / 127))); const sel = document.getElementById('commitSlotCountSelect'); if (sel) sel.value = String(S.commitSlotCount); (S.updateSeedBanksUI || S._syncCommitUI || (() => {}))(); } },
  { id: 'commit_overflow', label: 'commit overflow (cycle)', key: '—',                osc: '/commit/overflow', fmt: 'bang',                   type: 'trigger',
    tip: 'cycle overflow mode: off → oldest → nearest' },
  { id: 'commit_dir',   label: 'commit movement dir',       key: '—',                 osc: '/commit/dir',      fmt: 'bang',                 type: 'trigger',
    tip: 'how moving commits traverse their path — cycles fwd → rev → pingpong' },
  { id: 'commit_volume', label: 'next commit volume',       key: '—',                 osc: '/commit/volume',   fmt: 'float 0–1',        type: 'cc',
    tip: 'volume for the next commit — set before recording',
    ccFn: v => { S.seqNextParams.volume = v / 127; const sl = document.getElementById('seqVolumeSlider'); if (sl) sl.value = S.seqNextParams.volume; const nb = document.getElementById('seqVolumeNum'); if (nb) nb.value = Math.round(S.seqNextParams.volume * 100) + '%'; } },
  { id: 'commit_speed', label: 'next commit speed',         key: '—',                 osc: '/commit/speed',    fmt: 'float 0.25–4×',    type: 'cc',
    tip: 'speed for the next commit — 1× = original, set before recording',
    ccFn: v => { S.seqNextParams.speed = 0.25 + (v / 127) * 3.75; const sl = document.getElementById('seqSpeedSlider'); if (sl) sl.value = S.seqNextParams.speed; const nb = document.getElementById('seqSpeedNum'); if (nb) nb.value = S.seqNextParams.speed.toFixed(2) + '×'; } },
  { id: 'commit_attack', label: 'cloud fade in',             key: '—',                 osc: '/commit/attack',   fmt: 'float 0–10 s',     type: 'cc',
    tip: 'cloud fade-in time — 0s instant, up to 10s swell',
    ccFn: v => { S.seedAttack = (v / 127) * 10; const sl = document.getElementById('seedAttackSlider'); if (sl) sl.value = S.seedAttack; const nb = document.getElementById('seedAttackNum'); if (nb) nb.value = S.seedAttack < 1 ? (S.seedAttack * 1000).toFixed(0) + 'ms' : S.seedAttack.toFixed(1) + 's'; } },
  { id: 'commit_release_time', label: 'cloud fade out',     key: '—',               osc: '/commit/release_time', fmt: 'float 0–10 s',  type: 'cc',
    tip: 'cloud fade-out time — 0s instant, up to 10s fade',
    ccFn: v => { S.seedRelease = (v / 127) * 10; const sl = document.getElementById('seedReleaseSlider'); if (sl) sl.value = S.seedRelease; const nb = document.getElementById('seedReleaseNum'); if (nb) nb.value = S.seedRelease < 1 ? (S.seedRelease * 1000).toFixed(0) + 'ms' : S.seedRelease.toFixed(1) + 's'; } },
  { id: 'loop_release_mode', label: 'loop fade out mode',   key: '—',                 osc: '/commit/loop_release', fmt: 'bang',                 type: 'trigger',
    tip: 'fade = fade out over time, play-to-end = loop finishes current pass then stops' },
  { id: 'loop_fade_time', label: 'loop fade out time',    key: '—',                 osc: '/commit/loop_fade_time', fmt: 'float 0–2000 ms', type: 'cc',
    tip: 'fade-out duration for loops when released — 0ms instant, up to 2000ms',
    ccFn: v => { S.loopFadeTimeMs = Math.round((v / 127) * 2000); const sl = document.getElementById('loopFadeTimeSlider'); if (sl) sl.value = S.loopFadeTimeMs; const nb = document.getElementById('loopFadeTimeNum'); if (nb) nb.value = S.loopFadeTimeMs < 1000 ? S.loopFadeTimeMs + 'ms' : (S.loopFadeTimeMs / 1000).toFixed(1) + 's'; } },
  { id: 'commit_blend', label: 'commit blend mode',         key: '—',                 osc: '/commit/blend',    fmt: 'bang',             type: 'trigger',
    tip: 'all = equal weight, focus = distance-weighted blend toward closest' },
  { id: 'commit_tether', label: 'commit tether',            key: '—',                 osc: '/commit/tether',   fmt: 'int 0|1',          type: 'trigger',
    tip: 'on = commit always plays regardless of cursor distance, off = radius-gated' },
  { id: 'commit_xfade', label: 'commit xfade',              key: '—',                 osc: '/commit/xfade',    fmt: 'float 0–1',        type: 'cc',
    tip: '0 = hard snap to nearest commit, 1 = smooth distance-weighted crossfade',
    ccFn: v => { S.seedXfade = v / 127; S._syncImprovUI?.(); } },

  // ── Cloud Morph ─────────────────────────────────────────────────────────────
  { id: null, group: 'cloud morph' },
  { id: 'morph_cc',        label: 'morph position',            key: '—',                 osc: '/morph/position', fmt: 'float 0–1',        type: 'cc',
    tip: 'cloud morph slider — 0 = left preset, 0.5 = planted center, 1 = right preset',
    ccFn: v => { S._setDesktopMorphT?.(v / 127); } },
  { id: 'morph_sticky',    label: 'morph hold (toggle)',       key: '—',                 osc: '/morph/sticky',   fmt: 'bang',             type: 'trigger',
    tip: 'toggle morph hold — sticky keeps position, return glides back to center' },
  { id: 'morph_return',    label: 'morph return time',         key: '—',                 osc: '/morph/return',   fmt: 'float 50–3000 ms', type: 'cc',
    tip: 'return-to-center glide time when hold is off',
    ccFn: v => { S._setDesktopMorphReturnMs?.(50 + (v / 127) * 2950); } },

  // ── Levels ─────────────────────────────────────────────────────────────────
  { id: null, group: 'levels' },
  { id: 'master_vol',   label: 'master volume',             key: '—',                 osc: '/master/volume',  fmt: 'float -60–+6 dB',  type: 'cc',
    tip: 'master output gain — the master vol slider in audio settings (-60 to +6 dB)',
    ccFn: v => { S._setOutputGainDb?.(-60 + (v / 127) * 66); } },
  { id: 'mixdown_cursor', label: 'headphone cursor level',  key: '—',                 osc: '/mixdown/cursor', fmt: 'float 0–1',        type: 'cc',
    tip: 'cursor grain level in the headphone stereo mix',
    ccFn: v => { setMixdownCursorGain(v / 127); } },
  { id: 'mixdown_house', label: 'headphone house level',    key: '—',                 osc: '/mixdown/house',  fmt: 'float 0–1',        type: 'cc',
    tip: 'house speaker fold-down level in the headphone stereo mix',
    ccFn: v => { setMixdownHouseGain(v / 127); } },
  { id: 'noise_gate',   label: 'noise gate threshold',      key: '—',                 osc: '/gate/threshold', fmt: 'float 0–0.06 RMS', type: 'cc',
    tip: 'noise gate threshold — signal below this RMS level is gated',
    ccFn: v => { S._setNoiseGateThreshold?.(v / 127 * 0.06); } },
  { id: 'dry_gain',    label: 'dry monitor gain',           key: '—',                 osc: '/dry/gain',       fmt: 'float 0–2',        type: 'cc',
    tip: 'spatialized live input level in the house mix (0 = silent, 2 = +6dB)',
    ccFn: v => { S._setDryMonitorGain?.(v / 127 * 2); } },

  // ── Spatial ────────────────────────────────────────────────────────────────
  { id: null, group: 'spatial' },
  { id: 'camera_mode',     label: 'camera mode (cycle)',        key: '—',                 osc: '/camera/mode',      fmt: 'bang',              type: 'trigger',
    tip: 'pull = mouse drag, surface = pointer lock, sensor = IMU input' },
  { id: 'spatial_panning',  label: 'spatial panning (toggle)',   key: '—',                 osc: '/spatial/panning',  fmt: 'bang',              type: 'trigger',
    tip: 'headlocked = stereo follows head, worldlocked = stereo follows sphere position' },
  { id: 'alt_lock',         label: 'freeze sphere (hold)',       key: 'Alt / Opt',         osc: '/spatial/lock',     fmt: 'int 0|1',           type: 'hold',
    tip: 'hold to freeze sphere rotation — cursor stays in place while camera stops' },

  // ── Paint ──────────────────────────────────────────────────────────────────
  { id: null, group: 'paint samples' },
  { id: 'paint1',       label: 'paint sample 1 (hold)',     key: 'Q',                 osc: '/paint/1',        fmt: 'int 0|1',          type: 'hold' },
  { id: 'paint2',       label: 'paint sample 2 (hold)',     key: 'W',                 osc: '/paint/2',        fmt: 'int 0|1',          type: 'hold' },
  { id: 'paint3',       label: 'paint sample 3 (hold)',     key: 'E',                 osc: '/paint/3',        fmt: 'int 0|1',          type: 'hold' },
  { id: 'paint4',       label: 'paint sample 4 (hold)',     key: 'R',                 osc: '/paint/4',        fmt: 'int 0|1',          type: 'hold' },
  { id: 'paint5',       label: 'paint sample 5 (hold)',     key: 'T',                 osc: '/paint/5',        fmt: 'int 0|1',          type: 'hold' },
  { id: 'paint6',       label: 'paint sample 6 (hold)',     key: 'Y',                 osc: '/paint/6',        fmt: 'int 0|1',          type: 'hold' },
  { id: 'paint7',       label: 'paint sample 7 (hold)',     key: 'U',                 osc: '/paint/7',        fmt: 'int 0|1',          type: 'hold' },
  { id: 'paint8',       label: 'paint sample 8 (hold)',     key: 'I',                 osc: '/paint/8',        fmt: 'int 0|1',          type: 'hold' },
  { id: 'paint9',       label: 'paint sample 9 (hold)',     key: 'O',                 osc: '/paint/9',        fmt: 'int 0|1',          type: 'hold' },
  { id: 'paint10',      label: 'paint sample 10 (hold)',    key: 'P',                 osc: '/paint/10',       fmt: 'int 0|1',          type: 'hold' },

  // ── App ────────────────────────────────────────────────────────────────────
  { id: null, group: 'app' },
  { id: 'perf',         label: 'perf monitor',              key: 'p',                  osc: '/app/perf',       fmt: 'int 0|1',          type: 'trigger' },
  { id: 'perfmode',     label: 'high-perf render',          key: 'Shift+P',            osc: '/app/perfmode',   fmt: 'int 0|1',          type: 'trigger' },
  { id: 'darkmode',     label: 'dark / light mode',         key: '—',                  osc: '/app/darkmode',   fmt: 'int 0|1',          type: 'trigger',
    tip: 'toggle dark mode (black background) and light mode (white background)' },
];

// MIDI mappings: { actionId → { type: 'cc'|'note', channel, number } }
let midiMappings = {};
let midiLearningId = null;
let midiAccess = null;

// Key/scroll mappings: { actionId → { key, code, shift, ctrl, meta, type } }
// type: 'key' | 'scroll_up' | 'scroll_down'
let keyMappings = {};
let keyLearningId = null;

function loadKeyMappings() {
  try {
    const saved = localStorage.getItem('mubone_key_map');
    if (saved) keyMappings = JSON.parse(saved);
  } catch(e) { keyMappings = {}; }
}

function saveKeyMappings() {
  try { localStorage.setItem('mubone_key_map', JSON.stringify(keyMappings)); } catch(e) {}
}

// Returns a human-readable label for a key mapping
function keyMappingLabel(km) {
  if (!km) return '';
  if (km.type === 'scroll_up')   return 'scroll ↑';
  if (km.type === 'scroll_down') return 'scroll ↓';
  const parts = [];
  if (km.meta)  parts.push('⌘');
  if (km.ctrl)  parts.push('ctrl');
  if (km.shift) parts.push('shift');
  parts.push(km.key || km.code);
  return parts.join('+');
}

// Remove any existing binding that uses the same key combo (conflict resolution)
function removeConflictingKeyBinding(newMapping, skipId) {
  for (const [id, km] of Object.entries(keyMappings)) {
    if (id === skipId) continue;
    if (km.type === newMapping.type &&
        km.code === newMapping.code &&
        km.shift === newMapping.shift &&
        km.ctrl === newMapping.ctrl &&
        km.meta === newMapping.meta) {
      delete keyMappings[id];
    }
  }
}

function loadMidiMappings() {
  try {
    const saved = localStorage.getItem('mubone_midi_map');
    if (saved) midiMappings = JSON.parse(saved);
  } catch(e) { midiMappings = {}; }
}

function saveMidiMappings() {
  try { localStorage.setItem('mubone_midi_map', JSON.stringify(midiMappings)); } catch(e) {}
}

export async function initMidi() {
  if (!navigator.requestMIDIAccess) return;
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    refreshMidiInputs();
    midiAccess.onstatechange = refreshMidiInputs;
  } catch(e) {
    DEBUG && console.log('MIDI not available:', e.message);
  }
}

function refreshMidiInputs() {
  const inputs = [...midiAccess.inputs.values()];
  const portEl = document.getElementById('midiPortName');
  if (portEl) portEl.textContent = inputs.length ? inputs.map(i => i.name).join(', ') : '—';
  for (const input of inputs) {
    input.onmidimessage = handleMidiMessage;
  }
}

function handleMidiMessage(event) {
  const [status, num, val] = event.data;
  const type    = status >> 4;
  const channel = (status & 0xF) + 1;

  if (midiLearningId !== null) {
    const mapType = (type === 11) ? 'cc' : 'note';
    midiMappings[midiLearningId] = { type: mapType, channel, number: num };
    saveMidiMappings();
    const action = ACTIONS.find(a => a.id === midiLearningId);
    setMappingStatus(`mapped "${action?.label}" → ${mapType.toUpperCase()} ${num} ch${channel}`);
    midiLearningId = null;
    renderMappingTable();
    return;
  }

  for (const action of ACTIONS) {
    if (!action.id) continue;  // skip group headers
    const mapping = midiMappings[action.id];
    if (!mapping) continue;
    const matchCC   = mapping.type === 'cc'   && type === 11 && mapping.number === num && mapping.channel === channel;
    const matchNote = mapping.type === 'note' && type === 9  && mapping.number === num && mapping.channel === channel && val > 0;
    // Note-off for hold actions: status type 8 (noteOff) or type 9 with vel 0
    const matchNoteOff = mapping.type === 'note' && mapping.number === num && mapping.channel === channel &&
      ((type === 8) || (type === 9 && val === 0));
    // For trigger-type actions mapped to CC, only fire on press (val > 0), not release
    if (matchCC && action.type === 'trigger' && val === 0) continue;
    if (matchCC || matchNote) {
      dispatchAction(action.id, matchCC ? val : 127);
    } else if (matchNoteOff && action.type === 'hold') {
      dispatchAction(action.id, 0);
    }
  }
}

// Brief flash on a button element (same 180ms pattern used by undo, commit, etc.)
function _flash(el) {
  if (!el) return;
  el.classList.add('flashing');
  setTimeout(() => el.classList.remove('flashing'), 180);
}

function dispatchAction(id, midiVal) {
  switch(id) {
    case 'recpaint': {
      // Tap-toggle vs hold-momentary: same logic as spacebar/click.
      // val > 0 = press, val === 0 = release.
      if (midiVal > 0) {
        // If already toggled on, this is a tap-off — use canonical cleanup
        if (S._traceToggled) {
          S._stopToggleTrace?.();
        } else if (!S.isPainting) {
          // Press: start painting
          S._traceActive = true;
          S._midiTraceDownAt = performance.now();
          ensureAudioContext(); startLiveRecording();
          recordStrokeStart('live', S.currentLiveBufferIdx);
          S.isPainting = true; S.paintFrameCount = 0;
          S.updateLiveRecUI?.();
        }
      } else if (midiVal === 0) {
        // Release — if toggled, no-op
        if (S._traceToggled) break;
        // Tap detection
        const tapMs = performance.now() - (S._midiTraceDownAt || 0);
        // Only allow toggle in plain trace mode (not trace+loop or trace+cloud)
        if (S._midiTraceDownAt && tapMs < 200 && S.traceMode === 'trace') {
          S._traceToggled = true;
          if (S.hfArmed) {
            S.isPainting = false; S.currentStrokeId = -1;
            if (S.isRecording) stopLiveRecording();
          }
          S.updateLiveRecUI?.(); S._syncHandsfreeUI?.();
          S._midiTraceDownAt = 0;
          break;
        }
        S._midiTraceDownAt = 0;
        // Momentary release: stop painting
        if (S.isPainting) {
          if (S.seqModeEnabled && S.currentStrokeId > 0) {
            try { createSeqFromStroke(S.currentStrokeId); } catch (_) {}
          }
          S.isPainting      = false;
          S.currentStrokeId = -1;
          if (S.isRecording) stopLiveRecording();
          S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
          S.updateLiveRecUI?.();
        }
        S._traceActive = false;
      }
      // Sync trace indicator button with isPainting state (OSC/MIDI path)
      const _traceBtn = document.getElementById('paintIndicatorBtn');
      if (_traceBtn) _traceBtn.classList.toggle('painting', S.isPainting || S._traceToggled);
      break;
    }
    case 'mute':
      if (S._setMuted) S._setMuted(!S.isMuted);
      else S.isMuted = !S.isMuted;
      break;
    case 'scan_toggle':
      // OSC sends 0|1 (0 = off, 1 = on); keys/GUI send 127 → toggle
      if (midiVal === 1)       setScanMuted(false);   // 1 = scan ON
      else if (midiVal === 0)  setScanMuted(true);    // 0 = scan OFF
      else                     setScanMuted(!S.scanMuted); // 127 = toggle
      break;
    case 'tare':
      S._tareCursor?.();
      break;
    case 'erase_all':
      S._sessionEraseAll?.();
      break;
    case 'undo':        undoLastStroke(); break;
    case 'sweep':
      if (S._sessionSweep) S._sessionSweep();
      else sweep();
      break;
    case 'handsfree':
      toggleHandsfree();
      break;

    // ── View ─────────────────────────────────────────────────────────────────
    case 'projector':
      if (S._toggleProjectorMode) S._toggleProjectorMode();
      _flash(document.getElementById('projectorModeBtn'));
      break;

    // ── Trace ───────────────────────────────────────────────────────────────
    case 'trace_toggle': {
      // Direct toggle: no tap-timing required — ideal for foot pedals.
      // Bang toggles trace on/off with same lifecycle as tap-toggle.
      if (S._traceToggled || S.isPainting) {
        // Currently on → turn off
        S._stopToggleTrace?.();
      } else if (S.traceMode === 'trace') {
        // Currently off, plain trace mode → toggle on
        S._traceToggled = true;
        S._traceActive  = true;
        // If handsfree armed, let the gate manage recording segments
        if (S.hfArmed) {
          S.updateLiveRecUI?.(); S._syncHandsfreeUI?.();
        } else {
          // No handsfree — start continuous recording immediately
          ensureAudioContext(); startLiveRecording();
          recordStrokeStart('live', S.currentLiveBufferIdx);
          S.isPainting = true; S.paintFrameCount = 0;
          S.updateLiveRecUI?.();
        }
      }
      const _tb = document.getElementById('paintIndicatorBtn');
      if (_tb) _tb.classList.toggle('painting', S.isPainting || S._traceToggled);
      break;
    }
    case 'trace_mode': {
      // If toggled trace is active, force-stop before mode change
      if (S._traceToggled) {
        S._stopToggleTrace?.();
      }
      const _modes = ['trace', 'trace+loop', 'trace+cloud'];
      const _idx = _modes.indexOf(S.traceMode);
      S.traceMode = _modes[(_idx + 1) % _modes.length];
      _flash(document.getElementById('commitLockBtn'));
      S._syncCommitUI?.();
      break;
    }

    // ── Commit: unified drop/draw/release/clear ─────────────────────────────
    case 'commit_mode': {
      S.commitMode = S.commitMode === 'cloud' ? 'loop' : 'cloud';
      S._syncCommitUI?.();
      break;
    }
    case 'commit_drop':
      if (S.commitMode === 'cloud') plantSeed();
      else                          dropSeqFromCursor();
      _flash(document.getElementById('commitDropBtn'));
      break;
    case 'commit_draw': {
      const _drawBtn = document.getElementById('commitDrawBtn');
      if (S.commitMode === 'cloud') {
        if (midiVal > 0) { startSeedPlant(); if (_drawBtn) _drawBtn.classList.add('painting'); }
        else             { finalizeSeedPlant(); if (_drawBtn) _drawBtn.classList.remove('painting'); }
      } else {
        // Loop arm: reuse existing seq_arm logic
        if (midiVal > 0 && !S.isPainting) {
          if (S.seqOverflow === 'off') {
            let full = true;
            for (let i = 0; i < S.seqSlotCount; i++) { if (!S.seqSlots[i]) { full = false; break; } }
            if (full) break;
          }
          ensureAudioContext();
          S._loopRecPreSeqMode = S.seqModeEnabled;
          S.seqModeEnabled = true;
          if (!S.scanMuted) setScanMuted(true);
          startLiveRecording();
          recordStrokeStart('live', S.currentLiveBufferIdx);
          S.isPainting = true; S.paintFrameCount = 0;
          if (_drawBtn) _drawBtn.classList.add('painting');
          S.updateLiveRecUI?.();
        } else if (midiVal === 0 && S.isPainting) {
          if (S.currentStrokeId > 0) {
            try { createSeqFromStroke(S.currentStrokeId); } catch (_) {}
          }
          S.isPainting      = false;
          S.currentStrokeId = -1;
          if (S.isRecording) stopLiveRecording();
          S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
          if (S._loopRecPreSeqMode !== undefined) {
            S.seqModeEnabled = S._loopRecPreSeqMode;
            S._syncCommitUI?.();
            S._loopRecPreSeqMode = undefined;
          }
          if (_drawBtn) _drawBtn.classList.remove('painting');
          S.updateLiveRecUI?.();
        }
      }
      break;
    }
    case 'commit_release':
      releaseCommit();
      _flash(document.getElementById('commitReleaseBtn'));
      break;
    case 'commit_clear':
      clearAllCommits();
      _flash(document.getElementById('commitClearBtn'));
      break;
    case 'commit_selection': {
      S.selectionMode = S.selectionMode === 'closest' ? 'farthest' : 'closest';
      S._syncImprovUI?.();
      break;
    }
    case 'commit_overflow': {
      const modes = ['off', 'oldest', 'nearest'];
      const curOF = S.seedOverflow || 'off';
      const nextOF = modes[(modes.indexOf(curOF) + 1) % modes.length];
      S.seedOverflow = nextOF;
      S.seqOverflow  = nextOF;
      const seg = document.getElementById('commitOverflowSeg');
      if (seg) seg.querySelectorAll('.grain-seg-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.overflow === nextOF));
      break;
    }
    case 'commit_dir': {
      const cycle = { pingpong: 'forward', forward: 'rev', rev: 'pingpong' };
      S.seedLoopMode = cycle[S.seedLoopMode] ?? 'forward';
      const seg = document.getElementById('seedLoopModeSeg');
      if (seg) seg.querySelectorAll('[data-loopmode]').forEach(b =>
        b.classList.toggle('active', b.dataset.loopmode === S.seedLoopMode));
      break;
    }
    case 'loop_release_mode': {
      S.loopReleaseMode = S.loopReleaseMode === 'fade' ? 'play-to-end' : 'fade';
      const lrSeg = document.getElementById('loopReleaseModeSeg');
      if (lrSeg) lrSeg.querySelectorAll('[data-lrmode]').forEach(b =>
        b.classList.toggle('active', b.dataset.lrmode === S.loopReleaseMode));
      break;
    }
    case 'commit_blend':
      S.seedMode = S.seedMode === 'focus' ? 'all' : 'focus';
      S._syncImprovUI?.();
      break;
    case 'commit_tether':
      S.seedTether = !S.seedTether;
      S._syncImprovUI?.();
      break;

    // ── Cloud Morph ────────────────────────────────────────────────────────
    case 'morph_sticky':
      S._toggleDesktopMorphSticky?.();
      break;

    // ── Search ──────────────────────────────────────────────────────────────
    case 'snap':         toggleNearestMode(); break;
    case 'k_all':
      if (!S.nearestMode) { S.grainKAllMode = !S.grainKAllMode; updatePlaybackControls(); }
      break;
    case 'k_seq':
      S.grainKSeqMode = !S.grainKSeqMode;
      updatePlaybackControls();
      break;
    case 'radius_fade':
      S.radiusFadeEnabled = !S.radiusFadeEnabled;
      S._syncRadiusFadeUI?.();
      break;
    case 'grain_dir': {
      const dirs = ['fwd', 'rev', 'rnd'];
      S.grainDirection = dirs[(dirs.indexOf(S.grainDirection) + 1) % dirs.length];
      S.syncGrainControlsUI?.();
      break;
    }
    case 'grain_curve': {
      const curves = ['hann', 'tri', 'rect'];
      S.grainCurveType = curves[(curves.indexOf(S.grainCurveType) + 1) % curves.length];
      rebuildGrainCurves();
      S.syncGrainControlsUI?.();
      break;
    }
    case 'camera_mode': {
      const modes = ['pull', 'surface', 'sensor'];
      const idx = modes.indexOf(S.cameraMode);
      const next = modes[(idx + 1) % modes.length];
      if (S._setCameraMode) S._setCameraMode(next);
      break;
    }
    case 'spatial_panning':
      if (S._setSpatialPanning) S._setSpatialPanning(S.spatialPanning === 'headlocked' ? 'worldlocked' : 'headlocked');
      break;
    case 'alt_lock':
      if (midiVal > 0 && !S.altLocked) {
        S.altLocked = true;
        S.altFrozenMousePixelX = S.mousePixelX;
        S.altFrozenMousePixelY = S.mousePixelY;
        if (S.cameraMode === 'surface') S._exitSurfaceLock?.();
        const wrapper = document.getElementById('canvasWrapper');
        if (wrapper) { wrapper.style.cursor = 'auto'; S.canvas.style.cursor = 'auto'; }
        const ind = document.getElementById('altLockIndicator');
        if (ind) ind.style.display = '';
      } else if (midiVal === 0 && S.altLocked) {
        S.altLocked = false;
        if (S.cameraMode === 'surface') {
          S._requestSurfaceLock?.();
        } else {
          const wrapper = document.getElementById('canvasWrapper');
          if (wrapper) { wrapper.style.cursor = ''; S.canvas.style.cursor = ''; }
        }
        const ind = document.getElementById('altLockIndicator');
        if (ind) ind.style.display = 'none';
      }
      break;
    case 'lock_az':
    case 'lock_el': {
      if (midiVal === 0) break; // toggle on press only, ignore release
      const stateKey = id === 'lock_az' ? 'axisLockAz' : 'axisLockEl';
      const segId    = id === 'lock_az' ? 'axisLockAzSeg' : 'axisLockElSeg';
      S[stateKey] = !S[stateKey];
      // Clear frozen snapshots so next lock captures fresh position
      if (id === 'lock_az') { S._axisLockFrozenNx = null; S._axisLockFrozenYaw = null; }
      if (id === 'lock_el') { S._axisLockFrozenNy = null; S._axisLockFrozenPitch = null; }
      // Sync UI buttons
      const seg = document.getElementById(segId);
      if (seg) seg.querySelectorAll('.grain-seg-btn').forEach(b =>
        b.classList.toggle('active',
          (b.dataset.val === 'on') === S[stateKey]));
      break;
    }
    case 'mapping_toggle_1': if (midiVal === 0) break; toggleMappingByIndex(0); break;
    case 'mapping_toggle_2': if (midiVal === 0) break; toggleMappingByIndex(1); break;
    case 'mapping_toggle_3': if (midiVal === 0) break; toggleMappingByIndex(2); break;
    case 'mapping_toggle_4': if (midiVal === 0) break; toggleMappingByIndex(3); break;
    case 'perf':
      S.perfMonitorVisible = !S.perfMonitorVisible;
      { const el = document.getElementById('perfMonitor'); if (el) el.style.display = S.perfMonitorVisible ? 'block' : 'none'; }
      break;
    case 'perfmode':
      S.perfMode = !S.perfMode;
      S._syncPerfModeUI?.();
      console.log(`[perf] high-performance render mode ${S.perfMode ? 'ON' : 'OFF'}`);
      break;
    case 'darkmode':
      S.darkMode = !S.darkMode;
      S._syncDarkModeUI?.();
      break;
    case 'radius_dec':
      S.searchRadiusDeg = Math.max(SEARCH_RADIUS_MIN, S.searchRadiusDeg - SEARCH_RADIUS_STEP);
      updatePlaybackControls(); flashRadiusTooltip();
      break;
    case 'radius_inc':
      S.searchRadiusDeg = Math.min(SEARCH_RADIUS_MAX, S.searchRadiusDeg + SEARCH_RADIUS_STEP);
      updatePlaybackControls(); flashRadiusTooltip();
      break;
    default:
      if (id.startsWith('paint')) {
        const n = parseInt(id.replace('paint', ''));
        const idx = n - 1;
        if (midiVal > 0 && !S.isPainting && idx < S.samples.length && S.samples[idx].buffer) {
          // Start sample paint
          ensureAudioContext(); S.activeSampleIndex = idx;
          if (S.seqModeEnabled && !S.scanMuted) S._setMuted?.(false) || setScanMuted?.(true);
          const s = S.samples[idx]; s.grainCursor = s.cropStart * s.duration;
          recordStrokeStart('sample'); S.isPainting = true; S.paintFrameCount = 0;
        } else if (midiVal === 0 && S.isPainting && S.activeSampleIndex === idx) {
          // Stop sample paint
          if (S.seqModeEnabled && S.currentStrokeId > 0) {
            try { createSeqFromStroke(S.currentStrokeId); } catch (_) {}
          }
          S.isPainting = false;
          S.currentStrokeId = -1;
          S.activeSampleIndex = -1;
        }
        // Sync trace indicator for sample paint too
        const _traceBtn2 = document.getElementById('paintIndicatorBtn');
        if (_traceBtn2) _traceBtn2.classList.toggle('painting', S.isPainting);
      }
      // CC actions and any other actions dispatched via ccFn
      { const action = ACTIONS.find(a => a.id === id);
        if (action?.type === 'cc' && action.ccFn) action.ccFn(midiVal); }
      break;
  }
}

// ── Modal UI ─────────────────────────────────────────────────────────────────

function openMappingModal() {
  renderMappingTable();
  document.getElementById('mappingModal').classList.add('open');
}

function closeMappingModal() {
  midiLearningId = null;
  keyLearningId  = null;
  document.getElementById('mappingModal').classList.remove('open');
  setMappingStatus('');
  renderMappingTable();
}

function setMappingStatus(msg) {
  const el = document.getElementById('mappingStatus');
  if (el) el.textContent = msg;
}

function renderMappingTable() {
  const tbody = document.getElementById('mappingTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  for (const action of ACTIONS) {
    // Skip legacy aliases — they still work for existing MIDI maps but don't show in UI
    if (action._legacy) continue;

    // ── Section header row ──────────────────────────────────────────────────
    if (!action.id) {
      const tr = document.createElement('tr');
      tr.className = 'mapping-group-header';
      const th = document.createElement('th');
      th.colSpan = 8;
      th.textContent = action.group;
      tr.appendChild(th);
      tbody.appendChild(tr);
      continue;
    }

    const midiMap    = midiMappings[action.id];
    const keyMap     = keyMappings[action.id];
    const isMidiLearning = midiLearningId === action.id;
    const isKeyLearning  = keyLearningId  === action.id;

    const tr = document.createElement('tr');

    // Function name
    const tdName = document.createElement('td');
    tdName.className = 'fn-name';
    tdName.textContent = action.label;
    if (action.tip) tdName.title = action.tip;
    tr.appendChild(tdName);

    // Keyboard default shortcut
    const tdKey = document.createElement('td');
    if (action.key && action.key !== '—') {
      const badge = document.createElement('span');
      badge.className = 'key-badge';
      badge.textContent = action.key;
      tdKey.appendChild(badge);
    } else {
      tdKey.textContent = '—';
      tdKey.style.color = '#444';
    }
    tr.appendChild(tdKey);

    // Key override (custom binding) — only for trigger/hold actions
    const canKeyLearn = action.type === 'trigger' || action.type === 'hold' || action.type === 'toggle';
    const tdKeyOverride = document.createElement('td');
    tdKeyOverride.className = 'key-cell' + (keyMap ? '' : ' unassigned');
    if (canKeyLearn && keyMap) {
      tdKeyOverride.textContent = keyMappingLabel(keyMap);
    } else {
      tdKeyOverride.textContent = '—';
      tdKeyOverride.style.color = '#444';
    }
    tr.appendChild(tdKeyOverride);

    // Key learn / clear buttons — only for trigger/hold actions
    const tdKeyBtn = document.createElement('td');
    tdKeyBtn.style.whiteSpace = 'nowrap';

    if (canKeyLearn) {
      const keyLearnBtn = document.createElement('button');
      keyLearnBtn.className = 'learn-btn' + (isKeyLearning ? ' learning' : '');
      keyLearnBtn.textContent = isKeyLearning ? 'waiting…' : 'learn';
      keyLearnBtn.addEventListener('click', () => {
        midiLearningId = null;  // cancel any MIDI learn
        if (keyLearningId === action.id) {
          keyLearningId = null;
          setMappingStatus('');
        } else {
          keyLearningId = action.id;
          setMappingStatus(`press a key or scroll to assign "${action.label}"…`);
        }
        renderMappingTable();
      });
      tdKeyBtn.appendChild(keyLearnBtn);

      if (keyMap) {
        const clearBtn = document.createElement('button');
        clearBtn.className = 'clear-midi-btn';
        clearBtn.textContent = '✕';
        clearBtn.title = 'clear key override';
        clearBtn.addEventListener('click', () => {
          delete keyMappings[action.id];
          saveKeyMappings();
          renderMappingTable();
        });
        tdKeyBtn.appendChild(clearBtn);
      }
    }
    tr.appendChild(tdKeyBtn);

    // MIDI assignment
    const tdMidi = document.createElement('td');
    tdMidi.className = 'midi-cell' + (midiMap ? '' : ' unassigned');
    if (midiMap) {
      tdMidi.textContent = `${midiMap.type.toUpperCase()} ${midiMap.number} ch${midiMap.channel}`;
    } else {
      tdMidi.textContent = 'unassigned';
    }
    tr.appendChild(tdMidi);

    // MIDI learn / clear buttons
    const tdMidiBtn = document.createElement('td');
    tdMidiBtn.style.whiteSpace = 'nowrap';

    const midiLearnBtn = document.createElement('button');
    midiLearnBtn.className = 'learn-btn' + (isMidiLearning ? ' learning' : '');
    midiLearnBtn.textContent = isMidiLearning ? 'waiting…' : 'learn';
    midiLearnBtn.addEventListener('click', () => {
      keyLearningId = null;  // cancel any key learn
      if (midiLearningId === action.id) {
        midiLearningId = null;
        setMappingStatus('');
      } else {
        midiLearningId = action.id;
        setMappingStatus(`move a midi control to assign "${action.label}"…`);
        if (!midiAccess) initMidi().then(refreshMidiInputs);
      }
      renderMappingTable();
    });
    tdMidiBtn.appendChild(midiLearnBtn);

    if (midiMap) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'clear-midi-btn';
      clearBtn.textContent = '✕';
      clearBtn.title = 'clear midi assignment';
      clearBtn.addEventListener('click', () => {
        delete midiMappings[action.id];
        saveMidiMappings();
        renderMappingTable();
      });
      tdMidiBtn.appendChild(clearBtn);
    }
    tr.appendChild(tdMidiBtn);

    // OSC path
    const tdOsc = document.createElement('td');
    tdOsc.className = 'osc-path';
    if (action.osc) {
      const badge = document.createElement('span');
      badge.className = 'osc-badge';
      badge.textContent = action.osc;
      tdOsc.appendChild(badge);
    } else {
      tdOsc.textContent = '—';
      tdOsc.style.color = '#444';
    }
    tr.appendChild(tdOsc);

    // Data format
    const tdFmt = document.createElement('td');
    tdFmt.className = 'osc-fmt';
    if (action.fmt) {
      tdFmt.textContent = action.fmt;
    } else {
      tdFmt.textContent = '—';
      tdFmt.style.color = '#444';
    }
    tr.appendChild(tdFmt);
    tbody.appendChild(tr);
  }
}

// ── Modal setup (called from init) ───────────────────────────────────────────

export function setupMappingModal() {
  loadMidiMappings();
  loadKeyMappings();

  // Patch recency CC fn to also redraw the dial
  const recEntry = ACTIONS.find(a => a.id === 'recency_cc');
  if (recEntry) {
    const orig = recEntry.ccFn;
    recEntry.ccFn = v => { orig(v); S.drawRecencyDial?.(); };
  }

  document.getElementById('mappingClose')?.addEventListener('click', closeMappingModal);
  document.getElementById('mappingModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('mappingModal')) closeMappingModal();
  });
  document.getElementById('clearAllMidi')?.addEventListener('click', () => {
    midiMappings = {};
    saveMidiMappings();
    renderMappingTable();
    setMappingStatus('all midi mappings cleared');
  });
  document.getElementById('clearAllKeys')?.addEventListener('click', () => {
    keyMappings = {};
    saveKeyMappings();
    renderMappingTable();
    setMappingStatus('all key overrides cleared');
  });

  // ── Key learn: capture keydown while learning ────────────────────────────
  // Non-overridable keys that should not be captured
  const BLOCKED_KEYS = new Set(['Escape', 'Tab', 'F5', 'F11', 'F12']);

  document.addEventListener('keydown', e => {
    if (keyLearningId === null) return;

    // Escape cancels learning (don't close modal)
    if (e.key === 'Escape') {
      keyLearningId = null;
      setMappingStatus('');
      renderMappingTable();
      e.stopImmediatePropagation();
      return;
    }

    if (BLOCKED_KEYS.has(e.key)) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    const newMapping = {
      type:  'key',
      key:   e.key,
      code:  e.code,
      shift: e.shiftKey,
      ctrl:  e.ctrlKey,
      meta:  e.metaKey,
    };

    removeConflictingKeyBinding(newMapping, keyLearningId);
    keyMappings[keyLearningId] = newMapping;
    saveKeyMappings();

    const action = ACTIONS.find(a => a.id === keyLearningId);
    setMappingStatus(`mapped "${action?.label}" → ${keyMappingLabel(newMapping)}`);
    keyLearningId = null;
    renderMappingTable();
  }, true);  // capture phase — runs before events.js handlers

  // ── Key learn: capture scroll while learning ─────────────────────────────
  document.addEventListener('wheel', e => {
    if (keyLearningId === null) return;

    // Hold actions need a release event — scroll has no release, so block it
    const learningAction = ACTIONS.find(a => a.id === keyLearningId);
    if (learningAction?.type === 'hold') {
      setMappingStatus(`scroll can't be assigned to hold actions — press a key instead`);
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const dir = e.deltaY > 0 ? 'scroll_down' : 'scroll_up';
    const newMapping = {
      type: dir,
      key: null, code: null, shift: false, ctrl: false, meta: false,
    };

    removeConflictingKeyBinding(newMapping, keyLearningId);
    keyMappings[keyLearningId] = newMapping;
    saveKeyMappings();

    const action = ACTIONS.find(a => a.id === keyLearningId);
    setMappingStatus(`mapped "${action?.label}" → ${keyMappingLabel(newMapping)}`);
    keyLearningId = null;
    renderMappingTable();
  }, { capture: true, passive: false });

  // Expose modal open/close via S so events.js and ui-presets.js can call them
  S.openMappingModal  = openMappingModal;
  S.closeMappingModal = closeMappingModal;

  // Expose key mappings and dispatch for events.js to intercept
  S._keyMappings    = keyMappings;
  S._dispatchAction = dispatchAction;
  S._isKeyLearning  = () => keyLearningId !== null;
  S._holdActionIds  = new Set(ACTIONS.filter(a => a.type === 'hold').map(a => a.id));
  S._activeHoldKeyMap = new Map();  // code → actionId for held custom-bound keys

}
