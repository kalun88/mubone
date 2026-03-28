// ============================================================================
// ui-sensors.js — Sensor registry panel (master layout)
//
// One row per stream (not per slot).  A sensor sending both quat and inertial
// gets two separate rows, each with its own activity dot, role dropdown,
// stream-specific readout, and inline calibration/routing controls.
//
// For cursor (quat): shows per-axis breakdown with raw readout, destination
// dropdown, sign, mute, plus tare controls.
// For frame (quat): same axis map + tare controls as cursor.
// For gesture (inertial): gravity reference capture.
// For unmapped: no breakout shown.
//
// Opened via the ⊕ sensors button in the top-bar sensor group.
// ============================================================================

import { S, DEBUG } from './state.js';
import {
  getRegistry, getByRole, assignQuatRole, assignInertialRole,
  slotTare, slotClearTare, saveCalibration,
  QUAT_ROLES, INERTIAL_ROLES,
} from './sensor-registry.js';

let _modal   = null;
let _listEl  = null;
let _rafId   = null;

const ACTIVITY_TIMEOUT = 500;

// Destination labels used in the cursor axis map.
// These correspond to the existing axisMap.viz values but named for the user.
const VIZ_DEST_LABELS = {
  roll:      'viz roll',
  pitch:     'viz elevation',
  yaw:       'viz azimuth',
  unmapped:  'unmapped',
};
const VIZ_DEST_OPTIONS = ['viz roll', 'viz elevation', 'viz azimuth', 'unmapped'];
const LABEL_TO_VIZ = { 'viz roll': 'roll', 'viz elevation': 'pitch', 'viz azimuth': 'yaw', 'unmapped': 'unmapped' };

// ── Init ──────────────────────────────────────────────────────────────────────
export function initSensorsUI() {
  _modal  = document.getElementById('sensorsModal');
  _listEl = document.getElementById('sensorsList');
  const btn   = document.getElementById('sensorsBtn');
  const close = document.getElementById('sensorsClose');

  if (!_modal || !btn) return;

  btn.addEventListener('click', () => { _modal.classList.add('open'); startRAF(); });
  close?.addEventListener('click', () => _modal.classList.remove('open'));
  _modal.addEventListener('click', e => { if (e.target === _modal) _modal.classList.remove('open'); });

  // Stop rAF when modal closes
  const obs = new MutationObserver(() => {
    if (!_modal.classList.contains('open')) stopRAF();
  });
  obs.observe(_modal, { attributes: true, attributeFilter: ['class'] });

  // Listen for new sensor discoveries
  S._onSensorDiscovered = () => rebuildList();
  S._onSensorRoleChanged = () => rebuildList();

  // ── Session panel tare shortcut ──────────────────────────────────────
  // Tares the cursor sensor, and also the frame sensor if assigned (two-IMU
  // mode).  Exposed on S so events.js can trigger it from keyboard (`)
  // without importing sensor-registry.
  function tareAction() {
    const cursorSlot = getByRole('cursor');
    if (cursorSlot) slotTare(cursorSlot);
    // Two-IMU mode: tare frame sensor too — you almost always want both
    // zeroed at the same time.  Per-slot tare in sensor panel for individual.
    const frameSlot = getByRole('frame');
    if (frameSlot) slotTare(frameSlot);
    const btn = document.getElementById('cursorZeroTopBtn');
    if (btn) btn.classList.add('active');
  }
  S._tareCursor = tareAction;   // keep legacy name — keyboard/OSC callers use it
  document.getElementById('cursorZeroTopBtn')?.addEventListener('click', tareAction);
}

// ── Build / rebuild the sensor list ──────────────────────────────────────────
function rebuildList() {
  if (!_listEl) return;
  const registry = getRegistry();

  if (registry.size === 0) {
    _listEl.innerHTML = '<div class="sensors-empty">no sensors discovered yet — send /sensor/{name}/quaternion or /sensor/{name}/inertial from Max</div>';
    return;
  }

  _listEl.innerHTML = '';
  for (const [name, slot] of registry) {
    if (slot.hasQuat)     _listEl.appendChild(buildStreamBlock(name, slot, 'quat'));
    if (slot.hasInertial) _listEl.appendChild(buildStreamBlock(name, slot, 'inertial'));
  }
}

// ── Single stream block (header row + inline controls) ──────────────────────
function buildStreamBlock(name, slot, stream) {
  const block = document.createElement('div');
  block.className = 'sensor-stream-block';
  block.dataset.slotName = name;
  block.dataset.stream = stream;

  // ── Header row: dot + name + badge + role dropdown + readout ──
  const row = document.createElement('div');
  row.className = 'sensor-slot-row';

  // Activity dot
  const dot = document.createElement('span');
  dot.className = 'sensor-dot';
  row.appendChild(dot);

  // Name
  const nameEl = document.createElement('span');
  nameEl.className = 'sensor-slot-name';
  nameEl.textContent = name;
  row.appendChild(nameEl);

  // Badge
  const badge = document.createElement('span');
  badge.className = stream === 'quat'
    ? 'sensor-badge sensor-badge-quat'
    : 'sensor-badge sensor-badge-inertial';
  badge.textContent = stream === 'quat' ? 'quat' : 'inertial';
  row.appendChild(badge);

  // Role dropdown
  const roles = stream === 'quat' ? QUAT_ROLES : INERTIAL_ROLES;
  const currentRole = stream === 'quat' ? slot.quatRole : slot.inertialRole;
  const assignFn = stream === 'quat' ? assignQuatRole : assignInertialRole;

  const ROLE_TOOLTIPS = {
    cursor:   'Controls where you paint and play',
    frame:    'Sets the world orientation (mount on projector, body, or room)',
    gesture:  'Drives gesture extraction features',
    unmapped: 'Sensor active but not assigned to a role',
    custom:   'Custom signal routing',
  };

  const sel = document.createElement('select');
  sel.className = 'sensor-role-select';
  for (const role of roles) {
    const opt = document.createElement('option');
    opt.value = role;
    opt.textContent = role;
    if (ROLE_TOOLTIPS[role]) opt.title = ROLE_TOOLTIPS[role];
    if (currentRole === role) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.title = ROLE_TOOLTIPS[currentRole] || '';
  sel.addEventListener('change', () => {
    assignFn(name, sel.value);
    rebuildList();
  });
  row.appendChild(sel);

  // Live readout (header-level — raw for quat, summary for inertial)
  const readout = document.createElement('span');
  readout.className = 'sensor-slot-readout';
  row.appendChild(readout);

  block.appendChild(row);

  // ── Inline controls based on role ──
  if (stream === 'quat' && currentRole === 'cursor') {
    block.appendChild(buildCursorControls(name, slot));
  } else if (stream === 'quat' && currentRole === 'frame') {
    block.appendChild(buildFrameControls(name, slot));
  } else if (stream === 'inertial' && currentRole === 'gesture') {
    block.appendChild(buildGestureControls(name, slot));
  }

  return block;
}


// ── Cursor controls (quat): axis map table + tare ───────────────────────────
function buildCursorControls(name, slot) {
  const container = document.createElement('div');
  container.className = 'sensor-routing-breakout';

  const cal = slot.quatCal;

  // ── Axis map table: hardware x/y/z → destination, sign, mute ──
  const table = document.createElement('table');
  table.className = 'sensor-route-table';

  const thead = document.createElement('thead');
  const hRow = document.createElement('tr');
  for (const label of ['axis', 'raw', 'destination', '±', 'mute']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === 'raw') th.style.textAlign = 'right';
    hRow.appendChild(th);
  }
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const phys of ['x', 'y', 'z']) {
    const tr = document.createElement('tr');

    // Hardware axis label
    const tdAxis = document.createElement('td');
    tdAxis.className = 'sensor-route-signal';
    tdAxis.textContent = phys;
    tr.appendChild(tdAxis);

    // Raw value readout (updated by rAF loop)
    const tdRaw = document.createElement('td');
    tdRaw.className = 'sensor-axis-raw';
    tdRaw.dataset.axis = phys;
    tdRaw.textContent = '—';
    tr.appendChild(tdRaw);

    // Destination dropdown
    const tdDest = document.createElement('td');
    const destSel = document.createElement('select');
    destSel.className = 'sensor-route-dest-select';
    destSel.title = 'Map this sensor axis to a viz dimension, or unmapped to ignore it';
    const currentViz = cal.axisMap[phys].viz;
    for (const destLabel of VIZ_DEST_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = destLabel;
      opt.textContent = destLabel;
      if (VIZ_DEST_LABELS[currentViz] === destLabel) opt.selected = true;
      destSel.appendChild(opt);
    }
    destSel.addEventListener('change', () => {
      cal.axisMap[phys].viz = LABEL_TO_VIZ[destSel.value];
      saveCalibration();
    });
    tdDest.appendChild(destSel);
    tr.appendChild(tdDest);

    // Sign toggle
    const tdSign = document.createElement('td');
    const signBtn = document.createElement('button');
    signBtn.className = 'sensor-inline-btn';
    signBtn.title = 'Reverse polarity of this axis';
    signBtn.textContent = cal.axisMap[phys].sign === 1 ? '+' : '−';
    if (cal.axisMap[phys].sign === -1) signBtn.classList.add('active');
    signBtn.addEventListener('click', () => {
      cal.axisMap[phys].sign *= -1;
      signBtn.textContent = cal.axisMap[phys].sign === 1 ? '+' : '−';
      signBtn.classList.toggle('active', cal.axisMap[phys].sign === -1);
      saveCalibration();
    });
    tdSign.appendChild(signBtn);
    tr.appendChild(tdSign);

    // Mute toggle
    const tdMute = document.createElement('td');
    const muteBtn = document.createElement('button');
    muteBtn.className = 'sensor-inline-btn';
    muteBtn.textContent = '◎';
    if (cal.axisMap[phys].mute) muteBtn.classList.add('active');
    // BUG: muting any axis causes pole/yaw issues — all mutes disabled, fix in progress
    muteBtn.title = 'Axis mute disabled — known pole/yaw bug when axes are muted, fix in progress';
    muteBtn.disabled = true;
    muteBtn.style.opacity = '0.4';
    muteBtn.style.cursor = 'not-allowed';
    tdMute.appendChild(muteBtn);
    tr.appendChild(tdMute);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  // ── Tare row ──
  const tareRow = document.createElement('div');
  tareRow.className = 'sensor-tare-row';

  const zeroBtn = document.createElement('button');
  zeroBtn.className = 'sensor-inline-btn';
  zeroBtn.title = 'Set current orientation as zero reference — calibrates sensor offset';
  zeroBtn.textContent = slot.quatCal.tareQuat ? '⊙ retare' : '⊙ tare';
  if (slot.quatCal.tareQuat) zeroBtn.classList.add('active');

  const clearBtn = document.createElement('button');
  clearBtn.className = 'sensor-inline-btn';
  clearBtn.title = 'Remove tare — revert to raw sensor orientation';
  clearBtn.textContent = '✕ clear';

  const tareReadout = document.createElement('span');
  tareReadout.className = 'sensor-tare-readout';
  if (slot.quatCal.tareQuat) {
    const t = slot.quatCal.tareQuat;
    tareReadout.textContent = `[${t[0].toFixed(3)}, ${t[1].toFixed(3)}, ${t[2].toFixed(3)}, ${t[3].toFixed(3)}]`;
  } else {
    tareReadout.textContent = 'no tare set';
  }

  zeroBtn.addEventListener('click', () => {
    slotTare(slot);
    zeroBtn.textContent = '⊙ retare';
    zeroBtn.classList.add('active');
    const t = slot.quatCal.tareQuat;
    tareReadout.textContent = `[${t[0].toFixed(3)}, ${t[1].toFixed(3)}, ${t[2].toFixed(3)}, ${t[3].toFixed(3)}]`;
    document.getElementById('cursorZeroTopBtn')?.classList.add('active');
  });
  clearBtn.addEventListener('click', () => {
    slotClearTare(slot);
    zeroBtn.textContent = '⊙ tare';
    zeroBtn.classList.remove('active');
    tareReadout.textContent = 'no tare set';
    document.getElementById('cursorZeroTopBtn')?.classList.remove('active');
  });

  tareRow.appendChild(zeroBtn);
  tareRow.appendChild(clearBtn);
  tareRow.appendChild(tareReadout);
  container.appendChild(tareRow);

  // ── Recenter row ──
  const recenterRow = document.createElement('div');
  recenterRow.className = 'sensor-tare-row';

  const recenterBtn = document.createElement('button');
  recenterBtn.className = 'sensor-inline-btn';
  // BUG: recenter drift correction has a known issue — fix is being worked on
  recenterBtn.title = 'Recenter disabled — known drift-correction bug, fix in progress';
  recenterBtn.textContent = '⊕ recenter';
  recenterBtn.disabled = true;
  recenterBtn.style.opacity = '0.4';
  recenterBtn.style.cursor = 'not-allowed';
  recenterRow.appendChild(recenterBtn);
  container.appendChild(recenterRow);

  // ── Caution notes ──
  const caution = document.createElement('div');
  caution.style.cssText = 'margin-top:8px; padding:6px 8px; font-size:0.7rem; line-height:1.4; color:#e8a850; border-left:2px solid #e8a850; opacity:0.85;';
  caution.innerHTML =
    '<b>⚠ Mounting &amp; tare:</b> Set your axis map <i>before</i> taring. ' +
    'Default (X\u2009=\u2009roll) uses gravity-aligned tare — pitch stays level with the horizon. ' +
    'Non-default forward axis (Y or Z\u2009=\u2009roll) uses full-quaternion tare — ' +
    'the entire mounting orientation is zeroed out, so any physical orientation works.<br>' +
    '<b>⚠ Roll axis required:</b> Roll must stay mapped and unmuted. ' +
    'Muting or unmapping roll causes pole/yaw issues — fix in progress.';
  container.appendChild(caution);

  return container;
}


// ── Frame controls (quat): same axis map + tare as cursor ───────────────────
// The frame sensor defines the world reference. It needs the same calibration
// controls as cursor: per-axis destination, sign, mute, plus tare.
function buildFrameControls(name, slot) {
  const container = document.createElement('div');
  container.className = 'sensor-routing-breakout';

  const cal = slot.quatCal;

  // ── Axis map table: hardware x/y/z → destination, sign, mute ──
  const table = document.createElement('table');
  table.className = 'sensor-route-table';

  const thead = document.createElement('thead');
  const hRow = document.createElement('tr');
  for (const label of ['axis', 'raw', 'destination', '±', 'mute']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === 'raw') th.style.textAlign = 'right';
    hRow.appendChild(th);
  }
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const phys of ['x', 'y', 'z']) {
    const tr = document.createElement('tr');

    // Hardware axis label
    const tdAxis = document.createElement('td');
    tdAxis.className = 'sensor-route-signal';
    tdAxis.textContent = phys;
    tr.appendChild(tdAxis);

    // Raw value readout (updated by rAF loop)
    const tdRaw = document.createElement('td');
    tdRaw.className = 'sensor-axis-raw';
    tdRaw.dataset.axis = phys;
    tdRaw.textContent = '—';
    tr.appendChild(tdRaw);

    // Destination dropdown (same options as cursor)
    const tdDest = document.createElement('td');
    const destSel = document.createElement('select');
    destSel.className = 'sensor-route-dest-select';
    destSel.title = 'Map this sensor axis to a viz dimension, or unmapped to ignore it';
    const currentViz = cal.axisMap[phys].viz;
    for (const destLabel of VIZ_DEST_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = destLabel;
      opt.textContent = destLabel;
      if (VIZ_DEST_LABELS[currentViz] === destLabel) opt.selected = true;
      destSel.appendChild(opt);
    }
    destSel.addEventListener('change', () => {
      cal.axisMap[phys].viz = LABEL_TO_VIZ[destSel.value];
      saveCalibration();
    });
    tdDest.appendChild(destSel);
    tr.appendChild(tdDest);

    // Sign toggle
    const tdSign = document.createElement('td');
    const signBtn = document.createElement('button');
    signBtn.className = 'sensor-inline-btn';
    signBtn.title = 'Reverse polarity of this axis';
    signBtn.textContent = cal.axisMap[phys].sign === 1 ? '+' : '−';
    if (cal.axisMap[phys].sign === -1) signBtn.classList.add('active');
    signBtn.addEventListener('click', () => {
      cal.axisMap[phys].sign *= -1;
      signBtn.textContent = cal.axisMap[phys].sign === 1 ? '+' : '−';
      signBtn.classList.toggle('active', cal.axisMap[phys].sign === -1);
      saveCalibration();
    });
    tdSign.appendChild(signBtn);
    tr.appendChild(tdSign);

    // Mute toggle
    const tdMute = document.createElement('td');
    const muteBtn = document.createElement('button');
    muteBtn.className = 'sensor-inline-btn';
    muteBtn.textContent = '◎';
    if (cal.axisMap[phys].mute) muteBtn.classList.add('active');
    // BUG: muting any axis causes pole/yaw issues — all mutes disabled, fix in progress
    muteBtn.title = 'Axis mute disabled — known pole/yaw bug when axes are muted, fix in progress';
    muteBtn.disabled = true;
    muteBtn.style.opacity = '0.4';
    muteBtn.style.cursor = 'not-allowed';
    tdMute.appendChild(muteBtn);
    tr.appendChild(tdMute);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  // ── Tare row ──
  const tareRow = document.createElement('div');
  tareRow.className = 'sensor-tare-row';

  const zeroBtn = document.createElement('button');
  zeroBtn.className = 'sensor-inline-btn';
  zeroBtn.title = 'Set current orientation as zero reference — calibrates sensor offset';
  zeroBtn.textContent = slot.quatCal.tareQuat ? '⊙ retare' : '⊙ tare';
  if (slot.quatCal.tareQuat) zeroBtn.classList.add('active');

  const clearBtn = document.createElement('button');
  clearBtn.className = 'sensor-inline-btn';
  clearBtn.title = 'Remove tare — revert to raw sensor orientation';
  clearBtn.textContent = '✕ clear';

  const tareReadout = document.createElement('span');
  tareReadout.className = 'sensor-tare-readout';
  if (slot.quatCal.tareQuat) {
    const t = slot.quatCal.tareQuat;
    tareReadout.textContent = `[${t[0].toFixed(3)}, ${t[1].toFixed(3)}, ${t[2].toFixed(3)}, ${t[3].toFixed(3)}]`;
  } else {
    tareReadout.textContent = 'no tare set';
  }

  zeroBtn.addEventListener('click', () => {
    slotTare(slot);
    zeroBtn.textContent = '⊙ retare';
    zeroBtn.classList.add('active');
    const t = slot.quatCal.tareQuat;
    tareReadout.textContent = `[${t[0].toFixed(3)}, ${t[1].toFixed(3)}, ${t[2].toFixed(3)}, ${t[3].toFixed(3)}]`;
  });
  clearBtn.addEventListener('click', () => {
    slotClearTare(slot);
    zeroBtn.textContent = '⊙ tare';
    zeroBtn.classList.remove('active');
    tareReadout.textContent = 'no tare set';
  });

  tareRow.appendChild(zeroBtn);
  tareRow.appendChild(clearBtn);
  tareRow.appendChild(tareReadout);
  container.appendChild(tareRow);

  // ── Caution notes ──
  const caution = document.createElement('div');
  caution.style.cssText = 'margin-top:8px; padding:6px 8px; font-size:0.7rem; line-height:1.4; color:#e8a850; border-left:2px solid #e8a850; opacity:0.85;';
  caution.innerHTML =
    '<b>⚠ Mounting &amp; tare:</b> Set your axis map <i>before</i> taring. ' +
    'Default (X\u2009=\u2009roll) uses gravity-aligned tare. ' +
    'Non-default forward axis uses full-quaternion tare — any mounting orientation works.';
  container.appendChild(caution);

  return container;
}


// ── Gesture controls (inertial): gravity reference ──────────────────────────
function buildGestureControls(name, slot) {
  const container = document.createElement('div');
  container.className = 'sensor-routing-breakout';

  // Routing labels
  const table = document.createElement('table');
  table.className = 'sensor-route-table';
  const thead = document.createElement('thead');
  const hRow = document.createElement('tr');
  const thSignal = document.createElement('th'); thSignal.textContent = 'signal';
  const thDest   = document.createElement('th'); thDest.textContent   = 'destination';
  hRow.appendChild(thSignal);
  hRow.appendChild(thDest);
  thead.appendChild(hRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const sig of ['gyro x', 'gyro y', 'gyro z', 'accel x', 'accel y', 'accel z']) {
    const tr = document.createElement('tr');
    const tdSig = document.createElement('td');
    tdSig.className = 'sensor-route-signal';
    tdSig.textContent = sig;
    tr.appendChild(tdSig);
    const tdDest = document.createElement('td');
    const label = document.createElement('span');
    label.className = 'sensor-route-dest-label';
    label.textContent = 'gesture chain';
    tdDest.appendChild(label);
    tr.appendChild(tdDest);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  // Gravity reference capture
  const gravRow = document.createElement('div');
  gravRow.className = 'sensor-tare-row';

  const captureBtn = document.createElement('button');
  captureBtn.className = 'sensor-inline-btn';
  captureBtn.title = 'Capture current gravity vector as rest reference for gesture detection';
  captureBtn.textContent = slot.inertialCal.gravityRef ? '⊙ recapture' : '⊙ capture gravity';
  if (slot.inertialCal.gravityRef) captureBtn.classList.add('active');

  const clearBtn = document.createElement('button');
  clearBtn.className = 'sensor-inline-btn';
  clearBtn.title = 'Remove gravity reference';
  clearBtn.textContent = '✕ clear';

  const gravReadout = document.createElement('span');
  gravReadout.className = 'sensor-tare-readout';
  gravReadout.dataset.slotName = name;
  gravReadout.dataset.type = 'gravity';
  if (slot.inertialCal.gravityRef) {
    const g = slot.inertialCal.gravityRef;
    gravReadout.textContent = `[${g[0].toFixed(2)}, ${g[1].toFixed(2)}, ${g[2].toFixed(2)}]`;
  } else {
    gravReadout.textContent = 'hold still, then capture';
  }

  captureBtn.addEventListener('click', () => {
    if (slot.inertial) {
      slot.inertialCal.gravityRef = [slot.inertial.ax, slot.inertial.ay, slot.inertial.az];
      captureBtn.textContent = '⊙ recapture';
      captureBtn.classList.add('active');
      const g = slot.inertialCal.gravityRef;
      gravReadout.textContent = `[${g[0].toFixed(2)}, ${g[1].toFixed(2)}, ${g[2].toFixed(2)}]`;
      saveCalibration();
    }
  });

  clearBtn.addEventListener('click', () => {
    slot.inertialCal.gravityRef = null;
    captureBtn.textContent = '⊙ capture gravity';
    captureBtn.classList.remove('active');
    gravReadout.textContent = 'hold still, then capture';
    saveCalibration();
  });

  gravRow.appendChild(captureBtn);
  gravRow.appendChild(clearBtn);
  gravRow.appendChild(gravReadout);
  container.appendChild(gravRow);

  return container;
}


// ── Live update loop ────────────────────────────────────────────────────────
function updateReadouts() {
  if (!_listEl) return;
  const now = Date.now();
  const registry = getRegistry();

  // Check if stream count changed since last build
  let expectedBlocks = 0;
  for (const slot of registry.values()) {
    if (slot.hasQuat)     expectedBlocks++;
    if (slot.hasInertial) expectedBlocks++;
  }
  const blocks = _listEl.querySelectorAll('.sensor-stream-block');
  if (blocks.length !== expectedBlocks) {
    rebuildList();
    _rafId = requestAnimationFrame(updateReadouts);
    return;
  }

  for (const block of blocks) {
    const name   = block.dataset.slotName;
    const stream = block.dataset.stream;
    const slot   = registry.get(name);
    if (!slot) continue;

    // Activity dot
    const dot = block.querySelector('.sensor-dot');
    if (dot) {
      const active = stream === 'quat'
        ? (now - slot.lastSeenQuat) < ACTIVITY_TIMEOUT
        : (now - slot.lastSeenInertial) < ACTIVITY_TIMEOUT;
      dot.classList.toggle('active', active);
    }

    // Header readout — raw hardware x/y/z for quat, summary for inertial
    const readout = block.querySelector('.sensor-slot-readout');
    if (readout) {
      if (stream === 'quat' && slot.euler) {
        // Raw euler — hardware x/y/z before tare/remap
        readout.textContent = `x${slot.euler.x.toFixed(0)}° y${slot.euler.y.toFixed(0)}° z${slot.euler.z.toFixed(0)}°`;
      } else if (stream === 'inertial' && slot.inertial) {
        readout.textContent = `gyro ${slot.inertial.gyroMag.toFixed(0)}°/s  accel ${slot.inertial.accelDynMag.toFixed(2)}g`;
      } else {
        readout.textContent = '—';
      }
    }

    // Per-axis raw readouts (cursor + frame)
    for (const rawEl of block.querySelectorAll('.sensor-axis-raw')) {
      const axis = rawEl.dataset.axis;
      if (slot.euler && axis) {
        rawEl.textContent = `${slot.euler[axis].toFixed(1)}°`;
      }
    }
  }

  _rafId = requestAnimationFrame(updateReadouts);
}

function startRAF() { if (!_rafId) _rafId = requestAnimationFrame(updateReadouts); }
function stopRAF()  { if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; } }
