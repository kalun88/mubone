// ============================================================================
// GRAIN ENGINE WORKLET — Phase 3: cursor + seed grain engine
//
// Sample-accurate onset clock, 256-slot grain pool, pitch shifting,
// period/duration jitter, multi-grain mixing, VBAP multi-channel output,
// candidate list selection, active-grain feedback ring.
// Per-seed independent onset clocks and candidate lists.
//
// Zero allocations inside process() — all buffers pre-allocated.
//
// Messages from main thread:
//   { type: 'init', sab, sampleRate, bufferLength, params }
//   { type: 'params', ... }          — cursor parameter updates
//   { type: 'candidates', list }     — cursor candidate list (50Hz)
//   { type: 'seeds', list }          — per-seed state updates (50Hz)
//   { type: 'vbapLUT', data }        — VBAP lookup table (once)
//   { type: 'buffers', list }        — sample buffer registration
//   { type: 'stop' }
// ============================================================================

const BLOCK = 128;              // render quantum size (Web Audio spec)
const HANN_TABLE_SIZE = 1024;   // envelope lookup resolution
const POOL_SIZE = 256;          // max simultaneous grains
const MAX_SEEDS = 20;           // max concurrent seeds
const MAX_CHANNELS = 16;        // max output channels (speaker buses)
const FEEDBACK_RING_SIZE = 256; // active-grain feedback entries

class GrainEngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // ── State ──────────────────────────────────────────────────────────────
    this._active = false;
    this._sr = 48000;

    // ── Recording buffers ─────────────────────────────────────────────────
    // Main SAB recording buffer (live recordings)
    this._recBuf = null;        // Float32Array view into SAB
    this._recLen = 0;           // valid sample count

    // Provisional live recording buffer (in-progress recording, bufIndex -2)
    // During active recording, mic audio is piped directly to input[0] and
    // accumulated here at audio rate (zero latency). Falls back to delta
    // appends from main thread when input isn't connected.
    // Uses 30s chunks to avoid large upfront allocation. Grows on demand.
    // Warm cache: first chunk survives liveBufferClear for instant reuse.
    this._liveChunks = [];          // array of Float32Array (each ~30s)
    this._liveChunkSize = 0;        // samples per chunk (set on init)
    this._liveBufLen = 0;           // total valid sample count across all chunks
    this._liveRecording = false;    // true when mic input is connected

    // Additional sample buffers (sampler instrument slots)
    // Array of { data: Float32Array, length: number }
    this._sampleBufs = [];

    // ── Envelope tables ───────────────────────────────────────────────────
    this._hannTable = new Float32Array(HANN_TABLE_SIZE);
    this._triTable  = new Float32Array(HANN_TABLE_SIZE);
    for (let i = 0; i < HANN_TABLE_SIZE; i++) {
      const t = i / (HANN_TABLE_SIZE - 1);
      this._hannTable[i] = 0.5 * (1 - Math.cos(2 * Math.PI * t));
      this._triTable[i]  = t < 0.5 ? t * 2 : 2 - t * 2;
    }
    // Rect envelope = 1.0 everywhere — no table needed, just skip lookup

    // ── Grain pool ────────────────────────────────────────────────────────
    // Pre-allocated flat arrays for zero-alloc process().
    // Each grain is at index [i] across all arrays.
    this._gActive     = new Uint8Array(POOL_SIZE);    // 0 or 1
    this._gReadPos    = new Float64Array(POOL_SIZE);   // fractional sample position
    this._gReadRate   = new Float32Array(POOL_SIZE);   // pitch ratio (1.0 = original)
    this._gPhase      = new Float32Array(POOL_SIZE);   // 0→1 envelope progress
    this._gPhaseInc   = new Float32Array(POOL_SIZE);   // 1 / durationSamples
    this._gVolume     = new Float32Array(POOL_SIZE);   // per-grain volume
    this._gEnvShape   = new Uint8Array(POOL_SIZE);     // 0=hann, 1=tri, 2=rect
    this._gBufIndex   = new Int32Array(POOL_SIZE);     // -1=recBuf, 0+=sampleBufs[i]
    this._gBufOffset  = new Float64Array(POOL_SIZE);   // start offset in buffer (samples)
    this._gBufLen     = new Uint32Array(POOL_SIZE);    // length of buffer region
    this._gParticleId = new Int32Array(POOL_SIZE);     // for feedback ring (-1 = none)
    this._gIsSeed     = new Uint8Array(POOL_SIZE);     // 0=cursor grain, 1=seed grain
    // VBAP per-grain: speaker pair indices + weights
    this._gVbapIdxA   = new Uint8Array(POOL_SIZE);
    this._gVbapIdxB   = new Uint8Array(POOL_SIZE);
    this._gVbapWA     = new Float32Array(POOL_SIZE);
    this._gVbapWB     = new Float32Array(POOL_SIZE);
    this._gElBias     = new Float32Array(POOL_SIZE);   // elevation center-bias (0=equator, 1=pole)
    // Per-grain biquad filter state (Direct Form II Transposed)
    // Two cascaded sections: HPF then LPF. Each needs 5 coefficients + 2 state vars.
    // Filter flags: bit 0 = HPF active, bit 1 = LPF active
    this._gFilterFlags = new Uint8Array(POOL_SIZE);
    // HPF coefficients: b0, b1, b2, a1, a2 (a0 normalized to 1)
    this._gHpfB0 = new Float32Array(POOL_SIZE);
    this._gHpfB1 = new Float32Array(POOL_SIZE);
    this._gHpfB2 = new Float32Array(POOL_SIZE);
    this._gHpfA1 = new Float32Array(POOL_SIZE);
    this._gHpfA2 = new Float32Array(POOL_SIZE);
    this._gHpfZ1 = new Float32Array(POOL_SIZE);  // state
    this._gHpfZ2 = new Float32Array(POOL_SIZE);
    // LPF coefficients + state
    this._gLpfB0 = new Float32Array(POOL_SIZE);
    this._gLpfB1 = new Float32Array(POOL_SIZE);
    this._gLpfB2 = new Float32Array(POOL_SIZE);
    this._gLpfA1 = new Float32Array(POOL_SIZE);
    this._gLpfA2 = new Float32Array(POOL_SIZE);
    this._gLpfZ1 = new Float32Array(POOL_SIZE);
    this._gLpfZ2 = new Float32Array(POOL_SIZE);

    // Source tag: 0 = cursor, 1 = seed (for selective flush on undo)
    this._gIsCursor = new Uint8Array(POOL_SIZE);

    // Free list — simple stack
    this._freeList = new Uint16Array(POOL_SIZE);
    this._freePtr  = POOL_SIZE;  // points past last free slot
    for (let i = 0; i < POOL_SIZE; i++) this._freeList[i] = i;

    // Active grain count (for diagnostics)
    this._activeCount = 0;

    // ── Onset clock ───────────────────────────────────────────────────────
    this._sampleClock = 0;
    this._nextOnset   = 0;        // sample count for next grain

    // ── Parameters ────────────────────────────────────────────────────────
    this._periodSamples   = 0;
    this._durationSamples = 0;
    this._volume          = 0.8;
    this._pitchShift      = 0;      // cents (−2400 to +2400)
    this._pitchJitter     = 0;      // rate offset (0 = none)
    this._periodVar       = 0;      // period variation in seconds
    this._durVar          = 0;      // duration variation in seconds
    this._envShape        = 0;      // 0=hann, 1=tri, 2=rect
    this._probability     = 1.0;    // grain firing probability
    this._direction       = 0;      // 0=fwd, 1=rev, 2=rand
    // Direction diagnostics — counts reset each feedback cycle
    this._diagDirFwd      = 0;
    this._diagDirRev      = 0;
    this._grainStart      = 0;      // default buffer offset
    this._numChannels     = 1;      // output channel count
    this._eqGain          = 1.0;    // 1/√numChannels — equal-power spread for elevation bias
    // Filter parameters (cursor)
    this._hpfFreq         = 20;     // Hz — bypass at ≤22
    this._lpfFreq         = 20000;  // Hz — bypass at ≥19500
    this._filterQ         = 0.707;  // Q factor
    this._filterFreqJitter = 0;     // per-grain cutoff randomization (0–1)
    this._durJitter       = 0;      // duration percentage jitter (0–1)
    this._panSpread       = 0;      // spatial spread (0=point source, 1=full 360°)
    this._kSeqMode        = false;  // sequential candidate stepping (vs random)
    this._seqIdx          = 0;      // current sequential index into candidate list

    // ── Candidate list (from main thread spatial search) ──────────────────
    // Each entry: { bufIndex, offset, length, azDeg, particleId, radiusFade }
    // Sorted by offset (grainStart) when kSeqMode is active.
    this._candidates = [];
    this._candidateCount = 0;

    // ── Seeds (independent onset clocks, params, candidates) ─────────────
    // Each seed: { active, nextOnset, periodSamples, durationSamples,
    //   volume, pitchShift, pitchJitter, periodVar, durVar, envShape,
    //   probability, direction, gain, candidates[], candidateCount }
    this._seeds = [];
    for (let si = 0; si < MAX_SEEDS; si++) {
      this._seeds.push({
        active: false,
        nextOnset: 0,
        periodSamples: 0,
        durationSamples: 0,
        volume: 0.8,
        pitchShift: 0,
        pitchJitter: 0,
        periodVar: 0,
        durVar: 0,
        durJitter: 0,
        envShape: 0,
        probability: 1.0,
        direction: 0,
        gain: 1.0,            // seedWeight × envGain (pre-computed on main thread)
        hpfFreq: 20,
        lpfFreq: 20000,
        filterQ: 0.707,
        filterFreqJitter: 0,
        panSpread: 0,         // spatial spread (0–1)
        kSeqMode: false,      // sequential candidate stepping
        seqIdx: 0,            // current sequential index
        candidates: [],
        candidateCount: 0,
      });
    }

    // ── VBAP lookup table ─────────────────────────────────────────────────
    // 360 entries: [idxA, idxB, wA, wB] packed as 4 values per degree
    this._vbapLUT = null;  // Float32Array(1440) or null for stereo/mono

    // ── Feedback ring (worklet → main thread) ─────────────────────────────
    // Circular buffer of recent grain onsets for glow overlay
    // Pre-allocated feedback ring — no allocations during process().
    // Stores particle IDs of recently fired grains for glow overlay.
    this._feedbackBuf = new Int32Array(FEEDBACK_RING_SIZE);
    this._feedbackLen = 0;          // entries written since last post
    this._feedbackTimer = 0;        // sample counter for periodic posting

    // ── PRNG state (xorshift32 — deterministic, no allocation) ───────────
    this._rngState = 0xDEADBEEF;

    // ── Message handler ───────────────────────────────────────────────────
    this.port.onmessage = ({ data }) => this._handleMessage(data);
  }

  // ── Fast PRNG (xorshift32) — no allocation, deterministic ──────────────
  _rand01() {
    let x = this._rngState;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    this._rngState = x;
    return (x >>> 0) / 4294967296;  // 0.0–1.0
  }

  _randRange(min, max) {
    return min + this._rand01() * (max - min);
  }

  // ── Message handler ────────────────────────────────────────────────────
  _handleMessage(data) {
    if (!data) return;

    switch (data.type) {
      case 'init': {
        this._recBuf = new Float32Array(data.sab);
        this._recLen = data.bufferLength;
        this._sr = data.sampleRate || 48000;
        if (data.numChannels) {
          this._numChannels = data.numChannels;
          this._eqGain = 1 / Math.sqrt(data.numChannels);
        }
        this._sampleClock = 0;
        this._nextOnset = 0;
        this._activeCount = 0;
        this._freePtr = POOL_SIZE;
        for (let i = 0; i < POOL_SIZE; i++) {
          this._freeList[i] = i;
          this._gActive[i] = 0;
        }
        this._active = true;
        // Apply initial params
        if (data.params) this._applyParams(data.params);
        // Also accept flat params for backward compat with Phase 1
        this._applyParams(data);
        break;
      }

      case 'params':
        this._applyParams(data);
        break;

      case 'candidates':
        // Compact candidate list from main thread spatial search
        this._candidates = data.list || [];
        this._candidateCount = this._candidates.length;
        break;

      case 'seeds': {
        // Per-seed state updates from main thread (~50Hz).
        // Each entry: { index, active, params:{...}, gain, candidates:[...] }
        const seedList = data.list || [];
        // First, deactivate all seeds (main thread sends only active ones)
        for (let si = 0; si < MAX_SEEDS; si++) this._seeds[si].active = false;
        for (let i = 0; i < seedList.length; i++) {
          const sd = seedList[i];
          const si = sd.index;
          if (si < 0 || si >= MAX_SEEDS) continue;
          const seed = this._seeds[si];
          seed.active = true;
          seed.gain = sd.gain ?? 1.0;
          seed.candidates = sd.candidates || [];
          seed.candidateCount = seed.candidates.length;
          // Apply params if provided
          if (sd.params) {
            const p = sd.params;
            const sr = this._sr;
            if (p.period != null)
              seed.periodSamples = Math.max(1, Math.round(p.period * sr));
            if (p.duration != null)
              seed.durationSamples = Math.max(1, Math.round(p.duration * sr));
            if (p.volume != null)      seed.volume = p.volume;
            if (p.pitchShift != null)  seed.pitchShift = p.pitchShift;
            if (p.pitchJitter != null) seed.pitchJitter = p.pitchJitter;
            if (p.periodVar != null)   seed.periodVar = p.periodVar;
            if (p.durVar != null)      seed.durVar = p.durVar;
            if (p.envShape != null)    seed.envShape = p.envShape;
            if (p.probability != null) seed.probability = p.probability;
            if (p.direction != null)   seed.direction = p.direction;
            if (p.durJitter != null)   seed.durJitter = p.durJitter;
            if (p.hpfFreq != null)     seed.hpfFreq = p.hpfFreq;
            if (p.lpfFreq != null)     seed.lpfFreq = p.lpfFreq;
            if (p.filterQ != null)     seed.filterQ = p.filterQ;
            if (p.filterFreqJitter != null) seed.filterFreqJitter = p.filterFreqJitter;
            if (p.panSpread != null) seed.panSpread = p.panSpread;
            if (p.kSeqMode != null) {
              const was = seed.kSeqMode;
              seed.kSeqMode = !!p.kSeqMode;
              if (seed.kSeqMode && !was) seed.seqIdx = 0;
            }
          }
          // Init onset clock if newly activated
          if (seed.nextOnset === 0 || !seed.periodSamples) {
            seed.nextOnset = this._sampleClock;
          }
        }
        break;
      }

      case 'vbapLUT':
        // 360 entries × 4 floats = Float32Array(1440)
        if (data.data && data.data.length === 1440) {
          this._vbapLUT = data.data instanceof Float32Array
            ? data.data
            : new Float32Array(data.data);
        }
        this._numChannels = data.numChannels || 1;
        this._eqGain = 1 / Math.sqrt(this._numChannels);
        break;

      case 'buffers':
        // Register sample buffers: [{ data: Float32Array, length }]
        if (data.list) {
          this._sampleBufs = data.list.map(b => ({
            data: b.data instanceof Float32Array ? b.data : new Float32Array(b.data),
            length: b.length,
          }));
        }
        break;

      case 'addBuffer':
        // Hot-add a single buffer without replacing existing ones.
        // Returns the new index (appended to end of _sampleBufs).
        if (data.data) {
          this._sampleBufs.push({
            data: data.data instanceof Float32Array ? data.data : new Float32Array(data.data),
            length: data.length,
          });
        }
        break;

      // ── Provisional live buffer: streamed during active recording ──────
      // bufIndex -2 in candidate lists resolves to this buffer.
      // Uses 30s chunks to avoid large upfront allocation.
      case 'liveBufferInit': {
        const chunkSize = data.chunkSize || Math.round(this._sr * 30);
        this._liveChunkSize = chunkSize;
        this._liveBufLen = 0;
        // Warm cache: reuse first chunk if it exists and matches size
        if (this._liveChunks.length > 0 && this._liveChunks[0].length === chunkSize) {
          // Keep first chunk, discard extras from previous long recordings
          this._liveChunks.length = 1;
        } else {
          this._liveChunks = [new Float32Array(chunkSize)];
        }
        break;
      }

      case 'liveBufferAppend': {
        // Skip postMessage appends when direct mic input is active —
        // the process() input path is authoritative and already has the data.
        if (this._liveRecording) break;
        // Delta update: append new samples starting at offset
        if (this._liveChunkSize > 0 && data.data) {
          const incoming = data.data instanceof Float32Array
            ? data.data : new Float32Array(data.data);
          const offset = data.offset || 0;
          const cs = this._liveChunkSize;

          // Ensure enough chunks are allocated to hold offset + incoming.length
          const endSample = offset + incoming.length;
          const chunksNeeded = Math.ceil(endSample / cs);
          while (this._liveChunks.length < chunksNeeded) {
            this._liveChunks.push(new Float32Array(cs));
          }

          // Copy incoming data across chunk boundaries
          let srcPos = 0;
          let dstPos = offset;
          while (srcPos < incoming.length) {
            const ci = (dstPos / cs) | 0;
            const co = dstPos - ci * cs;
            const space = cs - co;
            const n = Math.min(space, incoming.length - srcPos);
            this._liveChunks[ci].set(incoming.subarray(srcPos, srcPos + n), co);
            srcPos += n;
            dstPos += n;
          }

          this._liveBufLen = data.totalLength || endSample;
        }
        break;
      }

      case 'liveBufferClear':
        // Warm cache: keep first chunk allocated for instant reuse on next record press.
        // Only zero out the valid-length counter — no deallocation.
        if (this._liveChunks.length > 1) {
          this._liveChunks.length = 1;  // free extra chunks
        }
        this._liveBufLen = 0;
        this._liveRecording = false;
        break;

      case 'liveRecStart':
        this._liveRecording = true;
        break;

      case 'liveRecStop':
        this._liveRecording = false;
        // Snapshot the final buffer length into all active live-buffer grains.
        // During recording, the render loop used the live _liveBufLen; now it
        // switches to the per-grain snapshot _gBufLen[i]. Without this update,
        // grains whose read position has advanced past their fire-time snapshot
        // would suddenly read 0 (silence) — causing an audible gap at the
        // recording→playback transition.
        for (let i = 0; i < POOL_SIZE; i++) {
          if (this._gActive[i] && this._gBufIndex[i] === -2) {
            this._gBufLen[i] = this._liveBufLen;
          }
        }
        break;

      case 'stop':
        this._active = false;
        this._liveRecording = false;
        this._liveChunks = [];
        this._liveBufLen = 0;
        for (let i = 0; i < POOL_SIZE; i++) this._gActive[i] = 0;
        this._activeCount = 0;
        this._freePtr = POOL_SIZE;
        for (let i = 0; i < POOL_SIZE; i++) this._freeList[i] = i;
        break;

      // Soft-flush: fade out all in-flight grains (~3ms) instead of hard-
      // killing them (which clicks). Buffers are kept alive for the fade;
      // candidates are cleared so no new grains fire.
      case 'flush':
        // Clear candidate lists so onset clocks don't re-fire stale grains
        this._candidates = [];
        this._candidateCount = 0;
        for (let si = 0; si < MAX_SEEDS; si++) {
          this._seeds[si].candidates = [];
          this._seeds[si].candidateCount = 0;
          this._seeds[si].active = false;
        }
        // Accelerate all active grains to fade out in ~128 samples (~2.7ms).
        // The hann/tri envelope tapers to zero naturally — no click.
        // Buffers stay alive so grains can still read during the fade.
        for (let i = 0; i < POOL_SIZE; i++) {
          if (this._gActive[i]) {
            // Jump phase forward so remaining envelope is short
            const remaining = 1.0 - this._gPhase[i];
            if (remaining > 0) {
              this._gPhaseInc[i] = remaining / 128;
            }
          }
        }
        break;

      // Compact _sampleBufs, dropping buffers whose recordings were erased.
      // Sent by the bridge at sweep-snapshot commit time (undo no longer
      // possible), NOT at erase time — see resyncWorkletBuffers() in
      // grain-worklet-bridge.js and docs/GROUP-SHOW-NOISE-GLITCH.md.
      // data.keep = old indices to retain, ascending. Indices -1 (SAB) and
      // -2 (live chunks) are unaffected. Must stay in lockstep with the
      // bridge's _bufferMap rebuild or grains read from the wrong buffer.
      case 'compactBuffers': {
        const keep = data.keep || [];
        const remap = new Map();  // old index → new index
        const next = [];
        for (let k = 0; k < keep.length; k++) {
          const old = keep[k];
          if (old >= 0 && old < this._sampleBufs.length) {
            remap.set(old, next.length);
            next.push(this._sampleBufs[old]);
          }
        }
        this._sampleBufs = next;
        // Remap in-flight grains to new indices; free grains whose buffer
        // was dropped (its data is gone — can't fade what we can't read).
        for (let i = 0; i < POOL_SIZE; i++) {
          if (!this._gActive[i]) continue;
          const bi = this._gBufIndex[i];
          if (bi < 0) continue;  // SAB / live buffer — untouched
          const ni = remap.get(bi);
          if (ni === undefined) this._freeGrain(i);
          else this._gBufIndex[i] = ni;
        }
        // Clear candidate lists — they carry old indices. The main-thread
        // scheduler reposts cursor + seed candidates within ~20ms, built
        // against the rebuilt _bufferMap. Seeds stay active (unlike 'flush')
        // so granulation resumes seamlessly on the next post.
        this._candidates = [];
        this._candidateCount = 0;
        for (let si = 0; si < MAX_SEEDS; si++) {
          this._seeds[si].candidates = [];
          this._seeds[si].candidateCount = 0;
        }
        break;
      }

      // Cursor-only flush: kill cursor grains, leave seeds alive.
      // Used by undo — the undone stroke's particles are gone but in-flight
      // grains would keep playing for up to the grain duration.
      case 'flush-cursor':
        this._candidates = [];
        this._candidateCount = 0;
        for (let i = 0; i < POOL_SIZE; i++) {
          if (this._gActive[i] && this._gIsCursor[i]) {
            const remaining = 1.0 - this._gPhase[i];
            if (remaining > 0) {
              this._gPhaseInc[i] = remaining / 128;
            }
          }
        }
        break;
    }
  }

  _applyParams(p) {
    const sr = this._sr;
    if (p.period != null && isFinite(p.period))
      this._periodSamples = Math.max(1, Math.round(p.period * sr));
    if (p.duration != null && isFinite(p.duration))
      this._durationSamples = Math.max(1, Math.round(p.duration * sr));
    if (p.volume != null && isFinite(p.volume))
      this._volume = p.volume;
    if (p.pitchShift != null)
      this._pitchShift = p.pitchShift;
    if (p.pitchJitter != null)
      this._pitchJitter = p.pitchJitter;
    if (p.periodVar != null)
      this._periodVar = p.periodVar;
    if (p.durVar != null)
      this._durVar = p.durVar;
    if (p.envShape != null)
      this._envShape = p.envShape;
    if (p.probability != null)
      this._probability = p.probability;
    if (p.direction != null)
      this._direction = p.direction;
    if (p.grainStart != null)
      this._grainStart = p.grainStart;
    if (p.hpfFreq != null)
      this._hpfFreq = p.hpfFreq;
    if (p.lpfFreq != null)
      this._lpfFreq = p.lpfFreq;
    if (p.filterQ != null)
      this._filterQ = p.filterQ;
    if (p.filterFreqJitter != null)
      this._filterFreqJitter = p.filterFreqJitter;
    if (p.durJitter != null)
      this._durJitter = p.durJitter;
    if (p.panSpread != null)
      this._panSpread = p.panSpread;
    if (p.kSeqMode != null) {
      const was = this._kSeqMode;
      this._kSeqMode = !!p.kSeqMode;
      if (this._kSeqMode && !was) this._seqIdx = 0;  // reset on toggle-on
    }
  }

  // ── Envelope lookup (zero-alloc) ──────────────────────────────────────
  _envelope(phase, shape) {
    if (shape === 2) return 1.0;  // rect — no envelope
    const table = shape === 1 ? this._triTable : this._hannTable;
    const idx = phase * (HANN_TABLE_SIZE - 1);
    const i0 = idx | 0;
    const i1 = i0 + 1 < HANN_TABLE_SIZE ? i0 + 1 : i0;
    const frac = idx - i0;
    return table[i0] + frac * (table[i1] - table[i0]);
  }

  // ── Read sample from a buffer (linear interpolation, wrapping) ────────
  _readSample(buf, len, pos) {
    if (len === 0) return 0;
    const p = ((pos % len) + len) % len;
    const i0 = p | 0;
    const i1 = (i0 + 1) % len;
    const frac = p - i0;
    return buf[i0] + frac * (buf[i1] - buf[i0]);
  }

  // ── Read sample from chunked live buffer (linear interpolation, clamped) ──
  // Unlike _readSample (which wraps for looping), this returns 0 for
  // out-of-bounds reads. During active recording the buffer is growing;
  // wrapping would jump to the start and cause audible crunch/clicks.
  // Grains are duration-clamped at fire time to fit the available data,
  // so reads past the boundary should be rare (only from rounding).
  _readLiveChunked(len, pos) {
    if (len === 0) return 0;
    const i0 = pos | 0;
    if (i0 < 0 || i0 >= len) return 0;
    const cs = this._liveChunkSize;
    if (cs === 0) return 0;
    const ci0 = (i0 / cs) | 0;
    const chunk0 = this._liveChunks[ci0];
    if (!chunk0) return 0;  // chunk cleared while grain still fading
    const frac = pos - i0;
    const s0 = chunk0[i0 - ci0 * cs];
    const i1 = i0 + 1;
    if (i1 >= len) return s0;
    const ci1 = (i1 / cs) | 0;
    const chunk1 = ci1 === ci0 ? chunk0 : this._liveChunks[ci1];
    if (!chunk1) return s0;
    const s1 = chunk1[i1 - ci1 * cs];
    return s0 + frac * (s1 - s0);
  }

  // ── Allocate a grain slot from free list ──────────────────────────────
  _allocGrain() {
    if (this._freePtr === 0) {
      // Pool exhausted — steal oldest (lowest index still active)
      for (let i = 0; i < POOL_SIZE; i++) {
        if (this._gActive[i]) {
          this._gActive[i] = 0;
          this._activeCount--;
          return i;
        }
      }
      return -1;  // shouldn't happen
    }
    return this._freeList[--this._freePtr];
  }

  // ── Free a grain slot back to pool ────────────────────────────────────
  _freeGrain(idx) {
    this._gActive[idx] = 0;
    this._freeList[this._freePtr++] = idx;
    this._activeCount--;
  }

  // ── Biquad coefficient computation (cookbook formulas) ──────────────────
  // Returns [b0, b1, b2, a1, a2] with a0 normalized to 1.
  _computeHPF(freq, Q) {
    const w0 = 2 * Math.PI * freq / this._sr;
    const cosW0 = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    const a0 = 1 + alpha;
    return [
      ((1 + cosW0) / 2) / a0,       // b0
      (-(1 + cosW0)) / a0,           // b1
      ((1 + cosW0) / 2) / a0,       // b2
      (-2 * cosW0) / a0,             // a1
      (1 - alpha) / a0,              // a2
    ];
  }

  _computeLPF(freq, Q) {
    const w0 = 2 * Math.PI * freq / this._sr;
    const cosW0 = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    const a0 = 1 + alpha;
    return [
      ((1 - cosW0) / 2) / a0,       // b0
      (1 - cosW0) / a0,              // b1
      ((1 - cosW0) / 2) / a0,       // b2
      (-2 * cosW0) / a0,             // a1
      (1 - alpha) / a0,              // a2
    ];
  }

  // ── Fire a new grain ──────────────────────────────────────────────────
  // seed: optional seed object for seed grains. If null, uses cursor params.
  _fireGrain(seed) {
    // Read params from seed or cursor
    const prob      = seed ? seed.probability   : this._probability;
    const durSamp   = seed ? seed.durationSamples : this._durationSamples;
    const vol       = seed ? seed.volume * seed.gain : this._volume;
    const pShift    = seed ? seed.pitchShift    : this._pitchShift;
    const pJitter   = seed ? seed.pitchJitter   : this._pitchJitter;
    const dVar      = seed ? seed.durVar        : this._durVar;
    const eShape    = seed ? seed.envShape      : this._envShape;
    const dir       = seed ? seed.direction     : this._direction;
    const cands     = seed ? seed.candidates    : this._candidates;
    const candCount = seed ? seed.candidateCount : this._candidateCount;
    const hpfFreq   = seed ? (seed.hpfFreq ?? 20)    : this._hpfFreq;
    const lpfFreq   = seed ? (seed.lpfFreq ?? 20000)  : this._lpfFreq;
    const fQ        = seed ? (seed.filterQ ?? 0.707)   : this._filterQ;
    const fJitter   = seed ? (seed.filterFreqJitter ?? 0) : this._filterFreqJitter;
    const djitter   = seed ? (seed.durJitter ?? 0)     : this._durJitter;
    const spread    = seed ? (seed.panSpread ?? 0)      : this._panSpread;

    // No candidates → nothing to play (radius mode with cursor outside range)
    if (candCount === 0) return;

    // Probability gate
    if (prob < 1.0 && this._rand01() > prob) return;

    const idx = this._allocGrain();
    if (idx < 0) return;
    this._gIsCursor[idx] = seed ? 0 : 1;  // tag: 1 = cursor, 0 = seed

    // ── Pick source: candidate list or default ──────────────────────────
    let bufIndex = -1;     // -1 = main recBuf
    let bufOffset = this._grainStart;
    let bufLen = this._recLen;
    let azDeg = 0;
    let elBias = 0;        // elevation center-bias: 0=equator, 1=pole
    let particleId = -1;
    let radiusFade = 1.0;

    // k-seq mode: step through candidates sorted by grainStart (offset).
    // Random mode: pick a random candidate from the pool.
    const kSeq = seed ? seed.kSeqMode : this._kSeqMode;

    if (candCount > 0) {
      let ci;
      if (kSeq) {
        // Sequential: advance index, wrap around at end
        if (seed) {
          ci = seed.seqIdx % candCount;
          seed.seqIdx = (seed.seqIdx + 1) % candCount;
        } else {
          ci = this._seqIdx % candCount;
          this._seqIdx = (this._seqIdx + 1) % candCount;
        }
      } else {
        ci = (this._rand01() * candCount) | 0;
      }
      const c = cands[ci];
      bufIndex    = c.bufIndex ?? -1;
      bufOffset   = c.offset ?? 0;
      bufLen      = c.length ?? this._recLen;
      azDeg       = c.azDeg ?? 0;
      elBias      = c.elBias ?? 0;
      particleId  = c.particleId ?? -1;
      radiusFade  = c.radiusFade ?? 1.0;
    }

    // For live buffer grains: snapshot the worklet's current data extent.
    // The candidate's `length` comes from the bridge (may lag), but the
    // worklet knows exactly how much data it has. This snapshot is stored
    // in _gBufLen and used for the entire grain lifetime — prevents the
    // micro-fade zone from shifting when new delta appends arrive.
    if (bufIndex === -2 && this._liveBufLen > 0) {
      bufLen = this._liveBufLen;
    }

    // ── Duration with jitter ────────────────────────────────────────────
    let durSamples = durSamp;
    // durJitter: percentage randomization (e.g. 0.3 = ±30%)
    if (djitter > 0) {
      const factor = 1 + djitter * (this._rand01() * 2 - 1);
      durSamples = Math.max(1, (durSamples * factor) | 0);
    }
    // durVar: absolute variation in seconds
    if (dVar > 0) {
      const varSamples = Math.round(dVar * this._sr);
      durSamples = Math.max(1, durSamples + ((this._rand01() * 2 - 1) * varSamples) | 0);
    }

    // ── Pitch rate ──────────────────────────────────────────────────────
    let readRate = 1.0;
    if (pShift !== 0) {
      readRate = Math.pow(2, pShift / 1200);
    }
    if (pJitter > 0) {
      const jitterFactor = 1 + pJitter * (this._rand01() * 2 - 1);
      readRate *= jitterFactor;
    }

    // ── Direction ───────────────────────────────────────────────────────
    if (dir === 1) {       // reverse
      readRate = -Math.abs(readRate);
    } else if (dir === 2) { // random
      if (this._rand01() < 0.5) readRate = -readRate;
    }
    // Track direction stats for diagnostics
    if (readRate >= 0) this._diagDirFwd++; else this._diagDirRev++;

    // ── Duration clamping for fixed-length buffers ────────────────────
    // Prevents grains from reading past the buffer end (which wraps via
    // modulo in _readSample, causing the start of the buffer to bleed in).
    // Active live recording is exempt — the buffer grows and
    // _readLiveChunked returns 0 for unwritten regions.
    const isActiveLive = bufIndex === -2 && this._liveRecording;
    if (!isActiveLive && bufLen > 0) {
      const absRate = Math.abs(readRate) || 1;
      const needed = durSamples * absRate;
      // If the grain doesn't fit from bufOffset, slide the start back
      // so the full duration is preserved. Character stays consistent
      // instead of getting shorter near the buffer end.
      if (bufOffset + needed > bufLen) {
        bufOffset = Math.max(0, bufLen - needed);
      }
      const available = bufLen - bufOffset;
      if (available <= 0) {
        this._gActive[idx] = 0;
        this._freeList[this._freePtr++] = idx;
        return;
      }
      const maxDur = (available / absRate) | 0;
      if (maxDur < 64) {
        this._gActive[idx] = 0;
        this._freeList[this._freePtr++] = idx;
        return;
      }
      if (durSamples > maxDur) {
        durSamples = maxDur;
      }
    } else if (isActiveLive) {
      // Active recording: only drop grains whose offset is completely
      // past the buffer (shouldn't happen, but safety net).
      if (readRate >= 0 && bufOffset > bufLen) {
        this._gActive[idx] = 0;
        this._freeList[this._freePtr++] = idx;
        return;
      }
      if (readRate < 0 && bufOffset <= 0) {
        this._gActive[idx] = 0;
        this._freeList[this._freePtr++] = idx;
        return;
      }
    }

    // ── Spatial panning ────────────────────────────────────────────────
    // panSpread: randomise the azimuth per grain for spatial width.
    // 0 = point source (exact particle position), 1 = full 360° scatter.
    let spreadAz = azDeg;
    if (spread > 0) {
      spreadAz += (this._rand01() * 2 - 1) * spread * 180;
    }
    let vbapIdxA = 0, vbapIdxB = 0, vbapWA = 1.0, vbapWB = 0.0;
    if (this._vbapLUT && this._numChannels > 2) {
      // Multi-channel VBAP
      const deg = ((Math.round(spreadAz) % 360) + 360) % 360;
      const base = deg * 4;
      vbapIdxA = this._vbapLUT[base];
      vbapIdxB = this._vbapLUT[base + 1];
      vbapWA   = this._vbapLUT[base + 2];
      vbapWB   = this._vbapLUT[base + 3];
    } else if (this._numChannels === 2) {
      // Stereo: equal-power pan from azimuth.
      // 0°/360° = centre, 90° = right, 270° = left.
      const rad = ((spreadAz % 360) + 360) % 360 * (Math.PI / 180);
      const pan = Math.sin(rad);                // −1 (left) to +1 (right)
      const angle = (pan + 1) * 0.25 * Math.PI; // 0 (left) to π/2 (right)
      vbapIdxA = 0; vbapIdxB = 1;
      vbapWA = Math.cos(angle);  // left
      vbapWB = Math.sin(angle);  // right
    }

    // ── Per-grain filter setup ─────────────────────────────────────────
    // Skip filtering for audio-rate grains (≤5ms) — too short to perceive
    const audioRate = durSamples <= this._sr * 0.005;
    const needsHPF = !audioRate && hpfFreq > 22;
    const needsLPF = !audioRate && lpfFreq < 19500;
    let filterFlags = 0;
    if (needsHPF) {
      filterFlags |= 1;
      const jFreq = fJitter > 0 ? hpfFreq * Math.pow(2, (this._rand01() * 2 - 1) * fJitter) : hpfFreq;
      const c = this._computeHPF(Math.min(jFreq, this._sr * 0.49), fQ);
      this._gHpfB0[idx] = c[0]; this._gHpfB1[idx] = c[1]; this._gHpfB2[idx] = c[2];
      this._gHpfA1[idx] = c[3]; this._gHpfA2[idx] = c[4];
      this._gHpfZ1[idx] = 0; this._gHpfZ2[idx] = 0;
    }
    if (needsLPF) {
      filterFlags |= 2;
      const jFreq = fJitter > 0 ? lpfFreq * Math.pow(2, (this._rand01() * 2 - 1) * fJitter) : lpfFreq;
      const c = this._computeLPF(Math.min(jFreq, this._sr * 0.49), fQ);
      this._gLpfB0[idx] = c[0]; this._gLpfB1[idx] = c[1]; this._gLpfB2[idx] = c[2];
      this._gLpfA1[idx] = c[3]; this._gLpfA2[idx] = c[4];
      this._gLpfZ1[idx] = 0; this._gLpfZ2[idx] = 0;
    }

    // ── Write grain slot ────────────────────────────────────────────────
    this._gActive[idx]     = 1;
    this._gReadPos[idx]    = readRate >= 0 ? bufOffset : bufOffset + durSamples * Math.abs(readRate);
    this._gReadRate[idx]   = readRate;
    this._gPhase[idx]      = 0;
    this._gPhaseInc[idx]   = 1 / durSamples;
    this._gVolume[idx]     = vol * radiusFade;
    this._gEnvShape[idx]   = eShape;
    this._gBufIndex[idx]   = bufIndex;
    this._gBufOffset[idx]  = bufOffset;
    this._gBufLen[idx]     = bufLen;
    this._gParticleId[idx] = particleId;
    this._gIsSeed[idx]     = seed ? 1 : 0;
    this._gVbapIdxA[idx]   = vbapIdxA;
    this._gVbapIdxB[idx]   = vbapIdxB;
    this._gVbapWA[idx]     = vbapWA;
    this._gVbapWB[idx]     = vbapWB;
    this._gElBias[idx]     = elBias;
    this._gFilterFlags[idx] = filterFlags;
    this._activeCount++;

    // ── Feedback ring entry ─────────────────────────────────────────────
    if (particleId >= 0 && this._feedbackLen < FEEDBACK_RING_SIZE) {
      this._feedbackBuf[this._feedbackLen++] = particleId;
    }
  }

  // ── Main audio processing ─────────────────────────────────────────────
  // Two outputs: outputs[0] = monitor bus (cursor grains),
  //              outputs[1] = house bus (seed grains).
  // When only one output exists (fallback), all grains mix into outputs[0].
  process(inputs, outputs) {
    if (!this._active) return true;

    const monOut  = outputs[0];         // cursor / monitor
    const houseOut = outputs[1] || null; // seeds / house (may not exist)
    if (!monOut || !monOut.length) return true;
    const numCh = monOut.length;

    // Zero both output buses
    for (let ch = 0; ch < numCh; ch++) {
      for (let s = 0; s < BLOCK; s++) monOut[ch][s] = 0;
      if (houseOut && ch < houseOut.length) {
        for (let s = 0; s < BLOCK; s++) houseOut[ch][s] = 0;
      }
    }

    // ── Accumulate live mic input into live chunks (zero-latency path) ──
    // When _liveRecording is true, the mic is connected as input[0].
    // Writing BLOCK samples per call into the chunked buffer so grain reads
    // from the live buffer have the data immediately — no postMessage lag.
    if (this._liveRecording) {
      const inp = inputs[0];
      const micData = inp && inp[0];
      if (micData && micData.length > 0 && this._liveChunkSize > 0) {
        const cs = this._liveChunkSize;
        let wp = this._liveBufLen;
        // Ensure enough chunks to hold wp + micData.length
        const endPos = wp + micData.length;
        const chunksNeeded = Math.ceil(endPos / cs);
        while (this._liveChunks.length < chunksNeeded) {
          this._liveChunks.push(new Float32Array(cs));
        }
        // Batch copy mic samples into chunks (set() is memcpy — fast).
        // For typical BLOCK=128, this is usually a single set() call.
        let srcPos = 0;
        while (srcPos < micData.length) {
          const ci = (wp / cs) | 0;
          const co = wp - ci * cs;
          const n = Math.min(cs - co, micData.length - srcPos);
          this._liveChunks[ci].set(micData.subarray(srcPos, srcPos + n), co);
          srcPos += n;
          wp += n;
        }
        this._liveBufLen = wp;
      }
    }

    // Need at least one buffer source to work with
    const hasRecBuf = this._recBuf && this._recLen > 0;
    const hasLiveBuf = this._liveChunks.length > 0 && this._liveBufLen > 0;
    const hasSampleBufs = this._sampleBufs.length > 0;
    if (!hasRecBuf && !hasLiveBuf && !hasSampleBufs) return true;

    // ── Pressure throttle ────────────────────────────────────────────────
    // When pool utilization exceeds 75%, randomly skip onsets with
    // increasing probability to prevent cascade overload and grain stealing.
    // At 75% → 0% skip, at 100% → 100% skip (linear ramp).
    const PRESSURE_THRESHOLD = POOL_SIZE * 0.75;  // 192
    const activeCount = this._activeCount;
    const underPressure = activeCount > PRESSURE_THRESHOLD;
    // Skip probability: 0 at threshold, 1 at full pool
    const skipProb = underPressure
      ? (activeCount - PRESSURE_THRESHOLD) / (POOL_SIZE - PRESSURE_THRESHOLD)
      : 0;

    for (let s = 0; s < BLOCK; s++) {
      // ── Fire cursor grain at onset ──────────────────────────────────
      // Guard: skip cursor grains until params are set (period starts at 0)
      if (this._periodSamples > 0 && this._sampleClock >= this._nextOnset) {
        if (!underPressure || this._rand01() > skipProb) {
          this._fireGrain();  // null seed = cursor grain
        }

        // Schedule next onset with period jitter
        let nextPeriod = this._periodSamples;
        if (this._periodVar > 0) {
          const varSamples = Math.round(this._periodVar * this._sr);
          nextPeriod = Math.max(1, nextPeriod + ((this._rand01() * 2 - 1) * varSamples) | 0);
        }
        this._nextOnset = this._sampleClock + nextPeriod;
      }

      // ── Fire seed grains at their independent onsets ────────────────
      for (let si = 0; si < MAX_SEEDS; si++) {
        const seed = this._seeds[si];
        if (!seed.active || seed.periodSamples <= 0) continue;
        if (this._sampleClock >= seed.nextOnset) {
          if (!underPressure || this._rand01() > skipProb) {
            this._fireGrain(seed);
          }

          // Schedule next seed onset with period jitter
          let nextPeriod = seed.periodSamples;
          if (seed.periodVar > 0) {
            const varSamples = Math.round(seed.periodVar * this._sr);
            nextPeriod = Math.max(1, nextPeriod + ((this._rand01() * 2 - 1) * varSamples) | 0);
          }
          seed.nextOnset = this._sampleClock + nextPeriod;
        }
      }

      // ── Render all active grains ────────────────────────────────────
      for (let i = 0; i < POOL_SIZE; i++) {
        if (!this._gActive[i]) continue;

        // Resolve buffer source
        // bufIdx: -1 = SAB (primary recording), -2 = chunked live buffer, 0+ = sampleBufs
        const bufIdx = this._gBufIndex[i];
        let buf, bufLen;
        let isLiveChunked = false;
        if (bufIdx === -1) {
          buf = this._recBuf;
          bufLen = this._recLen;
        } else if (bufIdx === -2) {
          // Chunked live buffer — no single flat array, use _readLiveChunked
          isLiveChunked = true;
          buf = true;  // sentinel: chunks exist
          // During active recording: use live _liveBufLen so grains can
          // read newly-arrived data (direct mic input grows the buffer at
          // audio rate). This is safe because the buffer grows smoothly —
          // no jumps, no crunch/click risk.
          // After recording: use the fire-time snapshot (_gBufLen[i]) since
          // the buffer is no longer growing.
          bufLen = this._liveRecording ? this._liveBufLen : this._gBufLen[i];
        } else if (bufIdx >= 0 && bufIdx < this._sampleBufs.length) {
          const sb = this._sampleBufs[bufIdx];
          buf = sb.data;
          bufLen = sb.length;
        } else {
          this._freeGrain(i);
          continue;
        }

        if (!buf || bufLen === 0 || (isLiveChunked && this._liveChunks.length === 0)) {
          this._freeGrain(i);
          continue;
        }

        // Read sample with linear interpolation
        let raw = isLiveChunked
          ? this._readLiveChunked(bufLen, this._gReadPos[i])
          : this._readSample(buf, bufLen, this._gReadPos[i]);

        // ── Per-grain biquad filtering (Direct Form II Transposed) ────
        const fFlags = this._gFilterFlags[i];
        if (fFlags & 1) {  // HPF
          const x = raw;
          const y = this._gHpfB0[i] * x + this._gHpfZ1[i];
          this._gHpfZ1[i] = this._gHpfB1[i] * x - this._gHpfA1[i] * y + this._gHpfZ2[i];
          this._gHpfZ2[i] = this._gHpfB2[i] * x - this._gHpfA2[i] * y;
          raw = y;
        }
        if (fFlags & 2) {  // LPF
          const x = raw;
          const y = this._gLpfB0[i] * x + this._gLpfZ1[i];
          this._gLpfZ1[i] = this._gLpfB1[i] * x - this._gLpfA1[i] * y + this._gLpfZ2[i];
          this._gLpfZ2[i] = this._gLpfB2[i] * x - this._gLpfA2[i] * y;
          raw = y;
        }

        // Envelope
        const env = this._envelope(this._gPhase[i], this._gEnvShape[i]);
        const sample = raw * env * this._gVolume[i];

        // NaN guard: corrupted filter state or buffer read can produce NaN,
        // which poisons the entire output channel. Kill the grain instead.
        if (sample !== sample) {  // fastest NaN check
          this._freeGrain(i);
          continue;
        }

        // ── Mix into output channels ──────────────────────────────────
        // Route: cursor grains → monitor (output 0), seed grains → house (output 1)
        const dest = (this._gIsSeed[i] && houseOut) ? houseOut : monOut;

        if (numCh === 1) {
          dest[0][s] += sample;
        } else if (this._vbapLUT && numCh > 2) {
          // VBAP multi-channel with elevation center-bias.
          // At equator (elBias≈0): standard 2-speaker VBAP pair.
          // At poles (elBias→1): energy spreads equally to all speakers.
          const eb = this._gElBias[i];
          const chA = this._gVbapIdxA[i];
          const chB = this._gVbapIdxB[i];
          if (eb > 0.01) {
            const eq = this._eqGain;  // 1/√numSpeakers, precomputed
            for (let ch = 0; ch < numCh; ch++) {
              if (ch === chA)       dest[ch][s] += sample * (this._gVbapWA[i] + (eq - this._gVbapWA[i]) * eb);
              else if (ch === chB)  dest[ch][s] += sample * (this._gVbapWB[i] + (eq - this._gVbapWB[i]) * eb);
              else                  dest[ch][s] += sample * (eq * eb);
            }
          } else {
            if (chA < numCh) dest[chA][s] += sample * this._gVbapWA[i];
            if (chB < numCh) dest[chB][s] += sample * this._gVbapWB[i];
          }
        } else if (numCh === 2) {
          // Stereo: use VBAP weights for L/R panning (spread-aware).
          // Elevation center-bias: collapse pan toward center at poles.
          const eb = this._gElBias[i];
          if (eb > 0.01) {
            const wA = this._gVbapWA[i] + (0.707 - this._gVbapWA[i]) * eb;
            const wB = this._gVbapWB[i] + (0.707 - this._gVbapWB[i]) * eb;
            dest[0][s] += sample * wA;
            dest[1][s] += sample * wB;
          } else {
            dest[0][s] += sample * this._gVbapWA[i];
            dest[1][s] += sample * this._gVbapWB[i];
          }
        } else {
          dest[0][s] += sample;
        }

        // Advance read position and envelope
        this._gReadPos[i] += this._gReadRate[i];
        this._gPhase[i]   += this._gPhaseInc[i];

        // Grain finished?
        if (this._gPhase[i] >= 1.0) {
          this._freeGrain(i);
        }
      }

      this._sampleClock++;
    }

    // ── Periodic feedback to main thread (~30Hz = every ~1600 samples) ──
    // postMessage happens outside the per-sample loop — one alloc per post
    // (the slice) is acceptable at 30Hz and unavoidable for structured clone.
    this._feedbackTimer += BLOCK;
    if (this._feedbackTimer >= 1600) {
      const grainIds = this._feedbackLen > 0
        ? Array.from(this._feedbackBuf.subarray(0, this._feedbackLen))
        : [];
      this.port.postMessage({
        type: 'feedback',
        grains: grainIds,
        activeCount: this._activeCount,
        _diag: {
          periodSmp: this._periodSamples,
          durSmp: this._durationSamples,
          vol: this._volume,
          candCount: this._candidateCount,
          freePtr: this._freePtr,
          nextOnset: this._nextOnset,
          clock: this._sampleClock,
          liveRec: this._liveRecording,
          liveBufLen: this._liveBufLen,
          liveChunks: this._liveChunks.length,
          dir: this._direction,
          dirFwd: this._diagDirFwd,
          dirRev: this._diagDirRev,
          // Buffer retention diagnostics (group-show noise glitch investigation):
          // _sampleBufs only grows within a node lifetime — erase-all never
          // clears it. Expose count + retained MB to confirm/refute the leak.
          sampleBufs: this._sampleBufs.length,
          sampleBufMB: this._sampleBufs.reduce((s, b) => s + b.data.byteLength, 0) / 1048576,
        },
      });
      this._feedbackLen = 0;
      this._feedbackTimer = 0;
      this._diagDirFwd = 0;
      this._diagDirRev = 0;
    }

    return true;
  }
}

registerProcessor('grain-engine', GrainEngineProcessor);
