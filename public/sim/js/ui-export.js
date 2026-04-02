// ============================================================================
// UI — EXPORT / IMPORT (Settings + Session)
//
// Two export modes:
//   1. Settings — lightweight JSON of all localStorage keys (for sharing setups)
//   2. Session  — full state including samples, particles, seeds, sequences,
//                 and live buffers as embedded WAV audio (for installations /
//                 acousmatic performance — load and it's ready to play)
// ============================================================================

import { S, MAX_COMMITS, FACTORY_PRESET_START, loadUserPresets, saveUserPresets } from './state.js';
import { ensureAudioContext } from './audio.js';
import { stampCartesian } from './grain.js';
import { rebuildSampleListUI, buildSvTabs, drawSvWaveform } from './ui-samples.js';
import { loadAudioDefaults, saveAllDefaults } from './ui-audio-settings.js';
import { refreshPresetButtons, selectPreset, updatePlaybackControls } from './ui-presets.js';
import { loadLocks } from './param-lock.js';

const EXPORT_VERSION = 2;
const SETUP_MAGIC    = 'mubone-setup';
const SESSION_MAGIC  = 'mubone-session';

// localStorage keys that form a complete settings export.
// ⚠ Keep this in sync with every localStorage key the app writes.
const STATIC_KEYS = [
  'mubone_audio_defaults',
  'mubone_key_map',
  'mubone_midi_map',
  'mubone_user_presets',
  'mubone_param_locks',
  'mubone-learn-mode',
  'mubone_sensor_cal',
  'mubone_darkMode',
  'mubone_uiScale',
  'mubone-hud-scale',
  'mubone_fovDeg',
  'mubone_edgeIndicator',
  'mubone_edgeIndicatorSize',
  'mubone_preset_view',
  'mubone_desktop_morph',
  'mubone_gesture_panel',
  'mubone_radial_pins',
  'grainDiagSnapshot',
  'mubone_sensorMappings',
];

// ── WAV encoding / decoding helpers ─────────────────────────────────────────

/** Encode an AudioBuffer → base64-encoded WAV string. */
function audioBufferToBase64Wav(buf) {
  const numCh   = buf.numberOfChannels;
  const length  = buf.length;
  const sr      = buf.sampleRate;
  const bitsPS  = 16;
  const bytesPS = bitsPS / 8;
  const blockAlign = numCh * bytesPS;
  const dataSize   = length * blockAlign;
  const headerSize = 44;
  const ab = new ArrayBuffer(headerSize + dataSize);
  const dv = new DataView(ab);

  // RIFF header
  writeStr(dv, 0, 'RIFF');
  dv.setUint32(4, 36 + dataSize, true);
  writeStr(dv, 8, 'WAVE');
  // fmt chunk
  writeStr(dv, 12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, numCh, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bitsPS, true);
  // data chunk
  writeStr(dv, 36, 'data');
  dv.setUint32(40, dataSize, true);

  // Interleave channels → 16-bit PCM
  const channels = [];
  for (let ch = 0; ch < numCh; ch++) channels.push(buf.getChannelData(ch));
  let off = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]));
      dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }

  return arrayBufferToBase64(ab);
}

function writeStr(dv, offset, str) {
  for (let i = 0; i < str.length; i++) dv.setUint8(offset + i, str.charCodeAt(i));
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Decode a base64-encoded WAV string → AudioBuffer. */
async function base64WavToAudioBuffer(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  const actx = ensureAudioContext();
  return actx.decodeAudioData(bytes.buffer);
}


// ═════════════════════════════════════════════════════════════════════════════
// SETTINGS EXPORT / IMPORT (lightweight, localStorage only)
// ═════════════════════════════════════════════════════════════════════════════

function buildSettingsPayload() {
  const data = {
    _magic:   SETUP_MAGIC,
    _version: EXPORT_VERSION,
    _exportedAt: new Date().toISOString(),
  };
  for (const key of STATIC_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) data[key] = raw;
    } catch (_) {}
  }
  // Dynamic prefix keys: panel collapse + section collapse states
  const panels = {}, sections = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('mubone_panel_'))  panels[k]   = localStorage.getItem(k);
      if (k && k.startsWith('mubone_sec_'))    sections[k]  = localStorage.getItem(k);
    }
  } catch (_) {}
  if (Object.keys(panels).length > 0)   data._panels   = panels;
  if (Object.keys(sections).length > 0) data._sections = sections;
  return data;
}

function exportSettings() {
  // Flush live state → localStorage before reading keys
  saveAllDefaults();
  saveUserPresets();
  const json = JSON.stringify(buildSettingsPayload(), null, 2);
  downloadJSON(json, 'mubone-setup');
}

function applySettingsPayload(data) {
  for (const key of STATIC_KEYS) {
    if (key in data) {
      try { localStorage.setItem(key, data[key]); } catch (_) {}
    }
  }
  if (data._panels && typeof data._panels === 'object') {
    for (const [k, v] of Object.entries(data._panels)) {
      if (k.startsWith('mubone_panel_')) {
        try { localStorage.setItem(k, v); } catch (_) {}
      }
    }
  }
  if (data._sections && typeof data._sections === 'object') {
    for (const [k, v] of Object.entries(data._sections)) {
      if (k.startsWith('mubone_sec_')) {
        try { localStorage.setItem(k, v); } catch (_) {}
      }
    }
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// SESSION EXPORT / IMPORT (full state with audio)
// ═════════════════════════════════════════════════════════════════════════════

function buildSessionPayload() {
  // Flush live state → localStorage so buildSettingsPayload reads current values
  saveAllDefaults();
  saveUserPresets();

  const data = {
    _magic:      SESSION_MAGIC,
    _version:    EXPORT_VERSION,
    _exportedAt: new Date().toISOString(),

    // Include all settings too
    settings: buildSettingsPayload(),

    // ── Samples (audio + metadata) ──
    samples: S.samples.map(s => ({
      name:       s.name,
      duration:   s.duration,
      cropStart:  s.cropStart,
      cropEnd:    s.cropEnd,
      wav:        s.buffer ? audioBufferToBase64Wav(s.buffer) : null,
    })),

    // ── Live recording buffers ──
    liveBuffers: (S.liveRecBuffers || []).map(slot => {
      const buf = slot.buffer || slot.liveBuffer;
      return {
        wav: buf ? audioBufferToBase64Wav(buf) : null,
      };
    }),

    // ── Particles ──
    particles: S.particles.map(p => ({
      lon:           p.lon,
      lat:           p.lat,
      strokeId:      p.strokeId,
      grainDuration: p.grainDuration,
      grainStart:    p.grainStart,
      source:        p.source,
      sampleIndex:   p.sampleIndex ?? null,
      liveBufferIdx: p.liveBufferIdx ?? null,
      color:         p.color,
      rms:           p.rms ?? 0,
      centroid:      p.centroid ?? 0,
      zcr:           p.zcr ?? 0,
    })),

    // ── Commits (unified cloud + loop slots) ──
    commits: S.commitSlots.map(slot => {
      if (!slot) return null;
      if (slot.type === 'cloud') {
        return {
          type:             'cloud',
          slotIndex:        slot.slotIndex,
          lon:              slot.lon,
          lat:              slot.lat,
          color:            slot.color,
          searchRadiusDeg:  slot.searchRadiusDeg,
          nearestMode:      slot.nearestMode,
          kAllMode:         slot.kAllMode,
          kSeqMode:         slot.kSeqMode,
          grainParams:      slot.grainParams,
          grainOverrides:   slot.grainOverrides,
          radiusFadeEnabled: slot.radiusFadeEnabled,
          radiusFadeCurve:  slot.radiusFadeCurve,
          _envAttack:       slot._envAttack,
          _envRelease:      slot._envRelease,
          // Moving seed fields
          frames:           slot.frames,
          duration:         slot.duration,
          loopMode:         slot.loopMode,
        };
      } else if (slot.type === 'loop') {
        return {
          type:          'loop',
          slotIndex:     slot.slotIndex,
          strokeId:      slot.strokeId,
          color:         slot.color,
          anchorLon:     slot.anchorLon,
          anchorLat:     slot.anchorLat,
          speed:         slot.speed,
          direction:     slot.direction,
          playing:       slot.playing,
          playheadIndex: slot.playheadIndex,
          loopStart:     slot.loopStart,
          loopEnd:       slot.loopEnd,
          grainParams:   slot.grainParams,
          wav:           slot.buffer ? audioBufferToBase64Wav(slot.buffer) : null,
          particleIndices: slot.particles.map(p => S.particles.indexOf(p)),
        };
      }
      return null;
    }),

    // ── Misc live state ──
    currentStrokeId:   S.currentStrokeId,
    activeSampleIndex: S.activeSampleIndex,
    sampleColorIndex:  S.sampleColorIndex,
    liveColorIndex:    S.liveColorIndex,
  };

  return data;
}

async function exportSession(statusFn) {
  statusFn?.('encoding audio...');
  // buildSessionPayload is synchronous (WAV encoding is CPU-bound)
  // but we yield to the event loop so the UI can update
  await new Promise(r => setTimeout(r, 50));
  const payload = buildSessionPayload();
  statusFn?.('writing file...');
  await new Promise(r => setTimeout(r, 50));
  const json = JSON.stringify(payload);
  downloadJSON(json, 'mubone-session');
}

async function applySessionPayload(data) {
  const actx = ensureAudioContext();

  // 1. Restore settings (localStorage → S)
  if (data.settings) {
    applySettingsPayload(data.settings);
    // Apply the saved localStorage values into the running S state
    // so presets, seed config, viz settings etc. take effect immediately
    loadAudioDefaults();
    loadUserPresets();
    loadLocks();
  }

  // 2. Restore samples
  S.samples.length = 0;
  for (const s of (data.samples || [])) {
    const buf = s.wav ? await base64WavToAudioBuffer(s.wav) : null;
    S.samples.push({
      buffer:      buf,
      name:        s.name,
      duration:    buf ? buf.duration : s.duration,
      grainCursor: 0,
      cropStart:   s.cropStart ?? 0,
      cropEnd:     s.cropEnd ?? 1,
    });
  }

  // 3. Restore live buffers
  S.liveRecBuffers = [];
  for (const slot of (data.liveBuffers || [])) {
    const buf = slot.wav ? await base64WavToAudioBuffer(slot.wav) : null;
    S.liveRecBuffers.push({
      buffer:      buf,
      liveBuffer:  null,
      grainCursor: 0,
    });
  }

  // 4. Restore particles
  S.particles.length = 0;
  for (const p of (data.particles || [])) {
    const particle = {
      lon:           p.lon,
      lat:           p.lat,
      strokeId:      p.strokeId,
      grainDuration: p.grainDuration,
      grainStart:    p.grainStart,
      source:        p.source,
      color:         p.color,
      rms:           p.rms ?? 0,
      centroid:      p.centroid ?? 0,
      zcr:           p.zcr ?? 0,
    };
    if (p.source === 'sample') particle.sampleIndex = p.sampleIndex;
    if (p.source === 'live')   particle.liveBufferIdx = p.liveBufferIdx;
    stampCartesian(particle);
    S.particles.push(particle);
  }
  S._particleVersion = (S._particleVersion || 0) + 1;

  // 5. Restore commits (unified cloud + loop slots)
  for (let i = 0; i < MAX_COMMITS; i++) {
    const c = data.commits?.[i];
    if (!c) { S.commitSlots[i] = null; continue; }

    if (c.type === 'cloud') {
      S.commitSlots[i] = {
        type:             'cloud',
        slotIndex:        c.slotIndex,
        lon:              c.lon,
        lat:              c.lat,
        color:            c.color,
        searchRadiusDeg:  c.searchRadiusDeg,
        nearestMode:      c.nearestMode,
        kAllMode:         c.kAllMode,
        kSeqMode:         c.kSeqMode,
        grainParams:      c.grainParams,
        grainOverrides:   c.grainOverrides ?? {},
        morphT:           0.5,
        morphVelocity:    0,
        radiusFadeEnabled: c.radiusFadeEnabled,
        radiusFadeCurve:  c.radiusFadeCurve,
        _lastFiredAt:     0,
        _nextPeriodMs:    0,
        _plantedAt:       performance.now() / 1000,
        _releasingAt:     0,
        _envAttack:       c._envAttack ?? 0,
        _envRelease:      c._envRelease ?? 0,
        _envGainCurrent:  1,
        frames:           c.frames,
        duration:         c.duration ?? 0,
        loopMode:         c.loopMode ?? 'pingpong',
        _playheadMs:      0,
        _pingForward:     true,
      };
    } else if (c.type === 'loop') {
      const buf = c.wav ? await base64WavToAudioBuffer(c.wav) : null;
      const particles = (c.particleIndices || [])
        .map(idx => S.particles[idx])
        .filter(p => p != null);

      S.commitSlots[i] = {
        type:          'loop',
        slotIndex:     c.slotIndex,
        strokeId:      c.strokeId,
        color:         c.color,
        anchorLon:     c.anchorLon,
        anchorLat:     c.anchorLat,
        speed:         c.speed ?? 1,
        direction:     c.direction ?? 1,
        playing:       false, // start stopped — user activates manually
        playheadIndex: c.playheadIndex ?? 0,
        loopStart:     c.loopStart ?? 0,
        loopEnd:       c.loopEnd ?? (buf ? buf.duration : 0),
        grainParams:   c.grainParams ?? { volume: 1 },
        buffer:        buf,
        particles:     particles,
        _sourceNode:   null,
        _gainNode:     null,
        _revBuffer:    null,
        _startedAt:    0,
      };
    } else {
      S.commitSlots[i] = null;
    }
  }

  // 7. Restore misc state
  if (typeof data.currentStrokeId === 'number')   S.currentStrokeId   = data.currentStrokeId;
  if (typeof data.activeSampleIndex === 'number')  S.activeSampleIndex = data.activeSampleIndex;
  if (typeof data.sampleColorIndex === 'number')   S.sampleColorIndex  = data.sampleColorIndex;
  if (typeof data.liveColorIndex === 'number')     S.liveColorIndex    = data.liveColorIndex;
}


// ═════════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function downloadJSON(json, prefix) {
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const now  = new Date();
  const ts   = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');
  const name = `${prefix}-${ts}.json`;
  const a = document.createElement('a');
  a.href     = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return name;
}

function pickFile(accept) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) { reject(new Error('No file selected')); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve({ name: file.name, data: JSON.parse(reader.result) }); }
        catch (e) { reject(e); }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
    input.click();
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// UI INIT
// ═════════════════════════════════════════════════════════════════════════════

export function initExportImport() {
  const exportBtn = document.getElementById('exportSetupBtn');
  const importBtn = document.getElementById('importSetupBtn');

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      // Show choice dialog: settings or session
      const overlay = document.createElement('div');
      overlay.className = 'factory-reset-overlay';
      overlay.innerHTML = `
        <div class="factory-reset-dialog">
          <div class="factory-reset-title">export</div>
          <p class="factory-reset-desc">Choose what to export:</p>
          <div class="factory-reset-btns" style="flex-direction:column;gap:8px;">
            <button class="factory-reset-btn export-choice" data-mode="settings" style="width:100%">
              settings only
              <span style="display:block;font-size:10px;opacity:0.6;margin-top:2px">audio config, key/MIDI mappings, patches, panel states</span>
            </button>
            <button class="factory-reset-btn export-choice" data-mode="session" style="width:100%">
              full session
              <span style="display:block;font-size:10px;opacity:0.6;margin-top:2px">settings + samples, particles, seeds, loops (includes audio)</span>
            </button>
            <button class="factory-reset-btn factory-reset-cancel" style="width:100%">cancel</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector('.factory-reset-cancel').addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

      overlay.querySelectorAll('.export-choice').forEach(btn => {
        btn.addEventListener('click', async () => {
          const mode = btn.dataset.mode;
          if (mode === 'settings') {
            overlay.remove();
            exportSettings();
            exportBtn.classList.add('export-flash');
            setTimeout(() => exportBtn.classList.remove('export-flash'), 600);
          } else {
            // Session export — show progress
            const desc = overlay.querySelector('.factory-reset-desc');
            const btns = overlay.querySelector('.factory-reset-btns');
            btns.style.display = 'none';
            desc.textContent = 'encoding audio...';
            try {
              await exportSession(status => { desc.textContent = status; });
              overlay.remove();
              exportBtn.classList.add('export-flash');
              setTimeout(() => exportBtn.classList.remove('export-flash'), 600);
            } catch (e) {
              desc.textContent = 'export failed: ' + e.message;
              btns.style.display = '';
              btns.innerHTML = '<button class="factory-reset-btn factory-reset-cancel" style="width:100%">close</button>';
              btns.querySelector('.factory-reset-cancel').addEventListener('click', () => overlay.remove());
            }
          }
        });
      });
    });
  }

  if (importBtn) {
    importBtn.addEventListener('click', async () => {
      try {
        const { name, data } = await pickFile('.json,application/json');

        if (data._magic === SETUP_MAGIC) {
          // Settings import — apply + reload
          applySettingsPayload(data);
          showReloadDialog(`Loaded settings from <strong>${name}</strong>.`);

        } else if (data._magic === SESSION_MAGIC) {
          // Session import — show progress, decode audio, rebuild state
          const overlay = document.createElement('div');
          overlay.className = 'factory-reset-overlay';
          overlay.innerHTML = `
            <div class="factory-reset-dialog">
              <div class="factory-reset-title">importing session</div>
              <p class="factory-reset-desc">decoding audio...</p>
            </div>
          `;
          document.body.appendChild(overlay);

          try {
            await applySessionPayload(data);
            // Refresh all UI without reload — state is already in memory
            try {
              rebuildSampleListUI();
              buildSvTabs();
              requestAnimationFrame(drawSvWaveform);
              S.updateSeedBanksUI?.();
              // Refresh preset buttons from PRESETS array (loadUserPresets
              // already ran inside applySessionPayload, but the DOM buttons
              // still showed old names)
              refreshPresetButtons();
              // Re-apply the active preset so grain params + playback
              // controls reflect the imported state
              selectPreset(S.activePresetIndex ?? FACTORY_PRESET_START);
              S._syncImprovUI?.();
              S.syncGrainControlsUI?.();
              S._syncRadiusFadeUI?.();
            } catch (_) { /* UI refresh best-effort */ }
            overlay.remove();
            // Show summary (no reload needed — session is live)
            const summary = overlay.cloneNode(false);
            summary.className = 'factory-reset-overlay';
            summary.innerHTML = `
              <div class="factory-reset-dialog">
                <div class="factory-reset-title">session loaded</div>
                <p class="factory-reset-desc">
                  ${S.samples.length} sample(s), ${S.particles.length} particle(s),
                  ${S.commitSlots.filter(c => c && c.type === 'cloud').length} cloud(s),
                  ${S.commitSlots.filter(c => c && c.type === 'loop').length} loop(s)
                </p>
                <div class="factory-reset-btns">
                  <button class="factory-reset-btn factory-reset-confirm">ok</button>
                </div>
              </div>
            `;
            document.body.appendChild(summary);
            summary.querySelector('.factory-reset-confirm').addEventListener('click', () => summary.remove());
            summary.addEventListener('click', (e) => { if (e.target === summary) summary.remove(); });
          } catch (e) {
            overlay.querySelector('.factory-reset-desc').textContent = 'import failed: ' + e.message;
            setTimeout(() => overlay.remove(), 3000);
          }

        } else {
          throw new Error('Not a valid mubone export file');
        }
      } catch (e) {
        if (e.message !== 'No file selected') {
          alert('Import failed: ' + e.message);
        }
      }
    });
  }
}

function showReloadDialog(html) {
  const overlay = document.createElement('div');
  overlay.className = 'factory-reset-overlay';
  overlay.innerHTML = `
    <div class="factory-reset-dialog">
      <div class="factory-reset-title">imported</div>
      <p class="factory-reset-desc">${html}<br><br>The page will reload to apply changes.</p>
      <div class="factory-reset-btns">
        <button class="factory-reset-btn factory-reset-confirm">reload</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.factory-reset-confirm').addEventListener('click', () => location.reload());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) location.reload(); });
}
