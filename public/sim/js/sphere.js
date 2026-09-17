// ============================================================================
// QUATERNION MATH & SPHERICAL PROJECTION
// ============================================================================

import { S, SPHERE_RADIUS, FOV_DEG } from './state.js';

// Helper: current FOV — uses mutable S.fovDeg if set, falls back to const
function fov() { return S.fovDeg ?? FOV_DEG; }

// ── Quaternion helpers ───────────────────────────────────────────────────────

export function qMul(a, b) {
  // [x, y, z, w] convention: a[0]=x, a[1]=y, a[2]=z, a[3]=w
  return [
    a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
    a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
    a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
    a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2],
  ];
}
export function qNormalize(q) {
  const len = Math.sqrt(q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3]);
  return [q[0]/len, q[1]/len, q[2]/len, q[3]/len];
}
export function qFromAxisAngle(ax, ay, az, angle) {
  const half = angle / 2, s = Math.sin(half);
  return [ax*s, ay*s, az*s, Math.cos(half)];  // [x, y, z, w]
}
export function qConjugate(q) { return [-q[0], -q[1], -q[2], q[3]]; }  // negate xyz, keep w
export function qRotateVec(q, v) {
  const vq = [v[0], v[1], v[2], 0];             // pure quaternion, w=0
  const r  = qMul(qMul(q, vq), qConjugate(q));
  return [r[0], r[1], r[2]];
}

// ── Zero-allocation hot-path helpers ──────────────────────────────────────────
// The allocating versions above are fine for infrequent calls (tare, calibration,
// etc.).  The *Into variants below write to caller-supplied output arrays and
// perform the full q*v*conj(q) expansion inline — zero intermediate arrays.
// At 600k+ calls/sec in the render + scheduler loops, eliminating ~10 temporary
// arrays per cameraTransform call prevents V8 major-GC pauses (160ms+ stalls).

// Reusable scratch for internal intermediate results (never returned to caller)
const _q0 = [0, 0, 0, 0];  // qMul scratch A
const _q1 = [0, 0, 0, 0];  // qMul scratch B

// Rotate vector (vx,vy,vz) by quaternion q, write result into out[0..2].
// Expanded: out = q * [vx,vy,vz,0] * conj(q), all inline, no allocs.
export function qRotateVecInto(q, vx, vy, vz, out) {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  // out = v + qw * t + cross(q.xyz, t)
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
}

// Pre-compute fused camera quaternion: conj(camQ) * frameQ (or just conj(camQ)).
// Call once per frame; cameraTransformInto then does a single rotation per point.
const _fusedCamQ = [0, 0, 0, 1];
// Camera pull-back, in world units, cached per frame beside the fused quaternion.
// Applied in CAMERA space (after rotation), so it is always "back away along the
// view axis" — which is what makes one scalar work for all three camera modes.
// At 0 every path below is arithmetically identical to the pre-pull code.
let _camOffZ = 0;
export function camOffsetZ() { return _camOffZ; }
export function updateFusedCamQ() {
  _camOffZ = (S.camPull || 0) * SPHERE_RADIUS;
  const cx = -S.camQ[0], cy = -S.camQ[1], cz = -S.camQ[2], cw = S.camQ[3];
  if (S.frameQ) {
    const fx = S.frameQ[0], fy = S.frameQ[1], fz = S.frameQ[2], fw = S.frameQ[3];
    _fusedCamQ[0] = cw*fx + cx*fw + cy*fz - cz*fy;
    _fusedCamQ[1] = cw*fy - cx*fz + cy*fw + cz*fx;
    _fusedCamQ[2] = cw*fz + cx*fy - cy*fx + cz*fw;
    _fusedCamQ[3] = cw*fw - cx*fx - cy*fy - cz*fz;
  } else {
    _fusedCamQ[0] = cx; _fusedCamQ[1] = cy;
    _fusedCamQ[2] = cz; _fusedCamQ[3] = cw;
  }
}

// Sphere-local (x,y,z) → camera space. Two variants, and the difference is the
// whole reason camera pull-back is safe to ship.
//
//   cameraRotateInto  — ROTATION ONLY. Where the listener's head is pointing.
//   cameraTransformInto — rotation + the pull-back dolly. Where the eye is.
//
// Head-locked spatial panning (audio.js, grain.js, grain-worklet-bridge.js,
// ui-audio-settings.js) takes atan2(x, z) of this to get azimuth, and it must
// use the ROTATION variant. The listener sits at the sphere's centre no matter
// where the camera has been dollied to; feeding it the offset would swing the
// panning as you pull back, which is both wrong and audible. Pulling back
// changes what you SEE and never what you HEAR — that invariant lives here.
//
// If you add a caller: rendering wants cameraTransformInto, audio wants
// cameraRotateInto. At camPull 0 they are identical, so a mistake will not show
// up until someone moves the slider mid-set.
export function cameraRotateInto(x, y, z, out) {
  qRotateVecInto(_fusedCamQ, x, y, z, out);
}
export function cameraTransformInto(x, y, z, out) {
  qRotateVecInto(_fusedCamQ, x, y, z, out);
  out[2] += _camOffZ;   // dolly back along the view axis (0 = camera at centre)
}

// Sphere point: lon/lat → Cartesian, write into out[0..2]. No trig savings
// but eliminates the return-array allocation.
export function spherePointInto(lon, lat, out) {
  const cosLat = Math.cos(lat);
  out[0] = SPHERE_RADIUS * cosLat * Math.sin(lon);
  out[1] = SPHERE_RADIUS * Math.sin(lat);
  out[2] = SPHERE_RADIUS * cosLat * Math.cos(lon);
}

// ── 3D Math — inside-sphere camera ───────────────────────────────────────────

// ── The projection (2026-08-28, Ek: "one view that's accurate") ─────────────
// Centred camera: AZIMUTHAL EQUIDISTANT. Angular distance from the view axis
// maps to LINEAR pixel distance, so a 3° radius is the same size everywhere
// on screen, the reach ring matches the erase hole at the edges as well as
// the centre, and nothing stretches toward the corners the way the old
// rectilinear tan() did. There is no "behind": from the centre every
// direction sees exactly one surface point, so zooming out (fovDeg → 360)
// lays the whole sphere flat as a disc map with the antipode at the rim.
// The pulled camera (camPull ≠ 0, the outside/demo view) keeps the original
// rectilinear ray model — it is a genuine eye in space, not a chart.
//
// ── The back hemisphere is a RIM, not half the picture (2026-08-29) ──────
//
// Azimuthal equidistant gives the far hemisphere exactly as much screen RADIUS
// as the near one — ρ runs 0…π·scale and the horizon sits at the halfway mark.
// Because that outer half is an annulus it covers about three times the AREA,
// so once you zoom out far enough for any of it to land on screen, most of the
// picture is the side you are not playing, drawn at several times the size of
// the same feature in front of you. It read exactly like what it is (Ek: "I
// don't want the backside to look like it's right in front of my face when
// I'm trying to engage with the front side").
//
// A cap that simply refused to draw it was worse — the cut is a circle in the
// middle of the screen, and feathering the cut only made it a vignette. So
// instead the chart is REMAPPED past the horizon. The front hemisphere is
// untouched, still exactly equidistant:
//
//     ρ(θ) = θ                                     θ ≤ 90°
//     ρ(θ) = 90° + B·u / (B + u),   u = θ − 90°    θ > 90°
//
// The second branch has slope 1 at u = 0, so a line crossing the horizon does
// not kink; it is monotonic, so nothing folds over itself; and it is bounded,
// so the whole 90° of "behind you" folds into a band 14% wider than the front
// disc, hugging the horizon. Everything is still drawn — zoom out far enough
// and you see the entire sphere, which is what the wide view is for — but the
// far side reads as periphery at every FOV instead of taking the picture over
// at some threshold. It is exactly invertible (see screenToLonLat), which is
// what lets the cursor still be steered out there.
//
// Angular fidelity where it is load-bearing is unchanged: the reach ring, the
// erase hole and the degree readout all live in front of you, inside the
// equidistant half.
const HALF_PI  = Math.PI / 2;
const BACK_RIM = 0.26;                       // radians of radius the far half gets
const BACK_RIM_MAX = BACK_RIM * HALF_PI / (BACK_RIM + HALF_PI);
function _rhoAngle(th) {
  if (th <= HALF_PI) return th;
  const u = th - HALF_PI;
  return HALF_PI + BACK_RIM * u / (BACK_RIM + u);
}

export function project(x, y, z) {
  const fovRad = (fov() * Math.PI) / 180;
  const halfMin = Math.min(S.canvas.width, S.canvas.height) / 2;
  if ((S.camPull || 0) !== 0) {
    if (z <= 0.1) return null;
    // Use the narrower dimension so fovDeg controls vertical FOV in landscape.
    const focalLen = halfMin / Math.tan(fovRad / 2);
    return {
      sx:    S.canvas.width  / 2 + (x / z) * focalLen,
      sy:    S.canvas.height / 2 - (y / z) * focalLen,
      depth: z
    };
  }
  const m = Math.sqrt(x * x + y * y + z * z);
  if (m < 1e-9) return null;
  const scale = halfMin / (fovRad / 2);           // px per radian
  const th  = Math.acos(Math.max(-1, Math.min(1, z / m)));
  const rxy = Math.sqrt(x * x + y * y);
  const rho = _rhoAngle(th) * scale;
  const sx = S.canvas.width  / 2 + (rxy > 1e-9 ? (x / rxy) * rho : 0);
  const sy = S.canvas.height / 2 - (rxy > 1e-9 ? (y / rxy) * rho : 0);
  // Equidistant has no "behind"; visibility is simply the canvas plus margin.
  const w = S.canvas.width, h = S.canvas.height;
  if (sx < -w || sx > 2 * w || sy < -h || sy > 2 * h) return null;
  return { sx, sy, depth: z };
}

// ── Zero-allocation projection for hot paths ─────────────────────────────────
// Caches focalLen + canvas half-dimensions once per frame.  Call
// updateProjectionCache() at the start of each render frame.
let _projFocal = 0, _projHalfW = 0, _projHalfH = 0;
let _projScale = 0, _projPulled = false;
export function updateProjectionCache() {
  const fovRad = (fov() * Math.PI) / 180;
  const halfMin = Math.min(S.canvas.width, S.canvas.height) / 2;
  _projFocal  = halfMin / Math.tan(fovRad / 2);
  _projScale  = halfMin / (fovRad / 2);
  _projPulled = (S.camPull || 0) !== 0;
  _projHalfW = S.canvas.width  / 2;
  _projHalfH = S.canvas.height / 2;
}
// Write screen coords into out[0]=sx, out[1]=sy, out[2]=depth.
// Returns false (not visible) instead of null — no allocation either way.
// Centred: azimuthal equidistant (see project()); pulled: rectilinear.
export function projectInto(x, y, z, out) {
  if (_projPulled) {
    if (z <= 0.1) return false;
    out[0] = _projHalfW + (x / z) * _projFocal;
    out[1] = _projHalfH - (y / z) * _projFocal;
    out[2] = z;
    return true;
  }
  const m = Math.sqrt(x * x + y * y + z * z);
  if (m < 1e-9) return false;
  const th  = Math.acos(Math.max(-1, Math.min(1, z / m)));
  const rxy = Math.sqrt(x * x + y * y);
  const rho = _rhoAngle(th) * _projScale;
  const sx = _projHalfW + (rxy > 1e-9 ? (x / rxy) * rho : 0);
  const sy = _projHalfH - (rxy > 1e-9 ? (y / rxy) * rho : 0);
  if (sx < -2 * _projHalfW || sx > 4 * _projHalfW ||
      sy < -2 * _projHalfH || sy > 4 * _projHalfH) return false;
  out[0] = sx;
  out[1] = sy;
  out[2] = z;
  return true;
}
export function getCursorLonLat() {
  const q = S.cursorQ || S.camQ;
  const forward = qRotateVec(q, [0, 0, 1]);
  // Detethered (cursorQ set): cursorQ is in tare/world space, which IS
  // sphere-local — no un-rotation needed.  frameQ only matters for display
  // (cameraTransform) and for screen-ray conversion (screenToLonLat).
  //
  // Non-detethered with frameQ: camQ forward is camera-relative and must
  // be converted back to sphere-local via the inverse of frameQ.
  const w = (!S.cursorQ && S.frameQ)
    ? qRotateVec(qConjugate(S.frameQ), forward)
    : forward;
  return {
    lon: Math.atan2(w[0], w[2]),
    lat: Math.asin(Math.max(-1, Math.min(1, w[1])))
  };
}

/** WHERE THE CURSOR IS, for everything that paints, erases, scans or listens
 *  at it — ONE rule (2026-09-16). A cursor sensor (`cursorQ`, the two-sensor
 *  modes) is the cursor. Otherwise the pointer is, while it is ON the canvas
 *  (or frozen there by ⌥); off the canvas the cursor is the camera's centre,
 *  which is what the sensor steers in single-sensor mode. This rule was copied
 *  five times and two of the copies (paint-ticker, erase) read the pointer
 *  wherever it was, so with the pointer resting on a rail the marks were laid
 *  at its last projection while the scan read the centre: the ink and the ear
 *  disagreed, and nothing sounded. */
export function cursorLonLatNow() {
  if (S.cursorQ) return getCursorLonLat();
  if (S.altLocked) return screenToLonLat(S.altFrozenMousePixelX, S.altFrozenMousePixelY);
  if (S.mouseInCanvas) return screenToLonLat(S.mousePixelX, S.mousePixelY);
  return getCursorLonLat();
}
// Screen pixel → the sphere point under it.
//
// From the centre (camPull 0) a ray DIRECTION is already a surface point, which
// is why this used to be four lines. Off-centre it is a genuine ray-sphere
// intersection: cameraTransformInto puts the camera at the camera-space origin
// with the sphere centre at (0, 0, D), so the algebra below is that one solve.
//
// CONTRACT: always returns a usable {lon, lat}, never null. There are 13 call
// sites across audio, erase, grain, paint-ticker, seed-morph, sensor-mapping,
// presets and the renderer, every one of which assumes a value. Once the camera
// is outside the sphere a mouse ray can miss it entirely, and the honest-looking
// answer — return null and let painting stop — would mean auditing all 13 for a
// state they have never had to handle. Instead a miss CLAMPS to the silhouette:
// the cursor slides around the limb rather than vanishing, the contract holds,
// and no caller changes.
export function screenToLonLat(px, py) {
  const fovRad = (fov() * Math.PI) / 180;
  const D = (S.camPull || 0) * SPHERE_RADIUS;
  const R = SPHERE_RADIUS;

  // Centred: the azimuthal-equidistant inverse — pixel distance from centre
  // IS the angle off the view axis. Exact inverse of project()'s centred
  // branch; beyond the 180° rim it clamps to the antipode, keeping the
  // never-null contract.
  if (D === 0) {
    const scale = (Math.min(S.canvas.width, S.canvas.height) / 2) / (fovRad / 2);
    const ddx = px - S.canvas.width / 2;
    const ddy = -(py - S.canvas.height / 2);
    const rho = Math.sqrt(ddx * ddx + ddy * ddy);
    let hx, hy, hz;
    if (rho < 1e-9) { hx = 0; hy = 0; hz = R; }
    else {
      // Exact inverse of _rhoAngle: linear inside the horizon, and outside it
      // u = B·f/(B − f), which reaches u = 90° precisely at f = BACK_RIM_MAX —
      // so the rim of the picture is the antipode and nothing beyond it exists.
      const a  = rho / scale;
      const th = a <= HALF_PI ? Math.min(HALF_PI, a) : (() => {
        const f = Math.min(a - HALF_PI, BACK_RIM_MAX);
        return Math.min(Math.PI, HALF_PI + BACK_RIM * f / (BACK_RIM - f));
      })();
      const s = Math.sin(th);
      hx = (ddx / rho) * s * R;
      hy = (ddy / rho) * s * R;
      hz = Math.cos(th) * R;
    }
    const world0 = qRotateVec(S.camQ, [hx, hy, hz]);
    const w0 = S.frameQ ? qRotateVec(qConjugate(S.frameQ), world0) : world0;
    const wm0 = Math.sqrt(w0[0]*w0[0] + w0[1]*w0[1] + w0[2]*w0[2]) || 1;
    return {
      lon: Math.atan2(w0[0], w0[2]),
      lat: Math.asin(Math.max(-1, Math.min(1, w0[1] / wm0)))
    };
  }

  const focalLen = (Math.min(S.canvas.width, S.canvas.height) / 2) / Math.tan(fovRad / 2);
  const dx = (px - S.canvas.width  / 2) / focalLen;
  const dy = -(py - S.canvas.height / 2) / focalLen;
  const dz = 1;
  const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
  const ex = dx / len, ey = dy / len, ez = dz / len;   // unit ray, camera space

  // |t·e − C|² = R², with C = (0, 0, D)
  const b    = ez * D;
  const disc = b * b - (D * D - R * R);

  let hx, hy, hz;   // hit point relative to the SPHERE CENTRE, camera space
  if (disc >= 0) {
    // FAR root, always. You play mubone from inside the sphere, and pulling the
    // camera back is stepping away from a bowl you keep working the inside of —
    // not walking around a ball. Three things follow, and they are the same
    // thing seen three ways:
    //
    //   • Continuity. At camPull 0 the near root is behind the camera and the
    //     far one IS the surface you look at, so far-root is what the centred
    //     model has always done. Keeping it means the cursor does not jump, or
    //     reverse direction, as you pull out through the shell.
    //   • Correctness. In sensor and surface mode the cursor is pinned to canvas
    //     centre and resolved through here, while getCursorLonLat() — which the
    //     audio path uses — defines it as the camera's FORWARD ray. Far-root
    //     makes screenToLonLat(centre) equal getCursorLonLat() at every
    //     distance. The near root makes them ANTIPODAL as soon as camPull > 0:
    //     the reticle on screen and the point that actually sounds end up on
    //     opposite sides of the sphere.
    //   • Feel. On the near face, moving the mouse right walks lon the wrong
    //     way, because you are looking at the outside of a surface you have
    //     always seen from within. Ek caught this on the rig immediately.
    //
    // The renderer's cull matches this — it keeps the same inner face.
    const t = b + Math.sqrt(disc);
    hx = t * ex; hy = t * ey; hz = t * ez - D;
  } else {
    // Miss — clamp to the silhouette. Closest approach to the centre is t = b;
    // push that point out to the surface along its own radius.
    const cx = b * ex, cy = b * ey, cz = b * ez - D;
    const m  = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
    hx = cx / m * R; hy = cy / m * R; hz = cz / m * R;
  }

  // Camera space → sphere-local, then normalise before asin (|h| is R, not 1).
  const world = qRotateVec(S.camQ, [hx, hy, hz]);
  // Un-rotate from frame space back to sphere-local coordinates
  const w = S.frameQ ? qRotateVec(qConjugate(S.frameQ), world) : world;
  const wm = Math.sqrt(w[0]*w[0] + w[1]*w[1] + w[2]*w[2]) || 1;
  return {
    lon: Math.atan2(w[0], w[2]),
    lat: Math.asin(Math.max(-1, Math.min(1, w[1] / wm)))
  };
}
