// ============================================================================
// exp-init.js — Bootstrap for experimental modules
// Only loaded when ?exp is in the URL.  Add new experiment imports here.
//
// NOTE: The worklet grain engine was promoted to always-on in main.js (Phase 5).
// This file now only contains exp-specific overrides and test utilities.
// ============================================================================

import { S, PRESETS, saveUserPresets } from '../state.js';
import { ensureAudioContext } from '../audio.js';
import { rebuildSampleListUI } from '../ui-samples.js';
import { initExpToggles, expToggleState } from './exp-toggles.js';

/**
 * Generate a sine wave AudioBuffer and insert it into sampler slot 0 (Q key).
 * Duration: 2 seconds. Frequency: 440Hz (A4).
 */
function _loadSineIntoSlotQ() {
  const actx = ensureAudioContext();
  if (!actx) return;

  const sr = actx.sampleRate;
  const duration = 2;          // 2 seconds — enough for any grain window
  const freq = 440;            // A4
  const length = sr * duration;
  const buf = actx.createBuffer(1, length, sr);
  const data = buf.getChannelData(0);

  for (let i = 0; i < length; i++) {
    data[i] = Math.sin(2 * Math.PI * freq * i / sr);
  }

  const sineSlot = {
    buffer:     buf,
    name:       '~ sine 440Hz',
    duration:   duration,
    grainCursor: 0,
    cropStart:  0,
    cropEnd:    1,
  };

  // Insert at index 0, pushing existing samples down
  S.samples.unshift(sineSlot);
  rebuildSampleListUI();
  console.log('[exp] sine 440Hz loaded into slot Q');
}

/**
 * Load a clean-conditions test patch into user slot 1 (PRESETS[0]).
 * k=1, zero variation on all params, moderate duration/period for clear grain identity.
 * Only writes if the slot is still the default empty "user 1" — won't overwrite
 * user-saved patches.
 */
function _loadTestPatch() {
  const slot = PRESETS[0];
  // Don't overwrite if user has already saved something meaningful here
  if (slot.name && slot.name !== 'user 1' && slot.name !== '~ test') return;

  PRESETS[0] = {
    name:             '~ test',
    userDefined:      true,
    // ── Clean conditions: k=1, zero variation ──
    nearestMode:      true,       // nearest single particle
    grainKAllMode:    false,
    grainKSeqMode:    false,
    k:                1,
    searchRadiusDeg:  15,         // tight radius for focused testing
    recencyN:         0,          // no recency filter
    // ── Grain shape ──
    duration:         0.100,      // 100ms — short, clear grain
    durVar:           0,          // no duration variation
    durJitter:        0,          // no duration jitter
    fadeRatio:        0.40,       // 40% fade — smooth but audible onset
    period:           0.080,      // 80ms = 12.5 grains/sec — moderate density
    periodVar:        0,          // no period variation
    // ── Pitch ──
    pitchShift:       0,          // no pitch shift
    pitchJitter:      0,          // no pitch randomisation
    // ── Spatial ──
    panSpread:        0,          // no pan spread — mono centre
    // ── Level ──
    volume:           0.85,
    probability:      1.0,        // every onset fires
    // ── Playback ──
    direction:        'fwd',
    curveType:        'hann',
    // ── Filter ──
    hpfFreq:          20,         // off
    lpfFreq:          20000,      // off
    filterQ:          0.707,      // flat
    filterFreqJitter: 0,          // no jitter
  };

  saveUserPresets();
  console.log('[exp] test patch loaded into slot 1 (k=1, zero variation)');
}

export async function initExp() {
  // Mark experimental mode on state so other modules can check at runtime
  S.exp = true;

  // NOTE: Period floor (S.minPeriodS) is now 50µs by default — no exp override needed.
  // Scheduler cap overrides (_expMaxGrainNodes, etc.) are no longer relevant
  // since the worklet engine handles all grain synthesis with its own 256-slot pool.

  // Show a subtle indicator so you know exp mode is on
  const badge = document.createElement('span');
  badge.textContent = 'exp';
  badge.style.cssText = `
    position:fixed; top:4px; left:50%; transform:translateX(-50%);
    font:10px/1 monospace; color:#e8a030; opacity:0.6;
    pointer-events:none; z-index:9999;
  `;
  document.body.appendChild(badge);

  // ── Test patch in user slot 1 ─────────────────────────────────────────
  _loadTestPatch();

  // ── Sine wave in sampler slot Q ───────────────────────────────────────
  _loadSineIntoSlotQ();

  // ── Exp toggles panel ───────────────────────────────────────────────────
  initExpToggles();
  window.expToggles = expToggleState;

  console.log('[exp] experimental mode active — expToggles() for current feature state');
}
