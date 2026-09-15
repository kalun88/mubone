// ============================================================================
// ui-pins.js — the PINNED rail, permanently on the right
//
// Everything here plays off-cursor: the lens reads the scratch layer, the rail
// is the rest. There are exactly two rows, derived from what is pinned — the
// CLOUDS and the LOOPS — each with mute and solo, each absent when it holds
// nothing. Nothing files a pin anywhere; its kind is its group (js/pins.js).
//
// Every PIN has the same two buttons as its group (2026-09-05): M is its mute,
// S is its solo, and tapping the row body is the mute too — the big target
// does the common thing, the M lights to show it. The old row was one on/off
// button whose "mute" landed at the loop boundary; both halves of that are
// gone (js/pins.js on why). A row reads faint when the pin is NOT SOUNDING —
// that is derived from the four flags and is what you hear, so a pin under a
// group mute or somebody else's solo reads faint with its own M unlit.
//
// The SELECTED pin — the one unpin will take, nearest or oldest by Settings →
// Pins — carries the rail's radio mark, a half moon at the left edge in the
// row's hue (docs/DESIGN-SYSTEM.md § 5: one of these).
//
// THE SLOT TRACKER sits under the header (2026-09-14): one cell per slot, a
// filled cell in its pin's ENGINE hue, and the max typeable beside them. It
// answers "how much room is left" without counting rows, which matters now that
// one pin press can take several slots at once. The max is `S.commitSlotCount`
// and this is a second door onto it, not a second copy — Settings → Pins holds
// the same number on a slider, and each refreshes the other.
//
// EACH CELL CARRIES ITS PIN'S NUMBER, and it is the SAME number the row below
// it wears (Ek, 2026-09-14: "have it more informationally consistent with the
// actual loop number or cloud number"). A pin is named by its SLOT — `loop 3`
// is the pin in slot 3, clouds and loops sharing one sequence because they
// share one pool — so the cell's position was already the answer and only the
// counting was left to the eye. The digit is `_pinName`'s, not a second
// derivation. The SELECTED pin — the one unpin will take — is ringed here too,
// off the same `selectedPinSlot` the rail's half-moon reads, so the two marks
// can never point at different pins; under the default mode that is the pin
// nearest the cursor, and under `oldest` / `farthest` it still says what unpin
// will actually take rather than a second opinion about "closest".
//
// Rendering only. All behaviour is js/pins.js. DOM work never happens on the
// scheduler tick: the gate sets S._pinsDirty and this repaints on its own
// ~6 Hz timer. The selection mark moves without a rebuild.
// ============================================================================

import { S } from './state.js';
import { GROUPS, toggleGroup, toggleSolo, pinsIn, togglePinMute, togglePinSolo,
         selectedPinSlot, applyMix, isPinLeaving, groupOf } from './pins.js';
import { isCommitOn } from './composer.js';

// The overdub tool's own glyph (js/tiles.js G.overdub), inlined the way the pin
// glyphs below are. THE MASTER IS MARKED WITH THE TOOL'S OWN MARK (Ek,
// 2026-09-15): the selection ring is neutral and says "unpin takes this"; this
// says "a dub would join this", which is a different question about a different
// pin, and a hue could not carry it — every loop cell is ALREADY filled in the
// tape hue, so a tape-coloured mark on a loop is invisible by construction.
const OVD_G = '<path d="M12 4a8 8 0 1 1-7.1 4.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 8.5a3.5 3.5 0 1 1-3.1 1.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>';

const PIN_G = {
  cloud: '<circle cx="12" cy="12" r="1.5"/><circle cx="6.6" cy="8.2" r="1"/><circle cx="7.6" cy="16.8" r="1"/><circle cx="17.4" cy="7.8" r="1"/><circle cx="16.6" cy="16.4" r="1"/>',
  loop:  '<path d="M3 16c3-7 6-9 9-5s6 2 9-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
};

function _pinName(c) {
  return (c.type === 'cloud' ? 'cloud ' : 'loop ') + (c.slotIndex + 1);
}

/** A dot per overdub on a loop's row (docs/archive/OVERDUB-PLAN.md § 2.5). */
function _ovdDots(c) {
  const n = c.overdubs?.length | 0;
  return n ? `<span class="lyr-ovd" title="${n} overdub${n === 1 ? '' : 's'}">${'<i></i>'.repeat(n)}</span>` : '';
}

function _pinPos(c) {
  const lon = c.anchorLon ?? c.lon ?? 0, lat = c.anchorLat ?? c.lat ?? 0;
  const az = Math.round(((lon * 180 / Math.PI) % 360 + 360) % 360);
  const el = Math.round(lat * 180 / Math.PI);
  return `${az}° · ${el >= 0 ? '+' : ''}${el}°`;
}

function _selected() {
  return selectedPinSlot(S._frameCursorLon ?? 0, S._frameCursorLat ?? 0);
}
/** The loop an overdub take would join — grain.js nearestLoopPin, the same
 *  search the brush itself runs at the press, so the mark cannot promise one
 *  master and the engine pick another. -1 when no loop is pinned. */
function _dubMaster() {
  return S._nearestLoopPin?.(S._frameCursorLon ?? 0, S._frameCursorLat ?? 0) ?? -1;
}

// Cheap change signatures so the 6 Hz timer repaints only when something
// moved — the rail must never become a per-tick innerHTML rebuild. The slot
// part is separate: a slot arriving or leaving is what applyMix() has to see.
function _slotSig() {
  let s = '';
  for (const c of S.commitSlots) s += c ? `${c.slotIndex}${c.type[0]}|` : '.';
  return s;
}
function _sig() {
  let s = `${S.commitSlotCount}#`;
  for (const g of GROUPS) s += `${g.key}${g.muted ? 'm' : ''}${g.solo ? 's' : ''}|`;
  for (const c of S.commitSlots) {
    s += c ? `${c.slotIndex}${c.type[0]}${isCommitOn(c) ? '1' : '0'}${c.mute ? 'm' : ''}${c.solo ? 's' : ''}${c.overdubs?.length | 0}|` : '.';
  }
  return s;
}
let _lastSig = '', _lastSlotSig = '', _lastSel = -2;
let _lastDub = -2;   // the loop a dub would join — it moves on its own, so it is tracked on its own

/** Move the selection mark without rebuilding the list. */
function _markSelected(sel, dub) {
  _markSelectedPip(sel);
  const box = document.getElementById('lyrList');
  if (!box) return;
  box.querySelectorAll('.lyr-hold').forEach(el => {
    el.classList.toggle('sel', +el.dataset.slot === sel);
    // The master moves with the cursor exactly as the selection does, so it is
    // moved here rather than rebuilt — same reason, same tick.
    el.classList.toggle('dub', +el.dataset.slot === dub);
  });
  _lastSel = sel;
}

// ── The slot tracker ────────────────────────────────────────────────────────

/** Move the tracker's ring without rebuilding the cells — the selected pin
 *  changes as the cursor moves, which is far too often to repaint on. */
function _markSelectedPip(sel) {
  const pips = document.getElementById('lyrPips');
  if (!pips) return;
  for (let i = 0; i < pips.children.length; i++) {
    pips.children[i].classList.toggle('sel', i === sel);
  }
}

/** Cells beyond the max are drawn too when something is still in them:
 *  shrinking the count does not unpin, it stops the engine servicing those
 *  slots (grain.js and composer.js both stop at `S.commitSlotCount`), so a pin
 *  above the line goes silent while its row stays in the list. Drawing it as an
 *  over-the-line cell is the only place that says so. */
function renderSlotTracker(sel) {
  const pips = document.getElementById('lyrPips');
  if (!pips) return;
  const max = Math.max(1, S.commitSlotCount | 0);
  let last = -1, filled = 0;
  for (let i = 0; i < S.commitSlots.length; i++) {
    const c = S.commitSlots[i];
    if (!c || isPinLeaving(c)) continue;
    last = i;
    if (i < max) filled++;
  }
  const n = Math.max(max, last + 1);
  if (pips.childElementCount !== n) {
    let h = '';
    for (let i = 0; i < n; i++) h += `<i>${i + 1}</i>`;
    pips.innerHTML = h;
  }
  for (let i = 0; i < n; i++) {
    const el = pips.children[i];
    if (!el) continue;
    const c = S.commitSlots[i];
    const on = !!(c && !isPinLeaving(c));
    el.className = (on ? 'on' : '') + (i >= max ? ' over' : '') + (i === sel ? ' sel' : '');
    el.style.setProperty('--c', on ? `var(${groupOf(c)?.hue ?? '--eng-grain'})` : 'transparent');
    // The cell's name is the ROW's name, from the one builder — an empty slot
    // has no pin and so has no name, only a place in the pool.
    el.title = on ? _pinName(c) : `slot ${i + 1} — empty`;
  }
  const f = document.getElementById('lyrSlotsFilled');
  if (f) f.textContent = String(filled);
  const mx = document.getElementById('lyrSlotsMax');
  // Never overwrite the box the hand is typing in.
  if (mx && document.activeElement !== mx) mx.value = String(max);
}

/** The max, from the rail. It is the same number Settings → Pins holds, so the
 *  slider there is refreshed through the one sync hook rather than left to
 *  drift until something else happens to touch it. */
function _setSlotMax(v) {
  const n = Math.max(1, Math.min(16, parseInt(v, 10) || S.commitSlotCount));
  S.commitSlotCount = n;
  S._syncCommitSlotCount?.();
  S._syncCommitUI?.();
  S._pinsDirty = true;
  return n;
}

function _wireSlotMax() {
  const mx = document.getElementById('lyrSlotsMax');
  if (!mx) return;
  mx.value = String(S.commitSlotCount);
  const commit = () => { mx.value = String(_setSlotMax(mx.value)); };
  mx.addEventListener('blur', commit);
  mx.addEventListener('keydown', e => {
    if (e.key === 'Enter') { commit(); mx.blur(); }
    else if (e.key === 'Escape') { mx.value = String(S.commitSlotCount); mx.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // Typeable AND steppable, as every numbox in the instrument is.
      e.preventDefault();
      const cur = parseInt(mx.value, 10) || S.commitSlotCount;
      mx.value = String(_setSlotMax(cur + (e.key === 'ArrowUp' ? 1 : -1)));
    }
  });
}

export function renderPinsRail(selected) {
  const box = document.getElementById('lyrList');
  if (!box) return;
  const held = S.commitSlots.some(c => c);

  if (!held) {
    box.innerHTML = '<div class="lyr-empty">nothing pinned</div>';
    return;
  }

  // ONE search per tick, shared with the tracker: two searches a few
  // milliseconds apart can disagree while the cursor is moving, and then the
  // ring and the half-moon point at different pins.
  const sel = selected ?? _selected();
  const dub = _dubMaster();
  let out = '';
  GROUPS.forEach(g => {
    const ps = pinsIn(g);
    if (!ps.length) return;
    out += `<div class="lyrgroup${g.muted ? ' muted' : ''}${g.solo ? ' soloed' : ''}" style="--c:var(${g.hue})">` +
      `<div class="lyrgroup-h">` +
      `<span class="lyrdot" aria-hidden="true"></span>` +
      `<span class="lyrname">${g.name}</span>` +
      // The count sits BEFORE M so the header's M and S share a right edge
      // with every row's (measured 2026-09-05: after S they sat 13 px out).
      `<span class="lyrn">${ps.length}</span>` +
      `<button type="button" class="lyrmute" data-mute="${g.key}" aria-pressed="${!!g.muted}"` +
      ` title="${g.muted ? 'unmute' : 'mute'} every pinned ${g.name.slice(0, -1)}">M</button>` +
      `<button type="button" class="lyrsolo" data-solo="${g.key}" aria-pressed="${!!g.solo}" title="solo the ${g.name}">S</button></div>` +
      ps.map(c => {
        const on = isCommitOn(c);
        const nm = _pinName(c);
        return `<div class="lyr-hold${on ? '' : ' off'}${c.slotIndex === sel ? ' sel' : ''}${c.slotIndex === dub ? ' dub' : ''}" style="--m:var(${g.hue})" data-slot="${c.slotIndex}">` +
          // `mu-h-content` DECLARES that this box is sized by its text, not by the
          // kit (Ek, 2026-09-15). The row carries a two-line name — `loop 3` over
          // the pin's coordinates — so its 44.2px is content, not the derived
          // height the kit round went after, and snapping it would clip the
          // sub-line. align-audit R6 reads the class and skips it; being
          // content-sized is stated here, by the author, not whitelisted there.
          `<button type="button" class="lyr-hold-body mu-h-content" data-body="${c.slotIndex}" title="${c.mute ? 'unmute' : 'mute'} ${nm}">` +
          `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${PIN_G[c.type] || PIN_G.cloud}</svg>` +
          `<span class="lyr-hold-nm">${nm}${_ovdDots(c)}<small>${_pinPos(c)}</small></span>` +
          `<svg class="lyr-dub" viewBox="0 0 24 24" aria-hidden="true">${OVD_G}</svg></button>` +
          `<button type="button" class="lyrmute" data-pmute="${c.slotIndex}" aria-pressed="${!!c.mute}" title="${c.mute ? 'unmute' : 'mute'} ${nm}">M</button>` +
          `<button type="button" class="lyrsolo" data-psolo="${c.slotIndex}" aria-pressed="${!!c.solo}" title="solo ${nm}">S</button>` +
          `</div>`;
      }).join('') + '</div>';
  });
  box.innerHTML = out;
  _lastSel = sel;

  box.querySelectorAll('[data-mute]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const g = GROUPS.find(x => x.key === b.dataset.mute);
    if (g) toggleGroup(g);
  }));
  box.querySelectorAll('[data-solo]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const g = GROUPS.find(x => x.key === b.dataset.solo);
    if (g) toggleSolo(g);
  }));
  box.querySelectorAll('[data-body]').forEach(b => b.addEventListener('click', () => {
    togglePinMute(S.commitSlots[+b.dataset.body]);
  }));
  box.querySelectorAll('[data-pmute]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    togglePinMute(S.commitSlots[+b.dataset.pmute]);
  }));
  box.querySelectorAll('[data-psolo]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    togglePinSolo(S.commitSlots[+b.dataset.psolo]);
  }));
}

export function initPinsRail() {
  if (!document.getElementById('lyrList')) return;
  // The rail's own settings door: every pin PARAMETER lives on Settings → Pins
  // and nowhere else (2026-08-30, Ek — "the lens is just for the scratch
  // layer, pins are a separate thing that lenses don't touch"). The opener sits
  // on the material it configures rather than in a nav the player has to
  // remember, which is the same rule the pin actions follow.
  document.getElementById('lyrSettings')?.addEventListener('click', () => {
    S._openSettings?.('pins');
  });
  document.getElementById('tcRail')?.addEventListener('mousedown', e => e.stopPropagation());

  setInterval(() => {
    // A pin that arrived by a road that did not call applyMix() (an import,
    // a snapshot restore) is brought under the standing flags here — the
    // creation paths call it themselves, so this is the net, not the rule.
    const ss = _slotSig();
    if (ss !== _lastSlotSig) { _lastSlotSig = ss; applyMix(); }
    const sig = _sig();
    if (S._pinsDirty || sig !== _lastSig) {
      S._pinsDirty = false;
      _lastSig = sig;
      const sel = _selected(), dub = _dubMaster();
      renderSlotTracker(sel);
      renderPinsRail(sel);
      _lastDub = dub;
    } else {
      // The MASTER moves on its own: unpin the nearest loop, or drift past
      // another one, and the selected pin can sit still while the loop a dub
      // would join changes. So both are compared, or the mark would stick.
      const sel = _selected(), dub = _dubMaster();
      if (sel !== _lastSel || dub !== _lastDub) { _markSelected(sel, dub); _lastDub = dub; }
    }
  }, 160);
  _wireSlotMax();
  renderSlotTracker(_selected());
  renderPinsRail();
}

