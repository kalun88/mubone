// ============================================================================
// RENDERER — draw functions and animation loop
// ============================================================================

import {
  S, BG_COLOR, GRID_COLOR, GRID_SEGMENTS_LON, GRID_SEGMENTS_LAT,
  SPHERE_RADIUS, FOV_DEG, PARTICLE_BASE_SIZE, PARTICLE_MAX_SIZE,
  SAMPLE_PAINT_COLORS, LIVE_PAINT_COLORS, NEAREST_GLOW_COLOR,
  MAX_SEEDS, MAX_SEQS, AUTO_ROTATION_SPEED, ROTATION_SPEED, PAINT_INTERVAL,
  RENDER_TARGET_FPS,
  perf, perfTick, gp, rebuildGrainCurves, minGrainDurS
} from './state.js';
import { spherePoint, cameraTransform, project, getCursorLonLat, screenToLonLat } from './sphere.js';
import { rand, activeGrainMap, stampCartesian, _interpolateMovingSeed } from './grain.js';
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
  drawSeeds();
  S.drawSvLiveOverlay?.();
  drawRadiusTooltip();
  // Meters now drawn by DOM-based startMainMetering() loop in ui-meters.js
  if (typeof S.drawRecencyDial === 'function') S.drawRecencyDial();
  S.drawRadiusViz?.();
  S.updateSeedBanksUI?.();
  S.updateSeqBanksUI?.();
  S._syncSeqControls?.();
}

// ── Seed rendering ───────────────────────────────────────────────────────────
export function drawSeeds() {
  const { lon: curLon, lat: curLat } = S.mouseInCanvas ? screenToLonLat(S.mousePixelX, S.mousePixelY) : getCursorLonLat();
  const nearestSlot = S.findNearestSeedSlot?.(curLon, curLat) ?? -1;
  const W = S.canvas.width, H = S.canvas.height;
  const margin = 14;

  for (let i = 0; i < S.seedSlotCount; i++) {
    const seed = S.seedSlots[i];
    if (!seed) continue;

    const isMoving = seed.frames !== null && seed.frames !== undefined;
    const isNearest = i === nearestSlot;

    // ── Moving seed: draw trail path first (behind the current indicator) ──
    if (isMoving) {
      _drawMovingSeedTrail(seed, i, isNearest);
    }

    // ── Resolve current position (interpolated for moving, static for stationary) ──
    let vizLon, vizLat, vizNearestMode, vizSearchRadiusDeg;
    if (isMoving) {
      const frame = _interpolateMovingSeed(seed);
      if (!frame) continue;
      vizLon = frame.lon;
      vizLat = frame.lat;
      vizNearestMode = frame.nearestMode;
      vizSearchRadiusDeg = frame.searchRadiusDeg;
    } else {
      vizLon = seed.lon;
      vizLat = seed.lat;
      vizNearestMode = seed.nearestMode;
      vizSearchRadiusDeg = seed.searchRadiusDeg;
    }

    const [wx, wy, wz] = spherePoint(vizLon, vizLat);
    const [cx, cy, cz] = cameraTransform(wx, wy, wz);
    const proj = project(cx, cy, cz);

    if (proj) {
      // Envelope gain: modulates visual opacity during attack/release
      const envG = seed._envGainCurrent ?? 1;
      S.ctx.save();
      S.ctx.globalAlpha = (isNearest ? 0.7 : 0.4) * envG;
      S.ctx.strokeStyle = seed.color;
      S.ctx.lineWidth = isNearest ? 2 : 1;
      S.ctx.setLineDash(isMoving ? [2, 3] : [4, 6]);

      if (vizNearestMode) {
        const d = isNearest ? 40 : 32;
        S.ctx.beginPath();
        S.ctx.moveTo(proj.sx,     proj.sy - d);
        S.ctx.lineTo(proj.sx + d, proj.sy    );
        S.ctx.lineTo(proj.sx,     proj.sy + d);
        S.ctx.lineTo(proj.sx - d, proj.sy    );
        S.ctx.closePath();
        S.ctx.stroke();
      } else {
        const rRad    = vizSearchRadiusDeg * Math.PI / 180;
        const fovRad  = (FOV_DEG * Math.PI) / 180;
        const focalLen = (W / 2) / Math.tan(fovRad / 2);
        const screenR  = focalLen * Math.tan(rRad) / (proj.depth / SPHERE_RADIUS);
        S.ctx.beginPath();
        S.ctx.arc(proj.sx, proj.sy, Math.max(12, screenR), 0, Math.PI * 2);
        S.ctx.stroke();
      }
      S.ctx.setLineDash([]);
      // Center dot and label ignore envelope gain — the anchor should be
      // visible immediately when planted, even with slow attack envelopes.
      // The radius circle/diamond above still fades with envG.
      S.ctx.globalAlpha = isNearest ? 1 : 0.6;
      S.ctx.fillStyle = seed.color;
      const centerDotR = isMoving ? 3 : 6;
      S.ctx.beginPath(); S.ctx.arc(proj.sx, proj.sy, centerDotR, 0, Math.PI * 2); S.ctx.fill();
      S.ctx.globalAlpha = isNearest ? 0.9 : 0.5;
      S.ctx.fillStyle = seed.color;
      S.ctx.font = `10px "Roboto Mono", monospace`;
      S.ctx.textAlign = 'center';
      S.ctx.textBaseline = 'middle';
      S.ctx.fillText(i + 1, proj.sx, proj.sy - 12);
      S.ctx.restore();
    }

    // ── Edge indicators (off-screen seed markers) ──
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
      S.ctx.fillStyle   = seed.color;
      S.ctx.beginPath();
      S.ctx.arc(ex, ey, dotR, 0, Math.PI * 2);
      S.ctx.fill();
      if (fadeT > 0.6) {
        S.ctx.globalAlpha  = alpha * 0.8;
        S.ctx.fillStyle    = seed.color;
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

  // ── Live recording trail (draw path as it's being recorded) ──
  _drawLiveRecordingTrail();
}

// ── Shared velocity-dot trail renderer ──────────────────────────────────────
// Draws dots along a frame array with spacing proportional to cursor speed.
// Fast → wide gaps, slow → tight dots.  Used by both live + finalized trails.
function _drawVelocityDotTrail(frames, color, alpha, dotR, maxSamples) {
  if (!frames || frames.length < 2) return;

  S.ctx.save();
  S.ctx.fillStyle   = color;
  S.ctx.globalAlpha = alpha;

  // Velocity → spacing mapping (aggressive so the difference is obvious)
  const minPx    = 5;    // tightest packing when nearly still
  const velScale = 3.0;  // px per (deg/s) — big multiplier for visible effect
  const maxPx    = 60;   // cap

  const step = Math.max(1, Math.floor(frames.length / maxSamples));

  let prevProj = null, prevT = frames[0].t;
  let prevLon = frames[0].lon, prevLat = frames[0].lat;
  let accumDist = 0, curSpacing = minPx;

  for (let fi = 0; fi < frames.length; fi += step) {
    const f = frames[fi];
    const [wx, wy, wz] = spherePoint(f.lon, f.lat);
    const [cx, cy, cz] = cameraTransform(wx, wy, wz);
    const proj = project(cx, cy, cz);
    if (!proj) { prevProj = null; continue; }

    if (prevProj) {
      const dx = proj.sx - prevProj.sx;
      const dy = proj.sy - prevProj.sy;
      const segLen = Math.sqrt(dx * dx + dy * dy);

      // Angular speed (deg/s)
      const dt = f.t - prevT;
      if (dt > 0) {
        const dLon = f.lon - prevLon;
        const dLat = f.lat - prevLat;
        const degDist = Math.sqrt(dLon * dLon + dLat * dLat);
        const speed = (degDist / dt) * 1000;
        curSpacing = Math.min(maxPx, minPx + velScale * speed);
      }

      accumDist += segLen;

      // Place dots along segment
      if (segLen > 0) {
        const nx = dx / segLen, ny = dy / segLen;
        while (accumDist >= curSpacing) {
          accumDist -= curSpacing;
          const bx = proj.sx - nx * accumDist;
          const by = proj.sy - ny * accumDist;
          S.ctx.beginPath();
          S.ctx.arc(bx, by, dotR, 0, Math.PI * 2);
          S.ctx.fill();
        }
      }
    } else {
      // First visible point
      S.ctx.beginPath();
      S.ctx.arc(proj.sx, proj.sy, dotR, 0, Math.PI * 2);
      S.ctx.fill();
      accumDist = 0;
    }

    prevProj = proj; prevT = f.t; prevLon = f.lon; prevLat = f.lat;
  }

  // Ensure last frame included
  const last = frames[frames.length - 1];
  const [lwx, lwy, lwz] = spherePoint(last.lon, last.lat);
  const [lcx, lcy, lcz] = cameraTransform(lwx, lwy, lwz);
  const lastProj = project(lcx, lcy, lcz);

  // Start + end markers
  // Start dot is large (matches stationary seed size) — this is the anchor
  // point used for nearest-seed distance calculations on moving seeds.
  // End dot stays small so it's visually distinct.
  S.ctx.globalAlpha = Math.min(1, alpha + 0.15);
  const first = frames[0];
  const [fwx, fwy, fwz] = spherePoint(first.lon, first.lat);
  const [fcx, fcy, fcz] = cameraTransform(fwx, fwy, fwz);
  const firstProj = project(fcx, fcy, fcz);
  if (firstProj) {
    S.ctx.beginPath(); S.ctx.arc(firstProj.sx, firstProj.sy, 6, 0, Math.PI * 2); S.ctx.fill();
  }
  if (lastProj) {
    S.ctx.beginPath(); S.ctx.arc(lastProj.sx, lastProj.sy, 3, 0, Math.PI * 2); S.ctx.fill();
  }

  S.ctx.restore();
}

// ── Live recording trail ────────────────────────────────────────────────────
// While the user holds ↓ and moves, draw the in-progress path in real time.
function _drawLiveRecordingTrail() {
  const frames = S._seedRecordingFrames;
  if (!frames || frames.length < 2) return;
  const slot = S._seedRecordingSlot;
  const seed = slot >= 0 ? S.seedSlots[slot] : null;
  const color = seed ? seed.color : '#ffffff';
  _drawVelocityDotTrail(frames, color, 0.7, 2.5, 50);
}

// ── Moving seed trail ──────────────────────────────────────────────────────
// Delegates to the shared velocity-dot renderer.
function _drawMovingSeedTrail(seed, slotIndex, isNearest) {
  const alpha = isNearest ? 0.7 : 0.45;
  _drawVelocityDotTrail(seed.frames, seed.color, alpha, 2.5, 50);
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

// ── Radius readout (persistent ghost below cursor, flashes on change) ────────
export function drawRadiusTooltip() {
  if (!S.mouseInCanvas && !S.altLocked) return;

  const mx = (S.mouseInCanvas || S.altLocked) ? S.mousePixelX : S.canvas.width  / 2;
  const my = (S.mouseInCanvas || S.altLocked) ? S.mousePixelY : S.canvas.height / 2;

  // Compute brush radius for offset positioning
  const searchRadiusRad = S.searchRadiusDeg * Math.PI / 180;
  const fovRad   = (FOV_DEG * Math.PI) / 180;
  const focalLen = (S.canvas.width / 2) / Math.tan(fovRad / 2);
  const brushR   = S.nearestMode ? 28
    : searchRadiusRad < Math.PI / 2
      ? focalLen * Math.tan(searchRadiusRad)
      : S.canvas.width * 0.8;

  const label = S.nearestMode ? 'snap' : `${S.searchRadiusDeg}°`;
  const fs    = 9;

  // Flash calculation — brighter on change, fades to ghost
  const now       = performance.now();
  const flashLeft = S.radiusTooltipUntil - now;
  const flashFade = 600;
  const baseAlpha = 0.20;
  const alpha     = flashLeft > 0
    ? baseAlpha + (0.65 * Math.min(1, flashLeft / flashFade))
    : baseAlpha;

  // Position: centered below the radius circle
  const py = my + Math.max(brushR + 14, 28);

  S.ctx.save();
  S.ctx.globalAlpha  = alpha;
  S.ctx.font         = `${fs}px "Roboto Mono", monospace`;
  S.ctx.textAlign    = 'center';
  S.ctx.textBaseline = 'top';
  S.ctx.fillStyle    = S.nearestMode ? '#b8a0ff' : '#ffffff';
  S.ctx.fillText(label, mx, py);
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
  // When scan is off, cursor-triggered grains render as black/transparent
  // to visually distinguish them from seed-triggered grains (which stay white).
  if (_glowCache.size > 0) {
    const scanOff = S.scanMuted;
    for (const [particle, { sx, sy, depth, facing }] of _glowCache) {
      const df   = Math.max(0, 1 - (depth / (SPHERE_RADIUS * 2)));
      const size = (PARTICLE_BASE_SIZE + (PARTICLE_MAX_SIZE - PARTICLE_BASE_SIZE) * df) * 1.6;
      const entry = activeGrainMap.get(particle);
      const isCursorGrain = entry && entry.glowColor === '#ffffff';
      if (scanOff && isCursorGrain) {
        // Scan off cursor grains: faint white — still visible but clearly quieter
        S.ctx.globalAlpha = (0.15 + 0.1 * facing) * df;
      } else {
        // Seed grains + scan-active cursor grains: near-opaque white
        S.ctx.globalAlpha = (0.75 + 0.25 * facing) * df;
      }
      S.ctx.fillStyle = '#ffffff';
      S.ctx.beginPath(); S.ctx.arc(sx, sy, size, 0, Math.PI * 2); S.ctx.fill();
    }
    S.ctx.globalAlpha = 1;
  }

  // ── Sequential playhead indicators ────────────────────────────────────────
  // Ring around the current playhead particle for each active sequence.
  for (let ti = 0; ti < S.seqSlotCount; ti++) {
    const seq = S.seqSlots[ti];
    if (!seq || !seq.playing || !seq.particles.length) continue;
    const p = seq.particles[seq.playheadIndex];
    if (!p) continue;
    const [wx, wy, wz] = spherePoint(p.lon, p.lat);
    const [cx, cy, cz] = cameraTransform(wx, wy, wz);
    const proj = project(cx, cy, cz);
    if (!proj || proj.depth > SPHERE_RADIUS * 2) continue;
    const facing = Math.max(0, 1 - proj.depth / SPHERE_RADIUS);
    const df = Math.max(0, 1 - (proj.depth / (SPHERE_RADIUS * 2)));
    const size = (PARTICLE_BASE_SIZE + (PARTICLE_MAX_SIZE - PARTICLE_BASE_SIZE) * df) * 2.2;
    S.ctx.globalAlpha = (0.6 + 0.4 * facing) * df;
    S.ctx.strokeStyle = seq.color;
    S.ctx.lineWidth = 2;
    S.ctx.beginPath(); S.ctx.arc(proj.sx, proj.sy, size, 0, Math.PI * 2); S.ctx.stroke();
    S.ctx.globalAlpha = 1;
  }

  // ── Sequence anchor markers ──────────────────────────────────────────────
  // Ring + dot + slot number at each sequence's anchor position.
  // Uses anchorLon/anchorLat (drop point for D-drops, first particle for strokes).
  for (let si = 0; si < S.seqSlotCount; si++) {
    const seq = S.seqSlots[si];
    if (!seq) continue;
    const aLon = seq.anchorLon ?? seq.particles[0]?.lon;
    const aLat = seq.anchorLat ?? seq.particles[0]?.lat;
    if (aLon == null || aLat == null) continue;
    const [wx, wy, wz] = spherePoint(aLon, aLat);
    const [cx, cy, cz] = cameraTransform(wx, wy, wz);
    const proj = project(cx, cy, cz);
    if (!proj || proj.depth > SPHERE_RADIUS * 2) continue;
    const df = Math.max(0, 1 - (proj.depth / (SPHERE_RADIUS * 2)));
    const a = (seq.playing ? 0.9 : 0.4) * df;
    const x = proj.sx, y = proj.sy;

    S.ctx.save();
    S.ctx.globalAlpha = a;
    // Ring
    S.ctx.strokeStyle = seq.color;
    S.ctx.lineWidth = 2.5;
    S.ctx.beginPath(); S.ctx.arc(x, y, 14, 0, Math.PI * 2); S.ctx.stroke();
    // Filled center dot
    S.ctx.fillStyle = seq.color;
    S.ctx.beginPath(); S.ctx.arc(x, y, 4, 0, Math.PI * 2); S.ctx.fill();
    // Slot number
    S.ctx.font = 'bold 11px "Roboto Mono", monospace';
    S.ctx.textAlign = 'center';
    S.ctx.textBaseline = 'middle';
    S.ctx.fillText(si + 1, x, y - 20);
    // Pause icon
    if (!seq.playing) {
      S.ctx.fillStyle = seq.color + '88';
      const bw = 2.5, bh = 7;
      S.ctx.fillRect(x - bw - 1.5, y - bh / 2, bw, bh);
      S.ctx.fillRect(x + 1.5, y - bh / 2, bw, bh);
    }
    S.ctx.restore();
  }
}

// ── Cursor ────────────────────────────────────────────────────────────────────
//
// Redesigned "Mode Ring" HUD — 3 concentric zones:
//   Zone 1  Center reticle  — crosshair + dot (white idle, paint color, red record)
//   Zone 2  Mode Ring       — 4 arc segments at ~14px radius:
//             Top    = scan off           (amber #e8a030)
//             Bottom = loop lock on       (pink  #ff6b9d)
//             Right  = patch number       (white, always shown, flashes on change)
//             Left   = seed tether on     (violet #b8a0ff)
//   Zone 3  Radius circle   — search radius (solid, minimal)
//
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

  // Center-of-canvas anchor dot (always visible)
  S.ctx.fillStyle = 'rgba(255,255,255,0.25)';
  S.ctx.beginPath(); S.ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); S.ctx.fill();

  if (!S.mouseInCanvas && !S.altLocked) { S.ctx.restore(); return; }

  const painting    = S.isPainting;
  const scanOff = S.scanMuted;
  const recording   = S.isRecording;
  const color       = recording
    ? '#e83030'
    : SAMPLE_PAINT_COLORS[S.activeSampleIndex >= 0 ? S.activeSampleIndex % SAMPLE_PAINT_COLORS.length : S.sampleColorIndex];

  // ─── ZONE 3: Radius circle ─────────────────────────────────────────────

  // Scan off uses amber tint matching the scan button, otherwise neutral grey
  const _rFill   = scanOff ? 'rgba(232,160,48,0.10)' : 'rgba(180,180,180,0.10)';
  const _rStroke = scanOff ? 'rgba(232,160,48,0.55)' : 'rgba(200,200,200,0.55)';

  const kAll = S.grainKAllMode;

  if (S.nearestMode) {
    // Snap/nearest: big diamond shape
    const d = 40;
    S.ctx.fillStyle = _rFill;
    S.ctx.beginPath();
    S.ctx.moveTo(mx, my - d); S.ctx.lineTo(mx + d, my); S.ctx.lineTo(mx, my + d); S.ctx.lineTo(mx - d, my);
    S.ctx.closePath();
    S.ctx.fill();
    S.ctx.strokeStyle = _rStroke;
    S.ctx.lineWidth   = 1.5;
    // k-all: solid line — everything fires. Normal: dashed
    if (kAll) {
      S.ctx.stroke();
    } else {
      S.ctx.setLineDash([5, 5]);
      S.ctx.stroke();
      S.ctx.setLineDash([]);
    }
  } else {
    // Radius circle
    S.ctx.fillStyle = _rFill;
    S.ctx.beginPath(); S.ctx.arc(mx, my, brushR, 0, Math.PI * 2); S.ctx.fill();
    S.ctx.strokeStyle = _rStroke;
    S.ctx.lineWidth   = 1.5;
    // k-all: solid line — everything in radius fires. Normal: dashed
    if (kAll) {
      S.ctx.beginPath(); S.ctx.arc(mx, my, brushR, 0, Math.PI * 2); S.ctx.stroke();
    } else {
      S.ctx.setLineDash([5, 5]);
      S.ctx.beginPath(); S.ctx.arc(mx, my, brushR, 0, Math.PI * 2); S.ctx.stroke();
      S.ctx.setLineDash([]);
    }
  }

  // ─── ZONE 2: Mode Ring (4 arc segments) ────────────────────────────────

  const ringR   = S.modeRingSize || 30;   // user-adjustable via viz settings
  const arcW    = 3.5;     // thick strokes — readable from across the room
  const gap     = 0.18;    // radians gap between arcs (~10°)

  // Arc spans (in radians, 0 = 3-o'clock)
  // Top:    from -135° to -45°  (NW to NE)
  // Right:  from  -45° to  45°  (NE to SE)
  // Bottom: from   45° to 135°  (SE to SW)
  // Left:   from  135° to 225°  (SW to NW)
  const ARC_TOP    = [(-3 * Math.PI / 4) + gap, (-Math.PI / 4) - gap];
  const ARC_RIGHT  = [(-Math.PI / 4) + gap,     (Math.PI / 4)  - gap];
  const ARC_BOTTOM = [(Math.PI / 4) + gap,      (3 * Math.PI / 4) - gap];
  const ARC_LEFT   = [(3 * Math.PI / 4) + gap,  (5 * Math.PI / 4) - gap];

  // Top arc — SCAN OFF (orange)
  if (scanOff) {
    S.ctx.strokeStyle = '#e8a030';
    S.ctx.lineWidth   = arcW;
    S.ctx.globalAlpha = 0.95;
    S.ctx.beginPath(); S.ctx.arc(mx, my, ringR, ARC_TOP[0], ARC_TOP[1]); S.ctx.stroke();
    S.ctx.globalAlpha = 1;
  }

  // Left arc — SEED LOCK (sage green)
  if (S.seedLockEnabled) {
    S.ctx.strokeStyle = '#6ec97a';
    S.ctx.lineWidth   = arcW;
    S.ctx.globalAlpha = 0.95;
    S.ctx.beginPath(); S.ctx.arc(mx, my, ringR, ARC_LEFT[0], ARC_LEFT[1]); S.ctx.stroke();
    S.ctx.globalAlpha = 1;
  }

  // Right arc — LOOP LOCK / draw loop active (pink)
  if (S.seqModeEnabled) {
    S.ctx.strokeStyle = '#ff6b9d';
    S.ctx.lineWidth   = arcW;
    S.ctx.globalAlpha = 0.95;
    S.ctx.beginPath(); S.ctx.arc(mx, my, ringR, ARC_RIGHT[0], ARC_RIGHT[1]); S.ctx.stroke();
    S.ctx.globalAlpha = 1;
  }

  // Bottom position — PATCH NUMBER (always visible, flashes on change)
  {
    const now       = performance.now();
    const flashLeft = (S._patchFlashUntil || 0) - now;
    const flashFade = 800;
    const baseAlpha = 0.30;
    const flashAlpha = flashLeft > 0
      ? baseAlpha + (0.70 * Math.min(1, flashLeft / flashFade))
      : baseAlpha;

    const patchNum  = (S.activePresetIndex ?? 0) + 1;
    const patchStr  = String(patchNum);
    // Scale font with ring size — readable at distance
    const fs        = Math.max(11, Math.round(ringR * 0.55));

    // Position: below cursor at ringR distance
    const px = mx;
    const py = my + ringR + 2;

    S.ctx.save();
    S.ctx.globalAlpha  = flashAlpha;
    S.ctx.font         = `700 ${fs}px "Inter", "Helvetica Neue", sans-serif`;
    S.ctx.textAlign    = 'center';
    S.ctx.textBaseline = 'top';
    S.ctx.fillStyle    = '#ffffff';
    S.ctx.fillText(patchStr, px, py);
    S.ctx.restore();
  }

  // ─── ZONE 1: Center reticle ────────────────────────────────────────────

  const tipR = 5, armLen = 12, armGap = tipR + 3;

  // Outer ring — white normally, solid red when recording
  S.ctx.strokeStyle = recording
    ? 'rgba(232,48,48,0.95)'
    : painting ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)';
  S.ctx.lineWidth   = 2;
  S.ctx.beginPath(); S.ctx.arc(mx, my, tipR, 0, Math.PI * 2); S.ctx.stroke();

  // Center dot — solid red when recording, paint color when painting, white idle
  if (recording) {
    S.ctx.fillStyle = 'rgba(232,48,48,0.95)';
    S.ctx.beginPath(); S.ctx.arc(mx, my, tipR * 0.55, 0, Math.PI * 2); S.ctx.fill();
  } else {
    S.ctx.fillStyle = painting ? color : 'rgba(255,255,255,0.8)';
    S.ctx.beginPath(); S.ctx.arc(mx, my, tipR * 0.45, 0, Math.PI * 2); S.ctx.fill();
  }

  // Crosshair arms — thick, visible from across the room
  S.ctx.strokeStyle = painting ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.4)';
  S.ctx.lineWidth   = 1.5;
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

  // In sensor or surface mode, lock cursor to canvas centre
  // so painting always targets straight ahead / the center.
  if (S.cameraMode === 'sensor' || S.cameraMode === 'surface') {
    S.mousePixelX   = S.canvas.width  / 2;
    S.mousePixelY   = S.canvas.height / 2;
    S.mouseX        = 0;
    S.mouseY        = 0;
    S.mouseInCanvas = true;
  }

  // Camera rotation — only in 'pull' mode (mouse pull-from-center)
  if (S.cameraMode === 'pull') {
    if (S.mouseInCanvas && !S.altLocked && !(S.isMobile && S.orientationActive)) {
      const dist = Math.sqrt(S.mouseX*S.mouseX + S.mouseY*S.mouseY);
      const DEAD_ZONE = 0.30;
      if (dist > DEAD_ZONE) {
        const t     = Math.min((dist - DEAD_ZONE) / (1 - DEAD_ZONE), 1);
        const curve = t * t * t * t;
        const speed = curve * ROTATION_SPEED;
        const nx = S.mouseX / dist, ny = S.mouseY / dist;

        if (Math.abs(nx) > 0.001 && !S.axisLockAz) {
          const up = _qRotVec(S.camQ, [0, 1, 0]);
          const yawSign = up[1] < 0 ? -1 : 1;
          const qYaw = _qFromAA(0, 1, 0, nx * speed * yawSign);
          S.camQ = _qNorm(_qMul(qYaw, S.camQ));
        }
        if (Math.abs(ny) > 0.001 && !S.axisLockEl) {
          const qPitch = _qFromAA(1, 0, 0, ny * speed);
          S.camQ = _qNorm(_qMul(S.camQ, qPitch));
        }
      }
    } else if (!S.altLocked) {
      const qAuto = _qFromAA(0, 1, 0, AUTO_ROTATION_SPEED);
      S.camQ = _qNorm(_qMul(qAuto, S.camQ));
    }
  }

  // ── Surface mode: pointer-lock deltas → sphere direct mapping ────────────
  // S._surfaceInput is set by events.js (accumulated pointer-lock movementX/Y).
  // { nx, ny } are virtual cursor coords in [-1, +1], persisted across lock cycles.
  if (S.cameraMode === 'surface' && S._surfaceInput) {
    let { nx, ny } = S._surfaceInput;
    // Axis lock: freeze the locked component at the moment lock was engaged
    if (S.axisLockAz) {
      if (S._axisLockFrozenNx == null) S._axisLockFrozenNx = nx;
      nx = S._axisLockFrozenNx;
    } else { S._axisLockFrozenNx = null; }
    if (S.axisLockEl) {
      if (S._axisLockFrozenNy == null) S._axisLockFrozenNy = ny;
      ny = S._axisLockFrozenNy;
    } else { S._axisLockFrozenNy = null; }
    // Map virtual position to lon/lat:
    // nx: unbounded → continuous yaw (right = look right, wraps around)
    // ny: -1..+1 → full 180° pitch (up = look up, clamped at poles)
    const lon = nx * Math.PI;
    const lat = -ny * Math.PI / 2;
    // Convert lon/lat to a look-at quaternion
    const qYaw   = _qFromAA(0, 1, 0, lon);
    const qPitch = _qFromAA(1, 0, 0, -lat);
    S.camQ = _qNorm(_qMul(qYaw, qPitch));
  }

  // ── BNO085 sensor override ─────────────────────────────────────────────────
  // Sensor mode: sensor drives the camera so the monitor on stage shows your
  // real-world facing direction. The visual rotates with your body.
  if (S.cameraMode === 'sensor' && typeof S._getSensorCamQ === 'function') {
    const sq = S._getSensorCamQ();
    if (sq) {
      if (S.axisLockAz || S.axisLockEl) {
        // Decompose sensor quat into yaw (azimuth) and pitch (elevation)
        // Forward vector from quaternion
        const fwd = _qRotVec(sq, [0, 0, 1]);
        let yaw   = Math.atan2(fwd[0], fwd[2]);
        let pitch  = Math.asin(Math.max(-1, Math.min(1, -fwd[1])));
        if (S.axisLockAz) {
          if (S._axisLockFrozenYaw == null) S._axisLockFrozenYaw = yaw;
          yaw = S._axisLockFrozenYaw;
        } else { S._axisLockFrozenYaw = null; }
        if (S.axisLockEl) {
          if (S._axisLockFrozenPitch == null) S._axisLockFrozenPitch = pitch;
          pitch = S._axisLockFrozenPitch;
        } else { S._axisLockFrozenPitch = null; }
        const qY = _qFromAA(0, 1, 0, yaw);
        const qP = _qFromAA(1, 0, 0, pitch);
        S.camQ = _qNorm(_qMul(qY, qP));
      } else {
        S._axisLockFrozenYaw = null;
        S._axisLockFrozenPitch = null;
        S.camQ = sq;
      }
    }
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
    try { drawFrame(); } catch (e) { console.error('drawFrame error:', e); }
    S.updateWaveformPlayheads?.();

    const { lon, lat } = S.mouseInCanvas ? screenToLonLat(S.mousePixelX, S.mousePixelY) : getCursorLonLat();
    const lonDeg = (lon * 180 / Math.PI).toFixed(1).padStart(7);
    const latDeg = (lat * 180 / Math.PI).toFixed(1).padStart(6);
    if (_coordEl) _coordEl.textContent = `${lonDeg}°,${latDeg}°`;
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
