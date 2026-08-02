# Performance Audit — July 2026

> **Status: HISTORICAL** — audit of 2026-07-06. H1–H4, M2, M3 **fixed the same day** (tagged `perf audit <ID>` in code); M1, M4, M5 deliberately deferred pending measurement. The 7-step verification checklist at the bottom is **still unrun** (TODO #129).

Audit of crash risks, audio-quality risks, and latency/efficiency issues across
the audio hot paths, render loop, Electron/IPC layer, and memory lifecycle.
Done 2026-07-06 (same session as the group-show noise-glitch fix — see
`GROUP-SHOW-NOISE-GLITCH.md`).

> **Update (same day):** H1, H2, H3, H4, M2, and M3 (#116) were fixed, plus
> the `[dir]` console-log gating from the retention section. M1, M4, and M5
> were deliberately left alone (measure-first items). See **"Fixes applied"**
> at the bottom for the change list and per-fix revert instructions. The
> finding sections below are kept as written for the record.

Overall: the scheduler, worklet, and render loop are in good shape from the
Mar 29 optimization pass (zero-alloc caches, k-selection, batched canvas,
30fps gate all intact; `_TRAIL_BUDGET` still 120). The real remaining risks
cluster in the **recording lifecycle** and the **Electron IPC audio path**.

---

## HIGH — crash / dropout / audible-glitch risks

### H1. 57.6 MB allocation on every record press

`startLiveRecording()` (audio.js) does
`S.recordingRaw = new Float32Array(S.recordingSampleRate * 300)` — a fresh
57.6 MB alloc-and-zero on **every spacebar press**, dropped to GC at stop
(`S.recordingRaw = null`). Twenty record cycles in a set = ~1.2 GB of churn
through the heap while the grain engine is running. This is the same
GC-pause failure mode as the (now fixed) buffer leak — at 128-frame buffers
any major GC > 2.7 ms drops audio. The zeroing alone can stall the main
thread for 10–20 ms *right at the musically-critical record onset*.

**Fix:** keep one persistent backing buffer across recordings (it's the same
size every time), or start small (~30 s) and rely on the existing doubling
growth path. Reuse pattern already exists nearby (`_liveAudioBuf` in
`rebuildLiveBuffer` reuses with 2× headroom — though it too is nulled at
stop; keep both alive instead).

### H2. Triple full-buffer copy + non-transferred postMessage at record stop

At record release the finalized take is copied **three times synchronously
on the main thread**, and the third copy lands on the audio thread:

1. `stopLiveRecording()`: `actx.createBuffer` + `getChannelData(0).set(...)`
2. `hotSwapRecording()` (grain-worklet-bridge.js): `new Float32Array(data)`
3. `postMessage({ type:'addBuffer', data, ... })` **with no transfer list**
   → structured clone = copy #3, deserialized on the audio thread

For a 5-minute take that's 3 × 57 MB at the exact moment grains from the
provisional buffer are still playing. The worklet's `'buffers'` bulk message
in `startWorkletGrain` has the same no-transfer problem.

**Fix (cheap):** pass `[f32.buffer]` as the transfer list on `addBuffer` and
`buffers` posts. The worklet handler already accepts non-Float32Array input
(`new Float32Array(data.data)` on an ArrayBuffer is a zero-copy view), so
this is a one-line change per call site that removes one full copy and makes
delivery to the audio thread near-free.

### H3. IPC audio credits can be lost but never recovered → potential permanent silence

Renderer side (`initSpeakerBuses`, audio.js): `_audioCredits` starts at 8,
decrements per buffer sent, replenishes only via `'audio-credit'` messages.
Main side (`electron-main.js` `'audio-buffer'` handler): a credit is sent
back **only after a successful `rtAudio.write()`**. Buffers dropped during
stream teardown (`_expectedAudioBytes === 0`) or size mismatch send **no
credit back** — that credit is destroyed until the next full
`initSpeakerBuses` re-init. Every device/buffer-size switch has buffers in
flight, so each switch can permanently shrink the credit pool; lose all 8
and **output goes silent until the user re-selects the device**. This is a
plausible root for "audio died until I fiddled with settings" reports.

**Fix:** send a credit back on *dropped* buffers too (they were consumed),
or add a renderer-side watchdog (if credits pinned at 0 for > 500 ms, reset
to max). Also note `_ipcAudioCredits` in electron-main is written but never
read — dead code, flagged in GROUP-SHOW-NOISE-GLITCH.md §6.

### H4. `onAudioCredit` listener stacking (known — glitch doc §6)

`electron-preload.js` `onAudioCredit` uses `ipcRenderer.on` with no removal;
`initSpeakerBuses` registers a fresh callback every call (device change,
channel change, buffer-size change). Old closures stay subscribed forever —
memory leak plus N callbacks per credit message over a long session.
(`onAudioInputBuffer` has a `window._rtAudioInputListening` guard — apply
the same pattern, or add `removeAllListeners('audio-credit')` in preload
before re-registering.)

### H5. `rtAudio.write()` runs on the Electron main-process event loop

The `'audio-buffer'` IPC handler calls `rtAudio.write(buf)` inline. If
audify's ring buffer is full, a blocking write stalls the **entire main
process** — which also hosts the x-imu3 UDP bridge, OSC forwarding, and
serial I/O. Audio backpressure therefore becomes *sensor latency*. The
credit system mostly prevents overrun, but after a credit desync (H3) or
device stall this couples the two paths. Long-term: move audify writes to a
`utilityProcess`/worker; short-term: just be aware they share a thread.

---

## MEDIUM — GC churn / efficiency

### M1. Candidate posting garbage (~50 Hz object streams)

Every scheduler tick builds fresh candidate objects: `pool.slice()` per seed
(grain.js, documented as required — shared `_candidateBuf`) plus one object
literal per candidate in the bridge (`{bufIndex, offset, length, azDeg,
elBias, particleId, radiusFade}`), then a structured clone per post. Under
show load (8 seeds × ~30 candidates + cursor, 50 Hz) that's ~12–25 k
objects/sec of pure garbage. It's the accepted design, but if GC pressure
ever needs another squeeze: pack candidates into a reusable `Float32Array`
(8 floats each) and post with a transfer list — near-zero garbage. Touches
the worklet's candidate parsing; medium effort, do only with A/B drift
measurement (TIMING-REFERENCE.md).

### M2. Loop (seq) playback VBAP fan-out scales with speaker count

Each loop creates 1 source + 1 gain + **one GainNode per speaker**
(grain.js `needsNewSource` block). 16 loops × 8 ch = 128 gains; at the
42-channel Dartmouth layout (#39) it's 672. Also `seq._revBuffer` caches a
full reversed copy of the loop region per reversed loop. Teardown relies on
GC (source stopped, refs dropped — no explicit `disconnect()` of
`_extraNodes` in the eraseAll path). Probably fine at 8 ch; a plausible
contributor to crash **#7** ("too many loops/seeds, error code 5") and a
likely cliff at 42 ch. Cheap hardening: explicitly disconnect
`seq._extraNodes` when a slot is cleared.

### M3. Meters compute while hidden (known — TODO #116)

Confirmed still open: `tickMainMeters` reads analysers + draws to collapsed
panels at ~30 fps; the audio-settings modal meter RAF (~60 fps) keeps
running once the modal has been opened. Straightforward early-return guards;
directly serves main-thread headroom during performance.

### M4. paint-ticker runs a 200 Hz interval permanently

`paint-ticker.js` polls at 200 Hz forever, early-returning when not
painting. Cheap per tick but 200 wakeups/sec keep the main thread from ever
idling (battery + scheduling noise). Start the interval on paint-begin /
stop on paint-end for free wins; keep the 200 Hz rate while active.

### M5. IPC message rate at small buffer sizes

The capture worklet posts one interleaved buffer per audify write. At the
show config (128 frames, 48 kHz) that's **375 IPC messages/sec**, each a
structured clone (128 × nCh × 4 B). Per-message overhead dominates at small
buffers. If 128-frame sessions stay standard, consider batching 2–4 blocks
per message (trades ~5–10 ms latency) or at least measuring the IPC cost.
Related: at 128 frames the 8-credit window is only ~21 ms of buffering —
tight against any main-process hiccup.

### M6. Minor per-tick allocations in the scheduler (acceptable)

For the record, the remaining known allocations per tick: `seedDists` array
+ sort in focus-weight mode, `Object.keys(cgo)` when gesture overrides are
active, `Object.assign(Object.create(...))` params merge, `pool.slice()`
per active seed, quat math arrays in the render path (30 fps). All small;
none worth touching unless M1 is done first.

---

## Memory retention (post-fix state)

- **Worklet/bridge buffer retention: FIXED 2026-07-06** — released at
  sweep-snapshot commit (see GROUP-SHOW-NOISE-GLITCH.md "Fix applied").
- `S._sweepSnapshot` — one generation of erased state held ≤ 30 s for undo.
  Bounded, by design.
- Worklet `_liveChunks` warm cache — one 30 s chunk (~5.5 MB) kept allocated
  between recordings. Bounded, by design.
- `recordingRaw` doubling — takes > 5 min double to 115 MB with a full copy
  (H1's fix should account for this path). `recLimitSeconds` guard exists.
- DevTools console retention: the ~1 Hz `[dir]` log (bridge feedback
  handler) accumulates entries for the whole session when direction=random.
  Only matters with DevTools open during long shows; gate on `?debug` like
  the other diagnostics.

---

## Latency snapshot (reference)

| Stage | Value | Source |
|---|---|---|
| Grain scheduler tick | 20 ms (`GRAIN_SCHEDULER_INTERVAL_MS`) | state.js |
| Seed onset lookahead | 40 ms (`SCHED_LOOKAHEAD`) | grain.js |
| Live-buffer frontier (paint→playable) | 50 ms (`LIVE_REBUILD_INTERVAL_MS`) | audio.js |
| Candidate post → worklet | ≤ 1 tick (20 ms) | bridge |
| Web Audio → audify IPC window | 8 credits × bufferFrames (21 ms @ 128) | audio.js / electron-main |
| Hardware buffer | 128–1024 frames (2.7–21.3 ms @ 48 kHz) | audio settings |

Nothing here is out of line for the design. The dominant *risk* to latency
and glitch-freedom is not steady-state cost but the transient spikes: H1
(record press), H2 (record release), and GC generally. At 128-frame shows,
consider 256 frames unless the extra 2.7 ms is truly felt — it doubles the
GC-pause budget.

---

## Suggested order of attack

1. **H2** — transfer lists on `addBuffer`/`buffers` (one-line each, big win
   at record release, zero behavioral risk).
2. **H1** — reuse the recording backing buffer (small, kills the biggest GC
   hammer).
3. **H4 + H3** — credit listener guard + credit recovery (fixes a real
   "audio died" failure class; do together, they touch the same handler).
4. **M3 (#116)** — meter guards (easy, already spec'd in TODO).
5. **M2** — explicit disconnect of loop nodes; revisit before any 42-channel
   test (#39) and when investigating crash #7.
6. **M4, M5, M1** — opportunistic; measure first (TIMING-REFERENCE.md
   drift methodology).

---

## Fixes applied (2026-07-06, later the same day)

All fixes below are marked with `perf audit <ID>` comments at each change
site — grep `perf audit` to find every touched location. Not committed, no
version bump. Per-fix revert instructions included; each fix is independent
and can be reverted alone.

### H2 — transfer lists on worklet buffer posts ✅

`js/grain-worklet-bridge.js`:
- `hotSwapRecording()`: the `addBuffer` post now names the copy and passes
  `[copy.buffer]` as the transfer list — kills the structured-clone third
  copy of every take, previously deserialized on the audio thread.
- `startWorkletGrain()`: the bulk `buffers` post transfers
  `otherBufs.map(b => b.data.buffer)`.
- Worklet unchanged — Float32Array views arrive intact over transferred
  buffers (`instanceof Float32Array` still true, zero copy).
- **Revert:** remove the transfer-list second argument from both
  `postMessage` calls (and inline the copy back into the message literal).

### H1 — reusable recording backing buffers ✅

`js/audio.js`:
- New module vars `_recRawPool` / `_recRawPoolRate` (above
  `startLiveRecording`). Record press now reuses the pool instead of
  allocating 57.6 MB; growth (takes > 5 min) promotes the grown buffer to
  pool. Stale data past `recordingWritePos` is never read.
- `stopLiveRecording()` no longer nulls `_liveAudioBuf`/`_liveAudioBufLen` —
  the provisional live AudioBuffer is retained across takes, so mid-take
  doubling copies only ever happen for the longest take of the session.
  `S.recordingRaw = null` gate semantics unchanged. Sharing the AudioBuffer
  object across takes is safe: candidate resolution prefers `slot.buffer`
  over `slot.liveBuffer`, so stale refs on finalized slots are never read.
- **Revert:** restore `S.recordingRaw = new Float32Array(sr * 300)` in
  `startLiveRecording`, delete the pool vars + the `_recRawPool = grown`
  line, and restore `_liveAudioBuf = null; _liveAudioBufLen = 0;` in
  `stopLiveRecording`.

### H3 — IPC credit refund on dropped buffers ✅

`electron-main.js` `'audio-buffer'` handler: every consumed buffer now
refunds one credit via a shared `refund()` — written, dropped-during-
teardown, size-mismatch, or write-error. Backpressure is preserved (refund
still arrives only after main processes the buffer). Also removed the dead
`_ipcAudioCredits` / `IPC_AUDIO_MAX_CREDITS` mirror (written, never read —
flagged in GROUP-SHOW-NOISE-GLITCH.md §6).
- **Revert:** move the credit send back inside the success path only and
  restore the two dead declarations.

### H4 — register-once credit listener ✅

`js/audio.js` `initSpeakerBuses()`: credit balance moved to module scope
(`IPC_CREDIT_MAX`, `_ipcCreditBalance`, `_creditListenerRegistered`, declared
above the function); balance resets to max on every re-init; the
`onAudioCredit` IPC listener registers exactly once per session instead of
stacking per device/channel change.
- **Revert:** restore closure-local `let _audioCredits = 8` + unconditional
  registration; delete the module-scope block.

### M2 — deterministic loop node teardown ✅

`js/grain.js`:
- New export `releaseSeqNodes(seq)` (below `killAllGrains`) — stops +
  disconnects source, gain, and the per-speaker VBAP fan-out / panner;
  idempotent.
- Mute branch (slots beyond `commitSlotCount`) calls it instead of bare
  `stop()`; `needsNewSource` block calls it before building replacement
  nodes (mute/unmute cycles previously orphaned N-per-speaker gains each
  time, still connected to the buses).

`js/ui-sweep.js` `eraseAll()`: loop slots released via `releaseSeqNodes`
instead of bare `_sourceNode.stop()`.
- Normal release paths in ui-presets.js already disconnected properly —
  unchanged.
- **Revert:** restore the bare `stop()` calls in the three call sites and
  delete `releaseSeqNodes` + its import in ui-sweep.js.

### M3 / #116 — meters skip work while hidden ✅

- `js/ui-meters.js` `tickMeters()`: early-return when the container sits
  inside a `.collapsed` panel/section (container element cached in
  `_getMeterCache`). Analysers stay connected.
- `js/ui-meters.js` `updateGateLight()`: skips the analyser read, RMS, and
  draws when neither gate canvas is visible (`offsetParent === null` covers
  modal-closed and collapsed-panel). `asGateLight` is CSS-only — staleness
  while hidden is harmless.
- `js/ui-audio-settings.js` `startMetering()`: refuses to start unless the
  audio-settings modal has the `open` class — device-activation paths were
  starting a ~60 fps RAF against the closed modal for the rest of the
  session (`stopMetering()` was already wired to both close paths).
- **Revert:** delete the three guard blocks.

### Retention note — `[dir]` log gating ✅

`js/grain-worklet-bridge.js` feedback handler: the ~1 Hz `[dir]`
`console.log` became a debug-gated `dlog` (ungated it retained thousands of
console entries over a show with DevTools open).
- **Revert:** restore `console.log`.

### Verification checklist (before next show)

1. Record → paint → stop, several takes: sound identical; `wg.diag()`
   sane; heap no longer saw-tooths ~60 MB per take (DevTools Memory).
2. Record a take, release: no hiccup at release (H2) — worst case test is a
   long (> 2 min) take.
3. Electron: switch output device twice, change channel count: audio
   returns each time (H3/H4); no stacked `[audio-credit]` behavior.
4. Collapse the levels/cursor panels: CPU in DevTools performance monitor
   drops; expand → meters resume instantly (M3).
5. Open + close audio settings: modal meters run only while open (M3).
6. Drop 3 loops, cycle `commitSlotCount` below/above them repeatedly, then
   erase-all: no audio artifacts, loop resume works (M2).
7. Erase→undo and erase-mid-recording ear checks still pass (regression vs
   today's glitch fixes).
