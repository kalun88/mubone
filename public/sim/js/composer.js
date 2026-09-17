// ============================================================================
// composer.js — the pin MUTE engine (misnamed: the composer gate it was
// written for was sunset 2026-08-29, see the footer)
//
//   • A loop is MUTED, never stopped — its source keeps running so unmuting
//     drops you where the loop would have been, not at the top.
//   • A cloud is STOPPED through its own fade in/out envelope, held at silence
//     with its slot intact (`_composerHold`), which is a different verb on
//     different machinery.
//   • Pins only. A trigger owns nothing — it is a view onto a stroke.
//
// The flags (`mute`, `solo`, a group's `muted` / `solo`) are the player's
// intent and live in pins.js; `applyMix()` here makes the engine agree.
// ============================================================================

import { S } from './state.js';
import { stampCartesian } from './grain.js';
import { togglePinMute } from './pins.js';

// The FLOOR of a mute ramp. Long enough not to click, short enough that the
// gesture feels immediate. The 3 ms start declick is for a source opening
// mid-waveform; a mute is a level change on running audio and wants more.
// A pin's own `fadeIn` / `fadeOut` (ui-presets.js, the rail's fold) lengthen it:
// since 2026-09-16 a mute rides the same ramp an unpin does, so a cloud set to
// leave over 10 s leaves that way whether it is unpinned or muted (Ek: "if
// there's an attack and release ramp so it can fade in slowly or exit slowly").
const MUTE_RAMP_S = 0.02;

// ── Loop mute ───────────────────────────────────────────────────────────────

/** Mute or unmute a loop slot without stopping it. The source keeps running
 *  (2026-09-05) and the mute node ramps — over the pin's own `fadeOut` on the
 *  way down and `fadeIn` on the way up, never under MUTE_RAMP_S. Waiting for
 *  the loop boundary is not a mute, it is a RELEASE — that lives in
 *  ui-presets.js `_stopSeqAudio` under `S.loopReleaseMode`, and until
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
  const ramp = Math.max(MUTE_RAMP_S, (muted ? seq.fadeOut : seq.fadeIn) || 0);
  g.gain.cancelScheduledValues(now);
  // Hold whatever the ramp had reached, or a cancel mid-ramp jumps. The ramp
  // is scaled by the distance left, so an unmute that lands mid-fade takes
  // its share of `fadeIn` rather than the whole of it from wherever it was.
  const from = g.gain.value, to = muted ? 0 : 1;
  g.gain.setValueAtTime(from, now);
  g.gain.linearRampToValueAtTime(to, now + ramp * Math.abs(to - from));
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
  const nowS = performance.now() / 1000;

  if (playing) {
    // Already on — unless it is on its way OUT under a mute (a hold with the
    // release still running), which an unmute must be able to turn round.
    if (seed.playing !== false && !seed._composerHold) return false;
    seed.playing         = true;
    seed._composerHold   = false;
    seed._releasingAt    = 0;
    // The unmute rides the pin's own `fadeIn` (2026-09-16), resumed from the
    // level the mute left it at rather than from silence: the attack is t³
    // (grain.js), so the time already "spent" is fadeIn·∛gain.
    const fi = seed.fadeIn || 0;
    const cur = Math.max(0, Math.min(1, seed._envGainCurrent ?? 0));
    seed._envAttack      = fi;
    seed._plantedAt      = fi > 0 ? nowS - fi * Math.cbrt(cur) : nowS;
    seed._envGainCurrent = fi > 0 ? cur : 1;
    return true;
  }

  if (seed.playing === false || seed._composerHold) return false;   // already off
  // `_composerHold` is what grain.js reads to keep the slot rather than delete
  // it when the release lands. With a `fadeOut` the mute IS that release,
  // started now; grain.js flips `playing` to false at its end. With none it
  // stops scheduling now — grains already in flight finish their own
  // envelopes, so there is no click.
  seed._composerHold = true;
  const fo = seed.fadeOut || 0;
  if (fo > 0) {
    seed._envRelease  = fo;
    seed._releasingAt = nowS;
    return true;
  }
  seed._envRelease     = 0;
  seed._releasingAt    = 0;
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

// ── One entry point ─────────────────────────────────────────────────────────

/** Is this commit currently sounding, for readouts and for the toggle. */
export function isCommitOn(c) {
  if (!c) return false;
  // A cloud under a mute HOLD is off from the moment the mute lands, even while
  // its `fadeOut` is still running (2026-09-16) — so applyMix() sees an unmute
  // as a change and turns the ramp round, instead of skipping it as "already
  // on" because `playing` is still true for the length of the fade.
  return c.type === 'loop' ? !c.composerMuted : (c.playing !== false && !c._composerHold);
}

/** Flip one pin's MUTE. The flag is the player's intent (pins.js); the engine
 *  follows it through applyMix(). Returns whether the pin is audible now. */
export function toggleCommit(c) {
  if (!c || (c.type !== 'loop' && c.type !== 'cloud')) return null;
  return togglePinMute(c);
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
