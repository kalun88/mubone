#!/usr/bin/env node
// ============================================================================
// sensor-rig-audit.js — two sensors (and two listeners), every role, against the running app
//
// sensor-audit.js proves the maths with no app. This proves the WIRING: two
// synthetic OSC sensors ("A" the hand, "B" the body) fed through the real
// dispatch (osc.js handleOSC → sensors.js → the registry → renderer.js
// applySensorPose), then read back from S — the cursor, the view, the roles.
// Written 2026-09-27 from the probe that found three bugs with no hardware:
// a new sensor stole the cursor, zero heading left the cursor off by the
// camera sensor's drift, and the camera sensor rolled the view. "F" is the
// frame sensor (2026-10-04): the cursor read relative to it.
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
      mode: S.cameraMode, A: role('A'), B: role('B'), C: role('C'), D: role('D'), E: role('E'), F: role('F'),
      framed: S.sensorFramed,
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

  console.log('\n── frame: the cursor read relative to a frame sensor ──');
  await setRole('B', 'unmapped');
  await pose('F', turn(0)); await sleep(500);
  r = await read();
  check(r.F === 'unmapped', 'a third sensor takes no role by itself', `F ${r.F}`);
  await setRole('F', 'frame'); await settle();
  r = await read();
  check(r.F === 'frame' && r.framed && !r.twoSensor && near(r.world.az, 0) && near(r.world.el, 0),
    'frame chosen: both forward, the cursor is forward', `F ${r.F}, framed ${r.framed}, ${JSON.stringify(r.world)}`);
  await pose('A', turn(60)); await settle();
  const handAz = (await read()).world.az;
  await pose('F', turn(60)); await sleep(700);
  r = await read();
  check(Math.abs(handAz) > 55 && near(r.world.az, 0) && near(r.cam.az, 0, 3),
    'body and hand turn 60° together: the cursor keeps its spot, the camera follows it',
    `hand alone ${handAz.toFixed(1)}°, together ${r.world.az.toFixed(1)}°, camera ${r.cam.az.toFixed(1)}°`);
  await pose('A', [[0, 0, 1, 45], [1, 0, 0, 25], [0, 1, 0, 15]]);
  await pose('F', [[0, 0, 1, 45], [1, 0, 0, 25], [0, 1, 0, 15]]); await settle();
  r = await read();
  check(near(r.world.az, 0) && near(r.world.el, 0), 'turned, leaning and bowing together: the cursor still holds',
    JSON.stringify(r.world));
  await pose('A', turn(0)); await pose('F', turn(60)); await sleep(700);
  r = await read();
  check(near(r.world.az, -handAz) && near(r.cam.az, -handAz, 3), 'the body turns 60° alone: the cursor moves 60° the other way',
    `cursor ${r.world.az.toFixed(1)}°, camera ${r.cam.az.toFixed(1)}°`);
  await pose('A', turn(40)); await pose('F', turn(-25)); await settle();
  await rig.evaluate(async () => { const { S } = await import('./js/state.js'); S._tareCursor(); });
  await settle();
  r = await read();
  check(near(r.world.az, 0) && near(r.world.el, 0), 'zero heading zeroes the frame too: the cursor is forward', JSON.stringify(r.world));
  await pose('A', turn(0)); await pose('F', turn(0));
  await rig.evaluate(async () => { const { S } = await import('./js/state.js'); S._tareCursor(); });
  await setRole('B', 'camera'); await pose('B', turn(30)); await pose('A', turn(60)); await pose('F', turn(60)); await settle();
  r = await read();
  check(r.twoSensor && r.framed && near(r.world.az, 0) && near(Math.abs(r.screen.az), 30) && near(r.viewRoll, 0, 0.5),
    'three sensors: the cursor relative to the frame, the view the camera\'s',
    `cursor ${r.world.az.toFixed(1)}°, screen ${r.screen.az.toFixed(1)}°`);
  await pose('B', turn(0)); await pose('A', turn(30));
  await rig.evaluate(() => { delete window.__feed.F; });   // the frame sensor goes silent
  await sleep(2600);
  r = await read();
  check(!r.framed && near(r.world.az, handAz / 2), 'the frame sensor goes silent: the cursor is the world one again',
    `framed ${r.framed}, cursor ${r.world.az.toFixed(1)}° (hand alone at 30°: ${(handAz / 2).toFixed(1)}°)`);
  await pose('A', turn(0));
  await rig.evaluate(async () => { (await import('./js/sensors.js')).forgetOscSensor('F'); });   // the page below counts two rows
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
  // An old-shape entry: the per-axis map, and the 'frame' role it was saved with
  // (deleted 2026-09-27, back 2026-10-04 — such a choice is good again).
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
  check(r.C === 'frame', "a saved 'frame' role comes back as the frame", `C ${r.C}`);
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

  // THE LISTEN ROLE (2026-10-04): a cursor that only hears. Any number of
  // sensors hold it; it reads the corpus where it points (grain.js
  // _scheduleListeners → S._listeners), moves nothing of cursor 0's, and a
  // listener whose sensor falls silent fades out and is gone.
  console.log('\n── listen ──');
  await pose('A', turn(0)); await pose('L', turn(40)); await pose('M', turn(-40)); await sleep(600);
  await setRole('L', 'listen'); await setRole('M', 'listen'); await settle();
  r = await read();
  const lsRead = () => rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const m = await import('./js/sensors.js');
    return { L: m.getSensor('osc-L')?.role, M: m.getSensor('osc-M')?.role,
             ls: (S._listeners || []).map(l => ({ name: l.name, az: l.lon * 180 / Math.PI, level: l.level, reach: l._reach?.length ?? 0 })) };
  });
  let ls = await lsRead();
  const azOf = n => ls.ls.find(l => l.name === 'osc-' + n)?.az;
  check(ls.L === 'listen' && ls.M === 'listen' && r.A === 'cursor' && r.B === 'camera',
    'two sensors hold listen at once, and the cursor and camera keep theirs', `L ${ls.L}, M ${ls.M}, A ${r.A}, B ${r.B}`);
  check(ls.ls.length === 2 && near(Math.abs(azOf('L')), 40) && near(Math.abs(azOf('M')), 40) && Math.sign(azOf('L')) === -Math.sign(azOf('M')),
    'each listener points where its sensor does', ls.ls.map(l => `${l.name} ${l.az.toFixed(1)}°`).join(', '));
  check(near(r.world.az, 0), 'the cursor stays where its own sensor points', `cursor ${r.world.az.toFixed(1)}°`);
  // A corpus under L and nothing under M: L reads it, M reads nothing.
  await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const G = await import('./js/grain.js');
    const lon = S._listeners.find(l => l.name === 'osc-L').lon;
    window.__keptParts = S.particles.slice();
    S.particles.length = 0;
    for (let i = 0; i < 20; i++) {
      const p = { lon: lon + (i - 10) * 0.004, lat: 0, strokeId: 900001, source: 'live', liveBufferIdx: 0, grainStart: i * 0.05, grainDuration: 0.1 };
      G.stampCartesian(p); S.particles.push(p);
    }
    S._particleVersion++;
  });
  await sleep(300);
  ls = await lsRead();
  const reachOf = n => ls.ls.find(l => l.name === 'osc-' + n)?.reach;
  check(reachOf('L') === 20 && reachOf('M') === 0, 'a listener reads the marks under it, and one over empty sphere reads none',
    `L ${reachOf('L')}, M ${reachOf('M')}`);
  // ITS OWN SETTINGS (Ek, 2026-10-04): L takes a copy of the cursor's, then a
  // 1° radius of its own — it reads fewer marks; the cursor's radius is
  // untouched; following again, it reads them all.
  const own = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const reg = await import('./js/sensor-registry.js');
    const wait = ms => new Promise(res => setTimeout(res, ms));
    const reach = () => S._listeners.find(l => l.name === 'osc-L')?._reach?.length ?? 0;
    const r0 = S.searchRadiusDeg;
    reg.setListenOwn('osc-L', { reads: S.lensReads, radius: r0, mode: S.lensMode, depth: S.recencyN, k: 0, step: false, rfade: false, fadeCurve: 0.5 });
    await wait(150); const copied = reach();
    reg.setListenParam('osc-L', 'radius', 1); await wait(150); const narrow = reach();
    const mainR = S.searchRadiusDeg;
    reg.setListenOwn('osc-L', null); await wait(150); const back = reach();
    return { copied, narrow, back, r0, mainR };
  });
  check(own.copied === 20 && own.narrow > 0 && own.narrow < 20 && own.back === 20 && own.mainR === own.r0,
    'a listener on its own settings reads with its own radius; the cursor\'s is untouched; following again, it reads as the cursor', JSON.stringify(own));
  // A LISTENER WORKS LIKE THE CURSOR (Ek, 2026-10-04): a tape line under L
  // fires when L touches it and releases when L leaves; under dwell: grain,
  // the take once opened is in L's reach.
  const tape = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const G = await import('./js/grain.js');
    const TR = await import('./js/trigger.js');
    const lon = S._listeners.find(l => l.name === 'osc-L').lon;
    const sr = S.audioCtx.sampleRate;
    S.liveRecBuffers[7] = { buffer: S.audioCtx.createBuffer(1, sr * 2, sr), liveBuffer: null, grainCursor: 0 };
    for (let i = 0; i < 8; i++) {
      const p = { lon: lon + 0.5 + i * 0.002, lat: 0, strokeId: 900002, source: 'live', liveBufferIdx: 7,
                  grainStart: i * 0.1, grainDuration: 0.1, trig: true };
      G.stampCartesian(p); S.particles.push(p);
    }
    S._particleVersion++;
    const t = TR.armTrigger(900002);
    const wait = ms => new Promise(res => setTimeout(res, ms));
    await wait(300);
    const away = { inside: !!t?.trigger?._inside, playing: !!t?.playing };
    // Bring the line under L.
    for (const p of S.particles) if (p.strokeId === 900002) { p.lon -= 0.5; delete p._cx; G.stampCartesian(p); }
    S._particleVersion++;
    await wait(300);
    const lId = S._listeners.find(l => l.name === 'osc-L').idx;
    const on = { inside: !!t?.trigger?._inL?.[lId], fired: !!(t?.playing || t?._sourceNode) };
    // A SECOND CURSOR ON THE SAME LINE IS A SECOND VOICE (Ek: "more cursors on
    // it … louder"). M joins L: two voices sound; M leaves (release: stop):
    // its voice goes, L's plays on.
    const tp0 = { dwell: S.triggerParams.dwell, release: S.triggerParams.release };
    Object.assign(S.triggerParams, { dwell: 'loop', release: 'stop' });
    const voices = () => (t._voices || []).filter(v => !v.src._stopped).length + (t._sourceNode && !t._sourceNode._stopped ? 1 : 0);
    const mWas = window.__feed.M;
    window.__feed.M = window.__feed.L;
    await wait(400);
    const both = voices();
    window.__feed.M = mWas;
    await wait(400);
    const after = voices();
    Object.assign(S.triggerParams, tp0);
    // Opened under dwell: grain, the take is L's material too.
    const dwell = S.triggerParams.dwell;
    S.triggerParams.dwell = 'grain'; S._openStrokes.add(900002);
    await wait(200);
    const L = S._listeners.find(l => l.name === 'osc-L');
    const opened = (L?._reach || []).filter(p => p.strokeId === 900002).length;
    S._openStrokes.delete(900002); S.triggerParams.dwell = dwell;
    // Take the line away again — further from cursor 0, not toward it: the gate lets go.
    for (const p of S.particles) if (p.strokeId === 900002) { p.lon -= 0.5; delete p._cx; G.stampCartesian(p); }
    S._particleVersion++;
    await wait(300);
    const left = { inside: !!t?.trigger?._inL?.[lId] || !!t?.trigger?._inside };
    TR.stopTriggerAudio?.(t, 'immediate', 0.01);
    for (let i = S.particles.length - 1; i >= 0; i--) if (S.particles[i].strokeId === 900002) S.particles.splice(i, 1);
    S._particleVersion++;
    return { armed: !!t, away, on, opened, left, both, after };
  });
  check(tape.armed && !tape.away.inside && tape.on.inside && tape.on.fired,
    'a tape line under a listener fires, as under the cursor', JSON.stringify(tape));
  check(tape.both === 2, 'two listeners on one line sound two voices', `${tape.both} voices`);
  check(tape.after === 1, 'one of them leaving releases its own voice, and the other plays on', `${tape.after} voice(s)`);
  check(tape.opened > 0, 'a take dwell opened is in the listener\'s reach', `${tape.opened} marks`);
  // A TAKE LAID UNDER A RESTING LISTENER PLAYS AT ONCE (Ek: "the listen cursor
  // should pick up the line stroke and start the playback (like if it was a
  // pinned empty cloud)"), with the rules the empty pin learned: an edit or an
  // import makes no noise, a line a pin plays is not doubled, and the pin
  // lifting under the listener is its arrival.
  const laid = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const G = await import('./js/grain.js');
    const TR = await import('./js/trigger.js');
    const UP = await import('./js/ui-presets.js');
    const wait = ms => new Promise(res => setTimeout(res, ms));
    const T = await import('./js/take.js');
    const L = S._listeners.find(l => l.name === 'osc-L'), c = L.idx + 1;
    // A real take (shared memory), as a recording makes: a pin cuts its loop from one.
    S.liveRecBuffers[8] = { buffer: T.makeTake(new Float32Array(S.audioCtx.sampleRate * 2), S.audioCtx.sampleRate), grainCursor: 0 };
    const lay = sid => { for (let i = 0; i < 8; i++) {
      const p = { lon: L.lon - 0.01 + i * 0.003, lat: L.lat, strokeId: sid, source: 'live', liveBufferIdx: 8,
                  grainStart: i * 0.1, grainDuration: 0.1, trig: true };
      G.stampCartesian(p); S.particles.push(p);
    } S._particleVersion++; };
    const mine = t => !!t && ((t._sourceNode && !t._sourceNode._stopped && t._owner === c) || (t._voices || []).some(v => v.owner === c && !v.src._stopped) || (t.playing && t._owner === c));
    const tp0 = { dwell: S.triggerParams.dwell, release: S.triggerParams.release };
    Object.assign(S.triggerParams, { dwell: 'loop', release: 'stop' });
    // A fresh take, laid where L rests.
    lay(900003); const t3 = TR.armTrigger(900003); await wait(300);
    const fresh = mine(t3);
    // The real case: the cursor lays the take, its path running under L, and
    // the release leaves the cursor on the line too — both arrive on the SAME
    // tick: the cursor's audition and L's voice, two voices.
    const A = (await import('./js/sphere.js')).cursorLonLatNow();
    for (let i = 0; i <= 10; i++) {
      const f = i / 10;
      const p = { lon: L.lon + (A.lon - L.lon) * f, lat: L.lat + (A.lat - L.lat) * f, strokeId: 900006, source: 'live', liveBufferIdx: 8,
                  grainStart: i * 0.1, grainDuration: 0.1, trig: true };
      G.stampCartesian(p); S.particles.push(p);
    }
    S._particleVersion++;
    const t6 = TR.armTrigger(900006); await wait(400);
    const both0 = !!t6?.trigger?._inside && !!t6?.trigger?._inL?.[L.idx];
    const voices6 = (t6._voices || []).filter(v => !v.src._stopped).length + (t6._sourceNode && !t6._sourceNode._stopped ? 1 : 0);
    const sameTick = { both0, voices6, lMine: mine(t6) };
    TR.stopTriggerAudio(t6, 'immediate', 0.01);
    // An import under L: primed, silent.
    lay(900004); const t4 = TR.restoreTrigger({ strokeId: 900004 }); await wait(300);
    const imported = mine(t4);
    // A take a pin plays: L does not double it; the pin lifted, L takes it up.
    lay(900005); const t5 = TR.armTrigger(900005); TR.stopTriggerAudio(t5, 'immediate', 0.01);
    UP.createSeqFromStroke(900005, t5.particles[0]); await wait(300);
    const claimed = mine(t5);
    const slot = S.commitSlots.find(x => x?.strokeId === 900005);
    if (slot) UP.removePinSlot(slot);
    await wait(400);
    const lifted = mine(t5);
    Object.assign(S.triggerParams, tp0);
    for (const t of [t3, t4, t5]) if (t) TR.stopTriggerAudio(t, 'immediate', 0.01);
    S.triggers = S.triggers.filter(t => ![900003, 900004, 900005, 900006].includes(t.strokeId));
    for (let i = S.particles.length - 1; i >= 0; i--) if ([900003, 900004, 900005, 900006].includes(S.particles[i].strokeId)) S.particles.splice(i, 1);
    S._particleVersion++;
    return { fresh, imported, claimed, lifted, pinned: !!slot, sameTick };
  });
  check(laid.fresh, 'a take laid under a resting listener plays at once', JSON.stringify(laid));
  check(laid.sameTick.both0 && laid.sameTick.voices6 === 2 && laid.sameTick.lMine,
    '…and when the cursor lands on it in the same tick, both play: two voices', JSON.stringify(laid.sameTick));
  check(!laid.imported, '…an imported line under it does not', JSON.stringify(laid));
  check(laid.pinned && !laid.claimed && laid.lifted, '…a line a pin plays is not doubled, and unpinned under it, the listener takes it up', JSON.stringify(laid));
  check(!tape.left.inside, 'the line released when no cursor is on it', JSON.stringify(tape.left));
  // L falls silent: it fades, then it is gone; M plays on.
  await rig.evaluate(() => { delete window.__feed.L; });
  const fade = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const seen = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 3200) {
      const l = S._listeners.find(x => x.name === 'osc-L');
      seen.push(l ? l.level : -1);
      await new Promise(res => setTimeout(res, 20));
    }
    return { mid: seen.filter(v => v > 0 && v < 1).length, gone: seen.at(-1) === -1, m: S._listeners.some(x => x.name === 'osc-M') };
  });
  check(fade.mid > 0 && fade.gone && fade.m, 'a silent listener fades out and is gone; the other plays on',
    `${fade.mid} samples mid-fade, gone ${fade.gone}, M ${fade.m}`);
  await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    S.particles.length = 0; S.particles.push(...(window.__keptParts || [])); S._particleVersion++;
  });

  await rig.evaluate(async () => {
    clearInterval(window.__feedTimer); window.__feed = {};
    const m = await import('./js/sensors.js');
    for (const n of ['A', 'B', 'C', 'D', 'E', 'F', 'L', 'M']) m.forgetOscSensor(n);
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
