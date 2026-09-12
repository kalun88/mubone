// ============================================================================
// INPUT METER WORKLET
// Receives interleaved Float32 PCM chunks STRAIGHT from Electron's RtAudio
// input callback, over a MessagePort transferred in by ui-audio-settings.js
// ({ type: 'port' }) — the renderer's main thread is not in the path
// (2026-09-06; it used to relay every chunk, and its stalls arrived here as
// bursts). De-interleaves into per-channel buffers and feeds them into the
// worklet outputs so AnalyserNodes can read them for the audio settings meter
// strip, and the recording path can take a channel.
//
// Init message:   { type: 'init', numChannels: N }
// Port message:   { type: 'port', port: MessagePort }   (transferred)
// Target message: { type: 'target', frames }            (the stall cushion)
// On the port:    a Float32Array of interleaved samples per RtAudio callback
// ============================================================================

class InputMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._numChannels = 2;

    // Ring buffer for pending interleaved PCM data.
    // Sized per channel count — must hold several RtAudio callbacks worth of
    // interleaved samples.  For 10ch @ 512-frame buffers each callback is
    // 5120 samples; we want headroom for 4+ callbacks.
    this._ringSize = 32768;
    this._ring     = new Float32Array(this._ringSize);
    this._readPos  = 0;     // read cursor (always in [0, ringSize))
    this._writePos = 0;     // write cursor (always in [0, ringSize))

    // Faults since the last report. A dry gap is a run of blocks with no
    // data — silence handed downstream, straight into a take if one is
    // recording — counted once per gap, so an idle stream is one gap, not
    // a count that climbs forever. An overflow is samples skipped. Reported
    // once a second, only when something happened.
    this._dry      = 0;
    this._overflow = 0;
    this._blocks   = 0;
    this._wasFed   = false;
    // The stall cushion (2026-09-04, #333): frames the ring may hold. Chunks
    // used to arrive through the renderer's main thread in bursts, and the
    // fill locked in at the worst burst since the last dry-out — 37 ms
    // measured. Since the direct port (2026-09-06) a burst can only come from
    // the main process's own jitter, but the rule stands: after a burst leaves
    // the ring deeper than this, the reader skips to it — one discontinuity
    // instead of a permanent delay. 0 = unbounded (the old behaviour).
    this._targetFrames = 0;
    this._skipped  = 0;
    // The fill is a CHOICE too (2026-09-06): with chunks arriving straight
    // from the main process the ring ran at one or two chunks, and any jitter
    // there was a dry block — silence handed into a take. So the reader waits
    // until the ring holds the target before it starts, and again after it has
    // run dry: a jitter buffer, with the cushion as its depth. 0 = no pre-roll.
    this._primed   = false;
    this._under    = 0;     // blocks in a row the fill has sat under the target's margin

    this._in = null;   // the port from the main process, once transferred in

    this.port.onmessage = ({ data }) => {
      if (!data) return;
      if (data.type === 'target') {
        const frames = Math.max(0, data.frames | 0);
        // A deeper target: pre-roll again (one gap, on a setting change).
        // A shallower one needs nothing — the next chunk finds the excess and
        // skips it.
        if (frames > this._targetFrames) this._primed = false;
        this._targetFrames = frames;
        return;
      }
      if (data.type === 'port' && data.port) {
        this._in = data.port;
        this._in.onmessage = ({ data: pcm }) => { if (pcm && pcm.length) this._push(pcm); };
        return;
      }
      if (data.type === 'init') {
        this._numChannels = Math.max(1, data.numChannels | 0);
        // Scale ring to hold ~100ms of interleaved audio (min 32K samples).
        // 100ms @ 48kHz * 10ch = 48000 samples.  Round up to power of 2.
        const minSamples = Math.max(32768, this._numChannels * 8192);
        let size = 32768;
        while (size < minSamples) size <<= 1;
        if (size !== this._ringSize) {
          this._ringSize = size;
          this._ring     = new Float32Array(size);
        }
        this._readPos  = 0;
        this._writePos = 0;
      }
    };
  }

  // One chunk of interleaved PCM into the ring.
  _push(incoming) {
    const inLen    = incoming.length;
    const ring     = this._ring;
    const mask     = this._ringSize - 1;   // ringSize is power of 2

    // Check for overflow: if incoming chunk would overwrite unread data,
    // snap read position forward so we only lose the oldest samples rather
    // than reading a corrupt splice of old and new data.
    const used = (this._writePos - this._readPos + this._ringSize) & mask;
    const willUse = used + inLen;
    if (willUse > this._ringSize) {
      // Overflow — advance read past the region about to be overwritten.
      // Align to a frame boundary so de-interleave stays in phase.
      this._overflow++;
      const n = this._numChannels;
      const overshoot = willUse - this._ringSize;
      const skipFrames = Math.ceil(overshoot / n);
      this._readPos = (this._readPos + skipFrames * n) & mask;
    }

    // Copy incoming data into ring (branchless wrap via bitmask)
    let wp = this._writePos;
    for (let i = 0; i < inLen; i++) {
      ring[wp & mask] = incoming[i];
      wp = (wp + 1) & mask;
    }
    this._writePos = wp;
    // Past the cushion after this chunk: skip the oldest excess.
    if (this._targetFrames > 0) {
      const n = this._numChannels;
      const fill = ((this._writePos - this._readPos + this._ringSize) & mask) / n;
      // The jitter margin: chunks can still arrive two and three at a time
      // from a busy main process, and a skip is a click — only a burst well
      // past the ordinary is skipped, down to the target. 10 ms, or four chunks.
      const chunk = (inLen / n) | 0;
      const slack = Math.max(4 * chunk, Math.round(sampleRate * 0.010));
      if (fill > this._targetFrames + slack) {
        const skipFrames = (fill - this._targetFrames) | 0;
        this._readPos = (this._readPos + skipFrames * n) & mask;
        this._skipped += skipFrames;
      }
    }
  }

  process(_inputs, outputs) {
    const n         = this._numChannels;
    const blockSize = 128;
    const needed    = blockSize * n;
    const ring      = this._ring;
    const mask      = this._ringSize - 1;

    // Once a second: the fill, and any faults.
    if (++this._blocks >= 375) {
      this._blocks = 0;
      const fill = ((this._writePos - this._readPos + this._ringSize) & mask) / n;
      this.port.postMessage({ type: 'faults', dry: this._dry, overflow: this._overflow, skipped: this._skipped, fillFrames: fill });
      this._dry = 0;
      this._overflow = 0;
      this._skipped = 0;
    }

    // How many interleaved samples available in ring?
    const available = (this._writePos - this._readPos + this._ringSize) & mask;
    // Pre-roll: silence until the ring holds the cushion.
    if (!this._primed) {
      if (this._targetFrames > 0 && available < this._targetFrames * n) return true;
      this._primed = true;
      this._under = 0;
    }
    if (available < needed) {
      if (this._wasFed) this._dry++;
      this._wasFed = false;
      this._primed = false;
      return true;
    }
    this._wasFed = true;
    // A fill that has sat under the cushion by more than its margin for a
    // whole second is a stall waiting to happen (a skip that landed short, a
    // clock a shade slow): pre-roll again now, on purpose, as one dry gap.
    if (this._targetFrames > 0) {
      const slackFrames = Math.max(4 * blockSize, Math.round(sampleRate * 0.010));
      if (available < (this._targetFrames - slackFrames) * n) {
        if (++this._under >= 375) { this._under = 0; this._primed = false; this._dry++; return true; }
      } else this._under = 0;
    }

    // De-interleave: read needed samples from ring, fan out to per-channel outputs
    const rp = this._readPos;
    for (let ch = 0; ch < n && ch < outputs[0].length; ch++) {
      const out = outputs[0][ch];
      for (let i = 0; i < blockSize; i++) {
        out[i] = ring[(rp + i * n + ch) & mask];
      }
    }

    // Advance read position by the interleaved samples we consumed
    this._readPos = (rp + needed) & mask;

    return true;
  }
}

registerProcessor('input-meter', InputMeterProcessor);
