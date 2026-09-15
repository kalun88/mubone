// ============================================================================
// LIVE-LOOP WORKLET — #209 prototype: a loop that plays while it is being
// written. The `1`+`Q` gesture (docs/archive/BRUSH-MODEL.md § 3c v3b): a line records
// and loops as it is drawn, like a looper pedal.
//
// Why a worklet, and why it records its own copy: the write frontier and the
// read head must live on the same thread. The main-thread live buffer
// (rebuildLiveBuffer) lags the input by up to LIVE_REBUILD_INTERVAL_MS + one
// capture batch (~93 ms), so a loop reading it would need a safety margin that
// large behind the frontier. Recording in-thread makes the frontier exact to
// the sample and costs one duplicate buffer for the duration of the gesture.
// Integration note: on close, ownership of the material can hand over to the
// finalized stroke buffer (stopLiveRecording) via the normal loop path; this
// node only has to live while the keys are held.
//
// THE WRAP RULE — the one real design decision in here:
//
//   The loop end advances AT THE WRAP, not continuously.
//
// A loop whose end tracks the frontier continuously never wraps at 1× speed:
// the read head starts a constant gap behind the write head and can never
// close it, so "loop the growing buffer" degenerates into a delay line.
// Snapshotting the end when a pass begins means each pass plays the material
// that existed at the previous wrap, and the loop grows pass over pass —
// which is what "recording into a loop that is already looping" means.
// Two refinements fall out of the buffer being contiguous:
//   - extending the end MID-PASS is always seamless (the material after the
//     old end is what was recorded next), so `close` extends immediately
//     rather than waiting a full pass — the freshly painted tail is heard
//     right away;
//   - the ONLY discontinuity anywhere is the wrap itself (end → start), so
//     the declick is one crossfade at one place.
//
// THE SEAM — a real-time equal-power crossfade, not a baked one.
// buildLoopPayload bakes its 30 ms crossfade destructively into an extracted
// copy; here the end moves every pass, so each wrap has a NEW seam and nothing
// can be baked. During the last `xfade` samples of a pass the tail is blended
// against the head [0, xfade); after the wrap, reading continues from `xfade`
// so the head is not played twice.
//
// Held for 30 seconds? Nothing special: the buffer grows by amortised
// doubling (same policy as recordingRaw's pool) and the loop just gets long.
// The memory ceiling at integration time is the existing recLimitSeconds
// guard in startLiveRecording — this node adds no policy of its own.
// ============================================================================

const INITIAL_BUF_S = 16;    // first allocation; doubles as needed
const CAPTURE_MAX_S = 60;    // output-capture ceiling (diagnostics only)

class LiveLoopProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this._buf      = null;   // mono recording, allocated on 'record'
    this._writePos = 0;
    this._recording = false;
    this._closed    = false; // recording finished; _writePos is final

    this._looping  = false;  // playback armed ('loop' received)
    this._loopEnd  = 0;      // samples; 0 = not yet established
    this._readPos  = 0;      // fractional
    this._speed    = 1.0;

    this._minLoopSamp = Math.round(sampleRate * 0.5);
    this._xfadeSamp   = Math.round(sampleRate * 0.030);
    this._initialBufSamp = Math.round(sampleRate * INITIAL_BUF_S);
    this._fadeInRemaining = 0;   // preload-junction declick countdown

    // Stop ramp — 3 ms to mask the cut, matching DECLICK_S on the main side.
    this._stopping  = false;
    this._gain      = 1.0;
    this._gainStep  = 1 / Math.round(sampleRate * 0.003);

    // Diagnostics. Wrap events carry the capture index so the harness can
    // find each seam in the recorded output and measure its discontinuity.
    this._wrapCount  = 0;
    this._allocCount = 0;
    this._processCalls = 0;   // diag: 0 after a second means the node is not
    this._inputBlocks  = 0;   // being pulled (no path to a rendering sink)
    this._readAheadViolations = 0;  // readPos past writePos — must stay 0
    this._wrapEvents = [];
    this._cap    = null;     // output capture, enabled via 'config'
    this._capPos = 0;

    this.port.onmessage = ({ data }) => this._onMessage(data);
  }

  _onMessage(d) {
    switch (d?.type) {
      case 'config':
        if (d.minLoopS != null) this._minLoopSamp = Math.round(sampleRate * d.minLoopS);
        if (d.xfadeS   != null) this._xfadeSamp   = Math.round(sampleRate * d.xfadeS);
        // Test hook: a small initial buffer makes the growth path reachable
        // in a short take (§ H of live-loop-audit) instead of after 16 s.
        if (d.initialBufS != null) this._initialBufSamp = Math.round(sampleRate * d.initialBufS);
        if (d.capture) this._cap = new Float32Array(Math.round(sampleRate * CAPTURE_MAX_S));
        break;
      case 'record':
        if (!this._buf) {
          this._buf = new Float32Array(this._initialBufSamp);
        }
        this._recording = true;
        this._closed    = false;
        break;
      case 'preload': {
        // The stroke-so-far, handed over from the main thread's recordingRaw
        // at Q-press, so the loop covers the stroke from its START (§ 1c)
        // rather than from the moment the layer key went down. The main
        // buffer lags live input by up to one capture batch (~43 ms), so the
        // junction between preloaded and live material is a real gap in the
        // signal — declick both sides: a 2 ms fade-out on the preload tail
        // here, and a matching fade-in on the first live block in _append().
        const arr = d.samples;
        if (!(arr instanceof Float32Array) || !arr.length) break;
        if (!this._buf || this._buf.length < this._writePos + arr.length) {
          const need = this._writePos + arr.length;
          const grown = new Float32Array(Math.max(this._initialBufSamp, need * 2));
          if (this._buf) grown.set(this._buf);
          this._buf = grown;
          this._allocCount++;
        }
        this._buf.set(arr, this._writePos);
        const f = Math.min(Math.round(sampleRate * 0.002), arr.length);
        for (let k = 0; k < f; k++) {
          this._buf[this._writePos + arr.length - 1 - k] *= k / f;
        }
        this._writePos += arr.length;
        this._fadeInRemaining = Math.round(sampleRate * 0.002);
        break;
      }
      case 'loop':
        // Loop start is always 0 — the hold covers the whole stroke so far
        // (§ 1c: "on a line stroke — its buffer, as a loop"). If not enough
        // material exists yet (keys pressed together), the first pass begins
        // when _minLoopSamp is reached; until then the loop is silent and the
        // dry monitor covers it musically.
        this._looping = true;
        if (this._loopEnd === 0 && this._writePos >= this._minLoopSamp) {
          this._loopEnd = this._writePos;
          this._readPos = 0;
        }
        break;
      case 'close':
        // Either key released: the whole stroke becomes the loop, now.
        // Extending mid-pass is seamless (see header); mid-crossfade the pass
        // is already committed to wrapping, so the tail joins next pass.
        this._recording = false;
        this._closed    = true;
        if (this._looping && this._loopEnd > 0
            && this._readPos < this._loopEnd - this._xfade()) {
          this._loopEnd = this._writePos;
        }
        break;
      case 'stop':
        this._stopping = true;
        break;
      case 'speed':
        if (d.value > 0) this._speed = d.value;
        break;
      case 'state':
        this.port.postMessage({
          type: 'state',
          sampleRate,
          writePos:   this._writePos,
          loopEnd:    this._loopEnd,
          readPos:    this._readPos,
          recording:  this._recording,
          closed:     this._closed,
          looping:    this._looping,
          wrapCount:  this._wrapCount,
          allocCount: this._allocCount,
          readAheadViolations: this._readAheadViolations,
          processCalls: this._processCalls,
          inputBlocks:  this._inputBlocks,
          bufLen:     this._buf ? this._buf.length : 0,
          capPos:     this._capPos,
        });
        break;
      case 'dump': {
        // Hand the captured output back for seam analysis. Copy, don't
        // transfer — the capture keeps accumulating if playback continues.
        const cap = this._cap ? this._cap.slice(0, this._capPos) : new Float32Array(0);
        this.port.postMessage({ type: 'dump', cap, wrapEvents: this._wrapEvents }, [cap.buffer]);
        break;
      }
    }
  }

  // Effective crossfade for the current pass — short loops shrink it the same
  // way buildLoopPayload does (¼ of the region) so tiny first passes still wrap.
  _xfade() {
    return Math.min(this._xfadeSamp, Math.floor(this._loopEnd / 4));
  }

  _append(block) {
    const need = this._writePos + block.length;
    if (need > this._buf.length) {
      const grown = new Float32Array(this._buf.length * 2);
      grown.set(this._buf);
      this._buf = grown;
      this._allocCount++;
    }
    this._buf.set(block, this._writePos);
    // Second half of the preload-junction declick — see 'preload'.
    if (this._fadeInRemaining > 0) {
      const total = Math.round(sampleRate * 0.002);
      for (let k = 0; k < block.length && this._fadeInRemaining > 0; k++, this._fadeInRemaining--) {
        this._buf[this._writePos + k] *= 1 - this._fadeInRemaining / total;
      }
    }
    this._writePos += block.length;
  }

  // 4-point Hermite, clamped to written material (2026-09-14). The same swap
  // the grain engine got: at speed 1.0 this never interpolates at all (the
  // position walks whole samples), but a loop played at any other speed read
  // a straight line between two samples, and that is the dominant distortion
  // the moment the speed leaves 1. Catmull-Rom through x0 and x1; the guard
  // and the read-ahead counter are unchanged, and the ends hold rather than
  // reaching for material that is not written yet.
  _read(pos) {
    const i = pos | 0;
    if (i + 1 >= this._writePos) {
      if (pos > this._writePos) this._readAheadViolations++;
      return i < this._writePos ? this._buf[i] : 0;
    }
    const f = pos - i;
    if (f === 0) return this._buf[i];             // whole sample: nothing to interpolate
    const b = this._buf, w = this._writePos;
    const x0 = b[i], x1 = b[i + 1];
    const xm = i > 0 ? b[i - 1] : x0;
    const x2 = i + 2 < w ? b[i + 2] : x1;
    const c1 = 0.5 * (x1 - xm);
    const c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2;
    const c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
    return ((c3 * f + c2) * f + c1) * f + x0;
  }

  process(inputs, outputs) {
    const input  = inputs[0] && inputs[0][0];
    const output = outputs[0][0];
    this._processCalls++;
    if (input) this._inputBlocks++;

    if (this._recording && input) this._append(input);

    if (!this._looping || this._stopping && this._gain <= 0) {
      if (this._cap && this._capPos + output.length <= this._cap.length) {
        this._capPos += output.length;  // keep capture aligned with wall time
      }
      return true;
    }

    // First pass not yet possible at 'loop' time — begin as soon as the
    // minimum exists.
    if (this._loopEnd === 0) {
      if (this._writePos >= this._minLoopSamp) {
        this._loopEnd = this._writePos;
        this._readPos = 0;
      } else {
        if (this._cap && this._capPos + output.length <= this._cap.length) {
          this._capPos += output.length;
        }
        return true;
      }
    }

    const n = output.length;
    for (let s = 0; s < n; s++) {
      const xf = this._xfade();
      const fadeStart = this._loopEnd - xf;
      let out;
      if (this._readPos < fadeStart) {
        out = this._read(this._readPos);
      } else {
        // Equal-power blend of tail against head [0, xf).
        const k = this._readPos - fadeStart;           // 0 → xf
        const t = (k / xf) * Math.PI * 0.5;
        out = this._read(this._readPos) * Math.cos(t) + this._read(k) * Math.sin(t);
      }

      if (this._stopping) {
        this._gain = Math.max(0, this._gain - this._gainStep);
        if (this._gain === 0) { this._looping = false; }
      }
      output[s] = out * this._gain;
      if (this._cap && this._capPos < this._cap.length) {
        this._cap[this._capPos++] = output[s];
      }

      this._readPos += this._speed;
      if (this._readPos >= this._loopEnd) {
        // Wrap. The head [0, xf) was already played inside the crossfade, so
        // continue from xf, and advance the end to the frontier (monotonic —
        // after close the frontier is frozen, so the length settles).
        this._readPos = this._readPos - this._loopEnd + xf;
        const newEnd = Math.max(this._loopEnd, this._writePos);
        this._wrapCount++;
        if (this._wrapEvents.length < 256) {
          this._wrapEvents.push({ cap: this._capPos, from: this._loopEnd, to: newEnd });
        }
        this._loopEnd = newEnd;
      }
    }

    return true;
  }
}

registerProcessor('live-loop', LiveLoopProcessor);
