#!/usr/bin/env node
// ============================================================================
// rig-audit.js — every sweep audit, one command, one app boot
//
// Runs the suites that have to walk a space too large to eyeball: 36 cc actions
// against their declared ranges, the same 36 against both copies of every
// mirrored control, and the trigger tool's gate/lifecycle/chop behaviour. Being
// able to LOOK at the app — which the dev bridge now allows — does not replace
// these; looking checks the control you were already thinking about.
//
//   node scripts/rig-audit.js            # all suites
//   node scripts/rig-audit.js trigger    # just one (substring match)
//   node scripts/rig-audit.js palette pins  # several, one boot (what audit-for.js emits)
//   node scripts/rig-audit.js --attach   # against `npm run electron:dev`
//
// By default this launches its OWN Electron instance: muted, on a FRESH profile
// (audit-<pid>, deleted when it quits — so it cannot touch your presets and no
// run inherits what the last one's sweeps wrote) and
// on OSC port 7599 (so it cannot fight a live station for 7500). It quits it
// afterwards. Boot to first assertion is about 1.5 s.
//
// --attach runs against whatever `npm run electron:dev` already has open. Every
// suite here MUTATES the app — it dispatches actions, injects particles and
// stops the scheduler — so attach to a window you are debugging, never one you
// are playing.
//
// Not included, and why:
//   scripts/browser-audit.js — asserts what happens when electronBridge is
//     ABSENT, which an Electron instance cannot be. It stays on playwright.
//   scripts/docs-audit.js — reads files, needs no app at all.
//
// Exits non-zero if any suite reports a failure.
// ============================================================================

'use strict';

const { launch, attach } = require('./lib/rig');

const SUITES = [
  { name: 'action ranges', mod: './verify-action-ranges.js' },
  { name: 'cc mirrors',    mod: './cc-mirror-audit.js' },
  { name: 'trigger tool',  mod: './trigger-audit.js' },
  { name: 'engine pages',  mod: './engine-audit.js' },
  { name: 'mark align',    mod: './mark-align-audit.js' },
  { name: 'palette',          mod: './palette-audit.js' },
  { name: 'colour',        mod: './colour-audit.js' },
  // Last on purpose: it is the only suite that IMPORTS a session, which
  // replaces S.particles, S.commitSlots and the layer set wholesale. It hands
  // back a clean commit pool, but running it ahead of the others would still
  // have it decide what they start from.
  { name: 'pins',          mod: './pins-audit.js' },
];

(async () => {
  const args   = process.argv.slice(2);
  const doAttach = args.includes('--attach');
  const filters = args.filter(a => !a.startsWith('--'));
  const suites = filters.length ? SUITES.filter(s => filters.some(f => s.name.includes(f) || s.mod.includes(f))) : SUITES;

  if (!suites.length) {
    console.error(`no suite matches "${filters.join(' ')}". Known: ${SUITES.map(s => s.name).join(', ')}`);
    process.exit(2);
  }

  // ── THE TWO TIMING SUITES GET THEIR OWN BOOT (2026-09-13) ─────────────────
  // `trigger` measures dropped blocks in steady state and `mark align` records
  // bursts and reads their loudness off the audio clock. Neither survives
  // sharing a boot with the other: on 2026-09-13 a clean tree passed both when
  // run alone and `mark align` reported seven failures with `trigger` ahead of
  // it in the same instance, which is a false failure that costs a real
  // investigation every time. docs/AUDITS.md § 1 has said "run them alone"
  // since release 1.14 — it is a rule the tool can keep instead of the reader,
  // so each timing suite now gets a fresh instance of its own.
  // Suites that must not share an instance with anything else. `trigger` and
  // `mark align` are timing suites (see above). `colour` joined them on
  // 2026-09-13: it plays real audio through the input bus for minutes and polls
  // the bus down to silence between readings, and `pins` — which is clean 200/200
  // alone and after a plain reload — intermittently lost its reach-fan and
  // bracket counts when it followed it. Those checks need grains actually
  // sounding inside a window, which is the first thing a warm machine loses.
  const ALONE = new Set(['trigger tool', 'mark align', 'colour']);
  const results = [];
  const runGroup = async (group, rig) => {
    for (let i = 0; i < group.length; i++) {
      const s = group[i];
      // Each suite assumes a settled app: the sweeps leave every control moved,
      // and both the trigger and composer suites stop the scheduler, so hand
      // the next one a fresh renderer rather than the wreckage of the last.
      if (i > 0) await rig.reload();
      console.log(`\n${'═'.repeat(64)}\n  ${s.name}\n${'═'.repeat(64)}`);
      let failures;
      try {
        failures = await require(s.mod).run(rig);
      } catch (e) {
        console.log(`  SUITE THREW: ${e.message}`);
        failures = 1;
      }
      results.push({ name: s.name, failures });
    }
  };

  // One group per timing suite, plus one holding everything else. Attaching is
  // the exception: there is one app and the caller chose it, so the split would
  // be a lie — say so and run them in order.
  const groups = doAttach
    ? [suites]
    : [...suites.filter(s => ALONE.has(s.name)).map(s => [s]),
       suites.filter(s => !ALONE.has(s.name))].filter(g => g.length);
  if (doAttach && suites.filter(s => ALONE.has(s.name)).length > 1) {
    console.log('note: --attach cannot give the solo suites a boot each;');
    console.log('      a failure in either may be the other one\'s wake. Re-run alone.\n');
  }

  for (const group of groups) {
    const rig = doAttach ? await attach() : await launch();
    if (doAttach) console.log('attached to the running app — this WILL disturb its state\n');
    try {
      await runGroup(group, rig);
    } finally {
      if (!doAttach) await rig.close();
    }
    if (doAttach) break;
  }

  console.log(`\n${'═'.repeat(64)}`);
  let total = 0;
  for (const r of results) {
    total += r.failures;
    console.log(`  ${r.failures ? 'FAIL' : 'ok  '}  ${r.name}${r.failures ? `  — ${r.failures} failure(s)` : ''}`);
  }
  console.log(`${'═'.repeat(64)}`);
  process.exit(total ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
