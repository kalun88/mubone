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
export function updateFusedCamQ() {
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

// Transform sphere-local (x,y,z) into camera space, write into out[0..2].
// Uses the fused quaternion — single rotation, zero allocations.
export function cameraTransformInto(x, y, z, out) {
  qRotateVecInto(_fusedCamQ, x, y, z, out);
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

export function spherePoint(lon, lat) {
  // Convention: lon=0 points along +Z (camera forward at identity quaternion).
  // Longitude increases from +Z toward +X (rightward from viewer).
  return [
    SPHERE_RADIUS * Math.cos(lat) * Math.sin(lon),
    SPHERE_RADIUS * Math.sin(lat),
    SPHERE_RADIUS * Math.cos(lat) * Math.cos(lon)
  ];
}
export function cameraTransform(x, y, z) {
  // If a frame-role sensor is active, rotate world points first.
  // frameQ rotates the sphere; camQ orients the camera — kept separate
  // so the frame never accumulates into the incremental camera quaternion.
  //
  // IMPORTANT: camQ is conjugated here, frameQ is NOT.  getFrameQ() conjugates
  // its output to compensate, so both sensors use the same applyAxisMapQuat
  // pipeline and produce identical visual behaviour.  Do not add/remove
  // conjugation on either side without updating getFrameQ() to match.
  const p = S.frameQ ? qRotateVec(S.frameQ, [x, y, z]) : [x, y, z];
  return qRotateVec(qConjugate(S.camQ), p);
}
export function project(x, y, z) {
  if (z <= 0.1) return null;
  const fovRad   = (fov() * Math.PI) / 180;
  // Use the narrower dimension so fovDeg controls vertical FOV in landscape.
  // This matches the standard 3D convention and ensures vertical pitch movement
  // tracks the physical projector throw when the slider is calibrated.
  const focalLen = (Math.min(S.canvas.width, S.canvas.height) / 2) / Math.tan(fovRad / 2);
  return {
    sx:    S.canvas.width  / 2 + (x / z) * focalLen,
    sy:    S.canvas.height / 2 - (y / z) * focalLen,
    depth: z
  };
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
export function screenToLonLat(px, py) {
  const fovRad   = (fov() * Math.PI) / 180;
  const focalLen = (Math.min(S.canvas.width, S.canvas.height) / 2) / Math.tan(fovRad / 2);
  const dx = (px - S.canvas.width  / 2) / focalLen;
  const dy = -(py - S.canvas.height / 2) / focalLen;
  const dz = 1;
  const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
  const world = qRotateVec(S.camQ, [dx/len, dy/len, dz/len]);
  // Un-rotate from frame space back to sphere-local coordinates
  const w = S.frameQ ? qRotateVec(qConjugate(S.frameQ), world) : world;
  return {
    lon: Math.atan2(w[0], w[2]),
    lat: Math.asin(Math.max(-1, Math.min(1, w[1])))
  };
}
