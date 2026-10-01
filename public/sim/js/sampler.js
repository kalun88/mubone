// ============================================================================
// sampler.js — the sample instrument: pads on the input (Ek, 2026-09-30)
//
// Each loaded sample is a PAD on its own key (`sampler_play_N`, dealt 1–0 as
// slots fill — midi.js seedSamplerKey). The pads play into the same input the
// mic feeds, so the hand records them; see playPad below and audio.js
// connectInputTap. (Until 2026-09-30 a sample was a SOURCE the brush inked
// from, switched in place of the mic — #247.)
//
// Capture (record-into-sampler) is prep-time and gesture-free — a MIDI press
// or a button, never the sensor. The start/stop cores live in audio.js (they
// own the recording singletons); this module turns the returned AudioBuffer
// into a sample slot. While either recording family runs, the other refuses
// — one rule, easy to trust.
// ============================================================================

import { S, MAX_SAMPLES, DEBUG } from './state.js';
import { ensureAudioContext, startSamplerCapture, stopSamplerCapture } from './audio.js';
import { makeTake } from './take.js';
import { rebuildSampleListUI } from './ui-samples.js';
import { hotSwapSample } from './grain-worklet-bridge.js';

function _refuse(why) {
  DEBUG && console.log('[sampler] refused:', why);
  S._samplerRefused?.(why);   // UI flash, wired by the source tiles
}

// ── A sample is a PAD (Ek, 2026-09-30) ─────────────────────────────────────
// "if the mic is on, each sample can have a key assigned so it's like playing
// a sampler instrument." A key plays its slot once through, into the input the
// mic feeds (audio.js connectInputTap), so the hand records it like it records
// the player: a pad still sounding when the hand goes down makes a sample
// stroke with the mic out; a pad played during a mic stroke layers onto it.
// There is no source to switch — that was the park switch, `S.sourceKind`,
// the sheet's file/mic switch and a stroke of its own that built its take from
// the crop (samplerTrace), all gone the same day. The voice is ui-samples.js
// playSample, the same one the sheet's ▶ starts.

/** The `sampler_play_N` action (a hold): slot n (1-based) from its top. A
 *  press restarts a slot already playing, like a drum pad. HELD, IT LOOPS (Ek,
 *  2026-09-30: "if i hold down the sample key shouldnt it keep playing on
 *  loop?"): the voice starts looping and the release stops the looping, so the
 *  pass under way plays out to its end. A tap is therefore a one-shot and a
 *  hold a loop, with no window deciding which — the release does the same
 *  thing either way. */
export function playPad(n, down = true) {
  const idx = Math.round(n) - 1;
  if (!down) { S._releaseSample?.(idx); return; }
  if (!S.samples[idx]?.buffer) { _refuse('slot ' + n + ' empty'); return; }
  S._playSample?.(idx, { restart: true, loop: true });
}

let _takeCounter = 0;

// A finished capture becomes a sample slot — same shape loadAudioFile pushes,
// registered with any running engine so it paints immediately.
function _finishCapture() {
  // The buffer arrives a few ms after the stop, once the recorder's last
  // bundle has landed (audio.js, sealing).
  const fromApp = S.samplerCaptureFrom === 'app';
  stopSamplerCapture((buffer) => {
    if (!buffer) return;
    _takeCounter++;
    S.samples.push({
      buffer,
      // A RESAMPLE says so: it is the instrument's own sound, not the input.
      name:       `${fromApp ? 'resample' : 'take'} ${_takeCounter} — ${buffer.duration.toFixed(1)}s`,
      duration:   buffer.duration,
      grainCursor: 0,
      cropStart:  0,
      cropEnd:    1,
    });
    S._seedSamplerKey?.(S.samples.length);
    hotSwapSample(buffer);
    rebuildSampleListUI();
    S._renderSourceUI?.();
    DEBUG && console.log(`[sampler] captured ${buffer.duration.toFixed(2)}s into slot ${S.samples.length}`);
  });
}

// ── Test sounds ─────────────────────────────────────────────────────────────
// Three synthesized samples with deliberately different characters, so the
// sampler (a testing tool, § 1g) can be exercised with no files at hand:
// plucks for attacks (chop/line), a swelling FM pad for sustained brightness
// (staff/match), a filtered bass line for rhythmic level jumps. Pure math
// into AudioBuffers — nothing shipped, nothing fetched.
function _synthTestBuffers(actx) {
  const sr = actx.sampleRate;

  const mk = (sec, fill) => {
    const d = new Float32Array(Math.floor(sr * sec));
    fill(d, sr);
    return makeTake(d, sr);
  };

  // 1. pluck arp — Karplus–Strong on a minor pentatonic, one pluck per 300 ms.
  const pluck = mk(2.4, (d, sr) => {
    const notes = [110, 130.8, 146.8, 164.8, 196, 220, 196, 146.8];
    notes.forEach((f, n) => {
      const start = Math.floor(n * 0.3 * sr);
      const period = Math.round(sr / f);
      const ring = new Float32Array(period);
      for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
      let idx = 0;
      const len = Math.min(Math.floor(0.55 * sr), d.length - start);
      for (let i = 0; i < len; i++) {
        const cur = ring[idx];
        const nxt = ring[(idx + 1) % period];
        ring[idx] = (cur + nxt) * 0.499;          // lossy average = string decay
        d[start + i] += cur * 0.6;
        idx = (idx + 1) % period;
      }
    });
  });

  // 2. fm pad — slow swell, modulation index rises then falls so the
  // brightness genuinely evolves over the take.
  const pad = mk(3.0, (d, sr) => {
    const fc = 220, ratio = 1.5;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr, u = t / 3.0;
      const env = Math.sin(Math.PI * u) ** 1.5;                    // swell in/out
      const index = 4 * Math.sin(Math.PI * u);                     // brightness arc
      const mod = Math.sin(2 * Math.PI * fc * ratio * t) * index;
      d[i] = (Math.sin(2 * Math.PI * fc * t + mod) * 0.5
            + Math.sin(2 * Math.PI * (fc / 2) * t + mod * 0.3) * 0.25) * env * 0.55;
    }
  });

  // 3. acid bass — eighth-note square line through a resonant-ish sweep,
  // faked with a one-pole lowpass whose cutoff rides a per-note envelope.
  const bass = mk(2.4, (d, sr) => {
    const seq = [55, 55, 82.4, 55, 65.4, 55, 110, 82.4];
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const step = Math.min(seq.length - 1, Math.floor(t / 0.3));
      const tin = t - step * 0.3;
      const f = seq[step];
      const sq = Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.7
               + Math.sin(2 * Math.PI * f * 2 * t) * 0.15;
      const cutoff = 200 + 2600 * Math.exp(-tin * 9);              // filter pluck
      const a = 1 - Math.exp(-2 * Math.PI * cutoff / sr);
      lp += a * (sq - lp);
      d[i] = lp * Math.exp(-tin * 2.5) * 0.7;
    }
  });

  return [
    { buffer: pluck, name: 'test pluck' },
    { buffer: pad,   name: 'test pad'   },
    { buffer: bass,  name: 'test bass'  },
  ];
}

/** Load the three synthesized test sounds into free slots (skips any already
 *  loaded by name), each on its slot's key. */
export function loadTestSamples() {
  const actx = ensureAudioContext();
  const have = new Set(S.samples.map(s => s.name));
  for (const t of _synthTestBuffers(actx)) {
    if (have.has(t.name)) continue;
    if (S.samples.length >= MAX_SAMPLES) { _refuse('all sampler slots full'); break; }
    S.samples.push({ buffer: t.buffer, name: t.name, duration: t.buffer.duration,
                     grainCursor: 0, cropStart: 0, cropEnd: 1 });
    hotSwapSample(t.buffer);
    S._seedSamplerKey?.(S.samples.length);
  }
  rebuildSampleListUI();
  S._renderSourceUI?.();
}

/** The sampler_record / sampler_resample actions (type 'hold'): press
 *  starts, release stops. `from` 'input' is the live input, 'app' what
 *  mubone plays (audio.js resampleBus). One capture at a time, either kind. */
export function captureHold(pressed, from = 'input') {
  if (pressed) startSamplerCapture(from);
  else if (S.isSamplerCapturing && S.samplerCaptureFrom === from) _finishCapture();
}

/** The sheet's two record buttons: one click starts, the next stops — a
 *  click on either stops whichever capture is running. */
export function captureToggle(from = 'input') {
  if (S.isSamplerCapturing) _finishCapture();
  else startSamplerCapture(from);
}

// House pattern: dispatch (midi.js/osc.js) reaches us through S, not imports.
S._samplerPad          = playPad;
S._samplerCaptureHold  = captureHold;
S._samplerCaptureToggle = captureToggle;
S._samplerLoadTestSamples = loadTestSamples;
