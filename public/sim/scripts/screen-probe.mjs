// scripts/screen-probe.mjs — snapshot the rig view + every settings page.
// Usage: node scripts/screen-probe.mjs <label>   → /tmp/mubone-snap-<label>.txt
// The element walk lives in lib/probe.js and is asserted by probe-selftest.mjs.
import { attach } from './lib/rig.js';
import { ELEMENT_WALK } from './lib/probe.js';
import fs from 'fs';

const label = process.argv[2] || 'x';
const rig = await attach();
// PARK THE POINTER FIRST. :hover follows the real pointer, so a control the
// human happened to leave the mouse over renders in its hover face and two
// snapshots of the same build disagree — 6 lines on one settings button,
// 2026-08-30. It cannot be neutralised from inside the page (see lib/probe.js:
// pointer-events:none does not clear it), so it goes through the main process.
// Off the window entirely reads back as an empty :hover chain. This does not
// move the physical cursor; it only tells Chromium where the pointer is, and
// the human's next real move overrides it.
await rig.mouse(-20, -20);
const built = await rig.evaluate(async (walkSrc) => {
  const z = ms => new Promise(r => setTimeout(r, ms));
  const snapOf = new Function(walkSrc + '; return snapOf;')();
  const { S } = await import('./js/state.js');
  // Close settings THROUGH ITS OWN CLOSE PATH first, and wait. The pins page
  // borrows #commitPanel out of the cabinet (#262); yanking the overlay's class
  // leaves the node in the host, so the next run's rig pass finds 184 fewer
  // elements than the last. That is what two "identical" snapshots differing by
  // 368 lines turned out to be — the probe disturbing what it measures.
  // THE LEDGER, not a guess. ui-settings.js records what it has borrowed out of
  // the cabinet and from where (#262); an empty ledger is the only state in
  // which the rig is whole. This replaces a retry loop and a child count, both
  // of which were compensating for a fact the shell already had.
  const modal = document.getElementById('settingsModal');
  if (modal?.classList.contains('open')) {
    document.getElementById('settingsClose')?.click();
    await z(700);
  }
  const onLoan = (S && S._settingsBorrowed) ? S._settingsBorrowed() : [];
  if (onLoan.length) {
    throw new Error('probe: settings still has ' + onLoan.length + ' node(s) on loan — ' +
      onLoan.map(b => b.what + ' (' + b.node + ' → ' + b.parent + '[' + b.index + '])').join(', '));
  }
  // The cabinet is display:none by design (#291) and is where most of the app's
  // buttons live; revealed OFF-SCREEN AND IN PLACE so each element keeps its
  // real ancestors and its real text.
  const hidden = [];
  for (const el of document.querySelectorAll('.top-bar, .right-panel')) {
    hidden.push([el, el.getAttribute('style')]);
    el.style.cssText = (el.getAttribute('style') || '') +
      ';display:block !important;position:absolute !important;left:-6000px !important;' +
      'top:0 !important;width:1400px !important;visibility:visible !important;';
  }
  await z(500);
  let rows = snapOf(document.body, 'rig');
  for (const [el, prev] of hidden) { if (prev === null) el.removeAttribute('style'); else el.setAttribute('style', prev); }
  await z(300);
  document.getElementById('tcSettings')?.click(); await z(800);
  for (const nav of [...document.querySelectorAll('.set-nav-item')]) {
    nav.click(); await z(550);
    const host = document.querySelector('.settings-host');
    if (host) rows = rows.concat(snapOf(host, 'set:' + nav.dataset.sec));
  }
  document.querySelector('.settings-dialog .close-btn')?.click(); await z(300);
  window.__snap = rows;
  return rows.length;
}, ELEMENT_WALK);

let rows = [];
for (let i = 0; i < built; i += 400) rows = rows.concat(await rig.evaluate(a => window.__snap.slice(a, a + 400), i));
fs.writeFileSync(`/tmp/mubone-snap-${label}.txt`, rows.join('\n'));
console.log(`snapshot "${label}": ${rows.length} elements`);
