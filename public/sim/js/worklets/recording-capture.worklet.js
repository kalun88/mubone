// ============================================================================
// RECORDING CAPTURE WORKLET — replaces ScriptProcessorNode for live recording
// Runs on the audio thread. Receives mono input from the mic chain,
// batches 128-sample blocks, and posts Float32Array chunks to the main thread.
// ============================================================================

class RecordingCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this._batchSize = 16;  // accumulate N × 128-sample blocks before posting
                           // 16 × 128 = 2048 samples per message (matches old
                           // ScriptProcessor buffer size for similar latency)
    this._blockSize = 128;

    // Pre-allocated ring buffer: batchSize * blockSize samples
    this._ring     = new Float32Array(this._batchSize * this._blockSize);
    this._writePos = 0;    // number of blocks written to ring
    this._active   = true;

    this.port.onmessage = ({ data }) => {
      if (data?.type === 'init') {
        if (data.batchSize > 0) {
          this._batchSize = data.batchSize;
          // Re-allocate ring if batch size changed
          this._ring = new Float32Array(this._batchSize * this._blockSize);
        }
        this._writePos = 0;
        this._active   = true;
      } else if (data?.type === 'stop') {
        // Flush any partial batch before stopping
        if (this._writePos > 0) this._flush();
        this._active = false;
      }
    };
  }

  _flush() {
    const totalFrames = this._writePos * this._blockSize;

    // Transfer only the filled portion of the ring
    const samples = this._ring.subarray(0, totalFrames);
    this.port.postMessage({ samples, frames: totalFrames }, [samples.buffer]);

    // Allocate a fresh ring for next batch
    this._ring     = new Float32Array(this._batchSize * this._blockSize);
    this._writePos = 0;
  }

  process(inputs) {
    if (!this._active) return true;

    const input = inputs[0];
    if (!input || !input[0]) return true;

    // Write directly into ring at writePos — zero allocation
    this._ring.set(input[0], this._writePos * this._blockSize);
    this._writePos++;

    if (this._writePos >= this._batchSize) {
      this._flush();
    }

    return true; // keep processor alive
  }
}

registerProcessor('recording-capture', RecordingCaptureProcessor);
