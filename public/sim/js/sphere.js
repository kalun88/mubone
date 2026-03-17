// ============================================================================
// QUATERNION MATH & SPHERICAL PROJECTION
// ============================================================================

import { S, SPHERE_RADIUS, FOV_DEG } from './state.js';

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
  return qRotateVec(qConjugate(S.camQ), [x, y, z]);
}
export function project(x, y, z) {
  if (z <= 0.1) return null;
  const fovRad   = (FOV_DEG * Math.PI) / 180;
  const focalLen = (S.canvas.width / 2) / Math.tan(fovRad / 2);
  return {
    sx:    S.canvas.width  / 2 + (x / z) * focalLen,
    sy:    S.canvas.height / 2 - (y / z) * focalLen,
    depth: z
  };
}
export function getCursorLonLat() {
  const forward = qRotateVec(S.camQ, [0, 0, 1]);
  return {
    lon: Math.atan2(forward[0], forward[2]),
    lat: Math.asin(Math.max(-1, Math.min(1, forward[1])))
  };
}
export function screenToLonLat(px, py) {
  const fovRad   = (FOV_DEG * Math.PI) / 180;
  const focalLen = (S.canvas.width / 2) / Math.tan(fovRad / 2);
  const dx = (px - S.canvas.width  / 2) / focalLen;
  const dy = -(py - S.canvas.height / 2) / focalLen;
  const dz = 1;
  const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
  const world = qRotateVec(S.camQ, [dx/len, dy/len, dz/len]);
  return {
    lon: Math.atan2(world[0], world[2]),
    lat: Math.asin(Math.max(-1, Math.min(1, world[1])))
  };
}
