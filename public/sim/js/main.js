// ============================================================================
// MAIN — entry point: wire up all modules and start the app
// ============================================================================

import { S, DEBUG, GRAIN_SCHEDULER_INTERVAL_MS } from './state.js';
import { showWaveformOverlay } from './debug-waveform.js';
import { scheduleGrains } from './grain.js';
import { setupEvents, setupDragDrop } from './events.js';
import { rebuildSampleListUI, buildSvTabs, drawSvWaveform, initUndoBtn } from './ui-samples.js';
import {
  setupPresets, initGrainControls, initDesktopMorph,
  drawPresetWaveform, updatePlaybackControls, selectPreset,
} from './ui-presets.js';
import { setupMappingModal, initMidi } from './midi.js';
import { initAccessory } from './accessory-registry.js';
import { initAccessoryUI } from './ui-accessory.js';
import { initMobileMode } from './mobile.js';
import { initQuadBuses, initSpeakerBuses, requestMicAccess } from './audio.js';
import { resizeCanvas, animate } from './renderer.js';
import { startMainMetering, rebuildMainOutputMeters, initScanToggle, initMorphToggle, initRadiusFade, initSeqMode, initMixdownGains, initDryMonitorGains, initAudioPanel, setScanMuted, initGateMeter } from './ui-meters.js';
import { initSensor, getSensorCamQ, getSensorCursorQ, getFrameQ, getCameraQ, recenterCursor, assignQuatRole } from './sensor-registry.js';
import { initOSC } from './osc.js';
import { initStatusPublisher } from './status-publisher.js';
import { initXimuLedFeedback } from './ximu-led-feedback.js';
import { initLedMapUI } from './ui-led-map.js';
import { initAudioSettings, loadAudioDefaults, activateSavedInputDevice, startAutoSave } from './ui-audio-settings.js';

import { initImprovUI } from './ui-improv.js';
import { initVizUI } from './ui-viz.js';
import { initSweepUI, initSessionPanel } from './ui-sweep.js';
import { initEraseUI } from './erase.js';
import { initExportImport } from './ui-export.js';
import { initPatchTable } from './ui-patch-table.js';
import { initMappingUI } from './ui-sensor-mapping.js';
import { initIMUSetupUI } from './ui-imu-setup.js';
import { qMul, qNormalize, qFromAxisAngle, qRotateVec } from './sphere.js';
import { startPaintTicker, getPaintTickerState } from './paint-ticker.js';
import { initPanelDrag } from './panel-drag.js';
import { CATEGORIES, keysFor, unregisteredKeys } from './storage-registry.js';
import {
  startWorkletGrain, stopWorkletGrain, updateWorkletParams,
  isCrossOriginIsolated, hotSwapRecording, getWorkletDiag,
  isWorkletGrainActive,
} from './grain-worklet-bridge.js';


// ── Worklet grain engine — always-on startup/management ─────────────────────
// Worklet is the only grain engine (main-thread grain scheduler was removed
// in the Mar 28 Phase 5 refactor).
// Auto-starts on first recording. Sliders drive the worklet directly.

async function _startWorkletEngine(buf, opts = {}) {
  if (!S.audioCtx) {
    console.warn('worklet: no AudioContext');
    return false;
  }
  const ov = S.grainOverrides;
  const base = S.grainParams || {};
  const DIR_MAP  = { fwd: 0, rev: 1, rand: 2 };
  const CURVE_MAP = { hann: 0, tri: 1, rect: 2 };

  console.log(`worklet: starting — ${(buf.length / buf.sampleRate).toFixed(1)}s buffer, 256-slot pool`);

  const node = await startWorkletGrain(S.audioCtx, buf, {
    period:           opts.period           ?? ov.period           ?? base.period           ?? 0.050,
    duration:         opts.duration         ?? ov.duration         ?? base.duration         ?? 0.100,
    grainStart:       opts.grainStart       ?? Math.floor(buf.length * 0.25),
    volume:           opts.volume           ?? ov.volume           ?? base.volume           ?? 0.6,
    pitchShift:       opts.pitchShift       ?? ov.pitchShift       ?? base.pitchShift       ?? 0,
    pitchJitter:      opts.pitchJitter      ?? ov.pitchJitter      ?? base.pitchJitter      ?? 0,
    periodVar:        opts.periodVar        ?? ov.periodVar        ?? base.periodVar        ?? 0,
    durVar:           opts.durVar           ?? ov.durVar           ?? base.durVar           ?? 0,
    durJitter:        opts.durJitter        ?? ov.durJitter        ?? base.durJitter        ?? 0,
    envShape:         opts.envShape         ?? CURVE_MAP[S.grainCurveType] ?? 0,
    probability:      opts.probability      ?? S.grainProbability ?? 1.0,
    direction:        opts.direction        ?? DIR_MAP[S.grainDirection] ?? 0,
    hpfFreq:          opts.hpfFreq          ?? ov.hpfFreq          ?? base.hpfFreq          ?? 20,
    lpfFreq:          opts.lpfFreq          ?? ov.lpfFreq          ?? base.lpfFreq          ?? 20000,
    filterQ:          opts.filterQ          ?? ov.filterQ          ?? base.filterQ          ?? 0.707,
    filterFreqJitter: opts.filterFreqJitter ?? ov.filterFreqJitter ?? base.filterFreqJitter ?? 0,
    kSeqMode:         S.grainKSeqMode ?? false,
  }, {
    numChannels: S.speakerBuses?.numChannels || S.audioCtx.destination.channelCount || 2,
    onFeedback: (data) => {
      if (opts.verbose) {
        console.log(`worklet: ${data.activeCount} active grains, ${data.grains.length} fired`);
      }
    },
  });
  if (node) {
    console.log('worklet: engine running — sliders drive it directly');
    return true;
  }
  console.warn('worklet: failed to start — check console for errors');
  return false;
}

function _stopWorkletEngine() {
  stopWorkletGrain();
}

// Restart the worklet with the current buffers but a new channel count.
// Called via S._restartWorkletEngine when the output device changes.
async function _restartWorkletEngine() {
  if (!isWorkletGrainActive()) return;
  // Grab the most recent recording buffer to use as primary SAB
  const buffers = S.liveRecBuffers?.filter(b => b?.buffer) ?? [];
  const buf = buffers.length > 0 ? buffers[buffers.length - 1].buffer : null;
  if (!buf) return;

  console.log(`worklet: restarting for channel count change (${S.speakerBuses?.numChannels ?? 2} ch)`);
  _stopWorkletEngine();
  await _startWorkletEngine(buf);

  // Re-send all additional recording buffers (hot-swap each one)
  for (let i = 0; i < buffers.length - 1; i++) {
    hotSwapRecording(buffers[i].buffer);
  }
}

// Rebuild the worklet's buffer map after S.samples / S.liveRecBuffers were
// replaced wholesale (session import). Two failure modes the import path has
// to repair:
//
//   1. Worklet was running before import — its _bufferMap is keyed on the
//      pre-import AudioBuffer references, so every imported particle's
//      audioBuf misses (bufIndex === undefined) and candidate posts get
//      filtered out at the bridge.
//   2. Worklet was NOT running before import (e.g. fresh page then import
//      session) — S._postWorkletCandidates is null, so the cursor's
//      grain scheduler posts to a no-op and never fires grains, even
//      though buffers, particles, and clouds all populated correctly.
//
// Both cases are repaired by (re)starting the worklet with an imported
// buffer — startWorkletGrain rebuilds _bufferMap from current S.samples /
// S.liveRecBuffers and reattaches S._postWorkletCandidates.
async function _reloadWorkletEngine() {
  // Pick a buffer to seed the SAB. Prefer the latest live recording, then
  // fall back to a sample so import works even when the export carried
  // only painted samples (no mic recordings).
  const liveBuf = (S.liveRecBuffers?.filter(b => b?.buffer) ?? []).slice(-1)[0]?.buffer ?? null;
  const sampleBuf = S.samples?.find(s => s?.buffer)?.buffer ?? null;
  const buf = liveBuf || sampleBuf;
  if (!buf) {
    // No audio in the import — nothing to play. Make sure any stale
    // worklet (with pre-import buffer map) is torn down; next paint or
    // recording will cold-start it cleanly.
    if (isWorkletGrainActive()) _stopWorkletEngine();
    return;
  }
  console.log('worklet: reloading after session import — refreshing buffer map');
  if (isWorkletGrainActive()) _stopWorkletEngine();
  await _startWorkletEngine(buf);
}

function init() {
  // Forward main-process logs to DevTools console
  if (window.electronBridge?.onMainLog) {
    window.electronBridge.onMainLog((level, msg) => {
      (console[level] || console.log)(`[main] ${msg}`);
    });
  }

  // Multi-station: show which instance this window is (solo = no badge)
  const _instName = window.electronBridge?.instanceName;
  const _oscPort  = window.electronBridge?.oscPort;
  if (_instName) {
    const badge = document.createElement('span');
    badge.className   = 'top-bar-instance';
    badge.textContent = `[${_instName}]`;
    badge.title       = `instance ${_instName} — own settings profile, OSC port ${_oscPort ?? '?'}`;
    document.querySelector('.top-bar-brand')?.appendChild(badge);
  }
  // OSC listen port display in the keys/midi/osc modal — which port THIS
  // window answers on (Electron UDP; browser mode uses the WS bridge instead)
  {
    const _isElectron = !!window.electronBridge?.isElectron;
    const el = document.getElementById('oscPortDisplay');
    if (el) el.textContent = _isElectron ? `udp ${_oscPort ?? 7500}` : 'ws 8080';
    // Fill the Max setup help text: literal port in the [udpsend] example…
    for (const s of document.querySelectorAll('.js-osc-port')) {
      s.textContent = String(_oscPort ?? 7500);
    }
    // …and which station this window is.
    // Browser mode has no UDP listener at all — OSC arrives over the WebSocket
    // bridge (Max's bridge.js or proxy.js) on 8080, so quoting a UDP port here
    // sends people to configure a [udpsend] that nothing is listening on.
    const st = document.getElementById('oscStationInline');
    if (st) {
      st.textContent = !_isElectron
        ? 'browser — OSC arrives over the ws://localhost:8080 bridge, not UDP'
        : _instName
          ? `station ${_instName} (port ${_oscPort ?? '?'})`
          : `solo (port ${_oscPort ?? 7500})`;
    }
  }

  // ── Narrow-mode canvas hoist ────────────────────────────────────────────
  // At narrow widths the panel column becomes a two-column multicol so tiles
  // PACK (flex-wrap banded every row to its tallest member, which left big
  // dead gaps). A multicol spanner can't be position:sticky and it splits the
  // flow, so the canvas tile is moved out to .main-layout for the duration —
  // sibling of the panel, sticky against the same scroller. Purely positional;
  // the canvas element and its context are untouched, so no re-render.
  {
    const NARROW_MAX = 700;
    let hoisted = false;
    const syncCanvasHoist = () => {
      const mini   = document.querySelector('.projector-mini-canvas');
      const layout = document.querySelector('.main-layout');
      const panel  = document.querySelector('.right-panel');
      if (!mini || !layout || !panel) return;          // pre-partition, retry next resize
      const narrow = window.innerWidth <= NARROW_MAX;
      if (narrow && !hoisted) {
        layout.insertBefore(mini, panel);
        hoisted = true;
        resizeCanvas();
      } else if (!narrow && hoisted) {
        panel.insertBefore(mini, panel.firstChild);    // back inside before re-nesting
        hoisted = false;
        S._repartitionProjector?.();                   // restores centerWrap nesting
        resizeCanvas();
      }
    };
    S._syncCanvasHoist = syncCanvasHoist;
    window.addEventListener('resize', syncCanvasHoist);
    // Partition runs on a rAF at boot; land after it.
    requestAnimationFrame(() => requestAnimationFrame(syncCanvasHoist));
  }

  S.canvas = document.getElementById('sphereCanvas');
  S.ctx    = S.canvas.getContext('2d');

  resizeCanvas();
  setupEvents();
  setupDragDrop();
  loadAudioDefaults();   // restore saved settings before any UI init
  rebuildSampleListUI();
  S.updateLiveRecUI?.();
  setupPresets();
  initGrainControls();
  initDesktopMorph();
  setupMappingModal();
  initMidi();
  // Accessory must init after setupMappingModal — it binds against the ACTIONS
  // registry that publishes S._actions / S._dispatchAction.
  initAccessory();
  initAccessoryUI();
  // Prompt for mic permission on load — but skip in Electron where RtAudio
  // handles input (getUserMedia always fails there → spurious "mic denied").
  // Electron input is activated asynchronously below via activateSavedInputDevice.
  if (!window.electronBridge?.isElectron) {
    requestMicAccess();
  }
  if (S.isMobile) initMobileMode();

  // Sensor + OSC + audio settings
  initSensor();
  initOSC();   // connects Electron IPC or browser WebSocket transport
  initStatusPublisher();  // publishes /status/* so joycon GUI etc. can mirror app state on LEDs/rumble
  initXimuLedFeedback();  // RGB LED engine — drives the cursor-assigned x-IMU3 from the LED mapping table
  initLedMapUI();         // the mapping table modal itself (top-bar LED button)
  S._getSensorCamQ    = getSensorCamQ;       // hook renderer without a circular import
  S._getSensorCursorQ = getSensorCursorQ;    // cursor quat (multi-IMU: world in camera mode, delta in frame mode)
  S._getCameraQ       = getCameraQ;          // projector-aim: rotates the viewport (camera-role sensor)
  S._getFrameQ        = getFrameQ;           // body-reference: attaches sphere to body (frame-role sensor) — staging + new main path
  // Drift correction. NO UI caller — the button is disabled pending #76 and the
  // auto-recenter path went away with sensor-registry's slotTare (2026-08-01).
  // Kept exposed deliberately: this is the handle for investigating #76 from
  // the console. S.driftOffsetQ stays null until someone calls it, so every
  // read of it downstream is an inert null-check.
  S._recenterCursor   = recenterCursor;
  // (S._onTare hung here to clear driftOffsetQ on a fresh tare. Only slotTare
  // ever called it; imu-setup's captureTare — the tare that actually runs —
  // never did. Removed with slotTare rather than left as a hook nothing fires.)

  // ── IMU-driven cursor freshness ──────────────────────────────────────────
  // On every cursor-role quaternion arrival (up to 400Hz), update S.cursorQ
  // so the paint ticker's 200Hz poll reads a fresh position.
  S._onCursorQuatArrival = () => {
    if (S.cameraMode !== 'sensor') return;

    // Same transforms as the render loop: drift correction + axis locks.
    // Idempotent — the render loop will overwrite at 30fps for visuals.
    const cq = getSensorCursorQ();   // non-null in detethered two-IMU mode
    const sq = getSensorCamQ();      // non-null in single-IMU mode

    if (cq) {
      let q = cq;
      if (S.driftOffsetQ) q = qNormalize(qMul(S.driftOffsetQ, q));
      if (S.axisLockAz || S.axisLockEl) {
        const fwd = qRotateVec(q, [0, 0, 1]);
        let yaw   = Math.atan2(fwd[0], fwd[2]);
        let pitch = Math.asin(Math.max(-1, Math.min(1, -fwd[1])));
        if (S.axisLockAz && S._axisLockFrozenYaw != null) yaw = S._axisLockFrozenYaw;
        if (S.axisLockEl && S._axisLockFrozenPitch != null) pitch = S._axisLockFrozenPitch;
        const qY = qFromAxisAngle(0, 1, 0, yaw);
        const qP = qFromAxisAngle(1, 0, 0, pitch);
        S.cursorQ = qNormalize(qMul(qY, qP));
      } else {
        S.cursorQ = q;
      }
    } else if (sq) {
      let q = sq;
      if (S.driftOffsetQ) q = qNormalize(qMul(S.driftOffsetQ, q));
      if (S.axisLockAz || S.axisLockEl) {
        const fwd = qRotateVec(q, [0, 0, 1]);
        let yaw   = Math.atan2(fwd[0], fwd[2]);
        let pitch = Math.asin(Math.max(-1, Math.min(1, -fwd[1])));
        if (S.axisLockAz && S._axisLockFrozenYaw != null) yaw = S._axisLockFrozenYaw;
        if (S.axisLockEl && S._axisLockFrozenPitch != null) pitch = S._axisLockFrozenPitch;
        const qY = qFromAxisAngle(0, 1, 0, yaw);
        const qP = qFromAxisAngle(1, 0, 0, pitch);
        S.camQ = qNormalize(qMul(qY, qP));
      } else {
        S.camQ = q;
      }
    }
  };

  // Paint ticker: single 200Hz timer polls cursor position and deposits
  // particles via adaptive angular spacing. Works identically for all modes.
  startPaintTicker();
  window.paintTicker = getPaintTickerState;

  // ── Double-click any slider with `data-default="X"` to reset it ────────
  // Opt-in: only sliders that carry a data-default attribute respond. The
  // reset dispatches `input` + `change` events so the slider's own handlers
  // run exactly as if the user dragged it — state updates, mirror sliders
  // sync, readouts refresh, no special-casing per control.
  document.addEventListener('dblclick', (e) => {
    const slider = e.target.closest('input[type="range"][data-default]');
    if (!slider) return;
    const def = parseFloat(slider.dataset.default);
    if (!Number.isFinite(def)) return;
    slider.value = String(def);
    slider.dispatchEvent(new Event('input',  { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });

  initMappingUI();
  initIMUSetupUI();
  initAudioSettings();
  initImprovUI();
  initVizUI();
  initSweepUI();
  initSessionPanel();
  initEraseUI();
  initUndoBtn();
  initExportImport();
  initPatchTable(updatePlaybackControls, setScanMuted, selectPreset);
  startAutoSave();       // begin 2s dirty-check auto-persist for settings

  // ── Collapsible panels ───────────────────────────────────────────────────
  // Click any device-label to collapse/expand its body. State persists in
  // localStorage so panels stay collapsed across reloads.

  // Helper: get the panel key from a device element
  function _panelKey(device) { return device?.className.match(/device--(\S+)/)?.[1]; }

  // Helper: save current panel order to localStorage
  function _savePanelOrder() {
    const panel = document.querySelector('.right-panel');
    if (!panel) return;
    const order = [...panel.querySelectorAll('.device')]
      .map(d => _panelKey(d)).filter(Boolean);
    localStorage.setItem('mubone_panel_order', JSON.stringify(order));
    // In projector mode the left/right column partition follows document
    // order — re-run it after each reorder so the split tracks the move.
    S._repartitionProjector?.();
  }

  // Restore saved panel order on load
  try {
    const saved = JSON.parse(localStorage.getItem('mubone_panel_order'));
    if (saved && Array.isArray(saved)) {
      const panel = document.querySelector('.right-panel');
      if (panel) {
        const devices = new Map();
        panel.querySelectorAll('.device').forEach(d => {
          const k = _panelKey(d);
          if (k) devices.set(k, d);
        });
        // re-append in saved order (unsaved devices stay at end)
        for (const k of saved) {
          const d = devices.get(k);
          if (d) { panel.appendChild(d); devices.delete(k); }
        }
        for (const d of devices.values()) panel.appendChild(d);
      }
    }
  } catch (_) {
    // Corrupt panel order JSON — remove so it doesn't fail repeatedly
    try { localStorage.removeItem('mubone_panel_order'); } catch (_2) {}
  }

  for (const label of document.querySelectorAll('.device-label')) {
    const device = label.closest('.device');
    if (!device) continue;
    const key = _panelKey(device);
    if (key && localStorage.getItem(`mubone_panel_${key}`) === '1') device.classList.add('collapsed');
    label.addEventListener('click', () => {
      device.classList.toggle('collapsed');
      if (key) localStorage.setItem(`mubone_panel_${key}`, device.classList.contains('collapsed') ? '1' : '0');
    });
  }
  // Panel rearrangement is click-and-drag (panel-drag.js, 2026-07-06 —
  // replaced the old ▲▼ reorder arrows). Expose the saver so drops persist
  // through the same path the arrows used: document order + a repartition,
  // which writes the v2 projector layout from the DOM.
  S._savePanelOrder = _savePanelOrder;
  initPanelDrag();

  // ── Collapsible sections (within devices) ─────────────────────────────
  // Click section-toggle labels to collapse/expand subsections.
  for (const section of document.querySelectorAll('.seq-section--collapsible')) {
    const key = section.dataset.collapseKey;
    // A section may ship collapsed in the markup (the default state). Only a
    // STORED value overrides it — and it must be able to override in both
    // directions, or expanding a markup-collapsed section would never stick.
    const stored = key ? localStorage.getItem(`mubone_sec_${key}`) : null;
    if (stored !== null) section.classList.toggle('collapsed', stored === '1');
    const toggle = section.querySelector('.seq-section-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        section.classList.toggle('collapsed');
        if (key) localStorage.setItem(`mubone_sec_${key}`, section.classList.contains('collapsed') ? '1' : '0');
      });
    }
  }

  // ── Layout settled — lift the boot veil ────────────────────────────────
  // Everything that moves the UI from its markup position has now run:
  // initVizUI (root font-size), the panel-order restore + repartition, the
  // per-panel collapse restore, and the section collapse restore above.
  // Reveal on the next frame so the browser paints the settled layout once,
  // instead of the three reflows the veil is hiding. See the bootstrap in
  // index.html <head> — it has a 4s failsafe if we never get here.
  requestAnimationFrame(() => {
    const d = document.documentElement;
    d.classList.add('booting-reveal');
    d.classList.remove('booting');
    // Drop the transition again once it has played — .main-layout wraps the
    // canvas and the render loop is timing-sensitive, so nothing permanent.
    setTimeout(() => d.classList.remove('booting-reveal'), 400);
  });

  // ── Reset ──────────────────────────────────────────────────────────────────
  // The app persists to localStorage ONLY — no IndexedDB, no sessionStorage.
  // Keep it that way: everything below assumes it.
  //
  // This used to be a single nuclear `localStorage.clear()` with one "keep my
  // patches" escape hatch, deliberately list-free because an enumerated key
  // list rots every time a module adds a key (exactly what happened to the
  // export's STATIC_KEYS — docs/EXPORT-IMPORT-AUDIT-2026-07.md). Per-category
  // reset needs a list, so the list now lives in ONE place with a drift
  // detector behind it: js/storage-registry.js, asserted by
  // scripts/browser-audit.js. Unregistered keys are still wiped by a select-all
  // (the safe direction) but get warned about, so a missing entry surfaces
  // instead of quietly making a key un-keepable.
  //
  // Everything here works by deleting keys and reloading — there is no
  // "apply defaults live" path, because defaults are just what the modules
  // initialise to on a cold boot. Don't add one; the reload IS the mechanism.
  //
  // The one thing key deletion does NOT reach is Cache Storage + the service
  // worker (browser mode). Those survive and keep serving the previous build,
  // which makes "back to day one" untrue precisely when someone is resetting
  // because something is behaving strangely — so select-all tears them down.
  async function _clearOfflineCache() {
    try {
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch (_) {}
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.() ?? [];
      await Promise.all(regs.map(r => r.unregister()));
    } catch (_) {}
  }

  // Reset — pick which storage categories go back to defaults. Select-all is
  // the old factory reset (everything + offline cache + service worker).
  document.getElementById('resetBtn')?.addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'factory-reset-overlay';
    const rows = CATEGORIES.map(c => `
      <label class="reset-cat">
        <input type="checkbox" data-cat="${c.id}">
        <span class="reset-cat-text">
          <span class="reset-cat-label">${c.label}</span>
          <span class="reset-cat-hint">${c.hint}</span>
        </span>
      </label>
    `).join('');

    // Surface drift rather than hiding it: if a key is in localStorage but not
    // in the registry, say so in the dialog. Select-all still clears it.
    const orphans = unregisteredKeys();
    const warn = orphans.length
      ? `<p class="reset-warn">${orphans.length} stored key(s) aren't in the registry
         (${orphans.join(', ')}) — only <em>select all</em> clears these.
         They should be added to js/storage-registry.js.</p>`
      : '';

    overlay.innerHTML = `
      <div class="factory-reset-dialog">
        <div class="factory-reset-title">reset</div>
        <p class="factory-reset-desc">Return the checked items to their defaults. The page reloads afterwards.</p>
        <div class="reset-cats">
          ${rows}
          <label class="reset-cat reset-cat-all">
            <input type="checkbox" data-all="1">
            <span class="reset-cat-text">
              <span class="reset-cat-label">select all + clear offline cache</span>
              <span class="reset-cat-hint">full factory reset — also drops the service worker and cached build</span>
            </span>
          </label>
        </div>
        ${warn}
        <div class="factory-reset-btns">
          <button class="factory-reset-btn factory-reset-cancel">cancel</button>
          <button class="factory-reset-btn factory-reset-confirm" disabled>reset</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const catBoxes = [...overlay.querySelectorAll('input[data-cat]')];
    const allBox   = overlay.querySelector('input[data-all]');
    const confirm  = overlay.querySelector('.factory-reset-confirm');

    // Select-all drives the category boxes; unticking any one of them releases
    // select-all (so you can't end up with the cache teardown armed while the
    // categories it belongs with are unchecked).
    const sync = () => {
      const n = catBoxes.filter(b => b.checked).length;
      confirm.disabled = n === 0 && !allBox.checked;
      confirm.textContent = allBox.checked ? 'factory reset' : 'reset';
    };
    allBox.addEventListener('change', () => {
      catBoxes.forEach(b => { b.checked = allBox.checked; });
      sync();
    });
    catBoxes.forEach(b => b.addEventListener('change', () => {
      if (!b.checked) allBox.checked = false;
      else if (catBoxes.every(x => x.checked)) allBox.checked = true;
      sync();
    }));

    overlay.querySelector('.factory-reset-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      confirm.textContent = 'resetting…';

      const cats     = catBoxes.filter(b => b.checked).map(b => b.dataset.cat);
      const wipeAll  = allBox.checked;

      if (wipeAll) {
        // clear() rather than the key list, so anything unregistered goes too.
        // This is the one path where being exhaustive beats being precise.
        localStorage.clear();
      } else {
        for (const k of keysFor(cats)) {
          try { localStorage.removeItem(k); } catch (_) {}
        }
      }
      console.log(`[reset] cleared: ${wipeAll ? 'everything' : cats.join(', ') || 'nothing'}`);

      // Cache teardown is async, browser-only (no-op in Electron), and only
      // part of a full reset. Race it against a timeout — a hang before
      // location.reload() would leave the app half-wiped, which is worse than
      // an uncleared cache.
      if (wipeAll) {
        await Promise.race([
          _clearOfflineCache(),
          new Promise(r => setTimeout(r, 1500)),
        ]);
      }
      location.reload();
    });
  });

  // When speaker buses are (re)initialised, rebuild the main-window output meters.
  // Using a callback on S avoids a circular import between audio.js and ui-meters.js.
  // S._rebuildMainOutputMeters is also set inside startMainMetering() for the renderer shim.
  S._onSpeakerBusesReady = () => rebuildMainOutputMeters();

  // ── Sample instrument modal ──────────────────────────────────────────────────
  const sampleModal    = document.getElementById('sampleModal');
  const sampleOpenBtn  = document.getElementById('bottomPanelToggleBtn');
  const sampleCloseBtn = document.getElementById('sampleModalClose');
  if (sampleModal && sampleOpenBtn) {
    sampleOpenBtn.addEventListener('click', () => {
      const opening = !sampleModal.classList.contains('open');
      sampleModal.classList.toggle('open', opening);
      sampleOpenBtn.classList.toggle('open', opening);
      // Rebuild all slot waveforms + sv display when the panel opens —
      // samples loaded while the panel was closed have zero-size canvases.
      // Double-rAF: first rAF triggers layout of the newly-visible modal,
      // second rAF runs after elements have real dimensions.
      if (opening) requestAnimationFrame(() => requestAnimationFrame(() => {
        rebuildSampleListUI();
      }));
    });
    sampleCloseBtn?.addEventListener('click', () => {
      sampleModal.classList.remove('open');
      sampleOpenBtn.classList.remove('open');
    });
    // Click backdrop to close
    sampleModal.addEventListener('click', e => {
      if (e.target === sampleModal) {
        sampleModal.classList.remove('open');
        sampleOpenBtn.classList.remove('open');
      }
    });
  }

  // ── Camera mode modal ──────────────────────────────────────────────────────
  // Camera mode: pull / surface / sensor (independent of audio spatialization)
  // Segmented picker in the top bar — replaced the camera modal on 2026-08-01,
  // so this is now the only camera-mode UI.
  const cameraModeSeg = document.getElementById('cameraModeSeg');

  // Base tooltip per chip, captured from the markup once so the sensor chip's
  // dynamic suffix can be re-appended without compounding. ui-learn.js has
  // already relocated `title` → `data-title` by the time this runs.
  const _camTips = new Map();

  function updateCameraModeBtn() {
    cameraModeSeg?.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === S.cameraMode);
      if (!_camTips.has(btn)) _camTips.set(btn, btn.getAttribute('data-title') || '');
      // Sensor mode carries a 1-vs-2-sensor state that used to be a subtitle
      // in the modal. Written to data-title directly, not `title`: ui-learn.js
      // moves any title it sees, so setting title here would work but reading
      // it back never does — data-title is the honest field.
      if (btn.dataset.mode === 'sensor') {
        const state = S.cameraMode === 'sensor'
          ? (S.detethered ? '\ncurrently: 2 sensors — cursor free'
                          : '\ncurrently: 1 sensor — cursor locked')
          : '';
        btn.setAttribute('data-title', _camTips.get(btn) + state);
      }
    });
  }

  function applyCameraMode(mode) {
    S.cameraMode = mode;
    updateCameraModeBtn();

    // Clear alt-lock when switching modes to avoid stale state
    if (S.altLocked) {
      S.altLocked = false;
      const ind = document.getElementById('altLockIndicator');
      if (ind) ind.style.display = 'none';
    }

    if (mode === 'surface') {
      // Reset camera to canonical forward and surface position to center
      S.camQ = [0, 0, 0, 1];
      S._resetSurfacePosition?.();
      // Request pointer lock (the chip click qualifies as a user gesture)
      S._requestSurfaceLock?.();
      // Say how to get back out — the pointer is now captured and nothing else
      // on screen names the key that releases it.
      S._showSurfaceEntryHint?.();
    } else if (mode === 'sensor') {
      S._hideSurfaceEntryHint?.();
      // Exit pointer lock + overlay if leaving surface mode
      S._exitSurfaceLock?.();
      S._hideSurfaceOverlay?.();
      // Sensor: hide cursor, mouse is free for UI
      if (S.canvas) S.canvas.style.cursor = 'none';
    } else {
      S._hideSurfaceEntryHint?.();
      // Exit pointer lock + overlay if leaving surface mode
      S._exitSurfaceLock?.();
      S._hideSurfaceOverlay?.();
      // Pull: show cursor
      if (S.canvas) S.canvas.style.cursor = '';
    }

    DEBUG && console.log(`[camera] mode: ${S.cameraMode}`);
  }

  // The chip click is the user gesture that surface mode's pointer-lock
  // request needs — same role the modal option click used to play.
  cameraModeSeg?.querySelectorAll('.grain-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => applyCameraMode(btn.dataset.mode));
  });
  S._setCameraMode = applyCameraMode;
  updateCameraModeBtn();

  // If surface mode was persisted, reset camera and show re-enter overlay
  // (pointer lock can't be requested without a user gesture on page load)
  if (S.cameraMode === 'surface') {
    S.camQ = [0, 0, 0, 1];
    S._showSurfaceOverlay?.();
  }

  // ── Spatial panning (in audio settings output section) ────────────────────
  const spatialPanningSel  = document.getElementById('asSpatialPanningSel');
  const spatialPanningNote = document.getElementById('asSpatialPanningNote');

  function updateSpatialPanningUI() {
    if (spatialPanningSel) spatialPanningSel.value = S.spatialPanning;
    if (spatialPanningNote) {
      spatialPanningNote.textContent = S.spatialPanning === 'worldlocked'
        ? 'sounds fixed in room' : 'sound rotates with camera';
    }
  }

  function applySpatialPanning(mode) {
    S.spatialPanning = mode;
    updateSpatialPanningUI();
    DEBUG && console.log(`[spatial] panning: ${S.spatialPanning}`);
  }

  if (spatialPanningSel) {
    spatialPanningSel.addEventListener('change', () => {
      applySpatialPanning(spatialPanningSel.value);
    });
  }
  S._setSpatialPanning = applySpatialPanning;
  updateSpatialPanningUI();

  // Re-size after first layout pass in case dimensions weren't settled yet
  requestAnimationFrame(() => {
    resizeCanvas();
    drawPresetWaveform();
    updatePlaybackControls();
    buildSvTabs();
    drawSvWaveform();
    animate();
    startMainMetering();  // start DOM-based VU meter loop for main window
    initGateMeter();    // wire noise gate visual meter (canvas + drag)
    initScanToggle(); // wire scan (cursor spotlight) on/off toggle
    initMorphToggle(); // wire radial morph on/off toggle
    initRadiusFade();      // wire radius fade toggle + curve slider
    initSeqMode();         // wire sequential (loop) mode toggle
    initMixdownGains();    // wire mixdown source gain sliders
    initDryMonitorGains(); // wire dry monitor gain slider + enable checkbox
    initAudioPanel();      // wire main-UI audio panel — mirrors modal controls
  });

  // Redraw waveforms when their containers resize (e.g. window resize or flex relayout)
  const svDisplayEl = document.getElementById('svDisplay');
  if (svDisplayEl) new ResizeObserver(() => drawSvWaveform()).observe(svDisplayEl);

  const envelopeWaveformWrap = document.querySelector('.envelope-waveform-wrap');
  if (envelopeWaveformWrap) new ResizeObserver(() => drawPresetWaveform()).observe(envelopeWaveformWrap);

  // Quad bus init — Electron only, no-op in the browser
  if (window.electronBridge?.isElectron) {
    initQuadBuses()
      .then(async () => {
        // Use saved output device if available, otherwise system default.
        const devices = await window.electronBridge.getAudioDevices();
        const savedId = S._savedOutputDeviceId;  // set by loadAudioDefaults
        const saved   = savedId != null ? devices.find(d => d.id === savedId) : null;
        const best    = saved || devices.find(d => d.isDefault) || devices[0];
        if (best) {
          const nCh = Math.min(32, best.outputChannels);  // Web Audio merger caps at 32
          await initSpeakerBuses(nCh);
          const bufFrames = S.preferredBufferSize ?? 1024;
          const result = await window.electronBridge.setAudioDevice(best.id, nCh, bufFrames, S.audioCtx?.sampleRate);
          const tag = saved ? 'saved' : 'system default';
          DEBUG && console.log(`Output: "${best.name}" (${tag}) — ${nCh} ch — streaming: ${result.streaming}`);
        } else {
          console.warn('No output devices found. Open Audio Settings to select one.');
        }

        // Auto-open saved input device and wire the full Web Audio chain
        if (window.electronBridge.setInputDevice && S._savedInputDeviceId != null) {
          const inDevices = await window.electronBridge.getInputDevices();
          const inDev     = inDevices.find(d => d.id === S._savedInputDeviceId);
          if (inDev) {
            const bufFrames = S.preferredBufferSize ?? 1024;
            const result = await window.electronBridge.setInputDevice(inDev.id, inDev.inputChannels, bufFrames, S.audioCtx?.sampleRate);
            if (result.ok) {
              DEBUG && console.log(`Input: "${inDev.name}" (saved) — ${result.nCh} ch`);
              // Wire up the worklet, analysers, and recording chain so the
              // input is fully active — not just open at the hardware level.
              await activateSavedInputDevice(result.nCh);
            }
          }
        }
      })
      .catch(e => console.warn('Quad bus init failed:', e));
  }

  // ── Sensor group — dim when no sensor connected ─────────────────────────
  // Reacts to OSC bridge status AND imu-setup device status (serial, WiFi, OSC).
  // Any connected device = "sensor connected" in the top bar.
  const _sensorGroupEl  = document.getElementById('sensorGroup');
  const _sensorStatusEl = document.getElementById('sensorGroupStatus');
  if (_sensorGroupEl) {
    let _oscBridgeUp   = false;
    let _sensorDetail  = null;   // latest sensor-status event detail

    const _updateSensorGroup = () => {
      const hasDevice = _sensorDetail?.connected || false;
      const anyUp     = _oscBridgeUp || hasDevice;
      _sensorGroupEl.classList.toggle('no-sensor', !anyUp);

      // Build status text for the label  e.g. "(serial)" or "(wifi + osc · 3)"
      if (_sensorStatusEl) {
        if (!anyUp) {
          _sensorStatusEl.textContent = '';   // CSS ::before handles "(not connected)"
        } else {
          const parts = [];
          // Label the bridge as "osc" rather than "max" — the same WebSocket
          // /UDP relay now carries traffic from any peer (Max, joycon GUI,
          // foot pedal via MIDI→OSC, etc.), so "max" was misleading when the
          // only live sender was the joycon GUI.
          if (_oscBridgeUp) parts.push('osc');
          if (_sensorDetail?.transports) {
            for (const t of _sensorDetail.transports) {
              if (!parts.includes(t)) parts.push(t);
            }
          }
          const label = parts.join(' + ');
          // Count only real sensors. Used to add +1 for _oscBridgeUp on the
          // assumption that the bridge was fronting a Max patch sending
          // /sensor/*, but the bridge now carries any OSC peer — the joycon
          // GUI holds it open with zero sensor traffic — so a bridge-up on
          // its own shouldn't inflate the count.
          const count = (_sensorDetail?.count || 0);
          _sensorStatusEl.textContent =
            count > 1 ? `(${label} · ${count})` : `(${label})`;
        }
      }
    };

    window.addEventListener('osc-connected',    () => { _oscBridgeUp = true;  _updateSensorGroup(); });
    window.addEventListener('osc-disconnected', () => { _oscBridgeUp = false; _updateSensorGroup(); });
    window.addEventListener('sensor-status', (e) => {
      _sensorDetail = e.detail;
      window._sensorConnected = e.detail?.connected;
      _updateSensorGroup();
      _rebuildSwitchBtns(e.detail);
    });

    // ── Quick-switch sensor buttons ──────────────────────────────────────
    // One button per connected+feeding sensor. Click = assign as cursor.
    const _switchBtnsEl = document.getElementById('sensorSwitchBtns');
    const _rebuildSwitchBtns = (detail) => {
      if (!_switchBtnsEl) return;
      const devices = detail?.devices;
      if (!devices || devices.length === 0) {
        _switchBtnsEl.innerHTML = '';
        return;
      }
      // Only show buttons for feeding devices (connected to sphere)
      const feedingDevs = devices.filter(d => d.feeding);
      if (feedingDevs.length < 1) {
        // No feeding sensors — nothing to show
        _switchBtnsEl.innerHTML = '';
        return;
      }
      // Build one button per feeding device
      // Use short label: device name, or number if names are identical
      const names = feedingDevs.map(d => d.name);
      const allSameName = names.every(n => n === names[0]);
      _switchBtnsEl.innerHTML = '';
      feedingDevs.forEach((d, i) => {
        const btn = document.createElement('button');
        btn.className = 'sensor-switch-btn';
        if (d.role === 'cursor') btn.classList.add('active');
        const label = allSameName
          ? `${i + 1}`
          : d.name.replace(/^x-IMU3\s*/i, '').trim() || `${i + 1}`;
        btn.textContent = label;
        btn.title = `${d.name} (${d.sn}) — click to make cursor`;
        btn.addEventListener('click', () => {
          assignQuatRole(d.slotName, 'cursor');
        });
        _switchBtnsEl.appendChild(btn);
      });
    };
  }

  // ── First-run hint ──────────────────────────────────────────────────────
  // Dismisses when the user loads a sample or enables mic input.
  const _firstRunEl = document.getElementById('firstRunHint');
  if (_firstRunEl) {
    // Skip hint if user already has samples loaded or has turned off learn mode
    const _learnOff = (() => { try { return localStorage.getItem('mubone-learn-mode') === 'off'; } catch (_) { return false; } })();
    if (S.sampleBuffers?.some(b => b) || _learnOff) {
      _firstRunEl.classList.add('hidden', 'gone');
    } else {
      S._dismissFirstRun = () => {
        if (!S._dismissFirstRun) return; // already dismissed
        _firstRunEl.classList.add('hidden');
        _firstRunEl.addEventListener('transitionend', () => _firstRunEl.classList.add('gone'), { once: true });
        window.removeEventListener('keydown', _frKeyHandler);
        S._dismissFirstRun = null;
      };
      const _frKeyHandler = (e) => {
        if ((e.key === 'Enter' || e.key === 'Escape') && S._dismissFirstRun) {
          S._dismissFirstRun();
        }
      };
      window.addEventListener('keydown', _frKeyHandler);
    }
  }

  // ── Gesture modules ──────────────────────────────────────────────────────
  import('./gesture.js')
    .then(({ initGesture }) => initGesture())
    .catch(e => console.warn('[gesture] failed to load:', e));
  import('./gesture-panel.js')
    .then(({ initGesturePanel, toggleGesturePanel }) => {
      initGesturePanel();
      // Wire the top-bar gesture button
      const gestureBtn = document.getElementById('gestureBtn');
      if (gestureBtn) gestureBtn.addEventListener('click', () => toggleGesturePanel());
      // Shift+G keyboard shortcut
      window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'G' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          toggleGesturePanel();
        }
      });
    })
    .catch(e => console.warn('[gesture-panel] failed to load:', e));

  // ── Worklet restart on output device change ────────────────────────────
  // When the user switches output devices (different channel count), the
  // AudioWorkletNode must be recreated — outputChannelCount is fixed at
  // creation time.  _onVBAPRebuilt in the bridge detects the mismatch and
  // calls this to stop + restart with the new channel count.
  S._restartWorkletEngine = _restartWorkletEngine;
  S._reloadWorkletEngine  = _reloadWorkletEngine;

  // ── Worklet grain engine: auto-start on sample paint ────────────────────
  // When the user starts painting with a sample (QWERTYUIOP keys or MIDI)
  // before any mic recording, the worklet hasn't been cold-started yet.
  // This callback bootstraps the worklet using the sample's AudioBuffer.
  S._ensureWorkletForSample = async (sampleBuffer) => {
    if (isWorkletGrainActive()) return;  // already running
    if (!S.audioCtx || !sampleBuffer) return;
    console.log('worklet: sample paint triggered — cold-starting worklet with sample buffer');
    await _startWorkletEngine(sampleBuffer);
  };

  // ── Worklet grain engine: auto-start on first recording ─────────────────
  // Cold-start on recording START (not completion) so grains from the very
  // first recording can play while painting.  Uses a tiny silent buffer as
  // the initial SAB, then immediately begins provisional live streaming.
  S._onRecordingStart = async () => {
    if (isWorkletGrainActive()) return;  // already running — provisional streaming handles it
    if (!S.audioCtx) return;
    // Create a minimal silent buffer to bootstrap the worklet.
    // The provisional live buffer will provide the actual audio.
    const silentBuf = S.audioCtx.createBuffer(1, 128, S.audioCtx.sampleRate);
    console.log('worklet: first recording started — cold-starting worklet');
    const ok = await _startWorkletEngine(silentBuf);
    if (ok) {
      // Now that the worklet is running, begin provisional streaming for
      // the recording that's already in progress.
      S._beginProvisionalRecording?.();
    }
  };

  // On recording completion: hot-swap the finished buffer into the worklet.
  S._onRecordingComplete = async (audioBuffer, _bufIdx) => {
    if (isWorkletGrainActive()) {
      console.log(`worklet: new recording (${audioBuffer.duration.toFixed(1)}s) — hot-swapping into running worklet`);
      hotSwapRecording(audioBuffer);
    } else {
      console.log(`worklet: new recording (${audioBuffer.duration.toFixed(1)}s) — starting worklet`);
      await _startWorkletEngine(audioBuffer);
    }
  };

  // Console API for manual worklet control.  Type `wg.status()` in DevTools
  // for a summary; `wg.start()`, `wg.stop()`, `wg.set({params})` for control.
  window.wg = {
    start: async (opts = {}) => {
      const buffers = S.liveRecBuffers?.filter(b => b?.buffer) ?? [];
      if (!buffers.length) {
        console.warn('wg: no recordings — record something first');
        return;
      }
      await _startWorkletEngine(buffers[buffers.length - 1].buffer, opts);
    },
    stop: () => { _stopWorkletEngine(); console.log('wg: stopped'); },
    waveform: (bufIdx) => showWaveformOverlay(bufIdx),
    set: (params) => { updateWorkletParams(params); console.log('wg: params updated', params); },
    stress: (grains = 100) => {
      const period = 0.001;
      const duration = grains * period;
      updateWorkletParams({ period, duration, volume: 0.3 });
      console.log(`wg: stress test — period=${period*1000}ms, duration=${duration*1000}ms, target overlap=${grains}`);
    },
    status: () => {
      console.log('wg: cross-origin isolated:', isCrossOriginIsolated());
      console.log('wg: SharedArrayBuffer available:', typeof SharedArrayBuffer !== 'undefined');
      console.log('wg: recordings:', S.liveRecBuffers?.filter(b => b?.buffer)?.length ?? 0);
      console.log('wg: 256-slot pool, pitch shift, jitter, VBAP, feedback ring, per-seed onset clocks');
    },
    diag: () => getWorkletDiag(),
  };

  // ── Staging engine (posture-snapshot macros) ──────────────────────────────
  // Loads persisted snapshots + mapping preset from localStorage; does not
  // auto-start the tick loop — user enables via the in-modal start button.
  // The UI binds the button, engine toggle, and live-readout plumbing.
  import('./snapshot-engine.js')
    .then(({ initSnapshotEngine }) => initSnapshotEngine({ autoStart: false }))
    .catch(e => console.warn('[staging] snapshot-engine failed to load:', e));
  // OSC stream-out — pumps /delta + /sensor/<name> to an external host (Max,
  // SuperCollider, etc.) so mapping logic can live there.  Will auto-restart
  // if it was running last session.
  import('./osc-stream.js')
    .then(({ initOSCStream }) => initOSCStream())
    .catch(e => console.warn('[staging] osc-stream failed to load:', e));
  import('./ui-staging.js')
    .then(({ initStagingUI }) => initStagingUI())
    .catch(e => console.warn('[staging] ui failed to load:', e));

  // Grain scheduler — independent of render loop so slow frames don't delay grains.
  // Interval set by GRAIN_SCHEDULER_INTERVAL_MS in state.js (default 30ms ≈ 33 ticks/sec).
  // Store interval ID so it can be cleared on teardown (e.g. page unload).
  S._grainSchedulerId = setInterval(scheduleGrains, GRAIN_SCHEDULER_INTERVAL_MS);

  // ── Global Escape key → close topmost modal ──────────────────────────────
  // All .mu-overlay modals and .factory-reset-overlay popups close on Escape.
  // ── Axis lock — independent azimuth / elevation toggles ─────────────────
  function _initAxisLockSeg(segId, stateKey, frozenKeys) {
    const seg = document.getElementById(segId);
    if (!seg) return;
    seg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const on = btn.dataset.val === 'on';
        S[stateKey] = on;
        // Clear frozen snapshots so next lock captures fresh position
        for (const k of frozenKeys) S[k] = null;
        seg.querySelectorAll('.grain-seg-btn').forEach(b =>
          b.classList.toggle('active', b === btn));
      });
    });
  }
  _initAxisLockSeg('axisLockAzSeg', 'axisLockAz',
    ['_axisLockFrozenNx', '_axisLockFrozenYaw']);
  _initAxisLockSeg('axisLockElSeg', 'axisLockEl',
    ['_axisLockFrozenNy', '_axisLockFrozenPitch']);
  // ── Commit slot config (unified cloud + loop pool) ──────────────────
  const commitSlotSelect = document.getElementById('commitSlotCountSelect')
                        || document.getElementById('seedSlotCountSelect');  // fallback to old ID
  if (commitSlotSelect) {
    commitSlotSelect.addEventListener('change', () => {
      S.commitSlotCount = parseInt(commitSlotSelect.value, 10);
      (S.updateSeedBanksUI || (() => {}))();
    });
  }
  const commitOverflowSeg = document.getElementById('commitOverflowSeg')
                          || document.getElementById('seedOverflowSeg');  // fallback to old ID
  if (commitOverflowSeg) {
    commitOverflowSeg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        S.commitOverflow = btn.dataset.overflow;
        commitOverflowSeg.querySelectorAll('.grain-seg-btn').forEach(b =>
          b.classList.toggle('active', b === btn));
        S._syncSeqButtonStates?.();
      });
    });
  }

  // ── Global backdrop click → close that modal ─────────────────────────────
  // Every .mu-overlay closes when its backdrop is clicked. Delegated and
  // generic so a new modal gets the behaviour for free — the LED and accessory
  // modals were both added without a backdrop handler and could only be
  // dismissed from the ✕ or Escape.
  //
  // Routes through the ✕ for the same reason the Escape handler does: several
  // modals hang cleanup off that button (metering, live-tick timers, row
  // highlight state), and removing `.open` directly would leak it.
  //
  // `e.target === overlay` means the click landed on the backdrop and not
  // inside .mu-dialog. The `.open` re-check keeps this a no-op for the modals
  // that already carry their own backdrop handler — those run first (their
  // listener is on the modal, this one bubbles to document) and have already
  // dropped the class by the time we look.
  document.addEventListener('click', (e) => {
    const overlay = e.target.closest?.('.mu-overlay');
    if (!overlay || e.target !== overlay || !overlay.classList.contains('open')) return;
    // Click the ✕ first, then make sure it actually took. Some modals wire
    // their ✕ lazily on first open (patch table), so a click can land on a
    // button with no listener yet — without the fallback the backdrop would
    // silently do nothing.
    overlay.querySelector('.close-btn')?.click();
    overlay.classList.remove('open');
  });

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    // Reset / export / import overlays (dynamic, highest z-index)
    const dialogOverlay = document.querySelector('.factory-reset-overlay');
    if (dialogOverlay) { dialogOverlay.remove(); return; }

    // Static .mu-overlay modals — close the last open one
    const openModals = document.querySelectorAll('.mu-overlay.open');
    if (openModals.length > 0) {
      const top = openModals[openModals.length - 1];
      // Click close button to trigger any cleanup (e.g. audio metering stop)
      const closeBtn = top.querySelector('.close-btn');
      if (closeBtn) closeBtn.click();
      else top.classList.remove('open');
    }
  });
}

init();
