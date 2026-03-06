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
    // 22050 Hz — half the default 44100/48000, halves CPU load across the entire
    // audio graph. More than enough bandwidth for trombone + voice.
    S.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 22050 });

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
    softClipper.oversample = '2x'; // at 22050 Hz, 2x gives 44100 Hz internal — enough to avoid aliasing

    // Analyser tap — post-clipper, pre-mute, so meter stays active even when muted
    S.masterAnalyser = S.audioCtx.createAnalyser();
    S.masterAnalyser.fftSize = 256;
    S.masterAnalyser.smoothingTimeConstant = 0.75;

    // Mute gain — final stage, zeroed by mute button; output meter reads upstream of this
    const muteGain = S.audioCtx.createGain();
    muteGain.gain.value = 1;

    // Chain: masterGain -> softClipper -> analyser -> muteGain -> destination
    masterGain.connect(softClipper);
    softClipper.connect(S.masterAnalyser);
    S.masterAnalyser.connect(muteGain);
    muteGain.connect(S.audioCtx.destination);
    S.masterBus = masterGain;
    window._muteGain = muteGain; // expose for setMuted
  }
  if (S.audioCtx.state === 'suspended') S.audioCtx.resume();
  return S.audioCtx;
}

export function getMasterBus() { ensureAudioContext(); return S.masterBus; }

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
    S.recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate:   22050,  // match AudioContext — avoids browser resampling the mic stream
        channelCount: 1,      // mono — no point capturing stereo for a trombone
        echoCancellation:    false, // off — we want the raw signal, not phone-call processing
        noiseSuppression:    false,
        autoGainControl:     false,
      }
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
