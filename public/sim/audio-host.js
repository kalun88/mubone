// ============================================================================
// AUDIO HOST — a utility process that does nothing but audio (2026-09-06, R2)
//
// audify (RtAudio) lives here: device enumeration, the output and input
// streams, and the regulation of the output queue to the stall cushion. The
// two audio hops are MessagePorts entangled straight between the worklets
// and THIS process — the main process only forwards each port here
// (electron-main.js 'audio-port' → utilityProcess.postMessage). Until this
// file existed the streams ran on the main process, which is also
// Chromium's browser thread: every input event, every IPC message, every
// window update, and the OS's own scheduling of the busiest thread in the
// app. Measured on Ek's laptop at a 10 ms cushion, that loop gapped over
// 20 ms eight times in a set — 157 ms once — and none of it was our
// JavaScript (docs/PERFORMANCE-AUDIT-2026-09.md R2). This loop has one job.
//
// Protocol with the main process (process.parentPort):
//   { id, type, ...args }  → { id, result }     request / response
//   { type: 'audio-port', kind }  with a MessagePortMain in e.ports
//   { type: 'set-audio-cushion', ms }            fire and forget
//   { type: 'shutdown' }                         stop the streams and exit
// ============================================================================
const path = require('path');
const probe = require(path.join(__dirname, 'electron-loop-probe.js'));
const timed = probe.timed;

// ── audify (RtAudio) ──────────────────────────────────────────────────────────
const { RtAudio, RtAudioFormat } = require('audify');

let rtAudio    = null;
let rtAudioIn  = null;   // separate RtAudio instance for input capture
let audioDeviceId = -1;  // -1 = default device

// One RtAudio instance for looking a device up by id when a stream opens.
// Creating throwaway instances while a stream is active can destabilise
// CoreAudio on macOS (SIGBUS in the IO thread). The renderer's device LISTS
// come from the main process's own enumerator — getDevices() holds a loop
// 65 ms, which must not be this one.
let _rtEnum = null;
function getEnumerator() {
  if (!_rtEnum) _rtEnum = new RtAudio();
  return _rtEnum;
}

// ── Audio output stream ───────────────────────────────────────────────────────

const DEFAULT_BUFFER_FRAMES = 1024;  // safe default for 48 kHz on macOS
// The frames each stream was opened with, and what RtAudio reports for its
// own latency — the renderer's latency model (js/latency.js) reads both.
let _outFrames = 0, _inFrames = 0;
// The output queue, bounded (2026-09-04, #333). audify's write() only QUEUES;
// the device callback drains, and written minus played is the depth,
// reported on request. Until 2026-09-06 the queue was bounded by a credit
// window on the renderer's main thread, which every block went through — the
// worklet posted to it, it forwarded over ipcRenderer — so any stall on the
// GUI thread longer than the cushion was a hole in the output: measured, a
// 30 ms stall dropped one block and a 60 ms stall dropped eleven. Now the
// blocks travel on a MessagePort entangled straight between the capture
// worklet and this process, the input stream's chunks take the same kind of
// port the other way, and the depth is regulated here (below).
let _outPort = null;        // MessagePortMain: the capture worklet's end is inside the worklet
let _inPort  = null;        // MessagePortMain: the input-meter worklet's end is inside the worklet
let _outWritten = 0, _outPlayed = 0;
// The queue's depth is a CHOICE, not an accident of start-up (2026-09-06).
// Producer and device run at the same rate, so the depth stays wherever it
// began: with the direct port it began at zero — every block played the
// moment it arrived, and any jitter here would have starved the device — and
// the device's own start-up left a lead of twice the cushion that would have
// sat there for the life of the stream. So this process REGULATES the depth,
// as the input ring regulates its fill: the queue is primed to the cushion
// with silence when it is found empty (once at stream start, and again
// whenever it has run dry — a hole the device already played, counted as
// `_outDry`, the output's true hole count; audify's callback says nothing
// about an empty queue), and when a lead builds past the cushion plus its
// jitter margin the incoming blocks are skipped until the queue is back at
// the cushion — one discontinuity, counted as `_outDropped`, instead of a
// permanent delay. The old renderer-side credit window did this by
// accident and only from above.
let _cushionMs = 10;        // S.audioCushionMs, sent by the renderer (set-audio-cushion); 10 since R1
let _outRate = 48000;       // the output stream's rate, for the prime depth
let _outDry = 0;            // times the queue was found empty after it had played
let _outDropped = 0;        // blocks skipped to bring a lead back to the cushion
let _outTrimming = false;   // skipping until the queue is back at the cushion
let _outTrimQuiet = false;  // … because the cushion was moved, which is not a fault
let _outStartedAt = 0;      // Date.now() at stream start — the first second is settling

function createOutputStream(deviceId, numChannels, bufferFrames, preferredRate) {
  // Immediately block IPC writes — the stream is about to be torn down.
  // The audio-buffer handler checks this and drops all incoming buffers,
  // preventing writes to a half-closed or mismatched stream (which SIGBUS).
  _expectedAudioBytes = 0;

  // Close and destroy the old instance.  Safe now because the write guard
  // above prevents any rtAudio.write() calls while _expectedAudioBytes === 0.
  if (rtAudio) {
    try { if (rtAudio.isStreamRunning()) rtAudio.stop(); } catch (_) {}
    try { if (rtAudio.isStreamOpen()) rtAudio.closeStream(); } catch (_) {}
    rtAudio = null;
  }

  const devices = getEnumerator().getDevices();
  const device  = devices.find(d => d.id === deviceId);

  if (!device) {
    console.warn(`audify: device ${deviceId} not found — stream not opened`);
    return;
  }

  // Use requested channel count, clamped to what the device actually supports
  const nCh = Math.min(numChannels || device.outputChannels, device.outputChannels);
  if (nCh < 1) {
    console.warn(`audify: device "${device.name}" has no output channels`);
    return;
  }

  const frames = bufferFrames || DEFAULT_BUFFER_FRAMES;
  _outFrames = frames;

  // Try sample rates in preference order. Match the AudioContext rate first
  // to avoid resampling between Web Audio and RtAudio (causes crunchiness/delay).
  const preferred = preferredRate || 48000;
  const ratesToTry = [...new Set([preferred, 48000, 44100])];
  let openedRate = null;

  // Fresh instance for each device — channel count and config differ between
  // devices and RtAudio's internal ring buffers are sized at openStream time.
  rtAudio = new RtAudio();

  for (const rate of ratesToTry) {
    try {
      _outWritten = 0; _outPlayed = 0; _outDry = 0; _outDropped = 0; _outTrimming = false;
      rtAudio.openStream(
        { deviceId, nChannels: nCh },
        null,
        RtAudioFormat.RTAUDIO_FLOAT32,
        rate,
        frames,
        'mubone-spatial',
        null,
        // A block has played: count it.
        () => { _outPlayed += frames; }
      );
      openedRate = rate;
      _outRate = rate;
      break; // success — stop trying
    } catch (e) {
      console.warn(`audify: ${rate} Hz failed on "${device.name}" — ${e.message}`);
      try { if (rtAudio.isStreamOpen()) rtAudio.closeStream(); } catch(_) {}
    }
  }

  if (!openedRate) {
    console.error(`audify: could not open stream on "${device.name}" at any sample rate`);
    rtAudio = null;
    return;
  }

  rtAudio.start();
  _outStartedAt = Date.now();
  // Float32 = 4 bytes/sample. audify expects exactly frames × nCh × 4 per write().
  _expectedAudioBytes = frames * nCh * 4;
  _ipcDropCount = 0;
  console.log(`audify stream started — "${device.name}", ${nCh} ch @ ${openedRate} Hz, buffer ${frames} frames (${_expectedAudioBytes} bytes/write)`);
}

// ── Audio input stream (RtAudio) ──────────────────────────────────────────────
// Opens a separate RtAudio input-only stream and posts each chunk of raw
// interleaved Float32 PCM straight to the input-meter worklet over its port
// (_inPort), which feeds the AnalyserNodes for the multichannel meter strip
// and the recording path.

function createInputStream(deviceId, numChannels, bufferFrames, preferredRate) {
  // Close and destroy the old input instance.
  if (rtAudioIn) {
    try { if (rtAudioIn.isStreamRunning()) rtAudioIn.stop(); } catch(_) {}
    try { if (rtAudioIn.isStreamOpen()) rtAudioIn.closeStream(); } catch(_) {}
    rtAudioIn = null;
  }

  const devices = getEnumerator().getDevices();
  const device  = devices.find(d => d.id === deviceId);

  if (!device) {
    console.warn(`audify input: device ${deviceId} not found`);
    return;
  }

  // Warn about potential clock drift when I/O share the same device
  if (rtAudio && audioDeviceId === deviceId) {
    console.warn('[audify] Input and output share the same device — separate RtAudio instances may drift over long sessions. Consider duplex mode for sessions > 30min.');
  }

  const nCh = Math.min(numChannels || device.inputChannels, device.inputChannels);
  if (nCh < 1) {
    console.warn(`audify input: device "${device.name}" has no input channels`);
    return;
  }

  const frames = bufferFrames || DEFAULT_BUFFER_FRAMES;
  _inFrames = frames;

  // Match AudioContext sample rate first to avoid resampling
  const preferred = preferredRate || 48000;
  const ratesToTry = [...new Set([preferred, 48000, 44100])];
  let openedRate = null;

  // Fresh instance — channel count and config differ between devices.
  rtAudioIn = new RtAudio();

  for (const rate of ratesToTry) {
    try {
      rtAudioIn.openStream(
        null,                         // no output
        { deviceId, nChannels: nCh }, // input parameters
        RtAudioFormat.RTAUDIO_FLOAT32,
        rate,
        frames,
        'mubone-input',
        timed('audio:in', (inputData) => {
          // inputData is a Node Buffer of interleaved Float32 samples. A copy,
          // exact-sized: the port serialises the whole underlying ArrayBuffer
          // of a view, and a Buffer may sit in a larger pool slab.
          if (!_inPort) return;
          const f32 = new Float32Array(inputData.buffer, inputData.byteOffset, inputData.length / 4);
          try { _inPort.postMessage(f32.slice()); } catch (_) {}
        }),
        null
      );
      openedRate = rate;
      break;
    } catch (e) {
      console.warn(`audify input: ${rate} Hz failed — ${e.message}`);
      try { if (rtAudioIn.isStreamOpen()) rtAudioIn.closeStream(); } catch(_) {}
    }
  }

  if (!openedRate) {
    console.error(`audify input: could not open stream on "${device.name}"`);
    rtAudioIn = null;
    return;
  }

  rtAudioIn.start();
  console.log(`audify input stream started — "${device.name}", ${nCh} ch @ ${openedRate} Hz`);
  return { nCh, rate: openedRate, name: device.name };
}

// Expected byte count for one audify write call.
// Recomputed whenever the output stream is (re)opened.
let _expectedAudioBytes = 0;

let _ipcDropCount = 0;            // consecutive size mismatches — throttled warning

// The cushion in blocks: never under two (js/audio.js cushionBlocks, the same
// formula — the renderer's latency model counts on it), and its jitter
// margin: 10 ms, or two blocks (cushionSlackBlocks).
function primeBlocks() { return Math.max(2, Math.round(_cushionMs / 1000 * _outRate / (_outFrames || 1))); }
function slackBlocks() { return Math.max(2, Math.ceil(0.010 * _outRate / (_outFrames || 1))); }
function primeOutput(n) {
  if (!rtAudio || !_expectedAudioBytes || n <= 0) return;
  const silence = Buffer.alloc(_expectedAudioBytes);
  for (let i = 0; i < n; i++) {
    try { rtAudio.write(silence); _outWritten += _outFrames; } catch (_) { break; }
  }
}
// The cushion moved: top a shallower queue up to it (silence — one gap, on
// a setting change), or skip a deeper one back down to it exactly — the
// margin is for drift, not for a setting the player just chose.
function applyCushionToQueue() {
  if (!rtAudio || !rtAudio.isStreamRunning() || !_expectedAudioBytes) return;
  const want = primeBlocks();
  const depth = Math.max(0, Math.round((_outWritten - _outPlayed) / (_outFrames || 1)));
  if (depth < want - 1) primeOutput(want - depth);
  else if (depth > want) { _outTrimming = true; _outTrimQuiet = true; }
}

// A block off the port as bytes. The port deserialises in a V8 context of
// its own, so `instanceof ArrayBuffer` is false for a real ArrayBuffer here
// — duck-type on byteLength instead.
function blockToBuffer(data) {
  if (!data || typeof data !== 'object') return null;
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data.byteLength === 'number' && !('buffer' in data)) return Buffer.from(data);
  if (data.buffer && typeof data.byteLength === 'number') return Buffer.from(data.buffer, data.byteOffset || 0, data.byteLength);
  return null;
}

// One block from the capture worklet, on the output port. Push it to RtAudio.
// Guard against size mismatches — these happen transiently when the output
// device is switched (worklet and audify briefly disagree on channel count or
// buffer size). Drop the buffer silently rather than crashing audify.
function onOutputBlock(data) {
  if (!rtAudio || !rtAudio.isStreamRunning()) return;
  // _expectedAudioBytes === 0 means the stream is being torn down / reopened —
  // drop everything until the new stream sets the expected size.
  if (_expectedAudioBytes === 0) return;
  const buf = blockToBuffer(data);
  // A block that is a whole number of device buffers is written as that many
  // (R7, 2026-09-06): the capture worklet posts 128-frame quanta, so at
  // 64-frame device buffers each post is two writes. Anything else is a
  // shape this host does not understand, and is dropped and counted.
  if (buf && buf.length > _expectedAudioBytes && buf.length % _expectedAudioBytes === 0) {
    for (let off = 0; off < buf.length; off += _expectedAudioBytes) _writeOne(buf.subarray(off, off + _expectedAudioBytes));
    return;
  }
  if (!buf || buf.length !== _expectedAudioBytes) {
    // Throttled mismatch warning (max 1 per second)
    _ipcDropCount++;
    if (_ipcDropCount === 1 || _ipcDropCount % 100 === 0) {
      const shape = buf ? `${buf.length} bytes` : `${Object.prototype.toString.call(data)} keys=${Object.keys(data || {}).slice(0, 6).join(',')}`;
      console.warn(`[audio-port] size mismatch: got ${shape}, expected ${_expectedAudioBytes} — dropped ${_ipcDropCount} buffers`);
    }
    return;
  }
  _ipcDropCount = 0;
  _writeOne(buf);
}

/** One device buffer into the regulated queue. */
function _writeOne(buf) {
  const depth = (_outWritten - _outPlayed) / (_outFrames || 1);
  const want = primeBlocks();
  if (depth <= 0) {
    // An empty queue: at the start of the stream, or the device has already
    // played a hole. Either way, lay the cushion down first — this block then
    // plays a cushion late, and everything after it too.
    if (Date.now() - _outStartedAt > 1000) _outDry++;
    _outTrimming = false; _outTrimQuiet = false;
    primeOutput(want - 1);
  } else if (_outTrimming || depth > want + slackBlocks()) {
    // A lead past the cushion and its margin (the device's start-up, or the
    // engine's clock running ahead of the interface's): skip incoming blocks
    // until the queue is back at the cushion.
    if (depth > want) {
      _outTrimming = true;
      // The device's own start-up lead is skipped in the first second, and a
      // cushion the player just shortened is skipped to on purpose: settling
      // and a choice, not faults.
      if (!_outTrimQuiet && Date.now() - _outStartedAt > 1000) _outDropped++;
      return;
    }
    _outTrimming = false; _outTrimQuiet = false;
  }
  try {
    rtAudio.write(buf);
    _outWritten += _outFrames;
  } catch (e) {
    console.error(`[audio-port] write error: ${e.message}`);
  }
}


// ── The ports ────────────────────────────────────────────────────────────────
// A new port of a kind replaces the old one — every rebuild of the capture
// or input-meter node asks the preload for a fresh pair, and main forwards
// one end here.
function attachPort(kind, port) {
  if (!port) return;
  if (kind === 'out') {
    if (_outPort) { try { _outPort.close(); } catch (_) {} }
    _outPort = port;
    port.on('message', timed('audio:out', (e) => onOutputBlock(e.data)));
    port.on('close', () => { if (_outPort === port) _outPort = null; });
    port.start();
  } else if (kind === 'in') {
    if (_inPort) { try { _inPort.close(); } catch (_) {} }
    _inPort = port;
    port.on('close', () => { if (_inPort === port) _inPort = null; });
    port.start();
  } else {
    try { port.close(); } catch (_) {}
  }
}

// ── Requests from the main process ───────────────────────────────────────────
function handle(m) {
  switch (m.type) {
    case 'get-stream-latency': {
      const lat = (st) => { try { return st && st.isStreamOpen() ? st.getStreamLatency() : null; } catch (_) { return null; } };
      return {
      outStreamFrames: lat(rtAudio),   outBufferFrames: rtAudio   ? _outFrames : null,
      inStreamFrames:  lat(rtAudioIn), inBufferFrames:  rtAudioIn ? _inFrames  : null,
      rate: (() => { try { return rtAudio?.getStreamSampleRate?.() ?? null; } catch (_) { return null; } })(),
      };
    }
    case 'set-input-device': {
      const result = createInputStream(m.deviceId, m.numChannels, m.bufferFrames, m.sampleRate);
      if (result) return { ok: true, nCh: result.nCh, sampleRate: result.rate, name: result.name };
      return { ok: false, error: 'could not open input stream' };
    }
    case 'set-audio-device': {
      audioDeviceId = m.deviceId;
      createOutputStream(m.deviceId, m.numChannels, m.bufferFrames, m.sampleRate);
      const streaming  = !!(rtAudio && rtAudio.isStreamRunning());
      const actualRate = streaming ? (rtAudio.getStreamSampleRate?.() ?? null) : null;
      return { ok: true, streaming, sampleRate: actualRate };
    }
    case 'get-output-depth':
      // The queue, its faults, and this loop's own gaps and holders.
      return { frames: Math.max(0, _outWritten - _outPlayed), blockFrames: _outFrames, dry: _outDry, dropped: _outDropped,
               primeFrames: primeBlocks() * _outFrames, written: _outWritten, played: _outPlayed, ...probe.stats(m.gaps) };
    case 'set-audio-cushion':
      if (m.ms > 0) { _cushionMs = m.ms; applyCushionToQueue(); }
      return { ok: true };
    case 'shutdown':
      shutdown();
      return { ok: true };
    default:
      return { error: `audio host: unknown request ${m.type}` };
  }
}

function shutdown() {
  // Block further writes immediately, then stop and destroy the streams —
  // the input stream's native callback uses a ThreadSafeFunction that must
  // be released before the environment tears down.
  _expectedAudioBytes = 0;
  if (rtAudio) {
    try { if (rtAudio.isStreamRunning()) rtAudio.stop(); } catch (_) {}
    try { if (rtAudio.isStreamOpen()) rtAudio.closeStream(); } catch (_) {}
    rtAudio = null;
  }
  if (rtAudioIn) {
    try { if (rtAudioIn.isStreamRunning()) rtAudioIn.stop(); } catch (_) {}
    try { if (rtAudioIn.isStreamOpen()) rtAudioIn.closeStream(); } catch (_) {}
    rtAudioIn = null;
  }
  if (_rtEnum) {
    try { if (_rtEnum.isStreamOpen()) _rtEnum.closeStream(); } catch (_) {}
    _rtEnum = null;
  }
  setTimeout(() => process.exit(0), 50);
}

process.parentPort.on('message', (e) => {
  const m = e.data || {};
  if (m.type === 'audio-port') { attachPort(m.kind, e.ports && e.ports[0]); return; }
  let result;
  // Timed by the message's TYPE, so the holder table names the call: a 55 ms
  // `parent:set-audio-device` is a stream open at boot, not a mystery
  // (2026-09-06 — `parent:message` was the only host holder Ek's readout and
  // the probe ever showed, twice per session, and it was the two stream opens).
  timed('parent:' + (m.type || 'message'), () => {
    try { result = handle(m); } catch (err) { result = { error: String(err && err.message || err) }; }
  })();
  if (m.id != null) process.parentPort.postMessage({ id: m.id, result });
});

console.log('[audio-host] up');
