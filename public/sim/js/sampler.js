// ============================================================================
// sampler.js — the sample instrument is an INPUT, not a brush (#247)
//
// BRUSH-MODEL § 1g: the chain is source → brush → lens. This module owns the
// source half — which input the brush inks from (S.sourceKind) and the
// sampler's current sample (S.samplerIndex, sampler-internal, never -1).
//
// samplerTrace() is the ported body of the old paint1–paint10 actions: the
// primary gesture reaches it through brush.js `_toolDown` when the sampler is
// the source, so ANY brush paints from the current sample. The old actions'
// per-slot press/release (and their transient activeSampleIndex) are gone.
//
// Capture (record-into-sampler) is prep-time and gesture-free — a MIDI press
// or a button, never the sensor. The start/stop cores live in audio.js (they
// own the recording singletons); this module turns the returned AudioBuffer
// into a sample slot. While either recording family runs, the other refuses
// — one rule, easy to trust.
// ============================================================================

import { S, MAX_SAMPLES, DEBUG, perf, gp } from './state.js';
import { ensureAudioContext, getPreviewSinks, startSamplerCapture, stopSamplerCapture } from './audio.js';
import { recordStrokeStart, rebuildSampleListUI } from './ui-samples.js';
import { createSeqFromStroke } from './ui-presets.js';
import { setScanMuted } from './ui-meters.js';
import { hotSwapSample } from './grain-worklet-bridge.js';
import { armTrigger } from './trigger.js';

function _refuse(why) {
  DEBUG && console.log('[sampler] refused:', why);
  S._samplerRefused?.(why);   // UI flash, wired by the source tiles
}

/** Which input the brush inks from. Refused mid-stroke — switching the source
 *  under a live recording would orphan the capture path's singletons. */
export function selectSource(kind) {
  if (kind !== 'live' && kind !== 'sampler') return;
  if (S.sourceKind === kind) return;
  if (S.isPainting || S.isRecording || S.isSamplerCapturing) { _refuse('mid-stroke'); return; }
  S.sourceKind = kind;
  S._renderSourceUI?.();
}

/** Set the sampler's current sample. v = 1..MAX_SAMPLES picks that slot
 *  (refused if empty — honest, not helpful), anything else cycles to the
 *  next loaded slot. */
export function selectSample(v) {
  const n = Math.round(v);
  if (n >= 1 && n <= MAX_SAMPLES) {
    const idx = n - 1;
    if (!S.samples[idx]?.buffer) { _refuse('slot ' + n + ' empty'); return; }
    S.samplerIndex = idx;
  } else {
    const len = S.samples.length;
    if (!len) { _refuse('no samples loaded'); return; }
    for (let i = 1; i <= len; i++) {
      const idx = (S.samplerIndex + i) % len;
      if (S.samples[idx]?.buffer) { S.samplerIndex = idx; break; }
    }
  }
  S._renderSourceUI?.();
}

// ── Monitor voice — hear the sample playing in (Ek, 2026-08-28) ─────────────
// A loop-engine stroke mutes the scan (below), which is right for a live
// source: the instrument is acoustic, you hear it anyway, and the take is
// what you played. The sampler's "instrument" is a buffer — with the scan
// off nothing plays it, so a line or slice from the sampler was silent
// until release. This voice is the dry monitor's analogue for the sampler:
// the crop looped audibly for exactly the held duration, the same audio the
// take materializes (_materializeSamplerTake reads crop[i % cropLen] from
// the stroke's t=0), routed where the sample preview goes. Granular strokes
// deliberately get none of this — there you hear the grains forming, not
// the sample doubled.
let _monitor = null;   // { source, gain } while a loop-engine stroke is held

function _startMonitor(s) {
  _stopMonitor();
  const actx    = ensureAudioContext();
  const crop0   = s.cropStart * s.duration;
  const cropLen = Math.max(0.01, (s.cropEnd - s.cropStart) * s.duration);
  const source  = actx.createBufferSource();
  source.buffer    = s.buffer;
  source.loop      = true;
  source.loopStart = crop0;
  source.loopEnd   = crop0 + cropLen;
  const gain = actx.createGain();
  gain.gain.value = gp().volume;
  source.connect(gain);
  for (const sink of getPreviewSinks()) gain.connect(sink);
  source.start(actx.currentTime, crop0);
  _monitor = { source, gain };
}

function _stopMonitor() {
  if (!_monitor) return;
  const { source, gain } = _monitor;
  _monitor = null;
  const actx = S.audioCtx;
  const t = actx?.currentTime ?? 0;
  // Short release rather than a hard stop — the loop is mid-waveform.
  try {
    gain.gain.setTargetAtTime(0, t, 0.01);
    source.stop(t + 0.06);
  } catch (_) { try { source.stop(); } catch (_) {} }
  source.onended = () => { try { source.disconnect(); gain.disconnect(); } catch (_) {} };
}

// ── Take materialization — "the sampler is audio playing in" (Ek) ──────────
// A loop-engine stroke held past its sample LOOPS it, and the take is the
// LOOPED AUDIO for exactly as long as the hold: on release the stroke gets
// its own buffer — the crop repeated for the held duration — and converts to
// an ordinary live-style stroke (source 'live', its own liveRecBuffers slot,
// grainStart = the stroke's clock). One playhead travels the whole line, the
// audio is the loop repeating, and slice/erase/undo/export all behave exactly
// as they do for a real recording, because from here on it IS one. The
// reference model (marks pointing into the shared sample) stays for the pen,
// where a mark is an onset and the distinction is inaudible.
function _materializeSamplerTake(strokeId) {
  const marks = S.particles.filter(p => p.strokeId === strokeId && p.source === 'sample');
  if (!marks.length) return false;
  const s = S.samples[marks[0].sampleIndex];
  if (!s?.buffer) return false;

  const actx  = ensureAudioContext();
  const sr    = s.buffer.sampleRate;
  const crop0 = s.cropStart * s.duration;
  const cropLen = Math.max(0.01, (s.cropEnd - s.cropStart) * s.duration);
  const tick  = (S.paintTicker?.intervalMs ?? 50) / 1000;
  let takeDur = Math.max(...marks.map(p => p.takeT ?? 0)) + tick;
  // Same memory ceiling as a live recording — a held pedal must not
  // silently allocate minutes of audio.
  const budget = Math.max(1, (S.recLimitSeconds ?? 180) - (perf.recTotalSec ?? 0));
  if (takeDur > budget) { takeDur = budget; _refuse('rec limit — take clipped'); }

  const out = actx.createBuffer(1, Math.max(1, Math.ceil(takeDur * sr)), sr);
  const src = s.buffer.getChannelData(0);
  const dst = out.getChannelData(0);
  const c0  = Math.floor(crop0 * sr);
  const cN  = Math.max(1, Math.floor(cropLen * sr));
  for (let i = 0; i < dst.length; i++) dst[i] = src[c0 + (i % cN)] ?? 0;

  const idx = S.liveRecBuffers.length;
  S.liveRecBuffers.push({ buffer: out, grainCursor: 0 });
  for (const p of marks) {
    p.source        = 'live';
    p.liveBufferIdx = idx;
    p.grainStart    = Math.min(p.takeT ?? 0, Math.max(0, takeDur - 0.01));
    if (p.grainStart + p.grainDuration > takeDur) {
      p.grainDuration = Math.max(0.01, takeDur - p.grainStart);
    }
    delete p.sampleIndex;
    delete p.takeT;
  }
  // The undo entry was recorded as a bufferless 'sample' stroke — point it at
  // the slot so undo/redo treat the take like any live recording.
  for (let i = S.strokeHistory.length - 1; i >= 0; i--) {
    if (S.strokeHistory[i].strokeId === strokeId) {
      S.strokeHistory[i].type = 'live';
      S.strokeHistory[i].liveBufferIndex = idx;
      break;
    }
  }
  hotSwapSample(out);   // a running engine can read the take (dwell 'grain', clouds)
  S._particleVersion++;
  DEBUG && console.log(`[sampler] materialized ${takeDur.toFixed(2)}s take (slot ${idx})`);
  return true;
}

/** The primary gesture, sampler-sourced — the ported paint-action body.
 *  Reached from the main button (brush.js `_toolDown`); press starts a sample-paint stroke from
 *  the current sample, release ends it (making a loop under seq mode, same
 *  as a live stroke).
 *
 *  opts.trigger — the hit brush over the sampler source: the same stroke,
 *  but deposits are stamped `trig` (paint-ticker is source-agnostic there)
 *  and release ARMS the stroke instead of looping it — the old stamp's
 *  fires-on-touch, rebuilt as hit + sampler (#247 step 10). trigger.js
 *  already resolves sample-sourced particles (`bufferForParticle`). */
export function samplerTrace(pressed, opts) {
  if (pressed) {
    if (S.isPainting) return;
    const s = S.samples[S.samplerIndex];
    if (!s?.buffer) { _refuse('no sample in current slot'); return; }
    ensureAudioContext();
    // Ported verbatim from the old paintN handler — the || chain looks like a
    // mangled "unmute master, mute scan" and is preserved as-was (#247 flag).
    if (S.seqModeEnabled && !S.scanMuted) S._setMuted?.(false) || setScanMuted?.(true);
    s.grainCursor = s.cropStart * s.duration;
    if (opts?.trigger) { S._recordingTrigger = true; _startMonitor(s); }
    recordStrokeStart('sample');
    S.isPainting = true;
    // Cold-start worklet if not yet running (e.g. sample paint as first action)
    S._ensureWorkletForSample?.(s.buffer);
    S._syncTriggerRecUI?.();
  } else {
    if (!S.isPainting) return;
    const strokeId   = S.currentStrokeId;
    const wasTrigger = S._recordingTrigger;
    S._recordingTrigger = false;
    _stopMonitor();
    S.isPainting = false;
    S.currentStrokeId = -1;
    // Same precedence as _commitTraceStroke: a trigger stroke arms; only a
    // plain stroke loops under seq mode.
    if (wasTrigger && strokeId > 0) {
      // The take is the looped audio for the held duration — see
      // _materializeSamplerTake. Arm AFTER conversion so the trigger builds
      // over the take, not the crop.
      try { _materializeSamplerTake(strokeId); } catch (e) { DEBUG && console.warn('[sampler] materialize failed', e); }
      try { armTrigger(strokeId); } catch (_) {}
    } else if (S.seqModeEnabled && strokeId > 0) {
      try { createSeqFromStroke(strokeId); } catch (_) {}
    }
    S._syncTriggerRecUI?.();
  }
  const btn = document.getElementById('paintIndicatorBtn');
  if (btn) btn.classList.toggle('painting', S.isPainting);
}

let _takeCounter = 0;

// A finished capture becomes a sample slot — same shape loadAudioFile pushes,
// registered with any running engine so it paints immediately.
function _finishCapture() {
  // The buffer arrives a few ms after the stop, once the recorder's last
  // bundle has landed (audio.js, sealing).
  stopSamplerCapture((buffer) => {
    if (!buffer) return;
    _takeCounter++;
    S.samples.push({
      buffer,
      name:       `take ${_takeCounter} — ${buffer.duration.toFixed(1)}s`,
      duration:   buffer.duration,
      grainCursor: 0,
      cropStart:  0,
      cropEnd:    1,
    });
    S.samplerIndex = S.samples.length - 1;   // the fresh take is current
    hotSwapSample(buffer);
    rebuildSampleListUI();
    S._renderSourceUI?.();
    DEBUG && console.log(`[sampler] captured ${buffer.duration.toFixed(2)}s into slot ${S.samples.length}`);
  });
}

// ── Test sounds ─────────────────────────────────────────────────────────────
// Three synthesized samples with deliberately different characters, so the
// sampler (a testing tool, § 1g) can be exercised with no files at hand:
// plucks for attacks (chop/hit), a swelling FM pad for sustained brightness
// (staff/match), a filtered bass line for rhythmic level jumps. Pure math
// into AudioBuffers — nothing shipped, nothing fetched.
function _synthTestBuffers(actx) {
  const sr = actx.sampleRate;

  const mk = (sec, fill) => {
    const buf = actx.createBuffer(1, Math.floor(sr * sec), sr);
    fill(buf.getChannelData(0), sr);
    return buf;
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
 *  loaded by name) and make the first of them current. */
export function loadTestSamples() {
  const actx = ensureAudioContext();
  const have = new Set(S.samples.map(s => s.name));
  let firstNew = -1;
  for (const t of _synthTestBuffers(actx)) {
    if (have.has(t.name)) continue;
    if (S.samples.length >= MAX_SAMPLES) { _refuse('all sampler slots full'); break; }
    S.samples.push({ buffer: t.buffer, name: t.name, duration: t.buffer.duration,
                     grainCursor: 0, cropStart: 0, cropEnd: 1 });
    hotSwapSample(t.buffer);
    if (firstNew < 0) firstNew = S.samples.length - 1;
  }
  if (firstNew >= 0) S.samplerIndex = firstNew;
  rebuildSampleListUI();
  S._renderSourceUI?.();
}

/** The sampler_record action (type 'hold'): press starts, release stops. */
export function captureHold(pressed) {
  if (pressed) startSamplerCapture();
  else if (S.isSamplerCapturing) _finishCapture();
}

/** The UI record button: one click starts, the next stops. */
export function captureToggle() {
  if (S.isSamplerCapturing) _finishCapture();
  else startSamplerCapture();
}

// House pattern: dispatch (midi.js/osc.js) and the gesture path (brush.js)
// reach us through S, not imports.
S._samplerSelectSource = selectSource;
S._samplerSelectSample = selectSample;
S._samplerTrace        = samplerTrace;
S._samplerCaptureHold  = captureHold;
S._samplerCaptureToggle = captureToggle;
S._samplerLoadTestSamples = loadTestSamples;
