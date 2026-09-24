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
  kAll: (S.grainOverrides.k ?? S.grainParams.k) === 0, kSeq: S.grainKSeqMode, near: S.lensMode === 'nearest',
  prob: S.grainProbability, flow: S.paintTicker && S.paintTicker.intervalMs,
  head: S.headWidthDeg, headEdge: S.headEdge,
  fade: S.radiusFadeEnabled, fadeC: S.radiusFadeCurve,
   eOld: S.eraseOldest, eStroke: S.eraseWholeStroke,
  comb: S.combAxis, keep: S.combKeep, 
  reads: S.lensReads,
  onEnd: S.traceMode,
})`;

// THE SHEET IS THE ENGINE'S VOICE (2026-09-24): one sheet per instrument — the
// rows of VOICE_PIDS, the live block — opened from the door on the VOICE line
// of the instrument's tab. The presets listed under that line RECALL onto it
// and have no sheet of their own (they had one each from 2026-09-22 to 09-24,
// and before that nine tool pages went with the shape presets). The tabs' own
// rows and the cursor section write through the same cabinet, and are the
// lens and palette suites' to drive.
const TARGETS = [
  ['engine', 'granular'], ['engine', 'tape'],
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
    const T = await import('./js/tiles.js');
    const wait = ms => new Promise(r => setTimeout(r, ms));
    window.__snap = () => ${SNAP};
    // An engine's sheet: its instrument's tab, then the VOICE line's door.
    // The door TOGGLES, so it is pressed only when the drawer is not already
    // showing this engine.
    window.__openSheet = async eng => {
      T.setInstrument(eng); T.render(); await wait(150);
      const door = document.querySelector('#toolRail [data-more][data-sheet="' + eng + '"]');
      if (!door) return false;
      if (document.body.classList.contains('prail-open') && door.classList.contains('open')) return true;
      door.click(); await wait(420);
      return document.body.classList.contains('prail-open');
    };
    // TAKE a preset by name: its row's click recalls it onto the live block.
    window.__takeVoice = async name => {
      for (const eng of ['granular', 'tape']) {
        T.setInstrument(eng); T.render(); await wait(150);
        const row = [...document.querySelectorAll('#toolRail [data-voice]')]
          .find(r => (r.querySelector('.tile-nm') || {}).textContent?.trim() === name);
        if (!row) continue;
        row.click(); await wait(420);
        return true;
      }
      return false;
    };
    window.__near = () => (S.lensMode === 'nearest');
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
      if (!(await window.__openSheet(${JSON.stringify(id)}))) return { missing: true };
      const pr = document.getElementById('propRail');
      // A FOLDED section's rows are zero-width, and a control you cannot land
      // on cannot be proved to work. The fold is a disclosure, not a dead
      // control, so the suite opens every one before it walks the rows —
      // otherwise adding a fold silently drops those params from coverage.
      for (const f of [...pr.querySelectorAll('[data-fold][aria-expanded="false"]')]) {
        f.click(); await wait(220);
      }
      // The FILTER section is shut while its switch is off (2026-09-24) and
      // its rows are not in the DOM at all. Switch it on so cutoff, res and
      // type are walked; the switch loop below still exercises it both ways.
      const shut = pr.querySelector('.ds-sec--shut .ds-sw');
      if (shut) { shut.click(); await wait(220); }
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
        const pid = tr.dataset.ptrack;
        let rect = tr.getBoundingClientRect();
        // The drawer may still be opening when a new instrument's sheet lands:
        // give it one beat before calling a track zero-width.
        if (rect.width < 4) { await wait(350); rect = (pr.querySelectorAll('[data-ptrack]')[ti] || tr).getBoundingClientRect(); }
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
      // A switch is a row's (.prow--sw) or a heading's (.ds-sec-h--sw: the
      // filter's, since 2026-09-24) — both wear .ds-sw.
      const sws = [...pr.querySelectorAll('.prow--sw, .ds-sec-h--sw')];
      for (const row of sws) {
        const name = (row.querySelector('.prow-n, span') || {}).textContent || '?';
        const btn = row.querySelector('.ds-sw');
        if (!btn) continue;
        nS++;
        const a = window.__snap();
        btn.click(); await wait(120);
        const b = window.__snap();
        // Re-found after the click: a switch re-renders its sheet (setWet →
        // renderProps), so \`btn\` is a detached node by now and a click on
        // it goes nowhere — the wet switch has neither data-sw nor
        // data-swproxy, so the lookup below fell through to the dead node.
        const key = Object.keys(btn.dataset)[0];
        const live = (key && pr.querySelector('.prow--sw [data-' + key.toLowerCase() + '="' + btn.dataset[key] + '"], .ds-sec-h--sw [data-' + key.toLowerCase() + '="' + btn.dataset[key] + '"]')) || btn;
        live.click(); await wait(120);
        const c = window.__snap();
        // The same exemption the segment loop has: under NEAREST the fade
        // switch is forced off, so both clicks are legitimate no-ops there.
        const exempt = ${JSON.stringify([...EXEMPT_WHEN_NEAREST])}.includes(name.trim()) && window.__near();
        if ((a === b || b === c) && !exempt) inertSeg.push(name.trim() + ' (switch)');
      }

      return { nT, nS, inert, inertSeg };
    })()`));

    if (res.missing) { check(`${id} — page opens`, false, 'no door on its VOICE line'); continue; }
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
  // Two engine sheets since 2026-09-24: grain 9 tracks + 6 choices (four
  // capsules, the link and filter switches; cutoff ± is a band and slope a
  // bare number since that day), tape 3 + 2. The floor sits just under that,
  // so a sheet that stops rendering rows fails.
  check(`${tracks} tracks and ${segs} choices exercised`, tracks >= 11 && segs >= 7,
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
    // The rail's own road, the one § A uses: the grain engine's sheet.
    await window.__openSheet('granular');
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

    // A click that does not move opens the edit with the DIGITS selected, the
    // unit left standing, so the next keystroke replaces the value (Ek,
    // 2026-09-23: a bare caret made typing a number "really finicky"). A
    // second click on the cell being edited places the caret instead.
    const click = (el, x) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: r.top + r.height / 2, button: 0, detail: 1 }));
    ev(value, 'pointerdown', r.left + 10); ev(value, 'pointermove', r.left + 11); ev(value, 'pointerup', r.left + 11); click(value, r.left + 11);
    out.typeable = document.activeElement === value;
    out.selected = value.value.slice(value.selectionStart, value.selectionEnd);
    out.shown = value.value;
    value.setSelectionRange(0, 0);
    ev(value, 'pointerdown', r.left + 10); ev(value, 'pointerup', r.left + 10); click(value, r.left + 10);
    out.caretKept = value.selectionStart === 0 && value.selectionEnd === 0;
    value.blur();
    await wait(150);

    // ⌥ on the track writes the VALUE, like any drag — never the spread.
    // Pressed on the far side from the handle: just outside the handle is the
    // band's EDGE since 2026-09-23, and that press would open the spread.
    const dv = raw('gcDurVarSlider'), val = raw('gcDurSlider');
    const tr = track.getBoundingClientRect();
    const handleF = () => parseFloat(track.querySelector('.prow-h').style.left) / 100;
    const farX = () => tr.left + tr.width * (handleF() < 0.5 ? 0.85 : 0.15);
    track.dispatchEvent(new PointerEvent('pointerdown', { clientX: farX(), clientY: tr.top + tr.height / 2, bubbles: true, buttons: 1, altKey: true, detail: 0, pointerId: 12 }));
    await wait(240);
    out.altSpread = raw('gcDurVarSlider') - dv;
    out.altValue  = raw('gcDurSlider') !== val;
    track.dispatchEvent(new PointerEvent('pointerup', { clientX: farX(), clientY: tr.top + tr.height / 2, bubbles: true, buttons: 0, pointerId: 12 }));
    await wait(100);

    // THE BAND'S EDGE SETS THE SPREAD (Ek, 2026-09-23): the two-thumb range
    // every DAW draws. With the spread at zero the edge IS the zone just
    // outside the handle; pull outward from there and the band opens, the
    // value stays, the ± cell follows. Pull back in and it closes.
    spread.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.left + 20, clientY: r.top + 5 }));
    await wait(240);
    const v2 = raw('gcDurSlider'), hx = tr.left + tr.width * handleF();
    const dir = handleF() < 0.5 ? 1 : -1;
    const tev = (type, x) => track.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: tr.top + tr.height / 2, bubbles: true, buttons: type === 'pointerup' ? 0 : 1, button: 0, detail: 0, pointerId: 14 }));
    tev('pointerdown', hx + dir * 6); tev('pointermove', hx + dir * 40); await wait(150); tev('pointerup', hx + dir * 40);
    await wait(240);
    out.edgeSpread = raw('gcDurVarSlider');
    out.edgeValueKept = raw('gcDurSlider') === v2;
    out.edgeCell = spread.value;
    out.edgeBand = band();
    tev('pointerdown', hx + dir * 40); tev('pointermove', hx + dir * 4); await wait(150); tev('pointerup', hx + dir * 4);
    await wait(240);
    out.edgeClosed = raw('gcDurVarSlider');

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
    check('a click that does not move opens the edit', spr.typeable === true);
    check('… with the digits selected and the unit left standing',
          /^-?\d+(\.\d+)?$/.test(spr.selected) && spr.shown.trim().length > spr.selected.length,
          `selected "${spr.selected}" of "${spr.shown}"`);
    check('… and a click on the cell being edited places the caret', spr.caretKept === true);
    check('⌥ on the track is a plain drag: the value moves, the spread does not',
          spr.altSpread === 0 && spr.altValue === true, `spread ${spr.altSpread}, value moved ${spr.altValue}`);
    check('the value cell scrubs too', spr.valueScrubbed === true);
    check('dragging the band\'s edge outward opens the spread, the value staying put',
          spr.edgeSpread > 0 && spr.edgeValueKept === true, `spread ${spr.edgeSpread}, value kept ${spr.edgeValueKept}`);
    check('… the ± cell and the band follow it', !spr.edgeCell?.startsWith('0') && spr.edgeBand?.shown && spr.edgeBand.w > 0, `cell "${spr.edgeCell}" band ${JSON.stringify(spr.edgeBand)}`);
    check('… and pulling the edge back in closes it', spr.edgeClosed < spr.edgeSpread, `${spr.edgeSpread} → ${spr.edgeClosed}`);
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


  console.log('\n§ C2. a refusal the performer cannot see is a silent failure');
  // The recording budget is the case that forced this (2026-09-13). When the
  // live buffers hold `recLimitSeconds` of audio, startLiveRecording REFUSES —
  // the press records nothing and paints nothing — and every warning it had
  // (80%, 95%, the refusal) was written to `#vmBuffers`, inside `.hud`, which
  // `body .hud { display: none }` has hidden since the one-screen layout. A
  // 14-minute continuous-play test walked into it at ~13.5 minutes and
  // deposited nothing for the rest of the run, with nothing on screen to say
  // why. Any state that STOPS THE INSTRUMENT RESPONDING has to reach a box a
  // performer can actually see; this asserts that for the budget, by measuring
  // the element rather than trusting that it exists.
  const budget = await rig.evaluate(new Function(`return (async () => {
    const { S, perf } = await import('./js/state.js');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const read = () => {
      const el = document.getElementById('tcStats');
      if (!el) return { text: '', w: 0, h: 0, shown: false };
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return { text: (el.textContent || '').trim(), w: Math.round(r.width), h: Math.round(r.height),
               shown: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 };
    };
    const bar = () => {
      const t = document.getElementById('tcRec'), f = document.getElementById('tcRecFill');
      if (!t || !f) return { w: 0, fill: null, cls: null };
      const tr = t.getBoundingClientRect(), fr = f.getBoundingClientRect();
      const cs = getComputedStyle(t);
      return { w: Math.round(tr.width), h: Math.round(tr.height), fill: +fr.width.toFixed(1),
               cls: f.className, shown: cs.display !== 'none' && tr.width > 0 && tr.height > 0 };
    };
    const keepRec = perf.recTotalSec, keepAlt = S.altLocked;
    S.altLocked = false;
    perf.recTotalSec = 0;                        await sleep(420); const quiet = { ...read(), bar: bar() };
    perf.recTotalSec = S.recLimitSeconds * 0.5;  await sleep(420); const half  = { ...read(), bar: bar() };
    perf.recTotalSec = S.recLimitSeconds * 0.85; await sleep(420); const warn  = { ...read(), bar: bar() };
    perf.recTotalSec = S.recLimitSeconds;        await sleep(420); const full  = { ...read(), bar: bar() };
    perf.recTotalSec = keepRec; S.altLocked = keepAlt; await sleep(420);
    return { quiet, half, warn, full };
  })()`));
  check('the budget bar is on screen with real size',
        budget.quiet.bar.shown && budget.quiet.bar.w > 0 && budget.quiet.bar.h > 0,
        JSON.stringify(budget.quiet.bar));
  check('it is empty at nothing recorded and full at the ceiling',
        budget.quiet.bar.fill === 0 && Math.abs(budget.full.bar.fill - budget.full.bar.w) < 1.5,
        JSON.stringify({ at0: budget.quiet.bar.fill, atLim: budget.full.bar.fill, w: budget.full.bar.w }));
  check('it tracks the level in between',
        Math.abs(budget.half.bar.fill - budget.half.bar.w / 2) < 1.5,
        JSON.stringify(budget.half.bar));
  check('it turns at 80% and again at 95%',
        budget.half.bar.cls === 'tc-rec-fill' && /warn/.test(budget.warn.bar.cls),
        JSON.stringify({ half: budget.half.bar.cls, warn: budget.warn.bar.cls }));
  check('no words until the instrument actually refuses',
        budget.quiet.text === '' && budget.warn.text === '', JSON.stringify([budget.quiet.text, budget.warn.text]));
  check('at the limit it says what to do, in a box with real size',
        /sweep/.test(budget.full.text) && budget.full.shown && budget.full.w > 0,
        JSON.stringify(budget.full));
  console.log('\n§ D. a preset is a recall, the engine keeps the edit');
  // Ek, 2026-09-24: "pressing the preset just moves the sliders on the main
  // sheet" — real presets, Ableton's rule. Taking a preset moves the live
  // block; an edit afterwards is the ENGINE's (stored under its tool in
  // mubone_tiles), the preset stays as saved and its row wears the ring;
  // taking it again puts the sliders back. The edit is made by writing the
  // CABINET element the way a pot would reach it, not through a sheet row —
  // the pot path is the one that has to be captured by the poll.
  const own = await rig.evaluate(new Function(`return (async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const BV = await import('./js/brush-voicing.js');
    const block = () => JSON.stringify(BV.resolveGrainParams());
    const take = async name => { await window.__takeVoice(name); await wait(300); };
    const washRow = () => [...document.querySelectorAll('#toolRail [data-voice]')]
      .find(r => (r.querySelector('.tile-nm') || {}).textContent?.trim() === 'wash');
    const storedWash = () => { try { const v = JSON.parse(localStorage.getItem('mubone_sounds') || '{}').v || {};
      return Object.values(v).find(x => x.name === 'wash')?.params?.pitch ?? null; } catch (_) { return null; } };
    const storedTool = () => { try { return JSON.parse(localStorage.getItem('mubone_tiles') || '{}').granular?.params?.pitch ?? null; } catch (_) { return null; } };
    await take('glitch');
    const glitch = block();
    await take('wash');
    const wash = block();
    const washStoredBefore = storedWash();
    const ringBefore = !!washRow()?.classList.contains('edited');
    const el = document.getElementById('gcPitchShiftSlider');
    const target = String(el.value) === String(el.min) ? el.max : el.min;
    el.value = target;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(700);                      // the 10 Hz poll + the 250 ms capture
    const edited = block();
    const ringAfter = !!washRow()?.classList.contains('edited');
    const washStoredAfter = storedWash();
    const toolStored = storedTool();
    await take('wash');
    const back = block();
    const ringBack = !!washRow()?.classList.contains('edited');
    return { moved: wash !== glitch, changed: edited !== wash, ringBefore, ringAfter, ringBack,
             presetKept: String(washStoredAfter) === String(washStoredBefore),
             toolHasEdit: String(toolStored) === String(target), toolStored, target,
             reverted: back === wash };
  })()`));
  check('taking another preset moves the live block', own.moved);
  check('a pot edit moves the live block and leaves the preset as saved', own.changed && own.presetKept);
  check('the edited preset\'s row wears the ring, and only then', !own.ringBefore && own.ringAfter && !own.ringBack,
        JSON.stringify({ before: own.ringBefore, after: own.ringAfter, back: own.ringBack }));
  check('the engine keeps the edit on disk under its tool', own.toolHasEdit, `stored ${own.toolStored}, wanted ${own.target}`);
  check('taking the preset again puts the sliders back', own.reverted);

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
