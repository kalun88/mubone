# Group-Show Noise Glitch — Investigation & Reproduction

> **Status: HISTORICAL** — the retained-buffer leak was confirmed and **fixed 2026-07-06** (see § "Fix applied"). The audible glitch itself was never reproduced in dev, so the causal chain is inferred, not proven. Kept as the investigation record + revert checklist.

Status: **leak confirmed in dev 2026-07-06 (via diag counters); fix applied same day — see "Fix applied" section at the bottom. Audible glitch itself still unreproduced (Phase C not run). Awaiting real-session verification.**
First observed: group show, ~50 min into a 1+ hour set.
Author of notes: debugging session with Claude, April 2026. Updated July 2026.

**Instrumentation (2026-07-06):** the worklet feedback `_diag` now reports
`sampleBufs` (count) and `sampleBufMB` (retained Float32 MB), and
`getWorkletDiag()` exposes `bufMapSize` (bridge-side AudioBuffer refs) plus
`workletDiag` (latest `_diag`). Phase B below watches these directly instead of
inferring from heap size alone.

---

## Symptom

At roughly the 50-minute mark of a 1+ hour group show, audio "went in and out" between:

- Normal expected granular playback, and
- **Loud, garbled noise on all 8 speakers simultaneously.**

The noise was *not* silence dropouts and *not* obviously downsampling or bitcrushing. Performer described it as "totally mangled, almost white noise with some definition" — i.e. broadband hiss with faint residual source character. It came in and out intermittently for a stretch of time rather than one discrete glitch.

### Show conditions at the time

- Yamaha TF soundcard, 8 output channels
- **128-frame buffer, 48 kHz** (very tight GC/pause headroom: ~2.7 ms per block)
- 4 performers, ~10-minute sets each, with ~4–20 live buffers recorded per set, ~5 minutes of total recorded audio per performer
- Between performers: **triple-delete / erase-all**, never a hard reset of the app
- At the time of the glitch: vocalist was pushing the system hard — **8 active seed clouds**, many particles painted at/near the poles, high grain density
- macOS Electron duplex stream had already emitted a clock-drift warning earlier in the show (expected over 30+ min duplex sessions, but noted)
- No process crash, no visible JS errors — the app kept running and the glitch eventually passed

---

## Findings (code read — no runtime confirmation yet)

### 1. The noise signature is aliasing, not dropout

"White noise with some source definition" across all channels, loud, intermittent, is the fingerprint of **grain playback reading garbage / wrong-rate data** — not of the stream dropping blocks. A dropout would present as clicks/silence. Aliasing-style noise means grains are firing but reading from a bad source or at a bad rate.

### 2. All-8-channel mechanism: pole-spread via elBias

`js/worklets/grain-engine.worklet.js` lines 1043–1049 and the `elBias = sin²(lat)` logic in `js/grain-worklet-bridge.js` (lines 52–53) fan a grain across *all* speakers when its latitude approaches ±90°. So if the mangled grains were firing on pole-painted particles, they would legitimately play out of all 8 channels by design. This matches the performer's observation that the noise was coming from every speaker, and matches the heavy pole-painting in the vocalist's final set.

This is not itself a bug — it's the spread behavior working as intended. But it means **whatever corrupt audio the grain engine produces at the poles gets amplified by being routed everywhere at once.**

### 3. Memory accumulation hypothesis (prime suspect)

`S._sessionEraseAll()` (ui-sweep.js line 234 / 365) — the triple-delete handler — clears:

- particles
- live recording buffers
- strokes

But it does **not** clear:

- `_sampleBufs` inside the worklet (grain-engine.worklet.js line 54, pushed at line 337). **Correction (Jul 2026):** the `'stop'` message does *not* clear `_sampleBufs` — it only clears `_liveChunks` and the grain pool. `_sampleBufs` is only ever *replaced* by a fresh `'buffers'` message, and effectively reset only because `startWorkletGrain` creates a brand-new `AudioWorkletNode`. Within one node lifetime (i.e. the whole show, since performers never stop/start), it grows monotonically.
- `_bufferMap` inside the bridge (grain-worklet-bridge.js line 62 — a regular `Map` holding `AudioBuffer` refs; only cleared in `stopWorkletGrain`)

Across 4 performers × ~10 min sets × ~5 min of recorded audio each, with triple-deletes between sets, both structures grow monotonically for the full duration of the show. At 48 kHz mono Float32 that's ~11.5 MB per minute of recording, so ~200 MB of retained buffers after ~20 min of cumulative recording is plausible.

At 128-frame buffer, any GC pause longer than ~2.7 ms drops audio blocks. A 200+ MB heap with lots of typed-array retention is squarely in the range where major GCs start exceeding that threshold under load.

### 4. NaN is ruled out

The NaN guard at grain-engine.worklet.js:1025 (`if (sample !== sample) { this._freeGrain(i); continue; }`) silently frees any grain whose sample is NaN. So the noise cannot be NaN poisoning — a stream of NaN grains would come out as *silence*, not noise.

### 5. Pool saturation / stale candidate hypothesis (secondary)

The grain pool has 256 slots with a pressure throttle at 75% (192). `_allocGrain` steals without fading. Under the vocalist's high-density load, pool stealing becomes frequent. If a candidate list posted from the main-thread scheduler (~30 Hz) points at a `_sampleBufs` index that has since been replaced or whose `AudioBuffer` has been copied weirdly during `hotSwapRecording` (bridge line 709, does 3 heavy copies), the worklet can read stale or half-valid data. Combined with pool stealing mid-grain, this produces the "white noise with definition" profile.

### 6. IPC / credit accounting (non-causal, but note)

- `electron-main.js` line 520–521: `_ipcAudioCredits` is written but never read — dead code path, but the credit *send-back* still happens via `send('audio-credit', ...)`.
- `electron-preload.js` line 52: `onAudioCredit` uses `ipcRenderer.on(...)` — listeners are added on each call, never removed. Over a long session `initSpeakerBuses` calls can stack listeners (audio.js line 925–927). Not obviously causal here, but worth a second pass later.

---

## Reproduction recipe

Goal: compress the ~50-minute show trajectory into ~5–10 minutes of wall time and trigger the glitch in dev. **No code changes** — everything below is console paste or GUI action.

### Phase A — Setup (match show conditions)

1. **Hard reset the app.** Cmd-Q the Electron wrapper fully. We want a clean baseline, since the bug is about what accumulates *after* launch.
2. **Relaunch**, connect the TF soundcard, select the 8-channel output at **128 frames / 48 kHz**. Do not change buffer size mid-session.
3. **Open DevTools** (Cmd-Opt-I) → Console tab. Also open Performance → Memory for heap snapshots.
4. **Paste the monitor harness** — polls every 2 s and logs drift state:

```js
const { S } = await import('./js/state.js');
const bridge = await import('./js/grain-worklet-bridge.js');
window.__S = S;
window.__bridge = bridge;

window.__mon = setInterval(() => {
  const d = bridge.getWorkletDiag?.() || {};
  const w = d.workletDiag || {};
  const heap = (performance.memory?.usedJSHeapSize / 1048576).toFixed(1);
  const liveCount  = (S.liveRecBuffers || []).length;
  const partCount  = (S.particles || []).length;
  const seedCount  = (S.seeds || []).length;
  console.log(
    `heap=${heap}MB  sampleBufs=${w.sampleBufs ?? '?'} (${(w.sampleBufMB ?? 0).toFixed(1)}MB)  ` +
    `bufMap=${d.bufMapSize ?? '?'}  cands=${d.candidateCount ?? '?'}  run=${d.running}  ` +
    `liveBufs=${liveCount}  parts=${partCount}  seeds=${seedCount}`
  );
}, 2000);
// to stop: clearInterval(window.__mon)
```

### Phase B — Accumulate memory (compress "50 minutes of show")

Hypothesis: `_sampleBufs` in the worklet and `_bufferMap` in the bridge grow every record→erase cycle because erase clears particles/liveRecBuffers but not worklet-side state. Triple-delete between sets does NOT reset the worklet; only a stop/start cycle does. So we loop record-short-clip → erase, many times.

```js
const audio = await import('./js/audio.js');

async function cycle(n = 50, recordMs = 3000, gapMs = 500) {
  for (let i = 0; i < n; i++) {
    audio.startLiveRecording();
    await new Promise(r => setTimeout(r, recordMs));
    audio.stopLiveRecording();
    await new Promise(r => setTimeout(r, 300));    // let finalize post to worklet
    __S._sessionEraseAll();                         // triple-delete equivalent
    await new Promise(r => setTimeout(r, gapMs));
    if (i % 5 === 0) console.log(`cycle ${i}/${n} heap=${(performance.memory.usedJSHeapSize/1048576).toFixed(1)}MB`);
  }
  console.log('done cycling');
}

cycle(50);   // ~3 min of wall time; simulates 50 record/erase events
```

Success criteria (direct, via the new counters):

- **Leak confirmed:** `sampleBufs` climbs by ~1 per cycle and `sampleBufMB` grows in step; `bufMap` climbs too; neither drops after erase. Heap should track `sampleBufMB` roughly ×2 (worklet copy + bridge-retained AudioBuffer).
- **Leak refuted:** `sampleBufs` / `bufMap` stay flat across cycles. Then the probe is wrong — target native-side audify state / IPC retention instead.

Target state before Phase C: ≥ 100–150 MB above baseline.

Caveat: the worklet must be running for `hotSwapRecording` to push into `_sampleBufs` — make sure granulation has started (record once and paint) before cycling, and note `sampleBufs`/`sampleBufMB` come from the worklet feedback (~30Hz), so they read `?` until the engine is active.

Feeding real mic input during the record window is closer to the show state — prefer that if convenient. The leak is driven by allocation, not content, so silent records work too.

### Phase C — Apply vocalist load (poles + 8 clouds)

Reproduce the performer's final-set conditions manually:

1. Start a fresh recording. Sing/play for ~10 s so there's a real live buffer.
2. **Paint at the poles.** Drive latitude to ±90° and scribble. Deposit a dense cluster (40–60 particles) within ~15° of the top pole, then the bottom. This is what triggers the elBias pole-spread across all 8 speakers.
3. **Drop 8 seed clouds** — one at each pole, six spread around the equator. All 8 active.
4. **Max out grain density**: high grain count / pressure, long duration, fast rate, wide spatial spread especially on the pole seeds.
5. **Keep playing 2–5 min** while watching the console monitor. Target symptom: normal granulation collapses into loud, broadband "white noise with some definition" on all 8 channels, in-and-out, not silence dropouts.

### Phase D — When it happens, capture

1. Freeze a **heap snapshot** (DevTools → Memory) and save it.
2. One-shot diag:

```js
(() => {
  const d = __bridge.getWorkletDiag?.();
  console.log({
    time: new Date().toISOString(),
    heapMB: (performance.memory.usedJSHeapSize/1048576).toFixed(1),
    candidateCount: d?.candidateCount,
    running: d?.running,
    bufMapSize: d?.bufMapSize,
    sampleBufs: d?.workletDiag?.sampleBufs,
    sampleBufMB: d?.workletDiag?.sampleBufMB,
    seeds: __S.seeds?.length,
    particles: __S.particles?.length,
    liveRecBuffers: __S.liveRecBuffers?.length,
    sampleRate: __S.audioContext?.sampleRate,
    currentTime: __S.audioContext?.currentTime,
  });
})();
```

3. **Classify the noise**:
   - Broadband hiss with faint source pitch → aliasing / wrong playbackRate (stale candidate or detached `_bufferMap` ref).
   - Buzzy square-ish at grain rate → pool saturation, grains retriggering on garbage memory.
   - Clean loud tone → different bug, not this one.
4. If `cands` is pinned at max for seconds at a time, that's scheduler/worklet desync — note the timestamp.

---

## Reliability caveats

- Reproduction is probabilistic. The show had real audio input, sensor jitter, and real wall-clock GC pressure. Expect multiple attempts.
- **Do not hard-reset (Cmd-Q) between attempts within a test session.** Hard reset is what the performers *didn't* do, and it's likely what clears the state causing the bug.
- 128-frame buffer has ~2.7 ms audio-thread headroom. GC pause longer than that drops samples; sustained pressure manifests as the glitch.
- If Phase B finishes with heap barely above baseline, the leak is in native audify state or IPC retention, not JS heap. Different probe needed — watch `_expectedAudioBytes` and credit accounting in main-process stdout.

---

## Candidate fixes

> **Update 2026-07-06:** fix #1 was applied in modified form (release at
> snapshot-commit time, not erase time) after the leak was confirmed via the
> diag counters — see "Fix applied" section at the bottom. Fixes #2–#5 remain
> unapplied. The list below is kept for the record.

Listed roughly in order of plausibility / least-risky:

1. **Have `_sessionEraseAll()` also reset worklet state.** Either post a `'resetBuffers'` message to the worklet that clears `_sampleBufs` and `_bufferMap` without tearing down the worklet itself, or do a soft stop/start cycle.
2. **Convert `_bufferMap` to a `WeakMap`** keyed on something retainable, or explicitly `delete` entries as buffers are superseded by newer recordings.
3. **Fade-on-steal in `_allocGrain`.** Pool stealing currently has no fade — add a 1–2 ms fade-in on stolen slots to mask any stale-sample artifact if pool saturation is contributing.
4. **Remove dead `_ipcAudioCredits` write** and fix the `onAudioCredit` listener leak in `electron-preload.js` + `audio.js` — add an `ipcRenderer.removeAllListeners` before re-registering.
5. **Cap `_sampleBufs` length** (LRU eviction past e.g. 64 buffers) with a live performance-safe policy.

The #1 fix is the highest-leverage and lowest-risk if the leak hypothesis is confirmed.

---

## References into code

- `js/ui-sweep.js:234` — `eraseAll()` (clears particles, liveRecBuffers, strokes)
- `js/ui-sweep.js:365` — `S._sessionEraseAll` binding
- `js/worklets/grain-engine.worklet.js:54` — `this._sampleBufs = []` init
- `js/worklets/grain-engine.worklet.js:337` — push (grows, never cleared here)
- `js/worklets/grain-engine.worklet.js:426` — only place `_sampleBufs` is emptied (on `'stop'`)
- `js/worklets/grain-engine.worklet.js:1025` — NaN guard (rules NaN out)
- `js/worklets/grain-engine.worklet.js:1043–1049` — pole-spread VBAP
- `js/grain-worklet-bridge.js:62` — `_bufferMap = new Map()`
- `js/grain-worklet-bridge.js:52–53` — `elBias = sin²(lat)`
- `js/grain-worklet-bridge.js:709` — `hotSwapRecording` (heavy copies)
- `js/grain-worklet-bridge.js:822` — `stopWorkletGrain` clears `_bufferMap`
- `js/audio.js:550` — `stopLiveRecording` fade
- `js/audio.js:923–927` — `_audioCredits` + leaky `onAudioCredit` registration
- `electron-main.js:340–428` — `createOutputStream`
- `electron-main.js:516` — `_expectedAudioBytes` gate
- `electron-main.js:520–521` — dead `_ipcAudioCredits`
- `electron-preload.js:52` — `onAudioCredit` (no remove)
- `js/worklets/grain-engine.worklet.js` feedback `_diag` — `sampleBufs` / `sampleBufMB` counters (added Jul 2026)
- `js/grain-worklet-bridge.js` `getWorkletDiag()` — `bufMapSize` + `workletDiag` passthrough (added Jul 2026)

---

## Leak confirmation (2026-07-06, manual dev test)

Ek ran manual record→stop→erase-all cycles (including erases *during* active
recording) and read `wg.diag()`:

- Session 1: `sampleBufs: 11`, `sampleBufMB: 92.6`, `bufMapSize: 12` — after erases.
- Session 2 (engine restarted between): `sampleBufs: 14`, `sampleBufMB: 24.0`, `bufMapSize: 15`; live candidates referenced only `bufIndex: 13` (the newest buffer — indices 0–12 dead weight).

`bufMapSize = sampleBufs + 1` in both readings (the +1 is the SAB primary at
index -1): worklet and bridge retention grow in lockstep, erase never shrinks
them, only an engine restart resets them. **Hypothesis #3 confirmed.** The
audible glitch itself (Phase C) was not reproduced before fixing.

---

## Fix applied (2026-07-06) — candidate fix #1, modified

**Design change from the original candidate fix:** the buffer release does NOT
happen at erase time. Erase-all keeps an undo snapshot (`S._sweepSnapshot`,
ui-sweep.js) so a triple-delete can be undone; the worklet buffers and
`_bufferMap` entries must survive until that window closes or undo-after-erase
breaks (this undo requirement is *why* `flushWorkletGrains` never cleared the
map — the leak was deferred cleanup that never happened). The fix releases
buffers at **snapshot-commit time**: next stroke start (`recordStrokeStart` →
`commitSweep()`) or the 30 s auto-commit timer. User-visible erase/undo
behavior is unchanged; memory is actually freed ≤30 s after an erase.

### Changes (revert checklist — remove these to undo the fix)

1. **`js/worklets/grain-engine.worklet.js`** — new `case 'compactBuffers'`
   message handler (in `_onMessage`, directly above `case 'flush-cursor'`).
   Compacts `_sampleBufs` to `data.keep` (old indices, ascending), remaps
   in-flight grains' `_gBufIndex` via the old→new table, frees grains whose
   buffer was dropped, clears cursor + seed candidate lists (scheduler reposts
   within ~20 ms; seeds stay `active`, unlike `'flush'`).
2. **`js/grain-worklet-bridge.js`** — new export `resyncWorkletBuffers()`
   (below `flushWorkletGrains`). Keeps buffers reachable from
   `S.liveRecBuffers` / `S.samples`, drops the rest: posts `compactBuffers`
   to the worklet and rebuilds `_bufferMap` values with the SAME remapping in
   the same call. Negative indices (-1 SAB, -2 provisional) never dropped.
3. **`js/grain-worklet-bridge.js`** — `flushWorkletGrains()` now does
   `_bufferMap.delete(_provisionalLiveRef)` before nulling the ref. Fixes the
   mid-recording-erase orphan: erasing during an active recording abandoned
   the in-progress liveBuffer's map entry permanently.
4. **`js/ui-sweep.js`** — imports `resyncWorkletBuffers`; `commitSweep()`
   calls it when a snapshot was actually pending (guarded — `commitSweep`
   fires on every stroke start); the 30 s auto-commit timer callback calls it
   unconditionally.
5. **`js/ui-sweep.js`** — `eraseAll()` no longer calls
   `S._beginProvisionalRecording()` in the still-recording branch. **This
   fixes a separate, pre-existing byproduct glitch** (reported by Ek during
   fix verification, Jul 6): erasing while holding record gave silent-then-
   murky granulation that only snapped clear on record release. Cause: the
   re-init reset the worklet's live accumulator to zero while the main-thread
   recording kept counting continuously — post-erase particles carried
   continuous-time offsets into a worklet buffer that had restarted at the
   erase point (offsets past the end → grains dropped; later, time-shifted
   reads). Removing the re-init keeps both sides continuous; erased material
   is simply unreachable and freed at snapshot commit. To revert: restore the
   `S._beginProvisionalRecording?.()` call after the fresh-slot push (and the
   original two-line comment).

The diagnostic counters (`sampleBufs`/`sampleBufMB` in `_diag`, `bufMapSize`/
`workletDiag` in `getWorkletDiag()`) are separate from the fix — keep them
even if reverting.

### Safety invariants

- **Index lockstep:** worklet `_sampleBufs` positions and `_bufferMap` values
  must always agree — `resyncWorkletBuffers` changes both atomically (port
  messages are ordered, so any candidate post after the rebuild uses new
  indices and arrives after the compaction).
- **Stale-candidate window:** candidate lists posted *before* the resync carry
  old indices but arrive before `compactBuffers`, which then clears them.
  Zero window for wrong-buffer reads from candidates.
- **In-flight grains:** remapped, not killed — except grains on dropped
  buffers, which are hard-freed (their data is unreachable; these only exist
  in exotic timings since erase already flushed the pool 30 s earlier).
- Undo (`undoSweep`) does NOT resync — restored buffers keep their mappings.

### Verification

- **Dev:** repeat the manual test — record→erase ×5, then either record once
  more or wait 30 s, then `wg.diag()`: `sampleBufs` should drop to ~0–1 and
  `bufMapSize` to `sampleBufs + 1`. Confirm painting/scanning still sounds
  right through an erase→undo cycle and an erase-mid-recording.
- **Real session:** a long rehearsal with multiple record/triple-delete
  cycles at 128 frames — watch heap + `sampleBufMB` stay bounded.
- Phase C (pole-painting glitch reproduction) remains unrun; if the glitch
  ever reappears with this fix in place, revisit hypotheses #5/#6.
