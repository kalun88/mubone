// ============================================================================
// UI — IMPROV MODE CONTROLS
// Controls for Phase 1-4 improv features:
//   Phase 1 — monitor/house bus split (house vol, monitor→house send)
//   Phase 3 — nearest-cloud navigation (cloud mode, snap/fade)
//   Phase 4 — gesture morph (morph enable, hold mode)
// ============================================================================

import { S } from './state.js';

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

  // ── Cloud mode (collage / nearest) ─────────────────────────────────────
  const cloudModeSeg = document.getElementById('improvCloudModeSeg');
  const alwaysRow    = document.getElementById('improvAlwaysRow');
  const alwaysSeg    = document.getElementById('improvAlwaysSeg');
  const snapRow      = document.getElementById('improvSnapRow');

  function dimNearestRows(isNearest) {
    if (alwaysRow) { alwaysRow.style.opacity = isNearest ? '1' : '0.35'; alwaysRow.style.pointerEvents = isNearest ? '' : 'none'; }
    if (snapRow)   { snapRow.style.opacity   = isNearest ? '1' : '0.35'; snapRow.style.pointerEvents   = isNearest ? '' : 'none'; }
  }

  function applyCloudMode(mode) {
    S.cloudMode = mode;
    setSegActive(cloudModeSeg, b => b.dataset.mode === mode);
    dimNearestRows(mode === 'nearest');
  }

  cloudModeSeg?.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => applyCloudMode(btn.dataset.mode));
  });

  // Init from state
  applyCloudMode(S.cloudMode ?? 'collage');

  // ── Always toggle (nearest: always-on vs radius-gated) ────────────────
  function applyAlways(on) {
    S.cloudNearestAlways = on;
    if (alwaysSeg) {
      alwaysSeg.querySelectorAll('[data-always]').forEach(btn => {
        btn.classList.toggle('active', (btn.dataset.always === 'on') === on);
      });
    }
  }

  alwaysSeg?.querySelectorAll('[data-always]').forEach(btn => {
    btn.addEventListener('click', () => applyAlways(btn.dataset.always === 'on'));
  });
  applyAlways(S.cloudNearestAlways ?? true);

  // ── Snap / fade (nearest sharpness 0–1) ────────────────────────────────
  const snapSlider = document.getElementById('improvSnapSlider');
  const snapNum    = document.getElementById('improvSnapNum');

  function applySnap(v) {
    S.cloudSnapFade = v;
    if (snapSlider) snapSlider.value = v;
    if (snapNum)    snapNum.value    = pct(v);
  }

  snapSlider?.addEventListener('input', () => applySnap(parseFloat(snapSlider.value)));
  applySnap(S.cloudSnapFade ?? 0);

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
    if (monNum)    monNum.value    = S.cursorHouseMuted ? '(muted)' : pct(v);
    if (S.monitorToHouseGain && S.audioCtx) {
      // Respect cursor house mute — store the value but don't apply it to the gain
      // node while muted. setCursorHouseMuted() will restore it on unmute.
      const effectiveGain = S.cursorHouseMuted ? 0 : v;
      S.monitorToHouseGain.gain.setTargetAtTime(effectiveGain, S.audioCtx.currentTime, 0.02);
    }
  }

  monSlider?.addEventListener('input', () => applyMonitor(parseFloat(monSlider.value)));
  applyMonitor(S.monitorGainValue ?? 0.0);

  // ── Morph enable (on / off) ─────────────────────────────────────────────
  const morphSeg = document.getElementById('improvMorphSeg');

  function applyMorph(enabled) {
    S.morphEnabled = enabled;
    setSegActive(morphSeg, b => (b.dataset.morph === 'on') === enabled);
  }

  morphSeg?.querySelectorAll('[data-morph]').forEach(btn => {
    btn.addEventListener('click', () => applyMorph(btn.dataset.morph === 'on'));
  });

  applyMorph(S.morphEnabled ?? true);

  // ── Morph hold mode (momentum / elastic) ───────────────────────────────
  const holdSeg = document.getElementById('improvHoldSeg');

  function applyHold(mode) {
    S.morphHoldMode = mode;
    setSegActive(holdSeg, b => b.dataset.hold === mode);
  }

  holdSeg?.querySelectorAll('[data-hold]').forEach(btn => {
    btn.addEventListener('click', () => applyHold(btn.dataset.hold));
  });

  applyHold(S.morphHoldMode ?? 'momentum');

  // ── OSC sync hook — so external OSC changes reflect in the UI ──────────
  // Called from osc.js after it writes a new value to S
  S._syncImprovUI = () => {
    if (snapSlider)  snapSlider.value  = S.cloudSnapFade ?? 0;
    if (snapNum)     snapNum.value     = pct(S.cloudSnapFade ?? 0);
    if (houseSlider) houseSlider.value = S.houseGainValue ?? 1;
    if (houseNum)    houseNum.value    = mul(S.houseGainValue ?? 1);
    if (monSlider)   monSlider.value   = S.monitorGainValue ?? 0;
    if (monNum)      monNum.value      = S.cursorHouseMuted ? '(muted)' : pct(S.monitorGainValue ?? 0);
    applyCloudMode(S.cloudMode ?? 'collage');
    applyAlways(S.cloudNearestAlways ?? true);
    applyMorph(S.morphEnabled ?? true);
    applyHold(S.morphHoldMode ?? 'momentum');
  };
}
