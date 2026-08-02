// ============================================================================
// UI — EXPORT / IMPORT (Settings + Session)
//
// Two export modes:
//   1. Settings — lightweight JSON of all localStorage keys (for sharing setups)
//   2. Session  — full state including samples, particles, seeds, sequences,
//                 and live buffers as embedded WAV audio (for installations /
//                 acousmatic performance — load and it's ready to play)
// ============================================================================

import { S, MAX_COMMITS, PRESET_COUNT, PRESETS, loadUserPresets, saveUserPresets } from './state.js';
import { ensureAudioContext } from './audio.js';
import { stampCartesian, killAllGrains, releaseSeqNodes } from './grain.js';
import { rebuildSampleListUI, buildSvTabs, drawSvWaveform } from './ui-samples.js';
import { loadAudioDefaults, saveAllDefaults, splitLegacyAudioBlob, objectStore } from './ui-audio-settings.js';
import { applyPresetObject, selectPreset, updatePlaybackControls, stampSeedRadiusFade } from './ui-presets.js';
import { loadLocks } from './param-lock.js';
import { loadMappings } from './sensor-mapping.js';
import { loadConfig as loadAccessoryConfig } from './accessory-registry.js';
import { loadStaging } from './snapshot-engine.js';
import { renderAll as renderAccessoryTable } from './ui-accessory.js';
import { commitSweep } from './ui-sweep.js';
import { allKeys, allPrefixes, keysFor, CATEGORIES } from './storage-registry.js';

// v5 (2026-08-01, audit § E4): **a session no longer carries settings.** It has
// `patch` (the resolved patch object it was played on) + `patchIndex` (label
// only) instead of relying on `settings.mubone_user_presets` and re-selecting an
// index. A session is material + performance state; a setup file is the rig.
// v1–v4 sessions still import: their `settings` block is applied with a warning,
// and a missing `patch` falls back to selecting `patchIndex` from the bank.
//
// v4 (2026-08-01, storage-registry refactor): the key list is now derived from
// js/storage-registry.js, so exports gained the four keys the hand-written list
// had lost (`mubone-accessory-a8`, `mubone-ximu-led-map`, `mubone_midi_input`,
// `mubone_preset_layout_v`), lost the `debug` category, and gained the keys the
// audio blob was split into. Generated-name keys moved from separate `_panels`
// / `_sections` objects into one `_prefixed` bucket — applySettingsPayload
// reads all three, so v1–v3 files still import.
//
// v3 (2026-07-15, export/import audit): adds `live` block (performance state
// that isn't part of the active preset), `strokeIdCounter`, loop
// `startOffset`. v1/v2 files import fine — every v3 field reads with a
// fallback. Bump this ONLY with a matching read-path fallback or migration
// in the import handler's version gate.
const EXPORT_VERSION = 5;
const SETUP_MAGIC    = 'mubone-setup';
const SESSION_MAGIC  = 'mubone-session';

// localStorage keys that form a complete settings export — derived from
// js/storage-registry.js rather than hand-maintained.
//
// The hand-written list this replaces had drifted twice. The 2026-07-15
// export/import audit found 9 keys missing (docs/EXPORT-IMPORT-AUDIT-2026-07.md
// § B) and listed a registry refactor as deliberately deferred; by 2026-08-01
// four more had gone missing — `mubone-accessory-a8` and `mubone-ximu-led-map`
// among them, so a setup export silently carried none of the A8 accessory
// config or the LED map. Deriving from the registry is what stops this
// recurring; scripts/browser-audit.js fails if a live key isn't registered.
//
// `debug` is the one excluded category: a shared setup file has no business
// carrying someone else's diagnostic snapshot or OSC trace flag.
const EXCLUDED_CATEGORIES = ['debug'];
const STATIC_KEYS   = allKeys({ exclude: EXCLUDED_CATEGORIES });
const EXPORT_PREFIXES = allPrefixes({ exclude: EXCLUDED_CATEGORIES });

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
  // Keys written under a generated name (panel + section collapse state).
  // One bucket driven by the registry's prefix list, so adding a prefix there
  // is all it takes — v3 and earlier used separate `_panels` / `_sections`
  // objects, which applySettingsPayload still reads.
  const prefixed = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && EXPORT_PREFIXES.some(p => k.startsWith(p))) prefixed[k] = localStorage.getItem(k);
    }
  } catch (_) {}
  if (Object.keys(prefixed).length > 0) data._prefixed = prefixed;
  return data;
}

function exportSettings() {
  // Flush live state → localStorage before reading keys
  saveAllDefaults();
  saveUserPresets();
  const json = JSON.stringify(buildSettingsPayload(), null, 2);
  downloadJSON(json, 'mubone-setup');
}

/**
 * Clear every key a setup file governs — all registered categories except
 * `debug`, which never travels in an export.
 *
 * This is what makes `replace` import mode possible: without it an import is a
 * merge, so a file that carries no accessory config leaves yours in place and
 * you end up running a hybrid of two rigs rather than the one in the file.
 * Enumerating what to clear is only safe because storage-registry.js is
 * asserted complete by scripts/browser-audit.js.
 */
function clearGovernedKeys() {
  const cats = CATEGORIES.map(c => c.id).filter(id => !EXCLUDED_CATEGORIES.includes(id));
  let n = 0;
  for (const k of keysFor(cats)) {
    try { localStorage.removeItem(k); n++; } catch (_) {}
  }
  console.log(`[import] replace mode: cleared ${n} key(s) before applying`);
}

function applySettingsPayload(data) {
  // Normalise a pre-v4 payload BEFORE writing anything. Files up to v3 carry
  // the old grab-bag `mubone_audio_defaults` and none of the four keys it was
  // split into; reshaping afterwards silently dropped the imported seed
  // settings, viz calibration and active patch on any machine that had already
  // migrated its own storage. `overwrite: true` because an import is an
  // explicit instruction to take the file's values.
  splitLegacyAudioBlob(objectStore(data), { overwrite: true });

  for (const key of STATIC_KEYS) {
    if (!(key in data)) continue;
    // Values are raw localStorage strings. A hand-edited file with an object
    // here would stringify to "[object Object]" and poison the key — every
    // later JSON.parse of it throws and the module silently falls back to
    // defaults, which looks like the import having done nothing.
    const v = data[key];
    if (typeof v !== 'string') {
      console.warn(`[import] skipping "${key}": expected a string, got ${typeof v}`);
      continue;
    }
    try { localStorage.setItem(key, v); } catch (e) {
      // Quota is the realistic failure. Say so — silently half-applying a
      // setup is worse than a noisy partial.
      console.warn(`[import] could not write "${key}":`, e.message);
    }
  }
  // v4 writes one `_prefixed` bucket; v3 and earlier split it into `_panels`
  // and `_sections`. Read all three and let the prefix check decide what's
  // legitimate — a payload can't smuggle in an arbitrary key this way.
  for (const bucket of [data._prefixed, data._panels, data._sections]) {
    if (!bucket || typeof bucket !== 'object') continue;
    for (const [k, v] of Object.entries(bucket)) {
      if (!EXPORT_PREFIXES.some(p => k.startsWith(p))) continue;
      try { localStorage.setItem(k, v); } catch (_) {}
    }
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// SESSION EXPORT / IMPORT (full state with audio)
// ═════════════════════════════════════════════════════════════════════════════

function buildSessionPayload() {
  const data = {
    _magic:      SESSION_MAGIC,
    _version:    EXPORT_VERSION,
    _exportedAt: new Date().toISOString(),

    // ── The patch this was played on ──
    // v5: the resolved patch OBJECT, not an index into the bank. Sessions used
    // to embed the whole settings payload (including the user bank) purely so
    // that re-selecting `activePresetIndex` on import would find the right
    // patch — which still meant "whatever lives in slot N on this machine".
    // Carrying the patch itself makes the session self-contained and is what
    // let settings come out of the format entirely (audit § E4).
    // The index rides along for the HUD label only; nothing resolves through it.
    patch:      PRESETS[S.activePresetIndex] ? JSON.parse(JSON.stringify(PRESETS[S.activePresetIndex])) : null,
    patchIndex: S.activePresetIndex ?? 0,

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
          startOffset:   slot.startOffset ?? 0,
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
    strokeIdCounter:   S.strokeIdCounter,
    activeSampleIndex: S.activeSampleIndex,
    sampleColorIndex:  S.sampleColorIndex,
    liveColorIndex:    S.liveColorIndex,

    // ── Live performance state (v3, audit C1) ──
    // Everything audible-but-not-in-the-preset. Import re-applies the active
    // preset, so without this block the session wouldn't sound like it did
    // at export unless the performer had saved a patch first. Applied AFTER
    // selectPreset in the import handler. scanMuted is deliberately excluded
    // — restoring a muted scan on load reads as "import broke the sound".
    live: {
      searchRadiusDeg:  S.searchRadiusDeg,
      recencyN:         S.recencyN,
      nearestMode:      S.nearestMode,
      grainKAllMode:    S.grainKAllMode,
      grainKSeqMode:    S.grainKSeqMode,
      grainOverrides:   { ...S.grainOverrides },
      grainProbability: S.grainProbability,
      scanFadeS:        S.scanFadeS,
      traceMode:        S.traceMode,
      commitMode:       S.commitMode,
      commitSlotCount:  S.commitSlotCount,
      commitOverflow:   S.commitOverflow,
      selectionMode:    S.selectionMode,
      paintTickerMs:    S.paintTicker?.intervalMs ?? null,
    },
  };

  return data;
}

// Test seam for scripts/browser-audit.js § reset 5c4 — asserts what the file
// actually contains (no settings block, resolved patch) rather than trusting the
// comments above. Not used by the app.
export const __testBuildSessionPayload = buildSessionPayload;

async function exportSession(statusFn) {
  // Audit C5: an in-progress recording serializes as { wav: null } — its
  // particles would be permanently silent on reimport. Finish it first.
  if (S.isRecording) throw new Error('stop recording before exporting a session');
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
  // 0a. Validate shape BEFORE touching any state (audit D) — a truncated or
  // hand-edited file must not leave a half-cleared session behind.
  for (const k of ['samples', 'liveBuffers', 'particles', 'commits']) {
    if (data[k] != null && !Array.isArray(data[k])) {
      throw new Error(`malformed session file: "${k}" is not an array`);
    }
  }
  // Importing mid-recording would swap liveRecBuffers out from under the
  // recorder (audit C5).
  if (S.isRecording) throw new Error('stop recording before importing a session');

  const actx = ensureAudioContext();

  // 0b. Teardown the current session (audit A2–A4):
  //  - commitSweep(): clears any pending sweep/erase snapshot + its 30s
  //    timer, so ⌘Z after import can't restore pre-import arrays into
  //    post-import engine state.
  //  - killAllGrains(): stops in-flight main-thread grain nodes.
  //  - releaseSeqNodes(): stops playing loops FULLY (source + gain + VBAP
  //    fan-out, perf-audit M2) — overwriting the slot without this left the
  //    old loop sounding forever with nothing referencing it.
  //  - strokeHistory reset: undo history does not survive import; stale
  //    entries would splice imported buffers at pre-import indices.
  // (Worklet grains are handled by _reloadWorkletEngine at the end.)
  commitSweep();
  killAllGrains();
  for (let i = 0; i < MAX_COMMITS; i++) {
    const slot = S.commitSlots[i];
    if (slot && slot.type === 'loop') releaseSeqNodes(slot);
    S.commitSlots[i] = null;
  }
  S.strokeHistory = [];

  // 1. Settings are NOT part of a session any more (v5, audit § E4).
  //
  // A session import can't reload — the samples, particles and commits it
  // restores live in memory and a reload would discard them. But most settings
  // are only read by their module at init, so a session that carried them
  // applied about four of thirty and ambushed you with the rest on the next
  // restart. Rather than report that, the format stopped making the promise:
  // a session is material + performance state, a setup file is the rig.
  //
  // Files up to v4 embedded a `settings` block. Honour it for those, since
  // that IS what the file meant, but say so — importing one on a different rig
  // is the case that was silently wrong.
  if (data.settings) {
    console.warn('[import] v%s session carries settings; applying them, but they mostly need a restart — re-export to v%s to decouple them',
      data._version ?? '?', EXPORT_VERSION);
    applySettingsPayload(data.settings);
    loadAudioDefaults();
    loadUserPresets();
    loadLocks();
    loadMappings();
    loadAccessoryConfig();
    loadStaging();
    S._syncMappingUI?.();
    S._syncMappingHighlights?.();
    renderAccessoryTable();  // loadConfig mutates channels in place; the table won't notice
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
        startOffset:   c.startOffset ?? 0,
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

  // 6. Re-stamp per-particle radius-fade attenuation (audit C2).  The
  // `_cFade${slot}` stamps live on particles, which were rebuilt in step 4;
  // without this, imported fade clouds play edge grains at full volume
  // (bridge falls back to `?? 1.0`).
  for (let i = 0; i < MAX_COMMITS; i++) {
    stampSeedRadiusFade(S.commitSlots[i]);
  }

  // 7. Restore misc state
  if (typeof data.currentStrokeId === 'number')   S.currentStrokeId   = data.currentStrokeId;
  if (typeof data.activeSampleIndex === 'number')  S.activeSampleIndex = data.activeSampleIndex;
  if (typeof data.sampleColorIndex === 'number')   S.sampleColorIndex  = data.sampleColorIndex;
  if (typeof data.liveColorIndex === 'number')     S.liveColorIndex    = data.liveColorIndex;

  // 7b. Stroke-id continuity (audit A1).  Recency ranks by strokeId and undo
  // filters by it — if the counter restarts below the imported ids, every new
  // stroke ranks OLDER than the imported material (inaudible under recency)
  // and undo of a new stroke deletes imported particles sharing its id.
  // v3 files carry the counter; for v1/v2 we recover it from the data.
  let maxSid = typeof data.strokeIdCounter === 'number' ? data.strokeIdCounter : 0;
  for (const p of S.particles) if (p.strokeId > maxSid) maxSid = p.strokeId;
  for (const c of S.commitSlots) {
    if (c && typeof c.strokeId === 'number' && c.strokeId > maxSid) maxSid = c.strokeId;
  }
  if (maxSid > S.strokeIdCounter) S.strokeIdCounter = maxSid;

  // 8. Refresh the worklet's buffer map.
  // The worklet keys its _bufferMap on AudioBuffer object identity. Steps 2–3
  // above swapped in fresh AudioBuffers decoded from the import payload, so
  // every candidate's audioBuf lookup now misses → all candidates filtered
  // out → cursor enters particle radii but no grains fire (particles still
  // render). Stop+start rebuilds _bufferMap from the imported S.samples /
  // S.liveRecBuffers via startWorkletGrain.
  await S._reloadWorkletEngine?.();
}


/**
 * Apply the v3 `live` block — performance state that isn't part of the
 * active preset (audit C1).  MUST run after selectPreset in the import
 * handler, since selectPreset overwrites radius/recency/k from the preset.
 * v1/v2 files have no `live` block → no-op (preset values stand, as before).
 */
function applyLiveState(live) {
  if (!live || typeof live !== 'object') return;
  if (typeof live.searchRadiusDeg === 'number') S.searchRadiusDeg = live.searchRadiusDeg;
  if (typeof live.recencyN === 'number') {
    if (typeof S.setRecency === 'function') S.setRecency(live.recencyN);
    else S.recencyN = live.recencyN;
  }
  if (typeof live.nearestMode === 'boolean')      S.nearestMode      = live.nearestMode;
  if (typeof live.grainKAllMode === 'boolean')    S.grainKAllMode    = live.grainKAllMode;
  if (typeof live.grainKSeqMode === 'boolean')    S.grainKSeqMode    = live.grainKSeqMode;
  if (live.grainOverrides && typeof live.grainOverrides === 'object') {
    S.grainOverrides = { ...live.grainOverrides };
  }
  if (typeof live.grainProbability === 'number')  S.grainProbability = live.grainProbability;
  if (typeof live.scanFadeS === 'number')         S.scanFadeS        = live.scanFadeS;
  if (typeof live.traceMode === 'string')         S.traceMode        = live.traceMode;
  if (typeof live.commitMode === 'string')        S.commitMode       = live.commitMode;
  if (typeof live.commitSlotCount === 'number')   S.commitSlotCount  = live.commitSlotCount;
  if (typeof live.commitOverflow === 'string')    S.commitOverflow   = live.commitOverflow;
  if (typeof live.selectionMode === 'string')     S.selectionMode    = live.selectionMode;
  if (typeof live.paintTickerMs === 'number' && S.paintTicker) {
    S.paintTicker.intervalMs = live.paintTickerMs;
  }
  S._syncCommitUI?.();
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
              setup
              <span style="display:block;font-size:10px;opacity:0.6;margin-top:2px">the rig — audio config, sensor cal, key/MIDI/OSC, mappings, patches, layout</span>
            </button>
            <button class="factory-reset-btn export-choice" data-mode="session" style="width:100%">
              session
              <span style="display:block;font-size:10px;opacity:0.6;margin-top:2px">the music — samples, particles, seeds, loops, the patch it was played on (includes audio)</span>
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

        // Version gate (audit D): refuse files from a newer build than this
        // one can read. Older versions (v1/v2) are readable as-is — every
        // field added since imports with a fallback; add a migration switch
        // here if a future bump ever breaks that.
        if (typeof data._version === 'number' && data._version > EXPORT_VERSION) {
          throw new Error(`file is export version ${data._version}; this build reads up to v${EXPORT_VERSION} — update mubone`);
        }

        if (data._magic === SETUP_MAGIC) {
          // Settings import — ask merge or replace, then apply + reload.
          // Merge is the default because it's the non-destructive one and the
          // usual reason to import is borrowing part of a setup. Replace is for
          // "put this rig on this machine", where a leftover local key is a bug.
          showSetupImportDialog(name, data);

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
              // Restore the patch the session was played on. v5 carries the
              // resolved patch object, so this no longer resolves an index
              // through the bank — which is what made a session portable
              // between rigs (audit § E4). It also drops the old
              // "index past the end of this build's bank" fallback: there is
              // no index to be out of range.
              if (data.patch) {
                applyPresetObject(data.patch);
              } else {
                // v4 and earlier: only an index, meaning "whatever is in slot N
                // here". Keep working, but this is the imprecise path.
                const _pi = data.patchIndex ?? S.activePresetIndex ?? 0;
                selectPreset(_pi >= 0 && _pi < PRESET_COUNT ? _pi : 0);
              }
              // v3: live performance tweaks override the preset (audit C1)
              applyLiveState(data.live);
              updatePlaybackControls?.();
              S._syncImprovUI?.();
              S.syncGrainControlsUI?.();
              S._syncRadiusFadeUI?.();
            } catch (_) { /* UI refresh best-effort */ }
            overlay.remove();
            // Show summary (no reload needed — session is live)
            // Only pre-v5 files still carry settings, and those mostly need a
            // restart. v5 sessions carry none, so there is nothing to warn about.
            const waitingHtml = data.settings ? `
              <p class="factory-reset-desc" style="opacity:0.75">
                This file also carried settings (pre-v${EXPORT_VERSION} format) —
                most of those apply on the next restart. Re-export to update it.
              </p>` : '';
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
                ${waitingHtml}
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

/**
 * Setup import — choose merge or replace before anything is written.
 *
 * The count in the copy is the honest version of the difference: a merge leaves
 * whatever the file doesn't mention, and how many keys that is depends on the
 * file, so it's worth showing rather than describing.
 */
function showSetupImportDialog(name, data) {
  const inFile = allKeys({ exclude: EXCLUDED_CATEGORIES }).filter(k => k in data).length;
  const governed = CATEGORIES.map(c => c.id)
    .filter(id => !EXCLUDED_CATEGORIES.includes(id));
  const localCount = keysFor(governed).filter(k => {
    try { return localStorage.getItem(k) !== null; } catch (_) { return false; }
  }).length;
  const untouched = Math.max(0, localCount - inFile);

  const overlay = document.createElement('div');
  overlay.className = 'factory-reset-overlay';
  overlay.innerHTML = `
    <div class="factory-reset-dialog">
      <div class="factory-reset-title">import settings</div>
      <p class="factory-reset-desc">
        <strong>${name}</strong> carries ${inFile} setting group(s).
      </p>
      <div class="reset-cats">
        <label class="reset-cat">
          <input type="radio" name="importMode" value="merge" checked>
          <span class="reset-cat-text">
            <span class="reset-cat-label">merge</span>
            <span class="reset-cat-hint">apply what the file has; leave your other ${untouched} setting(s) alone</span>
          </span>
        </label>
        <label class="reset-cat">
          <input type="radio" name="importMode" value="replace">
          <span class="reset-cat-text">
            <span class="reset-cat-label">replace</span>
            <span class="reset-cat-hint">clear all stored settings first, so you get exactly this file's rig</span>
          </span>
        </label>
      </div>
      <div class="factory-reset-btns">
        <button class="factory-reset-btn factory-reset-cancel">cancel</button>
        <button class="factory-reset-btn factory-reset-confirm">import</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.factory-reset-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('.factory-reset-confirm').addEventListener('click', () => {
    const replace = overlay.querySelector('input[value="replace"]').checked;
    overlay.remove();
    if (replace) clearGovernedKeys();
    applySettingsPayload(data);
    showReloadDialog(
      `${replace ? 'Replaced' : 'Merged'} settings from <strong>${name}</strong>.`);
  });
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
