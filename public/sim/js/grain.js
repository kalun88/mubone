import { S, HANN_LEN, HANN_ATTACK, HANN_RELEASE, MAX_CLOUDS, MAX_GRAIN_NODES, perf, gp, minGrainDurS, minGrainPeriodS } from './state.js';
import { ensureAudioContext, getMasterBus } from './audio.js';
import { spherePoint, qRotateVec, qConjugate, getCursorLonLat, screenToLonLat } from './sphere.js';

export function rand(min, max) { return min + Math.random() * (max - min); }

// activeGrainMap: particle → { expiry, glowColor } — shared with renderer
export let activeGrainMap = new Map();
export let selectedGrainSet = new Set();

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

export function playGrain(particle, customParams) {
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
    k:           S.grainOverrides.k           ?? p.k,
    period:      S.grainOverrides.period      ?? p.period,
    pitchJitter: S.grainOverrides.pitchJitter ?? p.pitchJitter,
    panSpread:   S.grainOverrides.panSpread   ?? p.panSpread,
    volume:      S.grainOverrides.volume      ?? p.volume,
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
  const LOOKAHEAD = 0.015;
  const baseTime  = actx.currentTime + LOOKAHEAD;

  let attackCurve, releaseCurve;
  if (customParams) {
    attackCurve  = new Float32Array(HANN_LEN);
    releaseCurve = new Float32Array(HANN_LEN);
    for (let j = 0; j < HANN_LEN; j++) {
      attackCurve[j]  = HANN_ATTACK[j]  * ep.volume;
      releaseCurve[j] = HANN_RELEASE[j] * ep.volume;
    }
  } else {
    attackCurve  = S.GRAIN_ATTACK_CURVE;
    releaseCurve = S.GRAIN_RELEASE_CURVE;
  }

  const dir = customParams ? 'fwd' : S.grainDirection;

  for (let i = 0; i < ep.sprayCount; i++) {
    const timeOffset = i * ep.spraySpread * rand(0.5, 1.5);
    const t          = baseTime + timeOffset;

    let startPos = particle.grainStart + rand(-ep.startJitter, ep.startJitter);
    const durVarSec = customParams ? 0 : (S.grainOverrides.durVar ?? 0);
    const dur = Math.max(minGrainDurS(),
      ep.duration * (1 + rand(-ep.durJitter, ep.durJitter))
      + rand(-durVarSec, durVarSec)
    );

    const cropLen = cropEndSec - cropStartSec;
    if (cropLen < dur) {
      startPos = cropStartSec;
    } else {
      startPos = Math.max(cropStartSec, Math.min(startPos, cropEndSec - dur));
    }

    const actualDur = Math.min(dur, cropEndSec - startPos);
    if (actualDur < minGrainDurS()) continue;

    const goReverse = dir === 'rev' || (dir === 'rnd' && Math.random() < 0.5);

    const fade   = Math.max(0.004, Math.min(ep.fade, actualDur / 3));
    const source = actx.createBufferSource();

    if (goReverse) {
      const sr         = buffer.sampleRate;
      const frameStart = Math.floor(startPos   * sr);
      const frameCount = Math.ceil(actualDur   * sr);
      const safeFc     = Math.min(frameCount, buffer.length - frameStart);
      if (safeFc < 2) continue;
      const revBuf = actx.createBuffer(buffer.numberOfChannels, safeFc, sr);
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const src = buffer.getChannelData(ch).subarray(frameStart, frameStart + safeFc);
        const dst = revBuf.getChannelData(ch);
        for (let f = 0; f < safeFc; f++) dst[f] = src[safeFc - 1 - f];
      }
      source.buffer = revBuf;
    } else {
      source.buffer = buffer;
    }

    const pitchRate = 1 + rand(-ep.pitchJitter, ep.pitchJitter);
    source.playbackRate.value = pitchRate;
    const bufferStartPos = goReverse ? 0 : startPos;

    const gain = actx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.setValueCurveAtTime(attackCurve,  t,               fade);
    gain.gain.setValueCurveAtTime(releaseCurve, t + actualDur - fade, fade);

    const [wx, wy, wz] = spherePoint(particle.lon, particle.lat);

    // Sim mode:      transform grain into camera space — panning is view-relative
    //                (turn your head left, a front grain moves right = pans right).
    // Physical mode: use world-space position directly — speakers are fixed in the
    //                room, turning your body doesn't move the sound. The camera
    //                (and sensor) still rotates visually but audio is absolute.
    const [cx, cy, cz] = S.spatialMode === 'physical'
      ? [wx, wy, wz]
      : qRotateVec(qConjugate(S.camQ), [wx, wy, wz]);

    // Elevation attenuation — shared by both paths
    const elevNorm  = cz !== 0 ? Math.min(1, Math.abs(cy / Math.abs(cz))) : 0;
    const elevScale = 1 - elevNorm * 0.35;
    const elevGain  = actx.createGain();
    elevGain.gain.value = elevScale;

    source.connect(gain);
    gain.connect(elevGain);

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

      elevGain.connect(gA); gA.connect(speakers[sA.idx].bus);
      elevGain.connect(gB); gB.connect(speakers[sB.idx].bus);

      source.start(t, bufferStartPos, actualDur);
      S._grainSourceCount++;
      source.addEventListener('ended', () => {
        S._grainSourceCount = Math.max(0, S._grainSourceCount - 1);
        try {
          source.disconnect(); gain.disconnect(); elevGain.disconnect();
          gA.disconnect(); gB.disconnect();
        } catch(_) {}
      });

    } else {
      // ── Stereo path (browser / no device selected) — unchanged ────────────
      const panner     = actx.createStereoPanner();
      const azimuthPan = cz !== 0 ? Math.max(-1, Math.min(1, cx / Math.abs(cz))) : 0;
      const jitter     = rand(-ep.panSpread * 0.4, ep.panSpread * 0.4);
      panner.pan.value  = Math.max(-1, Math.min(1, azimuthPan + jitter));

      elevGain.connect(panner);
      panner.connect(getMasterBus());

      source.start(t, bufferStartPos, actualDur);
      S._grainSourceCount++;
      source.addEventListener('ended', () => {
        S._grainSourceCount = Math.max(0, S._grainSourceCount - 1);
        try { source.disconnect(); gain.disconnect(); elevGain.disconnect(); panner.disconnect(); } catch(_) {}
      });
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
let _cursorLastFiredAt  = -Infinity;
let _cursorNextPeriodMs = null;

export function scheduleGrains() {
  const now = performance.now();
  if (_schedLastAt > 0) perf.schedulerDrift = Math.max(0, (now - _schedLastAt) - 30);
  _schedLastAt = now;

  if (S._grainSourceCount >= MAX_GRAIN_NODES) return;

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
    const basePeriodMs  = (S.grainOverrides.period ?? gp().period) * 1000;
    const periodVarMs   = (S.grainOverrides.periodVar ?? 0) * 1000;
    const livePeriodMs  = _cursorNextPeriodMs ?? basePeriodMs;
    const sinceLastMs   = now - _cursorLastFiredAt;

    if (sinceLastMs >= livePeriodMs) {
      _cursorLastFiredAt   = now;
      _cursorNextPeriodMs  = Math.max(minGrainPeriodS() * 1000, basePeriodMs + rand(-periodVarMs, periodVarMs));

      const withAng = S.particles.map(p => ({
        p,
        ang: angleBetweenSphere(p.lon, p.lat, cursorLon, cursorLat)
      }));

      let toGranulate = [];
      if (S.nearestMode) {
        withAng.sort((a, b) => a.ang - b.ang);
        toGranulate = applyRecencyFilter(withAng).slice(0, k).map(c => c.p);
      } else {
        const inRadius = withAng.filter(c => c.ang < searchRadiusRad);
        toGranulate = shuffleInPlace(applyRecencyFilter(inRadius)).slice(0, k).map(c => c.p);
      }

      if (toGranulate.length > 0) {
        if (!(S.grainProbability < 1.0 && Math.random() > S.grainProbability)) {
          const p = toGranulate[Math.floor(Math.random() * toGranulate.length)];
          const liveDurMs = (S.grainOverrides.duration ?? gp().duration) * 1000;
          activeGrainMap.set(p, { expiry: now + liveDurMs, glowColor: '#ffffff' });
          playGrain(p);
          perf.grainsFired++;
          if (p.source === 'live') S.liveGranulatingThisFrame = true;
        }
      }
    }
  }

  for (let i = 0; i < MAX_CLOUDS; i++) {
    const cloud = S.cloudSlots[i];
    if (!cloud || !S.particles.length) continue;

    const sinceLastMs = now - cloud._lastFiredAt;
    if (sinceLastMs < cloud._nextPeriodMs) continue;

    const cgp          = cloud.grainParams;
    const basePeriodMs = cgp.period * 1000;
    const periodVarMs  = (cgp.periodVar ?? 0) * 1000;
    cloud._lastFiredAt  = now;
    cloud._nextPeriodMs = Math.max(minGrainPeriodS() * 1000, basePeriodMs + rand(-periodVarMs, periodVarMs));

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

    if (!pool.length) continue;

    const p = pool[Math.floor(Math.random() * pool.length)];
    playGrain(p, cgp);
    activeGrainMap.set(p, { expiry: now + cgp.duration * 1000, glowColor: cloud.color });
    perf.grainsFired++;
    if (p.source === 'live') S.liveGranulatingThisFrame = true;
  }

  selectedGrainSet = new Set(activeGrainMap.keys());

  const gcEl = document.getElementById('granulatingCount');
  if (gcEl) gcEl.textContent = selectedGrainSet.size;
  const vmGrains = document.getElementById('vmGrains');
  if (vmGrains) vmGrains.textContent = `${selectedGrainSet.size} grains`;
}

// Reset onset period when period/periodVar changes (called from events.js)
export function resetCursorPeriod() {
  _cursorNextPeriodMs = null;
}
