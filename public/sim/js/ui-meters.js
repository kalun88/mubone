// ============================================================================
// UI-METERS — shared multi-channel VU meter system
// Used by: ui-audio-settings.js (modal meters) and main window (in/out meters)
// ============================================================================

import { S } from './state.js';
import { pickupSeqPause, pickupSeqRemove, dropNearestSeq, dropSeqFromCursor, clearAllSeqs, updateSeqBanksUI } from './ui-presets.js';

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
const _meterBuf = new Float32Array(256);
export function tickMeters(analysers, containerId) {
  for (let i = 0; i < analysers.length; i++) {
    const an = analysers[i];
    if (!an) continue;
    an.getFloatTimeDomainData(_meterBuf);
    let peak = 0;
    for (let s = 0; s < _meterBuf.length; s++) peak = Math.max(peak, Math.abs(_meterBuf[s]));
    const db  = peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
    const pct = clamp((db + 60) / 60, 0, 1);  // 0 = -60 dBFS, 1 = 0 dBFS

    const canvas = document.getElementById(`${containerId}-cv-${i}`);
    const clip   = document.getElementById(`${containerId}-clip-${i}`);

    if (canvas) {
      const c2 = canvas.getContext('2d');
      const w  = canvas.width;
      const h  = canvas.height;
      c2.clearRect(0, 0, w, h);
      c2.fillStyle = '#1a1a1a';
      c2.fillRect(0, 0, w, h);
      const fillH = Math.round(pct * h);
      if (fillH > 0) {
        const grad = c2.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0,    '#2a7070');
        grad.addColorStop(0.6,  '#3a9090');
        grad.addColorStop(0.8,  '#7abcbc');
        grad.addColorStop(0.93, '#e8c840');
        grad.addColorStop(1.0,  '#e06060');
        c2.fillStyle = grad;
        c2.fillRect(0, h - fillH, w, fillH);
      }
      // Tick marks at -12, -6, -3 dBFS
      c2.fillStyle = '#111a1a';
      for (const tickDb of [-12, -6, -3]) {
        const ty = h - Math.round((tickDb + 60) / 60 * h);
        c2.fillRect(0, ty, w, 1);
      }
    }

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
  if (!houseWrap) return;
  if (!S.speakerAnalysers?.length) {
    houseWrap.innerHTML = '';
    if (mixWrap)  mixWrap.innerHTML = '';
    if (mixGroup) mixGroup.hidden = true;
    return;
  }
  const nHouse     = S.speakerBuses?.length ?? S.speakerAnalysers.length;
  const hasMixdown = !!(S.monitorSpeakerBuses?.length);
  const houseLabels = Array.from({ length: nHouse }, (_, i) => String(i + 1));
  renderMeters('mainHouseMeters', nHouse, houseLabels);
  if (mixGroup) mixGroup.hidden = !hasMixdown;
  if (hasMixdown && mixWrap) {
    renderMeters('mainMixdownMeters', 2, ['L', 'R']);
  } else if (mixWrap) {
    mixWrap.innerHTML = '';
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
    const sel = S.mainInputChannel ?? 0;
    const labels = Array.from({ length: analysers.length }, (_, i) => String(i + 1));
    renderMeters('mainInputMeters', analysers.length, labels, sel);
  } else {
    // No device yet — single placeholder bar
    renderMeters('mainInputMeters', 1, ['in']);
  }
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

  // Update button appearance
  const btn = document.getElementById('scanBtn');
  if (btn) btn.classList.toggle('muted', muted);

  // Sync the improv panel mon→hse slider display when scan is off
  // (the actual S.monitorGainValue is preserved so unmuting restores it)
  const monNum = document.getElementById('improvMonitorNum');
  if (monNum && muted) monNum.value = '(muted)';
  else if (monNum) monNum.value = Math.round(S.monitorGainValue * 100) + '%';
}

export function initScanToggle() {
  const btn = document.getElementById('scanBtn');
  if (!btn) return;

  // Restore persisted state
  btn.classList.toggle('muted', !!S.scanMuted);

  btn.addEventListener('click', () => {
    setScanMuted(!S.scanMuted);
  });

  // ── Sync hook for patch table preset recall ─────────────────────────────
  S._syncScanUI = () => {
    btn.classList.toggle('muted', !!S.scanMuted);
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
    // When lock (nearestMode) is on, fade is forced off visually
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
  // Mode toggle button
  const btn = document.getElementById('seqModeBtn');
  if (btn) {
    const syncUI = () => {
      btn.classList.toggle('active', S.seqModeEnabled);
    };
    syncUI();
    btn.addEventListener('click', () => {
      S.seqModeEnabled = !S.seqModeEnabled;
      syncUI();
    });
  }

  // Seed lock toggle button
  const seedLockBtn = document.getElementById('seedLockBtn');
  if (seedLockBtn) {
    seedLockBtn.classList.toggle('active', S.seedLockEnabled);
    seedLockBtn.addEventListener('click', () => {
      S.seedLockEnabled = !S.seedLockEnabled;
      seedLockBtn.classList.toggle('active', S.seedLockEnabled);
    });
  }

  // Panel action buttons
  document.getElementById('seqLoopDropBtn')?.addEventListener('click', () => {
    dropSeqFromCursor();
  });
  document.getElementById('seqDropBtn')?.addEventListener('click', () => {
    dropNearestSeq();
  });
  document.getElementById('seqPickupPauseBtn')?.addEventListener('click', () => {
    pickupSeqPause();
  });
  document.getElementById('seqPickupRemoveBtn')?.addEventListener('click', () => {
    pickupSeqRemove();
  });
  document.getElementById('seqClearBtn')?.addEventListener('click', () => {
    clearAllSeqs();
  });

  // ── Seq record params (speed, volume, direction for next loop) ───────────
  // These controls always edit S.seqNextParams. Recorded loops inherit these
  // values at creation time and can't be modified after.
  const seqControlsEl = document.getElementById('seqControls');
  const seqVolSlider  = document.getElementById('seqVolumeSlider');
  const seqVolNum     = document.getElementById('seqVolumeNum');
  const seqSpdSlider  = document.getElementById('seqSpeedSlider');
  const seqSpdNum     = document.getElementById('seqSpeedNum');
  const seqDirSeg     = document.getElementById('seqDirectionSeg');

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

  if (seqDirSeg) {
    seqDirSeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        S.seqNextParams.direction = btn.dataset.dir === 'rev' ? -1 : 1;
        seqDirSeg.querySelectorAll('.grain-seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  // Show/hide the controls based on seq mode toggle
  // Controls are always visible — no need for a sync toggle.
  S._syncSeqControls = function syncSeqControls() {};

  // ── Sync hook for patch table preset recall ─────────────────────────────
  S._syncSeqUI = () => {
    // Loop lock toggle
    if (btn) btn.classList.toggle('active', S.seqModeEnabled);
    // Seed lock toggle
    if (seedLockBtn) seedLockBtn.classList.toggle('active', S.seedLockEnabled);
    // Volume slider + numbox
    if (seqVolSlider) seqVolSlider.value = S.seqNextParams.volume;
    if (seqVolNum)    seqVolNum.value    = Math.round(S.seqNextParams.volume * 100) + '%';
    // Speed slider + numbox
    if (seqSpdSlider) seqSpdSlider.value = S.seqNextParams.speed;
    if (seqSpdNum)    seqSpdNum.value    = S.seqNextParams.speed.toFixed(2) + '×';
    // Direction segment
    if (seqDirSeg) {
      const dirStr = S.seqNextParams.direction === -1 ? 'rev' : 'fwd';
      seqDirSeg.querySelectorAll('.grain-seg-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.dir === dirStr));
    }
  };

  // Expose updateSeqBanksUI on S so renderer can call it each frame
  S.updateSeqBanksUI = updateSeqBanksUI;

  // Initial draw
  updateSeqBanksUI();
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

// ── Main-window metering loop ────────────────────────────────────────────────
// Drives tickMeters for main window via its own RAF loop, independent of
// the sphere render loop. Call startMainMetering() once after init.
let _mainMeterRAF = null;

// ── Noise gate indicator ─────────────────────────────────────────────────────
// Reusable buffer for gate RMS computation (shares size with _meterBuf).
const _gateBuf = new Float32Array(256);
let _gateLightEl = null;

let _rmsReadoutEl = null;
let _rmsFrameCount = 0;          // throttle text updates to every 6th frame (~10 Hz)

function updateGateLight() {
  // Read the selected input analyser and compute RMS
  const an = S.inputAnalyser;
  if (!an) {
    if (_gateLightEl) _gateLightEl.classList.remove('closed');
    return;
  }
  an.getFloatTimeDomainData(_gateBuf);
  let sumSq = 0;
  for (let i = 0; i < _gateBuf.length; i++) sumSq += _gateBuf[i] * _gateBuf[i];
  const rms = Math.sqrt(sumSq / _gateBuf.length);

  if (!_gateLightEl) _gateLightEl = document.getElementById('asGateLight');
  if (_gateLightEl) {
    if (S.vizNoiseFloor > 0) {
      _gateLightEl.classList.toggle('closed', rms < S.vizNoiseFloor);
    } else {
      _gateLightEl.classList.remove('closed');
    }
  }

  // Live RMS readout — update text ~10 Hz to stay readable
  _rmsFrameCount++;
  if (_rmsFrameCount >= 6) {
    _rmsFrameCount = 0;
    if (!_rmsReadoutEl) _rmsReadoutEl = document.getElementById('asRmsReadout');
    if (_rmsReadoutEl) {
      _rmsReadoutEl.textContent = rms.toFixed(4);
      // Colour hint: green when above gate, red when below (gated)
      if (S.vizNoiseFloor > 0 && rms < S.vizNoiseFloor) {
        _rmsReadoutEl.style.color = '#e05050';
      } else {
        _rmsReadoutEl.style.color = '#7abcbc';
      }
    }
  }
}

let _meterTickCount = 0;

export function startMainMetering() {
  // No longer runs its own RAF loop — called from the main animate() loop
  // via S._tickMainMeters(). Setup only.
  if (_mainMeterRAF) { cancelAnimationFrame(_mainMeterRAF); _mainMeterRAF = null; }
  rebuildMainInputMeter();
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
    if (mixAnalysers.length) tickMeters(mixAnalysers, 'mainMixdownMeters');
  }
  updateGateLight();
}

export function stopMainMetering() {
  if (_mainMeterRAF) { cancelAnimationFrame(_mainMeterRAF); _mainMeterRAF = null; }
}
