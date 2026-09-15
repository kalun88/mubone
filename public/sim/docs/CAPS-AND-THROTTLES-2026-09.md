# Caps and throttles — what still earns its place

> **Status: CURRENT.** P1–P6 all shipped 2026-09-06, each marked DONE below with what it measured;
> the rulings they left are one paragraph in `docs/RULINGS.md` ("A cap protects the thread; the
> THROTTLE reads the thread"). § 1–3 are the measurements and stay the reference — what the gauges
> cost, and how to tell that a machine is near its limit. Written 2026-09-06 after the
> transport rebuild and R4's grain-major loop, at Ek's request: *"a more thorough check on all these
> previous throttles that are now hurting the app… and I don't want to add all the measuring gauges
> when they themselves cost a lot of CPU."* Nothing here is built. § 1–3 are measurements and
> findings; § 4 is the ranked plan, each item with what proves it.

## Read this first

- **The gauges are not the problem, with one exception.** The audio thread's own instrumentation
  (`_diag`, the per-block timing, the 30 Hz feedback post) is **below the noise floor** — smaller
  than the run-to-run spread of the same bench. The one that costs is the **4 ms event-loop timer**
  in `electron-loop-probe.js`: **≈1 % of a core per process, always**, and it runs in two processes.
- **The throttle keys on the wrong variable.** The worklet thins grains when the POOL is 75 % full
  (192 of 256), not when the machine is actually near its limit. On a fast machine it thins with
  most of the thread idle; on a slow one it would not thin at all while already over budget.
- **256 was set against a cost that no longer exists.** R4 more than halved what a grain costs
  (48 % → 23 % mean for the same 198 grains, measured in the app). The cap has not moved since.
- **There is no single "definitive number" for the limit**, and asking for one is the trap. There is
  a GROUND TRUTH (holes that were actually played) and a LEADING INDICATOR (time in the callback
  against the block budget). § 3 says why the second must be a peak over a short window, not a mean.

## 1. What the gauges cost — measured, not assumed

| gauge | where | cost | verdict |
|---|---|---|---|
| per-block timing (`Date.now()` × 2, `_procMs`) | audio thread | **unmeasurable**: −5.0 µs against a spread of 11–15 µs on a 450 µs block, and the two stripped variants disagree in sign | keep |
| the 30 Hz feedback post (ids + `_diag`) | audio thread | same — inside the noise | keep |
| `timed()` around a callback | main + host | **0.16 % of a core** at 800 calls/s (0.31 % measured against 0.14 % for the same calls untimed) | keep |
| the **4 ms loop-gap timer** | main **and** host | **0.97 % of a core, per process** — 250 wakeups/s each, running whether or not anyone is reading | **fix (P1)** |

Method: `scripts/` has none of this — it was a scratch bench that loads
`grain-engine.worklet.js` three times (as shipped, with the timing wrapper removed, with the
feedback post removed too), interleaved over seven rounds, medians reported. The loop-timer figure
is `process.cpuUsage()` over 8 s of a bare node process running the same interval. **Caveat:** the
worklet figures are node's JIT, not the browser's audio thread, and this laptop, not the rig; they
are a comparison between variants, not an absolute. The app-side figures quoted elsewhere
(`loadPct`) are real, from `scripts/transport-probe.js`.

## 2. Every cap in the hot path

| cap | value | what it protects | does it bind? | verdict |
|---|---|---|---|---|
| `POOL_SIZE` | 256 | the audio thread | **yes** — the probe's dense phase sits at 197 mean, 255 peak | raise; make it a setting (P2) |
| pressure throttle | 75 % of pool = 192 | cascade overload, grain stealing | **yes**, at any dense setting | **wrong variable** — drive from load (P3) |
| `FEEDBACK_RING_SIZE` | 256 | the size of one feedback post | rarely, but it silently caps GLOW accuracy | tie to the pool (P2) |
| `MAX_CURSOR_VOICES` | 8 | worklet voice slots under the cursor | when more than 8 distinct brushes are in reach | measure per-voice cost first (P4) |
| `MAX_SEED_VOICES` | 40 | worklet voice slots across clouds | 16 clouds × their voicings | probably not; re-measure with P4 |
| `MAX_COMMITS` | 16 | pins | a musical choice, not a CPU one | leave |
| `REACH_MAX` (renderer) | 128 | the reach fan's projection cost | **yes** — at lens "all" over a dense set the fan vanishes entirely | it is a cliff where alpha already degrades smoothly (P5) |
| `_TRAIL_BUDGET` | 120 | moving-cloud trails | with several moving clouds | leave until the renderer gets its own R4 |
| `_LINE_SMOOTH_BUDGET` | 800 | stroke smoothing | rarely | leave |
| `GLOW_MIN_MS` | 80 | glow legibility | by design | leave |
| `minPeriodS` | 50 µs | nothing any more | no | leave |
| `SCHED_LOOKAHEAD` | 40 ms | seed onset clocks | now 4 ticks, was 2 | check with P3 |
| `MAX_CHANNELS` (worklet) | 16 | **nothing — it is declared and never read** | no | delete (P6) |

**The musical case for P2 and P3, in numbers.** The wash's factory block is 400 ms grains every
15 ms: ~27 grains alive per voice. Eight brushes' worth of that under one cursor is ~216 — past the
192 threshold, so the instrument starts randomly dropping onsets while the audio thread is at a
fifth of its budget. That is the throttle taking musicality away to protect a ceiling that no longer
needs protecting.

## 3. The best measure of "approaching the limit"

Two numbers, answering different questions. Neither is a single definitive figure, and a synthetic
"CPU %" of the whole app would be worse than both.

- **Ground truth: holes that were played.** `outDry` / `inDry` — the audio host counts device
  callbacks against writes, so it knows exactly when the queue ran empty. Not an estimate.
- **Leading indicator: time in the callback ÷ the block budget.** The budget is **2.667 ms per
  128-sample block** at 48 kHz — fixed by Web Audio, and NOT changed by the RtAudio buffer size
  (R7's 64-frame buffers halve the device callback, not the render quantum). This is the DSP-load
  meter every DAW shows, and the app already has it as `_diag.loadPct`.

The subtlety that matters, and the reason games moved from average FPS to frame-time percentiles:
**the mean is not what fails you.** One block over budget is an audible click, unrecoverable. So the
number to act on is the PEAK over a short window. Two limits shape how well that can be done here:

- **The audio thread has no high-resolution clock.** Measured 2026-09-06: `performance` is
  `undefined` in `AudioWorkletGlobalScope` on this Electron; only `Date.now()` (1 ms),
  `currentTime` and `currentFrame` exist. A 1 ms clock on a 2.667 ms budget cannot resolve a single
  block's time — `procMaxMs` can only ever read 0, 1, 2, 3.
- **So the honest substitute is a SHORT window**: sum the timing over ~32 blocks (85 ms) instead of
  the current ~375 (1 s). The averaging error stays small and a burst stops being averaged away.
  This costs nothing new — it is the accumulator already there, reported more often.

**What not to use:** grain count (a grain's cost varies with filters, channels and buffer kind),
pool occupancy (the same, and it is what P3 removes), and any whole-process CPU figure (it includes
the GUI, and it is the wrong thread).

## 4. The plan, ranked

Each item says what it gains, where it lands, and what proves it. **Every item's proof includes a
musicality check, not only a CPU number** — the point is to stop the instrument thinning what it was
asked to play, not to win a benchmark.

### P1 — the loop probe stops costing 2 % of a core — DONE 2026-09-06
- **Gain:** ~1 % of a core back in each of two processes, permanently, including on battery; and the
  audio host stops waking 250×/s on the loop it is supposed to be measuring.
- **Where:** `electron-loop-probe.js`.
- **How:** the timer runs only while someone is reading — armed by the first `stats()` call and
  disarmed after ~10 s of no reads, so `wg.status()`, the probe and Settings → Audio all still work
  and a show carries nothing. Period 4 ms → 10 ms while armed (a 10 ms gap is still caught; the
  20 ms bucket is unaffected).
- **Prove:** `process.cpuUsage()` on the host with nothing reading (expect idle), then with the
  probe attached (expect the gaps still reported); `transport-probe.js` unchanged in every phase.

### P2 — the pool is a setting, and the glow ring follows it — DONE 2026-09-06
- **Gain:** the cap stops being a number from 2026-03 and becomes the machine's choice; the glow
  stops lying about which marks sounded.
- **Where:** `POOL_SIZE` / `FEEDBACK_RING_SIZE` in `grain-engine.worklet.js` (both from an `init`
  field), `js/state.js` (`maxGrains`, persisted), Settings → Audio beside buffer size and cushion.
- **How:** "max grains", the polyphony control every synth has: 256 / 512 / 1024, default 512,
  with the measured headroom shown beside it. The ring is always the pool's size, never its own
  number. The worklet allocates its slot arrays from that value at `init`.
- **Prove:** at each setting, `transport-probe.js`'s dense phase for load and 0 faults; a glow count
  check (every particle that fired appears in `activeGrainMap` within a feedback window); and by ear
  on a wash across several brushes — the sound must get thicker, not just busier.

### P3 — the throttle reads the load, not the pool — DONE 2026-09-06
- **Gain:** the instrument plays what it was asked to play until the machine is actually near its
  limit, and then thins gracefully — on any machine, at any grain cost. This is the musicality item.
- **Where:** the pressure block in `_render`, using the short-window load of § 3.
- **How:** skip probability rises from 0 at ~70 % of the block budget to 1 at ~95 %, measured over
  ~32 blocks; pool exhaustion keeps its steal as the last resort, and steals stay counted. The two
  thresholds are constants with the reasoning beside them, not settings.
- **Prove:** three scenes — factory wash, eight-brush wash, and the probe's dense phase — with
  onsets counted before and after (the factory scenes must lose NOTHING); a synthetic overload
  (period at the floor) must thin instead of stealing, with `_diagSteals` at 0 and `outDry` at 0;
  and `npm test` + `rig-audit "mark align"` green.

### P4 — the voice caps, re-measured — DONE 2026-09-06
- **Gain:** either more distinct brushes audible at once, or a documented reason for 8.
- **Where:** `MAX_CURSOR_VOICES` (8), `MAX_SEED_VOICES` (40), in the worklet and the bridge together.
- **How:** measure the per-voice fixed cost (an onset clock and a params block per voice, per block)
  the way § 1 measured the gauges, then set both from that. They must move together — the bridge and
  the worklet each hold their own copy of the number today.
- **Prove:** the bench at 8 / 16 / 32 cursor voices; then the musical case — paint with more brushes
  than the cap and sweep, and hear whether the oldest voicings drop.

### P5 — the reach fan's cliff — DONE 2026-09-06
- **Gain:** the fan stops disappearing exactly when the lens is widest, which is when it is most
  wanted.
- **Where:** `REACH_MAX` in `js/renderer.js`.
- **How:** the comment above it already says alpha degrades where a hard cap falls off a cliff. Draw
  a sampled subset above the cap rather than nothing, or raise the cap and let alpha carry it.
- **Prove:** `ui-shots.js` at lens "all" over a dense set, and the render loop's own frame budget.

### P6 — delete `MAX_CHANNELS` — DONE 2026-09-06
- Declared in the worklet, never read. The real ceiling is `WEB_AUDIO_MAX_CH = 32` in `js/audio.js`.
  Deleting it removes a number that looks like a rule and is not one (`deadweight-audit.js`).

### What they measured

| item | before | after |
|---|---|---|
| P1 | the gap timers ran from load, 0.97 % of a core × 2 processes | armed only while read; the app tree drew 3.3 points less of a core idle |
| P3 | eight wash brushes thinned to 201 grains at a fifth of budget | 213, nothing thinned below the load thresholds; factory density untouched (27 = 27, 107 = 107) |
| P2 | pool 256, ring 256, 247 alive at 25 % load | a setting: 512 → 484 alive at 38 %, 1024 → 863 at 70 % where the load throttle takes over; 0 steals at every size |
| P4 | 8 cursor voices, 40 seed voices | 16 and 64 for 0.16 % of the block budget; twelve voicings under one cursor each got a region, four would have been silent |
| P5 | no fan at all above 128 marks | 125 sampled segments with a 3000-mark pool |
| P6 | `MAX_CHANNELS` looked like the channel ceiling | gone; the real one is `WEB_AUDIO_MAX_CH` |

### Order and gating
P1 first (it is small, and it makes every later measurement cleaner). P3 before P2: with a
load-driven throttle the pool cap matters much less, and P2's default should be chosen with P3 in
place. P4 and P5 after, independently. **Nothing here goes to the rig without the two runs of #347**
— every number in this document is from one laptop.

### From the settings dialog

Cut from the settings rows on 2026-09-14 when descriptions went to one sentence under 92
characters (align-audit R5). The rows keep the sentence that says what the control does; this is
everything else they were carrying. **Checked before appending: only 7 of the 40 distinctive
clauses across all nineteen cuts appeared anywhere in docs/ beforehand, so this is not a
duplicate of what follows — for most of these rows the settings dialog was the only place the
information existed.**

**Latency.** The time between a sound and its sample, in and out. The tape engine steers by it: a loop's edges follow your press and release, an overdub lands where you sang it. The estimate comes from the streams; Measure plays six clicks and listens for them — it needs the output to reach the mic (speakers, or a cable). Stored per device pair and rate as the devices' own share, so the buffer and the cushion can change without measuring again.

**Sample Rate.** 48 kHz is what the rig runs and what everything is tuned to. 96 kHz doubles the samples in every grain, so the pool thins sooner; it restarts the engine and both devices need re-picking after.

**Buffer Size.** The native output block — Web Audio's own is fixed at 128 frames and no setting moves it. This is the dropout remedy, not a quality control: 128 frames is 2.7 ms at 48 kHz, and a bigger one only buys headroom. Needs a restart.

**Stall Cushion.** How deep the two hops between the engine and the interface may run: the output queue and the input ring. Latency against stall tolerance — a freeze longer than this is a dropout; shorter cushions are tighter to play against. Applies at once, on any interface.

**Max Grains.** How many grains may sound at once, and how many marks may light with them. The engine thins by its own load before this is reached, so raise it for a thicker wash and lower it only on a machine that struggles. Applies at once; anything sounding stops.

**Output Ceiling.** The last stage before the interface, after master: transparent below −3.1 dBFS and bit-exact there, holding −0.1 dBFS above it, linked so the spatial image cannot shift. Nothing to set. If this reads anything but idle, the lever is master, the brush's volume or the grain pool.

**Recording Limit.** Live recording stops when the buffer reaches this. Sweep to free space — undo stays available for 30 s.
