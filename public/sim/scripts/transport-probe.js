// transport-probe.js — the two audio hops under load, in numbers (2026-09-06).
//
// Launches a private instance, paints 3000 wet marks under the cursor, and
// counts the transport faults (S.transportDiag: outDry, outDropped, inDry,
// inSkipped) over seven phases: the cushion at 20 and 10 ms, an ~800 msg/s
// OSC sensor flood through the main process, and the engine at full load
// (256-grain pool, the lens in "all" mode). A fault is a hole or a click that
// played. Run by hand when the cushion default, the main process's load or
// the worklet's inner loop is in question (docs/PERFORMANCE-AUDIT-2026-09.md):
//
//   MUBONE_RIG_INSTANCE=<name> MUBONE_RIG_PORT=7597 node scripts/transport-probe.js
//
// The flood is sent to MUBONE_RIG_PORT (7599 by default) and moves the cursor:
// the phases after the flood may read an idle engine (kCount 0) because the
// cursor was left pointing away from the marks — the cushion-20 stress phase
// is best read from a run with the flood phases removed.
const rig = require('./lib/rig.js');
const dgram = require('dgram');
const OSC_PORT = Number(process.env.MUBONE_RIG_PORT) || 7599;
// MUBONE_PROBE_FRAMES=64 boots the instance at that RtAudio buffer size (the
// setting is read at boot; a running stream is not reopened — CoreAudio's HAL
// crashes on repeated close/open), so the probe saves it and reloads once.
const PROBE_FRAMES = Number(process.env.MUBONE_PROBE_FRAMES) || 0;

function oscPacket(addr, floats) {
  const pad = s => { const b = Buffer.from(s + '\0'); const n = Math.ceil(b.length / 4) * 4; return Buffer.concat([b, Buffer.alloc(n - b.length)]); };
  const body = Buffer.alloc(4 * floats.length);
  floats.forEach((v, i) => body.writeFloatBE(v, i * 4));
  return Buffer.concat([pad(addr), pad(',' + 'f'.repeat(floats.length)), body]);
}
let floodTimer = null, floodSock = null, floodCount = 0;
function startFlood() {
  floodSock = dgram.createSocket('udp4');
  let t = 0;
  floodTimer = setInterval(() => {
    // Two packets a tick at ~2.5 ms: quaternion and an accelerometer line, ~800 msgs/s like a busy x-imu3.
    t += 0.0025;
    const a = t * 0.3, q = [Math.cos(a / 2), 0, Math.sin(a / 2), 0];
    floodSock.send(oscPacket('/sensor/x/quaternion', q), OSC_PORT, '127.0.0.1');
    floodSock.send(oscPacket('/sensor/x/accel', [Math.sin(t), Math.cos(t), 9.8]), OSC_PORT, '127.0.0.1');
    floodCount += 2;
  }, 2);
}
function stopFlood() { clearInterval(floodTimer); floodTimer = null; try { floodSock.close(); } catch (_) {} const n = floodCount; floodCount = 0; return n; }

(async () => {
  const app = await rig.launch({ oscPort: OSC_PORT });
  try {
    if (PROBE_FRAMES) {
      await app.evaluate(async ({ f }) => { localStorage.setItem('mubone_bufferSize', String(f)); location.reload(); }, { f: PROBE_FRAMES });
      await new Promise(r => setTimeout(r, 7000));   // the scheduler stays live: the scene needs it
    }
    const setup = await app.evaluate(async ({ N }) => {
      const { S, perf } = await import('./js/state.js');
      const B  = await import('./js/grain-worklet-bridge.js');
      const SP = await import('./js/sphere.js');
      const US = await import('./js/ui-samples.js');
      const G  = await import('./js/grain.js');
      const L  = await import('./js/latency.js');
      const actx = S.audioCtx;
      const d = new Float32Array(actx.sampleRate * 4);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.3;
      const buf = (await import('./js/take.js')).makeTake(d, actx.sampleRate);
      S.samples.push({ buffer: buf, name: 'perf-noise', duration: 4, grainCursor: 0, cropStart: 0, cropEnd: 1 });
      const idx = S.samples.length - 1;
      await S._ensureWorkletForSample?.(buf);
      B.hotSwapSample(buf);
      S.samplerIndex = idx;
      S._paletteTap?.(2);
      S._setWet?.(true);
      S.scanMuted = false; S.nearestMode = false; S.searchRadiusDeg = 12; S.recencyN = 0;
      const cur = SP.getCursorLonLat();
      US.recordStrokeStart('sample', -1);
      const vo = S.currentVoicing, r = 6 * Math.PI / 180;
      for (let i = 0; i < N; i++) {
        const a = i * 2.399, rr = r * Math.sqrt(i / N);
        const p = { lon: cur.lon + rr * Math.cos(a), lat: cur.lat + rr * Math.sin(a), strokeId: S.currentStrokeId, _vo: vo, source: 'sample', sampleIndex: idx, grainStart: 3.5 * (i / N), grainDuration: 0.1, color: '#ffb060', rms: 0.3, centroid: 2000, zcr: 0.1 };
        G.stampCartesian(p); S.particles.push(p);
      }
      S._particleVersion = (S._particleVersion || 0) + 1;
      let rep = null; try { rep = await window.electronBridge.getStreamLatency(); } catch (_) {}
      const est = rep ? L.estimateFrom({ ...rep, rate: rep.rate ?? actx.sampleRate, cushionS: (S.audioCushionMs ?? 20) / 1000, baseLatency: actx.baseLatency, outputLatency: actx.outputLatency, electron: true }) : null;
      return { sr: actx.sampleRate, bufFrames: S.preferredBufferSize, cushion: S.audioCushionMs, streams: rep, estimate: est, latency: S.latency, baseLatency: actx.baseLatency, outputLatency: actx.outputLatency, particles: S.particles.length };
    }, { N: 3000 });
    console.log('setup', JSON.stringify(setup));

    const phase = async (label, opts) => {
      const { cushion, stress, calm, seconds = 24 } = opts;
      await app.evaluate(async ({ cushion, stress, calm }) => {
        const { S } = await import('./js/state.js');
        if (cushion) S._setAudioCushion(cushion);
        const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
        if (stress) { set('gcDurSlider', 1000); set('gcPeriodSlider', 0); S.grainKAllMode = true; }
        if (calm)   { set('gcDurSlider', 772); set('gcPeriodSlider', 501); S.grainKAllMode = false; }
        await new Promise(r => setTimeout(r, 2500));   // settle after the change
      }, { cushion, stress, calm });
      const acc = { outDry: 0, outDropped: 0, inDry: 0, inSkipped: 0, inOverflow: 0, active: [], drift: [], depth: [], fill: [], kCount: 0, gaps10: 0, gaps20: 0, gapMax: 0, load: [], procMax: 0, chunkAllocs: 0, throttled: 0, steals: 0, loadShortMax: 0, hostHolders: new Set(), mainHolders: new Set() };
      const slices = Math.ceil(seconds / 8);
      for (let k = 0; k < slices; k++) {
        const r = await app.evaluate(async () => {
          const { S, perf } = await import('./js/state.js');
          const wait = ms => new Promise(r => setTimeout(r, ms));
          const sr = S.audioCtx?.sampleRate ?? 48000;
          const B = await import('./js/grain-worklet-bridge.js');
          const t0 = { ...S.transportDiag };
          const act = [], drift = [], depth = [], fill = [], load = [];
          let kCount = 0, gapMax = 0, procMax = 0, allocs = 0, throttled = 0, steals = 0, loadShortMax = 0;
          for (let i = 0; i < 16; i++) {
            await wait(500); act.push(perf.activeNodes); drift.push(perf.schedulerMax); kCount = Math.max(kCount, perf.kCount);
            const d = await window.electronBridge.getOutputDepth(true);   // arm the loop probes (P1) depth.push(+(d.frames / sr * 1000).toFixed(1)); fill.push(+S.transportDiag.inFillMs.toFixed(1));
            if (d.loopGapMaxMs > gapMax) gapMax = d.loopGapMaxMs;
            const wd = B.getWorkletDiag()?.workletDiag || {}; load.push(wd.loadPct | 0); if ((wd.procMaxMs | 0) > procMax) procMax = wd.procMaxMs | 0; allocs += wd.chunkAllocs | 0;
            // What the throttle did, and on what signal (P3).
            throttled += wd.throttled | 0; steals += wd.steals | 0;
            if ((wd.loadShort || 0) > loadShortMax) loadShortMax = wd.loadShort;
          }
          const t1 = S.transportDiag;
          // WHO held each loop in this slice: the running holder tables
          // ([name, maxMs, over10] ×8), so a stall has a name (#346).
          const holders = tab => (tab || []).filter(h => h && h[1] >= 10).map(h => `${h[0]} ${h[1]}ms×${h[2]}`);
          return { hostHolders: holders(t1.hostSlow), mainHolders: holders(t1.mainSlow), outDry: t1.outDry - t0.outDry, outDropped: t1.outDropped - t0.outDropped, inDry: t1.inDry - t0.inDry, inSkipped: t1.inSkipped - t0.inSkipped, inOverflow: t1.inOverflow - t0.inOverflow, act, drift, depth, fill, kCount,
                   gaps10: t1.hostGaps10 - t0.hostGaps10, gaps20: t1.hostGaps20 - t0.hostGaps20, gapMax, load, procMax, allocs, throttled, steals, loadShortMax, browserGaps20: t1.mainGaps20 - t0.mainGaps20 };
        });
        acc.outDry += r.outDry; acc.outDropped += r.outDropped; acc.inDry += r.inDry; acc.inSkipped += r.inSkipped; acc.inOverflow += r.inOverflow;
        acc.active.push(...r.act); acc.drift.push(...r.drift); acc.depth.push(...r.depth); acc.fill.push(...r.fill); acc.kCount = Math.max(acc.kCount, r.kCount);
        acc.throttled += r.throttled; acc.steals += r.steals; acc.loadShortMax = Math.max(acc.loadShortMax, r.loadShortMax);
        for (const h of r.hostHolders) acc.hostHolders.add(h); for (const h of r.mainHolders) acc.mainHolders.add(h);
        acc.gaps10 += r.gaps10; acc.gaps20 += r.gaps20; acc.browserGaps20 = (acc.browserGaps20 || 0) + r.browserGaps20; acc.gapMax = Math.max(acc.gapMax, r.gapMax); acc.load.push(...r.load); acc.procMax = Math.max(acc.procMax, r.procMax); acc.chunkAllocs += r.allocs;
      }
      const mean = a => +(a.reduce((p, q) => p + q, 0) / a.length).toFixed(1), max = a => Math.max(...a), min = a => Math.min(...a);
      console.log(JSON.stringify({ label, seconds: slices * 8, outDry: acc.outDry, outDropped: acc.outDropped, inDry: acc.inDry, inSkipped: acc.inSkipped, inOverflow: acc.inOverflow,
        hostGaps: { over10: acc.gaps10, over20: acc.gaps20, maxMs: acc.gapMax, holders: [...acc.hostHolders] }, browserGaps20: acc.browserGaps20, mainHolders: [...acc.mainHolders], audioThread: { loadPct: { mean: mean(acc.load), max: max(acc.load) }, longestBlockMs: acc.procMax, chunkAllocs: acc.chunkAllocs },
        active: { mean: mean(acc.active), max: max(acc.active) }, schedMaxMs: max(acc.drift), kCount: acc.kCount,
        throttle: { onsetsSkipped: acc.throttled, steals: acc.steals, loadShortMax: acc.loadShortMax },
        depthMs: { min: min(acc.depth), mean: mean(acc.depth), max: max(acc.depth) }, fillMs: { min: min(acc.fill), mean: mean(acc.fill), max: max(acc.fill) } }));
    };

    await phase('cushion 20, idle engine', { cushion: 20, calm: true });
    await phase('cushion 10, idle engine', { cushion: 10 });
    startFlood();
    await phase('cushion 10, OSC flood ~800 msg/s', { cushion: 10 });
    await phase('cushion 10, flood + full pool + lens all', { cushion: 10, stress: true });
    const n1 = stopFlood();
    console.log('flood sent', n1);
    await phase('cushion 10, full pool + lens all, no flood', { cushion: 10 });
    await phase('cushion 20, full pool + lens all', { cushion: 20 });
    await phase('cushion 20, idle again', { cushion: 20, calm: true, seconds: 16 });
    const errs = app.errors ? app.errors() : [];
    if (errs.length) console.log('errors', JSON.stringify(errs).slice(0, 1500));
  } finally { if (floodTimer) stopFlood(); await app.close(); }
})().catch(e => { console.error(e); process.exit(1); });
