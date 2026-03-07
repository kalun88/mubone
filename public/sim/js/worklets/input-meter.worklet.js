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
    this._pending     = [];   // queue of Float32Array chunks to drain

    this.port.onmessage = ({ data }) => {
      if (!data) return;
      if (data.type === 'init') {
        this._numChannels = Math.max(1, data.numChannels | 0);
        this._pending     = [];
      } else if (data.type === 'pcm' && data.interleaved) {
        this._pending.push(data.interleaved);
      }
    };
  }

  process(_inputs, outputs) {
    const n         = this._numChannels;
    const blockSize = 128;

    // How many interleaved frames we need per block
    const needed = blockSize * n;

    if (this._pending.length === 0) return true;

    // Merge pending chunks into one flat array, then drain blockSize frames
    const chunk = this._pending.shift();
    if (!chunk || chunk.length < needed) return true;

    // De-interleave: write each channel into its output
    for (let ch = 0; ch < n && ch < outputs[0].length; ch++) {
      const out = outputs[0][ch];
      for (let i = 0; i < blockSize; i++) {
        out[i] = chunk[i * n + ch] ?? 0;
      }
    }

    // If the chunk had more frames than one block, put the remainder back
    if (chunk.length > needed) {
      this._pending.unshift(chunk.subarray(needed));
    }

    return true;
  }
}

registerProcessor('input-meter', InputMeterProcessor);
