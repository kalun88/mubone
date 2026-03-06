// ============================================================================
// RENDERER — draw functions and animation loop
// ============================================================================

import {
  S, BG_COLOR, GRID_COLOR, GRID_SEGMENTS_LON, GRID_SEGMENTS_LAT,
  SPHERE_RADIUS, FOV_DEG, PARTICLE_BASE_SIZE, PARTICLE_MAX_SIZE,
  SAMPLE_PAINT_COLORS, LIVE_PAINT_COLORS, NEAREST_GLOW_COLOR,
  MAX_CLOUDS, AUTO_ROTATION_SPEED, ROTATION_SPEED, PAINT_INTERVAL,
  perf, perfTick, gp, rebuildGrainCurves
} from './state.js';
import { spherePoint, cameraTransform, project, getCursorLonLat, screenToLonLat, qFromAxisAngle, qNormalize, qMul } from './sphere.js';
import { activeGrainMap, rand } from './grain.js';
import { rebuildLiveBuffer, getRecordingDuration } from './audio.js';

// ── Module-level meter state ──────────────────────────────────────────────────
let inputClipHoldUntil  = 0;
let outputClipHoldUntil = 0;
const INPUT_CLIP_HOLD_S  = 1.5;
const METER_CLIP_HOLD_S  = 1.5;
const ANALYSER_BUF = new Float32Array(128);
let _faderInputLevel  = 0;
let _faderOutputLevel = 0;

// ── Fader helpers ─────────────────────────────────────────────────────────────
export function gainToFaderPos(gain) {
  if (gain <= 0) return 0;
  const db = 20 * Math.log10(gain);
  const DB_MIN = -60, DB_MAX = 6;
  return Math.max(0, Math.min(1, (db - DB_MIN) / (DB_MAX - DB_MIN)));
}
export function faderPosToGain(pos) {
  const DB_MIN = -60, DB_MAX = 6;
  const db = DB_MIN + pos * (DB_MAX - DB_MIN);
  return Math.pow(10, db / 20);
}
export function gainToDb(gain) {
  if (gain <= 0) return -Infinity;
  return 20 * Math.log10(gain);
}

// ── Input fader + meter ───────────────────────────────────────────────────────
export function drawInputMeter() {
  const fc = document.getElementById('inputFaderMeter');
  if (!fc) return;

  const dpr  = window.devicePixelRatio || 1;
  const rect  = fc.getBoundingClientRect();
  const W = Math.round(rect.width  || 40);
  const H = Math.round(rect.height || 64);
  if (fc.width !== W * dpr || fc.height !== H * dpr) {
    fc.width  = W * dpr;
    fc.height = H * dpr;
  }

  const c = fc.getContext('2d');
  c.save();
  c.scale(dpr, dpr);
  c.clearRect(0, 0, W, H);

  let rmsDb = -60, peakDb = -60;
  if (S.inputAnalyser) {
    S.inputAnalyser.getFloatTimeDomainData(ANALYSER_BUF);
    let sumSq = 0, peak = 0;
    for (let i = 0; i < ANALYSER_BUF.length; i++) {
      const v = Math.abs(ANALYSER_BUF[i]);
      sumSq += v * v;
      if (v > peak) peak = v;
    }
    const rms = Math.sqrt(sumSq / ANALYSER_BUF.length);
    rmsDb  = rms  > 0 ? 20 * Math.log10(rms)  : -60;
    peakDb = peak > 0 ? 20 * Math.log10(peak) : -60;
  }

  const DB_FLOOR = -60;
  const rawLevel = Math.max(0, Math.min(1, (rmsDb - DB_FLOOR) / -DB_FLOOR));
  _faderInputLevel += rawLevel > _faderInputLevel
    ? (rawLevel - _faderInputLevel) * 0.6
    : (rawLevel - _faderInputLevel) * 0.08;

  const ARROW_W  = 4;
  const LABEL_W  = 14;
  const METER_X  = ARROW_W + 1;
  const METER_W  = W - ARROW_W - 1 - LABEL_W - 1;
  const PAD_T    = 3;
  const PAD_B    = 3;
  const trackH   = H - PAD_T - PAD_B;

  const METER_DB_MIN = -60, METER_DB_MAX = 6;
  const meterDbToY = (db) => {
    const t = (db - METER_DB_MIN) / (METER_DB_MAX - METER_DB_MIN);
    return PAD_T + trackH - t * trackH;
  };

  c.fillStyle = '#111';
  c.fillRect(METER_X, PAD_T, METER_W, trackH);

  const fillH = Math.round(_faderInputLevel * trackH);
  if (fillH > 0) {
    const grad = c.createLinearGradient(0, PAD_T + trackH, 0, PAD_T);
    grad.addColorStop(0,    '#1a5c2e');
    grad.addColorStop(0.60, '#3daa55');
    grad.addColorStop(0.78, '#a8a820');
    grad.addColorStop(0.90, '#c85818');
    grad.addColorStop(1.0,  '#aa1818');
    c.fillStyle = grad;
    c.fillRect(METER_X, PAD_T + trackH - fillH, METER_W, fillH);
  }

  const now = performance.now() / 1000;
  if (peakDb >= 0) inputClipHoldUntil = now + INPUT_CLIP_HOLD_S;

  const notchDbs = [6, 0, -12, -24, -36, -48, -60];
  const isClipping = now < inputClipHoldUntil;
  const fontSize = Math.round(Math.max(5, Math.min(7, trackH / notchDbs.length - 1)));
  c.font = `${fontSize}px 'Roboto Mono', monospace`;
  c.textAlign = 'left';
  notchDbs.forEach(db => {
    const ny = meterDbToY(db);
    const isTop = db === 6;
    c.strokeStyle = (isTop && isClipping) ? 'rgba(220,80,80,0.9)' : 'rgba(255,255,255,0.2)';
    c.lineWidth   = isTop ? 1.5 : 0.75;
    c.beginPath(); c.moveTo(METER_X, ny); c.lineTo(METER_X + METER_W, ny); c.stroke();
    c.fillStyle    = 'rgba(255,255,255,0.28)';
    c.textBaseline = db === METER_DB_MIN ? 'bottom' : db === 6 ? 'top' : 'middle';
    const label    = db > 0 ? '+' + db : String(db);
    const labelY   = db === METER_DB_MIN ? ny + 1 : db === 6 ? ny + 0.5 : ny;
    c.fillText(label, METER_X + METER_W + 2, labelY);
  });

  if (isClipping) {
    c.fillStyle = '#dd2222';
    c.fillRect(METER_X, PAD_T, METER_W, 3);
  }

  const fPos     = gainToFaderPos(S.inputGainValue);
  const fY       = PAD_T + trackH - fPos * trackH;
  const isOver   = S.inputGainValue > 1.0;
  const arrowColor = isOver ? '#e8a030' : '#c8c8c8';

  c.strokeStyle = arrowColor;
  c.lineWidth   = 1;
  c.beginPath(); c.moveTo(METER_X, fY); c.lineTo(METER_X + METER_W, fY); c.stroke();

  const TH = 8;
  c.fillStyle = arrowColor;
  c.beginPath();
  c.moveTo(0,       fY - TH / 2);
  c.lineTo(ARROW_W, fY);
  c.lineTo(0,       fY + TH / 2);
  c.closePath();
  c.fill();

  c.restore();
}

// ── Output meter ──────────────────────────────────────────────────────────────
export function drawOutputMeter() {
  const fc = document.getElementById('outputFaderMeter');
  if (!fc) return;

  let rmsDb = -60, peakDb = -60;
  if (S.masterAnalyser) {
    S.masterAnalyser.getFloatTimeDomainData(ANALYSER_BUF);
    let sumSq = 0, peak = 0;
    for (let i = 0; i < ANALYSER_BUF.length; i++) {
      const v = Math.abs(ANALYSER_BUF[i]);
      sumSq += v * v;
      if (v > peak) peak = v;
    }
    const rms = Math.sqrt(sumSq / ANALYSER_BUF.length);
    rmsDb  = rms  > 0 ? 20 * Math.log10(rms)  : -60;
    peakDb = peak > 0 ? 20 * Math.log10(peak) : -60;
  }

  const DB_FLOOR = -60;
  const rawLevel = Math.max(0, Math.min(1, (rmsDb - DB_FLOOR) / -DB_FLOOR));
  _faderOutputLevel += rawLevel > _faderOutputLevel
    ? (rawLevel - _faderOutputLevel) * 0.6
    : (rawLevel - _faderOutputLevel) * 0.08;

  const dpr  = window.devicePixelRatio || 1;
  const rect  = fc.getBoundingClientRect();
  const W = Math.round(rect.width  || 38);
  const H = Math.round(rect.height || 64);
  if (fc.width !== W * dpr || fc.height !== H * dpr) {
    fc.width  = W * dpr;
    fc.height = H * dpr;
  }
  const c = fc.getContext('2d');
  c.save();
  c.scale(dpr, dpr);
  c.clearRect(0, 0, W, H);

  const ARROW_W  = 4;
  const LABEL_W  = 14;
  const METER_X  = ARROW_W + 1;
  const METER_W  = W - ARROW_W - 1 - LABEL_W - 1;
  const PAD_T    = 3, PAD_B = 3;
  const trackH   = H - PAD_T - PAD_B;
  const METER_DB_MIN = -60, METER_DB_MAX = 6;

  function meterDbToY(db) {
    const t = (db - METER_DB_MIN) / (METER_DB_MAX - METER_DB_MIN);
    return PAD_T + trackH - t * trackH;
  }

  c.fillStyle = '#111';
  c.fillRect(METER_X, PAD_T, METER_W, trackH);

  const fillH = Math.round(_faderOutputLevel * trackH);
  if (fillH > 0) {
    const grad = c.createLinearGradient(0, PAD_T + trackH, 0, PAD_T);
    grad.addColorStop(0,    '#1a5c2e');
    grad.addColorStop(0.60, '#3daa55');
    grad.addColorStop(0.78, '#a8a820');
    grad.addColorStop(0.90, '#c85818');
    grad.addColorStop(1.0,  '#aa1818');
    c.fillStyle = grad;
    c.fillRect(METER_X, PAD_T + trackH - fillH, METER_W, fillH);
  }

  const now = performance.now() / 1000;
  if (peakDb >= 0) outputClipHoldUntil = now + METER_CLIP_HOLD_S;

  const notchDbs = [6, 0, -12, -24, -36, -48, -60];
  const isClipping = now < outputClipHoldUntil;
  const fontSize = Math.round(Math.max(5, Math.min(7, trackH / notchDbs.length - 1)));
  c.font = `${fontSize}px 'Roboto Mono', monospace`;
  c.textAlign = 'left';
  notchDbs.forEach(db => {
    const ny = meterDbToY(db);
    const isTop = db === 6;
    c.strokeStyle = (isTop && isClipping) ? 'rgba(220,80,80,0.9)' : 'rgba(255,255,255,0.2)';
    c.lineWidth   = isTop ? 1.5 : 0.75;
    c.beginPath(); c.moveTo(METER_X, ny); c.lineTo(METER_X + METER_W, ny); c.stroke();
    c.fillStyle    = 'rgba(255,255,255,0.28)';
    c.textBaseline = db === METER_DB_MIN ? 'bottom' : db === 6 ? 'top' : 'middle';
    const label    = db > 0 ? '+' + db : String(db);
    const labelY   = db === METER_DB_MIN ? ny + 1 : db === 6 ? ny + 0.5 : ny;
    c.fillText(label, METER_X + METER_W + 2, labelY);
  });

  if (isClipping) {
    c.fillStyle = '#dd2222';
    c.fillRect(METER_X, PAD_T, METER_W, 3);
  }

  const fPos  = gainToFaderPos(S.outputGainValue);
  const fY    = PAD_T + trackH - fPos * trackH;
  const arrowColor = S.isMuted ? '#553333' : (S.outputGainValue > 1.0 ? '#e8a030' : '#c8c8c8');

  c.strokeStyle = arrowColor;
  c.lineWidth   = 1;
  c.beginPath(); c.moveTo(METER_X, fY); c.lineTo(METER_X + METER_W, fY); c.stroke();

  const TH = 8;
  c.fillStyle = arrowColor;
  c.beginPath();
  c.moveTo(0,       fY - TH / 2);
  c.lineTo(ARROW_W, fY);
  c.lineTo(0,       fY + TH / 2);
  c.closePath();
  c.fill();

  c.restore();
}

// ── Main draw frame ───────────────────────────────────────────────────────────
export function drawFrame() {
  S.ctx.fillStyle = BG_COLOR;
  S.ctx.fillRect(0, 0, S.canvas.width, S.canvas.height);
  drawGridLines();
  drawParticles();
  S.updateLiveGranulatingIndicator?.();
  drawTetherLine();
  drawCursor();
  drawClouds();
  S.drawSvLiveOverlay?.();
  drawRadiusTooltip();
  drawOutputMeter();
  drawInputMeter();
  if (typeof S.drawRecencyDial === 'function') S.drawRecencyDial();
  S.drawRadiusViz?.();
  S.updateCloudBanksUI?.();
}

// ── Cloud rendering ───────────────────────────────────────────────────────────
export function drawClouds() {
  const { lon: curLon, lat: curLat } = S.mouseInCanvas ? screenToLonLat(S.mousePixelX, S.mousePixelY) : getCursorLonLat();
  const nearestSlot = S.findNearestCloudSlot?.(curLon, curLat) ?? -1;
  const W = S.canvas.width, H = S.canvas.height;
  const margin = 14;

  for (let i = 0; i < MAX_CLOUDS; i++) {
    const cloud = S.cloudSlots[i];
    if (!cloud) continue;

    const [wx, wy, wz] = spherePoint(cloud.lon, cloud.lat);
    const [cx, cy, cz] = cameraTransform(wx, wy, wz);
    const proj = project(cx, cy, cz);
    const isNearest = i === nearestSlot;
    const isBehind  = cz <= 0.1;

    if (proj) {
      S.ctx.save();
      S.ctx.globalAlpha = isNearest ? 0.7 : 0.4;
      S.ctx.strokeStyle = cloud.color;
      S.ctx.lineWidth = isNearest ? 2 : 1;
      S.ctx.setLineDash([4, 6]);

      if (cloud.nearestMode) {
        const d = isNearest ? 36 : 30;
        S.ctx.beginPath();
        S.ctx.moveTo(proj.sx,     proj.sy - d);
        S.ctx.lineTo(proj.sx + d, proj.sy    );
        S.ctx.lineTo(proj.sx,     proj.sy + d);
        S.ctx.lineTo(proj.sx - d, proj.sy    );
        S.ctx.closePath();
        S.ctx.stroke();
      } else {
        const rRad    = cloud.searchRadiusDeg * Math.PI / 180;
        const fovRad  = (FOV_DEG * Math.PI) / 180;
        const focalLen = (W / 2) / Math.tan(fovRad / 2);
        const screenR  = focalLen * Math.tan(rRad) / (proj.depth / SPHERE_RADIUS);
        S.ctx.beginPath();
        S.ctx.arc(proj.sx, proj.sy, Math.max(12, screenR), 0, Math.PI * 2);
        S.ctx.stroke();
      }
      S.ctx.setLineDash([]);
      S.ctx.globalAlpha = isNearest ? 1 : 0.6;
      S.ctx.fillStyle = cloud.color;
      if (isNearest) { S.ctx.shadowColor = cloud.color; S.ctx.shadowBlur = 10; }
      S.ctx.beginPath(); S.ctx.arc(proj.sx, proj.sy, 4, 0, Math.PI * 2); S.ctx.fill();
      S.ctx.shadowBlur = 0;
      S.ctx.globalAlpha = isNearest ? 0.9 : 0.5;
      S.ctx.fillStyle = cloud.color;
      S.ctx.font = `10px "Roboto Mono", monospace`;
      S.ctx.textAlign = 'center';
      S.ctx.textBaseline = 'middle';
      S.ctx.fillText(i + 1, proj.sx, proj.sy - 12);
      S.ctx.restore();
    }

    {
      let edgeness;
      if (!proj) {
        edgeness = 1;
      } else {
        const nx = Math.abs(proj.sx - W / 2) / (W / 2);
        const ny = Math.abs(proj.sy - H / 2) / (H / 2);
        edgeness = Math.max(nx, ny);
      }

      const innerThresh = 0.6;
      const outerThresh = 0.88;
      const fadeT = Math.max(0, Math.min(1, (edgeness - innerThresh) / (outerThresh - innerThresh)));

      if (fadeT <= 0) continue;

      const horiz = Math.sqrt(cx * cx + cz * cz);
      const az    = Math.atan2(cx, Math.max(0.0001, horiz));
      const el    = Math.atan2(cy, horiz);

      const azMax = Math.PI * 0.75;
      const tx    = 0.5 + (az / azMax) * 0.5;
      const ty    = 0.5 - (el / (Math.PI * 0.5)) * 0.5;

      const dx = tx - 0.5, dy = ty - 0.5;
      let ex, ey;
      if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) {
        ex = W / 2; ey = margin;
      } else {
        const scaleX = dx !== 0 ? Math.abs(0.5 / dx) : Infinity;
        const scaleY = dy !== 0 ? Math.abs(0.5 / dy) : Infinity;
        const scale  = Math.min(scaleX, scaleY);
        ex = Math.max(0, Math.min(W, (0.5 + dx * scale) * W));
        ey = Math.max(0, Math.min(H, (0.5 + dy * scale) * H));
        const fromCX = ex - W/2, fromCY = ey - H/2;
        const dist   = Math.sqrt(fromCX*fromCX + fromCY*fromCY);
        if (dist > 0) {
          ex = W/2 + fromCX * (1 - margin / dist);
          ey = H/2 + fromCY * (1 - margin / dist);
        }
      }

      const baseAlpha = isNearest ? 0.9 : 0.65;
      const alpha     = baseAlpha * fadeT;
      const dotR      = isNearest ? 5 : 3.5;

      S.ctx.save();
      S.ctx.globalAlpha = alpha;
      S.ctx.fillStyle   = cloud.color;
      if (isNearest && isBehind) { S.ctx.shadowColor = cloud.color; S.ctx.shadowBlur = 10; }
      S.ctx.beginPath();
      S.ctx.arc(ex, ey, dotR, 0, Math.PI * 2);
      S.ctx.fill();
      if (fadeT > 0.6) {
        S.ctx.shadowBlur   = 0;
        S.ctx.globalAlpha  = alpha * 0.8;
        S.ctx.fillStyle    = cloud.color;
        S.ctx.font         = `8px "Roboto Mono", monospace`;
        S.ctx.textAlign    = 'center';
        S.ctx.textBaseline = 'middle';
        const labelOff   = dotR + 6;
        const lx = ex + (ex < W/2 ? labelOff : -labelOff);
        const ly = ey + (ey < H/2 ? labelOff : -labelOff);
        S.ctx.fillText(i + 1, lx, ly);
      }
      S.ctx.restore();
    }
  }
}

// ── Tether line ───────────────────────────────────────────────────────────────
export function drawTetherLine() {
  if (!S.mouseInCanvas) return;
  const cx = S.canvas.width / 2, cy = S.canvas.height / 2;
  const dx = S.mousePixelX - cx, dy = S.mousePixelY - cy;
  const dist = Math.sqrt(dx*dx + dy*dy);
  if (dist < 20) return;
  const maxDist = Math.min(S.canvas.width, S.canvas.height) * 0.5;
  const alpha   = Math.min(0.5, 0.1 + 0.4 * (dist / maxDist));
  S.ctx.save();
  S.ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
  S.ctx.lineWidth   = 1;
  S.ctx.setLineDash([4, 8]);
  S.ctx.beginPath();
  S.ctx.moveTo(cx, cy);
  S.ctx.lineTo(S.mousePixelX, S.mousePixelY);
  S.ctx.stroke();
  S.ctx.setLineDash([]);
  S.ctx.restore();
}

// ── Grid lines ────────────────────────────────────────────────────────────────
export function drawGridLines() {
  for (let i = 0; i < GRID_SEGMENTS_LON; i++) {
    const lon = (i / GRID_SEGMENTS_LON) * Math.PI * 2;
    S.ctx.strokeStyle = GRID_COLOR;
    S.ctx.lineWidth   = 0.8;
    S.ctx.globalAlpha = 0.45;
    drawArc(lon, 'lon');
  }
  for (let i = 1; i < GRID_SEGMENTS_LAT; i++) {
    const lat          = (i / GRID_SEGMENTS_LAT) * Math.PI - Math.PI / 2;
    const distFromEq   = Math.abs(lat) / (Math.PI / 2);
    const gridTint     = lat > 0 ? '#c8a060' : '#60a0c8';
    if      (distFromEq < 0.05) { S.ctx.strokeStyle = '#a0dede'; S.ctx.lineWidth = 2.5; S.ctx.globalAlpha = 0.9;  }
    else if (distFromEq < 0.4)  { S.ctx.strokeStyle = gridTint;  S.ctx.lineWidth = 1.2; S.ctx.globalAlpha = 0.6; }
    else if (distFromEq < 0.7)  { S.ctx.strokeStyle = gridTint;  S.ctx.lineWidth = 0.8; S.ctx.globalAlpha = 0.4;  }
    else                        { S.ctx.strokeStyle = gridTint;  S.ctx.lineWidth = 0.5; S.ctx.globalAlpha = 0.2;  }
    drawArc(lat, 'lat');
  }
  S.ctx.globalAlpha = 1;
}

export function drawArc(angle, type) {
  const steps = 48;
  let started = false;
  S.ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t   = i / steps;
    const lon = type === 'lon' ? angle : t * Math.PI * 2;
    const lat = type === 'lon' ? t * Math.PI - Math.PI / 2 : angle;
    const [wx, wy, wz] = spherePoint(lon, lat);
    const [cx, cy, cz] = cameraTransform(wx, wy, wz);
    const proj = project(cx, cy, cz);
    if (proj) {
      if (!started) { S.ctx.moveTo(proj.sx, proj.sy); started = true; }
      else            S.ctx.lineTo(proj.sx, proj.sy);
    } else { started = false; }
  }
  S.ctx.stroke();
}

// ── Radius tooltip (transient, near cursor) ───────────────────────────────────
export function drawRadiusTooltip() {
  const now = performance.now();
  if (now >= S.radiusTooltipUntil) return;

  const fadeMs  = 300;
  const elapsed = S.radiusTooltipUntil - now;
  const alpha   = Math.min(1, elapsed / fadeMs);

  const mx = S.mouseInCanvas ? S.mousePixelX : S.canvas.width  / 2;
  const my = S.mouseInCanvas ? S.mousePixelY : S.canvas.height / 2;
  const ox = 14, oy = -20;

  const label = S.nearestMode ? 'snap' : `${S.searchRadiusDeg}°`;
  const fs    = 11;

  S.ctx.save();
  S.ctx.globalAlpha = alpha;
  S.ctx.font        = `${fs}px "Roboto Mono", monospace`;
  S.ctx.textAlign   = 'left';
  S.ctx.textBaseline = 'middle';

  const tw = S.ctx.measureText(label).width;
  const px = 5, py = 3;
  S.ctx.fillStyle = 'rgba(30,30,30,0.75)';
  S.ctx.beginPath();
  S.ctx.roundRect(mx + ox - px, my + oy - fs/2 - py, tw + px*2, fs + py*2, 3);
  S.ctx.fill();

  S.ctx.fillStyle = S.nearestMode ? '#e8a030' : '#7abcbc';
  S.ctx.fillText(label, mx + ox, my + oy);
  S.ctx.restore();
}

// ── Particles ─────────────────────────────────────────────────────────────────
export function drawParticles() {
  const projected = [];
  const candidates = [];

  for (const p of S.particles) {
    const [wx, wy, wz] = spherePoint(p.lon, p.lat);
    const [cx, cy, cz] = cameraTransform(wx, wy, wz);
    const proj = project(cx, cy, cz);
    if (!proj) continue;

    const mag    = Math.sqrt(cx*cx + cy*cy + cz*cz);
    const facing = Math.max(0, cz / mag);
    const squash = 0.3 + 0.7 * facing;
    const dx     = proj.sx - S.canvas.width  / 2;
    const dy     = proj.sy - S.canvas.height / 2;
    const squashAngle = Math.atan2(dy, dx);

    candidates.push({ p, proj, facing, squash, squashAngle });
  }

  for (const { p, proj, facing, squash, squashAngle } of candidates) {
    const grainEntry = activeGrainMap.get(p);
    const selected   = grainEntry !== undefined;
    const glowColor  = selected ? (grainEntry.glowColor ?? p.color) : null;
    const ringColor  = selected ? (grainEntry.glowColor ?? '#ffffff') : null;
    projected.push({ ...proj, color: p.color, selected, glowColor, ringColor, facing, squash, squashAngle });
  }

  projected.sort((a, b) => b.depth - a.depth);

  for (const p of projected) {
    const distFactor = 1 - (p.depth / (SPHERE_RADIUS * 2));
    const size  = PARTICLE_BASE_SIZE + (PARTICLE_MAX_SIZE - PARTICLE_BASE_SIZE) * Math.max(0, distFactor);
    const alpha = (0.3 + 0.7 * Math.max(0, distFactor)) * (0.5 + 0.5 * p.facing);

    S.ctx.save();
    S.ctx.globalAlpha = alpha;
    S.ctx.translate(p.sx, p.sy);
    S.ctx.rotate(p.squashAngle);
    S.ctx.scale(1, p.squash);

    if (p.selected) {
      S.ctx.globalAlpha = 1;
      S.ctx.shadowColor = p.glowColor;
      S.ctx.shadowBlur  = 25;
      S.ctx.strokeStyle = p.ringColor;
      S.ctx.lineWidth   = 2;
      S.ctx.beginPath(); S.ctx.arc(0, 0, size + 5, 0, Math.PI * 2); S.ctx.stroke();
      S.ctx.shadowBlur  = 0;
      S.ctx.globalAlpha = alpha;
    }

    S.ctx.fillStyle = p.color;
    S.ctx.beginPath(); S.ctx.arc(0, 0, size, 0, Math.PI * 2); S.ctx.fill();

    S.ctx.fillStyle = 'rgba(255,255,255,0.4)';
    S.ctx.beginPath(); S.ctx.arc(0, 0, size * 0.25, 0, Math.PI * 2); S.ctx.fill();

    S.ctx.restore();
  }
}

// ── Cursor ────────────────────────────────────────────────────────────────────
export function drawCursor() {
  const cx = S.canvas.width / 2, cy = S.canvas.height / 2;
  const mx = (S.mouseInCanvas || S.altLocked) ? S.mousePixelX : cx;
  const my = (S.mouseInCanvas || S.altLocked) ? S.mousePixelY : cy;

  const searchRadiusRad = S.searchRadiusDeg * Math.PI / 180;
  const fovRad   = (FOV_DEG * Math.PI) / 180;
  const focalLen = (S.canvas.width / 2) / Math.tan(fovRad / 2);
  const brushR   = searchRadiusRad < Math.PI / 2
    ? focalLen * Math.tan(searchRadiusRad)
    : S.canvas.width * 0.8;

  if (S.isMobile && !S._mobileSetupDone) return;

  S.ctx.save();

  S.ctx.fillStyle = 'rgba(255,255,255,0.25)';
  S.ctx.beginPath(); S.ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); S.ctx.fill();

  if (!S.mouseInCanvas && !S.altLocked) { S.ctx.restore(); return; }

  const painting = S.isPainting;
  const color    = S.isRecording
    ? LIVE_PAINT_COLORS[S.liveColorIndex % LIVE_PAINT_COLORS.length]
    : SAMPLE_PAINT_COLORS[S.activeSampleIndex >= 0 ? S.activeSampleIndex % SAMPLE_PAINT_COLORS.length : S.sampleColorIndex];

  if (S.nearestMode) {
    const d = 24;
    S.ctx.strokeStyle = painting ? `${color}cc` : `${NEAREST_GLOW_COLOR}99`;
    S.ctx.lineWidth   = painting ? 1.5 : 1;
    S.ctx.setLineDash([4, 5]);
    if (painting) { S.ctx.shadowColor = color; S.ctx.shadowBlur = 10; }
    S.ctx.beginPath();
    S.ctx.moveTo(mx,     my - d);
    S.ctx.lineTo(mx + d, my    );
    S.ctx.lineTo(mx,     my + d);
    S.ctx.lineTo(mx - d, my    );
    S.ctx.closePath();
    S.ctx.stroke();
    S.ctx.setLineDash([]);
    S.ctx.shadowBlur = 0;
  } else if (painting) {
    S.ctx.fillStyle   = `${color}18`;
    S.ctx.beginPath(); S.ctx.arc(mx, my, brushR, 0, Math.PI * 2); S.ctx.fill();
    S.ctx.shadowColor = color;
    S.ctx.shadowBlur  = 12;
    S.ctx.strokeStyle = `${color}cc`;
    S.ctx.lineWidth   = 1.5;
    S.ctx.beginPath(); S.ctx.arc(mx, my, brushR, 0, Math.PI * 2); S.ctx.stroke();
    S.ctx.shadowBlur  = 0;
  } else {
    S.ctx.fillStyle = 'rgba(180,180,180,0.06)';
    S.ctx.beginPath(); S.ctx.arc(mx, my, brushR, 0, Math.PI * 2); S.ctx.fill();
    S.ctx.strokeStyle = 'rgba(122,188,188,0.35)';
    S.ctx.lineWidth   = 1;
    S.ctx.setLineDash([5, 5]);
    S.ctx.beginPath(); S.ctx.arc(mx, my, brushR, 0, Math.PI * 2); S.ctx.stroke();
    S.ctx.setLineDash([]);
  }

  const tipR = 3, armLen = 7, armGap = tipR + 2;
  S.ctx.strokeStyle = painting ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)';
  S.ctx.lineWidth   = 1.5;
  S.ctx.beginPath(); S.ctx.arc(mx, my, tipR, 0, Math.PI * 2); S.ctx.stroke();
  S.ctx.fillStyle   = painting ? color : 'rgba(255,255,255,0.8)';
  S.ctx.beginPath(); S.ctx.arc(mx, my, tipR * 0.45, 0, Math.PI * 2); S.ctx.fill();

  S.ctx.strokeStyle = painting ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.35)';
  S.ctx.lineWidth   = 1;
  S.ctx.beginPath();
  S.ctx.moveTo(mx + armGap, my);   S.ctx.lineTo(mx + armGap + armLen, my);
  S.ctx.moveTo(mx - armGap, my);   S.ctx.lineTo(mx - armGap - armLen, my);
  S.ctx.moveTo(mx, my - armGap);   S.ctx.lineTo(mx, my - armGap - armLen);
  S.ctx.moveTo(mx, my + armGap);   S.ctx.lineTo(mx, my + armGap + armLen);
  S.ctx.stroke();

  S.ctx.restore();
}

// ── Canvas resize ─────────────────────────────────────────────────────────────
export function resizeCanvas() {
  const rect   = S.canvas.parentElement.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  S.canvas.width  = rect.width;
  S.canvas.height = rect.height;
  if (S.isMobile) {
    S.mousePixelX   = S.canvas.width  / 2;
    S.mousePixelY   = S.canvas.height / 2;
    S.mouseInCanvas = true;
  }
}

// ── Animation loop ────────────────────────────────────────────────────────────
let _animLastAt = 0;
export function animate() {
  const _animNow = performance.now();
  if (_animLastAt > 0) perf.frameMs = _animNow - _animLastAt;
  _animLastAt = _animNow;
  perfTick();

  // Camera rotation
  if (S.mouseInCanvas && !S.altLocked && !(S.isMobile && S.orientationActive)) {
    const dist = Math.sqrt(S.mouseX*S.mouseX + S.mouseY*S.mouseY);
    const DEAD_ZONE = 0.30;
    if (dist > DEAD_ZONE) {
      const t     = Math.min((dist - DEAD_ZONE) / (1 - DEAD_ZONE), 1);
      const curve = t * t * t * t;
      const speed = curve * ROTATION_SPEED;
      const nx = S.mouseX / dist, ny = S.mouseY / dist;

      if (Math.abs(nx) > 0.001) {
        const camUp  = qRotateVec => {
          // inline to avoid import — use S.camQ directly
          const q = S.camQ, v = [0, 1, 0];
          const vq = [0, v[0], v[1], v[2]];
          const conj = [q[0], -q[1], -q[2], -q[3]];
          function mul(a, b) {
            return [a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3], a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2], a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1], a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]];
          }
          const r = mul(mul(q, vq), conj); return [r[1], r[2], r[3]];
        };
        // Use sphere.js imports directly
        const up = _qRotVec(S.camQ, [0, 1, 0]);
        const yawSign = up[1] < 0 ? -1 : 1;
        const qYaw = _qFromAA(0, 1, 0, nx * speed * yawSign);
        S.camQ = _qNorm(_qMul(qYaw, S.camQ));
      }
      if (Math.abs(ny) > 0.001) {
        const qPitch = _qFromAA(1, 0, 0, ny * speed);
        S.camQ = _qNorm(_qMul(S.camQ, qPitch));
      }
    }
  } else if (!S.altLocked) {
    const qAuto = _qFromAA(0, 1, 0, AUTO_ROTATION_SPEED);
    S.camQ = _qNorm(_qMul(qAuto, S.camQ));
  }

  // ── BNO085 sensor override ─────────────────────────────────────────────────
  // getSensorCamQ is injected via S._getSensorCamQ by main.js after sensor init.
  if (typeof S._getSensorCamQ === 'function') {
    const sq = S._getSensorCamQ();
    if (sq) S.camQ = sq;  // [w, vx, vy, vz]
  }

  // Drop particles while painting
  if (S.isPainting && !S.altLocked) {
    S.paintFrameCount++;
    if (S.paintFrameCount % PAINT_INTERVAL === 0) {
      const { lon, lat } = screenToLonLat(
        S.altLocked ? S.altFrozenMousePixelX : S.mousePixelX,
        S.altLocked ? S.altFrozenMousePixelY : S.mousePixelY
      );
      const gpr = gp();
      const durVariation = rand(-gpr.durJitter * 0.5, gpr.durJitter * 0.5);

      let particle = null;

      if (S.isRecording && S.currentLiveBufferIdx >= 0) {
        const recTime = getRecordingDuration();
        particle = {
          lon, lat,
          strokeId:      S.currentStrokeId,
          lastTriggeredAt: undefined,
          grainDuration: Math.max(0.05, gpr.duration + durVariation),
          source:        'live',
          liveBufferIdx: S.currentLiveBufferIdx,
          grainStart:    Math.max(0, recTime - gpr.duration),
          color:         LIVE_PAINT_COLORS[S.liveColorIndex % LIVE_PAINT_COLORS.length]
        };
      } else if (S.activeSampleIndex >= 0 && S.samples[S.activeSampleIndex] && S.samples[S.activeSampleIndex].buffer) {
        const s          = S.samples[S.activeSampleIndex];
        const cropStart  = s.cropStart * s.duration;
        const cropEnd    = s.cropEnd   * s.duration;
        const cropLen    = cropEnd - cropStart;
        const startJitter = rand(-gpr.startJitter * 0.3, gpr.startJitter * 0.3);
        let rawStart      = s.grainCursor + startJitter;
        if (cropLen > 0) rawStart = cropStart + ((rawStart - cropStart) % cropLen + cropLen) % cropLen;
        const clampedStart = Math.max(cropStart, Math.min(rawStart, cropEnd - 0.01));
        const grainDur     = Math.max(0.05, Math.min(gpr.duration + durVariation, cropEnd - clampedStart));

        particle = {
          lon, lat,
          strokeId:      S.currentStrokeId,
          lastTriggeredAt: undefined,
          source:        'sample',
          sampleIndex:   S.activeSampleIndex,
          grainStart:    clampedStart,
          grainDuration: grainDur,
          color:         SAMPLE_PAINT_COLORS[S.activeSampleIndex % SAMPLE_PAINT_COLORS.length]
        };

        const stride = gpr.period * rand(0.8, 1.2);
        s.grainCursor += stride;
        if (s.grainCursor > cropEnd) s.grainCursor = cropStart + ((s.grainCursor - cropStart) % cropLen);
      }

      if (particle) S.particles.push(particle);
    }
  }

  if (S.isRecording) rebuildLiveBuffer();

  const now30 = performance.now();
  const elapsed30 = now30 - (animate._lastRenderTime || 0);
  if (elapsed30 >= 33) {
    animate._lastRenderTime = now30 - (elapsed30 % 33);
    drawFrame();
    S.updateWaveformPlayheads?.();

    const { lon, lat } = S.mouseInCanvas ? screenToLonLat(S.mousePixelX, S.mousePixelY) : getCursorLonLat();
    const lonDeg = (lon * 180 / Math.PI).toFixed(1).padStart(7);
    const latDeg = (lat * 180 / Math.PI).toFixed(1).padStart(6);
    const coordEl = document.getElementById('coordinates');
    if (coordEl) coordEl.textContent = `${lonDeg},${latDeg}`;
  }

  requestAnimationFrame(animate);
}

// Inline quaternion helpers to avoid re-importing (sphere.js exports these too
// but we keep them here to avoid any circular-import edge cases at load time).
function _qMul(a, b) {
  return [a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3], a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2], a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1], a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]];
}
function _qNorm(q) { const l=Math.sqrt(q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3]); return [q[0]/l,q[1]/l,q[2]/l,q[3]/l]; }
function _qFromAA(ax, ay, az, angle) { const h=angle/2,s=Math.sin(h); return [Math.cos(h),ax*s,ay*s,az*s]; }
function _qRotVec(q, v) {
  const vq=[0,v[0],v[1],v[2]], c=[q[0],-q[1],-q[2],-q[3]];
  const r=_qMul(_qMul(q,vq),c); return [r[1],r[2],r[3]];
}
