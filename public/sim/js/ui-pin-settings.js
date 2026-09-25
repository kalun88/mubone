// ============================================================================
// UI — SETTINGS → PINS: how every pin comes and goes, and what a new one is born with
// Wires the pins page's live rows — In / Out, which every pin reads LIVE
// (pins.js pinFadeIn / pinFadeOut, 2026-09-23 — no longer stamped on a pin),
// a moving cloud's path direction, the loop release mode and its fade — and
// keeps them honest when OSC or MIDI writes the same values (`S._syncImprovUI`).
// Blend, tether, crossfade and the selected pin LEFT this page on 2026-09-16 —
// the pinned rail's mode bar is their door (js/ui-pins.js) — and the crossfade
// came BACK on 2026-09-23 (Ek): it is set once, not ridden. The seed-mode /
// tether / crossfade rows, the plant / uproot / clear buttons, the selection
// seg and the house / monitor sliders this module still wired had no markup
// left; they went 2026-09-16 (the house volume and monitor → house send keep
// their OSC doors, `/house/volume` and `/monitor/volume`, osc.js). Was
// ui-improv.js — the name of a March "improv mode" that no longer exists —
// until 2026-09-05.
// ============================================================================

import { S } from './state.js';

// ── Init ─────────────────────────────────────────────────────────────────────

export function initPinSettings() {

  // ── Commit path direction (ping-pong / fwd / rev) ────────────────────
  // Stamped at commit creation time — does not retroactively change existing commits.
  const loopModeSeg = document.getElementById('cloudPathDirSeg');
  const syncLoopMode = () => loopModeSeg?.querySelectorAll('[data-loopmode]').forEach(b =>
    b.classList.toggle('active', b.dataset.loopmode === (S.commitCloudLoopMode ?? 'pingpong')));
  loopModeSeg?.querySelectorAll('[data-loopmode]').forEach(btn => {
    btn.addEventListener('click', () => { S.commitCloudLoopMode = btn.dataset.loopmode; syncLoopMode(); });
  });

  // ── Cloud envelope (fade in / fade out) ─────────────────────────────
  const atkSlider = document.getElementById('cloudFadeInSlider');
  const atkNum    = document.getElementById('cloudFadeInNum');
  const relSlider = document.getElementById('cloudFadeOutSlider');
  const relNum    = document.getElementById('cloudFadeOutNum');

  function fmtEnvTime(v) {
    return v < 1 ? (v * 1000).toFixed(0) + 'ms' : v.toFixed(1) + 's';
  }
  const syncEnvelope = () => {
    if (atkSlider) { atkSlider.value = S.commitAttack;  if (atkNum) atkNum.value = fmtEnvTime(S.commitAttack); }
    if (relSlider) { relSlider.value = S.commitRelease; if (relNum) relNum.value = fmtEnvTime(S.commitRelease); }
  };
  atkSlider?.addEventListener('input', () => { S.commitAttack  = parseFloat(atkSlider.value); syncEnvelope(); });
  relSlider?.addEventListener('input', () => { S.commitRelease = parseFloat(relSlider.value); syncEnvelope(); });

  // ── Loop fade out (mode + time) ─────────────────────────────────────
  const lrSeg    = document.getElementById('loopReleaseModeSeg');
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

  // ── Follow crossfade (Ek, 2026-09-23: back from the rail — set once) ──
  const xfSlider = document.getElementById('commitXfadeSlider');
  const xfNum    = document.getElementById('commitXfadeNum');
  const syncXfade = () => {
    const xf = Math.max(0, Math.min(1, S.commitXfade ?? 0.5));
    if (xfSlider) xfSlider.value = String(xf);
    if (xfNum) xfNum.value = Math.round(xf * 100) + '%';
  };
  xfSlider?.addEventListener('input', () => { S.commitXfade = parseFloat(xfSlider.value); syncXfade(); });
  // Double-click resets to the default — kit-wide (GUI-BUILD-SHEET § 5).
  xfSlider?.addEventListener('dblclick', () => { S.commitXfade = 0.5; syncXfade(); });

  // Initial state from what persisted.
  syncEnvelope();
  syncLoopMode();
  syncXfade();

  // ── OSC / MIDI sync hook — an external write shows on the page ─────────
  S._syncImprovUI = () => { syncEnvelope(); syncLoopMode(); syncXfade(); };
}
