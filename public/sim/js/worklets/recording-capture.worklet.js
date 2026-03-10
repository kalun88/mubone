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
    this._batch     = [];
    this._active    = true;

    this.port.onmessage = ({ data }) => {
      if (data?.type === 'init') {
        if (data.batchSize > 0) this._batchSize = data.batchSize;
        this._batch  = [];
        this._active = true;
      } else if (data?.type === 'stop') {
        // Flush any partial batch before stopping
        if (this._batch.length > 0) this._flush();
        this._active = false;
      }
    };
  }

  _flush() {
    const blockSize   = 128;
    const totalFrames = this._batch.length * blockSize;
    const samples     = new Float32Array(totalFrames);

    for (let b = 0; b < this._batch.length; b++) {
      samples.set(this._batch[b], b * blockSize);
    }

    // Transfer the buffer (zero-copy) to the main thread
    this.port.postMessage({ samples, frames: totalFrames }, [samples.buffer]);
    this._batch = [];
  }

  process(inputs) {
    if (!this._active) return true;

    const input = inputs[0];
    if (!input || !input[0]) return true;

    // Copy channel 0 (mono) — must copy because the input buffer is reused
    this._batch.push(new Float32Array(input[0]));

    if (this._batch.length >= this._batchSize) {
      this._flush();
    }

    return true; // keep processor alive
  }
}

registerProcessor('recording-capture', RecordingCaptureProcessor);
