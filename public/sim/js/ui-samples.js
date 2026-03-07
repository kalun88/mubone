// ============================================================================
// UI — SAMPLE LIST, VIEWER, CROP HANDLES, UNDO, LIVE REC UI
// ============================================================================

import {
  S,
  MAX_SAMPLES, SAMPLE_PAINT_COLORS, LIVE_PAINT_COLORS,
  gp,
} from './state.js';
import { ensureAudioContext, getMasterBus } from './audio.js';

// ── Sample Viewer (large waveform display) ────────────────────────────────────
let svActiveTab = -1;   // which tab is showing (-1 = none / live placeholder)

export async function loadAudioFile(file) {
  if (S.samples.length >= MAX_SAMPLES) {
    console.warn('Max 9 samples loaded');
    return;
  }
  const actx = ensureAudioContext();
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await actx.decodeAudioData(arrayBuffer);

  const sampleIdx = S.samples.length;
  S.samples.push({
    buffer:     audioBuffer,
    name:       file.name,
    duration:   audioBuffer.duration,
    grainCursor: 0,
    cropStart:  0,
    cropEnd:    1
  });

  if (svActiveTab < 0) svActiveTab = sampleIdx;
  rebuildSampleListUI();
  requestAnimationFrame(drawSvWaveform);
  console.log(`Loaded sample ${S.samples.length}: ${file.name} (${audioBuffer.duration.toFixed(2)}s)`);
}

export function buildSvTabs() {
  const tabsEl = document.getElementById('svTabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = '';
  for (let i = 0; i < MAX_SAMPLES; i++) {
    const tab = document.createElement('div');
    tab.className = 'sv-tab';
    tab.dataset.index = i;
    tab.textContent = i + 1;
    const color = SAMPLE_PAINT_COLORS[i % SAMPLE_PAINT_COLORS.length];
    tab.style.setProperty('--tab-color', color);
    if (i < S.samples.length) tab.classList.add('loaded');
    if (i === S.activeSampleIndex) tab.classList.add('painting');
    if (i === svActiveTab) tab.classList.add('active-tab');
    tab.addEventListener('click', () => switchSvTab(i));
    tabsEl.appendChild(tab);
  }
}

export function updateSvTabStates() {
  const tabsEl = document.getElementById('svTabs');
  if (!tabsEl) return;
  tabsEl.querySelectorAll('.sv-tab').forEach(tab => {
    const i = parseInt(tab.dataset.index);
    tab.classList.toggle('loaded',      i < S.samples.length);
    tab.classList.toggle('painting',    i === S.activeSampleIndex);
    tab.classList.toggle('active-tab',  i === svActiveTab);
  });
}

export function switchSvTab(idx) {
  svActiveTab = idx;
  updateSvTabStates();
  drawSvWaveform();
  setupSvCropInteraction();
}

export function drawSvWaveform() {
  const wc      = document.getElementById('svWaveform');
  const cropC   = document.getElementById('svCrop');
  const infoEl  = document.getElementById('svInfo');
  if (!wc) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = wc.parentElement.getBoundingClientRect();
  if (rect.width === 0) return;
  const W = rect.width, H = rect.height;
  wc.width     = W * dpr; wc.height     = H * dpr;
  cropC.width  = W * dpr; cropC.height  = H * dpr;

  const ctx = wc.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const s = svActiveTab >= 0 && svActiveTab < S.samples.length ? S.samples[svActiveTab] : null;

  if (!s) {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#555';
    ctx.font = '0.6rem "Roboto Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(svActiveTab >= 0 ? `slot ${svActiveTab + 1} — drop audio here` : 'no sample loaded', W/2, H/2);
    if (infoEl) infoEl.textContent = '';
    drawSvCrop();
    return;
  }

  const data = s.buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / (W * dpr)));
  const mid  = H / 2;
  ctx.strokeStyle = '#7abcbc';
  ctx.lineWidth   = 1.5 / dpr;
  ctx.beginPath();
  for (let i = 0; i < W * dpr; i++) {
    const idx = i * step;
    let mn = 0, mx = 0;
    for (let j = 0; j < step && idx + j < data.length; j++) {
      const v = data[idx + j]; if (v < mn) mn = v; if (v > mx) mx = v;
    }
    const x = i / dpr;
    ctx.moveTo(x, mid + mn * mid * 0.9);
    ctx.lineTo(x, mid + mx * mid * 0.9);
  }
  ctx.stroke();

  if (infoEl) {
    const cropDur = ((s.cropEnd - s.cropStart) * s.duration).toFixed(2);
    infoEl.textContent = `${s.name}   ${cropDur}s / ${s.duration.toFixed(2)}s`;
  }

  drawSvCrop();
}

function drawSvCrop() {
  const cropC = document.getElementById('svCrop');
  if (!cropC) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cropC.width / dpr, H = cropC.height / dpr;
  const cctx = cropC.getContext('2d');
  cctx.clearRect(0, 0, cropC.width, cropC.height);

  const s = svActiveTab >= 0 && svActiveTab < S.samples.length ? S.samples[svActiveTab] : null;
  if (!s) return;

  const xS = s.cropStart * W * dpr;
  const xE = s.cropEnd   * W * dpr;

  cctx.fillStyle = 'rgba(0,0,0,0.55)';
  if (xS > 0)         cctx.fillRect(0,   0, xS,             cropC.height);
  if (xE < W * dpr)   cctx.fillRect(xE,  0, W * dpr - xE,  cropC.height);

  const hw = 8;
  cctx.fillStyle = '#e0c860';
  cctx.fillRect(xS - hw/2, 0, hw, cropC.height);
  cctx.fillRect(xE - hw/2, 0, hw, cropC.height);

  cctx.fillStyle = 'rgba(224,200,96,0.5)';
  cctx.fillRect(xS, 0, xE - xS, 2 * dpr);
  cctx.fillRect(xS, cropC.height - 2 * dpr, xE - xS, 2 * dpr);
}

export function setupSvCropInteraction() {
  const display = document.getElementById('svDisplay');
  if (!display) return;

  const fresh = display.cloneNode(true);
  display.parentNode.replaceChild(fresh, display);

  const wc     = fresh.querySelector('#svWaveform');
  const cropC  = fresh.querySelector('#svCrop');

  if (!wc || !cropC) return;

  let dragging = null;
  const HANDLE_HIT = 10;

  function getHit(e) {
    const rect = fresh.getBoundingClientRect();
    const x    = e.clientX - rect.left;
    const W    = rect.width;
    const s    = svActiveTab >= 0 ? S.samples[svActiveTab] : null;
    if (!s) return null;
    if (Math.abs(x - s.cropStart * W) <= HANDLE_HIT) return 'start';
    if (Math.abs(x - s.cropEnd   * W) <= HANDLE_HIT) return 'end';
    return null;
  }

  fresh.addEventListener('mousemove', e => {
    if (dragging) return;
    const hit = getHit(e);
    fresh.style.cursor = hit ? 'col-resize' : '';
  });
  fresh.addEventListener('mouseleave', () => { if (!dragging) fresh.style.cursor = ''; });

  fresh.addEventListener('mousedown', e => {
    const hit = getHit(e);
    if (!hit) return;
    e.preventDefault();
    dragging = hit;
    document.body.style.cursor = 'col-resize';
  });

  document.addEventListener('mousemove', function svMove(e) {
    if (!dragging) return;
    const rect = fresh.getBoundingClientRect();
    const x    = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const norm = x / rect.width;
    const s    = svActiveTab >= 0 ? S.samples[svActiveTab] : null;
    if (!s) return;
    const minSpan = 0.01;
    if (dragging === 'start') s.cropStart = Math.max(0, Math.min(norm, s.cropEnd   - minSpan));
    else                      s.cropEnd   = Math.min(1, Math.max(norm, s.cropStart + minSpan));
    // Use the cloned fresh element's crop canvas
    const freshCropC = fresh.querySelector('#svCrop');
    if (freshCropC) {
      // Redraw crop overlay on the cloned canvas
      const dpr = window.devicePixelRatio || 1;
      const W = freshCropC.width / dpr, H = freshCropC.height / dpr;
      const cctx = freshCropC.getContext('2d');
      cctx.clearRect(0, 0, freshCropC.width, freshCropC.height);
      const xS = s.cropStart * W * dpr;
      const xE = s.cropEnd   * W * dpr;
      cctx.fillStyle = 'rgba(0,0,0,0.55)';
      if (xS > 0)         cctx.fillRect(0,   0, xS,                    freshCropC.height);
      if (xE < W * dpr)   cctx.fillRect(xE,  0, W * dpr - xE,          freshCropC.height);
      const hw = 8;
      cctx.fillStyle = '#e0c860';
      cctx.fillRect(xS - hw/2, 0, hw, freshCropC.height);
      cctx.fillRect(xE - hw/2, 0, hw, freshCropC.height);
      cctx.fillStyle = 'rgba(224,200,96,0.5)';
      cctx.fillRect(xS, 0, xE - xS, 2 * dpr);
      cctx.fillRect(xS, freshCropC.height - 2 * dpr, xE - xS, 2 * dpr);
    }
    const infoEl = fresh.querySelector('#svInfo');
    if (infoEl && s) {
      const cropDur = ((s.cropEnd - s.cropStart) * s.duration).toFixed(2);
      infoEl.textContent = `${s.name}   ${cropDur}s / ${s.duration.toFixed(2)}s`;
    }
    drawCropOverlay(svActiveTab);
  });

  document.addEventListener('mouseup', function svUp() {
    if (!dragging) return;
    dragging = null;
    document.body.style.cursor = '';
    const s = svActiveTab >= 0 ? S.samples[svActiveTab] : null;
    if (s) s.grainCursor = s.cropStart * s.duration;
  });
}

// Draw live grain position overlay on svOverlay (called from render loop via S)
function drawSvLiveOverlay() {
  const ovC = document.getElementById('svOverlay');
  if (!ovC) return;
  const dpr = window.devicePixelRatio || 1;
  const W   = ovC.parentElement.clientWidth;
  const H   = ovC.parentElement.clientHeight;
  if (!W || !H) return;
  if (ovC.width !== W * dpr)  ovC.width  = W * dpr;
  if (ovC.height !== H * dpr) ovC.height = H * dpr;

  const oct = ovC.getContext('2d');
  oct.clearRect(0, 0, ovC.width, ovC.height);

  const s = svActiveTab >= 0 && svActiveTab < S.samples.length ? S.samples[svActiveTab] : null;
  if (!s || !s.buffer) return;

  const dur  = s.buffer.duration;
  const norm = s.grainCursor / dur;

  const px = norm * W * dpr;
  oct.strokeStyle = '#cc3333';
  oct.lineWidth   = 1.5;
  oct.beginPath();
  oct.moveTo(px, 0);
  oct.lineTo(px, ovC.height);
  oct.stroke();
}

export function updateSamplePaintIndicator() { updatePaintIndicator(); }
export function updatePaintIndicator() {
  const indicator = document.getElementById('sampleIndicator');
  if (!indicator) return;
  if (S.isRecording) {
    const color = LIVE_PAINT_COLORS[S.liveColorIndex % LIVE_PAINT_COLORS.length];
    indicator.textContent = '● live';
    indicator.style.color = color;
  } else if (S.activeSampleIndex >= 0 && S.activeSampleIndex < S.samples.length) {
    const s     = S.samples[S.activeSampleIndex];
    const color = SAMPLE_PAINT_COLORS[S.activeSampleIndex % SAMPLE_PAINT_COLORS.length];
    indicator.textContent = `[${S.activeSampleIndex + 1}] ${s.name.slice(0, 18)}`;
    indicator.style.color = color;
  } else {
    indicator.textContent = '—';
    indicator.style.color = '#333';
  }
}

// ============================================================================
// UNDO SYSTEM
// ============================================================================

export function recordStrokeStart(type, liveBufferIndex) {
  S.currentStrokeId = ++S.strokeIdCounter;
  S.strokeHistory.push({
    strokeId:        S.currentStrokeId,
    type,
    liveBufferIndex: liveBufferIndex !== undefined ? liveBufferIndex : -1
  });
}

export function undoLastStroke() {
  if (S.strokeHistory.length === 0) return;
  const entry = S.strokeHistory.pop();
  const sid   = entry.strokeId;

  S.particles = S.particles.filter(p => p.strokeId !== sid);

  if (entry.type === 'live' && entry.liveBufferIndex >= 0) {
    const idx = entry.liveBufferIndex;
    if (idx < S.liveRecBuffers.length) {
      S.liveRecBuffers.splice(idx, 1);
      S.particles.forEach(p => {
        if (p.liveBufferIdx > idx) p.liveBufferIdx--;
      });
    }
    updateLiveRecUI();
  }
}

// ============================================================================
// SAMPLE LIST UI
// ============================================================================

export function rebuildSampleListUI() {
  const list = document.getElementById('sampleList');
  if (list) list.innerHTML = '';
  S.waveformOverlays = [];

  for (let i = 0; i < MAX_SAMPLES; i++) {
    const s        = i < S.samples.length ? S.samples[i] : null;
    const isLoaded = s !== null;
    const color    = SAMPLE_PAINT_COLORS[i % SAMPLE_PAINT_COLORS.length];
    const isPaintingSlot = (i === S.activeSampleIndex) && isLoaded;

    const slot = document.createElement('div');
    slot.className =
      'sample-slot' +
      (isLoaded ? ' loaded' : ' empty') +
      (isPaintingSlot ? ' painting' : '');
    slot.dataset.index = i;
    slot.style.setProperty('--slot-color', color);

    const handle = document.createElement('span');
    handle.className  = 'slot-drag-handle';
    handle.textContent = '☰';
    handle.draggable  = isLoaded;
    if (isLoaded) {
      handle.addEventListener('dragstart', e => {
        S.dragSrcIndex = i;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
        slot.style.opacity = '0.4';
      });
      handle.addEventListener('dragend', () => {
        slot.style.opacity = '';
        S.dragSrcIndex = -1;
        if (list) list.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      });
    }

    slot.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; slot.classList.add('drag-over'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', e => {
      e.preventDefault();
      slot.classList.remove('drag-over');
      const fromIdx = S.dragSrcIndex;
      if (fromIdx >= 0 && fromIdx !== i && fromIdx < S.samples.length) reorderSample(fromIdx, i);
    });

    const key = document.createElement('span');
    key.className   = 'slot-key';
    key.textContent = i + 1;
    if (isPaintingSlot) key.style.color = color;

    const name = document.createElement('span');
    name.className  = 'slot-name';
    name.textContent = isLoaded
      ? (s.name.length > 24 ? s.name.slice(0, 22) + '…' : s.name)
      : (i === S.samples.length ? 'drop to load…' : '—');

    const dur = document.createElement('span');
    dur.className   = 'slot-duration';
    dur.textContent = isLoaded ? ((s.cropEnd - s.cropStart) * s.duration).toFixed(1) + 's' : '';

    const playBtn = document.createElement('button');
    playBtn.className = 'slot-play';
    playBtn.textContent = '▶';
    playBtn.title       = 'Preview sample';
    if (isLoaded) {
      playBtn.addEventListener('click', e => { e.stopPropagation(); toggleSamplePreview(i, playBtn); });
      if (S.samplePreviews[i]) { playBtn.textContent = '■'; playBtn.classList.add('playing'); }
    }

    const waveDiv   = document.createElement('div');
    waveDiv.className = 'slot-waveform';
    const wc         = document.createElement('canvas');
    const cropCanvas = document.createElement('canvas');
    const overlay    = document.createElement('canvas');
    overlay.className = 'slot-waveform-overlay';
    waveDiv.appendChild(wc);
    waveDiv.appendChild(cropCanvas);
    waveDiv.appendChild(overlay);
    S.waveformOverlays[i] = isLoaded
      ? { canvas: overlay, cropCanvas, duration: s.duration, sampleIndex: i }
      : null;

    if (isLoaded) setupCropInteraction(waveDiv, cropCanvas, i);

    const del = document.createElement('button');
    del.className   = 'slot-delete';
    del.textContent = '×';
    del.title       = 'Remove sample';
    if (isLoaded) {
      del.addEventListener('click', e => { e.stopPropagation(); deleteSample(i); });
    }

    slot.appendChild(handle);
    slot.appendChild(key);
    slot.appendChild(name);
    slot.appendChild(dur);
    slot.appendChild(playBtn);
    slot.appendChild(waveDiv);
    slot.appendChild(del);
    if (list) list.appendChild(slot);

    if (isLoaded) {
      const slotIdx = i;
      requestAnimationFrame(() => {
        drawSlotWaveform(wc, s.buffer);
        const rect = overlay.parentElement.getBoundingClientRect();
        if (rect.width > 0) {
          overlay.width    = rect.width * 2;
          overlay.height   = rect.height * 2;
          cropCanvas.width = rect.width * 2;
          cropCanvas.height = rect.height * 2;
          drawCropOverlay(slotIdx);
        }
      });
    }
  }
  buildSvTabs();
  if (svActiveTab < 0 && S.samples.length > 0) svActiveTab = 0;
  if (svActiveTab >= S.samples.length) svActiveTab = S.samples.length - 1;
  drawSvWaveform();
  setupSvCropInteraction();
}

export function updateSampleListActiveState() {
  document.querySelectorAll('.sample-slot').forEach(slot => {
    const idx   = parseInt(slot.dataset.index);
    const color = SAMPLE_PAINT_COLORS[idx % SAMPLE_PAINT_COLORS.length];
    slot.classList.toggle('painting', idx === S.activeSampleIndex);
    const keyEl = slot.querySelector('.slot-key');
    if (keyEl) keyEl.style.color = (idx === S.activeSampleIndex) ? color : '';
  });
}

export function deleteSample(index) {
  if (index < 0 || index >= S.samples.length) return;
  stopSamplePreview(index);
  S.samples.splice(index, 1);

  S.particles.forEach(p => {
    if (p.source !== 'sample' || p.sampleIndex == null) return;
    if (p.sampleIndex === index)       p.sampleIndex = -1;
    else if (p.sampleIndex > index)    p.sampleIndex--;
  });

  if (S.activeSampleIndex === index)          S.activeSampleIndex = -1;
  else if (S.activeSampleIndex > index)       S.activeSampleIndex--;

  rebuildSampleListUI();
  updateSamplePaintIndicator();
}

export function reorderSample(fromIdx, toIdx) {
  const targetIdx = Math.min(toIdx, S.samples.length - 1);
  if (fromIdx === targetIdx || fromIdx < 0 || fromIdx >= S.samples.length) return;

  const [moved] = S.samples.splice(fromIdx, 1);
  S.samples.splice(targetIdx, 0, moved);

  S.particles.forEach(p => {
    if (p.source !== 'sample' || p.sampleIndex == null) return;
    if (p.sampleIndex === fromIdx) {
      p.sampleIndex = targetIdx;
    } else if (fromIdx < targetIdx) {
      if (p.sampleIndex > fromIdx && p.sampleIndex <= targetIdx) p.sampleIndex--;
    } else {
      if (p.sampleIndex >= targetIdx && p.sampleIndex < fromIdx)  p.sampleIndex++;
    }
  });

  if (S.activeSampleIndex === fromIdx)          S.activeSampleIndex = targetIdx;
  else if (fromIdx < targetIdx) {
    if (S.activeSampleIndex > fromIdx && S.activeSampleIndex <= targetIdx) S.activeSampleIndex--;
  } else {
    if (S.activeSampleIndex >= targetIdx && S.activeSampleIndex < fromIdx) S.activeSampleIndex++;
  }

  rebuildSampleListUI();
  updateSamplePaintIndicator();
}

// ── Live rec UI ──────────────────────────────────────────────────────────────

function updateLiveGranulatingIndicator() {
  const el = document.getElementById('liveGranulating');
  if (el) {
    if (S.liveGranulatingThisFrame) el.classList.add('active');
    else el.classList.remove('active');
  }
  const dot = document.getElementById('vmDot');
  if (dot) {
    if (S.liveGranulatingThisFrame) dot.classList.add('active');
    else dot.classList.remove('active');
  }
}

function updateLiveRecUI() {
  const bufCount = S.liveRecBuffers.filter(b => b.buffer !== null).length;
  const countEl = document.getElementById('liveRecCount');
  if (countEl) countEl.textContent = bufCount;
  const vmBuffers = document.getElementById('vmBuffers');
  if (vmBuffers) vmBuffers.textContent = `buf: ${bufCount}`;
  updatePaintIndicator();
}

// ============================================================================
// WAVEFORM DRAWING — loaded samples
// ============================================================================

export function drawSlotWaveform(wc, buffer) {
  const rect = wc.parentElement.getBoundingClientRect();
  if (rect.width === 0) return;
  wc.width  = rect.width * 2;
  wc.height = rect.height * 2;
  const wctx = wc.getContext('2d');
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / wc.width));
  const mid  = wc.height / 2;
  wctx.clearRect(0, 0, wc.width, wc.height);
  wctx.strokeStyle = '#7abcbc';
  wctx.lineWidth   = 1;
  wctx.beginPath();
  for (let i = 0; i < wc.width; i++) {
    const idx = i * step;
    let min = 0, max = 0;
    for (let j = 0; j < step && idx + j < data.length; j++) {
      const v = data[idx + j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    wctx.moveTo(i, mid + min * mid);
    wctx.lineTo(i, mid + max * mid);
  }
  wctx.stroke();
}

const CROP_HANDLE_W = 6;

export function drawCropOverlay(slotIdx) {
  const ov = S.waveformOverlays[slotIdx];
  if (!ov || !ov.cropCanvas) return;
  const s = S.samples[slotIdx];
  if (!s) return;

  const cc   = ov.cropCanvas;
  const cctx = cc.getContext('2d');
  const w    = cc.width;
  const h    = cc.height;
  cctx.clearRect(0, 0, w, h);

  const xStart = s.cropStart * w;
  const xEnd   = s.cropEnd   * w;

  cctx.fillStyle = 'rgba(0,0,0,0.55)';
  if (xStart > 0)  cctx.fillRect(0,     0, xStart,     h);
  if (xEnd   < w)  cctx.fillRect(xEnd,  0, w - xEnd,   h);

  const hw = CROP_HANDLE_W * 2;
  cctx.fillStyle = '#e0c860';
  cctx.fillRect(xStart - hw / 2, 0, hw, h);
  cctx.fillRect(xEnd   - hw / 2, 0, hw, h);

  cctx.fillStyle = 'rgba(224,200,96,0.4)';
  cctx.fillRect(xStart, 0,     xEnd - xStart, 2);
  cctx.fillRect(xStart, h - 2, xEnd - xStart, 2);
}

export function setupCropInteraction(waveDiv, cropCanvas, slotIdx) {
  let dragging = null;
  const HANDLE_HIT = 8;

  function getHandleHit(e) {
    const rect = waveDiv.getBoundingClientRect();
    const x    = e.clientX - rect.left;
    const w    = rect.width;
    const s    = S.samples[slotIdx];
    if (!s) return null;
    if (Math.abs(x - s.cropStart * w) <= HANDLE_HIT) return 'start';
    if (Math.abs(x - s.cropEnd   * w) <= HANDLE_HIT) return 'end';
    return null;
  }

  waveDiv.addEventListener('mousemove', e => {
    if (dragging) return;
    waveDiv.classList.toggle('near-handle', !!getHandleHit(e));
  });
  waveDiv.addEventListener('mouseleave', () => {
    if (!dragging) waveDiv.classList.remove('near-handle');
  });

  waveDiv.addEventListener('mousedown', e => {
    const hit = getHandleHit(e);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = hit;
    document.body.style.cursor = 'col-resize';
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const rect = waveDiv.getBoundingClientRect();
    const x    = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const norm = x / rect.width;
    const s    = S.samples[slotIdx];
    if (!s) return;
    const minSpan = 0.02;
    if (dragging === 'start') s.cropStart = Math.max(0, Math.min(norm, s.cropEnd   - minSpan));
    else                      s.cropEnd   = Math.min(1, Math.max(norm, s.cropStart + minSpan));
    drawCropOverlay(slotIdx);
    updateCropDuration(slotIdx);
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = null;
    document.body.style.cursor = '';
    waveDiv.classList.remove('near-handle');
    const s = S.samples[slotIdx];
    if (s) s.grainCursor = s.cropStart * s.duration;
  });
}

export function updateCropDuration(slotIdx) {
  const s    = S.samples[slotIdx];
  if (!s)    return;
  const slot = document.querySelector(`.sample-slot[data-index="${slotIdx}"] .slot-duration`);
  if (slot)  slot.textContent = ((s.cropEnd - s.cropStart) * s.duration).toFixed(1) + 's';
}

// ── Sample preview playback ──────────────────────────────────────────────────

export function toggleSamplePreview(slotIdx, btn) {
  if (S.samplePreviews[slotIdx]) { stopSamplePreview(slotIdx); return; }
  const s = S.samples[slotIdx];
  if (!s || !s.buffer) return;

  const actx     = ensureAudioContext();
  const startSec = s.cropStart * s.duration;
  const endSec   = s.cropEnd   * s.duration;
  const dur      = endSec - startSec;

  const source = actx.createBufferSource();
  source.buffer = s.buffer;
  const gain = actx.createGain();
  gain.gain.value = gp().volume;
  source.connect(gain);
  gain.connect(getMasterBus());
  source.start(actx.currentTime, startSec, dur);

  const preview = { source, gain, startTimePerfNow: performance.now(), startSec, duration: dur, slotIdx };
  S.samplePreviews[slotIdx] = preview;

  S.activeGrains.push({
    sampleIndex:   slotIdx,
    grainStart:    startSec,
    grainDuration: dur,
    startTime:     performance.now(),
    totalDuration: dur
  });

  btn.textContent = '■';
  btn.classList.add('playing');

  source.onended = () => {
    if (S.samplePreviews[slotIdx] === preview) {
      delete S.samplePreviews[slotIdx];
      btn.textContent = '▶';
      btn.classList.remove('playing');
    }
  };
}

export function stopSamplePreview(slotIdx) {
  const preview = S.samplePreviews[slotIdx];
  if (!preview) return;
  try { preview.source.stop(); } catch (e) {}
  delete S.samplePreviews[slotIdx];
  const btn = document.querySelector(`.sample-slot[data-index="${slotIdx}"] .slot-play`);
  if (btn) { btn.textContent = '▶'; btn.classList.remove('playing'); }
}

// ── Waveform playhead overlay ─────────────────────────────────────────────────

function updateWaveformPlayheads() {
  const now = performance.now();
  S.activeGrains = S.activeGrains.filter(g => now < g.startTime + g.totalDuration * 1000);

  const grainsBySample = {};
  for (const g of S.activeGrains) {
    if (!grainsBySample[g.sampleIndex]) grainsBySample[g.sampleIndex] = [];
    grainsBySample[g.sampleIndex].push(g);
  }

  for (let i = 0; i < MAX_SAMPLES; i++) {
    const ov = S.waveformOverlays[i];
    if (!ov || !ov.canvas || ov.canvas.width === 0) continue;
    const octx   = ov.canvas.getContext('2d');
    const w      = ov.canvas.width;
    const h      = ov.canvas.height;
    octx.clearRect(0, 0, w, h);

    const grains = grainsBySample[i];
    if (!grains || grains.length === 0) continue;
    const sampleDur = (i < S.samples.length && S.samples[i].duration > 0) ? S.samples[i].duration : ov.duration;
    if (sampleDur <= 0) continue;

    for (const g of grains) {
      const elapsed    = (now - g.startTime) / 1000;
      const currentPos = g.grainStart + elapsed;
      const xPos       = (currentPos / sampleDur) * w;
      const xStart     = (g.grainStart / sampleDur) * w;
      const xWidth     = Math.max(2, (g.grainDuration / sampleDur) * w);

      const fade = Math.min(gp().fade, g.totalDuration / 3);
      let alpha  = 1;
      if (elapsed < fade)                         alpha = elapsed / fade;
      else if (elapsed > g.totalDuration - fade)  alpha = (g.totalDuration - elapsed) / fade;
      alpha = Math.max(0, Math.min(1, alpha));

      octx.fillStyle   = `rgba(255,220,80,${0.12 * alpha})`;
      octx.fillRect(xStart, 0, xWidth, h);
      octx.strokeStyle = `rgba(255,200,50,${0.4 * alpha})`;
      octx.lineWidth   = 5;
      octx.beginPath(); octx.moveTo(xPos, 0); octx.lineTo(xPos, h); octx.stroke();
      octx.strokeStyle = `rgba(255,230,80,${0.95 * alpha})`;
      octx.lineWidth   = 2;
      octx.beginPath(); octx.moveTo(xPos, 0); octx.lineTo(xPos, h); octx.stroke();
    }
  }
}

// ── Register late-bound callbacks on S so renderer/audio can call them ────────
S.updateLiveRecUI              = updateLiveRecUI;
S.drawSvLiveOverlay            = drawSvLiveOverlay;
S.updateLiveGranulatingIndicator = updateLiveGranulatingIndicator;
S.updateWaveformPlayheads      = updateWaveformPlayheads;
