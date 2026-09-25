#!/usr/bin/env node
// ============================================================================
// audit-for.js — which audit does THIS change need?
//
// The three-tier rule (docs/AUDITS.md § 1, Ek 2026-09-18: "they take a ton of
// time and seem to run everything i do a little edit. i can't work like this"):
//
//   1. per change, always — the FAST rows: file-only checks, under a second
//      together. This is the default, and the only thing `--run` runs.
//   2. on Ek's word — the SLOW rows: anything that boots Electron or playwright
//      or waits on real time. Printed under "on request" with the exact
//      command; `--slow` includes them in the run. Nobody runs these because
//      a file was touched; they run when the change is ABOUT the thing they
//      measure and Ek asks.
//   3. at release — everything (`/release`).
//
// Before this, the map was per file and a colour constant in renderer.js ran
// the 206-check pins suite: six rig suites, 5 min 41 s, on 2026-09-18.
//
//   node scripts/audit-for.js              # print the fast suites for the diff, list the slow ones
//   node scripts/audit-for.js --run        # run the fast ones, exit non-zero on any failure
//   node scripts/audit-for.js --run --slow # run the slow ones too
//   node scripts/audit-for.js --base main  # diff against a ref instead of HEAD
//   node scripts/audit-for.js js/tiles.js  # ask about specific paths instead of the diff
//
// The MAP below is the same table as docs/AUDITS.md § 2 — keep the two identical.
// A path is tested against every row. Rows never name osc-audit's full sweep or
// browser-audit's release role: osc is minutes of reloads for a path Ek does
// not use; `AUDIT_ONLY=wiring` is its instant static half and is what an
// osc.js edit gets.
// ============================================================================

'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// [pattern, command | { rig: [suite names] }, why]. Patterns are RegExps over
// repo-relative paths. Every rig suite a change needs runs in ONE rig-audit
// boot (`rig-audit.js palette pins`), so several matches cost one Electron.
// A row is FAST when its command is in FAST below; every other row is slow.
const FAST = new Set([
  'npm run audit:sensor',
  'AUDIT_ONLY=wiring node scripts/osc-audit.js',
  'node scripts/docs-audit.js',
  'npm test',
]);
const MAP = [
  [/^js\/(tiles|brush|events|midi)\.js$/,
    { rig: ['palette'] },
    'the palette list, placing by drag, the drawer doors, the digits, both button modes'],
  [/^js\/(pins|ui-pins|composer|grain|ui-presets|ui-export|piece|mubone-file|brush-voicing|renderer)\.js$/,
    { rig: ['pins'] },
    'pin groups, the restore rule, cloud claims, wet paint, reach lines, the piece round trip'],
  [/^(js\/(trigger|latency|audio)\.js|electron-main\.js|electron-preload\.js|audio-host\.js|electron-loop-probe\.js|js\/worklets\/(quad-capture|input-meter)\.worklet\.js)$/,
    { rig: ['trigger'] },
    'the proximity gate, "the button not the marks", the two audio hops and their cushion'],
  [/^js\/(grain|grain-worklet-bridge|trigger|ui-meters)\.js$|^js\/worklets\/grain-engine/,
    { rig: ['lens'] },
    'the cursor reads what its tab says: radius, depth, k / all, nearest, scope, dwell grain, walk, the cap, fade, step'],
  [/^js\/(paint-ticker|audio-features|grain-worklet-bridge)\.js$|^js\/worklets\/grain-engine/,
    { rig: ['mark align'] },
    'mark sizing from the audio after it, the peak offset the bridge posts'],
  [/^js\/(audio-features|ui-viz)\.js$/,
    { rig: ['colour'] },
    'the room cannot decide a hue, the axis can see the vowel space, the arc reaches every family, the bounds stay constants'],
  [/^js\/(param-registry|state|ui-meters)\.js$|^index\.html$/,
    { rig: ['engine'] },
    'every engine row writes through a cabinet element; a deleted id kills a row silently'],
  [/^js\/(midi|accessory-registry)\.js$/,
    { rig: ['action ranges', 'cc mirrors'] },
    'half-throw readings of every ccFn; the modal/panel mirror pair'],
  [/^js\/osc\.js$/,
    'AUDIT_ONLY=wiring node scripts/osc-audit.js',
    'static cross-check of ACTIONS against the dispatch switch — instant; the full sweep is release-only'],
  [/^js\/(sensor-registry|imu-setup|ximu-settings)\.js$/,
    'npm run audit:sensor',
    'calibration maths, pure, under a second'],
  // index.html IS routed — to rig-audit engine, which checks that every engine
  // row still writes through its cabinet element. What it was never routed to
  // is the ALIGNMENT suite, and a new GUI element is markup in this file. So on
  // exactly the change class that keeps going wrong, all 108 measured checks —
  // the spacing scale, the kit sizes, the row model, the copy cap — sat out.
  [/^css\/|^index\.html$|^js\/(ui-settings|tile-layout)\.js$/,
    'npm run audit:align && node scripts/probe-selftest.mjs',
    'measured alignment against the running app (needs `npm run electron:dev`), and the screen probe must be green before any before/after claim; `node scripts/ui-shots.js` for the widths'],
  [/^docs\/|^CLAUDE\.md$|^README\.md$|^INSTALL\.md$|^sw\.js$|^package\.json$|^js\/[^/]+\.js$|^scripts\/audit-for\.js$/,
    'node scripts/docs-audit.js',
    'banners, table rows, versions, orphans, dead script references, CLAUDE.md size, no [x] in TODO.md'],
  [/^js\/[^/]+\.test\.mjs$|^js\/sygaldry[^/]*\.js$|^js\/worklets\/grain-engine/,
    'npm test',
    'the node unit tests — sub-second, no app'],
  [/^js\/main\.js$|^sw\.js$/,
    'node scripts/browser-audit.js',
    'browser mode itself changed — otherwise this one is release-only'],
  [/^js\/mobile\.js$/,
    'node scripts/phone-audit.js',
    'the phone: mobile mode on, chrome hidden, the tap-to-begin flow, the motion permission inside the tap, a gyro event, a touch as the spacebar (playwright, ~1 min)'],
];

function changedFiles(base) {
  const sh = cmd => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const set = new Set([
    ...sh(`git diff --name-only ${base}`),
    ...sh('git diff --name-only --cached'),
    ...sh('git ls-files --others --exclude-standard'),
  ]);
  return [...set].filter(f => fs.existsSync(path.join(ROOT, f)));
}

const args = process.argv.slice(2);
const run = args.includes('--run');
const slow = args.includes('--slow');
const bi = args.indexOf('--base');
const base = bi >= 0 ? args[bi + 1] : 'HEAD';
const explicit = args.filter((a, i) => !a.startsWith('--') && !(bi >= 0 && i === bi + 1));
const files = explicit.length ? explicit : changedFiles(base);

const suites = new Map(); // command -> { why, files }
const rig = { names: new Set(), why: [], files: [] };
for (const f of files) {
  for (const [re, cmd, why] of MAP) {
    if (!re.test(f)) continue;
    if (cmd.rig) { cmd.rig.forEach(n => rig.names.add(n)); rig.why.push(why); rig.files.push(f); continue; }
    if (!suites.has(cmd)) suites.set(cmd, { why, files: [] });
    suites.get(cmd).files.push(f);
  }
}
if (rig.names.size) {
  const cmd = 'node scripts/rig-audit.js ' + [...rig.names].map(n => n.includes(' ') ? `"${n}"` : n).join(' ');
  suites.set(cmd, { why: [...new Set(rig.why)].join('; '), files: [...new Set(rig.files)] });
}

if (!files.length) { console.log('no changed files'); process.exit(0); }
console.log(`${files.length} changed file(s)${explicit.length ? '' : ` against ${base}`}\n`);
const fast = [...suites].filter(([c]) => FAST.has(c));
const rest = [...suites].filter(([c]) => !FAST.has(c));
if (!suites.size) {
  console.log('no suite maps to these files — run nothing, and say so:\n  ' + files.join('\n  '));
  process.exit(0);
}
const show = ([cmd, { why, files: fs_ }]) =>
  console.log(`  ${cmd}\n      because: ${fs_.join(', ')}\n      guards:  ${why}\n`);
console.log(fast.length ? 'per change (fast, file-only):' : 'per change: nothing — no fast check covers these files');
fast.forEach(show);
if (rest.length) {
  console.log(`on request only (boots the app, minutes) — run when the change is ABOUT what it measures and Ek asks; \`--slow\` includes them:`);
  rest.forEach(show);
}
console.log(`at release, always: node scripts/rig-audit.js · node scripts/osc-audit.js · node scripts/browser-audit.js (docs/AUDITS.md § 1)`);

if (!run) { console.log('\n(add --run to execute the fast ones; --run --slow for all of the above)'); process.exit(0); }

let failed = 0;
const toRun = (slow ? [...suites] : fast).map(([c]) => c);
if (!toRun.length) { console.log('\nnothing to run'); process.exit(0); }
for (const cmd of toRun) {
  console.log(`\n${'═'.repeat(64)}\n  ${cmd}\n${'═'.repeat(64)}`);
  const r = spawnSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) { failed++; console.log(`  ✗ exit ${r.status}`); }
}
process.exit(failed ? 1 : 0);
