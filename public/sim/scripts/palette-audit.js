#!/usr/bin/env node
/**
 * scripts/palette-audit.js — THE PALETTE IS A FIXED TOOLBAR (docs/PALETTE-GUI.md).
 *
 *   node scripts/palette-audit.js
 *   node scripts/rig-audit.js palette
 *
 * Rewritten at the 5.6 release sweep (2026-09-23). The suite it replaces
 * (1515 lines, git history) proved a palette of nine draggable positions with
 * wet buttons, a `+` on engine titles and a pen/wash/line factory — all of it
 * deleted on 2026-09-22, when the palette became a fixed toolbar. It had failed
 * since. This one states what CLAUDE.md says the palette IS:
 *
 *  A. Six tiles in the build's order — the cursor, the hand's two sides (tape
 *     on the press, grain on the hold), erase, pin, unpin — and no drag.
 *  B. Each position wears the key that fires it: c · e · ↓ · ↑.
 *  C. The verb is the shape: every tile's radius is VERB_RADIUS of its verb.
 *  D. The mouse SELECTS: a click on a tool opens its tab, on the cursor opens
 *     the rail and leaves the tab, on the pin fires nothing.
 *  E. Right-click cycles a verb — on a position and on a hand side — and the
 *     choice is stored ONE VERB PER POSITION.
 *  F. The binding PLAYS: the cursor's position toggles the cap and back.
 *  G. One action per position (`palette_N`).
 */

const { launch } = require('./lib/rig');

async function run(rig) {
  let fails = 0;
  const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`); if (!ok) fails++; };

  const o = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const T = await import('./js/tiles.js');
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const dock = () => document.getElementById('paletteBed');
    const out = {};
    const keepPal = localStorage.getItem('mubone_palette');
    const keepMuted = S.scanMuted, keepInstr = T.instrument();
    try {
      await wait(400);
      // A. order and drag
      const tiles = [...dock().querySelectorAll(':scope > .tile')];
      out.order = tiles.map(t => t.dataset.which ? 'hand:' + t.dataset.which + ':' + t.dataset.hand : t.dataset.pal);
      out.draggable = tiles.filter(t => t.getAttribute('draggable') === 'true' || t.draggable).length;
      // B. keys
      out.keys = tiles.filter(t => t.dataset.pos != null).map(t => t.dataset.pal + ':' + (t.querySelector('.tile-bind')?.textContent.trim() ?? ''));
      // C. shape
      const R = { bang: '999px', momentary: getComputedStyle(document.body).getPropertyValue('--r-hand').trim(), toggle: '24px 3px' };
      out.shapes = tiles.map(t => ({ id: t.dataset.pal ?? t.dataset.which, verb: t.dataset.verb, r: getComputedStyle(t).borderRadius }));
      out.shapeOK = out.shapes.every(s => {
        if (s.verb === 'bang') return /999/.test(s.r) || parseFloat(s.r) > 100;
        if (s.verb === 'toggle') return /24px 3px/.test(s.r);
        if (s.verb === 'momentary') return s.r === R.momentary || s.r.startsWith(R.momentary);
        return false;
      });
      // D. the mouse selects
      if (!T.propsOpen()) document.getElementById('tcTools').click();
      await wait(300);
      T.setInstrument('tape'); T.render(); await wait(150);
      const tile = sel => dock().querySelector(sel);
      tile('.tile[data-pal="erase"]').click(); await wait(250);
      out.eraseOpens = T.instrument() === 'erase' && T.propsOpen();
      tile('.tile--hand[data-which="press"]').click(); await wait(250);
      out.handOpens = T.instrument() === 'tape';
      const before = T.instrument(), mutedBefore = S.scanMuted;
      tile('.tile[data-pal="lens"]').click(); await wait(250);
      out.lensLeavesTab = T.instrument() === before && S.scanMuted === mutedBefore && T.propsOpen();
      const pins0 = S.commitSlots.filter(Boolean).length;
      tile('.tile[data-pal="pin"]').click(); await wait(300);
      out.pinClickFiresNothing = S.commitSlots.filter(Boolean).length === pins0;
      // E. right-click cycles, stored one verb per position
      const ctx = el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      const lensPos = Number(tile('.tile[data-pal="lens"]').dataset.pos);
      const v0 = tile('.tile[data-pal="lens"]').dataset.verb;
      ctx(tile('.tile[data-pal="lens"]')); await wait(200);
      const v1 = tile('.tile[data-pal="lens"]').dataset.verb;
      let stored = null; try { stored = JSON.parse(localStorage.getItem('mubone_palette') || 'null'); } catch (_) {}
      out.cycle = { v0, v1, stored, lensPos, storedIsVerbs: Array.isArray(stored) && stored.every(v => typeof v === 'string') && stored[lensPos] === v1 };
      ctx(tile('.tile[data-pal="lens"]')); await wait(200);
      out.cycleBack = tile('.tile[data-pal="lens"]').dataset.verb === v0;
      const h0 = tile('.tile--hand[data-which="press"]').dataset.verb;
      ctx(tile('.tile--hand[data-which="press"]')); await wait(200);
      const h1 = tile('.tile--hand[data-which="press"]').dataset.verb;
      ctx(tile('.tile--hand[data-which="press"]')); await wait(200);
      out.handCycle = { h0, h1, back: tile('.tile--hand[data-which="press"]').dataset.verb === h0 };
      // F. the binding plays
      const m0 = S.scanMuted;
      S._paletteFire(lensPos, true); S._paletteFire(lensPos, false); await wait(120);
      const m1 = S.scanMuted;
      S._paletteFire(lensPos, true); S._paletteFire(lensPos, false); await wait(120);
      out.lensPlays = { m0, m1, m2: S.scanMuted };
      // G. one action per position
      const n = tiles.filter(t => t.dataset.pos != null).length;
      const ids = (S._actions || []).map(a => a.id);
      out.actions = { n, have: [...Array(n)].map((_, i) => ids.includes(`palette_${i + 1}`)), toggleRows: ids.filter(id => /^palette_\d+_(toggle|hold)$/.test(id)) };
    } finally {
      try { if (keepPal != null) localStorage.setItem('mubone_palette', keepPal); } catch (_) {}
      S.scanMuted = keepMuted;
      T.setInstrument(keepInstr); T.render();
    }
    return out;
  });

  console.log('\n§ A. six tiles, the build\'s order, no drag');
  check('cursor · the hand (tape on the press, grain on the hold) · erase · pin · unpin',
    JSON.stringify(o.order) === JSON.stringify(['lens', 'hand:press:tape', 'hand:long:granular', 'erase', 'pin', 'unpin']), JSON.stringify(o.order));
  check('no tile is draggable', o.draggable === 0, `${o.draggable} draggable`);
  console.log('\n§ B. the key names the tool');
  check('c · e · ↓ · ↑ on the four positions', JSON.stringify(o.keys) === JSON.stringify(['lens:c', 'erase:e', 'pin:↓', 'unpin:↑']), JSON.stringify(o.keys));
  console.log('\n§ C. the verb is the shape');
  check('every tile\'s radius is its verb\'s', o.shapeOK, JSON.stringify(o.shapes));
  console.log('\n§ D. the mouse selects');
  check('a click on erase opens the rail on the erase tab', o.eraseOpens);
  check('a click on the hand\'s press opens its tool\'s tab (tape)', o.handOpens);
  check('a click on the cursor opens the rail, leaves the tab, and does not cap', o.lensLeavesTab);
  check('a click on pin pins nothing', o.pinClickFiresNothing);
  console.log('\n§ E. right-click cycles a verb, stored one per position');
  check('the cursor\'s position cycles its verb, and the store is one verb per position',
    o.cycle.v0 !== o.cycle.v1 && o.cycle.storedIsVerbs, JSON.stringify(o.cycle));
  check('… and cycles back', o.cycleBack);
  check('a hand side cycles its verb and back', o.handCycle.h0 !== o.handCycle.h1 && o.handCycle.back, JSON.stringify(o.handCycle));
  console.log('\n§ F. the binding plays');
  check('the cursor\'s position caps the cursor and uncaps it', o.lensPlays.m1 !== o.lensPlays.m0 && o.lensPlays.m2 === o.lensPlays.m0, JSON.stringify(o.lensPlays));
  console.log('\n§ G. one action per position');
  check('palette_1 … palette_N, and no _toggle / _hold rows', o.actions.have.every(Boolean) && o.actions.toggleRows.length === 0, JSON.stringify(o.actions));
  check('no renderer errors', rig.errors().length === 0, rig.errors().join(' | '));
  console.log(`\n${fails ? fails + ' failed' : 'all passed'}`);
  return fails;
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    const rig = await launch();
    let bad = 1;
    try { bad = await run(rig); } finally { await rig.close(); }
    process.exit(bad ? 1 : 0);
  })().catch(e => { console.error('FATAL', e.message); process.exit(1); });
}
