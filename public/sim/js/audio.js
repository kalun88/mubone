// ============================================================================
// AUDIO SYSTEM  (extracted from index.html)
// ============================================================================

import { S, DEBUG, SPHERE_RADIUS, perf } from './state.js';
import { buildVBAPLookup, queryVBAPLookup } from './grain.js';
import { getCursorLonLat, screenToLonLat, spherePointInto, cameraTransformInto } from './sphere.js';

// Track whether the recording-capture worklet module has been registered.
// Reset to false on AudioContext recreation (new context needs fresh addModule).
let _recWorkletReady = false;

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
    // Use caller-supplied preferred rate (set by audio settings UI), then
    // persisted rate from previous session, then 48000 (Chrome default,
    // matches most USB interfaces).  Explicit 48000 avoids ambiguity when
    // neither preference nor saved rate exist.
    const sampleRate = S.preferredSampleRate ?? S.savedSampleRate ?? 48000;
    const ctxOpts = { sampleRate };
    S.audioCtx = new (window.AudioContext || window.webkitAudioContext)(ctxOpts);

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

    // Master gain — on mobile push harder to compensate for loudspeaker distance.
    // Desktop uses saved outputGainValue if available (from save-as-default), else 0.9.
    const masterGain = S.audioCtx.createGain();
    masterGain.gain.value = S.isMobile ? 3.0 : (S.outputGainValue ?? 0.9);

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

      // Stereo L/R analyser tap — feeds the two-bar output meter (DOM, via ui-meters.js).
      // ChannelSplitter deinterleaves the stereo signal coming out of muteGain
      // (grains connect through StereoPanner → masterBus, so the signal IS stereo).
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

    // ── Monitor / House bus split (Phase 1 — Improv Mode) ────────────────
    // monitorBus:  cursor grains connect here. Always feeds masterGain so
    //              the performer hears the cursor in headphones (or main out).
    // houseBus:    seed grains connect here.  Feeds masterGain through
    //              houseGainNode (volume-pedal controllable).
    // monitorToHouseGain:  pedal-controlled send from monitor into houseBus.
    //              Default 0 = cursor is private.  Pedal opens it to 1.
    //              (When outputs physically split, this is the only path
    //              cursor audio reaches the house speakers.)
    //
    // Current graph (single stereo out, both buses merge to masterGain):
    //   cursor grains → monitorBus ──────────────────→ masterGain → …
    //                       └→ monitorToHouseGain ──→ houseBus
    //   seed grains  → houseBus → houseGainNode ──→ masterGain → …
    //
    // When separate hardware outputs are available, monitorBus will
    // disconnect from masterGain and route to a dedicated headphone output.
    const monitorBus = S.audioCtx.createGain();
    monitorBus.gain.value = 1;

    const houseBus = S.audioCtx.createGain();
    houseBus.gain.value = 1;

    const monitorToHouseGain = S.audioCtx.createGain();
    monitorToHouseGain.gain.value = S.scanMuted ? 0 : S.monitorGainValue; // respect scan state

    const houseGainNode = S.audioCtx.createGain();
    houseGainNode.gain.value = S.houseGainValue; // default 1

    // Scan mute: insert a gain node between monitorBus and masterGain.
    // When scanMuted is true this gain is zeroed — cursor disappears from
    // the house/main output.  In multi-ch mode the monitor speaker buses are
    // unaffected (cursor stays audible on headphones).
    const cursorMasterGain = S.audioCtx.createGain();
    cursorMasterGain.gain.value = S.scanMuted ? 0 : 1;
    S.cursorMasterGain = cursorMasterGain;

    // Wire: monitorBus → cursorMasterGain → masterGain (cursor audible unless muted)
    monitorBus.connect(cursorMasterGain);
    cursorMasterGain.connect(masterGain);
    // Wire: monitorBus → monitorToHouseGain → houseBus (pedal send)
    monitorBus.connect(monitorToHouseGain);
    monitorToHouseGain.connect(houseBus);
    // Wire: houseBus → houseGainNode → masterGain (seeds to output)
    houseBus.connect(houseGainNode);
    houseGainNode.connect(masterGain);

    S.monitorBus         = monitorBus;
    S.houseBus           = houseBus;
    S.monitorToHouseGain = monitorToHouseGain;
    S.houseGainNode      = houseGainNode;

    // ── Dry monitor layer (browser / stereo path) ──────────────────────────
    // Continuous spatialized pass-through of live input, panned to cursor
    // position via StereoPanner.  VBAP path is set up in initSpeakerBuses.
    const dryGain = S.audioCtx.createGain();
    dryGain.gain.value = S.dryMonitorEnabled ? S.dryMonitorGainValue : 0;
    S.dryGainNode = dryGain;

    const dryAnalyser = S.audioCtx.createAnalyser();
    dryAnalyser.fftSize = 256;
    dryAnalyser.smoothingTimeConstant = 0.75;
    S.dryAnalyser = dryAnalyser;

    // StereoPanner for browser / 2-ch mode — updated each frame by
    // updateDryMonitorPanning().  Multi-ch VBAP replaces this in initSpeakerBuses.
    const dryPanner = S.audioCtx.createStereoPanner();
    dryPanner.pan.value = 0;
    S.dryPanner = dryPanner;

    // Chain: inputGainNode → dryGain → dryAnalyser → dryPanner → houseBus
    // (houseBus so the dry signal goes to house like cursor + commits)
    dryGain.connect(dryAnalyser);
    dryAnalyser.connect(dryPanner);
    dryPanner.connect(houseBus);
    // inputGainNode → dryGain is connected when mic is granted (requestMicAccess)

    // Detect suspension → resumption so grain.js can reset onset clocks.
    // When Chrome auto-suspends the AudioContext (tab backgrounded, autoplay
    // policy, etc.) actx.currentTime freezes.  On resumption the scheduler
    // would try to schedule grains at t ≈ audioNow (the frozen value), which
    // by call-time is already slightly in the past → setValueCurveAtTime
    // throws → persistent snapping / "stuck on triangle" sound.
    // Resetting the onset clock on 'running' after 'suspended' makes the
    // scheduler reinitialise from the current (resumed) audio time instead.
    let _prevCtxState = S.audioCtx.state;
    S.audioCtx.addEventListener('statechange', () => {
      const next = S.audioCtx?.state;
      if (next === 'running' && _prevCtxState === 'suspended') {
        S._resetOnsetClocks?.();
      }
      _prevCtxState = next;
    });
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

  // Stop all active commits — their source nodes will be invalid after context close
  const { clearAllCommits } = await import('./ui-presets.js');
  clearAllCommits?.();

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

  // Reset worklet registration — new AudioContext needs fresh addModule calls
  _recWorkletReady = false;

  // Reset dependent state
  S.masterBus       = null;
  S.masterAnalyser  = null;
  S.speakerAnalysers = null;  // recreated by ensureAudioContext (browser) or initSpeakerBuses (Electron)
  S.monitorBus          = null;
  S.houseBus            = null;
  S.monitorToHouseGain  = null;
  S.houseGainNode       = null;
  S.cursorMasterGain    = null;
  S.mixdownHouseGainNodes  = null;
  S.mixdownCursorGainNodes = null;
  S.mixdownCursorInputs    = null;
  S.monitorSpeakerBuses = null;
  S.inputGainNode   = null;
  S.inputAnalyser  = null;
  S.micPermissionGranted = false;
  S.inputStream    = null;
  window._micMonitorSrc = null;

  // Recreate immediately so the rest of the app can use it
  ensureAudioContext();
  DEBUG && console.log(`AudioContext recreated at ${newSampleRate} Hz`);
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

  // Pre-load the recording-capture worklet so startLiveRecording is synchronous.
  // addModule is idempotent — safe to call multiple times.
  if (!_recWorkletReady) {
    actx.audioWorklet.addModule('js/worklets/recording-capture.worklet.js')
      .then(() => { _recWorkletReady = true; })
      .catch(e => console.warn('Recording worklet pre-load failed:', e));
  }
}

let _micAccessPromise = null;  // guard against concurrent getUserMedia calls

export async function requestMicAccess() {
  // In Electron, RtAudio handles input — skip getUserMedia entirely.
  // Return true if RtAudio is already streaming so callers proceed to recording.
  if (window.electronBridge?.isElectron) {
    return !!window._rtAudioInputListening;
  }
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
      sampleRate:          { ideal: S.audioCtx?.sampleRate ?? 48000 },
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

    // Only create these nodes if they don't already exist.
    // In Electron mode, setupRtAudioInputMeters may have already created
    // S.inputGainNode and wired per-channel routing gains into it.
    // Unconditionally overwriting would orphan those routing gains and
    // break channel selection — only the getUserMedia source would remain.
    if (!S.inputGainNode) {
      S.inputGainNode = actx.createGain();
      S.inputGainNode.gain.value = S.inputGainValue;
    }
    if (!S.inputAnalyser) {
      S.inputAnalyser = actx.createAnalyser();
      S.inputAnalyser.fftSize = 256;
      S.inputAnalyser.smoothingTimeConstant = 0.6;
      S.inputGainNode.connect(S.inputAnalyser);
    }

    // Wire inputGainNode → dryGainNode for the dry monitor layer.
    // dryGainNode is created in ensureAudioContext; this connect is idempotent
    // (Web Audio ignores duplicate connections between the same pair).
    if (S.dryGainNode) S.inputGainNode.connect(S.dryGainNode);

    // Connect getUserMedia source into the gain node.
    // In Electron mode, rewireRtAudioRecordingChannel will disconnect this
    // once RtAudio takes over as sole input source.
    monitorSrc.connect(S.inputGainNode);

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

    // Sync audio settings module — tell it which device is now active so the
    // dropdown, meters, and internal state all reflect reality.  Uses the
    // actual deviceId from the stream (browser may have chosen a different
    // device than requested).
    const grantedTrack = S.recordingStream.getAudioTracks()[0];
    const grantedId    = grantedTrack?.getSettings()?.deviceId ?? S.selectedInputDeviceId ?? null;
    const grantedCh    = grantedTrack?.getSettings()?.channelCount ?? 1;
    S._onBrowserMicGranted?.(grantedId, grantedCh);

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
  // Allow recording if we have a browser MediaStream OR Electron RtAudio input active.
  // In Electron, S.recordingStream is never set — audio flows via RtAudio IPC into
  // inputGainNode → inputAnalyser, which is the same chain the recording worklet taps.
  const hasRtAudioInput = window.electronBridge?.isElectron && window._rtAudioInputListening;
  if (!S.recordingStream && !hasRtAudioInput) return;

  // Memory guard — refuse to start a new recording if we've hit the ceiling.
  // The performer sees the HUD flash red and knows to sweep.
  if (perf.recTotalSec >= S.recLimitSeconds) {
    const vmBuf = document.getElementById('vmBuffers');
    if (vmBuf) {
      vmBuf.style.color = '#e06060';
      vmBuf.textContent = 'rec limit — sweep!';
      setTimeout(() => S.updateLiveRecUI?.(), 2000);
    }
    return;
  }

  const actx = ensureAudioContext();

  // The worklet is pre-loaded in warmUpAudioEngine (called on mic grant).
  // If it somehow hasn't loaded yet (race on very first press), bail out
  // and schedule a retry — the user won't notice the ~50ms delay.
  if (!_recWorkletReady) {
    actx.audioWorklet.addModule('js/worklets/recording-capture.worklet.js')
      .then(() => { _recWorkletReady = true; startLiveRecording(); })
      .catch(e => console.error('Failed to load recording worklet:', e));
    return;
  }

  S.recordingSampleRate   = actx.sampleRate;
  S.recordingRaw          = new Float32Array(S.recordingSampleRate * 300); // 5 min headroom
  S.recordingWritePos     = 0;
  S.liveBufferSampleCount = 0;

  // inputGainNode and inputAnalyser are created once in requestMicAccess and persist.
  // We don't need a separate MediaStreamSource for recording — tap the already-connected
  // inputAnalyser output and route it through the AudioWorklet for capture.

  S.recordingNode = new AudioWorkletNode(actx, 'recording-capture', {
    numberOfInputs:   1,
    numberOfOutputs:  0,    // no output needed — worklet is a pure sink
    channelCount:     1,
    channelCountMode: 'explicit',
  });

  S.recordingStartTime = performance.now();

  // Receive batched PCM chunks from the worklet's audio thread
  S.recordingNode.port.onmessage = ({ data }) => {
    const { samples, frames } = data;
    if (S.recordingWritePos + frames > S.recordingRaw.length) {
      const grown = new Float32Array(S.recordingRaw.length * 2);
      grown.set(S.recordingRaw);
      S.recordingRaw = grown;
    }
    S.recordingRaw.set(samples, S.recordingWritePos);
    S.recordingWritePos += frames;
  };

  // Tell worklet to start capturing
  S.recordingNode.port.postMessage({ type: 'init', batchSize: 16 });

  // Chain: (persistent) inputGain -> inputAnalyser -> worklet (pure sink, no destination needed)
  // inputAnalyser already has inputGainNode feeding it; just attach the recorder.
  S.inputAnalyser.connect(S.recordingNode);

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
    // Tell the worklet to flush any partial batch and stop
    try { S.recordingNode.port.postMessage({ type: 'stop' }); } catch(_) {}
    S.recordingNode.port.onmessage = null;
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

  DEBUG && console.log(`Live rec buffer ${S.currentLiveBufferIdx}: ${audioBuffer.duration.toFixed(2)}s`);
  S.recordingRaw         = null;
  S.recordingWritePos    = 0;
  S.liveBufferSampleCount = 0;
  S.currentLiveBufferIdx = -1;
  // Release the reusable live buffer — the final audioBuffer is now in the slot
  _liveAudioBuf    = null;
  _liveAudioBufLen = 0;
  _liveCopiedUpTo  = 0;
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
  if (S.monitorSpeakerBuses) {
    S.monitorSpeakerBuses.forEach(b => { try { b.bus.disconnect(); } catch(_) {} });
    S.monitorSpeakerBuses = null;
  }
  if (S.mixdownHouseGainNodes) {
    S.mixdownHouseGainNodes.forEach(g => { try { g.disconnect(); } catch(_) {} });
    S.mixdownHouseGainNodes = null;
  }
  if (S.mixdownCursorGainNodes) {
    S.mixdownCursorGainNodes.forEach(g => { try { g.disconnect(); } catch(_) {} });
    S.mixdownCursorGainNodes = null;
  }
  if (S.mixdownCursorInputs) {
    S.mixdownCursorInputs.forEach(g => { try { g.disconnect(); } catch(_) {} });
    S.mixdownCursorInputs = null;
  }
  // Tear down dry monitor VBAP nodes from previous initSpeakerBuses
  if (S.dryVBAPGains) {
    S.dryVBAPGains.forEach(g => { try { g.disconnect(); } catch(_) {} });
    S.dryVBAPGains = null;
  }
  if (S.dryMixdownInputs) {
    S.dryMixdownInputs.forEach(g => { try { g.disconnect(); } catch(_) {} });
    S.dryMixdownInputs = null;
  }
  // Disconnect stereo dryPanner from houseBus — VBAP will replace it
  if (S.dryPanner) {
    try { S.dryPanner.disconnect(); } catch(_) {}
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

  // ── Split house / stereo mixdown when S.stereoMixdownEnabled is on ────────
  // When stereoMixdownEnabled: the last 2 physical channels are reserved for the
  // stereo mixdown bus pair (cursor grains).  S.numHouseSpeakers defines how many
  // channels carry the VBAP spatial field — capped at n-2 so mixdown always fits.
  // When stereoMixdownEnabled is false: all n channels are house; cursor grains
  // use the stereo monitorBus path (monitorBus → masterGain → destination).
  const requestedHouse  = S.numHouseSpeakers ?? 2;
  const hasMonitorCh    = S.stereoMixdownEnabled === true && n >= 2;
  const numHouseCh      = hasMonitorCh
    ? Math.max(1, Math.min(requestedHouse, n - 2))
    : Math.min(requestedHouse, n);
  // Physical output channels for the stereo mixdown L/R buses.
  // Default: immediately after the last house channel (numHouseCh, numHouseCh+1).
  const hpPhysL = hasMonitorCh ? (S.headphoneRouting?.[0] ?? numHouseCh)     : -1;
  const hpPhysR = hasMonitorCh ? (S.headphoneRouting?.[1] ?? numHouseCh + 1) : -1;

  const busGainInit = S.isMuted ? 0 : (S.outputGainValue ?? 1);
  const buses = Array.from({ length: numHouseCh }, (_, i) => {
    const angleDeg = speakerAngleDeg(i, numHouseCh);
    const angleRad = (angleDeg * Math.PI) / 180;
    const bus = actx.createGain();
    bus.gain.value = busGainInit;
    return { bus, angleDeg, angleRad };
  });

  // Stereo downmix of house buses → mixdown physical channels.
  // Each house bus is panned L/R by its angle using equal-power weighting:
  //   270° → full L,  90° → full R,  0°/180° → centre.
  // Architecture (when mixdown is active):
  //   house buses → fold-down L/R → houseMixGainL/R → mixSumL/R → merger + headphones
  //   cursor grains (muted from house) → cursorInputL/R → cursorMixGainL/R → mixSumL/R
  // The house and cursor gains are independently controllable from the mixdown UI.
  const monitorBuses = hasMonitorCh ? (() => {
    // Intermediate house fold-down nodes
    const houseFoldL = actx.createGain();
    const houseFoldR = actx.createGain();
    buses.forEach(({ bus, angleDeg }) => {
      const pan   = Math.sin(angleDeg * Math.PI / 180);
      const lGain = Math.cos((pan + 1) * Math.PI / 4);
      const rGain = Math.sin((pan + 1) * Math.PI / 4);
      const gL = actx.createGain(); gL.gain.value = lGain;
      const gR = actx.createGain(); gR.gain.value = rGain;
      bus.connect(gL); gL.connect(houseFoldL);
      bus.connect(gR); gR.connect(houseFoldR);
    });

    // House mix gain (controllable from mixdown UI)
    const houseMixGainL = actx.createGain();
    const houseMixGainR = actx.createGain();
    houseMixGainL.gain.value = S.mixdownHouseGainValue;
    houseMixGainR.gain.value = S.mixdownHouseGainValue;
    houseFoldL.connect(houseMixGainL);
    houseFoldR.connect(houseMixGainR);

    // Cursor mix input + gain (cursor grains connect to inputs when muted from house)
    const cursorInputL = actx.createGain(); cursorInputL.gain.value = 1;
    const cursorInputR = actx.createGain(); cursorInputR.gain.value = 1;
    const cursorMixGainL = actx.createGain();
    const cursorMixGainR = actx.createGain();
    cursorMixGainL.gain.value = S.mixdownCursorGainValue;
    cursorMixGainR.gain.value = S.mixdownCursorGainValue;
    cursorInputL.connect(cursorMixGainL);
    cursorInputR.connect(cursorMixGainR);

    // Final mixdown sum (house fold-down + cursor → single L/R pair)
    const mixSumL = actx.createGain(); mixSumL.gain.value = 1;
    const mixSumR = actx.createGain(); mixSumR.gain.value = 1;
    houseMixGainL.connect(mixSumL);
    houseMixGainR.connect(mixSumR);
    cursorMixGainL.connect(mixSumL);
    cursorMixGainR.connect(mixSumR);

    // Expose gain nodes on S for UI control
    S.mixdownHouseGainNodes  = [houseMixGainL, houseMixGainR];
    S.mixdownCursorGainNodes = [cursorMixGainL, cursorMixGainR];
    S.mixdownCursorInputs    = [cursorInputL, cursorInputR];

    return [
      { bus: mixSumL, angleDeg: 270, angleRad: (270 * Math.PI) / 180 },
      { bus: mixSumR, angleDeg:  90, angleRad: ( 90 * Math.PI) / 180 },
    ];
  })() : [];

  // ── Dry monitor layer (multi-channel VBAP path) ──────────────────────────
  // One persistent gain node per house speaker bus.  updateDryMonitorPanning()
  // rewrites these gains each frame to track the cursor position.
  // dryGainNode → dryAnalyser already exist from ensureAudioContext; we just
  // need the fan-out to speaker buses and (optionally) the headphone mixdown.
  {
    const numSpeakers = buses.length;
    const dryVBAP = Array.from({ length: numSpeakers }, () => {
      const g = actx.createGain();
      g.gain.value = 0;  // will be set by updateDryMonitorPanning
      return g;
    });
    // Wire: dryAnalyser → each dryVBAP gain → corresponding speaker bus
    // (disconnect stereo panner first — it was the browser-path output)
    dryVBAP.forEach((g, i) => {
      S.dryAnalyser.connect(g);
      g.connect(buses[i].bus);
    });
    S.dryVBAPGains = dryVBAP;

    // Dry → headphone mixdown (when stereo mixdown is active).
    // Pan dry signal by cursor azimuth into L/R headphone pair, same as
    // the house fold-down approach.  Uses dedicated input gain nodes so the
    // dry level in the headphone mix tracks the house dry level by default.
    if (hasMonitorCh) {
      const dryMixL = actx.createGain(); dryMixL.gain.value = 0.707;
      const dryMixR = actx.createGain(); dryMixR.gain.value = 0.707;
      S.dryAnalyser.connect(dryMixL);
      S.dryAnalyser.connect(dryMixR);
      // Feed into the final mixdown sum alongside house and cursor
      dryMixL.connect(monitorBuses[0].bus);
      dryMixR.connect(monitorBuses[1].bus);
      S.dryMixdownInputs = [dryMixL, dryMixR];
    }
  }

  // All buses for analyser creation and headphone downmix
  const allBuses = [...buses, ...monitorBuses];

  // Per-bus AnalyserNodes for the output meter strip in audio settings
  S.speakerAnalysers = allBuses.map(({ bus }) => {
    const an = actx.createAnalyser();
    an.fftSize = 256;
    an.smoothingTimeConstant = 0.8;
    bus.connect(an);   // tap from bus; an is a dead-end (no further connect needed)
    return an;
  });

  // Merge N mono buses into a single N-channel stream.
  // Apply S.channelRouting if set (Physical→Spatial mapping); default = identity.
  // Monitor buses are always wired to the last 2 channels — channel routing does
  // not apply to them (they are never remapped by the user).
  _merger = actx.createChannelMerger(n);
  const routing = S.channelRouting ?? buses.map((_, i) => i);
  buses.forEach(({ bus }, i) => {
    const destCh = routing[i] ?? i;
    if (destCh >= 0 && destCh < numHouseCh) bus.connect(_merger, 0, destCh);
  });
  // Wire monitor buses to their physical channels (configurable via S.headphoneRouting)
  if (hasMonitorCh) {
    if (hpPhysL >= 0 && hpPhysL < n) monitorBuses[0].bus.connect(_merger, 0, hpPhysL);
    if (hpPhysR >= 0 && hpPhysR < n) monitorBuses[1].bus.connect(_merger, 0, hpPhysR);
  }

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
  const bufferFrames = S.preferredBufferSize ?? 1024;
  const batchSize    = Math.max(1, Math.round(bufferFrames / 128));
  _captureNode.port.postMessage({ type: 'init', numChannels: n, batchSize });

  _merger.connect(_captureNode);

  // Credit-based flow control: don't send if credits are exhausted
  let _audioCredits = 8;
  if (window.electronBridge.onAudioCredit) {
    window.electronBridge.onAudioCredit((credits) => {
      _audioCredits = Math.min(_audioCredits + credits, 8);
    });
  }
  _captureNode.port.onmessage = ({ data }) => {
    if (_audioCredits > 0) {
      _audioCredits--;
      window.electronBridge.sendAudioBuffer(data.interleaved);
    }
    // else: drop this buffer — backpressure from main process
  };

  // ── Stereo headphone mix ──────────────────────────────────────────────────
  // Always-on downmix → AudioContext destination (system output = headphones/laptop).
  // When n ≥ 4 the monitor buses ARE the stereo headphone pair (L=270°, R=90°),
  // so use them directly.  For n < 4 find the closest house buses to L/R.
  // For n=1 (mono) both sides use the single bus.
  let hpLBus, hpRBus;
  if (hasMonitorCh) {
    hpLBus = monitorBuses[0].bus; // already at 270° (L)
    hpRBus = monitorBuses[1].bus; // already at 90°  (R)
  } else {
    function closestBusIdx(targetDeg) {
      let best = 0, bestDist = Infinity;
      buses.forEach(({ angleDeg }, i) => {
        const d = Math.abs(((angleDeg - targetDeg + 540) % 360) - 180); // circular distance
        if (d < bestDist) { bestDist = d; best = i; }
      });
      return best;
    }
    hpLBus = buses[closestBusIdx(270)].bus; // left
    hpRBus = buses[closestBusIdx(90)].bus;  // right
  }

  const hpMerger = actx.createChannelMerger(2);
  hpLBus.connect(hpMerger, 0, 0);
  hpRBus.connect(hpMerger, 0, 1);
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
  hpLBus.connect(meterMerger, 0, 0);
  hpRBus.connect(meterMerger, 0, 1);
  _meterTap = actx.createGain();
  _meterTap.gain.value = 1;
  meterMerger.connect(_meterTap);
  _meterTap.connect(S.masterAnalyser);

  // Expose on S so grain.js can route to them.
  // S.speakerBuses = house spatial field (seed grains).
  // S.monitorSpeakerBuses = stereo mixdown pair (cursor grains); null when disabled.
  S.speakerBuses  = buses;   // [{ bus, angleDeg, angleRad }, ...]
  S.speakerBuses.numChannels = n;
  S.monitorSpeakerBuses = hasMonitorCh ? monitorBuses : null;

  // Pre-compute VBAP lookup table for O(1) speaker pair resolution in playGrain
  buildVBAPLookup(buses);

  // Legacy alias — keeps any remaining S.quadBuses references from crashing
  S.quadBuses = null;

  // Notify the main window that channel count changed so it can rebuild the meter strip.
  // Uses a callback on S to avoid a circular import with renderer.js.
  S._onSpeakerBusesReady?.(n);

  const houseDesc   = buses.map(b => b.angleDeg.toFixed(0) + '°').join(', ');
  const mixdownDesc = hasMonitorCh ? ` | stereo mixdown: ch ${hpPhysL}(L) ch ${hpPhysR}(R)` : '';
  DEBUG && console.log(`Speaker buses ready — ${n} ch, house[${numHouseCh}]: [${houseDesc}]${mixdownDesc} → audify`);
}

// ── Dry monitor panning update ────────────────────────────────────────────────
// Called once per metering frame (≈30fps) to rewrite the dry signal's VBAP gains
// (or stereo pan) based on the current cursor position.  Must be cheap: no
// allocations, no scheduler interaction.  Reuses the same patterns as playGrain
// for cursor position → spatial mapping.
const _dryW = new Float32Array(3);  // scratch: world coords
const _dryC = new Float32Array(3);  // scratch: camera coords

export function updateDryMonitorPanning() {
  if (!S.dryMonitorEnabled) return;
  if (!S.audioCtx || S.audioCtx.state !== 'running') return;

  // Compute cursor world-space position (same logic as scheduleGrains)
  const { lon, lat } = S.cursorQ
    ? getCursorLonLat()
    : (S.mouseInCanvas || S.altLocked)
      ? screenToLonLat(
          S.altLocked ? S.altFrozenMousePixelX : S.mousePixelX,
          S.altLocked ? S.altFrozenMousePixelY : S.mousePixelY)
      : getCursorLonLat();

  spherePointInto(lon, lat, _dryW);
  const wx = _dryW[0], wy = _dryW[1], wz = _dryW[2];

  let cx, cy, cz;
  if (S.spatialPanning === 'worldlocked') {
    cx = wx; cy = wy; cz = wz;
  } else {
    cameraTransformInto(wx, wy, wz, _dryC);
    cx = _dryC[0]; cy = _dryC[1]; cz = _dryC[2];
  }

  const t = S.audioCtx.currentTime;
  const RAMP = 0.03; // 30ms smooth transition to avoid zippering

  // ── Multi-channel VBAP path ──────────────────────────────────────────────
  if (S.dryVBAPGains?.length) {
    const n = S.dryVBAPGains.length;
    const rawAz  = Math.atan2(cx, cz);
    const TWO_PI = 2 * Math.PI;
    const az     = ((rawAz % TWO_PI) + TWO_PI) % TWO_PI;
    const azDeg  = az * (180 / Math.PI);

    const lut = queryVBAPLookup(azDeg);
    let wA = lut ? lut.wA : 0.707;
    let wB = lut ? lut.wB : 0.707;
    const idxA = lut ? lut.idxA : 0;
    const idxB = lut ? lut.idxB : Math.min(1, n - 1);

    // Elevation-dependent center bias (same as playGrain)
    const elevFrac = Math.abs(cy) * (1 / SPHERE_RADIUS);
    const elevBias = elevFrac * elevFrac;
    if (elevBias > 0.01) {
      const eqGain = 1 / Math.sqrt(n);
      wA = wA + (eqGain - wA) * elevBias;
      wB = wB + (eqGain - wB) * elevBias;
    }

    // Set all gains to 0, then set the two active speakers
    for (let i = 0; i < n; i++) {
      const target = (i === idxA) ? wA : (i === idxB) ? wB : 0;
      S.dryVBAPGains[i].gain.setTargetAtTime(target, t, RAMP);
    }

    // Update headphone mixdown L/R panning for dry signal
    if (S.dryMixdownInputs) {
      const pan = cz !== 0 ? Math.max(-1, Math.min(1, cx / Math.abs(cz))) : 0;
      const lW  = Math.cos((pan + 1) * Math.PI / 4);
      const rW  = Math.sin((pan + 1) * Math.PI / 4);
      S.dryMixdownInputs[0].gain.setTargetAtTime(lW, t, RAMP);
      S.dryMixdownInputs[1].gain.setTargetAtTime(rW, t, RAMP);
    }

  // ── Stereo path (browser) ───────────────────────────────────────────────
  } else if (S.dryPanner) {
    const rawPan = cz !== 0 ? Math.max(-1, Math.min(1, cx / Math.abs(cz))) : 0;
    S.dryPanner.pan.setTargetAtTime(rawPan, t, RAMP);
  }
}

// ── Dry monitor gain control ─────────────────────────────────────────────────
export function setDryMonitorGain(v) {
  v = Math.max(0, Math.min(2, v));
  S.dryMonitorGainValue = v;
  const t = S.audioCtx?.currentTime ?? 0;
  if (S.dryGainNode) {
    S.dryGainNode.gain.setTargetAtTime(
      S.dryMonitorEnabled ? v : 0, t, 0.02
    );
  }
  // Sync UI elements
  const slider = document.getElementById('dryMonitorGainSlider');
  if (slider) slider.value = v;
  const num = document.getElementById('dryMonitorGainNum');
  if (num) num.textContent = Math.round(v * 100) + '%';
}

export function setDryMonitorEnabled(on) {
  S.dryMonitorEnabled = on;
  const t = S.audioCtx?.currentTime ?? 0;
  if (S.dryGainNode) {
    S.dryGainNode.gain.setTargetAtTime(
      on ? S.dryMonitorGainValue : 0, t, 0.02
    );
  }
}

// ── Speaker sweep helper ──────────────────────────────────────────────────────
// Plays a short noise burst on a single physical output channel, bypassing all
// VBAP buses and routing tables.  Used by the audio settings sweep function.
// Returns a Promise that resolves when the burst finishes.
export function playSweepChannel(chIndex, durationMs = 600, fadeMs = 40, vol = 0.06) {
  const actx = ensureAudioContext();
  if (!_merger || !actx) return Promise.resolve();
  const n = S.speakerBuses?.numChannels ?? 0;
  if (chIndex < 0 || chIndex >= n) return Promise.resolve();

  const frames   = Math.floor(actx.sampleRate * durationMs / 1000);
  const noiseBuf = actx.createBuffer(1, frames, actx.sampleRate);
  const data     = noiseBuf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const src      = actx.createBufferSource();
  src.buffer     = noiseBuf;
  const gain     = actx.createGain();
  const fadeSec  = fadeMs / 1000;
  const t        = actx.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + fadeSec);
  gain.gain.setValueAtTime(vol, t + durationMs / 1000 - fadeSec);
  gain.gain.linearRampToValueAtTime(0, t + durationMs / 1000);

  src.connect(gain);
  gain.connect(_merger, 0, chIndex);

  // Also connect into the matching speakerAnalyser so meters show the sweep.
  // Reverse-lookup: find which bus (or mixdown pair) maps to this physical channel.
  const analyserConn = (() => {
    if (!S.speakerAnalysers?.length) return null;
    const nBuses   = S.speakerBuses?.length ?? 0;
    const routing  = S.channelRouting ?? S.speakerBuses?.map((_, i) => i) ?? [];
    const hpL      = S.headphoneRouting?.[0] ?? nBuses;
    const hpR      = S.headphoneRouting?.[1] ?? nBuses + 1;
    // Check house buses
    const busIdx = routing.indexOf(chIndex);
    if (busIdx >= 0 && S.speakerAnalysers[busIdx]) return S.speakerAnalysers[busIdx];
    // Check mixdown pair
    if (chIndex === hpL && S.speakerAnalysers[nBuses])   return S.speakerAnalysers[nBuses];
    if (chIndex === hpR && S.speakerAnalysers[nBuses + 1]) return S.speakerAnalysers[nBuses + 1];
    return null;
  })();
  if (analyserConn) gain.connect(analyserConn);

  src.start();

  return new Promise(resolve => setTimeout(() => {
    try { src.stop(); src.disconnect(); gain.disconnect(_merger, 0, chIndex); } catch(_) {}
    try { if (analyserConn) gain.disconnect(analyserConn); } catch(_) {}
    resolve();
  }, durationMs));
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
  DEBUG && console.log('Channel routing updated:', routing);
}

// Rewire the headphone (monitor) buses to new physical channels.
// Call after changing S.headphoneRouting.
export function rewireMonitorChannels() {
  if (!S.monitorSpeakerBuses?.length || !_merger) return;
  const n = S.speakerBuses.numChannels ?? (S.speakerBuses.length + 2);
  // Disconnect monitor buses from all merger inputs
  S.monitorSpeakerBuses.forEach(({ bus }) => {
    for (let i = 0; i < n; i++) {
      try { bus.disconnect(_merger, 0, i); } catch(_) {}
    }
  });
  const nHouse  = S.speakerBuses.length;  // house bus count = first sequential default
  const hpPhysL = S.headphoneRouting?.[0] ?? nHouse;
  const hpPhysR = S.headphoneRouting?.[1] ?? nHouse + 1;
  if (hpPhysL >= 0 && hpPhysL < n) S.monitorSpeakerBuses[0].bus.connect(_merger, 0, hpPhysL);
  if (hpPhysR >= 0 && hpPhysR < n) S.monitorSpeakerBuses[1].bus.connect(_merger, 0, hpPhysR);
  DEBUG && console.log(`Stereo mixdown routing updated: L→ch${hpPhysL} R→ch${hpPhysR}`);
}

// Convenience: called from main.js on startup (stereo placeholder until device is chosen)
export async function initQuadBuses() {
  return initSpeakerBuses(2);
}

export function getRecordingDuration() {
  if (!S.isRecording) return 0;
  return (performance.now() - S.recordingStartTime) / 1000;
}

// Pre-allocated live buffer — reused across rebuilds to avoid creating a new
// AudioBuffer every 200ms.  Only reallocated when recording outgrows it.
let _liveAudioBuf    = null;
let _liveAudioBufLen = 0;
let _liveCopiedUpTo  = 0;  // samples already copied — only copy the delta

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

  // Reuse the existing AudioBuffer if it's large enough; otherwise allocate
  // with 2× headroom so reallocations are rare (amortised doubling).
  let needFullCopy = false;
  if (!_liveAudioBuf || _liveAudioBufLen < len || _liveAudioBuf.sampleRate !== S.recordingSampleRate) {
    const allocLen = Math.max(len, (_liveAudioBufLen || len) * 2);
    _liveAudioBuf    = actx.createBuffer(1, allocLen, S.recordingSampleRate);
    _liveAudioBufLen = allocLen;
    _liveCopiedUpTo  = 0;  // new buffer — must copy everything
    needFullCopy = true;
  }

  // Incremental copy — only transfer new samples since last rebuild.
  // At 48kHz with 200ms interval that's ~9600 samples (38KB) instead of
  // the full recording (which grows to millions of samples over minutes).
  const channelData = _liveAudioBuf.getChannelData(0);
  const copyFrom = needFullCopy ? 0 : _liveCopiedUpTo;
  if (copyFrom < len) {
    channelData.set(S.recordingRaw.subarray(copyFrom, len), copyFrom);
  }
  _liveCopiedUpTo = len;
  S.liveBufferSampleCount = len;

  if (S.currentLiveBufferIdx >= 0 && S.currentLiveBufferIdx < S.liveRecBuffers.length) {
    S.liveRecBuffers[S.currentLiveBufferIdx].liveBuffer = _liveAudioBuf;
    S.liveRecBuffers[S.currentLiveBufferIdx].duration   = len / S.recordingSampleRate;
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
