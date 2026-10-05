#!/usr/bin/env node
// ============================================================================
// sensor-audit.js — the two-sided sensor calibration, proved with maths
//
//   output = conj(H) · q · conj(B)
//
// B (mount) is BODY-side and absorbs ANY mounting rotation — hand, rotated
// wrist, head, a sensor worn vertically on a back. H (heading) is WORLD-side
// and constrained to true vertical, which is what makes it COMMUTE with a
// performer turning on the spot.
//
// § G is the section that earns its keep. The first build put the mount on the
// left, which quietly makes the output frame the DEVICE's rest frame — level
// mounts work because device-up and world-up coincide there, and a sensor worn
// vertically reads a turn as pitch. It shipped past a § A that asserted
// conj(q)·q = I, which is true of any q and therefore proved nothing. A test
// that cannot fail is worse than no test: it buys confidence it has not earned.
//
// Every section is a bug that actually happened on 2026-08-31:
//   A  a 45° heading offset smeared ONE tilt across pitch AND roll (64°/54°)
//   B  a mount held upside down parked roll on the ±180° wrap
//   C  the Euler-space tare could not fix either, by construction
//   D  _initOscSlot() wiped the calibration on the first packet after reload
// and one from 2026-09-10:
//   B2 a heading zero taken with the board rolled AND pitched left the cursor
//      off lon 0 — by 0.9° at 10°/10°, by 69° at the rig's uncalibrated
//      near-inverted mount — because H was the swing-twist, not the yaw read
// ============================================================================

// The APP'S functions — not a copy. Until 2026-09-27 this file re-typed them
// "to match sensor-registry.js exactly", which is a promise, not a test: a
// copy can pass while the app is wrong. sensor-math.js is pure so it can be
// imported here.
import {
  qMul, qConj, twistAboutZ, headingAboutZ, applyCal, mountFromPoses, MOUNT_POSE_MIN_DEG,
  quatToEulerDeg, DEFAULT_SIGNS, attitude, orientation, panTilt, inFrame,
} from '../js/sensor-math.js';

// ── test-only helpers ───────────────────────────────────────────────────────
const axisAngle = (x, y, z, deg) => {
  const n = Math.hypot(x, y, z) || 1, h = (deg * Math.PI / 180) / 2, s = Math.sin(h);
  return [x/n*s, y/n*s, z/n*s, Math.cos(h)];
};
// the calibration gesture: neutral, then pointing down 60°
const captureMount = (rest) => mountFromPoses(rest, qMul(rest, qMul(qConj(rest),
  qMul(qMul(twistAboutZ(rest), axisAngle(0,1,0,-60)), qMul(qConj(twistAboutZ(rest)), rest)))));
// sensor-registry's captureHeading, on a bare cal instead of a slot
const captureHeading = (q, cal) => {
  const turned = cal.mountQuat ? qMul(q, qConj(cal.mountQuat)) : q;
  return { ...cal, headingQuat: headingAboutZ(turned) };
};
const toEuler = (x, y, z, w) => { const e = quatToEulerDeg(x, y, z, w); return { roll: e.x, pitch: e.y, yaw: e.z }; };
const angBetween = (a, b) => {
  const d = Math.abs(a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]);
  return 2 * Math.acos(Math.min(1, d)) * 180/Math.PI;
};
const IDENT = [0, 0, 0, 1];

// deterministic PRNG so a failure is reproducible from its seed
let _seed = 20260831;
const rnd = () => ((_seed = (_seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const randomQuat = () => {
  const u1 = rnd(), u2 = rnd(), u3 = rnd();
  const s1 = Math.sqrt(1-u1), s2 = Math.sqrt(u1);
  return [s1*Math.sin(2*Math.PI*u2), s1*Math.cos(2*Math.PI*u2),
          s2*Math.sin(2*Math.PI*u3), s2*Math.cos(2*Math.PI*u3)];
};

let pass = 0, fail = 0;
const ok = (name, detail) => { pass++; console.log(`  ok   ${name}  — ${detail}`); };
const bad = (name, detail) => { fail++; console.log(`  FAIL ${name}  — ${detail}`); };
const check = (cond, name, detail) => (cond ? ok : bad)(name, detail);
const section = (t) => console.log(`\n── ${t} ──`);

// ── A. mount calibration works from ANY orientation ────────────────────────
// The dancer-on-the-head / sensor-on-a-tuba claim. If this holds for 200
// uniformly random mountings it holds for every strap anyone will devise.
section('A. mount calibration, any mounting angle');
{
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const q = randomQuat();
    const out = applyCal(q, captureMount(q));
    worst = Math.max(worst, angBetween(out, IDENT));
  }
  check(worst < 1e-4, 'calibrating at the reference pose yields identity',
        `200 random mountings, worst ${worst.toExponential(1)}°`);
}
{
  // The calibration must TRACK, not merely zero. The move is expressed in the
  // PERFORMER's frame — between heading and mount — because that is what a
  // body does: the sensor is along for the ride. Modelling it in the sensor's
  // own frame instead is what produced a false 88% failure and talked this
  // design out of the correct shape once already.
  let worst = 0;
  for (let i = 0; i < 100; i++) {
    const mount = randomQuat();
    const cal = captureMount(mount);
    const move = axisAngle(rnd()-0.5, rnd()-0.5, rnd()-0.5, 10 + rnd()*100);
    const q = qMul(cal.headingQuat, qMul(move, cal.mountQuat));
    worst = Math.max(worst, angBetween(applyCal(q, cal), move));
  }
  check(worst < 1e-4, 'a performer-frame move reads back as that exact rotation',
        `100 trials, worst error ${worst.toExponential(1)}°`);
}

// ── B. heading zero cannot move pitch or roll ──────────────────────────────
// The reason H is on the LEFT and B on the right. This is the invariant that
// makes "zero heading" safe to bind to a key you hit mid-set.
section('B. heading zero leaves pitch and roll alone');
{
  let worstP = 0, worstR = 0;
  for (let i = 0; i < 200; i++) {
    const mount = randomQuat();
    let cal = captureMount(mount);
    // The performer turns on the spot (world Z) and holds some attitude in
    // their OWN frame — between heading and mount, which is where a body's
    // rotation actually sits.
    const turn = axisAngle(0, 0, 1, (rnd()-0.5) * 300);
    const held = axisAngle(rnd()-0.5, rnd()-0.5, 0, (rnd()-0.5) * 60);
    const neutral = qMul(turn, qMul(cal.headingQuat, cal.mountQuat));
    const q = qMul(turn, qMul(cal.headingQuat, qMul(held, cal.mountQuat)));
    cal = captureHeading(neutral, cal);             // zeroed at the neutral pose
    const after = toEuler(...applyCal(q, cal));
    const want  = toEuler(...held);
    worstP = Math.max(worstP, Math.abs(after.pitch - want.pitch));
    worstR = Math.max(worstR, Math.abs(after.roll  - want.roll));
  }
  check(worstP < 1e-4, 'after a heading zero, pitch reads the attitude actually held', `worst ${worstP.toExponential(1)}°`);
  check(worstR < 1e-4, 'after a heading zero, roll reads the attitude actually held',  `worst ${worstR.toExponential(1)}°`);
}
{
  // and it must actually DO its job
  let worst = 0;
  for (let i = 0; i < 100; i++) {
    const mount = randomQuat();
    let cal = captureMount(mount);
    const q = qMul(axisAngle(0, 0, 1, (rnd()-0.5)*300), mount);
    cal = captureHeading(q, cal);
    worst = Math.max(worst, angBetween(applyCal(q, cal), IDENT));
    void 0;
  }
  check(worst < 1e-4, 'heading zero returns the neutral pose to identity', `worst residual ${worst.toExponential(1)}°`);
}

// ── B2. heading zero lands at lon 0 from ANY attitude ──────────────────────
// The 2026-09-10 case. A zero is pressed with the board held however the
// hand holds it — pitched, rolled, and on an uncalibrated mount rolled near
// 180°. The swing-twist H was exact only at a level pose: the remaining swing
// carries a yaw of its own once pitch and roll are both non-zero, and near a
// 180° roll the twist sits in two vanishing components (4° of pitch at zero
// time moved the residual by 72°). The invariant: the yaw the app reads is 0
// the instant after the press, and pitch and roll are the attitude held.
section('B2. heading zero lands at lon 0 from any attitude');
{
  const zyx = (yaw, pitch, roll) =>
    qMul(axisAngle(0,0,1,yaw), qMul(axisAngle(0,1,0,pitch), axisAngle(1,0,0,roll)));
  let worstY = 0, worstPR = 0;
  for (let i = 0; i < 300; i++) {
    const mount = randomQuat();
    let cal = captureMount(mount);
    const turn  = axisAngle(0, 0, 1, (rnd()-0.5) * 300);
    // every third case hugs the ±180° roll wrap, where the twist was degenerate
    const roll  = i % 3 === 0 ? 180 - (rnd()-0.5) * 10 : (rnd()-0.5) * 360;
    const held  = zyx(0, (rnd()-0.5) * 120, roll);
    const q = qMul(turn, qMul(cal.headingQuat, qMul(held, cal.mountQuat)));
    cal = captureHeading(q, cal);                   // zeroed AT the held pose
    const after = toEuler(...applyCal(q, cal));
    const want  = toEuler(...held);
    worstY  = Math.max(worstY,  Math.abs(after.yaw));
    worstPR = Math.max(worstPR, Math.abs(after.pitch - want.pitch),
                                Math.abs(((after.roll - want.roll + 540) % 360) - 180));
  }
  check(worstY  < 1e-4, 'the yaw read after a zero is 0, at every pitch and roll', `300 attitudes, worst ${worstY.toExponential(1)}°`);
  check(worstPR < 1e-4, 'and pitch and roll are the attitude held',                 `worst ${worstPR.toExponential(1)}°`);
}
{
  // the rig on 2026-09-10: no mount calibration, board read roll −175.7°,
  // pitch 3.0°. The twist-based zero left lon at −69.5°.
  const live = [-0.043212890625, 0.998046875, -0.03631591796875, 0.02764892578125];
  const cal = captureHeading(live, { mountQuat: null, headingQuat: null });
  const after = toEuler(...applyCal(live, cal));
  check(Math.abs(after.yaw) < 1e-2, 'the 2026-09-10 rig pose zeroes to lon 0 with no mount calibration',
        `yaw ${after.yaw.toFixed(4)}°, pitch ${after.pitch.toFixed(1)}°, roll ${after.roll.toFixed(1)}° (16-bit quantised quat)`);
}

// ── C. the bug that started this ───────────────────────────────────────────
// 45° heading offset, board inverted. One physical tilt produced 64° of pitch
// and 54° of yaw on the real rig. Uncalibrated it must still mix; calibrated
// it must land on one channel.
section('C. the 2026-08-31 rig case');
{
  // facing 45° off north, sensor flat and upside down — the pose the rig was
  // actually in. Uncalibrated, an inverted mount RESTS on the ±180° roll wrap,
  // where the ZYX decomposition flips between +179 and -179 on the smallest
  // movement. That is the provable half of what went wrong.
  const inverted = qMul(axisAngle(0, 0, 1, -45), axisAngle(1, 0, 0, 180));
  const rest = toEuler(...inverted);
  check(Math.abs(Math.abs(rest.roll) - 180) < 1e-6,
        'uncalibrated, an inverted mount sits exactly on the ±180° roll wrap',
        `rest roll ${rest.roll.toFixed(2)}° — the reported fault`);

  const cal = captureMount(inverted);
  const e0 = toEuler(...applyCal(inverted, cal));
  check(Math.abs(e0.roll) < 1e-4 && Math.abs(e0.pitch) < 1e-4 && Math.abs(e0.yaw) < 1e-4,
        'calibrated, it rests at the origin instead',
        `roll ${e0.roll.toFixed(6)}°  pitch ${e0.pitch.toFixed(6)}°`);

  // one clean pitch, in the performer's frame
  const q = qMul(cal.headingQuat, qMul(axisAngle(0, 1, 0, 40), cal.mountQuat));
  const e1 = toEuler(...applyCal(q, cal));
  const d = [Math.abs(e1.roll-e0.roll), Math.abs(e1.pitch-e0.pitch), Math.abs(e1.yaw-e0.yaw)]
    .map(v => (v > 180 ? 360 - v : v)).sort((a,b) => b-a);
  check(d[1]/d[0] < 0.02, 'calibrated, one tilt lands on one channel',
        `leak ${(d[1]/d[0]*100).toFixed(1)}%`);
}

// ── D. the degenerate twist ────────────────────────────────────────────────
// z and w both vanish at 180° about a horizontal axis — precisely the upside
// down case above. Must return identity, never NaN.
section('D. degenerate swing-twist');
{
  for (const [name, q] of [['180° about X', axisAngle(1,0,0,180)],
                           ['180° about Y', axisAngle(0,1,0,180)]]) {
    const t = twistAboutZ(q);
    check(t.every(Number.isFinite), `${name} yields a finite twist`, `[${t}]`);
    check(angBetween(t, IDENT) < 1e-9, `${name} yields identity, not a normalised zero`, 'guarded');
  }
  const cal = captureMount(axisAngle(1, 0, 0, 180));
  check(applyCal(axisAngle(1,0,0,180), cal).every(Number.isFinite),
        'a mount calibrated exactly upside down stays finite', 'no NaN downstream');
}

// ── E. order independence and idempotence ──────────────────────────────────
section('E. the two gestures compose');
{
  const mount = randomQuat();
  const a = captureMount(mount);
  const b = captureHeading(mount, a);
  check(angBetween(applyCal(mount, a), applyCal(mount, b)) < 1e-4,
        'heading zero right after a mount calibration is a no-op',
        'the mount already zeroed the heading');
  let cal = captureMount(mount);
  const once = applyCal(mount, cal);
  for (let i = 0; i < 5; i++) cal = captureHeading(mount, cal);
  check(angBetween(once, applyCal(mount, cal)) < 1e-4,
        'repeated heading zeroes are idempotent', '5 presses, no drift');
}

// ── F. persistence contract ────────────────────────────────────────────────
// D on the rig: getOrCreateSlot() primed a new slot from localStorage and
// _initOscSlot() nulled it on the very next line, so a calibration lasted
// exactly until the next reload. Guard the shape the migration depends on.
section('F. persisted schema');
{
  const mount = randomQuat();
  const cal = captureMount(mount);
  const round = JSON.parse(JSON.stringify({ mountQuat: cal.mountQuat, headingQuat: cal.headingQuat }));
  check(angBetween(applyCal(mount, round), IDENT) < 1e-4,
        'calibration survives a JSON round-trip', 'localStorage-safe');
}

// ── G. a turn is yaw at EVERY mounting angle ───────────────────────────────
// The bug a tautological § A let through. A performer turning on the spot is
// the motion the speakers are aimed by, so it must land on yaw whether the
// sensor is flat on a table, upside down, or worn vertically on a back.
// Left-multiplying the mount passes the flat cases and fails the vertical ones,
// which is exactly how it reached the rig.
section('G. a turn reads as yaw for any mounting');
{
  const mounts = [
    ['flat, USB down',       qMul(axisAngle(0,0,1,-45), axisAngle(1,0,0,180))],
    ['flat, level',          axisAngle(0,0,1,-45)],
    ['vertical, on a back',  qMul(axisAngle(0,0,1,-45), axisAngle(1,0,0,90))],
    ['vertical, other way',  qMul(axisAngle(0,0,1,-45), axisAngle(0,1,0,90))],
    ['45° tilt',             qMul(axisAngle(0,0,1,-45), axisAngle(1,0,0,45))],
  ];
  for (const [name, mount] of mounts) {
    const cal = captureMount(mount);
    const e0 = toEuler(...applyCal(mount, cal));
    const e1 = toEuler(...applyCal(qMul(axisAngle(0, 0, 1, 50), mount), cal));
    const w = (v) => (v > 180 ? v - 360 : v < -180 ? v + 360 : v);
    const dy = Math.abs(w(e1.yaw - e0.yaw));
    const off = Math.max(Math.abs(w(e1.roll - e0.roll)), Math.abs(w(e1.pitch - e0.pitch)));
    check(Math.abs(dy - 50) < 1e-4 && off < 1e-4, `turn is yaw — ${name}`,
          `yaw ${dy.toFixed(1)}°, other channels ${off.toExponential(1)}°`);
  }
  // and 200 random mountings, because five named cases is five named cases
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const mount = randomQuat();
    const cal = captureMount(mount);
    const e0 = toEuler(...applyCal(mount, cal));
    const e1 = toEuler(...applyCal(qMul(axisAngle(0, 0, 1, 30), mount), cal));
    const w = (v) => (v > 180 ? v - 360 : v < -180 ? v + 360 : v);
    worst = Math.max(worst, Math.abs(w(e1.roll - e0.roll)), Math.abs(w(e1.pitch - e0.pitch)));
  }
  check(worst < 1e-3, 'a turn never leaks into pitch or roll, any mounting',
        `200 random mountings, worst leak ${worst.toExponential(1)}°`);
}

// ── H. a performer's PITCH and ROLL, for a mount with its own twist ────────
// The section that would have caught the one-pose calibration. Model the truth
// the way physics does: performer upright at heading psi, sensor bolted on with
// a fixed rotation Bfix, motions applied in the PERFORMER's frame. Then run the
// real two-pose gesture — neutral, then pointing down — and require each motion
// to land on its own channel.
//
// A turn cannot detect this fault (H commutes with Rz whether or not it is the
// right H), so § G passes either way. What separates them is a strap that
// carries its own rotation about vertical, which every real strap does.
section('H. performer pitch and roll, mounts with strap twist');
{
  const cases = [
    ['flat, level',           -45, axisAngle(1,0,0,0)],
    ['flat, USB down',        -45, axisAngle(1,0,0,180)],
    ['vertical, on a back',   -45, axisAngle(1,0,0,90)],
    ['vertical + twisted',    -45, qMul(axisAngle(1,0,0,90), axisAngle(0,0,1,60))],
    ['arbitrary strap',        30, qMul(axisAngle(1,0,0,70), axisAngle(0,1,0,40))],
    ['head, tilted forward',   10, qMul(axisAngle(1,0,0,110), axisAngle(0,0,1,-25))],
  ];
  const w = (v) => (v > 180 ? v - 360 : v < -180 ? v + 360 : v);
  let worstLeak = 0, signsOk = true;
  for (const [name, psi, Bfix] of cases) {
    const H = axisAngle(0, 0, 1, psi);
    const pose = (att) => qMul(qMul(H, att), Bfix);       // performer attitude → sensor
    const cal = mountFromPoses(pose(axisAngle(1,0,0,0)), pose(axisAngle(0,1,0,-60)));
    if (!cal) { bad(`two poses resolve a frame — ${name}`, 'returned null'); continue; }
    const e0 = toEuler(...applyCal(pose(axisAngle(1,0,0,0)), cal));
    const leakOf = (att) => {
      const e = toEuler(...applyCal(pose(att), cal));
      const d = { roll: Math.abs(w(e.roll-e0.roll)), pitch: Math.abs(w(e.pitch-e0.pitch)),
                  yaw: Math.abs(w(e.yaw-e0.yaw)) };
      const r = Object.entries(d).sort((a,b) => b[1]-a[1]);
      return { chan: r[0][0], mag: r[0][1], leak: r[1][1]/(r[0][1] || 1) };
    };
    const p = leakOf(axisAngle(0,1,0,25));
    const rl = leakOf(axisAngle(1,0,0,25));
    worstLeak = Math.max(worstLeak, p.leak, rl.leak);
    const upPitch = toEuler(...applyCal(pose(axisAngle(0,1,0,25)), cal)).pitch;
    if (upPitch <= 0) signsOk = false;
    check(p.chan === 'pitch' && p.leak < 0.02 && rl.chan === 'roll' && rl.leak < 0.02,
          `pitch stays pitch and roll stays roll — ${name}`,
          `pitch ${p.mag.toFixed(1)}° (${(p.leak*100).toFixed(1)}% leak), ` +
          `roll ${rl.mag.toFixed(1)}° (${(rl.leak*100).toFixed(1)}%)`);
  }
  check(signsOk, 'tipping up is a POSITIVE pitch on every mount',
        'the down-pose fixes the sign, so no polarity flip is needed');
  check(worstLeak < 0.02, 'no cross-axis leak anywhere in the set',
        `worst ${(worstLeak*100).toFixed(2)}%`);

  // and the guards: two poses too close together must be refused, not fudged
  const flat = axisAngle(0,0,1,-45);
  check(mountFromPoses(flat, qMul(flat, axisAngle(0,1,0,5))) === null,
        'poses closer than the minimum are refused', `< ${MOUNT_POSE_MIN_DEG}° apart`);
  check(mountFromPoses(flat, qMul(axisAngle(0,0,1,40), flat)) === null,
        'tipping about VERTICAL is refused', 'that is a turn, not a tip — no frame in it');
}

// ── I. the default axis map carries the convention offset ─────────────────
// orientation() decomposes Z-up (quatToEulerDeg, yaw about Z) and recomposes
// Y-up graphics (yaw about (0,1,0), pitch about (1,0,0), roll about (0,0,1)).
// That relabelling is fixed and mount-independent, so its correction lives in
// the DEFAULT signs. Reset these to +1 and every freshly calibrated mounting
// needs the same two manual flips — which is what happened across four
// different mountings on 2026-08-31 before the cause was found.
section('I. default axis signs');
{
  const signOf = (axis) => DEFAULT_SIGNS[axis];
  check(signOf('roll') === 1,   'default roll sign is +1',  `got ${signOf('roll')}`);
  check(signOf('pitch') === -1, 'default pitch sign is -1', `got ${signOf('pitch')} — the Z-up→Y-up relabelling`);
  check(signOf('yaw') === -1,   'default yaw sign is -1',   `got ${signOf('yaw')} — the Z-up→Y-up relabelling`);
}

// ── J. the relabelling to the sphere: what the cursor does ─────────────────
// orientation() is the one crossing from the sensor's Z-up to the sphere's
// Y-up. With the default signs, on a calibrated mount: tipping up raises the
// cursor, a turn moves only its azimuth and by exactly the turn, and a roll
// does not move it at all (the cursor is a direction, not an attitude).
section('J. the cursor on the sphere');
{
  const fwd = (q) => { const [x,y,z,w] = q; return [2*(x*z+w*y), 2*(y*z-w*x), 1-2*(x*x+y*y)]; };
  const mount = qMul(axisAngle(0,0,1,-45), axisAngle(1,0,0,90));   // vertical, on a back
  const cal = { ...captureMount(mount), signs: { ...DEFAULT_SIGNS } };
  const pose = (att) => qMul(cal.headingQuat, qMul(att, cal.mountQuat));
  const f0 = fwd(orientation(pose(axisAngle(1,0,0,0)), cal));
  const up = fwd(orientation(pose(axisAngle(0,1,0,25)), cal));
  check(Math.abs(f0[1]) < 1e-9 && Math.abs(f0[2] - 1) < 1e-9, 'at the calibrated pose the cursor is dead ahead', `[${f0.map(v => v.toFixed(3))}]`);
  check(up[1] > 0.4, 'tipping up raises the cursor', `forward y ${up[1].toFixed(3)} (sin 25° = 0.423)`);
  const t = fwd(orientation(pose(axisAngle(0,0,1,30)), cal));
  const az = Math.atan2(t[0], t[2]) * 180 / Math.PI;
  check(Math.abs(t[1]) < 1e-9 && Math.abs(Math.abs(az) - 30) < 1e-6, 'a 30° turn moves only azimuth, by 30°', `az ${az.toFixed(3)}°, y ${t[1].toExponential(1)}`);
  const at = attitude(pose(axisAngle(0,0,1,30)), cal);
  check(Math.abs(at.yaw - az) < 1e-6, "the page's yaw is the cursor's azimuth", `yaw ${at.yaw.toFixed(3)}°, az ${az.toFixed(3)}°`);
  const r = fwd(orientation(pose(axisAngle(1,0,0,40)), cal));
  check(Math.hypot(r[0], r[1], r[2] - 1) < 1e-9, 'a roll does not move the cursor', `[${r.map(v => v.toFixed(3))}]`);
  const flipped = { ...cal, signs: { ...DEFAULT_SIGNS, pitch: -DEFAULT_SIGNS.pitch } };
  const down = fwd(orientation(pose(axisAngle(0,1,0,25)), flipped));
  check(down[1] < -0.4, 'the pitch polarity button inverts it', `forward y ${down[1].toFixed(3)}`);
  const a = attitude(pose(axisAngle(0,1,0,25)), cal);
  check(Math.abs(a.pitch - 25) < 1e-6 && Math.abs(a.roll) < 1e-6 && Math.abs(a.yaw) < 1e-6,
        'the page reads that tip as +25° pitch, and nothing else', `roll ${a.roll.toFixed(3)} pitch ${a.pitch.toFixed(3)} yaw ${a.yaw.toFixed(3)}`);
}

// ── K. the camera sensor pans and tilts, never rolls ───────────────────────
// Ek, 2026-09-01: roll never reaches the sphere. The camera role passed the
// whole rotation through until 2026-09-27, and a body sensor leaning 20°
// sideways rolled the view 20°.
section('K. camera: pan and tilt, no roll');
{
  const rot = (q, v) => { const [x,y,z,w] = q, t = [2*(y*v[2]-z*v[1]), 2*(z*v[0]-x*v[2]), 2*(x*v[1]-y*v[0])];
    return [v[0]+w*t[0]+y*t[2]-z*t[1], v[1]+w*t[1]+z*t[0]-x*t[2], v[2]+w*t[2]+x*t[1]-y*t[0]]; };
  let worstRoll = 0, worstFwd = 0;
  for (let i = 0; i < 300; i++) {
    const q = randomQuat();
    const f = rot(q, [0,0,1]);
    if (Math.abs(f[1]) > 0.98) continue;          // straight up or down: no azimuth to keep
    const v = panTilt(q);
    const vf = rot(v, [0,0,1]), vr = rot(v, [1,0,0]);
    worstFwd  = Math.max(worstFwd, Math.hypot(vf[0]-f[0], vf[1]-f[1], vf[2]-f[2]));
    worstRoll = Math.max(worstRoll, Math.abs(vr[1]));   // the view's right axis stays level
  }
  check(worstFwd < 1e-9, 'the view looks exactly where the sensor points', `300 attitudes, worst ${worstFwd.toExponential(1)}`);
  check(worstRoll < 1e-9, 'the horizon never tilts', `worst right-axis rise ${worstRoll.toExponential(1)}`);
}

// ── L. the cursor read in a frame sensor's coordinates ──────────────────────
// Ek, 2026-10-04: a frame sensor (a body, a turntable) — turn it with the hand
// fixed to it and the cursor keeps its spot. Every pose below is built as the
// rig sees it: raw = H · T · B for a sensor whose mount is B and heading H, so
// T is its calibrated pose in the shared stage frame, and each sensor gets its
// OWN random mount and heading — two sensors never agree on either.
section('L. frame: the cursor relative to a frame sensor');
{
  const rot = (q, v) => { const [x,y,z,w] = q, t = [2*(y*v[2]-z*v[1]), 2*(z*v[0]-x*v[2]), 2*(x*v[1]-y*v[0])];
    return [v[0]+w*t[0]+y*t[2]-z*t[1], v[1]+w*t[1]+z*t[0]-x*t[2], v[2]+w*t[2]+x*t[1]-y*t[0]]; };
  const az = q => { const f = rot(q, [0,0,1]); return Math.atan2(f[0], f[2]) * 180 / Math.PI; };
  const randomCal = () => ({ mountQuat: randomQuat(), headingQuat: axisAngle(0,0,1, rnd()*360 - 180), signs: { ...DEFAULT_SIGNS } });
  const raw = (T, cal) => qMul(qMul(cal.headingQuat, T), cal.mountQuat);
  let worstId = 0, worstTogether = 0, worstAlone = 0, n = 0;
  for (let i = 0; i < 300; i++) {
    const cc = randomCal(), fc = randomCal();
    const Tc = randomQuat(), Tf = randomQuat(), R = randomQuat();
    const C = orientation(raw(Tc, cc), cc);
    // frame at identity: zeroed and mounted → the cursor as it was
    worstId = Math.max(worstId, angBetween(inFrame(C, orientation(raw(IDENT, fc), fc)), C));
    // the same rotation R applied to both, in the stage frame → nothing moves
    const before = inFrame(C, orientation(raw(Tf, fc), fc));
    const after  = inFrame(orientation(raw(qMul(R, Tc), cc), cc), orientation(raw(qMul(R, Tf), fc), fc));
    worstTogether = Math.max(worstTogether, angBetween(before, after));
    // and composing in the sphere equals composing the calibrated poses
    worstAlone = Math.max(worstAlone, angBetween(before, orientation(qMul(qConj(Tf), Tc), null)));
    n++;
  }
  check(worstId < 1e-4, 'a frame at identity leaves the cursor unchanged', `${n} poses, worst ${worstId.toExponential(1)}°`);
  check(worstTogether < 1e-4, 'frame and hand turned or tipped TOGETHER: the cursor does not move', `${n} poses × random R, worst ${worstTogether.toExponential(1)}°`);
  check(worstAlone < 1e-4, 'the result is conj(F)·C of the calibrated poses — the frame\'s WHOLE rotation counts', `worst ${worstAlone.toExponential(1)}°`);
  // the frame alone turns 60°, the hand still: the cursor moves by the inverse
  const cc = randomCal(), fc = randomCal();
  const still = orientation(raw(IDENT, cc), cc);
  const handTurned = az(orientation(raw(axisAngle(0,0,1,60), cc), cc));
  const frameTurned = az(inFrame(still, orientation(raw(axisAngle(0,0,1,60), fc), fc)));
  check(Math.abs(handTurned) > 59.9 && Math.abs(frameTurned + handTurned) < 1e-6,
    'the frame turns 60° alone: the cursor moves 60° the OTHER way', `hand alone ${handTurned.toFixed(3)}°, frame alone ${frameTurned.toFixed(3)}°`);
  const tipped = rot(inFrame(still, orientation(raw(axisAngle(0,1,0,25), fc), fc)), [0,0,1]);
  check(tipped[1] < -0.4, 'the frame tips up 25° alone: the cursor drops relative to it', `forward y ${tipped[1].toFixed(3)}`);
  // the frame lost (none, or silent — the registry passes null): the world cursor
  check(inFrame(still, null) === still, 'no frame: the cursor is the world cursor, untouched', 'identity of reference');
}

console.log(`\n${fail === 0 ? 'All sensor calibration invariants hold.' : `${fail} FAILED`}  (${pass} checks)`);
process.exit(fail === 0 ? 0 : 1);
