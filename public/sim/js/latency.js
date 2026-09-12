// ============================================================================
// latency.js — the time between a sound and its sample, and back
//
// The recorder is exact for anything INSIDE the Web Audio graph: a click
// scheduled on the audio clock lands in a take at exactly the offset the
// take's `startedAt` predicts (measured 0.00 ms, 2026-09-04). Everything late
// is outside the graph, where the clock cannot see it —
//
//   in:  the mic → the device and driver buffers → RtAudio's input callback,
//        one buffer at a time → the IPC hop → the input ring, read out as it
//        fills (about one buffer behind)
//   out: the graph's output → the capture worklet's batch (one buffer) → the
//        IPC hop → RtAudio's output buffers → the device → the headphones
//
// — and a performer lives outside the graph too. They sing in time with what
// they HEAR (late by `out`), the mic hears it (late by `in`), and the take is
// stamped with the clock at capture. So an overdub landed late by the whole
// round trip, every time, by a constant (Ek: "always just a bit late … like
// 30 ms"). Every looper compensates for this; nothing here did.
//
// Two numbers, applied in the two places time crosses the boundary:
//
//   inS         a loop's edges. The press at P is heard by the take at
//               P + in, so a line's region starts `in` into its take and the
//               recorder holds `in` past the release (audio.js).
//   roundTripS  an overdub's phase. Pulled earlier by the whole trip
//               (ui-presets.js attachOverdub / refreshLiveOverdub).
//
// Two sources. The ESTIMATE is always available: RtAudio reports each
// stream's own latency and the app knows the buffers it opened, so the hops
// add up without a measurement (browser mode uses the context's figures).
// The MEASUREMENT is a loopback: clicks out, the mic in, the delay found —
// what Ableton's driver error compensation and Loopy's calibration do. It
// needs the output to reach the mic (speakers, or a cable), so it is a
// button, not a startup step; stored per input device × output device ×
// rate × buffer, and split between in and out in the estimate's proportion,
// since a loopback cannot tell the two apart.
// ============================================================================

import { S } from './state.js';
import { ensureAudioContext, calibrationOutput, startLiveRecording, stopLiveRecording, whenSealed } from './audio.js';

const LS_CAL = 'mubone_latency_cal';

/** The estimate from what the streams report. Pure — testable with numbers. */
export function estimateFrom({ inStreamFrames, inBufferFrames, outStreamFrames, outBufferFrames, rate, cushionS = 0.02, baseLatency = 0, outputLatency = 0, electron = true }) {
  const sr = rate || 48000;
  if (!electron) {
    // Chromium's own paths: it reports the output side; the getUserMedia
    // input side it does not, so a typical figure stands in.
    const outS = (baseLatency || 0) + (outputLatency || 0);
    const inS  = 0.020;
    return { inS, outS, detail: 'browser: input assumed 20 ms' };
  }
  // Each side: the device and driver (RtAudio's own report) + the hop's
  // cushion (#333: the input ring's target fill, the output credit window)
  // + on the way out the capture batch, one block, before the hop.
  const inS  = (inStreamFrames  ?? 0) / sr + cushionS;
  const outS = (outStreamFrames ?? 0) / sr + cushionS + (outBufferFrames ?? 0) / sr;
  const missing = [];
  if (inBufferFrames == null)  missing.push('no input stream');
  if (outBufferFrames == null) missing.push('no output stream');
  return { inS, outS, detail: missing.join(', ') };
}

// A measurement is stored as the DEVICE PAIR's own offset — what the loopback
// measured minus what the app knew it was adding at the time (the streams'
// reports, the two cushions, the capture batch) — keyed on the pair and the
// rate only. Apple's built-in mic and speakers measured 55–60 ms that RtAudio
// reports as 1.5; that is the number worth keeping, and it does not change
// when the buffer or the cushion does. So: measure once per interface, then
// move the cushion freely and the round trip follows without measuring again.
function _calKey() {
  const actx = S.audioCtx;
  return [S._inputDeviceKey?.() ?? 'in', S._outputDeviceKey?.() ?? 'out', actx?.sampleRate ?? 0].join('|');
}

function _loadCal() {
  let c = null;
  try { c = JSON.parse(localStorage.getItem(LS_CAL) || 'null'); } catch (_) {}
  if (!c || typeof c !== 'object') return {};
  // The first day's entries were totals keyed on buffer and cushion too, with
  // no model to subtract; they cannot be converted, so they go (one shot).
  let dropped = false;
  for (const k of Object.keys(c)) if (k.split('|').length !== 3 || typeof c[k]?.deviceS !== 'number') { delete c[k]; dropped = true; }
  if (dropped) { try { localStorage.setItem(LS_CAL, JSON.stringify(c)); } catch (_) {} }
  return c;
}

/** What the app adds on its own, per side, right now. */
async function _model() {
  const actx = S.audioCtx;
  if (window.electronBridge?.getStreamLatency) {
    let rep = null;
    try { rep = await window.electronBridge.getStreamLatency(); } catch (_) {}
    return estimateFrom({ ...(rep || {}), rate: rep?.rate ?? actx?.sampleRate, cushionS: (S.audioCushionMs ?? 10) / 1000, electron: true });
  }
  return estimateFrom({ baseLatency: actx?.baseLatency, outputLatency: actx?.outputLatency, rate: actx?.sampleRate, electron: false });
}

/** Bring S.latency up to date: the estimate, overridden by a measurement
 *  for the current device pair when one exists. */
export async function refreshLatency() {
  const est = await _model();
  const cal = _loadCal()[_calKey()];
  if (cal && typeof cal.deviceS === 'number') {
    // The device's own share goes half to each side: a loopback cannot tell
    // the mic's DSP from the speaker's, and the app's own sides are known.
    const half = cal.deviceS / 2;
    S.latency = { inS: est.inS + half, outS: est.outS + half, roundTripS: est.inS + est.outS + cal.deviceS,
                  source: 'measured', deviceS: cal.deviceS,
                  detail: `measured ${new Date(cal.at).toLocaleDateString()} · the devices ${(cal.deviceS * 1000).toFixed(1)} ms` };
  } else {
    S.latency = { inS: est.inS, outS: est.outS, roundTripS: est.inS + est.outS, source: 'estimate', deviceS: 0, detail: est.detail };
  }
  S._latencyChanged?.();
  return S.latency;
}

/** Find the clicks in a recording and return the delay against where they
 *  were scheduled — the median over the clicks found, or null when fewer
 *  than half of them are. Pure, on a channel of samples. */
export function findClickDelayS(samples, sr, expectedS, { windowS = 0.25 } = {}) {
  return findClicks(samples, sr, expectedS, { windowS }).delayS;
}

/** The finder with its evidence: how many clicks were found, the take's
 *  noise floor and its loudest click, so a failure can say whether the mic
 *  heard nothing or heard something that was not a click. Relative to the
 *  take's own floor — a laptop mic hearing laptop speakers is quiet. */
export function findClicks(samples, sr, expectedS, { windowS = 0.25 } = {}) {
  const found = [];
  let floorAll = 0, peakAll = 0;
  for (const e of expectedS) {
    const a = Math.max(0, Math.floor(e * sr)), b = Math.min(samples.length, Math.floor((e + windowS) * sr));
    // the floor is the 5 ms BEFORE the scheduled time — nothing is due there
    let floor = 0;
    for (let i = Math.max(0, a - Math.floor(sr * 0.005)); i < a; i++) floor = Math.max(floor, Math.abs(samples[i]));
    let peak = 0;
    for (let i = a; i < b; i++) { const v = Math.abs(samples[i]); if (v > peak) peak = v; }
    floorAll = Math.max(floorAll, floor); peakAll = Math.max(peakAll, peak);
    if (!(peak >= 0.003) || !(peak >= floor * 8)) continue;
    // the onset, not the peak: the first sample clear of the floor and a
    // good part of the way up — a peak drifts with the click's shape
    const thr = Math.max(floor * 6, peak * 0.35);
    let hit = -1;
    for (let i = a; i < b; i++) if (Math.abs(samples[i]) >= thr) { hit = i; break; }
    if (hit >= 0) found.push(hit / sr - e);
  }
  const db = v => v > 0 ? +(20 * Math.log10(v)).toFixed(1) : -Infinity;
  if (found.length < Math.ceil(expectedS.length / 2)) return { delayS: null, found: found.length, of: expectedS.length, floorDb: db(floorAll), peakDb: db(peakAll) };
  found.sort((x, y) => x - y);
  return { delayS: found[found.length >> 1], found: found.length, of: expectedS.length, floorDb: db(floorAll), peakDb: db(peakAll) };
}

/** The loopback measurement: six clicks out of the master bus, the take in,
 *  the delay stored for this device pair. Resolves to the round trip in
 *  seconds, or null when the mic did not hear the clicks. */
export async function measureRoundTrip() {
  const actx = ensureAudioContext();
  if (actx.state !== 'running') await actx.resume();
  const sr = actx.sampleRate;
  const N = 6, GAP = 0.3, LEAD = 0.4;
  const click = actx.createBuffer(1, Math.round(sr * 0.003), sr);
  click.getChannelData(0).fill(0.5);
  // Into every physical output the app drives — NOT the master bus, which in
  // Electron ends at the analyser (the first version played there and the
  // interface never heard a click, 2026-09-04).
  // Under test the harness's tap IS the room: the clicks go there and not to
  // the interface, so an audit cannot howl through the machine it runs on.
  const out = S._calibrationTap ?? calibrationOutput();
  S._latencyLast = null;
  if (!out) { S._latencyLast = { error: 'no output open' }; return null; }
  startLiveRecording();
  if (!S.isRecording) { S._latencyLast = { error: 'no input to record from' }; return null; }
  const idx = S.currentLiveBufferIdx;
  const slot = S.liveRecBuffers[idx];
  const t0 = slot.startedAt;
  const expected = [];
  for (let k = 0; k < N; k++) {
    const src = actx.createBufferSource(); src.buffer = click; src.connect(out);
    const at = t0 + LEAD + k * GAP; src.start(at); expected.push(at - t0);
  }
  await new Promise(r => setTimeout(r, (LEAD + N * GAP + 0.4) * 1000));
  stopLiveRecording();
  await new Promise(res => whenSealed(res));
  const buf = slot.buffer;
  // the calibration take is not material — drop it (nothing painted it)
  const i = S.liveRecBuffers.indexOf(slot);
  if (i >= 0) { S.liveRecBuffers.splice(i, 1); S.particles.forEach(p => { if (p.liveBufferIdx > i) p.liveBufferIdx--; }); }
  try { out.disconnect(); } catch (_) {}
  if (!buf) { S._latencyLast = { error: 'the take did not seal' }; return null; }
  const r = findClicks(buf.getChannelData(0), sr, expected);
  S._latencyLast = r;
  const d = r.delayS;
  if (d == null || d < 0) return null;
  // Keep the devices' share: the measurement minus what the app added.
  const m = await _model();
  const cal = _loadCal();
  cal[_calKey()] = { deviceS: d - (m.inS + m.outS), measuredS: d, modelS: m.inS + m.outS, at: Date.now() };
  try { localStorage.setItem(LS_CAL, JSON.stringify(cal)); } catch (_) {}
  await refreshLatency();
  return d;
}

/** Forget the measurement for the current device pair. */
export async function clearMeasurement() {
  const cal = _loadCal();
  delete cal[_calKey()];
  try { localStorage.setItem(LS_CAL, JSON.stringify(cal)); } catch (_) {}
  return refreshLatency();
}

S._refreshLatency   = refreshLatency;
S._measureRoundTrip = measureRoundTrip;
S._clearLatencyCal  = clearMeasurement;
