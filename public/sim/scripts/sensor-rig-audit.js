#!/usr/bin/env node
// ============================================================================
// sensor-rig-audit.js — two sensors, every role, against the running app
//
// sensor-audit.js proves the maths with no app. This proves the WIRING: two
// synthetic OSC sensors ("A" the hand, "B" the body) fed through the real
// dispatch (osc.js handleOSC → sensors.js → the registry → renderer.js
// applySensorPose), then read back from S — the cursor, the view, the roles.
// Written 2026-09-27 from the probe that found three bugs with no hardware:
// a new sensor stole the cursor, zero heading left the cursor off by the
// camera sensor's drift, and the camera sensor rolled the view.
//
//   node scripts/sensor-rig-audit.js            # its own private instance
//   node scripts/rig-audit.js sensors           # the same, as a rig suite
//
// NOT for --attach on the rig you play: choosing roles for its synthetic
// sensors rewrites the standing choices, and forgetting them at the end leaves
// your instrument with no chosen role (it takes the cursor again by default).
//
// The sensors are fed from INSIDE the page at 100 Hz, so no UDP port is
// involved and --attach works on any instance — but attaching adds two
// sensors to that app's storage; they are forgotten at the end.
// ============================================================================

'use strict';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(rig) {
  let failures = 0;
  const ok  = (n, d = '') => console.log(`  ok   ${n}${d ? '  — ' + d : ''}`);
  const bad = (n, d = '') => { failures++; console.log(`  FAIL ${n}${d ? '  — ' + d : ''}`); };
  const check = (c, n, d) => (c ? ok : bad)(n, d);

  // The feeder: window.__feed[name] = [x,y,z,w] (Z-up, the wire convention),
  // posted through the real OSC dispatch every 10 ms. deg() builds a rotation.
  const startFeeder = () => rig.evaluate(async () => {
    const { handleOSC } = await import('./js/osc.js');
    clearInterval(window.__feedTimer);
    window.__feed = window.__feed || {};
    window.__feedTimer = setInterval(() => {
      for (const [n, q] of Object.entries(window.__feed)) handleOSC(`/sensor/${n}/quaternion`, q);
    }, 10);
  });
  const pose = (name, parts) => rig.evaluate(([n, ps]) => {
    // parts: [[ax, ay, az, deg], …] composed left to right, world frame first
    const mul = (a, b) => [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
                           a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
    let q = [0, 0, 0, 1];
    for (const [x, y, z, d] of ps) { const h = d * Math.PI / 360, s = Math.sin(h); q = mul(q, [x*s, y*s, z*s, Math.cos(h)]); }
    window.__feed[n] = q;
  }, [name, parts]);
  const turn = (deg) => [[0, 0, 1, deg]];
  const setRole = (name, role) => rig.evaluate(async ([n, r]) => {
    const m = await import('./js/sensors.js');
    m.setRole(m.getSensor('osc-' + n), r);
  }, [name, role]);
  const read = () => rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const m = await import('./js/sensors.js');
    const rot = (q, v) => { const [x,y,z,w] = q, t = [2*(y*v[2]-z*v[1]), 2*(z*v[0]-x*v[2]), 2*(x*v[1]-y*v[0])];
      return [v[0]+w*t[0]+y*t[2]-z*t[1], v[1]+w*t[1]+z*t[0]-x*t[2], v[2]+w*t[2]+x*t[1]-y*t[0]]; };
    const ang = f => ({ az: Math.atan2(f[0], f[2]) * 180 / Math.PI, el: Math.asin(Math.max(-1, Math.min(1, f[1]))) * 180 / Math.PI });
    const w = S.cursorQ ? rot(S.cursorQ, [0, 0, 1]) : null;
    const scr = w && S.cameraSensorQ ? rot(S.cameraSensorQ, w) : w;
    const up = S.cameraSensorQ ? rot(S.cameraSensorQ, [0, 1, 0]) : [0, 1, 0];
    const role = n => m.getSensor('osc-' + n)?.role ?? null;
    return {
      mode: S.cameraMode, A: role('A'), B: role('B'), C: role('C'), D: role('D'), E: role('E'),
      world: w && ang(w), screen: scr && ang(scr), cam: ang(rot(S.camQ, [0, 0, 1])),
      viewRoll: Math.atan2(-up[0], up[1]) * 180 / Math.PI, twoSensor: !!S.cameraSensorQ,
    };
  });
  const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
  const settle = () => sleep(350);

  await rig.evaluate(() => { window.__feed = {}; });
  await startFeeder();

  console.log('\n── roles: who gets the cursor ──');
  await pose('A', turn(0)); await sleep(500);
  let r = await read();
  check(r.A === 'cursor', 'the first sensor takes the cursor', `A ${r.A}`);
  await pose('B', turn(0)); await sleep(500);
  r = await read();
  check(r.A === 'cursor' && r.B === 'unmapped', 'a second sensor does NOT take it', `A ${r.A}, B ${r.B}`);

  await rig.evaluate(async () => { const { S } = await import('./js/state.js'); S._setCameraMode('sensor'); });
  await setRole('B', 'camera'); await settle();

  console.log('\n── cursor + camera: independent ──');
  r = await read();
  check(r.mode === 'sensor' && r.twoSensor, 'camera mode is on and the camera sensor holds the view', `mode ${r.mode}`);
  check(r.screen && near(r.screen.az, 0) && near(r.screen.el, 0), 'both forward: the cursor is at view centre', JSON.stringify(r.screen));
  await pose('B', turn(60)); await settle();
  r = await read();
  check(near(r.world.az, 0) && near(Math.abs(r.screen.az), 60),
    'the body turns 60°, the hand still: the cursor keeps its spot and slides 60° across the view',
    `world ${r.world.az.toFixed(1)}°, screen ${r.screen.az.toFixed(1)}°`);
  await pose('B', turn(0)); await pose('A', turn(150)); await settle();
  r = await read();
  check(Math.abs(r.screen.az) > 120, 'the hand points behind: the cursor leaves the view', `screen ${r.screen.az.toFixed(1)}°`);
  await pose('A', turn(0)); await pose('B', [[1, 0, 0, 20]]); await settle();
  r = await read();
  check(near(r.viewRoll, 0, 0.5), 'the body leans 20° sideways: the view does not roll', `roll ${r.viewRoll.toFixed(2)}°`);
  await pose('B', [[0, 1, 0, 20]]); await settle();
  r = await read();
  check(near(Math.abs(r.screen.el), 20) && near(r.viewRoll, 0, 0.5), 'the body bows 20°: the view tilts 20°', `screen el ${r.screen.el.toFixed(1)}°`);
  await pose('B', [[0, 0, 1, 45], [1, 0, 0, 25]]); await settle();
  r = await read();
  check(near(Math.abs(r.screen.az), 45) && near(r.viewRoll, 0, 0.5), 'turned 45° and leaning 25°: pans 45°, no roll',
    `screen az ${r.screen.az.toFixed(1)}°, roll ${r.viewRoll.toFixed(2)}°`);

  console.log('\n── zero heading ──');
  await pose('A', turn(40)); await pose('B', turn(-25)); await settle();
  await rig.evaluate(async () => { const { S } = await import('./js/state.js'); S._tareCursor(); });
  await settle();
  r = await read();
  check(near(r.world.az, 0) && near(r.screen.az, 0),
    'zeroing with both sensors facing "forward" centres the cursor', `world ${r.world.az.toFixed(1)}°, screen ${r.screen.az.toFixed(1)}°`);
  await pose('A', turn(0)); await pose('B', turn(0));
  await rig.evaluate(async () => { const { S } = await import('./js/state.js'); S._tareCursor(); });
  await settle();

  console.log('\n── switching ──');
  await setRole('B', 'cursor'); await settle();
  r = await read();
  check(r.B === 'cursor' && r.A === 'unmapped', 'giving B the cursor takes it from A', `A ${r.A}, B ${r.B}`);
  await setRole('B', 'unmapped'); await setRole('A', 'cursor'); await pose('A', turn(30)); await sleep(700);
  r = await read();
  check(!r.twoSensor && near(r.world.az, r.cam.az, 3), 'one sensor again: the camera follows the cursor',
    `cursor ${r.world.az.toFixed(1)}°, camera ${r.cam.az.toFixed(1)}°`);

  console.log('\n── the Sensors page ──');
  const page = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    S._openSettings('sensors');
    await new Promise(res => setTimeout(res, 700));
    const btns = [...document.querySelectorAll('.set-device-cursor')];
    const out = { n: btns.length, lit: btns.filter(b => b.getAttribute('aria-pressed') === 'true').length };
    document.querySelector('#settingsModal.open .close-btn, #settingsClose')?.click();
    return out;
  });
  check(page.n === 2 && page.lit === 1, 'each connected sensor has a Cursor switch, one lit', `${page.n} buttons, ${page.lit} lit`);

  console.log('\n── storage ──');
  await setRole('B', 'camera'); await settle();
  // An old-shape entry: the per-axis map and the deleted 'frame' role.
  await rig.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('mubone_sensor_cal') || '{}');
    all['osc-C'] = { quatRole: 'frame', inertialRole: 'unmapped', quatCal: {
      mountQuat: null, headingQuat: null,
      axisMap: { x: { viz: 'roll', sign: 1, mute: false }, y: { viz: 'pitch', sign: 1, mute: false }, z: { viz: 'yaw', sign: -1, mute: true } } } };
    // A sensor absent today whose slot remembers holding the cursor.
    all['osc-E'] = { quatRole: 'cursor', inertialRole: 'unmapped', quatCal: { mountQuat: null, headingQuat: null, signs: { roll: 1, pitch: -1, yaw: -1 } } };
    localStorage.setItem('mubone_sensor_cal', JSON.stringify(all));
    // and elevation bindings under the old key, on the old negative scale —
    // one folded (|x|: the same under either sign, so its range must stay)
    localStorage.setItem('mubone_sensor_bindings', JSON.stringify({
      grain_size: { sensor: 'osc-A', axis: 'elevation', inLo: -10, inHi: -60, fold: false },
      grain_flow: { sensor: 'osc-A', axis: 'elevation', inLo: 10, inHi: 60, fold: true } }));
  });
  await rig.reload();
  await rig.evaluate(() => { window.__feed = {}; });
  await startFeeder();
  await pose('A', turn(0)); await pose('B', turn(0)); await pose('C', turn(0)); await sleep(700);
  r = await read();
  check(r.A === 'cursor' && r.B === 'camera', 'roles survive a reload', `A ${r.A}, B ${r.B}`);
  check(r.C === 'unmapped', "a saved 'frame' role comes back as no role", `C ${r.C}`);
  const mig = await rig.evaluate(async () => {
    const reg = await import('./js/sensor-registry.js');
    const stored = JSON.parse(localStorage.getItem('mubone_sensor_cal') || '{}')['osc-C']?.quatCal || {};
    return { signs: reg.getRegistry().get('osc-C')?.quatCal.signs, hasMap: 'axisMap' in stored };
  });
  check(mig.signs?.pitch === 1 && mig.signs?.yaw === -1 && !mig.hasMap,
    'an old axis map becomes three signs, once', JSON.stringify(mig));
  const bind = await rig.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('mubone_sensor_axis_bindings') || '{}');
    return { now: all.grain_size, folded: all.grain_flow, old: localStorage.getItem('mubone_sensor_bindings') };
  });
  check(bind.now?.inLo === 10 && bind.now?.inHi === 60 && bind.old === null,
    'an elevation binding moves to the new key with its range negated — it sounds the same', JSON.stringify(bind.now));
  check(bind.folded?.inLo === 10 && bind.folded?.inHi === 60, 'a FOLDED elevation binding keeps its range (|x| has no sign)', JSON.stringify(bind.folded));

  console.log('\n── a role belongs to a sensor that is playing ──');
  await pose('E', turn(0)); await sleep(600);
  r = await read();
  check(r.A === 'cursor' && r.E === 'unmapped', 'a sensor powered on mid-show does not take the cursor its slot remembers',
    `A ${r.A}, E ${r.E} (E saved as cursor)`);
  await rig.evaluate(() => { delete window.__feed.A; });   // the cursor sensor goes silent
  await sleep(2600);
  await pose('D', turn(0)); await sleep(600);
  r = await read();
  check(r.D === 'cursor', 'a sensor joining after the cursor sensor went silent takes the cursor', `A ${r.A} (silent), D ${r.D}`);
  await pose('A', turn(0)); await sleep(600);
  r = await read();
  check(r.A === 'cursor' && r.D === 'unmapped', 'the chosen cursor sensor, back from silence, takes the cursor back from the stand-in',
    `A ${r.A}, D ${r.D}`);
  // "none" is a choice: a sensor set to none never takes the cursor by default
  await rig.evaluate(async () => { const m = await import('./js/sensors.js'); m.setRole(m.getSensor('osc-C'), 'unmapped'); });
  await rig.evaluate(() => { delete window.__feed.A; });
  await sleep(2600);
  r = await read();
  check(r.C === 'unmapped', 'a sensor set to "none" stays none when the cursor sensor goes silent', `A ${r.A} (silent), C ${r.C}`);
  await pose('A', turn(0)); await sleep(600);
  // disconnecting the cursor sensor lets the cursor go (the mouse takes it), and a reconnect restores it
  const disc = await rig.evaluate(async () => {
    const m = await import('./js/sensors.js'); const { S } = await import('./js/state.js');
    delete window.__feed.A;
    m.removeSensor('osc-A');
    await new Promise(res => setTimeout(res, 300));
    const cursorAfter = S.cursorQ;
    window.__feed.A = [0, 0, 0, 1];
    await new Promise(res => setTimeout(res, 600));
    return { cursorAfter, back: m.getSensor('osc-A')?.role };
  });
  check(disc.cursorAfter === null && disc.back === 'cursor', 'a disconnected cursor sensor lets go of the cursor, and takes it back on reconnect',
    `cursor after disconnect ${disc.cursorAfter}, role on reconnect ${disc.back}`);

  // Boot order, the regression the second review reproduced: a sensor set to
  // "none" speaks FIRST after a restart, the chosen cursor sensor a moment later.
  await rig.reload();
  await rig.evaluate(() => { window.__feed = {}; });
  await startFeeder();
  await pose('C', turn(0)); await sleep(300);
  await pose('A', turn(0)); await pose('B', turn(0)); await sleep(700);
  r = await read();
  check(r.A === 'cursor' && r.C === 'unmapped' && r.B === 'camera', 'after a restart, "none" speaking first does not take the chosen cursor',
    `C (none) ${r.C}, A (cursor) ${r.A}, B (camera) ${r.B}`);

  console.log('\n── the reading ──');
  await pose('A', [[0, 1, 0, 25]]); await settle();   // performer tips the hand up (§ H's axis)
  const reading = await rig.evaluate(async () => {
    const m = await import('./js/sensors.js');
    const b = await import('./js/sensor-bindings.js');
    return { page: m.getCalibratedEuler(m.getSensor('osc-A'))?.pitch, binding: b.readSensorAxis('osc-A', 'elevation') };
  });
  r = await read();
  check(reading.page > 20 && reading.binding > 20 && r.world.el > 20,
    'tipping up: the page, an Elevation binding and the cursor all go UP',
    `page ${reading.page?.toFixed(1)}°, binding ${reading.binding?.toFixed(1)}°, cursor el ${r.world.el.toFixed(1)}°`);

  await rig.evaluate(async () => {
    clearInterval(window.__feedTimer); window.__feed = {};
    const m = await import('./js/sensors.js');
    for (const n of ['A', 'B', 'C', 'D', 'E']) m.forgetOscSensor(n);
  });
  const errs = rig.errors ? rig.errors() : [];
  check(errs.length === 0, 'no renderer errors along the way', errs.slice(0, 3).join(' | '));
  console.log(`\n${failures === 0 ? 'All two-sensor checks hold.' : `${failures} FAILED`}`);
  return failures;
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    const { launch, attach } = require('./lib/rig');
    const rig = process.argv.includes('--attach') ? await attach() : await launch();
    let failures = 1;
    try { failures = await run(rig); }
    finally { if (!process.argv.includes('--attach')) await rig.close(); }
    process.exit(failures ? 1 : 0);
  })();
}
