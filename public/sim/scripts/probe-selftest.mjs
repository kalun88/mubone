// ============================================================================
// scripts/probe-selftest.mjs — does the screen probe detect what it claims?
//
// Builds a synthetic page with a known set of changes and asserts the probe
// reports EXACTLY those and nothing else. Three probe fixes in three rounds
// each invalidated diffs that had already been accepted; this is what stops the
// fourth doing it again. Needs `npm run electron:dev`.
// ============================================================================
import { attach } from './lib/rig.js';
import { ELEMENT_WALK } from './lib/probe.js';

const CASES = [
  ['a moved element',        'div:2 → margin-left 40px'],
  ['a renamed class',        'div:3 → class swapped, nothing else'],
  ['a changed colour',       'div:4 → color'],
  ['reordered siblings',     'div:5 and div:6 swapped'],
  ['inside a scroller',      'div:7/div:0 → width, in an overflow:auto parent'],
];

const rig = await attach();
const res = await rig.evaluate(async (walkSrc) => {
  const z = ms => new Promise(r => setTimeout(r, ms));
  const { snapOf } = new Function(walkSrc + '; return { snapOf };')();

  const root = document.createElement('div');
  root.id = 'probeSelfTest';
  root.style.cssText = 'position:absolute;left:-7000px;top:0;width:600px;';
  root.innerHTML =
    '<div style="height:20px">untouched-0</div>' +
    '<div style="height:20px">untouched-1</div>' +
    '<div style="height:20px">moves</div>' +
    '<div class="old-name" style="height:20px">renamed</div>' +
    '<div style="height:20px;color:rgb(10,20,30)">recoloured</div>' +
    '<div style="height:20px">sib-A</div>' +
    '<div style="height:20px">sib-B</div>' +
    '<div style="height:40px;overflow:auto"><div style="width:100px;height:80px">in-scroller</div></div>' +
    '<div style="height:20px">untouched-8</div>';
  document.body.appendChild(root);
  await z(120);
  const before = snapOf(root, 't');

  // the five known mutations
  root.children[2].style.marginLeft = '40px';
  root.children[3].className = 'new-name';
  root.children[4].style.color = 'rgb(200,100,50)';
  root.insertBefore(root.children[6], root.children[5]);
  root.children[7].firstElementChild.style.width = '150px';
  await z(150);
  const after = snapOf(root, 't');

  root.remove();

  const key = l => l.split('|')[0];
  const mb = new Map(before.map(l => [key(l), l]));
  const ma = new Map(after.map(l => [key(l), l]));
  const changed = [];
  for (const [k, v] of mb) { const w = ma.get(k); if (w === undefined) changed.push([k,'gone']); else if (w !== v) changed.push([k, v, w]); }
  for (const [k] of ma) if (!mb.has(k)) changed.push([k, 'new']);
  return { nBefore: before.length, nAfter: after.length, changed };
}, ELEMENT_WALK);

const NAMES = ['x','y','w','h','font','letterSpacing','color','background','radius','borderColor','text'];
const fields = (a, b) => {
  const A = a.split('|'), B = b.split('|'), out = [];
  for (let i = 1; i < 12; i++) if (A[i] !== B[i]) out.push(`${NAMES[i-1]} ${A[i]}→${B[i]}`);
  return out.join('; ');
};

console.log(`\nsynthetic page: ${res.nBefore} elements before, ${res.nAfter} after`);
console.log('\nwhat the probe reported:');
for (const c of res.changed) {
  console.log(c.length === 3 ? `  ${c[0].padEnd(28)} ${fields(c[1], c[2])}` : `  ${c[0].padEnd(28)} ${c[1]}`);
}

// The renamed class must NOT appear: a rename with no visual effect is exactly
// what used to shift every key after it.
const ends = (k, seg) => k.endsWith('/' + seg);
const renamed = res.changed.filter(c => ends(c[0], 'div:3'));
const moved   = res.changed.filter(c => ends(c[0], 'div:2'));
const colour  = res.changed.filter(c => c.length === 3 && /color rgb\(10, 20, 30\)/.test(fields(c[1], c[2])));
const scroll  = res.changed.filter(c => c[0].includes('div:7/div:0'));

let fail = 0;
const check = (ok, what, detail) => { console.log(`  ${ok ? ' ok  ' : 'FAIL '} ${what}${detail ? '  — ' + detail : ''}`); if (!ok) fail++; };
console.log('\nassertions:');
check(moved.length === 1, 'a moved element is reported', `${moved.length} row(s)`);
check(colour.length === 1, 'a changed colour is reported', `${colour.length} row(s)`);
check(scroll.length === 1, 'a change inside a scroller is reported', `${scroll.length} row(s)`);
check(renamed.length === 0, 'a pure class rename is NOT reported', renamed.length ? renamed[0][0] : 'silent, as it should be');
check(res.changed.filter(c => ends(c[0], 'div:5') || ends(c[0], 'div:6')).length === 2,
      'reordered siblings are reported', 'both rows');
check(res.nBefore === res.nAfter, 'no element was lost or invented', `${res.nBefore} → ${res.nAfter}`);

// ── Caveat four: the same build, ACROSS A RELOAD ───────────────────────────
// The synthetic page above never reloads, which is exactly how the borrowed
// #commitPanel bug hid: two snapshots in one session agreed, and the moment a
// reload came between them the cabinet was a child short and every positional
// key after it shifted. Round eighteen read that as the app reordering panels.
// It was not; DOM order is stable. This asserts it.
console.log('\nacross a reload:');
const snapNow = async (label) => {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['scripts/screen-probe.mjs', label], { stdio: 'pipe' });
  return (await import('node:fs')).readFileSync(`/tmp/mubone-snap-${label}.txt`, 'utf8');
};
// BOTH snapshots are of a FRESH load (2026-09-14). Taking the first one of the
// session as it stands made this check fail whenever anything had been driven
// beforehand — and `audit-for.js` recommends exactly that, `npm run
// audit:align && node scripts/probe-selftest.mjs`, which can never have passed:
// align-audit opens Settings pages, and the modal builds its pages lazily, so
// it leaves ~1100 elements in the DOM (`bind-cell`, `set-table-row`,
// `set-meter-*`) that a fresh load has not built yet. Every one of those is a
// difference between "this session" and "this build", and the invariant is
// about the BUILD. Reloading first costs one more wait and makes the check say
// what it claims to say, in any order.
const reload = async () => {
  await rig.evaluate(() => { location.href = location.pathname + '?r=' + Date.now(); return 1; }).catch(() => {});
  await new Promise(r => setTimeout(r, 7500));
};
await reload();
const a1 = await snapNow('selftest1');
await reload();
const a2 = await snapNow('selftest2');
const la = a1.split('\n'), lb = a2.split('\n');
const drift = la.filter((l, i) => l !== lb[i]).length;
check(la.length === lb.length && drift === 0,
  'the same build snapshots identically across a reload',
  `${la.length} vs ${lb.length} elements, ${drift} row(s) differ`);

// ── Caveat five: WHERE THE POINTER IS ──────────────────────────────────────
// Two snapshots of the same build differed by 6 lines on one settings button,
// brighter text on a faint ground — the :hover face, because the pointer was
// resting there for one of the runs (2026-08-30). Hover is not a property of
// the build, and no dispatched DOM event can produce or clear it: it is
// hit-testing. So this moves the REAL pointer, through the main process, onto
// a control chosen for having a visible hover face, and asserts the probe
// still reads zero. It is the only assertion here that would fail if
// parkHover() were removed.
console.log('\nwith the pointer resting on a control:');
const target = await rig.evaluate(() => {
  const el = document.querySelector('#tcSettings, .tc-icon, .mu-btn');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { at: el.id || (el.className || '').toString().split(' ')[0],
           x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
});
if (!target) {
  check(false, 'a hoverable control was found to park the pointer on', 'none matched');
} else {
  await rig.mouse(4, 4);                       // somewhere inert
  const h1 = await snapNow('selftest-hover1');
  await rig.mouse(target.x, target.y);         // now sit on the control
  await new Promise(r => setTimeout(r, 400));
  // Prove the pointer really is there — otherwise this check passes vacuously.
  const hovering = await rig.evaluate(() => [...document.querySelectorAll(':hover')]
    .map(e => e.id || (e.className || '').toString().split(' ')[0]).slice(-3));
  const h2 = await snapNow('selftest-hover2');
  await rig.mouse(4, 4);
  const ha = h1.split('\n'), hb = h2.split('\n');
  const hdrift = ha.filter((l, i) => l !== hb[i]).length;
  check(hovering.includes(target.at), 'the pointer really reached the control',
    `:hover → ${hovering.join(' > ') || 'nothing'}`);
  check(ha.length === hb.length && hdrift === 0,
    'the pointer resting on a control changes nothing',
    `on ${target.at} at ${target.x},${target.y} — ${hdrift} row(s) differ`);
}

console.log(fail === 0 ? '\nThe probe reports exactly the known changes, and nothing else.' : `\n${fail} probe assertion(s) FAILED.`);
process.exit(fail === 0 ? 0 : 1);
