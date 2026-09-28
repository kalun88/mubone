// ============================================================================
// sensor-math.js — every piece of sensor maths, pure
//
// No app state, no DOM, no storage: quaternions in, quaternions out. The
// registry (sensor-registry.js) calls these on live slots, and
// scripts/sensor-audit.js imports THESE SAME FUNCTIONS — it used to test a
// hand-typed copy, which could pass while the app was wrong.
//
// Quaternions are [x, y, z, w]. Two frames meet here:
//   SENSOR / WORLD  Z-up (the BNO085 and the x-imu3 both report Z-up), so
//                   yaw is about Z and quatToEulerDeg is ZYX Tait-Bryan.
//   SPHERE          Y-up graphics: yaw about (0,1,0), pitch about (1,0,0),
//                   roll about (0,0,1), forward (0,0,1).
// orientation() is the ONE crossing from the first to the second.
//
// The pipeline, for one sensor:
//   q (raw) ──applyCal──▶ calibrated, Z-up ──orientation──▶ sphere, Y-up
//                                          └─attitude────▶ {roll, pitch, yaw}° (up is +pitch)
// and for the camera role, panTilt() then drops the roll.
// ============================================================================

// ── Quaternion basics ───────────────────────────────────────────────────────

export function qMul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw*bx + ax*bw + ay*bz - az*by,
    aw*by - ax*bz + ay*bw + az*bx,
    aw*bz + ax*by - ay*bx + az*bw,
    aw*bw - ax*bx - ay*by - az*bz,
  ];
}

export function qConj(q) { return [-q[0], -q[1], -q[2], q[3]]; }

// Rotation of `rad` radians about the unit axis (ax, ay, az).
export function qFromAxisAngle(ax, ay, az, rad) {
  const s = Math.sin(rad * 0.5);
  return [ax * s, ay * s, az * s, Math.cos(rad * 0.5)];
}

// ZYX Tait-Bryan in degrees, Z-up: x = roll, y = pitch, z = yaw.
export function quatToEulerDeg(x, y, z, w) {
  const roll  = Math.atan2(2*(w*x + y*z), 1 - 2*(x*x + y*y)) * (180 / Math.PI);
  const sinp  = 2*(w*y - z*x);
  const pitch = (Math.abs(sinp) >= 1
    ? Math.sign(sinp) * 90
    : Math.asin(sinp) * (180 / Math.PI));
  const yaw   = Math.atan2(2*(w*z + x*y), 1 - 2*(y*y + z*z)) * (180 / Math.PI);
  return { x: roll, y: pitch, z: yaw };
}

// ── Calibration: output = conj(H) · q · conj(B) ────────────────────────────
// B (mountQuat) is BODY-side and absorbs any mounting rotation — hand, wrist,
// head, a sensor worn vertically on a back. H (headingQuat) is WORLD-side and
// a pure rotation about vertical, which is what makes it COMMUTE with a
// performer turning on the spot: conj(H)·Rz(φ)·H·B·conj(B) = Rz(φ), so a turn
// reads as yaw and nothing else at EVERY mounting angle.
//
// Putting the mount on the left instead makes the output frame the device's
// own rest frame, whose Z is the device's up rather than the world's; a sensor
// worn vertically on a back then reads a turn as pitch (Ek, 2026-08-31).
// sensor-audit.js § G is that case. Both no-op on null, so an uncalibrated
// sensor passes through untouched.
export function applyCal(quat, cal) {
  let q = quat;
  if (cal?.mountQuat)   q = qMul(q, qConj(cal.mountQuat));
  if (cal?.headingQuat) q = qMul(qConj(cal.headingQuat), q);
  return q;
}

// Swing-twist: the part of `q` that is a rotation about world +Z. Used only
// where the pose is LEVEL by construction (mountFromPoses: pose 1 is level in
// B's own frame) — not for the heading zero, see headingAboutZ. Degenerate at
// 180° about a horizontal axis, where z and w both vanish: returns identity
// there rather than a normalised zero (an upside-down mount, 2026-08-31).
const TWIST_EPS = 1e-6;
export function twistAboutZ(q) {
  const z = q[2], w = q[3];
  const n = Math.hypot(z, w);
  if (n < TWIST_EPS) return [0, 0, 0, 1];
  return [0, 0, z / n, w / n];
}

// The pure rotation about world Z that carries q's forward (body X) axis to
// azimuth 0 — quatToEulerDeg's yaw, as a quaternion. Defined at every pitch and
// roll. This is the heading zero: it was twistAboutZ until 2026-09-10, which is
// the heading only at a level pose — 0.9° off at 10°/10°, and near a 180° roll
// (an uncalibrated upside-down mount) a zero could land at lon −69° ("it
// doesn't go back to 0 0, always a bit off, only sometimes"). § B2 of the audit.
export function headingAboutZ(q) {
  const [x, y, z, w] = q;
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)];
}

// ── Two-pose mount calibration ──────────────────────────────────────────────
// ONE pose cannot determine a mounting — a missing degree of freedom, not a
// tuning problem: a strap's own twist about vertical is indistinguishable from
// the performer's heading, and a performer's pitch then smears into roll by
// that angle (26° of false roll measured for a twisted mount, 2026-08-31).
// Two poses pin the frame:
//   pose 1  neutral, pointing forward  → gravity is the performer's UP
//   pose 2  pointing down at the earth → the rotation axis is LEFT-RIGHT

function v3norm(v) { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/n, v[1]/n, v[2]/n]; }
function v3cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function v3dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }

// Rotate a WORLD vector into the body frame: conj(q) · v · q
function worldToBody(q, v) {
  const t = [2*(q[1]*v[2] - q[2]*v[1]), 2*(q[2]*v[0] - q[0]*v[2]), 2*(q[0]*v[1] - q[1]*v[0])];
  return [v[0] - q[3]*t[0] + (q[1]*t[2] - q[2]*t[1]),
          v[1] - q[3]*t[1] + (q[2]*t[0] - q[0]*t[2]),
          v[2] - q[3]*t[2] + (q[0]*t[1] - q[1]*t[0])];
}

// Quaternion for the rotation whose matrix has these three COLUMNS.
function quatFromCols(cx, cy, cz) {
  const m = [[cx[0], cy[0], cz[0]], [cx[1], cy[1], cz[1]], [cx[2], cy[2], cz[2]]];
  const tr = m[0][0] + m[1][1] + m[2][2];
  let x, y, z, w, s;
  if (tr > 0) {
    s = Math.sqrt(tr + 1) * 2; w = 0.25*s;
    x = (m[2][1]-m[1][2])/s; y = (m[0][2]-m[2][0])/s; z = (m[1][0]-m[0][1])/s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; w = (m[2][1]-m[1][2])/s;
    x = 0.25*s; y = (m[0][1]+m[1][0])/s; z = (m[0][2]+m[2][0])/s;
  } else if (m[1][1] > m[2][2]) {
    s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; w = (m[0][2]-m[2][0])/s;
    x = (m[0][1]+m[1][0])/s; y = 0.25*s; z = (m[1][2]+m[2][1])/s;
  } else {
    s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; w = (m[1][0]-m[0][1])/s;
    x = (m[0][2]+m[2][0])/s; y = (m[1][2]+m[2][1])/s; z = 0.25*s;
  }
  return [x, y, z, w];
}

// How far apart the two poses must be for the axis to mean anything. Below
// this the cross product is noise and the calibration would be worse than none.
export const MOUNT_POSE_MIN_DEG = 20;

// Two quaternions in, { mountQuat, headingQuat } out — or null if the poses
// are too close together, or tipped about vertical (a turn has no frame in it).
export function mountFromPoses(q1, q2) {
  if (!q1 || !q2) return null;
  const up = v3norm(worldToBody(q1, [0, 0, 1]));     // performer UP, sensor coords
  const d  = qMul(qConj(q1), q2);                    // pose 1 → pose 2, sensor coords
  const sgn = d[3] < 0 ? -1 : 1;                     // shortest arc
  let ax = [d[0]*sgn, d[1]*sgn, d[2]*sgn];
  const axLen = Math.hypot(ax[0], ax[1], ax[2]);
  const angDeg = 2 * Math.atan2(axLen, Math.abs(d[3])) * 180 / Math.PI;
  if (angDeg < MOUNT_POSE_MIN_DEG) return null;
  ax = v3norm(ax);
  // Tipping DOWN is a negative pitch, so the measured axis is −Y.
  let yp = [-ax[0], -ax[1], -ax[2]];
  const along = v3dot(yp, up);
  yp = v3norm([yp[0] - along*up[0], yp[1] - along*up[1], yp[2] - along*up[2]]);
  if (!Number.isFinite(yp[0]) || Math.hypot(...yp) < 0.5) return null;   // tipped about vertical
  const zp = up;
  const xp = v3cross(yp, zp);                        // right-handed: X = Y × Z
  const B = qConj(quatFromCols(xp, yp, zp));         // sensor → performer
  const H = twistAboutZ(qMul(q1, qConj(B)));         // now the TRUE heading
  return { mountQuat: B, headingQuat: H };
}

// ── Z-up → the sphere's Y-up, and the three signs ──────────────────────────
// orientation() decomposes Z-up (quatToEulerDeg) and recomposes in the
// sphere's Y-up convention. That relabelling is mount-independent, so its
// correction lives in the DEFAULT signs, once: leave pitch and yaw at +1 and
// every freshly calibrated mount needs the same two manual flips (Ek,
// 2026-08-31, across four mountings). The Sensors page's polarity buttons flip
// these; nothing else about the axes is settable. (Until 2026-09-27 this was a
// per-axis map of {viz, sign, mute} with a second, forward-vector maths path
// for a muted roll — neither settable since 2026-09-01.) Audit § I.
export const DEFAULT_SIGNS = Object.freeze({ roll: 1, pitch: -1, yaw: -1 });

// Calibrated, signed Euler angles in the SPHERE's convention: yaw about +Y,
// pitch about +X, roll about +Z. The one input orientation() recomposes.
function sphereEuler(q, cal) {
  const t = applyCal(q, cal);
  const e = quatToEulerDeg(t[0], t[1], t[2], t[3]);
  const s = cal?.signs || DEFAULT_SIGNS;
  return { roll: s.roll * e.x, pitch: s.pitch * e.y, yaw: s.yaw * e.z };
}

// The sensor's orientation on the sphere (Y-up): calibrate, then relabel.
export function orientation(q, cal) {
  const a = sphereEuler(q, cal);
  const DEG = Math.PI / 180;
  return qMul(qFromAxisAngle(0, 1, 0, a.yaw * DEG),
         qMul(qFromAxisAngle(1, 0, 0, a.pitch * DEG),
              qFromAxisAngle(0, 0, 1, a.roll * DEG)));
}

// Calibrated attitude in degrees, as a PERSON reads it: what the Sensors page
// shows and what a sensor binding's Elevation / Roll / Azimuth read. Tipping
// up is POSITIVE pitch. The sphere's own pitch is the opposite sign — a
// rotation about +X tips the forward axis DOWN — and this returned that
// until 2026-09-27, so the page and every Elevation binding went down as the
// hand rose while the cursor went up. Yaw is the cursor's azimuth as is;
// pitch and roll are gravity-referenced, yaw is heading and drifts with the
// magnetometer off.
export function attitude(q, cal) {
  const a = sphereEuler(q, cal);
  return { roll: a.roll, pitch: -a.pitch, yaw: a.yaw };
}

// PAN and TILT only: the azimuth and elevation of a sphere orientation's
// forward axis, recomposed yaw-about-Y then pitch-about-X — the same no-roll
// shape the single-sensor camera uses. The camera role reads this: roll never
// reaches the sphere (Ek, 2026-09-01), and passing the whole rotation through
// rolled the view 20° when a body sensor leaned 20° sideways (2026-09-27).
// Undefined straight up or down, where the azimuth is.
export function panTilt(q) {
  const [x, y, z, w] = q;   // forward = q · (0,0,1)
  const fx = 2 * (x * z + w * y), fy = 2 * (y * z - w * x), fz = 1 - 2 * (x * x + y * y);
  const yaw   = Math.atan2(fx, fz);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -fy)));
  return qMul(qFromAxisAngle(0, 1, 0, yaw), qFromAxisAngle(1, 0, 0, pitch));
}
