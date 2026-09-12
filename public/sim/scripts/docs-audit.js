#!/usr/bin/env node
// ============================================================================
// docs-audit.js — keeps the map matching the territory
//
// mubone's defence against a session reasoning from stale material is a set of
// conventions: every doc carries a status banner, CLAUDE.md's table says which
// to read, and a js/ module is live iff index.html can reach it. Conventions
// hold exactly as long as someone remembers them. On 2026-08-23 all three had
// slipped at once — CLAUDE.md claimed 1.12 through the whole 1.13 cycle, a
// 335-line CURRENT doc was missing from the table, and two orphan modules sat
// in js/ with headers describing keystrokes that do nothing.
//
// Every check here is one of those failures, made mechanical. No dependencies
// and no browser: it reads files and exits non-zero.
//
//   node scripts/docs-audit.js
//
// The known-orphan allowlist below is the one place that needs a human. A
// module that is deliberately console-only belongs in it, with a note saying
// so; anything else reaching this list is either dead or unwired by mistake.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const p = (...a) => path.join(ROOT, ...a);
const read = f => fs.readFileSync(p(f), 'utf8');

let FAILURES = 0;
function check(ok, label, detail) {
  if (!ok) FAILURES++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  — ${detail}` : ''}`);
}

// Modules that are unreachable from index.html on purpose. CLAUDE.md's
// "Off-main-GUI work" section is the policy; this is its enforcement copy.
// Adding a name here is a claim that the module is meant to be loaded from the
// DevTools console — not a way to silence the check.
const KNOWN_ORPHANS = {
  // empty since 2026-09-05: ui-trace.js, the last entry, was deleted. Adding a
  // name here is a claim, not a silencer — see the note above.
};

const STATUSES = ['CURRENT', 'DESIGN INTENT', 'HISTORICAL', 'PROPOSAL', 'MIXED', 'ARCHIVED'];

// ── 1. Every doc states its own status ──────────────────────────────────────
// A banner is what protects a session that opens a file directly, without ever
// consulting the table. It has to be in the first few lines and it has to name
// one of the statuses CLAUDE.md defines.
function bannerOf(file) {
  const head = read(file).split('\n').slice(0, 8).join('\n');
  const m = head.match(/^>.*?\*\*Status:\s*([^*\n]+)/m);
  return m ? m[1].trim().replace(/[.,—-]\s*$/, '') : null;
}

function checkBanners(docs) {
  console.log('\n── status banners ──');
  const missing = docs.filter(d => !bannerOf(d));
  check(missing.length === 0, 'every doc carries a status banner', missing.join(', '));

  const unknown = docs
    .filter(d => bannerOf(d))
    .filter(d => !STATUSES.some(s => bannerOf(d).toUpperCase().startsWith(s)));
  check(unknown.length === 0, 'every banner names a known status',
    unknown.map(d => `${d}: "${bannerOf(d)}"`).join('; '));
}

// ── 2. The table covers the docs, and only real docs ────────────────────────
// A doc with no row is one nobody is told to read. A row with no doc sends a
// session looking for a file that isn't there.
function checkTable(docs) {
  console.log('\n── CLAUDE.md reference table ──');
  const claude = read('CLAUDE.md');
  const rows = new Map();
  for (const line of claude.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map(c => c.trim());
    if (cells.length < 4) continue;
    for (const m of cells[1].matchAll(/`([^`]+\.md)`/g)) rows.set(m[1], cells[2]);
  }

  const listed = new Set([...rows.keys()]);
  const unlisted = docs.filter(d => !listed.has(d));
  check(unlisted.length === 0, 'every doc has a table row', unlisted.join(', '));

  const dangling = [...listed].filter(f => !fs.existsSync(p(f)) && !f.includes('*'));
  check(dangling.length === 0, 'every table row resolves to a file', dangling.join(', '));

  // The table's status and the doc's own banner are two copies of one fact, so
  // they drift. Compare only the leading word: the table abbreviates.
  const drift = docs.filter(d => {
    const banner = bannerOf(d), row = rows.get(d);
    if (!banner || !row) return false;
    const head = s => (s.toUpperCase().match(/[A-Z ]+/) || [''])[0].trim().split(' ')[0];
    return head(banner) !== head(row.replace(/[⚠️\s]*/, ''));
  });
  check(drift.length === 0, 'table status matches each doc\'s own banner',
    drift.map(d => `${d}: banner "${bannerOf(d)}" vs table "${rows.get(d)}"`).join('; '));
}

// ── 3. CLAUDE.md's version claims match the code ────────────────────────────
// CLAUDE.md is read first and trusted most, so a stale version there is worth
// more than a stale version anywhere else. Release step 5 exists because of it.
function checkVersions() {
  console.log('\n── version consistency ──');
  const pkg = JSON.parse(read('package.json')).version;          // 1.13.0-alpha
  const short = pkg.replace(/^(\d+\.\d+)\.\d+-(.+)$/, '$1 $2');  // 1.13 alpha

  const ui = (read('index.html').match(/top-bar-version">([^<]+)</) || [])[1];
  check(ui === short, 'index.html version matches package.json', `ui="${ui}" pkg="${short}"`);

  const cache = (read('sw.js').match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1];
  check(cache === `mubone-${pkg}`, 'sw.js CACHE_VERSION matches package.json',
    `sw="${cache}" want="mubone-${pkg}"`);

  const claude = read('CLAUDE.md');
  const stale = [...claude.matchAll(/\b(\d+\.\d+)\s*alpha\b/g)]
    .map(m => m[1])
    .filter(v => v !== short.split(' ')[0]);
  check(stale.length === 0, 'CLAUDE.md quotes no other version',
    stale.length ? `found ${[...new Set(stale)].join(', ')}, expected ${short}` : '');

  // The release checklist's one-liner finds modules MISSING from APP_SHELL;
  // this is the other direction: an entry whose file was deleted. One stale
  // path fails the whole cache.addAll at install, so a deploy carrying it
  // breaks offline for every visitor — found the day #208 deleted three
  // modules and nothing complained.
  const shell = [...read('sw.js').matchAll(/'\.\/((?:js|css)\/[^']+)'/g)].map(m => m[1]);
  const dead  = shell.filter(p => !fs.existsSync(path.join(ROOT, p)));
  check(dead.length === 0, 'every APP_SHELL entry in sw.js resolves to a file',
    dead.length ? `deleted but still listed: ${dead.join(', ')}` : '');
}

// ── 4. js/ has no accidental orphans ────────────────────────────────────────
// The gate CLAUDE.md declares — a module is live iff main.js reaches it — is
// only a gate if something walks the graph. ui-trace.js sat outside it for
// months while sharing a name with a live feature.
function checkOrphans() {
  console.log('\n── js/ reachability ──');
  const entries = [...read('index.html').matchAll(/src="(?:\.\/)?js\/([\w.-]+\.js)"/g)].map(m => m[1]);
  check(entries.length > 0, 'index.html loads at least one js/ module');

  const importsOf = (f) => {
    const file = p('js', f);
    if (!fs.existsSync(file)) return [];
    const s = fs.readFileSync(file, 'utf8');
    return [...s.matchAll(/(?:from|import)\s*\(?\s*['"]\.\/([\w.-]+\.js)['"]/g)].map(m => m[1]);
  };

  const seen = new Set();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    stack.push(...importsOf(f).filter(x => !seen.has(x)));
  }

  const all = fs.readdirSync(p('js')).filter(f => f.endsWith('.js'));
  const orphans = all.filter(f => !seen.has(f));
  const unexpected = orphans.filter(f => !(f in KNOWN_ORPHANS));
  check(unexpected.length === 0,
    'every js/ module is reachable from index.html, or a known console-only module',
    unexpected.length ? `${unexpected.join(', ')} — wire it up, delete it, or add it to KNOWN_ORPHANS with a reason` : '');

  // The allowlist rots the other way too: a module that got wired up, or
  // deleted, leaves a stale entry claiming something untrue.
  const ghosts = Object.keys(KNOWN_ORPHANS).filter(f => !orphans.includes(f));
  check(ghosts.length === 0, 'KNOWN_ORPHANS lists nothing that is now live or gone',
    ghosts.map(f => `${f} — ${all.includes(f) ? 'now reachable' : 'no longer exists'}`).join('; '));

  if (orphans.length) {
    console.log(`       console-only, as declared: ${orphans.filter(f => f in KNOWN_ORPHANS).join(', ')}`);
  }
}

// ── 5. Nothing points into sandbox/ as if it were live ──────────────────────
// sandbox/ is where dead work goes. A runtime module reaching into it would
// mean something in there is load-bearing after all, which defeats the folder.
function checkSandbox() {
  console.log('\n── sandbox isolation ──');
  if (!fs.existsSync(p('sandbox'))) { check(true, 'no sandbox/ to check'); return; }

  const offenders = fs.readdirSync(p('js'))
    .filter(f => f.endsWith('.js'))
    // An IMPORT, not a mention. Sunset notes name the folder a file moved to
    // ("… is in sandbox/sunset-2026-08-28/"), and matching any quoted string
    // flagged every one of those comments as an offence (#269).
    .filter(f => /^\s*(?:import|export)[^\n]*['"][^'"]*sandbox\//m
      .test(fs.readFileSync(p('js', f), 'utf8'))
      || /\bimport\s*\(\s*['"][^'"]*sandbox\//.test(fs.readFileSync(p('js', f), 'utf8')));
  check(offenders.length === 0, 'no js/ module imports from sandbox/', offenders.join(', '));

  const files = JSON.parse(read('package.json')).build.files;
  check(files.includes('!sandbox/**'), 'build.files excludes sandbox/');
  check(!files.some(f => f.startsWith('max/')), 'build.files no longer packs max/');
}

// ── 6. Every doc path anyone cites actually resolves ────────────────────────
// Archiving a doc is the moment its inbound links go stale, and a link into
// docs/ that no longer exists sends a session hunting for a file rather than
// reading the one that replaced it. Explicit paths only — a bare "FOO.md" in
// prose is too ambiguous to chase.
function checkLinks() {
  console.log('\n── doc cross-references ──');
  const sources = [
    'CLAUDE.md', 'README.md', 'INSTALL.md', 'css/style.css',
    ...fs.readdirSync(p('docs')).filter(f => f.endsWith('.md')).map(f => `docs/${f}`),
    ...fs.readdirSync(p('docs/archive')).filter(f => f.endsWith('.md')).map(f => `docs/archive/${f}`),
  ].filter(f => fs.existsSync(p(f)));

  const broken = [];
  for (const src of sources) {
    for (const m of read(src).matchAll(/docs\/(?:archive\/)?[\w.-]+\.md/g)) {
      if (!fs.existsSync(p(m[0]))) broken.push(`${src} → ${m[0]}`);
    }
  }
  check(broken.length === 0, 'every docs/ path cited in prose resolves', [...new Set(broken)].join('; '));
}


// ── 7. The settings stylesheet does not restart the specificity arms race ────
// style.css § 24 swept every span / div / p inside `.settings-host` at a depth
// that outranked the kit's own class rules, so each kit element had to be
// restated one level deeper to win. That cost two rounds of measurement to find
// twice — the rules were read, the elements were not — and § 24 is gone (round
// ten). This is what stops it coming back: inside settings-gui.css a selector
// may be `.settings-host .in-settings` plus ONE step. A deeper one is a
// component describing its own parts, which is fine, but it has to be named
// here so adding a page-level sweep is a deliberate act.
//
// `.in-settings` is part of the floor, not decoration, and it is the load-bearing
// half — not `html body`. Dropping it from all 209 selectors while KEEPING
// `html body` moved six of the ten pages and every control-group right edge:
// 1265 → 1222 on audio, sensors, mapping, feedback, view, keys and session,
// 1241 on pins and 882 on viz, with 11.04 and 12.48 reappearing in the type
// ramp. Dropping `html body` instead cost two rules and no geometry. Measured
// round ten, both directions.
const DEEP_OK = new Set([
  '.settings-host .device--commit.in-settings .seq-section',
  '.settings-host .device--commit.in-settings .seq-section-body',
  '.settings-host .device--commit.in-settings .seq-section-body > .set-row',
  '.settings-host .device--commit.in-settings .seq-section-label',
  '.settings-host .device--commit.in-settings .set-row .grain-numbox',
  '.settings-host .device--commit.in-settings .set-sec-title',
  '.settings-host .device--commit.in-settings .set-sec-title:first-child',
  '.settings-host .in-settings .grain-seg .grain-seg-btn',
  '.settings-host .in-settings .grain-seg .grain-seg-btn.active',
  '.settings-host .in-settings .grain-seg .grain-seg-btn:hover',
  '.settings-host .in-settings .led-row.is-active .led-fn-name',
  '.settings-host .in-settings .led-row.is-active .led-fn-name::before',
  '.settings-host .in-settings .led-row.is-off .led-fn-name',
  '.settings-host .in-settings .map-detail-head > .set-btn',
  '.settings-host .in-settings .mapping-legend code',
  '.settings-host .in-settings .mapping-legend em',
  '.settings-host .in-settings .mapping-legend p',
  '.settings-host .in-settings .mapping-legend p:last-child',
  '.settings-host .in-settings .mapping-legend strong',
  '.settings-host .in-settings .mapping-range-bar .set-meter-band',
  '.settings-host .in-settings .mapping-range-bar .set-meter-peak',
  '.settings-host .in-settings .scale-menu-row > .set-field',
  '.settings-host .in-settings .scale-menu-row > span:first-child',
  '.settings-host .in-settings .set-ctl > .as-dim',
  '.settings-host .in-settings .set-ctl > .set-meter-row',
  '.settings-host .in-settings .set-device .map-live + .set-badge',
  '.settings-host .in-settings .set-device .map-tx',
  '.settings-host .in-settings .set-device .set-table-sub',
  '.settings-host .in-settings .set-field > input',
  '.settings-host .in-settings .set-field > input:focus',
  '.settings-host .in-settings .set-field--host > input',
  '.settings-host .in-settings .set-field--wide > input',
  '.settings-host .in-settings .set-row--disclose.open .set-chevron',
  '.settings-host .in-settings .set-table .imu-setup-pol-btn',
  '.settings-host .in-settings .set-table .imu-setup-pol-btn.reversed',
  '.settings-host .in-settings .set-table--keys .set-row-title',
  '.settings-host .in-settings .set-table--keys .set-table-row',
  '.settings-host .in-settings .set-table--keys .set-table-row--group',
  '.settings-host .in-settings .set-table--led .set-select--sm',
  '.settings-host .in-settings .set-table--led .set-table-row',
  '.settings-host .in-settings .set-toolbar.filtering .set-search-clear',
  '.settings-host .in-settings tr:hover td',
  '.settings-host .map-sentence > span',
  '.settings-host .set-devices .set-empty',
  '.settings-host .set-devices-head > .set-btn',
  '.settings-host .set-devices-head > span',
  '.settings-host .set-menu-item[aria-checked="true"] > svg',
  '.settings-host .set-meter-row--gate .set-meter-track',
  '.settings-host .set-meter-ruler .set-meter-clip',
  '.settings-host .set-meter-ruler > .set-meter-scale',
  '.settings-host .set-meter-scale > span',
  '.settings-host .set-meter-scale > span:last-child',
  'html body .settings-host .in-settings .grain-seg .grain-seg-btn',
  'html body .settings-host .in-settings .set-ctl > .as-val',
]);

function checkSettingsDepth() {
  console.log('\n── settings-gui.css selector depth ──');
  const css = fs.readFileSync(p('css/settings-gui.css'), 'utf8');
  const depth = (sel) => {
    let t = sel.trim();
    for (const pre of ['html body .settings-host', '.settings-host']) {
      if (t.startsWith(pre)) { t = t.slice(pre.length).trim(); break; }
    }
    if (t.startsWith('.in-settings')) t = t.slice('.in-settings'.length).trim();
    return t.replace(/>/g, ' ').split(/\s+/).filter(Boolean).length;
  };
  const offenders = [], unscoped = [];
  for (const m of css.matchAll(/^([^\n{}@][^\n{}]*)\{/gm)) {
    for (const raw of m[1].split(',')) {
      const sel = raw.trim();
      if (!sel || sel.startsWith('/*')) continue;
      // The shell's own chrome is outside the host on purpose: the nav and the
      // header are siblings of the scrolling page, not part of it.
      if (!/^(html body )?\.settings-host\b/.test(sel)) {
        if (!/^(html body )?(:root|\.settings-dialog|\.mu-dialog\.settings-dialog|\.settings-nav|\.settings-head|\.set-nav-)/.test(sel))
          unscoped.push(sel.slice(0, 70));
        continue;
      }
      if (depth(sel) > 1 && !DEEP_OK.has(sel)) offenders.push(sel.slice(0, 90));
    }
  }
  check(offenders.length === 0,
    'no selector is deeper than .settings-host .in-settings + one step, outside the allowlist',
    offenders.length ? [...new Set(offenders)].join(' · ') : `${DEEP_OK.size} allowlisted`);
  check(unscoped.length === 0, 'every rule is scoped to .settings-host',
    unscoped.length ? [...new Set(unscoped)].join(' · ') : 'all scoped');
  // An allowlist that outlives its rule is the same staleness this file exists
  // to catch everywhere else.
  const gone = [...DEEP_OK].filter(sel => !css.includes(sel));
  check(gone.length === 0, 'the allowlist names nothing that has been deleted',
    gone.length ? gone.join(' · ') : 'none stale');
}


// ── 8. style.css carries no NEW raw colour ──────────────────────────────────
// The app's colours live in tokens.css. style.css still holds 82 hex literals
// across 53 distinct colours — pre-August, from before the tokens existed — and
// they come out a few at a time as each consolidation round reaches them. This
// list is the ceiling, not a target: a literal that is not here, or one that
// appears more often than it does here, fails. When a round tokenises some, the
// numbers come DOWN and the list is edited to match. It never goes up.
//
// Colour is the one thing a "tidy-up" must never change quietly, so this is
// paired with the screen-diff probe: the audit stops a new literal, the probe
// stops an old one being swapped for a token that is not the same colour.
//
// THIS LIST IS NOT A TO-DO LIST. The ~50 greys left in it stay (Ek, 2026-08-30):
// warming them is a visible change with no functional gain, and the budget's
// job is to stop them growing, not to schedule their removal. Pay one down only
// when its region is already being touched for another reason — never as a push.
const HEX_BUDGET = new Map([
  ['#000000', 2],
  ['#17140f', 1],
  ['#232323', 1],
  ['#252015', 1],
  ['#252525', 1],
  ['#262626', 5],
  ['#282828', 1],
  ['#2a1e0a', 1],
  ['#2a4a2a', 1],
  ['#2e2e2e', 2],
  ['#3a3020', 2],
  ['#3a6a3a', 1],
  ['#4dcc7a', 1],
  ['#50b850', 1],
  ['#585858', 2],
  ['#5a5a5a', 1],
  ['#5a8a8a', 1],
  ['#5e5e5e', 2],
  ['#606060', 1],
  ['#666', 1],
  ['#6a8', 1],
  ['#7a5a1a', 1],
  ['#7abcbc', 10],
  ['#7eb8e0', 1],
  ['#857f76', 1],
  ['#85b0a9', 2],
  ['#86b2ab', 1],
  ['#8aa6bc', 1],
  ['#8ab', 1],
  ['#9ed0f0', 1],
  ['#a66', 1],
  ['#a86', 1],
  ['#b25555', 1],
  ['#c08e85', 1],
  ['#c793a2', 1],
  ['#c8dce8', 3],
  ['#cfa870', 1],
  ['#d0d0d0', 1],
  ['#e03030', 2],
  ['#e05050', 2],
  ['#e05555', 3],
  ['#e0c860', 1],
  ['#e0c888', 1],
  ['#e57373', 2],
  ['#e83030', 1],
  ['#e8a65d', 2],
  ['#e8c840', 1],
  ['#f0b040', 1],
  ['#f0b84a', 1],
  ['#f26415', 3],
  ['#f99', 1],
  ['#ffb3b3', 1],
  ['#ffcda9', 1],
]);

function checkHexLiterals() {
  console.log('\n── style.css raw colours ──');
  const css = fs.readFileSync(p('css/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const seen = new Map();
  for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const h = m[0].toLowerCase();
    seen.set(h, (seen.get(h) || 0) + 1);
  }
  const added = [], grew = [];
  for (const [h, n] of seen) {
    const cap = HEX_BUDGET.get(h);
    if (cap === undefined) added.push(h);
    else if (n > cap) grew.push(`${h} ${cap}→${n}`);
  }
  check(added.length === 0, 'no new raw colour in style.css',
    added.length ? added.join(', ') : `${seen.size} distinct, all within budget`);
  check(grew.length === 0, 'no allowlisted colour is used more than before',
    grew.length ? grew.join(' · ') : 'none grew');
  // Not a failure — the point of the list is to shrink, and this is the nudge.
  const shrunk = [];
  for (const [h, cap] of HEX_BUDGET) {
    const n = seen.get(h) || 0;
    if (n < cap) shrunk.push(`${h} ${cap}→${n}`);
  }
  const total = [...seen.values()].reduce((a, b) => a + b, 0);
  console.log(`  --   ${total} literals over ${seen.size} colours` +
    (shrunk.length ? ` · tighten HEX_BUDGET: ${shrunk.join(', ')}` : ' · budget is exact'));
}


// ── 9. CLAUDE.md's module list names only modules that exist ────────────────
// The `js/` line in the repo-structure block is a list of modules, and it named
// `staging` for months after staging stopped existing — no file, no markup, no
// way in, only 74 CSS selectors. A doc that says a feature ships is more
// expensive than the dead CSS it leaves behind, because it is what sends the
// next session hunting for it. This is the cheap shape of "every feature called
// shipped has something live behind it": a named module resolves to a file.
function checkModuleList() {
  console.log('\n── CLAUDE.md module list ──');
  const md = fs.readFileSync(p('CLAUDE.md'), 'utf8');
  const m = md.match(/^js\/\s+— all modules \(flat:([^)]*)\)/m);
  if (!m) { check(false, 'the js/ module list is present in CLAUDE.md'); return; }
  const named = m[1].split(',').map(x => x.trim()).filter(x => x && x !== 'etc.' && !x.includes(' '));
  // The list names FAMILIES, not filenames — "ui" stands for ui-*.js — so a
  // name counts as present if any module starts with it.
  const files = fs.readdirSync(p('js')).filter(f => f.endsWith('.js'));
  const missing = named.filter(n => {
    const lo = n.toLowerCase();
    return !files.some(f => f.toLowerCase() === lo + '.js' || f.toLowerCase().startsWith(lo + '-'));
  });
  check(missing.length === 0, 'every module CLAUDE.md names resolves to a file in js/',
    missing.length ? missing.join(', ') : `${named.length} named, all present`);
}


// ── 10. INSTRUMENT-GUI's radius scale matches the tokens ────────────────────
// The instrument kit states six radii by value. A design doc that can go stale
// silently is how this project started — CLAUDE.md called three sunset features
// shipped for months. The radius line is the part of that file most likely to
// drift, because a token is a one-character edit, so it is the part that gets a
// check. The rest of the file is a measurement away (scripts/screen-probe.mjs).
function checkInstrumentRadii() {
  console.log('\n── INSTRUMENT-GUI radius scale ──');
  const md = fs.readFileSync(p('docs/INSTRUMENT-GUI.md'), 'utf8');
  const tk = fs.readFileSync(p('css/tokens.css'), 'utf8');
  const line = md.match(/^`--r-0`.*$/m);
  if (!line) { check(false, 'the radius scale line is present in INSTRUMENT-GUI'); return; }
  const stated = [...line[0].matchAll(/`(--r-[\w-]+)`\s+(\d+)/g)].map(m => [m[1], m[2]]);
  const bad = [];
  for (const [name, val] of stated) {
    const m = tk.match(new RegExp('\\' + name + ':\\s*([^;]+);'));
    const real = m ? m[1].trim().replace('px', '') : '(absent)';
    if (real !== val) bad.push(`${name} doc says ${val}, tokens.css says ${real}`);
  }
  check(bad.length === 0, 'every radius INSTRUMENT-GUI states matches tokens.css',
    bad.length ? bad.join(' · ') : `${stated.length} radii agree`);
}

// ── 11. Every script a doc tells you to run exists ──────────────────────────
// CLAUDE.md told sessions to run `scripts/composer-audit.js` for weeks after it
// was sunset into pins-audit. Check 9 catches a dead js/ module; this is the
// same shape for scripts/ and for `npm run` names. A line that SAYS the script
// is gone ("no longer exists", "sunset") is the one allowed way to name one.
function checkScriptRefs() {
  console.log('\n── script references ──');
  const sources = ['CLAUDE.md', 'README.md', 'scripts/audit-for.js',
    ...fs.readdirSync(p('docs')).filter(f => f.endsWith('.md')).map(f => `docs/${f}`)]
    .filter(f => fs.existsSync(p(f)));
  const npm = Object.keys(JSON.parse(read('package.json')).scripts || {});
  const dead = [], deadNpm = [];
  for (const src of sources) {
    for (const line of read(src).split('\n')) {
      if (/no longer exists|sunset|was deleted|is gone/i.test(line)) continue;
      for (const m of line.matchAll(/scripts\/((?:lib\/)?[\w.-]+\.(?:m?js|sh|command))/g)) {
        if (!fs.existsSync(p('scripts', m[1]))) dead.push(`${src} → scripts/${m[1]}`);
      }
      for (const m of line.matchAll(/npm run ([\w:-]+)/g)) {
        if (!npm.includes(m[1])) deadNpm.push(`${src} → npm run ${m[1]}`);
      }
    }
  }
  check(dead.length === 0, 'every scripts/ path cited in docs resolves', [...new Set(dead)].join('; '));
  check(deadNpm.length === 0, 'every "npm run" cited in docs is in package.json', [...new Set(deadNpm)].join('; '));
}

// ── 12. The two files every session reads stay small ───────────────────────
// On 2026-09-05 CLAUDE.md was 72 KB and TODO.md 415 KB, both read in full at the
// start of every session, and TODO.md was 181 finished items to 68 open. That
// reading was most of the "5–20 minutes per change". Done items live in
// docs/archive/TODO-DONE-<month>.md; rulings live in docs/RULINGS.md; audit
// reasoning lives in docs/AUDITS.md. These two checks are what keeps them there.
const CLAUDE_MD_BUDGET = 32 * 1024;
function checkSessionWeight() {
  console.log('\n── session start-up weight ──');
  const size = fs.statSync(p('CLAUDE.md')).size;
  check(size <= CLAUDE_MD_BUDGET, `CLAUDE.md stays under ${CLAUDE_MD_BUDGET / 1024} KB`,
    `${(size / 1024).toFixed(1)} KB — move the reasoning to docs/RULINGS.md or docs/AUDITS.md`);
  const todo = read('docs/TODO.md');
  const done = todo.split('\n').filter(l => /^\s*- \[x\]/i.test(l)).length;
  check(done === 0, 'docs/TODO.md carries no finished items',
    done ? `${done} [x] item(s) — move them to docs/archive/TODO-DONE-<month>.md` : '');
  const tsize = Buffer.byteLength(todo);
  check(tsize <= 96 * 1024, 'docs/TODO.md stays under 96 KB', `${(tsize / 1024).toFixed(1)} KB`);
}

// ── run ─────────────────────────────────────────────────────────────────────
const docs = fs.readdirSync(p('docs'))
  .filter(f => f.endsWith('.md'))
  .map(f => `docs/${f}`);

checkBanners(docs);
checkTable(docs);
checkVersions();
checkOrphans();
checkSandbox();
checkLinks();
checkSettingsDepth();
checkHexLiterals();
checkModuleList();
checkInstrumentRadii();
checkScriptRefs();
checkSessionWeight();

console.log(FAILURES === 0
  ? `\nAll doc/staleness checks passed (${docs.length} docs).`
  : `\n${FAILURES} check(s) FAILED.`);
process.exit(FAILURES === 0 ? 0 : 1);
