// ============================================================================
// relational-features.js — Δ-identity between frame (chest) and cursor (hand)
//
// Publishes a posture identity vector into S.staging.relational that the
// snapshot engine + posture map consume.  Vector components:
//
//   daz    — horizontal angle of the cursor's forward direction, frame-relative.
//            Matches atan2(forward.x, forward.z) — same convention as the main
//            app's getCursorLonLat().  Positive daz = cursor pointing to the
//            performer's right relative to the frame.
//   dpitch — vertical angle of the cursor's forward direction, frame-relative.
//            Matches asin(forward.y).  Positive dpitch = cursor pointing up
//            relative to the frame.
//   droll  — twist around the cursor's forward axis, frame-relative.  Extracted
//            via swing-twist decomposition and sign-flipped so positive droll
//            matches the performer's physical intuition (rolling the cursor
//            clockwise from their own POV → positive droll).
//
// Important: earlier versions of this module used quatToEulerDeg (ZYX aerospace
// euler), which labels rotations around X/Y/Z as roll/pitch/yaw.  In our +Y-up
// / +Z-forward / +X-right graphics convention, those aerospace labels don't
// line up with the user's semantic "daz/dpitch/droll" — a pure horizontal
// rotation around world-Y shows up as aerospace "pitch", etc.  That made the
// readouts and snapshots land in the wrong slots.  The forward-vector +
// swing-twist approach below sidesteps the confusion entirely and matches
// what the main-app sphere already uses to compute cursor lon/lat.
// ============================================================================

import { S } from './state.js';
import {
  getByRole,
  getFrameQ,
  getCursorWorldQ,
} from './sensor-registry.js';

const DEG = 180 / Math.PI;

function _ensureStagingState() {
  if (!S.staging) S.staging = {};
  if (!S.staging.relational) {
    S.staging.relational = {
      daz:       0,
      dpitch:    0,
      droll:     0,
      hasFrame:  false,
      hasCursor: false,
      lastTickAt: 0,
    };
  }
  return S.staging.relational;
}

// ── Quaternion helpers ([x, y, z, w]) ───────────────────────────────────────

function qMul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function qRotateVec(q, v) {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

// ── Swing-twist twist extraction ────────────────────────────────────────────
// Given a quat q and its forward vector fwd = qRotateVec(q, [0,0,1]), return
// the twist angle around fwd (in radians).  Zero when q is a pure "swing"
// that just repoints forward; nonzero when q additionally twists around the
// forward axis.  Sign follows the right-hand rule around +fwd.
function _twistAngle(q, fwd) {
  const up = qRotateVec(q, [0, 1, 0]);
  const worldUp = [0, 1, 0];
  const wDotF = fwd[1];  // worldUp · fwd = 0*fx + 1*fy + 0*fz
  const refUp = [
    -wDotF * fwd[0],
    1 - wDotF * fwd[1],
    -wDotF * fwd[2],
  ];
  const refLen = Math.hypot(refUp[0], refUp[1], refUp[2]);
  if (refLen < 1e-4) return 0;   // looking straight up or down — twist is ambiguous
  refUp[0] /= refLen; refUp[1] /= refLen; refUp[2] /= refLen;

  const uDotF = up[0]*fwd[0] + up[1]*fwd[1] + up[2]*fwd[2];
  const rotUp = [
    up[0] - uDotF * fwd[0],
    up[1] - uDotF * fwd[1],
    up[2] - uDotF * fwd[2],
  ];
  const rotLen = Math.hypot(rotUp[0], rotUp[1], rotUp[2]);
  if (rotLen < 1e-4) return 0;
  rotUp[0] /= rotLen; rotUp[1] /= rotLen; rotUp[2] /= rotLen;

  const cosA = Math.max(-1, Math.min(1,
    refUp[0]*rotUp[0] + refUp[1]*rotUp[1] + refUp[2]*rotUp[2]));
  const cross = [
    refUp[1]*rotUp[2] - refUp[2]*rotUp[1],
    refUp[2]*rotUp[0] - refUp[0]*rotUp[2],
    refUp[0]*rotUp[1] - refUp[1]*rotUp[0],
  ];
  const sinA = cross[0]*fwd[0] + cross[1]*fwd[1] + cross[2]*fwd[2];
  return Math.atan2(sinA, cosA);
}

// Write daz/dpitch/droll onto `rel` from a quat q.
function _writeIdentity(rel, q) {
  const fwd = qRotateVec(q, [0, 0, 1]);
  const clampedY = Math.max(-1, Math.min(1, fwd[1]));
  rel.daz    = Math.atan2(fwd[0], fwd[2]) * DEG;
  rel.dpitch = Math.asin(clampedY) * DEG;
  // Swing-twist gives the mathematical angle under right-hand rule around
  // +forward — negate so positive droll matches the performer's physical
  // intuition (rolling their hand CW from their own POV → positive droll).
  rel.droll  = -_twistAngle(q, fwd) * DEG;
}

/**
 * Compute and publish the current relational vector.
 * Safe to call at any rate — it's a read + a few trig ops, no allocation.
 */
export function tickRelational() {
  const rel = _ensureStagingState();

  const frameSlot  = getByRole('frame');
  const cursorSlot = getByRole('cursor');

  rel.hasFrame  = !!(frameSlot && frameSlot.quat);
  rel.hasCursor = !!(cursorSlot && cursorSlot.quat);
  rel.lastTickAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  if (!rel.hasCursor) {
    // No cursor — nothing to publish; leave last values in place so consumers
    // don't glitch to zero on momentary dropouts.
    return rel;
  }

  if (rel.hasFrame) {
    // Frame-relative: Δ = conj(F_world) · C_world.  getFrameQ() already
    // returns conj(F_world); getCursorWorldQ() returns C_world via the same
    // tare → axis-map pipeline, so both live in the same world convention and
    // the product collapses to identity when both sensors rotate together.
    //
    // If either lookup returns null mid-stream (momentary sensor dropout),
    // hold the last values rather than switching to cursor-absolute — a path
    // switch would read as a sudden jump on the posture map.
    const fQ = getFrameQ();
    const cQ = getCursorWorldQ();
    if (fQ && cQ) _writeIdentity(rel, qMul(fQ, cQ));
    return rel;
  }

  // Cursor-only fallback — use the cursor's own world quat directly.
  // Lower-quality signal (no chest reference, walking around the room moves
  // everything) but keeps the module useful with a single sensor.
  const cQ = getCursorWorldQ();
  if (cQ) _writeIdentity(rel, cQ);
  return rel;
}

/**
 * Project the current relational object into the identity vector order that
 * snapshots + kernels expect: [daz, dpitch, droll].
 * Kept separate so future identity extensions (rate, energy) can be added
 * without touching the tick loop.
 */
export function identityVectorFromRelational(rel) {
  return [rel.daz || 0, rel.dpitch || 0, rel.droll || 0];
}

/**
 * Default axis labels for the identity vector — used by the UI.
 */
export const IDENTITY_AXES = ['Δaz', 'Δpitch', 'Δroll'];
export const IDENTITY_KEYS = ['daz', 'dpitch', 'droll'];
