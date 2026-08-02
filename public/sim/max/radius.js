// radius.js — x-imu3 magnetometer → lazy-susan radial position
//
//   [route L I M] --M--> [js radius.js] <-- Q (right inlet)
//
// A neodymium magnet lies flat at the centre of the lazy susan, so its dipole
// axis is vertical. The sensor rides out in the magnet's equatorial plane where
// the field points straight down. Field falls off as 1/r^3, giving an absolute
// radial position that is drift-free and independent of susan rotation speed.
//
// WHY WORLD FRAME
// Reading a raw sensor axis works only while the sensor holds one orientation.
// Any tilt — an uneven table, an imperfect 180 degree flip — rotates the axis
// slightly, mixing in the Earth's HORIZONTAL component (~17uT here). That term
// depends on which way the sensor points in the room, so it changes both when
// you flip the sensor and as the susan turns. Rotating the magnetometer vector
// into world coordinates first removes all of it: in world coordinates the
// magnet's field points down and the Earth's vertical component is a constant,
// no matter how the sensor is held.
//
// WHY NO BASELINE SUBTRACTION
// Subtracting the Earth's field would make the slider perfectly linear, but the
// subtraction happens before the abs(), so if the subtracted value lands inside
// the signal's range the result crosses zero, the abs() mirrors it, and the
// radius runs 0 -> 1 -> 0. Not worth it: the rim/inner normalisation absorbs a
// constant offset anyway. The Earth reference is captured for DIAGNOSTICS only
// (see `earth`) and never enters the math.
//
// THE ONE THING THAT CAN STILL FOLD
// If the magnet's field OPPOSES the Earth's there is a radius where they cancel
// and the reading dips through zero. Turn the magnet over so they add. `range`
// checks for this and outlet 2 reports it live.
//
// INLET 0   mag list "x y z" or "ts x y z"
// INLET 1   quaternion "x y z w" — tap AFTER [zl.indexmap 1 2 3 0]
//
// OUTLET 0  radius, smoothed, 1.0 = rim, 0.0 = inner
//        1  field magnitude in use
//        2  status: ok | crossing | weak | noquat
//        3  raw x y z
//
// SETUP     connect M and Q, click checkq and wiggle, then rim and inner
//
// MESSAGES
//   checkq         carry the sensor AWAY from the magnet, then tumble it in
//                  your hand for ~10s. Works out the quaternion convention.
//   rim / inner    capture the two endpoints
//   earth          OPTIONAL: magnet far away, captures the Earth-only level so
//                  the status outlet can warn when you slide out of usable range
//   world <0|1>    default 1; 0 falls back to a raw sensor axis
//   axis <x|y|z>   sensor-frame axis, only used when world is 0
//   smooth <0..1>  default 0.25, lower is smoother
//   range          post field range and check for a zero crossing
//   dump           post current settings
//   reset          start over

autowatch = 1;
inlets = 2;
outlets = 4;

setinletassist(0, "mag list: x y z (or ts x y z)");
setinletassist(1, "quaternion x y z w — after [zl.indexmap 1 2 3 0]");
setoutletassist(0, "radius 0..1");
setoutletassist(1, "field magnitude");
setoutletassist(2, "status");
setoutletassist(3, "raw x y z");

var FALLOFF = 3.0;          // dipole 1/r^3
var CHECK_N = 400;          // samples collected by `checkq`

// The magnetometer is a separate chip and may sit rotated relative to the
// gyro/accel body frame the AHRS quaternion refers to. If so, rotating the mag
// vector by that quaternion gives nonsense — which presents as "flipping the
// sensor breaks it". `checkq` searches every axis permutation and sign, so the
// mapping is measured rather than assumed.
var magPerm = [0, 1, 2];
var magSign = [1, 1, 1];

var vRim = 1.0, vInner = 0.0;
var smoothing = 0.25;
var worldMode = 1;
var useAxis = "z";
var qConj = 0;
var earthLevel = 0;         // diagnostic only, never subtracted

var quat = null;
var lastRaw = [0, 0, 0];
var lastB = 0.0;
var loS = 0.0, hiS = 0.0;
var minB = 0.0, maxB = 0.0;
var seen = false, primed = false;
var out = 0.0;
var warned = 0;

// checkq sample buffer — mag vector + quaternion per sample
var checking = 0, cN = 0;
var cMag = [], cQuat = [];

// ---- helpers -------------------------------------------------------------
// v' = v + 2*qw*(qv x v) + 2*(qv x (qv x v))
function toWorld(v, q, conj) {
    var qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    if (conj) { qx = -qx; qy = -qy; qz = -qz; }
    var tx = 2 * (qy * v[2] - qz * v[1]);
    var ty = 2 * (qz * v[0] - qx * v[2]);
    var tz = 2 * (qx * v[1] - qy * v[0]);
    return [v[0] + qw * tx + (qy * tz - qz * ty),
            v[1] + qw * ty + (qz * tx - qx * tz),
            v[2] + qw * tz + (qx * ty - qy * tx)];
}

function sensorComponent(v) {
    if (useAxis === "x") return v[0];
    if (useAxis === "y") return v[1];
    return v[2];
}

function radialValue(B) { return Math.pow(B > 0 ? B : 1e-9, -1.0 / FALLOFF); }

function applyPerm(v, perm, sign) {
    return [sign[0] * v[perm[0]], sign[1] * v[perm[1]], sign[2] * v[perm[2]]];
}

// In world coordinates the magnet's field is vertical, so world Z is always the
// right component — there is no axis to choose.
function signedField() {
    if (worldMode && quat)
        return toWorld(applyPerm(lastRaw, magPerm, magSign), quat, qConj)[2];
    return sensorComponent(lastRaw);
}

// ---- main ----------------------------------------------------------------
function list() {
    var a = arrayfromargs(arguments);

    if (inlet === 1) {                        // quaternion x y z w
        if (a.length >= 4) quat = a.slice(a.length - 4);
        return;
    }

    var x, y, z;
    if (a.length >= 4)       { x = a[a.length-3]; y = a[a.length-2]; z = a[a.length-1]; }
    else if (a.length === 3) { x = a[0]; y = a[1]; z = a[2]; }
    else return;
    lastRaw = [x, y, z];

    if (checking) { collect(); return; }

    var s = signedField();
    var B = Math.abs(s);
    lastB = B;

    if (!seen) { loS = hiS = s; minB = maxB = B; seen = true; }
    else {
        if (s < loS) loS = s;   if (s > hiS) hiS = s;
        if (B < minB) minB = B; if (B > maxB) maxB = B;
    }

    var crossing = (loS < 0 && hiS > 0);
    if (crossing && !warned) {
        warned = 1;
        post("radius: WARNING — field crosses zero (" + loS.toFixed(1) + " .. " +
             hiS.toFixed(1) + "). Turn the MAGNET over, then reset and recapture.\n");
    }

    var span = vRim - vInner;
    if (Math.abs(span) < 1e-12) span = 1e-12;
    var r = (radialValue(B) - vInner) / span;
    if (r < 0) r = 0; else if (r > 1) r = 1;

    if (!primed) { out = r; primed = true; }
    else { out = out + smoothing * (r - out); }

    var st = "ok";
    if (worldMode && !quat) st = "noquat";
    else if (crossing) st = "crossing";
    // Past the point where the magnet stops dominating, the reading settles onto
    // the Earth's field and stops tracking radius. Only checked if `earth` was run.
    else if (earthLevel > 0 && B < earthLevel * 1.5) st = "weak";

    outlet(3, lastRaw);
    outlet(2, st);
    outlet(1, B);
    outlet(0, out);
}

function msg_float(v) { list(v); }

// ---- quaternion convention, determined rather than guessed ----------------
// There are two conventions for which way a quaternion rotates, and picking the
// wrong one makes things worse instead of better. Rather than have you guess:
// the TRUE world Z is constant however the sensor is turned, so whichever
// convention gives lower variance under rotation is the right one.
//
// Do this AWAY from the magnet. The Earth's field is uniform across the room,
// so with the magnet out of range it doesn't matter where you carry the sensor
// or how far — only its orientation changes anything. Near the magnet the field
// changes steeply with distance, which would pollute the comparison.
function checkq() {
    if (!quat) { post("radius: no quaternion — connect Q to the right inlet\n"); return; }
    checking = 1; cN = 0; cMag = []; cQuat = [];
    post("radius: carry the sensor AWAY from the magnet, then tumble it in your hand...\n");
    post("   (position doesn't matter — only that you keep changing its orientation)\n");
}

function collect() {
    cMag.push([lastRaw[0], lastRaw[1], lastRaw[2]]);
    cQuat.push([quat[0], quat[1], quat[2], quat[3]]);
    cN++;
    if (cN < CHECK_N) return;
    checking = 0;
    solve();
}

// The true field is a fixed vector in world coordinates, so under the correct
// mapping the rotated vector barely moves however the sensor is turned. Score
// every candidate by how much the world vector wanders, as a fraction of its
// own size, and keep the steadiest.
var PERMS = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
// Third sign pinned to +1: negating the whole vector gives an identical result
// once we take abs(), so each mapping and its negative are the same answer.
// Keeping one of each pair halves the search and removes an exact tie that
// would otherwise always sit in second place and mask a real ambiguity.
var SIGNS = [[1,1,1],[1,-1,1],[-1,1,1],[-1,-1,1]];

function scoreOf(perm, sign, conj) {
    var s = [0,0,0], ss = [0,0,0], i, k, w;
    for (i = 0; i < cN; i++) {
        w = toWorld(applyPerm(cMag[i], perm, sign), cQuat[i], conj);
        for (k = 0; k < 3; k++) { s[k] += w[k]; ss[k] += w[k] * w[k]; }
    }
    var totVar = 0, mag2 = 0, mean;
    for (k = 0; k < 3; k++) {
        mean = s[k] / cN;
        totVar += Math.max(0, ss[k] / cN - mean * mean);
        mag2 += mean * mean;
    }
    // wander relative to field size — dimensionless, so units don't matter
    return Math.sqrt(totVar) / (Math.sqrt(mag2) + 1e-9);
}

function solve() {
    var best = null, second = null, p, sg, c, sc;
    for (p = 0; p < PERMS.length; p++)
      for (sg = 0; sg < SIGNS.length; sg++)
        for (c = 0; c < 2; c++) {
            sc = scoreOf(PERMS[p], SIGNS[sg], c);
            if (!best || sc < best.sc) { second = best; best = {sc:sc, p:p, sg:sg, c:c}; }
            else if (!second || sc < second.sc) second = {sc:sc, p:p, sg:sg, c:c};
        }

    magPerm = PERMS[best.p]; magSign = SIGNS[best.sg]; qConj = best.c;
    vRim = 1.0; vInner = 0.0; primed = false;
    cMag = []; cQuat = [];

    var names = ["x","y","z"];
    var map = "";
    for (var k = 0; k < 3; k++)
        map += (magSign[k] < 0 ? "-" : "+") + names[magPerm[k]] + (k < 2 ? " " : "");

    post("radius: checkq searched 48 mappings over " + cN + " samples\n");
    post("   best  : mag [" + map + "]  conj " + (qConj ? "ON" : "OFF") +
         "   wander " + (best.sc * 100).toFixed(1) + "%\n");
    post("   next  : wander " + (second.sc * 100).toFixed(1) + "%\n");

    if (best.sc > 0.25)
        post("   BAD — nothing fits. Was the sensor near the magnet, or barely moved?\n");
    else if (second.sc < best.sc * 1.5)
        post("   WEAK — top two are close. Tumble through more angles and rerun.\n");
    else
        post("   good separation. Now capture rim and inner.\n");
}

// ---- endpoints -----------------------------------------------------------
function rim() {
    if (!seen) { post("radius: no mag data yet\n"); return; }
    vRim = radialValue(lastB);
    post("radius: rim captured   field=" + lastB.toFixed(3) + "\n");
}

function inner() {
    if (!seen) { post("radius: no mag data yet\n"); return; }
    vInner = radialValue(lastB);
    post("radius: inner captured field=" + lastB.toFixed(3) + "\n");
}

// Diagnostic only — never subtracted, so it cannot cause the fold.
function earth() {
    if (!seen) { post("radius: no mag data yet\n"); return; }
    earthLevel = lastB;
    post("radius: Earth level = " + earthLevel.toFixed(3) +
         "  (status reads 'weak' below " + (earthLevel * 1.5).toFixed(3) + ")\n");
}

// ---- settings ------------------------------------------------------------
function clearEnds(why) {
    vRim = 1.0; vInner = 0.0; primed = false; warned = 0;
    loS = hiS = minB = maxB = 0; seen = false;
    post("radius: " + why + " — endpoints cleared, recapture rim and inner\n");
}

function world(v) {
    worldMode = (v === undefined) ? 1 : (v ? 1 : 0);
    if (worldMode && !quat) post("radius: no quaternion yet — connect Q to the right inlet\n");
    clearEnds("world " + (worldMode ? "ON" : "OFF"));
}

function axis(which) {
    which = String(which).toLowerCase();
    if (which !== "x" && which !== "y" && which !== "z") {
        post("radius: axis must be x, y or z\n"); return;
    }
    useAxis = which;
    if (worldMode) post("radius: note — axis is ignored while world mode is on\n");
    clearEnds("axis " + useAxis);
}

function smooth(v) {
    if (v === undefined) return;
    smoothing = Math.max(0.001, Math.min(1.0, v));
}

function reset() {
    worldMode = 1; useAxis = "z"; qConj = 0; earthLevel = 0;
    smoothing = 0.25; out = 0; checking = 0;
    clearEnds("reset");
}

// ---- diagnostics ---------------------------------------------------------
function dump() {
    post("---- radius.js ----\n");
    post("mode      : " + (worldMode ? "world frame (Z)" : "sensor axis " + useAxis) + "\n");
    post("quaternion: " + (quat ? "ok" : "MISSING") + "   conj " + (qConj ? "ON" : "OFF") + "\n");
    post("endpoints : rim " + vRim.toFixed(5) + "   inner " + vInner.toFixed(5) + "\n");
    post("earth ref : " + (earthLevel > 0 ? earthLevel.toFixed(3) : "not captured") + "\n");
    post("smoothing : " + smoothing + "\n");
    post("raw x y z : " + lastRaw[0] + "  " + lastRaw[1] + "  " + lastRaw[2] + "\n");
    post("field now : " + lastB.toFixed(3) + "\n");
}

function range() {
    if (!seen) { post("radius: no mag data yet\n"); return; }
    post("radius: signed " + loS.toFixed(2) + " .. " + hiS.toFixed(2) +
         "    magnitude " + minB.toFixed(2) + " .. " + maxB.toFixed(2) + "\n");
    if (loS < 0 && hiS > 0) post("   CROSSES ZERO — turn the magnet over, then reset\n");
    else post("   stays one side of zero — good\n");
    if (earthLevel > 0)
        post("   Earth level " + earthLevel.toFixed(2) + " — keep the rim above " +
             (earthLevel * 1.5).toFixed(2) + " or the outer end goes dead\n");
}

// ---- persistence ---------------------------------------------------------
function setcal(a, b, c, d, e, f) {
    vRim = a; vInner = b;
    if (c !== undefined) worldMode = c;
    if (d !== undefined) qConj = d;
    if (e !== undefined) useAxis = e;
    if (f !== undefined) earthLevel = f;
}

function save() {
    embedmessage("setcal", vRim, vInner, worldMode, qConj, useAxis, earthLevel);
}
