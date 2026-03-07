// ============================================================================
// UI — PRESETS, GRAIN CONTROLS, CLOUD BANKS, RADIUS VIZ
// ============================================================================

import {
  S,
  PRESETS, CLOUD_COLORS, MAX_CLOUDS,
  gp, rebuildGrainCurves, minGrainDurS, minGrainPeriodS,
  SEARCH_RADIUS_MIN, SEARCH_RADIUS_MAX, SEARCH_RADIUS_STEP,
} from './state.js';
import { angleBetweenSphere, resetCursorPeriod } from './grain.js';
import { ensureAudioContext, requestMicAccess, setMicBtnLabel } from './audio.js';
import { screenToLonLat, getCursorLonLat } from './sphere.js';

// ── Grain presets UI ─────────────────────────────────────────────────────────

export function setupPresets() {
  const container = document.getElementById('presetButtons');
  PRESETS.forEach((preset, i) => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn' + (i === 0 ? ' active' : '');
    btn.textContent = preset.name;
    btn.addEventListener('click', () => selectPreset(i));
    container.appendChild(btn);
  });
  drawPresetWaveform();
  updatePresetStats();

  // Snap toggle button
  const snapBtn = document.getElementById('snapToggleBtn');
  if (snapBtn) snapBtn.addEventListener('click', toggleNearestMode);

  // ── Recency dial ──────────────────────────────────────────────────────────
  const recencyValEl  = document.getElementById('recencyVal');
  const recencyDialEl = document.getElementById('recencyDial');
  const RECENCY_MIN = 1, RECENCY_MAX = 16;

  S.drawRecencyDial = function() {
    if (!recencyDialEl) return;
    const dpr  = window.devicePixelRatio || 1;
    const rect = recencyDialEl.getBoundingClientRect();
    const W = Math.round(rect.width  || 50);
    const H = Math.round(rect.height || 60);
    if (recencyDialEl.width !== W * dpr || recencyDialEl.height !== H * dpr) {
      recencyDialEl.width  = W * dpr;
      recencyDialEl.height = H * dpr;
    }
    const dc = recencyDialEl.getContext('2d');
    dc.save();
    dc.scale(dpr, dpr);
    dc.clearRect(0, 0, W, H);

    const NUM_LINES = 5;
    const PAD_X = 4, PAD_T = 4, PAD_B = 4;
    const totalH = H - PAD_T - PAD_B;
    const gap    = totalH / (NUM_LINES - 1);

    for (let i = 0; i < NUM_LINES; i++) {
      const y = PAD_T + i * gap;
      const lit = i < Math.min(S.recencyN, NUM_LINES);
      dc.beginPath();
      dc.moveTo(PAD_X, y);
      dc.lineTo(W - PAD_X, y);
      dc.strokeStyle = lit ? '#7abcbc' : '#2a2a2a';
      dc.lineWidth   = lit ? (i === 0 ? 2.5 : 1.8) : 1;
      dc.lineCap = 'round';
      dc.stroke();
    }

    if (S.recencyN > NUM_LINES) {
      dc.fillStyle = '#7abcbc88';
      dc.font = `${Math.max(6, Math.round(6 * dpr) / dpr)}px 'Roboto Mono', monospace`;
      dc.textAlign = 'right';
      dc.textBaseline = 'bottom';
      dc.fillText(`+${S.recencyN - NUM_LINES}`, W - PAD_X, H - 1);
    }

    dc.restore();
  };

  S.setRecency = function(n) {
    S.recencyN = Math.max(RECENCY_MIN, Math.min(RECENCY_MAX, n));
    if (recencyValEl) recencyValEl.textContent = S.recencyN;
    S.drawRecencyDial();
  };

  if (recencyDialEl) {
    let _recDragY = null, _recDragStart = 0;
    recencyDialEl.addEventListener('mousedown', e => {
      _recDragY = e.clientY; _recDragStart = S.recencyN;
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (_recDragY === null) return;
      const dy = e.clientY - _recDragY;
      S.setRecency(Math.round(_recDragStart + dy / 6));
    });
    window.addEventListener('mouseup', () => { _recDragY = null; });
    recencyDialEl.addEventListener('wheel', e => {
      e.preventDefault(); e.stopPropagation();
      S.setRecency(S.recencyN + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });
    S.drawRecencyDial();
  }

  // ── k control in search params ────────────────────────────────────────────
  S.setSearchK = function(v) {
    const k = Math.max(1, Math.min(20, Math.round(v)));
    S.grainOverrides.k = k;
    const slider = document.getElementById('searchKSlider');
    if (slider) slider.value = k;
    const bigNum = document.getElementById('kBigNum');
    if (bigNum) bigNum.textContent = k;
  };

  const searchKSlider = document.getElementById('searchKSlider');
  if (searchKSlider) {
    searchKSlider.value = S.grainOverrides.k ?? gp().k;
    searchKSlider.addEventListener('input', () => S.setSearchK(parseInt(searchKSlider.value)));
  }

  const kBigNum = document.getElementById('kBigNum');
  if (kBigNum) {
    kBigNum.textContent = S.grainOverrides.k ?? gp().k;
    let _kDragY = null, _kDragStart = 0;
    kBigNum.addEventListener('mousedown', e => {
      _kDragY = e.clientY; _kDragStart = S.grainOverrides.k ?? gp().k;
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (_kDragY === null) return;
      const dy = _kDragY - e.clientY;
      S.setSearchK(_kDragStart + Math.round(dy / 8));
    });
    window.addEventListener('mouseup', () => { _kDragY = null; });
    kBigNum.addEventListener('wheel', e => {
      e.preventDefault();
      S.setSearchK((S.grainOverrides.k ?? gp().k) + (e.deltaY < 0 ? 1 : -1));
    }, { passive: false });
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
  let nearestSlot = -1;
  let nearestAng = Infinity;
  for (let i = 0; i < MAX_CLOUDS; i++) {
    if (!S.cloudSlots[i]) continue;
    const ang = angleBetweenSphere(S.cloudSlots[i].lon, S.cloudSlots[i].lat, lon, lat);
    if (ang < nearestAng) { nearestAng = ang; nearestSlot = i; }
  }
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
      c.shadowColor = cloud.color;
      c.shadowBlur  = 6;
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2);
      c.strokeStyle = cloud.color;
      c.lineWidth   = 1.5;
      c.stroke();
      c.shadowBlur  = 0;
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
  if (preset.direction)  S.grainDirection  = preset.direction;
  if (preset.curveType)  S.grainCurveType  = preset.curveType;
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
    const stateSpan = snapBtn.querySelector('.snap-state-text');
    if (stateSpan) stateSpan.textContent = S.nearestMode ? 'ON' : 'OFF';
  }
  drawRadiusViz();
}

export function drawRadiusViz() {
  const canvas = document.getElementById('radiusViz');
  if (!canvas) return;
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = rect.width  || 180;
  const h = rect.height || 48;
  canvas.width  = w * window.devicePixelRatio;
  canvas.height = h * window.devicePixelRatio;
  const c = canvas.getContext('2d');
  c.scale(window.devicePixelRatio, window.devicePixelRatio);
  c.clearRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;

  const radValEl = document.getElementById('radiusVal');
  if (radValEl) radValEl.textContent = `${S.searchRadiusDeg}°`;

  if (S.nearestMode) {
    const d = Math.min(w, h) * 0.36;
    c.strokeStyle = '#e8a030';
    c.lineWidth = 1.5;
    c.shadowColor = '#e8a030';
    c.shadowBlur = 6;
    c.beginPath();
    c.moveTo(cx,     cy - d);
    c.lineTo(cx + d, cy    );
    c.lineTo(cx,     cy + d);
    c.lineTo(cx - d, cy    );
    c.closePath();
    c.stroke();
    c.shadowBlur = 0;
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
    c.shadowColor = '#7abcbc';
    c.shadowBlur = S.searchRadiusDeg > 90 ? 8 : 4;
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    c.shadowBlur = 0;

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
  canvas.width  = w * window.devicePixelRatio;
  canvas.height = h * window.devicePixelRatio;
  const c = canvas.getContext('2d');
  c.scale(window.devicePixelRatio, window.devicePixelRatio);
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

  const liveFade = Math.max(0.004, Math.min(pr.fade, liveDur / 3));

  const tints = ['#7abcbc', '#6090e0', '#e07060', '#a0c060', '#c060a0', '#e0a030', '#60a0e0', '#e06060'];
  const tint  = tints[S.activePresetIndex % tints.length] || '#7abcbc';

  const count  = Math.ceil(viewSec / stride) + 2;
  const STEPS  = 40;
  const fadeW  = liveFade * pxPerSec;
  const sustW  = Math.max(0, grainW - fadeW * 2);
  const ampH   = maxAmp - PAD * 2;

  for (let i = -1; i < count; i++) {
    const jit    = Math.sin(i * 7.3) * pr.startJitter * pxPerSec;
    const xStart = i * stride * pxPerSec + jit;

    const pts = [];
    for (let s = 0; s <= STEPS; s++) {
      const t = s / STEPS;
      pts.push({ x: xStart + t * fadeW, y: baseY - PAD - atkShape(t) * ampH });
    }
    if (sustW > 0) pts.push({ x: xStart + fadeW + sustW, y: baseY - PAD - ampH });
    for (let s = 0; s <= STEPS; s++) {
      const t = s / STEPS;
      pts.push({ x: xStart + fadeW + sustW + t * fadeW, y: baseY - PAD - relShape(t) * ampH });
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

  const durStr   = Math.round(liveDur * 1000) + 'ms';
  const perStr   = Math.round(livePeriod * 1000) + 'ms';
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
  if (durEl) durEl.textContent = Math.round(pr.duration * 1000) + 'ms';
  if (kEl)   kEl.textContent   = pr.k === 0 ? 'nearest' : pr.k;
  if (panEl) panEl.textContent = Math.round(pr.panSpread * 100) + '%';
}

// ── Grain controls panel ─────────────────────────────────────────────────────
// Called once from main.js (or events.js) after DOM ready.
// Registers S.syncGrainControlsUI so selectPreset can call it.

export function initGrainControls() {
  const _LOG_MIN_MS = 0.01;
  const _LOG_MIN = Math.log(_LOG_MIN_MS), _LOG_MAX = Math.log(4000);
  const _sliderToMs = sv => Math.exp(_LOG_MIN + (parseFloat(sv) / 1000) * (_LOG_MAX - _LOG_MIN));
  const _msToSlider = ms => Math.round(((Math.log(Math.max(_LOG_MIN_MS, ms)) - _LOG_MIN) / (_LOG_MAX - _LOG_MIN)) * 1000);
  const _fmtMs = v => {
    const ms = v * 1000;
    if (ms >= 1000)  return (ms / 1000).toFixed(2) + 's';
    if (ms < 0.1)    return ms.toFixed(3) + 'ms';
    if (ms < 10)     return ms.toFixed(2) + 'ms';
    return Math.round(ms) + 'ms';
  };
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
      sliderId: 'gcPeriodSlider', numId: 'gcPeriodNum', param: 'period',
      toDisplay: _fmtMs,
      sliderToInternal: sv => Math.max(minGrainPeriodS(), _sliderToMs(sv) / 1000),
      internalToSlider: v  => _msToSlider(v * 1000),
      fromDisplay: str => { const v = _parseMs(str); return isNaN(v) ? null : Math.max(minGrainPeriodS(), Math.min(4, v)); },
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
      toDisplay: v => v.toFixed(2),
      sliderToInternal: sv => parseFloat(sv),
      internalToSlider: v => v,
      fromDisplay: str => { const v = parseFloat(str); return isNaN(v) ? null : Math.max(0, Math.min(0.5, v)); },
    },
    {
      sliderId: 'gcProbSlider', numId: 'gcProbNum', param: 'probability',
      toDisplay: v => v.toFixed(2),
      sliderToInternal: sv => parseFloat(sv),
      internalToSlider: v => v,
      fromDisplay: str => { const v = parseFloat(str); return isNaN(v) ? null : Math.max(0, Math.min(1, v)); },
    },
    {
      sliderId: 'gcPanSlider', numId: 'gcPanNum', param: 'panSpread',
      toDisplay: v => v.toFixed(2),
      sliderToInternal: sv => parseFloat(sv),
      internalToSlider: v => v,
      fromDisplay: str => { const v = parseFloat(str); return isNaN(v) ? null : Math.max(0, Math.min(1, v)); },
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
      if (param === 'period')   internalVal = Math.max(minGrainPeriodS(), internalVal);
      S.grainOverrides[param] = internalVal;
      if (param === 'volume') rebuildGrainCurves();
      if (param === 'duration' || param === 'period') drawPresetWaveform();
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

  SLIDER_DEFS.forEach(def => {
    const slider = document.getElementById(def.sliderId);
    const numbox = document.getElementById(def.numId);
    if (!slider || !numbox) return;

    slider.addEventListener('input', () => {
      const internal = def.sliderToInternal(slider.value);
      setGrainParam(def.param, internal);
      if (document.activeElement !== numbox) numbox.value = def.toDisplay(internal);
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
    const probDef = SLIDER_DEFS.find(d => d.key === 'probability');
    if (!probDef) {
      const probSlider = document.getElementById('gcProbSlider');
      const probNum    = document.getElementById('gcProbNum');
      if (probSlider) probSlider.value = Math.round(S.grainProbability * 100);
      if (probNum)    probNum.value    = S.grainProbability.toFixed(2);
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
