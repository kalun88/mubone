#!/usr/bin/env node
/**
 * scripts/engine-audit.js — every control on every engine page actually moves
 * something (#268).
 *
 * Runs against a real Electron instance via scripts/lib/rig.js — no setup, no
 * server, no browser download.
 *   node scripts/engine-audit.js
 *   node scripts/rig-audit.js          # this plus the other suites, one boot
 *
 * ── Why this suite exists ──────────────────────────────────────────────────
 * The engine pages do NOT own their parameters. Every row writes through a
 * real element in the rig cabinet — `dur` sets `#gcDurSlider` and dispatches
 * `input`, and ui-presets.js's own handler is what reaches the engine. That is
 * deliberate (one owner per control, no second copy to desync — the cc-mirror
 * lesson), and it has one consequence that is invisible until it bites:
 *
 *   **Deleting or renaming a rig-view element silently kills a row.**
 *
 * `_knobRange()` returns null when the element is missing, `_knobFor()` then
 * returns null, and the row simply does not render — or renders and does
 * nothing. No error, no warning. Since #291 the rig view is not a screen at
 * all — `.top-bar` and `.right-panel` are a hidden CABINET nobody looks at —
 * so a row killed this way is invisible from both ends. Hence § C.
 *
 * ── What it checks, and why this shape ─────────────────────────────────────
 * For every tool and lens: open its page, then for every track and every
 * segmented option, snapshot the ENGINE STATE, drive the control, and require
 * the snapshot to change. Not the readout — the state. A row whose number
 * moves while the engine does not is the exact bug this is for.
 *
 * Two things the checks are careful about, both of which produced false
 * failures while this was being written:
 *
 *  · A track is driven to 28% and, only if nothing moved, to 72%. Driving it
 *    to A then B and comparing against the start reports a WORKING slider as
 *    dead whenever it happened to start at B.
 *  · A segmented row is clicked on an option that is NOT already active.
 *    Clicking the active one is correctly a no-op.
 *
 * The state snapshot has to include every store a param can land in —
 * `S.grainCurveType` and `S.grainDirection` are NOT inside `S.grainParams`,
 * and watching the wrong key reports a working control as dead. When a new
 * param lands somewhere new, add it to SNAP or this suite starts lying.
 *
 * Folded sections are OPENED first (#283). A collapsed section's rows have
 * zero width, so every param behind a fold would report inert — which would
 * make adding a disclosure look like breaking nine controls.
 *
 * ── Known-inert, on purpose ────────────────────────────────────────────────
 * Under the SPOT lens the radius-fade row is forced off and dimmed
 * (initRadiusFade: "when scope=nearest, fade is forced off — no radius to
 * fade"). Its options are legitimately no-ops there, so spot's fade row is
 * exempt rather than failing.
 */

const { launch } = require('./lib/rig');

// Everything a parameter can write to. Missing a store here makes a working
// control look dead — see the header.
const SNAP = `JSON.stringify({
  gp: S.grainParams, go: S.grainOverrides, tp: S.triggerParams, fx: S.fx,
   glink: S.grainLink,
  curve: S.grainCurveType, dir: S.grainDirection,
  r: S.searchRadiusDeg, n: S.recencyN, k: S.grainK,
  kAll: S.grainKAllMode, kSeq: S.grainKSeqMode, near: S.nearestMode,
  prob: S.grainProbability, flow: S.paintTicker && S.paintTicker.intervalMs,
  head: S.headWidthDeg, headEdge: S.headEdge,
  fade: S.radiusFadeEnabled, fadeC: S.radiusFadeCurve,
   eOld: S.eraseOldest, eStroke: S.eraseWholeStroke,
  comb: S.combAxis, keep: S.combKeep, 
  reads: S.lensReads,
  onEnd: S.traceMode,
})`;

const TARGETS = [
  ['tile', 'pen'], ['tile', 'wash'], ['tile', 'spray'], ['tile', 'comb'],
  ['tile', 'line'], ['tile', 'slice'], ['tile', 'looper'],
  ['tile', 'scrape'], ['tile', 'all'],
  ['lens', 'wide'], ['lens', 'spot'],
];
// The radius-fade row is inert wherever NEAREST is on — initRadiusFade forces
// it off, because nearest has no radius to fade against. That is a live state,
// not a property of the spot page: every lens page carries a `mode` row, and
// the suite drives it, so wide flips itself into nearest partway down its own
// sheet and fade is correctly a no-op from there. Whether it does depends on
// which way `mode` started, which depends on what ran before — so this was
// order-dependent, passing alone and failing inside rig-audit's single boot.
// Asking S at the moment of the click is the only version that is true.
const EXEMPT_WHEN_NEAREST = new Set(['fade']);

async function run(rig) {
  let pass = 0, fail = 0;
  const check = (name, ok, detail = '') => {
    if (ok) { pass++; console.log(`  ok   ${name}`); }
    else    { fail++; console.log(`  FAIL ${name}${detail ? '  — ' + detail : ''}`); }
  };

  await rig.evaluate(new Function(`return (async () => {
    const { S } = await import('./js/state.js');
    const wait = ms => new Promise(r => setTimeout(r, ms));
    window.__snap = () => ${SNAP};
    window.__near = () => !!S.nearestMode;
    await wait(700);
    document.getElementById('tcTools').click();
    await wait(300);
  })()`));

  console.log('\n§ A. every track moves engine state');
  const inertTracks = [], inertSegs = [];
  let tracks = 0, segs = 0;

  for (const [kind, id] of TARGETS) {
    const res = await rig.evaluate(new Function(`return (async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const sel = ${JSON.stringify(kind)} === 'tile'
        ? '#toolRail [data-tile="${id}"]' : '#toolRail [data-lens="${id}"]';
      const row = document.querySelector(sel);
      if (!row) return { missing: true };
      // THE ... IS THE DOOR (docs/PALETTE-GUI.md § 5.3, 2026-09-11): a rail
      // row has no click behaviour at all any more, so row.click() moved
      // nothing and this loop audited one tile's sheet nine times over —
      // every tile after the first reported its whole engine inert. The ...
      // handle is the one gesture that points the drawer without firing.
      // (No backticks in this comment: it lives inside a template literal.)
      row.querySelector('[data-more]')?.click();
      await wait(420);
      if (!document.body.classList.contains('prail-open')) {
        document.querySelector(sel)?.querySelector('[data-more]')?.click();
        await wait(300);
      }
      const pr = document.getElementById('propRail');
      // A FOLDED section's rows are zero-width, and a control you cannot land
      // on cannot be proved to work. The fold is a disclosure, not a dead
      // control, so the suite opens every one before it walks the rows —
      // otherwise adding a fold silently drops those params from coverage.
      for (const f of [...pr.querySelectorAll('[data-fold][aria-expanded="false"]')]) {
        f.click(); await wait(220);
      }
      const inert = [], inertSeg = [];
      let nT = 0, nS = 0;

      // Rows are re-queried by INDEX on every iteration, never held from a
      // list taken up front (#292). Driving a control re-renders the sheet
      // ~90 ms later, which detaches every node still in such a list — the
      // handlers keep working (they write to the cabinet, not to the node),
      // so a stale row is not obviously dead. What it does instead is LIE
      // about state: a stale octave capsule still shows the octave it had at
      // render time, the suite picks the first option not marked active, and
      // when that happens to be the octave the pitch has since moved to, the
      // click is a legitimate no-op and a working row reports inert. It
      // surfaced as filter.octave, and only because the filter page runs
      // last — the same race was live on every other page.
      const nTracks = pr.querySelectorAll('[data-ptrack]').length;
      for (let ti = 0; ti < nTracks; ti++) {
        const tr = pr.querySelectorAll('[data-ptrack]')[ti];
        if (!tr) break;
        nT++;
        const pid = tr.dataset.ptrack, rect = tr.getBoundingClientRect();
        if (rect.width < 4) { inert.push(pid + ' (zero width)'); continue; }
        const before = window.__snap();
        let moved = false;
        for (const f of [0.28, 0.72]) {
          const live = pr.querySelectorAll('[data-ptrack]')[ti] || tr;
          live.dispatchEvent(new PointerEvent('pointerdown', {
            clientX: rect.left + rect.width * f, clientY: rect.top + rect.height / 2,
            bubbles: true, detail: 0, buttons: 1 }));
          await wait(110);
          if (window.__snap() !== before) { moved = true; break; }
        }
        if (!moved) inert.push(pid);
      }

      const nSegs = pr.querySelectorAll('.prow--seg').length;
      for (let si = 0; si < nSegs; si++) {
        const seg = pr.querySelectorAll('.prow--seg')[si];
        if (!seg) break;
        const name = (seg.querySelector('.prow-n') || {}).textContent || '?';
        const opts = [...seg.querySelectorAll('.seg span, [data-lgroup], [data-arrscope], [data-combaxis], [data-combkeep], [data-efrom], [data-escope], [data-headedge]')];
        const target = opts.find(o => !o.classList.contains('on'));
        if (!target) continue;          // single-option row, or all active
        // Remember which option WAS on, to put it back: a grain tile
        // persists its sheet, so a choice left driven on the audit profile
        // (pen's \`on end\` at cloud) reached every suite launched after.
        const wasOn = opts.find(o => o.classList.contains('on'));
        const wasKV = wasOn && Object.entries(wasOn.dataset)[0];
        nS++;
        const before = window.__snap();
        target.click();
        await wait(110);
        // Asked AFTER the click: the row that turned nearest on may be this
        // one, and a row is exempt for the state it leaves behind.
        const exempt = ${JSON.stringify([...EXEMPT_WHEN_NEAREST])}.includes(name.trim()) && window.__near();
        if (window.__snap() === before && !exempt) inertSeg.push(name);
        if (wasKV) {
          const fresh = pr.querySelectorAll('.prow--seg')[si];
          const back = fresh && fresh.querySelector('[data-' + wasKV[0].toLowerCase() + '="' + wasKV[1] + '"]');
          if (back && !back.classList.contains('on')) { back.click(); await wait(60); }
        }
      }

      // ── Switches (2026-09-07) ────────────────────────────────────────────
      // The four booleans that used to wear on|off segments are switches
      // now, so the loop above no longer reaches them — and a row that stops
      // being audited is exactly how a dead control survives. Click each one
      // twice: the state must move BOTH ways, which a segment could not be
      // asked (clicking the option already on is a no-op) and which is the
      // real question for a toggle.
      const sws = [...pr.querySelectorAll('.prow--sw')];
      for (const row of sws) {
        const name = (row.querySelector('.prow-n') || {}).textContent || '?';
        const btn = row.querySelector('.ds-sw');
        if (!btn) continue;
        nS++;
        const a = window.__snap();
        btn.click(); await wait(120);
        const b = window.__snap();
        const live = pr.querySelector('.prow--sw [data-sw="' + (btn.dataset.sw || '') + '"], .prow--sw [data-swproxy="' + (btn.dataset.swproxy || '') + '"]') || btn;
        live.click(); await wait(120);
        const c = window.__snap();
        if (a === b || b === c) inertSeg.push(name.trim() + ' (switch)');
      }

      return { nT, nS, inert, inertSeg };
    })()`));

    if (res.missing) { check(`${id} — page opens`, false, 'tool not in the rail'); continue; }
    tracks += res.nT; segs += res.nS;
    const deadT = res.inert;
    const deadS = res.inertSeg;
    check(`${id} — ${res.nT} tracks all move state`, deadT.length === 0, deadT.join(', '));
    check(`${id} — ${res.nS} choices all move state`, deadS.length === 0, deadS.join(', '));
    inertTracks.push(...deadT.map(p => `${id}.${p}`));
    inertSegs.push(...deadS.map(p => `${id}.${p}`));
  }

  console.log(`\n§ B. coverage`);
  check('every engine page rendered at least one control', tracks + segs > 0);
  check(`${tracks} tracks and ${segs} choices exercised`, tracks >= 50 && segs >= 30,
        `got ${tracks}/${segs} — a page may have stopped rendering rows`);

  // ── B2. the ± spread has a control of its own ────────────────────────────
  // Ek, 2026-09-06: ⌥ is the cursor LOCK (events.js), and the spread used to
  // be ⌥-drag on the track, so the two fought over one key — and a modifier
  // gesture on a track is invisible besides. The spread is set by dragging
  // its own cell, the way every DAW's number field works. This checks the
  // gesture end to end on a real sheet: the cell writes, the band follows it
  // up from zero, shift is the fine drag, a double-click clears it, a click
  // without movement still types, and ⌥ on the track is just a drag now.
  console.log('\n§ B2. the ± spread is set by its own cell');
  const spr = await rig.evaluate(new Function(`return (async () => {
    const { S } = await import('./js/state.js');
    const wait = ms => new Promise(r => setTimeout(r, ms));
    // The rail's own road, the one § A uses: the row's ⋯ opens its drawer.
    const sel = '#toolRail [data-tile="pen"]';
    document.querySelector(sel)?.querySelector('[data-more]')?.click();
    await wait(420);
    if (!document.body.classList.contains('prail-open')) {
      document.querySelector(sel)?.querySelector('[data-more]')?.click();
      await wait(400);
    }
    const pr = document.getElementById('propRail');
    for (const f of [...pr.querySelectorAll('[data-fold][aria-expanded="false"]')]) { f.click(); await wait(200); }
    const spread = pr.querySelector('[data-pval="durVar"]');
    const track  = pr.querySelector('[data-ptrack="dur"]');
    const value  = pr.querySelector('[data-pval="dur"]');
    if (!spread || !track || !value)
      return { cells: false, saw: [...pr.querySelectorAll('[data-ptrack]')].map(t => t.dataset.ptrack).join(',') };
    const raw = id => +document.getElementById(id).value;
    const band = () => { const b = track.querySelector('.prow-band'); return b ? { w: parseFloat(b.style.width) || 0, shown: b.style.display !== 'none' } : null; };
    const r = spread.getBoundingClientRect();
    const ev = (el, type, x, opts) => el.dispatchEvent(new PointerEvent(type, Object.assign({ clientX: x, clientY: r.top + r.height / 2, bubbles: true, buttons: type === 'pointerup' ? 0 : 1, button: 0, detail: 0, pointerId: 11 }, opts || {})));

    // From zero: the drag writes, and the band appears with it.
    document.getElementById('gcDurVarSlider').value = 0;
    document.getElementById('gcDurVarSlider').dispatchEvent(new Event('input', { bubbles: true }));
    await wait(150);
    const v0 = raw('gcDurVarSlider');
    ev(spread, 'pointerdown', r.left + 10); ev(spread, 'pointermove', r.left + 90);
    await wait(150); ev(spread, 'pointerup', r.left + 90);
    await wait(220);
    const out = { cells: true, from0: v0, afterDrag: raw('gcDurVarSlider'), bandUp: band() };

    // Shift is the fine drag: the same travel, a quarter of the move.
    const v1 = raw('gcDurVarSlider');
    ev(spread, 'pointerdown', r.left + 10);
    ev(spread, 'pointermove', r.left + 90, { shiftKey: true });
    await wait(150); ev(spread, 'pointerup', r.left + 90);
    await wait(220);
    out.coarse = out.afterDrag - out.from0;
    out.fine = raw('gcDurVarSlider') - v1;

    // Double-click clears it; the band goes with it.
    spread.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.left + 20, clientY: r.top + 5 }));
    await wait(240);
    out.cleared = raw('gcDurVarSlider');
    out.bandGone = band();
    out.zeroClass = spread.classList.contains('zero');

    // A click that does not move still puts the caret in.
    ev(spread, 'pointerdown', r.left + 10); ev(spread, 'pointermove', r.left + 11); ev(spread, 'pointerup', r.left + 11);
    spread.focus(); out.typeable = document.activeElement === spread; spread.blur();
    await wait(150);

    // ⌥ on the track writes the VALUE, like any drag — never the spread.
    const dv = raw('gcDurVarSlider'), val = raw('gcDurSlider');
    const tr = track.getBoundingClientRect();
    track.dispatchEvent(new PointerEvent('pointerdown', { clientX: tr.left + tr.width * 0.8, clientY: tr.top + tr.height / 2, bubbles: true, buttons: 1, altKey: true, detail: 0, pointerId: 12 }));
    await wait(240);
    out.altSpread = raw('gcDurVarSlider') - dv;
    out.altValue  = raw('gcDurSlider') !== val;

    // And the value's own cell scrubs the same way.
    const val1 = raw('gcDurSlider'), vr = value.getBoundingClientRect();
    value.dispatchEvent(new PointerEvent('pointerdown', { clientX: vr.left + 5, clientY: vr.top + 5, bubbles: true, buttons: 1, button: 0, detail: 0, pointerId: 13 }));
    value.dispatchEvent(new PointerEvent('pointermove', { clientX: vr.left + 65, clientY: vr.top + 5, bubbles: true, buttons: 1, pointerId: 13 }));
    await wait(150);
    value.dispatchEvent(new PointerEvent('pointerup', { clientX: vr.left + 65, clientY: vr.top + 5, bubbles: true, buttons: 0, pointerId: 13 }));
    await wait(220);
    out.valueScrubbed = raw('gcDurSlider') !== val1;
    return out;
  })()`));
  check('the sheet has a spread cell beside its value', spr.cells === true, spr.saw || '');
  if (spr.cells) {
    check('dragging the cell writes the spread, up from zero', spr.afterDrag > spr.from0, `${spr.from0} → ${spr.afterDrag}`);
    check('… and the band appears with it', spr.bandUp && spr.bandUp.shown && spr.bandUp.w > 0, JSON.stringify(spr.bandUp));
    check('shift is the fine drag — a quarter of the same travel',
          spr.fine > 0 && Math.abs(spr.fine / spr.coarse - 0.25) < 0.05, `coarse ${spr.coarse}, fine ${spr.fine}`);
    check('double-clicking the cell clears the spread', spr.cleared === 0, String(spr.cleared));
    check('… and the band goes with it', spr.bandGone && !spr.bandGone.shown && spr.zeroClass === true, JSON.stringify(spr.bandGone));
    check('a click that does not move still types', spr.typeable === true);
    check('⌥ on the track is a plain drag: the value moves, the spread does not',
          spr.altSpread === 0 && spr.altValue === true, `spread ${spr.altSpread}, value moved ${spr.altValue}`);
    check('the value cell scrubs too', spr.valueScrubbed === true);
  }

  console.log('\n§ C. the cabinet dependency');
  const dep = await rig.evaluate(new Function(`return (async () => {
    // Every 'slider' and 'seg' param points at a cabinet element by id. The
    // cabinet is display:none (#291), so a missing id silently drops its row
    // and there is no screen left on which anyone would notice. Naming them
    // out loud is the whole point: moving a control family out of the cabinet
    // is safe exactly as long as this stays green.
    const { S } = await import('./js/state.js');
    const src = await fetch('./js/tiles.js').then(r => r.text());
    // The boundary matters: without it \`label:\` ends in \`el:\` and every
    // human-readable label is scooped up as an element id.
    const ids = [...src.matchAll(/[\\s{,](?:el|seg|num):\\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1]);
    const uniq = [...new Set(ids)];
    return { total: uniq.length, missing: uniq.filter(i => !document.getElementById(i)) };
  })()`));
  check(`all ${dep.total} rig elements the engine pages write through exist`,
        dep.missing.length === 0, dep.missing.join(', '));

  console.log('\n§ D. a grain tile owns its whole block');
  // "If I see that slider in that position, it's set" (Ek, 2026-09-03).
  // Factory grain tiles used to apply NOTHING to the sound on arming — pen's
  // sheet showed whatever the last tool left in the live block — and their
  // edits died on reload. Now every grain tile carries a full block: edit
  // pen, arm spray and the block must change to spray's; arm pen
  // and the edit must be back; and it must be on disk. The edit is made by
  // writing the CABINET element the way a pot would reach it, not through a
  // sheet row, because the sheet's rows always captured — the pot path is the
  // one that never did.
  const own = await rig.evaluate(new Function(`return (async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const BV = await import('./js/brush-voicing.js');
    const block = () => JSON.stringify(BV.resolveGrainParams());
    // "Arming" is gone; what this needs is the tile's block in the live
    // controls, which is what pointing the DRAWER at it does (tiles.js
    // pickTile applies the block — the sheet's tile owns it).
    const arm = async id => { document.querySelector('#toolRail [data-tile="' + id + '"] [data-more]')?.click(); await wait(520); };
    await arm('spray');
    await arm('pen');
    const el = document.getElementById('gcPitchShiftSlider');
    const target = String(el.value) === String(el.min) ? el.max : el.min;
    el.value = target;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(700);                      // the 10 Hz poll + the 250 ms capture
    const sprayEdited = block();
    await arm('spray');
    const spray = block();
    await arm('pen');
    const sprayAgain = block();
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem('mubone_tiles') || '{}').pen?.params?.pitch ?? null; } catch (_) {}
    return { moved: sprayEdited !== spray, remembered: sprayAgain === sprayEdited,
             stored: String(stored) === String(target), storedVal: stored, target };
  })()`));
  check('arming another grain tile changes the sound block to that tile\'s', own.moved);
  check('arming the edited tile brings its edit back', own.remembered);
  check('a pot-path edit is on disk under the tile', own.stored, `stored ${own.storedVal}, wanted ${own.target}`);

  check('no renderer errors after exercise', rig.errors().length === 0, rig.errors().join(' | '));

  console.log(`\n${pass} ok · ${fail} failed`);
  if (inertTracks.length) console.log('inert tracks:', inertTracks.join(', '));
  if (inertSegs.length)   console.log('inert choices:', inertSegs.join(', '));
  return fail;
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    const rig = await launch();
    let fail = 1;
    try { fail = await run(rig); } finally { await rig.close(); }
    process.exit(fail ? 1 : 0);
  })().catch(e => { console.error(e); process.exit(1); });
}
