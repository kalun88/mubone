// ============================================================================
// UI — SAMPLE LIST, VIEWER, CROP HANDLES, UNDO, LIVE REC UI
// ============================================================================

import {
  S,
  MAX_SAMPLES, SAMPLE_PAINT_COLORS, LIVE_PAINT_COLORS, DEBUG,
  gp, perf
} from './state.js';
import { ensureAudioContext, getPreviewSinks } from './audio.js';
import { removeSeqByStrokeId, removeOverdubByStrokeId } from './ui-presets.js';
import { hotSwapSample } from './grain-worklet-bridge.js';
import { takeFromAudioBuffer } from './take.js';
import * as history from './history.js';
import { restoreTrigger } from './trigger.js';

export async function loadAudioFile(file) {
  if (S.samples.length >= MAX_SAMPLES) {
    console.warn(`Max ${MAX_SAMPLES} samples loaded`);
    return;
  }
  const actx = ensureAudioContext();
  const arrayBuffer = await file.arrayBuffer();
  const take = takeFromAudioBuffer(await actx.decodeAudioData(arrayBuffer));

  const sampleIdx = S.samples.length;
  S.samples.push({
    buffer:     take,
    name:       file.name,
    duration:   take.duration,
    grainCursor: 0,
    cropStart:  0,
    cropEnd:    1
  });
  // A running engine needs the new buffer registered or painting from it is
  // silent until restart (#247 — no-op when the worklet isn't up yet).
  hotSwapSample(take);

  rebuildSampleListUI();
  // Keep the source tiles + the open design sheet honest about the new slot —
  // a file dropped while the sampler sheet is up must appear in it (#247).
  S._renderSourceUI?.();
  DEBUG && console.log(`Loaded sample ${S.samples.length}: ${file.name} (${take.duration.toFixed(2)}s)`);
}

// ============================================================================
// UNDO — a stroke is ONE action on the history stack (js/history.js)
// ============================================================================
// Pushed when the stroke BEGINS, so it is in the stack while it is painted;
// history.undo() reaches past it while it is in progress (recording), because
// undoing the live take would have to drop and re-open the mic (~10-50 ms gap,
// an audible dip in the cursor grain stream). The action's undo removes the
// stroke's marks, its recording, the loop or cloud the gesture pinned from it,
// an overdub take's layer on its master and its trigger arming; redo brings
// every one of those back, including the pin — one gesture, one action.
export function recordStrokeStart(type, liveBufferIndex) {
  S.currentStrokeId = ++S.strokeIdCounter;
  // Freeze the brush here, at the ONE place a stroke begins. This is what makes
  // brushes frozen rather than live: every particle deposited from now until
  // the next stroke carries this id, so editing the brush afterwards changes
  // what you paint next and not what is already on the sphere. Interned, so a
  // set painted entirely in `wash` produces one voicing rather than one per
  // stroke — see brush-voicing.js. A WET brush's strokes share its one
  // voicing instead, which is what lets its knobs keep moving them.
  S.currentVoicing = S._voicingForCurrentBrush?.() ?? 0;
  const entry = {
    strokeId:        S.currentStrokeId,
    type,
    liveBufferIndex: liveBufferIndex !== undefined ? liveBufferIndex : -1
  };
  S.strokeHistory.push(entry);
  history.push(_strokeAction(entry));
}

function _strokeAction(entry) {
  let saved = null;
  return {
    kind: 'stroke',
    strokeId: entry.strokeId,
    // Still being painted and recorded: undo reaches past it.
    inProgress: () => entry.strokeId === S.currentStrokeId && S.isRecording && S.isPainting,
    undo() { saved = _undoStroke(entry); },
    redo() { if (saved) _redoStroke(entry, saved); }
  };
}

/** Take a stroke out — everything it made. Returns what redo needs. */
function _undoStroke(entry) {
  const sid = entry.strokeId;
  const hi = S.strokeHistory.indexOf(entry);
  if (hi >= 0) S.strokeHistory.splice(hi, 1);
  console.log(`[undo] sid=${sid} type=${entry.type} bufIdx=${entry.liveBufferIndex} | isRec=${S.isRecording} isPaint=${S.isPainting} | parts=${S.particles.length} bufs=${S.liveRecBuffers.length} curLiveIdx=${S.currentLiveBufferIdx} slots=${S.commitSlots.filter(Boolean).length} | traceMode=${S.traceMode}`);
  // Everything this undo is about to destroy: the particles as they stand
  // (their liveBufferIdx is rewritten on redo), the buffer slot for a live
  // stroke, the trigger's arm-time snapshot, the pins the gesture made from
  // the stroke (the looper's loop, the wash's cloud) and an overdub take's
  // layer on its master — the objects themselves, put back by redo.
  const saved = {
    particles: S.particles.filter(p => p.strokeId === sid),
    bufferSlot: null, trig: null,
    slots: S.commitSlots.filter(c => c && c.strokeId === sid),
    layers: []
  };
  for (const c of S.commitSlots) {
    if (!c?.overdubs) continue;
    for (const ov of c.overdubs) if (ov.strokeId === sid) saved.layers.push({ master: c, ov });
  }
  const trigOf = (S.triggers || []).find(t => t.strokeId === sid);
  if (trigOf) saved.trig = { color: trigOf.color, speed: trigOf.speed,
    volume: trigOf.grainParams?.volume, passes: trigOf.passes };
  // Stop and remove any loop or cloud spawned from this stroke — and, for an
  // overdub take, its layer on the master (the master stays).
  removeSeqByStrokeId(sid);
  removeOverdubByStrokeId(sid);
  // No cursor-grain flush: the next scheduler tick (≤20 ms) rebuilds the pool
  // without these particles, and grains already in flight finish their own
  // envelopes — the same tail as lifting the pen. A flush faded the whole scan.
  S.particles = S.particles.filter(p => p.strokeId !== sid);
  S._particleVersion++;
  if (entry.type === 'live' && entry.liveBufferIndex >= 0) {
    const idx = entry.liveBufferIndex;
    if (idx < S.liveRecBuffers.length) {
      saved.bufferSlot = S.liveRecBuffers[idx];
      S.liveRecBuffers.splice(idx, 1);
      // Reindex every reference above the removed slot — particles, the other
      // history entries, and a recording still running above it.
      S.particles.forEach(p => { if (p.liveBufferIdx > idx) p.liveBufferIdx--; });
      for (const h of S.strokeHistory) {
        if (h.type === 'live' && h.liveBufferIndex > idx) h.liveBufferIndex--;
      }
      if (S.currentLiveBufferIdx > idx) S.currentLiveBufferIdx--;
    }
    updateLiveRecUI();
  }
  return saved;
}

/** The inverse: the buffer first (the exact inverse of undo's splice-out),
 *  then the marks, the trigger, and the pins and layers the gesture made. */
function _redoStroke(entry, saved) {
  let bufIdx = -1;
  if (entry.type === 'live' && saved.bufferSlot) {
    bufIdx = Math.max(0, Math.min(entry.liveBufferIndex, S.liveRecBuffers.length));
    S.liveRecBuffers.splice(bufIdx, 0, saved.bufferSlot);
    S.particles.forEach(p => { if (p.liveBufferIdx >= bufIdx) p.liveBufferIdx++; });
    for (const h of S.strokeHistory) {
      if (h.type === 'live' && h.liveBufferIndex >= bufIdx) h.liveBufferIndex++;
    }
    if (S.currentLiveBufferIdx >= bufIdx) S.currentLiveBufferIdx++;
    for (const p of saved.particles) p.liveBufferIdx = bufIdx;
    updateLiveRecUI();
  }
  S.particles.push(...saved.particles);
  S._particleVersion++;
  entry.liveBufferIndex = bufIdx;
  S.strokeHistory.push(entry);
  // A trigger stroke comes back ARMED, silently — restoreTrigger primes it
  // inside like a session import, so redo makes no noise on its own.
  if (saved.trig && !(S.triggers || []).some(t => t.strokeId === entry.strokeId)) {
    restoreTrigger({ strokeId: entry.strokeId, color: saved.trig.color,
      speed: saved.trig.speed, volume: saved.trig.volume, passes: saved.trig.passes });
    S._syncTriggerUI?.();
  }
  for (const slot of saved.slots) S._restorePinSlot?.(slot);
  for (const { master, ov } of saved.layers) S._reattachOverdub?.(master, ov);
  console.log(`[redo] sid=${entry.strokeId} type=${entry.type} bufIdx=${bufIdx} | parts=${S.particles.length} bufs=${S.liveRecBuffers.length} slots=${saved.slots.length} layers=${saved.layers.length}`);
}

/** Undo the last thing the performer did — whatever kind of thing it was. */
export function undoLastStroke() {
  const a = history.undo();
  _flashUndoBtn();
  if (a) window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'undo' } }));
  S._pinsDirty = true;
  S._syncCommitUI?.();
}

export function redoLastStroke() {
  const a = history.redo();
  if (!a) return;
  window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'undo' } }));
  _flashUndoBtn();
  S._pinsDirty = true;
  S._syncCommitUI?.();
}


function _flashUndoBtn() {
  const btn = document.getElementById('undoBtn');
  if (!btn) return;
  btn.classList.add('flashing');
  setTimeout(() => btn.classList.remove('flashing'), 180);
}

export function initUndoBtn() {
  const btn = document.getElementById('undoBtn');
  btn?.addEventListener('click', () => undoLastStroke());
  // Expose for session panel (avoids circular import)
  S._undoLastStroke = undoLastStroke;
}

// ============================================================================
// SAMPLE LIST UI
// ============================================================================

export function rebuildSampleListUI() {
  teardownCropListeners();           // remove stale document-level crop handlers
  const list = document.getElementById('sampleList');
  S.waveformOverlays = [];
  // No list in the markup (the sample list left with the source panel) — the
  // eight slots below were built and dropped on every call until 2026-09-16.
  if (!list) return;
  list.innerHTML = '';

  for (let i = 0; i < MAX_SAMPLES; i++) {
    const s        = i < S.samples.length ? S.samples[i] : null;
    const isLoaded = s !== null;
    const color    = SAMPLE_PAINT_COLORS[i % SAMPLE_PAINT_COLORS.length];
    // 'painting' now marks the sampler's CURRENT slot (#247), not a live stroke
    const isCurrentSlot = (i === S.samplerIndex) && isLoaded;

    const slot = document.createElement('div');
    slot.className =
      'sample-slot' +
      (isLoaded ? ' loaded' : ' empty') +
      (isCurrentSlot ? ' painting' : '');
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

    // Slot number, not a letter: the Q–P keymap retired with #214, and this
    // is the number /sampler/sample and the sampler_sample action address.
    const key = document.createElement('span');
    key.className   = 'slot-key';
    key.textContent = String(i + 1);
    if (isCurrentSlot) key.style.color = color;

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

  // samplerIndex is never -1 (#247): deleting the current slot clamps to 0
  if (S.samplerIndex === index)          S.samplerIndex = 0;
  else if (S.samplerIndex > index)       S.samplerIndex--;

  rebuildSampleListUI();
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

  if (S.samplerIndex === fromIdx)          S.samplerIndex = targetIdx;
  else if (fromIdx < targetIdx) {
    if (S.samplerIndex > fromIdx && S.samplerIndex <= targetIdx) S.samplerIndex--;
  } else {
    if (S.samplerIndex >= targetIdx && S.samplerIndex < fromIdx) S.samplerIndex++;
  }

  rebuildSampleListUI();
}

// ── Live rec UI ──────────────────────────────────────────────────────────────

function updateLiveRecUI() {
  const bufCount = S.liveRecBuffers.filter(b => b.buffer !== null).length;
  const countEl = document.getElementById('liveRecCount');
  if (countEl) countEl.textContent = bufCount;

  // Compute total recorded duration across all live buffers
  let totalSec = 0;
  for (let i = 0; i < S.liveRecBuffers.length; i++) {
    const buf = S.liveRecBuffers[i].buffer;
    if (buf) totalSec += buf.duration;
  }
  perf.recTotalSec = totalSec;

  // Memory guard — flag when past 80% of limit
  const pct = totalSec / S.recLimitSeconds;
  perf.recWarning = pct >= 0.80;

  // HUD: "buffers: 3 · 2m14s" (or "buffers: 3 · 2m14s !" when warning)
  const vmBuffers = document.getElementById('vmBuffers');
  if (vmBuffers) {
    const mins = Math.floor(totalSec / 60);
    const secs = Math.floor(totalSec % 60);
    const timeStr = mins > 0
      ? `${mins}m${secs < 10 ? '0' : ''}${secs}s`
      : `${secs}s`;
    const warn = pct >= 0.95 ? ' !!' : pct >= 0.80 ? ' !' : '';
    vmBuffers.textContent = bufCount > 0
      ? `buffers: ${bufCount} · ${timeStr}${warn}`
      : `buffers: 0`;
    vmBuffers.style.color = pct >= 0.95 ? '#e06060'
                          : pct >= 0.80 ? '#e8a030'
                          : '';
  }
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
  const data = buffer.data;
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

// AbortController for document-level crop listeners — aborted on each rebuild
// so old listeners don't accumulate.
let _cropAbort = null;

export function teardownCropListeners() {
  if (_cropAbort) { _cropAbort.abort(); _cropAbort = null; }
}

export function setupCropInteraction(waveDiv, cropCanvas, slotIdx) {
  // Lazily create a shared AbortController for this rebuild cycle.
  // All crop slots share one controller; teardownCropListeners() kills them all.
  if (!_cropAbort) _cropAbort = new AbortController();
  const signal = _cropAbort.signal;

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
  }, { signal });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = null;
    document.body.style.cursor = '';
    waveDiv.classList.remove('near-handle');
    const s = S.samples[slotIdx];
    if (s) s.grainCursor = s.cropStart * s.duration;
  }, { signal });
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
  for (const sink of getPreviewSinks()) gain.connect(sink);
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
  // Reset every surface's play button for this slot — the modal row and the
  // sampler design sheet (#247). onended can't do it: the preview entry is
  // already deleted, so its identity guard misses on an explicit stop.
  for (const sel of [`.sample-slot[data-index="${slotIdx}"] .slot-play`,
                     `[data-src-play="${slotIdx}"]`]) {
    const btn = document.querySelector(sel);
    if (btn) { btn.textContent = '▶'; btn.classList.remove('playing'); }
  }
}

// ── Waveform playhead overlay ─────────────────────────────────────────────────

function updateWaveformPlayheads() {
  const now = performance.now();
  // In-place compaction — avoids creating a new array every frame
  let writeIdx = 0;
  for (let i = 0; i < S.activeGrains.length; i++) {
    if (now < S.activeGrains[i].startTime + S.activeGrains[i].totalDuration * 1000) {
      S.activeGrains[writeIdx++] = S.activeGrains[i];
    }
  }
  S.activeGrains.length = writeIdx;

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
S.updateWaveformPlayheads      = updateWaveformPlayheads;
