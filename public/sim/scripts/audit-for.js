#!/usr/bin/env node
// ============================================================================
// audit-for.js — which audit does THIS change need?
//
// The two-tier rule (docs/AUDITS.md § 1): a change runs the one suite that
// covers the files it touched; a release runs everything. This script is the
// per-change half as code, so a session does not have to remember the map or
// argue itself into running the whole set "to be safe" — which is what cost
// 5–20 minutes per change before 2026-09-05.
//
//   node scripts/audit-for.js              # print the suites for the working tree's diff
//   node scripts/audit-for.js --run        # run them, exit non-zero on any failure
//   node scripts/audit-for.js --base main  # diff against a ref instead of HEAD
//   node scripts/audit-for.js js/tiles.js  # ask about specific paths instead of the diff
//
// The MAP below is the same table as docs/AUDITS.md § 2 — keep the two identical.
// A path is tested against every row; a change to several areas runs several
// suites. Rows never name osc-audit's full sweep or browser-audit: those are
// release-only (osc: minutes of reloads for a path Ek does not use; browser:
// needs playwright). `AUDIT_ONLY=wiring` is the instant static half of osc-audit
// and is what an osc.js edit gets.
// ============================================================================

'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// [pattern, command | { rig: [suite names] }, why]. Patterns are RegExps over
// repo-relative paths. Every rig suite a change needs runs in ONE rig-audit
// boot (`rig-audit.js palette pins`), so several matches cost one Electron.
const MAP = [
  [/^js\/(tiles|brush|events|midi)\.js$/,
    { rig: ['palette'] },
    'the palette list, placing by drag, the drawer doors, the digits, both button modes'],
  [/^js\/(pins|ui-pins|composer|grain|ui-presets|ui-export|brush-voicing|renderer)\.js$/,
    { rig: ['pins'] },
    'pin groups, the restore rule, cloud claims, wet paint, reach lines, session import'],
  [/^(js\/(trigger|latency|audio)\.js|electron-main\.js|electron-preload\.js|audio-host\.js|electron-loop-probe\.js|js\/worklets\/(quad-capture|input-meter)\.worklet\.js)$/,
    { rig: ['trigger'] },
    'the proximity gate, "the button not the marks", the two audio hops and their cushion'],
  [/^js\/(paint-ticker|audio-features|grain-worklet-bridge)\.js$|^js\/worklets\/grain-engine/,
    { rig: ['mark align'] },
    'mark sizing from the audio after it, the peak offset the bridge posts'],
  [/^js\/(param-registry|state|ui-meters)\.js$|^index\.html$/,
    { rig: ['engine'] },
    'every engine row writes through a cabinet element; a deleted id kills a row silently'],
  [/^js\/(midi|accessory-registry)\.js$/,
    { rig: ['action ranges', 'cc mirrors'] },
    'half-throw readings of every ccFn; the modal/panel mirror pair'],
  [/^js\/osc\.js$/,
    'AUDIT_ONLY=wiring node scripts/osc-audit.js',
    'static cross-check of ACTIONS against the dispatch switch — instant; the full sweep is release-only'],
  [/^js\/(sensor-registry|imu-setup|sensor-mapping|ximu-settings)\.js$/,
    'npm run audit:sensor',
    'calibration maths, pure, under a second'],
  [/^css\/|^js\/(ui-settings|tile-layout)\.js$/,
    'npm run audit:align && node scripts/probe-selftest.mjs',
    'measured alignment against the running app (needs `npm run electron:dev`), and the screen probe must be green before any before/after claim; `node scripts/ui-shots.js` for the widths'],
  [/^docs\/|^CLAUDE\.md$|^README\.md$|^INSTALL\.md$|^sw\.js$|^package\.json$|^js\/[^/]+\.js$|^scripts\/audit-for\.js$/,
    'node scripts/docs-audit.js',
    'banners, table rows, versions, orphans, dead script references, CLAUDE.md size, no [x] in TODO.md'],
  [/^js\/[^/]+\.test\.mjs$|^js\/sygaldry[^/]*\.js$|^js\/worklets\/grain-engine/,
    'npm test',
    'the node unit tests — sub-second, no app'],
  [/^js\/live-loop\.js$|^js\/worklets\/live-loop/,
    'node scripts/live-loop-audit.js',
    'real-time: a loop has to wrap, ~15 s of playback; not in rig-audit'],
  [/^js\/main\.js$|^sw\.js$/,
    'node scripts/browser-audit.js',
    'browser mode itself changed — otherwise this one is release-only'],
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
if (!suites.size) {
  console.log('no suite maps to these files — run nothing, and say so:\n  ' + files.join('\n  '));
  process.exit(0);
}
for (const [cmd, { why, files: fs_ }] of suites) {
  console.log(`  ${cmd}\n      because: ${fs_.join(', ')}\n      guards:  ${why}\n`);
}
console.log(`release-only, not listed: node scripts/osc-audit.js · node scripts/browser-audit.js (docs/AUDITS.md § 1)`);

if (!run) { console.log('\n(add --run to execute)'); process.exit(0); }

let failed = 0;
for (const cmd of suites.keys()) {
  console.log(`\n${'═'.repeat(64)}\n  ${cmd}\n${'═'.repeat(64)}`);
  const r = spawnSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) { failed++; console.log(`  ✗ exit ${r.status}`); }
}
process.exit(failed ? 1 : 0);
