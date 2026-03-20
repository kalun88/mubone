# TODO — Current Tasks & Priorities

> Update this file at the end of every Cowork/Claude Code session.
> New sessions: read this after CLAUDE.md to pick up where we left off.

---

## Active

- [x] **Bug: keyboard shortcuts swallowed after clicking right panel** — fixed in `events.js`: added `_focusedOnFormField()` guard to both keydown listeners (skips shortcuts when text input/select/textarea focused), delegated mouseup blur on right panel for buttons/sliders/seg-buttons, Escape blurs focused field without triggering app actions.
- [ ] **Test gesture extraction with live wand** — load `?exp`, wave wand, verify viz panel shows meaningful features. Tune scaling constants in `gesture.js` (JERK_SCALE, EFFORT_GYRO_SCALE, ENERGY_DECAY, etc.) based on real IMU data.
- [ ] Build gesture-to-sonic mapping layer (`js/exp/gesture-map.js`) — translates gesture features into sonic quality targets with temporal smoothing and inertia.

- [x] **Bug: rapid uproot blocked by release fade** — fixed: `findNearestSeedSlot()` now takes `skipReleasing` option; `uprootNearestSeed()` skips fading seeds so successive uproots target the next live seed. Releasing seeds treated as free slots for sowing. HUD count drops immediately on uproot.

- [x] **Unify key bindings + add seed lock mode** — done: Loop lock remapped to ⇧D, seed lock (new) on ⇧S, lift → ⌘D, uproot → ⌘S. Seed lock auto-sows a trail for every paint trace. All cascading changes applied (MIDI/OSC table, events.js, patch table, osc.js, ui-meters.js, index.html tooltips, CSS).

## Up Next

- [ ] Gesture-influenced painting (`js/exp/gesture-paint.js`) — smoothness→brush tightness, effort→density, directness→coherence, periodicity→rhythmic deposit. See EXP-NOTES.md for full design.
- [ ] Self-organizing sphere / concatenative paint mode (`js/exp/organized-paint.js`) — auto-place particles by timbral features (centroid→lon, RMS→lat, ZCR→secondary), adaptive normalization, particle migration animation. See EXP-NOTES.md for full design.
- [ ] Resonant filter bank on master bus (`js/exp/resonant-filters.js`) — first audio processing module, controlled by gesture layer
- [ ] Convolution reverb with gesture-controlled wet/dry (`js/exp/convolver.js`)
- [ ] Feedback delay network (`js/exp/fdn.js`) — cross-coupled delays routed through VBAP

## Someday

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
