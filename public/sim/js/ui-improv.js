// ============================================================================
// UI — IMPROV MODE CONTROLS
// Controls for Phase 1-4 improv features:
//   Phase 1 — monitor/house bus split (house vol, monitor→house send)
//   Phase 3 — nearest-seed navigation (seed mode, snap/fade)
//   Phase 4 — gesture morph (morph enable, hold mode)
// ============================================================================

import { S, MAX_SEEDS } from './state.js';
import { plantSeed, uprootNearestSeed, clearAllSeeds, updateSeedBanksUI } from './ui-presets.js';
import { findNearestSeedSlot } from './grain.js';
import { getCursorLonLat, screenToLonLat } from './sphere.js';

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

export function initImprovUI() {

  // ── Seed mode (all / focus) ──────────────────────────────────────────
  const seedModeSeg = document.getElementById('seedModeSelect');
  const alwaysRow    = document.getElementById('improvAlwaysRow');
  const alwaysSeg    = document.getElementById('seedAlwaysSeg');
  const snapRow      = document.getElementById('improvSnapRow');

  function dimFocusRows(isFocus) {
    if (alwaysRow) { alwaysRow.style.opacity = isFocus ? '1' : '0.35'; alwaysRow.style.pointerEvents = isFocus ? '' : 'none'; }
    // xfade only active in focus mode AND tether on
    const xfadeActive = isFocus && S.seedTether;
    if (snapRow) { snapRow.style.opacity = xfadeActive ? '1' : '0.35'; snapRow.style.pointerEvents = xfadeActive ? '' : 'none'; }
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

  // ── Seed loop mode (ping-pong / forward) ─────────────────────────────
  const loopModeSeg = document.getElementById('seedLoopModeSeg');
  if (loopModeSeg) {
    loopModeSeg.querySelectorAll('[data-loopmode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.loopmode;
        S.seedLoopMode = mode;
        loopModeSeg.querySelectorAll('[data-loopmode]').forEach(b =>
          b.classList.toggle('active', b.dataset.loopmode === mode));
        // Apply only to the nearest highlighted seed (not all seeds)
        const { lon, lat } = S.mouseInCanvas
          ? screenToLonLat(S.mousePixelX, S.mousePixelY)
          : getCursorLonLat();
        const nearestSlot = findNearestSeedSlot(lon, lat);
        if (nearestSlot >= 0) {
          const seed = S.seedSlots[nearestSlot];
          if (seed && seed.frames) seed.loopMode = mode;
        }
        (S.updateSeedBanksUI || updateSeedBanksUI)();
      });
    });
  }

  // Expose updateSeedBanksUI on S so renderer.js can call it,
  // and chain our button state refresh into it.
  S.updateSeedBanksUI = () => { updateSeedBanksUI(); refreshSeedBtns(); };

  // ── Seed envelope (attack / release) ────────────────────────────────
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

  // Initial state
  refreshSeedBtns();
  updateSeedBanksUI();
  // Sync loop mode toggle from persisted state
  if (loopModeSeg) loopModeSeg.querySelectorAll('[data-loopmode]').forEach(b =>
    b.classList.toggle('active', b.dataset.loopmode === (S.seedLoopMode ?? 'pingpong')));

  // ── Expose setters for MIDI/OSC access ─────────────────────────────────
  S._setMonitorVolume = applyMonitor;
  S._setHouseVolume   = applyHouse;

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
  };
}
