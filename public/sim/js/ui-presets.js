// ============================================================================
// UI — GRAIN CONTROLS, SEED BANKS, RADIUS VIZ
// ============================================================================

import {
  S, perf,
  COMMIT_COLORS, MAX_COMMITS,
  SEED_COLORS, MAX_SEEDS, COMMIT_DRAW_THRESHOLD_MS, MOVING_SEED_THRESHOLD_MS,
  gp, minGrainDurS, SEARCH_RADIUS_MIN, SEARCH_RADIUS_MAX, SEARCH_RADIUS_STEP, K_MAX
} from './state.js';
import { resolveGrainParams } from './brush-voicing.js';
import { angleBetweenSphere, findNearestSeedSlot, nearestLoopPin, masterPhaseWall, startOverdubLayer, swapOverdubLayer, stopOverdubLayers, releaseSeqNodes } from './grain.js';
import { ensureAudioContext, requestMicAccess, setMicBtnLabel } from './audio.js';
import { screenToLonLat, getCursorLonLat } from './sphere.js';
import { applySparsePreset, syncAllUI } from './param-registry.js';
import { getMappings } from './sensor-mapping.js';
import { pinAnchorInto } from './pins.js';
import * as history from './history.js';

// ── Recency slider constants (module-level so both setupPresets & initGrainControls see them)
const RECENCY_MIN = 1, RECENCY_MAX = 16;
const RECENCY_SLIDER_ALL = RECENCY_MAX + 1;   // slider position for "all"

// ── Shared time formatter (seconds → human-readable ms/s string) ─────────────
export function fmtMs(v) {
  const ms = v * 1000;
  if (ms >= 1000)  return (ms / 1000).toFixed(2) + 's';
  if (ms < 0.01)   return ms.toFixed(4) + 'ms';
  if (ms < 0.1)    return ms.toFixed(3) + 'ms';
  if (ms < 1)      return ms.toFixed(2) + 'ms';
  if (ms < 100)    return ms.toFixed(2) + 'ms';
  return Math.round(ms) + 'ms';
}

// ── Sample-exact period: threshold, display, snapping ───────────────────────
// Threshold: 1 render quantum (128 samples = 2.67ms @48kHz).
// Below this, ±1 sample makes an audible pitch step — the grain onset rate
// is in pitched territory and every integer sample count is a distinct note
// (harmonic series of the sample rate: sr/N Hz for period N).
const _SAMPLE_EXACT_THRESHOLD = 128;  // samples — one render quantum

function _fmtPeriodSmart(v) {
  const sr = S.audioCtx?.sampleRate ?? 48000;
  const samples = Math.round(v * sr);
  if (samples <= _SAMPLE_EXACT_THRESHOLD && samples > 0) {
    const hz = sr / samples;
    // Compact format to fit narrow numboxes
    if (hz >= 1000) return `${samples}smp ${(hz / 1000).toFixed(1)}k`;
    return `${samples}smp ${Math.round(hz)}Hz`;
  }
  return fmtMs(v);
}

// Step by ±1 sample (arrow keys in sample-exact zone).
function _stepPeriodBySamples(currentSeconds, direction) {
  const sr = S.audioCtx?.sampleRate ?? 48000;
  const currentSamples = Math.round(currentSeconds * sr);
  const newSamples = Math.max(1, currentSamples + direction);
  return newSamples / sr;
}

// ── Setup ──────────────────────────────────────────────────────────────────
// Once the patch bank's home (its buttons, dropdown, save, view toggle — all
// sunset 2026-09-03, sandbox/sunset-2026-09-03/patch-bank.js); what is left
// wires the cabinet's scope, fill, order, radius, recency and mic controls.
export function setupPresets() {
  S._updatePlaybackControls = updatePlaybackControls;   // param-registry.js syncAllUI
  // Scope toggle — nearest / area
  updatePlaybackControls();
  const snapSeg = document.getElementById('snapToggleSeg');
  if (snapSeg) {
    snapSeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        S.nearestMode = (btn.dataset.snap === 'on');
        // fill=all is incompatible with nearest — force it off
        if (S.nearestMode && S.grainKAllMode) S.grainKAllMode = false;
        updatePlaybackControls();
        S._syncRadiusFadeUI?.();
        flashRadiusTooltip();
      });
    });
  }

  // Fill toggle — all / k (area mode only, hidden when nearest)
  const kAllSeg = document.getElementById('kAllSeg');
  if (kAllSeg) {
    kAllSeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        S.grainKAllMode = (btn.dataset.kall === 'on');
        updatePlaybackControls();
      });
    });
  }

  // Order toggle — step / random
  const kSeqSeg = document.getElementById('kSeqSeg');
  if (kSeqSeg) {
    kSeqSeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        S.grainKSeqMode = (btn.dataset.kseq === 'on');
        updatePlaybackControls();
        S._updateWorkletParams?.({ kSeqMode: S.grainKSeqMode });
      });
    });
  }

  // ── Recency slider ────────────────────────────────────────────────────────
  const recencyValEl    = document.getElementById('recencyVal');
  const recencySliderEl = document.getElementById('recencySlider');
  // RECENCY_MIN, RECENCY_MAX, RECENCY_SLIDER_ALL are module-level constants

  // keep S.drawRecencyDial a no-op so renderer.js call is safe
  S.drawRecencyDial = function() {};

  S.setRecency = function(n) {
    // 0 (or <=0) = "all" — no recency filter
    if (n <= 0) {
      S.recencyN = 0;
      if (recencySliderEl) recencySliderEl.value = RECENCY_SLIDER_ALL;
      if (recencyValEl)    recencyValEl.value    = 'all';
    } else {
      S.recencyN = Math.max(RECENCY_MIN, Math.min(RECENCY_MAX, n));
      if (recencySliderEl) recencySliderEl.value = S.recencyN;
      if (recencyValEl)    recencyValEl.value    = S.recencyN;
    }
  };

  if (recencySliderEl) {
    recencySliderEl.value = S.recencyN === 0 ? RECENCY_SLIDER_ALL : S.recencyN;
    let _recencyTimerId = null;
    recencySliderEl.addEventListener('input', () => {
      if (_recencyTimerId === null)
        _recencyTimerId = setTimeout(() => {
          _recencyTimerId = null;
          const raw = parseInt(recencySliderEl.value);
          S.setRecency(raw >= RECENCY_SLIDER_ALL ? 0 : raw);
        }, 50);
    });
  }

  // editable recency numbox — parse on commit
  if (recencyValEl) {
    recencyValEl.value = S.recencyN === 0 ? 'all' : S.recencyN;
    recencyValEl.addEventListener('focus', e => e.target.select());
    recencyValEl.addEventListener('blur', () => {
      const raw = recencyValEl.value.trim().toLowerCase();
      if (raw === 'all' || raw === '0') { S.setRecency(0); return; }
      const v = parseInt(raw);
      if (!isNaN(v)) S.setRecency(v);
      else recencyValEl.value = S.recencyN === 0 ? 'all' : S.recencyN;
    });
    recencyValEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { recencyValEl.blur(); }
      if (e.key === 'Escape') { recencyValEl.value = S.recencyN === 0 ? 'all' : S.recencyN; recencyValEl.blur(); }
    });
    recencyValEl.style.cursor = 'text';
  }

  // ── k control in search params ────────────────────────────────────────────
  // The slider is a POSITION (0–1000) log-mapped onto 1…K_MAX — see the note
  // on K_MAX in state.js for why the scale is fixed. `setSearchK` takes the
  // real k and is the ONE writer: every caller (presets, OSC, the sheet, the
  // wheel) hands it a count, and it puts the slider where that count lives.
  const _kFromSlider = sv =>
    Math.max(1, Math.min(K_MAX, Math.round(Math.pow(K_MAX, parseFloat(sv) / 1000))));
  const _kToSlider = k =>
    Math.round(1000 * Math.log(Math.max(1, Math.min(K_MAX, k))) / Math.log(K_MAX));
  S.setSearchK = function(v) {
    const k = Math.max(1, Math.min(K_MAX, Math.round(v)));
    S.grainOverrides.k = k;
    const slider = document.getElementById('searchKSlider');
    if (slider) slider.value = _kToSlider(k);
    const bigNum = document.getElementById('kBigNum');
    if (bigNum) bigNum.value = k;
  };

  const searchKSlider = document.getElementById('searchKSlider');
  if (searchKSlider) {
    searchKSlider.value = _kToSlider(S.grainOverrides.k ?? gp().k);
    let _searchKTimerId = null;
    searchKSlider.addEventListener('input', () => {
      if (_searchKTimerId === null)
        _searchKTimerId = setTimeout(() => {
          _searchKTimerId = null;
          S.setSearchK(_kFromSlider(searchKSlider.value));
        }, 50);
    });
  }

  const kBigNum = document.getElementById('kBigNum');
  if (kBigNum) {
    kBigNum.value = S.grainOverrides.k ?? gp().k;
    kBigNum.style.cursor = 'text';
    kBigNum.addEventListener('focus', e => e.target.select());
    kBigNum.addEventListener('blur', () => {
      const v = parseInt(kBigNum.value);
      if (!isNaN(v)) S.setSearchK(v); else kBigNum.value = S.grainOverrides.k ?? gp().k;
    });
    kBigNum.addEventListener('keydown', e => {
      if (e.key === 'Enter') { kBigNum.blur(); }
      if (e.key === 'Escape') { kBigNum.value = S.grainOverrides.k ?? gp().k; kBigNum.blur(); }
    });
    kBigNum.addEventListener('wheel', e => {
      e.preventDefault();
      S.setSearchK((S.grainOverrides.k ?? gp().k) + (e.deltaY < 0 ? 1 : -1));
    }, { passive: false });
  }

  // ── Radius slider + numbox ────────────────────────────────────────────────
  const radiusSliderEl = document.getElementById('radiusSlider');
  const radiusValEl    = document.getElementById('radiusVal');
  function applyRadius(deg) {
    const v = Math.max(1, Math.min(180, Math.round(deg)));
    S.searchRadiusDeg = v;
    if (radiusSliderEl) radiusSliderEl.value = v;
    if (radiusValEl)    radiusValEl.value    = v + '°';
    updatePlaybackControls();
  }
  if (radiusSliderEl) {
    radiusSliderEl.value = S.searchRadiusDeg;
    // setTimeout-throttle at 100ms — matches hardware MIDI potentiometer rate
    // (~10 updates/second). Numbox updates immediately for snappy feel.
    let _radiusTimerId = null;
    radiusSliderEl.addEventListener('input', () => {
      if (radiusValEl) radiusValEl.value = radiusSliderEl.value + '°';
      if (_radiusTimerId === null)
        _radiusTimerId = setTimeout(() => {
          _radiusTimerId = null;
          applyRadius(parseInt(radiusSliderEl.value));
        }, 50);
    });
  }
  if (radiusValEl) {
    radiusValEl.addEventListener('change', () => {
      const v = parseFloat(radiusValEl.value);
      if (!isNaN(v)) applyRadius(v); else radiusValEl.value = S.searchRadiusDeg + '°';
    });
    radiusValEl.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { radiusValEl.blur(); }
      if (e.key === 'Escape') { radiusValEl.value = S.searchRadiusDeg + '°'; radiusValEl.blur(); }
    });
  }

  // ? button opens mapping modal (midi.js registers S.openMappingModal)
  document.getElementById('keysBtn')?.addEventListener('click', () => S.openMappingModal?.());

  // Perf monitor button
  document.getElementById('perfMonBtn')?.addEventListener('click', () => {
    S.perfMonitorVisible = !S.perfMonitorVisible;
    const el = document.getElementById('perfMonitor');
    if (el) el.style.display = S.perfMonitorVisible ? 'block' : 'none';
    const btn = document.getElementById('perfMonBtn');
    if (btn) btn.classList.toggle('active', S.perfMonitorVisible);
  });

  // Sched row click → reset peak hold (like tapping a peak meter in a DAW)
  document.getElementById('pmSchedRow')?.addEventListener('click', (e) => {
    e.stopPropagation();
    perf.schedulerPeak = 0;
    const peakEl = document.getElementById('pmSchedPeak');
    const peakValEl = document.getElementById('pmSchedPeakVal');
    if (peakEl) { peakEl.style.left = '0%'; peakEl.style.display = 'none'; }
    if (peakValEl) peakValEl.textContent = '';
  });

  // Drop rate numbox — editable ms value for particle deposit interval.
  // Writes to S.paintTicker.intervalMs (consumed by paint-ticker.js).
  const _dropEl = document.getElementById('pmDropVal');
  if (_dropEl) {
    // Initialise from current state (may already be set from console / preset load)
    if (!S.paintTicker) S.paintTicker = {};
    const initMs = S.paintTicker.intervalMs ?? 50;
    _dropEl.value = `${initMs}ms`;

    _dropEl.addEventListener('focus', () => _dropEl.select());
    _dropEl.addEventListener('change', () => {
      const v = parseInt(_dropEl.value.replace(/[^0-9]/g, ''), 10);
      if (!isNaN(v) && v >= 5 && v <= 500) {
        if (!S.paintTicker) S.paintTicker = {};
        S.paintTicker.intervalMs = v;
        _dropEl.value = `${v}ms`;
      } else {
        // Revert to current value
        _dropEl.value = `${S.paintTicker?.intervalMs ?? 50}ms`;
      }
    });
    _dropEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { _dropEl.blur(); e.preventDefault(); }
      if (e.key === 'Escape') {
        _dropEl.value = `${S.paintTicker?.intervalMs ?? 50}ms`;
        _dropEl.blur();
        e.preventDefault();
      }
    });
  }


  // Fullscreen — delegates to the same fullscreenBtn click handler in events.js
  document.getElementById('fullscreenBtn2')?.addEventListener('click', () => {
    document.getElementById('fullscreenBtn')?.click();
  });

  // Mic enable button
  const micBtn = document.getElementById('micEnableBtn');
  if (micBtn) {
    micBtn.addEventListener('click', async () => {
      if (S.micPermissionGranted) return;
      // In Electron, RtAudio handles input — don't try getUserMedia.
      // If RtAudio is already active, the button should already show "mic ready".
      // If not, open Audio Settings so the user can pick a device.
      if (window.electronBridge?.isElectron) {
        if (window._rtAudioInputListening) return;  // already active
        document.getElementById('audioSettingsBtn')?.click();
        return;
      }
      setMicBtnLabel('enabling…');
      micBtn.disabled = true;
      ensureAudioContext();
      const ok = await requestMicAccess();
      if (ok) {
        setMicBtnLabel('mic ready');
        micBtn.classList.add('mic-ready');
      } else {
        setMicBtnLabel('mic denied');
        micBtn.classList.add('mic-denied');
      }
      micBtn.disabled = false;
    });
  }

}

export function toggleNearestMode() {
  S.nearestMode = !S.nearestMode;
  // k-all is incompatible with k-nearest — force it off
  if (S.nearestMode && S.grainKAllMode) S.grainKAllMode = false;
  updatePlaybackControls();
  S._syncRadiusFadeUI?.();
  flashRadiusTooltip();
}

// ── Seed plant / uproot ──────────────────────────────────────────────────────

function getMouseLonLat() {
  return screenToLonLat(S.mousePixelX, S.mousePixelY);
}

/** Cursor position on the sphere — detethered-aware.
 *  In two-sensor mode the cursor sensor drives position; otherwise mouse or camQ. */
export function getCursorPos() {
  return S.cursorQ ? getCursorLonLat()
    : S.mouseInCanvas ? getMouseLonLat()
    : getCursorLonLat();
}

/** Legacy single-call plant (used by OSC, MIDI, etc). Plants a stationary seed. */
// ── Pins on the history stack (js/history.js, 2026-09-05) ──────────────────
// A pin placed by hand — a tapped cloud, a held path, a dropped loop — and an
// unpin (release, unpin all) are ACTIONS: the slot OBJECT is what the action
// holds, taken out or put back. A pin a gesture made from its stroke (the
// looper's loop, the wash's cloud, an overdub's layer) belongs to the STROKE's
// action instead (ui-samples.js) — one gesture, one action.

/** Take a slot out now: nodes released, no fade. `_gen` moves so a fade
 *  handler still pending on its old source cannot null the slot again after
 *  a restore. */
export function removePinSlot(slot) {
  const idx = S.commitSlots.indexOf(slot);
  if (idx < 0) return false;
  if (slot.type === 'loop') releaseSeqNodes(slot);
  slot._gen = (slot._gen | 0) + 1;
  S.commitSlots[idx] = null;
  S._pinsDirty = true;
  S._syncCommitUI?.();
  (S.updateSeedBanksUI || updateSeedBanksUI)();
  return true;
}

/** Put a slot back, playing, with the mute / solo it had: at its own index
 *  when free, else the first free one. The scheduler rebuilds a loop's nodes
 *  (and its overdub layers) on the next tick. Refuses when the pool is full. */
export function restorePinSlot(slot, at = -1) {
  if (!slot || S.commitSlots.includes(slot)) return false;
  const lim = S.commitSlotCount ?? S.commitSlots.length;
  let idx = at >= 0 && at < lim && !S.commitSlots[at] ? at
          : (slot.slotIndex < lim && !S.commitSlots[slot.slotIndex]) ? slot.slotIndex : -1;
  if (idx < 0) for (let i = 0; i < lim; i++) if (!S.commitSlots[i]) { idx = i; break; }
  if (idx < 0) { window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'full' } })); return false; }
  slot.slotIndex = idx;
  slot._gen = (slot._gen | 0) + 1;
  if (slot.type === 'loop') {
    slot._sourceNode = null; slot._gainNode = null; slot._muteGain = null; slot._pinGain = null;
    slot._panner = null; slot._vbapGains = null; slot._extraNodes = null;
    slot._fadingOut = false; slot._playingToEnd = false; slot._selfKilled = false;
    slot._startedAt = 0;
    slot.playing = true;
    if (slot.overdubs) for (const ov of slot.overdubs) { ov._src = null; ov._gain = null; }
  } else if (slot.type === 'cloud') {
    slot._releasingAt = 0; slot._composerHold = false; slot._envRelease = 0;
    slot._envAttack = 0; slot._envGainCurrent = 1;
    slot.playing = true;
  }
  S.commitSlots[idx] = slot;
  S._applyPinMix?.();            // its own mute / solo, and the standing solos
  S._pinsDirty = true;
  S._syncCommitUI?.();
  (S.updateSeedBanksUI || updateSeedBanksUI)();
  return true;
}

/** Put an overdub layer back on its master, if the master is still pinned. */
export function reattachOverdub(master, ov) {
  if (!master || !ov || !S.commitSlots.includes(master)) return false;
  if (!master.overdubs) master.overdubs = [];
  if (!master.overdubs.includes(ov)) master.overdubs.push(ov);
  ov._src = null; ov._gain = null;
  const src = master._sourceNode;
  if (src && !src._stopped && S.audioCtx) startOverdubLayer(master, ov, S.audioCtx);
  S._pinsDirty = true;
  return true;
}
S._removePinSlot   = removePinSlot;
S._restorePinSlot  = restorePinSlot;
S._reattachOverdub = reattachOverdub;

/** A pin, or SEVERAL: one press now pins every line the cursor is on, and
 *  that is one thing the performer did (history.js: "one gesture is one
 *  action"). Undo takes them back newest first, each putting back whatever the
 *  overflow rule evicted to make room for it. `tag` is the press this belongs
 *  to (S._pinPressTag) so the release can fold the loops and the cloud — two
 *  edges of one press — into a single entry; null outside a press. */
function _pinsAction(made) {
  return {
    kind: 'pin',
    tag: S._pinPressTag ?? null,
    undo() {
      for (let i = made.length - 1; i >= 0; i--) {
        removePinSlot(made[i].slot);
        if (made[i].evicted) restorePinSlot(made[i].evicted);
      }
    },
    redo() {
      for (const m of made) {
        if (m.evicted) removePinSlot(m.evicted);
        restorePinSlot(m.slot);
      }
    }
  };
}
function _pinAction(slot, evicted = null) { return _pinsAction([{ slot, evicted }]); }
function _unpinAction(slots) {
  const at = slots.map(sl => S.commitSlots.indexOf(sl));
  return {
    kind: 'unpin',
    undo() { slots.forEach((sl, i) => restorePinSlot(sl, at[i])); },
    redo() { for (const sl of slots) removePinSlot(sl); }
  };
}
let _lastEvicted = null;   // the pin an overflow rule made room by removing

export function plantSeed() {
  startSeedPlant();
  finalizeSeedPlant();
}

// ── Seed plant + moving seed recording ─────────────────────────────────────
// ↓ keydown → startSeedPlant(): reserves a slot and begins recording frames.
// Grain scheduler ticks → tickSeedRecording(): captures cursor + params.
// ↓ keyup → finalizeSeedPlant(): if held <200ms → stationary, else → moving.

/** Capture a single frame of cursor position + all grain-relevant params. */
function _captureSeedFrame(startOverride) {
  const now = performance.now();
  const t = now - (startOverride ?? S._commitRecordingStart);
  const { lon, lat } = getCursorPos();

  // Merge overrides into params for a complete snapshot
  const mergedParams = { ...S.grainParams };
  for (const [k, v] of Object.entries(S.grainOverrides)) {
    if (v !== null) mergedParams[k] = v;
  }
  mergedParams.curveType   = S.grainCurveType;
  mergedParams.direction   = S.grainDirection;
  mergedParams.probability = S.grainProbability;

  return {
    t,
    lon, lat,
    grainParams:       mergedParams,
    searchRadiusDeg:   S.searchRadiusDeg,
    nearestMode:       S.nearestMode,
    kAllMode:          S.grainKAllMode,
    kSeqMode:          S.grainKSeqMode,
    grainDirection:    S.grainDirection,
    grainCurveType:    S.grainCurveType,
    grainProbability:  S.grainProbability,
    radiusFadeEnabled: S.radiusFadeEnabled,
    radiusFadeCurve:   S.radiusFadeCurve,
    // NOTE: recencyN is intentionally NOT captured per-frame — it stays global
  };
}

/**
 * Find a free seed slot within the active count, or a replacement slot
 * based on overflow mode. Returns -1 if no slot available.
 */
/**
 * Find a free commit slot, or evict one based on overflow mode.
 * Unified for both clouds and loops — they share one pool.
 * Releasing clouds are treated as free (already fading out).
 */
// A press must not evict what the SAME press just pinned. One press pins every
// line the cursor is on (see dropSeqFromCursor), so under overflow oldest or
// nearest the third pin of a press would take back the first — the overflow
// rule, which is about the pins that were there BEFORE the gesture, turned on
// the gesture itself. Held for the length of one drop and cleared after it.
const _thisPress = new Set();

function _findCommitSlot(lon, lat) {
  const limit = S.commitSlotCount;
  // 1. First empty or releasing-cloud slot within active range
  for (let i = 0; i < limit; i++) {
    const slot = S.commitSlots[i];
    if (!slot) return i;
    if (slot.type === 'cloud' && slot._releasingAt > 0) return i;
    if (slot.type === 'loop' && (slot._playingToEnd || slot._fadingOut)) return i;
  }
  // 2. All active slots full — check overflow mode
  if (S.commitOverflow === 'oldest') {
    let oldestIdx = -1, oldestTime = Infinity;
    for (let i = 0; i < limit; i++) {
      const slot = S.commitSlots[i];
      if (!slot || _thisPress.has(i)) continue;
      const t = slot._plantedAt || slot._createdAt || 0;
      if (t < oldestTime) { oldestTime = t; oldestIdx = i; }
    }
    return oldestIdx;
  }
  if (S.commitOverflow === 'nearest') {
    let nearIdx = -1, nearAng = Infinity;
    for (let i = 0; i < limit; i++) {
      const slot = S.commitSlots[i];
      if (!slot || _thisPress.has(i)) continue;
      let sLon, sLat;
      if (slot.type === 'cloud') {
        sLon = slot.lon; sLat = slot.lat;
      } else {
        sLon = slot.anchorLon ?? slot.particles?.[0]?.lon;
        sLat = slot.anchorLat ?? slot.particles?.[0]?.lat;
      }
      if (sLon == null || sLat == null) continue;
      const ang = angleBetweenSphere(sLon, sLat, lon, lat);
      if (ang < nearAng) { nearAng = ang; nearIdx = i; }
    }
    return nearIdx;
  }
  return -1; // overflow === 'off'
}
// Legacy alias
function _findSeedSlot(lon, lat) { return _findCommitSlot(lon, lat); }

/** Reserve a cloud slot at (lon, lat), snapshotting the live block into it.
 *  Returns the slot index, or -1 when the pool is full with overflow off. */
function _reserveCloud(lon, lat) {
  const slotIndex = _findSeedSlot(lon, lat);
  if (slotIndex === -1) {
    // Slots full with overflow=off — signal the rejected attempt for LED feedback.
    window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'full' } }));
    return -1;
  }
  // If replacing an existing commit (the overflow rule), take it out through
  // the one path, and remember it: the pin's undo puts it back.
  _lastEvicted = null;
  if (S.commitSlots[slotIndex]) {
    _lastEvicted = S.commitSlots[slotIndex];
    removePinSlot(_lastEvicted);
  }
  const color = SEED_COLORS[slotIndex];
  S.commitSlots[slotIndex] = {
    type: 'cloud',
    slotIndex, lon, lat, color, searchRadiusDeg: S.searchRadiusDeg,
    // The anchor: where the pin gesture releases (pins.js pinAnchorInto). A
    // tap is here; a held path is re-stamped at its END in finalizeSeedPlant.
    anchorLon: lon, anchorLat: lat,
    nearestMode: S.nearestMode,
    kAllMode: S.grainKAllMode,
    kSeqMode: S.grainKSeqMode,
    _lastFiredAt:  0,
    _nextPeriodMs: 0,
    _plantedAt:    performance.now() / 1000,
    _releasingAt:  0,
    _envAttack:    S.commitAttack,     // the attack ramp NOW RUNNING (fadeIn at birth, again on unmute)
    _envRelease:   0,                // the release ramp now running (fadeOut, set when it starts)
    _envGainCurrent: S.commitAttack > 0 ? 0 : 1,
    // THE PIN'S OWN TWO RAMPS (2026-09-16): born from the settings' defaults,
    // then the pin's to keep and edit in the rail. Pin and unmute ride `fadeIn`,
    // unpin and mute ride `fadeOut` — one pair for both verbs, both kinds
    // (js/composer.js). Before this the pair was global and a mute was 20 ms.
    fadeIn:  S.commitAttack,
    fadeOut: S.commitRelease,
    mute: false, solo: false,        // the pin's own flags (pins.js)
    grainParams: {
      ...S.grainParams,
      ...Object.fromEntries(Object.entries(S.grainOverrides).filter(([, v]) => v !== null)),
      curveType:   S.grainCurveType,
      direction:   S.grainDirection,
      probability: S.grainProbability
    },
    grainOverrides: {},
    morphT:        0.5,
    morphVelocity: 0,
    radiusFadeEnabled: S.radiusFadeEnabled,
    radiusFadeCurve:   S.radiusFadeCurve,
    // NOTE: recencyN is intentionally NOT captured per-seed — it stays global
    // Moving seed fields (null = stationary, populated on finalize if held long enough)
    frames:   null,
    duration: 0,
    loopMode: S.commitCloudLoopMode ?? 'pingpong',
    _playheadMs:  0,
    _pingForward: true
  };
  S._applyPinMix?.();
  (S.updateSeedBanksUI || updateSeedBanksUI)();
  // Signal the commit for LED feedback on the cursor x-IMU3 (1 yellow blink).
  window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'commit' } }));
  return slotIndex;
}

/** Start a seed plant. Reserves a slot and begins recording movement. */
export function startSeedPlant() {
  const { lon, lat } = getCursorPos();
  const slotIndex = _reserveCloud(lon, lat);
  if (slotIndex === -1) return;
  // Start recording cursor path for potential moving seed
  S._commitRecordingFrames   = [_captureSeedFrame(performance.now())];
  S._commitRecordingStart    = performance.now();
  S._commitRecordingSlot     = slotIndex;
  S._commitRecordingDeferred = false;
}

/** A stroke that ENDS as a cloud (the grain sheet's `on end: cloud`, the
 *  wash brush's contract — Ek, 2026-09-05): the path is recorded from the
 *  press, but NO slot exists until the release. While the stroke runs the
 *  cursor is the only thing reading it, exactly as a scratch stroke; the
 *  moving cloud takes over the path when the hand lets go. startSeedPlant
 *  (the `=` hold) reserves the slot at the press instead, because a pin
 *  pressed on a place must sound at once — a ghost pin. Two things follow
 *  from deferring: a full pool refuses at the RELEASE, leaving the stroke
 *  scratch, and the cloud's snapshot (block, lens, radius) is the release's. */
export function startSeedPath() {
  S._commitRecordingFrames   = [_captureSeedFrame(performance.now())];
  S._commitRecordingStart    = performance.now();
  S._commitRecordingSlot     = -1;
  S._commitRecordingDeferred = true;
  // The stroke this path belongs to — read now, because the stroke's end
  // clears currentStrokeId before it finalizes the path. Undo of the stroke
  // takes the cloud with it (removeSeqByStrokeId), as it takes a loop.
  S._commitRecordingStrokeId = S.currentStrokeId;
}

/** Capture a frame during ↓ hold. Called from grain scheduler tick (50/sec).
 *  Throttled to ~15 frames/sec — sufficient for gesture path resolution,
 *  avoids 50 object allocations/sec + { ...spread } + Object.entries per tick. */
let _lastSeedFrameT = 0;
const _SEED_FRAME_INTERVAL_MS = 66; // ~15fps
export function tickSeedRecording() {
  const now = performance.now();
  if (now - _lastSeedFrameT < _SEED_FRAME_INTERVAL_MS) return;
  _lastSeedFrameT = now;
  if (S._commitRecordingFrames) S._commitRecordingFrames.push(_captureSeedFrame());
  if (S._shelvedSeed?.frames) S._shelvedSeed.frames.push(_captureSeedFrame(S._shelvedSeed.start));
}

/** Finalize seed plant on ↓ key release. Short hold = stationary, long = moving. */
export function finalizeSeedPlant() {
  const frames   = S._commitRecordingFrames;
  const start    = S._commitRecordingStart;
  const deferred = !!S._commitRecordingDeferred;
  const sid      = S._commitRecordingStrokeId;
  let   slot     = S._commitRecordingSlot;
  S._commitRecordingFrames   = null;
  S._commitRecordingStart    = 0;
  S._commitRecordingSlot     = -1;
  S._commitRecordingDeferred = false;
  S._commitRecordingStrokeId = -1;

  // A deferred path (startSeedPath) gets its slot NOW, anchored where the
  // stroke ENDED — the pool may be full, in which case the stroke stays
  // scratch and the LED says so.
  if (deferred) {
    if (!frames || !frames.length) return;
    const end = frames[frames.length - 1];
    slot = _reserveCloud(end.lon, end.lat);
    if (slot === -1) return;
    if (sid > 0) S.commitSlots[slot].strokeId = sid;
  }
  if (slot < 0 || !S.commitSlots[slot]) return;
  const seed = S.commitSlots[slot];

  const holdDuration = performance.now() - start;
  if (!frames || frames.length < 2 || holdDuration < MOVING_SEED_THRESHOLD_MS) {
    // Short hold → stationary seed (already set up by startSeedPlant).
    // Clear recording fields.
    seed.frames   = null;
    seed.duration = 0;
  } else {
    // Long hold → moving seed.  Store the recorded path.
    seed.frames   = frames;
    seed.duration = frames[frames.length - 1].t;  // ms
    // The anchor is where the hand let go — the END of the path (Ek,
    // 2026-09-05), so under focus you hear the stroke you just drew. `lon`
    // is the playback position and the scheduler overwrites it every tick.
    const end = frames[frames.length - 1];
    seed.anchorLon = end.lon;
    seed.anchorLat = end.lat;
    seed.lon = frames[0].lon;
    seed.lat = frames[0].lat;
  }
  // A pin placed by hand is one action. A deferred path (the wash) is the
  // stroke's: its cloud goes and comes with the stroke.
  if (!deferred) { history.push(_pinAction(seed, _lastEvicted)); _lastEvicted = null; }
  (S.updateSeedBanksUI || updateSeedBanksUI)();
}

export function uprootNearestSeed() {
  const { lon, lat } = getCursorPos();
  // Skip seeds already fading out so rapid uproot hits the next live seed
  const nearestSlot = findNearestSeedSlot(lon, lat, { skipReleasing: true });
  if (nearestSlot === -1) return;
  const seed = S.commitSlots[nearestSlot];
  if (!seed) return;
  history.push(_unpinAction([seed]));
  // Use the current release time (performance gesture), not a stored value
  const rel = S.commitRelease || 0;
  seed._composerHold = false;   // uproot destroys — see releaseCommit()
  if (rel <= 0) {
    // Instant removal
    S.commitSlots[nearestSlot] = null;
  } else {
    // Stamp the current release duration onto the seed and start the ramp
    seed._envRelease  = rel;
    seed._releasingAt = performance.now() / 1000;
  }
  (S.updateSeedBanksUI || updateSeedBanksUI)();

  // Signal the release for LED feedback on the cursor x-IMU3 (2 yellow blinks).
  window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'release' } }));
}

export function clearAllSeeds() {
  const now = performance.now() / 1000;
  // Use the current release time for all cloud-type commits being cleared
  const rel = S.commitRelease || 0;
  let released = false;
  const gone = S.commitSlots.filter(c => c && c.type === 'cloud');
  if (gone.length) history.push(_unpinAction(gone));
  for (let i = 0; i < MAX_COMMITS; i++) {
    const seed = S.commitSlots[i];
    if (!seed || seed.type !== 'cloud') continue;
    seed._composerHold = false;   // clear-all destroys — see releaseCommit()
    if (rel > 0 && !seed._releasingAt) {
      seed._envRelease  = rel;
      seed._releasingAt = now;
      released = true;
    } else if (rel <= 0) {
      S.commitSlots[i] = null;
      released = true;
    }
  }
  (S.updateSeedBanksUI || updateSeedBanksUI)();
  if (released) window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'release' } }));
}

// ── Sequence (loop) system ──────────────────────────────────────────────────────

/**
 * Create a sequence from a specific stroke ID.
 * Collects all particles with that strokeId, sorts by paint order, and
 * places them in the first available sequence slot. Starts playing immediately.
 */
/**
 * Returns true when all active loop slots are occupied AND overflow is 'off',
 * meaning no new loops can be created.
 */
S._syncSeqButtonStates = null; // assigned below after definition
export function seqSlotsFull() {
  if (S.commitOverflow !== 'off') return false;
  for (let i = 0; i < S.commitSlotCount; i++) {
    const sl = S.commitSlots[i];
    if (!sl || (sl.type === 'cloud' && sl._releasingAt > 0) || (sl.type === 'loop' && (sl._playingToEnd || sl._fadingOut))) return false;
  }
  return true;
}

/**
 * Sync the disabled / greyed-out state of the loop-mode button and drop button
 * based on whether slots are full (overflow=off). Also auto-disables loop mode
 * if it was on and slots just became full.
 */
function _syncSeqButtonStates() {
  const full = seqSlotsFull();
  const commitDropBtn = document.getElementById('commitDropBtn');
  const commitDrawBtn = document.getElementById('commitDrawBtn');
  if (commitDropBtn) {
    commitDropBtn.classList.toggle('disabled', full);
    commitDropBtn.style.opacity = full ? '0.35' : '';
    commitDropBtn.style.pointerEvents = full ? 'none' : '';
  }
  if (commitDrawBtn) {
    commitDrawBtn.style.opacity = full ? '0.35' : '';
  }
}
S._syncSeqButtonStates = _syncSeqButtonStates;

// Track previous commit mode so we can detect cloud↔loop transitions
// and save/restore the dir setting per-mode.
let _prevCommitMode   = null;
let _savedCloudLoopMode = null;  // last dir setting while in cloud mode

/**
 * Sync all commit-related UI: mode toggle, commit lock, actions visibility,
 * transport buttons, and slot-full state.
 */
function _syncCommitUI() {
  const isLoop   = S.commitMode === 'loop';
  const prevMode = _prevCommitMode;
  _prevCommitMode = S.commitMode;

  // ── Mode segmented control (in commits panel) ──
  const modeSeg = document.getElementById('commitModeSeg');
  if (modeSeg) {
    modeSeg.querySelectorAll('.grain-seg-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === S.commitMode));
  }


  // ── Commit action buttons — swap mode class, labels, and titles ──
  const modeName = isLoop ? 'loop' : 'cloud';
  document.querySelectorAll('.commit-action-btn').forEach(el => {
    el.classList.toggle('commit-mode--loop', isLoop);
  });
  const dropLabel = document.getElementById('commitDropLabel');
  const drawLabel = document.getElementById('commitDrawLabel');
  if (dropLabel) dropLabel.textContent = 'drop ' + modeName;
  if (drawLabel) drawLabel.textContent = 'draw ' + modeName;
  const dropBtn = document.getElementById('commitDropBtn');
  const drawBtn = document.getElementById('commitDrawBtn');
  if (dropBtn) dropBtn.title = 'drop ' + modeName + ' — tap D';
  if (drawBtn) drawBtn.title = 'draw ' + modeName + ' — hold D';

  // ── Dir seg — save/restore per-mode, disable ping-pong in loop mode ──
  const dirSeg = document.getElementById('seedLoopModeSeg');
  if (dirSeg) {
    if (isLoop && prevMode !== 'loop') {
      // cloud → loop: save current cloud dir, fall back from ping-pong to fwd
      _savedCloudLoopMode = S.commitCloudLoopMode ?? 'pingpong';
      if (S.commitCloudLoopMode === 'pingpong') S.commitCloudLoopMode = 'forward';
    } else if (!isLoop && prevMode === 'loop') {
      // loop → cloud: restore saved cloud dir (default ping-pong if never set)
      S.commitCloudLoopMode = _savedCloudLoopMode ?? 'pingpong';
    }
    // Sync active button
    dirSeg.querySelectorAll('[data-loopmode]').forEach(b =>
      b.classList.toggle('active', b.dataset.loopmode === S.commitCloudLoopMode));
    // Grey-out ping-pong button in loop mode
    const pingpongBtn = dirSeg.querySelector('[data-loopmode="pingpong"]');
    if (pingpongBtn) {
      pingpongBtn.style.opacity       = isLoop ? '0.35' : '';
      pingpongBtn.style.pointerEvents = isLoop ? 'none'  : '';
    }
  }

  // Also refresh slot-full state
  _syncSeqButtonStates();

  // Grey out the handsfree arm pill when not in plain trace mode (#290 moved
  // it into Settings → audio; `_syncHandsfreeUI` owns the rest of its state).
  const hfSeg = document.getElementById('hfArmSeg');
  if (hfSeg) hfSeg.classList.toggle('hf-unavailable', S.traceMode !== 'trace');
}
S._syncCommitUI = _syncCommitUI;
S._clearAllCommits = () => clearAllCommits();
window._clearAllCommits = S._clearAllCommits;

/**
 * Find a free seq slot within the active count, or a replacement slot
 * based on overflow mode. anchorLon/Lat used for 'nearest' mode.
 */
// Legacy wrapper — now uses the unified commit slot finder
function _findSeqSlot(anchorLon, anchorLat) { return _findCommitSlot(anchorLon, anchorLat); }

/**
 * Resolve the anchor position for a stroke: the explicit anchor particle if one
 * was given (D-drop), otherwise the first particle painted in the stroke.
 * Cheap — needed before slot allocation, which happens before the buffer work.
 */
function _resolveStrokeAnchor(strokeId, anchorParticle) {
  // A drop by hand is anchored where the hand was. A stroke a brush pins at
  // its end (looper, or any tile with loop `on end`) is anchored at its LAST
  // mark — where the hand let go — so under focus you hear the stroke you
  // just made (Ek, 2026-09-05). Paint order is array order.
  if (anchorParticle) return { lon: anchorParticle.lon, lat: anchorParticle.lat };
  for (let i = S.particles.length - 1; i >= 0; i--) {
    if (S.particles[i].strokeId === strokeId) {
      return { lon: S.particles[i].lon, lat: S.particles[i].lat };
    }
  }
  return { lon: 0, lat: 0 };
}

/**
 * Build the audio payload for one painted stroke: its particles, a standalone
 * crossfaded buffer of the region they cover, and the loop bounds.
 *
 * Shared by the loop commit path (`createSeqFromStroke`) and the trigger tool
 * (`armTrigger` in trigger.js) — the two differ in what plays the result and
 * when, not in how the material is prepared.
 *
 * Returns null when the stroke can't produce playable audio (no particles, no
 * resolvable source buffer, or a region too short to be worth a buffer). The
 * caller decides what that means; this function has no side effects on S.
 *
 * NOTE: `particles` are detached copies with grainStart rebased to the new
 * buffer's origin — they are NOT the objects in S.particles. Anything that
 * needs to relate them back to the global array must match on position/time,
 * not identity or index.
 */
export function buildLoopPayload(strokeId, anchorParticle) {
  if (strokeId < 0) return null;

  // Collect particles belonging to this stroke, preserving paint order.
  // Paint order = array index order (particles are pushed sequentially).
  const seqParticles = [];
  for (let i = 0; i < S.particles.length; i++) {
    if (S.particles[i].strokeId === strokeId) {
      seqParticles.push(S.particles[i]);
    }
  }
  if (seqParticles.length === 0) return null;

  // ── Resolve audio buffer and compute loop region ───────────────────────
  // Store the buffer directly on the sequence so playback doesn't depend on
  // particles or liveRecBuffers (which undo can remove/reindex).
  const p0 = seqParticles[0];
  let buffer = null;
  if (p0.source === 'live') {
    const slot = S.liveRecBuffers[p0.liveBufferIdx];
    buffer = slot?.buffer || slot?.liveBuffer;
  } else if (p0.source === 'sample') {
    buffer = S.samples[p0.sampleIndex]?.buffer;
  }
  if (!buffer) return null;

  const n = seqParticles.length;
  // Region bounds are MIN/MAX grainStart, NOT first/last in paint order.
  // Paint order is not time order for every brush: a sample's grainCursor
  // wraps mid-stroke, match points anywhere in the corpus, echo re-deposits
  // earlier material. Rebasing against the first-painted mark pushed every
  // earlier-in-buffer mark NEGATIVE — and a pin anchored on one handed the
  // scheduler a negative start offset, whose uncaught throw at src.start()
  // silenced every loop in the app, 50 times a second (2026-08-28).
  let minStart = Infinity, maxStart = -Infinity, maxP = seqParticles[0];
  for (let i = 0; i < n; i++) {
    const gs = seqParticles[i].grainStart;
    if (gs < minStart) minStart = gs;
    if (gs > maxStart) { maxStart = gs; maxP = seqParticles[i]; }
  }
  let loopStart = minStart;
  const lastP     = maxP;
  // Use the full buffer duration — stopLiveRecording() already clamped all
  // particle times to fit the finalized buffer, and the loop crossfade
  // handles the wrap-point seam.  (An earlier safeDur trim removed 50 ms
  // from the tail but that audibly cut off the performer's last beat.)
  //
  // The tail past the last mark is material-dependent (2026-08-28). A
  // TRIGGER stroke's marks sample the take at the paint rate — their
  // `grainDuration` is the GRANULAR grain length, seconds on a wash patch —
  // and adding it overshot the region by up to the whole buffer: pinning a
  // cut segment played through the erased gap into the rest of the original
  // take. Same rule as _applyCluster in trigger.js: one median spacing is
  // exactly the material the last mark stands for. Granular strokes keep
  // grainDuration — their grains genuinely read that span.
  let tailS = lastP.grainDuration;
  if (p0.trig && n > 1) {
    // Gaps over time-sorted starts — paint order again, see above.
    const starts = seqParticles.map(p => p.grainStart).sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < n; i++) gaps.push(starts[i] - starts[i - 1]);
    gaps.sort((a, b) => a - b);
    tailS = gaps[gaps.length >> 1] || 0.02;
  }
  let loopEnd   = Math.min(buffer.duration, maxStart + tailS);
  // The button, not the marks — the same rule as _applyCluster in trigger.js,
  // for the same reasons: an untrimmed tape stroke's region is press to
  // release, from the take's `edges`.
  const takeSlot = p0.source === 'live' ? S.liveRecBuffers[p0.liveBufferIdx] : null;
  if (p0.trig && takeSlot?.edges && takeSlot.markSpan &&
      minStart <= takeSlot.markSpan[0] + 1e-6 && maxStart >= takeSlot.markSpan[1] - 1e-6) {
    loopStart = takeSlot.edges.startS; loopEnd = takeSlot.edges.endS;
  }

  // ── Build a crossfaded loop buffer ─────────────────────────────────────
  // Extract the loop region into a standalone buffer with a crossfade
  // baked into the boundaries so the native loop=true wrap is click-free.
  // 30ms is aggressive enough to kill any discontinuity while staying
  // imperceptible on musical material.
  const XFADE_S = 0.030;
  const actx = S.audioCtx || new AudioContext();
  const sr   = buffer.sampleRate;
  const nCh  = 1;                    // a take is mono (js/take.js)
  // Symmetric rounding — the old floor/ceil pair biased the region longer,
  // padding the tail with extra (possibly silent) samples.
  const startSamp = Math.round(loopStart * sr);
  const endSamp   = Math.min(buffer.length, Math.round(loopEnd * sr));
  const regionLen = endSamp - startSamp;
  // Guard against degenerate regions (e.g. paint gate rejected most particles,
  // leaving a near-zero region that createBuffer would reject).
  const MIN_LOOP_SAMPLES = Math.max(2, Math.floor(sr * 0.01)); // 10ms minimum
  if (regionLen < MIN_LOOP_SAMPLES) return null;
  const xfadeSamp = Math.min(Math.floor(XFADE_S * sr), Math.floor(regionLen / 4));

  const loopBuffer = actx.createBuffer(nCh, regionLen, sr);
  for (let ch = 0; ch < nCh; ch++) {
    const src = buffer.data;
    const dst = loopBuffer.getChannelData(ch);
    // Copy the region
    for (let i = 0; i < regionLen; i++) dst[i] = src[startSamp + i];
    // Crossfade the tail so it converges to dst[0], making the loop
    // wrap (last sample → first sample) seamless. Only the tail is
    // modified; the head stays untouched.
    if (xfadeSamp > 0) {
      const headVal = dst[0]; // target value at wrap point
      for (let i = 0; i < xfadeSamp; i++) {
        const t = (i + 1) / xfadeSamp; // just above 0 → 1.0
        // Linear blend: tail audio fades toward the first sample value
        const tailIdx = regionLen - xfadeSamp + i;
        dst[tailIdx] = dst[tailIdx] * (1 - t) + headVal * t;
      }
    }
  }

  // Find anchor index BEFORE remapping (indexOf won't work after spread copy)
  let startIdx = 0;
  if (anchorParticle) {
    const idx = seqParticles.indexOf(anchorParticle);
    if (idx > 0) startIdx = idx;
  }

  // Remap particle grainStart times relative to the new buffer (offset=0)
  const offsetShift = loopStart;
  for (let i = 0; i < seqParticles.length; i++) {
    seqParticles[i] = { ...seqParticles[i], grainStart: seqParticles[i].grainStart - offsetShift };
  }

  // Anchor position for distance calculations — where the gesture RELEASED
  // (pins.js pinAnchorInto): a drop by hand is the hand's particle; a stroke
  // a brush pins at its end (looper) is its LAST mark (Ek, 2026-09-05 —
  // this was `seqParticles[0]`, so the looper anchored every stroke at its
  // start whatever _resolveStrokeAnchor said, because the slot takes the
  // payload's anchor, not that one).
  const anchorP = anchorParticle || seqParticles[seqParticles.length - 1];

  return {
    particles: seqParticles,
    buffer:    loopBuffer,             // crossfaded, standalone
    loopStart: 0,                      // buffer start (always 0 — region was extracted)
    loopEnd:   loopBuffer.duration,    // buffer end (full buffer)
    startIdx,
    anchorLon: anchorP.lon,
    anchorLat: anchorP.lat
  };
}

// ── The overdub brush (Ek, 2026-09-04; docs/archive/OVERDUB-PLAN.md) ────────────────
// A take recorded while a pinned loop plays, folded onto that loop's cycle
// and played back as a LAYER of the pin: every cycle, at the phase it was
// played, at 1× whatever the master's speed. The take's marks land on the
// sphere as their own stroke (tape material, never armed as a trigger), so
// the cursor can erase and undo them; the layer is the pin's.

/** The press: pick the master — the nearest pinned loop, no radius — and
 *  hold it for the whole take. Nothing pinned, and the take SEEDS (Ek,
 *  2026-09-06): it runs as an ordinary tape take with `S._overdubSeed` set,
 *  and events.js arms it with `loop: true`, so the looper hook pins it on
 *  release — the first press lays the main loop, the second overdubs onto
 *  it. Nothing refuses any more; the hook it flashed is gone with it. */
export function beginOverdub() {
  const { lon, lat } = getCursorPos();
  const i = nearestLoopPin(lon, lat);
  if (i < 0) { S._overdubSeed = true; S._overdubTake = null; return true; }
  const seq = S.commitSlots[i];
  seq._ovdWrap = undefined;            // the wrap counter starts with the take
  S._overdubTake = { seq, ov: null };  // `ov` is the provisional layer once the first wrap has passed
  return true;
}

/** Fold a take onto a master's cycle: one buffer the length of the wall
 *  cycle (loop length ÷ |speed|), the take written in from `phase0` and
 *  wrapping — every pass of a long take summed, a short take landing once
 *  where it was played. Nothing is resampled. */
export function buildOverdubLayer(seq, take, phase0) {
  if (!take) return null;
  return _foldOntoCycle(seq, take.data, take.sampleRate, phase0);
}
function _foldOntoCycle(seq, samples, sr, phase0) {
  const actx = ensureAudioContext();
  const spd = Math.abs(seq.speed || 1);
  const cycleS = (seq.loopEnd - seq.loopStart) / spd;
  if (!(cycleS > 0) || !samples) return null;
  const L = Math.max(1, Math.round(cycleS * sr));
  const layer = actx.createBuffer(1, L, sr);
  const dst = layer.getChannelData(0);
  let pos = Math.round(((phase0 % cycleS) + cycleS) % cycleS * sr) % L;
  for (let n = 0; n < samples.length; n++) {
    dst[pos] += samples[n];
    if (++pos === L) pos = 0;
  }
  return layer;
}

/** A take still recording, heard pass by pass: at each wrap of the master
 *  (grain.js, the seq block) the take SO FAR — the recorder's raw pool up
 *  to its write head, which is exactly what the seal will keep — is folded
 *  onto the cycle and swapped in under a crossfade. Everything already
 *  played sits behind the playhead, so it comes round on the next pass;
 *  the final layer replaces this one at the seal (attachOverdub). */
export function refreshLiveOverdub() {
  const t = S._overdubTake;
  if (!t?.seq || !S.isRecording || !S.recordingRaw || !(S.recordingWritePos > 0)) return null;
  const seq = t.seq;
  if (S.commitSlots.indexOf(seq) < 0) return null;
  const slot = S.liveRecBuffers[S.currentLiveBufferIdx];
  const phase0 = masterPhaseWall(seq, (slot?.startedAt ?? 0) - (S.latency?.roundTripS || 0));
  const layer = _foldOntoCycle(seq, S.recordingRaw.subarray(0, S.recordingWritePos), S.recordingSampleRate, phase0);
  if (!layer) return null;
  const actx = ensureAudioContext();
  // How much of the take this layer holds, in seconds — what is HEARD of it
  // so far, which is what the renderer draws heads for (Ek, 2026-09-05: "as
  // I continue to overdub over 2 or 3 or 4 times longer I also expect new
  // playheads to appear for those portions").
  const foldedS = S.recordingWritePos / S.recordingSampleRate;
  if (!t.ov) {
    t.ov = { strokeId: S.currentStrokeId, phase0, buffer: null, layer, live: true, foldedS, _src: null, _gain: null };
    (seq.overdubs ||= []).push(t.ov);
    if (seq._sourceNode && !seq._sourceNode._stopped) startOverdubLayer(seq, t.ov, actx, { fadeIn: 0.008 });
    S._pinsDirty = true;
    S._syncCommitUI?.();
  } else {
    t.ov.phase0 = phase0; t.ov.foldedS = foldedS;
    swapOverdubLayer(seq, t.ov, layer, actx);
  }
  return t.ov;
}
S._overdubLiveWrap = refreshLiveOverdub;

/** The stroke's end (events.js _commitTraceStroke, after the take seals):
 *  the take joins its master as a layer, phased by where the master was
 *  when the take's first sample landed. */
export function attachOverdub(strokeId, seq, provisional = null) {
  if (!(strokeId > 0) || !seq) return null;
  const entry = S.strokeHistory.find(h => h.strokeId === strokeId);
  const slot  = entry && entry.liveBufferIndex >= 0 ? S.liveRecBuffers[entry.liveBufferIndex] : null;
  const gone  = S.commitSlots.indexOf(seq) < 0;   // the master went while the take ran
  if (gone || !slot?.buffer) {
    // Nothing to join: a provisional layer already on the slot is dropped,
    // and the caller hands the stroke back as a plain line.
    if (provisional && seq.overdubs) {
      const i = seq.overdubs.indexOf(provisional);
      if (i >= 0) { if (provisional._src && !provisional._src._stopped) { try { provisional._src.stop(); } catch (_) {} provisional._src._stopped = true; } seq.overdubs.splice(i, 1); }
    }
    return null;
  }
  // The round trip (js/latency.js): the take was sung against what was
  // HEARD, late by `out`, and captured late by `in` — pull the phase back.
  const phase0 = masterPhaseWall(seq, (slot.startedAt ?? 0) - (S.latency?.roundTripS || 0));
  const layer  = buildOverdubLayer(seq, slot.buffer, phase0);
  if (!layer) return null;
  const actx = ensureAudioContext();
  let ov = provisional && seq.overdubs?.includes(provisional) ? provisional : null;
  if (ov) {
    // The take was heard pass by pass; the sealed layer lands in its place.
    ov.strokeId = strokeId; ov.phase0 = phase0; ov.buffer = slot.buffer; ov.live = false; delete ov.foldedS;
    swapOverdubLayer(seq, ov, layer, actx);
  } else {
    ov = { strokeId, phase0, buffer: slot.buffer, layer, _src: null, _gain: null };
    (seq.overdubs ||= []).push(ov);
    if (seq._sourceNode && !seq._sourceNode._stopped) startOverdubLayer(seq, ov, actx);
  }
  S._pinsDirty = true;
  S._syncCommitUI?.();
  return ov;
}

/** The pin goes, the family becomes ordinary lines (Ek, 2026-09-04: "all
 *  overdubs should become normal loops once unpinned"). Each overdub's marks
 *  are still on the sphere as a tape stroke that was never armed; arming it
 *  plain — one trigger, no audition, no looper hook — makes it what a line
 *  stroke is once its own pin is released: scratch the cursor can fire. The
 *  layers stop with the master's source. `keepPaint` false (a self-killing
 *  master) deletes the marks instead, as the master deletes its own. */
export function orphanOverdubs(seq, { keepPaint = true } = {}) {
  const ovs = seq?.overdubs;
  if (!ovs?.length || seq._orphaned) return 0;
  // The list stays on the slot: the layer sources are stopped by the same
  // teardown that stops the master's, after this, and they need finding.
  seq._orphaned = true;
  for (const ov of ovs) {
    if (!(ov.strokeId > 0) || ov.live) continue;   // a take still recording is handed back at its own seal
    if (keepPaint) {
      if (S.particles.some(p => p.strokeId === ov.strokeId)) { try { S._armTrigger?.(ov.strokeId, { plain: true }); } catch (_) {} }
    } else {
      S.particles = S.particles.filter(p => p.strokeId !== ov.strokeId);
      S._particleVersion = (S._particleVersion || 0) + 1;
    }
  }
  S._syncTriggerUI?.();
  return ovs.length;
}

/** Undo or erase-all of an overdub stroke: its layer goes, the master stays. */
export function removeOverdubByStrokeId(strokeId) {
  let n = 0;
  for (const c of S.commitSlots) {
    if (!c?.overdubs?.length) continue;
    for (let i = c.overdubs.length - 1; i >= 0; i--) {
      const ov = c.overdubs[i];
      if (ov.strokeId !== strokeId) continue;
      if (ov._src && !ov._src._stopped) {
        // A short fade, not a bare stop: this is also the erase path.
        try {
          const now = ensureAudioContext().currentTime;
          if (ov._gain) { ov._gain.gain.setValueAtTime(ov._gain.gain.value, now); ov._gain.gain.linearRampToValueAtTime(0, now + 0.012); }
          ov._src.stop(now + 0.02);
        } catch (_) {}
        ov._src._stopped = true;
      }
      c.overdubs.splice(i, 1); n++;
    }
  }
  if (n) { S._pinsDirty = true; S._syncCommitUI?.(); }
  return n;
}
S._beginOverdub  = beginOverdub;
S._attachOverdub = attachOverdub;

export function createSeqFromStroke(strokeId, anchorParticle) {
  if (strokeId < 0) return;

  // Resolve anchor position early for overflow nearest-mode
  const { lon: anchorLon, lat: anchorLat } = _resolveStrokeAnchor(strokeId, anchorParticle);

  const slotIndex = _findSeqSlot(anchorLon, anchorLat);
  if (slotIndex === -1) {
    // All slots full with overflow=off — signal the rejected attempt.
    // Loops reach the slot pool through here rather than startSeedPlant(), so
    // this needs its own dispatch or committing a loop when full is silent.
    window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'full' } }));
    return;
  }
  // The audio BEFORE the eviction: a stroke that cannot make a playable region
  // must not cost the pin that was sitting in the slot. It used to be built
  // after, so a drop on unusable material silently emptied a slot.
  const payload = buildLoopPayload(strokeId, anchorParticle);
  if (!payload) return;

  // If the overflow rule picked an occupied slot, take the pin out through the
  // ONE path and remember it: the drop's undo puts it back. Until 2026-09-14
  // this stopped the audio and nulled the slot by hand, so `_lastEvicted` was
  // never set on the create path and undoing a loop that had evicted a pin
  // brought back the loop and not the pin — the cloud path (_reserveCloud) and
  // the extra-playhead path had both been doing it correctly beside it.
  _lastEvicted = null;
  if (S.commitSlots[slotIndex]) {
    _lastEvicted = S.commitSlots[slotIndex];
    removePinSlot(_lastEvicted);
  }

  const color = COMMIT_COLORS[slotIndex];
  // The first pass starts ON THE RELEASE (2026-09-04): the looper commits a
  // stroke 60 ms and a seal after the button went up, and the source is
  // built a scheduler tick after that. Started from the top then, the loop's
  // downbeat was that late. A fresh take carries its release on the clock;
  // the seq start path begins the first pass as far in as the release is
  // behind (grain.js). A pin dropped onto old material keeps its anchor.
  const _tk = S.particles.find(p => p.strokeId === strokeId && p.source === 'live');
  const _takeSlot = _tk ? S.liveRecBuffers[_tk.liveBufferIdx] : null;
  const _phaseAnchor = (!anchorParticle && _takeSlot?.releaseAt != null && S.audioCtx &&
                        (S.audioCtx.currentTime - _takeSlot.releaseAt) < 1.0) ? _takeSlot.releaseAt : null;
  S.commitSlots[slotIndex] = {
    type: 'loop',
    slotIndex,
    strokeId,
    _phaseAnchor,
    particles:      payload.particles,
    buffer:         payload.buffer,          // crossfaded loop buffer
    loopStart:      payload.loopStart,
    loopEnd:        payload.loopEnd,
    playheadIndex:  payload.startIdx,
    startOffset:    anchorParticle ? payload.particles[payload.startIdx].grainStart : 0,
    direction:      S.commitCloudLoopMode === 'rev' ? -1 : 1,
    speed:          S.commitLoopParams.speed ?? 1.0,
    playing:        true,
    color,
    anchorLon:      payload.anchorLon,  // position used for distance/nearest calcs
    anchorLat:      payload.anchorLat,
    _sourceNode:    null,           // AudioBufferSourceNode (created by scheduler)
    _gainNode:      null,           // GainNode for volume control
    _regionBuf:     null,           // the region copy the source plays (grain.js _regionCopy), cut lazily
    _createdAt:     performance.now() / 1000, // wallclock creation time (seconds)
    _startedAt:     0,              // audioContext.currentTime when started
    mute: false, solo: false,       // the pin's own flags (pins.js)
    // The loop's own ramps (2026-09-16): the same In / Out every new pin is
    // born with (Settings → Pins), the out never under the loop's declick —
    // the 15 ms the release used to read globally. See the cloud's.
    fadeIn:  S.commitAttack,
    fadeOut: Math.max(S.commitRelease || 0, (S.loopFadeTimeMs || 15) / 1000),
    grainParams: {
      volume: S.commitLoopParams.volume ?? S.grainOverrides.volume ?? S.grainParams.volume ?? 1.0
    }
  };
  // Born under a solo or a group mute, it is silent from its first tick.
  S._applyPinMix?.();
  _syncSeqButtonStates();
}

/**
 * Add a new playhead (seq slot) that shares the buffer of an existing loop.
 * The new slot gets its own speed/direction/volume from seqNextParams and
 * starts playing from the anchor particle's position in the loop.
 */
function addPlayheadFromExisting(sourceSeq, anchorParticle) {
  const { lon: aLon, lat: aLat } = getCursorPos();
  const slotIndex = _findSeqSlot(aLon, aLat);
  if (slotIndex === -1) {
    // All slots full, overflow off — signal the rejected attempt.
    window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'full' } }));
    return;
  }
  // If replacing an existing commit (the overflow rule), take it out through
  // the one path, and remember it: the pin's undo puts it back.
  _lastEvicted = null;
  if (S.commitSlots[slotIndex]) {
    _lastEvicted = S.commitSlots[slotIndex];
    removePinSlot(_lastEvicted);
  }

  let startIdx = 0;
  if (anchorParticle) {
    const idx = sourceSeq.particles.indexOf(anchorParticle);
    if (idx > 0) startIdx = idx;
  }

  const color = COMMIT_COLORS[slotIndex];
  S.commitSlots[slotIndex] = {
    type: 'loop',
    slotIndex,
    strokeId:       sourceSeq.strokeId,
    particles:      sourceSeq.particles,     // shared reference — same stroke particles
    buffer:         sourceSeq.buffer,         // shared AudioBuffer
    loopStart:      sourceSeq.loopStart,
    loopEnd:        sourceSeq.loopEnd,
    playheadIndex:  startIdx,
    // Clamped: an anchor can sit earlier in the buffer than the region start
    // (non-monotonic strokes — see buildLoopPayload), and a negative offset
    // makes src.start() throw inside the scheduler.
    startOffset:    anchorParticle ? Math.max(0, anchorParticle.grainStart - sourceSeq.loopStart) : 0,
    direction:      S.commitCloudLoopMode === 'rev' ? -1 : 1,
    speed:          S.commitLoopParams.speed ?? 1.0,
    playing:        true,
    color,
    anchorLon:      aLon,                     // drop point — used for distance calcs
    anchorLat:      aLat,
    _sourceNode:    null,
    _gainNode:      null,
    _regionBuf:     null,
    _createdAt:     performance.now() / 1000,
    _startedAt:     0,
    fadeIn:  S.commitAttack,
    fadeOut: Math.max(S.commitRelease || 0, (S.loopFadeTimeMs || 15) / 1000),
    grainParams: {
      volume: S.commitLoopParams.volume ?? S.grainOverrides.volume ?? S.grainParams.volume ?? 1.0
    }
  };
  S._applyPinMix?.();
  _syncSeqButtonStates();
}

/**
 * Stop and remove a single sequence by slot index.
 */
export function removeSeq(slotIndex, immediate = false) {
  const slot = S.commitSlots[slotIndex];
  if (!slot) return;
  if (slot.type === 'loop') {
    if (immediate) {
      // Near-instant kill with a 10 ms gain ramp to mask the click that a bare
      // `src.stop()` on a running AudioBufferSourceNode produces on the main
      // output bus.  Used by undo — the slot is nulled immediately below so the
      // seed scheduler/UI stop referencing this loop right away; the gain node
      // and source stay alive just long enough to finish the fade, then clean
      // themselves up via the `ended` listener.  10 ms is imperceptible as a
      // delay but decisive enough to kill the transient.
      const src  = slot._sourceNode;
      const gain = slot._gainNode;
      const actx = S.audioCtx;
      orphanOverdubs(slot);
      if (src && !src._stopped) {
        if (gain && actx) {
          const now     = actx.currentTime;
          const fadeSec = 0.010; // 10 ms
          try {
            gain.gain.cancelScheduledValues(now);
            gain.gain.setValueAtTime(gain.gain.value, now);
            gain.gain.linearRampToValueAtTime(0, now + fadeSec);
          } catch (_) {}
          try { src.stop(now + fadeSec + 0.002); } catch (_) {}
          src._stopped = true;
          stopOverdubLayers(slot, { when: now + fadeSec + 0.002 });
          // Defer extra-node cleanup until the source actually ends so the
          // fade has somewhere to run through.
          src.addEventListener('ended', () => {
            if (slot._extraNodes) {
              for (const n of slot._extraNodes) { try { n.disconnect(); } catch (_) {} }
              slot._extraNodes = null;
            }
            slot._sourceNode = null;
            slot._gainNode   = null;
          }, { once: true });
        } else {
          // No gain node or context — fall back to the old hard stop.
          try { src.stop(); } catch (_) {}
          src._stopped = true;
          _cleanupSeqNodes(slot);
        }
      } else {
        _cleanupSeqNodes(slot);
      }
    } else {
      _stopSeqAudio(slot);
    }
  }
  S.commitSlots[slotIndex] = null;
  S._syncCommitUI?.();
}

/**
 * Remove any sequence whose strokeId matches the given id.
 * Called from undoLastStroke to clean up sequences when their stroke is undone.
 */
export function removeSeqByStrokeId(strokeId) {
  // Scan the full array (not just commitSlotCount) — a slot may have been
  // created when the active count was higher and still be alive.
  let found = 0;
  for (let i = 0; i < MAX_COMMITS; i++) {
    const slot = S.commitSlots[i];
    if (slot && slot.strokeId === strokeId) {
      console.log(`[undo] removing commit slot ${i} (type=${slot.type}, strokeId=${strokeId}, src=${!!slot._sourceNode})`);
      removeSeq(i, /* immediate */ true);
      found++;
    }
  }
  // Triggers built on this stroke go too. The gate's own rebuild would drop
  // them a tick later once it saw the particles gone, but undo should be silent
  // immediately rather than on the next scheduler tick.
  if (S.triggers?.length) {
    for (let i = S.triggers.length - 1; i >= 0; i--) {
      if (S.triggers[i].strokeId !== strokeId) continue;
      S._stopTriggerAudio?.(S.triggers[i], 'fade');
      S.triggers.splice(i, 1);
      found++;
    }
    S._syncTriggerUI?.();
  }
  if (!found) {
    console.warn(`[undo] no commit slot found for strokeId=${strokeId}. Slots:`,
      S.commitSlots.map((s, i) => s ? `${i}:${s.type}(sid=${s.strokeId})` : null).filter(Boolean));
  }
}

// ── Unified commit operations ─────────────────────────────────────────────

/**
 * Release the SELECTED pin — nearest to the cursor or the oldest, by
 * `S.selectionMode` (pins.js selectedPinSlot, which is also what the rail
 * marks, so the hand sees what ⌘D is about to take). Replaces
 * uprootNearestSeed() and pickupSeqRemove().
 * Clouds get a release envelope; loops leave by `S.loopReleaseMode`.
 */
export function releaseCommit() {
  const { lon, lat } = getCursorPos();
  const targetSlot = S._selectedPinSlot?.(lon, lat) ?? -1;
  if (targetSlot === -1) return;
  _releaseSlotAt(targetSlot);
}

/** The one release tail — shared by releaseCommit and the layer pickup. */
function _releaseSlotAt(targetSlot) {
  const slot = S.commitSlots[targetSlot];
  if (!slot) return;
  history.push(_unpinAction([slot]));
  if (slot.type === 'cloud') {
    // Cloud: the pin's OWN fade out (2026-09-16); the global is the default
    // a pin is born with, not what it leaves by.
    const rel = slot.fadeOut ?? S.commitRelease ?? 0;
    // Uproot means DESTROY, from either state. A composer-held cloud carries
    // _composerHold, which tells the scheduler's release branch to hold at
    // silence instead of deleting — leave it set and this release would land
    // on a hold and the commit would be unkillable.
    slot._composerHold = false;
    if (rel <= 0) {
      S.commitSlots[targetSlot] = null;
    } else {
      slot._envRelease  = rel;
      slot._releasingAt = performance.now() / 1000;
    }
  } else {
    // Loop: stop audio — both fade and play-to-end defer slot removal to 'ended' event
    _stopSeqAudio(slot, S.loopReleaseMode === 'play-to-end', slot.fadeOut ?? null);
  }
  // The group's flags go with its last pin — now, while this one is only
  // leaving, not when its slot is finally freed (pins.js pruneEmptyGroups).
  S._prunePinGroups?.();
  S._pinsDirty = true;
  S._syncCommitUI?.();
  (S.updateSeedBanksUI || updateSeedBanksUI)();

  // Signal the release for LED feedback on the cursor x-IMU3 (2 green blinks).
  // releaseCommit() is the unified pickup path used by the keyboard shortcut,
  // MIDI, and UI buttons — uprootNearestSeed() only fires for the legacy seed
  // path, so without this dispatch picking up a cloud/loop showed no blink.
  window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'release' } }));
}

// Scratch for the nearest-loop search below. `releaseNearestPin()` lived here
// until 2026-09-10: the `-` key's own nearest-only unpin, which bypassed the
// selected-pin setting while the action honoured it. Every unpin is
// releaseCommit() now (Ek: "unpin does the version of whatever the setting is").
const _anch2 = [0, 0];

/** Self-killing loop (#239), called from the scheduler's wrap detection when
 *  a slot's baked `passes` runs out: release the slot through the real tail,
 *  then delete its paint — the loop was born promising to clean up after
 *  itself. Trigger views over the same stroke go with the marks. */
export function selfKillSlot(seq) {
  if (seq._selfKilled) return;   // the wrap edge keeps firing while the fade runs
  const idx = S.commitSlots.indexOf(seq);
  if (idx === -1) return;
  seq._selfKilled = true;
  const sid = seq.strokeId;
  orphanOverdubs(seq, { keepPaint: false });   // the family's paint goes with the master's
  // Always FADE, never play-to-end (which would grant an audible pass N+1),
  // and always a SHORT fade — the per-pass fades already did the decay, and
  // S.loopFadeTimeMs belongs to manual releases and can be seconds long.
  seq._composerHold = false;
  _stopSeqAudio(seq, false, 0.12);
  if (sid > 0) {
    S.particles = S.particles.filter(p => p.strokeId !== sid);
    S._particleVersion = (S._particleVersion || 0) + 1;
    if (S.triggers?.length) S.triggers = S.triggers.filter(t => t.strokeId !== sid);
  }
  S._pinsDirty = true;
  S._syncCommitUI?.();
  (S.updateSeedBanksUI || updateSeedBanksUI)();
}
S._selfKillSlot = selfKillSlot;

/** Erase write-through for held loops (#243). A loop slot owns a SNAPSHOT —
 *  buildLoopPayload copies the marks and extracts a crossfaded buffer — so
 *  erasing scratch paint never reached its audio: the stroke vanished and the
 *  loop kept singing. The rule (Ek): erasing part of a HELD loop silences
 *  that part INSIDE the loop while it keeps rolling — erase edits the
 *  material, never the time — and erasing the whole stroke takes the loop
 *  with it. The erased time-spans are zeroed IN PLACE in the slot's
 *  AudioBuffer (the playing source shares the object, so the change is heard
 *  on the next pass through that region), with short ramps so the cuts don't
 *  click. Copies are matched to erased originals by position — the one thing
 *  buildLoopPayload's rebase preserves verbatim — and the matched copies are
 *  NEVER removed: the path is the loop's clock, so the circuit's length and
 *  pan traversal survive any amount of erasing (see the comment at the
 *  bottom of the loop). Trigger strokes are not handled here:
 *  refreshTriggers already trims and splits them (the line-brush behaviour,
 *  unchanged). */
/** Zero sample spans in place, with short ramps so the cuts don't click.
 *  Spans are MERGED before zeroing: zeroing each mark's span with its own
 *  edge ramps left a comb of ~6 ms full-level blips through a contiguous
 *  erase (the end-ramp of one span meeting the start-ramp of the next),
 *  ticking at the mark rate. One erase bite is one silence. */
function _zeroSpans(d, sr, spans) {
  if (!spans.length) return;
  const ramp = Math.floor(sr * 0.003);
  spans.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const sp of spans) {
    const m = merged[merged.length - 1];
    if (m && sp[0] <= m[1] + ramp) m[1] = Math.max(m[1], sp[1]);
    else merged.push([sp[0], sp[1]]);
  }
  for (const [m0, m1] of merged) {
    if (m1 <= m0) continue;
    const r = Math.min(ramp, Math.max(1, (m1 - m0) >> 1));
    // Ramp only against live audio — a neighbour already silent from an
    // earlier bite gets a hard (inaudible) cut instead of a blip.
    const rampIn  = m0 > 0 && Math.abs(d[m0 - 1]) > 1e-4;
    const rampOut = m1 < d.length && Math.abs(d[m1]) > 1e-4;
    for (let s = m0; s < m1; s++) {
      let f = 0;
      if (rampIn && s < m0 + r) f = 1 - (s - m0) / r;
      else if (rampOut && s >= m1 - r) f = (s - (m1 - r)) / r;
      d[s] *= f;
    }
  }
}

/** The span of audio a mark STANDS FOR in a whole-take buffer: from its own
 *  moment to the NEXT mark's, and for the last mark to the end (Ek,
 *  2026-09-10: erasing a tape line "visually takes the right bite out of the
 *  line but audio wise it seems to bite off a bit less than a second more
 *  on the downstream edge"). It used to be `grainStart + grainDuration`,
 *  and a live mark's `grainDuration` is the GRANULAR grain length of the
 *  brush that painted it — 0.6 s at the factory setting, up to seconds —
 *  which has nothing to do with how much of a take a tape mark covers. A
 *  mark is sized by the audio after it up to the next tick (paint-ticker.js,
 *  audio-features.js), so that window is its span: the marks are the
 *  buffer's timeline. `starts` is every mark's moment, sorted; the answer is
 *  the first start after `t`, else `endS`. */
function _spanEndAfter(starts, t, endS) {
  let lo = 0, hi = starts.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= t + 1e-6) lo = mid + 1; else hi = mid; }
  return lo < starts.length ? starts[lo] : endS;
}
function _sortedStarts(marks) { return marks.map(m => m.grainStart).sort((a, b) => a - b); }

function onMarksErased(removed) {
  if (!removed?.length) return;
  const byStroke = new Map();
  for (const r of removed) {
    if (!(r.strokeId > 0)) continue;
    let a = byStroke.get(r.strokeId);
    if (!a) byStroke.set(r.strokeId, a = []);
    a.push(r);
  }
  if (!byStroke.size) return;
  for (let i = 0; i < S.commitSlotCount; i++) {
    const slot = S.commitSlots[i];
    if (!slot || slot.type !== 'loop' || !(slot.strokeId > 0)) continue;
    const rem = byStroke.get(slot.strokeId);
    if (!rem) continue;
    const anyLeft = S.particles.some(p => p.strokeId === slot.strokeId);
    const buf = slot.buffer;
    if (!anyLeft || !buf) {
      // The whole stroke went. With overdubs still on it the FAMILY keeps
      // the clock (Ek, 2026-09-05: "the loop cycling should continue"): the
      // master's own audio is silenced whole and the cycle runs on for its
      // layers; the last overdub leaving is what releases the pin (below).
      if (slot.overdubs?.length && buf) {
        _zeroSpans(buf.getChannelData(0), buf.sampleRate, [[0, buf.length]]);
        slot._regionBuf = null;
        S._pinsDirty = true;
        continue;
      }
      // The loop goes with it. Short fade: this is an erase, not a musical
      // release.
      slot._composerHold = false;
      _stopSeqAudio(slot, false, 0.12);
      S._pinsDirty = true;
      S._syncCommitUI?.();
      continue;
    }
    const sr = buf.sampleRate;
    const spans = [];
    // The copies are the loop's whole timeline (they are never removed, see
    // below), so a copy's span ends at the next copy's moment.
    const starts = _sortedStarts(slot.particles);
    for (const c of slot.particles) {
      const hit = rem.some(r => Math.abs(r.lon - c.lon) < 1e-6 && Math.abs(r.lat - c.lat) < 1e-6);
      if (!hit) continue;
      c._silenced = true;   // advisory — the zeroed span below is what silences it
      spans.push([Math.max(0, Math.floor(c.grainStart * sr)),
                  Math.min(buf.length, Math.ceil(_spanEndAfter(starts, c.grainStart, buf.duration) * sr))]);
    }
    if (!spans.length) continue;
    _zeroSpans(buf.getChannelData(0), buf.sampleRate, spans);
    // The copies STAY (Ek, 2026-08-28): a pinned loop's path is its CLOCK —
    // a 4-second circuit stays a 4-second circuit however much audio is
    // erased out of it, leaving creative gaps rather than a shorter loop.
    // Removing matched copies here was the bug where erasing shortened the
    // drawn path and compressed the pan traversal (and, because a drawn loop
    // path usually closes back near its start, erasing "the front" also bit
    // the tail marks sitting beside it — heard as the END of the audio
    // disappearing). The spans are already silent in the buffer; the kept
    // copies keep the playhead and VBAP travelling the full circuit through
    // the gaps. The loop dies only when its whole scratch stroke goes — the
    // anyLeft check above.
    slot._regionBuf = null;   // a cached reversed copy is stale now
  }

  // Overdubs (Ek, 2026-09-05: "if I erase an overdub … that part of the
  // overdub stroke I erased should not play"). The same rule as a loop, one
  // level down: an overdub's marks ARE its stroke (no copies to match — the
  // removed marks carry their own take time), so the erased spans are zeroed
  // in the TAKE and the layer is rebuilt from it and swapped in, in phase,
  // under the usual seam. Rebuilding rather than zeroing the layer keeps a
  // long take's stacked passes honest: a span erased from one pass must not
  // take the other passes' audio at the same phase. The take is what the
  // session file carries, so the erase survives a reload. The whole stroke
  // gone takes the overdub off its master — the dot leaves the row — the
  // way a loop dies with its stroke. A take still recording is left alone;
  // it is folded from the recorder's pool, not from a sealed buffer.
  for (let i = 0; i < S.commitSlotCount; i++) {
    const slot = S.commitSlots[i];
    if (!slot?.overdubs?.length) continue;
    for (let k = slot.overdubs.length - 1; k >= 0; k--) {
      const ov = slot.overdubs[k];
      if (!(ov.strokeId > 0) || ov.live) continue;
      const rem = byStroke.get(ov.strokeId);
      if (!rem) continue;
      if (!S.particles.some(p => p.strokeId === ov.strokeId)) {
        removeOverdubByStrokeId(ov.strokeId);
        // The last overdub gone from a master whose own stroke is already
        // erased: nothing is left to keep the clock for, and the pin goes
        // the way it would have when its stroke went. Derived from the
        // marks, not a flag, so a session saved in between reads the same.
        if (!slot.overdubs.length && slot.strokeId > 0 && !S.particles.some(p => p.strokeId === slot.strokeId)) {
          slot._composerHold = false;
          _stopSeqAudio(slot, false, 0.12);
          S._pinsDirty = true;
          S._syncCommitUI?.();
        }
        continue;
      }
      const take = ov.buffer;
      if (!take) continue;
      const sr = take.sampleRate;
      // An overdub's marks ARE its stroke: the timeline is the removed marks
      // plus whatever of the stroke still stands (a mark erased earlier is
      // already silent, so its absence from the list changes nothing).
      const starts = _sortedStarts(rem.concat(S.particles.filter(p => p.strokeId === ov.strokeId)));
      // The take is shared memory (js/take.js): the bite lands for the grains too.
      _zeroSpans(take.data, sr, rem.map(r => [Math.max(0, Math.floor(r.grainStart * sr)),
                                     Math.min(take.length, Math.ceil(_spanEndAfter(starts, r.grainStart, take.duration) * sr))]));
      const layer = buildOverdubLayer(slot, take, ov.phase0);
      if (layer) swapOverdubLayer(slot, ov, layer, ensureAudioContext());
      ov._marks = null;   // the renderer's head cache
    }
  }
}
S._onMarksErased = onMarksErased;

/**
 * Release all commits. Clouds get envelope, loops fade/play-to-end.
 */
export function clearAllCommits() {
  const now = performance.now() / 1000;
  let released = false;
  const gone = S.commitSlots.filter(Boolean);
  if (gone.length) history.push(_unpinAction(gone));
  for (let i = 0; i < MAX_COMMITS; i++) {
    const slot = S.commitSlots[i];
    if (!slot) continue;
    if (slot.type === 'cloud') {
      const rel = slot.fadeOut ?? S.commitRelease ?? 0;   // the pin's own (2026-09-16)
      if (rel > 0 && !slot._releasingAt) {
        slot._envRelease  = rel;
        slot._releasingAt = now;
        released = true;
      } else if (rel <= 0) {
        S.commitSlots[i] = null;
        released = true;
      }
    } else {
      // Both fade and play-to-end defer slot removal to 'ended' event
      _stopSeqAudio(slot, S.loopReleaseMode === 'play-to-end', slot.fadeOut ?? null);
      released = true;
    }
  }
  S._syncCommitUI?.();
  (S.updateSeedBanksUI || updateSeedBanksUI)();
  // Releasing everything is still a release — releasing one commit blinked but
  // clearing the board didn't, which read as the LED having missed the action.
  // Guarded so clearing an already-empty board stays silent.
  if (released) window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'release' } }));
}

// ── Sequence panel helpers ────────────────────────────────────────────────

/**
 * Find the nearest active (playing) sequence slot to the given lon/lat.
 * Distance is measured to the first particle in the sequence.
 */
export function findNearestSeqSlot(refLon, refLat, filterPlaying = null) {
  let nearestSlot = -1, nearestAng = Infinity;
  for (let i = 0; i < S.commitSlotCount; i++) {
    const seq = S.commitSlots[i];
    if (!seq || seq.type !== 'loop') continue;
    if (filterPlaying !== null && seq.playing !== filterPlaying) continue;
    if (!pinAnchorInto(seq, _anch2)) continue;
    const ang = angleBetweenSphere(_anch2[0], _anch2[1], refLon, refLat);
    if (ang < nearestAng) { nearestAng = ang; nearestSlot = i; }
  }
  return nearestSlot;
}

/**
 * Stop a sequence's audio nodes without removing it from its slot.
 * Uses a short fade-out to avoid click artifacts from abrupt stops.
 */
/**
 * Stop a loop's audio. Two modes:
 *   'fade' (default) — 15ms fade-out then stop.
 *   'play-to-end'    — disable looping so the source plays through to loopEnd,
 *                       with a short fade-out before it ends. Slot cleanup deferred
 *                       to the 'ended' event.
 */
function _stopSeqAudio(seq, playToEnd = false, fadeSecOverride = null) {
  const gain = seq._gainNode;
  const src  = seq._sourceNode;
  // The pin is leaving by every road through here; its overdubs are handed
  // back to the sphere now, while the layers ride out the fade or the pass.
  if (!seq._selfKilled) orphanOverdubs(seq);

  if (playToEnd && gain && src && !src._stopped) {
    const actx = S.audioCtx;
    if (actx && src.loop) {
      // Calculate remaining time to end of current loop pass
      const now = actx.currentTime;
      const elapsed = (now - (seq._startedAt || now)) * Math.abs(seq.speed || 1);
      const loopLen = (src.loopEnd || src.buffer?.duration || 1) - (src.loopStart || 0);
      const posInLoop = loopLen > 0 ? elapsed % loopLen : 0;
      const remaining = loopLen - posInLoop;
      const remainSec = remaining / Math.abs(seq.speed || 1);

      // Disable looping — source will naturally stop at loopEnd
      src.loop = false;
      stopOverdubLayers(seq, { playToEnd: true });

      // Schedule fade-out over last 50ms (or less if loop is very short)
      const fadeTime = Math.min(0.05, remainSec * 0.5);
      const fadeStart = now + Math.max(0, remainSec - fadeTime);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, fadeStart);
      gain.gain.linearRampToValueAtTime(0, fadeStart + fadeTime);

      // Mark as releasing-to-end so grain scheduler skips playhead updates
      seq._playingToEnd = true;

      // Clean up on natural end
      // `gen` and `extra` are THIS source's: if undo puts the pin back before
      // the fade ends, the slot carries new nodes and a new generation, and
      // this handler must only tidy its own.
      const gen = seq._gen | 0, extra = seq._extraNodes;
      src.addEventListener('ended', () => {
        src._stopped = true;
        if (extra) for (const n of extra) { try { n.disconnect(); } catch (_) {} }
        if ((seq._gen | 0) !== gen) return;
        seq._extraNodes = null;
        seq._sourceNode = null;
        seq._gainNode   = null;
        seq._playingToEnd = false;
        // Remove from slot
        const idx = S.commitSlots.indexOf(seq);
        if (idx >= 0) S.commitSlots[idx] = null;
        S._syncCommitUI?.();
        (S.updateSeedBanksUI || updateSeedBanksUI)();
      }, { once: true });
      return;
    }
  }

  // Default: fade-out using loopFadeTimeMs (or a caller's own fade — the
  // self-kill must not borrow the user's manual-release fade, which can be
  // seconds long; its decay already happened pass by pass)
  const FADE_MS = fadeSecOverride != null ? fadeSecOverride * 1000 : (S.loopFadeTimeMs || 15);
  if (gain && src) {
    const actx = S.audioCtx;
    if (actx) {
      const now = actx.currentTime;
      const fadeSec = FADE_MS / 1000;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + fadeSec);
      try { src.stop(now + fadeSec + 0.01); } catch (_) {}
      stopOverdubLayers(seq, { when: now + fadeSec + 0.01 });

      // Mark as fading so grain scheduler / slot logic can treat it as releasing
      seq._fadingOut = true;

      // Defer cleanup until source actually ends (after the fade completes)
      // `gen` and `extra` are THIS source's: if undo puts the pin back before
      // the fade ends, the slot carries new nodes and a new generation, and
      // this handler must only tidy its own.
      const gen = seq._gen | 0, extra = seq._extraNodes;
      src.addEventListener('ended', () => {
        src._stopped = true;
        if (extra) for (const n of extra) { try { n.disconnect(); } catch (_) {} }
        if ((seq._gen | 0) !== gen) return;
        seq._extraNodes = null;
        seq._sourceNode = null;
        seq._gainNode   = null;
        seq._fadingOut  = false;
        // Remove from slot
        const idx = S.commitSlots.indexOf(seq);
        if (idx >= 0) S.commitSlots[idx] = null;
        S._syncCommitUI?.();
        (S.updateSeedBanksUI || updateSeedBanksUI)();
      }, { once: true });
    } else {
      try { src.stop(); } catch (_) {}
      src._stopped = true;
      _cleanupSeqNodes(seq);
    }
  } else if (src) {
    try { src.stop(); } catch (_) {}
    src._stopped = true;
    _cleanupSeqNodes(seq);
  } else {
    _cleanupSeqNodes(seq);
  }
}

/** Immediate cleanup helper for nodes when no deferred cleanup is needed */
function _cleanupSeqNodes(seq) {
  if (seq._extraNodes) {
    for (const n of seq._extraNodes) { try { n.disconnect(); } catch (_) {} }
    seq._extraNodes = null;
  }
  seq._sourceNode = null;
  seq._gainNode   = null;
}

// pickupSeqPause, pickupSeqRemove, dropNearestSeq removed — unified model
// uses releaseCommit() (⌘C) which handles both clouds and loops.
// Pause/resume is no longer available; commits are either active or released.

/**
 * Drop a sequence loop from the nearest particle within the cursor's search
 * radius. Only works if there's actually a particle under the cursor right now
 * (same as granulation candidate logic). Uses the nearest particle's strokeId
 * to collect all particles from that stroke into a new sequence slot.
 */
/** The nearest TRIGGER mark in reach — the fallback search, for tape material
 *  no armed trigger covers (an unarmed take, a `plain` stroke): there is no
 *  gate to ask where the cursor is, so ask the marks. Granular marks are not
 *  candidates — the cursor granulates them, it does not play them whole, and
 *  before 2026-09-14 the `.trig` test lived in the caller. */
function _nearestTrigParticle() {
  const { lon, lat } = getCursorPos();
  const searchRad = S.searchRadiusDeg * Math.PI / 180;
  let nearest = null, nearestAng = Infinity;
  for (let i = 0; i < S.particles.length; i++) {
    const p = S.particles[i];
    if (!p.trig || p.strokeId == null || p.strokeId < 0) continue;
    const ang = angleBetweenSphere(p.lon, p.lat, lon, lat);
    if ((S.nearestMode || ang < searchRad) && ang < nearestAng) {
      nearestAng = ang;
      nearest = p;
    }
  }
  return nearest;
}

/** The live loop slot already playing a stroke, if any: pinning it again adds
 *  another PLAYHEAD on the same buffer rather than refusing. */
function _loopOnStroke(strokeId) {
  for (let i = 0; i < S.commitSlotCount; i++) {
    const slot = S.commitSlots[i];
    if (slot && slot.type === 'loop' && slot.strokeId === strokeId) return slot;
  }
  return null;
}

/** THE PIN TAKES THE MOMENT — ALL OF IT (Ek, 2026-09-14): "if my cursor touches
 *  more than 1 line, on one pin drop it should launch the same thing (sound) i
 *  heard when my cursor went on that position … the point of the pin is to take
 *  that moment, whatever it is and have it continue off cursor." One press pins
 *  EVERY line the cursor is on. It used to pin the nearest mark's stroke and
 *  only that, so standing on a chord of three lines and pinning kept one of
 *  them — the pin answered "what is closest" when the question is "what am I
 *  hearing".
 *
 *  WHICH LINES THE CURSOR IS ON IS THE TRIGGER GATE'S OWN ANSWER (`_inside`,
 *  js/trigger.js), not a second search of our own, for three reasons. The gate
 *  measures to the drawn SEGMENT between marks, so a cursor resting on the
 *  ribbon between two far-apart marks is inside for it and was outside for a
 *  mark-only search — the same hole that made lines "sometimes not fire". It
 *  keeps tracking while a stroke is CLAIMED by a pinned loop, so pinning a
 *  second playhead onto a line that is already pinned still works. And it keeps
 *  tracking while the scan is muted or the lens reads grains only, so a press
 *  still pins what the cursor is standing on when nothing is sounding.
 *
 *  The anchor is the gate's own `_nearestIdx` — the mark the cursor is over,
 *  which under `start: touch` is exactly where that line fired from, so the
 *  loop begins on the sound you just heard.
 *
 *  Returns the slots it made, `[]` when nothing was in reach — the caller
 *  decides what that means (tiles.js pinDown: a ghost cloud). */
export function dropSeqFromCursor() {
  const targets = [];
  for (const t of (S.triggers || [])) {
    if (!t?.trigger?._inside || !t.particles?.length || t.strokeId == null || t.strokeId < 0) continue;
    const i = Math.max(0, Math.min(t.particles.length - 1, t._nearestIdx | 0));
    targets.push({ strokeId: t.strokeId, anchor: t.particles[i] });
  }
  if (!targets.length) {
    const p = _nearestTrigParticle();
    if (!p) return [];
    targets.push({ strokeId: p.strokeId, anchor: p });
  }

  const made = [];
  _thisPress.clear();
  try {
    for (const tg of targets) {
      const before = S.commitSlots.slice();
      _lastEvicted = null;
      const existing = _loopOnStroke(tg.strokeId);
      if (existing) addPlayheadFromExisting(existing, tg.anchor);
      else createSeqFromStroke(tg.strokeId, tg.anchor);
      const slot = S.commitSlots.find((c, i) => c && c !== before[i]);
      if (slot) {
        made.push({ slot, evicted: _lastEvicted });
        _thisPress.add(slot.slotIndex);
      }
      _lastEvicted = null;
    }
  } finally {
    _thisPress.clear();
  }
  if (made.length) history.push(_pinsAction(made));
  return made.map(m => m.slot);
}

/**
 * Unified commit slot bank renderer — draws all commitSlots on one canvas.
 * Cloud slots get seed-style icons/glow; loop slots get progress arcs.
 * Max 8 per row; wraps to 2 rows when commitSlotCount > 8.
 * Called from the render loop (replaces separate updateSeqBanksUI + updateSeedBanksUI).
 */
export function updateCommitBanksUI() {
  const total = S.commitSlotCount;
  const filled = S.commitSlots.filter((s, i) => i < total && s !== null).length;
  const clouds = S.commitSlots.filter((s, i) => i < total && s !== null && s.type === 'cloud' && !(s._releasingAt > 0)).length;
  const loops  = S.commitSlots.filter((s, i) => i < total && s !== null && s.type === 'loop').length;

  // Update count label
  const countEl = document.getElementById('commitCountLabel');
  if (countEl) {
    const parts = [];
    if (clouds) parts.push(`${clouds} cloud`);
    if (loops)  parts.push(`${loops} loop`);
    countEl.textContent = parts.length ? `${parts.join(' + ')} / ${total}` : `0 / ${total}`;
  }


  // HUD commit dots — one dot per slot, colored when filled, grey when empty
  const dotsEl = document.getElementById('vmCommitDots');
  if (dotsEl) {
    const slotCount = S.commitSlotCount;
    // Rebuild dots only when slot count changes
    if (dotsEl.childElementCount !== slotCount) {
      dotsEl.innerHTML = '';
      for (let i = 0; i < slotCount; i++) {
        const dot = document.createElement('span');
        dot.className = 'vm-commit-dot';
        dotsEl.appendChild(dot);
      }
    }
    // Update colors
    for (let i = 0; i < slotCount; i++) {
      const dot = dotsEl.children[i];
      if (!dot) continue;
      const slot = S.commitSlots[i];
      if (slot && !(slot.type === 'cloud' && slot._releasingAt > 0)) {
        dot.style.background = COMMIT_COLORS[i % COMMIT_COLORS.length];
      } else {
        dot.style.background = '#444';
      }
    }
  }

  const canvas = document.getElementById('commitSlotsCanvas');
  if (!canvas) return;

  // Find nearest of each type for highlight
  const { lon, lat } = getCursorPos();
  const nearestSeed = clouds > 0 ? findNearestSeedSlot(lon, lat) : -1;
  const nearestSeq  = loops  > 0 ? findNearestSeqSlot(lon, lat) : -1;

  // Grid layout: max 8 per row
  const COLS = Math.min(total, 8);
  const ROWS = Math.ceil(total / COLS);
  const GAP = 4, PAD = 4;

  // Auto-size canvas height: 36px for 1 row, 68px for 2
  const targetH = ROWS > 1 ? 68 : 36;
  if (canvas.style.height !== targetH + 'px') canvas.style.height = targetH + 'px';

  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = Math.round(rect.width  || 160);
  const H = Math.round(rect.height || targetH);
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
  }
  const c = canvas.getContext('2d');
  c.save();
  c.scale(dpr, dpr);
  c.clearRect(0, 0, W, H);

  const cellW = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
  const cellH = (H - PAD * 2 - GAP * (ROWS - 1)) / ROWS;
  const r     = Math.max(0.5, Math.min(cellW, cellH) / 2 - 1);

  for (let i = 0; i < total; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const cx = PAD + col * (cellW + GAP) + cellW / 2;
    const cy = PAD + row * (cellH + GAP) + cellH / 2;
    const slot = S.commitSlots[i];

    if (slot && slot.type === 'loop') {
      _drawLoopSlot(c, cx, cy, r, slot, i === nearestSeq);
    } else if (slot && slot.type === 'cloud') {
      _drawCloudSlot(c, cx, cy, r, slot, i === nearestSeed);
    } else {
      // Empty slot
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fillStyle   = '#1a1a1a';
      c.fill();
      c.strokeStyle = '#2a2a2a';
      c.lineWidth   = 1;
      c.stroke();
    }
  }
  c.restore();
}

/** Draw a loop-type slot on the commit canvas */
function _drawLoopSlot(c, cx, cy, r, seq, isNearest) {
  // Nearest highlight
  if (isNearest) {
    c.save();
    c.shadowColor = seq.color;
    c.shadowBlur = 12;
    c.beginPath();
    c.arc(cx, cy, r + 3, 0, Math.PI * 2);
    c.strokeStyle = seq.color + '66';
    c.lineWidth = 2;
    c.stroke();
    c.restore();
  }

  // A composer-muted loop is STILL `playing` — its source keeps running so it
  // does not lose its place — so every existing check here reads true and it
  // would draw identical to a sounding loop. Silent and sounding must not look
  // the same on the bank; that is what the bank is for.
  const muted = !!seq.composerMuted;
  // Background circle
  const alpha = muted ? '18' : seq.playing ? (isNearest ? '77' : '44') : '22';
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fillStyle = seq.color + alpha;
  c.fill();

  // Dim track ring
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.strokeStyle = seq.playing && !muted ? seq.color + '33' : seq.color + '22';
  c.lineWidth = 2.5;
  c.stroke();
  // A dashed ring reads as "held" at a glance and survives being small.
  if (muted) {
    c.save();
    c.setLineDash([2, 2]);
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.strokeStyle = seq.color + 'aa';
    c.lineWidth = 1.2;
    c.stroke();
    c.restore();
  }

  // Nearest: full-brightness ring (matches cloud highlight style)
  if (isNearest) {
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.strokeStyle = seq.color + 'ff';
    c.lineWidth = 2.5;
    c.stroke();
  }

  // Progress arc
  if (seq.playing && seq.particles.length > 1) {
    const frac = seq.playheadIndex / seq.particles.length;
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + frac * Math.PI * 2;
    c.beginPath();
    c.arc(cx, cy, r, startAngle, endAngle);
    c.strokeStyle = seq.color;
    c.lineWidth = 2.5;
    c.stroke();
  }

  // Volume indicator
  if (seq.playing) {
    const vol = seq.grainParams.volume ?? 1;
    const volR = r * 0.5;
    c.beginPath();
    c.arc(cx, cy, volR, -Math.PI / 2, -Math.PI / 2 + vol * Math.PI * 2);
    c.strokeStyle = seq.color + '88';
    c.lineWidth = 1.5;
    c.stroke();
  }

  // Direction indicator
  if (seq.playing) {
    const arrowSize = r * 0.3;
    c.fillStyle = '#ffffff88';
    c.beginPath();
    if (seq.direction === -1) {
      c.moveTo(cx - arrowSize, cy);
      c.lineTo(cx + arrowSize * 0.6, cy - arrowSize * 0.5);
      c.lineTo(cx + arrowSize * 0.6, cy + arrowSize * 0.5);
    } else {
      c.moveTo(cx + arrowSize, cy);
      c.lineTo(cx - arrowSize * 0.6, cy - arrowSize * 0.5);
      c.lineTo(cx - arrowSize * 0.6, cy + arrowSize * 0.5);
    }
    c.fill();
  }

  // Pause icon
  if (!seq.playing) {
    c.fillStyle = seq.color + '88';
    const bw = r * 0.3, bh = r * 0.8;
    c.fillRect(cx - bw - 1, cy - bh / 2, bw, bh);
    c.fillRect(cx + 1,      cy - bh / 2, bw, bh);
  }
}

/** Draw a cloud-type slot on the commit canvas */
function _drawCloudSlot(c, cx, cy, r, seed, isNearest) {
  // A composer-stopped cloud sits at envelope gain 0 with its slot intact, so
  // without a floor it would draw as nothing at all and read as an empty slot.
  // It is not empty — it is holding, and it can be toggled back.
  const held = seed.playing === false;
  // Envelope state
  const envG = held ? 0 : (seed._envGainCurrent ?? 1);
  const isEnveloping = !held && envG < 0.999;
  // Held clouds get a floor rather than the envelope's 0, or the cell would be
  // blank and read as an empty slot. They also must NOT pulse — the pulse means
  // "an envelope is moving", and a held cloud is precisely not moving.
  let envAlphaMul = held ? 0.3 : envG;
  if (isEnveloping) {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.004 * Math.PI);
    envAlphaMul = envG * (0.5 + 0.5 * pulse);
  }

  if (held) {
    c.save();
    c.setLineDash([2, 2]);
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.strokeStyle = seed.color + 'aa';
    c.lineWidth = 1.2;
    c.stroke();
    c.restore();
  }

  // Nearest highlight
  if (isNearest) {
    c.save();
    c.globalAlpha = envAlphaMul;
    c.shadowColor = seed.color;
    c.shadowBlur = 12;
    c.beginPath();
    c.arc(cx, cy, r + 3, 0, Math.PI * 2);
    c.strokeStyle = seed.color + '66';
    c.lineWidth = 2;
    c.stroke();
    c.globalAlpha = 1;
    c.restore();
  }

  // Background circle
  const baseAlpha = isNearest ? 0x77 : 0x44;
  const modAlpha  = Math.round(baseAlpha * envAlphaMul);
  const alphaHex  = modAlpha.toString(16).padStart(2, '0');
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fillStyle = seed.color + alphaHex;
  c.fill();

  // Ring
  const ringAlpha = Math.max(0x22, Math.round(0x66 * envAlphaMul));
  const ringHex   = ringAlpha.toString(16).padStart(2, '0');
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.strokeStyle = seed.color + ringHex;
  c.lineWidth = 2.5;
  c.stroke();

  // Nearest brighter ring
  if (isNearest) {
    const nearAlpha = Math.round(0xff * envAlphaMul);
    const nearHex   = nearAlpha.toString(16).padStart(2, '0');
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.strokeStyle = seed.color + nearHex;
    c.lineWidth = 2.5;
    c.stroke();
  }

  // Seed icon
  const iconAlpha = Math.round(0x44 * envAlphaMul);
  const iconHex   = iconAlpha.toString(16).padStart(2, '0');
  if (seed.frames) {
    const ir = r * 0.45;
    const tipS = ir * 0.45;
    c.strokeStyle = '#ffffff' + iconHex;
    c.lineWidth = 1.5;
    if (seed.loopMode === 'pingpong') {
      // ↔ double-headed arrow
      c.beginPath(); c.moveTo(cx - ir, cy); c.lineTo(cx + ir, cy); c.stroke();
      c.beginPath(); c.moveTo(cx + ir - tipS, cy - tipS); c.lineTo(cx + ir, cy); c.lineTo(cx + ir - tipS, cy + tipS); c.stroke();
      c.beginPath(); c.moveTo(cx - ir + tipS, cy - tipS); c.lineTo(cx - ir, cy); c.lineTo(cx - ir + tipS, cy + tipS); c.stroke();
    } else if (seed.loopMode === 'rev') {
      // ← solid left arrow (top) + dashed right return (bottom) — mirror of forward
      c.beginPath(); c.moveTo(cx + ir, cy - tipS * 0.5); c.lineTo(cx - ir, cy - tipS * 0.5); c.stroke();
      c.beginPath(); c.moveTo(cx - ir + tipS, cy - tipS * 0.5 - tipS); c.lineTo(cx - ir, cy - tipS * 0.5); c.lineTo(cx - ir + tipS, cy - tipS * 0.5 + tipS); c.stroke();
      c.setLineDash([1.5, 1.5]);
      c.beginPath(); c.moveTo(cx - ir * 0.7, cy + tipS * 0.5); c.lineTo(cx + ir * 0.7, cy + tipS * 0.5); c.stroke();
      c.beginPath(); c.moveTo(cx + ir * 0.7 - tipS * 0.6, cy + tipS * 0.5 - tipS * 0.5); c.lineTo(cx + ir * 0.7, cy + tipS * 0.5); c.lineTo(cx + ir * 0.7 - tipS * 0.6, cy + tipS * 0.5 + tipS * 0.5); c.stroke();
      c.setLineDash([]);
    } else {
      // → solid right arrow (top) + dashed left return (bottom) — forward
      c.beginPath(); c.moveTo(cx - ir, cy - tipS * 0.5); c.lineTo(cx + ir, cy - tipS * 0.5); c.stroke();
      c.beginPath(); c.moveTo(cx + ir - tipS, cy - tipS * 0.5 - tipS); c.lineTo(cx + ir, cy - tipS * 0.5); c.lineTo(cx + ir - tipS, cy - tipS * 0.5 + tipS); c.stroke();
      c.setLineDash([1.5, 1.5]);
      c.beginPath(); c.moveTo(cx + ir * 0.7, cy + tipS * 0.5); c.lineTo(cx - ir * 0.7, cy + tipS * 0.5); c.stroke();
      c.beginPath(); c.moveTo(cx - ir * 0.7 + tipS * 0.6, cy + tipS * 0.5 - tipS * 0.5); c.lineTo(cx - ir * 0.7, cy + tipS * 0.5); c.lineTo(cx - ir * 0.7 + tipS * 0.6, cy + tipS * 0.5 + tipS * 0.5); c.stroke();
      c.setLineDash([]);
    }
  } else {
    const ir = r * 0.25;
    c.fillStyle = '#ffffff' + iconHex;
    c.beginPath(); c.arc(cx - ir, cy, ir, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(cx + ir, cy, ir, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(cx, cy - ir * 0.7, ir, 0, Math.PI * 2); c.fill();
  }
}

// Legacy aliases — redirect to unified renderer
export function updateSeqBanksUI()  { updateCommitBanksUI(); }
export function updateSeedBanksUI() { updateCommitBanksUI(); }

/**
 * Apply a patch object's parameters to live state.
 *
 * The one caller left is a SESSION IMPORT restoring the grain block the session
 * was played on (`patch` in the file — the resolved live block since 2026-09-03,
 * a bank slot object before that; docs/EXPORT-IMPORT-AUDIT-2026-08.md § E4).
 * It was split out of the bank's selectPreset for exactly that reason, and the
 * bank has since gone (sandbox/sunset-2026-09-03).
 *
 * Everything here is deliberately sparse (`'key' in preset`): an old user patch
 * saved only what it overrode, and an absent key must leave live state alone
 * rather than reset it to a default.
 */
export function applyPresetObject(preset) {
  if (!preset || typeof preset !== 'object') return;

  // ── Sparse application: only apply keys that exist in the preset ──────
  // For grain engine params, we still need the grainParams merge for
  // backward compatibility with factory presets and the grain engine's
  // fallback chain (grainOverrides → grainParams).

  // Check which grain-engine keys are present in this preset
  // retriggerMs is not in PARAM_REGISTRY
  // but factory presets may define it — keep here so factory recall still works.
  // fadeMode/fadeMs sit here alongside fadeRatio so a preset fully determines
  // its envelope.  Without them, selecting a preset would apply its fadeRatio
  // while leaving the unit on whatever the last patch used — so a 'pct' preset
  // loaded in 'ms' mode would silently ignore the ratio it was authored with.
  const GRAIN_KEYS = ['duration', 'durJitter', 'startJitter', 'durVar',
    'fadeRatio', 'fadeMode', 'fadeMs', 'period',
    'periodVar', 'pitchJitter', 'pitchShift', 'panSpread', 'volume', 'k',
    'retriggerMs'];
  const hasAnyGrainKey = GRAIN_KEYS.some(k => k in preset && preset[k] !== undefined && preset[k] !== null);

  if (hasAnyGrainKey) {
    // Merge grain params — only present keys overwrite grainParams
    for (const k of GRAIN_KEYS) {
      if (k in preset && preset[k] !== undefined && preset[k] !== null) {
        S.grainParams[k] = preset[k];
      }
    }
    // Clear overrides for keys that are mapped (so grainParams value is used)
    Object.keys(S.grainOverrides).forEach(k => {
      if (k in preset && preset[k] !== undefined && preset[k] !== null) {
        S.grainOverrides[k] = null;
      }
    });
  }

  // curveType maps to the worklet's envShape, which selects between its
  // prebuilt hann/tri tables — there is nothing to recompute on change.
  if ('direction' in preset && preset.direction)  S.grainDirection  = preset.direction;
  if ('curveType' in preset && preset.curveType)  S.grainCurveType  = preset.curveType;

  // ── A brush owns the SOUND. The cursor owns where it points ──────────────
  // `nearestMode`, `searchRadiusDeg`, `recencyN` and the radius-fade pair are
  // deliberately NOT read here any more (#212). They used to be, and the result
  // was that selecting a brush moved your reach and could flip your scope
  // mid-set — glitch yanked the radius to 80°, stutter to 6°. Where you are
  // pointing is not a property of the material you painted. Any such key left
  // in an old user patch is stripped on load rather than ignored here, so there
  // is one answer instead of a live key nothing reads.
  //
  // `k` and `grainKAllMode` DO belong to the brush: how many marks sound at
  // once is character, not geometry. wash at k=99 and vinyl at k=1 are
  // different instruments.
  if ('grainKAllMode' in preset && typeof preset.grainKAllMode === 'boolean') S.grainKAllMode = preset.grainKAllMode;
  if ('grainKSeqMode' in preset && typeof preset.grainKSeqMode === 'boolean') S.grainKSeqMode = preset.grainKSeqMode;
  if ('k' in preset && typeof preset.k === 'number') {
    if (typeof S.setSearchK === 'function') S.setSearchK(preset.k);
    else S.grainOverrides.k = preset.k;
  }
  if ('probability' in preset && typeof preset.probability === 'number') S.grainProbability = preset.probability;

  // ── Apply all additional sparse params (cursor, seed, looper, morph) ──
  applySparsePreset(preset);

  // Sync all UI controls
  syncAllUI();
}

export function updatePlaybackControls() {
  // Sync scope segmented toggle (nearest / area)
  const snapSeg = document.getElementById('snapToggleSeg');
  if (snapSeg) {
    snapSeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.snap === 'on') === S.nearestMode);
    });
  }
  // Show/hide area-only params based on scope
  const areaOnly = document.getElementById('areaOnlyParams');
  if (areaOnly) areaOnly.style.display = S.nearestMode ? 'none' : '';

  // Sync fill segmented toggle (all / k)
  const kAllSeg = document.getElementById('kAllSeg');
  if (kAllSeg) {
    kAllSeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.kall === 'on') === S.grainKAllMode);
    });
  }
  // Sync order segmented toggle (step / random)
  const kSeqSeg = document.getElementById('kSeqSeg');
  if (kSeqSeg) {
    kSeqSeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.kseq === 'on') === S.grainKSeqMode);
    });
  }
  // Grey out k slider/numbox when fill=all is active (k is bypassed)
  const skSlider = document.getElementById('searchKSlider');
  const kNum = document.getElementById('kBigNum');
  const kDisabled = S.grainKAllMode && !S.nearestMode;
  if (skSlider) skSlider.disabled = kDisabled;
  if (kNum) kNum.style.opacity = kDisabled ? '0.4' : '';
  drawRadiusViz();
}

// Dirty-flag cache: skip canvas redraw when radius and nearestMode haven't changed.
// The numbox is always updated; only the canvas draw is gated.
/** The radius slider + numbox readout. The little canvas this also drew
 *  (`#radiusViz`) left the markup long ago; the name stays for its callers. */
export function drawRadiusViz() {
  const radSliderEl = document.getElementById('radiusSlider');
  if (radSliderEl) radSliderEl.value = S.searchRadiusDeg;
  const radValEl = document.getElementById('radiusVal');
  if (radValEl) radValEl.value = `${Math.round(S.searchRadiusDeg)}°`;
}

export function flashRadiusTooltip() {
  S.radiusTooltipUntil = performance.now() + 1200;
}

// ── Grain controls panel ─────────────────────────────────────────────────────
// Called once from main.js (or events.js) after DOM ready.
// Registers S.syncGrainControlsUI so applyPresetObject and the tiles can call it.

export function initGrainControls() {
  // ── Hybrid slider: linear-in-samples below threshold, log above ─────────
  // Below _SAMPLE_EXACT_THRESHOLD (128 samples = 2.67ms @48k), each slider
  // tick = one integer sample count. Above, smooth log scale to 4000ms.
  //
  // Slider layout (0–1000):
  //   [0 .. threshold-1]  → sample counts [1 .. threshold]  (linear, 1:1)
  //   [threshold .. 1000] → [threshold_ms .. 4000ms]         (log)
  //
  const _LOG_MAX = Math.log(4000);
  const _sr = () => S.audioCtx?.sampleRate ?? 48000;
  const _threshMs = () => _SAMPLE_EXACT_THRESHOLD / _sr() * 1000;
  const _logThresh = () => Math.log(_threshMs());

  // Slider value → milliseconds (hybrid)
  const _sliderToMs = sv => {
    const v = parseFloat(sv);
    if (v < _SAMPLE_EXACT_THRESHOLD) {
      // Linear zone: slider tick N → (N+1) samples → ms
      const samples = Math.max(1, Math.round(v + 1));
      return samples / _sr() * 1000;
    }
    // Log zone: map [threshold..1000] → [threshMs..4000ms]
    const t = (v - _SAMPLE_EXACT_THRESHOLD) / (1000 - _SAMPLE_EXACT_THRESHOLD);
    return Math.exp(_logThresh() + t * (_LOG_MAX - _logThresh()));
  };

  // Milliseconds → slider value (hybrid inverse)
  const _msToSlider = ms => {
    const sr = _sr();
    const threshMs = _SAMPLE_EXACT_THRESHOLD / sr * 1000;
    if (ms <= threshMs) {
      // Linear zone: ms → samples → slider tick
      const samples = Math.max(1, Math.round(ms / 1000 * sr));
      return Math.max(0, Math.min(_SAMPLE_EXACT_THRESHOLD - 1, samples - 1));
    }
    // Log zone: ms → [threshold..1000]
    const logThresh = Math.log(threshMs);
    const t = (Math.log(Math.max(threshMs, ms)) - logThresh) / (_LOG_MAX - logThresh);
    return Math.round(_SAMPLE_EXACT_THRESHOLD + t * (1000 - _SAMPLE_EXACT_THRESHOLD));
  };
  const _fmtMs = fmtMs;
  const _parseMs = str => {
    const s = str.trim();
    if (s.endsWith('ms')) return parseFloat(s) / 1000;
    if (s.endsWith('s'))  return parseFloat(s);
    return parseFloat(s) / 1000;
  };

  const SLIDER_DEFS = [
    {
      sliderId: 'gcDurSlider', numId: 'gcDurNum', param: 'duration',
      toDisplay: _fmtPeriodSmart,
      sliderToInternal: sv => Math.max(minGrainDurS(), _sliderToMs(sv) / 1000),
      internalToSlider: v  => _msToSlider(v * 1000),
      fromDisplay: str => {
        const smpMatch = str.trim().match(/^(\d+)\s*smp/i);
        if (smpMatch) {
          const sr = S.audioCtx?.sampleRate ?? 48000;
          const n = parseInt(smpMatch[1]);
          return isNaN(n) ? null : Math.max(minGrainDurS(), n / sr);
        }
        const v = _parseMs(str);
        return isNaN(v) ? null : Math.max(minGrainDurS(), Math.min(4, v));
      },
      _sampleStep: true
    },
    {
      sliderId: 'gcDurVarSlider', numId: 'gcDurVarNum', param: 'durVar',
      // Hybrid mapping with zero-able: slider 0 = off, slider 1+ uses hybrid scale offset by 1
      toDisplay: v => v === 0 ? '0' : _fmtPeriodSmart(v),
      sliderToInternal: sv => { const v = parseFloat(sv); return v <= 0 ? 0 : _sliderToMs(v - 1) / 1000; },
      internalToSlider: v  => v <= 0 ? 0 : _msToSlider(v * 1000) + 1,
      fromDisplay: str => {
        if (str.trim() === '0') return 0;
        const smpMatch = str.trim().match(/^(\d+)\s*smp/i);
        if (smpMatch) {
          const n = parseInt(smpMatch[1]);
          return isNaN(n) ? null : Math.max(0, n / _sr());
        }
        const v = _parseMs(str);
        return isNaN(v) ? null : Math.max(0, Math.min(0.5, v));
      },
      _sampleStep: true
    },
    {
      // Same hybrid ms scale as durVar / periodVar — absolute-time randomness,
      // sample-exact in the low zone where the musically useful range sits
      // (half the 50ms drop rate = 25ms, which is mid-slider here).
      sliderId: 'gcStartJitterSlider', numId: 'gcStartJitterNum', param: 'startJitter',
      toDisplay: v => v === 0 ? '0' : _fmtPeriodSmart(v),
      sliderToInternal: sv => { const v = parseFloat(sv); return v <= 0 ? 0 : _sliderToMs(v - 1) / 1000; },
      internalToSlider: v  => v <= 0 ? 0 : _msToSlider(v * 1000) + 1,
      fromDisplay: str => {
        if (str.trim() === '0') return 0;
        const smpMatch = str.trim().match(/^(\d+)\s*smp/i);
        if (smpMatch) {
          const n = parseInt(smpMatch[1]);
          return isNaN(n) ? null : Math.max(0, n / _sr());
        }
        const v = _parseMs(str);
        return isNaN(v) ? null : Math.max(0, Math.min(0.5, v));
      },
      _sampleStep: true
    },
    {
      sliderId: 'gcDurJitterSlider', numId: 'gcDurJitterNum', param: 'durJitter',
      toDisplay: v => Math.round(v * 100) + '%',
      sliderToInternal: sv => parseFloat(sv) / 100,
      internalToSlider: v  => Math.round(v * 100),
      fromDisplay: str => { const v = parseFloat(str.replace('%', '')) / 100; return isNaN(v) ? null : Math.max(0, Math.min(1, v)); }
    },
    {
      // One row, two params.  `param` is a getter so every read site
      // (syncSliderFromInternal, commitNumbox, setGrainParam) resolves it at
      // call time and follows the unit toggle without the descriptor system
      // needing to know two rows exist.
      sliderId: 'gcFadeSlider', numId: 'gcFadeNum',
      get param() { return _fadeIsMs() ? 'fadeMs' : 'fadeRatio'; },
      toDisplay: v => _fadeIsMs() ? Math.round(v * 1000) + 'ms' : Math.round(v * 100) + '%',
      sliderToInternal: sv => _fadeIsMs() ? parseFloat(sv) / 1000 : parseFloat(sv) / 100,
      internalToSlider: v  => _fadeIsMs() ? Math.round(v * 1000) : Math.round(v * 100),
      fromDisplay: str => {
        // Typing a unit also switches the mode, so "20ms" works without
        // touching the label first.
        const s = str.trim().toLowerCase();
        if (/ms/.test(s)) _setFadeMode('ms');
        else if (/%/.test(s)) _setFadeMode('pct');
        if (_fadeIsMs()) {
          const v = parseFloat(s.replace(/ms/g, '')) / 1000;
          return isNaN(v) ? null : Math.max(0, Math.min(0.5, v));
        }
        const v = parseFloat(s.replace('%', '')) / 100;
        return isNaN(v) ? null : Math.max(0, Math.min(0.5, v));
      }
    },
    {
      sliderId: 'gcPeriodSlider', numId: 'gcPeriodNum', param: 'period',
      toDisplay: _fmtPeriodSmart,
      sliderToInternal: sv => Math.max(S.minPeriodS, _sliderToMs(sv) / 1000),
      internalToSlider: v  => _msToSlider(v * 1000),
      fromDisplay: str => {
        // Accept "Nsmp" format (e.g. "20smp" → 20/sr seconds)
        const smpMatch = str.trim().match(/^(\d+)\s*smp/i);
        if (smpMatch) {
          const sr = S.audioCtx?.sampleRate ?? 48000;
          const n = parseInt(smpMatch[1]);
          return isNaN(n) ? null : Math.max(S.minPeriodS, n / sr);
        }
        const v = _parseMs(str);
        return isNaN(v) ? null : Math.max(S.minPeriodS, Math.min(4, v));
      },
      _sampleStep: true
    },
    {
      sliderId: 'gcOverlapSlider', numId: 'gcOverlapNum', param: 'overlap',
      // Log scale: slider 0–1000 → overlap 0.01× to 100×
      // mid-point (500) = 1.0×
      toDisplay: v => v.toFixed(2) + '×',
      sliderToInternal: sv => {
        const t = parseFloat(sv) / 1000;  // 0–1
        // Log mapping: 10^(-2 + 4*t) → 0.01 to 100
        return Math.pow(10, -2 + 4 * t);
      },
      internalToSlider: v => {
        // Inverse: v = 10^(-2+4t) → t = (log10(v)+2)/4
        const t = (Math.log10(Math.max(0.01, Math.min(100, v))) + 2) / 4;
        return Math.round(t * 1000);
      },
      fromDisplay: str => {
        const v = parseFloat(str.replace('×', '').replace('x', ''));
        return isNaN(v) ? null : Math.max(0.01, Math.min(100, v));
      },
      _isOverlap: true,  // flag for special linking behaviour
    },
    {
      sliderId: 'gcPeriodVarSlider', numId: 'gcPeriodVarNum', param: 'periodVar',
      // Hybrid mapping with zero-able: slider 0 = off, slider 1+ uses hybrid scale offset by 1
      toDisplay: v => v === 0 ? '0' : _fmtPeriodSmart(v),
      sliderToInternal: sv => { const v = parseFloat(sv); return v <= 0 ? 0 : _sliderToMs(v - 1) / 1000; },
      internalToSlider: v  => v <= 0 ? 0 : _msToSlider(v * 1000) + 1,
      fromDisplay: str => {
        if (str.trim() === '0') return 0;
        const smpMatch = str.trim().match(/^(\d+)\s*smp/i);
        if (smpMatch) {
          const n = parseInt(smpMatch[1]);
          return isNaN(n) ? null : Math.max(0, n / _sr());
        }
        const v = _parseMs(str);
        return isNaN(v) ? null : Math.max(0, Math.min(0.5, v));
      },
      _sampleStep: true
    },
    {
      sliderId: 'gcPitchShiftSlider', numId: 'gcPitchShiftNum', param: 'pitchShift',
      // Internal: cents (−2400 to +2400). UI: cents or semitones.
      // Slider range: −2400 to +2400 cents (±2 octaves).
      toDisplay: v => {
        const c = Math.round(v || 0);
        if (c === 0) return '0¢';
        if (c % 100 === 0) return (c > 0 ? '+' : '') + (c / 100) + 'st';
        return (c > 0 ? '+' : '') + c + '¢';
      },
      sliderToInternal: sv => parseFloat(sv),
      internalToSlider: v  => Math.round(v || 0),
      fromDisplay: str => {
        const s = str.trim().replace(/[¢\s]/g, '');
        // Accept "st" (semitones) or raw cents
        if (s.endsWith('st')) {
          const st = parseFloat(s.replace('st', ''));
          return isNaN(st) ? null : Math.max(-2400, Math.min(2400, Math.round(st * 100)));
        }
        const c = parseFloat(s);
        return isNaN(c) ? null : Math.max(-2400, Math.min(2400, Math.round(c)));
      }
    },
    {
      sliderId: 'gcPitchSlider', numId: 'gcPitchNum', param: 'pitchJitter',
      // Internal: playback-rate offset (0–~0.498). UI: cents (0–700).
      // cents = 1200 * log2(1 + v),  v = 2^(c/1200) - 1
      // Slider caps at 700¢ for ergonomics; numbox and presets accept any value.
      toDisplay: v => '±' + Math.round(1200 * Math.log2(1 + Math.max(0, v))) + '¢',
      sliderToInternal: sv => Math.pow(2, parseFloat(sv) / 1200) - 1,
      internalToSlider: v  => Math.round(1200 * Math.log2(1 + Math.max(0, v))),
      fromDisplay: str => {
        const c = parseFloat(str.replace(/[±¢\s]/g, ''));
        if (isNaN(c)) return null;
        return Math.pow(2, Math.max(0, c) / 1200) - 1;
      }
    },
    {
      sliderId: 'gcProbSlider', numId: 'gcProbNum', param: 'probability',
      toDisplay: v => Math.round(v * 100) + '%',
      sliderToInternal: sv => parseFloat(sv),
      internalToSlider: v => v,
      fromDisplay: str => { const v = parseFloat(str.replace('%', '')) / 100; return isNaN(v) ? null : Math.max(0, Math.min(1, v)); }
    },
    {
      sliderId: 'gcPanSlider', numId: 'gcPanNum', param: 'panSpread',
      toDisplay: v => Math.round(v * 100) + '%',
      sliderToInternal: sv => parseFloat(sv),
      internalToSlider: v => v,
      fromDisplay: str => { const v = parseFloat(str.replace('%', '')) / 100; return isNaN(v) ? null : Math.max(0, Math.min(1, v)); }
    },
    {
      sliderId: 'gcVolSlider', numId: 'gcVolNum', param: 'volume',
      toDisplay: v => v.toFixed(3),
      sliderToInternal: sv => parseFloat(sv),
      internalToSlider: v => v,
      fromDisplay: str => { const v = parseFloat(str); return isNaN(v) ? null : Math.max(0.001, Math.min(2.0, v)); }
    },
    // ── Filter sliders ──────────────────────────────────────────────────────
    // HPF/LPF use a log scale (20–20000 Hz) mapped to slider 0–1000.
    // Log formula: freq = 20 * (1000)^(sv/1000)  →  sv = 1000 * log(freq/20) / log(1000)
    {
      sliderId: 'gcHpfSlider', numId: 'gcHpfNum', param: 'hpfFreq',
      toDisplay: v => {
        if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
        return Math.round(v) + ' Hz';
      },
      sliderToInternal: sv => 20 * Math.pow(1000, parseFloat(sv) / 1000),
      internalToSlider: v  => Math.round(1000 * Math.log(Math.max(20, v) / 20) / Math.log(1000)),
      fromDisplay: str => {
        const s = str.trim().toLowerCase().replace('hz', '').trim();
        let v;
        if (s.endsWith('k')) v = parseFloat(s.replace('k', '')) * 1000;
        else v = parseFloat(s);
        return isNaN(v) ? null : Math.max(20, Math.min(20000, v));
      }
    },
    {
      sliderId: 'gcLpfSlider', numId: 'gcLpfNum', param: 'lpfFreq',
      toDisplay: v => {
        if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
        return Math.round(v) + ' Hz';
      },
      sliderToInternal: sv => 20 * Math.pow(1000, parseFloat(sv) / 1000),
      internalToSlider: v  => Math.round(1000 * Math.log(Math.max(20, v) / 20) / Math.log(1000)),
      fromDisplay: str => {
        const s = str.trim().toLowerCase().replace('hz', '').trim();
        let v;
        if (s.endsWith('k')) v = parseFloat(s.replace('k', '')) * 1000;
        else v = parseFloat(s);
        return isNaN(v) ? null : Math.max(20, Math.min(20000, v));
      }
    },
    {
      sliderId: 'gcHpfQSlider', numId: 'gcHpfQNum', param: 'hpfQ',
      toDisplay: v => v.toFixed(2),
      sliderToInternal: sv => parseFloat(sv),
      internalToSlider: v => v,
      fromDisplay: str => { const v = parseFloat(str); return isNaN(v) ? null : Math.max(0.1, Math.min(20, v)); }
    },
    {
      sliderId: 'gcLpfQSlider', numId: 'gcLpfQNum', param: 'lpfQ',
      toDisplay: v => v.toFixed(2),
      sliderToInternal: sv => parseFloat(sv),
      internalToSlider: v => v,
      fromDisplay: str => { const v = parseFloat(str); return isNaN(v) ? null : Math.max(0.1, Math.min(20, v)); }
    },
    {
      sliderId: 'gcFilterJitterSlider', numId: 'gcFilterJitterNum', param: 'filterFreqJitter',
      toDisplay: v => Math.round(v * 100) + '%',
      sliderToInternal: sv => parseFloat(sv),
      internalToSlider: v => v,
      fromDisplay: str => { const v = parseFloat(str.replace('%', '')) / 100; return isNaN(v) ? null : Math.max(0, Math.min(1, v)); }
    },
  ];

  // rAF-throttled waveform preview — avoids blocking the main thread with
  // canvas draws during rapid slider drags (was running at ~20fps synchronously,
  // each call doing ~8 000 canvas path operations, starving the grain scheduler).
  let _waveformRafId = 0;
  function requestWaveformRedraw() {
    if (!_waveformRafId) _waveformRafId = requestAnimationFrame(() => {
      _waveformRafId = 0;
      S._drawEngineScope?.();
    });
  }

  // ── Forward grain params to worklet when active ────────────────────────
  // Maps main-thread param names/values to worklet message format.
  // Called on every slider change, preset selection, and direction/curve switch.
  function _syncWorkletParams() {
    // The param block itself comes from brush-voicing.js — the same builder a
    // stroke freezes when it is painted. Two copies of this field list would
    // drift silently and present as "this brush sounds different after I
    // reload"; see the note on resolveGrainParams().
    S._updateWorkletParams?.(resolveGrainParams());
  }

  function setGrainParam(param, internalVal) {
    if (param === 'overlap') {
      // Overlap is a virtual param — drives duration = period × overlap
      const per = S.grainOverrides.period ?? gp().period;
      const newDur = Math.max(minGrainDurS(), per * internalVal);
      S.grainOverrides.duration = newDur;
      // Update duration slider/numbox to reflect new value
      const durDef = SLIDER_DEFS.find(d => d.param === 'duration');
      if (durDef) syncSliderFromInternal(durDef);
      requestWaveformRedraw();
      _syncWorkletParams();
      return;
    }
    if (param === 'probability') {
      S.grainProbability = Math.max(0, Math.min(1, internalVal));
    } else {
      if (param === 'duration') internalVal = Math.max(minGrainDurS(), internalVal);
      if (param === 'period')   internalVal = Math.max(S.minPeriodS, internalVal);
      S.grainOverrides[param] = internalVal;
      if (param === 'duration' || param === 'period' || param === 'fadeRatio' || param === 'fadeMs') requestWaveformRedraw();
    }
    // When period or duration changes independently, passively update the overlap display
    if (param === 'duration' || param === 'period') _syncOverlapDisplay();
    _syncWorkletParams();
  }

  function _getOverlapRatio() {
    const dur = S.grainOverrides.duration ?? gp().duration;
    const per = S.grainOverrides.period   ?? gp().period;
    return per > 0 ? dur / per : 1;
  }

  function _syncOverlapDisplay() {
    const olDef = SLIDER_DEFS.find(d => d.param === 'overlap');
    if (olDef) syncSliderFromInternal(olDef);
  }

  // ── Fade unit (% of grain length vs fixed ms) ───────────────────────────
  // The fade row is the only control bound to two params.  These helpers are
  // the single source of truth for which one is live; the row descriptor, the
  // label and the slider range all read through them.
  function _fadeIsMs() {
    return (S.grainOverrides.fadeMode ?? gp().fadeMode ?? 'pct') === 'ms';
  }
  function _setFadeMode(mode) {
    S.grainOverrides.fadeMode = mode === 'ms' ? 'ms' : 'pct';
  }
  // Slider travel differs per unit: 0–50% vs 0–500ms.  Kept in sync here so
  // flipping the unit can't leave the handle mapped to the old range.
  function _syncFadeUnitUI() {
    const ms = _fadeIsMs();
    const lbl = document.getElementById('gcFadeUnitBtn');
    if (lbl) lbl.textContent = ms ? 'fade ms' : 'fade %';
    const slider = document.getElementById('gcFadeSlider');
    if (slider) slider.max = ms ? '500' : '50';
  }

  function syncSliderFromInternal(def) {
    const slider = document.getElementById(def.sliderId);
    const numbox = document.getElementById(def.numId);
    if (!slider || !numbox) return;
    if (def.sliderId === 'gcFadeSlider') _syncFadeUnitUI();
    const val = def.param === 'overlap'     ? _getOverlapRatio()
              : def.param === 'probability' ? S.grainProbability
              : (S.grainOverrides[def.param] ?? gp()[def.param] ?? 0);
    slider.value = def.internalToSlider(val);
    if (document.activeElement !== numbox) numbox.value = def.toDisplay(val);
  }

  // Clicking the fade label flips the unit.  Deliberately the label rather
  // than a segmented control: the row is already label + slider + numbox +
  // lock, and squeezing two more buttons in would cost the slider its travel.
  document.getElementById('gcFadeUnitBtn')?.addEventListener('click', () => {
    _setFadeMode(_fadeIsMs() ? 'pct' : 'ms');
    _syncFadeUnitUI();
    const def = SLIDER_DEFS.find(d => d.sliderId === 'gcFadeSlider');
    if (def) syncSliderFromInternal(def);
    requestWaveformRedraw();
    _syncWorkletParams();
  });

  const dirSeg   = document.getElementById('gcDirSeg');
  const curveSeg = document.getElementById('gcCurveSeg');

  // setTimeout-throttle for grain slider input events.
  // Aggressive slider dragging fires 200+ input events/second. 100ms cap (~10fps)
  // matches the update rate of a hardware MIDI potentiometer and is the practical
  // minimum for a musical instrument feel. Numbox updates immediately on every event.
  // The Map stores only the LATEST value per param so no stale values accumulate.
  let   _sliderTimerId        = null;
  const _pendingSliderUpdates = new Map(); // param → latest internalVal
  function _flushSliderUpdates() {
    _sliderTimerId = null;
    _pendingSliderUpdates.forEach((internal, param) => setGrainParam(param, internal));
    _pendingSliderUpdates.clear();
  }

  SLIDER_DEFS.forEach(def => {
    const slider = document.getElementById(def.sliderId);
    const numbox = document.getElementById(def.numId);
    if (!slider || !numbox) return;

    slider.addEventListener('input', () => {
      const internal = def.sliderToInternal(slider.value);
      // Update numbox immediately — purely visual, no grain engine side-effects.
      if (document.activeElement !== numbox) numbox.value = def.toDisplay(internal);
      // Coalesce grain engine updates — only the latest value per param is kept.
      _pendingSliderUpdates.set(def.param, internal);
      if (_sliderTimerId === null) _sliderTimerId = setTimeout(_flushSliderUpdates, 30);
      // When period or duration slider is dragged, update overlap readout in real-time
      if (def.param === 'period' || def.param === 'duration') {
        // Peek at what the ratio will be once this value is committed
        const dur = def.param === 'duration' ? internal : (S.grainOverrides.duration ?? gp().duration);
        const per = def.param === 'period'   ? internal : (S.grainOverrides.period   ?? gp().period);
        const ratio = per > 0 ? dur / per : 1;
        const olSlider = document.getElementById('gcOverlapSlider');
        const olNum    = document.getElementById('gcOverlapNum');
        const olDef    = SLIDER_DEFS.find(d => d.param === 'overlap');
        if (olSlider && olNum && olDef) {
          olSlider.value = olDef.internalToSlider(ratio);
          if (document.activeElement !== olNum) olNum.value = olDef.toDisplay(ratio);
        }
      }
    });

    const commitNumbox = () => {
      const internal = def.fromDisplay(numbox.value);
      if (internal !== null) {
        // The fade row can change unit as a side effect of what was typed
        // ("20ms" vs "12%"), and the two units have different slider travel —
        // refresh the range before assigning the handle position, or the value
        // lands against the old max.  This path sets slider/numbox directly
        // rather than going through syncSliderFromInternal().
        if (def.sliderId === 'gcFadeSlider') _syncFadeUnitUI();
        setGrainParam(def.param, internal);
        slider.value = def.internalToSlider(internal);
        numbox.value = def.toDisplay(internal);
      } else {
        syncSliderFromInternal(def);
      }
    };

    numbox.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commitNumbox(); numbox.blur(); }
      if (e.key === 'Escape') { syncSliderFromInternal(def); numbox.blur(); }
      // ── Arrow keys: ±1 sample stepping for period in sub-ms zone ──────
      if (def._sampleStep && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const currentVal = def.param === 'probability' ? S.grainProbability
          : (S.grainOverrides[def.param] ?? gp()[def.param] ?? 0);
        const sr = S.audioCtx?.sampleRate ?? 48000;
        const currentSamples = Math.round(currentVal * sr);
        // In sample-exact zone (≤128 samples), step by ±1 sample
        // Above that, step by ±1ms
        if (currentSamples <= _SAMPLE_EXACT_THRESHOLD) {
          const dir = e.key === 'ArrowUp' ? 1 : -1;
          const newVal = _stepPeriodBySamples(currentVal, dir);
          setGrainParam(def.param, Math.max(S.minPeriodS, newVal));
          slider.value = def.internalToSlider(newVal);
          numbox.value = def.toDisplay(newVal);
        } else {
          // Above threshold (~2.67ms): step by 1ms
          const step = e.key === 'ArrowUp' ? 0.001 : -0.001;
          const newVal = Math.max(S.minPeriodS, currentVal + step);
          setGrainParam(def.param, newVal);
          slider.value = def.internalToSlider(newVal);
          numbox.value = def.toDisplay(newVal);
        }
      }
    });
    numbox.addEventListener('blur', commitNumbox);
  });

  if (dirSeg) {
    dirSeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        S.grainDirection = btn.dataset.dir;
        dirSeg.querySelectorAll('.grain-seg-btn').forEach(b => b.classList.toggle('active', b === btn));
        _syncWorkletParams();
      });
    });
  }

  if (curveSeg) {
    curveSeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        S.grainCurveType = btn.dataset.curve;
        curveSeg.querySelectorAll('.grain-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.curve === S.grainCurveType));
        _syncWorkletParams();
      });
    });
  }

  // ── Octave shortcut buttons ──────────────────────────────────────────────
  const octDownBtn  = document.getElementById('octDownBtn');
  const octResetBtn = document.getElementById('octResetBtn');
  const octUpBtn    = document.getElementById('octUpBtn');
  const _setPitchShift = (cents) => {
    const clamped = Math.max(-2400, Math.min(2400, Math.round(cents)));
    setGrainParam('pitchShift', clamped);
    const psDef = SLIDER_DEFS.find(d => d.param === 'pitchShift');
    if (psDef) syncSliderFromInternal(psDef);
  };
  // Single implementation behind the three buttons AND the three bindable
  // actions (pitch_oct_down / _reset / _up in midi.js) — a key, pad or pedal
  // must land on exactly the same clamped value the button does, so the
  // dispatcher calls this rather than synthesising a click.
  //   dir < 0 → down an octave · dir > 0 → up an octave · dir === 0 → reset
  S._pitchOctave = (dir) => {
    if (!dir) { _setPitchShift(0); return; }
    const cur = S.grainOverrides.pitchShift ?? gp().pitchShift ?? 0;
    _setPitchShift(cur + (dir > 0 ? 1200 : -1200));
  };

  if (octDownBtn)  octDownBtn .addEventListener('click', () => S._pitchOctave(-1));
  if (octResetBtn) octResetBtn.addEventListener('click', () => S._pitchOctave(0));
  if (octUpBtn)    octUpBtn   .addEventListener('click', () => S._pitchOctave(1));

  // Register syncGrainControlsUI on S so applyPresetObject can call it
  S.syncGrainControlsUI = function() {
    SLIDER_DEFS.forEach(syncSliderFromInternal);
    if (dirSeg)   dirSeg.querySelectorAll('.grain-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.dir   === S.grainDirection));
    if (curveSeg) curveSeg.querySelectorAll('.grain-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.curve === S.grainCurveType));
    const probDef = SLIDER_DEFS.find(d => d.param === 'probability');
    if (!probDef) {
      const probSlider = document.getElementById('gcProbSlider');
      const probNum    = document.getElementById('gcProbNum');
      if (probSlider) probSlider.value = S.grainProbability;
      if (probNum)    probNum.value    = Math.round(S.grainProbability * 100) + '%';
    }
    const kVal = S.grainOverrides.k ?? gp().k;
    const skSlider = document.getElementById('searchKSlider');
    if (skSlider) skSlider.value = kVal;
    const kNum = document.getElementById('kBigNum');
    if (kNum) kNum.value = kVal;
    const recValEl = document.getElementById('recencyVal');
    if (recValEl) recValEl.value = S.recencyN === 0 ? 'all' : S.recencyN;
    const recSlider = document.getElementById('recencySlider');
    if (recSlider) recSlider.value = S.recencyN === 0 ? RECENCY_SLIDER_ALL : S.recencyN;
    // Also sync the radius slider (morph writes to S.searchRadiusDeg directly)
    const radSlider = document.getElementById('radiusSlider');
    if (radSlider) radSlider.value = S.searchRadiusDeg;
    // Radius fade curve slider
    const rfcSlider = document.getElementById('radiusFadeCurveSlider');
    if (rfcSlider) rfcSlider.value = S.radiusFadeCurve;
    const rfcNum = document.getElementById('radiusFadeCurveNum');
    if (rfcNum) rfcNum.value = Math.round(S.radiusFadeCurve * 100) + '%';
    // Boolean toggles — sync segment button active states
    const snapSeg = document.getElementById('snapToggleSeg');
    if (snapSeg) snapSeg.querySelectorAll('.grain-seg-btn').forEach(b =>
      b.classList.toggle('active', (b.dataset.snap === 'on') === S.nearestMode));
    const kAllSeg = document.getElementById('kAllSeg');
    if (kAllSeg) kAllSeg.querySelectorAll('.grain-seg-btn').forEach(b =>
      b.classList.toggle('active', (b.dataset.kall === 'on') === S.grainKAllMode));
    const kSeqSeg = document.getElementById('kSeqSeg');
    if (kSeqSeg) kSeqSeg.querySelectorAll('.grain-seg-btn').forEach(b =>
      b.classList.toggle('active', (b.dataset.kseq === 'on') === S.grainKSeqMode));
    updatePlaybackControls();
    drawRadiusViz();
    _syncWorkletParams();
  };

  // Init display from default preset
  S.syncGrainControlsUI();

  // ── Controls outside SLIDER_DEFS ─────────────────────────────────────────
  // k, radius, recency, the fade curve and the segment rows: the param →
  // element mapping the highlight pass below needs, since SLIDER_DEFS does not
  // cover them. The radial-morph indicator that shared these two tables
  // (.param-morphed, an orange thumb) went on 2026-09-13 — it read
  // S.radialMorphActiveParams, which nothing has ever assigned, and its own
  // hook was never called; radial morph itself was sunset with the patch bank.
  const EXTRA_MORPH_SLIDERS = [
    { param: 'k',                sliderId: 'searchKSlider' },
    { param: 'searchRadiusDeg',  sliderId: 'radiusSlider' },
    { param: 'recencyN',         sliderId: 'recencySlider' },
    { param: 'radiusFadeCurve',  sliderId: 'radiusFadeCurveSlider' },
  ];
  // Segment/toggle controls — use the segment container's parent .grain-row
  const EXTRA_MORPH_SEGS = [
    { param: 'nearestMode',      segId: 'snapToggleSeg' },
    { param: 'grainKAllMode',    segId: 'kAllSeg' },
    { param: 'grainKSeqMode',    segId: 'kSeqSeg' },
    { param: 'radiusFadeEnabled', segId: 'radiusFadeSeg' },
    { param: 'direction',        segId: 'gcDirSeg' },
    { param: 'curveType',        segId: 'gcCurveSeg' },
  ];

  // ── Sensor mapping visual indicator ──────────────────────────────────────
  // When an IMU sensor mapping is enabled for a param, toggle .param-mapped
  // on each affected grain-row so the slider/label turn violet.
  // Driven by S._syncMappingHighlights(), called from sensor-mapping.js
  // whenever mappings are added, removed, or toggled.

  /** Build a Set of param keys with at least one enabled mapping.
   *  Only grain-kind rows count — MIDI/OSC rows don't drive grain params and
   *  shouldn't violet-highlight a slider that isn't actually being modulated. */
  function _activeMappedParams() {
    const mappings = getMappings();
    const active = new Set();
    for (let i = 0; i < mappings.length; i++) {
      const m = mappings[i];
      if (!m.enabled) continue;
      const kind = m.output?.kind || 'grain';
      if (kind !== 'grain') continue;
      const param = m.output?.param || m.targetParam;
      if (param) active.add(param);
    }
    return active;
  }

  S._syncMappingHighlights = function() {
    const mapped = _activeMappedParams();
    SLIDER_DEFS.forEach(def => {
      const slider = document.getElementById(def.sliderId);
      if (!slider) return;
      const row = slider.closest('.grain-row');
      if (!row) return;
      row.classList.toggle('param-mapped', mapped.has(def.param));
    });
    // Also mark non-SLIDER_DEF slider controls (k, radius, recency, fade curve)
    EXTRA_MORPH_SLIDERS.forEach(def => {
      const el = document.getElementById(def.sliderId);
      if (!el) return;
      const row = el.closest('.grain-row');
      if (!row) return;
      row.classList.toggle('param-mapped', mapped.has(def.param));
    });
  };

  // Initial sync — pick up any persisted mappings from localStorage
  S._syncMappingHighlights();
}
