# Four viz changes — exact diff against 1.13a

> **Status: ARCHIVED 2026-09-05** — the 2026-08-24 viz pass; the reasoning behind the render-path additions. Its § *Settings that should follow* is the open list, now TODO #336.

> **Status: HISTORICAL** — all four changes **applied 2026-08-24** exactly as specified (change 0 + 1 + 1b in `js/renderer.js`, change 2 + 3 state in `js/state.js`, plus the `index.html` slider markup the doc didn't cover). Verified on the rig: `rig-audit.js` 86/86, no renderer errors. **All three follow-on settings closed 2026-08-24** — `gazeTrailSec` has a panel control, the size divorce is a recorded decision, and camera pull-back is built (`S.camPull`, viz-panel slider). Kept in `docs/` only until someone confirms pull-back on the rig with a real cloud; nothing else here is open.

Anchors verified against `js/renderer.js` (1714 lines) and `js/state.js` (1522
lines) as of this read. Each change is independently revertable. Apply in the
order below; 1 and 1b are one idea and should land together.

**Three things I got wrong in the first draft, corrected here:**

1. The active-grain highlight pass uses the **`PARTICLE_BASE_SIZE` / `PARTICLE_MAX_SIZE`
   constants (4 / 20)**, not `S.vizMinSize` / `S.vizMaxSize`. So change 2 does
   *not* resize the highlight — the two size systems are already divorced. That
   turns out to be lucky (see change 1), but it's also a latent bug: turn the
   viz sliders up and the highlight stops covering its own grain.
2. `S._cursorScreenX/Y` is written in `drawCursor()` at line 1136, which runs
   **after** `drawParticles()` (line 47 vs 50). So reach lines read a
   one-frame-stale cursor. Handled below.
3. The trail append point (line 1646) is in `animate()`, which runs **after** the
   draw pass, so the newest trail point is also one frame behind. Same fix.

---

## 0. Prerequisite for 1b and 3: resolve the cursor point once, early

Both new features need the cursor's screen position *before* particles draw. Add
this near the top of the render function, right after the background fillRect
(line ~33) and before the `if (S.perfMode)` branch:

```js
  // Cursor lon/lat + screen point, resolved once per frame before anything
  // that needs it. drawCursor() used to be the only writer of
  // S._cursorScreenX/Y, which made it one frame stale for earlier passes.
  {
    const { lon, lat } = S.cursorQ ? getCursorLonLat()
      : S.mouseInCanvas ? screenToLonLat(S.mousePixelX, S.mousePixelY) : getCursorLonLat();
    S._frameCursorLon = lon;
    S._frameCursorLat = lat;
    if (S.gazeTrailSec > 0) {
      const now = performance.now() / 1000;
      S.gazeTrail.push({ lon, lat, t: now });
      while (S.gazeTrail.length && now - S.gazeTrail[0].t > S.gazeTrailSec) S.gazeTrail.shift();
    } else if (S.gazeTrail.length) {
      S.gazeTrail.length = 0;
    }
  }
```

`drawCursor()` keeps writing `S._cursorScreenX/Y` exactly as it does — don't
touch it. It also already computes lon/lat itself; leave that alone too rather
than refactoring it to read `S._frameCursorLon`. One extra `getCursorLonLat()`
per frame is trivial, and threading the value through is a bigger change than
this is worth.

In `animate()` at line 1646, **leave the existing lon/lat destructure alone** —
it feeds the coordinate readout and is fine as is. Do not append to the trail
there; the append now lives in the draw pass above.

---

## 1. Selected grains: dot + ring instead of a blob

`js/renderer.js`, lines 678–697. Replace the body of the `if (_glowCache.size > 0)`
block.

**Find:**

```js
    const scanOff = S.scanMuted;
    for (const [particle, { sx, sy, depth, facing }] of _glowCache) {
      const df   = Math.max(0, 1 - (depth / (SPHERE_RADIUS * 2)));
      const size = (PARTICLE_BASE_SIZE + (PARTICLE_MAX_SIZE - PARTICLE_BASE_SIZE) * df) * 1.6;
      const entry = activeGrainMap.get(particle);
      const isCursorGrain = entry && entry.glowColor === '#ffffff';
      if (scanOff && isCursorGrain) {
        // Scan off cursor grains: faint white — still visible but clearly quieter
        S.ctx.globalAlpha = (0.15 + 0.1 * facing) * df;
      } else {
        // Seed grains + scan-active cursor grains: near-opaque white
        S.ctx.globalAlpha = (0.75 + 0.25 * facing) * df;
      }
      S.ctx.fillStyle = S.darkMode ? '#ffffff' : '#000000';
      S.ctx.beginPath(); S.ctx.arc(sx, sy, size, 0, Math.PI * 2); S.ctx.fill();
    }
    S.ctx.globalAlpha = 1;
```

**Replace with:**

```js
    const scanOff = S.scanMuted;
    const ink = S.darkMode ? '#ffffff' : '#000000';
    // A firing grain should read as MARKED, not as a bigger particle. Small
    // opaque core + a ring standing off it stays legible over dense paint and
    // at any vizMaxSize, because neither radius is tied to the grain's own size.
    for (const [particle, { sx, sy, depth, facing }] of _glowCache) {
      const df    = Math.max(0, 1 - (depth / (SPHERE_RADIUS * 2)));
      const base  = PARTICLE_BASE_SIZE + (PARTICLE_MAX_SIZE - PARTICLE_BASE_SIZE) * df;
      const core  = Math.max(1.6, base * 0.42);
      const ring  = Math.max(6,   base * 1.5);
      const entry = activeGrainMap.get(particle);
      const isCursorGrain = entry && entry.glowColor === '#ffffff';
      const a = (scanOff && isCursorGrain)
        ? (0.15 + 0.1 * facing) * df      // scan off: quieter, but still there
        : (0.75 + 0.25 * facing) * df;
      S.ctx.globalAlpha = a;
      S.ctx.fillStyle   = ink;
      S.ctx.beginPath(); S.ctx.arc(sx, sy, core, 0, Math.PI * 2); S.ctx.fill();
      S.ctx.globalAlpha = a * 0.8;
      S.ctx.strokeStyle = ink;
      S.ctx.lineWidth   = 1.1;
      S.ctx.beginPath(); S.ctx.arc(sx, sy, ring, 0, Math.PI * 2); S.ctx.stroke();
    }
    S.ctx.globalAlpha = 1;
```

Cost: one extra stroke per active grain. `_glowCache` holds active grains only,
so this is nothing.

**Collision to watch:** the loop playhead ring at line 719 uses `base * 2.2`.
Ours is `base * 1.5`, so on a particle that is both firing and under a playhead
you get white ring inside slot-coloured ring — that reads fine. If it looks
busy, push the playhead to `* 2.8`.

---

## 1b. Reach lines — cursor centre to each firing grain

Same block, immediately **before** the `for (const [particle, ...]` loop from
change 1. Requires change 0.

```js
    // Reach lines: the search radius stops being an abstract circle and becomes
    // visible reach. Also makes k / nearestMode / grainKAllMode self-evident —
    // k-all looks like a burst of spokes.
    if (_glowCache.size <= 32) {
      spherePointInto(S._frameCursorLon, S._frameCursorLat, _arcW);
      cameraTransformInto(_arcW[0], _arcW[1], _arcW[2], _arcC);
      const cProj = project(_arcC[0], _arcC[1], _arcC[2]);
      if (cProj) {
        S.ctx.strokeStyle = S.darkMode ? '#ffffff' : '#000000';
        S.ctx.lineWidth = 0.9;
        for (const [particle, { sx, sy, depth }] of _glowCache) {
          const entry = activeGrainMap.get(particle);
          // Cursor grains only — a line from the reticle to a seed-triggered
          // grain would be a lie about where the sound came from.
          if (!entry || entry.glowColor !== '#ffffff') continue;
          const df = Math.max(0, 1 - (depth / (SPHERE_RADIUS * 2)));
          S.ctx.globalAlpha = 0.3 * df;
          S.ctx.beginPath();
          S.ctx.moveTo(cProj.sx, cProj.sy);
          S.ctx.lineTo(sx, sy);
          S.ctx.stroke();
        }
        S.ctx.globalAlpha = 1;
      }
    }
```

The `<= 32` guard is the `grainKAllMode` cap — spokes stop being readable well
before that count, so skipping entirely beats drawing mush.

> **This number was wrong, and it shipped a feature that almost never drew.**
> Corrected 2026-08-24. The default patch carries **k = 99**, so the cap was
> below the normal working count and the block was skipped nearly every frame.
> Worse, it failed *asymmetrically* and looked like a camera-mode bug: in
> surface mode the cursor is pinned to canvas centre, all ~99 grains stay on
> screen, the count never fell under 32, and the lines were invisible 100% of
> the time; in steer mode the cursor can sit near the edge where grains fall
> off-screen, the count dipped under 32 occasionally, and they flickered in.
> Ek reported it as "I see them in steer, not at all in surface".
>
> Now `REACH_MAX = 128`, a **performance** ceiling rather than a readability one
> (k tops out at 99, so it never bites), and density is handled by alpha, which
> degrades smoothly where a hard cap fell off a cliff. The fan is also drawn as
> **one batched path with a single stroke** instead of a beginPath/stroke triplet
> per line — at k = 99 the old shape put 99 of them in the render loop every
> frame, which is precisely the pattern that made cloud trails the #1 source of
> scheduler drift. Batching costs the per-line depth fade, which bought nothing:
> every line ends within searchRadius of one point, so the depths were near
> identical.
>
> **A second bug surfaced once the lines actually drew: they appeared on
> committed clouds.** Not a tagging error — `COMMIT_COLORS` contains no white and
> the worklet is only ever sent the cursor's candidate pool. It is a LIFETIME
> mismatch. A cursor grain's white tag lives for the whole grain duration (589 ms
> by default) while a frame is 33 ms, so the tag outlives its own truth by ~18
> frames; sweep the cursor once across a committed cloud and those particles stay
> white for half a second, drawing long lines back to a cloud the cursor has
> already left. The white tag also outlasts a seq's own 50 ms tag by 11.8×, so on
> any particle the cursor has touched it wins `activeGrainMap` even while the
> cloud is playing it.
>
> The dot+ring is RIGHT to persist — the grain really is still sounding. The line
> is not, because it asserts "the cursor reaches this **now**". So the line got
> its own gate: still inside the search radius, tested by comparing cosines
> rather than taking an acos, and skipped in `nearestMode` where reach is not
> radius-bounded. Verified: cursor on the cloud 40/40 lines, cursor away 0/40,
> a cloud straddling the radius edge 18/40 exactly as predicted.
>
> Brightness went up with it. The old `0.3 * df` with `df ≈ 0.5` straight ahead
> was an effective **0.15** — "barely visible", as reported. Now
> `0.5 * (1 − 0.5 · min(1, n/64))`: about 0.49 for a handful of grains, 0.25 at
> a full 99-grain fan.

Uses `_arcW` / `_arcC`, the existing scratch buffers, so this allocates nothing.

If seed clouds should show their own reach later, draw the same lines from each
seed's projected centre inside `drawSeeds()` in the seed's own colour — do not
extend this loop.

---

## 2. Particle size defaults

`js/state.js`, lines 1208–1209.

```js
  vizMinSize:    6,         →    vizMinSize:    3,
  vizMaxSize:    120,       →    vizMaxSize:    22,
```

The formula (`rmsSize * (0.5 + 0.5 * depthScale)`, line 657) is already right.
Only the ceiling is wrong: at 120px a loud grain covers a quarter of the sphere,
so paint reads as fog and `featuresToHSL`'s hue is lost to overlap. At 22 the
field stays granular, the RMS→size ratio is still ~7× (plenty of dynamic read),
and colour survives because grains stop occluding each other.

Both are viz-panel sliders already, so this is a **default change only** —
anyone who wants fog can still have it.

---

## 3. Gaze trail — the jet stream

**`js/state.js`**, add next to the viz block (~line 1209):

```js
  gazeTrail:     [],        // [{lon, lat, t}] — appended once per frame in the draw pass
  gazeTrailSec:  6,         // trail length in seconds; 0 disables entirely
```

**`js/renderer.js`** — the append already happened in change 0. Add the draw
function (anywhere near `drawTetherLine`):

```js
// ── Gaze trail ──────────────────────────────────────────────────────────────
// A tapering ribbon behind the cursor: the strongest available cue for how the
// instrument moves. The age² alpha falloff plus the width taper are what make
// it read as a jet stream — linear alpha looks like a scratch on the glass.
export function drawGazeTrail() {
  const n = S.gazeTrail.length;
  if (n < 2 || S.gazeTrailSec <= 0) return;
  const now = performance.now() / 1000;
  const ink = S.darkMode ? '255,255,255' : '0,0,0';
  const seamLimit = S.canvas.width * 0.25;
  S.ctx.save();
  S.ctx.lineCap = 'round';
  let prev = null;
  for (let i = 0; i < n; i++) {
    const pt = S.gazeTrail[i];
    spherePointInto(pt.lon, pt.lat, _arcW);
    cameraTransformInto(_arcW[0], _arcW[1], _arcW[2], _arcC);
    const p = project(_arcC[0], _arcC[1], _arcC[2]);
    if (!p) { prev = null; continue; }
    if (prev) {
      // Guard the wrap: a lon seam crossing projects as a full-width streak
      if (Math.hypot(p.sx - prev.sx, p.sy - prev.sy) < seamLimit) {
        const age = 1 - (now - pt.t) / S.gazeTrailSec;   // 1 = newest
        S.ctx.strokeStyle = `rgba(${ink},${(0.6 * age * age).toFixed(3)})`;
        S.ctx.lineWidth   = 1 + 1.6 * age;
        S.ctx.beginPath();
        S.ctx.moveTo(prev.sx, prev.sy);
        S.ctx.lineTo(p.sx, p.sy);
        S.ctx.stroke();
      }
    }
    prev = p;
  }
  S.ctx.restore();
}
```

Note this projects each point **once** (carrying `prev` forward) rather than
twice per segment as my first draft did — half the matrix work.

**Call it** in the non-perf list, between particles and cursor so the reticle
sits on top of it (line 47–50):

```js
  drawGridLines();
  drawParticles();
  S.updateLiveGranulatingIndicator?.();
  drawTetherLine();
  drawGazeTrail();          // ← add: under the cursor, over the particles
  drawCursor();
  drawSeeds();
```

**perfMode:** do not call it. The trail is a player orientation aid, not
something the projector needs, and perfMode exists to protect the frame budget.
Change 0 still appends while in perfMode — either accept the tiny cost, or wrap
the append in `if (!S.perfMode && S.gazeTrailSec > 0)`.

At 30fps × 6s the buffer caps near 180 entries. `shift()` on an array that small
is fine; if it ever shows in a profile, make it a fixed-length ring.

---

## Settings that should follow

Not required to land the above, and they touch the panel work we deferred:

- ~~**`gazeTrailSec`** wants a home next to the viz size sliders~~ — **DONE
  2026-08-24.** `#vizGazeTrailSeg` in `index.html` (off / 2s / 6s), wired in
  `js/ui-viz.js`. It rides the viz calibration payload in
  `js/ui-audio-settings.js` rather than taking a localStorage key of its own,
  so the 2s dirty check persists it and it survives export/import. Deliberately
  NOT added to `SPLIT_MOVED` — that list describes the pre-v4 blob, which this
  field postdates and can never appear in.
- ~~**The highlight/particle size divorce**~~ — **DECIDED 2026-08-24: keep them
  divorced.** The marker layer stays on the fixed `PARTICLE_BASE_SIZE` /
  `PARTICLE_MAX_SIZE` constants, because sizing it off `vizMaxSize` would grow
  the marker with the paint it exists to stand out against. Reasoning is now in
  the code at `js/renderer.js` (the `_glowCache` highlight loop), which is where
  the next person will be standing when they wonder.
- ~~**Camera pull-back** from prototype 3a~~ — **BUILT 2026-08-24**, as `S.camPull`
  (camera distance in sphere radii; 0 = the original inside-sphere view, 1 = on
  the surface, above that outside) with a slider in the viz panel directly under
  the FOV row. Not wired to ACTIONS — Ek's call, it is a between-pieces setting.

  It was not "a distance value and a slider". What it actually took:

  1. **The offset goes in CAMERA space**, after rotation (`out[2] += _camOffZ` in
     `cameraTransformInto`). That is what makes one scalar mean "back away along
     the view axis" identically in all three camera modes.
  2. **`screenToLonLat` became a ray–sphere intersection.** From the centre a ray
     direction *is* a surface point; off-centre it is a solve. It **keeps its
     old contract and never returns null** — a ray that misses clamps to the
     silhouette — because 13 call sites across audio, erase, grain, paint-ticker,
     seed-morph, sensor-mapping, presets and the renderer all assume a value.
     Verified: at camPull 0 it reproduces the old formula to 3.3e-16 rad over 121
     screen samples, and screen → lon/lat → screen round-trips to 0 px at 0, 0.5,
     1.5 and 2.5 radii.

     **It takes the FAR root, and that is the whole design.** The first cut took
     the near one — "paint the surface facing you", the reflex from generic 3D
     picking — and Ek caught it on the rig within minutes: moving the mouse right
     walked the cursor the wrong way. Mubone is a bowl you work from within, so
     pulling back is stepping away from it, not walking around a ball. The near
     root was also an outright bug, not just a bad feel: in sensor and surface
     mode the cursor is pinned to canvas centre and resolved through here, while
     `getCursorLonLat()` — which the audio path uses — defines it as the camera's
     forward ray. Near-root puts those two **antipodal** as soon as camPull > 0,
     so the reticle on screen and the point that actually sounds sit on opposite
     sides of the sphere. Far-root makes `screenToLonLat(centre)` equal
     `getCursorLonLat()` to 0.000000° at every distance, and the direction of
     travel keeps its sign across the shell. Both are asserted.
  3. **`cameraTransformInto` had to be split.** Head-locked spatial panning takes
     `atan2(x, z)` of it for azimuth, and the listener stays at the sphere's
     centre wherever the camera is dollied to. Audio now calls the new
     **`cameraRotateInto`** (rotation only); rendering calls
     `cameraTransformInto` (rotation + dolly). Verified: head-locked azimuth for
     fixed sphere points drifts **0.000000000°** across camPull 0 → 2.5. Adding a
     caller? Rendering wants the transform, audio wants the rotate.
  4. **Back-face culling had to be invented** — from inside there is no back face,
     so nothing existed. It keeps the **inner** face at every distance
     (`n·c > 0`), matching the far root above: pulling back has to keep showing
     the surface you are painting, or you get a coherent-looking ball whose
     cursor is on the side you cannot see. At camPull 0 it is a no-op — every
     point has `n·c = R² > 0` and `projectInto`'s `z > 0.1` alone gives the
     forward hemisphere, exactly as the centred model always did.
     Visible counts across the shell: 1999 / 2998 / 4000 / 3334 / 2802 / 2671 at
     0 / 0.5 / 1 / 1.5 / 2.5 / 3 radii — peaking on the surface, where the whole
     inner sphere is in view.
     *(An earlier cut flipped the test at the surface to keep the OUTER face when
     outside. That is what a near-root design needs, and getting its sign
     backwards made camPull = 1.0 cull every particle and the sphere vanish.
     Both went away with the far root.)*
  5. **The depth ramp needed a second branch.** Centred, every point is exactly
     SPHERE_RADIUS away, so `depth` is really "angle off the view axis"; pulled,
     it is a real distance over a span narrow relative to 2R. One formula for
     both would flatten every particle to the same size. Both branches now go
     through `depthFactor()` so the paint, highlight and reach-line loops agree,
     and `drawParticlesMinimal` (perfMode) got the same treatment.
  6. **Two unit-vector projections had to be scaled to SPHERE_RADIUS.** Projection
     through the origin is scale-invariant, so the detethered cursor projected a
     length-1 forward vector and got away with it — until a world-scale offset
     was added to it.

  **Crossing camPull 1.0 is smooth**, because the inner face is kept throughout.
  Visible density peaks on the surface and eases off outside it; there is no
  cliff. (There was one — 4000 → 331 — while the cull switched faces at the
  shell.)

  **FOV and pull-back are not redundant, and must not be merged.** They look
  alike on a laptop — FOV mostly travels down from 80° (zoom in) and camPull only
  travels up from 0 (zoom out) — so the pair reads as one axis split in two. It
  isn't:

  - **FOV is rig calibration.** A number you LOOK UP so the sphere lands on real
    surfaces (Nebula 1.2:1 ≈ 26°, Capsule 3 ≈ 45°). Machine-local under
    `mubone_fovDeg` and deliberately in `SPLIT_DROPPED` — it describes this
    room's projector, not the piece. A combined slider has nowhere to type 45.0°.
  - **camPull is the view control.** Rides the exported viz calibration, because
    it is about how you want to see the work.
  - **Different axes.** FOV changes DISTORTION, pull-back changes VANTAGE.
    Narrow-FOV + pulled-back — the least distorted external view of the sphere —
    is a corner no single combined slider can reach.
  - **Zoom-IN from the centre can only be FOV**, because camPull starts at 0 and
    there is nowhere closer than the middle. That is precisely why FOV keeps
    getting used as a zoom, and why it silently decalibrates the projector.

  So they stay separate, and the panel now says which is which: the section is
  labelled **projector calibration / throw angle**, pull-back is labelled **the
  view control**, and a warning appears under pull-back whenever it is non-zero
  — *room-lock is off while pulled back*. That last one matters because **any**
  non-zero pull breaks room-lock: the projector popup renders through the same
  `cameraTransformInto`, so pulling back moves the virtual camera off the
  projector's optical centre exactly as a mis-set throw angle does, and it is
  just as invisible from the laptop.

  **Naming:** `cameraMode: 'pull'` was renamed **`'steer'`** in the same pass, and
  it was the reason to do this properly — "pull" was a rotation mode while
  "pull-back" is a distance, in the same panel. One-shot migration in
  `_loadVizCalibration` reads old `'pull'` as `'steer'`, so saved layouts and
  pre-rename export files still load.
