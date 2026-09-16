// ============================================================================
// UI — SETTINGS → PINS, and the monitor/house split
// Wires the pins page: what a new pin is born with (in / out, path), the loop
// release mode and fade, pin / unpin / clear, and the monitor→house sliders on
// the audio side. Blend, tether, crossfade and the selected pin LEFT this page
// on 2026-09-16 — the pinned rail's mode bar is their door (js/ui-pins.js),
// and Ek: "any pin settings that are now on the pin rail can be removed from
// the settings page". The apply* functions below stay because they are how S
// takes its defaults and how `S._syncImprovUI` refreshes whatever controls are
// present; every element read is optional. Was ui-improv.js — the name of a
// March "improv mode" that no longer exists — until 2026-09-05; the element
// ids (improvHouseSlider…) still carry the old word.
// ============================================================================

import { S } from './state.js';
import { plantSeed, uprootNearestSeed, clearAllSeeds, updateSeedBanksUI } from './ui-presets.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function pct(v) { return Math.round(v * 100) + '%'; }
function mul(v) { return '×' + v.toFixed(2); }

// Set active state on a segment button group
function setSegActive(segEl, matchFn) {
  segEl?.querySelectorAll('[data-mode],[data-morph],[data-hold],[data-always]').forEach(btn => {
    btn.classList.toggle('active', matchFn(btn));
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initPinSettings() {

  // ── Seed mode (all / focus) ──────────────────────────────────────────
  const seedModeSeg = document.getElementById('seedModeSelect');
  const alwaysRow    = document.getElementById('improvAlwaysRow');
  const alwaysSeg    = document.getElementById('seedAlwaysSeg');
  const snapRow      = document.getElementById('improvSnapRow');

  // A row that is not available wears `.set-row--off`, which dims the CONTROL
  // and steps the title one stop down the ramp. It must never be an inline
  // style: an inline write outranks the stylesheet exactly the way the markup's
  // old `style="opacity:0.35"` did, so the class would be there and do nothing.
  // THE REASON BELONGS TO THE STATE, NOT THE PROSE (2026-09-14): a description
  // is what the control IS; why it is unavailable right now is what the off
  // state says, in the row's own status line. The two rows this dimmed (tether,
  // crossfade) are the rail's since 2026-09-16, where width steps down under
  // `all` the same way; the helper stays for the next row that needs it.
  const setRowOff = (row, off, why) => {
    if (!row) return;
    row.classList.toggle('set-row--off', off);
    if (off) row.setAttribute('aria-disabled', 'true'); else row.removeAttribute('aria-disabled');
    const text = row.querySelector('.set-row-text');
    let note = row.querySelector('.set-row-status--why');
    if (off && why) {
      if (!note) {
        note = document.createElement('span');
        note.className = 'set-row-status set-row-status--why';
        text?.appendChild(note);
      }
      if (note.textContent !== why) note.textContent = why;
      note.hidden = false;
    } else if (note) note.hidden = true;
  };

  function dimFocusRows(isFocus) {
    setRowOff(alwaysRow, !isFocus, 'Focus only');
    // xfade only active in focus mode AND tether on — and it says WHICH of the
    // two is missing, because "Focus only" on a row that is already in Focus is
    // a reason that reads as a lie.
    setRowOff(snapRow, !(isFocus && S.seedTether), isFocus ? 'needs Tether on' : 'Focus only');
  }

  function applySeedMode(mode) {
    S.seedMode = mode;
    setSegActive(seedModeSeg, b => b.dataset.mode === mode);
    dimFocusRows(mode === 'focus');
  }

  seedModeSeg?.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => applySeedMode(btn.dataset.mode));
  });

  // Init from state
  applySeedMode(S.seedMode ?? 'all');

  // ── Tether toggle (focus: always-on vs radius-gated) ────────────────
  function applyTether(on) {
    S.seedTether = on;
    if (alwaysSeg) {
      alwaysSeg.querySelectorAll('[data-always]').forEach(btn => {
        btn.classList.toggle('active', (btn.dataset.always === 'on') === on);
      });
    }
    // Refresh xfade row dimming — xfade only active when tether is on
    dimFocusRows(S.seedMode === 'focus');
  }

  alwaysSeg?.querySelectorAll('[data-always]').forEach(btn => {
    btn.addEventListener('click', () => applyTether(btn.dataset.always === 'on'));
  });
  applyTether(S.seedTether ?? false);

  // ── Crossfade (focus blend sharpness 0–1) ──────────────────────────────
  const snapSlider = document.getElementById('improvSnapSlider');
  const snapNum    = document.getElementById('improvSnapNum');

  function applyCrossfade(v) {
    S.seedXfade = v;
    if (snapSlider) snapSlider.value = v;
    if (snapNum)    snapNum.value    = pct(v);
  }

  snapSlider?.addEventListener('input', () => applyCrossfade(parseFloat(snapSlider.value)));
  applyCrossfade(S.seedXfade ?? 0.5);

  // ── House volume (0–2) ──────────────────────────────────────────────────
  const houseSlider = document.getElementById('improvHouseSlider');
  const houseNum    = document.getElementById('improvHouseNum');

  function applyHouse(v) {
    S.houseGainValue = v;
    if (houseSlider) houseSlider.value = v;
    if (houseNum)    houseNum.value    = mul(v);
    if (S.houseGainNode && S.audioCtx) {
      S.houseGainNode.gain.setTargetAtTime(v, S.audioCtx.currentTime, 0.02);
    }
  }

  houseSlider?.addEventListener('input', () => applyHouse(parseFloat(houseSlider.value)));
  applyHouse(S.houseGainValue ?? 1.0);

  // ── Monitor → house send (0–1) ──────────────────────────────────────────
  const monSlider = document.getElementById('improvMonitorSlider');
  const monNum    = document.getElementById('improvMonitorNum');

  function applyMonitor(v) {
    S.monitorGainValue = v;
    if (monSlider) monSlider.value = v;
    if (monNum)    monNum.value    = S.scanMuted ? '(muted)' : pct(v);
    if (S.monitorToHouseGain && S.audioCtx) {
      // Respect scan state — store the value but don't apply it to the gain
      // node while scan is off. setScanMuted() will restore it on unmute.
      const effectiveGain = S.scanMuted ? 0 : v;
      S.monitorToHouseGain.gain.setTargetAtTime(effectiveGain, S.audioCtx.currentTime, 0.02);
    }
  }

  monSlider?.addEventListener('input', () => applyMonitor(parseFloat(monSlider.value)));
  applyMonitor(S.monitorGainValue ?? 0.0);


  // ── Seed plant / uproot / clear all ─────────────────────────────────────
  const plantBtn  = document.getElementById('seedPlantBtn');
  const uprootBtn = document.getElementById('seedUprootBtn');
  const clearBtn  = document.getElementById('seedClearBtn');

  function refreshSeedBtns() {
    // All seed buttons stay always visible/enabled — consistent UI, no fading
  }

  plantBtn?.addEventListener('click', () => { plantSeed(); refreshSeedBtns(); });
  uprootBtn?.addEventListener('click', () => { uprootNearestSeed(); refreshSeedBtns(); });
  clearBtn?.addEventListener('click', () => { clearAllSeeds(); refreshSeedBtns(); });

  // ── The selected pin (nearest / oldest — what unpin takes, pins.js) ──
  const selectionSeg = document.getElementById('commitSelectionSeg');
  if (selectionSeg) {
    selectionSeg.querySelectorAll('[data-selection]').forEach(btn => {
      btn.addEventListener('click', () => {
        S.selectionMode = btn.dataset.selection;
        selectionSeg.querySelectorAll('[data-selection]').forEach(b =>
          b.classList.toggle('active', b.dataset.selection === S.selectionMode));
      });
    });
    // Init from state
    selectionSeg.querySelectorAll('[data-selection]').forEach(b =>
      b.classList.toggle('active', b.dataset.selection === (S.selectionMode ?? 'nearest')));
  }

  // ── Commit path direction (ping-pong / fwd / rev) ────────────────────
  // Stamped at commit creation time — does not retroactively change existing commits.
  const loopModeSeg = document.getElementById('seedLoopModeSeg');
  if (loopModeSeg) {
    loopModeSeg.querySelectorAll('[data-loopmode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.loopmode;
        S.seedLoopMode = mode;
        loopModeSeg.querySelectorAll('[data-loopmode]').forEach(b =>
          b.classList.toggle('active', b.dataset.loopmode === mode));
      });
    });
  }

  // Expose updateSeedBanksUI on S so renderer.js can call it,
  // and chain our button state refresh into it.
  S.updateSeedBanksUI = () => { updateSeedBanksUI(); refreshSeedBtns(); };

  // ── Cloud envelope (fade in / fade out) ─────────────────────────────
  const atkSlider = document.getElementById('seedAttackSlider');
  const atkNum    = document.getElementById('seedAttackNum');
  const relSlider = document.getElementById('seedReleaseSlider');
  const relNum    = document.getElementById('seedReleaseNum');

  function fmtEnvTime(v) {
    return v < 1 ? (v * 1000).toFixed(0) + 'ms' : v.toFixed(1) + 's';
  }
  if (atkSlider) {
    atkSlider.addEventListener('input', () => {
      S.seedAttack = parseFloat(atkSlider.value);
      if (atkNum) atkNum.value = fmtEnvTime(S.seedAttack);
    });
  }
  if (relSlider) {
    relSlider.addEventListener('input', () => {
      S.seedRelease = parseFloat(relSlider.value);
      if (relNum) relNum.value = fmtEnvTime(S.seedRelease);
    });
  }

  // Sync seed envelope sliders from persisted state
  if (atkSlider) { atkSlider.value = S.seedAttack; if (atkNum) atkNum.value = fmtEnvTime(S.seedAttack); }
  if (relSlider) { relSlider.value = S.seedRelease; if (relNum) relNum.value = fmtEnvTime(S.seedRelease); }

  // ── Loop fade out (mode + time) ─────────────────────────────────────
  const lrSeg = document.getElementById('loopReleaseModeSeg');
  const lfSlider = document.getElementById('loopFadeTimeSlider');
  const lfNum    = document.getElementById('loopFadeTimeNum');

  if (lrSeg) {
    lrSeg.querySelectorAll('[data-lrmode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lrmode === S.loopReleaseMode);
      btn.addEventListener('click', () => {
        S.loopReleaseMode = btn.dataset.lrmode;
        lrSeg.querySelectorAll('[data-lrmode]').forEach(b =>
          b.classList.toggle('active', b.dataset.lrmode === S.loopReleaseMode));
      });
    });
  }

  function fmtFadeMs(v) {
    return v < 1000 ? Math.round(v) + 'ms' : (v / 1000).toFixed(1) + 's';
  }
  if (lfSlider) {
    lfSlider.value = S.loopFadeTimeMs;
    if (lfNum) lfNum.value = fmtFadeMs(S.loopFadeTimeMs);
    lfSlider.addEventListener('input', () => {
      S.loopFadeTimeMs = parseFloat(lfSlider.value);
      if (lfNum) lfNum.value = fmtFadeMs(S.loopFadeTimeMs);
    });
  }

  // Initial state
  refreshSeedBtns();
  updateSeedBanksUI();
  // Sync loop mode toggle from persisted state
  if (loopModeSeg) loopModeSeg.querySelectorAll('[data-loopmode]').forEach(b =>
    b.classList.toggle('active', b.dataset.loopmode === (S.seedLoopMode ?? 'pingpong')));

  // ── Expose setters for MIDI/OSC access ─────────────────────────────────

  // ── OSC sync hook — so external OSC changes reflect in the UI ──────────
  // Called from osc.js after it writes a new value to S
  S._syncImprovUI = () => {
    if (atkSlider) { atkSlider.value = S.seedAttack; if (atkNum) atkNum.value = fmtEnvTime(S.seedAttack); }
    if (relSlider) { relSlider.value = S.seedRelease; if (relNum) relNum.value = fmtEnvTime(S.seedRelease); }
    if (snapSlider)  snapSlider.value  = S.seedXfade ?? 0.5;
    if (snapNum)     snapNum.value     = pct(S.seedXfade ?? 0.5);
    if (houseSlider) houseSlider.value = S.houseGainValue ?? 1;
    if (houseNum)    houseNum.value    = mul(S.houseGainValue ?? 1);
    if (monSlider)   monSlider.value   = S.monitorGainValue ?? 0;
    if (monNum)      monNum.value      = S.scanMuted ? '(muted)' : pct(S.monitorGainValue ?? 0);
    applySeedMode(S.seedMode ?? 'all');
    applyTether(S.seedTether ?? false);
    // Sync loop mode toggle
    const lmSeg = document.getElementById('seedLoopModeSeg');
    if (lmSeg) lmSeg.querySelectorAll('[data-loopmode]').forEach(b =>
      b.classList.toggle('active', b.dataset.loopmode === (S.seedLoopMode ?? 'pingpong')));
    const selSeg = document.getElementById('commitSelectionSeg');
    if (selSeg) selSeg.querySelectorAll('[data-selection]').forEach(b =>
      b.classList.toggle('active', b.dataset.selection === (S.selectionMode ?? 'nearest')));
  };
}
