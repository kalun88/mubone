# mubone — Pre-Release Audit

**Date:** March 15, 2026
**Scope:** Full UX legibility + technical audit of the web preview app
**Codebase:** ~600KB across 22 JS modules, 1 HTML file, 1 CSS file

---

## PART 1: USABILITY & LEGIBILITY — Top 10

### U1. "k" is cryptic to new users
**Severity: HIGH** — The label "k" appears throughout (search panel, preset stats, grain tooltips) with no inline explanation. A collaborator who isn't steeped in granular synthesis / kNN terminology won't know what it means. The tooltip says "nearest neighbours to fire per grain tick" which helps, but the label itself is a barrier. Consider "neighbors" or "voices" in the UI with "k" as the short label only in expert/compact views.

### U2. "dur ±" / "per ±" / "pitch ±" labels are ambiguous
**Severity: HIGH** — The ± suffix convention for jitter/variation parameters is used consistently, but a new user seeing "dur ±" has no idea this means "random variation applied to grain duration." The tooltips explain it, but tooltips require hover — they're invisible on first glance and nonexistent on touch. These compound labels read as mathematical notation, not UI labels.

### U3. "lock" / "k-all" / "k-seq" mode buttons have no onboarding
**Severity: HIGH** — These three mode toggles in the search panel radically change playback behavior but have only icon+label. A new collaborator clicking "k-all" won't understand why CPU usage spikes and everything sounds dense. There's no inline hint, no visual feedback of what changed (the label just toggles between "k-all" and "all"), and no way to understand the implications without reading documentation that doesn't exist yet.

### U4. "recency" parameter is opaque
**Severity: MEDIUM** — "recency — recent grains to skip" in the tooltip is technically correct but not intuitive. A user might expect "recency" to mean "prefer recently painted particles" (which it doesn't — it means "skip the N most recently played particles to avoid repetition"). The mental model is inverted from the name.

### U5. Sensor toolbar row visible but non-functional for most users
**Severity: MEDIUM** — The sensor row (connect, cursor zero, wand, wand tare) is always visible in the top bar. For a collaborator using the web preview without a mubone IMU, this is dead space with buttons that do nothing. The "sensor" group label helps but the buttons still feel clickable. No disabled state or "requires hardware" hint.

### U6. "seeds" vs "looper" vs "cursor" mental model
**Severity: MEDIUM** — Three separate devices (cursor, looper, seeds) that all produce granular audio from painted particles but via different mechanisms. The relationship between them isn't explained anywhere in the UI. A new user might not realize that "cursor" = live granulation, "looper" = recorded gesture playback, "seeds" = placed autonomous granulators. The "drop" action appears in both looper and seeds with different meanings (drop a loop vs drop a seed).

### U7. "spread" parameter is displayed as raw float (0.60)
**Severity: LOW** — Most parameters show human-friendly units (ms, %, °, ¢) but spread shows a raw 0.00–1.00 float. Should be 0%–100% for consistency. Same issue with "vol" showing raw float instead of dB or %.

### U8. The "dir" (direction) and "curve" labels are too terse
**Severity: LOW** — "dir" with ▶ ◀ ⇄ icons is reasonably guessable but "curve" with ∿ ⋀ ⊓ requires granular synthesis knowledge to understand (hann window vs triangle vs rectangular envelope). These are specialized terms with no explanation accessible from the main UI.

### U9. "fade" appears in two different contexts
**Severity: LOW** — "fade" in the grain panel means envelope attack/release ratio (fadeRatio). "fade" in the cursor panel means radius-based volume attenuation. Same word, completely different functions. A user adjusting "fade" in one panel might expect the same behavior in the other.

### U10. No visual indication of audio state on page load
**Severity: LOW** — The app loads silently with "no sample" and "no input active" status. A new user doesn't know they need to either enable the mic or load a sample to hear anything. The only hint is the small "enable mic" button and the drag-drop overlay (which only appears during a drag). A first-run prompt or empty-state message would help.

---

## PART 2: TECHNICAL — Top 10

### T1. Stale AudioNode references after AudioContext recreation
**Severity: CRITICAL** — `audio.js` lines 517–519, 208: Module-level variables (`_captureNode`, `_merger`, `_meterTap`, `_headphoneNode`) are not reset when `recreateAudioContext()` is called. Only `_recWorkletReady` is cleared. If `rewireChannelMerger()` or `rewireMonitorChannels()` fires between context recreation and `initSpeakerBuses()`, it operates on nodes connected to a closed context — causing "connection to inactive node" DOMExceptions.

### T2. Recording handler race on rapid start/stop
**Severity: CRITICAL** — `audio.js` lines 401–441: `startLiveRecording()` attaches a message handler closure that captures `S.recordingRaw`. `stopLiveRecording()` posts a stop message then nullifies the handler, but messages arriving between the postMessage and the null assignment write to potentially freed state. During rapid record-stop cycles, multiple stale closures can accumulate.

### T3. Floating-point onset clock can schedule duplicate grains
**Severity: HIGH** — `grain.js` line 1054: The `_cursorNextOnsetT` re-anchoring logic checks `offset > 0 && offset < SCHED_LOOKAHEAD * 2` but has no protection against negative offsets. If a timing glitch causes the clock to snap backward between check and re-anchor, duplicate grains are scheduled at the same time, causing amplitude spikes.

### T4. Sequential pool state reset race condition
**Severity: HIGH** — `grain.js` line 1272: `seed._seqPool = null` is set unconditionally every tick when kSeqMode is true, racing with `seed._seqIdx` increments in the scheduler loop. If kSeqMode toggles mid-iteration, `_seqIdx % undefined.length` crashes.

### T5. speakerBuses accessed before initialization in Electron
**Severity: HIGH** — `audio.js` lines 778, 828–829, 874: `rewireMonitorChannels()` reads `S.speakerBuses.length` and `.numChannels` but can execute from UI handlers before `initSpeakerBuses()` runs. `S.speakerBuses` is undefined at that point, causing a TypeError.

### T6. addEventListener accumulation on source nodes
**Severity: HIGH** — `grain.js` lines 646, 703, 748, 760: Multiple `addEventListener('ended', ...)` calls are registered on the same source node across different code paths without `removeEventListener()`. In fallback paths (cursor muted with mixdown), the same ended event can fire multiple handlers, each decrementing `S._grainSourceCount` independently — causing counter underflow and ghost grains.

### T7. Seed envelope uses wall clock, not audio clock
**Severity: MEDIUM** — `grain.js` line 1135: Seed attack/release envelopes use `performance.now() / 1000` (wall-clock) instead of `audioCtx.currentTime`. Over long sessions, skewed `_plantedAt` timestamps cause attack curves to never complete or release to trigger at wrong times.

### T8. Input coalescing race condition
**Severity: MEDIUM** — `events.js` lines 30–43: The input coalescing mechanism uses a simple boolean flag `_inputRAFPending` without atomic protection. Multiple simultaneous input handlers (mousemove, touchmove) can trigger redundant `requestAnimationFrame` calls. In rapid input, `_flushInput()` may execute while new values are being written.

### T9. Unhandled promise rejection in drag-and-drop
**Severity: MEDIUM** — `events.js` lines 532–537: The async IIFE loading dropped audio files has no error handler. If `loadAudioFile()` rejects, the promise rejection is unhandled and the app state becomes inconsistent (sample indicator may show stale data).

### T10. _vbapLUT null access in seed playhead panning
**Severity: MEDIUM** — `grain.js` line 1520: Code accesses `_vbapLUT[spAzDeg]` without guarding against `_vbapLUT` being null. If `buildVBAPLookup()` was never called or received an empty speaker array, a seed grain scheduled before VBAP initialization causes a runtime crash.

---

## PART 3: CSS & ACCESSIBILITY

### A1. Slider thumb is 3×12px — unusable on touch
`style.css` line 860: `.grain-slider::-webkit-slider-thumb { width: 3px; height: 12px; }` — WCAG minimum is 44×44px. Every slider in the app (20+ sliders) is practically undraggable on mobile/tablet.

### A2. Sensor group label contrast ratio ~2:1
`style.css` line 73: `.sensor-group-label { color: #444; }` on `#161616` background. Fails WCAG AA (needs 4.5:1). The separator dot at `#333` is even worse.

### A3. No focus-visible styles for sliders, selects, or custom buttons
Only `button:focus-visible` is globally styled. Keyboard users can't see which slider, dropdown, or segmented control is focused. The sensor modal's axis mapping buttons have no focus indicator at all.

### A4. Modals share z-index 300
Lines 1709, 1868, 2025, 2304: Multiple modals use `z-index: 300`. If two modals open simultaneously (e.g., audio settings then camera mode), stacking order is undefined and depends on DOM position rather than intent.

### A5. No responsive breakpoint below ~1100px
The `clamp(14px, 1.2vw, 19px)` font scaling and `clamp(220px, 20vw, 320px)` right panel width assume a wide viewport. On a 768px iPad portrait, the right panel consumes ~30% of the screen and the canvas is too small to paint accurately. No media queries adjust layout.

---

## BONUS: Quick Wins

These are low-effort, high-impact improvements for collaborator readiness:

1. **Add a first-run overlay** — "drag an audio file onto the sphere, or click 'enable mic' to start" covers the empty state confusion
2. **Add `title` attributes on the mode buttons** — lock, k-all, k-seq already have good tooltips but they could be more prominent (e.g., a ? icon that shows a one-liner)
3. **Show "spread" as percentage** — trivial formatting change from 0.60 to 60%
4. **Grey out sensor row** when no sensor is connected (add `opacity: 0.5` and a "(no sensor)" label)
5. **Add `{ once: true }` to source node ended listeners** — already done in most places but verify all paths to prevent the T6 accumulation issue
