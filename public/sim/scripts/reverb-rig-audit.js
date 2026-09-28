#!/usr/bin/env node
// ============================================================================
// reverb-rig-audit.js — the master reverb, against the running app
//
// js/reverb.test.mjs measures the DSP with no app. This measures the INSERT
// (js/master-reverb.js, wired by audio.js between the speaker merger and the
// ceiling): a burst put onto output channel 1 at the insert's input — where
// speaker bus 1 lands, and every source on it, loops, grains, the cursor and
// dry alike — read back per output channel after the insert. (At the INSERT,
// not the bus: the rig is muted, and mute zeroes the buses. The ceiling is
// unplugged from the interface for the suite, so nothing injected is heard.)
//   · off is a straight wire: no tail, and every reverb idle
//   · on, a sound on one speaker rings out on THAT speaker and no other
//   · amount scales the tail; off while ringing lets the tail finish; freeze holds
//   · a take recorded with it on is the same as one with it off — never recorded
//   · the footer, OSC and the signal-path diagram follow the state
//
//   node scripts/reverb-rig-audit.js       # its own private instance
//   node scripts/rig-audit.js reverb       # the same, as a rig suite
// ============================================================================

'use strict';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(rig) {
  let failures = 0;
  const ok  = (n, d = '') => console.log(`  ok   ${n}${d ? '  — ' + d : ''}`);
  const bad = (n, d = '') => { failures++; console.log(`  FAIL ${n}${d ? '  — ' + d : ''}`); };
  const check = (c, n, d) => (c ? ok : bad)(n, d);

  // A 330 Hz tone the page can gate, onto speaker bus 0, and one analyser per
  // output channel on the insert's own output.
  const setup = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const A = await import('./js/audio.js');
    const actx = A.ensureAudioContext();
    for (let i = 0; i < 60 && !(S._reverbNode && S.speakerBuses?.length); i++) await new Promise(r => setTimeout(r, 50));
    if (!S._reverbNode) return { error: 'the reverb insert never came up' };
    if (!S.speakerBuses?.length) return { error: 'no speaker buses' };
    try { S._outputCeiling?.disconnect(); } catch (_) {}   // silent: the next reload rebuilds it
    const node = S._reverbNode, nCh = node.channelCount;
    const osc = actx.createOscillator(); osc.frequency.value = 330;
    const g = actx.createGain(); g.gain.value = 0;
    const m = actx.createChannelMerger(nCh);
    osc.connect(g); g.connect(m, 0, 0); m.connect(S._reverbIn); osc.start();
    const sp = actx.createChannelSplitter(nCh);
    node.connect(sp);
    const ans = Array.from({ length: nCh }, (_, i) => { const a = actx.createAnalyser(); a.fftSize = 2048; sp.connect(a, i); return a; });
    const buf = new Float32Array(2048);
    window.__rv = { osc, g, ans };
    window.__rvCh = () => ans.map(a => { a.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; return Math.sqrt(s / buf.length); });
    // a 100 ms burst on bus 0, starting now
    window.__rvBurst = (v = 0.5) => { const t = actx.currentTime + 0.02; g.gain.cancelScheduledValues(0); g.gain.setValueAtTime(0, actx.currentTime); g.gain.setValueAtTime(v, t); g.gain.setValueAtTime(0, t + 0.1); };
    return { nCh, on: S.reverb.on, freeze: S.reverb.freeze, buses: S.speakerBuses.length };
  });
  if (setup.error) { bad('setup', setup.error); return failures; }
  const ch = () => rig.evaluate(() => window.__rvCh());
  const set = p => rig.evaluate(async (q) => (await import('./js/state.js')).S._setReverb(q), p);
  const burst = v => rig.evaluate(x => window.__rvBurst(x), v);
  const f = a => a.map(v => v.toExponential(1)).join(' / ');

  console.log('\n── off is a straight wire ──');
  check(!setup.on && !setup.freeze, 'reverb and freeze boot OFF', JSON.stringify(setup));
  await burst(0.5); await sleep(400);
  const dryTail = await ch();
  await sleep(900);
  const diag0 = await rig.evaluate(async () => (await import('./js/state.js')).S.reverbDiag);
  check(dryTail.every(v => v < 1e-5), 'off: a burst leaves nothing behind it', `300 ms after: ${f(dryTail)}`);
  check(diag0?.idlePct === 100, 'off: every reverb idle', `idle ${diag0?.idlePct}%, load ${diag0?.loadPct}%`);

  console.log('\n── on: it rings where it played ──');
  await set({ on: true, amount: 0.6, space: 0.7 });
  await burst(0.5); await sleep(700);
  const wet = await ch();
  const others = wet.slice(1);
  check(wet[0] > 1e-3, 'a burst on speaker 1 rings out on speaker 1', `600 ms after: ${f(wet)}`);
  check(others.every(v => v < 1e-6), 'and on no other speaker', `the other ${others.length}: ${f(others)}`);

  const amt = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const at = async (a) => {
      S._setReverb({ amount: a });
      await new Promise(r => setTimeout(r, 2500));      // let the last tail go
      window.__rvBurst(0.5);
      await new Promise(r => setTimeout(r, 700));
      return window.__rvCh()[0];
    };
    return { lo: await at(0.2), hi: await at(0.8) };
  });
  check(amt.hi > amt.lo * 8, 'amount scales the tail (wet = 2·amount²: 0.2 → 0.8 is ×16)', `${amt.lo.toExponential(1)} → ${amt.hi.toExponential(1)} (×${(amt.hi / amt.lo).toFixed(1)})`);

  await set({ space: 0.3 });           // a 1.8 s tail, so "finishes" fits the wait
  await sleep(4500);
  await burst(0.5); await sleep(150);
  await set({ on: false });
  await sleep(450);
  const trail = (await ch())[0];
  await sleep(4000);
  // Two full diag windows after silence: the diag reports once a second, and a
  // window that straddles the tail's end reads partly busy (82 %, seen once).
  const gone = await rig.evaluate(async () => {
    const c = window.__rvCh()[0];
    await new Promise(r => setTimeout(r, 2100));
    return { ch: c, diag: (await import('./js/state.js')).S.reverbDiag };
  });
  check(trail > 1e-3 && gone.ch < 1e-5 && gone.diag?.idlePct === 100,
    'off while ringing: the tail finishes, then every reverb idles', `0.45 s after off ${trail.toExponential(1)}, 4.5 s after ${gone.ch.toExponential(1)}, idle ${gone.diag?.idlePct}%`);

  const frz = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    S._setReverb({ on: true, amount: 0.6 });
    window.__rvBurst(0.5);
    await new Promise(r => setTimeout(r, 300));
    S._setReverb({ freeze: true });
    await new Promise(r => setTimeout(r, 300));
    const a = window.__rvCh()[0];
    await new Promise(r => setTimeout(r, 3000));
    const b = window.__rvCh()[0];
    S._setReverb({ freeze: false, on: false });
    return { a, b };
  });
  check(frz.b > frz.a * 0.3, 'freeze holds the tail', `${frz.a.toFixed(4)} → ${frz.b.toFixed(4)} over 3 s`);

  const mute = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    S._setReverb({ on: true, amount: 0.6 });
    window.__rvBurst(0.5);
    await new Promise(r => setTimeout(r, 500));
    const a = window.__rvCh()[0];
    S._setMuted(true);
    await new Promise(r => setTimeout(r, 200));
    const b = window.__rvCh()[0];
    S._setReverb({ on: false });
    return { a, b };
  });
  check(mute.a > 1e-3 && mute.b < 1e-5, 'mute silences a ringing tail too', `${mute.a.toFixed(4)} → ${mute.b.toExponential(1)} 0.2 s after mute`);

  console.log('\n── never recorded ──');
  // The burst goes into the INPUT, with the dry monitor on, so it reaches the
  // speakers — and the reverb — as well as the take. Two takes, reverb off and
  // on, compared with EACH OTHER: the rig's input is live and records the
  // room's floor (0.015–0.05 after a sweep suite ran), so zero is the wrong bar.
  const takes = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const A = await import('./js/audio.js');
    const actx = S.audioCtx;
    // UNMUTED for these two takes, so the real path runs — input → dry →
    // speaker bus → the insert. Silent all the same: the ceiling was unplugged
    // from the interface at setup.
    S._setMuted(false);
    if (!S.inputGainNode) S.inputGainNode = actx.createGain();
    if (!S.inputAnalyser) { S.inputAnalyser = actx.createAnalyser(); S.inputAnalyser.fftSize = 256; S.inputGainNode.connect(S.inputAnalyser); }
    if (S.dryGainNode) S.inputGainNode.connect(S.dryGainNode);
    S._setDryMonitorMode?.('on');
    const osc = actx.createOscillator(); osc.frequency.value = 330;
    const g = actx.createGain(); g.gain.value = 0; osc.connect(g); g.connect(S.inputGainNode); osc.start();
    window._rtAudioInputListening = true;
    S.paintGateThreshold = 0;
    const one = async (on) => {
      S._setReverb({ on, amount: 1, space: 1 });
      await new Promise(r => setTimeout(r, 2500));
      const t0 = actx.currentTime + 0.3;
      g.gain.cancelScheduledValues(0); g.gain.setValueAtTime(0, actx.currentTime);
      g.gain.setValueAtTime(0.5, t0); g.gain.setValueAtTime(0, t0 + 0.08);
      A.startLiveRecording();
      if (!S.isRecording) return { error: 'recording did not start' };
      const t0Take = actx.currentTime;
      let tailMax = 0;
      const poll = setInterval(() => { if (actx.currentTime > t0 + 0.4) tailMax = Math.max(tailMax, ...window.__rvCh()); }, 50);
      await new Promise(r => setTimeout(r, 1800));
      clearInterval(poll);
      A.stopLiveRecording();
      await new Promise(res => A.whenSealed(res));
      const buf = S.liveRecBuffers[S.liveRecBuffers.length - 1]?.buffer;
      if (!buf) return { error: 'no sealed take' };
      const x = buf.data, sr = buf.sampleRate, at = Math.round((t0 - t0Take) * sr);
      let burst = 0, after = 0;
      for (let i = 0; i < x.length; i++) {
        const a = Math.abs(x[i]);
        if (i >= at - 0.02 * sr && i < at + 0.15 * sr) burst = Math.max(burst, a);
        else if (i > at + 0.25 * sr) after = Math.max(after, a);
      }
      return { burst, after, tailMax };
    };
    const dry = await one(false), wet = await one(true);
    S._setReverb({ on: false, amount: 0.4, space: 0.5 });
    S._setDryMonitorMode?.('off');
    S._setMuted(true);
    try { osc.stop(); g.disconnect(); } catch (_) {}
    return { dry, wet };
  });
  if (takes.dry.error || takes.wet.error) bad('a take with the reverb on', takes.dry.error || takes.wet.error);
  else check(takes.wet.burst > 0.05 && takes.wet.tailMax > 1e-3 && takes.wet.after <= takes.dry.after * 1.5 + 0.005,
    'a take recorded with the reverb on is the same as one without — no tail in it',
    `after the burst: ${takes.wet.after.toFixed(3)} with the speakers ringing at ${takes.wet.tailMax.toFixed(3)}, ${takes.dry.after.toFixed(3)} without`);

  console.log('\n── the switch, OSC, the diagram ──');
  const ui = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const { handleOSC } = await import('./js/osc.js');
    document.getElementById('tcReverb').click();
    const afterClick = { on: S.reverb.on, cls: document.getElementById('tcReverb').classList.contains('is-mute') };
    handleOSC('/reverb/amount', [0.7]);
    handleOSC('/reverb/space', [0.8]);
    S._openSettings?.('audio');
    await new Promise(r => setTimeout(r, 600));
    const svg = document.querySelector('#asSignalPath svg');
    const text = svg ? [...svg.querySelectorAll('text')].map(t => t.textContent).join(' | ') : '';
    const sliders = { amount: +document.getElementById('reverbAmount')?.value, space: +document.getElementById('reverbSpace')?.value };
    document.querySelector('#settingsModal.open .close-btn, #settingsClose')?.click();
    handleOSC('/reverb', [0]);
    const out = { afterClick, after: S.reverb.on, amount: S.reverb.amount, sliders, text };
    S._setReverb({ amount: 0.4, space: 0.5 });
    return out;
  });
  check(ui.afterClick.on && !ui.afterClick.cls, 'the footer\'s VERB switches it on, and shows it', JSON.stringify(ui.afterClick));
  check(Math.abs(ui.amount - 0.7) < 1e-9 && Math.abs(ui.sliders.amount - 0.7) < 1e-9 && Math.abs(ui.sliders.space - 0.8) < 1e-9 && ui.after === false,
    'OSC sets amount, space and on; the settings sliders follow', JSON.stringify({ amount: ui.amount, sliders: ui.sliders, on: ui.after }));
  check(new RegExp(`reverb ×${setup.buses}`).test(ui.text) && /space 80/.test(ui.text),
    'the signal-path diagram draws the insert from live state', ui.text.split(' | ').filter(t => /reverb|space/.test(t)).join(' · '));

  await rig.evaluate(() => { try { window.__rv.osc.stop(); window.__rv.g.disconnect(); } catch (_) {} });
  const errs = rig.errors ? rig.errors() : [];
  check(errs.length === 0, 'no renderer errors along the way', errs.slice(0, 3).join(' | '));
  console.log(`\n${failures === 0 ? 'All master-reverb checks hold.' : `${failures} FAILED`}`);
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
