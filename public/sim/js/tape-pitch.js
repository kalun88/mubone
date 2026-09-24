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
      const c = slot._pitchBuf;
      // Stale only if the REGION was re-cut under it. A ratio that has since
      // moved on is still the freshest stretch in hand — it is kept as `done`
      // and the seam may take it while the newer one runs (2026-09-24 night).
      if (!c || c.from !== region || c.circular !== circular) return;
      const actx = ensureAudioContext();
      const buf = actx.createBuffer(1, out.length, region.sampleRate);
      buf.getChannelData(0).set(out);
      c.done = { ratio, buf };
      c.inflight = null;
      // ONE JOB IN FLIGHT PER SLOT, LATEST WINS: the ratio wanted now, if it
      // is not the one that just landed, goes next — and only now.
      if (c.want !== ratio) _post(slot, c, c.want);
    };
    w.onerror = err => console.warn('[tape-pitch] worker:', err.message || err);
    _worker = w;
    return w;
  }).catch(err => { console.warn('[tape-pitch] worker failed to start:', err.message || err); _workerReady = null; return null; });
  return _workerReady;
}

// ── ONE JOB IN FLIGHT PER SLOT, LATEST WINS (Ek, 2026-09-24 night) ──────────
// "it seems even to wait for me to release my click if i'm dragging that
// slider slowly." Every drag step posted a stretch, the worker took them in
// order, and each result was thrown away as stale because the ratio had moved
// on — so the take could not change until the WHOLE queue had drained after
// the drag ended, and the last one landed. Now a slot carries one state:
//
//   slot._pitchBuf = { from, circular, want, inflight, done: { ratio, buf } }
//
// `want` is the ratio asked for last; `inflight` the id of the one job the
// worker holds for this slot, if any; `done` the FRESHEST stretch that has
// landed, whatever its ratio. A new ask while one is in flight only moves
// `want`; when the job lands, `want` goes next if it differs. The seam takes
// `done` whenever it is fresher than what is playing (grain.js
// `_liveRecutReady` / `stretchFresh`), so a slow drag is heard one step behind
// the pointer, loop by loop, instead of all at once after the release.
function _state(slot, region, circular) {
  const c = slot._pitchBuf;
  if (c && c.from === region && c.circular === circular) return c;
  // A re-cut region is a new one: the cache follows it, the old job's result
  // will be dropped on arrival (see onmessage).
  return (slot._pitchBuf = { from: region, circular, want: null, inflight: null, done: null });
}
function _post(slot, c, ratio) {
  const id = _nextId++;
  c.inflight = id; c.want = ratio;
  const samples = new Float32Array(c.from.getChannelData(0));   // a copy: the buffer stays playable
  _jobs.set(id, { slot, region: c.from, ratio, circular: c.circular });
  _ensureWorker().then(w => { if (w && _jobs.has(id)) w.postMessage({ id, samples, ratio, circular: c.circular }, [samples.buffer]); });
}
/**
 * The freshest stretched copy of `region` (an AudioBuffer, already cut and
 * reversed) in hand for this slot — at `ratio` if that has landed, else the
 * latest that has (`stretchRatio` says which), else null while the first is
 * still on the worker. Asks for `ratio` if it is not the one done or in
 * flight. Keyed on the region OBJECT.
 */
export function stretchedRegion(slot, region, ratio, circular) {
  const c = _state(slot, region, circular);
  if (c.done && c.done.ratio === ratio) { c.want = ratio; return c.done.buf; }
  if (c.want !== ratio) { c.want = ratio; if (c.inflight == null) _post(slot, c, ratio); }
  return c.done ? c.done.buf : null;
}
/** The ratio of the stretch `stretchedRegion` last handed out for `region`. */
export function stretchRatio(slot, region) {
  const c = slot._pitchBuf;
  return c && c.from === region && c.done ? c.done.ratio : null;
}
/** Is there a landed stretch of `region` at a ratio other than `playing`? —
 *  the seam's question: something fresher than the node in hand. */
export function stretchFresh(slot, region, playing) {
  const c = slot._pitchBuf;
  return !!(c && c.from === region && c.done && c.done.ratio !== playing);
}
