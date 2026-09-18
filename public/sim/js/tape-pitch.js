// ============================================================================
// tape-pitch.js — the tape engine's baked pitch, and the step quantiser.
//
// Two dials, no switch (docs/TAPE-STUDY-2026-09.md § 3, Ek 2026-09-18):
// `speed` is tape — pitch follows, the one-knob gesture every machine in the
// field has — and `pitch` is Blooper's Pitcher, a shift on top at constant
// length. Both are frozen into the stroke when it ends, like everything on
// the tape sheet, so neither ever runs in real time: the region is stretched
// ONCE by the pitch ratio (js/workers/phase-vocoder.worker.js) and played at
// speed × ratio. The stretch and the rate cancel in time, so every reader of
// `seq.speed` — the playhead, the overdub fold, the tail — is untouched.
//
// `step` is one capsule for the pair: `free`, `semi` (semitones) or `oct5`
// (octaves and fifths) — Blooper's smooth, chromatic and stepped speed
// variants as one setting, Count to Five's Q. It quantises the DIAL, so a
// stored value is always what the sheet shows.
// ============================================================================
import { S } from './state.js';
import { ensureAudioContext } from './audio.js';

export const TAPE_STEPS = ['free', 'semi', 'oct5'];
export const PITCH_MAX_CENTS = 2400;            // ± two octaves, the grain engine's clamp

/** Playback ratio of a pitch in cents; 1 at 0. */
export function pitchRatio(cents) { return cents ? Math.pow(2, cents / 1200) : 1; }

const _OCT5 = [-24, -19, -12, -7, 0, 7, 12, 19, 24];   // semitones, octaves and fifths
function _snapSemis(semis, step) {
  if (step === 'semi') return Math.round(semis);
  if (step === 'oct5') { let best = 0, d = Infinity; for (const c of _OCT5) { const e = Math.abs(c - semis); if (e < d) { d = e; best = c; } } return best; }
  return semis;
}
/** A pitch in cents, quantised by the tape's `step`. */
export function quantPitch(cents, step = S.triggerParams.step) {
  const c = Math.max(-PITCH_MAX_CENTS, Math.min(PITCH_MAX_CENTS, +cents || 0));
  return step === 'free' ? c : _snapSemis(c / 100, step) * 100;
}
/** A speed ratio (0.25–4), quantised by the tape's `step`: the nearest
 *  semitone or octave-and-fifth ratio. */
export function quantSpeed(v, step = S.triggerParams.step) {
  const s = Math.max(0.25, Math.min(4, +v || 1));
  if (step === 'free') return s;
  const semis = _snapSemis(12 * Math.log2(s), step);
  return Math.max(0.25, Math.min(4, Math.pow(2, semis / 12)));
}
/** The pitch row's readout: semitones, one decimal when free. */
export function fmtPitch(cents) {
  const c = +cents || 0;
  if (c === 0) return '0 st';
  const st = c / 100;
  const s = S.triggerParams.step === 'free' ? st.toFixed(1) : String(Math.round(st));
  return (c > 0 ? '+' : '') + s + ' st';
}

// ── The offline stretch ─────────────────────────────────────────────────────
let _worker = null, _workerReady = null, _nextId = 1;
const _jobs = new Map();     // id → { slot, region, ratio, circular }
// Electron refuses a dedicated Worker from a file:// URL (the renderer's
// origin), and the hosted demo would take it — so the source is fetched and
// the worker spun from a blob, which both origins allow. Module type, so the
// file can keep its `export` for the node test.
function _ensureWorker() {
  if (_workerReady) return _workerReady;
  const url = new URL('./workers/phase-vocoder.worker.js', import.meta.url);
  _workerReady = fetch(url).then(r => r.text()).then(src => {
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), { type: 'module' });
    w.onmessage = e => {
      const { id, out } = e.data;
      const job = _jobs.get(id);
      _jobs.delete(id);
      if (!job) return;
      const { slot, region, ratio, circular } = job;
      // Stale if the region was re-cut or the pitch changed while it ran.
      const want = slot._pitchBuf;
      if (!want || want.from !== region || want.ratio !== ratio || want.circular !== circular) return;
      const actx = ensureAudioContext();
      const buf = actx.createBuffer(1, out.length, region.sampleRate);
      buf.getChannelData(0).set(out);
      want.buf = buf; want.pending = false;
    };
    w.onerror = err => console.warn('[tape-pitch] worker:', err.message || err);
    _worker = w;
    return w;
  }).catch(err => { console.warn('[tape-pitch] worker failed to start:', err.message || err); _workerReady = null; return null; });
  return _workerReady;
}

/**
 * The stretched copy of `region` (an AudioBuffer, already cut and reversed)
 * for `ratio`, cached on the slot; null while the worker is still on it, and
 * the caller tries again next tick. Keyed on the region OBJECT: a re-cut
 * region (grain.js _regionCopy) is a new one, so the cache follows it.
 */
export function stretchedRegion(slot, region, ratio, circular) {
  const c = slot._pitchBuf;
  if (c && c.from === region && c.ratio === ratio && c.circular === circular) return c.pending ? null : c.buf;
  const id = _nextId++;
  slot._pitchBuf = { from: region, ratio, circular, buf: null, pending: true };
  const samples = new Float32Array(region.getChannelData(0));   // a copy: the buffer stays playable
  _jobs.set(id, { slot, region, ratio, circular });
  _ensureWorker().then(w => { if (w && _jobs.has(id)) w.postMessage({ id, samples, ratio, circular }, [samples.buffer]); });
  return null;
}
