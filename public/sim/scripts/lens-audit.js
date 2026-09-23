#!/usr/bin/env node
/**
 * scripts/lens-audit.js — the cursor reads what its tab says (2026-09-23).
 *
 *   node scripts/lens-audit.js
 *   node scripts/rig-audit.js lens
 *
 * Every row of the cursor tab, driven through the SAME geometry and selection
 * the scheduler uses (grain.js `_cursorGeometry` / `_selectPerVoicing`, reached
 * through `__testCandidatePool`) and through the bridge's real candidate
 * tables: radius, depth (local, newest first), k (the nearest k) and all,
 * nearest, scope (grains / tape / both), `dwell: grain` opening a take only
 * once it has played through — in nearest too — walk, the cap, the fade's
 * gain against distance, and step's order.
 *
 * Why it exists: on the day it was written, two of these were wrong and
 * nothing said so. Step ordered marks by where they sat in the BUFFER, so a
 * stroke painted second from earlier in a file stepped first; and nearest
 * granulated a dwell-grain take the moment the cursor arrived, over its own
 * first pass. The test seam had also drifted from the scheduler (walk's
 * `onlyOpen` never reached it), which is why the geometry is one function now.
 *
 * DEPTH COUNTS STROKES (Ek, 2026-09-23), cursor and eraser alike. It counted
 * buffers, which agreed for live takes and kept every sampler stroke at depth
 * 1, since they share one file — the sampler check is what catches it.
 */

const { launch } = require('./lib/rig');

async function run(rig) {
  let fails = 0;
  const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`); if (!ok) fails++; };
  const out = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const G = await import('./js/grain.js');
    const TK = await import('./js/take.js');
    const B = await import('./js/grain-worklet-bridge.js');
    const D2R = Math.PI / 180;
    const o = {};
    // Probing writes what it reads: keep what the app had and put it back.
    const KEEP = ['mouseInCanvas', 'eraseOldest', 'scanMuted', 'lensMode', 'lensReads', 'recencyN', 'grainKSeqMode', 'grainWalk',
                  'searchRadiusDeg', 'radiusFadeEnabled', 'radiusFadeCurve', 'liveRecBuffers'];
    const kept = Object.fromEntries(KEEP.map(k => [k, S[k]]));
    const keptParts = S.particles.slice(), keptTrigs = S.triggers.slice(), keptDwell = S.triggerParams.dwell;
    // A pinned cloud OWNS its material (grain.js _refreshCloudClaims), and one
    // still fading out under a live Out — a sweep suite ahead of this one moves
    // Settings › Pins — emptied every pool after it. No pins, no ramps, here.
    const keptSlots = S.commitSlots.slice(), keptIn = S.commitAttack, keptOut = S.commitRelease;
    S.commitAttack = 0; S.commitRelease = 0;
    try {
    S.liveRecBuffers = [{ buffer: TK.makeTake(new Float32Array(44100 * 8), 44100), liveBuffer: null, grainCursor: 0 }];
    let sid = 1000;
    const reset = () => {
      S.particles.length = 0; S.triggers.length = 0; S._openStrokes.clear();
      S.commitSlots = new Array(keptSlots.length).fill(null);
      S.scanMuted = false; S.lensMode = 'area'; S.lensReads = 'both'; S.recencyN = 0;
      S.grainKSeqMode = false; S.grainWalk = false;
      S.searchRadiusDeg = 10; S.triggerParams.dwell = 'oneshot'; S.radiusFadeEnabled = false;
      S._particleVersion++;
    };
    // n marks at lon = lonDeg (spread ±spreadDeg), each its own stroke unless given.
    const paint = ({ lonDeg, n = 5, spreadDeg = 0.5, trig = false, buf = 0, source = 'live', t0 = 0 }) => {
      const id = ++sid;
      for (let i = 0; i < n; i++) {
        const f = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
        const p = { lon: (lonDeg + f * spreadDeg) * D2R, lat: 0, strokeId: id, source,
                    liveBufferIdx: buf, sampleIndex: buf, grainStart: t0 + i * 0.05, grainDuration: 0.1 };
        if (trig) p.trig = true;
        G.stampCartesian(p); S.particles.push(p);
      }
      S._particleVersion++;
      return id;
    };
    const ids = pool => [...new Set(pool.map(p => p.strokeId))].sort();
    const pool = (opts = {}) => G.__testCandidatePool(0, 0, { k: 8, nearest: S.lensMode === 'nearest', ...opts });

    // ── radius ──
    reset();
    const a2 = paint({ lonDeg: 2 }), a5 = paint({ lonDeg: 5 }), a15 = paint({ lonDeg: 15 });
    o.radius = { got: ids(pool({ k: 0 })), want: [a2, a5].sort() };
    S.searchRadiusDeg = 20; o.radiusWide = { got: ids(pool({ k: 0 })), want: [a2, a5, a15].sort() };
    S.searchRadiusDeg = 0.1; o.radiusTiny = pool({ k: 0 }).length;

    // ── depth ──
    reset();
    const d = [1, 2, 3, 4].map(i => paint({ lonDeg: i, buf: 0 }));
    // every stroke on its own buffer, as live takes are
    S.particles.forEach(p => { p.liveBufferIdx = p.strokeId - d[0]; });
    S.recencyN = 2; o.depth2 = { got: ids(pool({ k: 0 })), want: [d[2], d[3]].sort() };
    S.recencyN = 1; o.depth1 = { got: ids(pool({ k: 0 })), want: [d[3]] };
    S.recencyN = 0; o.depthAll = ids(pool({ k: 0 })).length;
    // Depth is LOCAL: a newer stroke OUTSIDE the radius must not push these out.
    const far = paint({ lonDeg: 90 }); S.particles.filter(p => p.strokeId === far).forEach(p => { p.liveBufferIdx = 50; });
    S.recencyN = 1; o.depthLocal = { got: ids(pool({ k: 0 })), want: [d[3]] };
    // Depth over ONE shared buffer (sampler material, three strokes from one file).
    reset();
    const sm = [1, 2, 3].map(i => paint({ lonDeg: i, source: 'sample', buf: 0 }));
    S.recencyN = 1; o.depthSampler = { got: ids(pool({ k: 0 })), strokes: sm.length };

    // ── k and all ──
    reset();
    paint({ lonDeg: 0, n: 30, spreadDeg: 5 });
    o.k8 = { n: pool({ k: 8 }).length, elig: G.__testEligible() };
    const p8 = pool({ k: 8 }); const maxAng8 = Math.max(...p8.map(p => p._ang));
    const all30 = S.particles.filter(p => p._ang < 10 * D2R).map(p => p._ang).sort((a, b) => a - b);
    o.kNearestFirst = Math.abs(maxAng8 - all30[7]) < 1e-9;
    o.all = { n: pool({ k: 0 }).length, elig: G.__testEligible() };   // k = 0 is all
    o.kBigger = pool({ k: 99 }).length;

    // ── nearest ──
    reset();
    paint({ lonDeg: 40, n: 10, spreadDeg: 2 });
    S.lensMode = 'nearest';
    o.nearest = { n: pool({ k: 5 }).length, farOk: pool({ k: 5 }).every(p => p._ang > 30 * D2R) };
    o.nearestAll = pool({ k: 0 }).length;   // k = 0 under nearest: the whole sphere
    S.lensMode = 'area'; o.areaFar = pool({ k: 5 }).length;

    // ── scope / dwell grain / trig material ──
    reset();
    const gs = paint({ lonDeg: 1 }), ts = paint({ lonDeg: 2, trig: true });
    o.trigNeverGrain = { got: ids(pool()), want: [gs] };
    S.lensReads = 'tape';
    o.tapeOnlyShut = { n: pool().length, sounds: G.__testCursorSounds() };
    S.triggerParams.dwell = 'grain';
    o.tapeArrivalShut = pool().length;
    S._openStrokes.add(ts);
    o.tapeOpened = { got: ids(pool()), want: [ts], sounds: G.__testCursorSounds() };
    // a NEWER granular stroke and depth 1 must not hide the opened take
    const gNew = paint({ lonDeg: 1.5 }); S.particles.filter(p => p.strokeId === gNew).forEach(p => { p.liveBufferIdx = 3; });
    S.recencyN = 1; o.tapeOpenedDepth = { got: ids(pool()), want: [ts] };
    S.lensMode = 'nearest'; o.tapeOpenedNearest = { got: ids(pool()), want: [ts] };
    S.lensMode = 'area'; S.lensReads = 'both'; S.recencyN = 1;
    o.bothOpenedDepth = { got: ids(pool()) };   // opened take + newest granular
    // nearest, dwell grain, NOT opened: must stay shut (arrival)
    S._openStrokes.clear();
    S.lensMode = 'nearest'; o.nearestArrivalShut = !pool().some(p => p.strokeId === ts);
    S._openStrokes.add(ts);
    o.nearestOpened = pool().some(p => p.strokeId === ts);
    S.lensMode = 'area'; S.recencyN = 0;
    S.lensReads = 'grains'; o.grainsScopeOpened = pool().some(p => p.strokeId === ts);
    // leaving dwell grain closes everything
    S.lensReads = 'both'; S.triggerParams.dwell = 'oneshot';
    o.closedAgain = !pool().some(p => p.strokeId === ts);

    // ── walk ──
    reset(); paint({ lonDeg: 1 });
    S.grainWalk = true; o.walkArea = pool().length;
    S.lensMode = 'nearest'; o.walkNearest = pool().length;
    S.grainWalk = false; o.noWalkNearest = pool().length;
    // WET PAINT IS THE CURSOR'S, WALK OR NOT (2026-09-24): the stroke going
    // down sounds while it goes down; a finished stroke waits for a touch to
    // walk it; a take being recorded is not wet paint.
    {
      reset(); const dry = paint({ lonDeg: 1 });
      const keptPaint = [S.isPainting, S.isRecording, S.currentStrokeId, S._recordingTrigger];
      S.grainWalk = true; S.lensMode = 'area';
      const wet = paint({ lonDeg: 1 });
      S.isPainting = true; S.isRecording = true; S.currentStrokeId = wet; S._recordingTrigger = false;
      const p1 = pool(); o.wetWalkSounds = p1.length > 0 && p1.every(p => p.strokeId === wet) && G.__testCursorSounds();
      o.wetWalkDryOut = !p1.some(p => p.strokeId === dry);
      S._recordingTrigger = true; for (const p of S.particles) if (p.strokeId === wet) p.trig = true;
      o.wetTakeSilent = pool().length === 0;
      S._recordingTrigger = false; for (const p of S.particles) if (p.strokeId === wet) delete p.trig;
      S.isPainting = false; S.isRecording = false;
      o.liftedWalkSilent = pool().length === 0;
      [S.isPainting, S.isRecording, S.currentStrokeId, S._recordingTrigger] = keptPaint;
      S.grainWalk = false;
    }

    // ── cap ──
    reset(); paint({ lonDeg: 1 }); S.scanMuted = true; o.capSilent = !G.__testCursorSounds(); S.scanMuted = false;
    o.uncapSounds = G.__testCursorSounds();

    // ── erase depth counts strokes too ──
    {
      reset();
      const E = await import('./js/erase.js');
      const SP = await import('./js/sphere.js');
      // The eraser refuses to bite blind: no sensor and no mouse on the canvas
      // means a stale, invisible cursor (erase.js `_eraseTick`). Set it BEFORE
      // reading where the cursor is — it changes the answer.
      S.mouseInCanvas = true;
      const cur = SP.cursorLonLatNow();
      const es = [0, 1, 2].map(i => {
        const id = ++sid;
        for (let j = 0; j < 4; j++) {
          const p = { lon: cur.lon + j * 0.2 * D2R, lat: cur.lat, strokeId: id, source: 'sample', sampleIndex: 0,
                      grainStart: 0.1 * (i * 4 + j), grainDuration: 0.1 };
          G.stampCartesian(p); S.particles.push(p);
        }
        return id;
      });
      S._particleVersion++;
      S.recencyN = 1; S.searchRadiusDeg = 5; S.eraseOldest = false;
      E.startEraseStroke(); await new Promise(r => setTimeout(r, 200)); E.stopEraseStroke();
      o.eraseDepth = { left: ids(S.particles), want: [es[0], es[1]].sort() };
    }

    // ── the pin under dwell: grain takes the LOOP, not a cloud of the take ──
    {
      reset();
      const UP = await import('./js/ui-presets.js');
      const TR = await import('./js/trigger.js');
      const SP = await import('./js/sphere.js');
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      UP.clearAllCommits(); await sleep(100);
      S.mouseInCanvas = true;
      S.mousePixelX = S.canvas.width * 0.5; S.mousePixelY = S.canvas.height * 0.5;
      const cur = SP.cursorLonLatNow();
      const at = (id, trig, lonOff) => {
        for (let j = 0; j < 8; j++) {
          const p = { lon: cur.lon + (lonOff + j * 0.3) * D2R, lat: cur.lat, strokeId: id, source: 'live', liveBufferIdx: 0,
                      grainStart: 0.1 * j, grainDuration: 0.1 };
          if (trig) p.trig = true;
          G.stampCartesian(p); S.particles.push(p);
        }
        S._particleVersion++;
      };
      const take = ++sid; at(take, true, -1);
      TR.armTrigger(take);
      S.triggerParams.dwell = 'grain'; S._openStrokes.add(take);
      const press = async () => {
        S._cursorPool = G.__testCandidatePool(cur.lon, cur.lat); S._cursorPoolAt = performance.now();
        await S._pinTap(); await sleep(300);
        const kinds = S.commitSlots.filter(Boolean).map(c => c.type).sort();
        const clouds = S.commitSlots.map((c, i) => c?.type === 'cloud' ? i : -1).filter(i => i >= 0);
        const cloudTrig = clouds.some(i => (G.__testSeedPool(i) ?? []).some(p => p.trig));
        UP.clearAllCommits(); await sleep(150);
        return { kinds, cloudTrig };
      };
      o.pinOpenTake = await press();
      const grains = ++sid; at(grains, false, -0.5);
      o.pinTakeAndGrains = await press();
      S._openStrokes.clear();
    }

    // ── bridge: fade and step ──
    reset();
    await S._ensureWorkletForSample?.(S.liveRecBuffers[0].buffer);
    B.hotSwapSample(S.liveRecBuffers[0].buffer);
    // The worklet comes up on its own clock; under a loaded shared boot 200 ms
    // was not always enough and the tables read back empty (release 5.6 run).
    for (let t = 0; t < 40 && !(B.isWorkletGrainActive?.() && (B.getWorkletDiag?.()?.bufMapSize ?? 0) > 0); t++)
      await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 200));
    const older = paint({ lonDeg: 1, n: 3, spreadDeg: 0.2, t0: 3.0 });   // painted first, later in the buffer
    const newer = paint({ lonDeg: 3, n: 3, spreadDeg: 0.2, t0: 0.5 });   // painted second, earlier in the buffer
    S.particles.forEach((p, i) => { p._globalIdx = i; });
    S.grainOverrides.k = 0;   // all
    // The first posts after a shared boot can land before this take is mapped
    // (a loaded rig, suites ahead of this one): the tables read back empty.
    // Post until they do not, then measure — the measurement is one post.
    const post = () => { const pl = pool(); S._postWorkletCandidates?.(pl, 0, 0); return S._readBackCandidates?.() ?? []; };
    for (let t = 0; t < 30 && post().length === 0; t++) {
      B.hotSwapSample(S.liveRecBuffers[0].buffer);
      await new Promise(r => setTimeout(r, 150));
    }
    S.radiusFadeEnabled = false; o.fadeOff = post().map(r => +r.radiusFade.toFixed(3));
    S.radiusFadeEnabled = true; S.radiusFadeCurve = 0;
    o.fadeOn = post().map(r => ({ ang: +(S.particles[r.particleId]._ang / D2R).toFixed(2), g: +r.radiusFade.toFixed(3) }));
    S.lensMode = 'nearest'; o.fadeNearest = post().map(r => +r.radiusFade.toFixed(3)); S.lensMode = 'area';
    S.radiusFadeEnabled = false;
    S.grainKSeqMode = true;
    const rows = post().filter(r => r.region === 0).sort((a, b) => a.stepAt - b.stepAt);
    o.stepOrder = rows.map(r => S.particles[r.particleId].strokeId === older ? 'old' : 'new');
    o.stepIds = { older, newer };

    return o;
    } finally {
      S.particles.length = 0; S.particles.push(...keptParts);
      S.commitSlots = keptSlots; S.commitAttack = keptIn; S.commitRelease = keptOut;
      S.triggers.length = 0; S.triggers.push(...keptTrigs);
      S._openStrokes.clear(); S.triggerParams.dwell = keptDwell;
      Object.assign(S, kept); S._particleVersion++;
    }
  });
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check('radius: only marks inside it', eq(out.radius.got, out.radius.want));
  check('radius: widening takes the far stroke', eq(out.radiusWide.got, out.radiusWide.want));
  check('radius: a hair-thin radius reads nothing', out.radiusTiny === 0);
  check('depth 2: the two newest strokes', eq(out.depth2.got, out.depth2.want));
  check('depth 1: the newest', eq(out.depth1.got, out.depth1.want));
  check('depth all: every stroke', out.depthAll === 4);
  check('depth is local — a newer stroke outside the radius does not count', eq(out.depthLocal.got, out.depthLocal.want));
  check('depth over one sampler file counts strokes', out.depthSampler.got.length === 1, `got ${out.depthSampler.got.length} of ${out.depthSampler.strokes}`);
  check('erase, depth 1 over one sampler file: takes only the newest stroke', eq(out.eraseDepth.left, out.eraseDepth.want), JSON.stringify(out.eraseDepth));
  check('pin on an opened take (dwell: grain): the loop only, no cloud', JSON.stringify(out.pinOpenTake.kinds) === '["loop"]', JSON.stringify(out.pinOpenTake));
  check('pin on an opened take AND grain material: a loop and a cloud, the cloud without the take', JSON.stringify(out.pinTakeAndGrains.kinds) === '["cloud","loop"]' && !out.pinTakeAndGrains.cloudTrig, JSON.stringify(out.pinTakeAndGrains));
  check('k 8 of 30 in reach', out.k8.n === 8 && out.k8.elig === 30, JSON.stringify(out.k8));
  check('k keeps the NEAREST 8', out.kNearestFirst);
  check('all: every mark, k ignored', out.all.n === 30 && out.all.elig === 30);
  check('k 99 > reach: takes all 30', out.kBigger === 30);
  check('nearest: k closest anywhere, radius ignored', out.nearest.n === 5 && out.nearest.farOk);
  check('nearest: k 0 is all — the whole sphere', out.nearestAll === 10, String(out.nearestAll));
  check('area: nothing when the marks are far', out.areaFar === 0);
  check('tape material is never grain material', eq(out.trigNeverGrain.got, out.trigNeverGrain.want));
  check('scope tape, nothing opened: empty and silent', out.tapeOnlyShut.n === 0 && !out.tapeOnlyShut.sounds);
  check('scope tape, dwell grain, arrival: still shut', out.tapeArrivalShut === 0);
  check('scope tape, opened: reads the take and sounds', eq(out.tapeOpened.got, out.tapeOpened.want) && out.tapeOpened.sounds);
  check('scope tape: depth never hides the opened take', eq(out.tapeOpenedDepth.got, out.tapeOpenedDepth.want));
  check('scope tape in nearest: still only the opened take', eq(out.tapeOpenedNearest.got, out.tapeOpenedNearest.want));
  check('scope both, depth 1: the opened take + the newest grain stroke', out.bothOpenedDepth.got.length === 2 && !out.bothOpenedDepth.got.includes(1014), JSON.stringify(out.bothOpenedDepth.got));
  check('nearest, dwell grain, arrival: shut until played through', out.nearestArrivalShut);
  check('nearest, dwell grain, opened: reads it', out.nearestOpened);
  check('scope grains: an opened take still granulates', out.grainsScopeOpened);
  check('leaving dwell grain closes the take', out.closedAgain);
  check('walk: the cursor reads nothing of its own (area)', out.walkArea === 0);
  check('walk: …nor in nearest', out.walkNearest === 0);
  check('no walk, nearest: reads', out.noWalkNearest > 0);
  check('walk: the stroke being painted sounds, and only it', out.wetWalkSounds && out.wetWalkDryOut);
  check('walk: a take being recorded is not wet paint', out.wetTakeSilent);
  check('walk: lifted, the cursor reads nothing of its own again', out.liftedWalkSilent);
  check('cap: silent', out.capSilent);
  check('uncapped: sounds', out.uncapSounds);
  check('fade off: every gain 1', out.fadeOff.length > 0 && out.fadeOff.every(g => g === 1));
  check('fade on: gain falls with distance', out.fadeOn.length > 1 && out.fadeOn.every(r => Math.abs(r.g - (1 - r.ang / 10)) < 0.01), JSON.stringify(out.fadeOn));
  check('fade in nearest: off', out.fadeNearest.every(g => g === 1));
  check('step: the older stroke plays first', eq(out.stepOrder, ['old', 'old', 'old', 'new', 'new', 'new']), JSON.stringify(out.stepOrder));
  check('no renderer errors', rig.errors().length === 0, rig.errors().join(' | '));
  return fails;
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    const rig = await launch();
    let bad = 1;
    try { bad = await run(rig); } finally { await rig.close(); }
    console.log(bad ? `\n${bad} failed` : '\nall passed');
    process.exit(bad ? 1 : 0);
  })().catch(e => { console.error('FATAL', e.message); process.exit(1); });
}
