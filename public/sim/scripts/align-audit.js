#!/usr/bin/env node
// ============================================================================
// align-audit.js — makes "it's aligned" a measurement instead of a claim
//
// WHY THIS EXISTS. Across 2026-08-29/30 the same failure happened six times:
// a design change was made, inspected by eye or by one spot-check, and
// reported as done — and Ek found it wrong. Every single time the cause was
// structural rather than cosmetic, and every single time a number would have
// caught it before he did:
//
//   the footer's captions on 7 baselines spanning 15px     ("you did a bad job")
//   MUTE 1.6px below DRY, exactly half a box-height gap    ("seriusly")
//   a slider tick 2.3px tall from a copied margin
//   105px of overlap between the levels rail and the audio group
//   32.4px of air above the mute icon against 18.4 below
//   a settings page whose type nothing in the contract reached
//
// None of those are subtle once measured. They were invisible because nothing
// measured them. So this file is the standing measurement: it states the
// design's invariants as assertions against the LIVE app and exits non-zero
// when one breaks.
//
// HOW IT RUNS. Through .dev-bridge/ — the same transport used to diagnose the
// running app — so it needs no browser of its own and works from anywhere with
// access to the repo folder, including a sandbox that cannot launch Electron:
//
//     npm run electron:dev          (in one terminal — the app, with the bridge)
//     node scripts/align-audit.js   (anywhere)
//
// The bridge is the point. rig-audit / engine-audit / browser-audit each spawn
// their own Electron, which is why they cannot run from Ek's Cowork sandbox at
// all. This one asks the app already on screen.
//
// WHAT AN INVARIANT LOOKS LIKE HERE. Not "these look aligned" but "these
// numbers collapse to one value". A group of captions has ONE bottom edge. A
// group of glyphs has ONE top edge. Two groups that must not overlap have a
// positive gap. A page's font sizes are a SUBSET of the sizes the contract
// names. Every assertion prints its actual spread, so a failure says how far
// off it is and a pass is evidence rather than a tick.
// ============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT   = path.resolve(__dirname, '..');
const BRIDGE = process.env.MUBONE_DEV_BRIDGE_DIR || path.join(ROOT, '.dev-bridge');
const IN     = path.join(BRIDGE, 'in');
const OUT    = path.join(BRIDGE, 'out');

const TOLERANCE = 0.5;   // sub-pixel: layout rounds, and half a pixel is not a design fault

let FAILURES = 0;
function check(ok, label, detail) {
  if (!ok) FAILURES++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  — ${detail}` : ''}`);
}

// ── A SKIP IS A FAILURE ─────────────────────────────────────────────────────
// `settings would not open; skipped` swallowed 26 of this suite's 48 checks and
// it still printed "All alignment invariants hold" and exited 0 (seen
// 2026-08-30). A suite that passes because it did not RUN is the worst state
// this project has: a red suite gets investigated, a green one that ran half of
// itself gets trusted. So a skip now costs a failure, and the message carries
// the COUNT — how much was not checked — and the reason.
//
// If a skip is ever legitimate it needs an explicit, NAMED allowance here, the
// way settings-gui.css's selector-depth allowlist works: naming it is what
// makes it reviewable, and what makes a stale one findable later. The set is
// deliberately empty — in the app's normal state (rails open) nothing skips.
const SKIP_ALLOW = new Set([]);
function skipped(label, reason, n) {
  if (SKIP_ALLOW.has(label)) {
    console.log(`  --   ${label}: ${reason} — ${n} check(s) not run, ALLOWED by name`);
    return;
  }
  FAILURES++;
  console.log(` FAIL  ${label}  — ${n} check(s) DID NOT RUN: ${reason}. A skip is a failure: ` +
    `put the app in the state the section needs, or add the label to SKIP_ALLOW with a reason.`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Run one expression in the renderer and return its value. */
async function evalInApp(src, id) {
  const tmp = path.join(IN, `${id}.tmp`);
  fs.writeFileSync(tmp, src);
  fs.renameSync(tmp, path.join(IN, `${id}.js`));
  const outF = path.join(OUT, `${id}.json`);
  try { fs.unlinkSync(outF); } catch (_) {}
  for (let i = 0; i < 120; i++) {                 // 30 s
    await sleep(250);
    if (fs.existsSync(outF)) {
      const r = JSON.parse(fs.readFileSync(outF, 'utf8'));
      if (!r.ok) throw new Error(`${r.error}\n${r.stack || ''}`);
      return r.value;
    }
  }
  throw new Error('dev bridge did not answer in 30 s');
}

function preflight() {
  const statF = path.join(BRIDGE, 'status.json');
  if (!fs.existsSync(statF)) {
    console.error('No .dev-bridge/status.json — start the app with `npm run electron:dev`.');
    process.exit(2);
  }
  const st = JSON.parse(fs.readFileSync(statF, 'utf8'));
  const ageS = (Date.now() - Date.parse(st.at)) / 1000;
  if (!st.alive || ageS > 10) {
    console.error(`The dev bridge is stale (${ageS.toFixed(0)}s old). Is the app still running?`);
    process.exit(2);
  }
  console.log(`app: pid ${st.pid}, up ${Math.round(st.uptimeSec)}s, ${st.bounds.width}×${st.bounds.height}\n`);
}

// ── The probe ───────────────────────────────────────────────────────────────
// One round trip: everything the assertions need, gathered in the renderer.
// Written as a string because it is evaluated over there, not here.
const PROBE = `
const vis = n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const box = n => { const r = n.getBoundingClientRect();
  return { x:+r.x.toFixed(2), y:+r.y.toFixed(2), r:+r.right.toFixed(2),
           b:+r.bottom.toFixed(2), w:+r.width.toFixed(2), h:+r.height.toFixed(2) }; };
const all = (sel, root) => [...(root||document).querySelectorAll(sel)].filter(vis);
const out = {};

// ── FOOTER ────────────────────────────────────────────────────────────────
const bar = document.querySelector('.bottom-bar');
if (bar) {
  out.footer = { bar: box(bar), barBorderTop: parseFloat(getComputedStyle(bar).borderTopWidth) || 0 };
  out.footer.captions = all(
    '.bottom-bar-label, .bottom-bar .bb-cap, .bottom-bar .bb-ax i, .bottom-bar .bb-mute i, ' +
    '#tcAudioSlot .audio-body > .grain-row:last-child .grain-label'
  ).map(n => ({ t: n.textContent.trim().slice(0, 10), ...box(n) }));
  out.footer.glyphs = all('.bottom-bar .bb-ax > svg, .bottom-bar .bb-mute > svg')
    .map(n => ({ t: n.parentElement.id || 'ax', ...box(n) }));
  // A GROUP is a top-level child of the bar. They must not overlap on x, and
  // each must have the same air above and below it.
  out.footer.groups = [...bar.children].filter(vis).map(n => ({
    t: (n.className || n.id || n.tagName).toString().split(' ')[0], ...box(n) }));
  // The stacked level rows: label right edge, fader left edge, readout right
  // edge. FLAT, not nested: the bridge's serialiser depth-caps at 4 and
  // out.footer.audioRows[i].lbl.r is exactly one level past it — nesting these
  // returned '[Object]' and every spread came back NaN. (Caught by this file
  // on its first run, which is the argument for this file.)
  // The footer's ROW: every group is one of these, so any box that is not the
  // same height as the others is off the grid. Sampled from a meter column
  // because that is the group whose height the row is defined from.
  const _rowRef = document.querySelector('.levels-meter-col');
  out.footer.rowRef = _rowRef && vis(_rowRef) ? box(_rowRef) : null;
  const _ab = document.querySelector('#tcAudioSlot .audio-body');
  out.footer.audioBody = _ab && vis(_ab) ? box(_ab) : null;
  out.footer.audioRows = all('#tcAudioSlot .audio-body > .grain-row').map(n => {
    const l = n.querySelector('.grain-label'), s = n.querySelector('.grain-slider'),
          v = n.querySelector('.grain-numbox');
    return { t: l ? l.textContent.trim() : '?',
             lblR: l ? box(l).r : null, sldX: s ? box(s).x : null, numR: v ? box(v).r : null };
  });
}

// ── THE BRAND ─────────────────────────────────────────────────────────────
// The chrome's mark and wordmark. The row aligns on the baseline, which is
// right for type and wrong for a square glyph — so the two are compared by
// optical CENTRE, read from a Range over the word so it is the painted glyph
// box and not the line box. A first attempt nudged the mark with a negative
// margin and measured 1.44px low, which is invisible at 18px and exactly the
// kind of thing this file exists to catch.
{
  const brand = document.querySelector('.tc-brand');
  const mark = brand && brand.querySelector('.tc-mark');
  const word = brand && brand.querySelector('b');
  if (brand && mark && word && vis(mark)) {
    const mb = mark.getBoundingClientRect();
    const rg = document.createRange(); rg.selectNodeContents(word);
    const wb = rg.getBoundingClientRect();
    out.brand = {
      markCy: +(mb.y + mb.height / 2).toFixed(2),
      wordCy: +(wb.y + wb.height / 2).toFixed(2),
      markW: +mb.width.toFixed(2), markH: +mb.height.toFixed(2),
      gap: +(wb.x - mb.right).toFixed(2),
      loaded: mark.naturalWidth > 0,
    };
  }
}

// ── TOOL RAIL ─────────────────────────────────────────────────────────────
// Opened if it is closed, and put back afterwards: a rail nobody opened is a
// rail whose alignment nobody checked, and "skipped" is the state in which
// these regressions actually shipped.
const _railWasOpen = document.body.classList.contains('props-open');
if (!_railWasOpen) {
  document.body.classList.add('props-open');
  document.getElementById('tcTools')?.classList.add('on');
  await new Promise(r => setTimeout(r, 220));
}
const rail = document.querySelector('.tc-lrail');
if (rail && vis(rail)) {
  out.rail = all('.trow', rail).map(n => ({
    t: (n.querySelector('.tile-nm')?.textContent || n.textContent).trim().slice(0, 14),
    row: box(n),
    svg: n.querySelector('svg') && box(n.querySelector('svg')),
    nm:  n.querySelector('.tile-nm') && box(n.querySelector('.tile-nm')),
    kind: n.classList.contains('trow--multi') ? 'multi'
        : n.classList.contains('trow--radio') ? 'radio' : 'none',
    // A TOOL row selects nothing since arming went (2026-09-11): a click on it
    // points the drawer, and its key plays it. Only rows that carry a real
    // choice — the lens, the source — speak the selection language.
    selects: !n.dataset.tile }));
}

if (!_railWasOpen) {
  document.body.classList.remove('props-open');
  document.getElementById('tcTools')?.classList.remove('on');
}

// ── THE PALETTE LEGEND ──────────────────────────────────────────────────────
// The line under each tile (PALETTE-GUI § 6). It lived INSIDE the 53px cell
// until 2026-09-11 and overlapped the glyph by 3.4px on every tile, and the
// round bang tile clipped both ends of its widest case — a design bug that
// shipped by eye, so it leaves this behind. Read as boxes: the strip, each
// tile, its glyph, its line, and the ink (the union of the .leg parts).
{
  const strip = document.querySelector('#paletteDock .palette');
  if (strip && vis(strip)) {
    // Two flat keys, not one nested object: the bridge serialises a box three
    // levels down as the string "[Object]", and a comparison against a string's
    // .y is false — which is a PASS. Caught on this section's first run.
    out.paletteStrip = box(strip);
    out.paletteTiles = all('.tile', strip).map((n, i) => {
      const parts = all('.leg', n).map(box);
      return { n: i + 1, t: n.querySelector('.tile-leg')?.textContent ?? '', tile: box(n),
        glyph: n.querySelector('svg:not(.leg-space)') && box(n.querySelector('svg:not(.leg-space)')),
        leg: n.querySelector('.tile-leg') && box(n.querySelector('.tile-leg')),
        ink: parts.length ? { x: Math.min(...parts.map(p => p.x)), r: Math.max(...parts.map(p => p.r)) } : null };
    });
  }
}

// ── PAGE-WIDE ─────────────────────────────────────────────────────────────
// Nothing may stick out past the window: a horizontal overflow in a fixed
// full-screen instrument is always a layout fault, never a scroll affordance.
out.overflow = [];
for (const n of document.querySelectorAll('body *')) {
  if (!vis(n)) continue;
  const r = n.getBoundingClientRect();
  if (r.right > window.innerWidth + 1 || r.left < -1) {
    out.overflow.push({ sel: n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') +
      (typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\\s+/)[0] : ''),
      left: +r.left.toFixed(1), right: +r.right.toFixed(1) });
    if (out.overflow.length > 12) break;
  }
}
return out;
`;

// The settings shell is a second probe: it has to walk ten pages, and each
// needs a beat to render.
const SETTINGS_PROBE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { S } = await import('./js/state.js');
const wasOpen = !!document.querySelector('.settings-dialog')?.offsetParent;
if (!wasOpen) { document.getElementById('tcSettings')?.click(); await sleep(700); }
const dlg = document.querySelector('.settings-dialog');
if (!dlg || !dlg.offsetParent) return { unavailable: true };
const pages = {}, ctl = {}, contentBox = {}, overlap = {}, contain = {}, tick = {}, loanAfterNav = {};
for (const nav of [...document.querySelectorAll('.set-nav-item')]) {
  nav.click(); await sleep(320);
  const host = document.querySelector('.settings-host .in-settings');
  if (!host) continue;
  const hist = {};
  for (const c of host.querySelectorAll('*')) {
    const own = [...c.childNodes].some(x => x.nodeType === 3 && x.textContent.trim());
    if (!own || !c.offsetParent) continue;
    const fs = Math.round(parseFloat(getComputedStyle(c).fontSize) * 100) / 100;
    (hist[fs] = hist[fs] || []).push(
      c.tagName.toLowerCase() + '.' + ((c.className || '').toString().split(' ')[0] || '-'));
  }
  // eg is a STRING, not an array: this object is already four deep and the
  // bridge's serialiser caps there, so an array here came back unjoinable and
  // the FAILURE path threw (v.eg.join is not a function) the first time a page
  // ever went off-contract. A report that only works while it passes is not a
  // report. No backticks in here either - this is inside a template literal.
  // Every control group ends at the same right edge, or the page has a ragged
  // side. Caught a 13px step on the sensors page the day it was written: one
  // block kept a card's old padding, which no eye would have called out.
  const rights = [...host.querySelectorAll('.set-ctl')]
    .filter(el => el.offsetParent && el.getBoundingClientRect().width > 0)
    .map(el => Math.round(el.getBoundingClientRect().right * 100) / 100);
  ctl[nav.dataset.sec] = rights.length
    ? { n: rights.length, spread: Math.round((Math.max(...rights) - Math.min(...rights)) * 100) / 100,
        at: [...new Set(rights)].sort((a,b)=>a-b).slice(0,4).join(', ') }
    : null;
  // Every field must compute border-box. A 96px box that renders 122 makes
  // every number in SETTINGS-GUI a lie, and nothing on screen says which of
  // the two you are looking at. style.css:28 sets it globally with a universal
  // selector, which is exactly the kind of rule a later reset quietly takes
  // away. (No backticks in this comment: it is inside a template literal.)
  const cb = [...host.querySelectorAll('input, select, .set-field, .set-btn')]
    .filter(el => el.offsetParent)
    .filter(el => getComputedStyle(el).boxSizing !== 'border-box')
    .map(el => el.tagName.toLowerCase() + '.' + ((el.className || '').toString().split(' ')[0] || '-'));
  // A STRING, not an array: this object is already four deep and the bridge's
  // serialiser caps there — same trap as eg above.
  contentBox[nav.dataset.sec] = [...new Set(cb)].join(', ');
  // Nothing may be left on loan after a page change. The shell MOVES real nodes
  // out of the rig cabinet (#262); until round twenty it returned them with
  // appendChild, which put them back at the END of their parent — opening
  // Settings → Pins once moved #commitPanel from index 7 to 8 of .right-panel
  // and left it there for the session. Nothing in the app noticed, because the
  // cabinet is display:none and everything addresses it by id.
  // A page's OWN body, header action and camera picker are correctly on loan
  // while it is open. What must never be on loan is a PREVIOUS page's body —
  // that is the leak. (The empty-after-close check below catches the rest.)
  loanAfterNav[nav.dataset.sec] = (S._settingsBorrowed ? S._settingsBorrowed() : [])
    .filter(b2 => b2.what.startsWith('page: ') && b2.what !== 'page: ' + nav.dataset.sec)
    .map(b2 => b2.what).join(', ');
  // Rows stack; they must not sit on top of one another. Height and right-edge
  // checks both PASS on a row whose child paints 70px past it, because neither
  // reads the next row's top. Caught the mapping page's range bar, which kept a
  // fixed 6px height from the rule its old class still had in style.css.
  const rr = [...host.querySelectorAll('.set-row')].filter(el => el.offsetParent);
  const ov = [];
  for (let i = 0; i < rr.length - 1; i++) {
    const a2 = rr[i].getBoundingClientRect(), b2 = rr[i + 1].getBoundingClientRect();
    if (a2.bottom > b2.top + 0.5) {
      const t = rr[i].querySelector('.set-row-title');
      ov.push((t ? t.textContent.trim().slice(0, 18) : 'row ' + i) + ' +' + Math.round(a2.bottom - b2.top));
    }
  }
  overlap[nav.dataset.sec] = ov.join(', ');
  // CONTAINMENT. The overlap check above catches two ROWS colliding; this
  // catches the cause — an element whose computed height does not contain what
  // it paints. The range bar reported 6px while painting 76, because the class
  // it reuses still had a fixed height in style.css, and every other check
  // passed: its right edge was right, its font was on the ramp, its track was
  // 6px. Only the next row's top edge knew.
  //
  // Overflow is legal when asked for (a scroller, an absolutely-positioned
  // marker, a deliberate clip), so this reads only elements in normal flow
  // that are not scrollable and do not clip.
  const burst = [];
  for (const el of host.querySelectorAll('*')) {
    if (!el.offsetParent || !el.children.length) continue;
    const cs2 = getComputedStyle(el);
    if (cs2.overflow !== 'visible' || cs2.position === 'absolute' || cs2.position === 'fixed') continue;
    const er = el.getBoundingClientRect();
    if (er.height === 0) continue;
    let worst = 0;
    for (const k of el.children) {
      const ks = getComputedStyle(k);
      if (!k.offsetParent || ks.position === 'absolute' || ks.position === 'fixed') continue;
      const kr = k.getBoundingClientRect();
      if (kr.height === 0) continue;
      worst = Math.max(worst, kr.bottom - er.bottom);
    }
    if (worst > 1) {
      burst.push(((el.className || '').toString().split(' ')[0] || el.tagName.toLowerCase())
        + ' h' + Math.round(er.height) + ' +' + Math.round(worst));
    }
  }
  contain[nav.dataset.sec] = [...new Set(burst)].slice(0, 6).join(', ');
  // --fs-set-tick (11.5) is the meter's alone: the dB ruler, its labels and the
  // gate's threshold caption. It is the only size below the badge, and the only
  // reason it is on the ramp at all. Anywhere else it is the instrument's
  // micro-label voice leaking back into a window (SETTINGS-GUI 1).
  const TICK_OK = '.set-meter-ruler, .set-meter-scale > span, .set-meter-thresh-val';
  const abuse = [...host.querySelectorAll('*')].filter(el => {
    if (!el.offsetParent) return false;
    if (![...el.childNodes].some(x => x.nodeType === 3 && x.textContent.trim())) return false;
    if (Math.abs(parseFloat(getComputedStyle(el).fontSize) - 11.5) > 0.05) return false;
    return !el.matches(TICK_OK);
  }).map(el => el.tagName.toLowerCase() + '.' + ((el.className || '').toString().split(' ')[0] || '-'));
  tick[nav.dataset.sec] = [...new Set(abuse)].join(', ');
  pages[nav.dataset.sec] = Object.fromEntries(
    Object.entries(hist).map(([k, v]) => [k, { n: v.length, eg: [...new Set(v)].slice(0, 3).join(', ') }]));
}
const radius = getComputedStyle(dlg).borderTopLeftRadius;
// The contract is the KIT's, so read it off the kit's own tokens rather than
// off whichever page happens to be tidy this week.
const hostEl = document.querySelector('.settings-host');
// Resolved to px through a real element, not parsed off the custom property:
// these tokens are rem, and getPropertyValue hands back "0.875rem" — parsing
// that gives 0.875, which quietly made every page fail against a ramp of
// 0.84/0.88/0.94.
const _probeEl = document.createElement('span');
hostEl.appendChild(_probeEl);
const tok = n => { _probeEl.style.fontSize = 'var(' + n + ')';
  return Math.round(parseFloat(getComputedStyle(_probeEl).fontSize) * 100) / 100; };
const tokens = { body: tok('--fs-set-body'), row: tok('--fs-set-row'), hint: tok('--fs-set-hint') };
_probeEl.remove();
if (!wasOpen) document.querySelector('.settings-dialog .close-btn')?.click();
// and after the dialog is CLOSED, the ledger must be empty outright.
document.getElementById('settingsClose')?.click();
await sleep(600);
const loanAfterClose = (S._settingsBorrowed ? S._settingsBorrowed() : []).map(b2 => b2.what + ' (' + b2.node + ')');
return { pages, radius, tokens, ctl, contentBox, overlap, contain, tick, loanAfterNav, loanAfterClose };
`;

// ── The button size set is CLOSED ───────────────────────────────────────────
// Two sizes plus the bare one: 24, 38, and content-sized. `.mu-btn--md` (32) was
// defined and deleted in the consolidation because it ended with zero users, and
// an absence is not self-enforcing — the next person to want a 32px button will
// reach for a size that no longer exists. So the rule is a check.
//
// `tc-icon` is the precedent and the answer: it IS 32px, and it is the ICON
// BUTTON — its own element, a bare glyph with no border, no background and no
// padding. A 32px thing with a box is what does not exist.
const BUTTON_SIZE_PROBE = `
const rs = [];
for (const el of document.querySelectorAll('.top-bar, .right-panel')) {
  rs.push([el, el.getAttribute('style')]);
  el.style.cssText = (el.getAttribute('style') || '') +
    ';display:block !important;position:absolute !important;left:-6000px !important;' +
    'top:0 !important;width:1400px !important;visibility:visible !important;';
}
await new Promise(r => setTimeout(r, 400));
const bad = [];
for (const e of document.querySelectorAll('.mu-btn')) {
  const r = e.getBoundingClientRect();
  if (r.height === 0) continue;
  const h = Math.round(r.height * 100) / 100;
  const bare = e.classList.contains('mu-btn--bare');
  if (!bare && h !== 24 && h !== 38) {
    bad.push((e.id || (e.className || '').toString().split(' ')[0]) + ' ' + h);
  }
}
for (const [el, p] of rs) { if (p === null) el.removeAttribute('style'); else el.setAttribute('style', p); }
return { bad };
`;

// ── The rail's one row model ────────────────────────────────────────────────
// The pinned rail carried TWO layout models — a stacked list of holds and an
// inline chip group of actions — and the chip group is what wrapped: `unpin
// all`, `pin Q` and `unpin Q` all broke to two lines inside their own buttons
// at the tracking they already had, in a 246px column. That is the bug this
// check exists to stop coming back, and it has two halves, because the wrong
// fix was available the whole time: widening the rail, or shortening the copy.
//
//   · ONE MODEL — every row's label starts at one x and every row's right
//     column ends at one x, actions and holds together. A hold is INJECTED so
//     the comparison is real on an empty rail, which is how the rail sits most
//     of the time; without it the check would only ever measure the actions
//     against themselves and pass while the two halves drifted apart.
//   · ONE LINE — no rail label wraps and none is ellipsised. `unpin all` stays
//     spelled out: it is destructive and you hit it mid-set.
const RAIL_ROW_PROBE = `
const rail = document.getElementById('tcRail');
if (!rail) return { skip: 'no #tcRail' };
const wasOpen = document.body.classList.contains('pinned-open');
if (!wasOpen) document.body.classList.add('pinned-open');
const list = document.getElementById('lyrList');
const prev = list ? list.innerHTML : null;
// A probe hold, built from the same markup ui-layers.js writes.
if (list && !list.querySelector('.lyr-hold')) {
  list.innerHTML = '<div class="lyrgroup" style="--c:#f26415">' +
    '<div class="lyr-hold" style="--m:#f26415" data-slot="0">' +
    '<button type="button" class="lyr-hold-body"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>' +
    '<span class="lyr-hold-nm">probe</span></button>' +
    '<button type="button" class="lyrmute">M</button><button type="button" class="lyrsolo">S</button></div></div>';
}
await new Promise(r => setTimeout(r, 200));
const px = v => Math.round(v * 100) / 100;
const lefts = [], rights = [], wrapped = [], clipped = [];
for (const row of rail.querySelectorAll('.lyr-act, .lyr-hold')) {
  const nm = row.querySelector('.lyr-act-nm, .lyr-hold-nm');
  const rt = row.querySelector('kbd, .lyrsolo');
  const tag = (row.dataset.pin || (nm ? nm.textContent.trim() : 'row')).slice(0, 14);
  if (nm) lefts.push([tag, px(nm.getBoundingClientRect().x)]);
  if (rt) rights.push([tag, px(rt.getBoundingClientRect().right)]);
}
// One line, and not ellipsised — the action labels and the empty state only.
// A hold's name is user text and MAY be truncated; a fixed label may not.
for (const el of rail.querySelectorAll('.lyr-act-nm, .lyr-empty')) {
  const t = el.textContent.trim().slice(0, 14);
  // COUNT LINE BOXES, not height / line-height. These labels compute
  // line-height: normal, so the height maths returns NaN and the check passes
  // on a label that is visibly on two lines — which is exactly the bug it is
  // here to catch. A Range over the text reports one rect per line box
  // whatever the line-height is.
  const rg = document.createRange(); rg.selectNodeContents(el);
  const rects = [...rg.getClientRects()].filter(r => r.width > 0 || r.height > 0);
  const lines = new Set(rects.map(r => Math.round(r.top))).size;
  if (lines > 1) wrapped.push(t + ' ' + lines + ' lines');
  // clientWidth is 0 on an inline box, which would make this vacuous; only a
  // blockified label can be ellipsised in the first place.
  if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) clipped.push(t + ' ' + el.scrollWidth + '>' + el.clientWidth);
}
// The rail's FOOT is two lines, not a paragraph (#256): a rail that is empty
// most of the time must not be the wordiest thing on screen. It carries one
// <br>, so two line boxes is the whole budget — a third means the copy grew
// past the 246px column, which is a thing you only see in a screenshot.
const footLines = (() => {
  const el = rail.querySelector('.lyr-foot');
  if (!el) return -1;
  const rg = document.createRange(); rg.selectNodeContents(el);
  const rects = [...rg.getClientRects()].filter(r => r.width > 0 || r.height > 0);
  return new Set(rects.map(r => Math.round(r.top))).size;
})();

// The rail's HEADER buttons — \`all on\` (text) and the settings door (an icon).
// They sit side by side, so they must be one height on one baseline. An icon
// button sized by its own contents came out 13px against its neighbour's 22
// and nothing on screen said so; the fix was a declared height both share, and
// this is the reading that keeps it.
const barBtns = [...rail.querySelectorAll('.lyr-bar button')].map(b => {
  const r = b.getBoundingClientRect();
  return [b.id || 'btn', px(r.height), px(r.y), px(r.x), px(r.right)];
});

if (list && prev !== null) list.innerHTML = prev;
if (!wasOpen) document.body.classList.remove('pinned-open');
return { lefts, rights, wrapped, clipped, barBtns, footLines };
`;

// ── The freeze wash ─────────────────────────────────────────────────────────
// Alt-lock's whole point is "freeze the sphere so I can go and use the UI", so
// the wash has to end at the stage: everything that FLOATS over the stage — the
// two left rails, the pinned rail, the palette — must stay on top of it and stay
// clickable. It shipped at z-index 10 against their 4, which greyed the panels
// the lock exists to reach (Ek, 2026-08-30). Read as hit-testing rather than as
// z-index numbers, because the stacking CONTEXT is what actually broke: the
// wrapper is position:relative with z-index:auto, so its children compete with
// the rails directly, and a number on its own would not have said that.
const FREEZE_PROBE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
// A modal covers the stage on purpose, so every hit test below would report
// the dialog and read as a broken z-order. Skip rather than lie.
if (document.querySelector('.mu-overlay.open')) return { unavailable: 'a modal is open' };
const mine = !document.getElementById('surfaceLockOverlay');
if (mine) {
  const { S } = await import('./js/state.js');
  if (!S._showSurfaceOverlay) return { unavailable: true };
  S._showSurfaceOverlay();
  await sleep(60);
}
const ov = document.getElementById('surfaceLockOverlay');
if (!ov) return { unavailable: true };
const stage = ov.parentElement.getBoundingClientRect();
const at = (x, y) => { const e = document.elementFromPoint(x, y); return e ? (e.id || (e.className||'').toString().split(' ')[0] || e.tagName) : null; };
const floats = [];
for (const id of ['toolRail', 'propRail', 'tcRail', 'paletteDock']) {
  const el = document.getElementById(id);
  if (!el || !el.offsetParent) continue;              // closed rails have nothing to cover
  const b = el.getBoundingClientRect();
  if (!b.width || !b.height) continue;
  const x = b.left + b.width / 2, y = b.top + Math.min(24, b.height / 2);
  const top = document.elementFromPoint(x, y);
  floats.push({ t: id, over: !!(top && el.contains(top)), hit: top ? (top.id || (top.className||'').toString().split(' ')[0] || top.tagName) : null });
}
const centre = at(stage.left + stage.width / 2, stage.top + stage.height / 2);
const z = getComputedStyle(ov).zIndex;   // read BEFORE the remove — a detached node computes to ''
if (mine) { const { S } = await import('./js/state.js'); S._hideSurfaceOverlay?.(); }
return { z, centre, floats, wasAlready: !mine };
`;

// ── The hosted-page live-update rule (static) ───────────────────────────────
// A settings section is MOVED into the shell, and `show()` takes the overlay's
// `.open` class back off (#255). So any refresh path a module gates on that
// class stops running exactly while its page is on screen: the sensors list
// never repainted on discovery, the audio meters never ran, and the LED table
// never re-synced when the cursor sensor changed. Nothing throws — the page
// just quietly goes stale, which is why this is a standing check rather than a
// bug someone notices.
//
// Legitimate uses of the class exist and are exempted: the module's own
// open/shut toggle (the same statement toggles the class), and a guard that
// lives inside a `_visible()`-style helper that also tests for the settings
// host. Everything else in a hosted module is a finding.
function auditOpenGating() {
  const shell = fs.readFileSync(path.join(ROOT, 'js', 'ui-settings.js'), 'utf8');
  const hosted = new Set([...shell.matchAll(/modal:\s*'([^']+)'/g)].map(m => m[1]));
  const findings = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter(n => n.endsWith('.js'))) {
    if (f === 'ui-settings.js') continue;                 // the shell owns #settingsModal
    const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
    if (![...hosted].some(id => src.includes(id))) continue;   // not a hosted page's module
    const lines = src.split('\n');
    // A helper that also consults the settings host is the sanctioned pattern.
    const visibleHelper = /function _visible\s*\([^)]*\)\s*\{[\s\S]*?settings-host[\s\S]*?\n\}/.test(src);
    lines.forEach((ln, i) => {
      if (!/classList\.contains\(['"]open['"]\)/.test(ln)) return;
      if (/^\s*(\/\/|\*)/.test(ln)) return;                  // a comment about it
      const near = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
      if (/classList\.(add|remove|toggle)\(['"]open['"]\)/.test(near)) return;  // its own toggle
      if (/\?\s*\w+\(\)\s*:\s*\w+\(\)/.test(ln)) return;   // `open ? shut() : open()` — also its own toggle
      if (visibleHelper && /settings-host/.test(near)) return;                     // inside _visible()
      findings.push(`${f}:${i + 1}`);
    });
  }
  return findings;
}

// ── Assertions ──────────────────────────────────────────────────────────────
const spread = xs => xs.length ? +(Math.max(...xs) - Math.min(...xs)).toFixed(2) : 0;

/** Every value in `xs` is the same, within TOLERANCE. The whole file is
 *  basically this function: a design that says "these line up" is a set of
 *  numbers that collapses, and the spread is how badly it does not. */
function collapses(label, items, key) {
  const xs = items.map(i => (key ? i[key] : i));
  const s  = spread(xs);
  const ok = s <= TOLERANCE;
  const worst = ok ? '' : (() => {
    const lo = Math.min(...xs);
    return items.filter(i => (key ? i[key] : i) - lo > TOLERANCE)
      .slice(0, 4).map(i => `${i.t ?? '?'}@${(key ? i[key] : i)}`).join(', ');
  })();
  check(ok, `${label} (n=${items.length})`, `spread ${s}px${worst ? ' · off: ' + worst : ''}`);
  return ok;
}

(async () => {
  preflight();
  const d = await evalInApp(PROBE, 'align_' + Date.now().toString(36));

  console.log('── footer ──');
  if (!d.footer) { check(false, 'footer present'); }
  else {
    collapses('every footer caption sits on one baseline', d.footer.captions, 'b');
    collapses('every footer glyph sits on one top edge',   d.footer.glyphs,   'y');
    collapses('every footer glyph sits on one bottom edge', d.footer.glyphs,  'b');


    // Equal air above and below EVERY group — the fault section 26 exists for.
    // The border-top is the footer's edge, not air inside it.
    const bt = d.footer.bar.y + (d.footer.barBorderTop || 0), bb = d.footer.bar.b;
    const airs = d.footer.groups.map(g => ({ t: g.t, above: +(g.y - bt).toFixed(2), below: +(bb - g.b).toFixed(2) }));
    const bad = airs.filter(a => Math.abs(a.above - a.below) > 1.5);
    check(bad.length === 0, 'every footer group has equal air above and below',
      bad.length ? bad.map(a => `${a.t} ${a.above}/${a.below}`).join(', ')
                 : airs.map(a => `${a.above}/${a.below}`).join(' '));

    // Groups may not overlap on x.
    const gs = [...d.footer.groups].sort((a, b) => a.x - b.x);
    const laps = [];
    for (let i = 1; i < gs.length; i++) if (gs[i].x < gs[i - 1].r - TOLERANCE)
      laps.push(`${gs[i - 1].t}↔${gs[i].t} by ${(gs[i - 1].r - gs[i].x).toFixed(1)}px`);
    check(laps.length === 0, 'no two footer groups overlap', laps.join(', ') || 'clear');

    // The stacked level rows are one column.
    // The audio group is NESTED inside .bb-side-r, so the group check above
    // never saw it — it sat 12.5px low in a 40px row for a full round and the
    // audit passed. Any box that behaves as a footer group is measured against
    // the row, wherever it lives in the tree.
    if (d.footer.rowRef && d.footer.audioBody) {
      const rr = d.footer.rowRef, ab = d.footer.audioBody;
      check(Math.abs(ab.y - rr.y) <= TOLERANCE && Math.abs(ab.b - rr.b) <= TOLERANCE,
        'the level group fills the footer row',
        `row ${rr.y}–${rr.b}, group ${ab.y}–${ab.b}`);
    }

    const ar = d.footer.audioRows.filter(r => r.sldX != null && r.numR != null);
    if (ar.length > 1) {
      collapses('level rows share a label right edge',   ar.map(r => ({ t: r.t, v: r.lblR })), 'v');
      collapses('level rows share a fader left edge',    ar.map(r => ({ t: r.t, v: r.sldX })), 'v');
      collapses('level rows share a readout right edge', ar.map(r => ({ t: r.t, v: r.numR })), 'v');
    }
  }

  console.log('\n── the brand ──');
  if (!d.brand) skipped('the brand', 'no mark in the chrome', 3);
  else {
    check(d.brand.loaded === true, 'the mark actually loaded',
      d.brand.loaded ? 'logo/mark-light.svg' : 'naturalWidth 0 — check the path and sw.js APP_SHELL');
    check(Math.abs(d.brand.markCy - d.brand.wordCy) <= TOLERANCE,
      'the mark and the wordmark share an optical centre',
      `mark ${d.brand.markCy} vs word ${d.brand.wordCy} — off by ${(d.brand.markCy - d.brand.wordCy).toFixed(2)}px`);
    check(d.brand.markW === d.brand.markH,
      'the mark is square', `${d.brand.markW}×${d.brand.markH}`);
  }

  console.log('\n── tool rail ──');
  if (!d.rail || !d.rail.length) skipped('tool rail', 'the rail is closed', 2);
  else {
    collapses('every rail row starts at one x',   d.rail.map(r => ({ t: r.t, v: r.row.x })), 'v');
    // The armed row carries the cycle mark and the ⋯, 1.4rem targets in a 17px
    // line; they set the row's height once (33.3 vs 27.9) and every pick moved
    // the list under the cursor (Ek, 2026-09-03, #327).
    collapses('every rail row is one height',     d.rail.map(r => ({ t: r.t, v: r.row.h })), 'v');
    collapses('every rail glyph starts at one x', d.rail.filter(r => r.svg).map(r => ({ t: r.t, v: r.svg.x })), 'v');
    collapses('every rail label starts at one x', d.rail.filter(r => r.nm).map(r => ({ t: r.t, v: r.nm.x })),  'v');
    // The selection model must be legible for every row that IS a choice: it
    // is radio or multi, never bare. A tool row is not a choice any more —
    // nothing is armed, so there is nothing for a mark to say — and it carried
    // `trow--radio` until 2026-09-11 purely because one brush was in the hand
    // at a time. It keeps `open`, which is the drawer's mark, not a selection.
    const rows  = d.rail.filter(r => r.selects);
    const bare  = rows.filter(r => r.kind === 'none').map(r => r.t);
    const tools = d.rail.filter(r => !r.selects && r.kind !== 'none').map(r => r.t);
    check(bare.length === 0, 'every rail row that is a choice declares how it selects', bare.join(', ') || `all classed — ${rows.length} choice row(s)`);
    check(tools.length === 0, 'a tool row claims no selection mark — nothing selects a tool', tools.join(', ') || 'none claim one');
  }

  console.log('\n── the palette legend ──');
  if (!d.paletteStrip || !d.paletteTiles?.length) skipped('the palette legend', 'the palette is empty or hidden', 5);
  else {
    const P = { strip: d.paletteStrip, tiles: d.paletteTiles }, T = P.tiles.filter(t => t.leg);
    // A profile can have every factory key removed and nothing learned — then
    // no tile has a line and there is nothing to measure. Say so, as a skip.
    if (!T.length) { skipped('the palette legend', `none of the ${P.tiles.length} tiles carries a legend (every key removed, nothing learned?)`, 5); }
    else {
    // Numbers, or nothing below is a measurement.
    const numeric = T.every(t => [t.leg.y, t.leg.b, t.tile.b, P.strip.b].every(v => typeof v === 'number'));
    check(numeric, 'the legend boxes arrived as numbers', numeric ? `${T.length} tile(s)` : JSON.stringify(T[0]).slice(0, 120));
    // Under the tile, not in it: the line starts below the outline, and the
    // glyph ends above the line — the 3.4px overlap that shipped.
    const inCell = T.filter(t => t.leg.y < t.tile.b - TOLERANCE).map(t => `${t.n}: line ${t.leg.y} < tile ${t.tile.b}`);
    check(inCell.length === 0, 'every legend line starts below its tile\'s outline', inCell.join(', ') || `${T.length} line(s), first at +${(T[0].leg.y - T[0].tile.b).toFixed(1)}px`);
    const onGlyph = T.filter(t => t.glyph && t.glyph.b > t.leg.y + TOLERANCE).map(t => `${t.n}: glyph ${t.glyph.b} > line ${t.leg.y}`);
    check(onGlyph.length === 0, 'no glyph reaches its legend line', onGlyph.join(', ') || 'clear');
    // Inside the strip: the bed reserves the line, so no ink leaves it.
    const outOfBed = T.filter(t => t.ink && (t.leg.b > P.strip.b - 1 || t.ink.x < P.strip.x + 1 || t.ink.r > P.strip.r - 1)).map(t => `${t.n} (${t.t})`);
    check(outOfBed.length === 0, 'every legend sits inside the strip\'s bed', outOfBed.join(', ') || `bed ${P.strip.h}px tall`);
    // Neighbours: a legend may be wider than its 53px column (the widest case
    // is 54px), so it is the INK of adjacent lines that must not meet.
    const meets = T.slice(1).filter((t, i) => t.ink && T[i].ink && t.ink.x < T[i].ink.r + 3).map((t, i) => `${T[i].n}→${t.n}`);
    check(meets.length === 0, 'adjacent legends keep ≥ 3px of air between their ink', meets.join(', ') || 'clear');
    }
  }

  console.log('\n── hosted pages ──');
  // The paths still gated, each waiting on its own page's conversion. The
  // check fails on anything NOT in here, so a new one cannot be added quietly,
  // and an entry is deleted as its page is converted. Empty this and the
  // allowlist can go with it. (Drop the filter to make it hard-fail today.)
  // Empty, and it should stay that way. Every hosted page now asks a _visible()
  // helper that consults the settings host as well as the overlay's `.open`
  // class — the class the shell REMOVES while the page is on screen. Keys + MIDI
  // was the last one (round eight): its monitor rendered nothing and cmd-F did
  // nothing for the whole time the page was hosted, which since #291 is always.
  const KNOWN_GATED = new Set([]);
  const gated = auditOpenGating();
  const fresh = gated.filter(g => !KNOWN_GATED.has(g));
  const still = gated.filter(g => KNOWN_GATED.has(g));
  check(fresh.length === 0, 'no NEW hosted page gates a live-update path on the overlay .open class',
    fresh.length ? fresh.join(', ') : 'none');
  if (still.length) console.log(`  --   still gated, each with its page: ${still.join(', ')}`);

  console.log('\n── overflow ──');
  check(d.overflow.length === 0, 'nothing overflows the window horizontally',
    d.overflow.map(o => `${o.sel} → ${o.right}`).join(', ') || 'clear');

  // ── The freeze wash ───────────────────────────────────────────────────────
  console.log('\n── freeze wash ──');
  const fz = await evalInApp(FREEZE_PROBE, 'freeze_' + Date.now().toString(36));
  if (fz.unavailable) skipped('freeze wash', fz.unavailable, 2);
  else {
    check(fz.centre === 'surfaceLockOverlay', 'the wash covers the sphere', `centre → ${fz.centre} (z ${fz.z})`);
    if (!fz.floats.length) skipped('floating rails above the wash', 'no rail or palette is open', 1);
    else {
      const under = fz.floats.filter(f => !f.over);
      check(under.length === 0, 'every floating rail stays above the wash',
        under.length ? under.map(f => `${f.t} → ${f.hit}`).join(', ')
                     : fz.floats.map(f => f.t).join(', '));
    }
  }

  // ── The settings type contract ────────────────────────────────────────────
  console.log('\n── settings pages ──');
  const s = await evalInApp(SETTINGS_PROBE, 'set_' + Date.now().toString(36));
  if (s.unavailable) skipped('settings pages', 'the settings dialog would not open', 26);
  else {
    // The reference used to be the `sensors` and `mapping` PAGES, whose sizes
    // were taken as the contract. That contract is retired: inside
    // #settingsModal the standard is docs/SETTINGS-GUI.md, and the ramp comes
    // from the kit's own tokens plus the two sizes the kit states as literals.
    // Reading the tokens keeps this from becoming a third opinion, and reading
    // them off .settings-host means --ui-base-px still moves them together.
    const t = s.tokens || {};
    const allowed = new Set([
      t.hint,        // 13.44 — a description, a lede, a table head, the small button
      t.body,        // 14.00 — body text, a segmented option
      13,            // a device row's sub-line, and a table row's (§ 3, twice)
      14.5,          // buttons, dropdowns, menu items, a slider's readout (§ 3)
      t.row,         // 15.04 — a row title
      16,            // a section heading (§ 2)
      12.5,          // a badge (§ 3)
      11.5,          // --fs-set-tick — the meter's dB ruler, its labels and the
                     // gate's threshold caption, and NOTHING else. An eighth
                     // size and the only one below the badge; the separate
                     // check below is what keeps it from becoming a general
                     // small-text size. It was invisible here until round seven,
                     // because the meter's rules were losing to § 24's sweep and
                     // every ruler label rendered at 14 — the ramp passed by
                     // being broken.
    ].filter(Number.isFinite));
    check(Number.isFinite(t.body) && Number.isFinite(t.row) && Number.isFinite(t.hint),
      'the kit declares its type ramp',
      `--fs-set-hint/body/row → ${t.hint}, ${t.body}, ${t.row}px`);
    for (const [sec, hist] of Object.entries(s.pages)) {
      const off = Object.entries(hist).filter(([k]) => !allowed.has(Number(k)));
      check(off.length === 0, `${sec} uses only the kit's sizes`,
        off.length ? off.map(([k, v]) => `${k}px ×${v.n} (${v.eg})`).join(' · ')
                   : Object.keys(hist).sort((a,b)=>a-b).join(', ') + 'px');
    }
    // One right edge per page — the row model's whole point on the x axis.
    for (const [sec, c] of Object.entries(s.ctl || {})) {
      if (!c) continue;
      check(c.spread <= TOLERANCE, `${sec} ends every control group at one x`,
        `n=${c.n} spread ${c.spread}px${c.spread > TOLERANCE ? ' · at ' + c.at : ''}`);
    }
    // Border-box, everywhere. A field 26px wider than its declared width is
    // invisible on screen and turns every measurement in the design doc into a
    // number that was never true.
    const cbOff = Object.entries(s.contentBox || {}).filter(([, v]) => v && v.length);
    check(cbOff.length === 0, 'every field in the settings host computes border-box',
      cbOff.length ? cbOff.map(([sec, v]) => `${sec}: ${v}`).join(' · ')
                   : `${Object.keys(s.contentBox || {}).length} pages clean`);
    const ovOff = Object.entries(s.overlap || {}).filter(([, v]) => v && v.length);
    check(ovOff.length === 0, 'no settings row overlaps the row below it',
      ovOff.length ? ovOff.map(([sec, v]) => `${sec}: ${v}`).join(' · ')
                   : `${Object.keys(s.overlap || {}).length} pages clean`);
    const cnOff = Object.entries(s.contain || {}).filter(([, v]) => v && v.length);
    check(cnOff.length === 0, 'every element contains what it paints',
      cnOff.length ? cnOff.map(([sec, v]) => `${sec}: ${v}`).join(' · ')
                   : `${Object.keys(s.contain || {}).length} pages clean`);
    const tkOff = Object.entries(s.tick || {}).filter(([, v]) => v && v.length);
    check(tkOff.length === 0, '--fs-set-tick is used only on a meter tick',
      tkOff.length ? tkOff.map(([sec, v]) => `${sec}: ${v}`).join(' · ')
                   : `${Object.keys(s.tick || {}).length} pages clean`);
    const stuck = Object.entries(s.loanAfterNav || {}).filter(([, v]) => v && v.length);
    check(stuck.length === 0, 'no node is left on loan when the settings page changes',
      stuck.length ? stuck.map(([sec, v]) => `${sec}: ${v}`).join(' · ') : `${Object.keys(s.loanAfterNav || {}).length} pages clean`);
    check((s.loanAfterClose || []).length === 0, 'the borrow ledger is empty after the dialog closes',
      (s.loanAfterClose || []).length ? s.loanAfterClose.join(', ') : 'nothing on loan');
    check(s.radius && s.radius !== '0px', 'the settings box is rounded', s.radius);
  }

  const rr = await evalInApp(RAIL_ROW_PROBE, 'railrow_' + Date.now().toString(36));
  // ── Round ten: the sensors page and the rig pills ─────────────────────────
  console.log('\n── sensors round ten ──');
  const RT_PROBE = `(async () => {
    const { S } = await import('./js/state.js');
    const IMU = await import('./js/imu-setup.js');
    // A synthesized OSC sensor: the page must be probed WITH a selected card,
    // or every card rule is vacuously green (the test-the-gesture lesson).
    const q = [0.1, 0.2, 0.05, Math.sqrt(1 - 0.0525)];
    for (let i = 0; i < 6; i++) { IMU.handleOSCSensorQuaternion('__rt10__', q);
      await new Promise(r => setTimeout(r, 25)); }
    const wasOpen = !!document.querySelector('#settingsModal.open');
    S._openSettings('sensors');
    await new Promise(r => setTimeout(r, 700));
    const card = document.querySelector('.imu-setup-card');
    const out = {
      sourcesTables: document.querySelectorAll('.set-table--sources').length,
      layerHeads: document.querySelectorAll('#imuSetupSelectedBody .set-layer-head').length,
      rowsAtRest: card ? card.querySelectorAll(':scope > .set-row:not(.set-row--disclose)').length : -1,
      discloseN: card ? card.querySelectorAll(':scope > .set-row--disclose').length : -1,
      instDoorInTemplate: /js-grp-inst/.test(document.querySelector('#imuSetupSelectedBody')?.innerHTML || '') ||
                          true /* the door renders only with storage; template carries it in ui-imu-setup.js */,
    };
    // R9/S4: both readouts (glyph + dot since 2026-09-09), offsetWidth across the states, driven not read.
    const sens = document.getElementById('tcSensor');
    const mic  = document.getElementById('tcMic');
    const lbl  = document.querySelector('#micEnableBtn span:last-child');
    const keepRig = S.rig, keepSrc = S.sourceKind, keepLbl = lbl ? lbl.textContent : null;
    const w = { sensor: new Set(), input: new Set() };
    const states = [ {}, { found: 1 }, { up: true, cursorVia: 'wifi', count: 1 },
                     { up: true, cursorVia: 'usb', count: 2 }, { lost: true } ];
    for (const st of states) { S.rig = st; await new Promise(r => setTimeout(r, 230)); w.sensor.add(sens.offsetWidth); }
    if (lbl) {
      for (const [l, sk] of [['enable mic','live'], ['mic ready','live'], ['mic ready','sampler']]) {
        lbl.textContent = l; S.sourceKind = sk; await new Promise(r => setTimeout(r, 230)); w.input.add(mic.offsetWidth);
      }
      lbl.textContent = keepLbl;
    }
    S.rig = keepRig; S.sourceKind = keepSrc;
    out.sensorWidths = [...w.sensor]; out.inputWidths = [...w.input];
    // The synthetic sensor LEAVES. Until 2026-09-09 it stayed: in the device
    // map (the header read "up · osc" on a rig with nothing connected), and
    // in both storage keys with the cursor role, where it could take the role
    // off the real instrument at the next boot.
    IMU.forgetOscSensor('__rt10__');
    out.rt10Gone = !IMU.getDevices().has('osc-__rt10__') &&
      !/__rt10__/.test((localStorage.getItem('mubone_sensor_cal') || '') + (localStorage.getItem('mubone-sensor-prefs') || ''));
    if (!wasOpen) document.querySelector('#settingsModal.open .close-btn, #settingsClose')?.click();
    return out;
  })()`;
  const rt = await evalInApp(RT_PROBE, 'rt10_' + Date.now().toString(36));
  if (rt && !rt.unavailable) {
    check(rt.sourcesTables === 0, 'Settings → Sensors renders zero .set-table--sources',
      String(rt.sourcesTables));
    // Ek reversed the brief's R4 on the rig (2026-09-01): the two layers are
    // back as 'Software settings' / 'Device settings'. One without storage.
    check(rt.layerHeads === 1 || rt.layerHeads === 2,
      'the selected sensor renders the Software/Device settings layers (1–2)',
      `${rt.layerHeads} layer heads`);
    check(rt.rowsAtRest >= 0 && rt.rowsAtRest <= 6, 'the selected sensor renders ≤6 rows at rest',
      `${rt.rowsAtRest} rows`);
    // Ek, same ruling: no disclosure doors anywhere on this page — the card
    // scrolls. (The brief's three-door shape lasted four hours.)
    check(rt.discloseN === 0, 'the selected sensor renders no disclosure doors',
      `${rt.discloseN} doors`);
    check(rt.rt10Gone === true, 'the probe sensor __rt10__ is forgotten — device, slot, saved cal and prefs',
      rt.rt10Gone ? 'gone' : 'still present');
    check(rt.sensorWidths.length === 1 && rt.inputWidths.length === 1,
      'both .tc-readouts hold one offsetWidth across every R9 state',
      `sensor ${rt.sensorWidths.join('/')} · input ${rt.inputWidths.join('/')}`);
  } else skipped('sensors round ten', 'probe unavailable', 6);
  // R10, grep-level like the borrow ledger's: the pill reads S.rig, never the
  // rendered text of the hidden footer node.
  {
    const files = require('fs').readdirSync('js').filter(f => f.endsWith('.js'));
    const bad = files.filter(f =>
      /sensorGroupStatus[^\n]*textContent/.test(require('fs').readFileSync('js/' + f, 'utf8')) &&
      f !== 'main.js');   // main.js WRITES it; that is the footer's own text
    check(bad.length === 0, 'no module reads #sensorGroupStatus.textContent', bad.join(', ') || 'none');
  }

  console.log('\n── the pinned rail row model ──');
  if (rr.skip) {
    check(false, 'the pinned rail is present', rr.skip);
  } else {
    const sp = pairs => pairs.length ? +(Math.max(...pairs.map(p => p[1])) - Math.min(...pairs.map(p => p[1]))).toFixed(2) : 0;
    const lx = sp(rr.lefts), rx = sp(rr.rights);
    check(rr.lefts.length >= 2 && lx <= TOLERANCE,
      'every rail row starts its label at one x',
      rr.lefts.length < 2 ? 'fewer than two rows found — the probe hold did not build'
        : `n=${rr.lefts.length} spread ${lx}px` + (lx > TOLERANCE ? ' · ' + rr.lefts.map(p => p.join(' ')).join(', ') : ''));
    check(rr.rights.length >= 2 && rx <= TOLERANCE,
      'every rail row ends its right column at one x',
      rr.rights.length < 2 ? 'fewer than two right columns found'
        : `n=${rr.rights.length} spread ${rx}px` + (rx > TOLERANCE ? ' · ' + rr.rights.map(p => p.join(' ')).join(', ') : ''));
    check((rr.wrapped || []).length === 0,
      'no rail label wraps',
      (rr.wrapped || []).length
        ? `${rr.wrapped.join(', ')} — the answer is NOT a wider rail and NOT shorter copy. The rail ` +
          `is 246px against the canvas and \`unpin all\` is destructive, so it stays spelled out. ` +
          `One item per row, mark left, keycap flush right — INSTRUMENT-GUI § 5.`
        : 'all one line');
    check((rr.clipped || []).length === 0,
      'no fixed rail label is ellipsised',
      (rr.clipped || []).length ? rr.clipped.join(', ') : 'nothing clipped');

    check(rr.footLines === 2,
      'the pinned rail\'s foot is two lines, not a paragraph',
      rr.footLines === -1 ? 'no .lyr-foot found' : `${rr.footLines} line(s) — #256 budgets two`);

    const bb = rr.barBtns || [];
    const hSpread = bb.length ? +(Math.max(...bb.map(b => b[1])) - Math.min(...bb.map(b => b[1]))).toFixed(2) : 0;
    const ySpread = bb.length ? +(Math.max(...bb.map(b => b[2])) - Math.min(...bb.map(b => b[2]))).toFixed(2) : 0;
    check(bb.length >= 2 && hSpread <= TOLERANCE && ySpread <= TOLERANCE,
      'the rail header\'s buttons are one height on one baseline',
      bb.length < 2 ? `only ${bb.length} header button(s) — \`all on\` and the settings door are both expected`
        : `n=${bb.length} height spread ${hSpread}px, top spread ${ySpread}px` +
          (hSpread > TOLERANCE || ySpread > TOLERANCE
            ? ' · ' + bb.map(b => `${b[0]} h=${b[1]} y=${b[2]}`).join(', ') +
              ' — they share --lyr-bar-btn-h; an icon button sized by its contents lands short'
            : ''));
    // And they group at the rail's right edge on the bar's own gap, rather than
    // being spread by the `space-between` that was correct for one button.
    const gaps = bb.slice(1).map((b, i) => +(b[3] - bb[i][4]).toFixed(2));
    check(bb.length < 2 || gaps.every(g => g >= 0 && g <= 12),
      'the rail header\'s buttons sit together, not spread across the bar',
      bb.length < 2 ? 'n/a' : `gaps ${gaps.join(', ')}px`);
  }

  // ── Sheet heads: one line each ──────────────────────────────────────────
  // Every properties sheet shares .ds-head: name · one line of description ·
  // actions flush right. The sampler's sheet put a sentence in that line and
  // the flex row folded it one word per line into a 46px column, 255px tall,
  // beside its two buttons (2026-09-03). Nothing measured heads, so it shipped.
  // Drive three sheets — a brush, a lens, the sampler — and require every head
  // child to be one line tall and every action pill unwrapped.
  console.log('\n── sheet heads ──');
  const HEAD_PROBE = `(async () => {
    const T = await import('./js/tiles.js');
    const { S } = await import('./js/state.js');
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const wasOpen = T.propsOpen(), sheetWas = document.body.classList.contains('prail-open');
    const armedWas = T.selectedTile()?.id, lensWas = document.querySelector('#toolRail [data-lens].on')?.dataset.lens,
          srcWas = S.sourceKind;
    if (!wasOpen) { T.setPropsOpen(true); await wait(300); }
    const out = [];
    // Lines, not pixels: a pill is 22px tall at a 10px face because of its
    // padding, so height ÷ font-size cannot tell one line from two; and a
    // control's inner boxes (a switch beside its label, a keycap beside a
    // glyph) sit at different tops on ONE line. So: the client rects of the
    // TEXT alone, clustered wherever they overlap vertically — one cluster
    // per line.
    const lines = el => {
      const rs = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) { if (!n.textContent.trim()) continue;
        const r = document.createRange(); r.selectNodeContents(n);
        for (const b of r.getClientRects()) if (b.width > 0) rs.push(b); }
      rs.sort((a, b) => a.top - b.top);
      let k = 0, bot = -1e9;
      for (const b of rs) { if (b.top >= bot - 2) { k++; bot = b.bottom; } else bot = Math.max(bot, b.bottom); }
      return k;
    };
    const open = async (sel, more) => {
      const row = document.querySelector(sel); if (!row) return;
      row.click(); await wait(350);
      // The ⋯ TOGGLES: an open drawer already follows the pick, so only knock
      // when it is shut, or the first sheet measured is the one just closed.
      if (more && !document.body.classList.contains('prail-open')) {
        document.querySelector(sel)?.querySelector('[data-more]')?.click(); await wait(350);
      }
      const head = document.querySelector('#propRail .ds-head'); if (!head) { out.push({ sel, missing: true }); return; }
      const kids = [...head.children].map(el => { const r = el.getBoundingClientRect();
        return { tag: el.tagName.toLowerCase(), cls: el.className, text: el.textContent.trim().slice(0, 24),
                 h: r.height, w: r.width, lines: lines(el) }; });
      out.push({ sel, headH: head.getBoundingClientRect().height, kids });
    };
    await open('#toolRail [data-tile="pen"]', true);
    await open('#toolRail [data-lens="wide"]', true);
    await open('#toolRail .src-sampler', false);
    // Put the rig back: source, lens, armed tool, and the drawer as found.
    if (srcWas !== 'sampler') S._samplerSelectSource?.(srcWas);
    if (lensWas) { document.querySelector('#toolRail [data-lens="' + lensWas + '"]')?.click(); await wait(200); }
    if (armedWas) { document.querySelector('#toolRail [data-tile="' + armedWas + '"]')?.click(); await wait(200); }
    if (!sheetWas) T.closeProps?.();
    if (!wasOpen) T.setPropsOpen(false);
    return out;
  })()`;
  const hd = await evalInApp(HEAD_PROBE, 'heads_' + Date.now().toString(36));
  if (!hd || !hd.length) skipped('sheet heads', 'no sheet opened', 3);
  else for (const h of hd) {
    if (h.missing) { check(false, `${h.sel} — sheet has a head`); continue; }
    const tall = h.kids.filter(k => k.lines > 1);
    check(h.headH > 0 && tall.length === 0, `${h.sel.replace('#toolRail ', '')} — every head child is one line`,
      tall.map(k => `${k.tag}.${k.cls || ''} "${k.text}" wraps to ${k.lines} lines`).join('; ') || `head ${Math.round(h.headH)}px`);
  }

  const bs = await evalInApp(BUTTON_SIZE_PROBE, 'btnsize_' + Date.now().toString(36));
  // ── The lens page's live columns (2026-09-07) ────────────────────────────
  // k's row carries four things beside its name — the k|all capsule, the
  // track, the typed number and the live pair — on a rail ~333px wide. At the
  // shared column widths the track measured 40px, which is not a control. The
  // invariant is the one the eye cannot check: the track keeps a floor, and
  // neither readout is clipped. `.prow--duo` already sets the precedent floor
  // at 3.5rem, so that is the number.
  console.log('\n── the lens page\'s live columns ──');
  const LENS_PROBE = `(async () => {
    const T = await import('./js/tiles.js');
    const { S } = await import('./js/state.js');
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const wasOpen = T.propsOpen(), nearWas = S.nearestMode, allWas = S.grainKAllMode;
    if (!wasOpen) { T.setPropsOpen(true); await wait(300); }
    const read = async (near, all) => {
      S.nearestMode = near; S.grainKAllMode = all;
      T.openProps('wide', 'lens'); T.renderProps(); await wait(120);
      const k = document.querySelector('#propRail .prow--lensk');
      if (!k) return null;
      const px = el => el ? el.getBoundingClientRect().width : 0;
      const note = k.querySelector('[data-klive]');
      const rows = [...document.querySelectorAll('#propRail .prow')]
        .map(p => Math.round(p.getBoundingClientRect().x));
      return {
        track: px(k.querySelector('.prow-t')),
        hasNum: !!k.querySelector('.prow-v'),
        hasCap: !!k.querySelector('.ds-chips'),
        noteClipped: note ? note.scrollWidth > note.clientWidth + 1 : false,
        noteTxt: note ? note.textContent : '',
        radiusRow: !!document.querySelector('#propRail .prow--lensr'),
        leftSpread: rows.length ? Math.max(...rows) - Math.min(...rows) : 0,
      };
    };
    const out = { areaK: await read(false, false), areaAll: await read(false, true), near: await read(true, false) };
    S.nearestMode = nearWas; S.grainKAllMode = allWas;
    T.renderProps();
    if (!wasOpen) T.setPropsOpen(false);
    return out;
  })()`;
  const lp = await evalInApp(LENS_PROBE, 'lensk_' + Date.now().toString(36));
  if (!lp || !lp.areaK) skipped('the lens page\'s live columns', 'lens sheet did not open', 4);
  else {
    check(lp.areaK.track >= 56, 'k keeps a playable track beside its capsule and its two numbers',
      `${Math.round(lp.areaK.track)}px — the floor is 56 (3.5rem), the width .prow--duo already sets`);
    check(!lp.areaK.noteClipped && !lp.near.noteClipped, 'neither live readout is clipped by its column',
      `area "${lp.areaK.noteTxt}", nearest "${lp.near.noteTxt}"`);
    check(lp.areaAll.track === 0 && !lp.areaAll.hasNum, 'uncapped draws no ceiling to set',
      `track ${Math.round(lp.areaAll.track)}px, number ${lp.areaAll.hasNum}`);
    check(!lp.near.hasCap && !lp.near.radiusRow, 'nearest drops the rows it bypasses',
      `capsule ${lp.near.hasCap}, radius row ${lp.near.radiusRow}`);
    check(lp.areaK.leftSpread === 0, 'every row on the lens page starts its label at one x',
      `spread ${lp.areaK.leftSpread}px`);
  }

  console.log('\n── button size set ──');
  check((bs.bad || []).length === 0,
    'every .mu-btn is 24, 38, or content-sized (--bare)',
    (bs.bad || []).length
      ? `${bs.bad.join(', ')} — the set is CLOSED at two sizes plus --bare. 32px was --md and was ` +
        `deleted with zero users. If you want a 32px control, tc-icon is the precedent: the ICON ` +
        `BUTTON is its own element, a bare glyph at r4/13.33 with no border, background or padding.`
      : 'the set is closed');

  // ── Settings → Instrument buttons: the gesture table ─────────────────────
  // A sixth gesture (extra long, 2026-09-10) was added to the table while the
  // grid still declared six columns, and ×3 wrapped under the titles. The
  // invariant: every head cell of .set-table--buttons on ONE line at one top,
  // one row per button, and no row past the kit's 56px table-row ceiling.
  console.log('\n── instrument buttons table ──');
  const BT_PROBE = `(async () => {
    const { S } = await import('./js/state.js');
    const wasOpen = !!document.querySelector('#settingsModal.open');
    S._openSettings('buttons');
    await new Promise(r => setTimeout(r, 600));
    const t = document.getElementById('buttonsTable');
    const head = t ? [...t.querySelector('.set-table-head').children] : [];
    const tops = new Set(head.map(c => Math.round(c.getBoundingClientRect().top)));
    const wrapped = head.filter(c => c.getBoundingClientRect().height > parseFloat(getComputedStyle(c).lineHeight) * 1.5).map(c => c.textContent);
    const cols = getComputedStyle(t.querySelector('.set-table-head')).gridTemplateColumns.split(' ').length;
    const rows = [...t.querySelectorAll('.set-table-row:not(.set-table-head)')].map(r => Math.round(r.getBoundingClientRect().height));
    // The drawn "How a button is read" table (2026-09-10): one head line, every
    // row under the 56px ceiling — its two text cells are written to two lines.
    const how = document.getElementById('buttonsHowTable');
    const howHead = how ? [...how.querySelector('.set-table-head').children].map(c => Math.round(c.getBoundingClientRect().top)) : [];
    const howRows = how ? [...how.querySelectorAll('.how-row')].map(r => Math.round(r.getBoundingClientRect().height)) : [];
    if (!wasOpen) document.querySelector('#settingsModal.open .close-btn, #settingsClose')?.click();
    return { heads: head.length, cols, tops: tops.size, wrapped, rows, howTops: new Set(howHead).size, howRows };
  })()`;
  const bt = await evalInApp(BT_PROBE, 'btntable_' + Date.now().toString(36));
  if (!bt || bt.unavailable) skipped('instrument buttons table', 'page did not open', 3);
  else {
    check(bt.cols === bt.heads, 'the buttons table declares as many columns as it has heads', `${bt.cols} columns, ${bt.heads} heads`);
    check(bt.tops === 1 && bt.wrapped.length === 0, 'every head cell of the buttons table is one line at one top',
      bt.wrapped.length ? `wrapped: ${bt.wrapped.join(', ')}` : `${bt.heads} heads, ${bt.tops} top`);
    check(bt.rows.length === 3 && bt.rows.every(h => h <= 56), 'one row per button, none past the 56px ceiling', `rows ${bt.rows.join(', ')}px`);
    check(bt.howTops === 1 && bt.howRows.length >= 9 && bt.howRows.every(h => h <= 56), 'the drawn how-a-button-is-read table: one head line, every row under 56px', `rows ${bt.howRows.join(', ')}px`);
  }

  console.log(`\n${FAILURES === 0 ? 'All alignment invariants hold.' : `${FAILURES} invariant(s) broken.`}`);
  process.exit(FAILURES === 0 ? 0 : 1);
})().catch(e => { console.error('align-audit failed:', e.message); process.exit(2); });
