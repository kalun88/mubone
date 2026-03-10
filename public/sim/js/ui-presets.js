// ============================================================================
// UI — PRESETS, GRAIN CONTROLS, CLOUD BANKS, RADIUS VIZ
// ============================================================================

import {
  S,
  PRESETS, CLOUD_COLORS, MAX_CLOUDS,
  gp, rebuildGrainCurves, minGrainDurS, minGrainPeriodS,
  SEARCH_RADIUS_MIN, SEARCH_RADIUS_MAX, SEARCH_RADIUS_STEP,
} from './state.js';
import { angleBetweenSphere, findNearestCloudSlot, resetCursorPeriod } from './grain.js';
import { ensureAudioContext, requestMicAccess, setMicBtnLabel } from './audio.js';
import { screenToLonLat, getCursorLonLat } from './sphere.js';

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

export function setupPresets() {
  const container = document.getElementById('presetButtons');
  PRESETS.forEach((preset, i) => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn' + (i === 0 ? ' active' : '');
    btn.innerHTML = `<span class="preset-num">${i + 1}</span>${preset.name}`;
    btn.addEventListener('click', () => selectPreset(i));
    container.appendChild(btn);
  });
  drawPresetWaveform();
  updatePresetStats();

  // Snap toggle button — initialise state on load then wire click
  updatePlaybackControls();
  const snapBtn = document.getElementById('snapToggleBtn');
  if (snapBtn) snapBtn.addEventListener('click', toggleNearestMode);

  // ── Recency slider ────────────────────────────────────────────────────────
  const recencyValEl    = document.getElementById('recencyVal');
  const recencySliderEl = document.getElementById('recencySlider');
  const RECENCY_MIN = 1, RECENCY_MAX = 16;

  // keep S.drawRecencyDial a no-op so renderer.js call is safe
  S.drawRecencyDial = function() {};

  S.setRecency = function(n) {
    S.recencyN = Math.max(RECENCY_MIN, Math.min(RECENCY_MAX, n));
    if (recencySliderEl) recencySliderEl.value = S.recencyN;
    if (recencyValEl)    recencyValEl.value    = S.recencyN;
  };

  if (recencySliderEl) {
    recencySliderEl.value = S.recencyN;
    let _recencyTimerId = null;
    recencySliderEl.addEventListener('input', () => {
      if (_recencyTimerId === null)
        _recencyTimerId = setTimeout(() => {
          _recencyTimerId = null;
          S.setRecency(parseInt(recencySliderEl.value));
        }, 50);
    });
  }

  // editable recency numbox — parse on commit
  if (recencyValEl) {
    recencyValEl.value = S.recencyN;
    recencyValEl.addEventListener('focus', e => e.target.select());
    recencyValEl.addEventListener('blur', () => {
      const v = parseInt(recencyValEl.value);
      if (!isNaN(v)) S.setRecency(v); else recencyValEl.value = S.recencyN;
    });
    recencyValEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { recencyValEl.blur(); }
      if (e.key === 'Escape') { recencyValEl.value = S.recencyN; recencyValEl.blur(); }
    });
    recencyValEl.style.cursor = 'text';
  }

  // ── k control in search params ────────────────────────────────────────────
  S.setSearchK = function(v) {
    const k = Math.max(1, Math.min(20, Math.round(v)));
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

  // Fullscreen — use Electron native API in Electron (requestFullscreen doesn't work
  // in BrowserWindow), fall back to web API in browser.
  function doToggleFullscreen() {
    if (window.electronBridge?.toggleFullscreen) {
      window.electronBridge.toggleFullscreen();
    } else {
      const wrapper = document.getElementById('canvasWrapper');
      if (!document.fullscreenElement) wrapper?.requestFullscreen().catch(() => {});
      else document.exitFullscreen();
    }
  }
  document.getElementById('fullscreenBtn2')?.addEventListener('click', doToggleFullscreen);

  // Expose selectPreset on S so osc.js can call it without a circular import
  S._selectPreset = selectPreset;

  // Mic enable button
  const micBtn = document.getElementById('micEnableBtn');
  if (micBtn) {
    micBtn.addEventListener('click', async () => {
      if (S.micPermissionGranted) return;
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
  updatePlaybackControls();
  flashRadiusTooltip();
}

// ── Cloud drop / pickup ───────────────────────────────────────────────────────

function getMouseLonLat() {
  return screenToLonLat(S.mousePixelX, S.mousePixelY);
}

export function dropCloud() {
  const slotIndex = S.cloudSlots.indexOf(null);
  if (slotIndex === -1) return;
  const { lon, lat } = S.mouseInCanvas ? getMouseLonLat() : getCursorLonLat();
  const color = CLOUD_COLORS[slotIndex];
  S.cloudSlots[slotIndex] = {
    slotIndex, lon, lat, color, searchRadiusDeg: S.searchRadiusDeg,
    nearestMode: S.nearestMode,
    _lastFiredAt:  0,
    _nextPeriodMs: 0,
    grainParams: { ...S.grainParams }
  };
  updateCloudBanksUI();
}

export function pickupNearestCloud() {
  const { lon, lat } = S.mouseInCanvas ? getMouseLonLat() : getCursorLonLat();
  const nearestSlot = findNearestCloudSlot(lon, lat);
  if (nearestSlot === -1) return;
  S.cloudSlots[nearestSlot] = null;
  updateCloudBanksUI();
}

function updateCloudBanksUI() {
  const count = S.cloudSlots.filter(c => c !== null).length;
  const cloudsEl = document.getElementById('cloudsPlantedCount');
  if (cloudsEl) cloudsEl.textContent = count;
  const vmClouds = document.getElementById('vmClouds');
  if (vmClouds) vmClouds.textContent = `clouds: ${count}`;

  const canvas = document.getElementById('cloudSlotsCanvas');
  if (!canvas) return;

  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = Math.round(rect.width  || 50);
  const H = Math.round(rect.height || 60);
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
  }
  const c = canvas.getContext('2d');
  c.save();
  c.scale(dpr, dpr);
  c.clearRect(0, 0, W, H);

  const COLS = 2, ROWS = 4, GAP = 4, PAD = 2;
  const cellW = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
  const cellH = (H - PAD * 2 - GAP * (ROWS - 1)) / ROWS;
  const r     = Math.min(cellW, cellH) / 2;

  for (let i = 0; i < MAX_CLOUDS; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const cx = PAD + col * (cellW + GAP) + cellW / 2;
    const cy = PAD + row * (cellH + GAP) + cellH / 2;
    const cloud = S.cloudSlots[i];

    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);

    if (cloud) {
      c.fillStyle   = cloud.color + '44';
      c.fill();
      c.strokeStyle = cloud.color;
      c.lineWidth   = 1.5;
      c.stroke();
    } else {
      c.fillStyle   = '#1a1a1a';
      c.fill();
      c.strokeStyle = '#2a2a2a';
      c.lineWidth   = 1;
      c.stroke();
    }
  }
  c.restore();
}

export function selectPreset(index) {
  S.activePresetIndex = index;
  const preset = PRESETS[index];
  S.grainParams = { ...preset };
  Object.keys(S.grainOverrides).forEach(k => S.grainOverrides[k] = null);
  // Set curveType (and direction) BEFORE rebuildGrainCurves so the cached
  // attack/release arrays are built for the incoming preset, not the old one.
  // Previously this was after rebuildGrainCurves, which left stale rect curves
  // in GRAIN_ATTACK_CURVE/GRAIN_RELEASE_CURVE whenever switching away from a
  // rect preset — causing a square-envelope sound on all subsequent grains.
  if (preset.direction)  S.grainDirection  = preset.direction;
  if (preset.curveType)  S.grainCurveType  = preset.curveType;
  rebuildGrainCurves();

  if (typeof preset.nearestMode === 'boolean') S.nearestMode = preset.nearestMode;
  if (typeof preset.searchRadiusDeg === 'number') S.searchRadiusDeg = preset.searchRadiusDeg;
  if (typeof preset.recencyN === 'number') {
    if (typeof S.setRecency === 'function') S.setRecency(preset.recencyN);
    else S.recencyN = preset.recencyN;
  }
  if (typeof preset.k === 'number') {
    if (typeof S.setSearchK === 'function') S.setSearchK(preset.k);
    else S.grainOverrides.k = preset.k;
  }
  if (typeof preset.probability === 'number') S.grainProbability = preset.probability;

  document.querySelectorAll('.preset-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === index);
  });
  S.syncGrainControlsUI?.();
  drawPresetWaveform();
  updatePresetStats();
  updatePlaybackControls();
}

export function updatePlaybackControls() {
  const snapBtn = document.getElementById('snapToggleBtn');
  if (snapBtn) {
    snapBtn.classList.toggle('active', S.nearestMode);
    const labelSpan = snapBtn.querySelector('.snap-label-text');
    if (labelSpan) labelSpan.textContent = S.nearestMode ? 'locked' : 'lock';
  }
  const snapStateNum = document.getElementById('snapStateNum');
  if (snapStateNum) snapStateNum.value = S.nearestMode ? 'on' : 'off';
  drawRadiusViz();
}

// Dirty-flag cache: skip canvas redraw when radius and nearestMode haven't changed.
// The numbox is always updated; only the canvas draw is gated.
let _rvLastDeg      = -1;
let _rvLastNearest  = null;

export function drawRadiusViz() {
  // Always update the numbox readout regardless of whether the canvas exists
  const radValEl = document.getElementById('radiusVal');
  if (radValEl) radValEl.value = `${S.searchRadiusDeg}°`;

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

  const liveDur    = S.grainOverrides.duration ?? pr.duration;
  const livePeriod = S.grainOverrides.period   ?? pr.period;

  const STATS_H = 11;
  const drawH   = h - STATS_H;
  const PAD     = 2;
  const baseY   = drawH;
  const maxAmp  = drawH;

  const minPeriod = 2 / ((w / (livePeriod * 5 + liveDur)));
  const stride    = Math.max(minPeriod, livePeriod);

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

  const liveFadeRatio = S.grainOverrides.fadeRatio ?? pr.fadeRatio ?? 0.25;
  const liveFade      = Math.min(liveDur / 2 - 0.0001, liveDur * Math.min(liveFadeRatio, 0.5));

  const tints = ['#7abcbc', '#6090e0', '#e07060', '#a0c060', '#c060a0', '#e0a030', '#60a0e0', '#e06060'];
  const tint  = tints[S.activePresetIndex % tints.length] || '#7abcbc';

  const count  = Math.ceil(viewSec / stride) + 1;
  const STEPS  = 40;
  const fadeW  = liveFade * pxPerSec;
  const ampH   = maxAmp - PAD * 2;

  for (let i = 0; i < count; i++) {
    // All grains drawn at nominal size — the viz shows the pattern, not stochastic variation
    const xStart = i * stride * pxPerSec;
    const fadeWi = liveFade * pxPerSec;
    const sustWi = Math.max(0, grainW - fadeWi * 2);

    const pts = [];
    for (let s = 0; s <= STEPS; s++) {
      const t = s / STEPS;
      pts.push({ x: xStart + t * fadeWi, y: baseY - PAD - atkShape(t) * ampH });
    }
    if (sustWi > 0) pts.push({ x: xStart + fadeWi + sustWi, y: baseY - PAD - ampH });
    for (let s = 0; s <= STEPS; s++) {
      const t = s / STEPS;
      pts.push({ x: xStart + fadeWi + sustWi + t * fadeWi, y: baseY - PAD - relShape(t) * ampH });
    }

    c.beginPath();
    c.moveTo(pts[0].x, baseY);
    for (const p of pts) c.lineTo(p.x, p.y);
    c.lineTo(pts[pts.length - 1].x, baseY);
    c.closePath();
    c.globalAlpha = 0.1;
    c.fillStyle = tint;
    c.fill();

    c.beginPath();
    pts.forEach((p, idx) => idx === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y));
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
  if (durEl) durEl.textContent = fmtMs(pr.duration);
  if (kEl)   kEl.textContent   = pr.k === 0 ? 'nearest' : pr.k;
  if (panEl) panEl.textContent = Math.round(pr.panSpread * 100) + '%';
}

// ── Grain controls panel ─────────────────────────────────────────────────────
// Called once from main.js (or events.js) after DOM ready.
// Registers S.syncGrainControlsUI so selectPreset can call it.

export function initGrainControls() {
  const _LOG_MIN_MS = 1; // 1ms hard floor — sub-ms periods cause audible clipping artifacts
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
      sliderToInternal: sv => Math.max(0.001, _sliderToMs(sv) / 1000),
      internalToSlider: v  => _msToSlider(v * 1000),
      fromDisplay: str => { const v = _parseMs(str); return isNaN(v) ? null : Math.max(0.001, Math.min(4, v)); },
    },
    {
      sliderId: 'gcPeriodVarSlider', numId: 'gcPeriodVarNum', param: 'periodVar',
      toDisplay: v => Math.round(v * 1000) + 'ms',
      sliderToInternal: sv => parseFloat(sv) / 1000,
      internalToSlider: v  => Math.round(v * 1000),
      fromDisplay: str => { const v = _parseMs(str); return isNaN(v) ? null : Math.max(0, Math.min(0.5, v)); },
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
      fromDisplay: str => { const v = parseFloat(str); return isNaN(v) ? null : Math.max(0.001, Math.min(0.5, v)); },
    },
  ];

  function setGrainParam(param, internalVal) {
    if (param === 'probability') {
      S.grainProbability = Math.max(0, Math.min(1, internalVal));
    } else {
      if (param === 'duration') internalVal = Math.max(minGrainDurS(), internalVal);
      if (param === 'period')   internalVal = Math.max(0.001, internalVal);
      S.grainOverrides[param] = internalVal;
      if (param === 'volume') rebuildGrainCurves();
      if (param === 'duration' || param === 'period' || param === 'fadeRatio') drawPresetWaveform();
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
      if (_sliderTimerId === null) _sliderTimerId = setTimeout(_flushSliderUpdates, 50);
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
    if (kNum) kNum.textContent = kVal;
    const recValEl = document.getElementById('recencyVal');
    if (recValEl) recValEl.textContent = S.recencyN;
    drawRadiusViz();
    updatePresetStats();
  };

  // Init display from default preset
  S.syncGrainControlsUI();
}
