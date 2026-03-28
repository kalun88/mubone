# #31 — Detethered Cursor Implementation Plan

> **Status: IMPLEMENTED (Mar 28, 2026).** Notes below include the original plan plus post-implementation amendments marked with ⚠.

> Two-IMU mode: frame-role IMU provides the viewport/world anchor, cursor-role IMU drives a free-roaming cursor independent of the camera. Activates automatically when both roles are assigned. Single IMU = locked to center as today.

---

## Concept recap

**1 IMU (cursor-role only):** IMU is both camera and cursor. Cursor locked to viewport center. Today's sensor mode.

**2 IMUs (cursor + frame):** Cursor detethers. The frame IMU anchors the sphere to something physical — the software doesn't care what. Two spatial anchoring modes, same math:

- **Room-anchored** (frame on projector tripod, or stationary on floor): sphere fixed in physical space. Projector reveals portions of the painted world. Performer paints freely anywhere on the sphere.
- **Body-anchored** (frame on chest/waist): sphere travels with the performer. Everything painted "in front" stays in front regardless of where the performer moves in the room.

---

## State changes (`state.js`)

```
S.cursorQ              // [x,y,z,w] | null — cursor orientation when detethered
S.detethered           // bool (derived, read-only) — true when cursorQ is non-null
S.edgeIndicator        // 'on' | 'off' — show off-screen cursor arrow (default 'on')
S.edgeIndicatorSize    // number 0.5–2.0 — scale of the edge arrow (default 1.0)
```

`S.detethered` is a getter, not stored — it just checks `S.cursorQ !== null`. This is the single flag everything reads to know whether we're in detethered mode.

---

## File-by-file changes

### 1. `sensor-registry.js` — split cursor output

**`getSensorCamQ()`** currently writes the cursor-role quaternion, which the renderer puts into `S.camQ`. Change:

- When frame-role IS assigned (detethered): `getSensorCamQ()` returns `null` (nothing to write to camQ). Add a new **`getSensorCursorQ()`** that returns the cursor-role quaternion (same math that `getSensorCamQ` does today for the cursor slot — tare, axis map, custom layers).
- When frame-role is NOT assigned (single IMU): `getSensorCamQ()` works exactly as today. `getSensorCursorQ()` returns `null`.

This keeps the existing single-IMU path completely untouched.

**`getFrameQ()`** — ⚠ **AMENDED**: requires a critical conjugation fix. `cameraTransform()` applies `frameQ` directly but conjugates `camQ`. Without compensation, frame exhibits gimbal lock (pitch→roll coupling at 90° yaw). Fix: `getFrameQ()` conjugates its output (`return [-q[0], -q[1], -q[2], q[3]]`). This was discovered during live testing — the original plan missed this asymmetry. See `mubone-architecture-notes.md` § "Detethered Cursor" for full explanation.

New export:
```js
export function getSensorCursorQ() {
  // Only active when frame-role is also assigned (detethered mode)
  if (!getByRole('frame')?.quat) return null;
  // Same cursor-role resolution as getSensorCamQ today
  const cursorSlot = getByRole('cursor');
  if (!cursorSlot?.quat) return null;
  return applyAxisMapQuat(
    applyTare(cursorSlot.quat, cursorSlot.quatCal.tareQuat),
    cursorSlot.quatCal
  );
  // Custom path layers on top (same as existing getSensorCamQ custom block)
}
```

Wire into main.js: `S._getSensorCursorQ = getSensorCursorQ`

### 2. `renderer.js` — camera update (lines 896–939)

**Sensor mode block**, after existing `S.camQ` assignment:

```js
// ── Detethered cursor — separate cursor quaternion ──
const cq = S._getSensorCursorQ?.();
if (cq) {
  // Apply same drift correction as camQ path
  S.cursorQ = S.driftOffsetQ ? _qNorm(_qMul(S.driftOffsetQ, cq)) : cq;
  // In detethered mode, camQ stays at identity — the frame provides the view
  S.camQ = [0, 0, 0, 1];
} else {
  S.cursorQ = null;
  // Single IMU: camQ already set by existing code above
}
```

**Key detail:** When detethered, `getSensorCamQ()` returns null (see §1), so the existing `if (sq) { S.camQ = sq; }` block is skipped. `camQ` is set to identity by the new code. `frameQ` handles the view.

### 3. `sphere.js` — `getCursorLonLat()`

Currently uses `S.camQ` forward vector. Change:

```js
export function getCursorLonLat() {
  // Detethered: cursor orientation is independent of camera
  const q = S.cursorQ || S.camQ;
  const forward = qRotateVec(q, [0, 0, 1]);
  const w = S.frameQ ? qRotateVec(qConjugate(S.frameQ), forward) : forward;
  return {
    lon: Math.atan2(w[0], w[2]),
    lat: Math.asin(Math.max(-1, Math.min(1, w[1])))
  };
}
```

One line change: `const q = S.cursorQ || S.camQ;`

**`screenToLonLat()`** — no changes. This is only used for mouse pixel → sphere mapping (pull/surface modes, alt-lock mouse). Doesn't apply to sensor cursor.

**`cameraTransform()`** — no changes. Always uses `S.camQ` for the viewport, which is correct.

### 4. `renderer.js` — cursor drawing (`drawCursor()`)

**When detethered**, the crosshair position comes from projecting `S.cursorQ`'s forward vector through the camera, instead of using mouse pixel coords or canvas center.

```js
// At top of drawCursor(), after cx/cy:
let mx, my;
let cursorOffScreen = false;

if (S.cursorQ) {
  // Detethered: project cursorQ forward vector to screen
  const fwd = _qRotVec(S.cursorQ, [0, 0, 1]);
  const cam = cameraTransform(fwd[0], fwd[1], fwd[2]);
  const p   = project(cam[0], cam[1], cam[2]);
  if (p && p.sx >= 0 && p.sx <= S.canvas.width && p.sy >= 0 && p.sy <= S.canvas.height) {
    mx = p.sx;
    my = p.sy;
  } else {
    cursorOffScreen = true;
    // Clamp to nearest viewport edge for the edge indicator
    mx = p ? Math.max(0, Math.min(S.canvas.width,  p.sx)) : cx;
    my = p ? Math.max(0, Math.min(S.canvas.height, p.sy)) : cy;
  }
} else {
  // Existing: mouse position or canvas center
  mx = (S.mouseInCanvas || S.altLocked) ? S.mousePixelX : cx;
  my = (S.mouseInCanvas || S.altLocked) ? S.mousePixelY : cy;
}
```

**Edge indicator** (new, drawn when `cursorOffScreen && S.edgeIndicator === 'on'`):

Small arrow/chevron at the clamped edge position pointing toward the off-screen cursor. Scales with `S.edgeIndicatorSize`. Replaces the full crosshair — don't draw the reticle/radius when cursor is off-screen, just the indicator.

**When cursor is on-screen in detethered mode:** draw the full crosshair at `(mx, my)` exactly as today. The only difference is the position is computed from the quaternion projection instead of mouse coords.

**Existing early-return guard** (`if (!S.mouseInCanvas && !S.altLocked)`) needs adjustment: in detethered mode, always draw (the cursor is always "active" via IMU, regardless of mouse position).

### 5. `main.js` — camera modal subtitle

In `updateCameraModeBtn()`, when mode is 'sensor', set a subtitle element:

```js
const sub = cameraModal?.querySelector('.camera-sensor-subtitle');
if (sub) {
  if (S.cameraMode === 'sensor') {
    const hasFrame = typeof S._getFrameQ === 'function' && S._getFrameQ();
    sub.textContent = hasFrame ? '2 sensors — cursor free' : '1 sensor — cursor locked';
    sub.style.display = '';
  } else {
    sub.style.display = 'none';
  }
}
```

Add `<span class="camera-sensor-subtitle"></span>` inside the sensor option in `index.html`.

### 6. `index.html` / viz settings — edge indicator controls

In the viz settings panel (near HUD scale slider):

```html
<label>Edge indicator</label>
<select id="vizEdgeIndicator">
  <option value="on">On</option>
  <option value="off">Off</option>
</select>
<label>Edge indicator size</label>
<input type="range" id="vizEdgeIndicatorSize" min="0.5" max="2" step="0.1" value="1">
```

Wire in the viz settings JS (ui-viz or wherever HUD scale is wired).

### 7. Sensor panel — role tooltips

Add subtitle text to existing cursor/frame role dropdown options:

- **Cursor**: "Controls where you paint and play"
- **Frame**: "Sets the world orientation (mount on projector, body, or room)"

Implementation: add `title` attributes or small `<span class="role-desc">` under each option in the sensor panel role selector.

---

## Call site audit

Every call site that resolves cursor position. All should work correctly because they call `getCursorLonLat()` (which now reads `S.cursorQ` when detethered) or `screenToLonLat()` (mouse path, only active when `S.mouseInCanvas`).

| File | Line(s) | Function | Path | Change needed? |
|------|---------|----------|------|---------------|
| `grain.js` | 934–936 | grain scheduler | `mouseInCanvas ? screenToLonLat : getCursorLonLat` | **No** — getCursorLonLat handles it |
| `renderer.js` | 45 | `drawParticles` dot coloring | `mouseInCanvas ? screenToLonLat : getCursorLonLat` | **No** |
| `renderer.js` | 954 | `drawSeeds` | `screenToLonLat` (mouse path only) | **Check** — verify this only fires when mouse active |
| `renderer.js` | 1028 | `drawSeedTrails` | `mouseInCanvas ? screenToLonLat : getCursorLonLat` | **No** |
| `seed-morph.js` | 132–134 | morph nearest lookup | `altLocked ? screenToLonLat : getCursorLonLat` | **No** |
| `osc.js` | 523–524 | OSC cursor broadcast | `mouseInCanvas ? screenToLonLat : getCursorLonLat` | **No** |
| `events.js` | 66 | `getMouseLonLat` helper | `screenToLonLat` (mouse only) | **No** |
| `ui-trace.js` | 21 | `captureFrame` | `screenToLonLat(px, py)` | **Check** — what px/py? May need detethered path |
| `ui-presets.js` | 410+ | multiple commit/drop functions | `mouseInCanvas ? getMouseLonLat : getCursorLonLat` | **No** — getCursorLonLat handles it |
| `midi.js` | 26 | import only | — | **No** |

**Two sites to verify closely:**

1. **`renderer.js:954`** — draws seeds with `screenToLonLat`. Need to confirm this is guarded by a `mouseInCanvas` check or similar. If it can fire in sensor mode, it needs the `getCursorLonLat` fallback.

2. **`ui-trace.js:21`** — `captureFrame` uses `screenToLonLat(px, py)`. Need to check where `px/py` come from. If they're always mouse coords, fine. If this can fire from sensor input, it needs the detethered path.

---

## What doesn't change

- `frameQ` math and `getFrameQ()` — identical
- `cameraTransform()` — still uses `S.camQ` for viewport
- `screenToLonLat()` — still uses `S.camQ` for mouse ray casting
- Grain scheduling — reads from `getCursorLonLat()`, inherits fix
- VBAP, spatialization — unrelated
- Presets — `cursorQ` is transient (live sensor data), not saved
- Pull and surface camera modes — completely unaffected

---

## Implementation order

1. `state.js` — add `cursorQ`, `detethered` getter, `edgeIndicator`, `edgeIndicatorSize`
2. `sensor-registry.js` — add `getSensorCursorQ()`, modify `getSensorCamQ()` to return null when frame-role active
3. `main.js` — wire `S._getSensorCursorQ`
4. `renderer.js` — camera update: write `S.cursorQ`, set `camQ` to identity when detethered
5. `sphere.js` — one-line change in `getCursorLonLat()`
6. `renderer.js` — cursor drawing: project `cursorQ` to screen, edge indicator
7. `renderer.js` — adjust `drawCursor` early-return guard for detethered mode
8. Audit the two flagged call sites (`renderer.js:954`, `ui-trace.js:21`)
9. `main.js` / `index.html` — camera modal dynamic subtitle
10. `index.html` + viz JS — edge indicator toggle and size controls
11. Sensor panel — role description tooltips

---

## Post-implementation notes (Mar 28)

### Frame gimbal lock fix (not in original plan)

The original plan assumed `getFrameQ()` needed no changes. In live testing, the frame sensor showed pitch→roll coupling at 90° yaw — the Euler path artifacts in `applyAxisMapQuat` were invisible for the cursor (just a slight viewport tilt) but very visible for the frame (the whole sphere rolled).

Root cause: `cameraTransform()` in sphere.js conjugates `camQ` but applies `frameQ` directly. The cursor pipeline's output gets conjugated on use, which cancels the Euler artifacts. The frame pipeline's output doesn't get conjugated, so the artifacts are exposed.

Fix: `getFrameQ()` pre-conjugates its output (`return [-q[0], -q[1], -q[2], q[3]]`). This ensures both sensors behave identically despite the asymmetric application in `cameraTransform()`.

First attempted fix was auto-muting roll for the frame sensor — this was explicitly rejected in favor of using the exact same pipeline for both sensors. The conjugation approach is cleaner: no special cases, no UI changes, just a mathematical correction for the application asymmetry.

### Natural roll-muting in detethered mode (discovered, not designed)

In detethered mode, physically rolling the cursor IMU has zero effect on cursor position. This wasn't designed — it's a mathematical consequence of using `cursorQ` only for forward-vector projection (`qRotateVec(cursorQ, [0,0,1])`) to get lon/lat. Roll rotates the forward vector around its own axis, which doesn't change where it points. This is stable, reliable, and effectively gives free roll-muting for the cursor in two-IMU mode without any explicit muting code.

Meanwhile, roll on the frame IMU still works as expected (rolls the viewport), which is correct since the frame quaternion is used as a full orientation.

### Tare behavior

Main tare (Z/backtick) tares both cursor and frame simultaneously when both are assigned. Per-slot tare in the sensor panel is still available for independent taring. Frame tare captures the current frame orientation as "center" — after taring, the current physical pointing direction of the frame IMU becomes the viewport center.

### Mounting-aware tare (added post-implementation)

`slotTare()` now auto-selects between two strategies based on the axis map:

- **Flat mount** (default, X = roll/forward): gravity-aligned tare. Captures heading only. Preserves horizon as pitch=0. `tareRollOffset` compensates for wrist tilt in the Euler decomposition.
- **Non-flat mount** (Y or Z = roll/forward): full-quaternion tare. Captures the entire raw orientation and divides it all out. Tared quaternion is near-identity at rest, so the Euler decomposition works cleanly for any mounting angle. Gravity reference is sacrificed — "level" is wherever the IMU was at tare time.

The axis map is the signal: `_isFlatMount(cal)` checks whether X is mapped to roll. Set the axis map *before* taring. In detethered mode, roll is naturally muted on the cursor anyway, so the gravity tare's roll handling is irrelevant — full-quat tare works fine.

### Call site audit results

~10 sites audited. Most already use the `mouseInCanvas ? screenToLonLat : getCursorLonLat` pattern, which inherits the fix via the one-line change in `getCursorLonLat()`. Two sites needed explicit changes:
- `renderer.js` paint-drop code (~line 1061): was using `screenToLonLat()` directly without checking `S.cursorQ`.
- `ui-trace.js` `captureFrame()`: always used mouse pixel coords. Now checks `S.cursorQ` and uses `getCursorLonLat()` when detethered.
