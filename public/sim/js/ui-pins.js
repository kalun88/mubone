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
//   · the MATERIAL you drew sits inside it, laid flat, every mark at the size
//     its loudness gives it there. A loop is its marks on one connected line; a
//     cloud is loose dots. The shape says the kind, so the word is gone. The
//     rail wears the ENGINE hue only (fill, material, playhead): it carried the
//     pin's slot colour until 2026-09-17, and Ek does not read it — "when i'm
//     playing live i'm not keeping track of those colours".
//   · the NUMBER is the identity — the same digit the sphere's anchor wears —
//     in the ENGINE hue (gold = cloud, pink = loop). The loop an overdub would
//     join wears a ring round it, the O the tape tile's flag wears. A pin has
//     no settings of its own: In and Out are Settings › Pins, live (pins.js).
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
// THE MODE BAR holds the two pin settings you switch mid-set — follow and sort
// (the crossfade curve went to Settings → Pins, 2026-09-23) — each a second door onto an S field OSC and the keys also write (the
// slot count set the precedent, 2026-09-14). The rail polls the field on its
// own tick so an OSC or key change lands here without a hook. FOLLOW is
// `S.commitPlayback === 'focus'`, drawn as the switch it is (2026-09-22 night);
// tether left the same night — a pin is never gated by the radius.
//
// The GROUPS are the two BUSSES at the foot — clouds, loops — with their M and
// S, and a fill that is their members' mean level (derived, no new state).
// Nothing files a pin anywhere; its kind is its group (js/pins.js).
//
// The slot tracker that sat under the header is gone (Ek, 2026-09-15: "it was
// only to help track which was closest, which is now the top item, and also
// when i was getting full, which is more obvious with each track listed").
// The typeable max survived, in the header — the ONE door to
// `S.commitSlotCount`. A pin ABOVE the max — the count pulled below it — wears
// its number outlined: the engine no longer services that slot.
//
// Rendering only. All behaviour is js/pins.js. Two clocks: the LIST is rebuilt
// on its own ~6 Hz timer when a change signature moves (a pin arriving, a flag,
// a flag) — never per tick; the LEVELS, playheads and order are written by a
// requestAnimationFrame loop that runs only while the rail is open and touches
// nothing but transforms and a few text nodes. The grain scheduler shares this
// thread (docs/RULINGS.md "Render path"); nothing here allocates per frame.
// ============================================================================

import { S } from './state.js';
import { GROUPS, toggleGroup, toggleSolo, pinsIn, togglePinMute, togglePinSolo,
         selectedPinSlot, applyMix, isPinLeaving, groupOf, isPinAudible, pinAnchorInto } from './pins.js';
import { angleBetweenSphere } from './grain.js';

// The rail's vertical rhythm, in px, mirrored from style.css: the layout is
// done by transform here, so the numbers the stylesheet draws are repeated
// once, in one place.
const BAR_H = 32;            // the track bar — the .tc-icon precedent (GUI-BUILD-SHEET § 4)
const ROW_GAP = 6;           // --sp-3, between bars
const SEL_INSET = 2;         // the selected frame sits this far outside row one (.lyr-sel)

// THE FADER LAW (Ek, 2026-09-16: "i see the mixer as increasing or decreasing
// the volume so should it start at unity 0 then i can make things louder or
// softer? but whatever volume is stamped unity, that's the same volume it
// should be when the cursor is on it"; then "there should be more headroom …
// +6db doesnt sound like it's enough if i really want to make certain things
// louder"). A channel fader: unity is a TICK two thirds along, the right end
// is +12 dB — Pro Tools' range; Ableton and Logic stop at +6 — the left end
// silence. One law, a power curve through both fixed points: level = 4 · pos^k
// with k solving 4 · (2/3)^k = 1, so the third above the tick is the 12 dB of
// gain and the two thirds below taper the way a real fader does (half way
// ≈ −8.6 dB, a quarter ≈ −29). `level` is stored as the AMPLITUDE (1 = unity)
// so the engine multiplies and never sees the law; the rail alone converts,
// both ways. Double-click is the tick. Clipping is the master's to watch, as
// on any desk.
const FADER_MAX = 4;                                   // +12 dB at the right end
const UNITY_POS = 2 / 3;                               // the tick
const FADER_K = Math.log(1 / FADER_MAX) / Math.log(UNITY_POS);
const _levelOf = pos => FADER_MAX * Math.pow(Math.max(0, Math.min(1, pos)), FADER_K);
const _posOf = level => Math.max(0, Math.min(1, Math.pow(Math.max(0, level) / FADER_MAX, 1 / FADER_K)));
// `pin_level` (midi.js): a pot on the selected pin's fader, through the same
// law and the same follow rule as a hand on the bar.
S._setSelectedPinLevel = pos => {
  if (S.commitPlayback === 'focus') return;
  const i = S._selectedPinSlot?.(S._frameCursorLon ?? 0, S._frameCursorLat ?? 0) ?? -1;
  const c = i >= 0 ? S.commitSlots[i] : null;
  if (c) c.level = +_levelOf(pos).toFixed(3);
};
const SEL_ROOM = 8;          // room above row one for the frame's SELECTED label

function _pinName(c) {
  return (c.type === 'cloud' ? 'cloud ' : 'loop ') + (c.slotIndex + 1);
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
    // An overdub counts as a letter: 'r' while its take records, 'B' once
    // sealed — the canvas is redrawn at both, so a layer lands where it is.
    s += c ? `${c.slotIndex}${c.type[0]}${c.mute ? 'm' : ''}${c.solo ? 's' : ''}${(c.overdubs || []).map(o => o.buffer ? 'B' : 'r').join('')}${isPinLeaving(c) ? 'x' : ''}|` : '.';
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

// THE LOOP IS ITS WAVEFORM (Ek, 2026-09-16: the loop's line "tries to follow
// the movement … is there a better way to draw how it's drawn to better
// decipher at a glance what it is"). The line's up-and-down was LATITUDE,
// which the sphere already shows; a track is time against loudness, the way
// every looper and DAW draws a clip. So a loop is a peak envelope of its
// take across the cycle, mirrored on its centre line; an overdub the same
// from its own take, at its phase. Cheap by construction: one pass over the
// samples per PIXEL COLUMN, computed once and cached on the pin (keyed on
// the buffer, the region and the width), redrawn only when the bar is
// rebuilt or resized — nothing per frame. A cloud has no timeline and keeps
// its scatter.
/** The samples a buffer holds, whichever shape it is: a TAKE (`js/take.js`,
 *  `{ data, sampleRate }`) or an AudioBuffer (a pinned loop's — ui-presets.js
 *  buildLoopPayload cuts a crossfaded region with createBuffer; an overdub's
 *  sealed take is one too). Ek, 2026-09-23: "for loops i dont see the actual
 *  waveform … it's just a straight thin boring line" — since the take landed
 *  (2026-09-17) this read `buf.data` alone, which an AudioBuffer has not, so
 *  every loop drew the no-take fallback. */
function _samplesOf(buf) {
  if (!buf) return null;
  if (buf.data) return buf.data;
  if (typeof buf.getChannelData === 'function' && buf.numberOfChannels > 0) return buf.getChannelData(0);
  return null;
}
function _peaks(host, buf, t0, span, cols) {
  const w = host._wave;
  if (w && w.buf === buf && w.t0 === t0 && w.span === span && w.cols === cols) return w.peaks;
  const peaks = new Float32Array(cols);
  const d = _samplesOf(buf);
  if (d && cols > 0) {
    const sr = buf.sampleRate;
    const s0 = Math.max(0, Math.floor(t0 * sr)), s1 = Math.min(d.length, Math.ceil((t0 + span) * sr));
    const step = (s1 - s0) / cols;
    for (let i = 0; i < cols; i++) {
      const a = s0 + Math.floor(i * step), b = Math.min(s1, s0 + Math.floor((i + 1) * step));
      let m = 0;
      for (let k = a; k < b; k++) { const v = d[k] < 0 ? -d[k] : d[k]; if (v > m) m = v; }
      peaks[i] = m;
    }
  }
  host._wave = { buf, t0, span, cols, peaks };
  return peaks;
}
// A peak's height in the band: absolute, so a quiet take draws quiet beside
// a loud one, on a gentle curve so a quiet take still has a shape.
const _peakH = (pk, amp) => amp * Math.pow(Math.min(1, pk), 0.6);
/** Mirrored envelope: columns [i0, i1) of `peaks` drawn from bar x `xa`. */
function _envelope(ctx, peaks, i0, i1, xa, y, amp) {
  ctx.beginPath();
  for (let i = i0; i < i1; i++) { const h = _peakH(peaks[i], amp); ctx.rect(xa + (i - i0), y - h, 1, Math.max(0.6, 2 * h)); }
  ctx.fill();
}

function _drawMaterial(c, cv) {
  const W = cv.clientWidth | 0, H = BAR_H;
  if (W < 8) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  // The engine hue, resolved from the track's --c (a var() over --eng-*).
  const hue = getComputedStyle(cv).getPropertyValue('--c').trim() || '#888';
  ctx.fillStyle = hue; ctx.strokeStyle = hue;
  const x0 = 4, xs = W - 8;

  if (c.type === 'loop') {
    // A loop's take by TIME across the cycle, its loudness as the height —
    // tape plays a take whole.
    const t0 = c.loopStart ?? 0, span = Math.max(1e-6, (c.loopEnd ?? (t0 + 1)) - t0);
    // The master's band gives way to its layers: with n layer rows below it
    // (one per pass, counted first), its centre rises and its wobble
    // narrows so the rows have the bottom of the bar to themselves.
    const spd = Math.abs(c.speed || 1), cyc = span / spd;     // wall seconds per cycle
    const ovs = c.overdubs || [];
    let nRows = 0;
    for (const ov of ovs) { const d = ov.buffer?.duration ?? ov.foldedS ?? ov.layer?.duration ?? 0; if (d > 0 && cyc > 0) nRows += Math.min(8, Math.ceil(d / cyc - 1e-9)); }
    const ampM = nRows ? Math.max(1.5, H / 2 - 2 - 3.2 * nRows) : 8;
    const yM = nRows ? Math.max(ampM + 1, H / 2 - 1.6 * nRows) : H / 2;
    const rowY = L => yM + ampM + 2 + 3.2 * (L - 1);
    const cols = Math.max(1, Math.round(xs));
    ctx.lineWidth = 1.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // EACH OVERDUB WHERE IT LANDED (Ek, 2026-09-16: "if i'm doing a little 1
    // beat loop overdub on the 4th beat it should be in the right position
    // and right length"). The bar is one CYCLE of the master. A layer is its
    // take folded onto that cycle at `phase0` (ui-presets.js _foldOntoCycle),
    // so it is drawn from `phase0` for the take's length — wrapping at the
    // bar's end, and a take longer than the cycle laid once per pass, each
    // pass its own fainter line under the last. The shape is the take's own
    // marks (its stroke, `strokeId`, grainStart in take seconds — the same
    // read as renderer.js _overdubMarks), so a pass with no marks yet is a
    // flat segment of the right length. They used to be copies of the
    // master's line, full width, one under another.
    let L = 1;
    const rowAmp = 1.3;                                  // a row's half height: rows are 3.2 apart
    for (const ov of ovs) {
      const takeDur = ov.buffer?.duration ?? ov.foldedS ?? ov.layer?.duration ?? 0;
      if (!(takeDur > 0) || !(cyc > 0)) continue;
      const ph = (((ov.phase0 || 0) % cyc) + cyc) % cyc;
      // The take's own envelope, one column per bar column — its length in
      // columns is its length in the cycle.
      const tcols = Math.max(1, Math.round(takeDur / cyc * cols));
      const peaks = _samplesOf(ov.buffer) ? _peaks(ov, ov.buffer, 0, takeDur, tcols) : null;
      ctx.globalAlpha = 0.5;
      for (let n = 0, t0 = 0; t0 < takeDur && n < 8; n++, t0 += cyc, L++) {
        const t1 = Math.min(takeDur, t0 + cyc), y = rowY(L);
        // This pass's columns of the take, laid from ph + t0, wrapping once.
        const ci0 = Math.round(t0 / cyc * cols), ci1 = Math.min(tcols, Math.round(t1 / cyc * cols));
        const xa = x0 + (((ph + t0) % cyc) / cyc) * xs;
        const room = Math.round(x0 + xs - xa);              // columns before the bar's end
        const first = Math.min(ci1 - ci0, room);
        if (peaks) {
          _envelope(ctx, peaks, ci0, ci0 + first, xa, y, rowAmp);
          if (ci0 + first < ci1) _envelope(ctx, peaks, ci0 + first, ci1, x0, y, rowAmp);
        } else {
          // Still recording, or no take: a flat segment of the right length.
          ctx.beginPath();
          ctx.rect(xa, y - 0.5, first, 1);
          if (ci0 + first < ci1) ctx.rect(x0, y - 0.5, ci1 - ci0 - first, 1);
          ctx.fill();
        }
      }
    }
    // The master's envelope over its layers.
    ctx.globalAlpha = 0.95;
    const buf = c.buffer ?? c.liveBuffer;
    if (_samplesOf(buf)) _envelope(ctx, _peaks(c, buf, t0, span, cols), 0, cols, x0, yM, ampM);
    else { ctx.beginPath(); ctx.rect(x0, yM - 0.5, xs, 1); ctx.fill(); }
    ctx.globalAlpha = 1;
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

/** The max, from the rail — the one door to the slot count. */
function _setSlotMax(v) {
  const n = Math.max(1, Math.min(16, parseInt(v, 10) || S.commitSlotCount));
  S.commitSlotCount = n;
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
  const follow = S.commitPlayback === 'focus';
  const sort = S.selectionMode ?? 'nearest';
  const full = S.commitOverflow ?? 'off';
  const key = `${follow ? 'f' : ''}${sort}|${full}`;
  if (key === _modesShown) return;
  _modesShown = key;
  const sw = document.getElementById('lyrFollow');
  if (sw) { sw.classList.toggle('on', follow); sw.setAttribute('aria-pressed', String(follow)); }
  // The tracks' titles say who holds the fader, so a follow flip rebuilds them.
  if (_followShown !== follow) { _followShown = follow; S._pinsDirty = true; }
  // `.on`: the sheet's capsule kit, since the rows became the tool rail's (2026-09-22 night).
  document.querySelectorAll('#lyrSort [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === sort));
  document.querySelectorAll('#lyrFull [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === full));
}

let _followShown = null;
function _wireModes() {
  document.getElementById('lyrFollow')?.addEventListener('click', () => {
    S.commitPlayback = S.commitPlayback === 'focus' ? 'all' : 'focus'; S._syncImprovUI?.(); syncModes();
  });
  document.querySelectorAll('#lyrSort [data-v]').forEach(b => b.addEventListener('click', () => {
    S.selectionMode = b.dataset.v; S._syncImprovUI?.(); syncModes(); S._pinsDirty = true;
  }));
  // WHEN FULL — through the cabinet seg, so its own handler (ui-meters.js)
  // stays the one writer of S.commitOverflow.
  document.querySelectorAll('#lyrFull [data-v]').forEach(b => b.addEventListener('click', () => {
    document.querySelector(`#commitOverflowSeg [data-overflow="${b.dataset.v}"]`)?.click();
    syncModes();
  }));
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

/** Place the rows. Transforms only; the list's min-height follows. */
function _layout(force) {
  const box = document.getElementById('lyrList');
  if (!box) return;
  const rows = _ordered();
  const sel = _selected(), dub = _dubMaster();
  const key = rows.map(c => c.slotIndex).join(',') + `|${sel}|${dub}`;
  if (!force && key === _lastOrder) return;
  _lastOrder = key;
  let y = 0;
  for (const c of rows) {
    const el = c._railEl;
    if (!el) continue;
    el.style.transform = `translateY(${y}px)`;
    el.classList.toggle('sel', c.slotIndex === sel);
    el.classList.toggle('dub', c.slotIndex === dub);
    y += BAR_H + ROW_GAP;
  }
  const frame = box.querySelector('.lyr-sel');
  if (frame) frame.style.height = (BAR_H + 2 * SEL_INSET) + 'px';
  box.style.minHeight = rows.length ? (SEL_ROOM + y - ROW_GAP + 2 * ROW_GAP) + 'px' : '';
}

export function renderPinsRail(selected) {
  const box = document.getElementById('lyrList');
  if (!box) return;
  const held = S.commitSlots.some(c => c);

  // THE SELECTED FRAME IS A FIXTURE (Ek, 2026-09-16): row one's place is
  // drawn whether or not a pin is in it, labelled, and "nothing pinned" sits
  // inside it until there is a track to hold. style.css .lyr-sel says why.
  if (!held) {
    box.innerHTML = '<div class="lyr-sel"></div><div class="lyr-empty">nothing pinned</div>';
    box.style.minHeight = (SEL_ROOM + BAR_H + 2 * ROW_GAP) + 'px';
    for (const c of S.commitSlots) if (c) c._railEl = null;
    _lastOrder = '';
    renderBusses();
    return;
  }

  let out = '<div class="lyr-sel"></div>';
  for (const c of S.commitSlots) {
    if (!c) continue;
    const g = groupOf(c), nm = _pinName(c);
    const n = c.overdubs?.length | 0;
    // THE BOX IS THE FADER AND NOTHING ELSE (Ek, 2026-09-23: "the box for the
    // track should be the fader (full) and wavelength … M S id and the loop
    // select icon should be outside"). The number, M and S sat ON the fader
    // and the dub glyph, coming and going as the dub target moved, squeezed
    // the material by 1.4rem each time. Now the row is three columns —
    // number, box, M S — and the box holds only what the fader is: its level,
    // the material, the playhead. The dub target is a RING round its number
    // (`.lyr-trk.dub`), so marking it moves nothing.
    out += `<div class="lyr-trk" style="--c:var(${g?.hue ?? '--eng-grain'})" data-slot="${c.slotIndex}">` +
      `<div class="lyr-trk-row">` +
        `<span class="lyr-num" title="${nm}">${c.slotIndex + 1}</span>` +
        `<div class="lyr-trk-bar" title="${S.commitPlayback === 'focus' ? `${nm} — follow is on: the cursor sets its level` : `${nm} — drag to set its level`}">` +
          `<div class="lyr-fill"></div>` +
          `<div class="lyr-unity"></div>` +
          `<div class="lyr-mat"><canvas></canvas></div>` +
          `<div class="lyr-ph" hidden></div>` +
          (n ? `<span class="lyr-ovd" title="${n} overdub${n === 1 ? '' : 's'}">${'<i></i>'.repeat(n)}</span>` : '') +
          `<span class="lyr-db"></span>` +
          `<div class="lyr-edge"></div>` +
        `</div>` +
        `<span class="lyr-ms">` +
          `<button type="button" class="lyrmute" data-pmute="${c.slotIndex}" aria-pressed="${!!c.mute}" title="${c.mute ? 'unmute' : 'mute'} ${nm} — the playhead keeps running">M</button>` +
          `<button type="button" class="lyrsolo" data-psolo="${c.slotIndex}" aria-pressed="${!!c.solo}" title="solo ${nm}">S</button>` +
        `</span>` +
      `</div>` +
    `</div>`;
  }
  box.innerHTML = out;

  // A REBUILT ROW LANDS, IT DOES NOT SLIDE (Ek, 2026-09-23: "anytime i press
  // mute or solo for pinned items the whole order jumps around even when the
  // order hasn't changed"). Mute and solo are in `_sig`, so they rebuild the
  // rows — fresh elements, each born at translateY(0) with the kit's
  // transform transition on, so every one of them animated from the top of
  // the list to its place. The order had not moved; the rows had. The first
  // layout happens with the transition off, and the next frame hands it back
  // so an order that really changes under the cursor still slides.
  for (const c of S.commitSlots) {
    if (!c) continue;
    const el = box.querySelector(`.lyr-trk[data-slot="${c.slotIndex}"]`);
    c._railEl = el;
    if (!el) continue;
    el.style.transition = 'none';
    _wireTrack(c, el);
  }
  // The canvases need their laid-out width; one frame later they have it.
  requestAnimationFrame(() => {
    for (const c of S.commitSlots) {
      const cv = c?._railEl?.querySelector('canvas');
      if (cv) _drawMaterial(c, cv);
    }
  });
  _layout(true);
  // Commit the untransitioned positions before the transition comes back.
  void box.offsetHeight;
  requestAnimationFrame(() => { for (const c of S.commitSlots) if (c?._railEl) c._railEl.style.transition = ''; });
  renderBusses();
}

function _wireTrack(c, el) {
  const bar = el.querySelector('.lyr-trk-bar');
  // What the frame writes to, found ONCE here rather than four querySelectors
  // per pin per rAF; the material's width is read on the 160 ms tick, never
  // in the frame, so a transform write is not followed by a forced layout.
  c._railRefs = {
    fill: bar.querySelector('.lyr-fill'),
    edge: el.querySelector('.lyr-edge'),
    db:   el.querySelector('.lyr-db'),
    ph:   el.querySelector('.lyr-ph'),
    mat:  el.querySelector('.lyr-mat'),
  };
  c._railMatW = c._railRefs.mat?.clientWidth || 0;
  el.querySelector('[data-pmute]')?.addEventListener('click', e => { e.stopPropagation(); togglePinMute(c); });
  el.querySelector('[data-psolo]')?.addEventListener('click', e => { e.stopPropagation(); togglePinSolo(c); });

  // THE WHOLE BAR IS THE FADER. A press anywhere on it
  // sets the level to where the finger is; a drag rides it. Writes the pin's
  // `level` (grain.js `_loopGain`) — its own number since 2026-09-16, 1 at
  // pin time, over the block's volume rather than into it: a loop's gain
  // node follows the product, a cloud's seed gain carries it.
  // NOT UNDER FOLLOW (Ek, 2026-09-22 night: "if i'm on follow, the cursor
  // distance controls the mixer so it should be disallowed right?"). The bar
  // still shows level × weight moving, in the sensor hue; a hand on it would
  // be a second hand on a fader the cursor holds. The level the hand set
  // before is kept and comes back with follow off.
  const handHolds = () => S.commitPlayback !== 'focus';
  let dragging = false;
  const setFromEvent = e => {
    const r = bar.getBoundingClientRect();
    const pos = (e.clientX - r.left) / Math.max(1, r.width);
    c.level = +_levelOf(pos).toFixed(3);
  };
  bar.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !handHolds()) return;
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
    if (!handHolds()) return;
    c.level = 1;
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
    // The track's three columns, so a bus's box stands under the tracks' boxes
    // and its M S under theirs; it has no number, so that cell is empty.
    out += `<div class="lyr-bus-line" style="--c:var(${g.hue})" data-bus="${g.key}">` +
      `<span></span>` +
      `<div class="lyr-bus-row${g.solo ? ' soloed' : ''}">` +
        `<div class="lyr-fill"></div>` +
        `<span class="lyr-bus-nm">${g.name}<b>${ps.length}</b></span>` +
      `</div>` +
      `<span class="lyr-ms">` +
        `<button type="button" class="lyrmute" data-mute="${g.key}" aria-pressed="${!!g.muted}" title="${g.muted ? 'unmute' : 'mute'} every pinned ${g.name.slice(0, -1)}">M</button>` +
        `<button type="button" class="lyrsolo" data-solo="${g.key}" aria-pressed="${!!g.solo}" title="solo the ${g.name}">S</button>` +
      `</span></div>`;
  }
  box.innerHTML = out;
  for (const g of GROUPS) {
    g._railEl = box.querySelector(`[data-bus="${g.key}"]`);
    g._railFill = g._railEl?.querySelector('.lyr-fill') ?? null;
    g._railEl?.querySelector('[data-mute]')?.addEventListener('click', e => { e.stopPropagation(); toggleGroup(g); });
    g._railEl?.querySelector('[data-solo]')?.addEventListener('click', e => { e.stopPropagation(); toggleSolo(g); });
  }
}

// ── The frame: levels, playheads, the readout ───────────────────────────────
// Reads the audio nodes a loop already carries (`gain × mute × pinWeight` — the
// three gains in series, grain.js) and the envelope and weight a cloud already
// carries; writes transforms. No allocation, no layout read.

function _level(c, focus) {
  const vol = c.level ?? 1;                                 // the fader, not the block's volume
  if (c.slotIndex >= S.commitSlotCount) return 0;     // over the line: not serviced
  const weight = focus ? (S._pinWeights?.[c.slotIndex] || 0) : 1;
  if (c.type === 'loop') {
    // Each gain read from its node when the node exists, and from the FLAG or
    // the WEIGHT it will be built from when it does not yet — a loop whose
    // source is not up is still muted if its mute says so.
    // The node carries block volume × fader; the bar shows the FADER, so
    // the block's stage is divided back out (a stop fade still reads).
    const bv = Math.max(1e-6, c.grainParams?.volume ?? 1);
    const g = c._gainNode ? c._gainNode.gain.value / bv : vol;
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
    const el = c?._railEl, R = c?._railRefs;
    if (!el || !R) continue;
    // The bar is drawn in fader POSITIONS, the law above: unity at the tick.
    const lv = _posOf(_level(c, focus));
    el.classList.toggle('auto', focus);
    el.classList.toggle('over', c.slotIndex >= S.commitSlotCount);
    el.classList.toggle('touched', !!c._railTouched);
    R.fill.style.transform = `scaleX(${lv.toFixed(4)})`;
    if (R.edge) R.edge.style.left = (lv * 100).toFixed(2) + '%';
    // The readout: only when the hand set a level, or it is off unity.
    const vol = c.level ?? 1;
    const dbv = vol <= 0.0005 ? -Infinity : 20 * Math.log10(vol);
    if (R.db) {
      const want = (c._railTouched || Math.abs(dbv) >= 0.05)
        ? (dbv === -Infinity ? '−∞' : (dbv > 0 ? '+' : '') + dbv.toFixed(1))
        : '';
      if (R.db.textContent !== want) R.db.textContent = want;
    }
    if (R.ph) {
      const t = _playhead(c);
      if (t < 0) { if (!R.ph.hidden) R.ph.hidden = true; }
      else {
        if (R.ph.hidden) R.ph.hidden = false;
        R.ph.style.transform = `translateX(${(t * Math.max(0, c._railMatW - 1)).toFixed(1)}px)`;
      }
    }
    busSum[c.type] += lv; busN[c.type]++;
  }
  for (const g of GROUPS) {
    const el = g._railFill; if (!el) continue;
    const n = busN[g.key];
    el.style.transform = `scaleX(${n ? (busSum[g.key] / n).toFixed(3) : 0})`;
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
  // The tool rail's own door, the same ≡ (Ek, 2026-09-23: "the 3 line
  // hamburger that exists in the pin rail should also exist in the tool rail
  // to open up its settings page").
  document.getElementById('toolSettings')?.addEventListener('click', () => {
    S._openSettings?.('tools');
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
      if (c?._railRefs?.mat) c._railMatW = c._railRefs.mat.clientWidth || 0;   // the frame's playhead reads this
    }
    if (!_raf && document.body.classList.contains('pinned-open')) _raf = requestAnimationFrame(_loop);
  }, 160);
  _wireSlotMax();
  _wireModes();
  syncModes();
  renderCount();
  renderPinsRail();
}
