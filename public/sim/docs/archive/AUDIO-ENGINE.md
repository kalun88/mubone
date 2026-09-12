# The audio engine, from the microphone to the speakers

> **Status: ARCHIVED 2026-09-05** — part one was a reading copy of the engine written 2026-09-02; the code is the copy that is kept current. Part two's three rules (tail, frontier, `whenSealed()`) are one paragraph in `docs/RULINGS.md`. Record only.

> **Status: CURRENT** — a reading copy of how the engine works, written 2026-09-02 from the
> code (`js/audio.js`, `js/grain.js`, `js/grain-worklet-bridge.js`,
> `js/worklets/grain-engine.worklet.js`, `js/paint-ticker.js`, `js/brush-voicing.js`) while
> chasing the release glitch recorded in Part two. Part one describes shipped behaviour as of
> 1.13 alpha; Part two is the record of one bug, its three causes and the four changes that
> fixed it the same day. If this disagrees with the code, the code wins — fix this.
> `docs/archive/TIMING-REFERENCE.md` is the master table for every number quoted here.

---

## Part one · How the sound gets made

### 1 · The shape of it

mubone does one thing with sound: it records what you play, and then plays tiny pieces of
those recordings back, chosen by where you are pointing. Everything else is plumbing around
that idea. Three objects are worth holding in your head.

- **A take** is a recording. It is a plain array of samples, made while you hold space, and it
  never changes after it is sealed.
- **A mark** (a particle, in the code) is a dot on the sphere that points at one moment inside
  one take. A mark carries no audio of its own. It says "take 3, at 1.240 seconds", plus where
  it sits on the sphere, which brush painted it, and how loud and bright the input was at that
  moment.
- **A grain** is a short window of a take, a few milliseconds to a second long, played once
  with a fade in and a fade out. Hundreds can sound at the same time. A grain starts where a
  mark points.

So the sphere is a map of moments, and the cursor is a reading head that fires grains from
whatever marks are near it.

```
MAIN THREAD  (can be late)
  cursor ──▶ paint ticker ──▶ scheduler ──────────────▶ sphere & glow
             drops a mark     picks marks, 50 Hz          draws, 30 fps
             20 Hz                │  candidates ▼      ▲ which marks fired, 30×/s
AUDIO THREAD (never late, 128 samples at a time)
  mic ──▶ input chain ──▶ recorder (the take)
                     └──▶ grain worklet (256 slots) ──▶ buses ──▶ speakers
                     └──▶ dry monitor ─────────────────▶ house bus
```

Audio never leaves the bottom band. The top band only decides which marks the worklet should
be reading, and hears back which ones fired so the sphere can glow. The two bands talk through
messages, never through shared timing.

### 2 · Two threads, two clocks

Web Audio runs the sound on its own thread, in blocks of 128 samples. At 48 kHz a block is
2.67 ms, and the audio thread must finish each block before the next one is due, or you hear
a dropout. Nothing on that thread may allocate memory, wait, or do anything whose cost it
cannot predict. The grain worklet lives there.

The main thread runs everything else: the sphere, the UI, the sensor, and the scheduler that
decides what to play. It is allowed to be late, and it often is. Drawing a dense sphere can
take longer than a frame. So the design puts nothing time-critical on the main thread. The
scheduler only chooses; the worklet fires. If the main thread stalls for a frame, the worklet
keeps firing from the last list it was given.

The two threads share exactly two things. The scheduler posts a small message about fifty
times a second (`GRAIN_SCHEDULER_INTERVAL_MS`): here are the marks near the cursor, with the
buffer each lives in, the sample offset, the speaker angle, and the brush settings to use. The
worklet posts back about thirty times a second (every 1600 samples): here are the marks that
fired since last time, so the renderer can light them up, plus a line of diagnostics. Neither
side ever waits for the other.

### 3 · The input chain

Your signal enters once and is tapped three times. In the browser the source is the microphone
through getUserMedia, with echo cancellation, noise suppression and gain control switched off.
In Electron the interface is opened directly by RtAudio in the main process, which sends raw
interleaved samples over IPC into a small worklet (`input-meter.worklet.js`) that de-interleaves
them into channels and a ring buffer, so you can record from any input on a 32-channel
interface rather than the two the browser would allow.

```
browser mic ───────────────────────────┐
RtAudio in ──▶ IPC ──▶ ring, pick ch ──┴──▶ input gain ──▶ analyser (256) ──┬──▶ recorder
                                              │                              ├──▶ grain worklet (live input)
                                              └──▶ loudness analyser (2048)  └──▶ dry monitor ──▶ house bus
```

The recorder and the grain worklet hang off the same analyser tap, so the take and the live
grains hear identical audio. The dry monitor is your own sound passed straight through, placed
on the sphere where the cursor is, and ducked while a granular take is recording.

The analyser after the gain node is small on purpose, 256 samples, because it is read for
colour: spectral centroid and zero-crossing rate become each mark's hue. Loudness is measured
by a separate 2048-sample analyser in `audio-features.js`, read by the render loop thirty
times a second. Each read takes only the samples rendered since the previous read, counted
off the audio clock, so the reads between two marks add up to exactly the audio between them
— a hit cannot slip between reads and cannot be counted twice. The hold is a plain max,
consumed to zero at each mark (`consumeWindowLoudness`).

### 4 · Recording a take

When you press space, two copies of the recording start growing at once, in two places, for
two reasons.

The first copy is the take proper. A small recorder worklet (`recording-capture.worklet.js`)
collects blocks and posts them to the main thread in bundles of 2048 samples, about every
43 ms, where `_acceptBundle` in `audio.js` writes them into a five-minute pool that is
allocated once per session and reused. This copy is what gets sealed when you release: the
last five milliseconds at each end are faded to stop clicks, an AudioBuffer is built, and the
take becomes permanent. **Sealing waits for the recorder's final bundle** — see Part two, § 14.

**The take's clock and its edges (2026-09-04, #332).** Every take records `startedAt`, the audio
clock at its first sample, and the recorder is exact to it inside the graph: a click scheduled on
the clock lands at 0.00 ms error. A HIT take (the line brushes, the overdub) also records
`releaseAt`, is held open past the release by `S.latency.inS` so the sound of the release lands,
and is sealed with `edges = [inS, end]` — the region between the two presses as the mic heard it.
A line or a loop reads the edges while its stroke is untrimmed; the marks are the drawing. What
the clock cannot see is outside the graph — the input hop in and the output hop out —
and `js/latency.js` carries that: an estimate from the streams, or a loopback measurement, that
moves a loop's edges by the input side and an overdub's phase by the round trip.

**The hops are bounded (#333).** Out: the capture worklet batches one block, the renderer sends
it over IPC while it has a credit, the main process queues it into audify, and a credit comes
back when the block has PLAYED — so the queue never holds more than the credit window, which is
the stall cushion in blocks. In: RtAudio's callback ships a chunk over IPC into the input ring,
which the graph reads as it fills; after a burst leaves the ring deeper than the cushion, the
reader skips to it. Before this the queue held whatever lead had built up and the ring held the
worst burst since its last dry-out, and neither was visible: 94 ms measured at 128 frames on a
MacBook, of which the buffer was 5.

The second copy lives inside the grain worklet, which has the microphone wired straight into
its input while you record. Every block, it appends the 128 samples it received to its own
live buffer (30 s chunks, bufIndex −2). This is why you can hear grains from a take you have
not finished yet: the worklet has the audio the instant it exists, with no trip through the
main thread. Marks painted during the recording resolve to this live buffer, and grains fired
from them read it while it grows. Every 50 ms (`LIVE_REBUILD_INTERVAL_MS`) the main thread
also refreshes its own view of the live buffer, only so it can compute offsets for marks; no
audio goes through it.

```
main thread   ▓▓▓▓▓▓▓|▓▓▓▓▓▓▓|▓▓▓▓▓▓▓|▓▓▓▓▓▓▓|▓▓▓▓      43 ms bundles → sealed at release
grain worklet ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    128 samples per block, read as it grows
                          ▒▒▒▒▒▒▒▒▒  ▒▒▒▒▒▒▒▒▒▒         grains from marks painted during the take
                                                    ┃ release
                                        sealed take ──copy──▶ worklet sample buffer N
                                        marks switch to it on the next 20 ms tick
                                        live buffer cleared 500 ms later, so in-flight grains can finish
```

A take shorter than 80 ms is treated as an accidental graze and thrown away. Otherwise it goes
into `S.liveRecBuffers`, the marks painted during it are clamped to its final length, and
`hotSwapRecording` hands the sealed copy to the worklet as a numbered sample buffer. The
provisional live buffer is not cleared immediately: grains that started from it are still
playing, so it is left alone for half a second. Every take counts toward a memory limit, ten
minutes by default, and the HUD goes red when you reach it.

### 5 · Marks on the sphere

While you paint, `paint-ticker.js` drops a mark every 50 ms. It polls at 200 Hz so the timing
does not depend on how fast the sensor or the mouse happens to be reporting. The interval is
the instrument's scrub resolution: a grain can only begin where a mark landed, unless start
jitter is on, which randomises the read offset around the mark.

Each mark records, at the moment it is dropped:

- **Where** it is on the sphere, in longitude and latitude, after the brush's head offset has
  been applied. A wide brush head scatters marks around the cursor rather than on it.
- **When** in the take it points at. During a recording this is the wall-clock time since
  record was pressed (`getRecordingDuration`). When you paint from a loaded sample instead, it
  is a position inside the sample's crop. This is the mark's MOMENT, and it is all the mark
  stores about time. **The grain that plays it starts before that moment**, by the time the
  playing voice's envelope takes to peak (`grainPeakOffsetS` in `brush-voicing.js`: half the
  duration for a plain Hann, the fade length for a short attack, zero for rect, scaled by the
  pitch rate), so the mark is the point in the window you actually hear when you rest on it.
  The bridge subtracts that offset per candidate from whichever voice will play the mark — its
  frozen voicing, the live params under the filter, a cloud's own block — so the same mark
  peaks under any engine. Before 2026-09-02 the grain started at the mark, which put the mark
  at the foot of the attack — the one part of the window you can barely hear — so a hit painted
  on a mark was a swell and the mark drawn big for a hit was one or two after the mark you
  heard it from. Loops and triggers read moments and never see the offset.
- **Which brush** painted it, as a small integer called a voicing (`_vo`). This is what makes a
  stroke keep its sound after you change the brush. See § 8.
- **How it sounded**: spectral centroid and zero-crossing rate, read at the mark's own tick, set
  its colour; loudness sets its size and is measured over the window AFTER the mark — from its
  tick to the next — because that is what its grain plays. So a live deposit captures the mark
  as *pending* and lands it one tick later, sized by that window (`_settlePending`). The last
  mark of a stroke settles when the stroke ends, and `stopLiveRecording` settles it before the
  take seals. None of these features are used for audio. Before 2026-09-02 the size looked
  backward and the grain played forward, and the mark that played a hit was drawn small while
  the one after it was drawn big; `scripts/mark-align-audit.js` is the measurement.
- **Which stroke** it belongs to, so a whole stroke can be held, looped, erased or turned into
  a trigger.

The paint gate sits here too, on the same window: a pending mark whose window is quieter than
the threshold never lands, so silence leaves no dots and nothing flickers. The old gate
lookback, which backdated the first mark after silence to catch the consonant that opened the
gate, is gone: the mark whose window holds the transient already starts before it.

### 6 · The lens: choosing what to play

Every 20 ms `scheduleGrains()` asks one question: which marks should the cursor be reading
right now? The answer goes through four filters, in order.

1. **Geometry** — inside the search radius, or the whole sphere in nearest mode. Angular
   distance from the cursor to every mark is one dot product on cached unit vectors, cached
   again if the cursor has not moved.
2. **Recency** — only the N newest strokes per take, when `recencyN` is set.
3. **Ownership** — not a pinned cloud's material (`_claimedByCloud`), and not a trigger mark
   unless dwell is set to grain.
4. **The k cap** — keep the k closest (`_selectPerVoicing`), or all of them in fill mode.

Each chosen mark becomes a candidate: the worklet's index for the buffer it lives in, its
sample offset, its azimuth and elevation for panning, a fade weight if radius fade is on, and
its voicing. Candidates are grouped by voicing in `_postWorkletCandidates`, so marks painted
with different brushes end up in different lists, and the whole set is posted as
`cursorVoices`. If scan is muted, an empty list is posted instead, and the scheduler fakes the
glow so the sphere still shows you where you would be playing.

Two of the lens's settings change the character more than any grain parameter. **k** is how
many marks the cursor reads at once: one gives a mono, vinyl-like scrub; many gives a cloud.
**Order** (`grainKSeqMode`) decides whether grains pick randomly from those marks or step
through them in time order, which turns the cursor into a tape head that plays the take
forward as long as it stays still.

### 7 · Inside the worklet

The worklet is one class with a fixed pool of 256 grain slots (`POOL_SIZE`), all pre-allocated
as flat typed arrays: a read position, a read rate, an envelope phase, a buffer index, a
volume, two speaker indices and their weights, and filter coefficients per slot. Nothing is
allocated while audio is running. Every block it does three things in order.

**Accumulate.** If a recording is in progress, append the incoming 128 samples to the live
buffer.

**Fire.** Step through the block one sample at a time and check each onset clock. There is one
clock for the plain cursor, one for each of up to eight cursor voices (`MAX_CURSOR_VOICES`),
and one for each of up to twenty seeds (`MAX_SEEDS`). A clock holds a period in samples and
the sample count at which it next fires. When the running sample counter passes it, a grain is
fired and the clock advances by the period plus its jitter. Onset timing is sample-accurate
because the decision is made at the sample, not at the block.

Firing a grain (`_fireGrain`) means: pick a candidate from the voice's list, randomly or in
sequence; apply start jitter to the offset; compute the duration with its jitter; compute the
read rate from pitch shift and pitch jitter (`2^(cents/1200)`, negated for reverse); **fit the
grain to the audio that exists** (Part two, § 12 — the grain keeps its mark and shortens);
pick the speaker pair from the VBAP table by azimuth; compute filter coefficients; write
everything into a free slot. If the pool is more than three quarters full, onsets are randomly
skipped with rising probability, which keeps a dense patch from stealing its own grains.
Everything about a grain is settled at the instant it fires and nothing changes afterwards,
with one exception: the landing in § 13.

**Render.** For every active slot, read one sample from its buffer with linear interpolation,
run it through the slot's high-pass and low-pass biquads, multiply by the envelope at the
current phase (hann, triangle or rect; with a fade ratio under ½ a unity sustain opens between
the ramps) and the slot's volume, and add it into the output for that grain's two speakers.
Cursor grains go to output 0, the monitor; seed grains go to output 1, the house. Then advance
the read position by the rate and the phase by one over the duration. When the phase reaches
one, the slot is freed. Near the poles an elevation bias spreads the grain across all speakers
instead of a pair, because a point straight overhead has no meaningful azimuth.

Every 1600 samples the worklet posts a feedback message: the ids of the marks that fired since
last time, the active grain count, and `_diag` — live buffer length, whether each voice is
active, direction counts, buffer retention, and since 2026-09-02 `steals`, the grains killed
because the pool was full. The renderer uses the ids to light up marks; `_diag` is how you find
out what the audio thread is actually doing, since it cannot print.

### 8 · Brush, lens, filter

Three separate owners decide what you hear, and keeping them separate is most of the design.

- **The brush owns the sound.** Period, duration, volume, pitch, the jitters, the envelope
  shape and fade, the filters, the pan spread — the block `resolveGrainParams()` builds in
  `brush-voicing.js`. A stroke freezes that block at the moment it is painted. Editing the
  brush afterwards changes what you paint next, never what is on the sphere. Identical blocks
  are interned: paint five strokes without touching a knob and they all point at one voicing.
- **The lens owns how the cursor reads.** Search radius, nearest mode, recency, radius fade,
  head-locked or world-locked panning, and, since #233, k and the fill and order modes. None
  of these live in a patch. They describe the reader, not the material.
- **Wet paint** (2026-09-03, `brush-voicing.js` "Wet paint") is the one exception to
  freezing, and it is the brush's to declare: a brush switched WET in its sheet owns one
  voicing, every stroke it paints points at it, and the brush's knobs edit that voicing in
  place, so every stroke it painted follows them for as long as it stays wet. Only the sound
  moves, never where the marks sit. The bridge posts each voice's params every tick, so the
  worklet simply sees new numbers. Switching wet off dries the strokes where they sound. A dry
  brush's strokes can be moved by nothing, which is what makes them trustworthy. This replaced
  the grain filter (#292) and audition (2026-08-29), both of which forced every cursor
  candidate onto voicing 0 to hear the whole sphere through one engine.

In the worklet these are the eight cursor voices. Voicing 0 always mirrors the global
parameters. Any other voicing is a frozen block sent once and reused. The scheduler buckets
candidates by voicing, and each bucket goes to its own voice with its own onset clock. Density
belongs to the clock, which is why two brushes with different periods could never have been
faked with per-grain parameters.

### 9 · Pins: clouds, loops, triggers

A pin is material that keeps sounding after the cursor has left. Twenty commit slots are shared
by two kinds.

**A cloud** is a second cursor, planted and left running. It records a position, or a path of
positions if you moved while planting, along with a frozen copy of the brush and the lens
settings at that moment. Every 20 ms the scheduler runs the same candidate selection for each
cloud that it runs for the cursor, from the cloud's position, and posts the result to one of
the worklet's seed voices. A moving cloud interpolates along its recorded path
(`_interpolateMovingSeed`) and re-selects as it goes. A cloud also claims its material: marks
inside its radius are removed from the cursor's pool, so pinning never doubles a sound.
Stopping a cloud silences it but holds its slot.

**A loop** is different in kind. It is a stroke's stretch of a take played as a plain looping
`AudioBufferSourceNode` with a crossfade baked across the seam (`buildLoopPayload`), not as
grains. Its length is the sealed take from the stroke's first mark to just past its last one.
The playhead's position on the sphere is tracked so the loop is panned to wherever it is in
the stroke, re-aimed with a 15 ms smoothing so it never zips. Muting a loop leaves its source
running, so unmuting brings it back mid-phrase in time with everything else; see
`docs/archive/COMPOSER-MODE-PLAN.md` for why a cloud is *stopped* instead.

**A trigger** (`trigger.js`, `docs/archive/TRIGGER-TOOL-PLAN.md`) is a loop-shaped entry whose
`playing` flag is a function of cursor proximity instead of being pinned true. Sweep past a
trigger stroke and it fires once; stop on it and, depending on dwell, it either loops or opens
up to the granular cursor. A trigger is a view onto a stroke's marks, so erasing part of the
stroke trims the sample.

With blend set to focus (`S.commitPlayback`), the pins nearest the cursor are weighted up and
the rest fade, so a field of pins becomes something you can play by moving through it.

### 10 · Out to the speakers

Two buses collect everything. The **monitor bus** is what the cursor is doing, and the **house
bus** is everything else: seeds, loops, triggers and the dry monitor. The split exists for
improv mode, where the cursor is private to the performer's headphones until a pedal opens a
send (`monitorToHouseGain`) from the monitor bus into the house. Scan mute is a gain of zero
(`cursorMasterGain`) on the monitor's path to the master.

```
grain worklet out 0 ──▶ monitor bus ──▶ scan mute ──┐
                              └── pedal send ──▶ house bus ──▶ house gain ──┤
grain worklet out 1 ─────────────────────────────▶ house bus                ├──▶ master ──▶ soft clip ──▶ meter ──▶ mute
loops · triggers · dry monitor ──────────────────▶ house bus                │
                                                                            browser:  ──▶ destination (stereo)
                                                                            electron: ──▶ headphone mix only
electron house output: speaker buses (one gain per speaker, VBAP) ──▶ merger ──▶ capture worklet ──▶ IPC (8 credits) ──▶ RtAudio out
```

**VBAP** is how a grain lands between speakers. At setup (`initSpeakerBuses`), the speaker
angles are laid out around the circle, evenly by default with a phantom centre for even
counts, or from the custom angles you entered. A 360-entry table (`buildVBAPLookup`) is built
once: for every whole degree, the two speakers that bracket it and a pair of gains, cosine and
sine of the position between them, so power stays constant as a sound moves across the pair.
Placing a grain is one table lookup. Head-locked mode rotates the mark into camera space
first, so the room turns with you; world-locked leaves it in sphere space, so the room stays
put.

The master chain is a gain, then a tanh soft clipper with 2× oversampling instead of a
compressor, because a compressor's attack time let whistle transients through and its
behaviour changed with frequency. After that an analyser for the meter, then the mute, placed
last so the meter keeps reading while muted.

The Electron exit has the most moving pieces. Speaker buses feed a channel merger, which feeds
`quad-capture.worklet.js`, which batches blocks into exactly one RtAudio write's worth of
frames, 1024 by default. Each batch is posted to the main process, which writes it to the
interface. Eight credits are allowed in flight; the main process refunds one per buffer it
consumes, written or dropped, and the renderer stops sending when it has none. That bounds
latency at about 170 ms worst case and stops the queue growing without limit if the interface
stalls. Three clocks are involved — the RtAudio input stream, the AudioContext, the RtAudio
output stream — and when any two disagree, a hand-off buffer runs dry or overflows. Since
2026-09-02 those events are counted (Part two, § 15).

### 11 · The numbers that matter

`docs/archive/TIMING-REFERENCE.md` is the master table. The ones that shape what you hear:

| Thing | Value | Why it is that |
|---|---|---|
| Audio block | 128 samples · 2.67 ms | Fixed by the Web Audio spec |
| Scheduler tick | 20 ms · 50 Hz | How often marks are re-chosen |
| Mark interval | 50 ms · 20 Hz | The scrub resolution; 5–500 ms at runtime |
| Gate lookback | ≤ 50 ms | First mark after silence is backdated to catch the attack |
| Feedback | 1600 samples · 33 ms | How often the worklet reports what fired |
| Grain pool | 256 slots | Throttling starts at 192; beyond 256 the oldest is stolen |
| Cursor voices | 8 | Distinct frozen brushes the cursor can read at once |
| Seeds | 20 | Commit slots shared by clouds and loops |
| Shortest fade | 2 ms | Below this a fade is an edge; an explicit 0 is still allowed |
| Recorder bundle | 2048 samples · 43 ms | How the take reaches the main thread |
| Live buffer chunk | 30 s | The worklet's live buffer grows in chunks; the first is kept warm |
| Declick | 5 ms each end | Applied to the sealed take; was 50 ms, which buried attacks |
| Shortest take | 80 ms | Below this the press is a graze |
| Output buffer | 1024 frames · 21 ms | One RtAudio write |
| IPC credits | 8 | Output buffers in flight; ~170 ms of queue at worst |

---

## Part two · The release glitch (2026-09-02)

Ek's report: recording with the cursor granulating, releasing space early — a quick 500 ms
burst with a 700 ms grain duration — gives a small reset sound, then nothing, then the audio
"catches up" as if the sample restarted. Plus intermittent crackle that was hard to reproduce.
Three causes, all found by reading; four changes, all shipped the same day.

### 12 · Every grain in a short take collapsed to sample 0

Say the grain duration is 700 ms and you hold space for 500 ms, dropping a mark every 50 ms.

```
While you hold space           take ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓┃ live edge
  mark at 100 ms                    ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒┃╌╌╌╌  each grain starts at its mark
  mark at 250 ms                          ▒▒▒▒▒▒▒▒▒▒▒▒▒▒┃╌╌╌╌  and rides the edge, waiting for
  mark at 400 ms                                   ▒▒▒▒▒┃╌╌╌╌  audio you have not played yet

After you let go (OLD)         take ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ sealed at 500 ms
  mark at 100 ms               ◀────▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒
  mark at 250 ms               ◀────▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  all three moved to 0, play the whole
  mark at 400 ms               ◀────▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  take. Three marks, one sound.
```

The fixed-buffer clamp in `_fireGrain` handled a grain that would run past the buffer end by
sliding its start back so the full duration was preserved ("character stays consistent
instead of getting shorter near the buffer end"). Written for the middle of long takes, where
a slide of a few milliseconds is invisible. On a 500 ms take with a 700 ms grain nothing fits,
so every mark slid to sample 0 — the "sample restarts". The general form hit every take: the
last grain-length of any recording sounded identical from every mark in it. A quick blurp is
all tail.

**Ruling (Ek, 2026-09-02): a mark points at a moment, and the grain plays what is there.** The
slide is gone. A grain starts at its mark and its envelope lands on the last sample; under 64
samples it is dropped rather than played as a click. This applies uniformly to takes and
loaded samples. The onset clock is untouched, so density stays what the brush says — only the
grain's length yields. Sweep ten marks on a triangle hit and mark 1 plays the whole hit, mark 5
from the middle, mark 10 the last 50 ms of the decay, which is also what you heard while
painting it.

### 13 · The click and the gap: frontier grains were hard-cut

While recording, a live grain is exempt from the clamp and follows the growing buffer — it
keeps its full length and reads audio as you play it, so a 1000 ms grain from the newest mark
is a moving 1000 ms window on your live playing, delayed by the gap between the mark and the
edge. It does not shorten and does not cycle faster; the period is the period.

On stop, `liveRecStop` snapshotted the buffer length into each live grain and reads past that
length returned zero. A grain riding the edge was reading right at the boundary, so it went
silent mid-envelope with no fade: the click. The grains that replaced it all started at
sample 0 (§ 12) and had to climb their attack: the gap, then the "catch up".

The same hard cut happened *during* recording whenever a read head crossed the edge: pitch
shifted up (rate > 1 overtakes it), direction reverse or random (the grain starts beyond it
and reads zeros until the edge passes), or start jitter landing past it. A comment in the
worklet described a "micro-fade zone" that guarded this; no such code existed.

**Shipped** (`grain-engine.worklet.js`):

- `liveRecStop` calls `_landGrainOnEdge` on every live grain: the rest of the envelope is
  re-timed to reach zero exactly where the audio ends (never faster than one block). A grain
  in its sustain jumps straight to the start of its release — the level is 1 on both sides of
  the jump — so only the release spans the audio left, instead of the sustain being compressed
  too. A grain still in its attack is compressed whole.
- At fire time during recording: a forward grain aimed past the edge starts at the edge; a
  pitched-up grain ends where it would overtake the edge, `(edge − offset) / (rate − 1)`; a
  reverse grain starts at the edge and walks down.
- `liveBufferInit` (a second press within one grain-length of the first release) fades the
  previous take's live grains over one block before chunk 0 is overwritten under them;
  `liveBufferClear` does the same for grains reading chunks it is about to free.
- A rect envelope still cuts hard at the edge, because rect has no envelope to land. That is
  what rect means.

### 14 · Every take lost its last bundle

The recorder posts 2048-sample bundles, and the final partial one only arrives a task after
'stop' is sent. `_captureStop` posted stop and then, in the same instant, sealed the take from
what had *already* arrived; the last bundle landed after `S.recordingRaw` had been nulled and
was dropped by the late-message guard.

```
what you played   ▓▓▓▓▓▓▓|▓▓▓▓▓▓▓|▓▓▓▓▓▓▓|▓▓▓▓▓▓▓|▓▓▓▓▓▓▓|▓▓▓▓┃ release
sealed (OLD)      ▓▓▓▓▓▓▓|▓▓▓▓▓▓▓|▓▓▓▓▓▓▓|▓▓▓▓▓▓▓|▓▓▓▓▓▓▓|░░░░   0–43 ms thrown away
```

A loop's length is the sealed take's length (`buildLoopPayload` uses the full buffer), so every
held-space loop was 0–43 ms short, at random. Sampler takes went through the same core.

**Shipped** (`recording-capture.worklet.js`, `audio.js`): the recorder posts `{ done: true }`
after its final flush, and `_captureStop(onSealed)` seals when that lands (50 ms fallback if
the worklet is gone). `stopLiveRecording` still flips `isRecording` synchronously — the
gesture semantics are unchanged — and does the slot seal, particle clamp and hot swap in the
callback, reading the slot index at seal time because undo/redo renumber it. **Anything that
builds from the take straight after stopping must go through `whenSealed(fn)`**: loops and
triggers read `slot.buffer` and before the seal would fall back to the oversized live buffer.
`_commitTraceStroke` and the momentary-release loop commit in `events.js` are wrapped; the
tiles.js paths already waited 60–120 ms. `stopSamplerCapture` takes a callback. A record
press inside the seal window seals with what has arrived, which is the old behaviour on a race
no hand can produce. Measured on the rig with a synthetic input: the seal lands in under
2 ms and gains 256–1280 samples the old code discarded.

Known and left alone: `midi.js` line ~727 creates a loop *before* it stops the recording, so
that path builds from the live buffer rather than the sealed take. Predates this work.

### 15 · Where crackle can come from

Inside the engine, two hard cuts remain by design and are now counted: a full pool steals its
oldest grain without a fade (`_diag.steals`), and rect envelopes. The path with no eyes on it
was the Electron transport. Three independent clocks drive the RtAudio input stream, the
AudioContext and the RtAudio output stream; when any two disagree, the input ring
(`input-meter.worklet.js`) runs dry — a 128-sample block of silence straight into the take and
the dry monitor — or overflows and skips samples, and the output side drops a whole
1024-frame buffer when credits run out. If the AudioContext runs on the laptop's own output
while RtAudio drives the interface, clocks 2 and 3 are two crystals and will drift: a click
every few minutes, which matches "hard to reproduce".

**Shipped**: `S.transportDiag = { inDry, inOverflow, outDropped }`. The input worklet counts
gaps (once per gap, so an idle stream is one, not a count that climbs forever) and overflows,
and reports once a second when something happened; `ui-audio-settings.js` accumulates and
`dlog`s them. `audio.js` counts output drops and logs at most once a second. `wg.status()`
prints all four with the worklet's steals. Nothing on the playing surface (Ek's ruling).

### 16 · How it was verified

- `js/grain-engine.test.mjs` (`npm test`): thirteen cases. The worklet is loaded in node with
  a two-line shim for `AudioWorkletProcessor` and `registerProcessor` and driven exactly as the
  bridge does. Nine read a slot back — offset kept, length shortened, reverse grain starting
  at the end, pitched-up grain ending at the overtake point, envelope landing at release. The
  last one *listens*: it records a sine live, lets one grain ride the edge at full level,
  stops the recording under it at six timings, and measures the largest sample-to-sample step
  in the output. On the previous worklet that step was 0.40 — the click; on this one it stays
  under the sine's own slope. Ten of the thirteen fail on the old worklet, which is what makes
  them worth having.
- The seal was checked on a real Electron instance via `scripts/lib/rig.js` with an
  oscillator standing in for the interface: at every stop the write position sat exactly on a
  2048 boundary, the new seal collected the partial bundle behind it, and the tail was real
  audio.
- `rig-audit.js` green except one pre-existing engine-pages failure (the filter tool missing
  from the rail), identical on the untouched tree. `docs-audit.js` green.
