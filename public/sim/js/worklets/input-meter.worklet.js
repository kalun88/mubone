// ============================================================================
// INPUT METER WORKLET
// Receives interleaved Float32 PCM chunks from the main thread (posted by
// Electron's RtAudio input callback via IPC), de-interleaves into per-channel
// buffers, and feeds them into the worklet outputs so AnalyserNodes can read
// them for the audio settings meter strip.
//
// Init message: { type: 'init', numChannels: N }
// PCM message:  { type: 'pcm', interleaved: Float32Array }  (transferable)
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

    this.port.onmessage = ({ data }) => {
      if (!data) return;
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
      } else if (data.type === 'pcm' && data.interleaved) {
        const incoming = data.interleaved;
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
      }
    };
  }

  process(_inputs, outputs) {
    const n         = this._numChannels;
    const blockSize = 128;
    const needed    = blockSize * n;
    const ring      = this._ring;
    const mask      = this._ringSize - 1;

    // How many interleaved samples available in ring?
    const available = (this._writePos - this._readPos + this._ringSize) & mask;
    if (available < needed) return true;

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
