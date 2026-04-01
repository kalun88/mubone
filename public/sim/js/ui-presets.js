// ============================================================================
// UI — PRESETS, GRAIN CONTROLS, SEED BANKS, RADIUS VIZ
// ============================================================================

import {
  S,
  PRESETS, COMMIT_COLORS, MAX_COMMITS,
  SEED_COLORS, MAX_SEEDS, SEQ_COLORS, MAX_SEQS, SCHED_SAFE_PERIOD_S,
  COMMIT_DRAW_THRESHOLD_MS, MOVING_SEED_THRESHOLD_MS,
  gp, rebuildGrainCurves, minGrainDurS, minGrainPeriodS,
  SEARCH_RADIUS_MIN, SEARCH_RADIUS_MAX, SEARCH_RADIUS_STEP,
  USER_PRESET_START, FACTORY_PRESET_START, loadUserPresets, saveUserPresets,
  presetHasParams,
} from './state.js';
import { angleBetweenSphere, findNearestSeedSlot, resetCursorPeriod } from './grain.js';
import { lerpPresets } from './seed-morph.js';
import { ensureAudioContext, requestMicAccess, setMicBtnLabel } from './audio.js';
import { screenToLonLat, getCursorLonLat } from './sphere.js';
import { applySparsePreset, syncAllUI, PARAM_REGISTRY } from './ui-patch-table.js';
import { isLocked, onLockChange, loadLocks } from './param-lock.js';

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
  if (ms < 10)     return ms.toFixed(1) + 'ms';
  return Math.round(ms) + 'ms';
}

// ── Grain presets UI ─────────────────────────────────────────────────────────

// ── Snapshot current grain state into a user preset slot and persist ──────────
function saveToUserPreset(index) {
  const currentName = PRESETS[index].name;
  const name = window.prompt('Patch name:', currentName);
  if (name === null) return;   // cancelled

  // Full capture of all params EXCEPT locked ones.
  // Locked params are session-wide holds — they don't belong in patches.
  const snap = {};
  for (const p of PARAM_REGISTRY) {
    if (isLocked(p.key)) continue;   // locked → omit from patch
    snap[p.key] = p.get();
  }

  PRESETS[index] = {
    ...snap,
    name:             name.trim() || currentName,
    userDefined:      true,
  };
  saveUserPresets();
  // Refresh the button label
  const btn = document.querySelectorAll('.preset-btn')[index];
  const nameEl = btn?.querySelector('.preset-name');
  if (nameEl) nameEl.textContent = PRESETS[index].name;
  // Rebuild dropdown options to reflect new name
  S._rebuildPresetDropdown?.();
  S._rebuildMorphDropdowns?.();
  // Re-sync UI if this slot is currently selected
  if (S.activePresetIndex === index) selectPreset(index);
}

export function setupPresets() {
  loadUserPresets();   // hydrate user slots from localStorage before building buttons
  const container = document.getElementById('presetButtons');
  PRESETS.forEach((preset, i) => {
    const btn = document.createElement('button');
    const startIdx = S.activePresetIndex ?? FACTORY_PRESET_START;
    btn.className = 'preset-btn' + (i === startIdx ? ' active' : '');

    if (i < FACTORY_PRESET_START) {
      // User-defined slot (indices 0–19) — name span + save icon
      btn.classList.add('user-preset');
      btn.innerHTML =
        `<span class="preset-num">${i + 1}</span>` +
        `<span class="preset-name">${preset.name}</span>` +
        `<span class="preset-save" title="save current state to this patch slot">✎</span>`;
      btn.addEventListener('click', e => {
        if (!e.target.classList.contains('preset-save')) selectPreset(i);
      });
      btn.querySelector('.preset-save').addEventListener('click', e => {
        e.stopPropagation();
        saveToUserPreset(i);
      });
    } else {
      // Factory preset (indices 20+)
      btn.innerHTML = `<span class="preset-num">${i + 1}</span>${preset.name}`;
      btn.addEventListener('click', () => selectPreset(i));
    }

    container.appendChild(btn);
  });
  // Activate saved preset (or first factory preset "wash") on startup so all
  // ancillary state is fully synced from the preset definition.
  selectPreset(S.activePresetIndex ?? FACTORY_PRESET_START);

  // ── Preset view toggle (grid ↔ dropdown) ──────────────────────────────
  const _pvToggle      = document.getElementById('presetViewToggle');
  const _pvGrid        = document.getElementById('presetButtons');
  const _pvDropWrap    = document.getElementById('presetDropdownWrap');
  const _pvDropdown    = document.getElementById('presetDropdown');
  const _pvDropSave    = document.getElementById('presetDropdownSave');

  function _buildDropdownOptions() {
    if (!_pvDropdown) return;
    _pvDropdown.innerHTML = '';
    const userGroup = document.createElement('optgroup');
    userGroup.label = 'user';
    const factoryGroup = document.createElement('optgroup');
    factoryGroup.label = 'factory';
    PRESETS.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${i + 1}  ${p.name}`;
      if (i < FACTORY_PRESET_START) userGroup.appendChild(opt);
      else factoryGroup.appendChild(opt);
    });
    _pvDropdown.appendChild(userGroup);
    _pvDropdown.appendChild(factoryGroup);
    _pvDropdown.value = S.activePresetIndex;
  }

  // Expose so refreshPresetButtons and saveToUserPreset can rebuild options
  S._rebuildPresetDropdown = _buildDropdownOptions;

  if (_pvDropdown) {
    _buildDropdownOptions();
    _pvDropdown.addEventListener('change', () => {
      selectPreset(parseInt(_pvDropdown.value));
    });
  }

  // Sync dropdown when preset changes via any path
  S._syncPresetDropdown = () => {
    if (_pvDropdown) _pvDropdown.value = S.activePresetIndex;
    if (_pvDropSave) {
      const isFactory = S.activePresetIndex >= FACTORY_PRESET_START;
      _pvDropSave.disabled = isFactory;
      _pvDropSave.title = isFactory ? 'factory presets cannot be overwritten' : 'save current state to this patch slot';
    }
  };

  // Save button next to dropdown — only works for user preset slots
  if (_pvDropSave) {
    _pvDropSave.addEventListener('click', () => {
      const idx = S.activePresetIndex;
      if (idx < FACTORY_PRESET_START) saveToUserPreset(idx);
    });
  }
  S._syncPresetDropdown();   // initial disabled state for save button

  // Toggle grid ↔ dropdown
  let _presetViewMode = 'grid';
  try { _presetViewMode = localStorage.getItem('mubone_preset_view') || 'grid'; } catch (_) {}

  function _applyPresetView(mode) {
    _presetViewMode = mode;
    if (_pvGrid)     _pvGrid.style.display     = mode === 'grid' ? '' : 'none';
    if (_pvDropWrap) _pvDropWrap.style.display  = mode === 'dropdown' ? '' : 'none';
    if (_pvToggle)   _pvToggle.textContent      = mode === 'grid' ? 'compact' : 'show all';
    if (_pvToggle)   _pvToggle.title            = mode === 'grid' ? 'switch to compact dropdown view' : 'show all patch buttons';
    try { localStorage.setItem('mubone_preset_view', mode); } catch (_) {}
  }
  _applyPresetView(_presetViewMode);

  if (_pvToggle) {
    _pvToggle.addEventListener('click', e => {
      e.stopPropagation(); // don't trigger device-label collapse
      _applyPresetView(_presetViewMode === 'grid' ? 'dropdown' : 'grid');
    });
  }

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
  S.setSearchK = function(v) {
    const kMax = Math.max(30, S.particles.length);
    const k = Math.max(1, Math.min(kMax, Math.round(v)));
    S.grainOverrides.k = k;
    const slider = document.getElementById('searchKSlider');
    if (slider) slider.value = k;
    const bigNum = document.getElementById('kBigNum');
    if (bigNum) bigNum.value = k;
  };

  const searchKSlider = document.getElementById('searchKSlider');
  if (searchKSlider) {
    searchKSlider.value = S.grainOverrides.k ?? gp().k;
    let _searchKTimerId = null;
    searchKSlider.addEventListener('input', () => {
      if (_searchKTimerId === null)
        _searchKTimerId = setTimeout(() => {
          _searchKTimerId = null;
          S.setSearchK(parseInt(searchKSlider.value));
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
  document.getElementById('helpBtn')?.addEventListener('click', () => S.openMappingModal?.());

  // Perf monitor button
  document.getElementById('perfMonBtn')?.addEventListener('click', () => {
    S.perfMonitorVisible = !S.perfMonitorVisible;
    const el = document.getElementById('perfMonitor');
    if (el) el.style.display = S.perfMonitorVisible ? 'block' : 'none';
    const btn = document.getElementById('perfMonBtn');
    if (btn) btn.classList.toggle('active', S.perfMonitorVisible);
  });

  // Fullscreen — delegates to the same fullscreenBtn click handler in events.js
  document.getElementById('fullscreenBtn2')?.addEventListener('click', () => {
    document.getElementById('fullscreenBtn')?.click();
  });

  // Expose selectPreset on S so osc.js can call it without a circular import
  S._selectPreset = selectPreset;

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

  // ── Parameter lock indicators (display-only, toggled via patch table) ─────
  loadLocks();

  function _syncLockIndicator(el) {
    const key = el.dataset.lockKey;
    const locked = isLocked(key);
    el.style.display = locked ? '' : 'none';
    el.closest('.grain-row')?.classList.toggle('param-locked', locked);
  }

  document.querySelectorAll('.param-lock-indicator').forEach(_syncLockIndicator);

  // Listen for lock changes from patch table
  onLockChange((key) => {
    document.querySelectorAll(`.param-lock-indicator[data-lock-key="${key}"]`).forEach(_syncLockIndicator);
  });
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
 *  In two-IMU mode the wand drives position; otherwise mouse or camQ. */
function getCursorPos() {
  return S.cursorQ ? getCursorLonLat()
    : S.mouseInCanvas ? getMouseLonLat()
    : getCursorLonLat();
}

/** Legacy single-call plant (used by OSC, MIDI, etc). Plants a stationary seed. */
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
  const t = now - (startOverride ?? S._seedRecordingStart);
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
      if (!slot) continue;
      const t = slot._plantedAt || slot._createdAt || 0;
      if (t < oldestTime) { oldestTime = t; oldestIdx = i; }
    }
    return oldestIdx;
  }
  if (S.commitOverflow === 'nearest') {
    let nearIdx = -1, nearAng = Infinity;
    for (let i = 0; i < limit; i++) {
      const slot = S.commitSlots[i];
      if (!slot) continue;
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

/** Start a seed plant. Reserves a slot and begins recording movement. */
export function startSeedPlant() {
  const { lon, lat } = getCursorPos();
  const slotIndex = _findSeedSlot(lon, lat);
  if (slotIndex === -1) return;
  // If replacing an existing commit, clean it up first
  if (S.commitSlots[slotIndex]) {
    const existing = S.commitSlots[slotIndex];
    if (existing.type === 'loop') _stopSeqAudio(existing);
    S.commitSlots[slotIndex] = null;
  }
  const color = SEED_COLORS[slotIndex];
  S.commitSlots[slotIndex] = {
    type: 'cloud',
    slotIndex, lon, lat, color, searchRadiusDeg: S.searchRadiusDeg,
    nearestMode: S.nearestMode,
    kAllMode: S.grainKAllMode,
    kSeqMode: S.grainKSeqMode,
    _lastFiredAt:  0,
    _nextPeriodMs: 0,
    _plantedAt:    performance.now() / 1000,
    _releasingAt:  0,
    _envAttack:    S.seedAttack,     // snapshot at sow — duration of the attack ramp
    _envRelease:   0,                // set at uproot time from current S.seedRelease
    _envGainCurrent: S.seedAttack > 0 ? 0 : 1,
    grainParams: {
      ...S.grainParams,
      ...Object.fromEntries(Object.entries(S.grainOverrides).filter(([, v]) => v !== null)),
      curveType:   S.grainCurveType,
      direction:   S.grainDirection,
      probability: S.grainProbability,
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
    loopMode: S.seedLoopMode ?? 'pingpong',
    _playheadMs:  0,
    _pingForward: true,
  };

  // Stamp per-particle fade attenuation for this seed (stationary path)
  if (S.radiusFadeEnabled) {
    const searchRadiusRad = S.searchRadiusDeg * Math.PI / 180;
    const exp = 1 + S.radiusFadeCurve * 3;
    const fadeKey = `_cFade${slotIndex}`;
    for (let pi = 0; pi < S.particles.length; pi++) {
      const p = S.particles[pi];
      const ang = angleBetweenSphere(lon, lat, p.lon, p.lat);
      if (ang <= searchRadiusRad && searchRadiusRad > 0) {
        const t = Math.min(1, ang / searchRadiusRad);
        p[fadeKey] = Math.pow(1 - t, exp);
      } else {
        p[fadeKey] = 1.0;
      }
    }
  }

  // Start recording cursor path for potential moving seed
  S._seedRecordingFrames = [_captureSeedFrame()];
  S._seedRecordingStart  = performance.now();
  S._seedRecordingSlot   = slotIndex;

  (S.updateSeedBanksUI || updateSeedBanksUI)();
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
  if (S._seedRecordingFrames) S._seedRecordingFrames.push(_captureSeedFrame());
  if (S._shelvedSeed?.frames) S._shelvedSeed.frames.push(_captureSeedFrame(S._shelvedSeed.start));
}

/** Finalize seed plant on ↓ key release. Short hold = stationary, long = moving. */
export function finalizeSeedPlant() {
  const frames = S._seedRecordingFrames;
  const start  = S._seedRecordingStart;
  const slot   = S._seedRecordingSlot;
  S._seedRecordingFrames = null;
  S._seedRecordingStart  = 0;
  S._seedRecordingSlot   = -1;

  if (slot < 0 || !S.seedSlots[slot]) return;
  const seed = S.seedSlots[slot];

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
    // Update lon/lat to the first frame position (nominal anchor)
    seed.lon = frames[0].lon;
    seed.lat = frames[0].lat;
  }
  (S.updateSeedBanksUI || updateSeedBanksUI)();
}

/** Toggle loop mode for a moving seed (ping-pong ↔ forward). */
export function toggleSeedLoopMode(slotIndex) {
  const seed = S.seedSlots[slotIndex];
  if (!seed || !seed.frames) return;
  const cycle = { pingpong: 'forward', forward: 'rev', rev: 'pingpong' };
  seed.loopMode = cycle[seed.loopMode] ?? 'forward';
  (S.updateSeedBanksUI || updateSeedBanksUI)();
}

export function uprootNearestSeed() {
  const { lon, lat } = getCursorPos();
  // Skip seeds already fading out so rapid uproot hits the next live seed
  const nearestSlot = findNearestSeedSlot(lon, lat, { skipReleasing: true });
  if (nearestSlot === -1) return;
  const seed = S.seedSlots[nearestSlot];
  if (!seed) return;
  // Use the current release time (performance gesture), not a stored value
  const rel = S.seedRelease || 0;
  if (rel <= 0) {
    // Instant removal
    S.seedSlots[nearestSlot] = null;
  } else {
    // Stamp the current release duration onto the seed and start the ramp
    seed._envRelease  = rel;
    seed._releasingAt = performance.now() / 1000;
  }
  (S.updateSeedBanksUI || updateSeedBanksUI)();
}

export function clearAllSeeds() {
  const now = performance.now() / 1000;
  // Use the current release time for all cloud-type commits being cleared
  const rel = S.commitRelease || 0;
  for (let i = 0; i < MAX_COMMITS; i++) {
    const seed = S.commitSlots[i];
    if (!seed || seed.type !== 'cloud') continue;
    if (rel > 0 && !seed._releasingAt) {
      seed._envRelease  = rel;
      seed._releasingAt = now;
    } else if (rel <= 0) {
      S.commitSlots[i] = null;
    }
  }
  (S.updateSeedBanksUI || updateSeedBanksUI)();
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
  if (S.seqOverflow !== 'off') return false;
  for (let i = 0; i < S.seqSlotCount; i++) {
    const sl = S.seqSlots[i];
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
  // Sync trace label — shows parenthesised mode name when armed but full
  // (inlined here to avoid recursion with _syncCommitUI which calls us)
  const traceLabel = document.getElementById('traceLabel');
  if (traceLabel) {
    const armed = S.traceMode !== 'trace';
    const _labelMap      = { 'trace': 'trace', 'trace+loop': 'trace + loop',   'trace+cloud': 'trace + cloud' };
    const _labelMapFull  = { 'trace': 'trace', 'trace+loop': 'trace + (loop)', 'trace+cloud': 'trace + (cloud)' };
    traceLabel.textContent = (armed && full ? _labelMapFull : _labelMap)[S.traceMode] || 'trace';
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

  // ── Trace mode button — no persistent state, just updates label ──

  // ── Trace label — reflects current trace mode ──
  const traceLabel = document.getElementById('traceLabel');
  if (traceLabel) {
    const full = S.traceMode !== 'trace' && seqSlotsFull();
    const _labelMap      = { 'trace': 'trace', 'trace+loop': 'trace + loop',   'trace+cloud': 'trace + cloud' };
    const _labelMapFull  = { 'trace': 'trace', 'trace+loop': 'trace + (loop)', 'trace+cloud': 'trace + (cloud)' };
    traceLabel.textContent = (full ? _labelMapFull : _labelMap)[S.traceMode] || 'trace';
  }

  // ── Legacy button compat ──
  const legacyMode = document.getElementById('seqModeBtn');
  if (legacyMode) legacyMode.classList.toggle('active', isLoop);
  const legacyLock = document.getElementById('seedLockBtn');
  if (legacyLock) legacyLock.classList.toggle('active', S.traceMode !== 'trace');

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
      _savedCloudLoopMode = S.seedLoopMode ?? 'pingpong';
      if (S.seedLoopMode === 'pingpong') S.seedLoopMode = 'forward';
    } else if (!isLoop && prevMode === 'loop') {
      // loop → cloud: restore saved cloud dir (default ping-pong if never set)
      S.seedLoopMode = _savedCloudLoopMode ?? 'pingpong';
    }
    // Sync active button
    dirSeg.querySelectorAll('[data-loopmode]').forEach(b =>
      b.classList.toggle('active', b.dataset.loopmode === S.seedLoopMode));
    // Grey-out ping-pong button in loop mode
    const pingpongBtn = dirSeg.querySelector('[data-loopmode="pingpong"]');
    if (pingpongBtn) {
      pingpongBtn.style.opacity       = isLoop ? '0.35' : '';
      pingpongBtn.style.pointerEvents = isLoop ? 'none'  : '';
    }
  }

  // Also refresh slot-full state
  _syncSeqButtonStates();

  // Grey out handsfree button when not in plain trace mode
  const hfBtn = document.getElementById('hfArmBtn');
  if (hfBtn) hfBtn.classList.toggle('hf-unavailable', S.traceMode !== 'trace');
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

export function createSeqFromStroke(strokeId, anchorParticle) {
  if (strokeId < 0) return;

  // Resolve anchor position early for overflow nearest-mode
  let anchorLon = 0, anchorLat = 0;
  if (anchorParticle) {
    anchorLon = anchorParticle.lon; anchorLat = anchorParticle.lat;
  } else {
    // Fall back to first particle of the stroke
    for (let i = 0; i < S.particles.length; i++) {
      if (S.particles[i].strokeId === strokeId) {
        anchorLon = S.particles[i].lon; anchorLat = S.particles[i].lat;
        break;
      }
    }
  }

  const slotIndex = _findSeqSlot(anchorLon, anchorLat);
  if (slotIndex === -1) return;  // all slots full, overflow off
  // If replacing an existing seq, stop its audio first
  if (S.seqSlots[slotIndex]) {
    _stopSeqAudio(S.seqSlots[slotIndex]);
    S.seqSlots[slotIndex] = null;
  }

  // Collect particles belonging to this stroke, preserving paint order.
  // Paint order = array index order (particles are pushed sequentially).
  const seqParticles = [];
  for (let i = 0; i < S.particles.length; i++) {
    if (S.particles[i].strokeId === strokeId) {
      seqParticles.push(S.particles[i]);
    }
  }
  if (seqParticles.length === 0) return;

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
  if (!buffer) return;

  const n = seqParticles.length;
  const loopStart = seqParticles[0].grainStart;
  const lastP     = seqParticles[n - 1];
  const loopEnd   = Math.min(buffer.duration, lastP.grainStart + lastP.grainDuration);

  // ── Build a crossfaded loop buffer ─────────────────────────────────────
  // Extract the loop region into a standalone buffer with a crossfade
  // baked into the boundaries so the native loop=true wrap is click-free.
  // 30ms is aggressive enough to kill any discontinuity while staying
  // imperceptible on musical material.
  const XFADE_S = 0.030;
  const actx = S.audioCtx || new AudioContext();
  const sr   = buffer.sampleRate;
  const nCh  = buffer.numberOfChannels;
  const startSamp = Math.floor(loopStart * sr);
  const endSamp   = Math.min(buffer.length, Math.ceil(loopEnd * sr));
  const regionLen = endSamp - startSamp;
  // Guard against degenerate regions (e.g. noise gate rejected most particles,
  // leaving a near-zero region that createBuffer would reject).
  const MIN_LOOP_SAMPLES = Math.max(2, Math.floor(sr * 0.01)); // 10ms minimum
  if (regionLen < MIN_LOOP_SAMPLES) return;
  const xfadeSamp = Math.min(Math.floor(XFADE_S * sr), Math.floor(regionLen / 4));

  const loopBuffer = actx.createBuffer(nCh, regionLen, sr);
  for (let ch = 0; ch < nCh; ch++) {
    const src = buffer.getChannelData(ch);
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

  // Anchor position for distance calculations:
  // - For D-drops (anchorParticle provided): use the anchor particle's position
  // - For seq-mode strokes (no anchor): use the first particle of the stroke
  const anchorP = anchorParticle || seqParticles[0];

  const color = COMMIT_COLORS[slotIndex];
  S.commitSlots[slotIndex] = {
    type: 'loop',
    slotIndex,
    strokeId,
    particles:      seqParticles,
    buffer:         loopBuffer,             // crossfaded loop buffer
    loopStart:      0,                      // buffer start (always 0 now)
    loopEnd:        loopBuffer.duration,     // buffer end (full buffer)
    playheadIndex:  startIdx,
    startOffset:    anchorParticle ? (seqParticles[startIdx].grainStart) : 0,
    direction:      S.seedLoopMode === 'rev' ? -1 : 1,
    speed:          S.seqNextParams.speed ?? 1.0,
    playing:        true,
    color,
    anchorLon:      anchorP.lon,    // position used for distance/nearest calcs
    anchorLat:      anchorP.lat,
    _sourceNode:    null,           // AudioBufferSourceNode (created by scheduler)
    _gainNode:      null,           // GainNode for volume control
    _revBuffer:     null,           // cached reversed buffer (created lazily if direction=-1)
    _createdAt:     performance.now() / 1000, // wallclock creation time (seconds)
    _startedAt:     0,              // audioContext.currentTime when started
    grainParams: {
      volume: S.seqNextParams.volume ?? S.grainOverrides.volume ?? S.grainParams.volume ?? 1.0,
    },
  };
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
  if (slotIndex === -1) return;  // all slots full, overflow off
  // If replacing an existing commit, clean it up first
  if (S.commitSlots[slotIndex]) {
    const existing = S.commitSlots[slotIndex];
    if (existing.type === 'loop') _stopSeqAudio(existing);
    S.commitSlots[slotIndex] = null;
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
    startOffset:    anchorParticle ? (anchorParticle.grainStart - sourceSeq.loopStart) : 0,
    direction:      S.seedLoopMode === 'rev' ? -1 : 1,
    speed:          S.seqNextParams.speed ?? 1.0,
    playing:        true,
    color,
    anchorLon:      aLon,                     // drop point — used for distance calcs
    anchorLat:      aLat,
    _sourceNode:    null,
    _gainNode:      null,
    _revBuffer:     null,
    _createdAt:     performance.now() / 1000,
    _startedAt:     0,
    grainParams: {
      volume: S.seqNextParams.volume ?? S.grainOverrides.volume ?? S.grainParams.volume ?? 1.0,
    },
  };
  _syncSeqButtonStates();
}

/**
 * Stop and remove a single sequence by slot index.
 */
export function removeSeq(slotIndex) {
  const slot = S.commitSlots[slotIndex];
  if (!slot) return;
  if (slot.type === 'loop') _stopSeqAudio(slot);
  S.commitSlots[slotIndex] = null;
  S._syncCommitUI?.();
}

/**
 * Remove any sequence whose strokeId matches the given id.
 * Called from undoLastStroke to clean up sequences when their stroke is undone.
 */
export function removeSeqByStrokeId(strokeId) {
  for (let i = 0; i < S.commitSlotCount; i++) {
    const slot = S.commitSlots[i];
    if (slot && slot.type === 'loop' && slot.strokeId === strokeId) {
      removeSeq(i);
    }
  }
}

/**
 * Remove all loops (legacy compat — clearAllCommits is preferred).
 */
export function clearAllSeqs() {
  for (let i = 0; i < MAX_COMMITS; i++) {
    const slot = S.commitSlots[i];
    if (slot && slot.type === 'loop') {
      _stopSeqAudio(slot);
      S.commitSlots[i] = null;
    }
  }
  S._syncCommitUI?.();
}

// ── Unified commit operations ─────────────────────────────────────────────

/**
 * Release the commit targeted by selectionMode (closest or farthest from cursor).
 * Replaces uprootNearestSeed() and pickupSeqRemove().
 * Clouds get a release envelope; loops are stopped immediately.
 */
export function releaseCommit() {
  const { lon, lat } = getCursorPos();
  let targetSlot = -1, targetAng = S.selectionMode === 'closest' ? Infinity : -1;
  for (let i = 0; i < S.commitSlotCount; i++) {
    const slot = S.commitSlots[i];
    if (!slot) continue;
    // Skip clouds already fading out or loops already playing to end
    if (slot.type === 'cloud' && slot._releasingAt > 0) continue;
    if (slot.type === 'loop' && (slot._playingToEnd || slot._fadingOut)) continue;
    // Get position for distance calc
    let sLon, sLat;
    if (slot.type === 'cloud') {
      sLon = (slot.frames && slot.frames.length) ? slot.frames[0].lon : slot.lon;
      sLat = (slot.frames && slot.frames.length) ? slot.frames[0].lat : slot.lat;
    } else {
      sLon = slot.anchorLon ?? slot.particles?.[0]?.lon;
      sLat = slot.anchorLat ?? slot.particles?.[0]?.lat;
    }
    if (sLon == null || sLat == null) continue;
    const ang = angleBetweenSphere(sLon, sLat, lon, lat);
    if (S.selectionMode === 'closest' ? ang < targetAng : ang > targetAng) {
      targetAng = ang;
      targetSlot = i;
    }
  }
  if (targetSlot === -1) return;
  const slot = S.commitSlots[targetSlot];
  if (slot.type === 'cloud') {
    // Cloud: apply release envelope
    const rel = S.commitRelease || 0;
    if (rel <= 0) {
      S.commitSlots[targetSlot] = null;
    } else {
      slot._envRelease  = rel;
      slot._releasingAt = performance.now() / 1000;
    }
  } else {
    // Loop: stop audio — both fade and play-to-end defer slot removal to 'ended' event
    _stopSeqAudio(slot, S.loopReleaseMode === 'play-to-end');
  }
  S._syncCommitUI?.();
  (S.updateSeedBanksUI || updateSeedBanksUI)();
}

/**
 * Release all commits. Clouds get envelope, loops fade/play-to-end.
 */
export function clearAllCommits() {
  const now = performance.now() / 1000;
  const rel = S.commitRelease || 0;
  for (let i = 0; i < MAX_COMMITS; i++) {
    const slot = S.commitSlots[i];
    if (!slot) continue;
    if (slot.type === 'cloud') {
      if (rel > 0 && !slot._releasingAt) {
        slot._envRelease  = rel;
        slot._releasingAt = now;
      } else if (rel <= 0) {
        S.commitSlots[i] = null;
      }
    } else {
      // Both fade and play-to-end defer slot removal to 'ended' event
      _stopSeqAudio(slot, S.loopReleaseMode === 'play-to-end');
    }
  }
  S._syncCommitUI?.();
  (S.updateSeedBanksUI || updateSeedBanksUI)();
}

// ── Sequence panel helpers ────────────────────────────────────────────────

/**
 * Find the nearest active (playing) sequence slot to the given lon/lat.
 * Distance is measured to the first particle in the sequence.
 */
export function findNearestSeqSlot(refLon, refLat, filterPlaying = null) {
  let nearestSlot = -1, nearestAng = Infinity;
  for (let i = 0; i < S.seqSlotCount; i++) {
    const seq = S.commitSlots[i];
    if (!seq || seq.type !== 'loop') continue;
    if (filterPlaying !== null && seq.playing !== filterPlaying) continue;
    // Use explicit anchor position if set, otherwise fall back to first particle
    const aLon = seq.anchorLon ?? seq.particles[0]?.lon;
    const aLat = seq.anchorLat ?? seq.particles[0]?.lat;
    if (aLon == null || aLat == null) continue;
    const ang = angleBetweenSphere(aLon, aLat, refLon, refLat);
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
function _stopSeqAudio(seq, playToEnd = false) {
  const gain = seq._gainNode;
  const src  = seq._sourceNode;

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

      // Schedule fade-out over last 50ms (or less if loop is very short)
      const fadeTime = Math.min(0.05, remainSec * 0.5);
      const fadeStart = now + Math.max(0, remainSec - fadeTime);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, fadeStart);
      gain.gain.linearRampToValueAtTime(0, fadeStart + fadeTime);

      // Mark as releasing-to-end so grain scheduler skips playhead updates
      seq._playingToEnd = true;

      // Clean up on natural end
      src.addEventListener('ended', () => {
        src._stopped = true;
        if (seq._extraNodes) {
          for (const n of seq._extraNodes) { try { n.disconnect(); } catch (_) {} }
          seq._extraNodes = null;
        }
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

  // Default: fade-out using loopFadeTimeMs
  const FADE_MS = S.loopFadeTimeMs || 15;
  if (gain && src) {
    const actx = S.audioCtx;
    if (actx) {
      const now = actx.currentTime;
      const fadeSec = FADE_MS / 1000;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + fadeSec);
      try { src.stop(now + fadeSec + 0.01); } catch (_) {}

      // Mark as fading so grain scheduler / slot logic can treat it as releasing
      seq._fadingOut = true;

      // Defer cleanup until source actually ends (after the fade completes)
      src.addEventListener('ended', () => {
        src._stopped = true;
        if (seq._extraNodes) {
          for (const n of seq._extraNodes) { try { n.disconnect(); } catch (_) {} }
          seq._extraNodes = null;
        }
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
export function dropSeqFromCursor() {
  const { lon, lat } = getCursorPos();
  const searchRad = S.searchRadiusDeg * Math.PI / 180;

  // Find the nearest particle within the search radius
  let nearest = null, nearestAng = Infinity;
  for (let i = 0; i < S.particles.length; i++) {
    const p = S.particles[i];
    if (p.strokeId == null || p.strokeId < 0) continue;
    const ang = angleBetweenSphere(p.lon, p.lat, lon, lat);
    if ((S.nearestMode || ang < searchRad) && ang < nearestAng) {
      nearestAng = ang;
      nearest = p;
    }
  }
  if (!nearest) return;  // nothing within radius — do nothing

  // Check if this stroke already has a loop — if so, add another playhead
  // on the same buffer rather than blocking creation.
  let existingSlot = null;
  for (let i = 0; i < S.commitSlotCount; i++) {
    const slot = S.commitSlots[i];
    if (slot && slot.type === 'loop' && slot.strokeId === nearest.strokeId) {
      existingSlot = slot;
      break;
    }
  }

  if (existingSlot) {
    addPlayheadFromExisting(existingSlot, nearest);
  } else {
    createSeqFromStroke(nearest.strokeId, nearest);
  }
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

  // Legacy count element
  const seedsEl = document.getElementById('seedsPlantedCount');
  if (seedsEl) seedsEl.textContent = clouds + ' planted';

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

  // Background circle
  const alpha = seq.playing ? (isNearest ? '77' : '44') : '22';
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fillStyle = seq.color + alpha;
  c.fill();

  // Dim track ring
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.strokeStyle = seq.playing ? seq.color + '33' : seq.color + '22';
  c.lineWidth = 2.5;
  c.stroke();

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
  // Envelope state
  const envG = seed._envGainCurrent ?? 1;
  const isEnveloping = envG < 0.999;
  let envAlphaMul = envG;
  if (isEnveloping) {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.004 * Math.PI);
    envAlphaMul = envG * (0.5 + 0.5 * pulse);
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

export function selectPreset(index) {
  S.activePresetIndex = index;
  S._patchFlashUntil = performance.now() + 1200;
  const preset = PRESETS[index];

  // Update HUD patch info
  const patchEl = document.getElementById('vmPatchInfo');
  if (patchEl) patchEl.textContent = `${index + 1} ${preset.name || ''}`;

  // ── Empty-preset guard ────────────────────────────────────────────────
  // If the preset has no parameter data (only name/userDefined), skip all
  // parameter application — selecting an empty slot should change nothing.
  const hasParams = presetHasParams(preset);
  if (!hasParams) {
    // Still update UI indicators (active button, HUD) but touch no state.
    document.querySelectorAll('.preset-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i === index);
    });
    syncAllUI();
    drawPresetWaveform();
    updatePresetStats();
    S._patchTableRefresh?.();
    S._syncPresetDropdown?.();
    return;
  }

  // ── Sparse application: only apply keys that exist in the preset ──────
  // For grain engine params, we still need the grainParams merge for
  // backward compatibility with factory presets and the grain engine's
  // fallback chain (grainOverrides → grainParams).

  // Check which grain-engine keys are present in this preset
  // durJitter + retriggerMs are not in PARAM_REGISTRY (no patch table row)
  // but factory presets define them — keep here so factory recall still works.
  // User presets won't have them: loadUserPresets strips unknown keys on load.
  const GRAIN_KEYS = ['duration', 'durJitter', 'durVar', 'fadeRatio', 'period',
    'periodVar', 'pitchJitter', 'pitchShift', 'panSpread', 'volume', 'k',
    'retriggerMs'];
  const hasAnyGrainKey = GRAIN_KEYS.some(k => k in preset && preset[k] !== undefined && preset[k] !== null);

  if (hasAnyGrainKey) {
    // Merge grain params — only present keys overwrite grainParams
    for (const k of GRAIN_KEYS) {
      if (k in preset && preset[k] !== undefined && preset[k] !== null) {
        if (isLocked(k)) continue;   // ◆ param lock
        S.grainParams[k] = preset[k];
      }
    }
    // Clear overrides for keys that are mapped (so grainParams value is used)
    Object.keys(S.grainOverrides).forEach(k => {
      if (k in preset && preset[k] !== undefined && preset[k] !== null) {
        if (isLocked(k)) return;     // ◆ param lock
        S.grainOverrides[k] = null;
      }
    });
  }

  // Set curveType (and direction) BEFORE rebuildGrainCurves so the cached
  // attack/release arrays are built for the incoming preset, not the old one.
  if ('direction' in preset && preset.direction)  S.grainDirection  = preset.direction;
  if ('curveType' in preset && preset.curveType)  S.grainCurveType  = preset.curveType;
  rebuildGrainCurves();

  if ('nearestMode' in preset && typeof preset.nearestMode === 'boolean') S.nearestMode = preset.nearestMode;
  if ('grainKAllMode' in preset && typeof preset.grainKAllMode === 'boolean') S.grainKAllMode = preset.grainKAllMode;
  // Enforce constraint: k-all not allowed with k-nearest
  if (S.nearestMode && S.grainKAllMode) S.grainKAllMode = false;
  if ('grainKSeqMode' in preset && typeof preset.grainKSeqMode === 'boolean') S.grainKSeqMode = preset.grainKSeqMode;
  if (!isLocked('searchRadiusDeg') && 'searchRadiusDeg' in preset && typeof preset.searchRadiusDeg === 'number') S.searchRadiusDeg = preset.searchRadiusDeg;
  if (!isLocked('recencyN') && 'recencyN' in preset && typeof preset.recencyN === 'number') {
    if (typeof S.setRecency === 'function') S.setRecency(preset.recencyN);
    else S.recencyN = preset.recencyN;
  }
  if (!isLocked('k') && 'k' in preset && typeof preset.k === 'number') {
    if (typeof S.setSearchK === 'function') S.setSearchK(preset.k);
    else S.grainOverrides.k = preset.k;
  }
  if ('probability' in preset && typeof preset.probability === 'number') S.grainProbability = preset.probability;
  if ('radiusFadeEnabled' in preset && typeof preset.radiusFadeEnabled === 'boolean') S.radiusFadeEnabled = preset.radiusFadeEnabled;
  if ('radiusFadeCurve' in preset && typeof preset.radiusFadeCurve === 'number') S.radiusFadeCurve = preset.radiusFadeCurve;

  // ── Apply all additional sparse params (cursor, seed, looper, morph) ──
  applySparsePreset(preset);

  document.querySelectorAll('.preset-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === index);
  });

  // Sync all UI controls
  syncAllUI();
  drawPresetWaveform();
  updatePresetStats();

  // Update patch table highlight if open
  S._patchTableRefresh?.();
  // Sync dropdown selector
  S._syncPresetDropdown?.();

}

/** Refresh all preset button labels from the in-memory PRESETS array.
 *  Call after loadUserPresets() to sync the DOM without a full page reload. */
export function refreshPresetButtons() {
  const btns = document.querySelectorAll('.preset-btn');
  btns.forEach((btn, i) => {
    if (i < FACTORY_PRESET_START) {
      // User-defined slot — update the .preset-name span
      const nameEl = btn.querySelector('.preset-name');
      if (nameEl) nameEl.textContent = PRESETS[i].name;
      btn.classList.toggle('user-preset', true);
    } else {
      // Factory preset — rebuild innerHTML preserving the structure
      const numEl = btn.querySelector('.preset-num');
      const num = numEl ? numEl.textContent : (i + 1);
      btn.innerHTML = `<span class="preset-num">${num}</span>${PRESETS[i].name}`;
    }
  });
  S._rebuildPresetDropdown?.();
  S._rebuildMorphDropdowns?.();
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
let _rvLastDeg      = -1;
let _rvLastNearest  = null;

export function drawRadiusViz() {
  // Always sync the slider + numbox readout regardless of whether the canvas exists
  const radSliderEl = document.getElementById('radiusSlider');
  if (radSliderEl) radSliderEl.value = S.searchRadiusDeg;
  const radValEl = document.getElementById('radiusVal');
  if (radValEl) radValEl.value = `${Math.round(S.searchRadiusDeg)}°`;

  const canvas = document.getElementById('radiusViz');
  if (!canvas) return;

  // Skip canvas redraw if nothing that affects the visualization has changed.
  if (S.searchRadiusDeg === _rvLastDeg && S.nearestMode === _rvLastNearest &&
      canvas.width > 0) return;
  _rvLastDeg     = S.searchRadiusDeg;
  _rvLastNearest = S.nearestMode;
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = rect.width  || 180;
  const h = rect.height || 48;
  const dpr = window.devicePixelRatio;
  const needW = Math.round(w * dpr), needH = Math.round(h * dpr);
  if (canvas.width !== needW || canvas.height !== needH) {
    canvas.width  = needW;
    canvas.height = needH;
  }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;

  if (S.nearestMode) {
    const d = Math.min(w, h) * 0.36;
    c.strokeStyle = '#e8a030';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(cx,     cy - d);
    c.lineTo(cx + d, cy    );
    c.lineTo(cx,     cy + d);
    c.lineTo(cx - d, cy    );
    c.closePath();
    c.stroke();
    c.fillStyle = '#e8a030';
    c.beginPath(); c.arc(cx, cy, 2.5, 0, Math.PI * 2); c.fill();
  } else {
    const maxR = Math.min(cx, cy) - 3;
    const minR = 4;
    const t = (S.searchRadiusDeg - 1) / (180 - 1);
    const r = minR + t * (maxR - minR);

    c.strokeStyle = '#2a2a2a';
    c.lineWidth = 1;
    c.beginPath(); c.arc(cx, cy, maxR, 0, Math.PI * 2); c.stroke();

    c.strokeStyle = '#7abcbc';
    c.lineWidth = 1.5;
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();

    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.beginPath(); c.arc(cx, cy, 2, 0, Math.PI * 2); c.fill();
  }
}

export function flashRadiusTooltip() {
  S.radiusTooltipUntil = performance.now() + 1200;
}

export function drawPresetWaveform() {
  const canvas = document.getElementById('presetWaveform');
  if (!canvas) return;
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = rect.width  || 180;
  const h = rect.height || 48;
  const dpr = window.devicePixelRatio;
  const needW = Math.round(w * dpr), needH = Math.round(h * dpr);
  if (canvas.width !== needW || canvas.height !== needH) {
    canvas.width  = needW;
    canvas.height = needH;
  }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  const pr = PRESETS[S.activePresetIndex];

  const liveDur    = Math.max(0.00001, S.grainOverrides.duration ?? pr.duration ?? gp().duration);
  const livePeriod = Math.max(0.00001, S.grainOverrides.period   ?? pr.period   ?? gp().period);

  const STATS_H = 11;
  const drawH   = h - STATS_H;
  const PAD     = 2;
  const baseY   = drawH;
  const maxAmp  = drawH;

  const minPeriod = 2 * (livePeriod * 5 + liveDur) / Math.max(1, w);
  const stride    = Math.max(minPeriod, livePeriod, 0.0001); // floor prevents NaN/Inf

  const viewSec  = stride * 4.5 + liveDur;
  const pxPerSec = w / viewSec;
  const grainW   = liveDur * pxPerSec;

  const atkShape = (t) => {
    if (S.grainCurveType === 'tri')  return t;
    if (S.grainCurveType === 'rect') return t <= 0 ? 0 : 1;
    return 0.5 * (1 - Math.cos(Math.PI * t));
  };
  const relShape = (t) => {
    if (S.grainCurveType === 'tri')  return 1 - t;
    if (S.grainCurveType === 'rect') return t >= 1 ? 0 : 1;
    return 0.5 * (1 + Math.cos(Math.PI * t));
  };

  const liveFadeRatio = S.grainOverrides.fadeRatio ?? pr.fadeRatio ?? gp().fadeRatio ?? 0.25;
  const liveFade      = Math.min(liveDur / 2 - 0.0001, liveDur * Math.min(liveFadeRatio, 0.5));

  const tints = ['#7abcbc', '#6090e0', '#e07060', '#a0c060', '#c060a0', '#e0a030', '#60a0e0', '#e06060'];
  const tint  = tints[S.activePresetIndex % tints.length] || '#7abcbc';

  // Hard cap: never draw more than 50 grain shapes.  At low period + high
  // duration the raw count can reach 100+ shapes × 82 canvas ops each =
  // 8 000+ path operations per frame → starves the grain scheduler.  50
  // shapes is visually indistinguishable from 100 at these scales.
  const MAX_WAVEFORM_GRAINS = 50;
  const rawCount = stride > 0 ? Math.ceil(viewSec / stride) + 1 : 6;
  const count    = Math.min(rawCount, MAX_WAVEFORM_GRAINS);
  const STEPS    = Math.min(40, count > 30 ? 20 : 40); // coarser steps at high shape counts
  const fadeW    = liveFade * pxPerSec;
  const ampH     = maxAmp - PAD * 2;

  // Reuse a single points array to avoid per-grain {x,y} allocation pressure.
  // At STEPS=40: up to 41 + 1 + 41 = 83 points per grain.
  const maxPts = STEPS * 2 + 3;
  const ptsX = new Float64Array(maxPts);
  const ptsY = new Float64Array(maxPts);

  for (let i = 0; i < count; i++) {
    // All grains drawn at nominal size — the viz shows the pattern, not stochastic variation
    const xStart = i * stride * pxPerSec;
    const fadeWi = liveFade * pxPerSec;
    const sustWi = Math.max(0, grainW - fadeWi * 2);

    let nPts = 0;
    for (let s = 0; s <= STEPS; s++) {
      const t = s / STEPS;
      ptsX[nPts] = xStart + t * fadeWi;
      ptsY[nPts] = baseY - PAD - atkShape(t) * ampH;
      nPts++;
    }
    if (sustWi > 0) {
      ptsX[nPts] = xStart + fadeWi + sustWi;
      ptsY[nPts] = baseY - PAD - ampH;
      nPts++;
    }
    for (let s = 0; s <= STEPS; s++) {
      const t = s / STEPS;
      ptsX[nPts] = xStart + fadeWi + sustWi + t * fadeWi;
      ptsY[nPts] = baseY - PAD - relShape(t) * ampH;
      nPts++;
    }

    c.beginPath();
    c.moveTo(ptsX[0], baseY);
    for (let j = 0; j < nPts; j++) c.lineTo(ptsX[j], ptsY[j]);
    c.lineTo(ptsX[nPts - 1], baseY);
    c.closePath();
    c.globalAlpha = 0.1;
    c.fillStyle = tint;
    c.fill();

    c.beginPath();
    c.moveTo(ptsX[0], ptsY[0]);
    for (let j = 1; j < nPts; j++) c.lineTo(ptsX[j], ptsY[j]);
    c.globalAlpha = 0.65;
    c.strokeStyle = tint;
    c.lineWidth = 1.5;
    c.stroke();
  }
  c.globalAlpha = 1;

  c.globalAlpha = 0.15;
  c.strokeStyle = '#ffffff';
  c.lineWidth = 0.5;
  c.beginPath();
  c.moveTo(0, baseY); c.lineTo(w, baseY);
  c.stroke();
  c.globalAlpha = 1;

  const durStr   = fmtMs(liveDur);
  const perStr   = fmtMs(livePeriod);
  const curveStr = (S.grainCurveType || 'hann').slice(0, 4);
  const statY = h - 2;
  const fs    = Math.max(7, Math.round(7.5 * window.devicePixelRatio) / window.devicePixelRatio);
  c.font = `${fs}px 'Roboto Mono', monospace`;
  c.textBaseline = 'bottom';

  c.globalAlpha = 0.12;
  c.strokeStyle = '#ffffff';
  c.lineWidth = 0.5;
  c.beginPath(); c.moveTo(0, drawH); c.lineTo(w, drawH); c.stroke();
  c.globalAlpha = 1;

  const pairs = [['dur', durStr], ['per', perStr], ['env', curveStr]];
  const segW  = w / pairs.length;
  pairs.forEach(([label, val], i) => {
    const x = segW * i + 4;
    c.textAlign = 'left';
    c.fillStyle = '#444';
    c.fillText(label + ' ', x, statY);
    const labelW = c.measureText(label + ' ').width;
    c.fillStyle = '#7abcbc';
    c.fillText(val, x + labelW, statY);
  });
}

export function updatePresetStats() {
  const pr = PRESETS[S.activePresetIndex];
  const durEl = document.getElementById('psDur');
  const kEl   = document.getElementById('psK');
  const panEl = document.getElementById('psPan');
  // Fall through to live grainParams when preset has no value (empty user slot)
  const dur = pr.duration ?? (S.grainOverrides.duration ?? gp().duration);
  const k   = pr.k       ?? (S.grainOverrides.k        ?? gp().k);
  const pan = pr.panSpread ?? (S.grainOverrides.panSpread ?? gp().panSpread);
  if (durEl) durEl.textContent = fmtMs(dur);
  if (kEl)   kEl.textContent   = k === 0 ? 'nearest' : k;
  if (panEl) panEl.textContent = Math.round((pan ?? 0) * 100) + '%';
}

// ── Grain controls panel ─────────────────────────────────────────────────────
// Called once from main.js (or events.js) after DOM ready.
// Registers S.syncGrainControlsUI so selectPreset can call it.

export function initGrainControls() {
  const _LOG_MIN_MS = 1; // 1ms — bottom of the log slider range for both duration and period
  const _LOG_MIN = Math.log(_LOG_MIN_MS), _LOG_MAX = Math.log(4000);
  const _sliderToMs = sv => Math.exp(_LOG_MIN + (parseFloat(sv) / 1000) * (_LOG_MAX - _LOG_MIN));
  const _msToSlider = ms => Math.round(((Math.log(Math.max(_LOG_MIN_MS, ms)) - _LOG_MIN) / (_LOG_MAX - _LOG_MIN)) * 1000);
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
      toDisplay: _fmtMs,
      sliderToInternal: sv => Math.max(minGrainDurS(), _sliderToMs(sv) / 1000),
      internalToSlider: v  => _msToSlider(v * 1000),
      fromDisplay: str => { const v = _parseMs(str); return isNaN(v) ? null : Math.max(minGrainDurS(), Math.min(4, v)); },
    },
    {
      sliderId: 'gcDurVarSlider', numId: 'gcDurVarNum', param: 'durVar',
      toDisplay: v => Math.round(v * 1000) + 'ms',
      sliderToInternal: sv => parseFloat(sv) / 1000,
      internalToSlider: v  => Math.round(v * 1000),
      fromDisplay: str => { const v = _parseMs(str); return isNaN(v) ? null : Math.max(0, Math.min(0.5, v)); },
    },
    {
      sliderId: 'gcFadeSlider', numId: 'gcFadeNum', param: 'fadeRatio',
      toDisplay: v => Math.round(v * 100) + '%',
      sliderToInternal: sv => parseFloat(sv) / 100,
      internalToSlider: v  => Math.round(v * 100),
      fromDisplay: str => { const v = parseFloat(str.replace('%', '')) / 100; return isNaN(v) ? null : Math.max(0, Math.min(0.5, v)); },
    },
    {
      sliderId: 'gcPeriodSlider', numId: 'gcPeriodNum', param: 'period',
      toDisplay: _fmtMs,
      sliderToInternal: sv => Math.max(SCHED_SAFE_PERIOD_S, _sliderToMs(sv) / 1000),
      internalToSlider: v  => _msToSlider(v * 1000),
      fromDisplay: str => { const v = _parseMs(str); return isNaN(v) ? null : Math.max(SCHED_SAFE_PERIOD_S, Math.min(4, v)); },
    },
    {
      sliderId: 'gcPeriodVarSlider', numId: 'gcPeriodVarNum', param: 'periodVar',
      toDisplay: v => Math.round(v * 1000) + 'ms',
      sliderToInternal: sv => parseFloat(sv) / 1000,
      internalToSlider: v  => Math.round(v * 1000),
      fromDisplay: str => { const v = _parseMs(str); return isNaN(v) ? null : Math.max(0, Math.min(0.5, v)); },
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
      },
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
      },
    },
    {
      sliderId: 'gcProbSlider', numId: 'gcProbNum', param: 'probability',
      toDisplay: v => Math.round(v * 100) + '%',
      sliderToInternal: sv => parseFloat(sv),
      internalToSlider: v => v,
      fromDisplay: str => { const v = parseFloat(str.replace('%', '')) / 100; return isNaN(v) ? null : Math.max(0, Math.min(1, v)); },
    },
    {
      sliderId: 'gcPanSlider', numId: 'gcPanNum', param: 'panSpread',
      toDisplay: v => Math.round(v * 100) + '%',
      sliderToInternal: sv => parseFloat(sv),
      internalToSlider: v => v,
      fromDisplay: str => { const v = parseFloat(str.replace('%', '')) / 100; return isNaN(v) ? null : Math.max(0, Math.min(1, v)); },
    },
    {
      sliderId: 'gcVolSlider', numId: 'gcVolNum', param: 'volume',
      toDisplay: v => v.toFixed(3),
      sliderToInternal: sv => parseFloat(sv),
      internalToSlider: v => v,
      fromDisplay: str => { const v = parseFloat(str); return isNaN(v) ? null : Math.max(0.001, Math.min(2.0, v)); },
    },
  ];

  // rAF-throttled waveform preview — avoids blocking the main thread with
  // canvas draws during rapid slider drags (was running at ~20fps synchronously,
  // each call doing ~8 000 canvas path operations, starving the grain scheduler).
  let _waveformRafId = 0;
  function requestWaveformRedraw() {
    if (!_waveformRafId) _waveformRafId = requestAnimationFrame(() => {
      _waveformRafId = 0;
      drawPresetWaveform();
    });
  }

  function setGrainParam(param, internalVal) {
    if (param === 'probability') {
      S.grainProbability = Math.max(0, Math.min(1, internalVal));
    } else {
      if (param === 'duration') internalVal = Math.max(minGrainDurS(), internalVal);
      if (param === 'period')   internalVal = Math.max(SCHED_SAFE_PERIOD_S, internalVal);
      S.grainOverrides[param] = internalVal;
      if (param === 'volume') rebuildGrainCurves();
      if (param === 'duration' || param === 'period' || param === 'fadeRatio') requestWaveformRedraw();
      if (param === 'period' || param === 'periodVar') resetCursorPeriod();
    }
  }

  function syncSliderFromInternal(def) {
    const slider = document.getElementById(def.sliderId);
    const numbox = document.getElementById(def.numId);
    if (!slider || !numbox) return;
    const val = def.param === 'probability' ? S.grainProbability
              : (S.grainOverrides[def.param] ?? gp()[def.param] ?? 0);
    slider.value = def.internalToSlider(val);
    if (document.activeElement !== numbox) numbox.value = def.toDisplay(val);
  }

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
    });

    const commitNumbox = () => {
      const internal = def.fromDisplay(numbox.value);
      if (internal !== null) {
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
    });
    numbox.addEventListener('blur', commitNumbox);
  });

  if (dirSeg) {
    dirSeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        S.grainDirection = btn.dataset.dir;
        dirSeg.querySelectorAll('.grain-seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      });
    });
  }

  if (curveSeg) {
    curveSeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        S.grainCurveType = btn.dataset.curve;
        curveSeg.querySelectorAll('.grain-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.curve === S.grainCurveType));
        rebuildGrainCurves();
        drawPresetWaveform();
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
  if (octDownBtn) {
    octDownBtn.addEventListener('click', () => {
      const cur = S.grainOverrides.pitchShift ?? gp().pitchShift ?? 0;
      _setPitchShift(cur - 1200);
    });
  }
  if (octResetBtn) {
    octResetBtn.addEventListener('click', () => {
      _setPitchShift(0);
    });
  }
  if (octUpBtn) {
    octUpBtn.addEventListener('click', () => {
      const cur = S.grainOverrides.pitchShift ?? gp().pitchShift ?? 0;
      _setPitchShift(cur + 1200);
    });
  }

  // Register syncGrainControlsUI on S so selectPreset can call it
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
    drawPresetWaveform();
    updatePresetStats();
  };

  // Init display from default preset
  S.syncGrainControlsUI();

  // ── Radial morph visual indicator ───────────────────────────────────────
  // When the gesture radial morph is driving params, toggle .param-morphed
  // on each affected grain-row so the slider thumb turns orange.
  // Extra param → slider-ID mapping for controls outside SLIDER_DEFS
  // Non-SLIDER_DEF controls: slider-based and segment-based UI elements
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

  S._syncRadialMorphUI = function() {
    const morphed = S.radialMorphActiveParams;
    SLIDER_DEFS.forEach(def => {
      const slider = document.getElementById(def.sliderId);
      if (!slider) return;
      const row = slider.closest('.grain-row');
      if (!row) return;
      row.classList.toggle('param-morphed', morphed?.has(def.param) ?? false);
    });
    // Also mark non-SLIDER_DEF slider controls (k, radius, recency, fade curve)
    EXTRA_MORPH_SLIDERS.forEach(def => {
      const el = document.getElementById(def.sliderId);
      if (!el) return;
      const row = el.closest('.grain-row');
      if (!row) return;
      row.classList.toggle('param-morphed', morphed?.has(def.param) ?? false);
    });
    // Segment/toggle controls (nearest, k-all, k-seq, radius fade, dir, curve)
    EXTRA_MORPH_SEGS.forEach(def => {
      const el = document.getElementById(def.segId);
      if (!el) return;
      const row = el.closest('.grain-row');
      if (!row) return;
      row.classList.toggle('param-morphed', morphed?.has(def.param) ?? false);
    });
  };
}

// ============================================================================
// DESKTOP MORPH — 1D slider morph for HCI (no sensor)
// ============================================================================
// Morphs the nearest non-moving seed's grain params between:
//   left preset (t=0) ←→ planted grain settings (t=0.5) ←→ right preset (t=1)
// Only active when nearest seed is stationary. Greyed out for moving seeds.

/** Grain-engine keys that desktop morph interpolates (no search params). */
const MORPH_GRAIN_KEYS = [
  'duration', 'durJitter', 'durVar', 'period', 'periodVar',
  'fadeRatio', 'pitchJitter', 'pitchShift', 'panSpread', 'volume',
];

/** Populate a preset dropdown (<select>) with user + factory presets. */
function _populateMorphSelect(sel) {
  sel.innerHTML = '<option value="-1">— none —</option>';
  for (let i = 0; i < PRESETS.length; i++) {
    const p = PRESETS[i];
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${i + 1}. ${p.name}`;
    sel.appendChild(opt);
  }
}

/** Apply morph interpolation to the nearest seed's grainOverrides. */
function _applyDesktopMorph(seed) {
  if (!seed) return;

  const t = S.desktopMorphT;
  const idxL = S.desktopMorphPresetL;
  const idxR = S.desktopMorphPresetR;

  // Center position → clear overrides (seed plays its planted params)
  if (Math.abs(t - 0.5) < 0.002) {
    // Reset seed.grainOverrides for morph keys only
    for (const k of MORPH_GRAIN_KEYS) {
      if (seed.grainOverrides[k] !== undefined) delete seed.grainOverrides[k];
    }
    if (seed.grainParams._cachedAtk) seed.grainParams._cachedAtk = null;
    return;
  }

  // Planted params = the center reference
  const center = seed.grainParams;

  if (t < 0.5) {
    // Morph toward left preset
    if (idxL < 0 || !PRESETS[idxL]) return;
    const left = PRESETS[idxL];
    const localT = 1 - (t / 0.5); // 0 at center, 1 at far left
    const lerped = lerpPresets(center, left, localT);
    for (const k of MORPH_GRAIN_KEYS) {
      if (typeof lerped[k] === 'number') seed.grainOverrides[k] = lerped[k];
    }
  } else {
    // Morph toward right preset
    if (idxR < 0 || !PRESETS[idxR]) return;
    const right = PRESETS[idxR];
    const localT = (t - 0.5) / 0.5; // 0 at center, 1 at far right
    const lerped = lerpPresets(center, right, localT);
    for (const k of MORPH_GRAIN_KEYS) {
      if (typeof lerped[k] === 'number') seed.grainOverrides[k] = lerped[k];
    }
  }

  // Invalidate envelope curve cache so playGrain picks up new fadeRatio
  if (seed.grainParams._cachedAtk) seed.grainParams._cachedAtk = null;
}

/** Start a return-to-center animation when the slider is released. */
function _startReturnToCenter(slider) {
  cancelAnimationFrame(S._desktopMorphAnimId);
  const startT   = S.desktopMorphT;
  const startMs  = performance.now();
  const duration = S.desktopMorphReturnMs;

  function tick(now) {
    const elapsed = now - startMs;
    const progress = Math.min(1, elapsed / duration);
    // Ease-in-out sine — smooth start and end, visible motion across full duration
    const ease = 0.5 - 0.5 * Math.cos(progress * Math.PI);
    S.desktopMorphT = startT + (0.5 - startT) * ease;
    slider.value = S.desktopMorphT;

    // Apply to seed
    const { lon, lat } = getCursorPos();
    const slot = findNearestSeedSlot(lon, lat);
    if (slot >= 0) _applyDesktopMorph(S.seedSlots[slot]);

    if (progress < 1) {
      S._desktopMorphAnimId = requestAnimationFrame(tick);
    }
  }
  S._desktopMorphAnimId = requestAnimationFrame(tick);
}

export function initDesktopMorph() {
  const section   = document.getElementById('desktopMorphSection');
  const slider    = document.getElementById('morphSlider');
  const selectL   = document.getElementById('morphPresetL');
  const selectR   = document.getElementById('morphPresetR');
  const stickySeg = document.getElementById('morphStickySeg');
  const returnSl  = document.getElementById('morphReturnSlider');
  const returnNum = document.getElementById('morphReturnNum');
  const returnRow = document.getElementById('morphReturnRow');
  if (!section || !slider || !selectL || !selectR) return;

  // ── Restore persisted morph settings from localStorage ──────────────
  const _MORPH_KEY = 'mubone_desktop_morph';
  function _loadMorphSettings() {
    try {
      const raw = localStorage.getItem(_MORPH_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (typeof saved.presetL === 'number') S.desktopMorphPresetL = saved.presetL;
      if (typeof saved.presetR === 'number') S.desktopMorphPresetR = saved.presetR;
      if (typeof saved.sticky  === 'boolean') S.desktopMorphSticky = saved.sticky;
      if (typeof saved.returnMs === 'number') S.desktopMorphReturnMs = saved.returnMs;
    } catch (_) {}
  }
  function _saveMorphSettings() {
    try {
      localStorage.setItem(_MORPH_KEY, JSON.stringify({
        presetL:  S.desktopMorphPresetL,
        presetR:  S.desktopMorphPresetR,
        sticky:   S.desktopMorphSticky,
        returnMs: S.desktopMorphReturnMs,
      }));
    } catch (_) {}
  }
  _loadMorphSettings();

  // Populate dropdowns
  _populateMorphSelect(selectL);
  _populateMorphSelect(selectR);
  selectL.value = S.desktopMorphPresetL;
  selectR.value = S.desktopMorphPresetR;

  // Rebuild dropdowns when user presets change (name edits, saves)
  S._rebuildMorphDropdowns = () => {
    const curL = selectL.value, curR = selectR.value;
    _populateMorphSelect(selectL);
    _populateMorphSelect(selectR);
    selectL.value = curL;
    selectR.value = curR;
  };

  // Dropdown handlers
  selectL.addEventListener('change', () => {
    S.desktopMorphPresetL = parseInt(selectL.value, 10);
    _saveMorphSettings();
  });
  selectR.addEventListener('change', () => {
    S.desktopMorphPresetR = parseInt(selectR.value, 10);
    _saveMorphSettings();
  });

  // Slider interaction
  let sliderActive = false;
  slider.addEventListener('input', () => {
    // Cancel any in-flight return animation so it doesn't fight the user drag
    cancelAnimationFrame(S._desktopMorphAnimId);
    S._desktopMorphAnimId = 0;
    sliderActive = true;
    S.desktopMorphT = parseFloat(slider.value);
    // Apply morph to nearest non-moving seed
    const { lon, lat } = getCursorPos();
    const slot = findNearestSeedSlot(lon, lat);
    if (slot >= 0) _applyDesktopMorph(S.seedSlots[slot]);
  });

  // On release, optionally return to center.
  // Use 'change' event — it fires reliably when slider interaction ends,
  // even if the pointer leaves the slider element (dragging to edges).
  // Also listen on document pointerup as a safety net for edge drags.
  const onRelease = () => {
    if (!sliderActive) return;
    sliderActive = false;
    if (!S.desktopMorphSticky) {
      _startReturnToCenter(slider);
    }
  };
  slider.addEventListener('change', onRelease);
  document.addEventListener('pointerup', (e) => {
    // Only trigger if slider was active (avoids spurious fires)
    if (sliderActive) onRelease();
  });

  // Sticky toggle
  stickySeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sticky = btn.dataset.sticky === 'true';
      S.desktopMorphSticky = sticky;
      stickySeg.querySelectorAll('.grain-seg-btn').forEach(b =>
        b.classList.toggle('active', (b.dataset.sticky === 'true') === sticky));
      // Grey out return time row when sticky (don't hide — just disable)
      if (returnRow) {
        returnRow.style.opacity = sticky ? '0.35' : '';
        returnRow.style.pointerEvents = sticky ? 'none' : '';
      }
      _saveMorphSettings();
    });
  });
  // Init sticky toggle from persisted state
  stickySeg.querySelectorAll('.grain-seg-btn').forEach(b =>
    b.classList.toggle('active', (b.dataset.sticky === 'true') === S.desktopMorphSticky));
  // Init return row visibility (greyed out when sticky)
  if (returnRow) {
    returnRow.style.opacity = S.desktopMorphSticky ? '0.35' : '';
    returnRow.style.pointerEvents = S.desktopMorphSticky ? 'none' : '';
  }

  // Return time slider
  if (returnSl && returnNum) {
    returnSl.value = S.desktopMorphReturnMs;
    returnNum.value = S.desktopMorphReturnMs + 'ms';
    returnSl.addEventListener('input', () => {
      S.desktopMorphReturnMs = parseInt(returnSl.value, 10);
      returnNum.value = S.desktopMorphReturnMs + 'ms';
    });
    returnSl.addEventListener('change', _saveMorphSettings);
  }

  // Hook into updateSeedBanksUI to grey out panel when no seeds exist
  const _origUpdateSeedBanksUI = updateSeedBanksUI;
  S.updateSeedBanksUI = function() {
    _origUpdateSeedBanksUI();
    const count = S.seedSlots.filter(c => c !== null).length;
    if (count === 0) {
      section.classList.add('morph-disabled');
    } else {
      section.classList.remove('morph-disabled');
    }
  };

  // ── S callbacks for MIDI / OSC access to cloud morph ────────────────────
  // Set morph position (0–1) from external source (CC fader, OSC float).
  // Cancels any in-flight return animation and applies morph to nearest seed.
  S._setDesktopMorphT = (t) => {
    cancelAnimationFrame(S._desktopMorphAnimId);
    S._desktopMorphAnimId = 0;
    S.desktopMorphT = Math.max(0, Math.min(1, t));
    if (slider) slider.value = S.desktopMorphT;
    const { lon, lat } = getCursorPos();
    const slot = findNearestSeedSlot(lon, lat);
    if (slot >= 0) _applyDesktopMorph(S.seedSlots[slot]);
  };

  // Toggle sticky mode from external trigger.
  S._toggleDesktopMorphSticky = () => {
    S.desktopMorphSticky = !S.desktopMorphSticky;
    if (stickySeg) stickySeg.querySelectorAll('.grain-seg-btn').forEach(b =>
      b.classList.toggle('active', (b.dataset.sticky === 'true') === S.desktopMorphSticky));
    if (returnRow) {
      returnRow.style.opacity = S.desktopMorphSticky ? '0.35' : '';
      returnRow.style.pointerEvents = S.desktopMorphSticky ? 'none' : '';
    }
    _saveMorphSettings();
  };

  // Set return time from external CC (50–3000 ms).
  S._setDesktopMorphReturnMs = (ms) => {
    S.desktopMorphReturnMs = Math.max(50, Math.min(3000, Math.round(ms)));
    if (returnSl) returnSl.value = S.desktopMorphReturnMs;
    if (returnNum) returnNum.value = S.desktopMorphReturnMs + 'ms';
    _saveMorphSettings();
  };
}
