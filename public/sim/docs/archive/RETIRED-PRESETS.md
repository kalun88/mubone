# Retired factory presets

> **Status: ARCHIVED** · record only. These ten shipped as factory presets through 1.11 alpha and were cut on 2026-07-31 when the factory bank was trimmed from 20 to 10 (see `docs/TODO.md` #156). Nothing in the app references them. They are kept here because the parameter combinations took tuning to find, not because anything is planned for them.

The factory bank is now **wash, vinyl, cloud, pulse, shimmer, glitch, chop, ocean, stutter, wobble** — patches 1–10, keys `1`–`0`. Patches 11–20 are user slots on `shift`+`1`–`0`.

## Restoring one

Paste the object back into `PRESETS` in `js/state.js`, **before** the user-slot append. Then:

- renumber the `// -- N. name --` comments so they stay sequential;
- bump `FACTORY_PRESET_COUNT` in `state.js` — `USER_PRESET_START` and `PRESET_COUNT` derive from it, and the per-patch actions in `midi.js` are generated from `PRESETS`, so both follow automatically;
- note that the keyboard only reaches 20 patches (`1`–`0` and `shift`+`1`–`0`). Past 20 a patch is reachable by MIDI, OSC and the accessory, but has no key.

Schema note: these predate nothing — the preset shape has not changed since they were written, so they can be pasted verbatim.

## The presets

```js
// -- freeze -- lock+wide: drone, holds position in a wide halo
{
  name:          'freeze',
  nearestMode:   true,
  searchRadiusDeg: 40,
  recencyN:      5,
  k:             10,
  duration:      2.0,
  durJitter:     0.35,
  durVar:        0.25,
  period:        1.1,
  periodVar:     0.08,
  fadeRatio:     0.25,
  panSpread:     0.20,
  volume:        0.70,
},
// -- ghost -- reverse, sparse, eerie smear from far-flung particles
//    panSpread 0.35 — eerie spatial drift is part of the character.
{
  name:          'ghost',
  searchRadiusDeg: 70,
  recencyN:      6,
  k:             6,
  duration:      0.70,
  durJitter:     0.25,
  durVar:        0.15,
  period:        0.65,
  periodVar:     0.10,
  fadeRatio:     0.31,
  pitchJitter:   0.06,
  panSpread:     0.35,
  volume:        0.85,
  probability:   0.6,
  direction:     'rev',
},
// -- tape -- k-seq: walks through particles in recording order
//    Like playing back a worn cassette, slightly detuned and drifting.
{
  name:          'tape',
  grainKSeqMode: true,
  searchRadiusDeg: 30,
  recencyN:      5,
  k:             4,
  duration:      0.32,
  durJitter:     0.10,
  durVar:        0.12,
  period:        0.28,
  periodVar:     0.08,
  fadeRatio:     0.28,
  pitchJitter:   0.04,
  panSpread:     0.15,
  volume:        0.70,
  probability:   0.92,
},
// -- swarm -- k-all + wide radius: every particle within earshot fires
//    Dense insect texture that thickens as you paint more.
{
  name:          'swarm',
  grainKAllMode: true,
  searchRadiusDeg: 45,
  k:             20,
  duration:      0.055,
  durJitter:     0.3,
  durVar:        0.02,
  period:        0.035,
  periodVar:     0.015,
  fadeRatio:     0.18,
  pitchJitter:   0.12,
  panSpread:     0.20,
  volume:        0.30,
  probability:   0.7,
  direction:     'rnd',
  curveType:     'rect',
},
// -- haunt -- reverse + sparse + pitched down an octave
//    Long ghostly swells, suboctave spectral bass presence.
{
  name:          'haunt',
  searchRadiusDeg: 90,
  recencyN:      6,
  k:             5,
  duration:      1.4,
  durJitter:     0.3,
  durVar:        0.25,
  period:        1.2,
  periodVar:     0.30,
  fadeRatio:     0.35,
  pitchJitter:   0.03,
  pitchShift:    -12,
  panSpread:     0.20,
  volume:        0.75,
  probability:   0.5,
  direction:     'rev',
},
// -- morse -- k-seq + lock: sequential walk, telegraph precision
//    Short rect grains with silence between — sonar ping.
{
  name:          'morse',
  nearestMode:   true,
  grainKSeqMode: true,
  searchRadiusDeg: 20,
  k:             6,
  duration:      0.045,
  period:        0.18,
  fadeRatio:     0.05,
  panSpread:     0.10,
  volume:        1.0,
  curveType:     'rect',
},
// -- smear -- ultra-long grains, high overlap, pitched up a fifth (+7)
//    Everything blurs into shimmering harmonic sustain.
//    ~4.3 concurrent grains (2.6s/0.60s).
{
  name:          'smear',
  searchRadiusDeg: 50,
  recencyN:      4,
  k:             7,
  duration:      2.6,
  durJitter:     0.30,
  durVar:        0.25,
  period:        0.60,
  periodVar:     0.10,
  fadeRatio:     0.40,
  pitchJitter:   0.015,
  pitchShift:    7,
  panSpread:     0.20,
  volume:        0.42,
  probability:   0.85,
},
// -- drill -- audio-rate grains: period at 3ms pushes into pitched
//    buzzing territory. The grain stream becomes a tone.
{
  name:          'drill',
  searchRadiusDeg: 8,
  k:             3,
  duration:      0.004,
  period:        0.003,
  fadeRatio:     0.10,
  panSpread:     0.05,
  volume:        0.65,
  curveType:     'rect',
},
// -- scatter -- k-seq + reverse + high probability dropout
//    Walks recording order backwards with random silences.
//    panSpread 0.35 — scattered spatial fragments.
{
  name:          'scatter',
  grainKSeqMode: true,
  searchRadiusDeg: 60,
  recencyN:      5,
  k:             8,
  duration:      0.25,
  durJitter:     0.20,
  durVar:        0.10,
  period:        0.32,
  periodVar:     0.12,
  fadeRatio:     0.20,
  pitchJitter:   0.18,
  panSpread:     0.35,
  volume:        0.80,
  probability:   0.45,
  direction:     'rev',
  curveType:     'tri',
},
// -- ritual -- slow, deep, deliberate. Pitched down a fourth (-5).
//    k-all so when grains fire, the whole radius speaks like a choir.
{
  name:          'ritual',
  grainKAllMode: true,
  searchRadiusDeg: 35,
  recencyN:      6,
  k:             20,
  duration:      1.8,
  durJitter:     0.25,
  durVar:        0.20,
  period:        2.2,
  periodVar:     0.40,
  fadeRatio:     0.38,
  pitchShift:    -5,
  panSpread:     0.18,
  volume:        0.60,
  probability:   0.4,
},
```
