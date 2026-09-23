// ============================================================================
// GRAIN ENGINE WORKLET — Phase 3: cursor + seed grain engine
//
// Sample-accurate onset clocks, a 512-slot grain pool, pitch shifting,
// period/duration jitter, multi-grain mixing, VBAP multi-channel output,
// candidate list selection, active-grain feedback ring.
// Per-seed independent onset clocks and candidate lists.
//
// Zero allocations inside process() — all buffers pre-allocated.
//
// Messages from main thread — the `switch` in _handleMessage is the list; the
// scheduler posts candidates through the shared tables (`cursorTables`,
// `cursorVoicesTab`) every 10 ms and the rest are one-off control messages.
// ============================================================================

const BLOCK = 128;              // render quantum size (Web Audio spec)
const HANN_TABLE_SIZE = 1024;   // envelope lookup resolution
// Shortest ramp that still behaves like a fade rather than an edge — roughly
// one render quantum.  Applied in both fade modes, but only when the fade is
// non-zero: an explicit 0 still means instant on/off.
const MIN_FADE_S = 0.002;
// ── How many grains may sound at once (P2, 2026-09-06) ────────────────────
// A setting, not a constant: it is polyphony, and the right number depends on
// the machine. 256 was chosen in 2026-03 against a grain that cost more than
// twice what it costs now (R4), and the probe's dense scene sat at its ceiling.
// The pool is allocated from `maxGrains` at `init` and re-allocated when the
// setting changes; POOL_DEFAULT is only what a worklet starts with before the
// bridge's init arrives. The FEEDBACK RING is always the same size — it is
// what tells the renderer which marks sounded, and a mark that sounded must
// be allowed to light (Ek, 2026-09-06: "the glow map should be accurate").
const POOL_DEFAULT = 512;
// Seed voices. A cloud is a moving cursor (2026-09-05): the bridge posts it as
// one voice per VOICING under it, so there are more voices than clouds
// (state.js MAX_SEEDS = 20). The bridge allocates `index`; a voice is a voice.
// Voice slots, raised 2026-09-06 (P4) from 8 and 40. The onset loops walk
// every slot once per sample whether or not it holds a voice, so a slot has a
// FIXED cost: measured at 0.22 µs per cursor slot and 0.14 µs per seed slot,
// per 128-sample block. Sixteen and sixty-four together add 4.3 µs to a
// 2667 µs budget — 0.16 % — and buy twice the distinct brushes audible under
// one cursor and half again the voicings across the pinned clouds. A bucket
// that finds no free voice is SILENT for that tick, which is the thing these
// numbers were quietly costing.
const MAX_SEED_VOICES = 64;
// Cursor voices — docs/archive/BRUSH-MODEL.md step 3. A stroke freezes the brush that
// painted it, so one sweep can cross material wanting different grain params.
// DENSITY is why these have to be separate voices rather than per-grain data:
// the onset period belongs to the clock, and one clock cannot produce two
// densities. Separate from the seed pool on purpose — clouds must not compete
// with brushes for polyphony.
const MAX_CURSOR_VOICES = 16;

// ── The candidate TABLES (R3, 2026-09-06) — must match grain-worklet-bridge.js ──
// One region per cursor voice (0 = the live voicing, 1..8 = the voice slots) in
// one SharedArrayBuffer the bridge owns. Each region: a 4-word header
// [published half, count of half 0, count of half 1, generation], then two
// halves of CT_ROWS rows × CT_WORDS words followed by a CT_ROWS permutation
// (row order as made, for step mode). The bridge writes the unpublished half
// and flips; a fire reads the published half. Row words: bufIndex i32,
// offset i32, length i32, azDeg f32, elBias f32, particleId i32, radiusFade f32.
const CT_ROWS = 8192, CT_WORDS = 7, CT_HEADER = 4;
const CT_HALF = CT_ROWS * CT_WORDS + CT_ROWS;
const CT_REGION = CT_HEADER + 2 * CT_HALF;

// ── The throttle's window and its two thresholds (P3, 2026-09-06) ──────────
// The thread's own load over a SHORT window is what says "near the limit".
// 32 blocks is 85 ms at 48 kHz: long enough that the 1 ms clock's rounding
// averages out (±3 % at the thresholds), short enough that a burst is not
// averaged away — the mean over a second is exactly what hides the thing that
// breaks the sound. Skipping ramps from nothing at 70 % of the block budget
// to everything at 95 %.
const LOAD_WINDOW_BLOCKS = 32;
const LOAD_SOFT = 0.70, LOAD_HARD = 0.95;
// The backstop: a pool about to run out still thins, because the alternative
// is _allocGrain stealing a sounding grain, which is a click. Nothing to do
// with load — it is the pool's own last 10 %.
const POOL_SOFT = 0.90;

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
    // Spare chunks, transferred in by the bridge ('liveSpare') so a take that
    // outgrows a chunk POPS one inside process() instead of allocating 5.8 MB
    // on the audio thread mid-take (R5, 2026-09-06). A chunk freed by a clear
    // goes back here. `_spareLow` rides the next feedback; the bridge tops up.
    this._spareChunks = [];
    this._spareLow = false;
    this._procMs = 0; this._procMax = 0; this._procBlocks = 0; this._chunkAllocs = 0;   // R6 load figures
    // The throttle's own signal (P3): load over the last LOAD_WINDOW_BLOCKS.
    this._procMs32 = 0; this._blocks32 = 0; this._loadShort = 0;
    this._blockMs = BLOCK / 48000 * 1000;   // corrected at init from the real rate
    this._diagThrottled = 0;                // onsets the throttle skipped
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

    this._allocPool(POOL_DEFAULT);

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
    this._diagJitterDrop  = 0;      // jittered reads dropped for landing outside the audio
    this._diagDirRev      = 0;
    this._grainStart      = 0;      // default buffer offset
    this._numChannels     = 1;      // output channel count
    this._eqGain          = 1.0;    // 1/√numChannels — equal-power spread for elevation bias
    // Filter parameters (cursor). ONE filter per grain (2026-09-23): a
    // state-variable filter with a type, a cutoff and a resonance, the way
    // every grain synth does it. `filterType` 0 = off, 1 = lp, 2 = bp, 3 = hp.
    this._filterType      = 0;
    this._cutoff          = 1000;   // Hz
    this._res             = 0;      // 0 = flat (Butterworth) … 1 = about to ring
    this._filterFreqJitter = 0;     // per-grain cutoff randomization (0–1, octaves)
    this._durJitter       = 0;      // duration percentage jitter (0–1)
    this._startJitter     = 0;      // read-offset jitter in SECONDS (0 = off)
    this._fadeRatio       = 0.5;    // attack/release each as fraction of dur
    this._fadeMode        = 0;      // 0 = proportional (fadeRatio), 1 = absolute (fadeMs)
    this._fadeMs          = 0.020;  // absolute ramp length in SECONDS
    this._panSpread       = 0;      // spatial spread (0=point source, 1=full 360°)
    this._kSeqMode        = false;  // sequential candidate stepping (vs random)
    this._seqIdx          = 0;      // current sequential index into candidate list

    // ── Candidate list (from main thread spatial search) ──────────────────
    // Each entry: { bufIndex, offset, length, azDeg, particleId, radiusFade }
    // Sorted in the order made (stroke, then its clock) when kSeqMode is active.
    this._candidates = [];
    this._candidateCount = 0;

    // ── Seeds (independent onset clocks, params, candidates) ─────────────
    // Each seed: { active, nextOnset, periodSamples, durationSamples,
    //   volume, pitchShift, pitchJitter, periodVar, durVar, envShape,
    //   probability, direction, gain, candidates[], candidateCount }
    this._seeds = [];
    this._cursorVoices = [];
    for (let si = 0; si < MAX_CURSOR_VOICES; si++) this._cursorVoices.push(this._makeVoice(true));
    // The candidate tables (R3): views over the bridge's SharedArrayBuffer, and
    // the region the live cursor voice reads (-1: the `_candidates` objects).
    this._ctI = null; this._ctF = null;
    this._candTab = -1;
    for (let si = 0; si < MAX_SEED_VOICES; si++) this._seeds.push(this._makeVoice());

    // ── VBAP lookup table ─────────────────────────────────────────────────
    // 360 entries: [idxA, idxB, wA, wB] packed as 4 values per degree
    this._vbapLUT = null;  // Float32Array(1440) or null for stereo/mono

    // ── Feedback ring (worklet → main thread) ─────────────────────────────
    // Circular buffer of recent grain onsets for glow overlay
    // Pre-allocated feedback ring — no allocations during process().
    // Stores particle IDs of recently fired grains for glow overlay.
    this._feedbackLen = 0;          // entries written since last post
    this._feedbackTimer = 0;        // sample counter for periodic posting

    // ── PRNG state (xorshift32 — deterministic, no allocation) ───────────
    this._rngState = 0xDEADBEEF;

    // Grains stolen from the pool since the last feedback post (a hard cut).
    this._diagSteals = 0;

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
        // The pool size the app asked for (P2). Re-allocating here is free:
        // nothing is sounding yet.
        if (data.maxGrains && data.maxGrains !== this._pool) this._allocPool(data.maxGrains);
        this._recBuf = new Float32Array(data.sab);
        this._recLen = data.bufferLength;
        this._sr = data.sampleRate || 48000;
        this._blockMs = BLOCK / this._sr * 1000;
        if (data.numChannels) {
          this._numChannels = data.numChannels;
          this._eqGain = 1 / Math.sqrt(data.numChannels);
        }
        this._sampleClock = 0;
        this._nextOnset = 0;
        this._activeCount = 0;
        this._freePtr = this._pool;
        for (let i = 0; i < this._pool; i++) {
          this._freeList[i] = i;
          this._gActive[i] = 0;
        }
        this._resetActive();
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
        // Compact candidate list as a MESSAGE. The app posts through the
        // shared tables (`cursorTables` below) since R3; only
        // grain-engine.test.mjs still sends this, as its seam into the
        // candidate path. Kept for that.
        this._candidates = data.list || [];
        this._candidateCount = this._candidates.length;
        this._candTab = -1;
        break;

      case 'cursorTables':
        // The bridge's SharedArrayBuffer of candidate tables (R3). Views once;
        // every tick after this is a header read, never a message of objects.
        this._ctI = new Int32Array(data.sab);
        this._ctF = new Float32Array(data.sab);
        break;

      case 'cursorVoicesTab': {
        // The table form of 'cursorVoices': which regions are live this tick
        // and each voice's params; the candidates themselves are in the SAB.
        for (let vi = 0; vi < MAX_CURSOR_VOICES; vi++) this._cursorVoices[vi].active = false;
        this._candidates = [];
        this._candidateCount = 0;
        this._candTab = data.liveActive && this._ctI ? 0 : -1;
        const vlist = data.voices || [];
        for (let i = 0; i < vlist.length; i++) {
          const e = vlist[i];
          if (!e || !(e.slot >= 1 && e.slot <= MAX_CURSOR_VOICES)) continue;
          const v = this._cursorVoices[e.slot - 1];
          v.active = true;
          v.gain = 1.0;
          v.candidates = null;
          v.candidateCount = 0;
          v.tabRegion = e.slot;
          if (e.params) this._applyVoiceParams(v, e.params);
          if (data.kSeqMode != null) {
            const was = v.kSeqMode;
            v.kSeqMode = !!data.kSeqMode;
            if (v.kSeqMode && !was) v.seqIdx = 0;
          }
          if (v.nextOnset === 0 || !v.periodSamples) v.nextOnset = this._sampleClock;
        }
        break;
      }

      case 'cursorVoices': {
        // One voice per distinct frozen brush under the cursor this tick
        // (docs/archive/BRUSH-MODEL.md step 3). The main thread buckets the candidate
        // pool by the voicing each stroke froze; see grain-worklet-bridge.js.
        //
        // vo === 0 is the reserved "follow the live params" voicing, and it
        // routes to the ORIGINAL cursor voice — this._candidates plus the
        // global param block — rather than to a slot here. That is what
        // material painted before step 3 plays with, and it means the
        // pre-existing cursor path stays exactly as it was rather than being
        // reimplemented alongside it.
        const vlist = data.list || [];
        for (let vi = 0; vi < MAX_CURSOR_VOICES; vi++) this._cursorVoices[vi].active = false;
        this._candidates = [];
        this._candidateCount = 0;
        let slot = 0;
        for (let i = 0; i < vlist.length; i++) {
          const e = vlist[i];
          if (!e) continue;
          if (!e.vo) {
            this._candidates = e.candidates || [];
            this._candidateCount = this._candidates.length;
            continue;
          }
          if (slot >= MAX_CURSOR_VOICES) break;
          const v = this._cursorVoices[slot++];
          v.active = true;
          v.gain = 1.0;
          v.candidates = e.candidates || [];
          v.candidateCount = v.candidates.length;
          v.tabRegion = -1;
          if (e.params) this._applyVoiceParams(v, e.params);
          // Order is the LENS's, live — the message-level flag overrides
          // whatever the frozen voicing block carried (#233).
          if (data.kSeqMode != null) {
            const was = v.kSeqMode;
            v.kSeqMode = !!data.kSeqMode;
            if (v.kSeqMode && !was) v.seqIdx = 0;
          }
          if (v.nextOnset === 0 || !v.periodSamples) v.nextOnset = this._sampleClock;
        }
        break;
      }

      case 'seeds': {
        // Per-seed state updates from main thread (~50Hz).
        // Each entry: { index, active, params:{...}, gain, candidates:[...] }
        const seedList = data.list || [];
        // First, deactivate all seeds (main thread sends only active ones)
        for (let si = 0; si < MAX_SEED_VOICES; si++) this._seeds[si].active = false;
        for (let i = 0; i < seedList.length; i++) {
          const sd = seedList[i];
          const si = sd.index;
          if (si < 0 || si >= MAX_SEED_VOICES) continue;
          const seed = this._seeds[si];
          seed.active = true;
          seed.gain = sd.gain ?? 1.0;
          seed.candidates = sd.candidates || [];
          seed.candidateCount = seed.candidates.length;
          // Apply params if provided
          if (sd.params) this._applyVoiceParams(seed, sd.params);
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
        // A new take is about to overwrite chunk 0 from sample 0. Grains from
        // the previous take may still be reading it (a second press within
        // one grain-length of the first release), so fade them over a block
        // now, before their material changes under them.
        this._fadeLiveGrains(0);
        this._liveChunkSize = chunkSize;
        this._liveBufLen = 0;
        // Warm cache: reuse first chunk if it exists and matches size
        if (this._liveChunks.length > 0 && this._liveChunks[0].length === chunkSize) {
          // Keep first chunk; extras from a previous long take become spares.
          this._returnChunks(1);
        } else {
          // A size change orphans the old chunks and spares (once per app
          // life in practice — the size is the sample rate × 30 s).
          this._spareChunks.length = 0;
          this._liveChunks = [new Float32Array(chunkSize)];
        }
        break;
      }

      case 'maxGrains':
        // Settings → Audio moved it. Everything sounding stops — the setting
        // is not a performance control.
        if (data.n && data.n !== this._pool) this._allocPool(data.n);
        break;

      case 'liveSpare': {
        // A spare chunk from the bridge (an ArrayBuffer, transferred). Kept
        // only if it is the current size; two spares are plenty — a chunk is
        // 30 s and the top-up round trip is one feedback (~33 ms).
        const buf = data.buffer;
        if (buf instanceof ArrayBuffer && this._liveChunkSize > 0 && buf.byteLength === this._liveChunkSize * 4 && this._spareChunks.length < 2) {
          this._spareChunks.push(new Float32Array(buf));
        }
        this._spareLow = this._spareChunks.length < 1;
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
            this._liveChunks.push(this._takeChunk(cs));
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
        // Only zero out the valid-length counter — no deallocation. Chunks
        // beyond the first ARE freed, so a grain still reading one of them
        // (a take over 30 s, released under a second ago) fades first.
        this._fadeLiveGrains(this._liveChunkSize);
        this._returnChunks(1);          // extra chunks become spares, not garbage
        this._liveBufLen = 0;
        this._liveRecording = false;
        break;

      case 'liveRecStart':
        this._liveRecording = true;
        break;

      case 'liveRecStop':
        this._liveRecording = false;
        // The take has stopped growing. Snapshot its final length into every
        // live grain (the render loop switches from _liveBufLen to _gBufLen[i]
        // here), and bring each grain's envelope down to land on the last
        // audio it has. A grain riding the edge used to keep its envelope and
        // read zeros from the edge on — a hard cut to silence mid-envelope,
        // the click Ek heard on every early release (2026-09-02).
        for (let i = 0; i < this._pool; i++) {
          if (this._gActive[i] && this._gBufIndex[i] === -2) {
            this._gBufLen[i] = this._liveBufLen;
            this._landGrainOnEdge(i, this._liveBufLen);
          }
        }
        break;

      case 'stop':
        this._active = false;
        this._liveRecording = false;
        this._liveChunks = [];
        this._liveBufLen = 0;
        for (let i = 0; i < this._pool; i++) this._gActive[i] = 0;
        this._resetActive();
        this._activeCount = 0;
        this._freePtr = this._pool;
        for (let i = 0; i < this._pool; i++) this._freeList[i] = i;
        break;

      // Soft-flush: fade out all in-flight grains (~3ms) instead of hard-
      // killing them (which clicks). Buffers are kept alive for the fade;
      // candidates are cleared so no new grains fire.
      case 'flush':
        // Clear candidate lists so onset clocks don't re-fire stale grains
        this._candidates = [];
        this._candidateCount = 0;
        for (let vi = 0; vi < MAX_CURSOR_VOICES; vi++) {
          this._cursorVoices[vi].candidates = [];
          this._cursorVoices[vi].candidateCount = 0;
          this._cursorVoices[vi].active = false;
        }
        for (let si = 0; si < MAX_SEED_VOICES; si++) {
          this._seeds[si].candidates = [];
          this._seeds[si].candidateCount = 0;
          this._seeds[si].active = false;
        }
        // Accelerate all active grains to fade out in ~128 samples (~2.7ms).
        // The hann/tri envelope tapers to zero naturally — no click.
        // Buffers stay alive so grains can still read during the fade.
        for (let i = 0; i < this._pool; i++) {
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
      // grain-worklet-bridge.js and docs/archive/GROUP-SHOW-NOISE-GLITCH.md.
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
        for (let i = 0; i < this._pool; i++) {
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
        for (let vi = 0; vi < MAX_CURSOR_VOICES; vi++) {
          this._cursorVoices[vi].candidates = [];
          this._cursorVoices[vi].candidateCount = 0;
        }
        for (let si = 0; si < MAX_SEED_VOICES; si++) {
          this._seeds[si].candidates = [];
          this._seeds[si].candidateCount = 0;
        }
        break;
      }

    }
  }

  /**
   * One independent voice: its own onset clock, its own full param block, its
   * own candidate list. Seeds (clouds) and cursor voices (frozen brushes) are
   * the same shape on purpose — _fireGrain() reads every param off whichever
   * voice it is handed, so neither needed a special case to exist.
   */
  _makeVoice(isCursor = false) {
    return {
      // Which bus this voice's grains belong on, and whether a cursor flush
      // takes them. NOT derivable from "was a voice passed to _fireGrain" any
      // more: cursor voices are passed exactly like seeds, so without this flag
      // every frozen-brush grain would be tagged a seed grain — routed to the
      // house bus instead of the monitor, and left running by undo.
      isCursor,
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
      startJitter: 0,       // read-offset jitter in seconds
      fadeRatio: 0.5,       // attack/release each as fraction of dur
      fadeMode: 0,          // 0 = proportional, 1 = absolute
      fadeMs: 0.020,        // absolute ramp length in seconds
      envShape: 0,
      probability: 1.0,
      direction: 0,
      gain: 1.0,            // seedWeight × envGain (pre-computed on main thread)
      filterType: 0,
      cutoff: 1000,
      res: 0,
      filterFreqJitter: 0,
      panSpread: 0,         // spatial spread (0–1)
      kSeqMode: false,      // sequential candidate stepping
      seqIdx: 0,            // current sequential index
      candidates: [],
      candidateCount: 0,
    };
  }

  /** Apply a param block to a voice. One field list, both voice kinds. */
  _applyVoiceParams(v, p) {
    const sr = this._sr;
    if (p.period != null)      v.periodSamples   = Math.max(1, Math.round(p.period * sr));
    if (p.duration != null)    v.durationSamples = Math.max(1, Math.round(p.duration * sr));
    if (p.volume != null)      v.volume = p.volume;
    if (p.pitchShift != null)  v.pitchShift = p.pitchShift;
    if (p.pitchJitter != null) v.pitchJitter = p.pitchJitter;
    if (p.periodVar != null)   v.periodVar = p.periodVar;
    if (p.durVar != null)      v.durVar = p.durVar;
    if (p.envShape != null)    v.envShape = p.envShape;
    if (p.probability != null) v.probability = p.probability;
    if (p.direction != null)   v.direction = p.direction;
    if (p.durJitter != null)   v.durJitter = p.durJitter;
    if (p.startJitter != null) v.startJitter = p.startJitter;
    if (p.fadeRatio != null)   v.fadeRatio = p.fadeRatio;
    if (p.fadeMode != null)    v.fadeMode = p.fadeMode;
    if (p.fadeMs != null)      v.fadeMs = p.fadeMs;
    if (p.filterType != null)  v.filterType = p.filterType | 0;
    if (p.cutoff != null)      v.cutoff = p.cutoff;
    if (p.res != null)         v.res = p.res;
    if (p.filterFreqJitter != null) v.filterFreqJitter = p.filterFreqJitter;
    if (p.panSpread != null)   v.panSpread = p.panSpread;
    if (p.kSeqMode != null) {
      const was = v.kSeqMode;
      v.kSeqMode = !!p.kSeqMode;
      if (v.kSeqMode && !was) v.seqIdx = 0;
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
    if (p.filterType != null)
      this._filterType = p.filterType | 0;
    if (p.cutoff != null)
      this._cutoff = p.cutoff;
    if (p.res != null)
      this._res = p.res;
    if (p.filterFreqJitter != null)
      this._filterFreqJitter = p.filterFreqJitter;
    if (p.durJitter != null)
      this._durJitter = p.durJitter;
    if (p.startJitter != null)
      this._startJitter = p.startJitter;
    if (p.fadeRatio != null)
      this._fadeRatio = p.fadeRatio;
    if (p.fadeMode != null)
      this._fadeMode = p.fadeMode;
    if (p.fadeMs != null)
      this._fadeMs = p.fadeMs;
    if (p.panSpread != null)
      this._panSpread = p.panSpread;
    if (p.kSeqMode != null) {
      const was = this._kSeqMode;
      this._kSeqMode = !!p.kSeqMode;
      if (this._kSeqMode && !was) this._seqIdx = 0;  // reset on toggle-on
    }
  }

  // ── Envelope lookup (zero-alloc) ──────────────────────────────────────
  // fr = fadeRatio: the fraction of the grain spent in attack, and again in
  // release.  Both tables span the WHOLE grain (hann rises 0→1 over the first
  // half and falls over the second), so before fadeRatio was wired through
  // every grain was permanently the fr = 0.5 case — full gain only at the exact
  // centre.  That is why a transient had to sit mid-grain to be heard at level,
  // and why the rect curve sounded so much more present on a percussive hit.
  //
  // Below 0.5 the ramps keep their shape and a unity sustain opens between
  // them, so an attack anywhere in the middle plays unattenuated.
  _envelope(phase, shape, fr) {
    if (shape === 2) return 1.0;  // rect — no envelope
    const table = shape === 1 ? this._triTable : this._hannTable;
    let t;
    if (fr >= 0.5) {
      t = phase;                                     // unchanged classic shape
    } else if (fr <= 0) {
      return 1.0;                                    // instant on/off
    } else if (phase < fr) {
      t = (phase / fr) * 0.5;                        // attack  → table 0 … 0.5
    } else if (phase > 1 - fr) {
      t = 0.5 + ((phase - (1 - fr)) / fr) * 0.5;     // release → table 0.5 … 1
    } else {
      return 1.0;                                    // sustain
    }
    const idx = t * (HANN_TABLE_SIZE - 1);
    const i0 = idx | 0;
    const i1 = i0 + 1 < HANN_TABLE_SIZE ? i0 + 1 : i0;
    const frac = idx - i0;
    return table[i0] + frac * (table[i1] - table[i0]);
  }

  // ── Read sample from a buffer (4-point Hermite, wrapping) ─────────────
  // FOUR POINTS, NOT TWO (Ek, 2026-09-14: "fix the interpolation issue so
  // long as it doesn't make it more latent or cpu intensive"). At rate 1.0
  // from an integer start nothing interpolates at all, but every pitch shift,
  // pitch JITTER and tape speed off 1.0 reads between samples, and 2-point
  // linear is then the dominant distortion in the engine — a triangle through
  // the material, worst on bright sources and transposing up.
  //
  // It costs LESS than the linear read it replaces, which is why it can be
  // unconditional. The old reader spent most of its time in `((pos % len) +
  // len) % len` — two float modulos per sample — and the caller now keeps
  // `pos` inside the buffer with a compare instead, so this sees a position
  // already in [0, len). Benchmarked over 4M reads on this machine's V8:
  // linear-with-modulo 11.3 ns, linear-with-compare 8.2 ns, Hermite-with-
  // compare 10.0 ns. So the swap RECLAIMS ~1.2 ns a sample — about 3 % of a
  // core at a full 512-grain pool — while reading better.
  //
  // No latency either: the four points are x[i−1 … i+2] around a position the
  // grain has already been given, not a look-ahead on the input. A buffer too
  // short for four points falls back to linear.
  //
  // Catmull-Rom form (Niemitalo): the cubic through x0 and x1 whose slopes are
  // the central differences at each. `pos` must already be in [0, len).
  _readSample(buf, len, pos) {
    if (len === 0) return 0;
    const i1 = pos | 0;
    const f  = pos - i1;
    if (len < 4) {                       // too short to have four points
      const j = i1 + 1 < len ? i1 + 1 : 0;
      return buf[i1] + f * (buf[j] - buf[i1]);
    }
    const i0 = i1 > 0 ? i1 - 1 : len - 1;
    let i2 = i1 + 1; if (i2 >= len) i2 = 0;
    let i3 = i2 + 1; if (i3 >= len) i3 = 0;
    const xm = buf[i0], x0 = buf[i1], x1 = buf[i2], x2 = buf[i3];
    const c1 = 0.5 * (x1 - xm);
    const c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2;
    const c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
    return ((c3 * f + c2) * f + c1) * f + x0;
  }

  // ── Read sample from chunked live buffer (linear interpolation, clamped) ──
  // Unlike _readSample (which wraps for looping), this returns 0 for
  // out-of-bounds reads. During active recording the buffer is growing;
  // wrapping would jump to the start and cause audible crunch/clicks.
  // Grains are duration-clamped at fire time to fit the available data,
  // so reads past the boundary should be rare (only from rounding).
  // Four points here too, clamped rather than wrapped — and one chunk
  // division instead of the two the linear reader did, because the four
  // points are in the SAME chunk except within three samples of a boundary
  // (chunks are seconds long). Out of range is still 0 and the end of the
  // material still holds its last sample, so nothing about where a grain
  // stops has changed.
  _readLiveChunked(len, pos) {
    if (len === 0) return 0;
    const i1 = pos | 0;
    if (i1 < 0 || i1 >= len) return 0;
    const cs = this._liveChunkSize;
    if (cs === 0) return 0;
    const ci = (i1 / cs) | 0;
    const chunk = this._liveChunks[ci];
    if (!chunk) return 0;               // chunk cleared while grain still fading
    const f = pos - i1;
    const o = i1 - ci * cs;
    let xm, x0, x1, x2;
    if (o >= 1 && o + 2 < cs && i1 + 2 < len) {
      // The whole kernel is inside this chunk — the overwhelming case.
      xm = chunk[o - 1]; x0 = chunk[o]; x1 = chunk[o + 1]; x2 = chunk[o + 2];
    } else {
      // A boundary: fetch each point on its own, holding the ends.
      const at = j => { if (j < 0 || j >= len) return null;
        const c = this._liveChunks[(j / cs) | 0];
        return c ? c[j - ((j / cs) | 0) * cs] : null; };
      x0 = chunk[o];
      const a = at(i1 - 1), b = at(i1 + 1);
      xm = a === null ? x0 : a;
      x1 = b === null ? x0 : b;
      const c = at(i1 + 2);
      x2 = c === null ? x1 : c;
    }
    const c1 = 0.5 * (x1 - xm);
    const c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2;
    const c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
    return ((c3 * f + c2) * f + c1) * f + x0;
  }

  // ── Land a live grain on the end of its audio ─────────────────────────
  // The buffer this grain reads has stopped growing at `len`. If the grain
  // would still be sounding when its read head runs off the end, shorten the
  // rest of its envelope so it reaches zero exactly there — the same
  // accelerated-phase trick 'flush' uses, but sized to the audio left rather
  // than to one block. A reverse grain walks away from the end toward 0, so
  // its runway is its own read position. Never faster than one block.
  _landGrainOnEdge(i, len) {
    const rate = this._gReadRate[i];
    if (rate === 0) return;
    let audioLeft = rate > 0
      ? (len - this._gReadPos[i]) / rate
      : this._gReadPos[i] / -rate;
    if (audioLeft < 128) audioLeft = 128;
    // A grain in its sustain (fade ratio under ½, envelope flat at 1) skips
    // straight to the start of its release — the level is 1 on both sides of
    // the jump, so nothing is heard — and the release alone spans the audio
    // that is left. Compressing the sustain too would only steepen the
    // release for no reason. A grain still in its attack keeps its shape and
    // is compressed whole.
    const fr = this._gFade[i];
    let phase = this._gPhase[i];
    if (fr > 0 && fr < 0.5 && phase >= fr && phase < 1 - fr) {
      phase = 1 - fr;
      this._gPhase[i] = phase;
    }
    const remainingPhase = 1 - phase;
    if (remainingPhase <= 0) return;
    const samplesLeft = remainingPhase / this._gPhaseInc[i];
    if (samplesLeft > audioLeft) this._gPhaseInc[i] = remainingPhase / audioLeft;
  }

  // Fade every active live-buffer grain whose read head is at or past
  // `fromPos` out over one block. Used where the live chunks are about to
  // change under a grain: a new take rewriting chunk 0, or a clear freeing
  // the chunks after the first.
  _fadeLiveGrains(fromPos) {
    for (let i = 0; i < this._pool; i++) {
      if (!this._gActive[i] || this._gBufIndex[i] !== -2) continue;
      if (this._gReadPos[i] < fromPos) continue;
      const remaining = 1.0 - this._gPhase[i];
      if (remaining > 0) this._gPhaseInc[i] = remaining / 128;
    }
  }


  /** (Re)allocate the grain pool at `n` slots — every per-grain array, the
   *  free list, the active list and the feedback ring, which is always the
   *  pool's size so a grain that sounded can always light its mark. Any grain
   *  sounding is dropped: this runs at `init` and when the setting changes,
   *  never while playing a phrase. */
  _allocPool(n) {
    const size = Math.max(32, Math.min(4096, n | 0));
    this._pool = size;
    // ── Grain pool ────────────────────────────────────────────────────────
    // Pre-allocated flat arrays for zero-alloc process().
    // Each grain is at index [i] across all arrays.
    this._gActive     = new Uint8Array(this._pool);    // 0 or 1
    this._gReadPos    = new Float64Array(this._pool);   // fractional sample position
    this._gReadRate   = new Float32Array(this._pool);   // pitch ratio (1.0 = original)
    this._gPhase      = new Float32Array(this._pool);   // 0→1 envelope progress
    this._gPhaseInc   = new Float32Array(this._pool);   // 1 / durationSamples
    this._gVolume     = new Float32Array(this._pool);   // per-grain volume
    this._gEnvShape   = new Uint8Array(this._pool);     // 0=hann, 1=tri, 2=rect
    this._gFade       = new Float32Array(this._pool);   // fadeRatio captured at fire time
    this._gBufIndex   = new Int32Array(this._pool);     // -1=recBuf, 0+=sampleBufs[i]
    this._gBufOffset  = new Float64Array(this._pool);   // start offset in buffer (samples)
    this._gBufLen     = new Uint32Array(this._pool);    // length of buffer region
    this._gParticleId = new Int32Array(this._pool);     // for feedback ring (-1 = none)
    this._gIsSeed     = new Uint8Array(this._pool);     // 0=cursor grain, 1=seed grain
    // VBAP per-grain: speaker pair indices + weights
    this._gVbapIdxA   = new Uint8Array(this._pool);
    this._gVbapIdxB   = new Uint8Array(this._pool);
    this._gVbapWA     = new Float32Array(this._pool);
    this._gVbapWB     = new Float32Array(this._pool);
    this._gElBias     = new Float32Array(this._pool);   // elevation center-bias (0=equator, 1=pole)
    // Per-grain state-variable filter (Simper's trapezoidal SVF): one
    // section, four coefficients, two integrator states. Type 0 = off,
    // 1 = lp, 2 = bp, 3 = hp — the output is picked per sample from the
    // same three integrator terms, so a type costs nothing to switch.
    this._gFilterType = new Uint8Array(this._pool);
    this._gSvfA1  = new Float32Array(this._pool);
    this._gSvfA2  = new Float32Array(this._pool);
    this._gSvfA3  = new Float32Array(this._pool);
    this._gSvfK   = new Float32Array(this._pool);   // damping = 1/Q
    this._gSvfIc1 = new Float32Array(this._pool);   // integrator states
    this._gSvfIc2 = new Float32Array(this._pool);

    // Source tag: 0 = cursor, 1 = seed (for selective flush on undo)
    this._gIsCursor = new Uint8Array(this._pool);

    // Free list — simple stack
    this._freeList = new Uint16Array(this._pool);
    this._freePtr  = this._pool;  // points past last free slot
    for (let i = 0; i < this._pool; i++) this._freeList[i] = i;
    // The ACTIVE grains, as an unordered list (R4, 2026-09-06): the render
    // loop walks this instead of scanning all 256 slots per sample. A slot's
    // position in it is kept so freeing is a swap-remove, O(1).
    this._activeIdx = new Uint16Array(this._pool);
    this._activePos = new Int16Array(this._pool).fill(-1);
    this._activeN   = 0;
    // The sample within the current block a grain was fired at: it renders
    // from there, not from the block's start — the onset stays sample-exact.
    this._gStartS   = new Uint8Array(this._pool);
    this._curS      = 0;
    this._scratch   = new Float32Array(BLOCK);   // one grain's block, before the mix

    this._feedbackBuf = new Int32Array(size);
    this._feedbackLen = 0;
    this._activeCount = 0;
  }

  // ── Allocate a grain slot from free list ──────────────────────────────
  _allocGrain() {
    if (this._freePtr === 0) {
      // Pool exhausted — steal one that is sounding: the head of the active
      // list. A hard kill, and therefore a click; counted so a crackle can be
      // attributed.
      if (this._activeN > 0) {
        const i = this._activeIdx[0];
        this._deactivate(i);
        this._activeCount--;
        this._diagSteals++;
        return i;
      }
      return -1;  // shouldn't happen
    }
    return this._freeList[--this._freePtr];
  }

  // ── Free a grain slot back to pool ────────────────────────────────────
  _freeGrain(idx) {
    this._deactivate(idx);
    this._freeList[this._freePtr++] = idx;
    this._activeCount--;
  }

  /** A chunk for the live take: a spare if one is in, else an allocation on
   *  the audio thread — counted, because that is the thing R5 removes. */
  _takeChunk(cs) {
    const sp = this._spareChunks.pop();
    if (sp) { this._spareLow = this._spareChunks.length < 1; return sp; }
    this._chunkAllocs++;
    this._spareLow = true;
    return new Float32Array(cs);
  }

  /** Chunks past `keep` go back to the spare pool (at most two are kept). */
  _returnChunks(keep) {
    while (this._liveChunks.length > keep) {
      const c = this._liveChunks.pop();
      if (this._spareChunks.length < 2 && c.length === this._liveChunkSize) this._spareChunks.push(c);
    }
    this._spareLow = this._spareChunks.length < 1;
  }

  /** Into the active list, fired at this block's current sample. */
  _activate(idx) {
    this._gActive[idx] = 1;
    this._activePos[idx] = this._activeN;
    this._activeIdx[this._activeN++] = idx;
    this._gStartS[idx] = this._curS;
  }

  /** Out of the active list — swap-remove, so the walk in _render must not
   *  advance past a slot it just freed. */
  _deactivate(idx) {
    const pos = this._activePos[idx];
    if (pos >= 0) {
      const last = this._activeIdx[--this._activeN];
      this._activeIdx[pos] = last;
      this._activePos[last] = pos;
      this._activePos[idx] = -1;
    }
    this._gActive[idx] = 0;
  }

  _resetActive() {
    this._activeN = 0;
    this._activePos.fill(-1);
    this._gStartS.fill(0);
  }

  // ── SVF coefficients (Andrew Simper, "Solving the continuous SVF
  //    equations using trapezoidal integration", Cytomic 2013) ─────────────
  // `res` 0–1 maps onto Q on a log scale from Butterworth (0.707, flat
  // passband, no bump) to 10 (+20 dB at the cutoff, about to ring) — the same
  // curve the sheet draws (tiles.js `_resQ`) and state.js names
  // (FILTER_Q_FLAT / FILTER_Q_PEAK). The worklet cannot import, so the two
  // numbers are repeated here on purpose.
  _computeSVF(freq, res) {
    const g = Math.tan(Math.PI * freq / this._sr);
    const Q = 0.707 * Math.pow(10 / 0.707, Math.max(0, Math.min(1, res)));
    const k = 1 / Q;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    return [a1, a2, a3, k];
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
    // A cursor voice on a table (R3): the count is the published half's.
    const tab = seed ? (seed.tabRegion ?? -1) : this._candTab;
    const ctI = this._ctI;
    let tabHalf = 0, tabBase = 0;
    let candCount;
    if (tab >= 0 && ctI) {
      const hdr = tab * CT_REGION;
      tabHalf = Atomics.load(ctI, hdr);
      candCount = Atomics.load(ctI, hdr + 1 + tabHalf);
      tabBase = hdr + CT_HEADER + tabHalf * CT_HALF;
    } else {
      candCount = seed ? seed.candidateCount : this._candidateCount;
    }
    const fType     = seed ? (seed.filterType ?? 0)   : this._filterType;
    const cutoff    = seed ? (seed.cutoff ?? 1000)    : this._cutoff;
    const res       = seed ? (seed.res ?? 0)          : this._res;
    const fJitter   = seed ? (seed.filterFreqJitter ?? 0) : this._filterFreqJitter;
    const djitter   = seed ? (seed.durJitter ?? 0)     : this._durJitter;
    const sJitter   = seed ? (seed.startJitter ?? 0)   : this._startJitter;
    const fadeR     = seed ? (seed.fadeRatio ?? 0.5)   : this._fadeRatio;
    const fMode     = seed ? (seed.fadeMode ?? 0)      : this._fadeMode;
    const fMs       = seed ? (seed.fadeMs ?? 0.020)    : this._fadeMs;
    const spread    = seed ? (seed.panSpread ?? 0)      : this._panSpread;

    // No candidates → nothing to play (radius mode with cursor outside range)
    if (candCount === 0) return;

    // Probability gate
    if (prob < 1.0 && this._rand01() > prob) return;

    const idx = this._allocGrain();
    if (idx < 0) return;
    // A cursor VOICE is a cursor grain even though it arrives as `seed`.
    this._gIsCursor[idx] = (!seed || seed.isCursor) ? 1 : 0;

    // ── Pick source: candidate list or default ──────────────────────────
    let bufIndex = -1;     // -1 = main recBuf
    let bufOffset = this._grainStart;
    let bufLen = this._recLen;
    let azDeg = 0;
    let elBias = 0;        // elevation center-bias: 0=equator, 1=pole
    let particleId = -1;
    let radiusFade = 1.0;

    // k-seq mode: step through candidates in the order they were made (the bridge sorts).
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
      if (tab >= 0 && ctI) {
        // Step mode walks the permutation (rows in the order made); random reads the row.
        const row = kSeq ? ctI[tabBase + CT_ROWS * CT_WORDS + ci] : ci;
        const w = tabBase + row * CT_WORDS;
        bufIndex    = ctI[w];
        bufOffset   = ctI[w + 1];
        bufLen      = ctI[w + 2];
        azDeg       = this._ctF[w + 3];
        elBias      = this._ctF[w + 4];
        particleId  = ctI[w + 5];
        radiusFade  = this._ctF[w + 6];
      } else {
        const c = cands[ci];
        bufIndex    = c.bufIndex ?? -1;
        bufOffset   = c.offset ?? 0;
        bufLen      = c.length ?? this._recLen;
        azDeg       = c.azDeg ?? 0;
        elBias      = c.elBias ?? 0;
        particleId  = c.particleId ?? -1;
        radiusFade  = c.radiusFade ?? 1.0;
      }
    }

    // For live buffer grains: snapshot the worklet's current data extent.
    // The candidate's `length` comes from the bridge (may lag), but the
    // worklet knows exactly how much data it has. While recording the render
    // loop reads the LIVE length so the grain can follow the edge; after
    // 'liveRecStop' it reads this per-grain snapshot instead.
    if (bufIndex === -2 && this._liveBufLen > 0) {
      bufLen = this._liveBufLen;
    }

    // ── Start offset jitter ─────────────────────────────────────────────
    // Markers are deposited on a fixed clock (20Hz default), so without this
    // a grain can only ever begin exactly where a marker landed — the paint
    // interval is the instrument's scrub resolution.  startJitter randomises
    // the read offset ±N seconds around the marker, so the audio *between*
    // markers becomes reachable without depositing more particles (which is
    // what actually costs the scheduler: its per-tick work is O(particles)).
    //
    // Deliberately applied here, before the duration-clamp block below, so
    // the existing guards catch the edge cases: an offset pushed past the
    // buffer end gets slid back with duration preserved, and a frontier
    // grain with <64 samples left gets dropped cleanly.  Only the negative
    // side needs its own clamp.
    //
    // Also deliberately applied in the worklet rather than the bridge: the
    // bridge sorts candidates for k-seq mode, and jittering before
    // that sort would scramble sequential playback order.
    //
    // A jittered read that lands OUTSIDE the audio that exists is DROPPED,
    // not clamped (Ek, 2026-09-05). It used to clamp to 0 on the negative
    // side and be slid back to the edge by the fit block on the positive
    // side, so in the first jitter-width of a take every grain landed on
    // one of two samples: a dense brush (the wash — 400 ms grains every
    // 15 ms, ±400 ms jitter) became twenty-seven copies of the same few
    // milliseconds, 15 ms apart, which is a comb filter with notches every
    // 66 Hz — the "zipper" at the start of every wash stroke, gone once the
    // take outgrew the jitter. Dropping thins the brush near an edge (half
    // the reads at a take's very start, none away from the edges) and
    // never piles it up. Only a JITTERED read is dropped: an unjittered
    // mark keeps every frontier rule below.
    if (sJitter > 0) {
      const jitterSamples = (sJitter * this._sr) | 0;
      if (jitterSamples > 0) {
        const j = bufOffset + (((this._rand01() * 2 - 1) * jitterSamples) | 0);
        if (j < 0 || (bufLen > 0 && j >= bufLen)) {
          this._gActive[idx] = 0;
          this._freeList[this._freePtr++] = idx;
          this._diagJitterDrop++;
          return;
        }
        bufOffset = j;
      }
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

    // ── Fit the grain to the audio that exists ─────────────────────────
    // A mark points at a moment, and the grain plays what is there from that
    // moment on: at the end of a buffer it gets SHORTER rather than sliding
    // back to keep its length (Ek, 2026-09-02). It used to slide, and on a
    // take shorter than the grain every mark landed on sample 0 — ten marks
    // in a line, one identical sound, and a quick hit that "restarted" on
    // release. The onset clock is untouched here, so density stays what the
    // brush says; only this grain's length yields. Under 64 samples of audio
    // the grain is dropped rather than played as a click.
    const absRate = Math.abs(readRate) || 1;
    const isActiveLive = bufIndex === -2 && this._liveRecording;
    if (isActiveLive) {
      // The buffer is still growing, one sample per sample. A forward grain
      // behind the edge never runs out at rate ≤ 1. At rate > 1 it overtakes
      // the edge after (edge − offset) / (rate − 1) samples and would read
      // zeros from then on, so it ends there. A reverse grain would start
      // beyond the edge and read zeros until the edge passed it, so it starts
      // AT the edge and walks down. A forward grain aimed past the edge (a
      // wall-clock mark can lead the audio clock by a few ms) starts at the
      // edge. Each of these was a hard cut to zero mid-envelope before.
      if (readRate >= 0) {
        if (bufOffset > bufLen) bufOffset = bufLen;
        if (absRate > 1) {
          const untilOvertake = ((bufLen - bufOffset) / (absRate - 1)) | 0;
          if (untilOvertake < 64) {
            this._gActive[idx] = 0;
            this._freeList[this._freePtr++] = idx;
            return;
          }
          if (durSamples > untilOvertake) durSamples = untilOvertake;
        }
      } else {
        const top = Math.min(bufOffset + durSamples * absRate, bufLen);
        const maxDur = ((top - bufOffset) / absRate) | 0;
        if (maxDur < 64) {
          this._gActive[idx] = 0;
          this._freeList[this._freePtr++] = idx;
          return;
        }
        if (durSamples > maxDur) durSamples = maxDur;
      }
    } else if (bufLen > 0) {
      const maxDur = ((bufLen - bufOffset) / absRate) | 0;
      if (maxDur < 64) {
        this._gActive[idx] = 0;
        this._freeList[this._freePtr++] = idx;
        return;
      }
      if (durSamples > maxDur) durSamples = maxDur;
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
    // Skip filtering for audio-rate grains (≤5ms) — too short to perceive.
    // The jitter is in OCTAVES either side of the cutoff (1 = ±1 octave),
    // drawn once per grain, which is what smears a cloud's colour.
    const audioRate = durSamples <= this._sr * 0.005;
    const filterType = audioRate ? 0 : (fType | 0);
    if (filterType) {
      const jFreq = fJitter > 0 ? cutoff * Math.pow(2, (this._rand01() * 2 - 1) * fJitter) : cutoff;
      const c = this._computeSVF(Math.max(10, Math.min(jFreq, this._sr * 0.45)), res);
      this._gSvfA1[idx] = c[0]; this._gSvfA2[idx] = c[1]; this._gSvfA3[idx] = c[2]; this._gSvfK[idx] = c[3];
      this._gSvfIc1[idx] = 0; this._gSvfIc2[idx] = 0;
    }

    // ── Write grain slot ────────────────────────────────────────────────
    this._gReadPos[idx]    = readRate >= 0 ? bufOffset : bufOffset + durSamples * Math.abs(readRate);
    this._gReadRate[idx]   = readRate;
    this._gPhase[idx]      = 0;
    this._gPhaseInc[idx]   = 1 / durSamples;
    this._gVolume[idx]     = vol * radiusFade;
    this._gEnvShape[idx]   = eShape;
    // Resolve the fade here, not at param time: durSamples is only final at
    // this point (durJitter, durVar and the end-of-buffer clamp all move it).
    //   proportional — ramp scales with the grain, so under durJitter every
    //                  grain gets a different attack length.
    //   absolute     — fixed ramp, so attack character stays put while the
    //                  grain length varies.  That is the whole point of it.
    let frEff = fMode === 1 ? (fMs * this._sr) / durSamples : fadeR;
    if (frEff > 0) {                     // explicit 0 stays instant on/off
      const frFloor = (MIN_FADE_S * this._sr) / durSamples;
      if (frEff < frFloor) frEff = frFloor;
    }
    if (frEff > 0.5) frEff = 0.5;        // 0.5 = ramps meet, no sustain
    this._gFade[idx]       = frEff;
    this._gBufIndex[idx]   = bufIndex;
    this._gBufOffset[idx]  = bufOffset;
    this._gBufLen[idx]     = bufLen;
    this._gParticleId[idx] = particleId;
    this._gIsSeed[idx]     = (seed && !seed.isCursor) ? 1 : 0;   // bus select
    this._gVbapIdxA[idx]   = vbapIdxA;
    this._gVbapIdxB[idx]   = vbapIdxB;
    this._gVbapWA[idx]     = vbapWA;
    this._gVbapWB[idx]     = vbapWB;
    this._gElBias[idx]     = elBias;
    this._gFilterType[idx] = filterType;
    this._activate(idx);
    this._activeCount++;

    // ── Feedback ring entry ─────────────────────────────────────────────
    if (particleId >= 0 && this._feedbackLen < this._pool) {
      this._feedbackBuf[this._feedbackLen++] = particleId;
    }
  }

  // ── Main audio processing ─────────────────────────────────────────────
  // Two outputs: outputs[0] = monitor bus (cursor grains),
  //              outputs[1] = house bus (seed grains).
  // When only one output exists (fallback), all grains mix into outputs[0].
  // The audio thread's own load (2026-09-06, R6 of docs/PERFORMANCE-AUDIT-2026-09.md):
  // Date.now() is millisecond-coarse, but summed over the 375 blocks between
  // feedbacks it is a fair load figure, and its max catches a block that
  // stalled inside (an allocation, a big message deserialised). Both ride
  // _diag: loadPct, procMaxMs, chunkAllocs (live chunks allocated in here).
  process(inputs, outputs) {
    const t0 = Date.now();
    const keep = this._render(inputs, outputs);
    const dt = Date.now() - t0;
    this._procMs += dt;
    if (dt > this._procMax) this._procMax = dt;
    this._procBlocks++;
    // The short window the throttle reads (P3). Separate from the feedback's
    // ~375-block average, which is a readout, not a control signal.
    this._procMs32 += dt;
    if (++this._blocks32 >= LOAD_WINDOW_BLOCKS) {
      this._loadShort = this._procMs32 / (LOAD_WINDOW_BLOCKS * this._blockMs);
      this._procMs32 = 0; this._blocks32 = 0;
    }
    return keep;
  }

  _render(inputs, outputs) {
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
          this._liveChunks.push(this._takeChunk(cs));
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

    // ── The throttle reads the LOAD, not the pool (P3, 2026-09-06) ───────
    // It used to skip onsets from 75 % of the POOL — 192 of 256 — which is
    // the wrong variable in both directions: on this machine a wash across
    // eight brushes is ~213 grains and was thinned while the thread sat at a
    // fifth of its budget, and on a slower one 100 expensive grains would not
    // have been thinned at all. Now the signal is the thread's own load over
    // the last 85 ms, so the instrument plays what it was asked to play until
    // the machine is actually near its limit, whatever the grains cost.
    //
    // The pool keeps a backstop over its last 10 %: running it dry means
    // _allocGrain steals a sounding grain, and a steal is a click. Thinning
    // first is the gentler failure, and both are counted (_diagThrottled,
    // _diagSteals) so a thin patch can be told from a clicking one.
    const load = this._loadShort;
    const loadSkip = load <= LOAD_SOFT ? 0 : Math.min(1, (load - LOAD_SOFT) / (LOAD_HARD - LOAD_SOFT));
    const poolFrom = this._pool * POOL_SOFT;
    const poolSkip = this._activeCount <= poolFrom ? 0
      : Math.min(1, (this._activeCount - poolFrom) / (this._pool - poolFrom));
    const skipProb = loadSkip > poolSkip ? loadSkip : poolSkip;
    const underPressure = skipProb > 0;

    // ── Onsets, sample by sample (only the clocks; no rendering here) ──
    for (let s = 0; s < BLOCK; s++) {
      this._curS = s;
      // ── Fire cursor grain at onset ──────────────────────────────────
      // Guard: skip cursor grains until params are set (period starts at 0)
      if (this._periodSamples > 0 && this._sampleClock >= this._nextOnset) {
        if (!underPressure || this._rand01() > skipProb) this._fireGrain();  // null seed = cursor grain
        else this._diagThrottled++;

        // Schedule next onset with period jitter
        let nextPeriod = this._periodSamples;
        if (this._periodVar > 0) {
          const varSamples = Math.round(this._periodVar * this._sr);
          nextPeriod = Math.max(1, nextPeriod + ((this._rand01() * 2 - 1) * varSamples) | 0);
        }
        this._nextOnset = this._sampleClock + nextPeriod;
      }

      // ── Fire cursor-voice grains at their independent onsets ────────
      // Identical to the seed loop below, and deliberately not merged with it:
      // the two arrays are different lengths and are cleared by different
      // messages, and _fireGrain() already treats any voice the same way.
      for (let vi = 0; vi < MAX_CURSOR_VOICES; vi++) {
        const v = this._cursorVoices[vi];
        if (!v.active || v.periodSamples <= 0) continue;
        if (this._sampleClock >= v.nextOnset) {
          if (!underPressure || this._rand01() > skipProb) this._fireGrain(v);
          else this._diagThrottled++;
          let nextPeriod = v.periodSamples;
          if (v.periodVar > 0) {
            const varSamples = Math.round(v.periodVar * this._sr);
            nextPeriod = Math.max(1, nextPeriod + ((this._rand01() * 2 - 1) * varSamples) | 0);
          }
          v.nextOnset = this._sampleClock + nextPeriod;
        }
      }

      // ── Fire seed grains at their independent onsets ────────────────
      for (let si = 0; si < MAX_SEED_VOICES; si++) {
        const seed = this._seeds[si];
        if (!seed.active || seed.periodSamples <= 0) continue;
        if (this._sampleClock >= seed.nextOnset) {
          if (!underPressure || this._rand01() > skipProb) this._fireGrain(seed);
          else this._diagThrottled++;

          // Schedule next seed onset with period jitter
          let nextPeriod = seed.periodSamples;
          if (seed.periodVar > 0) {
            const varSamples = Math.round(seed.periodVar * this._sr);
            nextPeriod = Math.max(1, nextPeriod + ((this._rand01() * 2 - 1) * varSamples) | 0);
          }
          seed.nextOnset = this._sampleClock + nextPeriod;
        }
      }

      this._sampleClock++;
    }

    // ── Render, grain-major (R4, 2026-09-06) ──────────────────────────────
    // Each active grain renders its samples of this block into a scratch —
    // buffer resolved once, state in locals, the filter and envelope inlined
    // per sample — and is mixed into its bus once, with weights computed once.
    // Before this the loop was sample-major: 256 slot checks per sample, the
    // buffer re-resolved and every state value loaded and stored through a
    // typed array per grain per sample, and the VBAP weights re-derived per
    // sample. The active-index list is walked with swap-removal, so a freed
    // slot is replaced in place and the walk does not advance past it. A
    // grain fired inside this block starts at its own sample (`_gStartS`).
    const scratch = this._scratch;
    const eq = this._eqGain;
    const lut = this._vbapLUT;
    for (let ai = 0; ai < this._activeN; ) {
      const i = this._activeIdx[ai];

      // Resolve buffer source once per grain.
      // bufIdx: -1 = SAB (primary recording), -2 = chunked live buffer, 0+ = sampleBufs
      const bufIdx = this._gBufIndex[i];
      let buf = null, bufLen = 0, isLiveChunked = false;
      if (bufIdx === -1) {
        buf = this._recBuf; bufLen = this._recLen;
      } else if (bufIdx === -2) {
        isLiveChunked = true;
        // While recording the live length, so the grain follows the edge;
        // after, the fire-time snapshot.
        bufLen = this._liveRecording ? this._liveBufLen : this._gBufLen[i];
        buf = this._liveChunks.length > 0 ? this._liveChunks : null;
      } else if (bufIdx >= 0 && bufIdx < this._sampleBufs.length) {
        const sb = this._sampleBufs[bufIdx];
        buf = sb.data; bufLen = sb.length;
      }
      if (!buf || bufLen === 0) { this._freeGrain(i); continue; }

      const s0 = this._gStartS[i];
      this._gStartS[i] = 0;
      const n = BLOCK - s0;

      let pos  = this._gReadPos[i];
      const rate = this._gReadRate[i];
      // THE WRAP LIVES HERE NOW, not in the reader (2026-09-14). `_readSample`
      // used to normalise with two float modulos on EVERY sample, which cost
      // more than the whole interpolation; the position moves by at most
      // |rate| a sample (≤ 4, the pitch-shift ceiling), so a compare below
      // keeps it in range and the modulo is paid once per block, only if a
      // grain arrived out of range at all — a reverse grain starts past the
      // end by construction (see the fire path). The chunked live buffer is
      // CLAMPED, never wrapped, so it is left alone: running off the end is
      // how a live grain lands.
      if (!isLiveChunked && (pos < 0 || pos >= bufLen)) pos = ((pos % bufLen) + bufLen) % bufLen;
      let ph   = this._gPhase[i];
      const inc = this._gPhaseInc[i];
      const vol = this._gVolume[i];
      const shape = this._gEnvShape[i];
      const fr  = this._gFade[i];
      // SVF coefficients and integrator states in locals. The band output is
      // normalised (k·v1) so its peak sits at unity whatever the resonance —
      // a cloud of band-passed grains must not get louder as it narrows. The
      // low and high outputs keep their resonant bump: that IS the control.
      const ft = this._gFilterType[i];
      const fa1 = this._gSvfA1[i], fa2 = this._gSvfA2[i], fa3 = this._gSvfA3[i], fk = this._gSvfK[i];
      let ic1 = this._gSvfIc1[i], ic2 = this._gSvfIc2[i];

      let k = 0, done = false, acc = 0;
      for (; k < n; k++) {
        let raw = isLiveChunked ? this._readLiveChunked(bufLen, pos) : this._readSample(buf, bufLen, pos);
        if (ft) {
          const v0 = raw, v3 = v0 - ic2;
          const v1 = fa1 * ic1 + fa2 * v3;
          const v2 = ic2 + fa2 * ic1 + fa3 * v3;
          ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
          raw = ft === 1 ? v2 : ft === 2 ? fk * v1 : v0 - fk * v1 - v2;
        }
        const sample = raw * this._envelope(ph, shape, fr) * vol;
        scratch[k] = sample;
        acc += sample;
        pos += rate;
        if (!isLiveChunked) { if (pos >= bufLen) pos -= bufLen; else if (pos < 0) pos += bufLen; }
        ph  += inc;
        if (ph >= 1.0) { k++; done = true; break; }
      }
      this._gReadPos[i] = pos;
      this._gPhase[i]   = ph;
      this._gSvfIc1[i] = ic1; this._gSvfIc2[i] = ic2;

      // NaN guard, once per block: a NaN anywhere poisons the sum. Kill the
      // grain rather than the channel.
      if (acc !== acc) { this._freeGrain(i); continue; }

      // ── Mix once: cursor grains → monitor (output 0), seed grains → house (output 1)
      const dest = (this._gIsSeed[i] && houseOut) ? houseOut : monOut;
      if (numCh === 1) {
        const d = dest[0];
        for (let q = 0; q < k; q++) d[s0 + q] += scratch[q];
      } else if (lut && numCh > 2) {
        // VBAP multi-channel with elevation center-bias: at the equator the
        // 2-speaker pair, toward the poles energy spreads to every speaker.
        const eb = this._gElBias[i], chA = this._gVbapIdxA[i], chB = this._gVbapIdxB[i];
        const wA = this._gVbapWA[i], wB = this._gVbapWB[i];
        if (eb > 0.01) {
          for (let ch = 0; ch < numCh; ch++) {
            const g = ch === chA ? wA + (eq - wA) * eb : ch === chB ? wB + (eq - wB) * eb : eq * eb;
            const d = dest[ch];
            for (let q = 0; q < k; q++) d[s0 + q] += scratch[q] * g;
          }
        } else {
          if (chA < numCh) { const d = dest[chA]; for (let q = 0; q < k; q++) d[s0 + q] += scratch[q] * wA; }
          if (chB < numCh) { const d = dest[chB]; for (let q = 0; q < k; q++) d[s0 + q] += scratch[q] * wB; }
        }
      } else if (numCh === 2) {
        // Stereo: the VBAP weights as L/R (spread-aware); the pan collapses
        // toward centre at the poles.
        const eb = this._gElBias[i];
        let wA = this._gVbapWA[i], wB = this._gVbapWB[i];
        if (eb > 0.01) { wA += (0.707 - wA) * eb; wB += (0.707 - wB) * eb; }
        const dL = dest[0], dR = dest[1];
        for (let q = 0; q < k; q++) { const v = scratch[q]; dL[s0 + q] += v * wA; dR[s0 + q] += v * wB; }
      } else {
        const d = dest[0];
        for (let q = 0; q < k; q++) d[s0 + q] += scratch[q];
      }

      if (done) { this._freeGrain(i); continue; }   // swap-removed: re-read this position
      ai++;
    }

    // ── Periodic feedback to main thread (~30Hz = every ~1600 samples) ──
    // postMessage happens outside the per-sample loop — one alloc per post
    // (the slice) is acceptable at 30Hz and unavoidable for structured clone.
    this._feedbackTimer += BLOCK;
    if (this._feedbackTimer >= 1600) {
      // A typed copy, not an Array of boxed ids (R5): one allocation, and a
      // structured clone the bridge indexes exactly as it did.
      const grainIds = this._feedbackBuf.slice(0, this._feedbackLen);
      this.port.postMessage({
        type: 'feedback',
        grains: grainIds,
        activeCount: this._activeCount,
        _diag: {
          // The thread's load since the last feedback (R6).
          loadPct: this._procBlocks ? Math.round(100 * this._procMs / (this._procBlocks * BLOCK / this._sr * 1000)) : 0,
          procMaxMs: this._procMax,
          chunkAllocs: this._chunkAllocs,
          spareLow: this._spareLow,
          // The throttle's own signal and what it cost, since the last post.
          loadShort: +this._loadShort.toFixed(3),
          throttled: this._diagThrottled,
          steals: this._diagSteals,
          periodSmp: this._periodSamples,
          durSmp: this._durationSamples,
          vol: this._volume,
          candCount: this._candidateCount,
          // Frozen-brush voices actually sounding, and their onset periods.
          // The worklet cannot console.log, and "does material remember its
          // brush" is not answerable from the main thread — the main thread
          // only knows what it POSTED. This is what says it arrived.
          cvActive: this._cursorVoices.reduce((n, v) => n + (v.active ? 1 : 0), 0),
          cvPeriods: this._cursorVoices.filter(v => v.active).map(v => v.periodSamples),
          // Seed voices sounding — more than the clouds when a cloud reads
          // marks of more than one voicing.
          sdActive: this._seeds.reduce((n, v) => n + (v.active ? 1 : 0), 0),
          freePtr: this._freePtr,
          nextOnset: this._nextOnset,
          clock: this._sampleClock,
          liveRec: this._liveRecording,
          liveBufLen: this._liveBufLen,
          liveChunks: this._liveChunks.length,
          dir: this._direction,
          dirFwd: this._diagDirFwd,
          jitterDropped: this._diagJitterDrop,
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
      this._procMs = 0; this._procMax = 0; this._procBlocks = 0;   // load figures are per feedback
      this._diagDirFwd = 0;
      this._diagJitterDrop = 0;
      this._diagDirRev = 0;
      this._diagSteals = 0;
      this._diagThrottled = 0;
    }

    return true;
  }
}

registerProcessor('grain-engine', GrainEngineProcessor);
