// ============================================================================
// UI — EXPORT / IMPORT (Settings + Session)
//
// Two export modes:
//   1. Settings — lightweight JSON of all localStorage keys (for sharing setups)
//   2. Session  — full state including samples, particles, seeds, sequences,
//                 and live buffers as embedded WAV audio (for installations /
//                 acousmatic performance — load and it's ready to play)
// ============================================================================

import { S, MAX_COMMITS } from './state.js';
import { settleTakeTimbre } from './audio-features.js';
import { ensureAudioContext } from './audio.js';
import { stampCartesian, killAllGrains, releaseSeqNodes } from './grain.js';
import { rebuildSampleListUI } from './ui-samples.js';
import { loadAudioDefaults, saveAllDefaults, splitLegacyAudioBlob, objectStore } from './ui-audio-settings.js';
import { applyPresetObject, updatePlaybackControls, buildOverdubLayer } from './ui-presets.js';
import { snapshotCurrentState } from './param-registry.js';
import { loadMappings } from './sensor-mapping.js';
import { loadConfig as loadAccessoryConfig } from './accessory-registry.js';
import * as history from './history.js';
import { allKeys, allPrefixes, keysFor, CATEGORIES } from './storage-registry.js';
import { restoreTrigger, stopTriggerAudio } from './trigger.js';
import { exportGroups, restoreGroups, applyMix } from './pins.js';

/** A pin's `mute` from a slot record of any version: v13 writes it; before
 *  that `_preGroupOn === false` (v7-v9: `_preLayerOn`) meant "silenced by
 *  hand before its group went down", `true` meant the group did it, and with
 *  neither the engine flag (`silentByEngine`) is the only witness. */
function _pinMuteFrom(c, silentByEngine) {
  if (typeof c.mute === 'boolean') return c.mute;
  const pre = typeof c._preGroupOn === 'boolean' ? c._preGroupOn
            : typeof c._preLayerOn === 'boolean' ? c._preLayerOn : undefined;
  if (pre === false) return true;
  if (pre === true)  return false;
  return !!silentByEngine;
}
import { exportVoicings, restoreVoicings, voicingFromLegacyPatch, migrateBlockKeys } from './brush-voicing.js';

// v8 (2026-08-25): frozen brushes. Adds `live.voicings` (the interned table of
// resolved grain param blocks) and `_vo` per particle — which brush setting
// plays that mark. Written only when non-zero, like `trig`, because the
// particle array is the biggest thing in the file. v7-and-earlier sessions get
// ONE voicing built from the `patch` they already embed (v5, § E4), so imported
// material plays with the settings it was really painted with rather than
// following whatever brush happens to be selected.
//
// v7 (2026-08-25, superseded by v10): arrangement layers — `live.layers` and a
// per-slot `layerId`. See v10 for why none of that is read any more.
//
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
//
// v13 (2026-09-05): audibility is DERIVED (js/pins.js). A pin carries its own
// `mute` and `solo`, a group its `muted` and `solo`, and nothing else about
// silence is stored: `_preGroupOn` (the write-through model's restore rule)
// is gone from the file. Reading older files: `_preGroupOn === false` (or its
// v7-v9 spelling `_preLayerOn`) meant "already silent when the group went
// down", so it becomes `mute: true`; absent, a cloud's `playing === false` or
// a loop's `composerMuted` is the mute. `applyMix()` runs after the slots are
// built so the engine agrees with the flags.
//
// v10 (2026-08-30): pins group by KIND, so there is no membership to store.
// `live.layers` (the named group set) and every slot's `layerId` are gone, and
// `_preLayerOn` is now `_preGroupOn` — same restore rule, a name that says what
// it holds. `live.pinGroups` replaces the layer set with the only thing the
// groups actually carry: each one's muted/solo flag. A v7–v9 file imports with
// its groups discarded, which is the correct outcome rather than a lossy one —
// the groups it names no longer exist — and its `_preLayerOn` is read into
// `_preGroupOn` so a session saved mid-mute still restores honestly.
//
// v9 (2026-08-28, #247): misc block carries `sourceKind` + `samplerIndex`
// instead of `activeSampleIndex` + `sampleColorIndex`. One-shot migration on
// import: an old stored activeSampleIndex >= 0 becomes samplerIndex (the
// source stays 'live' — the old key was transient paint state, not a
// selection); sampleColorIndex is dropped (it was never written).
// v11 (2026-09-03): the patch bank is gone. `patch` is now a SNAPSHOT of the
// live parameter set at export (param-registry.js snapshotCurrentState — the
// same sparse vocabulary a bank slot used), and `patchIndex` is not written.
// Import applies `patch` exactly as before; a v4-and-earlier file with only an
// index has nothing to resolve it against and keeps whatever sound is live.
const EXPORT_VERSION = 14;   // v14 (2026-09-07): `filterQ` split into `hpfQ` / `lpfQ` — one Q per filter

/**
 * Pack one loop/trigger particle as a flat array. Only the four fields
 * playback and drawing actually read — a stroke can run to hundreds of
 * particles and an object per particle triples the file for no gain.
 *
 * v6 exists because of what this replaces. Loop slots used to serialise
 * `particleIndices: slot.particles.map(p => S.particles.indexOf(p))`, but loop
 * particles are DETACHED COPIES with rebased grainStart (see buildLoopPayload)
 * and are not in S.particles at all — so every index was -1, the import
 * filtered them all out, and the scheduler's `!seq.particles.length` guard then
 * skipped the slot entirely. Imported loops came back silent and without a
 * playhead, buffer intact. Storing the values rather than a reference into a
 * different array is the fix; identity was never available to lean on here.
 */
function _packParticle(p) {
  return [p.lon, p.lat, p.grainStart, p.grainDuration];
}
const SETUP_MAGIC    = 'mubone-setup';
const SESSION_MAGIC  = 'mubone-session';

// localStorage keys that form a complete settings export — derived from
// js/storage-registry.js rather than hand-maintained.
//
// The hand-written list this replaces had drifted twice. The 2026-07-15
// export/import audit found 9 keys missing (docs/archive/EXPORT-IMPORT-AUDIT-2026-07.md
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

    // ── The sound this was played on ──
    // v5 made this a resolved patch OBJECT rather than an index into the bank,
    // which is what let a session be self-contained (audit § E4); v11 makes it
    // a snapshot of the live parameter set, because there is no bank left to
    // copy a slot out of. Same sparse vocabulary, applied by the same function.
    patch:      snapshotCurrentState(),

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
      // ABSENT IS NOT ZERO (2026-09-13). `?? 0` here wrote the number 0 for a
      // mark painted before `tilt` and `noise` existed, and 0 is a legal value
      // — the violet end of the arc. So the renderer's own fallback,
      // `p.tilt ?? normaliseCentroid(p.centroid …)`, could never fire across a
      // FILE: it saw 0, not undefined, and an imported pre-2026-09-13 session
      // came back as one colour. JSON drops an undefined key, which is exactly
      // what the reader needs to see.
      tilt:          p.tilt,
      zcr:           p.zcr ?? 0,
      noise:         p.noise,
      // Trigger-vs-granular is a property of the material, so it has to travel
      // with the particle. Omitting it would import a percussion map as
      // granulation fodder. Written only when true — it's absent on the large
      // majority of particles and this array is the biggest thing in the file.
      ...(p.trig ? { trig: 1 } : {}),
      // Which frozen brush voices this mark (v8). Same "write only when set"
      // reasoning as `trig` above — 0 means "follow the live params" and is
      // both the default and, after v8, vanishingly rare.
      ...(p._vo ? { vo: p._vo } : {}),
      // Path order for a looping sample trigger stroke (#247) — its
      // grainStart rewinds each pass, so without takeT an imported stroke
      // re-meshes. Only sampler trigger marks carry it.
      ...(p.takeT !== undefined ? { takeT: p.takeT } : {}),
    })),

    // ── Commits (unified cloud + loop slots) ──
    commits: S.commitSlots.map(slot => {
      if (!slot) return null;
      if (slot.type === 'cloud') {
        return {
          type:             'cloud',
          slotIndex:        slot.slotIndex,
          // v13: the pin's own two flags. Which group it is in is not
          // written — that is `type`, three lines up.
          mute:             !!slot.mute,
          solo:             !!slot.solo,
          lon:              slot.lon,
          lat:              slot.lat,
          // v13: where the pin gesture released (pins.js pinAnchorInto).
          anchorLon:        slot.anchorLon,
          anchorLat:        slot.anchorLat,
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
          // Composer mode can hold a cloud at silence with its slot intact.
          // Without these two the arrangement is lost on reload and every
          // commit comes back sounding at once.
          playing:          slot.playing,
          _composerHold:    slot._composerHold,
          // Moving seed fields
          frames:           slot.frames,
          duration:         slot.duration,
          loopMode:         slot.loopMode,
        };
      } else if (slot.type === 'loop') {
        return {
          type:          'loop',
          slotIndex:     slot.slotIndex,
          mute:          !!slot.mute,         // v13 — see the cloud branch
          solo:          !!slot.solo,
          strokeId:      slot.strokeId,
          color:         slot.color,
          anchorLon:     slot.anchorLon,
          anchorLat:     slot.anchorLat,
          speed:         slot.speed,
          direction:     slot.direction,
          playing:       slot.playing,
          // A muted loop is still `playing` — the mute is its own flag.
          composerMuted: slot.composerMuted,
          playheadIndex: slot.playheadIndex,
          startOffset:   slot.startOffset ?? 0,
          loopStart:     slot.loopStart,
          loopEnd:       slot.loopEnd,
          grainParams:   slot.grainParams,
          wav:           slot.buffer ? audioBufferToBase64Wav(slot.buffer) : null,
          particles:     slot.particles.map(_packParticle),
          // v12: the takes, not the layers — a layer is rebuilt from its take
          // and phase against the master on import (attachOverdub's maths).
          overdubs:      (slot.overdubs || []).map(o => ({ strokeId: o.strokeId, phase0: o.phase0,
                           wav: o.buffer ? audioBufferToBase64Wav(o.buffer) : null })),
        };
      }
      return null;
    }),

    // ── Triggers ──
    // A trigger is a VIEW onto a painted stroke, not an owner of material — its
    // particles are the live objects in S.particles and its buffer is the
    // stroke's source buffer, both of which this payload already carries. So a
    // trigger serialises as a strokeId plus its own settings, and no audio: the
    // particles are restored with everything else and the trigger re-derives
    // itself from them on import. Storing the audio again would duplicate it
    // AND let the two drift apart, which is the class of bug that made loop
    // slots import silent (see § E9 in the export audit).
    //
    // How a trigger is TOUCHED is global and live (dwell/start/release on
    // S.triggerParams, in the live block below). What it froze at arm time —
    // speed, volume, passes — belongs to the trigger itself, and since the
    // edit filter can change them per stroke they are carried here. Absent
    // in older files; restoreTrigger falls back to the live params.
    triggers: (S.triggers || []).map(t => ({
      strokeId: t.strokeId,
      color:    t.color,
      speed:    t.speed,
      volume:   t.grainParams?.volume,
      passes:   t.passes,
      endCap:   t.endCap,   // a slice's cut at the next onset (undefined on a plain line — JSON drops it)
    })),

    // ── Misc live state ──
    currentStrokeId:   S.currentStrokeId,
    strokeIdCounter:   S.strokeIdCounter,
    sourceKind:        S.sourceKind,
    samplerIndex:      S.samplerIndex,
    liveColorIndex:    S.liveColorIndex,

    // ── Live performance state (v3, audit C1) ──
    // Everything audible-but-not-in-the-preset. Import re-applies the active
    // preset, so without this block the session wouldn't sound like it did
    // at export unless the performer had saved a patch first. Applied AFTER
    // applyPresetObject in the import handler. scanMuted is deliberately excluded
    // — restoring a muted scan on load reads as "import broke the sound".
    live: {
      searchRadiusDeg:  S.searchRadiusDeg,
      recencyN:         S.recencyN,
      nearestMode:      S.nearestMode,
      lensReads:        S.lensReads,
      grainKAllMode:    S.grainKAllMode,
      grainKSeqMode:    S.grainKSeqMode,
      grainOverrides:   { ...S.grainOverrides },
      grainProbability: S.grainProbability,
      scanFadeS:        S.scanFadeS,
      traceMode:        S.traceMode,
      // Trigger playback params are performance state, like the grain params
      // above — they belong with the music, not the rig.
      triggerParams:    { ...S.triggerParams },
      commitMode:       S.commitMode,
      commitSlotCount:  S.commitSlotCount,
      commitOverflow:   S.commitOverflow,
      selectionMode:    S.selectionMode,
      paintTickerMs:    S.paintTicker?.intervalMs ?? null,
      // v10: the two pin groups' mute/solo. Unlike the v7 layer set this does
      // NOT have to be read before the slots exist — a group is a pin's kind, so
      // there is no id to resolve and no window in which a repaint could resolve
      // one wrongly. It is still read in applySessionPayload rather than
      // applyLiveState so that muting a restored group finds its pins.
      pinGroups:        exportGroups(),
      // v8. Read back early alongside the pin groups — see applySessionPayload
      // step 4, which needs it before the particles are built.
      voicings:         exportVoicings(),
    },
  };

  return data;
}

// Test seam for scripts/browser-audit.js § reset 5c4 — asserts what the file
// actually contains (no settings block, resolved patch) rather than trusting the
// comments above. Not used by the app.
export const __testBuildSessionPayload = buildSessionPayload;

// The other half of the same seam, added with v7 so the pin-group round trip
// can be asserted end to end rather than by inspecting the payload and hoping
// the read path agrees. scripts/pins-audit.js is the only caller.
export const __testApplySessionPayload = (d) => applySessionPayload(d);

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
  history.clear();       // undo history does not survive import: its entries name the old world
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
    loadMappings();
    loadAccessoryConfig();
    // loadStaging() SUNSET 2026-08-28 (#269). A setup file may still CARRY a
    // staging block — it is read into nothing and written back untouched, so
    // an old file survives a round trip and staging can be revived from one.
    S._syncMappingUI?.();
    S._syncMappingHighlights?.();
    S._syncGazeTrailUI?.();  // in-process path — no reload to re-light the preset button
    // renderAccessoryTable() SUNSET with the accessory table (#269). The
    // registry above still loads the config, so the channels are live and the
    // setup file is unchanged; only the table that displayed them is gone.
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
  //
  // Voicings first: the particles about to be built carry `vo` ids that have to
  // resolve against THIS file's table, not the previous session's. Keeping every
  // restore in front of the things that reference it is the rule worth having.
  restoreVoicings(data.live?.voicings);

  // A v7-or-earlier session predates frozen brushes. Rather than leave its
  // material following whatever brush is selected now, give it one voicing
  // built from the patch the file already carries — the resolved patch it was
  // genuinely played on (v5, audit § E4). One-shot: v8 files skip this.
  const _legacyVo = (data._version ?? 0) < 8
    ? voicingFromLegacyPatch(data.patch, data.patch?.name || 'imported')
    : 0;

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
      // ABSENT IS NOT ZERO (2026-09-13). `?? 0` here wrote the number 0 for a
      // mark painted before `tilt` and `noise` existed, and 0 is a legal value
      // — the violet end of the arc. So the renderer's own fallback,
      // `p.tilt ?? normaliseCentroid(p.centroid …)`, could never fire across a
      // FILE: it saw 0, not undefined, and an imported pre-2026-09-13 session
      // came back as one colour. JSON drops an undefined key, which is exactly
      // what the reader needs to see.
      tilt:          p.tilt,
      zcr:           p.zcr ?? 0,
      noise:         p.noise,
    };
    if (p.source === 'sample') particle.sampleIndex = p.sampleIndex;
    if (p.source === 'live')   particle.liveBufferIdx = p.liveBufferIdx;
    if (p.trig)                particle.trig = true;   // trigger material, never granulated
    if (typeof p.takeT === 'number') particle.takeT = p.takeT;  // path order (#247)
    particle._vo = typeof p.vo === 'number' ? p.vo : _legacyVo;
    stampCartesian(particle);
    S.particles.push(particle);
  }
  S._particleVersion = (S._particleVersion || 0) + 1;

  // A file written before 2026-09-13 carries a colour per mark that was decided
  // the instant the mark landed, against whatever had been played by then — so
  // its quiet marks took their colour from the room. The rule is the same one
  // the seal applies; run it here too, once per take, and an old session comes
  // back in the colours it would be painted in today. Harmless on a new file:
  // its marks already satisfy it, so nothing is written.
  {
    const takes = new Set();
    for (const p of S.particles) if (p.source === 'live' && p.liveBufferIdx >= 0) takes.add(p.liveBufferIdx);
    let repaired = 0;
    for (const t of takes) repaired += settleTakeTimbre(t);
    if (repaired) console.log(`[import] ${repaired} silent marks took the colour of the sound beside them`);
  }

  // 5. Restore commits (unified cloud + loop slots)
  //
  // The two groups' flags go in before the slots. This used to be a genuine
  // hazard — v7 stored a `layerId` per hold, the rail repaints on its own 6 Hz
  // timer, and the loop below AWAITS a WAV decode per loop slot, so a repaint
  // landing mid-import could resolve imported ids against the PREVIOUS session's
  // layer set and silently flatten the arrangement. Deriving the group from the
  // pin's kind removed the hazard rather than guarding it: there is no id to
  // resolve. The order is kept because a restored `muted` flag should be in
  // place before the pins it applies to appear, not because a race depends on
  // it.
  restoreGroups(data.live?.pinGroups);

  for (let i = 0; i < MAX_COMMITS; i++) {
    const c = data.commits?.[i];
    if (!c) { S.commitSlots[i] = null; continue; }

    if (c.type === 'cloud') {
      S.commitSlots[i] = {
        type:             'cloud',
        slotIndex:        c.slotIndex,
        // v13; older files are read through _pinMuteFrom (the header says how).
        mute:             _pinMuteFrom(c, c.playing === false),
        solo:             !!c.solo,
        lon:              c.lon,
        lat:              c.lat,
        // v13; an older file's cloud is anchored at the end of its path, or
        // where it sits — the rule pinAnchorInto applies.
        anchorLon:        c.anchorLon ?? (Array.isArray(c.frames) && c.frames.length ? c.frames[c.frames.length - 1].lon : c.lon),
        anchorLat:        c.anchorLat ?? (Array.isArray(c.frames) && c.frames.length ? c.frames[c.frames.length - 1].lat : c.lat),
        color:            c.color,
        searchRadiusDeg:  c.searchRadiusDeg,
        nearestMode:      c.nearestMode,
        kAllMode:         c.kAllMode,
        kSeqMode:         c.kSeqMode,
        grainParams:      migrateBlockKeys(c.grainParams),
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
        // A cloud held silent by composer mode comes back held, not sounding.
        // `playing` is undefined for every cloud saved before composer mode
        // existed, and undefined means playing — only an explicit false holds.
        playing:          c.playing === false ? false : undefined,
        _composerHold:    c.playing === false ? true : false,
        _envGainCurrent:  c.playing === false ? 0 : 1,
        frames:           c.frames,
        duration:         c.duration ?? 0,
        loopMode:         c.loopMode ?? 'pingpong',
        _playheadMs:      0,
        _pingForward:     true,
      };
    } else if (c.type === 'loop') {
      const buf = c.wav ? await base64WavToAudioBuffer(c.wav) : null;
      // v6+ stores the particle values; v1–v5 stored indices into S.particles,
      // which never resolved (see _packParticle). Those files simply have no
      // recoverable playhead data — the fallback is kept so they still import
      // their buffer rather than throwing, not because it produces anything.
      const particles = Array.isArray(c.particles)
        ? c.particles.map(a => ({ lon: a[0], lat: a[1], grainStart: a[2], grainDuration: a[3] }))
        : (c.particleIndices || []).map(idx => S.particles[idx]).filter(p => p != null);

      S.commitSlots[i] = {
        type:          'loop',
        slotIndex:     c.slotIndex,
        mute:          _pinMuteFrom(c, !!c.composerMuted),                    // v13
        solo:          !!c.solo,
        strokeId:      c.strokeId,
        color:         c.color,
        anchorLon:     c.anchorLon,
        anchorLat:     c.anchorLat,
        speed:         c.speed ?? 1,
        direction:     c.direction ?? 1,
        playing:       false, // start stopped — user activates manually
        // Carried so the mute survives, even though an imported loop starts
        // stopped: when the performer starts it, it starts in the state the
        // arrangement was saved in rather than unexpectedly sounding.
        composerMuted: !!c.composerMuted,
        playheadIndex: c.playheadIndex ?? 0,
        startOffset:   c.startOffset ?? 0,
        loopStart:     c.loopStart ?? 0,
        loopEnd:       c.loopEnd ?? (buf ? buf.duration : 0),
        grainParams:   migrateBlockKeys(c.grainParams) ?? { volume: 1 },
        buffer:        buf,
        particles:     particles,
        _sourceNode:   null,
        _gainNode:     null,
        _revBuffer:    null,
        _startedAt:    0,
      };
      // v12: the family. Each take's layer is rebuilt against THIS slot's
      // cycle; the layers start with the master's source (grain.js).
      if (Array.isArray(c.overdubs) && c.overdubs.length) {
        const seq = S.commitSlots[i];
        seq.overdubs = [];
        for (const o of c.overdubs) {
          const tb = o?.wav ? await base64WavToAudioBuffer(o.wav) : null;
          if (!tb) continue;
          const layer = buildOverdubLayer(seq, tb, +o.phase0 || 0);
          if (layer) seq.overdubs.push({ strokeId: o.strokeId, phase0: +o.phase0 || 0, buffer: tb, layer, _src: null });
        }
      }
    } else {
      S.commitSlots[i] = null;
    }

  }

  // 5a. The mix: every restored pin's engine state follows its flags and its
  // group's, now that both halves are in place (v13, js/pins.js).
  applyMix();

  // 5b. Triggers. Restored through trigger.js so the particle lookup, Cartesian
  // stamps, bounding cap and playback region are all derived by the same code
  // the live path uses — a trigger carries no audio of its own, so this is the
  // only thing that makes it playable again.
  if (S.triggers) {
    for (const t of S.triggers) stopTriggerAudio(t, 'fade');
    S.triggers.length = 0;
  }
  for (const c of (data.triggers || [])) restoreTrigger(c);
  S._syncTriggerUI?.();

  // 6. Restore misc state
  // (Radius fade needs no re-stamp on import — audit C2's `_cFade${slot}`
  // stamps are gone; the bridge now resolves fade live from the scheduler's
  // per-slot angle cache, so imported clouds fade correctly on the first tick.)
  if (typeof data.currentStrokeId === 'number')   S.currentStrokeId   = data.currentStrokeId;
  if (data.sourceKind === 'live' || data.sourceKind === 'sampler') S.sourceKind = data.sourceKind;
  if (typeof data.samplerIndex === 'number' && data.samplerIndex >= 0) S.samplerIndex = data.samplerIndex;
  // One-shot migration (≤ v8): activeSampleIndex was transient paint state,
  // not a selection — a stored slot becomes the sampler's current sample,
  // but the source stays live. sampleColorIndex is dropped (never written).
  else if (typeof data.activeSampleIndex === 'number' && data.activeSampleIndex >= 0)
    S.samplerIndex = data.activeSampleIndex;
  if (typeof data.liveColorIndex === 'number')     S.liveColorIndex    = data.liveColorIndex;

  // 6b. Stroke-id continuity (audit A1).  Recency ranks by strokeId and undo
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

  // 7. Refresh the worklet's buffer map.
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
 * patch object (audit C1).  MUST run after applyPresetObject in the import
 * handler, since the patch overwrites the grain block.
 * v1/v2 files have no `live` block → no-op (patch values stand, as before).
 */
function applyLiveState(live) {
  if (!live || typeof live !== 'object') return;
  if (typeof live.searchRadiusDeg === 'number') S.searchRadiusDeg = live.searchRadiusDeg;
  if (typeof live.recencyN === 'number') {
    if (typeof S.setRecency === 'function') S.setRecency(live.recencyN);
    else S.recencyN = live.recencyN;
  }
  if (typeof live.nearestMode === 'boolean')      S.nearestMode      = live.nearestMode;
  if (['both', 'grains', 'tape'].includes(live.lensReads)) S.lensReads   = live.lensReads;
  if (typeof live.grainKAllMode === 'boolean')    S.grainKAllMode    = live.grainKAllMode;
  if (typeof live.grainKSeqMode === 'boolean')    S.grainKSeqMode    = live.grainKSeqMode;
  if (live.grainOverrides && typeof live.grainOverrides === 'object') {
    S.grainOverrides = { ...live.grainOverrides };
  }
  if (typeof live.grainProbability === 'number')  S.grainProbability = live.grainProbability;
  if (typeof live.scanFadeS === 'number')         S.scanFadeS        = live.scanFadeS;
  // 'trace+loop' was cut 2026-09-05; a file carrying it reads as scratch.
  if (typeof live.traceMode === 'string')         S.traceMode        = live.traceMode === 'trace+cloud' ? 'trace+cloud' : 'trace';
  // Per-field, and validated: the gate divides by hysteresis and multiplies by
  // radius every tick, so a hand-edited file putting a string in either would
  // turn every comparison into NaN and silently kill the whole trigger set.
  if (live.triggerParams && typeof live.triggerParams === 'object') {
    const tp = S.triggerParams, f = live.triggerParams;
    if (typeof f.hysteresis === 'number') tp.hysteresis = Math.max(1, Math.min(3, f.hysteresis));
    if (typeof f.rearmMs    === 'number') tp.rearmMs    = Math.max(0, Math.min(5000, f.rearmMs));
    if (typeof f.volume     === 'number') tp.volume     = Math.max(0, Math.min(1, f.volume));
    if (typeof f.speed      === 'number') tp.speed      = Math.max(0.25, Math.min(4, f.speed));
    if (['oneshot', 'loop', 'grain'].includes(f.dwell)) tp.dwell = f.dwell;
    if (['top', 'touch', 'ends'].includes(f.start))  tp.start   = f.start;
    if (['cut', 'layer'].includes(f.retrig))         tp.retrig  = f.retrig;
    if (typeof f.chop === 'number')  tp.chop = Math.max(0, Math.min(2000, f.chop));
    if (typeof f.chopOn === 'boolean') tp.chopOn = f.chopOn;
    if (['play-to-end', 'fade'].includes(f.release)) tp.release = f.release;
  }
  if (typeof live.commitMode === 'string')        S.commitMode       = live.commitMode;
  if (typeof live.commitSlotCount === 'number')   S.commitSlotCount  = live.commitSlotCount;
  if (typeof live.commitOverflow === 'string')    S.commitOverflow   = live.commitOverflow;
  // v13 renamed `closest` to `nearest` and deleted `farthest` (Ek, 2026-09-05).
  if (typeof live.selectionMode === 'string')
    S.selectionMode = ['oldest', 'farthest'].includes(live.selectionMode) ? live.selectionMode : 'nearest';
  if (typeof live.paintTickerMs === 'number' && S.paintTicker) {
    S.paintTicker.intervalMs = live.paintTickerMs;
  }
  // `paintAlignMs` (sessions before 2026-09-02) is ignored: the offset it
  // hand-set is derived from the stroke's brush now.
  // `live.pinGroups` is deliberately NOT read here — it is consumed in
  // applySessionPayload() step 5, before the slots exist. Do not "complete" the
  // block by adding it here as well: that would restore the groups twice and
  // reset every `muted` flag the arrangement was saved with.
  // `live.voicings` is skipped here for the same reason — step 4 needs it
  // before the particles that point at it exist.
  S._syncCommitUI?.();
  S._pinsDirty = true;
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
      overlay.className = 'dlg-overlay';
      overlay.innerHTML = `
        <div class="dlg-dialog">
          <div class="dlg-title">export</div>
          <p class="dlg-desc">Choose what to export:</p>
          <div class="dlg-btns" style="flex-direction:column;gap:8px;">
            <button class="dlg-btn export-choice" data-mode="settings" style="width:100%">
              setup
              <span style="display:block;font-size:10px;opacity:0.6;margin-top:2px">the rig — audio config, sensor cal, key/MIDI/OSC, mappings, tools, layout</span>
            </button>
            <button class="dlg-btn export-choice" data-mode="session" style="width:100%">
              session
              <span style="display:block;font-size:10px;opacity:0.6;margin-top:2px">the music — samples, particles, seeds, loops, the sound it was played on (includes audio)</span>
            </button>
            <button class="dlg-btn dlg-cancel" style="width:100%">cancel</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector('.dlg-cancel').addEventListener('click', () => overlay.remove());
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
            const desc = overlay.querySelector('.dlg-desc');
            const btns = overlay.querySelector('.dlg-btns');
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
              btns.innerHTML = '<button class="dlg-btn dlg-cancel" style="width:100%">close</button>';
              btns.querySelector('.dlg-cancel').addEventListener('click', () => overlay.remove());
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
          overlay.className = 'dlg-overlay';
          overlay.innerHTML = `
            <div class="dlg-dialog">
              <div class="dlg-title">importing session</div>
              <p class="dlg-desc">decoding audio...</p>
            </div>
          `;
          document.body.appendChild(overlay);

          try {
            await applySessionPayload(data);
            // Refresh all UI without reload — state is already in memory
            try {
              rebuildSampleListUI();
              S.updateSeedBanksUI?.();
              // Restore the sound the session was played on. v5+ carries the
              // resolved patch object (audit § E4); v11 a live snapshot — both
              // apply the same way. A v4-and-earlier file carried only a bank
              // index, and the bank is gone (2026-09-03): its material still
              // plays with its own voicings, and the live block stays as it is.
              if (data.patch) applyPresetObject(data.patch);
              // v3: live performance tweaks override the patch (audit C1)
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
              <p class="dlg-desc" style="opacity:0.75">
                This file also carried settings (pre-v${EXPORT_VERSION} format) —
                most of those apply on the next restart. Re-export to update it.
              </p>` : '';
            const summary = overlay.cloneNode(false);
            summary.className = 'dlg-overlay';
            summary.innerHTML = `
              <div class="dlg-dialog">
                <div class="dlg-title">session loaded</div>
                <p class="dlg-desc">
                  ${S.samples.length} sample(s), ${S.particles.length} particle(s),
                  ${S.commitSlots.filter(c => c && c.type === 'cloud').length} cloud(s),
                  ${S.commitSlots.filter(c => c && c.type === 'loop').length} loop(s)
                </p>
                ${waitingHtml}
                <div class="dlg-btns">
                  <button class="dlg-btn dlg-go">ok</button>
                </div>
              </div>
            `;
            document.body.appendChild(summary);
            summary.querySelector('.dlg-go').addEventListener('click', () => summary.remove());
            summary.addEventListener('click', (e) => { if (e.target === summary) summary.remove(); });
          } catch (e) {
            overlay.querySelector('.dlg-desc').textContent = 'import failed: ' + e.message;
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
  overlay.className = 'dlg-overlay';
  overlay.innerHTML = `
    <div class="dlg-dialog">
      <div class="dlg-title">import settings</div>
      <p class="dlg-desc">
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
      <div class="dlg-btns">
        <button class="dlg-btn dlg-cancel">cancel</button>
        <button class="dlg-btn dlg-go">import</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.dlg-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('.dlg-go').addEventListener('click', () => {
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
  overlay.className = 'dlg-overlay';
  overlay.innerHTML = `
    <div class="dlg-dialog">
      <div class="dlg-title">imported</div>
      <p class="dlg-desc">${html}<br><br>The page will reload to apply changes.</p>
      <div class="dlg-btns">
        <button class="dlg-btn dlg-go">reload</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.dlg-go').addEventListener('click', () => location.reload());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) location.reload(); });
}
