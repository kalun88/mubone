#!/usr/bin/env node
/**
 * scripts/colour-audit.js — a sound has ONE colour, and everyone can name it.
 *
 * Runs against a real Electron instance via scripts/lib/rig.js — no setup.
 *   node scripts/colour-audit.js
 *   node scripts/rig-audit.js colour
 *
 * WHY THIS SUITE EXISTS (Ek, 2026-09-13: "let's make sure we don't make this
 * mistake again"). The timbre→colour chain was wrong for months in four
 * independent ways at once, every one of them invisible to a clean bench test,
 * and three rounds of fixes each moved one fault while the sphere kept coming
 * back the same three colours. The sequence, because the shape of it is the
 * lesson:
 *
 *   · the FEATURE answered the wrong question — spectral centroid averages a
 *     vowel's two formants into one middle number, so five cardinal vowels
 *     spanned 9% of the arc;
 *   · the RESOLUTION could not see the question — fftSize 256 is 187 Hz a bin
 *     at 48 kHz, and the entire first-formant range that separates `ee` from
 *     `ah` is 270…730 Hz, four bins;
 *   · the ROOM decided the answer — a share-of-total-energy ratio counts every
 *     bin, and with 124 bins above the 800 Hz split against four below, 97% of
 *     any broadband floor landed high and offset the hue rather than blurring
 *     it (a vowel reading 0.206 in silence read 0.358 with room tone under it);
 *   · and the COLOURS could not say it — chroma flat at half of what sRGB
 *     holds, one lightness ramp through both yellow and blue, and an arc routed
 *     the short way round the wheel, which has no green on it.
 *
 * The through-line: EVERY bench test passed while the microphone failed,
 * because a synthesised tone has no noise floor. So § A is the suite's centre
 * of gravity — it measures each sound at three floor levels and reports what
 * the floor MOVED, not just what the spread was. A suite that only reported
 * spread would have passed at every stage of the bug.
 *
 *  A. THE ROOM DOES NOT DECIDE THE COLOUR — the same sound under no floor, a
 *     room floor and a loud one lands in the same place.
 *  B. THE AXIS CAN SEE THE VOWEL SPACE — five cardinal vowels spread; `ee`
 *     against `ah`, which differ mostly in F1, are far apart. Fails if the
 *     analyser's bins ever go coarse again.
 *  C. TONE AND NOISE ARE AT OPPOSITE ENDS — a sung vowel against a hiss.
 *  D. THE ARC REACHES EVERY FAMILY — blue, cyan, green, yellow, orange and
 *     red all appear on the ramp, and the hue runs one way without doubling
 *     back, which is what proves nothing is clipping.
 *  E. THE COLOURS ARE COLOURS — chroma near what the gamut allows rather than
 *     a flat safe number, and lightness following the hue rather than one ramp.
 *  F. NEIGHBOURS ARE TELLABLE APART — no two reference sounds inside a JND.
 *  G. THE BOUNDS ARE CONSTANTS, NOT SETTINGS — Ek: "it should be very
 *     predictable so that i see yellow everytime and my collaborators see
 *     yellow and they know what sound that is." No slider, no Listen button,
 *     no stored calibration may reach the hue axis.
 *  H. IT COSTS WHAT IT SAID — per mark and per colour.
 *  J. THE TWO RENDERERS AGREE — perfMode is a speed trade, not a different
 *     picture: same dot sizes at every zoom, and a mark with no loudness in it
 *     still draws in its own colour rather than dropping to the palette.
 *  I. THE ROOM BETWEEN NOTES IS NOT A COLOUR — a tape take records
 *     continuously, so most of its marks are the gaps. They hold the last
 *     sound's colour instead of reading the room and inventing one.
 *
 * Exits non-zero on failure.
 */

const { launch } = require('./lib/rig');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else      { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── sRGB hex → OKLCh, so the audit can read the colours the app produced
// without importing any of the constants that produced them. A test that
// borrows the code's own numbers proves only that the code equals itself.
function hexToOklch(hex) {
  const u = i => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const r = u(1), g = u(3), b = u(5);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { L, a: A, b: B, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 };
}
const dist = (p, q) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
const JND  = 0.02;            // OKLab, the step at which two dots stop being one colour

// The families the ramp has to be able to say, by OKLCh hue.
const FAMILY = [
  ['red',    12,  45], ['orange', 45,  78], ['yellow', 78, 118],
  ['green', 118, 172], ['cyan',  172, 232], ['blue',  232, 278],
];

// ── The bench, inside the renderer. Formant triples are the standard cardinal
// values for a male voice; the noise bands are a breath, a `sh` and an `ss`.
// Everything runs through S.inputGainNode, which is where a microphone lands,
// so the whole chain under test is the real one.
async function installBench(rig) {
  await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const A = await import('./js/audio.js');
    const AF = await import('./js/audio-features.js');
    const actx = A.ensureAudioContext();
    const dest = S.inputGainNode;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const peekBuf = new Uint8Array(128);
    // THE BUS KEEPS A TAIL. Stopping a source does not put the input bus back
    // at silence — measured, it takes up to 3.25 s to fall to the floor, and a
    // "quiet" reading taken on top of the previous sound's tail is a reading
    // of the tail. It cost this suite two false failures on its first run,
    // where every sound after the first read as noise. So every reading waits
    // for real silence first. Without this the audit is sloppier than the
    // instrument it is checking.
    const busMean = () => {
      S.inputAnalyser.getByteFrequencyData(peekBuf);
      let t = 0; for (const v of peekBuf) t += v; return t / peekBuf.length;
    };
    const waitForSilence = async () => {
      for (let i = 0; i < 40; i++) { if (busMean() < 0.5) return true; await sleep(250); }
      return false;
    };
    const nb = (() => {
      const len = actx.sampleRate, b = actx.createBuffer(1, len, actx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return b;
    })();
    const floor = g => {
      if (!g) return null;
      const s = actx.createBufferSource(); s.buffer = nb; s.loop = true;
      const n = actx.createGain(); n.gain.value = g;
      s.connect(n); n.connect(dest); s.start();
      return () => { try { s.stop(); s.disconnect(); n.disconnect(); } catch (_) {} };
    };
    const voiced = (F, pitch) => {
      const src = actx.createOscillator(); src.type = 'sawtooth'; src.frequency.value = pitch;
      const g = actx.createGain(); g.gain.value = 0.9;
      const bs = F.map((hz, i) => {
        const f = actx.createBiquadFilter(); f.type = 'bandpass';
        f.frequency.value = hz; f.Q.value = hz / (90 + i * 40); return f;
      });
      const mix = actx.createGain(); mix.gain.value = 0.6;
      src.connect(g); bs.forEach(f => { g.connect(f); f.connect(mix); }); mix.connect(dest); src.start();
      return () => { try { src.stop(); src.disconnect(); g.disconnect(); bs.forEach(f => f.disconnect()); mix.disconnect(); } catch (_) {} };
    };
    const band = (hp, lp, gn) => {
      const s = actx.createBufferSource(); s.buffer = nb; s.loop = true;
      const a = actx.createBiquadFilter(); a.type = 'highpass'; a.frequency.value = hp;
      const b = actx.createBiquadFilter(); b.type = 'lowpass';  b.frequency.value = lp;
      const g = actx.createGain(); g.gain.value = gn;
      s.connect(a); a.connect(b); b.connect(g); g.connect(dest); s.start();
      return () => { try { s.stop(); s.disconnect(); a.disconnect(); b.disconnect(); g.disconnect(); } catch (_) {} };
    };
    const SOUNDS = {
      chest:  () => voiced([300, 700, 2200], 110),
      ee:     () => voiced([270, 2290, 3010], 170),
      ay:     () => voiced([530, 1840, 2480], 170),
      oo:     () => voiced([300, 870, 2240], 170),
      ah:     () => voiced([730, 1090, 2440], 170),
      oh:     () => voiced([570, 840, 2410], 170),
      growl:  () => voiced([500, 1100, 2400], 75),
      breath: () => band(400, 6000, 0.30),
      click:  () => band(700, 16000, 0.5),
      sh:     () => band(1800, 7000, 0.35),
      ss:     () => band(4000, 14000, 0.35),
    };
    window.__ca = {
      S, AF, SOUNDS, waitForSilence, busMean,
      // One reading: start the floor, start the sound, let the analyser fill,
      // take the snapshot the paint ticker would take. THREE of them, a frame
      // apart, and the median — a noise band's spectrum is random, so its
      // peaks wander frame to frame by more than any of these gates allow,
      // and a single snapshot of a hiss is a coin toss rather than a
      // measurement. A real stroke lays down twenty marks a second; reading
      // one is the audit being sloppier than the instrument.
      async read(name, floorGain) {
        await waitForSilence();
        const stopF = floor(floorGain);
        const stopS = SOUNDS[name]();
        await sleep(320);
        const got = [];
        for (let k = 0; k < 3; k++) { got.push(AF.snapshotTimbre()); await sleep(70); }
        stopS(); stopF && stopF();
        await sleep(40);
        const med = f => got.map(f).sort((a, b) => a - b)[1];
        const tilt = med(t => t.tilt), noise = med(t => t.noise);
        return { tilt, noise, hex: AF.featuresToColor(tilt, noise) };
      },
      // The ramp itself, sampled evenly, at a mid noise reading.
      ramp(steps) {
        const out = [];
        for (let i = 0; i < steps; i++) out.push(AF.featuresToColor(i / (steps - 1), 0.3));
        return out;
      },
    };
  });
}

async function run(rig) {
  await installBench(rig);
  const NAMES = ['chest', 'ee', 'ay', 'oo', 'ah', 'oh', 'growl', 'breath', 'click', 'sh', 'ss'];

  // ── A. THE ROOM DOES NOT DECIDE THE COLOUR ────────────────────────────────
  // The check the whole suite exists for. Three floor levels: silence, a room,
  // and a room three times louder. If the hue axis ever goes back to summing
  // over bins, the shift here is the first thing to move — it was 0.187 before
  // the peak ratio and 0.023 after, so the gate sits between them.
  console.log('\n§ A the room does not decide the colour');
  const q = {}, rm = {}, ld = {};
  for (const n of NAMES) {
    q[n]  = await rig.evaluate(n => window.__ca.read(n, 0),     n);
    rm[n] = await rig.evaluate(n => window.__ca.read(n, 0.012), n);
    ld[n] = await rig.evaluate(n => window.__ca.read(n, 0.030), n);
  }
  const shift = n => Math.max(Math.abs(rm[n].tilt - q[n].tilt), Math.abs(ld[n].tilt - q[n].tilt));
  const worst = NAMES.reduce((a, n) => shift(n) > shift(a) ? n : a, NAMES[0]);
  check('a broadband floor moves no sound more than 0.06 on the hue axis',
    shift(worst) <= 0.06,
    `worst ${worst} ${shift(worst).toFixed(3)} (quiet ${q[worst].tilt.toFixed(3)}, room ${rm[worst].tilt.toFixed(3)}, loud ${ld[worst].tilt.toFixed(3)})`);
  // The table itself, because a gate that passes still has to be READ — every
  // round of this bug was a number nobody printed.
  console.log(`\n  ${'sound'.padEnd(8)}${'quiet'.padStart(7)}${'room'.padStart(7)}${'loud'.padStart(7)}${'noise'.padStart(8)}   colour`);
  for (const n of NAMES) {
    console.log(`  ${n.padEnd(8)}${q[n].tilt.toFixed(3).padStart(7)}${rm[n].tilt.toFixed(3).padStart(7)}${ld[n].tilt.toFixed(3).padStart(7)}${q[n].noise.toFixed(3).padStart(8)}   ${q[n].hex}`);
  }
  console.log('');
  const dcol = NAMES.map(n => dist(hexToOklch(q[n].hex), hexToOklch(ld[n].hex)));
  check('and no sound changes COLOUR by more than a JND because of the room',
    Math.max(...dcol) <= JND * 2.5,
    `worst ${NAMES[dcol.indexOf(Math.max(...dcol))]} ${Math.max(...dcol).toFixed(3)}`);

  // ── B. THE AXIS CAN SEE THE VOWEL SPACE ───────────────────────────────────
  // `ee` and `ah` differ mainly in the FIRST formant, 270 Hz against 730. At
  // fftSize 256 that is four bins wide and this check reads ~0.02; it needs
  // 2048 to read what it reads now. It is the resolution invariant.
  console.log('\n§ B the axis can see the vowel space');
  const VOW = ['ee', 'ay', 'oo', 'oh', 'ah'];
  const vt = VOW.map(n => q[n].tilt);
  check('five cardinal vowels spread at least 0.25 of the axis',
    Math.max(...vt) - Math.min(...vt) >= 0.25,
    VOW.map((n, i) => `${n} ${vt[i].toFixed(3)}`).join(' · '));
  check('`ee` and `ah`, which differ in F1, are at least 0.15 apart',
    Math.abs(q.ee.tilt - q.ah.tilt) >= 0.15,
    `ee ${q.ee.tilt.toFixed(3)} ah ${q.ah.tilt.toFixed(3)}`);
  const vc = VOW.map(n => hexToOklch(q[n].hex));
  let vmin = 9;
  for (let i = 0; i < vc.length; i++) for (let j = i + 1; j < vc.length; j++) vmin = Math.min(vmin, dist(vc[i], vc[j]));
  check('and no two vowels are the same colour', vmin > JND, `closest pair ${vmin.toFixed(3)}`);

  // ── C. TONE AND NOISE ARE AT OPPOSITE ENDS ────────────────────────────────
  console.log('\n§ C tone and noise are at opposite ends');
  check('a chest tone and a hiss are at least 0.5 apart on the axis',
    q.ss.tilt - q.chest.tilt >= 0.5,
    `chest ${q.chest.tilt.toFixed(3)} ss ${q.ss.tilt.toFixed(3)}`);
  // THE SECOND AXIS MUST POINT THE RIGHT WAY. It did not for months: with a
  // brightness trend subtracted from flatness, a hiss read as the most TONAL
  // thing on the sphere and was drawn at full saturation. A check that only
  // asked whether the axis MOVED would have passed throughout.
  check('breath reads noisier than a sung vowel',
    q.breath.noise > q.ah.noise + 0.15,
    `breath ${q.breath.noise.toFixed(2)} ah ${q.ah.noise.toFixed(2)}`);
  const TONAL = ['chest', 'ee', 'ay', 'oo', 'ah', 'oh', 'growl'], NOISY = ['breath', 'click', 'sh', 'ss'];
  const loudestTonal = Math.max(...TONAL.map(n => q[n].noise));
  const quietestNoisy = Math.min(...NOISY.map(n => q[n].noise));
  check('EVERY noise band reads noisier than EVERY sung sound — the axis cannot invert',
    quietestNoisy > loudestTonal,
    `tonal up to ${loudestTonal.toFixed(2)}, noisy from ${quietestNoisy.toFixed(2)}`);
  check('and the two classes are at least 0.25 apart, not merely ordered',
    quietestNoisy - loudestTonal >= 0.25,
    `gap ${(quietestNoisy - loudestTonal).toFixed(2)}`);
  // The saturation axis has to survive a room too, and for a year's worth of
  // versions it did not: spectral flatness is a geometric mean over every bin,
  // so it is decided by the EMPTIEST ones and a floor fills exactly those. In
  // a room it read `ee` at −0.48 and breath at −0.41 — no information at all.
  // Counting the bins within 12 dB of the peak is robust the same way the hue
  // axis is, and this is the check that says so.
  const loudT = Math.max(...TONAL.map(n => ld[n].noise));
  const quietN = Math.min(...NOISY.map(n => ld[n].noise));
  check('and the classes stay apart with a LOUD room floor under them',
    quietN - loudT >= 0.20,
    `gap in a room ${(quietN - loudT).toFixed(2)} (tonal to ${loudT.toFixed(2)}, noisy from ${quietN.toFixed(2)})`);
  const nsh = Math.max(...NAMES.map(n => Math.abs(ld[n].noise - q[n].noise)));
  check('no sound moves more than 0.30 on the saturation axis because of the room',
    nsh <= 0.30, `worst ${nsh.toFixed(2)}`);

  // ── D. THE ARC REACHES EVERY FAMILY ───────────────────────────────────────
  // Ek, on the arc that climbed 248° → 58°: "i always see orange blue violet."
  // There was no green on that road and no true yellow at the end of it.
  console.log('\n§ D the arc reaches every family');
  const ramp = await rig.evaluate(() => window.__ca.ramp(64));
  const hues = ramp.map(h => hexToOklch(h).h);
  for (const [name, lo, hi] of FAMILY) {
    check(`the ramp contains a ${name}`, hues.some(h => h >= lo && h < hi),
      `hues ${Math.min(...hues).toFixed(0)}…${Math.max(...hues).toFixed(0)}`);
  }
  // Unwrapped, the arc must run ONE way. A clipped chroma bends the hue back
  // on itself, so monotonicity is the no-clipping check that needs no
  // knowledge of what chroma was asked for.
  let unw = [hues[0]], acc = hues[0];
  for (let i = 1; i < hues.length; i++) {
    let d = hues[i] - hues[i - 1];
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    acc += d; unw.push(acc);
  }
  const back = unw.slice(1).filter((v, i) => v > unw[i] + 0.5).length;
  check('the hue runs one way along the arc, never doubling back', back === 0, `${back} reversals`);
  check('and covers at least 240° of the wheel',
    unw[0] - unw[unw.length - 1] >= 240,
    `${(unw[0] - unw[unw.length - 1]).toFixed(0)}°`);

  // ── E. THE COLOURS ARE COLOURS ────────────────────────────────────────────
  // Chroma was a flat 0.105…0.160 because a fixed number is the only one that
  // never clips. Held that pale, hue 15° is salmon and 54° is tan — the reds
  // and yellows WERE there and did not look it.
  console.log('\n§ E the colours are colours');
  const rc = ramp.map(hexToOklch);
  const meanC = rc.reduce((a, c) => a + c.C, 0) / rc.length;
  check('mean chroma along the arc is at least 0.17, not a flat safe number',
    meanC >= 0.17, `mean ${meanC.toFixed(3)}`);
  const cs = rc.map(c => c.C);
  check('and chroma VARIES with hue, as riding the gamut edge requires',
    Math.max(...cs) - Math.min(...cs) >= 0.05,
    `${Math.min(...cs).toFixed(3)}…${Math.max(...cs).toFixed(3)}`);
  const ls = rc.map(c => c.L);
  check('lightness follows the hue — yellow cannot be yellow at blue\'s lightness',
    Math.max(...ls) - Math.min(...ls) >= 0.30,
    `${Math.min(...ls).toFixed(2)}…${Math.max(...ls).toFixed(2)}`);

  // ── F. NEIGHBOURS ARE TELLABLE APART ──────────────────────────────────────
  console.log('\n§ F neighbours are tellable apart');
  const all = NAMES.map(n => ({ n, c: hexToOklch(q[n].hex) }));
  let closest = { d: 9, pair: '' };
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const d = dist(all[i].c, all[j].c);
    if (d < closest.d) closest = { d, pair: `${all[i].n}/${all[j].n}` };
  }
  // At most ONE pair may collide. Some of the eleven genuinely are near
  // neighbours — `oo` and a growl differ by a hundredth of the hue axis — and
  // demanding eleven nameable colours from them would be demanding the axis
  // lie. Two collisions means the arc has narrowed.
  const inside = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    if (dist(all[i].c, all[j].c) <= JND) inside.push(`${all[i].n}/${all[j].n}`);
  }
  check('at most one pair of the eleven reference sounds is inside a JND',
    inside.length <= 1, `${inside.length}: ${inside.join(', ')} (closest ${closest.pair} ${closest.d.toFixed(3)})`);
  const steps = all.slice(1).map((x, i) => dist(x.c, all[i].c));
  check('and the mean step between neighbours is at least 0.06',
    steps.reduce((a, b) => a + b, 0) / steps.length >= 0.06,
    (steps.reduce((a, b) => a + b, 0) / steps.length).toFixed(3));

  // ── G. THE BOUNDS ARE CONSTANTS, NOT SETTINGS ─────────────────────────────
  // A colour is only a shared word if nobody can quietly redefine it. What used
  // to be two calibration sliders and a ten-second Listen button is a legend.
  console.log('\n§ G the bounds are constants, not settings');
  const g0 = await rig.evaluate(() => {
    const S = window.__ca.S;
    const ids = ['vizTimbreListen', 'vizCentroidMinSlider', 'vizCentroidMaxSlider',
                 'vizCentroidMinNum', 'vizCentroidMaxNum', 'vizZcrMinSlider', 'vizZcrMaxSlider'];
    return {
      controls: ids.filter(id => document.getElementById(id)),
      legend: !!document.getElementById('vizTimbreLegend'),
      stops: document.querySelectorAll('#vizTimbreLegend .viz-legend-stop').length,
      stateKeys: Object.keys(S).filter(k => /^viz(Tilt|Timbre)(Min|Max)$/.test(k)),
    };
  });
  check('no slider, numbox or Listen button reaches the hue axis',
    g0.controls.length === 0, g0.controls.join(', '));
  check('there is no stored tilt calibration on S to drift',
    g0.stateKeys.length === 0, g0.stateKeys.join(', '));
  check('the viz panel shows a LEGEND of measured landings instead',
    g0.legend && g0.stops >= 5, `${g0.stops} stops`);
  // The legend has to agree with the axis it describes, or it is decoration.
  const g1 = await rig.evaluate(() => {
    const S = window.__ca.S;
    return [...document.querySelectorAll('#vizTimbreLegend .viz-legend-dot')]
      .map(e => getComputedStyle(e).backgroundColor);
  });
  check('every legend dot is painted, none left unstyled',
    g1.length >= 5 && g1.every(c => c && c !== 'rgba(0, 0, 0, 0)'), JSON.stringify(g1));

  // ── H. IT COSTS WHAT IT SAID ──────────────────────────────────────────────
  // The snapshot is per MARK, at most 200 a second; the colour is a table read.
  console.log('\n§ H it costs what it said');
  const h0 = await rig.evaluate(async () => {
    const AF = window.__ca.AF;
    const stop = window.__ca.SOUNDS.ah();
    await new Promise(r => setTimeout(r, 300));
    for (let i = 0; i < 500; i++) AF.snapshotTimbre();
    const runs = [];
    for (let k = 0; k < 5; k++) {
      const t = performance.now();
      for (let i = 0; i < 2000; i++) AF.snapshotTimbre();
      runs.push((performance.now() - t) / 2000);
    }
    for (let i = 0; i < 20000; i++) AF.featuresToColor((i % 64) / 63, (i % 32) / 31);
    const t2 = performance.now();
    for (let i = 0; i < 50000; i++) AF.featuresToColor((i % 64) / 63, (i % 32) / 31);
    const per = (performance.now() - t2) / 50000;
    stop();
    runs.sort((a, b) => a - b);
    return { snap: runs[2] * 1000, col: per * 1000 };
  });
  check('a mark\'s timbre snapshot stays under 25 µs', h0.snap < 25, `${h0.snap.toFixed(1)} µs`);
  check('a colour stays a table read, under 0.5 µs', h0.col < 0.5, `${h0.col.toFixed(2)} µs`);

  // ── I. THE ROOM BETWEEN NOTES IS NOT A COLOUR ────────────────────────────
  // Ek, reading a real take back: "i ended that long line with the K click
  // sound with the tongue but it goes thru purple to green/yellow just on a K."
  // A tape take records continuously, so most of its marks sit at rms 0.002
  // against the click's 0.69 — there is no sound in them to read, and the axis
  // answered anyway, giving every silent mark an independent random hue.
  console.log('\n§ I the room between notes is not a colour');
  const i0 = await rig.evaluate(async () => {
    const AF = window.__ca.AF;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    await window.__ca.waitForSilence();
    const stop = window.__ca.SOUNDS.ah();
    await sleep(350);
    const sounding = [];
    for (let k = 0; k < 4; k++) { const t = AF.snapshotTimbre();
      sounding.push(AF.featuresToColor(t.tilt, t.noise)); await sleep(50); }
    stop();
    const quiet = [];
    for (let k = 0; k < 14; k++) { await sleep(50); const t = AF.snapshotTimbre();
      quiet.push(AF.featuresToColor(t.tilt, t.noise)); }
    await window.__ca.waitForSilence();
    const s2 = window.__ca.SOUNDS.ss(); await sleep(350);
    const t2 = AF.snapshotTimbre(); s2();
    return { sounding, quiet, after: AF.featuresToColor(t2.tilt, t2.noise), afterTilt: t2.tilt };
  });
  check('0.7 s of silence after a note draws ONE colour, not a ramp',
    new Set(i0.quiet).size === 1, `${new Set(i0.quiet).size} distinct: ${[...new Set(i0.quiet)].join(' ')}`);
  check('and it is the colour of the note that just stopped',
    i0.sounding.includes(i0.quiet[0]), `${i0.quiet[0]} vs ${[...new Set(i0.sounding)].join(' ')}`);
  // The hold must not become a lag: a real sound has to take over at once, or
  // the axis stops following the performer.
  check('a genuinely different sound takes the colour back immediately',
    i0.afterTilt > 0.8 && !i0.quiet.includes(i0.after),
    `hiss tilt ${i0.afterTilt.toFixed(3)}, ${i0.after}`);
  // THE SEAL DECIDES AGAINST THE WHOLE TAKE. The live hold is causal and so is
  // wrong at the START of a take: measured on one of Ek's, 39 marks sat more
  // than 34 dB under its loudest moment and the live estimator caught 22, the
  // misses being the early ones — a mark at 0.65 s read 26 dB below everything
  // before it but 44 dB below the take entire. settleTakeTimbre re-runs the
  // same rule once the future is known.
  const i1 = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const AF = await import('./js/audio-features.js');
    const keep = S.particles.slice();
    S.particles.length = 0;
    const mk = (t, rms, tilt, noise) => ({ source: 'live', liveBufferIdx: 0, trig: true,
      strokeId: 1, grainStart: t, grainDuration: 0.1, rms, tilt, noise, lon: 0, lat: 0 });
    // room · room · a quiet note · room · the loud click · its decay · room
    const spec = [[0, 0.003, 0.41, 0.9], [0.05, 0.0044, 0.13, 0.2],
                  [0.10, 0.09, 0.20, 0.1], [0.15, 0.085, 0.21, 0.1],
                  [0.20, 0.004, 0.87, 0.8], [0.25, 0.0035, 0.33, 0.5],
                  [0.30, 0.65, 0.95, 0.9], [0.35, 0.03, 0.90, 0.9],
                  [0.40, 0.002, 0.05, 0.1]];
    for (const x of spec) S.particles.push(mk(...x));
    const fixed = AF.settleTakeTimbre(0);
    const after = S.particles.map(p => +p.tilt.toFixed(2));
    const again = AF.settleTakeTimbre(0);   // must be idempotent
    S.particles.length = 0; for (const p of keep) S.particles.push(p);
    return { fixed, after, again };
  });
  check('a sealed take backfills the marks before its first sounding one',
    i1.after[0] === 0.20 && i1.after[1] === 0.20, JSON.stringify(i1.after));
  check('and every later silent mark takes the last sounding colour',
    i1.after[4] === 0.21 && i1.after[5] === 0.21 && i1.after[8] === 0.90, JSON.stringify(i1.after));
  check('while the marks that HAVE sound in them are left alone',
    i1.after[2] === 0.20 && i1.after[3] === 0.21 && i1.after[6] === 0.95 && i1.after[7] === 0.90,
    JSON.stringify(i1.after));
  check('and running it twice changes nothing the second time',
    i1.fixed === 5 && i1.again === 0, `${i1.fixed} then ${i1.again}`);

  // ── J. THE TWO RENDERERS AGREE ───────────────────────────────────────────
  // perfMode is meant to cost frames, not change the picture, and it is pressed
  // mid-set. It was missing the full renderer's FOV size compensation, so on
  // the wide map its dots came out 2.9× too large; and a mark whose loudness is
  // zero or NaN fell to the legacy palette branch in BOTH renderers, drawing
  // grey at nearly twice the size — measured, radius 8.9 became 17.1 and
  // #3ff2ae became #888888. A tape take deposits on every tick including
  // silence, so that mark is ordinary material, not a curiosity.
  console.log('\n§ J the two renderers agree');
  const j0 = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const raf = () => new Promise(r => requestAnimationFrame(r));
    const keep = S.particles.slice(), fov0 = S.fovDeg, perf0 = S.perfMode, pull0 = S.camPull;
    S.particles.length = 0;
    for (let i = 0; i < 10; i++) S.particles.push({ lon: -50 + 11 * i, lat: 6 * Math.sin(i),
      source: 'live', liveBufferIdx: 0, grainStart: i * 0.05, grainDuration: 0.1, _vo: 0,
      strokeId: 1, rms: 0.02 + 0.03 * i, tilt: 0.1 * i, noise: 0.3,
      centroid: 0.2, zcr: 0.2, color: '#888' });
    S._particleVersion++; S.camPull = 0;
    const draw = async () => {
      const ctx = S.ctx, real = ctx.arc.bind(ctx);
      let got = [], cur;
      ctx.arc = function (x, y, rr, a, b, c) { cur.push({ r: +(+rr).toFixed(2), fill: String(ctx.fillStyle) }); return real(x, y, rr, a, b, c); };
      for (let f = 0; f < 6; f++) { cur = []; S.needsRedraw = true; await raf(); if (cur.length) got = cur; }
      ctx.arc = real;
      return got;
    };
    const gaps = [];
    for (const fov of [30, 80, 200, 360]) {
      S.fovDeg = fov;
      S.perfMode = false; const full = await draw();
      S.perfMode = true;  const perf = await draw();
      let worst = 0;
      for (let i = 0; i < Math.min(full.length, perf.length); i++) worst = Math.max(worst, Math.abs(full[i].r - perf[i].r));
      gaps.push({ fov, worst: +worst.toFixed(2), n: Math.min(full.length, perf.length) });
    }
    // and the zero-loudness mark, in the full renderer. Measured against the
    // SAME FIELD undisturbed, never against a pixel number: the fault is a mark
    // that doubles, and a fixed ceiling here is really an assertion about
    // whatever `vizMaxSize` happens to default to — it read `< 24` against a
    // 22 px ceiling and went red the day the ceiling became 36, saying nothing
    // about the mark it is named after (2026-09-15).
    S.fovDeg = 80; S.perfMode = false;
    const before = (await draw()).filter(a => a.fill !== 'rgba(255, 255, 255, 0.25)');
    S.particles[4].rms = NaN;
    S._particleVersion++;
    const poisoned = await draw();
    const clean = poisoned.filter(a => a.fill !== 'rgba(255, 255, 255, 0.25)');
    S.particles.length = 0; for (const p of keep) S.particles.push(p);
    S.fovDeg = fov0; S.perfMode = perf0; S.camPull = pull0; S._particleVersion++;
    return { gaps, grey: clean.filter(a => /^#(\w)\1(\w)\2(\w)\3$/.test(a.fill) || a.fill === '#888888').length,
             maxR: Math.max(...clean.map(a => a.r)),
             baseR: Math.max(...before.map(a => a.r)), n: clean.length };
  });
  for (const g of j0.gaps) {
    check(`perfMode draws the same dot sizes as the full renderer at ${g.fov}° fov`,
      // 0.1 px, not 0: the sphere idles a fraction of a degree between the two
      // captures, which moves depthScale in the last decimal. The fault this
      // guards was 2.9× — about 13 px on the wide map — so the margin is ample.
      g.n > 0 && g.worst <= 0.1, `worst gap ${g.worst} px over ${g.n} dots`);
  }
  check('a mark with a non-finite loudness keeps its timbre colour',
    j0.grey === 0, `${j0.grey} of ${j0.n} dots drew grey`);
  check('and is drawn at the quiet floor, not at double size',
    j0.baseR > 0 && j0.maxR <= j0.baseR + 0.5,
    `largest dot ${j0.maxR} px against ${j0.baseR} px with the same field unpoisoned`);

  console.log(`\n${pass} ok · ${fail} failed`);
  return fail;
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    const rig = await launch();
    let fails = 1;
    try { fails = await run(rig); }
    catch (e) { console.error('colour-audit crashed:', e); }
    finally { await rig.close(); }
    process.exit(fails ? 1 : 0);
  })();
}
