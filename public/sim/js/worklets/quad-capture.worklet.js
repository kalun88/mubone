// ============================================================================
// MULTI-CHANNEL CAPTURE WORKLET — runs on the audio thread
// Receives N-channel audio from the Web Audio graph, batches into chunks,
// and posts interleaved Float32Arrays STRAIGHT to the Electron main process
// for audify, over a MessagePort transferred in by audio.js ({ type: 'port' }).
// The renderer's main thread is not in the path (2026-09-06): it used to relay
// every block and every credit, and a stall there longer than the cushion was
// a hole in the output.
//
// No flow control here: the main process knows the queue's true depth and
// regulates it (electron-main.js onOutputBlock — primed to the cushion when
// empty, skipped back to it when a lead builds). This side only produces.
//
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

    this._out     = null;    // the port to the main process, once transferred in

    this.port.onmessage = ({ data }) => {
      if (!data) return;
      if (data.type === 'init') {
        if (data.numChannels > 0) this._numChannels = data.numChannels;
        if (data.batchSize   > 0) this._batchSize   = data.batchSize;

        // Re-allocate ring if dimensions changed
        this._interleaved = new Float32Array(this._batchSize * this._blockSize * this._numChannels);
        this._writePos    = 0;
      } else if (data.type === 'port' && data.port) {
        this._out = data.port;
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

      // No port yet (the pair is still on its way from the preload): the
      // block goes nowhere. The ring is COPIED, not transferred: the main
      // process's end of a port hands a transferred ArrayBuffer over as null
      // (Electron 41), and a copy of one block is cheaper than the fresh ring
      // a transfer needs — no allocation here.
      if (this._out) {
        this._out.postMessage(totalSamples === this._interleaved.length ? this._interleaved : this._interleaved.subarray(0, totalSamples));
      }
      this._writePos = 0;
    }

    return true; // keep processor alive
  }
}

registerProcessor('quad-capture', QuadCaptureProcessor);
