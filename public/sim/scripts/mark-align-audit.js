#!/usr/bin/env node
/**
 * mark-align-audit.js — does a live mark's SIZE describe the audio its grain
 * plays?
 *
 *     node scripts/mark-align-audit.js        # own Electron instance
 *     node scripts/rig-audit.js align         # as one of the rig suites
 *
 * WHY. A mark's loudness used to look BACKWARD — a peak-hold filled by the
 * render loop and emptied at each deposit — while its grain plays FORWARD
 * from the mark. Measured 2026-09-02 with 60 ms bursts at a 50 ms deposit: the
 * mark whose grain held the burst read 0.02, the mark one or two later read
 * 0.64, and the best correlation between stored size and the take's envelope
 * sat at −80 ms. Ek's report was "the louder one is one or two beside the one
 * I am highlighting". Deposit-one-behind (paint-ticker.js) fixed it; this is
 * what keeps it fixed.
 *
 * WHAT. An oscillator stands in for the interface. A stroke paints while the
 * tone carries five loud 60 ms bursts at known times; the sealed take is
 * scanned for where each burst actually sits, and for each burst the suite
 * asks: is the mark whose grain covers the onset the loudest mark in its
 * neighbourhood, and are marks whose window cannot contain the burst small?
 * Run at TWO deposit rates, because the fix's whole claim is that the rate
 * does not matter — the old code was wrong at every rate, by about one mark.
 *
 * Exits non-zero on failure.
 */

const { launch } = require('./lib/rig');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else      { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// brush: { duration, fadeRatio } set through the live overrides before the
// stroke starts, so the stroke freezes them. expectedOffsetS is asserted
// against grainPeakOffsetS as well as used to place each mark's point.
async function measure(rig, intervalMs, brush) {
  return rig.evaluate(async ({ intervalMs, brush }) => {
    const A = await import('./js/audio.js');
    const { S } = await import('./js/state.js');
    const BV = await import('./js/brush-voicing.js');
    S.grainOverrides.duration  = brush.duration;
    S.grainOverrides.fadeRatio = brush.fadeRatio;
    // A scratch stroke, whatever the armed tile's 'on end' says: a stroke
    // ending as a cloud would re-read its own marks under the loudness hold.
    S._setGrainOnEnd?.('scratch');
    S.grainOverrides.pitchShift = 0;
    S.grainCurveType = 'hann';
    S.grainDirection = 'fwd';
    const peakOffsetS = BV.grainPeakOffsetS(BV.resolveGrainParams());
    const actx = A.ensureAudioContext();
    if (!S.inputGainNode) S.inputGainNode = actx.createGain();
    if (!S.inputAnalyser) { S.inputAnalyser = actx.createAnalyser(); S.inputAnalyser.fftSize = 256; S.inputGainNode.connect(S.inputAnalyser); }
    const osc = actx.createOscillator(); osc.frequency.value = 440;
    const g = actx.createGain(); g.gain.value = 0.03;
    osc.connect(g); g.connect(S.inputGainNode); osc.start();
    window._rtAudioInputListening = true;
    S.paintGateThreshold = 0;
    S.paintTicker.intervalMs = intervalMs;
    await new Promise(r => setTimeout(r, 200));

    const STROKE = 424242 + intervalMs;
    const bursts = [0.3, 0.7, 1.1, 1.5, 1.9];
    const t0 = actx.currentTime + 0.05;
    for (const b of bursts) { g.gain.setValueAtTime(0.9, t0 + b); g.gain.setValueAtTime(0.03, t0 + b + 0.06); }
    A.startLiveRecording();
    if (!S.isRecording) return { error: 'recording did not start' };
    S.currentStrokeId = STROKE;
    S.isPainting = true;
    // WATCH THE REAL FRAME CADENCE. A live mark's level is folded in per
    // RENDER FRAME, so the end of its window is quantised to whatever the
    // renderer is actually managing — not to the nominal 30 fps. Under load
    // (a full rig run, several Electron instances) frames stretch, and a
    // margin hardcoded for 33 ms stops describing the machine it runs on.
    let frameMaxS = 0, _fPrev = performance.now(), _fStop = false;
    const _fTick = () => {
      const now = performance.now();
      frameMaxS = Math.max(frameMaxS, (now - _fPrev) / 1000);
      _fPrev = now;
      if (!_fStop) requestAnimationFrame(_fTick);
    };
    requestAnimationFrame(_fTick);
    await new Promise(r => setTimeout(r, 2300));
    _fStop = true;
    S.isPainting = false;
    S.currentStrokeId = -1;
    A.stopLiveRecording();
    await new Promise(res => A.whenSealed(res));
    osc.stop();
    try { g.disconnect(); } catch (_) {}

    const slot = S.liveRecBuffers[S.liveRecBuffers.length - 1];
    const buf = slot?.buffer;
    if (!buf) return { error: 'no sealed take' };
    const x = buf.getChannelData(0), sr = buf.sampleRate;
    // A mark stores its MOMENT (grainStart); the bridge starts the grain
    // peakOffsetS earlier. Post this stroke's marks through the bridge the
    // way the scheduler does and read back the offsets it produced. (Posted
    // explicitly: the ticker places marks from the mouse position while the
    // scheduler reads the camera cursor, so the natural pool may be empty.)
    const { getWorkletDiag } = await import('./js/grain-worklet-bridge.js');
    const strokeMarks = S.particles.filter(p => p.strokeId === STROKE);
    await new Promise(r => setTimeout(r, 60));            // let the scheduler stamp _globalIdx
    S._postWorkletCandidates?.(strokeMarks, strokeMarks[0]?.lon ?? 0, strokeMarks[0]?.lat ?? 0);
    const posted = getWorkletDiag()?.candidates ?? [];
    let postedChecked = 0, postedWrong = 0;
    for (const c of posted) {
      const p = S.particles[c.particleId];
      if (!p || p.strokeId !== STROKE) continue;
      postedChecked++;
      const expect = Math.max(0, p.grainStart - peakOffsetS);
      if (Math.abs(c.offset / sr - expect) > 0.002) postedWrong++;
    }
    const marks = S.particles.filter(p => p.strokeId === STROKE)
      .map(p => ({ start: p.grainStart, t: p.grainStart, rms: p.rms ?? 0 })).sort((a, b) => a.t - b.t);

    // Burst onsets in the take: first sample over 0.5 after 100 ms of quiet.
    const onsets = [];
    let quietRun = sr;
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]);
      if (a > 0.5) { if (quietRun > sr * 0.1) onsets.push(i / sr); quietRun = 0; }
      else quietRun++;
    }
    const iv = intervalMs / 1000;
    const per = onsets.map(on => {
      // 5 ms of slack: the deposit clock and the audio clock are read a few
      // ms apart, and a mark can land on the same millisecond as a burst.
      const covering = marks.filter(m => m.t <= on + 0.005 && on < m.t + iv).pop() ?? null;
      const near = marks.filter(m => Math.abs(m.t - on) < 0.25);
      const loudest = near.reduce((a, b) => (b.rms > (a?.rms ?? -1) ? b : a), null);
      // Marks whose window ends before the burst starts, or starts after it ends.
      // A live mark's level is the loudness folded in per RENDER FRAME between
      // its capture and the next mark's settle (audio-features.js
      // consumeWindowLoudness / tickPeakHold), so its window's real end is
      // quantised to a frame: a mark whose nominal window ended 5 ms before the
      // burst still folded the onset in (#337, 2026-09-05: 0.113 / 0.117 against
      // a 0.1 ceiling). "Far" therefore means a frame clear of the burst, not
      // 5 ms — and the FRAME IS MEASURED, not assumed. It was 40 ms flat, which
      // is two frames at 30 fps and is right on an idle machine; inside a full
      // rig run frames stretch and marks 40 ms clear were still folding the
      // burst in, reading 0.164 (2026-09-13). One slow frame either side of the
      // longest one actually seen, floored at the old 40 ms.
      const margin = Math.max(0.040, frameMaxS * 2);
      // AND NOT A NEIGHBOUR OF THE COVERING MARK. The burst is 60 ms and the
      // deposit grid here is 50 ms, so a burst ALWAYS spans two marks and
      // sometimes three: whichever mark the grid happens to put either side of
      // the covering one can legitimately hold part of the same burst, and
      // whether it does is a matter of where the grid lands that run. That is
      // what made this check intermittent — a neighbour holding a partial fold
      // read 0.147 / 0.164 / 0.177 against a 0.1 ceiling on some runs and 0.021
      // on others, while the covering mark was 0.63 every time. The property
      // under test is that a mark which CANNOT have heard the burst is quiet,
      // so the marks that could have are excluded by construction rather than
      // by a margin that has to be widened every time the machine is busier.
      const ci = covering ? marks.indexOf(covering) : -1;
      const neighbour = m => ci >= 0 && Math.abs(marks.indexOf(m) - ci) <= 1;
      const far = near.filter(m => !neighbour(m)
                                && (m.t + iv < on - margin || m.t > on + 0.06 + 0.005));
      return {
        on: +on.toFixed(3),
        coveringAt: covering ? +covering.t.toFixed(3) : null,
        coveringRms: covering ? +covering.rms.toFixed(3) : null,
        loudestAt: loudest ? +loudest.t.toFixed(3) : null,
        loudestRms: loudest ? +loudest.rms.toFixed(3) : null,
        farMax: far.length ? +Math.max(...far.map(m => m.rms)).toFixed(3) : 0,
      };
    });
    return { sr, takeSec: +buf.duration.toFixed(3), marks: marks.length, onsets: onsets.length, per,
             frameMaxMs: +(frameMaxS * 1000).toFixed(1),
             peakOffsetMs: +(peakOffsetS * 1000).toFixed(1), postedChecked, postedWrong };
  }, { intervalMs, brush });
}

async function run(rig) {
  const cases = [
    // A 300 ms Hann: the mark is the CENTRE of its grain, 150 ms after the start.
    { iv: 50,  brush: { duration: 0.3,  fadeRatio: 0.5 }, expectMs: 150 },
    // A 50 ms grain at a 120 ms deposit: point 25 ms in; rate independence.
    { iv: 120, brush: { duration: 0.05, fadeRatio: 0.5 }, expectMs: 25 },
    // A short attack: the point is the start of the sustain, 30 ms in.
    { iv: 50,  brush: { duration: 0.3,  fadeRatio: 0.1 }, expectMs: 30 },
  ];
  for (const { iv, brush, expectMs } of cases) {
    console.log(`\n§ deposit every ${iv} ms · grain ${brush.duration * 1000} ms, fade ratio ${brush.fadeRatio}`);
    const r = await measure(rig, iv, brush);
    if (r.error) { check(`measurement at ${iv} ms`, false, r.error); continue; }
    check(`grain starts ${expectMs} ms before its mark`, Math.abs(r.peakOffsetMs - expectMs) < 0.5, `${r.peakOffsetMs} ms`);
    check(`the bridge posts every candidate that much early`, r.postedChecked > 0 && r.postedWrong === 0, `${r.postedWrong} of ${r.postedChecked} wrong`);
    check(`five bursts found in the take`, r.onsets === 5, `${r.onsets} onsets, take ${r.takeSec}s, ${r.marks} marks`);
    console.log(`       longest render frame during the take: ${r.frameMaxMs} ms — "far" is ${Math.max(40, r.frameMaxMs * 2).toFixed(0)} ms`);
    for (const b of r.per) {
      const tag = `burst at ${b.on}s`;
      check(`${tag}: a mark's window covers it`, b.coveringAt != null, JSON.stringify(b));
      if (b.coveringAt == null) continue;
      check(`${tag}: the covering mark is loud`, b.coveringRms > 0.4, `covering ${b.coveringRms}`);
      check(`${tag}: no mark is louder than the one that plays it`, b.loudestRms <= b.coveringRms + 0.05,
            `loudest ${b.loudestRms} at ${b.loudestAt}, covering ${b.coveringRms} at ${b.coveringAt}`);
      check(`${tag}: marks that cannot contain it stay small`, b.farMax < 0.1, `far max ${b.farMax}`);
    }
    await rig.reload();
  }
  check('no renderer errors after exercise', rig.errors().length === 0, rig.errors().join(' | '));
  console.log(`\n${pass} ok · ${fail} failed`);
  return fail;
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    const rig = await launch();
    let f = 1;
    try { f = await run(rig); } finally { await rig.close(); }
    process.exit(f ? 1 : 0);
  })().catch(e => { console.error(e); process.exit(1); });
}
