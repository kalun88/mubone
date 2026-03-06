// ============================================================================
// QUATERNION MATH & SPHERICAL PROJECTION
// ============================================================================

import { S, SPHERE_RADIUS, FOV_DEG } from './state.js';

// ── Quaternion helpers ───────────────────────────────────────────────────────

export function qMul(a, b) {
  return [
    a[0]*b[0] - a[1]*b[1] - a[2]*b[2] - a[3]*b[3],
    a[0]*b[1] + a[1]*b[0] + a[2]*b[3] - a[3]*b[2],
    a[0]*b[2] - a[1]*b[3] + a[2]*b[0] + a[3]*b[1],
    a[0]*b[3] + a[1]*b[2] - a[2]*b[1] + a[3]*b[0]
  ];
}
export function qNormalize(q) {
  const len = Math.sqrt(q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3]);
  return [q[0]/len, q[1]/len, q[2]/len, q[3]/len];
}
export function qFromAxisAngle(ax, ay, az, angle) {
  const half = angle / 2, s = Math.sin(half);
  return [Math.cos(half), ax*s, ay*s, az*s];
}
export function qConjugate(q) { return [q[0], -q[1], -q[2], -q[3]]; }
export function qRotateVec(q, v) {
  const vq = [0, v[0], v[1], v[2]];
  const r  = qMul(qMul(q, vq), qConjugate(q));
  return [r[1], r[2], r[3]];
}

// ── 3D Math — inside-sphere camera ───────────────────────────────────────────

export function spherePoint(lon, lat) {
  return [
    SPHERE_RADIUS * Math.cos(lat) * Math.cos(lon),
    SPHERE_RADIUS * Math.sin(lat),
    SPHERE_RADIUS * Math.cos(lat) * Math.sin(lon)
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
    lon: Math.atan2(forward[2], forward[0]),
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
    lon: Math.atan2(world[2], world[0]),
    lat: Math.asin(Math.max(-1, Math.min(1, world[1])))
  };
}
