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
    this._batchSize   = 8;   // accumulate N × 128-sample blocks before posting
                             // default 8 → 1024 frames, matching default audify buffer.
                             // Overridden by 'init' batchSize to match audify bufferFrames.
    this._blockSize   = 128;

    // Pre-allocated interleaved ring buffer
    // Stored as: sample[0,ch0], sample[0,ch1], ..., sample[1,ch0], sample[1,ch1], ...
    this._interleaved = new Float32Array(this._batchSize * this._blockSize * this._numChannels);
    this._writePos    = 0;   // number of blocks written to ring

    this.port.onmessage = ({ data }) => {
      if (data?.type === 'init') {
        if (data.numChannels > 0) this._numChannels = data.numChannels;
        if (data.batchSize   > 0) this._batchSize   = data.batchSize;

        // Re-allocate ring if dimensions changed
        this._interleaved = new Float32Array(this._batchSize * this._blockSize * this._numChannels);
        this._writePos    = 0;
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length < this._numChannels) return true;

    const n = this._numChannels;

    // Write directly into interleaved ring — zero allocation
    // For each sample i in this 128-sample block, write all channels in interleaved order
    const baseOffset = this._writePos * this._blockSize * n;
    for (let i = 0; i < this._blockSize; i++) {
      for (let ch = 0; ch < n; ch++) {
        this._interleaved[baseOffset + i * n + ch] = input[ch][i] || 0;
      }
    }

    this._writePos++;

    if (this._writePos >= this._batchSize) {
      const totalFrames = this._batchSize * this._blockSize;
      const totalSamples = totalFrames * n;

      // Transfer only the filled portion of the ring
      const interleaved = this._interleaved.subarray(0, totalSamples);
      this.port.postMessage({ interleaved }, [interleaved.buffer]);

      // Allocate a fresh ring for next batch
      this._interleaved = new Float32Array(this._batchSize * this._blockSize * this._numChannels);
      this._writePos    = 0;
    }

    return true; // keep processor alive
  }
}

registerProcessor('quad-capture', QuadCaptureProcessor);
