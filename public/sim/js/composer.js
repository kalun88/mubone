// ============================================================================
// composer.js — composer mode: latch-toggle commits by cursor proximity
//
// Design + reasoning: docs/archive/COMPOSER-MODE-PLAN.md. The short version:
//
//   • Composer mode is a LATCHED mode. While it is on, scan is muted and the
//     cursor toggles any commit it reaches: playing → silent, silent → playing.
//   • The gate is an ENTER EDGE with hysteresis and a rearm window. A latch
//     makes those load-bearing: with a momentary gate, boundary chatter is a
//     glitch you forget; with a latch it toggles twice and the error persists.
//   • Loops are MUTED, never stopped — the source keeps running so unmuting
//     drops you where the loop would have been, not at the top (§0 of the
//     plan). Clouds are stopped with their existing fade in/out envelope,
//     which is a different verb on different machinery.
//   • Commits only. Triggers are deliberately out of scope: a trigger owns
//     nothing, it is a view onto a stroke, and latching one would fight that.
//
// The gate runs from the 20 ms scheduler tick, so everything in the hot path
// is allocation-free and leans on the same cached-cartesian bounding cap the
// trigger tool uses.
// ============================================================================

import { S } from './state.js';
import { stampCartesian } from './grain.js';
import { togglePinMute, allOn } from './pins.js';

// Ramp for a composer mute/unmute. Long enough not to click, short enough that
// the gesture feels immediate. The 3 ms start declick is for a source opening
// mid-waveform; a mute is a level change on running audio and wants more.
const MUTE_RAMP_S = 0.02;

// ── Loop mute ───────────────────────────────────────────────────────────────

/** Mute or unmute a loop slot without stopping it. IMMEDIATE, both ways
 *  (2026-09-05): the source keeps running and the mute node ramps over 20 ms.
 *  Waiting for the loop boundary is not a mute, it is a RELEASE — that lives
 *  in ui-presets.js `_stopSeqAudio` under `S.loopReleaseMode`, and until
 *  2026-09-05 the rail's mute borrowed it (`atBoundary`), which is why a muted
 *  loop kept playing to the end of its pass. The resume modes (`touch`,
 *  `top`) went with the arrange sheet in 2026-08; `continue` — the DJ mute,
 *  back exactly where it would have been — is the only one. */
export function setLoopMuted(seq, muted) {
  if (!seq || seq.type !== 'loop') return false;
  seq.composerMuted = !!muted;

  const g = seq._muteGain, actx = S.audioCtx;
  // No live node yet (slot not sounding, or audio not up). The flag still
  // stands — the node reads composerMuted when it is built.
  if (!g || !actx) return true;

  const now = actx.currentTime;
  g.gain.cancelScheduledValues(now);
  // Hold whatever the ramp had reached, or a cancel mid-ramp jumps.
  g.gain.setValueAtTime(g.gain.value, now);
  g.gain.linearRampToValueAtTime(muted ? 0 : 1, now + MUTE_RAMP_S);
  return true;
}

// ── Cloud stop ──────────────────────────────────────────────────────────────

/** Stop or start a cloud. Unlike a loop there is no continuous source and no
 *  place to lose, so this rides the commit attack/release envelope the cloud
 *  already has. The critical difference from uprooting: the release ramp HOLDS
 *  at zero and the slot survives (grain.js checks _composerHold before the
 *  branch that nulls the slot). */
export function setCloudPlaying(seed, playing) {
  if (!seed || seed.type !== 'cloud') return false;

  if (playing) {
    if (seed.playing !== false) return false;       // already on
    seed.playing         = true;
    seed._composerHold   = false;
    seed._releasingAt    = 0;
    // IMMEDIATE (2026-09-05): a mute is a mute. The cloud's fade in belongs
    // to the pin gesture and its fade out to the release (unpin); neither is
    // re-run here, so an unmute is heard on the next tick.
    seed._envAttack      = 0;
    seed._envGainCurrent = 1;
    return true;
  }

  if (seed.playing === false || seed._composerHold) return false;   // already off
  // Stop scheduling now; grains already in flight finish their own envelopes,
  // so there is no click. `_composerHold` is what grain.js reads to keep the
  // slot rather than delete it; `_releasingAt` stays 0 so no ramp is pending.
  seed._envRelease     = 0;
  seed._releasingAt    = 0;
  seed._composerHold   = true;
  seed.playing         = false;
  seed._envGainCurrent = 0;
  return true;
}

// ── Particle marks — showing mute state on the SPHERE ───────────────────────
// The panel says which commits are silent, but the sphere is what you look at
// while playing, so the material itself has to say it too: a muted loop's
// painted stroke renders grey.
//
// Keyed on strokeId, NOT on the particle objects a loop holds. Those are
// deliberately copies — buildLoopPayload() spreads each particle to rebase its
// grainStart against the extracted, crossfaded loop buffer, so a loop owns a
// rebased snapshot rather than the live objects. Marking them would mark
// nothing you can see. What IS on screen is the painted stroke in S.particles,
// and strokeId is the link back to it.
//
// A stroke greys only when EVERY loop on it is muted. dropSeqFromCursor()
// deliberately allows a second playhead on the same buffer, and one muted
// playhead does not make the material silent.
//
// BOTH commit types take part, but they claim material differently: a loop
// claims its stroke, a cloud claims whatever is inside its radius. A particle
// greys only when EVERY commit claiming it is silent — a stopped cloud sitting
// over a playing loop's stroke must not grey material you can still hear.
//
// Self-healing rather than push-based: a signature over the muted set is
// recomputed each frame (≤16 slots, integer maths) and the marks are rebuilt
// only when it moves. Push-based marking would need a call in every path that
// can destroy or rebuild a commit — release, clear-all, undo, erase, import —
// and the failure mode is grey material left behind on a stroke that is
// playing perfectly well.
let _marksSig = -1;
let _anyMarked = false;
// Claim counters, grown on demand. Two passes would need two Sets per commit;
// counting is one pass and answers the overlap question directly.
let _claimBuf = new Uint8Array(0), _silentBuf = new Uint8Array(0);

export function syncParticleMarks() {
  let sig = (S._particleVersion | 0) * 131;
  for (let i = 0; i < S.commitSlotCount; i++) {
    const c = S.commitSlots[i];
    if (!c) continue;
    sig += (i + 1) * (isCommitOn(c) ? 31 : 7919);
    // An overdub attaching or leaving moves the claim set without touching
    // the particle version.
    if (c.overdubs) sig += (i + 1) * 977 * c.overdubs.length;
  }
  if (sig === _marksSig) return _anyMarked;
  _marksSig = sig;

  const ps = S.particles, n = ps.length;
  if (_claimBuf.length < n) {
    _claimBuf  = new Uint8Array(n);
    _silentBuf = new Uint8Array(n);
  }

  // A LOOP claims its stroke. Keyed on strokeId and not on the particle objects
  // the loop holds: buildLoopPayload() spreads each particle into a NEW object
  // to rebase grainStart against the extracted loop buffer, so a loop owns a
  // snapshot and marking it would colour nothing you can see.
  const loopTotal = new Map(), loopSilent = new Map();
  // A CLOUD claims what is inside its radius. Its position is its current one,
  // which is exact even for a moving cloud: a stopped cloud's playhead does not
  // advance (the scheduler skips it), so a silent moving cloud is frozen where
  // it stopped and that IS the material it was playing.
  const clouds = [];
  let anyCommit = false;

  for (let i = 0; i < S.commitSlotCount; i++) {
    const c = S.commitSlots[i];
    if (!c) continue;
    const silent = !isCommitOn(c);
    if (c.type === 'loop') {
      if (c.strokeId == null) continue;
      anyCommit = true;
      loopTotal.set(c.strokeId, (loopTotal.get(c.strokeId) || 0) + 1);
      if (silent) loopSilent.set(c.strokeId, (loopSilent.get(c.strokeId) || 0) + 1);
      // An overdub is a LAYER on the master's gain, so it is silent when the
      // master is; its stroke greys with it (Ek, 2026-09-05: "the overdubs
      // should as well"). A take still recording has no stroke to claim yet.
      if (c.overdubs) for (const ov of c.overdubs) {
        if (!(ov.strokeId > 0) || ov.live) continue;
        loopTotal.set(ov.strokeId, (loopTotal.get(ov.strokeId) || 0) + 1);
        if (silent) loopSilent.set(ov.strokeId, (loopSilent.get(ov.strokeId) || 0) + 1);
      }
    } else if (c.type === 'cloud') {
      const f = c._currentFrame;
      const lon = f ? f.lon : c.lon, lat = f ? f.lat : c.lat;
      if (lon == null || lat == null) continue;
      anyCommit = true;
      const degs = (f ? f.searchRadiusDeg : c.searchRadiusDeg) ?? S.searchRadiusDeg ?? 10;
      const cl = Math.cos(lat);
      clouds.push({ x: cl * Math.sin(lon), y: Math.sin(lat), z: cl * Math.cos(lon),
                    cosR: Math.cos(degs * Math.PI / 180), silent });
    }
  }

  if (!anyCommit) {
    if (_anyMarked) for (let i = 0; i < n; i++) ps[i]._composerMuted = false;
    _anyMarked = false;
    return false;
  }

  _claimBuf.fill(0, 0, n);
  _silentBuf.fill(0, 0, n);
  for (let i = 0; i < n; i++) {
    const p = ps[i];
    const lt = loopTotal.get(p.strokeId);
    if (lt) { _claimBuf[i] += lt; _silentBuf[i] += (loopSilent.get(p.strokeId) || 0); }
    if (clouds.length) {
      if (p._cx === undefined) stampCartesian(p);
      for (let k = 0; k < clouds.length; k++) {
        const c = clouds[k];
        // acos is monotonic, so `angle <= r` is `dot >= cos(r)` — no transcendentals.
        if (p._cx * c.x + p._cy * c.y + p._cz * c.z >= c.cosR) {
          _claimBuf[i]++; if (c.silent) _silentBuf[i]++;
        }
      }
    }
  }

  // Grey only when EVERY commit that would play this particle is silent. One
  // muted playhead does not silence a stroke a second playhead is still reading,
  // and a stopped cloud does not grey material a live loop is playing.
  _anyMarked = false;
  for (let i = 0; i < n; i++) {
    const muted = _claimBuf[i] > 0 && _silentBuf[i] === _claimBuf[i];
    ps[i]._composerMuted = muted;
    if (muted) _anyMarked = true;
  }
  return _anyMarked;
}

/** True when at least one particle is marked — lets the render loop skip the
 *  per-particle read entirely in the normal case. */
export function anyParticlesMuted() { return _anyMarked; }

// ── One entry point ─────────────────────────────────────────────────────────

/** Is this commit currently sounding, for readouts and for the toggle. */
export function isCommitOn(c) {
  if (!c) return false;
  return c.type === 'loop' ? !c.composerMuted : c.playing !== false;
}

/** Flip one pin's MUTE. The flag is the player's intent (pins.js); the engine
 *  follows it through applyMix(). Returns whether the pin is audible now. */
export function toggleCommit(c) {
  if (!c || (c.type !== 'loop' && c.type !== 'cloud')) return null;
  return togglePinMute(c);
}

/** Bring every pin back — every mute and solo flag cleared, on pins and on
 *  groups. The escape hatch for an arrangement you want to abandon. */
export function allCommitsOn() {
  let silent = 0;
  for (let i = 0; i < S.commitSlotCount; i++) {
    const c = S.commitSlots[i];
    if (c && !isCommitOn(c)) silent++;
  }
  allOn();
  if (silent) { S._syncComposerUI?.(); S.updateSeedBanksUI?.(); }
  return silent;
}

/** How many commits are currently silent — drives the panel's recovery hint. */
export function silentCommitCount() {
  let n = 0;
  for (let i = 0; i < S.commitSlotCount; i++) {
    const c = S.commitSlots[i];
    if (c && !isCommitOn(c)) n++;
  }
  return n;
}

// ── The proximity gate ──────────────────────────────────────────────────────

/** Great-circle angle from the cursor to a lon/lat, in radians. */
// ── The proximity GATE lived here, and is gone (2026-08-29) ────────────────
// `arrange` was sunset: the composer latch, its scope flips, its start/release/
// hysteresis/rearm params and the 20 ms mute crossfade it drove. What stayed is
// everything ABOVE this line, because it was never the gate — it is the pin and
// group MUTE engine, and the pinned rail (ui-pins.js), the two pin groups
// (pins.js) and the silent-material marks in the renderer are all built on
// it. `seq.composerMuted` and `seed._composerHold` keep their names on purpose:
// they are in the session file (ui-export.js) and renaming them is a format
// change, not a tidy-up.
//
// This file is misnamed now — it is the pin-mute engine, not a composer. That
// rename is worth doing and is deliberately NOT bundled with the deletion.
S._toggleCommit      = toggleCommit;
S._isCommitOn        = isCommitOn;
S._syncParticleMarks   = syncParticleMarks;
S._allCommitsOn        = allCommitsOn;
