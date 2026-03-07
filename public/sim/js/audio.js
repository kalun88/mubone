// ============================================================================
// AUDIO SYSTEM  (extracted from index.html)
// ============================================================================

import { S } from './state.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

export function makeSoftClipCurve(amount = 10) {
  // Tanh soft clipper: y = tanh(amount * x) / tanh(amount)
  // Higher amount = harder knee. amount=10 is near brick-wall — heavily saturates anything
  // above ~+-0.3 input, smoothly, with no aliasing (oversample='4x' downstream).
  const N    = 4096; // more curve points = smoother nonlinearity at 4x oversample
  const curve = new Float32Array(N);
  const norm  = Math.tanh(amount);
  for (let i = 0; i < N; i++) {
    const x    = (i * 2) / (N - 1) - 1; // -1 to +1
    curve[i]   = Math.tanh(amount * x) / norm;
  }
  return curve;
}

// ── Audio context & master bus ──────────────────────────────────────────────

export function ensureAudioContext() {
  if (!S.audioCtx) {
    // Use caller-supplied preferred rate (set by audio settings UI) or default to 44100.
    const sampleRate = S.preferredSampleRate ?? 44100;
    S.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });

    // On mobile, Web Audio defaults to the earpiece (call speaker, tiny & quiet).
    // Playing a silent looping <audio> element forces Chrome/Android to switch
    // the audio session to media/loudspeaker mode for the whole AudioContext.
    if (S.isMobile) {
      // Minimal valid WAV: 44-byte header + 0 samples of data
      const silentAudio = document.createElement('audio');
      silentAudio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
      silentAudio.loop   = true;
      silentAudio.volume = 0.001; // effectively inaudible but keeps the session alive
      silentAudio.play().catch(() => {});
      window._mobileSpeakerAudio = silentAudio;
    }

    // Master gain — on mobile push harder to compensate for loudspeaker distance
    // and the intentionally soft preset volumes (0.012-0.18). Desktop stays at 0.9.
    const masterGain = S.audioCtx.createGain();
    masterGain.gain.value = S.isMobile ? 3.0 : 0.9;

    // Soft clipper (WaveShaper with tanh curve) — sample-accurate, no attack time,
    // frequency-transparent. Replaces DynamicsCompressor which was too slow for
    // transient whistle peaks and introduced frequency-dependent distortion.
    const softClipper = S.audioCtx.createWaveShaper();
    softClipper.curve     = makeSoftClipCurve(4);
    softClipper.oversample = '2x'; // 2x internal oversampling — enough to avoid aliasing at both 22050 and 44100

    // Analyser tap — post-clipper, pre-mute, so meter stays active even when muted
    S.masterAnalyser = S.audioCtx.createAnalyser();
    S.masterAnalyser.fftSize = 256;
    S.masterAnalyser.smoothingTimeConstant = 0.75;

    // Mute gain — final stage, zeroed by mute button; output meter reads upstream of this
    const muteGain = S.audioCtx.createGain();
    muteGain.gain.value = 1;

    // Chain: masterGain -> softClipper -> analyser -> muteGain -> destination
    // In Electron, RtAudio owns hardware output — don't connect to Web Audio
    // destination (it always goes to OS default / MacBook speakers regardless
    // of the selected interface). The speaker buses tap masterBus directly.
    masterGain.connect(softClipper);
    softClipper.connect(S.masterAnalyser);
    S.masterAnalyser.connect(muteGain);
    if (!window.electronBridge) {
      muteGain.connect(S.audioCtx.destination);

      // Stereo L/R analyser tap — feeds the two-bar output meter on the main canvas.
      // ChannelSplitter deinterleaves the stereo signal coming out of muteGain
      // (grains connect through StereoPanner → masterBus, so the signal IS stereo).
      // drawOutputMeter() uses S.speakerAnalysers when length > 1.
      const splitter  = S.audioCtx.createChannelSplitter(2);
      const analyserL = S.audioCtx.createAnalyser();
      const analyserR = S.audioCtx.createAnalyser();
      analyserL.fftSize = 256; analyserL.smoothingTimeConstant = 0.75;
      analyserR.fftSize = 256; analyserR.smoothingTimeConstant = 0.75;
      muteGain.connect(splitter);
      splitter.connect(analyserL, 0);  // channel 0 = Left
      splitter.connect(analyserR, 1);  // channel 1 = Right
      S.speakerAnalysers = [analyserL, analyserR];
    }
    S.masterBus = masterGain;
    window._muteGain = muteGain; // expose for setMuted
  }
  if (S.audioCtx.state === 'suspended') S.audioCtx.resume();
  return S.audioCtx;
}

export function getMasterBus() { ensureAudioContext(); return S.masterBus; }

// Tear down the AudioContext and all dependent state so ensureAudioContext()
// will recreate it at the new S.preferredSampleRate on next call.
// Any active recording is lost — caller should warn the user first.
export async function recreateAudioContext(newSampleRate) {
  S.preferredSampleRate = newSampleRate;

  // Stop any active recording
  if (S.isRecording) {
    const { stopLiveRecording } = await import('./audio.js');
    stopLiveRecording?.();
  }

  // Disconnect and stop the mic stream
  try { window._micMonitorSrc?.disconnect(); } catch(_) {}
  try { S.inputGainNode?.disconnect(); }       catch(_) {}
  if (S.recordingStream) {
    S.recordingStream.getTracks().forEach(t => t.stop());
    S.recordingStream = null;
  }

  // Tear down speaker buses (Electron)
  if (S.speakerBuses) {
    S.speakerBuses.forEach(b => { try { b.bus.disconnect(); } catch(_) {} });
    S.speakerBuses = null;
  }

  // Close the old context
  if (S.audioCtx) {
    try { await S.audioCtx.close(); } catch(_) {}
    S.audioCtx = null;
  }

  // Reset dependent state
  S.masterBus       = null;
  S.masterAnalyser  = null;
  S.speakerAnalysers = null;  // recreated by ensureAudioContext (browser) or initSpeakerBuses (Electron)
  S.inputGainNode   = null;
  S.inputAnalyser  = null;
  S.micPermissionGranted = false;
  S.inputStream    = null;
  window._micMonitorSrc = null;

  // Recreate immediately so the rest of the app can use it
  ensureAudioContext();
  console.log(`AudioContext recreated at ${newSampleRate} Hz`);
}

// ── Mic access ──────────────────────────────────────────────────────────────

export function warmUpAudioEngine() {
  // Fire a zero-length silent buffer through the full grain chain so V8 JIT-compiles
  // playGrain, the WaveShaper, and all AudioNode constructors before the first real recording.
  // This eliminates the CPU spike that causes clipping on the very first spacebar press.
  const actx = ensureAudioContext();
  const silentBuf = actx.createBuffer(1, 1, actx.sampleRate);
  const src  = actx.createBufferSource();
  const gain = actx.createGain();
  const pan  = actx.createStereoPanner();
  src.buffer       = silentBuf;
  gain.gain.value  = 0;
  src.connect(gain); gain.connect(pan); pan.connect(getMasterBus());
  src.start();
  src.addEventListener('ended', () => {
    try { src.disconnect(); gain.disconnect(); pan.disconnect(); } catch(_) {}
  });
}

let _micAccessPromise = null;  // guard against concurrent getUserMedia calls

export async function requestMicAccess() {
  // If settings modal already opened a stream, reuse it — don't fight over the device.
  if (S.micPermissionGranted && S.recordingStream) return true;
  if (_micAccessPromise) return _micAccessPromise;   // already asking — wait for it
  _micAccessPromise = (async () => {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new DOMException(
        'MediaDevices API unavailable. Open the app over HTTPS or via http://localhost (not 127.0.0.1 or a file:// URL).',
        'NotSupportedError'
      );
    }

    // Build audio constraints — if the user pre-selected a device in settings,
    // honour it. Otherwise open the system default in mono.
    const audioConstraints = {
      sampleRate:          { ideal: S.audioCtx?.sampleRate ?? 44100 },
      channelCount:        { ideal: S.selectedInputChannels || 1 },
      echoCancellation:    false,
      noiseSuppression:    false,
      autoGainControl:     false,
    };
    if (S.selectedInputDeviceId) {
      audioConstraints.deviceId = { exact: S.selectedInputDeviceId };
    }

    S.recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
    });
    S.micPermissionGranted = true;
    S.inputStream = S.recordingStream;  // expose for ui-audio-settings (no re-prompt)

    // Build the persistent mic -> inputGain -> inputAnalyser chain.
    // This stays alive as long as the mic stream is open so the input
    // meter and gain knob work even when not recording.
    const actx = ensureAudioContext();
    const monitorSrc = actx.createMediaStreamSource(S.recordingStream);

    S.inputGainNode = actx.createGain();
    S.inputGainNode.gain.value = S.inputGainValue;

    S.inputAnalyser = actx.createAnalyser();
    S.inputAnalyser.fftSize = 256;
    S.inputAnalyser.smoothingTimeConstant = 0.6;

    // Connect monitor chain (no destination — AnalyserNode is a dead-end tap)
    monitorSrc.connect(S.inputGainNode);
    S.inputGainNode.connect(S.inputAnalyser);
    // inputAnalyser is a dead-end for monitoring (no further connect needed)

    // Store monitorSrc so we can disconnect on hypothetical future cleanup
    window._micMonitorSrc = monitorSrc;

    // Warm up immediately after mic grant — before the first recording starts
    if (!S.audioEngineWarmedUp) {
      S.audioEngineWarmedUp = true;
      warmUpAudioEngine();
    }

    // Reflect ready state on the button (however mic was granted)
    const micBtn = document.getElementById('micEnableBtn');
    if (micBtn) {
      setMicBtnLabel('mic ready');
      micBtn.classList.remove('mic-denied');
      micBtn.classList.add('mic-ready');
      micBtn.disabled = false;
    }

    return true;
  } catch (e) {
    const insecure = e instanceof DOMException && e.name === 'NotSupportedError';
    const label    = insecure ? 'needs https' : 'mic denied';
    const tip      = insecure
      ? e.message
      : (e?.message ?? String(e));
    console.warn('Mic access failed:', tip);
    const micBtn = document.getElementById('micEnableBtn');
    if (micBtn) {
      setMicBtnLabel(label);
      micBtn.classList.add('mic-denied');
      micBtn.title   = tip;
      micBtn.disabled = false;
    }
    return false;
  } finally {
    _micAccessPromise = null;
  }
  })();
  return _micAccessPromise;
}

// ── Live recording ──────────────────────────────────────────────────────────

export function startLiveRecording() {
  if (S.isRecording) return;
  if (!S.recordingStream) return;

  const actx = ensureAudioContext();
  S.recordingSampleRate   = actx.sampleRate;
  S.recordingRaw          = new Float32Array(S.recordingSampleRate * 300); // 5 min headroom
  S.recordingWritePos     = 0;
  S.liveBufferSampleCount = 0;

  // inputGainNode and inputAnalyser are created once in requestMicAccess and persist.
  // We don't need a separate MediaStreamSource for recording — tap the already-connected
  // inputAnalyser output and route it through the ScriptProcessor for capture.

  // 8192-sample buffer (~372ms at 22050 Hz) — very safe headroom at the lower sample rate.
  // Recording latency is irrelevant since we don't do live monitoring through the chain.
  S.recordingNode = actx.createScriptProcessor(2048, 1, 1);

  S.recordingStartTime = performance.now();

  S.recordingNode.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    if (S.recordingWritePos + input.length > S.recordingRaw.length) {
      const grown = new Float32Array(S.recordingRaw.length * 2);
      grown.set(S.recordingRaw);
      S.recordingRaw = grown;
    }
    S.recordingRaw.set(input, S.recordingWritePos);
    S.recordingWritePos += input.length;
  };

  // Chain: (persistent) inputGain -> inputAnalyser -> scriptProcessor -> destination(dummy)
  // inputAnalyser already has inputGainNode feeding it; just attach the recorder.
  S.inputAnalyser.connect(S.recordingNode);
  S.recordingNode.connect(actx.destination); // ScriptProcessor must connect to keep running


  S.isRecording = true;

  // Reserve a slot in liveRecBuffers — placeholder with null buffer
  S.currentLiveBufferIdx = S.liveRecBuffers.length;
  S.liveRecBuffers.push({ buffer: null, grainCursor: 0 });

  S.updateLiveRecUI?.();
}

export function stopLiveRecording() {
  if (!S.isRecording) return;
  S.isRecording = false;

  // Only tear down the recording-specific nodes.
  // inputGainNode and inputAnalyser are persistent (created in requestMicAccess)
  // so the meter and knob stay active between recordings.
  if (S.recordingNode) {
    S.recordingNode.onaudioprocess = null;
    try { S.inputAnalyser && S.inputAnalyser.disconnect(S.recordingNode); } catch(_) {}
    S.recordingNode.disconnect();
    S.recordingNode = null;
  }
  if (S.recordingSourceNode) { S.recordingSourceNode.disconnect(); S.recordingSourceNode = null; }

  const actx = ensureAudioContext();
  const totalLength = S.recordingWritePos;

  // Minimum kept length: 80 ms. Shorter than this is an accidental graze.
  // (The 200 ms touchend delay means intentional taps always exceed this.)
  const MIN_REC_SAMPLES = Math.floor(S.recordingSampleRate * 0.08);

  if (totalLength < MIN_REC_SAMPLES) {
    // Too short — remove the placeholder slot
    if (S.currentLiveBufferIdx >= 0 && S.currentLiveBufferIdx < S.liveRecBuffers.length) {
      S.liveRecBuffers.splice(S.currentLiveBufferIdx, 1);
      // Fix particle references
      S.particles.forEach(p => {
        if (p.liveBufferIdx === S.currentLiveBufferIdx) p.liveBufferIdx = -1;
        else if (p.liveBufferIdx > S.currentLiveBufferIdx) p.liveBufferIdx--;
      });
    }
    S.currentLiveBufferIdx = -1;
    S.recordingRaw = null;
    S.updateLiveRecUI?.();
    return;
  }

  // Build final AudioBuffer
  const audioBuffer = actx.createBuffer(1, totalLength, S.recordingSampleRate);
  const channelData = S.recordingRaw.subarray(0, totalLength);

  // Fade edges to eliminate transient clicks
  const fadeSamples = Math.min(Math.floor(S.recordingSampleRate * 0.05), Math.floor(totalLength / 4));
  for (let i = 0; i < fadeSamples; i++) {
    const env = (i / fadeSamples) ** 2;
    channelData[i]                    *= env;
    channelData[totalLength - 1 - i]  *= env;
  }

  audioBuffer.getChannelData(0).set(channelData);

  // Seal the live buffer slot
  const slot = S.liveRecBuffers[S.currentLiveBufferIdx];
  if (slot) {
    slot.buffer      = audioBuffer;
    slot.grainCursor = 0;
  }

  // Clamp any particles that were painted beyond the final duration
  S.particles.forEach(p => {
    if (p.liveBufferIdx === S.currentLiveBufferIdx) {
      const dur = audioBuffer.duration;
      if (p.grainStart > dur) p.grainStart = Math.max(0, dur - 0.01);
      if (p.grainStart + p.grainDuration > dur) p.grainDuration = dur - p.grainStart;
    }
  });

  console.log(`Live rec buffer ${S.currentLiveBufferIdx}: ${audioBuffer.duration.toFixed(2)}s`);
  S.recordingRaw         = null;
  S.recordingWritePos    = 0;
  S.liveBufferSampleCount = 0;
  S.currentLiveBufferIdx = -1;
  S.updateLiveRecUI?.();
}

// ── Multi-channel speaker bus setup (Electron only) ──────────────────────────
// Creates N persistent GainNode buses, one per output channel, evenly spaced
// around a circle (speaker 0 = front, going clockwise).
// Wires them through a ChannelMerger into the capture worklet → IPC → audify.
// Safe to call in the browser — bails out immediately if electronBridge is absent.
// Call initSpeakerBuses(n) once a device is selected; calling again tears down
// the old graph and rebuilds for the new channel count.

let _captureNode    = null;  // keep ref so we can disconnect on rebuild
let _meterTap       = null;
let _merger         = null;  // module-level ref so rewireChannelMerger can access it
let _headphoneNode  = null;  // stereo headphone downmix gain node (Electron)

export async function initSpeakerBuses(numChannels = 2) {
  if (!window.electronBridge?.isElectron) return;

  const actx = ensureAudioContext();

  // Register worklet once (addModule is idempotent after first call)
  await actx.audioWorklet.addModule('js/worklets/quad-capture.worklet.js');

  // Tear down any previous graph
  if (_captureNode) {
    try { _captureNode.port.onmessage = null; _captureNode.disconnect(); } catch(_) {}
    _captureNode = null;
  }
  if (_meterTap) {
    try { _meterTap.disconnect(); } catch(_) {}
    _meterTap = null;
  }
  if (_headphoneNode) {
    try { _headphoneNode.disconnect(); } catch(_) {}
    _headphoneNode = null;
  }
  if (_merger) {
    try { _merger.disconnect(); } catch(_) {}
    _merger = null;
  }
  if (S.speakerAnalysers) {
    S.speakerAnalysers.forEach(an => { try { an.disconnect(); } catch(_) {} });
    S.speakerAnalysers = null;
  }
  if (S.speakerBuses) {
    S.speakerBuses.forEach(b => { try { b.bus.disconnect(); } catch(_) {} });
    S.speakerBuses = null;
  }

  const n = Math.max(1, numChannels);

  // One GainNode bus per speaker.
  // For stereo (n=2) use the standard L/R arrangement: 270° (left) and 90° (right).
  // For n=1 (mono) use 0° (front). For n≥3 space equally clockwise from front (0°).
  // This ensures stereo headphone/laptop output pans correctly (front-center = equal L+R).
  function speakerAngleDeg(i, total) {
    if (total === 1) return 0;
    if (total === 2) return i === 0 ? 270 : 90;   // 270 = left, 90 = right
    return (360 / total) * i;                      // equal spacing from front
  }
  const buses = Array.from({ length: n }, (_, i) => {
    const angleDeg = speakerAngleDeg(i, n);
    const angleRad = (angleDeg * Math.PI) / 180;
    const bus = actx.createGain();
    return { bus, angleDeg, angleRad };
  });

  // Per-bus AnalyserNodes for the output meter strip in audio settings
  S.speakerAnalysers = buses.map(({ bus }) => {
    const an = actx.createAnalyser();
    an.fftSize = 256;
    an.smoothingTimeConstant = 0.8;
    bus.connect(an);   // tap from bus; an is a dead-end (no further connect needed)
    return an;
  });

  // Merge N mono buses into a single N-channel stream.
  // Apply S.channelRouting if set (Physical→Spatial mapping); default = identity.
  _merger = actx.createChannelMerger(n);
  const routing = S.channelRouting ?? buses.map((_, i) => i);
  buses.forEach(({ bus }, i) => {
    const destCh = routing[i] ?? i;
    if (destCh >= 0 && destCh < n) bus.connect(_merger, 0, destCh);
  });

  // Capture worklet — generalised to N channels via a message on init
  _captureNode = new AudioWorkletNode(actx, 'quad-capture', {
    numberOfInputs:   1,
    numberOfOutputs:  0,
    channelCount:     n,
    channelCountMode: 'explicit',
  });

  // Tell the worklet how many channels and what batch size to use.
  // batchSize must equal bufferFrames / 128 so each posted buffer is exactly
  // one audify write-call's worth of frames (audify rejects mismatched sizes).
  const bufferFrames = S.preferredBufferSize ?? 512;
  const batchSize    = Math.max(1, Math.round(bufferFrames / 128));
  _captureNode.port.postMessage({ type: 'init', numChannels: n, batchSize });

  _merger.connect(_captureNode);

  // Route captured buffers to Electron main process → audify → hardware
  _captureNode.port.onmessage = ({ data }) => {
    window.electronBridge.sendAudioBuffer(data.interleaved);
  };

  // ── Stereo headphone mix ──────────────────────────────────────────────────
  // Always-on downmix → AudioContext destination (system output = headphones/laptop).
  // Finds the bus closest to left (270°) and closest to right (90°) by angle distance
  // so the downmix is correct regardless of channel count or layout.
  // For n=1 (mono) both sides use the single bus.
  function closestBusIdx(targetDeg) {
    let best = 0, bestDist = Infinity;
    buses.forEach(({ angleDeg }, i) => {
      const d = Math.abs(((angleDeg - targetDeg + 540) % 360) - 180); // circular distance
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }
  const hpL = closestBusIdx(270); // left
  const hpR = closestBusIdx(90);  // right

  const hpMerger = actx.createChannelMerger(2);
  buses[hpL].bus.connect(hpMerger, 0, 0);
  buses[hpR].bus.connect(hpMerger, 0, 1);
  _headphoneNode = actx.createGain();
  _headphoneNode.gain.value = 0.7;
  hpMerger.connect(_headphoneNode);
  // In Electron, RtAudio (audify) owns all hardware output. The Web Audio
  // destination always routes to the OS default device (MacBook speakers),
  // completely ignoring the selected interface. Don't connect to destination
  // at all in Electron — the node exists only as a dead-end tap for the
  // output gain slider value. In browser it's the only output path so connect normally.
  if (!window.electronBridge) {
    _headphoneNode.connect(actx.destination);
  }
  window._headphoneOutNode = _headphoneNode;  // expose for output gain slider

  // Meter tap: down-mix L+R buses into S.masterAnalyser so meters work.
  const meterMerger = actx.createChannelMerger(2);
  buses[hpL].bus.connect(meterMerger, 0, 0);
  buses[hpR].bus.connect(meterMerger, 0, 1);
  _meterTap = actx.createGain();
  _meterTap.gain.value = 1;
  meterMerger.connect(_meterTap);
  _meterTap.connect(S.masterAnalyser);

  // Expose on S so grain.js can route to them
  S.speakerBuses  = buses;   // [{ bus, angleDeg, angleRad }, ...]
  S.speakerBuses.numChannels = n;

  // Legacy alias — keeps any remaining S.quadBuses references from crashing
  S.quadBuses = null;

  // Notify the main window that channel count changed so it can rebuild the meter strip.
  // Uses a callback on S to avoid a circular import with renderer.js.
  S._onSpeakerBusesReady?.(n);

  console.log(`Speaker buses ready — ${n} ch, angles: ${buses.map(b => b.angleDeg.toFixed(0) + '°').join(', ')} → audify + headphone mix`);
}

// ── Routing rewire ────────────────────────────────────────────────────────────
// Reconnects speaker buses to the ChannelMerger using S.channelRouting without
// rebuilding the whole graph. Call this when the user changes a routing dropdown.
export function rewireChannelMerger() {
  if (!S.speakerBuses || !_merger) return;
  const n = S.speakerBuses.length;
  // Disconnect all buses from merger first
  S.speakerBuses.forEach(({ bus }) => {
    try { bus.disconnect(_merger); } catch(_) {}
  });
  // Reconnect using current routing map
  const routing = S.channelRouting ?? S.speakerBuses.map((_, i) => i);
  S.speakerBuses.forEach(({ bus }, i) => {
    const destCh = routing[i] ?? i;
    if (destCh >= 0 && destCh < n) bus.connect(_merger, 0, destCh);
  });
  console.log('Channel routing updated:', routing);
}

// Convenience: called from main.js on startup (stereo placeholder until device is chosen)
export async function initQuadBuses() {
  return initSpeakerBuses(2);
}

export function getRecordingDuration() {
  if (!S.isRecording) return 0;
  return (performance.now() - S.recordingStartTime) / 1000;
}

export function rebuildLiveBuffer() {
  // Build a running AudioBuffer from raw PCM so grains can play during recording.
  // Throttled: createBuffer + set() on a growing array is expensive — don't do it every frame.
  if (!S.isRecording || S.recordingWritePos === 0) return;
  if (S.recordingWritePos === S.liveBufferSampleCount) return;

  const now = performance.now();
  if (now - S.lastLiveRebuildTime < S.LIVE_REBUILD_INTERVAL_MS) return;
  S.lastLiveRebuildTime = now;

  const actx = ensureAudioContext();
  const len = S.recordingWritePos;
  const liveBuffer = actx.createBuffer(1, len, S.recordingSampleRate);
  liveBuffer.getChannelData(0).set(S.recordingRaw.subarray(0, len));
  S.liveBufferSampleCount = len;

  if (S.currentLiveBufferIdx >= 0 && S.currentLiveBufferIdx < S.liveRecBuffers.length) {
    S.liveRecBuffers[S.currentLiveBufferIdx].liveBuffer = liveBuffer;
    S.liveRecBuffers[S.currentLiveBufferIdx].duration   = liveBuffer.duration;
  }
}

// ── Mic button label ────────────────────────────────────────────────────────

export function setMicBtnLabel(text) {
  // Updates only the label span, preserving SVG icon and dot
  const btn = document.getElementById('micEnableBtn');
  if (!btn) return;
  const span = btn.querySelector('span:last-child');
  if (span) span.textContent = text;
}
