// ============================================================================
// PIECE — the document: save, save as, open
//
// A piece is the music: samples, takes, marks, pins, triggers, the sound it was
// played on and the performance state around it. It lives in one `.mubone` file
// (js/mubone-file.js holds the container), and mubone holds a path to it, so
// there is a Save distinct from a Save As.
//
// The rig is NOT in here (Ek, 2026-09-14). Audio devices, sensor calibration,
// key/MIDI/OSC bindings, the tool strip and the layout are per-machine, they
// live in localStorage, and export/import — which is what ui-export.js is now —
// is the right verb for carrying those to another machine. Opening a piece
// never rearranges the instrument you are holding.
//
// This replaces the JSON "session" file. That format went to v14 and carried
// its audio as undithered 16-bit PCM base64'd inside the JSON; none of its
// versions are read any more (Ek: nothing to migrate), so there is no version
// gate here beyond refusing a file from a future build, and no field in this
// module exists to be backward compatible with anything. The old format's
// version history is in docs/EXPORT-IMPORT-AUDIT-2026-08.md.
// ============================================================================

import { S, MAX_COMMITS } from './state.js';
import { ensureAudioContext } from './audio.js';
import { stampCartesian, killAllGrains, releaseSeqNodes } from './grain.js';
import { rebuildSampleListUI } from './ui-samples.js';
import { applyPresetObject, updatePlaybackControls, buildOverdubLayer } from './ui-presets.js';
import { snapshotCurrentState } from './param-registry.js';
import * as history from './history.js';
import { restoreTrigger, stopTriggerAudio } from './trigger.js';
import { exportGroups, restoreGroups, applyMix } from './pins.js';
import { exportVoicings, restoreVoicings } from './brush-voicing.js';
import {
  AudioTable, writePiece, readPiece,
  pathSink, pathSource, blobSink, blobSource,
} from './mubone-file.js';

export const PIECE_MAGIC   = 'mubone-piece';
export const PIECE_VERSION = 1;
const PIECE_EXT = '.mubone';

/** Is there a filesystem? The hosted demo has none — it saves by download. */
const onDisk = () => !!window.electronBridge?.docSaveDialog;


// ═════════════════════════════════════════════════════════════════════════════
// THE MANIFEST
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Pack one loop/trigger particle as a flat array. Only the four fields playback
 * and drawing actually read — a stroke can run to hundreds of particles and an
 * object per particle triples that part of the file for no gain.
 *
 * Values, never indices. Loop particles are DETACHED COPIES with rebased
 * grainStart and are not in S.particles at all, so the `indexOf` this replaces
 * wrote -1 for every one of them and every imported loop came back silent
 * (export audit § E9). Identity was never available to lean on here.
 */
function _packParticle(p) {
  return [p.lon, p.lat, p.grainStart, p.grainDuration];
}

/**
 * Everything the document holds except the audio itself. Each buffer is handed
 * to the AudioTable, which answers with the id of the member that will carry
 * it — the same buffer, or an identical one, gets one member.
 *
 * `particleWitness` writes the mark array as its length and version instead of
 * itself. Only the dirty check uses it, and only because the marks are the one
 * part of a piece big enough to be expensive: everything else here is a handful
 * of scalars. See quickSignature().
 */
function buildManifest(audio, { particleWitness = false } = {}) {
  return {
    _magic:    PIECE_MAGIC,
    _version:  PIECE_VERSION,
    _savedAt:  new Date().toISOString(),

    // ── The sound this was played on ──
    // A snapshot of the live parameter set, not a reference to a saved patch:
    // there is no bank to resolve against, and a piece has to be self-contained.
    patch: snapshotCurrentState(),

    // ── Samples (audio + metadata) ──
    samples: S.samples.map(s => ({
      name:      s.name,
      duration:  s.duration,
      cropStart: s.cropStart,
      cropEnd:   s.cropEnd,
      audio:     audio.idFor(s.buffer),
    })),

    // ── Live recording buffers ──
    liveBuffers: (S.liveRecBuffers || []).map(slot => ({
      audio: audio.idFor(slot.buffer || slot.liveBuffer),
    })),

    // ── Particles ──
    particles: particleWitness ? [S.particles.length, S._particleVersion | 0] : S.particles.map(p => ({
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
      // ABSENT IS NOT ZERO. `?? 0` here would write the number 0 for a mark
      // that has no tilt, and 0 is a legal value — the violet end of the arc —
      // so the renderer's own fallback could never fire across a file. JSON
      // drops an undefined key, which is exactly what the reader needs to see.
      tilt:          p.tilt,
      zcr:           p.zcr ?? 0,
      noise:         p.noise,
      // Trigger-vs-granular is a property of the material, so it travels with
      // the particle: without it a percussion map imports as granulation fodder.
      // Written only when true — it is absent on the large majority of marks and
      // this array is the biggest thing in the manifest.
      ...(p.trig ? { trig: 1 } : {}),
      // Which frozen brush voices this mark. Same "write only when set"
      // reasoning as `trig`: 0 means "follow the live params".
      ...(p._vo ? { vo: p._vo } : {}),
      // Path order for a looping sample trigger stroke (#247) — its grainStart
      // rewinds each pass, so without takeT the stroke re-meshes on open.
      ...(p.takeT !== undefined ? { takeT: p.takeT } : {}),
    })),

    // ── Pins (unified cloud + loop slots) ──
    commits: S.commitSlots.map(slot => {
      if (!slot) return null;
      if (slot.type === 'cloud') {
        return {
          type:              'cloud',
          slotIndex:         slot.slotIndex,
          // The pin's own two flags. Which GROUP it is in is not written —
          // that is `type`, four lines up (js/pins.js: audibility is derived).
          mute:              !!slot.mute,
          solo:              !!slot.solo,
          lon:               slot.lon,
          lat:               slot.lat,
          // Where the pin gesture released (pins.js pinAnchorInto).
          anchorLon:         slot.anchorLon,
          anchorLat:         slot.anchorLat,
          color:             slot.color,
          searchRadiusDeg:   slot.searchRadiusDeg,
          nearestMode:       slot.nearestMode,
          kAllMode:          slot.kAllMode,
          kSeqMode:          slot.kSeqMode,
          grainParams:       slot.grainParams,
          grainOverrides:    slot.grainOverrides,
          radiusFadeEnabled: slot.radiusFadeEnabled,
          radiusFadeCurve:   slot.radiusFadeCurve,
          _envAttack:        slot._envAttack,
          _envRelease:       slot._envRelease,
          // Composer mode can hold a cloud at silence with its slot intact.
          // Without these two the arrangement is lost and every pin comes back
          // sounding at once.
          playing:           slot.playing,
          _composerHold:     slot._composerHold,
          // Moving seed fields
          frames:            slot.frames,
          duration:          slot.duration,
          loopMode:          slot.loopMode,
        };
      }
      if (slot.type === 'loop') {
        return {
          type:          'loop',
          slotIndex:     slot.slotIndex,
          mute:          !!slot.mute,
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
          audio:         audio.idFor(slot.buffer),
          particles:     slot.particles.map(_packParticle),
          // The TAKES, not the layers — a layer is rebuilt from its take and
          // phase against the master on open (buildOverdubLayer), so a file
          // cannot carry a layer that disagrees with its master.
          overdubs:      (slot.overdubs || []).map(o => ({
            strokeId: o.strokeId,
            phase0:   o.phase0,
            audio:    audio.idFor(o.buffer),
          })),
        };
      }
      return null;
    }),

    // ── Triggers ──
    // A trigger is a VIEW onto a painted stroke, not an owner of material — its
    // particles are the live objects in S.particles and its buffer is the
    // stroke's source buffer, both of which the manifest already carries. So it
    // saves as a strokeId plus its own settings, and no audio: storing the audio
    // again would duplicate it AND let the two drift apart, which is the class
    // of bug that made loop slots import silent (§ E9).
    //
    // How a trigger is TOUCHED is global and live (dwell/start/release, in the
    // live block below). What it froze at arm time — speed, volume, passes —
    // belongs to the trigger itself, because the edit filter can change those
    // per stroke.
    triggers: (S.triggers || []).map(t => ({
      strokeId: t.strokeId,
      color:    t.color,
      speed:    t.speed,
      volume:   t.grainParams?.volume,
      passes:   t.passes,
      endCap:   t.endCap,   // a slice's cut at the next onset; absent on a plain line
    })),

    // ── Misc live state ──
    currentStrokeId: S.currentStrokeId,
    strokeIdCounter: S.strokeIdCounter,
    sourceKind:      S.sourceKind,
    samplerIndex:    S.samplerIndex,
    liveColorIndex:  S.liveColorIndex,

    // ── Live performance state ──
    // Everything audible-but-not-in-the-patch. Open re-applies the patch, so
    // without this block the piece would not sound like it did when it was
    // saved. Applied AFTER applyPresetObject. scanMuted is deliberately left
    // out — opening a piece into a muted scan reads as "the file is broken".
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
      // Each group's mute/solo. Read in applyManifest rather than applyLiveState
      // so that muting a restored group finds its pins.
      pinGroups:        exportGroups(),
      // The interned voicing table. Read back early — step 4 needs it before
      // the particles that point at it exist.
      voicings:         exportVoicings(),
    },
  };
}


// ═════════════════════════════════════════════════════════════════════════════
// OPENING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Rebuild the session from a manifest and the audio members it names.
 * `audio` is a Map of id → AudioBuffer, as readPiece returns it.
 */
async function applyManifest(data, audio) {
  // 0a. Validate shape BEFORE touching any state — a truncated or hand-edited
  // file must not leave a half-cleared session behind.
  if (data?._magic !== PIECE_MAGIC) throw new Error('not a mubone piece');
  if (typeof data._version === 'number' && data._version > PIECE_VERSION) {
    throw new Error(`this piece is version ${data._version}; this build reads up to v${PIECE_VERSION} — update mubone`);
  }
  for (const k of ['samples', 'liveBuffers', 'particles', 'commits']) {
    if (data[k] != null && !Array.isArray(data[k])) {
      throw new Error(`malformed piece: "${k}" is not an array`);
    }
  }
  // Opening mid-recording would swap liveRecBuffers out from under the recorder.
  if (S.isRecording) throw new Error('stop recording before opening a piece');

  const bufFor = (id) => (id ? audio.get(id) || null : null);

  // 0b. Teardown the current session:
  //  - history.clear(): undo entries name the old world; ⌘Z after an open must
  //    not splice pre-open arrays into post-open engine state.
  //  - killAllGrains(): stops in-flight main-thread grain nodes.
  //  - releaseSeqNodes(): stops playing loops FULLY (source + gain + VBAP
  //    fan-out) — overwriting the slot without this left the old loop sounding
  //    forever with nothing referencing it.
  // (Worklet grains are handled by _reloadWorkletEngine at the end.)
  history.clear();
  killAllGrains();
  for (let i = 0; i < MAX_COMMITS; i++) {
    const slot = S.commitSlots[i];
    if (slot && slot.type === 'loop') releaseSeqNodes(slot);
    S.commitSlots[i] = null;
  }
  S.strokeHistory = [];

  // 1. Samples
  S.samples.length = 0;
  for (const s of (data.samples || [])) {
    const buf = bufFor(s.audio);
    S.samples.push({
      buffer:      buf,
      name:        s.name,
      duration:    buf ? buf.duration : s.duration,
      grainCursor: 0,
      cropStart:   s.cropStart ?? 0,
      cropEnd:     s.cropEnd ?? 1,
    });
  }

  // 2. Live buffers
  S.liveRecBuffers = [];
  for (const slot of (data.liveBuffers || [])) {
    S.liveRecBuffers.push({ buffer: bufFor(slot.audio), liveBuffer: null, grainCursor: 0 });
  }

  // 3. Particles
  //
  // Voicings first: the particles about to be built carry `vo` ids that have to
  // resolve against THIS file's table, not the previous session's. Keeping every
  // restore in front of the things that reference it is the rule worth having.
  restoreVoicings(data.live?.voicings);

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
      tilt:          p.tilt,       // absent is not zero — see buildManifest
      zcr:           p.zcr ?? 0,
      noise:         p.noise,
    };
    if (p.source === 'sample') particle.sampleIndex = p.sampleIndex;
    if (p.source === 'live')   particle.liveBufferIdx = p.liveBufferIdx;
    if (p.trig)                particle.trig = true;   // trigger material, never granulated
    if (typeof p.takeT === 'number') particle.takeT = p.takeT;
    particle._vo = typeof p.vo === 'number' ? p.vo : 0;
    stampCartesian(particle);
    S.particles.push(particle);
  }
  S._particleVersion = (S._particleVersion || 0) + 1;

  // 4. Pins (unified cloud + loop slots)
  //
  // The two groups' flags go in before the slots, so a restored `muted` flag is
  // in place before the pins it applies to appear.
  restoreGroups(data.live?.pinGroups);

  for (let i = 0; i < MAX_COMMITS; i++) {
    const c = data.commits?.[i];
    if (!c) { S.commitSlots[i] = null; continue; }

    if (c.type === 'cloud') {
      S.commitSlots[i] = {
        type:              'cloud',
        slotIndex:         c.slotIndex,
        mute:              !!c.mute,
        solo:              !!c.solo,
        lon:               c.lon,
        lat:               c.lat,
        anchorLon:         c.anchorLon,
        anchorLat:         c.anchorLat,
        color:             c.color,
        searchRadiusDeg:   c.searchRadiusDeg,
        nearestMode:       c.nearestMode,
        kAllMode:          c.kAllMode,
        kSeqMode:          c.kSeqMode,
        grainParams:       c.grainParams,
        grainOverrides:    c.grainOverrides ?? {},
        morphT:            0.5,
        morphVelocity:     0,
        radiusFadeEnabled: c.radiusFadeEnabled,
        radiusFadeCurve:   c.radiusFadeCurve,
        _lastFiredAt:      0,
        _nextPeriodMs:     0,
        _plantedAt:        performance.now() / 1000,
        _releasingAt:      0,
        _envAttack:        c._envAttack ?? 0,
        _envRelease:       c._envRelease ?? 0,
        // A cloud held silent by composer mode comes back held, not sounding.
        // Only an explicit false holds; undefined means playing.
        playing:           c.playing === false ? false : undefined,
        _composerHold:     c.playing === false,
        _envGainCurrent:   c.playing === false ? 0 : 1,
        frames:            c.frames,
        duration:          c.duration ?? 0,
        loopMode:          c.loopMode ?? 'pingpong',
        _playheadMs:       0,
        _pingForward:      true,
      };
    } else if (c.type === 'loop') {
      const buf = bufFor(c.audio);
      const particles = (c.particles || []).map(a => ({ lon: a[0], lat: a[1], grainStart: a[2], grainDuration: a[3] }));

      S.commitSlots[i] = {
        type:          'loop',
        slotIndex:     c.slotIndex,
        mute:          !!c.mute,
        solo:          !!c.solo,
        strokeId:      c.strokeId,
        color:         c.color,
        anchorLon:     c.anchorLon,
        anchorLat:     c.anchorLat,
        speed:         c.speed ?? 1,
        direction:     c.direction ?? 1,
        playing:       false, // starts stopped — the performer starts it
        // Carried so the mute survives: when the performer does start it, it
        // starts in the state the arrangement was saved in.
        composerMuted: !!c.composerMuted,
        playheadIndex: c.playheadIndex ?? 0,
        startOffset:   c.startOffset ?? 0,
        loopStart:     c.loopStart ?? 0,
        loopEnd:       c.loopEnd ?? (buf ? buf.duration : 0),
        grainParams:   c.grainParams ?? { volume: 1 },
        buffer:        buf,
        particles,
        _sourceNode:   null,
        _gainNode:     null,
        _revBuffer:    null,
        _startedAt:    0,
      };
      // The family. Each take's layer is rebuilt against THIS slot's cycle;
      // the layers start with the master's source (grain.js).
      if (Array.isArray(c.overdubs) && c.overdubs.length) {
        const seq = S.commitSlots[i];
        seq.overdubs = [];
        for (const o of c.overdubs) {
          const tb = bufFor(o?.audio);
          if (!tb) continue;
          const layer = buildOverdubLayer(seq, tb, +o.phase0 || 0);
          if (layer) seq.overdubs.push({ strokeId: o.strokeId, phase0: +o.phase0 || 0, buffer: tb, layer, _src: null });
        }
      }
    } else {
      S.commitSlots[i] = null;
    }
  }

  // 4a. The mix: every restored pin's engine state follows its flags and its
  // group's, now that both halves are in place (js/pins.js).
  applyMix();

  // 4b. Triggers. Restored through trigger.js so the particle lookup, Cartesian
  // stamps, bounding cap and playback region are all derived by the same code
  // the live path uses — a trigger carries no audio of its own, so this is the
  // only thing that makes it playable again.
  if (S.triggers) {
    for (const t of S.triggers) stopTriggerAudio(t, 'fade');
    S.triggers.length = 0;
  }
  for (const c of (data.triggers || [])) restoreTrigger(c);
  S._syncTriggerUI?.();

  // 5. Misc state
  if (typeof data.currentStrokeId === 'number') S.currentStrokeId = data.currentStrokeId;
  if (data.sourceKind === 'live' || data.sourceKind === 'sampler') S.sourceKind = data.sourceKind;
  if (typeof data.samplerIndex === 'number' && data.samplerIndex >= 0) S.samplerIndex = data.samplerIndex;
  if (typeof data.liveColorIndex === 'number') S.liveColorIndex = data.liveColorIndex;

  // 5a. Stroke-id continuity. Recency ranks by strokeId and undo filters by it
  // — if the counter restarts below the opened ids, every new stroke ranks
  // OLDER than the material in the piece (inaudible under recency) and undo of
  // a new stroke deletes marks sharing its id.
  let maxSid = typeof data.strokeIdCounter === 'number' ? data.strokeIdCounter : 0;
  for (const p of S.particles) if (p.strokeId > maxSid) maxSid = p.strokeId;
  for (const c of S.commitSlots) {
    if (c && typeof c.strokeId === 'number' && c.strokeId > maxSid) maxSid = c.strokeId;
  }
  if (maxSid > S.strokeIdCounter) S.strokeIdCounter = maxSid;

  // 6. Refresh the worklet's buffer map.
  // The worklet keys its _bufferMap on AudioBuffer object identity. Steps 1–2
  // swapped in fresh AudioBuffers, so every candidate's audioBuf lookup now
  // misses → all candidates filtered out → the cursor enters particle radii but
  // no grains fire (marks still render). Stop+start rebuilds _bufferMap from
  // the opened S.samples / S.liveRecBuffers via startWorkletGrain.
  await S._reloadWorkletEngine?.();
}

/**
 * Apply the `live` block — performance state that isn't part of the patch.
 * MUST run after applyPresetObject, since the patch overwrites the grain block.
 */
function applyLiveState(live) {
  if (!live || typeof live !== 'object') return;
  if (typeof live.searchRadiusDeg === 'number') S.searchRadiusDeg = live.searchRadiusDeg;
  if (typeof live.recencyN === 'number') {
    if (typeof S.setRecency === 'function') S.setRecency(live.recencyN);
    else S.recencyN = live.recencyN;
  }
  if (typeof live.nearestMode === 'boolean')   S.nearestMode   = live.nearestMode;
  if (['both', 'grains', 'tape'].includes(live.lensReads)) S.lensReads = live.lensReads;
  if (typeof live.grainKAllMode === 'boolean') S.grainKAllMode = live.grainKAllMode;
  if (typeof live.grainKSeqMode === 'boolean') S.grainKSeqMode = live.grainKSeqMode;
  if (live.grainOverrides && typeof live.grainOverrides === 'object') {
    S.grainOverrides = { ...live.grainOverrides };
  }
  if (typeof live.grainProbability === 'number') S.grainProbability = live.grainProbability;
  if (typeof live.scanFadeS === 'number')        S.scanFadeS        = live.scanFadeS;
  if (['trace', 'trace+cloud'].includes(live.traceMode)) S.traceMode = live.traceMode;
  // Per-field, and validated: the gate divides by hysteresis and multiplies by
  // radius every tick, so a hand-edited file putting a string in either would
  // turn every comparison into NaN and silently kill the whole trigger set.
  if (live.triggerParams && typeof live.triggerParams === 'object') {
    const tp = S.triggerParams, f = live.triggerParams;
    if (typeof f.hysteresis === 'number') tp.hysteresis = Math.max(1, Math.min(3, f.hysteresis));
    if (typeof f.rearmMs    === 'number') tp.rearmMs    = Math.max(0, Math.min(5000, f.rearmMs));
    if (typeof f.volume     === 'number') tp.volume     = Math.max(0, Math.min(1, f.volume));
    if (typeof f.speed      === 'number') tp.speed      = Math.max(0.25, Math.min(4, f.speed));
    if (['oneshot', 'loop', 'grain'].includes(f.dwell)) tp.dwell   = f.dwell;
    if (['top', 'touch', 'ends'].includes(f.start))     tp.start   = f.start;
    if (['cut', 'layer'].includes(f.retrig))            tp.retrig  = f.retrig;
    if (typeof f.chop === 'number')    tp.chop   = Math.max(0, Math.min(2000, f.chop));
    if (typeof f.chopOn === 'boolean') tp.chopOn = f.chopOn;
    if (['play-to-end', 'fade'].includes(f.release))    tp.release = f.release;
  }
  if (typeof live.commitMode === 'string')      S.commitMode      = live.commitMode;
  if (typeof live.commitSlotCount === 'number') S.commitSlotCount = live.commitSlotCount;
  if (typeof live.commitOverflow === 'string')  S.commitOverflow  = live.commitOverflow;
  if (['nearest', 'oldest'].includes(live.selectionMode)) S.selectionMode = live.selectionMode;
  if (typeof live.paintTickerMs === 'number' && S.paintTicker) {
    S.paintTicker.intervalMs = live.paintTickerMs;
  }
  // `live.pinGroups` is deliberately NOT read here — it is consumed in
  // applyManifest step 4, before the slots exist. Do not "complete" the block by
  // adding it here as well: that would restore the groups twice and reset every
  // mute flag the arrangement was saved with. `live.voicings` is skipped for the
  // same reason — step 3 needs it before the particles that point at it exist.
  S._syncCommitUI?.();
  S._pinsDirty = true;
}

/** The UI that has to follow a piece into place. */
function refreshAfterOpen(manifest) {
  try {
    rebuildSampleListUI();
    S.updateSeedBanksUI?.();
    // The sound the piece was played on, then the live block over it.
    if (manifest.patch) applyPresetObject(manifest.patch);
    applyLiveState(manifest.live);
    updatePlaybackControls?.();
    S._syncImprovUI?.();
    S.syncGrainControlsUI?.();
    S._syncRadiusFadeUI?.();
  } catch (e) {
    console.warn('[piece] UI refresh after open:', e);
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// THE CURRENT DOCUMENT
// ═════════════════════════════════════════════════════════════════════════════

// What is open: its path (Electron only), the name to show, and the signature
// the document had when it was last written or opened. Path and name are null
// until a piece is saved — an unsaved piece has no name, so Save is a Save As
// until it does.
S.doc = { path: null, name: null, savedSig: null, savedQuick: null };

// ── Dirty ───────────────────────────────────────────────────────────────────
//
// Nothing runs on a timer (Ek, 2026-09-14: "this a performance app i dont want
// it to try to save every 2 min or something. it needs to be peak performance").
// The document's state is read only when something is about to depend on it:
// ⌘S, an open, a quit, or the window losing focus so the chrome's mark is right
// when you look away from the sphere. While you play, this costs nothing.
//
// The signature IS the manifest — hashed, not stored — which is why it cannot go
// stale as the document grows: a field that is saved is a field that is signed.
// Audio counts by IDENTITY here rather than by content, because hashing a
// half-hour take to answer "is there anything to save" would be absurd; the
// frame count rides along so a take that grew in place still reads as changed.

class IdentityTable {
  constructor() { this.seen = new WeakMap(); this.n = 0; }
  idFor(buf) {
    if (!buf) return null;
    let id = this.seen.get(buf);
    if (!id) { id = `#${++this.n}`; this.seen.set(buf, id); }
    return `${id}:${buf.length}`;
  }
}

function hashString(str) {
  let h1 = 0x811c9dc5 | 0, h2 = 0x01000193 | 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 + c, 0x85ebca6b) ^ (h1 >>> 15);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

/**
 * What the document holds right now. Exact, and it costs what the marks cost:
 * 1.6 ms at a thousand, 11.6 at ten thousand, 101 at thirty thousand on a loaded
 * instance. Used where the answer must be right and a pause costs nothing — the
 * quit guard, which is all that stands between a set and the bin.
 */
export function documentSignature() {
  const m = buildManifest(new IdentityTable());
  delete m._savedAt;      // the clock is not a change
  return hashString(JSON.stringify(m));
}

/**
 * The same question, answered in 0.05 ms at thirty thousand marks (measured) —
 * two thousand times cheaper, because the marks are counted rather than read.
 * Everything else is still exact: the patch, every pin, every trigger, the whole
 * live block, so a knob moved with nothing painted still shows.
 *
 * It is the mark array alone that is approximated, by the pair renderer.js
 * already trusts as its own cache key: a push, a removal, an erase and a colour
 * repair all move `_particleVersion` or the length. What it could miss is a mark
 * edited in place by code that bumps neither — which is why the exact signature,
 * not this one, is what the quit guard asks.
 */
export function quickSignature() {
  const m = buildManifest(new IdentityTable(), { particleWitness: true });
  delete m._savedAt;
  return hashString(JSON.stringify(m));
}

/**
 * Is there anything in the document at all — a take, a sample, a mark, a pin?
 * A patch is not material: every knob has a value at all times, so a session
 * that has never been played is not half a piece, it is no piece.
 */
function hasMaterial() {
  return S.particles.length > 0
    || S.samples.length > 0
    || (S.liveRecBuffers || []).some(b => b && (b.buffer || b.liveBuffer))
    || (S.commitSlots || []).some(Boolean);
}

/**
 * Is there anything to save?
 *
 * An untitled session with nothing in it is never dirty, whatever the signature
 * says. Measured, and this is why the rule exists: the app goes on settling
 * after the document takes its baseline — params land, the strip loads — so a
 * freshly booted mubone compared dirty against itself and would have put a save
 * prompt in front of every quit. None of that drift is an edit, and with no
 * material there is nothing a save could preserve.
 *
 * A piece that HAS a path is compared honestly either way: opening one and
 * erasing it back to nothing is a change worth being asked about.
 */
export function isDirty({ quick = false } = {}) {
  try {
    if (!S.doc.path && !hasMaterial()) return false;
    return quick ? quickSignature() !== S.doc.savedQuick
                 : documentSignature() !== S.doc.savedSig;
  } catch (_) { return true; }   // never claim clean when the answer is unknown
}

function markSaved() {
  try {
    S.doc.savedSig   = documentSignature();
    S.doc.savedQuick = quickSignature();
  } catch (_) { S.doc.savedSig = null; S.doc.savedQuick = null; }
}


// ── The chrome's readout ────────────────────────────────────────────────────

/**
 * The piece's name sits after the version in the brand line, in the same
 * engraved lettering — the case's engraving, not a headline. The unsaved mark is
 * a DOT that is there or is not; nothing is dimmed to mean anything.
 */
export function syncDocChrome() {
  const el = document.getElementById('docName');
  const dirty = isDirty({ quick: true });
  if (el) {
    const name = S.doc.name || (dirty ? 'untitled' : '');
    el.textContent = name;
    el.hidden = !name;
    el.classList.toggle('is-dirty', !!name && dirty);
  }
  // macOS knows how to show a document: the window title, the proxy icon for
  // the file itself, and the dot in the close button. Free, and right even when
  // the chrome is hidden in fullscreen.
  window.electronBridge?.docSetState?.({
    name: S.doc.name || null,
    path: S.doc.path || null,
    dirty,
  });
}
S._syncDocUI = syncDocChrome;

function nameFromPath(p) {
  const base = String(p).split(/[\\/]/).pop();
  return base.endsWith(PIECE_EXT) ? base.slice(0, -PIECE_EXT.length) : base;
}

function defaultName() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
}


// ═════════════════════════════════════════════════════════════════════════════
// SAVE · SAVE AS · OPEN
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Write the piece to `path`, or — in the browser demo, which has no path — hand
 * back a download. The manifest is built first and the audio streamed after it,
 * so nothing holds the whole document in memory at once.
 */
async function writeTo(path, statusFn) {
  // A recording in flight would save as a slot with no audio, and its marks
  // would be permanently silent in the file. Finish it first.
  if (S.isRecording) throw new Error('stop recording before saving');

  statusFn?.('collecting…');
  const audio = new AudioTable();
  const manifest = buildManifest(audio);

  statusFn?.(audio.size === 1 ? 'writing 1 take…' : `writing ${audio.size} takes…`);
  // Yield once so the status actually paints before the write blocks on audio.
  await new Promise(r => setTimeout(r, 0));

  if (path) {
    await writePiece(manifest, audio, await pathSink(path));
    return path;
  }
  const blob = await writePiece(manifest, audio, blobSink());
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `${S.doc.name || defaultName()}${PIECE_EXT}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return null;
}

/** Save As — always asks for a path, then remembers it. */
export async function savePieceAs(statusFn) {
  let path = null;
  if (onDisk()) {
    const r = await window.electronBridge.docSaveDialog({
      defaultPath: S.doc.path || `${S.doc.name || defaultName()}${PIECE_EXT}`,
    });
    if (r?.canceled) return null;
    path = r.path;
  }
  const written = await writeTo(path, statusFn);
  if (written) { S.doc.path = written; S.doc.name = nameFromPath(written); rememberRecent(written); }
  else if (!S.doc.name) S.doc.name = defaultName();
  markSaved();
  S._syncDocUI?.();
  return S.doc.path || S.doc.name;
}

/** Save — straight to the known path; a piece with no path gets the dialog. */
export async function savePiece(statusFn) {
  if (!S.doc.path) return savePieceAs(statusFn);
  await writeTo(S.doc.path, statusFn);
  rememberRecent(S.doc.path);   // a save is a use: the list is most-recent-first
  markSaved();
  S._syncDocUI?.();
  return S.doc.path;
}

/** Open — the dialog, then the file, then the session it describes. */
export async function openPiece(statusFn) {
  let source = null, path = null;
  if (onDisk()) {
    const r = await window.electronBridge.docOpenDialog({ defaultPath: S.doc.path || undefined });
    if (r?.canceled) return null;
    path = r.path;
    source = await pathSource(path);
  } else {
    const file = await pickPieceFile();
    if (!file) return null;
    source = blobSource(file);
    path = null;
    S.doc.name = file.name.endsWith(PIECE_EXT) ? file.name.slice(0, -PIECE_EXT.length) : file.name;
  }

  statusFn?.('reading…');
  const { manifest, audio } = await readPiece(source, ensureAudioContext());
  statusFn?.('opening…');
  await applyManifest(manifest, audio);
  refreshAfterOpen(manifest);

  if (path) { S.doc.path = path; S.doc.name = nameFromPath(path); rememberRecent(path); }
  markSaved();
  S._syncDocUI?.();
  return manifest;
}

/** Open a path directly — the recent list and a double-clicked file. */
export async function openPieceAt(path, statusFn) {
  statusFn?.('reading…');
  const { manifest, audio } = await readPiece(await pathSource(path), ensureAudioContext());
  statusFn?.('opening…');
  await applyManifest(manifest, audio);
  refreshAfterOpen(manifest);
  S.doc.path = path;
  S.doc.name = nameFromPath(path);
  rememberRecent(path);
  markSaved();
  S._syncDocUI?.();
  return manifest;
}

/**
 * New — an empty piece. Deliberately the same teardown an open runs, against an
 * empty manifest, rather than a second "clear everything" written by hand: the
 * one that is exercised on every open is the one that is right.
 */
export async function newPiece() {
  await applyManifest({ _magic: PIECE_MAGIC, _version: PIECE_VERSION }, new Map());
  S.doc.path = null;
  S.doc.name = null;
  markSaved();
  S._syncDocUI?.();
  return true;
}

function pickPieceFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = PIECE_EXT;
    input.addEventListener('change', () => resolve(input.files?.[0] || null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// THE RECENT LIST, AND WHAT THE MAIN PROCESS ASKS
// ═════════════════════════════════════════════════════════════════════════════

const LS_RECENT = 'mubone_recent_pieces';
const RECENT_MAX = 8;

function readRecent() {
  try { const v = JSON.parse(localStorage.getItem(LS_RECENT) || '[]'); return Array.isArray(v) ? v : []; }
  catch (_) { return []; }
}

function rememberRecent(path) {
  if (!path) return;
  const list = [path, ...readRecent().filter(p => p !== path)].slice(0, RECENT_MAX);
  try { localStorage.setItem(LS_RECENT, JSON.stringify(list)); } catch (_) {}
  window.electronBridge?.docSetRecent?.(list);
}

/**
 * The File menu, the quit guard and a double-clicked file all live in the main
 * process, which cannot reach the module graph — so the document answers on
 * `window`. Three questions, and they are the whole surface:
 *
 *   __mubonePiece.state()  is there anything to save, and what is it called
 *   __mubonePiece.save()   write it (may open a dialog); false if cancelled
 *   __mubonePiece.run(cmd) a File menu item, or an opened file
 *
 * The quit guard asks state() at the moment of the quit rather than reading a
 * flag pushed earlier, so the answer is never one edit stale.
 */
export function initPieceBridge() {
  markSaved();                                   // the empty session is the baseline
  window.electronBridge?.docSetRecent?.(readRecent());
  syncDocChrome();

  window.__mubonePiece = {
    state: () => ({ dirty: isDirty(), name: S.doc.name, path: S.doc.path }),
    save:  async () => !!(await savePiece()),
    run:   async (cmd, arg) => {
      if (cmd === 'new')      return newPiece();
      if (cmd === 'open')     return !!(await openPiece());
      if (cmd === 'open-at')  return !!(await openPieceAt(arg));
      if (cmd === 'save')     return !!(await savePiece());
      if (cmd === 'save-as')  return !!(await savePieceAs());
      return false;
    },
  };

  // THE MARK HAS TO APPEAR WHILE YOU PLAY (Ek, 2026-09-14: "once i open or change
  // the doc, if it's already saved as, can there be an indication … to show that
  // new things aren't saved?"). It did not: the first build refreshed only at a
  // save, an open and a window blur, because the exact signature costs 101 ms at
  // thirty thousand marks and that is ten scheduler ticks. An indication you
  // only see after clicking away is not an indication.
  //
  // quickSignature() is what makes the poll affordable — 0.05 ms, measured on a
  // loaded instance — so this is 0.01% of one core at 2 Hz, against a render
  // loop that spends 33 ms a frame. Half a second is under the threshold where
  // a change feels like it registered, and the dot lands within one stroke.
  //
  // It is deliberately NOT event-driven. Seams leak: the document's state has no
  // single mutation point — every knob writes its own field — so a mark driven
  // by the seams anyone remembered to call would go on saying "saved" after the
  // one they forgot. Reading the document is the only honest way to know.
  setInterval(() => { try { syncDocChrome(); } catch (_) {} }, 500);
}


// Test seams. scripts/pins-audit.js round-trips a piece through these rather
// than through a file, so the pin restore rules can be asserted end to end
// without a filesystem. The audio table comes back with the manifest because
// the audio no longer travels inside it.
export function __testBuildPiece() {
  const audio = new AudioTable();
  return { manifest: buildManifest(audio), audio: audio.byId };
}
export const __testApplyPiece = (manifest, audio) => applyManifest(manifest, audio || new Map());
