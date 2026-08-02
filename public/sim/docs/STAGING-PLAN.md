# Control Staging — Implementation Plan

> **Status: HISTORICAL PLAN — implemented.** Staging (snapshot engine, posture map, MIDI/OSC out) shipped in 1.11 and is always-on. Kept for the design reasoning and the mapping-preset schema; the `?exp` gating it describes no longer exists.

> Context: repurpose mubone as an advanced x-IMU staging / mapping / control
> surface for external software (oVox, VocalSynth) or hardware (expression
> pedals, analog synths). Audio does NOT flow through mubone in this mode —
> the performer's mic goes straight to their DAW, and mubone emits MIDI/OSC
> control data only. The grain engine stays available; staging is additive.
>
> _Historical note: this plan originally proposed gating staging behind a `?exp` URL flag. That flag has since been removed — staging is now always-loaded (visible via the `◇ staging` top-bar button). The Change A / Change B architecture below still applies; the flag language just no longer matches code._
>
> Related TODOs this plan absorbs:
> - #122 — OSC values out (Change A)
> - #117 — mapping module macro groups (adjacent to mapping-preset concept)
> - #112 — radial morph (shares interpolation math with Change B)
> - #118 — expose gesture energy as mappable source (benefits both changes)

---

## Two orthogonal changes

The staging feature decomposes into two independent capabilities that can
ship separately.

**Change A — transport + direct pass-thru.** Extend the existing mapping
engine (`sensor-mapping.js`) so each row can output to MIDI CC or OSC
instead of (or in addition to) a grain parameter. Same row UX, new
destination type. This alone makes mubone a control surface.

**Change B — snapshot-based posture macros.** A new parallel engine where
the performer drops snapshots in a relational-feature space, each snapshot
stores a set of output values, and live outbound values are interpolated
by spatial distance between snapshots. Different paradigm, different UX,
shares only the transport layer with Change A.

**Ordering:** ship Change A first. It stands alone, unblocks live use with
oVox/VocalSynth, and exercises the transport plumbing that Change B will
depend on. Change B builds on top.

---

## What already works

Pieces we get for free, in rough order of relevance:

- **Row-based mapping engine** — `sensor-mapping.js` already models what
  Change A needs: `{axis, inputMin, inputMax, curveType, curveExp,
  outputMin, outputMax, enabled}`, evaluated at ~30Hz, written to a
  destination. Only the destination-write step changes.
- **External input buckets** — `/mapping1..3` (sensor-mapping.js:57) are
  already wired for arbitrary OSC inputs. The joycon GUI already emits
  into them. Change A rows can target them as inputs for free.
- **Frame/cursor role system** — `sensor-registry.js:24` already has the
  `cursor` / `frame` / `unmapped` quaternion roles needed for Change B's
  relational layer (chest = frame, hand = cursor or new `active` role).
  `getByRole('frame')` gives us the frame quaternion directly.
- **Inverse-distance interpolation** — `applyRadialMorph()` in
  `js/gesture.js` (in progress per #112) does IDW blending between
  pinned presets. Change B can share or parallel this math.
- **Outbound OSC plumbing (internal)** — `sendOSC(address, values)` in
  `js/osc.js` already forwards JSON-over-UDP to the local relay on port
  7501, which rebroadcasts to peers like the joycon GUI (for
  player-light / home-light / rumble feedback). This path stays as-is
  for internal peers. It is NOT real OSC binary and has no configurable
  destination, so Change A needs a separate transport for external
  receivers (oVox, Ableton OSC plugin, hardware). See transport section.
- **Electron UDP infrastructure** — `electron-main.js` already owns a
  `dgram` socket and parses inbound real OSC. Outbound real OSC to
  arbitrary host/port is a small additive extension of the same socket.
- **Gesture features** — `S.gesture.{smoothness, effort, directness,
  periodicity, accumulatedEnergy, jerk}` already computed per tick.
  Available as input sources for both changes.
- **Always-on module wiring** — `main.js` imports new modules directly; nothing
  needs a URL flag anymore. Untested code paths should stay as standalone
  modules that aren't auto-imported — reachable via DevTools console instead.

---

## Design decisions (locked)

| Decision | Choice |
|---|---|
| Posture identity (Change B) | 3 Δ-angles default (Δaz, Δpitch, Δroll); configurable checklist exposes rate / intensity / energy as optional identity components |
| Crossfade math (Change B) | Gaussian kernel, k-nearest barycentric, and snap-to-nearest all ship; per-module dropdown picks which is active; Gaussian default |
| Output channel definition | Declared once at module level as `{name, protocol, address}`; every snapshot stores a value per channel; user-text channel names (mubone is protocol-agnostic about semantics) |
| Mapping presets | The channel set + protocol bindings is saveable as a named mapping preset (e.g. "oVox+Ableton", "hardware pedals"). Load/swap mid-show; snapshots preserve values across swap by matching channel *name* |
| Relational pairs | One for MVP — one IMU marked as frame, one as active. Δ-signals derived from these two |
| Per-axis normalization | Each Δ-axis normalized to its active range before Euclidean distance; user can also weight per axis (slider bias) |

---

## Change A — transport + direct pass-thru

### 1. MIDI-out transport

**New module:** `js/midi-out.js` (separate from `midi.js` which handles
MIDI input for action triggers).

- Initialize `navigator.requestMIDIAccess({ sysex: false })` on demand.
- Expose `getOutputs()` returning connected MIDI output devices.
- Expose `sendCC(deviceId, channel, cc, value14bit)`:
  - If row is 7-bit: `value` clamped to 0–127, single CC message.
  - If row is 14-bit: pair CC `cc` (MSB) + CC `cc+32` (LSB) per MIDI spec.
- Throttle: per-(device, channel, cc) tuple, drop duplicate consecutive
  values; cap outbound rate to 200Hz per tuple.

Rationale on 14-bit: the performer asked about resolution; stock 7-bit
loses perceivable resolution on slow morphs (especially formant/filter
sweeps). Paired CC is the MIDI-standard fix and most DAWs map it.

### 2. OSC-out transport (external)

External OSC destinations (DAWs, plugins with OSC receivers, hardware)
expect real OSC binary on arbitrary UDP host:port. This is a separate
path from the existing `sendOSC()` which targets the internal relay on
a fixed port with JSON payload — that path stays untouched, as it's how
the joycon GUI gets its LED/rumble feedback.

**Extend Electron main** (`electron-main.js` + `electron-preload.js`):

- Add `sendOSCExternal(host, port, address, args)` on main process. Uses
  the existing `dgram` socket (or a second dedicated one if cleaner).
  Serializes real OSC binary (address string, type tags `,f`/`,i`/`,s`,
  arg values, all 4-byte-aligned per the OSC 1.0 spec).
- Expose via preload as `window.electronBridge.sendOSCExternal(host,
  port, address, args)`.

**Browser mode:** the Max/WebSocket bridge is being deprecated. Browser
mode shows a banner in the staging UI explaining that external OSC
requires the Electron build; MIDI-out still works in browser via WebMIDI.
No further fallback plumbing needed.

**New module:** `js/osc-out.js` — wrapper that handles real-OSC encoding,
per-destination throttling (identical to MIDI-out), and the Electron-only
gate. Internal `sendOSC()` stays where it is and is unaffected.

### 3. Mapping engine: new output types

**Extend `sensor-mapping.js`:**

- Current row shape gains `output` block:
  ```js
  output: { kind: 'grain', param: 'hpfFreq' }                    // existing
  output: { kind: 'midi',  device: '...', ch: 1, cc: 20, bits: 7 }
  output: { kind: 'osc',   host: '127.0.0.1', port: 9000, address: '/formant' }
  ```
- `MAPPABLE_PARAMS` (sensor-mapping.js:36) becomes one of three destination
  catalogs. UI picks `kind` first, then destination fields appropriate to
  that kind.
- In `tickMappings()`, dispatch on `output.kind`: grain path stays
  identical; midi/osc paths call `midi-out.sendCC` / `osc-out.sendMessage`
  with the scaled, curved value.

### 4. UI changes

**Extend `ui-sensor-mapping.js`:**

- Each row's destination picker becomes two-level: kind dropdown
  (grain / midi / osc) + destination-specific fields.
- Global settings block at top of modal: MIDI device selector, default
  OSC host/port, 14-bit toggle for new MIDI rows.
- Non-grain rows get a distinct visual accent so performer can see at a
  glance which rows drive external gear vs. internal audio.

### 5. Persistence

Mappings already persist to localStorage (session-level). No schema change
beyond the new `output` block — existing grain-param rows get a default
`output: {kind: 'grain', ...}` on first load via a migration pass.

---

## Change B — snapshot-based posture macros

Lives in `js/`. Always loaded at startup. Imports hooked directly from
`main.js`.

### 1. Relational feature layer

**New module:** `js/relational-features.js`.

- Reads `getByRole('frame')` and `getByRole('cursor')` — no new role
  required. Cursor stays the cursor (still drives the sphere); staging
  just also reads it. Not mutually exclusive.
- Computes frame-inverse quaternion × cursor quaternion → difference
  quaternion → Δeuler (az, pitch, roll).
- Also exposes Δ-angular-rate and a relational magnitude if user opts in
  via the posture-identity checklist.
- Writes to `S.staging.relational = { daz, dpitch, droll, drate, ... }`
  once per sensor tick.

If no frame is assigned, Change B falls back to absolute angles from
cursor — still works, just loses directional independence. Module shows a
banner prompting the user to assign a frame role.

If the performer eventually wants the sphere cursor and the staging
active-sensor to be *different* IMUs (e.g. x-imu3 for sphere, separate
chest+hand pair for staging), that's a later enhancement — add a
staging-specific "active" role then. For MVP, one cursor drives both.

### 2. Snapshot data model

```js
S.staging.snapshots = [
  {
    id: 'snap-1',
    label: 'open vowel',
    identity: { daz: 20, dpitch: -12, droll: 3, /* + optional components */ },
    values: {                  // keyed by channel name
      formant:    0.72,
      pitchShift: 0.45,
      filter:     0.10,
    },
    color: '#...',             // for map viz
  },
  // ...
];

S.staging.mappingPreset = {
  name: 'oVox + Ableton',
  channels: [
    { name: 'formant',    protocol: 'midi', device: '...', ch: 1, cc: 20, bits: 14, min: 0, max: 1 },
    { name: 'pitchShift', protocol: 'midi', device: '...', ch: 1, cc: 21, bits: 14, min: 0, max: 1 },
    { name: 'filter',     protocol: 'osc',  host: '127.0.0.1', port: 9000, address: '/cutoff', min: 0, max: 1 },
  ],
};

S.staging.mappingPresetLibrary = [ /* saved mapping presets */ ];

S.staging.interpolation = {
  mode: 'gaussian',   // 'gaussian' | 'knearest' | 'snap'
  sigma: 0.3,         // Gaussian width (in normalized identity space)
  k: 3,               // k-nearest only
  axisWeights: { daz: 1, dpitch: 1, droll: 1 },
};
```

### 3. Snapshot engine

**New module:** `js/snapshot-engine.js`.

Every tick:

1. Read `S.staging.relational` (live identity vector).
2. Normalize each identity component to its active range (derived from
   snapshot extents), apply `axisWeights`.
3. Compute distance from live vector to each snapshot.
4. Compute per-snapshot weights:
   - `gaussian`: `w_i = exp(-d_i² / 2σ²)`, normalize so Σw = 1
   - `knearest`: zero all but k nearest, barycentric weights on the rest
   - `snap`: `w_i = 1` for argmin, else 0
5. For each channel: `output = Σ w_i * snapshot_i.values[channel]`.
6. Emit via `midi-out` / `osc-out` using channel's protocol binding.

Reuse math from `applyRadialMorph()` in `js/gesture.js` — #112 already
implements IDW; lift the kernel into a shared helper
(`js/interp-kernels.js`) that both radial morph and snapshot engine
import.

### 4. Posture map UI

**New module:** `js/ui-posture-map.js`.

3D canvas (Three.js or lightweight custom — match what `renderer.js` uses
for the sphere). Axes = Δaz / Δpitch / Δroll. Elements:

- Snapshots as labeled colored spheres at their identity coordinates.
- Live cursor as a pulsing dot.
- Optional: lines from cursor to each snapshot with line opacity =
  interpolation weight (great feedback while tuning σ).
- Click empty space → drop snapshot at current live identity, open a
  small panel to set label + per-channel values.
- Drag existing snapshot → edit identity (rarely useful but cheap).
- Delete snapshot → right-click or trash button in edit panel.

When posture identity has >3 components, map shows first 3 and includes
a legend noting hidden dimensions still affect distance.

### 5. Channel editor

**New module:** `js/ui-channels.js`.

- Table of channels. Columns: name (text), protocol (midi/osc), address
  fields, min, max, test-send button.
- "Save as mapping preset" → names current channel set and stores to
  `mappingPresetLibrary`.
- "Load mapping preset" dropdown — swaps `mappingPreset` live. Snapshot
  values carry over by channel name; unmatched channels in old snapshots
  get flagged with a warning badge.

### 6. Snapshot-value editor

Right-click a snapshot on the map → panel opens with sliders for every
channel in the active mapping preset. Sliders show current interpolated
output alongside the stored value, so performer can see what's happening
live. "Capture current output" button grabs the currently-emitting values
and saves them into this snapshot (useful flow: set up the sound by
manual sliders, then pin it as a snapshot).

---

## File layout summary

```
js/
  midi-out.js              — new (Change A)
  osc-out.js               — new (Change A)
  sensor-mapping.js        — extended (Change A)
  ui-sensor-mapping.js     — extended (Change A)
  relational-features.js   — new (Change B)     [shipped — flat under js/]
  snapshot-engine.js       — new (Change B)     [shipped — flat under js/]
  interp-kernels.js        — new (Change B, shared with #112) [shipped]
  ui-posture-map.js        — new (Change B)     [shipped — Δaz/Δpitch/Δroll
                             canvas-2D viz; drag-orbit, click-drop, right-click
                             delete; snapshots as spheres with weight rings;
                             pulsing live cursor; weight lines cursor→snapshot]
  ui-channels.js           — merged into ui-staging.js (_buildChannels /
                             _buildChannelRow); separate module dropped to
                             keep the staging modal as a single render graph
  main.js                  — extended: direct imports of snapshot-engine +
                             ui-staging at startup (no lazy-loader hook —
                             the `?exp` flag was removed 2026-04-23)
electron-main.js           — extended (sendOSCExternal — real OSC binary
                             to arbitrary host:port; internal sendOSC /
                             sendOSCUplink for joycon feedback unchanged)
electron-preload.js        — extended (expose sendOSCExternal)
index.html                 — new modal shell + staging top-bar button
css/style.css              — new module styles
```

---

## Instrumentation / diagnostics surface

First-class requirement, not an afterthought — staging is a black-box
control layer sitting between sensor and external synth, and the performer
needs to see what it's doing at every step to trust it and debug it.
Every value that the engine reads, computes, or emits must be visible
live in the UI.

### Per-row telemetry (Change A)

Each mapping row in `ui-sensor-mapping.js` already shows raw input and
scaled output. For non-grain rows, extend this:

- **Raw input** — already shown.
- **Scaled/curved value** — already shown, relabel to "pre-output."
- **Emitted value** — what actually went on the wire. For MIDI,
  show the integer 0–127 (or 0–16383 for 14-bit) sent. For OSC, show
  the float as sent. These can differ from pre-output due to clamping,
  rounding, rate limit suppression.
- **Tx indicator** — a small dot that flashes on every emitted message.
  Steady-lit when rate-limiter is suppressing duplicates (i.e. we
  *would* send but the value hasn't changed). Dark when disabled.
- **Last error** — hover tooltip showing the last transport error for
  that row (MIDI device disconnected, OSC send failed, etc.).

### Global transport panel (Change A)

Collapsible panel at the top of the staging modal:

- **MIDI out:** device selector, "connected" / "not found" state, total
  messages sent, messages per second (1s EMA).
- **OSC out:** host/port shown, "available (Electron)" / "unavailable
  (browser)" state, total messages sent, per-second rate.
- **Test button** per destination — sends a known value (e.g. CC1 = 64)
  so the performer can verify reception in their DAW before a show.

### Posture map telemetry (Change B)

The 3D posture map is the primary instrument for Change B. Overlays:

- **Live cursor dot** — labeled with current Δaz / Δpitch / Δroll in
  degrees, updated at render rate.
- **Per-snapshot weight bar** — small bar next to each snapshot sphere
  showing its current interpolation weight (0–1). Sum should be ~1.0
  except in snap mode. Numeric readout on hover.
- **Distance readout** — line from cursor to each snapshot with length
  label (in normalized distance units). Optional, toggleable.
- **Weight sum indicator** — single number somewhere visible. If it
  drifts from 1.0, something's wrong with normalization.

### Channel output panel (Change B)

Separate pane showing, per channel:

- Channel name, protocol, destination address.
- Current **interpolated output value** (float, the result of the
  weighted blend).
- Current **emitted value** (after protocol scaling, clamping, rate
  limit — what's actually on the wire).
- A thin time-series sparkline of the last ~2s of output. Catches
  sudden jumps, confirms smooth morphs.
- A "hold" toggle per channel — freezes emission at current value. For
  troubleshooting: isolate which channel is causing the problem by
  holding the others.

### Top-bar quick-read

Even when the staging modal is closed, a persistent inline readout in
the top bar:

- Number of active mapping rows (Change A).
- Number of dropped snapshots (Change B).
- One-character mode indicator: `G` / `K` / `S` for Gaussian / k-nearest
  / snap.
- Overall tx rate (msgs/sec summed across all rows + channels).
- Tiny flashing dot on each outbound message. Same "steady when
  suppressed" convention as per-row indicator.

### Log mode

Toggle in the staging modal that, when enabled, writes every outbound
message to the console with a timestamp, row/channel name, pre-output,
and emitted value. Off by default (noisy). Use for post-hoc review of
a rehearsal or to confirm a bug is reproducible.

---

## Open questions (not blocking the plan, worth resolving early in build)

1. **σ tuning UX.** Gaussian width is abstract. Consider a "preview"
   overlay on the posture map showing isocontours of each snapshot's
   influence at the current σ. Helps performer set it by eye rather than
   by number.
2. **Output smoothing.** Raw interpolated values can twitch at snapshot
   boundaries when user crosses a Voronoi edge under k-nearest mode. One-
   pole smoother per channel (configurable time constant, default ~30ms)
   would smooth it. Gaussian mode doesn't need this.
3. **Voice-activity awareness.** Do we want mubone to silence outbound
   changes when the performer isn't making sound, so knobs don't drift
   during rests? Requires mic tap — otherwise audio is fully out of
   mubone in this mode. Punt to post-MVP.

---

## Versioning

When Change A lands it gets a minor bump from the then-current version
(e.g. 1.10 → 1.11); Change B gets another minor bump when it ships.
`CHANGELOG.md`, `index.html` version span, and `package.json` version
field all updated per CLAUDE.md.
