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

    // Ring buffer for pending interleaved PCM data
    this._ringSize = 8192;  // 8K interleaved frames capacity
    this._ring     = new Float32Array(this._ringSize);
    this._readPos  = 0;     // read position in ring (in interleaved frames)
    this._writePos = 0;     // write position in ring (in interleaved frames)

    this.port.onmessage = ({ data }) => {
      if (!data) return;
      if (data.type === 'init') {
        this._numChannels = Math.max(1, data.numChannels | 0);
        this._readPos     = 0;
        this._writePos    = 0;
      } else if (data.type === 'pcm' && data.interleaved) {
        // Copy incoming data into ring
        const incoming = data.interleaved;
        const inLen = incoming.length;

        // Simple copy: append incoming data to ring
        // Wrap around if needed (simple circular buffer)
        for (let i = 0; i < inLen; i++) {
          this._ring[this._writePos % this._ringSize] = incoming[i];
          this._writePos++;
        }
      }
    };
  }

  process(_inputs, outputs) {
    const n         = this._numChannels;
    const blockSize = 128;

    // How many interleaved frames we need per block
    const needed = blockSize * n;

    // How many frames available in ring?
    const available = (this._writePos - this._readPos + this._ringSize) % this._ringSize;
    if (available < needed) return true;

    // De-interleave: read needed frames from ring, write each channel to output
    for (let ch = 0; ch < n && ch < outputs[0].length; ch++) {
      const out = outputs[0][ch];
      for (let i = 0; i < blockSize; i++) {
        const ringIdx = (this._readPos + i * n + ch) % this._ringSize;
        out[i] = this._ring[ringIdx] ?? 0;
      }
    }

    // Advance read position by the frames we consumed
    this._readPos = (this._readPos + needed) % this._ringSize;

    return true;
  }
}

registerProcessor('input-meter', InputMeterProcessor);
