// ============================================================================
// plate-analysis.js — x-IMU3 on a rotating plate (lazy susan) → plate state
//
// Run via [js plate-analysis.js] in Max.
//
// INLET 0 — "Linear acceleration" message, 8 numbers
// (User Manual v1.11 §8.2.7, ASCII prefix "L"):
//
//   [ timestamp_us, qW, qX, qY, qZ, laX_g, laY_g, laZ_g ]
//
// Linear acceleration is gravity-removed and expressed in the SENSOR frame —
// which is what we want, because the centripetal vector is stationary in the
// sensor frame while the plate spins.
//
// INLET 1 — "Inertial" message, 7 numbers (optional but recommended)
// (§8.2.2, ASCII prefix "I"). Note SEVEN, not eight: it has six arguments to the
// L message's seven.
//
//   [ timestamp_us, gyroX_dps, gyroY_dps, gyroZ_dps, accX_g, accY_g, accZ_g ]
//
// Only the gyroscope is used. Its accelerometer values still contain gravity,
// and inlet 0 already supplies a gravity-removed version. Feeding this inlet is
// optional — without it, angular velocity is recovered by differentiating
// successive quaternions instead, which works but is noisier.
//
// OUTPUTS (right to left):
//   0  plate angle, wrapped   [0..360)      degrees
//   1  plate angle, unwrapped                degrees (accumulates over turns)
//   2  plate rate                            deg/s (+ve = CCW seen from above)
//   3  radius                                metres  (held when unmeasurable)
//   4  radius normalised      [0..1]         radius / plateradius
//   5  face index             1..N           0 = undetermined
//   6  dump — flat list of diagnostics (see _dump below)
//   7  cube angle vs radius   [0..360)      degrees (held when unmeasurable)
//
// MESSAGES:
//   zero                      reset unwrapped plate angle + revolution count
//   plateradius <m>           physical plate radius for the normalised output
//                             (default 0.15)
//   tau <ms>                  smoothing time constant, accel + rate (default 120)
//   holdthresh <v>            gate on sqrt(w^4 + a^2); below this, radius holds
//                             (default 2.0)
//   minaccel <m/s^2>          acceleration floor; below this the radius is not
//                             trusted either (default 0.15)
//   learn <index>             capture the current orientation as the template
//                             for face <index> (1..N). Do this once per face.
//   forget <index>            drop that template
//   clearfaces                drop all learned templates, fall back to the 6
//                             axis-aligned defaults
//   dumpfaces                 post learned templates to the Max console
//   refaxis auto|x|y|z        cube-fixed axis the radial angle is measured from
//                             (default auto)
//   zeroangle                 call the current cube angle 0 degrees
//   dump                      force a diagnostics output (outlet 6)
//   diagnose                  explain in the Max console why something is not
//                             working — start here if a value looks wrong
//   monitor <hz>              post live numbers to the console at <hz>, 0 = off
//   gyromaxage <s>            staleness limit for the cached gyro (default 0.05)
//   setverbose <0|1>          console logging
//
// ---------------------------------------------------------------------------
// HOW IT WORKS
//
// The plate spins about the world vertical, so the rotation axis in sensor
// coordinates is simply "which way is up", i.e. the world up-vector rotated
// into the sensor frame. One vector does double duty: it is the spin axis for
// the radius maths AND the signature used to identify which face the cube is
// resting on.
//
// Radius. Decompose linear acceleration into components along and across that
// axis. The across-axis part is
//
//     a_perp = -w^2 * r * r_hat  +  alpha * r * t_hat
//              \___centripetal__/   \___tangential___/
//
// and those two terms are orthogonal, so exactly and instantaneously
//
//     |a_perp|^2 = r^2 * (w^4 + alpha^2)
//
// This covers both regimes at once: steady spin (alpha≈0, centripetal carries
// the signal) and a flick from rest (w≈0, tangential carries it). It degenerates
// only when the plate is motionless in both — and then r physically cannot be
// changing, so the last good value is held rather than dividing by ~0. That is
// the answer to "what happens when wz is 0-ish": not a zero, a freeze.
//
// The estimator is a ratio of smoothed SQUARES,
//
//     r = sqrt( smooth(|a_perp|^2) / smooth(w^4 + alpha^2) )
//
// which is exact under any linear filtering because both sides differ by the
// constant factor r^2. Every other arrangement tried here was measurably biased:
// smoothing |a_perp| against sqrt(smooth(w^4)) droops toward zero during a decay
// (the two fall at exp(-t/tau) and exp(-t/2tau)), and squaring already-smoothed
// rate or alpha reads high on any ramp by Jensen's inequality.
//
// Angular velocity comes from differentiating consecutive quaternions (this
// message carries no gyro). Angular acceleration is a second difference, so it
// is noisier still — hence the shared time constant and the glitch rejection.
//
// Cube angle relative to the radius. The same acceleration vector that gives the
// radius also gives its DIRECTION in sensor coordinates, and the sensor is bolted
// to the cube, so the angle between that direction and any cube-fixed axis is the
// cube's rotational offset on the plate. Nothing else is needed — in particular
// this does not require the gyro, and it does not require absolute yaw (which an
// AHRS without a usable magnetometer cannot give you anyway near a metal plate).
//
// It is a constant while the cube stays put, so it is heavily averaged, and as a
// circular mean over the direction vector rather than over the angle.
//
// Face. Whichever learned template the current up-vector is closest to. The
// learn/classify approach beats hardcoding axis signs because it tolerates the
// sensor being mounted at an arbitrary angle inside the cube, and it copes with
// any number of faces. Note a cube has SIX faces, not eight — if you need 8
// states you are probably distinguishing something else (e.g. face + which way
// it's turned), so just learn all 8 poses and it will classify them fine as
// long as their up-vectors differ.
// ============================================================================

autowatch = 1;
inlets  = 2;
outlets = 9;

setinletassist(0, "Linear acceleration msg (8 nums): ts qW qX qY qZ laX laY laZ");
setinletassist(1, "Inertial msg (7 nums): ts gyroX gyroY gyroZ accX accY accZ");
setoutletassist(0, "plate angle wrapped (deg 0..360)");
setoutletassist(1, "plate angle unwrapped (deg)");
setoutletassist(2, "plate rate (deg/s)");
setoutletassist(3, "radius (m, held when unmeasurable)");
setoutletassist(4, "radius normalised (0..1)");
setoutletassist(5, "face index (1..N, 0 = undetermined)");
setoutletassist(6, "dump (diagnostics list)");
setoutletassist(7, "cube angle vs radius (deg 0..360, held when unmeasurable)");
setoutletassist(8, "measuring flag: 1 = live, 0 = holding last value");

// ── Constants ───────────────────────────────────────────────────────────────

var G          = 9.80665;   // g → m/s^2
var DEG        = 180.0 / Math.PI;
var EPS        = 1e-9;
var FACE_MIN_DOT   = 0.90;  // template match must be at least this good
var FACE_DEBOUNCE  = 8;     // consecutive agreeing frames before we switch
var MAX_DT     = 0.5;       // s — larger gap ⇒ treat as a restart
var REF_MAX_DOT  = 0.8;     // reference axis must be this far off the spin axis

// ── Tunables (settable by message) ──────────────────────────────────────────

var plateRadius = 0.15;     // m
var tauMs       = 120.0;    // ms — smoothing time constant
var holdThresh  = 0.4;      // gate on sqrt(w^4 + alpha^2). Only guards against
                            // dividing by ~nothing; minAccel below is the real
                            // gate. Was 2.0, which silently refused to measure
                            // anything below ~0.22 rev/s at a 0.15 m radius, so
                            // gentle spinning left the radius pinned at 0.
var minAccel    = 0.25;     // m/s^2 — the meaningful gate. Since r = |a|/denom
                            // and denom is well known from the gyro, the relative
                            // error in r is essentially the relative error in
                            // |a_perp| — so requiring |a_perp| to sit clear of the
                            // noise floor IS the accuracy criterion. That floor is
                            // set by AHRS tilt error leaking gravity into the plane
                            // (~0.017 g per degree of tilt), not by accel noise.
var maxAlpha    = 100.0;    // rad/s^2 — anything beyond this is not a plate
                            // being turned, it is a dropped packet or an AHRS
                            // reset. Reject the frame rather than believe it.
var maxSlew     = 0.5;      // m/s — fastest the cube could plausibly be slid.
                            // Slew-limiting the output absorbs any transient
                            // that slips past the gates.
var reacquireSec = 0.3;     // s — hold longer than this and the next good
                            // reading snaps instead of slewing.
var gyroMaxAge  = 0.05;     // s — cached gyro older than this counts as stale.
                            // Raise it if L and I arrive at very different rates
                            // or their timestamps are not from the same clock.
var refAxisMode = "auto";   // "auto" | "x" | "y" | "z" — cube reference axis
                            // that the radial angle is measured from
var angleOffset = 0.0;      // deg, subtracted from the output; set by zeroangle
var verbose     = 0;

// ── Running state ───────────────────────────────────────────────────────────

var havePrev    = 0;
var prevTs      = 0;        // µs
var prevQ       = [1, 0, 0, 0];

// Cached from the Inertial message on inlet 1. The gyro is a direct measurement
// of angular velocity, so when it is available it replaces the quaternion
// difference — one less differentiation in the chain, which matters most for
// alpha. The Inertial message's accelerometer values are deliberately ignored:
// they still contain gravity, and the Linear acceleration message already
// carries a gravity-removed version from the device's own AHRS.
var gyroBody    = [0, 0, 0];   // rad/s, sensor frame
var gyroTs      = 0;           // µs, device clock (shared with the L message)
var haveGyro    = 0;
var usingGyro   = 0;           // for the diagnostics readout

var ignored      = {};         // selector → count, for messages we don't handle
var ignoredTotal = 0;
var countL       = 0;          // Linear acceleration messages received
var countI       = 0;          // Inertial messages received
var gyroAge      = -1.0;       // s, age of the cached gyro at the last L message

var rateGyro    = 0.0;         // rad/s from the gyro
var rateQuat    = 0.0;         // rad/s from differencing quaternions
var unitWarned  = 0;           // one-shot: the two disagree, so a unit is wrong

var monitorHz   = 0;           // 0 = off
var monitorLast = 0.0;         // s, device clock

var plateRate   = 0.0;         // smoothed, rad/s, about world up
var plateAlpha  = 0.0;         // smoothed, rad/s^2, about world up
var plateW4     = 0.0;         // smoothed rate^4
var plateAlphaSq = 0.0;        // smoothed alpha^2 — NOT plateAlpha squared
var aPerpSq     = 0.0;         // smoothed |a_perp|^2, (m/s^2)^2
var prevRateRaw = 0.0;         // previous UNSMOOTHED rate, for the alpha diff

var angleUnwrap = 0.0;         // rad, accumulated
var radius      = 0.0;         // m, last GOOD estimate (held)
var radiusLive  = 0.0;         // m, this frame's raw estimate
var radiusValid = 0;
var haveRadius  = 0;           // has a good estimate ever landed?
var holdTime    = 0.0;         // s spent with the gate shut
var upBody      = [0, 0, 1];   // world up in sensor coords

// Smoothed OUTWARD radial direction in sensor coords. Smoothed as a vector, not
// as an angle — a circular mean, so it cannot tear at the 359°/0° seam. The cube
// is bolted to the plate, so in the sensor frame this vector is a constant and
// averaging it is exactly the right thing to do.
var radDir      = [1, 0, 0];
var haveRadDir  = 0;
var cubeAngle   = 0.0;         // deg, last GOOD value (held)

var faceIndex   = 0;
var faceCand    = 0;
var faceCount   = 0;
var templates   = {};          // index → unit up-vector captured at learn time

// Fallback templates: the six axis-aligned cube faces.
var DEFAULT_TEMPLATES = {
  1: [ 1,  0,  0],
  2: [-1,  0,  0],
  3: [ 0,  1,  0],
  4: [ 0, -1,  0],
  5: [ 0,  0,  1],
  6: [ 0,  0, -1]
};

// ── Vector / quaternion helpers ─────────────────────────────────────────────

function vlen(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function vnorm(v) {
  var n = vlen(v);
  if (n < EPS) return [0, 0, 0];
  return [v[0] / n, v[1] / n, v[2] / n];
}

function vdot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vcross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function qnormalise(q) {
  var n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  if (n < EPS) return [1, 0, 0, 0];
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

function qconj(q) {
  return [q[0], -q[1], -q[2], -q[3]];
}

// Hamilton product, [w x y z] convention.
function qmul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
  ];
}

// Rotate an Earth-frame vector into the sensor frame. q maps sensor → Earth, so
// this is its transpose.
function rotToSensor(q, v) {
  var w = q[0], x = q[1], y = q[2], z = q[3];
  var xx = x * x, yy = y * y, zz = z * z;
  return [
    (1 - 2 * (yy + zz)) * v[0] + (2 * (x * y + w * z)) * v[1] + (2 * (x * z - w * y)) * v[2],
    (2 * (x * y - w * z)) * v[0] + (1 - 2 * (xx + zz)) * v[1] + (2 * (y * z + w * x)) * v[2],
    (2 * (x * z + w * y)) * v[0] + (2 * (y * z - w * x)) * v[1] + (1 - 2 * (xx + yy)) * v[2]
  ];
}

// Angular velocity in the sensor frame from two successive orientations.
// dq = conj(qPrev) * qCurr is the body-frame rotation increment.
function angularVelocity(qPrev, qCurr, dt) {
  if (dt < EPS) return [0, 0, 0];
  var dq = qmul(qconj(qPrev), qCurr);
  if (dq[0] < 0) { dq = [-dq[0], -dq[1], -dq[2], -dq[3]]; }  // shortest arc
  var s = Math.sqrt(dq[1] * dq[1] + dq[2] * dq[2] + dq[3] * dq[3]);
  if (s < EPS) return [0, 0, 0];
  var angle = 2 * Math.atan2(s, dq[0]);
  var k = angle / (s * dt);
  return [dq[1] * k, dq[2] * k, dq[3] * k];
}

// One-pole coefficient for a given time constant — computed per sample so the
// smoothing behaves the same whether the device streams at 400 Hz or 25 Hz.
function poleCoeff(dt, tauSeconds) {
  if (tauSeconds < EPS) return 1.0;
  return 1.0 - Math.exp(-dt / tauSeconds);
}

function lerp3(dst, src, k) {
  dst[0] += (src[0] - dst[0]) * k;
  dst[1] += (src[1] - dst[1]) * k;
  dst[2] += (src[2] - dst[2]) * k;
}

function wrap360(deg) {
  var d = deg % 360.0;
  if (d < 0) d += 360.0;
  return d;
}

// ── Face classification ─────────────────────────────────────────────────────

function activeTemplates() {
  var keys = [];
  for (var k in templates) { if (templates.hasOwnProperty(k)) keys.push(k); }
  return keys.length ? templates : DEFAULT_TEMPLATES;
}

function classifyFace(up) {
  var set = activeTemplates();
  var best = 0, bestDot = -2;
  for (var k in set) {
    if (!set.hasOwnProperty(k)) continue;
    var d = vdot(up, vnorm(set[k]));
    if (d > bestDot) { bestDot = d; best = parseInt(k, 10); }
  }
  if (bestDot < FACE_MIN_DOT) return 0;
  return best;
}

// ── Reference frame for the cube-relative angle ──────────────────────────────

// Pick a cube-fixed direction to measure the radial angle FROM. It has to be
// well clear of the spin axis or its in-plane projection is meaningless.
//
// "auto" walks x → y → z and takes the first axis at least REF_MAX_DOT away from
// vertical. Deliberately a fixed priority rather than "whichever is most
// horizontal": on a cube resting flat, two axes are equally horizontal and
// picking the best of them would flicker between them on noise.
function referenceAxis(up) {
  if (refAxisMode === "x") return [1, 0, 0];
  if (refAxisMode === "y") return [0, 1, 0];
  if (refAxisMode === "z") return [0, 0, 1];
  if (Math.abs(up[0]) < REF_MAX_DOT) return [1, 0, 0];
  if (Math.abs(up[1]) < REF_MAX_DOT) return [0, 1, 0];
  return [0, 0, 1];
}

// ── Inertial message ────────────────────────────────────────────────────────

function handleInertial(a) {
  if (a.length < 7) {
    error("plate-analysis: Inertial needs 7 values (ts gx gy gz ax ay az), got " +
          a.length + "\n");
    return;
  }
  // deg/s → rad/s. Accelerometer values (a[4..6]) intentionally unused: they
  // still contain gravity, and the Linear acceleration message already carries a
  // gravity-removed version computed by the device's own AHRS.
  gyroBody = [a[1] / DEG, a[2] / DEG, a[3] / DEG];
  gyroTs   = a[0];
  haveGyro = 1;
  countI++;
}

// ── Dispatch ────────────────────────────────────────────────────────────────
//
// Three wirings all work, so nothing has to be repacked upstream:
//
//   1. The mixed pre-route stream into inlet 0. Messages still carry their "L"
//      or "I" selector, which lands here as `messagename` and is dispatched
//      below. One cable, no [route] needed.
//   2. [route L I] outlets into inlets 0 and 1 respectively. route strips the
//      selector, so these arrive as bare lists.
//   3. Linear acceleration alone into inlet 0. No gyro, quaternion fallback.

// The device interleaves housekeeping messages into the same stream — B battery
// (§8.2.12), W Wi-Fi RSSI (§8.2.13), T temperature, U AHRS status, F error, and
// others depending on what is enabled. They are silently ignored: an unknown
// selector is normal traffic, not a fault, and erroring on it would flood the
// Max console. Counts are kept so `dump` can show what is being dropped.
function anything() {
  var sel = String(messagename);
  var a   = arrayfromargs(arguments);      // selector already excluded
  if (sel === "L" || sel === "l") { handleLinear(a);   return; }
  if (sel === "I" || sel === "i") { handleInertial(a); return; }
  ignored[sel] = (ignored[sel] || 0) + 1;
  ignoredTotal++;
}

function list() {
  var a = arrayfromargs(arguments);
  if (inlet === 1) handleInertial(a);
  else             handleLinear(a);
}

// ── Main handler ────────────────────────────────────────────────────────────

function handleLinear(a) {
  if (a.length < 8) {
    error("plate-analysis: Linear acceleration needs 8 values " +
          "(ts qW qX qY qZ laX laY laZ), got " + a.length + "\n");
    return;
  }
  countL++;

  var ts = a[0];                                  // µs
  var q  = qnormalise([a[1], a[2], a[3], a[4]]);
  var la = [a[5] * G, a[6] * G, a[7] * G];        // g → m/s^2, sensor frame

  // --- dt from the device timestamp. It is far better than a Max clock read,
  // which is why we do not in fact throw the timetag away.
  var dt;
  if (!havePrev) {
    dt = 0;
  } else {
    dt = (ts - prevTs) * 1e-6;
    if (dt <= 0 || dt > MAX_DT) {
      // Backwards or a long stall (device reboot, patch reload) — restart.
      havePrev = 0;
      dt = 0;
    }
  }

  if (!havePrev) {
    prevTs      = ts;
    prevQ       = q;
    havePrev    = 1;
    upBody      = vnorm(rotToSensor(q, [0, 0, 1]));
    prevRateRaw = 0.0;
    return;
  }

  var tau = tauMs * 0.001;
  var k   = poleCoeff(dt, tau);

  // --- Spin axis in sensor coordinates == world up in sensor coordinates,
  // because a lazy susan turns about the vertical. Doubles as the face
  // signature below. Comes straight off the AHRS so it is already clean; the
  // light smoothing here is only to steady the face classifier.
  var upRaw = vnorm(rotToSensor(q, [0, 0, 1]));
  lerp3(upBody, upRaw, k);
  upBody = vnorm(upBody);

  // --- Plate rate about the spin axis, UNSMOOTHED. Everything downstream
  // derives from this one raw value so that no signal picks up more filter lag
  // than another — see the note before the radius calculation.
  //
  // Prefer the gyro from the Inertial message: it measures angular velocity
  // directly, where the quaternion route has to differentiate an already-filtered
  // orientation estimate. The difference is small for the rate and large for
  // alpha, which is a further derivative on top.
  // Always compute BOTH so they can be cross-checked. They measure the same
  // physical quantity by independent routes, so a large disagreement means a
  // unit is wrong somewhere upstream — a patch that already converted the gyro
  // to rad/s would read 57x low here, which would then land as a ~3250x error in
  // the radius (denominator goes as the square). Worth catching loudly.
  var wQuat = angularVelocity(prevQ, q, dt);
  rateQuat  = vdot(wQuat, upRaw);
  rateGyro  = haveGyro ? vdot(gyroBody, upRaw) : 0.0;

  gyroAge = haveGyro ? Math.abs((ts - gyroTs) * 1e-6) : -1.0;

  var wRaw;
  if (haveGyro && gyroAge <= gyroMaxAge) {
    wRaw      = gyroBody;
    usingGyro = 1;
  } else {
    wRaw      = wQuat;
    usingGyro = 0;
  }
  var rateRaw = vdot(wRaw, upRaw);                // rad/s about the plate axis

  if (usingGyro && !unitWarned) {
    var mag = Math.max(Math.abs(rateGyro), Math.abs(rateQuat));
    if (mag > 1.0 && Math.abs(rateGyro - rateQuat) > 0.35 * mag) {
      unitWarned = 1;
      post("plate-analysis: WARNING gyro and quaternion rates disagree — " +
           "gyro " + (rateGyro * DEG).toFixed(1) + " deg/s vs quaternion " +
           (rateQuat * DEG).toFixed(1) + " deg/s. Check the Inertial gyro is in " +
           "deg/s (ratio ~57 means it is already radians) and that inlet 1 is " +
           "fed the I message, not something else.\n");
    }
  }

  var alphaRaw = (rateRaw - prevRateRaw) / dt;
  prevRateRaw  = rateRaw;

  // A plate turned by hand cannot exceed maxAlpha. A value that does is an AHRS
  // reset arriving as a one-sample quaternion jump. Squaring it would swamp the
  // denominator for a whole time constant afterwards, so the whole frame is
  // discarded rather than clamped-and-used: holding the filters at their
  // pre-glitch state IS the best estimate, since nothing physical happened.
  // Clamping instead still read 7% low for a stationary plate after a hard stop.
  //
  // Note a genuinely dropped packet does NOT trip this — it arrives with a
  // correspondingly larger dt, so the rate stays plausible and the frame is
  // used normally.
  var glitch = (alphaRaw > maxAlpha || alphaRaw < -maxAlpha) ? 1 : 0;

  if (!glitch) {
    // --- Plate angle: integrate the RAW rate. Integration is itself a low-pass,
    // so smoothing first buys nothing and costs a systematic lag — a smoothed
    // rate integrated over three turns came up ~8% short in testing, because
    // each cascaded pole loses tau*rate of travel at every rate change.
    angleUnwrap += rateRaw * dt;

    plateRate  += (rateRaw - plateRate) * k;
    plateAlpha += (alphaRaw - plateAlpha) * k;   // signed, for diagnostics only
  }

  // --- Radius, as a ratio of smoothed SQUARES.
  //
  // Instantaneously and exactly, |a_perp|^2 = r^2 * (w^4 + alpha^2). Both sides
  // are therefore proportional by the constant r^2, so applying the SAME linear
  // filter to each preserves the relationship and
  //
  //     r = sqrt( smooth(|a_perp|^2) / smooth(w^4 + alpha^2) )
  //
  // is exact whatever the filter is doing — mid-ramp, mid-decay, anywhere.
  //
  // Comparing smoothed |a_perp| against sqrt(smoothed w^4) instead, which is the
  // obvious formulation, is subtly wrong: during a decay the numerator falls as
  // exp(-t/tau) while the square root of the denominator falls as exp(-t/2tau),
  // so the quotient droops toward zero. That bug read 0.027 m for a stationary
  // 0.200 m setup after the plate stopped.
  // Both the numerator and the two denominator terms are squared quantities
  // smoothed by the same pole, and all three are skipped together on a glitch
  // frame so they can never drift out of step with one another.
  //
  // smooth(alpha^2) not smooth(alpha)^2, and smooth(w^4) not smooth(w)^4 — the
  // same Jensen trap in both terms. Squaring the smoothed values read 12.6% high
  // on a flick from rest, where alpha carries the entire signal.
  if (!glitch) {
    var alongR = vdot(la, upRaw);
    var A      = [
      la[0] - alongR * upRaw[0],
      la[1] - alongR * upRaw[1],
      la[2] - alongR * upRaw[2]
    ];

    aPerpSq      += (vdot(A, A) - aPerpSq) * k;
    plateAlphaSq += (alphaRaw * alphaRaw - plateAlphaSq) * k;
    plateW4      += (rateRaw * rateRaw * rateRaw * rateRaw - plateW4) * k;

    // --- Which WAY the radius points, in sensor coordinates.
    //
    // In the plate plane, with r_hat outward and t_hat = up × r_hat,
    //
    //     A = -r*w^2 * r_hat  +  r*alpha * t_hat
    //
    // so A alone does not give r_hat unless alpha happens to be zero — while
    // spinning up, A leans toward the tangent by atan2(alpha, w^2). Taking the
    // cross product too gives a second equation,
    //
    //     up × A = -r*alpha * r_hat  -  r*w^2 * t_hat
    //
    // and the combination -(w^2 * A + alpha * (up × A)) = r(w^4 + alpha^2) r_hat
    // cancels the tangential part exactly, for either spin direction. Check the
    // two limits: alpha=0 leaves -A (centripetal points inward, so outward is
    // -A), and w=0 leaves -alpha*(up × A), which for a pure tangential A is
    // +r*alpha^2 * r_hat.
    var cr  = vcross(upRaw, A);
    var w2r = rateRaw * rateRaw;
    var rd  = [
      -(w2r * A[0] + alphaRaw * cr[0]),
      -(w2r * A[1] + alphaRaw * cr[1]),
      -(w2r * A[2] + alphaRaw * cr[2])
    ];
    var rdLen = vlen(rd);
    if (rdLen > EPS) {
      rd = [rd[0] / rdLen, rd[1] / rdLen, rd[2] / rdLen];
      if (!haveRadDir) { radDir = rd; haveRadDir = 1; }
      else             { lerp3(radDir, rd, k); }
    }
  }

  var aPerpMag = Math.sqrt(aPerpSq);
  var den2     = plateW4 + plateAlphaSq;
  var denom    = Math.sqrt(den2);

  radiusLive = (den2 > EPS) ? Math.sqrt(aPerpSq / den2) : 0.0;

  // Three conditions, not one. The denominator gate says "there is enough
  // motion to divide by"; the acceleration floor says "and there is a real
  // signal to divide"; the glitch flag says "and this frame's data is
  // physical". Requiring all three rejects the transient after an abrupt stop,
  // where the smoothed rate is still coasting down but the acceleration has
  // already gone — that window would otherwise latch a spurious radius.
  if (!glitch && denom >= holdThresh && aPerpMag >= minAccel) {
    // Snap on first ever reading, and snap on reacquisition after a hold —
    // because the obvious way to reposition the cube is to stop the plate, slide
    // it, and spin again, so a long gap is exactly when the value SHOULD jump.
    // Only slew-limit while continuously tracking, where a jump means a
    // transient rather than a move.
    if (!haveRadius || holdTime > reacquireSec) {
      radius = radiusLive;
    } else {
      var step = maxSlew * dt;
      var d    = radiusLive - radius;
      if (d >  step) d =  step;
      if (d < -step) d = -step;
      radius += d;
    }
    haveRadius  = 1;
    radiusValid = 1;
    holdTime    = 0.0;

    // --- Cube angle relative to the radius. Same gate as the radius, because it
    // comes from the same acceleration vector and is unobservable for the same
    // reason when the plate is still — so it freezes rather than wandering.
    //
    // Build a right-handed in-plane basis from the cube's reference axis, then
    // read off where the outward radial sits in it. Positive is anticlockwise
    // viewed from above.
    if (haveRadDir) {
      var ref  = referenceAxis(upBody);
      var refD = vdot(ref, upBody);
      var e1   = vnorm([
        ref[0] - refD * upBody[0],
        ref[1] - refD * upBody[1],
        ref[2] - refD * upBody[2]
      ]);
      if (vlen(e1) > 0.5) {                       // degenerate only if ref ∥ up
        var e2 = vcross(upBody, e1);
        cubeAngle = Math.atan2(vdot(radDir, e2), vdot(radDir, e1)) * DEG;
      }
    }
  } else {
    radiusValid = 0;                              // hold the previous `radius`
    holdTime   += dt;
  }

  // --- Face, with debounce so a knock does not flicker the index.
  var cand = classifyFace(upBody);
  if (cand === faceCand) {
    if (faceCount < FACE_DEBOUNCE) faceCount++;
    if (faceCount >= FACE_DEBOUNCE && cand !== faceIndex) faceIndex = cand;
  } else {
    faceCand  = cand;
    faceCount = 1;
  }

  prevTs = ts;
  prevQ  = q;

  emit();
  _monitorTick(ts * 1e-6);
}

function emit() {
  var rNorm = (plateRadius > EPS) ? (radius / plateRadius) : 0.0;
  if (rNorm < 0) rNorm = 0;
  if (rNorm > 1) rNorm = 1;

  outlet(8, radiusValid);
  outlet(7, wrap360(cubeAngle - angleOffset));
  outlet(5, faceIndex);
  outlet(4, rNorm);
  outlet(3, radius);
  outlet(2, plateRate * DEG);
  outlet(1, angleUnwrap * DEG);
  outlet(0, wrap360(angleUnwrap * DEG));
}

function _dump() {
  outlet(6, [
    "rate_dps",    plateRate * DEG,
    "alpha_dps2",  plateAlpha * DEG,
    "radius_m",    radius,
    "radius_live", radiusLive,
    "valid",       radiusValid,
    "face",        faceIndex,
    "up_x",        upBody[0],
    "up_y",        upBody[1],
    "up_z",        upBody[2],
    "revs",        angleUnwrap / (2 * Math.PI),
    "hold_s",      holdTime,
    "a_perp",      Math.sqrt(aPerpSq),
    "denom",       Math.sqrt(plateW4 + plateAlphaSq),
    "min_accel",   minAccel,
    "hold_thresh", holdThresh,
    "cube_angle",  wrap360(cubeAngle - angleOffset),
    "rad_x",       radDir[0],
    "rad_y",       radDir[1],
    "rad_z",       radDir[2],
    "msgs_L",      countL,
    "msgs_I",      countI,
    "have_gyro",   haveGyro,
    "using_gyro",  usingGyro,
    "gyro_age_s",  gyroAge,
    "rate_gyro_dps", rateGyro * DEG,
    "rate_quat_dps", rateQuat * DEG,
    "ignored",     ignoredTotal
  ]);
}

// Why is the gyro / radius / angle not working? Answer it in words rather than
// making the numbers above be interpreted by hand.
function diagnose() {
  post("── plate-analysis diagnosis ──\n");
  post("  messages: L=" + countL + "  I=" + countI + "  ignored=" + ignoredTotal + "\n");

  var sels = [];
  for (var s in ignored) { if (ignored.hasOwnProperty(s)) sels.push(s + "x" + ignored[s]); }
  if (sels.length) post("  ignored selectors: " + sels.join(" ") + "\n");

  if (countL === 0) {
    post("  PROBLEM: no Linear acceleration (L) messages at all. Nothing can work.\n");
    post("    Check inlet 0, and that AHRS/Linear acceleration messages are enabled.\n");
    return;
  }

  // --- gyro
  if (countI === 0) {
    post("  GYRO OFF: no Inertial (I) messages have arrived.\n");
    if (ignoredTotal > 0) {
      post("    Other selectors ARE arriving, so the stream is connected but the\n");
      post("    device is not sending I. Enable Inertial messages in the x-IMU3\n");
      post("    settings (and check 'inertial message rate divisor' is not 0).\n");
    } else {
      post("    Nothing is reaching inlet 1 either. If you split with [route L I],\n");
      post("    wire its 2nd outlet to inlet 1; or send the whole mixed stream to\n");
      post("    inlet 0 and it will sort L and I out itself.\n");
    }
  } else if (!usingGyro) {
    post("  GYRO STALE: I messages arrive (" + countI + ") but the last one was " +
         gyroAge.toFixed(3) + "s older than the L message (limit " + gyroMaxAge + "s).\n");
    post("    Either L and I run at very different rates, or their timestamps are\n");
    post("    not from the same clock. Try: gyromaxage " + (gyroAge * 2).toFixed(2) + "\n");
  } else {
    post("  gyro OK (age " + gyroAge.toFixed(4) + "s)\n");
  }

  // --- rate cross-check
  post("  rate: gyro " + (rateGyro * DEG).toFixed(2) + " deg/s, quaternion " +
       (rateQuat * DEG).toFixed(2) + " deg/s\n");
  var mag = Math.max(Math.abs(rateGyro), Math.abs(rateQuat));
  if (mag > 1.0 && Math.abs(rateGyro - rateQuat) > 0.35 * mag) {
    var ratio = Math.abs(rateQuat) > EPS ? Math.abs(rateGyro / rateQuat) : 0;
    post("  PROBLEM: those disagree (ratio " + ratio.toFixed(3) + "). A ratio near\n");
    post("    0.0175 means the gyro is already in rad/s upstream; near 57 means it\n");
    post("    got converted twice. The radius error goes as the SQUARE of this.\n");
  }

  // --- radius
  var aP = Math.sqrt(aPerpSq);
  var dn = Math.sqrt(plateW4 + plateAlphaSq);
  post("  |a_perp| = " + aP.toFixed(4) + " m/s^2 (gate needs >= " + minAccel + ")\n");
  post("  denom    = " + dn.toFixed(4) + " (gate needs >= " + holdThresh + ")\n");
  // The signal is r*w^2, so there is a hard minimum spin rate below which the
  // measurement is not merely gated out but genuinely not there. Spell it out in
  // rev/s rather than leaving it as an inequality to solve by hand.
  var rRef = (haveRadius && radius > 0.01) ? radius : plateRadius;
  var minRevs = Math.sqrt(minAccel / rRef) / (2 * Math.PI);
  post("  at r=" + rRef.toFixed(3) + "m you must spin at least " +
       minRevs.toFixed(2) + " rev/s (" + (minRevs * 60).toFixed(0) +
       " rpm) to clear minaccel\n");

  if (!haveRadius) {
    post("  PROBLEM: the radius has NEVER been measured, so it is still 0.\n");
    post("    Spin faster than the rate above, or lower minaccel — but note that\n");
    post("    below ~0.25 m/s^2 a 1-2 degree tilt of the plate leaks enough gravity\n");
    post("    to counterfeit the whole signal, so a lower gate buys noise not range.\n");
  } else if (!radiusValid) {
    post("  radius is HOLDING at " + radius.toFixed(4) + " m (held " +
         holdTime.toFixed(2) + "s). This is normal when the plate is slow/stopped.\n");
  } else {
    post("  radius LIVE: " + radius.toFixed(4) + " m\n");
  }

  // --- sanity check against the physics
  if (radiusValid && Math.abs(plateRate) > 0.5) {
    var expect = aP / (plateRate * plateRate);
    post("  sanity: |a_perp|/w^2 = " + expect.toFixed(4) + " m — should match the\n");
    post("    radius above, and should be a plausible distance on your plate.\n");
    post("    If it is ~9.8x too big, the accel is already in m/s^2 upstream.\n");
  }

  post("  cube angle: " + wrap360(cubeAngle - angleOffset).toFixed(2) +
       " deg (" + (haveRadDir ? "acquired" : "NOT yet acquired") + ")\n");
  post("  face: " + faceIndex + "   up in sensor coords: " +
       upBody[0].toFixed(3) + " " + upBody[1].toFixed(3) + " " + upBody[2].toFixed(3) + "\n");
}

// Periodic version of the above numbers, for watching while you spin the plate.
function _monitorTick(tSec) {
  if (monitorHz <= 0) return;
  if (tSec - monitorLast < 1.0 / monitorHz) return;
  monitorLast = tSec;
  post("[plate] rate " + (plateRate * DEG).toFixed(1) + " dps  |aP| " +
       Math.sqrt(aPerpSq).toFixed(3) + "  denom " +
       Math.sqrt(plateW4 + plateAlphaSq).toFixed(3) + "  r " + radius.toFixed(4) +
       "  live " + radiusLive.toFixed(4) + "  valid " + radiusValid +
       "  ang " + wrap360(cubeAngle - angleOffset).toFixed(1) +
       "  face " + faceIndex + "  gyro " + usingGyro + "\n");
}

// ── Messages ────────────────────────────────────────────────────────────────

function zero() {
  angleUnwrap = 0.0;
  if (verbose) post("plate-analysis: angle zeroed\n");
  emit();
}

function plateradius(v) {
  if (typeof v === "number" && v > 0) plateRadius = v;
  if (verbose) post("plate-analysis: plateradius = " + plateRadius + " m\n");
}

function tau(v) {
  if (typeof v === "number" && v >= 0) tauMs = v;
  if (verbose) post("plate-analysis: tau = " + tauMs + " ms\n");
}

function holdthresh(v) {
  if (typeof v === "number" && v >= 0) holdThresh = v;
  if (verbose) post("plate-analysis: holdthresh = " + holdThresh + "\n");
}

function learn(idx) {
  if (typeof idx !== "number" || idx < 1) {
    error("plate-analysis: learn needs a face index >= 1\n");
    return;
  }
  var i = Math.round(idx);
  templates[i] = [upBody[0], upBody[1], upBody[2]];
  post("plate-analysis: learned face " + i + " → up = " +
       upBody[0].toFixed(4) + " " + upBody[1].toFixed(4) + " " + upBody[2].toFixed(4) + "\n");
  // Warn if this pose is hard to tell apart from one already stored.
  for (var k in templates) {
    if (!templates.hasOwnProperty(k)) continue;
    if (parseInt(k, 10) === i) continue;
    var d = vdot(vnorm(templates[k]), upBody);
    if (d > FACE_MIN_DOT) {
      post("plate-analysis: WARNING face " + i + " is only " +
           (Math.acos(Math.min(1, d)) * DEG).toFixed(1) +
           "° from face " + k + " — they will be confused\n");
    }
  }
}

function forget(idx) {
  var i = Math.round(idx);
  if (templates.hasOwnProperty(i)) {
    delete templates[i];
    post("plate-analysis: forgot face " + i + "\n");
  }
}

function clearfaces() {
  templates = {};
  faceIndex = 0; faceCand = 0; faceCount = 0;
  post("plate-analysis: templates cleared, using 6 axis-aligned defaults\n");
}

function dumpfaces() {
  var set = activeTemplates();
  var learned = (set === templates);
  post("plate-analysis: " + (learned ? "learned" : "default") + " templates:\n");
  for (var k in set) {
    if (!set.hasOwnProperty(k)) continue;
    var v = vnorm(set[k]);
    post("  " + k + ": " + v[0].toFixed(4) + " " + v[1].toFixed(4) + " " + v[2].toFixed(4) + "\n");
  }
}

function dump() {
  _dump();
}

function minaccel(v) {
  if (typeof v === "number" && v >= 0) minAccel = v;
  if (verbose) post("plate-analysis: minaccel = " + minAccel + " m/s^2\n");
}

function maxalpha(v) {
  if (typeof v === "number" && v > 0) maxAlpha = v;
  if (verbose) post("plate-analysis: maxalpha = " + maxAlpha + " rad/s^2\n");
}

function maxslew(v) {
  if (typeof v === "number" && v >= 0) maxSlew = v;
  if (verbose) post("plate-analysis: maxslew = " + maxSlew + " m/s\n");
}

function reacquire(v) {
  if (typeof v === "number" && v >= 0) reacquireSec = v;
  if (verbose) post("plate-analysis: reacquire = " + reacquireSec + " s\n");
}

function gyromaxage(v) {
  if (typeof v === "number" && v > 0) gyroMaxAge = v;
  post("plate-analysis: gyromaxage = " + gyroMaxAge + " s\n");
}

function monitor(v) {
  monitorHz = (typeof v === "number" && v > 0) ? v : 0;
  post("plate-analysis: monitor " + (monitorHz ? monitorHz + " Hz" : "off") + "\n");
}

function refaxis(v) {
  var s = String(v).toLowerCase();
  if (s === "auto" || s === "x" || s === "y" || s === "z") {
    refAxisMode = s;
    post("plate-analysis: refaxis = " + s + "\n");
  } else {
    error("plate-analysis: refaxis expects auto, x, y or z\n");
  }
}

// Define "zero" empirically: point the cube however you want to call 0 degrees,
// spin the plate, send zeroangle. Easier than reasoning about which sensor axis
// the reference basis picked.
function zeroangle() {
  angleOffset = cubeAngle;
  post("plate-analysis: cube angle zeroed (offset " + angleOffset.toFixed(2) + " deg)\n");
  emit();
}

// Named `setverbose` rather than `verbose` so the message handler does not
// shadow the state variable of the same name.
function setverbose(v) { verbose = v ? 1 : 0; }

function bang() {
  emit();
  _dump();
}
