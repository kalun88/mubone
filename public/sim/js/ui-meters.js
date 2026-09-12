// ============================================================================
// UI-METERS — shared multi-channel VU meter system
// Used by: ui-audio-settings.js (modal meters) and main window (in/out meters)
// ============================================================================

import {
  S, GATE_METER_MAX, GATE_METER_GAMMA,
  GATE_METER_TICK_MS, GATE_METER_ATTACK_MS, GATE_METER_RELEASE_MS,
  GATE_METER_PEAK_HOLD_MS, GATE_METER_PEAK_FALL_MS,
} from './state.js';
import { dropSeqFromCursor, clearAllSeqs, releaseCommit, clearAllCommits, updateCommitBanksUI, updateSeqBanksUI } from './ui-presets.js';
import { tickHandsfree } from './handsfree.js';
import { readGateLoudness } from './audio-features.js';
import { updateDryMonitorPanning, setDryMonitorGain, setDryMonitorMode, isDryMonitorDucked } from './audio.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

// Return the azimuth in degrees as a compact label (e.g. "0", "45", "315").
// No directional names — just the angle number so users see the actual position.
export function shortAngleName(deg) {
  const d = ((deg % 360) + 360) % 360;
  return `${Math.round(d)}`;
}

// ── Multi-channel meter rendering ─────────────────────────────────────────────
// Creates N vertical canvas VU bars inside a container element.
// Each bar has: a clip indicator dot, a canvas bar, and a channel label.
// selectedCh:    index or array of indices — those bars get a highlight outline.
// separatorBefore: insert a thin visual divider before this channel index,
//                  used to separate house buses from the L/R mixdown pair.
export function renderMeters(containerId, numCh, labels, selectedCh, separatorBefore) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  invalidateMeterCache(containerId);  // DOM is about to be rebuilt
  const highlighted = Array.isArray(selectedCh) ? selectedCh : (selectedCh !== undefined ? [selectedCh] : []);
  wrap.innerHTML = '';
  for (let i = 0; i < numCh; i++) {
    if (i === separatorBefore) {
      const sep = document.createElement('div');
      sep.className = 'as-vchan-sep';
      wrap.appendChild(sep);
    }

    const ch = document.createElement('div');
    ch.className = 'as-vchan';
    // Selection is styled in CSS, not inline: the settings modal wants an
    // outlined box, the footer rail wants an underline (a box around a bare
    // 12px bar reads as a stray rectangle there).
    if (highlighted.includes(i)) ch.classList.add('is-selected');

    const clip = document.createElement('div');
    clip.className = 'as-vchan-clip';
    clip.id = `${containerId}-clip-${i}`;

    const canvas = document.createElement('canvas');
    // Backing store, not display size — CSS decides how wide the bar reads.
    canvas.width  = 14;
    canvas.height = 56;
    canvas.id = `${containerId}-cv-${i}`;

    const lbl = document.createElement('div');
    lbl.className = 'as-vchan-label';
    lbl.textContent = labels?.[i] ?? String(i + 1);

    ch.append(clip, canvas, lbl);
    wrap.appendChild(ch);
  }
}

// Draw one frame of meters for an array of AnalyserNodes into a given container.
// DOM refs and gradients are cached per containerId to avoid per-frame lookups
// and allocations — previously ~500 getElementById calls/sec and 240 gradient
// allocations/sec were stealing main-thread time from the grain scheduler.
const _meterBuf = new Float32Array(256);
const _meterCache = new Map(); // containerId → { canvases, clips, ctxs, grads }

function _getMeterCache(containerId, count) {
  let entry = _meterCache.get(containerId);
  if (entry && entry.count === count) return entry;
  // Build / rebuild cache
  const canvases = [], clips = [], ctxs = [], grads = [];
  for (let i = 0; i < count; i++) {
    const cv   = document.getElementById(`${containerId}-cv-${i}`);
    const clip = document.getElementById(`${containerId}-clip-${i}`);
    canvases.push(cv);
    clips.push(clip);
    if (cv) {
      const c2 = cv.getContext('2d');
      ctxs.push(c2);
      // ── The meter ramp (#264, Ek: "pretty much exactly like Ableton's") ──
      // The gradient is fixed to the SCALE, not to the level: the top of the
      // bar is always red and rising level reveals more of the ramp, which is
      // what makes a meter readable at a glance — a colour means a dB, always
      // the same dB. (A ramp keyed to the current level instead just changes
      // hue as it moves and tells you nothing.)
      // Stops are placed in dB, not in fractions of the bar: the canvas maps
      // -60…0 dBFS over its height, so 0.80 is -12 dB and 0.90 is -6 dB.
      // The ramp reads as TEMPERATURE, not as a traffic light (2026-08-29).
      // Green → yellow → red is a mixing-console convention inherited from
      // hardware that had LEDs in three colours; on a stage whose whole palette
      // is warm ivory and terracotta it was the loudest and coldest object on
      // screen, and it was drawing the eye to a meter instead of to the sphere.
      // The CONTRACT is untouched — a colour still means a dB, always the same
      // dB — only the family changed: ash at the floor, the horizon's own bone
      // through the useful range, ember as it gets hot, brick for the last 3.
      const grad = c2.createLinearGradient(0, cv.height, 0, 0);
      grad.addColorStop(0.00, '#77856c');   // −60 dB  ash-sage floor
      grad.addColorStop(0.50, '#94a37e');   // −30 dB  sage
      grad.addColorStop(0.80, '#d8caa5');   // −12 dB  bone — the good-level zone
      grad.addColorStop(0.90, '#e07b3c');   //  −6 dB  ember
      grad.addColorStop(0.95, '#cc6a55');   //  −3 dB  brick — the last 3 dB are
      grad.addColorStop(1.00, '#cc6a55');   //   0 dB  unambiguously hot
      grads.push(grad);
    } else {
      ctxs.push(null);
      grads.push(null);
    }
  }
  // Cache the container element so tickMeters can cheaply check whether the
  // meters are inside a collapsed panel (perf audit M3 / TODO #116).
  const container = document.getElementById(containerId);
  entry = { count, canvases, clips, ctxs, grads, container };
  _meterCache.set(containerId, entry);
  return entry;
}

// Call when meters are rebuilt (renderMeters) to invalidate stale DOM refs.
export function invalidateMeterCache(containerId) {
  if (containerId) _meterCache.delete(containerId);
  else _meterCache.clear();
}

export function tickMeters(analysers, containerId) {
  const cache = _getMeterCache(containerId, analysers.length);
  // Skip analyser reads + canvas draws when the meters sit inside a collapsed
  // panel or section (perf audit M3 / TODO #116). Collapse is CSS-only — the
  // loops used to keep running at full rate against hidden canvases. The
  // AnalyserNodes stay connected (disconnect/reconnect churn isn't worth it);
  // closest('.collapsed') is a few-ancestor walk, trivial vs the work saved.
  if (cache.container && cache.container.closest('.collapsed')) return;
  for (let i = 0; i < analysers.length; i++) {
    const an = analysers[i];
    if (!an) continue;
    an.getFloatTimeDomainData(_meterBuf);
    let peak = 0;
    for (let s = 0; s < _meterBuf.length; s++) peak = Math.max(peak, Math.abs(_meterBuf[s]));
    const db  = peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
    const pct = clamp((db + 60) / 60, 0, 1);  // 0 = -60 dBFS, 1 = 0 dBFS

    const cv = cache.canvases[i];
    const c2 = cache.ctxs[i];
    if (cv && c2) {
      const w  = cv.width;
      const h  = cv.height;
      c2.clearRect(0, 0, w, h);
      c2.fillStyle = '#131110';
      c2.fillRect(0, 0, w, h);
      const fillH = Math.round(pct * h);
      if (fillH > 0) {
        c2.fillStyle = cache.grads[i];
        c2.fillRect(0, h - fillH, w, fillH);
      }
      // One mark, at −12 dB, and only where the bar is not already covering
      // it: three ticks across a 5px bar was noise, not scale.
      const ty = h - Math.round((-12 + 60) / 60 * h);
      if (h - fillH < ty) {
        c2.fillStyle = 'rgba(0,0,0,0.45)';
        c2.fillRect(0, ty, w, 1);
      }
    }

    const clip = cache.clips[i];
    if (clip) {
      clip.classList.toggle('clipping', db >= -1);
    }
  }
}

// ── Main-window output meter helpers ─────────────────────────────────────────
// Renders house buses into #mainHouseMeters and (if active) the stereo mixdown
// into #mainMixdownMeters. Each group has its own label so the two buses are
// visually distinct and cleanly sized to their content.
export function rebuildMainOutputMeters() {
  const houseWrap  = document.getElementById('mainHouseMeters');
  const mixWrap    = document.getElementById('mainMixdownMeters');
  const mixGroup   = document.getElementById('mainMixdownGroup');
  // Main-UI headphone mix meters (levels panel)
  const mainMixWrap  = document.getElementById('mainMixMeters');
  const mainMixGroup = document.getElementById('mainMixGroup');
  if (!houseWrap) return;
  if (!S.speakerAnalysers?.length) {
    houseWrap.innerHTML = '';
    if (mixWrap)  mixWrap.innerHTML = '';
    if (mixGroup) mixGroup.hidden = true;
    if (mainMixWrap)  mainMixWrap.innerHTML = '';
    if (mainMixGroup) mainMixGroup.hidden = true;
    return;
  }
  const nHouse     = S.speakerBuses?.length ?? S.speakerAnalysers.length;
  const hasMixdown = !!(S.monitorSpeakerBuses?.length);
  const houseLabels = Array.from({ length: nHouse }, (_, i) => String(i + 1));
  renderMeters('mainHouseMeters', nHouse, houseLabels);
  // Audio-settings modal mixdown meters
  if (mixGroup) mixGroup.hidden = !hasMixdown;
  if (hasMixdown && mixWrap) {
    // On the audio PAGE, so it is the meter element — not the footer's canvases.
    renderSetMeters('mainMixdownMeters', ['L', 'R']);
    setMeterSources('mainMixdownMeters', S.speakerAnalysers.slice(nHouse));
  } else if (mixWrap) {
    mixWrap.innerHTML = '';
  }
  // Main-UI levels panel mixdown meters
  if (mainMixGroup) mainMixGroup.hidden = !hasMixdown;
  if (hasMixdown && mainMixWrap) {
    renderMeters('mainMixMeters', 2, ['L', 'R']);
  } else if (mainMixWrap) {
    mainMixWrap.innerHTML = '';
  }
}

// ── Main-window input meter ───────────────────────────────────────────────────
// Rebuild DOM bars in #mainInputMeters to match the current input device.
// Shows all available input channels (S.inputAnalysers) with the active one
// (S.mainInputChannel) highlighted — mirrors the audio settings input meter exactly.
// Falls back to a single "in" bar when no multi-channel analysers are available yet.
export function rebuildMainInputMeter() {
  const wrap = document.getElementById('mainInputMeters');
  if (!wrap) return;
  const analysers = S.inputAnalysers;
  if (analysers?.length) {
    // Highlight both channels when stereo sum is selected
    const sel = S.mainInputChannel === 'stereo' ? [0, 1] : (S.mainInputChannel ?? 0);
    const labels = Array.from({ length: analysers.length }, (_, i) => String(i + 1));
    renderMeters('mainInputMeters', analysers.length, labels, sel);
  } else {
    // No device yet — single placeholder bar
    renderMeters('mainInputMeters', 1, ['in']);
  }
}

// ── Main-window dry monitor meter ─────────────────────────────────────────────
// Single-bar meter for the dry monitor level.
export function rebuildMainDryMeter() {
  const wrap = document.getElementById('mainDryMeters');
  if (!wrap) return;
  renderMeters('mainDryMeters', 1, ['dry']);
}

// ── Scan toggle (cursor spotlight on/off) ────────────────────────────────
// Mutes/unmutes cursor grains from the house/main output.
// When scan is muted, the cursor spotlight is off — only seeds are heard.
// - In stereo mode: zeros cursorMasterGain (monitorBus → masterGain path).
// - In multi-ch mode: also zeros monitorToHouseGain (cursor → house send).
//   Cursor remains audible on the dedicated monitor/headphone outputs.
// Exported so MIDI/OSC can call it programmatically.

// Exposed on S so modules that would otherwise import ui-meters.js (and pull a
// circular dependency with it) can reach it — e.g. the trigger tool muting scan
// when it takes over. Assigned after the declaration; see the bottom of the fn.
export function setScanMuted(muted) {
  const changed = S.scanMuted !== muted;
  S.scanMuted = muted;
  // THE CAP IS THE ONE MUTE (2026-09-07). The cursor reads nothing when it is
  // on — granular and hits alike. The gains below only gate the CURSOR bus,
  // and a hit plays through the loop commit engine instead, so silencing it
  // is a separate call rather than a consequence; the trigger gate reads
  // `S.scanMuted` directly from here on. See trigger.js for why there is no
  // second flag any more.
  if (changed && muted) S._silenceTriggers?.();
  if (changed) S._syncTriggerUI?.();
  if (changed) window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'scan_toggle' } }));
  const t = S.audioCtx?.currentTime ?? 0;
  const ramp = S.scanFadeS ?? 0.02; // #14: configurable fade (τ), default 20ms

  // Mute/unmute the monitorBus → masterGain path (affects stereo mode)
  if (S.cursorMasterGain && S.audioCtx) {
    S.cursorMasterGain.gain.setTargetAtTime(muted ? 0 : 1, t, ramp);
  }

  // Also mute/unmute the monitor → house send (affects multi-ch mode)
  if (S.monitorToHouseGain && S.audioCtx) {
    S.monitorToHouseGain.gain.setTargetAtTime(
      muted ? 0 : S.monitorGainValue,
      t, ramp
    );
  }

  // Update button appearance — lit when scan is on, dim when muted
  const btn = document.getElementById('scanBtn');
  if (btn) btn.classList.toggle('active', !muted);

  // Sync the improv panel mon→hse slider display when scan is off
  // (the actual S.monitorGainValue is preserved so unmuting restores it)
  const monNum = document.getElementById('improvMonitorNum');
  if (monNum && muted) monNum.value = '(muted)';
  else if (monNum) monNum.value = Math.round(S.monitorGainValue * 100) + '%';
}
S._setScanMuted = setScanMuted;

export function initScanToggle() {
  const btn = document.getElementById('scanBtn');
  if (!btn) return;

  // Restore persisted state — lit when scan is on
  btn.classList.toggle('active', !S.scanMuted);

  btn.addEventListener('click', () => {
    setScanMuted(!S.scanMuted);
  });

  // ── Sync hook for patch table preset recall ─────────────────────────────
  S._syncScanUI = () => {
    btn.classList.toggle('active', !S.scanMuted);
  };
}

// ── Radius fade (distance attenuation) ───────────────────────────────────────
// When enabled, cursor grains are attenuated based on angular distance from
// the cursor centre. Grains at the edge of the search radius play softer,
// preventing abrupt silence when the cursor drifts away from particles.

export function initRadiusFade() {
  const seg       = document.getElementById('radiusFadeSeg');
  const curveRow  = document.getElementById('radiusFadeCurveRow');
  const slider    = document.getElementById('radiusFadeCurveSlider');
  const numBox    = document.getElementById('radiusFadeCurveNum');
  if (!seg) return;

  // Restore persisted state — also reflects nearestMode override
  const syncUI = () => {
    // When scope=nearest, fade is forced off visually (no radius to fade)
    const effectiveOn = S.radiusFadeEnabled && !S.nearestMode;
    seg.querySelectorAll('.grain-seg-btn').forEach(b => {
      b.classList.toggle('active', (b.dataset.fade === 'on') === effectiveOn);
    });
    if (curveRow) curveRow.style.opacity = effectiveOn ? '1' : '0.35';
    if (slider)   slider.disabled = !effectiveOn;
    // Reflect the curve value too. Every remote writer (MIDI cc, OSC
    // /cursor/radiusfadecurve, accessory pots) writes S.radiusFadeCurve and
    // then calls this — without these two lines the pot moves the real curve
    // while the thumb and the % readout stay frozen. No feedback loop: the
    // slider's own input handler updates numBox directly and never calls here.
    if (slider) slider.value = S.radiusFadeCurve;
    if (numBox) numBox.value = Math.round(S.radiusFadeCurve * 100) + '%';
    // Dim the whole section when lock overrides fade
    seg.style.opacity = S.nearestMode ? '0.4' : '';
  };
  syncUI();
  // Expose so toggleNearestMode / applyPresetObject can refresh the fade UI
  S._syncRadiusFadeUI = syncUI;

  // Toggle
  seg.querySelectorAll('.grain-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      S.radiusFadeEnabled = btn.dataset.fade === 'on';
      syncUI();
    });
  });

  // Curve slider
  if (slider) {
    slider.value = S.radiusFadeCurve;
    if (numBox) numBox.value = Math.round(S.radiusFadeCurve * 100) + '%';
    slider.addEventListener('input', () => {
      S.radiusFadeCurve = parseFloat(slider.value);
      if (numBox) numBox.value = Math.round(S.radiusFadeCurve * 100) + '%';
    });
  }
}

// ── Sequential (loop) mode toggle ─────────────────────────────────────────────────
// Switches cursor between granular mode (default) and sequential/loop mode.
// In sequential mode, painting records a loop that auto-plays on release.

export function initSeqMode() {
  // ── Commit mode segmented control (commits panel) ──
  const commitModeSeg = document.getElementById('commitModeSeg');
  if (commitModeSeg) {
    commitModeSeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        S.commitMode = btn.dataset.mode;
        S._syncCommitUI?.();
      });
    });
  }

  // Legacy compat — old button IDs still wired if present
  const legacyModeBtn = document.getElementById('seqModeBtn');
  if (legacyModeBtn) {
    legacyModeBtn.addEventListener('click', () => {
      S.seqModeEnabled = !S.seqModeEnabled;
      S._syncCommitUI?.();
    });
  }

  // Panel action buttons
  document.getElementById('commitDropBtn')?.addEventListener('click', () => {
    dropSeqFromCursor();
  });
  document.getElementById('seqDropBtn')?.addEventListener('click', () => {
    releaseCommit();  // resume nearest paused loop
  });
  document.getElementById('seqPickupRemoveBtn')?.addEventListener('click', () => {
    releaseCommit();  // lift nearest loop
  });
  // Clear all — unified (both old and new IDs)
  document.getElementById('seqClearBtn')?.addEventListener('click', () => {
    clearAllCommits();
  });
  // commitClearBtn: click handler wired in inline script
  // Unified release button
  document.getElementById('commitReleaseBtn')?.addEventListener('click', () => {
    releaseCommit();
  });

  // ── Seq record params (speed, volume, direction for next loop) ───────────
  // These controls always edit S.seqNextParams. Recorded loops inherit these
  // values at creation time and can't be modified after.
  const seqControlsEl = document.getElementById('seqControls');
  const seqVolSlider  = document.getElementById('seqVolumeSlider');
  const seqVolNum     = document.getElementById('seqVolumeNum');
  const seqSpdSlider  = document.getElementById('seqSpeedSlider');
  const seqSpdNum     = document.getElementById('seqSpeedNum');
  if (seqVolSlider) {
    seqVolSlider.addEventListener('input', () => {
      const v = parseFloat(seqVolSlider.value);
      S.seqNextParams.volume = v;
      if (seqVolNum) seqVolNum.value = Math.round(v * 100) + '%';
    });
  }

  if (seqSpdSlider) {
    seqSpdSlider.addEventListener('input', () => {
      const spd = parseFloat(seqSpdSlider.value);
      S.seqNextParams.speed = spd;
      if (seqSpdNum) seqSpdNum.value = spd.toFixed(2) + '×';
    });
  }

  // Show/hide the controls based on seq mode toggle
  // Controls are always visible — no need for a sync toggle.
  S._syncSeqControls = function syncSeqControls() {};

  // ── Commit slot count slider + editable numbox (unified) ──
  // The range input keeps the legacy `commitSlotCountSelect` id so every
  // other call site (main.js change listener, osc.js, midi.js, patch-table
  // recall) that does `sel.value = String(...)` still works on the slider.
  // The numbox stays in sync live during drag, and typing a value commits
  // on Enter/blur (clamped 1–16). Both are refreshable from external
  // state changes via S._syncCommitSlotCount().
  const commitSlotSelect = document.getElementById('commitSlotCountSelect');
  const commitSlotNum    = document.getElementById('commitSlotCountNum');

  function _clampSlotCount(v) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return S.commitSlotCount;
    return Math.max(1, Math.min(16, n));
  }
  function _applySlotCount(v) {
    const n = _clampSlotCount(v);
    S.commitSlotCount = n;
    if (commitSlotSelect) commitSlotSelect.value = String(n);
    if (commitSlotNum)    commitSlotNum.value    = String(n);
    S._syncCommitUI?.();
  }
  // Exposed for external callers (osc.js, midi.js, param-registry.js) that
  // used to do `sel.value = String(S.commitSlotCount)` — a single call
  // now updates both slider and numbox.
  S._syncCommitSlotCount = () => {
    if (commitSlotSelect) commitSlotSelect.value = String(S.commitSlotCount);
    if (commitSlotNum)    commitSlotNum.value    = String(S.commitSlotCount);
  };

  if (commitSlotSelect) {
    commitSlotSelect.value = S.commitSlotCount;
    // Live numbox update during drag so the readout tracks the slider.
    commitSlotSelect.addEventListener('input', () => {
      if (commitSlotNum) commitSlotNum.value = commitSlotSelect.value;
    });
    // Commit on release — pushes state + fires downstream sync.
    commitSlotSelect.addEventListener('change', () => {
      _applySlotCount(commitSlotSelect.value);
    });
  }

  if (commitSlotNum) {
    commitSlotNum.value = S.commitSlotCount;
    const commit = () => { _applySlotCount(commitSlotNum.value); };
    commitSlotNum.addEventListener('blur', commit);
    commitSlotNum.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { commit(); commitSlotNum.blur(); }
      else if (e.key === 'Escape') {
        commitSlotNum.value = String(S.commitSlotCount);
        commitSlotNum.blur();
      }
    });
  }

  // ── Commit overflow seg (unified) ──
  const commitOverflowSeg = document.getElementById('commitOverflowSeg');
  if (commitOverflowSeg) {
    commitOverflowSeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        S.commitOverflow = btn.dataset.overflow;
        commitOverflowSeg.querySelectorAll('.grain-seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  // ── Sync hook for patch table preset recall ─────────────────────────────
  S._syncSeqUI = () => {
    // Commit mode + lock
    S._syncCommitUI?.();
    // Volume slider + numbox
    if (seqVolSlider) seqVolSlider.value = S.seqNextParams.volume;
    if (seqVolNum)    seqVolNum.value    = Math.round(S.seqNextParams.volume * 100) + '%';
    // Speed slider + numbox
    if (seqSpdSlider) seqSpdSlider.value = S.seqNextParams.speed;
    if (seqSpdNum)    seqSpdNum.value    = S.seqNextParams.speed.toFixed(2) + '×';
    // Commit slot count select
    if (commitSlotSelect) commitSlotSelect.value = S.commitSlotCount;
  };

  // Expose updateCommitBanksUI on S so renderer can call it each frame
  S.updateSeqBanksUI  = updateCommitBanksUI;
  S.updateSeedBanksUI = updateCommitBanksUI;

  // Initial draw + sync
  updateCommitBanksUI();
  S._syncCommitUI?.();
}

// ── Mixdown source gain controls ─────────────────────────────────────────────
// Independent volume for cursor and house fold-down contributions to the
// stereo mixdown bus. Exported so MIDI/OSC can call them programmatically.

export function setMixdownCursorGain(v) {
  v = Math.max(0, Math.min(1, v));
  S.mixdownCursorGainValue = v;
  const t = S.audioCtx?.currentTime ?? 0;
  if (S.mixdownCursorGainNodes) {
    S.mixdownCursorGainNodes.forEach(g => g.gain.setTargetAtTime(v, t, 0.02));
  }
  const slider = document.getElementById('mixdownCursorGainSlider');
  if (slider) slider.value = v;
  const num = document.getElementById('mixdownCursorGainNum');
  if (num) num.textContent = Math.round(v * 100) + '%';
}

export function setMixdownHouseGain(v) {
  v = Math.max(0, Math.min(1, v));
  S.mixdownHouseGainValue = v;
  const t = S.audioCtx?.currentTime ?? 0;
  if (S.mixdownHouseGainNodes) {
    S.mixdownHouseGainNodes.forEach(g => g.gain.setTargetAtTime(v, t, 0.02));
  }
  const slider = document.getElementById('mixdownHouseGainSlider');
  if (slider) slider.value = v;
  const num = document.getElementById('mixdownHouseGainNum');
  if (num) num.textContent = Math.round(v * 100) + '%';
}

export function initMixdownGains() {
  const curSlider = document.getElementById('mixdownCursorGainSlider');
  const hseSlider = document.getElementById('mixdownHouseGainSlider');

  if (curSlider) {
    curSlider.value = S.mixdownCursorGainValue;
    curSlider.addEventListener('input', () => setMixdownCursorGain(parseFloat(curSlider.value)));
  }
  if (hseSlider) {
    hseSlider.value = S.mixdownHouseGainValue;
    hseSlider.addEventListener('input', () => setMixdownHouseGain(parseFloat(hseSlider.value)));
  }
  // Sync numbox readouts on init
  const curNum = document.getElementById('mixdownCursorGainNum');
  if (curNum) curNum.textContent = Math.round(S.mixdownCursorGainValue * 100) + '%';
  const hseNum = document.getElementById('mixdownHouseGainNum');
  if (hseNum) hseNum.textContent = Math.round(S.mixdownHouseGainValue * 100) + '%';

  // Expose setters for MIDI/OSC access
  S._setMixdownCursorGain = setMixdownCursorGain;
  S._setMixdownHouseGain  = setMixdownHouseGain;
}

// ── Dry monitor gain controls ────────────────────────────────────────────────
export function initDryMonitorGains() {
  const slider = document.getElementById('dryMonitorGainSlider');
  const sel    = document.getElementById('dryMonitorModeSel');

  if (slider) {
    slider.value = S.dryMonitorGainValue;
    slider.addEventListener('input', () => setDryMonitorGain(parseFloat(slider.value)));
  }
  // Always start OFF, regardless of persisted/preset state — the mode is a
  // session setting on purpose (state.js, dryMonitorMode).
  S.dryMonitorMode    = 'off';
  S.dryMonitorEnabled = false;
  if (sel) {
    sel.value = 'off';
    sel.addEventListener('change', () => setDryMonitorMode(sel.value));
  }
  const num = document.getElementById('dryMonitorGainNum');
  if (num) num.textContent = Math.round(S.dryMonitorGainValue * 100) + '%';

  // Expose setter for MIDI/OSC access
  S._setDryMonitorGain = setDryMonitorGain;
}

// ── Audio panel (main UI) ────────────────────────────────────────────────────
// Mirrors the most-used controls from the audio settings modal into a
// persistent panel. Panel controls drive the modal's existing event handlers
// by calling setters directly (for state managed here) or by dispatching
// `input` events on the modal's slider (for gain/gate controls whose handlers
// live in ui-audio-settings.js). A one-way listener on the modal's inputs
// refreshes the panel's display when the user interacts with the modal.
//
// No live metering here — the .bottom-bar levels rail is the single source
// for metering; panel just exposes the knobs.
export function initAudioPanel() {
  const fmtDb      = db => (db >= 0 ? '+' : '−') + Math.abs(db).toFixed(1) + ' dB';
  const fmtGate    = v  => parseFloat(v).toFixed(4);
  const fmtPercent = v  => Math.round(parseFloat(v) * 100) + '%';

  // ── Input channel ──
  const apChanSel    = document.getElementById('apInputChannelSelect');
  const modalChanSel = document.getElementById('asInputChannel');
  if (apChanSel && modalChanSel) {
    // Panel drives modal — dispatch change so existing modal handler fires
    apChanSel.addEventListener('change', () => {
      if (modalChanSel.value !== apChanSel.value) {
        modalChanSel.value = apChanSel.value;
        modalChanSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    // Modal drives panel — when modal's options repopulate or value changes,
    // mirror to the panel. Options repopulate through repopulateChannelSelect;
    // we re-sync via S._syncAudioPanelChannels() (exposed below).
    modalChanSel.addEventListener('change', () => {
      if (apChanSel.value !== modalChanSel.value) {
        // Skip if our own options list is missing this value — wait for sync.
        if ([...apChanSel.options].some(o => o.value === modalChanSel.value)) {
          apChanSel.value = modalChanSel.value;
        }
      }
    });
  }

  // Helper: sync the panel's channel <select> options + value from the modal's.
  // Called from ui-audio-settings.js after repopulateChannelSelect so the two
  // dropdowns carry identical options (ch 1…N plus optional 'stereo').
  S._syncAudioPanelChannels = () => {
    if (!apChanSel || !modalChanSel) return;
    apChanSel.innerHTML = '';
    for (const opt of modalChanSel.options) {
      const clone = document.createElement('option');
      clone.value = opt.value;
      clone.textContent = opt.textContent;
      apChanSel.appendChild(clone);
    }
    apChanSel.value = modalChanSel.value;
  };

  // ── Input gain ──
  // Hidden in Electron (trim at hardware interface, same as the modal row).
  const apInputGainRow    = document.getElementById('apInputGainSlider')?.closest('.grain-row');
  if (window.electronBridge?.isElectron && apInputGainRow) {
    apInputGainRow.style.display = 'none';
  }
  const apInputGain    = document.getElementById('apInputGainSlider');
  const apInputGainNum = document.getElementById('apInputGainNum');
  const modalInputGain = document.getElementById('asInputGain');
  if (apInputGain && modalInputGain) {
    apInputGain.value = modalInputGain.value;
    if (apInputGainNum) apInputGainNum.value = fmtDb(parseFloat(modalInputGain.value));

    apInputGain.addEventListener('input', () => {
      modalInputGain.value = apInputGain.value;
      modalInputGain.dispatchEvent(new Event('input', { bubbles: true }));
      if (apInputGainNum) apInputGainNum.value = fmtDb(parseFloat(apInputGain.value));
    });
    modalInputGain.addEventListener('input', () => {
      if (document.activeElement === apInputGain) return;  // panel is driving
      apInputGain.value = modalInputGain.value;
      if (apInputGainNum) apInputGainNum.value = fmtDb(parseFloat(modalInputGain.value));
    });
  }

  // ── Paint gate ──
  // The panel's gate control is the canvas meter (registered in
  // GATE_METER_TARGETS below); `apPaintGateSlider` is a hidden value carrier,
  // the same arrangement the modal uses with `asPaintGateSlider`. Nothing
  // listens on it — every write lands via _syncGateVal(), which the canvas
  // drag, MIDI, OSC and the modal all funnel through. Seed it here so the
  // first paint and the first cc-mirror snapshot read the saved threshold.
  const apGate    = document.getElementById('apPaintGateSlider');
  const apGateNum = document.getElementById('apPaintGateNum');
  if (apGate) {
    apGate.value = S.paintGateThreshold;
    if (apGateNum) apGateNum.value = fmtGate(S.paintGateThreshold);
  }

  // ── Master volume ──
  const apMaster       = document.getElementById('apMasterGainSlider');
  const apMasterNum    = document.getElementById('apMasterGainNum');
  const modalMaster    = document.getElementById('asOutputGain');
  if (apMaster && modalMaster) {
    apMaster.value = modalMaster.value;
    if (apMasterNum) apMasterNum.value = fmtDb(parseFloat(modalMaster.value));
    apMaster.addEventListener('input', () => {
      modalMaster.value = apMaster.value;
      modalMaster.dispatchEvent(new Event('input', { bubbles: true }));
      if (apMasterNum) apMasterNum.value = fmtDb(parseFloat(apMaster.value));
    });
    modalMaster.addEventListener('input', () => {
      if (document.activeElement === apMaster) return;
      apMaster.value = modalMaster.value;
      if (apMasterNum) apMasterNum.value = fmtDb(parseFloat(modalMaster.value));
    });
  }

  // ── Dry monitor mode (off | on | auto segmented picker, #245) ──
  // Both surfaces show the SETTING; the seg also shows the effective state —
  // under auto the active pill dims while a granular take has it ducked, so
  // "dry is on but I can't hear it" reads as intended rather than broken.
  const apDrySeg    = document.getElementById('apDryEnableSeg');
  const modalDrySel = document.getElementById('dryMonitorModeSel');
  function _syncDryModeFromState() {
    const mode = S.dryMonitorMode ?? 'off';
    if (apDrySeg) {
      apDrySeg.querySelectorAll('.grain-seg-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.dry === mode);
      });
      apDrySeg.classList.toggle('ducked', isDryMonitorDucked());
    }
    if (modalDrySel && modalDrySel.value !== mode) modalDrySel.value = mode;
  }
  if (apDrySeg) {
    apDrySeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => setDryMonitorMode(btn.dataset.dry));
    });
  }
  S._syncDryMonitorUI = _syncDryModeFromState;   // audio.js calls it on every change
  _syncDryModeFromState();

  // ── Dry gain ──
  const apDryGain    = document.getElementById('apDryGainSlider');
  const apDryGainNum = document.getElementById('apDryGainNum');
  const modalDryGain = document.getElementById('dryMonitorGainSlider');
  const modalDryNum  = document.getElementById('dryMonitorGainNum');
  if (apDryGain) {
    apDryGain.value = S.dryMonitorGainValue;
    if (apDryGainNum) apDryGainNum.value = fmtPercent(S.dryMonitorGainValue);
    apDryGain.addEventListener('input', () => {
      const v = parseFloat(apDryGain.value);
      setDryMonitorGain(v);
      if (apDryGainNum) apDryGainNum.value = fmtPercent(v);
      if (modalDryGain) modalDryGain.value = String(v);
      if (modalDryNum)  modalDryNum.textContent = fmtPercent(v);
    });
  }
  if (modalDryGain) {
    modalDryGain.addEventListener('input', () => {
      if (document.activeElement === apDryGain) return;
      const v = parseFloat(modalDryGain.value);
      if (apDryGain)    apDryGain.value    = String(v);
      if (apDryGainNum) apDryGainNum.value = fmtPercent(v);
    });
  }

  // ── Exposed refresh hooks ──
  // The panel mirrors normally ride the modal element's `input` event. Setters
  // driven by MIDI/OSC assign `el.value` directly and dispatch nothing, so the
  // mirror never fires and the panel slider sits still while the modal one
  // moves. Those setters call _syncAudioPanelLevels instead — sliders and
  // readouts only, no channel-select rebuild, so it is cheap enough to run on
  // every cc tick (a cc knob sends up to 127 messages a second).
  S._syncAudioPanelLevels = () => {
    if (modalInputGain && apInputGain && document.activeElement !== apInputGain) {
      apInputGain.value = modalInputGain.value;
      if (apInputGainNum) apInputGainNum.value = fmtDb(parseFloat(modalInputGain.value));
    }
    if (modalMaster && apMaster && document.activeElement !== apMaster) {
      apMaster.value = modalMaster.value;
      if (apMasterNum) apMasterNum.value = fmtDb(parseFloat(modalMaster.value));
    }
    if (apGate && document.activeElement !== apGate) {
      apGate.value = S.paintGateThreshold;
      if (apGateNum) apGateNum.value = fmtGate(S.paintGateThreshold);
    }
    if (apDryGain && document.activeElement !== apDryGain) {
      apDryGain.value = S.dryMonitorGainValue;
      if (apDryGainNum) apDryGainNum.value = fmtPercent(S.dryMonitorGainValue);
    }
  };

  // Called from audio-settings when device activation / channel repopulation
  // happens outside the panel (initial startup, device change, etc.) so the
  // panel mirrors the new state without needing to re-init.
  S._syncAudioPanel = () => {
    S._syncAudioPanelLevels();
    _syncDryToggleFromState();
    S._syncAudioPanelChannels?.();
  };
}

// ── Main-window metering loop ────────────────────────────────────────────────
// Drives tickMeters for main window via its own RAF loop, independent of
// the sphere render loop. Call startMainMetering() once after init.
let _mainMeterRAF = null;

// ── Paint gate visual meter ──────────────────────────────────────────────────
// Canvas-drawn meter: input RMS bar + draggable threshold marker.
// The same meter is drawn onto every registered canvas — audio settings modal,
// the footer levels rail, and the audio device panel. They differ only in size,
// and _drawGateMeter picks its orientation from the rect, so one registry with
// per-entry DPR state covers all three rather than a global per canvas.
// Smoothed in the DRAWN POSITION (0–1 along the meter), not in RMS — see the
// ballistics block in state.js for why that distinction is the whole ballgame
// on a curved axis.
let _smoothedFrac    = 0;        // exponential smooth for bar
let _peakFrac        = 0;        // peak-hold for peak marker
let _peakDecay       = 0;        // ticks since peak was set

// One-pole coefficient for a given time constant at the meter's tick rate.
const _gateCoeff = tauMs => 1 - Math.exp(-GATE_METER_TICK_MS / tauMs);
const GATE_ATTACK      = _gateCoeff(GATE_METER_ATTACK_MS);
const GATE_RELEASE     = _gateCoeff(GATE_METER_RELEASE_MS);
const GATE_PEAK_FALL   = _gateCoeff(GATE_METER_PEAK_FALL_MS);
const GATE_PEAK_TICKS  = Math.round(GATE_METER_PEAK_HOLD_MS / GATE_METER_TICK_MS);
let _gateDragging    = null;     // entry currently being dragged, or null

// Also update hidden elements for backward compat
let _gateLightEl = null;
let _rmsReadoutEl = null;

// Registered canvases. Each: { canvas, ctx, valEl, sized }.
const _gateMeters = [];

// ── Meter axis ──────────────────────────────────────────────────────────────
// Position along the meter (0–1) ⇄ RMS.  The axis is a power curve, not linear:
// see GATE_METER_GAMMA in state.js for why.  Every consumer of a meter position
// goes through this pair — bar, peak tick, threshold marker, mouse drag, and
// the noise_gate cc action, which imports gateFracToRms from here.  If the cc
// and the draw ever stop sharing it, the pot stops agreeing with the picture.

export function gateFracToRms(frac) {
  const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
  return Math.pow(f, GATE_METER_GAMMA) * GATE_METER_MAX;
}

export function gateRmsToFrac(rms) {
  const v = rms / GATE_METER_MAX;
  if (!(v > 0)) return 0;
  return Math.pow(v > 1 ? 1 : v, 1 / GATE_METER_GAMMA);
}

// id → { val: readout element id, drag: is the threshold draggable here }
// The audio settings modal's gate is no longer here: it is the meter element
// (a DOM row, #asGateMeterRow), driven by _tickSetGate() from the same
// ballistics below. What is left is the two canvases outside the dialog.
const GATE_METER_TARGETS = [
  { id: 'mainGateMeter', val: 'mainPaintGateVal', drag: false },  // footer rail (12px wide — too narrow to aim at)
  { id: 'apGateMeter',   val: null,               drag: true  },  // audio device panel (value shown in the row above)
];

/** Register every gate meter canvas present and wire threshold drag on the
 *  ones that allow it. Canvas sizing is deferred until each becomes visible. */
export function initGateMeter() {
  _gateMeters.length = 0;

  for (const t of GATE_METER_TARGETS) {
    const canvas = document.getElementById(t.id);
    if (!canvas) continue;
    const entry = {
      canvas,
      ctx:   canvas.getContext('2d'),
      valEl: t.val ? document.getElementById(t.val) : null,
      sized: false,
    };
    _gateMeters.push(entry);

    if (t.drag) _wireGateDrag(entry);
    else canvas.style.cursor = 'default';

    // Size now if it is already laid out; hidden ones retry from updateGateLight.
    _ensureGateSized(entry);
  }

  // A drag started on any canvas keeps tracking until the button comes up,
  // so these two live on the window rather than per canvas.
  window.addEventListener('mousemove', e => {
    if (!_gateDragging) return;
    S.paintGateThreshold = _pointToThreshold(_gateDragging, e);
    _syncGateVal();
  });
  window.addEventListener('mouseup', () => { _gateDragging = null; });

  // The settings page's gate is the meter element — wired here so every gate
  // meter, canvas or row, is registered in one place.
  initSetGateMeter();

  // Show saved threshold value
  _syncGateVal();

  // ── S callback for MIDI / OSC access to paint gate threshold ────────────
  // Accepts linear RMS value (0 to GATE_METER_MAX), syncs readouts + hidden slider.
  S._setPaintGateThreshold = (v) => {
    S.paintGateThreshold = Math.max(0, Math.min(GATE_METER_MAX, v));
    _syncGateVal();
  };
}

/** Pointer position → threshold, along whichever axis this canvas is drawn on.
 *  Vertical canvases run bottom-up, matching the fill direction in the draw. */
function _pointToThreshold(entry, e) {
  const r = entry.canvas.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return S.paintGateThreshold;
  const frac = (r.height > r.width)
    ? 1 - (e.clientY - r.top) / r.height
    : (e.clientX - r.left) / r.width;
  return gateFracToRms(frac);
}

function _wireGateDrag(entry) {
  entry.canvas.addEventListener('mousedown', e => {
    _gateDragging = entry;
    S.paintGateThreshold = _pointToThreshold(entry, e);
    _syncGateVal();
  });
  // Double-click to reset, matching the slider reset in main.js — that one
  // only matches input[type="range"], so a canvas control needs its own.
  entry.canvas.addEventListener('dblclick', () => {
    const def = parseFloat(entry.canvas.dataset.default);
    if (!Number.isFinite(def)) return;
    S.paintGateThreshold = Math.max(0, Math.min(GATE_METER_MAX, def));
    _syncGateVal();
  });
}

/** DPR scaling — no-ops while the canvas is hidden (rect width 0), and
 *  re-runs when the box changes size (panel resize, projector mode toggle). */
function _ensureGateSized(entry) {
  const rect = entry.canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const dpr = window.devicePixelRatio || 1;
  const needW = Math.round(rect.width * dpr);
  const needH = Math.round(rect.height * dpr);
  if (entry.sized && entry.canvas.width === needW && entry.canvas.height === needH) return true;
  entry.canvas.width  = needW;
  entry.canvas.height = needH;
  entry.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  entry.sized = true;
  return true;
}

function _syncGateVal() {
  const txt = S.paintGateThreshold.toFixed(4);
  for (const m of _gateMeters) if (m.valEl) m.valEl.textContent = txt;
  // Keep hidden slider in sync for persistence
  const hs = document.getElementById('asPaintGateSlider');
  if (hs) hs.value = S.paintGateThreshold;
  // Mirror into the main-UI audio panel too — the canvas-drag path
  // bypasses slider events, so we push values through explicitly.
  const apGate    = document.getElementById('apPaintGateSlider');
  const apGateNum = document.getElementById('apPaintGateNum');
  if (apGate) apGate.value = String(S.paintGateThreshold);
  if (apGateNum) apGateNum.value = txt;
}

/** Draw the gate meter onto a given canvas context at CSS-space w×h.
 *  Auto-orients: tall-and-narrow canvases (h > w) draw vertically for the
 *  footer rail; wide canvases stay horizontal for the audio-settings modal. */
function _drawGateMeter(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);

  // Threshold as a position, so the comparison happens in the same domain the
  // bar is smoothed and drawn in.
  const threshF = gateRmsToFrac(S.paintGateThreshold);
  const gated = S.paintGateThreshold > 0 && _smoothedFrac < threshF;

  // Background track — same for both orientations
  ctx.fillStyle = 'rgba(255,240,224,0.035)';
  ctx.fillRect(0, 0, w, h);

  if (h > w) {
    // ── Vertical layout (footer rail) ──────────────────────────────────
    // Level fills from the bottom up; threshold is a horizontal line.
    // Too cramped for labels/triangles, so we keep it to just three
    // elements: threshold line, RMS fill, peak tick. Colour already
    // encodes gated vs. open.
    const threshY = h - threshF       * h;
    const barY    = h - _smoothedFrac * h;
    const peakY   = h - _peakFrac     * h;

    // RMS bar — full width, from bottom up to barY
    if (barY < h - 0.5) {
      if (gated) {
        ctx.fillStyle = 'rgba(204, 106, 85, 0.50)';
        ctx.fillRect(0, Math.max(barY, 0), w, h - Math.max(barY, 0));
      } else {
        // Segment below threshold in dimmer teal (below the "gate is
        // closed" line) and segment above in brighter teal.
        if (threshY < h) {
          ctx.fillStyle = 'rgba(127, 168, 174, 0.20)';
          ctx.fillRect(0, Math.max(barY, threshY, 0), w, h - Math.max(barY, threshY, 0));
        }
        ctx.fillStyle = 'rgba(127, 168, 174, 0.60)';
        const topSegY = Math.max(barY, 0);
        const topSegH = Math.max(0, Math.min(threshY, h) - topSegY);
        if (topSegH > 0) ctx.fillRect(0, topSegY, w, topSegH);
      }
    }

    // Peak marker — thin horizontal line
    if (peakY < h - 1) {
      ctx.fillStyle = gated ? 'rgba(204, 106, 85, 0.82)' : 'rgba(127, 168, 174, 0.92)';
      ctx.fillRect(0, Math.max(peakY, 0), w, 1.5);
    }

    // Threshold marker — horizontal line across full width
    if (S.paintGateThreshold > 0 && threshY > 0 && threshY < h) {
      const ty = Math.round(threshY);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(0, ty + 0.5);
      ctx.lineTo(w, ty + 0.5);
      ctx.stroke();
    }
    return;
  }

  // ── Horizontal layout (audio-settings modal — original) ────────────────
  const threshX = threshF       * w;
  const barX    = _smoothedFrac * w;
  const peakX   = _peakFrac     * w;

  // RMS bar
  if (barX > 0.5) {
    const barH = h * 0.55;
    const barY = (h - barH) / 2;
    if (gated) {
      ctx.fillStyle = 'rgba(204, 106, 85, 0.50)';
      ctx.fillRect(0, barY, Math.min(barX, w), barH);
    } else {
      if (threshX > 0) {
        ctx.fillStyle = 'rgba(127, 168, 174, 0.20)';
        ctx.fillRect(0, barY, Math.min(threshX, barX, w), barH);
      }
      ctx.fillStyle = 'rgba(127, 168, 174, 0.50)';
      ctx.fillRect(Math.min(threshX, barX), barY, Math.max(0, Math.min(barX, w) - threshX), barH);
    }
  }

  // Peak marker (thin bright line)
  if (peakX > 1) {
    ctx.fillStyle = gated ? 'rgba(204, 106, 85, 0.72)' : 'rgba(127, 168, 174, 0.80)';
    ctx.fillRect(Math.min(peakX, w - 1), (h - h * 0.55) / 2, 1.5, h * 0.55);
  }

  // Threshold marker — vertical line with small triangles top and bottom
  if (S.paintGateThreshold > 0 && threshX > 0 && threshX < w) {
    const tx = Math.round(threshX);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(tx + 0.5, 0);
    ctx.lineTo(tx + 0.5, h);
    ctx.stroke();

    ctx.fillStyle = 'rgba(244, 235, 222, 0.7)';
    ctx.beginPath();
    ctx.moveTo(tx - 3, 0);
    ctx.lineTo(tx + 4, 0);
    ctx.lineTo(tx + 0.5, 5);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(tx - 3, h);
    ctx.lineTo(tx + 4, h);
    ctx.lineTo(tx + 0.5, h - 5);
    ctx.closePath();
    ctx.fill();
  }

  // Gate state label — small text in top-right
  ctx.font = '9px Inter, Helvetica, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = gated ? 'rgba(204, 106, 85, 0.72)' : 'rgba(127, 168, 174, 0.60)';
  ctx.fillText(gated ? 'gated' : 'open', w - 4, 10);
}

function updateGateLight() {
  const an = S.inputAnalyser;
  if (_gateMeters.length === 0) {
    if (!_gateLightEl) _gateLightEl = document.getElementById('asGateLight');
    if (!an && _gateLightEl) _gateLightEl.classList.remove('closed');
    return;
  }
  if (!an) return;

  // Skip the analyser read + RMS + draws when no gate canvas is actually
  // visible (perf audit M3 / TODO #116) — modal closed AND every main-UI
  // host panel collapsed/hidden. offsetParent === null covers display:none
  // from either the modal or a collapsed ancestor panel. The asGateLight
  // element is only consumed by CSS, so letting it go stale is harmless.
  // Sizing is lazy for the same reason: a hidden canvas has a zero rect.
  // The settings page's gate is a DOM row now, not a canvas, and it reads the
  // ballistics this function advances — so it counts as a visible meter here.
  let anyVisible = setGateVisible();
  for (const m of _gateMeters) {
    m.visible = m.canvas.offsetParent !== null;
    if (!m.visible) continue;
    anyVisible = true;
    _ensureGateSized(m);
  }
  if (!anyVisible) return;

  // The number the paint gate actually tests — same analyser, same formula, via
  // audio-features. This used to compute plain RMS from S.inputAnalyser, which
  // is a different quantity AND a different window (256 samples vs 2048), so
  // the bar and the threshold line were never commensurable.
  const rms = readGateLoudness();
  if (rms === null) return;

  // Ballistics run on the position, not the RMS (state.js): fast attack so a
  // transient is never missed, slower release so the bar is readable.
  const frac = gateRmsToFrac(rms);
  _smoothedFrac += (frac - _smoothedFrac) * (frac > _smoothedFrac ? GATE_ATTACK : GATE_RELEASE);

  // Peak marker: jump to any new high, sit still, then fall slower than the bar.
  if (frac > _peakFrac) {
    _peakFrac  = frac;
    _peakDecay = 0;
  } else {
    _peakDecay++;
    if (_peakDecay > GATE_PEAK_TICKS) _peakFrac -= _peakFrac * GATE_PEAK_FALL;
  }

  // Update hidden elements for backward compat
  if (!_gateLightEl) _gateLightEl = document.getElementById('asGateLight');
  if (_gateLightEl) _gateLightEl.classList.toggle('closed', rms < S.paintGateThreshold);

  // Draw every visible, sized canvas (hidden ones skipped — M3/#116)
  for (const m of _gateMeters) {
    if (!m.visible || !m.sized) continue;
    const r = m.canvas.getBoundingClientRect();
    _drawGateMeter(m.ctx, r.width, r.height);
  }
}

let _meterTickCount = 0;

export function startMainMetering() {
  // No longer runs its own RAF loop — called from the main animate() loop
  // via S._tickMainMeters(). Setup only.
  if (_mainMeterRAF) { cancelAnimationFrame(_mainMeterRAF); _mainMeterRAF = null; }
  rebuildMainInputMeter();
  rebuildMainDryMeter();
  S._rebuildMainInputMeters  = rebuildMainInputMeter;
  S._rebuildMainOutputMeters = rebuildMainOutputMeters;
  // Expose the tick function for the unified RAF dispatcher
  S._tickMainMeters = tickMainMeters;
}

export function tickMainMeters() {
  // Run at half rate (every other call ≈ 30fps when called from 60fps RAF)
  if (++_meterTickCount & 1) return;
  const inAnalysers = S.inputAnalysers?.length ? S.inputAnalysers : (S.inputAnalyser ? [S.inputAnalyser] : null);
  // One place, both layouts (#253): the source TILES no longer carry meters —
  // a live canvas among static glyphs read as a different kind of control —
  // so the bottom bar's input column is visible under the tile layout again
  // and is the only input meter there is.
  if (inAnalysers) tickMeters(inAnalysers, 'mainInputMeters');
  if (S.speakerAnalysers?.length) {
    const nHouse = S.speakerBuses?.length ?? S.speakerAnalysers.length;
    tickMeters(S.speakerAnalysers.slice(0, nHouse), 'mainHouseMeters');
    const mixAnalysers = S.speakerAnalysers.slice(nHouse);
    if (mixAnalysers.length) {
      // mainMixdownMeters is the audio page's, driven by the settings loop.
      tickMeters(mixAnalysers, 'mainMixMeters');
    }
  }
  // Dry monitor: tick meter + update spatial panning
  if (S.dryAnalyser) tickMeters([S.dryAnalyser], 'mainDryMeters');
  updateDryMonitorPanning();
  updateGateLight();
  tickHandsfree();
}

export function stopMainMetering() {
  if (_mainMeterRAF) { cancelAnimationFrame(_mainMeterRAF); _mainMeterRAF = null; }
}

// ════════════════════════════════════════════════════════════════════════════
// THE SETTINGS PAGE'S METERS — element eleven (docs/SETTINGS-GUI.md § 3)
//
// Horizontal, one row per channel, ONE ruler per group, and no canvas: a row is
// four elements and a frame writes two style properties and a string into each.
// The canvas meters this replaces cost a clearRect + fillRect + gradient per
// channel per frame; these cost a width and a left.
//
// ONE loop drives every meter on the page — the groups and the gate row — so
// the page's cost is one rAF callback whatever it is showing. The grain
// scheduler shares this thread (CLAUDE.md, render-path performance), which is
// why the per-frame work is counted rather than assumed: `S._setMeterCost`
// carries a rolling average in ms for anyone who wants to read it.
// ════════════════════════════════════════════════════════════════════════════

// The scale, in one place. x(db) is the curve — pow 1.5 — so the top 20 dB take
// half the track; the ruler's tick positions come from the same function, so a
// tick can never drift from the level it labels.
const SET_METER_FLOOR = -60;
const SET_METER_CURVE = 1.5;
export function setMeterX(db) {
  const f = (db - SET_METER_FLOOR) / -SET_METER_FLOOR;
  return Math.pow(f < 0 ? 0 : f > 1 ? 1 : f, SET_METER_CURVE) * 100;
}
const SET_METER_TICKS = [-60, -40, -30, -20, -12, -6, 0];

// Ballistics, in frames. Attack is instant — a transient you cannot see is a
// transient you cannot fix — and the release is slow enough to read.
const SET_RELEASE   = 0.16;
const SET_PEAK_HOLD = 700;    // ms the tick sits before it starts to fall
const SET_PEAK_FALL = 0.35;   // dB per frame after that
const SET_CLIP_HOLD = 1400;   // ms the clip pip stays lit
const SET_SIZE_EVERY = 30;    // frames between background-size re-reads

const _setGroups = new Map();   // containerId → { el, rows, analysers, sizeAt }
let   _setRAF    = null;
let   _setFrame  = 0;

const _setBuf = new Float32Array(256);

/** minus sign, not a hyphen: a hyphen in a column of numbers is a different
 *  glyph width and reads as a dash. */
function _setDb(db) {
  if (db <= -89) return '−∞';
  const s = db < 0 ? '−' : '';
  return s + Math.abs(db).toFixed(1);
}

/** Build one meter group: a ruler, then a row per channel. */
export function renderSetMeters(containerId, labels, opts = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  _setGroups.delete(containerId);
  el.className = 'set-meters';
  el.innerHTML = '';

  const ruler = document.createElement('div');
  ruler.className = 'set-meter-ruler';
  const rl = document.createElement('span');
  rl.className = 'set-meter-label';
  const scale = document.createElement('div');
  scale.className = 'set-meter-scale';
  for (const db of SET_METER_TICKS) {
    const t = document.createElement('span');
    t.style.left = setMeterX(db).toFixed(1) + '%';
    t.textContent = db === 0 ? '0' : '−' + Math.abs(db);
    scale.appendChild(t);
  }
  const rv = document.createElement('span');
  rv.className = 'set-meter-val';
  const rc = document.createElement('span');
  rc.className = 'set-meter-clip';
  ruler.append(rl, scale, rv, rc);
  el.appendChild(ruler);

  const rows = [];
  labels.forEach((label, i) => {
    const row = document.createElement('div');
    row.className = 'set-meter-row';
    const off = opts.off?.includes(i);
    if (off) row.classList.add('set-meter-row--off');

    const lbl = document.createElement('span');
    lbl.className = 'set-meter-label';
    lbl.textContent = label;

    const track = document.createElement('div');
    track.className = 'set-meter-track';
    const band = document.createElement('div');
    band.className = 'set-meter-band';
    const fill = document.createElement('div');
    fill.className = 'set-meter-fill';
    const peak = document.createElement('div');
    peak.className = 'set-meter-peak';
    track.append(band, fill, peak);

    const val = document.createElement('span');
    val.className = 'set-meter-val';
    val.textContent = off ? 'off' : _setDb(-Infinity);

    const clip = document.createElement('span');
    clip.className = 'set-meter-clip';

    row.append(lbl, track, val, clip);
    el.appendChild(row);
    rows.push({ track, fill, peak, val, clip, off, lvl: -60, pk: -60, pkAt: 0, clipAt: 0, lastTxt: '' });
  });

  _setGroups.set(containerId, { el, rows, sizeAt: -1 });
}

/** Point the group at the analysers it should read. Kept apart from the build
 *  so a device change can swap the sources without rebuilding the DOM. */
export function setMeterSources(containerId, analysers) {
  const g = _setGroups.get(containerId);
  if (g) g.analysers = analysers;
}

export function clearSetMeters(containerId) {
  const g = _setGroups.get(containerId);
  if (!g) return;
  for (const r of g.rows) {
    r.lvl = r.pk = -60;
    r.fill.style.width = '0%';
    r.peak.style.opacity = '0';
    r.clip.classList.remove('set-meter-clip--lit');
    if (!r.off) { r.val.textContent = _setDb(-Infinity); r.lastTxt = r.val.textContent; }
  }
}

function _tickSetGroup(g, now) {
  const an = g.analysers;
  if (!an?.length) return;
  // The heat ramp is anchored to the SCALE, so the fill's background-size is the
  // track's width — read every SET_SIZE_EVERY frames, not every frame: it is a
  // layout read, and doing it per channel per frame is what a meter must never
  // cost.
  if (_setFrame - g.sizeAt >= SET_SIZE_EVERY) {
    g.sizeAt = _setFrame;
    const w = g.rows[0]?.track.clientWidth || 0;
    if (w) for (const r of g.rows) r.fill.style.backgroundSize = w + 'px 100%';
  }
  for (let i = 0; i < g.rows.length; i++) {
    const r = g.rows[i];
    const a = an[i];
    if (!a || r.off) continue;
    a.getFloatTimeDomainData(_setBuf);
    let pk = 0;
    for (let s = 0; s < _setBuf.length; s++) { const v = _setBuf[s] < 0 ? -_setBuf[s] : _setBuf[s]; if (v > pk) pk = v; }
    const db = pk > 0 ? 20 * Math.log10(pk) : -120;

    // attack instant, release exponential
    r.lvl = db > r.lvl ? db : r.lvl + (db - r.lvl) * SET_RELEASE;
    if (r.lvl < -60) r.lvl = -60;

    if (r.lvl >= r.pk) { r.pk = r.lvl; r.pkAt = now; }
    else if (now - r.pkAt > SET_PEAK_HOLD) { r.pk -= SET_PEAK_FALL; if (r.pk < r.lvl) r.pk = r.lvl; }

    r.fill.style.width = setMeterX(r.lvl).toFixed(2) + '%';
    r.peak.style.left  = setMeterX(r.pk).toFixed(2) + '%';
    r.peak.style.opacity = r.pk > -59.5 ? '1' : '0';

    const txt = _setDb(r.lvl <= -59.9 ? -Infinity : r.lvl);
    if (txt !== r.lastTxt) { r.val.textContent = txt; r.lastTxt = txt; }

    if (pk >= 0.999) r.clipAt = now;
    const lit = now - r.clipAt < SET_CLIP_HOLD;
    r.clip.classList.toggle('set-meter-clip--lit', lit);
    r.val.classList.toggle('set-meter-val--over', lit);
  }
}

// ── The gate row ────────────────────────────────────────────────────────────
// Same element, carrying a threshold. Its axis is the GATE curve (gamma, from
// state.js) rather than the dB curve above — the noise floor is the part you
// aim with, so it takes most of the track — and its ballistics are the ones
// updateGateLight() already runs, so there is exactly one set.
let _setGate = null;

export function initSetGateMeter() {
  const row = document.getElementById('asGateMeterRow');
  if (!row) { _setGate = null; return; }
  _setGate = {
    row,
    track:  row.querySelector('.set-meter-track'),
    fill:   row.querySelector('.set-meter-fill'),
    peak:   row.querySelector('.set-meter-peak'),
    gated:  row.querySelector('.set-meter-gated'),
    thresh: row.querySelector('.set-meter-thresh'),
    tval:   row.querySelector('.set-meter-thresh-val'),
    val:    row.querySelector('.set-meter-val'),
    lastT:  '',
  };

  // The drag writes S.paintGateThreshold through gateFracToRms — the same
  // curve and the same setter the canvas used, so a pot, a drag and the
  // readout cannot disagree.
  const toThreshold = e => {
    const r = _setGate.track.getBoundingClientRect();
    if (!r.width) return S.paintGateThreshold;
    return gateFracToRms((e.clientX - r.left) / r.width);
  };
  let dragging = false;
  _setGate.track.addEventListener('mousedown', e => {
    dragging = true;
    S.paintGateThreshold = toThreshold(e);
    _syncGateVal();
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    S.paintGateThreshold = toThreshold(e);
    _syncGateVal();
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  // Double-click resets, matching every other control on the page.
  _setGate.track.addEventListener('dblclick', () => {
    const def = parseFloat(_setGate.row.dataset.default);
    if (!Number.isFinite(def)) return;
    S.paintGateThreshold = Math.max(0, Math.min(GATE_METER_MAX, def));
    _syncGateVal();
  });
}

/** Is the DOM gate row on screen? updateGateLight() advances the ballistics
 *  this row reads, and it skips the work when nothing is visible. */
export function setGateVisible() {
  return !!_setGate?.row.offsetParent;
}

function _rmsToDb(rms) { return rms > 0 ? 20 * Math.log10(rms) : -Infinity; }

function _tickSetGate() {
  if (!_setGate || !_setGate.row.offsetParent) return;
  const threshF = gateRmsToFrac(S.paintGateThreshold);
  _setGate.fill.style.width  = (_smoothedFrac * 100).toFixed(2) + '%';
  _setGate.peak.style.left   = (_peakFrac * 100).toFixed(2) + '%';
  _setGate.peak.style.opacity = _peakFrac > 0.005 ? '1' : '0';
  _setGate.gated.style.width = (threshF * 100).toFixed(2) + '%';
  _setGate.thresh.style.left = (threshF * 100).toFixed(2) + '%';
  const t = _setDb(_rmsToDb(S.paintGateThreshold)) + ' dB';
  if (t !== _setGate.lastT) { _setGate.tval.textContent = t; _setGate.lastT = t; }
  if (_setGate.val) _setGate.val.textContent = _setDb(_rmsToDb(gateFracToRms(_smoothedFrac)));
  _setGate.row.classList.toggle('is-gated', _smoothedFrac < threshF && S.paintGateThreshold > 0);
}

// ── One loop ────────────────────────────────────────────────────────────────

export function startSetMeters() {
  if (_setRAF) return;
  let acc = 0, n = 0;
  const tick = () => {
    const t0 = performance.now();
    _setFrame++;
    for (const g of _setGroups.values()) _tickSetGroup(g, t0);
    _tickSetGate();
    // Rolling cost, so "does this steal from the scheduler" is a number.
    acc += performance.now() - t0; n++;
    if (n === 60) { S._setMeterCost = acc / n; acc = 0; n = 0; }
    _setRAF = requestAnimationFrame(tick);
  };
  _setRAF = requestAnimationFrame(tick);
}

export function stopSetMeters() {
  if (_setRAF) { cancelAnimationFrame(_setRAF); _setRAF = null; }
  for (const id of _setGroups.keys()) clearSetMeters(id);
}
