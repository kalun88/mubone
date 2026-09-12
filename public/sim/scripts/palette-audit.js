#!/usr/bin/env node
/**
 * scripts/palette-audit.js — the palette is a list of positions, the rail is the library.
 *
 * Runs against a real Electron instance via scripts/lib/rig.js — no setup.
 *   node scripts/palette-audit.js
 *   node scripts/rig-audit.js palette
 *
 * The model (docs/PALETTE-GUI.md, the design authority): an ordered list of up
 * to nine ENTRIES in `mubone_palette`, each `{ id, verb }`, and the POSITION is
 * the binding — key N, /palette/N and ONE `palette_N` row address whatever sits
 * at N. Nothing is locked to a kind, nothing cycles, every tile is visible, and
 * the strip is exactly as wide as the list. The rail is the library you DRAG
 * from (Procreate); a rail row has no click behaviour at all.
 *
 * ONE TILE, ONE VERB (2026-09-11 evening). A tile fires exactly one way —
 * `bang`, `momentary` or `toggle` — chosen in its drawer head from what its
 * kind allows, and THE VERB IS THE TILE'S, NOT THE CALLER'S. So:
 *   · one action per position, not three: `palette_N_toggle` and
 *     `palette_N_hold` are deleted, 27 rows are 9, and `palette_N`'s TYPE
 *     follows its tile (a momentary is a `hold` taking 1|0, everything else a
 *     `trigger` taking a bang);
 *   · the verb is DRAWN, as the tile's shape — one closed outline, one
 *     property, `border-radius`;
 *   · the same tool may sit on the strip TWICE in two verbs, so the list is not
 *     deduped and everything addresses a POSITION;
 *   · a click on the strip FIRES; `Tab` and the properties footer follow the
 *     last tile fired (`lastFired`); there is no main button.
 * ARMING is deleted, and so is `sel`.
 *
 *  A. Shape — the factory list wide · line · pen · all · overdub · unpin ·
 *     pin, NO tile wearing a box, no beds, no hairlines, no cap tile, and the
 *     palette is NINE actions.
 *  B. DELETED — "loading" was the rail click, which no longer acts.
 *  C. The drawer — Tab follows the last tile fired, ⇧Tab the lens, the ⋯ the
 *     one gesture that points without firing; a rail click does nothing; a
 *     click on the strip fires and opens nothing.
 *  D. Placing — drag a row in at the caret, move a tile (carrying its verb),
 *     drag one off, the pin pair from its rail, nine is full, EVERY tool may
 *     leave, the verb is set at the drop from § 4's defaults, and pin's three
 *     verbs are driven on a second pin tile.
 *  E. The digits FIRE by position, in the tile's verb: a toggle outlives its
 *     key, a momentary ends on the up (it latched for ever without that), a
 *     bang pins once; one play at a time; no hand-back; `sel` is gone.
 *  F. Lens and cap — a lens tile toggles; off, no lens is on and the cursor
 *     reads nothing; the rail agrees; S flips the same state.
 *  G. DELETED — it tested the armed box outranking the lit fill, and there is
 *     no armed box.
 *  H. The verb is the tile's — the same edges mean opposite things under two
 *     verbs; flipping one in its drawer changes what the edges do; a momentary
 *     is refused while a TAP is bound; space and the sphere click are DEAD;
 *     the eraser's GESTURE_LONG_MS erase-all survives.
 *  I. The pen ships wet; the wash brings its own sound.
 *  J. The wet button — grain rows only.
 *  K. The `+` on each engine title.
 *  L. Keys and notes through the button recogniser.
 *  M. SHAPE IS THE VERB — the computed radius per verb; flip a verb in its
 *     drawer and read the shape back off the strip.
 *  N. THE LEGEND IS THE TRUTH — source + gesture + delay for every bound
 *     input, blank iff `press`, `···` iff a sibling ×2/×3 delays that tap.
 *
 * PALETTE-GUI § 9 calls M and N "new I" and "new J"; both letters were already
 * taken by the wash and the wet button when it was written. Ek's rule 6 applies
 * to both: FORCE each state and read it back — an empty diff proves only that
 * nothing visible moved.
 *
 * Exits non-zero on failure.
 */

const { launch } = require('./lib/rig');
const gone_ok = p => p.gone.join() === 'wide,line,pen,all,overdub,pin' && p.back.join() === 'wide,line,pen,all,overdub,unpin,pin';

// Run ONE section (or a few) while iterating: `--only D,L` or PALETTE_ONLY=D,L.
// The sections are independent since 2026-09-11 (each starts from `factory()`
// / `lensOn()`), and a full run costs minutes the change may not need.
const ONLY = (process.env.PALETTE_ONLY || (process.argv.find(a => a.startsWith('--only=')) || '').slice(7)).split(',').map(x => x.trim()).filter(Boolean);
const want = sec => !ONLY.length || ONLY.includes(sec);
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else      { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// The TAPE engine's tiles (renamed from `loop` 2026-09-07: a loop is what a
// tape take becomes once it is pinned, so the engine was named after one
// outcome of half its tools). `line` and `slice` never loop at all.
const TAPES = ['line', 'slice', 'looper', 'overdub'];
const ERASERS = ['scrape', 'bottom', 'all'];
const NOT_TOOLS = [];   // the `+` row left the list 2026-09-10; nothing in the rail is not a tool

async function installHelpers(rig) {
  await rig.evaluate(async () => {
    const T = await import('./js/tiles.js');
    const B = await import('./js/brush.js');
    const { S } = await import('./js/state.js');
    const q = s => document.querySelector(s);
    const qa = s => [...document.querySelectorAll(s)];
    window.__ba = {
      T, S, B,
      // The palette as ids, in order; the tile at position n (1-based); a
      // tile's 0-based index (what _paletteFire takes); the TOOLS on it.
      pal:    () => qa('#paletteDock .tile[data-pal]').map(e => e.dataset.pal),
      tileAt: n => qa('#paletteDock .tile[data-pal]')[n - 1] ?? null,
      pos(id) { return this.pal().indexOf(id); },
      slots() { return this.pal().filter(id => T.slotKind(id)); },
      // ONE TILE, ONE VERB (PALETTE-GUI § 1). The verb as the strip reports
      // it, the verb as the model stores it, and the SHAPE the tile actually
      // draws — read from the computed style, because § 3's whole claim is
      // that one property carries the verb and § 9 I has to prove it.
      verbs:  () => qa('#paletteDock .tile[data-pos]').map(e => e.dataset.verb),
      stored_verbs: () => T.paletteEntries().map(e => e.verb),
      radii:  () => qa('#paletteDock .tile[data-pos]').map(e => getComputedStyle(e).borderRadius),
      radiusAt: n => { const e = qa('#paletteDock .tile[data-pos]')[n - 1]; return e ? getComputedStyle(e).borderRadius : null; },
      // The legend, as rendered: the whole line, and its three parts apart.
      legAt(n) {
        const e = this.tileAt(n); if (!e) return null;
        const leg = e.querySelector('.tile-leg'); if (!leg) return { text: '', parts: [] };
        return { text: leg.textContent, parts: [...leg.querySelectorAll('.leg')].map(x => ({
          kind: [...x.classList].find(c => c.startsWith('leg--'))?.slice(5) ?? null,
          src: (x.firstChild?.nodeType === 3 ? x.firstChild.textContent : (x.querySelector('.leg-space') ? '␣' : '')),
          g: x.querySelector('.leg-g')?.textContent ?? '',
          delay: !!x.querySelector('.leg-d'),
        })) };
      },
      // The drawer's verb segments for the tool the sheet is open on.
      verbSeg: () => [...document.querySelectorAll('#propRail .ds-verb .seg span')].map(e => ({
        v: e.textContent, on: e.classList.contains('on'), dis: e.classList.contains('dis'), pos: e.dataset.verbPos ?? null })),
      setVerb(n, v) { const e = document.querySelector(`#propRail .ds-verb .seg span[data-verb-set="${v}"][data-verb-pos="${n - 1}"]`); if (e) e.click(); return !!e; },
      // Drags, the way the browser sends them: a row or tile picked up, the
      // caret over the strip at clientX, a drop there, the end of the drag.
      // `dragOff` is a pick-up with no drop on any zone.
      drag(fromEl, x) {
        const dt = () => { try { return new DataTransfer(); } catch (_) { return null; } };
        const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 0, dataTransfer: dt() }));
        const bed = q('#paletteBed');
        fire(fromEl, 'dragstart'); fire(bed, 'dragover');
        const over = qa('#paletteBed .tile[data-pal]').find(t => { const r = t.getBoundingClientRect(); return x >= r.left && x <= r.right; });
        fire(over ?? bed, 'drop'); fire(fromEl, 'dragend');
      },
      dragOff(el) {
        const fire = type => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
        fire('dragstart'); fire('dragend');
      },
      // An x just inside the LEFT edge of tile n (drop lands before it), or
      // just inside the right edge of the last tile (drop lands at the end).
      xBefore(n) { const r = this.tileAt(n).getBoundingClientRect(); return r.left + 2; },
      xEnd() { const t = qa('#paletteBed .tile[data-pal]').pop(); const r = t.getBoundingClientRect(); return r.right - 2; },
      stored: () => JSON.parse(localStorage.getItem('mubone_palette') || 'null'),
      // Wide on and reading — the lens state most sections start from. A tile
      // tapped when on turns it OFF, so every section that taps must start here.
      lensOn() { if (T.installedLens() !== 'wide') this.lensRow('wide').click(); if (S.scanMuted) this.lensRow('wide').click(); },
      // The factory seven, the wide lens on, pen in the drawer's sights.
      factory() {
        // Rebuild the factory SEVEN with the factory VERBS — a section that
        // flipped one must not leave it flipped for the next.
        const want = [['wide', 'toggle'], ['line', 'toggle'], ['pen', 'momentary'], ['all', 'momentary'], ['overdub', 'momentary'], ['unpin', 'bang'], ['pin', 'bang']];
        while (this.pal().length) T.removeAt(0);
        for (const [id, v] of want) T.placeTile(id, undefined, v);
        this.lensOn();
      },
      // What the DRAWER is pointed at. This was `armed` until 2026-09-11 —
      // the same tile then, because the sheet followed the hand.
      picked: () => T.selectedTile()?.id ?? null,
      // Open a tool's drawer without firing anything: the ⋯ is the one
      // gesture that points the drawer and does not fire (§ 5.3).
      openDrawer(id) {
        const m = this.row(id)?.querySelector('[data-more]');
        if (m) { m.click(); return true; }
        // pin and unpin have no rail row; their sheet is the head alone and
        // the door to it is FIRING them (§ 5.2: Tab follows the last tile
        // fired, every tile). Fire, then Tab.
        const n = this.pal().indexOf(id) + 1;
        if (!n) return false;
        S._paletteFire(n - 1, true); S._paletteFire(n - 1, false);
        T.openProps(id, 'tool');      // Tab's own destination, without the toggle
        return this.drawer();
      },
      // Fire a POSITION the way the wire does, both edges.
      fire(n, down = true) { S._paletteFire(n - 1, down); },
      // A POINTER press on a strip tile. The strip fires from the pointer's
      // own edges now (a momentary tile has to play from press to release),
      // so `click()` reaches nothing — and the strip re-renders between the
      // two edges, so the tile is re-queried rather than captured.
      clickTile(n) {
        const t = this.tileAt(n); if (!t) return false;
        t.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
        window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
        return true;
      },
      clickLens(id) {
        const t = q(`#paletteDock .tile--lens[data-lens="${id}"]`); if (!t) return false;
        t.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
        window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
        return true;
      },
      // Nothing on the strip may wear a box: `.armed` is deleted, and a stray
      // one would be the old idle mark coming back.
      boxed: () => qa('#paletteDock .tile.armed, #toolRail .trow.armed').map(el => el.dataset.tile ?? el.dataset.lens),
      drawer: () => document.body.classList.contains('prail-open'),
      rail:   () => document.body.classList.contains('props-open'),
      sheetHead: () => q('#propRail .ds-head b')?.textContent ?? null,
      row:    id => q(`#toolRail .trow[data-tile="${id}"]`),
      rows:   () => qa('#toolRail .trow[data-tile]').filter(r => !r.classList.contains('ghost')).map(r => r.dataset.tile),
      lensRow: id => q(`#toolRail .trow[data-lens="${id}"]`),
      // The palette's tile for the INSTALLED lens (there is one tile per lens
      // now), and which lens tiles are lit at all.
      lensTile: () => q(`#paletteDock .tile--lens[data-lens="${T.installedLens()}"]`),
      lensT() { const t = this.lensTile();
        return { inst: T.installedLens(), onPalette: !!t, on: !!t?.classList.contains('on'), armed: !!t?.classList.contains('armed'),
                 lit: qa('#paletteDock .tile--lens.on').map(e => e.dataset.lens), rowOn: !!this.lensRow(T.installedLens())?.classList.contains('on') }; },
      // The cap is NO LENS ON (2026-09-11): the engine flag, and the two
      // things that must not exist any more.
      capT() { return { muted: !!S.scanMuted, tile: !!q('#paletteDock .tile--cap'), row: !!this.lensRow('cap') }; },
      key(code, type = 'keydown', shift = false) {
        document.body.dispatchEvent(new KeyboardEvent(type, { code, key: code.replace(/^Key|^Digit/, ''), shiftKey: shift, bubbles: true, cancelable: true }));
      },
      brushKey: () => B.currentBrush()?.key ?? null,
      lit: id => qa(`#paletteDock [data-tile="${id}"].playing`).length,
      fill: id => { const el = q(`#paletteDock [data-tile="${id}"]`); return el ? getComputedStyle(el).backgroundColor : null; },
      tap(code) { this.key(code); this.key(code, 'keyup'); },
      state() { return { pal: this.pal(), slots: this.slots(), picked: this.picked(), drawer: this.drawer(), rail: this.rail(),
                         head: this.sheetHead(), bkey: this.brushKey(), held: !!S.eraseHeld, active: !!S._gestureActive?.() }; },
    };
    return true;
  });
}

async function run(rig) {
  // A fresh palette: drop the stored list and reload, so § A sees the factory
  // palette rather than whatever the last run left.
  // … and drop the pen's stored block, so § I sees the block a fresh profile
  // is BORN with rather than what engine-audit's row driving left in it.
  await rig.evaluate(() => { localStorage.removeItem('mubone_palette');
    try { const t = JSON.parse(localStorage.getItem('mubone_tiles') || '{}'); delete t.wash; delete t.pen; localStorage.setItem('mubone_tiles', JSON.stringify(t)); } catch (_) {}
    location.reload(); return true; });
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 250));
    const up = await rig.evaluate(() => !!document.querySelector('#paletteDock .tile[data-pal]')).catch(() => false);
    if (up) break;
  }
  await installHelpers(rig);
  const st = () => rig.evaluate(() => window.__ba.state());
  const kindOf = id => TAPES.includes(id) ? 'tape' : ERASERS.includes(id) ? 'erase' : 'grain';

  // ── A. Shape ──────────────────────────────────────────────────────────────
  if (want('A')) {
  console.log('\n§ A shape');
  const a = await rig.evaluate(() => {
    const H = window.__ba;
    return { ...H.state(), boxed: H.boxed(),
             nTiles: document.querySelectorAll('#paletteDock .tile').length,
             lenses: document.querySelectorAll('#paletteDock .tile--lens').length,
             lens: H.lensT(), cap: H.capT(),
             seps: document.querySelectorAll('#paletteDock .palette-sep, #paletteDock .palette-lens, #paletteDock .palette-slots, #paletteDock .palette-acts').length,
             acts: document.querySelectorAll('#paletteDock .tile--act').length,
             actIds: [...document.querySelectorAll('#paletteDock .tile--act')].map(e => e.dataset.act),
             actArmed: document.querySelectorAll('#paletteDock .tile--act.armed, #paletteDock .tile--act.playing').length,
             railBoxed: document.querySelectorAll('#toolRail .trow.armed').length,
             pinLast: [...document.querySelectorAll('#paletteBed .tile[data-pal]')].pop()?.dataset.pal === 'pin',
             badge: (() => { const b = document.querySelector('#paletteBed > :first-child'); const t = document.querySelector('#paletteDock .tile');
               return { first: !!b?.classList.contains('palette-badge'), isTile: !!b?.classList.contains('tile'), tag: b?.tagName ?? null,
                        sameBox: b && t && Math.abs(b.getBoundingClientRect().width - t.getBoundingClientRect().width) < 0.5 && Math.abs(b.getBoundingClientRect().height - t.getBoundingClientRect().height) < 0.5,
                        cursor: b ? getComputedStyle(b).cursor : null }; })(),
             draggable: [...document.querySelectorAll('#paletteDock .tile')].map(e => e.getAttribute('draggable')),
             legends: [...document.querySelectorAll('#paletteDock .tile[data-pal]')].map(e => e.querySelector('.tile-leg')?.textContent ?? null),
             nums: document.querySelectorAll('#paletteDock .pal-num').length,
             cycleKey: localStorage.getItem('mubone_cycle_off'), slotsKey: localStorage.getItem('mubone_slots'),
             nActions: window.__ba.S._actions.filter(x => /^palette_[1-9](_toggle|_hold)?$/.test(x.id)).length };
  });
  check('a fresh palette is wide · line · pen · all · overdub · unpin · pin', a.pal.join() === 'wide,line,pen,all,overdub,unpin,pin', a.pal.join());
  check('seven tiles, no beds and no hairlines — one row, as wide as the list', a.nTiles === 7 && a.seps === 0, `${a.nTiles} tiles, ${a.seps} beds/seps`);
  check('the pin pair is two action tiles, unpin then pin, pin farthest right, never armed', a.acts === 2 && a.actIds.join() === 'commit_release,commit_drop' && a.actArmed === 0 && a.pinLast, `${a.actIds.join()} armed ${a.actArmed} last ${a.pinLast}`);
  check('one lens tile (wide), on; no cap tile and no cap row (the cap is no lens on)', a.lenses === 1 && a.lens.onPalette && a.lens.on && !a.cap.tile && !a.cap.row && !a.cap.muted, JSON.stringify({ lens: a.lens, cap: a.cap }));
  check('the palette badge heads the palette: chrome, not a tile, the tile\'s box', a.badge.first && !a.badge.isTile && a.badge.tag === 'I' && a.badge.sameBox && a.badge.cursor !== 'pointer', JSON.stringify(a.badge));
  check('the tools on it are line · pen · all · overdub', a.slots.join() === 'line,pen,all,overdub', a.slots.join());
  // NOTHING is armed (2026-09-11). No tile and no rail row may wear the box,
  // on the palette or in the library: the idle mark is deleted, so a stray
  // `.armed` is the old model growing back.
  check('no tile and no row wears a box — nothing is armed', a.boxed.length === 0 && a.railBoxed === 0, JSON.stringify({ boxed: a.boxed, rail: a.railBoxed }));
  check('the lens tile is never armed', !a.lens.armed);
  check('every palette tile is draggable (Procreate: move it, or drag it off)', a.draggable.every(d => d === 'true'), JSON.stringify(a.draggable));
  // Each tile wears what FIRES it, not a position number: the factory digit,
  // plus any button or note bound to that position, plus the delay mark. The
  // factory button map puts button 1 on 2 and 3, and button 3 on 6 and 7.
  check('each tile wears the key that fires it — the factory digits 1 … 7 — and no position number is drawn',
        a.legends.every((l, i) => l && l.startsWith(String(i + 1))) && a.nums === 0, `${a.legends.join(' | ')} nums ${a.nums}`);
  check('the cycle and the slots are gone from storage; the palette is NINE actions, one per position', a.cycleKey === null && a.slotsKey === null && a.nActions === 9, JSON.stringify({ cyc: a.cycleKey, slots: a.slotsKey, n: a.nActions }));
  check('nothing is open and nothing is playing at boot', !a.drawer && !a.active, JSON.stringify({ drawer: a.drawer, active: a.active }));
  // The main button is deleted: its two rows and its two addresses are gone
  // from the registry, so nothing can bind "fire the tool in the hand".
  const aM = await rig.evaluate(() => { const ids = window.__ba.S._actions.map(x => x.id);
    return { rows: ids.filter(i => i === 'trace_toggle' || i === 'recpaint'),
             osc: window.__ba.S._actions.filter(x => x.osc === '/trace' || x.osc === '/trace/toggle').map(x => x.osc) }; });
  check('trace_toggle and recpaint are gone from ACTIONS, with /trace and /trace/toggle', aM.rows.length === 0 && aM.osc.length === 0, JSON.stringify(aM));

  // ── B — DELETED (docs/PALETTE-GUI.md § 9) ─────────────────────────────────
  // "Loading" was the rail click, and a rail row has no click behaviour at all
  // any more (§ 5.3): it is a drag source with a ⋯. There is nothing left for
  // the section to drive. Placing is § D's, and it is a drag.
  // ── C. The drawer ─────────────────────────────────────────────────────────
  }
  if (want('C')) {
  console.log('\n§ C drawer');
  await rig.evaluate(() => { const H = window.__ba; H.factory(); H.openDrawer('pen'); H.key('Tab'); });
  // Tab follows THE LAST TILE FIRED (§ 5.2), one rule and one variable. The
  // ⋯ is the only gesture that points the drawer without firing.
  const c1 = await rig.evaluate(() => { const H = window.__ba; H.fire(3, true); H.fire(3, false); H.key('Tab'); return H.state(); });
  check('Tab opens the drawer of the last tile FIRED', c1.drawer && c1.head === 'pen', `drawer ${c1.drawer} head ${c1.head}`);
  const c1b = await rig.evaluate(() => { const H = window.__ba; H.key('Tab'); H.fire(2, true); H.fire(2, true); H.key('Tab'); return H.state(); });
  check('… fire another and Tab follows it there', c1b.drawer && c1b.head === 'line', `head ${c1b.head}`);
  const c2 = await rig.evaluate(() => { const H = window.__ba; H.key('Tab'); return H.state(); });
  check('Tab again shuts it', !c2.drawer && c2.rail, `drawer ${c2.drawer} rail ${c2.rail}`);
  const c3 = await rig.evaluate(() => { const H = window.__ba; H.openDrawer('pen'); return H.state(); });
  check('the ⋯ on a rail row opens THAT tool\'s drawer without firing it', c3.drawer && c3.head === 'pen' && !c3.active, `drawer ${c3.drawer} head ${c3.head}`);
  const c3b = await rig.evaluate(() => { const H = window.__ba; const shut = (H.key('Tab'), H.state());
    return { shut, moreEverywhere: H.rows().every(id => !!H.row(id).querySelector('[data-more]')) }; });
  check('every tool row carries the ⋯', c3b.moreEverywhere && !c3b.shut.drawer, JSON.stringify(c3b));
  const c3c = await rig.evaluate(() => { const H = window.__ba; H.openDrawer('spray'); const a = H.state();
    H.openDrawer('comb'); const b = { ...H.state(), openRow: document.querySelector('#toolRail .trow.open')?.dataset.tile }; return { a, b }; });
  check('the ⋯ moves the open drawer to another row', c3c.a.head === 'spray' && c3c.b.drawer && c3c.b.head === 'comb' && c3c.b.openRow === 'comb', JSON.stringify(c3c));
  // A RAIL CLICK DOES NOTHING (§ 5.3): it places nothing, fires nothing and
  // opens nothing. The rail is a drag source with a ⋯, and that is all.
  const c4 = await rig.evaluate(() => { const H = window.__ba; const before = { ...H.state(), pal: H.pal() };
    H.row('staff').click();
    return { before, after: { ...H.state(), pal: H.pal() } }; });
  check('a rail row CLICK places nothing, fires nothing and does not move the drawer',
        c4.after.pal.join() === c4.before.pal.join() && !c4.after.active && c4.after.head === c4.before.head, JSON.stringify({ b: c4.before.head, a: c4.after.head, pal: c4.after.pal }));
  await rig.evaluate(() => { const H = window.__ba; H.key('Tab'); });
  const c6 = await rig.evaluate(() => { window.__ba.key('Tab', 'keydown', true); return { ...window.__ba.state(), lensOpen: !!document.querySelector('#toolRail .trow--lens.open') }; });
  check('⇧Tab opens the lens\'s drawer', c6.drawer && c6.lensOpen, `drawer ${c6.drawer}`);
  const c7 = await rig.evaluate(() => { const H = window.__ba; H.key('Tab'); return H.state(); });
  // The ⋯ counts as addressing a tile too — it is the one gesture whose whole
  // purpose is to point the drawer — so Tab returns to the row it opened.
  check('Tab from the lens page brings the last-addressed tool\'s page, not darkness', c7.drawer && c7.head === 'comb', `head ${c7.head}`);
  await rig.evaluate(() => window.__ba.key('Tab'));
  // A CLICK ON THE STRIP FIRES IT (§ 1: "a tap FIRES; that is the only thing
  // a tap does"), and opens no drawer.
  const c8 = await rig.evaluate(() => { const H = window.__ba; const t = H.tileAt(3);
    const md = ty => t.dispatchEvent(new MouseEvent(ty, { button: 0, bubbles: true, cancelable: true }));
    md('mousedown'); const down = { ...H.state(), lit: H.lit('pen') };
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    return { down, up: { ...H.state(), lit: H.lit('pen') } }; });
  check('a click on a MOMENTARY tile plays it from the press to the release, and opens nothing', c8.down.active && c8.down.lit === 1 && !c8.down.drawer && !c8.up.active && c8.up.lit === 0, JSON.stringify(c8));
  // Re-query the tile between clicks: a lens tap re-renders the strip, so the
  // node the first press landed on is detached by the time of the second.
  const c10 = await rig.evaluate(() => { const H = window.__ba; H.lensOn();
    const click = () => { H.tileAt(1).dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
                          window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })); };
    click(); const a = { drawer: H.drawer(), muted: !!H.S.scanMuted };
    click(); const b = { drawer: H.drawer(), muted: !!H.S.scanMuted }; return { a, b }; });
  check('a click on the TOGGLE lens tile turns it off and on, and opens nothing', !c10.a.drawer && c10.a.muted && !c10.b.drawer && !c10.b.muted, JSON.stringify(c10));
  await rig.evaluate(() => window.__ba.factory());

  // ── D. Placing — the palette is built by dragging (Ek, 2026-09-11) ────────
  }
  if (want('D')) {
  console.log('\n§ D placing');
  await rig.evaluate(() => window.__ba.factory());
  const d0 = await st();
  check('setup: the factory seven', d0.pal.length === 7, d0.pal.join());
  // A rail row onto the strip's end: it lands last, keyed by its position,
  // stored, and the drawer's pick does not move — placing is not picking.
  const p1 = await rig.evaluate(() => { const H = window.__ba; H.drag(H.row('spray'), H.xEnd()); return { ...H.state(), stored: H.stored(), leg: H.legAt(8)?.text ?? null, verb: H.verbs()[7], row: H.S._paletteRow(8) }; });
  check('dragging spray from the rail onto the end places it at 8', p1.pal[7] === 'spray' && p1.pal.length === 8, p1.pal.join());
  // THE VERB IS SET AT THE DROP, from § 4's defaults: a brush lands momentary.
  check('… stored as an ENTRY with its kind\'s default verb, keyed 8, and the keys page row says so',
        p1.stored?.[7]?.id === 'spray' && p1.stored?.[7]?.verb === 'momentary' && p1.verb === 'momentary' && p1.leg === '8' && p1.row.pos === 8 && p1.row.label === 'spray · play (momentary)' && p1.row.glyph,
        JSON.stringify({ stored: p1.stored?.[7], leg: p1.leg, row: p1.row.label }));
  // The same tile onto the strip's head: it moves, and everything renumbers.
  // Moved to the head, the digits renumber: 1 is spray and PLAYS it, so the
  // press has to be ended again before anything else is driven.
  // A MOVE carries the entry's verb with it; only a fresh PLACE takes a default.
  const p2 = await rig.evaluate(() => { const H = window.__ba; H.drag(H.tileAt(8), H.xBefore(1));
    H.key('Digit1'); const play = { active: H.S._gestureActive(), lit: H.lit('spray'), bkey: H.brushKey() };
    H.key('Digit1', 'keyup');
    return { ...H.state(), play, verb1: H.verbs()[0], legs: [1, 2].map(n => H.legAt(n)?.text ?? null), row2: H.S._paletteRow(2).label }; });
  check('dragging spray before wide moves it to 1 with its verb; wide is 2; the digits follow: 1 plays spray',
        p2.pal[0] === 'spray' && p2.pal[1] === 'wide' && p2.verb1 === 'momentary' && p2.legs[0].startsWith('1') && p2.legs[1].startsWith('2') && p2.row2 === 'wide · on / off' && p2.play.active && p2.play.lit === 1, JSON.stringify({ pal: p2.pal, verb: p2.verb1, legs: p2.legs, play: p2.play }));
  check('… and its release ended it', !p2.active, JSON.stringify({ active: p2.active }));
  // Off the strip: picked up and let go anywhere else, it is gone. Nothing
  // has to move to the first tool left — nothing was in the hand.
  const p3 = await rig.evaluate(() => { const H = window.__ba; H.dragOff(H.tileAt(1)); H.tap('Digit1'); return { ...H.state(), muted: !!H.S.scanMuted, stored: H.stored(), rowStill: !!H.row('spray') }; });
  check('dragging spray off removes it: seven again, its rail row still there, stored; 1 is the wide lens again', p3.pal.join() === d0.pal.join() && p3.rowStill && p3.stored.length === 7 && p3.muted, JSON.stringify({ pal: p3.pal, muted: p3.muted }));
  await rig.evaluate(() => { const H = window.__ba; H.tap('Digit1'); H.openDrawer('pen'); });
  // The pin pair moves like anything else: pin to 1, and the 1 key pins.
  const p4 = await rig.evaluate(async () => { const H = window.__ba; const n0 = H.S.commitSlots.filter(Boolean).length;
    H.drag(H.tileAt(7), H.xBefore(1)); const pal = H.pal(); const row = H.S._paletteRow(1);
    H.tap('Digit1'); await new Promise(r => setTimeout(r, 900));
    const n1 = H.S.commitSlots.filter(Boolean).length;
    H.drag(H.tileAt(1), H.xEnd());
    return { pal, row, n0, n1, back: H.pal(), verbBack: H.verbs().slice(-1)[0] }; });
  check('pin dragged to 1: the row says pin here, 1 pins, and it moves back to the end with its verb', p4.pal[0] === 'pin' && p4.row.label === 'pin · pin here' && p4.n1 === p4.n0 + 1 && p4.back.join() === d0.pal.join() && p4.verbBack === 'bang', JSON.stringify(p4));
  // PIN IS THE KIND WITH ALL THREE VERBS (§ 4), and its drawn path is now a
  // verb rather than two extra actions: a TOGGLE opens the path on one press
  // and seals it on the next, a MOMENTARY draws it from the down to the up,
  // and a BANG pins where you stand.
  //
  // Pin at 7 CANNOT be momentary while button 3 TAP is bound to it — that is
  // the guard working, not a failure — so the path verbs are driven on a
  // SECOND pin tile at a position with nothing bound, which is also § 4's own
  // example of why a tool may sit on the strip twice.
  const p4b = await rig.evaluate(async () => { const H = window.__ba; const wait = ms => new Promise(r => setTimeout(r, ms)); const pins = () => H.S.commitSlots.filter(Boolean).length;
    // Through the API, not the cabinet button: run beside the cc suites and
    // the pool has been swept to a small `commitSlotCount` with slots still
    // in it, so a clear that half-works leaves every count pinned at the cap
    // and the deltas below read as zero. Restore the count too.
    const UP = await import('./js/ui-presets.js');
    H.S.commitSlotCount = Math.max(8, H.S.commitSlotCount | 0);
    const clear = async () => { UP.clearAllCommits(); await wait(400); };
    H.T.placeTile('pin', undefined, 'toggle');          // a second pin, at 8
    const n = H.pal().length;
    H.openDrawer('pin'); await wait(300); await clear();
    const segs = H.verbSeg().map(x => x.v);
    // Can this instance pin at all? Run beside the cc suites and the sweep can
    // leave the pool in a state where nothing new lands — which would make
    // every delta below read zero and the section fail for the wrong reason.
    // Prove a plain BANG pins first, and report rather than assert if not.
    H.setVerb(n, 'bang');
    const b0 = pins(); H.fire(n, true); await wait(1200); const canPin = pins() - b0;
    await clear();
    const n0 = pins();
    H.setVerb(n, 'toggle');
    H.fire(n, true); await wait(250); const mid = pins();
    H.fire(n, true); await wait(1200); const n1 = pins();
    await clear(); const m0 = pins();
    const setMom = H.setVerb(n, 'momentary');
    H.fire(n, true); await wait(250); H.fire(n, false); await wait(1200); const m1 = pins();
    const rows = ['bang', 'momentary', 'toggle'].map(v => { H.setVerb(n, v); return H.S._paletteRow(n).verb; });
    await clear();
    H.T.removeAt(n - 1);
    return { canPin, n0, mid, n1, m0, m1, rows, setMom, segs }; });
  check('pin\'s head offers all three verbs', ['bang', 'momentary', 'toggle'].every(v => p4b.segs.includes(v)), JSON.stringify(p4b.segs));
  // The path's slot exists WHILE it is being drawn — it is a moving cloud
  // growing under the cursor — so `mid` is the open path, not a second pin.
  // What the toggle must prove is that TWO presses leave ONE pin.
  if (p4b.canPin !== 1) console.log(`  --   this instance could not land a plain pin (${p4b.canPin}) — the pool is not in a state to test the drawn path; run \`palette\` alone`);
  else {
    check('pin as a TOGGLE: one press opens the path, the next seals it — one pin, not two', p4b.n1 - p4b.n0 === 1, JSON.stringify(p4b));
    check('pin as a MOMENTARY: down to up — one pin', p4b.setMom && p4b.m1 - p4b.m0 === 1, JSON.stringify(p4b));
  }
  check('… and the keys page says which it is, in pin\'s own words', p4b.rows.join('|') === 'pin here|pin a path (momentary)|pin a path (toggle)', JSON.stringify(p4b.rows));
  await rig.evaluate(async () => { const H = window.__ba; document.getElementById('commitClearBtn')?.click(); await new Promise(r => setTimeout(r, 300)); });
  // Off and back from ITS rail: unpin dragged off, then the pins rail's row
  // dragged in before pin.
  const p5 = await rig.evaluate(() => { const H = window.__ba; H.dragOff(H.tileAt(6)); const gone = H.pal();
    H.drag(document.querySelector('#tcPins [data-pin="unpin"]'), H.xBefore(6)); return { gone, back: H.pal() }; });
  check('unpin dragged off is gone; the pins rail\'s unpin row dragged in before pin puts it back', gone_ok(p5), JSON.stringify(p5));
  // EVERY tool can leave. The last one used to be pinned to the strip — a
  // palette with nothing to arm had nothing for space to do — and both halves
  // of that reason went on 2026-09-11.
  const p6 = await rig.evaluate(() => { const H = window.__ba; const r = ['line', 'pen', 'all', 'overdub'].map(id => H.T.removeFromPalette(id)); const a = H.state();
    return { r, a, stored: H.stored() }; });
  check('removing every tool: all four go, and the strip is lenses and pins alone', p6.r.join() === 'true,true,true,true' && p6.a.slots.length === 0 && p6.a.pal.join() === 'wide,unpin,pin', JSON.stringify(p6.a));
  check('… and it stores that way — no tool is forced back on', p6.stored.map(e => e.id).join() === 'wide,unpin,pin', JSON.stringify(p6.stored));
  await rig.evaluate(() => window.__ba.factory());
  const p7 = await st();
  check('cleanup: the factory seven', p7.pal.join() === d0.pal.join(), p7.pal.join());
  // Nine is full: a tenth drag is refused.
  const p8 = await rig.evaluate(() => { const H = window.__ba; H.T.placeTile('spot'); H.T.placeTile('slice'); const full = H.pal(); H.drag(H.row('comb'), H.xEnd()); const after = H.pal();
    H.T.removeFromPalette('spot'); H.T.removeFromPalette('slice'); return { full, after }; });
  check('nine is full: a tenth tile dragged on is refused', p8.full.length === 9 && p8.after.join() === p8.full.join(), JSON.stringify(p8));
  // No cycle mark in the rail, no cycle key, and the keys page lists every
  // position with the verbs its tile has.
  const p9 = await rig.evaluate(() => { const H = window.__ba; const R = n => H.S._paletteRow(n);
    const allowed = id => H.T.verbsOf(id);
    return { marks: document.querySelectorAll('#toolRail [data-cyc]').length, cycKey: localStorage.getItem('mubone_cycle_off'),
             rows: [1, 2, 3, 6, 7].map(n => R(n).label), empty: R(9),
             allowed: { tool: allowed('pen'), lens: allowed('wide'), pin: allowed('pin'), unpin: allowed('unpin') } }; });
  check('the rail carries no palette mark and the cycle key is gone', p9.marks === 0 && p9.cycKey === null, JSON.stringify({ marks: p9.marks, cycKey: p9.cycKey }));
  // ONE ROW PER POSITION, in the tile's own words — the three-verb row set is
  // gone with the three-verb position.
  check('one row per position, each in its tile\'s own words',
        p9.rows.join(' | ') === 'wide · on / off | line · play (toggle) | pen · play (momentary) | unpin · unpin | pin · pin here', p9.rows.join(' | '));
  // § 4's table: which verbs a kind MAY have, and which a drop lands on.
  check('a brush and a lens may be momentary or toggle and never a bang; pin has all three; unpin is a bang alone',
        p9.allowed.tool.allowed.join() === 'momentary,toggle' && p9.allowed.tool.def === 'momentary' &&
        p9.allowed.lens.allowed.join() === 'momentary,toggle' && p9.allowed.lens.def === 'toggle' &&
        p9.allowed.pin.allowed.join() === 'bang,momentary,toggle' && p9.allowed.pin.def === 'bang' &&
        p9.allowed.unpin.allowed.join() === 'bang' && p9.allowed.unpin.def === 'bang', JSON.stringify(p9.allowed));
  check('an empty position is ONE blank row that says to drag a tile there', !p9.empty.enabled && !p9.empty.hidden && /drag/.test(p9.empty.why), JSON.stringify(p9.empty));

  // ── E. Spring-loaded holds ────────────────────────────────────────────────
  }
  if (want('E')) {
  console.log('\n§ E the digits fire by position, in the tile\'s verb');
  await rig.evaluate(() => window.__ba.factory());
  const e0 = await st();
  check('setup: the factory seven, nothing playing', e0.pal.length === 7 && !e0.active, JSON.stringify(e0));
  // ARMING IS GONE, and `sel` with it: the module must not have grown one
  // back under another name. `selectedTile` answers what the DRAWER is on.
  const eSel = await rig.evaluate(() => {
    const T = window.__ba.T;
    return { exports: Object.keys(T).sort(), hasSel: 'sel' in T, arm: typeof T.armTile, load: typeof T.loadTile };
  });
  check('tiles.js exports no `sel`, no armTile and no loadTile', !eSel.hasSel && eSel.arm === 'undefined' && eSel.load === 'undefined', JSON.stringify(eSel));
  // A TOGGLE tile (line at 2): the down starts it latched and lights it, the
  // up does NOTHING, and the same digit again ends it.
  // A beat between plays. `startPaintStroke` is ASYNC — it waits on the mic —
  // and the rig has none, so a stop dispatched in the same synchronous block
  // can land before the start finishes and leave `S.isPainting` true for ever.
  // That is a real race in the audio path, not in the palette; it is paced
  // around here rather than papered over, and noted where it belongs.
  const settle = () => rig.evaluate(async () => { await new Promise(r => setTimeout(r, 260)); return true; });
  const d1 = await rig.evaluate(() => { const H = window.__ba; H.key('Digit2'); const down = { ...H.state(), lit: H.lit('line') };
    H.key('Digit2', 'keyup'); const up = { ...H.state(), lit: H.lit('line') };
    return { down, up }; });
  await settle();
  d1.end = await rig.evaluate(() => { const H = window.__ba; H.tap('Digit2'); return { ...H.state(), lit: H.lit('line') }; });
  await settle();
  check('2 is a TOGGLE tile: the down starts it, tape in the cursor, its tile lit', d1.down.active && d1.down.bkey === 'tape' && d1.down.lit === 1, JSON.stringify(d1.down));
  check('… its key-up does nothing', d1.up.active && d1.up.lit === 1, JSON.stringify(d1.up));
  check('… and the same digit again ends it', !d1.end.active && d1.end.lit === 0, JSON.stringify(d1.end));
  // A MOMENTARY tile (pen at 3): the up ENDS it. Without the up edge a
  // momentary digit latched on for ever, which is what this catches.
  const d2 = { down: await rig.evaluate(() => { const H = window.__ba; H.key('Digit3'); return { ...H.state(), lit: H.lit('pen') }; }) };
  await settle();
  d2.up = await rig.evaluate(() => { const H = window.__ba; H.key('Digit3', 'keyup'); return { ...H.state(), lit: H.lit('pen') }; });
  await settle();
  check('3 is a MOMENTARY tile: the down starts it and grain is in the cursor', d2.down.active && d2.down.bkey?.startsWith('grain') && d2.down.lit === 1, JSON.stringify(d2.down));
  check('… and its key-up ENDS it — a momentary digit must not latch', !d2.up.active && d2.up.lit === 0, JSON.stringify(d2.up));
  // ONE PLAY AT A TIME, and no hand-back: nothing is restored on release,
  // because nothing was in the hand to restore.
  const d3 = { a: await rig.evaluate(() => { const H = window.__ba; H.key('Digit2'); return { ...H.state(), litL: H.lit('line'), litP: H.lit('pen') }; }) };
  await settle();
  d3.b = await rig.evaluate(() => { const H = window.__ba; H.tap('Digit3'); return { ...H.state(), litL: H.lit('line'), litP: H.lit('pen') }; });
  await settle();
  d3.after = await rig.evaluate(() => { const H = window.__ba; H.key('Digit2', 'keyup'); H.tap('Digit2'); return { ...H.state(), hue: H.S._handHue }; });
  await settle();
  check('a second tool digit under a running play is dead', d3.b.active && d3.b.litL === 1 && d3.b.litP === 0, JSON.stringify(d3.b));
  check('… and when the play ends the hand is EMPTY — no hand-back, no hue', !d3.after.active && d3.after.hue === null, JSON.stringify(d3.after));
  // A BANG tile (pin at 7) and a LENS tile (wide at 1).
  const d4 = await rig.evaluate(async () => { const H = window.__ba; const wait = ms => new Promise(r => setTimeout(r, ms));
    H.S._gestureEnd?.(); await wait(200);
    document.getElementById('commitClearBtn')?.click(); await wait(400);
    const n0 = H.S.commitSlots.filter(Boolean).length;
    H.tap('Digit7'); await wait(900);
    const n1 = H.S.commitSlots.filter(Boolean).length;
    document.getElementById('commitClearBtn')?.click(); await wait(300);
    return { n0, n1, active: H.S._gestureActive() }; });
  check('7 is a BANG tile: one press pins once and starts no gesture', d4.n0 === 0 && d4.n1 === 1 && !d4.active, JSON.stringify(d4));
  const d5 = await rig.evaluate(() => { const H = window.__ba; H.lensOn(); H.tap('Digit1'); const a = { muted: !!H.S.scanMuted, lit: H.lensT().lit };
    H.tap('Digit1'); return { a, b: { muted: !!H.S.scanMuted, lit: H.lensT().lit }, d9: (H.tap('Digit9'), !!H.S._gestureActive()) }; });
  check('1 is a TOGGLE lens: off is the cap, on again brings it back; 9, empty, does nothing', d5.a.muted && d5.a.lit.length === 0 && !d5.b.muted && d5.b.lit.join() === 'wide' && !d5.d9, JSON.stringify(d5));
  // The 18 actions that carried the other two verbs are GONE from the
  // registry, and every surviving palette row's TYPE follows its tile.
  const d6 = await rig.evaluate(() => { const ids = window.__ba.S._actions.map(a => a.id);
    const pal = ids.filter(i => /^palette_[1-9]/.test(i));
    const typeOf = n => window.__ba.S._actions.find(a => a.id === `palette_${n}`)?.type;
    const fmtOf  = n => window.__ba.S._actions.find(a => a.id === `palette_${n}`)?.fmt;
    return { pal, n: pal.length, t2: typeOf(2), t3: typeOf(3), t7: typeOf(7), f3: fmtOf(3), f7: fmtOf(7) }; });
  check('27 palette actions are 9: no palette_N_toggle and no palette_N_hold', d6.n === 9 && !d6.pal.some(i => /_(toggle|hold)$/.test(i)), JSON.stringify(d6.pal));
  check('a row\'s TYPE follows its tile: momentary is a hold taking int 0|1, toggle and bang are triggers taking a bang',
        d6.t2 === 'trigger' && d6.t3 === 'hold' && d6.t7 === 'trigger' && d6.f3 === 'int 0|1' && d6.f7 === 'bang', JSON.stringify(d6));
  // The keys-page row is ONE row per position now, in the tile's own words.
  const d7 = await rig.evaluate(() => { const R = n => window.__ba.S._paletteRow(n);
    return { r2: R(2), r3: R(3), r1: R(1), r7: R(7), r6: R(6), r9: R(9) }; });
  check('one row per position, the verb in the tile\'s own words',
        d7.r2.label === 'line · play (toggle)' && d7.r3.label === 'pen · play (momentary)' && d7.r1.label === 'wide · on / off' && d7.r7.label === 'pin · pin here' && d7.r6.label === 'unpin · unpin', JSON.stringify(d7));
  check('… and an empty position is one blank row saying to drag a tile there', !d7.r9.enabled && !d7.r9.hidden && /drag/.test(d7.r9.why), JSON.stringify(d7.r9));
  // A relearned digit stands down, and a removed one is dead until it is
  // put back — unchanged by the verb model, and the check that proves it.
  const d8 = await rig.evaluate(() => { const H = window.__ba; const km = H.S._keyMappings;
    km.palette_2 = { type: 'key', code: 'KeyJ', shift: false, ctrl: false, meta: false }; H.S._bindingsChanged();
    H.tap('Digit2'); const a = { active: !!H.S._gestureActive(), lit: H.lit('line') };
    delete km.palette_2; km.palette_2 = { type: 'none' }; H.S._bindingsChanged();
    H.tap('Digit2'); const b = { active: !!H.S._gestureActive(), leg: H.legAt(2)?.text ?? '' };
    delete km.palette_2; H.S._bindingsChanged();
    H.key('Digit2'); const c = { active: !!H.S._gestureActive() }; H.key('Digit2', 'keyup'); H.tap('Digit2');
    return { a, b, c }; });
  check('palette_2 relearned onto J: 2 plays nothing', !d8.a.active && d8.a.lit === 0, JSON.stringify(d8.a));
  check('a REMOVED factory digit: 2 plays nothing and the tile wears no key', !d8.b.active && !/2/.test(d8.b.leg), JSON.stringify(d8.b));
  check('… put back, 2 plays line again', d8.c.active, JSON.stringify(d8.c));
  await rig.evaluate(() => window.__ba.factory());

  // ── F. Lens and cap — a lens is a state; no lens on is the cap ────────────
  }
  if (want('F')) {
  console.log('\n§ F lens and cap');
  const f0 = await rig.evaluate(() => { const H = window.__ba; H.T.closeProps(); if (H.T.installedLens() !== 'wide') H.lensRow('wide').click(); if (H.S.scanMuted) H.clickLens(H.T.installedLens());
    return { cap: H.capT(), lens: H.lensT() }; });
  check('setup: wide on', f0.lens.inst === 'wide' && f0.lens.on && f0.lens.rowOn && !f0.cap.muted, JSON.stringify(f0));
  const f1 = await rig.evaluate(() => { const H = window.__ba; H.clickLens(H.T.installedLens()); return { cap: H.capT(), lens: H.lensT() }; });
  check('tapping the lens tile that is on turns it off: the cursor reads nothing, tile and row dark', f1.cap.muted && !f1.lens.on && !f1.lens.rowOn && f1.lens.lit.length === 0, JSON.stringify(f1));
  check('… wide stays the installed lens, so the same lens comes back', f1.lens.inst === 'wide', f1.lens.inst);
  const f2 = await rig.evaluate(() => { const H = window.__ba; H.lensRow('spot').click(); return { cap: H.capT(), lens: H.lensT(), nearest: !!H.S.nearestMode, wideTile: !!document.querySelector('#paletteDock .tile--lens[data-lens="wide"].on') }; });
  check('choosing spot in the rail with no lens on installs it AND turns reading on', f2.lens.inst === 'spot' && !f2.cap.muted && f2.lens.rowOn && f2.nearest, JSON.stringify(f2));
  check('… the wide tile on the palette is dark: spot is not on the palette, so no tile is lit', !f2.wideTile && f2.lens.lit.length === 0 && !f2.lens.onPalette, JSON.stringify(f2.lens));
  const f3 = await rig.evaluate(() => { const H = window.__ba; H.lensRow('spot').click(); return { cap: H.capT(), lens: H.lensT() }; });
  check('tapping the on lens\'s ROW turns it off too', f3.cap.muted && !f3.lens.rowOn && f3.lens.inst === 'spot', JSON.stringify(f3));
  const f4 = await rig.evaluate(() => { const H = window.__ba; H.lensRow('wide').click(); return { cap: H.capT(), lens: H.lensT() }; });
  check('wide\'s row: wide on, reading, its palette tile lit', f4.lens.inst === 'wide' && !f4.cap.muted && f4.lens.on && f4.lens.rowOn, JSON.stringify(f4));
  // A second lens tile on the palette: a radio that can be all-off.
  const f5 = await rig.evaluate(() => { const H = window.__ba; H.T.placeTile('spot'); const both = H.pal().filter(id => ['wide', 'spot'].includes(id));
    H.clickLens('spot'); const a = { inst: H.T.installedLens(), lit: H.lensT().lit, muted: !!H.S.scanMuted };
    H.clickLens('spot'); const b = { inst: H.T.installedLens(), lit: H.lensT().lit, muted: !!H.S.scanMuted };
    H.clickLens('wide'); const c = { inst: H.T.installedLens(), lit: H.lensT().lit, muted: !!H.S.scanMuted };
    H.T.removeFromPalette('spot'); return { both, a, b, c }; });
  check('two lens tiles: tapping spot lights spot alone; again, neither (the cap); wide, wide alone', f5.both.length === 2 && f5.a.lit.join() === 'spot' && !f5.a.muted && f5.b.lit.length === 0 && f5.b.muted && f5.c.lit.join() === 'wide' && !f5.c.muted, JSON.stringify(f5));
  // S — scan_toggle — is the same state from the keyboard, without moving
  // the installed lens; refreshLensStates carries it to tile and row.
  const f7 = await rig.evaluate(() => { const H = window.__ba; H.S._dispatchAction('scan_toggle', 127); H.T.refreshLensStates(); const a = { cap: H.capT(), lens: H.lensT() };
    H.S._dispatchAction('scan_toggle', 127); H.T.refreshLensStates(); return { a, b: { cap: H.capT(), lens: H.lensT() } }; });
  check('S turns the lens off — tile and row dark, wide still installed — and S again turns it back on, without a render', f7.a.cap.muted && !f7.a.lens.on && !f7.a.lens.rowOn && f7.a.lens.inst === 'wide' && !f7.b.cap.muted && f7.b.lens.on && f7.b.lens.rowOn, JSON.stringify(f7));
  const f8 = await rig.evaluate(() => { const H = window.__ba;
    return { rows: [...document.querySelectorAll('#lensBar [data-lens]')].map(e => e.dataset.lens), more: [...document.querySelectorAll('#lensBar [data-lens]')].every(e => !!e.querySelector('[data-more]')), drag: [...document.querySelectorAll('#lensBar [data-lens]')].every(e => e.getAttribute('draggable') === 'true'), cap: H.capT() }; });
  check('the lens group is wide · spot, every row with the ⋯ and draggable; no cap row, no cap tile', f8.rows.join() === 'wide,spot' && f8.more && f8.drag && !f8.cap.row && !f8.cap.tile, JSON.stringify(f8));
  const f9 = await rig.evaluate(() => { const H = window.__ba; H.lensRow('wide').querySelector('[data-more]').click(); return H.state(); });
  check('the ⋯ on the on lens opens its drawer', f9.drawer && f9.head === 'wide', `drawer ${f9.drawer} head ${f9.head}`);
  const f9b = await rig.evaluate(() => { const H = window.__ba; H.lensRow('spot').querySelector('[data-more]').click();
    return { ...H.state(), inst: H.T.installedLens(), openRow: document.querySelector('#toolRail .trow--lens.open')?.dataset.lens }; });
  check('the ⋯ on another lens installs it and opens its drawer', f9b.drawer && f9b.inst === 'spot' && f9b.head === 'spot' && f9b.openRow === 'spot', JSON.stringify(f9b));
  await rig.evaluate(() => { const H = window.__ba; H.lensRow('spot').querySelector('[data-more]').click(); H.lensRow('wide').click(); });
  const f10 = await rig.evaluate(() => { const H = window.__ba; return { boxed: H.boxed(), cap: H.capT().tile, lens: H.lensT().armed, on: H.lensT().on }; });
  check('after all that: wide on, no cap tile, and nothing anywhere wears a box', !f10.cap && !f10.lens && f10.on && f10.boxed.length === 0, JSON.stringify(f10));
  await rig.evaluate(() => { window.__ba.T.closeProps(); window.__ba.T.setPropsOpen(false); });

  // ── G — DELETED (docs/PALETTE-GUI.md § 9) ─────────────────────────────────
  // "Lit, and tool keys fire" tested the ARMED BOX outranking the lit fill,
  // and there is no armed box — `.palette .tile.armed` and the `skin-arm`
  // keyframe are deleted, and § A now fails if any element wears `.armed` at
  // all. The lit fill itself is driven in § E and § H, where a play is.
  // ── H. The main button: toggle ────────────────────────────────────────────
  }
  if (want('H')) {
  console.log('\n§ H the verb is the tile\'s, not the caller\'s');
  await rig.evaluate(() => { const H = window.__ba; H.factory(); H.T.closeProps(); H.T.setPropsOpen(false); });
  const t0 = await rig.evaluate(() => { const H = window.__ba;
    return { seg: !!document.getElementById('gestureModeSeg'), tog: !!document.getElementById('paletteTriggerToggle'),
             ls: localStorage.getItem('mubone_gesture_momentary') ?? localStorage.getItem('mubone_palette_trigger'),
             active: !!H.S._gestureActive(), verbs: H.verbs() }; });
  check('no mode switch and no tool-keys-fire switch exist, their keys gone, nothing running', !t0.seg && !t0.tog && t0.ls === null && !t0.active, JSON.stringify(t0));
  check('the factory strip is toggle · toggle · momentary · momentary · momentary · bang · bang', t0.verbs.join() === 'toggle,toggle,momentary,momentary,momentary,bang,bang', t0.verbs.join());
  // THE MAIN BUTTON IS DELETED. Space and a click on the sphere both pressed
  // "the tool in the hand"; there is no hand, so both must be inert. This is
  // the check that catches either wire being quietly restored.
  const tDead = await rig.evaluate(() => { const H = window.__ba;
    H.key('Space'); const sp = { active: H.S._gestureActive(), held: !!H.S.eraseHeld }; H.key('Space', 'keyup');
    const md = t => H.S.canvas.dispatchEvent(new MouseEvent(t, { button: 0, bubbles: true, cancelable: true }));
    md('mousedown'); const cl = { active: H.S._gestureActive(), held: !!H.S.eraseHeld }; md('mouseup');
    return { sp, cl, after: H.S._gestureActive() }; });
  check('space starts nothing — a free key, learnable onto a position', !tDead.sp.active && !tDead.sp.held, JSON.stringify(tDead.sp));
  check('a click on the SPHERE starts nothing (§ 5.1)', !tDead.cl.active && !tDead.cl.held && !tDead.after, JSON.stringify(tDead));
  // The caller cannot choose: `_paletteFire` takes an EDGE and nothing else.
  // A momentary tile ends when its input goes up; a toggle ignores that same
  // up and ends on the next down. Same call, opposite outcome, because the
  // tile differs — which is the whole of § 1.
  const t1 = await rig.evaluate(() => { const H = window.__ba;
    H.fire(3, true); const a = { active: H.S._gestureActive(), lit: H.lit('pen') };
    H.fire(3, false); const b = { active: H.S._gestureActive(), lit: H.lit('pen') };
    H.fire(2, true); const c = { active: H.S._gestureActive(), lit: H.lit('line') };
    H.fire(2, false); const d = { active: H.S._gestureActive(), lit: H.lit('line') };
    H.fire(2, true); const e = { active: H.S._gestureActive(), lit: H.lit('line') };
    return { a, b, c, d, e }; });
  check('the MOMENTARY tile at 3 ends on its up edge', t1.a.active && t1.a.lit === 1 && !t1.b.active && t1.b.lit === 0, JSON.stringify(t1));
  check('the TOGGLE tile at 2 ignores the SAME up edge and ends on the next down', t1.c.active && t1.d.active && t1.d.lit === 1 && !t1.e.active, JSON.stringify(t1));
  // Flip the verb and the same edges mean the other thing. Nothing about the
  // caller changed; the tile did.
  const t2 = await rig.evaluate(() => { const H = window.__ba;
    H.openDrawer('pen'); const seg = H.verbSeg();
    H.setVerb(3, 'toggle');
    H.fire(3, true); H.fire(3, false); const held = { active: H.S._gestureActive(), verb: H.verbs()[2] };
    H.fire(3, true); const ended = H.S._gestureActive();
    H.setVerb(3, 'momentary');
    return { seg, held, ended, back: H.verbs()[2] }; });
  check('the drawer head offers only that kind\'s verbs — a brush gets momentary and toggle, never bang', t2.seg.map(x => x.v).join() === 'momentary,toggle', JSON.stringify(t2.seg));
  check('flipped to TOGGLE, pen\'s up edge stops ending it and the next down does', t2.held.verb === 'toggle' && t2.held.active && !t2.ended, JSON.stringify(t2));
  check('… and flipping it back restores momentary', t2.back === 'momentary', t2.back);
  // A momentary tile cannot take a TAP: a tap is a bang with no up edge, so
  // it would fire 127 with no 0 and latch the tile on for ever. `_learnGesture`
  // refuses it when a key is learned; the drawer must refuse it too, and it
  // refuses BEFORE the click by not offering the segment.
  const t3 = await rig.evaluate(() => { const H = window.__ba; const km = H.S._keyMappings;
    km.palette_2 = { type: 'key', key: 'j', code: 'KeyJ', shift: false, ctrl: false, meta: false, g: 'tap' };
    H.S._bindingsChanged(); H.openDrawer('line');
    const seg = H.verbSeg();
    const moved = H.setVerb(2, 'momentary');
    const after = H.verbs()[1];
    delete km.palette_2; H.S._bindingsChanged();
    return { seg, moved, after }; });
  check('with a TAP bound on it, the momentary segment is inert and says why', t3.seg.find(x => x.v === 'momentary')?.dis === true && !t3.moved, JSON.stringify(t3.seg));
  check('… and the verb did not move', t3.after === 'toggle', t3.after);
  // The eraser's long press survives the model change.
  const t10 = await rig.evaluate(async () => { const H = window.__ba; const { GESTURE_LONG_MS } = await import('./js/state.js');
    const real = H.S._sessionEraseAll; let calls = 0; H.S._sessionEraseAll = () => { calls++; };
    let blurs = 0; const onBlur = () => { blurs++; }; window.addEventListener('blur', onBlur);
    H.openDrawer('all'); H.setVerb(4, 'toggle');          // a long press needs a gesture that outlives the key
    H.fire(4, true); const a = { held: !!H.S.eraseHeld, calls };
    await new Promise(r => setTimeout(r, GESTURE_LONG_MS + 300));
    window.removeEventListener('blur', onBlur);
    const b = { held: !!H.S.eraseHeld, active: H.S._gestureActive(), calls, blurs };
    H.S._gestureEnd(); H.S._sessionEraseAll = real; H.setVerb(4, 'momentary');
    return { a, b, ms: GESTURE_LONG_MS }; });
  if (t10.b.blurs > 0) console.log(`  --   the window lost focus ${t10.b.blurs}× during the ${t10.ms} ms hold — the long press was cancelled by the blur, as designed; rerun to test it`);
  else check(`an eraser held ${t10.ms} ms still erases all, once, and the gesture ends`, t10.a.held && t10.a.calls === 0 && !t10.b.held && !t10.b.active && t10.b.calls === 1, JSON.stringify(t10));
  await rig.evaluate(() => window.__ba.factory());

  // ── I. The wash, and `on end` (Ek, 2026-09-05) ───────────────────────────
  // The looper's move for the grain family: a brush whose stroke is pinned as
  // a moving cloud on release. The observable is the engine flag the row
  // drives — S.traceMode — which the A key and /trace/mode used to cycle
  // under the palette; arming a tile must set it and the row must read it.
  }
  if (want('I')) {
  console.log('\n§ I the pen ships wet, and the wash brings its own sound');
  // There was a `pencil` for a few hours — the pen's wet twin — and it went
  // (Ek: "wet is more of a brush wide property i dont think i need a dedicated
  // brush for it, but start the pen with the wet on by factory default"). So
  // the assertion is the DEFAULT, not a pair: wet is a property every grain
  // brush has, and the only thing decided centrally is which way the pen starts.
  // Its own precondition: the pen on `scratch`. In a combined boot the engine
  // suite has just moved every choice on every tile and the tile keeps the
  // edit, so this section arrived flipped about one run in three (the flake of
  // 2026-09-05). The sheet captures on a 250 ms debounce, so the reset waits.
  await rig.evaluate(async () => { const H = window.__ba; const q = s => document.querySelector(s);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    // Wait for the sheet before reaching into it. The old form queried the row
    // in the same tick as the Tab that opens it, so the reset was a no-op that
    // only passed while this section measured a tile nothing else had touched.
    H.openDrawer('pen'); await wait(250);
    if (!document.body.classList.contains('prail-open')) { H.key('Tab'); await wait(320); }
    if (H.S.traceMode !== 'trace') { q('#propRail [data-sw="gend"]')?.click(); await wait(450); }
  });
  const w1 = await rig.evaluate(async () => { const H = window.__ba; const q = s => document.querySelector(s);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    H.openDrawer('pen'); await wait(120);
    const a = { ...H.state(), mode: H.S.traceMode, wet: H.T.isWet('pen'),
                hasA: !!H.S._actions?.find?.(x => x.id === 'trace_mode') };
    H.openDrawer('pen'); await wait(120);
    const b = { armed: H.picked(), mode: H.S.traceMode, wet: H.T.isWet('pen') };
    H.openDrawer('pen'); H.key('Tab'); await wait(200);
    const on = q('#propRail [data-sw="gend"]')?.classList.contains('on') ? 'cloud' : 'scratch';
    const sw = !!document.querySelector('#propRail .prow--sw [data-wet].on');   // the deposit row's switch (2026-09-10)
    return { a, b, on, sw, rows: H.rows() }; });
  check('the pen ships WET', w1.a.wet === true, JSON.stringify({ pen: w1.a.wet }));
  check('… and its deposit section shows that switch on', w1.sw, String(w1.sw));
  check('there is no pencil — wet is a property, not a tool',
        !w1.rows.includes('pencil'), w1.rows.join());
  check('the pen paints scratch', w1.a.mode === 'trace' && w1.on === 'scratch',
        JSON.stringify({ mode: w1.a.mode, onEnd: w1.on }));
  check('… and the trace_mode action is gone with the A key', !w1.a.hasA, String(w1.a.hasA));
  // The WASH is a tool of its own again (2026-09-07). It briefly lost its id
  // to a `pencil` tile and with it both its identifying marks; Ek had it back
  // within the hour. What is asserted is what makes it a tool rather than a
  // setting: cloud baked in, and a sound of its own.
  const w3 = await rig.evaluate(async () => { const H = window.__ba;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    H.openDrawer('wash'); await wait(200);
    const dur = (document.getElementById('gcDurNum')?.value ?? '').trim();
    const lpf = (document.getElementById('gcLpfNum')?.value ?? '').trim();
    const per = (document.getElementById('gcPeriodNum')?.value ?? '').trim();
    return { armed: H.picked(), mode: H.S.traceMode, wet: H.T.isWet('wash'),
             cloudSw: !!document.querySelector('#propRail [data-sw="gend"].on'),
             dur, per, lpf, rows: H.rows() }; });
  check('the wash is back, with cloud on end baked in',
        w3.armed === 'wash' && w3.mode === 'trace+cloud' && w3.cloudSw,
        JSON.stringify({ armed: w3.armed, mode: w3.mode, sw: w3.cloudSw, wet: w3.wet }));
  check('… and it arrives sounding like a wash: 400 ms grains every 15 ms, dark',
        Math.abs(parseFloat(w3.dur) - 400) < 6 && Math.abs(parseFloat(w3.per) - 15) < 0.5 && /^6(\.0)?k/.test(w3.lpf),
        JSON.stringify({ dur: w3.dur, per: w3.per, lpf: w3.lpf }));
  check('… and it sits in the rail right after the pen',
        w3.rows.indexOf('wash') === w3.rows.indexOf('pen') + 1, w3.rows.join());
  // The sheet captures on a 250 ms debounce (captureTileParams); a hand
  // cannot re-arm inside it, so the audit waits for the capture to land.
  // `on end` is a SWITCH since 2026-09-07 — "cloud on end", yes or no, the
  // same shape and the same question as the tape engine's `loop on end`.
  const w2 = await rig.evaluate(async () => { const H = window.__ba; const q = s => document.querySelector(s); const wait = ms => new Promise(r => setTimeout(r, ms));
    // Arm the PEN explicitly: the wash check above leaves the wash armed, and
    // the wash already IS cloud, so without this the section measured the
    // switch on one tile and the memory on another.
    H.openDrawer('pen'); await wait(250);
    const sw = () => q('#propRail [data-sw="gend"]');
    const isCloud = () => !!sw()?.classList.contains('on');
    const nSw = document.querySelectorAll('#propRail [data-sw="gend"]').length;
    const noSeg = !q('#propRail [data-gend]');
    // 450, not 320: the switch's capture is debounced 250 ms and the sheet
    // re-renders 90 ms after it, so a shorter wait armed away before the
    // tile had stored anything and read as the tile forgetting.
    if (!isCloud()) sw().click(); await wait(450);
    const a = { mode: H.S.traceMode, on: isCloud() };
    H.openDrawer('wash'); await wait(200); const b = H.S.traceMode;
    H.openDrawer('pen'); await wait(200); const c = H.S.traceMode;
    // and back off again, so the tile is left as it ships
    if (isCloud()) sw().click(); await wait(450);
    const d = H.S.traceMode;
    H.key('Tab');
    return { nSw, noSeg, a, b, c, d };
  });
  check('`on end` is one switch — cloud on end, yes or no — and the segment is gone',
        w2.nSw === 1 && w2.noSeg, JSON.stringify({ switches: w2.nSw, segGone: w2.noSeg }));
  check('switching it on pins the stroke as a cloud, and the tile remembers it',
        w2.a.mode === 'trace+cloud' && w2.a.on && w2.b === 'trace+cloud' && w2.c === 'trace+cloud',
        JSON.stringify(w2));
  check('… and switching it off puts the tile back to scratch',
        w2.d === 'trace', String(w2.d));

  }
  if (want('J')) {
  console.log('\n§ J the wet button — grain rows only, a tap flips, never loads');
  const j1 = await rig.evaluate(() => { const H = window.__ba; const qa = s => [...document.querySelectorAll(s)];
    const withBtn = qa('#toolRail .trow[data-tile] [data-wet-tgl]').map(b => b.closest('[data-tile]').dataset.tile);
    const btn = id => H.row(id)?.querySelector('[data-wet-tgl]');
    const wasWet = H.T.isWet('pen');
    if (wasWet) H.T.setWet('pen', false);
    H.openDrawer('line');
    const before = { ...H.state(), on: !!btn('pen')?.classList.contains('on') };
    btn('pen').click();
    const a = { ...H.state(), wet: H.T.isWet('pen'), on: !!btn('pen')?.classList.contains('on') };
    btn('pen').click();
    const b = { ...H.state(), wet: H.T.isWet('pen'), on: !!btn('pen')?.classList.contains('on') };
    if (wasWet) H.T.setWet('pen', true);
    return { withBtn, before, a, b }; });
  check('every grain brush row wears the wet button; no loop or erase row does',
        ['pen', 'wash', 'spray'].every(id => j1.withBtn.includes(id)) && !['line', 'looper', 'overdub', 'slice', 'all'].some(id => j1.withBtn.includes(id)), JSON.stringify(j1.withBtn));
  check('a tap makes the brush wet and fills the drop — the drawer does not move',
        !j1.before.on && j1.a.wet && j1.a.on && j1.a.picked === j1.before.picked && j1.a.drawer === j1.before.drawer && j1.a.rail === j1.before.rail, JSON.stringify({ before: j1.before, a: j1.a }));
  check('… and a second tap dries it, the drop outlined again', !j1.b.wet && !j1.b.on && j1.b.picked === j1.before.picked, JSON.stringify(j1.b));

  // ── K. The `+` on an engine's title (2026-09-10) ─────────────────────────
  // It replaced a `new tool` row at the foot of the list and the engine
  // chooser it opened: the title already says the engine.
  }
  if (want('K')) {
  console.log('\n§ K the + on each engine title — mints that engine\'s tool, no new row, no chooser');
  const k1 = await rig.evaluate(() => { const qa = s => [...document.querySelectorAll(s)];
    const grps = qa('#toolRail .tbx-grp').map(g => ({ grp: g.dataset.grp ?? g.querySelector('.tbx-lbl')?.firstChild?.textContent?.trim(), add: g.querySelector('.tbx-lbl [data-add]')?.dataset.add ?? null,
      beside: (() => { const l = g.querySelector('.tbx-lbl'), a = l?.querySelector('[data-add]'); if (!a) return null;
        const r = document.createRange(); r.selectNodeContents(l.firstChild); const tr = r.getBoundingClientRect(), ar = a.getBoundingClientRect();
        return { gap: +(ar.left - tr.right).toFixed(1), h: +(ar.height).toFixed(1) }; })() }));
    return { grps, addRow: !!document.querySelector('#toolRail [data-tile="add"]'), newGrp: qa('#toolRail .tbx-lbl').some(l => /new/i.test(l.textContent)) }; });
  check('lens, tape, grain and erase each carry a +; source does not; no new row, no NEW group',
        ['lens', 'tape', 'granular', 'erase'].every(e => k1.grps.some(g => g.add === e)) && !k1.grps.some(g => g.add && !['lens', 'tape', 'granular', 'erase'].includes(g.add)) && !k1.addRow && !k1.newGrp, JSON.stringify(k1));
  check('… and each + sits just right of the title word (Ek: "just to the right of the title")', k1.grps.filter(g => g.beside).every(g => g.beside.gap >= 0 && g.beside.gap <= 12), JSON.stringify(k1.grps.map(g => g.beside)));
  // All three slot engines — the tape one caught ENGINE_TILE still keyed
  // `loop`, which minted a tile with no kind.
  const k2 = await rig.evaluate(() => { const H = window.__ba; H.key('Tab'); const out = {};
    for (const eng of ['tape', 'granular', 'erase']) {
      const before = H.rows().length;
      document.querySelector(`#toolRail [data-add="${eng}"]`).click();
      const id = H.picked(); const row = H.row(id);
      const spark = row?.querySelector('svg path')?.getAttribute('d')?.startsWith('M12 2.5c');
      const st = { ...H.state(), id, grp: row?.closest('.tbx-grp')?.dataset.grp, own: !!row?.classList.contains('trow--own'), rows: H.rows().length - before, kind: H.T.slotKind(id), label: row?.querySelector('.tile-nm')?.textContent, spark, onPalette: !!document.querySelector(`#paletteDock [data-tile="${id}"]`) };
      // Delete is the drawer head's button now (2026-09-10) — the drawer is open on the minted tool
      const del = document.querySelector('#propRail .ds-head [data-deltile]');
      st.delInHead = !!del && !del.disabled; del?.click();
      out[eng] = { st, after: H.rows().length - before, gone: !H.row(id) };
    }
    return out; });
  for (const eng of ['tape', 'granular', 'erase']) {
    const k = k2[eng];
    // Not on the palette: minting PICKS the tool for the drawer, and placing
    // is drag alone since arming went (2026-09-11) — the mint used to put it
    // in the armed slot, because the armed tool had to be on the strip.
    check(`the ${eng} + mints a custom ${eng} tool in its group, picked, drawer open on it, and NOT placed`,
          k.st.own && k.st.grp === eng && k.st.kind === eng && k.st.rows === 1 && k.st.drawer && k.st.head === k.st.label && !k.st.onPalette, JSON.stringify(k.st));
    check(`… it wears the spark, and Delete in its drawer head puts the rail back`, k.st.spark && k.st.delInHead && k.after === 0 && k.gone, JSON.stringify(k));
  }
  const k3 = await rig.evaluate(() => { const H = window.__ba; const inst = H.T.installedLens();
    document.querySelector('#toolRail [data-add="lens"]').click();
    const id = H.T.installedLens(); const row = H.lensRow(id);
    const st = { ...H.state(), id, minted: id !== inst, own: !!row?.classList.contains('trow--own'), openRow: document.querySelector('#toolRail .trow--lens.open')?.dataset.lens,
                 spark: !!row?.querySelector('svg path')?.getAttribute('d')?.startsWith('M12 2.5c'), tileSpark: !!document.querySelector('#paletteDock .tile--lens svg path')?.getAttribute('d')?.startsWith('M12 2.5c') };
    const del = document.querySelector('#propRail .ds-head [data-deltile]'); st.delInHead = !!del && !del.disabled; del?.click();
    return { st, back: H.T.installedLens(), gone: !H.lensRow(id) }; });
  check('the lens + mints a custom lens, installs it and opens its page', k3.st.minted && k3.st.own && k3.st.drawer && k3.st.openRow === k3.st.id, JSON.stringify(k3.st));
  check('… and it wears the spark on its row (it is not on the palette until dragged there)', k3.st.spark && !k3.st.tileSpark, JSON.stringify(k3.st));
  check('… and Delete in its head falls back to a factory lens', k3.st.delInHead && k3.gone && k3.back !== k3.st.id, JSON.stringify(k3));
  // ── Factory tools delete too (Ek, 2026-09-10: "delete should be available for the
  // factory defaults also … of course if we do factory reset the originals will come back") ──
  const k4 = await rig.evaluate(() => { const H = window.__ba; const out = {};
    // a factory grain tool that is NOT the pick: its row and its stored mark go
    H.openDrawer('pen'); H.row('comb').querySelector('[data-more]').click();   // picks comb, opens its drawer
    const del = document.querySelector('#propRail .ds-head [data-deltile]');
    out.combBtn = { there: !!del, disabled: !!del?.disabled, cls: del?.className };
    del?.click();
    out.comb = { row: !!H.row('comb'), stored: JSON.parse(localStorage.getItem('mubone_tiles_gone') || '[]'), picked: H.picked(), tile: H.T.slotKind('comb') !== null };
    // the PICKED factory tool: the drawer falls back to the first tool left
    H.openDrawer('spray');   // the drawer is still open from comb's ⋯, and follows
    document.querySelector('#propRail .ds-head [data-deltile]')?.click();
    out.spray = { row: !!H.row('spray'), picked: H.picked(), first: H.rows().find(id => H.T.slotKind(id)), drawer: H.drawer(), head: H.sheetHead() };
    // the last tool of a kind cannot go: erase down to one, its Delete is disabled
    for (const id of ['scrape', 'bottom']) { H.row(id).querySelector('[data-more]').click(); document.querySelector('#propRail .ds-head [data-deltile]')?.click(); }
    H.row('all').querySelector('[data-more]').click();
    const last = document.querySelector('#propRail .ds-head [data-deltile]');
    out.last = { rows: H.rows().filter(id => H.T.slotKind(id) === 'erase'), disabled: !!last?.disabled, title: last?.title };
    last?.click();
    out.lastStill = { rows: H.rows().filter(id => H.T.slotKind(id) === 'erase'), onPal: H.pal().includes('all') };
    // a factory reset of the ui category brings them back: clear the key and reload the rail's state the way boot does
    localStorage.removeItem('mubone_tiles_gone');
    return out; });
  check('a factory tool\'s drawer head carries Delete, in the settings Clear-all face, enabled', k4.combBtn.there && !k4.combBtn.disabled && /\bds-del\b/.test(k4.combBtn.cls) && !/mu-btn/.test(k4.combBtn.cls), JSON.stringify(k4.combBtn));
  check('deleting a factory grain tool takes its row, stores the deletion, and tileById no longer knows it', !k4.comb.row && k4.comb.stored.includes('comb') && !k4.comb.tile, JSON.stringify(k4.comb));
  check('deleting the PICKED factory tool: its row goes, the drawer falls back to the first tool left and follows it', !k4.spray.row && k4.spray.picked === k4.spray.first && k4.spray.drawer && k4.spray.head === k4.spray.first, JSON.stringify(k4.spray));
  check('the last tool of a kind cannot be deleted: its Delete is disabled and says why, and a click changes nothing', k4.last.rows.length === 1 && k4.last.disabled && /last tool/.test(k4.last.title || '') && k4.lastStill.rows.length === 1 && k4.lastStill.onPal, JSON.stringify({ last: k4.last, still: k4.lastStill }));
  // the reload: a fresh boot with the key cleared must show every factory tool again
  const k5 = await rig.evaluate(() => ({ gone: localStorage.getItem('mubone_tiles_gone') }));
  await rig.reload();
  await installHelpers(rig);
  const k6 = await rig.evaluate(() => { const H = window.__ba; return { comb: !!H.row('comb'), spray: !!H.row('spray'), erase: H.rows().filter(id => H.T.slotKind(id) === 'erase').length }; });
  check('after a factory reset of the key and a reboot, the originals are back', k5.gone === null && k6.comb && k6.spray && k6.erase === 3, JSON.stringify({ k5, k6 }));
  await rig.evaluate(() => { const H = window.__ba; H.T.closeProps(); H.T.setPropsOpen(false); H.openDrawer('pen'); });

  // ── L. Keys and notes are button sources (Ek, 2026-09-11) ─────────────────
  // "can the keyboard do that too? it should follow the same system/rule as
  // the buttons": a learned key or a MIDI note goes through midi.js's
  // recogniser with the buttons' six gestures and timings. Q tap and Q long
  // play two positions; a digit's extra long plays a third; a key learned by
  // holding it is learned WITH its gesture; a note held past the long time
  // plays a momentary and lets go on the note-off.
  }
  if (want('L')) {
  console.log('\n§ L keys and notes through the button recogniser');
  await rig.evaluate(() => window.__ba.factory());
  // "Can the keyboard do that too? it should follow the same system/rule as
  // the buttons": a learned key or a MIDI note goes through midi.js's
  // recogniser with the buttons' six gestures and timings. Two positions on
  // one key, and the gesture the action's TYPE needs — which is now the
  // TILE's verb's business (§ 1), so a long on a momentary tile carries both
  // edges and a long on a toggle tile is a bang.
  const l1 = await rig.evaluate(async () => { const H = window.__ba; const wait = ms => new Promise(r => setTimeout(r, ms)); const km = H.S._keyMappings;
    const t0 = H.S._buttonTiming.get(); H.S._buttonTiming.set({ long: 200, xlong: 500, tap: 120 });
    km.palette_2 = { type: 'key', key: 'q', code: 'KeyQ', shift: false, ctrl: false, meta: false, g: 'tap' };
    km.palette_3 = { type: 'key', key: 'q', code: 'KeyQ', shift: false, ctrl: false, meta: false, g: 'long' };
    H.S._bindingsChanged();
    const legend = { line: H.legAt(H.pos('line') + 1)?.text, pen: H.legAt(H.pos('pen') + 1)?.text };
    H.openDrawer('all');                       // the DRAWER is on the eraser
    const drawerBefore = H.picked();
    // Q TAP fires position 2 — a TOGGLE tile, so the bang starts it and it
    // keeps running after the key is up.
    H.key('KeyQ'); await wait(60); H.key('KeyQ', 'keyup'); await wait(200);
    const tap = { active: H.S._gestureActive(), lit: H.lit('line'), bkey: H.brushKey(), picked: H.picked() };
    H.key('KeyQ'); await wait(60); H.key('KeyQ', 'keyup'); await wait(200);
    const tapOff = H.S._gestureActive();
    // Q LONG fires position 3 — a MOMENTARY tile, so it plays WHILE DOWN and
    // the release lets go. Read it while it is down.
    H.key('KeyQ'); await wait(320);
    const longDown = { active: H.S._gestureActive(), lit: H.lit('pen'), bkey: H.brushKey() };
    H.key('KeyQ', 'keyup'); await wait(200);
    const longUp = { active: H.S._gestureActive(), lit: H.lit('pen') };
    delete km.palette_2; delete km.palette_3; H.S._bindingsChanged(); H.S._buttonTiming.set(t0);
    return { legend, drawerBefore, tap, tapOff, longDown, longUp, pickedAfter: H.picked() }; });
  check('Q tap fires position 2 and Q long fires position 3 — two positions on one key; the tiles say so',
        l1.tap.active && l1.tap.lit === 1 && l1.tap.bkey === 'tape' && !l1.tapOff &&
        l1.longDown.active && l1.longDown.lit === 1 && l1.longDown.bkey?.startsWith('grain'),
        JSON.stringify(l1));
  check('… and each fires in its TILE\'s verb: the toggle at 2 outlives its key, the momentary at 3 does not',
        !l1.tapOff && !l1.longUp.active && l1.longUp.lit === 0, JSON.stringify({ tapOff: l1.tapOff, longUp: l1.longUp }));
  check('the tiles wear "q tap" and "q long"', /q\s*tap/.test(l1.legend.line ?? '') && /q\s*long/.test(l1.legend.pen ?? ''), JSON.stringify(l1.legend));
  // § 5.2: Tab and the properties footer follow the last tile FIRED — so a
  // key moves the drawer, where it used not to. One rule, one variable.
  check('firing from the keyboard MOVES the drawer (§ 5.2), it does not leave it behind',
        l1.drawerBefore === 'all' && l1.tap.picked === 'line' && l1.pickedAfter === 'pen', JSON.stringify({ before: l1.drawerBefore, afterTap: l1.tap.picked, end: l1.pickedAfter }));
  // A key learned by HOLDING it is learned with its gesture.
  const l2 = await rig.evaluate(async () => { const H = window.__ba; const wait = ms => new Promise(r => setTimeout(r, ms)); const km = H.S._keyMappings;
    const t0 = H.S._buttonTiming.get(); H.S._buttonTiming.set({ long: 200, xlong: 500, tap: 120 });
    document.getElementById('tcSettings')?.click(); await wait(500);
    const nav = [...document.querySelectorAll('#settingsModal button, #settingsModal [data-section]')].find(b => /^keys/i.test(b.textContent.trim())); nav?.click(); await wait(400);
    const row = [...document.querySelectorAll('#mappingTableBody .set-table-row')].find(r => r.querySelector('.set-row-name')?.textContent === 'line' && r.querySelector('.set-row-verb')?.textContent === 'play (toggle)');
    const cell = row?.querySelectorAll('.bind-cell')[0]?.querySelector('button');
    cell?.click(); await wait(50); const learning = H.S._isKeyLearning();
    H.key('KeyR'); await wait(320); H.key('KeyR', 'keyup'); await wait(200);
    const learned = km.palette_2 ? { ...km.palette_2 } : null; const after = H.S._isKeyLearning();
    delete km.palette_2; H.S._bindingsChanged(); H.S._buttonTiming.set(t0);
    document.getElementById('settingsClose')?.click(); document.querySelector('.settings-dialog .close-btn')?.click(); await wait(200);
    return { row: !!row, cell: !!cell, learning, learned, after }; });
  check('the keys page lists ONE row per position, in the tile\'s words, and learning reads the whole gesture: R held past long learns "R long"',
        l2.row && l2.cell && l2.learning && l2.learned?.code === 'KeyR' && l2.learned?.g === 'long' && !l2.after, JSON.stringify(l2));
  // A MIDI note is a button source too — and it binds to `palette_N`, the one
  // action a position has. `palette_N_hold` is gone.
  await rig.evaluate(() => { localStorage.setItem('mubone_midi_map', JSON.stringify({ palette_3: { type: 'note', channel: 1, number: 60, g: 'long' } })); });
  await rig.reload(); await installHelpers(rig);
  const l3 = await rig.evaluate(async () => { const H = window.__ba; const wait = ms => new Promise(r => setTimeout(r, ms));
    H.openDrawer('line');
    const legend = H.legAt(H.pos('pen') + 1)?.text ?? null;
    H.S._handleMidiMessage({ data: [0x90, 60, 100] }); await wait(H.S._buttonTiming.get().long + 160);
    const a = { active: H.S._gestureActive(), lit: H.lit('pen'), bkey: H.brushKey() };
    H.S._handleMidiMessage({ data: [0x80, 60, 0] }); await wait(200); const b = { active: H.S._gestureActive(), lit: H.lit('pen') };
    H.S._handleMidiMessage({ data: [0x90, 60, 100] }); await wait(60); H.S._handleMidiMessage({ data: [0x90, 60, 0] }); await wait(200); const c = { active: H.S._gestureActive() };
    localStorage.removeItem('mubone_midi_map'); return { legend, a, b, c }; });
  check('note 60 held past long plays the MOMENTARY tile at 3, the note-off lets go, a short note does nothing',
        l3.a.active && l3.a.lit === 1 && l3.a.bkey?.startsWith('grain') && !l3.b.active && l3.b.lit === 0 && !l3.c.active, JSON.stringify(l3));
  check('… and the tile says "n 60 long"', /n\s*60\s*long/.test(l3.legend ?? ''), JSON.stringify(l3.legend));
  await rig.reload(); await installHelpers(rig);
  await rig.evaluate(() => window.__ba.factory());


  }

  // ── M. SHAPE IS THE VERB (docs/PALETTE-GUI.md § 3, "new I" there) ─────────
  // The doc calls this section I and the next J; both letters were already
  // taken by the wash and the wet button when it was written, so they are M
  // and N here. Ek's rule 6 applies to both: FORCE each state and read it
  // back — an empty diff proves only that nothing visible moved.
  //
  // One closed outline, one property. The computed radius is the claim:
  // 999px on every bang, --r-hand (10px) on every momentary, 24px 3px on
  // every toggle (the browser collapses the four-value shorthand to two when
  // the diagonals match). No tile may share an outline with a different verb —
  // that is what makes the shape READABLE rather than decorative.
  if (want('M')) {
  console.log('\n§ M shape is the verb');
  await rig.evaluate(() => window.__ba.factory());
  const R = { bang: '999px', momentary: '10px', toggle: '24px 3px' };
  const m0 = await rig.evaluate(() => { const H = window.__ba; return { verbs: H.verbs(), radii: H.radii(), stored: H.stored_verbs() }; });
  check('the strip reports a verb for every tile, and the model agrees', m0.verbs.length === 7 && m0.verbs.join() === m0.stored.join(), JSON.stringify(m0.verbs));
  const pairs = m0.verbs.map((v, i) => `${v}=${m0.radii[i]}`);
  check('every tile draws its verb\'s radius', m0.verbs.every((v, i) => m0.radii[i] === R[v]), pairs.join(' '));
  // No two verbs share an outline.
  const byVerb = {};
  m0.verbs.forEach((v, i) => { (byVerb[v] ||= new Set()).add(m0.radii[i]); });
  const collide = Object.entries(byVerb).filter(([v, set]) => set.size !== 1 || [...set][0] !== R[v]);
  check('no verb draws two outlines, and no two verbs draw one', collide.length === 0, JSON.stringify(Object.fromEntries(Object.entries(byVerb).map(([k, v]) => [k, [...v]]))));
  // FLIP a tile's verb in its drawer and read the shape back off the strip.
  // This is the section's whole point: the radius must follow the model, and
  // the `html body .palette .tile` rule three classes deep must not win.
  const m1 = await rig.evaluate(() => { const H = window.__ba; const out = {};
    H.openDrawer('pen');
    out.before = { verb: H.verbs()[2], r: H.radiusAt(3) };
    H.setVerb(3, 'toggle');
    out.toggled = { verb: H.verbs()[2], r: H.radiusAt(3) };
    H.setVerb(3, 'momentary');
    out.back = { verb: H.verbs()[2], r: H.radiusAt(3) };
    return out; });
  check('pen starts momentary and draws the plate', m1.before.verb === 'momentary' && m1.before.r === R.momentary, JSON.stringify(m1.before));
  check('flipped to toggle in its drawer, the STRIP draws the asymmetric plate', m1.toggled.verb === 'toggle' && m1.toggled.r === R.toggle, JSON.stringify(m1.toggled));
  check('flipped back, the plate returns', m1.back.verb === 'momentary' && m1.back.r === R.momentary, JSON.stringify(m1.back));
  // PIN is the kind with all three, so it is the one tile that can prove the
  // whole set on its own — and the same tool twice in two verbs (§ 4) is how
  // pin ends up on the strip twice.
  const m2 = await rig.evaluate(() => { const H = window.__ba; const out = {};
    H.T.placeTile('pin', undefined, 'toggle');
    out.twice = { ids: H.pal().filter(x => x === 'pin').length, verbs: H.verbs().slice(-2) };
    out.radii = H.radii().slice(-2);
    H.openDrawer('pin'); out.segs = H.verbSeg();
    const n = H.pal().length;
    H.setVerb(n, 'momentary'); out.mom = { verb: H.verbs()[n - 1], r: H.radiusAt(n) };
    H.T.removeAt(n - 1);
    return out; });
  check('the same tool sits on the strip TWICE in two verbs, drawing two shapes', m2.twice.ids === 2 && m2.twice.verbs.join() === 'bang,toggle' && m2.radii.join() === `${R.bang},${R.toggle}`, JSON.stringify(m2));
  check('pin\'s drawer offers all three verbs, one segment group per position', m2.segs.filter(x => x.pos !== null).length >= 3 && ['bang', 'momentary', 'toggle'].every(v => m2.segs.some(x => x.v === v)), JSON.stringify(m2.segs.map(x => x.v)));
  check('… and the third verb draws the third shape', m2.mom.verb === 'momentary' && m2.mom.r === R.momentary, JSON.stringify(m2.mom));
  await rig.evaluate(() => window.__ba.factory());
  }

  // ── N. THE LEGEND IS THE TRUTH (§ 6 and § 7, "new J" there) ──────────────
  // The rendered legend equals source + GESTURE_LABEL + delay for every bound
  // input; the gesture suffix is blank iff the gesture is `press`; and `···`
  // appears iff a sibling ×2 or ×3 actually delays that tap.
  if (want('N')) {
  console.log('\n§ N the legend is the truth');
  await rig.evaluate(() => window.__ba.factory());
  // The factory map IS the case § 7 is about: pin is button 3 tap and unpin
  // is button 3 ×2, so pinning with your thumb waits the double window.
  const n0 = await rig.evaluate(() => { const H = window.__ba;
    return { leg7: H.legAt(7), leg6: H.legAt(6), leg2: H.legAt(2), leg4: H.legAt(4),
             binds7: H.S._bindingsOf('palette_7', 'Digit7'), binds2: H.S._bindingsOf('palette_2', 'Digit2') }; });
  check('a tile carries EVERY input bound to it — pin wears its digit and button 3', n0.leg7.parts.length === 2 && n0.leg7.parts.map(p => p.kind).join() === 'key,button', JSON.stringify(n0.leg7.parts));
  check('the legend equals source + gesture for every bound input', n0.leg7.parts.every((p, i) => p.src === n0.binds7[i].label && p.g === ({ press: '', tap: 'tap', long: 'long', xlong: 'xlong', double: '×2', triple: '×3' })[n0.binds7[i].g]), JSON.stringify({ parts: n0.leg7.parts, binds: n0.binds7 }));
  check('BLANK MEANS PRESS — the factory digit carries no gesture word', n0.leg7.parts[0].g === '' && n0.binds7[0].g === 'press', JSON.stringify(n0.leg7.parts[0]));
  check('… and a tile with only its digit is just the digit', n0.leg4.parts.length === 1 && n0.leg4.parts[0].g === '' && !n0.leg4.parts[0].delay, JSON.stringify(n0.leg4));
  // § 7, drawn: the delay mark is on the tile that is SLOWED, and only there.
  check('the DELAY MARK is on pin\'s button 3 tap — the factory trap, drawn', n0.leg7.parts[1].g === 'tap' && n0.leg7.parts[1].delay === true, JSON.stringify(n0.leg7.parts[1]));
  check('… and NOT on unpin\'s ×2 on the same button: a ×2 is not itself delayed', n0.leg6.parts.some(p => p.g === '×2') && !n0.leg6.parts.some(p => p.delay), JSON.stringify(n0.leg6.parts));
  check('… and not on button 1\'s tap, which has no ×2 sibling', n0.leg2.parts.some(p => p.kind === 'button' && p.g === 'tap') && !n0.leg2.parts.some(p => p.delay), JSON.stringify(n0.leg2.parts));
  // Force the delay on and off and read it back, rather than trusting the
  // factory map to stay as it is.
  const n1 = await rig.evaluate(() => { const H = window.__ba; const bm = {}; const out = {};
    // button 1 has a tap (position 2) and no ×2: bind one and the tap slows.
    H.S._keyMappings.__probe = undefined; delete H.S._keyMappings.__probe;
    const before = H.legAt(2).parts.find(p => p.kind === 'button');
    out.before = { g: before.g, delay: before.delay };
    H.S._buttonBindings();            // touch, so the map exists
    return out; });
  check('before: button 1 tap on position 2 is not delayed', n1.before.g === 'tap' && n1.before.delay === false, JSON.stringify(n1.before));
  const n2 = await rig.evaluate(async () => { const H = window.__ba;
    // Bind a ×2 on button 1 through the real learn path, then read the tile.
    const km = H.S._keyMappings;
    H.S._dispatchGesture; // no-op reference
    // Use the MIDI map, which is writable from here, on the same SOURCE kind
    // the tile reports: a note. Bind position 5 to note 70 tap, and position
    // 4 to note 70 ×2 — the same trap, on a different input.
    const mm = JSON.parse(localStorage.getItem('mubone_midi_map') || '{}');
    mm.palette_5 = { type: 'note', channel: 1, number: 70, g: 'tap' };
    localStorage.setItem('mubone_midi_map', JSON.stringify(mm));
    return true; });
  await rig.reload(); await installHelpers(rig);
  const n3 = await rig.evaluate(() => { const H = window.__ba; return { leg5: H.legAt(5) }; });
  check('a MIDI note reads the same six gestures — note 70 tap, no sibling, no delay',
        n3.leg5.parts.some(p => p.kind === 'midi' && p.g === 'tap' && !p.delay), JSON.stringify(n3.leg5.parts));
  await rig.evaluate(() => { const mm = JSON.parse(localStorage.getItem('mubone_midi_map') || '{}');
    mm.palette_4 = { type: 'note', channel: 1, number: 70, g: 'double' };
    localStorage.setItem('mubone_midi_map', JSON.stringify(mm)); return true; });
  await rig.reload(); await installHelpers(rig);
  const n4 = await rig.evaluate(() => { const H = window.__ba; return { leg5: H.legAt(5), leg4: H.legAt(4) }; });
  check('bind a ×2 on the SAME note and the tap\'s tile grows the ··· — the delay is a sibling\'s doing',
        n4.leg5.parts.some(p => p.kind === 'midi' && p.g === 'tap' && p.delay === true), JSON.stringify(n4.leg5.parts));
  check('… and the ×2\'s own tile does not wear it', n4.leg4.parts.some(p => p.g === '×2') && !n4.leg4.parts.some(p => p.delay), JSON.stringify(n4.leg4.parts));
  await rig.evaluate(() => { localStorage.removeItem('mubone_midi_map'); return true; });
  await rig.reload(); await installHelpers(rig);
  // THE SPACEBAR IS DRAWN, NOT TYPED (§ 6): `␣` renders from a fallback face
  // at the wrong advance, so the tile draws a 15×6 stroke mark instead.
  const n5 = await rig.evaluate(() => { const H = window.__ba; const km = H.S._keyMappings;
    km.palette_3 = { type: 'key', key: ' ', code: 'Space', shift: false, ctrl: false, meta: false };
    H.S._bindingsChanged();
    const tile = H.tileAt(3);
    const svg = tile.querySelector('.tile-leg .leg-space');
    const out = { svg: !!svg, box: svg ? { w: svg.getBoundingClientRect().width, h: svg.getBoundingClientRect().height } : null,
                  glyph: /␣/.test(tile.querySelector('.tile-leg')?.textContent ?? ''), d: svg?.querySelector('path')?.getAttribute('d') ?? null };
    delete km.palette_3; H.S._bindingsChanged();
    return out; });
  check('a learned spacebar draws the stroke mark and never the ␣ glyph', n5.svg && !n5.glyph && n5.d === 'M2 2v5h20V2', JSON.stringify(n5));
  check('… at 15×6', n5.box && Math.abs(n5.box.w - 15) < 1 && Math.abs(n5.box.h - 6) < 1, JSON.stringify(n5.box));
  await rig.evaluate(() => window.__ba.factory());
  }
  console.log(`\n${pass} ok · ${fail} failed`);
  return fail;
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    const rig = await launch();
    let fails = 1;
    try { fails = await run(rig); }
    catch (e) { console.error('palette-audit crashed:', e); }
    finally { await rig.close(); }
    process.exit(fails ? 1 : 0);
  })();
}
