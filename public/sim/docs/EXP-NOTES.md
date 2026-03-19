# Experimental Modules — Design Notes

Status: planning / early prototyping
Feature flag: `?exp` in URL (see `js/state.js` EXP const, `js/main.js` lazy loader)
Code location: `js/exp/` — lazy-loaded via `exp-init.js`, zero overhead when flag is off
Badge: small orange "exp" text at top-center of viewport when active

---

## Context

mubone is a spatial granular synthesizer for live acoustic instrumentalists. The performer plays into a mic, the system records audio into a particle cloud on a 3D sphere, and grains are spatialized via VBAP to a multi-channel speaker array. An IMU (BNO085) tracks wand orientation; a second optional IMU provides world-frame reference. Gyro + accelerometer inertial data is also available.

The published version (`main` branch, deployed to mubone.org/sim) is stable and used by collaborators. All experimental work lives behind the `?exp` flag so collaborators never see it until modules graduate.

---

## Design Principles

1. **Live acoustic input first.** The performer is an instrumentalist. New modules should process the live mic signal or the recorded granular buffers — not generate sound from oscillators/math. The source material is always the performer's own sound.

2. **Gesture quality over axis mapping.** Mapping IMU axes directly to parameters (pitch → filter cutoff) is one-dimensional thinking applied to a multidimensional controller. The mapping layer should translate *movement qualities* into *sonic qualities*. The performer thinks in terms of musical intentions (hold, scatter, build, collapse), not knob values.

3. **The system has memory.** Not all control should be instantaneous. Gestures can deposit energy that decays over time. The system accumulates state and has inertia, like a physical instrument or acoustic space.

---

## Gesture Extraction Layer (js/exp/gesture.js) — BUILT, NEEDS LIVE TESTING

The foundation everything else plugs into. Runs every frame (~60hz), derives high-level gesture descriptors from raw IMU data.

### Input
- Quaternion orientation (from sensor.js)
- Angular velocity / gyro (from wand inertial data via OSC)

### Derived Features

**Smoothness** (0–1)
- Angular jerk = derivative of angular velocity (current_gyro - prev_gyro) / dt
- Magnitude through a short moving average
- 0 = perfectly smooth arc, 1 = maximum jerk
- Maps to: spectral continuity, grain duration, filter sweep rate

**Effort / Weight** (0–1)
- Combination of angular velocity magnitude + acceleration magnitude
- Fast + accelerating = strong/heavy (1), slow + decelerating = light (0)
- Roughly maps to Laban's "weight" factor
- Maps to: amplitude, density, filter resonance

**Periodicity** (strength 0–1, period in seconds)
- Autocorrelation of angular velocity over sliding 2–3 second window
- Detects repeating rocking/circular motions
- Strength: 0 = no pattern, 1 = perfect repetition
- Maps to: rhythmic sync of grain scheduling, delay time quantization

**Accumulated Energy** (0–∞, decaying)
- Leaky integrator: energy += effort; energy *= decay (e.g. 0.995/frame ≈ 3s half-life)
- Represents "how much has the performer been moving recently"
- Rises during active gesture, drifts down when still
- Maps to: system responsiveness/inertia (high energy = parameters track gestures closely, low energy = sluggish response)

**Directness** (0–1)
- Ratio of net angular displacement to total path length over last N frames
- 1 = straight line movement, 0 = wandering/indirect
- Maps to: spatial focus/scatter, search radius

### Data Flow
```
sensor.js (raw quat + gyro)
  → gesture.js (compute features each frame)
    → S.gesture = { smoothness, effort, periodicity, periodicityPeriod,
                    accumulatedEnergy, directness }
      → mapping layer (gesture features → sonic quality targets)
        → temporal smoothing (slew rate modulated by accumulated energy)
          → S.grainOverrides / audio node params
```

### Integration
- Sits between sensor.js and wand.js
- wand.js can read from S.gesture instead of (or in addition to) raw axis values
- Does NOT replace existing axis mapping — layers on top as an alternative mapping mode

---

## Audio Processing Modules — Candidates

All of these process live acoustic input or granular output. None generate sound from scratch.

### Resonant Filter Bank (high priority)
- Bank of BiquadFilterNode bandpass filters on the master bus (or per-grain)
- Each filter = a "mode" of a resonant body, spatially distributed on sphere
- IMU gesture controls which modes are excited (tilt toward a region = excite those frequencies)
- Produces bell-like, metallic, glass textures from any input
- Cheap in Web Audio, instant timbral control over existing granular output

### Convolution Reverb (high priority)
- ConvolverNode on master bus, load short impulse responses
- IMU controls wet/dry mix
- Crossfade between multiple IRs based on sphere position or gesture quality
- Huge sonic payoff, trivial to prototype

### Feedback Delay Network (medium priority)
- Multiple cross-coupled DelayNodes with mixing matrix
- Delay times mapped to IMU orientation
- Each delay tap routed to different speakers via existing VBAP
- Produces diffuse, evolving spatial echoes
- Accumulated energy could control feedback amount (gestures deposit reverberant energy)

### Spectral Freeze (medium priority)
- AnalyserNode captures spectrum, resynthesizes via inverse FFT (AudioWorkletNode)
- Freeze gesture = capture current spectral moment
- IMU scrubs through spectral bins or smears the frozen spectrum
- Like granular but in frequency domain instead of time domain

### Phase Vocoder Pitch Shift (lower priority)
- AudioWorkletNode running overlap-add phase vocoder on live input
- Decouples pitch from time (unlike current grain playback rate)
- Enables spatial harmonization: natural pitch at 0°, fifth up at 120°, octave at 240°

### Waveshaping / Distortion (low priority, easy)
- WaveShaperNode with transfer curves mapped to IMU effort/weight
- Gentle saturation at rest, aggressive fold-over when wand swings hard
- Nearly zero cost, layers on existing soft clipper

---

## Generative / Algorithmic Ideas

### Stochastic Trigger Zones
- Plant zones on sphere (like seeds) that fire synthesized events (filtered noise bursts, resonant pings)
- IMU controls probability field — tilting toward a zone increases its fire rate
- Sphere becomes a spatial probability sequencer

### Flocking / Boid Audio
- Particles get velocity + simple flocking rules (separation, alignment, cohesion)
- Particle motion generates sound: speed → pitch, clustering → density
- IMU controls flock attractor point
- Sound emerges from spatial behavior rather than direct parameter control

### Feedback Riding
- Route mic → processing → speakers → mic (acoustic feedback loop)
- IMU controls filter placement to find and ride edge of feedback
- Existing mic → granular path is halfway there

---

## Gesture-Influenced Painting

### Problem with current painting

Right now, painting is uniform. Every frame of paint interaction drops one particle at the cursor position. The gesture character of the performer's movement has no effect on how sound is deposited — whether you're making a delicate, precise gesture or a wild sweeping motion, you get the same evenly-spaced dots along the cursor path.

### Core idea

The gesture extraction layer (smoothness, effort, directness, periodicity, accumulated energy) should influence the painting process itself — not just playback parameters, but how sound material gets placed on the sphere. Think of it as changing the brush nozzle based on how you're moving.

### Gesture → paint mappings

**Smoothness → brush tightness**
- High smoothness (smooth arc): tight precise line of particles, closely spaced along the cursor path. Like a fine-tip pen.
- Low smoothness (jerky, jittery): wide spray — particles scatter in a radius around the cursor position. Each paint frame deposits particles with random angular offsets from the cursor. Like a splatter brush or spray can.
- Implementation: when painting, add angular jitter to particle lon/lat proportional to `(1 - smoothness)`. Jitter radius could be 0° (perfectly smooth) to 15–20° (maximum jitter).

**Effort → paint density / saturation**
- High effort (fast, heavy movement): multiple particles deposited per paint frame. The region gets saturated — more grain candidates, richer playback texture.
- Low effort (slow, light movement): single particle per frame (current behavior). Sparse regions sound thinner because k-nearest has fewer options.
- Implementation: multiply the particles-per-frame count by `1 + floor(effort * N)` where N is the max extra particles (maybe 3–4).

**Directness → stroke coherence**
- High directness (straight line movement): particles inherit a consistent playback direction or pitch offset along the stroke. The stroke has internal order.
- Low directness (wandering, indirect): particles get randomized playback parameters. The stroke is internally disordered.
- This creates a subtle but real sonic difference: playing back through a "direct" stroke sounds more melodic/linear, while an "indirect" stroke sounds more textural/chaotic.

**Periodicity → rhythmic deposit**
- When periodicity is detected: particles are deposited in evenly-spaced bursts synced to the detected gesture period, rather than continuously. The sphere develops rhythmic clusters.
- When played back, these clusters naturally produce rhythmic grain patterns because k-nearest finds the clustered particles together.

**Accumulated energy → particle lifespan or size**
- Higher accumulated energy at paint time could set a longer decay or larger initial grain radius on the deposited particles.
- Particles painted during energetic passages have more "weight" in the system. Particles painted during quiet passages are lighter, more ephemeral.

### Sonic consequences

The key insight is that painting density directly affects playback behavior. The grain scheduler uses k-nearest-neighbor search to find candidates near the cursor. A saturated region (many particles, tight cluster) produces dense, thick textures. A sparse region (few particles, scattered) produces thin, pointillistic textures. By linking gesture character to paint density and spread, the performer's movement quality at recording time gets baked into the sphere's sonic topology.

This means the sphere carries a memory of how it was created — not just what sounds were recorded, but the physical quality of the gestures that deposited them.

---

## Self-Organizing Sphere / Concatenative Paint Mode

### Problem with current painting

Currently, particles live where you physically painted them. Their position on the sphere corresponds to where the cursor was at the time of recording. This means the spatial layout is arbitrary — a phrase that starts bright and ends dark gets spread across whatever arc you happened to paint, and similar timbres can end up scattered across the sphere.

The performer has no reliable way to know "if I point here, I'll get this kind of sound." Navigation is exploration, not intention.

### Core idea: timbral topology

Instead of particles being placed at cursor position, the system analyzes each recorded audio snippet's timbral features and places it on the sphere based on those features. The sphere becomes a **perceptual map** — a continuous timbral space where similar sounds cluster together and the performer learns the topology.

This is conceptually similar to concatenative synthesis tools like IRCAM's CataRT or AudioStellar, but mapped onto the existing sphere + VBAP spatial paradigm.

### Feature → position mapping

The existing `audio-features.js` already computes three features per particle at record time:

- **Spectral centroid** (brightness): low centroid = dark/warm, high centroid = bright/sharp
- **RMS** (loudness): quiet to loud
- **Zero-crossing rate** (noisiness): tonal vs noisy/breathy

These three dimensions map naturally to sphere coordinates:

- **Centroid → longitude (azimuth)**: dark sounds at 0°, bright sounds at 180°. The sphere's equator becomes a brightness gradient.
- **RMS → latitude (elevation)**: quiet sounds near south pole, loud sounds near north pole. Pointing up = loud material, pointing down = quiet.
- **ZCR → radial distance from equator** (or a secondary longitude offset): tonal sounds stay on the main axis, noisy sounds get pushed to the sides.

The specific mapping can be configurable, but the principle is: each audio feature dimension maps to a spatial dimension, creating a 3D perceptual space.

### Adaptive vs fixed mapping

**Fixed mapping**: centroid linearly scales to 0–360° longitude, RMS scales to -90°–+90° latitude. Simple, predictable. The downside is that if the performer's input has a narrow dynamic range (e.g., all medium-loud, all mid-brightness), particles cluster in a small region and most of the sphere is empty.

**Adaptive mapping**: maintain running min/max (or percentiles) of each feature across all recorded particles. Normalize so the sphere fills evenly as you record. Early particles spread wide, later particles fill in gaps. The whole sphere gets used regardless of the input material's dynamic range.

Recommended approach: **adaptive with anchored poles**. Normalize to fill the sphere, but keep the pole meanings fixed (north = loudest you've played, south = quietest). The performer builds an intuitive mapping that adapts to their material.

### Particle placement timing

There's a timing challenge: audio features can't be computed until after the audio is recorded, but painting happens in real time. Two approaches:

**Delayed placement**: buffer a short window of audio (50–100ms), compute features, then place the particle at its feature-determined position. The performer sees particles appear with a slight delay, but they land in the right spot immediately.

**Migrate on analysis**: paint at the cursor position initially (standard behavior), then smoothly animate the particle to its feature-determined position over 200–500ms. The performer sees particles "settle" into place. This is visually beautiful and communicates what the system is doing — you watch your sound organize itself.

The migration approach is preferred because: it gives visual feedback about the organizing process, it works even if feature computation is slow, and it degrades gracefully (if features fail, particles just stay where they were painted).

### How this changes playback and navigation

Once the sphere is organized by timbre, everything about navigation changes:

**Search radius becomes timbral radius.** Currently, search radius defines a spatial region in degrees. On an organized sphere, that same radius defines a timbral neighborhood. A small radius = tight timbral consistency (all grains sound similar). A large radius = wide timbral variation (grains draw from diverse material).

**k-nearest finds timbral neighbors.** The k-pool isn't random particles that happened to be painted nearby — it's the k most timbrally similar snippets. Playback becomes timbrally coherent by default.

**Cursor movement = timbral morphing.** Moving the cursor across the sphere doesn't scan through recording time — it scans through perceptual space. Sweeping from south to north goes quiet→loud. Sweeping east to west goes bright→dark. The performer learns the topology and can navigate it intentionally.

**Seeds become timbral anchors.** Plant a seed in the "dark sustained" region and it always produces that timbral character, regardless of when the source material was recorded or how many new sounds you add later. The seed's meaning is stable.

**The sphere is self-similar at different scales.** Zoom in (small search radius) on the "bright" region and you find finer timbral distinctions within brightness — slightly nasal vs airy vs metallic. The perceptual map has fractal-like detail.

### Combining with gesture-influenced painting

These two systems compose naturally:

1. The performer plays into the mic. The system analyzes each slice's timbral features.
2. The gesture character of the performer's movement influences the deposit — smooth playing deposits tight clusters, agitated playing scatters particles wider (within the feature-space region, not randomly across the sphere).
3. Particles migrate to their feature-determined positions, carrying the gesture-influenced density and spread.
4. The result: a sphere where sound is organized by timbre, but the *texture* of each region reflects how it was created. A region painted with smooth gestures has tight, orderly particle clusters. A region painted with agitated gestures has scattered, dense sprays.
5. When the performer navigates for playback, the gesture layer on top controls traversal: fast periodic motion through the bright region → rapid cycling through transient material. Slow smooth movement through the dark region → gradual timbral morphing.

### Implementation approach

**Phase 1: Feature-based auto-placement (new paint mode)**
- Add a paint mode toggle (standard / organized) in exp UI
- In organized mode, compute features per particle (already done in audio-features.js)
- Map features to lon/lat using adaptive normalization
- Animate particle migration from cursor position to feature position

**Phase 2: Gesture-influenced painting**
- Integrate gesture descriptor into the paint path (events.js paint handler)
- Modify particle count, scatter radius, and initial parameters based on gesture features
- This works in both standard and organized paint modes

**Phase 3: Timbral navigation feedback**
- Visual feedback: color particles by timbral features (already partially done via featuresToHSL)
- Add a "timbral compass" overlay showing what feature region the cursor is in
- Tune search radius and k behavior for organized mode

### Existing infrastructure

- `audio-features.js`: `snapshotInputFeatures()` returns `{ rms, centroid, zcr }` — already called during painting
- `featuresToHSL()`: maps features to color — already used for particle visualization
- `renderer.js`: particle position is read from `particle.lon`, `particle.lat` — just change what sets these
- `events.js`: paint handler creates particles with `{ lon, lat, source, sampleIndex, ... }` — the insertion point for both features
- `grain.js`: k-nearest search uses `angleBetweenSphere()` — works identically on an organized sphere, no changes needed

### Key design decision: coexistence with standard mode

The self-organizing mode should be a separate paint mode, not a replacement. Some performances benefit from intentional spatial placement (the performer decides where sounds live). Others benefit from automatic timbral organization (the system decides, the performer navigates). Both should be available, switchable, and potentially mixed (paint some material by hand, let other material self-organize).

---

## Performance Scenarios

### Solo clarinet, improvised
- Play phrase into mic → system records into granular buffer
- Slow sustained tilt (high smoothness, high effort) → spectral freeze holds phrase in focused spatial position
- Switch to quick indirect fidgeting (low smoothness, low effort, low directness) → frozen phrase disintegrates into scattered grain fragments
- Performer thinks "hold this" then "break it apart" — body knows how to express that

### Duo with vocalist, composed
- Resonant filter bank active on live input
- Slow rising gesture (sustained, light) → filter Qs increase, spatial spread widens → single voice note blooms into overtone halo across speakers
- Fast downward gesture (sudden, strong) → Qs snap to minimum, spread narrows → voice exposed, naked, center

### Feedback delay network, site-specific
- Sax multiphonic feeds delay network, taps routed to speakers via VBAP
- Circular wand motion → system detects periodicity → delay feedback rises, times modulate in sync with rotation
- Stop moving → cessation detected (high deceleration) → feedback drops below unity, delays freeze → wash decays with inertia

### Accumulated state / energy
- Each phrase + gesture deposits energy into the system
- Small gestures → modest reverb tail, few grains, low feedback
- Bigger gestures → more accumulated energy → longer tails, more grains, higher feedback
- Stop playing and moving → system doesn't go silent, accumulated state decays at different rates (reverb 3s, grains 10s, delay 20s)
- Performer builds a sonic environment over time, then steps back to let it breathe

---

## Implementation Status

| Module | File | Status |
|---|---|---|
| Feature flag | `js/state.js` (EXP const) | done |
| Lazy loader | `js/main.js` (dynamic import) | done |
| Bootstrap | `js/exp/exp-init.js` | done |
| Gesture extraction | `js/exp/gesture.js` | built — needs live testing with wand |
| Gesture visualization | `js/exp/gesture-viz.js` | built — overlay panel, press G to toggle |
| OSC hook | `js/osc.js` line 191 | done — `S._onGestureUpdate?.()` (no-op when exp off) |
| Resonant filter bank | `js/exp/resonant-filters.js` | not started |
| Convolution reverb | `js/exp/convolver.js` | not started |
| Feedback delay network | `js/exp/fdn.js` | not started |
| Spectral freeze | `js/exp/spectral-freeze.js` | not started |
| Gesture → sonic mapping | `js/exp/gesture-map.js` | not started |
| Gesture-influenced painting | `js/exp/gesture-paint.js` | not started — design doc written |
| Self-organizing sphere | `js/exp/organized-paint.js` | not started — design doc written |

---

## Technical Notes

### Where processing modules insert into the audio chain

Current chain (from grain.js):
```
AudioBufferSourceNode → GainNode (envelope) → [ElevationGain] → VBAP → speakerBuses
```

Master bus (from audio.js):
```
monitorBus / houseBus → masterBus → softClipper (WaveShaper) → masterAnalyser → muteGain → destination
```

- **Per-grain effects** (filter per grain): insert between GainNode and VBAP routing
- **Master bus effects** (reverb, FDN): insert between masterBus and softClipper
- **Input effects** (on live mic before recording): insert after mic stream, before recording buffer

### Accessing existing infrastructure from exp modules
- `S` object: import from `'../state.js'` — all shared state lives here
- Audio context: `import { ensureAudioContext } from '../audio.js'`
- Sensor data: available on `S` after sensor.js processes each frame
- Wand inertial: gyro/accel arrive via OSC, stored on wand state
- VBAP: `import { vbapGains } from '../grain.js'` for speaker routing
- Presets: experimental params can be added to preset save/load via S

### Node budget
- MAX_GRAIN_NODES = 150 concurrent AudioBufferSourceNodes
- BiquadFilter, Gain, Delay nodes are much cheaper than source nodes
- A 6-filter resonant bank + convolver + 4-tap FDN adds maybe 15 persistent nodes — negligible
