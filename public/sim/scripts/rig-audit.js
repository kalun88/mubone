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

  const rig = doAttach ? await attach() : await launch();
  if (doAttach) console.log('attached to the running app — this WILL disturb its state\n');

  const results = [];
  try {
    for (let i = 0; i < suites.length; i++) {
      const s = suites[i];
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
  } finally {
    if (!doAttach) await rig.close();
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
