// ============================================================================
// AUDIO SYSTEM  (extracted from index.html)
// ============================================================================

import { S, DEBUG, SPHERE_RADIUS, perf, LIVE_REBUILD_INTERVAL_MS, MASTER_DEFAULT_GAIN, MAX_SAMPLES } from './state.js';
import { dlog } from './diag.js';
import { makeTake } from './take.js';
import { settleTakeTimbre, resetTimbreHold } from './audio-features.js';
import { buildVBAPLookup, queryVBAPLookup } from './grain.js';
import { cursorLonLatNow, spherePointInto, cameraRotateInto } from './sphere.js';

// Track whether the recording-capture worklet module has been registered.
// Reset to false on AudioContext recreation (new context needs fresh addModule).
let _recWorkletReady = false;

// ── Helpers ─────────────────────────────────────────────────────────────────

// ── The output ceiling (2026-09-14) ─────────────────────────────────────────
// One node, used at the end of BOTH output chains — the browser's
// masterGain → destination and Electron's merger → capture worklet. The
// reasoning and the numbers are in js/worklets/ceiling.worklet.js; the rule
// here is that neither build gets its own. It replaced `makeSoftClipCurve`,
// a WaveShaper curve with 4× of hidden make-up gain that only the browser
// path ever ran.
let _ceilingModule = null;   // one addModule promise per context

/** Register the ceiling processor on this context (idempotent). */
export function ceilingReady(actx) {
  if (!_ceilingModule) _ceilingModule = actx.audioWorklet.addModule('js/worklets/ceiling.worklet.js');
  return _ceilingModule;
}

/** An N-channel ceiling node, or null if the module has not registered yet.
 *  Its once-a-second report lands in S.transportDiag beside the transport's
 *  own faults — the deepest gain reduction and how much of the second it
 *  acted on, so "am I running hot" is a number. */
export function makeCeilingNode(actx, n, groups = null) {
  try {
    const node = new AudioWorkletNode(actx, 'ceiling', {
      numberOfInputs: 1, numberOfOutputs: 1,
      channelCount: n, channelCountMode: 'explicit', channelInterpretation: 'discrete',
      outputChannelCount: [n],
      processorOptions: { numChannels: n, groups },
    });
    node.port.onmessage = e => {
      const d = e.data || {};
      S.transportDiag = S.transportDiag || {};
      S.transportDiag.ceilingGrDb      = +(d.grDb ?? 0).toFixed(2);
      S.transportDiag.ceilingEngagedPct = +(d.engagedPct ?? 0).toFixed(2);
    };
    return node;
  } catch (_) {
    return null;   // module not registered on this context yet
  }
}

// ── Audio context & master bus ──────────────────────────────────────────────

/** A WAV of `seconds` of silence as a blob URL — the mobile speaker-routing
 *  element's source (see ensureAudioContext). 8 kHz mono 16-bit. */
function _silentWavUrl(seconds) {
  const rate = 8000, n = Math.round(rate * seconds), data = n * 2;
  const b = new ArrayBuffer(44 + data), v = new DataView(b);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, data, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}

export function ensureAudioContext() {
  if (!S.audioCtx) {
    // Use caller-supplied preferred rate (set by audio settings UI), then
    // persisted rate from previous session, then 48000 (Chrome default,
    // matches most USB interfaces).  Explicit 48000 avoids ambiguity when
    // neither preference nor saved rate exist.
    const sampleRate = S.preferredSampleRate ?? S.savedSampleRate ?? 48000;
    // 'interactive' tells the browser to use the smallest internal render
    // buffer, minimising dry-monitor round-trip latency (~5-10ms vs 20-40ms
    // with the default 'balanced').  Critical for live performers hearing
    // themselves through the system.
    const ctxOpts = { sampleRate, latencyHint: 'interactive' };
    S.audioCtx = new (window.AudioContext || window.webkitAudioContext)(ctxOpts);

    // On mobile, Web Audio defaults to the earpiece (call speaker, tiny & quiet).
    // Playing a silent looping <audio> element forces Chrome/Android to switch
    // the audio session to media/loudspeaker mode for the whole AudioContext.
    if (S.isMobile) {
      // ONE SECOND of silence, not zero samples (2026-09-12): a 0-sample WAV
      // on loop is a media element that ends and restarts continuously, and
      // it ate the main thread — a phone-emulated page answered a script call
      // in 5 s with it and 2 ms without (TODO #349). 8 kHz mono 16-bit.
      const silentAudio = document.createElement('audio');
      silentAudio.src = _silentWavUrl(1);
      silentAudio.loop   = true;
      silentAudio.volume = 0.001; // effectively inaudible but keeps the session alive
      silentAudio.play().catch(() => {});
      window._mobileSpeakerAudio = silentAudio;
    }

    // Master gain — on mobile push harder to compensate for loudspeaker distance.
    // Desktop uses saved outputGainValue if available (from save-as-default),
    // else the -6 dB cold-boot default the sliders show. Both come from
    // MASTER_DEFAULT_GAIN in state.js — do not reintroduce a literal here.
    const masterGain = S.audioCtx.createGain();
    masterGain.gain.value = S.isMobile ? 3.0 : (S.outputGainValue ?? MASTER_DEFAULT_GAIN);

    // THE CEILING IS A WORKLET NOW, AND BOTH BUILDS USE THE SAME ONE (Ek,
    // 2026-09-14). What stood here was a WaveShaper carrying
    // tanh(4x)/tanh(4), which normalises the top to 1.0 and leaves the drive
    // in: measured 4.00× (+12.0 dB) of small-signal gain and 1.18 % THD at
    // −20 dBFS, 8.8 % at −10. It was doing the job of a saturator while being
    // described as a clipper, and only on this path — the Electron output
    // never saw it. `js/worklets/ceiling.worklet.js` replaces it in both
    // chains: bit-exact below −3.1 dBFS, bending to a −0.09 dBFS ceiling
    // above, linked across channels, zero latency.
    const ceilingNode = makeCeilingNode(S.audioCtx, 2);

    // Analyser tap — post-clipper, pre-mute, so meter stays active even when muted
    S.masterAnalyser = S.audioCtx.createAnalyser();
    S.masterAnalyser.fftSize = 256;
    S.masterAnalyser.smoothingTimeConstant = 0.75;

    // Mute gain — final stage, zeroed by mute button; output meter reads upstream of this
    const muteGain = S.audioCtx.createGain();
    muteGain.gain.value = 1;

    // Chain: masterGain -> ceiling -> analyser -> muteGain -> destination
    // In Electron, RtAudio owns hardware output — don't connect to Web Audio
    // destination (it always goes to OS default / MacBook speakers regardless
    // of the selected interface). The speaker buses tap masterBus directly.
    // The node may be null until its module has loaded (see makeCeilingNode);
    // the chain is then master → analyser, which is what it was before the
    // ceiling existed, and it is rebuilt on the next context.
    if (ceilingNode) { masterGain.connect(ceilingNode); ceilingNode.connect(S.masterAnalyser); S._masterCeiling = ceilingNode; }
    else {
      // First context of the session: the module has not registered yet, so
      // run master → analyser and splice the ceiling in when it lands. A
      // context replaced meanwhile drops the result on the floor.
      masterGain.connect(S.masterAnalyser);
      const ctx = S.audioCtx;
      ceilingReady(ctx).then(() => {
        if (S.audioCtx !== ctx) return;
        const node = makeCeilingNode(ctx, 2);
        if (!node) return;
        try { masterGain.disconnect(S.masterAnalyser); } catch (_) {}
        masterGain.connect(node); node.connect(S.masterAnalyser);
        S._masterCeiling = node;
      }).catch(e => console.warn('[audio] ceiling:', e.message));
    }
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
    cursorMasterGain.gain.value = 1;   // the cap gates no bus (2026-09-23): what sounds finishes
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

    // If initSpeakerBuses already ran (Electron startup), the VBAP fan-out
    // gain nodes exist but weren't connected because dryAnalyser didn't
    // exist yet.  Wire them now.
    _wireDryVBAPInput();

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
      dlog('ctx', `statechange: ${_prevCtxState} → ${next}`, { nodes: S._grainSourceCount });
      // ── Error code 5 recovery ──────────────────────────────────────────
      // Chrome's native audio renderer can crash (error code 5) under heavy
      // load — the AudioContext state goes to 'closed' with no JS error.
      // Detect this and automatically recreate the context so the user can
      // keep working.  A short delay lets Chrome finish tearing down the
      // dead context before we build a new one.
      if (next === 'closed' && _prevCtxState === 'running') {
        dlog('ctx', 'CRASH — AudioContext closed unexpectedly (error code 5)', { nodes: S._grainSourceCount, rec: S.isRecording });
        console.warn('AudioContext closed unexpectedly (renderer crash) — recovering…');
        setTimeout(() => {
          S.audioCtx = null;  // force ensureAudioContext to rebuild
          S._grainSourceCount = 0;  // dead nodes won't fire 'ended'
          ensureAudioContext();
          // Re-open the mic if it was open. The guard was `S.micRequested`,
          // which NOTHING has ever assigned (2026-09-13), so this branch could
          // not run and a crash left the app rebuilt but deaf: the context
          // came back, recording did not, and nothing said so. The flag that
          // means "the mic is open" is micPermissionGranted, set at the one
          // place the stream is granted (requestMicAccess, and the settings
          // modal's own open).
          if (S.micPermissionGranted && !S.isRecording) {
            requestMicAccess?.().catch(() => {});
          }
        }, 200);
      }
      _prevCtxState = next;
    });
  }
  if (S.audioCtx.state === 'suspended') S.audioCtx.resume();
  return S.audioCtx;
}

export function getMasterBus() { ensureAudioContext(); return S.masterBus; }

// Where a sample PREVIEW should connect to be heard (#247). masterBus is a
// dead end in Electron — grains reach hardware straight through the VBAP
// speaker/monitor buses, and the master chain ends at a meter tap — so a
// preview into getMasterBus() was silent on the rig (and had been since
// multi-channel landed; the audible sampler preview memory is browser mode).
// Browser → the master chain. Electron → the headphone monitor pair when
// configured, else the first two house buses, else masterBus (silent, but
// nothing else exists until a device is selected).
export function getPreviewSinks() {
  ensureAudioContext();
  if (!window.electronBridge) return [S.masterBus];
  if (S.monitorSpeakerBuses?.length) return S.monitorSpeakerBuses.map(b => b.bus);
  if (S.speakerBuses?.length)        return S.speakerBuses.slice(0, 2).map(b => b.bus);
  return [S.masterBus];
}

// Tear down the AudioContext and all dependent state so ensureAudioContext()
// will recreate it at the new S.preferredSampleRate on next call.
// Any active recording is lost — caller should warn the user first.
export async function recreateAudioContext(newSampleRate) {
  S.preferredSampleRate = newSampleRate;

  // Stop any active recording
  if (S.isRecording) stopLiveRecording();

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

  // Release AudioBuffer references from the old context — these buffers were
  // created from the old context's sample rate and can't be used with the new
  // one.  Without this, they stay in memory indefinitely (unreachable but not
  // GC'd because liveRecBuffers holds strong references).  Particles that
  // reference these buffers via .bufferIndex will get fresh buffers when the
  // user re-records, and sweep will clean up orphaned particles.
  if (S.liveRecBuffers?.length) {
    for (const slot of S.liveRecBuffers) {
      slot.buffer     = null;
      slot.liveBuffer = null;
    }
  }
  S.currentLiveBufferIdx = -1;

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
  // Fire a one-sample silent buffer through source → gain → panner → master so
  // the AudioNode constructors are warm before the first real recording. This
  // takes the CPU spike off the very first spacebar press.
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
      S.inputAnalyser.smoothingTimeConstant = 0.3;
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

    // HARDWARE IN, PRE-TRIM — the same thing the Electron path meters, so the
    // footer's `hw in` column means one thing in both builds (Ek, 2026-09-14:
    // "in the footer, the IN, looks like hardware in, not post input trim").
    // Measured before this: Electron's meter tapped the splitter ahead of the
    // trim and did not move when the trim did, while the browser fell back to
    // `S.inputAnalyser`, which is POST-trim and does. One label, two
    // meanings. This taps the source itself, where nothing of ours has
    // touched the signal yet; `S.inputAnalyser` stays post-trim, because the
    // gate and the recording path are supposed to read what is captured.
    if (!S.inputAnalysers?.length) {
      const hw = actx.createAnalyser();
      hw.fftSize = 256;
      hw.smoothingTimeConstant = 0.3;
      monitorSrc.connect(hw);
      S.inputAnalysers = [hw];
    }

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

// ── Reusable recording backing buffer (perf audit H1, Jul 2026) ─────────────
// Allocating `new Float32Array(sr * 300)` (57.6 MB at 48 kHz) on EVERY record
// press was the biggest GC hammer in the app — a 57.6 MB alloc+zero at the
// musically-critical record onset, dropped to GC at stop (~1.2 GB of heap
// churn over a 20-take set). The pool is allocated once per session and
// reused; stale data beyond recordingWritePos is never read (finalize and
// rebuildLiveBuffer both use subarray(0, writePos)). If a take outgrows the
// pool (> 5 min), the grown buffer becomes the new pool so each size is paid
// at most once. Revert: replace the pool block in startLiveRecording with the
// original `S.recordingRaw = new Float32Array(S.recordingSampleRate * 300)`.
let _recRawPool = null;
let _recRawPoolRate = 0;

// ── Generic capture core (#247) ─────────────────────────────────────────────
// The machinery shared by a live paint stroke and a sampler take: pool
// acquire, worklet node + PCM writer, and the finalize/declick that turns
// the raw ring into an AudioBuffer. Uses the module singletons — ONE capture
// at a time, enforced by the callers' isRecording / isSamplerCapturing
// guards. The wrappers own everything stroke- or sampler-shaped.
function _captureStart(actx) {
  S.recordingSampleRate = actx.sampleRate;
  // Reuse the persistent pool (perf audit H1) — see comment above.
  if (!_recRawPool || _recRawPoolRate !== S.recordingSampleRate) {
    _recRawPool     = new Float32Array(S.recordingSampleRate * 300); // 5 min headroom
    _recRawPoolRate = S.recordingSampleRate;
  }
  S.recordingRaw      = _recRawPool;
  S.recordingWritePos = 0;

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

  // Receive batched PCM chunks from the worklet's audio thread. The stop
  // path swaps this handler for one that also watches for the worklet's
  // `done` (see _captureStop); bundles keep landing until then.
  S.recordingNode.port.onmessage = ({ data }) => _acceptBundle(data);

  // Tell worklet to start capturing
  S.recordingNode.port.postMessage({ type: 'init', batchSize: 16 });

  // Chain: (persistent) inputGain -> inputAnalyser -> worklet (pure sink)
  S.inputAnalyser.connect(S.recordingNode);
}

// One PCM bundle from the recorder worklet, appended to the raw pool. Guard:
// the worklet may post after the take is sealed and S.recordingRaw nulled.
function _acceptBundle(data) {
  if (!S.recordingRaw || !data?.samples) return;
  const { samples, frames } = data;
  if (S.recordingWritePos + frames > S.recordingRaw.length) {
    const grown = new Float32Array(S.recordingRaw.length * 2);
    grown.set(S.recordingRaw);
    S.recordingRaw = grown;
    _recRawPool    = grown;  // grown buffer becomes the pool (perf audit H1)
  }
  S.recordingRaw.set(samples, S.recordingWritePos);
  S.recordingWritePos += frames;
}

// ── Sealing waits for the recorder's last bundle (2026-09-02) ───────────────
// The recorder posts 2048-sample bundles, and the final partial one only
// arrives a task after 'stop' is sent. Sealing synchronously threw it away on
// every take — 0 to 43 ms off the end, at random, and a held-space loop is
// exactly the sealed length, so every loop was that much short. Now 'stop'
// starts a seal that finishes when the worklet's `done` lands (or after a
// 50 ms fallback if the worklet is gone). `whenSealed()` is for the callers
// that build something from the take straight after stopping it — loops and
// triggers read slot.buffer, and before the seal they would fall back to the
// oversized live buffer. A record press inside the window seals with what has
// arrived, which is the old behaviour on a race no hand can produce.
let _sealPending = null;      // { finish } while a stop waits on the recorder
// A tape take is held open past the release by the input latency (js/latency.js
// `inS`): the last thing sung before the button arrives that much later, and
// a loop whose region ends at the release would be short by exactly that.
let _holdTimer = null;
const _sealWaiters = [];

export function whenSealed(fn) {
  // A take held open past its release (stopLiveRecordingHeld) is not sealed
  // yet either: what is built from it must wait for the hold and the seal.
  if (_sealPending || _holdTimer) _sealWaiters.push(fn);
  else fn();
}

// Sends 'stop', keeps accepting bundles until the worklet's `done`, then
// tears the node down, builds the take and calls onSealed(audioBuffer) —
// null when the take was under the 80 ms floor (an accidental graze). Leaves
// S.recordingRaw/WritePos for the caller to reset.
function _captureStop(onSealed) {
  // Only tear down the recording-specific nodes.
  // inputGainNode and inputAnalyser are persistent (created in requestMicAccess)
  // so the meter and knob stay active between recordings.
  const node        = S.recordingNode;
  const analyserRef = S.inputAnalyser;
  S.recordingNode = null;

  let timer = 0;
  let done  = false;
  const finish = () => {
    if (done) return;
    done = true;
    _sealPending = null;
    if (timer) clearTimeout(timer);
    if (node) {
      node.port.onmessage = null;
      try { analyserRef && analyserRef.disconnect(node); } catch(_) {}
      try { node.disconnect(); } catch(_) {}
    }
    onSealed(_buildTake());
    const waiters = _sealWaiters.splice(0);
    for (const fn of waiters) {
      try { fn(); } catch (e) { console.warn('[audio] whenSealed callback failed:', e); }
    }
  };
  _sealPending = { finish };
  if (!node) { finish(); return; }
  node.port.onmessage = ({ data }) => {
    if (data?.done) { finish(); return; }
    _acceptBundle(data);
  };
  try { node.port.postMessage({ type: 'stop' }); } catch(_) { finish(); return; }
  timer = setTimeout(finish, 50);
}

function _buildTake() {
  const totalLength = S.recordingWritePos;

  // Minimum kept length: 80 ms. Shorter than this is an accidental graze.
  // (The 200 ms touchend delay means intentional taps always exceed this.)
  const MIN_REC_SAMPLES = Math.floor(S.recordingSampleRate * 0.08);
  if (totalLength < MIN_REC_SAMPLES) return null;

  const channelData = S.recordingRaw.subarray(0, totalLength);

  // Declick the buffer edges. This is DESTRUCTIVE — it is written into the
  // samples, so whatever it removes is gone for every later use of this take.
  //
  // It was 50 ms with a squared curve, which is not a declick, it is a fade:
  // squared means 25 ms in you are still 12 dB down, so hitting record and
  // playing a loud first beat straight away buried the attack permanently. That
  // is fine for granular material (grains carry their own envelopes and mostly
  // read the middle of the buffer) and fine for loops (buildLoopPayload bakes
  // its own 30 ms crossfade), but a trigger buffer is played verbatim from the
  // top and its whole point is the transient.
  //
  // 5 ms is what a declick actually needs. Raise it only with a reason — the
  // cost of getting it wrong lands on the recording, not on playback.
  const fadeSamples = Math.min(Math.floor(S.recordingSampleRate * 0.005), Math.floor(totalLength / 4));
  for (let i = 0; i < fadeSamples; i++) {
    const env = (i / fadeSamples) ** 2;
    channelData[i]                    *= env;
    channelData[totalLength - 1 - i]  *= env;
  }

  // ONE copy, into shared memory (js/take.js): the worklet reads this same
  // buffer, so the take is never held twice.
  return makeTake(channelData, S.recordingSampleRate);
}


export function startLiveRecording() {
  // A new take is a new reference — see resetTimbreHold.
  resetTimbreHold();
  // A press inside the hold cuts it: the new take starts now, the old one
  // seals with what has arrived.
  if (_holdTimer) { clearTimeout(_holdTimer); _holdTimer = null; stopLiveRecording(); }
  if (S.isRecording) return;
  // Allow recording if we have a browser MediaStream OR Electron RtAudio input active.
  // In Electron, S.recordingStream is never set — audio flows via RtAudio IPC into
  // inputGainNode → inputAnalyser, which is the same chain the recording worklet taps.
  const hasRtAudioInput = window.electronBridge?.isElectron && window._rtAudioInputListening;
  if (!S.recordingStream && !hasRtAudioInput) return;
  if (_sealPending) _sealPending.finish();   // a re-press inside the seal window

  // Memory guard — refuse to start a new recording if we've hit the ceiling.
  // The chrome's stats slot carries the warning (tile-layout.js: the budget
  // shows from 80% and reads "rec limit — sweep" here). It used to write to
  // `#vmBuffers`, which has been inside a `display: none` HUD since the
  // one-screen layout, so the refusal was silent — press, nothing recorded,
  // nothing painted, no indication (2026-09-13).
  if (perf.recTotalSec >= S.recLimitSeconds) {
    console.warn(`[audio] recording refused: ${Math.round(perf.recTotalSec)}s of ${S.recLimitSeconds}s used — sweep to free it`);
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

  _captureStart(actx);
  S.liveBufferSampleCount = 0;

  S.isRecording = true;
  dlog('audio', 'recording started', { sampleRate: S.recordingSampleRate, nodes: S._grainSourceCount });
  _dryMonitorRecordStart();   // auto-monitor ducks for a granular take (#245)

  // Reserve a slot in liveRecBuffers — placeholder with null buffer
  S.currentLiveBufferIdx = S.liveRecBuffers.length;
  // `startedAt`: the audio-clock time of the take's first sample, to within
  // the recorder's first block — what an OVERDUB reads to find where in its
  // master's cycle the take began (ui-presets.js attachOverdub).
  S.liveRecBuffers.push({ buffer: null, grainCursor: 0, startedAt: actx.currentTime });

  // If the worklet engine is running, init a provisional live buffer so grains
  // from the in-progress recording can be played by the worklet (not main thread).
  S._beginProvisionalRecording?.();

  // Notify main.js so it can cold-start the worklet on the first recording.
  S._onRecordingStart?.();

  S.updateLiveRecUI?.();
}

/** The release of a TAPE take: stamp when the button went up, keep recording
 *  for `holdS` (the input latency) so the sound of the release itself lands
 *  in the take, then stop. The take's `edges` — its region from the button,
 *  not the marks — are set at the seal. */
export function stopLiveRecordingHeld(holdS = 0) {
  if (!S.isRecording) return;
  const actx = S.audioCtx;
  const slot = S.liveRecBuffers[S.currentLiveBufferIdx];
  if (slot && actx) { slot.releaseAt = actx.currentTime; slot.inS = Math.max(0, holdS || 0); }
  if (!(holdS > 0)) { stopLiveRecording(); return; }
  _holdTimer = setTimeout(() => { _holdTimer = null; stopLiveRecording(); }, holdS * 1000);
}

export function stopLiveRecording() {
  if (!S.isRecording) return;
  if (_holdTimer) { clearTimeout(_holdTimer); _holdTimer = null; }
  S.isRecording = false;
  dlog('audio', 'recording stopped', { writePos: S.recordingWritePos, nodes: S._grainSourceCount });
  _dryMonitorRecordEnd();
  // The stroke's last mark is still pending in the paint ticker (it lands one
  // tick behind); settle it now so whatever is built from this take at the
  // seal — a loop, a trigger — has it.
  S._settlePaintPending?.();

  // isRecording is already false, so painting and the live rebuild have
  // stopped. The slot index is read at seal time, not here: undo/redo
  // renumber it when they splice liveRecBuffers (ui-samples.js).
  _captureStop((audioBuffer) => {
    const bufIdx = S.currentLiveBufferIdx;
    if (!audioBuffer) {
      // Too short — remove the placeholder slot
      if (bufIdx >= 0 && bufIdx < S.liveRecBuffers.length) {
        S.liveRecBuffers.splice(bufIdx, 1);
        // Fix particle references
        S.particles.forEach(p => {
          if (p.liveBufferIdx === bufIdx) p.liveBufferIdx = -1;
          else if (p.liveBufferIdx > bufIdx) p.liveBufferIdx--;
        });
      }
      S.currentLiveBufferIdx = -1;
      S.recordingRaw = null;
      S.updateLiveRecUI?.();
      return;
    }

    // Seal the live buffer slot
    const slot = S.liveRecBuffers[bufIdx];
    const dur = audioBuffer.duration;
    if (slot) {
      slot.buffer      = audioBuffer;
      slot.liveBuffer  = null;   // the provisional view is the NEXT take's from here
      slot.grainCursor = 0;
      // The region from the BUTTON (2026-09-04): the press is heard `inS`
      // into the take and the recorder held `inS` past the release, so the
      // material between the two presses is [inS, end]. Loops and line
      // triggers read this over the marks (buildLoopPayload, _applyCluster).
      if (slot.releaseAt != null) slot.edges = { startS: Math.min(slot.inS || 0, dur), endS: dur };
      if (slot.markSpan) { slot.markSpan[0] = Math.min(slot.markSpan[0], dur); slot.markSpan[1] = Math.min(slot.markSpan[1], Math.max(0, dur - 0.01)); }
    }

    // Clamp any particles that were painted beyond the final duration
    S.particles.forEach(p => {
      if (p.liveBufferIdx === bufIdx) {
        if (p.grainStart > dur) p.grainStart = Math.max(0, dur - 0.01);
        if (p.grainStart + p.grainDuration > dur) p.grainDuration = dur - p.grainStart;
      }
    });

    // THE TAKE'S COLOURS ARE DECIDED NOW, against the whole of it — see
    // settleTakeTimbre. Until the seal the hold could only compare a mark with
    // what had already been played, which is wrong at the start of a take.
    settleTakeTimbre(bufIdx);

    // Notify listeners that a recording was completed.
    // Hot-swap path: _onRecordingComplete adds finalized buffer to running worklet
    // and handles provisional buffer cleanup with deferred drain.
    // Cold-start path: _onRecordingComplete starts the worklet fresh.
    S._onRecordingComplete?.(audioBuffer, bufIdx);

    S.recordingRaw         = null;   // gate for late worklet messages; pool retained
    S.recordingWritePos    = 0;
    S.liveBufferSampleCount = 0;
    S.currentLiveBufferIdx = -1;
    S.updateLiveRecUI?.();
  });
}

// ── Sampler capture (#247 — record-into-sampler) ────────────────────────────
// Prep-time, gesture-free: the same _captureStart/_captureStop cores as a
// live stroke, with none of the stroke plumbing — no liveRecBuffers slot, no
// provisional streaming, no undo entry, and no rec-limit charge (takes are
// bounded by MAX_SAMPLES, and sweep never touches sample slots).
// One rule: while either recording family runs, the other refuses.
// sampler.js turns the returned AudioBuffer into a sample slot.
export function startSamplerCapture() {
  if (S.isSamplerCapturing) return false;
  if (S.isRecording || S.isPainting) { S._samplerRefused?.('a stroke is recording'); return false; }
  if (S.samples.length >= MAX_SAMPLES) { S._samplerRefused?.('all sampler slots full'); return false; }
  const hasRtAudioInput = window.electronBridge?.isElectron && window._rtAudioInputListening;
  if (!S.recordingStream && !hasRtAudioInput) { S._samplerRefused?.('no live input'); return false; }

  const actx = ensureAudioContext();
  if (!_recWorkletReady) {
    actx.audioWorklet.addModule('js/worklets/recording-capture.worklet.js')
      .then(() => { _recWorkletReady = true; startSamplerCapture(); })
      .catch(e => console.error('Failed to load recording worklet:', e));
    return false;
  }
  if (_sealPending) _sealPending.finish();   // a re-press inside the seal window

  _captureStart(actx);
  S.isSamplerCapturing = true;
  dlog('audio', 'sampler capture started', { sampleRate: S.recordingSampleRate });
  S._renderSourceUI?.();
  return true;
}

/** Stops the capture. onDone(audioBuffer) gets the declicked AudioBuffer a
 *  few ms later, once the recorder's last bundle has landed — or null when
 *  the take was under the 80 ms floor. */
export function stopSamplerCapture(onDone) {
  if (!S.isSamplerCapturing) { onDone?.(null); return; }
  S.isSamplerCapturing = false;
  dlog('audio', 'sampler capture stopped', { writePos: S.recordingWritePos });

  _captureStop((audioBuffer) => {
    S.recordingRaw      = null;   // gate for late worklet messages; pool retained
    S.recordingWritePos = 0;
    S._renderSourceUI?.();
    if (!audioBuffer) S._samplerRefused?.('take too short');
    onDone?.(audioBuffer);
  });
}

// ── The direct audio ports (2026-09-06) ──────────────────────────────────────
// Each hop is a MessagePort pair entangled straight between a worklet and the
// main process. The preload makes the channel (electronBridge.openAudioPort),
// posts one end to the main process and the other to this world over
// window.postMessage — the one way a port crosses contextIsolation — and this
// transfers it INTO the worklet. The renderer's main thread is then not in the
// audio path at all. It used to relay every block and every credit, so a
// stall here longer than the cushion was a hole in the output: measured on
// 2026-09-05, a 30 ms stall dropped one block and a 60 ms stall dropped
// eleven, while nothing in the app's own render loop showed above 6 ms — the
// path was the problem, not the drawing.
export function requestAudioPort(kind) {
  return new Promise((resolve, reject) => {
    if (!window.electronBridge?.openAudioPort) return reject(new Error('no electronBridge.openAudioPort'));
    // Bounded: the boot sequence awaits this, and a port that never comes must
    // not hold the output stream hostage — the worklet just drops until one does.
    const timer = setTimeout(() => { window.removeEventListener('message', onMsg); reject(new Error(`audio port '${kind}' did not arrive in 2 s`)); }, 2000);
    const onMsg = (e) => {
      if (e.source !== window || e.data?.type !== 'mubone-audio-port' || e.data.kind !== kind) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      const port = e.ports && e.ports[0];
      if (port) resolve(port); else reject(new Error(`audio port '${kind}' arrived without a port`));
    };
    window.addEventListener('message', onMsg);
    window.electronBridge.openAudioPort(kind);
  });
}

// ── The output queue's depth (#333; regulated in main since 2026-09-06) ──────
// The stall cushion in blocks: the depth the main process primes the output
// queue to and skips it back to (electron-main.js onOutputBlock, the same
// formula), and what the latency model counts (js/latency.js). Never under
// two blocks. A stall longer than the cushion is a dropout, which is the
// trade the cushion setting makes. Until 2026-09-06 this was a credit window
// held on the renderer's main thread; the blocks now go worklet → main
// straight, and main is the one place the true depth is known.
export function cushionBlocks() {
  const sr = S.audioCtx?.sampleRate ?? 48000;
  const frames = S.preferredBufferSize ?? 1024;
  return Math.max(2, Math.round((S.audioCushionMs ?? 10) / 1000 * sr / frames));
}
export function applyAudioCushion() {
  window.electronBridge?.setAudioCushion?.(S.audioCushionMs ?? 10);
  S._inputRingTarget?.();
}
/** The output queue's depth: frames written to audify and not yet played,
 *  in ms — the main process's own count, polled once a second. Zero with no
 *  output stream. */
export function outputQueueDepthMs() {
  if (!window.electronBridge || !_captureNode) return 0;
  return _outDepthMs;
}
let _outDepthMs = 0;
let _outDepthTimer = null;
// Once a second: the depth, and the two fault counts — a dry queue is a hole
// the device already played, a dropped block is a lead skipped back to the
// cushion (S.transportDiag, wg.status(), the cushion row in Settings → Audio).
async function _pollOutputDepth() {
  if (!window.electronBridge?.getOutputDepth || !_captureNode) return;
  try {
    // The loop-gap timers cost ~1 % of a core each and are armed only while
    // something reads them (P1): `S._wantLoopGapsUntil` is a deadline set by
    // wg.status(), the transport probe and Settings → Audio.
    const wantGaps = Date.now() < (S._wantLoopGapsUntil || 0);
    const d = await window.electronBridge.getOutputDepth(wantGaps);
    const sr = S.audioCtx?.sampleRate ?? 48000;
    _outDepthMs = d.blockFrames ? d.frames / sr * 1000 : 0;
    const dry = d.dry | 0, dropped = d.dropped | 0;
    if (dry > S.transportDiag.outDry) dlog('transport', 'output queue ran dry — a hole played, re-primed', { holes: dry - S.transportDiag.outDry, total: dry });
    if (dropped > S.transportDiag.outDropped) dlog('transport', 'output blocks skipped — a lead past the cushion', { blocks: dropped - S.transportDiag.outDropped, total: dropped });
    S.transportDiag.outDry = dry;
    S.transportDiag.outDropped = dropped;
    // The audio host's event-loop gaps and holders (R6, R2): the loop the
    // hops live on — a gap past the cushion there is a hole. The max is the
    // max ever seen; the counts are since load. `d.main` is the browser
    // thread's own loop, kept for the record.
    const td = S.transportDiag;
    if (d.loopGapMaxMs > td.hostGapMaxMs) td.hostGapMaxMs = d.loopGapMaxMs;
    td.hostGaps10 = d.loopGaps10 | 0; td.hostGaps20 = d.loopGaps20 | 0;
    if (d.slow) td.hostSlow = d.slow;                              // [name, maxMs, over10] ×8
    if (d.gcMaxMs > td.hostGcMaxMs) td.hostGcMaxMs = d.gcMaxMs;
    td.hostGcOver10 = d.gcOver10 | 0;
    const m = d.main || {};
    if (m.loopGapMaxMs > td.mainGapMaxMs) td.mainGapMaxMs = m.loopGapMaxMs;
    td.mainGaps10 = m.loopGaps10 | 0; td.mainGaps20 = m.loopGaps20 | 0;
    if (m.slow) td.mainSlow = m.slow;
  } catch (_) {}
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

  // Register worklets once (addModule is idempotent after first call)
  await actx.audioWorklet.addModule('js/worklets/quad-capture.worklet.js');
  await ceilingReady(actx);

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

  // Web Audio spec caps createChannelMerger at 32 inputs.  If the device
  // reports more (e.g. Yamaha TF5 = 34), clamp the Web Audio side to 32.
  // RtAudio still opens the full device channel count; channels 33+ simply
  // won't carry audio from the Web Audio graph (typically unused aux buses).
  const WEB_AUDIO_MAX_CH = 32;
  const n = Math.min(WEB_AUDIO_MAX_CH, Math.max(1, numChannels));

  // One GainNode bus per speaker.
  // For stereo (n=2) use the standard L/R arrangement: 270° (left) and 90° (right).
  // For n=1 (mono) use 0° (front).
  // For odd counts (3,5,7…): speaker 1 sits at 0° (true front center), rest CW.
  // For even counts ≥4: offset by −half-step so 0° is phantom center between the
  //   two front speakers (speaker 1 = front-left, speaker 2 = front-right),
  //   consistent with stereo convention (ch 1 = L).
  //   e.g. 8ch → 337.5°, 22.5°, 67.5°, 112.5°, 157.5°, 202.5°, 247.5°, 292.5°
  function speakerAngleDeg(i, total) {
    if (total === 1) return 0;
    if (total === 2) return i === 0 ? 270 : 90;   // 270 = left, 90 = right
    const step   = 360 / total;
    const offset = (total % 2 === 0) ? -step / 2 : 0;  // phantom center for even
    return ((step * i + offset) % 360 + 360) % 360;
  }

  // ── Split house / stereo mixdown when S.stereoMixdownEnabled is on ────────
  // When stereoMixdownEnabled: the last 2 physical channels are reserved for the
  // stereo mixdown bus pair (cursor grains).  S.numHouseSpeakers defines how many
  // channels carry the VBAP spatial field — capped at n-2 so mixdown always fits.
  // When stereoMixdownEnabled is false: all n channels are house; cursor grains
  // use the stereo monitorBus path (monitorBus → masterGain → destination).
  // Guard: mixdown needs at least 4 channels (2 house + 2 mixdown).  If saved
  // state says mixdown=on but hardware only has 2 channels (e.g. switched from
  // an interface to built-in stereo), force it off so the graph isn't broken.
  if (S.stereoMixdownEnabled === true && n < 4) {
    S.stereoMixdownEnabled = false;
  }
  const requestedHouse  = S.numHouseSpeakers ?? 2;
  const hasMonitorCh    = S.stereoMixdownEnabled === true && n >= 4;
  const numHouseCh      = hasMonitorCh
    ? Math.max(1, Math.min(requestedHouse, n - 2))
    : Math.min(requestedHouse, n);
  // Physical output channels for the stereo mixdown L/R buses.
  // Default: immediately after the last house channel (numHouseCh, numHouseCh+1).
  const hpPhysL = hasMonitorCh ? (S.headphoneRouting?.[0] ?? numHouseCh)     : -1;
  const hpPhysR = hasMonitorCh ? (S.headphoneRouting?.[1] ?? numHouseCh + 1) : -1;

  // Same default as masterGain: this is where master lives on the Electron
  // path, so a different fallback here would make the two paths disagree.
  const busGainInit = S.isMuted ? 0 : (S.outputGainValue ?? MASTER_DEFAULT_GAIN);
  const custom = S.customSpeakerAngles;  // null or array of degrees
  const buses = Array.from({ length: numHouseCh }, (_, i) => {
    const angleDeg = (custom && typeof custom[i] === 'number')
      ? ((custom[i] % 360) + 360) % 360
      : speakerAngleDeg(i, numHouseCh);
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
  // dryGainNode → dryAnalyser may not exist yet on first startup (created in
  // ensureAudioContext on mic grant).  wireDryVBAP() is called here and again
  // from requestMicAccess / ensureAudioContext once the dry chain is live.
  {
    const numSpeakers = buses.length;
    const dryVBAP = Array.from({ length: numSpeakers }, () => {
      const g = actx.createGain();
      g.gain.value = 0;  // will be set by updateDryMonitorPanning
      return g;
    });
    // Wire output side unconditionally (gain → speaker bus)
    dryVBAP.forEach((g, i) => g.connect(buses[i].bus));
    S.dryVBAPGains = dryVBAP;

    // Wire input side (dryAnalyser → gains) if analyser exists now;
    // otherwise _wireDryVBAPInput() will be called later once it does.
    if (S.dryAnalyser) _wireDryVBAPInput();

    // Dry → headphone mixdown (when stereo mixdown is active).
    // Pan dry signal by cursor azimuth into L/R headphone pair, same as
    // the house fold-down approach.  Uses dedicated input gain nodes so the
    // dry level in the headphone mix tracks the house dry level by default.
    if (hasMonitorCh) {
      const dryMixL = actx.createGain(); dryMixL.gain.value = 0.707;
      const dryMixR = actx.createGain(); dryMixR.gain.value = 0.707;
      if (S.dryAnalyser) {
        S.dryAnalyser.connect(dryMixL);
        S.dryAnalyser.connect(dryMixR);
      }
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
    // Bound by n (hardware channels), NOT numHouseCh (how many buses exist).
    // Those are different numbers the moment routing is non-identity: a hex rig
    // on a MOTU UltraLite mk4 has to sit on outs 3–8 (computer 1–2 are the Main
    // Out pair, the six analog jacks start at computer 3), so destCh reaches 7
    // while numHouseCh is 6. The old `< numHouseCh` guard silently dropped the
    // last two positions — and the speaker sweep still sounded correct on them,
    // because playSweepChannel writes straight to the merger and bounds itself
    // by numChannels. Revert: restore `destCh < numHouseCh`.
    if (destCh >= 0 && destCh < n) bus.connect(_merger, 0, destCh);
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

  // THE CEILING, last before the audio leaves for the interface (2026-09-14).
  // Same node as the browser chain's — nothing downstream of this point can
  // undo a clip, because the next stop is the converter. Linked across all N
  // channels so it cannot pull a VBAP pair's image sideways.
  // THE HOUSE AND THE HEADPHONES ARE NOT ONE LINK GROUP (2026-09-14). They
  // are different destinations sharing one interface, so a hot monitor mix
  // must not duck the room and a loud room must not duck the player. Group 0
  // is the house, group 1 the monitor pair at whatever physical channels the
  // headphone routing put them on.
  const ceilGroups = new Array(n).fill(0);
  if (hasMonitorCh) {
    if (hpPhysL >= 0 && hpPhysL < n) ceilGroups[hpPhysL] = 1;
    if (hpPhysR >= 0 && hpPhysR < n) ceilGroups[hpPhysR] = 1;
  }
  const ceil = makeCeilingNode(actx, n, ceilGroups);
  if (ceil) { _merger.connect(ceil); ceil.connect(_captureNode); S._outputCeiling = ceil; }
  else { _merger.connect(_captureNode); console.warn('[audio] ceiling node unavailable — output runs unprotected'); }

  // Main regulates the queue to the cushion (electron-main.js); this side
  // tells it the cushion, and polls the depth and the faults once a second.
  window.electronBridge.setAudioCushion?.(S.audioCushionMs ?? 10);
  if (!_outDepthTimer) _outDepthTimer = setInterval(_pollOutputDepth, 1000);
  // The direct port to the main process, transferred into the worklet. Until
  // it arrives the worklet drops its blocks unheard; if the graph was rebuilt
  // meanwhile the port belongs to nobody and is closed.
  {
    const node = _captureNode;
    try {
      const port = await requestAudioPort('out');
      if (_captureNode === node) node.port.postMessage({ type: 'port', port }, [port]);
      else { try { port.close(); } catch (_) {} }
    } catch (e) {
      console.warn('[audio] output port:', e.message);
    }
  }

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

  // Pre-compute VBAP lookup table for O(1) speaker pair resolution
  buildVBAPLookup(buses);

  // If the worklet grain engine is running, re-send the VBAP LUT so it
  // uses the new speaker layout.  Uses a callback to avoid circular import.
  S._onVBAPRebuilt?.(n);


  // Notify the main window that channel count changed so it can rebuild the meter strip.
  // Uses a callback on S to avoid a circular import with renderer.js.
  S._onSpeakerBusesReady?.(n);

  const houseDesc   = buses.map(b => b.angleDeg.toFixed(0) + '°').join(', ');
  const mixdownDesc = hasMonitorCh ? ` | stereo mixdown: ch ${hpPhysL}(L) ch ${hpPhysR}(R)` : '';
  DEBUG && console.log(`Speaker buses ready — ${n} ch, house[${numHouseCh}]: [${houseDesc}]${mixdownDesc} → audify`);
}

// ── Deferred dry VBAP wiring ─────────────────────────────────────────────────
// On Electron startup, initSpeakerBuses runs before mic grant, so S.dryAnalyser
// doesn't exist yet.  This function wires (or re-wires) the input side of the
// dry VBAP fan-out once the analyser is available.  Safe to call multiple times.
// Snapshot the gains array at wire time so a concurrent initSpeakerBuses()
// teardown doesn't leave the analyser connected to orphaned nodes.
function _wireDryVBAPInput() {
  if (!S.dryAnalyser || !S.dryVBAPGains?.length) return;
  const gains = S.dryVBAPGains;   // capture reference
  const mixin = S.dryMixdownInputs;
  // Defer to next microtask so any in-progress initSpeakerBuses() finishes
  // tearing down old nodes first.  Re-check that our captured reference is
  // still the live one before wiring — if initSpeakerBuses ran in between,
  // gains !== S.dryVBAPGains and we skip the stale nodes.
  queueMicrotask(() => {
    if (!S.dryAnalyser || gains !== S.dryVBAPGains) return;
    gains.forEach(g => S.dryAnalyser.connect(g));
    if (mixin && mixin === S.dryMixdownInputs) {
      mixin.forEach(g => S.dryAnalyser.connect(g));
    }
  });
}
// ── Dry monitor panning update ────────────────────────────────────────────────
// Called once per metering frame (≈30fps) to rewrite the dry signal's VBAP gains
// (or stereo pan) based on the current cursor position.  Must be cheap: no
// allocations, no scheduler interaction.  Uses cursor position → spatial mapping.
const _dryW = new Float32Array(3);  // scratch: world coords
const _dryC = new Float32Array(3);  // scratch: camera coords
// Cache last-written VBAP targets so we skip redundant setTargetAtTime calls.
// Without this, 30 ramps/sec with 30ms time constant stack up under frame
// jitter, causing zipper/granulation noise on the dry monitor signal.
let _dryLastTargets = null;  // Float32Array(n) for VBAP, or null
let _dryLastPanL = -999, _dryLastPanR = -999;  // for mixdown
let _dryLastStereoPan = -999;  // for browser stereo path
const _DRY_EPSILON = 0.005;  // threshold below which we skip updates

export function updateDryMonitorPanning() {
  if (!S.dryMonitorEnabled) return;
  if (!S.audioCtx || S.audioCtx.state !== 'running') return;

  const { lon, lat } = cursorLonLatNow();

  spherePointInto(lon, lat, _dryW);
  const wx = _dryW[0], wy = _dryW[1], wz = _dryW[2];

  let cx, cy, cz;
  if (S.spatialPanning === 'worldlocked') {
    cx = wx; cy = wy; cz = wz;
  } else {
    cameraRotateInto(wx, wy, wz, _dryC);
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

    // Elevation-dependent center bias: with a horizontal speaker ring,
    // sources near the poles have ambiguous azimuth.  Blend ALL speakers
    // toward equal-power as |elevation| increases so the image spreads
    // across the full ring rather than locking to one pair.
    const elevFrac = Math.abs(cy) * (1 / SPHERE_RADIUS);
    const elevBias = elevFrac * elevFrac;                  // sin²(el)
    const eqGain   = 1 / Math.sqrt(n);
    if (elevBias > 0.01) {
      wA = wA + (eqGain - wA) * elevBias;
      wB = wB + (eqGain - wB) * elevBias;
    }

    // Set per-speaker gains: bracketing pair gets blended VBAP weights,
    // all other speakers fade in toward eqGain as elevation increases.
    // Skip speakers whose target hasn't changed meaningfully — prevents
    // stacking 30 overlapping ramps/sec that cause zipper noise.
    if (!_dryLastTargets || _dryLastTargets.length !== n) {
      _dryLastTargets = new Float32Array(n);
      _dryLastTargets.fill(-1); // force first update
    }
    for (let i = 0; i < n; i++) {
      let target;
      if (i === idxA)       target = wA;
      else if (i === idxB)  target = wB;
      else                  target = elevBias > 0.01 ? eqGain * elevBias : 0;
      if (Math.abs(target - _dryLastTargets[i]) > _DRY_EPSILON) {
        S.dryVBAPGains[i].gain.setTargetAtTime(target, t, RAMP);
        _dryLastTargets[i] = target;
      }
    }

    // Update headphone mixdown L/R panning for dry signal
    // Apply elevation center-bias to the stereo image too
    if (S.dryMixdownInputs) {
      const rawPan = cz !== 0 ? Math.max(-1, Math.min(1, cx / Math.abs(cz))) : 0;
      const pan = rawPan * (1 - elevBias);  // collapse toward center at poles
      const lW  = Math.cos((pan + 1) * Math.PI / 4);
      const rW  = Math.sin((pan + 1) * Math.PI / 4);
      if (Math.abs(lW - _dryLastPanL) > _DRY_EPSILON || Math.abs(rW - _dryLastPanR) > _DRY_EPSILON) {
        S.dryMixdownInputs[0].gain.setTargetAtTime(lW, t, RAMP);
        S.dryMixdownInputs[1].gain.setTargetAtTime(rW, t, RAMP);
        _dryLastPanL = lW;
        _dryLastPanR = rW;
      }
    }

  // ── Stereo path (browser) ───────────────────────────────────────────────
  } else if (S.dryPanner) {
    const rawPan = cz !== 0 ? Math.max(-1, Math.min(1, cx / Math.abs(cz))) : 0;
    // Elevation center-bias: collapse toward center at poles (worldlocked only)
    const dryElF = S.spatialPanning === 'worldlocked' ? Math.abs(cy) * (1 / SPHERE_RADIUS) : 0;
    const dryPan = rawPan * (1 - dryElF * dryElF);
    if (Math.abs(dryPan - _dryLastStereoPan) > _DRY_EPSILON) {
      S.dryPanner.pan.setTargetAtTime(dryPan, t, RAMP);
      _dryLastStereoPan = dryPan;
    }
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
  // Assigning slider.value fires no `input` event, so the main-UI audio
  // panel's mirror listener never runs — push it explicitly.
  S._syncAudioPanelLevels?.();
}

// The gain-side applier. Nothing outside this file should call it directly:
// the setting is setDryMonitorMode, and this is what the mode resolves to.
function setDryMonitorEnabled(on) {
  S.dryMonitorEnabled = on;
  const t = S.audioCtx?.currentTime ?? 0;
  if (S.dryGainNode) {
    S.dryGainNode.gain.setTargetAtTime(
      on ? S.dryMonitorGainValue : 0, t, 0.02
    );
  }
  S._syncDryMonitorUI?.();
}

// ── Dry monitor mode — off | on | auto (#245) ────────────────────────────────
// auto rests ON and ducks for the length of a GRANULAR recording only. The
// duck is scoped to one live recording: startLiveRecording asks, and
// stopLiveRecording restores — never a frame later, never across strokes.
// An explicit off/on set mid-recording wins immediately and drops the duck.
let _dryAutoDucked = false;

export function setDryMonitorMode(mode) {
  if (mode !== 'off' && mode !== 'on' && mode !== 'auto') return;
  S.dryMonitorMode = mode;
  _dryAutoDucked = false;
  setDryMonitorEnabled(mode === 'on' || mode === 'auto');
  // The signal-path drawing shows this branch and its switch, so it is
  // redrawn from here (Ek, 2026-09-14: "it should change when it's off or
  // auto or on"). The diagram was hooked only to the send set, so the mode
  // moved and the picture did not — measured: identical SVG text across
  // off · on · auto.
  S._redrawSignalPath?.();
}

export function isDryMonitorDucked() { return _dryAutoDucked; }

// Which engine the recording that is starting belongs to. The tile in the
// HAND is the authority (the whole test, per #245) — it was the SELECTED tile
// until arming went on 2026-09-11, which was the same tile then and is the
// drawer's now; a recording belongs to what is playing it. An erase tile in
// the hand says nothing about a stroke, so fall back to the stroke's own
// flags: a trigger recording or a loop commit mode is a TAPE take, anything
// else is granular. (`commitMode === 'loop'` is the PIN kind and keeps that
// name — a loop is a pinned tape that repeats.)
function _recordingEngine() {
  const eng = S._handEngine?.();
  if (eng === 'tape' || eng === 'granular') return eng;
  return (S._recordingTrigger || S.commitMode === 'loop') ? 'tape' : 'granular';
}

function _dryMonitorRecordStart() {
  if (S.dryMonitorMode !== 'auto') return;
  if (_recordingEngine() !== 'granular') return;
  _dryAutoDucked = true;
  setDryMonitorEnabled(false);
}

function _dryMonitorRecordEnd() {
  if (!_dryAutoDucked) return;
  _dryAutoDucked = false;
  if (S.dryMonitorMode === 'auto') setDryMonitorEnabled(true);
}
S._setDryMonitorMode = setDryMonitorMode;

// ── Speaker sweep helper ──────────────────────────────────────────────────────
// Plays a short noise burst on a single physical output channel, bypassing all
// VBAP buses and routing tables.  Used by the audio settings sweep function.
// Returns a Promise that resolves when the burst finishes.
/** A node that reaches EVERY physical output the app drives — what the
 *  latency calibration plays its clicks into (js/latency.js). In Electron the
 *  interface hears only the channel merger (the master bus stops at the
 *  analyser there: RtAudio owns the output), so a gain fanned to every merger
 *  input; in the browser, the master bus. Null when there is no output yet. */
export function calibrationOutput() {
  const actx = ensureAudioContext();
  if (_merger) {
    const n = S.speakerBuses?.numChannels ?? 0;
    if (n <= 0) return null;
    const g = actx.createGain();
    g.gain.value = 1;
    for (let ch = 0; ch < n; ch++) g.connect(_merger, 0, ch);
    return g;
  }
  return window.electronBridge ? null : getMasterBus();
}

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
  // Hardware channel count, not bus count — see the same guard in
  // initSpeakerBuses. `.length` is how many speakers you have; `.numChannels` is
  // how many outputs the interface has, and the routing dropdowns offer all of
  // them. Falling back to .length keeps the old behaviour if numChannels is
  // somehow unset, which is still safer than an out-of-range connect.
  const n = S.speakerBuses.numChannels ?? S.speakerBuses.length;
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
  // Wall-clock for particle timestamps — stays in sync with the AnalyserNode
  // that provides RMS/feature snapshots.  recordingWritePos updates in ~43ms
  // batches (2048 samples), so using it here shifts grainStart ~3 particles
  // behind the analyser features, making visual particle size misalign with
  // the actual audio.  The loop-end precision issue is solved by the reorder
  // fix (stopLiveRecording finalises the buffer before createSeqFromStroke).
  return (performance.now() - S.recordingStartTime) / 1000;
}

// The provisional take: ONE record for the life of the app, a VIEW over the
// raw pool (2026-09-17). Until then this was an AudioBuffer the raw samples
// were copied into every 200 ms, grown by doubling and retained across takes
// — a second copy of the take being recorded, up to twice its size. Readers
// (`slot.liveBuffer`) see the same shape as a sealed take (js/take.js); the
// bridge keys the worklet's provisional index on this object's identity.
const _liveTake = { data: null, sampleRate: 0, length: 0, duration: 0 };

export function rebuildLiveBuffer() {
  // Re-cut the provisional take to what has landed, so grains and the
  // tape tools can read the recording while it runs. Also registered as
  // S._flushLiveBuffer so the grain scheduler can flush before posting
  // candidates (minimises frontier latency).
  // Throttled to LIVE_REBUILD_INTERVAL_MS — a subarray is a view, no copy.
  if (!S.isRecording || S.recordingWritePos === 0) return;
  if (S.recordingWritePos === S.liveBufferSampleCount) return;

  const now = performance.now();
  if (now - S.lastLiveRebuildTime < LIVE_REBUILD_INTERVAL_MS) return;
  S.lastLiveRebuildTime = now;

  const len = S.recordingWritePos;
  _liveTake.data       = S.recordingRaw.subarray(0, len);
  _liveTake.sampleRate = S.recordingSampleRate;
  _liveTake.length     = len;
  _liveTake.duration   = len / S.recordingSampleRate;
  S.liveBufferSampleCount = len;

  if (S.currentLiveBufferIdx >= 0 && S.currentLiveBufferIdx < S.liveRecBuffers.length) {
    S.liveRecBuffers[S.currentLiveBufferIdx].liveBuffer = _liveTake;
    S.liveRecBuffers[S.currentLiveBufferIdx].duration   = _liveTake.duration;
  }

  // Stream the updated liveBuffer data to the worklet engine (delta append)
  S._onLiveBufferRebuilt?.();
}
// Register on S so the grain scheduler can flush before posting candidates.
S._flushLiveBuffer = rebuildLiveBuffer;

// ── Mic button label ────────────────────────────────────────────────────────

export function setMicBtnLabel(text) {
  // Updates only the label span, preserving SVG icon and dot
  const btn = document.getElementById('micEnableBtn');
  if (!btn) return;
  const span = btn.querySelector('span:last-child');
  if (span) span.textContent = text;
}
