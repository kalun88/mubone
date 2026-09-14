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
// Rendering only. All behaviour is js/pins.js. DOM work never happens on the
// scheduler tick: the gate sets S._pinsDirty and this repaints on its own
// ~6 Hz timer. The selection mark moves without a rebuild.
// ============================================================================

import { S } from './state.js';
import { GROUPS, toggleGroup, toggleSolo, allOn, pinsIn, togglePinMute, togglePinSolo,
         selectedPinSlot, applyMix } from './pins.js';
import { isCommitOn } from './composer.js';

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

// Cheap change signatures so the 6 Hz timer repaints only when something
// moved — the rail must never become a per-tick innerHTML rebuild. The slot
// part is separate: a slot arriving or leaving is what applyMix() has to see.
function _slotSig() {
  let s = '';
  for (const c of S.commitSlots) s += c ? `${c.slotIndex}${c.type[0]}|` : '.';
  return s;
}
function _sig() {
  let s = '';
  for (const g of GROUPS) s += `${g.key}${g.muted ? 'm' : ''}${g.solo ? 's' : ''}|`;
  for (const c of S.commitSlots) {
    s += c ? `${c.slotIndex}${c.type[0]}${isCommitOn(c) ? '1' : '0'}${c.mute ? 'm' : ''}${c.solo ? 's' : ''}${c.overdubs?.length | 0}|` : '.';
  }
  return s;
}
let _lastSig = '', _lastSlotSig = '', _lastSel = -2;

/** Move the selection mark without rebuilding the list. */
function _markSelected(sel) {
  const box = document.getElementById('lyrList');
  if (!box) return;
  box.querySelectorAll('.lyr-hold').forEach(el => el.classList.toggle('sel', +el.dataset.slot === sel));
  _lastSel = sel;
}

export function renderPinsRail() {
  const box = document.getElementById('lyrList');
  if (!box) return;
  const held = S.commitSlots.some(c => c);

  if (!held) {
    box.innerHTML = '<div class="lyr-empty">nothing pinned</div>';
    return;
  }

  const sel = _selected();
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
        return `<div class="lyr-hold${on ? '' : ' off'}${c.slotIndex === sel ? ' sel' : ''}" style="--m:var(${g.hue})" data-slot="${c.slotIndex}">` +
          `<button type="button" class="lyr-hold-body" data-body="${c.slotIndex}" title="${c.mute ? 'unmute' : 'mute'} ${nm}">` +
          `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${PIN_G[c.type] || PIN_G.cloud}</svg>` +
          `<span class="lyr-hold-nm">${nm}${_ovdDots(c)}<small>${_pinPos(c)}</small></span></button>` +
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
  document.getElementById('lyrAllOn')?.addEventListener('click', () => { allOn(); });
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
      renderPinsRail();
    } else {
      const sel = _selected();
      if (sel !== _lastSel) _markSelected(sel);
    }
  }, 160);
  renderPinsRail();
}

