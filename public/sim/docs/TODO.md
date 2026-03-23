# TODO — Current Tasks & Priorities

> Update this file at the end of every Cowork/Claude Code session.
> New sessions: read this after CLAUDE.md to pick up where we left off.

---

## Active — Workshop Prep (Dartmouth, week of Mar 30)

### Memory & Stability (long sessions on student machines)

- [ ] **Recording time meter** — lightweight HUD element showing total recorded time across all buffers. Gives performer awareness of memory pressure without expensive byte-counting. Show in seconds/minutes.
- [ ] **Verify `sweep` actually frees memory** — test that sweep command releases AudioBuffer references and allows GC. If not, fix so buffers are truly deallocated. Document expected RAM recovery.
- [ ] **Stress-test long sessions** — record continuously for 15–30 min in Chrome, monitor memory in DevTools. Identify if/when things stall or crash. Set a practical per-session recording ceiling if needed.
- [ ] **Graceful memory guard** — if feasible, warn performer when approaching a configurable recording limit (e.g., flash the recording meter red). Stretch: auto-sweep oldest buffers.

### Multi-Channel / VBAP

- [ ] **Verify 8-channel VBAP** — test with 8-speaker layout in Electron. Confirm VBAP lookup table generates correctly, panning is smooth, no dropped/silent channels.
- [ ] **Stretch: test 42-channel VBAP** — try the full Dartmouth layout. Identify any performance cliffs (lookup table size, per-grain cost). Have a fallback plan if 42 is too heavy.
- [ ] **Electron multi-channel setup docs** — write a short checklist for getting Electron + multi-channel output running on a fresh machine (students may need to set this up).

### General Reliability

- [ ] **Full test pass** — run through the core workflow end-to-end (mic input → record → paint → scan → seed → sweep → repeat) on Chrome and Electron. Note and fix any rough edges.

## Deferred — Gesture & Experimental (post-workshop)

- [ ] **Test gesture extraction with live wand** — load `?exp`, wave wand, verify viz panel shows meaningful features. Tune scaling constants in `gesture.js` (JERK_SCALE, EFFORT_GYRO_SCALE, ENERGY_DECAY, etc.) based on real IMU data.
- [ ] Build gesture-to-sonic mapping layer (`js/exp/gesture-map.js`) — translates gesture features into sonic quality targets with temporal smoothing and inertia.
- [ ] Gesture-influenced painting (`js/exp/gesture-paint.js`) — smoothness→brush tightness, effort→density, directness→coherence, periodicity→rhythmic deposit. See EXP-NOTES.md for full design.
- [ ] Self-organizing sphere / concatenative paint mode (`js/exp/organized-paint.js`) — auto-place particles by timbral features (centroid→lon, RMS→lat, ZCR→secondary), adaptive normalization, particle migration animation. See EXP-NOTES.md for full design.
- [ ] Resonant filter bank on master bus (`js/exp/resonant-filters.js`) — first audio processing module, controlled by gesture layer
- [ ] Convolution reverb with gesture-controlled wet/dry (`js/exp/convolver.js`)
- [ ] Feedback delay network (`js/exp/fdn.js`) — cross-coupled delays routed through VBAP

## Someday

- [ ] **Custom signal routing layer** — per-signal routing from breakout streams to arbitrary destinations. Design doc: `docs/ROUTING-DESIGN.md`. Plumbing scaffolded in sensor-registry.js (role arrays, route model, dispatch functions, persistence) and ui-sensors.js (breakout table with locked/editable destinations). Needs wiring to renderer, gesture, and morph consumers before it's usable. Build when preset roles (cursor/gesture/frame) aren't flexible enough.
- [ ] Spectral freeze via AudioWorklet (`js/exp/spectral-freeze.js`)
- [ ] Phase vocoder pitch shift for spatial harmonization
- [ ] Stochastic trigger zones on sphere
- [ ] Flocking/boid-driven audio from particle behavior

## Done

- [x] **UI scale slider** — viz settings → panel & text size (0.7–1.6×), persisted to localStorage, scales all UI except 3D canvas
- [x] **HUD quadrant redesign** — top=scan off, left=seed lock, right=loop lock, bottom=patch number
- [x] **Param panel overhaul** — flattened headings, removed dividers, morph as independent collapsible, visual polish pass
- [x] **Shift+D/S flash fix** — `_plainD`/`_plainS` flag pattern prevents button flash on modified key combos
- [x] **Fixed panel width** — no longer scales with viewport, responds only to UI scale slider
- [x] **Bug: rapid uproot blocked by release fade** — fixed: `findNearestSeedSlot()` skipReleasing, HUD count immediate, releasing slots reusable for sowing
- [x] **Unify key bindings + add seed lock mode** — ⇧D loop lock, ⇧S seed lock, ⌘D lift, ⌘S uproot, cursor panel reorg (trace → scan → undo → [lock row])
- [x] Build gesture extraction module (`js/exp/gesture.js`) — smoothness, effort, periodicity, accumulated energy, directness
- [x] Build gesture visualization overlay (`js/exp/gesture-viz.js`) — live feature bars, gyro trace, energy arc. Press G to toggle.
- [x] Hook gesture update into osc.js wand inertial path (`S._onGestureUpdate?.()`)
- [x] Set up `?exp` feature flag system (EXP in state.js, lazy loader in main.js, exp-init.js bootstrap)
- [x] Clean up repo — delete audit .md files, move reference docs to `docs/`, add CLAUDE.md
- [x] Transfer repo to kalun88/muboneapp, update README
