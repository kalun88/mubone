#!/usr/bin/env node
/**
 * scripts/live-loop-audit.js — checks for the #209 live-loop prototype
 * (js/live-loop.js + js/worklets/live-loop.worklet.js): a loop that plays
 * while it is still being written. The `1`+`Q` gesture from
 * docs/archive/BRUSH-MODEL.md § 3c v3b.
 *
 * Runs against a real Electron instance via scripts/lib/rig.js. NOT part of
 * rig-audit.js: the scenarios are real-time audio (a loop has to actually
 * wrap), so the suite is wall-clock bound at ~15 s of playback rather than
 * evaluate-speed bound. Run it whenever the worklet or its wrap rule changes:
 *   node scripts/live-loop-audit.js
 *
 * Input is a 220 Hz oscillator, not the mic — deterministic, needs no device,
 * and makes the seam measurable: a sine's per-sample delta is bounded
 * (2π·220/48000·0.5 ≈ 0.014), so any unfaded wrap shows up as a step far above
 * it. 220 Hz at 48 kHz is ~218.2 samples per period, so a loop end landing on
 * a whole period — which would hide a missing crossfade — is unlikely, and the
 * pass lengths here (arbitrary message timing) never do.
 *
 * What it covers:
 *  A. Boot — worklet loads on the rig, context running.
 *  B. Grow — the wrap rule: loop end advances AT the wrap, monotonically, to
 *     the write frontier; the loop grows pass over pass. This is the design
 *     decision (a continuously-tracked end never wraps at 1×) and the check
 *     that defends it.
 *  C. Seam — every wrap in the captured output is click-free: max per-sample
 *     step in a ±5 ms window around each seam stays within a small multiple of
 *     the sine's natural delta.
 *  D. Close — releasing the gesture freezes the frontier, the loop settles at
 *     the full stroke length, and keeps looping at that length.
 *  E. Stop — playback actually stops.
 *  F. Simultaneous press — `1`+`Q` in the same instant: no material yet, so
 *     the first pass waits for the minimum and starts on its own.
 *  G. Speed — read head can never pass the write frontier, even at 2×.
 *  H. Growth — a take that outgrows the initial allocation grows amortised
 *     (the 30-second answer: nothing special happens, the buffer doubles and
 *     the loop gets long; the ceiling at integration is recLimitSeconds).
 *
 * Exits non-zero on failure.
 */

const { launch, attach } = require('./lib/rig');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else      { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(rig) {
  // ── A. Boot ───────────────────────────────────────────────────────────────
  console.log('\n§ A. boot');
  const boot = await rig.evaluate(async () => {
    const { createLiveLoop } = await import('./js/live-loop.js');
    const { ensureAudioContext } = await import('./js/audio.js');
    const actx = ensureAudioContext();
    if (actx.state !== 'running') await actx.resume();

    // Deterministic input; silent output (gain 0) — capture happens inside
    // the worklet, so nothing needs to reach a speaker.
    const osc  = actx.createOscillator();
    osc.frequency.value = 220;
    const oscGain = actx.createGain();
    oscGain.gain.value = 0.5;
    osc.connect(oscGain);
    osc.start();

    window.__llosc = oscGain;
    window.__ll = await createLiveLoop({
      input: oscGain, capture: true, gain: 0, minLoopS: 0.5, xfadeS: 0.030,
    });
    const st = await window.__ll.getState();
    return { ctxState: actx.state, sampleRate: st.sampleRate, writePos: st.writePos };
  });
  check('AudioContext running', boot.ctxState === 'running', boot.ctxState);
  check('worklet responds to state requests', typeof boot.sampleRate === 'number' && boot.sampleRate > 0);
  const SR = boot.sampleRate;

  // ── B. Grow ───────────────────────────────────────────────────────────────
  // `1` down for 700 ms, then `Q` down: loop the stroke so far, keep painting.
  console.log('\n§ B. grow — the wrap rule');
  // Timing note: each bridge round trip adds ~300 ms, so the "0.7 s" of
  // material at Q-press is really 1.0–1.5 s, and pass lengths grow (pass N+1
  // spans everything written during pass N). Two wraps of a ~1.4 s first pass
  // therefore need ~4.5 s of playback — hence the long sleep, and why the
  // assertions below are structural (event chain) rather than wall-clock.
  await rig.evaluate(() => { window.__ll.record(); });
  await sleep(700);
  await rig.evaluate(() => { window.__ll.loop(); });
  await sleep(5000);
  const b = await rig.evaluate(async () => await window.__ll.getState());

  check('recording advanced the frontier', b.writePos > SR * 4.5, `writePos ${b.writePos}`);
  check('at least two wraps', b.wrapCount >= 2, `wrapCount ${b.wrapCount}`);
  check('loop end grew past the first pass', b.loopEnd > SR * 1.0, `loopEnd ${b.loopEnd}`);
  check('read head never passed the frontier', b.readAheadViolations === 0, `${b.readAheadViolations} violations`);
  check('no reallocation inside the initial 16 s', b.allocCount === 0, `allocCount ${b.allocCount}`);

  const d1 = await rig.evaluate(async () => {
    const d = await window.__ll.dump();
    // Seam analysis in the renderer — the capture is too big for the bridge.
    // For each wrap: max per-sample step in a ±5 ms window, against a control
    // window well away from any seam.
    const cap = d.cap, W = Math.round(0.005 * 48000);
    const seams = d.wrapEvents.map(ev => {
      let mx = 0;
      const a = Math.max(1, ev.cap - W), z = Math.min(cap.length, ev.cap + W);
      for (let i = a; i < z; i++) mx = Math.max(mx, Math.abs(cap[i] - cap[i - 1]));
      return { cap: ev.cap, from: ev.from, to: ev.to, maxStep: mx };
    });
    // Control: a window centred between the first two seams (mid-pass).
    let control = 0;
    if (d.wrapEvents.length >= 2) {
      const mid = Math.round((d.wrapEvents[0].cap + d.wrapEvents[1].cap) / 2);
      for (let i = Math.max(1, mid - W); i < Math.min(cap.length, mid + W); i++) {
        control = Math.max(control, Math.abs(cap[i] - cap[i - 1]));
      }
    }
    // RMS of a mid-pass window — proves real material is playing, not zeros.
    let rms = 0, n = 0;
    const r0 = d.wrapEvents.length ? Math.max(0, d.wrapEvents[0].cap - 4800) : 0;
    for (let i = r0; i < Math.min(cap.length, r0 + 4800); i++) { rms += cap[i] * cap[i]; n++; }
    rms = Math.sqrt(rms / Math.max(1, n));
    return { seams, control, rms, capLen: cap.length };
  });

  check('wrap events recorded', d1.seams.length >= 2, `${d1.seams.length}`);
  check('loop end monotonic across wraps', d1.seams.every(s => s.to >= s.from));
  check('each wrap advanced the end to the frontier',
    d1.seams.slice(0, -1).every((s, i) => d1.seams[i + 1].from === s.to),
    JSON.stringify(d1.seams.map(s => [s.from, s.to])));
  const firstPass = d1.seams[0] ? d1.seams[0].from / SR : 0;
  check('first pass ≈ material at Q-press (0.5–1.8 s)', firstPass > 0.5 && firstPass < 1.8, `${firstPass.toFixed(2)} s`);
  check('playback carries real material (RMS > 0.1)', d1.rms > 0.1, `rms ${d1.rms.toFixed(3)}`);

  // ── C. Seam ───────────────────────────────────────────────────────────────
  console.log('\n§ C. seam — every wrap is click-free');
  // Natural per-sample delta of the sine is ~0.014; the equal-power crossfade
  // can steepen a slope slightly but a missing fade is a step of up to ~1.0.
  const SEAM_LIMIT = 0.06;
  for (const s of d1.seams) {
    check(`seam at ${(s.cap / SR).toFixed(2)} s: max step ${s.maxStep.toFixed(4)} ≤ ${SEAM_LIMIT}`,
      s.maxStep <= SEAM_LIMIT);
  }
  check('seams comparable to mid-pass control', d1.seams.every(s => s.maxStep <= Math.max(0.03, d1.control * 4)),
    `control ${d1.control.toFixed(4)}`);

  // ── D. Close ──────────────────────────────────────────────────────────────
  console.log('\n§ D. close — the whole stroke becomes the loop');
  await rig.evaluate(() => { window.__ll.close(); });
  await sleep(300);
  const dA = await rig.evaluate(async () => await window.__ll.getState());
  await sleep(500);
  const dB = await rig.evaluate(async () => await window.__ll.getState());

  check('recording stopped on close', dA.recording === false && dA.closed === true);
  check('frontier frozen', dA.writePos === dB.writePos, `${dA.writePos} → ${dB.writePos}`);
  check('loop settles at the full stroke', dB.loopEnd === dB.writePos, `loopEnd ${dB.loopEnd} writePos ${dB.writePos}`);
  check('still looping after close', dB.looping === true && dB.wrapCount >= dA.wrapCount);

  // ── E. Stop ───────────────────────────────────────────────────────────────
  console.log('\n§ E. stop');
  await rig.evaluate(() => { window.__ll.stop(); });
  await sleep(150);
  const e = await rig.evaluate(async () => await window.__ll.getState());
  check('playback stopped', e.looping === false);

  // ── F. Simultaneous press ────────────────────────────────────────────────
  // `1`+`Q` in the same instant: loop armed with zero material. The first
  // pass boundary is the configured minimum — arbitrary by design; where it
  // should really come from is a rig question (see the TODO write-up).
  console.log('\n§ F. simultaneous press — first pass waits for the minimum');
  // Bridge latency (~300 ms per round trip) makes wall-clock polling
  // meaningless here, so both facts are read structurally: the armed-but-
  // waiting state is sampled in the SAME evaluate as the arm (microseconds
  // later), and the first pass boundary comes from the wrap-event chain.
  const f1 = await rig.evaluate(async () => {
    window.__ll.dispose();
    const { createLiveLoop } = await import('./js/live-loop.js');
    window.__ll2 = await createLiveLoop({
      input: window.__llosc, capture: false, gain: 0, minLoopS: 0.5, xfadeS: 0.030,
    });
    window.__ll2.record();
    window.__ll2.loop();
    return await window.__ll2.getState();
  });
  await sleep(1000);
  const f2 = await rig.evaluate(async () => {
    const st = await window.__ll2.getState();
    const d  = await window.__ll2.dump();
    return { ...st, firstWrapFrom: d.wrapEvents.length ? d.wrapEvents[0].from : -1 };
  });
  check('armed but silent before the minimum exists', f1.looping === true && f1.loopEnd === 0,
    `loopEnd ${f1.loopEnd} writePos ${f1.writePos}`);
  check('first pass begins on its own at ≈ minLoop',
    f2.loopEnd >= SR * 0.5 && (f2.firstWrapFrom === -1 || (f2.firstWrapFrom >= SR * 0.49 && f2.firstWrapFrom <= SR * 0.6)),
    `loopEnd ${(f2.loopEnd / SR).toFixed(2)} s, first wrap from ${(f2.firstWrapFrom / SR).toFixed(2)} s`);

  // ── G. Speed ──────────────────────────────────────────────────────────────
  console.log('\n§ G. speed — the read head cannot pass the frontier');
  await rig.evaluate(() => { window.__ll2.setSpeed(2.0); });
  await sleep(800);
  const g = await rig.evaluate(async () => await window.__ll2.getState());
  check('wraps continue at 2×', g.wrapCount > f2.wrapCount, `${f2.wrapCount} → ${g.wrapCount}`);
  check('read head never passed the frontier at 2×', g.readAheadViolations === 0, `${g.readAheadViolations}`);
  check('loop still growing while recording', g.loopEnd > f2.loopEnd);

  // ── H. Growth ─────────────────────────────────────────────────────────────
  // A 1 s initial buffer and a ~2.5 s take: the pool must double (twice)
  // without disturbing playback. This is the held-for-30-seconds answer in
  // miniature — growth is amortised and the loop just gets long.
  console.log('\n§ H. growth — a take that outgrows the buffer');
  await rig.evaluate(async () => {
    window.__ll2.stop(); window.__ll2.dispose();
    const { createLiveLoop } = await import('./js/live-loop.js');
    window.__ll3 = await createLiveLoop({
      input: window.__llosc, capture: false, gain: 0,
      minLoopS: 0.5, xfadeS: 0.030, initialBufS: 1.0,
    });
    window.__ll3.record();
    window.__ll3.loop();
  });
  await sleep(2500);
  const h = await rig.evaluate(async () => {
    const st = await window.__ll3.getState();
    window.__ll3.stop(); window.__ll3.dispose();
    return st;
  });
  check('buffer grew to fit the take', h.allocCount >= 1 && h.bufLen >= h.writePos,
    `allocCount ${h.allocCount} bufLen ${h.bufLen} writePos ${h.writePos}`);
  check('growth did not break the loop', h.wrapCount >= 1 && h.readAheadViolations === 0,
    `wrapCount ${h.wrapCount} violations ${h.readAheadViolations}`);

  // ── I. Preload — the 1+Q handover from the main-thread recording ─────────
  // At Q-press the stroke-so-far is handed to the worklet so the loop covers
  // the stroke from its START; live input then appends behind it.
  console.log('\n§ I. preload — the loop covers the stroke from its start');
  const i1 = await rig.evaluate(async () => {
    const { createLiveLoop } = await import('./js/live-loop.js');
    const ll = await createLiveLoop({
      input: window.__llosc, capture: false, gain: 0, minLoopS: 0.5, xfadeS: 0.030,
    });
    window.__ll4 = ll;
    const sr = 48000, n = Math.round(sr * 0.8);
    const pre = new Float32Array(n);
    for (let k = 0; k < n; k++) pre[k] = 0.4 * Math.sin(2 * Math.PI * 220 * k / sr);
    ll.preload(pre);
    ll.record();
    ll.loop();
    return await ll.getState();
  });
  await sleep(1400);
  const i2 = await rig.evaluate(async () => {
    const st = await window.__ll4.getState();
    window.__ll4.stop(); window.__ll4.dispose();
    return st;
  });
  check('preload landed before recording', i1.writePos >= SR * 0.79, `writePos ${i1.writePos}`);
  check('loop began at the preloaded length', i2.loopEnd >= SR * 0.79, `loopEnd ${i2.loopEnd}`);
  check('live input appends behind the preload', i2.writePos > i1.writePos + SR * 0.5,
    `${i1.writePos} → ${i2.writePos}`);
  check('preloaded loop wraps cleanly', i2.wrapCount >= 1 && i2.readAheadViolations === 0,
    `wraps ${i2.wrapCount}, violations ${i2.readAheadViolations}`);

  // ── Renderer errors ───────────────────────────────────────────────────────
  const errs = rig.errors();
  check('no renderer errors during the suite', errs.length === 0, errs.slice(0, 3).join(' | '));

  return fail === 0 ? 0 : 1;
}

(async () => {
  const attachMode = process.argv.includes('--attach');
  let rig;
  try {
    rig = attachMode ? await attach() : await launch({ oscPort: 7599 });
  } catch (e) {
    console.error('could not reach a rig:', e.message);
    process.exit(2);
  }
  let code = 1;
  try {
    code = await run(rig);
  } catch (e) {
    console.error('\nsuite crashed:', e.stack || e.message);
  } finally {
    console.log(`\n${pass} passed, ${fail} failed`);
    if (!attachMode) await rig.close();
  }
  process.exit(code);
})();
