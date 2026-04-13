// ============================================================================
// UI-METERS — shared multi-channel VU meter system
// Used by: ui-audio-settings.js (modal meters) and main window (in/out meters)
// ============================================================================

import { S } from './state.js';
import { dropSeqFromCursor, clearAllSeqs, releaseCommit, clearAllCommits, updateCommitBanksUI, updateSeqBanksUI } from './ui-presets.js';
import { tickHandsfree } from './handsfree.js';
import { updateDryMonitorPanning, setDryMonitorGain, setDryMonitorEnabled } from './audio.js';

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
    if (highlighted.includes(i)) {
      ch.style.outline = '1px solid #7abcbc';
      ch.style.borderRadius = '2px';
    }

    const clip = document.createElement('div');
    clip.className = 'as-vchan-clip';
    clip.id = `${containerId}-clip-${i}`;

    const canvas = document.createElement('canvas');
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
      // Pre-create gradient (height-dependent but canvas height is fixed at 56)
      const grad = c2.createLinearGradient(0, cv.height, 0, 0);
      grad.addColorStop(0,    '#2a7070');
      grad.addColorStop(0.6,  '#3a9090');
      grad.addColorStop(0.8,  '#7abcbc');
      grad.addColorStop(0.93, '#e8c840');
      grad.addColorStop(1.0,  '#e06060');
      grads.push(grad);
    } else {
      ctxs.push(null);
      grads.push(null);
    }
  }
  entry = { count, canvases, clips, ctxs, grads };
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
      c2.fillStyle = '#1a1a1a';
      c2.fillRect(0, 0, w, h);
      const fillH = Math.round(pct * h);
      if (fillH > 0) {
        c2.fillStyle = cache.grads[i];
        c2.fillRect(0, h - fillH, w, fillH);
      }
      // Tick marks at -12, -6, -3 dBFS
      c2.fillStyle = '#111a1a';
      for (const tickDb of [-12, -6, -3]) {
        const ty = h - Math.round((tickDb + 60) / 60 * h);
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
    renderMeters('mainMixdownMeters', 2, ['L', 'R']);
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

export function setScanMuted(muted) {
  S.scanMuted = muted;
  const t = S.audioCtx?.currentTime ?? 0;
  const ramp = 0.02; // 20ms smooth transition

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

// ── Radial morph toggle ──────────────────────────────────────────────────────
// Mirror of the gesture-panel morph toggle, available in the main cursor panel.
// Only visible in exp mode (S.exp === true).
export function initMorphToggle() {
  const btn = document.getElementById('morphBtn');
  if (!btn) return;

  // Restore state
  btn.classList.toggle('active', !!S.radialMorphOn);

  btn.addEventListener('click', () => {
    S.radialMorphOn = !S.radialMorphOn;
    btn.classList.toggle('active', S.radialMorphOn);
  });

  // Sync hook so the gesture panel toggle stays in sync
  S._syncMorphBtnUI = () => {
    btn.classList.toggle('active', !!S.radialMorphOn);
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
    // Dim the whole section when lock overrides fade
    seg.style.opacity = S.nearestMode ? '0.4' : '';
  };
  syncUI();
  // Expose so toggleNearestMode / selectPreset can refresh the fade UI
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

  // ── Trace mode cycle button (cursor panel) — bang, not toggle ──
  const commitLockBtn = document.getElementById('commitLockBtn');
  if (commitLockBtn) {
    commitLockBtn.addEventListener('click', () => {
      // If toggled trace is active, force-stop before mode change
      if (S._traceToggled) {
        S._stopToggleTrace?.();
      }
      const _modes = ['trace', 'trace+loop', 'trace+cloud'];
      const _idx = _modes.indexOf(S.traceMode);
      S.traceMode = _modes[(_idx + 1) % _modes.length];
      commitLockBtn.classList.add('flashing');
      setTimeout(() => commitLockBtn.classList.remove('flashing'), 180);
      S._syncCommitUI?.();
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
  const legacyLockBtn = document.getElementById('seedLockBtn');
  if (legacyLockBtn) {
    legacyLockBtn.addEventListener('click', () => {
      S.seedLockEnabled = !S.seedLockEnabled;
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

  // ── Commit slot count select (unified) ──
  const commitSlotSelect = document.getElementById('commitSlotCountSelect');
  if (commitSlotSelect) {
    commitSlotSelect.value = S.commitSlotCount;
    commitSlotSelect.addEventListener('change', () => {
      S.commitSlotCount = parseInt(commitSlotSelect.value, 10);
      S._syncCommitUI?.();
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
  const chk    = document.getElementById('dryMonitorEnabledChk');

  if (slider) {
    slider.value = S.dryMonitorGainValue;
    slider.addEventListener('input', () => setDryMonitorGain(parseFloat(slider.value)));
  }
  if (chk) {
    // Always start with dry monitor OFF, regardless of persisted/preset state
    S.dryMonitorEnabled = false;
    chk.checked = false;
    chk.addEventListener('change', () => setDryMonitorEnabled(chk.checked));
  }
  const num = document.getElementById('dryMonitorGainNum');
  if (num) num.textContent = Math.round(S.dryMonitorGainValue * 100) + '%';

  // Expose setter for MIDI/OSC access
  S._setDryMonitorGain = setDryMonitorGain;
}

// ── Main-window metering loop ────────────────────────────────────────────────
// Drives tickMeters for main window via its own RAF loop, independent of
// the sphere render loop. Call startMainMetering() once after init.
let _mainMeterRAF = null;

// ── Noise gate visual meter ──────────────────────────────────────────────────
// Canvas-drawn meter: input RMS bar + draggable threshold marker.
// Drawn on up to two canvases: modal (asGateMeter) and main UI (mainGateMeter).
const _gateBuf = new Float32Array(256);
const GATE_METER_MAX = 0.06;     // RMS scale ceiling (covers typical mic range)
let _gateMeterCanvas = null;     // modal canvas
let _gateMeterCtx    = null;
let _gateValEl       = null;     // modal value readout
let _mainGateCanvas  = null;     // main UI canvas
let _mainGateCtx     = null;
let _mainGateValEl   = null;     // main UI value readout
let _mainGateInited  = false;    // lazy DPR sizing for main UI canvas
let _smoothedRms     = 0;        // exponential smooth for bar
let _peakRms         = 0;        // peak-hold for peak marker
let _peakDecay       = 0;        // frames since peak was set
let _gateDragging    = false;    // threshold drag state

// Also update hidden elements for backward compat
let _gateLightEl = null;
let _rmsReadoutEl = null;

let _gateMeterInited = false;

/** Wire drag events on gate meter canvases (modal + main UI).
 *  Modal canvas sizing is deferred until it becomes visible. */
export function initGateMeter() {
  // ── Modal canvas (audio settings) ──────────────────────────────────────
  _gateMeterCanvas = document.getElementById('asGateMeter');
  if (_gateMeterCanvas) {
    _gateMeterCtx = _gateMeterCanvas.getContext('2d');
    _gateValEl    = document.getElementById('asNoiseGateVal');
  }

  // ── Main UI canvas (levels panel) ──────────────────────────────────────
  _mainGateCanvas = document.getElementById('mainGateMeter');
  if (_mainGateCanvas) {
    _mainGateCtx   = _mainGateCanvas.getContext('2d');
    _mainGateValEl = document.getElementById('mainNoiseGateVal');
  }

  // Drag to set threshold — only on the modal canvas (audio settings is source of truth).
  // Main UI canvas is read-only visual mirror.
  if (_gateMeterCanvas) {
    const xToThreshold = (clientX) => {
      const r = _gateMeterCanvas.getBoundingClientRect();
      if (r.width === 0) return S.vizNoiseFloor;
      return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * GATE_METER_MAX;
    };
    _gateMeterCanvas.addEventListener('mousedown', e => {
      _gateDragging = true;
      S.vizNoiseFloor = xToThreshold(e.clientX);
      _syncGateVal();
    });
    window.addEventListener('mousemove', e => {
      if (!_gateDragging) return;
      S.vizNoiseFloor = xToThreshold(e.clientX);
      _syncGateVal();
    });
    window.addEventListener('mouseup', () => { _gateDragging = false; });
  }

  // Main UI canvas: no drag, just default cursor
  if (_mainGateCanvas) _mainGateCanvas.style.cursor = 'default';

  // Lazy-init main UI canvas DPR sizing (always visible, so do it now)
  _ensureMainGateSized();
  // Show saved threshold value
  _syncGateVal();

  // ── S callback for MIDI / OSC access to noise gate threshold ────────────
  // Accepts linear RMS value (0 to GATE_METER_MAX), syncs readouts + hidden slider.
  S._setNoiseGateThreshold = (v) => {
    S.vizNoiseFloor = Math.max(0, Math.min(GATE_METER_MAX, v));
    _syncGateVal();
  };
}

/** Lazy DPR scaling — called once when the canvas first becomes visible */
function _ensureGateMeterSized() {
  if (_gateMeterInited || !_gateMeterCanvas) return false;
  const rect = _gateMeterCanvas.getBoundingClientRect();
  if (rect.width === 0) return false; // still hidden
  const dpr = window.devicePixelRatio || 1;
  _gateMeterCanvas.width  = Math.round(rect.width * dpr);
  _gateMeterCanvas.height = Math.round(rect.height * dpr);
  _gateMeterCtx.scale(dpr, dpr);
  _gateMeterInited = true;
  return true;
}

function _ensureMainGateSized() {
  if (!_mainGateCanvas) return false;
  const rect = _mainGateCanvas.getBoundingClientRect();
  if (rect.width === 0) return false;
  const dpr = window.devicePixelRatio || 1;
  const needW = Math.round(rect.width * dpr);
  const needH = Math.round(rect.height * dpr);
  // Re-size if dimensions changed (panel resize, projector mode toggle)
  if (_mainGateInited && _mainGateCanvas.width === needW && _mainGateCanvas.height === needH) return true;
  _mainGateCanvas.width  = needW;
  _mainGateCanvas.height = needH;
  _mainGateCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  _mainGateInited = true;
  return true;
}

function _syncGateVal() {
  const txt = S.vizNoiseFloor.toFixed(4);
  if (_gateValEl) _gateValEl.textContent = txt;
  if (_mainGateValEl) _mainGateValEl.textContent = txt;
  // Keep hidden slider in sync for persistence
  const hs = document.getElementById('asNoiseGateSlider');
  if (hs) hs.value = S.vizNoiseFloor;
}

/** Draw the gate meter onto a given canvas context at CSS-space w×h. */
function _drawGateMeter(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);

  const gated = S.vizNoiseFloor > 0 && _smoothedRms < S.vizNoiseFloor;
  const threshX = (S.vizNoiseFloor / GATE_METER_MAX) * w;
  const barX    = (_smoothedRms / GATE_METER_MAX) * w;
  const peakX   = (_peakRms / GATE_METER_MAX) * w;

  // Background track
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(0, 0, w, h);

  // RMS bar
  if (barX > 0.5) {
    const barH = h * 0.55;
    const barY = (h - barH) / 2;
    if (gated) {
      ctx.fillStyle = 'rgba(224, 80, 80, 0.5)';
      ctx.fillRect(0, barY, Math.min(barX, w), barH);
    } else {
      if (threshX > 0) {
        ctx.fillStyle = 'rgba(122, 188, 188, 0.2)';
        ctx.fillRect(0, barY, Math.min(threshX, barX, w), barH);
      }
      ctx.fillStyle = 'rgba(122, 188, 188, 0.5)';
      ctx.fillRect(Math.min(threshX, barX), barY, Math.max(0, Math.min(barX, w) - threshX), barH);
    }
  }

  // Peak marker (thin bright line)
  if (peakX > 1) {
    ctx.fillStyle = gated ? 'rgba(224, 80, 80, 0.7)' : 'rgba(122, 188, 188, 0.8)';
    ctx.fillRect(Math.min(peakX, w - 1), (h - h * 0.55) / 2, 1.5, h * 0.55);
  }

  // Threshold marker — vertical line with small triangles top and bottom
  if (S.vizNoiseFloor > 0 && threshX > 0 && threshX < w) {
    const tx = Math.round(threshX);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(tx + 0.5, 0);
    ctx.lineTo(tx + 0.5, h);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
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
  ctx.fillStyle = gated ? 'rgba(224, 80, 80, 0.7)' : 'rgba(122, 188, 188, 0.6)';
  ctx.fillText(gated ? 'gated' : 'open', w - 4, 10);
}

function updateGateLight() {
  const an = S.inputAnalyser;
  if (!_gateMeterCanvas && !_mainGateCanvas) {
    if (!_gateLightEl) _gateLightEl = document.getElementById('asGateLight');
    if (!an && _gateLightEl) _gateLightEl.classList.remove('closed');
    return;
  }
  if (!an) return;

  // Lazy canvas sizing
  if (!_gateMeterInited) _ensureGateMeterSized();
  if (!_mainGateInited)  _ensureMainGateSized();

  // Compute RMS
  an.getFloatTimeDomainData(_gateBuf);
  let sumSq = 0;
  for (let i = 0; i < _gateBuf.length; i++) sumSq += _gateBuf[i] * _gateBuf[i];
  const rms = Math.sqrt(sumSq / _gateBuf.length);

  // Smooth RMS for bar (fast attack, slower release)
  _smoothedRms = rms > _smoothedRms
    ? _smoothedRms * 0.3 + rms * 0.7
    : _smoothedRms * 0.85 + rms * 0.15;

  // Peak hold (decays after ~20 frames)
  if (rms > _peakRms) {
    _peakRms   = rms;
    _peakDecay = 0;
  } else {
    _peakDecay++;
    if (_peakDecay > 20) _peakRms *= 0.95;
  }

  // Update hidden elements for backward compat
  if (!_gateLightEl) _gateLightEl = document.getElementById('asGateLight');
  if (_gateLightEl) _gateLightEl.classList.toggle('closed', rms < S.vizNoiseFloor);

  // Draw on modal canvas (if visible / sized)
  if (_gateMeterInited && _gateMeterCtx) {
    const r = _gateMeterCanvas.getBoundingClientRect();
    _drawGateMeter(_gateMeterCtx, r.width, r.height);
  }

  // Draw on main UI canvas (always visible)
  if (_mainGateInited && _mainGateCtx) {
    const r = _mainGateCanvas.getBoundingClientRect();
    _drawGateMeter(_mainGateCtx, r.width, r.height);
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
  if (inAnalysers) tickMeters(inAnalysers, 'mainInputMeters');
  if (S.speakerAnalysers?.length) {
    const nHouse = S.speakerBuses?.length ?? S.speakerAnalysers.length;
    tickMeters(S.speakerAnalysers.slice(0, nHouse), 'mainHouseMeters');
    const mixAnalysers = S.speakerAnalysers.slice(nHouse);
    if (mixAnalysers.length) {
      tickMeters(mixAnalysers, 'mainMixdownMeters');
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
