// ============================================================================
// RENDERER — draw functions and animation loop
// ============================================================================

import {
  S, BG_COLOR, GRID_COLOR, GRID_SEGMENTS_LON, GRID_SEGMENTS_LAT,
  SPHERE_RADIUS, FOV_DEG, PARTICLE_BASE_SIZE, PARTICLE_MAX_SIZE,
  SAMPLE_PAINT_COLORS, LIVE_PAINT_COLORS, NEAREST_GLOW_COLOR,
  MAX_CLOUDS, AUTO_ROTATION_SPEED, ROTATION_SPEED, PAINT_INTERVAL,
  RENDER_TARGET_FPS,
  perf, perfTick, gp, rebuildGrainCurves, minGrainDurS
} from './state.js';
import { spherePoint, cameraTransform, project, getCursorLonLat, screenToLonLat } from './sphere.js';
import { rand, activeGrainMap, stampCartesian } from './grain.js';
import { rebuildLiveBuffer, getRecordingDuration } from './audio.js';
import { snapshotInputFeatures, featuresFromBuffer, normalise, featuresToHSL, tickPeakHold } from './audio-features.js';

// All VU metering moved to ui-meters.js (DOM-based, shared with audio settings modal).

// Cached DOM element for per-frame coordinate display
let _coordEl = null;

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
  // Meters now drawn by DOM-based startMainMetering() loop in ui-meters.js
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
      S.ctx.beginPath(); S.ctx.arc(proj.sx, proj.sy, 4, 0, Math.PI * 2); S.ctx.fill();
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
      S.ctx.beginPath();
      S.ctx.arc(ex, ey, dotR, 0, Math.PI * 2);
      S.ctx.fill();
      if (fadeT > 0.6) {
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
  const steps = 24;
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
  const _rx = mx + ox - px, _ry = my + oy - fs/2 - py, _rw = tw + px*2, _rh = fs + py*2;
  if (S.ctx.roundRect) { S.ctx.roundRect(_rx, _ry, _rw, _rh, 3); }
  else                 { S.ctx.rect(_rx, _ry, _rw, _rh); }
  S.ctx.fill();

  S.ctx.fillStyle = S.nearestMode ? '#e8a030' : '#7abcbc';
  S.ctx.fillText(label, mx + ox, my + oy);
  S.ctx.restore();
}

// ── Particles ─────────────────────────────────────────────────────────────────

// Pre-allocated sort buffers — grown when needed, never shrunk.
// Avoids per-frame GC pressure from fresh Array / Int32Array allocations.
// STRIDE: sx, sy, depth, facing, (skip color), rms, centroid, zcr = 7 numeric fields
const _STRIDE = 7;
let _sortBuf   = new Float64Array(512 * _STRIDE);
let _colorBuf  = new Array(512);       // string colors can't go in a typed array
let _sortIdx   = new Int32Array(512);
// Cache projected positions for active grains to avoid double spherePoint/project work.
const _glowCache = new Map();   // particle → { sx, sy, depth, facing }

export function drawParticles() {
  // Single-pass: project + collect directly into a flat sort buffer.
  // When vizMode is on, we pack audio features into the buffer for
  // feature-driven size/colour. When off, original palette colour is used.
  const useViz = S.vizMode;
  const STRIDE = _STRIDE;

  // Ensure pre-allocated buffers are large enough
  const maxCount = S.particles.length;
  if (_sortIdx.length < maxCount) {
    _sortBuf  = new Float64Array(maxCount * STRIDE);
    _colorBuf = new Array(maxCount);
    _sortIdx  = new Int32Array(maxCount);
  }

  _glowCache.clear();
  const hasGlow = activeGrainMap.size > 0;

  let count = 0;
  for (const p of S.particles) {
    const [wx, wy, wz] = spherePoint(p.lon, p.lat);
    const [cx, cy, cz] = cameraTransform(wx, wy, wz);
    const proj = project(cx, cy, cz);
    if (!proj) continue;
    const mag    = Math.sqrt(cx*cx + cy*cy + cz*cz);
    const facing = Math.max(0, cz / mag);
    const off    = count * STRIDE;
    _sortBuf[off]     = proj.sx;
    _sortBuf[off + 1] = proj.sy;
    _sortBuf[off + 2] = proj.depth;
    _sortBuf[off + 3] = facing;
    _sortBuf[off + 4] = p.rms ?? 0;
    _sortBuf[off + 5] = p.centroid ?? 0;
    _sortBuf[off + 6] = p.zcr ?? 0;
    _colorBuf[count]  = p.color;
    if (hasGlow && activeGrainMap.has(p)) {
      _glowCache.set(p, { sx: proj.sx, sy: proj.sy, depth: proj.depth, facing });
    }
    count++;
  }

  const buf = _sortBuf;
  const idx = _sortIdx;
  for (let i = 0; i < count; i++) idx[i] = i;
  idx.subarray(0, count).sort((a, b) => buf[b * STRIDE + 2] - buf[a * STRIDE + 2]);

  // Read mutable size overrides (set from viz modal sliders)
  const pBase = S.vizMinSize ?? PARTICLE_BASE_SIZE;
  const pMax  = S.vizMaxSize ?? PARTICLE_MAX_SIZE;

  for (let ii = 0; ii < count; ii++) {
    const i          = idx[ii] * STRIDE;
    const sx         = buf[i];
    const sy         = buf[i + 1];
    const depth      = buf[i + 2];
    const facing     = buf[i + 3];
    const distFactor = 1 - (depth / (SPHERE_RADIUS * 2));
    const depthScale = Math.max(0, distFactor);

    let size, color, alpha;

    if (useViz && buf[i + 4] > 0) {
      // ── Feature-driven rendering ──
      const rmsN  = normalise(buf[i + 4], S.vizRmsMin, S.vizRmsMax);
      const centN = normalise(buf[i + 5], S.vizCentroidMin, S.vizCentroidMax);
      const zcrR  = buf[i + 6]; // already 0–1

      // Size: RMS drives a min→max lerp, then depth perspective scales it down
      // rmsN=0 → pBase (quiet floor), rmsN=1 → pMax (loud ceiling)
      const rmsSize = pBase + (pMax - pBase) * rmsN;
      size  = rmsSize * (0.5 + 0.5 * depthScale);
      color = featuresToHSL(centN, zcrR);
      alpha = (0.35 + 0.65 * depthScale) * (0.5 + 0.5 * facing);
    } else {
      // ── Original palette rendering (fallback) ──
      color = _colorBuf[idx[ii]];
      size  = pBase + (pMax - pBase) * depthScale;
      alpha = (0.3 + 0.7 * depthScale) * (0.5 + 0.5 * facing);
    }

    S.ctx.globalAlpha = alpha;
    S.ctx.fillStyle   = color;
    S.ctx.beginPath(); S.ctx.arc(sx, sy, size, 0, Math.PI * 2); S.ctx.fill();
  }

  S.ctx.globalAlpha = 1;

  // ── Active grain highlight (second pass) ──────────────────────────────────
  // Draw a bright dot over every particle that currently has a grain playing.
  // Uses projections cached during the main loop to avoid redundant math.
  if (_glowCache.size > 0) {
    for (const [, { sx, sy, depth, facing }] of _glowCache) {
      const df   = Math.max(0, 1 - (depth / (SPHERE_RADIUS * 2)));
      const size = (PARTICLE_BASE_SIZE + (PARTICLE_MAX_SIZE - PARTICLE_BASE_SIZE) * df) * 1.6;
      S.ctx.globalAlpha = (0.6 + 0.4 * facing) * df;
      S.ctx.fillStyle   = '#ffffff';
      S.ctx.beginPath(); S.ctx.arc(sx, sy, size, 0, Math.PI * 2); S.ctx.fill();
    }
    S.ctx.globalAlpha = 1;
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
    ? '#e83030'
    : SAMPLE_PAINT_COLORS[S.activeSampleIndex >= 0 ? S.activeSampleIndex % SAMPLE_PAINT_COLORS.length : S.sampleColorIndex];

  if (S.nearestMode) {
    const d = 24;
    S.ctx.strokeStyle = painting ? `${color}cc` : `${NEAREST_GLOW_COLOR}99`;
    S.ctx.lineWidth   = painting ? 1.5 : 1;
    S.ctx.setLineDash([4, 5]);
    S.ctx.beginPath();
    S.ctx.moveTo(mx,     my - d);
    S.ctx.lineTo(mx + d, my    );
    S.ctx.lineTo(mx,     my + d);
    S.ctx.lineTo(mx - d, my    );
    S.ctx.closePath();
    S.ctx.stroke();
    S.ctx.setLineDash([]);
  } else if (painting) {
    S.ctx.fillStyle   = `${color}18`;
    S.ctx.beginPath(); S.ctx.arc(mx, my, brushR, 0, Math.PI * 2); S.ctx.fill();
    S.ctx.strokeStyle = `${color}cc`;
    S.ctx.lineWidth   = 1.5;
    S.ctx.beginPath(); S.ctx.arc(mx, my, brushR, 0, Math.PI * 2); S.ctx.stroke();
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
  if (!_coordEl) _coordEl = document.getElementById('coordinates');
  const _animNow = performance.now();
  if (_animLastAt > 0) perf.frameMs = _animNow - _animLastAt;
  _animLastAt = _animNow;
  perfTick();

  // Sample the input analyser every frame so transient peaks between paint
  // events are captured and held for the next snapshotInputFeatures() call.
  tickPeakHold();

  // In physical mode the sensor owns the camera — lock cursor to canvas centre
  // so painting always targets the direction you're facing (straight ahead).
  if (S.spatialMode === 'physical') {
    S.mousePixelX   = S.canvas.width  / 2;
    S.mousePixelY   = S.canvas.height / 2;
    S.mouseX        = 0;
    S.mouseY        = 0;
    S.mouseInCanvas = true;
  }

  // Camera rotation — disabled in physical mode (sensor drives camQ instead)
  if (S.mouseInCanvas && !S.altLocked && !(S.isMobile && S.orientationActive)
      && S.spatialMode !== 'physical') {
    const dist = Math.sqrt(S.mouseX*S.mouseX + S.mouseY*S.mouseY);
    const DEAD_ZONE = 0.30;
    if (dist > DEAD_ZONE) {
      const t     = Math.min((dist - DEAD_ZONE) / (1 - DEAD_ZONE), 1);
      const curve = t * t * t * t;
      const speed = curve * ROTATION_SPEED;
      const nx = S.mouseX / dist, ny = S.mouseY / dist;

      if (Math.abs(nx) > 0.001) {
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
  // Physical mode: sensor drives the camera so the monitor on stage shows your
  // real-world facing direction. The visual rotates with your body.
  // Sim mode: sensor is ignored — mouse/MIDI only. No sensor in simulation.
  if (S.spatialMode === 'physical' && typeof S._getSensorCamQ === 'function') {
    const sq = S._getSensorCamQ();
    if (sq) S.camQ = sq;  // [x, y, z, w]
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
          grainDuration: Math.max(minGrainDurS(), gpr.duration + durVariation),
          source:        'live',
          liveBufferIdx: S.currentLiveBufferIdx,
          grainStart:    Math.max(0, recTime - gpr.duration),
          color:         LIVE_PAINT_COLORS[S.liveColorIndex % LIVE_PAINT_COLORS.length]
        };
        // Snapshot audio features from input analyser (live path)
        const feat = snapshotInputFeatures();
        if (feat) {
          // Noise floor gate — reject particle if signal is just room ambience
          if (S.vizNoiseFloor > 0 && feat.rms < S.vizNoiseFloor) {
            particle = null;
          } else {
            particle.rms = feat.rms; particle.centroid = feat.centroid; particle.zcr = feat.zcr;
          }
        }
      } else if (S.activeSampleIndex >= 0 && S.samples[S.activeSampleIndex] && S.samples[S.activeSampleIndex].buffer) {
        const s          = S.samples[S.activeSampleIndex];
        const cropStart  = s.cropStart * s.duration;
        const cropEnd    = s.cropEnd   * s.duration;
        const cropLen    = cropEnd - cropStart;
        let rawStart      = s.grainCursor;
        if (cropLen > 0) rawStart = cropStart + ((rawStart - cropStart) % cropLen + cropLen) % cropLen;
        const clampedStart = Math.max(cropStart, Math.min(rawStart, cropEnd - 0.01));
        const grainDur     = Math.max(minGrainDurS(), Math.min(gpr.duration + durVariation, cropEnd - clampedStart));

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
        // Snapshot audio features from sample buffer (offline path)
        const feat = featuresFromBuffer(s.buffer, clampedStart);
        if (feat) { particle.rms = feat.rms; particle.centroid = feat.centroid; particle.zcr = feat.zcr; }

        const stride = gpr.period * rand(0.8, 1.2);
        s.grainCursor += stride;
        if (s.grainCursor > cropEnd) s.grainCursor = cropStart + ((s.grainCursor - cropStart) % cropLen);
      }

      if (particle) { stampCartesian(particle); S.particles.push(particle); S._particleVersion++; }
    }
  }

  if (S.isRecording) rebuildLiveBuffer();

  const _frameMs = 1000 / RENDER_TARGET_FPS;
  const now30 = performance.now();
  const elapsed30 = now30 - (animate._lastRenderTime || 0);
  if (elapsed30 >= _frameMs) {
    animate._lastRenderTime = now30 - (elapsed30 % _frameMs);
    drawFrame();
    S.updateWaveformPlayheads?.();

    const { lon, lat } = S.mouseInCanvas ? screenToLonLat(S.mousePixelX, S.mousePixelY) : getCursorLonLat();
    const lonDeg = (lon * 180 / Math.PI).toFixed(1).padStart(7);
    const latDeg = (lat * 180 / Math.PI).toFixed(1).padStart(6);
    if (_coordEl) _coordEl.textContent = `${lonDeg},${latDeg}`;
  }

  // Unified meter tick — runs inside the main RAF loop instead of its own
  S._tickMainMeters?.();

  requestAnimationFrame(animate);
}

// Inline quaternion helpers used in the animate() hot path.
// sphere.js exports the same functions; these local copies avoid the overhead
// of an extra module indirection in the RAF loop.
// All quaternions use [x, y, z, w] convention (scalar w last).
function _qMul(a, b) {
  return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0], a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
}
function _qNorm(q) { const l=Math.sqrt(q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3]); return [q[0]/l,q[1]/l,q[2]/l,q[3]/l]; }
function _qFromAA(ax, ay, az, angle) { const h=angle/2,s=Math.sin(h); return [ax*s,ay*s,az*s,Math.cos(h)]; }
function _qRotVec(q, v) {
  const vq=[v[0],v[1],v[2],0], c=[-q[0],-q[1],-q[2],q[3]];
  const r=_qMul(_qMul(q,vq),c); return [r[0],r[1],r[2]];
}
