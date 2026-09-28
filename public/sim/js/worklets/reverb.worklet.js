// ============================================================================
// reverb.worklet.js — the master reverb's audio-thread half (js/master-reverb.js)
//
// AN INSERT, ONE REVERB PER OUTPUT CHANNEL. It sits in the output path, after
// the speaker buses are merged and before the ceiling: channel i in is what
// speaker i is about to play, channel i out is that plus its own reverb. So
// whatever is spatialised to a speaker — a loop, a grain cloud, the cursor, a
// tape stroke at 9 o'clock, the dry layer — rings out on that speaker and
// stays there (Ek, 2026-09-27). Nothing is sent back into anything, so it
// cannot feed itself.
//
//   out[i] = in[i] + wet · reverb_i(in[i])
//
// OFF passes the audio straight through and stops feeding the reverbs, so a
// tail already ringing finishes (trails, as a pedal's do) and then every
// reverb idles — an idle reverb costs a buffer copy. FREEZE holds the tails.
// The DSP is js/reverb.js; the main thread maps the knobs (reverbFromKnobs).
//
// processorOptions: { channels }  — fixed for the node's life
// Messages in:  { params }  every reverb.set(params) · { on } · { wet } (linear)
//               { clear: true }  silence every tail now
//               { stop: true }   replaced — stop processing for good
//               { muted }  clear, and feed nothing while muted · { bypass }  dry only (the sweep)
// Messages out: once a second { loadPct, idlePct } — time in process() against
//               the block budget, summed over the second (Date.now() is the only
//               clock here), and the share of reverb-blocks that were idle.
// ============================================================================

import { Reverb } from '../reverb.js';

class MuboneReverb extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const n = Math.max(1, options?.processorOptions?.channels | 0 || 1);
    this._r = Array.from({ length: n }, () => new Reverb(sampleRate, { outputs: 1 }));
    this._wetBuf = new Float32Array(128);
    this._outs = [this._wetBuf];
    this._on = false;
    this._wet = 0; this._wetTarget = 0;
    this._msSum = 0; this._blocks = 0; this._idle = 0; this._t0 = currentTime;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.params) for (const r of this._r) r.set(d.params);
      if (d.on != null) this._on = !!d.on;
      if (d.wet != null) this._wetTarget = Math.max(0, +d.wet || 0);
      if (d.clear) for (const r of this._r) r.clear();
      if (d.stop) this._stopped = true;   // replaced: process() returns false and the node can go
      // MUTED: clear every tail and feed nothing for the whole mute — clearing
      // once let the buses' 10 ms fade-out refill the reverbs (review,
      // 2026-09-27). BYPASS (the speaker sweep): feed nothing, add no wet.
      if (d.muted != null) { this._muted = !!d.muted; if (this._muted) for (const r of this._r) r.clear(); }
      if (d.bypass != null) this._bypass = !!d.bypass;
    };
  }

  process(inputs, outputs) {
    if (this._stopped) return false;
    const outs = outputs[0];
    if (!outs?.length) return true;
    const ins = inputs[0] || [];
    const t = Date.now();
    const len = outs[0].length;
    if (this._wetBuf.length !== len) { this._wetBuf = new Float32Array(len); this._outs[0] = this._wetBuf; }
    // The wet level glides across the block — a jump would click.
    const w0 = this._wet, w1 = this._wetTarget, dw = (w1 - w0) / len;
    this._wet = w1;
    const held = this._muted || this._bypass;
    for (let i = 0; i < outs.length; i++) {
      const inp = ins[i], out = outs[i], r = this._r[i];
      if (inp) out.set(inp); else out.fill(0);
      if (!r || held) continue;
      // Off: nothing new goes in; what is already ringing still comes out.
      r.process(this._on ? (inp || null) : null, this._outs, len);
      if (r.idle) { this._idle++; continue; }
      const wb = this._wetBuf;
      for (let s = 0; s < len; s++) out[s] += (w0 + dw * s) * wb[s];
    }
    this._msSum += Date.now() - t;
    this._blocks++;
    if (currentTime - this._t0 >= 1) {
      const budgetMs = this._blocks * len / sampleRate * 1000;
      this.port.postMessage({
        loadPct: Math.round(1000 * this._msSum / budgetMs) / 10,
        idlePct: Math.round(100 * this._idle / (this._blocks * this._r.length)),
      });
      this._msSum = 0; this._blocks = 0; this._idle = 0; this._t0 = currentTime;
    }
    return true;
  }
}

registerProcessor('mubone-reverb', MuboneReverb);
