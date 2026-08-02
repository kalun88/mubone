// ============================================================================
// gesture-panel.js — Gesture visualization as an in-page modal panel.
// Reads from the gesture role slot in the sensor registry.
// ============================================================================

import { S, PRESETS } from './state.js';
import { getByRole } from './sensor-registry.js';
import {
  addRadialPin, removeRadialPin, setRadialPinPreset, getPresetList,
} from './gesture.js';

let _canvas = null;
let _ctx    = null;
let _rafId  = null;
let _visible = false;

// Stubs — no longer needed for cross-window comms
function sendConditionUpdate() {}
function sendJoyUpdate() {}

// ── Colors ───────────────────────────────────────────────────────────────────

const COL_BG       = '#0a0f0f';
const COL_GRID     = 'rgba(122, 188, 188, 0.08)';
const COL_AXIS     = 'rgba(122, 188, 188, 0.25)';
const COL_DIM      = '#4a7a7a';
const COL_TEXT     = '#7abcbc';

const FEATURES = [
  { key: 'intensity',         rawKey: 'rawIntensity',         label: 'intensity', color: '#7abcbc' },
  { key: 'smoothness',        rawKey: 'rawSmoothness',        label: 'smooth',    color: '#a0ff6b' },
  { key: 'periodicity',       rawKey: 'rawPeriodicity',       label: 'period',    color: '#ce93d8' },
  { key: 'accumulatedEnergy', rawKey: 'rawAccumulatedEnergy', label: 'energy',    color: '#ff6b6b' },
];

const GYRO_COLORS = ['#7abcbc', '#e8a030', '#ce93d8'];
const GYRO_LABELS = ['gx', 'gy', 'gz'];

// Phase plot axis pair presets — cycle with X key
// Indices into FEATURES: 0=intensity, 1=smooth, 2=period, 3=energy
const AXIS_PAIRS = [
  { x: 0, y: 1, label: 'intensity × smooth' },
  { x: 0, y: 2, label: 'intensity × period' },
  { x: 0, y: 3, label: 'intensity × energy' },
  { x: 1, y: 2, label: 'smooth × period' },
  { x: 2, y: 3, label: 'period × energy' },
];
let axisPairIdx = 0;

// ── Radial morph controller (2D joystick from roll + pitch gyro) ─────────────
// X = roll (wrist twist), Y = pitch (wave/nod).  Simple 2D — no projection.
// Gyro pushes the dot like a joystick; friction holds, spring returns to center.
// Toggle between radial view and phase plot with V key.

let showRadial = true;

// Which hardware gyro axes drive the joystick X and Y.
// Clickable on the radial view to cycle through x/y/z.
const JOY_AXIS_OPTIONS = ['x', 'y', 'z'];
let joyAxisX = 0;  // index into JOY_AXIS_OPTIONS — default x
let joyAxisY = 1;  // index into JOY_AXIS_OPTIONS — default y
let joySignX = 1;  // polarity for joystick X axis: +1 or −1
let joySignY = 1;  // polarity for joystick Y axis: +1 or −1
const joyAxisXRect = { x: 0, y: 0, w: 0, h: 0 };
const joyAxisYRect = { x: 0, y: 0, w: 0, h: 0 };
const joySignXRect = { x: 0, y: 0, w: 0, h: 0 };
const joySignYRect = { x: 0, y: 0, w: 0, h: 0 };
const joyLimitRect = { x: 0, y: 0, w: 0, h: 0 };
const joyGateRect  = { x: 0, y: 0, w: 0, h: 0 };

// Raw gyro lookup by hardware axis name.
// The joystick axis selector picks directly from gx/gy/gz — no semantic
// remapping layer.  Polarity is handled by joySignX / joySignY.
function rawGyroByAxis(inertial, axis) {
  if (axis === 'x') return inertial.gx;
  if (axis === 'y') return inertial.gy;
  return inertial.gz;
}

// Joystick physics slider rects + drag state
const joySliderRects = {
  weight:   { x: 0, y: 0, w: 0, h: 0 },
  snap:     { x: 0, y: 0, w: 0, h: 0 },
  gain:     { x: 0, y: 0, w: 0, h: 0 },
  return:   { x: 0, y: 0, w: 0, h: 0 },
  gate:  { x: 0, y: 0, w: 0, h: 0 },
  limit: { x: 0, y: 0, w: 0, h: 0 },
};
let draggingJoySlider = null;  // null or key name

let joyX = 0, joyY = 0;       // unclamped position — always tracks real physics
let joyVX = 0, joyVY = 0;     // velocity
let joyLimit = true;           // when true, output is limited to outer ring
let joyGateOn = true;          // when true, signal below inner ring is zeroed

// ── 3 performer controls — all physics derived from these ────────────────
// weight: 0 = light (stops fast, no coast)  1 = heavy (long coast, momentum)
// snap:   0 = stays where pushed             1 = rubber-bands back to center
// gain:   0 = barely moves                   1 = very sensitive to gyro
let joyWeight  = 0.5;
let joySnap    = 0.3;
let joyGain    = 0.5;
let joyReturn  = 0.85; // return suppression: 0 = bidirectional (raw), 1 = outward-only

// Derived physics parameters — recomputed each frame from the 3 controls.
// Exposed here so the draw loop can show them as readouts.
let _phys = { pushRate: 0, friction: 0, damping: 0, spring: 0, slew: 0 };

function updatePhysicsParams() {
  const w = joyWeight, s = joySnap, g = joyGain;
  // gain → push rate: 0.0002 at gain=0, 0.002 at gain=1 (log-ish curve)
  _phys.pushRate = 0.0002 + g * g * 0.0018;
  // weight → friction: light=0.70 (stops fast), heavy=0.97 (long coast)
  _phys.friction = 0.70 + w * 0.27;
  // weight → velocity damping: light=0.50 (heavy drag), heavy=0.05 (almost free)
  _phys.damping = 0.50 - w * 0.45;
  // weight → input slew: light=1.0 (instant), heavy=0.15 (heavily smoothed)
  _phys.slew = 1.0 - w * w * 0.85;
  // snap → spring return: 0 at snap=0, 0.06 at snap=1
  _phys.spring = s * s * 0.06;
}
updatePhysicsParams();  // initialize

// Draggable circle range — controls how much gyro to reach the boundary.
// Bigger = more headroom, smaller = hits wall faster.
// d2px() maps data coords → pixel offset with soft compression beyond the ring.
let joyMaxRadius = 2.5;
let joyGate = 0.08;         // center dead zone — small drift ignored
const JOY_GATE_MIN = 0.0;
const JOY_GATE_MAX = 0.5;
const JOY_RADIUS_MIN = 0.5;
const JOY_RADIUS_MAX = 5.0;
// Circle drag state
let draggingCircle = false;
let draggingGate = false;
let dragCircleStartDist = 0;
let dragCircleStartMaxR = 0;
let dragGateStartDist = 0;
let dragGateStartVal = 0;
const radialGeom = { cx: 0, cy: 0, r: 0, dzR: 0 };  // updated each draw frame

// ── Energy map UI state ─────────────────────────────────────────────────────
const energyMapToggleRect = { x: 0, y: 0, w: 0, h: 0 };
const energyGainSliderRect = { x: 0, y: 0, w: 0, h: 0 };
let draggingEnergyGain = false;

// ── Radial morph pin UI state ───────────────────────────────────────────────
const morphToggleRect  = { x: 0, y: 0, w: 0, h: 0 };
const dropPinRect      = { x: 0, y: 0, w: 0, h: 0 };
const pinDeleteRects   = [];  // [{x,y,w,h,idx}] — one per pin
const pinDropdownRects = [];  // [{x,y,w,h,idx}] — click to cycle preset
let pinDropdownOpen    = -1;  // index of pin with open dropdown, or -1
let pinDropdownItems   = [];  // [{x,y,w,h,presetIdx}] — items in open dropdown
let pinDropdownScroll  = 0;   // scroll offset (number of items scrolled)
const PIN_DD_MAX_VISIBLE = 10; // max items visible at once
const pinDdUpRect      = { x: 0, y: 0, w: 0, h: 0 };  // scroll up arrow
const pinDdDownRect    = { x: 0, y: 0, w: 0, h: 0 };  // scroll down arrow

// Trail for the radial view
const JOY_TRAIL_LEN = 90;
const JOY_TRAIL_PERSIST_MAX = 4000;  // max points in persist mode
const joyTrail = [];  // [{x, y}]
let joyTrailPersist = false;         // when on, trail accumulates (heatmap)
const joyTrailPersistRect = { x: 0, y: 0, w: 0, h: 0 };

// ── Per-axis-pair density grid + persistent trail storage ────────────────────
// Keyed by "axisX_axisY" (order matters — X and Y swapped is a different view).
// Each entry: { grid: Float32Array(DENSITY_RES²), trail: [{x,y}], peak: number }
const DENSITY_RES = 24;              // grid resolution (24×24 cells)
const DENSITY_RANGE = 6.0;           // data-space extent: grid covers ±DENSITY_RANGE
const DENSITY_DECAY = 0.9997;        // per-frame multiplicative decay (~5s half-life at 60fps)
const densityStore = {};             // populated lazily per axis pair

function pairKey(axX, axY) {
  return `${axX}_${axY}`;
}

function ensureDensity(key) {
  if (!densityStore[key]) {
    densityStore[key] = {
      grid: new Float32Array(DENSITY_RES * DENSITY_RES),
      trail: [],
      peak: 0,
    };
  }
  return densityStore[key];
}

// ── History buffers ──────────────────────────────────────────────────────────

const TRAIL_LEN = 300;

// Feature trails (smoothed output)
const trails = {};
for (const f of FEATURES) trails[f.key] = new Float32Array(TRAIL_LEN);

// Raw trails (pre-smoothing, shown as faint ghost)
const rawTrails = {};
for (const f of FEATURES) rawTrails[f.key] = new Float32Array(TRAIL_LEN);

let trailIdx = 0;

// Phase plot trail
const phaseTrailX = new Float32Array(TRAIL_LEN);
const phaseTrailY = new Float32Array(TRAIL_LEN);

// Gyro XYZ scope history
const gyroHistory = [
  new Float32Array(TRAIL_LEN),
  new Float32Array(TRAIL_LEN),
  new Float32Array(TRAIL_LEN),
];
const GYRO_RANGE = 300;

// ── Display values (light display-side slew just to avoid aliasing) ──────────

const disp = {};
const dispRaw = {};
for (const f of FEATURES) {
  disp[f.key] = 0;
  dispRaw[f.key] = 0;
}
const DISP_SLEW = 0.35;  // light — the real smoothing is in gesture.js now

function slew(key, target) {
  disp[key] += (target - disp[key]) * DISP_SLEW;
  return disp[key];
}

function slewRaw(key, target) {
  dispRaw[key] += (target - dispRaw[key]) * DISP_SLEW;
  return dispRaw[key];
}

function normalizeFeature(key, raw) {
  // All features are now 0–1 after conditioning in gesture.js
  return Math.max(0, Math.min(1, raw));
}

// ── Smoothing slider interaction ─────────────────────────────────────────────
// Each feature gets a small horizontal slider bar drawn next to its label.
// Click/drag sets S.gestureCondition[key].smooth = 0..1.

const SLIDER_W = 50;
const SLIDER_H = 10;
let draggingSlider = null;  // index into FEATURES or null

// Hit-test regions updated each frame
const sliderRects = [];  // [{x, y, w, h, featureIdx}]
const thresholdRects = [];  // [{x, y, w, h, featureIdx, which: 'inMin'|'inMax'}]

// ── Peak hold per feature — decays slowly so user can see max reached ────────
const peakHold = {};
const peakDecay = 0.997;  // per frame — slow decay, ~2s to halve
for (const f of FEATURES) peakHold[f.key] = 0;

// ── Slow-moving raw value for display (separate from trail slew) ─────────────
const rawSlow = {};
const RAW_SLOW_RATE = 0.06;  // very slow — user can read the number
for (const f of FEATURES) rawSlow[f.key] = 0;

function onMouseDown(e) {
  const rect = _canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left);
  const my = (e.clientY - rect.top);

  // Check smoothing sliders
  for (const sr of sliderRects) {
    if (mx >= sr.x && mx <= sr.x + sr.w && my >= sr.y - 4 && my <= sr.y + sr.h + 4) {
      draggingSlider = sr.featureIdx;
      setSliderValue(sr, mx);
      return;
    }
  }

  // Check threshold lines on sparklines (gate / peak limit)
  for (const tr of thresholdRects) {
    if (mx >= tr.x && mx <= tr.x + tr.w && Math.abs(my - tr.y) < 8) {
      draggingThreshold = { featureIdx: tr.featureIdx, which: tr.which };
      return;
    }
  }

  // Radial: axis label clicks (cycle x/y/z) and polarity toggles (±)
  if (showRadial) {
    const xr = joyAxisXRect;
    if (mx >= xr.x && mx <= xr.x + xr.w && my >= xr.y && my <= xr.y + xr.h) {
      joyAxisX = (joyAxisX + 1) % JOY_AXIS_OPTIONS.length;
      if (joyAxisX === joyAxisY) joyAxisX = (joyAxisX + 1) % JOY_AXIS_OPTIONS.length;
      _saveGestureSettings(); return;
    }
    const yr = joyAxisYRect;
    if (mx >= yr.x && mx <= yr.x + yr.w && my >= yr.y && my <= yr.y + yr.h) {
      joyAxisY = (joyAxisY + 1) % JOY_AXIS_OPTIONS.length;
      if (joyAxisY === joyAxisX) joyAxisY = (joyAxisY + 1) % JOY_AXIS_OPTIONS.length;
      _saveGestureSettings(); return;
    }
    // Polarity toggles
    const sxr = joySignXRect;
    if (mx >= sxr.x && mx <= sxr.x + sxr.w && my >= sxr.y && my <= sxr.y + sxr.h) {
      joySignX *= -1;
      _saveGestureSettings(); return;
    }
    const syr = joySignYRect;
    if (mx >= syr.x && mx <= syr.x + syr.w && my >= syr.y && my <= syr.y + syr.h) {
      joySignY *= -1;
      _saveGestureSettings(); return;
    }
    // Limit toggle
    const cr = joyLimitRect;
    if (mx >= cr.x && mx <= cr.x + cr.w && my >= cr.y && my <= cr.y + cr.h) {
      joyLimit = !joyLimit;
      _saveGestureSettings(); return;
    }
    // Gate toggle
    const gr = joyGateRect;
    if (mx >= gr.x && mx <= gr.x + gr.w && my >= gr.y && my <= gr.y + gr.h) {
      joyGateOn = !joyGateOn;
      _saveGestureSettings(); return;
    }
    // Trail persist toggle
    const tr = joyTrailPersistRect;
    if (mx >= tr.x && mx <= tr.x + tr.w && my >= tr.y && my <= tr.y + tr.h) {
      joyTrailPersist = !joyTrailPersist;
      if (!joyTrailPersist) {
        // Switching off: trim trail back to normal length
        while (joyTrail.length > JOY_TRAIL_LEN) joyTrail.shift();
      }
      _saveGestureSettings(); return;
    }

    // ── Radial morph pin UI clicks ────────────────────────────────────────
    // Handle open dropdown first — scroll arrows, item select, or close
    if (pinDropdownOpen >= 0) {
      // Scroll up arrow
      const uu = pinDdUpRect;
      if (uu.h > 0 && mx >= uu.x && mx <= uu.x + uu.w && my >= uu.y && my <= uu.y + uu.h) {
        pinDropdownScroll = Math.max(0, pinDropdownScroll - PIN_DD_MAX_VISIBLE);
        return;
      }
      // Scroll down arrow
      const dd = pinDdDownRect;
      if (dd.h > 0 && mx >= dd.x && mx <= dd.x + dd.w && my >= dd.y && my <= dd.y + dd.h) {
        pinDropdownScroll += PIN_DD_MAX_VISIBLE;
        return;
      }
      // Check if click is on a dropdown item
      for (const item of pinDropdownItems) {
        if (mx >= item.x && mx <= item.x + item.w && my >= item.y && my <= item.y + item.h) {
          setRadialPinPreset(pinDropdownOpen, item.presetIdx);
          pinDropdownOpen = -1;
          pinDropdownItems = [];
          pinDropdownScroll = 0;
          return;
        }
      }
      // Click outside dropdown — close it
      pinDropdownOpen = -1;
      pinDropdownItems = [];
      pinDropdownScroll = 0;
      return;
    }
    // Energy map on/off toggle
    const em = energyMapToggleRect;
    if (mx >= em.x && mx <= em.x + em.w && my >= em.y && my <= em.y + em.h) {
      S.energyMapOn = !S.energyMapOn;
      _saveGestureSettings();
      return;
    }
    // Energy gain slider
    const eg = energyGainSliderRect;
    if (mx >= eg.x && mx <= eg.x + eg.w && my >= eg.y && my <= eg.y + eg.h) {
      draggingEnergyGain = true;
      S.energyGain = Math.max(0.1, Math.min(3.0, ((mx - eg.x) / eg.w) * 3.0));
      return;
    }
    // Morph on/off toggle
    const mt = morphToggleRect;
    if (mx >= mt.x && mx <= mt.x + mt.w && my >= mt.y && my <= mt.y + mt.h) {
      S.radialMorphOn = !S.radialMorphOn;
      S._syncMorphBtnUI?.();  // sync main UI button
      return;
    }
    // Drop pin button
    const dp = dropPinRect;
    if (mx >= dp.x && mx <= dp.x + dp.w && my >= dp.y && my <= dp.y + dp.h) {
      addRadialPin(0);  // default to first preset, user picks from dropdown
      return;
    }
    // Pin delete buttons
    for (const pr of pinDeleteRects) {
      if (mx >= pr.x && mx <= pr.x + pr.w && my >= pr.y && my <= pr.y + pr.h) {
        removeRadialPin(pr.idx);
        return;
      }
    }
    // Pin preset dropdown click — open the dropdown, scroll to selected
    for (const pr of pinDropdownRects) {
      if (mx >= pr.x && mx <= pr.x + pr.w && my >= pr.y && my <= pr.y + pr.h) {
        pinDropdownOpen = pr.idx;
        // Scroll so the currently selected preset is visible
        const currentIdx = S.radialPins?.[pr.idx]?.presetIdx ?? 0;
        const presets = getPresetList();
        const selPos = presets.findIndex(p => p.idx === currentIdx);
        pinDropdownScroll = Math.max(0, selPos - Math.floor(PIN_DD_MAX_VISIBLE / 2));
        return;
      }
    }
  }

  // Radial: circle edge drag (resize range) or inertia slider
  if (showRadial) {
    // Circle edge drag — grab within ±15px of boundary to resize
    const cdx = mx - radialGeom.cx;
    const cdy = my - radialGeom.cy;
    const dist = Math.sqrt(cdx * cdx + cdy * cdy);
    if (Math.abs(dist - radialGeom.r) < 15 && radialGeom.r > 0) {
      draggingCircle = true;
      dragCircleStartDist = dist;
      dragCircleStartMaxR = joyMaxRadius;
      return;
    }
    // Dead zone ring drag — grab within ±10px of dead zone boundary
    if (radialGeom.dzR > 3 && Math.abs(dist - radialGeom.dzR) < 10) {
      draggingGate = true;
      dragGateStartDist = dist;
      dragGateStartVal = joyGate;
      return;
    }

    // Physics + zone sliders
    for (const key of ['weight', 'snap', 'gain', 'return', 'gate', 'limit']) {
      const sr = joySliderRects[key];
      if (mx >= sr.x && mx <= sr.x + sr.w && my >= sr.y - 4 && my <= sr.y + sr.h + 4) {
        draggingJoySlider = key;
        setJoySliderValue(key, Math.max(0, Math.min(1, (mx - sr.x) / sr.w)));
        return;
      }
    }
  }
}

// ── Draggable threshold state ────────────────────────────────────────────────
let draggingThreshold = null;  // { featureIdx, which: 'inMin'|'inMax' }

function onMouseMove(e) {
  const rect = _canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left);
  const my = (e.clientY - rect.top);

  // Circle edge drag — resize range (ring visually tracks joyMaxRadius)
  if (draggingCircle) {
    const cdx = mx - radialGeom.cx;
    const cdy = my - radialGeom.cy;
    const dist = Math.sqrt(cdx * cdx + cdy * cdy);
    const ratio = dist / dragCircleStartDist;
    joyMaxRadius = Math.max(JOY_RADIUS_MIN, Math.min(JOY_RADIUS_MAX, dragCircleStartMaxR * ratio));
    return;
  }
  // Dead zone ring drag
  if (draggingGate) {
    const cdx = mx - radialGeom.cx;
    const cdy = my - radialGeom.cy;
    const dist = Math.sqrt(cdx * cdx + cdy * cdy);
    const ratio = dist / dragGateStartDist;
    joyGate = Math.max(JOY_GATE_MIN, Math.min(JOY_GATE_MAX, dragGateStartVal * ratio));
    return;
  }

  // Energy gain slider drag
  if (draggingEnergyGain) {
    const eg = energyGainSliderRect;
    S.energyGain = Math.max(0.1, Math.min(3.0, ((mx - eg.x) / eg.w) * 3.0));
    return;
  }

  // Joystick physics slider drag
  if (draggingJoySlider) {
    const sr = joySliderRects[draggingJoySlider];
    const val = Math.max(0, Math.min(1, (mx - sr.x) / sr.w));
    setJoySliderValue(draggingJoySlider, val);
    return;
  }

  // Dragging a slider
  if (draggingSlider !== null) {
    const sr = sliderRects[draggingSlider];
    if (sr) setSliderValue(sr, mx);
    return;
  }

  // Dragging a threshold line
  if (draggingThreshold !== null) {
    const L = layout;
    const fi = draggingThreshold.featureIdx;
    const sy = L.sparkY0 + fi * (L.sparkH + L.sparkGap);
    // Convert mouse Y to 0–1 value (bottom=0, top=1)
    const val = Math.max(0, Math.min(1, 1 - (my - sy) / L.sparkH));
    const key = FEATURES[fi].key;
    const cond = S.gestureCondition?.[key];
    if (cond) {
      if (draggingThreshold.which === 'inMin') {
        cond.inMin = Math.min(val, (cond.inMax ?? 1) - 0.02);
      } else if (draggingThreshold.which === 'inMax') {
        cond.inMax = Math.max(val, (cond.inMin ?? 0) + 0.02);
      }
    }
    return;
  }

  // Update cursor: pointer over interactive elements
  let overInteractive = false;
  for (const sr of sliderRects) {
    if (mx >= sr.x && mx <= sr.x + sr.w && my >= sr.y - 4 && my <= sr.y + sr.h + 4) {
      overInteractive = true; break;
    }
  }
  if (!overInteractive) {
    for (const tr of thresholdRects) {
      if (mx >= tr.x && mx <= tr.x + tr.w && Math.abs(my - tr.y) < 8) {
        overInteractive = true; break;
      }
    }
  }
  // Check radial axis labels, polarity toggles, and gate/limit toggles
  if (!overInteractive && showRadial) {
    for (const r of [joyAxisXRect, joyAxisYRect, joySignXRect, joySignYRect, joyLimitRect, joyGateRect, joyTrailPersistRect]) {
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) { overInteractive = true; break; }
    }
  }
  // Check physics + zone sliders
  if (!overInteractive && showRadial) {
    for (const key of ['weight', 'snap', 'gain', 'return', 'gate', 'limit']) {
      const sr = joySliderRects[key];
      if (mx >= sr.x && mx <= sr.x + sr.w && my >= sr.y - 4 && my <= sr.y + sr.h + 4) { overInteractive = true; break; }
    }
  }
  // Check energy map UI elements
  if (!overInteractive) {
    for (const r of [energyMapToggleRect, energyGainSliderRect]) {
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) { overInteractive = true; break; }
    }
  }
  // Check radial morph pin UI elements
  if (!overInteractive && showRadial) {
    for (const r of [morphToggleRect, dropPinRect]) {
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) { overInteractive = true; break; }
    }
    if (!overInteractive) {
      for (const r of [...pinDeleteRects, ...pinDropdownRects]) {
        if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) { overInteractive = true; break; }
      }
    }
    if (!overInteractive && pinDropdownOpen >= 0) {
      for (const r of [...pinDropdownItems, pinDdUpRect, pinDdDownRect]) {
        if (r.h > 0 && mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) { overInteractive = true; break; }
      }
    }
  }
  // Check if near circle edge or dead zone ring for resize cursor
  let ringHover = false;
  if (!overInteractive && showRadial && radialGeom.r > 0) {
    const cdx = mx - radialGeom.cx;
    const cdy = my - radialGeom.cy;
    const dist = Math.sqrt(cdx * cdx + cdy * cdy);
    if (Math.abs(dist - radialGeom.r) < 15) { ringHover = true; }
    else if (radialGeom.dzR > 3 && Math.abs(dist - radialGeom.dzR) < 10) { ringHover = true; }
  }
  _canvas.style.cursor = ringHover ? 'grab'
    : (draggingCircle || draggingGate) ? 'grabbing'
    : overInteractive ? 'pointer' : 'default';
}

function onMouseUp() {
  // Save if any joystick param was being dragged (slider, ring, gate, energy gain)
  if (draggingJoySlider || draggingCircle || draggingGate || draggingEnergyGain) _saveGestureSettings();
  draggingSlider = null; draggingJoySlider = null; draggingCircle = false; draggingGate = false; draggingThreshold = null; draggingEnergyGain = false;
}

function setJoySliderValue(key, val) {
  if (key === 'weight') joyWeight = val;
  else if (key === 'snap') joySnap = val;
  else if (key === 'gain') joyGain = val;
  else if (key === 'return') joyReturn = val;
  else if (key === 'gate') joyGate = JOY_GATE_MIN + val * (JOY_GATE_MAX - JOY_GATE_MIN);
  else if (key === 'limit') joyMaxRadius = JOY_RADIUS_MIN + val * (JOY_RADIUS_MAX - JOY_RADIUS_MIN);
  _saveGestureSettings();
}

// ── Persistence ─────────────────────────────────────────────────────────────
const _GESTURE_STORAGE_KEY = 'mubone_gesture_panel';

function _saveGestureSettings() {
  try {
    localStorage.setItem(_GESTURE_STORAGE_KEY, JSON.stringify({
      joyWeight, joySnap, joyGain, joyReturn,
      joyMaxRadius, joyGate,
      joyLimit, joyGateOn,
      joyAxisX, joyAxisY, joySignX, joySignY,
      joyTrailPersist,
      axisPairIdx, showRadial,
      energyMapOn: S.energyMapOn, energyGain: S.energyGain,
    }));
  } catch (_) { /* storage full */ }
}

function _loadGestureSettings() {
  try {
    const raw = localStorage.getItem(_GESTURE_STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (typeof s.joyWeight === 'number')  joyWeight  = s.joyWeight;
    if (typeof s.joySnap === 'number')    joySnap    = s.joySnap;
    if (typeof s.joyGain === 'number')    joyGain    = s.joyGain;
    if (typeof s.joyReturn === 'number')  joyReturn  = s.joyReturn;
    if (typeof s.joyMaxRadius === 'number') joyMaxRadius = s.joyMaxRadius;
    if (typeof s.joyGate === 'number')    joyGate    = s.joyGate;
    if (typeof s.joyLimit === 'boolean')  joyLimit   = s.joyLimit;
    if (typeof s.joyGateOn === 'boolean') joyGateOn  = s.joyGateOn;
    if (typeof s.joyAxisX === 'number')   joyAxisX   = s.joyAxisX;
    if (typeof s.joyAxisY === 'number')   joyAxisY   = s.joyAxisY;
    if (typeof s.joySignX === 'number')   joySignX   = s.joySignX;
    if (typeof s.joySignY === 'number')   joySignY   = s.joySignY;
    if (typeof s.joyTrailPersist === 'boolean') joyTrailPersist = s.joyTrailPersist;
    if (typeof s.axisPairIdx === 'number') axisPairIdx = s.axisPairIdx;
    if (typeof s.showRadial === 'boolean') showRadial = s.showRadial;
    if (typeof s.energyMapOn === 'boolean') S.energyMapOn = s.energyMapOn;
    if (typeof s.energyGain === 'number')   S.energyGain  = s.energyGain;
    updatePhysicsParams();
  } catch (_) { /* corrupt data — use defaults */ }
}

function setSliderValue(sr, mx) {
  if (!S || !S.gestureCondition) return;
  const key = FEATURES[sr.featureIdx].key;
  const cond = S.gestureCondition[key];
  if (!cond) return;
  const t = Math.max(0, Math.min(1, (mx - sr.x) / sr.w));
  cond.smooth = t;
  sendConditionUpdate(key);
}

// ── Movement quality label ───────────────────────────────────────────────────

function getLabanLabel(d) {
  const labels = [];
  const energy = normalizeFeature('accumulatedEnergy', d.accumulatedEnergy);
  if (d.intensity > 0.6) labels.push('active');
  else if (d.intensity < 0.15) labels.push('still');
  if (d.smoothness > 0.6) labels.push('fluid');
  else if (d.intensity > 0.2 && d.smoothness < 0.25) labels.push('jerky');
  if (d.periodicity > 0.5) labels.push('rhythmic');
  if (energy > 0.6) labels.push('intense');
  else if (energy < 0.15) labels.push('calm');
  return labels.length > 0 ? labels.join(' · ') : 'neutral';
}

// ── Responsive layout ────────────────────────────────────────────────────────

let layout = {};

function computeLayout() {
  if (!_canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = _canvas.getBoundingClientRect();
  const W = Math.round(rect.width);
  if (W < 10) return; // not visible yet

  const M = 12;

  // ═══════════════════════════════════════════════════════════════════════
  // Two-column layout:
  //   LEFT  — radial joystick (dominant, ~half width, full height)
  //   RIGHT — radar, gyro scope, sparklines stacked vertically
  // ═══════════════════════════════════════════════════════════════════════

  const colGap = 16;
  const leftW  = Math.floor((W - M * 2 - colGap) * 0.667);  // radial gets 2/3
  const rightX = M + leftW + colGap;
  const rightW = W - rightX - M;

  // ── Compute required heights for both columns, then set canvas tall enough ──

  // Left column: radial plot + controls below
  const pinCount = S.radialPins?.length ?? 0;
  const controlsH = 130 + 18 + 14 + pinCount * 14 + 30;  // toggles + sliders + energy map + morph toggle + pin list
  const headerH   = 20;
  // Use a reasonable plot size based on width (not constrained by height)
  const plotSize = Math.max(100, Math.min(leftW - 8, 500));
  const leftTotalH = headerH + plotSize + 20 + controlsH;

  // Right column: radar + scope + sparklines + footer
  const radarH   = Math.min(rightW * 0.85, 250);
  const scopeH   = Math.min(60, 50);
  const sparkH       = 72;
  const sparkGap     = 6;
  const sparkTotalH  = FEATURES.length * (sparkH + sparkGap);
  const rightTotalH  = 16 + radarH + 10 + scopeH + 14 + sparkTotalH + 30;

  // Canvas height = max of both columns + margin
  const H = Math.max(leftTotalH, rightTotalH, 400) + M;

  // Set canvas size and CSS height so the dialog can scroll
  _canvas.style.height = H + 'px';
  _canvas.width  = W * dpr;
  _canvas.height = H * dpr;
  _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // ── Left column positions ──────────────────────────────────────────
  const plotX = M + (leftW - plotSize) / 2;
  const plotY = headerH;

  // ── Right column positions ─────────────────────────────────────────
  const radarCx  = rightX + rightW / 2;
  const radarCy  = 16 + radarH / 2;
  const radarR   = radarH * 0.42;

  const scopeTopY = 16 + radarH + 10;
  const scopeX    = rightX;
  const scopeW    = rightW;

  const sparkY0     = scopeTopY + scopeH + 14;
  const sparkLabelW = 48;
  const sparkSliderX = rightX + sparkLabelW + 2;
  const sparkX       = sparkSliderX + SLIDER_W + 8;
  const sparkW       = rightX + rightW - sparkX - 28;
  const footerY      = sparkY0 + sparkTotalH + 6;

  layout = {
    W, H, M,
    plotSize, plotX, plotY,
    halfW: leftW,
    radarCx, radarCy, radarR,
    scopeX, scopeY: scopeTopY, scopeW, scopeH,
    sparkY0, sparkLabelW, sparkSliderX, sparkX, sparkW, sparkH, sparkGap,
    footerY,
  };
}

// computeLayout() called from init and ResizeObserver

// ── Drawing ──────────────────────────────────────────────────────────────────

let _lastPinCount = 0;

// ── Joystick physics extracted so it runs even when the panel is hidden ──
// The radial morph reads S.gestureJoy every frame, so physics can't stop.
function _updateJoystickPhysics() {
  try {
    const _gestureSlot = getByRole('gesture');
    const _sensorInertial = _gestureSlot?.inertial;
    if (!_sensorInertial) return;

    // ── 2D joystick physics: selected hardware axes → X/Y ──
    updatePhysicsParams();
    const P = _phys;
    const _joyInputX = joySignX * rawGyroByAxis(_sensorInertial, JOY_AXIS_OPTIONS[joyAxisX]);
    const _joyInputY = joySignY * rawGyroByAxis(_sensorInertial, JOY_AXIS_OPTIONS[joyAxisY]);

    // Push: gyro × gain-derived push rate
    let pushX = _joyInputX * P.pushRate;
    let pushY = _joyInputY * P.pushRate;

    // Return suppression: when push opposes displacement (returning toward center),
    // attenuate the active drive and let the spring handle the return passively.
    // This prevents the "overshoot" where returning your hand sends the joystick
    // to the opposite side.  joyReturn=0: raw bidirectional, joyReturn=1: outward-only.
    if (joyReturn > 0) {
      // Dot product of push and displacement: negative = pushing toward center
      const dot = pushX * joyX + pushY * joyY;
      if (dot < 0) {
        const suppress = 1 - joyReturn;  // 0 at full suppress, 1 at no suppress
        pushX *= suppress;
        pushY *= suppress;
      }
    }

    // Velocity: push with damping, smoothed by slew
    joyVX += (pushX - joyVX * P.damping) * P.slew;
    joyVY += (pushY - joyVY * P.damping) * P.slew;
    // Friction: velocity retention per frame
    joyVX *= P.friction;
    joyVY *= P.friction;
    // Spring: pull toward center
    joyX -= joyX * P.spring;
    joyY -= joyY * P.spring;

    // Integrate
    joyX += joyVX;
    joyY += joyVY;

    // Trail records unclamped position so you always see real movement
    joyTrail.push({ x: joyX, y: joyY });
    if (joyTrail.length > JOY_TRAIL_LEN) joyTrail.shift();

    // ── Density grid + per-pair persistent trail accumulation ──
    const _dk = pairKey(joyAxisX, joyAxisY);
    const _ds = ensureDensity(_dk);
    const _gCol = Math.floor((joyX + DENSITY_RANGE) / (2 * DENSITY_RANGE) * DENSITY_RES);
    const _gRow = Math.floor((-joyY + DENSITY_RANGE) / (2 * DENSITY_RANGE) * DENSITY_RES);
    if (_gCol >= 0 && _gCol < DENSITY_RES && _gRow >= 0 && _gRow < DENSITY_RES) {
      _ds.grid[_gRow * DENSITY_RES + _gCol] += 1;
    }
    for (let _i = 0; _i < _ds.grid.length; _i++) {
      _ds.grid[_i] *= DENSITY_DECAY;
    }
    let _peak = 0;
    for (let _i = 0; _i < _ds.grid.length; _i++) {
      if (_ds.grid[_i] > _peak) _peak = _ds.grid[_i];
    }
    _ds.peak = _peak;
    if (joyTrailPersist) {
      _ds.trail.push({ x: joyX, y: joyY });
      if (_ds.trail.length > JOY_TRAIL_PERSIST_MAX) _ds.trail.shift();
    }

    // Output: limit to outer ring radius when joyLimit is on.
    const rawMag = Math.sqrt(joyX * joyX + joyY * joyY);
    let outX = joyX, outY = joyY;
    if (joyLimit && rawMag > joyMaxRadius) {
      const s = joyMaxRadius / rawMag;
      outX = joyX * s; outY = joyY * s;
    }

    // Export to S.gestureJoy for other modules (preset morphing etc.)
    // Gate: below threshold → zero.  Above → rescale so usable range starts at gate edge.
    const outMag = Math.sqrt(outX * outX + outY * outY);
    const normDist = outMag / joyMaxRadius;  // 0–1 (can exceed 1 when unclamped)
    const gateThresh = joyGate;
    const condDist = (!joyGateOn || gateThresh < 0.001) ? normDist
      : normDist < gateThresh ? 0 : (normDist - gateThresh) / (1 - gateThresh);
    const angle = Math.atan2(outY, outX);
    if (S && S.gestureJoy) {
      S.gestureJoy.x     = condDist > 0 ? Math.cos(angle) * condDist : 0;
      S.gestureJoy.y     = condDist > 0 ? Math.sin(angle) * condDist : 0;
      S.gestureJoy.dist  = condDist;
      S.gestureJoy.angle = condDist > 0 ? angle : 0;
      sendJoyUpdate();
    }
  } catch (e) {
    // Sensor not available — no physics update this frame
  }
}

function draw() {
  _rafId = requestAnimationFrame(draw);

  // Physics runs every frame even when panel is hidden — morph depends on it
  _updateJoystickPhysics();

  if (!_visible || !_canvas || !S.gesture) return;

  // Recompute layout when pin count changes (canvas height needs to grow/shrink)
  const currentPinCount = S.radialPins?.length ?? 0;
  if (currentPinCount !== _lastPinCount) {
    _lastPinCount = currentPinCount;
    computeLayout();
  }

  try {
  const ctx = _ctx;
  const canvas = _canvas;
  const g = S.gesture;
  const L = layout;
  const ap = AXIS_PAIRS[axisPairIdx];

  // Update smoothed + raw display values and trails
  for (const f of FEATURES) {
    const smoothedVal = normalizeFeature(f.key, g[f.key]);
    const rawVal = normalizeFeature(f.key, g[f.rawKey] ?? g[f.key]);
    slew(f.key, smoothedVal);
    slewRaw(f.key, rawVal);
    trails[f.key][trailIdx % TRAIL_LEN] = disp[f.key];
    rawTrails[f.key][trailIdx % TRAIL_LEN] = dispRaw[f.key];
  }

  phaseTrailX[trailIdx % TRAIL_LEN] = disp[FEATURES[ap.x].key];
  phaseTrailY[trailIdx % TRAIL_LEN] = disp[FEATURES[ap.y].key];

  // Record gyro XYZ for sphere trail display (physics now in _updateJoystickPhysics)
  try {
    const _gestureSlot = getByRole('gesture');
    const _sensorInertial = _gestureSlot?.inertial;
    if (_sensorInertial) {
      gyroHistory[0][trailIdx % TRAIL_LEN] = _sensorInertial.gx;
      gyroHistory[1][trailIdx % TRAIL_LEN] = _sensorInertial.gy;
      gyroHistory[2][trailIdx % TRAIL_LEN] = _sensorInertial.gz;
    } else {
      gyroHistory[0][trailIdx % TRAIL_LEN] = 0;
      gyroHistory[1][trailIdx % TRAIL_LEN] = 0;
      gyroHistory[2][trailIdx % TRAIL_LEN] = 0;
    }
  } catch (e) {
    gyroHistory[0][trailIdx % TRAIL_LEN] = 0;
    gyroHistory[1][trailIdx % TRAIL_LEN] = 0;
    gyroHistory[2][trailIdx % TRAIL_LEN] = 0;
  }

  trailIdx++;

  // Clear
  _ctx.fillStyle = COL_BG;
  _ctx.fillRect(0, 0, L.W, L.H);

  // ════════════════════════════════════════════════════════════════════════
  // 1. LEFT COLUMN: RADIAL JOYSTICK or PHASE PLOT  [V to toggle]
  // ════════════════════════════════════════════════════════════════════════

  if (showRadial) {
    // ── 2D RADIAL JOYSTICK — pure roll (X) + pitch (Y) ─────────────────
    // joyX/joyY are always unlimited.  The outer ring (limit) represents
    // the boundary.  The inner ring (gate) zeros small drift.
    // Fixed pixel scale — dot position independent of limit/gate settings.

    const dCx = L.plotX + L.plotSize / 2;
    const dCy = L.plotY + L.plotSize / 2;
    // Fixed data-to-pixel scale — independent of ring position.
    // Chosen so default joyMaxRadius (2.5) puts ring at ~32% of plot.
    const pixPerUnit = L.plotSize * 0.128;
    const plotMax = L.plotSize * 0.48;  // max usable pixel radius before edge
    // Limit ring = outer boundary, visually tracks joyMaxRadius on the fixed scale
    const dR = Math.min(joyMaxRadius * pixPerUnit, plotMax - 4);
    // Dead zone pixel radius — fraction of ring
    const dzRpx = joyGate * dR;
    // Store geometry for mouse handlers
    radialGeom.cx = dCx; radialGeom.cy = dCy; radialGeom.r = dR; radialGeom.dzR = dzRpx;

    // Convert data-space x/y to pixel offset from center.
    // Fixed linear scale everywhere, soft-compressed near plot edge
    // so the dot asymptotically approaches the boundary but never leaves.
    function d2px(dataX, dataY) {
      const dm = Math.sqrt(dataX * dataX + dataY * dataY);
      if (dm < 0.0001) return { px: 0, py: 0 };
      const pixDist = dm * pixPerUnit;
      let pixR;
      if (pixDist <= plotMax) {
        pixR = pixDist;  // linear — no scaling by ring
      } else {
        // Beyond plot usable area: soft compression toward edge
        const overflow = pixDist - plotMax;
        const softness = plotMax * 0.8;  // gentler at larger plot sizes
        pixR = plotMax + (L.plotSize * 0.5 - plotMax) * (1 - Math.exp(-overflow / softness));
      }
      return {
        px:  (dataX / dm) * pixR,
        py: -(dataY / dm) * pixR,  // canvas Y is inverted
      };
    }

    // ── Limit ring (outer boundary, draggable, dashed when off) ─────────
    _ctx.beginPath(); _ctx.arc(dCx, dCy, dR, 0, Math.PI * 2);
    if (!joyLimit) _ctx.setLineDash([4, 4]);
    _ctx.strokeStyle = draggingCircle ? 'rgba(122, 188, 188, 0.5)'
      : joyLimit ? 'rgba(122, 188, 188, 0.25)' : 'rgba(122, 188, 188, 0.12)';
    _ctx.lineWidth = draggingCircle ? 2 : 1;
    _ctx.stroke();
    _ctx.setLineDash([]);
    // Glow (only when limit is on)
    if (joyLimit) {
      _ctx.beginPath(); _ctx.arc(dCx, dCy, dR, 0, Math.PI * 2);
      _ctx.strokeStyle = 'rgba(122, 188, 188, 0.06)';
      _ctx.lineWidth = 4;
      _ctx.stroke();
    }

    // Inner rings at 33% and 66%
    for (const ringFrac of [0.33, 0.66]) {
      _ctx.beginPath(); _ctx.arc(dCx, dCy, dR * ringFrac, 0, Math.PI * 2);
      _ctx.strokeStyle = 'rgba(122, 188, 188, 0.06)';
      _ctx.lineWidth = 0.5;
      _ctx.stroke();
    }

    // ── Crosshairs — roll (horizontal) and pitch (vertical) ─────────────
    _ctx.beginPath();
    _ctx.moveTo(dCx - dR, dCy); _ctx.lineTo(dCx + dR, dCy);
    _ctx.strokeStyle = hexToRGBA(GYRO_COLORS[0], 0.12);
    _ctx.lineWidth = 0.5;
    _ctx.stroke();
    _ctx.beginPath();
    _ctx.moveTo(dCx, dCy - dR); _ctx.lineTo(dCx, dCy + dR);
    _ctx.strokeStyle = hexToRGBA(GYRO_COLORS[1], 0.12);
    _ctx.lineWidth = 0.5;
    _ctx.stroke();
    // Diagonals for reference
    for (const angle of [Math.PI/4, 3*Math.PI/4]) {
      _ctx.beginPath();
      _ctx.moveTo(dCx + Math.cos(angle) * dR, dCy + Math.sin(angle) * dR);
      _ctx.lineTo(dCx - Math.cos(angle) * dR, dCy - Math.sin(angle) * dR);
      _ctx.strokeStyle = 'rgba(122, 188, 188, 0.04)';
      _ctx.lineWidth = 0.5;
      _ctx.stroke();
    }

    // ── Axis labels (clickable to cycle x/y/z) + polarity toggles ──────
    {
      const xAxis = JOY_AXIS_OPTIONS[joyAxisX];
      const yAxis = JOY_AXIS_OPTIONS[joyAxisY];
      const xPos = joySignX > 0 ? '+' : '−';
      const xNeg = joySignX > 0 ? '−' : '+';
      const yPos = joySignY > 0 ? '+' : '−';
      const yNeg = joySignY > 0 ? '−' : '+';
      _ctx.font = '9px monospace';
      _ctx.textAlign = 'center';

      // X axis: positive end (right of circle) — axis name clickable
      _ctx.fillStyle = GYRO_COLORS[0];
      const xPosLabel = `${xPos}${xAxis}`;
      const xNegLabel = `${xNeg}${xAxis}`;
      _ctx.fillText(xPosLabel, dCx + dR + 2, dCy - 4);
      _ctx.fillText(xNegLabel, dCx - dR - 2, dCy - 4);
      // Click target: axis name at positive (right) end
      const xLabelW = _ctx.measureText(xPosLabel).width + 6;
      joyAxisXRect.x = dCx + dR + 2 - xLabelW / 2;
      joyAxisXRect.y = dCy - 14;
      joyAxisXRect.w = xLabelW;
      joyAxisXRect.h = 14;
      // Click target: polarity at negative (left) end
      const xNegW = _ctx.measureText(xNegLabel).width + 6;
      joySignXRect.x = dCx - dR - 2 - xNegW / 2;
      joySignXRect.y = dCy - 14;
      joySignXRect.w = xNegW;
      joySignXRect.h = 14;

      // Y axis: positive end (top of circle) — axis name clickable
      _ctx.fillStyle = GYRO_COLORS[1];
      const yPosLabel = `${yPos}${yAxis}`;
      const yNegLabel = `${yNeg}${yAxis}`;
      _ctx.fillText(yPosLabel, dCx, dCy - dR - 6);
      _ctx.fillText(yNegLabel, dCx, dCy + dR + 12);
      // Click target: axis name at positive (top) end
      const yLabelW = _ctx.measureText(yPosLabel).width + 6;
      joyAxisYRect.x = dCx - yLabelW / 2;
      joyAxisYRect.y = dCy - dR - 16;
      joyAxisYRect.w = yLabelW;
      joyAxisYRect.h = 14;
      // Click target: polarity at negative (bottom) end
      const yNegW = _ctx.measureText(yNegLabel).width + 6;
      joySignYRect.x = dCx - yNegW / 2;
      joySignYRect.y = dCy + dR + 2;
      joySignYRect.w = yNegW;
      joySignYRect.h = 14;

      _ctx.textAlign = 'left';
    }

    // ── Density grid (heatmap glow behind everything) ──────────────────
    {
      const _dk = pairKey(joyAxisX, joyAxisY);
      const _ds = ensureDensity(_dk);
      if (_ds.peak > 0.5) {
        const cellW = (2 * DENSITY_RANGE) / DENSITY_RES;
        for (let row = 0; row < DENSITY_RES; row++) {
          for (let col = 0; col < DENSITY_RES; col++) {
            const val = _ds.grid[row * DENSITY_RES + col];
            if (val < 0.1) continue;  // skip empty cells
            const norm = val / _ds.peak;
            // Map grid cell center back to data-space, then to pixels
            const dataX = -DENSITY_RANGE + (col + 0.5) * cellW;
            const dataY = DENSITY_RANGE - (row + 0.5) * cellW;  // row 0 = top = +Y
            const pt = d2px(dataX, dataY);
            const cellPx = Math.max(dR * cellW / DENSITY_RANGE, 3);
            // Warm glow: teal at low density, brighter toward white at high
            const alpha = norm * norm * 0.4;  // quadratic for contrast
            _ctx.fillStyle = `rgba(122, 200, 200, ${alpha})`;
            _ctx.fillRect(
              dCx + pt.px - cellPx / 2,
              dCy + pt.py - cellPx / 2,
              cellPx, cellPx
            );
          }
        }
      }
    }

    // ── Trail ───────────────────────────────────────────────────────────
    if (joyTrail.length > 1) {
      if (joyTrailPersist) {
        // Draw the per-pair persistent trail (accumulated across axis switches)
        const _dk = pairKey(joyAxisX, joyAxisY);
        const _ds = ensureDensity(_dk);
        const _pTrail = _ds.trail;
        for (let i = 1; i < _pTrail.length; i++) {
          const t0 = _pTrail[i - 1], t1 = _pTrail[i];
          const p0 = d2px(t0.x, t0.y);
          const p1 = d2px(t1.x, t1.y);
          _ctx.beginPath();
          _ctx.moveTo(dCx + p0.px, dCy + p0.py);
          _ctx.lineTo(dCx + p1.px, dCy + p1.py);
          _ctx.strokeStyle = 'rgba(122, 188, 188, 0.12)';
          _ctx.lineWidth = 2;
          _ctx.stroke();
        }
        // Also draw the live (short) trail on top for immediate feedback
        for (let i = 1; i < joyTrail.length; i++) {
          const t0 = joyTrail[i - 1], t1 = joyTrail[i];
          const age = i / joyTrail.length;
          const p0 = d2px(t0.x, t0.y);
          const p1 = d2px(t1.x, t1.y);
          _ctx.beginPath();
          _ctx.moveTo(dCx + p0.px, dCy + p0.py);
          _ctx.lineTo(dCx + p1.px, dCy + p1.py);
          _ctx.strokeStyle = `rgba(122, 188, 188, ${age * age * 0.5})`;
          _ctx.lineWidth = 0.5 + age * 1.5;
          _ctx.stroke();
        }
      } else {
        // Normal fading trail
        for (let i = 1; i < joyTrail.length; i++) {
          const t0 = joyTrail[i - 1], t1 = joyTrail[i];
          const age = i / joyTrail.length;
          const p0 = d2px(t0.x, t0.y);
          const p1 = d2px(t1.x, t1.y);
          const sx0 = dCx + p0.px;
          const sy0 = dCy + p0.py;
          const sx1 = dCx + p1.px;
          const sy1 = dCy + p1.py;
          _ctx.beginPath();
          _ctx.moveTo(sx0, sy0); _ctx.lineTo(sx1, sy1);
          _ctx.strokeStyle = `rgba(122, 188, 188, ${age * age * 0.5})`;
          _ctx.lineWidth = 0.5 + age * 1.5;
          _ctx.stroke();
        }
      }
    }

    // ── Current position — joystick dot ─────────────────────────────────
    // joyX/joyY are always unlimited.  The dot shows actual position.
    // When limit is on and dot exceeds the outer ring, a ghost marker
    // on the ring edge shows the limited output position.
    {
      const jm = Math.sqrt(joyX * joyX + joyY * joyY);
      const normJm = jm / joyMaxRadius;  // can exceed 1 when beyond ring
      const dotPx = d2px(joyX, joyY);
      const sx = dCx + dotPx.px;
      const sy = dCy + dotPx.py;
      const isBeyond = jm > joyMaxRadius;

      // Line from center to dot
      _ctx.beginPath();
      _ctx.moveTo(dCx, dCy); _ctx.lineTo(sx, sy);
      _ctx.strokeStyle = `rgba(122, 188, 188, ${0.15 + Math.min(normJm, 1) * 0.3})`;
      _ctx.lineWidth = 1 + Math.min(normJm, 1) * 1.5;
      _ctx.stroke();

      // When limited and beyond ring: ghost marker on ring edge shows
      // the limited output position, dashed line from ring to actual dot.
      if (joyLimit && isBeyond) {
        const limitAngle = Math.atan2(joyY, joyX);
        const cx = dCx + Math.cos(limitAngle) * dR;
        const cy = dCy - Math.sin(limitAngle) * dR;
        // Dashed line from ring edge to unclamped dot
        _ctx.beginPath();
        _ctx.setLineDash([2, 3]);
        _ctx.moveTo(cx, cy); _ctx.lineTo(sx, sy);
        _ctx.strokeStyle = 'rgba(122, 188, 188, 0.15)';
        _ctx.lineWidth = 0.5;
        _ctx.stroke();
        _ctx.setLineDash([]);
        // Clamped output marker on ring edge
        _ctx.beginPath(); _ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        _ctx.fillStyle = 'rgba(232, 160, 48, 0.6)';  // orange — "this is the output"
        _ctx.fill();
      }

      // Gate ring (inner boundary, draggable, dashed when off)
      if (dzRpx > 1) {
        _ctx.beginPath(); _ctx.arc(dCx, dCy, dzRpx, 0, Math.PI * 2);
        if (joyGateOn) {
          _ctx.fillStyle = 'rgba(122, 188, 188, 0.04)';
          _ctx.fill();
        }
        if (!joyGateOn) _ctx.setLineDash([2, 3]);
        _ctx.strokeStyle = draggingGate ? 'rgba(122, 188, 188, 0.5)'
          : joyGateOn ? 'rgba(122, 188, 188, 0.22)' : 'rgba(122, 188, 188, 0.10)';
        _ctx.lineWidth = draggingGate ? 1.5 : 0.5;
        _ctx.stroke();
        _ctx.setLineDash([]);
      }

      // Center origin dot
      _ctx.beginPath(); _ctx.arc(dCx, dCy, 2.5, 0, Math.PI * 2);
      _ctx.fillStyle = 'rgba(122, 188, 188, 0.15)';
      _ctx.fill();
      _ctx.beginPath(); _ctx.arc(dCx, dCy, 1, 0, Math.PI * 2);
      _ctx.fillStyle = 'rgba(122, 188, 188, 0.4)';
      _ctx.fill();

      // Current dot: actual position — dimmed when beyond ring + limited
      const dotAlpha = (joyLimit && isBeyond) ? 0.3 : 1.0;
      const glowR = 6 + Math.min(normJm, 1) * 8;
      _ctx.beginPath(); _ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
      _ctx.fillStyle = `rgba(122, 188, 188, ${(0.04 + Math.min(normJm, 1) * 0.04) * dotAlpha})`;
      _ctx.fill();
      _ctx.beginPath(); _ctx.arc(sx, sy, glowR * 0.6, 0, Math.PI * 2);
      _ctx.fillStyle = `rgba(122, 188, 188, ${(0.08 + Math.min(normJm, 1) * 0.06) * dotAlpha})`;
      _ctx.fill();
      _ctx.beginPath(); _ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
      _ctx.fillStyle = (joyLimit && isBeyond) ? 'rgba(122, 188, 188, 0.35)' : COL_TEXT;
      _ctx.fill();

      // Magnitude readout (% of max radius)
      const magPct = (normJm * 100).toFixed(0);
      _ctx.font = '8px monospace';
      _ctx.fillStyle = COL_DIM;
      _ctx.textAlign = 'right';
      _ctx.fillText(`${magPct}%`, L.plotX + L.plotSize - 2, L.plotY + L.plotSize + 12);
      _ctx.textAlign = 'left';
    }

    // ── Draw radial morph pins on the joystick ──────────────────────────
    // Pins are stored in normalized space (0–1 per axis from gestureJoy).
    // Scale by joyMaxRadius to place them in data space for d2px(), so
    // they sit at the same position as the dot was when placed and move
    // dynamically if the ring (limit slider) is resized.
    {
      const pins = S.radialPins || [];
      for (let pi = 0; pi < pins.length; pi++) {
        const pin = pins[pi];
        const pt = d2px(pin.x * joyMaxRadius, pin.y * joyMaxRadius);
        const px = dCx + pt.px;
        const py = dCy + pt.py;
        const pinPreset = PRESETS[pin.presetIdx];
        const pinName = pinPreset?.name ?? '?';
        const isActive = S.radialMorphOn;

        // Pin marker: diamond shape
        const sz = 5;
        _ctx.beginPath();
        _ctx.moveTo(px, py - sz);
        _ctx.lineTo(px + sz, py);
        _ctx.lineTo(px, py + sz);
        _ctx.lineTo(px - sz, py);
        _ctx.closePath();
        _ctx.fillStyle = isActive ? 'rgba(232, 160, 48, 0.7)' : 'rgba(232, 160, 48, 0.3)';
        _ctx.fill();
        _ctx.strokeStyle = isActive ? 'rgba(232, 160, 48, 0.9)' : 'rgba(232, 160, 48, 0.4)';
        _ctx.lineWidth = 1;
        _ctx.stroke();

        // Pin label
        _ctx.font = '8px monospace';
        _ctx.fillStyle = isActive ? 'rgba(232, 160, 48, 0.9)' : 'rgba(232, 160, 48, 0.4)';
        _ctx.textAlign = 'center';
        _ctx.fillText(pinName, px, py - sz - 3);
        _ctx.textAlign = 'left';

        // Pin number
        _ctx.font = '7px monospace';
        _ctx.fillStyle = 'rgba(232, 160, 48, 0.6)';
        _ctx.textAlign = 'center';
        _ctx.fillText(`${pi + 1}`, px, py + sz + 8);
        _ctx.textAlign = 'left';
      }
    }

    // ── Sliders below radial: toggles + physics + gate/limit controls ───
    {
      const slW = L.plotSize * 0.45;  // ~half the plot width
      const slH = 10;                 // match sparkline slider height
      const slGap = 18;               // breathing room
      const slX = L.plotX;
      let slY = L.plotY + L.plotSize + 20;

      // Gate + Limit toggles — side by side
      _ctx.font = '9px monospace';
      _ctx.textAlign = 'left';
      // Gate toggle
      const gateLabel = joyGateOn ? '● gate' : '○ gate';
      _ctx.fillStyle = joyGateOn ? COL_TEXT : 'rgba(122, 188, 188, 0.25)';
      _ctx.fillText(gateLabel, slX, slY);
      const gateW = _ctx.measureText(gateLabel).width + 6;
      joyGateRect.x = slX;
      joyGateRect.y = slY - 10;
      joyGateRect.w = gateW;
      joyGateRect.h = 14;
      // Limit toggle
      const limitLabel = joyLimit ? '● limit' : '○ limit';
      const limitLabelX = slX + gateW + 12;
      _ctx.fillStyle = joyLimit ? COL_TEXT : 'rgba(122, 188, 188, 0.25)';
      _ctx.fillText(limitLabel, limitLabelX, slY);
      const limitW = _ctx.measureText(limitLabel).width + 6;
      joyLimitRect.x = limitLabelX;
      joyLimitRect.y = slY - 10;
      joyLimitRect.w = limitW;
      joyLimitRect.h = 14;
      // Trail persist toggle
      const trailLabel = joyTrailPersist ? '● heatmap' : '○ heatmap';
      const trailLabelX = limitLabelX + limitW + 12;
      _ctx.fillStyle = joyTrailPersist ? COL_TEXT : 'rgba(122, 188, 188, 0.25)';
      _ctx.fillText(trailLabel, trailLabelX, slY);
      const trailW = _ctx.measureText(trailLabel).width + 6;
      joyTrailPersistRect.x = trailLabelX;
      joyTrailPersistRect.y = slY - 10;
      joyTrailPersistRect.w = trailW;
      joyTrailPersistRect.h = 14;
      slY += 14;

      // Normalize gate and limit to 0–1 for slider display
      const gateNorm = (joyGate - JOY_GATE_MIN) / (JOY_GATE_MAX - JOY_GATE_MIN);
      const limitNorm = (joyMaxRadius - JOY_RADIUS_MIN) / (JOY_RADIUS_MAX - JOY_RADIUS_MIN);

      const sliders = [
        { key: 'weight',   val: joyWeight, label: 'weight',   detail: `fric ${_phys.friction.toFixed(2)}  damp ${_phys.damping.toFixed(2)}` },
        { key: 'snap',     val: joySnap,   label: 'snap',     detail: `spring ${_phys.spring.toFixed(4)}` },
        { key: 'gain',     val: joyGain,   label: 'gain',     detail: `push ${(_phys.pushRate * 10000).toFixed(1)}e-4` },
        { key: 'return',   val: joyReturn, label: 'return',   detail: `${Math.round(joyReturn * 100)}% suppress` },
        { key: 'gate',  val: gateNorm,  label: 'gate',  detail: `${(joyGate * 100).toFixed(0)}%` },
        { key: 'limit', val: limitNorm, label: 'limit', detail: `${joyMaxRadius.toFixed(2)}×` },
      ];

      for (const sl of sliders) {
        // Track background
        _ctx.fillStyle = 'rgba(255,255,255,0.06)';
        _ctx.fillRect(slX, slY, slW, slH);
        // Filled portion
        _ctx.fillStyle = 'rgba(122, 188, 188, 0.25)';
        _ctx.fillRect(slX, slY, slW * sl.val, slH);
        // Thumb
        const thX = slX + slW * sl.val;
        _ctx.fillStyle = COL_TEXT;
        _ctx.fillRect(thX - 2, slY - 2, 4, slH + 4);
        // Label (right of slider)
        _ctx.font = '9px monospace';
        _ctx.fillStyle = COL_DIM;
        _ctx.fillText(sl.label, slX + slW + 6, slY + slH - 1);
        // Derived/numeric value
        _ctx.fillStyle = 'rgba(122, 188, 188, 0.25)';
        _ctx.fillText(sl.detail, slX + slW + 66, slY + slH - 1);
        // Hit rect
        joySliderRects[sl.key].x = slX; joySliderRects[sl.key].y = slY;
        joySliderRects[sl.key].w = slW; joySliderRects[sl.key].h = slH;
        slY += slGap;
      }
    }

    // ── Morph toggle + drop pin + pin list ──────────────────────────────
    {
      const slX = L.plotX;
      // Continue Y from where the sliders left off — read the last slider's Y.
      // The sliders render in the block above; we continue from below them.
      // Use the Y position tracked by the slider loop (stored in joySliderRects.limit.y)
      let mY = (joySliderRects.limit.y || 0) + joySliderRects.limit.h + 14;

      _ctx.font = '9px monospace';
      _ctx.textAlign = 'left';

      // Energy map on/off toggle
      const emOn = S.energyMapOn;
      const emLabel = emOn ? '● energy map' : '○ energy map';
      _ctx.fillStyle = emOn ? '#ff6b6b' : 'rgba(255, 107, 107, 0.3)';
      _ctx.fillText(emLabel, slX, mY);
      const emW = _ctx.measureText(emLabel).width + 6;
      energyMapToggleRect.x = slX; energyMapToggleRect.y = mY - 10;
      energyMapToggleRect.w = emW; energyMapToggleRect.h = 14;

      // Energy gain slider (inline, right of toggle)
      {
        const egSlX = slX + emW + 10;
        const egSlW = 60;
        const egSlH = 8;
        const egSlY = mY - 6;
        const gainNorm = Math.max(0, Math.min(1, (S.energyGain ?? 1.0) / 3.0));
        _ctx.fillStyle = 'rgba(255,255,255,0.06)';
        _ctx.fillRect(egSlX, egSlY, egSlW, egSlH);
        _ctx.fillStyle = emOn ? 'rgba(255, 107, 107, 0.35)' : 'rgba(255, 107, 107, 0.12)';
        _ctx.fillRect(egSlX, egSlY, egSlW * gainNorm, egSlH);
        const egThX = egSlX + egSlW * gainNorm;
        _ctx.fillStyle = emOn ? '#ff6b6b' : 'rgba(255, 107, 107, 0.4)';
        _ctx.fillRect(egThX - 2, egSlY - 2, 4, egSlH + 4);
        // Label
        _ctx.fillStyle = COL_DIM;
        _ctx.fillText(`gain ${(S.energyGain ?? 1.0).toFixed(1)}`, egSlX + egSlW + 6, mY);
        energyGainSliderRect.x = egSlX; energyGainSliderRect.y = egSlY;
        energyGainSliderRect.w = egSlW; energyGainSliderRect.h = egSlH;
      }

      mY += 14;

      // Morph on/off toggle
      const morphOn = S.radialMorphOn;
      const morphLabel = morphOn ? '● morph' : '○ morph';
      _ctx.fillStyle = morphOn ? '#e8a030' : 'rgba(232, 160, 48, 0.3)';
      _ctx.fillText(morphLabel, slX, mY);
      const morphW = _ctx.measureText(morphLabel).width + 6;
      morphToggleRect.x = slX; morphToggleRect.y = mY - 10;
      morphToggleRect.w = morphW; morphToggleRect.h = 14;

      // Drop pin button
      const dpLabel = '+ pin';
      const dpX = slX + morphW + 14;
      _ctx.fillStyle = 'rgba(232, 160, 48, 0.6)';
      _ctx.fillText(dpLabel, dpX, mY);
      const dpW = _ctx.measureText(dpLabel).width + 6;
      dropPinRect.x = dpX; dropPinRect.y = mY - 10;
      dropPinRect.w = dpW; dropPinRect.h = 14;

      // Pin count
      const pins = S.radialPins || [];
      if (pins.length > 0) {
        _ctx.fillStyle = COL_DIM;
        _ctx.fillText(`(${pins.length})`, dpX + dpW + 6, mY);
      }

      mY += 16;

      // Pin list — each pin shows: index, position indicator, preset name (clickable), delete [×]
      pinDeleteRects.length = 0;
      pinDropdownRects.length = 0;

      const listW = L.plotSize * 0.75;
      for (let pi = 0; pi < pins.length && pi < 8; pi++) {
        const pin = pins[pi];
        const pinPreset = PRESETS[pin.presetIdx];
        const pName = pinPreset?.name ?? '—';

        // Pin number
        _ctx.font = '8px monospace';
        _ctx.fillStyle = 'rgba(232, 160, 48, 0.5)';
        _ctx.fillText(`${pi + 1}`, slX, mY);

        // Position indicator (angle arrow + distance %)
        const pinDist = Math.sqrt(pin.x * pin.x + pin.y * pin.y);
        const pinAngle = Math.atan2(pin.y, pin.x);
        const arrowChars = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'];
        const arrowIdx = Math.round(((pinAngle + Math.PI) / (Math.PI * 2)) * 8) % 8;
        const arrow = arrowChars[(arrowIdx + 4) % 8];  // adjust so 0=right
        _ctx.fillStyle = COL_DIM;
        _ctx.fillText(`${arrow} ${(pinDist * 100).toFixed(0)}%`, slX + 14, mY);

        // Preset name (clickable dropdown trigger)
        const nameX = slX + 60;
        _ctx.fillStyle = morphOn ? '#e8a030' : 'rgba(232, 160, 48, 0.5)';
        _ctx.font = '9px monospace';
        _ctx.fillText(pName, nameX, mY);
        const nameW = Math.max(_ctx.measureText(pName).width + 8, 50);
        // Underline to show it's clickable
        _ctx.beginPath();
        _ctx.moveTo(nameX, mY + 2);
        _ctx.lineTo(nameX + nameW - 4, mY + 2);
        _ctx.strokeStyle = 'rgba(232, 160, 48, 0.2)';
        _ctx.lineWidth = 0.5;
        _ctx.stroke();

        pinDropdownRects.push({ x: nameX, y: mY - 10, w: nameW, h: 14, idx: pi });

        // Delete button [×]
        const delX = slX + listW - 10;
        _ctx.fillStyle = 'rgba(255, 100, 100, 0.4)';
        _ctx.font = '9px monospace';
        _ctx.fillText('×', delX, mY);
        pinDeleteRects.push({ x: delX - 2, y: mY - 10, w: 14, h: 14, idx: pi });

        mY += 14;
      }

      // ── Open dropdown overlay (scrollable) ─────────────────────────────
      if (pinDropdownOpen >= 0 && pinDropdownOpen < pinDropdownRects.length) {
        const ddr = pinDropdownRects.find(r => r.idx === pinDropdownOpen);
        if (ddr) {
          const presets = getPresetList();
          pinDropdownItems = [];
          pinDdUpRect.h = 0;    // reset — only set if needed
          pinDdDownRect.h = 0;

          const ddX = ddr.x;
          const ddW = 120;
          const itemH = 16;
          const arrowH = 14;

          // Clamp scroll offset
          const maxScroll = Math.max(0, presets.length - PIN_DD_MAX_VISIBLE);
          pinDropdownScroll = Math.max(0, Math.min(pinDropdownScroll, maxScroll));

          const visibleCount = Math.min(presets.length, PIN_DD_MAX_VISIBLE);
          const hasUp = pinDropdownScroll > 0;
          const hasDown = pinDropdownScroll + visibleCount < presets.length;
          const totalH = visibleCount * itemH + (hasUp ? arrowH : 0) + (hasDown ? arrowH : 0);

          // Position dropdown — prefer below, flip up if it would go off canvas
          let ddY = ddr.y + ddr.h + 2;
          if (ddY + totalH + 4 > L.H) {
            ddY = ddr.y - totalH - 4;
          }

          // Background
          _ctx.fillStyle = 'rgba(10, 15, 15, 0.95)';
          _ctx.fillRect(ddX - 2, ddY - 2, ddW + 4, totalH + 4);
          _ctx.strokeStyle = 'rgba(232, 160, 48, 0.3)';
          _ctx.lineWidth = 1;
          _ctx.strokeRect(ddX - 2, ddY - 2, ddW + 4, totalH + 4);

          let curY = ddY;

          // Scroll up arrow
          if (hasUp) {
            _ctx.font = '9px monospace';
            _ctx.fillStyle = 'rgba(232, 160, 48, 0.6)';
            _ctx.fillText('  ▲ more', ddX + 2, curY + 10);
            pinDdUpRect.x = ddX; pinDdUpRect.y = curY;
            pinDdUpRect.w = ddW; pinDdUpRect.h = arrowH;
            curY += arrowH;
          }

          // Visible preset items
          const startIdx = pinDropdownScroll;
          const endIdx = Math.min(presets.length, startIdx + PIN_DD_MAX_VISIBLE);
          for (let i = startIdx; i < endIdx; i++) {
            const p = presets[i];
            const isSelected = S.radialPins[pinDropdownOpen]?.presetIdx === p.idx;
            _ctx.font = '9px monospace';
            _ctx.fillStyle = isSelected ? '#e8a030' : COL_TEXT;
            _ctx.fillText(isSelected ? `● ${p.name}` : `  ${p.name}`, ddX + 2, curY + 11);
            pinDropdownItems.push({ x: ddX, y: curY, w: ddW, h: itemH, presetIdx: p.idx });
            curY += itemH;
          }

          // Scroll down arrow
          if (hasDown) {
            _ctx.font = '9px monospace';
            _ctx.fillStyle = 'rgba(232, 160, 48, 0.6)';
            _ctx.fillText('  ▼ more', ddX + 2, curY + 10);
            pinDdDownRect.x = ddX; pinDdDownRect.y = curY;
            pinDdDownRect.w = ddW; pinDdDownRect.h = arrowH;
          }
        }
      }
    }

    // Panel label
    _ctx.fillStyle = COL_DIM;
    _ctx.font = '8px monospace';
    _ctx.fillText('radial morph  [V]', L.plotX, L.plotY - 5);

  } else {
    // ── PHASE PLOT (original) ────────────────────────────────────────────
    _ctx.strokeStyle = COL_GRID;
    _ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const gx = L.plotX + t * L.plotSize;
      const gy = L.plotY + t * L.plotSize;
      _ctx.beginPath(); _ctx.moveTo(gx, L.plotY); _ctx.lineTo(gx, L.plotY + L.plotSize); _ctx.stroke();
      _ctx.beginPath(); _ctx.moveTo(L.plotX, gy); _ctx.lineTo(L.plotX + L.plotSize, gy); _ctx.stroke();
    }

    _ctx.strokeStyle = COL_AXIS;
    const pcx = L.plotX + L.plotSize / 2;
    const pcy = L.plotY + L.plotSize / 2;
    _ctx.beginPath(); _ctx.moveTo(pcx, L.plotY); _ctx.lineTo(pcx, L.plotY + L.plotSize); _ctx.stroke();
    _ctx.beginPath(); _ctx.moveTo(L.plotX, pcy); _ctx.lineTo(L.plotX + L.plotSize, pcy); _ctx.stroke();

    _ctx.font = '9px monospace';
    _ctx.textAlign = 'center';
    _ctx.fillStyle = FEATURES[ap.x].color;
    _ctx.fillText(FEATURES[ap.x].label, L.plotX + L.plotSize / 2, L.plotY + L.plotSize + 12);
    _ctx.save();
    _ctx.translate(L.plotX - 10, L.plotY + L.plotSize / 2);
    _ctx.rotate(-Math.PI / 2);
    _ctx.fillStyle = FEATURES[ap.y].color;
    _ctx.fillText(FEATURES[ap.y].label, 0, 0);
    _ctx.restore();
    _ctx.textAlign = 'left';

    const filled = Math.min(trailIdx, TRAIL_LEN);
    if (filled > 1) {
      for (let i = 1; i < filled; i++) {
        const idx0 = (trailIdx - filled + i - 1 + TRAIL_LEN) % TRAIL_LEN;
        const idx1 = (trailIdx - filled + i + TRAIL_LEN) % TRAIL_LEN;
        const x0 = L.plotX + phaseTrailX[idx0] * L.plotSize;
        const y0 = L.plotY + (1 - phaseTrailY[idx0]) * L.plotSize;
        const x1 = L.plotX + phaseTrailX[idx1] * L.plotSize;
        const y1 = L.plotY + (1 - phaseTrailY[idx1]) * L.plotSize;
        const age = i / filled;
        _ctx.strokeStyle = `rgba(122, 188, 188, ${age * age * 0.7})`;
        _ctx.lineWidth = 0.5 + age * 2;
        _ctx.beginPath(); _ctx.moveTo(x0, y0); _ctx.lineTo(x1, y1); _ctx.stroke();
      }
      const curIdx = (trailIdx - 1 + TRAIL_LEN) % TRAIL_LEN;
      const dotX = L.plotX + phaseTrailX[curIdx] * L.plotSize;
      const dotY = L.plotY + (1 - phaseTrailY[curIdx]) * L.plotSize;
      _ctx.beginPath(); _ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
      _ctx.fillStyle = 'rgba(122, 188, 188, 0.2)'; _ctx.fill();
      _ctx.beginPath(); _ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
      _ctx.fillStyle = COL_TEXT; _ctx.fill();
    }

    _ctx.fillStyle = COL_DIM;
    _ctx.font = '8px monospace';
    _ctx.fillText(`${ap.label}  [X]  [V]`, L.plotX, L.plotY - 5);
  }

  // ════════════════════════════════════════════════════════════════════════
  // 2. RADAR PENTAGON (right column, top)
  // ════════════════════════════════════════════════════════════════════════

  const radarN = FEATURES.length;
  const angleOff = -Math.PI / 2;

  _ctx.strokeStyle = COL_GRID;
  _ctx.lineWidth = 0.5;
  for (let ring = 1; ring <= 4; ring++) {
    const r = (ring / 4) * L.radarR;
    _ctx.beginPath();
    for (let i = 0; i <= radarN; i++) {
      const a = angleOff + (i % radarN) * (Math.PI * 2 / radarN);
      const px = L.radarCx + Math.cos(a) * r;
      const py = L.radarCy + Math.sin(a) * r;
      if (i === 0) _ctx.moveTo(px, py); else _ctx.lineTo(px, py);
    }
    _ctx.stroke();
  }

  for (let i = 0; i < radarN; i++) {
    const a = angleOff + i * (Math.PI * 2 / radarN);
    const sx = L.radarCx + Math.cos(a) * L.radarR;
    const sy = L.radarCy + Math.sin(a) * L.radarR;
    _ctx.strokeStyle = COL_AXIS;
    _ctx.beginPath(); _ctx.moveTo(L.radarCx, L.radarCy); _ctx.lineTo(sx, sy); _ctx.stroke();
    const lx = L.radarCx + Math.cos(a) * (L.radarR + 12);
    const ly = L.radarCy + Math.sin(a) * (L.radarR + 12);
    _ctx.fillStyle = FEATURES[i].color;
    _ctx.font = '8px monospace';
    _ctx.textAlign = 'center';
    _ctx.textBaseline = 'middle';
    _ctx.fillText(FEATURES[i].label, lx, ly);
  }
  _ctx.textAlign = 'left';
  _ctx.textBaseline = 'alphabetic';

  // Data polygon
  _ctx.beginPath();
  for (let i = 0; i < radarN; i++) {
    const a = angleOff + i * (Math.PI * 2 / radarN);
    let val = disp[FEATURES[i].key];
    // smoothness already 0=still, 1=moving — no inversion needed
    const r = val * L.radarR;
    const px = L.radarCx + Math.cos(a) * r;
    const py = L.radarCy + Math.sin(a) * r;
    if (i === 0) _ctx.moveTo(px, py); else _ctx.lineTo(px, py);
  }
  _ctx.closePath();
  _ctx.fillStyle = 'rgba(122, 188, 188, 0.12)';
  _ctx.fill();
  _ctx.strokeStyle = 'rgba(122, 188, 188, 0.6)';
  _ctx.lineWidth = 1.5;
  _ctx.stroke();

  for (let i = 0; i < radarN; i++) {
    const a = angleOff + i * (Math.PI * 2 / radarN);
    let val = disp[FEATURES[i].key];
    // smoothness already 0=still, 1=moving — no inversion needed
    const r = val * L.radarR;
    const px = L.radarCx + Math.cos(a) * r;
    const py = L.radarCy + Math.sin(a) * r;
    _ctx.beginPath(); _ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    _ctx.fillStyle = FEATURES[i].color; _ctx.fill();
  }

  // ════════════════════════════════════════════════════════════════════════
  // 3. GYRO XYZ SCOPE (right column, middle)
  // ════════════════════════════════════════════════════════════════════════

  _ctx.fillStyle = 'rgba(255,255,255,0.02)';
  _ctx.fillRect(L.scopeX, L.scopeY, L.scopeW, L.scopeH);

  _ctx.strokeStyle = COL_AXIS;
  _ctx.lineWidth = 0.5;
  const scopeMid = L.scopeY + L.scopeH / 2;
  _ctx.beginPath(); _ctx.moveTo(L.scopeX, scopeMid); _ctx.lineTo(L.scopeX + L.scopeW, scopeMid); _ctx.stroke();

  _ctx.fillStyle = COL_DIM;
  _ctx.font = '8px monospace';
  _ctx.fillText('gyro', L.scopeX - 24, L.scopeY + 8);
  for (let a = 0; a < 3; a++) {
    _ctx.fillStyle = GYRO_COLORS[a];
    _ctx.fillText(GYRO_LABELS[a], L.scopeX - 24, L.scopeY + 20 + a * 10);
  }

  const scopeFilled = Math.min(trailIdx, TRAIL_LEN);
  if (scopeFilled > 1) {
    for (let a = 0; a < 3; a++) {
      _ctx.beginPath();
      for (let i = 0; i < scopeFilled; i++) {
        const idx = (trailIdx - scopeFilled + i + TRAIL_LEN) % TRAIL_LEN;
        const px = L.scopeX + (i / (TRAIL_LEN - 1)) * L.scopeW;
        const norm = gyroHistory[a][idx] / GYRO_RANGE;
        const py = scopeMid - norm * (L.scopeH / 2);
        if (i === 0) _ctx.moveTo(px, py); else _ctx.lineTo(px, py);
      }
      _ctx.strokeStyle = GYRO_COLORS[a];
      _ctx.lineWidth = 1;
      _ctx.globalAlpha = 0.7;
      _ctx.stroke();
      _ctx.globalAlpha = 1;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // 4. SPARKLINE TRAILS + GATE-STYLE THRESHOLD CONTROLS
  // ════════════════════════════════════════════════════════════════════════

  sliderRects.length = 0;
  thresholdRects.length = 0;
  let sy = L.sparkY0;

  for (let fi = 0; fi < FEATURES.length; fi++) {
    const f = FEATURES[fi];
    const trail = trails[f.key];
    const rawTrail = rawTrails[f.key];
    const val = disp[f.key];
    const rawVal = dispRaw[f.key];
    const cond = S.gestureCondition?.[f.key] ?? {};
    const smoothAmt = cond.smooth ?? 0;
    const inMin  = cond.inMin  ?? 0;
    const inMax  = cond.inMax  ?? 1;

    // Update peak hold — track the max raw value, decay slowly
    if (rawVal > peakHold[f.key]) peakHold[f.key] = rawVal;
    else peakHold[f.key] *= peakDecay;
    const peak = peakHold[f.key];

    // Update slow-moving raw value for readout
    rawSlow[f.key] += (rawVal - rawSlow[f.key]) * RAW_SLOW_RATE;
    const slowVal = rawSlow[f.key];

    // ── Label ─────────────────────────────────────────────────────────────
    _ctx.fillStyle = f.color;
    _ctx.font = '9px monospace';
    _ctx.fillText(f.label, L.sparkSliderX - L.sparkLabelW - 2, sy + L.sparkH / 2 + 4);

    // ── Smoothing slider ──────────────────────────────────────────────────
    const sliderX = L.sparkSliderX;
    const sliderY = sy + L.sparkH / 2 - SLIDER_H / 2;

    _ctx.fillStyle = 'rgba(255,255,255,0.06)';
    _ctx.fillRect(sliderX, sliderY, SLIDER_W, SLIDER_H);
    _ctx.fillStyle = hexToRGBA(f.color, 0.35);
    _ctx.fillRect(sliderX, sliderY, SLIDER_W * smoothAmt, SLIDER_H);
    const thumbX = sliderX + SLIDER_W * smoothAmt;
    _ctx.fillStyle = f.color;
    _ctx.fillRect(thumbX - 2, sliderY - 2, 4, SLIDER_H + 4);

    sliderRects.push({ x: sliderX, y: sliderY, w: SLIDER_W, h: SLIDER_H, featureIdx: fi });

    // ── Sparkline background ──────────────────────────────────────────────
    _ctx.fillStyle = 'rgba(255,255,255,0.03)';
    _ctx.fillRect(L.sparkX, sy, L.sparkW, L.sparkH);

    const sparkFilled = Math.min(trailIdx, TRAIL_LEN);

    // ── Shaded regions outside input range (below inMin, above inMax) ─────
    // Below gate (inMin) — dark red tint
    if (inMin > 0.005) {
      const gateH = inMin * L.sparkH;
      _ctx.fillStyle = 'rgba(255, 60, 60, 0.06)';
      _ctx.fillRect(L.sparkX, sy + L.sparkH - gateH, L.sparkW, gateH);
    }
    // Above ceiling (inMax) — dark blue tint
    if (inMax < 0.995) {
      const ceilH = (1 - inMax) * L.sparkH;
      _ctx.fillStyle = 'rgba(100, 180, 255, 0.06)';
      _ctx.fillRect(L.sparkX, sy, L.sparkW, ceilH);
    }

    // ── Raw trace (faint ghost) ───────────────────────────────────────────
    if (sparkFilled > 1 && smoothAmt > 0.02) {
      _ctx.beginPath();
      for (let i = 0; i < sparkFilled; i++) {
        const idx = (trailIdx - sparkFilled + i + TRAIL_LEN) % TRAIL_LEN;
        const px = L.sparkX + (i / (TRAIL_LEN - 1)) * L.sparkW;
        const py = sy + L.sparkH - rawTrail[idx] * L.sparkH;
        if (i === 0) _ctx.moveTo(px, py); else _ctx.lineTo(px, py);
      }
      _ctx.strokeStyle = hexToRGBA(f.color, 0.18);
      _ctx.lineWidth = 1.2;
      _ctx.stroke();
    }

    // ── Smoothed trace (main line) ────────────────────────────────────────
    if (sparkFilled > 1) {
      _ctx.beginPath();
      for (let i = 0; i < sparkFilled; i++) {
        const idx = (trailIdx - sparkFilled + i + TRAIL_LEN) % TRAIL_LEN;
        const px = L.sparkX + (i / (TRAIL_LEN - 1)) * L.sparkW;
        const py = sy + L.sparkH - trail[idx] * L.sparkH;
        if (i === 0) _ctx.moveTo(px, py); else _ctx.lineTo(px, py);
      }
      _ctx.strokeStyle = f.color;
      _ctx.lineWidth = 2;
      _ctx.stroke();

      // Fill under
      _ctx.lineTo(L.sparkX + ((sparkFilled - 1) / (TRAIL_LEN - 1)) * L.sparkW, sy + L.sparkH);
      _ctx.lineTo(L.sparkX, sy + L.sparkH);
      _ctx.closePath();
      _ctx.fillStyle = hexToRGBA(f.color, 0.05);
      _ctx.fill();
    }

    // ── Gate threshold line (inMin) — draggable ───────────────────────────
    {
      const gateY = sy + L.sparkH - inMin * L.sparkH;
      const isActive = draggingThreshold?.featureIdx === fi && draggingThreshold?.which === 'inMin';
      _ctx.beginPath();
      _ctx.moveTo(L.sparkX, gateY);
      _ctx.lineTo(L.sparkX + L.sparkW, gateY);
      _ctx.strokeStyle = isActive ? 'rgba(255, 100, 100, 0.9)' : 'rgba(255, 100, 100, 0.5)';
      _ctx.lineWidth = isActive ? 2 : 1.5;
      _ctx.stroke();
      // Gate label on left edge
      _ctx.fillStyle = 'rgba(255, 100, 100, 0.8)';
      _ctx.font = '9px monospace';
      _ctx.fillText(`▸ ${(inMin * 100).toFixed(0)}`, L.sparkX + 2, gateY - 3);
      // Register hit area
      thresholdRects.push({ x: L.sparkX, y: gateY, w: L.sparkW, h: 0, featureIdx: fi, which: 'inMin' });
    }

    // ── Ceiling threshold line (inMax) — draggable ────────────────────────
    {
      const ceilY = sy + L.sparkH - inMax * L.sparkH;
      const isActive = draggingThreshold?.featureIdx === fi && draggingThreshold?.which === 'inMax';
      _ctx.beginPath();
      _ctx.moveTo(L.sparkX, ceilY);
      _ctx.lineTo(L.sparkX + L.sparkW, ceilY);
      _ctx.strokeStyle = isActive ? 'rgba(100, 180, 255, 0.9)' : 'rgba(100, 180, 255, 0.5)';
      _ctx.lineWidth = isActive ? 2 : 1.5;
      _ctx.stroke();
      // Ceiling label on left edge
      _ctx.fillStyle = 'rgba(100, 180, 255, 0.8)';
      _ctx.font = '9px monospace';
      _ctx.fillText(`▾ ${(inMax * 100).toFixed(0)}`, L.sparkX + 2, ceilY + 11);
      // Register hit area
      thresholdRects.push({ x: L.sparkX, y: ceilY, w: L.sparkW, h: 0, featureIdx: fi, which: 'inMax' });
    }

    // ── Peak hold meter — thin bar on right edge of sparkline ─────────────
    {
      const peakY = sy + L.sparkH - peak * L.sparkH;
      // Peak marker — small triangle + line
      _ctx.beginPath();
      _ctx.moveTo(L.sparkX + L.sparkW - 1, peakY);
      _ctx.lineTo(L.sparkX + L.sparkW - 6, peakY - 3);
      _ctx.lineTo(L.sparkX + L.sparkW - 6, peakY + 3);
      _ctx.closePath();
      _ctx.fillStyle = 'rgba(255, 220, 100, 0.7)';
      _ctx.fill();
      // Peak value text
      _ctx.font = '8px monospace';
      _ctx.fillStyle = 'rgba(255, 220, 100, 0.6)';
      _ctx.textAlign = 'right';
      _ctx.fillText(`pk ${(peak * 100).toFixed(0)}`, L.sparkX + L.sparkW - 8, peakY + 3);
      _ctx.textAlign = 'left';
    }

    // ── Current slow-moving raw value — right side readout ────────────────
    {
      // Slow value indicator on sparkline right edge — a horizontal tick
      const slowY = sy + L.sparkH - slowVal * L.sparkH;
      _ctx.beginPath();
      _ctx.moveTo(L.sparkX + L.sparkW, slowY);
      _ctx.lineTo(L.sparkX + L.sparkW + 6, slowY);
      _ctx.strokeStyle = hexToRGBA(f.color, 0.6);
      _ctx.lineWidth = 2;
      _ctx.stroke();
      // Slow value number next to tick
      _ctx.font = '8px monospace';
      _ctx.fillStyle = hexToRGBA(f.color, 0.5);
      _ctx.fillText((slowVal * 100).toFixed(0), L.sparkX + L.sparkW + 8, slowY + 4);
    }

    // ── Output value (conditioned) — left side readout ────────────────────
    _ctx.fillStyle = COL_DIM;
    _ctx.font = '9px monospace';
    _ctx.textAlign = 'right';
    _ctx.fillText((val * 100).toFixed(0), L.sparkX - 5, sy + L.sparkH / 2 + 4);
    _ctx.textAlign = 'left';

    // Current value dot on right edge
    const dotPy = sy + L.sparkH - val * L.sparkH;
    _ctx.beginPath(); _ctx.arc(L.sparkX + L.sparkW, dotPy, 4, 0, Math.PI * 2);
    _ctx.fillStyle = f.color; _ctx.fill();

    sy += L.sparkH + L.sparkGap;
  }

  // ════════════════════════════════════════════════════════════════════════
  // 5. FOOTER: raw data
  // ════════════════════════════════════════════════════════════════════════

  _ctx.fillStyle = COL_DIM;
  _ctx.font = '9px monospace';
  _ctx.fillText(
    `gyro ${g.gyroMag.toFixed(0)}°/s  accel ${g.accelDynMag.toFixed(2)}g  jerk ${g.jerk.toFixed(0)}`,
    L.scopeX, L.footerY
  );
  if (g.periodicity > 0.2) {
    const perioFeature = FEATURES.find(f => f.key === 'periodicity');
    _ctx.fillStyle = perioFeature ? perioFeature.color : '#ce93d8';
    _ctx.fillText(`${g.periodicityHz.toFixed(1)}Hz`, L.scopeX + 200, L.footerY);
  }

  // (laban labels removed)

  } catch (err) {
    console.error('[gesture-window] draw error:', err);
  }
  // started in init
}

// ── Keyboard ─────────────────────────────────────────────────────────────────

function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'x') {
    axisPairIdx = (axisPairIdx + 1) % AXIS_PAIRS.length;
    _saveGestureSettings();
  }
  if (e.key === 'v') {
    showRadial = !showRadial;
    _saveGestureSettings();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hexToRGBA(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Init / destroy / toggle ──────────────────────────────────────────────────

export function initGesturePanel() {
  const modal = document.getElementById('gestureModal');
  _canvas = document.getElementById('gestureCanvas');
  if (!_canvas) { console.warn('[gesture-panel] no #gestureCanvas'); return; }
  _ctx = _canvas.getContext('2d');

  // Close button
  const closeBtn = document.getElementById('gestureClose');
  if (closeBtn) closeBtn.addEventListener('click', () => toggleGesturePanel(false));
  // Click on overlay background closes panel
  if (modal) modal.addEventListener('click', (e) => {
    if (e.target === modal) toggleGesturePanel(false);
  });

  // Observe resize of the dialog to recompute layout
  const dialog = _canvas.parentElement;
  const ro = new ResizeObserver(() => { if (_visible) computeLayout(); });
  ro.observe(dialog);

  // Attach mouse events to our _canvas
  _canvas.addEventListener('mousedown', onMouseDown);
  _canvas.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', (e) => {
    if (!_visible) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    onKeyDown(e);
  });

  // Restore persisted settings before starting the loop
  _loadGestureSettings();

  // Start the rAF loop immediately — joystick physics must run even before
  // the panel is first opened so radial morph works from the start.
  if (!_rafId) _rafId = requestAnimationFrame(draw);

  console.log('[gesture-panel] initialized');
}

export function toggleGesturePanel(forceState) {
  const modal = document.getElementById('gestureModal');
  if (!modal) return;
  _visible = forceState !== undefined ? forceState : !_visible;
  if (_visible) {
    modal.classList.add('open');
    computeLayout();
  } else {
    modal.classList.remove('open');
  }
  // Always keep the rAF loop alive — joystick physics must run for morph
  if (!_rafId) _rafId = requestAnimationFrame(draw);
}

export function destroyGesturePanel() {
  if (_rafId) cancelAnimationFrame(_rafId);
  _rafId = null;
  _visible = false;
}
