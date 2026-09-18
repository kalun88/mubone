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

// ── ONE OPTICAL SIZE FOR EVERY MAIN-PAGE GLYPH (2026-09-14) ───────────────
// The BOXES were one size for a year while the DRAWINGS inside them ran
// 11.5 → 18.3px, which is what the eye reads: the cog was half again the
// broom beside it, and the camera button changed size with the camera mode.
// --gk (style.css) scales each glyph's geometry to the garbage can's
// 13.3px. Measured here as bbox × (svg box / viewBox) — the transform is on
// the CONTENTS, so the svg's own box is unscaled and the ratio is the truth.
// A redrawn path moves its bbox and needs a new factor; that is the drift
// this catches.
{
  const glyphs = [];
  // Chromium leaves a var()-fed division as "calc(2.02931px)" in the computed
  // value — already divided, still wrapped — and parseFloat reads NaN off it.
  const swPx = v => { const f = parseFloat(v); if (!isNaN(f)) return f;
    const m = /(-?[\\d.]+)px/.exec(v || ''); return m ? +m[1] : NaN; };
  const meas = (n, tag) => {
    for (const svg of n.querySelectorAll('svg')) {
      if (getComputedStyle(svg).display === 'none') continue;
      let bb = null; try { bb = svg.getBBox(); } catch (_) { continue; }
      const r = svg.getBoundingClientRect(); if (!r.width || !bb.width) continue;
      const vb = (svg.getAttribute('viewBox') || '0 0 24 24').trim().split(/[ ,]+/).map(Number);
      const per = r.width / (vb[2] || 24);
      // getBBox on the root already includes the children's own scale, so the
      // drawn size needs no k. The STROKE does: stroke-width is declared in
      // user units, before that transform, so the pen on screen is
      // sw x per x k — which is the whole point of the divisor in the CSS.
      const k = parseFloat(getComputedStyle(svg).getPropertyValue('--gk')) || 1;
      glyphs.push({ t: tag || n.id || 'glyph',
        v: +(Math.max(bb.width, bb.height) * per).toFixed(2),
        sw: +(swPx(getComputedStyle(svg).strokeWidth) * per * k).toFixed(2) });
    }
  };
  for (const b of all('.tc-bar .tc-icon, .tc-bar .tc-readout')) meas(b);
  for (const b of all('.bottom-bar .bb-ax, .bottom-bar .bb-mute')) meas(b);
  out.glyphs = glyphs;
}

// ── THE CHROME'S TWO RUNS ─────────────────────────────────────────────────
// Equal space between every icon that is not across a divider (Ek,
// 2026-09-14), on both sides of the bar. Measured as the gap between
// neighbouring controls inside one .tc-grp; a group boundary is the divider's
// business and is not in this list.
{
  // BUTTONS only: they are the ones that share a box, so their gap is exact.
  // The recording gauge has no button around it and is spaced by its ink
  // instead — the second measurement below, which is the one that reads the
  // way the eye does.
  const runs = [];
  for (const grp of all('.tc-bar .tc-grp')) {
    const kids = all('button', grp).filter(k => k.closest('.tc-grp') === grp);
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1].getBoundingClientRect(), b = kids[i].getBoundingClientRect();
      runs.push({ t: (kids[i - 1].id || '?') + '→' + (kids[i].id || '?'), v: +(b.left - a.right).toFixed(2) });
    }
  }
  out.chromeRun = runs;
  // …and the same run measured as INK: where the glyph actually paints. The
  // box gap above is exact and says nothing about a control with no button
  // around it — the recording gauge sat 14.1px from the garbage can while
  // every pair of icons left ~24, and the box gap was 4.8px for both
  // (2026-09-14). Spread here is naturally 2px, since matched-height glyphs
  // still differ in WIDTH, so this is bounded rather than collapsed.
  const inkBox = el => {
    const svg = el.querySelector('svg');
    if (svg) { let bb; try { bb = svg.getBBox(); } catch (_) { return null; }
      const r = svg.getBoundingClientRect(); if (!r.width) return null;
      const vb = (svg.getAttribute('viewBox') || '0 0 24 24').trim().split(/[ ,]+/).map(Number);
      const per = r.width / (vb[2] || 24);
      return { l: r.left + bb.x * per, r: r.left + (bb.x + bb.width) * per }; }
    const r = el.getBoundingClientRect();
    return r.width ? { l: r.left, r: r.right } : null;
  };
  const inks = [];
  for (const grp of all('.tc-bar .tc-grp')) {
    const kids = all('button, .tc-rec', grp).filter(k => k.closest('.tc-grp') === grp);
    for (let i = 1; i < kids.length; i++) {
      const a = inkBox(kids[i - 1]), b = inkBox(kids[i]);
      if (a && b) inks.push({ t: (kids[i - 1].id || '?') + '→' + (kids[i].id || kids[i].className), v: +(b.l - a.r).toFixed(2) });
    }
  }
  out.chromeInk = inks;
}

// ── ONE BRIGHTNESS ACROSS BOTH BARS (Ek, 2026-09-14) ──────────────────────
// "the brightness of the stuff in the footer bar is not the same as the top,
// match top." The chrome's glyphs were --text-subtle and the footer's
// --text-dim, 40 luma apart, which reads as two families. A glyph in a STATE
// (muted, mapped, dry-on, a disabled history arrow) is a colour with a
// meaning and is excluded — the rest must agree.
{
  const stateful = el => el.classList.contains('tc-dis') || el.classList.contains('muted')
    || el.classList.contains('is-mute') || el.classList.contains('is-map')
    || el.classList.contains('on') || el.classList.contains('live')
    || el.classList.contains('found') || el.classList.contains('lost');
  const ink = [];
  for (const b of all('.tc-bar .tc-icon, .tc-bar .tc-readout, .bottom-bar .bb-ax, .bottom-bar .bb-mute'))
    if (!stateful(b)) ink.push({ t: b.id || 'glyph', v: getComputedStyle(b).color });
  out.glyphInk = ink;
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
    // The binding is a STICKER on the tile's bottom-left corner (PALETTE-GUI
    // § 11.5): its box, and the tile's, and the bed's.
    out.paletteTiles = all('.tile', strip).map((n, i) => {
      const st = n.querySelector('.tile-bind');
      return { n: i + 1, t: st?.textContent ?? '', tile: box(n),
        glyph: n.querySelector('svg:not(.leg-space)') && box(n.querySelector('svg:not(.leg-space)')),
        leg: st && box(st) };
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
// THE SENSOR CARD IS A TEMPLATE, AND NOTHING BUILDS IT HERE (2026-09-14).
// ui-sygaldry.js render() clones #sygInstrumentTpl once per CONNECTED link, and
// an audit runs with nothing plugged in — so the sensors page renders zero
// cards and every check below has been enumerating a page that is missing its
// eleven rows. Not a query bug: document.querySelectorAll never sees template
// content either, so the fix has to BUILD the card, not look harder.
// One place, here, rather than in each of the checks that walks these pages.
// It is removed again before the next page so the probe cannot disturb what it
// measures - the same rule screen-probe.mjs learned the hard way.
let _stand = null;
const buildTemplateCard = () => {
  const tpl = document.getElementById('sygInstrumentTpl');
  const host = document.querySelector('.settings-host .in-settings');
  if (!tpl || !host || host.querySelector('.syg-instrument')) return null;
  const node = tpl.content.cloneNode(true);
  const holder = document.createElement('div');
  holder.dataset.auditStandIn = '1';
  holder.appendChild(node);
  host.appendChild(holder);
  return holder;
};
for (const nav of [...document.querySelectorAll('.set-nav-item[data-sec]')]) {
  if (_stand) { _stand.remove(); _stand = null; }
  nav.click(); await sleep(320);
  if (nav.dataset.sec === 'sensors') { _stand = buildTemplateCard(); await sleep(260); }
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
if (_stand) { _stand.remove(); _stand = null; }   // never leave the stand-in behind
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
// A probe track and a probe bus, built from the same markup ui-pins.js
// writes (the mixer, 2026-09-16), so an empty rail still measures.
const bus = document.getElementById('lyrBus');
const prevBus = bus ? bus.innerHTML : null;
if (list && !list.querySelector('.lyr-trk')) {
  list.innerHTML = '<div class="lyr-trk" style="--c:var(--eng-tape)" data-slot="0">' +
    '<div class="lyr-trk-bar"><div class="lyr-fill"></div><button type="button" class="lyr-num">1</button>' +
    '<div class="lyr-mat"><canvas></canvas></div><div class="lyr-ph" hidden></div><span class="lyr-db"></span><div class="lyr-edge"></div>' +
    '<span class="lyr-ms"><button type="button" class="lyrmute">M</button><button type="button" class="lyrsolo">S</button></span></div>' +
    '<div class="lyr-fold"></div></div>';
  if (bus && !bus.querySelector('.lyr-bus-row')) {
    bus.innerHTML = '<div class="lyr-bus-row" style="--c:var(--eng-tape)"><div class="lyr-fill"></div>' +
      '<span class="lyr-bus-nm">loops<b>1</b></span><span class="lyr-ms"><button type="button" class="lyrmute">M</button><button type="button" class="lyrsolo">S</button></span></div>';
  }
}
await new Promise(r => setTimeout(r, 200));
const px = v => Math.round(v * 100) / 100;
const lefts = [], rights = [], wrapped = [], clipped = [];
// The pin rows are TOOL ROWS (.trow, 2026-09-12): one label x across the pin
// and mix groups. A track is not a row with a label — it is a bar (below).
for (const row of rail.querySelectorAll('.trow')) {
  const nm = row.querySelector('.tile-nm');
  const rt = nm;
  const tag = (row.dataset.pin || (nm ? nm.textContent.trim() : 'row')).slice(0, 14);
  if (nm) lefts.push([tag, px(nm.getBoundingClientRect().x)]);
  if (rt) rights.push([tag, px(rt.getBoundingClientRect().right)]);
}
// One line, and not ellipsised — the action labels and the empty state only.
// A hold's name is user text and MAY be truncated; a fixed label may not.
for (const el of rail.querySelectorAll('.trow .tile-nm, .lyr-empty')) {
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

// The rail's HEADER buttons. There were two — \`all on\` (text) and the settings
// door (an icon) — and the invariant demanded both, which is what it said when
// the all-on button was deleted on 2026-09-15 (it became mute all / unmute all
// in the rail's own MIX group, where they can be dragged onto the palette and
// given keys; a header button can do neither). The measurement that mattered was
// the COUNT: it is that buttons sitting side by side share a height and a
// baseline — an icon button sized by its own contents came out 13px against its
// neighbour's 22 and nothing on screen said so. So the spread is still asserted,
// on however many there are, and one button trivially passes it.
const barBtns = [...rail.querySelectorAll('.lyr-bar button')].map(b => {
  const r = b.getBoundingClientRect();
  return [b.id || 'btn', px(r.height), px(r.y), px(r.x), px(r.right)];
});

// THE MIXER (2026-09-16). What a glance-only surface has to get right is that
// its objects are ONE set of edges and ONE set of heights: every track bar,
// every bus row and the mode bar's content box start and end at the same x;
// a bar is 32 tall and a bus 24 (the kit's heights); M and S are the 18px
// pair, centred on whatever they sit in; the header's count and its door share
// a centre line, as do a track's number and its bar.
const mid = el => { const r = el.getBoundingClientRect(); return px(r.y + r.height / 2); };
const mix = (() => {
  const bars = [...rail.querySelectorAll('.lyr-trk-bar')], buses = [...rail.querySelectorAll('.lyr-bus-row')];
  const modes = rail.querySelector('.lyr-modes');
  if (!bars.length || !modes) return null;
  const cs = getComputedStyle(modes), mr = modes.getBoundingClientRect();
  const edge = b => { const r = b.getBoundingClientRect(); return [px(r.x), px(r.right), px(r.height)]; };
  const ms = [...rail.querySelectorAll('.lyr-trk-bar .lyrmute, .lyr-trk-bar .lyrsolo, .lyr-bus-row .lyrmute, .lyr-bus-row .lyrsolo')]
    .map(b => { const r = b.getBoundingClientRect(); const p = b.closest('.lyr-trk-bar, .lyr-bus-row').getBoundingClientRect();
                return [px(r.height), px((r.y + r.height / 2) - (p.y + p.height / 2))]; });
  const cnt = rail.querySelector('.lyr-slots-n'), door = rail.querySelector('#lyrSettings');
  const num = rail.querySelector('.lyr-trk-bar .lyr-num');
  return {
    n: bars.length, nb: buses.length,
    modeL: px(mr.x + parseFloat(cs.paddingLeft)), modeR: px(mr.right - parseFloat(cs.paddingRight)),
    bars: bars.map(edge), buses: buses.map(edge), ms,
    segs: [...rail.querySelectorAll('.lyr-modes .seg-pill')].map(e => px(e.getBoundingClientRect().height)),
    // The chrome-density segment as it renders ELSEWHERE in the chrome — the
    // rail's two must be the same control at the same size, whatever that is.
    refSeg: (() => { const o = [...document.querySelectorAll('.seg-pill')].find(e => !rail.contains(e) && e.offsetHeight > 0); return o ? px(o.getBoundingClientRect().height) : null; })(),
    swH: rail.querySelector('.lyr-modes .mu-switch') ? px(rail.querySelector('.lyr-modes .mu-switch').getBoundingClientRect().height) : null,
    rowMids: [...rail.querySelectorAll('.lyr-mrow')].map(r => [...r.children].filter(c => c.offsetWidth > 0).map(mid)),
    cntMid: cnt ? mid(cnt) : null, doorMid: door ? mid(door) : null,
    numMid: num ? mid(num) : null, barMid: mid(bars[0]),
  };
})();

if (list && prev !== null) list.innerHTML = prev;
if (bus && prevBus !== null) bus.innerHTML = prevBus;
if (!wasOpen) document.body.classList.remove('pinned-open');
return { lefts, rights, wrapped, clipped, barBtns, footLines, mix };
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

// ── SPACING RHYTHM (R1–R4, 2026-09-14) ──────────────────────────────────────
// The suite had 27 invariants and not one about spacing, which is why the
// scale drifted invisibly: --sp-5..--sp-8's own comments were computed at a
// 15px rem base and said ~11/~15/~23/~30 while the base had been 16 for
// months, and seven unrelated components had settled on a bare 5px that is on
// no scale at all. Nothing in the file could have caught either, because
// nothing read the DECLARATIONS — every other check reads the rendered box,
// and a rendered box cannot tell you a number was chosen by feel.
//
// These four read the stylesheets and the cursor's source instead. They are
// the cheapest checks in the file and they close a whole class.

const SPACING_DECL = /(?<![\w-])(padding|margin|gap|row-gap|column-gap)(-top|-right|-bottom|-left)?\s*:\s*([^;}\n]*)/g;
const NESTED_FN    = /\b(var|calc|env|min|max|clamp)\([^()]*(?:\([^()]*\)[^()]*)*\)/g;

/** Blank out comments so a hex or a measurement quoted in prose is not a
 *  finding. renderer.js's cursor header used to name three colours in literal
 *  hex, and half the reason it went stale is that nobody could tell the note
 *  from the code. Blanked rather than deleted: line numbers must survive. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
            .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

// R1 — no bare px or rem literal in padding / margin / gap.
//
// A RATCHET, not a clean assertion, and deliberately so. style.css still
// carries a known tail of bare literals: the px ones are centring offsets and
// a handful of one-offs, the rem ones are a whole named round that has not
// been run (and cannot be run by sed — some are deliberate rem so they track
// --ui-base-px). Asserting zero today would only mean a suite that is red for
// a reason nobody is allowed to fix in passing, and a red suite that stays red
// teaches people to ignore the whole file. So the tail is frozen: the class
// cannot GROW, and the moment the round is run these numbers come down.
//
// The px tail is frozen BY SIGNATURE — "property: literal", with a count —
// rather than by a total, so a failure names the thing that appeared instead
// of pointing at whatever happened to be last in the list. Line numbers are
// deliberately not part of a signature: they shift under every edit above
// them, and a baseline that goes stale on an unrelated commit is a baseline
// nobody trusts. The rem tail is a COUNT: 124 distinct signatures is not a
// list anyone reads, and until the round is run the only fact worth asserting
// about it is that it is not growing.
// ── ABSENCE IS NOT EVIDENCE — how every frozen tail in this file is read ────
// Three instances of one bug in a single week: eleven settings rows behind a
// <template> that nothing instantiated, thirty-three of this file's checks
// querying a document that never built it, and two buttons that exist only
// while their drawer is rendered. Same shape every time — a check mistook
// "did not see it" for "it is fine."
//
// So a frozen tail is read in THREE states, never two:
//
//   FIXED        measured this run, and clean        -> drop it from the tail
//   STILL WRONG  measured this run, still failing    -> stays, silent
//   NOT REACHED  not measured this run at all        -> STAYS, and is reported
//
// The detail line carries the coverage, and a low number is the useful fact
// rather than an embarrassment: 21 of 660 control-shaped elements with the
// rails shut is exactly what told us R6 needed to open the doors. THE FIX FOR A
// COVERAGE GAP IS NEVER TO WIDEN THE PROBE UNTIL THE NUMBER LOOKS BETTER — an
// entry no path can reach is a finding about the AUDIT, and is named as one.
//
// `seen` is the set of keys the probe actually measured. A static file read
// passes `null`, which means full coverage by construction — there is no such
// thing as an unreachable line in a file you read end to end.
function readTail(tail, offenders, seen) {
  const off = new Set(offenders);
  const keys = [...tail];
  const reached = k => seen === null || seen.has(k);
  return {
    fixed:       keys.filter(k => reached(k) && !off.has(k)),
    notReached:  keys.filter(k => !reached(k)),
    isNew:       [...off].filter(k => !tail.has(k)),
    coverage:    seen === null
      ? `${keys.length} in tail, static read — full coverage`
      : `${keys.filter(reached).length} of ${keys.length} in tail reached`,
  };
}

const R1_PX_TAIL = {
  "margin-bottom: 4px": 1,
  "margin-bottom: 8px": 1,
  "margin-left: 10px": 1,
  "margin-left: 4px": 1,
  "margin-top: -1px": 2,
  "margin-top: -2.5px": 1,
  "margin-top: -3px": 1,
  "margin-top: -4.5px": 1,
  "margin-top: -6px": 2,
  "margin-top: 10px": 1,
  "margin-top: 22px": 1,
  "margin-top: 26px": 1,
  "margin-top: 2px": 1,
  "margin-top: 4px": 1,
  "margin: 8px": 1,
  "padding-left: 2px": 1,
  "padding-top: 10px": 1,
  "padding-top: 6px": 1,
  "padding: 1px": 1,
  "padding: 2px": 1
};
// 364 since 2026-09-15: the height-snap round took the vertical padding off `.trow`
// `.ds-del` and `.tc-cam-row`, which is how a stated height replaces a derived one.
// 346 since 2026-09-16: the pinned rail's rows, groups and tracker went with the
// mixer, and their rem literals with them (the mixer's rules are all --sp-*).
const R1_REM_TAIL = 346;

function auditSpacingLiterals() {
  const raw = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
  // The marker is read from the RAW source and the exemption carried by line
  // number: stripComments() blanks the comment it lives in, so testing for it
  // afterwards silently exempts nothing at all.
  const exempt = new Set();
  raw.split('\n').forEach((ln, i) => { if (ln.includes('/* geometry */')) exempt.add(i + 1); });
  const lines = stripComments(raw).split('\n');
  const px = new Map();
  let rem = 0;
  lines.forEach((ln, i) => {
    if (exempt.has(i + 1)) return;   // a centring offset is not a spacing step
    for (const m of ln.matchAll(SPACING_DECL)) {
      const prop = m[1] + (m[2] || '');
      const value = m[3].replace(NESTED_FN, '');   // whatever a var/calc/env already owns is fine
      for (const lit of value.matchAll(/(?<![\w.#-])-?\d*\.?\d+(px|rem)(?![\w-])/g)) {
        if (lit[1] === 'rem') { rem++; continue; }
        const sig = `${prop}: ${lit[0]}`;
        px.set(sig, (px.get(sig) || 0) + 1);
      }
    }
  });
  const added = [], gone = [];
  for (const [sig, n] of px) { const was = R1_PX_TAIL[sig] || 0; if (n > was) added.push(`${sig} ×${n - was}`); }
  for (const sig of Object.keys(R1_PX_TAIL)) { const n = px.get(sig) || 0; if (n < R1_PX_TAIL[sig]) gone.push(sig); }
  // Static read of one file end to end, so there is no third state here: every
  // entry is reached by construction. Said out loud rather than assumed, because
  // "gone means fixed" is only safe when that is actually true — see readTail().
  const cover = readTail(new Set(Object.keys(R1_PX_TAIL)), [...px.keys()], null).coverage;
  return { added, gone, pxTotal: [...px.values()].reduce((a, b) => a + b, 0), rem, cover };
}

// R2 — a named component spacing token is a whole number of px, and it lives
// with the component it spaces.
//
// --footer-cap-gap is the pattern this states: measured, named, and declared
// on .bottom-bar right above the rule that spends it, so the number and the
// thing it spaces cannot drift apart. A FRACTIONAL token is the other failure,
// and it is not hypothetical — "32.4px of air against 18.4" in this file's own
// header is 1.15rem, still declared as 1.15rem today.
//
// Two deliberate softenings of the rule as first written, each because the
// strict form was wrong rather than inconvenient:
//
//   "declared in the same rule BLOCK" — no. A custom property is inherited on
//   purpose: --footer-cap-gap is declared on .bottom-bar and spent by
//   .bb-ax / .bb-mute inside it, which is correct and is the pattern. What
//   actually protects the design is that the token is SPENT — a declared token
//   with no var() reading it is a number nobody can find the effect of.
//
//   the fractional ones FAIL, but by a named tail rather than by going red.
//   Converting --footer-inset from 1.15rem to 18px moves the footer, which is
//   a design call and Ek's, not a side effect of adding an invariant. They are
//   listed by name so the next person meets them; the check fails the moment a
//   NEW one appears.
//
// NAMED EXCEPTION: --seam. Seven unrelated components (meter channels, tile
// strips, the lens bar) want the SAME hairline between abutting objects, and a
// seam that differs between them is just a thin gap. It is global on purpose
// and lives in tokens.css with the scale.
const R2_GLOBAL = new Set(['--seam']);
// The scale itself, read from tokens.css so this cannot go stale against it.
const SPACING_SCALE = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'css', 'tokens.css'), 'utf8');
  const out = {};
  for (const m of src.matchAll(/(--sp-\d)\s*:\s*([\d.]+)rem/g)) out[m[1]] = parseFloat(m[2]) * 16;
  return out;
})();
// EMPTY since 2026-09-14, and that is the point of having dated it: --prow-gap
// (9.6px) and --footer-inset (18.4px) both snapped to the scale the day neither
// could state a derivation. An allowlist that outlives its rows is the staleness
// this file exists to catch.
const R2_FRACTIONAL = new Set();

function auditNamedSpacing() {
  const bad = [], known = [], seenNames = new Set();
  for (const file of ['style.css', 'settings-gui.css', 'tokens.css']) {
    const src = stripComments(fs.readFileSync(path.join(ROOT, 'css', file), 'utf8'));
    for (const m of src.matchAll(/(--[\w-]*(?:gap|pad|inset|seam))\s*:\s*([^;}\n]+)/g)) {
      const [name, raw] = [m[1], m[2].trim()];
      const line = src.slice(0, m.index).split('\n').length;
      const where = `${file}:${line} ${name}`;
      const px = /^(-?\d*\.?\d+)px$/.exec(raw);
      const rem = /^(-?\d*\.?\d+)rem$/.exec(raw);
      // A token that DEFERS to the scale is the best answer, not a violation:
      // var(--sp-4) cannot be fractional and cannot drift, which is more than a
      // literal can promise. Resolved through tokens.css so the value is still
      // checked rather than trusted.
      const scale = /^var\(\s*(--sp-\d)\s*\)$/.exec(raw);
      const asPx = px ? parseFloat(px[1]) : rem ? parseFloat(rem[1]) * 16
                 : scale ? SPACING_SCALE[scale[1]] ?? null : null;
      if (asPx === null) bad.push(`${where}: ${raw} is not a px, a rem or a --sp-* step`);
      else if (!Number.isInteger(asPx)) (R2_FRACTIONAL.has(name) ? known : bad)
        .push(`${where}: ${raw} = ${asPx}px, not a whole pixel`);
      if (R2_GLOBAL.has(name)) continue;
      if (!src.includes(`var(${name})`)) bad.push(`${where} is declared and never spent`);
      seenNames.add(name);
    }
  }
  // Same: three css files read end to end. Full coverage, stated.
  const cover = readTail(R2_FRACTIONAL, [...seenNames], null).coverage;
  return { bad, known, cover };
}

// R4 — the cursor inks from tokens, not from a second list of colours.
//
// The cursor carried nine hand-written colours for months while the tiles it
// is supposed to match carried tokens: recording was a red that was not the
// mic-live ramp, erase was a red borrowing danger's meaning, nearest was a
// violet in no ramp, and three slot fallbacks were a few points off the engine
// hues they were copying. None of it was visible as a bug — it was visible as
// a cursor that never quite matched the tile you pressed.
//
// Exempt: a fallback inside a _tok() call (that is the whole point of one),
// and pure black or white at an alpha, which is the theme's own ink rather
// than a palette hue.
//
// The allowance list is EMPTY, and that is the point: it held the toggle-trace
// green for one day until Ek ruled on it (2026-09-14, --accent-sensor on the
// ring). An entry here is a debt with a name and a date, not a permanent
// exemption — add one only to park a colour someone is actively deciding.
const CURSOR_LITERAL_ALLOWED = new Set();

function auditCursorInk() {
  const src = stripComments(fs.readFileSync(path.join(ROOT, 'js', 'renderer.js'), 'utf8'));
  const i = src.indexOf('export function drawCursor()');
  if (i < 0) return ['renderer.js: drawCursor() not found — this check has gone stale'];
  let depth = 0, end = -1;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) { end = k; break; }
  }
  const body = src.slice(i, end + 1);
  const base = src.slice(0, i).split('\n').length;
  const bad = [];
  for (const m of body.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
    const lit = m[0];
    if (CURSOR_LITERAL_ALLOWED.has(lit)) continue;
    if (/\$\{/.test(lit)) continue;                                  // rgba(${_rtic},…) — the theme's ink
    const chans = lit.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (chans && chans.slice(1).every(c => c === '255' || c === '0')) continue;   // black / white
    const line = body.slice(0, m.index);
    const ln = base + line.split('\n').length - 1;
    const stmt = body.split('\n')[line.split('\n').length - 1];
    if (/_tok\(\s*'[^']+'\s*,\s*'?$/.test(stmt.slice(0, stmt.indexOf(lit)))) continue;  // a _tok fallback
    bad.push(`renderer.js:${ln} ${lit}`);
  }
  return bad;
}


// ── R5: A DESCRIPTION IS SHORT, AND AT MOST TWO SENTENCES ───────────────────
// The only check in this file that catches a WRITING regression, which is how
// all of them got in: nothing here ever read a row's words, so a description
// could grow to 107 words — the Calibration row — without a single check
// noticing. 92 characters is two lines of the 46ch column the description is
// already capped to (measured: 278px, 56.8 ch/line).
//
// THE SENTENCE RULE WAS ONE, AND ONE WAS THE WRONG PROXY (amended 2026-09-14).
// It stood in for "not a paragraph", and measured against the remainder it fired
// on eleven rows with nothing wrong with them — "The floor, in pixels. Quiet
// material never draws smaller than this." is 67 characters and two clean
// sentences, and joining them with a semicolon makes it worse. A 67-character
// description is not a paragraph. THREE sentences inside 92 characters is choppy
// rather than dense, and that is what the count is actually for. The character
// cap is geometric and unchanged; this one is editorial and now says so.
//
// IT MUST OPEN THE TEMPLATES, and this is the part worth keeping. 11 of the
// app's 88 described rows live inside <template id="sygInstrumentTpl">, and
// document.querySelectorAll() does not see template content — so the longest
// description in the app has been sitting behind every check in this file.
// Worse than a query bug: ui-sygaldry.js render() only clones that template for
// a CONNECTED link, and audits run with no sensor attached, so instantiating
// the page does not help either. Measured on 2026-09-14: walking all thirteen
// settings pages finds 77 descriptions, the template holds 11 more, and the
// sensors page renders 0 instrument cards with nothing plugged in.
//
// THE SAME BLIND SPOT IS IN 33 OF THIS FILE'S 104 CHECKS — everything driven by
// SETTINGS_PROBE, which walks the rendered pages. They are not wrong about what
// they measure; they simply cannot see a row that is never built. Fixing that
// properly means a probe that instantiates the template with a fake link, and
// it is a bigger job than this check.
const DESC_PROBE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wasOpen = !!document.querySelector('.settings-dialog') && !!document.querySelector('.settings-dialog').offsetParent;
if (!wasOpen) { document.getElementById('tcSettings') && document.getElementById('tcSettings').click(); await sleep(700); }
const dlg = document.querySelector('.settings-dialog');
if (!dlg || !dlg.offsetParent) return { unavailable: true };
// The bridge's serialiser caps an array at 50 and a string at 4000 chars, and
// there are 88 described rows — so the counting happens HERE and only the
// offenders come back, joined into strings. (No backticks in this block: it is
// inside a template literal.)
const rows = [];
const push = (sec, d) => {
  const row = d.closest('.set-row');
  const t = row ? row.querySelector('.set-row-title') : null;
  rows.push({ sec: sec, title: t ? t.textContent.replace(/\\s+/g, ' ').trim() : '?',
              text: d.textContent.replace(/\\s+/g, ' ').trim() });
};
for (const nav of [...document.querySelectorAll('.set-nav-item[data-sec]')]) {
  nav.click(); await sleep(300);
  for (const d of document.querySelectorAll('.settings-host .in-settings .set-row-desc')) push(nav.dataset.sec, d);
}
// The templates, which a document query cannot reach.
for (const t of document.querySelectorAll('template')) {
  for (const d of t.content.querySelectorAll('.set-row-desc')) push('tpl:' + (t.id || 'anon'), d);
}
const close = document.querySelector('.settings-dialog .close-btn') || document.getElementById('settingsClose');
if (!wasOpen && close) close.click();
const key = r => r.sec + '/' + r.title;
const sentences = t => t.split(/(?<=[.!?])\\s+/).filter(x => x.trim()).length;
return {
  n: rows.length,
  tpl: rows.filter(r => r.sec.indexOf('tpl:') === 0).length,
  seen:  rows.map(key).join('\u2016'),
  long:  rows.filter(r => r.text.length > 92).map(r => key(r) + '|' + r.text.length).join('\u2016'),
  multi: rows.filter(r => sentences(r.text) > 2).map(r => key(r) + '|' + sentences(r.text)).join('\u2016'),
};
`;

const DESC_MAX = 92;   // two lines of the 46ch column, measured

// The tail, frozen 2026-09-14 by "page/title" so a failure names the row that
// grew rather than pointing at whatever sorted last. These are A7's cut list
// and the 13 behind it; every entry disappears as its row is rewritten, and the
// check says so. Nothing may be ADDED.
const R5_LONG_TAIL = new Set([
  // EMPTY since 2026-09-14. Every settings description in the app is now one or
  // two sentences inside 92 characters, template rows included. The tail stays
  // as the mechanism — the next one that grows is named, not absorbed.
]);
const R5_MULTI_TAIL = new Set([
]);

function auditDescriptions(d) {
  const split = s => (s ? s.split('\u2016') : []).map(e => {
    const i = e.lastIndexOf('|');
    return { key: e.slice(0, i), metric: e.slice(i + 1) };
  });
  const L = split(d.long), M = split(d.multi);
  // Every row the probe actually reached — the third state's evidence. R5's own
  // tail covers rows inside a <template> that is not always instantiated, which
  // is the exact case this distinction exists for.
  const seen = new Set((d.seen ? String(d.seen).split('\u2016') : []).filter(Boolean));
  const metric = new Map([...L, ...M].map(e => [e.key, e.metric]));
  const rl = readTail(R5_LONG_TAIL,  L.map(e => e.key), seen.size ? seen : null);
  const rm = readTail(R5_MULTI_TAIL, M.map(e => e.key), seen.size ? seen : null);
  const dress = ks => ks.map(k => k + ' (' + (metric.get(k) || '?') + ')');
  return { n: d.n, tpl: d.tpl, long: dress(rl.isNew), multi: dress(rm.isNew),
           goneL: rl.fixed, goneM: rm.fixed,
           coverL: rl.coverage, coverM: rm.coverage,
           unreachedL: rl.notReached, unreachedM: rm.notReached };
}


// ── R6: THE INSTRUMENT'S CONTROLS ARE KIT SIZES ─────────────────────────────
// The settings scope has had "uses only the kit's sizes" for a while and that
// is why settings drift stopped. The instrument scope had only PER-COMPONENT
// invariants — the footer's glyphs, the rail's rows, the stickers, the lens
// page — so a BRAND-NEW element matched none of them and was therefore measured
// by nothing. That is the half of the symptom prose cannot fix: the build sheet
// says "a 32px button fails the audit by name", and until now it did not.
//
// IT MUST OPEN THE DOORS. With the rails shut only 21 control-shaped elements
// render, out of 660 that match the selector; opening the 15 [data-more] doors
// takes it to 68, and 27 distinct components. A check that reads 3% of the
// surface is the template blind spot again in a different costume.
//
// IT MUST NOT CLICK A TOOL ROW. Clicking a .trow picks that tool into the hand,
// which is real instrument state — a probe may not play the instrument to
// measure it. Measured first: the doors alone reach exactly the same 27
// components, so the row clicks bought nothing and were dropped.
//
// Heights are keyed STRUCTURALLY — the component, not the state it is in. A key
// carrying `.on` / `.open` / `.wet` would churn the tail every time something
// is selected.
// PER KIND, not a flat list — and this is what makes the sheet's own sentence
// true. "A 32px button fails the audit by name" cannot hold against a set that
// merely contains 32, because 32 is legal for the ICON button: the sheet says
// .tc-icon is the precedent when you think you need a 32px button. So the
// expectation is keyed on WHICH kit element it is. Verified by injecting a 32px
// .mu-btn — a flat list waved it straight through; this does not.
const KIT_HEIGHTS = [18, 24, 32, 38];   // status pill · button + segmented · icon · --lg
const KIT_BY_KIND = { lg: [38], btn: [24], icon: [32], pill: [18], seg: [24], any: KIT_HEIGHTS };

// A CONTROL THAT FILLS A NAMED STRUCTURAL BOX TAKES THE BOX, AND GETS NO SIZE
// OF ITS OWN (Ek, 2026-09-14). The footer's six buttons are 40 because
// --footer-row is 40 — the box is stated once and the button fills it, the same
// reason a settings button in a table cell is 30 rather than 36. They are not a
// sixth kit size and they are not off-kit, so they are neither frozen nor
// exempt: the check reads the TOKEN and compares. NOTHING ELSE MAY BE 40 — 40
// is not in KIT_HEIGHTS, so any other element at that height still fails.
// Asserting the token rather than the literal is the point: a frozen 40 would
// rot silently the day the footer row moves.

const R6_PROBE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEL = 'button,[role=button],.mu-btn,.tc-icon,.seg,.seg-pill,.set-pill';
const STATE = /^(on|open|active|armed|wet|in-hand|autopin|is-mute|selected|playing|disabled|hidden|current)$/;
const seen = new Map();
const sweep = () => {
  for (const el of document.querySelectorAll(SEL)) {
    if (el.closest('#settingsModal,#settingsPanels,.palette')) continue;
    const h = el.getBoundingClientRect().height;
    if (h <= 0) continue;
    const cls = (typeof el.className === 'string' ? el.className.trim() : '')
      .split(/\\s+/).filter(c => c && !STATE.test(c));
    const key = el.id ? el.tagName.toLowerCase() + '#' + el.id
                      : el.tagName.toLowerCase() + (cls.length ? '.' + cls[0] : '');
    const kc = el.classList;
    // Box-filler first: it outranks every class-based kind.
    const box = (kc.contains('bb-ax') || kc.contains('bb-mute')) && el.closest('.bottom-bar')
      ? { token: '--footer-row', host: el.closest('.bottom-bar') } : null;
    const kind = box ? 'box'
               // A box that STATES it is sized by its text. Its own kind, not
               // folded into 'bare': --bare is a SHAPE (a button with no box),
               // and a two-line row is not a bare button. Keeping them apart
               // means a failure line can still say which one a thing claimed.
               : kc.contains('mu-h-content') ? 'content'
               : kc.contains('mu-btn--bare') ? 'bare'
               : kc.contains('mu-btn--lg') ? 'lg'
               : kc.contains('mu-btn') ? 'btn'
               : kc.contains('tc-icon') ? 'icon'
               : kc.contains('set-pill') ? 'pill'
               : (kc.contains('seg') || kc.contains('seg-pill') || kc.contains('grain-seg')
                  || kc.contains('grain-seg-btn')) ? 'seg' : 'any';
    const want = box ? parseFloat(getComputedStyle(box.host).getPropertyValue(box.token)) : null;
    if (!seen.has(key)) seen.set(key, { h: Math.round(h * 10) / 10, kind: kind,
                                        want: want, token: box ? box.token : '' });
  }
};
const wasOpen = new Set([...document.querySelectorAll('.open')]);
sweep();
for (const d of [...document.querySelectorAll('[data-more]')]) { d.click(); await sleep(240); sweep(); }
// Put the rails back: close anything this opened, leave anything that was open.
for (const el of [...document.querySelectorAll('.open')]) {
  if (wasOpen.has(el)) continue;
  const door = el.querySelector('[data-more]') || el.closest('[data-more]');
  if (door) { door.click(); await sleep(120); }
}
return [...seen.entries()].map(e => e[0] + '@' + e[1].h + '@' + e[1].kind + '@' + (e[1].want == null ? '' : e[1].want) + '@' + e[1].token).join('‖');
`;

// THE TAIL IS SPENT (2026-09-15). It is empty, and an empty tail is the
// strongest form of this check: every control-shaped element in the instrument
// computes to a kit height, so ANY off-kit element now fails by name. Nothing
// may be added — a new one is a bug, not a line here.
//
// It held nine entries, all closed by Ek's ruling of 2026-09-15 (snap them
// all): .trow 27.9, span.seg 25, .tbx-add and .trow-more 22.4, #lyrSettings 22,
// .ds-editbtn (#srcRecBtn/#srcTestBtn) 21.7, .ds-close 17.3, .ds-del 15.7 — all
// to 24, the kit's button height, STATED rather than fallen out of a padding
// plus a line box. See the commit and `docs/RULINGS.md` "a control's height is
// stated".
//
// THE SIX 40px FOOTER BUTTONS ARE A QUESTION, NOT A BUG: 40 is `--footer-row`,
// a measured and named value with its own ruling ("the box is stated once").
// Either the kit has a sixth size that the sheet's table omits, or the footer
// is genuinely off it. Ek's call — until then they are frozen like the rest.
// NOTE ON DELETION, 2026-09-15: readTail cannot tell "not rendered this run"
// from "no longer exists" — both look like absence, which is the whole point of
// the three-state read, and is also its one blind spot. button#lyrAllOn was
// removed from the source when the rail's all-on button became the MIX group,
// so its entry was deleted by hand after grepping index.html, js/ and css/ for
// it. An entry that goes NOT REACHED for a while is fine; one whose element is
// gone from the source is a line to delete.
const R6_TAIL = new Set([]);

function auditKitSizes(raw) {
  const rows = String(raw || '').split('‖').filter(Boolean).map(e => {
    const p = e.split('@');
    return { key: p[0], h: parseFloat(p[1]), kind: p[2] || 'any',
             want: p[3] === '' || p[3] === undefined ? null : parseFloat(p[3]), token: p[4] || '' };
  });
  const legalFor = r => r.kind === 'box' ? (r.want == null ? [] : [Math.round(r.want)])
                      : (KIT_BY_KIND[r.kind] || KIT_HEIGHTS);
  const nearest = r => { const L = legalFor(r); return L.length
    ? L.reduce((a, b) => Math.abs(b - r.h) < Math.abs(a - r.h) ? b : a) : '?'; };
  // 'bare' and 'content' are the two kinds with no kit height to hold them to,
  // and both are DECLARED in the markup rather than listed here — the class is
  // the author saying so, which is the difference between an exemption and a
  // whitelist. Everything else must land on the kit.
  const off = rows.filter(r => r.kind !== 'bare' && r.kind !== 'content'
                            && !legalFor(r).includes(Math.round(r.h)));
  // The agent's next move should be readable straight off the failure line.
  const isNew = off.filter(r => !R6_TAIL.has(r.key + '@' + r.h))
                   .map(r => `${r.key} is ${r.h}px — ${
                     r.kind === 'box' ? `it fills a named box and must equal ${r.token} (${r.want}px)`
                     : r.kind === 'any' ? 'no kit height matches'
                     : 'the kit says ' + legalFor(r).join('/') + ' for a ' + r.kind} · nearest ${nearest(r)}`);
  // A tail entry is keyed selector@height; it is REACHED when its element was
  // enumerated at all, whatever height it came back at. (srcRecBtn/srcTestBtn
  // live in a sheet that only exists while the source drawer is rendered.)
  const seenKeys = new Set(rows.map(r => r.key));
  const reached = new Set([...R6_TAIL].filter(k => seenKeys.has(k.slice(0, k.lastIndexOf('@')))));
  const t = readTail(R6_TAIL, off.map(r => r.key + '@' + r.h), reached);
  return { n: rows.length, onKit: rows.length - off.length, off: off.length,
           isNew, gone: t.fixed, notReached: t.notReached, coverage: t.coverage };
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
  console.log('\n── one optical size ──');
  if (!d.glyphs || d.glyphs.length < 8) skipped('the main-page glyphs', 'none measured', 2);
  else {
    collapses('every main-page glyph is drawn at one size', d.glyphs, 'v');
    collapses('…at one stroke weight',                      d.glyphs, 'sw');
  }
  if (!d.chromeRun || !d.chromeRun.length) skipped('the chrome runs', 'no groups', 3);
  else {
    collapses('every icon in a chrome run sits at one gap', d.chromeRun, 'v');
    // Bounded, not collapsed: glyph widths differ, so the ink gap has a
    // legitimate ~2px spread. 4px catches a control with no button box.
    const ink = d.chromeInk || [];
    const lo = Math.min(...ink.map(i => i.v)), hi = Math.max(...ink.map(i => i.v));
    check(ink.length > 0 && hi - lo <= 4,
      'and the AIR between their drawings is the same to 4px',
      ink.length ? `${lo.toFixed(1)}–${hi.toFixed(1)}px` + (hi - lo > 4
        ? ' · off: ' + ink.filter(i => i.v - lo > 4).map(i => `${i.t}@${i.v}`).join(', ') : '') : 'none');
    const inks = [...new Set((d.glyphInk || []).map(g => g.v))];
    check(inks.length === 1, 'the footer\'s glyphs are the chrome\'s own value',
      inks.length === 1 ? inks[0] : inks.join(' vs ') + ' · ' +
        (d.glyphInk || []).filter(g => g.v !== d.glyphInk[0].v).map(g => g.t).join(', '));
  }

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
  // The STICKER (PALETTE-GUI § 11.5–11.6): bottom-left, overhanging the
  // outline by ~5px both ways, inside the bed, never wider than the tile,
  // never into the next tile. § 11.6's trap — a sticker that compresses
  // instead of overhanging — shows here as a width under its text.
  if (!d.paletteStrip || !d.paletteTiles?.length) skipped('the palette legend', 'the palette is empty or hidden', 5);
  else {
    const P = { strip: d.paletteStrip, tiles: d.paletteTiles }, T = P.tiles.filter(t => t.leg);
    if (!T.length) { skipped('the palette legend', `none of the ${P.tiles.length} tiles carries a sticker (every key removed, nothing learned?)`, 5); }
    else {
      const numeric = T.every(t => [t.leg.x, t.leg.b, t.tile.x, t.tile.b, P.strip.b].every(v => typeof v === 'number'));
      check(numeric, 'the sticker boxes arrived as numbers', `${T.length} tile(s)`);
      const hang = T.filter(t => Math.abs((t.tile.x - t.leg.x) - 4) > 1.5 || Math.abs((t.leg.b - t.tile.b) - 4) > 1.5).map(t => `${t.n}: left ${(t.tile.x - t.leg.x).toFixed(1)} bottom ${(t.leg.b - t.tile.b).toFixed(1)}`);
      check(hang.length === 0, 'every sticker overhangs its tile\'s bottom-left corner by ~4px both ways', hang.join(', ') || `${T.length} sticker(s)`);
      const outOfBed = T.filter(t => t.leg.b > P.strip.b - 1 || t.leg.x < P.strip.x + 1).map(t => `${t.n} (${t.t})`);
      check(outOfBed.length === 0, 'every sticker sits inside the strip\'s bed', outOfBed.join(', ') || `bed ${Math.round(P.strip.h)}px tall`);
      const wide = T.filter(t => t.leg.w > t.tile.w).map(t => `${t.n} (${t.t}) ${t.leg.w.toFixed(1)}px`);
      check(wide.length === 0, 'no sticker is wider than its tile', wide.join(', ') || 'clear');
      const into = T.filter(t => { const next = P.tiles[t.n]; return next && t.leg.r > next.tile.x - 1; }).map(t => `${t.n} (${t.t})`);
      check(into.length === 0, 'no sticker reaches into the next tile', into.join(', ') || 'clear');
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
          `is 320px against the canvas and \`unpin all\` is destructive, so it stays spelled out. ` +
          `One item per row, mark left, keycap flush right — INSTRUMENT-GUI § 5.`
        : 'all one line');
    check((rr.clipped || []).length === 0,
      'no fixed rail label is ellipsised',
      (rr.clipped || []).length ? rr.clipped.join(', ') : 'nothing clipped');

    // The foot is gone (Ek, 2026-09-12, night: "remove all this helper text …
    // remove that area that it holds too") — the rail must carry none.
    check(rr.footLines === -1,
      'the pinned rail carries no foot',
      rr.footLines === -1 ? 'no .lyr-foot' : `${rr.footLines} line(s) of helper text`);

    const bb = rr.barBtns || [];
    const hSpread = bb.length ? +(Math.max(...bb.map(b => b[1])) - Math.min(...bb.map(b => b[1]))).toFixed(2) : 0;
    const ySpread = bb.length ? +(Math.max(...bb.map(b => b[2])) - Math.min(...bb.map(b => b[2]))).toFixed(2) : 0;
    check(bb.length >= 1 && hSpread <= TOLERANCE && ySpread <= TOLERANCE,
      'the rail header\'s buttons are one height on one baseline',
      bb.length < 1 ? 'no header button at all — the settings door has gone missing'
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

    // ── The mixer ─────────────────────────────────────────────────────
    const mx = rr.mix;
    if (!mx) {
      check(false, 'the pinned rail carries a mixer', 'no .lyr-trk-bar / .lyr-modes');
    } else {
      const all = [...mx.bars, ...mx.buses];
      const lSpread = +(Math.max(...all.map(e => e[0]), mx.modeL) - Math.min(...all.map(e => e[0]), mx.modeL)).toFixed(2);
      const rSpread = +(Math.max(...all.map(e => e[1]), mx.modeR) - Math.min(...all.map(e => e[1]), mx.modeR)).toFixed(2);
      check(lSpread <= TOLERANCE && rSpread <= TOLERANCE,
        'every track, every bus and the mode bar share one left and one right edge',
        `left spread ${lSpread}px · right spread ${rSpread}px` +
          (lSpread > TOLERANCE || rSpread > TOLERANCE ? ` · mode ${mx.modeL}–${mx.modeR} · bars ${mx.bars.map(e => e[0] + '–' + e[1]).join(', ')} · buses ${mx.buses.map(e => e[0] + '–' + e[1]).join(', ')}` : ''));
      check(mx.bars.every(e => Math.abs(e[2] - 32) <= TOLERANCE) && mx.buses.every(e => Math.abs(e[2] - 24) <= TOLERANCE),
        'a track bar is 32 tall and a bus row 24',
        `bars ${[...new Set(mx.bars.map(e => e[2]))].join('/')} · buses ${[...new Set(mx.buses.map(e => e[2]))].join('/') || 'none'}`);
      const msH = [...new Set(mx.ms.map(m => m[0]))], msOff = mx.ms.length ? Math.max(...mx.ms.map(m => Math.abs(m[1]))) : 0;
      check(mx.ms.length >= 2 && msH.every(h => Math.abs(h - 18.4) <= TOLERANCE) && msOff <= TOLERANCE,
        'M and S are the 18px pair, centred on the bar they sit in',
        `n=${mx.ms.length} height ${msH.join('/')} · worst centre offset ${msOff}px`);
      const segRef = mx.refSeg ?? mx.segs[0];
      check(mx.segs.length === 2 && mx.segs.every(h => Math.abs(h - segRef) <= TOLERANCE) && mx.swH != null && Math.abs(mx.swH - 18) <= TOLERANCE,
        'the mode bar\'s two segments are the chrome\'s .seg-pill at its own height, and its switch is 18',
        `segments ${mx.segs.join('/')} vs the chrome\'s ${mx.refSeg ?? 'n/a'} · switch ${mx.swH}`);
      const rowSpread = Math.max(...mx.rowMids.map(m => m.length ? +(Math.max(...m) - Math.min(...m)).toFixed(2) : 0));
      check(mx.rowMids.length === 3 && rowSpread <= TOLERANCE,
        'each of the three mode-bar rows centres its label, its control and its readout on one line',
        `${mx.rowMids.length} rows · worst spread ${rowSpread}px`);
      check(mx.cntMid != null && mx.doorMid != null && Math.abs(mx.cntMid - mx.doorMid) <= TOLERANCE,
        'the header count and the settings door share a centre line',
        `count ${mx.cntMid} vs door ${mx.doorMid}`);
      check(mx.numMid != null && Math.abs(mx.numMid - mx.barMid) <= TOLERANCE,
        'a track\'s number centres on its bar',
        `number ${mx.numMid} vs bar ${mx.barMid}`);
    }
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
    const wasOpen = T.propsOpen(), nearWas = S.lensMode, allWas = S.grainKAllMode;
    if (!wasOpen) { T.setPropsOpen(true); await wait(300); }
    const read = async (near, all) => {
      S.lensMode = near ? 'nearest' : 'area'; S.grainKAllMode = all;
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
    S.lensMode = nearWas; S.grainKAllMode = allWas;
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

  console.log('\n── spacing rhythm ──');
  {
    const lits = auditSpacingLiterals();
    check(lits.added.length === 0, 'no NEW bare px literal in padding / margin / gap',
      lits.added.length ? `new: ${lits.added.join(' · ')}`
        : lits.gone.length ? `${lits.pxTotal}, the known tail — ${lits.gone.length} gone, drop from R1_PX_TAIL: ${lits.gone.join(', ')}`
        : `${lits.pxTotal}, the known tail, unchanged · ${lits.cover}`);
    check(lits.rem <= R1_REM_TAIL, 'no NEW bare rem literal in padding / margin / gap',
      lits.rem > R1_REM_TAIL ? `${lits.rem} against a frozen ${R1_REM_TAIL} — the round has not been run, so this is a count: ${lits.rem - R1_REM_TAIL} appeared`
        : lits.rem < R1_REM_TAIL ? `${lits.rem} against a frozen ${R1_REM_TAIL} — the tail shrank, lower R1_REM_TAIL to ${lits.rem}`
        : `${lits.rem}, the known tail, unchanged`)
    const named = auditNamedSpacing();
    check(named.bad.length === 0, 'every named component spacing token is spent, and a whole pixel',
      named.bad.length ? named.bad.join(' · ')
                       : `clean · ${named.known.length} named fractional token(s) outstanding: ${named.known.join(', ') || 'none'} · ${named.cover}`);
    const ink = auditCursorInk();
    check(ink.length === 0, 'the cursor inks only from tokens',
      ink.length ? ink.join(' · ')
                 : `clean (${CURSOR_LITERAL_ALLOWED.size} named allowance(s) outstanding)`);
  }

  console.log('\n── row descriptions ──');
  {
    const dd = await evalInApp(DESC_PROBE, 'desc_' + Date.now().toString(36));
    if (!dd || dd.unavailable) skipped('row descriptions', 'settings would not open', 3);
    else {
      const a = auditDescriptions(dd);
      check(a.tpl > 0, 'the probe opened the templates',
        a.tpl ? `${a.n} described rows, ${a.tpl} of them inside a <template>` :
                'ZERO template rows seen — R5 is measuring the wrong set (see its header)');
      check(a.long.length === 0, `no NEW description over ${DESC_MAX} characters`,
        a.long.length ? a.long.join(' · ') + ` · ${a.coverL}`
          : a.goneL.length ? `${R5_LONG_TAIL.size - a.goneL.length} of the known tail left — drop from R5_LONG_TAIL: ${a.goneL.join(', ')} · ${a.coverL}`
          : `${R5_LONG_TAIL.size}, the known tail, unchanged · ${a.coverL}` +
            (a.unreachedL.length ? ` · NOT REACHED: ${a.unreachedL.join(', ')}` : ''));
      check(a.multi.length === 0, 'no NEW description of more than two sentences',
        a.multi.length ? a.multi.join(' · ') + ` · ${a.coverM}`
          : a.goneM.length ? `${R5_MULTI_TAIL.size - a.goneM.length} of the known tail left — drop from R5_MULTI_TAIL: ${a.goneM.join(', ')} · ${a.coverM}`
          : `${R5_MULTI_TAIL.size}, the known tail, unchanged · ${a.coverM}` +
            (a.unreachedM.length ? ` · NOT REACHED: ${a.unreachedM.join(', ')}` : ''));
    }
  }

  console.log('\n── the instrument kit\'s sizes ──');
  {
    const raw = await evalInApp(R6_PROBE, 'kit_' + Date.now().toString(36));
    if (!raw) skipped('the instrument kit sizes', 'probe returned nothing', 2);
    else {
      const k = auditKitSizes(raw);
      check(k.n >= 20, 'the probe opened the rails',
        `${k.n} control-shaped elements enumerated, ${k.onKit} on the kit` +
        (k.n < 20 ? ' — too few; the doors did not open and this is measuring 3% of the surface' : ''));
      check(k.isNew.length === 0, 'every instrument control computes to a kit height',
        k.isNew.length ? k.isNew.join(' · ') + ` · ${k.coverage}`
          : k.gone.length ? `${R6_TAIL.size - k.gone.length} of the known tail left — drop from R6_TAIL: ${k.gone.join(', ')}`
          : `${k.off} off-kit, the known tail, unchanged · ${k.coverage}` +
            (k.notReached.length ? ` · NOT REACHED: ${k.notReached.join(', ')}` : ''));
    }
  }

  // ── The rail title's + sits on the title's cap line (2026-09-16) ─────────
  // Ek: "the plus sign for adding a new tile beside the left rail title is not
  // vertically aligned, it looks a bit lower than the title." It was the `+`
  // CHARACTER at 14px on its own baseline inside a 24px box: flex centred the
  // box, and a baseline sits (ascent − descent)/2 below a box's centre, so the
  // glyph's ink landed under the 11px caps beside it. Drawn now, and this
  // reads INK against INK: the path's box against the caps' ink, whose
  // position comes from the real baseline — taken with a zero-size inline
  // box inside an inline wrapper around the text node. A direct child of the
  // flex label would be blockified and centred, and the number would be the
  // box's centre, not the baseline (that was the first, wrong, reading).
  console.log('\n── the rail title\'s + ──');
  {
    const PLUS_PROBE = `(async () => {
  const m = await import('./js/tiles.js');
  const was = m.propsOpen();
  if (!was) m.toggleRail();
  await new Promise(r => setTimeout(r, 600));
  const out = [];
  for (const lbl of [...document.querySelectorAll('#toolRail .tbx-lbl')].filter(l => l.querySelector('.tbx-add path'))) {
    const grp = lbl.closest('.tbx-grp').dataset.grp;
    const pb = lbl.querySelector('.tbx-add path').getBoundingClientRect();
    const tn = lbl.firstChild; const w = document.createElement('span'); lbl.insertBefore(w, tn); w.appendChild(tn);
    const z = document.createElement('span'); z.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'; w.appendChild(z);
    const base = z.getBoundingClientRect().top;
    z.remove(); lbl.insertBefore(tn, w); w.remove();
    const cs = getComputedStyle(lbl); const S = 4;
    const c = document.createElement('canvas'); c.width = 400; c.height = 200; const g = c.getContext('2d'); g.scale(S, S);
    g.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily; g.fillStyle = '#fff'; g.fillText(tn.textContent.trim().toUpperCase(), 5, 30);
    const d = g.getImageData(0, 0, 400, 200).data; let top = 200, bot = 0;
    for (let y = 0; y < 200; y++) for (let x = 0; x < 400; x++) if (d[(y * 400 + x) * 4 + 3] > 80) { top = Math.min(top, y); bot = Math.max(bot, y); }
    const capsMid = base + ((top + bot + 1) / 2) / S - 30, plusMid = (pb.top + pb.bottom) / 2;
    out.push({ grp, delta: +(plusMid - capsMid).toFixed(2) });
  }
  if (!was) m.toggleRail();
  return out;
})()`;
    const pl = await evalInApp(PLUS_PROBE, 'plus_' + Date.now().toString(36));
    if (!pl || !pl.length) skipped('the rail title\'s +', 'no engine title with a + was found', 1);
    else {
      const off = pl.filter(x => Math.abs(x.delta) > TOLERANCE);
      check(off.length === 0, 'every engine title\'s + is centred on its caps',
        off.length ? off.map(x => `${x.grp} ${x.delta > 0 ? '+' : ''}${x.delta}px`).join(' · ')
                   : pl.map(x => `${x.grp} ${x.delta > 0 ? '+' : ''}${x.delta}`).join(' · ') + ' — ink against ink');
    }
  }

  console.log(`\n${FAILURES === 0 ? 'All alignment invariants hold.' : `${FAILURES} invariant(s) broken.`}`);
  process.exit(FAILURES === 0 ? 0 : 1);
})().catch(e => { console.error('align-audit failed:', e.message); process.exit(2); });
