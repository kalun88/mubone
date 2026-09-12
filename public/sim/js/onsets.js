// ============================================================================
// onsets.js — noise-floor-adaptive onset detection for the slice tool (#219)
//
// WHY THIS SHAPE. The old segmentation (`_chopStroke` in trigger.js) splits on
// gaps between deposited marks, which only exist where the paint gate closed —
// so it inherits the gate threshold, and Ek cannot anticipate the noise floor
// of a room. This detector works on the AUDIO, in the dB domain, against a
// LOCAL MEDIAN threshold, which makes it floor-immune by construction:
//
//   - The envelope is framed RMS converted to dB. A hit rising out of ANY
//     floor produces a large dB step; steady noise produces small self-noise
//     flux whatever its absolute level.
//   - The onset function is the half-wave rectified dB rise over the recent
//     past (two frames back, so slower attacks still register whole).
//   - The threshold is median(flux) over a ±500 ms window, scaled, plus a
//     fixed dB offset. The median tracks whatever the material's background
//     flux is — silence, hiss, or wash — so "louder than the room" is always
//     measured relative to the room.
//   - A refractory gap suppresses double-fires inside one attack; a swell
//     spread over hundreds of ms never exceeds the per-frame rise offset, so
//     legato material does not oversegment (the failure mode of the old
//     100 ms gap rule was the opposite — everything segmented).
//
// Onset times are backed up to the FOOT of the rise, so a segment starts at
// its attack rather than mid-transient (the 5 ms declick in stopLiveRecording
// is all the safety a trigger's top needs).
//
// Pure function, no S, no DOM — tuned and regression-tested by
// scripts/trigger-audit.js § F and runnable in plain node.
// ============================================================================

export const ONSET_DEFAULTS = {
  winMs:     20,    // analysis frame
  hopMs:     10,    // frame hop
  medianMs:  500,   // local-median window (± half each side)
  k:         2.0,   // median scale
  deltaDb:   4.0,   // fixed rise floor (dB) — a swell slower than this per
                    // ~2 frames is not an onset
  minGapMs:  90,    // refractory — one onset per attack
  leadMs:    5,     // small pre-roll before the rise foot — enough to keep
                    // the transient whole, small enough not to reach into a
                    // previous hit's decay at tremolo spacing
};

/**
 * @param {Float32Array} data  mono samples
 * @param {number} sr          sample rate
 * @param {object} opts        overrides for ONSET_DEFAULTS
 * @returns {number[]} onset times in seconds, always beginning with 0
 */
export function detectOnsets(data, sr, opts = {}) {
  const o = { ...ONSET_DEFAULTS, ...opts };
  const win = Math.max(8, Math.round(sr * o.winMs / 1000));
  const hop = Math.max(4, Math.round(sr * o.hopMs / 1000));
  const nFrames = Math.max(0, Math.floor((data.length - win) / hop) + 1);
  if (nFrames < 4) return [0];

  // Framed RMS → dB
  const db = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    let sum = 0;
    const off = f * hop;
    for (let i = 0; i < win; i++) { const v = data[off + i]; sum += v * v; }
    db[f] = 20 * Math.log10(Math.sqrt(sum / win) + 1e-6);
  }

  // Half-wave rectified rise over the recent past (min of 1–2 frames back)
  const flux = new Float32Array(nFrames);
  for (let f = 2; f < nFrames; f++) {
    flux[f] = Math.max(0, db[f] - Math.min(db[f - 1], db[f - 2]));
  }

  // Local median threshold
  const halfW = Math.max(2, Math.round(o.medianMs / o.hopMs / 2));
  const scratch = [];
  const onsets = [0];
  let lastOnsetS = -Infinity;
  const minGapS = o.minGapMs / 1000;

  for (let f = 2; f < nFrames; f++) {
    if (flux[f] <= 0) continue;
    // local max in ±2 frames — one report per rise
    if (flux[f] < flux[f - 1] || (f + 1 < nFrames && flux[f] < flux[f + 1])
        || (f + 2 < nFrames && flux[f] < flux[f + 2])) continue;

    scratch.length = 0;
    const a = Math.max(0, f - halfW), b = Math.min(nFrames - 1, f + halfW);
    for (let i = a; i <= b; i++) scratch.push(flux[i]);
    scratch.sort((x, y) => x - y);
    const med = scratch[scratch.length >> 1];

    if (flux[f] > med * o.k + o.deltaDb) {
      // Foot of the rise: one frame back (where the climb started), plus a
      // small lead. Two frames back over-reached — at 8 Hz tremolo it landed
      // inside the previous hit's decay.
      const t = Math.max(0, (f - 1) * hop / sr - o.leadMs / 1000);
      if (t - lastOnsetS >= minGapS && t > 0.001) {
        onsets.push(t);
        lastOnsetS = t;
      } else if (t <= 0.001) {
        lastOnsetS = 0;   // an attack at the very top — segment 0 owns it
      }
    }
  }
  return onsets;
}
