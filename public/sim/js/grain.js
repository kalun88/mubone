import { S, HANN_LEN, HANN_ATTACK, HANN_RELEASE, MAX_CLOUDS, MAX_GRAIN_NODES, GRAIN_SCHEDULER_INTERVAL_MS, perf, gp, minGrainDurS, minGrainPeriodS, buildEnvelopeCurves } from './state.js';
import { ensureAudioContext, getMasterBus } from './audio.js';
import { spherePoint, qRotateVec, qConjugate, getCursorLonLat, screenToLonLat } from './sphere.js';

export function rand(min, max) { return min + Math.random() * (max - min); }

// activeGrainMap: particle → { expiry, glowColor } — shared with renderer
export let activeGrainMap = new Map();

// ── Reversed buffer cache ──────────────────────────────────────────────────
// Caches a full reversed copy of each source AudioBuffer to avoid per-grain
// allocation. WeakMap so entries are automatically GC'd when the source buffer
// (sample or live rec) is discarded.
const _reversedBufferCache = new WeakMap();

function getReversedBuffer(actx, buffer) {
  let rev = _reversedBufferCache.get(buffer);
  if (rev) return rev;

  rev = actx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = rev.getChannelData(ch);
    for (let f = 0, len = src.length; f < len; f++) {
      dst[f] = src[len - 1 - f];
    }
  }
  _reversedBufferCache.set(buffer, rev);
  return rev;
}

export function getBufferKey(p) {
  return p.source === 'live' ? `live:${p.liveBufferIdx}` : `sample:${p.sampleIndex}`;
}

export function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function applyRecencyFilter(candidates) {
  if (S.recencyN <= 0 || candidates.length === 0) return candidates;
  const bufRec = new Map();
  for (const { p } of candidates) {
    const key = getBufferKey(p);
    if ((bufRec.get(key) ?? -Infinity) < p.strokeId) bufRec.set(key, p.strokeId);
  }
  const allowed = new Set(
    [...bufRec.entries()].sort((a, b) => b[1] - a[1]).slice(0, S.recencyN).map(([k]) => k)
  );
  return candidates.filter(({ p }) => allowed.has(getBufferKey(p)));
}

export function angleBetweenSphere(lon1, lat1, lon2, lat2) {
  const x1 = Math.cos(lat1)*Math.cos(lon1), y1 = Math.sin(lat1), z1 = Math.cos(lat1)*Math.sin(lon1);
  const x2 = Math.cos(lat2)*Math.cos(lon2), y2 = Math.sin(lat2), z2 = Math.cos(lat2)*Math.sin(lon2);
  return Math.acos(Math.max(-1, Math.min(1, x1*x2 + y1*y2 + z1*z2)));
}

export function findNearestCloudSlot(refLon, refLat) {
  let nearestSlot = -1, nearestAng = Infinity;
  for (let i = 0; i < MAX_CLOUDS; i++) {
    if (!S.cloudSlots[i]) continue;
    const ang = angleBetweenSphere(S.cloudSlots[i].lon, S.cloudSlots[i].lat, refLon, refLat);
    if (ang < nearestAng) { nearestAng = ang; nearestSlot = i; }
  }
  return nearestSlot;
}

export function playGrain(particle, customParams, scheduledOnsetT) {
  const actx   = ensureAudioContext();
  let   buffer = null;

  if (particle.source === 'sample') {
    if (particle.sampleIndex < 0 || particle.sampleIndex >= S.samples.length) return;
    buffer = S.samples[particle.sampleIndex].buffer;
  } else if (particle.source === 'live') {
    if (particle.liveBufferIdx < 0 || particle.liveBufferIdx >= S.liveRecBuffers.length) return;
    const slot = S.liveRecBuffers[particle.liveBufferIdx];
    buffer = slot.buffer || slot.liveBuffer;
  }
  if (!buffer) return;

  const p = customParams || gp();

  const ep = customParams ? p : {
    ...p,
    duration:    S.grainOverrides.duration    ?? p.duration,
    durJitter:   S.grainOverrides.durJitter   ?? p.durJitter,
    durVar:      S.grainOverrides.durVar      ?? p.durVar,
    fadeRatio:   S.grainOverrides.fadeRatio   ?? p.fadeRatio,
    k:           S.grainOverrides.k           ?? p.k,
    period:      S.grainOverrides.period      ?? p.period,
    periodVar:   S.grainOverrides.periodVar   ?? p.periodVar,
    pitchJitter: S.grainOverrides.pitchJitter ?? p.pitchJitter,
    panSpread:   S.grainOverrides.panSpread   ?? p.panSpread,
    volume:      S.grainOverrides.volume      ?? p.volume,
    startJitter: S.grainOverrides.startJitter ?? p.startJitter,
    sprayCount:  S.grainOverrides.sprayCount  ?? p.sprayCount,
    spraySpread: S.grainOverrides.spraySpread ?? p.spraySpread,
    retriggerMs: S.grainOverrides.retriggerMs ?? p.retriggerMs,
  };

  const audioNow = actx.currentTime;
  if (customParams) {
    const retriggerSec = ep.retriggerMs / 1000;
    if (particle.cloudTriggeredAt !== undefined && audioNow - particle.cloudTriggeredAt < retriggerSec) return;
    particle.cloudTriggeredAt = audioNow;
  }

  const sampleDur    = buffer.duration;
  const cropStartSec = particle.source === 'sample'
    ? (S.samples[particle.sampleIndex].cropStart * sampleDur) : 0;
  const cropEndSec   = particle.source === 'sample'
    ? (S.samples[particle.sampleIndex].cropEnd   * sampleDur) : sampleDur;
  // If a pre-scheduled onset time is provided (lookahead scheduler), use it directly.
  // Otherwise fall back to a small immediate lookahead (cloud / one-shot calls).
  // Safety floor: clamp to at least 2ms in the future at call time.  The scheduler
  // samples audioNow once at the top of its tick, then does O(N log N) candidate
  // sorting before calling playGrain.  During that gap actx.currentTime advances,
  // so scheduledOnsetT can slip into the past by call-time → setValueCurveAtTime
  // throws InvalidStateError.  Math.max ensures t is always a live future value
  // regardless of how much JS ran between audioNow being read and this call.
  const LOOKAHEAD    = 0.015;
  const MIN_FUTURE_S = 0.002; // 2ms safety floor
  const baseTime  = scheduledOnsetT !== undefined
    ? Math.max(scheduledOnsetT, actx.currentTime + MIN_FUTURE_S)
    : actx.currentTime + LOOKAHEAD;

  let attackCurve, releaseCurve;
  if (customParams) {
    // Cloud grains: cache volume-scaled curves on the params object.
    // Rebuilt only when volume or curveType changes — eliminates 2 × Float32Array(128)
    // allocation per cloud grain (was the #2 OOM contributor).
    // Uses buildEnvelopeCurves so tri/rect curve types are respected (clouds snapshot
    // the active preset's curveType at drop time).
    const ctype = customParams.curveType || 'hann';
    if (!customParams._cachedAtk || customParams._cachedVol !== ep.volume || customParams._cachedCurve !== ctype) {
      const { atk, rel } = buildEnvelopeCurves(ctype, ep.volume);
      customParams._cachedAtk   = atk;
      customParams._cachedRel   = rel;
      customParams._cachedVol   = ep.volume;
      customParams._cachedCurve = ctype;
    }
    attackCurve  = customParams._cachedAtk;
    releaseCurve = customParams._cachedRel;
  } else {
    attackCurve  = S.GRAIN_ATTACK_CURVE;
    releaseCurve = S.GRAIN_RELEASE_CURVE;
  }

  const dir = customParams ? 'fwd' : S.grainDirection;

  for (let i = 0; i < ep.sprayCount; i++) {
    const timeOffset = i * ep.spraySpread * rand(0.5, 1.5);
    const t          = baseTime + timeOffset;

    // pitchRate must be computed BEFORE startPos/actualDur because it determines
    // how much buffer the source consumes: at pitchRate > 1 the source reads
    // `dur * pitchRate` buffer-seconds in `dur` real-time seconds.  Without
    // accounting for pitch here, startPos can be positioned such that the source
    // exhausts the crop boundary early and AudioBufferSourceNode fires 'ended'
    // while the gain envelope is still non-zero → abrupt hard cut → audible click.
    // Clamping startPos so that `startPos + dur * pitchRate ≤ cropEndSec` prevents
    // premature exhaustion for any pitch; pitch < 1 uses less buffer so no change.
    const pitchRate = Math.max(1e-6, 1 + rand(-ep.pitchJitter, ep.pitchJitter));

    let startPos = particle.grainStart + rand(-ep.startJitter, ep.startJitter);
    const durVarSec = customParams ? 0 : (ep.durVar ?? 0);
    const dur = Math.max(minGrainDurS(),
      ep.duration * (1 + rand(-ep.durJitter, ep.durJitter))
      + rand(-durVarSec, durVarSec)
    );

    // How much buffer the source will read at this pitch (output seconds × rate).
    const bufferNeeded = dur * Math.max(pitchRate, 1);
    const cropLen = cropEndSec - cropStartSec;
    if (cropLen < bufferNeeded) {
      startPos = cropStartSec;
    } else {
      startPos = Math.max(cropStartSec, Math.min(startPos, cropEndSec - bufferNeeded));
    }

    // actualDur: real-time envelope span. For pitchRate > 1, `cropEndSec - startPos`
    // buffer-seconds only cover `(cropEndSec - startPos) / pitchRate` real-time
    // seconds before the source exhausts — use that as the ceiling.
    const actualDur = Math.min(dur, (cropEndSec - startPos) / Math.max(pitchRate, 1));
    if (actualDur < minGrainDurS()) continue;

    const goReverse = dir === 'rev' || (dir === 'rnd' && Math.random() < 0.5);

    const fadeRatio = ep.fadeRatio ?? 0.25;
    // One Web Audio render quantum — the minimum source.start() duration that
    // guarantees audio output (the browser rounds down to the nearest render block).
    const MIN_FADE = 128 / actx.sampleRate;
    // Two tiers by grain length — 'rect' was removed because setValueAtTime(0)
    // creates a hard gain discontinuity (audible click) when sweeping duration.
    //
    //   'linear' — grain < 2 quanta (< 2×MIN_FADE): symmetric triangle ramp.
    //              Triangle covers the entire [0, 2×MIN_FADE) range smoothly,
    //              including the sub-quantum zone where 'rect' used to live.
    //              No hard step; no click anywhere in this region.
    //
    //   'curve'  — grain ≥ 2 quanta: setValueCurveAtTime Hann window.
    //              Boundary kept at 2×MIN_FADE (not 1×) because Chrome's
    //              setValueCurveAtTime requires duration ≥ 1 render quantum
    //              (128/sampleRate) per call — at 2×MIN_FADE the fade value
    //              is guaranteed ≥ MIN_FADE, satisfying that constraint.
    //              Lowering to 1×MIN_FADE causes sub-quantum fade calls that
    //              Chrome no-ops or mis-applies, producing snaps that persist
    //              even after duration is raised (scheduler loop aborts early).
    const fadeMode = actualDur < MIN_FADE * 2 ? 'linear' : 'curve';
    const fade = fadeMode === 'curve'
      ? Math.min(actualDur / 2 - 0.0001, Math.max(MIN_FADE, actualDur * Math.min(fadeRatio, 0.5)))
      : 0;
    // Silent tail: extend sourceDur past actualDur so the source outlives the
    // gain envelope.  The release automation reaches 0 at t+actualDur and the
    // GainNode holds there; GRAIN_TAIL_S extra seconds play silently through
    // the 0-gain node, so when the source finally stops there is nothing to
    // discontinue.  Without this tail, the source's stop-sample and the curve's
    // final zero-sample can land in different render quanta → the last few
    // samples run through a not-yet-zero gain → step discontinuity → click.
    // If the buffer is exhausted early (crop too short), ended fires mid-tail
    // but gain is already 0 at that point, so no click either way.
    // Adaptive silent tail: sub-quantum grains (actualDur < MIN_FADE) reach gain=0
    // within the very first render quantum, so a tail of just MIN_FADE (~3ms, 1 block)
    // is sufficient. Longer grains need 10ms (3–4 quanta) because the release curve
    // spans multiple blocks and the source must outlive the last non-zero sample.
    // Using MIN_FADE for sub-quantum grains cuts concurrent node lifetime from 10ms
    // to ~3ms, reducing live node count from ~10 to ~3 at 1ms period — lower GC load.
    const GRAIN_TAIL_S = actualDur < MIN_FADE ? MIN_FADE : 0.010;
    const sourceDur = Math.max(MIN_FADE, actualDur + GRAIN_TAIL_S);
    const source = actx.createBufferSource();

    if (goReverse) {
      // Use cached full-buffer reverse — zero per-grain allocation.
      // The reversed buffer mirrors the original: sample at time t in the
      // original is at time (bufferDuration - t) in the reversed copy.
      // To play what was at [startPos, startPos+sourceDur] in reverse,
      // we play the reversed buffer starting from (bufferDuration - startPos - sourceDur).
      const revBuf = getReversedBuffer(actx, buffer);
      source.buffer = revBuf;
    } else {
      source.buffer = buffer;
    }

    source.playbackRate.value = pitchRate; // pitchRate computed above, before startPos
    // For reverse: map the original startPos into the reversed buffer.
    // Original region [startPos, startPos+sourceDur] maps to reversed region
    // [bufDur - startPos - sourceDur, bufDur - startPos]. We start at the
    // beginning of that region and the source plays forward through the
    // already-reversed samples, producing the original audio in reverse.
    const bufferStartPos = goReverse
      ? Math.max(0, buffer.duration - startPos - sourceDur * Math.max(pitchRate, 1))
      : startPos;

    const gain = actx.createGain();
    if (fadeMode === 'linear') {
      // Sub-quantum grain: symmetric triangle (0 → peak → 0) over actualDur.
      // Source plays for sourceDur (≥ MIN_FADE) so the browser outputs audio;
      // gain reaches 0 at actualDur and stays there for the silent tail.
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(ep.volume, t + actualDur * 0.5);
      gain.gain.linearRampToValueAtTime(0,         t + actualDur);
    } else {
      // Hann window: attack ramp then release ramp, with sustain in between.
      // setValueCurveAtTime requires fade ≥ 1 render quantum; the boundary
      // above guarantees this. The try/catch is a last-resort safety net so
      // that a bad call can never throw and abort the scheduler's while loop
      // (which would stall _cursorNextOnsetT and cause persistent snapping).
      // NOTE: do NOT call setValueAtTime(0, t) here. Chrome treats a SetValue
      // event at exactly t as overlapping with setValueCurveAtTime(…, t, fade)
      // (which also starts at t) and can throw InvalidStateError or silently
      // treat the curve as a no-op — both produce a loud rectangular burst.
      // attackCurve[0] is already 0 and the gain node initialises to 0, so
      // no additional "pre-zero" event is needed.
      try {
        gain.gain.setValueCurveAtTime(attackCurve,  t,               fade);
        gain.gain.setValueCurveAtTime(releaseCurve, t + actualDur - fade, fade);
      } catch (_) {
        // Fallback: triangle ramp so the grain is never silent or unclamped.
        // IMPORTANT: setValueAtTime(0, t) goes here (NOT in the try block above).
        // The GainNode's default gain is 1.0 — without anchoring at 0 first,
        // linearRampToValueAtTime ramps from 1.0 at actx.currentTime to ep.volume,
        // so the grain starts at full volume and produces a loud burst/crackle.
        // Placing the anchor only in the catch block avoids the original conflict:
        // setValueAtTime(0, t) + setValueCurveAtTime(…, t, …) at the same time t
        // can cause Chrome to treat the curve as overlapping with the SetValue event.
        //
        // Nested try/catch: linearRamp can also throw in rare Chrome edge-cases
        // (e.g. during AudioContext resumption when event ordering is violated).
        // An uncaught throw here would propagate out of playGrain and stall the
        // onset clock in the scheduler while loop (see scheduleGrains guard).
        try {
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(ep.volume, t + actualDur * 0.5);
          gain.gain.linearRampToValueAtTime(0,         t + actualDur);
        } catch (_2) {
          // Both curve and ramp automation failed entirely — cancel all events
          // and hold gain at 0 (silent) so the scheduler can still advance.
          gain.gain.cancelScheduledValues(0);
          gain.gain.value = 0;
        }
      }
    }

    const [wx, wy, wz] = spherePoint(particle.lon, particle.lat);

    // Sim mode:      transform grain into camera space — panning is view-relative
    //                (turn your head left, a front grain moves right = pans right).
    // Physical mode: use world-space position directly — speakers are fixed in the
    //                room, turning your body doesn't move the sound. The camera
    //                (and sensor) still rotates visually but audio is absolute.
    const [cx, cy, cz] = S.spatialMode === 'physical'
      ? [wx, wy, wz]
      : qRotateVec(qConjugate(S.camQ), [wx, wy, wz]);

    // At dense grain periods (≤ 5ms, ≥ 200Hz repetition) spatial positioning is
    // acoustically inaudible — the human auditory system integrates pan position
    // over 2–5ms, so changes faster than 200Hz are heard as timbre, not movement.
    // Skip the elevation-gain and stereo-panner nodes entirely to cut per-grain
    // node creation by 1–2 Web Audio nodes per grain.
    // IMPORTANT: the period minimum is now 1ms. Without this threshold covering ≥1ms,
    // every grain at the new floor would use the full 4-node chain (source + gain +
    // elevGain + panner) → ~4000 node ops/s → Chrome audio renderer crash.
    // Threshold at 5ms keeps the lightweight path for the entire dense-granulation
    // range while restoring full spatial processing at ≥ 6ms (100Hz and below).
    const audioRate = ep.period <= 0.005;

    // Elevation attenuation — fold into main gain to avoid a separate node
    const elevNorm  = cz !== 0 ? Math.min(1, Math.abs(cy / Math.abs(cz))) : 0;
    const elevScale = 1 - elevNorm * 0.35;
    // Insert elevScale node only when meaningfully different from 1 (elevation
    // > ~10°) and we're NOT in audio-rate mode where the node cost dominates.
    const needsElevNode = !audioRate && elevScale < 0.98;
    let lastNode = gain; // track the last node in the chain for connecting
    let elevGainNode = null;
    if (needsElevNode) {
      elevGainNode = actx.createGain();
      elevGainNode.gain.value = elevScale;
      gain.connect(elevGainNode);
      lastNode = elevGainNode;
    }

    source.connect(gain);

    if (S.speakerBuses?.length) {
      // ── Multi-channel speaker path (Electron) ─────────────────────────────
      // Project grain's camera-space horizontal angle onto the speaker ring using
      // angle-aware 2-D VBAP: find the two speakers that bracket the grain's
      // azimuth by their actual angleDeg values (not by index), so any speaker
      // layout — including stereo L/R at 270°/90° — pans correctly.
      //
      // Camera space: cx = right, cz = into screen (negative = toward viewer).
      // Azimuth: atan2(cx, -cz) → 0 = front, clockwise positive.

      const speakers = S.speakerBuses;
      const n        = speakers.length;

      // Raw azimuth in radians, with pan-spread jitter, normalised to [0, 2π).
      // Camera space: cz>0 = in front of listener, cx>0 = to listener's right.
      // atan2(cx, cz): 0°=front, 90°=right, 180°=rear, 270°=left — matches the
      // speaker bus layout (bus 0 = 0° = front for n≥3; R=90°/L=270° for n=2).
      const TWO_PI = 2 * Math.PI;
      const rawAz  = Math.atan2(cx, cz);
      const jitter = rand(-ep.panSpread * 0.5, ep.panSpread * 0.5);
      let   az     = ((rawAz + jitter) % TWO_PI + TWO_PI) % TWO_PI;
      const azDeg  = az * (180 / Math.PI);

      // Build sorted list of speaker angles (deg, 0-360) with their original indices.
      // Sort once per grain — cheap for ≤16 speakers.
      const sorted = speakers
        .map(({ angleDeg }, idx) => ({ angleDeg, idx }))
        .sort((a, b) => a.angleDeg - b.angleDeg);

      // Find the speaker just CW (clockwise ≥ azDeg) — that's "next".
      // The one before it is "sector" (the speaker CCW of azDeg).
      let nextPos = sorted.findIndex(s => s.angleDeg > azDeg);
      if (nextPos === -1) nextPos = 0;           // wrapped around
      const prevPos = (nextPos - 1 + n) % n;

      const sA = sorted[prevPos];
      const sB = sorted[nextPos];

      // Angular span of this sector, and how far az sits within it
      let spanDeg = sB.angleDeg - sA.angleDeg;
      if (spanDeg <= 0) spanDeg += 360;          // wraps past 0°
      let offsetDeg = azDeg - sA.angleDeg;
      if (offsetDeg < 0) offsetDeg += 360;
      const t01 = Math.max(0, Math.min(1, offsetDeg / spanDeg));

      // Equal-power crossfade
      const wA = Math.cos(t01 * Math.PI * 0.5);
      const wB = Math.sin(t01 * Math.PI * 0.5);

      // Create per-grain gain nodes only for the two active speakers
      const gA = actx.createGain(); gA.gain.value = wA;
      const gB = actx.createGain(); gB.gain.value = wB;

      lastNode.connect(gA); gA.connect(speakers[sA.idx].bus);
      lastNode.connect(gB); gB.connect(speakers[sB.idx].bus);

      source.start(t, bufferStartPos, sourceDur);
      S._grainSourceCount++;
      source.addEventListener('ended', () => {
        S._grainSourceCount = Math.max(0, S._grainSourceCount - 1);
        try {
          source.disconnect(); gain.disconnect();
          if (elevGainNode) elevGainNode.disconnect();
          gA.disconnect(); gB.disconnect();
        } catch(_) {}
      });

    } else {
      // ── Stereo path ────────────────────────────────────────────────────────
      // Stereo placement: blend from sphere-position-based azimuth (panSpread=0)
      // to a fully independent random position per grain (panSpread=1).
      // This gives true shimmer/scatter behaviour — every grain fires at a new
      // random pan position — rather than just widening a single azimuth point.
      // At intermediate spread values, spatial positioning is gradually loosened.
      // At audio-rate periods the panner is skipped entirely (see audioRate above).
      const azimuthPan = cz !== 0 ? Math.max(-1, Math.min(1, cx / Math.abs(cz))) : 0;
      const finalPan   = audioRate ? 0 : Math.max(-1, Math.min(1,
        azimuthPan * (1 - ep.panSpread) + rand(-1, 1) * ep.panSpread
      ));
      // Skip the StereoPanner node at audio rate, or when pan is effectively zero.
      const needsPanner = !audioRate && (Math.abs(finalPan) > 0.01 || ep.panSpread > 0.01);

      if (needsPanner) {
        const panner = actx.createStereoPanner();
        panner.pan.value = finalPan;
        lastNode.connect(panner);
        panner.connect(getMasterBus());

        source.start(t, bufferStartPos, sourceDur);
        S._grainSourceCount++;
        source.addEventListener('ended', () => {
          S._grainSourceCount = Math.max(0, S._grainSourceCount - 1);
          try { source.disconnect(); gain.disconnect(); if (elevGainNode) elevGainNode.disconnect(); panner.disconnect(); } catch(_) {}
        });
      } else {
        lastNode.connect(getMasterBus());

        source.start(t, bufferStartPos, sourceDur);
        S._grainSourceCount++;
        source.addEventListener('ended', () => {
          S._grainSourceCount = Math.max(0, S._grainSourceCount - 1);
          try { source.disconnect(); gain.disconnect(); if (elevGainNode) elevGainNode.disconnect(); lastNode.disconnect(); } catch(_) {}
        });
      }
    }

    if (particle.source === 'sample') {
      S.activeGrains.push({
        sampleIndex:   particle.sampleIndex,
        grainStart:    startPos,
        grainDuration: actualDur,
        startTime:     performance.now() + timeOffset * 1000,
        totalDuration: actualDur
      });
    }
  }
}

let _schedLastAt = 0;
// Audio-clock time (actx.currentTime seconds) of the next cursor grain onset.
// Using the audio clock instead of performance.now() allows sub-10ms periods:
// each scheduler tick looks ahead by SCHED_LOOKAHEAD seconds and fires all
// onsets that fall within that window, so periods much shorter than the
// tick interval work correctly (comb/zipper effect into audio-rate territory).
let _cursorNextOnsetT  = null;   // null = not yet initialised
let _cursorNextPeriodS = null;   // next inter-onset interval in seconds

// How far ahead we schedule grain onsets (seconds). Must be > scheduler interval
// to guarantee grains are always scheduled before they need to play.
const SCHED_LOOKAHEAD = 0.120;   // 120ms lookahead window

// Hard limit on grains created per scheduler call. Each grain allocates 2–3 Web
// Audio nodes synchronously on the main thread. Reduced from 48 to 16 to cut
// worst-case burst allocation rate: 16 nodes/tick × 100 ticks/s = 1,600/s max.
// At 1ms real period we only need ~10 grains/tick to stay on schedule (1,000/s),
// so 16 gives 60% headroom without letting bursts spike the GC.
const MAX_GRAINS_PER_TICK = 16;

// Minimum period used for the grainsNeeded budget calculation only — NOT for
// actual onset timing. Raised from 1ms to 10ms so that sub-10ms periods cap
// grainsNeeded at ceil(120ms/10ms)=12 rather than 120. At 1ms real period,
// 12 grains/tick still covers the 10 grains/tick actually needed — audio is
// unaffected. The old 1ms floor allowed budgetPerTick=48 at very short periods,
// producing ~4,800 node-creations/s which overwhelmed Chrome's GC and caused
// the "Aw Snap" OOM crash when the period slider was dragged hard.
const SCHED_SAFE_PERIOD_S = 0.010; // 10 ms

export function scheduleGrains() {
  const now = performance.now();
  if (_schedLastAt > 0) perf.schedulerDrift = Math.max(0, (now - _schedLastAt) - GRAIN_SCHEDULER_INTERVAL_MS);
  _schedLastAt = now;

  if (S._grainSourceCount >= MAX_GRAIN_NODES) return;

  const actx = ensureAudioContext();
  // Don't attempt to schedule while the context is suspended or still resuming.
  // ensureAudioContext() calls resume() but doesn't await it, so there is a
  // window where state is still 'suspended' and currentTime is frozen.
  // Scheduling in that window produces grains at t ≈ frozen-audioNow which,
  // by the time setValueCurveAtTime() is called a few µs later, is already
  // slightly in the past → Chrome throws InvalidStateError.
  if (actx.state !== 'running') {
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return;
  }
  const audioNow = actx.currentTime;
  // Horizon: schedule all onsets up to this audio time
  const scheduleUntil = audioNow + SCHED_LOOKAHEAD;

  const { lon: cursorLon, lat: cursorLat } =
    (S.mouseInCanvas || S.altLocked)
      ? screenToLonLat(S.altLocked ? S.altFrozenMousePixelX : S.mousePixelX,
                       S.altLocked ? S.altFrozenMousePixelY : S.mousePixelY)
      : getCursorLonLat();
  const k = S.grainOverrides.k ?? gp().k;
  const searchRadiusRad = S.searchRadiusDeg * Math.PI / 180;

  for (const [particle, entry] of activeGrainMap) {
    if (now > entry.expiry) activeGrainMap.delete(particle);
  }

  S.liveGranulatingThisFrame = false;
  perf.grainsFired = 0;

  if (S.particles.length) {
    const basePeriodS = S.grainOverrides.period ?? gp().period;
    const periodVarS  = S.grainOverrides.periodVar ?? 0;

    // Stale-clock guard: if the onset clock is far ahead of audioNow the
    // AudioContext was likely recreated (currentTime reset to 0) and the old
    // clock value is meaningless.  Reset so the scheduler reinitialises.
    if (_cursorNextOnsetT !== null && (_cursorNextOnsetT - audioNow) > 30.0) {
      _cursorNextOnsetT  = null;
      _cursorNextPeriodS = null;
    }

    // Initialise next onset to just ahead of now on first call or after reset.
    // Use audioNow + 0.005 (same forward margin as the snap guard) so the very
    // first grain after a reset is never at exactly audioNow — by call-time that
    // would already be in the past and cause setValueCurveAtTime to throw.
    if (_cursorNextOnsetT === null) {
      _cursorNextOnsetT  = audioNow + 0.005;
      _cursorNextPeriodS = Math.max(SCHED_SAFE_PERIOD_S, basePeriodS + rand(-periodVarS, periodVarS));
    }

    // Pre-compute candidate pool once per scheduler tick (shared by all onsets in window)
    const withAng = S.particles.map(p => ({
      p,
      ang: angleBetweenSphere(p.lon, p.lat, cursorLon, cursorLat)
    }));

    // Pre-sort / filter candidate pool once for all onsets in this tick window
    let candidatePool = [];
    if (S.nearestMode) {
      withAng.sort((a, b) => a.ang - b.ang);
      candidatePool = applyRecencyFilter(withAng).slice(0, k).map(c => c.p);
    } else {
      const inRadius = withAng.filter(c => c.ang < searchRadiusRad);
      candidatePool = applyRecencyFilter(inRadius).map(c => c.p);
    }

    // Budget: how many cursor grains to schedule this tick.
    // Use the full SCHED_LOOKAHEAD window (120ms) — not just minAheadS (≈15ms).
    // With minAheadS, short-period presets like shimmer (period≈55ms) only got
    // budgetPerTick=1, so dynamicUntil ended up just 55ms ahead. Any JS jitter
    // longer than one period caused audio gaps with a consistent rhythmic crackle.
    // Using SCHED_LOOKAHEAD gives budgetPerTick≈3 for shimmer and advances
    // scheduleUntil 120ms ahead, which is the intent of that constant.
    // Floor period for budget calc only — prevents 2000+ grainsNeeded at sub-ms periods.
    const schedPeriodS  = Math.max(SCHED_SAFE_PERIOD_S, basePeriodS);
    const grainsNeeded  = Math.ceil(SCHED_LOOKAHEAD / Math.max(schedPeriodS, minGrainPeriodS()));
    const nodesBudget   = Math.max(0, MAX_GRAIN_NODES - S._grainSourceCount);
    const budgetPerTick = Math.min(grainsNeeded, nodesBudget, MAX_GRAINS_PER_TICK);
    // scheduleUntil (= audioNow + SCHED_LOOKAHEAD) was already computed above but
    // was never used as the while-loop bound — use it now.

    let iterations = 0;
    while (_cursorNextOnsetT < scheduleUntil && iterations < budgetPerTick) {
      // We're behind — snap forward by 5ms so t is safely in the future when
      // setValueCurveAtTime() is called inside playGrain.  Using exactly
      // audioNow risks a race: actx.currentTime advances a few µs between
      // sampling audioNow here and the actual Web Audio API call, making
      // Chrome consider t "in the past" and throw InvalidStateError.
      if (_cursorNextOnsetT < audioNow) {
        _cursorNextOnsetT = audioNow + 0.005;
      }

      let toGranulate = [];
      if (S.nearestMode) {
        toGranulate = candidatePool;
      } else {
        toGranulate = shuffleInPlace([...candidatePool]).slice(0, k);
      }

      if (toGranulate.length > 0) {
        if (!(S.grainProbability < 1.0 && Math.random() > S.grainProbability)) {
          const p = toGranulate[Math.floor(Math.random() * toGranulate.length)];
          const liveDurMs = (S.grainOverrides.duration ?? gp().duration) * 1000;
          activeGrainMap.set(p, { expiry: now + liveDurMs, glowColor: '#ffffff' });
          // Wrap playGrain so any unexpected throw never stalls the onset clock.
          // Without this guard, an exception here exits the while loop before
          // _cursorNextOnsetT advances; on the next tick the same onset is
          // retried, throws again, and the clock is stuck permanently.
          try {
            playGrain(p, null, _cursorNextOnsetT);
            perf.grainsFired++;
            if (p.source === 'live') S.liveGranulatingThisFrame = true;
          } catch (_) { /* clock still advances unconditionally below */ }
        }
      }

      // Advance to next onset — always runs, even if playGrain threw above.
      // Floor at SCHED_SAFE_PERIOD_S (10ms) so the onset clock always advances.
      // Without this, sub-10ms periods with many grains per tick could stall the
      // clock, cause the snap guard to fire every tick, and spike node creation.
      _cursorNextPeriodS = Math.max(SCHED_SAFE_PERIOD_S, basePeriodS + rand(-periodVarS, periodVarS));
      _cursorNextOnsetT += _cursorNextPeriodS;
      iterations++;
    }
  }

  for (let i = 0; i < MAX_CLOUDS; i++) {
    const cloud = S.cloudSlots[i];
    if (!cloud || !S.particles.length) continue;

    const cgp          = cloud.grainParams;
    const basePeriodS  = cgp.period;
    const periodVarS   = cgp.periodVar ?? 0;

    // Initialise cloud onset clock on first use — same 5ms forward margin as
    // the cursor init so the first cloud grain is never at exactly currentTime.
    if (cloud._nextOnsetT === undefined) {
      cloud._nextOnsetT = ensureAudioContext().currentTime + 0.005;
    }

    const withAng = S.particles.map(p => ({
      p, ang: angleBetweenSphere(p.lon, p.lat, cloud.lon, cloud.lat)
    }));

    let pool;
    if (cloud.nearestMode) {
      withAng.sort((a, b) => a.ang - b.ang);
      pool = applyRecencyFilter(withAng).slice(0, cgp.k).map(c => c.p);
    } else {
      const cloudRadiusRad = cloud.searchRadiusDeg * Math.PI / 180;
      pool = shuffleInPlace(applyRecencyFilter(
        withAng.filter(c => c.ang < cloudRadiusRad)
      )).slice(0, cgp.k).map(c => c.p);
    }

    const cloudAudioNow   = ensureAudioContext().currentTime;
    // Same fix as cursor path: use SCHED_LOOKAHEAD (120ms) for budget/window,
    // not minAheadS (≈15ms), so cloud grains are scheduled far enough ahead
    // to survive JS timer jitter without rhythmic crackle.
    const cloudSchedUntil   = cloudAudioNow + SCHED_LOOKAHEAD;
    // Floor period for budget calc only — same OOM guard as cursor path.
    const cloudSchedPeriodS = Math.max(SCHED_SAFE_PERIOD_S, basePeriodS);
    const cloudGrainsNeeded = Math.ceil(SCHED_LOOKAHEAD / Math.max(cloudSchedPeriodS, minGrainPeriodS()));
    const cloudNodesBudget  = Math.max(0, MAX_GRAIN_NODES - S._grainSourceCount);
    const cloudBudget = Math.min(cloudGrainsNeeded, cloudNodesBudget, MAX_GRAINS_PER_TICK);

    if (!pool.length) {
      // Still advance the clock even if no particles in range.
      // Floor at SCHED_SAFE_PERIOD_S to match the OOM guard on the firing path.
      while (cloud._nextOnsetT < cloudSchedUntil) {
        const p = Math.max(SCHED_SAFE_PERIOD_S, basePeriodS + rand(-periodVarS, periodVarS));
        cloud._nextOnsetT += p;
      }
      continue;
    }

    let cloudIter = 0;
    while (cloud._nextOnsetT < cloudSchedUntil && cloudIter < cloudBudget) {
      if (cloud._nextOnsetT < cloudAudioNow) {
        cloud._nextOnsetT = cloudAudioNow + 0.005; // 5ms forward margin (same race-guard as cursor)
      }

      const p = pool[Math.floor(Math.random() * pool.length)];
      try {
        playGrain(p, cgp, cloud._nextOnsetT);
        activeGrainMap.set(p, { expiry: now + cgp.duration * 1000, glowColor: cloud.color });
        perf.grainsFired++;
        if (p.source === 'live') S.liveGranulatingThisFrame = true;
      } catch (_) { /* clock still advances below */ }

      const nextPeriod = Math.max(SCHED_SAFE_PERIOD_S, basePeriodS + rand(-periodVarS, periodVarS));
      cloud._nextOnsetT += nextPeriod;
      cloudIter++;
    }
  }

  const activeCount = activeGrainMap.size;
  const gcEl = document.getElementById('granulatingCount');
  if (gcEl) gcEl.textContent = activeCount;
  const vmGrains = document.getElementById('vmGrains');
  if (vmGrains) vmGrains.textContent = `${activeCount} grains`;
}

// Reset onset clock when period/periodVar changes (called from events.js).
// Only resets if the clock has drifted beyond the lookahead window, which happens
// when switching from a long period (e.g. 3s) to a short one — without a reset
// the scheduler would see _cursorNextOnsetT = audioNow+3 and fire no grains for 3s.
// If the clock is already within the lookahead window (always true at ≤5ms periods)
// the scheduler naturally adopts the new period on the next onset, with no burst.
// This prevents the rapid slider-drag crash: each pixel of slider movement used to
// null the clock → burst of up to MAX_GRAINS_PER_TICK grains on the next tick.
export function resetCursorPeriod() {
  const audioNow = S.audioCtx?.currentTime ?? 0;
  if (_cursorNextOnsetT === null || _cursorNextOnsetT > audioNow + SCHED_LOOKAHEAD) {
    _cursorNextOnsetT  = null;
    _cursorNextPeriodS = null;
  }
}

// Register the global onset-clock reset callback so audio.js can invoke it
// when the AudioContext transitions from 'suspended' → 'running'.  Resetting
// here prevents the scheduler from trying to schedule grains at the frozen
// pre-suspension audioNow, which would be in the past by call-time and cause
// setValueCurveAtTime to throw (→ persistent snapping / "stuck on triangle").
S._resetOnsetClocks = () => {
  _cursorNextOnsetT  = null;
  _cursorNextPeriodS = null;
  // Also reset cloud onset clocks so they reinitialise cleanly from resumed time
  if (S.cloudSlots) {
    for (let i = 0; i < S.cloudSlots.length; i++) {
      const cloud = S.cloudSlots[i];
      if (cloud) delete cloud._nextOnsetT;
    }
  }
};
