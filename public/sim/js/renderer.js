// ============================================================================
// RENDERER — draw functions and animation loop
// ============================================================================

import {
  S, SPHERE_PALETTE, GRID_SEGMENTS_LON, GRID_SEGMENTS_LAT,
  SPHERE_RADIUS, FOV_DEG, PARTICLE_BASE_SIZE, PARTICLE_MAX_SIZE,
  SAMPLE_PAINT_COLORS, livePaintColor, MAX_SEEDS, AUTO_ROTATION_SPEED, ROTATION_SPEED,
  RENDER_TARGET_FPS, GRAIN_SCHEDULER_INTERVAL_MS,
  perf, perfTick, gp, minGrainDurS, axisHeld,
  SENSOR_CAM_SWING_DEG_S, SENSOR_CAM_OVERSHOOT_DEG, SENSOR_CAM_TELEPORT_DEG
} from './state.js';
import { project, projectInto, updateProjectionCache, getCursorLonLat, screenToLonLat, updateFusedCamQ, cameraTransformInto, spherePointInto, camOffsetZ } from './sphere.js';
import { syncParticleMarks } from './composer.js';
import { pinAnchorInto } from './pins.js';
const _anchorR = [0, 0];
import { activeGrainMap, GLOW_MIN_MS, stampCartesian, refreshCloudClaims, isCloudClaimed, masterPhaseWall, overdubHeads } from './grain.js';
import { claimedStrokeIds } from './trigger.js';
import { tickMappings } from './sensor-mapping.js';
import { rebuildLiveBuffer } from './audio.js';
import { normalise, normaliseCentroid, featuresToColor, tickPeakHold, CQ_HUE, CQ_SAT } from './audio-features.js';

// All VU metering moved to ui-meters.js (DOM-based, shared with audio settings modal).

// Cached DOM element for per-frame coordinate display
let _coordEl = null;

// ── Main draw frame ───────────────────────────────────────────────────────────
export function drawFrame() {
  // Pre-compute fused camera quaternion once per frame — all subsequent
  // cameraTransformInto calls use a single rotation instead of two.
  updateFusedCamQ();
  // Cache focalLen + canvas half-dimensions for zero-alloc projectInto().
  updateProjectionCache();

  S.ctx.fillStyle = (S.darkMode ? SPHERE_PALETTE.dark : SPHERE_PALETTE.light).ink;
  S.ctx.fillRect(0, 0, S.canvas.width, S.canvas.height);

  // Cursor lon/lat resolved once per frame, before anything that needs it.
  // drawCursor() used to be the only writer of the cursor's screen position,
  // and it runs after drawParticles() — so earlier passes read a stale frame.
  {
    // The grain filter's first version froze the cursor here, because it
    // edited the one stroke underneath it. It does not any more (#284/#292):
    // it targets nothing and writes nothing, so the cursor just moves.
    const { lon, lat } = S.cursorQ ? getCursorLonLat()
      : S.mouseInCanvas ? screenToLonLat(S.mousePixelX, S.mousePixelY) : getCursorLonLat();
    S._frameCursorLon = lon;
    S._frameCursorLat = lat;
    // perfMode never draws the trail, so don't pay to accumulate one.
    if (S.gazeTrailSec > 0 && !S.perfMode) {
      const now = performance.now() / 1000;
      // Only when the cursor MOVED. A still cursor used to append a coincident
      // point every frame, and round line caps turned the pile into a bright
      // dot (see drawGazeTrail). A wake that shortens while you hold still is
      // also the truthful reading of a motion cue.
      const last = S.gazeTrail[S.gazeTrail.length - 1];
      if (!last || Math.abs(lon - last.lon) + Math.abs(lat - last.lat) > TRAIL_MIN_RAD)
        S.gazeTrail.push({ lon, lat, t: now });
      while (S.gazeTrail.length && now - S.gazeTrail[0].t > S.gazeTrailSec) S.gazeTrail.shift();
    } else if (S.gazeTrail.length) {
      S.gazeTrail.length = 0;
    }
  }

  if (S.perfMode) {
    // ── Minimal render: reference lines, particles, anchors, cursor, edge bar ──
    drawGridLines();         // respects perfMode internally — equator + meridian only
    drawParticlesMinimal();
    drawSeedAnchorsMinimal();
    drawCursor();
    S.updateSeedBanksUI?.();
    return;
  }

  drawGridLines();
  drawParticles();
  S.updateLiveGranulatingIndicator?.();
  drawTetherLine();
  drawGazeTrail();          // under the cursor, over the particles
  drawCursor();
  drawSeeds();
  drawRadiusTooltip();
  // Meters now drawn by DOM-based startMainMetering() loop in ui-meters.js
  // Recency dial removed — visual clutter, recency-N controlled via slider/OSC
  S.updateSeedBanksUI?.();  // unified: both aliases point to updateCommitBanksUI
  S._syncSeqControls?.();
}

// ── Seed rendering ───────────────────────────────────────────────────────────
// Budget: max trail projections per frame.  Each trail gets
// floor(budget / movingCount) samples; excess seeds get no trail.
// Lowered from 200→120 after switching to batched canvas fills +
// zero-alloc projectInto — fewer samples needed for same visual
// density, and the per-projection cost is now much lower.
const _TRAIL_BUDGET = 120;
// Below this much cursor movement (radians, L1) no trail point is recorded —
// ~0.06° , comfortably under a pixel at any FOV the app offers.
const TRAIL_MIN_RAD = 0.001;

// ── The anchor mark ─────────────────────────────────────────────────────────
// ONE mark for every pin, at its ANCHOR (pins.js pinAnchorInto — where the
// gesture released): a ring, a dot, the slot number, pause bars when the pin
// is not playing. A stationary cloud adds its reach circle around it; a
// moving cloud's reach travels with its head, so its anchor is the mark
// alone (Ek, 2026-09-05: "make consistent all the anchors and what they look
// like … anchors should only be dropped at the end of the path"). Nothing is
// drawn at the anchor while the pin gesture is still held — the anchor does
// not exist until the release.
// ── THE SELECTED PIN, on the sphere (Ek, 2026-09-13) ────────────────────────
// "besides the pinned item being selected and highlighted in the right side
// rail, i want there to be some indication on what's highlighted in the viz
// sphere."
//
// Four corner brackets — a camera's focus frame. Chosen over the alternatives
// for reasons that are the design system's, not taste:
//
//   · It is a NEW SHAPE. The sphere already spends a circle on reach and a dot
//     on a mark; a fifth ring would have to be read against those two. Corners
//     belong to nothing else here, so they can only mean "this one".
//   · It does not close, so it never competes with the reach ring it frames.
//   · It is the viewfinder convention, which is a reference rather than an
//     invention — the instrument should not teach a new sign for "selected".
//   · It is drawn, not dimmed. Marking the selection by fading the other pins
//     was the obvious move and is the one DESIGN-SYSTEM forbids: never dim to
//     mean anything.
//
// Bone (`--eng-pins`), because this says PINNED, not which engine made it —
// the pin keeps its own hue inside the frame. It is drawn for a cloud and for
// a loop: the loop passes knew nothing about the selection before this, so
// selecting a loop in the rail changed nothing on the sphere at all.
// r 30, not 22: a loop pin already stacks a 4px core, a 14px anchor ring and a
// playhead square whose half-size reaches 20 at the near depth, and a frame at
// 22 landed inside that pile (measured on a rig, 2026-09-13). 30 clears all
// three, so the corners read as a frame AROUND the pin rather than another
// ring in it. Arms 8, so each corner is a quarter of its side and the gaps
// stay wide enough that it never closes into a square.
const FOCUS_R   = 30;
const FOCUS_ARM = 8;          // the length of each leg of a corner
// Read once per theme, not per frame: this runs inside the render loop and a
// getComputedStyle there is exactly the kind of per-frame cost CLAUDE.md's
// render-path rules exist to keep out.
let _focusInk = null, _focusInkDark = null;
function FOCUS_INK() {
  if (_focusInk && _focusInkDark === S.darkMode) return _focusInk;
  _focusInk = getComputedStyle(document.body).getPropertyValue('--eng-pins').trim() || '#cfc7bc';
  _focusInkDark = S.darkMode;
  return _focusInk;
}
// Cursor ink comes from tokens (ruled 2026-09-14). The invariant: the tile you
// pressed and the mark under your hand are the same colour BY CONSTRUCTION, not
// by two lists agreeing. Cached for the same reason FOCUS_INK is — this runs
// per frame and getComputedStyle is a layout read, on the thread the grain
// scheduler shares.
const _tokCache = new Map();
function _tok(name, fallback) {
  let v = _tokCache.get(name);
  if (v === undefined) {
    v = getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
    _tokCache.set(name, v);
  }
  return v;
}
export function flushCursorTokens() { _tokCache.clear(); }
// The one event that can change what a token resolves to. FOCUS_INK keys its
// own cache on S.darkMode; this cache has no such key, so it is flushed here
// rather than left to go stale the way a second copy of a colour always does.
window.addEventListener('mubone-theme', flushCursorTokens);

function _drawFocusBracket(x, y, r, alpha, color) {
  const c = S.ctx;
  c.save();
  c.globalAlpha = alpha;
  c.strokeStyle = color;
  c.lineWidth = 1.6;
  c.lineCap = 'round';
  c.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const cx = x + sx * r, cy = y + sy * r;
    c.moveTo(cx - sx * FOCUS_ARM, cy); c.lineTo(cx, cy);      // the horizontal leg
    c.lineTo(cx, cy - sy * FOCUS_ARM);                        // the vertical leg
  }
  c.stroke();
  c.restore();
}

function _drawAnchorMark(x, y, color, alpha, label, paused) {
  S.ctx.save();
  S.ctx.globalAlpha = alpha;
  S.ctx.strokeStyle = color;
  S.ctx.lineWidth = 2.5;
  S.ctx.beginPath(); S.ctx.arc(x, y, 14, 0, Math.PI * 2); S.ctx.stroke();
  S.ctx.fillStyle = color;
  S.ctx.beginPath(); S.ctx.arc(x, y, 4, 0, Math.PI * 2); S.ctx.fill();
  S.ctx.font = 'bold 11px Urbanist, sans-serif';
  S.ctx.textAlign = 'center';
  S.ctx.textBaseline = 'middle';
  S.ctx.fillText(label, x, y - 20);
  if (paused) {
    S.ctx.fillStyle = color + '88';
    const bw = 2.5, bh = 7;
    S.ctx.fillRect(x - bw - 1.5, y - bh / 2, bw, bh);
    S.ctx.fillRect(x + 1.5, y - bh / 2, bw, bh);
  }
  S.ctx.restore();
}

export function drawSeeds() {
  const { lon: curLon, lat: curLat } = S.cursorQ ? getCursorLonLat()
    : S.mouseInCanvas ? screenToLonLat(S.mousePixelX, S.mousePixelY) : getCursorLonLat();
  // The highlighted cloud is the SELECTED pin — nearest or oldest by
  // Settings → Pins — the same one the rail marks and unpin takes.
  const nearestSlot = S._selectedPinSlot?.(curLon, curLat) ?? -1;
  const W = S.canvas.width, H = S.canvas.height;
  const margin = 14;

  // Count moving seeds to budget trail draws
  let movingCount = 0;
  for (let i = 0; i < S.commitSlotCount; i++) {
    const s = S.commitSlots[i];
    if (s && s.type === 'cloud' && s.frames) movingCount++;
  }
  // Per-seed trail sample budget (0 = skip trails entirely).
  // Cap at 40 per trail — visually indistinguishable from 50 but saves
  // ~20% projection work when only 1–2 seeds are moving.
  const trailSamples = movingCount > 0
    ? Math.min(40, Math.floor(_TRAIL_BUDGET / movingCount))
    : 0;

  for (let i = 0; i < S.commitSlotCount; i++) {
    const seed = S.commitSlots[i];
    if (!seed || seed.type !== 'cloud') continue;

    const isMoving = seed.frames !== null && seed.frames !== undefined;
    const isNearest = i === nearestSlot;

    // ── Resolve current position ───────────────────────────────────────
    // Moving seeds: reuse _currentFrame written by grain scheduler (avoids
    // redundant binary search + interpolation per frame).
    let vizLon, vizLat, vizNearestMode, vizSearchRadiusDeg;
    if (isMoving) {
      const frame = seed._currentFrame;
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

    spherePointInto(vizLon, vizLat, _arcW);
    cameraTransformInto(_arcW[0], _arcW[1], _arcW[2], _arcC);
    const cx = _arcC[0], cy = _arcC[1], cz = _arcC[2];
    const proj = project(cx, cy, cz);

    // ── Moving seed trail (only when on-screen and budget allows) ──────
    // Off-screen trails are invisible; skip them entirely to avoid
    // 50 wasted projection + canvas calls per off-screen seed.
    if (isMoving && proj && trailSamples >= 4) {
      _drawMovingSeedTrail(seed, i, isNearest, trailSamples);
    }

    if (proj) {
      // Envelope gain: modulates visual opacity during attack/release
      // A composer-held cloud sits at envelope gain 0 with its slot intact, so
      // the raw value would draw nothing and the commit would look erased. It
      // is not erased — it is holding, and touching it brings it back. Floor it
      // so the ring stays findable, which is what makes the cloud re-touchable.
      const held = seed.playing === false;
      const envG = held ? 0.28 : (seed._envGainCurrent ?? 1);
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
        const fovRad  = ((S.fovDeg ?? FOV_DEG) * Math.PI) / 180;
        // Equidistant centred camera: exact at any screen position. Pulled:
        // the old rectilinear approximation.
        const screenR = camOffsetZ() === 0
          ? rRad * (Math.min(W, H) / 2) / (fovRad / 2)
          : ((Math.min(W, H) / 2) / Math.tan(fovRad / 2)) * Math.tan(rRad) / (proj.depth / SPHERE_RADIUS);
        S.ctx.beginPath();
        S.ctx.arc(proj.sx, proj.sy, Math.max(12, screenR), 0, Math.PI * 2);
        S.ctx.stroke();
      }
      S.ctx.setLineDash([]);
      S.ctx.restore();
      // The pin gesture still held: the cloud reads here, but its anchor does
      // not exist yet — no mark until the release (Ek, 2026-09-05).
      const recording = i === S._seedRecordingSlot;
      if (isMoving || recording) {
        // The head: where a moving cloud reads right now — a small dot inside
        // its travelling reach circle, no number (the number is the anchor's).
        S.ctx.save();
        S.ctx.globalAlpha = (isNearest ? 1 : 0.6) * envG;
        S.ctx.fillStyle = seed.color;
        S.ctx.beginPath(); S.ctx.arc(proj.sx, proj.sy, 3, 0, Math.PI * 2); S.ctx.fill();
        S.ctx.restore();
      }
      if (!recording) {
        // The anchor mark — at the anchor, which for a stationary cloud is
        // where it sits and for a moving one the END of its path.
        let ax = proj.sx, ay = proj.sy, adf = Math.max(0, depthFactor(proj.depth));
        if (isMoving && pinAnchorInto(seed, _anchorR)) {
          spherePointInto(_anchorR[0], _anchorR[1], _arcW);
          cameraTransformInto(_arcW[0], _arcW[1], _arcW[2], _arcC);
          const ap = project(_arcC[0], _arcC[1], _arcC[2]);
          if (!ap) { ax = null; } else { ax = ap.sx; ay = ap.sy; adf = Math.max(0, depthFactor(rampDepth(_arcC[0], _arcC[1], _arcC[2], ap.depth))); }
        }
        if (ax != null) {
          const aAlpha = (isNearest ? 1 : 0.6) * envG * (0.35 + 0.65 * adf);
          _drawAnchorMark(ax, ay, seed.color, aAlpha, i + 1, held);
          if (isNearest) _drawFocusBracket(ax, ay, FOCUS_R, aAlpha * 0.85, FOCUS_INK());
        }
      }
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
      // Use atan2(cx, cz) for proper azimuth — the old formula
      // atan2(cx, sqrt(cx²+cz²)) collapsed the sign of cz, mapping
      // seeds behind the camera to screen-center instead of the far
      // edge.  This caused the indicator to flicker on for seeds
      // crossing the back meridian even when fully on-screen.
      const az    = Math.atan2(cx, cz);
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
        S.ctx.font         = '8px Urbanist, sans-serif';
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

// ── Path trail ──────────────────────────────────────────────────────────────
// A moving cloud's path, and the path a held pin is recording: ONE light line
// (Ek, 2026-09-05: the velocity-spaced dots were "too busy with the grains
// under"; the head and the anchor mark already say which way it goes).
//
// Performance-critical path — optimised to minimise per-frame cost:
//   • projectInto() writes into a scratch array (zero object allocations)
//   • focalLen/canvas-halves cached once per frame by updateProjectionCache()
//   • the whole polyline is a single beginPath/stroke (one canvas call)

// Scratch arrays for projectInto results (never returned to caller)
const _projA = [0, 0, 0];  // current frame projection
const _projB = [0, 0, 0];  // previous frame projection (copied per step)

function _drawPathTrail(frames, color, alpha, width, maxSamples) {
  if (!frames || frames.length < 2) return;

  S.ctx.save();
  S.ctx.strokeStyle = color;
  S.ctx.globalAlpha = alpha;
  S.ctx.lineWidth   = width;
  S.ctx.lineJoin    = 'round';
  S.ctx.lineCap     = 'round';

  // Back-meridian guard threshold: consecutive frames straddling ±π both
  // project to valid positions on opposite edges, and a segment between them
  // is a full-width streak. Break the line there instead.
  const maxSegPx = Math.min(S.canvas.width, S.canvas.height) * 0.35;
  const step = Math.max(1, Math.floor(frames.length / maxSamples));

  // ONE path, one stroke — the same batching the dots had (the per-dot
  // beginPath/arc/fill triplet was the GPU stall the Mar 29 pass removed).
  S.ctx.beginPath();
  let hasPrev = false, prevSx = 0, prevSy = 0;
  for (let fi = 0; fi < frames.length; fi += step) {
    const f = frames[fi];
    spherePointInto(f.lon, f.lat, _arcW);
    cameraTransformInto(_arcW[0], _arcW[1], _arcW[2], _arcC);
    if (!projectInto(_arcC[0], _arcC[1], _arcC[2], _projA)) { hasPrev = false; continue; }
    const sx = _projA[0], sy = _projA[1];
    if (hasPrev && Math.hypot(sx - prevSx, sy - prevSy) < maxSegPx) S.ctx.lineTo(sx, sy);
    else S.ctx.moveTo(sx, sy);
    hasPrev = true; prevSx = sx; prevSy = sy;
  }
  S.ctx.stroke();
  // No start or end blob: the 6 px dot at frames[0] read as an anchor at the
  // START of the path (Ek, 2026-09-05), and the anchor mark stands at the end.
  S.ctx.restore();
}

// ── Live recording trail ────────────────────────────────────────────────────
// While the user holds ↓ and moves, draw the in-progress path in real time.
function _drawLiveRecordingTrail() {
  const frames = S._seedRecordingFrames;
  if (!frames || !frames.length) return;
  const slot = S._seedRecordingSlot;
  const seed = slot >= 0 ? S.seedSlots[slot] : null;
  // A deferred path (the wash, `on end: cloud`) has no slot until the release,
  // so nothing used to show where it began — the held pin's ghost cloud drops
  // its head and reach at the press, and this one looked like it was "waiting
  // to launch" (Ek, 2026-09-05). Draw the launch point the same way: the head
  // dot and the reach ring at the first frame, in the stroke's paint colour.
  // Visual only — no slot, nothing sounds there until the release.
  if (!seed) {
    const f0 = frames[0];
    spherePointInto(f0.lon, f0.lat, _arcW);
    cameraTransformInto(_arcW[0], _arcW[1], _arcW[2], _arcC);
    const p = project(_arcC[0], _arcC[1], _arcC[2]);
    if (p) {
      const W = S.canvas.width, H = S.canvas.height;
      const rRad   = (f0.searchRadiusDeg ?? S.searchRadiusDeg ?? 10) * Math.PI / 180;
      const fovRad = ((S.fovDeg ?? FOV_DEG) * Math.PI) / 180;
      const screenR = camOffsetZ() === 0
        ? rRad * (Math.min(W, H) / 2) / (fovRad / 2)
        : ((Math.min(W, H) / 2) / Math.tan(fovRad / 2)) * Math.tan(rRad) / (p.depth / SPHERE_RADIUS);
      const color = S._liveInk ?? livePaintColor(S.liveColorIndex);
      S.ctx.save();
      S.ctx.strokeStyle = color;
      S.ctx.fillStyle = color;
      S.ctx.globalAlpha = 0.6;
      S.ctx.lineWidth = 2;
      S.ctx.setLineDash([2, 3]);
      S.ctx.beginPath(); S.ctx.arc(p.sx, p.sy, Math.max(12, screenR), 0, Math.PI * 2); S.ctx.stroke();
      S.ctx.setLineDash([]);
      S.ctx.beginPath(); S.ctx.arc(p.sx, p.sy, 3, 0, Math.PI * 2); S.ctx.fill();
      S.ctx.restore();
    }
  }
  if (frames.length < 2) return;
  // THE TRAIL IS THE MATERIAL'S COLOUR, not the tool's (Ek, 2026-09-13): the
  // ink of the last mark this stroke laid, so the line agrees with the dots
  // under it and hue means centroid everywhere on the sphere. A pinned cloud
  // keeps its SLOT colour, which is identity, not timbre. Before the first
  // mark of a stroke lands there is no ink yet, and the engine hue answers.
  const color = seed ? seed.color : (S._liveInk ?? livePaintColor(S.liveColorIndex));
  _drawPathTrail(frames, color, 0.5, 1.2, 50);
}

// ── Moving seed trail ──────────────────────────────────────────────────────
// Delegates to the shared velocity-dot renderer.
function _drawMovingSeedTrail(seed, slotIndex, isNearest, maxSamples) {
  const alpha = isNearest ? 0.5 : 0.3;
  _drawPathTrail(seed.frames, seed.color, alpha, 1.2, maxSamples || 50);
}

// ── Tether line ───────────────────────────────────────────────────────────────
// ── Gaze trail ──────────────────────────────────────────────────────
// A tapering ribbon behind the cursor: the strongest available cue for how the
// instrument moves. The age² alpha falloff plus the width taper are what make
// it read as a jet stream — linear alpha looks like a scratch on the glass.
// Points are appended in drawFrame() only when the cursor has MOVED; this only
// draws them.
//
// It is a WAKE, not a mark (Ek, 2026-08-29: "it's white as well, so when I'm
// painting a line it competes"). Three things follow. Its colour is the cool
// grey of vapour, never the ink the material and the horizon are drawn in —
// pure white put it in the same voice as the thing being painted, at the
// moment you most need to tell them apart. Its alpha ceiling is low and its
// width tops out under 2px. And a sub-pixel segment is SKIPPED: a round line
// cap on a zero-length stroke draws a full-width dot, so a cursor holding
// still used to stack one per frame into a bright bead — the dots along the
// line, arriving exactly when the cursor was steady enough to be painting
// carefully. The append gate in drawFrame() stops most of them at the source;
// this catches slow drift.
const TRAIL_INK_DARK  = '150,162,178';   // cool grey — vapour, not ink
const TRAIL_INK_LIGHT = '96,110,126';
const TRAIL_MIN_PX    = 1.2;             // shorter than this is a dot, not a line
export function drawGazeTrail() {
  const n = S.gazeTrail.length;
  if (n < 2 || S.gazeTrailSec <= 0) return;
  const now = performance.now() / 1000;
  const ink = S.darkMode ? TRAIL_INK_DARK : TRAIL_INK_LIGHT;
  const seamLimit = S.canvas.width * 0.25;
  S.ctx.save();
  S.ctx.lineCap = 'round';
  // Each point projects once, carried forward as `prev` — half the matrix
  // work of projecting both ends of every segment.
  let prev = null;
  for (let i = 0; i < n; i++) {
    const pt = S.gazeTrail[i];
    spherePointInto(pt.lon, pt.lat, _arcW);
    cameraTransformInto(_arcW[0], _arcW[1], _arcW[2], _arcC);
    const p = project(_arcC[0], _arcC[1], _arcC[2]);
    if (!p) { prev = null; continue; }
    if (prev) {
      const d = Math.hypot(p.sx - prev.sx, p.sy - prev.sy);
      // Guard the wrap: a lon seam crossing projects as a full-width streak
      if (d >= TRAIL_MIN_PX && d < seamLimit) {
        const age = 1 - (now - pt.t) / S.gazeTrailSec;   // 1 = newest
        S.ctx.strokeStyle = `rgba(${ink},${(0.34 * age * age).toFixed(3)})`;
        S.ctx.lineWidth   = 0.8 + 1.0 * age;
        S.ctx.beginPath();
        S.ctx.moveTo(prev.sx, prev.sy);
        S.ctx.lineTo(p.sx, p.sy);
        S.ctx.stroke();
      }
    }
    prev = p;
  }
  S.ctx.restore();
}

// The tether — centre of the view to the cursor. Same voice as the trail and
// for the same reason (2026-08-29): it is cursor CHROME, it lives inside the
// painting hand's field of view, and it was pure white with a [4, 8] dash —
// literally dots along a line, in the material's own colour, right where the
// stroke is being made. The dash stays; it is what tells the tether apart
// from a mark.
export function drawTetherLine() {
  if (!S.mouseInCanvas) return;
  const cx = S.canvas.width / 2, cy = S.canvas.height / 2;
  const dx = S.mousePixelX - cx, dy = S.mousePixelY - cy;
  const dist = Math.sqrt(dx*dx + dy*dy);
  if (dist < 20) return;
  const maxDist = Math.min(S.canvas.width, S.canvas.height) * 0.5;
  const alpha   = Math.min(0.30, 0.06 + 0.24 * (dist / maxDist));
  const ink     = S.darkMode ? TRAIL_INK_DARK : TRAIL_INK_LIGHT;
  S.ctx.save();
  S.ctx.strokeStyle = `rgba(${ink},${alpha})`;
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
  // SPHERE_PALETTE (state.js) carries the reasoning for these five roles.
  // Weights here are the other half of it: the grid used to be loud in BOTH
  // chroma and line weight, and dropping only the colour would have left a
  // grey gunsight. Everything below is lighter than it was.
  const P = S.darkMode ? SPHERE_PALETTE.dark : SPHERE_PALETTE.light;

  if (S.perfMode) {
    // Minimal: equator + prime meridian only, very light
    S.ctx.strokeStyle = P.horizon; S.ctx.lineWidth = 0.8; S.ctx.globalAlpha = 0.2;
    drawArc(0, 'lat');
    drawArc(0, 'lon');
    S.ctx.globalAlpha = 1;
    return;
  }

  // ── Regular meridians (skip prime 0° and back 180°, drawn separately) ───
  // Graph paper. You read curvature and motion off these, never the lines.
  for (let i = 1; i < GRID_SEGMENTS_LON; i++) {
    if (i === GRID_SEGMENTS_LON / 2) continue; // skip back meridian (180°)
    const lon = (i / GRID_SEGMENTS_LON) * Math.PI * 2;
    S.ctx.strokeStyle = P.graph;
    S.ctx.lineWidth   = 0.8;
    S.ctx.globalAlpha = 0.34;
    drawArc(lon, 'lon');
  }

  // ── Prime meridian (0°) and back meridian (180°) — tapered great circle ──
  // Drawn as segmented arcs so width/alpha vary with latitude.
  // Prime is heaviest at equator, thins toward poles. Back is lighter but
  // follows the same taper so they read as one continuous great circle.
  // The prime→back contrast must stay obvious: prime peaks at 3.4px, back at
  // 2.2px. Both were heavier (5.0 / 3.0) when the grid was cyan and had to
  // fight for attention against itself.
  const TAPER_SEGS = 12;
  for (let s = 0; s < TAPER_SEGS; s++) {
    const lat0 = (s / TAPER_SEGS) * Math.PI - Math.PI / 2;
    const lat1 = ((s + 1) / TAPER_SEGS) * Math.PI - Math.PI / 2;
    const midLat = (lat0 + lat1) / 2;
    // t=1 at equator, t=0 at poles
    const t = 1 - Math.abs(midLat) / (Math.PI / 2);
    // Prime meridian (0°): width 3.4→1.2, alpha 0.70→0.24
    S.ctx.strokeStyle = P.horizon;
    S.ctx.lineWidth   = 1.2 + 2.2 * t;
    S.ctx.globalAlpha = 0.24 + 0.46 * t;
    _drawArcSegment(0, 'lon', lat0, lat1);
    // Back meridian (180°): width 2.2→1.0, alpha 0.38→0.14
    S.ctx.strokeStyle = P.behind;
    S.ctx.lineWidth   = 1.0 + 1.2 * t;
    S.ctx.globalAlpha = 0.14 + 0.24 * t;
    _drawArcSegment(Math.PI, 'lon', lat0, lat1);
  }

  // ── Equator — the horizon, and the boundary the hemisphere cue reads off ──
  S.ctx.strokeStyle = P.horizon; S.ctx.lineWidth = 1.8; S.ctx.globalAlpha = 0.66;
  drawArc(0, 'lat');

  // ── Latitude lines — hemisphere-tinted, fading toward poles ────────────
  for (let i = 1; i < GRID_SEGMENTS_LAT; i++) {
    const lat          = (i / GRID_SEGMENTS_LAT) * Math.PI - Math.PI / 2;
    const distFromEq   = Math.abs(lat) / (Math.PI / 2);
    if (distFromEq < 0.05) continue; // skip if it overlaps the explicit equator
    const gridTint     = lat > 0 ? P.north : P.south;
    S.ctx.strokeStyle  = gridTint;
    if      (distFromEq < 0.4)  { S.ctx.lineWidth = 1.1; S.ctx.globalAlpha = 0.46; }
    else if (distFromEq < 0.7)  { S.ctx.lineWidth = 0.8; S.ctx.globalAlpha = 0.28; }
    else                        { S.ctx.lineWidth = 0.5; S.ctx.globalAlpha = 0.14; }
    drawArc(lat, 'lat');
  }
  S.ctx.globalAlpha = 1;
}


// Reusable scratch buffers for drawArc — avoids ~14,000 array allocations/frame
const _arcW = [0, 0, 0];
const _arcC = [0, 0, 0];

// Far-off-canvas guard for every projected POLYLINE. Near ±90° off-axis the
// rectilinear projection blows up (tan): a point still passes the z-cull but
// "projects" thousands of px off-screen, and any path reaching for it draws a
// streak across the whole canvas (2026-08-28, steer mode at the edges). One
// canvas beyond each edge is kept, so segments merely spanning the edge still
// draw; treat anything further as culled and break the path there.
function _onCanvasish(sx, sy) {
  const w = S.canvas.width, h = S.canvas.height;
  return sx >= -w && sx <= 2 * w && sy >= -h && sy <= 2 * h;
}
// Grid smoothness (2026-08-28): the old 12-step polygons ("minecraft lines")
// were never really about transform cost — each point went through the
// ALLOCATING project(), and the step count was cut to limit GC pressure.
// These now use the zero-alloc projectInto, so 4–8× the segments costs a few
// thousand pure-math flops per frame and zero allocations — cheaper on the
// GC than the blocky version was. The audio thread never sees any of it.
const _gridProj = [0, 0, 0];

// ── Arcs are subdivided by how far the chord MISSES the curve (2026-08-29) ─
//
// A fixed step count assumes the projection stretches the sphere evenly. The
// centred camera is azimuthal equidistant, where it does not: the TANGENTIAL
// scale is θ/sinθ, which is 1 on the view axis and unbounded at the antipode.
// Past a 180° FOV the far hemisphere wraps around the outside of the picture
// and a 15° step of longitude that measures 8px in front of you measures
// hundreds behind — so the grid came apart into visible straight chords and a
// polygon rim (Ek, 2026-08-29: "those lines aren't round, they look like
// they're straight lines"). Raising the flat count instead would have paid
// that price everywhere on screen to fix one ring at the edge.
//
// So: walk a coarse parameter step and bisect each one while the straight
// chord misses the real curve. The test is SAGITTA, not chord length — how
// far the true midpoint sits off the chord — because length alone refines
// where nothing is wrong. At an 80° FOV every base chord is ~36px and every
// one of them is already visually straight; charging them 4 extra projections
// each cost 0.8ms a frame to fix a ring that only exists past 180°. Measuring
// the miss instead spends the work where the picture is actually bending, so
// a normal FOV pays one midpoint probe per step and stops.
//
// Midpoints are projected from the real sphere point, never interpolated on
// screen, so bisection adds curvature rather than smoothing a polygon.
const SAG_PX    = 0.45;   // max allowed miss between chord and curve
const MAX_DEPTH = 5;      // ≤ 32 inserted points per base step
const ARC_STEPS = 48;
// One scratch row per recursion level — a shared buffer would be overwritten
// by the deeper call before this level had read it.
const _segBuf = [];
for (let _d = 0; _d <= MAX_DEPTH; _d++) _segBuf.push([0, 0, 0]);

// t ∈ [0,1] over the arc → sphere point → screen, into `out`.
// 'lon' is a meridian (fixed lon, t sweeps lat pole to pole); 'lat' is a
// parallel (fixed lat, t sweeps lon all the way round).
function _arcProject(type, angle, t, out) {
  const lon = type === 'lon' ? angle : t * Math.PI * 2;
  const lat = type === 'lon' ? t * Math.PI - Math.PI / 2 : angle;
  spherePointInto(lon, lat, _arcW);
  cameraTransformInto(_arcW[0], _arcW[1], _arcW[2], _arcC);
  // ── The grid is on the same shell as the material (Ek, 2026-09-07) ───────
  // "I still see horizontal lines flashing in front like it was the back side
  // of the sphere … when my zoom level makes the camera kinda right near the
  // back surface."
  //
  // They were the NEAR shell, not the back one. Pulled back, every point of
  // the sphere still projects, so the grid drew BOTH shells and the near one
  // hung between the eye and the work. The particle pass has always kept the
  // INNER face — the instrument is a bowl you work from within, and
  // screenToLonLat's far root picks that same face — so the grid was the one
  // layer disagreeing with everything else on screen about which side you are
  // on. Same predicate, same reasoning: n · c > 0, where n is the outward
  // normal (length R) and c the view ray. At camPull 0 it is a no-op — every
  // point has n · c = R² > 0 — so the centred view is untouched.
  const cx = _arcC[0], cy = _arcC[1], cz = _arcC[2];
  const offZ = camOffsetZ();
  if (offZ !== 0) {
    if (cx * cx + cy * cy + (cz - offZ) * cz <= 0) return false;
  } else if (cz < 0) {
    // ── The graph paper ENDS at the horizon, and grows past it as you zoom
    //    out (Ek, 2026-09-07) ────────────────────────────────────────────
    // Centred — the model you actually play in — there is no camera behind
    // the sphere and no back FACE to cull: azimuthal equidistant maps every
    // direction to a point, and 2026-08-29 folded the far hemisphere into a
    // rim band so it could not take the picture over. It is still DRAWN,
    // though, and its latitude lines are what Ek keeps seeing: "horizontal
    // lines flashing in front like it was the back side of the sphere".
    //
    // The marks out there are his material and stay. The GRID is graph
    // paper, and graph paper past the horizon is only worth having when you
    // are deliberately looking at the whole sphere — "I don't think I should
    // ever see the back side unless I'm … clearly wanting to see everything".
    //
    // So the grid's reach is a function of the zoom rather than a switch: at
    // 200° of field and below it stops at the horizon, and from there it
    // grows outward until at 340° it covers the sphere. `t` is cos of how far
    // past 90° it may go, so the boundary MOVES rather than appearing — the
    // graph paper extends as you pull back, and there is no frame at which a
    // ring of lines arrives. Squared compare, so the common front-hemisphere
    // case costs one sign test and no sqrt on the render path.
    const t = _gridBackReach();
    if (t <= 0) return false;
    if (cz * cz > t * t * (cx * cx + cy * cy + cz * cz)) return false;
  }
  return projectInto(_arcC[0], _arcC[1], _arcC[2], out)
      && _onCanvasish(out[0], out[1]);
}
// 0 at 200° of field (the grid stops at the horizon) … 1 at 340° (it reaches
// the antipode). Read once per point; the arithmetic is two adds and a clamp.
const GRID_BACK_FOV0 = 200, GRID_BACK_FOV1 = 340;
function _gridBackReach() {
  const f = S.fovDeg ?? FOV_DEG;
  return Math.max(0, Math.min(1, (f - GRID_BACK_FOV0) / (GRID_BACK_FOV1 - GRID_BACK_FOV0)));
}

// Emit the curve from t=ta to t=tb, bisecting while the chord misses it.
// A midpoint that will not project is not a reason to subdivide — draw the
// chord and let the canvas guard handle it.
function _arcBisect(type, angle, ta, ax, ay, tb, bx, by, depth) {
  if (depth < MAX_DEPTH) {
    const tm  = (ta + tb) * 0.5;
    const buf = _segBuf[depth];
    if (_arcProject(type, angle, tm, buf)) {
      const mx = buf[0], my = buf[1];
      if (Math.hypot(mx - (ax + bx) * 0.5, my - (ay + by) * 0.5) > SAG_PX) {
        _arcBisect(type, angle, ta, ax, ay, tm, mx, my, depth + 1);
        _arcBisect(type, angle, tm, mx, my, tb, bx, by, depth + 1);
        return;
      }
    }
  }
  S.ctx.lineTo(bx, by);
}

// One stroked run of an arc over the parameter range [t0, t1].
function _arcRun(type, angle, t0, t1, steps) {
  let started = false, pt = 0, px = 0, py = 0;
  S.ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = t0 + (t1 - t0) * (i / steps);
    if (!_arcProject(type, angle, t, _gridProj)) { started = false; continue; }
    const cx = _gridProj[0], cy = _gridProj[1];
    if (!started) { S.ctx.moveTo(cx, cy); started = true; }
    else _arcBisect(type, angle, pt, px, py, t, cx, cy, 0);
    pt = t; px = cx; py = cy;
  }
  S.ctx.stroke();
}

export function drawArc(angle, type) {
  _arcRun(type, angle, 0, 1, ARC_STEPS);
}

// Draw a segment of a meridian (lon arc) between lat0 and lat1.
// Used for tapered prime/back meridians where width varies with latitude.
// Same parameterisation as drawArc's 'lon' case — lat = t·π − π/2 — so the
// lat range converts straight to a t range and the refinement comes free.
function _drawArcSegment(lon, _type, lat0, lat1) {
  const HALF_PI = Math.PI / 2;
  _arcRun('lon', lon, (lat0 + HALF_PI) / Math.PI, (lat1 + HALF_PI) / Math.PI, 12);
}


// ── The cursor's engine hue ────────────────────────────────────────────────
/** `#rrggbb` (or any CSS colour tiles.js resolved) at an alpha. The hand's hue
 *  arrives as a hex string from the --eng-* custom properties, and the reticle
 *  needs it at two weights — a wash for the disc and a line for the ring. Hex
 *  is the only form those properties take, so this is a slice, not a parser;
 *  anything else falls through unchanged and the caller's alpha is lost rather
 *  than the colour. Memoised on the string because the hue changes when a
 *  position starts or stops playing and not once per frame. */
//  Four slots, not one: the reach ring asks for its colour at two alphas on
//  every frame and the reticle asks for a second colour at two more while
//  recording, so a smaller cache would miss on every call for ever.
const _hexASlots = [{ k: '', a: -1, v: '' }, { k: '', a: -1, v: '' },
                    { k: '', a: -1, v: '' }, { k: '', a: -1, v: '' }];
let _hexASlot = 0;
function _hexA(c, a) {
  for (const s of _hexASlots) if (s.k === c && s.a === a) return s.v;
  let v = c;
  if (typeof c === 'string' && c.charCodeAt(0) === 35 && c.length === 7) {
    v = 'rgba(' + parseInt(c.slice(1, 3), 16) + ',' + parseInt(c.slice(3, 5), 16)
      + ',' + parseInt(c.slice(5, 7), 16) + ',' + a + ')';
  }
  const s = _hexASlots[_hexASlot]; _hexASlot = (_hexASlot + 1) & 3;
  s.k = c; s.a = a; s.v = v;
  return v;
}

// Published by tiles.js (S._handHue) rather than resolved here: the engine →
// --eng-* mapping is not the identity (`granular` reads `--eng-grain`, and
// `filter` answers with granular's hue), so a second copy of that table here
// would drift the moment one of them changed. One table, in the module that
// owns the tiles.

// Screen position of a unit-sphere point, or null if it is behind the limb.
const _cpW = [0, 0, 0], _cpC = [0, 0, 0];
function _pinScreen(lon, lat) {
  spherePointInto(lon, lat, _cpW);
  cameraTransformInto(_cpW[0], _cpW[1], _cpW[2], _cpC);
  const pr = project(_cpC[0], _cpC[1], _cpC[2]);
  if (!pr || pr.depth > SPHERE_RADIUS * 2) return null;
  return pr;
}

// ── Radius readout (persistent ghost below cursor, flashes on change) ────────
// ── Brush radius in screen pixels ───────────────────────────────────────────
// The reticle circle has to match the angular reach the scheduler actually uses
// (grain.js compares `p._ang` against searchRadiusDeg), so it is measured, not
// assumed.
//
// Centred, `focalLen · tan(r)` is exact: the brush is a cone from the camera at
// the sphere's centre. Pulled back that identity breaks — the same angle on the
// sphere subtends a different angle at the eye, and worse, it is no longer even
// circular on screen near the limb. So when pulled we project the cursor point
// and a point one brush-radius away along its meridian, and measure. Costs two
// projections per frame, twice.
const _brW = [0, 0, 0], _brC = [0, 0, 0];
function brushScreenRadius(focalLen) {
  const r = S.searchRadiusDeg * Math.PI / 180;
  // Centred camera is azimuthal equidistant: pixels per radian is a constant,
  // so the brush's screen radius is exact at every screen position.
  if (camOffsetZ() === 0) {
    const fovRad = ((S.fovDeg ?? FOV_DEG) * Math.PI) / 180;
    return r * (Math.min(S.canvas.width, S.canvas.height) / 2) / (fovRad / 2);
  }
  const flat = r < Math.PI / 2 ? focalLen * Math.tan(r) : S.canvas.width * 0.8;

  const lon = S._frameCursorLon, lat = S._frameCursorLat;
  if (lon == null || lat == null) return flat;
  const proj = (lo, la) => {
    spherePointInto(lo, la, _brW);
    cameraTransformInto(_brW[0], _brW[1], _brW[2], _brC);
    return project(_brC[0], _brC[1], _brC[2]);
  };
  // Offset along the meridian, flipping near the pole so we stay on the sphere.
  const off = (lat + r) > Math.PI / 2 ? lat - r : lat + r;
  const a = proj(lon, lat), b = proj(lon, off);
  if (!a || !b) return flat;
  return Math.hypot(b.sx - a.sx, b.sy - a.sy);
}

export function drawRadiusTooltip() {
  // Use stashed cursor screen coords from drawCursor — works for both mouse and detethered modes
  const mx = S._cursorScreenX;
  const my = S._cursorScreenY;
  if (isNaN(mx) || isNaN(my)) return;  // cursor inactive or off-screen

  // Compute brush radius for offset positioning
  const fovRad   = ((S.fovDeg ?? FOV_DEG) * Math.PI) / 180;
  const focalLen = (Math.min(S.canvas.width, S.canvas.height) / 2) / Math.tan(fovRad / 2);
  // The ring draws even in nearest mode (it's still the loop/trigger gate),
  // so the label always positions below the real ring.
  const brushR   = brushScreenRadius(focalLen);

  const label = S.nearestMode ? 'nearest' : `${S.searchRadiusDeg}°`;
  const fs    = 9;

  // THE RING IS THE RADIUS. The number is confirmation that it CHANGED, not a
  // fact that needs standing, and it was standing: a 0.20 floor put a permanent
  // 9px readout under the cursor for ever, saying in text what the ring beside
  // it was already saying in geometry. It now lives exactly as long as its
  // flash, which is also the end of the 9px resting type.
  //
  // `nearest` is the exception, and the reason is that it is not a VALUE — it is
  // a mode, and the ring looks identical in it (nearest bypasses the radius for
  // grain selection only; loops, triggers and cloud focus still gate on
  // searchRadiusDeg, which is why the ring keeps drawing). Its control is the
  // lens sheet's snap capsule inside #propRail, a DRAWER, so with the drawer
  // shut this word is the only thing on screen that says the mode is on. It
  // keeps its ghost until the mode has somewhere else to live.
  const now       = performance.now();
  const flashLeft = S.radiusTooltipUntil - now;
  const flashFade = 600;
  const baseAlpha = S.nearestMode ? 0.20 : 0;
  if (flashLeft <= 0 && baseAlpha === 0) return;
  const alpha = baseAlpha + 0.65 * Math.max(0, Math.min(1, flashLeft / flashFade));

  // Position: centered below the radius circle
  const py = my + Math.max(brushR + 14, 28);

  S.ctx.save();
  S.ctx.globalAlpha  = alpha;
  S.ctx.font         = `${fs}px Urbanist, sans-serif`;
  S.ctx.textAlign    = 'center';
  S.ctx.textBaseline = 'top';
  S.ctx.fillStyle    = S.nearestMode ? _tok('--accent-sensor', '#a793c0') : (S.darkMode ? '#ffffff' : '#000000');
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
// Parallel to _colorBuf rather than an 8th stride field: the stride layout is
// documented above and load-bearing, and a Uint8Array is cheaper to clear.
let _mutedBuf  = new Uint8Array(512);
let _wetBuf    = new Uint8Array(512);   // 1 = a wet mark of the brush in the hand — it will move
// Sized against S.particles to decide when every other buffer must grow — it
// is the capacity witness, not an ordering. Nothing reads its contents.
let _sortIdx   = new Int32Array(512);
// ── Per-material drawing (#216 viz pass) ────────────────────────────────────
// The brush decides how a mark reads back, visually as well as sonically:
// a grain mark stays a dot, LINE material (p.trig) draws as a connected polyline per
// stroke, STAMP material (p.source === 'sample') draws as a vertical bar
// whose height is the file's amplitude at that mark's offset (p.rms is
// computed from the sample buffer at deposit time), so a stamp stroke lays
// the waveform of the file along the painted path. All parallel to the sort
// buffer, preallocated — nothing here may allocate per frame.
let _matBuf    = new Uint8Array(512);   // 0 grain · 1 line · 2 stamp
let _strokeBuf = new Int32Array(512);   // strokeId, for polyline grouping
let _origBuf   = new Int32Array(512);   // original index — a gap breaks the line
let _timeBuf   = new Float32Array(512); // grainStart — a TIME gap breaks it too
let _gapBuf    = new Uint8Array(512);   // erase stamped a hole after this mark
let _featBuf   = new Uint8Array(512);   // 1 = this mark carries the colour axes
let _lineIdx   = new Int32Array(512);   // ii of collected line points, in order
let _lineColor = new Array(512);        // resolved color per collected point
let _lineAlpha = new Float32Array(512);
let _lineWidth = new Float32Array(512); // HALF-width per point — volume-driven
// The two feature axes per collected point, kept beside the resolved colour so
// the ribbon can interpolate BETWEEN two marks instead of stepping at each one.
let _lineTilt  = new Float32Array(512);
let _lineNoise = new Float32Array(512);
let _lineFeat  = new Uint8Array(512);   // 1 = this mark has features to blend
// Unit-sphere direction per collected line point — for great-circle
// densification of the ribbon (marks are 50 ms of hand travel apart, and
// straight screen segments between them read as a polygon).
let _linePX = new Float64Array(512);
let _linePY = new Float64Array(512);
let _linePZ = new Float64Array(512);
// Densified ribbon centers (marks + slerped sub-points), and the shared
// per-frame sub-point budget — same discipline as _TRAIL_BUDGET.
const _LINE_SMOOTH_BUDGET = 800;
let _cenX = new Float64Array(512 + _LINE_SMOOTH_BUDGET + 8);
let _cenY = new Float64Array(512 + _LINE_SMOOTH_BUDGET + 8);
let _cenW = new Float32Array(512 + _LINE_SMOOTH_BUDGET + 8);
let _cenW2 = new Float32Array(512 + _LINE_SMOOTH_BUDGET + 8);  // width smoothing pass
let _cenX2 = new Float64Array(512 + _LINE_SMOOTH_BUDGET + 8);  // path smoothing pass
let _cenY2 = new Float64Array(512 + _LINE_SMOOTH_BUDGET + 8);
let _cenXO = new Float64Array(512 + _LINE_SMOOTH_BUDGET + 8);  // where the marks really are
let _cenYO = new Float64Array(512 + _LINE_SMOOTH_BUDGET + 8);
let _cenC = new Array(512 + _LINE_SMOOTH_BUDGET + 8);          // colour per centre
let _cenA = new Float32Array(512 + _LINE_SMOOTH_BUDGET + 8);   // alpha per centre
// Ribbon scratch: screen-space offset outline for one stroke run (fwd + back).
let _ribX = new Float32Array(2 * (512 + _LINE_SMOOTH_BUDGET + 8));
let _ribY = new Float32Array(2 * (512 + _LINE_SMOOTH_BUDGET + 8));
// Cache projected positions for active grains to avoid double spherePoint/project work.
const _glowCache = new Map();   // particle → { sx, sy, depth }
// The density face's bins (the glow pass): grains too short to be seen are
// drawn as cores in ONE path per alpha step, not a path each. Reused every
// frame — the render loop allocates nothing per grain (§ render-path).
// Every sounding mark is drawn at ONE alpha, so the whole glow layer is a
// single batched path: sx, sy, r triplets, reused every frame, zero-alloc.
// It was four alpha bins and then six while heat and the onset rate weighted
// each mark; both are gone (Ek: "i don't want different core or alphas").
const _glowDots = [];
const _ghostDots = [];   // lit but not sounding — the muted-scan preview
/** One batched fill for a run of [x, y, r] triples. A module function, not a
 *  closure in the draw pass: this is the render loop, and the pass runs every
 *  frame a grain is lit. */
function _strokeGlowDots(dots, alpha, ink) {
  if (!dots.length) return;
  const ctx = S.ctx;
  ctx.globalAlpha = alpha;
  ctx.fillStyle   = ink;
  ctx.beginPath();
  for (let i = 0; i < dots.length; i += 3) {
    ctx.moveTo(dots[i] + dots[i + 2], dots[i + 1]);
    ctx.arc(dots[i], dots[i + 1], dots[i + 2], 0, Math.PI * 2);
  }
  ctx.fill();
}
// The mark's whole appearance, and the only two numbers in it (Ek, 2026-09-07):
// twice the 0.42 core the weighted face used at its lightest, at the alpha the
// six-bin ramp reached at its top. Both are on the marker layer's own size
// scale (PARTICLE_BASE_SIZE / PARTICLE_MAX_SIZE), never the viz sliders.
const GLOW_CORE  = 0.84;
const GLOW_ALPHA = 0.917;
// Reach lines per frame — a cost ceiling, not a readability one. It used to
// be a CLIFF: above it the fan was not drawn at all, so the lens at "all"
// over a dense set — the moment the fan says the most — showed nothing
// (P5, 2026-09-06). Now the pool is SAMPLED at a stride above the ceiling:
// the same number of lines, spread evenly through the pool, so the fan keeps
// its shape and its reach while alpha carries the density as it already did.
const REACH_MAX = 128;
// The no-wet-brushes answer, so the frame never allocates one to say nothing.
const EMPTY_IDS = [];

// ── Depth ramp ──────────────────────────────────────────────────────────────
// depth → 0..1 "how near", the input to every size and alpha ramp in the three
// loops below. They must agree, so they all come through here.
//
// Two geometries, deliberately NOT unified into one formula:
//   centred (camPull 0) — every point on the sphere is exactly SPHERE_RADIUS
//     away, so there is no distance to speak of. `depth` is the z-component and
//     the ramp is really "how far off the view axis". Kept arithmetically
//     identical to the pre-pull code so nothing shifts at the default.
//   pulled — `depth` is a genuine distance spanning |R − D| … R + D. That span
//     is narrow relative to 2R, so reusing the centred formula would squeeze
//     every particle into a sliver of the ramp and they would all come out the
//     same size. Normalise across the span that actually exists.
// Colour for a particle whose loop is muted. Desaturated, not just dimmed:
// dimming alone reads as "far away" or "quiet", which are things the paint
// already means. Grey is the one thing that reads as "not sounding".
const MUTED_PARTICLE_DARK  = '#5c5c5c';
const MUTED_PARTICLE_LIGHT = '#b0b0b0';

let _dfNear = 0, _dfInvSpan = 0, _dfPulled = false;
function updateDepthRamp() {
  const offZ = camOffsetZ();
  _dfPulled = offZ !== 0;
  if (!_dfPulled) return;
  _dfNear = Math.abs(SPHERE_RADIUS - offZ);
  const span = 2 * Math.min(SPHERE_RADIUS, offZ);
  _dfInvSpan = span > 0 ? 1 / span : 0;
}
// THE RAMP WANTS THE TRUE DISTANCE WHEN THE CAMERA IS PULLED (2026-09-13).
// `projectInto`/`project` always hand back the z-component, and near the
// silhouette z and the real distance diverge badly — the dot loop has said so
// since 2026-08-28 and packs `pulled ? mag : pdepth` into its own buffer, but
// every OTHER layer fed the raw z straight in. At camPull 0.5 a mark near the
// silhouette has z ≈ 0.2R against mag ≈ 1.1R, so depthFactor(z) clamps to 1 —
// full size, full brightness — where depthFactor(mag) gives 0.4. The playheads,
// the anchor marks and the overdub heads therefore stayed at maximum across the
// whole far side while the paint under them receded, which is exactly what the
// note above _drawPlayheadSquare says that layer must not do: the marker
// detached from its own material.
function rampDepth(cx, cy, cz, z) {
  return _dfPulled ? Math.sqrt(cx * cx + cy * cy + cz * cz) : z;
}

function depthFactor(depth) {
  // Centred clamp (2026-08-28): the equidistant view draws the FAR
  // hemisphere too, where z goes negative and the unclamped ramp exceeded 1
  // — far-side dots rendered past max size. Beyond the 90° ring everything
  // sits at 1; the facing term already dims it as the depth cue.
  return _dfPulled
    ? Math.max(0, Math.min(1, 1 - (depth - _dfNear) * _dfInvSpan))
    : Math.min(1, 1 - (depth / (SPHERE_RADIUS * 2)));
}

export function drawParticles() {
  updateDepthRamp();
  // Single-pass: project + collect directly into a flat sort buffer.
  // Feature-driven rendering: pack audio features into the buffer for
  // feature-driven size/colour. Palette colour used as fallback for legacy particles.
  const useViz = true;
  const STRIDE = _STRIDE;

  // Ensure pre-allocated buffers are large enough
  const maxCount = S.particles.length;
  if (_sortIdx.length < maxCount) {
    _sortBuf   = new Float64Array(maxCount * STRIDE);
    _colorBuf  = new Array(maxCount);
    _mutedBuf  = new Uint8Array(maxCount);
    _wetBuf    = new Uint8Array(maxCount);
    _sortIdx   = new Int32Array(maxCount);
    _matBuf    = new Uint8Array(maxCount);
    _strokeBuf = new Int32Array(maxCount);
    _origBuf   = new Int32Array(maxCount);
    _timeBuf   = new Float32Array(maxCount);
    _gapBuf    = new Uint8Array(maxCount);
    _featBuf   = new Uint8Array(maxCount);
    _lineIdx   = new Int32Array(maxCount);
    _lineColor = new Array(maxCount);
    _lineAlpha = new Float32Array(maxCount);
    _lineWidth = new Float32Array(maxCount);
    _linePX    = new Float64Array(maxCount);
    _linePY    = new Float64Array(maxCount);
    _linePZ    = new Float64Array(maxCount);
    _lineTilt  = new Float32Array(maxCount);
    _lineNoise = new Float32Array(maxCount);
    _lineFeat  = new Uint8Array(maxCount);
    _cenX      = new Float64Array(maxCount + _LINE_SMOOTH_BUDGET + 8);
    _cenY      = new Float64Array(maxCount + _LINE_SMOOTH_BUDGET + 8);
    _cenW      = new Float32Array(maxCount + _LINE_SMOOTH_BUDGET + 8);
    _cenW2     = new Float32Array(maxCount + _LINE_SMOOTH_BUDGET + 8);
    _cenX2     = new Float64Array(maxCount + _LINE_SMOOTH_BUDGET + 8);
    _cenY2     = new Float64Array(maxCount + _LINE_SMOOTH_BUDGET + 8);
    _cenXO     = new Float64Array(maxCount + _LINE_SMOOTH_BUDGET + 8);
    _cenYO     = new Float64Array(maxCount + _LINE_SMOOTH_BUDGET + 8);
    _cenC      = new Array(maxCount + _LINE_SMOOTH_BUDGET + 8);
    _cenA      = new Float32Array(maxCount + _LINE_SMOOTH_BUDGET + 8);
    _ribX      = new Float32Array(2 * (maxCount + _LINE_SMOOTH_BUDGET + 8));
    _ribY      = new Float32Array(2 * (maxCount + _LINE_SMOOTH_BUDGET + 8));
  }
  // One pass over ≤16 slots; rebuilds the marks only when the muted set moves.
  // Returns false in the normal case, which lets the loops below skip the
  // per-particle read entirely.
  const anyMuted = syncParticleMarks();
  // THE WET VOICINGS — the marks that wear a ring below, because their sound
  // can still move (brush-voicing.js, "Wet paint"). Read from the voicing
  // TABLE, not from the hand (2026-09-14): wet is a property of the brush and
  // lasts until the brush is dried, while `_handTile()` is null between
  // presses — so keying the ring on the hand lit the marks only while that
  // brush was actually painting, which is the opposite of what wet means.
  // Read once per frame; usually zero or one wet brush exists.
  const wetVos   = S._wetVoicingIds?.() ?? EMPTY_IDS;
  const nWet     = wetVos.length;
  const wetVo0   = nWet === 1 ? wetVos[0] : 0;
  // Wet is granular-only (tiles.js `setWet` refuses the rest), so the ring is
  // always the grain engine's hue — and unlike `S._handHue` it must not go
  // null between presses.
  const wetHue   = S._wetHue?.() ?? null;

  _glowCache.clear();
  const hasGlow = activeGrainMap.size > 0;

  // Reusable scratch for per-particle projection — zero allocations in loop.
  // projectInto() rather than project(): the latter allocates a result object
  // AND recomputes Math.tan(fov/2) on every call, which at 20k particles ×
  // 30fps is 600k allocations/sec of pure GC pressure in the hot loop.  The
  // projection cache is already primed by updateProjectionCache() per frame.
  const _pW = [0, 0, 0];
  const _pC = [0, 0, 0];
  const _pj = [0, 0, 0];

  // Camera distance decides which of two geometries we are in, and they are not
  // continuous with each other in how `depth` and `facing` behave — see the
  // long note above _depthFacing.
  const offZ    = camOffsetZ();
  const pulled  = offZ !== 0;

  let count = 0;
  let origIdx = -1;
  for (const p of S.particles) {
    origIdx++;
    spherePointInto(p.lon, p.lat, _pW);
    cameraTransformInto(_pW[0], _pW[1], _pW[2], _pC);
    const cx = _pC[0], cy = _pC[1], cz = _pC[2];
    if (!projectInto(cx, cy, cz, _pj)) continue;
    const psx = _pj[0], psy = _pj[1], pdepth = _pj[2];
    const mag    = Math.sqrt(cx*cx + cy*cy + cz*cz);
    let facing;
    if (!pulled) {
      // Camera at the centre: every point is exactly SPHERE_RADIUS away, so
      // this is not a distance at all — it is cos(angle off the view axis).
      // Unchanged from the original inside-sphere model.
      facing = Math.max(0, cz / mag);
    } else {
      // Off-centre: mag IS a real distance and half the sphere hides the other
      // half, so cull by surface normal. n = (P − centre) is the outward normal
      // (length R), c is the view ray, and n·c > 0 keeps the INNER face.
      //
      // Inner, at every distance — not "near face once you are outside". The
      // instrument is a bowl you work from within, so pulling back has to keep
      // showing the surface you are painting, and screenToLonLat's far root
      // picks that same face. Draw the near shell instead and you get a
      // coherent-looking ball whose cursor is on the side you cannot see.
      //
      // At camPull 0 this is a no-op — every point has n·c = R² > 0, and
      // projectInto's z > 0.1 alone gives the forward hemisphere, exactly as
      // the centred model always did.
      const nz  = cz - offZ;
      const ndc = cx * cx + cy * cy + nz * cz;   // n · c
      if (ndc <= 0) continue;
      // cos of the angle between the surface normal and the view ray.
      facing = Math.min(1, ndc / (mag * SPHERE_RADIUS));
    }
    const off    = count * STRIDE;
    _sortBuf[off]     = psx;
    _sortBuf[off + 1] = psy;
    // When pulled, the ramp wants the true distance, not the z-component: near
    // the silhouette the two diverge badly. Centred, they are the same thing.
    _sortBuf[off + 2] = pulled ? mag : pdepth;
    _sortBuf[off + 3] = facing;
    // A NON-FINITE LOUDNESS IS ZERO, NOT A FEATURE (2026-09-13). `p.rms` reaches
    // here from an analyser window, from a file, and from a DFT; any of the
    // three can hand over NaN, and `NaN > 0` is false, so the mark fell down
    // the legacy branch below and drew GREY at nearly twice the size of its
    // neighbours — measured, radius 8.9 became 17.1 and #3ff2ae became #888888.
    const _r = p.rms;
    _sortBuf[off + 4] = (typeof _r === 'number' && _r > 0 && _r === _r) ? _r : 0;
    // Whether this mark has the colour axes at all is a DIFFERENT question from
    // whether it made a sound. A tape take deposits on every tick including
    // silence (paint-ticker: the gate's `!S._recordingTrigger` bypass), so a
    // silent-but-measured mark must still be drawn from its timbre — the old
    // `rms > 0` test dropped it to the palette and put one grey oversized dot,
    // and one hard ribbon break, in the middle of an otherwise timbre-coloured
    // stroke.
    _featBuf[count]   = (p.tilt !== undefined || p.noise !== undefined
                         || _sortBuf[off + 4] > 0) ? 1 : 0;
    // TILT, the hue axis (2026-09-13). A mark from before it existed falls
    // back to its centroid run through the old normalisation, so an older
    // session still draws the colours it was painted in.
    _sortBuf[off + 5] = p.tilt ?? normaliseCentroid(p.centroid ?? 0, S.vizCentroidMin, S.vizCentroidMax);
    // NOISE, not zcr (2026-09-13): the second colour axis. A mark painted
    // before this field existed falls back to its zcr, which is what it was
    // coloured by at the time.
    _sortBuf[off + 6] = p.noise ?? p.zcr ?? 0;
    _colorBuf[count]  = p.color;
    _mutedBuf[count]  = anyMuted && p._composerMuted ? 1 : 0;
    _wetBuf[count]    = nWet === 0 ? 0
                      : nWet === 1 ? (p._vo === wetVo0 ? 1 : 0)
                      : (wetVos.indexOf(p._vo) >= 0 ? 1 : 0);
    _matBuf[count]    = p.trig ? 1 : (p.source === 'sample' ? 2 : 0);
    _strokeBuf[count] = p.strokeId ?? -1;
    _origBuf[count]   = origIdx;
    // takeT when present (#247): a sampler trigger stroke's grainStart strides
    // at the patch's grain period (breaking every segment past the 0.25 s gap
    // test) and rewinds when the sample loops — takeT is its real path clock.
    _timeBuf[count]   = p.takeT ?? p.grainStart ?? 0;
    _gapBuf[count]    = p._gapAfter ? 1 : 0;
    // Unit direction, for the ribbon's great-circle densification.
    if (p._cx === undefined) stampCartesian(p);
    _linePX[count] = p._cx; _linePY[count] = p._cy; _linePZ[count] = p._cz;
    if (hasGlow && activeGrainMap.has(p)) {
      _glowCache.set(p, { sx: psx, sy: psy, depth: pulled ? mag : pdepth });
    }
    count++;
  }

  const buf = _sortBuf;

  // Read mutable size overrides (set from viz modal sliders), scaled by the
  // zoom (2026-08-28): under the equidistant view a mark should keep a
  // roughly constant ANGULAR footprint, so dots shrink as the view zooms out
  // toward the 360° map instead of swamping it, and grow (capped) zoomed in.
  // 80° — the long-standing default — is the reference size.
  const zf = Math.max(0.35, Math.min(1.6, 80 / (S.fovDeg ?? FOV_DEG)));
  const pBase = (S.vizMinSize ?? PARTICLE_BASE_SIZE) * zf;
  const pMax  = (S.vizMaxSize ?? PARTICLE_MAX_SIZE) * zf;

  let _lineCount = 0;   // line-material points collected this frame

  for (let ii = 0; ii < count; ii++) {
    const i          = ii * STRIDE;
    const sx         = buf[i];
    const sy         = buf[i + 1];
    const depth      = buf[i + 2];
    const facing     = buf[i + 3];
    const depthScale = Math.max(0, depthFactor(depth));

    let size, color, alpha;

    if (useViz && _featBuf[ii]) {
      // ── Feature-driven rendering ──
      const rmsN  = normalise(buf[i + 4], S.vizRmsMin, S.vizRmsMax);
      const centN = buf[i + 5];      // already the 0–1 hue axis
      const noiseR = buf[i + 6]; // already 0–1

      // Size: RMS drives a min→max lerp, then depth perspective scales it down
      // rmsN=0 → pBase (quiet floor), rmsN=1 → pMax (loud ceiling)
      const rmsSize = pBase + (pMax - pBase) * rmsN;
      size  = rmsSize * (0.5 + 0.5 * depthScale);
      color = featuresToColor(centN, noiseR);
      alpha = (0.35 + 0.65 * depthScale) * (0.5 + 0.5 * facing);
    } else {
      // ── Original palette rendering (fallback) ──
      color = _colorBuf[ii];
      size  = pBase + (pMax - pBase) * depthScale;
      alpha = (0.3 + 0.7 * depthScale) * (0.5 + 0.5 * facing);
    }

    // A muted loop's material goes grey. Applied after the colour is chosen so
    // it overrides both the feature-driven and the palette path — the point is
    // that timbre colour stops meaning anything while the buffer is silent.
    if (_mutedBuf[ii]) {
      color = S.darkMode ? MUTED_PARTICLE_DARK : MUTED_PARTICLE_LIGHT;
      alpha *= 0.7;
    }

    // Line and stamp material keep their PALETTE colour — a line's colour is
    // the stroke's identity and a stamp's is its file's, and both encode
    // their sound another way (the line by being one object, the bar by its
    // height). Feature-driven hue stays a grain thing. Muted grey still wins.
    const mat = _matBuf[ii];
    if (mat === 1) {
      // Line material: collect, draw as a volume-ribbon after this loop.
      // The half-width follows the mark's recorded rms — the stroke reads
      // like a pressure line: thin where the playing was quiet, swelling
      // where it was loud. A mark with no features draws at the floor.
      // Alpha boosted over the dot formula (a stroke has far less ink than
      // a dot cloud) and breathing slightly with the same volume.
      //
      // FAR-OFF-CANVAS marks are treated as culled: near ±90° off-axis the
      // rectilinear projection blows up (tan), a mark "projects" to
      // thousands of px off-screen, and the ribbon drew a streak across the
      // whole canvas to reach it (2026-08-28, steer mode at the edges).
      // Skipping it leaves an origIdx gap, which is already a run break. The
      // margin is generous — one canvas beyond each edge — so segments
      // merely spanning the edge still draw.
      if (!_onCanvasish(buf[i], buf[i + 1])) continue;
      const rmsN = buf[i + 4] > 0 ? normalise(buf[i + 4], S.vizRmsMin, S.vizRmsMax) : 0;
      _lineIdx[_lineCount]   = ii;
      // THE SAME COLOUR A GRAIN DOT WOULD GET, computed from this mark's own
      // features rather than read from `p.color` (Ek, 2026-09-13: "i'm
      // expecting the colour to change and match the timbre, same scale/range
      // as the grains"). The stored value is the ink at DEPOSIT time, so a
      // line kept whatever the mapping was when it was painted while the dots
      // beside it followed the mapping as it is now — two scales on one
      // sphere. Falls back to the stored colour for a mark with no features.
      _lineColor[_lineCount] = _mutedBuf[ii] ? color
        : (_featBuf[ii]
            ? featuresToColor(buf[i + 5], buf[i + 6])
            : _colorBuf[ii]);
      _lineTilt[_lineCount]  = buf[i + 5];
      _lineNoise[_lineCount] = buf[i + 6];
      _lineFeat[_lineCount]  = (!_mutedBuf[ii] && _featBuf[ii]) ? 1 : 0;
      _lineAlpha[_lineCount] = Math.min(1, alpha * (1.3 + 0.5 * rmsN));
      const rmsE = Math.pow(rmsN, 1.35);   // expand contrast: quiet stays thin
      _lineWidth[_lineCount] = (0.6 + (pBase * 0.5 + pMax * 1.8) * rmsE) * (0.55 + 0.45 * depthScale);
      _lineCount++;
      continue;
    }

    S.ctx.globalAlpha = alpha;
    if (mat === 2) {
      // Stamp material: a thin vertical bar whose height is the file's
      // amplitude at this mark's offset — the stroke lays the waveform of
      // the file along the painted path. rms is computed from the sample
      // buffer at deposit time (paint-ticker), so this needs no new data.
      S.ctx.fillStyle = _mutedBuf[ii] ? color : _colorBuf[ii];
      const rmsN  = buf[i + 4] > 0 ? normalise(buf[i + 4], S.vizRmsMin, S.vizRmsMax) : 0;
      const halfH = (pBase * 0.6 + pMax * 1.6 * rmsN) * (0.5 + 0.5 * depthScale) + 0.8;
      const halfW = Math.max(0.7, 0.5 + 0.7 * depthScale);
      S.ctx.fillRect(sx - halfW, sy - halfH, halfW * 2, halfH * 2);
    } else {
      S.ctx.fillStyle = color;
      S.ctx.beginPath(); S.ctx.arc(sx, sy, size, 0, Math.PI * 2); S.ctx.fill();
      // A WET mark wears a ring in the grain hue: these are the marks a
      // brush's knobs can still move (brush-voicing.js, "Wet paint"). Every
      // mark of every wet brush, held or not — the ring is the answer to
      // "which paint is still wet", and paint does not dry because you put
      // the brush down. One extra stroke per such mark.
      if (_wetBuf[ii]) {
        S.ctx.strokeStyle = wetHue || color;
        S.ctx.lineWidth = 1;
        S.ctx.beginPath(); S.ctx.arc(sx, sy, size + 2, 0, Math.PI * 2); S.ctx.stroke();
      }
    }
  }

  // ── Line material: one polyline per stroke ────────────────────────────────
  // Collected in array order, which is paint order. A path breaks where the
  // stroke changes, where culling hid a span (original-index gap), or where
  // the stroke's own TIMELINE jumps — which is what erase leaves behind. The
  // index break alone cannot see an erase: origIdx is recomputed from the
  // compacted array every frame, so survivors on either side of an erased
  // chunk become consecutive again and the ribbon drew a chord across the
  // gap (2026-08-28). Time is stable: marks deposit on the paint tick, so a
  // delta well past the tick means material is missing there. A false break
  // (a brush clock stretching mid-stroke) is harmless — the two runs abut.
  if (_lineCount > 0) {
    const _lineGapS = Math.max(0.25, 4 * ((S.paintTicker?.intervalMs ?? 50) / 1000));
    S.ctx.lineJoin = 'round';
    let runStart = 0;
    let smoothLeft = _LINE_SMOOTH_BUDGET;   // shared across all runs this frame
    const flush = (a, b) => {   // draw collected points [a, b) as one ribbon
      if (b - a === 1) {
        // An isolated visible point still marks the material.
        const ii = _lineIdx[a], i = ii * STRIDE;
        S.ctx.globalAlpha = _lineAlpha[a];
        S.ctx.fillStyle   = _lineColor[a];
        S.ctx.beginPath();
        S.ctx.arc(buf[i], buf[i + 1], Math.max(1.2, _lineWidth[a]), 0, Math.PI * 2);
        S.ctx.fill();
        return;
      }
      // Densify along the GREAT CIRCLE first (2026-08-28): marks sit 50 ms
      // of hand travel apart, and straight screen segments between them read
      // as a polygon ("minecraft lines"). Sub-points are slerped on the
      // sphere and projected — the drawn ribbon is the true spherical path,
      // the same one the eraser and the trigger gate test. Budget-bounded,
      // same discipline as _TRAIL_BUDGET; when it runs out later strokes
      // simply draw straight.
      const n0 = b - a;
      let cn = 0;
      for (let k = 0; k < n0; k++) {
        const iC = _lineIdx[a + k] * STRIDE;
        _cenX[cn] = buf[iC];
        _cenY[cn] = buf[iC + 1];
        _cenW[cn] = Math.max(0.5, _lineWidth[a + k]);
        _cenC[cn] = _lineColor[a + k];
        _cenA[cn] = _lineAlpha[a + k];
        cn++;
        if (k + 1 < n0 && smoothLeft > 0) {
          const j0 = _lineIdx[a + k], j1 = _lineIdx[a + k + 1];
          const ax = _linePX[j0], ay = _linePY[j0], az = _linePZ[j0];
          const bx2 = _linePX[j1], by2 = _linePY[j1], bz2 = _linePZ[j1];
          const dt = ax * bx2 + ay * by2 + az * bz2;
          const ang = Math.acos(Math.max(-1, Math.min(1, dt)));
          // TWO REASONS TO SUBDIVIDE, AND THEY ARE INDEPENDENT (2026-09-13).
          // Geometry wants sub-points when the span bends: a straight screen
          // segment across 3° of sphere reads as a polygon. COLOUR wants them
          // when the sound changed, and it wants them at ANY angle — a slow
          // hand puts its marks a pixel apart, so the span never bent, so
          // there was nowhere to put a gradient and the colour stepped hard at
          // the mark. That is the banding left after the caps went (Ek: "see
          // how there blocky is it possible to make it more like a gradient").
          // Take whichever wants more.
          const geoSubs = ang > 0.05 ? Math.min(6, Math.ceil(ang / 0.035)) : 1;
          {
            const sinA = Math.sin(ang);
            const w0 = _cenW[cn - 1], w1 = Math.max(0.5, _lineWidth[a + k + 1]);
            const a0 = _lineAlpha[a + k], a1 = _lineAlpha[a + k + 1];
            // Blend the two axes THROUGH the ramp, not the two hex strings:
            // featuresToColor is a read off a 64 × 32 table, so an interpolated
            // sub-point costs nothing and lands on the same colours a grain
            // would. Only when the neighbours actually differ, and only when
            // both carry features — a muted mark's grey must not be mixed into
            // a live colour.
            const t0f = _lineTilt[a + k],  t1f = _lineTilt[a + k + 1];
            const n0f = _lineNoise[a + k], n1f = _lineNoise[a + k + 1];
            // Only a jump worth ramping earns the extra fills. At the table's
            // 96 hue buckets by 32 saturation ones, a one- or two-bucket
            // step between neighbours is already below what the eye resolves
            // and blending it would buy nothing for up to six more fills per
            // mark pair. Measured on a sphere of twelve strokes each sweeping
            // the whole ramp — the worst case there is — this holds the median
            // frame at 16.8 ms against 16.5 before, where blending every step
            // cost 18.6.
            const jump = Math.max(Math.abs(t1f - t0f) * CQ_HUE, Math.abs(n1f - n0f) * CQ_SAT);
            const blend = jump > 2.5
                       && _lineColor[a + k] !== _lineColor[a + k + 1]
                       && _lineFeat[a + k] === 1 && _lineFeat[a + k + 1] === 1;
            // One sub-point per bucket the colour crosses, so the ramp is drawn
            // at the resolution the table actually has — read from the table,
            // never written here, because the two went out of step once already.
            const colSubs = blend ? Math.min(8, 1 + Math.round(jump)) : 1;
            const subs = geoSubs > colSubs ? geoSubs : colSubs;
            // Below ~1° the great circle and the straight screen line agree to
            // well under a pixel, and slerp divides by a sine that is heading
            // for zero. A colour-only subdivision takes the straight line.
            const useSlerp = ang > 0.02;
            const pA = j0 * STRIDE, pB = j1 * STRIDE;
            for (let s2 = 1; s2 < subs && smoothLeft > 0; s2++) {
              const tt = s2 / subs;
              if (useSlerp) {
                const fA = Math.sin((1 - tt) * ang) / sinA;
                const fB = Math.sin(tt * ang) / sinA;
                cameraTransformInto((fA * ax + fB * bx2) * SPHERE_RADIUS,
                                    (fA * ay + fB * by2) * SPHERE_RADIUS,
                                    (fA * az + fB * bz2) * SPHERE_RADIUS, _arcC);
                if (!projectInto(_arcC[0], _arcC[1], _arcC[2], _gridProj)) continue;
                _cenX[cn] = _gridProj[0];
                _cenY[cn] = _gridProj[1];
              } else {
                _cenX[cn] = buf[pA]     + (buf[pB]     - buf[pA])     * tt;
                _cenY[cn] = buf[pA + 1] + (buf[pB + 1] - buf[pA + 1]) * tt;
              }
              _cenW[cn] = w0 + (w1 - w0) * tt;
              _cenA[cn] = a0 + (a1 - a0) * tt;
              _cenC[cn] = blend
                ? featuresToColor(t0f + (t1f - t0f) * tt, n0f + (n1f - n0f) * tt)
                : _lineColor[a + k];
              cn++; smoothLeft--;
            }
          }
        }
      }
      // ── A PAINTED LINE, NOT A CHAIN OF BRICKS (2026-09-13) ──────────────
      // Ek: "it looks super blockey it used to be smooth." Three causes, all
      // introduced by giving the line its own timbre colour a few hours
      // earlier, and all here.
      //
      // ONE — every colour change started a NEW ribbon, and every ribbon got
      // the extended end caps below. So a mid-stroke change to the sound put
      // two half-segment caps back to back in the middle of the line: a blunt
      // rectangle wider than the line it interrupts. A stroke whose timbre
      // moved became a row of them. The outline is built ONCE for the whole
      // run now and the colours are filled as pieces of it, each piece sharing
      // its boundary points with its neighbour, so there is nothing to cap and
      // nothing to overlap.
      //
      // TWO — the colour STEPPED at each mark, 50 ms of hand travel apart. It
      // is interpolated across the slerped sub-points instead, through the
      // same quantised table, so a sound moving through the ramp draws a
      // gradient. Marks whose colour already agrees cost nothing: the blend
      // only runs where two neighbours actually differ.
      //
      // THREE — width came straight off each mark's rms, and rms at 20 Hz is
      // not smooth. Two passes of a [1 2 1] kernel over the DENSIFIED centres
      // turn the steps into swells without touching where the line goes. The
      // stroke still reads as a pressure line; it just stops faceting.
      //
      // FOUR — the CORNERS. Densification curves the span between two marks
      // along its great circle, which is the right path, but it cannot round
      // the angle AT a mark: the hand is sampled at 20 Hz and a turn inside
      // one tick arrives as a crease. The same [1 2 1] kernel over the centre
      // positions rounds those over about two sub-points. The two ENDS are
      // pinned — the caps below are measured off the original marks, and an
      // end that crept inward would put the erase gap back out of true.
      // AND IT IS CAPPED AT THE RIBBON'S OWN HALF-WIDTH, which is the rule that
      // makes it safe. Unclamped, the kernel moved the drawn centre by 0.35 px
      // at the median but by 20 px at the sharpest crease, and near the
      // silhouette — where the rectilinear projection goes through tan and two
      // neighbours can land a whole canvas apart — by SIX HUNDRED. A line that
      // far off its own marks is a line the eraser and the trigger gate can no
      // longer find. Clamped to the half-width, the smoothed centre never
      // leaves the ribbon the unsmoothed path would have drawn, so every
      // corner softens by as much as it can afford and no further.
      // The clamp is applied ONCE, to the total displacement from where the
      // mark actually is — not per pass. Clamping inside the loop let pass two
      // start from an already-moved point and spend the whole budget again, so
      // the guarantee the clamp exists to give ("never leaves the ribbon the
      // unsmoothed path would have drawn") was worth 2w, not w, and near the
      // silhouette both passes saturate. So: keep the originals, smooth freely,
      // then pull the result back inside one half-width of where it started.
      const n = cn;
      for (let k = 0; k < n; k++) { _cenXO[k] = _cenX[k]; _cenYO[k] = _cenY[k]; }
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k < n; k++) {
          const kP = k > 0 ? k - 1 : 0, kN = k < n - 1 ? k + 1 : n - 1;
          _cenW2[k] = 0.25 * _cenW[kP] + 0.5 * _cenW[k] + 0.25 * _cenW[kN];
          if (k === 0 || k === n - 1) { _cenX2[k] = _cenX[k]; _cenY2[k] = _cenY[k]; continue; }
          _cenX2[k] = 0.25 * (_cenX[kP] + _cenX[kN]) + 0.5 * _cenX[k];
          _cenY2[k] = 0.25 * (_cenY[kP] + _cenY[kN]) + 0.5 * _cenY[k];
        }
        for (let k = 0; k < n; k++) {
          _cenW[k] = _cenW2[k]; _cenX[k] = _cenX2[k]; _cenY[k] = _cenY2[k];
        }
      }
      for (let k = 1; k < n - 1; k++) {
        const dx = _cenX[k] - _cenXO[k], dy = _cenY[k] - _cenYO[k];
        const cap = _cenW[k], d2 = dx * dx + dy * dy;
        if (d2 > cap * cap) {
          const f = cap / Math.sqrt(d2);
          _cenX[k] = _cenXO[k] + dx * f;
          _cenY[k] = _cenYO[k] + dy * f;
        }
      }
      // Offset each point perpendicular to the local path direction by its
      // own half-width — a filled ribbon whose width IS the recorded volume.
      // Scratch buffers are preallocated; this allocates nothing.
      let pnx = 0, pny = -1;   // carried normal for zero-length segments
      let snx = 0, sny = -1, enx = 0, eny = -1;   // end normals, for the caps
      for (let k = 0; k < n; k++) {
        const kP = Math.max(0, k - 1), kN = Math.min(n - 1, k + 1);
        const tx = _cenX[kN] - _cenX[kP], ty = _cenY[kN] - _cenY[kP];
        const len = Math.hypot(tx, ty);
        let nx, ny;
        if (len > 1e-6) { nx = -ty / len; ny = tx / len; pnx = nx; pny = ny; }
        else            { nx = pnx; ny = pny; }
        if (k === 0)     { snx = nx; sny = ny; }
        if (k === n - 1) { enx = nx; eny = ny; }
        const w = _cenW[k];
        _ribX[k] = _cenX[k] + nx * w;      _ribY[k] = _cenY[k] + ny * w;
        _ribX[2 * n - 1 - k] = _cenX[k] - nx * w;
        _ribY[2 * n - 1 - k] = _cenY[k] - ny * w;
      }
      // MATERIAL-TRUE END CAPS (2026-08-28): each mark owns half a segment of
      // line on each side, so a run extends half its terminal segment past
      // the end marks. Without this, an erase gap could only span
      // survivor-to-survivor and always read one full mark-spacing WIDER than
      // the material removed — at sparse spacing "the eraser bites double its
      // diameter" even though removal was exact.
      // A cap only extends across a TRUE adjacency: if the terminal segment
      // is itself a bridge (a musical rest the gate recorded — anything past
      // the paint tick), extending half of it would draw material that was
      // never there. Bridges get flat caps. They belong to the RUN, so only
      // the first and last colour piece wear one.
      const iA = _lineIdx[a] * STRIDE,     iA1 = _lineIdx[a + 1] * STRIDE;
      const iZ = _lineIdx[b - 1] * STRIDE, iZ1 = _lineIdx[b - 2] * STRIDE;
      const adjS = 1.6 * ((S.paintTicker?.intervalMs ?? 50) / 1000);
      const fS = (_timeBuf[_lineIdx[a + 1]] - _timeBuf[_lineIdx[a]]) <= adjS ? 0.5 : 0;
      const fE = (_timeBuf[_lineIdx[b - 1]] - _timeBuf[_lineIdx[b - 2]]) <= adjS ? 0.5 : 0;
      const exSX = buf[iA] + (buf[iA] - buf[iA1]) * fS;
      const exSY = buf[iA + 1] + (buf[iA + 1] - buf[iA1 + 1]) * fS;
      const exEX = buf[iZ] + (buf[iZ] - buf[iZ1]) * fE;
      const exEY = buf[iZ + 1] + (buf[iZ + 1] - buf[iZ1 + 1]) * fE;
      const sw = _cenW[0];
      const ew = _cenW[n - 1];
      const ctx = S.ctx;
      // One piece of the shared outline: forward along the left edge from s to
      // e, back along the right edge. Point e is drawn by this piece AND by
      // the next one's start, which is what makes the seam invisible without
      // overlapping any area.
      const piece = (s0, e0) => {
        ctx.globalAlpha = _cenA[s0];
        ctx.fillStyle   = _cenC[s0];
        ctx.beginPath();
        ctx.moveTo(_ribX[s0], _ribY[s0]);
        for (let k = s0 + 1; k <= e0; k++) ctx.lineTo(_ribX[k], _ribY[k]);
        if (e0 === n - 1) {
          ctx.lineTo(exEX + enx * ew, exEY + eny * ew);
          ctx.lineTo(exEX - enx * ew, exEY - eny * ew);
        }
        for (let k = e0; k >= s0; k--) ctx.lineTo(_ribX[2 * n - 1 - k], _ribY[2 * n - 1 - k]);
        if (s0 === 0) {
          ctx.lineTo(exSX - snx * sw, exSY - sny * sw);
          ctx.lineTo(exSX + snx * sw, exSY + sny * sw);
        }
        ctx.closePath();
        ctx.fill();
      };
      // Alpha is quantised to 1/16 before it can break a piece: it varies
      // continuously with depth along a stroke that wraps around the sphere,
      // so without a quantum every single centre becomes its own fill — at
      // 1/64 that measured one fill per point, and 1/16 is still finer than
      // any alpha step the eye finds on a thin ribbon.
      // The loop stops one short of the end so that `piece(s1, n - 1)` below is
      // the ONLY call that can satisfy `e0 === n - 1`. It is not a tidy-up: a
      // break landing on the last centre used to draw the body-plus-cap AND
      // then a degenerate `piece(n-1, n-1)`, which is the cap on its own, in
      // the next colour, composited over the first one. A two-mark run whose
      // marks differ in colour hits it every time, and so does any run where
      // the 1/16 alpha bucket happens to flip at the last centre — routine on
      // a stroke that wraps around the sphere. A colour change at the very
      // last centre is absorbed into the final piece instead, which is a run
      // one point long and covers no area.
      let s1 = 0;
      for (let k = 1; k < n - 1; k++) {
        if (_cenC[k] === _cenC[k - 1]
            && ((_cenA[k] * 16) | 0) === ((_cenA[k - 1] * 16) | 0)) continue;
        piece(s1, k);
        s1 = k;
      }
      piece(s1, n - 1);
    };
    for (let k = 1; k <= _lineCount; k++) {
      // `_gapBuf` is the erase's own stamp on the survivor before a hole —
      // the one break signal that works when the erase-split is deferred
      // (claimed stroke) and the hole is smaller than the time threshold.
      const brk = k === _lineCount
        || _strokeBuf[_lineIdx[k]] !== _strokeBuf[_lineIdx[k - 1]]
        || _origBuf[_lineIdx[k]]   !== _origBuf[_lineIdx[k - 1]] + 1
        || _timeBuf[_lineIdx[k]] - _timeBuf[_lineIdx[k - 1]] > _lineGapS
        || _gapBuf[_lineIdx[k - 1]] === 1;
      if (brk) { flush(runStart, k); runStart = k; }
    }
  }

  S.ctx.globalAlpha = 1;

  // ── Reach fan (the SELECTION, not the sound) ──────────────────────────────
  // Drawn on its own gate — the pool being fresh — and NEVER on the glow map.
  // It lived inside `if (_glowCache.size > 0)` until 2026-09-07, which made the
  // fan blink at the grain rate: on a slow patch (500 ms period, 500 ms grains)
  // the map empties for the frame or two between one grain expiring and the
  // next onset, and the whole selection vanished with it (Ek: "those lines show
  // which particles are selected under k — it is the selection area, not the
  // grain glow"). What the cursor can reach does not stop being true between
  // two onsets, and at a long period it is not true only 60 % of the time.
  //
  // Reach lines: the search radius stops being an abstract circle and becomes
  // visible reach. Also makes k / nearestMode / grainKAllMode self-evident —
  // k-all looks like a burst of spokes.
  //
  // ONE LINE PER CANDIDATE, ONE RING PER GRAIN (Ek, 2026-09-02). The fan is
  // the scheduler's published pool — the k marks the cursor is choosing from
  // THIS tick (S._cursorPool, grain.js) — not the glow map. The glow map is
  // grains in flight, and a grain outlives the tick that chose it by its
  // whole duration: at k = 1, 1000 ms grains and a 200 ms period, five dots
  // wore lines at once and the fan read as k = 5. So the two marks now say
  // two different things: a line is "reachable now", a ring is "sounding
  // now", and the count of lines IS k (or the radius's population in fill
  // mode). The pool is at most 20 ms stale, which is one tick behind the
  // reticle on a fast sweep and nothing anyone can see.
  //
  // REACH_MAX is a PERFORMANCE ceiling, not a readability one. It was 32,
  // chosen as "spokes stop reading as spokes past this" — without checking
  // that the default patch ships k = 99. Density is handled by ALPHA instead,
  // which degrades smoothly where a hard cap fell off a cliff: a few lines
  // draw crisp, a hundred draw as a faint fan that still reads as reach.
  //
  // The cloud gate stays (2026-08-30): a mark inside a pinned cloud is the
  // cloud's, the cursor does not granulate it (grain.js), and the pool
  // builder already leaves it out — but a cloud pinned between two ticks
  // would draw a line for one frame, and pins-audit § K counts the segments
  // a real drawFrame() issues, so the predicate is checked here as well.
  const pool = S._cursorPool;
  const poolFresh = pool && (performance.now() - (S._cursorPoolAt || 0)) < 120;
  if (poolFresh && pool.length > 0) {
    const scanOff = S.scanMuted;
    const ink = S.darkMode ? '#ffffff' : '#000000';
    spherePointInto(S._frameCursorLon, S._frameCursorLat, _arcW);
    cameraTransformInto(_arcW[0], _arcW[1], _arcW[2], _arcC);
    const cProj = project(_arcC[0], _arcC[1], _arcC[2]);
    if (cProj) {
      // ONE path for the whole fan, one stroke. Per-line beginPath/stroke
      // triplets are the exact pattern that made moving-cloud trails the #1
      // source of scheduler drift (see the render-path notes in CLAUDE.md).
      // Projection is the zero-alloc path: three scratch arrays, no objects.
      refreshCloudClaims();
      let n = 0;
      // Every mark up to the ceiling; above it, an even stride through the
      // pool. `drawn` is what the alpha ramp sees, so a sampled fan reads
      // at the same weight a full one would.
      const stride = pool.length > REACH_MAX ? Math.ceil(pool.length / REACH_MAX) : 1;
      S.ctx.beginPath();
      for (let i = 0; i < pool.length; i += stride) {
        const particle = pool[i];
        if (isCloudClaimed(particle)) continue;   // a pinned cloud's, not the cursor's
        spherePointInto(particle.lon, particle.lat, _arcW);
        cameraTransformInto(_arcW[0], _arcW[1], _arcW[2], _arcC);
        if (!projectInto(_arcC[0], _arcC[1], _arcC[2], _projA)) continue;
        S.ctx.moveTo(cProj.sx, cProj.sy);
        S.ctx.lineTo(_projA[0], _projA[1]);
        n++;
      }
      if (n) {
        // Floor is 0.25 at a full fan, roughly 0.49 for a handful. Scan off
        // keeps the fan — reach is still true — at the muted marker's weight.
        S.ctx.strokeStyle  = ink;
        S.ctx.lineWidth    = 1;
        // The DENSITY the fan stands for, not the count drawn: a sampled
        // fan of 128 out of 3000 must read as dense, not as a handful.
        const dens = Math.min(1, (n * stride) / 64);
        S.ctx.globalAlpha  = 0.5 * (1 - 0.5 * dens) * (scanOff ? 0.4 : 1);
        S.ctx.stroke();
        S.ctx.globalAlpha  = 1;
      }
    }
  }

  // ── Active grain highlight (second pass) ──────────────────────────────────
  // Draw a bright dot over every particle that currently has a grain playing.
  // Uses projections cached during the main loop to avoid redundant math.
  //
  // BRIGHT MEANS SOUNDING, and the MARK says which it is, not the cap. With the
  // lens off the cursor fires nothing and grain.js simulates the onsets it
  // would have had, so you can still see what the cursor is over; those marks
  // are tagged `ghost` and drawn faint. This pass used to dim on `S.scanMuted`
  // instead — the whole batch, cursor and cloud alike — which greyed the live
  // marks of a PINNED CLOUD that was still playing perfectly audibly under the
  // cap (Ek, 2026-09-15). The tag survives the cap, so the two can be told
  // apart in the one place that has to tell them apart.
  if (_glowCache.size > 0) {
    const ink = S.darkMode ? '#ffffff' : '#000000';
    // ONE MARK, ONE WEIGHT (Ek, 2026-09-07: "i don't want different core or
    // alphas, i want the same. use the x2 and 0.92 alpha for all"). Everything
    // that made one sounding grain look different from another is gone: the
    // core-and-ring face and its duration threshold, the onset-rate ramp that
    // replaced it, and the per-mark heat that predated both. A grain sounding
    // is a grain sounding; the mark says so at full weight whether it is one
    // every half second or three hundred a second, and the eye is left to read
    // the field from how many marks are lit and for how long — which is the
    // engine's own doing, not the renderer's editorial. The two constants are
    // the ones Ek picked off the old ramp's top end.
    //
    // The three deletions took three days and each one was the same finding.
    // The ring past a duration threshold: "when i drag down i see big circles
    // then they disappear". Moving that threshold onto the onset rate: same
    // seam, new place. Ramping it continuously instead: "i don't want
    // different core or alphas". A performance surface is read at a glance
    // while both hands are busy, and every rule that makes the same event look
    // different in different conditions is one more thing to decode first.
    //
    // DELIBERATE: this pass sizes off the PARTICLE_BASE_SIZE / PARTICLE_MAX_SIZE
    // constants (4 / 20) while the paint pass above reads S.vizMinSize /
    // S.vizMaxSize. The two size systems are divorced on purpose — this is a
    // fixed-size MARKER LAYER, and that is the whole reason it survives the
    // sliders. Tie the core to vizMaxSize and the marker grows with the paint
    // it is meant to stand out against, so at a high ceiling the highlight
    // stops being findable exactly when the field is dense enough to need it.
    // The layer's job is "which grain is sounding", which has nothing to do
    // with how loud that grain was. (Recorded 2026-08-24; docs/archive/viz-changes-for-cli.md
    // flagged it as an accident, and Ek's call was to keep it fixed.)
    //
    // DEPTH is the one thing still allowed to move the mark, and it is not a
    // weighting: it is where the mark IS. The core rides the same depth ramp
    // the paint under it does, so a mark on the far side does not read as
    // nearer than the material around it. Alpha does not, or depth would be
    // counted twice and the far side would fade out of a layer whose whole
    // job is to be findable.
    _glowDots.length = 0;
    _ghostDots.length = 0;
    for (const [particle, { sx, sy, depth }] of _glowCache) {
      const entry = activeGrainMap.get(particle);
      // A loop or trigger tags its playhead mark in the loop's own colour
      // (grain.js, seq block) so the paint pass can brighten it as the head
      // passes. That head already wears the SQUARE (_drawPlayheadSquare); a
      // circle here as well drew both markers on one mark (Ek, 2026-09-02).
      // The circle is for grains — white tags, cursor and cloud alike.
      if (!entry || entry.glowColor !== '#ffffff') continue;
      const df   = Math.max(0, depthFactor(depth));
      const base = PARTICLE_BASE_SIZE + (PARTICLE_MAX_SIZE - PARTICLE_BASE_SIZE) * df;
      (entry.ghost ? _ghostDots : _glowDots).push(sx, sy, Math.max(3.2, base * GLOW_CORE));
    }
    // Two paths, one stroke each — the batching the pass exists for, kept.
    _strokeGlowDots(_glowDots,  GLOW_ALPHA, ink);
    _strokeGlowDots(_ghostDots, GLOW_ALPHA * 0.25, ink);
    S.ctx.globalAlpha = 1;
  }

  // ── Sequential playhead indicators ────────────────────────────────────────
  // Ring around the current playhead particle for each active sequence.
  for (let ti = 0; ti < S.commitSlotCount; ti++) {
    const seq = S.commitSlots[ti];
    if (!seq || seq.type !== 'loop' || !seq.playing || !seq.particles.length) continue;
    const p = seq.particles[seq.playheadIndex];
    if (!p) continue;
    spherePointInto(p.lon, p.lat, _arcW);
    cameraTransformInto(_arcW[0], _arcW[1], _arcW[2], _arcC);
    const proj = project(_arcC[0], _arcC[1], _arcC[2]);
    if (!proj) continue;
    // depthFactor, not the raw 2R formulas — see the trigger playhead note.
    const df = Math.max(0, depthFactor(rampDepth(_arcC[0], _arcC[1], _arcC[2], proj.depth)));
    // The same square as the trigger playhead — a held loop is the same kind
    // of time; alpha floored like the particle pass.
    _drawPlayheadSquare(proj.sx, proj.sy, df, 0.9 * (0.35 + 0.65 * df));
    if (seq.overdubs?.length && S.audioCtx) _drawOverdubHeads(seq, proj.sx, proj.sy);
  }

  // ── Sequence anchor markers ──────────────────────────────────────────────
  // Ring + dot + slot number at each sequence's anchor position.
  // Uses anchorLon/anchorLat (drop point for D-drops, first particle for strokes).
  // The selected pin is the one the rail marks and unpin takes — the same
  // question drawSeeds asks for clouds. This pass never asked it, so a loop
  // selected in the rail showed nothing here (2026-09-13).
  const selLoop = S._selectedPinSlot?.(S._frameCursorLon ?? 0, S._frameCursorLat ?? 0) ?? -1;
  for (let si = 0; si < S.commitSlotCount; si++) {
    const seq = S.commitSlots[si];
    if (!seq || seq.type !== 'loop') continue;
    const aLon = seq.anchorLon ?? seq.particles[0]?.lon;
    const aLat = seq.anchorLat ?? seq.particles[0]?.lat;
    if (aLon == null || aLat == null) continue;
    spherePointInto(aLon, aLat, _arcW);
    cameraTransformInto(_arcW[0], _arcW[1], _arcW[2], _arcC);
    const proj = project(_arcC[0], _arcC[1], _arcC[2]);
    if (!proj) continue;
    const df = Math.max(0, depthFactor(rampDepth(_arcC[0], _arcC[1], _arcC[2], proj.depth)));
    const a = (seq.playing ? 0.9 : 0.4) * (0.35 + 0.65 * df);
    _drawAnchorMark(proj.sx, proj.sy, seq.color, a, si + 1, !seq.playing);
    if (si === selLoop) _drawFocusBracket(proj.sx, proj.sy, FOCUS_R, a * 0.85, FOCUS_INK());
  }

  drawTriggers();
}

// ── Armed triggers ──────────────────────────────────────────────────────────
// A trigger has no slot chip in the commit bank, so the sphere is the only
// readout it gets. Three things need to be visible at a glance, mid-set:
// which strokes are armed, how close the cursor is to firing one, and which one
// is sounding right now.
//
// The halo is drawn at the stroke's NEAREST point to the cursor, not at its
// anchor. The hit test is stroke-wide — any particle counts — so a circle
// pinned to the anchor would show a catchment area that isn't the real one.
// For a long paint stroke the two are nowhere near each other.
// Budget for the armed-stroke outlines, shared across all triggers — the same
// discipline _TRAIL_BUDGET enforces for moving clouds. Trigger strokes are
// static, but there can be 32 of them and the render loop shares a thread with
// a scheduler that needs sample-accurate onsets.
// (The shared outline budget was replaced 2026-08-28 by a fixed 48-point
// per-trigger cap — dividing by the trigger count made every erase-split
// resample the outline. See the stride note in drawTriggers.)
const _trigProj = [0, 0, 0];
// An overdub's head (Ek, 2026-09-05: "I should see a playhead on the overdub
// as well, tethered to the main loop playhead"). Where the master's phase
// falls in the take (grain.js overdubHeads — one head per stacked pass), the
// mark of the overdub's stroke nearest that moment wears the same square at
// a lower alpha, and a thin line runs to the master's head: the layer has no
// clock of its own, and the line says so. The stroke's marks are cached on
// the overdub, sorted by take time, and dropped when the particle set
// changes (an erase) — a per-frame filter over S.particles would not do.
const _ovProj = [0, 0, 0];
const _ovHeads = [];
function _overdubMarks(ov) {
  // Keyed on the particle version AND the count: a take still recording
  // grows its stroke every tick without bumping the version.
  const ver = S._particleVersion + ':' + S.particles.length;
  if (ov._marks && ov._marksVer === ver) return ov._marks;
  const m = [];
  for (const p of S.particles) if (p.strokeId === ov.strokeId) m.push(p);
  m.sort((a, b) => a.grainStart - b.grainStart);
  ov._marks = m; ov._marksVer = ver;
  return m;
}
function _markAtTakeTime(marks, t) {
  let lo = 0, hi = marks.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (marks[mid].grainStart < t) lo = mid + 1; else hi = mid; }
  if (lo > 0 && t - marks[lo - 1].grainStart < marks[lo].grainStart - t) lo--;
  return marks[lo];
}
function _drawOverdubHeads(seq, mx, my) {
  const phase = masterPhaseWall(seq, S.audioCtx.currentTime);
  const ink = S.darkMode ? '#ffffff' : '#000000';
  for (const ov of seq.overdubs) {
    if (!(ov.strokeId > 0) || !ov.layer) continue;
    const marks = _overdubMarks(ov);
    if (!marks.length) continue;
    // A sealed take is its buffer's length; a take still recording is heard
    // only as far as its last fold — one head per pass of THAT.
    const takeDur = ov.buffer?.duration ?? ov.foldedS ?? ov.layer.duration;
    overdubHeads(ov, phase, takeDur, _ovHeads);
    for (let h = 0; h < _ovHeads.length; h++) {
      const p = _markAtTakeTime(marks, _ovHeads[h]);
      spherePointInto(p.lon, p.lat, _arcW);
      cameraTransformInto(_arcW[0], _arcW[1], _arcW[2], _arcC);
      if (!projectInto(_arcC[0], _arcC[1], _arcC[2], _ovProj)) continue;
      const df = Math.max(0, depthFactor(rampDepth(_arcC[0], _arcC[1], _arcC[2], _ovProj[2])));
      const a  = 0.35 + 0.65 * df;
      S.ctx.save();
      S.ctx.globalAlpha = 0.45 * a;
      S.ctx.strokeStyle = ink;
      S.ctx.lineWidth   = 1;
      S.ctx.beginPath(); S.ctx.moveTo(mx, my); S.ctx.lineTo(_ovProj[0], _ovProj[1]); S.ctx.stroke();
      S.ctx.restore();
      _drawPlayheadSquare(_ovProj[0], _ovProj[1], df, 0.6 * a);
    }
  }
}

// A loop's playhead is a SQUARE — the granulation marker's core + outline, in
// ink, at the granulation marker's size, but square (Ek, 2026-09-02). Shape is
// the whole difference between "a grain is sounding here" (circle) and "a
// loop's head is here" (square); the loop's own colour lives on its anchor
// marker and its rail chip, not on the head. The tangent-oriented rectangle
// this replaces was smaller than the circle and read as a third thing.
// Axis-aligned on purpose: a square that turns with the path stops being a
// square at a glance. Same floored depth fade as the particles.
const _tickProj = [0, 0, 0];   // scratch for the trigger outline below

function _drawPlayheadSquare(x, y, df, alpha) {
  const base = PARTICLE_BASE_SIZE + (PARTICLE_MAX_SIZE - PARTICLE_BASE_SIZE) * df;
  const core = Math.max(1.6, base * 0.42);
  const half = Math.max(6,   base * 1.5);
  const ink  = S.darkMode ? '#ffffff' : '#000000';
  S.ctx.save();
  S.ctx.globalAlpha = alpha;
  S.ctx.fillStyle   = ink;
  S.ctx.beginPath(); S.ctx.arc(x, y, core, 0, Math.PI * 2); S.ctx.fill();
  S.ctx.globalAlpha = alpha * 0.8;
  S.ctx.strokeStyle = ink;
  S.ctx.lineWidth   = 1.1;
  S.ctx.strokeRect(x - half, y - half, half * 2, half * 2);
  S.ctx.restore();
}

function drawTriggers() {
  const trigs = S.triggers;
  if (!trigs || trigs.length === 0) return;

  // Capped, draw faintly and never show the proximity or firing states. The
  // gate keeps tracking `_inside` under the cap (so uncapping doesn't bang
  // whatever the cursor is on), and drawing that would promise a shot that
  // isn't coming.
  const live = !S.scanMuted && S.lensReads !== 'grains';
  const parkedAlpha = 0.45;   // multiplier applied to everything while capped

  // ── Armed-stroke outlines ────────────────────────────────────────────────
  // Which strokes are armed has to be visible without firing them. Drawn as
  // decimated polylines through each stroke's particles, batched into one path
  // per trigger. Stride is derived from the shared budget so a sphere full of
  // long strokes costs the same as one with a few.
  // A stroke claimed by a live loop slot draws no armed outline: its trigger
  // cannot fire while claimed (#241), and with the rebuild deferred its
  // particle list may still hold erased marks — the outline would trace
  // material that is no longer there.
  const claimed = claimedStrokeIds();
  let _trigSmoothLeft = 400;   // outline slerp budget, per frame
  S.ctx.save();
  S.ctx.lineWidth = 1;
  for (let i = 0; i < trigs.length; i++) {
    const t = trigs[i];
    if (claimed && claimed.has(t.strokeId)) continue;
    const ps = t.particles;
    if (!ps || ps.length < 2) continue;
    // STABLE stride (2026-08-28): this used to divide the budget by the
    // trigger COUNT, so the split that follows every erase changed the
    // stride and resampled the outline's points along the whole stroke —
    // "the line shifts a little to adjust". A per-trigger cap keeps the
    // sampled marks fixed for any stroke of ≤48 marks and nearly fixed
    // above; total worst case is bounded by MAX×48 points, same order as
    // the old shared budget.
    const stride = Math.max(1, Math.ceil(ps.length / 48));
    S.ctx.globalAlpha = (live && t.trigger?._inside ? 0.5 : 0.22) * (live ? 1 : parkedAlpha);
    S.ctx.strokeStyle = t.color;
    S.ctx.beginPath();
    let started = false;
    let prevP = null;
    for (let pi = 0; pi < ps.length; pi += stride) {
      const p = ps[pi];
      // Slerp between decimated samples so the outline follows the great
      // circle instead of chording — same smoothing as the stroke ribbon,
      // with its own small budget (the stride makes the chords LONG).
      if (started && prevP && _trigSmoothLeft > 0 &&
          p._cx !== undefined && prevP._cx !== undefined) {
        const dt = prevP._cx * p._cx + prevP._cy * p._cy + prevP._cz * p._cz;
        const ang = Math.acos(Math.max(-1, Math.min(1, dt)));
        if (ang > 0.05) {
          const subs = Math.min(5, Math.ceil(ang / 0.05));
          const sinA = Math.sin(ang);
          for (let s2 = 1; s2 < subs && _trigSmoothLeft > 0; s2++) {
            const tt = s2 / subs;
            const fA = Math.sin((1 - tt) * ang) / sinA;
            const fB = Math.sin(tt * ang) / sinA;
            cameraTransformInto((fA * prevP._cx + fB * p._cx) * SPHERE_RADIUS,
                                (fA * prevP._cy + fB * p._cy) * SPHERE_RADIUS,
                                (fA * prevP._cz + fB * p._cz) * SPHERE_RADIUS, _arcC);
            if (projectInto(_arcC[0], _arcC[1], _arcC[2], _tickProj) &&
                _onCanvasish(_tickProj[0], _tickProj[1])) {
              S.ctx.lineTo(_tickProj[0], _tickProj[1]);
              _trigSmoothLeft--;
            }
          }
        }
      }
      spherePointInto(p.lon, p.lat, _arcW);
      cameraTransformInto(_arcW[0], _arcW[1], _arcW[2], _arcC);
      if (!projectInto(_arcC[0], _arcC[1], _arcC[2], _trigProj)
          || !_onCanvasish(_trigProj[0], _trigProj[1])) { started = false; prevP = null; continue; }
      if (started) S.ctx.lineTo(_trigProj[0], _trigProj[1]);
      else { S.ctx.moveTo(_trigProj[0], _trigProj[1]); started = true; }
      prevP = p;
    }
    S.ctx.stroke();
  }
  S.ctx.restore();

  // ── Playhead ring on whatever is firing ──────────────────────────────────
  // No catchment halo: the reach is the cursor's search radius, and the cursor
  // already draws that ring around itself. A second ring of the same size at
  // each stroke would say the same thing twice and imply a per-trigger zone
  // that no longer exists. The stroke outline above carries "this is a
  // trigger" and brightens on proximity; this marks the one that's sounding.
  //
  // Trigger particles are never in activeGrainMap, so the glow the main
  // particle pass draws can't find them — the position has to come from the
  // trigger's own playheadIndex, exactly as the loop slots' indicator does.
  for (let i = 0; i < trigs.length; i++) {
    const t = trigs[i];
    let php = null, phIdx = 0;
    if (t.playing) {
      phIdx = t.playheadIndex;
      php = t.particles[phIdx];
    } else if (t._tail && S.audioCtx) {
      // A play-to-end tail: the source is detached and still sounding, and
      // the scheduler no longer advances playheadIndex — compute the marker
      // here from the tail record, the same maths the seq block uses.
      const tl = t._tail;
      const loopLen = tl.loopEnd - tl.loopStart;
      if (loopLen > 0 && t.particles.length) {
        const elapsed = (S.audioCtx.currentTime - tl.startedAt) * tl.speed;
        const pos = elapsed % loopLen;
        const bufTime = tl.direction === -1 ? tl.loopEnd - pos : tl.loopStart + pos;
        let best = 0, bd = Infinity;
        for (let pi = 0; pi < t.particles.length; pi++) {
          const d = Math.abs(t.particles[pi].grainStart - bufTime);
          if (d < bd) { bd = d; best = pi; }
        }
        php = t.particles[best]; phIdx = best;
      }
    }
    if (!php) continue;
    spherePointInto(php.lon, php.lat, _arcW);
    cameraTransformInto(_arcW[0], _arcW[1], _arcW[2], _arcC);
    if (!projectInto(_arcC[0], _arcC[1], _arcC[2], _trigProj)) continue;
    // depthFactor, not the raw 2R formulas: with the camera pulled back every
    // depth on the sphere exceeds 2R, and the old fixed cull hid the playhead
    // EVERYWHERE — which is what "the indicator disappears" was, whatever the
    // stroke was doing. updateDepthRamp() ran at the top of drawParticles.
    // Floored like the particle pass (0.35 + 0.65·df): depth DIMS, never
    // erases — with the camera pulled back the cursor's material sits at the
    // sphere's far surface (depth ≈ offZ + R, df ≈ 0), and a bare ·df there
    // multiplied the marker to 0.001 alpha. Same lesson as the 2R cull above.
    const df = Math.max(0, depthFactor(rampDepth(_arcC[0], _arcC[1], _arcC[2], _trigProj[2])));
    _drawPlayheadSquare(_trigProj[0], _trigProj[1], df,
                        0.95 * (0.35 + 0.65 * df) * (live ? 1 : parkedAlpha));
  }
}

// ── Minimal particle renderer (perfMode) ───────────────────────────────────
// Single pass, no depth sort, no second glow pass, no sequence markers.
//
// Batched fills.  The previous version issued one beginPath/arc/fill triplet
// per particle — at 20k particles × 30fps that is 600k canvas path operations
// per second, and it dominated the frame so completely that perfMode measured
// 1.00x against the full renderer.  Dropping the sort and the glow pass saves
// nothing next to that.  This is the same stall CLAUDE.md records for the
// trail renderer; the fix was applied there and never here.
//
// Particles are bucketed by quantised colour + alpha, counting-sorted into
// contiguous runs, then each bucket is drawn as ONE path.  That turns 20k path
// operations into at most a few hundred.  Safe because reordering draws is free
// here: nothing on the sphere depends on which dot lands on top.
//
// The full renderer keeps its per-particle beginPath/arc/fill triplet — the
// pattern CLAUDE.md names as the main GPU stall — and the reason written here
// used to be "back-to-front order is load-bearing there". It is not: there is
// no depth sort anywhere in this file (2026-09-13; `_sortIdx` was allocated and
// grown but never read, and has been dead since 7a30ab0). What IS load-bearing
// is PAINT order — a later mark draws over an earlier one — which bucketing
// would also break, so this is not a free change; but it should be weighed on
// what is true rather than refused on what is not.
//
// Also uses projectInto() rather than project(), which allocated an object and
// recomputed Math.tan() on every call — 300k allocations/sec at 10k particles.
const _PB_HUE = 16, _PB_SAT = 4, _PB_ALPHA = 6;
const _PB_VIZ  = _PB_HUE * _PB_SAT * _PB_ALPHA;   // 384 colour/alpha buckets
const _PB_GLOW  = _PB_VIZ;                         // active grains — one bucket
const _PB_MUTED = _PB_VIZ + 1;                     // muted loop material — one more
const _PB_N     = _PB_VIZ + 2;

// Cached bucket → colour string table (rebuilt only when dark mode flips).
let _pbColors = null, _pbColorsDark = null;
function _pbColorTable() {
  if (_pbColors && _pbColorsDark === S.darkMode) return _pbColors;
  _pbColors = new Array(_PB_VIZ);
  for (let h = 0; h < _PB_HUE; h++) {
    for (let s = 0; s < _PB_SAT; s++) {
      const col = featuresToColor(h / (_PB_HUE - 1), s / (_PB_SAT - 1));
      for (let a = 0; a < _PB_ALPHA; a++) _pbColors[(h * _PB_SAT + s) * _PB_ALPHA + a] = col;
    }
  }
  _pbColorsDark = S.darkMode;
  return _pbColors;
}

// Scratch, grown on demand and reused across frames — zero per-frame allocation.
let _pbX = null, _pbY = null, _pbR = null, _pbB = null, _pbCap = 0;
let _pbOX = null, _pbOY = null, _pbOR = null;
const _pbCount = new Int32Array(_PB_N);
const _pbOfs   = new Int32Array(_PB_N + 1);

function drawParticlesMinimal() {
  const parts = S.particles;
  const n = parts.length;
  if (n === 0) return;
  // perfMode draws through its own loop, so it needs the same ramp and the same
  // cull as drawParticles — otherwise pulling back would look right until you
  // pressed p, and then half the sphere would paint through itself.
  updateDepthRamp();
  if (_pbCap < n) {
    _pbCap = n;
    _pbX = new Float32Array(n); _pbY = new Float32Array(n); _pbR = new Float32Array(n);
    _pbB = new Int32Array(n);
    _pbOX = new Float32Array(n); _pbOY = new Float32Array(n); _pbOR = new Float32Array(n);
  }
  // THE SAME FOV COMPENSATION THE FULL RENDERER APPLIES. Without it, pressing
  // `p` changed every dot's size: zoomed out to the 360° map the factor clamps
  // to 0.35, so perfMode's dots came out 2.9× larger and flooded the map, and
  // zoomed in they shrank instead of growing. perfMode exists to be pressed
  // mid-set, so the jump landed at the worst possible moment.
  const _zf = Math.max(0.35, Math.min(1.6, 80 / (S.fovDeg ?? FOV_DEG)));
  const pBase = (S.vizMinSize ?? PARTICLE_BASE_SIZE) * _zf;
  const pMax  = (S.vizMaxSize ?? PARTICLE_MAX_SIZE) * _zf;
  const _pW = _pbW, _pC = _pbC, _pj = _pbProj;
  const hasGlow = activeGrainMap.size > 0;
  const glowColor = S.darkMode ? '#ffffff' : '#000000';
  const mutedColor = S.darkMode ? MUTED_PARTICLE_DARK : MUTED_PARTICLE_LIGHT;
  // Same self-healing mark pass as the full renderer, so perfMode does not
  // quietly lose the one cue that says which material is silent.
  const anyMuted = syncParticleMarks();
  const ctx = S.ctx;

  _pbCount.fill(0);
  let vis = 0;          // visible, bucketable particles
  let legacyDrawn = 0;  // pre-feature particles fall back to individual draws

  for (let i = 0; i < n; i++) {
    const p = parts[i];
    spherePointInto(p.lon, p.lat, _pW);
    cameraTransformInto(_pW[0], _pW[1], _pW[2], _pC);
    const cx = _pC[0], cy = _pC[1], cz = _pC[2];
    if (!projectInto(cx, cy, cz, _pj)) continue;
    const sx = _pj[0], sy = _pj[1], depth = _pj[2];
    const mag    = Math.sqrt(cx * cx + cy * cy + cz * cz);
    let facing;
    if (!_dfPulled) {
      facing = mag > 0 ? Math.max(0, cz / mag) : 0;
    } else {
      // Same inner-face cull as drawParticles — see the note there.
      const nz  = cz - camOffsetZ();
      const ndc = cx * cx + cy * cy + nz * cz;
      if (ndc <= 0) continue;
      facing = Math.min(1, ndc / (mag * SPHERE_RADIUS));
    }
    const df = Math.max(0, depthFactor(_dfPulled ? mag : depth));
    // The same filter the full renderer uses: only the WHITE tags are grains.
    // A loop or trigger playhead tags its mark in the loop's own colour, and
    // lighting those here made every mark a pinned loop's playhead crossed
    // flash solid white at 0.95 alpha in perfMode and not in the full renderer.
    // A GHOST is not active. perfMode has no faint second pass to put the
    // muted-scan preview in, and lighting it here would say "sounding" at 0.95
    // alpha about a mark making no sound — the same lie the full renderer told
    // in the other direction by dimming the clouds (2026-09-15).
    const _ag = hasGlow ? activeGrainMap.get(p) : undefined;
    const active = !!_ag && _ag.glowColor === '#ffffff' && !_ag.ghost;

    if ((p.rms ?? 0) > 0) {
      const rmsN = normalise(p.rms, S.vizRmsMin, S.vizRmsMax);
      const size = (pBase + (pMax - pBase) * rmsN) * (0.5 + 0.5 * df);
      const alpha = active ? 0.95 : (0.35 + 0.65 * df) * (0.5 + 0.5 * facing);
      let bucket;
      if (anyMuted && p._composerMuted) {
        // Its own bucket rather than a colour override: this path batches by
        // bucket and draws each as one path, so a per-particle colour would
        // break the batching that perfMode exists for.
        bucket = _PB_MUTED;
      } else if (active) {
        bucket = _PB_GLOW;
      } else {
        const cN = p.tilt ?? normaliseCentroid(p.centroid ?? 0, S.vizCentroidMin, S.vizCentroidMax);
        let hb = (cN * _PB_HUE) | 0;            if (hb >= _PB_HUE) hb = _PB_HUE - 1; else if (hb < 0) hb = 0;
        let sb = ((p.noise ?? p.zcr ?? 0) * _PB_SAT) | 0;  if (sb >= _PB_SAT) sb = _PB_SAT - 1; else if (sb < 0) sb = 0;
        let ab = (alpha * _PB_ALPHA) | 0;       if (ab >= _PB_ALPHA) ab = _PB_ALPHA - 1; else if (ab < 0) ab = 0;
        bucket = (hb * _PB_SAT + sb) * _PB_ALPHA + ab;
      }
      _pbX[vis] = sx; _pbY[vis] = sy; _pbR[vis] = size; _pbB[vis] = bucket;
      _pbCount[bucket]++; vis++;
    } else {
      // Legacy particle with no captured features — palette colour, drawn
      // individually.  Only reachable for clouds imported from before feature
      // capture existed, so this path is effectively empty in practice.
      const legacyMuted = anyMuted && p._composerMuted;
      ctx.globalAlpha = legacyMuted ? 0.45
                      : active ? 0.95 : (0.3 + 0.7 * df) * (0.5 + 0.5 * facing);
      ctx.fillStyle   = legacyMuted ? mutedColor : active ? glowColor : p.color;
      ctx.beginPath(); ctx.arc(sx, sy, pBase + (pMax - pBase) * df, 0, Math.PI * 2); ctx.fill();
      legacyDrawn++;
    }
  }

  // Prefix sum → contiguous run per bucket, then scatter.
  let acc = 0;
  for (let b = 0; b < _PB_N; b++) { _pbOfs[b] = acc; acc += _pbCount[b]; }
  _pbOfs[_PB_N] = acc;
  const cursor = _pbCount;                       // reuse as write cursor
  for (let b = 0; b < _PB_N; b++) cursor[b] = _pbOfs[b];
  for (let i = 0; i < vis; i++) {
    const b = _pbB[i], w = cursor[b]++;
    _pbOX[w] = _pbX[i]; _pbOY[w] = _pbY[i]; _pbOR[w] = _pbR[i];
  }

  // One path per non-empty bucket.
  const table = _pbColorTable();
  const TAU = Math.PI * 2;
  let pathOps = 0;
  for (let b = 0; b < _PB_N; b++) {
    const start = _pbOfs[b], end = _pbOfs[b + 1];
    if (start === end) continue;
    pathOps++;
    if (b === _PB_MUTED)     { ctx.globalAlpha = 0.45; ctx.fillStyle = mutedColor; }
    else if (b === _PB_GLOW) { ctx.globalAlpha = 0.95; ctx.fillStyle = glowColor; }
    else {
      // Bucket index encodes the alpha bin in its low digits; recover the bin
      // centre so a bucket's alpha is representative rather than its floor.
      ctx.globalAlpha = ((b % _PB_ALPHA) + 0.5) / _PB_ALPHA;
      ctx.fillStyle = table[b];
    }
    ctx.beginPath();
    for (let i = start; i < end; i++) {
      const x = _pbOX[i], y = _pbOY[i], r = _pbOR[i];
      ctx.moveTo(x + r, y);                      // moveTo prevents a connecting line
      ctx.arc(x, y, r, 0, TAU);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Counted inside the draw loop above rather than by a second pass over all
  // _PB_N buckets — that pass cost ~11.5k iterations/sec of the render budget
  // purely for telemetry nothing reads at runtime.
  _pbLastStats.visible = vis;
  _pbLastStats.legacy  = legacyDrawn;
  _pbLastStats.pathOps = pathOps;
}

// Module-scope scratch vectors — never returned, never resized.
const _pbW = [0, 0, 0], _pbC = [0, 0, 0], _pbProj = [0, 0, 0];
// Exposed for the render audit / perf work; not read by the app itself.
export const _pbLastStats = { visible: 0, legacy: 0, pathOps: 0 };

// ── Minimal seed/loop anchor markers (perfMode) ──────────────────────────────
// Static dot + slot number at each committed slot's INITIAL placement position.
// A pin's marker sits at its ANCHOR — where its gesture released (pins.js
// pinAnchorInto) — never at a moving cloud's interpolated position.
// Draws the search radius circle if one was set at placement time.
function drawSeedAnchorsMinimal() {
  const _aW = [0, 0, 0];
  const _aC = [0, 0, 0];
  const fovRad = ((S.fovDeg ?? FOV_DEG) * Math.PI) / 180;

  for (let si = 0; si < S.commitSlotCount; si++) {
    const slot = S.commitSlots[si];
    if (!slot) continue;
    let aLon, aLat, color, radiusDeg;
    if (!pinAnchorInto(slot, _anchorR)) continue;
    aLon = _anchorR[0]; aLat = _anchorR[1];
    if (slot.type === 'cloud') {
      color = slot.color || _tok('--eng-source', '#4aa3e8');
      radiusDeg = slot.searchRadiusDeg;
    } else if (slot.type === 'loop') {
      color = slot.color || _tok('--eng-tape', '#f2569e');
      radiusDeg = slot.searchRadiusDeg;
    } else continue;
    if (aLon == null || aLat == null) continue;

    spherePointInto(aLon, aLat, _aW);
    cameraTransformInto(_aW[0], _aW[1], _aW[2], _aC);
    const proj = project(_aC[0], _aC[1], _aC[2]);
    if (!proj || proj.depth > SPHERE_RADIUS * 2) continue;
    const df = Math.max(0, 1 - (proj.depth / (SPHERE_RADIUS * 2)));

    // Search radius circle at placement position
    if (radiusDeg && radiusDeg > 0) {
      const radiusRad = radiusDeg * Math.PI / 180;
      const radiusPx  = (radiusRad / fovRad) * Math.min(S.canvas.width, S.canvas.height) * 0.5;
      S.ctx.globalAlpha = 0.35 * df;
      S.ctx.strokeStyle = color;
      S.ctx.lineWidth = 1;
      S.ctx.beginPath(); S.ctx.arc(proj.sx, proj.sy, radiusPx, 0, Math.PI * 2); S.ctx.stroke();
    }

    // Anchor dot
    S.ctx.globalAlpha = 0.8 * df;
    S.ctx.fillStyle = color;
    S.ctx.beginPath(); S.ctx.arc(proj.sx, proj.sy, 5, 0, Math.PI * 2); S.ctx.fill();
    // Slot number
    S.ctx.font = 'bold 11px Urbanist, sans-serif';
    S.ctx.textAlign = 'center'; S.ctx.textBaseline = 'middle';
    S.ctx.fillText(si + 1, proj.sx, proj.sy - 14);
  }
  S.ctx.globalAlpha = 1;
}

// ── Cursor ────────────────────────────────────────────────────────────────────
//
// Two concentric zones. (There were three: Zone 2 was a "Mode Ring" of four
// arc segments at ~14px, and it is GONE from the code — this header went on
// describing it, in literal hexes, long after the last arc was deleted. That
// is how the six-colour cursor survived: a comment nobody could disagree with.)
//   Zone 1  Center reticle  — crosshair + dot: neutral idle, the tool's colour
//                             while painting, --mic-live-border while recording
//   Zone 3  Radius circle   — the reach. Its ink is the HAND's (S._handHue, the
//                             tile you pressed), and the two cursor states that
//                             outrank the hand wear their own token: erase is
//                             --eng-erase, scan-off is an empty ring in
//                             --text-faint. Nothing in hand: --text-tertiary.
// EVERY ONE OF THOSE IS READ FROM THE TOKEN, never copied here — see _tok().
//
// The reach ring drawn as the PROJECTED image of the true angular circle on
// the sphere. A flat screen circle of focalLen·tan(r) is exact only on the
// view axis: this is a rectilinear projection at 80° FOV, and off-axis the
// true region is an ELLIPSE — at a screen corner ~2.5× the flat ring's size.
// The ring is what the player aims the eraser and the triggers with, so what
// it shows must be what captures (Ek, 2026-08-28: "it doesn't look like it's
// on the sphere, just on the screen"). 36 perimeter points, built around the
// cursor's world direction (spherePointInto carries any frame rotation) and
// pushed through the same cameraTransform/project as every particle.
const _reachW = [0, 0, 0], _reachC = [0, 0, 0], _reachP = [0, 0, 0];

// The cursor's tangent frame, shared by the reach ring and the reticle so both
// read the surface the same way: n is the cursor's unit point on the sphere,
// e1/e2 an orthonormal basis of the tangent plane there.
const _cfN = [0, 0, 0], _cfE1 = [0, 0, 0], _cfE2 = [0, 0, 0];
function _cursorFrame(mx, my) {
  const c = screenToLonLat(mx, my);
  if (!c || isNaN(c.lon) || isNaN(c.lat)) return false;
  spherePointInto(c.lon, c.lat, _reachW);
  const nl = Math.hypot(_reachW[0], _reachW[1], _reachW[2]) || 1;
  const nx = _reachW[0] / nl, ny = _reachW[1] / nl, nz = _reachW[2] / nl;
  let e1x = -nz, e1y = 0, e1z = nx;                       // n × ŷ
  let el = Math.hypot(e1x, e1y, e1z);
  if (el < 1e-6) { e1x = 1; e1y = 0; e1z = 0; el = 1; }   // at a pole
  e1x /= el; e1y /= el; e1z /= el;
  _cfN[0]  = nx;  _cfN[1]  = ny;  _cfN[2]  = nz;
  _cfE1[0] = e1x; _cfE1[1] = e1y; _cfE1[2] = e1z;
  _cfE2[0] = ny * e1z - nz * e1y;
  _cfE2[1] = nz * e1x - nx * e1z;
  _cfE2[2] = nx * e1y - ny * e1x;
  return true;
}

function _reachPath(mx, my) {
  if (!_cursorFrame(mx, my)) return null;
  const r = S.searchRadiusDeg * Math.PI / 180;
  const nx  = _cfN[0],  ny  = _cfN[1],  nz  = _cfN[2];
  const e1x = _cfE1[0], e1y = _cfE1[1], e1z = _cfE1[2];
  const e2x = _cfE2[0], e2y = _cfE2[1], e2z = _cfE2[2];
  const cr = Math.cos(r) * SPHERE_RADIUS, sr = Math.sin(r) * SPHERE_RADIUS;
  const K = 36;
  const path = new Path2D();
  let started = false, count = 0;
  for (let k = 0; k <= K; k++) {
    const ph = (k % K) / K * 2 * Math.PI;
    const cp = Math.cos(ph), sp = Math.sin(ph);
    const wx = cr * nx + sr * (cp * e1x + sp * e2x);
    const wy = cr * ny + sr * (cp * e1y + sp * e2y);
    const wz = cr * nz + sr * (cp * e1z + sp * e2z);
    cameraTransformInto(wx, wy, wz, _reachC);
    if (!projectInto(_reachC[0], _reachC[1], _reachC[2], _reachP)
        || !_onCanvasish(_reachP[0], _reachP[1])) { started = false; continue; }
    if (started) path.lineTo(_reachP[0], _reachP[1]);
    else { path.moveTo(_reachP[0], _reachP[1]); started = true; }
    count++;
  }
  return count >= 3 ? path : null;
}

// ── Reticle shape — the projection's local distortion, once per frame ─────
//
// The reach ring is the TRUE projected circle, so off-axis it is an ellipse
// (see _reachPath). The reticle beside it was flat screen geometry — a circle
// and four axis-aligned arms — so at the edges the ring sat on the sphere and
// the crosshair sat on the glass (Ek, 2026-08-29). Tessellating the reticle the
// same way would be five more projected paths per frame for something 12px
// across; instead take the projection's 2×2 JACOBIAN at the cursor — the
// first-order image of the tangent plane — and draw the reticle in that frame.
// The ring becomes the same ellipse the reach ring is, the arms lie along the
// surface, and the whole thing costs four projections and one 2×2 SVD.
//
// Normalised by the SMALLER axis, so the least-stretched direction keeps its
// pixel size and the other grows exactly as the ring does — under the centred
// (azimuthal-equidistant) camera that is radial 1, tangential θ/sinθ, which is
// the ring's own stretch. Anisotropy is CAPPED because a pulled camera's
// silhouette shows the tangent plane edge-on, where the true ratio is infinite
// and an honest reticle is a 200px smear pointing nowhere.
const RETICLE_MAX_ANISO = 4;
const RETICLE_EPS = 0.02;                   // rad — finite-difference step
const _jP = [0, 0, 0], _jC = [0, 0, 0], _jCol = [0, 0];
// k1 = long axis (short axis is 1), rot = its screen angle, m** = the full map
// applied to reticle offsets. Identity when the cursor is on the view axis,
// which is every frame in surface and sensor mode.
const _ret = { k1: 1, rot: 0, m00: 1, m01: 0, m10: 0, m11: 1 };
// The camera's roll about the view axis — the rigid screen rotation the whole
// image picks up when the sensor rolls. camQ is composed qYaw · qPitch · qRoll
// (applyAxisMapQuat), so roll is the innermost factor and is the twist about Z.
function _camRollScreen() {
  const q = S.camQ;
  if (!q) return 0;
  // Same Ry·Rx·Rz convention camQ is built in. A body-side twist about Z is
  // NOT the roll here once yaw or pitch is non-zero — see _applyAxisSources.
  return Math.atan2(2 * (q[3]*q[2] + q[0]*q[1]), 1 - 2 * (q[0]*q[0] + q[2]*q[2]));
}
function _retIdentity() {
  _ret.k1 = 1; _ret.rot = 0;
  _ret.m00 = 1; _ret.m01 = 0; _ret.m10 = 0; _ret.m11 = 1;
  return _ret;
}
// Central difference along one tangent direction → px per radian.
function _retDeriv(ex, ey, ez, out) {
  const ce = Math.cos(RETICLE_EPS) * SPHERE_RADIUS;
  const se = Math.sin(RETICLE_EPS) * SPHERE_RADIUS;
  cameraTransformInto(ce * _cfN[0] + se * ex, ce * _cfN[1] + se * ey,
                      ce * _cfN[2] + se * ez, _jC);
  if (!projectInto(_jC[0], _jC[1], _jC[2], _jP)) return false;
  const ax = _jP[0], ay = _jP[1];
  cameraTransformInto(ce * _cfN[0] - se * ex, ce * _cfN[1] - se * ey,
                      ce * _cfN[2] - se * ez, _jC);
  if (!projectInto(_jC[0], _jC[1], _jC[2], _jP)) return false;
  out[0] = (ax - _jP[0]) / (2 * RETICLE_EPS);
  out[1] = (ay - _jP[1]) / (2 * RETICLE_EPS);
  return isFinite(out[0]) && isFinite(out[1]);
}
function _reticleShape(mx, my) {
  if (!_cursorFrame(mx, my)) return _retIdentity();
  if (!_retDeriv(_cfE1[0], _cfE1[1], _cfE1[2], _jCol)) return _retIdentity();
  const a = _jCol[0], c = _jCol[1];
  if (!_retDeriv(_cfE2[0], _cfE2[1], _cfE2[2], _jCol)) return _retIdentity();
  const b = _jCol[0], d = _jCol[1];
  // Closed-form 2×2 SVD: J = R(phi) · diag(s1, s2) · R(th), s2 signed so a
  // mirrored frame (the projection flips beyond the rim) stays representable.
  const E = (a + d) * 0.5, F = (a - d) * 0.5;
  const G = (c + b) * 0.5, H = (c - b) * 0.5;
  const Q = Math.hypot(E, H), R = Math.hypot(F, G);
  const s1 = Q + R, s2 = Q - R;
  if (!(s1 > 1e-9)) return _retIdentity();
  const a1 = Math.atan2(G, F), a2 = Math.atan2(H, E);
  const phi = (a2 + a1) * 0.5, th = (a2 - a1) * 0.5;
  const m = Math.abs(s2);
  const k1 = m > 1e-9 ? Math.min(s1 / m, RETICLE_MAX_ANISO) : RETICLE_MAX_ANISO;
  const k2 = s2 < 0 ? -1 : 1;
  // The projection map, exactly as the Jacobian gives it — R(phi)·diag·R(th),
  // mirror and all. Do NOT symmetrise this: with k2 = -1 (the mirrored frame
  // beyond the rim) the symmetric form is a REFLECTION about a phi that spins
  // freely wherever the SVD is degenerate, and the crosshair windmills
  // (2026-08-31, one attempt at this).
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const ct = Math.cos(th),  st = Math.sin(th);
  const j00 =  cp * k1 * ct - sp * k2 * st;
  const j01 = -cp * k1 * st - sp * k2 * ct;
  const j10 =  sp * k1 * ct + cp * k2 * st;
  const j11 = -sp * k1 * st + cp * k2 * ct;

  // Then take the camera's ROLL back out. The cursor is fixed and the sphere
  // is what rolls under it, so the crosshair must not turn with the sensor —
  // it did, because the tangent basis is projected THROUGH the rolled camera
  // (Ek, 2026-08-31: a "+" at 0° became an "×" at 45°). Undoing one known
  // screen rotation leaves every other property of the map intact, which
  // symmetrising did not.
  const camRoll = _camRollScreen();   // once — this runs every frame
  const cr = Math.cos(-camRoll), sr = Math.sin(-camRoll);
  _ret.k1  = k1;
  _ret.rot = phi - camRoll;
  _ret.m00 = cr * j00 - sr * j10;
  _ret.m01 = cr * j01 - sr * j11;
  _ret.m10 = sr * j00 + cr * j10;
  _ret.m11 = sr * j01 + cr * j11;
  return _ret;
}
// Reticle geometry is authored in flat pixels around (mx, my) and mapped
// through _ret on the way out. Ellipses take the axes straight from the SVD,
// so line weight stays uniform — a ctx.transform would smear the stroke too.
function _retMoveTo(mx, my, dx, dy) {
  S.ctx.moveTo(mx + _ret.m00 * dx + _ret.m01 * dy,
               my + _ret.m10 * dx + _ret.m11 * dy);
}
function _retLineTo(mx, my, dx, dy) {
  S.ctx.lineTo(mx + _ret.m00 * dx + _ret.m01 * dy,
               my + _ret.m10 * dx + _ret.m11 * dy);
}
function _retEllipse(mx, my, r) {
  S.ctx.ellipse(mx, my, r * _ret.k1, r, _ret.rot, 0, Math.PI * 2);
}

export function drawCursor() {
  const cx = S.canvas.width / 2, cy = S.canvas.height / 2;
  const w = S.canvas.width, h = S.canvas.height;

  const fovRad   = ((S.fovDeg ?? FOV_DEG) * Math.PI) / 180;
  const focalLen = (Math.min(w, h) / 2) / Math.tan(fovRad / 2);
  const brushR   = brushScreenRadius(focalLen);

  if (S.isMobile && !S._mobileSetupDone) return;

  // ── Resolve cursor screen position ──────────────────────────────────────
  let mx, my;
  let cursorOffScreen = false;

  if (S.cursorQ) {
    // Detethered: project the cursor's point ON THE SPHERE through the camera.
    // Scaled to SPHERE_RADIUS, not a unit vector: projection through the origin
    // is scale-invariant, so a unit vector worked while the camera sat at the
    // centre — but cameraTransformInto now adds the pull-back offset, and
    // adding a world-scale offset to a length-1 vector puts the cursor
    // somewhere meaningless the moment camPull leaves 0.
    const fwd = _qRotVec(S.cursorQ, [0, 0, SPHERE_RADIUS]);
    cameraTransformInto(fwd[0], fwd[1], fwd[2], _arcC);
    const p   = project(_arcC[0], _arcC[1], _arcC[2]);
    if (p && p.sx >= 0 && p.sx <= w && p.sy >= 0 && p.sy <= h) {
      mx = p.sx;
      my = p.sy;
    } else {
      cursorOffScreen = true;
      // Clamp to nearest viewport edge for edge indicator
      if (p) {
        mx = Math.max(0, Math.min(w, p.sx));
        my = Math.max(0, Math.min(h, p.sy));
      } else {
        // Behind camera — project to closest edge using 2D direction
        // (SPHERE_RADIUS for the same reason as above)
        const fwd2d = _qRotVec(S.cursorQ, [0, 0, SPHERE_RADIUS]);
        cameraTransformInto(fwd2d[0], fwd2d[1], fwd2d[2], _arcC);
        // Use x/y to determine edge direction even though z <= 0
        const angle = Math.atan2(-_arcC[1], _arcC[0]);
        mx = cx + Math.cos(angle) * (w / 2);
        my = cy - Math.sin(angle) * (h / 2);
        mx = Math.max(0, Math.min(w, mx));
        my = Math.max(0, Math.min(h, my));
      }
    }
  } else {
    // Standard: mouse position or canvas center
    mx = (S.mouseInCanvas || S.altLocked) ? S.mousePixelX : cx;
    my = (S.mouseInCanvas || S.altLocked) ? S.mousePixelY : cy;
  }

  // The save() is the early-return guard's and everything below it — NOT the
  // anchor dot's. A 2.5px centre dot used to be drawn here in standard mode:
  // two objects for one fact. With no mouse in the canvas the cursor sits at
  // cx,cy and the dot was drawn underneath the reticle, invisible; with the
  // mouse in the canvas it marked a point that means nothing on its own. The
  // reticle is the mark.
  S.ctx.save();

  // ── Early return guard ──────────────────────────────────────────────────
  // In detethered mode cursor is always active (driven by IMU, not mouse).
  // In standard mode, only draw when mouse is in canvas or alt-locked.
  if (!S.cursorQ && !S.mouseInCanvas && !S.altLocked) {
    S._cursorScreenX = NaN; S._cursorScreenY = NaN; // no active cursor
    S.ctx.restore(); return;
  }

  // Stash resolved cursor screen coords for drawRadiusTooltip
  S._cursorScreenX = cursorOffScreen ? NaN : mx;
  S._cursorScreenY = cursorOffScreen ? NaN : my;

  // OFF SCREEN, NOTHING IS DRAWN (Ek, 2026-09-15: remove the off-screen
  // indicator and its size). There was a chevron at the edge pointing after the
  // cursor, with a slider to scale it for a projector. Both rows are gone from
  // Settings -> Visuals and so is the arrow: when the cursor leaves the view
  // there is no reticle, no radius and now no mark at the edge either.
  if (cursorOffScreen) { S.ctx.restore(); return; }

  const painting    = S.isPainting;
  const scanOff = S.scanMuted;
  const recording   = S.isRecording;
  // THE DOT SAYS WHAT YOU INK FROM (Ek, 2026-09-14). From a loaded sample it is
  // that sample's colour; from the mic it is the mic's, which the top bar
  // already uses to say the mic is live. NOT --accent-danger — that one means
  // "it will not come back".
  //
  // "Live" used to be CURSOR_IDLE_COLOR, which WAS SAMPLE_PAINT_COLORS[0]:
  // state.js said so outright ("it was always SAMPLE_PAINT_COLORS[0]", #247).
  // So the one mark whose whole job is to name the material showed the same
  // #f5a69c for the live mic and for sample 1, and could not tell you which you
  // were painting. That is why this is not a hue preference: the dot was
  // ambiguous about the only fact it carries.
  //
  // Recording lands here too, and should: recording IS the mic. It stays
  // unmistakable because it also takes the 2.4x dot and the ring.
  const color = (!recording && S.sourceKind === 'sampler')
    ? SAMPLE_PAINT_COLORS[S.samplerIndex % SAMPLE_PAINT_COLORS.length]
    : _tok('--mic-live-border', '#d25e3e');

  // ─── ZONE 3: Radius circle ─────────────────────────────────────────────

  // Erase held: --eng-erase, so the ring matches the tile that is doing it —
  // the old red was borrowing danger's meaning. Scan off: no fill at all and an
  // outline in --text-faint — the wash IS the reach, and with nothing being
  // read the ring is empty; no palette hue was free that did not already mean
  // something else on a 60px object carrying five signals. Otherwise the warm
  // neutral --text-tertiary, not a cool grey over a warm black.
  // Pure colour swap — no extra draw calls.
  const erasing  = S.eraseHeld;
  // ─── The hand: what is PLAYING ─────────────────────────────────────────
  // This was a CAP ARC at twelve o'clock in the engine's hue, and Ek could not
  // tell what it was: "i'm not sure why there's an extra line indicator on the
  // top part of the cursor" (2026-08-30). It read as a stray mark rather than
  // as part of the cursor, and there is a geometric reason for that — the
  // reach ring is `_reachPath`, the PROJECTED circle, which is an ellipse
  // everywhere but dead centre, while the arc was drawn at a flat screen
  // radius. So it genuinely did not sit on the ring: it floated a little off
  // it, and the further from centre the cursor went the further off it drifted.
  //
  // The fix is not to place the arc better. The ring itself is the mark: the
  // cursor is DRAWN in the playing tool's colour, so the tile you pressed and
  // the thing under your hand are the same colour, with nothing added to the
  // cursor at all. Same muscle memory, one less object — which is what Ek
  // asked the redesign for in the first place ("elegant… not busy").
  //
  // NULL BETWEEN PRESSES since arming went (2026-09-11): nothing is in the
  // hand, so the ring falls back to neutral grey, and the hue arriving IS the
  // instrument saying a tool is running. It used to wear the armed tool's hue
  // all the time, which said what space WOULD do — a question the instrument
  // no longer asks.
  //
  // Erase and scan-off still win: those are states you must not misread, and
  // they are about the CURSOR rather than about what is in the hand.
  const _hue = (!erasing && !scanOff) ? S._handHue : null;
  const _rFill   = erasing ? _hexA(_tok('--eng-erase', '#be7ace'), 0.12)
    : scanOff ? 'transparent'
    : _hue ? _hexA(_hue, 0.10) : _hexA(_tok('--text-tertiary', '#938d83'), 0.10);
  // 0.85, not 0.55: the fill is gone, and --text-faint is a 2.7:1 token — at
  // 0.55 over the canvas there is no visible ring left to read.
  const _rStroke = erasing ? _hexA(_tok('--eng-erase', '#be7ace'), 0.85)
    : scanOff ? _hexA(_tok('--text-faint', '#5c564c'), 0.85)
    : _hue ? _hexA(_hue, 0.62) : _hexA(_tok('--text-tertiary', '#938d83'), 0.55);

  const kAll = S.grainKAllMode;

  // Radius ring — the projected true circle (see _reachPath); the flat
  // screen circle stays as the fallback when the ring doesn't project.
  // Drawn in BOTH modes: nearest ignores the radius for GRAIN selection only —
  // loops (composer.js), triggers (trigger.js) and cloud focus (grain.js)
  // still gate on searchRadiusDeg, so the ring is the gate and keeps its
  // full design; nearest adds the diamond on top.
  const reach = _reachPath(mx, my);

  // ── The erase sweep ─────────────────────────────────────────────────────
  // The brush is a swept CAPSULE (erase.js), not the circle that used to be
  // drawn here: at speed it clears a band from the last tick's position to
  // this one, and the reticle was showing only the far end of it. erase.js
  // publishes the exact sweep it ran the hit tests on, so this is a drawing OF
  // the algorithm rather than a second guess at it — including the teleport
  // guard, which stamps instead of sweeping and so collapses to a plain circle
  // here too, automatically.
  const _sw = S._eraseSweep;
  if (erasing && _sw && _sw.live) {
    // Two corrections, both of them the same mistake — drawing something the
    // erase never did (Ek, 2026-08-30: "there's a weird trail that extends
    // when i move it around a lot"):
    //
    //   THE FAR END WAS THE LIVE CURSOR, not the sweep's own end. The erase
    //   tick is a 30 ms interval and this runs every frame, so between ticks
    //   the cursor ran on while `_sw` stood still — the band was drawn from
    //   the last tick's START to wherever the hand had got to, up to two
    //   ticks of travel longer than the thing that actually cleared, and
    //   visibly growing the faster you moved. Both ends come from `_sw` now.
    //
    //   IT WAS A STRAIGHT LINE. The sweep runs along a GREAT CIRCLE and
    //   erase.js subdivides it at ~8° for exactly that reason: a long chord
    //   tunnels under the surface. Drawn straight on screen it left the band
    //   somewhere the brush had not been — and with the velocity budget
    //   reaching 150°, a fast flick drew a bar clean across the sphere.
    //
    // Same slerp, same 8° step, so the picture is the algorithm.
    const va = _pinScreen(Math.atan2(_sw.ax, _sw.az), Math.asin(Math.max(-1, Math.min(1, _sw.ay))));
    const vb = _pinScreen(Math.atan2(_sw.bx, _sw.bz), Math.asin(Math.max(-1, Math.min(1, _sw.by))));
    if (va && vb) {
      const dot = Math.max(-1, Math.min(1, _sw.ax * _sw.bx + _sw.ay * _sw.by + _sw.az * _sw.bz));
      const ang = Math.acos(dot);
      const pts = [];
      if (ang > 0.14) {
        const n = Math.min(20, Math.ceil(ang / 0.14)), sinAll = Math.sin(ang);
        for (let w = 0; w <= n; w++) {
          const t = w / n;
          const fA = Math.sin((1 - t) * ang) / sinAll, fB = Math.sin(t * ang) / sinAll;
          const x = fA * _sw.ax + fB * _sw.bx, y = fA * _sw.ay + fB * _sw.by, z = fA * _sw.az + fB * _sw.bz;
          // A waypoint on the far side has no honest screen position, so the
          // band stops at the limb rather than teleporting across it.
          const p = _pinScreen(Math.atan2(x, z), Math.asin(Math.max(-1, Math.min(1, y))));
          if (!p) break;
          pts.push(p);
        }
      } else { pts.push(va, vb); }
      if (pts.length > 1) {
        // A round-capped, round-joined stroke of width 2r IS the swept capsule
        // — the same shape the old arc/lineTo built by hand, for any number of
        // segments, and it cannot disagree with itself at the joins.
        S.ctx.save();
        S.ctx.strokeStyle = _rFill;
        S.ctx.lineWidth = brushR * 2;
        S.ctx.lineCap = 'round';
        S.ctx.lineJoin = 'round';
        S.ctx.beginPath();
        S.ctx.moveTo(pts[0].sx, pts[0].sy);
        for (let i = 1; i < pts.length; i++) S.ctx.lineTo(pts[i].sx, pts[i].sy);
        S.ctx.stroke();
        S.ctx.restore();
      }
    }
  }

  // Everything below the ring is drawn in the cursor's tangent frame.
  _reticleShape(mx, my);
  S.ctx.fillStyle = _rFill;
  if (reach) S.ctx.fill(reach);
  else { S.ctx.beginPath(); S.ctx.arc(mx, my, brushR, 0, Math.PI * 2); S.ctx.fill(); }
  S.ctx.strokeStyle = _rStroke;
  S.ctx.lineWidth   = 1.5;
  const strokeReach = () => {
    if (reach) S.ctx.stroke(reach);
    else { S.ctx.beginPath(); S.ctx.arc(mx, my, brushR, 0, Math.PI * 2); S.ctx.stroke(); }
  };
  // k-all: solid line — everything in radius fires. Normal: dashed
  if (kAll) {
    strokeReach();
  } else {
    S.ctx.setLineDash([5, 5]);
    strokeReach();
    S.ctx.setLineDash([]);
  }

  if (S.nearestMode) {
    // Snap/nearest: big diamond shape over the ring
    const d = 40;
    S.ctx.fillStyle = _rFill;
    S.ctx.beginPath();
    _retMoveTo(mx, my, 0, -d); _retLineTo(mx, my, d, 0);
    _retLineTo(mx, my, 0, d);  _retLineTo(mx, my, -d, 0);
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
  }

  // ─── The hand: what is PLAYING ─────────────────────────────────────────
  // The cursor says what is in the hand without the player looking away from
  // the sphere to find out (Ek, 2026-08-29).
  //
  // A CAP ARC at twelve o'clock, in the tool's engine hue. Colour and one
  // fixed clock position, nothing else: no glyph to resolve at a glance, no
  // text, and it cannot crowd because it is part of a ring that was already
  // there. The hue is read from the same --eng-* properties the rail tiles
  // and the engine sheet use, so playing a sand-coloured grain tile turns the
  // cursor's cap sand — the tile you pressed and the mark on the cursor are
  // the same colour by construction. That is the muscle memory: you learn it
  // once, in the rail, and the sphere speaks it back.
  // (The cap arc that used to be drawn here is gone — see _rStroke above.)

  // ─── The line to the nearest pin ────────────────────────────────────
  // One dashed hairline from the cursor to the pin the focus law calls
  // nearest (grain.js publishes S._dominantSeedSlot), in that pin's colour,
  // brighter as its share grows. This replaced the pin COMPASS — a short arc
  // per pin in reach on a ring outside the reach ring, its opacity the pin's
  // share (Ek, 2026-09-05: "now that we have the one-line selector we can
  // remove those indicators"). The line says which pin, the rail's mark says
  // which is selected, and the mix is heard rather than drawn.
  const _dom = S._dominantSeedSlot;
  const _pw = S._pinWeights;
  if (_dom >= 0 && _pw && S.commitSlots && S.commitSlots[_dom]) {
    const slot = S.commitSlots[_dom];
    const w = _pw[_dom] || 0;
    if (pinAnchorInto(slot, _anchorR)) {
      const pr = _pinScreen(_anchorR[0], _anchorR[1]);
      if (pr) {
        S.ctx.save();
        S.ctx.globalAlpha = 0.45 + 0.35 * Math.min(1, w);
        S.ctx.strokeStyle = slot.color || _tok('--accent-lock', '#7fa8ae');
        S.ctx.lineWidth = 1.5;
        S.ctx.lineCap = 'round';
        S.ctx.setLineDash([2, 4]);
        S.ctx.beginPath();
        S.ctx.moveTo(mx, my);
        S.ctx.lineTo(pr.sx, pr.sy);
        S.ctx.stroke();
        S.ctx.setLineDash([]);
        S.ctx.restore();
      }
    }
  }

  // ─── Center reticle ───────────────────────────────────────────────────

  const tipR = 5, armLen = 12, armGap = tipR + 3;

  // Handsfree + toggle-trace active in plain trace mode — green reticle indicator
  const _toggleTraceOn = S.paintLatched && S.hfArmed && S.traceMode === 'trace';

  // Outer ring — HANDS OFF first, then recording, then painting (Ek,
  // 2026-09-14). The ring is where "the instrument is playing itself" belongs,
  // in --accent-sensor, whose own note is "the body is driving it" — which is
  // what hands-free latched is. Two things were wrong before and neither was
  // the hue. It sat BELOW `painting` in this chain, and latched means painting,
  // so the green ring only ever rendered while latched and NOT painting — it
  // was absent exactly when it had something to say. And its other half was a
  // pip drawn over the centre dot at the dot's own radius, so it hid what you
  // were inking from (see the dot, above).
  //
  // On the ring, every combination now shows BOTH facts at once: recording
  // hands-free is a violet ring around the 2.4x mic dot; painting hands-free is
  // a violet ring around the material's colour. The ring says whose hands, the
  // dot says what material — one object each.
  const _rtic = S.darkMode ? '255,255,255' : '0,0,0';
  S.ctx.strokeStyle = _toggleTraceOn
    ? _hexA(_tok('--accent-sensor', '#a793c0'), 0.95)
    : recording ? _hexA(_tok('--mic-live-border', '#d25e3e'), 0.95)
    : painting ? `rgba(${_rtic},0.95)`
    : `rgba(${_rtic},0.7)`;
  S.ctx.lineWidth   = 2;
  S.ctx.beginPath(); _retEllipse(mx, my, tipR); S.ctx.stroke();

  // Center dot — large solid mic-live dot when recording, paint color when
  // painting, white/black idle
  if (recording) {
    const recDotR = tipR * 2.4;  // the primary recording indicator
    S.ctx.fillStyle = _hexA(_tok('--mic-live-border', '#d25e3e'), 0.90);
    S.ctx.beginPath(); _retEllipse(mx, my, recDotR); S.ctx.fill();
  } else {
    S.ctx.fillStyle = painting ? color : `rgba(${_rtic},0.8)`;
    S.ctx.beginPath(); _retEllipse(mx, my, tipR * 0.65); S.ctx.fill();
  }

  // Crosshair arms — thick, visible from across the room
  S.ctx.strokeStyle = painting ? `rgba(${_rtic},0.6)` : `rgba(${_rtic},0.4)`;
  S.ctx.lineWidth   = 1.5;
  S.ctx.beginPath();
  _retMoveTo(mx, my,  armGap, 0);  _retLineTo(mx, my,  armGap + armLen, 0);
  _retMoveTo(mx, my, -armGap, 0);  _retLineTo(mx, my, -armGap - armLen, 0);
  _retMoveTo(mx, my, 0, -armGap);  _retLineTo(mx, my, 0, -armGap - armLen);
  _retMoveTo(mx, my, 0,  armGap);  _retLineTo(mx, my, 0,  armGap + armLen);
  S.ctx.stroke();

  S.ctx.restore();
}

// The edge HUD (3-column A/S/D bar) was SUNSET on 2026-08-28 (#269) — it is
// in sandbox/sunset-2026-08-28/edge-hud.js. The tile screen says all three
// things in words, so a colour bar you had to learn was pure decoding cost.
// `_commitSlotsFull()` went with it; nothing else called it.


// ── Canvas resize ─────────────────────────────────────────────────────────────
export function resizeCanvas() {
  const rect   = S.canvas.parentElement.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  // In projector mode, render at popup resolution for crisp mirror blit,
  // but display small on the laptop via CSS.  Mouse coord scaling in
  // events.js already handles canvas.width ≠ display width.
  if (S.projectorMode && S.projectorPopup && !S.projectorPopup.closed) {
    const pw = S.projectorPopup.innerWidth  || 1920;
    const ph = S.projectorPopup.innerHeight || 1080;
    S.canvas.width  = pw;
    S.canvas.height = ph;
  } else {
    S.canvas.width  = rect.width;
    S.canvas.height = rect.height;
  }

  if (S.isMobile) {
    S.mousePixelX   = S.canvas.width  / 2;
    S.mousePixelY   = S.canvas.height / 2;
    S.mouseInCanvas = true;
  }
}

// ── Animation loop ────────────────────────────────────────────────────────────
let _animLastAt = 0;
// (delta tracking removed — absolute path via applyAxisMapQuat handles roll mute)
export function animate() {
  if (!_coordEl) _coordEl = document.getElementById('coordinates');
  const _animNow = performance.now();
  if (_animLastAt > 0) perf.frameMs = _animNow - _animLastAt;
  _animLastAt = _animNow;
  perfTick();

  // ── 30fps gate — skip all heavy work on interim RAF callbacks ─────────
  // The projector/display fires RAF at 60hz, but we only need 30fps for
  // rendering AND for camera/sensor/painting updates.  Running camera math
  // + sensor reads + painting at 60hz wastes half the CPU budget.
  // perf.frameMs is still tracked at full RAF rate for drift monitoring.
  const _frameMs = 1000 / RENDER_TARGET_FPS;
  const now30 = performance.now();
  const elapsed30 = now30 - (animate._lastRenderTime || 0);
  if (elapsed30 < _frameMs) {
    requestAnimationFrame(animate);
    return;
  }
  animate._lastRenderTime = now30 - (elapsed30 % _frameMs);

  // Sample the input analyser every render frame so transient peaks between
  // paint events are captured and held for the next snapshotInputFeatures().
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

  // ══ Camera rotation ═══════════════════════════════════════════════════════
  // Three modes, all writing S.camQ [x,y,z,w]:
  //
  //   steer   — mouse offset from canvas centre (absolute, below)
  //   surface — pointer-lock trackpad deltas, incremental world-yaw × local-pitch
  //   sensor  — x-imu3 frame-to-frame deltas, same incremental pattern
  //
  // DESIGN NOTE (gimbal-lock-free rotation):
  // Surface and sensor modes both use INCREMENTAL rotation to avoid gimbal
  // lock at the poles.  Each frame's small delta is decomposed into dYaw and
  // dPitch (well-conditioned for small angles), then applied as:
  //
  //     camQ = qYaw(world-Y, dYaw)  ×  camQ  ×  qPitch(local-X, dPitch)
  //
  // Pre-multiplying yaw keeps it in world frame (no roll accumulation).
  // Post-multiplying pitch keeps it in local frame (clean pole traversal).
  // This pattern is shared by surface trackpad, sensor (roll-muted), and
  // mobile device orientation.  DO NOT replace with absolute Euler-angle
  // reconstruction — that reintroduces gimbal lock.
  // ════════════════════════════════════════════════════════════════════════════

  // Steer mode — mouse offset from centre steers the view (absolute, small-angle).
  // Note this is ROTATION only; camera distance is S.camPull and applies to all
  // three modes alike (see sphere.js cameraTransformInto).
  if (S.cameraMode === 'steer') {
    // No !S.altLocked test here any more (2026-09-01). Cursor lock IS az and el
    // both held, and the two guards inside this block already read those — so
    // the old test was a SECOND mechanism freezing the same sphere, which is
    // how it drifted: see the auto-rotate branch below.
    if (S.mouseInCanvas && !(S.isMobile && S.orientationActive)) {
      const dist = Math.sqrt(S.mouseX*S.mouseX + S.mouseY*S.mouseY);
      const DEAD_ZONE = 0.30;
      if (dist > DEAD_ZONE) {
        const t     = Math.min((dist - DEAD_ZONE) / (1 - DEAD_ZONE), 1);
        const curve = t * t * t * t;
        const speed = curve * ROTATION_SPEED;
        const nx = S.mouseX / dist, ny = S.mouseY / dist;

        if (Math.abs(nx) > 0.001 && !axisHeld(S.azSource)) {
          const up = _qRotVec(S.camQ, [0, 1, 0]);
          const yawSign = up[1] < 0 ? -1 : 1;
          const qYaw = _qFromAA(0, 1, 0, nx * speed * yawSign);
          S.camQ = _qNorm(_qMul(qYaw, S.camQ));
        }
        if (Math.abs(ny) > 0.001 && !axisHeld(S.elSource)) {
          const qPitch = _qFromAA(1, 0, 0, ny * speed);
          S.camQ = _qNorm(_qMul(S.camQ, qPitch));
        }
      }
    } else if (!axisHeld(S.azSource)) {
      // The idle drift, and it is a YAW — so azSource is what governs it. This
      // read `!S.altLocked`, which was the axis locks' blind spot: with azimuth
      // locked, moving the mouse off the canvas resumed the very rotation the
      // lock exists to stop, and moving it back in stopped it again. A lock you
      // can leave by walking away from the canvas is not a lock.
      const qAuto = _qFromAA(0, 1, 0, AUTO_ROTATION_SPEED);
      S.camQ = _qNorm(_qMul(qAuto, S.camQ));
    }
  }

  // ── Surface mode: incremental trackball rotation ─────────────────────────
  // S._surfaceDelta is set by events.js (per-frame pointer-lock movementX/Y).
  // Each frame's delta is applied as a local-frame rotation on camQ, then cleared.
  // This avoids gimbal lock at the poles — straight trackpad lines trace great circles.
  if (S.cameraMode === 'surface' && S._surfaceDelta) {
    let { dx, dy } = S._surfaceDelta;
    // Consume the delta
    S._surfaceDelta.dx = 0;
    S._surfaceDelta.dy = 0;
    // Axis lock: zero the locked component
    if (axisHeld(S.azSource)) dx = 0;
    if (axisHeld(S.elSource)) dy = 0;
    if (dx !== 0 || dy !== 0) {
      // Yaw in world frame (pre-multiply around world Y) — prevents roll.
      // Pitch in local frame (post-multiply around local X) — clean pole traversal.
      const qYaw   = _qFromAA(0, 1, 0, dx * Math.PI);
      const qPitch = _qFromAA(1, 0, 0, dy * Math.PI);
      S.camQ = _qNorm(_qMul(qYaw, _qMul(S.camQ, qPitch)));
    }
  }

  // ── Sensor (x-imu3) override ───────────────────────────────────────────────
  // Always uses the absolute path via getSensorCamQ() → applyAxisMapQuat().
  // applyAxisMapQuat already has a pole-safe forward-vector path for when
  // roll is muted — no need for a second delta-tracking layer here.
  if (S.cameraMode === 'sensor' && typeof S._getSensorCamQ === 'function') {
    const sq = S._getSensorCamQ();
    // Stashed so the post-tickMappings pass can re-derive without re-reading
    // the sensor — see the re-apply below.
    S._rawCamQ = sq;
    if (sq) {
      // Single-IMU: the sensor drives the CURSOR, and the camera is derived —
      // identical to camQ below the pitch clamp (reticle at centre, as ever),
      // holding level past it while the reticle climbs to the pole.
      const pq = applyAxisSources(sq);
      S.cursorQ = pq;
      S.camQ = cameraFromPointing(pq);
    }

    // ── Detethered cursor — two-IMU mode ──────────────────────────────────
    // When frame-role sensor is active, getSensorCamQ returns null (handled
    // above — sq is null, camQ untouched). Cursor-role drives cursorQ instead.
    // camQ stays at identity so frameQ alone provides the viewport.
    let cq = typeof S._getSensorCursorQ === 'function' ? S._getSensorCursorQ() : null;
    if (cq) {
      S._rawCursorQ = cq;
      S.cursorQ = applyAxisSources(cq);
      // Camera at identity — frame provides the view
      S.camQ = [0, 0, 0, 1];
    } else {
      S._rawCursorQ = null;
      // Single IMU: cursorQ and camQ already set above (when a sensor is
      // feeding — with none, cursorQ stays wherever the last packet left it,
      // so clear it and let the mouse fallback take the cursor).
      if (!sq) S.cursorQ = null;
    }
  } else {
    // Non-sensor modes: ensure cursorQ is cleared
    S.cursorQ = null;
  }

  // ── Camera sensor — world rotation (projector-aim) ─────────────────────────
  // A 'camera' role sensor rotates the virtual sphere, producing projector-
  // aim behaviour: turning the sensor pans the viewport while the world stays
  // in world coords.  Stored on S.frameQ; sphere.js applies it per-point in
  // cameraTransform / getCursorLonLat / screenToLonLat.  Only active in
  // sensor mode — surface and steer are mouse/trackpad only.
  //
  // A 'frame' role sensor (body-reference) does NOT go here — that mode feeds
  // the delta quat directly into S.cursorQ via getSensorCursorQ(), and leaves
  // S.frameQ null so cameraTransform skips world rotation.  Result: rotating
  // cursor + frame together leaves both the cursor AND the grid visually
  // stationary, attaching the whole granular field to the performer's body.
  // See sensor-registry.getSensorCursorQ() for the dispatch.
  S.frameQ = (S.cameraMode === 'sensor' && typeof S._getCameraQ === 'function')
    ? S._getCameraQ()
    : null;

  // ── Sensor → grain-param mappings ──────────────────────────────────────
  // Evaluate after camera/cursor quaternion updates so axis values are fresh.
  // Writes mapped values to S.grainOverrides; grain scheduler reads on next tick.
  tickMappings();

  // ── Cursor-destination mappings ────────────────────────────────────────
  // tickMappings() has to run after the camera block (mapping inputs must be
  // fresh), but a 'cursor' row writes back INTO the cursor — so re-derive here
  // from the stashed raw quaternion. Without this a mapped axis would always
  // show the previous frame's value, a fixed 33ms behind every other output.
  // Only runs while an axis is actually 'mapped'.
  if (S.azSource === 'mapped' || S.elSource === 'mapped') {
    if (S._rawCursorQ)   S.cursorQ = applyAxisSources(S._rawCursorQ);
    else if (S._rawCamQ) {
      const pq = applyAxisSources(S._rawCamQ);
      S.cursorQ = pq;
      S.camQ = cameraFromPointing(pq);
    }
  }

  // Particle deposits are handled by paint-ticker.js (200Hz setInterval),
  // independent of the render loop and input source.

  if (S.isRecording) rebuildLiveBuffer();

  // ── Frame-skip under CPU pressure ────────────────────────────────────────
  // Audio is higher priority than visuals.  When the grain scheduler is
  // running late (schedulerDrift > 1.5× its interval), skip the expensive
  // drawFrame() call so the next setInterval callback gets more main-thread
  // time.  Camera math, painting, and sensor reads above still execute —
  // only the canvas redraw is deferred.  At most one frame is skipped
  // consecutively to avoid a frozen display.
  const _skipThreshold = GRAIN_SCHEDULER_INTERVAL_MS * 1.5;
  const _schedPressure = perf.schedulerDrift > _skipThreshold;
  const _canSkip = !animate._skippedLast;  // never skip two in a row
  if (_schedPressure && _canSkip) {
    animate._skippedLast = true;
    perf.frameSkips++;
  } else {
    animate._skippedLast = false;
    try { drawFrame(); } catch (e) { console.error('drawFrame error:', e); }
    // ── Mirror blit + HUD sync to projector popup ────────────────────────
    // Canvas already renders at popup resolution, so this is a 1:1 copy.
    if (S.projectorCtx && S.projectorPopup && !S.projectorPopup.closed) {
      try {
        S.projectorCtx.drawImage(S.canvas, 0, 0);
      } catch (_) { /* popup closed mid-frame — harmless */ }
      S._syncProjectorHUD?.();
    }
  }
  S.updateWaveformPlayheads?.();

  const { lon, lat } = S.cursorQ ? getCursorLonLat()
    : S.mouseInCanvas ? screenToLonLat(S.mousePixelX, S.mousePixelY) : getCursorLonLat();
  const lonDeg = (lon * 180 / Math.PI).toFixed(1).padStart(7);
  const latDeg = (lat * 180 / Math.PI).toFixed(1).padStart(6);
  if (_coordEl) _coordEl.textContent = `${lonDeg}°,${latDeg}°`;

  // Unified meter tick — runs inside the main RAF loop instead of its own
  S._tickMainMeters?.();

  requestAnimationFrame(animate);
}

// ── Axis-source substitution ────────────────────────────────────────────────
// Reduces a sensor quaternion to POINTING — yaw and pitch through the axis
// locks, and nothing else. Single owner of the rule, shared by the camera
// path, the detethered cursor path, the post-mapping re-apply and main.js's
// 400 Hz arrival path.
//
// Roll is not resolved, muted, or frozen here — it is STRIPPED, always
// (Ek, 2026-09-01: "the roll should not make it to the actual sphere").
// The previous shape kept roll as a third resolved axis behind rollSource,
// and that was the wrong fight: measured end-to-end with roll pinned at
// exactly 0.00, body yaw at 85° elevation still became 99.7% view-axis spin,
// because pinning the reticle to screen centre makes "up on screen" the
// heading's job near the pole. The spin was never roll. So the camera is now
// DERIVED (cameraFromPointing below) and this function's output is a pure
// direction: mubone paints with az and el, a position on a 2D map.
export function applyAxisSources(q) {
  const fwd = _qRotVec(q, [0, 0, 1]);
  const liveYaw   = Math.atan2(fwd[0], fwd[2]);
  const livePitch = Math.asin(Math.max(-1, Math.min(1, -fwd[1])));

  const yaw   = _resolveAxis(S.azSource,   S.cursorOverrides.azimuth,
                             '_axisLockFrozenYaw',   liveYaw,   false);
  const pitch = _resolveAxis(S.elSource,   S.cursorOverrides.elevation,
                             '_axisLockFrozenPitch', livePitch, true);

  return _qNorm(_qMul(_qFromAA(0, 1, 0, yaw), _qFromAA(1, 0, 0, pitch)));
}

// ── The camera, derived from pointing ───────────────────────────────────────
// SENSOR MODE IS SURFACE MODE WITH THE SENSOR AS THE TRACKPAD (Ek,
// 2026-09-01: "i want it to work like in steer mode… can you find a simpler
// route"). The camera is two accumulators — yaw A about world Y, pitch B
// about local X, camQ = Ry(A)·Rx(B), the exact no-roll / clean-pole-traversal
// composition the steer and surface blocks above use — and each update nudges
// them by the ON-SCREEN OFFSET of the pointing direction from view centre.
// A servo: the crosshair is pinned to centre by construction, at every
// elevation, and the centre of view IS the true pointing, so painting stays
// absolute.
//
// Why this dissolves the pole instead of managing it: every previous attempt
// (hard clamp → soft knee → fade+glide → lazy pursuit, all built and rejected
// today) SOLVED for absolute azimuth, and azimuth is the thing the pole
// breaks — it swings ~1/cos(el) per degree of hand wobble, unboundedly at 90°.
// The servo never computes azimuth. The offset of the pointing from centre is
// bounded by ACTUAL hand motion — a hand circling the pole feeds tiny bounded
// nudges whose direction spins, not a wild angle — so the world moves at hand
// rate everywhere, tremor stays sub-degree, and there is nothing left to
// clamp, fade, or glide. Going over the top, B simply passes 90° and the
// world does the same backbend surface mode does; coming back unwinds it.
// No constants, no state machine: two numbers and a wrap.
let _camA  = null;  // accumulated yaw about world Y (radians)
let _camP  = 0;     // accumulated pitch about local X — CLAMPED to ±90 (upright-only)
let _camAt = 0;     // performance.now() of the last update
let _camF  = null;  // last pointing direction, for teleport detection
const _wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
export function cameraFromPointing(pq) {
  const DEG = Math.PI / 180, HALF = Math.PI / 2;
  const f = _qRotVec(pq, [0, 0, 1]);   // true pointing, world frame

  const now = performance.now();
  const prevAt = _camAt;
  _camAt = now;
  const dt = Math.min(0.1, (now - prevAt) / 1000);
  const stale = now - prevAt > 500;
  // A pointing step this large between consecutive packets is not a hand — it
  // is a dropout resuming (Ek's recording: a 4.5 s gap swallowed a descent and
  // the pointing reappeared 84° away in ONE packet, behind a burst of stale
  // queued packets whose tiny inter-arrival times defeat any dt-based check —
  // which is why the teleport test exists beside the stale test).
  const tele = _camF && Math.acos(Math.max(-1, Math.min(1,
    f[0] * _camF[0] + f[1] * _camF[1] + f[2] * _camF[2]))) > SENSOR_CAM_TELEPORT_DEG * DEG;
  _camF = f;
  if (_camA === null || stale || tele) {
    // Reacquire — always upright, always a clean deterministic cut.
    _camA = Math.atan2(f[0], f[2]);
    _camP = Math.max(-HALF, Math.min(HALF, -Math.asin(Math.max(-1, Math.min(1, f[1])))));
    return _qNorm(_qMul(_qFromAA(0, 1, 0, _camA), _qFromAA(1, 0, 0, _camP)));
  }

  // UPRIGHT-ONLY servo. Pitch clamps at ±90, so an upside-down world is
  // UNREPRESENTABLE — the invariant Ek asked for ("when i come back down the
  // world is upside down… pitch up becomes pitch down" cannot happen, by
  // construction rather than by branch bookkeeping). Replayed against 128 s of
  // his real sensor stream: crosshair never off by >8° for any measurable
  // duration, dropouts included. The inverted/backbend branch of the first
  // servo is gone with the #305 cone — the recording showed his real
  // over-the-top gestures round the pole at 85–86° rather than crossing it,
  // so the branch had no genuine gesture left to serve.
  const cam = _qMul(_qFromAA(0, 1, 0, _camA), _qFromAA(1, 0, 0, _camP));
  const fc = _qRotVec([-cam[0], -cam[1], -cam[2], cam[3]], f);
  _camA = _wrapPi(_camA + Math.atan2(fc[0], fc[2]));
  let pn = _camP - Math.asin(Math.max(-1, Math.min(1, fc[1])));
  if (Math.abs(pn) > HALF) {
    // Pinned at the pole with the hand still going: the target is beyond, at
    // an elevation where azimuth is WELL-conditioned again — so come around
    // toward its true azimuth at a bounded rate. This is the deliberate
    // over-the-top pan, and it also breaks the dead spot where a far-side
    // descent sits at exactly opposite azimuth with zero horizontal offset
    // (the replay stuck staring at the zenith for 4 s without it).
    const over = Math.abs(pn) - HALF;
    pn = Math.max(-HALF, Math.min(HALF, pn));
    if (over > SENSOR_CAM_OVERSHOOT_DEG * DEG) {
      const err = _wrapPi(Math.atan2(f[0], f[2]) - _camA);
      _camA = _wrapPi(_camA + Math.sign(err) *
        Math.min(Math.abs(err), SENSOR_CAM_SWING_DEG_S * DEG * Math.max(dt, 0.005)));
    }
  }
  _camP = pn;
  return _qNorm(_qMul(_qFromAA(0, 1, 0, _camA), _qFromAA(1, 0, 0, _camP)));
}

// One axis.  'sensor' passes the live value through; 'mapped' takes the mapping
// row's degrees when a row is feeding it; 'locked' — and 'mapped' with no row —
// hold the frozen snapshot.
//
// `negate` converts an elevation override to pitch: getCursorLonLat() reads
// lat = asin(fwd.y), and this construction gives fwd.y = -sin(pitch), so
// lat = -pitch.  Azimuth needs no flip — lon and yaw are both atan2(x, z).
//
// The mapped branch also WRITES the frozen snapshot.  That keeps two other
// things correct for free: switching 'mapped' → 'locked' holds exactly where
// the mapping left the cursor, and the 400Hz quaternion-arrival path in main.js
// (which only knows about the frozen values) tracks a mapped axis without
// needing its own copy of this logic.
function _resolveAxis(src, overrideDeg, frozenKey, live, negate) {
  if (src === 'sensor') { S[frozenKey] = null; return live; }
  if (src === 'mapped' && overrideDeg != null) {
    const v = (negate ? -overrideDeg : overrideDeg) * (Math.PI / 180);
    S[frozenKey] = v;
    return v;
  }
  if (S[frozenKey] == null) S[frozenKey] = live;
  return S[frozenKey];
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
