// ============================================================================
// MULTI-CHANNEL CAPTURE WORKLET — runs on the audio thread
// Receives N-channel audio from the Web Audio graph, batches into chunks,
// and posts interleaved Float32Arrays to the main thread for IPC → audify.
// N is configured at runtime via a { type: 'init', numChannels: N } message.
// Falls back to 4 channels if no init message is received (legacy quad compat).
// ============================================================================

class QuadCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this._numChannels = 4;   // default; overridden by 'init' message
    this._batchSize   = 4;   // accumulate N × 128-sample blocks before posting
                             // default 4 → 512 frames, matching default audify buffer.
                             // Overridden by 'init' batchSize to match audify bufferFrames.
    this._batch       = [];

    this.port.onmessage = ({ data }) => {
      if (data?.type === 'init') {
        if (data.numChannels > 0) this._numChannels = data.numChannels;
        if (data.batchSize   > 0) this._batchSize   = data.batchSize;
        this._batch = [];   // flush any partial batch from previous config
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length < this._numChannels) return true;

    const n = this._numChannels;

    // Snapshot each channel for this 128-sample block
    const block = [];
    for (let ch = 0; ch < n; ch++) {
      block.push(new Float32Array(input[ch] || new Float32Array(128)));
    }
    this._batch.push(block);

    if (this._batch.length >= this._batchSize) {
      const blockSize   = 128;
      const totalFrames = this._batchSize * blockSize;
      const interleaved = new Float32Array(totalFrames * n);

      for (let b = 0; b < this._batchSize; b++) {
        const blk = this._batch[b];
        for (let i = 0; i < blockSize; i++) {
          const base = (b * blockSize + i) * n;
          for (let ch = 0; ch < n; ch++) {
            interleaved[base + ch] = blk[ch][i];
          }
        }
      }

      // Transfer the buffer (zero-copy) to the main thread
      this.port.postMessage({ interleaved }, [interleaved.buffer]);
      this._batch = [];
    }

    return true; // keep processor alive
  }
}

registerProcessor('quad-capture', QuadCaptureProcessor);
