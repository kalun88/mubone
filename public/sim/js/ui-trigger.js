// ============================================================================
// UI — TRIGGER PANEL
//
// Wiring for the `device--trigger` panel: the global triggers on/off and the
// defaults the next recorded trigger inherits. The gate lives in js/trigger.js;
// this module only reads and writes S, never touches audio.
//
// There is no tool picker and no disarm here, deliberately. Whether a buffer is
// trigger or granular material is decided by which record button was held
// (⇧space vs space) and is fixed for the life of that buffer, so there is no
// mode to select. And a trigger is a view onto a painted stroke, so the erase
// brush already removes one — a separate disarm would be a second way to do the
// same thing, with different semantics.
// ============================================================================

import { S } from './state.js';
import { quantSpeed } from './tape-pitch.js';

const pct = v => Math.round(v * 100) + '%';
const mul = v => '×' + v.toFixed(2);

function _dim(el, active) {
  if (!el) return;
  el.style.opacity = active ? '' : '0.35';
  el.style.pointerEvents = active ? '' : 'none';
}

export function initTriggerUI() {
  const releaseRow = document.getElementById('trigReleaseRow');
  const chopSeg    = document.getElementById('trigChopSeg');
  const hintEl     = document.getElementById('trigHint');
  const recBtn     = document.getElementById('trigRecordBtn');

  // How triggers play. Global and live — the gate reads these every tick, so
  // moving a slider takes effect immediately on every trigger, including one
  // that is sounding. Nothing here is a "default" for the next recording.
  const td = () => S.triggerParams;

  function syncTriggerUI() {
    const n    = S.triggers?.length ?? 0;
    // Hits are live when the lens is uncapped — there is no second mute since
    // 2026-09-07 (trigger.js). `#trigMuteBtn` went with it: its twin `#scanBtn`
    // owns the state now, and a cabinet control is moved to whatever owns its
    // state rather than left standing on a flag nobody writes.
    const on   = !S.scanMuted;

    // Release reads on every dwell since 2026-09-23 (`fade` fades a one-shot
    // out on exit too), so the row is never dimmed.
    _dim(releaseRow, true);

    // SLICE's switch. Its gap-threshold row went with the gap chopper on
    // 2026-09-22 — onset detection measures against the room's own floor and
    // has no threshold for a performer to dial.
    if (chopSeg) chopSeg.querySelectorAll('[data-chopon]').forEach(b =>
      b.classList.toggle('active', (b.dataset.chopon === 'on') === !!td().sliceOn));

    // The two dials follow the STATE. A pot, OSC or a sensor writes
    // S.triggerParams and calls this; the sliders were only ever written by
    // their own drag, so the rail (which reads them) and the tape tool's
    // capture both kept the old value (2026-09-25).
    for (const [slId, nbId, key, fmt] of [['trigSpeedSlider', 'trigSpeedNum', 'speed', mul], ['trigVolumeSlider', 'trigVolumeNum', 'volume', pct]]) {
      const sl = document.getElementById(slId), nb = document.getElementById(nbId);
      const v = td()[key];
      if (sl && document.activeElement !== sl && Number.isFinite(v)) sl.value = v;
      if (nb && Number.isFinite(v)) nb.value = fmt(v);
    }

    // The hint carries the count — a separate number beside it would be the
    // same fact twice, in a panel that is mostly parameters already.
    // Count only — the record button above already says how to make one, and
    // repeating it here was the same instruction twice.
    if (hintEl) {
      hintEl.textContent = !n ? 'none yet'
        : on ? `${n} on the sphere`
             : `${n} on the sphere · silenced`;
    }
  }

  // Momentary record button — press-and-hold records, release arms. Same
  // pointer-capture shape the erase hold button uses, so dragging off the
  // button mid-take still releases cleanly rather than leaving it recording.
  if (recBtn) {
    recBtn.addEventListener('pointerdown', e => {
      e.preventDefault();
      recBtn.setPointerCapture?.(e.pointerId);
      S._startTriggerRecord?.();
    });
    const release = () => S._stopTriggerRecord?.();
    recBtn.addEventListener('pointerup', release);
    recBtn.addEventListener('pointercancel', release);
  }

  // Lit while a trigger take is recording, from whichever route started it —
  // button, ⇧space or a bound pad.
  S._syncTriggerRecUI = () => {
    if (recBtn) recBtn.classList.toggle('painting', !!S._recordingTrigger);
  };

  if (chopSeg) {
    chopSeg.querySelectorAll('[data-chopon]').forEach(btn => {
      btn.addEventListener('click', () => S._setChopOn?.(btn.dataset.chopon === 'on'));
    });
  }

  // Every path that changes the mute or the trigger set calls this — chip,
  // MIDI, OSC, an accessory pad, recording, erase, undo, session import. None
  // of them fakes a click on another.
  S._syncTriggerUI = syncTriggerUI;

  function bindSlider(sliderId, numId, key, fmt) {
    const sl = document.getElementById(sliderId);
    const nb = document.getElementById(numId);
    if (!sl) return;
    sl.value = td()[key];
    if (nb) nb.value = fmt(td()[key]);
    sl.addEventListener('input', () => {
      let v = parseFloat(sl.value);
      if (key === 'speed') { v = quantSpeed(v); sl.value = v; }   // the tape's `step` snaps the dial
      td()[key] = v;
      if (nb) nb.value = fmt(td()[key]);
    });
  }

  // THE TWO THAT LIVE ON THE SETTINGS PAGE (2026-09-22). `dub decay` is a
  // triggerParam like the rest; `min slice` is in `S.fx`, so it takes its own
  // three lines rather than bending `bindSlider` around a second store.
  bindSlider('setDubDecaySlider', 'setDubDecayNum', 'dubDecay', v => Math.round(v) + '%');
  {
    const sl = document.getElementById('setSliceMinSlider');
    const nb = document.getElementById('setSliceMinNum');
    const fmt = v => (+v > 0 ? Math.round(v) + 'ms' : 'keep all');
    if (sl) {
      sl.value = S.fx?.sliceMinMs ?? 100;
      if (nb) nb.value = fmt(sl.value);
      sl.addEventListener('input', () => {
        const v = parseFloat(sl.value);
        if (S.fx) S.fx.sliceMinMs = v;
        if (nb) nb.value = fmt(v);
      });
    }
  }

  // GRAIN'S ARRIVAL SET, on the settings page (2026-09-22). Its own store, so
  // these write `S.grainTrigger` rather than `triggerParams` — that IS the
  // split. No cabinet twin to proxy: grain never had one, because until walk on
  // touch it had no gate.
  {
    const paint = () => document.querySelectorAll('#setPanelTools [data-gset]').forEach(b =>
      b.classList.toggle('active', S.grainTrigger?.[b.dataset.gset] === b.dataset.val));
    document.querySelectorAll('#setPanelTools [data-gset]').forEach(b =>
      b.addEventListener('click', () => {
        if (S.grainTrigger) S.grainTrigger[b.dataset.gset] = b.dataset.val;
        paint();
      }));
    paint();
    const sl = document.getElementById('setGrainRearmSlider');
    const nb = document.getElementById('setGrainRearmNum');
    if (sl) {
      sl.value = S.grainTrigger?.rearmMs ?? 120;
      if (nb) nb.value = Math.round(sl.value) + 'ms';
      sl.addEventListener('input', () => {
        const v = parseFloat(sl.value);
        if (S.grainTrigger) S.grainTrigger.rearmMs = v;
        if (nb) nb.value = Math.round(v) + 'ms';
      });
    }
  }
  // THE RELEASE FADE, one per instrument (2026-09-22 night). Both `fade`
  // releases borrowed the pins' unpin fade — 15 ms, a cut — so a walker or a
  // loop "just stopped" when the cursor left (Ek). Each arrival set holds its
  // own `releaseMs` now, set here beside its Release capsule.
  {
    const fmt = v => (+v >= 1000 ? (v / 1000).toFixed(1) + 's' : Math.round(v) + 'ms');
    const bindFade = (slId, nbId, store) => {
      const sl = document.getElementById(slId), nb = document.getElementById(nbId);
      const o = store(); if (!sl || !o) return;
      sl.value = o.releaseMs ?? 250;
      if (nb) nb.value = fmt(sl.value);
      sl.addEventListener('input', () => { o.releaseMs = parseFloat(sl.value); if (nb) nb.value = fmt(sl.value); });
    };
    bindFade('setTrigFadeSlider',  'setTrigFadeNum',  () => S.triggerParams);
    bindFade('setGrainFadeSlider', 'setGrainFadeNum', () => S.grainTrigger);
  }

  function bindSeg(segId, dataKey, stateKey) {
    const seg = document.getElementById(segId);
    if (!seg) return;
    const sel = `[data-${dataKey}]`;
    const sync = () => seg.querySelectorAll(sel).forEach(b =>
      b.classList.toggle('active', b.dataset[dataKey] === td()[stateKey]));
    seg.querySelectorAll(sel).forEach(btn => {
      btn.addEventListener('click', () => {
        td()[stateKey] = btn.dataset[dataKey];
        sync();
        syncTriggerUI();   // dwell governs whether the release row is live
      });
    });
    sync();
  }

  bindSlider('trigRearmSlider',  'trigRearmNum',  'rearmMs',   v => Math.round(v) + 'ms');
  bindSlider('trigVolumeSlider', 'trigVolumeNum', 'volume',    pct);
  bindSlider('trigSpeedSlider',  'trigSpeedNum',  'speed',     mul);
  bindSeg('trigDwellSeg',   'dwell',    'dwell');
  bindSeg('trigStartSeg',   'start',    'start');
  bindSeg('trigReleaseSeg', 'trelease', 'release');
  bindSeg('trigRetrigSeg',  'retrig',   'retrig');

  syncTriggerUI();
  S._syncTriggerRecUI();
}
