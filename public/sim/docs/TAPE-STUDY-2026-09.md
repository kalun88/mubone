# The tape engine, against the loopers people love

> **Status: PROPOSAL — NOT IMPLEMENTED.** A 2026-09-18 study of what the best experimental tape
> machines and loopers put on the panel, which of it is FROZEN into the recording and which is
> LIVE on playback, and what that says about mubone's tape sheet. § 1–4 are the argument and the
> proposed sheet; § 5 is the device-by-device record, read from the manufacturers' manuals.
> Built (2026-09-18): round one (reverse baked, `ends` composing with it, `path dir` cloud-only,
> the section rename) and round two in full — pitch with its step capsule, overdub decay, the
> dub's one-shot (§ 4). What is still open: the later round in § 4 and § 6.3's items 3–7.

**Read this first.** Every device studied stores one thing: audio. Speed, direction, pitch, length,
grain size and filter act LIVE on that audio almost everywhere. Only two designs FREEZE a
manipulation into the material on purpose, and both make it an explicit choice the player takes:
Blooper's ADD mode ("whatever you hear is what gets recorded") and Microcosm's post-FX looper
switch. mubone is the third: the tile's dials are stamped onto the stroke when it is drawn
(#240). That is defensible, because in mubone the tile is a BRUSH and a stroke freezes the brush
that painted it (#210), but it means the tape sheet is Blooper's ADD channel and nothing in the
app is its NORM channel yet. The pinned rail is where that would live.

---

## 1. The question Ek asked

Three things were on the table:

1. **Reverse.** The tape sheet has no reverse. The only backwards playback is the lens's
   `start: ends` rule (arrive at the tail, run backwards), a read-time turntable rule standing in
   for a property of the tape. A pinned loop takes its direction from `path dir`, the cloud
   setting, which no tape sheet shows.
2. **Baked vs lens.** `baked in` names how a value is stored, not what it does, and `loop on end`
   and `passes` are not about how the tape sounds at all.
3. **Speed and pitch.** Tape speed changes pitch. Should it? And if speed ever keeps pitch, does
   pitch become its own baked dial?

## 2. What the instruments do

### 2.1 Frozen vs live

| Device | Stored object | FROZEN into it | LIVE on it |
|---|---|---|---|
| Blooper NORM | layer stack | clean overdubs | all 12 modifiers, stability, layers knob, volume |
| Blooper ADD | layer stack | modifiers + stability + knob moves, one pass = one layer | the same knobs, still live on top |
| Tensor REC | phrase | raw audio | speed, time, pitch, DIR, random |
| Tensor OVR | phrase | overdub recorded RELATIVE to the current speed/pitch | the whole still live |
| Morphagene | reel / splice | S.O.S. blend of modulated playback + input, recorded straight | vari-speed, gene size, slide, morph, organize |
| Microcosm post-FX | loop | the effect | level, speed, reverse, fade |
| Microcosm pre-FX | loop | raw audio | every effect knob |
| Octatrack Pickup | BPM-locked buffer | overdubs at GAIN dB | pitch (stretch always on), DIR, tempo |
| MOOD MKII | micro-loop | what the wet channel was doing while bypassed | env / tape / stretch, CLOCK |
| Habit | 3-min memory | raw input; FEED and COLLECT write the performance back | every echo control, incl. speed, reverse, scan |
| Count to Five | buffer / sample | audio; feedback re-pitches every pass | DIR (speed+direction), length, random |
| OP-1 | 4-track tape | the take at the speed in force | speed, direction, loop points, tricks |
| Cosmos, Mimeophon, DLD, Thyme | recirculating memory | whatever is in the feedback path, generation by generation | hold, reverse, window, zone |

Two designs stand out for mubone:

- **Blooper's two channels are the cleanest statement of the split.** NORM: the modifiers ride the
  play head and the overdub records clean underneath. ADD: the modifiers are printed, one pass
  becomes one layer, the LAYERS knob scrubs the undo history. The player picks which by a toggle,
  and the "one-shot overdub" (hold record, exactly one pass, modifier auto-off) is the deliberate
  gesture for printing something.
- **Tensor's DIR switch composes with its SPEED sign.** DIR is a loop-level property (FWD / ALT /
  REV), SPEED's left half is reverse, and both reversed is forward. That is exactly the `ends`
  rule composing with a baked reverse.

### 2.2 Speed and pitch

Every "tape" or "speed" control in the study is **varispeed**: pitch follows speed, as on tape.
Blooper Smooth / Stepped / Chromatic Speed, Habit, Count to Five, Morphagene Vari-Speed, OP-1,
Microcosm, MOOD's tape mode, Cooper's REVRSE, HC-TT's crank. Where pitch-preserving stretch
exists it is a separate, granular control: Blooper Stretcher (±4×), Tensor TIME (1:4–4:1),
Morphagene under an external clock, Cooper TIMEST, Drolo stretcholay, Octatrack's timestretch.
Independent pitch is a third axis where it exists: Blooper Pitcher (±3 oct), Tensor PITCH (±2 oct,
quantised to intervals), Octatrack PTCH (semitones). Blooper forbids Stretcher and Pitcher
together.

**Stepping is the recurring musical move.** Blooper's Stepped Speed (octaves and fifths) and
Chromatic Speed (semitones), Count to Five's Q quantiser (chromatic, whole tone, triads, fifths
and octaves), Microcosm's 1/4 · 1/2 · 1 · 2 · 4, Drolo's random tape loop (rev 1×, 0.5×, 1×, 2×),
OP-1's SHIFT+encoder steps. Stepped speed is how a player reaches "reverse at exactly 1×" and
"an octave down" without hunting.

### 2.3 Reverse

Reverse is **a place on the speed axis**, not a mode, in most of the field: the left half of
Blooper's speed modifiers, Count to Five's DIR, Morphagene's through-zero knob, Cooper's SPD and
PIT knobs, HC-TT's second crank. Where it is a switch it is a **live loop-level property**:
Tensor DIR, Octatrack DIR, Microcosm's Reverse button, Cosmos and DLD's buttons, OP-1's direction
key. Nobody bakes reverse into a recording except by re-recording (Blooper ADD, Morphagene S.O.S.,
Microcosm post-FX). Momentary reverse as a performance gesture appears everywhere a footswitch
can slam a knob: Blooper's modifier button held, Cooper's "set the parameter to this value while
pressed", Tensor's rewind (ON held with SPEED at −100 %).

### 2.4 Ideas the field agrees on that mubone does not have

- **Overdub decay** (Blooper REPEATS, Tensor loop decay, Octatrack GAIN, Superego LAYER, MOOD
  FADE): old layers fade by a set amount per pass WHILE overdubbing. Every looper has it; the
  overdub tool does not.
- **Layers as a scrubbable undo history** (Blooper LAYERS knob, ramped for "time machine").
- **Envelope-triggered capture**: the instrument freezes when you stop playing (Superego AUTO,
  Cooper ENHOLD, Drolo envoloop, Particle 2's freeze threshold, Count to Five's trigger).
- **Windowing / scanning a memory** (Mimeophon zones, Habit SCAN, DLD windowing, Particle 2's
  scrub of a frozen buffer): the past few minutes as material. mubone's `depth` on the lens is
  a cousin.

## 3. What this says about mubone

**The three surfaces are right; one of them is empty.**

| Surface | Blooper equivalent | mubone today |
|---|---|---|
| The tile: what the stroke IS, stamped when drawn | ADD channel, printed by a one-shot | speed, vol, passes, loop on end |
| The lens: how the cursor plays what it touches | the play head under NORM | dwell, start, release, retrig, rearm |
| The pinned rail: what you do to a loop after it is pinned, live | NORM's modifiers, the LAYERS knob | level, mute, solo, fade in/out |

The rail is the NORM channel and it holds only level. Direction and speed as live per-pin
properties (Tensor DIR, Octatrack DIR, Microcosm's Reverse button) are the obvious next residents,
with the baked values as their starting point. That is a later round, not this one.

**Speed changing pitch is correct for a tape.** The seq block plays a take through an
`AudioBufferSourceNode` and speed is its `playbackRate`, which is varispeed by construction. Web
Audio has no time-stretch. Every tape control in the field behaves this way, and the players
like it. Keep it, and say so on the sheet.

**Speed and pitch: two dials, no switch, and the pitch is computed offline.** The field has three
parametrisations: the tape's one knob (pitch follows speed: Morphagene, OP-1, Count to Five, Habit,
Microcosm, MOOD, HC-TT), Tensor's and Blooper's three (speed, stretch, pitch: redundant, each a
gesture, and Blooper cannot afford two at once), and Octatrack's and Thyme's two plus a switch
(timestretch on or off, LINK). mubone takes two dials: `speed` is tape, `pitch` is Blooper's
Pitcher, a shift on top at constant length. Stretcher is speed with pitch cancelling it, a gesture
nobody rides while drawing a loop, so it is not baked; if it ever rides live from the instrument
it is the wet-loop round. Because pitch is a property of the tape set when the stroke is drawn,
it never runs in real time: the loop region is time-stretched ONCE in a worker by a phase vocoder
(large frames, look-ahead, phase locking, the algorithm Travis recommends for this) and played at
that ratio as varispeed, cached on the slot beside the reversed copy and keyed the same way.
Zero runtime cost, no added latency, overdub layers keep the pitch they were sung at. The live
path, when wanted, already exists in the app: a loop played through the grain engine as a
SEQUENTIAL cloud, the cloud's advance rate as the stretch and its pitch shift as the pitch.

## 4. The proposed tape sheet

Round one, approved 2026-09-18:

```
tape        speed · reverse · vol          what the tape IS, frozen when the stroke ends
on end      loop · passes                  what happens when the stroke ends
slicing     chop · chop ms · min slice     how the take is cut, once
```

- `reverse` is a SWITCH (a boolean on an engine sheet is a switch, 2026-09-07). Baked: stored on
  the trigger shell as its own field, stamped onto the pinned slot beside speed, vol and passes,
  carried by the piece file (`direction` already is).
- `_onEnter` derives direction from the baked value on every fire; `start: ends` FLIPS it when
  the cursor arrives at the tail, so a reversed tape entered at its tail plays forward. Tensor's
  DIR × SPEED-sign rule.
- A pinned loop stops reading `path dir`. `S.commitCloudLoopMode` becomes cloud-only, which its
  label already claims.
- The section rename. `on end` as the section, `loop` and `passes` as its rows: "on end: loop —
  yes or no" is the sentence the 2026-09-07 ruling wanted. The tooltip on speed that says it
  "rides live" goes; #240 made it baked.
- The lens's touch section keeps its five rows. (It was renamed `on strokes` when the walker
  landed, and the whole sheet was reorganised the same day — RULINGS, "The lens sheet is three
  sections".)

Round two, decided 2026-09-18 (Ek: "first focus on bringing our looper up to the field's spec,
which is independent pitch and speed, and also the auto decay"). Swapper and the other modifiers
that stop or mute the loop are out. Dropper, Stutter and Scrambler are liked and wait for a round
of their own (they need a per-slot scheduler).

1. **Independent pitch and speed.** `pitch` on the tape section, free by default, baked like
   speed, applied offline by a phase vocoder (§ 3) and played as varispeed. One `step` capsule
   for the pair, `free · semitone · octave+5th`: Blooper's smooth, chromatic and stepped variants
   as one setting. No stretcher and no switch.
2. **Overdub decay.** `decay` on the dub tile as a percentage, baked at the press. At every wrap
   of the master while the dub records, the master's own material and every earlier layer step
   down by that much, and the take's own earlier passes fold in already decayed. Held as a `wear`
   factor per member (never written into the audio), so undo restores it and the piece carries
   it. Nothing fades in playback, Blooper's rule.
3. **The dub's bang verb is the one-shot.** Press, and the dub records for one master cycle and
   releases itself. Blooper's one-shot is exactly one loop length from the press; Ek's reading
   is "till the end of the cycle". The build takes Blooper's unless Ek says otherwise, because a
   press late in the cycle would otherwise record almost nothing.

Later: live direction, speed and pitch on the pinned rail (the NORM channel), momentary reverse
as an action, Dropper / Stutter / Scrambler, ADD mode as a pin source (§ 6.3).

## 5. The record

Condensed from three reports read against the manufacturers' manuals on 2026-09-18. Ranges are
the manuals'; where a manual was unreachable it is said.

### 5.1 Chase Bliss Blooper

Knobs: VOLUME (ramp speed when ramping), LAYERS (scrubs the layer stack: 16 layers, 1–7 stored
individually, 8–16 merged), REPEATS (how fast old material fades WHILE overdubbing only),
STABILITY (wow + flutter + noise + filter macro), MOD A / MOD B (the selected modifier's amount,
noon neutral). Modes NORM / ADD / SAMP. Two arcade buttons engage a modifier: tap latches, hold
is momentary. Left footswitch: record → set end → overdub/play toggle; hold = ONE-SHOT OVERDUB
(exactly one pass, modifier auto-off). Sampler mode: tap = record (replace), right tap =
retrigger, right hold = looping on/off (true one-shot player).

Modifiers (16 with variants, six slots, alternate banks via BLIP): Smooth Speed (reverse ≤2× ←
STOP → forward ≤2×, pitch follows), Stepped Speed (±4×, octaves and fifths), Chromatic Speed
(semitones), Stretcher (4× slower ↔ 4× faster, pitch constant), Pitcher (±3 oct, speed constant),
Trimmer (cut end ↔ cut start, stepped to 1/32), Stutter (beat-repeat of the last / the next
moment), Scrambler (random jumps ↔ repeating sequence), Dropper (random ↔ patterned drops),
Filter, Swapper (envelope mute ↔ fade mute), Stopper (tape stop ↔ volume fade). Stretcher and
Pitcher exclude each other; with either active the speed modifiers "can only be used to go into
reverse".

Frozen vs live: NORM prints clean overdubs under live modifiers, but the record head always runs
forward at 1× while the play head is modified, so overdubs land displaced. ADD prints what you
hear; loop length is fixed by the first recording (half-speed squeezes half the loop out, 2×
plays twice per length); Additive Assist resets the play head each loop so preview equals what a
one-shot prints. REPEATS is frozen into the layer; STABILITY is live in NORM, frozen in ADD;
VOLUME, LAYERS and the modifier buttons are always live. Layers are cumulative, not isolated: a
modifier printed at layer N is in every layer above. Reverse is the left half of any speed
modifier, latched or momentary, printed only through an ADD overdub.

What players love: additive recording (the loop ages pass by pass), layers as time travel, the
fixed-length container with two heads.

### 5.2 Red Panda Tensor

SPEED −100…+100 % (left half reverse, noon stopped), TIME 1:4–4:1 (stretch, pitch constant),
PITCH ±2 oct quantised to intervals, BLEND, RAND (stutters → repeats → slice shuffle). HOLD modes
OVR / REC / NXT; DIR switch FWD / ALT / REV. In REC every knob is live on the phrase; in OVR the
overdub is recorded RELATIVE to the current transform (overdub at +1 oct, return to unison, the
new pass is an octave down); loop decay (MIDI) fades old layers while overdubbing. DIR combines
with SPEED's sign: both reverse = forward. Rewind: ON held with SPEED at −100 %.

### 5.3 Chase Bliss MOOD MKII and Habit

MOOD's micro-looper is always listening; engaging keeps the last CLOCK-length. Overdubs record
the clean input only; env / tape / stretch manipulations are live and displace overdubs; CLOCK is
compensated mid-overdub; hidden FADE decays old material while overdubbing. Tape mode: reverse
4×…0.5× | 0.5×…4× forward in octave steps. Habit: a 3-minute always-recording memory feeds an
echo; everything on the panel is live on the echo; FEED and COLLECT write the performance back
into memory. Speed modifiers stepped ±4× (octaves and fifths) or smooth ±2×, reverse on the left
half; no stretch, no independent pitch.

### 5.4 Make Noise Morphagene

Reel → splices → gene. Vari-Speed is one bipolar knob through zero into reverse (about +12 st up,
−26 st down, higher resolution near stop for braking). "Recording always takes place at a
constant speed and direction regardless of modulation … two machines, one for modulated playback,
another for recording the modulated machine." Nothing but audio and splice markers is stored;
everything is live until S.O.S. records it. Time-stretch only under an external clock (Vari-Speed
then changes pitch without speed). Gene shift under clock = synchronous granulation. Play gate
high = loop, low = one-shot, rising edge = retrigger from the Slide point.

### 5.5 Elektron Octatrack (Pickup and Flex)

Pickup: PITCH ±12 st (live; overdub refused unless 0), DIR forward / ping-pong / backward, GAIN
in dB for overdubs (decay as a number), OP GAIN / DUB, timestretch cannot be off so the loop
follows the BPM and pitch is independent. Flex: RATE (negative = backwards), PTCH semitones,
RTRG / RTIM retriggers, LOOP OFF / ON / PINGPONG / AUTO, slices under parameter locks.

### 5.6 Hologram Microcosm

Phrase looper post-FX (default: the effect is printed) or pre-FX (raw loop, every effect knob
live on it). Looper speed stepped 1/4 · 1/2 · 1 · 2 · 4 or fluid 1/4–4×; a Reverse button on the
looper and a second reverse on the effect; both live toggles. Hold Sampler keeps feeding the
effects. Burst mode: record while held, play on release, press again to replace. One overdub
layer, one undo.

### 5.7 Montreal Assembly Count to Five

DIR knobs: "a stand still to double speed forward or backward", quantised by Q to chromatic,
whole tone, triads, fifths and octaves within ±1 oct. Mode 1: fixed-length buffer written at
fixed speed, read at variable speed, feedback into the write head re-pitches every pass. Mode 2:
4 s sample, random slice start. Mode 3: three read heads on one 8 s sample, each with its own
speed and direction, plus a random step sequencer on them. Hold the footswitch = mute the write
head (freeze). Reverse is the left half of every DIR knob.

### 5.8 Cooper FX Outward and Arcades, Drolo, EHX

Cooper: a footswitch that momentarily SETS a parameter to a value rather than toggling a mode
gives freeze, reverse, tape stop and random on any program; TIMEST is granular stretch (SPD: fwd
← stop → rev, pitch untouched); REVRSE is varispeed on PIT (tape stop ← unison → double speed);
envelope-triggered hold (ENHOLD, ENVTS). Drolo Molecular: one knob whose left half records and
right half holds, a switch that slams it; random tape loop steps through rev 1×, 0.5×, 1×, 2×;
stretcholay stretches with reverse rearrangement at the left. Stretch Weaver: side-chained
looping, the other player's dynamics decide when you are stretched, looped, re-pitched (tape mode
stepped 1/4 · 1/2 · 2 · 4). EHX Freeze / Superego: spectral hold, LAYER is "the overdub amount on
a looper", AUTO captures each new note by transient, Gliss portamentos between holds.

### 5.9 Soma Cosmos, Mimeophon, Thyme, Cocoquantus, OP-1, 4ms DLD

Cosmos: prime-length recirculating lines, no fixed loop, a reverse button and a hidden half-speed,
SUP|COM lets new sounds duck old ones out of memory. Mimeophon: nested zones, Hold is
non-destructive with Repeats repurposed as a scrub, Flip reverses. Thyme: pure varispeed at
1 V/oct, LINK turns the speed knob into a pitch shifter at constant delay, Robots modulate every
knob, no reverse. Cocoquantus (maker's site gone; from circuit analysis and fragments): 8-bit
64 K-sample bank, speed = clock = pitch and length, Flip is a momentary gate, chaos drives all
three. OP-1: speed is a transport gesture shared by record and play, direction latched, Break
keeps the loop counting in the background, hand-cranked recording pitches by how fast you turn.
DLD: constant rate, no varispeed; Hold freezes a window, Reverse reverses read and write, the
feedback knob scrubs the frozen memory.

## 6. The Blooper, method by method, against mubone

Read from the 2023 manual, the "Recording with Modifiers" guide and the modifier sheet
(2026-09-18). Blooper is worth this depth because it is the one looper whose design question is
mubone's question: what is printed into the material, and what rides on top of it.

### 6.1 How the machine works

1. **One container, fixed for ever.** The first recording sets the loop length. Nothing after
   changes it: "you can change the contents, but the container is always the same size". Record a
   half-speed pass into it and half the audio is squeezed out; a 2× pass fits twice.
2. **Two heads that can come apart.** "The record head is always steady. It always moves forward,
   at real-time speed. All you can do is tell it to record, or not." Every modifier acts on the
   PLAY head. The time modifiers (Speed, Trimmer, Stutter, Stretcher, Scrambler, tape-stop) pull
   the play head away from the record head; turn the modifier off and they snap back together.
   The non-time ones (Filter, Dropper, Pitcher, Swapper, fade-out) leave them in sync.
3. **Modifiers are effects on the play head**, two channels, a knob per channel with the neutral
   zone at noon and a different behaviour either side, engaged by a button: a tap latches, a hold
   is momentary.
4. **NORM: the modifiers are an external effect.** Overdubs record clean underneath; turn the
   modifier off and the clean loop is waiting. But you play along to the play head and are
   written at the record head, so with a time modifier on, "you may wind up overdubbing one part
   of your loop into another". The manual calls this mystery looping and offers it as a feature.
5. **ADD: "whatever you hear, that's what Blooper will record."** The play head's output, through
   the modifiers and Stability, is what the record head writes into the next layer, knob
   movements included. Additive Assist resets the play head each time the record head reaches
   the loop start, so what you preview is exactly what a one-shot prints.
6. **A layer is one completed overdub**, however many passes it ran. Layers are a tower, not
   isolated tracks: layer 3 means layers 1 to 3. The LAYERS knob scrubs the tower (eight levels
   of undo and redo); recording at an earlier layer erases everything above. Ramp the knob at
   random and the loop rewrites itself, the "time machine".
7. **REPEATS fades what is already there while overdubbing only.** Max is a standard looper;
   lower and the loop is always the last few passes. The loop never fades in playback.
8. **Three record gestures.** Tap = overdub until the next tap. Hold = ONE-SHOT: exactly one pass
   then back to playback, with the modifier switched off after, the way to print a modifier
   cleanly. Punch-in = start overdubbing, flick a modifier on for a moment, stop: only that moment
   is altered, and you know where the record head is.
9. **Accumulation.** Leave a mild modifier on (Stability, Dropper, Stutter, Trimmer) while
   overdubbing in ADD: old material ages every pass while "new notes appear fresh and start the
   cycle all over".
10. **SAMPLER mode.** No overdub: every record replaces. Hold = record while held, play on
    release. Right tap = trigger / retrigger, interrupting mid-play. Looping off = a one-shot
    sample player. Samples still go through the modifiers.
11. **Delay-style.** Tap, tap: the gap is the loop length; a third tap enters overdub, and REPEATS
    is now a feedback knob. Enter playback and the current echo latches as a layer. Turning
    REPEATS up and down flows between delay and loop.
12. **Ramping.** Any knob under a triangle or random bounce, synced to a subdivision of the loop,
    or a one-time ramp on engage; CV and expression take the same path. In ADD the movement is
    printed.

### 6.2 What mubone already has

| Blooper | mubone |
|---|---|
| Fixed container | The master's wall cycle: an overdub take is folded to it, "longer than the cycle and the passes stack" |
| Record head steady at 1× | The dub take records from the mic at 1× and is folded in at the phase it started, whatever the master's speed |
| Modifier tap latches, hold is momentary | The verb: `toggle` and `momentary`, set on the tile, not read off the press (the 2026-09 ruling: buttons are toggle, no tap/hold discrimination) |
| Punch-in | The dub tile in `momentary`: records while held |
| A layer per completed overdub | A dot per overdub on the pinned rail, each its own stroke for erase and undo |
| LAYERS as undo | `history.js`: one unbounded action stack, undo and redo keys |
| SAMPLER: replace, momentary record, retrigger, looping off | Every take is a new stroke; the hand in `momentary`; the lens's `retrig: cut`; `dwell: once` |
| CV and expression on any knob | The sensor mapping and the accessory's eight channels through the one ACTIONS table |

### 6.3 What is usable, ranked

1. **The dub tile's three verbs ARE Blooper's three record gestures.** `toggle` is the overdub,
   `momentary` is the punch-in, and `bang` should be the ONE-SHOT: record for exactly one master
   cycle, then stop. Today `bang` on a brush is a tap; giving the dub a length equal to the
   master's cycle is the whole change. It is the cleanest print gesture in the field and it costs
   a few lines in `pinDown`.
2. **REPEATS is overdub decay**, § 4 round two. Baked on the dub tile: each wrap while the button
   is down steps the existing layers' gain by the set amount. With it, the delay-style trick
   (§ 6.1 11) comes free: a dub held open with decay under full IS a delay whose time is the
   loop.
3. **The LAYERS knob is the rail's overdub dots made pressable.** Each dot mutes its layer;
   the master's row keeps the tower. The "time machine" (random layers in and out, synced to the
   cycle) is then one action over those buttons, later.
4. **Swapper at noon is `replace`.** The master is muted while the dub records, and the recorded
   span takes the master's place. In mubone that is decay at full applied only under the
   recorded span, so it is an option of decay rather than a tool: `decay` · `replace`.
5. **ADD mode is a SOURCE.** The chain is source → brush → lens, and today the sources are the
   mic and the sampler. A third source, the selected pin's own output through the rail's live
   state, is Blooper's record head listening to its play head. The dub then prints whatever the
   rail is doing (reverse, speed, level, later trim and tape-stop) as a new layer, and Additive
   Assist is the phase anchor the overdub already has. This is the big one and it waits for live
   rail controls to print.
6. **The modifiers that map onto slot fields the app already mutates mid-flight**: speed
   (`playbackRate`), reverse, Trimmer (`loopStart` / `loopEnd`, which the erase path already
   moves under a playing source), Stopper's fade side (a gain ramp) and tape-stop side (a
   playback-rate ramp to zero). Stutter, Scrambler and Dropper need a per-slot scheduler; Filter
   needs a node the tape path does not have; Stretcher and Pitcher are the grain worklet (§ 3).
7. **Stability, ramping and the noise generator** have no mubone shape and are not proposed.
   Ramping is a sensor mapping with an LFO as the sensor; if it is ever wanted it belongs in the
   mapping, not on a tile.

## 7. The stroke walker (built 2026-09-18)

`order: step` on the lens was there to fake a line loop in the grain engine and could not be one:
it walks the CURSOR's circle, rebuilt every tick, one mark per grain period. Ek: "it only works on
the cursor, which is circular, and strokes are not always falling into the cursor circle."

The mode is the fix. `S.lensMode` is `area · nearest · stroke`. Under `stroke` the cursor reads
nothing on its own; touching a grain stroke launches a WALKER that retraces that stroke's own path
at the pace it was painted, reading what is in its reach with the lens's live radius, `k` and
`order`. The walker carries the time and `order` decides the texture inside each moment — Ek:
"it's essentially doing the walking so it's meta sequential, but under it the way the candidates
fire can still be random or step … the end effect should be this idea of a loop but with some
granular qualities."

It is NOT a pin, by Ek's own definition: a pin is off-cursor and keeps playing. A walker plays
once or loops while the cursor is on the stroke and dies on the lift. The pin press takes it and
freezes it into a moving cloud, which is what it already is.

What the field says this is: Morphagene's gene read with Slide and Gene-Size, Blooper's Stretcher,
Cooper's TIMEST. A granular reader over recorded material whose rate and pitch are independent by
construction — which is why this is also the live path for a wet loop (§ 3), where a walker slower
than its recording keeps its pitch for free.

**What `dwell` means to a walker (2026-09-18).** The three values read the same for a take and for
a walker, which is what makes the row honest in both modes:

| dwell | a tape stroke | a grain stroke under `mode: stroke` |
|---|---|---|
| `once` | the take plays through, then silence | the walker walks through, then silence |
| `grain` | the take plays through, THEN its material is the cursor's to granulate | the walker walks through, THEN the stroke is the cursor's to granulate |
| `loop` | the take repeats while you are on it | the walker repeats while you are on it |

`grain` used to open the material on ARRIVAL, so the grains sounded over the take's own first pass.
It opens on the playthrough's END now, and closes when the cursor leaves.
