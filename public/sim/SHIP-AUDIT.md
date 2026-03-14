# Pre-Ship Audit — Mubone Web

Audited all ~15k lines across 26 source files. Findings below are verified and ordered by impact.

---

## CRITICAL — Fix before sharing

### 1. Per-frame allocations in `drawParticles()` (renderer.js:265–279)
Every frame builds a fresh `buf = []` array and `new Int32Array(count)` for depth-sorting. With hundreds of particles this creates constant GC pressure, causing frame-time jitter.

**Fix:** Pre-allocate a typed buffer and sort-index array at module level. Grow only when particle count exceeds capacity.

### 2. Event listener accumulation in `setupCropInteraction()` (ui-samples.js:651, 665)
`document.addEventListener('mousemove')` and `mouseup` are added inside `setupCropInteraction()`. Each time `rebuildSampleListUI()` is called (loading/deleting samples), new listeners stack up on `document` — old ones are never removed.

**Fix:** Use `AbortController` or store/remove previous listeners before adding new ones. (Note: `setupSvCropInteraction()` already does cleanup correctly — match that pattern.)

### 3. Wand modal RAF loop never stops (ui-wand.js:269–280)
`tick()` calls `requestAnimationFrame(tick)` unconditionally. It checks `modal.classList.contains('open')` to skip drawing, but the RAF itself keeps running forever. Opening the modal multiple times stacks duplicate RAF loops.

**Fix:** Cancel the RAF on modal close, restart on open.

### 4. Sensor modal RAF loop never stops (ui-sensor.js:153–162)
Same pattern — `updateLive()` calls `requestAnimationFrame(updateLive)` with no cancellation. Multiple modal opens stack loops.

### 5. `setInterval` never cleared in mobile settings (mobile.js:198)
The ~10Hz live readout interval runs forever, even after the settings panel is closed.

---

## MEDIUM — Should fix, won't crash but will annoy

### 6. Unused imports (renderer.js:13)
`qFromAxisAngle`, `qNormalize`, `qMul` are imported from sphere.js but never used. Local inline copies `_qFromAA`, `_qNorm`, `_qMul` (lines 585–593) are used instead. Dead imports add confusion.

### 7. `roundRect()` browser compatibility (renderer.js:249)
`S.ctx.roundRect()` is used for the radius tooltip but has no fallback for older browsers. Will silently fail and skip the tooltip entirely.

### 8. Console.logs left in production
- `ui-samples.js:37` — "Loaded sample" on every sample load
- `audio.js:226, 493, 775, 849` — various audio lifecycle messages
- `midi.js:132` — "MIDI not available"
- `osc.js:73, 102, 116` — OSC transport diagnostics
- `sensor.js:43, 149` — sensor init messages

These are fine for dev but will clutter collaborators' consoles. Consider wrapping behind a `DEBUG` flag.

### 9. Dead state properties (state.js:654–656)
`altFrozenMouseX` and `altFrozenMouseY` are written but never read. Only their pixel-coordinate counterparts (`altFrozenMousePixelX/Y`) are actually used anywhere.

### 10. `cloudGainNodes` never populated (state.js:832)
Declared as `null` with a comment about lazy creation, but nothing in the codebase ever assigns to it. Either the assignment is missing or this is dead code.

### 11. Null-pointer risk in preset save (ui-presets.js:52–53)
```js
btn.querySelector('.preset-name').textContent = ...
```
The inner `querySelector` result is not null-checked. If `.preset-name` is missing from the DOM structure, this crashes.

### 12. CSS z-index collisions on modals
`#sampleModal`, `#audioSettingsModal`, `#sensorModal`, `#wandModal`, `#vizModal` all share `z-index: 200`. If multiple modals are somehow open, stacking order is undefined. Meanwhile `#mappingModal` jumps to `z-index: 1000`.

### 13. `transition: display 0s` does nothing (style.css:1013)
`display` is not animatable. Should use `visibility` if the intent is a delayed hide.

### 14. Keyboard focus indicators removed (style.css:3–4)
`button { outline: none }` and `button:focus-visible { outline: none }` strip all focus indicators with no replacement. Keyboard-only users can't see what's focused.

---

## LOW — Polish, won't cause problems

### 15. Double projection of active grains (renderer.js:265–276 + 329–344)
Particles in `activeGrainMap` are projected in the main loop and again in the glow pass, duplicating the spherePoint/cameraTransform/project math.

### 16. DOM query every frame (renderer.js:572–575)
`document.getElementById('coordinates')` is called on every animation frame. Cache the element reference.

### 17. `rec-glow` animation uses box-shadow (style.css:507–510)
Continuous `box-shadow` animation triggers repaints. Use `opacity` or `filter` for GPU-composited animation instead.

### 18. `-moz-appearance: textfield` is deprecated (style.css:127)
Standard `appearance: textfield` is present too, so this works fine — just remove the `-moz-` prefix eventually.

### 19. Webkit-only scrollbar styling (style.css:1366–1368)
`::-webkit-scrollbar` styles don't work in Firefox. Add `scrollbar-width: thin; scrollbar-color: ...` for cross-browser support.

### 20. `LIVE_PAINT_COLORS` still imported in places only needed for particles
Now that the cursor is hardcoded red, some of the `LIVE_PAINT_COLORS` imports could potentially be trimmed if they're only used for cursor display. (They're still needed for per-particle colors though, so just noting for awareness.)

---

## Not bugs (verified false alarms)

- **Canvas save/restore in `drawCursor()`** — actually balanced. The early return at line 360 happens before `save()`, and line 367's return correctly calls `restore()`.
- **`mobileFullscreenBtn` missing** — it exists in index.html line 94.
- **Electron security** — `nodeIntegration: false`, `contextIsolation: true` are correctly set. Preload script is properly scoped.
