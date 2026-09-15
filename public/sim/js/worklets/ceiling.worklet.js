// ============================================================================
// ceiling.worklet.js — the last thing before the audio leaves the app
//
// ONE CEILING, BOTH BUILDS (Ek, 2026-09-14: "i want it more unified, there
// should be no special case for web version"). Before this the two paths had
// different output stages and neither was right: Electron sent raw float
// straight to RtAudio with nothing checking the level, so a grain sum past
// ±1.0 clipped inside the converter, where no outboard limiter can reach it;
// the browser ran a WaveShaper whose tanh(4x)/tanh(4) curve had a 4.00×
// (+12.0 dB) small-signal gain, so the demo was louder and dirtier than the
// instrument — measured 1.18 % THD at −20 dBFS, 8.8 % at −10. Both are gone.
// This node is the ceiling for both, in the same place in each chain: the
// last stage before the signal leaves for a device.
//
// WHAT IT IS, AND WHAT IT IS NOT. It is a safety net, not a sound. Below the
// knee it is bit-exact — the gain is 1 and the samples are copied — so every
// ordinary passage passes through untouched. Above it, the level is bent
// smoothly toward the ceiling and never past it.
//
//   ZERO LATENCY. No lookahead, so nothing gets slower (Ek's standing
//   constraint on the interpolation change holds here too). The price is that
//   this cannot be a true brickwall on an inter-sample peak; it is a
//   waveshaper with a linked detector, which is the zero-latency answer.
//
//   LINKED WITHIN A GROUP, NOT ACROSS THE WHOLE DEVICE. The gain is computed
//   from the loudest channel of a group and applied to every channel in it.
//   Linking matters because per-channel limiting would duck one speaker of a
//   VBAP pair on its own and pull the phantom image sideways — the one
//   artefact a spatial rig cannot afford. GROUPING matters because the house
//   and the headphone pair are different destinations that happen to share
//   one interface: linked across all of them, a hot monitor mix would duck
//   the room, and a loud room would duck the player's headphones (Ek,
//   2026-09-14: "it needs to be good for every case … more automatic and
//   just doing the job"). audio.js passes the map — house is group 0, the
//   monitor pair group 1 — and with no map at all every channel is group 0,
//   which is the browser's stereo pair.
//
//   NOTHING HERE SCALES WITH SPEAKER COUNT. The threshold is each channel
//   against ITS OWN full scale, which is what the converter cares about, and
//   VBAP splits a grain between two speakers whatever the total is — so six
//   speakers carry fewer grains each than two, not more. 2, 6, 8 and 8+2 need
//   the same two numbers, which is why neither is a setting.
//
//   NO RELEASE TIME. There is no envelope to pump: the gain is a function of
//   the sample in hand. A release constant is what makes a limiter breathe,
//   and breathing is a sound.
//
// IT REPORTS, AND THE FOOTER DRAWS IT. A safety net nobody can see is a
// crutch (Ek, 2026-09-14: "i don't see anything in the gui re ceiling"). The
// node posts the deepest gain reduction of each ~50 ms window and the levels
// row has a CEIL column beside OUT — a gain-reduction meter, empty in the
// normal state, growing down from the top as level comes off. Nothing here
// changes what you hear until the signal is within a hair of the top, and by
// then you want to know.
// ============================================================================

// The knee: unity below this magnitude, bending above. −3.1 dBFS, so the
// whole normal working range of the instrument is untouched.
const KNEE = 0.7;
// The ceiling the curve approaches but never reaches. −0.09 dBFS, a hair
// under full scale so the converter never sees a sample at 1.0.
const CEIL = 0.99;

class Ceiling extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._n = (options?.processorOptions?.numChannels) | 0 || 2;
    // channel → link group. Absent means one group, which is the stereo case.
    const g = options?.processorOptions?.groups;
    this._groups = (Array.isArray(g) && g.length === this._n) ? Int32Array.from(g) : null;
    this._nGroups = this._groups ? (Math.max(...g) + 1) : 1;
    this._gMax = new Float32Array(this._nGroups);   // per-group peak, per frame
    this._minGain = 1;          // the deepest reduction this window
    this._frames  = 0;
    this._engaged = 0;          // frames the ceiling actually acted on
    this._reportEvery = Math.max(128, Math.round(sampleRate / 20));   // ~20 Hz
  }

  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    const nCh = Math.min(inp.length, out.length);
    const len = out[0].length;

    const groups = this._groups, gMax = this._gMax, nG = this._nGroups;
    const span = CEIL - KNEE;

    for (let i = 0; i < len; i++) {
      // The loudest channel of each group decides that group's gain.
      let anyOver = false;
      if (nG === 1) {
        let m = 0;
        for (let ch = 0; ch < nCh; ch++) { const a = inp[ch][i]; const v = a < 0 ? -a : a; if (v > m) m = v; }
        gMax[0] = m; anyOver = m > KNEE;
      } else {
        for (let g = 0; g < nG; g++) gMax[g] = 0;
        for (let ch = 0; ch < nCh; ch++) {
          const a = inp[ch][i]; const v = a < 0 ? -a : a;
          const g = groups[ch];
          if (v > gMax[g]) gMax[g] = v;
        }
        for (let g = 0; g < nG; g++) if (gMax[g] > KNEE) { anyOver = true; break; }
      }
      if (!anyOver) {                        // bit-exact below the knee
        for (let ch = 0; ch < nCh; ch++) out[ch][i] = inp[ch][i];
        continue;
      }
      // Above it: tanh bends the excess toward the ceiling and never past.
      // At m = KNEE the curve is continuous and its slope is 1, so there is
      // no corner to hear on the way in. A group under the knee keeps a gain
      // of exactly 1 and is copied, so one loud group cannot touch another.
      for (let ch = 0; ch < nCh; ch++) {
        const m = gMax[nG === 1 ? 0 : groups[ch]];
        if (m <= KNEE) { out[ch][i] = inp[ch][i]; continue; }
        const gain = (KNEE + span * Math.tanh((m - KNEE) / span)) / m;
        out[ch][i] = inp[ch][i] * gain;
        if (gain < this._minGain) this._minGain = gain;
      }
      this._engaged++;
    }

    // ~20 Hz report: the deepest reduction of the window and how much of it
    // was acted on. A gain-reduction meter has to move at the speed of the
    // thing it is reporting — once a second reads as a lamp, not a meter —
    // and 20 posts a second outside the sample loop is the same order as the
    // grain engine's own feedback.
    this._frames += len;
    if (this._frames >= this._reportEvery) {
      this.port.postMessage({
        grDb: this._minGain < 1 ? 20 * Math.log10(this._minGain) : 0,
        engagedPct: 100 * this._engaged / this._frames,
      });
      this._minGain = 1; this._engaged = 0; this._frames = 0;
    }
    return true;
  }
}

registerProcessor('ceiling', Ceiling);
