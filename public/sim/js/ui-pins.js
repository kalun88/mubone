// ============================================================================
// ui-pins.js — the PINNED rail, permanently on the right: A MIXER
//
// Everything here plays off-cursor: the lens reads the scratch layer, the rail
// is the rest. Since 2026-09-16 it is a mixer (Ek, 2026-09-15: "think of it
// more as a mixer where each pin has its own track"). ONE TRACK PER PIN, and
// the track IS its fader:
//
//   · the bar's FILL is the level — read from the audio nodes every frame, so
//     the bar is the truth and not a copy of it. In focus the cursor drives the
//     faders and you see them move; the fill's edge turns the SENSOR hue while
//     it does, which is the one mark that says "focus is on".
//   · the MATERIAL you drew sits inside it, laid flat, in the pin's own slot
//     colour — the colour it has on the sphere — every mark at the size its
//     loudness gives it there. A loop is its marks on one connected line; a
//     cloud is loose dots. The shape says the kind, so the word is gone.
//   · the NUMBER is the identity — the same digit the sphere's anchor wears —
//     in the ENGINE hue (gold = cloud, pink = loop). Pressing it folds the
//     pin's own settings open: its two ramps, `fadeIn` / `fadeOut`.
//   · the PLAYHEAD keeps running through a mute. That is what a DJ mute is
//     (js/pins.js), and the bar is where you see it.
//   · M and S are as before — every pin has the same two the bus has, and
//     dragging the bar sets the level. The dB readout prints only when the
//     hand set a level: eight tracks at unity are eight bars, not eight "0.0"s.
//
// SORT IS THE SELECTED PIN (Ek: "one sort can be closest top farthest bottom
// and this can correspond to basically the actual setting of which selection
// type … then it's always the first slot i know it's the one selected"). The
// mode bar's sort segment writes `S.selectionMode`, the rows are ordered by the
// same key `selectedPinSlot` uses, and row one wears the half moon. Under
// `nearest` in focus the rail is a proximity meter: the loudest bar at the top.
//
// THE MODE BAR holds the four pin settings you switch mid-set — blend, tether,
// sort, width — each a second door onto the S field Settings → Pins already
// holds (the slot count set the precedent, 2026-09-14). Both doors read the
// same field; the rail polls it on its own tick so an OSC or settings-page
// change lands here without a hook.
//
// The GROUPS are the two BUSSES at the foot — clouds, loops — with their M and
// S, and a fill that is their members' mean level (derived, no new state).
// Nothing files a pin anywhere; its kind is its group (js/pins.js).
//
// The slot tracker that sat under the header is gone (Ek, 2026-09-15: "it was
// only to help track which was closest, which is now the top item, and also
// when i was getting full, which is more obvious with each track listed").
// The typeable max survived, in the header; the same number Settings → Pins
// holds on a slider, through `S.commitSlotCount`, each door refreshing the
// other. A pin ABOVE the max — the count pulled below it — wears its number
// outlined: the engine no longer services that slot.
//
// Rendering only. All behaviour is js/pins.js. Two clocks: the LIST is rebuilt
// on its own ~6 Hz timer when a change signature moves (a pin arriving, a flag,
// a fold) — never per tick; the LEVELS, playheads and order are written by a
// requestAnimationFrame loop that runs only while the rail is open and touches
// nothing but transforms and a few text nodes. The grain scheduler shares this
// thread (docs/RULINGS.md "Render path"); nothing here allocates per frame.
// ============================================================================

import { S } from './state.js';
import { GROUPS, toggleGroup, toggleSolo, pinsIn, togglePinMute, togglePinSolo,
         selectedPinSlot, applyMix, isPinLeaving, groupOf, isPinAudible, pinAnchorInto } from './pins.js';
import { angleBetweenSphere } from './grain.js';

// The overdub tool's own glyph (js/tiles.js G.overdub): THE MASTER IS MARKED
// WITH THE TOOL'S OWN MARK (Ek, 2026-09-15) — the moon says "unpin takes this",
// this says "a dub would join this", a different question about a different
// pin, and a hue could not carry it on a track already in the tape hue.
const OVD_G = '<path d="M12 4a8 8 0 1 1-7.1 4.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 8.5a3.5 3.5 0 1 1-3.1 1.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>';

// The rail's vertical rhythm, in px, mirrored from style.css: the layout is
// done by transform here, so the numbers the stylesheet draws are repeated
// once, in one place.
const BAR_H = 32;            // the track bar — the .tc-icon precedent (GUI-BUILD-SHEET § 4)
const ROW_GAP = 6;           // --sp-3, between bars
const FOLD_ROW = 24;         // one fold row — the kit's 24px control height
const FOLD_PAD = 4;          // --sp-0 top + the fold's gap

function _pinName(c) {
  return (c.type === 'cloud' ? 'cloud ' : 'loop ') + (c.slotIndex + 1);
}

function _fmtS(v) {
  v = +v || 0;
  return v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(1) + ' s';
}
/** "2.5", "2.5s", "250ms", "250 ms" → seconds. NaN when it is not a time. */
function _parseS(t) {
  const m = String(t).trim().toLowerCase().match(/^(-?\d*\.?\d+)\s*(ms|s)?$/);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  return m[2] === 'ms' ? n / 1000 : n;
}

function _selected() {
  return selectedPinSlot(S._frameCursorLon ?? 0, S._frameCursorLat ?? 0);
}
/** The loop an overdub take would join — grain.js nearestLoopPin, the same
 *  search the brush itself runs at the press. -1 when no loop is pinned. */
function _dubMaster() {
  return S._nearestLoopPin?.(S._frameCursorLon ?? 0, S._frameCursorLat ?? 0) ?? -1;
}

// Cheap change signatures so the 6 Hz timer repaints only when something
// moved — the rail must never become a per-tick innerHTML rebuild. The slot
// part is separate: a slot arriving or leaving is what applyMix() has to see.
// The level is deliberately NOT in here: it moves every frame and is written
// in place by the rAF loop.
function _slotSig() {
  let s = '';
  for (const c of S.commitSlots) s += c ? `${c.slotIndex}${c.type[0]}|` : '.';
  return s;
}
function _sig() {
  let s = `${S.commitSlotCount}#`;
  for (const g of GROUPS) s += `${g.key}${g.muted ? 'm' : ''}${g.solo ? 's' : ''}|`;
  for (const c of S.commitSlots) {
    s += c ? `${c.slotIndex}${c.type[0]}${c.mute ? 'm' : ''}${c.solo ? 's' : ''}${c.overdubs?.length | 0}${c._railOpen ? 'o' : ''}${isPinLeaving(c) ? 'x' : ''}|` : '.';
  }
  return s;
}
let _lastSig = '', _lastSlotSig = '';
let _lastOrder = '';   // the row order as last laid out — reorder only when it changes

// ── The material, laid flat ─────────────────────────────────────────────────
// Every mark at the size its loudness gives it on the sphere (renderer.js sizes
// a mark by its rms between vizRmsMin and vizRmsMax; this is that scale, not a
// new one), in the pin's own colour. Drawn ONCE per rebuild into the track's
// canvas — the material does not move; the playhead over it does.
function _rmsN(rms) {
  if (!(rms > 0)) return 0.35;
  const lo = Math.log(S.vizRmsMin || 0.002), hi = Math.log(S.vizRmsMax || 0.282);
  return Math.max(0, Math.min(1, (Math.log(rms) - lo) / (hi - lo)));
}
function _markR(p) { const n = Math.pow(_rmsN(p.rms), 1.35); return 0.8 + 2.2 * n; }

// Scratch for the cloud's particle gather — grown on demand, never per frame.
const _anch = [0, 0];

function _drawMaterial(c, cv) {
  const W = cv.clientWidth | 0, H = BAR_H;
  if (W < 8) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = c.color; ctx.strokeStyle = c.color;
  const x0 = 4, xs = W - 8;

  if (c.type === 'loop') {
    // A loop's marks by TIME along the take, their own latitude wobble as the
    // line's shape, connected — tape plays a take whole.
    const ps = c.particles;
    if (!ps || !ps.length) return;
    const t0 = c.loopStart ?? 0, span = Math.max(1e-6, (c.loopEnd ?? (t0 + 1)) - t0);
    let mean = 0; for (const p of ps) mean += p.lat; mean /= ps.length;
    const xy = ps.map(p => [x0 + Math.max(0, Math.min(1, ((p.grainStart ?? t0) - t0) / span)) * xs,
                            H / 2 - Math.max(-8, Math.min(8, (p.lat - mean) * 60)), _markR(p)])
                 .sort((a, b) => a[0] - b[0]);
    ctx.lineWidth = 1.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // Each overdub is a fainter line under the master's — a pass laid on a pass.
    const layers = 1 + (c.overdubs?.length | 0);
    for (let L = layers - 1; L >= 0; L--) {
      ctx.globalAlpha = L === 0 ? 0.9 : 0.35;
      ctx.beginPath();
      for (let i = 0; i < xy.length; i++) { const [x, y] = xy[i]; i ? ctx.lineTo(x, y + L * 3.2) : ctx.moveTo(x, y + L * 3.2); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const [x, y, r] of xy) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); }
    return;
  }

  // A cloud: the marks the lens reads inside it — the patch around the anchor,
  // flattened, lon across and lat down. A MOVING cloud lays them along its path
  // instead: across is where along the path, down is the offset from it.
  const r = Math.max(1e-3, (c.searchRadiusDeg || S.searchRadiusDeg || 10) * Math.PI / 180);
  const frames = c.frames && c.frames.length > 1 ? c.frames : null;
  if (!pinAnchorInto(c, _anch)) return;
  const parts = S.particles;
  if (frames) {
    // ≤ 48 frames sampled, so a long path against a full sphere stays a
    // rebuild-time cost and not a stall.
    const step = Math.max(1, Math.floor(frames.length / 48));
    const fs = []; for (let i = 0; i < frames.length; i += step) fs.push(frames[i]);
    for (const p of parts) {
      if (p.trig) continue;
      let best = -1, bd = r;
      for (let i = 0; i < fs.length; i++) {
        const d = angleBetweenSphere(fs[i].lon, fs[i].lat, p.lon, p.lat);
        if (d < bd) { bd = d; best = i; }
      }
      if (best < 0) continue;
      const f = fs[best];
      const x = x0 + (best / Math.max(1, fs.length - 1)) * xs;
      const y = H / 2 - Math.max(-1, Math.min(1, (p.lat - f.lat) / r)) * (H / 2 - 3);
      ctx.globalAlpha = 0.55 + 0.45 * _rmsN(p.rms);
      ctx.beginPath(); ctx.arc(x, y, _markR(p), 0, 6.283); ctx.fill();
    }
  } else {
    const aLon = _anch[0], aLat = _anch[1], cl = Math.max(0.2, Math.cos(aLat));
    for (const p of parts) {
      if (p.trig) continue;
      if (angleBetweenSphere(aLon, aLat, p.lon, p.lat) > r) continue;
      let dl = p.lon - aLon; dl = ((dl + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      const x = x0 + (0.5 + 0.5 * Math.max(-1, Math.min(1, dl * cl / r))) * xs;
      const y = H / 2 - Math.max(-1, Math.min(1, (p.lat - aLat) / r)) * (H / 2 - 3);
      ctx.globalAlpha = 0.55 + 0.45 * _rmsN(p.rms);
      ctx.beginPath(); ctx.arc(x, y, _markR(p), 0, 6.283); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// ── The header count ────────────────────────────────────────────────────────

function renderCount() {
  const max = Math.max(1, S.commitSlotCount | 0);
  let filled = 0;
  for (let i = 0; i < S.commitSlots.length; i++) {
    const c = S.commitSlots[i];
    if (c && !isPinLeaving(c) && i < max) filled++;
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

// ── The mode bar ────────────────────────────────────────────────────────────
// Four second doors. Each write goes to S and then through `_syncImprovUI`, the
// settings page's own refresh, so the page agrees at once; the other way round
// the 160 ms tick below reads S and repaints whatever moved.

let _modesShown = '';
function syncModes() {
  const blend = S.commitPlayback ?? 'all', tether = !!S.commitTether;
  const sort = S.selectionMode ?? 'nearest', xf = Math.max(0, Math.min(1, S.commitXfade ?? 0.5));
  const key = `${blend}${tether ? 't' : ''}${sort}${xf.toFixed(2)}`;
  if (key === _modesShown) return;
  _modesShown = key;
  document.querySelectorAll('#lyrBlend [data-v]').forEach(b => b.classList.toggle('active', b.dataset.v === blend));
  document.querySelectorAll('#lyrSort [data-v]').forEach(b => b.classList.toggle('active', b.dataset.v === sort));
  const sw = document.getElementById('lyrTether');
  if (sw) { sw.classList.toggle('on', tether); sw.setAttribute('aria-pressed', String(tether)); }
  const sl = document.getElementById('lyrXfade');
  if (sl && document.activeElement !== sl) sl.value = String(xf);
  const v = document.getElementById('lyrXfadeV');
  if (v) v.textContent = Math.round(xf * 100) + '%';
  sl?.parentElement?.classList.toggle('off', blend !== 'focus');
}

function _wireModes() {
  document.querySelectorAll('#lyrBlend [data-v]').forEach(b => b.addEventListener('click', () => {
    S.commitPlayback = b.dataset.v; S._syncImprovUI?.(); syncModes();
  }));
  document.querySelectorAll('#lyrSort [data-v]').forEach(b => b.addEventListener('click', () => {
    S.selectionMode = b.dataset.v; S._syncImprovUI?.(); syncModes(); S._pinsDirty = true;
  }));
  document.getElementById('lyrTether')?.addEventListener('click', () => {
    S.commitTether = !S.commitTether; S._syncImprovUI?.(); syncModes();
  });
  const sl = document.getElementById('lyrXfade');
  sl?.addEventListener('input', () => {
    S.commitXfade = parseFloat(sl.value); S._syncImprovUI?.(); _modesShown = ''; syncModes();
  });
  // Double-click resets a slider to its default — kit-wide (GUI-BUILD-SHEET § 5).
  sl?.addEventListener('dblclick', () => { S.commitXfade = 0.5; S._syncImprovUI?.(); _modesShown = ''; syncModes(); });
}

// ── The tracks ──────────────────────────────────────────────────────────────

/** The rows in the order the sort asks for — the same key selectedPinSlot
 *  uses, so row one IS the selected pin. Leaving pins keep their place until
 *  their slot frees; the tail is where you left them. */
function _ordered() {
  const mode = S.selectionMode ?? 'nearest';
  const lon = S._frameCursorLon ?? 0, lat = S._frameCursorLat ?? 0;
  const rows = [];
  for (const c of S.commitSlots) {
    if (!c) continue;
    let key;
    if (mode === 'oldest') key = c._plantedAt || c._createdAt || 0;
    else if (pinAnchorInto(c, _anch)) {
      key = angleBetweenSphere(_anch[0], _anch[1], lon, lat);
      if (mode === 'farthest') key = -key;
    } else key = Infinity;
    rows.push([key, c]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  return rows.map(r => r[1]);
}

function _foldH(c) {
  if (!c._railOpen) return 0;
  return FOLD_PAD + 2 * FOLD_ROW + 2;   // in, out — and the fold's gap between them
}

/** Place the rows. Transforms only; the list's min-height follows. */
function _layout(force) {
  const box = document.getElementById('lyrList');
  if (!box) return;
  const rows = _ordered();
  const sel = _selected(), dub = _dubMaster();
  const key = rows.map(c => c.slotIndex + (c._railOpen ? 'o' : '')).join(',') + `|${sel}|${dub}`;
  if (!force && key === _lastOrder) return;
  _lastOrder = key;
  let y = 0;
  for (const c of rows) {
    const el = c._railEl;
    if (!el) continue;
    el.style.transform = `translateY(${y}px)`;
    el.classList.toggle('sel', c.slotIndex === sel);
    el.classList.toggle('dub', c.slotIndex === dub);
    const fh = _foldH(c);
    const fold = el.querySelector('.lyr-fold');
    if (fold) fold.style.height = fh + 'px';
    y += BAR_H + fh + ROW_GAP;
  }
  box.style.minHeight = rows.length ? (y - ROW_GAP + 2 * ROW_GAP) + 'px' : '';
}

function _syncFold(c) {
  const el = c._railEl; if (!el) return;
  el.querySelectorAll('.lyr-frow').forEach(row => {
    const k = row.dataset.k, sl = row.querySelector('.grain-slider'), nb = row.querySelector('.grain-numbox');
    const v = +c[k] || 0;
    if (sl && document.activeElement !== sl) sl.value = String(v);
    if (nb && document.activeElement !== nb) nb.value = _fmtS(v);
  });
}

function _foldRow(k, label, tip) {
  return `<div class="lyr-frow" data-k="${k}" title="${tip}">` +
    `<span class="lyr-eb">${label}</span>` +
    `<input type="range" class="grain-slider" min="0" max="10" step="0.01" value="0" aria-label="${label}">` +
    `<input type="text" class="grain-numbox" value="0 ms" aria-label="${label}, typeable"></div>`;
}

export function renderPinsRail(selected) {
  const box = document.getElementById('lyrList');
  if (!box) return;
  const held = S.commitSlots.some(c => c);

  if (!held) {
    box.innerHTML = '<div class="lyr-empty">nothing pinned</div>';
    box.style.minHeight = '';
    for (const c of S.commitSlots) if (c) c._railEl = null;
    _lastOrder = '';
    renderBusses();
    return;
  }

  let out = '';
  for (const c of S.commitSlots) {
    if (!c) continue;
    const g = groupOf(c), nm = _pinName(c);
    const n = c.overdubs?.length | 0;
    out += `<div class="lyr-trk${c._railOpen ? ' open' : ''}" style="--m:${c.color};--c:var(${g?.hue ?? '--eng-grain'})" data-slot="${c.slotIndex}">` +
      `<div class="lyr-trk-bar" title="${nm} — drag to set its level">` +
        `<div class="lyr-fill"></div>` +
        `<button type="button" class="lyr-num" data-fold="${c.slotIndex}" title="${nm} · its own in and out">${c.slotIndex + 1}</button>` +
        `<div class="lyr-mat"><canvas></canvas></div>` +
        `<div class="lyr-ph" hidden></div>` +
        (n ? `<span class="lyr-ovd" title="${n} overdub${n === 1 ? '' : 's'}">${'<i></i>'.repeat(n)}</span>` : '') +
        `<svg class="lyr-dub" viewBox="0 0 24 24" aria-hidden="true">${OVD_G}</svg>` +
        `<span class="lyr-db"></span>` +
        `<div class="lyr-edge"></div>` +
        `<span class="lyr-ms">` +
          `<button type="button" class="lyrmute" data-pmute="${c.slotIndex}" aria-pressed="${!!c.mute}" title="${c.mute ? 'unmute' : 'mute'} ${nm} — the playhead keeps running">M</button>` +
          `<button type="button" class="lyrsolo" data-psolo="${c.slotIndex}" aria-pressed="${!!c.solo}" title="solo ${nm}">S</button>` +
        `</span>` +
      `</div>` +
      `<div class="lyr-fold">` +
        _foldRow('fadeIn', 'in', 'in — how this pin comes up: on pin, and on unmute') +
        _foldRow('fadeOut', 'out', 'out — how this pin leaves: on unpin, and on mute') +
      `</div>` +
    `</div>`;
  }
  box.innerHTML = out;

  for (const c of S.commitSlots) {
    if (!c) continue;
    const el = box.querySelector(`.lyr-trk[data-slot="${c.slotIndex}"]`);
    c._railEl = el;
    if (!el) continue;
    _wireTrack(c, el);
    _syncFold(c);
  }
  // The canvases need their laid-out width; one frame later they have it.
  requestAnimationFrame(() => {
    for (const c of S.commitSlots) {
      const cv = c?._railEl?.querySelector('canvas');
      if (cv) _drawMaterial(c, cv);
    }
  });
  _layout(true);
  renderBusses();
}

function _wireTrack(c, el) {
  const bar = el.querySelector('.lyr-trk-bar');
  el.querySelector('[data-pmute]')?.addEventListener('click', e => { e.stopPropagation(); togglePinMute(c); });
  el.querySelector('[data-psolo]')?.addEventListener('click', e => { e.stopPropagation(); togglePinSolo(c); });
  el.querySelector('[data-fold]')?.addEventListener('click', e => {
    e.stopPropagation();
    // One fold open at a time — the rail is read at a glance.
    for (const o of S.commitSlots) if (o && o !== c) o._railOpen = false;
    c._railOpen = !c._railOpen;
    S._pinsDirty = true;
  });

  // THE WHOLE BAR IS THE FADER. A press anywhere on it that is not a button
  // sets the level to where the finger is; a drag rides it. Writes the pin's
  // `grainParams.volume` — the loop's gain node follows it (grain.js), a
  // cloud's next grain reads it.
  let dragging = false;
  const setFromEvent = e => {
    const r = bar.getBoundingClientRect();
    const v = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    if (!c.grainParams) c.grainParams = {};
    c.grainParams.volume = +v.toFixed(3);
  };
  bar.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('.lyr-num, .lyrmute, .lyrsolo')) return;
    dragging = true; c._railTouched = true;
    bar.setPointerCapture?.(e.pointerId);
    setFromEvent(e);
    e.preventDefault();
  });
  bar.addEventListener('pointermove', e => { if (dragging) setFromEvent(e); });
  const end = () => { dragging = false; c._railTouched = false; };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
  // Double-click resets a fader to unity — the kit's rule for a slider.
  bar.addEventListener('dblclick', e => {
    if (e.target.closest('.lyr-num, .lyrmute, .lyrsolo')) return;
    if (!c.grainParams) c.grainParams = {};
    c.grainParams.volume = 1;
  });

  // The fold: in and out. The slider and the numbox are one value, typeable
  // either way; double-click on the slider is the pins' default for a new pin.
  el.querySelectorAll('.lyr-frow').forEach(row => {
    const k = row.dataset.k, sl = row.querySelector('.grain-slider'), nb = row.querySelector('.grain-numbox');
    const dflt = () => k === 'fadeIn' ? (S.seedAttack || 0)
                     : (c.type === 'loop' ? Math.max(S.seedRelease || 0, (S.loopFadeTimeMs || 15) / 1000) : (S.seedRelease || 0));
    sl?.addEventListener('input', () => { c[k] = +(+sl.value).toFixed(2); _syncFold(c); });
    sl?.addEventListener('dblclick', () => { c[k] = dflt(); _syncFold(c); });
    const commit = () => {
      const v = _parseS(nb.value);
      if (Number.isFinite(v)) c[k] = Math.max(0, Math.min(10, +v.toFixed(2)));
      _syncFold(c);
    };
    nb?.addEventListener('blur', commit);
    nb?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { commit(); nb.blur(); }
      else if (e.key === 'Escape') { _syncFold(c); nb.blur(); }
    });
  });
}

// ── The busses ──────────────────────────────────────────────────────────────

function renderBusses() {
  const box = document.getElementById('lyrBus');
  if (!box) return;
  let out = '';
  for (const g of GROUPS) {
    const ps = pinsIn(g);
    if (!ps.length) { g._railEl = null; continue; }
    out += `<div class="lyr-bus-row${g.solo ? ' soloed' : ''}" style="--c:var(${g.hue});--m:var(${g.hue})" data-bus="${g.key}">` +
      `<div class="lyr-fill"></div>` +
      `<span class="lyr-bus-nm">${g.name}<b>${ps.length}</b></span>` +
      `<span class="lyr-ms">` +
        `<button type="button" class="lyrmute" data-mute="${g.key}" aria-pressed="${!!g.muted}" title="${g.muted ? 'unmute' : 'mute'} every pinned ${g.name.slice(0, -1)}">M</button>` +
        `<button type="button" class="lyrsolo" data-solo="${g.key}" aria-pressed="${!!g.solo}" title="solo the ${g.name}">S</button>` +
      `</span></div>`;
  }
  box.innerHTML = out;
  for (const g of GROUPS) {
    g._railEl = box.querySelector(`[data-bus="${g.key}"]`);
    g._railEl?.querySelector('[data-mute]')?.addEventListener('click', e => { e.stopPropagation(); toggleGroup(g); });
    g._railEl?.querySelector('[data-solo]')?.addEventListener('click', e => { e.stopPropagation(); toggleSolo(g); });
  }
}

// ── The frame: levels, playheads, the readout ───────────────────────────────
// Reads the audio nodes a loop already carries (`gain × mute × pinWeight` — the
// three gains in series, grain.js) and the envelope and weight a cloud already
// carries; writes transforms. No allocation, no layout read.

function _level(c, focus) {
  const vol = c.grainParams?.volume ?? 1;
  if (c.slotIndex >= S.commitSlotCount) return 0;     // over the line: not serviced
  const weight = focus ? (S._pinWeights?.[c.slotIndex] || 0) : 1;
  if (c.type === 'loop') {
    // Each gain read from its node when the node exists, and from the FLAG or
    // the WEIGHT it will be built from when it does not yet — a loop whose
    // source is not up is still muted if its mute says so.
    const g = c._gainNode ? c._gainNode.gain.value : vol;
    const m = c._muteGain ? c._muteGain.gain.value : (isPinAudible(c) ? 1 : 0);
    const w = c._pinGain ? c._pinGain.gain.value : weight;
    if (isPinLeaving(c)) return c._gainNode ? g * m : 0;
    return g * m * w;
  }
  const env = c._envGainCurrent ?? 1;
  return env * weight * vol;
}

/** 0–1 along the material, or -1 when the pin has no playhead. */
function _playhead(c) {
  if (c.type === 'loop') {
    const src = c._sourceNode, actx = S.audioCtx;
    if (!src || src._stopped || !actx || !c._startedAt) return -1;
    const len = Math.max(1e-6, (c.loopEnd ?? 0) - (c.loopStart ?? 0));
    const elapsed = (actx.currentTime - c._startedAt) * Math.abs(c.speed || 1);
    let t = (elapsed % len) / len;
    if ((c.direction ?? 1) < 0) t = 1 - t;
    return t;
  }
  const dur = c.duration;
  if (!c.frames || !(dur > 0)) return -1;
  const ph = c._playheadMs || 0;
  if (c.loopMode === 'pingpong') { const u = (ph % (2 * dur)) / dur; return u < 1 ? u : 2 - u; }
  const t = (ph % dur) / dur;
  return c.loopMode === 'rev' ? 1 - t : t;
}

function _frame() {
  const focus = S.commitPlayback === 'focus';
  const busSum = { cloud: 0, loop: 0 }, busN = { cloud: 0, loop: 0 };
  for (const c of S.commitSlots) {
    const el = c?._railEl;
    if (!el) continue;
    const lv = Math.max(0, Math.min(1, _level(c, focus)));
    el.classList.toggle('auto', focus);
    el.classList.toggle('over', c.slotIndex >= S.commitSlotCount);
    el.classList.toggle('touched', !!c._railTouched);
    const fill = el.children[0].children[0];        // .lyr-trk-bar > .lyr-fill
    fill.style.transform = `scaleX(${lv.toFixed(4)})`;
    const edge = el.querySelector('.lyr-edge');
    if (edge) edge.style.left = (lv * 100).toFixed(2) + '%';
    // The readout: only when the hand set a level.
    const vol = c.grainParams?.volume ?? 1;
    const db = el.querySelector('.lyr-db');
    if (db) {
      const want = (c._railTouched || vol < 0.999)
        ? (vol <= 0.0005 ? '−∞' : (20 * Math.log10(vol)).toFixed(1))
        : '';
      if (db.textContent !== want) db.textContent = want;
    }
    const ph = el.querySelector('.lyr-ph');
    if (ph) {
      const t = _playhead(c);
      if (t < 0) { if (!ph.hidden) ph.hidden = true; }
      else {
        if (ph.hidden) ph.hidden = false;
        const mat = el.querySelector('.lyr-mat');
        const w = mat ? mat.clientWidth : 0;
        ph.style.transform = `translateX(${(t * Math.max(0, w - 1)).toFixed(1)}px)`;
      }
    }
    busSum[c.type] += lv; busN[c.type]++;
  }
  for (const g of GROUPS) {
    const el = g._railEl; if (!el) continue;
    const n = busN[g.key];
    el.children[0].style.transform = `scaleX(${n ? (busSum[g.key] / n).toFixed(3) : 0})`;
  }
}

let _raf = 0;
function _loop() {
  _raf = 0;
  if (!document.body.classList.contains('pinned-open')) return;   // re-armed by the tick
  _frame();
  _raf = requestAnimationFrame(_loop);
}

export function initPinsRail() {
  if (!document.getElementById('lyrList')) return;
  // The rail's own settings door: the rest of the pin parameters — count, when
  // full, what a new pin is born with — live on Settings → Pins. The opener
  // sits on the material it configures rather than in a nav the player has to
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
      renderCount();
      renderPinsRail();
    } else {
      // The ORDER moves with the cursor under near / far, as does the master a
      // dub would join — both are laid out here, on the tick, never per frame.
      _layout(false);
    }
    syncModes();
    // The material's width changes with the window; a resize is rare and the
    // canvas is cheap, so it is redrawn when its box moved.
    for (const c of S.commitSlots) {
      const cv = c?._railEl?.querySelector('canvas');
      if (cv && cv.clientWidth && Math.abs(cv.width / Math.min(2, window.devicePixelRatio || 1) - cv.clientWidth) > 1) _drawMaterial(c, cv);
    }
    if (!_raf && document.body.classList.contains('pinned-open')) _raf = requestAnimationFrame(_loop);
  }, 160);
  _wireSlotMax();
  _wireModes();
  syncModes();
  renderCount();
  renderPinsRail();
}
