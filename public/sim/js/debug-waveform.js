// ============================================================================
// DEBUG WAVEFORM VIEWER — overlay showing recorded buffer + particle markers
// Usage: from console, call  showWaveform()  (exposed on window by main.js)
//        or import { showWaveformOverlay } from './debug-waveform.js'
// ============================================================================

import { S } from './state.js';

let _overlay = null;

export function showWaveformOverlay(bufIdx) {
  // Find the buffer
  if (bufIdx === undefined) {
    // Default: most recent live buffer with data
    for (let i = (S.liveRecBuffers?.length ?? 0) - 1; i >= 0; i--) {
      if (S.liveRecBuffers[i]?.buffer) { bufIdx = i; break; }
    }
  }
  const slot = S.liveRecBuffers?.[bufIdx];
  const buf = slot?.buffer;
  if (!buf) { console.warn('[waveform] no buffer found at index', bufIdx); return; }

  const ch = buf.getChannelData(0);
  const sr = buf.sampleRate;
  const dur = buf.duration;

  // Get particles for this buffer
  const particles = S.particles.filter(p => p.liveBufferIdx === bufIdx);
  particles.sort((a, b) => a.grainStart - b.grainStart);

  // Create or reuse overlay
  if (_overlay) _overlay.remove();
  _overlay = document.createElement('div');
  _overlay.id = 'debug-waveform-overlay';
  _overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.92); z-index: 99999; display: flex;
    flex-direction: column; font-family: monospace; color: #ccc;
  `;

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'padding: 10px 16px; font-size: 13px; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center;';
  header.innerHTML = `
    <span>Buffer ${bufIdx} — ${dur.toFixed(3)}s — ${particles.length} particles — sr=${sr}</span>
    <span style="cursor:pointer; font-size: 18px; padding: 4px 8px;" id="dbg-wf-close">✕</span>
  `;
  _overlay.appendChild(header);

  // Info bar
  const info = document.createElement('div');
  info.id = 'dbg-wf-info';
  info.style.cssText = 'padding: 2px 16px 6px; font-size: 12px; color: #888; flex-shrink: 0; height: 16px;';
  _overlay.appendChild(info);

  // Canvas container
  const container = document.createElement('div');
  container.style.cssText = 'flex: 1; padding: 0 16px 16px; min-height: 0;';
  _overlay.appendChild(container);

  const canvas = document.createElement('canvas');
  container.appendChild(canvas);

  document.body.appendChild(_overlay);

  // Size canvas
  const rect = container.getBoundingClientRect();
  const W = Math.floor(rect.width);
  const H = Math.floor(rect.height);
  canvas.width = W;
  canvas.height = H;
  canvas.style.cssText = 'width: 100%; height: 100%; cursor: crosshair;';

  const ctx = canvas.getContext('2d');
  const waveH = H * 0.55;  // top portion for waveform
  const markerY = waveH + 20;
  const markerH = H - markerY - 30;

  // ── Draw waveform ──────────────────────────────────────────────────
  // Downsample: for each pixel column, find min/max sample
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, W, H);

  const samplesPerPx = ch.length / W;
  const waveMid = waveH / 2;

  // Waveform fill
  ctx.beginPath();
  for (let x = 0; x < W; x++) {
    const s0 = Math.floor(x * samplesPerPx);
    const s1 = Math.min(Math.floor((x + 1) * samplesPerPx), ch.length);
    let mn = 0, mx = 0;
    for (let s = s0; s < s1; s++) {
      if (ch[s] < mn) mn = ch[s];
      if (ch[s] > mx) mx = ch[s];
    }
    const yTop = waveMid - mx * waveMid;
    const yBot = waveMid - mn * waveMid;
    ctx.moveTo(x, yTop);
    ctx.lineTo(x, yBot);
  }
  ctx.strokeStyle = '#4a9';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Zero line
  ctx.strokeStyle = '#333';
  ctx.beginPath();
  ctx.moveTo(0, waveMid);
  ctx.lineTo(W, waveMid);
  ctx.stroke();

  // ── Draw particle markers ──────────────────────────────────────────
  // Find max RMS for normalization
  const maxRms = Math.max(...particles.map(p => p.rms || 0), 0.001);

  particles.forEach((p, i) => {
    const x = (p.grainStart / dur) * W;
    const grainEndX = ((p.grainStart + p.grainDuration) / dur) * W;
    const rmsNorm = (p.rms || 0) / maxRms;

    // Grain duration span (faint background)
    ctx.fillStyle = `rgba(100, 180, 255, ${0.05 + rmsNorm * 0.1})`;
    ctx.fillRect(x, 0, grainEndX - x, waveH);

    // Marker line on waveform
    ctx.strokeStyle = `rgba(255, ${Math.floor(100 + rmsNorm * 155)}, 50, ${0.3 + rmsNorm * 0.7})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, waveH);
    ctx.stroke();

    // RMS bar below waveform
    const barH = rmsNorm * markerH;
    const hue = rmsNorm * 120; // 0=red (quiet) → 120=green (loud)
    ctx.fillStyle = `hsl(${hue}, 80%, 50%)`;
    ctx.fillRect(x - 1, markerY + markerH - barH, 3, barH);

    // Index label (every particle if space, else every Nth)
    const spacing = W / particles.length;
    if (spacing > 14 || i % Math.ceil(14 / spacing) === 0) {
      ctx.fillStyle = '#888';
      ctx.font = '10px monospace';
      ctx.fillText(i, x - 3, markerY + markerH + 12);
    }
  });

  // ── Separator line ─────────────────────────────────────────────────
  ctx.strokeStyle = '#444';
  ctx.beginPath();
  ctx.moveTo(0, waveH + 10);
  ctx.lineTo(W, waveH + 10);
  ctx.stroke();

  // Labels
  ctx.fillStyle = '#666';
  ctx.font = '10px monospace';
  ctx.fillText('waveform', 4, 12);
  ctx.fillText('particle RMS', 4, markerY - 4);

  // Time axis
  const timeStep = dur > 4 ? 1 : dur > 2 ? 0.5 : 0.25;
  for (let t = 0; t <= dur; t += timeStep) {
    const x = (t / dur) * W;
    ctx.fillStyle = '#555';
    ctx.fillText(t.toFixed(1) + 's', x + 2, waveH + 8);
    ctx.strokeStyle = '#222';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  // ── Hover interaction ──────────────────────────────────────────────
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const time = (mx / W) * dur;

    // Find nearest particle
    let nearest = null, nearestDist = Infinity;
    particles.forEach((p, i) => {
      const px = (p.grainStart / dur) * W;
      const d = Math.abs(mx - px);
      if (d < nearestDist) { nearestDist = d; nearest = { p, i }; }
    });

    if (nearest && nearestDist < 30) {
      const p = nearest.p;
      info.textContent = `idx=${nearest.i}  grainStart=${p.grainStart.toFixed(4)}s  dur=${p.grainDuration.toFixed(3)}s  rms=${(p.rms || 0).toFixed(5)}  centroid=${(p.centroid || 0).toFixed(3)}  time@cursor=${time.toFixed(3)}s`;
    } else {
      info.textContent = `time=${time.toFixed(3)}s  sample=${Math.floor(time * sr)}`;
    }
  });

  // Close
  _overlay.querySelector('#dbg-wf-close').addEventListener('click', () => {
    _overlay.remove();
    _overlay = null;
  });
  document.addEventListener('keydown', function _esc(e) {
    if (e.key === 'Escape' && _overlay) {
      _overlay.remove();
      _overlay = null;
      document.removeEventListener('keydown', _esc);
    }
  });

  console.log(`[waveform] showing buffer ${bufIdx}: ${dur.toFixed(3)}s, ${particles.length} particles, maxRms=${maxRms.toFixed(4)}`);
}
