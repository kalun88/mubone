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
 *   · THE HAND (2026-09-12): a click on a tool — rail row or strip tile —
 *     takes it in hand; the SPACEBAR and a LEFT-CLICK on the sphere play it in
 *     the hand's one verb, drawn as the hand tile; `Tab` shows and hides the
 *     tool rail and never a drawer. Neither input can be learned. The strip is
 *     QUICK ACCESS: its keys are explicit rows that follow their tile, a drop
 *     deals the next free digit, and a legend row is a learn cell.
 * ARMING is deleted, and so is `sel`; `inHand` is not it — nothing on the
 * strip is armed, a tile fires in its own verb whatever is in hand.
 *
 *  A. Shape — the factory list wide · wash · overdub · line · pen · unpin ·
 *     pin on 1 … 5 · ↑ · ↓, NO tile wearing a box, no beds, no hairlines, no
 *     cap tile, the palette is NINE actions, the plate heads the bed (no badge).
 *  B. DELETED — "loading" was the rail click, which is a pick now (§ C).
 *  C. The drawer and the click — Tab shows and hides the tool rail and never
 *     opens a drawer; the drawer follows the hand and a fire does not move
 *     it; a rail click and a strip click take a tool in
 *     hand; the ⋯ points the drawer without touching the hand; a lens tile's
 *     click installs it; a pin tile's click fires it.
 *  D. Placing — drag a row in at the caret (it takes the next free digit),
 *     move a tile (carrying its verb AND its key), drag one off (freeing the
 *     digit), the pin pair from its rail, nine is full, EVERY tool may leave.
 *  E. The keys FIRE by position, in the tile's verb: explicit rows; a toggle
 *     outlives its key, a momentary ends on the up, a bang pins once; one
 *     play at a time; no hand-back; `sel` is gone.
 *  F. Lens and cap — a lens tile toggles; off, no lens is on and the cursor
 *     reads nothing; the rail agrees; S flips the same state.
 *  G. DELETED — it tested the armed box outranking the lit fill, and there is
 *     no armed box.
 *  H. THE HAND — space and the sphere's click play the in-hand tool, toggle
 *     by factory, momentary after a right-click on the plate, which changes
 *     the plate's shape; the plate is itself a spacebar; space cannot be
 *     learned and a stored Space row is dropped; a quick-access play is the
 *     tile's verb, flipped by the strip's right-click, momentary refused
 *     under a TAP; the eraser's GESTURE_LONG_MS erase-all survives.
 *  I. The pen ships wet; the wash brings its own sound.
 *  J. The wet button — grain rows only.
 *  K. The `+` on each engine title.
 *  L. Keys and notes through the button recogniser.
 *  M. SHAPE IS THE VERB — the computed radius per verb; flip a verb by the
 *     strip's right-click and read the shape back off the strip.
 *  N. THE LEGEND IS THE TRUTH — source + gesture + delay for every bound
 *     input, blank iff `press`, `···` iff a sibling ×2/×3 delays that tap;
 *     the plate draws the spacebar.
 *  N. THE STICKER IS THE TRUTH (§ 11.5–11.6) — one sticker per bound
 *     position of the one kind shown, none unbound; source + gesture (+ the
 *     delay mark), long/xlong a bar, a note bare; nowrap and flex-shrink 0;
 *     nothing the app can emit is wider than the tile; the hand tile's
 *     sticker draws the spacebar.
 *  O. THE STICKER IS THE LEARN CELL — one kind at a time, the bed 71px
 *     whatever the kind; click relearns, right-click clears, Esc cancels, a
 *     chord is refused.
 *  P. HUE IS IDENTITY (§ 11.2–11.3) — every glyph its family's --eng-*,
 *     the pin tiles bone, nothing --text-subtle, rest surface-1.
 *
 * PALETTE-GUI § 9 calls M and N "new I" and "new J"; both letters were already
 * taken by the wash and the wet button when it was written. Ek's rule 6 applies
 * to both: FORCE each state and read it back — an empty diff proves only that
 * nothing visible moved.
 *
 * Exits non-zero on failure.
 */

const { launch } = require('./lib/rig');
const gone_ok = p => p.gone.join() === 'pen,line,looper,overdub,scrape,pin' && p.back.join() === 'pen,line,looper,overdub,scrape,pin,unpin';
// THE FACTORY STRIP (Ek, 2026-09-12, evening): position · tile · verb · key.
//   1 dots (pen) momentary 1 long · 2 line toggle 1 · 3 loop (looper) toggle 2
//   4 dub (overdub) toggle 3 · 5 scrape top momentary 4 · 6 pin bang ↓ · 7 unpin bang ↑
// Key 1 carries two positions — line on the press, dots on the long — so a
// check that HOLDS a key past the long threshold uses 2 (loop), which has no
// long sibling: holding 1 aborts line's press and starts dots, by design.
// The keys are explicit rows in the key map (midi.js seedPaletteDigitsOnce)
// and FOLLOW THEIR TILE when the strip is rearranged; a drop takes the next
// free digit. The spacebar and the sphere's left-click are THE HAND's.
// Re-dealt 2026-09-12 night (Ek): dots · line · loop · dub · scrape top · pin ·
// unpin on 1 long · 1 · 2 · 3 · 4 · ↓ · ↑, the hand dots momentary. The
// position-keyed checks below (§§ A, C, D, E, H, L, M, N, O) still name the
// afternoon's positions and need re-keying on the finish pass — unrun.
const FACTORY = 'pen,line,looper,overdub,scrape,pin,unpin';
const FACTORY_VERBS = 'momentary,toggle,toggle,toggle,momentary,bang,bang';

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
      // THE STICKER (PALETTE-GUI § 11.5): one per bound position, of the one
      // kind the keys page shows; its text, its parts, and its computed
      // white-space / flex-shrink — § 11.6's trap — and its width.
      legAt(n) {
        const e = this.tileAt(n); if (!e) return null;
        const st = e.querySelector('.tile-bind'); if (!st) return { text: '', parts: [], sticker: null };
        const cs = getComputedStyle(st), r = st.getBoundingClientRect();
        return { text: st.textContent, sticker: { w: +r.width.toFixed(1), h: +r.height.toFixed(1), ws: cs.whiteSpace, shrink: cs.flexShrink, r: cs.borderRadius, kind: [...st.classList].find(c => c.startsWith('tile-bind--'))?.slice(11) ?? null, learning: st.classList.contains('learning') },
          parts: [...st.querySelectorAll('.leg')].map(x => ({
            kind: [...x.classList].find(c => c.startsWith('leg--'))?.slice(5) ?? null,
            src: x.querySelector('.leg-space') ? '␣' : (x.firstChild?.nodeType === 3 ? x.firstChild.textContent : ''),
            g: x.querySelector('.leg-g--bar') ? (x.querySelector('.leg-g--xlong') ? 'xlong-bar' : 'long-bar') : (x.querySelector('.leg-g')?.textContent ?? ''),
            delay: !!x.querySelector('.leg-d'),
          })) };
      },
      // Which kind the strip shows: the keys page's switches, first on wins.
      showKind(k) { for (const x of ['key', 'button', 'midi']) S._setLegendShown(x, x === k); },
      // The verb of a POSITION: set through the model (what the strip's
      // right-click calls), and the right-click itself, which cycles.
      setVerb(n, v) { return T.setVerbAt(n - 1, v); },
      rightClick(n) { const t = this.tileAt(n); if (!t) return false; t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })); return true; },
      // THE HAND (2026-09-12): the tool in hand, its verb, and the spacebar
      // plate under the strip as drawn.
      hand: () => T.inHandId(),
      handVerb: () => T.handVerbOf(),
      plate() { const e = q('#handKey'); if (!e) return null;
        return { tool: e.dataset.hand, verb: e.dataset.verb, name: e.querySelector('.tile-nm')?.textContent ?? null, r: getComputedStyle(e).borderRadius,
                 lit: e.classList.contains('playing'), w: e.getBoundingClientRect().width, tileW: q('#paletteBed .tile[data-pal]')?.getBoundingClientRect().width ?? null,
                 space: !!e.querySelector('.tile-binds .leg-space'), mouse: [...e.querySelectorAll('.tile-binds .tile-bind')].some(c => c.textContent.trim() === 'click') }; },
      plateRightClick() { const e = q('#handKey'); if (!e) return false; e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })); return true; },
      inHandMarks: () => qa('#toolRail .trow.in-hand').map(e => e.dataset.tile),
      // The two reserved inputs, both edges.
      space(type = 'keydown') { this.key('Space', type); },
      sphere(type = 'mousedown') { (type === 'mousedown' ? S.canvas : window).dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, cancelable: true })); },
      // A LEGEND ROW under tile n, of one kind — the learn cell on the tile.
      legRow: (n, kind) => qa('#paletteDock .tile[data-pal]')[n - 1]?.querySelector(`.tile-bind[data-learn-kind="${kind}"]`) ?? null,
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
        const want = [['pen', 'momentary'], ['line', 'toggle'], ['looper', 'toggle'], ['overdub', 'toggle'], ['scrape', 'momentary'], ['pin', 'bang'], ['unpin', 'bang']];
        while (this.pal().length) T.removeAt(0);
        // Rebuilding by removeAt/placeTile frees and re-deals the digits in
        // order — the factory keys are 1 … 5 on the five, and the arrows are
        // the pins' — so the key map is put back to the factory set too.
        const km = S._keyMappings; for (const k of Object.keys(km)) if (/^palette_/.test(k)) delete km[k];
        for (const [id, v] of want) T.placeTile(id, undefined, v);
        // The factory keys BY TILE: placeTile dealt 1 … 5 by position; dots takes 1 LONG and line 1.
        km.palette_1 = { type: 'key', key: '1', code: 'Digit1', shift: false, ctrl: false, meta: false, g: 'long' };
        km.palette_2 = { type: 'key', key: '1', code: 'Digit1', shift: false, ctrl: false, meta: false, g: 'press' };
        km.palette_3 = { type: 'key', key: '2', code: 'Digit2', shift: false, ctrl: false, meta: false, g: 'press' };
        km.palette_4 = { type: 'key', key: '3', code: 'Digit3', shift: false, ctrl: false, meta: false, g: 'press' };
        km.palette_5 = { type: 'key', key: '4', code: 'Digit4', shift: false, ctrl: false, meta: false, g: 'press' };
        km.palette_6 = { type: 'key', key: '↓', code: 'ArrowDown', shift: false, ctrl: false, meta: false, g: 'press' };
        km.palette_7 = { type: 'key', key: '↑', code: 'ArrowUp', shift: false, ctrl: false, meta: false, g: 'press' };
        // A removed tile takes its BUTTONS and NOTES with it too, so the
        // factory button map (midi.js BUTTON_DEFAULTS, the palette rows) is
        // put back by hand.
        const bm = S._buttonMappings; for (const k of Object.keys(bm)) if (/^palette_/.test(k)) delete bm[k];
        Object.assign(bm, { palette_2: { btn: 1, g: 'tap' }, palette_1: { btn: 1, g: 'long' }, palette_6: { btn: 3, g: 'press' }, palette_7: { btn: 3, g: 'double' } });
        S._bindingsChanged();
        this.lensOn();
        T.setHandVerb('momentary');
        T.pickHand('pen');            // the boot hand: dots, momentary
      },
      // What the DRAWER is pointed at. This was `armed` until 2026-09-11 —
      // the same tile then, because the sheet followed the hand.
      picked: () => T.selectedTile()?.id ?? null,
      // Open a tool's drawer without firing anything: the ⋯ is the one
      // gesture that points the drawer and does not fire (§ 5.3).
      openDrawer(id) {
        const m = this.row(id)?.querySelector('[data-more]');
        if (m) { m.click(); return true; }
        // pin and unpin have no rail row; their sheet is the head alone.
        if (!this.pal().includes(id)) return false;
        T.openProps(id, 'tool');
        return this.drawer();
      },
      // Fire a POSITION the way the wire does, both edges.
      fire(n, down = true) { S._paletteFire(n - 1, down); },
      // A CLICK on a strip tile (2026-09-12: a click picks a tool into the
      // hand, installs a lens, fires a pin — never plays a tool).
      clickTile(n) { const t = this.tileAt(n); if (!t) return false; t.click(); return true; },
      clickLens(id) { const t = q(`#paletteDock .tile--lens[data-lens="${id}"]`); if (!t) return false; t.click(); return true; },
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
        const key = code === 'Space' ? ' ' : code === 'ArrowUp' ? '↑' : code === 'ArrowDown' ? '↓' : code.replace(/^Key|^Digit/, '');
        document.body.dispatchEvent(new KeyboardEvent(type, { code, key, shiftKey: shift, bubbles: true, cancelable: true }));
      },
      brushKey: () => B.currentBrush()?.key ?? null,
      lit: id => qa(`#paletteDock [data-tile="${id}"].playing`).length,
      fill: id => { const el = q(`#paletteDock [data-tile="${id}"]`); return el ? getComputedStyle(el).backgroundColor : null; },
      tap(code) { this.key(code); this.key(code, 'keyup'); },
      state() { return { pal: this.pal(), slots: this.slots(), picked: this.picked(), hand: this.hand(), drawer: this.drawer(), rail: this.rail(),
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
  await rig.waitForApp();
  // THE STRIP'S GEOMETRY COMES FROM ITS TOKENS, not from numbers written here.
  // `--pal-gap` and `--pal-pad` moved on 2026-09-13 (7 → 11, 8 → 13, Ek asking
  // for breathing room) and five checks failed on constants that had been
  // copied out of the CSS — 71px beds and a 7px gap. What they are actually
  // asserting is a RELATION: the bed is pad + border + tile + pad + border, the
  // hand is three tiles and two gaps, the head sits one gap off the strip. Read
  // the tokens and the relations hold at any spacing; a broken layout still
  // fails, which a hardcoded 71 could only do by accident.
  const PAL = await rig.evaluate(() => {
    const el = document.querySelector('.palette');
    const cs = getComputedStyle(el);
    const num = v => parseFloat(cs.getPropertyValue(v)) || 0;
    const tile = num('--pal-tile'), pad = num('--pal-pad'), gap = num('--pal-gap');
    const border = parseFloat(cs.borderTopWidth) || 0;
    return { tile, pad, gap, border, bed: pad * 2 + border * 2 + tile };
  });
  console.log(`       strip tokens: tile ${PAL.tile} · gap ${PAL.gap} · pad ${PAL.pad} · border ${PAL.border} → bed ${PAL.bed}`);

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
             nTiles: document.querySelectorAll('#paletteDock .tile[data-pal]').length,
             lenses: document.querySelectorAll('#paletteDock .tile--lens').length,
             lens: H.lensT(), cap: H.capT(),
             seps: document.querySelectorAll('#paletteDock .palette-sep, #paletteDock .palette-lens, #paletteDock .palette-slots, #paletteDock .palette-acts').length,
             acts: document.querySelectorAll('#paletteDock .tile--act').length,
             actIds: [...document.querySelectorAll('#paletteDock .tile--act')].map(e => e.dataset.act),
             actArmed: document.querySelectorAll('#paletteDock .tile--act.armed, #paletteDock .tile--act.playing').length,
             railBoxed: document.querySelectorAll('#toolRail .trow.armed').length,
             pinLast: [...document.querySelectorAll('#paletteBed .tile[data-pal]')].pop()?.dataset.pal === 'unpin',
             // The HAND TILE heads the row (night): first child, a tile's box,
             // on the tile row's line, one extra gap (10px) off the first
             // quick-access tile, with the spacebar and the mouse as caps under
             // it; no badge anywhere.
             head: (() => { const bed = document.getElementById('paletteBed'), p = bed?.firstElementChild, t1 = bed?.querySelector('.tile[data-pal]');
               const bb = bed?.getBoundingClientRect(), pb = p?.getBoundingClientRect(), tb = t1?.getBoundingClientRect();
               const caps = p ? [...p.querySelectorAll('.tile-binds .tile-bind')].map(c => ({ w: +c.getBoundingClientRect().width.toFixed(1), h: +c.getBoundingClientRect().height.toFixed(1), r: getComputedStyle(c).borderRadius, space: !!c.querySelector('.leg-space'), click: c.textContent.trim() === 'click' })) : [];
               return { isHand: p?.id === 'handKey' && p.classList.contains('tile'), badge: !!document.querySelector('.palette-badge'),
                        inside: !!(pb && bb) && pb.top >= bb.top && pb.bottom <= bb.bottom && pb.left >= bb.left,
                        sameBox: !!(pb && tb) && Math.abs(pb.height - tb.height) < 0.5 && Math.abs(pb.top - tb.top) < 0.5,
                         headW: pb ? +pb.width.toFixed(1) : null, tileW: tb ? +tb.width.toFixed(1) : null,
                        gap: pb && tb ? +(tb.left - pb.right).toFixed(1) : null,
                        caps, notPos: !p?.dataset.pos && !p?.dataset.pal && p?.getAttribute('draggable') !== 'true' }; })(),
             draggable: [...document.querySelectorAll('#paletteDock .tile[data-pal]')].map(e => e.getAttribute('draggable')),
             legends: [...document.querySelectorAll('#paletteDock .tile[data-pal]')].map(e => e.querySelector('.tile-bind')?.textContent ?? null),
             nums: document.querySelectorAll('#paletteDock .pal-num').length,
             cycleKey: localStorage.getItem('mubone_cycle_off'), slotsKey: localStorage.getItem('mubone_slots'),
             nActions: window.__ba.S._actions.filter(x => /^palette_[1-9](_toggle|_hold)?$/.test(x.id)).length };
  });
  check('a fresh palette is dots · line · loop · dub · scrape top · pin · unpin', a.pal.join() === FACTORY, a.pal.join());
  check('seven tiles, no beds and no hairlines — one row, as wide as the list', a.nTiles === 7 && a.seps === 0, `${a.nTiles} tiles, ${a.seps} beds/seps`);
  check('the pin pair is two action tiles, pin then unpin, unpin farthest right, never armed', a.acts === 2 && a.actIds.join() === 'commit_drop,commit_release' && a.actArmed === 0 && a.pinLast, `${a.actIds.join()} armed ${a.actArmed} last ${a.pinLast}`);
  check('no lens on the strip; wide installed and on in the rail; no cap tile and no cap row (the cap is no lens on)', a.lenses === 0 && !a.lens.onPalette && a.lens.inst === 'wide' && a.lens.rowOn && !a.cap.tile && !a.cap.row && !a.cap.muted, JSON.stringify({ lens: a.lens, cap: a.cap }));
  check('the HAND TILE heads the row: first child, three tiles wide on the tiles\' line, the row\'s own gap off the first quick-access tile; no badge; not a position, not draggable', a.head.isHand && !a.head.badge && a.head.inside && a.head.sameBox && Math.abs(a.head.headW - (3 * a.head.tileW + 2 * PAL.gap)) < 0.5 && Math.abs(a.head.gap - PAL.gap) < 0.5 && a.head.notPos, JSON.stringify({ ...a.head, caps: undefined }));
  check('… and on its bottom-left corner, two 18px stickers: the drawn spacebar and the word CLICK', a.head.caps.length === 2 && a.head.caps[0].space && a.head.caps[0].r === '999px' && a.head.caps[0].w > 20 && a.head.caps[1].click && a.head.caps[1].r === '999px' && a.head.caps.every(c => Math.abs(c.h - 18) < 0.5), JSON.stringify(a.head.caps));
  check('the tools on it are dots · line · loop · dub · scrape top', a.slots.join() === 'pen,line,looper,overdub,scrape', a.slots.join());
  // NOTHING is armed (2026-09-11). No tile and no rail row may wear the box,
  // on the palette or in the library: the idle mark is deleted, so a stray
  // `.armed` is the old model growing back. The HAND (2026-09-12) is not it:
  // its mark is the plate under the strip and a one-hairline ring (§ O).
  check('no tile and no row wears a box — nothing is armed', a.boxed.length === 0 && a.railBoxed === 0, JSON.stringify({ boxed: a.boxed, rail: a.railBoxed }));
  check('the lens tile is never armed', !a.lens.armed);
  check('every palette tile is draggable (Procreate: move it, or drag it off)', a.draggable.every(d => d === 'true'), JSON.stringify(a.draggable));
  // Each tile wears what FIRES it, not a position number: the factory keys
  // 1 … 5 and the arrows, seeded as explicit rows, plus any button or note
  // bound to that position (drawn only when its switch is on — § N) and the
  // delay mark.
  check('each tile wears the key that fires it — 1 (held), 1, 2, 3, 4, ↓, ↑ — and no position number is drawn',
        a.legends.join() === '1,1,2,3,4,↓,↑' && a.nums === 0, `${a.legends.join(' | ')} nums ${a.nums}`);
  check('the cycle and the slots are gone from storage; the palette is NINE actions, one per position', a.cycleKey === null && a.slotsKey === null && a.nActions === 9, JSON.stringify({ cyc: a.cycleKey, slots: a.slotsKey, n: a.nActions }));
  check('nothing is open and nothing is playing at boot', !a.drawer && !a.active, JSON.stringify({ drawer: a.drawer, active: a.active }));
  // THE HAND holds the first tool at boot, and the plate under the strip
  // names it.
  const aH = await rig.evaluate(() => { const H = window.__ba; return { hand: H.hand(), plate: H.plate(), marks: H.inHandMarks(), stripRing: document.querySelectorAll('#paletteDock .tile.in-hand').length, verb: H.handVerb() }; });
  check('the hand holds dots at boot, and the hand tile names it in words', aH.hand === 'pen' && aH.plate?.tool === 'pen' && aH.plate?.name === 'dots', JSON.stringify(aH));
  check('the hand tile is three tiles wide and carries the drawn spacebar and a mouse under it', aH.plate && Math.abs(aH.plate.w - (3 * aH.plate.tileW + 2 * PAL.gap)) < 0.5 && aH.plate.space && aH.plate.mouse, JSON.stringify(aH.plate));
  check('the hand ships MOMENTARY, and the hand tile draws the rounded plate', aH.verb === 'momentary' && aH.plate?.verb === 'momentary' && aH.plate?.r === '10px', JSON.stringify({ verb: aH.verb, r: aH.plate?.r }));
  check('the in-hand tool is marked on its rail row, and nowhere on the strip', aH.marks.join() === 'pen' && aH.stripRing === 0, JSON.stringify(aH));
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
  // ── C. The drawer, and the click ──────────────────────────────────────────
  }
  if (want('C')) {
  console.log('\n§ C the drawer follows the hand; a click takes a tool in hand');
  await rig.evaluate(() => { const H = window.__ba; H.factory(); H.T.closeProps(); H.T.setPropsOpen(false); });
  // TAB SHOWS AND HIDES THE TOOL RAIL, never a drawer (Ek, 2026-09-12, night).
  // ⇧TAB IS THE PINNED RAIL'S (Ek, 2026-09-12: "shift tab to open and close the pin").
  const cT = await rig.evaluate(() => { const H = window.__ba; const pinned = () => document.body.classList.contains('pinned-open');
    H.key('Tab'); const a = H.state(); H.key('Tab'); const b = H.state();
    const p0 = pinned(); H.key('Tab', 'keydown', true); const c = { ...H.state(), pinned: pinned() }; H.key('Tab', 'keydown', true); const p2 = pinned();
    return { a, b, c, p0, p2 }; });
  check('Tab shows the tool rail and opens no drawer; Tab again hides it', cT.a.rail && !cT.a.drawer && !cT.b.rail, JSON.stringify({ a: cT.a, b: cT.b }));
  check('⇧Tab flips the PINNED rail and leaves the tool rail and the drawer alone', cT.c.pinned === !cT.p0 && cT.p2 === cT.p0 && !cT.c.rail && !cT.c.drawer, JSON.stringify({ p0: cT.p0, c: cT.c, p2: cT.p2 }));
  // THE DRAWER FOLLOWS THE HAND, and a quick-access fire moves nothing — it
  // followed the last tile fired for one day, and a key pulling the drawer
  // off the tool you are working on was wrong.
  const c1 = await rig.evaluate(() => { const H = window.__ba; H.openDrawer('pen'); return H.state(); });
  check('the ⋯ opens the drawer of the tool in hand', c1.drawer && c1.head === 'dots' && c1.hand === 'pen', `drawer ${c1.drawer} head ${c1.head} hand ${c1.hand}`);
  // Paced: `startPaintStroke` is async (it waits on the mic, which the rig
  // has none of), so a stop in the same synchronous block as the start
  // leaves `S.isPainting` true for ever — and a stuck isPainting turns every
  // later pin into a live hold (§ E says the same). Real race, audio path.
  const c1b = await rig.evaluate(() => { const H = window.__ba; H.fire(2, true); return { ...H.state() }; });
  await rig.evaluate(async () => { await new Promise(r => setTimeout(r, 260)); window.__ba.fire(2, true); await new Promise(r => setTimeout(r, 260)); return true; });
  check('… firing a position from its key does NOT move it', c1b.drawer && c1b.head === 'dots' && c1b.hand === 'pen' && c1b.active, `head ${c1b.head} hand ${c1b.hand} active ${c1b.active}`);
  const c2 = await rig.evaluate(() => { const H = window.__ba; H.openDrawer('pen'); return H.state(); });
  check('the ⋯ again shuts it', !c2.drawer && c2.rail, `drawer ${c2.drawer} rail ${c2.rail}`);
  // A RAIL CLICK takes the tool in hand: plays nothing, places nothing, and
  // an open drawer follows the pick (Photoshop's options bar).
  const c4 = await rig.evaluate(() => { const H = window.__ba; const before = { ...H.state(), pal: H.pal() };
    H.row('staff').click();
    return { before, after: { ...H.state(), pal: H.pal(), plate: H.plate(), marks: H.inHandMarks() } }; });
  check('a rail row CLICK takes that tool in hand — plays nothing, places nothing, opens nothing',
        c4.after.hand === 'staff' && c4.after.pal.join() === c4.before.pal.join() && !c4.after.active && !c4.after.drawer, JSON.stringify({ hand: c4.after.hand, pal: c4.after.pal, active: c4.after.active }));
  check('… the hand tile shows it and its row wears the mark (it is not on the strip)', c4.after.plate?.tool === 'staff' && c4.after.marks.join() === 'staff', JSON.stringify({ plate: c4.after.plate?.tool, marks: c4.after.marks }));
  const c4b = await rig.evaluate(() => { const H = window.__ba; H.openDrawer('staff'); const a = H.state(); H.row('comb').click(); const b = H.state(); H.T.closeProps(); return { a, b }; });
  check('with the drawer open, a rail click moves the drawer to the tool it took in hand', c4b.a.drawer && c4b.a.head === 'staff' && c4b.b.drawer && c4b.b.head === 'comb' && c4b.b.hand === 'comb', JSON.stringify({ a: c4b.a.head, b: c4b.b.head }));
  // THE ⋯ opens the drawer WITHOUT changing the hand: it is the one gesture
  // that points the drawer and picks nothing.
  const c3 = await rig.evaluate(() => { const H = window.__ba; H.openDrawer('pen'); return H.state(); });
  check('the ⋯ on a rail row opens THAT tool\'s drawer, fires nothing and leaves the hand where it was', c3.drawer && c3.head === 'dots' && !c3.active && c3.hand === 'comb', `drawer ${c3.drawer} head ${c3.head} hand ${c3.hand}`);
  const c3b = await rig.evaluate(() => { const H = window.__ba; const tab = (H.key('Tab'), H.state()); H.key('Tab'); const shut = (H.T.closeProps(), H.state());
    return { tab, shut, moreEverywhere: H.rows().every(id => !!H.row(id).querySelector('[data-more]')) }; });
  check('every tool row carries the ⋯; Tab over an open drawer only hides the rail (and the drawer with it), never moves it', c3b.moreEverywhere && !c3b.tab.rail && !c3b.tab.drawer && !c3b.shut.drawer, JSON.stringify({ tab: c3b.tab, shut: c3b.shut.drawer }));
  const c3c = await rig.evaluate(() => { const H = window.__ba; H.openDrawer('spray'); const a = H.state();
    H.openDrawer('comb'); const b = { ...H.state(), openRow: document.querySelector('#toolRail .trow.open')?.dataset.tile }; return { a, b }; });
  check('the ⋯ moves the open drawer to another row', c3c.a.head === 'spray' && c3c.b.drawer && c3c.b.head === 'comb' && c3c.b.openRow === 'comb', JSON.stringify(c3c));
  await rig.evaluate(() => { const H = window.__ba; H.T.closeProps(); });
  const c6 = await rig.evaluate(() => { const H = window.__ba; H.lensRow('wide').querySelector('[data-more]').click(); return { ...H.state(), lensOpen: !!document.querySelector('#toolRail .trow--lens.open') }; });
  check('the ⋯ on the lens row opens the lens\'s drawer', c6.drawer && c6.lensOpen, `drawer ${c6.drawer}`);
  const c7 = await rig.evaluate(() => { const H = window.__ba; H.openDrawer('comb'); return H.state(); });
  check('the ⋯ on a tool row from the lens page brings that tool\'s page, not darkness', c7.drawer && c7.head === 'comb', `head ${c7.head}`);
  await rig.evaluate(() => window.__ba.T.closeProps());
  // A CLICK ON A STRIP TOOL TILE takes it in hand too — the strip is a
  // reduction of the rail and the click means the same thing. It plays
  // nothing: a momentary tile clicked does not sound.
  const c8 = await rig.evaluate(() => { const H = window.__ba; H.clickTile(1); return { ...H.state(), lit: H.lit('pen'), marks: H.inHandMarks(), stripRing: document.querySelectorAll('#paletteDock .tile.in-hand').length, plate: H.plate()?.tool }; });
  check('a click on the dots tile takes dots in hand, plays nothing, opens nothing', c8.hand === 'pen' && !c8.active && c8.lit === 0 && !c8.drawer && c8.plate === 'pen', JSON.stringify({ hand: c8.hand, active: c8.active, drawer: c8.drawer }));
  check('… its row wears the mark; the strip tile wears none (the hand tile says it)', c8.marks.join() === 'pen' && c8.stripRing === 0, JSON.stringify(c8.marks));
  // A LENS tile is a choice: the click installs it or turns it off.
  // No lens is on the factory strip: wide is placed for the check and taken off after.
  const c10 = await rig.evaluate(() => { const H = window.__ba; H.T.placeTile('wide', undefined, 'toggle'); H.lensOn();
    H.clickLens('wide'); const a = { drawer: H.drawer(), muted: !!H.S.scanMuted, hand: H.hand() };
    H.clickLens('wide'); const b = { drawer: H.drawer(), muted: !!H.S.scanMuted, hand: H.hand() }; H.T.removeFromPalette('wide'); return { a, b }; });
  check('a click on the lens tile turns it off and on, opens nothing and leaves the hand alone', !c10.a.drawer && c10.a.muted && !c10.b.drawer && !c10.b.muted && c10.a.hand === 'pen' && c10.b.hand === 'pen', JSON.stringify(c10));
  // A PIN tile is an act: the click fires it, in its verb.
  const c11 = await rig.evaluate(async () => { const H = window.__ba; const wait = ms => new Promise(r => setTimeout(r, ms));
    const UP = await import('./js/ui-presets.js'); H.S.commitSlotCount = Math.max(8, H.S.commitSlotCount | 0);
    H.S._gestureEnd?.(); UP.clearAllCommits(); await wait(400);
    const n0 = H.S.commitSlots.filter(Boolean).length;
    H.clickTile(6); await wait(1200);
    const n1 = H.S.commitSlots.filter(Boolean).length;
    UP.clearAllCommits(); await wait(300);
    return { n0, n1, painting: !!H.S.isPainting, hand: H.hand(), active: !!H.S._gestureActive() }; });
  check('a click on the pin tile pins once and leaves the hand alone', c11.n1 === c11.n0 + 1 && c11.hand === 'pen' && !c11.active, JSON.stringify(c11));
  await rig.evaluate(() => window.__ba.factory());

  // ── D. Placing — the palette is built by dragging (Ek, 2026-09-11) ────────
  }
  if (want('D')) {
  console.log('\n§ D placing');
  // Run beside the cc suites the pool has been swept to a small
  // `commitSlotCount`; a pin that finds no slot pins nothing and the counts
  // below read as unchanged. Restore the count first (as § D's own p4b does).
  // rig-audit runs every suite in ONE instance: the cc suites leave the pin
  // pool swept small and FULL, so a pin here found no slot and the counts
  // read unchanged (2026-09-12, twice). Free the pool and restore its size,
  // as § D's own p4b does, before a pin is counted.
  // A loop leaves by S.loopReleaseMode — the cc sweep can leave it on
  // play-to-end, or the fade time long, and the slots stay busy through a
  // clear; a pin then finds no slot. Make the leave quick, and WAIT for it.
  await rig.evaluate(async () => { const H = window.__ba; H.factory(); const UP = await import('./js/ui-presets.js');
    H.S.commitSlotCount = Math.max(8, H.S.commitSlotCount | 0); H.S.loopReleaseMode = 'fade'; H.S.loopFadeTimeMs = 30; H.S.commitRelease = 0;
    UP.clearAllCommits(); for (let w = 0; w < 120 && H.S.commitSlots.some(Boolean); w++) await new Promise(r => setTimeout(r, 25)); });
  const d0 = await st();
  check('setup: the factory seven', d0.pal.length === 7, d0.pal.join());
  // A rail row onto the strip's end: it lands last, keyed by its position,
  // stored, and the drawer's pick does not move — placing is not picking.
  const p1 = await rig.evaluate(() => { const H = window.__ba; H.drag(H.row('spray'), H.xEnd()); return { ...H.state(), stored: H.stored(), leg: H.legAt(8)?.text ?? null, verb: H.verbs()[7], row: H.S._paletteRow(8) }; });
  check('dragging spray from the rail onto the end places it at 8', p1.pal[7] === 'spray' && p1.pal.length === 8, p1.pal.join());
  // THE VERB IS SET AT THE DROP, from § 4's defaults: a brush lands momentary.
  // THE KEY IS DEALT AT THE DROP (Ek, 2026-09-12): the next free digit — 1 … 4
  // are the factory five's (dots and line share 1), so spray takes 5.
  check('… stored as an ENTRY with its kind\'s default verb, dealt the next free digit (5), and the keys page row says so',
        p1.stored?.[7]?.id === 'spray' && p1.stored?.[7]?.verb === 'momentary' && p1.verb === 'momentary' && p1.leg === '5' && p1.row.pos === 8 && p1.row.label === 'spray · play (momentary)' && p1.row.glyph,
        JSON.stringify({ stored: p1.stored?.[7], leg: p1.leg, row: p1.row.label }));
  // The same tile onto the strip's head: it moves, and ITS KEY MOVES WITH IT
  // (Ek: "once the key is bound to that palette tile it should stay with the
  // tile even if i move it"). 6 still plays spray at position 1; wide keeps 1
  // at position 2. A MOVE carries the entry's verb with it; only a fresh
  // PLACE takes a default.
  const p2 = await rig.evaluate(() => { const H = window.__ba; H.drag(H.tileAt(8), H.xBefore(1));
    H.key('Digit5'); const play = { active: H.S._gestureActive(), lit: H.lit('spray'), bkey: H.brushKey() };
    H.key('Digit5', 'keyup');
    return { ...H.state(), play, verb1: H.verbs()[0], legs: [1, 2].map(n => H.legAt(n)?.text ?? null), row2: H.S._paletteRow(2).label }; });
  check('dragging spray before dots moves it to 1 with its verb AND its key; dots is 2 and keeps 1; 5 plays spray',
        p2.pal[0] === 'spray' && p2.pal[1] === 'pen' && p2.verb1 === 'momentary' && p2.legs[0] === '5' && p2.legs[1] === '1' && p2.row2 === 'dots · play (momentary)' && p2.play.active && p2.play.lit === 1, JSON.stringify({ pal: p2.pal, verb: p2.verb1, legs: p2.legs, play: p2.play }));
  check('… and its release ended it', !p2.active, JSON.stringify({ active: p2.active }));
  // Off the strip: picked up and let go anywhere else, it is gone, and its
  // digit is free again.
  const p3 = await rig.evaluate(() => { const H = window.__ba; H.dragOff(H.tileAt(1));
    const used = Object.values(H.S._keyMappings).some(m => m.code === 'Digit5');
    return { ...H.state(), stored: H.stored(), rowStill: !!H.row('spray'), used }; });
  check('dragging spray off removes it: seven again, its rail row still there, stored, its digit freed', p3.pal.join() === d0.pal.join() && p3.rowStill && p3.stored.length === 7 && !p3.used, JSON.stringify({ pal: p3.pal, used: p3.used }));
  await rig.evaluate(() => { const H = window.__ba; H.openDrawer('pen'); });
  // The pin pair moves like anything else: pin to 1, and ↓ still pins.
  // Under the full run the cc sweep leaves the grain sheet's `on end` on
  // cloud, so p2's spray play pinned a cloud at the cursor on release, and a
  // ↓ pin there found its material already CLAIMED (n0 1 → n1 1, twice on
  // 2026-09-12). Free the pool first; the count is what ↓ adds.
  // (The cc sweep also leaves the cloud release at half its 10 s throw, so
  // the cleared cloud kept its claim through a 3 s wait — commitRelease 0.)
  const p4 = await rig.evaluate(async () => { const H = window.__ba; const UP = await import('./js/ui-presets.js');
    H.S.commitRelease = 0; UP.clearAllCommits(); for (let w = 0; w < 120 && H.S.commitSlots.some(Boolean); w++) await new Promise(r => setTimeout(r, 25));
    const n0 = H.S.commitSlots.filter(Boolean).length;
    H.drag(H.tileAt(6), H.xBefore(1)); const pal = H.pal(); const row = H.S._paletteRow(1); const leg = H.legAt(1)?.text;
    H.tap('ArrowDown'); await new Promise(r => setTimeout(r, 900));
    const n1 = H.S.commitSlots.filter(Boolean).length;
    H.drag(H.tileAt(1), H.xBefore(7));
    return { pal, row, leg, n0, n1, back: H.pal(), verbBack: H.verbs()[5] }; });
  check('pin dragged to 1: the row says pin here, it keeps ↓ and ↓ pins, and it moves back before unpin with its verb', p4.pal[0] === 'pin' && p4.row.label === 'pin · pin here' && p4.leg === '↓' && p4.n1 === p4.n0 + 1 && p4.back.join() === d0.pal.join() && p4.verbBack === 'bang', JSON.stringify(p4));
  // PIN IS THE KIND WITH ALL THREE VERBS (§ 4), and its drawn path is now a
  // verb rather than two extra actions: a TOGGLE opens the path on one press
  // and seals it on the next, a MOMENTARY draws it from the down to the up,
  // and a BANG pins where you stand.
  //
  // The path verbs are driven on a SECOND pin tile at a position with nothing
  // bound — § 4's own example of why a tool may sit on the strip twice. (Pin
  // at 6 sat under button 3 TAP until 2026-09-12 and could not be momentary;
  // it is the press now, and § H cycles it through all three.)
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
    const segs = H.T.verbsOf('pin').allowed;
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
  check('pin\'s kind allows all three verbs', ['bang', 'momentary', 'toggle'].every(v => p4b.segs.includes(v)), JSON.stringify(p4b.segs));
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
  const p5 = await rig.evaluate(() => { const H = window.__ba; H.dragOff(H.tileAt(7)); const gone = H.pal();
    H.drag(document.querySelector('#tcPins [data-pin="unpin"]'), H.xEnd()); return { gone, back: H.pal() }; });
  check('unpin dragged off is gone; the pins rail\'s unpin row dragged in at the end puts it back', gone_ok(p5), JSON.stringify(p5));
  // EVERY tool can leave. The last one used to be pinned to the strip — a
  // palette with nothing to arm had nothing for space to do — and both halves
  // of that reason went on 2026-09-11.
  const p6 = await rig.evaluate(() => { const H = window.__ba; const r = ['pen', 'line', 'looper', 'overdub', 'scrape'].map(id => H.T.removeFromPalette(id)); const a = H.state();
    return { r, a, stored: H.stored() }; });
  check('removing every tool: all five go, and the strip is the pins alone', p6.r.join() === 'true,true,true,true,true' && p6.a.slots.length === 0 && p6.a.pal.join() === 'pin,unpin', JSON.stringify(p6.a));
  check('… and it stores that way — no tool is forced back on', p6.stored.map(e => e.id).join() === 'pin,unpin', JSON.stringify(p6.stored));
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
        p9.rows.join(' | ') === 'dots · play (momentary) | line · play (toggle) | loop · play (toggle) | pin · pin here | unpin · unpin', p9.rows.join(' | '));
  // § 4's table: which verbs a kind MAY have, and which a drop lands on.
  check('a brush and a lens may be momentary or toggle and never a bang; pin has all three; unpin is a bang alone',
        p9.allowed.tool.allowed.join() === 'momentary,toggle' && p9.allowed.tool.def === 'momentary' &&
        p9.allowed.lens.allowed.join() === 'momentary,toggle' && p9.allowed.lens.def === 'toggle' &&
        p9.allowed.pin.allowed.join() === 'bang,momentary,toggle' && p9.allowed.pin.def === 'bang' &&
        p9.allowed.unpin.allowed.join() === 'bang' && p9.allowed.unpin.def === 'bang', JSON.stringify(p9.allowed));
  check('an empty position is ONE blank row that says to drag a tile there', !p9.empty.enabled && !p9.empty.hidden && /drag/.test(p9.empty.why), JSON.stringify(p9.empty));

  // ── E. The keys fire by position, in the tile's verb ──────────────────────
  }
  if (want('E')) {
  console.log('\n§ E the keys fire by position, in the tile\'s verb');
  // rig-audit runs every suite in ONE instance: the cc suites leave the pin
  // pool swept small and FULL, so a pin here found no slot and the counts
  // read unchanged (2026-09-12, twice). Free the pool and restore its size,
  // as § D's own p4b does, before a pin is counted.
  // A loop leaves by S.loopReleaseMode — the cc sweep can leave it on
  // play-to-end, or the fade time long, and the slots stay busy through a
  // clear; a pin then finds no slot. Make the leave quick, and WAIT for it.
  await rig.evaluate(async () => { const H = window.__ba; H.factory(); const UP = await import('./js/ui-presets.js');
    H.S.commitSlotCount = Math.max(8, H.S.commitSlotCount | 0); H.S.loopReleaseMode = 'fade'; H.S.loopFadeTimeMs = 30; H.S.commitRelease = 0;
    UP.clearAllCommits(); for (let w = 0; w < 120 && H.S.commitSlots.some(Boolean); w++) await new Promise(r => setTimeout(r, 25)); });
  const e0 = await st();
  check('setup: the factory seven, nothing playing', e0.pal.length === 7 && !e0.active, JSON.stringify(e0));
  // ARMING IS GONE, and `sel` with it: the module must not have grown one
  // back under another name. The hand is `inHandId`, a different thing
  // (§ O). `selectedTile` answers what the DRAWER is on.
  const eSel = await rig.evaluate(() => {
    const T = window.__ba.T;
    return { exports: Object.keys(T).sort(), hasSel: 'sel' in T, arm: typeof T.armTile, load: typeof T.loadTile };
  });
  check('tiles.js exports no `sel`, no armTile and no loadTile', !eSel.hasSel && eSel.arm === 'undefined' && eSel.load === 'undefined', JSON.stringify(eSel));
  // THE KEYS ARE EXPLICIT ROWS (2026-09-12): the factory digits are in the
  // key map, one per position, and nothing reads a digit off the keyboard
  // by position any more.
  const eKm = await rig.evaluate(() => { const km = window.__ba.S._keyMappings; return [1, 2, 3, 4, 5, 6, 7].map(n => km[`palette_${n}`]?.code ?? null); });
  check('the factory keys are explicit rows: 1 (long) · 1 · 2 · 3 · 4 · ↓ · ↑', eKm.join() === 'Digit1,Digit1,Digit2,Digit3,Digit4,ArrowDown,ArrowUp', eKm.join());
  // A TOGGLE tile (line at 2, on 1's press): the down starts it latched and
  // lights it, the up does NOTHING, and the same digit again ends it.
  // A beat between plays. `startPaintStroke` is ASYNC — it waits on the mic —
  // and the rig has none, so a stop dispatched in the same synchronous block
  // can land before the start finishes and leave `S.isPainting` true for ever.
  // That is a real race in the audio path, not in the palette; it is paced
  // around here rather than papered over, and noted where it belongs.
  const settle = () => rig.evaluate(async () => { await new Promise(r => setTimeout(r, 260)); return true; });
  const d1 = await rig.evaluate(() => { const H = window.__ba; H.key('Digit2'); const down = { ...H.state(), lit: H.lit('looper') };
    H.key('Digit2', 'keyup'); const up = { ...H.state(), lit: H.lit('looper') };
    return { down, up }; });
  await settle();
  d1.end = await rig.evaluate(() => { const H = window.__ba; H.tap('Digit2'); return { ...H.state(), lit: H.lit('looper') }; });
  await settle();
  check('2 is the TOGGLE tile at 3: the down starts loop, tape in the cursor, its tile lit', d1.down.active && d1.down.bkey === 'tape' && d1.down.lit === 1, JSON.stringify(d1.down));
  check('… its key-up does nothing', d1.up.active && d1.up.lit === 1, JSON.stringify(d1.up));
  check('… and the same digit again ends it', !d1.end.active && d1.end.lit === 0, JSON.stringify(d1.end));
  // A MOMENTARY tile (scrape top at 5, on 4): the up ENDS it. Without the up
  // edge a momentary digit latched on for ever, which is what this catches.
  const d2 = { down: await rig.evaluate(() => { const H = window.__ba; H.key('Digit4'); return { ...H.state(), lit: H.lit('scrape') }; }) };
  await settle();
  d2.up = await rig.evaluate(() => { const H = window.__ba; H.key('Digit4', 'keyup'); return { ...H.state(), lit: H.lit('scrape') }; });
  await settle();
  check('4 is a MOMENTARY tile: the down starts scrape top, the eraser held, its tile lit', d2.down.active && d2.down.held && d2.down.lit === 1, JSON.stringify(d2.down));
  check('… and its key-up ENDS it — a momentary digit must not latch', !d2.up.active && !d2.up.held && d2.up.lit === 0, JSON.stringify(d2.up));
  // ONE PLAY AT A TIME, and no hand-back: nothing is restored on release.
  // The hand is a thing again (§ O) but a quick-access play never touches it.
  const d3 = { a: await rig.evaluate(() => { const H = window.__ba; H.key('Digit2'); return { ...H.state(), litL: H.lit('looper'), litP: H.lit('scrape') }; }) };
  await settle();
  d3.b = await rig.evaluate(() => { const H = window.__ba; H.tap('Digit4'); return { ...H.state(), litL: H.lit('looper'), litP: H.lit('scrape') }; });
  await settle();
  d3.after = await rig.evaluate(() => { const H = window.__ba; H.key('Digit2', 'keyup'); H.tap('Digit2'); return { ...H.state(), hue: H.S._handHue }; });
  await settle();
  check('a second tool digit under a running play is dead', d3.b.active && d3.b.litL === 1 && d3.b.litP === 0, JSON.stringify(d3.b));
  check('… and when the play ends nothing is in the cursor — no hand-back, no hue; the hand itself did not move', !d3.after.active && d3.after.hue === null && d3.after.hand === 'pen', JSON.stringify(d3.after));
  // A BANG tile (pin at 6, on ↓) and a LENS tile, placed for the check.
  const d4 = await rig.evaluate(async () => { const H = window.__ba; const wait = ms => new Promise(r => setTimeout(r, ms));
    H.S._gestureEnd?.(); await wait(200);
    document.getElementById('commitClearBtn')?.click(); await wait(400);
    const n0 = H.S.commitSlots.filter(Boolean).length, u0 = H.S._undoCount();
    H.tap('ArrowDown'); await wait(900);
    const n1 = H.S.commitSlots.filter(Boolean).length, u1 = H.S._undoCount();
    document.getElementById('commitClearBtn')?.click(); await wait(300);
    return { n0, n1, presses: u1 - u0, active: H.S._gestureActive() }; });
  // ONE press is ONE undo action (history.js mergeTagged), and it pins what the
  // cursor is on — every line there (tiles.js pinDown), so the count is
  // "more", not "one": the earlier digit plays left lines at the cursor. Until
  // 2026-09-16 the paint ticker laid marks at the pointer's projection while
  // the scan read the centre, so nothing was ever under the cursor here but
  // the cloud.
  check('6 is a BANG tile on ↓: one press is one pin press, pins what is there, and starts no gesture', d4.presses === 1 && d4.n1 > d4.n0 && !d4.active, JSON.stringify(d4));
  // A lens tile dropped at 8 takes the next free digit, 5, and toggles from it.
  const d5 = await rig.evaluate(() => { const H = window.__ba; H.lensOn(); H.T.placeTile('wide', undefined, 'toggle'); const key = H.S._keyMappings.palette_8?.code;
    H.tap('Digit5'); const a = { muted: !!H.S.scanMuted, lit: H.lensT().lit };
    H.tap('Digit5'); const b = { muted: !!H.S.scanMuted, lit: H.lensT().lit }; const d9 = (H.tap('Digit9'), !!H.S._gestureActive());
    H.T.removeFromPalette('wide'); return { key, a, b, d9 }; });
  check('a lens tile dropped takes 5 and is a TOGGLE lens: off is the cap, on again brings it back; 9, unbound, does nothing', d5.key === 'Digit5' && d5.a.muted && d5.a.lit.length === 0 && !d5.b.muted && d5.b.lit.join() === 'wide' && !d5.d9, JSON.stringify(d5));
  // The 18 actions that carried the other two verbs are GONE from the
  // registry, and every surviving palette row's TYPE follows its tile.
  const d6 = await rig.evaluate(() => { const ids = window.__ba.S._actions.map(a => a.id);
    const pal = ids.filter(i => /^palette_[1-9]/.test(i));
    const typeOf = n => window.__ba.S._actions.find(a => a.id === `palette_${n}`)?.type;
    const fmtOf  = n => window.__ba.S._actions.find(a => a.id === `palette_${n}`)?.fmt;
    return { pal, n: pal.length, t1: typeOf(1), t2: typeOf(2), t6: typeOf(6), f1: fmtOf(1), f6: fmtOf(6) }; });
  check('27 palette actions are 9: no palette_N_toggle and no palette_N_hold', d6.n === 9 && !d6.pal.some(i => /_(toggle|hold)$/.test(i)), JSON.stringify(d6.pal));
  check('a row\'s TYPE follows its tile: momentary is a hold taking int 0|1, toggle and bang are triggers taking a bang',
        d6.t1 === 'hold' && d6.t2 === 'trigger' && d6.t6 === 'trigger' && d6.f1 === 'int 0|1' && d6.f6 === 'bang', JSON.stringify(d6));
  // The keys-page row is ONE row per position now, in the tile's own words.
  const d7 = await rig.evaluate(() => { const R = n => window.__ba.S._paletteRow(n);
    return { r2: R(2), r3: R(3), r1: R(1), r7: R(7), r6: R(6), r9: R(9) }; });
  check('one row per position, the verb in the tile\'s own words',
        d7.r1.label === 'dots · play (momentary)' && d7.r2.label === 'line · play (toggle)' && d7.r3.label === 'loop · play (toggle)' && d7.r6.label === 'pin · pin here' && d7.r7.label === 'unpin · unpin', JSON.stringify(d7));
  check('… and an empty position is one blank row saying to drag a tile there', !d7.r9.enabled && !d7.r9.hidden && /drag/.test(d7.r9.why), JSON.stringify(d7.r9));
  // A relearned digit stands down; a row deleted is simply unbound and the
  // tile wears a dash; the digit put back plays again.
  const d8 = await rig.evaluate(() => { const H = window.__ba; const km = H.S._keyMappings; const was = km.palette_2;
    km.palette_2 = { type: 'key', key: 'j', code: 'KeyJ', shift: false, ctrl: false, meta: false }; H.S._bindingsChanged();
    H.tap('Digit1'); const a = { active: !!H.S._gestureActive(), lit: H.lit('line'), leg: H.legAt(2)?.text ?? '' };
    delete km.palette_2; H.S._bindingsChanged();
    H.tap('Digit1'); const b = { active: !!H.S._gestureActive(), leg: H.legAt(2)?.text ?? '' };
    km.palette_2 = was; H.S._bindingsChanged();
    H.key('Digit1'); const c = { active: !!H.S._gestureActive() }; H.key('Digit1', 'keyup'); H.tap('Digit1');
    return { a, b, c }; });
  check('palette_2 relearned onto J: a tap on 1 plays nothing and line\'s tile wears J', !d8.a.active && d8.a.lit === 0 && d8.a.leg === 'j', JSON.stringify(d8.a));
  check('unbound: 1 plays nothing and the tile wears the EMPTY sticker — a dash, still the learn cell', !d8.b.active && d8.b.leg === '–', JSON.stringify(d8.b));
  check('… put back, 1 plays line again', d8.c.active, JSON.stringify(d8.c));
  await rig.evaluate(() => window.__ba.factory());

  // ── F. Lens and cap — a lens is a state; no lens on is the cap ────────────
  }
  if (want('F')) {
  console.log('\n§ F lens and cap');
  // No lens is on the factory strip: wide is placed at its head for the
  // section and taken off at the end.
  const f0 = await rig.evaluate(() => { const H = window.__ba; H.T.closeProps(); H.T.placeTile('wide', 0, 'toggle'); if (H.T.installedLens() !== 'wide') H.lensRow('wide').click(); if (H.S.scanMuted) H.clickLens(H.T.installedLens());
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
  await rig.evaluate(() => { window.__ba.T.closeProps(); window.__ba.T.setPropsOpen(false); window.__ba.factory(); });

  // ── G — DELETED (docs/PALETTE-GUI.md § 9) ─────────────────────────────────
  // "Lit, and tool keys fire" tested the ARMED BOX outranking the lit fill,
  // and there is no armed box — `.palette .tile.armed` and the `skin-arm`
  // keyframe are deleted, and § A now fails if any element wears `.armed` at
  // all. The lit fill itself is driven in § E and § H, where a play is.
  // ── H. THE HAND (Ek, 2026-09-12) ─────────────────────────────────────────
  // "in hand just should mean what the spacebar or click does. that should
  // be always the truth." The two reserved inputs play the tool in hand in
  // the HAND's verb — one global switch, drawn as the plate's shape — and
  // neither can be learned onto anything. The tile's verb still rules a
  // quick-access play, and the caller still cannot choose.
  }
  if (want('H')) {
  console.log('\n§ H the hand: space and the sphere\'s click, in the hand\'s verb');
  await rig.evaluate(() => { const H = window.__ba; H.factory(); H.T.closeProps(); H.T.setPropsOpen(false); H.row('pen').click(); });
  const t0 = await rig.evaluate(() => { const H = window.__ba;
    return { seg: !!document.getElementById('gestureModeSeg'), tog: !!document.getElementById('paletteTriggerToggle'),
             ls: localStorage.getItem('mubone_gesture_momentary') ?? localStorage.getItem('mubone_palette_trigger'),
             active: !!H.S._gestureActive(), verbs: H.verbs(), hand: H.hand(), hv: H.handVerb() }; });
  check('no mode switch and no tool-keys-fire switch exist, their keys gone, nothing running, dots in hand, momentary', !t0.seg && !t0.tog && t0.ls === null && !t0.active && t0.hand === 'pen' && t0.hv === 'momentary', JSON.stringify(t0));
  check('the factory strip is momentary · toggle · toggle · toggle · momentary · bang · bang', t0.verbs.join() === FACTORY_VERBS, t0.verbs.join());
  const settle = () => rig.evaluate(async () => { await new Promise(r => setTimeout(r, 260)); return true; });
  // SPACE, momentary by factory: the down starts the in-hand tool and lights
  // the plate, the up ends it. Dots is in hand, so grain is in the cursor.
  const tS = { down: await rig.evaluate(() => { const H = window.__ba; H.space(); return { active: H.S._gestureActive(), latched: H.S._gestureLatched(), plate: H.plate()?.lit, lit: H.lit('pen'), row: !!H.row('pen')?.classList.contains('playing'), bkey: H.brushKey(), hue: H.S._handHue }; }) };
  await settle();
  tS.up = await rig.evaluate(() => { const H = window.__ba; H.space('keyup'); return { active: H.S._gestureActive(), plate: H.plate()?.lit, lit: H.lit('pen'), hue: H.S._handHue }; });
  await settle();
  // The PLATE and the rail ROW light; dots' strip TILE does not — position 1
  // is not sounding, the hand is.
  check('SPACE plays the tool in hand, momentary: the down starts dots, grain in the cursor, the hand tile and the row lit, the strip tile NOT', tS.down.active && !tS.down.latched && tS.down.plate && tS.down.row && tS.down.lit === 0 && tS.down.bkey?.startsWith('grain') && !!tS.down.hue, JSON.stringify(tS.down));
  check('… and its up ends it: plate dark, no hue', !tS.up.active && !tS.up.plate && tS.up.lit === 0 && tS.up.hue === null, JSON.stringify(tS.up));
  // THE SPHERE'S LEFT-CLICK is the same press.
  const tC = { down: await rig.evaluate(() => { const H = window.__ba; H.sphere('mousedown'); return { active: H.S._gestureActive(), latched: H.S._gestureLatched(), plate: H.plate()?.lit }; }) };
  await settle();
  tC.up = await rig.evaluate(() => { const H = window.__ba; H.sphere('mouseup'); return { active: H.S._gestureActive(), plate: H.plate()?.lit }; });
  await settle();
  check('a LEFT-CLICK on the sphere plays the tool in hand the same way: down starts it, up ends it', tC.down.active && !tC.down.latched && tC.down.plate && !tC.up.active && !tC.up.plate, JSON.stringify(tC));
  // THE VERB IS ONE SWITCH, flipped by a right-click on the hand tile, and
  // the tile's SHAPE says which — the tile's own two radii.
  const tV = await rig.evaluate(() => { const H = window.__ba; const before = H.plate(); H.plateRightClick(); const after = H.plate();
    return { before: { verb: before.verb, r: before.r }, after: { verb: after.verb, r: after.r, hv: H.handVerb() }, stored: localStorage.getItem('mubone_hand_verb') }; });
  check('a right-click on the hand tile flips the hand to TOGGLE, stores it, and the tile draws the asymmetric plate', tV.before.verb === 'momentary' && tV.before.r === '10px' && tV.after.verb === 'toggle' && tV.after.hv === 'toggle' && tV.after.r === '24px 3px' && tV.stored === 'toggle', JSON.stringify(tV));
  const tM = { down: await rig.evaluate(() => { const H = window.__ba; H.space(); return { active: H.S._gestureActive(), latched: H.S._gestureLatched(), plate: H.plate()?.lit }; }) };
  await settle();
  tM.up = await rig.evaluate(() => { const H = window.__ba; H.space('keyup'); return { active: H.S._gestureActive(), plate: H.plate()?.lit }; });
  await settle();
  tM.again = await rig.evaluate(() => { const H = window.__ba; H.space(); H.space('keyup'); return { active: H.S._gestureActive(), plate: H.plate()?.lit }; });
  await settle();
  tM.click = await rig.evaluate(() => { const H = window.__ba; H.sphere('mousedown'); const d = H.S._gestureActive(); H.sphere('mouseup'); return { d }; });
  await settle();
  tM.clickUp = await rig.evaluate(() => ({ active: window.__ba.S._gestureActive() }));
  await rig.evaluate(() => { const H = window.__ba; H.sphere('mousedown'); H.sphere('mouseup'); });
  await settle();
  check('TOGGLE: space starts it latched, its up does nothing, space again ends it; the click the same', tM.down.active && tM.down.latched && tM.down.plate && tM.up.active && tM.up.plate && !tM.again.active && !tM.again.plate && tM.click.d && tM.clickUp.active, JSON.stringify(tM));
  await rig.evaluate(() => { const H = window.__ba; H.plateRightClick(); });
  const tV2 = await rig.evaluate(() => ({ hv: window.__ba.handVerb(), r: window.__ba.plate()?.r, active: window.__ba.S._gestureActive() }));
  check('… and flipped back to momentary, the rounded plate returns', tV2.hv === 'momentary' && tV2.r === '10px' && !tV2.active, JSON.stringify(tV2));
  // The hand tile is a LEGEND (2026-09-17, reversing 2026-09-12): a mouse press
  // on it presses nothing — the spacebar and the sphere are the hand's inputs.
  const tP = await rig.evaluate(async () => { const H = window.__ba; const wait = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('handKey').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true })); await wait(260);
    const a = { active: H.S._gestureActive(), plate: H.plate()?.lit, cursor: getComputedStyle(document.getElementById('handKey')).cursor };
    H.sphere('mouseup'); await wait(260);
    return { a, b: { active: H.S._gestureActive() } }; });
  check('a mouse press on the hand tile presses nothing, and the tile wears no pointer', !tP.a.active && !tP.a.plate && tP.a.cursor !== 'pointer' && !tP.b.active, JSON.stringify(tP));
  // SPACE CANNOT BE LEARNED: with a learn armed, space binds nothing, plays
  // nothing, and the learn stays armed; a stored Space row is dropped at load.
  const tL = await rig.evaluate(async () => { const H = window.__ba; const wait = ms => new Promise(r => setTimeout(r, ms));
    H.S._paletteLearn(3, 'key'); await wait(30);
    H.space(); H.space('keyup'); await wait(300);
    const out = { stillLearning: H.S._paletteLearning()?.id ?? null, km4: H.S._keyMappings.palette_4?.code ?? null, active: !!H.S._gestureActive() };
    H.S._paletteLearnCancel(); return out; });
  check('with a learn armed, the spacebar binds nothing, plays nothing, and the learn stays armed', tL.stillLearning === 'palette_4' && tL.km4 === 'Digit3' && !tL.active, JSON.stringify(tL));
  await rig.evaluate(() => { const km = JSON.parse(localStorage.getItem('mubone_key_map') || '{}'); km.palette_4 = { type: 'key', key: ' ', code: 'Space', shift: false, ctrl: false, meta: false, g: 'press' }; localStorage.setItem('mubone_key_map', JSON.stringify(km)); return true; });
  await rig.reload(); await installHelpers(rig);
  const tL2 = await rig.evaluate(() => ({ km4: window.__ba.S._keyMappings.palette_4 ?? null, stored: JSON.parse(localStorage.getItem('mubone_key_map') || '{}').palette_4 ?? null }));
  check('a stored Space binding is DROPPED at load — the row is unbound in memory and on disk', tL2.km4 === null && tL2.stored === null, JSON.stringify(tL2));
  await rig.evaluate(() => { const H = window.__ba; H.factory(); H.row('pen').click(); });
  // A QUICK-ACCESS PLAY IS THE TILE'S VERB, NOT THE CALLER'S: `_paletteFire`
  // takes an EDGE and nothing else. A momentary tile ends when its input goes
  // up; a toggle ignores that same up and ends on the next down. Same call,
  // opposite outcome, because the tile differs.
  const t1 = await rig.evaluate(() => { const H = window.__ba;
    H.fire(1, true); const a = { active: H.S._gestureActive(), lit: H.lit('pen'), plate: H.plate()?.lit };
    H.fire(1, false); const b = { active: H.S._gestureActive(), lit: H.lit('pen') };
    H.fire(2, true); const c = { active: H.S._gestureActive(), lit: H.lit('line') };
    H.fire(2, false); const d = { active: H.S._gestureActive(), lit: H.lit('line') };
    H.fire(2, true); const e = { active: H.S._gestureActive(), lit: H.lit('line') };
    return { a, b, c, d, e }; });
  check('the MOMENTARY tile at 1 ends on its up edge — and its play does not light the HAND TILE, though dots is in hand', t1.a.active && t1.a.lit === 1 && !t1.a.plate && !t1.b.active && t1.b.lit === 0, JSON.stringify(t1));
  check('the TOGGLE tile at 2 ignores the SAME up edge and ends on the next down', t1.c.active && t1.d.active && t1.d.lit === 1 && !t1.e.active, JSON.stringify(t1));
  // Flip the tile's verb — the strip's right-click — and the same edges mean
  // the other thing. Nothing about the caller changed; the tile did.
  const t2 = await rig.evaluate(() => { const H = window.__ba;
    H.rightClick(1); const flipped = H.verbs()[0];
    H.fire(1, true); H.fire(1, false); const held = { active: H.S._gestureActive(), verb: H.verbs()[0] };
    H.fire(1, true); const ended = H.S._gestureActive();
    H.rightClick(1);
    return { flipped, held, ended, back: H.verbs()[0] }; });
  check('a right-click on dots\' tile flips it to TOGGLE: its up edge stops ending it and the next down does', t2.flipped === 'toggle' && t2.held.verb === 'toggle' && t2.held.active && !t2.ended, JSON.stringify(t2));
  check('… and a second right-click cycles it back to momentary', t2.back === 'momentary', t2.back);
  // THE PIN TILE HAS THREE VERBS (Ek, 2026-09-12: "as i right click thru pin
  // it should have 3 states avail. right now it's just toggle and bang. it
  // should have momentary"): the factory pin sits on button 3's PRESS now,
  // not its tap, so nothing refuses momentary.
  const t2p = await rig.evaluate(() => { const H = window.__ba; const v = () => H.verbs()[5]; const a = v();
    H.rightClick(6); const b = v(); H.rightClick(6); const c = v(); H.rightClick(6); const d = v(); return { a, b, c, d, bm: H.S._buttonMappings.palette_6 }; });
  check('the factory pin tile cycles through all three: bang → momentary → toggle → bang, on button 3\'s press', t2p.a === 'bang' && t2p.b === 'momentary' && t2p.c === 'toggle' && t2p.d === 'bang' && t2p.bm?.g === 'press', JSON.stringify(t2p));
  await rig.evaluate(() => { const H = window.__ba; H.S._gestureEnd?.(); });
  // A momentary tile cannot take a TAP: a tap is a bang with no up edge, so
  // it would fire 127 with no 0 and latch the tile on for ever. `_learnGesture`
  // refuses it when a key is learned; the right-click must refuse it too,
  // and it does by skipping the momentary when it cycles.
  const t3 = await rig.evaluate(() => { const H = window.__ba; const km = H.S._keyMappings; const was = km.palette_2;
    km.palette_2 = { type: 'key', key: 'j', code: 'KeyJ', shift: false, ctrl: false, meta: false, g: 'tap' };
    H.S._bindingsChanged();
    H.rightClick(2); const after = H.verbs()[1];
    const moved = H.setVerb(2, 'momentary'); const after2 = H.verbs()[1];
    km.palette_2 = was; H.S._bindingsChanged();
    return { after, moved, after2 }; });
  check('with a TAP bound on line, a right-click leaves it TOGGLE — there is no other verb it can take', t3.after === 'toggle', JSON.stringify(t3));
  check('… and the model refuses momentary outright', !t3.moved && t3.after2 === 'toggle', JSON.stringify(t3));
  // The eraser's long press survives the model change. `all` is not on the
  // factory strip any more, so it is placed for the check.
  const t10 = await rig.evaluate(async () => { const H = window.__ba; const { GESTURE_LONG_MS } = await import('./js/state.js');
    const real = H.S._sessionEraseAll; let calls = 0; H.S._sessionEraseAll = () => { calls++; };
    let blurs = 0; const onBlur = () => { blurs++; }; window.addEventListener('blur', onBlur);
    H.T.placeTile('all', undefined, 'toggle'); const n = H.pal().length;   // a long press needs a gesture that outlives the key
    H.fire(n, true); const a = { held: !!H.S.eraseHeld, calls };
    await new Promise(r => setTimeout(r, GESTURE_LONG_MS + 300));
    window.removeEventListener('blur', onBlur);
    const b = { held: !!H.S.eraseHeld, active: H.S._gestureActive(), calls, blurs };
    H.S._gestureEnd(); H.S._sessionEraseAll = real; H.T.removeAt(n - 1);
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
    // The sheet every read below expects is pen's: pen in hand, its ⋯ opened.
    H.factory(); H.T.pickHand('pen'); H.T.closeProps(); H.T.setPropsOpen(false); await wait(100);
    H.openDrawer('pen'); await wait(250);
    if (!document.body.classList.contains('prail-open')) { H.T.openProps('pen', 'tool'); await wait(320); }
    if (H.S.traceMode !== 'trace') { q('#propRail [data-sw="gend"]')?.click(); await wait(450); }
  });
  const w1 = await rig.evaluate(async () => { const H = window.__ba; const q = s => document.querySelector(s);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    H.openDrawer('pen'); await wait(120);
    const a = { ...H.state(), mode: H.S.traceMode, wet: H.T.isWet('pen'),
                hasA: !!H.S._actions?.find?.(x => x.id === 'trace_mode') };
    H.openDrawer('pen'); await wait(120);
    const b = { armed: H.picked(), mode: H.S.traceMode, wet: H.T.isWet('pen') };
    H.openDrawer('pen'); H.T.openProps('pen', 'tool'); await wait(200);
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
    H.T.closeProps();
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

  // THE DROP IS ON THE STRIP TOO (Ek, 2026-09-14: "the wet icon should be
  // clickable in the palette tile … all grain tools should have the wet/dry
  // toggle on the palette tile"). Every GRAIN tile there wears it, dry face
  // included — the tile is where you play from, and the switch was only in
  // the rail and the sheet. A tap flips that tool and nothing else: it does
  // not take it in hand, and on the HAND TILE, which presses on mousedown,
  // it does not play.
  const j2 = await rig.evaluate(async () => {
    const H = window.__ba, T = H.T, S = H.S;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const qa = s => [...document.querySelectorAll(s)];
    const grain = id => T.slotKind(id) === 'granular';
    const strip = () => qa('#paletteDock .tile[data-pal]');
    const drops = () => strip().filter(e => e.querySelector('[data-wet-tgl]')).map(e => e.dataset.pal);
    const pal = H.pal();
    const want = pal.filter(grain), notWant = pal.filter(id => !grain(id));
    const id = want[0];
    const tile = () => strip().find(e => e.dataset.pal === id);
    const drop = () => tile()?.querySelector('[data-wet-tgl]');
    const was = T.isWet(id), wasHand = H.hand();
    // a tool that is NOT in hand, so the tap can be seen not to pick it up
    const other = pal.find(x => x !== id && T.slotKind(x)) ?? wasHand;
    if (other && other !== id) T.pickHand(other);
    await sleep(40);
    const handBefore = H.hand();
    T.setWet(id, false); await sleep(40);
    const dry = { on: !!drop()?.classList.contains('on'), wet: T.isWet(id) };
    drop().click(); await sleep(40);
    const tapped = { on: !!drop()?.classList.contains('on'), wet: T.isWet(id), hand: H.hand() };
    drop().click(); await sleep(40);
    const again = { on: !!drop()?.classList.contains('on'), wet: T.isWet(id), hand: H.hand() };
    // the HAND TILE's drop: a press there must not play the hand
    T.pickHand(id); await sleep(40);
    const hd = document.querySelector('#handKey [data-wet-tgl]');
    const playedBefore = !!S._handTile?.();
    hd?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    await sleep(40);
    const playedDuring = !!S._handTile?.();
    hd?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
    hd?.click(); await sleep(40);
    const handTap = { wet: T.isWet(id), played: !!S._handTile?.() };
    T.setWet(id, was); if (wasHand) T.pickHand(wasHand); await sleep(40);
    return { drops: drops(), want, notWant, id, handBefore, dry, tapped, again,
             hasHandDrop: !!hd, playedBefore, playedDuring, handTap };
  });
  check('every grain tile on the strip wears the drop, and no other tile does',
        j2.want.every(id => j2.drops.includes(id)) && !j2.notWant.some(id => j2.drops.includes(id)),
        JSON.stringify({ drops: j2.drops, want: j2.want, notWant: j2.notWant }));
  check('a tap on the strip drop flips that tool and does not take it in hand',
        !j2.dry.on && !j2.dry.wet && j2.tapped.wet && j2.tapped.on && !j2.again.wet && !j2.again.on
        && j2.tapped.hand === j2.handBefore && j2.again.hand === j2.handBefore, JSON.stringify(j2));
  check('the hand tile\'s drop flips too, and pressing it never plays the hand',
        j2.hasHandDrop && !j2.playedBefore && !j2.playedDuring && !j2.handTap.played && j2.handTap.wet,
        JSON.stringify({ hasHandDrop: j2.hasHandDrop, playedDuring: j2.playedDuring, handTap: j2.handTap }));

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
  const k2 = await rig.evaluate(() => { const H = window.__ba; H.T.closeProps(); const out = {};
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
  check('the last tool of a kind cannot be deleted: its Delete is disabled and says why, and a click changes nothing', k4.last.rows.length === 1 && k4.last.disabled && /last tool/.test(k4.last.title || '') && k4.lastStill.rows.length === 1, JSON.stringify({ last: k4.last, still: k4.lastStill }));
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
    const was2 = km.palette_2, was1 = km.palette_1;
    km.palette_2 = { type: 'key', key: 'q', code: 'KeyQ', shift: false, ctrl: false, meta: false, g: 'tap' };
    km.palette_1 = { type: 'key', key: 'q', code: 'KeyQ', shift: false, ctrl: false, meta: false, g: 'long' };
    H.S._bindingsChanged();
    const legend = { line: H.legAt(H.pos('line') + 1)?.text, pen: H.legAt(H.pos('pen') + 1)?.text, penBar: H.legAt(H.pos('pen') + 1)?.parts?.[0]?.g };
    H.openDrawer('all');                       // the DRAWER is on the eraser
    const drawerBefore = H.picked();
    // Q TAP fires position 2 — a TOGGLE tile, so the bang starts it and it
    // keeps running after the key is up.
    H.key('KeyQ'); await wait(60); H.key('KeyQ', 'keyup'); await wait(200);
    const tap = { active: H.S._gestureActive(), lit: H.lit('line'), bkey: H.brushKey(), picked: H.picked() };
    H.key('KeyQ'); await wait(60); H.key('KeyQ', 'keyup'); await wait(200);
    const tapOff = H.S._gestureActive();
    // Q LONG fires position 1 — a MOMENTARY tile, so it plays WHILE DOWN and
    // the release lets go. Read it while it is down.
    H.key('KeyQ'); await wait(320);
    const longDown = { active: H.S._gestureActive(), lit: H.lit('pen'), bkey: H.brushKey() };
    H.key('KeyQ', 'keyup'); await wait(200);
    const longUp = { active: H.S._gestureActive(), lit: H.lit('pen') };
    km.palette_2 = was2; km.palette_1 = was1; H.S._bindingsChanged(); H.S._buttonTiming.set(t0);
    return { legend, drawerBefore, tap, tapOff, longDown, longUp, pickedAfter: H.picked() }; });
  check('Q tap fires position 2 and Q long fires position 1 — two positions on one key; the tiles say so',
        l1.tap.active && l1.tap.lit === 1 && l1.tap.bkey === 'tape' && !l1.tapOff &&
        l1.longDown.active && l1.longDown.lit === 1 && l1.longDown.bkey?.startsWith('grain'),
        JSON.stringify(l1));
  check('… and each fires in its TILE\'s verb: the toggle at 2 outlives its key, the momentary at 1 does not',
        !l1.tapOff && !l1.longUp.active && l1.longUp.lit === 0, JSON.stringify({ tapOff: l1.tapOff, longUp: l1.longUp }));
  check('the tiles wear "q tap" and "q" with the long bar', /^q\s*tap$/i.test(l1.legend.line ?? '') && /^q$/i.test(l1.legend.pen ?? '') && l1.legend.penBar === 'long-bar', JSON.stringify(l1.legend));
  // The drawer follows the HAND (2026-09-12), not the last tile fired: a
  // quick-access key leaves it where it was.
  check('firing from the keyboard LEAVES the drawer where it was — it follows the hand, not the last fire',
        l1.drawerBefore === 'all' && l1.tap.picked === 'all' && l1.pickedAfter === 'all', JSON.stringify({ before: l1.drawerBefore, afterTap: l1.tap.picked, end: l1.pickedAfter }));
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
    km.palette_2 = { type: 'key', key: '1', code: 'Digit1', shift: false, ctrl: false, meta: false, g: 'press' }; H.S._bindingsChanged(); H.S._buttonTiming.set(t0);
    document.getElementById('settingsClose')?.click(); document.querySelector('.settings-dialog .close-btn')?.click(); await wait(200);
    return { row: !!row, cell: !!cell, learning, learned, after }; });
  check('the keys page lists ONE row per position, in the tile\'s words, and learning reads the whole gesture: R held past long learns "R long"',
        l2.row && l2.cell && l2.learning && l2.learned?.code === 'KeyR' && l2.learned?.g === 'long' && !l2.after, JSON.stringify(l2));
  // A MIDI note is a button source too — and it binds to `palette_N`, the one
  // action a position has. `palette_N_hold` is gone.
  await rig.evaluate(() => { localStorage.setItem('mubone_midi_map', JSON.stringify({ palette_1: { type: 'note', channel: 1, number: 60, g: 'long' } })); window.__ba.showKind('midi'); });
  await rig.reload(); await installHelpers(rig);
  const l3 = await rig.evaluate(async () => { const H = window.__ba; const wait = ms => new Promise(r => setTimeout(r, ms));
    H.openDrawer('line');
    const legend = H.legAt(H.pos('pen') + 1)?.text ?? null; const bar = H.legAt(H.pos('pen') + 1)?.parts?.[0]?.g === 'long-bar';
    H.S._handleMidiMessage({ data: [0x90, 60, 100] }); await wait(H.S._buttonTiming.get().long + 160);
    const a = { active: H.S._gestureActive(), lit: H.lit('pen'), bkey: H.brushKey() };
    H.S._handleMidiMessage({ data: [0x80, 60, 0] }); await wait(200); const b = { active: H.S._gestureActive(), lit: H.lit('pen') };
    H.S._handleMidiMessage({ data: [0x90, 60, 100] }); await wait(60); H.S._handleMidiMessage({ data: [0x90, 60, 0] }); await wait(200); const c = { active: H.S._gestureActive() };
    localStorage.removeItem('mubone_midi_map'); H.showKind('key'); return { legend, bar, a, b, c }; });
  check('note 60 held past long plays the MOMENTARY tile at 1, the note-off lets go, a short note does nothing',
        l3.a.active && l3.a.lit === 1 && l3.a.bkey?.startsWith('grain') && !l3.b.active && l3.b.lit === 0 && !l3.c.active, JSON.stringify(l3));
  // A PRESS AND A DOUBLE ON ONE KEY, BOTH TOGGLES (Ek, 2026-09-12: loop on
  // 2, line on 2 ×2 — "i double 2 and the line seems engaged; then i double
  // 2 to try toggle out of line but it doesn't respond, it's forever stuck
  // recording"). The second double's first down presses loop under the
  // running line — dead — and the abort that clears the press must not
  // throw away the line the press never started.
  const l4 = await rig.evaluate(async () => { const H = window.__ba; const wait = ms => new Promise(r => setTimeout(r, ms));
    const km = H.S._keyMappings; const t0 = H.S._buttonTiming.get(); H.S._buttonTiming.set({ long: 200, xlong: 500, tap: 120 });
    const was2 = km.palette_2, was3 = km.palette_3;
    km.palette_3 = { type: 'key', key: '2', code: 'Digit2', shift: false, ctrl: false, meta: false, g: 'press' };
    km.palette_2 = { type: 'key', key: '2', code: 'Digit2', shift: false, ctrl: false, meta: false, g: 'double' };
    H.S._bindingsChanged();
    const dbl = async () => { H.tap('Digit2'); await wait(40); H.tap('Digit2'); await wait(200); };
    await dbl(); const on = { active: !!H.S._gestureActive(), line: H.lit('line'), loop: H.lit('looper') };
    await dbl(); const off = { active: !!H.S._gestureActive(), line: H.lit('line'), loop: H.lit('looper') };
    // And a lone press still toggles loop on and off around it.
    H.tap('Digit2'); await wait(200); const loopOn = { active: !!H.S._gestureActive(), loop: H.lit('looper') };
    H.tap('Digit2'); await wait(200); const loopOff = { active: !!H.S._gestureActive(), loop: H.lit('looper') };
    km.palette_2 = was2; km.palette_3 = was3; H.S._bindingsChanged(); H.S._buttonTiming.set(t0);
    return { on, off, loopOn, loopOff }; });
  check('2 ×2 starts the line toggle (loop\'s press taken back), and 2 ×2 again ENDS it', l4.on.active && l4.on.line === 1 && l4.on.loop === 0 && !l4.off.active && l4.off.line === 0, JSON.stringify({ on: l4.on, off: l4.off }));
  check('… and a lone 2 still toggles loop on and off', l4.loopOn.active && l4.loopOn.loop === 1 && !l4.loopOff.active, JSON.stringify({ on: l4.loopOn, off: l4.loopOff }));
  check('… and the tile says 60 with the long bar (§ 11.6: no `n`, long as a bar)', /^60$/.test(l3.legend ?? '') && l3.bar === true, JSON.stringify(l3));
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
  // FLIP a tile's verb — the strip's right-click — and read the shape back
  // off the strip. This is the section's whole point: the radius must follow
  // the model, and the `html body .palette .tile` rule three classes deep
  // must not win.
  const m1 = await rig.evaluate(() => { const H = window.__ba; const out = {};
    out.before = { verb: H.verbs()[0], r: H.radiusAt(1) };
    H.rightClick(1);
    out.toggled = { verb: H.verbs()[0], r: H.radiusAt(1) };
    H.rightClick(1);
    out.back = { verb: H.verbs()[0], r: H.radiusAt(1) };
    return out; });
  check('dots starts momentary and draws the plate', m1.before.verb === 'momentary' && m1.before.r === R.momentary, JSON.stringify(m1.before));
  check('flipped to toggle by a right-click, the STRIP draws the asymmetric plate', m1.toggled.verb === 'toggle' && m1.toggled.r === R.toggle, JSON.stringify(m1.toggled));
  check('flipped back, the plate returns', m1.back.verb === 'momentary' && m1.back.r === R.momentary, JSON.stringify(m1.back));
  // PIN is the kind with all three, so it is the one tile that can prove the
  // whole set on its own — and the same tool twice in two verbs (§ 4) is how
  // pin ends up on the strip twice.
  const m2 = await rig.evaluate(() => { const H = window.__ba; const out = {};
    H.T.placeTile('pin', undefined, 'toggle');
    out.twice = { ids: H.pal().filter(x => x === 'pin').length, verbs: H.verbs().slice(-2) };
    out.radii = H.radii().slice(-2);
    const n = H.pal().length;
    // The right-click cycles: toggle → bang → momentary on a pin with nothing bound.
    H.rightClick(n); out.cyc1 = H.verbs()[n - 1]; H.rightClick(n); out.mom = { verb: H.verbs()[n - 1], r: H.radiusAt(n) };
    H.T.removeAt(n - 1);
    return out; });
  check('the same tool sits on the strip TWICE in two verbs, drawing two shapes', m2.twice.ids === 2 && m2.twice.verbs.join() === 'bang,toggle' && m2.radii.join() === `${R.bang},${R.toggle}`, JSON.stringify(m2));
  check('the right-click on the second pin cycles through all three verbs', m2.cyc1 === 'bang' && m2.mom.verb === 'momentary', JSON.stringify({ cyc1: m2.cyc1, mom: m2.mom.verb }));
  check('… and the third verb draws the third shape', m2.mom.verb === 'momentary' && m2.mom.r === R.momentary, JSON.stringify(m2.mom));
  await rig.evaluate(() => window.__ba.factory());
  }

  // ── N. THE STICKER IS THE TRUTH (§ 6, § 7, § 11.5–11.6; the doc's "J") ────
  // One sticker per bound position, of the one kind the keys page shows,
  // none when unbound; its text is source + gesture (+ the delay mark);
  // long and xlong are a bar; a note is its bare number; its computed
  // white-space is nowrap and flex-shrink 0 (§ 11.6's trap); and no sticker
  // the app can emit is wider than the 53px tile.
  if (want('N')) {
  console.log('\n§ N the sticker is the truth');
  await rig.evaluate(() => { const H = window.__ba; H.factory(); H.showKind('key'); });
  const n0 = await rig.evaluate(() => { const H = window.__ba;
    return { legs: [1, 2, 3, 4, 5, 6, 7].map(n => H.legAt(n)), n9: H.legAt(8), binds6: H.S._bindingsOf('palette_6') }; });
  check('with KEYS shown, every factory tile wears exactly one sticker — 1, 1, 2, 3, 4, ↓, ↑ — and an empty position none',
        n0.legs.every(l => l.sticker && l.parts.length === 1 && l.parts[0].kind === 'key') && n0.legs.map(l => l.text).join() === '1,1,2,3,4,↓,↑' && (n0.n9 === null || !n0.n9.sticker), JSON.stringify(n0.legs.map(l => l.text)));
  check('BLANK MEANS PRESS — a factory key carries no gesture, and dots\' 1 carries the LONG bar', n0.legs.slice(1).every(l => l.parts[0].g === '' && !l.parts[0].delay) && n0.legs[0].parts[0].g === 'long-bar', JSON.stringify(n0.legs.map(l => l.parts[0].g)));
  check('§ 11.6: every sticker is nowrap and flex-shrink 0 — it overhangs, it never compresses', n0.legs.every(l => l.sticker.ws === 'nowrap' && l.sticker.shrink === '0'), JSON.stringify(n0.legs.map(l => [l.sticker.ws, l.sticker.shrink])));
  check('… a single character is a circle: 18 × 18, radius 999', n0.legs.every(l => Math.abs(l.sticker.h - 18) < 0.5 && l.sticker.r === '999px') && Math.abs(n0.legs[1].sticker.w - 18) < 0.5, JSON.stringify(n0.legs[1].sticker));
  check('… the button binding does not show while keys are the kind shown', n0.binds6.some(b => b.kind === 'button') && n0.legs[5].parts.every(p => p.kind === 'key'), JSON.stringify(n0.legs[5].parts));
  // THE DELAY MARK (§ 7): with BUTTONS shown, the factory pin wears `3` —
  // button 3's press, never delayed — and unpin `3 ×2`. Put a TAP on pin
  // (the factory set until 2026-09-12) and it wears `3 tap ···`, delayed by
  // unpin's ×2 on the same button; the ×2 never wears the mark.
  const n1 = await rig.evaluate(() => { const H = window.__ba; H.showKind('button'); const bm = H.S._buttonMappings;
    const out = { leg6: H.legAt(6), leg7: H.legAt(7), leg2: H.legAt(2), leg4: H.legAt(4) };
    const was = bm.palette_6; bm.palette_6 = { btn: 3, g: 'tap' }; H.S._bindingsChanged();
    out.tap6 = H.legAt(6); out.tap7 = H.legAt(7);
    bm.palette_6 = was; H.S._bindingsChanged(); return out; });
  check('with BUTTONS shown, pin\'s sticker is button 3 — the press, blank gesture, no delay', n1.leg6.sticker?.kind === 'button' && n1.leg6.parts[0]?.src === '3' && n1.leg6.parts[0]?.g === '' && !n1.leg6.parts[0]?.delay, JSON.stringify(n1.leg6));
  check('a TAP on pin beside unpin\'s ×2 wears 3 tap with the DELAY MARK — the trap, drawn', n1.tap6.parts[0]?.src === '3' && n1.tap6.parts[0]?.g === 'tap' && n1.tap6.parts[0]?.delay === true, JSON.stringify(n1.tap6));
  check('… and NOT on unpin\'s ×2 on the same button', n1.leg7.parts[0]?.g === '×2' && !n1.leg7.parts[0]?.delay && !n1.tap7.parts[0]?.delay, JSON.stringify(n1.leg7.parts));
  check('… and not on button 1\'s tap (line at 2), which has no ×2 sibling', n1.leg2.parts[0]?.g === 'tap' && !n1.leg2.parts[0]?.delay, JSON.stringify(n1.leg2.parts));
  check('… and dub, with no button, wears the empty sticker: a dash, no parts, the learn cell', n1.leg4.sticker?.kind === 'button' && n1.leg4.text === '–' && n1.leg4.parts.length === 0, JSON.stringify(n1.leg4));
  // THE WIDEST STICKERS THE APP CAN EMIT (§ 11.6's table): a button's xlong
  // as a bar, a note's `127 tap`, a note's `127` with the long bar. All
  // under 53.
  const n2 = await rig.evaluate(() => { const H = window.__ba; const bm = H.S._buttonMappings; const was = bm.palette_4;
    bm.palette_4 = { btn: 3, g: 'xlong' }; H.S._bindingsChanged();
    const btn = H.legAt(4);
    bm.palette_4 = was; delete bm.palette_4; H.S._bindingsChanged();
    return { btn }; });
  check('button 3 xlong is `3` and the long bar, well under a tile', n2.btn.parts[0]?.src === '3' && n2.btn.parts[0]?.g === 'xlong-bar' && n2.btn.sticker.w < 53, JSON.stringify(n2.btn));
  await rig.evaluate(() => { localStorage.setItem('mubone_midi_map', JSON.stringify({ palette_4: { type: 'note', channel: 1, number: 127, g: 'tap' }, palette_5: { type: 'note', channel: 1, number: 127, g: 'xlong' } })); window.__ba.showKind('midi'); return true; });
  await rig.reload(); await installHelpers(rig);
  const n3 = await rig.evaluate(() => { const H = window.__ba; return { tap: H.legAt(4), xlong: H.legAt(5) }; });
  check('note 127 tap is `127 tap` — no `n` prefix — and fits the tile', n3.tap.parts[0]?.src === '127' && n3.tap.parts[0]?.g === 'tap' && n3.tap.sticker.w < 53, JSON.stringify(n3.tap));
  check('note 127 xlong is `127` and the long bar, and fits', n3.xlong.parts[0]?.src === '127' && n3.xlong.parts[0]?.g === 'xlong-bar' && n3.xlong.sticker.w < 53, JSON.stringify(n3.xlong));
  await rig.evaluate(() => { localStorage.removeItem('mubone_midi_map'); localStorage.removeItem('mubone_legend_kinds'); return true; });
  await rig.reload(); await installHelpers(rig);
  // THE SPACEBAR IS DRAWN, NOT TYPED (§ 6): `␣` renders from a fallback face
  // at the wrong advance, so the HAND TILE's sticker draws the 15×6 stroke
  // mark — no quick-access tile wears a spacebar, because space is the hand's.
  const n5 = await rig.evaluate(() => { const H = window.__ba;
    const svg = document.querySelector('#handKey .tile-binds .leg-space');
    return { svg: !!svg, box: svg ? { w: svg.getBoundingClientRect().width, h: svg.getBoundingClientRect().height } : null,
             glyph: /␣/.test(document.getElementById('handKey')?.textContent ?? ''), d: svg?.querySelector('path')?.getAttribute('d') ?? null }; });
  check('the hand tile\'s sticker draws the spacebar as the stroke mark and never the ␣ glyph', n5.svg && !n5.glyph && n5.d === 'M2 2v5h20V2', JSON.stringify(n5));
  check('… at 15×6', n5.box && Math.abs(n5.box.w - 15) < 1 && Math.abs(n5.box.h - 6) < 1, JSON.stringify(n5.box));
  await rig.evaluate(() => { const H = window.__ba; H.showKind('key'); H.factory(); });
  }

  // ── O. THE STICKER IS THE LEARN CELL (§ 6, § 11.4) ───────────────────────
  // One kind on the strip at a time — the keys page chooses — and the bed
  // is 71px whatever the kind: no rows, no reserved height. A bound tile's
  // sticker is the keys page's cell brought to the tile: click to relearn,
  // right-click to clear, Esc cancels; an unbound tile has no sticker and
  // is learned from the keys page.
  if (want('O')) {
  console.log('\n§ O the sticker is the learn cell');
  await rig.evaluate(() => { const H = window.__ba; H.factory(); H.showKind('key'); });
  const o0 = await rig.evaluate(() => { const H = window.__ba; const bed = () => +document.getElementById('paletteBed').getBoundingClientRect().height.toFixed(1);
    const one = { bed: bed(), n: H.tileAt(1).querySelectorAll('.tile-bind').length, leg7: H.legAt(6).text };
    H.showKind('button'); const two = { bed: bed(), n7: H.tileAt(6).querySelectorAll('.tile-bind').length, n4: H.tileAt(4).querySelectorAll('.tile-bind').length, leg7: H.legAt(6).text };
    H.showKind('midi'); const three = { bed: bed(), n: [1, 2, 3, 4, 5, 6, 7].map(n => H.tileAt(n).querySelectorAll('.tile-bind').length).join('') };
    H.showKind('key'); const back = { bed: bed() };
    return { one, two, three, back }; });
  check(`KEYS shown: one sticker, pin wears ↓; the bed is ${PAL.bed}px`, o0.one.n === 1 && o0.one.leg7 === '↓' && Math.abs(o0.one.bed - PAL.bed) < 0.5, JSON.stringify(o0.one));
  check(`BUTTONS shown: pin wears 3, dub the empty sticker; the bed is still ${PAL.bed} — no ledger, no reserved lines`, o0.two.n7 === 1 && o0.two.n4 === 1 && o0.two.leg7 === '3' && Math.abs(o0.two.bed - PAL.bed) < 0.5, JSON.stringify(o0.two));
  check(`NOTES shown: nothing bound, every tile wears the empty sticker (its learn cell), ${PAL.bed} still`, o0.three.n === '1111111' && Math.abs(o0.three.bed - PAL.bed) < 0.5 && Math.abs(o0.back.bed - PAL.bed) < 0.5, JSON.stringify(o0.three));
  const o1 = await rig.evaluate(async () => { const H = window.__ba; const wait = ms => new Promise(r => setTimeout(r, ms));
    H.legRow(4, 'key').click(); await wait(30);
    const armed = { learning: H.S._paletteLearning(), text: H.legAt(4).text, cls: H.legAt(4).sticker?.learning, keyLearning: H.S._isKeyLearning(), hand: H.hand(), active: !!H.S._gestureActive() };
    H.key('KeyJ'); await wait(60); H.key('KeyJ', 'keyup'); await wait(400);
    const learned = { km4: H.S._keyMappings.palette_4, leg: H.legAt(4).text, learning: H.S._paletteLearning() };
    H.legRow(4, 'key').click(); await wait(30); const armed2 = H.S._paletteLearning()?.id ?? null;
    H.legRow(4, 'key').click(); await wait(30); const toggledOff = H.S._paletteLearning();
    H.legRow(4, 'key').click(); await wait(30); H.key('Escape'); H.key('Escape', 'keyup'); await wait(30);
    const esc = { learning: H.S._paletteLearning(), leg: H.legAt(4).text };
    // A CHORD IS REFUSED for a palette position (Ek, 2026-09-12): the learn stays armed and says so.
    H.legRow(4, 'key').click(); await wait(30);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'K', shiftKey: true, bubbles: true, cancelable: true })); await wait(60);
    document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyK', key: 'K', shiftKey: true, bubbles: true, cancelable: true })); await wait(300);
    const chord = { learning: H.S._paletteLearning()?.id ?? null, km4: H.S._keyMappings.palette_4?.code ?? null };
    H.S._paletteLearnCancel();
    H.legRow(4, 'key').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })); await wait(30);
    const cleared = { km4: H.S._keyMappings.palette_4 ?? null, n: H.tileAt(4).querySelectorAll('.tile-bind').length };
    H.S._keyMappings.palette_4 = { type: 'key', key: '3', code: 'Digit3', shift: false, ctrl: false, meta: false, g: 'press' }; H.S._bindingsChanged();
    return { armed, learned, armed2, toggledOff, esc, chord, cleared }; });
  check('a click on dub\'s sticker arms the KEY learn on palette_4: it says … and pulses; nothing plays, the hand is untouched', o1.armed.learning?.id === 'palette_4' && o1.armed.learning?.kind === 'key' && o1.armed.text === '…' && o1.armed.cls === true && o1.armed.keyLearning && !o1.armed.active, JSON.stringify(o1.armed));
  check('the next key (J) lands on the position, the learn stands down, and the sticker wears J', o1.learned.km4?.code === 'KeyJ' && o1.learned.learning === null && /^j$/i.test(o1.learned.leg), JSON.stringify(o1.learned));
  check('clicking the sticker again cancels; Esc cancels too and the sticker shows its key again', o1.armed2 === 'palette_4' && o1.toggledOff === null && o1.esc.learning === null && /^j$/i.test(o1.esc.leg), JSON.stringify({ armed2: o1.armed2, off: o1.toggledOff, esc: o1.esc }));
  check('⇧K is REFUSED: the learn stays armed and the binding does not move', o1.chord.learning === 'palette_4' && o1.chord.km4 === 'KeyJ', JSON.stringify(o1.chord));
  check('a right-click on the sticker clears the binding: unbound, and the sticker stays as a dash so a click can learn again', o1.cleared.km4 === null && o1.cleared.n === 1, JSON.stringify(o1.cleared));
  // The button and note kinds learn through the same recogniser, from the
  // sticker of a tile that already has one of that kind — pin's button 3.
  const o2 = await rig.evaluate(async () => { const H = window.__ba; const wait = ms => new Promise(r => setTimeout(r, ms));
    H.showKind('button'); await wait(30);
    H.legRow(6, 'button').click(); await wait(30); const armedB = H.S._paletteLearning();
    H.S._dispatchButton(2, true); await wait(60); H.S._dispatchButton(2, false); await wait(400);
    const bm1 = H.S._buttonBindings().find(b => b.id === 'palette_6') ?? null; const legB = H.legAt(6).text;
    H.showKind('key'); H.factory();
    return { armedB, bm1, legB }; });
  check('with BUTTONS shown, pin\'s sticker arms the BUTTON learn; button 2 pressed lands on pin as a press', o2.armedB?.kind === 'button' && o2.bm1?.btn === 2 && o2.bm1?.g === 'press' && o2.legB === '2', JSON.stringify(o2));
  }

  // ── P. HUE IS IDENTITY (§ 11.2–11.3; the doc's "K") ────────────────────────
  // Every tile's glyph is computed in its family's --eng-* hue — the pin
  // tiles in bone — and no glyph renders --text-subtle; rest is surface-1.
  if (want('P')) {
  console.log('\n§ P hue is identity');
  await rig.evaluate(() => window.__ba.factory());
  const p0 = await rig.evaluate(() => { const H = window.__ba; const cs = getComputedStyle(document.body);
    const tok = k => { const d = document.createElement('i'); d.style.color = cs.getPropertyValue('--eng-' + k).trim(); document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; };
    const fam = { wide: 'lens', wash: 'grain', overdub: 'tape', line: 'tape', looper: 'tape', scrape: 'erase', pen: 'grain', unpin: 'pins', pin: 'pins' };
    const subtle = (() => { const d = document.createElement('i'); d.style.color = cs.getPropertyValue('--text-subtle').trim(); document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; })();
    const out = H.pal().map(id => { const svg = document.querySelector(`#paletteDock .tile[data-pal="${id}"] svg`); return { id, got: getComputedStyle(svg).color, want: tok(fam[id]) }; });
    const rest = getComputedStyle(document.querySelector('#paletteDock .tile[data-pal="line"]')).backgroundColor;
    const s1 = (() => { const d = document.createElement('i'); d.style.backgroundColor = cs.getPropertyValue('--surface-1').trim(); document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; })();
    return { out, subtle, rest, s1, hand: getComputedStyle(document.querySelector('#handKey svg')).color, handWant: tok(fam[H.hand()] ?? 'grain') }; });
  check('every tile\'s glyph is its family\'s --eng-* hue, the pin tiles bone', p0.out.every(o => o.got === o.want), JSON.stringify(p0.out.filter(o => o.got !== o.want)));
  check('no glyph renders --text-subtle', p0.out.every(o => o.got !== p0.subtle), p0.subtle);
  check('the hand tile\'s glyph too', p0.hand === p0.handWant, JSON.stringify({ got: p0.hand, want: p0.handWant }));
  check('a tile at rest is surface-1, not a wireframe', p0.rest === p0.s1, JSON.stringify({ rest: p0.rest, s1: p0.s1 }));
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
