// ============================================================================
// MAIN — entry point: wire up all modules and start the app
// ============================================================================

import { S, DEBUG, GRAIN_SCHEDULER_INTERVAL_MS, AXIS_SOURCES, axisHeld } from './state.js';
import { filterTypeOf } from './brush-voicing.js';
import { scheduleGrains } from './grain.js';
import { makeTake } from './take.js';
import { setupEvents, setupDragDrop } from './events.js';
import { rebuildSampleListUI, initUndoBtn } from './ui-samples.js';
import {
  setupPresets, initGrainControls, updatePlaybackControls,
} from './ui-presets.js';
import { setupMappingModal, initMidi } from './midi.js';
import { initAccessory } from './accessory-registry.js';
import { initMobileMode } from './mobile.js';
import { initQuadBuses, initSpeakerBuses, requestMicAccess } from './audio.js';
import { resizeCanvas, animate, applyAxisSources, cameraFromPointing } from './renderer.js';
import { startMainMetering, rebuildMainOutputMeters, initScanToggle, initRadiusFade, initSeqMode, initMixdownGains, initDryMonitorGains, initAudioPanel, setScanMuted, initGateMeter } from './ui-meters.js';
import { initSensor, getSensorCamQ, getSensorCursorQ, getFrameQ, getCameraQ, assignQuatRole, getRegistry as getSensorRegistry } from './sensor-registry.js';
import { initOSC, _bridgeReachable } from './osc.js';
import { initStatusPublisher } from './status-publisher.js';
import { initXimuLedFeedback } from './ximu-led-feedback.js';
import { initLedMapUI } from './ui-led-map.js';
import { initAudioSettings, loadAudioDefaults, activateSavedInputDevice, noteActiveOutputDevice, startAutoSave, resolveAudioDevice } from './ui-audio-settings.js';

import { initPinSettings } from './ui-pin-settings.js';
import { initTriggerUI } from './ui-trigger.js';
import { initVizUI } from './ui-viz.js';
import { initSessionPanel } from './ui-sweep.js';
import { initEraseUI } from './erase.js';
import './brush.js';   // registers S._currentBrush and the main button (S._gesturePress …)
import './sampler.js'; // registers S._samplerSelectSource / _samplerTrace / capture (#247)
import { initSourceTiles } from './ui-source.js';   // the source tiles (#247)
import { initSettings, openSettings } from './ui-settings.js';   // the one settings door (#255)
import { initTileLayout } from './tile-layout.js';
import { initExportImport } from './ui-export.js';
import { initIMUSetupUI } from './ui-imu-setup.js';
import { initSygaldryUI } from './ui-sygaldry.js';
import { initDiagnostics } from './ui-diagnostics.js';
import { initDiag } from './diag.js';
import { initButtonsPage } from './ui-buttons.js';
import { qMul, qNormalize, qFromAxisAngle, qRotateVec } from './sphere.js';
import { startPaintTicker, getPaintTickerState } from './paint-ticker.js';
// Trigger tool. Imported for its side effect of registering the gate and the
// arm/disarm entry points on S — grain.js and midi.js reach it through those
// rather than importing it, which is what keeps the import graph acyclic.
import './trigger.js';
import { refreshLatency } from './latency.js';
import './composer.js';
import { CATEGORIES, keysFor, unregisteredKeys, purgeRetiredKeys } from './storage-registry.js';
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
    startJitter:      opts.startJitter      ?? ov.startJitter      ?? base.startJitter      ?? 0,
    fadeRatio:        opts.fadeRatio        ?? ov.fadeRatio        ?? base.fadeRatio        ?? 0.5,
    fadeMode:         (opts.fadeMode ?? ov.fadeMode ?? base.fadeMode) === 'ms' ? 1 : 0,
    fadeMs:           opts.fadeMs          ?? ov.fadeMs          ?? base.fadeMs          ?? 0.020,
    envShape:         opts.envShape         ?? CURVE_MAP[S.grainCurveType] ?? 0,
    probability:      opts.probability      ?? S.grainProbability ?? 1.0,
    direction:        opts.direction        ?? DIR_MAP[S.grainDirection] ?? 0,
    filterType:       opts.filterType       ?? filterTypeOf(ov, base),
    cutoff:           opts.cutoff           ?? ov.cutoff           ?? base.cutoff           ?? 1000,
    res:              opts.res              ?? ov.res              ?? base.res              ?? 0,
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
  // ── A NEW BUILD WIPES THE DEMO (Ek, 2026-09-12, night) ───────────────────
  // "my collaborators know that this is a prototype, they should expect
  // nothing is kept, so wipe is silent." On the HOSTED origin only — Electron
  // and localhost keep their settings — the app reads the deployed service
  // worker's CACHE_VERSION (one no-store fetch; it is the key Ek already has
  // to bump for a browser deploy to reach anyone at all, so "a new build" and
  // "a new cache version" are one event) and compares it to the stamp it
  // wrote last time. Different: the same wipe as Reset all — every key, the
  // offline cache, the service worker — then the new stamp and a reload.
  // A store with no stamp is fresh (or just reset) and needs no wipe.
  _wipeOnNewBuild();

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
    // Fill the OSC Input row's port (it named Max's [udpsend] until 2026-09-25;
    // any sender will do, so it names none)…
    for (const s of document.querySelectorAll('.js-osc-port')) {
      s.textContent = String(_oscPort ?? 7500);
    }
    // …and which station this window is.
    // Browser mode has no UDP listener at all — OSC arrives over the WebSocket
    // bridge (proxy.js) on 8080, so quoting a UDP port here would send people
    // to a socket nothing is listening on.
    const st = document.getElementById('oscStationInline');
    if (st) {
      // Reworded 2026-09-14 when this moved out of the description and into the
      // row's status line: it used to complete "This station is …", so alone it
      // read as a fragment. The other two values already stood on their own.
      // It still has to OUTRANK the description's UDP line, which is the
      // Electron path — prose is the general case, the live value is this build.
      st.textContent = !_isElectron
        ? 'browser — OSC arrives on ws://localhost:8080, not UDP'
        : _instName
          ? `station ${_instName} (port ${_oscPort ?? '?'})`
          : `solo (port ${_oscPort ?? 7500})`;
    }
  }

  S.canvas = document.getElementById('sphereCanvas');
  S.ctx    = S.canvas.getContext('2d');

  resizeCanvas();
  setupEvents();
  setupDragDrop();
  purgeRetiredKeys();    // one-shot: keys of sunset features (the patch bank, locks, cloud morph)
  loadAudioDefaults();   // restore saved settings before any UI init
  rebuildSampleListUI();
  S.updateLiveRecUI?.();
  setupPresets();
  initGrainControls();
  setupMappingModal();
  initMidi();
  // Accessory must init after setupMappingModal — it binds against the ACTIONS
  // registry that publishes S._actions / S._dispatchAction.
  initAccessory();   // the DATA layer stays: ui-export's setup file carries it.
  // initAccessoryUI() SUNSET 2026-08-28 (#269) — the table/modal is in
  // sandbox/sunset-2026-08-28/ui-accessory.js.
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
  // (Recenter — a drift-offset quaternion composed onto the sensor — was
  // deleted 2026-09-05 (#170, #76): no caller since 2026-08-01, and the drift
  // there is, in yaw, is what zero heading corrects.)

  // ── IMU-driven cursor freshness ──────────────────────────────────────────
  // On every cursor-role quaternion arrival (up to 400Hz), update S.cursorQ
  // so the paint ticker's 200Hz poll reads a fresh position.
  S._onCursorQuatArrival = () => {
    if (S.cameraMode !== 'sensor') return;

    // Same transforms as the render loop: drift correction + axis locks.
    // Idempotent — the render loop will overwrite at 30fps for visuals.
    const cq = getSensorCursorQ();   // non-null in detethered two-IMU mode
    const sq = getSensorCamQ();      // non-null in single-IMU mode

    // ONE owner of the axis-hold rule, imported from the renderer. This used to
    // be a second copy that checked only azSource and elSource — so every
    // sensor packet (up to 400 Hz) overwrote S.camQ with an un-gated
    // quaternion, undoing the renderer's 30 fps result. Roll lock therefore
    // never worked, through several rewrites of the thing it was blamed on
    // (Ek, 2026-08-31). A rule with two implementations has one that is wrong.
    if (cq) {
      S.cursorQ = applyAxisSources(cq);
    } else if (sq) {
      const q = sq;
      // Single-IMU: cursor gets the pointing, camera is derived — the same
      // two writes the render loop makes, so the 400 Hz path and the 30 fps
      // path can never disagree about either quat.
      const pq = applyAxisSources(q);
      S.cursorQ = pq;
      S.camQ = cameraFromPointing(pq);
    }
  };

  // Paint ticker: single 200Hz timer polls cursor position and deposits
  // particles via adaptive angular spacing. Works identically for all modes.
  startPaintTicker();
  // The latency model needs the audio context and, in Electron, the streams;
  // both exist by now, and the device pages refresh it again on Apply.
  setTimeout(() => refreshLatency(), 1500);
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

  initIMUSetupUI();
  initSygaldryUI();
  initDiagnostics();
  // The crash log, ⇧D and the console helpers (window.dlog, window.diagReport).
  // diag.js has exported initDiag since March 2026 and nothing has ever called
  // it: a March audit listed "diag.js Not Imported Anywhere" and the audit file
  // was deleted without the fix. Only the Settings → Diagnostics button reached
  // any of it.
  initDiag();
  initButtonsPage();
  initAudioSettings();
  initPinSettings();
  initTriggerUI();
  initVizUI();
  initSessionPanel();
  initEraseUI();
  initTileLayout();
  initSourceTiles();
  initSettings();
  initUndoBtn();
  initExportImport();
  startAutoSave();       // begin 2s dirty-check auto-persist for settings

  // ── Collapsible panels, panel order, panel drag: SUNSET (#291) ──────────
  // Collapsing a .device by its label, dragging tiles between columns and the
  // saved panel order all belonged to the rig VIEW, which is no longer a
  // screen — .right-panel is a hidden cabinet of controls the engine pages and
  // the settings shell write through. Dragging is at
  // sandbox/sunset-2026-08-29/panel-drag.js.
  //
  // Its stale keys are RETIRED_KEYS / RETIRED_PREFIXES (storage-registry.js,
  // purged at boot). One of them could bite: a `.device.collapsed` class hides
  // `.device-body`, and the commits device is BORROWED whole by Settings → pins
  // (#262) — so a device someone collapsed in the rig view would show up as an
  // empty settings page with nothing to explain it.
  for (const d of document.querySelectorAll('.device.collapsed')) d.classList.remove('collapsed');

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
  // export's STATIC_KEYS — docs/archive/EXPORT-IMPORT-AUDIT-2026-07.md). Per-category
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
  async function _wipeOnNewBuild() {
    if (window.electronBridge || _bridgeReachable()) return;
    let version = null;
    try {
      const txt = await (await fetch('./sw.js', { cache: 'no-store' })).text();
      version = /CACHE_VERSION\s*=\s*'([^']+)'/.exec(txt)?.[1] ?? null;
    } catch (_) {}
    if (!version) return;
    let stamp = null;
    try { stamp = localStorage.getItem('mubone_build'); } catch (_) {}
    if (stamp === version) return;
    if (stamp === null) { try { localStorage.setItem('mubone_build', version); } catch (_) {} return; }
    console.log(`[build] ${stamp} → ${version}: the demo starts from factory`);
    try { localStorage.clear(); localStorage.setItem('mubone_build', version); } catch (_) {}
    await Promise.race([_clearOfflineCache(), new Promise(r => setTimeout(r, 1500))]);
    location.reload();
  }

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

  // ── RESET, ON THE SETTINGS PAGE (Ek, 2026-09-12, night) ──────────────────
  // "instead of a pop up, build it into the settings page … one button that
  // will reset all plus another button reset selected." The popup with its
  // checkbox list is gone; the session page carries two rows of the kit
  // (SETTINGS-GUI § 2–3): Reset all, a danger button armed by one click and
  // fired by the next (the arm is the confirmation — it wears the second
  // click's words for four seconds, then stands down), and one row per
  // storage category with the kit's toggle, then Reset selected, live only
  // while a toggle is on. The cabinet's `#resetBtn` went with the popup: the
  // page owns the state now, and nothing else pointed at it.
  function initResetSection() {
    const allBtn = document.getElementById('resetAllBtn');
    const selBtn = document.getElementById('resetSelectedBtn');
    const cats   = document.getElementById('resetCats');
    const desc   = document.getElementById('resetSelectedDesc');
    const orph   = document.getElementById('resetOrphans');
    if (!allBtn || !selBtn || !cats) return;
    // A row title is Title Case, every word (SETTINGS-GUI § 5, 2026-09-14);
    // the hint is the row's one-sentence description and stays prose.
    const sentence = t => t.charAt(0).toUpperCase() + t.slice(1).replace(/\.?$/, '.');
    const title = t => t.replace(/\b[a-z]/g, ch => ch.toUpperCase());
    cats.innerHTML = CATEGORIES.map(c => `
      <div class="set-row">
        <div class="set-row-text">
          <span class="set-row-title">${title(c.label)}</span>
          <span class="set-row-desc">${sentence(c.hint)}</span>
        </div>
        <div class="set-ctl"><input type="checkbox" class="set-toggle" data-cat="${c.id}" aria-label="reset ${c.label}"></div>
      </div>`).join('');
    const boxes = [...cats.querySelectorAll('input[data-cat]')];
    const sync = () => {
      const on = boxes.filter(b => b.checked);
      selBtn.disabled = on.length === 0;
      desc.textContent = on.length === 0 ? 'Nothing selected.'
        : `${on.length} of ${boxes.length} selected: ${on.map(b => CATEGORIES.find(c => c.id === b.dataset.cat)?.label).join(', ')}.`;
    };
    boxes.forEach(b => b.addEventListener('change', sync));
    sync();
    // Surface drift rather than hiding it: a key in localStorage that the
    // registry does not know is cleared by Reset all alone.
    const orphans = unregisteredKeys();
    if (orph && orphans.length) {
      orph.hidden = false;
      orph.textContent = `${orphans.length} stored key(s) are not in the registry (${orphans.join(', ')}) — only Reset all clears them. They should be added to js/storage-registry.js.`;
    }

    let armTimer = null;
    const disarm = () => { clearTimeout(armTimer); armTimer = null; allBtn.textContent = 'Reset all'; allBtn.classList.remove('armed'); };
    allBtn.addEventListener('click', async () => {
      if (armTimer === null) {
        allBtn.textContent = 'Click again to reset all';
        allBtn.classList.add('armed');
        armTimer = setTimeout(disarm, 4000);
        // And stand down when you leave it: an armed danger button that keeps
        // its charge while you are somewhere else is a trap you walk back into.
        allBtn.addEventListener('blur', disarm, { once: true });
        return;
      }
      disarm();
      allBtn.disabled = true; selBtn.disabled = true;
      allBtn.textContent = 'Resetting…';
      // clear() rather than the key list, so anything unregistered goes too.
      // This is the one path where being exhaustive beats being precise.
      localStorage.clear();
      console.log('[reset] cleared: everything');
      // Cache teardown is async, browser-only (no-op in Electron). Race it
      // against a timeout — a hang before location.reload() would leave the
      // app half-wiped, which is worse than an uncleared cache.
      await Promise.race([_clearOfflineCache(), new Promise(r => setTimeout(r, 1500))]);
      location.reload();
    });
    selBtn.addEventListener('click', () => {
      const chosen = boxes.filter(b => b.checked).map(b => b.dataset.cat);
      if (!chosen.length) return;
      selBtn.disabled = true; allBtn.disabled = true;
      selBtn.textContent = 'Resetting…';
      for (const k of keysFor(chosen)) { try { localStorage.removeItem(k); } catch (_) {} }
      console.log(`[reset] cleared: ${chosen.join(', ')}`);
      location.reload();
    });
  }
  initResetSection();

  // When speaker buses are (re)initialised, rebuild the main-window output meters.
  // Using a callback on S avoids a circular import between audio.js and ui-meters.js.
  // S._rebuildMainOutputMeters is also set inside startMainMetering() for the renderer shim.
  S._onSpeakerBusesReady = () => rebuildMainOutputMeters();

  // The sample-instrument MODAL is gone (#269): the sampler lives in the tool
  // rail's source group, and its library is the properties-rail sheet that
  // js/ui-source.js draws. ui-samples.js still owns the slot data, the
  // waveform drawing and preview playback — only the modal went.

  // ── Camera mode modal ──────────────────────────────────────────────────────
  // Camera mode: steer / surface / sensor (independent of audio spatialization)
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
          ? (S._rawCursorQ ? '\ncurrently: 2 sensors — cursor free, frame holds the view'
                           : '\ncurrently: 1 sensor — camera follows it, held level past ±70°')
          : (S._sensorLive?.() ? '' : '\nno sensor connected — the pill stays where it is until one speaks');
        btn.setAttribute('data-title', _camTips.get(btn) + state);
      }
    });
  }

  // A sensor is CONNECTED when one has spoken in the last few seconds — the
  // registry stamps every quaternion.
  const SENSOR_LIVE_MS = 3000;
  // The registry is a Map: `Object.values(map)` is always `[]`, so this said
  // "no sensor" with one streaming, and the pill could never be put on SENSOR
  // by a click or by OSC — only a persisted mode restored at boot got there
  // (found on the 2026-09-16 long run, where the driver's switch was refused).
  const sensorLive = () => [...(getSensorRegistry()?.values() || [])].some(sl => sl && Date.now() - (sl.lastSeenQuat || 0) < SENSOR_LIVE_MS);
  S._sensorLive = sensorLive;

  function applyCameraMode(mode) {
    // The pill is never on SENSOR without a sensor (Ek, 2026-09-12): a click
    // there with nothing connected stays where it is and the chip says why.
    if (mode === 'sensor' && !sensorLive()) {
      console.info('[camera] sensor mode refused — no sensor connected');
      updateCameraModeBtn();
      return;
    }
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
    } else if (mode === 'sensor') {
      // Exit pointer lock + overlay if leaving surface mode
      S._exitSurfaceLock?.();
      S._hideSurfaceOverlay?.();
      // The cursor is set below — see _syncStageCursor in events.js.
    } else {
      // Exit pointer lock + overlay if leaving surface mode
      S._exitSurfaceLock?.();
      S._hideSurfaceOverlay?.();
      // The cursor is set below — see _syncStageCursor in events.js.
    }

    // A mode change is an EDGE for cursor lock's pointer half, which is steer
    // and surface only. Lock in surface, switch to sensor, and without this
    // S.altLocked stays true — so grain.js and renderer.js keep reading the
    // cursor from a frozen mouse pixel instead of from the sensor. Runs after
    // the branches above because it has the final say on the canvas cursor.
    // Order matters: the stage cursor follows the MODE, and the lock overrides
    // it — so the lock's edge runs last and has the final say.
    S._syncStageCursor?.();
    S._applyCursorLockPointer?.(S._cursorLocked?.());

    DEBUG && console.log(`[camera] mode: ${S.cameraMode}`);
  }

  // The chip click is the user gesture that surface mode's pointer-lock
  // request needs — same role the modal option click used to play.
  cameraModeSeg?.querySelectorAll('.grain-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => applyCameraMode(btn.dataset.mode));
  });
  S._setCameraMode = applyCameraMode;
  updateCameraModeBtn();

  // A persisted SENSOR mode boots as steer — nothing has spoken yet at boot,
  // and the app is never on the sensor pill with no sensor (Ek, 2026-09-12).
  // The wish is kept: the first quaternion to arrive switches the camera to
  // the sensor, so a rig that opens before its x-imu3 still follows it.
  if (S.cameraMode === 'sensor') {
    S.cameraMode = 'steer';
    S._cameraModeDeferred = 'sensor';
    updateCameraModeBtn();
  }
  S._onSensorFirstQuat = () => {
    if (S._cameraModeDeferred !== 'sensor') return;
    S._cameraModeDeferred = null;
    if (S.cameraMode === 'steer') applyCameraMode('sensor');
  };
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
    updatePlaybackControls();
    animate();
    startMainMetering();  // start DOM-based VU meter loop for main window
    initGateMeter();    // wire paint gate visual meter (canvas + drag)
    initScanToggle(); // wire scan (cursor spotlight) on/off toggle
    initRadiusFade();      // wire radius fade toggle + curve slider
    initSeqMode();         // wire sequential (loop) mode toggle
    initMixdownGains();    // wire mixdown source gain sliders
    initDryMonitorGains(); // wire dry monitor gain slider + enable checkbox
    initAudioPanel();      // wire main-UI audio panel — mirrors modal controls
  });

  // Quad bus init — Electron only, no-op in the browser
  if (window.electronBridge?.isElectron) {
    initQuadBuses()
      .then(async () => {
        // Use saved output device if available, otherwise system default.
        // Matched by NAME, not id — ids are reassigned across reboots, and a
        // stale one can bind output to a virtual device with nothing behind it.
        const devices = await window.electronBridge.getAudioDevices();
        const best    = resolveAudioDevice(devices, S._savedOutputDeviceName, S._savedOutputDeviceId)
                     || devices[0];
        if (best) {
          const nCh = Math.min(32, best.outputChannels);  // Web Audio merger caps at 32
          await initSpeakerBuses(nCh);
          const bufFrames = S.preferredBufferSize ?? 1024;
          const result = await window.electronBridge.setAudioDevice(best.id, nCh, bufFrames, S.audioCtx?.sampleRate);
          if (result.streaming) noteActiveOutputDevice(best);
          const tag = best.name === S._savedOutputDeviceName ? 'saved'
                    : best.isDefault                          ? 'system default'
                    : 'fallback';
          DEBUG && console.log(`Output: "${best.name}" (${tag}) — ${nCh} ch — streaming: ${result.streaming}`);
        } else {
          console.warn('No output devices found. Open Audio Settings to select one.');
        }

        // Auto-open saved input device and wire the full Web Audio chain
        // Input gets the same resolution chain as output. It previously bailed
        // out entirely when nothing was saved, which left the app with no input
        // open at all after a reset — hence the empty "select input device".
        if (window.electronBridge.setInputDevice) {
          const inDevices = await window.electronBridge.getInputDevices();
          const inDev     = resolveAudioDevice(inDevices, S._savedInputDeviceName, S._savedInputDeviceId);
          if (inDev) {
            const bufFrames = S.preferredBufferSize ?? 1024;
            const result = await window.electronBridge.setInputDevice(inDev.id, inDev.inputChannels, bufFrames, S.audioCtx?.sampleRate);
            if (result.ok) {
              const inTag = inDev.name === S._savedInputDeviceName ? 'saved'
                          : inDev.isDefault                         ? 'system default'
                          : 'fallback';
              DEBUG && console.log(`Input: "${inDev.name}" (${inTag}) — ${result.nCh} ch`);
              // Wire up the worklet, analysers, and recording chain so the
              // input is fully active — not just open at the hardware level.
              await activateSavedInputDevice(result.nCh, inDev);
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
    // The whole block is the door to the sensor page (Ek, 2026-08-29). It reads
    // as a status readout, but "is the sensor there" is the question you ask
    // right before you go and do something about it, and the gear beside it was
    // the only way through — a caption and a status you cannot click, next to a
    // button that does what you wanted, is three controls where there is one
    // idea. The buttons inside it keep their own jobs: the guard below is what
    // stops a click on the gear from also opening the page behind it.
    _sensorGroupEl.addEventListener('click', e => {
      if (e.target.closest('button, a, input, select')) return;
      openSettings('sensors');
    });
    _sensorGroupEl.setAttribute('role', 'button');
    _sensorGroupEl.setAttribute('tabindex', '0');
    _sensorGroupEl.setAttribute('title', 'sensor status — click to open sensor settings');
    _sensorGroupEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target !== _sensorGroupEl) return;
        e.preventDefault(); openSettings('sensors');
      }
    });

    let _oscBridgeUp   = false;
    let _sensorDetail  = null;   // latest sensor-status event detail

    // The transport in one word, the player's word: 'serial' is the API's
    // name for a cable and 'udp' is the wire under wifi (R2).
    const _RIG_WORD = { serial: 'usb', cable: 'usb', udp: 'wifi', wifi: 'wifi', osc: 'osc' };
    let _rigWasUp = false;
    const _updateSensorGroup = () => {
      const hasDevice = _sensorDetail?.connected || false;
      const anyUp     = _oscBridgeUp || hasDevice;
      _sensorGroupEl.classList.toggle('no-sensor', !anyUp);

      // ── S.rig — the resolved sensor fact, published once (R10) ──────────
      // The chrome pill used to read #sensorGroupStatus.textContent out of
      // this hidden footer block and strip the brackets with a regex — a
      // picture of the fact. This object IS the fact; tile-layout reads it.
      if (anyUp) _rigWasUp = true;
      const cursorDev = _sensorDetail?.devices?.find(d => d.role === 'cursor' && d.feeding)
                     || _sensorDetail?.devices?.find(d => d.role === 'cursor');
      // Real sensor transports first; the OSC bridge is appended, not led
      // with — osc is the rare case, and it was winning the pill's slot by
      // being pushed first (Ek: "why does the sensor pill say OSC").
      const words = [];
      for (const t of _sensorDetail?.transports || []) {
        const w = _RIG_WORD[t] || t;
        if (!words.includes(w)) words.push(w);
      }
      if (_oscBridgeUp && !words.length) words.push('osc');
      S.rig = {
        up: anyUp,
        transports: words,
        count: _sensorDetail?.count || 0,
        // The slot shows the transport carrying the CURSOR; any transport is
        // the honest fallback when no cursor role is assigned yet.
        cursorVia: cursorDev
          ? (_RIG_WORD[cursorDev.via || cursorDev.transport] || cursorDev.transport)
          : (words[0] || null),
        found: _sensorDetail?.found || 0,
        lost: !anyUp && _rigWasUp,
      };

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

  // The first-run "get started" overlay is GONE (2026-08-30, Ek: "the get
  // started popup still comes up sometimes — sunset that"). It was retired in
  // #257 by an `if (false)` around its wiring, but the markup stayed in
  // index.html and was only hidden from HERE — which runs after first paint, so
  // on a cold start it painted for a frame or two and looked like it had come
  // back. Hiding a thing at runtime is not the same as not having it. The
  // markup, its CSS and `S._dismissFirstRun` are all deleted; its three steps
  // live in the tooltips of the controls they describe and in
  // docs/QUICK-START.md.

  // Gesture modules SUNSET 2026-08-28 (#269) — sandbox/sunset-2026-08-28/.
  // Nothing in the app consumed the gesture features; the panel was the only
  // reader. Kept, not deleted: the feature extraction is worth returning to.

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
    const silentBuf = makeTake(new Float32Array(128), S.audioCtx.sampleRate);
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
    set: (params) => { updateWorkletParams(params); console.log('wg: params updated', params); },
    stress: (grains = 100) => {
      const period = 0.001;
      const duration = grains * period;
      updateWorkletParams({ period, duration, volume: 0.3 });
      console.log(`wg: stress test — period=${period*1000}ms, duration=${duration*1000}ms, target overlap=${grains}`);
    },
    status: () => {
      // Arm the two loop-gap timers for the next half minute (P1): they cost
      // ~1 % of a core each and are off unless something is reading them, so
      // the first status after a quiet spell shows the gaps from the second
      // it takes the 1 Hz poll to fetch them.
      S._wantLoopGapsUntil = Date.now() + 30000;
      console.log('wg: cross-origin isolated:', isCrossOriginIsolated());
      console.log('wg: SharedArrayBuffer available:', typeof SharedArrayBuffer !== 'undefined');
      console.log('wg: recordings:', S.liveRecBuffers?.filter(b => b?.buffer)?.length ?? 0);
      console.log('wg: 256-slot pool, pitch shift, jitter, VBAP, feedback ring, per-seed onset clocks');
      // Transport faults since load — each one is a click somewhere. Pool
      // steals (a hard cut inside the engine) ride the worklet diag instead.
      const td = S.transportDiag;
      // The worklet's own figures ride getWorkletDiag().workletDiag — the
      // top level is the bridge's view (`steals` read the wrong level until
      // 2026-09-06 and always printed 0).
      const wd = getWorkletDiag()?.workletDiag || {};
      console.log(`wg: transport faults — input dry ${td.inDry}, input overflow ${td.inOverflow}, output dropped ${td.outDropped}, output dry ${td.outDry}, pool steals ${wd.steals ?? 0} (last second)`);
      // Where a hole came from (R6): the main process's event loop, or the
      // audio thread's own load. Both counted since load.
      // The audio host is the loop the hops live on (R2); its holders are
      // the longest synchronous run per handler and how often it passed
      // 10 ms. The main process is the browser thread, for the record.
      const holders = (list) => (list || []).map(([n, ms, c]) => `${n} ${ms} ms${c ? ` (${c}× over 10)` : ''}`).join(', ') || 'nothing over 2 ms';
      console.log(`wg: audio host — longest event-loop gap ${td.hostGapMaxMs} ms, gaps over 10 ms ${td.hostGaps10}, over 20 ms ${td.hostGaps20}, GC longest ${td.hostGcMaxMs} ms · holders — ${holders(td.hostSlow)}`);
      console.log(`wg: audio thread — load ${wd.loadPct ?? '?'}%, longest block ${wd.procMaxMs ?? '?'} ms, live chunks allocated ${wd.chunkAllocs ?? '?'} (last second)`);
      console.log(`wg: main process (browser thread) — longest gap ${td.mainGapMaxMs} ms, over 10 ms ${td.mainGaps10}, over 20 ms ${td.mainGaps20} · holders — ${holders(td.mainSlow)}`);
    },
    diag: () => getWorkletDiag(),
  };

  // ── Staging engine (posture-snapshot macros) ──────────────────────────────
  // Loads persisted snapshots + mapping preset from localStorage; does not
  // auto-start the tick loop — user enables via the in-modal start button.
  // The UI binds the button, engine toggle, and live-readout plumbing.
  // Staging SUNSET 2026-08-28 (#269) — snapshot-engine, osc-stream and the
  // staging UI are in sandbox/sunset-2026-08-28/. The OSC stream-out idea is
  // still wanted (TODO #122); it comes back as its own thing, not as staging.

  // Grain scheduler — independent of render loop so slow frames don't delay grains.
  // Interval set by GRAIN_SCHEDULER_INTERVAL_MS in state.js (10 ms, 100 ticks/s since 2026-09-06).
  // Store interval ID so it can be cleared on teardown (e.g. page unload).
  S._grainSchedulerId = setInterval(scheduleGrains, GRAIN_SCHEDULER_INTERVAL_MS);

  // ── Global Escape key → close topmost modal ──────────────────────────────
  // All .mu-overlay modals and .dlg-overlay popups close on Escape.
  // ── Axis lock — independent azimuth / elevation toggles ─────────────────
  // One table and one setter for both axes.  The segmented control, the patch
  // table row and the cycle action all write through setAxisSource(), so the
  // DOM can't drift from S — previously each of the three re-implemented the
  // active-class sync and they had to agree by hand.
  const AXIS_SOURCE_ROWS = {
    azSource: { segId: 'azSourceSeg', frozen: ['_axisLockFrozenNx', '_axisLockFrozenYaw'] },
    elSource: { segId: 'elSourceSeg', frozen: ['_axisLockFrozenNy', '_axisLockFrozenPitch'] },
    // (rollSource left this table 2026-09-01 with the RO button and _gateRoll:
    // the camera takes no roll, so the only reader was the mapping-input gate,
    // and Ek retired that too — a sensor binding reads roll live.)
  };

  function syncAxisSourceUI(stateKey) {
    for (const [key, row] of Object.entries(AXIS_SOURCE_ROWS)) {
      if (stateKey && key !== stateKey) continue;
      const seg = document.getElementById(row.segId);
      if (!seg) continue;
      seg.querySelectorAll('.grain-seg-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.val === S[key]));
    }
    // The footer's cycle buttons are not the segments — they are their own
    // control reading the same state (see index.html). One sync, both places.
    S._syncAxisCycles?.();
  }

  function setAxisSource(stateKey, src) {
    const row = AXIS_SOURCE_ROWS[stateKey];
    if (!row || !AXIS_SOURCES.includes(src)) return;
    S[stateKey] = src;
    // Drop the frozen snapshots so the next hold captures a fresh position
    // rather than resuming wherever the previous one left the cursor.
    for (const k of row.frozen) S[k] = null;
    syncAxisSourceUI(stateKey);
    // Cursor lock is DERIVED from the two axes, so it is re-read here rather
    // than set anywhere — see cursorLocked() below. Every route that changes an
    // axis already comes through this function (footer, cabinet segments, the
    // patch table's PARAM_REGISTRY setter and therefore preset load, MIDI, OSC,
    // and a binding landing on a cursor-axis row), which is what makes one line enough.
    S._applyCursorLockPointer?.(cursorLocked());
  }

  // ── Cursor lock is not a state of its own (2026-09-01) ──────────────────
  // It IS az and el both held (Ek: "i just want the option key to basically be
  // a shortcut to lock az and el, and if it's in steer and surface it also
  // frees the cursor").
  //
  // Before this, alt-lock froze the sphere by its OWN route — a `!S.altLocked`
  // test in the steer block, unrelated to the axis sources — so the same sphere
  // was held still by two mechanisms that could disagree, and did: with az
  // locked, moving the mouse off the canvas still resumed yaw auto-rotation.
  // That route is gone. S.altLocked now means one thing only, the POINTER half,
  // and events.js owns it.
  function cursorLocked() { return axisHeld(S.azSource) && axisHeld(S.elSource); }

  // What ⌥ put down, ⌥ picks back up. Releasing to 'sensor' unconditionally
  // would silently disarm a 'mapped' axis — nothing may put the cursor back
  // under sensor control mid-performance — so the previous value is stashed
  // and handed back.
  function setCursorLock(on) {
    if (on) {
      if (!cursorLocked()) S._cursorLockPrev = { azSource: S.azSource, elSource: S.elSource };
      setAxisSource('azSource', 'locked');
      setAxisSource('elSource', 'locked');
    } else {
      const prev = S._cursorLockPrev || {};
      for (const k of ['azSource', 'elSource']) {
        setAxisSource(k, prev[k] && prev[k] !== 'locked' ? prev[k] : 'sensor');
      }
      S._cursorLockPrev = null;
    }
  }

  for (const [stateKey, row] of Object.entries(AXIS_SOURCE_ROWS)) {
    const seg = document.getElementById(row.segId);
    if (!seg) continue;
    seg.querySelectorAll('.grain-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => setAxisSource(stateKey, btn.dataset.val));
    });
  }
  S._setAxisSource   = setAxisSource;
  S._cursorLocked    = cursorLocked;
  S._setCursorLock   = setCursorLock;
  S._toggleCursorLock = () => setCursorLock(!cursorLocked());
  syncAxisSourceUI();
  // The pin slot count is the pinned rail's (`#lyrSlotsMax`, ui-pins.js) and
  // the overflow seg is wired in ui-meters.js — a second binding here fired
  // every press twice (2026-09-16).

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
    const dialogOverlay = document.querySelector('.dlg-overlay');
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
