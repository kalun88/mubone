// ============================================================================
// verify-action-ranges.js — check each cc ACTION's `range` against its ccFn
//
// Every cc action declares { min, max, curve } describing the span its ccFn
// covers across MIDI 0–127.  The accessory table does unit maths against that
// declaration, so a wrong `curve` flag is silent damage: the UI still shows
// plausible cents and Hz while the pot's throw is skewed.  Nothing in the app
// would surface it.
//
// So don't trust the annotation — run the real ccFn.  For each cc action this
// dispatches v = 0, 63.5, 127, snapshots S before and after to find which key
// the ccFn wrote, and checks the reading at half throw.
//
// WHAT IS AND ISN'T CHECKED
//
// This compares SHAPE, not absolute values.  A range is declared in the unit the
// performer reads (ms, %, cents) while the ccFn usually stores something else
// (seconds, 0–1 ratios) — grain_dur declares 1–4000 ms and writes 0.001–4.0 s.
// Any constant factor between the two cancels when you normalise by the observed
// endpoints, so normalising is what lets one check cover every action without a
// second table of unit conversions to keep in sync.
//
// Half throw is the whole test: a lin and a log range agree at both endpoints
// and diverge hardest in the middle.  20 Hz–20 kHz reads 10010 linear against
// 632 log at v=63.5, so a swapped curve flag is a 15× error here and invisible
// anywhere else.
//
// Actions whose stored value is a NON-linear function of the displayed unit
// can't cancel, and are listed in STORAGE_INVERSE with the conversion.  Keep
// that list short — every entry is a place the annotation and the code can
// drift, which is the thing this script exists to prevent.
//
// Setup (once per machine/sandbox) — same as scripts/ui-shots.js:
//   npm install playwright-core
//   npx playwright-core install chromium-headless-shell
//   # sandboxes without libXdamage.so.1: see the ui-shots.js header for the stub
//
// Run:
//   python3 -m http.server 8123 &     # from the repo root
//   node scripts/verify-action-ranges.js
//
// Exits non-zero on any mismatch.  Browser mode only — no audio, no worklet.
// ============================================================================

const { chromium } = require('playwright-core');

const TOLERANCE = 0.03;   // normalised position at half throw, absolute

// Actions whose stored value is a non-linear function of the unit the range is
// declared in. Each maps stored → displayed so the shape check can compare
// like with like.
const STORAGE_INVERSE = {
  // stores the frequency ratio 2^(cents/1200) − 1; range is declared in cents
  grain_pitch: s => 1200 * Math.log2(s + 1),
  // _setOutputGainDb stores linear gain; range is declared in dB
  master_vol:  s => 20 * Math.log10(Math.max(s, 1e-9)),
};

// Actions where full throw is legitimately not range.max. Checked at half
// throw only, with the reason recorded so this stays a decision and not a
// forgotten failure.
const PARTIAL = {
  recency_cc: 'top of throw is the 0 = "all" sentinel, which sits above the 1–16 range by design',
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message.slice(0, 200)));
  await page.goto('http://localhost:8123/index.html', { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const raw = await page.evaluate(async () => {
    const S = (await import('./js/state.js')).S;
    const actions = S._actions || [];
    const out = [];

    // Shallow snapshot of the scalar leaves a ccFn might write. Deep structures
    // (particles, buffers) are skipped — no ccFn writes into them, and cloning
    // them per sample would cost more than the whole run.
    const snap = () => {
      const o = {};
      for (const k of Object.keys(S)) {
        const v = S[k];
        if (typeof v === 'number') o[k] = v;
        else if (v && typeof v === 'object' && !Array.isArray(v)) {
          for (const k2 of Object.keys(v)) {
            if (typeof v[k2] === 'number') o[`${k}.${k2}`] = v[k2];
          }
        }
      }
      return o;
    };

    for (const a of actions) {
      if (a.type !== 'cc' || !a.ccFn) continue;
      if (!a.range) { out.push({ id: a.id, status: 'NO RANGE' }); continue; }

      const samples = [0, 63.5, 127];
      const snaps = [];
      let error = null;

      for (const v of samples) {
        try { a.ccFn(v); } catch (e) { error = e.message.slice(0, 90); break; }
        snaps.push(snap());
      }
      if (error) { out.push({ id: a.id, status: 'THREW', error }); continue; }

      // Pick the key the ccFn drives: it must be finite at all three samples and
      // must actually differ between the endpoints. The naive "first key that
      // changed" picks up unrelated render state (a moving cursor coordinate)
      // and reports NaN.
      const candidates = Object.keys(snaps[0]).filter(k => {
        const vals = snaps.map(s => s[k]);
        return vals.every(Number.isFinite) && vals[0] !== vals[2];
      });

      if (!candidates.length) {
        // grain_k lands here on an empty sphere: its ceiling is the particle
        // count, so with nothing painted every input maps to k=1 and there is no
        // span to measure. Paint something first if you want it covered.
        out.push({
          id: a.id, fmt: a.fmt,
          status: a.range.maxFn ? 'NO SPAN (dynamic ceiling is currently ' + a.range.maxFn() + ')'
                                : 'NO OBSERVABLE WRITE',
        });
        continue;
      }
      // Prefer a grainOverrides/S key that looks like a parameter over incidental
      // state; ties are broken by the largest relative excursion.
      const key = candidates.sort((x, y) => {
        const span = k => Math.abs(snaps[2][k] - snaps[0][k]) / (Math.abs(snaps[0][k]) + 1e-9);
        return span(y) - span(x);
      })[0];

      out.push({
        id: a.id, key, fmt: a.fmt,
        curve: a.range.curve || 'lin',
        int: !!a.range.int,
        steps: Math.abs((a.range.maxFn ? a.range.maxFn() : a.range.max) - a.range.min),
        values: snaps.map(s => s[key]),
        candidates: candidates.length,
      });
    }
    return out;
  });

  // ── Shape check, node side ────────────────────────────────────────────────
  let failed = 0, skipped = 0, ok = 0;
  const num = n => (typeof n === 'number' ? Number(n.toPrecision(6)) : String(n));
  const lines = [];

  for (const r of raw) {
    if (r.status) {   // anything the page couldn't measure carries a status
      skipped++;
      lines.push(`~  ${r.id.padEnd(22)} ${r.status}${r.error ? '  ' + r.error : ''}`);
      continue;
    }

    const inv = STORAGE_INVERSE[r.id] || (x => x);
    const [v0, vMid, v1] = r.values.map(inv);

    // Normalised position of the half-throw reading between the two endpoints,
    // measured under the curve the action declares.
    let pos;
    if (r.curve === 'log' && v0 > 0 && v1 > 0 && vMid > 0) {
      pos = Math.log(vMid / v0) / Math.log(v1 / v0);
    } else {
      pos = (vMid - v0) / (v1 - v0);
    }

    // An int range can't land exactly on half throw when it has an odd number of
    // steps — commit_slots spans 15 and rounds 8.5 up to 9, which is half a step
    // off centre and nothing to do with the curve. Allow that half step.
    const quantum = (r.int && r.steps > 0) ? 0.5 / r.steps : 0;
    const partial = PARTIAL[r.id];
    const good = Number.isFinite(pos) && Math.abs(pos - 0.5) <= TOLERANCE + quantum;

    if (good) {
      ok++;
      if (partial) lines.push(`~  ${r.id.padEnd(22)} ok at half throw · ${partial}`);
      continue;
    }
    if (partial) { skipped++; lines.push(`~  ${r.id.padEnd(22)} ${partial}`); continue; }

    failed++;
    const alt = r.curve === 'log' ? 'lin' : 'log';
    lines.push(
      `\nX  ${r.id}  declared [${r.curve}]  writes S.${r.key}   fmt: ${r.fmt}\n` +
      `     readings   v=0 ${num(v0)}   v=63.5 ${num(vMid)}   v=127 ${num(v1)}\n` +
      `     half throw sits at ${num(pos)} of the span, expected 0.5 — ` +
      `curve is probably '${alt}', or the ccFn is not monotonic`
    );
  }

  console.log(lines.join('\n'));
  console.log(`\n${ok} ok · ${failed} mismatched · ${skipped} skipped`);

  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
