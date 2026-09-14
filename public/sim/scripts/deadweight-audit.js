#!/usr/bin/env node
// ============================================================================
// deadweight-audit.js — the inventory of what might be dead
//
// Read-only, no app, about a second. Lists the things in this repo that tend to
// die in place and look current (CLAUDE.md: "what costs an hour on the rig is
// the third state — still sitting in place, looking current"): modules nobody
// imports, storage keys nobody reads, actions nothing can reach but a learned
// pad, ids in index.html nothing touches, CSS classes no markup carries, stray
// files at the root, docs the rule says belong in the archive.
//
// It is an INVENTORY, not a gate — it always exits 0. Every row is a candidate
// for Ek to rule on, not a verdict: a class may be composed at runtime, a key
// may be read by a migration. Rule, then sunset in one pass, one commit per
// family, and rerun. Runs at every release (docs/AUDITS.md § 1).
//
//   node scripts/deadweight-audit.js          # everything
//   node scripts/deadweight-audit.js css ids  # just those sections
// ============================================================================

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const p = (...a) => path.join(ROOT, ...a);
const read = f => fs.readFileSync(p(f), 'utf8');
const ls = (d, re) => fs.existsSync(p(d)) ? fs.readdirSync(p(d)).filter(f => re.test(f)).map(f => `${d}/${f}`) : [];
const git = cmd => { try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };
const lastCommit = f => git(`git log -1 --format=%ad --date=short -- "${f}"`) || 'uncommitted';
const daysSince = d => d === 'uncommitted' ? 0 : Math.round((Date.now() - new Date(d)) / 86400000);
const ONLY = process.argv.slice(2);
const want = s => !ONLY.length || ONLY.includes(s);

const JS = [...ls('js', /\.js$/), ...ls('js/worklets', /\.js$/)];
const jsText = new Map(JS.map(f => [f, read(f)]));
const allJs = [...jsText.values()].join('\n');
const html = read('index.html');
// Comments stripped: a `.name` in prose ("the .io-monitor-* rows") is not a
// rule, and 25 of the 33 classes section E listed on 2026-09-13 were exactly that.
const css = ls('css', /\.css$/).map(read).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
const scriptsText = ls('scripts', /\.(js|mjs)$/).map(read).join('\n') + ls('scripts/lib', /\.js$/).map(read).join('\n');
const electronMain = read('electron-main.js');

function section(title, rows, note) {
  console.log(`\n── ${title} ──${note ? `\n   ${note}` : ''}`);
  if (!rows.length) { console.log('   (nothing)'); return; }
  for (const r of rows) console.log('   ' + r);
}
const summary = [];

// ── A. modules ──────────────────────────────────────────────────────────────
if (want('modules')) {
  const rows = [];
  for (const f of JS) {
    const base = path.basename(f);
    const importers = JS.filter(g => g !== f && jsText.get(g).includes(base)).length
      + (html.includes(base) ? 1 : 0) + (electronMain.includes(base) ? 1 : 0);
    const date = lastCommit(f), age = daysSince(date);
    if (importers === 0) rows.push(`${base.padEnd(34)} no importer          last commit ${date}`);
    else if (importers === 1 && age > 90) rows.push(`${base.padEnd(34)} one importer, ${String(age).padStart(3)} days untouched (${date})`);
  }
  section('A. modules — unimported, or one importer and untouched 90+ days', rows,
    'a declared console-only module belongs in docs-audit\'s KNOWN_ORPHANS; anything else here is a question');
  summary.push(`${rows.length} module(s)`);
}

// ── B. storage keys ─────────────────────────────────────────────────────────
if (want('keys')) {
  const reg = read('js/storage-registry.js');
  const retired = new Set([...(reg.match(/RETIRED_KEYS = \[([\s\S]*?)\]/)?.[1] || '').matchAll(/'([^']+)'/g)].map(m => m[1]));
  const keys = [...new Set([...reg.matchAll(/\{ key: '([^']+)'/g)].map(m => m[1]))];
  const rows = [];
  for (const k of keys) {
    if (retired.has(k)) continue;
    const readers = JS.filter(f => !f.endsWith('storage-registry.js') && jsText.get(f).includes(k));
    if (!readers.length) rows.push(`${k.padEnd(34)} registered, read by nothing in js/`);
  }
  section('B. storage keys — registered but no module reads or writes them', rows,
    `${retired.size} keys are in RETIRED_KEYS (deleted on sight) and are not listed`);
  summary.push(`${rows.length} storage key(s)`);
}

// ── C. actions ──────────────────────────────────────────────────────────────
if (want('actions')) {
  const midi = read('js/midi.js');
  const rows = [];
  // cc actions exist FOR the pots and never have a key — skip them; a trigger or
  // hold with no key and no dispatcher is the row worth asking about.
  for (const m of midi.matchAll(/\{ id: '([^']+)',\s*label: '([^']*)',\s*key: '([^']*)',[^\n]*?type: '([^']+)'/g)) {
    const [, id, label, key, type] = m;
    if (type === 'cc') continue;
    const others = JS.filter(f => !f.endsWith('midi.js') && jsText.get(f).includes(`'${id}'`));
    if (key === '—' && !others.length) rows.push(`${id.padEnd(24)} "${label}" (${type}) — no key, dispatched by no other module: a learned pad / OSC only`);
  }
  section('C. trigger/hold actions — no factory key and nothing but a learned binding can reach them', rows,
    'cc actions are skipped (pots are their purpose); these are reachable, so not dead by definition — the question is whether anyone has ever bound one');
  summary.push(`${rows.length} action(s)`);
}

// ── D. element ids ──────────────────────────────────────────────────────────
if (want('ids')) {
  const ids = [...new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]))];
  const rows = [];
  for (const id of ids) {
    // An id can also be an object KEY (tile-layout.js AXIS_CYCLE = { tcAzCycle: … }),
    // read back through getElementById — hence the bare-word test.
    const inJs = allJs.includes(`'${id}'`) || allJs.includes(`"${id}"`) || allJs.includes(`#${id}`)
      || new RegExp(`[{,\\s]${id}\\s*:`).test(allJs);
    const inCss = css.includes(`#${id}`);
    const inScripts = scriptsText.includes(`'${id}'`) || scriptsText.includes(`#${id}`);
    if (!inJs && !inCss && !inScripts) rows.push(`#${id}`);
  }
  section(`D. index.html ids — ${ids.length} ids; these are referenced by no js/, css/ or scripts/`, rows,
    'the cabinet (.top-bar / .right-panel) is display:none and its ids are what the engine pages write through — an unreferenced id there is dead markup');
  summary.push(`${rows.length} element id(s)`);
}

// ── E. CSS classes ──────────────────────────────────────────────────────────
if (want('css')) {
  const cls = new Set();
  for (const m of css.replace(/url\([^)]*\)/g, '').matchAll(/\.([a-zA-Z_][\w-]*)/g)) cls.add(m[1]);
  const rows = [];
  for (const c of [...cls].sort()) {
    if (html.includes(c) || allJs.includes(c) || scriptsText.includes(c)) continue;
    rows.push(c);
  }
  section(`E. CSS classes — ${cls.size} distinct; these appear in no markup, module or script`, rows.length ? [rows.join('  ')] : [],
    'substring match, so a class composed at runtime (`tile-${kind}`) can still show here — verify before deleting; `.bak` files are not read');
  summary.push(`${rows.length} CSS class(es)`);
}

// ── F. stray files ──────────────────────────────────────────────────────────
if (want('files')) {
  const known = new Set(['CHANGELOG.md', 'CLAUDE.md', 'INSTALL.md', 'README.md', 'index.html', 'sw.js', 'package.json', 'package-lock.json',
    'electron-main.js', 'electron-preload.js', 'serve.py', '.gitignore', '.claude', 'node_modules', 'js', 'css', 'docs', 'scripts', 'sandbox',
    'logo', 'build', 'dist', 'localhost.pem', 'localhost-key.pem', '.git', '.dev-bridge', '.DS_Store', '.fuse_hidden',
    'flake.nix', 'flake.lock',   // the Nix dev shell (65f2757) — kept, Ek uses Nix for firmware (TODO-DONE-2026-09)
  ]);
  const refs = read('package.json') + read('README.md') + (fs.existsSync(p('INSTALL.md')) ? read('INSTALL.md') : '') + read('CLAUDE.md')
    + ls('docs', /\.md$/).map(read).join('') + scriptsText + allJs + html + electronMain;
  const rows = [];
  for (const f of fs.readdirSync(ROOT)) {
    if (known.has(f) || f.startsWith('.fuse_hidden')) continue;
    const referenced = refs.includes(f);
    rows.push(`${f.padEnd(24)} ${referenced ? 'referenced' : 'REFERENCED NOWHERE'}   last commit ${lastCommit(f)}`);
  }
  const bak = git('git ls-files').split('\n').filter(f => /\.bak\d*$|\.orig$|~$/.test(f));
  for (const f of bak) rows.push(`${f.padEnd(24)} tracked backup file (build excludes *.bak; git already remembers every version)`);
  section('F. root and backup files not in the known set', rows);
  summary.push(`${rows.length} stray file(s)`);
}

// ── G. docs ─────────────────────────────────────────────────────────────────
if (want('docs')) {
  const rows = [];
  for (const f of ls('docs', /\.md$/)) {
    const t = read(f); const banner = (t.match(/\*\*Status: ([^*]+)\*\*/) || [])[1] || '';
    const kb = (Buffer.byteLength(t) / 1024).toFixed(0);
    if (/HISTORICAL/.test(banner)) rows.push(`${f.padEnd(44)} ${kb.padStart(3)} KB  HISTORICAL still in docs/ — archive when nothing open depends on it`);
    else if (Buffer.byteLength(t) > 20 * 1024 && !t.includes('**Read this first.**') && !/TODO|RULINGS|AUDITS/.test(f))
      rows.push(`${f.padEnd(44)} ${kb.padStart(3)} KB  over 20 KB with no "Read this first" block`);
  }
  if (fs.existsSync(p('sandbox'))) {
    const n = git('git ls-files sandbox | wc -l').trim(); const kb = Math.round(Number(git('git ls-files -z sandbox | xargs -0 wc -c | tail -1').trim().split(/\s+/)[0] || 0) / 1024);
    rows.push(`sandbox/${' '.repeat(36)} ${String(kb).padStart(3)} KB in ${n} tracked files — git log --diff-filter=D finds a deletion forever`);
  }
  section('G. docs and the sandbox', rows);
  summary.push(`${rows.length} doc row(s)`);
}

// ── H. open TODO items by age ───────────────────────────────────────────────
if (want('todo')) {
  const t = read('docs/TODO.md'); let head = '', rows = [], counts = {};
  for (const l of t.split('\n')) { if (/^##+ /.test(l)) head = l.replace(/^#+ /, ''); else if (/^- \[ \]/.test(l)) counts[head] = (counts[head] || 0) + 1; }
  for (const [h, n] of Object.entries(counts)) rows.push(`${String(n).padStart(3)}  ${h}`);
  section('H. open TODO items by section — the sections from spring are the ones to triage', rows);
  summary.push(`${Object.values(counts).reduce((a, b) => a + b, 0)} open TODO item(s)`);
}

console.log(`\n${'─'.repeat(64)}\ninventory: ${summary.join(' · ')}\nrule on each row, sunset in one pass per family, rerun.`);
