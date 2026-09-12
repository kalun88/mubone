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
  const chopGapRow = document.getElementById('trigChopGapRow');
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

    // Release governs how a LOOPING trigger stops; 'once' and 'grain' both play
    // through, so it has nothing to say about them. Only dimmed within a live
    // section — dimming a row inside a dimmed parent multiplies to 0.12, which
    // reads as a rendering fault rather than as an inactive control.
    _dim(releaseRow, td().dwell === 'loop');

    // Chop's switch and its threshold are separate so the value survives being
    // toggled off — the gap row just dims rather than resetting.
    if (chopSeg) chopSeg.querySelectorAll('[data-chopon]').forEach(b =>
      b.classList.toggle('active', (b.dataset.chopon === 'on') === !!td().chopOn));
    _dim(chopGapRow, !!td().chopOn);

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
      td()[key] = parseFloat(sl.value);
      if (nb) nb.value = fmt(td()[key]);
    });
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
  bindSlider('trigChopSlider',   'trigChopNum',   'chop',      v => Math.round(v) + 'ms');
  bindSlider('trigVolumeSlider', 'trigVolumeNum', 'volume',    pct);
  bindSlider('trigSpeedSlider',  'trigSpeedNum',  'speed',     mul);
  bindSeg('trigDwellSeg',   'dwell',    'dwell');
  bindSeg('trigStartSeg',   'start',    'start');
  bindSeg('trigReleaseSeg', 'trelease', 'release');
  bindSeg('trigRetrigSeg',  'retrig',   'retrig');

  syncTriggerUI();
  S._syncTriggerRecUI();
}
